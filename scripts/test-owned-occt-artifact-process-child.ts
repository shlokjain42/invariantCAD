import { createHash } from "node:crypto";
import {
  constants,
  open,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { inspectKernelShapeArtifactSupport } from "../src/artifact-cache.js";
import { hashKernelShapeSemanticObservation } from "../src/conformance.js";
import { getOcctShapeArtifactCodecCandidate } from "../src/internal/occt-artifact-candidate.js";
import type {
  GeometryKernel,
  KernelShape,
} from "../src/kernel.js";
import {
  createOcctKernel,
} from "../src/occt-kernel.js";
import {
  INVARIANTCAD_OCCT_FACADE_0_9_0_RELEASE_MANIFEST_SHA256,
  loadAttestedOcctRuntime,
  type AttestedOcctRuntime,
} from "../src/occt-runtime-node.js";
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

interface LoadedRuntime {
  readonly attestedRuntime: AttestedOcctRuntime;
  readonly evidence: OcctArtifactProcessRuntimeEvidence;
}

const maximumReleaseManifestBytes = 1024 * 1024;
const maximumJavascriptBytes = 16 * 1024 * 1024;
const maximumWebAssemblyBytes = 512 * 1024 * 1024;
const maximumObservationBytes = 16 * 1024 * 1024;

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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
): Promise<LoadedRuntime> {
  const releaseManifestPath = resolve(
    runtimeDirectory,
    "../metadata/release.json",
  );
  const javascriptPath = resolve(runtimeDirectory, "occt-wasm.js");
  const webAssemblyPath = resolve(runtimeDirectory, "occt-wasm.wasm");
  // Each runtime file is read exactly once. Only these verified buffers become
  // execution inputs below.
  const [releaseManifest, javascript, webAssembly] = await Promise.all([
    readBoundedFile(
      releaseManifestPath,
      maximumReleaseManifestBytes,
      "Owned OCCT release manifest",
    ),
    readBoundedFile(
      javascriptPath,
      maximumJavascriptBytes,
      "Owned OCCT JavaScript runtime",
    ),
    readBoundedFile(
      webAssemblyPath,
      maximumWebAssemblyBytes,
      "Owned OCCT WebAssembly runtime",
    ),
  ]);
  const attestedRuntime = await loadAttestedOcctRuntime({
    releaseManifest,
    expectedReleaseManifestSha256:
      INVARIANTCAD_OCCT_FACADE_0_9_0_RELEASE_MANIFEST_SHA256,
    javascript,
    webassembly: webAssembly,
  });
  const attestation = attestedRuntime.attestation;
  return Object.freeze({
    attestedRuntime,
    evidence: Object.freeze({
      releaseManifest: "metadata/release.json",
      releaseManifestSha256: attestation.releaseManifestSha256,
      runtimePairIdentity: attestation.runtimePairIdentity,
      declaredBuildIdentity: attestation.declaredBuildIdentity,
      facadeMarker: attestation.facade.marker,
      javascript: Object.freeze({
        fileName: "occt-wasm.js",
        byteLength: attestation.javascript.size,
        sha256: attestation.javascript.sha256,
      }),
      webAssembly: Object.freeze({
        fileName: "occt-wasm.wasm",
        byteLength: attestation.webassembly.size,
        sha256: attestation.webassembly.sha256,
      }),
      verifiedBytesWereExecutionInputs: true,
      buildExecutionObserved: false,
      buildExecutionAuthenticated: false,
      publisherAuthenticated: false,
    }),
  });
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
): Promise<OcctArtifactProcessEvidence> {
  const runtime = await verifiedRuntime(request.runtimeDirectory);
  let kernel: GeometryKernel | undefined;
  let shape: KernelShape | undefined;
  let pending:
    | Omit<OcctArtifactProcessEvidence, "cleanupCompletedBeforeResponse">
    | undefined;
  let operationError: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    kernel = await createOcctKernel({
      attestedRuntime: runtime.attestedRuntime,
      onOutput: () => {},
      onError: () => {},
    });
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
    const evidence = await execute(request);
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
