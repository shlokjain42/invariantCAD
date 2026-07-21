import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DESIGN_FEATURE_HASH_REPORT_VERSION,
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_SCHEMA_V6,
  FEATURE_HASH_PREFIX,
  FEATURE_HASH_PROTOCOL_VERSION,
  NODE_KINDS,
  captureTopologyReference,
  design,
  hashDesignFeatures,
  kgPerCubicMeter,
  mm,
  parseDocument,
  plane,
  stringifyDocument,
  tf,
  topology,
  vec2,
  vec3,
  type CadResult,
  type DesignDocument,
  type DesignFeatureHashReport,
  type ExpressionIR,
  type KernelTopologyKey,
  type NodeKind,
  type NodeId,
  type PersistentTopologyReference,
  type TopologyQueryIR,
  type TopologyReferenceId,
} from "../src/index.js";

function expectDeeplyFrozen(
  value: unknown,
  seen = new Set<object>(),
): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

async function reportValue(
  result: Promise<CadResult<DesignFeatureHashReport>>,
): Promise<DesignFeatureHashReport> {
  const resolved = await result;
  expect(resolved.ok, JSON.stringify(resolved.diagnostics)).toBe(true);
  if (!resolved.ok) throw new Error("Expected feature hashes");
  return resolved.value;
}

function hashFor(report: DesignFeatureHashReport, node: string): string {
  const entry = report.nodes.find((candidate) => candidate.node === node);
  if (entry === undefined) throw new Error(`Missing feature hash for '${node}'`);
  return entry.hash;
}

function literal(
  dimension: ExpressionIR["dimension"],
  value: number,
): ExpressionIR {
  return { op: "literal", dimension, value };
}

async function minimumCanonicalByteBudget(
  document: DesignDocument,
): Promise<number> {
  const succeeds = async (maxCanonicalBytes: number): Promise<boolean> => {
    const result = await hashDesignFeatures(document, {
      limits: { maxCanonicalBytes },
    });
    if (!result.ok) {
      const resource = result.diagnostics[0]?.details?.resource;
      if (resource !== "maxCanonicalBytes") {
        throw new Error(JSON.stringify(result.diagnostics));
      }
    }
    return result.ok;
  };

  let failing = 0;
  let passing = 1;
  while (!(await succeeds(passing))) passing *= 2;
  while (passing - failing > 1) {
    const candidate = Math.floor((passing + failing) / 2);
    if (await succeeds(candidate)) passing = candidate;
    else failing = candidate;
  }
  return passing;
}

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

function edgeReference(
  fingerprint = "feature-hash/signatures@1",
): PersistentTopologyReference<"edge"> {
  const captured = captureTopologyReference(
    {
      history: "complete",
      faces: [],
      edges: [
        {
          topology: "edge",
          key: key("captured-edge"),
          center: [0, 0, 0.5],
          bounds: { min: [0, 0, 0], max: [0, 0, 1] },
          lineage: [
            {
              feature: "body",
              relation: "created",
              role: "box.edge.x-min-y-min",
            },
          ],
          length: 1,
          curve: { kind: "line", direction: [0, 0, 1] },
          faces: [],
          vertices: [],
        },
      ],
      vertices: [],
    },
    "edge",
    key("captured-edge"),
    {
      capabilities: { protocolVersion: 1, fingerprint },
      tolerance: { linear: 1e-6, angular: 1e-6, relative: 1e-8 },
    },
  );
  if (!captured.ok) throw new Error(JSON.stringify(captured.diagnostics));
  return captured.value;
}

const TOPOLOGY_QUERY_OPS = [
  "adjacentTo",
  "all",
  "and",
  "curve",
  "direction",
  "normal",
  "not",
  "or",
  "origin",
  "persistentReference",
  "position",
  "radius",
  "surface",
] as const satisfies readonly TopologyQueryIR["op"][];

const EXPECTED_NODE_KINDS = [
  "box",
  "cylinder",
  "sphere",
  "sketch",
  "polylinePath",
  "circularArcPath",
  "compositePath",
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "boolean",
  "transform",
  "fillet",
  "chamfer",
  "shell",
  "offset",
  "draft",
  "part",
  "assembly",
] as const satisfies readonly NodeKind[];

function exhaustiveTopologyQuery(
  reference: TopologyReferenceId,
): TopologyQueryIR {
  const scalarVector = [
    literal("scalar", 1),
    literal("scalar", 0),
    literal("scalar", 0),
  ] as const;
  const position = [
    literal("length", 0),
    literal("length", 0),
    literal("length", 0),
  ] as const;
  return {
    op: "and",
    queries: [
      { op: "persistentReference", reference },
      {
        op: "origin",
        feature: "body" as NodeId,
        relation: "created",
      },
      {
        op: "direction",
        value: scalarVector,
        tolerance: literal("angle", 1e-6),
      },
      {
        op: "radius",
        value: literal("length", 0.25),
        tolerance: literal("length", 1e-6),
      },
      {
        op: "or",
        queries: [
          { op: "all" },
          { op: "not", query: { op: "curve", kind: "line" } },
        ],
      },
      {
        op: "adjacentTo",
        selection: {
          topology: "face",
          cardinality: { min: 1 },
          query: {
            op: "and",
            queries: [
              { op: "surface", kind: "plane" },
              {
                op: "normal",
                value: scalarVector,
                tolerance: literal("angle", 1e-6),
              },
              {
                op: "radius",
                value: literal("length", 0.25),
                tolerance: literal("length", 1e-6),
              },
            ],
          },
        },
      },
      {
        op: "adjacentTo",
        selection: {
          topology: "vertex",
          cardinality: { min: 1 },
          query: {
            op: "position",
            value: position,
            tolerance: literal("length", 1e-6),
          },
        },
      },
    ],
  };
}

function topologyQueryOps(query: TopologyQueryIR): readonly string[] {
  const output = new Set<string>();
  const stack: TopologyQueryIR[] = [query];
  while (stack.length > 0) {
    const current = stack.pop()!;
    output.add(current.op);
    switch (current.op) {
      case "and":
      case "or":
        stack.push(...current.queries);
        break;
      case "not":
        stack.push(current.query);
        break;
      case "adjacentTo":
        stack.push(current.selection.query);
        break;
      case "all":
      case "persistentReference":
      case "origin":
      case "surface":
      case "curve":
      case "normal":
      case "direction":
      case "radius":
      case "position":
        break;
    }
  }
  return [...output].sort();
}

function merkleFixture(widthValue = 10): DesignDocument {
  const cad = design("feature-merkle");
  const width = cad.parameter.length("width", mm(widthValue));
  const body = cad.box("body", { size: vec3(width, mm(4), mm(2)) });
  const placed = cad.translate(
    "placed",
    body,
    vec3(mm(5), mm(0), mm(0)),
  );
  const isolated = cad.sphere("isolated", { radius: mm(3) });
  cad.configuration("same", (configuration) =>
    configuration.parameter(width, mm(widthValue)),
  );
  cad.configuration("wide", (configuration) =>
    configuration.parameter(width, mm(widthValue * 2)),
  );
  cad.output("placed", placed).output("isolated", isolated);
  return cad.build();
}

function solverObservableSketchFixture(): DesignDocument {
  const cad = design("feature-sketch-golden");
  const profile = cad.sketch("profile", plane.xy(), (sketch) => {
    const p0 = sketch.point("p0", vec2(mm(0), mm(0)));
    const p1 = sketch.point("p1", vec2(mm(9), mm(1)));
    const p2 = sketch.point("p2", vec2(mm(9), mm(9)));
    const p3 = sketch.point("p3", vec2(mm(1), mm(9)));
    const bottom = sketch.line("bottom", p0, p1);
    const right = sketch.line("right", p1, p2);
    const top = sketch.line("top", p2, p3);
    const left = sketch.line("left", p3, p0);
    sketch
      .fixed("fix-origin", p0)
      .horizontal("bottom-horizontal", bottom)
      .vertical("right-vertical", right)
      .horizontal("top-horizontal", top)
      .vertical("left-vertical", left)
      .length("bottom-length", bottom, mm(10))
      .length("left-length", left, mm(10));
    return sketch.profile(sketch.loop([bottom, right, top, left]));
  });
  const solid = cad.extrude("solid", profile, { distance: mm(2) });
  cad.output("solid", solid);
  return cad.build();
}

function suppressedFixture(bodyWidth: number): DesignDocument {
  const cad = design("feature-suppression");
  const placement = cad.parameter.length("placement", mm(5));
  const body = cad.box("body", {
    size: vec3(mm(bodyWidth), mm(1), mm(1)),
  });
  const part = cad.part("part", body);
  const assembly = cad.assembly("assembly", (instances) => {
    instances.instance("child", part, {
      placement: [tf.translate(vec3(placement, mm(0), mm(0)))],
      suppressed: true,
    });
  });
  cad.configuration("enabled", (configuration) =>
    configuration.instanceSuppressed(assembly, "child", false),
  );
  cad.output("assembly", assembly);
  return cad.build();
}

function materialFixture(configurationMaterial: "steel" | "aluminum") {
  const cad = design("feature-material");
  const steel = cad.material("steel", {
    name: "Steel",
    massDensity: kgPerCubicMeter(7_850),
    metadata: { family: "ferrous" },
  });
  const aluminum = cad.material("aluminum", {
    name: "Aluminum",
    massDensity: kgPerCubicMeter(2_700),
  });
  const body = cad.box("body", { size: vec3(mm(1), mm(1), mm(1)) });
  const part = cad.part("part", body, { materialRef: steel });
  cad.configuration("configured", (configuration) =>
    configuration.partMaterial(
      part,
      configurationMaterial === "steel" ? steel : aluminum,
    ),
  );
  cad.output("part", part);
  return cad.build();
}

function deepDagFixture(depth: number): DesignDocument {
  const cad = design("feature-deep-dag");
  const body = cad.box("body", { size: vec3(mm(1), mm(1), mm(1)) });
  cad.output("body", body);
  const source = JSON.parse(stringifyDocument(cad.build())) as {
    nodes: Record<string, unknown>;
    outputs: Record<string, unknown>;
  };
  const nodes: Record<string, unknown> = Object.create(null);
  const id = (index: number): string => `n${String(index).padStart(5, "0")}`;
  nodes[id(0)] = source.nodes.body;
  for (let index = 1; index <= depth; index += 1) {
    nodes[id(index)] = {
      kind: "transform",
      input: { node: id(index - 1), kind: "solid" },
      operations: [
        {
          kind: "translate",
          value: [
            literal("length", 0),
            literal("length", 0),
            literal("length", 0),
          ],
        },
      ],
    };
  }
  source.nodes = Object.fromEntries(Object.entries(nodes).reverse());
  source.outputs = {
    result: { node: id(depth), kind: "solid" },
  };
  return source as unknown as DesignDocument;
}

describe("design feature hashes", () => {
  it("builds a deterministic, tagged, deeply frozen Merkle report", async () => {
    const document = merkleFixture();
    const report = await reportValue(hashDesignFeatures(document));
    const parsed = parseDocument(stringifyDocument(document));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const roundTrip = await reportValue(hashDesignFeatures(parsed.value));

    expect(DESIGN_FEATURE_HASH_REPORT_VERSION).toBe(1);
    expect(FEATURE_HASH_PROTOCOL_VERSION).toBe(1);
    expect(report.version).toBe(1);
    expect(report.hashProtocolVersion).toBe(1);
    expect(report.configurationId).toBeNull();
    expect(report.nodes.map(({ node }) => node)).toEqual([
      "body",
      "isolated",
      "placed",
    ]);
    // Protocol-v1 golden vectors: changing these requires a protocol bump.
    expect(
      Object.fromEntries(report.nodes.map((entry) => [entry.node, entry.hash])),
    ).toEqual({
      body:
        "invariantcad:feature:v1:sha256:c25f71a730f5558f7fb305df253b4e961333498d56cd18c8d0b4a94f19a31621",
      isolated:
        "invariantcad:feature:v1:sha256:59d5ce993e8be37e6a49b5600bc11dc34ec295965342b38cd110253092a03564",
      placed:
        "invariantcad:feature:v1:sha256:bda032eda319e1716c5ab9cfa89eae5f5e6df99c66d84c31b7831f04a536c5e4",
    });
    for (const entry of report.nodes) {
      expect(entry.hash).toMatch(
        new RegExp(`^${FEATURE_HASH_PREFIX}[0-9a-f]{64}$`),
      );
    }
    expect(roundTrip).toEqual(report);
    expect(report.outputs).toEqual([
      {
        name: "isolated",
        node: "isolated",
        kind: "solid",
        featureHash: hashFor(report, "isolated"),
      },
      {
        name: "placed",
        node: "placed",
        kind: "solid",
        featureHash: hashFor(report, "placed"),
      },
    ]);
    expectDeeplyFrozen(report);
    expectTypeOf(report).toEqualTypeOf<DesignFeatureHashReport>();
  });

  it("pins solver-observable sketch intent to protocol v1", async () => {
    const report = await reportValue(
      hashDesignFeatures(solverObservableSketchFixture()),
    );

    expect(hashFor(report, "profile")).toBe(
      "invariantcad:feature:v1:sha256:8d7a7329a8d89e0569cdef3a584c35853dae2bd1b488e604cb050281b43f082b",
    );
  });

  it("invalidates only the changed feature and its descendants", async () => {
    const first = await reportValue(hashDesignFeatures(merkleFixture(10)));
    const second = await reportValue(hashDesignFeatures(merkleFixture(12)));

    expect(hashFor(second, "body")).not.toBe(hashFor(first, "body"));
    expect(hashFor(second, "placed")).not.toBe(hashFor(first, "placed"));
    expect(hashFor(second, "isolated")).toBe(hashFor(first, "isolated"));
    expect(
      first.nodes.find(({ node }) => node === "body")?.parameterValues,
    ).toEqual({ width: 10 });
    expect(
      first.nodes.find(({ node }) => node === "placed")?.dependencies,
    ).toEqual(["body"]);
  });

  it("distinguishes authored expression ASTs with the same numeric value", async () => {
    const document = merkleFixture();
    const authored = JSON.parse(stringifyDocument(document)) as {
      readonly nodes: Record<
        string,
        { size?: ExpressionIR[] }
      >;
    };
    const size = authored.nodes.body?.size;
    if (size === undefined) throw new Error("Missing box fixture");
    size[1] = {
      op: "add",
      dimension: "length",
      left: literal("length", 1),
      right: literal("length", 3),
    };

    const baseline = await reportValue(hashDesignFeatures(document));
    const structurallyDistinct = await reportValue(
      hashDesignFeatures(authored as unknown as DesignDocument),
    );

    expect(hashFor(structurallyDistinct, "body")).not.toBe(
      hashFor(baseline, "body"),
    );
    expect(hashFor(structurallyDistinct, "placed")).not.toBe(
      hashFor(baseline, "placed"),
    );
    expect(hashFor(structurallyDistinct, "isolated")).toBe(
      hashFor(baseline, "isolated"),
    );
  });

  it("uses evaluator-equivalent configuration and call-time precedence", async () => {
    const document = merkleFixture(10);
    const base = await reportValue(hashDesignFeatures(document));
    const same = await reportValue(
      hashDesignFeatures(document, { configuration: "same" }),
    );
    const wide = await reportValue(
      hashDesignFeatures(document, { configuration: "wide" }),
    );
    const callTime = await reportValue(
      hashDesignFeatures(document, {
        configuration: "wide",
        parameters: { width: 10 },
      }),
    );

    expect(hashFor(same, "body")).toBe(hashFor(base, "body"));
    expect(hashFor(wide, "body")).not.toBe(hashFor(base, "body"));
    expect(hashFor(callTime, "body")).toBe(hashFor(base, "body"));
    expect(same.configurationId).toBe("same");
    expect(callTime.parameterValues).toEqual({ width: 10 });
  });

  it("removes effectively suppressed assembly branches from hashes", async () => {
    const narrow = suppressedFixture(1);
    const wide = suppressedFixture(2);
    const narrowBase = await reportValue(hashDesignFeatures(narrow));
    const wideBase = await reportValue(hashDesignFeatures(wide));
    const narrowEnabled = await reportValue(
      hashDesignFeatures(narrow, { configuration: "enabled" }),
    );
    const wideEnabled = await reportValue(
      hashDesignFeatures(wide, { configuration: "enabled" }),
    );

    expect(hashFor(narrowBase, "assembly")).toBe(
      hashFor(wideBase, "assembly"),
    );
    expect(hashFor(narrowBase, "assembly")).toBe(
      "invariantcad:feature:v1:sha256:1902f5e68e484682633c2c11cd5f6347efc04899b0ad79c6dc807b2541b61a3a",
    );
    expect(
      narrowBase.nodes.find(({ node }) => node === "assembly")?.dependencies,
    ).toEqual([]);
    expect(
      narrowBase.nodes.find(({ node }) => node === "assembly")?.parameterValues,
    ).toEqual({});
    expect(hashFor(narrowEnabled, "assembly")).not.toBe(
      hashFor(wideEnabled, "assembly"),
    );
    expect(
      narrowEnabled.nodes.find(({ node }) => node === "assembly")
        ?.parameterValues,
    ).toEqual({ placement: 5 });
  });

  it("does not evaluate invalid numeric intent in a suppressed branch", async () => {
    const document = suppressedFixture(1);
    const dormant = JSON.parse(stringifyDocument(document)) as {
      readonly nodes: Record<string, { size?: ExpressionIR[] }>;
    };
    const size = dormant.nodes.body?.size;
    if (size === undefined) throw new Error("Missing box fixture");
    size[0] = {
      op: "div",
      dimension: "length",
      left: literal("length", 1),
      right: literal("scalar", 0),
    };

    const baseline = await reportValue(hashDesignFeatures(document));
    const report = await reportValue(
      hashDesignFeatures(dormant as unknown as DesignDocument),
    );

    expect(hashFor(report, "body")).not.toBe(hashFor(baseline, "body"));
    expect(hashFor(report, "assembly")).toBe(hashFor(baseline, "assembly"));
    expect(
      report.nodes.find(({ node }) => node === "assembly")?.dependencies,
    ).toEqual([]);
  });

  it("hashes effective configured materials without perturbing geometry", async () => {
    const steelDocument = materialFixture("steel");
    const aluminumDocument = materialFixture("aluminum");
    const steel = await reportValue(
      hashDesignFeatures(steelDocument, { configuration: "configured" }),
    );
    const aluminum = await reportValue(
      hashDesignFeatures(aluminumDocument, { configuration: "configured" }),
    );

    expect(hashFor(steel, "body")).toBe(hashFor(aluminum, "body"));
    expect(hashFor(steel, "part")).not.toBe(hashFor(aluminum, "part"));
    expect(hashFor(aluminum, "part")).toBe(
      "invariantcad:feature:v1:sha256:903d23b05058ecd708750c160622b6b5998b3ae3118106db81cfd000b123cec3",
    );
  });

  it("canonicalizes selector logic and only hashes consumed persistent evidence", async () => {
    const cad = design("feature-topology");
    const body = cad.box("body", { size: vec3(mm(1), mm(1), mm(1)) });
    const stored = cad.topologyReference("stored", body, {
      topology: "edge",
      variants: [edgeReference()],
    });
    cad.topologyReference("unused", body, {
      topology: "edge",
      variants: [edgeReference("feature-hash/unused@1")],
    });
    const treated = cad.fillet("treated", body, {
      edges: topology.edges
        .persistentReference(stored)
        .and(topology.edges.curve("line"))
        .select(),
      radius: mm(0.1),
    });
    cad.output("treated", treated);
    const built = cad.build();
    const builtTreatedNode = built.nodes["treated" as NodeId];
    if (builtTreatedNode?.kind !== "fillet") {
      throw new Error("Missing fillet fixture");
    }
    const query = exhaustiveTopologyQuery(stored.id);
    const document = {
      ...built,
      nodes: {
        ...built.nodes,
        treated: {
          ...builtTreatedNode,
          edges: { ...builtTreatedNode.edges, query },
        },
      },
    } as unknown as DesignDocument;
    const first = await reportValue(hashDesignFeatures(document));
    const treatedNode = document.nodes["treated" as NodeId];
    if (treatedNode?.kind !== "fillet") throw new Error("Missing fillet fixture");
    const reversed = {
      ...document,
      nodes: {
        ...document.nodes,
        treated: {
          ...treatedNode,
          edges: {
            ...treatedNode.edges,
            query: {
              op: "and",
              queries: [...(treatedNode.edges.query.op === "and"
                ? treatedNode.edges.query.queries
                : [treatedNode.edges.query])].reverse(),
            },
          },
        },
      },
    } as unknown as DesignDocument;
    const second = await reportValue(hashDesignFeatures(reversed));
    const unusedChanged = {
      ...document,
      topologyReferences: {
        ...document.topologyReferences,
        unused: {
          ...document.topologyReferences!["unused" as TopologyReferenceId]!,
          variants: [edgeReference("feature-hash/unused@2")],
        },
      },
    } as DesignDocument;
    const third = await reportValue(hashDesignFeatures(unusedChanged));

    expect(hashFor(second, "treated")).toBe(hashFor(first, "treated"));
    expect(hashFor(third, "treated")).toBe(hashFor(first, "treated"));
    expect(
      first.nodes.find(({ node }) => node === "treated")?.topologyReferences,
    ).toEqual(["stored"]);
    expect(hashFor(first, "treated")).toBe(
      "invariantcad:feature:v1:sha256:dba028e79caeb8a4187cf5a8e6099fb9d43c4f4b5e907d69360c942c0de31932",
    );
    expect(topologyQueryOps(query)).toEqual(TOPOLOGY_QUERY_OPS);
  });

  it("normalizes unchanged feature semantics across document grammar versions", async () => {
    const current = merkleFixture(10);
    const { topologyReferences: _topologyReferences, ...body } = current;
    const versions = [
      { schema: DOCUMENT_SCHEMA_V1, version: 1 },
      { schema: DOCUMENT_SCHEMA_V2, version: 2 },
      { schema: DOCUMENT_SCHEMA_V3, version: 3 },
      { schema: DOCUMENT_SCHEMA_V4, version: 4 },
      { schema: DOCUMENT_SCHEMA_V5, version: 5 },
      { schema: DOCUMENT_SCHEMA_V6, version: 6 },
    ] as const;
    const hashes: string[] = [];
    for (const version of versions) {
      const report = await reportValue(
        hashDesignFeatures({ ...body, ...version } as DesignDocument),
      );
      hashes.push(hashFor(report, "body"));
    }
    expect(new Set(hashes).size).toBe(1);
  });

  it("preserves arbitrary schema-valid parameter, node, and output strings", async () => {
    const cad = design("feature-arbitrary-strings");
    const width = cad.parameter.length("width", mm(7));
    const body = cad.box("body", { size: vec3(width, mm(2), mm(1)) });
    cad.output("body", body);
    const source = JSON.parse(stringifyDocument(cad.build())) as {
      parameters: Record<string, unknown>;
      nodes: Record<string, { size: ExpressionIR[] }>;
      outputs: Record<string, unknown>;
    };
    const parameter = "width / arbitrary 🚀";
    const node = "node / arbitrary 🚀";
    const output = "output / arbitrary 🚀";
    const bodyNode = source.nodes.body;
    const widthExpression = bodyNode?.size[0];
    if (bodyNode === undefined || widthExpression?.op !== "parameter") {
      throw new Error("Missing parameterized box fixture");
    }
    source.parameters = { [parameter]: source.parameters.width };
    bodyNode.size[0] = { ...widthExpression, id: parameter as never };
    source.nodes = { [node]: bodyNode };
    source.outputs = { [output]: { node, kind: "solid" } };

    const report = await reportValue(
      hashDesignFeatures(source as unknown as DesignDocument),
    );

    expect(report.nodes.map((entry) => entry.node)).toEqual([node]);
    expect(report.nodes[0]?.parameterValues).toEqual({ [parameter]: 7 });
    expect(report.parameterValues).toEqual({ [parameter]: 7 });
    expect(report.outputs).toEqual([
      {
        name: output,
        node,
        kind: "solid",
        featureHash: hashFor(report, node),
      },
    ]);
  });

  it("keeps node and topology-query inventories explicit", () => {
    expect(NODE_KINDS).toEqual(EXPECTED_NODE_KINDS);
    expect(TOPOLOGY_QUERY_OPS).toHaveLength(13);
    expectTypeOf<
      Exclude<NodeKind, (typeof EXPECTED_NODE_KINDS)[number]>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      Exclude<TopologyQueryIR["op"], (typeof TOPOLOGY_QUERY_OPS)[number]>
    >().toEqualTypeOf<never>();
  });

  it("resolves long flat parameter graphs without recursive traversal", async () => {
    const cad = design("feature-long-parameters");
    let current = cad.parameter.length("p0000", mm(1));
    for (let index = 1; index <= 3_000; index += 1) {
      current = cad.parameter.length(`p${String(index).padStart(4, "0")}`, current);
    }
    const body = cad.box("body", { size: vec3(current, mm(1), mm(1)) });
    cad.output("body", body);
    const report = await reportValue(hashDesignFeatures(cad.build()));

    expect(report.parameterValues.p3000).toBe(1);
    expect(
      report.nodes.find(({ node }) => node === "body")?.parameterValues,
    ).toEqual({ p3000: 1 });
  });

  it("hashes a deeply reversed-insertion-order DAG iteratively", async () => {
    const depth = 6_000;
    const report = await reportValue(
      hashDesignFeatures(deepDagFixture(depth)),
    );
    const terminal = `n${String(depth).padStart(5, "0")}`;
    const predecessor = `n${String(depth - 1).padStart(5, "0")}`;

    expect(report.nodes).toHaveLength(depth + 1);
    expect(
      report.nodes.find(({ node }) => node === terminal)?.dependencies,
    ).toEqual([predecessor]);
    expect(report.outputs[0]?.featureHash).toBe(hashFor(report, terminal));
  }, 30_000);

  it("enforces the exact cumulative canonical UTF-8 byte boundary", async () => {
    const cad = design("feature-byte-boundary");
    const body = cad.box("body", { size: vec3(mm(1), mm(1), mm(1)) });
    const part = cad.part("part", body, {
      metadata: {
        text: "quote:\" slash:\\ controls:\b\t\n\u0000 astral:🚀 separator:\u2028 lone:\ud800",
      },
    });
    cad.output("part", part);
    const document = cad.build();
    const exact = await minimumCanonicalByteBudget(document);

    const zero = await hashDesignFeatures(document, {
      limits: { maxCanonicalBytes: 0 },
    });
    expect(zero.ok).toBe(false);

    const exactResult = await hashDesignFeatures(document, {
      limits: { maxCanonicalBytes: exact },
    });
    expect(exactResult.ok, JSON.stringify(exactResult.diagnostics)).toBe(true);

    const oneByteShort = await hashDesignFeatures(document, {
      limits: { maxCanonicalBytes: exact - 1 },
    });
    expect(oneByteShort.ok).toBe(false);
    if (!oneByteShort.ok) {
      expect(oneByteShort.diagnostics[0]?.details).toMatchObject({
        resource: "maxCanonicalBytes",
        limit: exact - 1,
        actual: exact,
      });
    }
  });

  it("accepts own __proto__ metadata without pollution or semantic drift", async () => {
    const document = merkleFixture();
    const source = JSON.parse(stringifyDocument(document)) as Record<
      string,
      unknown
    >;
    source.metadata = JSON.parse('{"__proto__":{"polluted":true}}');

    const baseline = await reportValue(hashDesignFeatures(document));
    const reserved = await reportValue(
      hashDesignFeatures(source as unknown as DesignDocument),
    );

    expect(reserved).toEqual(baseline);
    expect(({} as { readonly polluted?: unknown }).polluted).toBeUndefined();
  });

  it("honors a safely captured pre-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await hashDesignFeatures(merkleFixture(), {
      signal: controller.signal,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "EVALUATION_ABORTED",
        details: { phase: "featureHash" },
      });
    }
  });

  it("fails closed on invalid contexts, proxies, and work limits", async () => {
    const document = merkleFixture();
    const unknown = await hashDesignFeatures(document, {
      configuration: "missing",
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.diagnostics[0]?.code).toBe("CONFIGURATION_MISSING");

    const nodeLimit = await hashDesignFeatures(document, {
      limits: { maxFeatureNodes: 1 },
    });
    expect(nodeLimit.ok).toBe(false);
    if (!nodeLimit.ok) {
      expect(nodeLimit.diagnostics[0]?.details).toMatchObject({
        phase: "featureHash",
        resource: "maxFeatureNodes",
      });
    }
    const dependencyLimit = await hashDesignFeatures(document, {
      limits: { maxDependencyLinks: 0 },
    });
    expect(dependencyLimit.ok).toBe(false);
    if (!dependencyLimit.ok) {
      expect(dependencyLimit.diagnostics[0]?.details).toMatchObject({
        resource: "maxDependencyLinks",
      });
    }
    const byteLimit = await hashDesignFeatures(document, {
      limits: { maxCanonicalBytes: 0 },
    });
    expect(byteLimit.ok).toBe(false);
    if (!byteLimit.ok) {
      expect(byteLimit.diagnostics[0]?.details).toMatchObject({
        resource: "maxCanonicalBytes",
      });
    }

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const proxyResult = await hashDesignFeatures(
      document,
      revoked.proxy as never,
    );
    expect(proxyResult.ok).toBe(false);
    if (!proxyResult.ok) expect(proxyResult.diagnostics[0]?.code).toBe("IR_INVALID");

    const crossRealm = runInNewContext("({ parameters: { width: 10 } })") as {
      readonly parameters: Readonly<Record<string, number>>;
    };
    const crossRealmResult = await hashDesignFeatures(document, crossRealm);
    expect(crossRealmResult.ok).toBe(true);

    const invalidSignal = await hashDesignFeatures(document, {
      signal: { aborted: false } as AbortSignal,
    });
    expect(invalidSignal.ok).toBe(false);
    if (!invalidSignal.ok) {
      expect(invalidSignal.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        path: "/signal",
      });
    }
  });
});
