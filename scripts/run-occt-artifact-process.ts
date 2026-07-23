import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  constants,
  mkdtemp,
  open,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OCCT_ARTIFACT_PROCESS_MAX_ARTIFACT_BYTES,
  OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_HEADER_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_OUTPUT_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_REQUEST_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_RESULT_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_TIMEOUT_MS,
  OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
  OCCT_ARTIFACT_PROCESS_STARTUP_TIMEOUT_MS,
  OCCT_EVALUATOR_CACHE_PROCESS_MAX_SOLVER_FINGERPRINT_BYTES,
  encodeOcctArtifactProcessStartEvent,
  encodeOcctEvaluatorKernelOperationStartEvent,
  encodeOcctEvaluatorNonYieldingStallStartEvent,
  parseOcctArtifactProcessResult,
  type OcctArtifactProcessEvidence,
  type OcctArtifactProcessFailure,
  type OcctArtifactProcessOperation,
  type OcctArtifactProcessRequest,
  type OcctEvaluatorProcessEvidence,
  type OcctEvaluatorCacheProcessEvidence,
} from "./occt-artifact-process-protocol.js";

interface RunOcctArtifactProcessBase {
  readonly runtimeDirectory: string;
  readonly feature: string;
  readonly maxArtifactBytes: number;
  /** Hard deadline beginning when the verified child reports operation start. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  /** Repository-test lifecycle hook; called after the closed start event. */
  readonly onStarted?: () => void;
  /** Called after evaluator control enters its wrapped native Boolean method. */
  readonly onKernelOperationStarted?: () => void;
  /** Called after the test-only native Boolean returns and before its stall. */
  readonly onNonYieldingStallStarted?: () => void;
}

export interface RunOcctArtifactProcessProduceOptions
  extends RunOcctArtifactProcessBase {
  readonly operation: "produce";
}

export interface RunOcctArtifactProcessConsumeOptions
  extends RunOcctArtifactProcessBase {
  readonly operation: "consume";
  /** Borrowed. The runner snapshots this before its first asynchronous step. */
  readonly artifact: Uint8Array;
}

export interface RunOcctArtifactProcessFaultOptions
  extends RunOcctArtifactProcessBase {
  readonly operation:
    | "stall-during-evaluate"
    | "fail-cleanup-during-evaluate"
    | "trap";
}

export interface RunOcctEvaluatorProcessOptions
  extends RunOcctArtifactProcessBase {
  readonly operation: "evaluate";
}

interface RunOcctEvaluatorCacheProcessBase
  extends RunOcctArtifactProcessBase {
  readonly solverFingerprint: string;
}

export interface RunOcctEvaluatorCacheProcessProduceOptions
  extends RunOcctEvaluatorCacheProcessBase {
  readonly operation: "cache-produce";
}

export interface RunOcctEvaluatorCacheProcessConsumeOptions
  extends RunOcctEvaluatorCacheProcessBase {
  readonly operation: "cache-consume";
  /** Borrowed. The runner snapshots this before its first asynchronous step. */
  readonly cacheRecord: Uint8Array;
}

export type RunOcctArtifactProcessOptions =
  | RunOcctArtifactProcessProduceOptions
  | RunOcctArtifactProcessConsumeOptions
  | RunOcctEvaluatorProcessOptions
  | RunOcctEvaluatorCacheProcessProduceOptions
  | RunOcctEvaluatorCacheProcessConsumeOptions
  | RunOcctArtifactProcessFaultOptions;

export interface OcctArtifactProcessProduceOutput {
  readonly evidence: OcctArtifactProcessEvidence;
  readonly artifact: Uint8Array;
}

export interface OcctArtifactProcessConsumeOutput {
  readonly evidence: OcctArtifactProcessEvidence;
}

export interface OcctEvaluatorProcessOutput {
  readonly evidence: OcctEvaluatorProcessEvidence;
}

export interface OcctEvaluatorCacheProcessProduceOutput {
  readonly evidence: OcctEvaluatorCacheProcessEvidence;
  readonly cacheRecord: Uint8Array;
}

export interface OcctEvaluatorCacheProcessConsumeOutput {
  readonly evidence: OcctEvaluatorCacheProcessEvidence;
}

export type OcctArtifactProcessOutput =
  | OcctArtifactProcessProduceOutput
  | OcctArtifactProcessConsumeOutput
  | OcctEvaluatorProcessOutput
  | OcctEvaluatorCacheProcessProduceOutput
  | OcctEvaluatorCacheProcessConsumeOutput;

export class OcctArtifactProcessProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcctArtifactProcessProtocolError";
  }
}

export class OcctArtifactProcessTimeoutError extends Error {
  readonly phase: "startup" | "operation";
  readonly timeoutMs: number;

  constructor(phase: "startup" | "operation", timeoutMs: number) {
    super(
      `Disposable OCCT artifact process exceeded its ${phase} timeout of ${timeoutMs} ms`,
    );
    this.name = "OcctArtifactProcessTimeoutError";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

export class OcctArtifactProcessChildError extends Error {
  readonly childError: OcctArtifactProcessFailure["error"];

  constructor(error: OcctArtifactProcessFailure["error"]) {
    super(`Disposable OCCT artifact process failed: ${error.message}`);
    this.name = "OcctArtifactProcessChildError";
    this.childError = error;
  }
}

interface CapturedOptions {
  readonly operation: OcctArtifactProcessOperation;
  readonly runtimeDirectory: string;
  readonly feature: string;
  readonly maxArtifactBytes: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly onStarted?: () => void;
  readonly onKernelOperationStarted?: () => void;
  readonly onNonYieldingStallStarted?: () => void;
  readonly artifact?: Uint8Array;
  readonly cacheRecord?: Uint8Array;
  readonly solverFingerprint?: string;
}

type KillReason =
  | { readonly kind: "abort" }
  | {
      readonly kind: "timeout";
      readonly phase: "startup" | "operation";
      readonly timeoutMs: number;
    }
  | { readonly kind: "protocol"; readonly message: string };

interface ChildCompletion {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly started: boolean;
  readonly kernelOperationStarted: boolean;
  readonly nonYieldingStallStarted: boolean;
  readonly stdoutPhase:
    | "none"
    | "operation-started"
    | "kernel-operation-started"
    | "non-yielding-stall-started"
    | "partial";
  readonly operationDeadline: number | undefined;
  readonly killReason: KillReason | undefined;
  readonly spawnError: Error | undefined;
}

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const childPath = fileURLToPath(
  new URL("./test-owned-occt-artifact-process-child.ts", import.meta.url),
);
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });
const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const abortSignalAddEventListener = AbortSignal.prototype.addEventListener;
const abortSignalRemoveEventListener =
  AbortSignal.prototype.removeEventListener;
const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
)?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const uint8ArraySet = Uint8Array.prototype.set;
const sharedArrayBufferByteLengthGetter =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
        SharedArrayBuffer.prototype,
        "byteLength",
      )?.get;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function abortError(): DOMException {
  return new DOMException(
    "Disposable OCCT artifact process was aborted",
    "AbortError",
  );
}

function signalAborted(signal: AbortSignal): boolean {
  if (abortSignalAbortedGetter === undefined) {
    throw new TypeError("AbortSignal aborted getter is unavailable");
  }
  return Reflect.apply(abortSignalAbortedGetter, signal, []) as boolean;
}

function capturedSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) {
    throw new TypeError("signal must be an AbortSignal");
  }
  const signal = value as AbortSignal;
  try {
    signalAborted(signal);
  } catch {
    throw new TypeError("signal must be an AbortSignal");
  }
  return signal;
}

function positiveSafeInteger(
  value: unknown,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function maximumCacheRecordBytes(maxArtifactBytes: number): number {
  return (
    maxArtifactBytes +
    OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_HEADER_BYTES +
    OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES
  );
}

function isSharedArrayBuffer(value: ArrayBufferLike): boolean {
  if (sharedArrayBufferByteLengthGetter === undefined) return false;
  try {
    Reflect.apply(sharedArrayBufferByteLengthGetter, value, []);
    return true;
  } catch {
    return false;
  }
}

function snapshotByteInput(
  value: unknown,
  maximumBytes: number,
  label: string,
): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    typedArrayBufferGetter === undefined ||
    typedArrayByteOffsetGetter === undefined ||
    typedArrayByteLengthGetter === undefined
  ) {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  let buffer: ArrayBufferLike;
  let byteOffset: number;
  let byteLength: number;
  try {
    buffer = Reflect.apply(
      typedArrayBufferGetter,
      value,
      [],
    ) as ArrayBufferLike;
    byteOffset = Reflect.apply(
      typedArrayByteOffsetGetter,
      value,
      [],
    ) as number;
    byteLength = Reflect.apply(
      typedArrayByteLengthGetter,
      value,
      [],
    ) as number;
  } catch {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  if (isSharedArrayBuffer(buffer)) {
    throw new TypeError(`${label} must not use a SharedArrayBuffer`);
  }
  if (
    !Number.isSafeInteger(byteOffset) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > maximumBytes
  ) {
    throw new RangeError(`${label} exceeded its byte limit`);
  }
  try {
    const source = new Uint8Array(buffer, byteOffset, byteLength);
    const snapshot = new Uint8Array(byteLength);
    Reflect.apply(uint8ArraySet, snapshot, [source]);
    return snapshot;
  } catch {
    throw new TypeError(`${label} could not be snapshotted`);
  }
}

function captureOptions(
  options: RunOcctArtifactProcessOptions,
): CapturedOptions {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Disposable OCCT artifact process options are required");
  }
  const operation = options.operation;
  if (
    operation !== "produce" &&
    operation !== "consume" &&
    operation !== "evaluate" &&
    operation !== "cache-produce" &&
    operation !== "cache-consume" &&
    operation !== "stall-during-evaluate" &&
    operation !== "fail-cleanup-during-evaluate" &&
    operation !== "trap"
  ) {
    throw new TypeError("Disposable OCCT artifact process operation is invalid");
  }
  if (
    typeof options.runtimeDirectory !== "string" ||
    options.runtimeDirectory.length === 0 ||
    options.runtimeDirectory.includes("\0")
  ) {
    throw new TypeError("runtimeDirectory must be a non-empty path");
  }
  if (
    typeof options.feature !== "string" ||
    options.feature.length === 0 ||
    textEncoder.encode(options.feature).byteLength > 256
  ) {
    throw new TypeError("feature must be a non-empty bounded string");
  }
  const maxArtifactBytes = positiveSafeInteger(
    options.maxArtifactBytes,
    OCCT_ARTIFACT_PROCESS_MAX_ARTIFACT_BYTES,
    "maxArtifactBytes",
  );
  const timeoutMs = positiveSafeInteger(
    options.timeoutMs,
    OCCT_ARTIFACT_PROCESS_MAX_TIMEOUT_MS,
    "timeoutMs",
  );
  const signal = capturedSignal(options.signal);
  const onStarted = options.onStarted;
  if (onStarted !== undefined && typeof onStarted !== "function") {
    throw new TypeError("onStarted must be a function");
  }
  const onKernelOperationStarted = options.onKernelOperationStarted;
  if (
    onKernelOperationStarted !== undefined &&
    typeof onKernelOperationStarted !== "function"
  ) {
    throw new TypeError("onKernelOperationStarted must be a function");
  }
  const onNonYieldingStallStarted =
    options.onNonYieldingStallStarted;
  if (
    onNonYieldingStallStarted !== undefined &&
    typeof onNonYieldingStallStarted !== "function"
  ) {
    throw new TypeError("onNonYieldingStallStarted must be a function");
  }
  if (signal !== undefined && signalAborted(signal)) throw abortError();
  if (operation === "consume") {
    const artifact = snapshotByteInput(
      options.artifact,
      maxArtifactBytes,
      "consume artifact",
    );
    return Object.freeze({
      operation,
      runtimeDirectory: resolve(options.runtimeDirectory),
      feature: options.feature,
      maxArtifactBytes,
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
      ...(onStarted === undefined ? {} : { onStarted }),
      ...(onKernelOperationStarted === undefined
        ? {}
        : { onKernelOperationStarted }),
      ...(onNonYieldingStallStarted === undefined
        ? {}
        : { onNonYieldingStallStarted }),
      // Snapshot before the first await; the caller keeps its original bytes.
      artifact,
    });
  }
  if (operation === "cache-produce" || operation === "cache-consume") {
    const solverFingerprint = options.solverFingerprint;
    if (
      typeof solverFingerprint !== "string" ||
      solverFingerprint.length === 0 ||
      textEncoder.encode(solverFingerprint).byteLength >
        OCCT_EVALUATOR_CACHE_PROCESS_MAX_SOLVER_FINGERPRINT_BYTES ||
      fatalTextDecoder.decode(textEncoder.encode(solverFingerprint)) !==
        solverFingerprint
    ) {
      throw new TypeError(
        "solverFingerprint must be a non-empty bounded string",
      );
    }
    if ("artifact" in options) {
      throw new TypeError(
        "Evaluator-cache operations do not accept an artifact input",
      );
    }
    if (operation === "cache-consume") {
      const cacheRecord = snapshotByteInput(
        options.cacheRecord,
        maximumCacheRecordBytes(maxArtifactBytes),
        "cache-consume record",
      );
      return Object.freeze({
        operation,
        runtimeDirectory: resolve(options.runtimeDirectory),
        feature: options.feature,
        maxArtifactBytes,
        timeoutMs,
        solverFingerprint,
        ...(signal === undefined ? {} : { signal }),
        ...(onStarted === undefined ? {} : { onStarted }),
        ...(onKernelOperationStarted === undefined
          ? {}
          : { onKernelOperationStarted }),
        ...(onNonYieldingStallStarted === undefined
          ? {}
          : { onNonYieldingStallStarted }),
        // Snapshot before the first await; the caller keeps its original bytes.
        cacheRecord,
      });
    }
    if ("cacheRecord" in options) {
      throw new TypeError(
        "Only cache-consume accepts a cache-record input",
      );
    }
    return Object.freeze({
      operation,
      runtimeDirectory: resolve(options.runtimeDirectory),
      feature: options.feature,
      maxArtifactBytes,
      timeoutMs,
      solverFingerprint,
      ...(signal === undefined ? {} : { signal }),
      ...(onStarted === undefined ? {} : { onStarted }),
      ...(onKernelOperationStarted === undefined
        ? {}
        : { onKernelOperationStarted }),
      ...(onNonYieldingStallStarted === undefined
        ? {}
        : { onNonYieldingStallStarted }),
    });
  }
  if ("artifact" in options) {
    throw new TypeError(
      "Only the consume operation accepts an artifact input",
    );
  }
  if ("cacheRecord" in options || "solverFingerprint" in options) {
    throw new TypeError(
      "Only evaluator-cache operations accept cache-record options",
    );
  }
  return Object.freeze({
    operation,
    runtimeDirectory: resolve(options.runtimeDirectory),
    feature: options.feature,
    maxArtifactBytes,
    timeoutMs,
    ...(signal === undefined ? {} : { signal }),
    ...(onStarted === undefined ? {} : { onStarted }),
    ...(onKernelOperationStarted === undefined
      ? {}
      : { onKernelOperationStarted }),
    ...(onNonYieldingStallStarted === undefined
      ? {}
      : { onNonYieldingStallStarted }),
  });
}

async function readBoundedFile(
  path: string,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  try {
    const stats = await handle.stat();
    if (
      !stats.isFile() ||
      !Number.isSafeInteger(stats.size) ||
      stats.size <= 0 ||
      stats.size > maximumBytes
    ) {
      throw new OcctArtifactProcessProtocolError(
        `${label} is empty, non-regular, or oversized`,
      );
    }
    const output = new Uint8Array(stats.size);
    let offset = 0;
    while (offset < output.byteLength) {
      const { bytesRead } = await handle.read(
        output,
        offset,
        output.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) {
        throw new OcctArtifactProcessProtocolError(
          `${label} was truncated while being read`,
        );
      }
      offset += bytesRead;
    }
    const trailing = new Uint8Array(1);
    const { bytesRead: trailingBytes } = await handle.read(
      trailing,
      0,
      1,
      output.byteLength,
    );
    if (trailingBytes !== 0) {
      throw new OcctArtifactProcessProtocolError(
        `${label} grew while being read`,
      );
    }
    return output;
  } finally {
    await handle.close();
  }
}

function boundedOutput(
  current: Uint8Array,
  addition: Buffer,
  label: "stdout" | "stderr",
): Uint8Array<ArrayBuffer> {
  const nextLength = current.byteLength + addition.byteLength;
  if (nextLength > OCCT_ARTIFACT_PROCESS_MAX_OUTPUT_BYTES) {
    throw new OcctArtifactProcessProtocolError(
      `Disposable OCCT artifact process ${label} exceeded its byte limit`,
    );
  }
  const next = new Uint8Array(new ArrayBuffer(nextLength));
  next.set(current, 0);
  next.set(addition, current.byteLength);
  return next;
}

async function executeChild(
  request: OcctArtifactProcessRequest,
  requestPath: string,
  resultPath: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  onStarted: (() => void) | undefined,
  onKernelOperationStarted: (() => void) | undefined,
  onNonYieldingStallStarted: (() => void) | undefined,
): Promise<ChildCompletion> {
  if (signal !== undefined && signalAborted(signal)) throw abortError();
  const expectedOperationStart = Buffer.from(
    encodeOcctArtifactProcessStartEvent(request.requestId),
    "utf8",
  );
  const expectsKernelOperation =
    request.operation === "evaluate" ||
    request.operation === "stall-during-evaluate" ||
    request.operation === "fail-cleanup-during-evaluate";
  const expectedKernelOperationStart = expectsKernelOperation
    ? Buffer.from(
        encodeOcctEvaluatorKernelOperationStartEvent(
          request.requestId,
          request.operation,
          request.feature,
        ),
        "utf8",
      )
    : Buffer.alloc(0);
  const expectsNonYieldingStall =
    request.operation === "stall-during-evaluate";
  const expectedNonYieldingStallStart = expectsNonYieldingStall
    ? Buffer.from(
        encodeOcctEvaluatorNonYieldingStallStartEvent(
          request.requestId,
          request.feature,
        ),
        "utf8",
      )
    : Buffer.alloc(0);
  const kernelOperationBoundary =
    expectedOperationStart.byteLength +
    expectedKernelOperationStart.byteLength;
  const expectedStdout = Buffer.concat([
    expectedOperationStart,
    expectedKernelOperationStart,
    expectedNonYieldingStallStart,
  ]);
  let stdout = new Uint8Array();
  let stderr = new Uint8Array();
  let started = false;
  let kernelOperationStarted = false;
  let nonYieldingStallStarted = false;
  let operationDeadline: number | undefined;
  let killReason: KillReason | undefined;
  let spawnError: Error | undefined;
  let startupTimer: NodeJS.Timeout | undefined;
  let operationTimer: NodeJS.Timeout | undefined;
  let closed = false;

  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      childPath,
      "--request",
      requestPath,
      "--result",
      resultPath,
    ],
    {
      cwd: projectRoot,
      env: childEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const kill = (reason: KillReason): void => {
    if (killReason !== undefined || closed) return;
    killReason = reason;
    child.kill("SIGKILL");
  };

  const onAbort = (): void => {
    kill({ kind: "abort" });
  };
  if (signal !== undefined) {
    try {
      Reflect.apply(abortSignalAddEventListener, signal, [
        "abort",
        onAbort,
        { once: true },
      ]);
      if (signalAborted(signal)) onAbort();
    } catch (error) {
      kill({
        kind: "protocol",
        message:
          error instanceof Error
            ? `Disposable OCCT artifact process could not observe abort: ${error.message}`
            : "Disposable OCCT artifact process could not observe abort",
      });
    }
  }

  startupTimer = setTimeout(
    () =>
      kill({
        kind: "timeout",
        phase: "startup",
        timeoutMs: OCCT_ARTIFACT_PROCESS_STARTUP_TIMEOUT_MS,
      }),
    OCCT_ARTIFACT_PROCESS_STARTUP_TIMEOUT_MS,
  );

  child.stdout.on("data", (chunk: Buffer) => {
    try {
      stdout = boundedOutput(stdout, chunk, "stdout");
      if (
        stdout.byteLength > expectedStdout.byteLength ||
        !expectedStdout
          .subarray(0, stdout.byteLength)
          .equals(Buffer.from(stdout))
      ) {
        kill({
          kind: "protocol",
          message:
            "Disposable OCCT artifact process emitted malformed stdout",
        });
        return;
      }
      if (stdout.byteLength >= expectedOperationStart.byteLength && !started) {
        started = true;
        operationDeadline = performance.now() + timeoutMs;
        if (startupTimer !== undefined) clearTimeout(startupTimer);
        startupTimer = undefined;
        operationTimer = setTimeout(
          () =>
            kill({
              kind: "timeout",
              phase: "operation",
              timeoutMs,
            }),
          timeoutMs,
        );
        try {
          onStarted?.();
        } catch (error) {
          kill({
            kind: "protocol",
            message:
              error instanceof Error
                ? `Disposable OCCT artifact process onStarted hook failed: ${error.message}`
                : "Disposable OCCT artifact process onStarted hook failed",
          });
        }
      }
      if (
        expectsKernelOperation &&
        stdout.byteLength >= kernelOperationBoundary &&
        !kernelOperationStarted
      ) {
        kernelOperationStarted = true;
        try {
          onKernelOperationStarted?.();
        } catch (error) {
          kill({
            kind: "protocol",
            message:
              error instanceof Error
                ? `Disposable OCCT evaluator process onKernelOperationStarted hook failed: ${error.message}`
                : "Disposable OCCT evaluator process onKernelOperationStarted hook failed",
          });
        }
      }
      if (
        expectsNonYieldingStall &&
        stdout.byteLength === expectedStdout.byteLength &&
        !nonYieldingStallStarted
      ) {
        nonYieldingStallStarted = true;
        try {
          onNonYieldingStallStarted?.();
        } catch (error) {
          kill({
            kind: "protocol",
            message:
              error instanceof Error
                ? `Disposable OCCT evaluator process onNonYieldingStallStarted hook failed: ${error.message}`
                : "Disposable OCCT evaluator process onNonYieldingStallStarted hook failed",
          });
        }
      }
    } catch (error) {
      kill({
        kind: "protocol",
        message:
          error instanceof Error
            ? error.message
            : "Disposable OCCT artifact process stdout could not be captured",
      });
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    try {
      stderr = boundedOutput(stderr, chunk, "stderr");
    } catch (error) {
      kill({
        kind: "protocol",
        message:
          error instanceof Error
            ? error.message
            : "Disposable OCCT artifact process stderr could not be captured",
      });
    }
  });
  child.on("error", (error) => {
    spawnError = error;
  });

  const completion = await new Promise<{
    readonly status: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolveCompletion) => {
    let settled = false;
    child.once("close", (status, childSignal) => {
      if (settled) return;
      settled = true;
      closed = true;
      resolveCompletion({ status, signal: childSignal });
    });
  });

  if (startupTimer !== undefined) clearTimeout(startupTimer);
  if (operationTimer !== undefined) clearTimeout(operationTimer);
  if (signal !== undefined) {
    try {
      Reflect.apply(abortSignalRemoveEventListener, signal, [
        "abort",
        onAbort,
      ]);
    } catch (error) {
      if (killReason === undefined) {
        killReason = {
          kind: "protocol",
          message:
            error instanceof Error
              ? `Disposable OCCT artifact process could not release its abort observer: ${error.message}`
              : "Disposable OCCT artifact process could not release its abort observer",
        };
      }
    }
  }
  const stdoutPhase =
    stdout.byteLength === 0
      ? "none"
      : stdout.byteLength === expectedOperationStart.byteLength
        ? "operation-started"
        : expectsKernelOperation &&
            stdout.byteLength === kernelOperationBoundary
          ? "kernel-operation-started"
          : expectsNonYieldingStall &&
              stdout.byteLength === expectedStdout.byteLength
            ? "non-yielding-stall-started"
            : "partial";
  return Object.freeze({
    status: completion.status,
    signal: completion.signal,
    stderr: new TextDecoder().decode(stderr),
    started,
    kernelOperationStarted,
    nonYieldingStallStarted,
    stdoutPhase,
    operationDeadline,
    killReason,
    spawnError,
  });
}

function childEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
  ]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function childFailureMessage(
  completion: ChildCompletion,
  label: string,
): string {
  const suffix =
    completion.stderr.length === 0
      ? ""
      : `; stderr: ${completion.stderr.slice(0, 4_096)}`;
  return `${label} (status ${String(completion.status)}, signal ${String(
    completion.signal,
  )})${suffix}`;
}

export function runOcctArtifactProcess(
  options: RunOcctArtifactProcessProduceOptions,
): Promise<OcctArtifactProcessProduceOutput>;
export function runOcctArtifactProcess(
  options: RunOcctArtifactProcessConsumeOptions,
): Promise<OcctArtifactProcessConsumeOutput>;
export function runOcctArtifactProcess(
  options: RunOcctEvaluatorProcessOptions,
): Promise<OcctEvaluatorProcessOutput>;
export function runOcctArtifactProcess(
  options: RunOcctEvaluatorCacheProcessProduceOptions,
): Promise<OcctEvaluatorCacheProcessProduceOutput>;
export function runOcctArtifactProcess(
  options: RunOcctEvaluatorCacheProcessConsumeOptions,
): Promise<OcctEvaluatorCacheProcessConsumeOutput>;
export function runOcctArtifactProcess(
  options: RunOcctArtifactProcessFaultOptions,
): Promise<never>;
export async function runOcctArtifactProcess(
  options: RunOcctArtifactProcessOptions,
): Promise<OcctArtifactProcessOutput> {
  const captured = captureOptions(options);
  const requestId = randomBytes(16).toString("hex");
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "invariantcad-occt-artifact-process-"),
  );
  try {
    const requestPath = join(temporaryDirectory, "request.json");
    const resultPath = join(temporaryDirectory, "result.json");
    const inputArtifactPath = join(temporaryDirectory, "input.artifact");
    const outputArtifactPath = join(temporaryDirectory, "output.artifact");
    const inputCacheRecordPath = join(
      temporaryDirectory,
      "input.cache-record",
    );
    const outputCacheRecordPath = join(
      temporaryDirectory,
      "output.cache-record",
    );
    if (captured.artifact !== undefined) {
      await writeFile(inputArtifactPath, captured.artifact, {
        flag: "wx",
        mode: 0o600,
      });
    }
    if (captured.cacheRecord !== undefined) {
      await writeFile(inputCacheRecordPath, captured.cacheRecord, {
        flag: "wx",
        mode: 0o600,
      });
    }
    const requestBase = {
      protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
      requestId,
      runtimeDirectory: captured.runtimeDirectory,
      feature: captured.feature,
      maxArtifactBytes: captured.maxArtifactBytes,
    } as const;
    let request: OcctArtifactProcessRequest;
    if (captured.operation === "produce") {
      request = {
        ...requestBase,
        operation: "produce",
        outputArtifactPath,
      };
    } else if (captured.operation === "consume") {
      request = {
        ...requestBase,
        operation: "consume",
        inputArtifactPath,
      };
    } else if (
      captured.operation === "cache-produce" &&
      captured.solverFingerprint !== undefined
    ) {
      request = {
        ...requestBase,
        operation: "cache-produce",
        solverFingerprint: captured.solverFingerprint,
        outputCacheRecordPath,
      };
    } else if (
      captured.operation === "cache-consume" &&
      captured.solverFingerprint !== undefined
    ) {
      request = {
        ...requestBase,
        operation: "cache-consume",
        solverFingerprint: captured.solverFingerprint,
        inputCacheRecordPath,
      };
    } else if (
      captured.operation === "cache-produce" ||
      captured.operation === "cache-consume"
    ) {
      throw new OcctArtifactProcessProtocolError(
        "Captured evaluator-cache request lost its solver fingerprint",
      );
    } else {
      request = {
        ...requestBase,
        operation: captured.operation,
      };
    }
    const requestBytes = textEncoder.encode(JSON.stringify(request));
    if (requestBytes.byteLength > OCCT_ARTIFACT_PROCESS_MAX_REQUEST_BYTES) {
      throw new OcctArtifactProcessProtocolError(
        "Disposable OCCT artifact process request exceeded its byte limit",
      );
    }
    await writeFile(requestPath, requestBytes, {
      flag: "wx",
      mode: 0o600,
    });
    if (
      captured.signal !== undefined &&
      signalAborted(captured.signal)
    ) {
      throw abortError();
    }

    const completion = await executeChild(
      request,
      requestPath,
      resultPath,
      captured.timeoutMs,
      captured.signal,
      captured.onStarted,
      captured.onKernelOperationStarted,
      captured.onNonYieldingStallStarted,
    );
    if (completion.killReason?.kind === "abort") throw abortError();
    if (completion.killReason?.kind === "timeout") {
      throw new OcctArtifactProcessTimeoutError(
        completion.killReason.phase,
        completion.killReason.timeoutMs,
      );
    }
    if (completion.killReason?.kind === "protocol") {
      throw new OcctArtifactProcessProtocolError(
        completion.killReason.message,
      );
    }
    if (completion.spawnError !== undefined) {
      throw new OcctArtifactProcessProtocolError(
        `Disposable OCCT artifact process could not start: ${completion.spawnError.message}`,
      );
    }
    const assertParentPhaseActive = (): void => {
      if (
        captured.signal !== undefined &&
        signalAborted(captured.signal)
      ) {
        throw abortError();
      }
      if (
        completion.operationDeadline !== undefined &&
        performance.now() >= completion.operationDeadline
      ) {
        throw new OcctArtifactProcessTimeoutError(
          "operation",
          captured.timeoutMs,
        );
      }
    };
    assertParentPhaseActive();

    let rawResult: unknown;
    try {
      const resultBytes = await readBoundedFile(
        resultPath,
        OCCT_ARTIFACT_PROCESS_MAX_RESULT_BYTES,
        "Disposable OCCT artifact process result",
      );
      assertParentPhaseActive();
      rawResult = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        resultBytes,
      )) as unknown;
      assertParentPhaseActive();
    } catch (error) {
      if (
        error instanceof OcctArtifactProcessProtocolError ||
        error instanceof OcctArtifactProcessTimeoutError ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw error;
      }
      throw new OcctArtifactProcessProtocolError(
        childFailureMessage(
          completion,
          error instanceof Error
            ? `Disposable OCCT artifact process returned no valid result: ${error.message}`
            : "Disposable OCCT artifact process returned no valid result",
        ),
      );
    }
    let result: ReturnType<typeof parseOcctArtifactProcessResult>;
    try {
      result = parseOcctArtifactProcessResult(rawResult);
    } catch (error) {
      throw new OcctArtifactProcessProtocolError(
        error instanceof Error
          ? `Disposable OCCT artifact process result was malformed: ${error.message}`
          : "Disposable OCCT artifact process result was malformed",
      );
    }
    if (
      result.requestId !== requestId ||
      result.operation !== captured.operation
    ) {
      throw new OcctArtifactProcessProtocolError(
        "Disposable OCCT artifact process result did not match its request",
      );
    }
    if (!result.ok) {
      if (completion.stdoutPhase === "partial") {
        throw new OcctArtifactProcessProtocolError(
          childFailureMessage(
            completion,
            "Disposable OCCT artifact process failure ended with an incomplete stdout event",
          ),
        );
      }
      if (completion.status === 0 || completion.signal !== null) {
        throw new OcctArtifactProcessProtocolError(
          childFailureMessage(
            completion,
            "Disposable OCCT artifact process failure had invalid exit state",
          ),
        );
      }
      throw new OcctArtifactProcessChildError(result.error);
    }
    if (
      completion.status !== 0 ||
      completion.signal !== null ||
      !completion.started ||
      ((captured.operation === "evaluate" ||
        captured.operation === "stall-during-evaluate" ||
        captured.operation === "fail-cleanup-during-evaluate") &&
        !completion.kernelOperationStarted)
    ) {
      throw new OcctArtifactProcessProtocolError(
        childFailureMessage(
          completion,
          "Disposable OCCT artifact process success had invalid exit state",
        ),
      );
    }
    if (
      (result.operation === "cache-produce" ||
        result.operation === "cache-consume") &&
      (result.evidence.feature !== captured.feature ||
        result.evidence.solverFingerprint !==
          captured.solverFingerprint)
    ) {
      throw new OcctArtifactProcessProtocolError(
        "Disposable OCCT evaluator-cache evidence did not match its request",
      );
    }
    if (captured.operation === "produce" && result.operation === "produce") {
      const artifact = await readBoundedFile(
        outputArtifactPath,
        captured.maxArtifactBytes,
        "Disposable OCCT artifact process output artifact",
      );
      assertParentPhaseActive();
      if (
        artifact.byteLength !== result.evidence.artifact.byteLength ||
        sha256(artifact) !== result.evidence.artifact.sha256
      ) {
        throw new OcctArtifactProcessProtocolError(
          "Disposable OCCT artifact process output evidence did not match its bytes",
        );
      }
      assertParentPhaseActive();
      return Object.freeze({
        evidence: result.evidence,
        artifact,
      });
    }
    if (
      captured.operation === "consume" &&
      captured.artifact !== undefined &&
      result.operation === "consume"
    ) {
      if (
        captured.artifact.byteLength !== result.evidence.artifact.byteLength ||
        sha256(captured.artifact) !== result.evidence.artifact.sha256
      ) {
        throw new OcctArtifactProcessProtocolError(
          "Disposable OCCT artifact process input evidence did not match its snapshot",
        );
      }
      assertParentPhaseActive();
      return Object.freeze({ evidence: result.evidence });
    }
    if (
      captured.operation === "cache-produce" &&
      result.operation === "cache-produce"
    ) {
      const cacheRecord = await readBoundedFile(
        outputCacheRecordPath,
        maximumCacheRecordBytes(captured.maxArtifactBytes),
        "Disposable OCCT evaluator-cache output record",
      );
      assertParentPhaseActive();
      if (
        cacheRecord.byteLength !== result.evidence.cache.record.byteLength ||
        sha256(cacheRecord) !== result.evidence.cache.record.sha256
      ) {
        throw new OcctArtifactProcessProtocolError(
          "Disposable OCCT evaluator-cache output evidence did not match its record bytes",
        );
      }
      assertParentPhaseActive();
      return Object.freeze({
        evidence: result.evidence,
        cacheRecord,
      });
    }
    if (
      captured.operation === "cache-consume" &&
      captured.cacheRecord !== undefined &&
      result.operation === "cache-consume"
    ) {
      if (
        captured.cacheRecord.byteLength !==
          result.evidence.cache.record.byteLength ||
        sha256(captured.cacheRecord) !==
          result.evidence.cache.record.sha256
      ) {
        throw new OcctArtifactProcessProtocolError(
          "Disposable OCCT evaluator-cache input evidence did not match its snapshot",
        );
      }
      assertParentPhaseActive();
      return Object.freeze({ evidence: result.evidence });
    }
    if (captured.operation === "evaluate" && result.operation === "evaluate") {
      assertParentPhaseActive();
      return Object.freeze({ evidence: result.evidence });
    }
    throw new OcctArtifactProcessProtocolError(
      "Disposable OCCT artifact fault operation unexpectedly succeeded",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
