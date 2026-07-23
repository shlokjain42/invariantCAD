import { isAbsolute } from "node:path";

export const OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION = 1 as const;
export const OCCT_ARTIFACT_PROCESS_EVIDENCE_VERSION = 1 as const;
export const OCCT_ARTIFACT_PROCESS_MAX_ARTIFACT_BYTES =
  64 * 1024 * 1024;
export const OCCT_ARTIFACT_PROCESS_MAX_REQUEST_BYTES = 16 * 1024;
export const OCCT_ARTIFACT_PROCESS_MAX_RESULT_BYTES = 64 * 1024;
export const OCCT_ARTIFACT_PROCESS_MAX_OUTPUT_BYTES = 64 * 1024;
export const OCCT_ARTIFACT_PROCESS_STARTUP_TIMEOUT_MS = 60_000;
export const OCCT_ARTIFACT_PROCESS_MAX_TIMEOUT_MS = 300_000;

export type OcctArtifactProcessOperation =
  | "produce"
  | "consume"
  | "stall-after-start"
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

export interface OcctArtifactProcessFaultRequest
  extends OcctArtifactProcessRequestBase {
  readonly operation: "stall-after-start" | "trap";
}

export type OcctArtifactProcessRequest =
  | OcctArtifactProcessProduceRequest
  | OcctArtifactProcessConsumeRequest
  | OcctArtifactProcessFaultRequest;

export interface OcctArtifactProcessStartEvent {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly event: "operation-started";
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
  readonly formatVersion: 2;
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

export interface OcctArtifactProcessSuccess {
  readonly protocolVersion: typeof OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: "produce" | "consume";
  readonly ok: true;
  readonly evidence: OcctArtifactProcessEvidence;
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
  | OcctArtifactProcessFailure;

const requestIdPattern = /^[0-9a-f]{32}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const semanticWitnessPattern =
  /^invariantcad:kernel-shape-semantic:v1:sha256:[0-9a-f]{64}$/u;
const textEncoder = new TextEncoder();

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
      value.operation === "stall-after-start" ||
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
    value.formatVersion !== 2 ||
    !boundedString(value.compatibilityFingerprint, 2_048)
  ) {
    throw new TypeError(
      "OCCT artifact process capability evidence is malformed",
    );
  }
  return Object.freeze({
    protocolVersion: 1,
    format: "org.invariantcad.occt-shape-candidate",
    formatVersion: 2,
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
      value.operation !== "stall-after-start" &&
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
      (value.operation !== "produce" && value.operation !== "consume")
    ) {
      throw new TypeError("OCCT artifact process success is malformed");
    }
    const evidence = parseEvidence(value.evidence);
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
    });
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
