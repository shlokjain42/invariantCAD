import {
  diagnostic,
  safeErrorMessage,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import type { Vec3 } from "./core/math.js";
import type { NodeId, TopologyReferenceId } from "./core/ids.js";
import type { ExpressionIR } from "./expressions.js";
import type {
  TopologyQueryIR,
  TopologyReferenceEntryIR,
  TopologySelectionIR,
} from "./ir.js";
import { normalizeKernelTopologySnapshot } from "./internal/topology-snapshot.js";
import type {
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelTopologyKey,
  KernelTopologySignatureCapabilities,
  KernelTopologySnapshot,
  TopologyKind,
} from "./protocol/topology.js";
import {
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION,
  createTopologyReferenceResolutionSession,
  type ResolvedTopologyReference,
  type TopologyReferenceResolutionSession,
  type TopologySignatureLimits,
} from "./topology-signatures.js";

type KernelTopologyDescriptor = KernelFaceDescriptor | KernelEdgeDescriptor;

export interface TopologyResolutionContext {
  readonly evaluate: (expression: ExpressionIR) => number;
  readonly node?: string;
  readonly path?: string;
  readonly persistent?: {
    readonly registry: Readonly<
      Record<TopologyReferenceId, TopologyReferenceEntryIR>
    >;
    readonly input: NodeId;
    readonly capabilities: KernelTopologySignatureCapabilities;
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
        // Matching stored evidence includes one-hop opposite-kind adjacency.
        kinds.add("face");
        kinds.add("edge");
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
  return topology === "edge" ? snapshot.edges : snapshot.faces;
}

function descriptorSummary(descriptor: KernelTopologyDescriptor): Readonly<Record<string, unknown>> {
  return descriptor.topology === "edge"
    ? {
        topology: descriptor.topology,
        curve: descriptor.curve.kind,
        length: descriptor.length,
        center: descriptor.center,
        lineage: descriptor.lineage,
      }
    : {
        topology: descriptor.topology,
        surface: descriptor.surface.kind,
        area: descriptor.area,
        center: descriptor.center,
        lineage: descriptor.lineage,
      };
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
  readonly session: TopologyReferenceResolutionSession;
  readonly registry: Readonly<
    Record<TopologyReferenceId, TopologyReferenceEntryIR>
  >;
  readonly input: NodeId;
  readonly capabilities: KernelTopologySignatureCapabilities;
  readonly cache: Map<
    TopologyReferenceId,
    CachedPersistentReferenceResolution
  >;
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

function resolveSelectionOrThrow(
  selection: TopologySelectionIR,
  snapshot: KernelTopologySnapshot,
  context: TopologyResolutionContext,
  persistent: PersistentReferenceResolutionState | undefined,
): readonly KernelTopologyKey[] {
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
              `Persistent topology reference '${query.reference}' selects ${cached.topology}s, not ${selection.topology}s`,
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
        if (entry.topology !== selection.topology) {
          invalid(
            `Persistent topology reference '${query.reference}' selects ${entry.topology}s, not ${selection.topology}s`,
            referenceContext,
            {
              reference: query.reference,
              expected: selection.topology,
              actual: entry.topology,
            },
          );
        }
        if (
          entry.target?.kind !== "solid" ||
          entry.target.node !== persistent.input
        ) {
          invalid(
            `Persistent topology reference '${query.reference}' targets a different solid`,
            referenceContext,
            {
              reference: query.reference,
              expected: persistent.input,
              actual: entry.target?.node,
            },
          );
        }
        if (!Array.isArray(entry.variants)) {
          invalid(
            `Persistent topology reference '${query.reference}' has invalid variants`,
            referenceContext,
            { reference: query.reference },
          );
        }
        const variants = entry.variants.filter(
          (variant) =>
            variant.protocolVersion ===
              TOPOLOGY_SIGNATURE_PROTOCOL_VERSION &&
            variant.protocolVersion === persistent.capabilities.protocolVersion &&
            variant.kernelFingerprint === persistent.capabilities.fingerprint,
        );
        if (variants.length === 0) {
          throw new TopologyResolutionFailure(
            diagnostic(
              "TOPOLOGY_FINGERPRINT_MISMATCH",
              `Persistent topology reference '${query.reference}' has no variant compatible with the current kernel descriptors`,
              {
                ...location(referenceContext),
                details: {
                  reference: query.reference,
                  actual: {
                    protocolVersion: persistent.capabilities.protocolVersion,
                    fingerprint: persistent.capabilities.fingerprint,
                  },
                  available: entry.variants
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
        if (variants.length !== 1) {
          invalid(
            `Persistent topology reference '${query.reference}' has duplicate variants for the current kernel fingerprint`,
            referenceContext,
            {
              reference: query.reference,
              fingerprint: persistent.capabilities.fingerprint,
              variants: variants.length,
            },
          );
        }
        const variant = variants[0]!;
        if (variant.topology !== entry.topology) {
          invalid(
            `Persistent topology reference '${query.reference}' contains a variant for the wrong topology kind`,
            referenceContext,
            {
              reference: query.reference,
              expected: entry.topology,
              actual: variant.topology,
            },
          );
        }
        const result = persistent.session.resolve(variant);
        persistent.cache.set(query.reference, {
          topology: entry.topology,
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
      case "normal":
      case "direction": {
        if (
          (query.op === "normal" && selection.topology !== "face") ||
          (query.op === "direction" && selection.topology !== "edge")
        ) {
          invalid(
            `${query.op === "normal" ? "Normal" : "Direction"} queries cannot select ${selection.topology}s`,
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
                  : descriptor.curve.direction;
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
                  : descriptor.curve.radius;
              return radius !== undefined && Math.abs(radius - expected) <= tolerance;
            })
            .map((descriptor) => descriptor.key),
        );
      }
      case "adjacentTo": {
        if (query.selection.topology === selection.topology) {
          invalid("Adjacent topology selections must target the opposite topology kind", queryContext, {
            topology: selection.topology,
          });
        }
        const adjacentKeys = new Set(
          resolveSelectionOrThrow(
            query.selection,
            snapshot,
            {
              ...context,
              ...(queryPath === undefined
                ? {}
                : { path: `${queryPath}/selection` }),
            },
            persistent,
          ),
        );
        return new Set(
          universe
            .filter((descriptor) => {
              const adjacent =
                descriptor.topology === "edge" ? descriptor.faces : descriptor.edges;
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

  const matched = [...resolveQuery(selection.query, selectionPath(context, "query"))].sort();
  const { min, max } = selection.cardinality;
  if (matched.length < min) {
    throw new TopologyResolutionFailure(
      diagnostic(
        "TOPOLOGY_SELECTION_MISSING",
        `Topology selector matched ${matched.length} ${selection.topology}${matched.length === 1 ? "" : "s"}; expected at least ${min}`,
        {
          ...location(context),
          details: {
            topology: selection.topology,
            actual: matched.length,
            minimum: min,
            candidates: canonicalSummaries(universe),
            candidatesTruncated: universe.length > 20,
          },
        },
      ),
    );
  }
  if (max !== undefined && matched.length > max) {
    throw new TopologyResolutionFailure(
      diagnostic(
        "TOPOLOGY_SELECTION_AMBIGUOUS",
        `Topology selector matched ${matched.length} ${selection.topology}s; expected at most ${max}`,
        {
          ...location(context),
          details: {
            topology: selection.topology,
            actual: matched.length,
            maximum: max,
            matches: canonicalSummaries(matched.map((key) => byKey.get(key)!)),
            matchesTruncated: matched.length > 20,
          },
        },
      ),
    );
  }
  return matched;
}

export function resolveTopologySelection(
  selection: TopologySelectionIR,
  snapshot: KernelTopologySnapshot,
  context: TopologyResolutionContext,
): CadResult<readonly KernelTopologyKey[]> {
  let snapshotValidated = false;
  try {
    const requirements = topologySelectionRequirements(selection);
    let detachedSnapshot: KernelTopologySnapshot;
    let persistent: PersistentReferenceResolutionState | undefined;
    if (
      requirements.persistentReferences.length > 0 &&
      context.persistent !== undefined
    ) {
      const created = createTopologyReferenceResolutionSession(snapshot, {
        capabilities: context.persistent.capabilities,
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
      persistent = {
        session: created.value,
        registry: context.persistent.registry,
        input: context.persistent.input,
        capabilities: context.persistent.capabilities,
        cache: new Map(),
      };
    } else {
      const normalizedSnapshot = normalizeKernelTopologySnapshot(snapshot);
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
    }
    snapshotValidated = true;
    return {
      ok: true,
      value: resolveSelectionOrThrow(
        selection,
        detachedSnapshot,
        context,
        persistent,
      ),
      diagnostics: [],
    };
  } catch (error) {
    const value =
      isTopologyResolutionFailure(error)
        ? error.diagnostic
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
