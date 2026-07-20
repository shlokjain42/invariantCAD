import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import type { Vec3 } from "./core/math.js";
import { deepFreeze } from "./core/json.js";
import type { NodeId, TopologyReferenceId } from "./core/ids.js";
import type { ExpressionIR } from "./expressions.js";
import type {
  TopologyQueryIR,
  TopologyReferenceEntryIR,
  TopologySelectionIR,
} from "./ir.js";
import {
  isKernelTopologySnapshotCopyLimitError,
  normalizeKernelTopologySnapshot,
} from "./internal/topology-snapshot.js";
import { pluralTopologyKind } from "./internal/topology-language.js";
import type {
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelTopologyKey,
  KernelTopologySignatureCapabilities,
  KernelTopologySnapshot,
  KernelVertexDescriptor,
  TopologyKind,
} from "./protocol/topology.js";
import {
  DEFAULT_TOPOLOGY_SIGNATURE_LIMITS,
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1,
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2,
  createTopologyReferenceResolutionSessionGroup,
  normalizePersistentTopologyReference,
  type ResolvedTopologyReference,
  type TopologyReferenceResolutionSession,
  type TopologySignatureLimits,
} from "./topology-signatures.js";

type KernelTopologyDescriptor =
  | KernelFaceDescriptor
  | KernelEdgeDescriptor
  | KernelVertexDescriptor;

export const TOPOLOGY_SELECTION_EXPLANATION_VERSION = 1 as const;

export interface TopologySelectionResolutionExplanationBase<
  K extends TopologyKind = TopologyKind,
> {
  readonly version: typeof TOPOLOGY_SELECTION_EXPLANATION_VERSION;
  readonly topology: K;
  readonly currentHistory: KernelTopologySnapshot["history"];
  readonly candidatesConsidered: number;
  readonly candidatesMatched: number;
  readonly minimumRequired: number;
  readonly maximumAllowed: number | null;
}

/** Aggregate result of one completed topology-selection resolution pass. */
export type TopologySelectionResolutionExplanation<
  K extends TopologyKind = TopologyKind,
> =
  | (TopologySelectionResolutionExplanationBase<K> & {
      readonly outcome: "resolved";
      /** Evaluation-scoped keys for the current snapshot only. */
      readonly keys: readonly KernelTopologyKey[];
    })
  | (TopologySelectionResolutionExplanationBase<K> & {
      readonly outcome: "missing";
    })
  | (TopologySelectionResolutionExplanationBase<K> & {
      readonly outcome: "ambiguous";
      readonly maximumAllowed: number;
    });

export interface TopologyResolutionContext {
  readonly evaluate: (expression: ExpressionIR) => number;
  readonly node?: string;
  readonly path?: string;
  readonly persistent?: {
    readonly registry: Readonly<
      Record<TopologyReferenceId, TopologyReferenceEntryIR>
    >;
    readonly input: NodeId;
    /** Primary profile, or primary-first profiles for protocol compatibility. */
    readonly capabilities:
      | KernelTopologySignatureCapabilities
      | readonly KernelTopologySignatureCapabilities[];
    readonly limits?: Partial<TopologySignatureLimits>;
  };
}

export interface TopologySelectionRequirements {
  readonly kinds: readonly TopologyKind[];
  readonly provenance: boolean;
  readonly semanticRoles: boolean;
  readonly sketchSources: boolean;
  readonly geometry: boolean;
  readonly adjacency: boolean;
  readonly persistentReferences: readonly TopologyReferenceId[];
}

export function topologySelectionRequirements(
  selection: TopologySelectionIR,
): TopologySelectionRequirements {
  const kinds = new Set<TopologyKind>();
  let provenance = false;
  let semanticRoles = false;
  let sketchSources = false;
  let geometry = false;
  let adjacency = false;
  const persistentReferences = new Set<TopologyReferenceId>();
  const visitSelection = (value: TopologySelectionIR): void => {
    kinds.add(value.topology);
    visitQuery(value.query);
  };
  const visitQuery = (query: TopologyQueryIR): void => {
    switch (query.op) {
      case "all":
        break;
      case "persistentReference":
        persistentReferences.add(query.reference);
        // The exact graph requirements depend on the stored evidence protocol
        // and are checked after a compatible advertised profile is selected.
        geometry = true;
        adjacency = true;
        break;
      case "origin":
        provenance = true;
        semanticRoles ||= query.role !== undefined;
        sketchSources ||= query.source !== undefined;
        break;
      case "surface":
      case "curve":
      case "normal":
      case "direction":
      case "radius":
      case "position":
        geometry = true;
        break;
      case "adjacentTo":
        adjacency = true;
        visitSelection(query.selection);
        break;
      case "and":
      case "or":
        query.queries.forEach(visitQuery);
        break;
      case "not":
        visitQuery(query.query);
        break;
    }
  };
  visitSelection(selection);
  return {
    kinds: [...kinds].sort(),
    provenance,
    semanticRoles,
    sketchSources,
    geometry,
    adjacency,
    persistentReferences: [...persistentReferences].sort(),
  };
}

const topologyResolutionFailures = new WeakSet<object>();

class TopologyResolutionFailure extends Error {
  readonly diagnostic: Diagnostic;

  constructor(value: Diagnostic) {
    super(value.message);
    this.name = "TopologyResolutionFailure";
    this.diagnostic = value;
    topologyResolutionFailures.add(this);
  }
}

function isTopologyResolutionFailure(
  value: unknown,
): value is TopologyResolutionFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    topologyResolutionFailures.has(value)
  );
}

function location(
  context: TopologyResolutionContext,
  path = context.path,
): { readonly severity: "error"; readonly node?: string; readonly path?: string } {
  return {
    severity: "error",
    ...(context.node === undefined ? {} : { node: context.node }),
    ...(path === undefined ? {} : { path }),
  };
}

function invalid(
  message: string,
  context: TopologyResolutionContext,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new TopologyResolutionFailure(
    diagnostic("TOPOLOGY_SELECTOR_INVALID", message, {
      ...location(context),
      details,
    }),
  );
}

function descriptors(
  snapshot: KernelTopologySnapshot,
  topology: TopologyKind,
): readonly KernelTopologyDescriptor[] {
  switch (topology) {
    case "face":
      return snapshot.faces;
    case "edge":
      return snapshot.edges;
    case "vertex":
      return snapshot.vertices;
  }
}

function descriptorSummary(descriptor: KernelTopologyDescriptor): Readonly<Record<string, unknown>> {
  switch (descriptor.topology) {
    case "edge":
      return {
        topology: descriptor.topology,
        curve: descriptor.curve.kind,
        length: descriptor.length,
        center: descriptor.center,
        lineage: descriptor.lineage,
      };
    case "face":
      return {
        topology: descriptor.topology,
        surface: descriptor.surface.kind,
        area: descriptor.area,
        center: descriptor.center,
        lineage: descriptor.lineage,
      };
    case "vertex":
      return {
        topology: descriptor.topology,
        point: descriptor.point,
        lineage: descriptor.lineage,
      };
  }
}

function canonicalSummaries(
  values: readonly KernelTopologyDescriptor[],
): readonly Readonly<Record<string, unknown>>[] {
  return values
    .map(descriptorSummary)
    .sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)))
    .slice(0, 20);
}

function normalized(value: Vec3, context: TopologyResolutionContext): Vec3 {
  const magnitude = Math.hypot(...value);
  if (!(magnitude > Number.EPSILON)) {
    invalid("Topology direction vectors cannot be zero", context, { value });
  }
  return value.map((component) => component / magnitude) as unknown as Vec3;
}

function angularDistance(first: Vec3, second: Vec3, unoriented: boolean): number {
  const dot = Math.max(
    -1,
    Math.min(
      1,
      first[0] * second[0] + first[1] * second[1] + first[2] * second[2],
    ),
  );
  return Math.acos(unoriented ? Math.abs(dot) : dot);
}

function selectionPath(context: TopologyResolutionContext, suffix: string): string | undefined {
  return context.path === undefined ? undefined : `${context.path}/${suffix}`;
}

interface CachedPersistentReferenceResolution {
  readonly topology: TopologyKind;
  readonly result: CadResult<ResolvedTopologyReference>;
}

interface PersistentReferenceResolutionState {
  readonly profiles: readonly KernelTopologySignatureCapabilities[];
  readonly sessions: ReadonlyMap<string, TopologyReferenceResolutionSession>;
  readonly limits: TopologySignatureLimits;
  readonly registry: Readonly<
    Record<TopologyReferenceId, TopologyReferenceEntryIR>
  >;
  readonly input: NodeId;
  readonly cache: Map<
    TopologyReferenceId,
    CachedPersistentReferenceResolution
  >;
  readonly maxReferenceVariants: number;
  referenceVariants: number;
}

function signatureProfileKey(
  profile: KernelTopologySignatureCapabilities,
): string {
  return `${profile.protocolVersion}\u0000${profile.fingerprint}`;
}

function signatureProfiles(
  value:
    | KernelTopologySignatureCapabilities
    | readonly KernelTopologySignatureCapabilities[],
  context: TopologyResolutionContext,
): readonly KernelTopologySignatureCapabilities[] {
  const rawProfiles: readonly unknown[] = Array.isArray(value) ? value : [value];
  const profileCount = rawProfiles.length;
  if (profileCount === 0) {
    invalid("Persistent topology signature profiles cannot be empty", context);
  }
  if (profileCount > 2) {
    invalid("Persistent topology signature profiles exceed the supported protocol count", context, {
      maximum: 2,
      actual: profileCount,
    });
  }
  const profiles: KernelTopologySignatureCapabilities[] = [];
  const protocols = new Set<number>();
  let primaryProtocol: number | undefined;
  for (let index = 0; index < profileCount; index += 1) {
    if (!Object.hasOwn(rawProfiles, index)) {
      invalid("Persistent topology signature profiles cannot be sparse", context);
    }
    const raw = rawProfiles[index];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      invalid("Persistent topology signature profiles are malformed", context);
    }
    const profile = raw as Readonly<Record<string, unknown>>;
    const keys = Object.keys(profile).sort();
    const protocolVersion = profile.protocolVersion;
    const fingerprint = profile.fingerprint;
    if (
      keys.length !== 2 ||
      keys[0] !== "fingerprint" ||
      keys[1] !== "protocolVersion" ||
      (protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1 &&
        protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2) ||
      typeof fingerprint !== "string" ||
      fingerprint.length === 0
    ) {
      invalid("Persistent topology signature profiles are malformed", context);
    }
    if (index === 0) {
      primaryProtocol = protocolVersion;
    } else if (protocolVersion >= primaryProtocol!) {
      invalid("Persistent topology compatibility profiles must be older than the primary protocol", context, {
        primaryProtocolVersion: primaryProtocol,
        compatibilityProtocolVersion: protocolVersion,
      });
    }
    if (protocols.has(protocolVersion)) {
      invalid("Persistent topology signature profiles cannot repeat a protocol", context, {
        protocolVersion,
      });
    }
    protocols.add(protocolVersion);
    profiles.push(Object.freeze({ protocolVersion, fingerprint }));
  }
  return Object.freeze(profiles);
}

function persistentFailure(
  result: CadResult<unknown>,
  reference: TopologyReferenceId,
  context: TopologyResolutionContext,
): never {
  const source = result.diagnostics[0] ??
    diagnostic(
      "TOPOLOGY_SIGNATURE_INVALID",
      "Persistent topology reference resolution failed without a diagnostic",
      { severity: "error" },
    );
  throw new TopologyResolutionFailure({
    ...source,
    ...location(context),
    details: {
      ...source.details,
      reference,
    },
  });
}

interface TopologySelectionAnalysis<K extends TopologyKind = TopologyKind> {
  readonly topology: K;
  readonly currentHistory: KernelTopologySnapshot["history"];
  readonly universe: readonly KernelTopologyDescriptor[];
  readonly byKey: ReadonlyMap<KernelTopologyKey, KernelTopologyDescriptor>;
  /** A fresh, sorted array owned by this analysis. */
  readonly matched: KernelTopologyKey[];
  readonly minimumRequired: number;
  readonly maximumAllowed: number | null;
}

function explanationFromSelectionAnalysis<K extends TopologyKind>(
  analysis: TopologySelectionAnalysis<K>,
): TopologySelectionResolutionExplanation<K> {
  const base = {
    version: TOPOLOGY_SELECTION_EXPLANATION_VERSION,
    topology: analysis.topology,
    currentHistory: analysis.currentHistory,
    candidatesConsidered: analysis.universe.length,
    candidatesMatched: analysis.matched.length,
    minimumRequired: analysis.minimumRequired,
    maximumAllowed: analysis.maximumAllowed,
  } as const;
  return deepFreeze(
    analysis.matched.length < analysis.minimumRequired
      ? { ...base, outcome: "missing" as const }
      : analysis.maximumAllowed !== null &&
          analysis.matched.length > analysis.maximumAllowed
        ? {
            ...base,
            outcome: "ambiguous" as const,
            maximumAllowed: analysis.maximumAllowed,
          }
        : {
            ...base,
            outcome: "resolved" as const,
            keys: [...analysis.matched],
          },
  ) as TopologySelectionResolutionExplanation<K>;
}

function resolutionFromSelectionAnalysis(
  analysis: TopologySelectionAnalysis,
  context: TopologyResolutionContext,
): CadResult<readonly KernelTopologyKey[]> {
  if (analysis.matched.length < analysis.minimumRequired) {
    const explanation = explanationFromSelectionAnalysis(analysis);
    return failure(
      diagnostic(
        "TOPOLOGY_SELECTION_MISSING",
        `Topology selector matched ${analysis.matched.length} ${analysis.matched.length === 1 ? analysis.topology : pluralTopologyKind(analysis.topology)}; expected at least ${analysis.minimumRequired}`,
        {
          ...location(context),
          details: {
            topology: analysis.topology,
            actual: analysis.matched.length,
            minimum: analysis.minimumRequired,
            candidates: canonicalSummaries(analysis.universe),
            candidatesTruncated: analysis.universe.length > 20,
            explanation,
          },
        },
      ),
    );
  }
  if (
    analysis.maximumAllowed !== null &&
    analysis.matched.length > analysis.maximumAllowed
  ) {
    const explanation = explanationFromSelectionAnalysis(analysis);
    return failure(
      diagnostic(
        "TOPOLOGY_SELECTION_AMBIGUOUS",
        `Topology selector matched ${analysis.matched.length} ${pluralTopologyKind(analysis.topology)}; expected at most ${analysis.maximumAllowed}`,
        {
          ...location(context),
          details: {
            topology: analysis.topology,
            actual: analysis.matched.length,
            maximum: analysis.maximumAllowed,
            matches: canonicalSummaries(
              analysis.matched.map((key) => analysis.byKey.get(key)!),
            ),
            matchesTruncated: analysis.matched.length > 20,
            explanation,
          },
        },
      ),
    );
  }
  // Preserve the legacy successful result's runtime-mutability contract. The
  // fresh matched array is not shared with an explanation projection.
  return success(analysis.matched);
}

function analyzeSelectionOrThrow<K extends TopologyKind>(
  selection: TopologySelectionIR<K>,
  snapshot: KernelTopologySnapshot,
  context: TopologyResolutionContext,
  persistent: PersistentReferenceResolutionState | undefined,
): TopologySelectionAnalysis<K> {
  if (
    !Number.isInteger(selection.cardinality.min) ||
    selection.cardinality.min < 1 ||
    (selection.cardinality.max !== undefined &&
      (!Number.isInteger(selection.cardinality.max) ||
        selection.cardinality.max < selection.cardinality.min))
  ) {
    invalid("Topology selection cardinality is invalid", context, {
      cardinality: selection.cardinality,
    });
  }

  const universe = descriptors(snapshot, selection.topology);
  const byKey = new Map(universe.map((descriptor) => [descriptor.key, descriptor]));

  const evaluateVector = (values: readonly [ExpressionIR, ExpressionIR, ExpressionIR]): Vec3 =>
    values.map(context.evaluate) as unknown as Vec3;

  const resolveQuery = (
    query: TopologyQueryIR,
    queryPath: string | undefined,
  ): Set<KernelTopologyKey> => {
    const queryContext: TopologyResolutionContext = {
      ...context,
      ...(queryPath === undefined ? {} : { path: queryPath }),
    };
    switch (query.op) {
      case "all":
        return new Set(byKey.keys());
      case "persistentReference": {
        const referenceContext: TopologyResolutionContext = {
          ...queryContext,
          ...(queryPath === undefined
            ? {}
            : { path: `${queryPath}/reference` }),
        };
        if (persistent === undefined) {
          invalid(
            "Persistent topology reference resolution context is unavailable",
            referenceContext,
            { reference: query.reference },
          );
        }
        const cached = persistent.cache.get(query.reference);
        if (cached !== undefined) {
          if (cached.topology !== selection.topology) {
            invalid(
              `Persistent topology reference '${query.reference}' selects ${pluralTopologyKind(cached.topology)}, not ${pluralTopologyKind(selection.topology)}`,
              referenceContext,
              {
                reference: query.reference,
                expected: selection.topology,
                actual: cached.topology,
              },
            );
          }
          if (!cached.result.ok) {
            persistentFailure(cached.result, query.reference, referenceContext);
          }
          return new Set([cached.result.value.key]);
        }
        if (!Object.hasOwn(persistent.registry, query.reference)) {
          invalid(
            `Persistent topology reference '${query.reference}' is missing`,
            referenceContext,
            { reference: query.reference },
          );
        }
        const entry = persistent.registry[query.reference];
        if (entry === undefined) {
          invalid(
            `Persistent topology reference '${query.reference}' is missing`,
            referenceContext,
            { reference: query.reference },
          );
        }
        const entryTopology = entry.topology;
        const entryTarget = entry.target;
        const entryTargetKind = entryTarget?.kind;
        const entryTargetNode = entryTarget?.node;
        const rawVariants: unknown = entry.variants;
        if (entryTopology !== selection.topology) {
          invalid(
            `Persistent topology reference '${query.reference}' selects ${pluralTopologyKind(entryTopology)}, not ${pluralTopologyKind(selection.topology)}`,
            referenceContext,
            {
              reference: query.reference,
              expected: selection.topology,
              actual: entryTopology,
            },
          );
        }
        if (
          entryTargetKind !== "solid" ||
          entryTargetNode !== persistent.input
        ) {
          invalid(
            `Persistent topology reference '${query.reference}' targets a different solid`,
            referenceContext,
            {
              reference: query.reference,
              expected: persistent.input,
              actual: entryTargetNode,
            },
          );
        }
        if (!Array.isArray(rawVariants)) {
          invalid(
            `Persistent topology reference '${query.reference}' has invalid variants`,
            referenceContext,
            { reference: query.reference },
          );
        }
        const variantCount = rawVariants.length;
        if (!Number.isSafeInteger(variantCount) || variantCount < 1) {
          invalid(
            `Persistent topology reference '${query.reference}' has an invalid variant count`,
            referenceContext,
            {
              reference: query.reference,
              actual: variantCount,
            },
          );
        }
        const totalVariants = persistent.referenceVariants + variantCount;
        if (totalVariants > persistent.maxReferenceVariants) {
          throw new TopologyResolutionFailure(
            diagnostic(
              "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
              `Topology-signature maxReferenceVariants limit ${persistent.maxReferenceVariants} was exceeded by ${totalVariants}`,
              {
                ...location(referenceContext),
                details: {
                  reference: query.reference,
                  resource: "maxReferenceVariants",
                  limit: persistent.maxReferenceVariants,
                  actual: totalVariants,
                },
              },
            ),
          );
        }
        persistent.referenceVariants = totalVariants;
        const variants = new Array<{
          readonly value: (typeof entry.variants)[number];
          readonly protocolVersion: number;
          readonly kernelFingerprint: string;
        }>(variantCount);
        for (let index = 0; index < variantCount; index += 1) {
          if (!Object.hasOwn(rawVariants, index)) {
            invalid(
              `Persistent topology reference '${query.reference}' has sparse variants`,
              referenceContext,
              { reference: query.reference, index },
            );
          }
          const value = rawVariants[index] as (typeof entry.variants)[number];
          variants[index] = {
            value,
            protocolVersion: value.protocolVersion,
            kernelFingerprint: value.kernelFingerprint,
          };
        }
        let compatible:
          | {
              readonly profile: KernelTopologySignatureCapabilities;
              readonly variant: (typeof entry.variants)[number];
            }
          | undefined;
        for (const profile of persistent.profiles) {
          const matchingVariants = variants.filter(
            (variant) =>
              variant.protocolVersion === profile.protocolVersion &&
              variant.kernelFingerprint === profile.fingerprint,
          );
          if (matchingVariants.length > 1) {
            invalid(
              `Persistent topology reference '${query.reference}' has duplicate variants for a kernel fingerprint`,
              referenceContext,
              {
                reference: query.reference,
                protocolVersion: profile.protocolVersion,
                fingerprint: profile.fingerprint,
                variants: matchingVariants.length,
              },
            );
          }
          if (matchingVariants.length === 1) {
            compatible = { profile, variant: matchingVariants[0]!.value };
            break;
          }
        }
        if (compatible === undefined) {
          throw new TopologyResolutionFailure(
            diagnostic(
              "TOPOLOGY_FINGERPRINT_MISMATCH",
              `Persistent topology reference '${query.reference}' has no variant compatible with the current kernel descriptors`,
              {
                ...location(referenceContext),
                details: {
                  reference: query.reference,
                  actual: persistent.profiles.map((profile) => ({
                    protocolVersion: profile.protocolVersion,
                    fingerprint: profile.fingerprint,
                  })),
                  available: variants
                    .map((variant) => ({
                      protocolVersion: variant.protocolVersion,
                      kernelFingerprint: variant.kernelFingerprint,
                    }))
                    .sort((first, second) =>
                      first.kernelFingerprint.localeCompare(
                        second.kernelFingerprint,
                      ),
                    ),
                },
              },
            ),
          );
        }
        const { profile, variant: rawVariant } = compatible;
        const normalizedVariant = normalizePersistentTopologyReference(
          rawVariant,
          { limits: persistent.limits },
        );
        if (!normalizedVariant.ok) {
          persistentFailure(
            normalizedVariant,
            query.reference,
            referenceContext,
          );
        }
        const variant = normalizedVariant.value;
        if (
          variant.protocolVersion !== profile.protocolVersion ||
          variant.kernelFingerprint !== profile.fingerprint
        ) {
          persistentFailure(
            failure(
              diagnostic(
                "TOPOLOGY_SIGNATURE_INVALID",
                `Persistent topology reference '${query.reference}' changed while its compatible variant was read`,
                {
                  severity: "error",
                  details: {
                    expectedProtocolVersion: profile.protocolVersion,
                    actualProtocolVersion: variant.protocolVersion,
                    expectedFingerprint: profile.fingerprint,
                    actualFingerprint: variant.kernelFingerprint,
                  },
                },
              ),
            ),
            query.reference,
            referenceContext,
          );
        }
        if (variant.topology !== entryTopology) {
          invalid(
            `Persistent topology reference '${query.reference}' contains a variant for the wrong topology kind`,
            referenceContext,
            {
              reference: query.reference,
              expected: entryTopology,
              actual: variant.topology,
            },
          );
        }
        const session = persistent.sessions.get(signatureProfileKey(profile));
        if (session === undefined) {
          invalid(
            "Persistent topology signature session is unavailable",
            referenceContext,
            {
              protocolVersion: profile.protocolVersion,
              fingerprint: profile.fingerprint,
            },
          );
        }
        const result = session.resolve(variant);
        if (result.ok && !byKey.has(result.value.key)) {
          persistentFailure(
            failure(
              diagnostic(
                "TOPOLOGY_SIGNATURE_INVALID",
                `Persistent topology reference '${query.reference}' resolved outside the selected topology universe`,
                {
                  severity: "error",
                  details: {
                    topology: entryTopology,
                    key: result.value.key,
                  },
                },
              ),
            ),
            query.reference,
            referenceContext,
          );
        }
        persistent.cache.set(query.reference, {
          topology: entryTopology,
          result,
        });
        if (!result.ok) {
          persistentFailure(result, query.reference, referenceContext);
        }
        return new Set([result.value.key]);
      }
      case "origin": {
        if (snapshot.history !== "complete") {
          throw new TopologyResolutionFailure(
            diagnostic(
              "TOPOLOGY_HISTORY_UNAVAILABLE",
              `Topology history is incomplete for origin query '${query.feature}'`,
              {
                ...location(queryContext),
                details: {
                  feature: query.feature,
                  relation: query.relation,
                  history: snapshot.history,
                },
              },
            ),
          );
        }
        return new Set(
          universe
            .filter((descriptor) =>
              descriptor.lineage.some(
                (lineage) =>
                  lineage.feature === query.feature &&
                  lineage.relation === query.relation &&
                  (query.role === undefined || lineage.role === query.role) &&
                  (query.source === undefined ||
                    (lineage.source?.kind === query.source.kind &&
                      lineage.source.sketch === query.source.sketch &&
                      lineage.source.entity === query.source.entity)),
              ),
            )
            .map((descriptor) => descriptor.key),
        );
      }
      case "surface":
        if (selection.topology !== "face") {
          invalid("Surface queries can only select faces", queryContext, {
            topology: selection.topology,
          });
        }
        return new Set(
          snapshot.faces
            .filter((face) => face.surface.kind === query.kind)
            .map((face) => face.key),
        );
      case "curve":
        if (selection.topology !== "edge") {
          invalid("Curve queries can only select edges", queryContext, {
            topology: selection.topology,
          });
        }
        return new Set(
          snapshot.edges
            .filter((edge) => edge.curve.kind === query.kind)
            .map((edge) => edge.key),
        );
      case "position": {
        if (selection.topology !== "vertex") {
          invalid("Position queries can only select vertices", queryContext, {
            topology: selection.topology,
          });
        }
        const expected = evaluateVector(query.value);
        if (!expected.every(Number.isFinite)) {
          invalid("Topology position coordinates must be finite", queryContext, {
            value: expected,
          });
        }
        const tolerance = context.evaluate(query.tolerance);
        if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
          invalid("Topology position tolerance must be positive", queryContext, {
            tolerance,
          });
        }
        return new Set(
          snapshot.vertices
            .filter((vertex) =>
              vertex.point.every(
                (component, index) =>
                  Math.abs(component - expected[index]!) <= tolerance,
              ),
            )
            .map((vertex) => vertex.key),
        );
      }
      case "normal":
      case "direction": {
        if (
          (query.op === "normal" && selection.topology !== "face") ||
          (query.op === "direction" && selection.topology !== "edge")
        ) {
          invalid(
            `${query.op === "normal" ? "Normal" : "Direction"} queries cannot select ${pluralTopologyKind(selection.topology)}`,
            queryContext,
          );
        }
        const desired = normalized(evaluateVector(query.value), queryContext);
        const tolerance = context.evaluate(query.tolerance);
        if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
          invalid("Topology angular tolerance must be positive", queryContext, {
            tolerance,
          });
        }
        return new Set(
          universe
            .filter((descriptor) => {
              const value =
                descriptor.topology === "face"
                  ? descriptor.surface.normal
                  : descriptor.topology === "edge"
                    ? descriptor.curve.direction
                    : undefined;
              if (value === undefined) return false;
              return (
                angularDistance(
                  desired,
                  normalized(value, queryContext),
                  descriptor.topology === "edge",
                ) <= tolerance
              );
            })
            .map((descriptor) => descriptor.key),
        );
      }
      case "radius": {
        if (selection.topology === "vertex") {
          invalid("Radius queries cannot select vertices", queryContext, {
            topology: selection.topology,
          });
        }
        const expected = context.evaluate(query.value);
        const tolerance = context.evaluate(query.tolerance);
        if (!(expected >= 0) || !Number.isFinite(expected)) {
          invalid("Topology radius must be finite and non-negative", queryContext, {
            radius: expected,
          });
        }
        if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
          invalid("Topology radius tolerance must be positive", queryContext, {
            tolerance,
          });
        }
        return new Set(
          universe
            .filter((descriptor) => {
              const radius =
                descriptor.topology === "face"
                  ? descriptor.surface.radius
                  : descriptor.topology === "edge"
                    ? descriptor.curve.radius
                    : undefined;
              return radius !== undefined && Math.abs(radius - expected) <= tolerance;
            })
            .map((descriptor) => descriptor.key),
        );
      }
      case "adjacentTo": {
        const adjacentTopology = query.selection.topology;
        const legal =
          (selection.topology === "face" && adjacentTopology === "edge") ||
          (selection.topology === "edge" &&
            (adjacentTopology === "face" || adjacentTopology === "vertex")) ||
          (selection.topology === "vertex" && adjacentTopology === "edge");
        if (!legal) {
          invalid("Topology selections are not directly adjacent", queryContext, {
            topology: selection.topology,
            adjacentTopology,
          });
        }
        const adjacentContext: TopologyResolutionContext = {
          ...context,
          ...(queryPath === undefined
            ? {}
            : { path: `${queryPath}/selection` }),
        };
        const adjacentAnalysis = analyzeSelectionOrThrow(
          query.selection,
          snapshot,
          adjacentContext,
          persistent,
        );
        const adjacentResolution = resolutionFromSelectionAnalysis(
          adjacentAnalysis,
          adjacentContext,
        );
        if (!adjacentResolution.ok) {
          throw new TopologyResolutionFailure(
            adjacentResolution.diagnostics[0] ??
              diagnostic(
                "TOPOLOGY_SELECTOR_INVALID",
                "Nested topology selection failed without a diagnostic",
                location(queryContext),
              ),
          );
        }
        const adjacentKeys = new Set(adjacentResolution.value);
        return new Set(
          universe
            .filter((descriptor) => {
              const adjacent =
                descriptor.topology === "face"
                  ? descriptor.edges
                  : descriptor.topology === "vertex"
                    ? descriptor.edges
                    : adjacentTopology === "face"
                      ? descriptor.faces
                      : descriptor.vertices;
              return adjacent.some((key) => adjacentKeys.has(key));
            })
            .map((descriptor) => descriptor.key),
        );
      }
      case "and": {
        if (query.queries.length === 0) {
          invalid("Topology 'and' queries require at least one operand", queryContext);
        }
        const [first, ...rest] = query.queries.map((child, index) =>
          resolveQuery(child, queryPath === undefined ? undefined : `${queryPath}/queries/${index}`),
        );
        const result = new Set(first);
        for (const values of rest) {
          for (const key of result) if (!values.has(key)) result.delete(key);
        }
        return result;
      }
      case "or": {
        if (query.queries.length === 0) {
          invalid("Topology 'or' queries require at least one operand", queryContext);
        }
        const result = new Set<KernelTopologyKey>();
        query.queries.forEach((child, index) => {
          for (const key of resolveQuery(
            child,
            queryPath === undefined ? undefined : `${queryPath}/queries/${index}`,
          )) {
            result.add(key);
          }
        });
        return result;
      }
      case "not": {
        const excluded = resolveQuery(
          query.query,
          queryPath === undefined ? undefined : `${queryPath}/query`,
        );
        return new Set([...byKey.keys()].filter((key) => !excluded.has(key)));
      }
    }
  };

  const matched = [
    ...resolveQuery(selection.query, selectionPath(context, "query")),
  ].sort();
  const { min, max } = selection.cardinality;
  return {
    topology: selection.topology,
    currentHistory: snapshot.history,
    universe,
    byKey,
    matched,
    minimumRequired: min,
    maximumAllowed: max ?? null,
  };
}

function runTopologySelection<K extends TopologyKind, T>(
  selection: TopologySelectionIR<K>,
  snapshot: KernelTopologySnapshot,
  context: TopologyResolutionContext,
  project: (analysis: TopologySelectionAnalysis<K>) => CadResult<T>,
): CadResult<T> {
  let snapshotValidated = false;
  try {
    const requirements = topologySelectionRequirements(selection);
    const profiles =
      requirements.persistentReferences.length > 0 &&
      context.persistent !== undefined
        ? signatureProfiles(context.persistent.capabilities, context)
        : undefined;
    let detachedSnapshot: KernelTopologySnapshot;
    let persistent: PersistentReferenceResolutionState | undefined;
    if (
      requirements.persistentReferences.length > 0 &&
      context.persistent !== undefined
    ) {
      const created = createTopologyReferenceResolutionSessionGroup(snapshot, {
        capabilities: profiles!,
        ...(context.persistent.limits === undefined
          ? {}
          : { limits: context.persistent.limits }),
      });
      if (!created.ok) {
        return {
          ok: false,
          diagnostics: created.diagnostics.map((item) => ({
            ...item,
            ...location(context),
          })),
        };
      }
      detachedSnapshot = created.value.snapshot;
      const sessions = new Map<string, TopologyReferenceResolutionSession>();
      for (const profile of created.value.profiles) {
        sessions.set(
          signatureProfileKey(profile.capabilities),
          profile.session,
        );
      }
      persistent = {
        profiles: created.value.profiles.map((profile) => profile.capabilities),
        sessions,
        limits: created.value.limits,
        registry: context.persistent.registry,
        input: context.persistent.input,
        cache: new Map(),
        maxReferenceVariants: created.value.limits.maxReferenceVariants,
        referenceVariants: 0,
      };
    } else {
      const snapshotLimits =
        requirements.persistentReferences.length === 0
          ? undefined
          : {
              maxTopologyItems:
                DEFAULT_TOPOLOGY_SIGNATURE_LIMITS.maxTopologyItems,
              maxAdjacencyLinks:
                DEFAULT_TOPOLOGY_SIGNATURE_LIMITS.maxAdjacencyLinks,
              maxEvidenceRecords:
                DEFAULT_TOPOLOGY_SIGNATURE_LIMITS.maxEvidenceRecords,
            };
      const normalizedSnapshot = normalizeKernelTopologySnapshot(
        snapshot,
        snapshotLimits,
      );
      if (!normalizedSnapshot.ok) {
        return {
          ok: false,
          diagnostics: normalizedSnapshot.diagnostics.map((item) => ({
            ...item,
            ...location(context),
          })),
        };
      }
      detachedSnapshot = normalizedSnapshot.value;
      // A persistent atom without a context is rejected at its exact query path.
      persistent = undefined;
    }
    snapshotValidated = true;
    return project(
      analyzeSelectionOrThrow(
        selection,
        detachedSnapshot,
        context,
        persistent,
      ),
    );
  } catch (error) {
    const value = isTopologyResolutionFailure(error)
      ? error.diagnostic
      : isKernelTopologySnapshotCopyLimitError(error)
        ? diagnostic("TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED", error.message, {
            ...location(context),
            details: {
              resource: error.resource,
              limit: error.limit,
              actual: error.actual,
            },
          })
        : diagnostic(
            snapshotValidated ? "TOPOLOGY_SELECTOR_INVALID" : "KERNEL_ERROR",
            safeErrorMessage(error, "Topology selector input could not be read"),
            {
              ...location(context),
              ...(snapshotValidated
                ? {}
                : { details: { protocolViolation: true } }),
            },
          );
    return { ok: false, diagnostics: [value] };
  }
}

export function resolveTopologySelection<K extends TopologyKind>(
  selection: TopologySelectionIR<K>,
  snapshot: KernelTopologySnapshot,
  context: TopologyResolutionContext,
): CadResult<readonly KernelTopologyKey[]> {
  return runTopologySelection(
    selection,
    snapshot,
    context,
    (analysis) => resolutionFromSelectionAnalysis(analysis, context),
  );
}

/**
 * Explains one completed topology-selection pass. Missing and ambiguous
 * cardinality are successful explanation outcomes; malformed inputs and nested
 * selection failures remain failed CadResults.
 */
export function explainTopologySelection<K extends TopologyKind>(
  selection: TopologySelectionIR<K>,
  snapshot: KernelTopologySnapshot,
  context: TopologyResolutionContext,
): CadResult<TopologySelectionResolutionExplanation<K>> {
  return runTopologySelection(
    selection,
    snapshot,
    context,
    (analysis) => success(explanationFromSelectionAnalysis(analysis)),
  );
}
