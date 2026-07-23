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
  OCCT_ARTIFACT_PROCESS_MAX_OUTPUT_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_REQUEST_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_RESULT_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_TIMEOUT_MS,
  OCCT_ARTIFACT_PROCESS_STARTUP_TIMEOUT_MS,
  encodeOcctArtifactProcessStartEvent,
  parseOcctArtifactProcessResult,
  type OcctArtifactProcessEvidence,
  type OcctArtifactProcessFailure,
  type OcctArtifactProcessOperation,
  type OcctArtifactProcessRequest,
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
  readonly operation: "stall-after-start" | "trap";
}

export type RunOcctArtifactProcessOptions =
  | RunOcctArtifactProcessProduceOptions
  | RunOcctArtifactProcessConsumeOptions
  | RunOcctArtifactProcessFaultOptions;

export interface OcctArtifactProcessProduceOutput {
  readonly evidence: OcctArtifactProcessEvidence;
  readonly artifact: Uint8Array;
}

export interface OcctArtifactProcessConsumeOutput {
  readonly evidence: OcctArtifactProcessEvidence;
}

export type OcctArtifactProcessOutput =
  | OcctArtifactProcessProduceOutput
  | OcctArtifactProcessConsumeOutput;

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
  readonly artifact?: Uint8Array;
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
  readonly operationDeadline: number | undefined;
  readonly killReason: KillReason | undefined;
  readonly spawnError: Error | undefined;
}

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const childPath = fileURLToPath(
  new URL("./test-owned-occt-artifact-process-child.ts", import.meta.url),
);
const textEncoder = new TextEncoder();
const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const abortSignalAddEventListener = AbortSignal.prototype.addEventListener;
const abortSignalRemoveEventListener =
  AbortSignal.prototype.removeEventListener;

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
    operation !== "stall-after-start" &&
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
  if (signal !== undefined && signalAborted(signal)) throw abortError();
  if (operation === "consume") {
    const artifact = options.artifact;
    if (
      !(artifact instanceof Uint8Array) ||
      artifact.byteLength === 0 ||
      artifact.byteLength > maxArtifactBytes
    ) {
      throw new RangeError(
        "consume artifact must be a non-empty Uint8Array within maxArtifactBytes",
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
      // Snapshot before the first await; the caller keeps its original bytes.
      artifact: artifact.slice(),
    });
  }
  if ("artifact" in options) {
    throw new TypeError(
      "Only the consume operation accepts an artifact input",
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
): Promise<ChildCompletion> {
  if (signal !== undefined && signalAborted(signal)) throw abortError();
  const expectedStart = Buffer.from(
    encodeOcctArtifactProcessStartEvent(request.requestId),
    "utf8",
  );
  let stdout = new Uint8Array();
  let stderr = new Uint8Array();
  let started = false;
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
        stdout.byteLength > expectedStart.byteLength ||
        !expectedStart
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
      if (stdout.byteLength === expectedStart.byteLength && !started) {
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
  return Object.freeze({
    status: completion.status,
    signal: completion.signal,
    stderr: new TextDecoder().decode(stderr),
    started,
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
    if (captured.artifact !== undefined) {
      await writeFile(inputArtifactPath, captured.artifact, {
        flag: "wx",
        mode: 0o600,
      });
    }
    const request: OcctArtifactProcessRequest =
      captured.operation === "produce"
        ? {
            protocolVersion: 1,
            requestId,
            operation: "produce",
            runtimeDirectory: captured.runtimeDirectory,
            feature: captured.feature,
            maxArtifactBytes: captured.maxArtifactBytes,
            outputArtifactPath,
          }
        : captured.operation === "consume"
          ? {
              protocolVersion: 1,
              requestId,
              operation: "consume",
              runtimeDirectory: captured.runtimeDirectory,
              feature: captured.feature,
              maxArtifactBytes: captured.maxArtifactBytes,
              inputArtifactPath,
            }
          : {
              protocolVersion: 1,
              requestId,
              operation: captured.operation,
              runtimeDirectory: captured.runtimeDirectory,
              feature: captured.feature,
              maxArtifactBytes: captured.maxArtifactBytes,
            };
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
      !completion.started
    ) {
      throw new OcctArtifactProcessProtocolError(
        childFailureMessage(
          completion,
          "Disposable OCCT artifact process success had invalid exit state",
        ),
      );
    }
    if (captured.operation === "produce") {
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
    if (captured.operation === "consume" && captured.artifact !== undefined) {
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
    throw new OcctArtifactProcessProtocolError(
      "Disposable OCCT artifact fault operation unexpectedly succeeded",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
