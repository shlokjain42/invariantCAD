import { diagnostic, type CadResult, type Diagnostic } from "./core/result.js";
import type { Vec3 } from "./core/math.js";
import type { ExpressionIR } from "./expressions.js";
import type { TopologyQueryIR, TopologySelectionIR } from "./ir.js";
import type {
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelTopologyKey,
  KernelTopologySnapshot,
  TopologyKind,
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

function validateSnapshot(
  snapshot: KernelTopologySnapshot,
  context: TopologyResolutionContext,
): void {
  const all = [...snapshot.faces, ...snapshot.edges];
  const keys = new Set<KernelTopologyKey>();
  const fail = (message: string, details: Readonly<Record<string, unknown>>): never => {
    throw new TopologyResolutionFailure(
      diagnostic("KERNEL_ERROR", message, {
        ...location(context),
        details: { ...details, protocolViolation: true },
      }),
    );
  };
  for (const descriptor of all) {
    if (keys.has(descriptor.key)) {
      fail("Geometry kernel returned a duplicate topology key", {
        topology: descriptor.topology,
      });
    }
    keys.add(descriptor.key);
    const numbers = [
      ...descriptor.center,
      ...descriptor.bounds.min,
      ...descriptor.bounds.max,
      descriptor.topology === "edge" ? descriptor.length : descriptor.area,
    ];
    if (numbers.some((value) => !Number.isFinite(value))) {
      fail("Geometry kernel returned non-finite topology geometry", {
        topology: descriptor.topology,
      });
    }
    const geometry =
      descriptor.topology === "edge" ? descriptor.curve : descriptor.surface;
    const vectors =
      descriptor.topology === "edge"
        ? [descriptor.curve.direction, descriptor.curve.axis]
        : [descriptor.surface.normal, descriptor.surface.axis];
    for (const vector of vectors) {
      if (
        vector !== undefined &&
        (vector.some((value) => !Number.isFinite(value)) ||
          !(Math.hypot(...vector) > Number.EPSILON))
      ) {
        fail("Geometry kernel returned an invalid topology direction", {
          topology: descriptor.topology,
        });
      }
    }
    if (
      geometry.radius !== undefined &&
      (!(geometry.radius >= 0) || !Number.isFinite(geometry.radius))
    ) {
      fail("Geometry kernel returned an invalid topology radius", {
        topology: descriptor.topology,
      });
    }
  }
  const faceKeys = new Set(snapshot.faces.map((face) => face.key));
  const edgeKeys = new Set(snapshot.edges.map((edge) => edge.key));
  const faceByKey = new Map(snapshot.faces.map((face) => [face.key, face]));
  const edgeByKey = new Map(snapshot.edges.map((edge) => [edge.key, edge]));
  for (const face of snapshot.faces) {
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
  for (const edge of snapshot.edges) {
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
  try {
    validateSnapshot(snapshot, context);
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
            "TOPOLOGY_SELECTOR_INVALID",
            error instanceof Error ? error.message : String(error),
            location(context),
          );
    return { ok: false, diagnostics: [value] };
  }
}
