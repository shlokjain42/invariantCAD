import { entityId } from "./core/ids.js";
import { canonicalStringify, deepFreeze } from "./core/json.js";
import {
  deg,
  mm,
  type AngleExpression,
  type LengthExpression,
  type ScalarVec3Expression,
  type Vec3Expression,
} from "./expressions.js";
import type {
  ModelRef,
  ProfileRef,
  TopologyReferenceRef,
} from "./design.js";
import type {
  TopologyCardinalityIR,
  TopologyOriginRelation,
  TopologyQueryIR,
  TopologySelectionIR,
  TopologySourceIR,
} from "./ir.js";
import type {
  EdgeTopologyRole,
  FaceTopologyRole,
  TopologyKind,
} from "./protocol/topology.js";

type AnyModelRef = ModelRef<"profile" | "solid" | "part" | "assembly">;

export interface TopologyOriginOptions<K extends TopologyKind = TopologyKind> {
  readonly role?: K extends "face"
    ? FaceTopologyRole
    : K extends "edge"
      ? EdgeTopologyRole
      : never;
  readonly source?: {
    readonly sketch: ProfileRef;
    readonly entity: string;
  };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function cardinality(
  min: number,
  max?: number,
): TopologyCardinalityIR {
  assertPositiveInteger(min, "Topology selection minimum");
  if (max !== undefined) {
    assertPositiveInteger(max, "Topology selection maximum");
    if (max < min) {
      throw new RangeError("Topology selection maximum cannot be less than its minimum");
    }
  }
  return deepFreeze({ min, ...(max === undefined ? {} : { max }) });
}

function assertCompatible<K extends TopologyKind>(
  topology: K,
  queries: readonly TopologyQuery<K>[],
): void {
  if (queries.some((query) => query.topology !== topology)) {
    throw new TypeError("Topology queries must target the same topology kind");
  }
}

function canonicalLogicalQuery(
  op: "and" | "or",
  queries: readonly TopologyQueryIR[],
): TopologyQueryIR {
  const flattened = queries.flatMap((query) =>
    query.op === op ? query.queries : [query],
  );
  const unique = new Map<string, TopologyQueryIR>();
  for (const query of flattened) unique.set(canonicalStringify(query), query);
  return {
    op,
    queries: [...unique.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([, query]) => query),
  };
}

export function canonicalizeTopologyQueryIR(
  query: TopologyQueryIR,
): TopologyQueryIR {
  switch (query.op) {
    case "and":
    case "or":
      return canonicalLogicalQuery(
        query.op,
        query.queries.map(canonicalizeTopologyQueryIR),
      );
    case "not":
      return { op: "not", query: canonicalizeTopologyQueryIR(query.query) };
    case "adjacentTo":
      return {
        op: "adjacentTo",
        selection: canonicalizeTopologySelectionIR(query.selection),
      };
    default:
      return query;
  }
}

export function canonicalizeTopologySelectionIR<K extends TopologyKind>(
  selection: TopologySelectionIR<K>,
): TopologySelectionIR<K> {
  return {
    topology: selection.topology,
    query: canonicalizeTopologyQueryIR(selection.query),
    cardinality: selection.cardinality,
  };
}

export class TopologySelection<K extends TopologyKind = TopologyKind> {
  readonly topology: K;
  readonly ir: TopologySelectionIR<K>;
  /** @internal Model references retained only for design-boundary checks. */
  readonly references: readonly AnyModelRef[];
  /** @internal Persistent handles retained for ownership and exact-target checks. */
  readonly persistentReferences: readonly TopologyReferenceRef[];

  constructor(
    topology: K,
    query: TopologyQueryIR,
    selectionCardinality: TopologyCardinalityIR,
    references: readonly AnyModelRef[] = [],
    persistentReferences: readonly TopologyReferenceRef[] = [],
  ) {
    this.topology = topology;
    this.ir = deepFreeze({
      topology,
      query,
      cardinality: selectionCardinality,
    }) as TopologySelectionIR<K>;
    this.references = Object.freeze([...references]);
    this.persistentReferences = Object.freeze([...persistentReferences]);
    Object.freeze(this);
  }

  toIR(): TopologySelectionIR<K> {
    return this.ir;
  }
}

export class TopologyQuery<K extends TopologyKind = TopologyKind> {
  readonly topology: K;
  readonly ir: TopologyQueryIR;
  /** @internal Model references retained only for design-boundary checks. */
  readonly references: readonly AnyModelRef[];
  /** @internal Persistent handles retained for ownership and exact-target checks. */
  readonly persistentReferences: readonly TopologyReferenceRef[];

  constructor(
    topology: K,
    ir: TopologyQueryIR,
    references: readonly AnyModelRef[] = [],
    persistentReferences: readonly TopologyReferenceRef[] = [],
  ) {
    this.topology = topology;
    this.ir = deepFreeze(ir);
    this.references = Object.freeze([...references]);
    this.persistentReferences = Object.freeze([...persistentReferences]);
    Object.freeze(this);
  }

  and(...queries: readonly TopologyQuery<K>[]): TopologyQuery<K> {
    assertCompatible(this.topology, queries);
    return new TopologyQuery(
      this.topology,
      canonicalLogicalQuery("and", [
        this.ir,
        ...queries.map((query) => query.ir),
      ]),
      [...this.references, ...queries.flatMap((query) => query.references)],
      [
        ...this.persistentReferences,
        ...queries.flatMap((query) => query.persistentReferences),
      ],
    );
  }

  or(...queries: readonly TopologyQuery<K>[]): TopologyQuery<K> {
    assertCompatible(this.topology, queries);
    return new TopologyQuery(
      this.topology,
      canonicalLogicalQuery("or", [
        this.ir,
        ...queries.map((query) => query.ir),
      ]),
      [...this.references, ...queries.flatMap((query) => query.references)],
      [
        ...this.persistentReferences,
        ...queries.flatMap((query) => query.persistentReferences),
      ],
    );
  }

  not(): TopologyQuery<K> {
    return new TopologyQuery(
      this.topology,
      { op: "not", query: this.ir },
      this.references,
      this.persistentReferences,
    );
  }

  select(): TopologySelection<K> {
    return new TopologySelection(
      this.topology,
      this.ir,
      cardinality(1, 1),
      this.references,
      this.persistentReferences,
    );
  }

  exactly(count: number): TopologySelection<K> {
    return new TopologySelection(
      this.topology,
      this.ir,
      cardinality(count, count),
      this.references,
      this.persistentReferences,
    );
  }

  atLeast(count: number): TopologySelection<K> {
    return new TopologySelection(
      this.topology,
      this.ir,
      cardinality(count),
      this.references,
      this.persistentReferences,
    );
  }

  between(min: number, max: number): TopologySelection<K> {
    return new TopologySelection(
      this.topology,
      this.ir,
      cardinality(min, max),
      this.references,
      this.persistentReferences,
    );
  }
}

function topologySource(options: TopologyOriginOptions): {
  readonly source?: TopologySourceIR;
  readonly references: readonly AnyModelRef[];
} {
  if (options.source === undefined) return { references: [] };
  return {
    source: {
      kind: "sketch-entity",
      sketch: options.source.sketch.node,
      entity: entityId(options.source.entity),
    },
    references: [options.source.sketch],
  };
}

class TopologyQueries<K extends TopologyKind> {
  readonly kind: K;

  constructor(kind: K) {
    this.kind = kind;
  }

  all(): TopologyQuery<K> {
    return new TopologyQuery(this.kind, { op: "all" });
  }

  persistentReference(
    reference: TopologyReferenceRef<K>,
  ): TopologyQuery<K> {
    if (
      typeof reference !== "object" ||
      reference === null ||
      reference.topology !== this.kind
    ) {
      const article = this.kind === "edge" ? "an" : "a";
      throw new TypeError(
        `A persistent ${this.kind} topology query requires ${article} ${this.kind} topology reference`,
      );
    }
    return new TopologyQuery(
      this.kind,
      { op: "persistentReference", reference: reference.id },
      [],
      [reference],
    );
  }

  private origin(
    feature: ModelRef<"solid">,
    relation: TopologyOriginRelation,
    options: TopologyOriginOptions<K>,
  ): TopologyQuery<K> {
    const source = topologySource(options);
    return new TopologyQuery(
      this.kind,
      {
        op: "origin",
        feature: feature.node,
        relation,
        ...(options.role === undefined ? {} : { role: options.role }),
        ...(source.source === undefined ? {} : { source: source.source }),
      },
      [feature, ...source.references],
    );
  }

  createdBy(
    feature: ModelRef<"solid">,
    options: TopologyOriginOptions<K> = {},
  ): TopologyQuery<K> {
    return this.origin(feature, "created", options);
  }

  modifiedBy(
    feature: ModelRef<"solid">,
  ): TopologyQuery<K> {
    return this.origin(feature, "modified", {});
  }
}

class EdgeTopologyQueries extends TopologyQueries<"edge"> {
  constructor() {
    super("edge");
  }

  curve(kind: string): TopologyQuery<"edge"> {
    if (kind.length === 0) throw new TypeError("Curve kind cannot be empty");
    return new TopologyQuery("edge", { op: "curve", kind });
  }

  direction(
    value: ScalarVec3Expression,
    tolerance: AngleExpression = deg(0.1),
  ): TopologyQuery<"edge"> {
    return new TopologyQuery("edge", {
      op: "direction",
      value: [value[0].ir, value[1].ir, value[2].ir],
      tolerance: tolerance.ir,
    });
  }

  radius(
    value: LengthExpression,
    tolerance: LengthExpression = mm(1e-6),
  ): TopologyQuery<"edge"> {
    return new TopologyQuery("edge", {
      op: "radius",
      value: value.ir,
      tolerance: tolerance.ir,
    });
  }

  adjacentTo<K extends "face" | "vertex">(
    selection: TopologySelection<K>,
  ): TopologyQuery<"edge"> {
    return new TopologyQuery(
      "edge",
      { op: "adjacentTo", selection: selection.ir },
      selection.references,
      selection.persistentReferences,
    );
  }
}

class VertexTopologyQueries extends TopologyQueries<"vertex"> {
  constructor() {
    super("vertex");
  }

  position(
    value: Vec3Expression,
    tolerance: LengthExpression = mm(1e-6),
  ): TopologyQuery<"vertex"> {
    return new TopologyQuery("vertex", {
      op: "position",
      value: [value[0].ir, value[1].ir, value[2].ir],
      tolerance: tolerance.ir,
    });
  }

  adjacentTo(selection: TopologySelection<"edge">): TopologyQuery<"vertex"> {
    return new TopologyQuery(
      "vertex",
      { op: "adjacentTo", selection: selection.ir },
      selection.references,
      selection.persistentReferences,
    );
  }
}

class FaceTopologyQueries extends TopologyQueries<"face"> {
  constructor() {
    super("face");
  }

  surface(kind: string): TopologyQuery<"face"> {
    if (kind.length === 0) throw new TypeError("Surface kind cannot be empty");
    return new TopologyQuery("face", { op: "surface", kind });
  }

  normal(
    value: ScalarVec3Expression,
    tolerance: AngleExpression = deg(0.1),
  ): TopologyQuery<"face"> {
    return new TopologyQuery("face", {
      op: "normal",
      value: [value[0].ir, value[1].ir, value[2].ir],
      tolerance: tolerance.ir,
    });
  }

  radius(
    value: LengthExpression,
    tolerance: LengthExpression = mm(1e-6),
  ): TopologyQuery<"face"> {
    return new TopologyQuery("face", {
      op: "radius",
      value: value.ir,
      tolerance: tolerance.ir,
    });
  }

  adjacentTo(selection: TopologySelection<"edge">): TopologyQuery<"face"> {
    return new TopologyQuery(
      "face",
      { op: "adjacentTo", selection: selection.ir },
      selection.references,
      selection.persistentReferences,
    );
  }
}

export const topology = Object.freeze({
  edges: Object.freeze(new EdgeTopologyQueries()),
  faces: Object.freeze(new FaceTopologyQueries()),
  vertices: Object.freeze(new VertexTopologyQueries()),
});
