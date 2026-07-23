export interface DisposableWorkerOperationHandle<T> {
  readonly result: PromiseLike<T>;
  terminate(): void | PromiseLike<void>;
}

export interface DisposableWorkerOperationOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class DisposableWorkerOperationTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    assertTimeout(timeoutMs);
    super(`Disposable worker operation exceeded its ${timeoutMs} ms timeout`);
    this.name = "DisposableWorkerOperationTimeoutError";
    this.timeoutMs = timeoutMs;
    Object.freeze(this);
  }
}

type OperationOutcome<T> =
  | {
      readonly kind: "success";
      readonly value: T;
    }
  | {
      readonly kind: "failure";
      readonly error: unknown;
    };

function assertTimeout(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      "Disposable worker operation timeoutMs must be a positive safe integer",
    );
  }
}

function abortError(): DOMException {
  return new DOMException(
    "Disposable worker operation was aborted",
    "AbortError",
  );
}

function objectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function deadlineExpired(startedAt: number, timeoutMs: number): boolean {
  const elapsed = performance.now() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= timeoutMs;
}

function adoptPromiseLike<T>(
  value: object,
  then: Function,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      Reflect.apply(then, value, [resolve, reject]);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Runs one operation in a disposable externally owned worker realm.
 *
 * The first result, rejection, abort, or timeout wins. Every reachable handle
 * is terminated exactly once, and termination completes before this promise
 * settles. A `start` call that throws has not returned a reachable handle, so
 * there is no termination method available to invoke. An adapter whose
 * termination promise never settles will likewise keep this promise pending;
 * adapters must make forced termination independently bounded.
 */
export function runDisposableWorkerOperation<T>(
  start: () => DisposableWorkerOperationHandle<T>,
  options: DisposableWorkerOperationOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs;
  assertTimeout(timeoutMs);
  const signal = options.signal;
  try {
    if (signal?.aborted === true) return Promise.reject(abortError());
  } catch (error) {
    return Promise.reject(error);
  }
  const timeoutStartedAt = performance.now();

  return new Promise<T>((resolve, reject) => {
    let outcome: OperationOutcome<T> | undefined;
    let startFinished = false;
    let terminationStarted = false;
    let terminate:
      | (() => void | PromiseLike<void>)
      | undefined;
    let result: Promise<T> | undefined;
    let timeout:
      | ReturnType<typeof setTimeout>
      | undefined;
    let remainingTimeoutMs = timeoutMs;
    let abortListenerAttached = false;

    const detachAbortListener = (): void => {
      if (!abortListenerAttached || signal === undefined) return;
      abortListenerAttached = false;
      try {
        signal.removeEventListener("abort", onAbort);
      } catch {
        // A hostile listener implementation cannot change the chosen outcome.
      }
    };

    const clearTriggers = (): void => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      detachAbortListener();
    };

    const settleAfterTermination = (): void => {
      if (
        outcome === undefined ||
        !startFinished ||
        terminationStarted
      ) {
        return;
      }
      terminationStarted = true;
      clearTriggers();
      const selected = outcome;
      const terminateOperation = terminate;
      const terminated =
        terminateOperation === undefined
          ? Promise.resolve()
          : Promise.resolve()
              .then(() => terminateOperation())
              .then(() => undefined);
      void terminated.then(
        () => {
          if (selected.kind === "success") {
            resolve(selected.value);
          } else {
            reject(selected.error);
          }
        },
        (terminationError: unknown) => {
          if (selected.kind === "success") {
            reject(terminationError);
            return;
          }
          reject(
            new AggregateError(
              [selected.error, terminationError],
              "Disposable worker operation and termination both failed",
            ),
          );
        },
      );
    };

    const select = (selected: OperationOutcome<T>): void => {
      if (outcome !== undefined) return;
      outcome = selected;
      clearTriggers();
      settleAfterTermination();
    };

    const onTimeout = (): void => {
      if (remainingTimeoutMs > 0) {
        const delay = Math.min(remainingTimeoutMs, MAX_TIMER_DELAY_MS);
        remainingTimeoutMs -= delay;
        timeout = setTimeout(onTimeout, delay);
        return;
      }
      select({
        kind: "failure",
        error: new DisposableWorkerOperationTimeoutError(timeoutMs),
      });
    };

    function onAbort(): void {
      select({ kind: "failure", error: abortError() });
    }

    const firstDelay = Math.min(timeoutMs, MAX_TIMER_DELAY_MS);
    remainingTimeoutMs -= firstDelay;
    timeout = setTimeout(onTimeout, firstDelay);

    if (signal !== undefined) {
      try {
        signal.addEventListener("abort", onAbort, { once: true });
        abortListenerAttached = true;
        if (signal.aborted) onAbort();
      } catch (error) {
        select({ kind: "failure", error });
      }
      if (outcome !== undefined) {
        startFinished = true;
        settleAfterTermination();
        return;
      }
    }

    try {
      const handle: unknown = start();
      if (
        outcome === undefined &&
        deadlineExpired(timeoutStartedAt, timeoutMs)
      ) {
        select({
          kind: "failure",
          error: new DisposableWorkerOperationTimeoutError(timeoutMs),
        });
      }
      if (!objectLike(handle)) {
        select({
          kind: "failure",
          error: new TypeError(
            "Disposable worker operation start returned no handle",
          ),
        });
      } else {
        let rawTerminate: unknown;
        try {
          rawTerminate = Reflect.get(handle, "terminate");
        } catch (error) {
          select({ kind: "failure", error });
        }
        if (typeof rawTerminate !== "function") {
          select({
            kind: "failure",
            error: new TypeError(
              "Disposable worker operation handle has no terminate method",
            ),
          });
        } else {
          terminate = () => Reflect.apply(rawTerminate, handle, []);
        }

        if (outcome === undefined) {
          let rawResult: unknown;
          try {
            rawResult = Reflect.get(handle, "result");
          } catch (error) {
            select({ kind: "failure", error });
          }
          if (outcome === undefined) {
            if (!objectLike(rawResult)) {
              select({
                kind: "failure",
                error: new TypeError(
                  "Disposable worker operation handle result is not PromiseLike",
                ),
              });
            } else {
              let then: unknown;
              try {
                then = Reflect.get(rawResult, "then");
              } catch (error) {
                select({ kind: "failure", error });
              }
              if (outcome === undefined) {
                if (typeof then !== "function") {
                  select({
                    kind: "failure",
                    error: new TypeError(
                      "Disposable worker operation handle result is not PromiseLike",
                    ),
                  });
                } else {
                  result = adoptPromiseLike<T>(rawResult, then);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      select(
        deadlineExpired(timeoutStartedAt, timeoutMs)
          ? {
              kind: "failure",
              error: new DisposableWorkerOperationTimeoutError(timeoutMs),
            }
          : { kind: "failure", error },
      );
    }

    startFinished = true;
    settleAfterTermination();
    if (result !== undefined && outcome === undefined) {
      void result.then(
        (value) => select({ kind: "success", value }),
        (error: unknown) => select({ kind: "failure", error }),
      );
    }
  });
}
