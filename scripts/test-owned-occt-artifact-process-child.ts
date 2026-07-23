import { createHash } from "node:crypto";
import { writeSync } from "node:fs";
import {
  constants,
  open,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  inspectKernelShapeArtifactSupport,
  writeArtifactCacheRecord,
  type ArtifactCacheDeleteContext,
  type ArtifactCacheEvent,
  type ArtifactCacheKey,
  type ArtifactCacheRecordV1,
  type ArtifactCacheStore,
  type ArtifactCacheStoreContext,
  type ArtifactCacheStoreValue,
} from "../src/artifact-cache.js";
import { hashKernelShapeSemanticObservation } from "../src/conformance.js";
import { design, tf } from "../src/design.js";
import {
  createEvaluator,
  EvaluatedSolid,
  type EvaluatedDesign,
  type Evaluator,
} from "../src/evaluator.js";
import { mm, vec3 } from "../src/expressions.js";
import {
  getOcctShapeArtifactCodecCandidate,
  OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS,
  type OcctShapeArtifactCandidateHost,
} from "../src/internal/occt-artifact-candidate.js";
import { bindOcctEvaluatorArtifactCacheCandidate } from "../src/internal/evaluator-artifact-cache-candidate.js";
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
import { hashDocument } from "../src/serialization.js";
import {
  createReferenceSketchSolver,
  type SketchSolverBackend,
} from "../src/solver.js";
import {
  observeKernelShapeSemantics,
  type KernelShapeSemanticObservationPlan,
} from "../src/shape-semantic-observation.js";
import {
  OCCT_ARTIFACT_PROCESS_MAX_REQUEST_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_RESULT_BYTES,
  OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES,
  OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_HEADER_BYTES,
  OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
  encodeOcctArtifactProcessStartEvent,
  encodeOcctEvaluatorKernelOperationStartEvent,
  encodeOcctEvaluatorNonYieldingStallStartEvent,
  parseOcctArtifactProcessRequest,
  type OcctArtifactProcessArtifactEvidence,
  type OcctArtifactProcessCapabilityEvidence,
  type OcctArtifactProcessErrorCode,
  type OcctArtifactProcessEvidence,
  type OcctArtifactProcessRequest,
  type OcctArtifactProcessResult,
  type OcctArtifactProcessRuntimeEvidence,
  type OcctEvaluatorProcessEvidence,
  type OcctEvaluatorCacheProcessEvidence,
  type OcctEvaluatorCacheProcessProduceRequest,
  type OcctEvaluatorCacheProcessConsumeRequest,
  type OcctEvaluatorProcessMeasurementEvidence,
} from "./occt-artifact-process-protocol.js";

interface LoadedRuntime {
  readonly attestedRuntime: AttestedOcctRuntime;
  readonly evidence: OcctArtifactProcessRuntimeEvidence;
}

type OcctEvaluatorExecutionRequest = OcctArtifactProcessRequest & {
  readonly operation:
    | "evaluate"
    | "stall-during-evaluate"
    | "fail-cleanup-during-evaluate";
};

type OcctEvaluatorCacheExecutionRequest =
  | OcctEvaluatorCacheProcessProduceRequest
  | OcctEvaluatorCacheProcessConsumeRequest;

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

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength &&
    first.every((byte, index) => byte === second[index])
  );
}

const cacheRecordMagic = Uint8Array.of(
  0x49,
  0x43,
  0x41,
  0x43,
  0x48,
  0x45,
  0x31,
  0x00,
);
const textEncoder = new TextEncoder();

function maximumCacheRecordBytes(maxArtifactBytes: number): number {
  return (
    maxArtifactBytes +
    OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_HEADER_BYTES +
    OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES
  );
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

function encodeCacheRecordTransfer(
  record: ArtifactCacheRecordV1,
  maxArtifactBytes: number,
): Uint8Array {
  if (
    !(record.payload instanceof Uint8Array) ||
    record.payload.byteLength === 0 ||
    record.payload.byteLength > maxArtifactBytes
  ) {
    throw new RangeError(
      "OCCT evaluator-cache record payload exceeded its transfer limit",
    );
  }
  const header = Object.freeze({
    protocolVersion: record.protocolVersion,
    key: record.key,
    metadata: record.metadata,
    integrity: record.integrity,
  });
  const headerBytes = textEncoder.encode(JSON.stringify(header));
  if (
    headerBytes.byteLength === 0 ||
    headerBytes.byteLength >
      OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_HEADER_BYTES
  ) {
    throw new RangeError(
      "OCCT evaluator-cache record header exceeded its transfer limit",
    );
  }
  const output = new Uint8Array(
    OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES +
      headerBytes.byteLength +
      record.payload.byteLength,
  );
  output.set(cacheRecordMagic, 0);
  new DataView(output.buffer).setUint32(
    cacheRecordMagic.byteLength,
    headerBytes.byteLength,
    true,
  );
  output.set(
    headerBytes,
    OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES,
  );
  output.set(
    record.payload,
    OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES +
      headerBytes.byteLength,
  );
  return output;
}

function decodeCacheRecordTransfer(
  bytes: Uint8Array,
  maxArtifactBytes: number,
): {
  readonly key: string;
  readonly value: ArtifactCacheStoreValue;
} {
  if (
    bytes.byteLength <= OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES ||
    bytes.byteLength > maximumCacheRecordBytes(maxArtifactBytes) ||
    !cacheRecordMagic.every((byte, index) => bytes[index] === byte)
  ) {
    throw new TypeError(
      "OCCT evaluator-cache record transfer framing is malformed",
    );
  }
  const headerByteLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(cacheRecordMagic.byteLength, true);
  if (
    headerByteLength === 0 ||
    headerByteLength >
      OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_HEADER_BYTES ||
    OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES + headerByteLength >=
      bytes.byteLength
  ) {
    throw new TypeError(
      "OCCT evaluator-cache record transfer header is malformed",
    );
  }
  const payloadOffset =
    OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES + headerByteLength;
  const payloadByteLength = bytes.byteLength - payloadOffset;
  if (
    payloadByteLength <= 0 ||
    payloadByteLength > maxArtifactBytes
  ) {
    throw new RangeError(
      "OCCT evaluator-cache record transfer payload is oversized",
    );
  }
  const headerText = new TextDecoder("utf-8", { fatal: true }).decode(
    bytes.subarray(
      OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES,
      payloadOffset,
    ),
  );
  const header = JSON.parse(headerText) as unknown;
  if (
    !isRecord(header) ||
    !exactKeys(header, [
      "protocolVersion",
      "key",
      "metadata",
      "integrity",
    ]) ||
    header.protocolVersion !== 1 ||
    typeof header.key !== "string" ||
    !isRecord(header.metadata) ||
    !isRecord(header.integrity) ||
    !exactKeys(header.integrity, [
      "algorithm",
      "digest",
      "byteLength",
    ]) ||
    header.integrity.algorithm !== "sha256" ||
    typeof header.integrity.digest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(header.integrity.digest) ||
    header.integrity.byteLength !== payloadByteLength
  ) {
    throw new TypeError(
      "OCCT evaluator-cache record transfer header is malformed",
    );
  }
  const payload = bytes.subarray(payloadOffset);
  if (sha256(payload) !== header.integrity.digest) {
    throw new TypeError(
      "OCCT evaluator-cache record transfer payload integrity is invalid",
    );
  }
  return Object.freeze({
    key: header.key,
    value: Object.freeze({
      protocolVersion: header.protocolVersion,
      key: header.key,
      metadata: header.metadata,
      payload: payload.slice(),
      integrity: header.integrity,
    }),
  });
}

class ProcessCacheRecordStore implements ArtifactCacheStore {
  private readonly source:
    | {
        readonly key: string;
        readonly value: ArtifactCacheStoreValue;
      }
    | undefined;
  private readonly outputPath: string | undefined;
  private readonly maxArtifactBytes: number;
  private readKeyValue: ArtifactCacheKey | undefined;
  private writeKeyValue: ArtifactCacheKey | undefined;
  private outputBytesValue: Uint8Array | undefined;

  constructor(options: {
    readonly source?:
      | {
          readonly key: string;
          readonly value: ArtifactCacheStoreValue;
        }
      | undefined;
    readonly outputPath?: string | undefined;
    readonly maxArtifactBytes: number;
  }) {
    this.source = options.source;
    this.outputPath = options.outputPath;
    this.maxArtifactBytes = options.maxArtifactBytes;
  }

  read(
    key: ArtifactCacheKey,
    context: ArtifactCacheStoreContext,
  ): ArtifactCacheStoreValue {
    if (this.readKeyValue !== undefined) {
      throw new Error(
        "OCCT evaluator-cache fixture attempted more than one store read",
      );
    }
    if (context.maxBytes !== this.maxArtifactBytes) {
      throw new RangeError(
        "OCCT evaluator-cache fixture received an unexpected read limit",
      );
    }
    this.readKeyValue = key;
    return this.source?.key === key ? this.source.value : undefined;
  }

  async write(
    record: ArtifactCacheRecordV1,
    context: ArtifactCacheStoreContext,
  ): Promise<void> {
    if (
      this.outputPath === undefined ||
      this.writeKeyValue !== undefined
    ) {
      throw new Error(
        "OCCT evaluator-cache fixture attempted an unexpected store write",
      );
    }
    if (
      context.maxBytes !== this.maxArtifactBytes ||
      record.key !== this.readKeyValue
    ) {
      throw new RangeError(
        "OCCT evaluator-cache fixture received an inconsistent write",
      );
    }
    const bytes = encodeCacheRecordTransfer(
      record,
      this.maxArtifactBytes,
    );
    await writeFile(this.outputPath, bytes, {
      flag: "wx",
      mode: 0o600,
    });
    this.writeKeyValue = record.key;
    this.outputBytesValue = bytes;
  }

  delete(
    _key: ArtifactCacheKey,
    _context: ArtifactCacheDeleteContext,
  ): never {
    throw new Error(
      "OCCT evaluator-cache fixture attempted an unexpected store delete",
    );
  }

  get readKey(): ArtifactCacheKey | undefined {
    return this.readKeyValue;
  }

  get writeKey(): ArtifactCacheKey | undefined {
    return this.writeKeyValue;
  }

  get outputBytes(): Uint8Array | undefined {
    return this.outputBytesValue;
  }
}

async function validateCacheRecordTransfer(
  bytes: Uint8Array,
  maxArtifactBytes: number,
): Promise<{
  readonly key: string;
  readonly value: ArtifactCacheStoreValue;
}> {
  const decoded = decodeCacheRecordTransfer(bytes, maxArtifactBytes);
  let captured: ArtifactCacheRecordV1 | undefined;
  const sink: ArtifactCacheStore = {
    read(): never {
      throw new Error(
        "OCCT evaluator-cache validation sink cannot be read",
      );
    },
    write(
      record: ArtifactCacheRecordV1,
      context: ArtifactCacheStoreContext,
    ): void {
      if (
        captured !== undefined ||
        context.maxBytes !== maxArtifactBytes
      ) {
        throw new Error(
          "OCCT evaluator-cache validation sink received an inconsistent write",
        );
      }
      captured = record;
    },
    delete(): never {
      throw new Error(
        "OCCT evaluator-cache validation sink cannot delete",
      );
    },
  };
  const validated = await writeArtifactCacheRecord(
    sink,
    decoded.value as ArtifactCacheRecordV1,
    {
      limits: {
        maxOperations: 1,
        maxEntryBytes: maxArtifactBytes,
        maxTotalReadBytes: maxArtifactBytes,
        maxTotalWriteBytes: maxArtifactBytes,
      },
    },
  );
  if (!validated.ok || captured === undefined) {
    throw new TypeError(
      `OCCT evaluator-cache transfer record is invalid: ${JSON.stringify(
        validated.diagnostics,
      )}`,
    );
  }
  if (captured.key !== decoded.key) {
    throw new TypeError(
      "OCCT evaluator-cache validated record key changed unexpectedly",
    );
  }
  return Object.freeze({
    key: captured.key,
    value: captured,
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
    codec.capabilities.formatVersion !== 3
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
      formatVersion: 3,
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

function writeKernelOperationStartEvent(
  request: OcctEvaluatorExecutionRequest,
): void {
  writeExactStdoutEvent(
    encodeOcctEvaluatorKernelOperationStartEvent(
      request.requestId,
      request.operation,
      request.feature,
    ),
    "kernel-operation",
  );
}

function writeNonYieldingStallStartEvent(
  request: OcctEvaluatorExecutionRequest,
): void {
  writeExactStdoutEvent(
    encodeOcctEvaluatorNonYieldingStallStartEvent(
      request.requestId,
      request.feature,
    ),
    "non-yielding-stall",
  );
}

function writeExactStdoutEvent(
  encoded: string,
  label: string,
): void {
  const event = Buffer.from(encoded, "utf8");
  let offset = 0;
  while (offset < event.byteLength) {
    const written = writeSync(
      process.stdout.fd,
      event,
      offset,
      event.byteLength - offset,
    );
    if (written <= 0) {
      throw new Error(
        `OCCT evaluator process could not emit its ${label} start event`,
      );
    }
    offset += written;
  }
}

function evaluatorFixture() {
  const cad = design("owned-occt-evaluator-isolation-v1");
  const first = cad.box("first", {
    size: vec3(mm(10), mm(20), mm(30)),
  });
  const secondBase = cad.box("second-base", {
    size: vec3(mm(10), mm(20), mm(30)),
  });
  const second = cad.transform("second", secondBase, [
    tf.translate(vec3(mm(5), mm(5), mm(0))),
  ]);
  cad.output("result", cad.union("result", first, [second]));
  return cad.build();
}

function isolatedEvaluatorKernel(
  kernel: GeometryKernel,
  request: OcctEvaluatorExecutionRequest,
): {
  readonly kernel: GeometryKernel;
  readonly operationObserved: () => boolean;
} {
  let observed = false;
  const wrapped = new Proxy(kernel, {
    get(target, property) {
      if (
        property === "dispose" &&
        request.operation === "fail-cleanup-during-evaluate"
      ) {
        return (): never => {
          target.dispose();
          throw new Error("Injected OCCT evaluator cleanup failure");
        };
      }
      if (property === "boolean") {
        return (
          operation: "union" | "subtract" | "intersect",
          targetShape: KernelShape,
          tools: readonly KernelShape[],
          context?: Parameters<NonNullable<GeometryKernel["boolean"]>>[3],
        ): KernelShape => {
          if (observed) {
            throw new Error(
              "OCCT evaluator isolation fixture invoked Boolean more than once",
            );
          }
          if (
            operation !== "union" ||
            context?.feature !== request.feature ||
            target.boolean === undefined
          ) {
            throw new Error(
              "OCCT evaluator isolation fixture reached an unexpected kernel operation",
            );
          }
          observed = true;
          writeKernelOperationStartEvent(request);
          const result = target.boolean(
            operation,
            targetShape,
            tools,
            context,
          );
          if (request.operation === "stall-during-evaluate") {
            writeNonYieldingStallStartEvent(request);
            const lock = new Int32Array(new SharedArrayBuffer(4));
            Atomics.wait(lock, 0, 0);
            throw new Error(
              "Injected OCCT evaluator kernel stall unexpectedly returned",
            );
          }
          return result;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as GeometryKernel;
  return Object.freeze({
    kernel: wrapped,
    operationObserved: () => observed,
  });
}

function artifactCompatibleSolver(
  fingerprint: string,
): SketchSolverBackend {
  const delegate = createReferenceSketchSolver();
  return Object.freeze({
    id: delegate.id,
    capabilities: delegate.capabilities,
    artifactCompatibilityFingerprint: fingerprint,
    solve: delegate.solve.bind(delegate),
    dispose: delegate.dispose.bind(delegate),
  });
}

function evaluatorCacheFixture(feature: string) {
  if (feature !== "cache-box") {
    throw new TypeError(
      "OCCT evaluator-cache fixture requires feature 'cache-box'",
    );
  }
  const cad = design("owned-occt-evaluator-cache-box-v1");
  cad.output(
    "result",
    cad.box(feature, {
      size: vec3(mm(2), mm(3), mm(5)),
    }),
  );
  return cad.build();
}

function isolatedEvaluatorCacheKernel(
  kernel: GeometryKernel,
  feature: string,
): {
  readonly kernel: GeometryKernel;
  readonly nativeBoxCalls: () => number;
  readonly artifactCaptureCalls: () => number;
  readonly artifactRestoreCalls: () => number;
} {
  let nativeBoxCalls = 0;
  let artifactCaptureCalls = 0;
  let artifactRestoreCalls = 0;
  const wrapped = new Proxy(kernel, {
    get(target, property) {
      if (property === "box") {
        const box = target.box;
        if (box === undefined) return undefined;
        return (
          ...args: Parameters<NonNullable<GeometryKernel["box"]>>
        ): KernelShape => {
          if (
            nativeBoxCalls !== 0 ||
            args[2]?.feature !== feature
          ) {
            throw new Error(
              "OCCT evaluator-cache fixture reached an unexpected box operation",
            );
          }
          nativeBoxCalls += 1;
          return Reflect.apply(box, target, args);
        };
      }
      if (property === OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS) {
        const host = Reflect.get(
          target,
          property,
          target,
        ) as OcctShapeArtifactCandidateHost | undefined;
        if (host === undefined) return undefined;
        return Object.freeze({
          compatibilityFingerprint: host.compatibilityFingerprint,
          capture: (
            shape: KernelShape,
            signal?: AbortSignal,
          ) => {
            artifactCaptureCalls += 1;
            return host.capture(shape, signal);
          },
          encodeNative: (
            shape: KernelShape,
            maxBytes: number,
            signal?: AbortSignal,
          ) => host.encodeNative(shape, maxBytes, signal),
          restore: (
            state: Parameters<OcctShapeArtifactCandidateHost["restore"]>[0],
            signal?: AbortSignal,
          ) => {
            artifactRestoreCalls += 1;
            return host.restore(state, signal);
          },
        }) satisfies OcctShapeArtifactCandidateHost;
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as GeometryKernel;
  return Object.freeze({
    kernel: wrapped,
    nativeBoxCalls: () => nativeBoxCalls,
    artifactCaptureCalls: () => artifactCaptureCalls,
    artifactRestoreCalls: () => artifactRestoreCalls,
  });
}

function copyMeasurements(
  measurements: ReturnType<EvaluatedSolid["measure"]>,
): OcctEvaluatorProcessMeasurementEvidence {
  const vec = (
    value: readonly [number, number, number],
  ): readonly [number, number, number] =>
    Object.freeze([value[0], value[1], value[2]]);
  return Object.freeze({
    volume: measurements.volume,
    surfaceArea: measurements.surfaceArea,
    centerOfMass:
      measurements.centerOfMass === null
        ? null
        : vec(measurements.centerOfMass),
    inertiaTensor: Object.freeze([
      vec(measurements.inertiaTensor[0]),
      vec(measurements.inertiaTensor[1]),
      vec(measurements.inertiaTensor[2]),
    ]) as OcctEvaluatorProcessMeasurementEvidence["inertiaTensor"],
    boundingBox: Object.freeze({
      min: vec(measurements.boundingBox.min),
      max: vec(measurements.boundingBox.max),
    }),
    genus: measurements.genus,
    tolerance: measurements.tolerance,
  });
}

async function evaluateFixture(
  request: OcctEvaluatorExecutionRequest,
  kernel: GeometryKernel,
  runtime: OcctArtifactProcessRuntimeEvidence,
  owners: {
    evaluator?: Evaluator;
    evaluated?: EvaluatedDesign;
  },
): Promise<{
  readonly evaluator: Evaluator;
  readonly evaluated: EvaluatedDesign;
  readonly evidence: Omit<
    OcctEvaluatorProcessEvidence,
    "cleanupCompletedBeforeResponse"
  >;
}> {
  const fixture = evaluatorFixture();
  const isolated = isolatedEvaluatorKernel(kernel, request);
  const evaluator = await createEvaluator({ kernel: isolated.kernel });
  owners.evaluator = evaluator;
  const result = await evaluator.evaluate(fixture);
  if (!result.ok) {
    throw new Error(
      `OCCT evaluator isolation fixture failed: ${JSON.stringify(
        result.diagnostics,
      )}`,
    );
  }
  owners.evaluated = result.value;
  const output = result.value.output("result");
  if (!(output instanceof EvaluatedSolid)) {
    throw new TypeError(
      "OCCT evaluator isolation fixture did not produce a solid",
    );
  }
  const topology = output.topology();
  if (!topology.ok) {
    throw new Error(
      `OCCT evaluator isolation topology failed: ${JSON.stringify(
        topology.diagnostics,
      )}`,
    );
  }
  if (!isolated.operationObserved()) {
    throw new Error(
      "OCCT evaluator isolation fixture did not invoke its wrapped Boolean",
    );
  }
  if (result.value.configurationId !== null) {
    throw new Error(
      "OCCT evaluator isolation fixture selected an unexpected configuration",
    );
  }
  const evidence = Object.freeze({
    kind: "invariantcad-private-occt-evaluator-process-evidence" as const,
    evidenceVersion: 1 as const,
    operation: "evaluate" as const,
    executionBoundary: "one-shot-node-child-process" as const,
    evaluatorPath: "Evaluator.evaluate" as const,
    fixture: "owned-occt-evaluator-isolation-v1" as const,
    documentSha256: await hashDocument(fixture),
    configurationId: null,
    parameters: Object.freeze({}),
    output: Object.freeze({
      name: "result" as const,
      kind: "solid" as const,
      measurements: copyMeasurements(output.measure()),
      topology: Object.freeze({
        history: topology.value.history,
        faces: topology.value.faces.length,
        edges: topology.value.edges.length,
        vertices: topology.value.vertices.length,
      }),
    }),
    evaluatorKernelOperation: "boolean" as const,
    evaluatorKernelOperationObserved: true as const,
    runtime,
    shapeArtifactsAbsent: true as const,
    ordinaryEvaluatorRemainsCooperative: true as const,
    certifiesOperationalCancellation: false as const,
    certifiesCompatibility: false as const,
  });
  return Object.freeze({
    evaluator,
    evaluated: result.value,
    evidence,
  });
}

async function evaluateCacheFixture(
  request: OcctEvaluatorCacheExecutionRequest,
  kernel: GeometryKernel,
  runtime: OcctArtifactProcessRuntimeEvidence,
  owners: {
    evaluator?: Evaluator;
    evaluated?: EvaluatedDesign;
  },
): Promise<{
  readonly evaluator: Evaluator;
  readonly evaluated: EvaluatedDesign;
  readonly evidence: Omit<
    OcctEvaluatorCacheProcessEvidence,
    "cleanupCompletedBeforeResponse"
  >;
}> {
  const fixture = evaluatorCacheFixture(request.feature);
  const isolated = isolatedEvaluatorCacheKernel(kernel, request.feature);
  const candidate = candidateCapabilities(isolated.kernel);
  let inputBytes: Uint8Array | undefined;
  let source:
    | {
        readonly key: string;
        readonly value: ArtifactCacheStoreValue;
      }
    | undefined;
  if (request.operation === "cache-consume") {
    inputBytes = await readBoundedFile(
      request.inputCacheRecordPath,
      maximumCacheRecordBytes(request.maxArtifactBytes),
      "OCCT evaluator-cache process input record",
    );
    source = await validateCacheRecordTransfer(
      inputBytes,
      request.maxArtifactBytes,
    );
  }
  const store = new ProcessCacheRecordStore({
    ...(source === undefined ? {} : { source }),
    ...(request.operation === "cache-produce"
      ? { outputPath: request.outputCacheRecordPath }
      : {}),
    maxArtifactBytes: request.maxArtifactBytes,
  });
  const events: ArtifactCacheEvent[] = [];
  const evaluator = await createEvaluator({
    kernel: isolated.kernel,
    sketchSolver: artifactCompatibleSolver(request.solverFingerprint),
  });
  owners.evaluator = evaluator;
  const binding = bindOcctEvaluatorArtifactCacheCandidate(evaluator, {
    trust: "trusted",
    cache: {
      store,
      mode:
        request.operation === "cache-produce"
          ? "read-write"
          : "read-only",
      limits: {
        maxOperations: 4,
        maxEntryBytes: request.maxArtifactBytes,
        maxTotalReadBytes: request.maxArtifactBytes,
        maxTotalWriteBytes: request.maxArtifactBytes,
      },
      onEvent: (event) => {
        events.push(event);
      },
    },
  });
  if (!binding.ok) {
    throw new Error(
      `OCCT evaluator-cache binding failed: ${JSON.stringify(
        binding.diagnostics,
      )}`,
    );
  }
  const result = await evaluator.evaluate(fixture);
  if (!result.ok) {
    throw new Error(
      `OCCT evaluator-cache fixture failed: ${JSON.stringify(
        result.diagnostics,
      )}`,
    );
  }
  owners.evaluated = result.value;
  if (
    result.value.configurationId !== null ||
    result.value.diagnostics.length !== 0
  ) {
    throw new Error(
      "OCCT evaluator-cache fixture produced unexpected evaluation metadata",
    );
  }
  const output = result.value.output("result");
  if (!(output instanceof EvaluatedSolid)) {
    throw new TypeError(
      "OCCT evaluator-cache fixture did not produce a solid",
    );
  }
  const topology = output.topology();
  if (!topology.ok) {
    throw new Error(
      `OCCT evaluator-cache topology failed: ${JSON.stringify(
        topology.diagnostics,
      )}`,
    );
  }
  const key = store.readKey;
  if (
    key === undefined ||
    events.some(
      (event) =>
        event.node !== request.feature ||
        !("key" in event) ||
        event.key !== key,
    )
  ) {
    throw new Error(
      "OCCT evaluator-cache fixture emitted inconsistent key evidence",
    );
  }
  const eventKinds = events.map((event) => event.kind);
  let recordBytes: Uint8Array;
  let outcome: OcctEvaluatorCacheProcessEvidence["cache"]["outcome"];
  if (request.operation === "cache-produce") {
    recordBytes = store.outputBytes ?? new Uint8Array();
    outcome = "cold-write";
    if (
      recordBytes.byteLength === 0 ||
      store.writeKey !== key ||
      eventKinds.length !== 2 ||
      eventKinds[0] !== "miss" ||
      eventKinds[1] !== "write" ||
      isolated.nativeBoxCalls() !== 1 ||
      isolated.artifactCaptureCalls() !== 1 ||
      isolated.artifactRestoreCalls() !== 0
    ) {
      throw new Error(
        "OCCT evaluator-cache cold-write witness is inconsistent",
      );
    }
  } else {
    if (inputBytes === undefined || source === undefined) {
      throw new Error(
        "OCCT evaluator-cache consumer lost its input record",
      );
    }
    recordBytes = inputBytes;
    if (source.key === key) {
      outcome = "warm-hit";
      if (
        eventKinds.length !== 1 ||
        eventKinds[0] !== "hit" ||
        isolated.nativeBoxCalls() !== 0 ||
        isolated.artifactCaptureCalls() !== 0 ||
        isolated.artifactRestoreCalls() !== 1
      ) {
        throw new Error(
          "OCCT evaluator-cache warm-hit witness is inconsistent",
        );
      }
    } else {
      outcome = "incompatible-miss";
      if (
        eventKinds.length !== 1 ||
        eventKinds[0] !== "miss" ||
        isolated.nativeBoxCalls() !== 1 ||
        isolated.artifactCaptureCalls() !== 0 ||
        isolated.artifactRestoreCalls() !== 0
      ) {
        throw new Error(
          "OCCT evaluator-cache incompatible-miss witness is inconsistent",
        );
      }
    }
  }
  const evidence = Object.freeze({
    kind:
      "invariantcad-private-occt-evaluator-cache-process-evidence" as const,
    evidenceVersion: 1 as const,
    operation: request.operation,
    executionBoundary: "one-shot-node-child-process" as const,
    evaluatorPath: "Evaluator.evaluate" as const,
    fixture: "owned-occt-evaluator-cache-box-v1" as const,
    feature: "cache-box" as const,
    documentSha256: await hashDocument(fixture),
    configurationId: null,
    parameters: Object.freeze({}),
    solverFingerprint: request.solverFingerprint,
    output: Object.freeze({
      name: "result" as const,
      kind: "solid" as const,
      measurements: copyMeasurements(output.measure()),
      topology: Object.freeze({
        history: topology.value.history,
        faces: topology.value.faces.length,
        edges: topology.value.edges.length,
        vertices: topology.value.vertices.length,
      }),
    }),
    cache: Object.freeze({
      mode:
        request.operation === "cache-produce"
          ? ("read-write" as const)
          : ("read-only" as const),
      events: Object.freeze(eventKinds) as readonly (
        | "hit"
        | "miss"
        | "write"
      )[],
      key,
      nativeBoxCalls: isolated.nativeBoxCalls() as 0 | 1,
      artifactEncodeObserved:
        isolated.artifactCaptureCalls() === 1,
      artifactDecodeObserved:
        isolated.artifactRestoreCalls() === 1,
      outcome,
      record: artifactEvidence(recordBytes),
    }),
    runtime,
    capabilities: candidate.evidence,
    advertisement: "unadvertised" as const,
    shapeArtifactsAbsent: true as const,
    privateCandidateOnly: true as const,
    trustedStoreBoundary: "trusted-parent-mediated-record" as const,
    recordIntegrityAuthenticated: false as const,
    certifiesCompatibility: false as const,
    certifiesOperationalCancellation: false as const,
  });
  return Object.freeze({
    evaluator,
    evaluated: result.value,
    evidence,
  });
}

async function execute(
  request: OcctArtifactProcessRequest,
): Promise<
  | OcctArtifactProcessEvidence
  | OcctEvaluatorProcessEvidence
  | OcctEvaluatorCacheProcessEvidence
> {
  const runtime = await verifiedRuntime(request.runtimeDirectory);
  let kernel: GeometryKernel | undefined;
  let shape: KernelShape | undefined;
  const evaluationOwners: {
    evaluator?: Evaluator;
    evaluated?: EvaluatedDesign;
  } = {};
  let pending:
    | Omit<OcctArtifactProcessEvidence, "cleanupCompletedBeforeResponse">
    | Omit<OcctEvaluatorProcessEvidence, "cleanupCompletedBeforeResponse">
    | Omit<
        OcctEvaluatorCacheProcessEvidence,
        "cleanupCompletedBeforeResponse"
      >
    | undefined;
  let operationError: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    kernel = await createOcctKernel({
      attestedRuntime: runtime.attestedRuntime,
      onOutput: () => {},
      onError: () => {},
    });
    await flushStartEvent(request.requestId);
    if (request.operation === "trap") {
      throw new InjectedTrapError();
    }

    if (
      request.operation === "evaluate" ||
      request.operation === "stall-during-evaluate" ||
      request.operation === "fail-cleanup-during-evaluate"
    ) {
      if (
        inspectKernelShapeArtifactSupport(kernel).status !== "absent" ||
        kernel.capabilities.shapeArtifacts !== undefined ||
        kernel.encodeShapeArtifact !== undefined ||
        kernel.decodeShapeArtifact !== undefined
      ) {
        throw new TypeError(
          "Owned OCCT evaluator process unexpectedly advertised shape artifacts",
        );
      }
      const evaluated = await evaluateFixture(
        request as OcctEvaluatorExecutionRequest,
        kernel,
        runtime.evidence,
        evaluationOwners,
      );
      pending = evaluated.evidence;
    } else if (
      request.operation === "cache-produce" ||
      request.operation === "cache-consume"
    ) {
      const evaluated = await evaluateCacheFixture(
        request,
        kernel,
        runtime.evidence,
        evaluationOwners,
      );
      pending = evaluated.evidence;
    } else {
      const candidate = candidateCapabilities(kernel);
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
        const reencoded = candidate.codec.encodeShapeArtifact(shape, {
          feature: request.feature,
          maxArtifactBytes: request.maxArtifactBytes,
        });
        if (!sameBytes(reencoded, artifact)) {
          throw new TypeError(
            "Fresh owned OCCT consumer did not re-encode byte-identical artifact state",
          );
        }
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
    }
  } catch (error) {
    operationError = error;
  } finally {
    if (evaluationOwners.evaluated !== undefined) {
      try {
        evaluationOwners.evaluated.dispose();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (evaluationOwners.evaluator !== undefined) {
      try {
        evaluationOwners.evaluator.dispose();
      } catch (error) {
        cleanupErrors.push(error);
        if (kernel !== undefined) {
          try {
            kernel.dispose();
          } catch (fallbackError) {
            cleanupErrors.push(fallbackError);
          }
        }
      }
    } else {
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
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
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
    if (
      request.operation !== "produce" &&
      request.operation !== "consume" &&
      request.operation !== "evaluate" &&
      request.operation !== "cache-produce" &&
      request.operation !== "cache-consume"
    ) {
      throw new TypeError("OCCT artifact fault operation unexpectedly succeeded");
    }
    result = Object.freeze({
      protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      evidence,
    } as OcctArtifactProcessResult);
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
