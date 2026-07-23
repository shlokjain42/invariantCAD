import { createHash } from "node:crypto";
import {
  constants,
  open,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectKernelShapeArtifactSupport } from "../src/artifact-cache.js";
import { hashKernelShapeSemanticObservation } from "../src/conformance.js";
import { getOcctShapeArtifactCodecCandidate } from "../src/internal/occt-artifact-candidate.js";
import type {
  GeometryKernel,
  KernelShape,
} from "../src/kernel.js";
import {
  createOcctKernel,
  type OcctModuleFactory,
} from "../src/occt-kernel.js";
import {
  observeKernelShapeSemantics,
  type KernelShapeSemanticObservationPlan,
} from "../src/shape-semantic-observation.js";
import {
  OCCT_ARTIFACT_PROCESS_MAX_REQUEST_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_RESULT_BYTES,
  encodeOcctArtifactProcessStartEvent,
  parseOcctArtifactProcessRequest,
  type OcctArtifactProcessArtifactEvidence,
  type OcctArtifactProcessCapabilityEvidence,
  type OcctArtifactProcessErrorCode,
  type OcctArtifactProcessEvidence,
  type OcctArtifactProcessRequest,
  type OcctArtifactProcessResult,
  type OcctArtifactProcessRuntimeEvidence,
} from "./occt-artifact-process-protocol.js";

interface RuntimePin {
  readonly fileName: "occt-wasm.js" | "occt-wasm.wasm";
  readonly size: number;
  readonly sha256: string;
}

interface TrustedReleaseInput {
  readonly facadeMarker: string;
  readonly javascript: RuntimePin;
  readonly webAssembly: RuntimePin;
}

interface LoadedRuntime {
  readonly moduleFactory: OcctModuleFactory;
  readonly wasm: Uint8Array;
  readonly evidence: OcctArtifactProcessRuntimeEvidence;
  readonly assertUsed: () => void;
  readonly cleanup: () => Promise<void>;
}

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const releaseInputPath = resolve(
  projectRoot,
  "native/occt/bundle/release-input.json",
);
const maximumReleaseInputBytes = 256 * 1024;
const maximumJavascriptBytes = 4 * 1024 * 1024;
const maximumWebAssemblyBytes = 256 * 1024 * 1024;
const maximumObservationBytes = 16 * 1024 * 1024;
const sha256Pattern = /^[0-9a-f]{64}$/u;

class InjectedTrapError extends WebAssembly.RuntimeError {
  constructor() {
    super("Injected OCCT artifact process trap");
    this.name = "WebAssembly.RuntimeError";
  }
}

class OcctArtifactProcessCleanupError extends AggregateError {
  constructor(errors: readonly unknown[]) {
    super(errors, "OCCT artifact process cleanup failed");
    this.name = "OcctArtifactProcessCleanupError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function runtimePin(
  value: unknown,
  fileName: RuntimePin["fileName"],
  mediaType: "text/javascript" | "application/wasm",
  maximumBytes: number,
): RuntimePin {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["source", "target", "mediaType", "size", "sha256"]) ||
    value.source !== fileName ||
    value.target !== `runtime/${fileName}` ||
    value.mediaType !== mediaType ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > maximumBytes ||
    typeof value.sha256 !== "string" ||
    !sha256Pattern.test(value.sha256)
  ) {
    throw new TypeError(`Trusted ${fileName} release input is malformed`);
  }
  return Object.freeze({
    fileName,
    size: value.size,
    sha256: value.sha256,
  });
}

function trustedReleaseInput(value: unknown): TrustedReleaseInput {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "bundle",
      "archive",
      "facade",
      "runtime",
      "inputs",
    ]) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.facade) ||
    !exactKeys(value.facade, [
      "marker",
      "abiVersion",
      "upstreamOcctWasmVersion",
    ]) ||
    typeof value.facade.marker !== "string" ||
    value.facade.marker.length === 0 ||
    value.facade.abiVersion !== "0.9.0" ||
    value.facade.upstreamOcctWasmVersion !== "3.7.0" ||
    !Array.isArray(value.runtime) ||
    value.runtime.length !== 2
  ) {
    throw new TypeError("Trusted OCCT facade release input is malformed");
  }
  const entries = new Map<string, unknown>();
  for (const entry of value.runtime) {
    if (
      !isRecord(entry) ||
      typeof entry.source !== "string" ||
      entries.has(entry.source)
    ) {
      throw new TypeError("Trusted OCCT facade runtime inventory is malformed");
    }
    entries.set(entry.source, entry);
  }
  return Object.freeze({
    facadeMarker: value.facade.marker,
    javascript: runtimePin(
      entries.get("occt-wasm.js"),
      "occt-wasm.js",
      "text/javascript",
      maximumJavascriptBytes,
    ),
    webAssembly: runtimePin(
      entries.get("occt-wasm.wasm"),
      "occt-wasm.wasm",
      "application/wasm",
      maximumWebAssemblyBytes,
    ),
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
      throw new RangeError(`${label} is empty, non-regular, or oversized`);
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
        throw new TypeError(`${label} was truncated while being read`);
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
      throw new TypeError(`${label} grew while being read`);
    }
    return output;
  } finally {
    await handle.close();
  }
}

async function parseJsonFile(
  path: string,
  maximumBytes: number,
  label: string,
): Promise<unknown> {
  const bytes = await readBoundedFile(path, maximumBytes, label);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

async function verifiedRuntime(
  runtimeDirectory: string,
  scratchDirectory: string,
): Promise<LoadedRuntime> {
  const releaseInput = trustedReleaseInput(
    await parseJsonFile(
      releaseInputPath,
      maximumReleaseInputBytes,
      "Trusted OCCT facade release input",
    ),
  );
  const javascriptPath = resolve(
    runtimeDirectory,
    releaseInput.javascript.fileName,
  );
  const webAssemblyPath = resolve(
    runtimeDirectory,
    releaseInput.webAssembly.fileName,
  );
  // Each runtime file is read exactly once. Only these verified buffers become
  // execution inputs below.
  const [javascript, webAssembly] = await Promise.all([
    readBoundedFile(
      javascriptPath,
      releaseInput.javascript.size,
      "Owned OCCT JavaScript runtime",
    ),
    readBoundedFile(
      webAssemblyPath,
      releaseInput.webAssembly.size,
      "Owned OCCT WebAssembly runtime",
    ),
  ]);
  if (
    javascript.byteLength !== releaseInput.javascript.size ||
    sha256(javascript) !== releaseInput.javascript.sha256 ||
    webAssembly.byteLength !== releaseInput.webAssembly.size ||
    sha256(webAssembly) !== releaseInput.webAssembly.sha256
  ) {
    throw new TypeError(
      "Owned OCCT runtime bytes do not match trusted release input",
    );
  }

  const privateJavascriptPath = join(
    scratchDirectory,
    "verified-occt-wasm.mjs",
  );
  try {
    await writeFile(privateJavascriptPath, javascript, {
      flag: "wx",
      mode: 0o600,
    });
    const imported = await import(pathToFileURL(privateJavascriptPath).href) as {
      readonly default?: unknown;
    };
    if (typeof imported.default !== "function") {
      throw new TypeError(
        "Verified owned OCCT JavaScript did not export a module factory",
      );
    }
    const verifiedFactory = imported.default as OcctModuleFactory;
    let factoryCalls = 0;
    let verifiedWasmWasPassed = false;
    const moduleFactory: OcctModuleFactory = async (options) => {
      factoryCalls += 1;
      if (
        factoryCalls !== 1 ||
        options === undefined ||
        !(options.wasmBinary instanceof ArrayBuffer)
      ) {
        throw new TypeError(
          "Owned OCCT module factory did not receive one wasmBinary input",
        );
      }
      const passedWasm = new Uint8Array(options.wasmBinary);
      if (
        passedWasm.byteLength !== releaseInput.webAssembly.size ||
        sha256(passedWasm) !== releaseInput.webAssembly.sha256
      ) {
        throw new TypeError(
          "Owned OCCT module factory received unverified WebAssembly bytes",
        );
      }
      verifiedWasmWasPassed = true;
      const module = await verifiedFactory(options);
      if (
        !isRecord(module) ||
        typeof module.invariantcadFacadeVersion !== "function" ||
        Reflect.apply(
          module.invariantcadFacadeVersion as (...arguments_: unknown[]) => unknown,
          module,
          [],
        ) !== releaseInput.facadeMarker
      ) {
        throw new TypeError(
          "Owned OCCT facade marker does not match trusted release input",
        );
      }
      return module;
    };
    const evidence: OcctArtifactProcessRuntimeEvidence = Object.freeze({
      releaseInput: "native/occt/bundle/release-input.json",
      facadeMarker: releaseInput.facadeMarker,
      javascript: Object.freeze({
        fileName: "occt-wasm.js",
        byteLength: releaseInput.javascript.size,
        sha256: releaseInput.javascript.sha256,
      }),
      webAssembly: Object.freeze({
        fileName: "occt-wasm.wasm",
        byteLength: releaseInput.webAssembly.size,
        sha256: releaseInput.webAssembly.sha256,
      }),
      verifiedBytesWereExecutionInputs: true,
    });
    return Object.freeze({
      moduleFactory,
      wasm: Uint8Array.from(webAssembly),
      evidence,
      assertUsed: () => {
        if (factoryCalls !== 1 || !verifiedWasmWasPassed) {
          throw new TypeError(
            "Verified owned OCCT runtime inputs were not executed exactly once",
          );
        }
      },
      cleanup: () => rm(privateJavascriptPath, { force: true }),
    });
  } catch (error) {
    await rm(privateJavascriptPath, { force: true });
    throw error;
  }
}

function candidateCapabilities(
  kernel: GeometryKernel,
): {
  readonly codec: NonNullable<
    ReturnType<typeof getOcctShapeArtifactCodecCandidate>
  >;
  readonly evidence: OcctArtifactProcessCapabilityEvidence;
} {
  if (
    inspectKernelShapeArtifactSupport(kernel).status !== "absent" ||
    kernel.capabilities.shapeArtifacts !== undefined ||
    kernel.encodeShapeArtifact !== undefined ||
    kernel.decodeShapeArtifact !== undefined
  ) {
    throw new TypeError(
      "Owned OCCT process-gate kernel unexpectedly advertised shape artifacts",
    );
  }
  const codec = getOcctShapeArtifactCodecCandidate(kernel);
  if (
    codec === undefined ||
    codec.capabilities.protocolVersion !== 1 ||
    codec.capabilities.format !== "org.invariantcad.occt-shape-candidate" ||
    codec.capabilities.formatVersion !== 2
  ) {
    throw new TypeError(
      "Owned OCCT process-gate candidate codec is unavailable or malformed",
    );
  }
  return Object.freeze({
    codec,
    evidence: Object.freeze({
      protocolVersion: 1,
      format: "org.invariantcad.occt-shape-candidate",
      formatVersion: 2,
      compatibilityFingerprint:
        codec.capabilities.compatibilityFingerprint,
    }),
  });
}

async function semanticWitness(
  kernel: GeometryKernel,
  shape: KernelShape,
): Promise<string> {
  const notApplicableFeatures = Object.freeze(
    kernel.capabilities.features.map((feature) =>
      Object.freeze({
        feature,
        reason:
          "The private process gate observes direct artifact state; downstream feature behavior is outside this bounded operation.",
      })),
  );
  const plan: KernelShapeSemanticObservationPlan = Object.freeze({
    id: "occt-artifact-process-gate-v1",
    meshes: Object.freeze([{ id: "default" }]),
    topology: "required",
    nativeExchanges: Object.freeze([]),
    probes: Object.freeze([]),
    notApplicableFeatures,
  });
  const observation = await observeKernelShapeSemantics(
    kernel,
    shape,
    plan,
    { limits: { maxObservationBytes: maximumObservationBytes } },
  );
  if (!observation.ok) {
    throw new Error(
      `OCCT artifact process semantic observation failed: ${JSON.stringify(
        observation.diagnostics,
      )}`,
    );
  }
  const witness = await hashKernelShapeSemanticObservation(
    observation.value,
    { maxBytes: maximumObservationBytes },
  );
  if (!witness.ok) {
    throw new Error(
      `OCCT artifact process semantic witness failed: ${JSON.stringify(
        witness.diagnostics,
      )}`,
    );
  }
  return witness.value;
}

async function flushStartEvent(requestId: string): Promise<void> {
  const event = encodeOcctArtifactProcessStartEvent(requestId);
  await new Promise<void>((resolveWrite, rejectWrite) => {
    process.stdout.write(event, (error) => {
      if (error === null || error === undefined) resolveWrite();
      else rejectWrite(error);
    });
  });
}

function artifactEvidence(
  artifact: Uint8Array,
): OcctArtifactProcessArtifactEvidence {
  return Object.freeze({
    byteLength: artifact.byteLength,
    sha256: sha256(artifact),
  });
}

async function execute(
  request: OcctArtifactProcessRequest,
  scratchDirectory: string,
): Promise<OcctArtifactProcessEvidence> {
  const runtime = await verifiedRuntime(
    request.runtimeDirectory,
    scratchDirectory,
  );
  let kernel: GeometryKernel | undefined;
  let shape: KernelShape | undefined;
  let pending:
    | Omit<OcctArtifactProcessEvidence, "cleanupCompletedBeforeResponse">
    | undefined;
  let operationError: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    kernel = await createOcctKernel({
      moduleFactory: runtime.moduleFactory,
      wasm: runtime.wasm,
      onOutput: () => {},
      onError: () => {},
    });
    runtime.assertUsed();
    const candidate = candidateCapabilities(kernel);
    await flushStartEvent(request.requestId);
    if (request.operation === "stall-after-start") {
      const lock = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(lock, 0, 0);
      throw new Error("Injected OCCT artifact stall unexpectedly returned");
    }
    if (request.operation === "trap") {
      throw new InjectedTrapError();
    }

    let artifact: Uint8Array;
    if (request.operation === "produce") {
      if (kernel.box === undefined) {
        throw new TypeError("Owned OCCT box primitive is unavailable");
      }
      shape = kernel.box([2, 3, 5], false, { feature: request.feature });
      artifact = candidate.codec.encodeShapeArtifact(shape, {
        feature: request.feature,
        maxArtifactBytes: request.maxArtifactBytes,
      });
      if (
        !(artifact instanceof Uint8Array) ||
        artifact.byteLength === 0 ||
        artifact.byteLength > request.maxArtifactBytes
      ) {
        throw new TypeError(
          "Owned OCCT candidate produced invalid artifact bytes",
        );
      }
      await writeFile(request.outputArtifactPath, artifact, {
        flag: "wx",
        mode: 0o600,
      });
    } else if (request.operation === "consume") {
      artifact = await readBoundedFile(
        request.inputArtifactPath,
        request.maxArtifactBytes,
        "OCCT artifact process input",
      );
      shape = candidate.codec.decodeShapeArtifact(artifact, {
        feature: request.feature,
        maxArtifactBytes: request.maxArtifactBytes,
      });
    } else {
      throw new TypeError(
        "OCCT artifact fault operation unexpectedly reached artifact work",
      );
    }
    const witness = await semanticWitness(kernel, shape);
    pending = Object.freeze({
      kind: "invariantcad-private-occt-artifact-process-evidence",
      evidenceVersion: 1,
      operation: request.operation,
      executionBoundary: "one-shot-node-child-process",
      advertisement: "unadvertised",
      shapeArtifactsAbsent: true,
      certifiesCompatibility: false,
      runtime: runtime.evidence,
      capabilities: candidate.evidence,
      artifact: artifactEvidence(artifact),
      semanticWitness: witness,
    });
  } catch (error) {
    operationError = error;
  } finally {
    if (shape !== undefined && kernel !== undefined) {
      try {
        kernel.disposeShape(shape);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (kernel !== undefined) {
      try {
        kernel.dispose();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await runtime.cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new OcctArtifactProcessCleanupError(
      [
        ...(operationError === undefined ? [] : [operationError]),
        ...cleanupErrors,
      ],
    );
  }
  if (operationError !== undefined) throw operationError;
  if (pending === undefined) {
    throw new TypeError("OCCT artifact process produced no evidence");
  }
  return Object.freeze({
    ...pending,
    cleanupCompletedBeforeResponse: true,
  });
}

function boundedErrorText(value: unknown, fallback: string): string {
  const source =
    typeof value === "string" && value.length > 0 ? value : fallback;
  let end = Math.min(source.length, 4_096);
  while (
    end > 0 &&
    new TextEncoder().encode(source.slice(0, end)).byteLength > 4_096
  ) {
    end -= 1;
  }
  return source.slice(0, Math.max(1, end));
}

function errorResult(
  request: OcctArtifactProcessRequest,
  error: unknown,
): OcctArtifactProcessResult {
  const cleanupFailure = error instanceof OcctArtifactProcessCleanupError;
  const code: OcctArtifactProcessErrorCode =
    cleanupFailure
      ? "CLEANUP_FAILED"
      : error instanceof InjectedTrapError
        ? "INJECTED_TRAP"
        : "OPERATION_FAILED";
  return Object.freeze({
    protocolVersion: 1,
    requestId: request.requestId,
    operation: request.operation,
    ok: false,
    error: Object.freeze({
      code,
      name: boundedErrorText(
        error instanceof Error ? error.name : undefined,
        "Error",
      ),
      message: boundedErrorText(
        error instanceof Error ? error.message : String(error),
        "OCCT artifact process failed",
      ),
    }),
  });
}

function commandPaths(arguments_: readonly string[]): {
  readonly requestPath: string;
  readonly resultPath: string;
} {
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== "--request" ||
    arguments_[2] !== "--result" ||
    typeof arguments_[1] !== "string" ||
    typeof arguments_[3] !== "string" ||
    !isAbsolute(arguments_[1]) ||
    !isAbsolute(arguments_[3])
  ) {
    throw new Error(
      "Usage: test-owned-occt-artifact-process-child.ts --request ABSOLUTE_PATH --result ABSOLUTE_PATH",
    );
  }
  return Object.freeze({
    requestPath: arguments_[1],
    resultPath: arguments_[3],
  });
}

async function writeResult(
  path: string,
  result: OcctArtifactProcessResult,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(result));
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > OCCT_ARTIFACT_PROCESS_MAX_RESULT_BYTES
  ) {
    throw new RangeError("OCCT artifact process result exceeded its byte limit");
  }
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
}

async function main(): Promise<void> {
  const paths = commandPaths(process.argv.slice(2));
  const request = parseOcctArtifactProcessRequest(
    await parseJsonFile(
      paths.requestPath,
      OCCT_ARTIFACT_PROCESS_MAX_REQUEST_BYTES,
      "OCCT artifact process request",
    ),
  );
  let result: OcctArtifactProcessResult;
  try {
    const evidence = await execute(request, dirname(paths.requestPath));
    if (request.operation !== "produce" && request.operation !== "consume") {
      throw new TypeError("OCCT artifact fault operation unexpectedly succeeded");
    }
    result = Object.freeze({
      protocolVersion: 1,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      evidence,
    });
  } catch (error) {
    result = errorResult(request, error);
  }
  await writeResult(paths.resultPath, result);
  if (!result.ok) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${boundedErrorText(
      error instanceof Error ? error.message : String(error),
      "OCCT artifact process child failed",
    )}\n`,
  );
  process.exitCode = 1;
}
