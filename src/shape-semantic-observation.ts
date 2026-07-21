import type { Vec3 } from "./core/math.js";
import { canonicalStringifyProtocol, deepFreeze } from "./core/json.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import {
  type GeometryKernel,
  type KernelExchangeFormat,
  type KernelFeature,
  type KernelShape,
  type MeshOptions,
} from "./kernel.js";
import {
  isKernelTopologySnapshotCopyLimitError,
  normalizeKernelTopologySnapshot,
} from "./internal/topology-snapshot.js";
import type {
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelTopologyLineage,
  KernelTopologySnapshot,
  KernelVertexDescriptor,
  TopologyKind,
} from "./protocol/topology.js";

export const KERNEL_SHAPE_SEMANTIC_OBSERVATION_PROTOCOL_VERSION = 1 as const;

export interface KernelShapeSemanticObservationLimits {
  readonly maxOperations: number;
  readonly maxObservationBytes: number;
  readonly maxStringBytes: number;
  readonly maxMeshRequests: number;
  readonly maxMeshVertices: number;
  readonly maxMeshTriangles: number;
  readonly maxTopologyItems: number;
  readonly maxAdjacencyLinks: number;
  readonly maxLineageRecords: number;
  readonly maxCanonicalLabelStates: number;
  readonly maxCanonicalWork: number;
  readonly maxNativeExchangeBytes: number;
  readonly maxProbes: number;
  readonly maxDerivedShapes: number;
}

export const DEFAULT_KERNEL_SHAPE_SEMANTIC_OBSERVATION_LIMITS: KernelShapeSemanticObservationLimits =
  Object.freeze({
    maxOperations: 10_000,
    maxObservationBytes: 16 * 1024 * 1024,
    maxStringBytes: 1024 * 1024,
    maxMeshRequests: 16,
    maxMeshVertices: 2_000_000,
    maxMeshTriangles: 4_000_000,
    maxTopologyItems: 100_000,
    maxAdjacencyLinks: 1_000_000,
    maxLineageRecords: 1_000_000,
    maxCanonicalLabelStates: 1_000_000,
    maxCanonicalWork: 10_000_000,
    maxNativeExchangeBytes: 64 * 1024 * 1024,
    maxProbes: 64,
    maxDerivedShapes: 256,
  });

export interface KernelShapeSemanticMeshRequest {
  /** Stable identifier included in the canonical observation. */
  readonly id: string;
  readonly options?: MeshOptions;
}

export interface KernelShapeSemanticProbeContext {
  readonly signal?: AbortSignal;
  /** Remaining accepted derived-shape allowance for this observation. */
  readonly maxDerivedShapes: number;
}

/**
 * A plan-owned downstream semantic probe. Returned shapes transfer to the
 * observer, which rejects aliases and disposes every returned shape. Plan
 * probes are trusted code and must honor `context.maxDerivedShapes`. If an
 * ordinary same-realm Promise has already queued its fulfillment before the
 * observer handles cancellation, its results transfer and are cleaned up. For
 * every other PromiseLike, transfer occurs only when its fulfillment callback
 * is delivered while the signal is not aborted. Later results remain
 * probe-owned.
 */
export interface KernelShapeSemanticProbe {
  readonly id: string;
  readonly feature: KernelFeature;
  readonly run: (
    kernel: GeometryKernel,
    borrowedSource: KernelShape,
    context: KernelShapeSemanticProbeContext,
  ) =>
    | CadResult<readonly KernelShape[]>
    | PromiseLike<CadResult<readonly KernelShape[]>>;
}

export interface KernelShapeSemanticNotApplicableFeature {
  readonly feature: KernelFeature;
  readonly reason: string;
}

export interface KernelShapeSemanticObservationPlan {
  /** Pins the externally reviewed meaning of probes and mesh profiles. */
  readonly id: string;
  readonly meshes: readonly KernelShapeSemanticMeshRequest[];
  readonly topology?: "omit" | "if-supported" | "required";
  readonly nativeExchanges?: readonly KernelExchangeFormat[];
  readonly probes?: readonly KernelShapeSemanticProbe[];
  /** Every advertised feature without a probe must be listed with a reason. */
  readonly notApplicableFeatures?: readonly KernelShapeSemanticNotApplicableFeature[];
}

export interface ObserveKernelShapeSemanticsOptions {
  readonly signal?: AbortSignal;
  readonly limits?: Partial<KernelShapeSemanticObservationLimits>;
}

export type KernelShapeSemanticEncodedFloat32 = `f32:${string}`;
export type KernelShapeSemanticEncodedFloat64 = `f64:${string}`;
export type KernelShapeSemanticEncodedVec3 = readonly [
  KernelShapeSemanticEncodedFloat64,
  KernelShapeSemanticEncodedFloat64,
  KernelShapeSemanticEncodedFloat64,
];
export type KernelShapeSemanticEncodedMeshVec3 = readonly [
  KernelShapeSemanticEncodedFloat32,
  KernelShapeSemanticEncodedFloat32,
  KernelShapeSemanticEncodedFloat32,
];

export interface KernelShapeSemanticStatusV1 {
  readonly ok: boolean;
  readonly code: string;
  readonly message?: string;
}

export interface KernelShapeSemanticMeasurementsV1 {
  readonly volume: KernelShapeSemanticEncodedFloat64;
  readonly surfaceArea: KernelShapeSemanticEncodedFloat64;
  readonly centerOfMass: KernelShapeSemanticEncodedVec3 | null;
  readonly inertiaTensor: readonly [
    KernelShapeSemanticEncodedVec3,
    KernelShapeSemanticEncodedVec3,
    KernelShapeSemanticEncodedVec3,
  ];
  readonly boundingBox: {
    readonly min: KernelShapeSemanticEncodedVec3;
    readonly max: KernelShapeSemanticEncodedVec3;
  };
  readonly genus: KernelShapeSemanticEncodedFloat64;
  readonly tolerance: KernelShapeSemanticEncodedFloat64;
}

export interface KernelShapeSemanticMeshOptionsV1 {
  readonly linearDeflection?: KernelShapeSemanticEncodedFloat64;
  readonly angularDeflection?: KernelShapeSemanticEncodedFloat64;
  readonly relative?: boolean;
}

export type KernelShapeSemanticOrientedTriangleV1 = readonly [
  KernelShapeSemanticEncodedMeshVec3,
  KernelShapeSemanticEncodedMeshVec3,
  KernelShapeSemanticEncodedMeshVec3,
];

export interface KernelShapeSemanticMeshV1 {
  readonly id: string;
  readonly options: KernelShapeSemanticMeshOptionsV1;
  /** Sorted multiset; cyclic corner rotation is normalized, winding is not. */
  readonly triangles: readonly KernelShapeSemanticOrientedTriangleV1[];
}

export interface KernelShapeSemanticLineageV1 {
  readonly feature: string;
  readonly relation: "created" | "modified";
  readonly role?: string;
  readonly source?: {
    readonly kind: "sketch-entity";
    readonly sketch: string;
    readonly entity: string;
  };
}

export interface KernelShapeSemanticSurfaceV1 {
  readonly kind: string;
  readonly normal?: KernelShapeSemanticEncodedVec3;
  readonly axis?: KernelShapeSemanticEncodedVec3;
  readonly radius?: KernelShapeSemanticEncodedFloat64;
}

export interface KernelShapeSemanticCurveV1 {
  readonly kind: string;
  readonly direction?: KernelShapeSemanticEncodedVec3;
  readonly axis?: KernelShapeSemanticEncodedVec3;
  readonly radius?: KernelShapeSemanticEncodedFloat64;
}

interface KernelShapeSemanticTopologyItemBaseV1 {
  /** Canonical observation-local identifier; never a persistent topology key. */
  readonly id: string;
  readonly lineage: readonly KernelShapeSemanticLineageV1[];
}

export interface KernelShapeSemanticFaceV1
  extends KernelShapeSemanticTopologyItemBaseV1 {
  readonly topology: "face";
  readonly area: KernelShapeSemanticEncodedFloat64;
  readonly center: KernelShapeSemanticEncodedVec3;
  readonly bounds: {
    readonly min: KernelShapeSemanticEncodedVec3;
    readonly max: KernelShapeSemanticEncodedVec3;
  };
  readonly surface: KernelShapeSemanticSurfaceV1;
  readonly edges: readonly string[];
}

export interface KernelShapeSemanticEdgeV1
  extends KernelShapeSemanticTopologyItemBaseV1 {
  readonly topology: "edge";
  readonly length: KernelShapeSemanticEncodedFloat64;
  readonly center: KernelShapeSemanticEncodedVec3;
  readonly bounds: {
    readonly min: KernelShapeSemanticEncodedVec3;
    readonly max: KernelShapeSemanticEncodedVec3;
  };
  readonly curve: KernelShapeSemanticCurveV1;
  readonly faces: readonly string[];
  readonly vertices: readonly string[];
}

export interface KernelShapeSemanticVertexV1
  extends KernelShapeSemanticTopologyItemBaseV1 {
  readonly topology: "vertex";
  readonly point: KernelShapeSemanticEncodedVec3;
  readonly edges: readonly string[];
}

export type KernelShapeSemanticTopologyV1 =
  | { readonly support: "omitted" }
  | { readonly support: "unsupported" }
  | {
      readonly support: "observed";
      readonly history: "complete" | "partial";
      readonly faces: readonly KernelShapeSemanticFaceV1[];
      readonly edges: readonly KernelShapeSemanticEdgeV1[];
      readonly vertices: readonly KernelShapeSemanticVertexV1[];
    };

export interface KernelShapeSemanticSnapshotV1 {
  readonly kernel: string;
  readonly status: KernelShapeSemanticStatusV1;
  readonly measurements: KernelShapeSemanticMeasurementsV1;
  readonly meshes: readonly KernelShapeSemanticMeshV1[];
  readonly topology: KernelShapeSemanticTopologyV1;
}

export interface KernelShapeSemanticNativeExchangeV1 {
  readonly format: KernelExchangeFormat;
  /** Semantics after export and import; native bytes are deliberately omitted. */
  readonly imported: KernelShapeSemanticSnapshotV1;
}

export interface KernelShapeSemanticProbeObservationV1 {
  readonly id: string;
  readonly feature: KernelFeature;
  readonly shapes: readonly KernelShapeSemanticSnapshotV1[];
}

export interface KernelShapeSemanticObservationV1
  extends KernelShapeSemanticSnapshotV1 {
  readonly kind: "kernel-shape-semantic-observation";
  readonly protocolVersion: typeof KERNEL_SHAPE_SEMANTIC_OBSERVATION_PROTOCOL_VERSION;
  readonly planId: string;
  readonly numericEncoding: "ieee754-be-hex-normalized-zero";
  readonly meshEncoding: "oriented-triangle-multiset-f32";
  readonly topologyEncoding: "bounded-canonical-incidence-graph";
  readonly nativeExchanges: readonly KernelShapeSemanticNativeExchangeV1[];
  readonly probes: readonly KernelShapeSemanticProbeObservationV1[];
  readonly coverage: {
    readonly meshes: readonly string[];
    readonly topology: "omitted" | "unsupported" | "observed";
    readonly nativeExchanges: readonly KernelExchangeFormat[];
    readonly probedFeatures: readonly KernelFeature[];
    readonly notApplicableFeatures: readonly KernelShapeSemanticNotApplicableFeature[];
  };
}

export type KernelShapeSemanticObservation = KernelShapeSemanticObservationV1;

interface CapturedMeshRequest {
  readonly id: string;
  readonly options: MeshOptions;
  readonly encodedOptions: KernelShapeSemanticMeshOptionsV1;
}

interface CapturedPlan {
  readonly id: string;
  readonly meshes: readonly CapturedMeshRequest[];
  readonly topology: "omit" | "if-supported" | "required";
  readonly nativeExchanges: readonly KernelExchangeFormat[];
  readonly probes: readonly KernelShapeSemanticProbe[];
  readonly notApplicableFeatures: readonly KernelShapeSemanticNotApplicableFeature[];
}

interface ObservationResources {
  readonly limits: KernelShapeSemanticObservationLimits;
  readonly signal?: AbortSignal;
  operations: number;
  stringBytes: number;
  meshVertices: number;
  meshTriangles: number;
  derivedShapes: number;
  canonicalLabelStates: number;
  canonicalWork: number;
}

interface SnapshotMaterializationBudget {
  readonly maximumBytes: number;
  minimumBytes: number;
}

interface GraphNode {
  readonly topology: TopologyKind;
  readonly key: string;
  readonly intrinsic: Readonly<Record<string, unknown>>;
  readonly intrinsicKey: string;
  readonly neighbors: readonly number[];
}

interface TrackedDerivedShape {
  readonly shape: KernelShape;
  live: boolean;
}

interface KernelObservationAccess {
  readonly kernel: GeometryKernel;
  readonly id: string;
  readonly features: readonly string[];
  readonly nativeImports: readonly string[];
  readonly nativeExports: readonly string[];
  readonly topologyAdvertised: boolean;
  readonly mesh: GeometryKernel["mesh"];
  readonly measure: GeometryKernel["measure"];
  readonly status: GeometryKernel["status"];
  readonly disposeShape: GeometryKernel["disposeShape"];
  readonly topology: GeometryKernel["topology"];
  readonly exportShape: GeometryKernel["exportShape"];
  readonly importShape: GeometryKernel["importShape"];
}

const LIMIT_KEYS = Object.freeze(
  Object.keys(DEFAULT_KERNEL_SHAPE_SEMANTIC_OBSERVATION_LIMITS) as readonly (
    keyof KernelShapeSemanticObservationLimits
  )[],
);
const EXCHANGE_FORMATS = new Set<KernelExchangeFormat>([
  "step",
  "brep",
  "brep-binary",
]);
const KERNEL_FEATURES = new Set<KernelFeature>([
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "circularArcSweep",
  "compositeSweep",
  "boolean",
  "transform",
  "fillet",
  "chamfer",
  "shell",
  "offset",
  "draft",
]);
// Exact lower bounds for the retained canonical JSON fragments. These couple
// collection work to maxObservationBytes before the corresponding arrays and
// graph values can be materialized in full.
const MIN_CANONICAL_TRIANGLE_BYTES = 142;
const MIN_CANONICAL_TOPOLOGY_ITEM_BYTES = 64;
const MIN_CANONICAL_ADJACENCY_LINK_BYTES = 4;
const MIN_CANONICAL_LINEAGE_RECORD_BYTES = 32;
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
const EVENT_TARGET_ADD_EVENT_LISTENER =
  typeof EventTarget === "undefined"
    ? undefined
    : EventTarget.prototype.addEventListener;
const EVENT_TARGET_REMOVE_EVENT_LISTENER =
  typeof EventTarget === "undefined"
    ? undefined
    : EventTarget.prototype.removeEventListener;
const INTRINSIC_PROMISE_THEN = Promise.prototype.then;
const capturedObservations = new WeakSet<object>();
const observationFailures = new WeakSet<object>();

class ObservationFailure extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(...diagnostics: readonly Diagnostic[]) {
    super(diagnostics[0]?.message ?? "Kernel shape semantic observation failed");
    this.name = "ObservationFailure";
    this.diagnostics = diagnostics;
    observationFailures.add(this);
  }
}

function isObservationFailure(value: unknown): value is ObservationFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    observationFailures.has(value)
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
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
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function invalidOptions(message: string): CadResult<never> {
  return failure(
    diagnostic("ARTIFACT_CACHE_ENTRY_INVALID", message, { severity: "error" }),
  );
}

function limitFailure(
  resource: keyof KernelShapeSemanticObservationLimits,
  limit: number,
  actual?: number,
): ObservationFailure {
  return new ObservationFailure(
    diagnostic(
      "ARTIFACT_CACHE_LIMIT_EXCEEDED",
      `Kernel shape semantic observation exceeded ${resource}`,
      {
        severity: "error",
        details: {
          resource,
          limit,
          ...(actual === undefined ? {} : { actual }),
        },
      },
    ),
  );
}

function kernelFailure(message: string): ObservationFailure {
  return new ObservationFailure(
    diagnostic("KERNEL_ERROR", message, {
      severity: "error",
      details: { protocolViolation: true },
    }),
  );
}

function abortSignalIsAborted(signal: AbortSignal): boolean {
  try {
    return ABORT_SIGNAL_ABORTED_GETTER !== undefined &&
      Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, []) === true;
  } catch {
    // A signal that becomes unreadable after validation is treated as aborted
    // so cancellation checks remain fail-closed and never escape CadResult.
    return true;
  }
}

function throwIfAborted(resources: ObservationResources): void {
  if (
    resources.signal !== undefined &&
    abortSignalIsAborted(resources.signal)
  ) {
    throw new ObservationFailure(
      diagnostic(
        "EVALUATION_ABORTED",
        "Kernel shape semantic observation was aborted",
        { severity: "error" },
      ),
    );
  }
}

function operation(resources: ObservationResources): void {
  throwIfAborted(resources);
  resources.operations += 1;
  if (resources.operations > resources.limits.maxOperations) {
    throw limitFailure(
      "maxOperations",
      resources.limits.maxOperations,
      resources.operations,
    );
  }
}

function boundedString(
  value: unknown,
  label: string,
  resources: ObservationResources,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw kernelFailure(`Geometry kernel returned an invalid ${label}`);
  }
  const remaining = resources.limits.maxStringBytes - resources.stringBytes;
  if (value.length > remaining) {
    throw limitFailure("maxStringBytes", resources.limits.maxStringBytes);
  }
  const capacity = Math.min(
    remaining + 1,
    resources.limits.maxObservationBytes + 1,
    Math.max(1, value.length * 3),
  );
  const encoded = new Uint8Array(capacity);
  const result = new TextEncoder().encodeInto(value, encoded);
  if (result.read !== value.length || result.written > remaining) {
    if (
      result.written >= resources.limits.maxObservationBytes &&
      remaining >= resources.limits.maxObservationBytes
    ) {
      throw limitFailure(
        "maxObservationBytes",
        resources.limits.maxObservationBytes,
      );
    }
    throw limitFailure("maxStringBytes", resources.limits.maxStringBytes);
  }
  resources.stringBytes += result.written;
  return value;
}

function accountSnapshotMinimumBytes(
  budget: SnapshotMaterializationBudget,
  amount: number,
  resources: ObservationResources,
): void {
  budget.minimumBytes += amount;
  if (budget.minimumBytes > budget.maximumBytes) {
    throw limitFailure(
      "maxObservationBytes",
      resources.limits.maxObservationBytes,
      budget.minimumBytes,
    );
  }
}

const CANONICAL_LENGTH_LIMIT = Symbol("canonical-length-limit");

/**
 * Computes the exact canonical JSON UTF-8 size without first constructing the
 * complete canonical string. The input is repository-owned protocol data.
 */
function canonicalProtocolByteLengthWithin(
  value: unknown,
  maximum: number,
  poll?: () => void,
): number | undefined {
  let total = 0;
  let visits = 0;
  const add = (amount: number): void => {
    total += amount;
    if (total > maximum) throw CANONICAL_LENGTH_LIMIT;
  };
  const stringBytes = (input: string): number => {
    let bytes = 2;
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      if ((visits++ & 0xfff) === 0) poll?.();
      if (code === 0x22 || code === 0x5c) {
        bytes += 2;
      } else if (code <= 0x1f) {
        bytes +=
          code === 0x08 ||
          code === 0x09 ||
          code === 0x0a ||
          code === 0x0c ||
          code === 0x0d
            ? 2
            : 6;
      } else if (code <= 0x7f) {
        bytes += 1;
      } else if (code <= 0x7ff) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const following = input.charCodeAt(index + 1);
        if (following >= 0xdc00 && following <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          // Well-formed JSON.stringify escapes lone surrogates as \udxxx.
          bytes += 6;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        bytes += 6;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  };
  const visit = (input: unknown): void => {
    if ((visits++ & 0xfff) === 0) poll?.();
    if (input === null) {
      add(4);
      return;
    }
    if (typeof input === "string") {
      add(stringBytes(input));
      return;
    }
    if (typeof input === "boolean") {
      add(input ? 4 : 5);
      return;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) {
        throw new TypeError("Protocol data cannot contain non-finite numbers");
      }
      add(JSON.stringify(Object.is(input, -0) ? 0 : input).length);
      return;
    }
    if (Array.isArray(input)) {
      add(2 + Math.max(0, input.length - 1));
      for (const item of input) visit(item);
      return;
    }
    if (typeof input === "object") {
      add(2);
      let entries = 0;
      for (const key of Object.keys(input as Record<string, unknown>)) {
        const child = (input as Record<string, unknown>)[key];
        if (child === undefined) continue;
        if (entries > 0) add(1);
        add(stringBytes(key) + 1);
        visit(child);
        entries += 1;
      }
      return;
    }
    throw new TypeError(`Unsupported protocol value: ${typeof input}`);
  };
  try {
    visit(value);
    return total;
  } catch (error) {
    if (error === CANONICAL_LENGTH_LIMIT) return undefined;
    throw error;
  }
}

function boundedCanonicalKey(
  value: unknown,
  maximum: number,
  resources: ObservationResources,
): { readonly byteLength: number; readonly key: string } {
  const byteLength = canonicalProtocolByteLengthWithin(
    value,
    maximum,
    () => throwIfAborted(resources),
  );
  if (byteLength === undefined) {
    throw limitFailure(
      "maxObservationBytes",
      resources.limits.maxObservationBytes,
    );
  }
  return { byteLength, key: canonicalStringifyProtocol(value) };
}

function captureLimits(
  value: unknown,
): CadResult<KernelShapeSemanticObservationLimits> {
  if (value === undefined) {
    return success(DEFAULT_KERNEL_SHAPE_SEMANTIC_OBSERVATION_LIMITS);
  }
  try {
    if (!isRecord(value)) {
      return invalidOptions("Kernel shape semantic observation limits must be an object");
    }
    if (
      Object.keys(value).some(
        (key) =>
          !LIMIT_KEYS.includes(key as keyof KernelShapeSemanticObservationLimits),
      )
    ) {
      return invalidOptions(
        "Kernel shape semantic observation limits contain unknown fields",
      );
    }
    const output: Record<keyof KernelShapeSemanticObservationLimits, number> = {
      ...DEFAULT_KERNEL_SHAPE_SEMANTIC_OBSERVATION_LIMITS,
    };
    for (const key of LIMIT_KEYS) {
      if (!Object.hasOwn(value, key)) continue;
      const item = value[key];
      if (
        typeof item !== "number" ||
        !Number.isSafeInteger(item) ||
        item < 1
      ) {
        return invalidOptions(`Kernel shape semantic observation limit ${key} must be a positive safe integer`);
      }
      output[key] = item;
    }
    return success(Object.freeze(output));
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Kernel shape semantic observation limits are invalid"),
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
      EVENT_TARGET_ADD_EVENT_LISTENER !== undefined &&
      EVENT_TARGET_REMOVE_EVENT_LISTENER !== undefined &&
      typeof Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, value, []) === "boolean"
    ) {
      return success(value);
    }
    return invalidOptions(
      "Kernel shape semantic observation signal must be an AbortSignal",
    );
  } catch {
    return invalidOptions("Kernel shape semantic observation signal must be an AbortSignal");
  }
}

function f64(value: unknown, label: string): KernelShapeSemanticEncodedFloat64 {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw kernelFailure(`Geometry kernel returned an invalid ${label}`);
  }
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, Object.is(value, -0) ? 0 : value, false);
  return `f64:${[...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function f32(value: number): KernelShapeSemanticEncodedFloat32 {
  if (!Number.isFinite(value)) {
    throw kernelFailure("Geometry kernel returned a mesh with a non-finite coordinate");
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, Object.is(value, -0) ? 0 : value, false);
  return `f32:${[...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function captureVec3(
  value: unknown,
  label: string,
): {
  readonly value: Vec3;
  readonly encoded: KernelShapeSemanticEncodedVec3;
} {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Object.hasOwn(value, 0) ||
    !Object.hasOwn(value, 1) ||
    !Object.hasOwn(value, 2)
  ) {
    throw kernelFailure(`Geometry kernel returned an invalid ${label}`);
  }
  const first = value[0];
  const second = value[1];
  const third = value[2];
  if (
    typeof first !== "number" ||
    !Number.isFinite(first) ||
    typeof second !== "number" ||
    !Number.isFinite(second) ||
    typeof third !== "number" ||
    !Number.isFinite(third)
  ) {
    throw kernelFailure(`Geometry kernel returned an invalid ${label}`);
  }
  return Object.freeze({
    value: Object.freeze([first, second, third]) as Vec3,
    encoded: Object.freeze([
      f64(first, label),
      f64(second, label),
      f64(third, label),
    ]) as KernelShapeSemanticEncodedVec3,
  });
}

function vec3(value: unknown, label: string): KernelShapeSemanticEncodedVec3 {
  return captureVec3(value, label).encoded;
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function captureMeshOptions(
  value: unknown,
): { readonly raw: MeshOptions; readonly encoded: KernelShapeSemanticMeshOptionsV1 } | undefined {
  if (value === undefined) {
    return { raw: Object.freeze({}), encoded: Object.freeze({}) };
  }
  if (!isRecord(value)) return undefined;
  const allowed = ["linearDeflection", "angularDeflection", "relative"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return undefined;
  const raw: {
    linearDeflection?: number;
    angularDeflection?: number;
    relative?: boolean;
  } = {};
  const encoded: {
    linearDeflection?: KernelShapeSemanticEncodedFloat64;
    angularDeflection?: KernelShapeSemanticEncodedFloat64;
    relative?: boolean;
  } = {};
  for (const key of ["linearDeflection", "angularDeflection"] as const) {
    if (!Object.hasOwn(value, key)) continue;
    const item = value[key];
    if (typeof item !== "number" || !Number.isFinite(item) || item <= 0) {
      return undefined;
    }
    raw[key] = item;
    encoded[key] = f64(item, `mesh option ${key}`);
  }
  if (Object.hasOwn(value, "relative")) {
    const relative = value.relative;
    if (typeof relative !== "boolean") return undefined;
    raw.relative = relative;
    encoded.relative = relative;
  }
  return { raw: Object.freeze(raw), encoded: Object.freeze(encoded) };
}

function copyBoundedDenseArray(
  value: unknown,
  maximum: number,
): readonly unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const length = value.length;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximum
  ) {
    return undefined;
  }
  const output = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) return undefined;
    output[index] = value[index];
  }
  return Object.freeze(output);
}

function capturePlan(
  value: unknown,
  limits: KernelShapeSemanticObservationLimits,
): CadResult<CapturedPlan> {
  try {
    if (!isRecord(value)) {
      return invalidOptions("Kernel shape semantic observation plan must be an object");
    }
    const allowed = [
      "id",
      "meshes",
      "topology",
      "nativeExchanges",
      "probes",
      "notApplicableFeatures",
    ];
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
      return invalidOptions("Kernel shape semantic observation plan contains unknown fields");
    }
    if (!Object.hasOwn(value, "id") || !Object.hasOwn(value, "meshes")) {
      return invalidOptions("Kernel shape semantic observation plan is malformed");
    }
    const planId = value.id;
    const rawMeshes = value.meshes;
    const rawTopology = Object.hasOwn(value, "topology")
      ? value.topology
      : undefined;
    const rawNativeValue = Object.hasOwn(value, "nativeExchanges")
      ? value.nativeExchanges
      : undefined;
    const rawProbeValue = Object.hasOwn(value, "probes")
      ? value.probes
      : undefined;
    const rawNotApplicableValue = Object.hasOwn(
      value,
      "notApplicableFeatures",
    )
      ? value.notApplicableFeatures
      : undefined;
    const capturedMeshes = copyBoundedDenseArray(
      rawMeshes,
      limits.maxMeshRequests,
    );
    if (
      typeof planId !== "string" ||
      planId.length === 0 ||
      planId.length > 1_024 ||
      capturedMeshes === undefined ||
      capturedMeshes.length === 0
    ) {
      return invalidOptions("Kernel shape semantic observation plan is malformed");
    }
    const meshIds = new Set<string>();
    const meshes: CapturedMeshRequest[] = [];
    for (let index = 0; index < capturedMeshes.length; index += 1) {
      const rawRequest = capturedMeshes[index];
      if (
        !isRecord(rawRequest) ||
        !exactKeys(rawRequest, [
          "id",
          ...(Object.hasOwn(rawRequest, "options") ? ["options"] : []),
        ]) ||
        !Object.hasOwn(rawRequest, "id")
      ) {
        return invalidOptions("Kernel shape semantic mesh request is malformed");
      }
      const requestId = rawRequest.id;
      const rawOptions = Object.hasOwn(rawRequest, "options")
        ? rawRequest.options
        : undefined;
      if (
        typeof requestId !== "string" ||
        requestId.length === 0 ||
        requestId.length > 256 ||
        meshIds.has(requestId)
      ) {
        return invalidOptions("Kernel shape semantic mesh request is malformed");
      }
      const options = captureMeshOptions(rawOptions);
      if (options === undefined) {
        return invalidOptions("Kernel shape semantic mesh options are malformed");
      }
      meshIds.add(requestId);
      meshes.push(
        Object.freeze({
          id: requestId,
          options: options.raw,
          encodedOptions: options.encoded,
        }),
      );
    }
    meshes.sort((first, second) => lexicalCompare(first.id, second.id));
    const topology = rawTopology === undefined ? "if-supported" : rawTopology;
    if (topology !== "omit" && topology !== "if-supported" && topology !== "required") {
      return invalidOptions("Kernel shape semantic topology mode is malformed");
    }
    const rawNative = copyBoundedDenseArray(
      rawNativeValue === undefined ? [] : rawNativeValue,
      EXCHANGE_FORMATS.size,
    );
    if (rawNative === undefined) {
      return invalidOptions("Kernel shape semantic native exchanges are malformed");
    }
    const nativeSeen = new Set<KernelExchangeFormat>();
    const nativeExchanges: KernelExchangeFormat[] = [];
    for (let index = 0; index < rawNative.length; index += 1) {
      const format = rawNative[index];
      if (
        typeof format !== "string" ||
        !EXCHANGE_FORMATS.has(format as KernelExchangeFormat) ||
        nativeSeen.has(format as KernelExchangeFormat)
      ) {
        return invalidOptions("Kernel shape semantic native exchanges are malformed");
      }
      nativeSeen.add(format as KernelExchangeFormat);
      nativeExchanges.push(format as KernelExchangeFormat);
    }
    nativeExchanges.sort(lexicalCompare);
    const rawProbes = copyBoundedDenseArray(
      rawProbeValue === undefined ? [] : rawProbeValue,
      limits.maxProbes,
    );
    if (rawProbes === undefined) {
      return invalidOptions("Kernel shape semantic probes are malformed");
    }
    const probeIds = new Set<string>();
    const probedFeatures = new Set<KernelFeature>();
    const probes: KernelShapeSemanticProbe[] = [];
    for (let index = 0; index < rawProbes.length; index += 1) {
      const rawProbe = rawProbes[index];
      if (
        !isRecord(rawProbe) ||
        !exactKeys(rawProbe, ["id", "feature", "run"]) ||
        !Object.hasOwn(rawProbe, "id") ||
        !Object.hasOwn(rawProbe, "feature") ||
        !Object.hasOwn(rawProbe, "run")
      ) {
        return invalidOptions("Kernel shape semantic probe is malformed");
      }
      const probeId = rawProbe.id;
      const probeFeature = rawProbe.feature;
      const run = rawProbe.run;
      if (
        typeof probeId !== "string" ||
        probeId.length === 0 ||
        probeId.length > 256 ||
        typeof probeFeature !== "string" ||
        !KERNEL_FEATURES.has(probeFeature as KernelFeature) ||
        typeof run !== "function" ||
        probeIds.has(probeId) ||
        probedFeatures.has(probeFeature as KernelFeature)
      ) {
        return invalidOptions("Kernel shape semantic probe is malformed");
      }
      probeIds.add(probeId);
      probedFeatures.add(probeFeature as KernelFeature);
      probes.push(
        Object.freeze({
          id: probeId,
          feature: probeFeature as KernelFeature,
          run: run as KernelShapeSemanticProbe["run"],
        }),
      );
    }
    probes.sort((first, second) => lexicalCompare(first.id, second.id));
    const rawNotApplicable = copyBoundedDenseArray(
      rawNotApplicableValue === undefined ? [] : rawNotApplicableValue,
      limits.maxProbes,
    );
    if (rawNotApplicable === undefined) {
      return invalidOptions("Kernel shape semantic feature exclusions are malformed");
    }
    const notApplicableFeatures: KernelShapeSemanticNotApplicableFeature[] = [];
    const excluded = new Set<KernelFeature>();
    for (let index = 0; index < rawNotApplicable.length; index += 1) {
      const item = rawNotApplicable[index];
      if (
        !isRecord(item) ||
        !exactKeys(item, ["feature", "reason"]) ||
        !Object.hasOwn(item, "feature") ||
        !Object.hasOwn(item, "reason")
      ) {
        return invalidOptions("Kernel shape semantic feature exclusion is malformed");
      }
      const feature = item.feature;
      const reason = item.reason;
      if (
        typeof feature !== "string" ||
        !KERNEL_FEATURES.has(feature as KernelFeature) ||
        typeof reason !== "string" ||
        reason.length === 0 ||
        reason.length > 1_024 ||
        excluded.has(feature as KernelFeature) ||
        probedFeatures.has(feature as KernelFeature)
      ) {
        return invalidOptions("Kernel shape semantic feature exclusion is malformed");
      }
      excluded.add(feature as KernelFeature);
      notApplicableFeatures.push(
        Object.freeze({
          feature: feature as KernelFeature,
          reason,
        }),
      );
    }
    notApplicableFeatures.sort((first, second) =>
      lexicalCompare(first.feature, second.feature),
    );
    return success(
      Object.freeze({
        id: planId,
        meshes: Object.freeze(meshes),
        topology,
        nativeExchanges: Object.freeze(nativeExchanges),
        probes: Object.freeze(probes),
        notApplicableFeatures: Object.freeze(notApplicableFeatures),
      }),
    );
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Kernel shape semantic observation plan is invalid"),
    );
  }
}

function typedArrayByteLength(
  value: unknown,
  tag: "Float32Array" | "Uint32Array" | "Uint8Array",
): number | undefined {
  if (
    TYPED_ARRAY_TAG_GETTER === undefined ||
    TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined ||
    TYPED_ARRAY_BUFFER_GETTER === undefined ||
    ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined
  ) return undefined;
  try {
    if (!ArrayBuffer.isView(value)) return undefined;
    if (Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) !== tag) return undefined;
    const byteLength = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as unknown;
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []);
    // Reject SharedArrayBuffer-backed views: a concurrent writer could produce
    // a torn semantic snapshot without changing the view's byte length.
    Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
    const bytesPerElement =
      tag === "Float32Array" || tag === "Uint32Array" ? 4 : 1;
    if (
      typeof byteLength !== "number" ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength % bytesPerElement !== 0
    ) return undefined;
    return byteLength;
  } catch {
    return undefined;
  }
}

function typedArrayCopy<T extends Float32Array | Uint32Array | Uint8Array>(
  value: unknown,
  tag: "Float32Array" | "Uint32Array" | "Uint8Array",
  expectedByteLength: number,
): T | undefined {
  const byteLength = typedArrayByteLength(value, tag);
  if (byteLength !== expectedByteLength) return undefined;
  try {
    const output =
      tag === "Float32Array"
        ? new Float32Array(expectedByteLength / 4)
        : tag === "Uint32Array"
          ? new Uint32Array(expectedByteLength / 4)
          : new Uint8Array(expectedByteLength);
    Reflect.apply(output.set, output, [value]);
    if (typedArrayByteLength(value, tag) !== expectedByteLength) {
      return undefined;
    }
    return output as T;
  } catch {
    return undefined;
  }
}

function triangleKey(triangle: KernelShapeSemanticOrientedTriangleV1): string {
  return triangle.flat().join(":");
}

function canonicalTriangle(
  first: KernelShapeSemanticEncodedMeshVec3,
  second: KernelShapeSemanticEncodedMeshVec3,
  third: KernelShapeSemanticEncodedMeshVec3,
): KernelShapeSemanticOrientedTriangleV1 {
  const rotations = [
    [first, second, third],
    [second, third, first],
    [third, first, second],
  ] as const;
  let selected = rotations[0];
  let selectedKey = triangleKey(selected);
  for (let index = 1; index < rotations.length; index += 1) {
    const candidate = rotations[index]!;
    const key = triangleKey(candidate);
    if (lexicalCompare(key, selectedKey) < 0) {
      selected = candidate;
      selectedKey = key;
    }
  }
  return Object.freeze(selected.map((point) => Object.freeze([...point]))) as unknown as KernelShapeSemanticOrientedTriangleV1;
}

function observeMesh(
  access: KernelObservationAccess,
  shape: KernelShape,
  request: CapturedMeshRequest,
  resources: ObservationResources,
  budget: SnapshotMaterializationBudget,
): KernelShapeSemanticMeshV1 {
  operation(resources);
  const raw = Object.keys(request.options).length === 0
    ? Reflect.apply(access.mesh, access.kernel, [shape])
    : Reflect.apply(access.mesh, access.kernel, [shape, request.options]);
  throwIfAborted(resources);
  if (!isRecord(raw)) throw kernelFailure("Geometry kernel returned an invalid mesh");
  const rawPositions = raw.positions;
  const rawIndices = raw.indices;
  const positionBytes = typedArrayByteLength(rawPositions, "Float32Array");
  const indexBytes = typedArrayByteLength(rawIndices, "Uint32Array");
  if (
    positionBytes === undefined ||
    indexBytes === undefined ||
    positionBytes % 12 !== 0 ||
    indexBytes % 12 !== 0
  ) {
    throw kernelFailure("Geometry kernel returned an invalid indexed triangle mesh");
  }
  const vertexCount = positionBytes / 12;
  const triangleCount = indexBytes / 12;
  resources.meshVertices += vertexCount;
  resources.meshTriangles += triangleCount;
  if (resources.meshVertices > resources.limits.maxMeshVertices) {
    throw limitFailure(
      "maxMeshVertices",
      resources.limits.maxMeshVertices,
      resources.meshVertices,
    );
  }
  if (resources.meshTriangles > resources.limits.maxMeshTriangles) {
    throw limitFailure(
      "maxMeshTriangles",
      resources.limits.maxMeshTriangles,
      resources.meshTriangles,
    );
  }
  accountSnapshotMinimumBytes(
    budget,
    triangleCount * MIN_CANONICAL_TRIANGLE_BYTES,
    resources,
  );
  const positions = typedArrayCopy<Float32Array>(
    rawPositions,
    "Float32Array",
    positionBytes,
  );
  const indices = typedArrayCopy<Uint32Array>(
    rawIndices,
    "Uint32Array",
    indexBytes,
  );
  if (
    positions === undefined ||
    indices === undefined ||
    positions.byteLength !== positionBytes ||
    indices.byteLength !== indexBytes
  ) {
    throw kernelFailure("Geometry kernel mesh changed while it was being copied");
  }
  const encodedVertex = (
    vertex: number,
  ): KernelShapeSemanticEncodedMeshVec3 => {
    const offset = vertex * 3;
    return Object.freeze([
      f32(positions[offset]!),
      f32(positions[offset + 1]!),
      f32(positions[offset + 2]!),
    ]);
  };
  const triangles: KernelShapeSemanticOrientedTriangleV1[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    if ((index & 0xfff) === 0) throwIfAborted(resources);
    const first = indices[index]!;
    const second = indices[index + 1]!;
    const third = indices[index + 2]!;
    if (first >= vertexCount || second >= vertexCount || third >= vertexCount) {
      throw kernelFailure("Geometry kernel returned a mesh index outside its vertex array");
    }
    triangles.push(
      canonicalTriangle(
        encodedVertex(first),
        encodedVertex(second),
        encodedVertex(third),
      ),
    );
  }
  triangles.sort((first, second) =>
    lexicalCompare(triangleKey(first), triangleKey(second)),
  );
  return Object.freeze({
    id: request.id,
    options: request.encodedOptions,
    triangles: Object.freeze(triangles),
  });
}

function canonicalLineage(
  lineage: readonly KernelTopologyLineage[],
  resources: ObservationResources,
  budget: SnapshotMaterializationBudget,
): readonly KernelShapeSemanticLineageV1[] {
  const unique = new Map<string, KernelShapeSemanticLineageV1>();
  for (const item of lineage) {
    throwIfAborted(resources);
    const copied: KernelShapeSemanticLineageV1 = Object.freeze({
      feature: item.feature,
      relation: item.relation,
      ...(item.role === undefined
        ? {}
        : { role: item.role }),
      ...(item.source === undefined
        ? {}
        : {
            source: Object.freeze({
              kind: "sketch-entity" as const,
              sketch: item.source.sketch,
              entity: item.source.entity,
            }),
          }),
    });
    const key = boundedCanonicalKey(
      copied,
      budget.maximumBytes,
      resources,
    ).key;
    if (!unique.has(key)) {
      accountSnapshotMinimumBytes(
        budget,
        MIN_CANONICAL_LINEAGE_RECORD_BYTES,
        resources,
      );
      unique.set(key, copied);
    }
  }
  return Object.freeze(
    [...unique.entries()]
      .sort(([first], [second]) => lexicalCompare(first, second))
      .map(([, item]) => item),
  );
}

function faceIntrinsic(
  descriptor: KernelFaceDescriptor,
  resources: ObservationResources,
  budget: SnapshotMaterializationBudget,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    topology: "face" as const,
    lineage: canonicalLineage(descriptor.lineage, resources, budget),
    area: f64(descriptor.area, "topology face area"),
    center: vec3(descriptor.center, "topology face center"),
    bounds: Object.freeze({
      min: vec3(descriptor.bounds.min, "topology face bounds"),
      max: vec3(descriptor.bounds.max, "topology face bounds"),
    }),
    surface: Object.freeze({
      kind: descriptor.surface.kind,
      ...(descriptor.surface.normal === undefined
        ? {}
        : { normal: vec3(descriptor.surface.normal, "topology surface normal") }),
      ...(descriptor.surface.axis === undefined
        ? {}
        : { axis: vec3(descriptor.surface.axis, "topology surface axis") }),
      ...(descriptor.surface.radius === undefined
        ? {}
        : { radius: f64(descriptor.surface.radius, "topology surface radius") }),
    }),
  });
}

function edgeIntrinsic(
  descriptor: KernelEdgeDescriptor,
  resources: ObservationResources,
  budget: SnapshotMaterializationBudget,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    topology: "edge" as const,
    lineage: canonicalLineage(descriptor.lineage, resources, budget),
    length: f64(descriptor.length, "topology edge length"),
    center: vec3(descriptor.center, "topology edge center"),
    bounds: Object.freeze({
      min: vec3(descriptor.bounds.min, "topology edge bounds"),
      max: vec3(descriptor.bounds.max, "topology edge bounds"),
    }),
    curve: Object.freeze({
      kind: descriptor.curve.kind,
      ...(descriptor.curve.direction === undefined
        ? {}
        : { direction: vec3(descriptor.curve.direction, "topology curve direction") }),
      ...(descriptor.curve.axis === undefined
        ? {}
        : { axis: vec3(descriptor.curve.axis, "topology curve axis") }),
      ...(descriptor.curve.radius === undefined
        ? {}
        : { radius: f64(descriptor.curve.radius, "topology curve radius") }),
    }),
  });
}

function vertexIntrinsic(
  descriptor: KernelVertexDescriptor,
  resources: ObservationResources,
  budget: SnapshotMaterializationBudget,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    topology: "vertex" as const,
    lineage: canonicalLineage(descriptor.lineage, resources, budget),
    point: vec3(descriptor.point, "topology vertex point"),
  });
}

function rankLabels(labels: readonly string[]): number[] {
  const unique = [...new Set(labels)].sort(lexicalCompare);
  const ranks = new Map(unique.map((label, index) => [label, index]));
  return labels.map((label) => ranks.get(label)!);
}

function samePartition(
  first: readonly number[],
  second: readonly number[],
): boolean {
  if (first.length !== second.length) return false;
  const forward = new Map<number, number>();
  const reverse = new Map<number, number>();
  for (let index = 0; index < first.length; index += 1) {
    const firstColor = first[index]!;
    const secondColor = second[index]!;
    const mappedForward = forward.get(firstColor);
    const mappedReverse = reverse.get(secondColor);
    if (
      (mappedForward !== undefined && mappedForward !== secondColor) ||
      (mappedReverse !== undefined && mappedReverse !== firstColor)
    ) {
      return false;
    }
    forward.set(firstColor, secondColor);
    reverse.set(secondColor, firstColor);
  }
  return true;
}

function canonicalWork(
  resources: ObservationResources,
  units = 1,
): void {
  resources.canonicalWork += units;
  if (resources.canonicalWork > resources.limits.maxCanonicalWork) {
    throw limitFailure(
      "maxCanonicalWork",
      resources.limits.maxCanonicalWork,
      resources.canonicalWork,
    );
  }
}

function refineColors(
  nodes: readonly GraphNode[],
  starting: readonly number[],
  resources: ObservationResources,
): number[] {
  let colors = [...starting];
  for (;;) {
    throwIfAborted(resources);
    const labels = nodes.map((node, index) => {
      if ((index & 0x3ff) === 0) throwIfAborted(resources);
      canonicalWork(resources, 1 + node.neighbors.length);
      const adjacent = node.neighbors.map((neighbor) => colors[neighbor]!).sort((a, b) => a - b);
      return `${colors[index]}|${adjacent.join(",")}`;
    });
    const refined = rankLabels(labels);
    // Stability is equality of color classes, not equality of their numeric
    // rank labels. Lexical sorting can legitimately renumber ranks such as 2
    // and 10 without refining the partition.
    if (samePartition(colors, refined)) return refined;
    colors = refined;
  }
}

function canonicalTopologyLeaf(
  nodes: readonly GraphNode[],
  colors: readonly number[],
  resources: ObservationResources,
  budget: SnapshotMaterializationBudget,
): {
  readonly key: string;
  readonly value: Omit<Extract<KernelShapeSemanticTopologyV1, { support: "observed" }>, "support" | "history">;
} {
  const order = nodes.map((_, index) => index).sort((a, b) => colors[a]! - colors[b]!);
  const ids = new Map<number, string>();
  const counters: Record<TopologyKind, number> = { face: 0, edge: 0, vertex: 0 };
  for (const index of order) {
    canonicalWork(resources);
    const topology = nodes[index]!.topology;
    const prefix = topology === "face" ? "f" : topology === "edge" ? "e" : "v";
    ids.set(index, `${prefix}${counters[topology]++}`);
  }
  const faces: KernelShapeSemanticFaceV1[] = [];
  const edges: KernelShapeSemanticEdgeV1[] = [];
  const vertices: KernelShapeSemanticVertexV1[] = [];
  for (const index of order) {
    const node = nodes[index]!;
    canonicalWork(resources, 1 + node.neighbors.length);
    const adjacent = node.neighbors
      .slice()
      .sort((first, second) => colors[first]! - colors[second]!);
    if (node.topology === "face") {
      faces.push(
        Object.freeze({
          id: ids.get(index)!,
          ...(node.intrinsic as unknown as Omit<KernelShapeSemanticFaceV1, "id" | "edges">),
          edges: Object.freeze(adjacent.map((neighbor) => ids.get(neighbor)!)),
        }),
      );
    } else if (node.topology === "edge") {
      const faceIds: string[] = [];
      const vertexIds: string[] = [];
      for (const neighbor of adjacent) {
        (nodes[neighbor]!.topology === "face" ? faceIds : vertexIds).push(ids.get(neighbor)!);
      }
      edges.push(
        Object.freeze({
          id: ids.get(index)!,
          ...(node.intrinsic as unknown as Omit<KernelShapeSemanticEdgeV1, "id" | "faces" | "vertices">),
          faces: Object.freeze(faceIds),
          vertices: Object.freeze(vertexIds),
        }),
      );
    } else {
      vertices.push(
        Object.freeze({
          id: ids.get(index)!,
          ...(node.intrinsic as unknown as Omit<KernelShapeSemanticVertexV1, "id" | "edges">),
          edges: Object.freeze(adjacent.map((neighbor) => ids.get(neighbor)!)),
        }),
      );
    }
  }
  const value = Object.freeze({
    faces: Object.freeze(faces),
    edges: Object.freeze(edges),
    vertices: Object.freeze(vertices),
  });
  return {
    key: boundedCanonicalKey(value, budget.maximumBytes, resources).key,
    value,
  };
}

function canonicalLabelGraph(
  nodes: readonly GraphNode[],
  resources: ObservationResources,
  budget: SnapshotMaterializationBudget,
): Omit<Extract<KernelShapeSemanticTopologyV1, { support: "observed" }>, "support" | "history"> {
  canonicalWork(resources, nodes.length);
  const initial = rankLabels(nodes.map((node) => node.intrinsicKey));
  const search = (input: readonly number[]): ReturnType<typeof canonicalTopologyLeaf> => {
    resources.canonicalLabelStates += 1;
    if (
      resources.canonicalLabelStates >
      resources.limits.maxCanonicalLabelStates
    ) {
      throw limitFailure(
        "maxCanonicalLabelStates",
        resources.limits.maxCanonicalLabelStates,
        resources.canonicalLabelStates,
      );
    }
    throwIfAborted(resources);
    const colors = refineColors(nodes, input, resources);
    const cells = new Map<number, number[]>();
    colors.forEach((color, index) => {
      const cell = cells.get(color);
      if (cell === undefined) cells.set(color, [index]);
      else cell.push(index);
    });
    const unresolved = [...cells.entries()]
      .filter(([, cell]) => cell.length > 1)
      .sort(([firstColor, first], [secondColor, second]) =>
        first.length - second.length || firstColor - secondColor,
      )[0];
    if (unresolved === undefined) {
      return canonicalTopologyLeaf(nodes, colors, resources, budget);
    }
    const [selectedColor, cell] = unresolved;
    let best: ReturnType<typeof canonicalTopologyLeaf> | undefined;
    for (const candidate of cell) {
      const labels = colors.map((color, index) =>
        color === selectedColor ? `${color}:${index === candidate ? 0 : 1}` : `${color}:2`,
      );
      const result = search(rankLabels(labels));
      if (best === undefined || lexicalCompare(result.key, best.key) < 0) best = result;
    }
    return best!;
  };
  return search(initial).value;
}

function observeTopology(
  access: KernelObservationAccess,
  shape: KernelShape,
  mode: CapturedPlan["topology"],
  resources: ObservationResources,
  budget: SnapshotMaterializationBudget,
): KernelShapeSemanticTopologyV1 {
  if (mode === "omit") return Object.freeze({ support: "omitted" as const });
  const advertised = access.topologyAdvertised;
  const method = access.topology;
  if (!advertised && method === undefined) {
    if (mode === "required") {
      throw new ObservationFailure(
        diagnostic(
          "KERNEL_CAPABILITY_MISSING",
          "Kernel shape semantic observation requires topology support",
          { severity: "error" },
        ),
      );
    }
    return Object.freeze({ support: "unsupported" as const });
  }
  if (!advertised || typeof method !== "function") {
    throw kernelFailure("Geometry kernel topology capability and method are inconsistent");
  }
  operation(resources);
  const raw = Reflect.apply(method, access.kernel, [shape]);
  throwIfAborted(resources);
  let normalized: CadResult<KernelTopologySnapshot>;
  const topologyUsage = { stringBytes: 0 };
  try {
    normalized = normalizeKernelTopologySnapshot(raw, {
      maxTopologyItems: resources.limits.maxTopologyItems,
      maxAdjacencyLinks: resources.limits.maxAdjacencyLinks,
      maxEvidenceRecords: resources.limits.maxLineageRecords,
      maxStringBytes:
        resources.limits.maxStringBytes - resources.stringBytes,
    }, topologyUsage);
  } catch (error) {
    if (isKernelTopologySnapshotCopyLimitError(error)) {
      const resource =
        error.resource === "maxEvidenceRecords"
          ? "maxLineageRecords"
          : error.resource;
      throw limitFailure(
        resource,
        resources.limits[resource],
        resource === "maxStringBytes"
          ? resources.stringBytes + error.actual
          : error.actual,
      );
    }
    throw error;
  }
  if (!normalized.ok) throw new ObservationFailure(...normalized.diagnostics);
  resources.stringBytes += topologyUsage.stringBytes;
  const snapshot = normalized.value;
  const topologyItems =
    snapshot.faces.length + snapshot.edges.length + snapshot.vertices.length;
  const adjacencyLinks =
    snapshot.faces.reduce((total, item) => total + item.edges.length, 0) +
    snapshot.edges.reduce(
      (total, item) => total + item.faces.length + item.vertices.length,
      0,
    ) +
    snapshot.vertices.reduce((total, item) => total + item.edges.length, 0);
  accountSnapshotMinimumBytes(
    budget,
    topologyItems * MIN_CANONICAL_TOPOLOGY_ITEM_BYTES +
      adjacencyLinks * MIN_CANONICAL_ADJACENCY_LINK_BYTES,
    resources,
  );
  const descriptors = [
    ...snapshot.faces,
    ...snapshot.edges,
    ...snapshot.vertices,
  ];
  const indexByKey = new Map(descriptors.map((descriptor, index) => [descriptor.key, index]));
  const nodes: GraphNode[] = descriptors.map((descriptor) => {
    throwIfAborted(resources);
    const intrinsic =
      descriptor.topology === "face"
        ? faceIntrinsic(descriptor, resources, budget)
        : descriptor.topology === "edge"
          ? edgeIntrinsic(descriptor, resources, budget)
          : vertexIntrinsic(descriptor, resources, budget);
    const adjacentKeys =
      descriptor.topology === "face"
        ? descriptor.edges
        : descriptor.topology === "edge"
          ? [...descriptor.faces, ...descriptor.vertices]
          : descriptor.edges;
    return {
      topology: descriptor.topology,
      key: descriptor.key,
      intrinsic,
      intrinsicKey: boundedCanonicalKey(
        intrinsic,
        budget.maximumBytes,
        resources,
      ).key,
      neighbors: Object.freeze(adjacentKeys.map((key) => indexByKey.get(key)!)),
    };
  });
  const canonical = canonicalLabelGraph(nodes, resources, budget);
  return Object.freeze({
    support: "observed" as const,
    history: snapshot.history,
    ...canonical,
  });
}

function observeStatus(
  access: KernelObservationAccess,
  shape: KernelShape,
  resources: ObservationResources,
): KernelShapeSemanticStatusV1 {
  operation(resources);
  const raw = Reflect.apply(access.status, access.kernel, [shape]);
  throwIfAborted(resources);
  if (!isRecord(raw)) {
    throw kernelFailure("Geometry kernel returned an invalid shape status");
  }
  const ok = raw.ok;
  const code = raw.code;
  const message = raw.message;
  if (typeof ok !== "boolean") {
    throw kernelFailure("Geometry kernel returned an invalid shape status");
  }
  return Object.freeze({
    ok,
    code: boundedString(code, "shape status code", resources),
    ...(message === undefined
      ? {}
      : {
          message: boundedString(
            message,
            "shape status message",
            resources,
            true,
          ),
        }),
  });
}

function observeMeasurements(
  access: KernelObservationAccess,
  shape: KernelShape,
  resources: ObservationResources,
): KernelShapeSemanticMeasurementsV1 {
  operation(resources);
  const raw = Reflect.apply(access.measure, access.kernel, [shape]);
  throwIfAborted(resources);
  if (!isRecord(raw)) {
    throw kernelFailure("Geometry kernel returned invalid shape measurements");
  }
  const boundingBox = raw.boundingBox;
  if (!isRecord(boundingBox)) {
    throw kernelFailure("Geometry kernel returned invalid shape measurements");
  }
  const volume = raw.volume;
  const surfaceArea = raw.surfaceArea;
  const genus = raw.genus;
  const tolerance = raw.tolerance;
  const inertia = raw.inertiaTensor;
  const center = raw.centerOfMass;
  const minimum = boundingBox.min;
  const maximum = boundingBox.max;
  if (
    !Array.isArray(inertia) ||
    inertia.length !== 3 ||
    !Object.hasOwn(inertia, 0) ||
    !Object.hasOwn(inertia, 1) ||
    !Object.hasOwn(inertia, 2)
  ) {
    throw kernelFailure("Geometry kernel returned an invalid inertia tensor");
  }
  const inertiaFirst = inertia[0];
  const inertiaSecond = inertia[1];
  const inertiaThird = inertia[2];
  if (center !== null && !Array.isArray(center)) {
    throw kernelFailure("Geometry kernel returned an invalid center of mass");
  }
  if (
    typeof volume !== "number" ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    typeof surfaceArea !== "number" ||
    !Number.isFinite(surfaceArea) ||
    surfaceArea < 0 ||
    typeof genus !== "number" ||
    !Number.isSafeInteger(genus) ||
    genus < 0 ||
    typeof tolerance !== "number" ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  ) {
    throw kernelFailure("Geometry kernel returned invalid shape measurement scalars");
  }
  const capturedMinimum = captureVec3(minimum, "shape bounding box");
  const capturedMaximum = captureVec3(maximum, "shape bounding box");
  if (capturedMinimum.value.some(
    (component, index) => component > capturedMaximum.value[index]!,
  )) {
    throw kernelFailure("Geometry kernel returned an invalid shape bounding box");
  }
  const capturedCenter = center === null
    ? null
    : captureVec3(center, "shape center of mass").encoded;
  const capturedInertia = Object.freeze([
    captureVec3(inertiaFirst, "shape inertia tensor").encoded,
    captureVec3(inertiaSecond, "shape inertia tensor").encoded,
    captureVec3(inertiaThird, "shape inertia tensor").encoded,
  ]) as KernelShapeSemanticMeasurementsV1["inertiaTensor"];
  return Object.freeze({
    volume: f64(volume, "shape volume"),
    surfaceArea: f64(surfaceArea, "shape surface area"),
    centerOfMass: capturedCenter,
    inertiaTensor: capturedInertia,
    boundingBox: Object.freeze({
      min: capturedMinimum.encoded,
      max: capturedMaximum.encoded,
    }),
    genus: f64(genus, "shape genus"),
    tolerance: f64(tolerance, "shape tolerance"),
  });
}

function observeSnapshot(
  access: KernelObservationAccess,
  shape: KernelShape,
  plan: CapturedPlan,
  resources: ObservationResources,
  maximumBytes = resources.limits.maxObservationBytes,
): {
  readonly value: KernelShapeSemanticSnapshotV1;
  readonly byteLength: number;
  readonly key: string;
} {
  throwIfAborted(resources);
  if (maximumBytes < 1) {
    throw limitFailure(
      "maxObservationBytes",
      resources.limits.maxObservationBytes,
    );
  }
  const budget: SnapshotMaterializationBudget = {
    maximumBytes,
    minimumBytes: 0,
  };
  let shapeKernel: unknown;
  try {
    shapeKernel = shape.kernel;
  } catch (error) {
    throw kernelFailure(safeErrorMessage(error, "Shape identity could not be inspected"));
  }
  if (shapeKernel !== access.id) {
    throw kernelFailure("Observed shape does not belong to the supplied kernel");
  }
  const status = observeStatus(access, shape, resources);
  if (!status.ok) {
    throw kernelFailure(`Geometry kernel reported non-live shape status '${status.code}'`);
  }
  const measurements = observeMeasurements(access, shape, resources);
  const meshes = plan.meshes.map((request) =>
    observeMesh(access, shape, request, resources, budget),
  );
  const topology = observeTopology(
    access,
    shape,
    plan.topology,
    resources,
    budget,
  );
  const snapshot = deepFreeze({
    kernel: access.id,
    status,
    measurements,
    meshes,
    topology,
  }) as KernelShapeSemanticSnapshotV1;
  const canonical = boundedCanonicalKey(snapshot, maximumBytes, resources);
  return Object.freeze({
    value: snapshot,
    byteLength: canonical.byteLength,
    key: canonical.key,
  });
}

function advertisedStrings(
  value: unknown,
  label: string,
  resources: ObservationResources,
  known: ReadonlySet<string>,
): readonly string[] {
  const captured = copyBoundedDenseArray(value, known.size);
  if (captured === undefined) {
    throw kernelFailure(`Geometry kernel returned invalid ${label} capabilities`);
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of captured) {
    const captured = boundedString(item, `${label} capability`, resources);
    if (!known.has(captured)) {
      throw kernelFailure(`Geometry kernel returned an unknown ${label} capability`);
    }
    if (seen.has(captured)) {
      throw kernelFailure(`Geometry kernel returned duplicate ${label} capabilities`);
    }
    seen.add(captured);
    output.push(captured);
  }
  return Object.freeze(output);
}

function captureKernelAccess(
  kernel: GeometryKernel,
  plan: CapturedPlan,
  resources: ObservationResources,
): KernelObservationAccess {
  try {
    const rawId = kernel.id;
    const capabilities = kernel.capabilities;
    if (!isRecord(capabilities)) {
      throw kernelFailure("Geometry kernel returned invalid capabilities");
    }
    const rawFeatures = capabilities.features;
    const rawNativeImports = capabilities.nativeImports;
    const rawNativeExports = capabilities.nativeExports;
    const rawTopology = capabilities.topology;
    const mesh = kernel.mesh;
    const measure = kernel.measure;
    const status = kernel.status;
    const disposeShape = kernel.disposeShape;
    const topology =
      plan.topology === "omit" ? undefined : kernel.topology;
    const exportShape =
      plan.nativeExchanges.length === 0 ? undefined : kernel.exportShape;
    const importShape =
      plan.nativeExchanges.length === 0 ? undefined : kernel.importShape;
    if (
      typeof mesh !== "function" ||
      typeof measure !== "function" ||
      typeof status !== "function" ||
      typeof disposeShape !== "function"
    ) {
      throw kernelFailure("Geometry kernel observation methods are incomplete");
    }
    return Object.freeze({
      kernel,
      id: boundedString(rawId, "kernel identifier", resources),
      features: advertisedStrings(
        rawFeatures,
        "feature",
        resources,
        KERNEL_FEATURES,
      ),
      nativeImports: advertisedStrings(
        rawNativeImports,
        "native import",
        resources,
        EXCHANGE_FORMATS,
      ),
      nativeExports: advertisedStrings(
        rawNativeExports,
        "native export",
        resources,
        EXCHANGE_FORMATS,
      ),
      topologyAdvertised: rawTopology !== undefined,
      mesh,
      measure,
      status,
      disposeShape,
      topology,
      exportShape,
      importShape,
    });
  } catch (error) {
    if (isObservationFailure(error)) throw error;
    throw kernelFailure(
      safeErrorMessage(
        error,
        "Geometry kernel observation interface could not be captured",
      ),
    );
  }
}

interface CapturedPromiseLike {
  readonly target: object | ((...arguments_: readonly unknown[]) => unknown);
  readonly then: (...arguments_: readonly unknown[]) => unknown;
  readonly usesIntrinsicPromiseThen: boolean;
}

function capturePromiseLike(value: unknown): CapturedPromiseLike | undefined {
  if (
    !(
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    )
  ) {
    return undefined;
  }
  const then = Reflect.get(value, "then");
  return typeof then === "function"
    ? Object.freeze({
        target: value,
        then,
        usesIntrinsicPromiseThen: then === INTRINSIC_PROMISE_THEN,
      })
    : undefined;
}

function promiseFromCaptured(
  value: CapturedPromiseLike,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    Reflect.apply(value.then, value.target, [resolve, reject]);
  });
}

function awaitAbortableProbe(
  value: CapturedPromiseLike,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (signal === undefined) return promiseFromCaptured(value);
  return new Promise((resolve, reject) => {
    let settled = false;
    let abortQueued = false;
    let listenerRegistered = false;
    const removeAbortListener = (): void => {
      if (!listenerRegistered) return;
      listenerRegistered = false;
      try {
        Reflect.apply(EVENT_TARGET_REMOVE_EVENT_LISTENER!, signal, [
          "abort",
          onAbort,
        ]);
      } catch {
        // Listener cleanup must never strand an otherwise settled probe.
      }
    };
    const settleAborted = (): void => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      reject(
        new ObservationFailure(
          diagnostic(
            "EVALUATION_ABORTED",
            "Kernel shape semantic observation was aborted",
            { severity: "error" },
          ),
        ),
      );
    };
    const onAbort = (): void => {
      if (abortQueued || settled) return;
      abortQueued = true;
      if (value.usesIntrinsicPromiseThen) {
        // A native Promise reaction already queued by an earlier resolution
        // must win this race so its returned owners can transfer and be
        // cleaned. Pending native reactions are queued after this rejection.
        queueMicrotask(settleAborted);
      } else {
        // Generic thenables expose callback delivery, not an observable prior
        // settlement instant. Once cancellation is visible, later callbacks
        // retain their results as probe-owned values.
        settleAborted();
      }
    };
    Reflect.apply(EVENT_TARGET_ADD_EVENT_LISTENER!, signal, [
      "abort",
      onAbort,
      { once: true },
    ]);
    listenerRegistered = true;
    if (
      !value.usesIntrinsicPromiseThen &&
      abortSignalIsAborted(signal)
    ) {
      onAbort();
      return;
    }
    const onFulfilled = (
      result: unknown,
    ): void => {
      if (settled) return;
      if (
        !value.usesIntrinsicPromiseThen &&
        abortSignalIsAborted(signal)
      ) {
        onAbort();
        return;
      }
      settled = true;
      removeAbortListener();
      resolve(result);
    };
    const onRejected = (error: unknown): void => {
      if (settled) return;
      if (
        !value.usesIntrinsicPromiseThen &&
        abortSignalIsAborted(signal)
      ) {
        onAbort();
        return;
      }
      settled = true;
      removeAbortListener();
      reject(error);
    };
    try {
      Reflect.apply(value.then, value.target, [onFulfilled, onRejected]);
    } catch (error) {
      onRejected(error);
    }
    if (abortSignalIsAborted(signal)) onAbort();
  });
}

/**
 * Produces a bounded, detached, deeply frozen semantic observation. Numeric
 * equality is bit-exact; protocol v1 never tolerance-rounds values.
 */
export async function observeKernelShapeSemantics(
  kernel: GeometryKernel,
  shape: KernelShape,
  plan: KernelShapeSemanticObservationPlan,
  options: ObserveKernelShapeSemanticsOptions = {},
): Promise<CadResult<KernelShapeSemanticObservation>> {
  let rawLimits: unknown;
  let rawSignal: unknown;
  try {
    if (!isRecord(options)) {
      return invalidOptions(
        "Kernel shape semantic observation options must be an object",
      );
    }
    if (
      Object.keys(options).some(
        (key) => key !== "signal" && key !== "limits",
      )
    ) {
      return invalidOptions(
        "Kernel shape semantic observation options contain unknown fields",
      );
    }
    rawLimits = Object.hasOwn(options, "limits")
      ? options.limits
      : undefined;
    rawSignal = Object.hasOwn(options, "signal")
      ? options.signal
      : undefined;
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(
        error,
        "Kernel shape semantic observation options could not be inspected",
      ),
    );
  }
  const limitsResult = captureLimits(rawLimits);
  if (!limitsResult.ok) return limitsResult;
  const signalResult = captureSignal(rawSignal);
  if (!signalResult.ok) return signalResult;
  if (
    signalResult.value !== undefined &&
    abortSignalIsAborted(signalResult.value)
  ) {
    return failure(
      diagnostic(
        "EVALUATION_ABORTED",
        "Kernel shape semantic observation was aborted",
        { severity: "error" },
      ),
    );
  }
  const planResult = capturePlan(plan, limitsResult.value);
  if (!planResult.ok) return planResult;
  const capturedPlan = planResult.value;
  const resources: ObservationResources = {
    limits: limitsResult.value,
    ...(signalResult.value === undefined ? {} : { signal: signalResult.value }),
    operations: 0,
    stringBytes: 0,
    meshVertices: 0,
    meshTriangles: 0,
    derivedShapes: 0,
    canonicalLabelStates: 0,
    canonicalWork: 0,
  };
  let access: KernelObservationAccess;
  try {
    access = captureKernelAccess(kernel, capturedPlan, resources);
  } catch (error) {
    return isObservationFailure(error)
      ? failure(...error.diagnostics)
      : failure(
          diagnostic(
            "ARTIFACT_CACHE_OPERATION_FAILED",
            safeErrorMessage(
              error,
              "Geometry kernel observation interface could not be captured",
            ),
            { severity: "error" },
          ),
        );
  }
  const tracked: TrackedDerivedShape[] = [];
  const adopted = new Set<KernelShape>();
  const cleanupDiagnostics: Diagnostic[] = [];
  let outcome: CadResult<KernelShapeSemanticObservation> | undefined;
  const adopt = (derived: KernelShape): TrackedDerivedShape => {
    if (
      typeof derived !== "object" ||
      derived === null ||
      derived === shape ||
      adopted.has(derived)
    ) {
      throw kernelFailure("Semantic probe returned a source or reused shape alias");
    }
    adopted.add(derived);
    const item = { shape: derived, live: true };
    tracked.push(item);
    resources.derivedShapes += 1;
    return item;
  };
  const enforceDerivedShapeLimit = (): void => {
    if (resources.derivedShapes > resources.limits.maxDerivedShapes) {
      throw limitFailure(
        "maxDerivedShapes",
        resources.limits.maxDerivedShapes,
        resources.derivedShapes,
      );
    }
  };
  const disposeTracked = (item: TrackedDerivedShape): void => {
    if (!item.live) return;
    operation(resources);
    item.live = false;
    Reflect.apply(access.disposeShape, access.kernel, [item.shape]);
  };
  try {
    throwIfAborted(resources);
    boundedString(capturedPlan.id, "observation plan identifier", resources);
    for (const request of capturedPlan.meshes) {
      boundedString(request.id, "semantic mesh request identifier", resources);
    }
    for (const probe of capturedPlan.probes) {
      boundedString(probe.id, "semantic probe identifier", resources);
    }
    for (const exclusion of capturedPlan.notApplicableFeatures) {
      boundedString(
        exclusion.reason,
        "semantic feature-exclusion reason",
        resources,
      );
    }
    const features = access.features;
    const nativeImports = new Set(access.nativeImports);
    const nativeExports = new Set(access.nativeExports);
    const probesByFeature = new Map(
      capturedPlan.probes.map((probe) => [probe.feature, probe]),
    );
    const excludedByFeature = new Map(
      capturedPlan.notApplicableFeatures.map((item) => [item.feature, item]),
    );
    for (const feature of features) {
      if (!probesByFeature.has(feature as KernelFeature) && !excludedByFeature.has(feature as KernelFeature)) {
        throw new ObservationFailure(
          diagnostic(
            "KERNEL_CAPABILITY_MISSING",
            `Observation plan does not cover advertised feature '${feature}'`,
            { severity: "error" },
          ),
        );
      }
    }
    for (const feature of [...probesByFeature.keys(), ...excludedByFeature.keys()]) {
      if (!features.includes(feature)) {
        throw new ObservationFailure(
          diagnostic(
            "KERNEL_CAPABILITY_MISSING",
            `Observation plan names unadvertised feature '${feature}'`,
            { severity: "error" },
          ),
        );
      }
    }
    const capturedBaseline = observeSnapshot(
      access,
      shape,
      capturedPlan,
      resources,
    );
    const baseline = capturedBaseline.value;
    const baselineKey = capturedBaseline.key;
    let retainedSnapshotBytes = capturedBaseline.byteLength;
    const nativeExchanges: KernelShapeSemanticNativeExchangeV1[] = [];
    for (const format of capturedPlan.nativeExchanges) {
      if (
        !nativeImports.has(format) ||
        !nativeExports.has(format) ||
        typeof access.exportShape !== "function" ||
        typeof access.importShape !== "function"
      ) {
        throw new ObservationFailure(
          diagnostic(
            "KERNEL_CAPABILITY_MISSING",
            `Observation plan requires native ${format} round-trip support`,
            { severity: "error" },
          ),
        );
      }
      operation(resources);
      const exported = Reflect.apply(access.exportShape, access.kernel, [
        shape,
        format,
        {
          ...(resources.signal === undefined
            ? {}
            : { signal: resources.signal }),
        },
      ]);
      throwIfAborted(resources);
      const exportedByteLength = typedArrayByteLength(exported, "Uint8Array");
      if (exportedByteLength === undefined || exportedByteLength === 0) {
        throw kernelFailure(`Geometry kernel returned an invalid ${format} export`);
      }
      if (exportedByteLength > resources.limits.maxNativeExchangeBytes) {
        throw limitFailure(
          "maxNativeExchangeBytes",
          resources.limits.maxNativeExchangeBytes,
          exportedByteLength,
        );
      }
      const bytes = typedArrayCopy<Uint8Array>(
        exported,
        "Uint8Array",
        exportedByteLength,
      );
      if (
        bytes === undefined ||
        bytes.byteLength !== exportedByteLength
      ) {
        throw kernelFailure(`Geometry kernel ${format} export changed while it was being copied`);
      }
      operation(resources);
      const imported = adopt(
        Reflect.apply(access.importShape, access.kernel, [
          bytes,
          format,
          {
            ...(resources.signal === undefined
              ? {}
              : { signal: resources.signal }),
          },
        ]),
      );
      enforceDerivedShapeLimit();
      throwIfAborted(resources);
      const importedSnapshot = observeSnapshot(
        access,
        imported.shape,
        capturedPlan,
        resources,
        resources.limits.maxObservationBytes - retainedSnapshotBytes,
      );
      retainedSnapshotBytes += importedSnapshot.byteLength;
      nativeExchanges.push(
        Object.freeze({ format, imported: importedSnapshot.value }),
      );
      disposeTracked(imported);
      if (
        observeSnapshot(access, shape, capturedPlan, resources).key !==
        baselineKey
      ) {
        throw kernelFailure("Native exchange changed the borrowed source shape");
      }
    }
    const probes: KernelShapeSemanticProbeObservationV1[] = [];
    for (const probe of capturedPlan.probes) {
      operation(resources);
      const pendingResult = probe.run(kernel, shape, {
        ...(resources.signal === undefined ? {} : { signal: resources.signal }),
        maxDerivedShapes: Math.max(
          0,
          resources.limits.maxDerivedShapes - resources.derivedShapes,
        ),
      });
      const capturedPendingResult = capturePromiseLike(pendingResult);
      const result = capturedPendingResult !== undefined
        ? await awaitAbortableProbe(capturedPendingResult, resources.signal)
        : pendingResult;
      const owned: TrackedDerivedShape[] = [];
      let adoptionError: unknown;
      let probeFailure: ObservationFailure | undefined;
      let returnedDiagnostics: readonly Diagnostic[] | undefined;
      try {
        if (!isRecord(result)) {
          probeFailure = kernelFailure(
            `Semantic probe '${probe.id}' returned an invalid result`,
          );
        } else {
          const resultOk = result.ok;
          if (typeof resultOk !== "boolean") {
            probeFailure = kernelFailure(
              `Semantic probe '${probe.id}' returned an invalid result`,
            );
          } else if (!resultOk) {
            const rawDiagnostics = result.diagnostics;
            const capturedDiagnostics = copyBoundedDenseArray(
              rawDiagnostics,
              resources.limits.maxProbes,
            );
            if (capturedDiagnostics === undefined || capturedDiagnostics.length === 0) {
              probeFailure = kernelFailure(
                `Semantic probe '${probe.id}' returned invalid diagnostics`,
              );
            } else {
              const normalized: Diagnostic[] = [];
              for (let index = 0; index < capturedDiagnostics.length; index += 1) {
                const rawDiagnostic = capturedDiagnostics[index];
                if (!isRecord(rawDiagnostic)) {
                  probeFailure = kernelFailure(
                    `Semantic probe '${probe.id}' returned invalid diagnostics`,
                  );
                  break;
                }
                const code = rawDiagnostic.code;
                const message = rawDiagnostic.message;
                const severity = rawDiagnostic.severity;
                if (
                  typeof code !== "string" ||
                  code.length === 0 ||
                  typeof message !== "string" ||
                  (severity !== "info" &&
                    severity !== "warning" &&
                    severity !== "error")
                ) {
                  probeFailure = kernelFailure(
                    `Semantic probe '${probe.id}' returned invalid diagnostics`,
                  );
                  break;
                }
                const capturedCode = boundedString(
                  code,
                  "semantic probe diagnostic code",
                  resources,
                );
                const capturedMessage = boundedString(
                  message,
                  "semantic probe diagnostic message",
                  resources,
                  true,
                );
                normalized.push(
                  diagnostic(
                    "ARTIFACT_CACHE_OPERATION_FAILED",
                    `Semantic probe '${probe.id}' failed (${capturedCode}): ${capturedMessage}`,
                    {
                      severity: "error",
                      details: {
                        probe: probe.id,
                        reportedCode: capturedCode,
                        reportedSeverity: severity,
                      },
                    },
                  ),
                );
              }
              if (probeFailure === undefined) {
                returnedDiagnostics = Object.freeze(normalized);
              }
            }
          } else {
            const returnedShapes: unknown = result.value;
            let returnedLength: number | undefined;
            let capturedReturnedShapes: readonly unknown[] | undefined;
            if (Array.isArray(returnedShapes)) {
              const candidateLength = returnedShapes.length;
              if (
                Number.isSafeInteger(candidateLength) &&
                candidateLength > 0 &&
                candidateLength <= 0xffff_ffff
              ) {
                returnedLength = candidateLength;
                capturedReturnedShapes = returnedShapes;
              }
            }
            if (returnedLength === undefined || capturedReturnedShapes === undefined) {
              probeFailure = kernelFailure(
                `Semantic probe '${probe.id}' returned invalid shapes`,
              );
            } else {
              // A successful callback transfers its complete returned array at
              // once. Adopt every inspectable owner before reporting aliases,
              // aggregate limits, or cancellation so later entries cannot leak.
              for (let index = 0; index < returnedLength; index += 1) {
                try {
                  if (!Object.hasOwn(capturedReturnedShapes, index)) {
                    adoptionError ??= kernelFailure(
                      `Semantic probe '${probe.id}' returned invalid shapes`,
                    );
                    continue;
                  }
                  owned.push(adopt(capturedReturnedShapes[index] as KernelShape));
                } catch (error) {
                  adoptionError ??= error;
                }
              }
            }
          }
        }
      } catch (error) {
        probeFailure = kernelFailure(
          safeErrorMessage(
            error,
            `Semantic probe '${probe.id}' result could not be inspected`,
          ),
        );
      }
      // Cancellation wins the reported outcome, but only after every returned
      // owner that can be discovered has entered the cleanup ledger.
      throwIfAborted(resources);
      if (probeFailure !== undefined) throw probeFailure;
      if (returnedDiagnostics !== undefined) {
        throw new ObservationFailure(...returnedDiagnostics);
      }
      if (adoptionError !== undefined) throw adoptionError;
      enforceDerivedShapeLimit();
      const capturedSnapshots: {
        readonly value: KernelShapeSemanticSnapshotV1;
        readonly key: string;
      }[] = [];
      for (const item of owned) {
        const capturedSnapshot = observeSnapshot(
          access,
          item.shape,
          capturedPlan,
          resources,
          resources.limits.maxObservationBytes - retainedSnapshotBytes,
        );
        retainedSnapshotBytes += capturedSnapshot.byteLength;
        capturedSnapshots.push({
          value: capturedSnapshot.value,
          key: capturedSnapshot.key,
        });
      }
      capturedSnapshots.sort((first, second) =>
        lexicalCompare(first.key, second.key),
      );
      const snapshots = capturedSnapshots.map((item) => item.value);
      probes.push(
        Object.freeze({
          id: probe.id,
          feature: probe.feature,
          shapes: Object.freeze(snapshots),
        }),
      );
      for (let index = owned.length - 1; index >= 0; index -= 1) {
        disposeTracked(owned[index]!);
      }
      if (
        observeSnapshot(access, shape, capturedPlan, resources).key !==
        baselineKey
      ) {
        throw kernelFailure(`Semantic probe '${probe.id}' changed the borrowed source shape`);
      }
    }
    const observation = deepFreeze({
      kind: "kernel-shape-semantic-observation" as const,
      protocolVersion: KERNEL_SHAPE_SEMANTIC_OBSERVATION_PROTOCOL_VERSION,
      planId: capturedPlan.id,
      numericEncoding: "ieee754-be-hex-normalized-zero" as const,
      meshEncoding: "oriented-triangle-multiset-f32" as const,
      topologyEncoding: "bounded-canonical-incidence-graph" as const,
      ...baseline,
      nativeExchanges,
      probes,
      coverage: {
        meshes: capturedPlan.meshes.map((request) => request.id),
        topology: baseline.topology.support,
        nativeExchanges: capturedPlan.nativeExchanges,
        probedFeatures: capturedPlan.probes.map((probe) => probe.feature).sort(lexicalCompare),
        notApplicableFeatures: capturedPlan.notApplicableFeatures,
      },
    }) as KernelShapeSemanticObservation;
    const canonicalByteLength = canonicalProtocolByteLengthWithin(
      observation,
      resources.limits.maxObservationBytes,
      () => throwIfAborted(resources),
    );
    if (canonicalByteLength === undefined) {
      throw limitFailure(
        "maxObservationBytes",
        resources.limits.maxObservationBytes,
      );
    }
    const canonical = canonicalStringifyProtocol(observation);
    const observationCapacity = Math.min(
      resources.limits.maxObservationBytes + 1,
      Math.max(1, canonical.length * 3),
    );
    const observationBytes = new Uint8Array(observationCapacity);
    const encoded = new TextEncoder().encodeInto(canonical, observationBytes);
    if (
      encoded.read !== canonical.length ||
      encoded.written !== canonicalByteLength
    ) {
      throw limitFailure(
        "maxObservationBytes",
        resources.limits.maxObservationBytes,
      );
    }
    capturedObservations.add(observation);
    outcome = success(observation);
  } catch (error) {
    outcome =
      isObservationFailure(error)
        ? failure(...error.diagnostics)
        : failure(
            diagnostic(
              resources.signal !== undefined &&
                abortSignalIsAborted(resources.signal)
                ? "EVALUATION_ABORTED"
                : "ARTIFACT_CACHE_OPERATION_FAILED",
              safeErrorMessage(error, "Kernel shape semantic observation failed"),
              { severity: "error" },
            ),
          );
  } finally {
    for (let index = tracked.length - 1; index >= 0; index -= 1) {
      const item = tracked[index]!;
      if (!item.live) continue;
      item.live = false;
      try {
        Reflect.apply(access.disposeShape, access.kernel, [item.shape]);
      } catch (error) {
        cleanupDiagnostics.push(
          diagnostic(
            "KERNEL_ERROR",
            safeErrorMessage(error, "Derived semantic-probe shape cleanup failed"),
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
  return outcome ?? failure(
    diagnostic(
      "ARTIFACT_CACHE_OPERATION_FAILED",
      "Kernel shape semantic observation ended without a result",
      { severity: "error" },
    ),
  );
}

/** Encodes an observation produced by this runtime as canonical JSON UTF-8. */
export function encodeKernelShapeSemanticObservation(
  observation: KernelShapeSemanticObservation,
  options: { readonly maxBytes?: number } = {},
): CadResult<Uint8Array> {
  try {
    if (!isRecord(options) || Object.keys(options).some((key) => key !== "maxBytes")) {
      return invalidOptions("Kernel shape semantic observation encoding options are malformed");
    }
    const rawMaximum = Object.hasOwn(options, "maxBytes")
      ? options.maxBytes
      : undefined;
    const maximum =
      rawMaximum === undefined
        ? DEFAULT_KERNEL_SHAPE_SEMANTIC_OBSERVATION_LIMITS.maxObservationBytes
        : rawMaximum;
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      return invalidOptions("Kernel shape semantic observation maxBytes must be a positive safe integer");
    }
    if (
      typeof observation !== "object" ||
      observation === null ||
      !capturedObservations.has(observation)
    ) {
      return invalidOptions("Only a captured kernel shape semantic observation can be encoded");
    }
    const byteLength = canonicalProtocolByteLengthWithin(
      observation,
      maximum,
    );
    if (byteLength === undefined) {
      return failure(
        diagnostic(
          "ARTIFACT_CACHE_LIMIT_EXCEEDED",
          "Kernel shape semantic observation exceeds maxBytes",
          { severity: "error", details: { limit: maximum } },
        ),
      );
    }
    const text = canonicalStringifyProtocol(observation);
    const capacity = Math.min(maximum + 1, Math.max(1, text.length * 3));
    const target = new Uint8Array(capacity);
    const encoded = new TextEncoder().encodeInto(text, target);
    if (encoded.read !== text.length || encoded.written !== byteLength) {
      return failure(
        diagnostic(
          "ARTIFACT_CACHE_LIMIT_EXCEEDED",
          "Kernel shape semantic observation exceeds maxBytes",
          { severity: "error", details: { limit: maximum } },
        ),
      );
    }
    return success(target.slice(0, encoded.written));
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Kernel shape semantic observation could not be encoded"),
    );
  }
}
