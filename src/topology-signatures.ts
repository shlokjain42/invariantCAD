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
import {
  TOPOLOGY_ROLE_RULES,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelTopologyBounds,
  type KernelTopologyKey,
  type KernelTopologyLineage,
  type KernelTopologySignatureCapabilities,
  type KernelTopologySnapshot,
  type TopologyKind,
  type TopologyRole,
} from "./protocol/topology.js";

export const TOPOLOGY_SIGNATURE_PROTOCOL_VERSION = 1 as const;

export interface TopologySignatureLimits {
  readonly maxTopologyItems: number;
  readonly maxAdjacencyLinks: number;
  readonly maxEvidenceRecords: number;
  readonly maxCandidatePairs: number;
  readonly maxMatchingSteps: number;
}

export const DEFAULT_TOPOLOGY_SIGNATURE_LIMITS: TopologySignatureLimits =
  Object.freeze({
    maxTopologyItems: 100_000,
    maxAdjacencyLinks: 1_000_000,
    maxEvidenceRecords: 1_000_000,
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

export type TopologyGeometrySignature<
  K extends TopologyKind = TopologyKind,
> = K extends "face"
  ? TopologyFaceGeometrySignature
  : TopologyEdgeGeometrySignature;

export interface TopologyNeighborSignature {
  readonly topology: TopologyKind;
  readonly lineage: readonly KernelTopologyLineage[];
  readonly geometry: TopologyGeometrySignature;
}

/**
 * Detached face/edge evidence that can be stored between evaluations.
 *
 * It intentionally contains no kernel topology key, native index, array
 * ordinal, or enumeration-derived discriminator. A symmetric item therefore
 * remains ambiguous instead of receiving an invented persistent identity.
 */
export interface PersistentTopologyReference<
  K extends TopologyKind = TopologyKind,
> {
  readonly protocolVersion: typeof TOPOLOGY_SIGNATURE_PROTOCOL_VERSION;
  readonly kernelFingerprint: string;
  readonly topology: K;
  readonly capturedHistory: KernelTopologySnapshot["history"];
  readonly tolerance: TopologyMatchTolerance;
  readonly lineage: readonly KernelTopologyLineage[];
  readonly geometry: TopologyGeometrySignature<K>;
  readonly adjacency: readonly TopologyNeighborSignature[];
}

export type TopologyMatchEvidence =
  | "semantic-lineage"
  | "geometry-adjacency";

export interface ResolvedTopologyReference {
  /** Evaluation-scoped key for the current snapshot only. */
  readonly key: KernelTopologyKey;
  readonly evidence: TopologyMatchEvidence;
}

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

type TopologyDescriptor = KernelFaceDescriptor | KernelEdgeDescriptor;

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

function canonicalLineage(
  lineage: readonly KernelTopologyLineage[],
): readonly KernelTopologyLineage[] {
  const unique = new Map<string, KernelTopologyLineage>();
  for (const item of lineage) {
    const copied: KernelTopologyLineage = {
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

function geometrySignature(
  descriptor: TopologyDescriptor,
): TopologyGeometrySignature {
  return descriptor.topology === "face"
    ? faceGeometry(descriptor)
    : edgeGeometry(descriptor);
}

function canonicalGeometrySignature<K extends TopologyKind>(
  geometry: TopologyGeometrySignature<K>,
): TopologyGeometrySignature<K> {
  const directional =
    geometry.topology === "face"
      ? geometry.normal
      : (geometry as TopologyEdgeGeometrySignature).direction;
  return Object.freeze({
    topology: geometry.topology,
    kind: geometry.kind,
    measure: Object.is(geometry.measure, -0) ? 0 : geometry.measure,
    center: immutableVector(geometry.center),
    bounds: immutableBounds(geometry.bounds),
    ...(directional === undefined
      ? {}
      : geometry.topology === "face"
        ? { normal: immutableVector(directional) }
        : { direction: immutableVector(directional) }),
    ...(geometry.axis === undefined
      ? {}
      : { axis: immutableVector(geometry.axis) }),
    ...(geometry.radius === undefined
      ? {}
      : {
          radius: Object.is(geometry.radius, -0) ? 0 : geometry.radius,
        }),
  }) as TopologyGeometrySignature<K>;
}

function canonicalPersistentTopologyReference<K extends TopologyKind>(
  reference: PersistentTopologyReference<K>,
): PersistentTopologyReference<K> {
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
  }) as unknown as PersistentTopologyReference<K>;
}

interface DescriptorSignatureContext {
  readonly snapshot: KernelTopologySnapshot;
  readonly capabilities: KernelTopologySignatureCapabilities;
  readonly tolerance: TopologyMatchTolerance;
  readonly faces: ReadonlyMap<KernelTopologyKey, KernelFaceDescriptor>;
  readonly edges: ReadonlyMap<KernelTopologyKey, KernelEdgeDescriptor>;
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

function referenceForDescriptor<K extends TopologyKind>(
  descriptor: K extends "face" ? KernelFaceDescriptor : KernelEdgeDescriptor,
  context: DescriptorSignatureContext,
): PersistentTopologyReference<K> {
  const cached = context.references.get(descriptor.key);
  if (cached !== undefined) {
    return cached as PersistentTopologyReference<K>;
  }
  const adjacent = (
    descriptor.topology === "face"
      ? descriptor.edges.map((key) => context.edges.get(key)!)
      : descriptor.faces.map((key) => context.faces.get(key)!)
  )
    .map((neighbor) => compiledNeighborSignature(neighbor, context))
    .sort((first, second) => lexicalCompare(first.sortKey, second.sortKey))
    .map((compiled) => compiled.signature);
  const reference = deepFreeze({
    protocolVersion: TOPOLOGY_SIGNATURE_PROTOCOL_VERSION,
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
  }) as unknown as PersistentTopologyReference<K>;
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
    protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION ||
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
    value.protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION ||
    typeof value.kernelFingerprint !== "string" ||
    value.kernelFingerprint.length === 0 ||
    (value.topology !== "face" && value.topology !== "edge") ||
    (value.capturedHistory !== "complete" &&
      value.capturedHistory !== "partial") ||
    !toleranceIsValid(value.tolerance) ||
    !lineageIsValid(value.lineage, value.topology) ||
    !geometryIsValid(value.geometry, value.topology) ||
    !Array.isArray(value.adjacency)
  ) {
    return false;
  }
  const opposite = value.topology === "face" ? "edge" : "face";
  for (let index = 0; index < value.adjacency.length; index += 1) {
    if (!Object.hasOwn(value.adjacency, index)) return false;
    const neighbor = value.adjacency[index];
    if (
      !isRecord(neighbor) ||
      !exactKeys(neighbor, ["topology", "lineage", "geometry"]) ||
      neighbor.topology !== opposite ||
      !lineageIsValid(neighbor.lineage, opposite) ||
      !geometryIsValid(neighbor.geometry, opposite)
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
  topology: TopologyKind,
  resources: ReferenceCopyResources,
): TopologyNeighborSignature {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["topology", "lineage", "geometry"])
  ) {
    return referenceCopyFailure();
  }
  const copiedTopology = value.topology;
  const lineage = value.lineage;
  const geometry = value.geometry;
  return Object.freeze({
    topology: copiedTopology,
    lineage: copyReferenceLineage(lineage, resources),
    geometry: copyReferenceGeometry(geometry, topology),
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
    (topology !== "face" && topology !== "edge") ||
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
  const opposite = topology === "face" ? "edge" : "face";
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
    adjacency.push(
      copyReferenceNeighbor(
        copiedAdjacency.value[index],
        opposite,
        resources,
      ),
    );
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
): CadResult<T> {
  return failure(
    diagnostic(code, message, {
      severity: "error",
      ...(Object.keys(details).length === 0 ? {} : { details }),
    }),
  );
}

function limitFailure<T>(
  error: TopologySignatureLimitError | KernelTopologySnapshotCopyLimitError,
): CadResult<T> {
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

function caughtSignatureFailure<T>(error: unknown): CadResult<T> {
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
export function normalizePersistentTopologyReference<K extends TopologyKind>(
  value: PersistentTopologyReference<K>,
  options?: NormalizePersistentTopologyReferenceOptions,
): CadResult<PersistentTopologyReference<K>>;
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
  if (first.topology !== second.topology || first.kind !== second.kind) {
    return false;
  }
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

function matchEvidence(
  reference: CompiledTopologyReference,
  candidate: CompiledTopologyReference,
  budget: MatchingWorkBudget,
): TopologyMatchEvidence | undefined {
  budget.candidatePair();
  if (reference.reference.topology !== candidate.reference.topology) {
    return undefined;
  }
  const completeHistory =
    reference.reference.capturedHistory === "complete" &&
    candidate.reference.capturedHistory === "complete";
  if (completeHistory) {
    if (reference.base.anchors.length > 0 || candidate.base.anchors.length > 0) {
      return reference.base.anchors.length > 0 &&
        candidate.base.anchors.length > 0 &&
        arraysEqual(reference.base.anchors, candidate.base.anchors, budget)
        ? "semantic-lineage"
        : undefined;
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
    return undefined;
  }
  return "geometry-adjacency";
}

interface InternalTopologyReferenceResolutionSession
  extends TopologyReferenceResolutionSession {
  resolveNormalized(
    reference: PersistentTopologyReference,
  ): CadResult<ResolvedTopologyReference>;
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
  private readonly results = new WeakMap<
    object,
    CadResult<ResolvedTopologyReference>
  >();

  constructor(
    snapshot: KernelTopologySnapshot,
    options: NormalizedResolveOptions,
  ) {
    this.snapshot = snapshot;
    this.capabilities = options.capabilities;
    this.limits = options.limits;
    this.budget = new MatchingWorkBudget(options.limits);
  }

  resolve<K extends TopologyKind>(
    reference: PersistentTopologyReference<K>,
  ): CadResult<ResolvedTopologyReference> {
    const cacheKey =
      typeof reference === "object" && reference !== null
        ? (reference as object)
        : undefined;
    if (cacheKey !== undefined) {
      const cached = this.results.get(cacheKey);
      if (cached !== undefined) return cached;
      this.results.set(
        cacheKey,
        signatureFailure(
          "TOPOLOGY_SIGNATURE_INVALID",
          "Persistent topology reference resolution is reentrant",
        ),
      );
    }
    const normalized = normalizePersistentTopologyReference(reference, {
      limits: this.limits,
    });
    const result = normalized.ok
      ? this.resolveNormalized(normalized.value)
      : normalized;
    if (cacheKey !== undefined) this.results.set(cacheKey, result);
    return result;
  }

  resolveNormalized(
    reference: PersistentTopologyReference,
  ): CadResult<ResolvedTopologyReference> {
    try {
      if (reference.kernelFingerprint !== this.capabilities.fingerprint) {
        return signatureFailure(
          "TOPOLOGY_FINGERPRINT_MISMATCH",
          "Persistent topology reference and current kernel descriptors are incompatible",
          {
            expected: reference.kernelFingerprint,
            actual: this.capabilities.fingerprint,
          },
        );
      }
      const universe =
        reference.topology === "face"
          ? this.snapshot.faces
          : this.snapshot.edges;
      // Candidate evidence is tolerance-independent: matchEvidence applies the
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
      const matches: {
        readonly descriptor: TopologyDescriptor;
        readonly evidence: TopologyMatchEvidence;
      }[] = [];
      for (const descriptor of universe) {
        const candidate: PersistentTopologyReference =
          descriptor.topology === "face"
            ? referenceForDescriptor(descriptor, context)
            : referenceForDescriptor(descriptor, context);
        const evidence = matchEvidence(
          compiledReference,
          this.compiler.reference(candidate),
          this.budget,
        );
        if (evidence !== undefined) matches.push({ descriptor, evidence });
      }
      if (matches.length === 0) {
        return signatureFailure(
          "TOPOLOGY_MATCH_MISSING",
          `Persistent topology reference matched no current ${reference.topology}`,
          { topology: reference.topology },
        );
      }
      if (matches.length > 1) {
        return signatureFailure(
          "TOPOLOGY_MATCH_AMBIGUOUS",
          `Persistent topology reference matched ${matches.length} current ${reference.topology}s`,
          { topology: reference.topology, candidates: matches.length },
        );
      }
      return success(
        Object.freeze({
          key: matches[0]!.descriptor.key,
          evidence: matches[0]!.evidence,
        }),
      );
    } catch (error) {
      return caughtSignatureFailure(error);
    }
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
): CadResult<TopologyReferenceResolutionSession> {
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
    if (topology !== "face" && topology !== "edge") {
      return signatureFailure(
        "TOPOLOGY_SIGNATURE_INVALID",
        "Persistent topology references support faces and edges only",
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
    const universe =
      topology === "face" ? currentSnapshot.faces : currentSnapshot.edges;
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
    const reference = referenceForDescriptor(
      descriptor as K extends "face"
        ? KernelFaceDescriptor
        : KernelEdgeDescriptor,
      context,
    );
    const budget = new MatchingWorkBudget(normalized.limits);
    const compiler = new MatchingSignatureCompiler();
    const compiledReference = compiler.reference(reference);
    let matches = 0;
    for (const candidate of universe) {
      const candidateReference = referenceForDescriptor(
        candidate as K extends "face"
          ? KernelFaceDescriptor
          : KernelEdgeDescriptor,
        context,
      );
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
        `Topology evidence identifies ${matches} ${topology}s in the capture snapshot`,
        { topology, candidates: matches },
      );
    }
    return success(reference);
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
    const normalizedReference = normalizePersistentTopologyReference<K>(
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
    ).resolveNormalized(normalizedReference.value);
  } catch (error) {
    return caughtSignatureFailure(error);
  }
}
