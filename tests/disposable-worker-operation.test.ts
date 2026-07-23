import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DisposableWorkerOperationTimeoutError,
  runDisposableWorkerOperation,
  type DisposableWorkerOperationHandle,
} from "../src/internal/disposable-worker-operation.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve = (_value: T): void => {};
  let reject = (_error: unknown): void => {};
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function handle<T>(
  result: PromiseLike<T>,
  terminate: () => void | PromiseLike<void>,
): DisposableWorkerOperationHandle<T> {
  return { result, terminate };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("disposable worker operation", () => {
  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])(
    "rejects invalid timeout %s before starting",
    (timeoutMs) => {
      const start = vi.fn();
      expect(() =>
        runDisposableWorkerOperation(start, { timeoutMs }),
      ).toThrow(RangeError);
      expect(start).not.toHaveBeenCalled();
    },
  );

  it("does not construct a timeout error with an invalid duration", () => {
    expect(() => new DisposableWorkerOperationTimeoutError(0)).toThrow(
      RangeError,
    );
  });

  it("does not start or arm a timer when already aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const start = vi.fn();

    const operation = runDisposableWorkerOperation(start, {
      timeoutMs: 100,
      signal: controller.signal,
    });

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("arms the timeout before start and awaits termination before success", async () => {
    vi.useFakeTimers();
    const workerResult = deferred<number>();
    const terminated = deferred<void>();
    const terminate = vi.fn(() => terminated.promise);
    let timerCountDuringStart = 0;
    let settled = false;

    const operation = runDisposableWorkerOperation(
      () => {
        timerCountDuringStart = vi.getTimerCount();
        return handle(workerResult.promise, terminate);
      },
      { timeoutMs: 100 },
    );
    void operation.finally(() => {
      settled = true;
    });
    workerResult.resolve(42);
    await flushMicrotasks();

    expect(timerCountDuringStart).toBe(1);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    terminated.resolve();
    await expect(operation).resolves.toBe(42);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("counts synchronous start time against the deadline", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValue(1_025);
    const terminate = vi.fn();
    const operation = runDisposableWorkerOperation(
      () => {
        vi.setSystemTime(1_025);
        return handle(Promise.resolve(42), terminate);
      },
      { timeoutMs: 25 },
    );

    const error = await operation.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DisposableWorkerOperationTimeoutError);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("uses a monotonic clock for synchronous deadline accounting", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(10_000)
      .mockReturnValue(1);
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValue(1_025);
    const terminate = vi.fn();

    await expect(
      runDisposableWorkerOperation(
        () => handle(Promise.resolve(42), terminate),
        { timeoutMs: 25 },
      ),
    ).rejects.toBeInstanceOf(DisposableWorkerOperationTimeoutError);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("awaits termination before preserving a result rejection", async () => {
    const workerResult = deferred<number>();
    const terminated = deferred<void>();
    const terminate = vi.fn(() => terminated.promise);
    const failure = new Error("decode failed");
    let settled = false;
    const operation = runDisposableWorkerOperation(
      () => handle(workerResult.promise, terminate),
      { timeoutMs: 1_000 },
    );
    void operation.catch(() => {
      settled = true;
    });

    workerResult.reject(failure);
    await flushMicrotasks();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    terminated.resolve();
    await expect(operation).rejects.toBe(failure);
  });

  it("clears timeout and abort listener after a factory throw", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const failure = new Error("worker factory failed");
    const operation = runDisposableWorkerOperation<number>(
      () => {
        throw failure;
      },
      { timeoutMs: 100, signal: controller.signal },
    );

    await expect(operation).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("hard-aborts after start and waits for termination", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const workerResult = deferred<number>();
    const terminated = deferred<void>();
    const terminate = vi.fn(() => terminated.promise);
    let settled = false;
    const operation = runDisposableWorkerOperation(
      () => handle(workerResult.promise, terminate),
      {
        timeoutMs: 100,
        signal: controller.signal,
      },
    );
    void operation.catch(() => {
      settled = true;
    });

    controller.abort();
    await flushMicrotasks();
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    terminated.resolve();
    await expect(operation).rejects.toMatchObject({
      name: "AbortError",
      message: "Disposable worker operation was aborted",
    });
  });

  it("does not start when cancellation wins while attaching the listener", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const originalAdd = signal.addEventListener.bind(signal);
    vi.spyOn(signal, "addEventListener").mockImplementation(
      (type, listener, options) => {
        originalAdd(type, listener, options);
        controller.abort();
      },
    );
    const start = vi.fn();

    await expect(
      runDisposableWorkerOperation(start, {
        timeoutMs: 100,
        signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(start).not.toHaveBeenCalled();
  });

  it("terminates a handle returned after start synchronously aborts", async () => {
    const controller = new AbortController();
    const terminate = vi.fn();
    const result = deferred<number>();
    const operation = runDisposableWorkerOperation(
      () => {
        controller.abort();
        return handle(result.promise, terminate);
      },
      { timeoutMs: 1_000, signal: controller.signal },
    );

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("returns a frozen timeout failure only after termination", async () => {
    vi.useFakeTimers();
    const workerResult = deferred<number>();
    const terminated = deferred<void>();
    const terminate = vi.fn(() => terminated.promise);
    let settled = false;
    const operation = runDisposableWorkerOperation(
      () => handle(workerResult.promise, terminate),
      { timeoutMs: 25 },
    );
    void operation.catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(25);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    terminated.resolve();
    const error = await operation.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DisposableWorkerOperationTimeoutError);
    expect(error).toMatchObject({ timeoutMs: 25 });
    expect(Object.isFrozen(error)).toBe(true);

    workerResult.resolve(42);
    await flushMicrotasks();
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("preserves safe-integer deadlines beyond one platform timer span", async () => {
    vi.useFakeTimers();
    const timeoutMs = 2_147_483_648;
    const terminate = vi.fn();
    const operation = runDisposableWorkerOperation(
      () => handle(new Promise<number>(() => {}), terminate),
      { timeoutMs },
    );
    const captured = operation.catch((caught: unknown) => caught);

    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    const error = await captured;
    expect(error).toBeInstanceOf(DisposableWorkerOperationTimeoutError);
    expect(error).toMatchObject({ timeoutMs });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("keeps success when abort arrives while successful termination is pending", async () => {
    const controller = new AbortController();
    const workerResult = deferred<number>();
    const terminated = deferred<void>();
    const terminate = vi.fn(() => terminated.promise);
    const operation = runDisposableWorkerOperation(
      () => handle(workerResult.promise, terminate),
      { timeoutMs: 1_000, signal: controller.signal },
    );

    workerResult.resolve(7);
    await flushMicrotasks();
    expect(terminate).toHaveBeenCalledTimes(1);
    controller.abort();
    terminated.resolve();

    await expect(operation).resolves.toBe(7);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("keeps abort when a result arrives while aborted termination is pending", async () => {
    const controller = new AbortController();
    const workerResult = deferred<number>();
    const terminated = deferred<void>();
    const terminate = vi.fn(() => terminated.promise);
    const operation = runDisposableWorkerOperation(
      () => handle(workerResult.promise, terminate),
      { timeoutMs: 1_000, signal: controller.signal },
    );

    controller.abort();
    workerResult.resolve(7);
    await flushMicrotasks();
    expect(terminate).toHaveBeenCalledTimes(1);
    terminated.resolve();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful result when termination fails", async () => {
    const terminationFailure = new Error("terminate failed");
    const terminate = vi.fn(() => Promise.reject(terminationFailure));

    await expect(
      runDisposableWorkerOperation(
        () => handle(Promise.resolve(3), terminate),
        { timeoutMs: 1_000 },
      ),
    ).rejects.toBe(terminationFailure);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("preserves primary and termination failures in order", async () => {
    const primary = new Error("decode rejected");
    const termination = new Error("terminate rejected");
    const operation = runDisposableWorkerOperation(
      () =>
        handle(
          Promise.reject(primary),
          () => Promise.reject(termination),
        ),
      { timeoutMs: 1_000 },
    );

    const error = await operation.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([primary, termination]);
  });

  it("retains the frozen timeout inside a termination aggregate", async () => {
    vi.useFakeTimers();
    const termination = new Error("terminate rejected");
    const operation = runDisposableWorkerOperation(
      () =>
        handle(
          new Promise<number>(() => {}),
          () => Promise.reject(termination),
        ),
      { timeoutMs: 10 },
    );
    const captured = operation.catch((caught: unknown) => caught);

    await vi.advanceTimersByTimeAsync(10);
    const error = await captured;
    expect(error).toBeInstanceOf(AggregateError);
    const [timeout, cleanup] = (error as AggregateError).errors;
    expect(timeout).toBeInstanceOf(DisposableWorkerOperationTimeoutError);
    expect(Object.isFrozen(timeout)).toBe(true);
    expect(cleanup).toBe(termination);
  });

  it("adopts hostile thenables once and terminates exactly once", async () => {
    const terminate = vi.fn();
    const thenable = {
      then(
        resolve: (value: number) => void,
        reject: (error: unknown) => void,
      ): void {
        resolve(11);
        reject(new Error("late rejection"));
        resolve(12);
      },
    };

    await expect(
      runDisposableWorkerOperation(
        () => handle(thenable as unknown as PromiseLike<number>, terminate),
        { timeoutMs: 1_000 },
      ),
    ).resolves.toBe(11);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates when reading the handle result throws", async () => {
    const failure = new Error("result getter failed");
    const terminate = vi.fn();
    const workerHandle = {
      get result(): PromiseLike<number> {
        throw failure;
      },
      terminate,
    };

    await expect(
      runDisposableWorkerOperation(() => workerHandle, {
        timeoutMs: 1_000,
      }),
    ).rejects.toBe(failure);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates when reading the result then method throws", async () => {
    const failure = new Error("then getter failed");
    const terminate = vi.fn();
    const result = {
      get then(): never {
        throw failure;
      },
    };

    await expect(
      runDisposableWorkerOperation(
        () =>
          handle(
            result as unknown as PromiseLike<number>,
            terminate,
          ),
        { timeoutMs: 1_000 },
      ),
    ).rejects.toBe(failure);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects a handle without a termination method", async () => {
    await expect(
      runDisposableWorkerOperation(
        () =>
          ({ result: Promise.resolve(1) }) as unknown as
            DisposableWorkerOperationHandle<number>,
        { timeoutMs: 1_000 },
      ),
    ).rejects.toThrow("has no terminate method");
  });

  it("rejects a successful result when termination throws synchronously", async () => {
    const terminationFailure = new Error("terminate threw");

    await expect(
      runDisposableWorkerOperation(
        () =>
          handle(Promise.resolve(3), () => {
            throw terminationFailure;
          }),
        { timeoutMs: 1_000 },
      ),
    ).rejects.toBe(terminationFailure);
  });
});
