import { isAbsolute } from "node:path";

export const OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION = 3 as const;
export const OCCT_ARTIFACT_PROCESS_EVIDENCE_VERSION = 1 as const;
export const OCCT_EVALUATOR_PROCESS_EVIDENCE_VERSION = 1 as const;
export const OCCT_EVALUATOR_CACHE_PROCESS_EVIDENCE_VERSION = 1 as const;
export const OCCT_ARTIFACT_PROCESS_MAX_ARTIFACT_BYTES =
  64 * 1024 * 1024;
export const OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_HEADER_BYTES =
  32 * 1024;
export const OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES = 12;
export const OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_BYTES =
  OCCT_ARTIFACT_PROCESS_MAX_ARTIFACT_BYTES +
  OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_HEADER_BYTES +
  OCCT_ARTIFACT_PROCESS_CACHE_RECORD_PREFIX_BYTES;
export const OCCT_EVALUATOR_CACHE_PROCESS_MAX_SOLVER_FINGERPRINT_BYTES =
  2_048;
export const OCCT_ARTIFACT_PROCESS_MAX_REQUEST_BYTES = 16 * 1024;
export const OCCT_ARTIFACT_PROCESS_MAX_RESULT_BYTES = 64 * 1024;
export const OCCT_ARTIFACT_PROCESS_MAX_OUTPUT_BYTES = 64 * 1024;
export const OCCT_ARTIFACT_PROCESS_STARTUP_TIMEOUT_MS = 60_000;
export const OCCT_ARTIFACT_PROCESS_MAX_TIMEOUT_MS = 300_000;

export type OcctArtifactProcessOperation =
  | "produce"
  | "consume"
  | "evaluate"
  | "cache-produce"
  | "cache-consume"
  | "stall-during-evaluate"
  | "fail-cleanup-during-evaluate"
  | "trap";

interface OcctArtifactProcessRequestBase {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: OcctArtifactProcessOperation;
  readonly runtimeDirectory: string;
  readonly feature: string;
  readonly maxArtifactBytes: number;
}

export interface OcctArtifactProcessProduceRequest
  extends OcctArtifactProcessRequestBase {
  readonly operation: "produce";
  readonly outputArtifactPath: string;
}

export interface OcctArtifactProcessConsumeRequest
  extends OcctArtifactProcessRequestBase {
  readonly operation: "consume";
  readonly inputArtifactPath: string;
}

interface OcctEvaluatorCacheProcessRequestBase
  extends OcctArtifactProcessRequestBase {
  readonly operation: "cache-produce" | "cache-consume";
  readonly solverFingerprint: string;
}

export interface OcctEvaluatorCacheProcessProduceRequest
  extends OcctEvaluatorCacheProcessRequestBase {
  readonly operation: "cache-produce";
  readonly outputCacheRecordPath: string;
}

export interface OcctEvaluatorCacheProcessConsumeRequest
  extends OcctEvaluatorCacheProcessRequestBase {
  readonly operation: "cache-consume";
  readonly inputCacheRecordPath: string;
}

export interface OcctArtifactProcessFaultRequest
  extends OcctArtifactProcessRequestBase {
  readonly operation:
    | "stall-during-evaluate"
    | "fail-cleanup-during-evaluate"
    | "trap";
}

export interface OcctEvaluatorProcessRequest
  extends OcctArtifactProcessRequestBase {
  readonly operation: "evaluate";
}

export type OcctArtifactProcessRequest =
  | OcctArtifactProcessProduceRequest
  | OcctArtifactProcessConsumeRequest
  | OcctEvaluatorProcessRequest
  | OcctEvaluatorCacheProcessProduceRequest
  | OcctEvaluatorCacheProcessConsumeRequest
  | OcctArtifactProcessFaultRequest;

export interface OcctArtifactProcessStartEvent {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly event: "operation-started";
}

export interface OcctEvaluatorKernelOperationStartEvent {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly event: "kernel-operation-started";
  readonly operation:
    | "evaluate"
    | "stall-during-evaluate"
    | "fail-cleanup-during-evaluate";
  readonly feature: string;
  readonly kernelOperation: "boolean";
}

export interface OcctEvaluatorNonYieldingStallStartEvent {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly event: "non-yielding-stall-started";
  readonly operation: "stall-during-evaluate";
  readonly feature: string;
  readonly kernelOperation: "boolean";
}

export interface OcctArtifactProcessRuntimeFileEvidence {
  readonly fileName: "occt-wasm.js" | "occt-wasm.wasm";
  readonly byteLength: number;
  readonly sha256: string;
}

export interface OcctArtifactProcessRuntimeEvidence {
  readonly releaseManifest: "metadata/release.json";
  readonly releaseManifestSha256: string;
  readonly runtimePairIdentity: string;
  readonly declaredBuildIdentity: string;
  readonly facadeMarker: string;
  readonly javascript: OcctArtifactProcessRuntimeFileEvidence;
  readonly webAssembly: OcctArtifactProcessRuntimeFileEvidence;
  /**
   * The child executed the verified JavaScript snapshot through the Node
   * module-hook loader and passed a fresh copy of the verified WebAssembly
   * snapshot through `wasmBinary`.
   */
  readonly verifiedBytesWereExecutionInputs: true;
  readonly buildExecutionObserved: false;
  readonly buildExecutionAuthenticated: false;
  readonly publisherAuthenticated: false;
}

export interface OcctArtifactProcessCapabilityEvidence {
  readonly protocolVersion: 1;
  readonly format: "org.invariantcad.occt-shape-candidate";
  readonly formatVersion: 3;
  readonly compatibilityFingerprint: string;
}

export interface OcctArtifactProcessArtifactEvidence {
  readonly byteLength: number;
  readonly sha256: string;
}

export interface OcctArtifactProcessEvidence {
  readonly kind: "invariantcad-private-occt-artifact-process-evidence";
  readonly evidenceVersion: typeof OCCT_ARTIFACT_PROCESS_EVIDENCE_VERSION;
  readonly operation: "produce" | "consume";
  readonly executionBoundary: "one-shot-node-child-process";
  readonly advertisement: "unadvertised";
  readonly shapeArtifactsAbsent: true;
  readonly certifiesCompatibility: false;
  readonly runtime: OcctArtifactProcessRuntimeEvidence;
  readonly capabilities: OcctArtifactProcessCapabilityEvidence;
  readonly artifact: OcctArtifactProcessArtifactEvidence;
  readonly semanticWitness: string;
  readonly cleanupCompletedBeforeResponse: true;
}

export interface OcctEvaluatorProcessMeasurementEvidence {
  readonly volume: number;
  readonly surfaceArea: number;
  readonly centerOfMass: readonly [number, number, number] | null;
  readonly inertiaTensor: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  readonly boundingBox: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  readonly genus: number;
  readonly tolerance: number;
}

export interface OcctEvaluatorProcessTopologyEvidence {
  readonly history: "none" | "partial" | "complete";
  readonly faces: number;
  readonly edges: number;
  readonly vertices: number;
}

export interface OcctEvaluatorProcessEvidence {
  readonly kind: "invariantcad-private-occt-evaluator-process-evidence";
  readonly evidenceVersion: typeof OCCT_EVALUATOR_PROCESS_EVIDENCE_VERSION;
  readonly operation: "evaluate";
  readonly executionBoundary: "one-shot-node-child-process";
  readonly evaluatorPath: "Evaluator.evaluate";
  readonly fixture: "owned-occt-evaluator-isolation-v1";
  readonly documentSha256: string;
  readonly configurationId: null;
  readonly parameters: Readonly<Record<string, never>>;
  readonly output: {
    readonly name: "result";
    readonly kind: "solid";
    readonly measurements: OcctEvaluatorProcessMeasurementEvidence;
    readonly topology: OcctEvaluatorProcessTopologyEvidence;
  };
  readonly evaluatorKernelOperation: "boolean";
  readonly evaluatorKernelOperationObserved: true;
  readonly runtime: OcctArtifactProcessRuntimeEvidence;
  readonly shapeArtifactsAbsent: true;
  readonly ordinaryEvaluatorRemainsCooperative: true;
  readonly certifiesOperationalCancellation: false;
  readonly certifiesCompatibility: false;
  readonly cleanupCompletedBeforeResponse: true;
}

export type OcctEvaluatorCacheProcessOutcome =
  | "cold-write"
  | "warm-hit"
  | "incompatible-miss";

export interface OcctEvaluatorCacheProcessEvidence {
  readonly kind: "invariantcad-private-occt-evaluator-cache-process-evidence";
  readonly evidenceVersion:
    typeof OCCT_EVALUATOR_CACHE_PROCESS_EVIDENCE_VERSION;
  readonly operation: "cache-produce" | "cache-consume";
  readonly executionBoundary: "one-shot-node-child-process";
  readonly evaluatorPath: "Evaluator.evaluate";
  readonly fixture: "owned-occt-evaluator-cache-box-v1";
  readonly feature: "cache-box";
  readonly documentSha256: string;
  readonly configurationId: null;
  readonly parameters: Readonly<Record<string, never>>;
  readonly solverFingerprint: string;
  readonly output: {
    readonly name: "result";
    readonly kind: "solid";
    readonly measurements: OcctEvaluatorProcessMeasurementEvidence;
    readonly topology: OcctEvaluatorProcessTopologyEvidence;
  };
  readonly cache: {
    readonly mode: "read-write" | "read-only";
    readonly events: readonly ("hit" | "miss" | "write")[];
    readonly key: string;
    readonly nativeBoxCalls: 0 | 1;
    readonly artifactEncodeObserved: boolean;
    readonly artifactDecodeObserved: boolean;
    readonly outcome: OcctEvaluatorCacheProcessOutcome;
    readonly record: OcctArtifactProcessArtifactEvidence;
  };
  readonly runtime: OcctArtifactProcessRuntimeEvidence;
  readonly capabilities: OcctArtifactProcessCapabilityEvidence;
  readonly advertisement: "unadvertised";
  readonly shapeArtifactsAbsent: true;
  readonly privateCandidateOnly: true;
  readonly trustedStoreBoundary: "trusted-parent-mediated-record";
  readonly recordIntegrityAuthenticated: false;
  readonly certifiesCompatibility: false;
  readonly certifiesOperationalCancellation: false;
  readonly cleanupCompletedBeforeResponse: true;
}

export interface OcctArtifactProcessSuccess {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: "produce" | "consume";
  readonly ok: true;
  readonly evidence: OcctArtifactProcessEvidence;
}

export interface OcctEvaluatorProcessSuccess {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: "evaluate";
  readonly ok: true;
  readonly evidence: OcctEvaluatorProcessEvidence;
}

export interface OcctEvaluatorCacheProcessSuccess {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: "cache-produce" | "cache-consume";
  readonly ok: true;
  readonly evidence: OcctEvaluatorCacheProcessEvidence;
}

export type OcctArtifactProcessErrorCode =
  | "INJECTED_TRAP"
  | "OPERATION_FAILED"
  | "CLEANUP_FAILED";

export interface OcctArtifactProcessFailure {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: OcctArtifactProcessOperation;
  readonly ok: false;
  readonly error: {
    readonly code: OcctArtifactProcessErrorCode;
    readonly name: string;
    readonly message: string;
  };
}

export type OcctArtifactProcessResult =
  | OcctArtifactProcessSuccess
  | OcctEvaluatorProcessSuccess
  | OcctEvaluatorCacheProcessSuccess
  | OcctArtifactProcessFailure;

const requestIdPattern = /^[0-9a-f]{32}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const semanticWitnessPattern =
  /^invariantcad:kernel-shape-semantic:v1:sha256:[0-9a-f]{64}$/u;
const artifactCacheKeyPattern =
  /^invariantcad:kernel-shape:v1:sha256:[0-9a-f]{64}$/u;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

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

function boundedString(
  value: unknown,
  maximumBytes: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    textEncoder.encode(value).byteLength <= maximumBytes
  );
}

function boundedCanonicalString(
  value: unknown,
  maximumBytes: number,
): value is string {
  if (!boundedString(value, maximumBytes)) return false;
  const encoded = textEncoder.encode(value);
  return fatalTextDecoder.decode(encoded) === value;
}

function absolutePath(value: unknown): value is string {
  return (
    boundedString(value, 4_096) &&
    !value.includes("\0") &&
    isAbsolute(value)
  );
}

function positiveSafeInteger(
  value: unknown,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximum
  );
}

function validRequestBase(
  value: Record<string, unknown>,
): value is Record<string, unknown> & OcctArtifactProcessRequestBase {
  return (
    value.protocolVersion === OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION &&
    typeof value.requestId === "string" &&
    requestIdPattern.test(value.requestId) &&
    (value.operation === "produce" ||
      value.operation === "consume" ||
      value.operation === "evaluate" ||
      value.operation === "cache-produce" ||
      value.operation === "cache-consume" ||
      value.operation === "stall-during-evaluate" ||
      value.operation === "fail-cleanup-during-evaluate" ||
      value.operation === "trap") &&
    absolutePath(value.runtimeDirectory) &&
    boundedString(value.feature, 256) &&
    positiveSafeInteger(
      value.maxArtifactBytes,
      OCCT_ARTIFACT_PROCESS_MAX_ARTIFACT_BYTES,
    )
  );
}

export function parseOcctArtifactProcessRequest(
  value: unknown,
): OcctArtifactProcessRequest {
  if (!isRecord(value) || !validRequestBase(value)) {
    throw new TypeError("OCCT artifact process request is malformed");
  }
  const common = [
    "protocolVersion",
    "requestId",
    "operation",
    "runtimeDirectory",
    "feature",
    "maxArtifactBytes",
  ] as const;
  if (value.operation === "produce") {
    if (
      !exactKeys(value, [...common, "outputArtifactPath"]) ||
      !absolutePath(value.outputArtifactPath)
    ) {
      throw new TypeError("OCCT artifact process produce request is malformed");
    }
  } else if (value.operation === "consume") {
    if (
      !exactKeys(value, [...common, "inputArtifactPath"]) ||
      !absolutePath(value.inputArtifactPath)
    ) {
      throw new TypeError("OCCT artifact process consume request is malformed");
    }
  } else if (value.operation === "cache-produce") {
    if (
      !exactKeys(value, [
        ...common,
        "solverFingerprint",
        "outputCacheRecordPath",
      ]) ||
      !boundedCanonicalString(
        value.solverFingerprint,
        OCCT_EVALUATOR_CACHE_PROCESS_MAX_SOLVER_FINGERPRINT_BYTES,
      ) ||
      !absolutePath(value.outputCacheRecordPath)
    ) {
      throw new TypeError(
        "OCCT evaluator-cache process produce request is malformed",
      );
    }
  } else if (value.operation === "cache-consume") {
    if (
      !exactKeys(value, [
        ...common,
        "solverFingerprint",
        "inputCacheRecordPath",
      ]) ||
      !boundedCanonicalString(
        value.solverFingerprint,
        OCCT_EVALUATOR_CACHE_PROCESS_MAX_SOLVER_FINGERPRINT_BYTES,
      ) ||
      !absolutePath(value.inputCacheRecordPath)
    ) {
      throw new TypeError(
        "OCCT evaluator-cache process consume request is malformed",
      );
    }
  } else if (!exactKeys(value, common)) {
    throw new TypeError("OCCT artifact process fault request is malformed");
  }
  return Object.freeze({ ...value }) as OcctArtifactProcessRequest;
}

export function encodeOcctArtifactProcessStartEvent(
  requestId: string,
): string {
  if (!requestIdPattern.test(requestId)) {
    throw new TypeError("OCCT artifact process request ID is malformed");
  }
  const event: OcctArtifactProcessStartEvent = {
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
    requestId,
    event: "operation-started",
  };
  return `${JSON.stringify(event)}\n`;
}

export function parseOcctArtifactProcessStartEvent(
  value: unknown,
): OcctArtifactProcessStartEvent {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["protocolVersion", "requestId", "event"]) ||
    value.protocolVersion !== OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !requestIdPattern.test(value.requestId) ||
    value.event !== "operation-started"
  ) {
    throw new TypeError("OCCT artifact process start event is malformed");
  }
  return Object.freeze({
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
    requestId: value.requestId,
    event: "operation-started",
  });
}

export function encodeOcctEvaluatorKernelOperationStartEvent(
  requestId: string,
  operation:
    | "evaluate"
    | "stall-during-evaluate"
    | "fail-cleanup-during-evaluate",
  feature: string,
): string {
  if (!requestIdPattern.test(requestId)) {
    throw new TypeError("OCCT artifact process request ID is malformed");
  }
  if (
    (operation !== "evaluate" &&
      operation !== "stall-during-evaluate" &&
      operation !== "fail-cleanup-during-evaluate") ||
    !boundedString(feature, 256)
  ) {
    throw new TypeError(
      "OCCT evaluator kernel-operation start event is malformed",
    );
  }
  const event: OcctEvaluatorKernelOperationStartEvent = {
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
    requestId,
    event: "kernel-operation-started",
    operation,
    feature,
    kernelOperation: "boolean",
  };
  return `${JSON.stringify(event)}\n`;
}

export function parseOcctEvaluatorKernelOperationStartEvent(
  value: unknown,
): OcctEvaluatorKernelOperationStartEvent {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "protocolVersion",
      "requestId",
      "event",
      "operation",
      "feature",
      "kernelOperation",
    ]) ||
    value.protocolVersion !== OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !requestIdPattern.test(value.requestId) ||
    value.event !== "kernel-operation-started" ||
    (value.operation !== "evaluate" &&
      value.operation !== "stall-during-evaluate" &&
      value.operation !== "fail-cleanup-during-evaluate") ||
    !boundedString(value.feature, 256) ||
    value.kernelOperation !== "boolean"
  ) {
    throw new TypeError(
      "OCCT evaluator kernel-operation start event is malformed",
    );
  }
  return Object.freeze({
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
    requestId: value.requestId,
    event: "kernel-operation-started",
    operation: value.operation,
    feature: value.feature,
    kernelOperation: "boolean",
  });
}

export function encodeOcctEvaluatorNonYieldingStallStartEvent(
  requestId: string,
  feature: string,
): string {
  if (
    !requestIdPattern.test(requestId) ||
    !boundedString(feature, 256)
  ) {
    throw new TypeError(
      "OCCT evaluator non-yielding-stall start event is malformed",
    );
  }
  const event: OcctEvaluatorNonYieldingStallStartEvent = {
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
    requestId,
    event: "non-yielding-stall-started",
    operation: "stall-during-evaluate",
    feature,
    kernelOperation: "boolean",
  };
  return `${JSON.stringify(event)}\n`;
}

export function parseOcctEvaluatorNonYieldingStallStartEvent(
  value: unknown,
): OcctEvaluatorNonYieldingStallStartEvent {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "protocolVersion",
      "requestId",
      "event",
      "operation",
      "feature",
      "kernelOperation",
    ]) ||
    value.protocolVersion !== OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !requestIdPattern.test(value.requestId) ||
    value.event !== "non-yielding-stall-started" ||
    value.operation !== "stall-during-evaluate" ||
    !boundedString(value.feature, 256) ||
    value.kernelOperation !== "boolean"
  ) {
    throw new TypeError(
      "OCCT evaluator non-yielding-stall start event is malformed",
    );
  }
  return Object.freeze({
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
    requestId: value.requestId,
    event: "non-yielding-stall-started",
    operation: "stall-during-evaluate",
    feature: value.feature,
    kernelOperation: "boolean",
  });
}

function parseRuntimeFileEvidence(
  value: unknown,
  fileName: OcctArtifactProcessRuntimeFileEvidence["fileName"],
): OcctArtifactProcessRuntimeFileEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["fileName", "byteLength", "sha256"]) ||
    value.fileName !== fileName ||
    !positiveSafeInteger(value.byteLength, 512 * 1024 * 1024) ||
    typeof value.sha256 !== "string" ||
    !sha256Pattern.test(value.sha256)
  ) {
    throw new TypeError(`OCCT artifact process ${fileName} evidence is malformed`);
  }
  return Object.freeze({
    fileName,
    byteLength: value.byteLength,
    sha256: value.sha256,
  });
}

function parseRuntimeEvidence(
  value: unknown,
): OcctArtifactProcessRuntimeEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "releaseManifest",
      "releaseManifestSha256",
      "runtimePairIdentity",
      "declaredBuildIdentity",
      "facadeMarker",
      "javascript",
      "webAssembly",
      "verifiedBytesWereExecutionInputs",
      "buildExecutionObserved",
      "buildExecutionAuthenticated",
      "publisherAuthenticated",
    ]) ||
    value.releaseManifest !== "metadata/release.json" ||
    typeof value.releaseManifestSha256 !== "string" ||
    !sha256Pattern.test(value.releaseManifestSha256) ||
    typeof value.runtimePairIdentity !== "string" ||
    !/^invariantcad-occt-runtime-pair@1:sha256:[0-9a-f]{64}$/u.test(
      value.runtimePairIdentity,
    ) ||
    typeof value.declaredBuildIdentity !== "string" ||
    !/^invariantcad-occt-release-manifest@1:sha256:[0-9a-f]{64}$/u.test(
      value.declaredBuildIdentity,
    ) ||
    value.declaredBuildIdentity !==
      `invariantcad-occt-release-manifest@1:sha256:${value.releaseManifestSha256}` ||
    !boundedString(value.facadeMarker, 1_024) ||
    value.verifiedBytesWereExecutionInputs !== true ||
    value.buildExecutionObserved !== false ||
    value.buildExecutionAuthenticated !== false ||
    value.publisherAuthenticated !== false
  ) {
    throw new TypeError("OCCT artifact process runtime evidence is malformed");
  }
  return Object.freeze({
    releaseManifest: "metadata/release.json",
    releaseManifestSha256: value.releaseManifestSha256,
    runtimePairIdentity: value.runtimePairIdentity,
    declaredBuildIdentity: value.declaredBuildIdentity,
    facadeMarker: value.facadeMarker,
    javascript: parseRuntimeFileEvidence(value.javascript, "occt-wasm.js"),
    webAssembly: parseRuntimeFileEvidence(
      value.webAssembly,
      "occt-wasm.wasm",
    ),
    verifiedBytesWereExecutionInputs: true,
    buildExecutionObserved: false,
    buildExecutionAuthenticated: false,
    publisherAuthenticated: false,
  });
}

function parseCapabilityEvidence(
  value: unknown,
): OcctArtifactProcessCapabilityEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "protocolVersion",
      "format",
      "formatVersion",
      "compatibilityFingerprint",
    ]) ||
    value.protocolVersion !== 1 ||
    value.format !== "org.invariantcad.occt-shape-candidate" ||
    value.formatVersion !== 3 ||
    !boundedString(value.compatibilityFingerprint, 2_048)
  ) {
    throw new TypeError(
      "OCCT artifact process capability evidence is malformed",
    );
  }
  return Object.freeze({
    protocolVersion: 1,
    format: "org.invariantcad.occt-shape-candidate",
    formatVersion: 3,
    compatibilityFingerprint: value.compatibilityFingerprint,
  });
}

function parseArtifactEvidence(
  value: unknown,
): OcctArtifactProcessArtifactEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["byteLength", "sha256"]) ||
    !positiveSafeInteger(
      value.byteLength,
      OCCT_ARTIFACT_PROCESS_MAX_ARTIFACT_BYTES,
    ) ||
    typeof value.sha256 !== "string" ||
    !sha256Pattern.test(value.sha256)
  ) {
    throw new TypeError("OCCT artifact process artifact evidence is malformed");
  }
  return Object.freeze({
    byteLength: value.byteLength,
    sha256: value.sha256,
  });
}

function parseEvidence(value: unknown): OcctArtifactProcessEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "kind",
      "evidenceVersion",
      "operation",
      "executionBoundary",
      "advertisement",
      "shapeArtifactsAbsent",
      "certifiesCompatibility",
      "runtime",
      "capabilities",
      "artifact",
      "semanticWitness",
      "cleanupCompletedBeforeResponse",
    ]) ||
    value.kind !== "invariantcad-private-occt-artifact-process-evidence" ||
    value.evidenceVersion !== OCCT_ARTIFACT_PROCESS_EVIDENCE_VERSION ||
    (value.operation !== "produce" && value.operation !== "consume") ||
    value.executionBoundary !== "one-shot-node-child-process" ||
    value.advertisement !== "unadvertised" ||
    value.shapeArtifactsAbsent !== true ||
    value.certifiesCompatibility !== false ||
    typeof value.semanticWitness !== "string" ||
    !semanticWitnessPattern.test(value.semanticWitness) ||
    value.cleanupCompletedBeforeResponse !== true
  ) {
    throw new TypeError("OCCT artifact process evidence is malformed");
  }
  return Object.freeze({
    kind: "invariantcad-private-occt-artifact-process-evidence",
    evidenceVersion: OCCT_ARTIFACT_PROCESS_EVIDENCE_VERSION,
    operation: value.operation,
    executionBoundary: "one-shot-node-child-process",
    advertisement: "unadvertised",
    shapeArtifactsAbsent: true,
    certifiesCompatibility: false,
    runtime: parseRuntimeEvidence(value.runtime),
    capabilities: parseCapabilityEvidence(value.capabilities),
    artifact: parseArtifactEvidence(value.artifact),
    semanticWitness: value.semanticWitness,
    cleanupCompletedBeforeResponse: true,
  });
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function parseFiniteVec3(
  value: unknown,
  label: string,
): readonly [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !exactKeys(value as unknown as Record<string, unknown>, ["0", "1", "2"]) ||
    !value.every(finiteNumber)
  ) {
    throw new TypeError(`OCCT evaluator process ${label} is malformed`);
  }
  return Object.freeze([value[0]!, value[1]!, value[2]!]);
}

function parseMeasurementEvidence(
  value: unknown,
): OcctEvaluatorProcessMeasurementEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "volume",
      "surfaceArea",
      "centerOfMass",
      "inertiaTensor",
      "boundingBox",
      "genus",
      "tolerance",
    ]) ||
    !finiteNumber(value.volume) ||
    value.volume < 0 ||
    !finiteNumber(value.surfaceArea) ||
    value.surfaceArea < 0 ||
    !nonNegativeSafeInteger(value.genus) ||
    !finiteNumber(value.tolerance) ||
    value.tolerance < 0 ||
    !Array.isArray(value.inertiaTensor) ||
    value.inertiaTensor.length !== 3 ||
    !exactKeys(
      value.inertiaTensor as unknown as Record<string, unknown>,
      ["0", "1", "2"],
    ) ||
    !isRecord(value.boundingBox) ||
    !exactKeys(value.boundingBox, ["min", "max"])
  ) {
    throw new TypeError(
      "OCCT evaluator process measurement evidence is malformed",
    );
  }
  const centerOfMass =
    value.centerOfMass === null
      ? null
      : parseFiniteVec3(value.centerOfMass, "center of mass");
  const inertiaTensor = Object.freeze([
    parseFiniteVec3(value.inertiaTensor[0], "inertia tensor"),
    parseFiniteVec3(value.inertiaTensor[1], "inertia tensor"),
    parseFiniteVec3(value.inertiaTensor[2], "inertia tensor"),
  ]) as OcctEvaluatorProcessMeasurementEvidence["inertiaTensor"];
  const boundingBox = Object.freeze({
    min: parseFiniteVec3(value.boundingBox.min, "bounding-box minimum"),
    max: parseFiniteVec3(value.boundingBox.max, "bounding-box maximum"),
  });
  return Object.freeze({
    volume: value.volume,
    surfaceArea: value.surfaceArea,
    centerOfMass,
    inertiaTensor,
    boundingBox,
    genus: value.genus,
    tolerance: value.tolerance,
  });
}

function parseTopologyEvidence(
  value: unknown,
): OcctEvaluatorProcessTopologyEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["history", "faces", "edges", "vertices"]) ||
    (value.history !== "none" &&
      value.history !== "partial" &&
      value.history !== "complete") ||
    !nonNegativeSafeInteger(value.faces) ||
    !nonNegativeSafeInteger(value.edges) ||
    !nonNegativeSafeInteger(value.vertices)
  ) {
    throw new TypeError(
      "OCCT evaluator process topology evidence is malformed",
    );
  }
  return Object.freeze({
    history: value.history,
    faces: value.faces,
    edges: value.edges,
    vertices: value.vertices,
  });
}

function parseEvaluatorEvidence(
  value: unknown,
): OcctEvaluatorProcessEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "kind",
      "evidenceVersion",
      "operation",
      "executionBoundary",
      "evaluatorPath",
      "fixture",
      "documentSha256",
      "configurationId",
      "parameters",
      "output",
      "evaluatorKernelOperation",
      "evaluatorKernelOperationObserved",
      "runtime",
      "shapeArtifactsAbsent",
      "ordinaryEvaluatorRemainsCooperative",
      "certifiesOperationalCancellation",
      "certifiesCompatibility",
      "cleanupCompletedBeforeResponse",
    ]) ||
    value.kind !== "invariantcad-private-occt-evaluator-process-evidence" ||
    value.evidenceVersion !== OCCT_EVALUATOR_PROCESS_EVIDENCE_VERSION ||
    value.operation !== "evaluate" ||
    value.executionBoundary !== "one-shot-node-child-process" ||
    value.evaluatorPath !== "Evaluator.evaluate" ||
    value.fixture !== "owned-occt-evaluator-isolation-v1" ||
    typeof value.documentSha256 !== "string" ||
    !sha256Pattern.test(value.documentSha256) ||
    value.configurationId !== null ||
    !isRecord(value.parameters) ||
    !exactKeys(value.parameters, []) ||
    !isRecord(value.output) ||
    !exactKeys(value.output, [
      "name",
      "kind",
      "measurements",
      "topology",
    ]) ||
    value.output.name !== "result" ||
    value.output.kind !== "solid" ||
    value.evaluatorKernelOperation !== "boolean" ||
    value.evaluatorKernelOperationObserved !== true ||
    value.shapeArtifactsAbsent !== true ||
    value.ordinaryEvaluatorRemainsCooperative !== true ||
    value.certifiesOperationalCancellation !== false ||
    value.certifiesCompatibility !== false ||
    value.cleanupCompletedBeforeResponse !== true
  ) {
    throw new TypeError("OCCT evaluator process evidence is malformed");
  }
  return Object.freeze({
    kind: "invariantcad-private-occt-evaluator-process-evidence",
    evidenceVersion: OCCT_EVALUATOR_PROCESS_EVIDENCE_VERSION,
    operation: "evaluate",
    executionBoundary: "one-shot-node-child-process",
    evaluatorPath: "Evaluator.evaluate",
    fixture: "owned-occt-evaluator-isolation-v1",
    documentSha256: value.documentSha256,
    configurationId: null,
    parameters: Object.freeze({}),
    output: Object.freeze({
      name: "result",
      kind: "solid",
      measurements: parseMeasurementEvidence(value.output.measurements),
      topology: parseTopologyEvidence(value.output.topology),
    }),
    evaluatorKernelOperation: "boolean",
    evaluatorKernelOperationObserved: true,
    runtime: parseRuntimeEvidence(value.runtime),
    shapeArtifactsAbsent: true,
    ordinaryEvaluatorRemainsCooperative: true,
    certifiesOperationalCancellation: false,
    certifiesCompatibility: false,
    cleanupCompletedBeforeResponse: true,
  });
}

function parseCacheRecordEvidence(
  value: unknown,
): OcctArtifactProcessArtifactEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["byteLength", "sha256"]) ||
    !positiveSafeInteger(
      value.byteLength,
      OCCT_ARTIFACT_PROCESS_MAX_CACHE_RECORD_BYTES,
    ) ||
    typeof value.sha256 !== "string" ||
    !sha256Pattern.test(value.sha256)
  ) {
    throw new TypeError(
      "OCCT evaluator-cache process record evidence is malformed",
    );
  }
  return Object.freeze({
    byteLength: value.byteLength,
    sha256: value.sha256,
  });
}

function parseEvaluatorCacheEvidence(
  value: unknown,
): OcctEvaluatorCacheProcessEvidence {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "kind",
      "evidenceVersion",
      "operation",
      "executionBoundary",
      "evaluatorPath",
      "fixture",
      "feature",
      "documentSha256",
      "configurationId",
      "parameters",
      "solverFingerprint",
      "output",
      "cache",
      "runtime",
      "capabilities",
      "advertisement",
      "shapeArtifactsAbsent",
      "privateCandidateOnly",
      "trustedStoreBoundary",
      "recordIntegrityAuthenticated",
      "certifiesCompatibility",
      "certifiesOperationalCancellation",
      "cleanupCompletedBeforeResponse",
    ]) ||
    value.kind !==
      "invariantcad-private-occt-evaluator-cache-process-evidence" ||
    value.evidenceVersion !==
      OCCT_EVALUATOR_CACHE_PROCESS_EVIDENCE_VERSION ||
    (value.operation !== "cache-produce" &&
      value.operation !== "cache-consume") ||
    value.executionBoundary !== "one-shot-node-child-process" ||
    value.evaluatorPath !== "Evaluator.evaluate" ||
    value.fixture !== "owned-occt-evaluator-cache-box-v1" ||
    value.feature !== "cache-box" ||
    typeof value.documentSha256 !== "string" ||
    !sha256Pattern.test(value.documentSha256) ||
    value.configurationId !== null ||
    !isRecord(value.parameters) ||
    !exactKeys(value.parameters, []) ||
    !boundedCanonicalString(
      value.solverFingerprint,
      OCCT_EVALUATOR_CACHE_PROCESS_MAX_SOLVER_FINGERPRINT_BYTES,
    ) ||
    !isRecord(value.output) ||
    !exactKeys(value.output, [
      "name",
      "kind",
      "measurements",
      "topology",
    ]) ||
    value.output.name !== "result" ||
    value.output.kind !== "solid" ||
    !isRecord(value.cache) ||
    !exactKeys(value.cache, [
      "mode",
      "events",
      "key",
      "nativeBoxCalls",
      "artifactEncodeObserved",
      "artifactDecodeObserved",
      "outcome",
      "record",
    ]) ||
    (value.cache.mode !== "read-write" &&
      value.cache.mode !== "read-only") ||
    !Array.isArray(value.cache.events) ||
    !exactKeys(
      value.cache.events as unknown as Record<string, unknown>,
      Array.from(
        { length: value.cache.events.length },
        (_, index) => String(index),
      ),
    ) ||
    !value.cache.events.every(
      (event) =>
        event === "hit" || event === "miss" || event === "write",
    ) ||
    typeof value.cache.key !== "string" ||
    !artifactCacheKeyPattern.test(value.cache.key) ||
    (value.cache.nativeBoxCalls !== 0 &&
      value.cache.nativeBoxCalls !== 1) ||
    typeof value.cache.artifactEncodeObserved !== "boolean" ||
    typeof value.cache.artifactDecodeObserved !== "boolean" ||
    (value.cache.outcome !== "cold-write" &&
      value.cache.outcome !== "warm-hit" &&
      value.cache.outcome !== "incompatible-miss") ||
    value.advertisement !== "unadvertised" ||
    value.shapeArtifactsAbsent !== true ||
    value.privateCandidateOnly !== true ||
    value.trustedStoreBoundary !== "trusted-parent-mediated-record" ||
    value.recordIntegrityAuthenticated !== false ||
    value.certifiesCompatibility !== false ||
    value.certifiesOperationalCancellation !== false ||
    value.cleanupCompletedBeforeResponse !== true
  ) {
    throw new TypeError(
      "OCCT evaluator-cache process evidence is malformed",
    );
  }

  const expected:
    | {
        readonly mode: "read-write";
        readonly events: readonly ["miss", "write"];
        readonly nativeBoxCalls: 1;
        readonly artifactEncodeObserved: true;
        readonly artifactDecodeObserved: false;
        readonly outcome: "cold-write";
      }
    | {
        readonly mode: "read-only";
        readonly events: readonly ["hit"];
        readonly nativeBoxCalls: 0;
        readonly artifactEncodeObserved: false;
        readonly artifactDecodeObserved: true;
        readonly outcome: "warm-hit";
      }
    | {
        readonly mode: "read-only";
        readonly events: readonly ["miss"];
        readonly nativeBoxCalls: 1;
        readonly artifactEncodeObserved: false;
        readonly artifactDecodeObserved: false;
        readonly outcome: "incompatible-miss";
      } =
    value.operation === "cache-produce"
      ? {
          mode: "read-write",
          events: ["miss", "write"],
          nativeBoxCalls: 1,
          artifactEncodeObserved: true,
          artifactDecodeObserved: false,
          outcome: "cold-write",
        }
      : value.cache.outcome === "warm-hit"
        ? {
            mode: "read-only",
            events: ["hit"],
            nativeBoxCalls: 0,
            artifactEncodeObserved: false,
            artifactDecodeObserved: true,
            outcome: "warm-hit",
          }
        : {
            mode: "read-only",
            events: ["miss"],
            nativeBoxCalls: 1,
            artifactEncodeObserved: false,
            artifactDecodeObserved: false,
            outcome: "incompatible-miss",
          };
  if (
    value.cache.mode !== expected.mode ||
    value.cache.events.length !== expected.events.length ||
    !value.cache.events.every(
      (event, index) => event === expected.events[index],
    ) ||
    value.cache.nativeBoxCalls !== expected.nativeBoxCalls ||
    value.cache.artifactEncodeObserved !==
      expected.artifactEncodeObserved ||
    value.cache.artifactDecodeObserved !==
      expected.artifactDecodeObserved ||
    value.cache.outcome !== expected.outcome
  ) {
    throw new TypeError(
      "OCCT evaluator-cache process outcome evidence is inconsistent",
    );
  }
  return Object.freeze({
    kind: "invariantcad-private-occt-evaluator-cache-process-evidence",
    evidenceVersion: OCCT_EVALUATOR_CACHE_PROCESS_EVIDENCE_VERSION,
    operation: value.operation,
    executionBoundary: "one-shot-node-child-process",
    evaluatorPath: "Evaluator.evaluate",
    fixture: "owned-occt-evaluator-cache-box-v1",
    feature: "cache-box",
    documentSha256: value.documentSha256,
    configurationId: null,
    parameters: Object.freeze({}),
    solverFingerprint: value.solverFingerprint,
    output: Object.freeze({
      name: "result",
      kind: "solid",
      measurements: parseMeasurementEvidence(value.output.measurements),
      topology: parseTopologyEvidence(value.output.topology),
    }),
    cache: Object.freeze({
      mode: expected.mode,
      events: Object.freeze([...expected.events]),
      key: value.cache.key,
      nativeBoxCalls: expected.nativeBoxCalls,
      artifactEncodeObserved: expected.artifactEncodeObserved,
      artifactDecodeObserved: expected.artifactDecodeObserved,
      outcome: expected.outcome,
      record: parseCacheRecordEvidence(value.cache.record),
    }),
    runtime: parseRuntimeEvidence(value.runtime),
    capabilities: parseCapabilityEvidence(value.capabilities),
    advertisement: "unadvertised",
    shapeArtifactsAbsent: true,
    privateCandidateOnly: true,
    trustedStoreBoundary: "trusted-parent-mediated-record",
    recordIntegrityAuthenticated: false,
    certifiesCompatibility: false,
    certifiesOperationalCancellation: false,
    cleanupCompletedBeforeResponse: true,
  });
}

function parseFailureError(
  value: unknown,
): OcctArtifactProcessFailure["error"] {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["code", "name", "message"]) ||
    (value.code !== "INJECTED_TRAP" &&
      value.code !== "OPERATION_FAILED" &&
      value.code !== "CLEANUP_FAILED") ||
    !boundedString(value.name, 256) ||
    !boundedString(value.message, 4_096)
  ) {
    throw new TypeError("OCCT artifact process failure is malformed");
  }
  return Object.freeze({
    code: value.code,
    name: value.name,
    message: value.message,
  });
}

export function parseOcctArtifactProcessResult(
  value: unknown,
): OcctArtifactProcessResult {
  if (
    !isRecord(value) ||
    value.protocolVersion !== OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION ||
    typeof value.requestId !== "string" ||
    !requestIdPattern.test(value.requestId) ||
    (value.operation !== "produce" &&
      value.operation !== "consume" &&
      value.operation !== "evaluate" &&
      value.operation !== "cache-produce" &&
      value.operation !== "cache-consume" &&
      value.operation !== "stall-during-evaluate" &&
      value.operation !== "fail-cleanup-during-evaluate" &&
      value.operation !== "trap") ||
    typeof value.ok !== "boolean"
  ) {
    throw new TypeError("OCCT artifact process result is malformed");
  }
  if (value.ok) {
    if (
      !exactKeys(value, [
        "protocolVersion",
        "requestId",
        "operation",
        "ok",
        "evidence",
      ]) ||
      (value.operation !== "produce" &&
        value.operation !== "consume" &&
        value.operation !== "evaluate" &&
        value.operation !== "cache-produce" &&
        value.operation !== "cache-consume")
    ) {
      throw new TypeError("OCCT artifact process success is malformed");
    }
    const evidence =
      value.operation === "evaluate"
        ? parseEvaluatorEvidence(value.evidence)
        : value.operation === "cache-produce" ||
            value.operation === "cache-consume"
          ? parseEvaluatorCacheEvidence(value.evidence)
          : parseEvidence(value.evidence);
    if (evidence.operation !== value.operation) {
      throw new TypeError(
        "OCCT artifact process success operation is inconsistent",
      );
    }
    return Object.freeze({
      protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
      requestId: value.requestId,
      operation: value.operation,
      ok: true,
      evidence,
    } as
      | OcctArtifactProcessSuccess
      | OcctEvaluatorProcessSuccess
      | OcctEvaluatorCacheProcessSuccess);
  }
  if (
    !exactKeys(value, [
      "protocolVersion",
      "requestId",
      "operation",
      "ok",
      "error",
    ])
  ) {
    throw new TypeError("OCCT artifact process failure is malformed");
  }
  const error = parseFailureError(value.error);
  if (error.code === "INJECTED_TRAP" && value.operation !== "trap") {
    throw new TypeError(
      "OCCT artifact process injected-trap failure is inconsistent",
    );
  }
  return Object.freeze({
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
    requestId: value.requestId,
    operation: value.operation,
    ok: false,
    error,
  });
}
