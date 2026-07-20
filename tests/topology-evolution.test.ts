import { describe, expect, it } from "vitest";
import {
  INDEXED_TOPOLOGY_KIND as KIND,
  INDEXED_TOPOLOGY_RELATION as RELATION,
  TopologyEvolutionProtocolError,
  reduceIndexedTopologyEvolution,
  type IndexedTopologyCounts,
  type IndexedTopologyEvolutionEnvelope,
  type IndexedTopologyEvolutionRecord,
  type ReduceIndexedTopologyEvolutionOptions,
} from "../src/internal/topology-evolution.js";
import type {
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelTopologyKey,
  KernelTopologyLineage,
  KernelTopologySnapshot,
  KernelVertexDescriptor,
} from "../src/protocol/topology.js";

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

function face(
  id: string,
  lineage: readonly KernelTopologyLineage[],
): KernelFaceDescriptor {
  return {
    topology: "face",
    key: key(id),
    center: [1, 2, 3],
    bounds: { min: [0, 0, 0], max: [2, 3, 4] },
    lineage,
    area: 24,
    surface: { kind: "plane", normal: [0, 0, 1] },
    edges: [key(`${id}:edge`)],
  };
}

function edge(
  id: string,
  lineage: readonly KernelTopologyLineage[],
): KernelEdgeDescriptor {
  return {
    topology: "edge",
    key: key(id),
    center: [2, 3, 4],
    bounds: { min: [1, 2, 3], max: [3, 4, 5] },
    lineage,
    length: 8,
    curve: { kind: "line", direction: [1, 0, 0] },
    faces: [key(`${id}:face`)],
    vertices: [key(`${id}:vertex`)],
  };
}

function vertex(
  id: string,
  lineage: readonly KernelTopologyLineage[],
): KernelVertexDescriptor {
  return {
    topology: "vertex",
    key: key(id),
    point: [2, 3, 4],
    lineage,
    edges: [key(`${id}:edge`)],
  };
}

function snapshot(
  history: KernelTopologySnapshot["history"],
  faces: readonly KernelFaceDescriptor[],
  edges: readonly KernelEdgeDescriptor[],
  vertices: readonly KernelVertexDescriptor[] = [],
): KernelTopologySnapshot {
  return { history, faces, edges, vertices };
}

function counts(
  faces: number,
  edges: number,
  vertices: number,
): IndexedTopologyCounts {
  return { faces, edges, vertices };
}

function record(
  sourceKind: number,
  sourceIndex: number,
  relation: number,
  resultKind = sourceKind,
  resultIndex = sourceIndex,
  sourceShapeIndex = 0,
): IndexedTopologyEvolutionRecord {
  return {
    sourceShapeIndex,
    sourceKind,
    sourceIndex,
    relation,
    resultKind,
    resultIndex,
  };
}

function simpleOptions(): ReduceIndexedTopologyEvolutionOptions {
  const inputLineage = [{ feature: "box", relation: "created" as const }];
  const outputLineage = [
    { feature: "untrusted-base", relation: "created" as const },
  ];
  return {
    feature: "draft",
    inputs: [
      snapshot(
        "complete",
        [face("input-face", inputLineage)],
        [edge("input-edge", inputLineage)],
        [vertex("input-vertex", inputLineage)],
      ),
    ],
    output: snapshot(
      "partial",
      [face("result-face", outputLineage)],
      [edge("result-edge", outputLineage)],
      [vertex("result-vertex", outputLineage)],
    ),
    evolution: {
      version: 1,
      complete: true,
      inputShapeCount: 1,
      inputCounts: [counts(1, 1, 1)],
      resultCounts: counts(1, 1, 1),
      records: [
        record(KIND.FACE, 0, RELATION.MODIFIED),
        record(KIND.EDGE, 0, RELATION.PRESERVED),
        record(KIND.VERTEX, 0, RELATION.MODIFIED),
      ],
    },
  };
}

function replaceEvolution(
  options: ReduceIndexedTopologyEvolutionOptions,
  evolution: Partial<IndexedTopologyEvolutionEnvelope>,
): ReduceIndexedTopologyEvolutionOptions {
  return {
    ...options,
    evolution: { ...options.evolution, ...evolution },
  };
}

function expectProtocolError(options: ReduceIndexedTopologyEvolutionOptions): void {
  expect(() => reduceIndexedTopologyEvolution(options)).toThrow(
    TopologyEvolutionProtocolError,
  );
}

describe("exact indexed topology evolution", () => {
  it("maps an N-input permutation and overrides base lineage by result index", () => {
    const firstFaceLineage = [
      { feature: "first", relation: "created" as const },
    ];
    const secondFaceLineage = [
      { feature: "second", relation: "created" as const },
    ];
    const edgeLineage = [
      { feature: "first-edge", relation: "created" as const },
      { feature: "draft", relation: "modified" as const },
    ];
    const firstInput = snapshot(
      "complete",
      [face("first-face", firstFaceLineage)],
      [edge("first-edge", edgeLineage)],
      [vertex("first-vertex", edgeLineage)],
    );
    const secondInput = snapshot(
      "complete",
      [face("second-face", secondFaceLineage)],
      [],
      [vertex("second-vertex", secondFaceLineage)],
    );
    const baseLineage = [
      { feature: "base-must-be-replaced", relation: "created" as const },
    ];
    const firstOutputFace = face("result-face-0", baseLineage);
    const secondOutputFace = face("result-face-1", baseLineage);
    const outputEdge = edge("result-edge-0", baseLineage);

    const result = reduceIndexedTopologyEvolution({
      feature: "draft",
      inputs: [firstInput, secondInput],
      output: snapshot(
        "partial",
        [firstOutputFace, secondOutputFace],
        [outputEdge],
        [
          vertex("result-vertex-0", baseLineage),
          vertex("result-vertex-1", baseLineage),
        ],
      ),
      evolution: {
        version: 1,
        complete: true,
        inputShapeCount: 2,
        inputCounts: [counts(1, 1, 1), counts(1, 0, 1)],
        resultCounts: counts(2, 1, 2),
        records: [
          record(KIND.FACE, 0, RELATION.PRESERVED, KIND.FACE, 1, 0),
          record(KIND.FACE, 0, RELATION.MODIFIED, KIND.FACE, 0, 1),
          record(KIND.EDGE, 0, RELATION.MODIFIED, KIND.EDGE, 0, 0),
          record(KIND.VERTEX, 0, RELATION.MODIFIED, KIND.VERTEX, 1, 0),
          record(KIND.VERTEX, 0, RELATION.PRESERVED, KIND.VERTEX, 0, 1),
        ],
      },
    });

    expect(result.history).toBe("complete");
    expect(result.faces[0]!.lineage).toEqual([
      ...secondFaceLineage,
      { feature: "draft", relation: "modified" },
    ]);
    expect(result.faces[1]!.lineage).toEqual(firstFaceLineage);
    expect(result.edges[0]!.lineage).toEqual(edgeLineage);
    expect(result.vertices[0]!.lineage).toEqual(secondFaceLineage);
    expect(result.vertices[1]!.lineage).toEqual(edgeLineage);
    expect(
      [...result.faces, ...result.edges, ...result.vertices].flatMap(
        (item) => item.lineage,
      ),
    ).not.toContainEqual({
      feature: "base-must-be-replaced",
      relation: "created",
    });

    expect(result.faces[0]!.key).toBe(firstOutputFace.key);
    expect(result.faces[0]!.center).toBe(firstOutputFace.center);
    expect(result.faces[0]!.bounds).toBe(firstOutputFace.bounds);
    expect(result.faces[0]!.surface).toBe(firstOutputFace.surface);
    expect(result.faces[0]!.edges).toBe(firstOutputFace.edges);
    expect(result.faces[0]!.area).toBe(firstOutputFace.area);
    expect(result.edges[0]!.key).toBe(outputEdge.key);
    expect(result.edges[0]!.curve).toBe(outputEdge.curve);
    expect(result.edges[0]!.faces).toBe(outputEdge.faces);
    expect(result.edges[0]!.vertices).toBe(outputEdge.vertices);
    expect(result.edges[0]!.length).toBe(outputEdge.length);
    expect(result.vertices[0]!.point).toEqual([2, 3, 4]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.faces)).toBe(true);
    expect(Object.isFrozen(result.edges)).toBe(true);
    expect(Object.isFrozen(result.vertices)).toBe(true);
    for (const descriptor of [
      ...result.faces,
      ...result.edges,
      ...result.vertices,
    ]) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.lineage)).toBe(true);
    }
  });

  it("retains partial history while still applying exact local evolution", () => {
    const options = simpleOptions();
    const input = options.inputs[0]!;
    const result = reduceIndexedTopologyEvolution({
      ...options,
      inputs: [{ ...input, history: "partial" }],
    });

    expect(result.history).toBe("partial");
    expect(result.faces[0]!.lineage).toEqual([
      { feature: "box", relation: "created" },
      { feature: "draft", relation: "modified" },
    ]);
    expect(result.edges[0]!.lineage).toEqual([
      { feature: "box", relation: "created" },
    ]);
    expect(result.vertices[0]!.lineage).toEqual([
      { feature: "box", relation: "created" },
      { feature: "draft", relation: "modified" },
    ]);
  });

  it("preserves exact inherited lineage when no feature context is provided", () => {
    const options = simpleOptions();
    const result = reduceIndexedTopologyEvolution({
      evolution: options.evolution,
      inputs: options.inputs,
      output: options.output,
    });

    expect(result.history).toBe("complete");
    expect(result.faces[0]!.lineage).toEqual([
      { feature: "box", relation: "created" },
    ]);
    expect(result.edges[0]!.lineage).toEqual([
      { feature: "box", relation: "created" },
    ]);
    expect(result.vertices[0]!.lineage).toEqual([
      { feature: "box", relation: "created" },
    ]);
  });

  it("isolates lineage from mutable inputs and outputs", () => {
    const sourceLineage: KernelTopologyLineage[] = [
      { feature: "source", relation: "created" },
    ];
    const baseLineage: KernelTopologyLineage[] = [
      { feature: "base", relation: "created" },
    ];
    const options = simpleOptions();
    const result = reduceIndexedTopologyEvolution({
      ...options,
      inputs: [
        snapshot(
          "complete",
          [face("mutable-input-face", sourceLineage)],
          [edge("mutable-input-edge", sourceLineage)],
          [vertex("mutable-input-vertex", sourceLineage)],
        ),
      ],
      output: snapshot(
        "complete",
        [face("mutable-output-face", baseLineage)],
        [edge("mutable-output-edge", baseLineage)],
        [vertex("mutable-output-vertex", baseLineage)],
      ),
    });

    (sourceLineage[0] as { feature: string }).feature = "mutated-source";
    sourceLineage.push({ feature: "late-source", relation: "modified" });
    baseLineage.push({ feature: "late-base", relation: "modified" });
    expect(result.faces[0]!.lineage).toEqual([
      { feature: "source", relation: "created" },
      { feature: "draft", relation: "modified" },
    ]);
    expect(result.edges[0]!.lineage).toEqual([
      { feature: "source", relation: "created" },
    ]);
    expect(() =>
      (result.faces[0]!.lineage as KernelTopologyLineage[]).push({
        feature: "mutation",
        relation: "modified",
      }),
    ).toThrow(TypeError);
    expect(() =>
      (result.faces as KernelFaceDescriptor[]).push(
        face("mutation", sourceLineage),
      ),
    ).toThrow(TypeError);
  });

  it("rejects an empty feature before creating ambiguous lineage", () => {
    expect(() =>
      reduceIndexedTopologyEvolution({ ...simpleOptions(), feature: "" }),
    ).toThrow("feature must be a non-empty string");
  });

  it("reports a null evolution envelope as a protocol failure", () => {
    expectProtocolError({
      ...simpleOptions(),
      evolution: null as unknown as IndexedTopologyEvolutionEnvelope,
    });
  });

  it.each([
    ["an unknown version", (value: IndexedTopologyEvolutionEnvelope) => ({ ...value, version: 2 })],
    ["incomplete native history", (value: IndexedTopologyEvolutionEnvelope) => ({ ...value, complete: false })],
    ["a fractional input count", (value: IndexedTopologyEvolutionEnvelope) => ({ ...value, inputShapeCount: 1.5 })],
    ["an oversized topology count", (value: IndexedTopologyEvolutionEnvelope) => ({ ...value, resultCounts: counts(2_147_483_648, 1, 1) })],
    ["an oversized record index", (value: IndexedTopologyEvolutionEnvelope) => ({
      ...value,
      records: [
        { ...value.records[0]!, sourceIndex: 2_147_483_648 },
        ...value.records.slice(1),
      ],
    })],
  ])("fails closed for %s", (_label, mutate) => {
    const options = simpleOptions();
    expectProtocolError(replaceEvolution(options, mutate(options.evolution)));
  });

  it("validates declared shape and descriptor counts", () => {
    const options = simpleOptions();
    expectProtocolError(
      replaceEvolution(options, { inputShapeCount: 2 }),
    );
    expectProtocolError(
      replaceEvolution(options, { inputCounts: [counts(2, 1, 1)] }),
    );
    expectProtocolError(
      replaceEvolution(options, { resultCounts: counts(1, 1, 0) }),
    );
    expectProtocolError({
      ...options,
      output: {
        ...options.output,
        faces: [
          { ...options.output.faces[0]!, topology: "edge" },
        ] as unknown as readonly KernelFaceDescriptor[],
      },
    });
  });

  it("rejects sparse protocol arrays instead of skipping missing entries", () => {
    const options = simpleOptions();
    const sparseCounts = Array(1) as IndexedTopologyCounts[];
    expectProtocolError(
      replaceEvolution(options, { inputCounts: sparseCounts }),
    );

    const sparseInputFaces = Array(1) as KernelFaceDescriptor[];
    expectProtocolError({
      ...options,
      inputs: [{ ...options.inputs[0]!, faces: sparseInputFaces }],
    });

    const sparseOutputFaces = Array(1) as KernelFaceDescriptor[];
    expectProtocolError({
      ...options,
      output: { ...options.output, faces: sparseOutputFaces },
    });

    const sparseLineage = Array(1) as KernelTopologyLineage[];
    expectProtocolError({
      ...options,
      inputs: [
        {
          ...options.inputs[0]!,
          faces: [
            { ...options.inputs[0]!.faces[0]!, lineage: sparseLineage },
          ],
        },
      ],
    });

    const sparseRecords = Array(3) as IndexedTopologyEvolutionRecord[];
    expectProtocolError(
      replaceEvolution(options, { records: sparseRecords }),
    );
  });

  it.each([
    RELATION.GENERATED,
    RELATION.DELETED,
    RELATION.CREATED,
    99,
  ])("rejects unsupported or unknown relation %s", (relation) => {
    const options = simpleOptions();
    expectProtocolError(
      replaceEvolution(options, {
        records: [
          { ...options.evolution.records[0]!, relation },
          ...options.evolution.records.slice(1),
        ],
      }),
    );
  });

  it.each([
    ["NONE", KIND.NONE],
    ["unknown", 88],
  ])("rejects %s topology kinds", (_label, sourceKind) => {
    const options = simpleOptions();
    expectProtocolError(
      replaceEvolution(options, {
        records: [
          { ...options.evolution.records[0]!, sourceKind },
          ...options.evolution.records.slice(1),
        ],
      }),
    );
  });

  it.each([
    ["source shape", { sourceShapeIndex: 1 }],
    ["source topology", { sourceIndex: 1 }],
    ["result topology", { resultIndex: 1 }],
    ["kind change", { resultKind: KIND.EDGE }],
  ])("rejects an out-of-range or invalid %s mapping", (_label, change) => {
    const options = simpleOptions();
    expectProtocolError(
      replaceEvolution(options, {
        records: [
          { ...options.evolution.records[0]!, ...change },
          ...options.evolution.records.slice(1),
        ],
      }),
    );
  });

  it("requires one record per source and result topology", () => {
    const input = snapshot(
      "complete",
      [face("face-0", []), face("face-1", [])],
      [],
    );
    const output = snapshot(
      "complete",
      [face("result-0", []), face("result-1", [])],
      [],
    );
    const base: ReduceIndexedTopologyEvolutionOptions = {
      feature: "draft",
      inputs: [input],
      output,
      evolution: {
        version: 1,
        complete: true,
        inputShapeCount: 1,
        inputCounts: [counts(2, 0, 0)],
        resultCounts: counts(2, 0, 0),
        records: [
          record(KIND.FACE, 0, RELATION.PRESERVED),
          record(KIND.FACE, 1, RELATION.MODIFIED),
        ],
      },
    };

    expectProtocolError(
      replaceEvolution(base, {
        records: [base.evolution.records[0]!],
      }),
    );
    expectProtocolError(
      replaceEvolution(base, {
        records: [
          base.evolution.records[0]!,
          { ...base.evolution.records[1]!, sourceIndex: 0 },
        ],
      }),
    );
    expectProtocolError(
      replaceEvolution(base, {
        records: [
          base.evolution.records[0]!,
          { ...base.evolution.records[1]!, resultIndex: 0 },
        ],
      }),
    );
  });
});
