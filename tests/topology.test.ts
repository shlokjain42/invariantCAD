import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  createManifoldKernel,
  design,
  hashDocument,
  parseDocumentValue,
  resolveTopologySelection,
  scalarVec3,
  stringifyDocument,
  topology,
  vec3,
  mm,
  nodeDependencies,
  outputKindForNode,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type GeometryKernel,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
} from "../src/index.js";

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
  return { history, faces: [], edges };
}

function adjacencySnapshot(): KernelTopologySnapshot {
  return {
    history: "complete",
    faces: [xMinimumFace, yMinimumFace],
    edges: adjacentEdges,
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
    const forward = resolveTopologySelection(selection, snapshot(), {
      evaluate: (expression) =>
        expression.op === "literal" ? expression.value : Number.NaN,
      node: "rounded",
      path: "/nodes/rounded/edges",
    });
    const reverse = resolveTopologySelection(
      selection,
      snapshot([...verticalEdges].reverse()),
      {
        evaluate: (expression) =>
          expression.op === "literal" ? expression.value : Number.NaN,
        node: "rounded",
        path: "/nodes/rounded/edges",
      },
    );
    expect(forward.ok).toBe(true);
    expect(reverse.ok).toBe(true);
    if (!forward.ok || !reverse.ok) return;
    expect(forward.value).toEqual([key("e00"), key("e01"), key("e10"), key("e11")]);
    expect(reverse.value).toEqual(forward.value);
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
    expect(ambiguous.diagnostics[0]).toEqual(
      expect.objectContaining({
        code: "TOPOLOGY_SELECTION_AMBIGUOUS",
        path: "/nodes/rounded/edges",
      }),
    );

    const missing = resolveTopologySelection(
      topology.edges.curve("circle").select().ir,
      snapshot(),
      context,
    );
    expect(missing.ok).toBe(false);
    expect(missing.diagnostics[0]?.code).toBe("TOPOLOGY_SELECTION_MISSING");

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
});
