import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOPOLOGY_SIGNATURE_LIMITS,
  SHELL_DIRECTIONS,
  SHELL_JOIN_SEMANTICS,
  TOPOLOGY_SELECTION_EXPLANATION_VERSION,
  captureTopologyReference,
  createEvaluator,
  createManifoldKernel,
  design,
  explainTopologySelection,
  hashDocument,
  parseDocumentValue,
  resolveTopologySelection,
  scalarVec3,
  stringifyDocument,
  topology,
  validateDocument,
  vec3,
  mm,
  nodeDependencies,
  outputKindForNode,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type GeometryKernel,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
  type KernelVertexDescriptor,
  type TopologyResolutionContext,
} from "../src/index.js";
import type { NodeId, TopologyReferenceId } from "../src/core/ids.js";
import type {
  TopologyReferenceEntryIR,
  TopologySelectionIR,
} from "../src/ir.js";
import { topologySelectionRequirements } from "../src/topology-resolution.js";

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

function edge(
  id: string,
  center: readonly [number, number, number],
): KernelEdgeDescriptor {
  return {
    topology: "edge",
    key: key(id),
    center,
    bounds: { min: center, max: center },
    lineage: [{ feature: "box", relation: "created" }],
    length: 30,
    curve: { kind: "line", direction: [0, 0, 1] },
    faces: [],
    vertices: [],
  };
}

const verticalEdges = [
  edge("e00", [0, 0, 15]),
  edge("e01", [0, 20, 15]),
  edge("e10", [10, 0, 15]),
  edge("e11", [10, 20, 15]),
];

const xMinimumFace: KernelFaceDescriptor = {
  topology: "face",
  key: key("fx"),
  center: [0, 10, 15],
  bounds: { min: [0, 0, 0], max: [0, 20, 30] },
  lineage: [{ feature: "box", relation: "created" }],
  area: 600,
  surface: { kind: "plane", normal: [-1, 0, 0] },
  edges: [key("e00"), key("e01")],
};

const yMinimumFace: KernelFaceDescriptor = {
  topology: "face",
  key: key("fy"),
  center: [5, 0, 15],
  bounds: { min: [0, 0, 0], max: [10, 0, 30] },
  lineage: [{ feature: "box", relation: "created" }],
  area: 300,
  surface: { kind: "plane", normal: [0, -1, 0] },
  edges: [key("e00"), key("e10")],
};

const adjacentEdges: readonly KernelEdgeDescriptor[] = verticalEdges.map(
  (descriptor) => ({
    ...descriptor,
    faces:
      descriptor.key === key("e00")
        ? [key("fx"), key("fy")]
        : descriptor.key === key("e01")
          ? [key("fx")]
          : descriptor.key === key("e10")
            ? [key("fy")]
            : [],
  }),
);

function snapshot(
  edges: readonly KernelEdgeDescriptor[] = verticalEdges,
  history: KernelTopologySnapshot["history"] = "complete",
): KernelTopologySnapshot {
  return { history, faces: [], edges, vertices: [] };
}

function adjacencySnapshot(): KernelTopologySnapshot {
  return {
    history: "complete",
    faces: [xMinimumFace, yMinimumFace],
    edges: adjacentEdges,
    vertices: [],
  };
}

const signatureCapabilities = {
  protocolVersion: 1 as const,
  fingerprint: "topology-resolution-test/signatures@1",
};

function persistentEdgeFixture(): {
  readonly id: TopologyReferenceId;
  readonly input: NodeId;
  readonly entry: TopologyReferenceEntryIR<"edge">;
  readonly selection: TopologySelectionIR<"edge">;
} {
  const captured = captureTopologyReference(snapshot(), "edge", key("e00"), {
    capabilities: signatureCapabilities,
    tolerance: { linear: 1e-9, angular: 1e-9, relative: 1e-9 },
  });
  if (!captured.ok) throw new Error("Persistent edge fixture did not capture");
  const id = "stored-edge" as TopologyReferenceId;
  const input = "box" as NodeId;
  return {
    id,
    input,
    entry: {
      target: { node: input, kind: "solid" },
      topology: "edge",
      variants: [captured.value],
    },
    selection: {
      topology: "edge",
      query: { op: "persistentReference", reference: id },
      cardinality: { min: 1, max: 1 },
    },
  };
}

describe("semantic topology selections", () => {
  it("serializes explicit selector cardinality and rejects unknown selector fields", async () => {
    const cad = design("rounded-box");
    const box = cad.box("box", {
      size: vec3(mm(10), mm(20), mm(30)),
    });
    const edges = topology.edges
      .createdBy(box)
      .and(topology.edges.direction(scalarVec3(0, 0, 1)))
      .exactly(4);
    const rounded = cad.fillet("rounded", box, { edges, radius: mm(2) });
    cad.output("rounded", rounded);
    const document = cad.build();

    expect(document.nodes[rounded.node]).toEqual(
      expect.objectContaining({
        kind: "fillet",
        edges: expect.objectContaining({
          topology: "edge",
          cardinality: { min: 4, max: 4 },
        }),
      }),
    );

    const reordered = JSON.parse(stringifyDocument(document)) as any;
    reordered.nodes.rounded.edges.query.queries.reverse();
    const reorderedParsed = parseDocumentValue(reordered);
    expect(reorderedParsed.ok).toBe(true);
    if (reorderedParsed.ok) {
      expect(await hashDocument(reorderedParsed.value)).toBe(
        await hashDocument(document),
      );
    }

    const invalid = JSON.parse(stringifyDocument(document)) as any;
    invalid.nodes.rounded.edges.query.unknownSemanticField = true;
    const parsed = parseDocumentValue(invalid);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID" }),
    );
  });

  it("builds, validates, and canonically serializes a selected-edge chamfer", async () => {
    const cad = design("beveled-box");
    const box = cad.box("box", {
      size: vec3(mm(10), mm(20), mm(30)),
    });
    const edges = topology.edges
      .createdBy(box)
      .and(topology.edges.direction(scalarVec3(0, 0, 1)))
      .exactly(4);
    const beveled = cad.chamfer("beveled", box, {
      edges,
      distance: mm(2),
    });
    cad.output("beveled", beveled);
    const document = cad.build();

    expect(document.nodes[beveled.node]).toEqual({
      kind: "chamfer",
      input: { node: "box", kind: "solid" },
      edges: expect.objectContaining({
        topology: "edge",
        cardinality: { min: 4, max: 4 },
      }),
      distance: { op: "literal", dimension: "length", value: 2 },
    });
    expect(nodeDependencies(document.nodes[beveled.node]!)).toEqual([
      { node: "box", kind: "solid" },
    ]);
    expect(outputKindForNode(document.nodes[beveled.node]!)).toBe("solid");

    const reordered = JSON.parse(stringifyDocument(document)) as any;
    reordered.nodes.beveled.edges.query.queries.reverse();
    const parsed = parseDocumentValue(reordered);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(await hashDocument(parsed.value)).toBe(await hashDocument(document));
    }

    const unknownField = JSON.parse(stringifyDocument(document)) as any;
    unknownField.nodes.beveled.mode = "distance-angle";
    expect(parseDocumentValue(unknownField)).toEqual(
      expect.objectContaining({ ok: false }),
    );

    const missingDistance = JSON.parse(stringifyDocument(document)) as any;
    delete missingDistance.nodes.beveled.distance;
    expect(parseDocumentValue(missingDistance).diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID" }),
    );

    const scalarDistance = JSON.parse(stringifyDocument(document)) as any;
    scalarDistance.nodes.beveled.distance.dimension = "scalar";
    const wrongDimension = parseDocumentValue(scalarDistance);
    expect(wrongDimension.ok).toBe(false);
    expect(wrongDimension.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "EXPRESSION_DIMENSION_MISMATCH",
        path: "/nodes/beveled/distance",
      }),
    );

    const faceSelection = JSON.parse(stringifyDocument(document)) as any;
    faceSelection.nodes.beveled.edges.topology = "face";
    const wrongTopology = parseDocumentValue(faceSelection);
    expect(wrongTopology.ok).toBe(false);
    expect(wrongTopology.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "TOPOLOGY_SELECTOR_INVALID",
        path: "/nodes/beveled/edges/topology",
      }),
    );
  });

  it("builds, validates, and canonically serializes a face-selected shell", async () => {
    expect(Object.isFrozen(SHELL_DIRECTIONS)).toBe(true);
    expect(SHELL_DIRECTIONS).toEqual(["inward", "outward"]);
    expect(SHELL_JOIN_SEMANTICS).toBe("round");

    const cad = design("hollow-box");
    const box = cad.box("box", {
      size: vec3(mm(10), mm(20), mm(30)),
    });
    const openings = topology.faces
      .createdBy(box, { role: "box.face.z-max" })
      .and(topology.faces.normal(scalarVec3(0, 0, 1)))
      .select();
    const hollow = cad.shell("hollow", box, {
      openings,
      thickness: mm(2),
    });
    cad.output("hollow", hollow);
    const document = cad.build();
    expect(await hashDocument(document)).toBe(
      "bbb4fefcbfca6c9dacb7ec1d231ffe33a6765c80ea8226f27bf30922e2ffd2fb",
    );

    expect(document.nodes[hollow.node]).toEqual({
      kind: "shell",
      input: { node: "box", kind: "solid" },
      openings: expect.objectContaining({
        topology: "face",
        cardinality: { min: 1, max: 1 },
      }),
      thickness: { op: "literal", dimension: "length", value: 2 },
      direction: "inward",
      tolerance: {
        op: "literal",
        dimension: "length",
        value: 1e-6,
      },
    });
    expect(nodeDependencies(document.nodes[hollow.node]!)).toEqual([
      { node: "box", kind: "solid" },
    ]);
    expect(outputKindForNode(document.nodes[hollow.node]!)).toBe("solid");

    const reordered = JSON.parse(stringifyDocument(document)) as any;
    reordered.nodes.hollow.openings.query.queries.reverse();
    const parsed = parseDocumentValue(reordered);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(await hashDocument(parsed.value)).toBe(await hashDocument(document));
    }

    const unknownField = JSON.parse(stringifyDocument(document)) as any;
    unknownField.nodes.hollow.join = "intersection";
    expect(parseDocumentValue(unknownField).diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID" }),
    );

    const missingThickness = JSON.parse(stringifyDocument(document)) as any;
    delete missingThickness.nodes.hollow.thickness;
    expect(parseDocumentValue(missingThickness).diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID" }),
    );

    const missingTolerance = JSON.parse(stringifyDocument(document)) as any;
    delete missingTolerance.nodes.hollow.tolerance;
    expect(parseDocumentValue(missingTolerance).diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID" }),
    );

    const scalarThickness = JSON.parse(stringifyDocument(document)) as any;
    scalarThickness.nodes.hollow.thickness.dimension = "scalar";
    const wrongDimension = parseDocumentValue(scalarThickness);
    expect(wrongDimension.ok).toBe(false);
    expect(wrongDimension.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "EXPRESSION_DIMENSION_MISMATCH",
        path: "/nodes/hollow/thickness",
      }),
    );

    const invalidDirection = JSON.parse(stringifyDocument(document)) as any;
    invalidDirection.nodes.hollow.direction = "sideways";
    expect(parseDocumentValue(invalidDirection).diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID" }),
    );
    expect(validateDocument(invalidDirection).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IR_INVALID",
        node: "hollow",
        path: "/nodes/hollow/direction",
      }),
    );

    const scalarTolerance = JSON.parse(stringifyDocument(document)) as any;
    scalarTolerance.nodes.hollow.tolerance.dimension = "scalar";
    const wrongTolerance = parseDocumentValue(scalarTolerance);
    expect(wrongTolerance.ok).toBe(false);
    expect(wrongTolerance.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "EXPRESSION_DIMENSION_MISMATCH",
        path: "/nodes/hollow/tolerance",
      }),
    );

    const edgeSelection = JSON.parse(stringifyDocument(document)) as any;
    edgeSelection.nodes.hollow.openings.topology = "edge";
    const wrongTopology = parseDocumentValue(edgeSelection);
    expect(wrongTopology.ok).toBe(false);
    expect(wrongTopology.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "TOPOLOGY_SELECTOR_INVALID",
        path: "/nodes/hollow/openings/topology",
      }),
    );
  });

  it("rejects cross-design and non-ancestor provenance references", () => {
    const cad = design("first");
    const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
    const unrelated = cad.box("unrelated", {
      size: vec3(mm(2), mm(2), mm(2)),
    });
    const secondCad = design("second");
    const foreign = secondCad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });

    expect(() =>
      cad.fillet("foreign", box, {
        edges: topology.edges.createdBy(foreign).exactly(12),
        radius: mm(1),
      }),
    ).toThrow("cross design boundaries");

    expect(() =>
      cad.chamfer("foreign-chamfer", box, {
        edges: topology.edges.createdBy(foreign).exactly(12),
        distance: mm(1),
      }),
    ).toThrow("cross design boundaries");

    expect(() =>
      cad.chamfer("faces", box, {
        edges: topology.faces.all().select() as any,
        distance: mm(1),
      }),
    ).toThrow("edge topology selection");

    expect(() =>
      cad.chamfer("fake", box, {
        edges: { topology: "edge" } as any,
        distance: mm(1),
      }),
    ).toThrow("explicit topology selection");

    expect(() =>
      cad.shell("foreign-shell", box, {
        openings: topology.faces.createdBy(foreign).exactly(6),
        thickness: mm(1),
      }),
    ).toThrow("cross design boundaries");

    expect(() =>
      cad.shell("edges", box, {
        openings: topology.edges.all().select() as any,
        thickness: mm(1),
      }),
    ).toThrow("face topology selection");

    expect(() =>
      cad.shell("fake-shell", box, {
        openings: { topology: "face" } as any,
        thickness: mm(1),
      }),
    ).toThrow("explicit topology selection");

    expect(() =>
      cad.shell("invalid-shell-direction", box, {
        openings: topology.faces.all().select(),
        thickness: mm(1),
        direction: "sideways" as any,
      }),
    ).toThrow("'inward' or 'outward'");

    const rounded = cad.fillet("rounded", box, {
      edges: topology.edges.createdBy(box).exactly(12),
      radius: mm(1),
    });
    cad.output("rounded", rounded);
    const invalid = JSON.parse(stringifyDocument(cad.build())) as any;
    invalid.nodes.rounded.edges.query.feature = unrelated.node;
    const parsed = parseDocumentValue(invalid);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "TOPOLOGY_SELECTOR_INVALID" }),
    );
  });

  it("resolves set queries independently of kernel enumeration order", () => {
    const direction = topology.edges.direction(scalarVec3(0, 0, 1));
    const line = topology.edges.curve("line");
    expect(direction.and(line).ir).toEqual(line.and(direction).ir);

    const selection = direction.and(line).exactly(4).ir;
    const context: TopologyResolutionContext = {
      evaluate: (expression) =>
        expression.op === "literal" ? expression.value : Number.NaN,
      node: "rounded",
      path: "/nodes/rounded/edges",
    };
    const forward = resolveTopologySelection(selection, snapshot(), context);
    const reverse = resolveTopologySelection(
      selection,
      snapshot([...verticalEdges].reverse()),
      context,
    );
    expect(forward).toEqual({
      ok: true,
      value: [key("e00"), key("e01"), key("e10"), key("e11")],
      diagnostics: [],
    });
    if (forward.ok) expect(Object.isFrozen(forward.value)).toBe(false);
    expect(reverse.ok).toBe(true);
    if (!forward.ok || !reverse.ok) return;
    expect(reverse.value).toEqual(forward.value);

    const explained = explainTopologySelection(selection, snapshot(), context);
    expect(explained.ok).toBe(true);
    if (!explained.ok) return;
    expect(explained.value).toEqual({
      version: TOPOLOGY_SELECTION_EXPLANATION_VERSION,
      outcome: "resolved",
      topology: "edge",
      currentHistory: "complete",
      candidatesConsidered: 4,
      candidatesMatched: 4,
      minimumRequired: 4,
      maximumAllowed: 4,
      keys: [key("e00"), key("e01"), key("e10"), key("e11")],
    });
    expect(Object.isFrozen(explained.value)).toBe(true);
    if (explained.value.outcome !== "resolved") return;
    expect(Object.isFrozen(explained.value.keys)).toBe(true);
  });

  it("selects B-Rep vertices by position and traverses direct edge incidence", () => {
    const first: KernelVertexDescriptor = {
      topology: "vertex",
      key: key("v0"),
      point: [0, 0, 0],
      lineage: [{ feature: "box", relation: "created" }],
      edges: [key("edge")],
    };
    const second: KernelVertexDescriptor = {
      topology: "vertex",
      key: key("v1"),
      point: [10, 0, 0],
      lineage: [{ feature: "box", relation: "created" }],
      edges: [key("edge")],
    };
    const connecting: KernelEdgeDescriptor = {
      topology: "edge",
      key: key("edge"),
      center: [5, 0, 0],
      bounds: { min: [0, 0, 0], max: [10, 0, 0] },
      lineage: [{ feature: "box", relation: "created" }],
      length: 10,
      curve: { kind: "line", direction: [1, 0, 0] },
      faces: [],
      vertices: [first.key, second.key],
    };
    const current: KernelTopologySnapshot = {
      history: "complete",
      faces: [],
      edges: [connecting],
      vertices: [second, first],
    };
    const context: TopologyResolutionContext = {
      evaluate: (expression) =>
        expression.op === "literal" ? expression.value : Number.NaN,
    };

    const selectedVertex = topology.vertices
      .position(vec3(mm(0), mm(0), mm(0)))
      .select();
    expect(resolveTopologySelection(selectedVertex.ir, current, context)).toEqual({
      ok: true,
      value: [first.key],
      diagnostics: [],
    });
    expect(
      resolveTopologySelection(
        topology.edges.adjacentTo(selectedVertex).select().ir,
        current,
        context,
      ),
    ).toEqual({ ok: true, value: [connecting.key], diagnostics: [] });
    expect(
      resolveTopologySelection(
        topology.vertices
          .adjacentTo(topology.edges.all().select())
          .exactly(2).ir,
        current,
        context,
      ),
    ).toEqual({
      ok: true,
      value: [first.key, second.key],
      diagnostics: [],
    });
  });

  it("rejects non-finite evaluated vertex-position coordinates", () => {
    const resolved = resolveTopologySelection(
      topology.vertices
        .position(vec3(mm(0), mm(0), mm(0)))
        .exactly(1).ir,
      { history: "complete", faces: [], edges: [], vertices: [] },
      {
        evaluate: (expression) =>
          expression.op === "literal" && expression.value === 0
            ? Number.NaN
            : expression.op === "literal"
              ? expression.value
              : Number.NaN,
      },
    );

    expect(resolved.ok).toBe(false);
    expect(resolved.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_SELECTOR_INVALID",
      message: "Topology position coordinates must be finite",
    });
  });

  it("resolves persistent atoms from one normalized snapshot and caches each ID once", () => {
    const fixture = persistentEdgeFixture();
    const selection: TopologySelectionIR<"edge"> = {
      topology: "edge",
      query: {
        op: "and",
        queries: [
          fixture.selection.query,
          { op: "curve", kind: "line" },
          fixture.selection.query,
        ],
      },
      cardinality: { min: 1, max: 1 },
    };
    expect(topologySelectionRequirements(selection)).toMatchObject({
      kinds: ["edge"],
      geometry: true,
      adjacency: true,
      persistentReferences: [fixture.id],
    });

    let directionReads = 0;
    const curve = { kind: "line" } as {
      readonly kind: "line";
      readonly direction: readonly [number, number, number];
    };
    Object.defineProperty(curve, "direction", {
      enumerable: true,
      get() {
        directionReads += 1;
        return directionReads === 1 ? [0, 0, 1] : [1, 0, 0];
      },
    });
    const current = snapshot([
      { ...verticalEdges[0]!, curve },
      ...verticalEdges.slice(1),
    ]);
    const registry = {
      [fixture.id]: fixture.entry,
    } as Readonly<Record<TopologyReferenceId, TopologyReferenceEntryIR>>;
    const resolved = resolveTopologySelection(selection, current, {
      evaluate: (expression) =>
        expression.op === "literal" ? expression.value : Number.NaN,
      node: "rounded",
      path: "/nodes/rounded/edges",
      persistent: {
        registry,
        input: fixture.input,
        capabilities: signatureCapabilities,
        limits: { maxReferenceVariants: 1, maxCandidatePairs: 4 },
      },
    });

    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value).toEqual([key("e00")]);
    expect(directionReads).toBe(1);
  });

  it.each([
    [
      "more profiles than supported protocols",
      [
        { protocolVersion: 2, fingerprint: "direct/signatures@2" },
        signatureCapabilities,
        { protocolVersion: 1, fingerprint: "direct/other-signatures@1" },
      ],
    ],
    [
      "a repeated protocol",
      [
        { protocolVersion: 2, fingerprint: "direct/signatures@2" },
        { protocolVersion: 2, fingerprint: "direct/other-signatures@2" },
      ],
    ],
    [
      "a compatibility protocol newer than its primary",
      [
        signatureCapabilities,
        { protocolVersion: 2, fingerprint: "direct/signatures@2" },
      ],
    ],
  ] as const)("rejects direct persistent contexts with %s", (_label, profiles) => {
    const fixture = persistentEdgeFixture();
    let directionReads = 0;
    const curve = { kind: "line" } as {
      readonly kind: "line";
      readonly direction: readonly [number, number, number];
    };
    Object.defineProperty(curve, "direction", {
      enumerable: true,
      get() {
        directionReads += 1;
        return [0, 0, 1];
      },
    });
    const result = resolveTopologySelection(
      fixture.selection,
      snapshot([{ ...verticalEdges[0]!, curve }, ...verticalEdges.slice(1)]),
      {
        evaluate: (expression) =>
          expression.op === "literal" ? expression.value : Number.NaN,
        persistent: {
          registry: { [fixture.id]: fixture.entry } as Readonly<
            Record<TopologyReferenceId, TopologyReferenceEntryIR>
          >,
          input: fixture.input,
          capabilities: profiles as unknown as NonNullable<
            TopologyResolutionContext["persistent"]
          >["capabilities"],
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_SELECTOR_INVALID",
    });
    expect(directionReads).toBe(0);
  });

  it("copies direct signature profiles once before creating profile sessions", () => {
    const fixture = persistentEdgeFixture();
    let lengthReads = 0;
    let primaryProtocolReads = 0;
    let primaryFingerprintReads = 0;
    let compatibilityProtocolReads = 0;
    let compatibilityFingerprintReads = 0;
    const primary = Object.defineProperties({}, {
      protocolVersion: {
        enumerable: true,
        get() {
          primaryProtocolReads += 1;
          return primaryProtocolReads === 1 ? 2 : 1;
        },
      },
      fingerprint: {
        enumerable: true,
        get() {
          primaryFingerprintReads += 1;
          return primaryFingerprintReads === 1
            ? "direct/signatures@2"
            : signatureCapabilities.fingerprint;
        },
      },
    });
    const compatibility = Object.defineProperties({}, {
      protocolVersion: {
        enumerable: true,
        get() {
          compatibilityProtocolReads += 1;
          return compatibilityProtocolReads === 1 ? 1 : 2;
        },
      },
      fingerprint: {
        enumerable: true,
        get() {
          compatibilityFingerprintReads += 1;
          return compatibilityFingerprintReads === 1
            ? signatureCapabilities.fingerprint
            : "direct/signatures@2";
        },
      },
    });
    const profiles = new Proxy([primary, compatibility], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 2 : 1_000_000;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const result = resolveTopologySelection(fixture.selection, snapshot(), {
      evaluate: (expression) =>
        expression.op === "literal" ? expression.value : Number.NaN,
      persistent: {
        registry: { [fixture.id]: fixture.entry } as Readonly<
          Record<TopologyReferenceId, TopologyReferenceEntryIR>
        >,
        input: fixture.input,
        capabilities: profiles as unknown as NonNullable<
          TopologyResolutionContext["persistent"]
        >["capabilities"],
      },
    });

    expect(result).toEqual({
      ok: true,
      value: [key("e00")],
      diagnostics: [],
    });
    expect(lengthReads).toBe(1);
    expect(primaryProtocolReads).toBe(1);
    expect(primaryFingerprintReads).toBe(1);
    expect(compatibilityProtocolReads).toBe(1);
    expect(compatibilityFingerprintReads).toBe(1);
  });

  it("applies default snapshot limits before the first persistent copy", () => {
    const fixture = persistentEdgeFixture();
    const oversized = {
      history: "complete",
      faces: [],
      edges: new Array(
        DEFAULT_TOPOLOGY_SIGNATURE_LIMITS.maxTopologyItems + 1,
      ),
      vertices: [],
    } as unknown as KernelTopologySnapshot;
    const result = resolveTopologySelection(fixture.selection, oversized, {
      evaluate: (expression) =>
        expression.op === "literal" ? expression.value : Number.NaN,
      persistent: {
        registry: { [fixture.id]: fixture.entry } as Readonly<
          Record<TopologyReferenceId, TopologyReferenceEntryIR>
        >,
        input: fixture.input,
        capabilities: signatureCapabilities,
      },
    });

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
          message:
            "Topology-signature maxTopologyItems limit 100000 was exceeded by 100001",
          severity: "error",
          details: {
            resource: "maxTopologyItems",
            limit: 100_000,
            actual: 100_001,
          },
        },
      ],
    });
  });

  it("bounds direct-context topology-reference variants before scanning them", () => {
    const fixture = persistentEdgeFixture();
    const variants = new Array(
      DEFAULT_TOPOLOGY_SIGNATURE_LIMITS.maxReferenceVariants + 1,
    );
    const entry = {
      ...fixture.entry,
      variants,
    } as unknown as TopologyReferenceEntryIR;
    const result = resolveTopologySelection(fixture.selection, snapshot(), {
      evaluate: (expression) =>
        expression.op === "literal" ? expression.value : Number.NaN,
      persistent: {
        registry: { [fixture.id]: entry } as Readonly<
          Record<TopologyReferenceId, TopologyReferenceEntryIR>
        >,
        input: fixture.input,
        capabilities: signatureCapabilities,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
      details: {
        reference: fixture.id,
        resource: "maxReferenceVariants",
        limit: DEFAULT_TOPOLOGY_SIGNATURE_LIMITS.maxReferenceVariants,
        actual:
          DEFAULT_TOPOLOGY_SIGNATURE_LIMITS.maxReferenceVariants + 1,
      },
    });
  });

  it("bounds direct-context variants cumulatively across distinct references", () => {
    const fixture = persistentEdgeFixture();
    const secondId = "stored-edge-second" as TopologyReferenceId;
    const selection: TopologySelectionIR<"edge"> = {
      topology: "edge",
      query: {
        op: "or",
        queries: [
          fixture.selection.query,
          { op: "persistentReference", reference: secondId },
        ],
      },
      cardinality: { min: 1, max: 1 },
    };
    const result = resolveTopologySelection(selection, snapshot(), {
      evaluate: (expression) =>
        expression.op === "literal" ? expression.value : Number.NaN,
      node: "rounded",
      path: "/nodes/rounded/edges",
      persistent: {
        registry: {
          [fixture.id]: fixture.entry,
          [secondId]: fixture.entry,
        } as Readonly<
          Record<TopologyReferenceId, TopologyReferenceEntryIR>
        >,
        input: fixture.input,
        capabilities: signatureCapabilities,
        limits: { maxReferenceVariants: 1 },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
      node: "rounded",
      path: "/nodes/rounded/edges/query/queries/1/reference",
      details: {
        reference: secondId,
        resource: "maxReferenceVariants",
        limit: 1,
        actual: 2,
      },
    });
  });

  it.each([
    ["resolve", resolveTopologySelection],
    ["explain", explainTopologySelection],
  ] as const)(
    "detaches stateful registry and variant topology once for %s",
    (_operation, run) => {
      const fixture = persistentEdgeFixture();
      let entryTopologyReads = 0;
      let variantTopologyReads = 0;
      const variant = { ...fixture.entry.variants[0]! } as Record<
        string,
        unknown
      >;
      Object.defineProperty(variant, "topology", {
        enumerable: true,
        get() {
          variantTopologyReads += 1;
          return variantTopologyReads === 1 ? "edge" : "face";
        },
      });
      const entry = {
        target: fixture.entry.target,
        variants: [variant],
      } as Record<string, unknown>;
      Object.defineProperty(entry, "topology", {
        enumerable: true,
        get() {
          entryTopologyReads += 1;
          return entryTopologyReads === 1 ? "edge" : "face";
        },
      });

      const result = run(fixture.selection, snapshot(), {
        evaluate: (expression) =>
          expression.op === "literal" ? expression.value : Number.NaN,
        node: "rounded",
        path: "/nodes/rounded/edges",
        persistent: {
          registry: {
            [fixture.id]: entry,
          } as unknown as Readonly<
            Record<TopologyReferenceId, TopologyReferenceEntryIR>
          >,
          input: fixture.input,
          capabilities: signatureCapabilities,
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        if (Array.isArray(result.value)) {
          expect(result.value).toEqual([key("e00")]);
        } else {
          expect(result.value).toMatchObject({
            outcome: "resolved",
            topology: "edge",
            keys: [key("e00")],
          });
        }
      }
      expect(entryTopologyReads).toBe(1);
      expect(variantTopologyReads).toBe(1);
    },
  );

  it.each([
    ["resolve", resolveTopologySelection],
    ["explain", explainTopologySelection],
  ] as const)(
    "never returns a cross-kind key from a stateful %s variant",
    (_operation, run) => {
      const fixture = persistentEdgeFixture();
      const capturedFace = captureTopologyReference(
        adjacencySnapshot(),
        "face",
        key("fx"),
        {
          capabilities: signatureCapabilities,
          tolerance: { linear: 1e-9, angular: 1e-9, relative: 1e-9 },
        },
      );
      expect(capturedFace.ok).toBe(true);
      if (!capturedFace.ok) return;
      let topologyReads = 0;
      const statefulFaceVariant = {
        ...capturedFace.value,
      } as Record<string, unknown>;
      Object.defineProperty(statefulFaceVariant, "topology", {
        enumerable: true,
        get() {
          topologyReads += 1;
          return topologyReads === 1 ? "edge" : "face";
        },
      });
      const result = run(fixture.selection, adjacencySnapshot(), {
        evaluate: (expression) =>
          expression.op === "literal" ? expression.value : Number.NaN,
        node: "rounded",
        path: "/nodes/rounded/edges",
        persistent: {
          registry: {
            [fixture.id]: {
              ...fixture.entry,
              variants: [statefulFaceVariant],
            },
          } as unknown as Readonly<
            Record<TopologyReferenceId, TopologyReferenceEntryIR>
          >,
          input: fixture.input,
          capabilities: signatureCapabilities,
        },
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: "TOPOLOGY_SIGNATURE_INVALID",
        node: "rounded",
        path: "/nodes/rounded/edges/query/reference",
        details: { reference: fixture.id },
      });
      expect(topologyReads).toBe(1);
    },
  );

  it("fails a nested persistent atom at its exact query path", () => {
    const fixture = persistentEdgeFixture();
    const selection: TopologySelectionIR<"face"> = {
      topology: "face",
      query: {
        op: "adjacentTo",
        selection: fixture.selection,
      },
      cardinality: { min: 1, max: 1 },
    };
    const resolved = resolveTopologySelection(selection, adjacencySnapshot(), {
      evaluate: (expression) =>
        expression.op === "literal" ? expression.value : Number.NaN,
      node: "shell",
      path: "/nodes/shell/openings",
      persistent: {
        registry: {} as Readonly<
          Record<TopologyReferenceId, TopologyReferenceEntryIR>
        >,
        input: fixture.input,
        capabilities: signatureCapabilities,
      },
    });

    expect(resolved.ok).toBe(false);
    expect(resolved.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_SELECTOR_INVALID",
      node: "shell",
      path: "/nodes/shell/openings/query/selection/query/reference",
      details: { reference: fixture.id },
    });
  });

  it("rejects incompatible variants, topology kinds, and solid targets at the atom", () => {
    const fixture = persistentEdgeFixture();
    const baseContext = {
      evaluate: (expression: any): number => expression.value,
      node: "rounded",
      path: "/nodes/rounded/edges",
    };
    const resolveWith = (
      entry: TopologyReferenceEntryIR,
      capabilities = signatureCapabilities,
    ) =>
      resolveTopologySelection(fixture.selection, snapshot(), {
        ...baseContext,
        persistent: {
          registry: { [fixture.id]: entry } as Readonly<
            Record<TopologyReferenceId, TopologyReferenceEntryIR>
          >,
          input: fixture.input,
          capabilities,
        },
      });

    const incompatible = resolveWith(fixture.entry, {
      protocolVersion: 1,
      fingerprint: "different-kernel/signatures@1",
    });
    expect(incompatible.ok).toBe(false);
    expect(incompatible.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_FINGERPRINT_MISMATCH",
      path: "/nodes/rounded/edges/query/reference",
      details: { reference: fixture.id },
    });

    const wrongTopology = resolveWith({
      ...fixture.entry,
      topology: "face",
    } as unknown as TopologyReferenceEntryIR);
    expect(wrongTopology.ok).toBe(false);
    expect(wrongTopology.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_SELECTOR_INVALID",
      path: "/nodes/rounded/edges/query/reference",
      details: { expected: "edge", actual: "face" },
    });

    const wrongTarget = resolveWith({
      ...fixture.entry,
      target: { node: "other" as NodeId, kind: "solid" },
    });
    expect(wrongTarget.ok).toBe(false);
    expect(wrongTarget.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_SELECTOR_INVALID",
      path: "/nodes/rounded/edges/query/reference",
      details: { expected: fixture.input, actual: "other" },
    });
  });

  it("copies accessor-backed snapshots once before resolving selectors", () => {
    let directionReads = 0;
    const curve = { kind: "line" } as {
      readonly kind: "line";
      readonly direction: readonly [number, number, number];
    };
    Object.defineProperty(curve, "direction", {
      enumerable: true,
      get() {
        directionReads += 1;
        return directionReads === 1 ? [0, 0, 1] : [1, 0, 0];
      },
    });
    const stateful = {
      ...verticalEdges[0]!,
      curve,
    } as KernelEdgeDescriptor;

    const resolved = resolveTopologySelection(
      topology.edges.direction(scalarVec3(0, 0, 1)).exactly(1).ir,
      snapshot([stateful]),
      {
        evaluate: (expression) =>
          expression.op === "literal" ? expression.value : Number.NaN,
      },
    );

    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value).toEqual([key("e00")]);
    expect(directionReads).toBe(1);
  });

  it("contains revoked-proxy selector exceptions inside CadResult", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    const resolved = resolveTopologySelection(
      topology.edges.direction(scalarVec3(0, 0, 1)).exactly(1).ir,
      snapshot(),
      {
        evaluate() {
          throw revoked.proxy;
        },
      },
    );

    expect(resolved).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "TOPOLOGY_SELECTOR_INVALID",
          message: "Topology selector input could not be read",
          severity: "error",
        },
      ],
    });
  });

  it("distinguishes ambiguous, missing, incomplete-history, and invalid snapshots", () => {
    const context = {
      evaluate: (expression: any): number => expression.value,
      node: "rounded",
      path: "/nodes/rounded/edges",
    };
    const ambiguous = resolveTopologySelection(
      topology.edges.direction(scalarVec3(0, 0, 1)).select().ir,
      snapshot(),
      context,
    );
    expect(ambiguous.ok).toBe(false);
    const ambiguousDiagnostic = ambiguous.diagnostics[0]!;
    expect(ambiguousDiagnostic).toMatchObject({
      code: "TOPOLOGY_SELECTION_AMBIGUOUS",
      message: "Topology selector matched 4 edges; expected at most 1",
      node: "rounded",
      path: "/nodes/rounded/edges",
      details: {
        topology: "edge",
        actual: 4,
        maximum: 1,
        matchesTruncated: false,
        explanation: {
          version: TOPOLOGY_SELECTION_EXPLANATION_VERSION,
          outcome: "ambiguous",
          topology: "edge",
          currentHistory: "complete",
          candidatesConsidered: 4,
          candidatesMatched: 4,
          minimumRequired: 1,
          maximumAllowed: 1,
        },
      },
    });
    expect((ambiguousDiagnostic.details?.matches as readonly unknown[]).length).toBe(
      4,
    );
    const ambiguousExplanation = ambiguousDiagnostic.details?.explanation as object;
    expect(Object.isFrozen(ambiguousExplanation)).toBe(true);
    expect(Object.hasOwn(ambiguousExplanation, "keys")).toBe(false);

    const missing = resolveTopologySelection(
      topology.edges.curve("circle").select().ir,
      snapshot(),
      context,
    );
    expect(missing.ok).toBe(false);
    const missingDiagnostic = missing.diagnostics[0]!;
    expect(missingDiagnostic).toMatchObject({
      code: "TOPOLOGY_SELECTION_MISSING",
      message: "Topology selector matched 0 edges; expected at least 1",
      node: "rounded",
      path: "/nodes/rounded/edges",
      details: {
        topology: "edge",
        actual: 0,
        minimum: 1,
        candidatesTruncated: false,
        explanation: {
          version: TOPOLOGY_SELECTION_EXPLANATION_VERSION,
          outcome: "missing",
          topology: "edge",
          currentHistory: "complete",
          candidatesConsidered: 4,
          candidatesMatched: 0,
          minimumRequired: 1,
          maximumAllowed: 1,
        },
      },
    });
    expect((missingDiagnostic.details?.candidates as readonly unknown[]).length).toBe(
      4,
    );
    const missingExplanation = missingDiagnostic.details?.explanation as object;
    expect(Object.isFrozen(missingExplanation)).toBe(true);
    expect(Object.hasOwn(missingExplanation, "keys")).toBe(false);

    const cad = design("origin-query");
    const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
    const history = resolveTopologySelection(
      topology.edges.createdBy(box).atLeast(1).ir,
      snapshot(verticalEdges, "partial"),
      context,
    );
    expect(history.ok).toBe(false);
    expect(history.diagnostics[0]?.code).toBe("TOPOLOGY_HISTORY_UNAVAILABLE");

    const duplicate = resolveTopologySelection(
      topology.edges.all().atLeast(1).ir,
      snapshot([verticalEdges[0]!, verticalEdges[0]!]),
      context,
    );
    expect(duplicate.ok).toBe(false);
    expect(duplicate.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "KERNEL_ERROR",
        details: expect.objectContaining({ protocolViolation: true }),
      }),
    );

    const invalidLineage = resolveTopologySelection(
      topology.edges.all().atLeast(1).ir,
      snapshot([
        {
          ...verticalEdges[0]!,
          lineage: [
            {
              feature: "box",
              relation: "created",
              role: "box.face.x-min",
            },
          ],
        } as KernelEdgeDescriptor,
      ]),
      context,
    );
    expect(invalidLineage.ok).toBe(false);
    expect(invalidLineage.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "KERNEL_ERROR",
        details: expect.objectContaining({ protocolViolation: true }),
      }),
    );

    const invalidHistory = resolveTopologySelection(
      topology.edges.all().atLeast(1).ir,
      { ...snapshot(), history: "bogus" } as unknown as KernelTopologySnapshot,
      context,
    );
    expect(invalidHistory.ok).toBe(false);
    expect(invalidHistory.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "KERNEL_ERROR",
        details: expect.objectContaining({ protocolViolation: true }),
      }),
    );

    const misplacedDescriptor = resolveTopologySelection(
      topology.edges.all().atLeast(1).ir,
      {
        history: "complete",
        faces: [verticalEdges[0]],
        edges: [],
        vertices: [],
      } as unknown as KernelTopologySnapshot,
      context,
    );
    expect(misplacedDescriptor.ok).toBe(false);
    expect(misplacedDescriptor.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "KERNEL_ERROR",
        details: expect.objectContaining({ protocolViolation: true }),
      }),
    );
  });

  it("composes oriented face normals, adjacency, unions, and complements", () => {
    const context = {
      evaluate: (expression: any): number => expression.value,
      node: "rounded",
      path: "/nodes/rounded/edges",
    };
    const xMinimum = topology.faces
      .normal(scalarVec3(-1, 0, 0))
      .select();
    const yMinimum = topology.faces
      .normal(scalarVec3(0, -1, 0))
      .select();
    const commonEdge = topology.edges
      .adjacentTo(xMinimum)
      .and(topology.edges.adjacentTo(yMinimum))
      .select();
    const resolvedEdge = resolveTopologySelection(
      commonEdge.ir,
      adjacencySnapshot(),
      context,
    );
    expect(resolvedEdge.ok).toBe(true);
    if (resolvedEdge.ok) expect(resolvedEdge.value).toEqual([key("e00")]);

    const eitherFace = topology.faces
      .normal(scalarVec3(-1, 0, 0))
      .or(topology.faces.normal(scalarVec3(0, -1, 0)))
      .exactly(2);
    const resolvedFaces = resolveTopologySelection(
      eitherFace.ir,
      adjacencySnapshot(),
      context,
    );
    expect(resolvedFaces.ok).toBe(true);
    if (resolvedFaces.ok) {
      expect(resolvedFaces.value).toEqual([key("fx"), key("fy")]);
    }

    const notXMinimum = topology.faces
      .surface("plane")
      .and(topology.faces.normal(scalarVec3(-1, 0, 0)).not())
      .select();
    const complement = resolveTopologySelection(
      notXMinimum.ir,
      adjacencySnapshot(),
      context,
    );
    expect(complement.ok).toBe(true);
    if (complement.ok) expect(complement.value).toEqual([key("fy")]);
  });

  it("preserves evaluator selection diagnostics while attaching explanations", async () => {
    const delegate = await createManifoldKernel();
    let filletInvoked = false;
    const kernel = new Proxy(delegate, {
      get(target, property) {
        if (property === "id") return "selection-explanation-test";
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            features: [...target.capabilities.features, "fillet"],
            topology: {
              kinds: ["face", "edge"],
              provenance: "feature",
              semanticRoles: true,
              sketchSources: true,
              geometry: true,
              adjacency: true,
            },
          };
        }
        if (property === "topology") return () => snapshot();
        if (property === "fillet") {
          return () => {
            filletInvoked = true;
            throw new Error("Fillet must not run after selection failure");
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GeometryKernel;
    const evaluator = await createEvaluator({ kernel });

    try {
      const cases = [
        {
          name: "missing",
          selection: topology.edges.curve("circle").select(),
          code: "TOPOLOGY_SELECTION_MISSING",
          outcome: "missing",
          candidatesMatched: 0,
        },
        {
          name: "ambiguous",
          selection: topology.edges.all().select(),
          code: "TOPOLOGY_SELECTION_AMBIGUOUS",
          outcome: "ambiguous",
          candidatesMatched: 4,
        },
      ] as const;

      for (const fixture of cases) {
        const cad = design(`selection-${fixture.name}`);
        const box = cad.box("box", {
          size: vec3(mm(10), mm(20), mm(30)),
        });
        const rounded = cad.fillet("rounded", box, {
          edges: fixture.selection,
          radius: mm(1),
        });
        cad.output("rounded", rounded);

        const result = await evaluator.evaluate(cad.build());
        expect(result.ok).toBe(false);
        const selectionDiagnostic = result.diagnostics.find(
          (item) => item.code === fixture.code,
        );
        expect(selectionDiagnostic).toMatchObject({
          code: fixture.code,
          node: "rounded",
          path: "/nodes/rounded/edges",
          details: {
            explanation: {
              version: TOPOLOGY_SELECTION_EXPLANATION_VERSION,
              outcome: fixture.outcome,
              topology: "edge",
              currentHistory: "complete",
              candidatesConsidered: 4,
              candidatesMatched: fixture.candidatesMatched,
              minimumRequired: 1,
              maximumAllowed: 1,
            },
          },
        });
        const explanation = selectionDiagnostic?.details?.explanation as object;
        expect(Object.isFrozen(explanation)).toBe(true);
        expect(Object.hasOwn(explanation, "keys")).toBe(false);
      }
      expect(filletInvoked).toBe(false);
    } finally {
      evaluator.dispose();
    }
  });

  it("fails before selection when the active kernel cannot fillet", async () => {
    const evaluator = await createEvaluator();
    try {
      const cad = design("unsupported-fillet");
      const box = cad.box("box", {
        size: vec3(mm(10), mm(10), mm(10)),
      });
      cad.output(
        "rounded",
        cad.fillet("rounded", box, {
          edges: topology.edges.createdBy(box).exactly(12),
          radius: mm(1),
        }),
      );
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "rounded",
          details: expect.objectContaining({ capability: "fillet" }),
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("fails before selection when the active kernel cannot chamfer", async () => {
    const evaluator = await createEvaluator();
    try {
      const cad = design("unsupported-chamfer");
      const box = cad.box("box", {
        size: vec3(mm(10), mm(10), mm(10)),
      });
      cad.output(
        "beveled",
        cad.chamfer("beveled", box, {
          edges: topology.edges.createdBy(box).exactly(12),
          distance: mm(1),
        }),
      );
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "beveled",
          path: "/nodes/beveled",
          details: expect.objectContaining({ capability: "chamfer" }),
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("fails before selection when the active kernel cannot shell", async () => {
    const evaluator = await createEvaluator();
    try {
      const cad = design("unsupported-shell");
      const box = cad.box("box", {
        size: vec3(mm(10), mm(10), mm(10)),
      });
      cad.output(
        "hollow",
        cad.shell("hollow", box, {
          openings: topology.faces
            .createdBy(box, { role: "box.face.z-max" })
            .select(),
          thickness: mm(1),
        }),
      );
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "hollow",
          path: "/nodes/hollow",
          details: expect.objectContaining({ capability: "shell" }),
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("reports malformed chamfer capability declarations and missing topology", async () => {
    const document = (() => {
      const cad = design("chamfer-preflight");
      const box = cad.box("box", {
        size: vec3(mm(10), mm(10), mm(10)),
      });
      cad.output(
        "beveled",
        cad.chamfer("beveled", box, {
          edges: topology.edges.all().atLeast(1),
          distance: mm(1),
        }),
      );
      return cad.build();
    })();

    const malformedDelegate = await createManifoldKernel();
    const malformed = new Proxy(malformedDelegate, {
      get(target, property) {
        if (property === "id") return "malformed-chamfer";
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            features: [...target.capabilities.features, "chamfer"],
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GeometryKernel;
    const malformedEvaluator = await createEvaluator({ kernel: malformed });
    try {
      const result = await malformedEvaluator.evaluate(document);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "beveled",
          details: expect.objectContaining({
            capability: "chamfer",
            protocolViolation: true,
          }),
        }),
      );
    } finally {
      malformedEvaluator.dispose();
    }

    const noTopologyDelegate = await createManifoldKernel();
    let invoked = false;
    const noTopology = new Proxy(noTopologyDelegate, {
      get(target, property) {
        if (property === "id") return "chamfer-without-topology";
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            features: [...target.capabilities.features, "chamfer"],
          };
        }
        if (property === "chamfer") {
          return () => {
            invoked = true;
            throw new Error("Chamfer must not be invoked without topology");
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GeometryKernel;
    const noTopologyEvaluator = await createEvaluator({ kernel: noTopology });
    try {
      const result = await noTopologyEvaluator.evaluate(document);
      expect(result.ok).toBe(false);
      expect(invoked).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "beveled",
          path: "/nodes/beveled/edges",
          details: expect.objectContaining({
            kind: "topology",
            capability: "edge-selection",
          }),
        }),
      );
    } finally {
      noTopologyEvaluator.dispose();
    }
  });

  it("reports malformed shell capability declarations and missing face topology", async () => {
    const document = (() => {
      const cad = design("shell-preflight");
      const box = cad.box("box", {
        size: vec3(mm(10), mm(10), mm(10)),
      });
      cad.output(
        "hollow",
        cad.shell("hollow", box, {
          openings: topology.faces.all().atLeast(1),
          thickness: mm(1),
        }),
      );
      return cad.build();
    })();

    const malformedDelegate = await createManifoldKernel();
    const malformed = new Proxy(malformedDelegate, {
      get(target, property) {
        if (property === "id") return "malformed-shell";
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            features: [...target.capabilities.features, "shell"],
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GeometryKernel;
    const malformedEvaluator = await createEvaluator({ kernel: malformed });
    try {
      const result = await malformedEvaluator.evaluate(document);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "hollow",
          details: expect.objectContaining({
            capability: "shell",
            protocolViolation: true,
          }),
        }),
      );
    } finally {
      malformedEvaluator.dispose();
    }

    const noTopologyDelegate = await createManifoldKernel();
    let invoked = false;
    const noTopology = new Proxy(noTopologyDelegate, {
      get(target, property) {
        if (property === "id") return "shell-without-topology";
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            features: [...target.capabilities.features, "shell"],
          };
        }
        if (property === "shell") {
          return () => {
            invoked = true;
            throw new Error("Shell must not be invoked without topology");
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GeometryKernel;
    const noTopologyEvaluator = await createEvaluator({ kernel: noTopology });
    try {
      const result = await noTopologyEvaluator.evaluate(document);
      expect(result.ok).toBe(false);
      expect(invoked).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "hollow",
          path: "/nodes/hollow/openings",
          details: expect.objectContaining({
            kind: "topology",
            capability: "face-selection",
          }),
        }),
      );
    } finally {
      noTopologyEvaluator.dispose();
    }
  });
});
