import { diagnostic, type CadResult, type Diagnostic } from "./core/result.js";
import type { Vec3 } from "./core/math.js";
import type { ExpressionIR } from "./expressions.js";
import type { TopologyQueryIR, TopologySelectionIR } from "./ir.js";
import {
  TOPOLOGY_ROLE_RULES,
  type TopologyRole,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
  type TopologyKind,
} from "./protocol/topology.js";

type KernelTopologyDescriptor = KernelFaceDescriptor | KernelEdgeDescriptor;

export interface TopologyResolutionContext {
  readonly evaluate: (expression: ExpressionIR) => number;
  readonly node?: string;
  readonly path?: string;
}

export interface TopologySelectionRequirements {
  readonly kinds: readonly TopologyKind[];
  readonly provenance: boolean;
  readonly semanticRoles: boolean;
  readonly sketchSources: boolean;
  readonly geometry: boolean;
  readonly adjacency: boolean;
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
  const visitSelection = (value: TopologySelectionIR): void => {
    kinds.add(value.topology);
    visitQuery(value.query);
  };
  const visitQuery = (query: TopologyQueryIR): void => {
    switch (query.op) {
      case "all":
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
  };
}

class TopologyResolutionFailure extends Error {
  readonly diagnostic: Diagnostic;

  constructor(value: Diagnostic) {
    super(value.message);
    this.name = "TopologyResolutionFailure";
    this.diagnostic = value;
  }
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

function recordValue(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSnapshot(
  snapshot: KernelTopologySnapshot,
  context: TopologyResolutionContext,
): void {
  function fail(
    message: string,
    details: Readonly<Record<string, unknown>>,
  ): never {
    throw new TopologyResolutionFailure(
      diagnostic("KERNEL_ERROR", message, {
        ...location(context),
        details: { ...details, protocolViolation: true },
      }),
    );
  }

  const rawSnapshot: unknown = snapshot;
  if (!recordValue(rawSnapshot)) {
    fail("Geometry kernel returned an invalid topology snapshot", {});
  }
  if (rawSnapshot.history !== "complete" && rawSnapshot.history !== "partial") {
    fail("Geometry kernel returned an invalid topology history status", {
      history: rawSnapshot.history,
    });
  }
  if (!Array.isArray(rawSnapshot.faces) || !Array.isArray(rawSnapshot.edges)) {
    fail("Geometry kernel returned invalid topology collections", {});
  }

  const vector = (value: unknown): value is Vec3 =>
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) =>
      typeof component === "number" && Number.isFinite(component),
    );
  const topologyKeys = (
    value: unknown,
    topology: TopologyKind,
    adjacency: "faces" | "edges",
  ): value is readonly KernelTopologyKey[] => {
    if (
      !Array.isArray(value) ||
      value.some((key) => typeof key !== "string" || key.length === 0) ||
      new Set(value).size !== value.length
    ) {
      fail("Geometry kernel returned invalid topology adjacency", {
        topology,
        adjacency,
      });
    }
    return true;
  };
  const lineage = (value: unknown, topology: TopologyKind): void => {
    if (!Array.isArray(value)) {
      fail("Geometry kernel returned invalid topology lineage", { topology });
    }
    for (const rawLineage of value) {
      if (!recordValue(rawLineage)) {
        fail("Geometry kernel returned invalid topology lineage", { topology });
      }
      if (
        typeof rawLineage.feature !== "string" ||
        rawLineage.feature.length === 0 ||
        (rawLineage.relation !== "created" &&
          rawLineage.relation !== "modified")
      ) {
        fail("Geometry kernel returned invalid topology lineage", { topology });
      }
      if (rawLineage.role !== undefined) {
        if (typeof rawLineage.role !== "string") {
          fail("Geometry kernel returned invalid semantic topology lineage", {
            topology,
          });
        }
        const rule = TOPOLOGY_ROLE_RULES[rawLineage.role as TopologyRole] as
          | (typeof TOPOLOGY_ROLE_RULES)[TopologyRole]
          | undefined;
        if (
          rule === undefined ||
          rule.topology !== topology ||
          rule.relation !== rawLineage.relation ||
          (rawLineage.source !== undefined && rule.source !== "sketch-curve")
        ) {
          fail("Geometry kernel returned invalid semantic topology lineage", {
            topology,
            role: rawLineage.role,
          });
        }
      }
      if (rawLineage.source !== undefined) {
        if (
          !recordValue(rawLineage.source) ||
          rawLineage.relation !== "created" ||
          rawLineage.source.kind !== "sketch-entity" ||
          typeof rawLineage.source.sketch !== "string" ||
          rawLineage.source.sketch.length === 0 ||
          typeof rawLineage.source.entity !== "string" ||
          rawLineage.source.entity.length === 0
        ) {
          fail("Geometry kernel returned invalid topology source lineage", {
            topology,
          });
        }
      }
    }
  };
  const geometry = (value: unknown, topology: TopologyKind): void => {
    if (
      !recordValue(value) ||
      typeof value.kind !== "string" ||
      value.kind.length === 0
    ) {
      fail("Geometry kernel returned invalid topology geometry", { topology });
    }
    for (const direction of [value.normal, value.direction, value.axis]) {
      if (
        direction !== undefined &&
        (!vector(direction) || !(Math.hypot(...direction) > Number.EPSILON))
      ) {
        fail("Geometry kernel returned an invalid topology direction", {
          topology,
        });
      }
    }
    if (
      value.radius !== undefined &&
      (typeof value.radius !== "number" ||
        !Number.isFinite(value.radius) ||
        value.radius < 0)
    ) {
      fail("Geometry kernel returned an invalid topology radius", { topology });
    }
  };

  const keys = new Set<KernelTopologyKey>();
  const validateDescriptor = (
    rawDescriptor: unknown,
    topology: TopologyKind,
  ): void => {
    if (
      !recordValue(rawDescriptor) ||
      rawDescriptor.topology !== topology ||
      typeof rawDescriptor.key !== "string" ||
      rawDescriptor.key.length === 0 ||
      !vector(rawDescriptor.center) ||
      !recordValue(rawDescriptor.bounds) ||
      !vector(rawDescriptor.bounds.min) ||
      !vector(rawDescriptor.bounds.max)
    ) {
      fail("Geometry kernel returned an invalid topology descriptor", {
        topology,
      });
    }
    const bounds = rawDescriptor.bounds as {
      readonly min: Vec3;
      readonly max: Vec3;
    };
    if (bounds.min.some((minimum, index) => minimum > bounds.max[index]!)) {
      fail("Geometry kernel returned invalid topology bounds", { topology });
    }
    const key = rawDescriptor.key as KernelTopologyKey;
    if (keys.has(key)) {
      fail("Geometry kernel returned a duplicate topology key", {
        topology,
      });
    }
    keys.add(key);
    lineage(rawDescriptor.lineage, topology);
    if (topology === "face") {
      if (
        typeof rawDescriptor.area !== "number" ||
        !Number.isFinite(rawDescriptor.area) ||
        rawDescriptor.area < 0
      ) {
        fail("Geometry kernel returned invalid topology measure", { topology });
      }
      geometry(rawDescriptor.surface, topology);
      topologyKeys(rawDescriptor.edges, topology, "edges");
    } else {
      if (
        typeof rawDescriptor.length !== "number" ||
        !Number.isFinite(rawDescriptor.length) ||
        rawDescriptor.length < 0
      ) {
        fail("Geometry kernel returned invalid topology measure", { topology });
      }
      geometry(rawDescriptor.curve, topology);
      topologyKeys(rawDescriptor.faces, topology, "faces");
    }
  };

  rawSnapshot.faces.forEach((face) => validateDescriptor(face, "face"));
  rawSnapshot.edges.forEach((edge) => validateDescriptor(edge, "edge"));
  const faces = rawSnapshot.faces as unknown as readonly KernelFaceDescriptor[];
  const edges = rawSnapshot.edges as unknown as readonly KernelEdgeDescriptor[];
  const faceKeys = new Set(faces.map((face) => face.key));
  const edgeKeys = new Set(edges.map((edge) => edge.key));
  const faceByKey = new Map(faces.map((face) => [face.key, face]));
  const edgeByKey = new Map(edges.map((edge) => [edge.key, edge]));
  for (const face of faces) {
    for (const edgeKey of face.edges) {
      const edge = edgeByKey.get(edgeKey);
      if (edge === undefined || !edge.faces.includes(face.key)) {
        fail("Geometry kernel returned invalid face-to-edge adjacency", {
          topology: "face",
          dangling: !edgeKeys.has(edgeKey),
          reciprocal: edge !== undefined,
        });
      }
    }
  }
  for (const edge of edges) {
    for (const faceKey of edge.faces) {
      const face = faceByKey.get(faceKey);
      if (face === undefined || !face.edges.includes(edge.key)) {
        fail("Geometry kernel returned invalid edge-to-face adjacency", {
          topology: "edge",
          dangling: !faceKeys.has(faceKey),
          reciprocal: face !== undefined,
        });
      }
    }
  }
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

function resolveSelectionOrThrow(
  selection: TopologySelectionIR,
  snapshot: KernelTopologySnapshot,
  context: TopologyResolutionContext,
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
          resolveSelectionOrThrow(query.selection, snapshot, {
            ...context,
            ...(queryPath === undefined ? {} : { path: `${queryPath}/selection` }),
          }),
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
    validateSnapshot(snapshot, context);
    snapshotValidated = true;
    return {
      ok: true,
      value: resolveSelectionOrThrow(selection, snapshot, context),
      diagnostics: [],
    };
  } catch (error) {
    const value =
      error instanceof TopologyResolutionFailure
        ? error.diagnostic
        : diagnostic(
            snapshotValidated ? "TOPOLOGY_SELECTOR_INVALID" : "KERNEL_ERROR",
            error instanceof Error ? error.message : String(error),
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
