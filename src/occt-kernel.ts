import { TransitionMode } from "occt-wasm";
import type {
  OcctKernel as RawOcctKernel,
  ShapeHandle,
  Vec3 as OcctVec3,
} from "occt-wasm";
import type { Vec2, Vec3 } from "./core/math.js";
import { canonicalStringifyProtocol } from "./core/json.js";
import type {
  GeometryKernel,
  KernelCapabilities,
  KernelExchangeFormat,
  KernelFeatureContext,
  KernelShape,
  KernelShapeStatus,
  MeshData,
  MeshOptions,
  ResolvedTransformOperation,
  ShapeMeasurements,
} from "./kernel.js";
import type {
  KernelCurveDescriptor,
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelSurfaceDescriptor,
  KernelTopologyKey,
  KernelTopologyLineage,
  KernelTopologySnapshot,
  KernelTopologySource,
  KernelVertexDescriptor,
  TopologyRole,
} from "./protocol/topology.js";
import type {
  NumericPlane,
  ResolvedArcCurve,
  ResolvedCurve,
  ResolvedLoop,
  ResolvedProfile,
} from "./protocol/profile.js";
import {
  curveEnd,
  curveStart,
  numericPlaneBasis,
  resolvedArcSweep,
} from "./protocol/profile.js";
import { resolvedProfileLocalAreaMoments } from "./protocol/profile-moments.js";
import {
  validateRuledSolidLoftProfiles,
  type ResolvedLoftOptions,
} from "./protocol/loft.js";
import {
  resolvedCompositePathSegments,
  resolvedCircularArcGeometry,
  resolvedPathEdgeCount,
  resolvedPathSegmentEndTangent,
  resolvedPathSegmentLength,
  resolvedPathSegmentStartTangent,
  type ResolvedCircularArcDefinition,
  type ResolvedCircularArcPath,
  type ResolvedCompositePath,
  type ResolvedPath,
  type ResolvedPathSegment,
  type ResolvedPolylinePath,
} from "./protocol/path.js";
import {
  classifyResolvedCompositeSweepRefinements,
  validateResolvedSweep,
  type ResolvedSweepOptions,
} from "./protocol/sweep.js";
import type { ResolvedOffsetOptions } from "./protocol/offset.js";
import type { ResolvedShellOptions } from "./protocol/shell.js";
import {
  DRAFT_MIN_ANGLE_RADIANS,
  type ResolvedDraftOptions,
} from "./protocol/draft.js";
import { adoptOcctEdgeEvolution } from "./internal/occt-evolution.js";
import {
  DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT,
  OcctBooleanFacadeProtocolError,
  adoptOcctBoolean,
  type OcctBooleanFacadeModule,
  type OcctBooleanReportSnapshot,
} from "./internal/occt-boolean.js";
import {
  DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT,
  OcctEdgeTreatmentFacadeProtocolError,
  adoptOcctEdgeTreatment,
  type OcctEdgeTreatmentFacadeModule,
  type OcctEdgeTreatmentOperation,
  type OcctEdgeTreatmentReportSnapshot,
} from "./internal/occt-edge-treatment.js";
import {
  DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT,
  OcctSolidOffsetFacadeProtocolError,
  adoptOcctSolidOffset,
  type OcctSolidOffsetFacadeModule,
  type OcctSolidOffsetReportSnapshot,
} from "./internal/occt-solid-offset.js";
import {
  OcctDraftFacadeProtocolError,
  adoptOcctDraft,
  type OcctDraftFacadeModule,
  type OcctDraftReportSnapshot,
} from "./internal/occt-draft.js";
import {
  probeOcctFacade,
  type OcctFacadeProbe,
} from "./internal/occt-facade.js";
import { adoptOcctControlledPipeShell } from "./internal/occt-pipe-shell.js";
import {
  OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
  OcctArtifactWriteError,
  readBoundedOcctArtifactBrep,
  writeBoundedOcctArtifactBrep,
} from "./internal/occt-artifact-facade.js";
import { resolvedCompositeSweepVolumeOracle } from "./internal/transported-profile-volume.js";
import {
  combineMassProperties,
  inertiaTensorFromRowMajor,
  rescaleMassProperties,
  zeroMassProperties,
  type GeometricMassProperties,
} from "./internal/mesh-mass-properties.js";
import {
  certifyNativeProfileMassProperties,
  NATIVE_PROFILE_COORDINATE_ULP_FACTOR,
  type AnalyticProfileMassProperties,
  type NativeProfileMassPropertyCertificationFailureReason,
  type NativeProfileMassPropertyDiagnostics,
} from "./internal/profile-mass-properties.js";
import {
  TopologyEvolutionProtocolError,
  reduceCompleteIndexedTopologyEvolution,
  reduceIndexedTopologyEvolution,
  type IndexedTopologyCounts,
} from "./internal/topology-evolution.js";
import {
  OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS,
  remapOcctShapeArtifactTopology,
  type OcctShapeArtifactCandidateHost,
  type OcctShapeArtifactCapturedSidecarState,
  type OcctShapeArtifactCapturedState,
  type OcctShapeArtifactNativeStructure,
} from "./internal/occt-artifact-candidate.js";

export {
  DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT,
  DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT,
  DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT,
};

const OCCT_SHAPE = Symbol("InvariantCAD.OcctShape");
const TOPOLOGY_HASH_UPPER_BOUND = 2_147_483_647;
const MAX_ARTIFACT_NATIVE_TOPOLOGY_ITEMS = 400_000;
let nextTopologyNamespace = 1;

function exactBooleanHistoryRecordLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > TOPOLOGY_HASH_UPPER_BOUND
  ) {
    throw new RangeError(
      "maxExactBooleanHistoryRecords must be a signed 32-bit non-negative integer",
    );
  }
  return limit;
}

function exactEdgeTreatmentHistoryRecordLimit(
  value: number | undefined,
): number {
  const limit =
    value ?? DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > TOPOLOGY_HASH_UPPER_BOUND
  ) {
    throw new RangeError(
      "maxExactEdgeTreatmentHistoryRecords must be a signed 32-bit non-negative integer",
    );
  }
  return limit;
}

function exactSolidOffsetHistoryRecordLimit(
  value: number | undefined,
): number {
  const limit = value ?? DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > TOPOLOGY_HASH_UPPER_BOUND
  ) {
    throw new RangeError(
      "maxExactSolidOffsetHistoryRecords must be a signed 32-bit non-negative integer",
    );
  }
  return limit;
}

type TopologyHistory = KernelTopologySnapshot["history"];

interface RetainedTopologyHandle {
  readonly topology: "face" | "edge" | "vertex";
  readonly handle: ShapeHandle;
}

type TopologyDescriptor =
  | KernelFaceDescriptor
  | KernelEdgeDescriptor
  | KernelVertexDescriptor;

interface TopologyLineageSeed {
  readonly topology: "face" | "edge" | "vertex";
  readonly geometryKind: string;
  readonly center: Vec3;
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly measure: number;
  readonly lineage: readonly KernelTopologyLineage[];
}

interface TopologyAnnotation {
  readonly classify?: (
    descriptor: TopologyDescriptor,
  ) => readonly KernelTopologyLineage[];
  readonly seeds?: readonly TopologyLineageSeed[];
  readonly expectedRoles?: {
    readonly feature: string;
    readonly counts: Readonly<Partial<Record<TopologyRole, number>>>;
  };
  readonly requireSeedCoverage?:
    | true
    | readonly ("face" | "edge" | "vertex")[];
  readonly forcePartial?: boolean;
}

class OcctShape implements KernelShape {
  readonly kernel = "occt";
  readonly [OCCT_SHAPE]: ShapeHandle;
  readonly serial: number;
  readonly lineage: readonly KernelTopologyLineage[];
  readonly history: TopologyHistory;
  readonly annotation: TopologyAnnotation | undefined;
  readonly volumeOverride: number | undefined;
  readonly topologyHandles = new Map<KernelTopologyKey, RetainedTopologyHandle>();
  topologySnapshot: KernelTopologySnapshot | undefined;
  disposed = false;

  constructor(
    handle: ShapeHandle,
    serial: number,
    lineage: readonly KernelTopologyLineage[],
    history: TopologyHistory,
    annotation?: TopologyAnnotation,
    volumeOverride?: number,
  ) {
    this[OCCT_SHAPE] = handle;
    this.serial = serial;
    this.lineage = lineage;
    this.history = history;
    this.annotation = annotation;
    this.volumeOverride = volumeOverride;
  }
}

interface ProfileCurveHandle {
  readonly curve: ResolvedCurve;
  readonly handle: ShapeHandle;
}

function occtVector(value: Vec3): OcctVec3 {
  return { x: value[0], y: value[1], z: value[2] };
}

function vectorFromOcct(value: OcctVec3): Vec3 {
  return [value.x, value.y, value.z];
}

function vectorDistance(first: Vec3, second: Vec3): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function directedUnitVectorsMatch(
  first: Vec3,
  second: Vec3,
  sineTolerance: number,
): boolean {
  const firstLength = Math.hypot(...first);
  const secondLength = Math.hypot(...second);
  if (!(firstLength > 0) || !(secondLength > 0)) return false;
  const dot =
    (first[0] * second[0] +
      first[1] * second[1] +
      first[2] * second[2]) /
    (firstLength * secondLength);
  const cross: Vec3 = [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
  const sine = Math.hypot(...cross) / (firstLength * secondLength);
  return Number.isFinite(sine) && dot > 0 && sine <= sineTolerance;
}

function topologyKey(
  namespace: number,
  serial: number,
  topology: "face" | "edge" | "vertex",
  index: number,
): KernelTopologyKey {
  return `${namespace}:${serial}:${topology}:${index}` as KernelTopologyKey;
}

function artifactFloat64(value: number): string {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, Object.is(value, -0) ? 0 : value, false);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function occtArtifactCandidateCompatibilityFingerprint(
  runtime: string | undefined,
  modelingTolerance: number,
  tessellation: MeshOptions,
  maxExactBooleanHistoryRecords: number,
  maxExactEdgeTreatmentHistoryRecords: number,
  maxExactSolidOffsetHistoryRecords: number,
  capabilities: KernelCapabilities,
  artifactAbi: "0.7" | "0.8" | undefined,
): string | undefined {
  if (
    runtime === undefined ||
    !Number.isFinite(modelingTolerance) ||
    !(modelingTolerance > 0)
  ) {
    return undefined;
  }
  try {
    const boundedNativeIo = artifactAbi !== undefined;
    const linearDeflection = tessellation.linearDeflection;
    const angularDeflection = tessellation.angularDeflection;
    const relative = tessellation.relative;
    if (
      (linearDeflection !== undefined &&
        (typeof linearDeflection !== "number" ||
          !Number.isFinite(linearDeflection) ||
          !(linearDeflection > 0))) ||
      (angularDeflection !== undefined &&
        (typeof angularDeflection !== "number" ||
          !Number.isFinite(angularDeflection) ||
          !(angularDeflection > 0))) ||
      (relative !== undefined && typeof relative !== "boolean")
    ) {
      return undefined;
    }
    return [
      "invariantcad-occt-shape-candidate@2",
      "occt-wasm@3.7.0",
      `runtime=${runtime}`,
      `modelingTolerance=f64:${artifactFloat64(modelingTolerance)}`,
      `linearDeflection=${
        linearDeflection === undefined
          ? "default"
          : `f64:${artifactFloat64(linearDeflection)}`
      }`,
      `angularDeflection=${
        angularDeflection === undefined
          ? "default"
          : `f64:${artifactFloat64(angularDeflection)}`
      }`,
      `relative=${relative === undefined ? "default" : String(relative)}`,
      `maxExactBooleanHistoryRecords=${maxExactBooleanHistoryRecords}`,
      `maxExactEdgeTreatmentHistoryRecords=${maxExactEdgeTreatmentHistoryRecords}`,
      `maxExactSolidOffsetHistoryRecords=${maxExactSolidOffsetHistoryRecords}`,
      `features=${capabilities.features.join(",")}`,
      boundedNativeIo
        ? "nativeArchive=occt-brep-binary-v4;triangulation=false;normals=false"
        : "nativeArchive=occt-brep-binary",
      "topologySidecar=bounded-binary-artifact-local-index-v2",
      "nativeStructure=ordered-type-orientation-v1",
      ...(artifactAbi === "0.8"
        ? [
            `nativeRequestLimitBytes=${OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES}`,
            "nativeRequestAccounting=scoped-cumulative-reviewed-entrypoints-v1",
          ]
        : []),
      artifactAbi === "0.8"
        ? "nativeMaterialization=facade-capped-output-bounded-input-cumulative-native-requests-v2"
        : boundedNativeIo
          ? "nativeMaterialization=facade-capped-output-bounded-input-snapshot-v1"
          : "nativeMaterialization=unbounded-candidate-only",
    ].join(";");
  } catch {
    return undefined;
  }
}

function uniqueLineage(
  values: readonly KernelTopologyLineage[],
): readonly KernelTopologyLineage[] {
  const unique = new Map<string, KernelTopologyLineage>();
  for (const value of values) {
    const source = value.source;
    const key = canonicalStringifyProtocol({
      feature: value.feature,
      relation: value.relation,
      role: value.role ?? null,
      source:
        source === undefined
          ? null
          : {
              kind: source.kind,
              sketch: source.sketch,
              entity: source.entity,
            },
    });
    unique.set(key, value);
  }
  return Object.freeze([...unique.values()]);
}

function semanticLineage(
  context: KernelFeatureContext | undefined,
  role: TopologyRole,
  source?: KernelTopologySource,
): readonly KernelTopologyLineage[] {
  if (context?.feature === undefined) return [];
  return [
    {
      feature: context.feature,
      relation: "created",
      role,
      ...(source === undefined ? {} : { source }),
    },
  ];
}

function arrayBufferCopy(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function pointOnPlane(point: Vec2, plane: NumericPlane): OcctVec3 {
  const { u, v } = numericPlaneBasis(plane);
  return {
    x: plane.origin[0] + point[0] * u[0] + point[1] * v[0],
    y: plane.origin[1] + point[0] * u[1] + point[1] * v[1],
    z: plane.origin[2] + point[0] * u[2] + point[1] * v[2],
  };
}

// Polyline and composite sweeps use BRepOffsetAPI_MakePipeShell. Its stock
// Tol3d/BoundTol defaults are 1e-4; keep that conservative construction floor
// even when ABI 0.3 supplies stricter controls explicitly.
const OCCT_PIPE_SHELL_LINEAR_TOLERANCE = 1e-4;
const OCCT_PIPE_SHELL_TANGENT_SINE_TOLERANCE = 1e-9;
const OCCT_PIPE_SHELL_VOLUME_RELATIVE_TOLERANCE = 1e-7;
// The exact circular-revolution transfer cannot reliably distinguish all
// three authored arc points below this scale-independent conditioning floor.
const OCCT_CIRCULAR_ARC_MIN_POINT_SINE = 3e-8;

function binary64Ulp(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0 || magnitude < 2 ** -1022) return Number.MIN_VALUE;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 52);
}

function circularArcMinimumPointSine(
  path: ResolvedCircularArcDefinition,
): number {
  const through: Vec3 = [
    path.through[0] - path.start[0],
    path.through[1] - path.start[1],
    path.through[2] - path.start[2],
  ];
  const end: Vec3 = [
    path.end[0] - path.start[0],
    path.end[1] - path.start[1],
    path.end[2] - path.start[2],
  ];
  const planeNormal: Vec3 = [
    through[1] * end[2] - through[2] * end[1],
    through[2] * end[0] - through[0] * end[2],
    through[0] * end[1] - through[1] * end[0],
  ];
  const startThrough = Math.hypot(...through);
  const startEnd = Math.hypot(...end);
  const throughEnd = Math.hypot(
    path.end[0] - path.through[0],
    path.end[1] - path.through[1],
    path.end[2] - path.through[2],
  );
  const doubleArea = Math.hypot(...planeNormal);
  return Math.min(
    doubleArea / (startThrough * startEnd),
    doubleArea / (startThrough * throughEnd),
    doubleArea / (startEnd * throughEnd),
  );
}

function resolvedProfileCurveLength(curve: ResolvedCurve): number {
  switch (curve.kind) {
    case "line":
      return Math.hypot(
        curve.end[0] - curve.start[0],
        curve.end[1] - curve.start[1],
      );
    case "arc":
      return curve.radius * Math.abs(resolvedArcSweep(curve));
    case "circle":
      return curve.radius * Math.PI * 2;
  }
}

function resolvedProfileBoundaryGeometry(
  profile: ResolvedProfile,
  centroid: Vec2,
): {
  readonly perimeter: number;
  readonly maxBoundaryRadius: number;
} | undefined {
  let perimeter = 0;
  let maxBoundaryRadius = 0;
  for (const loop of [profile.outer, ...profile.holes]) {
    for (const [index, curve] of loop.curves.entries()) {
      const curveLength = resolvedProfileCurveLength(curve);
      perimeter += curveLength;
      if (curve.kind === "line") {
        maxBoundaryRadius = Math.max(
          maxBoundaryRadius,
          Math.hypot(
            curve.start[0] - centroid[0],
            curve.start[1] - centroid[1],
          ),
          Math.hypot(
            curve.end[0] - centroid[0],
            curve.end[1] - centroid[1],
          ),
        );
      } else {
        maxBoundaryRadius = Math.max(
          maxBoundaryRadius,
          Math.hypot(
            curve.center[0] - centroid[0],
            curve.center[1] - centroid[1],
          ) + curve.radius,
        );
      }
      const next = loop.curves[(index + 1) % loop.curves.length];
      if (next !== undefined) {
        const end = curveEnd(curve);
        const start = curveStart(next);
        perimeter += Math.hypot(end[0] - start[0], end[1] - start[1]);
      }
    }
  }
  return Number.isFinite(perimeter) &&
    perimeter > 0 &&
    Number.isFinite(maxBoundaryRadius) &&
    maxBoundaryRadius >= 0
    ? { perimeter, maxBoundaryRadius }
    : undefined;
}

function arcPoint(curve: ResolvedArcCurve, angle: number): Vec2 {
  return [
    curve.center[0] + curve.radius * Math.cos(angle),
    curve.center[1] + curve.radius * Math.sin(angle),
  ];
}

function checkContext(context?: KernelFeatureContext): void {
  if (context?.signal?.aborted) {
    throw new DOMException("CAD kernel operation was aborted", "AbortError");
  }
}

function assertDraftVector(
  value: unknown,
  label: string,
  nonzero: boolean,
): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} must be a three-component vector`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "number" || !Number.isFinite(value[index])) {
      throw new TypeError(`${label}[${index}] must be finite`);
    }
  }
  if (nonzero && !(Math.hypot(value[0]!, value[1]!, value[2]!) > 0)) {
    throw new RangeError(`${label} must be nonzero`);
  }
}

function validateDraftOptions(options: ResolvedDraftOptions): void {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Draft options must be an object");
  }
  if (
    typeof options.angle !== "number" ||
    !Number.isFinite(options.angle) ||
    !(Math.abs(options.angle) > DRAFT_MIN_ANGLE_RADIANS) ||
    !(Math.abs(options.angle) < Math.PI / 2)
  ) {
    throw new RangeError(
      "Draft angle must satisfy 1e-4 < abs(angle) < pi / 2 radians",
    );
  }
  assertDraftVector(options.pullDirection, "Draft pull direction", true);
  if (typeof options.neutralPlane !== "object" || options.neutralPlane === null) {
    throw new TypeError("Draft neutral plane must be an object");
  }
  assertDraftVector(
    options.neutralPlane.origin,
    "Draft neutral-plane origin",
    false,
  );
  assertDraftVector(
    options.neutralPlane.normal,
    "Draft neutral-plane normal",
    true,
  );
}

export type OcctWasmSource = string | URL | ArrayBuffer | Uint8Array;

export type OcctProfileMassPropertyFailureReason =
  NativeProfileMassPropertyCertificationFailureReason;
export type OcctProfileMassPropertyDiagnostics =
  NativeProfileMassPropertyDiagnostics;

function immutableProfileMassPropertyDiagnostics(
  diagnostics: OcctProfileMassPropertyDiagnostics | undefined,
): OcctProfileMassPropertyDiagnostics | undefined {
  if (diagnostics === undefined) return undefined;
  const {
    analyticCentroidOffset,
    nativeCentroid,
    nativeCentroidOffset,
    centroidError,
    centroidAllowance,
    boundaryCoordinateRoundoffBound,
    coordinateRoundoffBound,
    ...scalars
  } = diagnostics;
  const immutableVector = (value: Vec3): Vec3 =>
    Object.freeze([...value]) as unknown as Vec3;
  return Object.freeze({
    ...scalars,
    ...(analyticCentroidOffset === undefined
      ? {}
      : { analyticCentroidOffset: immutableVector(analyticCentroidOffset) }),
    ...(nativeCentroid === undefined
      ? {}
      : { nativeCentroid: immutableVector(nativeCentroid) }),
    ...(nativeCentroidOffset === undefined
      ? {}
      : { nativeCentroidOffset: immutableVector(nativeCentroidOffset) }),
    ...(centroidError === undefined
      ? {}
      : { centroidError: immutableVector(centroidError) }),
    ...(centroidAllowance === undefined
      ? {}
      : { centroidAllowance: immutableVector(centroidAllowance) }),
    boundaryCoordinateRoundoffBound: immutableVector(
      boundaryCoordinateRoundoffBound,
    ),
    coordinateRoundoffBound: immutableVector(coordinateRoundoffBound),
  });
}

/**
 * Raised when OCCT's independent planar-face integration disagrees with the
 * analytic profile moments that define sweep semantics.
 */
export class OcctProfileMassPropertyError extends RangeError {
  readonly reason: OcctProfileMassPropertyFailureReason;
  readonly diagnostics: OcctProfileMassPropertyDiagnostics | undefined;

  constructor(
    reason: OcctProfileMassPropertyFailureReason,
    message: string,
    diagnostics?: OcctProfileMassPropertyDiagnostics,
  ) {
    super(`OCCT sweep profile mass-property certification failed: ${message}`);
    this.name = "OcctProfileMassPropertyError";
    this.reason = reason;
    this.diagnostics = immutableProfileMassPropertyDiagnostics(diagnostics);
    Object.freeze(this);
  }
}

/** Options accepted by stock or InvariantCAD-owned Emscripten module glue. */
export interface OcctModuleOptions {
  readonly wasmBinary?: ArrayBuffer;
  readonly locateFile?: (path: string) => string;
  readonly print?: (message: string) => void;
  readonly printErr?: (message: string) => void;
}

/** A matched Emscripten JS-glue factory for the supplied OCCT WASM binary. */
export type OcctModuleFactory = (
  options?: OcctModuleOptions,
) => Promise<unknown>;

export interface OcctKernelOptions {
  readonly wasm?: OcctWasmSource;
  /**
   * Matched JS glue for a custom OCCT binary. When omitted, stock occt-wasm
   * glue is used and a custom `wasm` source is passed to that stock factory.
   */
  readonly moduleFactory?: OcctModuleFactory;
  readonly tessellation?: MeshOptions;
  readonly modelingTolerance?: number;
  /**
   * Maximum exact Boolean history records materialized across Wasm and
   * JavaScript. Raise this explicit resource budget for exceptionally large
   * models; the facade ABI ceiling is 2,147,483,647.
   * @default 1_000_000
   */
  readonly maxExactBooleanHistoryRecords?: number;
  /**
   * Maximum exact fillet/chamfer history records materialized across Wasm and
   * JavaScript. Raise this explicit resource budget for exceptionally large
   * models; the facade ABI ceiling is 2,147,483,647.
   * @default 1_000_000
   */
  readonly maxExactEdgeTreatmentHistoryRecords?: number;
  /**
   * Maximum exact shell/offset history records materialized across Wasm and
   * JavaScript. Raise this explicit resource budget for exceptionally large
   * models; the facade ABI ceiling is 2,147,483,647.
   * @default 1_000_000
   */
  readonly maxExactSolidOffsetHistoryRecords?: number;
  readonly onOutput?: (message: string) => void;
  readonly onError?: (message: string) => void;
}

class OcctKernel implements GeometryKernel {
  readonly id = "occt";
  readonly capabilities: KernelCapabilities;
  declare readonly draft?: NonNullable<GeometryKernel["draft"]>;
  private static readonly BASE_CAPABILITIES: KernelCapabilities = {
    protocolVersion: 1,
    representation: "brep",
    exact: true,
    primitives: ["box", "cylinder", "sphere"],
    features: [
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
    ],
    nativeImports: ["step", "brep", "brep-binary"],
    nativeExports: ["step", "brep", "brep-binary"],
    topology: {
      kinds: ["face", "edge", "vertex"],
      provenance: "feature",
      semanticRoles: true,
      sketchSources: true,
      geometry: true,
      adjacency: true,
    },
  };
  private readonly raw: RawOcctKernel;
  private readonly facade: OcctFacadeProbe | undefined;
  private readonly tessellation: MeshOptions;
  private readonly modelingTolerance: number;
  private readonly maxExactBooleanHistoryRecords: number;
  private readonly maxExactEdgeTreatmentHistoryRecords: number;
  private readonly maxExactSolidOffsetHistoryRecords: number;
  private readonly artifactCandidateCompatibilityFingerprint:
    | string
    | undefined;
  private readonly ownedShapes = new WeakSet<OcctShape>();
  private readonly liveShapes = new Set<OcctShape>();
  private readonly topologyNamespace = nextTopologyNamespace++;
  private nextShapeSerial = 1;
  private disposed = false;

  constructor(
    raw: RawOcctKernel,
    facade: OcctFacadeProbe | undefined,
    options: OcctKernelOptions = {},
    maxExactBooleanHistoryRecords = exactBooleanHistoryRecordLimit(
      options.maxExactBooleanHistoryRecords,
    ),
    maxExactEdgeTreatmentHistoryRecords = exactEdgeTreatmentHistoryRecordLimit(
      options.maxExactEdgeTreatmentHistoryRecords,
    ),
    maxExactSolidOffsetHistoryRecords = exactSolidOffsetHistoryRecordLimit(
      options.maxExactSolidOffsetHistoryRecords,
    ),
  ) {
    this.raw = raw;
    this.facade = facade;
    this.tessellation = Object.freeze({ ...(options.tessellation ?? {}) });
    this.modelingTolerance = options.modelingTolerance ?? 1e-7;
    this.maxExactBooleanHistoryRecords = maxExactBooleanHistoryRecords;
    this.maxExactEdgeTreatmentHistoryRecords =
      maxExactEdgeTreatmentHistoryRecords;
    this.maxExactSolidOffsetHistoryRecords = maxExactSolidOffsetHistoryRecords;
    const topologySignatureRuntime =
      facade?.version ??
      (options.moduleFactory === undefined && options.wasm === undefined
        ? "stock"
        : undefined);
    const legacyTopologyDescriptorVersion =
      facade?.edgeTreatment === undefined ? 4 : 5;
    const topologySignatureFingerprint =
      topologySignatureRuntime === undefined ||
      !Number.isFinite(this.modelingTolerance) ||
      !(this.modelingTolerance > 0)
        ? undefined
        : [
            "invariantcad-topology-descriptor@6",
            "occt-wasm@3.7.0",
            `runtime=${topologySignatureRuntime}`,
            `modelingTolerance=${this.modelingTolerance}`,
          ].join(";");
    const legacyTopologySignatureFingerprint =
      topologySignatureRuntime === undefined ||
      !Number.isFinite(this.modelingTolerance) ||
      !(this.modelingTolerance > 0)
        ? undefined
        : [
            `invariantcad-topology-descriptor@${legacyTopologyDescriptorVersion}`,
            "occt-wasm@3.7.0",
            `runtime=${topologySignatureRuntime}`,
            `modelingTolerance=${this.modelingTolerance}`,
          ].join(";");
    this.capabilities = {
      ...OcctKernel.BASE_CAPABILITIES,
      topology: {
        ...OcctKernel.BASE_CAPABILITIES.topology!,
        ...(topologySignatureFingerprint === undefined
          ? {}
          : {
              signatures: {
                protocolVersion: 2 as const,
                fingerprint: topologySignatureFingerprint,
              },
              signatureProfiles: [
                {
                  protocolVersion: 1 as const,
                  fingerprint: legacyTopologySignatureFingerprint!,
                },
              ],
            }),
      },
      ...(facade?.draft === undefined
        ? {}
        : {
            features: [...OcctKernel.BASE_CAPABILITIES.features, "draft"],
            exactIndexedTopologyEvolution: {
              protocolVersion: 1 as const,
              features:
                facade.solidOffset !== undefined
                  ? ([
                      "draft",
                      "boolean",
                      "fillet",
                      "chamfer",
                      "shell",
                      "offset",
                    ] as const)
                  : facade.edgeTreatment !== undefined
                  ? (["draft", "boolean", "fillet", "chamfer"] as const)
                  : facade.boolean === undefined
                  ? (["draft"] as const)
                  : (["draft", "boolean"] as const),
            },
          }),
      ...(facade?.pipeShell === undefined
        ? {}
        : {
            compositeSweep: {
              protocolVersion: 1 as const,
              refinements: [
                "major-multiple-arcs" as const,
                "major-eccentric-profile" as const,
              ],
            },
          }),
    };
    this.artifactCandidateCompatibilityFingerprint =
      occtArtifactCandidateCompatibilityFingerprint(
        topologySignatureRuntime,
        this.modelingTolerance,
        this.tessellation,
        this.maxExactBooleanHistoryRecords,
        this.maxExactEdgeTreatmentHistoryRecords,
        this.maxExactSolidOffsetHistoryRecords,
        this.capabilities,
        facade?.artifact === undefined ? undefined : facade.abi,
      );
    if (facade?.draft !== undefined) {
      this.draft = (shape, faces, resolved, context) =>
        this.draftWithExactEvolution(
          facade.draft,
          shape,
          faces,
          resolved,
          context,
        );
    }
  }

  get [OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS]():
    | OcctShapeArtifactCandidateHost
    | undefined {
    const compatibilityFingerprint =
      this.artifactCandidateCompatibilityFingerprint;
    return compatibilityFingerprint === undefined
      ? undefined
      : Object.freeze({
          compatibilityFingerprint,
          capture: (shape: KernelShape) =>
            this.captureShapeArtifactCandidate(shape),
          encodeNative: (shape: KernelShape, maxBytes: number) =>
            this.encodeShapeArtifactCandidateNative(shape, maxBytes),
          restore: (state: OcctShapeArtifactCapturedState) =>
            this.restoreShapeArtifactCandidate(state),
        });
  }

  private assertKernelLive(): void {
    if (this.disposed) throw new Error("This OCCT kernel has been disposed");
  }

  private shape(shape: KernelShape): OcctShape {
    this.assertKernelLive();
    if (
      !(shape instanceof OcctShape) ||
      !this.liveShapes.has(shape) ||
      shape.disposed
    ) {
      throw new TypeError("Expected a live OCCT kernel shape");
    }
    return shape;
  }

  private captureShapeArtifactCandidate(
    shape: KernelShape,
  ): OcctShapeArtifactCapturedSidecarState {
    const owned = this.shape(shape);
    const topology = this.topology(owned);
    const nativeStructure = this.captureShapeArtifactNativeStructure(
      owned,
      topology,
    );
    return Object.freeze({
      lineage: owned.lineage,
      history: owned.history,
      topology,
      nativeStructure,
      ...(owned.volumeOverride === undefined
        ? {}
        : { volumeOverride: owned.volumeOverride }),
    });
  }

  private encodeShapeArtifactCandidateNative(
    shape: KernelShape,
    maxBytes: number,
  ): Uint8Array {
    const owned = this.shape(shape);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("OCCT candidate native byte limit is invalid");
    }
    if (this.facade?.artifact === undefined) {
      const brep = this.raw.toBREPBinary(owned[OCCT_SHAPE]).slice();
      if (brep.byteLength > maxBytes) {
        throw new RangeError("OCCT candidate artifact exceeds maxArtifactBytes");
      }
      return brep;
    }
    try {
      return writeBoundedOcctArtifactBrep({
        module: this.facade.artifact,
        kernel: this.raw.getRawKernel(),
        shapeId: owned[OCCT_SHAPE] as number,
        maxOutputBytes: Math.min(maxBytes, TOPOLOGY_HASH_UPPER_BOUND),
        ...(this.facade?.abi === "0.8"
          ? {
              maxNativeRequestedBytes:
                OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
            }
          : {}),
      });
    } catch (error) {
      if (
        error instanceof OcctArtifactWriteError &&
        error.diagnostics.code === "OUTPUT_LIMIT_EXCEEDED"
      ) {
        throw new RangeError("OCCT candidate artifact exceeds maxArtifactBytes");
      }
      throw error;
    }
  }

  private restoreShapeArtifactCandidate(
    state: OcctShapeArtifactCapturedState,
  ): OcctShape {
    this.assertKernelLive();
    let handle: ShapeHandle | undefined;
    let provisional: OcctShape | undefined;
    try {
      if (this.facade?.artifact === undefined) {
        handle = this.raw.fromBREPBinary(state.brep);
      } else {
        if (state.brep.byteLength > TOPOLOGY_HASH_UPPER_BOUND) {
          throw new RangeError("OCCT candidate BREP exceeds the native ABI range");
        }
        handle = readBoundedOcctArtifactBrep({
          module: this.facade.artifact,
          kernel: this.raw.getRawKernel(),
          input: state.brep,
          maxInputBytes: state.brep.byteLength,
          maxTopologyItems: MAX_ARTIFACT_NATIVE_TOPOLOGY_ITEMS,
          ...(this.facade?.abi === "0.8"
            ? {
                maxNativeRequestedBytes:
                  OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
              }
            : {}),
        }) as ShapeHandle;
      }
      provisional = this.own(handle, undefined, {
        inherited: state.lineage,
        history: state.history,
        ...(state.volumeOverride === undefined
          ? {}
          : { volumeOverride: state.volumeOverride }),
      });
      handle = undefined;
      const status = this.status(provisional);
      if (!status.ok) {
        throw new TypeError(
          `OCCT candidate BREP did not restore a valid shape: ${status.code}`,
        );
      }
      const freshTopology = this.topology(provisional);
      const freshNativeStructure = this.captureShapeArtifactNativeStructure(
        provisional,
        freshTopology,
      );
      provisional.topologySnapshot = remapOcctShapeArtifactTopology(
        state.topology,
        freshTopology,
        state.nativeStructure,
        freshNativeStructure,
      );
      return provisional;
    } catch (error) {
      try {
        if (provisional !== undefined) {
          this.disposeShape(provisional);
        } else if (handle !== undefined) {
          this.raw.release(handle);
        }
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "OCCT candidate restore and cleanup both failed",
        );
      }
      throw error;
    }
  }

  private captureShapeArtifactNativeStructure(
    shape: OcctShape,
    topology: KernelTopologySnapshot,
  ): OcctShapeArtifactNativeStructure {
    const root = shape[OCCT_SHAPE];
    const subshapeOrientations = (
      kind: "solid" | "shell" | "wire",
    ): OcctShapeArtifactNativeStructure[
      | "solidOrientations"
      | "shellOrientations"
      | "wireOrientations"
    ] => {
      const handles = this.raw.getSubShapes(root, kind);
      try {
        return Object.freeze(
          handles.map((handle) => this.raw.shapeOrientation(handle)),
        );
      } finally {
        this.releaseHandles(handles);
      }
    };
    const retainedOrientations = (
      descriptors: readonly TopologyDescriptor[],
      expected: "face" | "edge" | "vertex",
    ) =>
      Object.freeze(
        descriptors.map((descriptor) => {
          const retained = shape.topologyHandles.get(descriptor.key);
          if (retained?.topology !== expected) {
            throw new Error(
              "OCCT topology snapshot lost a retained subshape handle",
            );
          }
          return this.raw.shapeOrientation(retained.handle);
        }),
      );
    return Object.freeze({
      rootType: this.raw.getShapeType(root),
      rootOrientation: this.raw.shapeOrientation(root),
      solidOrientations: subshapeOrientations("solid"),
      shellOrientations: subshapeOrientations("shell"),
      wireOrientations: subshapeOrientations("wire"),
      faceOrientations: retainedOrientations(topology.faces, "face"),
      edgeOrientations: retainedOrientations(topology.edges, "edge"),
      vertexOrientations: retainedOrientations(topology.vertices, "vertex"),
    });
  }

  private own(
    handle: ShapeHandle,
    context?: KernelFeatureContext,
    options: {
      readonly inherited?: readonly KernelTopologyLineage[];
      readonly relation?: "created" | "modified";
      readonly history?: TopologyHistory;
      readonly annotation?: TopologyAnnotation;
      readonly volumeOverride?: number;
    } = {},
  ): OcctShape {
    this.assertKernelLive();
    const lineage = uniqueLineage([
      ...(options.inherited ?? []),
      ...(context?.feature === undefined
        ? []
        : [
            {
              feature: context.feature,
              relation: options.relation ?? "created",
            } as const,
          ]),
    ]);
    const shape = new OcctShape(
      handle,
      this.nextShapeSerial,
      lineage,
      options.history ?? "complete",
      options.annotation,
      options.volumeOverride,
    );
    this.nextShapeSerial += 1;
    this.ownedShapes.add(shape);
    this.liveShapes.add(shape);
    return shape;
  }

  private releaseHandles(handles: readonly ShapeHandle[]): void {
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      this.raw.release(handles[index]!);
    }
  }

  private isPureSingleSolidShape(
    shape: ShapeHandle,
    solid: ShapeHandle,
  ): boolean {
    const type = this.raw.getShapeType(shape);
    if (type === "solid") return this.raw.isSame(shape, solid);
    if (type !== "compound" && type !== "compsolid") return false;
    const children = this.raw.iterShapes(shape);
    try {
      return (
        children.length === 1 &&
        this.isPureSingleSolidShape(children[0]!, solid)
      );
    } finally {
      this.releaseHandles(children);
    }
  }

  private normalizeImportedSolidOrientation(handle: ShapeHandle): ShapeHandle {
    let reverse = false;
    try {
      reverse =
        this.raw.getShapeType(handle) === "solid" &&
        this.raw.getVolume(handle) < 0;
    } catch (error) {
      this.raw.release(handle);
      throw error;
    }
    if (!reverse) return handle;
    try {
      const reversed = this.raw.reverseShape(handle);
      this.raw.release(handle);
      return reversed;
    } catch (error) {
      this.raw.release(handle);
      throw error;
    }
  }

  private curveHandle(
    curve: ResolvedCurve,
    plane: NumericPlane,
    allocated: ShapeHandle[],
  ): ShapeHandle {
    let handle: ShapeHandle;
    switch (curve.kind) {
      case "line":
        handle = this.raw.makeLineEdge(
          pointOnPlane(curve.start, plane),
          pointOnPlane(curve.end, plane),
        );
        break;
      case "arc": {
        const sweep = resolvedArcSweep(curve);
        const middle = curve.startAngle + sweep / 2;
        handle = this.raw.makeArcEdge(
          pointOnPlane(arcPoint(curve, curve.startAngle), plane),
          pointOnPlane(arcPoint(curve, middle), plane),
          pointOnPlane(arcPoint(curve, curve.endAngle), plane),
        );
        break;
      }
      case "circle": {
        const basis = numericPlaneBasis(plane);
        handle = this.raw.makeCircleEdge(
          pointOnPlane(curve.center, plane),
          occtVector(basis.n),
          curve.radius,
        );
        if (curve.reversed) {
          allocated.push(handle);
          handle = this.raw.reverseShape(handle);
        }
        break;
      }
    }
    allocated.push(handle);
    return handle;
  }

  private loopWire(
    loop: ResolvedLoop,
    plane: NumericPlane,
    allocated: ShapeHandle[],
    curveHandles: ProfileCurveHandle[],
  ): ShapeHandle {
    const edges = loop.curves.map((curve) => {
      const handle = this.curveHandle(curve, plane, allocated);
      curveHandles.push({ curve, handle });
      return handle;
    });
    const wire = this.raw.makeWire(edges);
    allocated.push(wire);
    return wire;
  }

  private profileFace(
    profile: ResolvedProfile,
  ): {
    readonly face: ShapeHandle;
    readonly outerWire: ShapeHandle;
    readonly allocated: readonly ShapeHandle[];
    readonly curves: readonly ProfileCurveHandle[];
  } {
    const allocated: ShapeHandle[] = [];
    const curves: ProfileCurveHandle[] = [];
    try {
      const outerWire = this.loopWire(
        profile.outer,
        profile.plane,
        allocated,
        curves,
      );
      let face = this.raw.makeFace(outerWire);
      allocated.push(face);
      if (profile.holes.length > 0) {
        const holes = profile.holes.map((loop) =>
          this.loopWire(loop, profile.plane, allocated, curves),
        );
        face = this.raw.addHolesInFace(face, holes);
        allocated.push(face);
      }
      return { face, outerWire, allocated, curves };
    } catch (error) {
      this.releaseHandles(allocated);
      throw error;
    }
  }

  private boxTopologyAnnotation(
    context: KernelFeatureContext | undefined,
    min: Vec3,
    max: Vec3,
  ): TopologyAnnotation {
    return {
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: Object.fromEntries(
                [
                  "box.face.x-min",
                  "box.face.x-max",
                  "box.face.y-min",
                  "box.face.y-max",
                  "box.face.z-min",
                  "box.face.z-max",
                  "box.edge.x-min-y-min",
                  "box.edge.x-min-y-max",
                  "box.edge.x-max-y-min",
                  "box.edge.x-max-y-max",
                  "box.edge.x-min-z-min",
                  "box.edge.x-min-z-max",
                  "box.edge.x-max-z-min",
                  "box.edge.x-max-z-max",
                  "box.edge.y-min-z-min",
                  "box.edge.y-min-z-max",
                  "box.edge.y-max-z-min",
                  "box.edge.y-max-z-max",
                ].map((role) => [role, 1]),
              ) as Partial<Record<TopologyRole, number>>,
            },
          }),
      classify: (descriptor) => {
        if (descriptor.topology === "face") {
          const normal = descriptor.surface.normal;
          if (normal === undefined) return [];
          const absolute = normal.map(Math.abs);
          const axis = absolute.indexOf(Math.max(...absolute));
          const sign = normal[axis]! < 0 ? "min" : "max";
          const role = `box.face.${["x", "y", "z"][axis]}-${sign}` as TopologyRole;
          return semanticLineage(context, role);
        }
        if (descriptor.topology !== "edge") return [];
        const direction = descriptor.curve.direction;
        if (direction === undefined) return [];
        const absolute = direction.map(Math.abs);
        const parallelAxis = absolute.indexOf(Math.max(...absolute));
        const axisNames = ["x", "y", "z"] as const;
        const boundary = (axis: number): string =>
          `${axisNames[axis]}-${
            Math.abs(descriptor.center[axis]! - min[axis]!) <=
            Math.abs(descriptor.center[axis]! - max[axis]!)
              ? "min"
              : "max"
          }`;
        const boundaryAxes = [0, 1, 2].filter(
          (axis) => axis !== parallelAxis,
        );
        const role = `box.edge.${boundary(boundaryAxes[0]!)}-${boundary(
          boundaryAxes[1]!,
        )}` as TopologyRole;
        return semanticLineage(context, role);
      },
    };
  }

  private cylinderTopologyAnnotation(
    context: KernelFeatureContext | undefined,
    zMin: number,
    zMax: number,
    hasStart: boolean,
    hasEnd: boolean,
  ): TopologyAnnotation {
    return {
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: {
                "cylinder.face.side": 1,
                ...(hasStart
                  ? {
                      "cylinder.face.start-cap": 1,
                      "cylinder.edge.start-rim": 1,
                    }
                  : {}),
                ...(hasEnd
                  ? {
                      "cylinder.face.end-cap": 1,
                      "cylinder.edge.end-rim": 1,
                    }
                  : {}),
              },
            },
          }),
      classify: (descriptor) => {
        if (descriptor.topology === "face") {
          if (descriptor.surface.kind === "plane") {
            const role =
              Math.abs(descriptor.center[2] - zMin) <=
              Math.abs(descriptor.center[2] - zMax)
              ? "cylinder.face.start-cap"
              : "cylinder.face.end-cap";
            return semanticLineage(context, role);
          }
          return descriptor.surface.kind === "cylinder" ||
            descriptor.surface.kind === "cone"
            ? semanticLineage(context, "cylinder.face.side")
            : [];
        }
        if (descriptor.topology !== "edge") return [];
        if (descriptor.curve.kind === "circle") {
          const distanceToBottom = Math.abs(descriptor.center[2] - zMin);
          const distanceToTop = Math.abs(descriptor.center[2] - zMax);
          if (descriptor.length <= this.modelingTolerance) return [];
          return semanticLineage(
            context,
            distanceToBottom <= distanceToTop
              ? "cylinder.edge.start-rim"
              : "cylinder.edge.end-rim",
          );
        }
        return [];
      },
    };
  }

  private sphereTopologyAnnotation(
    context?: KernelFeatureContext,
  ): TopologyAnnotation {
    return {
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: { "sphere.face.surface": 1 },
            },
          }),
      classify: (descriptor) =>
        descriptor.topology === "face" && descriptor.surface.kind === "sphere"
          ? semanticLineage(context, "sphere.face.surface")
          : [],
    };
  }

  private extrudeTopologyAnnotation(
    profile: ResolvedProfile,
    curves: readonly ProfileCurveHandle[],
    options: { readonly distance: number; readonly symmetric: boolean },
    context?: KernelFeatureContext,
  ): TopologyAnnotation {
    const basis = numericPlaneBasis(profile.plane);
    const vector: Vec3 = basis.n.map(
      (value) => value * options.distance,
    ) as unknown as Vec3;
    const startOffset: Vec3 = basis.n.map((value) =>
      options.symmetric ? value * -options.distance * 0.5 : 0,
    ) as unknown as Vec3;
    const endOffset: Vec3 = startOffset.map(
      (value, index) => value + vector[index]!,
    ) as unknown as Vec3;
    const temporary: ShapeHandle[] = [];
    const translated = (handle: ShapeHandle, offset: Vec3): ShapeHandle => {
      const copy =
        Math.hypot(...offset) <= Number.EPSILON
          ? this.raw.copy(handle)
          : this.raw.translate(handle, offset[0], offset[1], offset[2]);
      temporary.push(copy);
      return copy;
    };
    const sourceOf = (
      curve: ResolvedCurve,
    ): KernelTopologySource | undefined =>
      curve.source === undefined
        ? undefined
        : {
            kind: "sketch-entity",
            sketch: curve.source.sketch,
            entity: curve.source.entity,
          };
    const seeds: TopologyLineageSeed[] = [];
    try {
      for (const item of curves) {
        const source = sourceOf(item.curve);
        let side = this.raw.extrude(
          item.handle,
          vector[0],
          vector[1],
          vector[2],
        );
        temporary.push(side);
        if (Math.hypot(...startOffset) > Number.EPSILON) {
          const centered = this.raw.translate(
            side,
            startOffset[0],
            startOffset[1],
            startOffset[2],
          );
          temporary.push(centered);
          side = centered;
        }
        seeds.push(
          this.topologySeedFromHandle(
            side,
            "face",
            semanticLineage(context, "extrude.face.side", source),
          ),
        );

        seeds.push(
          this.topologySeedFromHandle(
            translated(item.handle, startOffset),
            "edge",
            semanticLineage(
              context,
              "extrude.edge.start-rim",
              source,
            ),
          ),
          this.topologySeedFromHandle(
            translated(item.handle, endOffset),
            "edge",
            semanticLineage(
              context,
              "extrude.edge.end-rim",
              source,
            ),
          ),
        );

        if (item.curve.kind !== "circle") {
          const localStart = pointOnPlane(curveStart(item.curve), profile.plane);
          const lateralStart: OcctVec3 = {
            x: localStart.x + startOffset[0],
            y: localStart.y + startOffset[1],
            z: localStart.z + startOffset[2],
          };
          const lateralEnd: OcctVec3 = {
            x: lateralStart.x + vector[0],
            y: lateralStart.y + vector[1],
            z: lateralStart.z + vector[2],
          };
          const lateral = this.raw.makeLineEdge(lateralStart, lateralEnd);
          temporary.push(lateral);
          seeds.push(
            this.topologySeedFromHandle(
              lateral,
              "edge",
              semanticLineage(context, "extrude.edge.lateral"),
            ),
          );
        }
      }
    } finally {
      this.releaseHandles(temporary);
    }

    return {
      seeds,
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: {
                "extrude.face.start-cap": 1,
                "extrude.face.end-cap": 1,
                "extrude.face.side": curves.length,
                "extrude.edge.start-rim": curves.length,
                "extrude.edge.end-rim": curves.length,
                "extrude.edge.lateral": curves.filter(
                  (item) => item.curve.kind !== "circle",
                ).length,
              },
            },
          }),
      classify: (descriptor) => {
        if (descriptor.topology !== "face") return [];
        const normal = descriptor.surface.normal;
        if (normal === undefined) return [];
        const normalMagnitude = Math.hypot(...normal);
        if (!(normalMagnitude > Number.EPSILON)) return [];
        const dot =
          (normal[0] * vector[0] +
            normal[1] * vector[1] +
            normal[2] * vector[2]) /
          (normalMagnitude * Math.hypot(...vector));
        if (Math.abs(dot) < 1 - 1e-8) return [];
        return semanticLineage(
          context,
          dot < 0 ? "extrude.face.start-cap" : "extrude.face.end-cap",
        );
      },
    };
  }

  private revolveTopologyAnnotation(
    profile: ResolvedProfile,
    curves: readonly ProfileCurveHandle[],
    profileFace: ShapeHandle,
    angle: number,
    context?: KernelFeatureContext,
  ): TopologyAnnotation {
    const basis = numericPlaneBasis(profile.plane);
    const axis = {
      point: occtVector(profile.plane.origin),
      direction: occtVector(basis.v),
    };
    const sourceOf = (
      curve: ResolvedCurve,
    ): KernelTopologySource | undefined =>
      curve.source === undefined
        ? undefined
        : {
            kind: "sketch-entity",
            sketch: curve.source.sketch,
            entity: curve.source.entity,
          };
    const temporary: ShapeHandle[] = [];
    const seeds: TopologyLineageSeed[] = [];
    let sweptFaces = 0;
    let forcePartial = false;
    const fullTurn = angle === Math.PI * 2;
    try {
      for (const item of curves) {
        checkContext(context);
        try {
          const swept = this.raw.revolve(item.handle, axis, angle);
          temporary.push(swept);
          const curveSeeds = this.topologyFaceSeedsFromShape(
            swept,
            semanticLineage(
              context,
              "revolve.face.swept",
              sourceOf(item.curve),
            ),
          );
          seeds.push(...curveSeeds);
          sweptFaces += curveSeeds.length;
        } catch {
          forcePartial = true;
        }
      }
      checkContext(context);
      if (!fullTurn) {
        checkContext(context);
        try {
          seeds.push(
            this.topologySeedFromHandle(
              profileFace,
              "face",
              semanticLineage(context, "revolve.face.start-cap"),
            ),
          );
        } catch {
          forcePartial = true;
        }
        checkContext(context);
        try {
          const endCap = this.raw.rotate(profileFace, axis, angle);
          temporary.push(endCap);
          seeds.push(
            ...this.topologyFaceSeedsFromShape(
              endCap,
              semanticLineage(context, "revolve.face.end-cap"),
            ),
          );
        } catch {
          forcePartial = true;
        }
      }
      checkContext(context);
    } finally {
      this.releaseHandles(temporary);
    }

    return {
      seeds,
      requireSeedCoverage: ["face"],
      ...(forcePartial ? { forcePartial: true } : {}),
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: {
                "revolve.face.swept": sweptFaces,
                ...(fullTurn
                  ? {}
                  : {
                      "revolve.face.start-cap": 1,
                      "revolve.face.end-cap": 1,
                    }),
              },
            },
          }),
    };
  }

  private loftTopologyAnnotation(
    profiles: readonly ResolvedProfile[],
    sectionCurves: readonly (readonly ProfileCurveHandle[])[],
    sectionFaces: readonly ShapeHandle[],
    loftShape: ShapeHandle,
    context?: KernelFeatureContext,
  ): TopologyAnnotation {
    const sourceOf = (
      curve: ResolvedCurve,
    ): KernelTopologySource | undefined =>
      curve.source === undefined
        ? undefined
        : {
            kind: "sketch-entity",
            sketch: curve.source.sketch,
            entity: curve.source.entity,
          };
    const seeds: TopologyLineageSeed[] = [];
    let forcePartial = false;
    const attempt = (build: () => void): void => {
      checkContext(context);
      try {
        build();
      } catch {
        checkContext(context);
        forcePartial = true;
      }
    };

    attempt(() => {
      seeds.push(
        this.topologySeedFromHandle(
          sectionFaces[0]!,
          "face",
          semanticLineage(context, "loft.face.start-cap"),
        ),
      );
    });
    attempt(() => {
      seeds.push(
        this.topologySeedFromHandle(
          sectionFaces.at(-1)!,
          "face",
          semanticLineage(context, "loft.face.end-cap"),
        ),
      );
    });

    for (const curves of sectionCurves) {
      for (const item of curves) {
        attempt(() => {
          seeds.push(
            this.topologySeedFromHandle(
              item.handle,
              "edge",
              semanticLineage(
                context,
                "loft.edge.section-rim",
                sourceOf(item.curve),
              ),
            ),
          );
        });
      }
    }

    const resultEdges: ShapeHandle[] = [];
    const resultEdgeEndpoints: {
      readonly handle: ShapeHandle;
      readonly first: Vec3;
      readonly second: Vec3;
    }[] = [];
    try {
      attempt(() => {
        resultEdges.push(...this.raw.getSubShapes(loftShape, "edge"));
        for (const edge of resultEdges) {
          checkContext(context);
          const vertices = this.raw.getSubShapes(edge, "vertex");
          try {
            if (vertices.length !== 2) continue;
            resultEdgeEndpoints.push({
              handle: edge,
              first: vectorFromOcct(this.raw.vertexPosition(vertices[0]!)),
              second: vectorFromOcct(this.raw.vertexPosition(vertices[1]!)),
            });
          } finally {
            this.releaseHandles(vertices);
          }
        }
      });
      for (
        let sectionIndex = 0;
        sectionIndex < profiles.length - 1;
        sectionIndex += 1
      ) {
        const firstProfile = profiles[sectionIndex]!;
        const secondProfile = profiles[sectionIndex + 1]!;
        const firstCurves = sectionCurves[sectionIndex]!;
        const secondCurves = sectionCurves[sectionIndex + 1]!;
        for (
          let curveIndex = 0;
          curveIndex < firstCurves.length;
          curveIndex += 1
        ) {
          const first = firstCurves[curveIndex]!;
          const second = secondCurves[curveIndex]!;
          attempt(() => {
            const temporary: ShapeHandle[] = [];
            try {
              const firstWire = this.raw.makeWire([first.handle]);
              temporary.push(firstWire);
              const secondWire = this.raw.makeWire([second.handle]);
              temporary.push(secondWire);
              const ruledSide = this.raw.loft(
                [firstWire, secondWire],
                false,
                true,
              );
              temporary.push(ruledSide);
              const sideSeeds = this.topologyFaceSeedsFromShape(
                ruledSide,
                uniqueLineage([
                  ...semanticLineage(
                    context,
                    "loft.face.side",
                    sourceOf(first.curve),
                  ),
                  ...semanticLineage(
                    context,
                    "loft.face.side",
                    sourceOf(second.curve),
                  ),
                ]),
              );
              if (sideSeeds.length !== 1) forcePartial = true;
              seeds.push(...sideSeeds);
              // A closed circle has no authored boundary vertex. OCCT still
              // materializes a seam, but naming that implementation-selected
              // edge would manufacture topology identity that the profile did
              // not provide.
              if (first.curve.kind === "circle") return;
              const firstStart = pointOnPlane(
                curveStart(first.curve),
                firstProfile.plane,
              );
              const secondStart = pointOnPlane(
                curveStart(second.curve),
                secondProfile.plane,
              );
              const firstPosition = vectorFromOcct(firstStart);
              const secondPosition = vectorFromOcct(secondStart);
              const coordinateScale = Math.max(
                1,
                ...firstPosition.map(Math.abs),
                ...secondPosition.map(Math.abs),
              );
              const tolerance = Math.max(
                this.modelingTolerance * 20,
                coordinateScale * Number.EPSILON * 64,
              );
              const joinsAuthoredStarts = (candidate: {
                readonly first: Vec3;
                readonly second: Vec3;
              }): boolean =>
                (vectorDistance(candidate.first, firstPosition) <= tolerance &&
                  vectorDistance(candidate.second, secondPosition) <=
                    tolerance) ||
                (vectorDistance(candidate.second, firstPosition) <= tolerance &&
                  vectorDistance(candidate.first, secondPosition) <= tolerance);
              const lateral: ShapeHandle[] = [];
              for (
                let edgeIndex = 0;
                edgeIndex < resultEdgeEndpoints.length;
                edgeIndex += 1
              ) {
                if ((edgeIndex & 255) === 0) checkContext(context);
                const candidate = resultEdgeEndpoints[edgeIndex]!;
                if (joinsAuthoredStarts(candidate)) {
                  lateral.push(candidate.handle);
                }
              }
              if (lateral.length !== 1) {
                forcePartial = true;
              } else {
                seeds.push(
                  this.topologySeedFromHandle(
                    lateral[0]!,
                    "edge",
                    semanticLineage(context, "loft.edge.lateral"),
                  ),
                );
              }
            } finally {
              this.releaseHandles(temporary);
            }
          });
        }
      }
      checkContext(context);
    } finally {
      this.releaseHandles(resultEdges);
    }

    const curveCount = sectionCurves[0]!.length;
    const authoredVertexCurveCount = sectionCurves[0]!.filter(
      (item) => item.curve.kind !== "circle",
    ).length;
    return {
      seeds,
      requireSeedCoverage: ["face"],
      ...(forcePartial ? { forcePartial: true } : {}),
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: {
                "loft.face.start-cap": 1,
                "loft.face.end-cap": 1,
                "loft.face.side": (profiles.length - 1) * curveCount,
                "loft.edge.section-rim": profiles.length * curveCount,
                "loft.edge.lateral":
                  (profiles.length - 1) * authoredVertexCurveCount,
              },
            },
      }),
    };
  }

  private sweepTopologyAnnotation(
    curves: readonly ProfileCurveHandle[],
    profileFace: ShapeHandle,
    path: ResolvedPath,
    sweepShape: ShapeHandle,
    context?: KernelFeatureContext,
  ): TopologyAnnotation {
    const sourceOf = (
      curve: ResolvedCurve,
    ): KernelTopologySource | undefined =>
      curve.source === undefined
        ? undefined
        : {
            kind: "sketch-entity",
            sketch: curve.source.sketch,
            entity: curve.source.entity,
          };
    const segmentCount = resolvedPathEdgeCount(path);
    const curveCount = curves.length;
    const authoredVertexCount = curves.filter(
      (item) => item.curve.kind !== "circle",
    ).length;
    const seeds: TopologyLineageSeed[] = [];
    const faceHandles: ShapeHandle[] = [];
    const edgeHandles: ShapeHandle[] = [];
    let forcePartial = false;

    try {
      checkContext(context);
      faceHandles.push(...this.raw.getSubShapes(sweepShape, "face"));
      edgeHandles.push(...this.raw.getSubShapes(sweepShape, "edge"));
      const faceGeometry: TopologyLineageSeed[] = [];
      for (let index = 0; index < faceHandles.length; index += 1) {
        if ((index & 255) === 0) checkContext(context);
        faceGeometry.push(
          this.topologySeedFromHandle(faceHandles[index]!, "face", []),
        );
      }
      const edgeGeometry: TopologyLineageSeed[] = [];
      for (let index = 0; index < edgeHandles.length; index += 1) {
        if ((index & 255) === 0) checkContext(context);
        edgeGeometry.push(
          this.topologySeedFromHandle(edgeHandles[index]!, "edge", []),
        );
      }

      const edgeHashBuckets = new Map<number, number[]>();
      edgeHandles.forEach((edge, index) => {
        const hash = this.raw.hashCode(edge, TOPOLOGY_HASH_UPPER_BOUND);
        const bucket = edgeHashBuckets.get(hash);
        if (bucket === undefined) edgeHashBuckets.set(hash, [index]);
        else bucket.push(index);
      });
      const faceEdges = faceHandles.map(() => new Set<number>());
      const edgeFaces = edgeHandles.map(() => new Set<number>());
      for (let faceIndex = 0; faceIndex < faceHandles.length; faceIndex += 1) {
        checkContext(context);
        const nestedEdges = this.raw.getSubShapes(
          faceHandles[faceIndex]!,
          "edge",
        );
        try {
          for (let nestedIndex = 0; nestedIndex < nestedEdges.length; nestedIndex += 1) {
            if ((nestedIndex & 255) === 0) checkContext(context);
            const nestedEdge = nestedEdges[nestedIndex]!;
            const hash = this.raw.hashCode(
              nestedEdge,
              TOPOLOGY_HASH_UPPER_BOUND,
            );
            const edgeIndex = (edgeHashBuckets.get(hash) ?? []).find(
              (candidate) =>
                this.raw.isSame(nestedEdge, edgeHandles[candidate]!),
            );
            if (edgeIndex === undefined) {
              throw new Error(
                "OCCT returned a sweep-face edge absent from the result",
              );
            }
            faceEdges[faceIndex]!.add(edgeIndex);
            edgeFaces[edgeIndex]!.add(faceIndex);
          }
        } finally {
          this.releaseHandles(nestedEdges);
        }
      }

      const uniqueGeometryMatch = (
        seed: TopologyLineageSeed,
        candidates: readonly TopologyLineageSeed[],
        allowed?: ReadonlySet<number>,
      ): number | undefined => {
        const matches: number[] = [];
        const candidateIndices: Iterable<number> =
          allowed ?? candidates.keys();
        let visited = 0;
        for (const index of candidateIndices) {
          if ((visited & 255) === 0) checkContext(context);
          visited += 1;
          if (this.topologySeedGeometryMatches(seed, candidates[index]!)) {
            matches.push(index);
          }
        }
        if (matches.length !== 1) {
          forcePartial = true;
          return undefined;
        }
        return matches[0];
      };
      const withLineage = (
        seed: TopologyLineageSeed,
        lineage: readonly KernelTopologyLineage[],
      ): TopologyLineageSeed => ({ ...seed, lineage });

      const startCapSeed = this.topologySeedFromHandle(
        profileFace,
        "face",
        semanticLineage(context, "sweep.face.start-cap"),
      );
      const startCap = uniqueGeometryMatch(startCapSeed, faceGeometry);
      if (startCap === undefined) throw new Error("Sweep start cap is ambiguous");

      const startCapEdges = faceEdges[startCap]!;
      if (startCapEdges.size !== curveCount) forcePartial = true;
      const startRimByCurve = new Map<number, number>();
      const firstLayer = new Map<number, number>();
      const usedStartRims = new Set<number>();
      const usedFirstFaces = new Set<number>();
      for (let curveIndex = 0; curveIndex < curves.length; curveIndex += 1) {
        const curve = curves[curveIndex]!;
        const authoredRim = this.topologySeedFromHandle(
          curve.handle,
          "edge",
          [],
        );
        const rim = uniqueGeometryMatch(
          authoredRim,
          edgeGeometry,
          startCapEdges,
        );
        if (rim === undefined || usedStartRims.has(rim)) {
          forcePartial = true;
          continue;
        }
        usedStartRims.add(rim);
        startRimByCurve.set(curveIndex, rim);
        const sideCandidates = [...edgeFaces[rim]!].filter(
          (face) => face !== startCap,
        );
        if (
          sideCandidates.length !== 1 ||
          usedFirstFaces.has(sideCandidates[0]!)
        ) {
          forcePartial = true;
          continue;
        }
        usedFirstFaces.add(sideCandidates[0]!);
        firstLayer.set(curveIndex, sideCandidates[0]!);
      }
      if (
        startRimByCurve.size !== curveCount ||
        firstLayer.size !== curveCount
      ) {
        throw new Error("Sweep start section correspondence is incomplete");
      }

      const layers: Map<number, number>[] = [firstLayer];
      const assignedSideFaces = new Set<number>(firstLayer.values());
      for (
        let segmentIndex = 0;
        segmentIndex < segmentCount - 1;
        segmentIndex += 1
      ) {
        checkContext(context);
        const current = layers[segmentIndex]!;
        const previous = layers[segmentIndex - 1];
        const currentFaces = new Set(current.values());
        const previousFaces = new Set(previous?.values() ?? []);
        const next = new Map<number, number>();
        const usedNextFaces = new Set<number>();
        for (let curveIndex = 0; curveIndex < curveCount; curveIndex += 1) {
          const currentFace = current.get(curveIndex);
          if (currentFace === undefined) {
            forcePartial = true;
            continue;
          }
          const candidates = new Set<number>();
          for (const edgeIndex of faceEdges[currentFace]!) {
            for (const neighbor of edgeFaces[edgeIndex]!) {
              if (
                neighbor !== currentFace &&
                neighbor !== startCap &&
                !currentFaces.has(neighbor) &&
                !previousFaces.has(neighbor) &&
                !assignedSideFaces.has(neighbor)
              ) {
                candidates.add(neighbor);
              }
            }
          }
          if (candidates.size !== 1) {
            forcePartial = true;
            continue;
          }
          const [nextFace] = candidates;
          if (nextFace === undefined || usedNextFaces.has(nextFace)) {
            forcePartial = true;
            continue;
          }
          usedNextFaces.add(nextFace);
          next.set(curveIndex, nextFace);
        }
        if (next.size !== curveCount) {
          throw new Error("Sweep side correspondence branches or disappears");
        }
        layers.push(next);
        for (const face of next.values()) assignedSideFaces.add(face);
      }

      if (
        layers.length !== segmentCount ||
        assignedSideFaces.size !== segmentCount * curveCount
      ) {
        throw new Error("Sweep side-layer coverage is incomplete");
      }
      const terminalCaps = faceHandles
        .map((_, index) => index)
        .filter(
          (index) => index !== startCap && !assignedSideFaces.has(index),
        );
      if (terminalCaps.length !== 1) {
        throw new Error("Sweep end cap is missing or ambiguous");
      }
      const endCap = terminalCaps[0]!;
      const lastLayer = layers.at(-1)!;
      const endCapEdges = faceEdges[endCap]!;
      if (endCapEdges.size !== curveCount) forcePartial = true;
      const endRimByCurve = new Map<number, number>();
      const usedEndRims = new Set<number>();
      for (const [curveIndex, terminalFace] of lastLayer) {
        const candidates = [...endCapEdges].filter(
          (edgeIndex) =>
            edgeFaces[edgeIndex]!.has(terminalFace) &&
            edgeFaces[edgeIndex]!.has(endCap),
        );
        if (
          candidates.length !== 1 ||
          usedEndRims.has(candidates[0]!)
        ) {
          forcePartial = true;
          continue;
        }
        usedEndRims.add(candidates[0]!);
        endRimByCurve.set(curveIndex, candidates[0]!);
      }
      if (endRimByCurve.size !== curveCount) {
        throw new Error("Sweep end-rim correspondence is incomplete");
      }

      seeds.push(
        withLineage(
          faceGeometry[startCap]!,
          semanticLineage(context, "sweep.face.start-cap"),
        ),
        withLineage(
          faceGeometry[endCap]!,
          semanticLineage(context, "sweep.face.end-cap"),
        ),
      );
      const sideSlotByFace = new Map<
        number,
        { readonly curve: number; readonly segment: number }
      >();
      for (let segmentIndex = 0; segmentIndex < layers.length; segmentIndex += 1) {
        for (const [curveIndex, faceIndex] of layers[segmentIndex]!) {
          sideSlotByFace.set(faceIndex, {
            curve: curveIndex,
            segment: segmentIndex,
          });
          seeds.push(
            withLineage(
              faceGeometry[faceIndex]!,
              semanticLineage(
                context,
                "sweep.face.side",
                sourceOf(curves[curveIndex]!.curve),
              ),
            ),
          );
        }
      }
      for (let curveIndex = 0; curveIndex < curveCount; curveIndex += 1) {
        const source = sourceOf(curves[curveIndex]!.curve);
        seeds.push(
          withLineage(
            edgeGeometry[startRimByCurve.get(curveIndex)!]!,
            semanticLineage(context, "sweep.edge.start-rim", source),
          ),
          withLineage(
            edgeGeometry[endRimByCurve.get(curveIndex)!]!,
            semanticLineage(context, "sweep.edge.end-rim", source),
          ),
        );
      }

      const lateralCounts = new Map<string, number>();
      const lateralKey = (
        segment: number,
        firstCurve: number,
        secondCurve: number,
      ): string =>
        `${segment}:${Math.min(firstCurve, secondCurve)}:${Math.max(firstCurve, secondCurve)}`;
      for (let edgeIndex = 0; edgeIndex < edgeFaces.length; edgeIndex += 1) {
        if ((edgeIndex & 255) === 0) checkContext(context);
        const adjacent = [...edgeFaces[edgeIndex]!];
        if (adjacent.length > 2) {
          forcePartial = true;
          continue;
        }
        if (adjacent.length !== 2) continue;
        const firstFace = adjacent[0]!;
        const secondFace = adjacent[1]!;
        const firstIsStart = firstFace === startCap;
        const secondIsStart = secondFace === startCap;
        const firstIsEnd = firstFace === endCap;
        const secondIsEnd = secondFace === endCap;
        const first = sideSlotByFace.get(adjacent[0]!);
        const second = sideSlotByFace.get(adjacent[1]!);

        if (firstIsStart || secondIsStart) {
          const side = firstIsStart ? second : first;
          if (
            side === undefined ||
            side.segment !== 0 ||
            startRimByCurve.get(side.curve) !== edgeIndex
          ) {
            forcePartial = true;
          }
          continue;
        }
        if (firstIsEnd || secondIsEnd) {
          const side = firstIsEnd ? second : first;
          if (
            side === undefined ||
            side.segment !== segmentCount - 1 ||
            endRimByCurve.get(side.curve) !== edgeIndex
          ) {
            forcePartial = true;
          }
          continue;
        }
        if (first === undefined || second === undefined) {
          forcePartial = true;
          continue;
        }
        if (
          first.curve === second.curve &&
          Math.abs(first.segment - second.segment) === 1
        ) {
          continue;
        }
        const neighboringCurves =
          first.segment === second.segment &&
          curveCount > 1 &&
          ((first.curve + 1) % curveCount === second.curve ||
            (second.curve + 1) % curveCount === first.curve);
        if (!neighboringCurves) {
          forcePartial = true;
          continue;
        }
        const key = lateralKey(first.segment, first.curve, second.curve);
        lateralCounts.set(key, (lateralCounts.get(key) ?? 0) + 1);
        seeds.push(
          withLineage(
            edgeGeometry[edgeIndex]!,
            semanticLineage(context, "sweep.edge.lateral"),
          ),
        );
      }
      const expectedLateralCounts = new Map<string, number>();
      if (authoredVertexCount > 0) {
        for (let segment = 0; segment < segmentCount; segment += 1) {
          for (let curve = 0; curve < curveCount; curve += 1) {
            const previous = (curve + curveCount - 1) % curveCount;
            const key = lateralKey(segment, previous, curve);
            expectedLateralCounts.set(
              key,
              (expectedLateralCounts.get(key) ?? 0) + 1,
            );
          }
        }
      }
      if (
        lateralCounts.size !== expectedLateralCounts.size ||
        [...expectedLateralCounts].some(
          ([key, count]) => lateralCounts.get(key) !== count,
        )
      ) {
        forcePartial = true;
      }
      checkContext(context);
    } catch {
      checkContext(context);
      forcePartial = true;
    } finally {
      this.releaseHandles(edgeHandles);
      this.releaseHandles(faceHandles);
    }

    return {
      seeds,
      requireSeedCoverage: ["face"],
      ...(forcePartial ? { forcePartial: true } : {}),
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: {
                "sweep.face.start-cap": 1,
                "sweep.face.end-cap": 1,
                "sweep.face.side": segmentCount * curveCount,
                "sweep.edge.start-rim": curveCount,
                "sweep.edge.end-rim": curveCount,
                "sweep.edge.lateral": segmentCount * authoredVertexCount,
              },
            },
          }),
    };
  }

  box(
    size: Vec3,
    center: boolean,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const box = this.raw.makeBox(size[0], size[1], size[2]);
    const min: Vec3 = center
      ? [-size[0] / 2, -size[1] / 2, -size[2] / 2]
      : [0, 0, 0];
    const max: Vec3 = [
      min[0] + size[0],
      min[1] + size[1],
      min[2] + size[2],
    ];
    const annotation = this.boxTopologyAnnotation(context, min, max);
    if (!center) return this.own(box, context, { annotation });
    try {
      return this.own(
        this.raw.translate(box, -size[0] / 2, -size[1] / 2, -size[2] / 2),
        context,
        { annotation },
      );
    } finally {
      this.raw.release(box);
    }
  }

  cylinder(
    height: number,
    radiusBottom: number,
    radiusTop: number,
    center: boolean,
    _segments?: number,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const cylinder =
      Math.abs(radiusBottom - radiusTop) <= this.modelingTolerance
        ? this.raw.makeCylinder(radiusBottom, height)
        : this.raw.makeCone(radiusBottom, radiusTop, height);
    const annotation = this.cylinderTopologyAnnotation(
      context,
      center ? -height / 2 : 0,
      center ? height / 2 : height,
      radiusBottom > this.modelingTolerance,
      radiusTop > this.modelingTolerance,
    );
    if (!center) return this.own(cylinder, context, { annotation });
    try {
      return this.own(
        this.raw.translate(cylinder, 0, 0, -height / 2),
        context,
        { annotation },
      );
    } finally {
      this.raw.release(cylinder);
    }
  }

  sphere(
    radius: number,
    _segments?: number,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    return this.own(this.raw.makeSphere(radius), context, {
      annotation: this.sphereTopologyAnnotation(context),
    });
  }

  extrude(
    profile: ResolvedProfile,
    options: {
      readonly distance: number;
      readonly symmetric: boolean;
      readonly twist: number;
      readonly scaleTop: readonly [number, number];
      readonly divisions: number;
    },
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (
      Math.abs(options.twist) > this.modelingTolerance ||
      Math.abs(options.scaleTop[0] - 1) > this.modelingTolerance ||
      Math.abs(options.scaleTop[1] - 1) > this.modelingTolerance ||
      options.divisions !== 0
    ) {
      throw new RangeError(
        "The OCCT exact extrude currently requires zero twist, unit top scale, and zero divisions",
      );
    }
    const built = this.profileFace(profile);
    const normal = numericPlaneBasis(profile.plane).n;
    let result: ShapeHandle | undefined;
    try {
      result = this.raw.extrude(
        built.face,
        normal[0] * options.distance,
        normal[1] * options.distance,
        normal[2] * options.distance,
      );
      if (options.symmetric) {
        const centered = this.raw.translate(
          result,
          normal[0] * -options.distance * 0.5,
          normal[1] * -options.distance * 0.5,
          normal[2] * -options.distance * 0.5,
        );
        this.raw.release(result);
        result = centered;
      }
      return this.own(result, context, {
        annotation: this.extrudeTopologyAnnotation(
          profile,
          built.curves,
          options,
          context,
        ),
      });
    } catch (error) {
      if (result !== undefined) this.raw.release(result);
      throw error;
    } finally {
      this.releaseHandles(built.allocated);
    }
  }

  revolve(
    profile: ResolvedProfile,
    options: { readonly angle: number; readonly segments?: number },
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const built = this.profileFace(profile);
    const axis = numericPlaneBasis(profile.plane).v;
    let result: ShapeHandle | undefined;
    try {
      result = this.raw.revolve(
        built.face,
        {
          point: {
            x: profile.plane.origin[0],
            y: profile.plane.origin[1],
            z: profile.plane.origin[2],
          },
          direction: occtVector(axis),
        },
        options.angle,
      );
      return this.own(result, context, {
        annotation: this.revolveTopologyAnnotation(
          profile,
          built.curves,
          built.face,
          options.angle,
          context,
        ),
      });
    } catch (error) {
      if (result !== undefined) this.raw.release(result);
      throw error;
    } finally {
      this.releaseHandles(built.allocated);
    }
  }

  loft(
    profiles: readonly ResolvedProfile[],
    options: ResolvedLoftOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (typeof options !== "object" || options === null || options.ruled !== true) {
      throw new TypeError("Document lofts must use ruled interpolation");
    }
    const tolerance = context?.tolerance ?? this.modelingTolerance;
    const issue = validateRuledSolidLoftProfiles(profiles, tolerance);
    if (issue !== undefined) throw new RangeError(issue.message);

    const allocated: ShapeHandle[] = [];
    const sectionCurves: ProfileCurveHandle[][] = [];
    const sectionFaces: ShapeHandle[] = [];
    const wires: ShapeHandle[] = [];
    let result: ShapeHandle | undefined;
    try {
      for (const [index, profile] of profiles.entries()) {
        checkContext(context);
        const curves: ProfileCurveHandle[] = [];
        const wire = this.loopWire(profile.outer, profile.plane, allocated, curves);
        sectionCurves.push(curves);
        wires.push(wire);
        const curveCount = profile.outer.curves.length;
        if (
          this.raw.isNull(wire) ||
          this.raw.getShapeType(wire) !== "wire" ||
          !this.raw.isValid(wire) ||
          this.raw.subShapeCount(wire, "edge") !== curveCount ||
          this.raw.subShapeCount(wire, "vertex") !== curveCount
        ) {
          throw new RangeError(
            `Loft profile ${index} does not form a valid unmodified wire`,
          );
        }
        const sectionFace = this.raw.makeFace(wire);
        allocated.push(sectionFace);
        sectionFaces.push(sectionFace);
        if (
          this.raw.isNull(sectionFace) ||
          this.raw.getShapeType(sectionFace) !== "face" ||
          !this.raw.isValid(sectionFace) ||
          this.raw.subShapeCount(sectionFace, "edge") !== curveCount ||
          this.raw.subShapeCount(sectionFace, "vertex") !== curveCount
        ) {
          throw new RangeError(
            `Loft profile ${index} does not form a valid simple planar face`,
          );
        }
        const sectionArea = this.raw.getSurfaceArea(sectionFace);
        if (
          !Number.isFinite(sectionArea) ||
          !(sectionArea > tolerance ** 2)
        ) {
          throw new RangeError(
            `Loft profile ${index} does not form a valid simple planar face`,
          );
        }
      }

      checkContext(context);
      result = this.raw.loft(wires, true, true);
      checkContext(context);

      const curveCount = profiles[0]!.outer.curves.length;
      const expectedFaces = (profiles.length - 1) * curveCount + 2;
      const expectedEdges = (2 * profiles.length - 1) * curveCount;
      const expectedVertices = profiles.length * curveCount;
      const minimumVolume = Math.max(tolerance ** 3, Number.EPSILON);

      const validateResult = (): number => {
        if (
          result === undefined ||
          this.raw.isNull(result) ||
          this.raw.getShapeType(result) !== "solid" ||
          !this.raw.isValid(result)
        ) {
          throw new RangeError("Loft did not produce one valid solid");
        }
        if (
          this.raw.subShapeCount(result, "solid") !== 1 ||
          this.raw.subShapeCount(result, "shell") !== 1
        ) {
          throw new RangeError("Loft did not produce exactly one solid and shell");
        }
        if (
          this.raw.subShapeCount(result, "face") !== expectedFaces ||
          this.raw.subShapeCount(result, "edge") !== expectedEdges ||
          this.raw.subShapeCount(result, "vertex") !== expectedVertices
        ) {
          throw new RangeError(
            "Loft changed the ordered section-curve correspondence",
          );
        }
        const solids = this.raw.getSubShapes(result, "solid");
        try {
          if (
            solids.length !== 1 ||
            !this.isPureSingleSolidShape(result, solids[0]!)
          ) {
            throw new RangeError(
              "Loft produced loose topology outside its result solid",
            );
          }
        } finally {
          this.releaseHandles(solids);
        }
        const volume = this.raw.getVolume(result);
        if (!Number.isFinite(volume) || !(Math.abs(volume) > minimumVolume)) {
          throw new RangeError("Loft did not produce a positive-volume solid");
        }
        return volume;
      };

      let volume = validateResult();
      if (volume < 0) {
        const reversed = this.raw.reverseShape(result);
        this.raw.release(result);
        result = reversed;
        volume = validateResult();
      }
      if (!(volume > minimumVolume)) {
        throw new RangeError("Loft did not produce a positive-volume solid");
      }
      return this.own(result, context, {
        annotation: this.loftTopologyAnnotation(
          profiles,
          sectionCurves,
          sectionFaces,
          result,
          context,
        ),
      });
    } catch (error) {
      if (result !== undefined) this.raw.release(result);
      throw error;
    } finally {
      this.releaseHandles(allocated);
    }
  }

  sweep(
    profile: ResolvedProfile,
    path: ResolvedPolylinePath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    if (path.kind !== "polyline") {
      throw new TypeError("Polyline sweep requires a polyline path");
    }
    return this.sweepPath(profile, path, options, context);
  }

  circularArcSweep(
    profile: ResolvedProfile,
    path: ResolvedCircularArcPath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    if (path.kind !== "circularArc") {
      throw new TypeError(
        "Circular-arc sweep requires a three-point circular-arc path",
      );
    }
    return this.sweepPath(profile, path, options, context);
  }

  compositeSweep(
    profile: ResolvedProfile,
    path: ResolvedCompositePath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    if (path.kind !== "composite") {
      throw new TypeError("Composite sweep requires an exact composite path");
    }
    return this.sweepPath(profile, path, options, context);
  }

  private sweepPath(
    profile: ResolvedProfile,
    path: ResolvedPath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (
      typeof options !== "object" ||
      options === null ||
      options.transition !== "right-corner" ||
      options.frame !== "corrected-frenet"
    ) {
      throw new TypeError(
        "Document sweeps require corrected-Frenet transport and right-corner transitions",
      );
    }
    const requestedTolerance = context?.tolerance ?? this.modelingTolerance;
    if (!Number.isFinite(requestedTolerance) || !(requestedTolerance > 0)) {
      throw new RangeError("Path tolerance must be finite and positive");
    }
    const tolerance =
      path.kind === "circularArc" || path.kind === "composite"
        ? Math.max(requestedTolerance, this.modelingTolerance)
        : requestedTolerance;
    const issue = validateResolvedSweep(profile, path, tolerance);
    if (issue !== undefined) throw new RangeError(issue.message);
    if (path.kind === "composite") {
      const classification = classifyResolvedCompositeSweepRefinements(
        profile,
        path,
        requestedTolerance,
      );
      if (!classification.ok) {
        throw new RangeError(classification.message);
      }
      if (this.facade?.pipeShell === undefined) {
        if (
          classification.requiredRefinements.includes(
            "major-multiple-arcs",
          )
        ) {
          throw new RangeError(
            "Stock OCCT major-arc composite sweeps require exactly one circular-arc segment",
          );
        }
        if (
          classification.requiredRefinements.includes(
            "major-eccentric-profile",
          )
        ) {
          throw new RangeError(
            "Stock OCCT major-arc composite sweeps require the profile area centroid at the path start",
          );
        }
      }
    }
    if (
      path.kind === "circularArc" &&
      !(
        circularArcMinimumPointSine(path) >
        OCCT_CIRCULAR_ARC_MIN_POINT_SINE
      )
    ) {
      throw new RangeError(
        `Circular-arc path points must exceed the OCCT three-point angular resolution (sine > ${OCCT_CIRCULAR_ARC_MIN_POINT_SINE})`,
      );
    }
    if (path.kind === "composite") {
      const poorlyConditionedArc = resolvedCompositePathSegments(path).findIndex(
        (segment) =>
          segment.kind === "circularArc" &&
          !(
            circularArcMinimumPointSine(segment) >
            OCCT_CIRCULAR_ARC_MIN_POINT_SINE
          ),
      );
      if (poorlyConditionedArc !== -1) {
        throw new RangeError(
          `Composite circular-arc segment ${poorlyConditionedArc} points must exceed the OCCT three-point angular resolution (sine > ${OCCT_CIRCULAR_ARC_MIN_POINT_SINE})`,
        );
      }
    }
    if (path.kind === "polyline" || path.kind === "composite") {
      const shortProfileCurve = profile.outer.curves.findIndex(
        (curve) =>
          !(resolvedProfileCurveLength(curve) >
            OCCT_PIPE_SHELL_LINEAR_TOLERANCE),
      );
      if (shortProfileCurve !== -1) {
        throw new RangeError(
          `Sweep profile curve ${shortProfileCurve} must exceed the OCCT pipe-shell linear tolerance (${OCCT_PIPE_SHELL_LINEAR_TOLERANCE} mm)`,
        );
      }
      const pipeSegments: readonly ResolvedPathSegment[] =
        path.kind === "polyline"
          ? path.points.slice(0, -1).map((start, index) => ({
              kind: "line" as const,
              start,
              end: path.points[index + 1]!,
            }))
          : resolvedCompositePathSegments(path);
      const shortPathSegment = pipeSegments.findIndex(
        (segment) =>
          !(resolvedPathSegmentLength(segment) >
            OCCT_PIPE_SHELL_LINEAR_TOLERANCE) ||
          (segment.kind === "circularArc" &&
            !(
              Math.min(
                vectorDistance(segment.start, segment.through),
                vectorDistance(segment.through, segment.end),
                vectorDistance(segment.start, segment.end),
              ) > OCCT_PIPE_SHELL_LINEAR_TOLERANCE
            )),
      );
      if (shortPathSegment !== -1) {
        throw new RangeError(
          `Sweep path segment ${shortPathSegment} must exceed the OCCT pipe-shell linear tolerance (${OCCT_PIPE_SHELL_LINEAR_TOLERANCE} mm)`,
        );
      }
    }

    const seatedProfile: ResolvedProfile =
      path.kind === "circularArc" || path.kind === "composite"
        ? {
            ...profile,
            plane: { ...profile.plane, origin: path.start },
          }
        : profile;
    let analyticProfile:
      | {
          readonly properties: AnalyticProfileMassProperties;
          readonly normal: Vec3;
        }
      | undefined;
    if (path.kind === "circularArc" || path.kind === "composite") {
      const moments = resolvedProfileLocalAreaMoments(
        seatedProfile,
        tolerance,
      );
      if (!moments.ok) {
        throw new RangeError(
          `Sweep profile does not have stable analytic area moments: ${moments.message}`,
        );
      }
      const basis = numericPlaneBasis(seatedProfile.plane);
      const centroidOffset: Vec3 = [
        basis.u[0] * moments.localCentroid[0] +
          basis.v[0] * moments.localCentroid[1],
        basis.u[1] * moments.localCentroid[0] +
          basis.v[1] * moments.localCentroid[1],
        basis.u[2] * moments.localCentroid[0] +
          basis.v[2] * moments.localCentroid[1],
      ];
      const boundary = resolvedProfileBoundaryGeometry(
        seatedProfile,
        moments.localCentroid,
      );
      if (boundary === undefined) {
        throw new RangeError(
          "Sweep profile does not have stable analytic boundary geometry",
        );
      }
      analyticProfile = {
        properties: {
          area: moments.area,
          areaRoundoffBound: moments.diagnostics.areaRoundoffBound,
          perimeter: boundary.perimeter,
          maxBoundaryRadius: boundary.maxBoundaryRadius,
          plane: seatedProfile.plane.plane,
          centroidOffset,
          centroidRoundoffBound:
            moments.diagnostics.centroidRoundoffBound,
        },
        normal: moments.normal,
      };
    }
    const built = this.profileFace(seatedProfile);
    const pathAllocated: ShapeHandle[] = [];
    let result: ShapeHandle | undefined;
    let exactVolume: number | undefined;
    let nativeVolumePostcondition:
      | {
          readonly expected: number;
          readonly allowance: number;
          readonly message: string;
        }
      | undefined;
    try {
      const curveCount = profile.outer.curves.length;
      if (
        this.raw.isNull(built.outerWire) ||
        this.raw.getShapeType(built.outerWire) !== "wire" ||
        !this.raw.isValid(built.outerWire) ||
        this.raw.subShapeCount(built.outerWire, "edge") !== curveCount ||
        this.raw.subShapeCount(built.outerWire, "vertex") !== curveCount ||
        this.raw.isNull(built.face) ||
        this.raw.getShapeType(built.face) !== "face" ||
        !this.raw.isValid(built.face) ||
        this.raw.subShapeCount(built.face, "edge") !== curveCount ||
        this.raw.subShapeCount(built.face, "vertex") !== curveCount
      ) {
        throw new RangeError(
          "Sweep profile does not form a valid simple planar face",
        );
      }
      const nativeProfileArea = this.raw.getSurfaceArea(built.face);
      if (
        !Number.isFinite(nativeProfileArea) ||
        !(nativeProfileArea > tolerance ** 2)
      ) {
        throw new RangeError(
          "Sweep profile does not form a valid simple planar face",
        );
      }
      let profileArea = nativeProfileArea;
      let profileCentroidOffset: Vec3 | undefined;
      let profileNormal: Vec3 | undefined;
      let nativeProfileCentroid: Vec3 | undefined;
      let profileMassPropertyDiagnostics:
        | NativeProfileMassPropertyDiagnostics
        | undefined;
      if (analyticProfile !== undefined) {
        const nativeCentroid = vectorFromOcct(
          this.raw.getSurfaceCenterOfMass(built.face),
        );
        const certification = certifyNativeProfileMassProperties(
          analyticProfile.properties,
          { area: nativeProfileArea, centroid: nativeCentroid },
          seatedProfile.plane.origin as Vec3,
          {
            modelingTolerance: this.modelingTolerance,
            requireCentroid: true,
          },
        );
        if (!certification.ok) {
          throw new OcctProfileMassPropertyError(
            certification.reason,
            certification.message,
            certification.diagnostics,
          );
        }
        profileArea = certification.properties.area;
        profileCentroidOffset = certification.properties.centroidOffset;
        profileNormal = analyticProfile.normal;
        nativeProfileCentroid = nativeCentroid;
        profileMassPropertyDiagnostics = certification.diagnostics;
      }
      const minimumVolume = tolerance ** 3;
      if (path.kind === "composite") {
        const segments = resolvedCompositePathSegments(path);
        const volumeOracle = resolvedCompositeSweepVolumeOracle(
          {
            area: profileArea,
            centroidOffsetFromPathStart: profileCentroidOffset!,
            normal: profileNormal!,
          },
          path,
          tolerance,
        );
        if (!volumeOracle.ok) {
          throw new RangeError(
            `Composite sweep does not have a stable transported-profile volume postcondition: ${volumeOracle.message}`,
          );
        }
        const expected = volumeOracle.volume;
        const arcSweep = segments.reduce(
          (total, segment) =>
            total +
            (segment.kind === "circularArc"
              ? resolvedCircularArcGeometry(segment)!.sweep
              : 0),
          0,
        );
        const areaRoundoffBound =
          analyticProfile!.properties.areaRoundoffBound;
        const centroidRoundoffBound =
          analyticProfile!.properties.centroidRoundoffBound!;
        const areaMomentAllowance =
          (volumeOracle.diagnostics.absoluteTermSum / profileArea) *
          areaRoundoffBound;
        const centroidSensitivity = volumeOracle.diagnostics.terms.reduce(
          (total, term) =>
            total +
            (term.kind === "circularArc"
              ? Math.abs(term.sweep)
              : term.kind === "rightCorner"
                ? 2 *
                  Math.abs(
                    term.normalProjection * term.tangentHalfTurn,
                  )
                : 0),
          0,
        );
        const centroidMomentAllowance =
          (profileArea + areaRoundoffBound) *
          centroidRoundoffBound *
          centroidSensitivity;
        const constructionTolerance =
          this.facade?.pipeShell === undefined
            ? OCCT_PIPE_SHELL_LINEAR_TOLERANCE
            : Math.min(tolerance, OCCT_PIPE_SHELL_LINEAR_TOLERANCE);
        const allowance =
          expected * OCCT_PIPE_SHELL_VOLUME_RELATIVE_TOLERANCE +
          volumeOracle.diagnostics.roundoffBound +
          areaMomentAllowance +
          centroidMomentAllowance +
          profileArea * constructionTolerance * (1 + arcSweep);
        if (
          !Number.isFinite(expected) ||
          !(expected > minimumVolume) ||
          !Number.isFinite(allowance) ||
          !(allowance >= 0)
        ) {
          throw new RangeError(
            "Composite sweep does not have a stable transported-profile volume postcondition",
          );
        }
        exactVolume = expected;
        nativeVolumePostcondition = {
          expected,
          allowance,
          message:
            "OCCT pipe-shell sweep failed the transported-profile analytic volume postcondition",
        };
      }
      if (path.kind === "circularArc") {
        const geometry = resolvedCircularArcGeometry(path)!;
        const offset: Vec3 = [
          profileCentroidOffset![0] - geometry.centerOffsetFromStart[0],
          profileCentroidOffset![1] - geometry.centerOffsetFromStart[1],
          profileCentroidOffset![2] - geometry.centerOffsetFromStart[2],
        ];
        const centroidVelocity: Vec3 = [
          geometry.normal[1] * offset[2] -
            geometry.normal[2] * offset[1],
          geometry.normal[2] * offset[0] -
            geometry.normal[0] * offset[2],
          geometry.normal[0] * offset[1] -
            geometry.normal[1] * offset[0],
        ];
        const normalSpeed = Math.abs(
          profileNormal![0] * centroidVelocity[0] +
            profileNormal![1] * centroidVelocity[1] +
            profileNormal![2] * centroidVelocity[2],
        );
        exactVolume = profileArea * normalSpeed * geometry.sweep;
        if (!Number.isFinite(exactVolume) || !(exactVolume > minimumVolume)) {
          throw new RangeError(
            "Circular-arc sweep does not have a stable positive analytic volume",
          );
        }
        const roundedCenterOffset: Vec3 = [
          geometry.center[0] - path.start[0],
          geometry.center[1] - path.start[1],
          geometry.center[2] - path.start[2],
        ];
        const centerOffsetError: Vec3 = [
          Math.abs(
            roundedCenterOffset[0] - geometry.centerOffsetFromStart[0],
          ),
          Math.abs(
            roundedCenterOffset[1] - geometry.centerOffsetFromStart[1],
          ),
          Math.abs(
            roundedCenterOffset[2] - geometry.centerOffsetFromStart[2],
          ),
        ];
        const centerOffsetAllowance: Vec3 = [
          tolerance +
            NATIVE_PROFILE_COORDINATE_ULP_FACTOR *
              Math.max(
                binary64Ulp(path.start[0]),
                binary64Ulp(geometry.center[0]),
              ),
          tolerance +
            NATIVE_PROFILE_COORDINATE_ULP_FACTOR *
              Math.max(
                binary64Ulp(path.start[1]),
                binary64Ulp(geometry.center[1]),
              ),
          tolerance +
            NATIVE_PROFILE_COORDINATE_ULP_FACTOR *
              Math.max(
                binary64Ulp(path.start[2]),
                binary64Ulp(geometry.center[2]),
              ),
        ];
        if (
          centerOffsetError.some((value) => !Number.isFinite(value)) ||
          centerOffsetAllowance.some((value) => !Number.isFinite(value)) ||
          centerOffsetError.some(
            (value, index) => value > centerOffsetAllowance[index]!,
          )
        ) {
          throw new RangeError(
            "OCCT circular-revolution axis exceeds the certified coordinate-resolution envelope",
          );
        }
        const nativeOffset: Vec3 = [
          nativeProfileCentroid![0] - geometry.center[0],
          nativeProfileCentroid![1] - geometry.center[1],
          nativeProfileCentroid![2] - geometry.center[2],
        ];
        const nativeCentroidVelocity: Vec3 = [
          geometry.normal[1] * nativeOffset[2] -
            geometry.normal[2] * nativeOffset[1],
          geometry.normal[2] * nativeOffset[0] -
            geometry.normal[0] * nativeOffset[2],
          geometry.normal[0] * nativeOffset[1] -
            geometry.normal[1] * nativeOffset[0],
        ];
        const nativeNormalSpeed = Math.abs(
          profileNormal![0] * nativeCentroidVelocity[0] +
            profileNormal![1] * nativeCentroidVelocity[1] +
            profileNormal![2] * nativeCentroidVelocity[2],
        );
        const nativeDerivedVolume =
          nativeProfileArea * nativeNormalSpeed * geometry.sweep;
        const centroidAllowance =
          profileMassPropertyDiagnostics!.centroidAllowance!;
        const orbitRadiusAllowance = Math.hypot(
          centroidAllowance[0] + centerOffsetAllowance[0],
          centroidAllowance[1] + centerOffsetAllowance[1],
          centroidAllowance[2] + centerOffsetAllowance[2],
        );
        const areaAllowance =
          profileMassPropertyDiagnostics!.areaAllowance;
        const allowance =
          exactVolume * OCCT_PIPE_SHELL_VOLUME_RELATIVE_TOLERANCE +
          geometry.sweep *
            (normalSpeed * areaAllowance +
              (profileArea + areaAllowance) * orbitRadiusAllowance);
        if (
          !Number.isFinite(nativeDerivedVolume) ||
          !Number.isFinite(allowance) ||
          !(allowance >= 0) ||
          Math.abs(nativeDerivedVolume - exactVolume) > allowance
        ) {
          throw new RangeError(
            "OCCT circular-revolution sweep failed the analytic volume postcondition",
          );
        }
      }

      const segmentCount = resolvedPathEdgeCount(path);
      if (path.kind !== "circularArc") {
        const pipeSegments: readonly ResolvedPathSegment[] =
          path.kind === "polyline"
            ? path.points.slice(0, -1).map((start, index) => ({
                kind: "line" as const,
                start,
                end: path.points[index + 1]!,
              }))
            : resolvedCompositePathSegments(path);
        const pathEdges: ShapeHandle[] = [];
        let expectedPathLength = 0;
        for (const [index, segment] of pipeSegments.entries()) {
          checkContext(context);
          const edge =
            segment.kind === "line"
              ? this.raw.makeLineEdge(
                  occtVector(segment.start),
                  occtVector(segment.end),
                )
              : this.raw.makeArcEdge(
                  occtVector(segment.start),
                  occtVector(segment.through),
                  occtVector(segment.end),
                );
          pathAllocated.push(edge);
          pathEdges.push(edge);
          if (
            this.raw.isNull(edge) ||
            this.raw.getShapeType(edge) !== "edge" ||
            !this.raw.isValid(edge) ||
            this.raw.subShapeCount(edge, "vertex") !== 2
          ) {
            throw new RangeError(
              `Sweep path segment ${index} does not form a valid edge`,
            );
          }
          const expectedLength = resolvedPathSegmentLength(segment);
          expectedPathLength += expectedLength;
          if (path.kind === "composite") {
            const measuredLength = this.raw.curveLength(edge);
            const lengthTolerance = Math.max(
              this.modelingTolerance * 8,
              expectedLength * 1e-9,
            );
            const expectedCurveType =
              segment.kind === "line" ? "line" : "circle";
            if (
              this.raw.curveType(edge) !== expectedCurveType ||
              this.raw.curveIsClosed(edge) ||
              !Number.isFinite(measuredLength) ||
              Math.abs(measuredLength - expectedLength) > lengthTolerance
            ) {
              throw new RangeError(
                `Composite sweep path segment ${index} changed its exact curve geometry`,
              );
            }
            const parameters = this.raw.curveParameters(edge);
            const nativeStart = vectorFromOcct(
              this.raw.curvePointAtParam(edge, parameters.first),
            );
            const nativeEnd = vectorFromOcct(
              this.raw.curvePointAtParam(edge, parameters.last),
            );
            const endpointTolerance = Math.max(
              this.modelingTolerance * 8,
              1e-10,
            );
            if (
              vectorDistance(nativeStart, segment.start) > endpointTolerance ||
              vectorDistance(nativeEnd, segment.end) > endpointTolerance
            ) {
              throw new RangeError(
                `Composite sweep path segment ${index} changed its authored endpoints`,
              );
            }
            const nativeStartTangent = vectorFromOcct(
              this.raw.curveTangent(edge, parameters.first),
            );
            const nativeEndTangent = vectorFromOcct(
              this.raw.curveTangent(edge, parameters.last),
            );
            if (
              !directedUnitVectorsMatch(
                nativeStartTangent,
                resolvedPathSegmentStartTangent(segment),
                OCCT_PIPE_SHELL_TANGENT_SINE_TOLERANCE,
              ) ||
              !directedUnitVectorsMatch(
                nativeEndTangent,
                resolvedPathSegmentEndTangent(segment),
                OCCT_PIPE_SHELL_TANGENT_SINE_TOLERANCE,
              )
            ) {
              throw new RangeError(
                `Composite sweep path segment ${index} changed its authored tangents`,
              );
            }
          }
        }
        const spine = this.raw.makeWire(pathEdges);
        pathAllocated.push(spine);
        if (
          this.raw.isNull(spine) ||
          this.raw.getShapeType(spine) !== "wire" ||
          !this.raw.isValid(spine) ||
          this.raw.subShapeCount(spine, "edge") !== segmentCount ||
          this.raw.subShapeCount(spine, "vertex") !== segmentCount + 1
        ) {
          throw new RangeError(
            "Sweep path does not form one valid unmodified open wire",
          );
        }
        if (path.kind === "composite") {
          const expectedVertices = [
            path.start,
            ...path.segments.map((segment) => segment.end),
          ];
          const spineVertices = this.raw.getSubShapes(spine, "vertex");
          try {
            const positions = spineVertices.map((vertex) =>
              vectorFromOcct(this.raw.vertexPosition(vertex)),
            );
            const endpointTolerance = Math.max(
              this.modelingTolerance * 8,
              1e-10,
            );
            if (
              positions.length !== expectedVertices.length ||
              expectedVertices.some(
                (expected) =>
                  positions.filter(
                    (position) =>
                      vectorDistance(position, expected) <= endpointTolerance,
                  ).length !== 1,
              )
            ) {
              throw new RangeError(
                "Composite sweep path wire changed its authored joints",
              );
            }
          } finally {
            this.releaseHandles(spineVertices);
          }
          const measuredPathLength = this.raw.getLength(spine);
          if (
            !Number.isFinite(measuredPathLength) ||
            Math.abs(measuredPathLength - expectedPathLength) >
              Math.max(
                this.modelingTolerance * segmentCount * 8,
                expectedPathLength * 1e-9,
              )
          ) {
            throw new RangeError(
              "Composite sweep path wire changed its exact authored length",
            );
          }
        }
        checkContext(context);
        if (this.facade?.pipeShell === undefined) {
          result = this.raw.sweep(
            built.outerWire,
            spine,
            TransitionMode.RightCorner,
          );
        } else {
          const controlledLinearTolerance = Math.min(
            tolerance,
            OCCT_PIPE_SHELL_LINEAR_TOLERANCE,
          );
          result = adoptOcctControlledPipeShell({
            module: this.facade.module,
            kernel: this.raw.getRawKernel(),
            profileWireId: built.outerWire,
            spineWireId: spine,
            tolerance3d: controlledLinearTolerance,
            boundaryTolerance: controlledLinearTolerance,
            angularTolerance: OCCT_PIPE_SHELL_TANGENT_SINE_TOLERANCE,
            maxSurfaceError: controlledLinearTolerance,
            adopt: ({ resultId }) => resultId as ShapeHandle,
          });
        }
      } else {
        const geometry = resolvedCircularArcGeometry(path)!;
        checkContext(context);
        result = this.raw.revolve(
          built.face,
          {
            point: occtVector(geometry.center),
            direction: occtVector(geometry.normal),
          },
          geometry.sweep,
        );
      }

      checkContext(context);
      const expectedFaces = segmentCount * curveCount + 2;

      const validateResult = (): number => {
        if (
          result === undefined ||
          this.raw.isNull(result) ||
          this.raw.getShapeType(result) !== "solid" ||
          !this.raw.isValid(result)
        ) {
          throw new RangeError("Sweep did not produce one valid solid");
        }
        if (
          this.raw.subShapeCount(result, "solid") !== 1 ||
          this.raw.subShapeCount(result, "shell") !== 1
        ) {
          throw new RangeError("Sweep did not produce exactly one solid and shell");
        }
        if (this.raw.subShapeCount(result, "face") !== expectedFaces) {
          throw new RangeError(
            "Sweep changed the profile-segment face correspondence",
          );
        }
        if (
          path.kind === "circularArc" &&
          (this.raw.subShapeCount(result, "edge") !== curveCount * 3 ||
            this.raw.subShapeCount(result, "vertex") !== curveCount * 2)
        ) {
          throw new RangeError(
            "Sweep changed the circular-arc profile topology correspondence",
          );
        }
        const solids = this.raw.getSubShapes(result, "solid");
        try {
          if (
            solids.length !== 1 ||
            !this.isPureSingleSolidShape(result, solids[0]!)
          ) {
            throw new RangeError(
              "Sweep produced loose topology outside its result solid",
            );
          }
        } finally {
          this.releaseHandles(solids);
        }
        const volume = this.raw.getVolume(result);
        if (!Number.isFinite(volume) || !(Math.abs(volume) > minimumVolume)) {
          throw new RangeError("Sweep did not produce a positive-volume solid");
        }
        return volume;
      };

      let volume = validateResult();
      if (volume < 0) {
        const reversed = this.raw.reverseShape(result);
        this.raw.release(result);
        result = reversed;
        volume = validateResult();
      }
      if (!(volume > minimumVolume)) {
        throw new RangeError("Sweep did not produce a positive-volume solid");
      }
      if (
        nativeVolumePostcondition !== undefined &&
        Math.abs(volume - nativeVolumePostcondition.expected) >
          nativeVolumePostcondition.allowance
      ) {
        throw new RangeError(nativeVolumePostcondition.message);
      }
      return this.own(result, context, {
        annotation: this.sweepTopologyAnnotation(
          built.curves,
          built.face,
          path,
          result,
          context,
        ),
        ...(exactVolume === undefined ? {} : { volumeOverride: exactVolume }),
      });
    } catch (error) {
      if (result !== undefined) this.raw.release(result);
      throw error;
    } finally {
      this.releaseHandles(pathAllocated);
      this.releaseHandles(built.allocated);
    }
  }

  boolean(
    operation: "union" | "subtract" | "intersect",
    target: KernelShape,
    tools: readonly KernelShape[],
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (tools.length === 0) {
      throw new RangeError("Boolean operations require at least one tool shape");
    }
    const targetShape = this.shape(target);
    const toolShapes = tools.map((tool) => this.shape(tool));
    if (this.facade?.boolean !== undefined) {
      return this.booleanWithExactEvolution(
        this.facade.boolean,
        operation,
        targetShape,
        toolShapes,
        context,
      );
    }
    const targetHandle = targetShape[OCCT_SHAPE];
    const toolHandles = toolShapes.map((tool) => tool[OCCT_SHAPE]);
    const inherited = uniqueLineage([
      ...targetShape.lineage,
      ...toolShapes.flatMap((tool) => tool.lineage),
    ]);
    if (operation === "subtract") {
      return this.own(this.raw.cutAll(targetHandle, toolHandles), context, {
        inherited,
        relation: "modified",
        history: "partial",
      });
    }
    let current = targetHandle;
    let ownsCurrent = false;
    try {
      for (const tool of toolHandles) {
        checkContext(context);
        const next =
          operation === "union"
            ? this.raw.fuse(current, tool)
            : this.raw.common(current, tool);
        if (ownsCurrent) this.raw.release(current);
        current = next;
        ownsCurrent = true;
      }
      return this.own(current, context, {
        inherited,
        relation: "modified",
        history: "partial",
      });
    } catch (error) {
      if (ownsCurrent) this.raw.release(current);
      throw error;
    }
  }

  private booleanWithExactEvolution(
    module: OcctBooleanFacadeModule,
    operation: "union" | "subtract" | "intersect",
    target: OcctShape,
    tools: readonly OcctShape[],
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const inputs = [target, ...tools];
    const inputSnapshots = inputs.map((input) => {
      checkContext(context);
      return this.topology(input);
    });
    const inputHandles = inputs.map((input) => input[OCCT_SHAPE]);
    const inherited = uniqueLineage(inputs.flatMap((input) => input.lineage));
    const rawKernel = this.raw.getRawKernel();
    try {
      return adoptOcctBoolean({
        module,
        kernel: rawKernel,
        operation,
        targetId: inputHandles[0]!,
        toolIds: inputHandles.slice(1),
        maxHistoryRecords: this.maxExactBooleanHistoryRecords,
        validate: (report: OcctBooleanReportSnapshot) => {
          checkContext(context);
          report.evolution.inputCounts.forEach((declared, index) => {
            this.assertTopologyCounts(
              declared,
              this.rawTopologyCounts(inputHandles[index]!),
              `boolean inputCounts[${index}]`,
            );
          });
        },
        adopt: ({ resultId, report }) => {
          checkContext(context);
          const provisional = this.own(resultId as ShapeHandle, context, {
            inherited,
            relation: "modified",
            history: inputSnapshots.every(
              (snapshot) => snapshot.history === "complete",
            )
              ? "complete"
              : "partial",
          });
          try {
            const outputSnapshot = this.topology(provisional);
            this.assertTopologyCounts(
              report.evolution.resultCounts,
              this.rawTopologyCounts(provisional[OCCT_SHAPE]),
              "boolean resultCounts",
            );
            provisional.topologySnapshot =
              reduceCompleteIndexedTopologyEvolution({
                evolution: report.evolution,
                inputs: inputSnapshots,
                output: outputSnapshot,
                allowCreated: true,
                ...(context?.feature === undefined
                  ? {}
                  : { feature: context.feature }),
              });
            return provisional;
          } catch (error) {
            this.abandonTransferredShape(provisional);
            throw error;
          }
        },
      });
    } catch (error) {
      if (error instanceof OcctBooleanFacadeProtocolError) {
        throw new TopologyEvolutionProtocolError(error.message);
      }
      throw error;
    }
  }

  private applyTransformOperations(
    source: ShapeHandle,
    operations: readonly ResolvedTransformOperation[],
    context?: KernelFeatureContext,
  ): ShapeHandle {
    let current = source;
    let ownsCurrent = false;
    const replace = (next: ShapeHandle): void => {
      if (ownsCurrent) this.raw.release(current);
      current = next;
      ownsCurrent = true;
    };
    try {
      for (const operation of operations) {
        checkContext(context);
        switch (operation.kind) {
          case "translate":
            replace(
              this.raw.translate(
                current,
                operation.value[0],
                operation.value[1],
                operation.value[2],
              ),
            );
            break;
          case "rotate": {
            const axes: readonly Vec3[] = [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ];
            for (let index = 0; index < 3; index += 1) {
              const angle = operation.value[index]!;
              if (Math.abs(angle) <= Number.EPSILON) continue;
              replace(
                this.raw.rotate(
                  current,
                  { point: { x: 0, y: 0, z: 0 }, direction: occtVector(axes[index]!) },
                  angle,
                ),
              );
            }
            break;
          }
          case "scale": {
            const uniformFactor = this.uniformScaleFactor(operation.value);
            if (uniformFactor !== undefined) {
              replace(
                this.raw.scale(
                  current,
                  { x: 0, y: 0, z: 0 },
                  uniformFactor,
                ),
              );
            } else {
              // BRepBuilderAPI_GTransform carries cached triangulation from its
              // input. Strip mesh/polygon caches first so a nonuniform affine
              // map cannot leave otherwise exact transformed geometry invalid.
              const cleanSource = this.raw.copy(current);
              try {
                const transformed = this.raw.generalTransform(cleanSource, [
                  operation.value[0], 0, 0, 0,
                  0, operation.value[1], 0, 0,
                  0, 0, operation.value[2], 0,
                ]);
                replace(transformed);
              } finally {
                this.raw.release(cleanSource);
              }
            }
            break;
          }
          case "mirror":
            replace(
              this.raw.mirror(
                current,
                { x: 0, y: 0, z: 0 },
                occtVector(operation.normal),
              ),
            );
            break;
        }
      }
      if (!ownsCurrent) {
        current = this.raw.copy(current);
        ownsCurrent = true;
      }
      return current;
    } catch (error) {
      if (ownsCurrent) this.raw.release(current);
      throw error;
    }
  }

  private uniformScaleFactor(value: Vec3): number | undefined {
    return Math.abs(value[0] - value[1]) <= this.modelingTolerance &&
      Math.abs(value[1] - value[2]) <= this.modelingTolerance
      ? value[0]
      : undefined;
  }

  private effectiveScaleDeterminant(value: Vec3): number {
    const uniformFactor = this.uniformScaleFactor(value);
    return uniformFactor === undefined
      ? value[0] * value[1] * value[2]
      : uniformFactor ** 3;
  }

  transform(
    shape: KernelShape,
    operations: readonly ResolvedTransformOperation[],
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const inputShape = this.shape(shape);
    const current = this.applyTransformOperations(
      inputShape[OCCT_SHAPE],
      operations,
      context,
    );
    try {
      const inputSnapshot = this.topology(inputShape);
      let annotation: TopologyAnnotation | undefined;
      if (inputSnapshot.history === "complete") {
        const seeds: TopologyLineageSeed[] = [];
        const modified: readonly KernelTopologyLineage[] =
          context?.feature === undefined
            ? []
            : [{ feature: context.feature, relation: "modified" }];
        for (const descriptor of [
          ...inputSnapshot.faces,
          ...inputSnapshot.edges,
          ...inputSnapshot.vertices,
        ]) {
          const retained = inputShape.topologyHandles.get(descriptor.key);
          if (retained === undefined) {
            throw new Error("OCCT topology snapshot lost a retained subshape handle");
          }
          const transformed = this.applyTransformOperations(
            retained.handle,
            operations,
            context,
          );
          try {
            seeds.push(
              this.topologySeedFromHandle(
                transformed,
                descriptor.topology,
                uniqueLineage([...descriptor.lineage, ...modified]),
              ),
            );
          } finally {
            this.raw.release(transformed);
          }
        }
        annotation = { seeds, requireSeedCoverage: true };
      }
      const volumeOverride =
        inputShape.volumeOverride === undefined
          ? undefined
          : operations.reduce(
              (volume, operation) =>
                operation.kind === "scale"
                  ? volume *
                    Math.abs(this.effectiveScaleDeterminant(operation.value))
                  : volume,
              inputShape.volumeOverride,
            );
      return this.own(current, context, {
        inherited: inputShape.lineage,
        relation: "modified",
        history: inputSnapshot.history,
        ...(annotation === undefined ? {} : { annotation }),
        ...(volumeOverride === undefined ? {} : { volumeOverride }),
      });
    } catch (error) {
      this.raw.release(current);
      throw error;
    }
  }

  importShape(
    data: string | ArrayBuffer | Uint8Array,
    format: KernelExchangeFormat,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    let imported: ShapeHandle;
    switch (format) {
      case "step":
        imported = this.raw.importStep(
          data instanceof Uint8Array ? arrayBufferCopy(data) : data,
        );
        break;
      case "brep":
        imported = this.raw.fromBREP(
          typeof data === "string"
            ? data
            : new TextDecoder().decode(
                data instanceof Uint8Array ? data : new Uint8Array(data),
              ),
        );
        break;
      case "brep-binary":
        imported = this.raw.fromBREPBinary(
          typeof data === "string"
            ? new TextEncoder().encode(data)
            : data instanceof Uint8Array
              ? data
              : new Uint8Array(data),
        );
        break;
    }
    return this.own(this.normalizeImportedSolidOrientation(imported), context, {
      history: "partial",
    });
  }

  exportShape(
    shape: KernelShape,
    format: KernelExchangeFormat,
    context?: KernelFeatureContext,
  ): Uint8Array {
    checkContext(context);
    const handle = this.shape(shape)[OCCT_SHAPE];
    switch (format) {
      case "step":
        return new TextEncoder().encode(this.raw.exportStep(handle));
      case "brep":
        return new TextEncoder().encode(this.raw.toBREP(handle));
      case "brep-binary":
        return this.raw.toBREPBinary(handle).slice();
    }
  }

  private topologyBounds(handle: ShapeHandle): {
    readonly min: Vec3;
    readonly max: Vec3;
  } {
    const bounds = this.raw.getBoundingBox(handle, false);
    return {
      min: [bounds.xmin, bounds.ymin, bounds.zmin],
      max: [bounds.xmax, bounds.ymax, bounds.zmax],
    };
  }

  private topologySeedFromHandle(
    handle: ShapeHandle,
    topology: "face" | "edge" | "vertex",
    lineage: readonly KernelTopologyLineage[],
  ): TopologyLineageSeed {
    if (topology === "face") {
      return {
        topology,
        geometryKind: this.raw.surfaceType(handle),
        center: vectorFromOcct(this.raw.getSurfaceCenterOfMass(handle)),
        bounds: this.topologyBounds(handle),
        measure: this.raw.getSurfaceArea(handle),
        lineage,
      };
    }
    if (topology === "edge") {
      return {
        topology,
        geometryKind: this.raw.curveType(handle),
        center: vectorFromOcct(this.raw.getLinearCenterOfMass(handle)),
        bounds: this.topologyBounds(handle),
        measure: this.raw.curveLength(handle),
        lineage,
      };
    }
    const point = vectorFromOcct(this.raw.vertexPosition(handle));
    return {
      topology,
      geometryKind: "point",
      center: point,
      bounds: { min: [...point] as Vec3, max: [...point] as Vec3 },
      measure: 0,
      lineage,
    };
  }

  private topologySeedGeometryMatches(
    first: TopologyLineageSeed,
    second: TopologyLineageSeed,
  ): boolean {
    if (
      first.topology !== second.topology ||
      first.geometryKind !== second.geometryKind
    ) {
      return false;
    }
    const measureClose = (left: number, right: number): boolean =>
      Math.abs(left - right) <=
      Math.max(
        this.modelingTolerance * 20,
        Math.max(1, Math.abs(left), Math.abs(right)) * 1e-8,
      );
    const coordinateClose = (left: number, right: number): boolean =>
      Math.abs(left - right) <=
      Math.max(
        this.modelingTolerance * 20,
        binary64Ulp(left) * 64,
        binary64Ulp(right) * 64,
      );
    return (
      measureClose(first.measure, second.measure) &&
      first.center.every((value, index) =>
        coordinateClose(value, second.center[index]!),
      ) &&
      first.bounds.min.every((value, index) =>
        coordinateClose(value, second.bounds.min[index]!),
      ) &&
      first.bounds.max.every((value, index) =>
        coordinateClose(value, second.bounds.max[index]!),
      )
    );
  }

  private topologyFaceSeedsFromShape(
    handle: ShapeHandle,
    lineage: readonly KernelTopologyLineage[],
  ): readonly TopologyLineageSeed[] {
    if (this.raw.isNull(handle)) return [];
    if (this.raw.getShapeType(handle) === "face") {
      return [this.topologySeedFromHandle(handle, "face", lineage)];
    }
    const faces = this.raw.getSubShapes(handle, "face");
    try {
      return faces.map((face) =>
        this.topologySeedFromHandle(face, "face", lineage),
      );
    } finally {
      this.releaseHandles(faces);
    }
  }

  private topologySeedMatches(
    seed: TopologyLineageSeed,
    descriptor: TopologyDescriptor,
  ): boolean {
    const geometryKind =
      descriptor.topology === "face"
        ? descriptor.surface.kind
        : descriptor.topology === "edge"
          ? descriptor.curve.kind
          : "point";
    const descriptorMeasure =
      descriptor.topology === "face"
        ? descriptor.area
        : descriptor.topology === "edge"
          ? descriptor.length
          : 0;
    const center =
      descriptor.topology === "vertex" ? descriptor.point : descriptor.center;
    const bounds =
      descriptor.topology === "vertex"
        ? {
            min: [...descriptor.point] as Vec3,
            max: [...descriptor.point] as Vec3,
          }
        : descriptor.bounds;
    return this.topologySeedGeometryMatches(seed, {
      topology: descriptor.topology,
      geometryKind,
      center,
      bounds,
      measure: descriptorMeasure,
      lineage: [],
    });
  }

  private surfaceDescriptor(face: ShapeHandle): KernelSurfaceDescriptor {
    const kind = this.raw.surfaceType(face);
    let normal: Vec3 | undefined;
    let radius: number | undefined;
    if (kind === "plane") {
      const center = this.raw.getSurfaceCenterOfMass(face);
      const uv = this.raw.uvFromPoint(face, center);
      normal = vectorFromOcct(this.raw.surfaceNormal(face, uv.u, uv.v));
    } else if (kind === "cylinder") {
      radius = this.raw.getFaceCylinderData(face)?.radius;
    }
    return {
      kind,
      ...(normal === undefined ? {} : { normal }),
      ...(radius === undefined ? {} : { radius }),
    };
  }

  private curveDescriptor(edge: ShapeHandle): KernelCurveDescriptor {
    const kind = this.raw.curveType(edge);
    let direction: Vec3 | undefined;
    let radius: number | undefined;
    if (kind === "line") {
      const parameters = this.raw.curveParameters(edge);
      direction = vectorFromOcct(
        this.raw.curveTangent(edge, (parameters.first + parameters.last) / 2),
      );
    } else if (kind === "circle") {
      if (this.raw.curveIsClosed(edge)) {
        radius = this.raw.curveLength(edge) / (Math.PI * 2);
      } else {
        const parameters = this.raw.curveParameters(edge);
        const first = vectorFromOcct(
          this.raw.curvePointAtParam(edge, parameters.first),
        );
        const middle = vectorFromOcct(
          this.raw.curvePointAtParam(
            edge,
            (parameters.first + parameters.last) / 2,
          ),
        );
        const last = vectorFromOcct(
          this.raw.curvePointAtParam(edge, parameters.last),
        );
        const side = (a: Vec3, b: Vec3): number =>
          Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const ab: Vec3 = [
          middle[0] - first[0],
          middle[1] - first[1],
          middle[2] - first[2],
        ];
        const ac: Vec3 = [
          last[0] - first[0],
          last[1] - first[1],
          last[2] - first[2],
        ];
        const cross: Vec3 = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
        const denominator = 2 * Math.hypot(...cross);
        if (denominator > Number.EPSILON) {
          radius =
            (side(first, middle) * side(middle, last) * side(last, first)) /
            denominator;
        }
      }
    }
    return {
      kind,
      ...(direction === undefined ? {} : { direction }),
      ...(radius === undefined ? {} : { radius }),
    };
  }

  topology(shape: KernelShape): KernelTopologySnapshot {
    const owned = this.shape(shape);
    if (owned.topologySnapshot !== undefined) return owned.topologySnapshot;

    const faceHandles: ShapeHandle[] = [];
    const edgeHandles: ShapeHandle[] = [];
    const vertexHandles: ShapeHandle[] = [];
    try {
      faceHandles.push(...this.raw.getSubShapes(owned[OCCT_SHAPE], "face"));
      edgeHandles.push(...this.raw.getSubShapes(owned[OCCT_SHAPE], "edge"));
      vertexHandles.push(
        ...this.raw.getSubShapes(owned[OCCT_SHAPE], "vertex"),
      );

      const faceKeys = faceHandles.map((_, index) =>
        topologyKey(this.topologyNamespace, owned.serial, "face", index),
      );
      const edgeKeys = edgeHandles.map((_, index) =>
        topologyKey(this.topologyNamespace, owned.serial, "edge", index),
      );
      const vertexKeys = vertexHandles.map((_, index) =>
        topologyKey(this.topologyNamespace, owned.serial, "vertex", index),
      );
      const faceEdges = faceHandles.map(() => new Set<KernelTopologyKey>());
      const edgeFaces = edgeHandles.map(() => new Set<KernelTopologyKey>());
      const edgeVertices = edgeHandles.map(() => new Set<KernelTopologyKey>());
      const vertexEdges = vertexHandles.map(() => new Set<KernelTopologyKey>());
      const edgeHashBuckets = new Map<number, number[]>();
      edgeHandles.forEach((edge, index) => {
        const hash = this.raw.hashCode(edge, TOPOLOGY_HASH_UPPER_BOUND);
        const bucket = edgeHashBuckets.get(hash);
        if (bucket === undefined) edgeHashBuckets.set(hash, [index]);
        else bucket.push(index);
      });
      const vertexHashBuckets = new Map<number, number[]>();
      vertexHandles.forEach((vertex, index) => {
        const hash = this.raw.hashCode(vertex, TOPOLOGY_HASH_UPPER_BOUND);
        const bucket = vertexHashBuckets.get(hash);
        if (bucket === undefined) vertexHashBuckets.set(hash, [index]);
        else bucket.push(index);
      });

      faceHandles.forEach((face, faceIndex) => {
        const nestedEdges = this.raw.getSubShapes(face, "edge");
        try {
          for (const nestedEdge of nestedEdges) {
            const hash = this.raw.hashCode(
              nestedEdge,
              TOPOLOGY_HASH_UPPER_BOUND,
            );
            const candidates = edgeHashBuckets.get(hash) ?? [];
            const edgeIndex = candidates.find((candidate) =>
              this.raw.isSame(nestedEdge, edgeHandles[candidate]!),
            );
            if (edgeIndex === undefined) {
              throw new Error("OCCT returned a face edge absent from the parent shape");
            }
            faceEdges[faceIndex]!.add(edgeKeys[edgeIndex]!);
            edgeFaces[edgeIndex]!.add(faceKeys[faceIndex]!);
          }
        } finally {
          this.releaseHandles(nestedEdges);
        }
      });

      edgeHandles.forEach((edge, edgeIndex) => {
        const nestedVertices = this.raw.getSubShapes(edge, "vertex");
        try {
          for (const nestedVertex of nestedVertices) {
            const hash = this.raw.hashCode(
              nestedVertex,
              TOPOLOGY_HASH_UPPER_BOUND,
            );
            const candidates = vertexHashBuckets.get(hash) ?? [];
            const vertexIndex = candidates.find((candidate) =>
              this.raw.isSame(nestedVertex, vertexHandles[candidate]!),
            );
            if (vertexIndex === undefined) {
              throw new Error(
                "OCCT returned an edge vertex absent from the parent shape",
              );
            }
            edgeVertices[edgeIndex]!.add(vertexKeys[vertexIndex]!);
            vertexEdges[vertexIndex]!.add(edgeKeys[edgeIndex]!);
          }
        } finally {
          this.releaseHandles(nestedVertices);
        }
      });

      const baseFaces: readonly KernelFaceDescriptor[] = faceHandles.map(
        (face, index) => ({
          topology: "face",
          key: faceKeys[index]!,
          center: vectorFromOcct(this.raw.getSurfaceCenterOfMass(face)),
          bounds: this.topologyBounds(face),
          lineage: owned.lineage,
          area: this.raw.getSurfaceArea(face),
          surface: this.surfaceDescriptor(face),
          edges: Object.freeze([...faceEdges[index]!].sort()),
        }),
      );
      const baseEdges: readonly KernelEdgeDescriptor[] = edgeHandles.map(
        (edge, index) => ({
          topology: "edge",
          key: edgeKeys[index]!,
          center: vectorFromOcct(this.raw.getLinearCenterOfMass(edge)),
          bounds: this.topologyBounds(edge),
          lineage: owned.lineage,
          length: this.raw.curveLength(edge),
          curve: this.curveDescriptor(edge),
          faces: Object.freeze([...edgeFaces[index]!].sort()),
          vertices: Object.freeze([...edgeVertices[index]!].sort()),
        }),
      );
      const baseVertices: readonly KernelVertexDescriptor[] = vertexHandles.map(
        (vertex, index) => ({
          topology: "vertex",
          key: vertexKeys[index]!,
          point: vectorFromOcct(this.raw.vertexPosition(vertex)),
          lineage: owned.lineage,
          edges: Object.freeze([...vertexEdges[index]!].sort()),
        }),
      );
      const baseDescriptors: readonly TopologyDescriptor[] = [
        ...baseFaces,
        ...baseEdges,
        ...baseVertices,
      ];
      const seededLineage = new Map<
        KernelTopologyKey,
        KernelTopologyLineage[]
      >();
      const seedMatches = new Map<KernelTopologyKey, number>();
      let annotationComplete = owned.annotation?.forcePartial !== true;
      for (const seed of owned.annotation?.seeds ?? []) {
        const matches = baseDescriptors.filter((descriptor) =>
          this.topologySeedMatches(seed, descriptor),
        );
        if (matches.length !== 1) {
          annotationComplete = false;
          continue;
        }
        seedMatches.set(
          matches[0]!.key,
          (seedMatches.get(matches[0]!.key) ?? 0) + 1,
        );
        const existing = seededLineage.get(matches[0]!.key);
        if (existing === undefined) {
          seededLineage.set(matches[0]!.key, [...seed.lineage]);
        } else {
          existing.push(...seed.lineage);
        }
      }
      const requiredSeedCoverage = owned.annotation?.requireSeedCoverage;
      if (
        requiredSeedCoverage !== undefined &&
        baseDescriptors.some(
          (descriptor) =>
            (requiredSeedCoverage === true ||
              requiredSeedCoverage.includes(descriptor.topology)) &&
            seedMatches.get(descriptor.key) !== 1,
        )
      ) {
        annotationComplete = false;
      }
      const annotate = <T extends TopologyDescriptor>(descriptor: T): T => {
        const lineage = uniqueLineage([
          ...descriptor.lineage,
          ...(owned.annotation?.classify?.(descriptor) ?? []),
          ...(seededLineage.get(descriptor.key) ?? []),
        ]);
        return { ...descriptor, lineage };
      };
      const faces = baseFaces.map(annotate);
      const edges = baseEdges.map(annotate);
      const vertices = baseVertices.map(annotate);
      const expectedRoles = owned.annotation?.expectedRoles;
      if (expectedRoles !== undefined) {
        const actual = new Map<TopologyRole, number>();
        for (const descriptor of [...faces, ...edges, ...vertices]) {
          const descriptorRoles = new Set<TopologyRole>();
          for (const lineage of descriptor.lineage) {
            if (
              lineage.feature === expectedRoles.feature &&
              lineage.role !== undefined
            ) {
              descriptorRoles.add(lineage.role);
            }
          }
          for (const role of descriptorRoles) {
            actual.set(role, (actual.get(role) ?? 0) + 1);
          }
        }
        const expected = Object.entries(expectedRoles.counts) as readonly [
          TopologyRole,
          number,
        ][];
        if (
          expected.some(([role, count]) => (actual.get(role) ?? 0) !== count) ||
          [...actual].some(
            ([role, count]) => expectedRoles.counts[role] !== count,
          )
        ) {
          annotationComplete = false;
        }
      }

      faceHandles.forEach((handle, index) => {
        owned.topologyHandles.set(faceKeys[index]!, {
          topology: "face",
          handle,
        });
      });
      edgeHandles.forEach((handle, index) => {
        owned.topologyHandles.set(edgeKeys[index]!, {
          topology: "edge",
          handle,
        });
      });
      vertexHandles.forEach((handle, index) => {
        owned.topologyHandles.set(vertexKeys[index]!, {
          topology: "vertex",
          handle,
        });
      });
      const snapshot: KernelTopologySnapshot = Object.freeze({
        history:
          owned.history === "complete" && annotationComplete
            ? "complete"
            : "partial",
        faces: Object.freeze(faces),
        edges: Object.freeze(edges),
        vertices: Object.freeze(vertices),
      });
      owned.topologySnapshot = snapshot;
      return snapshot;
    } catch (error) {
      owned.topologyHandles.clear();
      owned.topologySnapshot = undefined;
      this.releaseHandles(vertexHandles);
      this.releaseHandles(edgeHandles);
      this.releaseHandles(faceHandles);
      throw error;
    }
  }

  private rawTopologyCounts(handle: ShapeHandle): IndexedTopologyCounts {
    return {
      faces: this.raw.subShapeCount(handle, "face"),
      edges: this.raw.subShapeCount(handle, "edge"),
      vertices: this.raw.subShapeCount(handle, "vertex"),
    };
  }

  private assertTopologyCounts(
    declared: IndexedTopologyCounts,
    actual: IndexedTopologyCounts,
    label: string,
  ): void {
    for (const kind of ["faces", "edges", "vertices"] as const) {
      if (declared[kind] !== actual[kind]) {
        throw new TopologyEvolutionProtocolError(
          `${label}.${kind} declares ${declared[kind]}, but OCCT reports ${actual[kind]}`,
        );
      }
    }
  }

  /**
   * Removes a transferred wrapper after post-transfer validation fails.
   * Its retained subshape handles belong to this wrapper and are released
   * here; the root stays live so the owning exact-operation adapter can
   * release it exactly once.
   */
  private abandonTransferredShape(shape: OcctShape): void {
    let cleanupError: unknown;
    for (const retained of shape.topologyHandles.values()) {
      try {
        this.raw.release(retained.handle);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    shape.topologyHandles.clear();
    shape.topologySnapshot = undefined;
    shape.disposed = true;
    this.liveShapes.delete(shape);
    if (cleanupError !== undefined) throw cleanupError;
  }

  private draftWithExactEvolution(
    module: OcctDraftFacadeModule,
    shape: KernelShape,
    faces: readonly KernelTopologyKey[],
    options: ResolvedDraftOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    validateDraftOptions(options);
    if (!Array.isArray(faces)) {
      throw new TypeError("Draft faces must be an array");
    }
    if (faces.length === 0) {
      throw new RangeError("Draft requires at least one face");
    }

    const input = this.shape(shape);
    const inputSnapshot = this.topology(input);
    const faceIndexByKey = new Map(
      inputSnapshot.faces.map((descriptor, index) => [descriptor.key, index]),
    );
    const selectedIndices: number[] = [];
    const selected = new Set<number>();
    for (const key of faces) {
      const index = faceIndexByKey.get(key);
      const retained = input.topologyHandles.get(key);
      if (index === undefined || retained?.topology !== "face") {
        throw new TypeError(
          `Topology key '${String(key)}' is not a face of the input shape`,
        );
      }
      if (!selected.has(index)) {
        selected.add(index);
        selectedIndices.push(index);
      }
    }
    selectedIndices.sort((first, second) => first - second);
    const faceIds = selectedIndices.map((index) => {
      const descriptor = inputSnapshot.faces[index]!;
      const retained = input.topologyHandles.get(descriptor.key);
      if (retained?.topology !== "face") {
        throw new Error("OCCT topology snapshot lost a retained face handle");
      }
      return retained.handle;
    });

    const inputHandle = input[OCCT_SHAPE];
    const rawKernel = this.raw.getRawKernel();
    try {
      return adoptOcctDraft({
        module,
        kernel: rawKernel,
        shapeId: inputHandle,
        faceIds,
        angleRad: options.angle,
        pullDirection: options.pullDirection,
        neutralOrigin: options.neutralPlane.origin,
        neutralNormal: options.neutralPlane.normal,
        validate: (report: OcctDraftReportSnapshot) => {
          this.assertTopologyCounts(
            report.evolution.inputCounts[0]!,
            this.rawTopologyCounts(inputHandle),
            "draft inputCounts[0]",
          );
        },
        adopt: ({ resultId, report }) => {
          const provisional = this.own(resultId as ShapeHandle, context, {
            inherited: input.lineage,
            relation: "modified",
            history: inputSnapshot.history,
          });
          try {
            const outputSnapshot = this.topology(provisional);
            this.assertTopologyCounts(
              report.evolution.resultCounts,
              this.rawTopologyCounts(provisional[OCCT_SHAPE]),
              "draft resultCounts",
            );
            provisional.topologySnapshot = reduceIndexedTopologyEvolution({
              evolution: report.evolution,
              inputs: [inputSnapshot],
              output: outputSnapshot,
              ...(context?.feature === undefined
                ? {}
                : { feature: context.feature }),
            });
            return provisional;
          } catch (error) {
            this.abandonTransferredShape(provisional);
            throw error;
          }
        },
      });
    } catch (error) {
      if (error instanceof OcctDraftFacadeProtocolError) {
        throw new TopologyEvolutionProtocolError(error.message);
      }
      throw error;
    }
  }

  private selectedEdgeTreatmentTopology(
    input: OcctShape,
    edges: readonly KernelTopologyKey[],
  ): {
    readonly snapshot: KernelTopologySnapshot;
    readonly indices: readonly number[];
    readonly handles: readonly ShapeHandle[];
  } {
    const snapshot = this.topology(input);
    const edgeIndexByKey = new Map(
      snapshot.edges.map((descriptor, index) => [descriptor.key, index]),
    );
    const selected = new Set<number>();
    for (const key of edges) {
      const index = edgeIndexByKey.get(key);
      const retained = input.topologyHandles.get(key);
      if (index === undefined || retained?.topology !== "edge") {
        throw new TypeError(
          `Topology key '${String(key)}' is not an edge of the input shape`,
        );
      }
      selected.add(index);
    }
    const indices = [...selected].sort((first, second) => first - second);
    const handles = indices.map((index) => {
      const descriptor = snapshot.edges[index]!;
      const retained = input.topologyHandles.get(descriptor.key);
      if (retained?.topology !== "edge") {
        throw new Error("OCCT topology snapshot lost a retained edge handle");
      }
      return retained.handle;
    });
    return { snapshot, indices, handles };
  }

  private edgeTreatmentWithExactEvolution(
    module: OcctEdgeTreatmentFacadeModule,
    operation: OcctEdgeTreatmentOperation,
    input: OcctShape,
    inputSnapshot: KernelTopologySnapshot,
    selectedEdgeIndices: readonly number[],
    edgeIds: readonly ShapeHandle[],
    amount: number,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const inputHandle = input[OCCT_SHAPE];
    const rawKernel = this.raw.getRawKernel();
    try {
      return adoptOcctEdgeTreatment({
        module,
        kernel: rawKernel,
        operation,
        inputId: inputHandle,
        edgeIds,
        selectedEdgeIndices,
        amount,
        maxHistoryRecords: this.maxExactEdgeTreatmentHistoryRecords,
        validate: (report: OcctEdgeTreatmentReportSnapshot) => {
          checkContext(context);
          this.assertTopologyCounts(
            report.evolution.inputCounts[0]!,
            this.rawTopologyCounts(inputHandle),
            `${operation} inputCounts[0]`,
          );
        },
        adopt: ({ resultId, report }) => {
          checkContext(context);
          const provisional = this.own(resultId as ShapeHandle, context, {
            inherited: input.lineage,
            relation: "modified",
            history: inputSnapshot.history,
          });
          try {
            const outputSnapshot = this.topology(provisional);
            this.assertTopologyCounts(
              report.evolution.resultCounts,
              this.rawTopologyCounts(provisional[OCCT_SHAPE]),
              `${operation} resultCounts`,
            );
            provisional.topologySnapshot =
              reduceCompleteIndexedTopologyEvolution({
                evolution: report.evolution,
                inputs: [inputSnapshot],
                output: outputSnapshot,
                allowCreated: true,
                ...(context?.feature === undefined
                  ? {}
                  : {
                      feature: context.feature,
                      generatedTopologyRoles: [
                        {
                          producer: operation,
                          source: "edge" as const,
                          result: "face" as const,
                          role:
                            operation === "fillet"
                              ? ("fillet.face.blend" as const)
                              : ("chamfer.face.bevel" as const),
                        },
                      ],
                    }),
              });
            return provisional;
          } catch (error) {
            this.abandonTransferredShape(provisional);
            throw error;
          }
        },
      });
    } catch (error) {
      if (error instanceof OcctEdgeTreatmentFacadeProtocolError) {
        throw new TopologyEvolutionProtocolError(error.message);
      }
      throw error;
    }
  }

  fillet(
    shape: KernelShape,
    edges: readonly KernelTopologyKey[],
    options: { readonly radius: number },
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (!Number.isFinite(options.radius) || !(options.radius > 0)) {
      throw new RangeError("Fillet radius must be finite and positive");
    }
    if (edges.length === 0) throw new RangeError("Fillet requires at least one edge");
    const input = this.shape(shape);
    const selected = this.selectedEdgeTreatmentTopology(input, edges);
    if (this.facade?.edgeTreatment !== undefined) {
      return this.edgeTreatmentWithExactEvolution(
        this.facade.edgeTreatment,
        "fillet",
        input,
        selected.snapshot,
        selected.indices,
        selected.handles,
        options.radius,
        context,
      );
    }
    const faceHashes = this.raw.subShapeHashes(
      input[OCCT_SHAPE],
      "face",
      TOPOLOGY_HASH_UPPER_BOUND,
    );
    const module = this.raw.getRawModule();
    const rawKernel = this.raw.getRawKernel();
    return adoptOcctEdgeEvolution({
      module,
      kernel: rawKernel,
      edgeIds: selected.handles,
      inputFaceHashes: faceHashes,
      invoke: (edgeIds, inputHashes) =>
        rawKernel.filletWithHistory(
          input[OCCT_SHAPE],
          edgeIds as Parameters<typeof rawKernel.filletWithHistory>[1],
          options.radius,
          inputHashes as Parameters<typeof rawKernel.filletWithHistory>[3],
          TOPOLOGY_HASH_UPPER_BOUND,
        ),
      adopt: (evolution) =>
        this.own(evolution.resultId as ShapeHandle, context, {
          inherited: input.lineage,
          relation: "modified",
          history: "partial",
        }),
    });
  }

  chamfer(
    shape: KernelShape,
    edges: readonly KernelTopologyKey[],
    options: { readonly distance: number },
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (!Number.isFinite(options.distance) || !(options.distance > 0)) {
      throw new RangeError("Chamfer distance must be finite and positive");
    }
    if (edges.length === 0) {
      throw new RangeError("Chamfer requires at least one edge");
    }
    const input = this.shape(shape);
    const selected = this.selectedEdgeTreatmentTopology(input, edges);
    if (this.facade?.edgeTreatment !== undefined) {
      return this.edgeTreatmentWithExactEvolution(
        this.facade.edgeTreatment,
        "chamfer",
        input,
        selected.snapshot,
        selected.indices,
        selected.handles,
        options.distance,
        context,
      );
    }
    const faceHashes = this.raw.subShapeHashes(
      input[OCCT_SHAPE],
      "face",
      TOPOLOGY_HASH_UPPER_BOUND,
    );
    const module = this.raw.getRawModule();
    const rawKernel = this.raw.getRawKernel();
    return adoptOcctEdgeEvolution({
      module,
      kernel: rawKernel,
      edgeIds: selected.handles,
      inputFaceHashes: faceHashes,
      invoke: (edgeIds, inputHashes) =>
        rawKernel.chamferWithHistory(
          input[OCCT_SHAPE],
          edgeIds as Parameters<typeof rawKernel.chamferWithHistory>[1],
          options.distance,
          inputHashes as Parameters<typeof rawKernel.chamferWithHistory>[3],
          TOPOLOGY_HASH_UPPER_BOUND,
        ),
      adopt: (evolution) =>
        this.own(evolution.resultId as ShapeHandle, context, {
          inherited: input.lineage,
          relation: "modified",
          history: "partial",
        }),
    });
  }

  private selectedShellOpeningTopology(
    input: OcctShape,
    openings: readonly KernelTopologyKey[],
  ): {
    readonly snapshot: KernelTopologySnapshot;
    readonly indices: readonly number[];
    readonly handles: readonly ShapeHandle[];
  } {
    const snapshot = this.topology(input);
    const faceIndexByKey = new Map(
      snapshot.faces.map((descriptor, index) => [descriptor.key, index]),
    );
    const selected = new Set<number>();
    for (const key of openings) {
      const index = faceIndexByKey.get(key);
      const retained = input.topologyHandles.get(key);
      if (index === undefined || retained?.topology !== "face") {
        throw new TypeError(
          `Topology key '${String(key)}' is not a face of the input shape`,
        );
      }
      selected.add(index);
    }
    const indices = [...selected].sort((first, second) => first - second);
    const handles = indices.map((index) => {
      const descriptor = snapshot.faces[index]!;
      const retained = input.topologyHandles.get(descriptor.key);
      if (retained?.topology !== "face") {
        throw new Error("OCCT topology snapshot lost a retained face handle");
      }
      return retained.handle;
    });
    return { snapshot, indices, handles };
  }

  private assertExactSolidOffsetResult(
    result: ShapeHandle,
    operation: "shell" | "offset",
    direction: "inward" | "outward",
    inputVolume: number,
    tolerance: number,
  ): void {
    const label = operation === "shell" ? "Shell" : "Offset";
    const volumeTolerance = Math.max(
      tolerance ** 3,
      inputVolume * 1e-12,
      Number.EPSILON,
    );
    if (this.raw.isNull(result) || !this.raw.isValid(result)) {
      throw new RangeError(`${label} produced an invalid solid`);
    }
    const resultVolume = this.raw.getVolume(result);
    const resultSolids = this.raw.getSubShapes(result, "solid");
    try {
      if (resultSolids.length !== 1) {
        throw new RangeError(`${label} did not produce exactly one solid`);
      }
      if (!this.isPureSingleSolidShape(result, resultSolids[0]!)) {
        throw new RangeError(
          `${label} produced loose topology outside its result solid`,
        );
      }
      for (const topology of ["face", "edge", "vertex"] as const) {
        if (
          this.raw.subShapeCount(result, topology) !==
          this.raw.subShapeCount(resultSolids[0]!, topology)
        ) {
          throw new RangeError(
            `${label} produced loose topology outside its result solid`,
          );
        }
      }
    } finally {
      this.releaseHandles(resultSolids);
    }
    if (
      !Number.isFinite(resultVolume) ||
      !(resultVolume > volumeTolerance)
    ) {
      throw new RangeError(
        operation === "shell"
          ? "Shell did not produce a positive-volume solid"
          : "Offset did not produce a positive-volume solid",
      );
    }
    if (
      operation === "shell" &&
      direction === "inward" &&
      !(resultVolume < inputVolume - volumeTolerance)
    ) {
      throw new RangeError("Shell thickness did not produce a hollowed solid");
    }
    if (
      operation === "offset" &&
      direction === "outward" &&
      !(resultVolume > inputVolume + volumeTolerance)
    ) {
      throw new RangeError("Outward offset did not increase solid volume");
    }
    if (
      operation === "offset" &&
      direction === "inward" &&
      !(resultVolume < inputVolume - volumeTolerance)
    ) {
      throw new RangeError("Inward offset did not decrease solid volume");
    }
  }

  private solidOffsetWithExactEvolution(
    module: OcctSolidOffsetFacadeModule,
    operation: "shell" | "offset",
    input: OcctShape,
    inputSnapshot: KernelTopologySnapshot,
    selectedOpeningFaceIndices: readonly number[],
    openingFaceIds: readonly ShapeHandle[],
    amount: number,
    direction: "inward" | "outward",
    tolerance: number,
    inputVolume: number,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const inputHandle = input[OCCT_SHAPE];
    const rawKernel = this.raw.getRawKernel();
    try {
      return adoptOcctSolidOffset({
        module,
        kernel: rawKernel,
        operation,
        inputId: inputHandle,
        openingFaceIds,
        selectedOpeningFaceIndices,
        amount,
        direction,
        tolerance,
        maxHistoryRecords: this.maxExactSolidOffsetHistoryRecords,
        validate: (report: OcctSolidOffsetReportSnapshot) => {
          checkContext(context);
          this.assertTopologyCounts(
            report.evolution.inputCounts[0]!,
            this.rawTopologyCounts(inputHandle),
            `${operation} inputCounts[0]`,
          );
        },
        adopt: ({ resultId, report }) => {
          checkContext(context);
          const provisional = this.own(resultId as ShapeHandle, context, {
            inherited: input.lineage,
            relation: "modified",
            history: inputSnapshot.history,
          });
          try {
            this.assertExactSolidOffsetResult(
              provisional[OCCT_SHAPE],
              operation,
              direction,
              inputVolume,
              tolerance,
            );
            const outputSnapshot = this.topology(provisional);
            this.assertTopologyCounts(
              report.evolution.resultCounts,
              this.rawTopologyCounts(provisional[OCCT_SHAPE]),
              `${operation} resultCounts`,
            );
            provisional.topologySnapshot =
              reduceCompleteIndexedTopologyEvolution({
                evolution: report.evolution,
                inputs: [inputSnapshot],
                output: outputSnapshot,
                allowCreated: true,
                ...(context?.feature === undefined
                  ? {}
                  : { feature: context.feature }),
              });
            return provisional;
          } catch (error) {
            this.abandonTransferredShape(provisional);
            throw error;
          }
        },
      });
    } catch (error) {
      if (error instanceof OcctSolidOffsetFacadeProtocolError) {
        throw new TopologyEvolutionProtocolError(error.message);
      }
      throw error;
    }
  }

  shell(
    shape: KernelShape,
    openings: readonly KernelTopologyKey[],
    options: ResolvedShellOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (!Number.isFinite(options.thickness) || !(options.thickness > 0)) {
      throw new RangeError("Shell thickness must be finite and positive");
    }
    if (openings.length === 0) {
      throw new RangeError("Shell requires at least one opening face");
    }
    if (options.direction !== "inward" && options.direction !== "outward") {
      throw new TypeError("Shell direction must be 'inward' or 'outward'");
    }
    if (!Number.isFinite(options.tolerance) || !(options.tolerance > 0)) {
      throw new RangeError("Shell tolerance must be finite and positive");
    }
    if (!(options.tolerance < options.thickness)) {
      throw new RangeError("Shell tolerance must be less than its thickness");
    }
    const input = this.shape(shape);
    const inputSolids = this.raw.getSubShapes(input[OCCT_SHAPE], "solid");
    if (inputSolids.length !== 1) {
      this.releaseHandles(inputSolids);
      throw new TypeError("Shell input must contain exactly one solid");
    }
    const inputSolid = inputSolids[0]!;
    try {
      if (
        !this.raw.isValid(input[OCCT_SHAPE]) ||
        !this.raw.isValid(inputSolid)
      ) {
        throw new TypeError("Shell input must be a valid solid");
      }
      if (!this.isPureSingleSolidShape(input[OCCT_SHAPE], inputSolid)) {
        throw new TypeError(
          "Shell input must not contain loose topology outside its solid",
        );
      }
      for (const topology of ["face", "edge", "vertex"] as const) {
        if (
          this.raw.subShapeCount(input[OCCT_SHAPE], topology) !==
          this.raw.subShapeCount(inputSolid, topology)
        ) {
          throw new TypeError(
            "Shell input must not contain loose topology outside its solid",
          );
        }
      }
      const signedInputVolume = this.raw.getVolume(inputSolid);
      const inputVolume = Math.abs(signedInputVolume);
      if (
        !Number.isFinite(inputVolume) ||
        !(inputVolume > Math.max(options.tolerance ** 3, Number.EPSILON))
      ) {
        throw new TypeError("Shell input must have positive finite volume");
      }
      if (this.facade?.solidOffset !== undefined) {
        const selected = this.selectedShellOpeningTopology(input, openings);
        if (selected.indices.length >= selected.snapshot.faces.length) {
          throw new RangeError("Shell requires at least one retained face");
        }
        return this.solidOffsetWithExactEvolution(
          this.facade.solidOffset,
          "shell",
          input,
          selected.snapshot,
          selected.indices,
          selected.handles,
          options.thickness,
          options.direction,
          options.tolerance,
          inputVolume,
          context,
        );
      }
      const snapshot = this.topology(input);
      const uniqueOpenings = [...new Set(openings)];
      const handles = uniqueOpenings.map((key) => {
        const retained = input.topologyHandles.get(key);
        if (retained?.topology !== "face") {
          throw new TypeError(
            `Topology key '${key}' is not a face of the input shape`,
          );
        }
        return retained.handle;
      });
      if (handles.length >= snapshot.faces.length) {
        throw new RangeError("Shell requires at least one retained face");
      }
      const signedThickness =
        options.direction === "inward"
          ? options.thickness
          : -options.thickness;
      let normalizedInput: ShapeHandle | undefined;
      let result: ShapeHandle;
      try {
        if (signedInputVolume < 0) {
          normalizedInput = this.raw.reverseShape(inputSolid);
        }
        result = this.raw.shell(
          normalizedInput ?? inputSolid,
          handles,
          signedThickness,
          options.tolerance,
        );
      } finally {
        if (normalizedInput !== undefined) this.raw.release(normalizedInput);
      }
      try {
        const removalTolerance = Math.max(
          options.tolerance ** 3,
          inputVolume * 1e-12,
        );
        if (!this.raw.isValid(result)) {
          throw new RangeError("Shell produced an invalid solid");
        }
        let resultVolume = this.raw.getVolume(result);
        if (resultVolume < -removalTolerance) {
          const reversed = this.raw.reverseShape(result);
          this.raw.release(result);
          result = reversed;
          if (!this.raw.isValid(result)) {
            throw new RangeError("Shell produced an invalid solid");
          }
          resultVolume = this.raw.getVolume(result);
        }
        const resultSolids = this.raw.getSubShapes(result, "solid");
        try {
          if (resultSolids.length !== 1) {
            throw new RangeError("Shell did not produce exactly one solid");
          }
          if (!this.isPureSingleSolidShape(result, resultSolids[0]!)) {
            throw new RangeError(
              "Shell produced loose topology outside its result solid",
            );
          }
          for (const topology of ["face", "edge", "vertex"] as const) {
            if (
              this.raw.subShapeCount(result, topology) !==
              this.raw.subShapeCount(resultSolids[0]!, topology)
            ) {
              throw new RangeError(
                "Shell produced loose topology outside its result solid",
              );
            }
          }
        } finally {
          this.releaseHandles(resultSolids);
        }
        if (
          !Number.isFinite(resultVolume) ||
          !(resultVolume > removalTolerance)
        ) {
          throw new RangeError("Shell did not produce a positive-volume solid");
        }
        if (
          options.direction === "inward" &&
          !(resultVolume < inputVolume - removalTolerance)
        ) {
          throw new RangeError(
            "Shell thickness did not produce a hollowed solid",
          );
        }
        return this.own(result, context, {
          inherited: input.lineage,
          relation: "modified",
          history: "partial",
        });
      } catch (error) {
        this.raw.release(result);
        throw error;
      }
    } finally {
      this.releaseHandles(inputSolids);
    }
  }

  offset(
    shape: KernelShape,
    options: ResolvedOffsetOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (!Number.isFinite(options.distance) || !(options.distance > 0)) {
      throw new RangeError("Offset distance must be finite and positive");
    }
    if (options.direction !== "outward" && options.direction !== "inward") {
      throw new TypeError("Offset direction must be 'outward' or 'inward'");
    }
    if (!Number.isFinite(options.tolerance) || !(options.tolerance > 0)) {
      throw new RangeError("Offset tolerance must be finite and positive");
    }
    if (!(options.tolerance < options.distance)) {
      throw new RangeError("Offset tolerance must be less than its distance");
    }

    const input = this.shape(shape);
    const inputSolids = this.raw.getSubShapes(input[OCCT_SHAPE], "solid");
    if (inputSolids.length !== 1) {
      this.releaseHandles(inputSolids);
      throw new TypeError("Offset input must contain exactly one solid");
    }
    const inputSolid = inputSolids[0]!;
    try {
      if (
        !this.raw.isValid(input[OCCT_SHAPE]) ||
        !this.raw.isValid(inputSolid)
      ) {
        throw new TypeError("Offset input must be a valid solid");
      }
      if (!this.isPureSingleSolidShape(input[OCCT_SHAPE], inputSolid)) {
        throw new TypeError(
          "Offset input must not contain loose topology outside its solid",
        );
      }
      for (const topology of ["face", "edge", "vertex"] as const) {
        if (
          this.raw.subShapeCount(input[OCCT_SHAPE], topology) !==
          this.raw.subShapeCount(inputSolid, topology)
        ) {
          throw new TypeError(
            "Offset input must not contain loose topology outside its solid",
          );
        }
      }

      const signedInputVolume = this.raw.getVolume(inputSolid);
      const inputVolume = Math.abs(signedInputVolume);
      const volumeTolerance = Math.max(
        options.tolerance ** 3,
        inputVolume * 1e-12,
        Number.EPSILON,
      );
      if (!Number.isFinite(inputVolume) || !(inputVolume > volumeTolerance)) {
        throw new TypeError("Offset input must have positive finite volume");
      }

      if (this.facade?.solidOffset !== undefined) {
        return this.solidOffsetWithExactEvolution(
          this.facade.solidOffset,
          "offset",
          input,
          this.topology(input),
          [],
          [],
          options.distance,
          options.direction,
          options.tolerance,
          inputVolume,
          context,
        );
      }

      const signedDistance =
        options.direction === "outward"
          ? options.distance
          : -options.distance;
      let normalizedInput: ShapeHandle | undefined;
      let result: ShapeHandle;
      try {
        if (signedInputVolume < 0) {
          normalizedInput = this.raw.reverseShape(inputSolid);
        }
        result = this.raw.offset(
          normalizedInput ?? inputSolid,
          signedDistance,
          options.tolerance,
        );
      } finally {
        if (normalizedInput !== undefined) this.raw.release(normalizedInput);
      }

      try {
        if (this.raw.isNull(result) || !this.raw.isValid(result)) {
          throw new RangeError("Offset produced an invalid solid");
        }
        const resultVolume = this.raw.getVolume(result);

        const resultSolids = this.raw.getSubShapes(result, "solid");
        try {
          if (resultSolids.length !== 1) {
            throw new RangeError("Offset did not produce exactly one solid");
          }
          if (!this.isPureSingleSolidShape(result, resultSolids[0]!)) {
            throw new RangeError(
              "Offset produced loose topology outside its result solid",
            );
          }
          for (const topology of ["face", "edge", "vertex"] as const) {
            if (
              this.raw.subShapeCount(result, topology) !==
              this.raw.subShapeCount(resultSolids[0]!, topology)
            ) {
              throw new RangeError(
                "Offset produced loose topology outside its result solid",
              );
            }
          }
        } finally {
          this.releaseHandles(resultSolids);
        }
        if (
          !Number.isFinite(resultVolume) ||
          !(resultVolume > volumeTolerance)
        ) {
          throw new RangeError("Offset did not produce a positive-volume solid");
        }
        if (
          options.direction === "outward" &&
          !(resultVolume > inputVolume + volumeTolerance)
        ) {
          throw new RangeError("Outward offset did not increase solid volume");
        }
        if (
          options.direction === "inward" &&
          !(resultVolume < inputVolume - volumeTolerance)
        ) {
          throw new RangeError("Inward offset did not decrease solid volume");
        }
        return this.own(result, context, {
          inherited: input.lineage,
          relation: "modified",
          history: "partial",
        });
      } catch (error) {
        this.raw.release(result);
        throw error;
      }
    } finally {
      this.releaseHandles(inputSolids);
    }
  }

  mesh(shape: KernelShape, options: MeshOptions = {}): MeshData {
    const handle = this.shape(shape)[OCCT_SHAPE];
    const merged = { ...this.tessellation, ...options };
    const mesh = this.raw.tessellate(handle, {
      ...(merged.linearDeflection === undefined
        ? {}
        : { linearDeflection: merged.linearDeflection }),
      ...(merged.angularDeflection === undefined
        ? {}
        : { angularDeflection: merged.angularDeflection }),
      ...(merged.relative === undefined ? {} : { relative: merged.relative }),
    });
    return {
      positions: mesh.positions.slice(),
      indices: mesh.indices.slice(),
    };
  }

  measure(shape: KernelShape): ShapeMeasurements {
    const owned = this.shape(shape);
    const handle = owned[OCCT_SHAPE];
    const vertices = this.raw.subShapeCount(handle, "vertex");
    const edges = this.raw.subShapeCount(handle, "edge");
    const faces = this.raw.subShapeCount(handle, "face");
    if (vertices === 0 && edges === 0 && faces === 0) {
      return {
        volume: 0,
        surfaceArea: 0,
        centerOfMass: null,
        inertiaTensor: zeroMassProperties().inertiaTensor,
        boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
        genus: 0,
        tolerance: this.modelingTolerance,
      };
    }
    const bounds = this.raw.getBoundingBox(handle, false);
    const solids = this.raw.getSubShapes(handle, "solid");
    let nativeMassProperties = zeroMassProperties();
    try {
      const components: GeometricMassProperties[] = [];
      for (const solid of solids) {
        const solidBounds = this.raw.getBoundingBox(solid, false);
        const reference: Vec3 = [
          solidBounds.xmin / 2 + solidBounds.xmax / 2,
          solidBounds.ymin / 2 + solidBounds.ymax / 2,
          solidBounds.zmin / 2 + solidBounds.zmax / 2,
        ];
        if (!reference.every(Number.isFinite)) {
          throw new RangeError("OCCT returned non-finite solid bounds");
        }
        const centered = this.raw.translate(
          solid,
          -reference[0],
          -reference[1],
          -reference[2],
        );
        try {
          const signedVolume = this.raw.getVolume(centered);
          if (!Number.isFinite(signedVolume) || signedVolume === 0) {
            throw new RangeError("OCCT returned a zero or non-finite solid volume");
          }
          const orientation = signedVolume < 0 ? -1 : 1;
          const center = this.raw.getCenterOfMass(centered);
          const inertia = this.raw
            .getInertia(centered)
            .map((value) => orientation * value);
          const centerOfMass: Vec3 = [
            center.x + reference[0],
            center.y + reference[1],
            center.z + reference[2],
          ];
          if (!centerOfMass.every(Number.isFinite)) {
            throw new RangeError("OCCT returned a non-finite center of mass");
          }
          components.push({
            volume: orientation * signedVolume,
            centerOfMass,
            inertiaTensor: inertiaTensorFromRowMajor(inertia),
          });
        } finally {
          this.raw.release(centered);
        }
      }
      nativeMassProperties = combineMassProperties(components);
    } finally {
      this.releaseHandles(solids);
    }
    const massProperties =
      owned.volumeOverride === undefined
        ? nativeMassProperties
        : rescaleMassProperties(nativeMassProperties, owned.volumeOverride);
    const eulerCharacteristic = vertices - edges + faces;
    return {
      volume: massProperties.volume,
      surfaceArea: this.raw.getSurfaceArea(handle),
      centerOfMass: massProperties.centerOfMass,
      inertiaTensor: massProperties.inertiaTensor,
      boundingBox: {
        min: [bounds.xmin, bounds.ymin, bounds.zmin],
        max: [bounds.xmax, bounds.ymax, bounds.zmax],
      },
      genus: Math.max(0, Math.round((2 - eulerCharacteristic) / 2)),
      tolerance: this.modelingTolerance,
    };
  }

  status(shape: KernelShape): KernelShapeStatus {
    try {
      const handle = this.shape(shape)[OCCT_SHAPE];
      if (this.raw.isNull(handle)) {
        return {
          ok: false,
          code: "NULL_SHAPE",
          message: "OpenCascade produced a null shape",
        };
      }
      const valid = this.raw.isValid(handle);
      return valid
        ? { ok: true, code: "VALID" }
        : {
            ok: false,
            code: "INVALID_SHAPE",
            message: "OpenCascade shape validation failed",
          };
    } catch (error) {
      return {
        ok: false,
        code: "STATUS_ERROR",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  disposeShape(shape: KernelShape): void {
    if (!(shape instanceof OcctShape) || !this.ownedShapes.has(shape)) {
      throw new TypeError("Expected an OCCT kernel shape owned by this kernel");
    }
    if (shape.disposed) return;
    this.assertKernelLive();
    const cleanupErrors: unknown[] = [];
    for (const retained of shape.topologyHandles.values()) {
      try {
        this.raw.release(retained.handle);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    shape.topologyHandles.clear();
    shape.topologySnapshot = undefined;
    try {
      this.raw.release(shape[OCCT_SHAPE]);
    } catch (error) {
      cleanupErrors.push(error);
    }
    shape.disposed = true;
    this.liveShapes.delete(shape);
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length > 1) {
      throw new AggregateError(
        cleanupErrors,
        "OCCT shape disposal encountered multiple release failures",
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    for (const shape of [...this.liveShapes]) this.disposeShape(shape);
    this.raw[Symbol.dispose]();
    this.disposed = true;
  }
}

export async function createOcctKernel(
  options: OcctKernelOptions = {},
): Promise<GeometryKernel> {
  const maxExactBooleanHistoryRecords = exactBooleanHistoryRecordLimit(
    options.maxExactBooleanHistoryRecords,
  );
  const maxExactEdgeTreatmentHistoryRecords =
    exactEdgeTreatmentHistoryRecordLimit(
      options.maxExactEdgeTreatmentHistoryRecords,
    );
  const maxExactSolidOffsetHistoryRecords =
    exactSolidOffsetHistoryRecordLimit(
      options.maxExactSolidOffsetHistoryRecords,
    );
  const [{ OcctKernel: RawKernel }, createModule] = await Promise.all([
    import("occt-wasm"),
    options.moduleFactory === undefined
      ? import("occt-wasm/dist/occt-wasm.js").then(
          ({ default: stockFactory }) => stockFactory as OcctModuleFactory,
        )
      : Promise.resolve(options.moduleFactory),
  ]);
  const moduleOptions: {
    wasmBinary?: ArrayBuffer;
    locateFile?: (path: string) => string;
    print: (message: string) => void;
    printErr?: (message: string) => void;
  } = {
    print: options.onOutput ?? (() => {}),
    ...(options.onError === undefined ? {} : { printErr: options.onError }),
  };
  if (options.wasm instanceof ArrayBuffer) {
    moduleOptions.wasmBinary = options.wasm;
  } else if (options.wasm instanceof Uint8Array) {
    moduleOptions.wasmBinary = arrayBufferCopy(options.wasm);
  } else if (options.wasm !== undefined) {
    const location =
      options.wasm instanceof URL ? options.wasm.href : options.wasm;
    moduleOptions.locateFile = (path) =>
      path.endsWith(".wasm") ? location : path;
  }
  const module = await createModule(moduleOptions);
  const facade = probeOcctFacade(module);
  const KernelConstructor = RawKernel as unknown as new (
    module: unknown,
  ) => RawOcctKernel;
  const raw = new KernelConstructor(module);
  try {
    return new OcctKernel(
      raw,
      facade,
      options,
      maxExactBooleanHistoryRecords,
      maxExactEdgeTreatmentHistoryRecords,
      maxExactSolidOffsetHistoryRecords,
    );
  } catch (error) {
    raw[Symbol.dispose]();
    throw error;
  }
}
