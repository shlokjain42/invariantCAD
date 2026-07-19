import { describe, expect, it, vi } from "vitest";
import createStockOcctModule from "occt-wasm/dist/occt-wasm.js";
import { kernelSupports } from "../src/kernel.js";
import {
  DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT,
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

interface BooleanInvocation {
  readonly operation: number;
  readonly targetId: number;
  readonly toolIds: readonly number[];
  readonly maxHistoryRecords: number;
  readonly resultId: number;
}

interface BooleanFacadeState {
  raw?: RawKernel;
  readonly invocations: BooleanInvocation[];
  readonly takeResultCalls: number[];
  readonly reportOwnedReleases: number[];
  readonly resultReleaseCalls: Map<number, number>;
  beforeResultCount?: number;
  lastResultId?: number;
}

interface BooleanFacadeOptions {
  readonly inputFaceDelta?: {
    readonly sourceShapeIndex: number;
    readonly delta: number;
  };
  readonly resultFaceDelta?: number;
  readonly transferCode?: string;
  readonly malformedRelation?: boolean;
  readonly createdOnly?: boolean;
  readonly abortOnInvoke?: AbortController;
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

function modified(
  sourceShapeIndex: number,
  kind: number,
  sourceIndex: number,
  resultIndex: number,
): EvolutionRecord {
  return {
    sourceShapeIndex,
    sourceKind: kind,
    sourceIndex,
    relation: RELATION.MODIFIED,
    resultKind: kind,
    resultIndex,
  };
}

function generated(
  sourceShapeIndex: number,
  kind: number,
  sourceIndex: number,
  resultIndex: number,
): EvolutionRecord {
  return {
    sourceShapeIndex,
    sourceKind: kind,
    sourceIndex,
    relation: RELATION.GENERATED,
    resultKind: kind,
    resultIndex,
  };
}

function deleted(
  sourceShapeIndex: number,
  kind: number,
  sourceIndex: number,
): EvolutionRecord {
  return {
    sourceShapeIndex,
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

function createdOnlyRecords(
  inputCounts: readonly Counts[],
  resultCounts: Counts,
): EvolutionRecord[] {
  const records: EvolutionRecord[] = [];
  for (const kind of [KIND.FACE, KIND.EDGE, KIND.VERTEX]) {
    inputCounts.forEach((counts, sourceShapeIndex) => {
      for (let index = 0; index < countForKind(counts, kind); index += 1) {
        records.push(deleted(sourceShapeIndex, kind, index));
      }
    });
    for (
      let resultIndex = 0;
      resultIndex < countForKind(resultCounts, kind);
      resultIndex += 1
    ) {
      records.push(created(kind, resultIndex));
    }
  }
  return records;
}

/**
 * Produces a complete graph for a copied target while deliberately assigning:
 * face 0 to the target, face 1 to the first tool, and face 2 to generation.
 */
function recordsFor(
  inputCounts: readonly Counts[],
  resultCounts: Counts,
): EvolutionRecord[] {
  const records: EvolutionRecord[] = [];
  for (const kind of [KIND.FACE, KIND.EDGE, KIND.VERTEX]) {
    const resultCount = countForKind(resultCounts, kind);
    const targetCount = countForKind(inputCounts[0]!, kind);
    const specialFaces = kind === KIND.FACE && resultCount >= 3;

    for (let index = 0; index < targetCount; index += 1) {
      if (specialFaces && index === 1) {
        records.push(deleted(0, kind, index));
      } else if (specialFaces && index === 2) {
        records.push(
          generated(0, kind, index, 2),
          deleted(0, kind, index),
        );
      } else if (index < resultCount) {
        records.push(modified(0, kind, index, index));
      } else {
        records.push(deleted(0, kind, index));
      }
    }

    for (let sourceShapeIndex = 1; sourceShapeIndex < inputCounts.length; sourceShapeIndex += 1) {
      const sourceCount = countForKind(inputCounts[sourceShapeIndex]!, kind);
      for (let index = 0; index < sourceCount; index += 1) {
        if (specialFaces && sourceShapeIndex === 1 && index === 1) {
          records.push(modified(sourceShapeIndex, kind, index, 1));
        } else {
          records.push(deleted(sourceShapeIndex, kind, index));
        }
      }
    }

    for (let resultIndex = targetCount; resultIndex < resultCount; resultIndex += 1) {
      records.push(generated(0, kind, 0, resultIndex));
    }
  }
  return records;
}

function installReleaseCounter(
  raw: RawKernel,
  state: BooleanFacadeState,
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

function exactBooleanFactory(
  options: BooleanFacadeOptions = {},
): { readonly factory: OcctModuleFactory; readonly state: BooleanFacadeState } {
  const state: BooleanFacadeState = {
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
      InvariantCadTopologyKind: KIND,
      InvariantCadTopologyRelation: RELATION,
      InvariantCadBooleanOperation: BOOLEAN_OPERATION,
      invariantcadFacadeVersion: () =>
        "invariantcad-facade@0.4.0+occt-wasm.3.7.0",
      invariantcadDraftFacesAtomic: () => {
        throw new Error("draft was not expected in this test");
      },
      invariantcadPipeShellSolid: () => {
        throw new Error("PipeShell was not expected in this test");
      },
      invariantcadBooleanAtomic: (
        rawValue: unknown,
        operation: number,
        targetId: number,
        toolVectorValue: unknown,
        maxHistoryRecords: number,
      ) => {
        const raw = rawValue as RawKernel;
        const toolIds = vectorValues(toolVectorValue as RawVector);
        state.raw = raw;
        options.abortOnInvoke?.abort();

        const inputIds = [targetId, ...toolIds];
        const inputCounts = inputIds.map((id) => topologyCounts(raw, id));
        if (options.inputFaceDelta !== undefined) {
          const target = inputCounts[options.inputFaceDelta.sourceShapeIndex]!;
          target.faces += options.inputFaceDelta.delta;
        }
        state.beforeResultCount = raw.getShapeCount();
        const resultId = raw.copy(targetId);
        state.lastResultId = resultId;
        installReleaseCounter(raw, state, resultId);
        const resultCounts = topologyCounts(raw, resultId);
        resultCounts.faces += options.resultFaceDelta ?? 0;
        const records = options.createdOnly
          ? createdOnlyRecords(inputCounts, resultCounts)
          : recordsFor(inputCounts, resultCounts);
        if (options.malformedRelation) records[0]!.relation = RELATION.CREATED;

        state.invocations.push({
          operation,
          targetId,
          toolIds,
          maxHistoryRecords,
          resultId,
        });
        let transferred = false;
        let reportDeleted = false;
        const expectedBuildCount = operation === BOOLEAN_OPERATION.SUBTRACT
          ? 1
          : toolIds.length;
        return {
          ok: true,
          stage: "complete",
          code: "OK",
          message: "Boolean result and exact indexed history are ready",
          operation,
          requestedToolCount: toolIds.length,
          buildCount: expectedBuildCount,
          failedToolIndex: -1,
          historyProblemDomain: "none",
          historyProblemSourceShapeIndex: -1,
          historyProblemKind: KIND.NONE,
          historyProblemIndex: -1,
          hasResult: () => !transferred && !reportDeleted,
          transferCode: (kernel: unknown) =>
            options.transferCode ?? (kernel === raw ? "READY" : "WRONG_KERNEL"),
          takeResultId: (kernel: unknown) => {
            if (kernel !== raw || transferred || reportDeleted) {
              throw new Error("invalid one-shot Boolean transfer");
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
          topologyInputShapeCount: () => inputCounts.length,
          topologyInputCounts: (index: number) => inputCounts[index],
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

function legacyFactory(
  abi: "stock" | "0.2" | "0.3",
): OcctModuleFactory {
  return async (moduleOptions) => {
    const module = (await createStockOcctModule(moduleOptions)) as Record<
      string,
      unknown
    >;
    if (abi === "stock") return module;
    Object.assign(module, {
      InvariantCadDraftReport: class {},
      InvariantCadTopologyKind: KIND,
      InvariantCadTopologyRelation: RELATION,
      invariantcadFacadeVersion: () =>
        `invariantcad-facade@${abi}.0+occt-wasm.3.7.0`,
      invariantcadDraftFacesAtomic: () => {
        throw new Error("draft was not expected in this test");
      },
    });
    if (abi === "0.3") {
      Object.assign(module, {
        InvariantCadPipeShellReport: class {},
        invariantcadPipeShellSolid: () => {
          throw new Error("PipeShell was not expected in this test");
        },
      });
    }
    return module;
  };
}

describe("OCCT ABI 0.4 exact Boolean integration", () => {
  it.each([-1, 0.5, 2_147_483_648, Number.NaN])(
    "rejects invalid history record budget %s before loading the module",
    async (maxExactBooleanHistoryRecords) => {
      const moduleFactory = vi.fn();

      await expect(
        createOcctKernel({
          moduleFactory,
          maxExactBooleanHistoryRecords,
        }),
      ).rejects.toThrow(
        "maxExactBooleanHistoryRecords must be a signed 32-bit non-negative integer",
      );
      expect(moduleFactory).not.toHaveBeenCalled();
    },
  );

  it("advertises draft and Boolean exact evolution only for ABI 0.4", async () => {
    const fixture = exactBooleanFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      expect(kernel.draft).toBeTypeOf("function");
      expect(kernel.capabilities.exactIndexedTopologyEvolution).toEqual({
        protocolVersion: 1,
        features: ["draft", "boolean"],
      });
      expect(
        kernelSupports(
          kernel.capabilities,
          "exactIndexedTopologyEvolution",
          "draft",
        ),
      ).toBe(true);
      expect(
        kernelSupports(
          kernel.capabilities,
          "exactIndexedTopologyEvolution",
          "boolean",
        ),
      ).toBe(true);
      expect(kernel.capabilities.topology?.provenance).toBe("feature");
    } finally {
      kernel.dispose();
    }
  });

  it("routes every operation through one atomic call with authored tool order", async () => {
    const fixture = exactBooleanFactory();
    const kernel = await createOcctKernel({
      moduleFactory: fixture.factory,
      maxExactBooleanHistoryRecords: 12_345,
    });
    try {
      const target = kernel.box!([10, 10, 10], false, { feature: "target" });
      const firstTool = kernel.box!([4, 4, 4], false, { feature: "first-tool" });
      const secondTool = kernel.box!([6, 6, 6], false, { feature: "second-tool" });
      const first = kernel.boolean!("union", target, [firstTool, secondTool], {
        feature: "union-result",
      });
      const second = kernel.boolean!("subtract", target, [secondTool, firstTool], {
        feature: "subtract-result",
      });
      const third = kernel.boolean!("intersect", target, [firstTool, secondTool], {
        feature: "intersect-result",
      });

      expect(fixture.state.invocations).toHaveLength(3);
      expect(fixture.state.invocations.map((item) => item.operation)).toEqual([
        BOOLEAN_OPERATION.UNION,
        BOOLEAN_OPERATION.SUBTRACT,
        BOOLEAN_OPERATION.INTERSECT,
      ]);
      const [union, subtract, intersect] = fixture.state.invocations;
      expect(union!.targetId).toBe(subtract!.targetId);
      expect(subtract!.targetId).toBe(intersect!.targetId);
      expect(union!.toolIds).toEqual(intersect!.toolIds);
      expect(subtract!.toolIds).toEqual([...union!.toolIds].reverse());
      expect(
        fixture.state.invocations.map((item) => item.maxHistoryRecords),
      ).toEqual([12_345, 12_345, 12_345]);
      expect(fixture.state.takeResultCalls).toHaveLength(3);

      kernel.disposeShape(third);
      kernel.disposeShape(second);
      kernel.disposeShape(first);
      kernel.disposeShape(secondTool);
      kernel.disposeShape(firstTool);
      kernel.disposeShape(target);
    } finally {
      kernel.dispose();
    }
  });

  it("uses the documented default native history record budget", async () => {
    const fixture = exactBooleanFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const target = kernel.box!([10, 10, 10], false);
      const tool = kernel.box!([4, 4, 4], false);
      const result = kernel.boolean!("union", target, [tool]);

      expect(fixture.state.invocations).toHaveLength(1);
      expect(fixture.state.invocations[0]!.maxHistoryRecords).toBe(
        DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT,
      );

      kernel.disposeShape(result);
      kernel.disposeShape(tool);
      kernel.disposeShape(target);
    } finally {
      kernel.dispose();
    }
  });

  it("reduces target, tool, generated, and deleted records into complete lineage", async () => {
    const fixture = exactBooleanFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const target = kernel.box!([10, 10, 10], false, { feature: "target-box" });
      const tool = kernel.box!([8, 8, 8], false, { feature: "tool-box" });
      const result = kernel.boolean!("subtract", target, [tool], {
        feature: "boolean-result",
      });
      const topology = kernel.topology!(result);

      expect(topology.history).toBe("complete");
      expect(topology.faces[0]!.lineage).toContainEqual({
        feature: "target-box",
        relation: "created",
        role: "box.face.x-min",
      });
      expect(topology.faces[0]!.lineage).toContainEqual({
        feature: "boolean-result",
        relation: "modified",
      });
      expect(topology.faces[1]!.lineage).toContainEqual(
        expect.objectContaining({
          feature: "tool-box",
          relation: "created",
        }),
      );
      expect(topology.faces[1]!.lineage).toContainEqual({
        feature: "boolean-result",
        relation: "modified",
      });
      expect(topology.faces[2]!.lineage).toEqual([
        { feature: "boolean-result", relation: "created" },
      ]);
      expect(
        topology.faces.flatMap((face) => face.lineage).some(
          (lineage) => lineage.feature === "untrusted-output",
        ),
      ).toBe(false);

      kernel.disposeShape(result);
      kernel.disposeShape(tool);
      kernel.disposeShape(target);
    } finally {
      kernel.dispose();
    }
  });

  it("reduces source-less CREATED results without inheriting operand identity", async () => {
    const fixture = exactBooleanFactory({ createdOnly: true });
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const target = kernel.box!([10, 10, 10], false, {
        feature: "created-target",
      });
      const tool = kernel.box!([8, 8, 8], false, {
        feature: "created-tool",
      });
      const result = kernel.boolean!("union", target, [tool], {
        feature: "created-boolean",
      });
      const topology = kernel.topology!(result);

      expect(topology.history).toBe("complete");
      for (const descriptor of [...topology.faces, ...topology.edges]) {
        expect(descriptor.lineage).toEqual([
          { feature: "created-boolean", relation: "created" },
        ]);
      }

      kernel.disposeShape(result);
      kernel.disposeShape(tool);
      kernel.disposeShape(target);
    } finally {
      kernel.dispose();
    }
  });

  it("keeps exact local Boolean evolution partial when an upstream snapshot is partial", async () => {
    const fixture = exactBooleanFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const box = kernel.box!([10, 10, 10], false, { feature: "box" });
      const rounded = kernel.fillet!(
        box,
        [kernel.topology!(box).edges[0]!.key],
        { radius: 1 },
        { feature: "rounded" },
      );
      expect(kernel.topology!(rounded).history).toBe("partial");
      const tool = kernel.box!([4, 4, 4], false, { feature: "tool" });
      const result = kernel.boolean!("union", rounded, [tool], {
        feature: "exact-local-boolean",
      });
      expect(kernel.topology!(result).history).toBe("partial");

      kernel.disposeShape(result);
      kernel.disposeShape(tool);
      kernel.disposeShape(rounded);
      kernel.disposeShape(box);
    } finally {
      kernel.dispose();
    }
  });

  it("rejects exact input count drift before transfer and returns report ownership", async () => {
    const fixture = exactBooleanFactory({
      inputFaceDelta: { sourceShapeIndex: 1, delta: 1 },
    });
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const target = kernel.box!([10, 10, 10], false);
      const tool = kernel.box!([8, 8, 8], false);
      expect(() => kernel.boolean!("union", target, [tool])).toThrow(
        "boolean inputCounts[1].faces",
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
      kernel.disposeShape(tool);
      kernel.disposeShape(target);
    } finally {
      kernel.dispose();
    }
  });

  it("rolls back provisional topology and root on exact result count drift", async () => {
    const fixture = exactBooleanFactory({ resultFaceDelta: 1 });
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const target = kernel.box!([10, 10, 10], false);
      const tool = kernel.box!([8, 8, 8], false);
      expect(() => kernel.boolean!("union", target, [tool])).toThrow(
        "boolean resultCounts.faces",
      );
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
      kernel.disposeShape(tool);
      kernel.disposeShape(target);
    } finally {
      kernel.dispose();
    }
  });

  it("maps malformed reports to the topology protocol boundary before transfer", async () => {
    const wrongTransfer = exactBooleanFactory({ transferCode: "WRONG_KERNEL" });
    const firstKernel = await createOcctKernel({
      moduleFactory: wrongTransfer.factory,
    });
    try {
      const target = firstKernel.box!([10, 10, 10], false);
      const tool = firstKernel.box!([8, 8, 8], false);
      expect(() => firstKernel.boolean!("union", target, [tool])).toThrow(
        TopologyEvolutionProtocolError,
      );
      expect(wrongTransfer.state.takeResultCalls).toHaveLength(0);
      expect(wrongTransfer.state.reportOwnedReleases).toHaveLength(1);
      firstKernel.disposeShape(tool);
      firstKernel.disposeShape(target);
    } finally {
      firstKernel.dispose();
    }

    const malformedEvolution = exactBooleanFactory({ malformedRelation: true });
    const secondKernel = await createOcctKernel({
      moduleFactory: malformedEvolution.factory,
    });
    try {
      const target = secondKernel.box!([10, 10, 10], false);
      const tool = secondKernel.box!([8, 8, 8], false);
      expect(() => secondKernel.boolean!("union", target, [tool])).toThrow(
        TopologyEvolutionProtocolError,
      );
      expect(malformedEvolution.state.takeResultCalls).toHaveLength(0);
      expect(malformedEvolution.state.reportOwnedReleases).toHaveLength(1);
      secondKernel.disposeShape(tool);
      secondKernel.disposeShape(target);
    } finally {
      secondKernel.dispose();
    }
  });

  it("releases transferred roots exactly once on topology and reducer failures", async () => {
    const topologyFailure = exactBooleanFactory({ failResultTopology: true });
    const firstKernel = await createOcctKernel({
      moduleFactory: topologyFailure.factory,
    });
    try {
      const target = firstKernel.box!([10, 10, 10], false);
      const tool = firstKernel.box!([8, 8, 8], false);
      expect(() => firstKernel.boolean!("union", target, [tool])).toThrow(
        "forced result topology failure",
      );
      expect(
        topologyFailure.state.resultReleaseCalls.get(
          topologyFailure.state.lastResultId!,
        ),
      ).toBe(1);
      expect(topologyFailure.state.raw!.getShapeCount()).toBe(
        topologyFailure.state.beforeResultCount,
      );
      firstKernel.disposeShape(tool);
      firstKernel.disposeShape(target);
    } finally {
      firstKernel.dispose();
    }

    const reducerFailure = exactBooleanFactory();
    const secondKernel = await createOcctKernel({
      moduleFactory: reducerFailure.factory,
    });
    try {
      const target = secondKernel.box!([10, 10, 10], false);
      const tool = secondKernel.box!([8, 8, 8], false);
      expect(() =>
        secondKernel.boolean!("union", target, [tool], { feature: "" }),
      ).toThrow("feature must be a non-empty string");
      expect(
        reducerFailure.state.resultReleaseCalls.get(
          reducerFailure.state.lastResultId!,
        ),
      ).toBe(1);
      expect(reducerFailure.state.raw!.getShapeCount()).toBe(
        reducerFailure.state.beforeResultCount,
      );
      secondKernel.disposeShape(tool);
      secondKernel.disposeShape(target);
    } finally {
      secondKernel.dispose();
    }
  });

  it("honors cancellation before native invocation and after one-shot transfer", async () => {
    const preFixture = exactBooleanFactory();
    const preKernel = await createOcctKernel({ moduleFactory: preFixture.factory });
    try {
      const target = preKernel.box!([10, 10, 10], false);
      const tool = preKernel.box!([8, 8, 8], false);
      const abort = new AbortController();
      abort.abort();
      expect(() =>
        preKernel.boolean!("union", target, [tool], { signal: abort.signal }),
      ).toThrow("aborted");
      expect(preFixture.state.invocations).toHaveLength(0);
      preKernel.disposeShape(tool);
      preKernel.disposeShape(target);
    } finally {
      preKernel.dispose();
    }

    const abort = new AbortController();
    const postFixture = exactBooleanFactory({ abortOnTake: abort });
    const postKernel = await createOcctKernel({ moduleFactory: postFixture.factory });
    try {
      const target = postKernel.box!([10, 10, 10], false);
      const tool = postKernel.box!([8, 8, 8], false);
      expect(() =>
        postKernel.boolean!("union", target, [tool], { signal: abort.signal }),
      ).toThrow("aborted");
      expect(postFixture.state.takeResultCalls).toHaveLength(1);
      expect(
        postFixture.state.resultReleaseCalls.get(postFixture.state.lastResultId!),
      ).toBe(1);
      expect(postFixture.state.raw!.getShapeCount()).toBe(
        postFixture.state.beforeResultCount,
      );
      postKernel.disposeShape(tool);
      postKernel.disposeShape(target);
    } finally {
      postKernel.dispose();
    }
  });

  it.each(["stock", "0.2", "0.3"] as const)(
    "keeps %s on raw fallback booleans with partial history",
    async (abi) => {
      const kernel = await createOcctKernel({ moduleFactory: legacyFactory(abi) });
      try {
        expect(
          kernelSupports(
            kernel.capabilities,
            "exactIndexedTopologyEvolution",
            "boolean",
          ),
        ).toBe(false);
        const target = kernel.box!([10, 10, 10], false, { feature: "target" });
        const tool = kernel.box!([8, 8, 8], false, { feature: "tool" });
        const result = kernel.boolean!("union", target, [tool], {
          feature: "fallback-boolean",
        });
        const topology = kernel.topology!(result);
        expect(topology.history).toBe("partial");
        expect(topology.faces[0]!.lineage).toContainEqual({
          feature: "fallback-boolean",
          relation: "modified",
        });
        kernel.disposeShape(result);
        kernel.disposeShape(tool);
        kernel.disposeShape(target);
      } finally {
        kernel.dispose();
      }
    },
  );
});
