import type { Vec3 } from "./core/math.js";
import { canonicalStringify, deepFreeze } from "./core/json.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type DiagnosticCode,
} from "./core/result.js";
import {
  KernelTopologySnapshotCopyLimitError,
  isKernelTopologySnapshotCopyLimitError,
  normalizeKernelTopologySnapshot,
} from "./internal/topology-snapshot.js";
import { pluralTopologyKind } from "./internal/topology-language.js";
import {
  TOPOLOGY_ROLE_RULES,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelVertexDescriptor,
  type KernelTopologyBounds,
  type KernelTopologyKey,
  type KernelTopologyLineage,
  type KernelTopologySignatureCapabilities,
  type KernelTopologySignatureCapabilitiesV1,
  type KernelTopologySignatureCapabilitiesV2,
  type KernelTopologySnapshot,
  type TopologyKind,
  type TopologyKindV1,
  type TopologyRole,
  type TopologyRoleV2,
  type TopologyRoleV3,
  type TopologyRoleV4,
  type TopologyRoleV5,
  type TopologyRoleV6,
} from "./protocol/topology.js";

export const TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1 = 1 as const;
export const TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2 = 2 as const;
/** Protocol emitted by current capture operations. */
export const TOPOLOGY_SIGNATURE_PROTOCOL_VERSION =
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2;
export const TOPOLOGY_REFERENCE_EXPLANATION_VERSION = 1 as const;

type LegacyTopologyKind = TopologyKindV1;
type TopologySignatureProtocolVersion =
  | typeof TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1
  | typeof TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2;

export interface TopologySignatureLimits {
  readonly maxTopologyItems: number;
  readonly maxAdjacencyLinks: number;
  readonly maxEvidenceRecords: number;
  /** Stored registry variants inspected across one persistent-selection operation. */
  readonly maxReferenceVariants: number;
  readonly maxCandidatePairs: number;
  readonly maxMatchingSteps: number;
}

export const DEFAULT_TOPOLOGY_SIGNATURE_LIMITS: TopologySignatureLimits =
  Object.freeze({
    maxTopologyItems: 100_000,
    maxAdjacencyLinks: 1_000_000,
    maxEvidenceRecords: 1_000_000,
    maxReferenceVariants: 20_000,
    maxCandidatePairs: 1_000_000,
    maxMatchingSteps: 10_000_000,
  });

export interface TopologyMatchTolerance {
  /** Absolute tolerance for coordinates, bounds, lengths, and radii. */
  readonly linear: number;
  /** Angular tolerance in radians. Face normals are oriented. */
  readonly angular: number;
  /** Relative tolerance for measures and radii, never world coordinates. */
  readonly relative: number;
}

interface TopologyGeometrySignatureBase<K extends TopologyKind> {
  readonly topology: K;
  readonly kind: string;
  /** Surface area for a face, curve length for an edge. */
  readonly measure: number;
  readonly center: Vec3;
  readonly bounds: KernelTopologyBounds;
  readonly radius?: number;
  readonly axis?: Vec3;
}

export interface TopologyFaceGeometrySignature
  extends TopologyGeometrySignatureBase<"face"> {
  readonly normal?: Vec3;
}

export interface TopologyEdgeGeometrySignature
  extends TopologyGeometrySignatureBase<"edge"> {
  readonly direction?: Vec3;
}

/** Protocol-v2 point evidence for one exact B-Rep vertex. */
export interface TopologyVertexGeometrySignature {
  readonly topology: "vertex";
  readonly point: Vec3;
}

export type TopologyGeometrySignature<
  K extends TopologyKind = TopologyKind,
> = K extends "face"
  ? TopologyFaceGeometrySignature
  : K extends "edge"
    ? TopologyEdgeGeometrySignature
    : TopologyVertexGeometrySignature;

/** Persisted lineage with a document-version-specific semantic-role grammar. */
export type PersistentTopologyLineage<
  R extends TopologyRole = TopologyRole,
> = Omit<KernelTopologyLineage, "role"> & {
  readonly role?: R;
};

export interface TopologyNeighborSignatureProtocolV1<
  R extends TopologyRole = TopologyRole,
> {
  readonly topology: LegacyTopologyKind;
  readonly lineage: readonly PersistentTopologyLineage<R>[];
  readonly geometry: TopologyGeometrySignature<LegacyTopologyKind>;
}

export interface TopologyNeighborSignatureProtocolV2<
  R extends TopologyRole = TopologyRole,
> {
  readonly topology: TopologyKind;
  readonly lineage: readonly PersistentTopologyLineage<R>[];
  readonly geometry: TopologyGeometrySignature;
}

/** Current neighbor evidence accepts both supported wire protocols. */
export type TopologyNeighborSignature<
  R extends TopologyRole = TopologyRole,
> =
  | TopologyNeighborSignatureProtocolV1<R>
  | TopologyNeighborSignatureProtocolV2<R>;

/**
 * Detached topology evidence that can be stored between evaluations.
 *
 * It intentionally contains no kernel topology key, native index, array
 * ordinal, or enumeration-derived discriminator. A symmetric item therefore
 * remains ambiguous instead of receiving an invented persistent identity.
 */
interface PersistentTopologyReferenceBase<
  K extends TopologyKind,
  R extends TopologyRole = TopologyRole,
> {
  readonly kernelFingerprint: string;
  readonly topology: K;
  readonly capturedHistory: KernelTopologySnapshot["history"];
  readonly tolerance: TopologyMatchTolerance;
  readonly lineage: readonly PersistentTopologyLineage<R>[];
  readonly geometry: TopologyGeometrySignature<K>;
}

interface PersistentTopologyReferenceProtocolV1Shape<
  K extends LegacyTopologyKind,
  R extends TopologyRole = TopologyRole,
> extends PersistentTopologyReferenceBase<K, R> {
  readonly protocolVersion: typeof TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1;
  readonly adjacency: readonly TopologyNeighborSignatureProtocolV1<R>[];
}

export type PersistentTopologyReferenceProtocolV1<
  K extends LegacyTopologyKind = LegacyTopologyKind,
  R extends TopologyRole = TopologyRole,
> = PersistentTopologyReferenceProtocolV1Shape<K, R>;

interface PersistentTopologyReferenceProtocolV2Shape<
  K extends TopologyKind,
  R extends TopologyRole = TopologyRole,
> extends PersistentTopologyReferenceBase<K, R> {
  readonly protocolVersion: typeof TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2;
  readonly adjacency: readonly TopologyNeighborSignatureProtocolV2<R>[];
}

export type PersistentTopologyReferenceProtocolV2<
  K extends TopologyKind = TopologyKind,
  R extends TopologyRole = TopologyRole,
> = PersistentTopologyReferenceProtocolV2Shape<K, R>;

/** Every reference understood by the current runtime. */
export type PersistentTopologyReference<
  K extends TopologyKind = TopologyKind,
  R extends TopologyRole = TopologyRole,
> =
  | PersistentTopologyReferenceProtocolV1<K & LegacyTopologyKind, R>
  | PersistentTopologyReferenceProtocolV2<K, R>;

export type PersistentTopologyLineageV2 =
  PersistentTopologyLineage<TopologyRoleV2>;
export type PersistentTopologyLineageV3 =
  PersistentTopologyLineage<TopologyRoleV3>;
export type PersistentTopologyLineageV4 =
  PersistentTopologyLineage<TopologyRoleV4>;
export type PersistentTopologyLineageV5 =
  PersistentTopologyLineage<TopologyRoleV5>;
export type PersistentTopologyLineageV6 =
  PersistentTopologyLineage<TopologyRoleV6>;
export type TopologyNeighborSignatureV2 =
  TopologyNeighborSignatureProtocolV1<TopologyRoleV2>;
export type TopologyNeighborSignatureV3 =
  TopologyNeighborSignatureProtocolV1<TopologyRoleV3>;
export type TopologyNeighborSignatureV4 =
  TopologyNeighborSignatureProtocolV1<TopologyRoleV4>;
export type TopologyNeighborSignatureV5 =
  TopologyNeighborSignatureProtocolV1<TopologyRoleV5>;
export type TopologyNeighborSignatureV6 =
  TopologyNeighborSignature<TopologyRoleV6>;
export type PersistentTopologyReferenceV2<
  K extends LegacyTopologyKind = LegacyTopologyKind,
> = PersistentTopologyReferenceProtocolV1<K, TopologyRoleV2>;
export type PersistentTopologyReferenceV3<
  K extends LegacyTopologyKind = LegacyTopologyKind,
> = PersistentTopologyReferenceProtocolV1<K, TopologyRoleV3>;
export type PersistentTopologyReferenceV4<
  K extends LegacyTopologyKind = LegacyTopologyKind,
> = PersistentTopologyReferenceProtocolV1<K, TopologyRoleV4>;
export type PersistentTopologyReferenceV5<
  K extends LegacyTopologyKind = LegacyTopologyKind,
> = PersistentTopologyReferenceProtocolV1<K, TopologyRoleV5>;

/** Document-v6 evidence; its role vocabulary currently equals document v5. */
export type PersistentTopologyReferenceV6<
  K extends TopologyKind = TopologyKind,
> = PersistentTopologyReference<K, TopologyRoleV6>;

export type TopologyMatchEvidence =
  | "semantic-lineage"
  | "geometry-adjacency";

export interface ResolvedTopologyReference {
  /** Evaluation-scoped key for the current snapshot only. */
  readonly key: KernelTopologyKey;
  readonly evidence: TopologyMatchEvidence;
}

export interface TopologyReferenceStrategySummary {
  /** Current candidates evaluated through this matching strategy. */
  readonly considered: number;
  /** Candidates accepted through this matching strategy. */
  readonly matched: number;
}

export interface TopologyReferenceResolutionExplanationBase<
  K extends TopologyKind = TopologyKind,
> {
  readonly version: typeof TOPOLOGY_REFERENCE_EXPLANATION_VERSION;
  readonly topology: K;
  readonly capturedHistory: KernelTopologySnapshot["history"];
  readonly currentHistory: KernelTopologySnapshot["history"];
  /** Number of unique semantic anchors carried by the stored item. */
  readonly capturedSemanticAnchors: number;
  readonly candidatesConsidered: number;
  readonly candidatesMatched: number;
  readonly strategies: Readonly<
    Record<TopologyMatchEvidence, TopologyReferenceStrategySummary>
  >;
}

/**
 * Detached aggregate explanation for one completed reference search.
 *
 * Only a resolved explanation exposes a current evaluation-scoped key.
 * Missing and ambiguous explanations contain counts, never candidate keys,
 * native indices, array ordinals, or enumeration-derived samples.
 */
export type TopologyReferenceResolutionExplanation<
  K extends TopologyKind = TopologyKind,
> =
  | (TopologyReferenceResolutionExplanationBase<K> & {
      readonly outcome: "resolved";
      /** Evaluation-scoped key for the current snapshot only. */
      readonly key: KernelTopologyKey;
      readonly evidence: TopologyMatchEvidence;
    })
  | (TopologyReferenceResolutionExplanationBase<K> & {
      readonly outcome: "missing";
    })
  | (TopologyReferenceResolutionExplanationBase<K> & {
      readonly outcome: "ambiguous";
    });

export interface CaptureTopologyReferenceOptions {
  readonly capabilities: KernelTopologySignatureCapabilities;
  readonly tolerance: TopologyMatchTolerance;
  readonly limits?: Partial<TopologySignatureLimits>;
}

export interface ResolveTopologyReferenceOptions {
  readonly capabilities: KernelTopologySignatureCapabilities;
  readonly limits?: Partial<TopologySignatureLimits>;
}

export interface NormalizePersistentTopologyReferenceOptions {
  readonly limits?: Partial<TopologySignatureLimits>;
}

/**
 * Operation-local resolver for one immutable topology snapshot. The snapshot,
 * candidate signatures, matching compiler, and work budget are shared by
 * every call to `resolve`.
 */
export interface TopologyReferenceResolutionSession {
  readonly snapshot: KernelTopologySnapshot;
  resolve<K extends TopologyKind>(
    reference: PersistentTopologyReference<K>,
  ): CadResult<ResolvedTopologyReference>;
}

/** Operation-local resolution session with cached aggregate explanations. */
export interface ExplainableTopologyReferenceResolutionSession
  extends TopologyReferenceResolutionSession {
  explain<K extends TopologyKind>(
    reference: PersistentTopologyReference<K>,
  ): CadResult<TopologyReferenceResolutionExplanation<K>>;
}

type TopologyDescriptor =
  | KernelFaceDescriptor
  | KernelEdgeDescriptor
  | KernelVertexDescriptor;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function vector(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component, index) =>
        Object.hasOwn(value, index) &&
        typeof component === "number" &&
        Number.isFinite(component),
    )
  );
}

function immutableVector(value: Vec3): Vec3 {
  return Object.freeze(
    value.map((component) => (Object.is(component, -0) ? 0 : component)),
  ) as unknown as Vec3;
}

function immutableBounds(bounds: KernelTopologyBounds): KernelTopologyBounds {
  return Object.freeze({
    min: immutableVector(bounds.min),
    max: immutableVector(bounds.max),
  });
}

function canonicalLineage<R extends TopologyRole>(
  lineage: readonly PersistentTopologyLineage<R>[],
): readonly PersistentTopologyLineage<R>[] {
  const unique = new Map<string, PersistentTopologyLineage<R>>();
  for (const item of lineage) {
    const copied: PersistentTopologyLineage<R> = {
      feature: item.feature,
      relation: item.relation,
      ...(item.role === undefined ? {} : { role: item.role }),
      ...(item.source === undefined
        ? {}
        : {
            source: Object.freeze({
              kind: "sketch-entity" as const,
              sketch: item.source.sketch,
              entity: item.source.entity,
            }),
          }),
    };
    unique.set(canonicalStringify(copied), Object.freeze(copied));
  }
  return Object.freeze(
    [...unique.entries()]
      .sort(([first], [second]) => lexicalCompare(first, second))
      .map(([, item]) => item),
  );
}

function faceGeometry(
  descriptor: KernelFaceDescriptor,
): TopologyFaceGeometrySignature {
  return Object.freeze({
    topology: "face" as const,
    kind: descriptor.surface.kind,
    measure: Object.is(descriptor.area, -0) ? 0 : descriptor.area,
    center: immutableVector(descriptor.center),
    bounds: immutableBounds(descriptor.bounds),
    ...(descriptor.surface.normal === undefined
      ? {}
      : { normal: immutableVector(descriptor.surface.normal) }),
    ...(descriptor.surface.axis === undefined
      ? {}
      : { axis: immutableVector(descriptor.surface.axis) }),
    ...(descriptor.surface.radius === undefined
      ? {}
      : {
          radius: Object.is(descriptor.surface.radius, -0)
            ? 0
            : descriptor.surface.radius,
        }),
  });
}

function edgeGeometry(
  descriptor: KernelEdgeDescriptor,
): TopologyEdgeGeometrySignature {
  return Object.freeze({
    topology: "edge" as const,
    kind: descriptor.curve.kind,
    measure: Object.is(descriptor.length, -0) ? 0 : descriptor.length,
    center: immutableVector(descriptor.center),
    bounds: immutableBounds(descriptor.bounds),
    ...(descriptor.curve.direction === undefined
      ? {}
      : { direction: immutableVector(descriptor.curve.direction) }),
    ...(descriptor.curve.axis === undefined
      ? {}
      : { axis: immutableVector(descriptor.curve.axis) }),
    ...(descriptor.curve.radius === undefined
      ? {}
      : {
          radius: Object.is(descriptor.curve.radius, -0)
            ? 0
            : descriptor.curve.radius,
        }),
  });
}

function vertexGeometry(
  descriptor: KernelVertexDescriptor,
): TopologyVertexGeometrySignature {
  return Object.freeze({
    topology: "vertex" as const,
    point: immutableVector(descriptor.point),
  });
}

function geometrySignature(
  descriptor: TopologyDescriptor,
): TopologyGeometrySignature {
  switch (descriptor.topology) {
    case "face":
      return faceGeometry(descriptor);
    case "edge":
      return edgeGeometry(descriptor);
    case "vertex":
      return vertexGeometry(descriptor);
  }
}

function canonicalGeometrySignature<K extends TopologyKind>(
  geometry: TopologyGeometrySignature<K>,
): TopologyGeometrySignature<K> {
  if (geometry.topology === "vertex") {
    return Object.freeze({
      topology: "vertex",
      point: immutableVector(
        (geometry as TopologyVertexGeometrySignature).point,
      ),
    }) as TopologyGeometrySignature<K>;
  }
  const measured = geometry as
    | TopologyFaceGeometrySignature
    | TopologyEdgeGeometrySignature;
  const directional =
    measured.topology === "face"
      ? measured.normal
      : measured.direction;
  return Object.freeze({
    topology: measured.topology,
    kind: measured.kind,
    measure: Object.is(measured.measure, -0) ? 0 : measured.measure,
    center: immutableVector(measured.center),
    bounds: immutableBounds(measured.bounds),
    ...(directional === undefined
      ? {}
      : measured.topology === "face"
        ? { normal: immutableVector(directional) }
        : { direction: immutableVector(directional) }),
    ...(measured.axis === undefined
      ? {}
      : { axis: immutableVector(measured.axis) }),
    ...(measured.radius === undefined
      ? {}
      : {
          radius: Object.is(measured.radius, -0) ? 0 : measured.radius,
        }),
  }) as TopologyGeometrySignature<K>;
}

function canonicalPersistentTopologyReference<
  K extends TopologyKind,
  R extends TopologyRole,
>(
  reference: PersistentTopologyReference<K, R>,
): PersistentTopologyReference<K, R> {
  const adjacency = reference.adjacency
    .map((neighbor) => {
      const signature = Object.freeze({
        topology: neighbor.topology,
        lineage: canonicalLineage(neighbor.lineage),
        geometry: canonicalGeometrySignature(neighbor.geometry),
      });
      return Object.freeze({
        signature,
        sortKey: canonicalStringify(signature),
      });
    })
    .sort((first, second) => lexicalCompare(first.sortKey, second.sortKey))
    .map((entry) => entry.signature);
  return deepFreeze({
    protocolVersion: reference.protocolVersion,
    kernelFingerprint: reference.kernelFingerprint,
    topology: reference.topology,
    capturedHistory: reference.capturedHistory,
    tolerance: {
      linear: Object.is(reference.tolerance.linear, -0)
        ? 0
        : reference.tolerance.linear,
      angular: Object.is(reference.tolerance.angular, -0)
        ? 0
        : reference.tolerance.angular,
      relative: Object.is(reference.tolerance.relative, -0)
        ? 0
        : reference.tolerance.relative,
    },
    lineage: canonicalLineage(reference.lineage),
    geometry: canonicalGeometrySignature(reference.geometry),
    adjacency,
  }) as unknown as PersistentTopologyReference<K, R>;
}

interface DescriptorSignatureContext {
  readonly snapshot: KernelTopologySnapshot;
  readonly capabilities: KernelTopologySignatureCapabilities;
  readonly tolerance: TopologyMatchTolerance;
  readonly faces: ReadonlyMap<KernelTopologyKey, KernelFaceDescriptor>;
  readonly edges: ReadonlyMap<KernelTopologyKey, KernelEdgeDescriptor>;
  readonly vertices: ReadonlyMap<KernelTopologyKey, KernelVertexDescriptor>;
  readonly neighbors: Map<
    KernelTopologyKey,
    {
      readonly signature: TopologyNeighborSignature;
      readonly sortKey: string;
    }
  >;
  readonly references: Map<
    KernelTopologyKey,
    PersistentTopologyReference
  >;
}

function descriptorSignatureContext(
  snapshot: KernelTopologySnapshot,
  capabilities: KernelTopologySignatureCapabilities,
  tolerance: TopologyMatchTolerance,
): DescriptorSignatureContext {
  return {
    snapshot,
    capabilities,
    tolerance,
    faces: new Map(snapshot.faces.map((descriptor) => [descriptor.key, descriptor])),
    edges: new Map(snapshot.edges.map((descriptor) => [descriptor.key, descriptor])),
    vertices: new Map(
      snapshot.vertices.map((descriptor) => [descriptor.key, descriptor]),
    ),
    neighbors: new Map(),
    references: new Map(),
  };
}

function compiledNeighborSignature(
  descriptor: TopologyDescriptor,
  context: DescriptorSignatureContext,
): {
  readonly signature: TopologyNeighborSignature;
  readonly sortKey: string;
} {
  const cached = context.neighbors.get(descriptor.key);
  if (cached !== undefined) return cached;
  const signature = Object.freeze({
    topology: descriptor.topology,
    lineage: canonicalLineage(descriptor.lineage),
    geometry: geometrySignature(descriptor),
  });
  const compiled = Object.freeze({
    signature,
    sortKey: canonicalStringify(signature),
  });
  context.neighbors.set(descriptor.key, compiled);
  return compiled;
}

function referenceForDescriptor(
  descriptor: TopologyDescriptor,
  context: DescriptorSignatureContext,
): PersistentTopologyReference {
  const cached = context.references.get(descriptor.key);
  if (cached !== undefined) {
    return cached;
  }
  const adjacentDescriptors: readonly TopologyDescriptor[] =
    descriptor.topology === "face"
      ? descriptor.edges.map((key) => context.edges.get(key)!)
      : descriptor.topology === "vertex"
        ? descriptor.edges.map((key) => context.edges.get(key)!)
        : context.capabilities.protocolVersion ===
            TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1
          ? descriptor.faces.map((key) => context.faces.get(key)!)
          : [
              ...descriptor.faces.map((key) => context.faces.get(key)!),
              ...descriptor.vertices.map((key) => context.vertices.get(key)!),
            ];
  const adjacent = adjacentDescriptors
    .map((neighbor) => compiledNeighborSignature(neighbor, context))
    .sort((first, second) => lexicalCompare(first.sortKey, second.sortKey))
    .map((compiled) => compiled.signature);
  const reference = deepFreeze({
    protocolVersion: context.capabilities.protocolVersion,
    kernelFingerprint: context.capabilities.fingerprint,
    topology: descriptor.topology,
    capturedHistory: context.snapshot.history,
    tolerance: {
      linear: context.tolerance.linear,
      angular: context.tolerance.angular,
      relative: context.tolerance.relative,
    },
    lineage: canonicalLineage(descriptor.lineage),
    geometry: geometrySignature(descriptor),
    adjacency: adjacent,
  }) as unknown as PersistentTopologyReference;
  context.references.set(descriptor.key, reference);
  return reference;
}

function normalizeTolerance(
  value: unknown,
): TopologyMatchTolerance | undefined {
  if (!isRecord(value) || !exactKeys(value, ["linear", "angular", "relative"])) {
    return undefined;
  }
  const linear = value.linear;
  const angular = value.angular;
  const relative = value.relative;
  if (
    typeof linear !== "number" ||
    !Number.isFinite(linear) ||
    linear < 0 ||
    typeof angular !== "number" ||
    !Number.isFinite(angular) ||
    angular < 0 ||
    angular > Math.PI ||
    typeof relative !== "number" ||
    !Number.isFinite(relative) ||
    relative < 0 ||
    relative > 1
  ) {
    return undefined;
  }
  return Object.freeze({
    linear: Object.is(linear, -0) ? 0 : linear,
    angular: Object.is(angular, -0) ? 0 : angular,
    relative: Object.is(relative, -0) ? 0 : relative,
  });
}

function toleranceIsValid(value: unknown): value is TopologyMatchTolerance {
  return normalizeTolerance(value) !== undefined;
}

function normalizeCapabilities(
  value: unknown,
): KernelTopologySignatureCapabilities | undefined {
  if (!isRecord(value) || !exactKeys(value, ["protocolVersion", "fingerprint"])) {
    return undefined;
  }
  const protocolVersion = value.protocolVersion;
  const fingerprint = value.fingerprint;
  if (
    (protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1 &&
      protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2) ||
    typeof fingerprint !== "string" ||
    fingerprint.length === 0
  ) {
    return undefined;
  }
  return Object.freeze({ protocolVersion, fingerprint });
}

interface NormalizedCaptureOptions {
  readonly capabilities: KernelTopologySignatureCapabilities;
  readonly tolerance: TopologyMatchTolerance;
  readonly limits: TopologySignatureLimits;
}

interface NormalizedResolveOptions {
  readonly capabilities: KernelTopologySignatureCapabilities;
  readonly limits: TopologySignatureLimits;
}

const LIMIT_KEYS = Object.freeze([
  "maxTopologyItems",
  "maxAdjacencyLinks",
  "maxEvidenceRecords",
  "maxReferenceVariants",
  "maxCandidatePairs",
  "maxMatchingSteps",
] as const satisfies readonly (keyof TopologySignatureLimits)[]);

function normalizeLimits(value: unknown): TopologySignatureLimits | undefined {
  if (value === undefined) return DEFAULT_TOPOLOGY_SIGNATURE_LIMITS;
  if (!isRecord(value)) return undefined;
  const actual = Object.keys(value);
  if (actual.some((key) => !LIMIT_KEYS.includes(key as keyof TopologySignatureLimits))) {
    return undefined;
  }
  const normalized: Record<keyof TopologySignatureLimits, number> = {
    ...DEFAULT_TOPOLOGY_SIGNATURE_LIMITS,
  };
  for (const key of LIMIT_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const candidate = value[key];
    if (
      typeof candidate !== "number" ||
      !Number.isSafeInteger(candidate) ||
      candidate < 0
    ) {
      return undefined;
    }
    normalized[key] = candidate;
  }
  return Object.freeze(normalized);
}

function normalizeCaptureOptions(
  value: unknown,
): NormalizedCaptureOptions | undefined {
  if (!isRecord(value)) return undefined;
  const allowed = ["capabilities", "tolerance"];
  const hasLimits = Object.hasOwn(value, "limits");
  if (hasLimits) allowed.push("limits");
  if (!exactKeys(value, allowed)) return undefined;
  const capabilities = normalizeCapabilities(value.capabilities);
  const tolerance = normalizeTolerance(value.tolerance);
  const rawLimits = hasLimits ? value.limits : undefined;
  if (hasLimits && rawLimits === undefined) return undefined;
  const limits = normalizeLimits(rawLimits);
  return capabilities === undefined || tolerance === undefined || limits === undefined
    ? undefined
    : Object.freeze({ capabilities, tolerance, limits });
}

function normalizeResolveOptions(
  value: unknown,
): NormalizedResolveOptions | undefined {
  if (!isRecord(value)) return undefined;
  const allowed = ["capabilities"];
  const hasLimits = Object.hasOwn(value, "limits");
  if (hasLimits) allowed.push("limits");
  if (!exactKeys(value, allowed)) return undefined;
  const capabilities = normalizeCapabilities(value.capabilities);
  const rawLimits = hasLimits ? value.limits : undefined;
  if (hasLimits && rawLimits === undefined) return undefined;
  const limits = normalizeLimits(rawLimits);
  return capabilities === undefined || limits === undefined
    ? undefined
    : Object.freeze({ capabilities, limits });
}

function normalizePersistentReferenceOptions(
  value: unknown,
): TopologySignatureLimits | undefined {
  if (!isRecord(value)) return undefined;
  const hasLimits = Object.hasOwn(value, "limits");
  if (!exactKeys(value, hasLimits ? ["limits"] : [])) return undefined;
  const rawLimits = hasLimits ? value.limits : undefined;
  if (hasLimits && rawLimits === undefined) return undefined;
  return normalizeLimits(rawLimits);
}

const topologySignatureLimitErrors = new WeakSet<object>();

class TopologySignatureLimitError extends Error {
  readonly resource: keyof TopologySignatureLimits;
  readonly limit: number;
  readonly actual: number;

  constructor(
    resource: keyof TopologySignatureLimits,
    limit: number,
    actual: number,
  ) {
    super(`Topology-signature ${resource} limit ${limit} was exceeded by ${actual}`);
    this.name = "TopologySignatureLimitError";
    this.resource = resource;
    this.limit = limit;
    this.actual = actual;
    topologySignatureLimitErrors.add(this);
  }
}

function isTopologySignatureLimitError(
  value: unknown,
): value is TopologySignatureLimitError {
  return (
    typeof value === "object" &&
    value !== null &&
    topologySignatureLimitErrors.has(value)
  );
}

function enforceLimit(
  limits: TopologySignatureLimits,
  resource: keyof TopologySignatureLimits,
  actual: number,
): void {
  const limit = limits[resource];
  if (actual > limit) {
    throw new TopologySignatureLimitError(resource, limit, actual);
  }
}

class MatchingWorkBudget {
  private candidatePairs = 0;
  private matchingSteps = 0;
  readonly limits: TopologySignatureLimits;

  constructor(limits: TopologySignatureLimits) {
    this.limits = limits;
  }

  candidatePair(count = 1): void {
    this.candidatePairs += count;
    enforceLimit(this.limits, "maxCandidatePairs", this.candidatePairs);
  }

  matchingStep(count = 1): void {
    this.matchingSteps += count;
    enforceLimit(this.limits, "maxMatchingSteps", this.matchingSteps);
  }
}

function lineageIsValid(value: unknown, topology: TopologyKind): boolean {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
    const item = value[index];
    if (!isRecord(item)) return false;
    const allowed = ["feature", "relation"];
    if (item.role !== undefined) allowed.push("role");
    if (item.source !== undefined) allowed.push("source");
    if (!exactKeys(item, allowed)) return false;
    if (
      typeof item.feature !== "string" ||
      item.feature.length === 0 ||
      (item.relation !== "created" && item.relation !== "modified")
    ) {
      return false;
    }
    if (item.role !== undefined) {
      if (typeof item.role !== "string") return false;
      const rule = TOPOLOGY_ROLE_RULES[item.role as TopologyRole] as
        | (typeof TOPOLOGY_ROLE_RULES)[TopologyRole]
        | undefined;
      if (
        rule === undefined ||
        rule.topology !== topology ||
        rule.relation !== item.relation ||
        (item.source !== undefined && rule.source !== "sketch-curve")
      ) {
        return false;
      }
    }
    if (item.source !== undefined) {
      if (
        !isRecord(item.source) ||
        !exactKeys(item.source, ["kind", "sketch", "entity"]) ||
        item.relation !== "created" ||
        item.source.kind !== "sketch-entity" ||
        typeof item.source.sketch !== "string" ||
        item.source.sketch.length === 0 ||
        typeof item.source.entity !== "string" ||
        item.source.entity.length === 0
      ) {
        return false;
      }
    }
  }
  return true;
}

function geometryIsValid(value: unknown, topology: TopologyKind): boolean {
  if (!isRecord(value) || value.topology !== topology) return false;
  if (topology === "vertex") {
    return exactKeys(value, ["topology", "point"]) && vector(value.point);
  }
  const optional = topology === "face" ? "normal" : "direction";
  const allowed = ["topology", "kind", "measure", "center", "bounds"];
  if (value[optional] !== undefined) allowed.push(optional);
  if (value.axis !== undefined) allowed.push("axis");
  if (value.radius !== undefined) allowed.push("radius");
  if (!exactKeys(value, allowed)) return false;
  if (
    typeof value.kind !== "string" ||
    value.kind.length === 0 ||
    typeof value.measure !== "number" ||
    !Number.isFinite(value.measure) ||
    value.measure < 0 ||
    !vector(value.center) ||
    !isRecord(value.bounds) ||
    !exactKeys(value.bounds, ["min", "max"]) ||
    !vector(value.bounds.min) ||
    !vector(value.bounds.max) ||
    value.bounds.min.some(
      (minimum, index) => minimum > (value.bounds as KernelTopologyBounds).max[index]!,
    )
  ) {
    return false;
  }
  for (const direction of [value[optional], value.axis]) {
    if (
      direction !== undefined &&
      (!vector(direction) || normalizedAngularVector(direction) === undefined)
    ) {
      return false;
    }
  }
  return (
    value.radius === undefined ||
    (typeof value.radius === "number" &&
      Number.isFinite(value.radius) &&
      value.radius >= 0)
  );
}

function adjacentTopologyIsValid(
  protocolVersion: TopologySignatureProtocolVersion,
  topology: TopologyKind,
  adjacent: unknown,
): adjacent is TopologyKind {
  if (protocolVersion === TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1) {
    return topology === "face" ? adjacent === "edge" : adjacent === "face";
  }
  switch (topology) {
    case "face":
    case "vertex":
      return adjacent === "edge";
    case "edge":
      return adjacent === "face" || adjacent === "vertex";
  }
}

function referenceIsValid(
  value: unknown,
): value is PersistentTopologyReference {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "protocolVersion",
      "kernelFingerprint",
      "topology",
      "capturedHistory",
      "tolerance",
      "lineage",
      "geometry",
      "adjacency",
    ]) ||
    (value.protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1 &&
      value.protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2) ||
    typeof value.kernelFingerprint !== "string" ||
    value.kernelFingerprint.length === 0 ||
    (value.topology !== "face" &&
      value.topology !== "edge" &&
      value.topology !== "vertex") ||
    (value.protocolVersion === TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1 &&
      value.topology === "vertex") ||
    (value.capturedHistory !== "complete" &&
      value.capturedHistory !== "partial") ||
    !toleranceIsValid(value.tolerance) ||
    !lineageIsValid(value.lineage, value.topology) ||
    !geometryIsValid(value.geometry, value.topology) ||
    !Array.isArray(value.adjacency)
  ) {
    return false;
  }
  for (let index = 0; index < value.adjacency.length; index += 1) {
    if (!Object.hasOwn(value.adjacency, index)) return false;
    const neighbor = value.adjacency[index];
    if (
      !isRecord(neighbor) ||
      !exactKeys(neighbor, ["topology", "lineage", "geometry"]) ||
      !adjacentTopologyIsValid(
        value.protocolVersion,
        value.topology,
        neighbor.topology,
      ) ||
      !lineageIsValid(neighbor.lineage, neighbor.topology) ||
      !geometryIsValid(neighbor.geometry, neighbor.topology)
    ) {
      return false;
    }
  }
  return true;
}

function referenceCopyFailure(): never {
  throw new TypeError("Persistent topology reference is malformed or unsupported");
}

interface ReferenceCopyResources {
  readonly limits: TopologySignatureLimits;
  evidenceRecords: number;
}

function referenceArray(
  value: unknown,
): { readonly value: readonly unknown[]; readonly length: number } {
  if (!Array.isArray(value)) return referenceCopyFailure();
  const length = value.length;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > 0xffff_ffff
  ) {
    return referenceCopyFailure();
  }
  return { value, length };
}

function copyReferenceVector(value: unknown): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Object.hasOwn(value, 0) ||
    !Object.hasOwn(value, 1) ||
    !Object.hasOwn(value, 2)
  ) {
    return referenceCopyFailure();
  }
  const first = value[0];
  const second = value[1];
  const third = value[2];
  return Object.freeze([first, second, third]) as unknown as Vec3;
}

function copyReferenceBounds(value: unknown): KernelTopologyBounds {
  if (!isRecord(value) || !exactKeys(value, ["min", "max"])) {
    return referenceCopyFailure();
  }
  const minimum = value.min;
  const maximum = value.max;
  return Object.freeze({
    min: copyReferenceVector(minimum),
    max: copyReferenceVector(maximum),
  });
}

function copyReferenceLineage(
  value: unknown,
  resources: ReferenceCopyResources,
): readonly KernelTopologyLineage[] {
  const copiedArray = referenceArray(value);
  const { length } = copiedArray;
  const array = copiedArray.value;
  resources.evidenceRecords += length;
  enforceLimit(
    resources.limits,
    "maxEvidenceRecords",
    resources.evidenceRecords,
  );
  const copied: KernelTopologyLineage[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(array, index)) return referenceCopyFailure();
    const raw = array[index];
    if (!isRecord(raw)) return referenceCopyFailure();
    const actual = Object.keys(raw);
    const hasRole = actual.includes("role");
    const hasSource = actual.includes("source");
    const expected = ["feature", "relation"];
    if (hasRole) expected.push("role");
    if (hasSource) expected.push("source");
    if (!exactKeys(raw, expected)) return referenceCopyFailure();
    const feature = raw.feature;
    const relation = raw.relation;
    const role = hasRole ? raw.role : undefined;
    let source: unknown;
    if (hasSource) {
      const rawSource = raw.source;
      if (
        !isRecord(rawSource) ||
        !exactKeys(rawSource, ["kind", "sketch", "entity"])
      ) {
        return referenceCopyFailure();
      }
      const kind = rawSource.kind;
      const sketch = rawSource.sketch;
      const entity = rawSource.entity;
      source = Object.freeze({ kind, sketch, entity });
    }
    copied.push(
      Object.freeze({
        feature,
        relation,
        ...(hasRole ? { role } : {}),
        ...(hasSource ? { source } : {}),
      }) as unknown as KernelTopologyLineage,
    );
  }
  return Object.freeze(copied);
}

function copyReferenceGeometry(
  value: unknown,
  topology: TopologyKind,
): TopologyGeometrySignature {
  if (!isRecord(value)) return referenceCopyFailure();
  if (topology === "vertex") {
    if (!exactKeys(value, ["topology", "point"])) {
      return referenceCopyFailure();
    }
    return Object.freeze({
      topology: value.topology,
      point: copyReferenceVector(value.point),
    }) as unknown as TopologyVertexGeometrySignature;
  }
  const directional = topology === "face" ? "normal" : "direction";
  const actual = Object.keys(value);
  const expected = ["topology", "kind", "measure", "center", "bounds"];
  const hasDirectional = actual.includes(directional);
  const hasAxis = actual.includes("axis");
  const hasRadius = actual.includes("radius");
  if (hasDirectional) expected.push(directional);
  if (hasAxis) expected.push("axis");
  if (hasRadius) expected.push("radius");
  if (!exactKeys(value, expected)) return referenceCopyFailure();
  const copiedTopology = value.topology;
  const kind = value.kind;
  const measure = value.measure;
  const center = value.center;
  const bounds = value.bounds;
  const direction = hasDirectional ? value[directional] : undefined;
  const axis = hasAxis ? value.axis : undefined;
  const radius = hasRadius ? value.radius : undefined;
  return Object.freeze({
    topology: copiedTopology,
    kind,
    measure,
    center: copyReferenceVector(center),
    bounds: copyReferenceBounds(bounds),
    ...(hasDirectional
      ? { [directional]: copyReferenceVector(direction) }
      : {}),
    ...(hasAxis ? { axis: copyReferenceVector(axis) } : {}),
    ...(hasRadius ? { radius } : {}),
  }) as unknown as TopologyGeometrySignature;
}

function copyReferenceNeighbor(
  value: unknown,
  resources: ReferenceCopyResources,
): TopologyNeighborSignature {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["topology", "lineage", "geometry"])
  ) {
    return referenceCopyFailure();
  }
  const copiedTopology = value.topology;
  if (
    copiedTopology !== "face" &&
    copiedTopology !== "edge" &&
    copiedTopology !== "vertex"
  ) {
    return referenceCopyFailure();
  }
  const lineage = value.lineage;
  const geometry = value.geometry;
  return Object.freeze({
    topology: copiedTopology,
    lineage: copyReferenceLineage(lineage, resources),
    geometry: copyReferenceGeometry(geometry, copiedTopology),
  }) as unknown as TopologyNeighborSignature;
}

/** Copies each reference field exactly once before validation and matching. */
function detachPersistentTopologyReference(
  value: unknown,
  limits: TopologySignatureLimits,
): PersistentTopologyReference {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "protocolVersion",
      "kernelFingerprint",
      "topology",
      "capturedHistory",
      "tolerance",
      "lineage",
      "geometry",
      "adjacency",
    ])
  ) {
    return referenceCopyFailure();
  }
  const protocolVersion = value.protocolVersion;
  const kernelFingerprint = value.kernelFingerprint;
  const topology = value.topology;
  const capturedHistory = value.capturedHistory;
  const rawTolerance = value.tolerance;
  const rawLineage = value.lineage;
  const rawGeometry = value.geometry;
  const rawAdjacency = value.adjacency;
  if (
    (protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1 &&
      protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2) ||
    (topology !== "face" && topology !== "edge" && topology !== "vertex") ||
    (protocolVersion === TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1 &&
      topology === "vertex") ||
    !isRecord(rawTolerance) ||
    !exactKeys(rawTolerance, ["linear", "angular", "relative"]) ||
    !Array.isArray(rawAdjacency)
  ) {
    return referenceCopyFailure();
  }
  const copiedAdjacency = referenceArray(rawAdjacency);
  const adjacencyLength = copiedAdjacency.length;
  enforceLimit(limits, "maxAdjacencyLinks", adjacencyLength);
  const linear = rawTolerance.linear;
  const angular = rawTolerance.angular;
  const relative = rawTolerance.relative;
  const resources: ReferenceCopyResources = {
    limits,
    evidenceRecords: 0,
  };
  const lineage = copyReferenceLineage(rawLineage, resources);
  const adjacency: TopologyNeighborSignature[] = [];
  for (let index = 0; index < adjacencyLength; index += 1) {
    if (!Object.hasOwn(copiedAdjacency.value, index)) {
      return referenceCopyFailure();
    }
    adjacency.push(copyReferenceNeighbor(copiedAdjacency.value[index], resources));
  }
  const detached = {
    protocolVersion,
    kernelFingerprint,
    topology,
    capturedHistory,
    tolerance: { linear, angular, relative },
    lineage,
    geometry: copyReferenceGeometry(rawGeometry, topology),
    adjacency,
  } as unknown as PersistentTopologyReference;
  if (!referenceIsValid(detached)) return referenceCopyFailure();
  return deepFreeze(detached);
}

function signatureFailure<T>(
  code: DiagnosticCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): Extract<CadResult<T>, { readonly ok: false }> {
  return failure(
    diagnostic(code, message, {
      severity: "error",
      ...(Object.keys(details).length === 0 ? {} : { details }),
    }),
  ) as Extract<CadResult<T>, { readonly ok: false }>;
}

function limitFailure<T>(
  error: TopologySignatureLimitError | KernelTopologySnapshotCopyLimitError,
): Extract<CadResult<T>, { readonly ok: false }> {
  return signatureFailure(
    "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
    error.message,
    {
      resource: error.resource,
      limit: error.limit,
      actual: error.actual,
    },
  );
}

function caughtSignatureFailure<T>(
  error: unknown,
): Extract<CadResult<T>, { readonly ok: false }> {
  if (
    isTopologySignatureLimitError(error) ||
    isKernelTopologySnapshotCopyLimitError(error)
  ) {
    return limitFailure(error);
  }
  return signatureFailure(
    "TOPOLOGY_SIGNATURE_INVALID",
    safeErrorMessage(error, "Persistent topology input could not be read"),
  );
}

/**
 * Copies, validates, canonicalizes, and freezes untrusted persistent evidence.
 * Adjacency multiplicity is significant and is therefore sorted, not deduped.
 */
export function normalizePersistentTopologyReference<
  K extends TopologyKind,
  R extends TopologyRole = TopologyRole,
>(
  value: PersistentTopologyReference<K, R>,
  options?: NormalizePersistentTopologyReferenceOptions,
): CadResult<PersistentTopologyReference<K, R>>;
export function normalizePersistentTopologyReference(
  value: unknown,
  options?: NormalizePersistentTopologyReferenceOptions,
): CadResult<PersistentTopologyReference>;
export function normalizePersistentTopologyReference(
  value: unknown,
  options: NormalizePersistentTopologyReferenceOptions = {},
): CadResult<PersistentTopologyReference> {
  try {
    const limits = normalizePersistentReferenceOptions(options);
    if (limits === undefined) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology reference normalization options are malformed or unsupported",
      );
    }
    return success(
      canonicalPersistentTopologyReference(
        detachPersistentTopologyReference(value, limits),
      ),
    );
  } catch (error) {
    return caughtSignatureFailure(error);
  }
}

function scalarClose(
  first: number,
  second: number,
  absolute: number,
  relative: number,
): boolean {
  return (
    Math.abs(first - second) <=
    absolute + relative * Math.max(Math.abs(first), Math.abs(second))
  );
}

function vectorClose(
  first: Vec3,
  second: Vec3,
  tolerance: TopologyMatchTolerance,
): boolean {
  return first.every((value, index) =>
    Math.abs(value - second[index]!) <= tolerance.linear,
  );
}

function normalizedAngularVector(value: Vec3): Vec3 | undefined {
  const scale = Math.max(
    Math.abs(value[0]),
    Math.abs(value[1]),
    Math.abs(value[2]),
  );
  if (!(scale > 0) || !Number.isFinite(scale)) return undefined;
  const scaled: Vec3 = [value[0] / scale, value[1] / scale, value[2] / scale];
  const scaledMagnitude = Math.hypot(...scaled);
  if (!(scaledMagnitude > 0) || !Number.isFinite(scaledMagnitude)) {
    return undefined;
  }
  return [
    scaled[0] / scaledMagnitude,
    scaled[1] / scaledMagnitude,
    scaled[2] / scaledMagnitude,
  ];
}

function angularClose(
  first: Vec3 | undefined,
  second: Vec3 | undefined,
  tolerance: number,
  unoriented: boolean,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  const normalizedFirst = normalizedAngularVector(first);
  const normalizedSecond = normalizedAngularVector(second);
  if (normalizedFirst === undefined || normalizedSecond === undefined) return false;
  let dot =
    normalizedFirst[0] * normalizedSecond[0] +
    normalizedFirst[1] * normalizedSecond[1] +
    normalizedFirst[2] * normalizedSecond[2];
  const cross: Vec3 = [
    normalizedFirst[1] * normalizedSecond[2] -
      normalizedFirst[2] * normalizedSecond[1],
    normalizedFirst[2] * normalizedSecond[0] -
      normalizedFirst[0] * normalizedSecond[2],
    normalizedFirst[0] * normalizedSecond[1] -
      normalizedFirst[1] * normalizedSecond[0],
  ];
  if (unoriented) dot = Math.abs(dot);
  return Math.atan2(Math.hypot(...cross), Math.max(-1, Math.min(1, dot))) <= tolerance;
}

function geometryClose(
  first: TopologyGeometrySignature,
  second: TopologyGeometrySignature,
  tolerance: TopologyMatchTolerance,
): boolean {
  if (first.topology !== second.topology) {
    return false;
  }
  if (first.topology === "vertex" && second.topology === "vertex") {
    return vectorClose(first.point, second.point, tolerance);
  }
  if (first.topology === "vertex" || second.topology === "vertex") {
    return false;
  }
  if (first.kind !== second.kind) return false;
  const measureAbsolute =
    first.topology === "face"
      ? tolerance.linear *
        Math.max(
          Math.sqrt(first.measure),
          Math.sqrt(second.measure),
          tolerance.linear,
        )
      : tolerance.linear;
  if (
    !scalarClose(
      first.measure,
      second.measure,
      measureAbsolute,
      tolerance.relative,
    ) ||
    !vectorClose(first.center, second.center, tolerance) ||
    !vectorClose(first.bounds.min, second.bounds.min, tolerance) ||
    !vectorClose(first.bounds.max, second.bounds.max, tolerance)
  ) {
    return false;
  }
  if (
    first.radius === undefined ||
    second.radius === undefined
      ? first.radius !== second.radius
      : !scalarClose(
          first.radius,
          second.radius,
          tolerance.linear,
          tolerance.relative,
        )
  ) {
    return false;
  }
  if (!angularClose(first.axis, second.axis, tolerance.angular, true)) {
    return false;
  }
  if (first.topology === "face" && second.topology === "face") {
    return angularClose(
      first.normal,
      second.normal,
      tolerance.angular,
      false,
    );
  }
  if (first.topology === "edge" && second.topology === "edge") {
    return angularClose(
      first.direction,
      second.direction,
      tolerance.angular,
      true,
    );
  }
  return false;
}

function semanticAnchors(
  lineage: readonly KernelTopologyLineage[],
): readonly string[] {
  return [
    ...new Set(
      lineage
        .filter(
          (item) =>
            item.relation === "created" &&
            (item.role !== undefined || item.source !== undefined),
        )
        .map((item) =>
          canonicalStringify({
            feature: item.feature,
            ...(item.role === undefined ? {} : { role: item.role }),
            ...(item.source === undefined ? {} : { source: item.source }),
          }),
        ),
    ),
  ].sort();
}

function createdFeatures(
  lineage: readonly KernelTopologyLineage[],
): ReadonlySet<string> {
  return new Set(
    lineage
      .filter((item) => item.relation === "created")
      .map((item) => item.feature),
  );
}

type TopologyBaseSignature = Pick<
  PersistentTopologyReference,
  "lineage" | "geometry"
>;

interface CompiledBaseSignature {
  readonly signature: TopologyBaseSignature;
  readonly anchors: readonly string[];
  readonly features: ReadonlySet<string>;
}

interface CompiledTopologyReference {
  readonly reference: PersistentTopologyReference;
  readonly base: CompiledBaseSignature;
  readonly adjacency: readonly CompiledBaseSignature[];
}

/** Operation-local evidence cache; never survives mutable caller input. */
class MatchingSignatureCompiler {
  private readonly bases = new WeakMap<object, CompiledBaseSignature>();
  private readonly references = new WeakMap<object, CompiledTopologyReference>();

  base(signature: TopologyBaseSignature): CompiledBaseSignature {
    const cached = this.bases.get(signature);
    if (cached !== undefined) return cached;
    const compiled = Object.freeze({
      signature,
      anchors: semanticAnchors(signature.lineage),
      features: createdFeatures(signature.lineage),
    });
    this.bases.set(signature, compiled);
    return compiled;
  }

  reference(
    reference: PersistentTopologyReference,
  ): CompiledTopologyReference {
    const cached = this.references.get(reference);
    if (cached !== undefined) return cached;
    const compiled = Object.freeze({
      reference,
      base: this.base(reference),
      adjacency: Object.freeze(
        reference.adjacency.map((neighbor) => this.base(neighbor)),
      ),
    });
    this.references.set(reference, compiled);
    return compiled;
  }
}

function arraysEqual(
  first: readonly string[],
  second: readonly string[],
  budget: MatchingWorkBudget,
): boolean {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    budget.matchingStep();
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function setsOverlap(
  first: ReadonlySet<string>,
  second: ReadonlySet<string>,
  budget: MatchingWorkBudget,
): boolean {
  const [probe, target] =
    first.size <= second.size ? [first, second] : [second, first];
  for (const value of probe) {
    budget.matchingStep();
    if (target.has(value)) return true;
  }
  return false;
}

function baseSignaturesCompatible(
  first: CompiledBaseSignature,
  second: CompiledBaseSignature,
  tolerance: TopologyMatchTolerance,
  completeHistory: boolean,
  budget: MatchingWorkBudget,
): boolean {
  if (
    first.signature.geometry.topology !== second.signature.geometry.topology
  ) {
    return false;
  }
  if (completeHistory) {
    if (first.anchors.length > 0 || second.anchors.length > 0) {
      return (
        first.anchors.length > 0 &&
        second.anchors.length > 0 &&
        arraysEqual(first.anchors, second.anchors, budget)
      );
    }
    if (
      first.features.size > 0 &&
      second.features.size > 0 &&
      !setsOverlap(first.features, second.features, budget)
    ) {
      return false;
    }
  }
  return geometryClose(
    first.signature.geometry,
    second.signature.geometry,
    tolerance,
  );
}

function adjacencyCompatible(
  first: readonly CompiledBaseSignature[],
  second: readonly CompiledBaseSignature[],
  tolerance: TopologyMatchTolerance,
  completeHistory: boolean,
  budget: MatchingWorkBudget,
): boolean {
  if (first.length !== second.length) return false;
  const candidates = first.map((source) => {
    const compatible: number[] = [];
    for (let index = 0; index < second.length; index += 1) {
      budget.candidatePair();
      if (
        baseSignaturesCompatible(
          source,
          second[index]!,
          tolerance,
          completeHistory,
          budget,
        )
      ) {
        compatible.push(index);
      }
    }
    return compatible;
  });
  if (candidates.some((values) => values.length === 0)) return false;
  const targetForSource = new Array<number>(first.length).fill(-1);
  const sourceForTarget = new Array<number>(second.length).fill(-1);
  for (let start = 0; start < first.length; start += 1) {
    const queue = [start];
    const visitedSources = new Array<boolean>(first.length).fill(false);
    const visitedTargets = new Array<boolean>(second.length).fill(false);
    const sourceBeforeTarget = new Array<number>(second.length).fill(-1);
    visitedSources[start] = true;
    let freeTarget = -1;
    search: for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const sourceIndex = queue[cursor]!;
      for (const targetIndex of candidates[sourceIndex]!) {
        budget.matchingStep();
        if (visitedTargets[targetIndex]) continue;
        visitedTargets[targetIndex] = true;
        sourceBeforeTarget[targetIndex] = sourceIndex;
        const matchedSource = sourceForTarget[targetIndex]!;
        if (matchedSource === -1) {
          freeTarget = targetIndex;
          break search;
        }
        if (!visitedSources[matchedSource]) {
          visitedSources[matchedSource] = true;
          queue.push(matchedSource);
        }
      }
    }
    if (freeTarget === -1) return false;
    for (let targetIndex = freeTarget; targetIndex !== -1; ) {
      budget.matchingStep();
      const sourceIndex = sourceBeforeTarget[targetIndex]!;
      const priorTarget = targetForSource[sourceIndex]!;
      targetForSource[sourceIndex] = targetIndex;
      sourceForTarget[targetIndex] = sourceIndex;
      targetIndex = priorTarget;
    }
  }
  return true;
}

function fullySemanticallyAnchored(
  adjacency: readonly CompiledBaseSignature[],
): boolean {
  return (
    adjacency.length > 0 &&
    adjacency.every((neighbor) => neighbor.anchors.length > 0)
  );
}

interface TopologyMatchDecision {
  readonly strategy: TopologyMatchEvidence;
  readonly matched: boolean;
}

const SEMANTIC_MATCH = Object.freeze({
  strategy: "semantic-lineage",
  matched: true,
} as const satisfies TopologyMatchDecision);
const SEMANTIC_MISMATCH = Object.freeze({
  strategy: "semantic-lineage",
  matched: false,
} as const satisfies TopologyMatchDecision);
const GEOMETRY_MATCH = Object.freeze({
  strategy: "geometry-adjacency",
  matched: true,
} as const satisfies TopologyMatchDecision);
const GEOMETRY_MISMATCH = Object.freeze({
  strategy: "geometry-adjacency",
  matched: false,
} as const satisfies TopologyMatchDecision);

function matchDecision(
  reference: CompiledTopologyReference,
  candidate: CompiledTopologyReference,
  budget: MatchingWorkBudget,
): TopologyMatchDecision {
  budget.candidatePair();
  if (reference.reference.topology !== candidate.reference.topology) {
    return GEOMETRY_MISMATCH;
  }
  const completeHistory =
    reference.reference.capturedHistory === "complete" &&
    candidate.reference.capturedHistory === "complete";
  if (completeHistory) {
    if (reference.base.anchors.length > 0 || candidate.base.anchors.length > 0) {
      return reference.base.anchors.length > 0 &&
        candidate.base.anchors.length > 0 &&
        arraysEqual(reference.base.anchors, candidate.base.anchors, budget)
        ? SEMANTIC_MATCH
        : SEMANTIC_MISMATCH;
    }
    if (
      reference.reference.topology === "vertex" &&
      candidate.reference.topology === "vertex"
    ) {
      const referenceAnchored = fullySemanticallyAnchored(reference.adjacency);
      const candidateAnchored = fullySemanticallyAnchored(candidate.adjacency);
      if (referenceAnchored || candidateAnchored) {
        return referenceAnchored &&
          candidateAnchored &&
          adjacencyCompatible(
            reference.adjacency,
            candidate.adjacency,
            reference.reference.tolerance,
            true,
            budget,
          )
          ? SEMANTIC_MATCH
          : SEMANTIC_MISMATCH;
      }
    }
  }
  if (
    !baseSignaturesCompatible(
      reference.base,
      candidate.base,
      reference.reference.tolerance,
      completeHistory,
      budget,
    ) ||
    !adjacencyCompatible(
      reference.adjacency,
      candidate.adjacency,
      reference.reference.tolerance,
      completeHistory,
      budget,
    )
  ) {
    return GEOMETRY_MISMATCH;
  }
  return GEOMETRY_MATCH;
}

function matchEvidence(
  reference: CompiledTopologyReference,
  candidate: CompiledTopologyReference,
  budget: MatchingWorkBudget,
): TopologyMatchEvidence | undefined {
  const decision = matchDecision(reference, candidate, budget);
  return decision.matched ? decision.strategy : undefined;
}

interface CachedTopologyReferenceAnalysis<
  K extends TopologyKind = TopologyKind,
> {
  readonly explanation: CadResult<TopologyReferenceResolutionExplanation<K>>;
  readonly resolution: CadResult<ResolvedTopologyReference>;
}

function failedTopologyReferenceAnalysis<K extends TopologyKind>(
  result: Extract<CadResult<unknown>, { readonly ok: false }>,
): CachedTopologyReferenceAnalysis<K> {
  return { explanation: result, resolution: result };
}

function resolutionFromExplanation(
  explanation: TopologyReferenceResolutionExplanation,
): CadResult<ResolvedTopologyReference> {
  if (explanation.outcome === "resolved") {
    return success(
      Object.freeze({
        key: explanation.key,
        evidence: explanation.evidence,
      }),
    );
  }
  if (explanation.outcome === "missing") {
    return signatureFailure(
      "TOPOLOGY_MATCH_MISSING",
      `Persistent topology reference matched no current ${explanation.topology}`,
      {
        topology: explanation.topology,
        explanation,
      },
    );
  }
  return signatureFailure(
    "TOPOLOGY_MATCH_AMBIGUOUS",
    `Persistent topology reference matched ${explanation.candidatesMatched} current ${pluralTopologyKind(explanation.topology)}`,
    {
      topology: explanation.topology,
      candidates: explanation.candidatesMatched,
      explanation,
    },
  );
}

interface InternalTopologyReferenceResolutionSession
  extends ExplainableTopologyReferenceResolutionSession {
  analyzeNormalized<K extends TopologyKind>(
    reference: PersistentTopologyReference<K>,
  ): CachedTopologyReferenceAnalysis<K>;
}

class TopologyReferenceResolutionSessionImpl
  implements InternalTopologyReferenceResolutionSession
{
  readonly snapshot: KernelTopologySnapshot;
  private readonly capabilities: KernelTopologySignatureCapabilities;
  private readonly limits: TopologySignatureLimits;
  private readonly budget: MatchingWorkBudget;
  private readonly compiler = new MatchingSignatureCompiler();
  private candidateContext: DescriptorSignatureContext | undefined;
  private readonly analyses = new WeakMap<
    object,
    CachedTopologyReferenceAnalysis
  >();

  constructor(
    snapshot: KernelTopologySnapshot,
    options: NormalizedResolveOptions,
    budget?: MatchingWorkBudget,
  ) {
    this.snapshot = snapshot;
    this.capabilities = options.capabilities;
    this.limits = options.limits;
    this.budget = budget ?? new MatchingWorkBudget(options.limits);
  }

  private analyze<K extends TopologyKind>(
    reference: PersistentTopologyReference<K>,
  ): CachedTopologyReferenceAnalysis<K> {
    const cacheKey =
      typeof reference === "object" && reference !== null
        ? (reference as object)
        : undefined;
    if (cacheKey !== undefined) {
      const cached = this.analyses.get(cacheKey);
      if (cached !== undefined) {
        return cached as CachedTopologyReferenceAnalysis<K>;
      }
      this.analyses.set(
        cacheKey,
        failedTopologyReferenceAnalysis(
          signatureFailure(
            "TOPOLOGY_SIGNATURE_INVALID",
            "Persistent topology reference resolution is reentrant",
          ),
        ),
      );
    }
    const normalized = normalizePersistentTopologyReference(reference, {
      limits: this.limits,
    });
    const analysis = normalized.ok
      ? this.analyzeNormalized(normalized.value)
      : failedTopologyReferenceAnalysis<K>(normalized);
    if (cacheKey !== undefined) {
      this.analyses.set(cacheKey, analysis as CachedTopologyReferenceAnalysis);
    }
    return analysis;
  }

  explain<K extends TopologyKind>(
    reference: PersistentTopologyReference<K>,
  ): CadResult<TopologyReferenceResolutionExplanation<K>> {
    return this.analyze(reference).explanation;
  }

  resolve<K extends TopologyKind>(
    reference: PersistentTopologyReference<K>,
  ): CadResult<ResolvedTopologyReference> {
    return this.analyze(reference).resolution;
  }

  analyzeNormalized<K extends TopologyKind>(
    reference: PersistentTopologyReference<K>,
  ): CachedTopologyReferenceAnalysis<K> {
    try {
      if (reference.protocolVersion !== this.capabilities.protocolVersion) {
        return failedTopologyReferenceAnalysis(
          signatureFailure(
            "TOPOLOGY_FINGERPRINT_MISMATCH",
            "Persistent topology reference and current kernel signature protocols are incompatible",
            {
              expected: reference.protocolVersion,
              actual: this.capabilities.protocolVersion,
            },
          ),
        );
      }
      if (reference.kernelFingerprint !== this.capabilities.fingerprint) {
        return failedTopologyReferenceAnalysis(
          signatureFailure(
            "TOPOLOGY_FINGERPRINT_MISMATCH",
            "Persistent topology reference and current kernel descriptors are incompatible",
            {
              expected: reference.kernelFingerprint,
              actual: this.capabilities.fingerprint,
            },
          ),
        );
      }
      const universe: readonly TopologyDescriptor[] =
        reference.topology === "face"
          ? this.snapshot.faces
          : reference.topology === "edge"
            ? this.snapshot.edges
            : this.snapshot.vertices;
      // Candidate evidence is tolerance-independent: matchDecision applies the
      // stored reference's tolerance to both base and adjacency comparisons.
      // Reusing one context therefore avoids rebuilding full snapshot maps and
      // candidate signatures for every distinct stored tolerance.
      let context = this.candidateContext;
      if (context === undefined) {
        context = descriptorSignatureContext(
          this.snapshot,
          this.capabilities,
          reference.tolerance,
        );
        this.candidateContext = context;
      }
      const compiledReference = this.compiler.reference(reference);
      const strategies: Record<
        TopologyMatchEvidence,
        { considered: number; matched: number }
      > = {
        "semantic-lineage": { considered: 0, matched: 0 },
        "geometry-adjacency": { considered: 0, matched: 0 },
      };
      const matches: {
        readonly descriptor: TopologyDescriptor;
        readonly evidence: TopologyMatchEvidence;
      }[] = [];
      for (const descriptor of universe) {
        const candidate = referenceForDescriptor(descriptor, context);
        const decision = matchDecision(
          compiledReference,
          this.compiler.reference(candidate),
          this.budget,
        );
        strategies[decision.strategy].considered += 1;
        if (decision.matched) {
          strategies[decision.strategy].matched += 1;
          matches.push({ descriptor, evidence: decision.strategy });
        }
      }
      const base = {
        version: TOPOLOGY_REFERENCE_EXPLANATION_VERSION,
        topology: reference.topology,
        capturedHistory: reference.capturedHistory,
        currentHistory: this.snapshot.history,
        capturedSemanticAnchors: compiledReference.base.anchors.length,
        candidatesConsidered: universe.length,
        candidatesMatched: matches.length,
        strategies,
      } as const;
      const explanation = deepFreeze(
        matches.length === 0
          ? { ...base, outcome: "missing" as const }
          : matches.length > 1
            ? { ...base, outcome: "ambiguous" as const }
            : {
                ...base,
                outcome: "resolved" as const,
                key: matches[0]!.descriptor.key,
                evidence: matches[0]!.evidence,
              },
      ) as TopologyReferenceResolutionExplanation<K>;
      return {
        explanation: success(explanation),
        resolution: resolutionFromExplanation(explanation),
      };
    } catch (error) {
      return failedTopologyReferenceAnalysis(caughtSignatureFailure(error));
    }
  }
}

export interface TopologyReferenceResolutionSessionGroup {
  /** One detached snapshot shared by ordinary selection and every profile. */
  readonly snapshot: KernelTopologySnapshot;
  readonly limits: TopologySignatureLimits;
  readonly profiles: readonly {
    readonly capabilities: KernelTopologySignatureCapabilities;
    readonly session: ExplainableTopologyReferenceResolutionSession;
  }[];
}

/** @internal Creates profile-specific matchers with one cumulative work budget. */
export function createTopologyReferenceResolutionSessionGroup(
  snapshot: KernelTopologySnapshot,
  options: {
    readonly capabilities: readonly KernelTopologySignatureCapabilities[];
    readonly limits?: Partial<TopologySignatureLimits>;
  },
): CadResult<TopologyReferenceResolutionSessionGroup> {
  try {
    if (!isRecord(options)) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology resolution session-group options are malformed",
      );
    }
    const hasLimits = Object.hasOwn(options, "limits");
    const rawCapabilities: unknown = options.capabilities;
    const capabilityCount = Array.isArray(rawCapabilities)
      ? rawCapabilities.length
      : 0;
    if (
      !exactKeys(options, hasLimits ? ["capabilities", "limits"] : ["capabilities"]) ||
      !Array.isArray(rawCapabilities) ||
      capabilityCount === 0 ||
      capabilityCount > 2
    ) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology resolution session-group options are malformed",
      );
    }
    const capabilities: KernelTopologySignatureCapabilities[] = [];
    const protocols = new Set<number>();
    for (let index = 0; index < capabilityCount; index += 1) {
      if (!Object.hasOwn(rawCapabilities, index)) {
        return signatureFailure(
          "TOPOLOGY_SIGNATURE_INVALID",
          "Topology resolution signature profiles cannot be sparse",
        );
      }
      const normalized = normalizeCapabilities(rawCapabilities[index]);
      if (
        normalized === undefined ||
        protocols.has(normalized.protocolVersion) ||
        (index > 0 &&
          normalized.protocolVersion >= capabilities[0]!.protocolVersion)
      ) {
        return signatureFailure(
          "TOPOLOGY_SIGNATURE_INVALID",
          "Topology resolution signature profiles are malformed or duplicated",
        );
      }
      protocols.add(normalized.protocolVersion);
      capabilities.push(normalized);
    }
    const rawLimits = hasLimits ? options.limits : undefined;
    if (hasLimits && rawLimits === undefined) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology resolution session-group limits are malformed",
      );
    }
    const limits = normalizeLimits(rawLimits);
    if (limits === undefined) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology resolution session-group limits are malformed",
      );
    }
    const normalizedSnapshot = normalizeKernelTopologySnapshot(snapshot, limits);
    if (!normalizedSnapshot.ok) return normalizedSnapshot;
    const budget = new MatchingWorkBudget(limits);
    return success(
      Object.freeze({
        snapshot: normalizedSnapshot.value,
        limits,
        profiles: Object.freeze(
          capabilities.map((profile) =>
            Object.freeze({
              capabilities: profile,
              session: new TopologyReferenceResolutionSessionImpl(
                normalizedSnapshot.value,
                Object.freeze({ capabilities: profile, limits }),
                budget,
              ),
            }),
          ),
        ),
      }),
    );
  } catch (error) {
    return caughtSignatureFailure(error);
  }
}

/**
 * Creates one operation-local resolver. Kernel snapshot access is detached and
 * validated exactly once; all subsequent reference resolutions share matching
 * work limits and derived candidate evidence.
 */
export function createTopologyReferenceResolutionSession(
  snapshot: KernelTopologySnapshot,
  options: ResolveTopologyReferenceOptions,
): CadResult<ExplainableTopologyReferenceResolutionSession> {
  try {
    const normalized = normalizeResolveOptions(options);
    if (normalized === undefined) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology resolution options are malformed or unsupported",
      );
    }
    const normalizedSnapshot = normalizeKernelTopologySnapshot(
      snapshot,
      normalized.limits,
    );
    if (!normalizedSnapshot.ok) return normalizedSnapshot;
    return success(
      new TopologyReferenceResolutionSessionImpl(
        normalizedSnapshot.value,
        normalized,
      ),
    );
  } catch (error) {
    return caughtSignatureFailure(error);
  }
}

export function captureTopologyReference<K extends LegacyTopologyKind>(
  snapshot: KernelTopologySnapshot,
  topology: K,
  key: KernelTopologyKey,
  options: CaptureTopologyReferenceOptions & {
    readonly capabilities: KernelTopologySignatureCapabilitiesV1;
  },
): CadResult<PersistentTopologyReferenceProtocolV1<K>>;
export function captureTopologyReference<K extends TopologyKind>(
  snapshot: KernelTopologySnapshot,
  topology: K,
  key: KernelTopologyKey,
  options: CaptureTopologyReferenceOptions & {
    readonly capabilities: KernelTopologySignatureCapabilitiesV2;
  },
): CadResult<PersistentTopologyReferenceProtocolV2<K>>;
export function captureTopologyReference<K extends TopologyKind>(
  snapshot: KernelTopologySnapshot,
  topology: K,
  key: KernelTopologyKey,
  options: CaptureTopologyReferenceOptions,
): CadResult<PersistentTopologyReference<K>>;
export function captureTopologyReference<K extends TopologyKind>(
  snapshot: KernelTopologySnapshot,
  topology: K,
  key: KernelTopologyKey,
  options: CaptureTopologyReferenceOptions,
): CadResult<PersistentTopologyReference<K>> {
  try {
    const normalized = normalizeCaptureOptions(options);
    if (normalized === undefined) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology capture options are malformed or unsupported",
      );
    }
    if (
      topology !== "face" &&
      topology !== "edge" &&
      topology !== "vertex"
    ) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Persistent topology references support faces, edges, and vertices only",
      );
    }
    if (
      normalized.capabilities.protocolVersion ===
        TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1 &&
      topology === "vertex"
    ) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Persistent topology signature protocol v1 supports faces and edges only",
      );
    }
    if (typeof key !== "string" || key.length === 0) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology capture requires a non-empty evaluation-scoped key",
      );
    }
    const normalizedSnapshot = normalizeKernelTopologySnapshot(
      snapshot,
      normalized.limits,
    );
    if (!normalizedSnapshot.ok) return normalizedSnapshot;
    const currentSnapshot = normalizedSnapshot.value;
    const universe: readonly TopologyDescriptor[] =
      topology === "face"
        ? currentSnapshot.faces
        : topology === "edge"
          ? currentSnapshot.edges
          : currentSnapshot.vertices;
    const descriptor = universe.find((item) => item.key === key);
    if (descriptor === undefined) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        `Topology key is not a ${topology} in this snapshot`,
        { topology },
      );
    }
    const context = descriptorSignatureContext(
      currentSnapshot,
      normalized.capabilities,
      normalized.tolerance,
    );
    const reference = referenceForDescriptor(descriptor, context);
    const budget = new MatchingWorkBudget(normalized.limits);
    const compiler = new MatchingSignatureCompiler();
    const compiledReference = compiler.reference(reference);
    let matches = 0;
    for (const candidate of universe) {
      const candidateReference = referenceForDescriptor(candidate, context);
      if (
        matchEvidence(
          compiledReference,
          compiler.reference(candidateReference),
          budget,
        ) !== undefined
      ) {
        matches += 1;
      }
    }
    if (matches !== 1) {
      return signatureFailure(
        "TOPOLOGY_MATCH_AMBIGUOUS",
        `Topology evidence identifies ${matches} ${pluralTopologyKind(topology)} in the capture snapshot`,
        { topology, candidates: matches },
      );
    }
    return success(reference as PersistentTopologyReference<K>);
  } catch (error) {
    return caughtSignatureFailure(error);
  }
}

export function resolveTopologyReference<K extends TopologyKind>(
  reference: PersistentTopologyReference<K>,
  snapshot: KernelTopologySnapshot,
  options: ResolveTopologyReferenceOptions,
): CadResult<ResolvedTopologyReference> {
  try {
    const normalized = normalizeResolveOptions(options);
    if (normalized === undefined) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology resolution options are malformed or unsupported",
      );
    }
    const normalizedReference = normalizePersistentTopologyReference(
      reference,
      { limits: normalized.limits },
    );
    if (!normalizedReference.ok) return normalizedReference;
    const normalizedSnapshot = normalizeKernelTopologySnapshot(
      snapshot,
      normalized.limits,
    );
    if (!normalizedSnapshot.ok) return normalizedSnapshot;
    return new TopologyReferenceResolutionSessionImpl(
      normalizedSnapshot.value,
      normalized,
    ).analyzeNormalized(normalizedReference.value).resolution;
  } catch (error) {
    return caughtSignatureFailure(error);
  }
}

/**
 * Explains one bounded reference search without changing fail-closed resolve
 * semantics. A successful CadResult means the analysis completed; inspect the
 * explanation outcome to distinguish resolved, missing, and ambiguous identity.
 */
export function explainTopologyReference<K extends TopologyKind>(
  reference: PersistentTopologyReference<K>,
  snapshot: KernelTopologySnapshot,
  options: ResolveTopologyReferenceOptions,
): CadResult<TopologyReferenceResolutionExplanation<K>> {
  try {
    const normalized = normalizeResolveOptions(options);
    if (normalized === undefined) {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Topology explanation options are malformed or unsupported",
      );
    }
    const normalizedReference = normalizePersistentTopologyReference(
      reference,
      { limits: normalized.limits },
    );
    if (!normalizedReference.ok) return normalizedReference;
    const normalizedSnapshot = normalizeKernelTopologySnapshot(
      snapshot,
      normalized.limits,
    );
    if (!normalizedSnapshot.ok) return normalizedSnapshot;
    return new TopologyReferenceResolutionSessionImpl(
      normalizedSnapshot.value,
      normalized,
    ).analyzeNormalized(normalizedReference.value).explanation;
  } catch (error) {
    return caughtSignatureFailure(error);
  }
}
