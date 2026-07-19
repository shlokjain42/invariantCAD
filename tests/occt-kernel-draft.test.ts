import { describe, expect, it, vi } from "vitest";
import createStockOcctModule from "occt-wasm/dist/occt-wasm.js";
import { kernelSupports } from "../src/kernel.js";
import {
  createOcctKernel,
  type OcctKernelOptions,
  type OcctModuleFactory,
  type OcctModuleOptions,
} from "../src/occt-kernel.js";
import type { ResolvedDraftOptions } from "../src/protocol/draft.js";

const TOPOLOGY_KIND = Object.freeze({
  NONE: -1,
  FACE: 0,
  EDGE: 1,
  VERTEX: 2,
});

const TOPOLOGY_RELATION = Object.freeze({
  PRESERVED: 0,
  MODIFIED: 1,
  GENERATED: 2,
  DELETED: 3,
  CREATED: 4,
});

const draftOptions: ResolvedDraftOptions = {
  angle: Math.PI / 36,
  pullDirection: [0, 0, 1],
  neutralPlane: {
    origin: [0, 0, 0],
    normal: [0, 0, 1],
  },
};

class MinimalRawKernel {
  static constructed = 0;
  static disposed = 0;

  constructor() {
    MinimalRawKernel.constructed += 1;
  }

  releaseAll(): void {}

  delete(): void {
    MinimalRawKernel.disposed += 1;
  }
}

function minimalModule(exactFacade: boolean): Record<string, unknown> {
  const module: Record<string, unknown> = { OcctKernel: MinimalRawKernel };
  if (!exactFacade) return module;
  return Object.assign(module, {
    VectorUint32: class {},
    InvariantCadDraftReport: class {},
    InvariantCadTopologyKind: TOPOLOGY_KIND,
    InvariantCadTopologyRelation: TOPOLOGY_RELATION,
    invariantcadFacadeVersion: () =>
      "invariantcad-facade@0.2.0+occt-wasm.3.7.0",
    invariantcadDraftFacesAtomic: () => {
      throw new Error("not invoked by this loader test");
    },
  });
}

interface RawVector {
  size(): number;
  get(index: number): number;
  delete(): void;
}

interface TestRawKernel {
  release(id: number): void;
  copy(id: number): number;
  makeSphere(radius: number): number;
  getShapeCount(): number;
  getSubShapes(id: number, topology: string): RawVector;
  subShapeCount(id: number, topology: string): number;
  isSame(first: number, second: number): boolean;
}

interface FacadeState {
  raw?: TestRawKernel;
  beforeResultCount?: number;
  resultId?: number;
  selectedIndices: number[];
  takeResultCalls: number;
  reportOwnedReleases: number;
}

interface FacadeOptions {
  readonly reportedFaceDelta?: number;
  readonly result?: "copy" | "sphere";
}

function vectorValues(vector: RawVector): number[] {
  return Array.from({ length: vector.size() }, (_, index) => vector.get(index));
}

function counts(
  raw: TestRawKernel,
  shapeId: number,
  faceDelta = 0,
): { faces: number; edges: number; vertices: number } {
  return {
    faces: raw.subShapeCount(shapeId, "face") + faceDelta,
    edges: raw.subShapeCount(shapeId, "edge"),
    vertices: raw.subShapeCount(shapeId, "vertex"),
  };
}

function recordsFor(
  topologyCounts: { faces: number; edges: number; vertices: number },
  modifiedFaces: readonly number[],
): Array<{
  sourceShapeIndex: number;
  sourceKind: number;
  sourceIndex: number;
  relation: number;
  resultKind: number;
  resultIndex: number;
}> {
  const records = [];
  for (const [kind, count] of [
    [TOPOLOGY_KIND.FACE, topologyCounts.faces],
    [TOPOLOGY_KIND.EDGE, topologyCounts.edges],
    [TOPOLOGY_KIND.VERTEX, topologyCounts.vertices],
  ] as const) {
    for (let index = 0; index < count; index += 1) {
      records.push({
        sourceShapeIndex: 0,
        sourceKind: kind,
        sourceIndex: index,
        relation:
          kind === TOPOLOGY_KIND.FACE && modifiedFaces.includes(index)
            ? TOPOLOGY_RELATION.MODIFIED
            : TOPOLOGY_RELATION.PRESERVED,
        resultKind: kind,
        resultIndex: index,
      });
    }
  }
  return records;
}

function facadeFactory(options: FacadeOptions = {}): {
  readonly factory: OcctModuleFactory;
  readonly state: FacadeState;
} {
  const state: FacadeState = {
    selectedIndices: [],
    takeResultCalls: 0,
    reportOwnedReleases: 0,
  };
  const factory: OcctModuleFactory = async (moduleOptions) => {
    const module = (await createStockOcctModule(moduleOptions)) as Record<
      string,
      unknown
    >;
    Object.assign(module, {
      InvariantCadDraftReport: class {},
      InvariantCadTopologyKind: TOPOLOGY_KIND,
      InvariantCadTopologyRelation: TOPOLOGY_RELATION,
      invariantcadFacadeVersion: () =>
        "invariantcad-facade@0.2.0+occt-wasm.3.7.0",
      invariantcadDraftFacesAtomic: (
        rawValue: unknown,
        shapeId: number,
        faceVectorValue: unknown,
      ) => {
        const raw = rawValue as TestRawKernel;
        const faceVector = faceVectorValue as RawVector;
        state.raw = raw;
        const selectedIds = vectorValues(faceVector);
        const occurrences = raw.getSubShapes(shapeId, "face");
        const occurrenceIds = vectorValues(occurrences);
        try {
          state.selectedIndices = selectedIds.map((selectedId) => {
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

        const declaredCounts = counts(
          raw,
          shapeId,
          options.reportedFaceDelta ?? 0,
        );
        const records = recordsFor(declaredCounts, state.selectedIndices);
        state.beforeResultCount = raw.getShapeCount();
        const resultId =
          options.result === "sphere" ? raw.makeSphere(1) : raw.copy(shapeId);
        state.resultId = resultId;
        let transferred = false;
        let deleted = false;
        return {
          ok: true,
          stage: "complete",
          code: "OK",
          message: "Atomic draft completed",
          failedSeedIndex: -1,
          occtStatus: 0,
          requestedSeedCount: selectedIds.length,
          addCount: selectedIds.length,
          skippedSeedCount: 0,
          buildCount: 1,
          problematicShapeType: "none",
          problematicShapeIndex: -1,
          historyProblemDomain: "none",
          historyProblemSourceShapeIndex: -1,
          historyProblemKind: TOPOLOGY_KIND.NONE,
          historyProblemIndex: -1,
          hasResult: () => !deleted && !transferred,
          transferCode: () => "READY",
          takeResultId: () => {
            state.takeResultCalls += 1;
            transferred = true;
            return resultId;
          },
          topologyHistoryVersion: () => 1,
          topologyHistoryComplete: () => true,
          topologyInputShapeCount: () => 1,
          topologyInputCounts: () => declaredCounts,
          topologyResultCounts: () => declaredCounts,
          topologyRecordCount: () => records.length,
          topologyRecord: (index: number) => records[index],
          delete: () => {
            if (deleted) return;
            deleted = true;
            if (!transferred) {
              state.reportOwnedReleases += 1;
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

describe("OCCT module-factory and facade probing", () => {
  it("feeds custom WASM to the supplied factory and keeps stock capabilities", async () => {
    MinimalRawKernel.constructed = 0;
    MinimalRawKernel.disposed = 0;
    const factory = vi.fn<OcctModuleFactory>(async () => minimalModule(false));
    const bytes = new Uint8Array([9, 8, 7, 6]).subarray(1, 3);
    const output = vi.fn();
    const kernel = await createOcctKernel({
      moduleFactory: factory,
      wasm: bytes,
      onOutput: output,
    });
    try {
      expect(factory).toHaveBeenCalledOnce();
      const passed = factory.mock.calls[0]![0] as OcctModuleOptions;
      expect([...new Uint8Array(passed.wasmBinary!)]).toEqual([8, 7]);
      expect(passed.print).toBe(output);
      expect(kernel.draft).toBeUndefined();
      expect("draft" in kernel).toBe(false);
      expect(kernel.capabilities.topology?.signatures).toBeUndefined();
      expect(kernelSupports(kernel.capabilities, "feature", "draft")).toBe(false);
      expect(
        kernelSupports(
          kernel.capabilities,
          "exactIndexedTopologyEvolution",
          "draft",
        ),
      ).toBe(false);
    } finally {
      kernel.dispose();
    }
    expect(MinimalRawKernel.constructed).toBe(1);
    expect(MinimalRawKernel.disposed).toBe(1);
  });

  it("advertises draft only for the exact recognized facade", async () => {
    const kernel = await createOcctKernel({
      moduleFactory: async () => minimalModule(true),
    });
    try {
      expect(kernel.draft).toBeTypeOf("function");
      expect(kernelSupports(kernel.capabilities, "feature", "draft")).toBe(true);
      expect(kernel.capabilities.topology?.provenance).toBe("feature");
      expect(kernel.capabilities.exactIndexedTopologyEvolution).toEqual({
        protocolVersion: 1,
        features: ["draft"],
      });
      expect(kernel.capabilities.compositeSweep).toBeUndefined();
      expect(
        kernelSupports(
          kernel.capabilities,
          "compositeSweepRefinement",
          "major-multiple-arcs",
        ),
      ).toBe(false);
    } finally {
      kernel.dispose();
    }
  });

  it("fails a partial facade before constructing the raw vendor kernel", async () => {
    MinimalRawKernel.constructed = 0;
    await expect(
      createOcctKernel({
        moduleFactory: async () => ({
          OcctKernel: MinimalRawKernel,
          invariantcadFacadeVersion: () => "unknown",
        }),
      }),
    ).rejects.toThrow("marker set");
    expect(MinimalRawKernel.constructed).toBe(0);
  });

  it("disposes the vendor wrapper if public-kernel construction fails", async () => {
    MinimalRawKernel.constructed = 0;
    MinimalRawKernel.disposed = 0;
    const options: Record<string, unknown> = {
      moduleFactory: async () => minimalModule(false),
    };
    Object.defineProperty(options, "tessellation", {
      get: () => {
        throw new Error("tessellation getter failed");
      },
    });
    await expect(
      createOcctKernel(options as OcctKernelOptions),
    ).rejects.toThrow("tessellation getter failed");
    expect(MinimalRawKernel.constructed).toBe(1);
    expect(MinimalRawKernel.disposed).toBe(1);
  });
});

describe("owned OCCT draft integration", () => {
  it("remaps, deduplicates, and numerically sorts selected opaque face keys", async () => {
    const fixture = facadeFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const box = kernel.box!([10, 20, 30], false, { feature: "box" });
      const rounded = kernel.fillet!(
        box,
        kernel.topology!(box).edges.map((edge) => edge.key),
        { radius: 0.5 },
        { feature: "rounded" },
      );
      const input = kernel.topology!(rounded);
      expect(input.faces.length).toBeGreaterThan(10);
      const result = kernel.draft!(
        rounded,
        [input.faces[10]!.key, input.faces[2]!.key, input.faces[10]!.key],
        draftOptions,
        { feature: "drafted" },
      );
      expect(fixture.state.selectedIndices).toEqual([2, 10]);
      const output = kernel.topology!(result);
      expect(output.history).toBe("partial");
      for (const index of [2, 10]) {
        expect(output.faces[index]!.lineage).toContainEqual({
          feature: "drafted",
          relation: "modified",
        });
      }
      expect(output.faces[0]!.lineage).not.toContainEqual(
        expect.objectContaining({ feature: "drafted" }),
      );
      kernel.disposeShape(result);
      kernel.disposeShape(rounded);
      kernel.disposeShape(box);
    } finally {
      kernel.dispose();
    }
  });

  it("validates direct calls and rejects non-face or foreign topology keys", async () => {
    const fixture = facadeFactory();
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const box = kernel.box!([10, 20, 30], false);
      const foreign = kernel.box!([1, 1, 1], false);
      const topology = kernel.topology!(box);
      const foreignTopology = kernel.topology!(foreign);
      expect(() => kernel.draft!(box, [], draftOptions)).toThrow(
        "at least one face",
      );
      expect(() =>
        kernel.draft!(box, [topology.edges[0]!.key], draftOptions),
      ).toThrow("is not a face of the input shape");
      expect(() =>
        kernel.draft!(box, [foreignTopology.faces[0]!.key], draftOptions),
      ).toThrow("is not a face of the input shape");
      for (const angle of [0, 1e-4, Math.PI / 2, Number.NaN]) {
        expect(() =>
          kernel.draft!(box, [topology.faces[0]!.key], {
            ...draftOptions,
            angle,
          }),
        ).toThrow("Draft angle");
      }
      expect(() =>
        kernel.draft!(box, [topology.faces[0]!.key], {
          ...draftOptions,
          pullDirection: [0, 0, 0],
        }),
      ).toThrow("pull direction");
      expect(() =>
        kernel.draft!(box, [topology.faces[0]!.key], {
          ...draftOptions,
          neutralPlane: { ...draftOptions.neutralPlane, normal: [0, 0, 0] },
        }),
      ).toThrow("neutral-plane normal");
      kernel.disposeShape(foreign);
      kernel.disposeShape(box);
    } finally {
      kernel.dispose();
    }
  });

  it("rejects input count drift before transfer and leaves report ownership intact", async () => {
    const fixture = facadeFactory({ reportedFaceDelta: 1 });
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const box = kernel.box!([10, 20, 30], false);
      const face = kernel.topology!(box).faces[0]!;
      expect(() => kernel.draft!(box, [face.key], draftOptions)).toThrow(
        "draft inputCounts[0].faces",
      );
      expect(fixture.state.takeResultCalls).toBe(0);
      expect(fixture.state.reportOwnedReleases).toBe(1);
      expect(fixture.state.raw!.getShapeCount()).toBe(
        fixture.state.beforeResultCount,
      );
      kernel.disposeShape(box);
    } finally {
      kernel.dispose();
    }
  });

  it("rolls back provisional topology and lets the helper release the root", async () => {
    const fixture = facadeFactory({ result: "sphere" });
    const kernel = await createOcctKernel({ moduleFactory: fixture.factory });
    try {
      const box = kernel.box!([10, 20, 30], false);
      const face = kernel.topology!(box).faces[0]!;
      expect(() => kernel.draft!(box, [face.key], draftOptions)).toThrow(
        "draft resultCounts.faces",
      );
      expect(fixture.state.takeResultCalls).toBe(1);
      expect(fixture.state.reportOwnedReleases).toBe(0);
      expect(fixture.state.raw!.getShapeCount()).toBe(
        fixture.state.beforeResultCount,
      );
      kernel.disposeShape(box);
    } finally {
      kernel.dispose();
    }
  });
});

const typeOnlyOptions: OcctKernelOptions = {
  moduleFactory: async (_options?: OcctModuleOptions) => minimalModule(false),
};
const typeOnlyFactory: OcctModuleFactory = typeOnlyOptions.moduleFactory!;
void (typeOnlyFactory satisfies OcctModuleFactory);
