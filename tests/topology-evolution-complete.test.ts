import { describe, expect, it } from "vitest";
import {
  INDEXED_TOPOLOGY_KIND as KIND,
  INDEXED_TOPOLOGY_RELATION as RELATION,
  TopologyEvolutionProtocolError,
  reduceCompleteIndexedTopologyEvolution,
  validateCompleteIndexedTopologyEvolutionEnvelope,
  type IndexedTopologyCounts,
  type IndexedTopologyEvolutionEnvelope,
  type IndexedTopologyEvolutionRecord,
  type ReduceCompleteIndexedTopologyEvolutionOptions,
} from "../src/internal/topology-evolution.js";
import type {
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelTopologyKey,
  KernelTopologyLineage,
  KernelTopologySnapshot,
} from "../src/protocol/topology.js";

const INT32_MAX = 2_147_483_647;

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
  };
}

function snapshot(
  history: KernelTopologySnapshot["history"],
  faces: readonly KernelFaceDescriptor[] = [],
  edges: readonly KernelEdgeDescriptor[] = [],
): KernelTopologySnapshot {
  return { history, faces, edges };
}

function counts(
  faces: number,
  edges: number,
  vertices = 0,
): IndexedTopologyCounts {
  return { faces, edges, vertices };
}

function record(
  sourceShapeIndex: number,
  sourceKind: number,
  sourceIndex: number,
  relation: number,
  resultKind: number,
  resultIndex: number,
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

function deleted(
  sourceShapeIndex: number,
  sourceKind: number,
  sourceIndex: number,
): IndexedTopologyEvolutionRecord {
  return record(
    sourceShapeIndex,
    sourceKind,
    sourceIndex,
    RELATION.DELETED,
    KIND.NONE,
    -1,
  );
}

function created(
  resultKind: number,
  resultIndex: number,
): IndexedTopologyEvolutionRecord {
  return record(
    -1,
    KIND.NONE,
    -1,
    RELATION.CREATED,
    resultKind,
    resultIndex,
  );
}

function envelope(
  inputCounts: readonly IndexedTopologyCounts[],
  resultCounts: IndexedTopologyCounts,
  records: readonly IndexedTopologyEvolutionRecord[],
): IndexedTopologyEvolutionEnvelope {
  return {
    version: 1,
    complete: true,
    inputShapeCount: inputCounts.length,
    inputCounts,
    resultCounts,
    records,
  };
}

function cloneEnvelope(
  value: IndexedTopologyEvolutionEnvelope,
): IndexedTopologyEvolutionEnvelope {
  return {
    ...value,
    inputCounts: value.inputCounts.map((item) => ({ ...item })),
    resultCounts: { ...value.resultCounts },
    records: value.records.map((item) => ({ ...item })),
  };
}

function identityEnvelope(): IndexedTopologyEvolutionEnvelope {
  return envelope(
    [counts(1, 0)],
    counts(1, 0),
    [record(0, KIND.FACE, 0, RELATION.PRESERVED, KIND.FACE, 0)],
  );
}

function identityOptions(): ReduceCompleteIndexedTopologyEvolutionOptions {
  return {
    feature: "boolean",
    inputs: [
      snapshot("complete", [
        face("input-face", [{ feature: "box", relation: "created" }]),
      ]),
    ],
    output: snapshot("partial", [
      face("result-face", [
        { feature: "untrusted-output", relation: "created" },
      ]),
    ]),
    evolution: identityEnvelope(),
  };
}

function manyToManyOptions(
  records?: readonly IndexedTopologyEvolutionRecord[],
): ReduceCompleteIndexedTopologyEvolutionOptions {
  const targetFaceLineage: readonly KernelTopologyLineage[] = [
    {
      feature: "target-box",
      relation: "created",
      role: "box.face.x-min",
      source: {
        kind: "sketch-entity",
        sketch: "target-sketch",
        entity: "target-line",
      },
    },
    { feature: "shared-ancestor", relation: "created" },
  ];
  const sacrificialLineage: readonly KernelTopologyLineage[] = [
    { feature: "sacrificial-face", relation: "created" },
  ];
  const targetEdgeLineage: readonly KernelTopologyLineage[] = [
    {
      feature: "target-box",
      relation: "created",
      role: "box.edge.x-min-y-min",
    },
  ];
  const toolFaceLineage: readonly KernelTopologyLineage[] = [
    { feature: "tool-box", relation: "created" },
    { feature: "shared-ancestor", relation: "created" },
  ];
  const toolEdgeLineage: readonly KernelTopologyLineage[] = [
    {
      feature: "tool-box",
      relation: "created",
      role: "box.edge.y-max-z-max",
    },
  ];
  const evolutionRecords = records ?? [
    // Deliberately non-canonical native order.
    record(1, KIND.EDGE, 0, RELATION.PRESERVED, KIND.EDGE, 1),
    record(0, KIND.FACE, 1, RELATION.GENERATED, KIND.FACE, 1),
    record(1, KIND.FACE, 0, RELATION.PRESERVED, KIND.FACE, 0),
    record(0, KIND.FACE, 0, RELATION.GENERATED, KIND.EDGE, 1),
    record(0, KIND.EDGE, 0, RELATION.MODIFIED, KIND.EDGE, 0),
    deleted(0, KIND.FACE, 1),
    record(0, KIND.FACE, 0, RELATION.MODIFIED, KIND.FACE, 0),
  ];
  return {
    feature: "boolean-result",
    inputs: [
      snapshot(
        "complete",
        [
          face("target-face", targetFaceLineage),
          face("sacrificial-face", sacrificialLineage),
        ],
        [edge("target-edge", targetEdgeLineage)],
      ),
      snapshot(
        "complete",
        [face("tool-face", toolFaceLineage)],
        [edge("tool-edge", toolEdgeLineage)],
      ),
    ],
    output: snapshot(
      "partial",
      [
        face("merged-face", [
          { feature: "untrusted-output", relation: "created" },
        ]),
        face("generated-face", [
          { feature: "untrusted-output", relation: "created" },
        ]),
      ],
      [
        edge("modified-edge", [
          { feature: "untrusted-output", relation: "created" },
        ]),
        edge("preserved-plus-generated-edge", [
          { feature: "untrusted-output", relation: "created" },
        ]),
      ],
    ),
    evolution: envelope(
      [counts(2, 1), counts(1, 1)],
      counts(2, 2),
      evolutionRecords,
    ),
    allowCreated: false,
  };
}

function generatedOptions(
  resultKind: typeof KIND.FACE | typeof KIND.EDGE,
): ReduceCompleteIndexedTopologyEvolutionOptions {
  const sourceLineage: readonly KernelTopologyLineage[] = [
    {
      feature: "source-box",
      relation: "created",
      role: "box.face.z-max",
      source: {
        kind: "sketch-entity",
        sketch: "source-sketch",
        entity: "source-curve",
      },
    },
  ];
  return {
    feature: "boolean-result",
    inputs: [snapshot("complete", [face("source", sourceLineage)])],
    output:
      resultKind === KIND.FACE
        ? snapshot("partial", [face("generated", [])])
        : snapshot("partial", [], [edge("generated", [])]),
    evolution: envelope(
      [counts(1, 0)],
      resultKind === KIND.FACE ? counts(1, 0) : counts(0, 1),
      [
        record(0, KIND.FACE, 0, RELATION.GENERATED, resultKind, 0),
        deleted(0, KIND.FACE, 0),
      ],
    ),
    allowCreated: false,
  };
}

function expectInvalid(
  value: IndexedTopologyEvolutionEnvelope,
  options: { readonly allowCreated?: boolean } = {},
): void {
  expect(() =>
    validateCompleteIndexedTopologyEvolutionEnvelope(value, options),
  ).toThrow(TopologyEvolutionProtocolError);
}

describe("complete indexed topology evolution", () => {
  it("merges many-to-many lineage deterministically in canonical source order", () => {
    const options = manyToManyOptions();
    const forward = reduceCompleteIndexedTopologyEvolution(options);
    const reversed = reduceCompleteIndexedTopologyEvolution(
      manyToManyOptions([...options.evolution.records].reverse()),
    );

    expect(forward).toEqual(reversed);
    expect(forward.history).toBe("complete");
    expect(forward.faces[0]!.lineage).toEqual([
      {
        feature: "target-box",
        relation: "created",
        role: "box.face.x-min",
        source: {
          kind: "sketch-entity",
          sketch: "target-sketch",
          entity: "target-line",
        },
      },
      { feature: "shared-ancestor", relation: "created" },
      { feature: "tool-box", relation: "created" },
      { feature: "boolean-result", relation: "modified" },
    ]);
    expect(forward.faces[1]!.lineage).toEqual([
      { feature: "boolean-result", relation: "created" },
    ]);
    expect(forward.edges[0]!.lineage).toEqual([
      {
        feature: "target-box",
        relation: "created",
        role: "box.edge.x-min-y-min",
      },
      { feature: "boolean-result", relation: "modified" },
    ]);
    // The cross-kind GENERATED cause neither contributes face lineage nor
    // turns an identity-preserved edge into current-feature CREATED.
    expect(forward.edges[1]!.lineage).toEqual([
      {
        feature: "tool-box",
        relation: "created",
        role: "box.edge.y-max-z-max",
      },
    ]);
  });

  it("makes a purely same-kind GENERATED result current-feature CREATED without inherited lineage", () => {
    const result = reduceCompleteIndexedTopologyEvolution(
      generatedOptions(KIND.FACE),
    );

    expect(result.faces[0]!.lineage).toEqual([
      { feature: "boolean-result", relation: "created" },
    ]);
  });

  it("supports a source retained directly while also producing modified splits", () => {
    const sourceLineage = [{ feature: "source", relation: "created" as const }];
    const result = reduceCompleteIndexedTopologyEvolution({
      feature: "boolean",
      inputs: [snapshot("complete", [face("source", sourceLineage)])],
      output: snapshot("partial", [face("direct", []), face("split", [])]),
      evolution: envelope(
        [counts(1, 0)],
        counts(2, 0),
        [
          record(0, KIND.FACE, 0, RELATION.PRESERVED, KIND.FACE, 0),
          record(0, KIND.FACE, 0, RELATION.MODIFIED, KIND.FACE, 1),
        ],
      ),
      allowCreated: false,
    });

    expect(result.faces[0]!.lineage).toEqual(sourceLineage);
    expect(result.faces[1]!.lineage).toEqual([
      ...sourceLineage,
      { feature: "boolean", relation: "modified" },
    ]);
  });

  it("makes a purely cross-kind GENERATED result current-feature CREATED without incompatible lineage", () => {
    const result = reduceCompleteIndexedTopologyEvolution(
      generatedOptions(KIND.EDGE),
    );

    expect(result.edges[0]!.lineage).toEqual([
      { feature: "boolean-result", relation: "created" },
    ]);
  });

  it("lets an identity predecessor dominate additional GENERATED causality", () => {
    const options = identityOptions();
    const generatedCause = record(
      1,
      KIND.FACE,
      0,
      RELATION.GENERATED,
      KIND.FACE,
      0,
    );
    const generatedSourceDeletion = deleted(1, KIND.FACE, 0);
    const result = reduceCompleteIndexedTopologyEvolution({
      ...options,
      inputs: [
        options.inputs[0]!,
        snapshot("complete", [
          face("causal-tool", [
            { feature: "causal-tool", relation: "created" },
          ]),
        ]),
      ],
      evolution: envelope(
        [counts(1, 0), counts(1, 0)],
        counts(1, 0),
        [
          generatedCause,
          record(0, KIND.FACE, 0, RELATION.MODIFIED, KIND.FACE, 0),
          generatedSourceDeletion,
        ],
      ),
    });

    expect(result.faces[0]!.lineage).toEqual([
      { feature: "box", relation: "created" },
      { feature: "boolean", relation: "modified" },
    ]);
    expect(result.faces[0]!.lineage).not.toContainEqual({
      feature: "causal-tool",
      relation: "created",
    });
  });

  it("uses source-less CREATED as the complete lineage for a result", () => {
    const output = face("created-face", [
      { feature: "untrusted-output", relation: "modified" },
    ]);
    const result = reduceCompleteIndexedTopologyEvolution({
      feature: "native-feature",
      inputs: [snapshot("complete")],
      output: snapshot("partial", [output]),
      evolution: envelope([counts(0, 0)], counts(1, 0), [
        created(KIND.FACE, 0),
      ]),
    });

    expect(result.faces[0]!.lineage).toEqual([
      { feature: "native-feature", relation: "created" },
    ]);
  });

  it("accepts a source that is both DELETED and causally GENERATED", () => {
    const options = generatedOptions(KIND.EDGE);
    expect(() =>
      validateCompleteIndexedTopologyEvolutionEnvelope(options.evolution, {
        allowCreated: false,
      }),
    ).not.toThrow();
    expect(
      reduceCompleteIndexedTopologyEvolution(options).edges[0]!.lineage,
    ).toEqual([{ feature: "boolean-result", relation: "created" }]);
  });

  it("supports a fully deleted input and an empty result", () => {
    const result = reduceCompleteIndexedTopologyEvolution({
      feature: "subtraction",
      inputs: [
        snapshot("complete", [
          face("removed", [{ feature: "target", relation: "created" }]),
        ]),
      ],
      output: snapshot("partial"),
      evolution: envelope([counts(1, 0)], counts(0, 0), [
        deleted(0, KIND.FACE, 0),
      ]),
      allowCreated: false,
    });

    expect(result).toEqual({ history: "complete", faces: [], edges: [] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.faces)).toBe(true);
    expect(Object.isFrozen(result.edges)).toBe(true);
  });

  it("propagates partial input history while applying complete local evolution", () => {
    const options = identityOptions();
    const result = reduceCompleteIndexedTopologyEvolution({
      ...options,
      inputs: [{ ...options.inputs[0]!, history: "partial" }],
    });

    expect(result.history).toBe("partial");
    expect(result.faces[0]!.lineage).toEqual([
      { feature: "box", relation: "created" },
    ]);
  });

  it("keeps current-feature creation dominant across a later identity modification", () => {
    const options = identityOptions();
    const result = reduceCompleteIndexedTopologyEvolution({
      ...options,
      inputs: [
        snapshot("complete", [
          face("created-in-an-earlier-stage", [
            { feature: "boolean", relation: "created" },
          ]),
        ]),
      ],
      evolution: envelope(
        [counts(1, 0)],
        counts(1, 0),
        [record(0, KIND.FACE, 0, RELATION.MODIFIED, KIND.FACE, 0)],
      ),
    });

    expect(result.faces[0]!.lineage).toEqual([
      { feature: "boolean", relation: "created" },
    ]);
  });

  it("forbids CREATED in both validation and reduction when allowCreated is false", () => {
    const evolution = envelope([counts(0, 0)], counts(1, 0), [
      created(KIND.FACE, 0),
    ]);
    expectInvalid(evolution, { allowCreated: false });
    expect(() =>
      reduceCompleteIndexedTopologyEvolution({
        feature: "boolean",
        inputs: [snapshot("complete")],
        output: snapshot("complete", [face("created", [])]),
        evolution,
        allowCreated: false,
      }),
    ).toThrow("CREATED, which this feature profile forbids");
  });

  it("accepts complete vertex-only history at the envelope boundary", () => {
    expect(() =>
      validateCompleteIndexedTopologyEvolutionEnvelope(
        envelope(
          [counts(0, 0, 1)],
          counts(0, 0, 1),
          [record(0, KIND.VERTEX, 0, RELATION.MODIFIED, KIND.VERTEX, 0)],
        ),
      ),
    ).not.toThrow();
  });

  it.each([
    ["a null envelope", () => null as unknown as IndexedTopologyEvolutionEnvelope],
    ["an unknown version", () => ({ ...identityEnvelope(), version: 2 })],
    ["incomplete native history", () => ({ ...identityEnvelope(), complete: false })],
    ["zero input shapes", () => ({ ...identityEnvelope(), inputShapeCount: 0, inputCounts: [] })],
    ["a fractional input shape count", () => ({ ...identityEnvelope(), inputShapeCount: 1.5 })],
    ["mismatched input count entries", () => ({ ...identityEnvelope(), inputShapeCount: 2 })],
    ["non-array input counts", () => ({ ...identityEnvelope(), inputCounts: {} as never })],
    ["non-array records", () => ({ ...identityEnvelope(), records: {} as never })],
    ["a negative topology count", () => ({ ...identityEnvelope(), inputCounts: [counts(-1, 0)] })],
    ["a fractional topology count", () => ({ ...identityEnvelope(), resultCounts: counts(1.5, 0) })],
    ["an oversized topology count", () => ({ ...identityEnvelope(), resultCounts: counts(INT32_MAX + 1, 0) })],
    ["an unknown relation", () => ({
      ...identityEnvelope(),
      records: [{ ...identityEnvelope().records[0]!, relation: 99 }],
    })],
  ])("fails closed for %s", (_label, makeEvolution) => {
    expectInvalid(makeEvolution());
  });

  it.each([
    ["negative source shape", { sourceShapeIndex: -1 }],
    ["NONE source kind", { sourceKind: KIND.NONE }],
    ["negative source index", { sourceIndex: -1 }],
    ["NONE result kind", { resultKind: KIND.NONE }],
    ["negative result index", { resultIndex: -1 }],
    ["out-of-range source shape", { sourceShapeIndex: 1 }],
    ["out-of-range source topology", { sourceIndex: 1 }],
    ["out-of-range result topology", { resultIndex: 1 }],
    ["unknown source kind", { sourceKind: 77 }],
    ["unknown result kind", { resultKind: 88 }],
    ["fractional source index", { sourceIndex: 0.5 }],
    ["oversized result index", { resultIndex: INT32_MAX + 1 }],
  ])("rejects %s on a source/result link", (_label, change) => {
    const value = cloneEnvelope(identityEnvelope());
    expectInvalid({
      ...value,
      records: [{ ...value.records[0]!, ...change }],
    });
  });

  it.each([
    [
      "a kind-changing PRESERVED link",
      record(0, KIND.FACE, 0, RELATION.PRESERVED, KIND.EDGE, 0),
    ],
    [
      "a kind-changing MODIFIED link",
      record(0, KIND.FACE, 0, RELATION.MODIFIED, KIND.EDGE, 0),
    ],
  ])("rejects %s", (_label, invalidRecord) => {
    expectInvalid(
      envelope([counts(1, 0)], counts(0, 1), [invalidRecord]),
    );
  });

  it.each([
    ["a DELETED sourceShapeIndex sentinel", { sourceShapeIndex: -1 }],
    ["a DELETED sourceKind sentinel", { sourceKind: KIND.NONE }],
    ["a DELETED sourceIndex sentinel", { sourceIndex: -1 }],
    ["a non-NONE DELETED result kind", { resultKind: KIND.FACE }],
    ["a non-negative DELETED result index", { resultIndex: 0 }],
  ])("rejects %s", (_label, change) => {
    const invalidRecord = { ...deleted(0, KIND.FACE, 0), ...change };
    expectInvalid(envelope([counts(1, 0)], counts(0, 0), [invalidRecord]));
  });

  it.each([
    ["a non-sentinel CREATED source shape", { sourceShapeIndex: 0 }],
    ["a non-NONE CREATED source kind", { sourceKind: KIND.FACE }],
    ["a non-sentinel CREATED source index", { sourceIndex: 0 }],
    ["a NONE CREATED result kind", { resultKind: KIND.NONE }],
    ["a negative CREATED result index", { resultIndex: -1 }],
  ])("rejects %s", (_label, change) => {
    const invalidRecord = { ...created(KIND.FACE, 0), ...change };
    expectInvalid(envelope([counts(0, 0)], counts(1, 0), [invalidRecord]));
  });

  it("requires every source to have an identity successor or DELETED record", () => {
    const value = identityEnvelope();
    expectInvalid({ ...value, records: [] });
  });

  it("does not treat GENERATED causality alone as source identity coverage", () => {
    expectInvalid(
      envelope(
        [counts(1, 0)],
        counts(1, 0),
        [record(0, KIND.FACE, 0, RELATION.GENERATED, KIND.FACE, 0)],
      ),
    );
  });

  it("requires every result to be attributed or source-less CREATED", () => {
    expectInvalid(envelope([counts(0, 0)], counts(1, 0), []));
  });

  it("rejects exact duplicate records", () => {
    const value = identityEnvelope();
    expectInvalid({ ...value, records: [value.records[0]!, value.records[0]!] });
  });

  it("rejects multiple relations for one source/result pair", () => {
    expectInvalid(
      envelope(
        [counts(1, 0)],
        counts(1, 0),
        [
          record(0, KIND.FACE, 0, RELATION.PRESERVED, KIND.FACE, 0),
          record(0, KIND.FACE, 0, RELATION.MODIFIED, KIND.FACE, 0),
        ],
      ),
    );
  });

  it("rejects duplicate DELETED and duplicate CREATED records", () => {
    const removed = deleted(0, KIND.FACE, 0);
    expectInvalid(
      envelope([counts(1, 0)], counts(0, 0), [removed, removed]),
    );
    const born = created(KIND.FACE, 0);
    expectInvalid(envelope([counts(0, 0)], counts(1, 0), [born, born]));
  });

  it.each([
    [
      "DELETED followed by PRESERVED",
      [
        deleted(0, KIND.FACE, 0),
        record(0, KIND.FACE, 0, RELATION.PRESERVED, KIND.FACE, 0),
      ],
    ],
    [
      "MODIFIED followed by DELETED",
      [
        record(0, KIND.FACE, 0, RELATION.MODIFIED, KIND.FACE, 0),
        deleted(0, KIND.FACE, 0),
      ],
    ],
  ])("rejects contradictory source history: %s", (_label, records) => {
    expectInvalid(envelope([counts(1, 0)], counts(1, 0), records));
  });

  it.each([
    [
      "CREATED followed by attribution",
      [
        created(KIND.FACE, 0),
        record(0, KIND.FACE, 0, RELATION.PRESERVED, KIND.FACE, 0),
      ],
    ],
    [
      "attribution followed by CREATED",
      [
        record(0, KIND.FACE, 0, RELATION.PRESERVED, KIND.FACE, 0),
        created(KIND.FACE, 0),
      ],
    ],
  ])("rejects contradictory result history: %s", (_label, records) => {
    expectInvalid(envelope([counts(1, 0)], counts(1, 0), records));
  });

  it("fails quickly for near-INT32_MAX uncovered counts without count-sized loops", () => {
    const started = Date.now();
    expectInvalid(
      envelope([counts(INT32_MAX, 0)], counts(INT32_MAX, 0), []),
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("rejects a record array whose declared length exceeds the int32 ABI", () => {
    const records = new Array<IndexedTopologyEvolutionRecord>(INT32_MAX + 1);
    expectInvalid({ ...identityEnvelope(), records });
  });

  it("rejects sparse input-count and record arrays", () => {
    const sparseCounts = Array(1) as IndexedTopologyCounts[];
    expectInvalid({ ...identityEnvelope(), inputCounts: sparseCounts });

    const sparseRecords = Array(1) as IndexedTopologyEvolutionRecord[];
    expectInvalid({ ...identityEnvelope(), records: sparseRecords });
  });

  it("rejects sparse snapshots, descriptors, and lineage during reduction", () => {
    const options = identityOptions();
    const sparseInputs = Array(1) as KernelTopologySnapshot[];
    expect(() =>
      reduceCompleteIndexedTopologyEvolution({
        ...options,
        inputs: sparseInputs,
      }),
    ).toThrow(TopologyEvolutionProtocolError);

    const sparseFaces = Array(1) as KernelFaceDescriptor[];
    expect(() =>
      reduceCompleteIndexedTopologyEvolution({
        ...options,
        output: snapshot("complete", sparseFaces),
      }),
    ).toThrow(TopologyEvolutionProtocolError);

    const sparseLineage = Array(1) as KernelTopologyLineage[];
    expect(() =>
      reduceCompleteIndexedTopologyEvolution({
        ...options,
        inputs: [
          snapshot("complete", [face("sparse-lineage", sparseLineage)]),
        ],
      }),
    ).toThrow(TopologyEvolutionProtocolError);
  });

  it("validates reducer input cardinality, descriptors, and feature context", () => {
    const options = identityOptions();
    expect(() =>
      reduceCompleteIndexedTopologyEvolution({ ...options, inputs: [] }),
    ).toThrow("inputs has 0 count; expected 1");
    expect(() =>
      reduceCompleteIndexedTopologyEvolution({
        ...options,
        output: snapshot("complete"),
      }),
    ).toThrow("output.faces has 0 count; expected 1");
    expect(() =>
      reduceCompleteIndexedTopologyEvolution({
        ...options,
        output: {
          ...options.output,
          faces: [
            { ...options.output.faces[0]!, topology: "edge" },
          ] as unknown as readonly KernelFaceDescriptor[],
        },
      }),
    ).toThrow("output.faces[0] is not a face descriptor");
    expect(() =>
      reduceCompleteIndexedTopologyEvolution({ ...options, feature: "" }),
    ).toThrow("feature must be a non-empty string");
  });

  it("copies lineage deeply and freezes every newly owned output layer", () => {
    const sourceLineage: KernelTopologyLineage[] = [
      {
        feature: "mutable-source",
        relation: "created",
        role: "box.face.y-min",
        source: {
          kind: "sketch-entity",
          sketch: "mutable-sketch",
          entity: "mutable-entity",
        },
      },
    ];
    const outputLineage: KernelTopologyLineage[] = [
      { feature: "untrusted-output", relation: "created" },
    ];
    const outputFace = face("immutable-result", outputLineage);
    const result = reduceCompleteIndexedTopologyEvolution({
      feature: "boolean",
      inputs: [
        snapshot("complete", [face("mutable-source", sourceLineage)]),
      ],
      output: snapshot("partial", [outputFace]),
      evolution: envelope(
        [counts(1, 0)],
        counts(1, 0),
        [record(0, KIND.FACE, 0, RELATION.MODIFIED, KIND.FACE, 0)],
      ),
    });

    (sourceLineage[0] as { feature: string }).feature = "mutated";
    (sourceLineage[0]!.source as { sketch: string }).sketch = "mutated";
    sourceLineage.push({ feature: "late", relation: "created" });
    outputLineage.push({ feature: "late-output", relation: "modified" });

    expect(result.faces[0]!.lineage).toEqual([
      {
        feature: "mutable-source",
        relation: "created",
        role: "box.face.y-min",
        source: {
          kind: "sketch-entity",
          sketch: "mutable-sketch",
          entity: "mutable-entity",
        },
      },
      { feature: "boolean", relation: "modified" },
    ]);
    expect(result.faces[0]!.key).toBe(outputFace.key);
    expect(result.faces[0]!.center).toBe(outputFace.center);
    expect(result.faces[0]!.bounds).toBe(outputFace.bounds);
    expect(result.faces[0]!.surface).toBe(outputFace.surface);
    expect(result.faces[0]!.edges).toBe(outputFace.edges);
    expect(result.faces[0]!.area).toBe(outputFace.area);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.faces)).toBe(true);
    expect(Object.isFrozen(result.edges)).toBe(true);
    expect(Object.isFrozen(result.faces[0])).toBe(true);
    expect(Object.isFrozen(result.faces[0]!.lineage)).toBe(true);
    expect(Object.isFrozen(result.faces[0]!.lineage[0])).toBe(true);
    expect(Object.isFrozen(result.faces[0]!.lineage[0]!.source)).toBe(true);
    expect(() =>
      (result.faces as KernelFaceDescriptor[]).push(face("mutation", [])),
    ).toThrow(TypeError);
    expect(() =>
      (result.faces[0]!.lineage as KernelTopologyLineage[]).push({
        feature: "mutation",
        relation: "created",
      }),
    ).toThrow(TypeError);
  });
});
