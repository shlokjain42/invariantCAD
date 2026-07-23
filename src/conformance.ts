import {
  inspectKernelShapeArtifactSupport,
  type KernelShapeArtifactSupportInspection,
} from "./artifact-cache.js";
import { deepFreeze } from "./core/json.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import {
  KERNEL_SHAPE_ARTIFACT_MAX_COMPATIBILITY_FINGERPRINT_BYTES,
  KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
  type Awaitable,
  type GeometryKernel,
  type KernelShape,
  type KernelShapeArtifactCapabilities,
  type KernelShapeArtifactContext,
} from "./kernel.js";
import { isCanonicalUtf8StringWithin } from "./core/utf8.js";
import {
  encodeKernelShapeSemanticObservation,
  type KernelShapeSemanticObservation,
} from "./shape-semantic-observation.js";

export {
  DEFAULT_KERNEL_SHAPE_SEMANTIC_OBSERVATION_LIMITS,
  KERNEL_SHAPE_SEMANTIC_OBSERVATION_PROTOCOL_VERSION,
  encodeKernelShapeSemanticObservation,
  observeKernelShapeSemantics,
  type KernelShapeSemanticCurveV1,
  type KernelShapeSemanticEdgeV1,
  type KernelShapeSemanticEncodedFloat32,
  type KernelShapeSemanticEncodedFloat64,
  type KernelShapeSemanticEncodedMeshVec3,
  type KernelShapeSemanticEncodedVec3,
  type KernelShapeSemanticFaceV1,
  type KernelShapeSemanticLineageV1,
  type KernelShapeSemanticMeasurementsV1,
  type KernelShapeSemanticMeshOptionsV1,
  type KernelShapeSemanticMeshRequest,
  type KernelShapeSemanticMeshV1,
  type KernelShapeSemanticNativeExchangeV1,
  type KernelShapeSemanticNotApplicableFeature,
  type KernelShapeSemanticObservation,
  type KernelShapeSemanticObservationLimits,
  type KernelShapeSemanticObservationPlan,
  type KernelShapeSemanticObservationV1,
  type KernelShapeSemanticOrientedTriangleV1,
  type KernelShapeSemanticProbe,
  type KernelShapeSemanticProbeContext,
  type KernelShapeSemanticProbeObservationV1,
  type KernelShapeSemanticSnapshotV1,
  type KernelShapeSemanticStatusV1,
  type KernelShapeSemanticSurfaceV1,
  type KernelShapeSemanticTopologyV1,
  type KernelShapeSemanticVertexV1,
  type ObserveKernelShapeSemanticsOptions,
} from "./shape-semantic-observation.js";

export const KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_PROTOCOL_VERSION = 1 as const;
export const KERNEL_SHAPE_ARTIFACT_SEMANTIC_WITNESS_PREFIX =
  "invariantcad:kernel-shape-semantic:v1:sha256:" as const;
export const KERNEL_SHAPE_ARTIFACT_FIXTURE_WITNESS_PREFIX =
  "invariantcad:kernel-shape-artifact-fixture:v1:sha256:" as const;

export type KernelShapeArtifactSemanticWitness =
  `${typeof KERNEL_SHAPE_ARTIFACT_SEMANTIC_WITNESS_PREFIX}${string}`;
export type KernelShapeArtifactFixtureWitness =
  `${typeof KERNEL_SHAPE_ARTIFACT_FIXTURE_WITNESS_PREFIX}${string}`;

export interface KernelShapeArtifactCodecAuditLimits {
  readonly maxCases: number;
  readonly maxOperations: number;
  readonly maxArtifactBytes: number;
  readonly maxTotalArtifactBytes: number;
  readonly maxWitnessBytes: number;
}

export const DEFAULT_KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_LIMITS: KernelShapeArtifactCodecAuditLimits =
  Object.freeze({
    maxCases: 64,
    maxOperations: 10_000,
    maxArtifactBytes: 64 * 1024 * 1024,
    maxTotalArtifactBytes: 256 * 1024 * 1024,
    maxWitnessBytes: 16 * 1024 * 1024,
  });

export interface KernelShapeArtifactExpectedIdentity {
  readonly kernelId: string;
  readonly artifact: KernelShapeArtifactCapabilities;
}

export interface KernelShapeArtifactCodecCandidate {
  readonly capabilities: KernelShapeArtifactCapabilities;
  readonly encodeShapeArtifact: (
    shape: KernelShape,
    context: KernelShapeArtifactContext,
  ) => Awaitable<Uint8Array>;
  readonly decodeShapeArtifact: (
    artifact: Uint8Array,
    context: KernelShapeArtifactContext,
  ) => Awaitable<KernelShape>;
}

export type KernelShapeArtifactCodecAuditTarget =
  | {
      readonly mode: "candidate";
      readonly create: () => Awaitable<{
        readonly kernel: GeometryKernel;
        readonly codec: KernelShapeArtifactCodecCandidate;
      }>;
    }
  | {
      readonly mode: "advertised";
      readonly create: () => Awaitable<GeometryKernel>;
    };

export interface KernelShapeArtifactWitnessContext {
  readonly signal?: AbortSignal;
  readonly maxBytes: number;
}

export type KernelShapeArtifactWitness = (
  kernel: GeometryKernel,
  shape: KernelShape,
  context: KernelShapeArtifactWitnessContext,
) => Awaitable<CadResult<KernelShapeArtifactSemanticWitness>>;

interface KernelShapeArtifactCodecAuditCaseBase {
  /** Stable case identifier used only by the audit report. */
  readonly id: string;
  /** Stable feature label passed through to the backend codec context. */
  readonly feature: string;
  readonly expectedWitness: KernelShapeArtifactSemanticWitness;
  /**
   * Produces a bounded, key-neutral digest of every semantic this case elects
   * to audit. The callback borrows the shape and must leave it live.
   */
  readonly witness: KernelShapeArtifactWitness;
}

export interface KernelShapeArtifactSelfRoundTripCase
  extends KernelShapeArtifactCodecAuditCaseBase {
  readonly scope: "current-runtime-self-round-trip";
  readonly createSource: (
    kernel: GeometryKernel,
    context: { readonly signal?: AbortSignal },
  ) => Awaitable<KernelShape>;
}

export interface KernelShapeArtifactGoldenDecodeCase
  extends KernelShapeArtifactCodecAuditCaseBase {
  readonly scope: "golden-decode";
  /** Borrowed by the caller; the audit snapshots it before its first await. */
  readonly artifact: Uint8Array;
  readonly expectedArtifactWitness: KernelShapeArtifactFixtureWitness;
}

export type KernelShapeArtifactCodecAuditCase =
  | KernelShapeArtifactSelfRoundTripCase
  | KernelShapeArtifactGoldenDecodeCase;

export interface AuditKernelShapeArtifactCodecOptions {
  readonly target: KernelShapeArtifactCodecAuditTarget;
  readonly expectedIdentity: KernelShapeArtifactExpectedIdentity;
  readonly cases: readonly KernelShapeArtifactCodecAuditCase[];
  readonly limits?: Partial<KernelShapeArtifactCodecAuditLimits>;
  readonly signal?: AbortSignal;
}

export interface KernelShapeArtifactAuditArtifactEvidence {
  readonly role:
    | "pre-witness-source-encode"
    | "first-encode"
    | "second-encode"
    | "reduced-ceiling-encode"
    | "second-generation-encode"
    | "golden-input";
  readonly algorithm: "sha256";
  readonly digest: string;
  readonly byteLength: number;
}

export type KernelShapeArtifactCodecAuditCheck =
  | "pre-witness-source-cross-instance-decode"
  | "source-witness-before-encode"
  | "fresh-caller-owned-encode-bytes"
  | "encoded-byte-isolation-probed"
  | "encode-byte-ceiling-enforced"
  | "pre-aborted-encode-and-source-survival"
  | "same-and-cross-instance-independent-decodes"
  | "decode-input-borrowing-probed"
  | "pre-aborted-decode-and-shape-survival"
  | "decode-limits-and-malformed-input-rejection"
  | "independent-disposal-orders"
  | "semantic-idempotence-and-second-generation-ownership"
  | "golden-artifact-witness"
  | "cross-instance-golden-decode"
  | "golden-decode-input-borrowing-probed"
  | "pre-aborted-golden-decode"
  | "independent-golden-disposal";

export interface KernelShapeArtifactCodecCaseEvidence {
  readonly id: string;
  readonly feature: string;
  readonly scope:
    | "current-runtime-self-round-trip"
    | "golden-decode";
  readonly expectedWitness: KernelShapeArtifactSemanticWitness;
  readonly observedWitness: KernelShapeArtifactSemanticWitness;
  readonly artifacts: readonly KernelShapeArtifactAuditArtifactEvidence[];
  readonly checks: readonly KernelShapeArtifactCodecAuditCheck[];
}

export interface KernelShapeArtifactCodecAuditEvidence {
  readonly kind: "kernel-shape-artifact-codec-audit-evidence";
  readonly auditProtocolVersion: typeof KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_PROTOCOL_VERSION;
  /** Deliberately false: finite runtime evidence is not certification. */
  readonly certifiesCompatibility: false;
  readonly mode: "candidate" | "advertised";
  readonly advertisement: "unadvertised" | "advertised";
  readonly scopes: readonly (
    | "current-runtime-self-round-trip"
    | "golden-decode"
  )[];
  readonly expectedIdentity: KernelShapeArtifactExpectedIdentity;
  readonly limits: KernelShapeArtifactCodecAuditLimits;
  readonly usage: {
    readonly cases: number;
    readonly operations: number;
    readonly artifactBytes: number;
  };
  readonly cases: readonly KernelShapeArtifactCodecCaseEvidence[];
  readonly disclaimer: "Finite audit evidence; not certification or a cache-eligibility proof";
}

interface CapturedSelfCase {
  readonly id: string;
  readonly feature: string;
  readonly scope: "current-runtime-self-round-trip";
  readonly expectedWitness: KernelShapeArtifactSemanticWitness;
  readonly witness: KernelShapeArtifactWitness;
  readonly createSource: KernelShapeArtifactSelfRoundTripCase["createSource"];
}

interface CapturedGoldenCase {
  readonly id: string;
  readonly feature: string;
  readonly scope: "golden-decode";
  readonly expectedWitness: KernelShapeArtifactSemanticWitness;
  readonly witness: KernelShapeArtifactWitness;
  readonly artifact: Uint8Array;
  readonly expectedArtifactWitness: KernelShapeArtifactFixtureWitness;
}

type CapturedCase = CapturedSelfCase | CapturedGoldenCase;

interface CapturedOptions {
  readonly mode: "candidate" | "advertised";
  readonly create: KernelShapeArtifactCodecAuditTarget["create"];
  readonly expectedIdentity: KernelShapeArtifactExpectedIdentity;
  readonly cases: readonly CapturedCase[];
  readonly limits: KernelShapeArtifactCodecAuditLimits;
  readonly signal?: AbortSignal;
}

interface BoundRuntime {
  readonly kernel: GeometryKernel;
  readonly capabilities: KernelShapeArtifactCapabilities;
  readonly encode: KernelShapeArtifactCodecCandidate["encodeShapeArtifact"];
  readonly decode: KernelShapeArtifactCodecCandidate["decodeShapeArtifact"];
  readonly disposeShape: GeometryKernel["disposeShape"];
  readonly dispose: GeometryKernel["dispose"];
}

interface TrackedShape {
  readonly runtime: BoundRuntime;
  readonly shape: KernelShape;
  live: boolean;
}

const LIMIT_KEYS = Object.freeze(
  Object.keys(DEFAULT_KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_LIMITS) as readonly (
    keyof KernelShapeArtifactCodecAuditLimits
  )[],
);
const HEX_64 = /^[0-9a-f]{64}$/;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const ABORT_SIGNAL_ABORTED_GETTER =
  typeof AbortSignal === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const auditFailures = new WeakSet<object>();

class AuditFailure extends Error {
  readonly diagnostic: Diagnostic;

  constructor(value: Diagnostic) {
    super(value.message);
    this.name = "AuditFailure";
    this.diagnostic = value;
    auditFailures.add(this);
  }
}

function isAuditFailure(value: unknown): value is AuditFailure {
  return (
    typeof value === "object" && value !== null && auditFailures.has(value)
  );
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    keys.length === wanted.length &&
    keys.every((key, index) => key === wanted[index])
  );
}

function boundedString(
  value: unknown,
  maximum: number,
): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

interface ExactUint8ArrayInfo {
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly buffer: ArrayBuffer;
  readonly bufferByteLength: number;
}

function exactUint8ArrayInfo(value: unknown): ExactUint8ArrayInfo | undefined {
  if (
    TYPED_ARRAY_TAG_GETTER === undefined ||
    TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined ||
    TYPED_ARRAY_BYTE_OFFSET_GETTER === undefined ||
    TYPED_ARRAY_BUFFER_GETTER === undefined ||
    ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined
  ) return undefined;
  try {
    if (!ArrayBuffer.isView(value)) return undefined;
    if (Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) !== "Uint8Array") {
      return undefined;
    }
    const byteLength: unknown = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    );
    const byteOffset: unknown = Reflect.apply(
      TYPED_ARRAY_BYTE_OFFSET_GETTER,
      value,
      [],
    );
    const buffer: unknown = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []);
    const bufferByteLength: unknown = Reflect.apply(
      ARRAY_BUFFER_BYTE_LENGTH_GETTER,
      buffer,
      [],
    );
    if (
      typeof byteLength !== "number" ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      typeof byteOffset !== "number" ||
      !Number.isSafeInteger(byteOffset) ||
      byteOffset < 0 ||
      typeof bufferByteLength !== "number" ||
      !Number.isSafeInteger(bufferByteLength) ||
      bufferByteLength < 0
    ) return undefined;
    return { byteLength, byteOffset, buffer: buffer as ArrayBuffer, bufferByteLength };
  } catch {
    return undefined;
  }
}

function isUint8Array(value: unknown): value is Uint8Array {
  return exactUint8ArrayInfo(value) !== undefined;
}

function copyExactUint8Array(value: unknown): Uint8Array | undefined {
  const info = exactUint8ArrayInfo(value);
  if (info === undefined) return undefined;
  try {
    const copied = new Uint8Array(info.byteLength);
    Reflect.apply(Uint8Array.prototype.set, copied, [value]);
    return copied;
  } catch {
    return undefined;
  }
}

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.byteLength !== second.byteLength) return false;
  for (let index = 0; index < first.byteLength; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function taggedDigest(
  value: unknown,
  prefix: string,
): value is `${string}${string}` {
  return (
    typeof value === "string" &&
    value.startsWith(prefix) &&
    HEX_64.test(value.slice(prefix.length))
  );
}

function abortDiagnostic(message = "Kernel shape-artifact audit was aborted") {
  return diagnostic("EVALUATION_ABORTED", message, { severity: "error" });
}

function abortSignalIsAborted(signal: AbortSignal | undefined): boolean {
  if (signal === undefined) return false;
  try {
    return ABORT_SIGNAL_ABORTED_GETTER !== undefined &&
      Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) === true;
  } catch {
    // A signal that becomes unreadable after validation is fail-closed.
    return true;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (abortSignalIsAborted(signal)) {
    throw new AuditFailure(abortDiagnostic());
  }
}

function isAbortError(error: unknown): boolean {
  try {
    return (
      typeof error === "object" &&
      error !== null &&
      Reflect.get(error, "name") === "AbortError"
    );
  } catch {
    return false;
  }
}

function invalidOptions(message: string, details?: Readonly<Record<string, unknown>>) {
  return failure(
    diagnostic("ARTIFACT_CACHE_ENTRY_INVALID", message, {
      severity: "error",
      ...(details === undefined ? {} : { details }),
    }),
  );
}

function captureLimits(
  raw: unknown,
): CadResult<KernelShapeArtifactCodecAuditLimits> {
  if (raw === undefined) {
    return success(DEFAULT_KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_LIMITS);
  }
  try {
    if (!isPlainRecord(raw)) {
      return invalidOptions("Kernel shape-artifact audit limits must be an object");
    }
    if (
      Object.keys(raw).some(
        (key) =>
          !LIMIT_KEYS.includes(key as keyof KernelShapeArtifactCodecAuditLimits),
      )
    ) {
      return invalidOptions("Kernel shape-artifact audit limits contain unknown fields");
    }
    const output: Record<keyof KernelShapeArtifactCodecAuditLimits, number> = {
      ...DEFAULT_KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_LIMITS,
    };
    for (const key of LIMIT_KEYS) {
      if (!Object.hasOwn(raw, key)) continue;
      const value = raw[key];
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1
      ) {
        return invalidOptions(`Kernel shape-artifact audit limit ${key} must be a positive safe integer`);
      }
      output[key] = value;
    }
    if (output.maxTotalArtifactBytes < output.maxArtifactBytes) {
      return invalidOptions(
        "maxTotalArtifactBytes must be greater than or equal to maxArtifactBytes",
      );
    }
    return success(Object.freeze(output));
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Kernel shape-artifact audit limits could not be inspected"),
    );
  }
}

function captureIdentity(
  raw: unknown,
): CadResult<KernelShapeArtifactExpectedIdentity> {
  try {
    if (
      !isPlainRecord(raw) ||
      !exactKeys(raw, ["kernelId", "artifact"]) ||
      !boundedString(raw.kernelId, 256) ||
      !isPlainRecord(raw.artifact) ||
      !exactKeys(raw.artifact, [
        "protocolVersion",
        "format",
        "formatVersion",
        "compatibilityFingerprint",
      ]) ||
      raw.artifact.protocolVersion !== KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION ||
      !boundedString(raw.artifact.format, 256) ||
      typeof raw.artifact.formatVersion !== "number" ||
      !Number.isSafeInteger(raw.artifact.formatVersion) ||
      raw.artifact.formatVersion < 1 ||
      !isCanonicalUtf8StringWithin(
        raw.artifact.compatibilityFingerprint,
        KERNEL_SHAPE_ARTIFACT_MAX_COMPATIBILITY_FINGERPRINT_BYTES,
      )
    ) {
      return invalidOptions(
        "Kernel shape-artifact audit expectedIdentity is malformed",
      );
    }
    return success(
      deepFreeze({
        kernelId: raw.kernelId,
        artifact: {
          protocolVersion: KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
          format: raw.artifact.format,
          formatVersion: raw.artifact.formatVersion,
          compatibilityFingerprint: raw.artifact.compatibilityFingerprint,
        },
      }),
    );
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Kernel shape-artifact identity could not be inspected"),
    );
  }
}

function captureSignal(value: unknown): CadResult<AbortSignal | undefined> {
  if (value === undefined) return success(undefined);
  try {
    if (
      typeof AbortSignal !== "undefined" &&
      value instanceof AbortSignal &&
      ABORT_SIGNAL_ABORTED_GETTER !== undefined &&
      typeof Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, value, []) === "boolean"
    ) {
      return success(value);
    }
  } catch {
    // Fall through to the structured diagnostic.
  }
  return invalidOptions("Kernel shape-artifact audit signal must be an AbortSignal");
}

function captureCases(
  raw: unknown,
  limits: KernelShapeArtifactCodecAuditLimits,
): CadResult<readonly CapturedCase[]> {
  try {
    if (!Array.isArray(raw) || raw.length === 0) {
      return invalidOptions("Kernel shape-artifact audit cases must be a non-empty array");
    }
    if (raw.length > limits.maxCases) {
      return failure(
        diagnostic(
          "ARTIFACT_CACHE_LIMIT_EXCEEDED",
          "Kernel shape-artifact audit case count exceeds maxCases",
          {
            severity: "error",
            details: { actual: raw.length, limit: limits.maxCases },
          },
        ),
      );
    }
    const output: CapturedCase[] = [];
    const identifiers = new Set<string>();
    let selfCases = 0;
    let goldenCases = 0;
    let goldenBytes = 0;
    for (let index = 0; index < raw.length; index += 1) {
      const value: unknown = raw[index];
      if (!isPlainRecord(value)) {
        return invalidOptions("Kernel shape-artifact audit case must be an object", {
          index,
        });
      }
      const scope = value.scope;
      const expectedKeys =
        scope === "current-runtime-self-round-trip"
          ? [
              "id",
              "feature",
              "scope",
              "expectedWitness",
              "witness",
              "createSource",
            ]
          : scope === "golden-decode"
            ? [
                "id",
                "feature",
                "scope",
                "expectedWitness",
                "witness",
                "artifact",
                "expectedArtifactWitness",
              ]
            : [];
      if (
        expectedKeys.length === 0 ||
        !exactKeys(value, expectedKeys) ||
        !boundedString(value.id, 256) ||
        !boundedString(value.feature, 1_024) ||
        identifiers.has(value.id) ||
        !taggedDigest(
          value.expectedWitness,
          KERNEL_SHAPE_ARTIFACT_SEMANTIC_WITNESS_PREFIX,
        ) ||
        typeof value.witness !== "function"
      ) {
        return invalidOptions("Kernel shape-artifact audit case is malformed", {
          index,
        });
      }
      identifiers.add(value.id);
      if (scope === "current-runtime-self-round-trip") {
        if (typeof value.createSource !== "function") {
          return invalidOptions("Self-round-trip case createSource must be a function", {
            index,
          });
        }
        selfCases += 1;
        output.push(
          Object.freeze({
            id: value.id,
            feature: value.feature,
            scope: "current-runtime-self-round-trip",
            expectedWitness: value.expectedWitness as KernelShapeArtifactSemanticWitness,
            witness: value.witness as KernelShapeArtifactWitness,
            createSource:
              value.createSource as KernelShapeArtifactSelfRoundTripCase["createSource"],
          }),
        );
      } else {
        const artifactInfo = exactUint8ArrayInfo(value.artifact);
        if (
          artifactInfo === undefined ||
          artifactInfo.byteLength === 0 ||
          artifactInfo.byteLength > limits.maxArtifactBytes ||
          !taggedDigest(
            value.expectedArtifactWitness,
            KERNEL_SHAPE_ARTIFACT_FIXTURE_WITNESS_PREFIX,
          )
        ) {
          return invalidOptions("Golden-decode case artifact is malformed", {
            index,
          });
        }
        goldenBytes += artifactInfo.byteLength;
        if (goldenBytes > limits.maxTotalArtifactBytes) {
          return failure(
            diagnostic(
              "ARTIFACT_CACHE_LIMIT_EXCEEDED",
              "Golden artifact snapshots exceed maxTotalArtifactBytes",
              {
                severity: "error",
                details: {
                  actual: goldenBytes,
                  limit: limits.maxTotalArtifactBytes,
                },
              },
            ),
          );
        }
        const artifact = copyExactUint8Array(value.artifact);
        if (artifact === undefined) {
          return invalidOptions("Golden-decode case artifact could not be copied", {
            index,
          });
        }
        goldenCases += 1;
        output.push(
          Object.freeze({
            id: value.id,
            feature: value.feature,
            scope: "golden-decode",
            expectedWitness: value.expectedWitness as KernelShapeArtifactSemanticWitness,
            witness: value.witness as KernelShapeArtifactWitness,
            artifact,
            expectedArtifactWitness:
              value.expectedArtifactWitness as KernelShapeArtifactFixtureWitness,
          }),
        );
      }
    }
    if (selfCases === 0 || goldenCases === 0) {
      return invalidOptions(
        "Kernel shape-artifact audit requires at least one self-round-trip case and one golden-decode case",
      );
    }
    return success(Object.freeze(output));
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Kernel shape-artifact audit cases could not be captured"),
    );
  }
}

function captureOptions(raw: unknown): CadResult<CapturedOptions> {
  try {
    if (
      !isPlainRecord(raw) ||
      !exactKeys(raw, [
        "target",
        "expectedIdentity",
        "cases",
        ...(Object.hasOwn(raw, "limits") ? ["limits"] : []),
        ...(Object.hasOwn(raw, "signal") ? ["signal"] : []),
      ]) ||
      !isPlainRecord(raw.target) ||
      !exactKeys(raw.target, ["mode", "create"]) ||
      (raw.target.mode !== "candidate" && raw.target.mode !== "advertised") ||
      typeof raw.target.create !== "function"
    ) {
      return invalidOptions("Kernel shape-artifact audit options are malformed");
    }
    const limits = captureLimits(raw.limits);
    if (!limits.ok) return limits;
    const expectedIdentity = captureIdentity(raw.expectedIdentity);
    if (!expectedIdentity.ok) return expectedIdentity;
    const signal = captureSignal(raw.signal);
    if (!signal.ok) return signal;
    const cases = captureCases(raw.cases, limits.value);
    if (!cases.ok) return cases;
    return success(
      Object.freeze({
        mode: raw.target.mode,
        create: raw.target.create as KernelShapeArtifactCodecAuditTarget["create"],
        expectedIdentity: expectedIdentity.value,
        cases: cases.value,
        limits: limits.value,
        ...(signal.value === undefined ? {} : { signal: signal.value }),
      }),
    );
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Kernel shape-artifact audit options could not be captured"),
    );
  }
}

function encodeBoundedUtf8(value: string, maximum: number): Uint8Array | undefined {
  if (value.length > maximum) return undefined;
  // UTF-8 needs at most three bytes per UTF-16 code unit. Cap the allocation
  // at maxBytes + 1 so oversize detection never scales with hostile input.
  const capacity = Math.min(maximum + 1, Math.max(1, value.length * 3));
  const target = new Uint8Array(capacity);
  const result = new TextEncoder().encodeInto(value, target);
  if (result.read !== value.length || result.written > maximum) return undefined;
  return target.slice(0, result.written);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashBounded(
  input: string | Uint8Array,
  prefix: string,
  options: { readonly maxBytes?: number; readonly signal?: AbortSignal } = {},
): Promise<CadResult<string>> {
  let maximum: number;
  let rawSignal: unknown;
  try {
    if (!isPlainRecord(options)) {
      return invalidOptions("Witness hashing options must be an object");
    }
    if (
      Object.keys(options).some(
        (key) => key !== "maxBytes" && key !== "signal",
      )
    ) {
      return invalidOptions("Witness hashing options contain unknown fields");
    }
    const rawMaximum = Object.hasOwn(options, "maxBytes")
      ? options.maxBytes
      : undefined;
    maximum = rawMaximum === undefined
      ? DEFAULT_KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_LIMITS.maxWitnessBytes
      : rawMaximum as number;
    rawSignal = Object.hasOwn(options, "signal")
      ? options.signal
      : undefined;
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Witness hashing options could not be inspected"),
    );
  }
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    return invalidOptions("Witness maxBytes must be a positive safe integer");
  }
  const signal = captureSignal(rawSignal);
  if (!signal.ok) return signal;
  if (
    signal.value !== undefined &&
    abortSignalIsAborted(signal.value)
  ) {
    return failure(abortDiagnostic("Witness hashing was aborted"));
  }
  let bytes: Uint8Array | undefined;
  try {
    if (typeof input === "string") {
      bytes = encodeBoundedUtf8(input, maximum);
    } else {
      const info = exactUint8ArrayInfo(input);
      bytes =
        info !== undefined && info.byteLength <= maximum
          ? copyExactUint8Array(input)
          : undefined;
    }
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Witness input could not be captured"),
    );
  }
  if (bytes === undefined) {
    return failure(
      diagnostic("ARTIFACT_CACHE_LIMIT_EXCEEDED", "Witness input exceeds maxBytes", {
        severity: "error",
        details: { limit: maximum },
      }),
    );
  }
  try {
    const digest = await sha256(bytes);
    if (
      signal.value !== undefined &&
      abortSignalIsAborted(signal.value)
    ) {
      return failure(abortDiagnostic("Witness hashing was aborted"));
    }
    return success(`${prefix}${digest}`);
  } catch (error) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_OPERATION_FAILED",
        safeErrorMessage(error, "Witness hashing failed"),
        { severity: "error" },
      ),
    );
  }
}

/** Hashes a caller-canonicalized semantic observation under a fixed domain. */
export async function hashKernelShapeArtifactSemanticWitness(
  input: string | Uint8Array,
  options?: { readonly maxBytes?: number; readonly signal?: AbortSignal },
): Promise<CadResult<KernelShapeArtifactSemanticWitness>> {
  const result = await hashBounded(
    input,
    KERNEL_SHAPE_ARTIFACT_SEMANTIC_WITNESS_PREFIX,
    options,
  );
  return result.ok
    ? success(result.value as KernelShapeArtifactSemanticWitness)
    : result;
}

/** Encodes and hashes one repository-canonical semantic observation. */
export async function hashKernelShapeSemanticObservation(
  observation: KernelShapeSemanticObservation,
  options?: { readonly maxBytes?: number; readonly signal?: AbortSignal },
): Promise<CadResult<KernelShapeArtifactSemanticWitness>> {
  let maximum: number | undefined;
  let signal: AbortSignal | undefined;
  try {
    if (
      options !== undefined &&
      (!isPlainRecord(options) ||
        Object.keys(options).some(
          (key) => key !== "maxBytes" && key !== "signal",
        ))
    ) {
      return invalidOptions("Semantic observation hashing options are malformed");
    }
    maximum =
      options !== undefined && Object.hasOwn(options, "maxBytes")
        ? options.maxBytes
        : undefined;
    signal =
      options !== undefined && Object.hasOwn(options, "signal")
        ? options.signal
        : undefined;
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(
        error,
        "Semantic observation hashing options could not be inspected",
      ),
    );
  }
  const capturedSignal = captureSignal(signal);
  if (!capturedSignal.ok) return capturedSignal;
  if (
    capturedSignal.value !== undefined &&
    abortSignalIsAborted(capturedSignal.value)
  ) {
    return failure(abortDiagnostic("Semantic observation hashing was aborted"));
  }
  const encoded = encodeKernelShapeSemanticObservation(observation, {
    ...(maximum === undefined ? {} : { maxBytes: maximum }),
  });
  if (!encoded.ok) return encoded;
  return hashKernelShapeArtifactSemanticWitness(encoded.value, {
    ...(maximum === undefined ? {} : { maxBytes: maximum }),
    ...(capturedSignal.value === undefined
      ? {}
      : { signal: capturedSignal.value }),
  });
}

/** Hashes immutable golden bytes under a distinct fixture domain. */
export async function hashKernelShapeArtifactFixtureWitness(
  input: Uint8Array,
  options?: { readonly maxBytes?: number; readonly signal?: AbortSignal },
): Promise<CadResult<KernelShapeArtifactFixtureWitness>> {
  const result = await hashBounded(
    input,
    KERNEL_SHAPE_ARTIFACT_FIXTURE_WITNESS_PREFIX,
    options,
  );
  return result.ok
    ? success(result.value as KernelShapeArtifactFixtureWitness)
    : result;
}

function sameCapabilities(
  actual: KernelShapeArtifactCapabilities,
  expected: KernelShapeArtifactCapabilities,
): boolean {
  return (
    actual.protocolVersion === expected.protocolVersion &&
    actual.format === expected.format &&
    actual.formatVersion === expected.formatVersion &&
    actual.compatibilityFingerprint === expected.compatibilityFingerprint
  );
}

function capabilityFailure(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AuditFailure {
  return new AuditFailure(
    diagnostic("KERNEL_CAPABILITY_MISSING", message, {
      severity: "error",
      ...(details === undefined ? {} : { details }),
    }),
  );
}

function kernelFailure(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AuditFailure {
  return new AuditFailure(
    diagnostic("KERNEL_ERROR", message, {
      severity: "error",
      ...(details === undefined ? {} : { details }),
    }),
  );
}

function malformedCodecFailure(message: string): AuditFailure {
  return new AuditFailure(
    diagnostic("ARTIFACT_CACHE_ENTRY_INVALID", message, { severity: "error" }),
  );
}

function normalizeCandidateCapabilities(
  value: unknown,
): KernelShapeArtifactCapabilities | undefined {
  try {
    if (
      !isPlainRecord(value) ||
      !exactKeys(value, [
        "protocolVersion",
        "format",
        "formatVersion",
        "compatibilityFingerprint",
      ]) ||
      value.protocolVersion !== KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION ||
      !boundedString(value.format, 256) ||
      typeof value.formatVersion !== "number" ||
      !Number.isSafeInteger(value.formatVersion) ||
      value.formatVersion < 1 ||
      !isCanonicalUtf8StringWithin(
        value.compatibilityFingerprint,
        KERNEL_SHAPE_ARTIFACT_MAX_COMPATIBILITY_FINGERPRINT_BYTES,
      )
    ) {
      return undefined;
    }
    return Object.freeze({
      protocolVersion: KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
      format: value.format,
      formatVersion: value.formatVersion,
      compatibilityFingerprint: value.compatibilityFingerprint,
    });
  } catch {
    return undefined;
  }
}

function advertisedCodec(
  kernel: GeometryKernel,
  inspection: KernelShapeArtifactSupportInspection,
): Omit<BoundRuntime, "disposeShape" | "dispose"> {
  if (inspection.status !== "supported") {
    throw capabilityFailure(
      inspection.status === "absent"
        ? "Advertised audit target does not advertise shape-artifact support"
        : inspection.message,
    );
  }
  const encode = kernel.encodeShapeArtifact;
  const decode = kernel.decodeShapeArtifact;
  if (typeof encode !== "function" || typeof decode !== "function") {
    throw capabilityFailure("Advertised artifact codec methods disappeared during capture");
  }
  return {
    kernel,
    capabilities: inspection.capabilities,
    encode: encode.bind(kernel),
    decode: decode.bind(kernel),
  };
}

function candidateCodec(
  kernel: GeometryKernel,
  raw: unknown,
): Omit<BoundRuntime, "disposeShape" | "dispose"> {
  const inspection = inspectKernelShapeArtifactSupport(kernel);
  if (inspection.status !== "absent") {
    throw capabilityFailure(
      inspection.status === "malformed"
        ? inspection.message
        : "Candidate audit requires the production kernel codec declaration to remain absent",
    );
  }
  try {
    if (!isPlainRecord(raw)) {
      throw malformedCodecFailure("Candidate artifact codec must be an object");
    }
    const capabilities = normalizeCandidateCapabilities(raw.capabilities);
    const encode = raw.encodeShapeArtifact;
    const decode = raw.decodeShapeArtifact;
    if (
      capabilities === undefined ||
      typeof encode !== "function" ||
      typeof decode !== "function"
    ) {
      throw malformedCodecFailure("Candidate artifact codec is incomplete or malformed");
    }
    return {
      kernel,
      capabilities,
      encode: encode.bind(raw) as KernelShapeArtifactCodecCandidate["encodeShapeArtifact"],
      decode: decode.bind(raw) as KernelShapeArtifactCodecCandidate["decodeShapeArtifact"],
    };
  } catch (error) {
    if (isAuditFailure(error)) throw error;
    throw malformedCodecFailure(
      safeErrorMessage(error, "Candidate artifact codec could not be captured"),
    );
  }
}

function assertRuntimeIdentity(
  runtime: BoundRuntime,
  expected: KernelShapeArtifactExpectedIdentity,
): void {
  let id: string;
  try {
    id = runtime.kernel.id;
  } catch (error) {
    throw capabilityFailure(
      safeErrorMessage(error, "Kernel ID could not be inspected"),
    );
  }
  if (id !== expected.kernelId || !sameCapabilities(runtime.capabilities, expected.artifact)) {
    throw capabilityFailure("Kernel shape-artifact identity does not exactly match expectedIdentity", {
      expectedKernelId: expected.kernelId,
      actualKernelId: id,
      expectedFormat: expected.artifact.format,
      actualFormat: runtime.capabilities.format,
      expectedFormatVersion: expected.artifact.formatVersion,
      actualFormatVersion: runtime.capabilities.formatVersion,
      expectedCompatibilityFingerprint: expected.artifact.compatibilityFingerprint,
      actualCompatibilityFingerprint: runtime.capabilities.compatibilityFingerprint,
    });
  }
}

function artifactEvidence(
  role: KernelShapeArtifactAuditArtifactEvidence["role"],
  bytes: Uint8Array,
  digest: string,
): KernelShapeArtifactAuditArtifactEvidence {
  return Object.freeze({
    role,
    algorithm: "sha256",
    digest,
    byteLength: bytes.byteLength,
  });
}

function detachOrMutate(bytes: Uint8Array): void {
  const info = exactUint8ArrayInfo(bytes);
  if (info === undefined) return;
  try {
    structuredClone(info.buffer, { transfer: [info.buffer] });
    return;
  } catch {
    // Environments without transferable ArrayBuffers still get a mutation probe.
  }
  for (let index = 0; index < bytes.byteLength; index += 1) {
    bytes[index] = bytes[index]! ^ 0xff;
  }
}

/**
 * Audits finite runtime evidence for an explicitly identified shape codec.
 * Passing is deliberately not a certification or cache-eligibility token.
 */
export async function auditKernelShapeArtifactCodec(
  options: AuditKernelShapeArtifactCodecOptions,
): Promise<CadResult<KernelShapeArtifactCodecAuditEvidence>> {
  const captured = captureOptions(options);
  if (!captured.ok) return captured;
  const configuration = captured.value;
  if (
    configuration.signal !== undefined &&
    abortSignalIsAborted(configuration.signal)
  ) {
    return failure(abortDiagnostic());
  }

  const runtimes: BoundRuntime[] = [];
  const disposedKernels = new Set<GeometryKernel>();
  const shapes: TrackedShape[] = [];
  const caseEvidence: KernelShapeArtifactCodecCaseEvidence[] = [];
  let operations = 0;
  let artifactBytes = 0;
  let outcome: CadResult<KernelShapeArtifactCodecAuditEvidence> | undefined;
  const cleanupDiagnostics: Diagnostic[] = [];

  const disposeRuntime = (
    runtime: BoundRuntime,
    label: string,
  ): void => {
    if (disposedKernels.has(runtime.kernel)) return;
    disposedKernels.add(runtime.kernel);
    try {
      runtime.dispose();
    } catch (error) {
      throw kernelFailure(
        safeErrorMessage(error, `${label} kernel cleanup failed`),
      );
    }
  };

  const operation = (): void => {
    throwIfAborted(configuration.signal);
    operations += 1;
    if (operations > configuration.limits.maxOperations) {
      throw new AuditFailure(
        diagnostic(
          "ARTIFACT_CACHE_LIMIT_EXCEEDED",
          "Kernel shape-artifact audit exceeded maxOperations",
          {
            severity: "error",
            details: {
              actual: operations,
              limit: configuration.limits.maxOperations,
            },
          },
        ),
      );
    }
  };

  const accountArtifact = (bytes: Uint8Array): void => {
    artifactBytes += bytes.byteLength;
    if (artifactBytes > configuration.limits.maxTotalArtifactBytes) {
      throw new AuditFailure(
        diagnostic(
          "ARTIFACT_CACHE_LIMIT_EXCEEDED",
          "Kernel shape-artifact audit exceeded maxTotalArtifactBytes",
          {
            severity: "error",
            details: {
              actual: artifactBytes,
              limit: configuration.limits.maxTotalArtifactBytes,
            },
          },
        ),
      );
    }
  };

  const adopt = (runtime: BoundRuntime, raw: unknown, label: string): TrackedShape => {
    if (typeof raw !== "object" || raw === null) {
      throw malformedCodecFailure(
        `${label} did not return a KernelShape object`,
      );
    }
    const shape = raw as KernelShape;
    if (shapes.some((tracked) => tracked.shape === shape)) {
      throw kernelFailure(`${label} reused an existing shape instead of returning a new owner`);
    }
    const tracked = { runtime, shape, live: true };
    // Adopt before inspecting public fields so a malformed but native-owning
    // wrapper is still released on every failure path.
    shapes.push(tracked);
    let kernelId: unknown;
    try {
      kernelId = Reflect.get(raw, "kernel");
    } catch (error) {
      throw malformedCodecFailure(
        `${label} did not return an inspectable KernelShape: ${safeErrorMessage(error)}`,
      );
    }
    if (kernelId !== configuration.expectedIdentity.kernelId) {
      throw malformedCodecFailure(
        `${label} returned a shape for a different kernel`,
      );
    }
    return tracked;
  };

  const disposeTracked = (tracked: TrackedShape): void => {
    if (!tracked.live) return;
    tracked.live = false;
    try {
      tracked.runtime.disposeShape(tracked.shape);
    } catch (error) {
      throw kernelFailure(
        safeErrorMessage(error, "Kernel shape disposal failed during artifact audit"),
      );
    }
  };

  const createSource = async (
    item: CapturedSelfCase,
    runtime: BoundRuntime,
    label: string,
  ): Promise<TrackedShape> => {
    operation();
    let raw: unknown;
    try {
      raw = await item.createSource(runtime.kernel, {
        ...(configuration.signal === undefined
          ? {}
          : { signal: configuration.signal }),
      });
    } catch (error) {
      if (abortSignalIsAborted(configuration.signal) || isAbortError(error)) {
        throw new AuditFailure(abortDiagnostic(`${label} was aborted`));
      }
      throw kernelFailure(`${label} failed: ${safeErrorMessage(error)}`);
    }
    const source = adopt(runtime, raw, label);
    throwIfAborted(configuration.signal);
    return source;
  };

  const observe = async (
    item: CapturedCase,
    tracked: TrackedShape,
    label: string,
  ): Promise<KernelShapeArtifactSemanticWitness> => {
    if (!tracked.live) throw kernelFailure(`${label} attempted to witness a disposed shape`);
    operation();
    try {
      const status = tracked.runtime.kernel.status(tracked.shape);
      if (
        typeof status !== "object" ||
        status === null ||
        status.ok !== true ||
        typeof status.code !== "string"
      ) {
        throw kernelFailure(`${label} did not expose a live, valid kernel shape`);
      }
    } catch (error) {
      if (isAuditFailure(error)) throw error;
      throw kernelFailure(
        `${label} status check threw: ${safeErrorMessage(error)}`,
      );
    }
    let result: CadResult<KernelShapeArtifactSemanticWitness>;
    try {
      result = await item.witness(tracked.runtime.kernel, tracked.shape, {
        ...(configuration.signal === undefined
          ? {}
          : { signal: configuration.signal }),
        maxBytes: configuration.limits.maxWitnessBytes,
      });
      throwIfAborted(configuration.signal);
    } catch (error) {
      if (abortSignalIsAborted(configuration.signal) || isAbortError(error)) {
        throw new AuditFailure(abortDiagnostic(`${label} was aborted`));
      }
      throw kernelFailure(
        `${label} witness threw: ${safeErrorMessage(error)}`,
      );
    }
    if (!result.ok) {
      if (abortSignalIsAborted(configuration.signal)) {
        throw new AuditFailure(abortDiagnostic());
      }
      const first = result.diagnostics[0];
      throw kernelFailure(
        first?.message ?? `${label} witness returned a failed result`,
        { case: item.id, phase: label },
      );
    }
    if (
      !taggedDigest(
        result.value,
        KERNEL_SHAPE_ARTIFACT_SEMANTIC_WITNESS_PREFIX,
      )
    ) {
      throw malformedCodecFailure(`${label} witness returned a malformed digest`);
    }
    if (result.value !== item.expectedWitness) {
      throw kernelFailure(`${label} semantic witness did not match expectedWitness`, {
        case: item.id,
        expectedWitness: item.expectedWitness,
        actualWitness: result.value,
      });
    }
    return result.value;
  };

  const encode = async (
    runtime: BoundRuntime,
    shape: KernelShape,
    feature: string,
    maximum: number,
  ): Promise<{ readonly returned: Uint8Array; readonly snapshot: Uint8Array }> => {
    operation();
    let raw: unknown;
    try {
      raw = await runtime.encode(shape, {
        feature,
        ...(configuration.signal === undefined
          ? {}
          : { signal: configuration.signal }),
        maxArtifactBytes: maximum,
      });
      throwIfAborted(configuration.signal);
    } catch (error) {
      if (abortSignalIsAborted(configuration.signal) || isAbortError(error)) {
        throw new AuditFailure(abortDiagnostic("Shape-artifact encode was aborted"));
      }
      throw kernelFailure(`Shape-artifact encode failed: ${safeErrorMessage(error)}`);
    }
    const info = exactUint8ArrayInfo(raw);
    if (
      info === undefined ||
      info.byteOffset !== 0 ||
      info.byteLength !== info.bufferByteLength ||
      info.byteLength === 0
    ) {
      throw malformedCodecFailure(
        "Shape-artifact encode must return one non-empty, full, caller-owned Uint8Array",
      );
    }
    if (info.byteLength > maximum) {
      throw new AuditFailure(
        diagnostic(
          "ARTIFACT_CACHE_LIMIT_EXCEEDED",
          "Shape-artifact encoder returned bytes beyond maxArtifactBytes",
          {
            severity: "error",
            details: { actual: info.byteLength, limit: maximum },
          },
        ),
      );
    }
    const snapshot = copyExactUint8Array(raw);
    if (snapshot === undefined) {
      throw malformedCodecFailure("Shape-artifact encode output could not be copied");
    }
    accountArtifact(snapshot);
    return { returned: raw as Uint8Array, snapshot };
  };

  const decode = async (
    runtime: BoundRuntime,
    bytes: Uint8Array,
    feature: string,
    maximum: number,
    label: string,
  ): Promise<TrackedShape> => {
    operation();
    const before = bytes.slice();
    let raw: unknown;
    try {
      raw = await runtime.decode(bytes, {
        feature,
        ...(configuration.signal === undefined
          ? {}
          : { signal: configuration.signal }),
        maxArtifactBytes: maximum,
      });
    } catch (error) {
      if (abortSignalIsAborted(configuration.signal) || isAbortError(error)) {
        throw new AuditFailure(abortDiagnostic(`${label} was aborted`));
      }
      throw kernelFailure(`${label} failed: ${safeErrorMessage(error)}`);
    }
    if (!bytesEqual(bytes, before)) {
      if (typeof raw === "object" && raw !== null) adopt(runtime, raw, label);
      throw kernelFailure(`${label} mutated its borrowed artifact input`);
    }
    const tracked = adopt(runtime, raw, label);
    throwIfAborted(configuration.signal);
    return tracked;
  };

  const expectAbortedEncode = async (
    runtime: BoundRuntime,
    shape: KernelShape,
    feature: string,
  ): Promise<void> => {
    operation();
    const controller = new AbortController();
    controller.abort();
    try {
      const raw = await runtime.encode(shape, {
        feature,
        signal: controller.signal,
        maxArtifactBytes: configuration.limits.maxArtifactBytes,
      });
      const copied = copyExactUint8Array(raw);
      if (copied !== undefined) accountArtifact(copied);
      throw kernelFailure("Pre-aborted shape-artifact encode unexpectedly succeeded");
    } catch (error) {
      if (isAuditFailure(error)) throw error;
      if (!isAbortError(error)) {
        throw kernelFailure(
          "Pre-aborted shape-artifact encode did not reject with AbortError",
        );
      }
    }
  };

  const expectRejectedDecode = async (
    runtime: BoundRuntime,
    bytes: Uint8Array,
    feature: string,
    maximum: number,
    label: string,
    signal?: AbortSignal,
  ): Promise<void> => {
    operation();
    const before = bytes.slice();
    const activeSignal = signal ?? configuration.signal;
    try {
      const raw = await runtime.decode(bytes, {
        feature,
        ...(activeSignal === undefined ? {} : { signal: activeSignal }),
        maxArtifactBytes: maximum,
      });
      throwIfAborted(configuration.signal);
      if (typeof raw === "object" && raw !== null) {
        const leaked = adopt(runtime, raw, label);
        disposeTracked(leaked);
      }
      throw kernelFailure(`${label} unexpectedly succeeded`);
    } catch (error) {
      if (isAuditFailure(error)) throw error;
      if (abortSignalIsAborted(configuration.signal)) {
        throw new AuditFailure(abortDiagnostic(`${label} was aborted`));
      }
      if (abortSignalIsAborted(signal) && !isAbortError(error)) {
        throw kernelFailure(`${label} did not reject with AbortError`);
      }
    }
    if (!bytesEqual(bytes, before)) {
      throw kernelFailure(`${label} mutated its borrowed artifact input`);
    }
  };

  const makeRuntime = async (): Promise<BoundRuntime> => {
    operation();
    let created: unknown;
    try {
      created = await configuration.create();
    } catch (error) {
      if (abortSignalIsAborted(configuration.signal) || isAbortError(error)) {
        throw new AuditFailure(abortDiagnostic("Kernel audit target creation was aborted"));
      }
      throw kernelFailure(
        `Kernel audit target creation failed: ${safeErrorMessage(error)}`,
      );
    }
    if (abortSignalIsAborted(configuration.signal)) {
      try {
        const rawKernel =
          configuration.mode === "advertised"
            ? created
            : isPlainRecord(created)
              ? created.kernel
              : undefined;
        if (
          typeof rawKernel === "object" &&
          rawKernel !== null &&
          !runtimes.some((runtime) => runtime.kernel === rawKernel) &&
          typeof Reflect.get(rawKernel, "dispose") === "function"
        ) {
          Reflect.apply(Reflect.get(rawKernel, "dispose"), rawKernel, []);
        }
      } catch (cleanupError) {
        cleanupDiagnostics.push(
          diagnostic(
            "KERNEL_ERROR",
            safeErrorMessage(
              cleanupError,
              "Kernel cleanup failed after target creation was aborted",
            ),
            { severity: "error" },
          ),
        );
      }
      throw new AuditFailure(abortDiagnostic("Kernel audit target creation was aborted"));
    }
    let kernel: GeometryKernel | undefined;
    try {
      let partial: Omit<BoundRuntime, "disposeShape" | "dispose">;
      if (configuration.mode === "advertised") {
        kernel = created as GeometryKernel;
        partial = advertisedCodec(kernel, inspectKernelShapeArtifactSupport(kernel));
      } else {
        if (!isPlainRecord(created)) {
          throw malformedCodecFailure(
            "Candidate target factory must return { kernel, codec }",
          );
        }
        kernel = created.kernel as GeometryKernel;
        partial = candidateCodec(kernel, created.codec);
      }
      if (
        typeof kernel.disposeShape !== "function" ||
        typeof kernel.dispose !== "function"
      ) {
        throw new TypeError("kernel cleanup methods are missing");
      }
      const disposeShape = kernel.disposeShape.bind(kernel);
      const dispose = kernel.dispose.bind(kernel);
      const runtime = { ...partial, disposeShape, dispose };
      assertRuntimeIdentity(runtime, configuration.expectedIdentity);
      if (runtimes.some((existing) => existing.kernel === kernel)) {
        throw kernelFailure(
          "Audit target factory reused a kernel instance where a fresh runtime was required",
        );
      }
      runtimes.push(runtime);
      return runtime;
    } catch (error) {
      if (
        kernel !== undefined &&
        !runtimes.some((runtime) => runtime.kernel === kernel)
      ) {
        try {
          if (typeof kernel.dispose === "function") kernel.dispose();
        } catch (cleanupError) {
          cleanupDiagnostics.push(
            diagnostic(
              "KERNEL_ERROR",
              safeErrorMessage(
                cleanupError,
                "Kernel cleanup failed after audit target capture",
              ),
              { severity: "error" },
            ),
          );
        }
      }
      if (isAuditFailure(error)) throw error;
      throw malformedCodecFailure(
        safeErrorMessage(error, "Kernel audit target could not be captured"),
      );
    }
  };

  try {
    const producer = await makeRuntime();
    const consumer = await makeRuntime();
    if (producer.kernel === consumer.kernel) {
      throw kernelFailure(
        "Audit target factory returned the same kernel instance twice; cross-instance evidence requires fresh kernels",
      );
    }

    // Decode committed fixtures before any current encoder can seed process
    // state. This still is not a substitute for an external process matrix.
    const orderedCases = [
      ...configuration.cases.filter((item) => item.scope === "golden-decode"),
      ...configuration.cases.filter(
        (item) => item.scope === "current-runtime-self-round-trip",
      ),
    ];
    for (const item of orderedCases) {
      throwIfAborted(configuration.signal);
      const artifacts: KernelShapeArtifactAuditArtifactEvidence[] = [];
      const checks: KernelShapeArtifactCodecAuditCheck[] = [];
      let observed: KernelShapeArtifactSemanticWitness;

      if (item.scope === "current-runtime-self-round-trip") {
        // Exercise one independently created source on dedicated fresh runtime
        // instances before the audit calls status or witness code. The reviewed
        // source factory is responsible for honoring the same pre-witness rule;
        // only the minimal KernelShape ownership tag is inspected by adopt().
        const preWitnessProducer = await makeRuntime();
        const preWitnessConsumer = await makeRuntime();
        const preWitnessSource = await createSource(
          item,
          preWitnessProducer,
          "Pre-witness source-shape creation",
        );
        const preWitness = await encode(
          preWitnessProducer,
          preWitnessSource.shape,
          item.feature,
          configuration.limits.maxArtifactBytes,
        );
        artifacts.push(
          artifactEvidence(
            "pre-witness-source-encode",
            preWitness.snapshot,
            await sha256(preWitness.snapshot),
          ),
        );
        detachOrMutate(preWitness.returned);
        const preWitnessInput = preWitness.snapshot.slice();
        const preWitnessDecoded = await decode(
          preWitnessConsumer,
          preWitnessInput,
          item.feature,
          preWitnessInput.byteLength,
          "cross-instance pre-witness-source decode",
        );
        detachOrMutate(preWitnessInput);
        observed = await observe(
          item,
          preWitnessDecoded,
          "cross-instance pre-witness-source semantic witness",
        );
        await observe(
          item,
          preWitnessSource,
          "pre-witness source after encode and decode",
        );
        disposeTracked(preWitnessDecoded);
        await observe(
          item,
          preWitnessSource,
          "pre-witness source after decoded-shape disposal",
        );
        disposeRuntime(preWitnessConsumer, "Pre-witness decoded-first consumer");
        const preWitnessSourceFirstConsumer = await makeRuntime();
        const preWitnessSourceFirstInput = preWitness.snapshot.slice();
        const preWitnessSourceFirstDecoded = await decode(
          preWitnessSourceFirstConsumer,
          preWitnessSourceFirstInput,
          item.feature,
          preWitnessSourceFirstInput.byteLength,
          "cross-instance pre-witness source-first decode",
        );
        detachOrMutate(preWitnessSourceFirstInput);
        await observe(
          item,
          preWitnessSourceFirstDecoded,
          "pre-witness decoded shape before source-first disposal",
        );
        disposeTracked(preWitnessSource);
        await observe(
          item,
          preWitnessSourceFirstDecoded,
          "pre-witness decoded shape after source-first disposal",
        );
        disposeTracked(preWitnessSourceFirstDecoded);
        disposeRuntime(
          preWitnessSourceFirstConsumer,
          "Pre-witness source-first consumer",
        );
        disposeRuntime(preWitnessProducer, "Pre-witness producer");
        checks.push("pre-witness-source-cross-instance-decode");

        const source = await createSource(
          item,
          producer,
          "Source-shape creation",
        );
        observed = await observe(item, source, "source-before-encode");
        checks.push("source-witness-before-encode");

        const first = await encode(
          producer,
          source.shape,
          item.feature,
          configuration.limits.maxArtifactBytes,
        );
        await observe(item, source, "source-after-first-encode");
        const second = await encode(
          producer,
          source.shape,
          item.feature,
          configuration.limits.maxArtifactBytes,
        );
        await observe(item, source, "source-after-second-encode");
        const firstReturnedInfo = exactUint8ArrayInfo(first.returned);
        const secondReturnedInfo = exactUint8ArrayInfo(second.returned);
        if (
          firstReturnedInfo === undefined ||
          secondReturnedInfo === undefined ||
          first.returned === second.returned ||
          firstReturnedInfo.buffer === secondReturnedInfo.buffer
        ) {
          throw kernelFailure("Repeated encodes did not return independent byte arrays");
        }
        const firstDigest = await sha256(first.snapshot);
        const secondDigest = await sha256(second.snapshot);
        artifacts.push(
          artifactEvidence("first-encode", first.snapshot, firstDigest),
          artifactEvidence("second-encode", second.snapshot, secondDigest),
        );
        checks.push("fresh-caller-owned-encode-bytes");

        detachOrMutate(first.returned);
        detachOrMutate(second.returned);
        await observe(item, source, "source-after-encoded-byte-detachment");
        checks.push("encoded-byte-isolation-probed");

        if (first.snapshot.byteLength > 1) {
          operation();
          try {
            const under = await producer.encode(source.shape, {
              feature: item.feature,
              ...(configuration.signal === undefined
                ? {}
                : { signal: configuration.signal }),
              maxArtifactBytes: first.snapshot.byteLength - 1,
            });
            throwIfAborted(configuration.signal);
            const underInfo = exactUint8ArrayInfo(under);
            if (
              underInfo === undefined ||
              underInfo.byteOffset !== 0 ||
              underInfo.byteLength !== underInfo.bufferByteLength ||
              underInfo.byteLength === 0 ||
              underInfo.byteLength > first.snapshot.byteLength - 1
            ) {
              throw new AuditFailure(
                diagnostic(
                  "ARTIFACT_CACHE_LIMIT_EXCEEDED",
                  "Shape-artifact encoder violated a reduced maxArtifactBytes ceiling",
                  { severity: "error" },
                ),
              );
            }
            const copied = copyExactUint8Array(under);
            if (copied === undefined) {
              throw malformedCodecFailure(
                "Reduced-limit encode output could not be copied",
              );
            }
            accountArtifact(copied);
            artifacts.push(
              artifactEvidence(
                "reduced-ceiling-encode",
                copied,
                await sha256(copied),
              ),
            );
            const reducedInput = copied.slice();
            const reducedShape = await decode(
              producer,
              reducedInput,
              item.feature,
              first.snapshot.byteLength - 1,
              "reduced-ceiling artifact decode",
            );
            detachOrMutate(reducedInput);
            await observe(
              item,
              reducedShape,
              "reduced-ceiling artifact semantic witness",
            );
            disposeTracked(reducedShape);
          } catch (error) {
            if (isAuditFailure(error)) throw error;
            if (abortSignalIsAborted(configuration.signal)) {
              throw new AuditFailure(abortDiagnostic());
            }
            // Rejecting because a valid encoding cannot fit is conforming.
          }
        }
        checks.push("encode-byte-ceiling-enforced");
        await expectAbortedEncode(producer, source.shape, item.feature);
        await observe(item, source, "source-after-pre-aborted-encode");
        checks.push("pre-aborted-encode-and-source-survival");

        const firstInput = first.snapshot.slice();
        const decodedFirst = await decode(
          producer,
          firstInput,
          item.feature,
          firstInput.byteLength,
          "same-instance decode",
        );
        detachOrMutate(firstInput);
        await observe(item, decodedFirst, "same-instance-decoded-after-input-detachment");

        const secondInput = second.snapshot.slice();
        const decodedSecond = await decode(
          consumer,
          secondInput,
          item.feature,
          secondInput.byteLength,
          "cross-instance decode",
        );
        detachOrMutate(secondInput);
        await observe(item, decodedSecond, "cross-instance-decoded-after-input-detachment");
        if (
          decodedFirst.shape === decodedSecond.shape ||
          decodedFirst.shape === source.shape ||
          decodedSecond.shape === source.shape
        ) {
          throw kernelFailure("Decode did not return distinct independently owned shapes");
        }
        checks.push("same-and-cross-instance-independent-decodes");
        checks.push("decode-input-borrowing-probed");

        const aborted = new AbortController();
        aborted.abort();
        await expectRejectedDecode(
          consumer,
          second.snapshot.slice(),
          item.feature,
          second.snapshot.byteLength,
          "pre-aborted decode",
          aborted.signal,
        );
        await observe(item, source, "source-after-pre-aborted-decode");
        await observe(item, decodedSecond, "decoded-shape-after-pre-aborted-decode");
        checks.push("pre-aborted-decode-and-shape-survival");

        if (second.snapshot.byteLength > 1) {
          await expectRejectedDecode(
            consumer,
            second.snapshot.slice(),
            item.feature,
            second.snapshot.byteLength - 1,
            "undersized-limit decode",
          );
          const truncated = second.snapshot.slice(0, -1);
          await expectRejectedDecode(
            consumer,
            truncated,
            item.feature,
            truncated.byteLength,
            "truncated-artifact decode",
          );
        }
        await expectRejectedDecode(
          consumer,
          new Uint8Array(),
          item.feature,
          configuration.limits.maxArtifactBytes,
          "empty-artifact decode",
        );
        checks.push("decode-limits-and-malformed-input-rejection");

        disposeTracked(decodedFirst);
        await observe(item, source, "source-after-first-decoded-disposal");
        await observe(item, decodedSecond, "second-decoded-after-first-disposal");
        const sourceFirstInput = first.snapshot.slice();
        const sourceFirstDecoded = await decode(
          producer,
          sourceFirstInput,
          item.feature,
          sourceFirstInput.byteLength,
          "source-first-disposal decode",
        );
        detachOrMutate(sourceFirstInput);
        await observe(
          item,
          sourceFirstDecoded,
          "same-instance decoded before source-first disposal",
        );
        disposeTracked(source);
        await observe(
          item,
          sourceFirstDecoded,
          "same-instance decoded after source-first disposal",
        );
        await observe(item, decodedSecond, "decoded-after-source-disposal");
        disposeTracked(sourceFirstDecoded);
        checks.push("independent-disposal-orders");

        const roundTrip = await encode(
          consumer,
          decodedSecond.shape,
          item.feature,
          configuration.limits.maxArtifactBytes,
        );
        const roundInput = roundTrip.snapshot.slice();
        const decodedThird = await decode(
          producer,
          roundInput,
          item.feature,
          roundInput.byteLength,
          "second-generation decode",
        );
        detachOrMutate(roundInput);
        await observe(item, decodedThird, "second-generation semantic witness");
        artifacts.push(
          artifactEvidence(
            "second-generation-encode",
            roundTrip.snapshot,
            await sha256(roundTrip.snapshot),
          ),
        );
        disposeTracked(decodedSecond);
        await observe(item, decodedThird, "second-generation after predecessor disposal");
        disposeTracked(decodedThird);
        checks.push("semantic-idempotence-and-second-generation-ownership");
      } else {
        accountArtifact(item.artifact);
        const fixtureWitness = await hashKernelShapeArtifactFixtureWitness(
          item.artifact,
          {
            maxBytes: configuration.limits.maxArtifactBytes,
            ...(configuration.signal === undefined
              ? {}
              : { signal: configuration.signal }),
          },
        );
        if (!fixtureWitness.ok) throw new AuditFailure(fixtureWitness.diagnostics[0]!);
        if (fixtureWitness.value !== item.expectedArtifactWitness) {
          throw kernelFailure("Golden artifact bytes do not match expectedArtifactWitness", {
            case: item.id,
            expectedArtifactWitness: item.expectedArtifactWitness,
            actualArtifactWitness: fixtureWitness.value,
          });
        }
        artifacts.push(
          artifactEvidence(
            "golden-input",
            item.artifact,
            fixtureWitness.value.slice(
              KERNEL_SHAPE_ARTIFACT_FIXTURE_WITNESS_PREFIX.length,
            ),
          ),
        );
        checks.push("golden-artifact-witness");

        const firstInput = item.artifact.slice();
        const first = await decode(
          producer,
          firstInput,
          item.feature,
          firstInput.byteLength,
          "first golden decode",
        );
        detachOrMutate(firstInput);
        observed = await observe(item, first, "first-golden-after-input-detachment");

        const secondInput = item.artifact.slice();
        const second = await decode(
          consumer,
          secondInput,
          item.feature,
          secondInput.byteLength,
          "cross-instance golden decode",
        );
        detachOrMutate(secondInput);
        await observe(item, second, "second-golden-after-input-detachment");
        if (first.shape === second.shape) {
          throw kernelFailure("Golden decodes did not return independent shapes");
        }
        checks.push("cross-instance-golden-decode");
        checks.push("golden-decode-input-borrowing-probed");

        const aborted = new AbortController();
        aborted.abort();
        await expectRejectedDecode(
          consumer,
          item.artifact.slice(),
          item.feature,
          item.artifact.byteLength,
          "pre-aborted golden decode",
          aborted.signal,
        );
        await observe(item, first, "first-golden-after-pre-aborted-decode");
        await observe(item, second, "second-golden-after-pre-aborted-decode");
        checks.push("pre-aborted-golden-decode");

        disposeTracked(first);
        await observe(item, second, "second-golden-after-first-disposal");
        disposeTracked(second);
        checks.push("independent-golden-disposal");
      }

      caseEvidence.push(
        deepFreeze({
          id: item.id,
          feature: item.feature,
          scope: item.scope,
          expectedWitness: item.expectedWitness,
          observedWitness: observed,
          artifacts,
          checks,
        }),
      );
    }

    outcome = success(
      deepFreeze({
        kind: "kernel-shape-artifact-codec-audit-evidence" as const,
        auditProtocolVersion:
          KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_PROTOCOL_VERSION,
        certifiesCompatibility: false as const,
        mode: configuration.mode,
        advertisement:
          configuration.mode === "advertised"
            ? ("advertised" as const)
            : ("unadvertised" as const),
        scopes: Object.freeze([
          "current-runtime-self-round-trip" as const,
          "golden-decode" as const,
        ]),
        expectedIdentity: configuration.expectedIdentity,
        limits: configuration.limits,
        usage: {
          cases: caseEvidence.length,
          operations,
          artifactBytes,
        },
        cases: caseEvidence,
        disclaimer:
          "Finite audit evidence; not certification or a cache-eligibility proof" as const,
      }),
    );
  } catch (error) {
    if (abortSignalIsAborted(configuration.signal) || isAbortError(error)) {
      outcome = failure(abortDiagnostic());
    } else if (isAuditFailure(error)) {
      outcome = failure(error.diagnostic);
    } else {
      outcome = failure(
        diagnostic(
          "ARTIFACT_CACHE_OPERATION_FAILED",
          safeErrorMessage(error, "Kernel shape-artifact audit failed"),
          { severity: "error" },
        ),
      );
    }
  } finally {
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
      const tracked = shapes[index]!;
      if (!tracked.live) continue;
      tracked.live = false;
      try {
        tracked.runtime.disposeShape(tracked.shape);
      } catch (error) {
        cleanupDiagnostics.push(
          diagnostic(
            "KERNEL_ERROR",
            safeErrorMessage(error, "Shape cleanup failed after artifact audit"),
            { severity: "error" },
          ),
        );
      }
    }
    for (let index = runtimes.length - 1; index >= 0; index -= 1) {
      const runtime = runtimes[index]!;
      if (disposedKernels.has(runtime.kernel)) continue;
      disposedKernels.add(runtime.kernel);
      try {
        runtime.dispose();
      } catch (error) {
        cleanupDiagnostics.push(
          diagnostic(
            "KERNEL_ERROR",
            safeErrorMessage(error, "Kernel cleanup failed after artifact audit"),
            { severity: "error" },
          ),
        );
      }
    }
  }

  if (cleanupDiagnostics.length > 0) {
    return failure(
      ...(outcome !== undefined && !outcome.ok ? outcome.diagnostics : []),
      ...cleanupDiagnostics,
    );
  }
  return (
    outcome ??
    failure(
      diagnostic(
        "ARTIFACT_CACHE_OPERATION_FAILED",
        "Kernel shape-artifact audit ended without a result",
        { severity: "error" },
      ),
    )
  );
}
