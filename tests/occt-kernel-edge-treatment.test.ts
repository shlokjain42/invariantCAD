import { describe, expect, it, vi } from "vitest";
import createStockOcctModule from "occt-wasm/dist/occt-wasm.js";
import { kernelSupports } from "../src/kernel.js";
import {
  DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT,
  createOcctKernel,
  type OcctModuleFactory,
} from "../src/occt-kernel.js";
import {
  TopologyEvolutionProtocolError,
} from "../src/internal/topology-evolution.js";

const KIND = Object.freeze({
  NONE: -1,
  FACE: 0,
  EDGE: 1,
  VERTEX: 2,
});

const RELATION = Object.freeze({
  PRESERVED: 0,
  MODIFIED: 1,
  GENERATED: 2,
  DELETED: 3,
  CREATED: 4,
});

const BOOLEAN_OPERATION = Object.freeze({
  UNION: 0,
  SUBTRACT: 1,
  INTERSECT: 2,
});

const EDGE_TREATMENT_OPERATION = Object.freeze({
  FILLET: 0,
  CHAMFER: 1,
});

interface RawVector {
  size(): number;
  get(index: number): number;
  delete(): void;
}

interface RawKernel {
  release(id: number): void;
  copy(id: number): number;
  getShapeCount(): number;
  getSubShapes(id: number, topology: string): RawVector;
  subShapeCount(id: number, topology: string): number;
  isSame(first: number, second: number): boolean;
}

interface Counts {
  faces: number;
  edges: number;
  vertices: number;
}

interface EvolutionRecord {
  sourceShapeIndex: number;
  sourceKind: number;
  sourceIndex: number;
  relation: number;
  resultKind: number;
  resultIndex: number;
}

interface EdgeTreatmentInvocation {
  readonly operation: number;
  readonly inputId: number;
  readonly edgeIds: readonly number[];
  readonly selectedEdgeIndices: readonly number[];
  readonly amount: number;
  readonly maxHistoryRecords: number;
  readonly resultId: number;
}

interface EdgeTreatmentFacadeState {
  raw?: RawKernel;
  readonly invocations: EdgeTreatmentInvocation[];
  readonly takeResultCalls: number[];
  readonly reportOwnedReleases: number[];
  readonly resultReleaseCalls: Map<number, number>;
  beforeResultCount?: number;
  lastResultId?: number;
}

interface EdgeTreatmentFacadeOptions {
  readonly inputFaceDelta?: number;
  readonly resultFaceDelta?: number;
  readonly transferCode?: string;
  readonly malformedRelation?: boolean;
  readonly abortOnTake?: AbortController;
  readonly failResultTopology?: boolean;
}

function vectorValues(vector: RawVector): number[] {
  return Array.from({ length: vector.size() }, (_, index) => vector.get(index));
}

function topologyCounts(raw: RawKernel, shapeId: number): Counts {
  return {
    faces: raw.subShapeCount(shapeId, "face"),
    edges: raw.subShapeCount(shapeId, "edge"),
    vertices: raw.subShapeCount(shapeId, "vertex"),
  };
}

function countForKind(counts: Counts, kind: number): number {
  switch (kind) {
    case KIND.FACE:
      return counts.faces;
    case KIND.EDGE:
      return counts.edges;
    case KIND.VERTEX:
      return counts.vertices;
    default:
      throw new Error(`Unknown topology kind ${kind}`);
  }
}

function identity(
  kind: number,
  index: number,
  relation: number,
): EvolutionRecord {
  return {
    sourceShapeIndex: 0,
    sourceKind: kind,
    sourceIndex: index,
    relation,
    resultKind: kind,
    resultIndex: index,
  };
}

function deleted(kind: number, sourceIndex: number): EvolutionRecord {
  return {
    sourceShapeIndex: 0,
    sourceKind: kind,
    sourceIndex,
    relation: RELATION.DELETED,
    resultKind: KIND.NONE,
    resultIndex: -1,
  };
}

function created(kind: number, resultIndex: number): EvolutionRecord {
  return {
    sourceShapeIndex: -1,
    sourceKind: KIND.NONE,
    sourceIndex: -1,
    relation: RELATION.CREATED,
    resultKind: kind,
    resultIndex,
  };
}

/**
 * Produces a complete graph for a copied input. Index 0 is modified while
 * index 2 is deliberately deleted and recreated without an identity source.
 */
function recordsFor(
  inputCounts: Counts,
  resultCounts: Counts,
  generatedFaceSourceEdge: number,
): EvolutionRecord[] {
  const records: EvolutionRecord[] = [];
  for (const kind of [KIND.FACE, KIND.EDGE, KIND.VERTEX]) {
    const inputCount = countForKind(inputCounts, kind);
    const resultCount = countForKind(resultCounts, kind);
    const residualIndex = inputCount > 2 && resultCount > 2 ? 2 : -1;

    for (let sourceIndex = 0; sourceIndex < inputCount; sourceIndex += 1) {
      if (sourceIndex === residualIndex || sourceIndex >= resultCount) {
        records.push(deleted(kind, sourceIndex));
      } else {
        records.push(
          identity(
            kind,
            sourceIndex,
            sourceIndex === 0 ? RELATION.MODIFIED : RELATION.PRESERVED,
          ),
        );
      }
    }

    for (let resultIndex = 0; resultIndex < resultCount; resultIndex += 1) {
      if (resultIndex === residualIndex || resultIndex >= inputCount) {
        records.push(
          kind === KIND.FACE && resultIndex === residualIndex
            ? {
                sourceShapeIndex: 0,
                sourceKind: KIND.EDGE,
                sourceIndex: generatedFaceSourceEdge,
                relation: RELATION.GENERATED,
                resultKind: KIND.FACE,
                resultIndex,
              }
            : created(kind, resultIndex),
        );
      }
    }
  }
  return records;
}

function selectedInputEdgeIndices(
  raw: RawKernel,
  inputId: number,
  selectedIds: readonly number[],
): number[] {
  const occurrences = raw.getSubShapes(inputId, "edge");
  const occurrenceIds = vectorValues(occurrences);
  try {
    return selectedIds.map((selectedId) => {
      const index = occurrenceIds.findIndex((occurrenceId) =>
        raw.isSame(selectedId, occurrenceId),
      );
      if (index < 0) throw new Error("Selected edge was not in the input");
      return index;
    });
  } finally {
    for (const occurrenceId of occurrenceIds) raw.release(occurrenceId);
    occurrences.delete();
  }
}

function installReleaseCounter(
  raw: RawKernel,
  state: EdgeTreatmentFacadeState,
  resultId: number,
): void {
  const originalRelease = raw.release.bind(raw);
  raw.release = (id: number): void => {
    if (id === resultId) {
      state.resultReleaseCalls.set(
        resultId,
        (state.resultReleaseCalls.get(resultId) ?? 0) + 1,
      );
    }
    originalRelease(id);
  };
}

function exactEdgeTreatmentFactory(
  options: EdgeTreatmentFacadeOptions = {},
): {
  readonly factory: OcctModuleFactory;
  readonly state: EdgeTreatmentFacadeState;
} {
  const state: EdgeTreatmentFacadeState = {
    invocations: [],
    takeResultCalls: [],
    reportOwnedReleases: [],
    resultReleaseCalls: new Map(),
  };
  const factory: OcctModuleFactory = async (moduleOptions) => {
    const module = (await createStockOcctModule(moduleOptions)) as Record<
      string,
      unknown
    >;
    Object.assign(module, {
      InvariantCadDraftReport: class {},
      InvariantCadPipeShellReport: class {},
      InvariantCadBooleanReport: class {},
      InvariantCadEdgeTreatmentReport: class {},
      InvariantCadTopologyKind: KIND,
      InvariantCadTopologyRelation: RELATION,
      InvariantCadBooleanOperation: BOOLEAN_OPERATION,
      InvariantCadEdgeTreatmentOperation: EDGE_TREATMENT_OPERATION,
      invariantcadFacadeVersion: () =>
        "invariantcad-facade@0.5.0+occt-wasm.3.8.0",
      invariantcadDraftFacesAtomic: () => {
        throw new Error("draft was not expected in this test");
      },
      invariantcadPipeShellSolid: () => {
        throw new Error("PipeShell was not expected in this test");
      },
      invariantcadBooleanAtomic: () => {
        throw new Error("Boolean was not expected in this test");
      },
      invariantcadEdgeTreatmentAtomic: (
        rawValue: unknown,
        operation: number,
        inputId: number,
        edgeVectorValue: unknown,
        amount: number,
        maxHistoryRecords: number,
      ) => {
        const raw = rawValue as RawKernel;
        const edgeIds = vectorValues(edgeVectorValue as RawVector);
        const selectedEdgeIndices = selectedInputEdgeIndices(
          raw,
          inputId,
          edgeIds,
        );
        state.raw = raw;

        const inputCounts = topologyCounts(raw, inputId);
        inputCounts.faces += options.inputFaceDelta ?? 0;
        state.beforeResultCount = raw.getShapeCount();
        const resultId = raw.copy(inputId);
        state.lastResultId = resultId;
        installReleaseCounter(raw, state, resultId);
        const resultCounts = topologyCounts(raw, resultId);
        resultCounts.faces += options.resultFaceDelta ?? 0;
        const records = recordsFor(
          inputCounts,
          resultCounts,
          selectedEdgeIndices[0]!,
        );
        if (options.malformedRelation) records[0]!.relation = RELATION.CREATED;

        state.invocations.push({
          operation,
          inputId,
          edgeIds,
          selectedEdgeIndices,
          amount,
          maxHistoryRecords,
          resultId,
        });
        let transferred = false;
        let reportDeleted = false;
        return {
          ok: true,
          stage: "complete",
          code: "OK",
          message: "Edge treatment and exact indexed history are ready",
          operation,
          amount,
          requestedSeedCount: edgeIds.length,
          addCount: edgeIds.length,
          skippedSeedCount: 0,
          contourCount: edgeIds.length,
          buildCount: 1,
          failedSeedIndex: -1,
          historyProblemDomain: "none",
          historyProblemSourceShapeIndex: -1,
          historyProblemKind: KIND.NONE,
          historyProblemIndex: -1,
          selectedEdgeCount: () => selectedEdgeIndices.length,
          selectedEdgeIndex: (index: number) => selectedEdgeIndices[index],
          hasResult: () => !transferred && !reportDeleted,
          transferCode: (kernel: unknown) =>
            options.transferCode ?? (kernel === raw ? "READY" : "WRONG_KERNEL"),
          takeResultId: (kernel: unknown) => {
            if (kernel !== raw || transferred || reportDeleted) {
              throw new Error("invalid one-shot edge-treatment transfer");
            }
            state.takeResultCalls.push(resultId);
            transferred = true;
            if (options.failResultTopology) {
              const originalGetSubShapes = raw.getSubShapes.bind(raw);
              raw.getSubShapes = (id: number, topology: string): RawVector => {
                if (id === resultId) {
                  throw new Error("forced result topology failure");
                }
                return originalGetSubShapes(id, topology);
              };
            }
            options.abortOnTake?.abort();
            return resultId;
          },
          topologyHistoryVersion: () => 1,
          topologyHistoryComplete: () => true,
          topologyInputShapeCount: () => 1,
          topologyInputCounts: () => inputCounts,
          topologyResultCounts: () => resultCounts,
          topologyRecordCount: () => records.length,
          topologyRecord: (index: number) => records[index],
          delete: () => {
            if (reportDeleted) return;
            reportDeleted = true;
            if (!transferred) {
              state.reportOwnedReleases.push(resultId);
              raw.release(resultId);
            }
          },
        };
      },
    });
    return module;
  };
  return { factory, state };
}

describe("OCCT ABI 0.5 exact fillet/chamfer integration", () => {
  it.each([-1, 0.5, 2_147_483_648, Number.NaN])(
    "rejects invalid history record budget %s before loading the module",
    async (maxExactEdgeTreatmentHistoryRecords) => {
      const moduleFactory = vi.fn();

      await expect(
        createOcctKernel({
          moduleFactory,
          maxExactEdgeTreatmentHistoryRecords,
        }),
      ).rejects.toThrow(
        "maxExactEdgeTreatmentHistoryRecords must be a signed 32-bit non-negative integer",
      );
      expect(moduleFactory).not.toHaveBeenCalled();
    },
  );

  it("advertises exact draft, Boolean, fillet, and chamfer evolution for ABI 0.5", async () => {
    const fixture = exactEdgeTreatmentFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      expect(kernel.capabilities.exactIndexedTopologyEvolution).toEqual({
        protocolVersion: 1,
        features: ["draft", "boolean", "fillet", "chamfer"],
      });
      for (const feature of ["draft", "boolean", "fillet", "chamfer"] as const) {
        expect(
          kernelSupports(
            kernel.capabilities,
            "exactIndexedTopologyEvolution",
            feature,
          ),
        ).toBe(true);
      }
      expect(kernel.capabilities.topology?.provenance).toBe("feature");
      expect(kernel.capabilities.topology?.signatures).toEqual({
        protocolVersion: 2,
        fingerprint:
          "invariantcad-topology-descriptor@6;occt-wasm@3.8.0;" +
          "runtime=invariantcad-facade@0.5.0+occt-wasm.3.8.0;" +
          "modelingTolerance=1e-7",
      });
      expect(kernel.capabilities.topology?.signatureProfiles).toEqual([
        {
          protocolVersion: 1,
          fingerprint:
            "invariantcad-topology-descriptor@5;occt-wasm@3.8.0;" +
            "runtime=invariantcad-facade@0.5.0+occt-wasm.3.8.0;" +
            "modelingTolerance=1e-7",
        },
      ]);
    } finally {
      kernel.dispose();
    }
  });

  it("routes exact fillet and chamfer opcodes with sorted, deduplicated seeds", async () => {
    const fixture = exactEdgeTreatmentFactory();
    const kernel = await createOcctKernel({
      moduleFactory: fixture.factory,
      maxExactEdgeTreatmentHistoryRecords: 12_345,
    });
    try {
      const input = kernel.box!([10, 20, 30], false);
      const edges = kernel.topology!(input).edges;
      const selectedKeys = [
        edges[5]!.key,
        edges[1]!.key,
        edges[5]!.key,
        edges[3]!.key,
        edges[1]!.key,
      ];
      const rounded = kernel.fillet!(input, selectedKeys, { radius: 1.25 });
      const beveled = kernel.chamfer!(input, selectedKeys, { distance: 2.5 });

      expect(fixture.state.invocations).toHaveLength(2);
      expect(fixture.state.invocations.map((item) => item.operation)).toEqual([
        EDGE_TREATMENT_OPERATION.FILLET,
        EDGE_TREATMENT_OPERATION.CHAMFER,
      ]);
      expect(fixture.state.invocations.map((item) => item.amount)).toEqual([
        1.25,
        2.5,
      ]);
      for (const invocation of fixture.state.invocations) {
        expect(invocation.inputId).toBe(fixture.state.invocations[0]!.inputId);
        expect(invocation.edgeIds).toHaveLength(3);
        expect(invocation.selectedEdgeIndices).toEqual([1, 3, 5]);
        expect(invocation.maxHistoryRecords).toBe(12_345);
      }
      expect(fixture.state.takeResultCalls).toHaveLength(2);

      kernel.disposeShape(beveled);
      kernel.disposeShape(rounded);
      kernel.disposeShape(input);
    } finally {
      kernel.dispose();
    }
  });

  it("uses the documented default exact edge-treatment history budget", async () => {
    const fixture = exactEdgeTreatmentFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const input = kernel.box!([10, 20, 30], false);
      const edge = kernel.topology!(input).edges[0]!;
      const result = kernel.fillet!(input, [edge.key], { radius: 1 });

      expect(fixture.state.invocations[0]!.maxHistoryRecords).toBe(
        DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT,
      );

      kernel.disposeShape(result);
      kernel.disposeShape(input);
    } finally {
      kernel.dispose();
    }
  });

  it.each([
    ["fillet", "fillet.face.blend"],
    ["chamfer", "chamfer.face.bevel"],
  ] as const)(
    "reduces exact %s GENERATED faces into their semantic role while residual CREATED topology stays unnamed",
    async (operation, role) => {
      const fixture = exactEdgeTreatmentFactory();
      const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
      try {
        const input = kernel.box!([10, 20, 30], false, {
          feature: "source-box",
        });
        const edge = kernel.topology!(input).edges[0]!;
        const feature = `exact-${operation}`;
        const result =
          operation === "fillet"
            ? kernel.fillet!(
                input,
                [edge.key],
                { radius: 1 },
                { feature },
              )
            : kernel.chamfer!(
                input,
                [edge.key],
                { distance: 1 },
                { feature },
              );
        const topology = kernel.topology!(result);

        expect(topology.history).toBe("complete");
        expect(topology.faces[0]!.lineage).toContainEqual({
          feature: "source-box",
          relation: "created",
          role: "box.face.x-min",
        });
        expect(topology.faces[0]!.lineage).toContainEqual({
          feature,
          relation: "modified",
        });
        expect(topology.faces[2]!.lineage).toEqual([
          { feature, relation: "created", role },
        ]);
        expect(topology.edges[2]!.lineage).toEqual([
          { feature, relation: "created" },
        ]);

        kernel.disposeShape(result);
        kernel.disposeShape(input);
      } finally {
        kernel.dispose();
      }
    },
  );

  it("rejects exact input count drift before transfer and returns report ownership", async () => {
    const fixture = exactEdgeTreatmentFactory({ inputFaceDelta: 1 });
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const input = kernel.box!([10, 20, 30], false);
      const edge = kernel.topology!(input).edges[0]!;
      expect(() => kernel.fillet!(input, [edge.key], { radius: 1 })).toThrow(
        "fillet inputCounts[0].faces",
      );
      expect(fixture.state.takeResultCalls).toHaveLength(0);
      expect(fixture.state.reportOwnedReleases).toEqual([
        fixture.state.lastResultId,
      ]);
      expect(
        fixture.state.resultReleaseCalls.get(fixture.state.lastResultId!),
      ).toBe(1);
      expect(fixture.state.raw!.getShapeCount()).toBe(
        fixture.state.beforeResultCount,
      );

      kernel.disposeShape(input);
    } finally {
      kernel.dispose();
    }
  });

  it("rolls back provisional topology and root on exact result count drift", async () => {
    const fixture = exactEdgeTreatmentFactory({ resultFaceDelta: 1 });
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const input = kernel.box!([10, 20, 30], false);
      const edge = kernel.topology!(input).edges[0]!;
      expect(() =>
        kernel.chamfer!(input, [edge.key], { distance: 1 }),
      ).toThrow("chamfer resultCounts.faces");
      expect(fixture.state.takeResultCalls).toEqual([
        fixture.state.lastResultId,
      ]);
      expect(fixture.state.reportOwnedReleases).toHaveLength(0);
      expect(
        fixture.state.resultReleaseCalls.get(fixture.state.lastResultId!),
      ).toBe(1);
      expect(fixture.state.raw!.getShapeCount()).toBe(
        fixture.state.beforeResultCount,
      );

      kernel.disposeShape(input);
    } finally {
      kernel.dispose();
    }
  });

  it("maps malformed reports to the topology protocol boundary without leaks", async () => {
    for (const options of [
      { transferCode: "WRONG_KERNEL" },
      { malformedRelation: true },
    ] as const) {
      const fixture = exactEdgeTreatmentFactory(options);
      const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
      try {
        const input = kernel.box!([10, 20, 30], false);
        const edge = kernel.topology!(input).edges[0]!;
        expect(() =>
          kernel.fillet!(input, [edge.key], { radius: 1 }),
        ).toThrow(TopologyEvolutionProtocolError);
        expect(fixture.state.takeResultCalls).toHaveLength(0);
        expect(fixture.state.reportOwnedReleases).toEqual([
          fixture.state.lastResultId,
        ]);
        expect(
          fixture.state.resultReleaseCalls.get(fixture.state.lastResultId!),
        ).toBe(1);
        expect(fixture.state.raw!.getShapeCount()).toBe(
          fixture.state.beforeResultCount,
        );
        kernel.disposeShape(input);
      } finally {
        kernel.dispose();
      }
    }
  });

  it("releases transferred roots exactly once on topology and reducer failures", async () => {
    const topologyFailure = exactEdgeTreatmentFactory({
      failResultTopology: true,
    });
    const firstKernel = await createOcctKernel({
      moduleFactory: topologyFailure.factory,
    });
    try {
      const input = firstKernel.box!([10, 20, 30], false);
      const edge = firstKernel.topology!(input).edges[0]!;
      expect(() =>
        firstKernel.fillet!(input, [edge.key], { radius: 1 }),
      ).toThrow("forced result topology failure");
      expect(
        topologyFailure.state.resultReleaseCalls.get(
          topologyFailure.state.lastResultId!,
        ),
      ).toBe(1);
      expect(topologyFailure.state.raw!.getShapeCount()).toBe(
        topologyFailure.state.beforeResultCount,
      );
      firstKernel.disposeShape(input);
    } finally {
      firstKernel.dispose();
    }

    const reducerFailure = exactEdgeTreatmentFactory();
    const secondKernel = await createOcctKernel({
      moduleFactory: reducerFailure.factory,
    });
    try {
      const input = secondKernel.box!([10, 20, 30], false);
      const edge = secondKernel.topology!(input).edges[0]!;
      expect(() =>
        secondKernel.chamfer!(
          input,
          [edge.key],
          { distance: 1 },
          { feature: "" },
        ),
      ).toThrow("feature must be a non-empty string");
      expect(
        reducerFailure.state.resultReleaseCalls.get(
          reducerFailure.state.lastResultId!,
        ),
      ).toBe(1);
      expect(reducerFailure.state.raw!.getShapeCount()).toBe(
        reducerFailure.state.beforeResultCount,
      );
      secondKernel.disposeShape(input);
    } finally {
      secondKernel.dispose();
    }
  });

  it("honors cancellation before native invocation and after transfer", async () => {
    const preFixture = exactEdgeTreatmentFactory();
    const preKernel = await createOcctKernel({ moduleFactory: preFixture.factory });
    try {
      const input = preKernel.box!([10, 20, 30], false);
      const edge = preKernel.topology!(input).edges[0]!;
      const abort = new AbortController();
      abort.abort();
      expect(() =>
        preKernel.fillet!(
          input,
          [edge.key],
          { radius: 1 },
          { signal: abort.signal },
        ),
      ).toThrow("aborted");
      expect(preFixture.state.invocations).toHaveLength(0);
      preKernel.disposeShape(input);
    } finally {
      preKernel.dispose();
    }

    const abort = new AbortController();
    const postFixture = exactEdgeTreatmentFactory({ abortOnTake: abort });
    const postKernel = await createOcctKernel({
      moduleFactory: postFixture.factory,
    });
    try {
      const input = postKernel.box!([10, 20, 30], false);
      const edge = postKernel.topology!(input).edges[0]!;
      expect(() =>
        postKernel.chamfer!(
          input,
          [edge.key],
          { distance: 1 },
          { signal: abort.signal },
        ),
      ).toThrow("aborted");
      expect(postFixture.state.takeResultCalls).toHaveLength(1);
      expect(
        postFixture.state.resultReleaseCalls.get(postFixture.state.lastResultId!),
      ).toBe(1);
      expect(postFixture.state.raw!.getShapeCount()).toBe(
        postFixture.state.beforeResultCount,
      );
      postKernel.disposeShape(input);
    } finally {
      postKernel.dispose();
    }
  });

  it("keeps stock fillet and chamfer fallback history partial", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(kernel.capabilities.topology?.signatures).toEqual({
        protocolVersion: 2,
        fingerprint:
          "invariantcad-topology-descriptor@6;occt-wasm@3.8.0;" +
          "runtime=stock;modelingTolerance=1e-7",
      });
      expect(kernel.capabilities.topology?.signatureProfiles).toEqual([
        {
          protocolVersion: 1,
          fingerprint:
            "invariantcad-topology-descriptor@4;occt-wasm@3.8.0;" +
            "runtime=stock;modelingTolerance=1e-7",
        },
      ]);
      for (const feature of ["fillet", "chamfer"] as const) {
        expect(
          kernelSupports(
            kernel.capabilities,
            "exactIndexedTopologyEvolution",
            feature,
          ),
        ).toBe(false);
      }
      const input = kernel.box!([10, 20, 30], false, { feature: "source" });
      const edges = kernel.topology!(input).edges;
      const rounded = kernel.fillet!(
        input,
        [edges[0]!.key],
        { radius: 1 },
        { feature: "stock-fillet" },
      );
      const beveled = kernel.chamfer!(
        input,
        [edges[1]!.key],
        { distance: 1 },
        { feature: "stock-chamfer" },
      );
      for (const [result, feature] of [
        [rounded, "stock-fillet"],
        [beveled, "stock-chamfer"],
      ] as const) {
        const topology = kernel.topology!(result);
        expect(topology.history).toBe("partial");
        expect(topology.faces[0]!.lineage).toContainEqual({
          feature,
          relation: "modified",
        });
      }

      kernel.disposeShape(beveled);
      kernel.disposeShape(rounded);
      kernel.disposeShape(input);
    } finally {
      kernel.dispose();
    }
  });
});
