import { describe, expect, it, vi, type Mock } from "vitest";
import {
  OCCT_DRAFT_FACADE_VERSION,
  OcctDraftFacadeProtocolError,
  OcctDraftOperationError,
  OcctDraftUnsupportedError,
  adoptOcctDraft,
  probeOcctDraftFacade,
  type AdoptOcctDraftOptions,
  type OcctDraftEmbindVectorUint32,
  type OcctDraftRawReport,
} from "../src/internal/occt-draft.js";
import {
  INDEXED_TOPOLOGY_KIND as KIND,
  INDEXED_TOPOLOGY_RELATION as RELATION,
  TopologyEvolutionProtocolError,
} from "../src/internal/topology-evolution.js";

class FakeVector implements OcctDraftEmbindVectorUint32 {
  readonly values: number[] = [];
  readonly delete = vi.fn();
  readonly push_back = vi.fn((value: number) => {
    this.values.push(value);
  });
}

interface MutableCounts {
  faces: number;
  edges: number;
  vertices: number;
}

interface MutableRecord {
  sourceShapeIndex: number;
  sourceKind: number;
  sourceIndex: number;
  relation: number;
  resultKind: number;
  resultIndex: number;
}

type FakeReport = OcctDraftRawReport & {
  ok: boolean;
  stage: string;
  code: string;
  message: string;
  failedSeedIndex: number;
  occtStatus: number;
  requestedSeedCount: number;
  addCount: number;
  skippedSeedCount: number;
  buildCount: number;
  problematicShapeType: string;
  problematicShapeIndex: number;
  historyProblemDomain: string;
  historyProblemSourceShapeIndex: number;
  historyProblemKind: number;
  historyProblemIndex: number;
  readonly inputCounts: MutableCounts;
  readonly resultCounts: MutableCounts;
  readonly records: MutableRecord[];
  hasResult: ReturnType<typeof vi.fn>;
  transferCode: ReturnType<typeof vi.fn>;
  takeResultId: ReturnType<typeof vi.fn>;
  topologyHistoryVersion: ReturnType<typeof vi.fn>;
  topologyHistoryComplete: ReturnType<typeof vi.fn>;
  topologyInputShapeCount: ReturnType<typeof vi.fn>;
  topologyInputCounts: ReturnType<typeof vi.fn>;
  topologyResultCounts: ReturnType<typeof vi.fn>;
  topologyRecordCount: ReturnType<typeof vi.fn>;
  topologyRecord: ReturnType<typeof vi.fn>;
  delete: Mock<() => void>;
};

function fakeReport(): FakeReport {
  const inputCounts = { faces: 1, edges: 1, vertices: 1 };
  const resultCounts = { faces: 1, edges: 1, vertices: 1 };
  const records: MutableRecord[] = [
    {
      sourceShapeIndex: 0,
      sourceKind: KIND.FACE,
      sourceIndex: 0,
      relation: RELATION.MODIFIED,
      resultKind: KIND.FACE,
      resultIndex: 0,
    },
    {
      sourceShapeIndex: 0,
      sourceKind: KIND.EDGE,
      sourceIndex: 0,
      relation: RELATION.PRESERVED,
      resultKind: KIND.EDGE,
      resultIndex: 0,
    },
    {
      sourceShapeIndex: 0,
      sourceKind: KIND.VERTEX,
      sourceIndex: 0,
      relation: RELATION.MODIFIED,
      resultKind: KIND.VERTEX,
      resultIndex: 0,
    },
  ];
  return {
    ok: true,
    stage: "complete",
    code: "OK",
    message: "Atomic draft completed",
    failedSeedIndex: -1,
    occtStatus: 0,
    requestedSeedCount: 2,
    addCount: 2,
    skippedSeedCount: 0,
    buildCount: 1,
    problematicShapeType: "none",
    problematicShapeIndex: -1,
    historyProblemDomain: "none",
    historyProblemSourceShapeIndex: -1,
    historyProblemKind: KIND.NONE,
    historyProblemIndex: -1,
    inputCounts,
    resultCounts,
    records,
    hasResult: vi.fn(() => true),
    transferCode: vi.fn(() => "READY"),
    takeResultId: vi.fn(() => 91),
    topologyHistoryVersion: vi.fn(() => 1),
    topologyHistoryComplete: vi.fn(() => true),
    topologyInputShapeCount: vi.fn(() => 1),
    topologyInputCounts: vi.fn(() => inputCounts),
    topologyResultCounts: vi.fn(() => resultCounts),
    topologyRecordCount: vi.fn(() => records.length),
    topologyRecord: vi.fn((index: number) => records[index]!),
    delete: vi.fn(),
  };
}

function exactModule(report: FakeReport = fakeReport()) {
  const vectors: FakeVector[] = [];
  const module = {
    VectorUint32: class extends FakeVector {
      constructor() {
        super();
        vectors.push(this);
      }
    },
    InvariantCadDraftReport: class {},
    InvariantCadTopologyKind: {
      NONE: -1,
      FACE: 0,
      EDGE: 1,
      VERTEX: 2,
    },
    InvariantCadTopologyRelation: {
      PRESERVED: 0,
      MODIFIED: 1,
      GENERATED: 2,
      DELETED: 3,
      CREATED: 4,
    },
    invariantcadFacadeVersion: vi.fn(() => OCCT_DRAFT_FACADE_VERSION),
    invariantcadDraftFacesAtomic: vi.fn(() => report),
  };
  return { module, report, vectors };
}

function options<T>(
  module: unknown,
  adopt: AdoptOcctDraftOptions<T>["adopt"],
): AdoptOcctDraftOptions<T> & {
  readonly kernel: { readonly release: Mock<(resultId: number) => void> };
} {
  return {
    module,
    kernel: { release: vi.fn() },
    shapeId: 7,
    faceIds: [11, 12],
    angleRad: Math.PI / 36,
    pullDirection: [0, 0, 1],
    neutralOrigin: [0, 0, 0],
    neutralNormal: [0, 0, 1],
    adopt,
  };
}

describe("owned OCCT draft facade probe", () => {
  it("treats a marker-free stock module as unsupported", () => {
    expect(probeOcctDraftFacade({ VectorUint32: FakeVector })).toBeUndefined();
  });

  it("recognizes only the exact facade and numeric enums", () => {
    const { module } = exactModule();
    expect(probeOcctDraftFacade(module)).toBe(module);
  });

  it("fails closed for partial and unknown marker sets", () => {
    expect(() =>
      probeOcctDraftFacade({ invariantcadFacadeVersion: () => "anything" }),
    ).toThrow(OcctDraftFacadeProtocolError);
    expect(() =>
      probeOcctDraftFacade({
        VectorUint32: FakeVector,
        invariantcadFutureFacade: () => "future",
      }),
    ).toThrow(OcctDraftFacadeProtocolError);

    const { module } = exactModule();
    expect(() =>
      probeOcctDraftFacade({ ...module, invariantcadUnknownMarker: true }),
    ).toThrow(OcctDraftFacadeProtocolError);
  });

  it("rejects unknown versions and non-numeric or mismatched enums", () => {
    const first = exactModule().module;
    first.invariantcadFacadeVersion.mockReturnValue(
      "invariantcad-facade@0.3.0+occt-wasm.3.7.0",
    );
    expect(() => probeOcctDraftFacade(first)).toThrow("version is");

    const second = exactModule().module;
    second.InvariantCadTopologyKind.FACE = { value: 0 } as unknown as number;
    expect(() => probeOcctDraftFacade(second)).toThrow(
      "InvariantCadTopologyKind.FACE must be the number 0",
    );

    const third = exactModule().module;
    third.InvariantCadTopologyRelation.MODIFIED = 8;
    expect(() => probeOcctDraftFacade(third)).toThrow(
      "InvariantCadTopologyRelation.MODIFIED must be the number 1",
    );
  });
});

describe("raw OCCT atomic draft ownership", () => {
  it("rejects stock modules and wrapping face IDs before native allocation", () => {
    expect(() =>
      adoptOcctDraft(options({ VectorUint32: FakeVector }, vi.fn())),
    ).toThrow(OcctDraftUnsupportedError);

    for (const invalid of [-1, 1.5, 4_294_967_296, Number.NaN]) {
      const fixture = exactModule();
      const value = { ...options(fixture.module, vi.fn()), faceIds: [invalid] };
      expect(() => adoptOcctDraft(value)).toThrow("unsigned 32-bit integer");
      expect(fixture.vectors).toHaveLength(0);
      expect(fixture.module.invariantcadDraftFacesAtomic).not.toHaveBeenCalled();
    }
  });

  it("builds and deletes VectorUint32 and transfers one validated result", () => {
    const fixture = exactModule();
    const adopt = vi.fn(({ resultId, report }) => {
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
      expect(report.diagnostics).toEqual({
        ok: true,
        stage: "complete",
        code: "OK",
        message: "Atomic draft completed",
        failedSeedIndex: -1,
        occtStatus: 0,
        requestedSeedCount: 2,
        addCount: 2,
        skippedSeedCount: 0,
        buildCount: 1,
        problematicShapeType: "none",
        problematicShapeIndex: -1,
        historyProblemDomain: "none",
        historyProblemSourceShapeIndex: -1,
        historyProblemKind: -1,
        historyProblemIndex: -1,
        hasResult: true,
        topologyHistoryVersion: 1,
        topologyHistoryComplete: true,
      });
      return resultId;
    });
    const request = options(fixture.module, adopt);

    expect(adoptOcctDraft(request)).toBe(91);
    expect(fixture.vectors).toHaveLength(1);
    expect(fixture.vectors[0]!.values).toEqual([11, 12]);
    expect(fixture.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(fixture.module.invariantcadDraftFacesAtomic).toHaveBeenCalledWith(
      request.kernel,
      7,
      fixture.vectors[0],
      Math.PI / 36,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      1,
    );
    expect(fixture.report.topologyInputCounts).toHaveBeenCalledWith(0);
    expect(fixture.report.topologyRecord).toHaveBeenCalledWith(0);
    expect(fixture.report.topologyRecord).toHaveBeenCalledWith(1);
    expect(fixture.report.topologyRecord).toHaveBeenCalledWith(2);
    expect(fixture.report.transferCode).toHaveBeenCalledTimes(1);
    expect(fixture.report.takeResultId).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("deletes the input vector when construction or invocation fails", () => {
    const first = exactModule();
    first.module.VectorUint32 = class extends FakeVector {
      constructor() {
        super();
        this.push_back.mockImplementationOnce(() => {
          throw new Error("push failed");
        });
        first.vectors.push(this);
      }
    };
    expect(() => adoptOcctDraft(options(first.module, vi.fn()))).toThrow(
      "push failed",
    );
    expect(first.vectors[0]!.delete).toHaveBeenCalledTimes(1);

    const second = exactModule();
    second.module.invariantcadDraftFacesAtomic.mockImplementationOnce(() => {
      throw new Error("invoke failed");
    });
    expect(() => adoptOcctDraft(options(second.module, vi.fn()))).toThrow(
      "invoke failed",
    );
    expect(second.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(second.report.delete).not.toHaveBeenCalled();
  });

  it("deletes a returned report even if vector deletion fails", () => {
    const fixture = exactModule();
    fixture.module.VectorUint32 = class extends FakeVector {
      constructor() {
        super();
        this.delete.mockImplementationOnce(() => {
          throw new Error("vector delete failed");
        });
        fixture.vectors.push(this);
      }
    };

    expect(() => adoptOcctDraft(options(fixture.module, vi.fn()))).toThrow(
      "vector delete failed",
    );
    expect(fixture.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(fixture.report.takeResultId).not.toHaveBeenCalled();
  });

  it("preserves every native failure diagnostic without taking the result", () => {
    const report = fakeReport();
    Object.assign(report, {
      ok: false,
      stage: "history",
      code: "HISTORY_NON_INJECTIVE",
      message: "successor claimed twice",
      failedSeedIndex: 1,
      occtStatus: 7,
      requestedSeedCount: 2,
      addCount: 2,
      skippedSeedCount: 0,
      buildCount: 1,
      problematicShapeType: "edge",
      problematicShapeIndex: 4,
      historyProblemDomain: "result",
      historyProblemSourceShapeIndex: 0,
      historyProblemKind: KIND.EDGE,
      historyProblemIndex: 5,
    });
    report.hasResult.mockReturnValue(false);
    report.topologyHistoryVersion.mockReturnValue(0);
    report.topologyHistoryComplete.mockReturnValue(false);
    const fixture = exactModule(report);
    const request = options(fixture.module, vi.fn());

    let error: unknown;
    try {
      adoptOcctDraft(request);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(OcctDraftOperationError);
    expect((error as OcctDraftOperationError).diagnostics).toEqual({
      ok: false,
      stage: "history",
      code: "HISTORY_NON_INJECTIVE",
      message: "successor claimed twice",
      failedSeedIndex: 1,
      occtStatus: 7,
      requestedSeedCount: 2,
      addCount: 2,
      skippedSeedCount: 0,
      buildCount: 1,
      problematicShapeType: "edge",
      problematicShapeIndex: 4,
      historyProblemDomain: "result",
      historyProblemSourceShapeIndex: 0,
      historyProblemKind: KIND.EDGE,
      historyProblemIndex: 5,
      hasResult: false,
      topologyHistoryVersion: 0,
      topologyHistoryComplete: false,
    });
    expect(Object.isFrozen((error as OcctDraftOperationError).diagnostics)).toBe(
      true,
    );
    expect(report.topologyInputShapeCount).not.toHaveBeenCalled();
    expect(report.transferCode).not.toHaveBeenCalled();
    expect(report.takeResultId).not.toHaveBeenCalled();
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("rejects semantically contradictory reports before transfer", () => {
    const successfulContradictions: Array<(report: FakeReport) => void> = [
      (report) => {
        report.stage = "build";
      },
      (report) => {
        report.topologyHistoryVersion.mockReturnValue(0);
      },
      (report) => {
        report.requestedSeedCount = 3;
      },
      (report) => {
        report.addCount = 1;
      },
      (report) => {
        report.buildCount = 0;
      },
      (report) => {
        report.historyProblemDomain = "future";
      },
    ];
    for (const contradict of successfulContradictions) {
      const fixture = exactModule();
      contradict(fixture.report);
      const request = options(fixture.module, vi.fn());
      expect(() => adoptOcctDraft(request)).toThrow(
        OcctDraftFacadeProtocolError,
      );
      expect(fixture.report.transferCode).not.toHaveBeenCalled();
      expect(fixture.report.takeResultId).not.toHaveBeenCalled();
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
      expect(request.kernel.release).not.toHaveBeenCalled();
    }

    for (const expose of ["result", "history"] as const) {
      const fixture = exactModule();
      Object.assign(fixture.report, {
        ok: false,
        stage: "history",
        code: "HISTORY_FAILURE",
        message: "failed",
      });
      fixture.report.hasResult.mockReturnValue(expose === "result");
      fixture.report.topologyHistoryVersion.mockReturnValue(
        expose === "history" ? 1 : 0,
      );
      fixture.report.topologyHistoryComplete.mockReturnValue(
        expose === "history",
      );
      const request = options(fixture.module, vi.fn());
      expect(() => adoptOcctDraft(request)).toThrow(
        OcctDraftFacadeProtocolError,
      );
      expect(fixture.report.takeResultId).not.toHaveBeenCalled();
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
      expect(request.kernel.release).not.toHaveBeenCalled();
    }
  });

  it("deletes the report when a native history accessor throws", () => {
    const fixture = exactModule();
    fixture.report.topologyRecord.mockImplementationOnce(() => {
      throw new Error("record accessor failed");
    });
    const request = options(fixture.module, vi.fn());

    expect(() => adoptOcctDraft(request)).toThrow("record accessor failed");
    expect(fixture.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(fixture.report.takeResultId).not.toHaveBeenCalled();
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("rejects oversized native counts before any indexed accessor loop", () => {
    for (const invalid of [2_147_483_648, 4_294_967_296, 1.5]) {
      const fixture = exactModule();
      fixture.report.topologyInputShapeCount.mockReturnValue(invalid);
      expect(() =>
        adoptOcctDraft(options(fixture.module, vi.fn())),
      ).toThrow("signed 32-bit integer");
      expect(fixture.report.topologyInputCounts).not.toHaveBeenCalled();
      expect(fixture.report.topologyRecord).not.toHaveBeenCalled();
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    }

    const recordFixture = exactModule();
    recordFixture.report.topologyRecordCount.mockReturnValue(2_147_483_648);
    expect(() =>
      adoptOcctDraft(options(recordFixture.module, vi.fn())),
    ).toThrow("signed 32-bit integer");
    expect(recordFixture.report.topologyRecord).not.toHaveBeenCalled();
    expect(recordFixture.report.delete).toHaveBeenCalledTimes(1);
  });

  it("refuses incomplete history and a non-ready transfer state", () => {
    const incomplete = exactModule();
    incomplete.report.topologyHistoryComplete.mockReturnValue(false);
    expect(() =>
      adoptOcctDraft(options(incomplete.module, vi.fn())),
    ).toThrow("complete topology history version 1");
    expect(incomplete.report.transferCode).not.toHaveBeenCalled();
    expect(incomplete.report.takeResultId).not.toHaveBeenCalled();
    expect(incomplete.report.delete).toHaveBeenCalledTimes(1);

    const wrongState = exactModule();
    wrongState.report.transferCode.mockReturnValue("WRONG_KERNEL");
    expect(() =>
      adoptOcctDraft(options(wrongState.module, vi.fn())),
    ).toThrow("transfer state is 'WRONG_KERNEL'");
    expect(wrongState.report.takeResultId).not.toHaveBeenCalled();
    expect(wrongState.report.delete).toHaveBeenCalledTimes(1);
  });

  it("runs caller validation after READY but before transfer", () => {
    const fixture = exactModule();
    const adopt = vi.fn();
    const validate = vi.fn((snapshot) => {
      expect(fixture.report.transferCode).toHaveBeenCalledTimes(1);
      expect(fixture.report.takeResultId).not.toHaveBeenCalled();
      expect(Object.isFrozen(snapshot)).toBe(true);
      throw new Error("raw topology count mismatch");
    });
    const request = { ...options(fixture.module, adopt), validate };

    expect(() => adoptOcctDraft(request)).toThrow("raw topology count mismatch");
    expect(validate).toHaveBeenCalledTimes(1);
    expect(adopt).not.toHaveBeenCalled();
    expect(fixture.report.takeResultId).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("rejects malformed exact history before result transfer", () => {
    const fixture = exactModule();
    fixture.report.records[1] = {
      ...fixture.report.records[0]!,
      resultKind: KIND.EDGE,
    };
    const request = options(fixture.module, vi.fn());

    expect(() => adoptOcctDraft(request)).toThrow(
      TopologyEvolutionProtocolError,
    );
    expect(fixture.report.transferCode).not.toHaveBeenCalled();
    expect(fixture.report.takeResultId).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("deletes the report without releasing when transfer itself throws", () => {
    const fixture = exactModule();
    fixture.report.takeResultId.mockImplementationOnce(() => {
      throw new Error("transfer failed");
    });
    const request = options(fixture.module, vi.fn());

    expect(() => adoptOcctDraft(request)).toThrow("transfer failed");
    expect(fixture.report.takeResultId).toHaveBeenCalledTimes(1);
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("rejects reserved transferred ID zero without calling release", () => {
    const fixture = exactModule();
    fixture.report.takeResultId.mockReturnValue(0);
    const request = options(fixture.module, vi.fn());

    expect(() => adoptOcctDraft(request)).toThrow("reserved result ID 0");
    expect(fixture.report.takeResultId).toHaveBeenCalledTimes(1);
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("releases the transferred root exactly once when adoption throws", () => {
    const fixture = exactModule();
    const request = options(fixture.module, vi.fn(() => {
      throw new Error("reduction failed");
    }));

    expect(() => adoptOcctDraft(request)).toThrow("reduction failed");
    expect(fixture.report.takeResultId).toHaveBeenCalledTimes(1);
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).toHaveBeenCalledWith(91);
  });

  it("isolates copied diagnostics and history from native mutation", () => {
    const fixture = exactModule();
    fixture.report.takeResultId.mockImplementationOnce(() => {
      fixture.report.code = "MUTATED_NATIVE_CODE";
      fixture.report.inputCounts.faces = 999;
      fixture.report.resultCounts.faces = 999;
      fixture.report.records[0]!.relation = RELATION.CREATED;
      return 91;
    });
    const adopt = vi.fn(({ report }) => {
      expect(report.diagnostics.code).toBe("OK");
      expect(report.evolution.inputCounts[0]!.faces).toBe(1);
      expect(report.evolution.resultCounts.faces).toBe(1);
      expect(report.evolution.records[0]!.relation).toBe(RELATION.MODIFIED);
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.evolution)).toBe(true);
      expect(Object.isFrozen(report.evolution.inputCounts)).toBe(true);
      expect(Object.isFrozen(report.evolution.records[0])).toBe(true);
      expect(() => {
        (report.evolution.records[0] as MutableRecord).relation = RELATION.CREATED;
      }).toThrow(TypeError);
      return "adopted";
    });
    const request = options(fixture.module, adopt);

    expect(adoptOcctDraft(request)).toBe("adopted");
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });
});
