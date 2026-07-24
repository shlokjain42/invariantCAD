import { describe, expect, it, vi } from "vitest";
import createStockOcctModule from "occt-wasm/dist/occt-wasm.js";
import { kernelSupports } from "../src/kernel.js";
import {
  DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT,
  createOcctKernel,
  type OcctModuleFactory,
} from "../src/occt-kernel.js";
import { TopologyEvolutionProtocolError } from "../src/internal/topology-evolution.js";

const KIND = Object.freeze({ NONE: -1, FACE: 0, EDGE: 1, VERTEX: 2 });
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
const EDGE_TREATMENT_OPERATION = Object.freeze({ FILLET: 0, CHAMFER: 1 });
const SOLID_OFFSET_OPERATION = Object.freeze({ SHELL: 0, OFFSET: 1 });
const SOLID_OFFSET_DIRECTION = Object.freeze({ INWARD: 0, OUTWARD: 1 });

interface RawVector {
  size(): number;
  get(index: number): number;
  delete(): void;
}

interface RawKernel {
  release(id: number): void;
  copy(id: number): number;
  shell(
    id: number,
    faces: RawVector,
    thickness: number,
    tolerance: number,
  ): number;
  offset(id: number, distance: number, tolerance: number): number;
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

interface Invocation {
  readonly operation: number;
  readonly inputId: number;
  readonly openingFaceIds: readonly number[];
  readonly selectedOpeningFaceIndices: readonly number[];
  readonly amount: number;
  readonly direction: number;
  readonly tolerance: number;
  readonly maxHistoryRecords: number;
  readonly resultId: number;
}

interface FacadeState {
  raw?: RawKernel;
  readonly invocations: Invocation[];
  readonly takeResultCalls: number[];
  readonly reportOwnedReleases: number[];
  readonly resultReleaseCalls: Map<number, number>;
  beforeResultCount?: number;
  lastResultId?: number;
}

interface FacadeOptions {
  readonly inputFaceDelta?: number;
  readonly resultFaceDelta?: number;
  readonly transferCode?: string;
  readonly malformedRelation?: boolean;
  readonly abortOnTake?: AbortController;
  readonly failResultTopology?: boolean;
  readonly copyResult?: boolean;
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

function completeReplacementRecords(
  inputCounts: Counts,
  resultCounts: Counts,
): EvolutionRecord[] {
  const records: EvolutionRecord[] = [];
  for (const kind of [KIND.FACE, KIND.EDGE, KIND.VERTEX]) {
    for (let index = 0; index < countForKind(inputCounts, kind); index += 1) {
      records.push({
        sourceShapeIndex: 0,
        sourceKind: kind,
        sourceIndex: index,
        relation: RELATION.DELETED,
        resultKind: KIND.NONE,
        resultIndex: -1,
      });
    }
    for (let index = 0; index < countForKind(resultCounts, kind); index += 1) {
      records.push({
        sourceShapeIndex: -1,
        sourceKind: KIND.NONE,
        sourceIndex: -1,
        relation: RELATION.CREATED,
        resultKind: kind,
        resultIndex: index,
      });
    }
  }
  return records;
}

function selectedFaceIndices(
  raw: RawKernel,
  inputId: number,
  selectedIds: readonly number[],
): number[] {
  const occurrences = raw.getSubShapes(inputId, "face");
  const occurrenceIds = vectorValues(occurrences);
  try {
    return selectedIds.map((selectedId) => {
      const index = occurrenceIds.findIndex((occurrenceId) =>
        raw.isSame(selectedId, occurrenceId),
      );
      if (index < 0) throw new Error("Selected face was not in the input");
      return index;
    });
  } finally {
    for (const occurrenceId of occurrenceIds) raw.release(occurrenceId);
    occurrences.delete();
  }
}

function installReleaseCounter(
  raw: RawKernel,
  state: FacadeState,
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

function installLegacyMarkers(module: Record<string, unknown>): void {
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
    invariantcadDraftFacesAtomic: vi.fn(),
    invariantcadPipeShellSolid: vi.fn(),
    invariantcadBooleanAtomic: vi.fn(),
    invariantcadEdgeTreatmentAtomic: vi.fn(),
  });
}

function exactSolidOffsetFactory(
  options: FacadeOptions = {},
): { readonly factory: OcctModuleFactory; readonly state: FacadeState } {
  const state: FacadeState = {
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
    installLegacyMarkers(module);
    Object.assign(module, {
      InvariantCadSolidOffsetOperation: SOLID_OFFSET_OPERATION,
      InvariantCadSolidOffsetDirection: SOLID_OFFSET_DIRECTION,
      InvariantCadSolidOffsetReport: class {},
      invariantcadFacadeVersion: () =>
        "invariantcad-facade@0.6.0+occt-wasm.3.8.0",
      invariantcadSolidOffsetAtomic: (
        rawValue: unknown,
        operation: number,
        inputId: number,
        openingVectorValue: unknown,
        amount: number,
        direction: number,
        tolerance: number,
        maxHistoryRecords: number,
      ) => {
        const raw = rawValue as RawKernel;
        const openingVector = openingVectorValue as RawVector;
        const openingFaceIds = vectorValues(openingVector);
        const selectedOpeningFaceIndices = selectedFaceIndices(
          raw,
          inputId,
          openingFaceIds,
        );
        state.raw = raw;
        const inputCounts = topologyCounts(raw, inputId);
        inputCounts.faces += options.inputFaceDelta ?? 0;
        state.beforeResultCount = raw.getShapeCount();
        const resultId = options.copyResult
          ? raw.copy(inputId)
          : operation === SOLID_OFFSET_OPERATION.SHELL
            ? raw.shell(
                inputId,
                openingVector,
                direction === SOLID_OFFSET_DIRECTION.INWARD ? amount : -amount,
                tolerance,
              )
            : raw.offset(
                inputId,
                direction === SOLID_OFFSET_DIRECTION.OUTWARD ? amount : -amount,
                tolerance,
              );
        state.lastResultId = resultId;
        installReleaseCounter(raw, state, resultId);
        const resultCounts = topologyCounts(raw, resultId);
        resultCounts.faces += options.resultFaceDelta ?? 0;
        const records = completeReplacementRecords(inputCounts, resultCounts);
        if (options.malformedRelation) {
          records[0]!.relation = RELATION.PRESERVED;
        }
        state.invocations.push({
          operation,
          inputId,
          openingFaceIds,
          selectedOpeningFaceIndices,
          amount,
          direction,
          tolerance,
          maxHistoryRecords,
          resultId,
        });
        let transferred = false;
        let reportDeleted = false;
        return {
          ok: true,
          stage: "complete",
          code: "OK",
          message: "Solid offset and exact indexed history are ready",
          operation,
          direction,
          amount,
          tolerance,
          requestedOpeningFaceCount: openingFaceIds.length,
          buildCount: 1,
          occtStatus: 0,
          failedOpeningFaceIndex: -1,
          historyProblemDomain: "none",
          historyProblemSourceShapeIndex: -1,
          historyProblemKind: KIND.NONE,
          historyProblemIndex: -1,
          selectedOpeningFaceCount: () => selectedOpeningFaceIndices.length,
          selectedOpeningFaceIndex: (index: number) =>
            selectedOpeningFaceIndices[index],
          hasResult: () => !transferred && !reportDeleted,
          transferCode: (kernel: unknown) =>
            options.transferCode ?? (kernel === raw ? "READY" : "WRONG_KERNEL"),
          takeResultId: (kernel: unknown) => {
            if (kernel !== raw || transferred || reportDeleted) {
              throw new Error("invalid one-shot solid-offset transfer");
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

const stockFactory: OcctModuleFactory = (options) =>
  createStockOcctModule(options);

const legacyFactory: OcctModuleFactory = async (options) => {
  const module = (await createStockOcctModule(options)) as Record<
    string,
    unknown
  >;
  installLegacyMarkers(module);
  return module;
};

describe("OCCT ABI 0.6 exact shell/offset integration", () => {
  it.each([-1, 0.5, 2_147_483_648, Number.NaN])(
    "rejects invalid history record budget %s before loading the module",
    async (maxExactSolidOffsetHistoryRecords) => {
      const moduleFactory = vi.fn();
      await expect(
        createOcctKernel({
          moduleFactory,
          maxExactSolidOffsetHistoryRecords,
        }),
      ).rejects.toThrow(
        "maxExactSolidOffsetHistoryRecords must be a signed 32-bit non-negative integer",
      );
      expect(moduleFactory).not.toHaveBeenCalled();
    },
  );

  it("advertises all six exact evolution features only for ABI 0.6", async () => {
    const exact = exactSolidOffsetFactory();
    const kernel = await createOcctKernel({ moduleFactory: exact.factory });
    try {
      expect(kernel.capabilities.exactIndexedTopologyEvolution).toEqual({
        protocolVersion: 1,
        features: [
          "draft",
          "boolean",
          "fillet",
          "chamfer",
          "shell",
          "offset",
        ],
      });
      for (const feature of ["shell", "offset"] as const) {
        expect(
          kernelSupports(
            kernel.capabilities,
            "exactIndexedTopologyEvolution",
            feature,
          ),
        ).toBe(true);
      }
    } finally {
      kernel.dispose();
    }

    const legacy = await createOcctKernel({ moduleFactory: legacyFactory });
    try {
      expect(legacy.capabilities.exactIndexedTopologyEvolution?.features).toEqual(
        ["draft", "boolean", "fillet", "chamfer"],
      );
    } finally {
      legacy.dispose();
    }
  });

  it("routes canonical shell openings and offset parameters with the configured budget", async () => {
    const fixture = exactSolidOffsetFactory();
    const kernel = await createOcctKernel({
      moduleFactory: fixture.factory,
      maxExactSolidOffsetHistoryRecords: 12_345,
    });
    try {
      const input = kernel.box!([20, 20, 10], false, { feature: "box" });
      const faces = kernel.topology!(input).faces;
      const shell = kernel.shell!(
        input,
        [faces[5]!.key, faces[1]!.key, faces[5]!.key, faces[1]!.key],
        { thickness: 1, direction: "inward", tolerance: 1e-6 },
        { feature: "exact-shell" },
      );
      const offset = kernel.offset!(
        input,
        { distance: 2, direction: "outward", tolerance: 1e-6 },
        { feature: "exact-offset" },
      );

      expect(fixture.state.invocations).toHaveLength(2);
      expect(fixture.state.invocations[0]).toMatchObject({
        operation: SOLID_OFFSET_OPERATION.SHELL,
        selectedOpeningFaceIndices: [1, 5],
        amount: 1,
        direction: SOLID_OFFSET_DIRECTION.INWARD,
        tolerance: 1e-6,
        maxHistoryRecords: 12_345,
      });
      expect(fixture.state.invocations[0]!.openingFaceIds).toHaveLength(2);
      expect(fixture.state.invocations[1]).toMatchObject({
        operation: SOLID_OFFSET_OPERATION.OFFSET,
        openingFaceIds: [],
        selectedOpeningFaceIndices: [],
        amount: 2,
        direction: SOLID_OFFSET_DIRECTION.OUTWARD,
        tolerance: 1e-6,
        maxHistoryRecords: 12_345,
      });
      expect(fixture.state.takeResultCalls).toHaveLength(2);
      expect(kernel.topology!(shell).history).toBe("complete");
      expect(kernel.topology!(offset).history).toBe("complete");
      expect(kernel.topology!(shell).faces[0]!.lineage).toEqual([
        { feature: "exact-shell", relation: "created" },
      ]);

      kernel.disposeShape(offset);
      kernel.disposeShape(shell);
      kernel.disposeShape(input);
    } finally {
      kernel.dispose();
    }
  });

  it("uses the documented default solid-offset history budget", async () => {
    const fixture = exactSolidOffsetFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const input = kernel.box!([20, 20, 10], false);
      const result = kernel.offset!(input, {
        distance: 1,
        direction: "outward",
        tolerance: 1e-6,
      });
      expect(fixture.state.invocations[0]!.maxHistoryRecords).toBe(
        DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT,
      );
      kernel.disposeShape(result);
      kernel.disposeShape(input);
    } finally {
      kernel.dispose();
    }
  });

  it("returns report ownership on input-count and protocol failures", async () => {
    for (const options of [
      { inputFaceDelta: 1 },
      { transferCode: "WRONG_KERNEL" },
      { malformedRelation: true },
    ] as const) {
      const fixture = exactSolidOffsetFactory(options);
      const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
      try {
        const input = kernel.box!([20, 20, 10], false);
        expect(() =>
          kernel.offset!(input, {
            distance: 1,
            direction: "outward",
            tolerance: 1e-6,
          }),
        ).toThrow(
          options.inputFaceDelta === 1
            ? "offset inputCounts[0].faces"
            : TopologyEvolutionProtocolError,
        );
        expect(fixture.state.takeResultCalls).toHaveLength(0);
        expect(fixture.state.reportOwnedReleases).toEqual([
          fixture.state.lastResultId,
        ]);
        expect(
          fixture.state.resultReleaseCalls.get(fixture.state.lastResultId!),
        ).toBe(1);
        // The count captured inside the facade includes offset()'s temporary
        // retained input-solid occurrence, which the public operation releases
        // while unwinding.
        expect(fixture.state.raw!.getShapeCount()).toBe(
          fixture.state.beforeResultCount! - 1,
        );
        kernel.disposeShape(input);
      } finally {
        kernel.dispose();
      }
    }
  });

  it("rolls back transferred results on count, topology, postcondition, and reducer failures", async () => {
    for (const [options, expected] of [
      [{ resultFaceDelta: 1 }, "offset resultCounts.faces"],
      [{ failResultTopology: true }, "forced result topology failure"],
      [{ copyResult: true }, "Outward offset did not increase solid volume"],
    ] as const) {
      const fixture = exactSolidOffsetFactory(options);
      const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
      try {
        const input = kernel.box!([20, 20, 10], false);
        expect(() =>
          kernel.offset!(input, {
            distance: 1,
            direction: "outward",
            tolerance: 1e-6,
          }),
        ).toThrow(expected);
        expect(fixture.state.takeResultCalls).toHaveLength(1);
        expect(
          fixture.state.resultReleaseCalls.get(fixture.state.lastResultId!),
        ).toBe(1);
        expect(fixture.state.raw!.getShapeCount()).toBe(
          fixture.state.beforeResultCount! - 1,
        );
        kernel.disposeShape(input);
      } finally {
        kernel.dispose();
      }
    }

    const fixture = exactSolidOffsetFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const input = kernel.box!([20, 20, 10], false);
      expect(() =>
        kernel.offset!(
          input,
          { distance: 1, direction: "outward", tolerance: 1e-6 },
          { feature: "" },
        ),
      ).toThrow("feature must be a non-empty string");
      expect(
        fixture.state.resultReleaseCalls.get(fixture.state.lastResultId!),
      ).toBe(1);
      kernel.disposeShape(input);
    } finally {
      kernel.dispose();
    }
  }, 20_000);

  it("honors cancellation before invocation and immediately after transfer", async () => {
    const pre = exactSolidOffsetFactory();
    const preKernel = await createOcctKernel({ moduleFactory: pre.factory });
    try {
      const input = preKernel.box!([20, 20, 10], false);
      const abort = new AbortController();
      abort.abort();
      expect(() =>
        preKernel.offset!(
          input,
          { distance: 1, direction: "outward", tolerance: 1e-6 },
          { signal: abort.signal },
        ),
      ).toThrow("aborted");
      expect(pre.state.invocations).toHaveLength(0);
      preKernel.disposeShape(input);
    } finally {
      preKernel.dispose();
    }

    const abort = new AbortController();
    const post = exactSolidOffsetFactory({ abortOnTake: abort });
    const postKernel = await createOcctKernel({ moduleFactory: post.factory });
    try {
      const input = postKernel.box!([20, 20, 10], false);
      expect(() =>
        postKernel.offset!(
          input,
          { distance: 1, direction: "outward", tolerance: 1e-6 },
          { signal: abort.signal },
        ),
      ).toThrow("aborted");
      expect(post.state.takeResultCalls).toHaveLength(1);
      expect(
        post.state.resultReleaseCalls.get(post.state.lastResultId!),
      ).toBe(1);
      expect(post.state.raw!.getShapeCount()).toBe(
        post.state.beforeResultCount! - 1,
      );
      postKernel.disposeShape(input);
    } finally {
      postKernel.dispose();
    }
  });

  it("keeps stock and ABI 0.5 shell/offset fallback history partial", async () => {
    for (const factory of [stockFactory, legacyFactory]) {
      const kernel = await createOcctKernel({ moduleFactory: factory });
      try {
        const input = kernel.box!([20, 20, 10], false, { feature: "source" });
        const face = kernel.topology!(input).faces[5]!;
        const shell = kernel.shell!(
          input,
          [face.key],
          { thickness: 1, direction: "inward", tolerance: 1e-6 },
          { feature: "fallback-shell" },
        );
        const offset = kernel.offset!(
          input,
          { distance: 1, direction: "outward", tolerance: 1e-6 },
          { feature: "fallback-offset" },
        );
        expect(kernel.topology!(shell).history).toBe("partial");
        expect(kernel.topology!(offset).history).toBe("partial");
        for (const feature of ["shell", "offset"] as const) {
          expect(
            kernelSupports(
              kernel.capabilities,
              "exactIndexedTopologyEvolution",
              feature,
            ),
          ).toBe(false);
        }
        kernel.disposeShape(offset);
        kernel.disposeShape(shell);
        kernel.disposeShape(input);
      } finally {
        kernel.dispose();
      }
    }
  });
});
