import { describe, expect, it, vi, type Mock } from "vitest";
import {
  INDEXED_TOPOLOGY_KIND as KIND,
  INDEXED_TOPOLOGY_RELATION as RELATION,
  TopologyEvolutionProtocolError,
  type IndexedTopologyEvolutionRecord,
} from "../src/internal/topology-evolution.js";
import {
  DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT,
  OCCT_EDGE_TREATMENT_OPERATION_CODE,
  OcctEdgeTreatmentFacadeProtocolError,
  OcctEdgeTreatmentOperationError,
  adoptOcctEdgeTreatment,
  type AdoptOcctEdgeTreatmentOptions,
  type OcctEdgeTreatmentOperation,
} from "../src/internal/occt-edge-treatment.js";

interface MutableCounts {
  faces: unknown;
  edges: unknown;
  vertices: unknown;
}

interface MutableRecord {
  sourceShapeIndex: unknown;
  sourceKind: unknown;
  sourceIndex: unknown;
  relation: unknown;
  resultKind: unknown;
  resultIndex: unknown;
}

class FakeVector {
  readonly values: number[] = [];
  readonly push_back = vi.fn((value: number) => {
    this.values.push(value);
  });
  readonly delete = vi.fn();
}

interface FakeReport {
  ok: unknown;
  stage: unknown;
  code: unknown;
  message: unknown;
  operation: unknown;
  amount: unknown;
  requestedSeedCount: unknown;
  addCount: unknown;
  skippedSeedCount: unknown;
  contourCount: unknown;
  buildCount: unknown;
  failedSeedIndex: unknown;
  historyProblemDomain: unknown;
  historyProblemSourceShapeIndex: unknown;
  historyProblemKind: unknown;
  historyProblemIndex: unknown;
  selectedEdgeIndices: unknown[];
  inputCounts: MutableCounts[];
  resultCounts: MutableCounts;
  records: MutableRecord[];
  selectedEdgeCount: Mock<() => unknown>;
  selectedEdgeIndex: Mock<(index: number) => unknown>;
  hasResult: Mock<() => unknown>;
  transferCode: Mock<(kernel: unknown) => unknown>;
  takeResultId: Mock<(kernel: unknown) => unknown>;
  topologyHistoryVersion: Mock<() => unknown>;
  topologyHistoryComplete: Mock<() => unknown>;
  topologyInputShapeCount: Mock<() => unknown>;
  topologyInputCounts: Mock<(index: number) => unknown>;
  topologyResultCounts: Mock<() => unknown>;
  topologyRecordCount: Mock<() => unknown>;
  topologyRecord: Mock<(index: number) => unknown>;
  delete: Mock<() => void>;
}

function fakeReport(
  operation: OcctEdgeTreatmentOperation = "fillet",
  amount = 2.5,
): FakeReport {
  const selectedEdgeIndices: unknown[] = [0, 1];
  const inputCounts: MutableCounts[] = [
    { faces: 1, edges: 2, vertices: 2 },
  ];
  const resultCounts: MutableCounts = { faces: 2, edges: 2, vertices: 2 };
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
      relation: RELATION.GENERATED,
      resultKind: KIND.FACE,
      resultIndex: 1,
    },
    {
      sourceShapeIndex: 0,
      sourceKind: KIND.EDGE,
      sourceIndex: 0,
      relation: RELATION.DELETED,
      resultKind: KIND.NONE,
      resultIndex: -1,
    },
    {
      sourceShapeIndex: 0,
      sourceKind: KIND.EDGE,
      sourceIndex: 1,
      relation: RELATION.PRESERVED,
      resultKind: KIND.EDGE,
      resultIndex: 0,
    },
    {
      sourceShapeIndex: 0,
      sourceKind: KIND.VERTEX,
      sourceIndex: 0,
      relation: RELATION.PRESERVED,
      resultKind: KIND.VERTEX,
      resultIndex: 0,
    },
    {
      sourceShapeIndex: 0,
      sourceKind: KIND.VERTEX,
      sourceIndex: 1,
      relation: RELATION.MODIFIED,
      resultKind: KIND.VERTEX,
      resultIndex: 1,
    },
    {
      sourceShapeIndex: -1,
      sourceKind: KIND.NONE,
      sourceIndex: -1,
      relation: RELATION.CREATED,
      resultKind: KIND.EDGE,
      resultIndex: 1,
    },
  ];
  const report: FakeReport = {
    ok: true,
    stage: "complete",
    code: "OK",
    message: "Edge treatment and exact indexed history are ready",
    operation: OCCT_EDGE_TREATMENT_OPERATION_CODE[operation],
    amount,
    requestedSeedCount: 2,
    addCount: 1,
    skippedSeedCount: 1,
    contourCount: 1,
    buildCount: 1,
    failedSeedIndex: -1,
    historyProblemDomain: "none",
    historyProblemSourceShapeIndex: -1,
    historyProblemKind: KIND.NONE,
    historyProblemIndex: -1,
    selectedEdgeIndices,
    inputCounts,
    resultCounts,
    records,
    selectedEdgeCount: vi.fn(() => selectedEdgeIndices.length),
    selectedEdgeIndex: vi.fn((index: number) => selectedEdgeIndices[index]),
    hasResult: vi.fn(() => true),
    transferCode: vi.fn(() => "READY"),
    takeResultId: vi.fn(() => 91),
    topologyHistoryVersion: vi.fn(() => 1),
    topologyHistoryComplete: vi.fn(() => true),
    topologyInputShapeCount: vi.fn(() => inputCounts.length),
    topologyInputCounts: vi.fn((index: number) => inputCounts[index]),
    topologyResultCounts: vi.fn(() => resultCounts),
    topologyRecordCount: vi.fn(() => records.length),
    topologyRecord: vi.fn((index: number) => records[index]),
    delete: vi.fn(),
  };
  return report;
}

function failedReport(
  operation: OcctEdgeTreatmentOperation = "fillet",
): FakeReport {
  const report = fakeReport(operation);
  Object.assign(report, {
    ok: false,
    stage: "history",
    code: "HISTORY_SUCCESSOR_NOT_IN_RESULT",
    message: "edge successor is absent from the result",
    addCount: 1,
    skippedSeedCount: 0,
    contourCount: 1,
    buildCount: 1,
    failedSeedIndex: 1,
    historyProblemDomain: "result",
    historyProblemSourceShapeIndex: -1,
    historyProblemKind: KIND.EDGE,
    historyProblemIndex: 4,
  });
  report.hasResult.mockReturnValue(false);
  report.topologyHistoryVersion.mockReturnValue(0);
  report.topologyHistoryComplete.mockReturnValue(false);
  return report;
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
    invariantcadEdgeTreatmentAtomic: vi.fn(() => report),
  };
  return { module, report, vectors };
}

function options<T>(
  module: unknown,
  adopt: AdoptOcctEdgeTreatmentOptions<T>["adopt"],
  operation: OcctEdgeTreatmentOperation = "fillet",
): AdoptOcctEdgeTreatmentOptions<T> & {
  readonly kernel: { readonly release: Mock<(resultId: number) => void> };
} {
  return {
    module,
    kernel: { release: vi.fn() },
    operation,
    inputId: 7,
    edgeIds: [11, 12],
    selectedEdgeIndices: [0, 1],
    amount: 2.5,
    adopt,
  };
}

function expectFacadeFailure(
  fixture: ReturnType<typeof exactModule>,
  request = options(fixture.module, vi.fn()),
): void {
  expect(() => adoptOcctEdgeTreatment(request)).toThrow(
    OcctEdgeTreatmentFacadeProtocolError,
  );
  expect(fixture.report.takeResultId).not.toHaveBeenCalled();
  expect(fixture.report.delete).toHaveBeenCalledTimes(1);
  expect(request.kernel.release).not.toHaveBeenCalled();
}

describe("owned exact OCCT fillet/chamfer transaction", () => {
  it.each([
    ["fillet", 0],
    ["chamfer", 1],
  ] as const)("passes stable %s operation code %s and the default record cap", (operation, code) => {
    const report = fakeReport(operation);
    const fixture = exactModule(report);
    const request = options(fixture.module, ({ resultId }) => resultId, operation);

    expect(adoptOcctEdgeTreatment(request)).toBe(91);
    expect(fixture.module.invariantcadEdgeTreatmentAtomic).toHaveBeenCalledWith(
      request.kernel,
      code,
      7,
      fixture.vectors[0],
      2.5,
      DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT,
    );
    expect(fixture.vectors[0]!.values).toEqual([11, 12]);
    expect(fixture.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(report.takeResultId).toHaveBeenCalledTimes(1);
    expect(report.takeResultId).toHaveBeenCalledWith(request.kernel);
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("copies, freezes, validates, and transfers a complete normalized report", () => {
    const fixture = exactModule();
    const validate = vi.fn((snapshot) => {
      expect(snapshot.transferCode).toBe("READY");
      expect(snapshot.selectedEdgeIndices).toEqual([0, 1]);
      expect(fixture.report.transferCode).toHaveBeenCalledTimes(1);
      expect(fixture.report.takeResultId).not.toHaveBeenCalled();
      expect(fixture.report.delete).not.toHaveBeenCalled();
    });
    const adopt = vi.fn(({ resultId, report }) => {
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
      expect(resultId).toBe(91);
      expect(report.diagnostics).toEqual({
        ok: true,
        stage: "complete",
        code: "OK",
        message: "Edge treatment and exact indexed history are ready",
        operation: 0,
        amount: 2.5,
        requestedSeedCount: 2,
        addCount: 1,
        skippedSeedCount: 1,
        contourCount: 1,
        buildCount: 1,
        failedSeedIndex: -1,
        historyProblemDomain: "none",
        historyProblemSourceShapeIndex: -1,
        historyProblemKind: KIND.NONE,
        historyProblemIndex: -1,
        hasResult: true,
        topologyHistoryVersion: 1,
        topologyHistoryComplete: true,
      });
      expect(report.evolution.inputShapeCount).toBe(1);
      expect(report.evolution.records).toHaveLength(7);
      expect(
        report.evolution.records.some(
          (record: IndexedTopologyEvolutionRecord) =>
            record.relation === RELATION.GENERATED &&
            record.sourceKind === KIND.EDGE &&
            record.resultKind === KIND.FACE,
        ),
      ).toBe(true);
      expect(
        report.evolution.records.some(
          (record: IndexedTopologyEvolutionRecord) =>
            record.relation === RELATION.CREATED,
        ),
      ).toBe(true);
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.diagnostics)).toBe(true);
      expect(Object.isFrozen(report.selectedEdgeIndices)).toBe(true);
      expect(Object.isFrozen(report.evolution)).toBe(true);
      expect(Object.isFrozen(report.evolution.inputCounts)).toBe(true);
      expect(Object.isFrozen(report.evolution.inputCounts[0])).toBe(true);
      expect(Object.isFrozen(report.evolution.resultCounts)).toBe(true);
      expect(Object.isFrozen(report.evolution.records)).toBe(true);
      expect(Object.isFrozen(report.evolution.records[0])).toBe(true);
      return "adopted";
    });
    const request = { ...options(fixture.module, adopt), validate };

    expect(adoptOcctEdgeTreatment(request)).toBe("adopted");
    expect(validate).toHaveBeenCalledTimes(1);
    expect(fixture.report.selectedEdgeIndex.mock.calls).toEqual([[0], [1]]);
    expect(fixture.report.topologyInputCounts).toHaveBeenCalledWith(0);
    expect(fixture.report.topologyRecord).toHaveBeenCalledTimes(7);
  });

  it("isolates the frozen snapshot from native mutation during transfer", () => {
    const fixture = exactModule();
    fixture.report.takeResultId.mockImplementationOnce(() => {
      fixture.report.code = "MUTATED";
      fixture.report.selectedEdgeIndices[0] = 99;
      fixture.report.inputCounts[0]!.faces = 99;
      fixture.report.resultCounts.faces = 99;
      fixture.report.records[0]!.relation = RELATION.CREATED;
      return 91;
    });
    const request = options(fixture.module, ({ report }) => {
      expect(report.diagnostics.code).toBe("OK");
      expect(report.selectedEdgeIndices).toEqual([0, 1]);
      expect(report.evolution.inputCounts[0]!.faces).toBe(1);
      expect(report.evolution.resultCounts.faces).toBe(2);
      expect(report.evolution.records[0]!.relation).toBe(RELATION.MODIFIED);
      expect(() => {
        (report.selectedEdgeIndices as number[])[0] = 3;
      }).toThrow(TypeError);
      return true;
    });

    expect(adoptOcctEdgeTreatment(request)).toBe(true);
  });

  it("requires the exact canonical selected-edge echo", () => {
    const mismatch = exactModule();
    mismatch.report.selectedEdgeIndices.splice(0, 2, 0, 2);
    const mismatchRequest = {
      ...options(mismatch.module, vi.fn()),
      selectedEdgeIndices: [0, 1],
    };
    expect(() => adoptOcctEdgeTreatment(mismatchRequest)).toThrow(
      "selected edge indices do not match the request",
    );
    expect(mismatch.report.takeResultId).not.toHaveBeenCalled();
    expect(mismatch.report.delete).toHaveBeenCalledTimes(1);

    const unsortedReport = exactModule();
    unsortedReport.report.selectedEdgeIndices.splice(0, 2, 1, 0);
    expectFacadeFailure(unsortedReport);

    const unsortedRequest = exactModule();
    const request = {
      ...options(unsortedRequest.module, vi.fn()),
      selectedEdgeIndices: [1, 0],
    };
    expect(() => adoptOcctEdgeTreatment(request)).toThrow(
      "selectedEdgeIndices must be strictly increasing",
    );
    expect(unsortedRequest.vectors).toHaveLength(0);
    expect(unsortedRequest.module.invariantcadEdgeTreatmentAtomic).not.toHaveBeenCalled();
  });

  it("preserves a well-formed native failure without reading or transferring history", () => {
    const report = failedReport();
    const fixture = exactModule(report);
    const request = options(fixture.module, vi.fn());

    let caught: unknown;
    try {
      adoptOcctEdgeTreatment(request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OcctEdgeTreatmentOperationError);
    expect((caught as OcctEdgeTreatmentOperationError).diagnostics).toEqual({
      ok: false,
      stage: "history",
      code: "HISTORY_SUCCESSOR_NOT_IN_RESULT",
      message: "edge successor is absent from the result",
      operation: 0,
      amount: 2.5,
      requestedSeedCount: 2,
      addCount: 1,
      skippedSeedCount: 0,
      contourCount: 1,
      buildCount: 1,
      failedSeedIndex: 1,
      historyProblemDomain: "result",
      historyProblemSourceShapeIndex: -1,
      historyProblemKind: KIND.EDGE,
      historyProblemIndex: 4,
      hasResult: false,
      topologyHistoryVersion: 0,
      topologyHistoryComplete: false,
    });
    expect(
      Object.isFrozen(
        (caught as OcctEdgeTreatmentOperationError).diagnostics,
      ),
    ).toBe(true);
    expect(report.topologyInputShapeCount).not.toHaveBeenCalled();
    expect(report.transferCode).not.toHaveBeenCalled();
    expect(report.takeResultId).not.toHaveBeenCalled();
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it.each([
    ["null module", null],
    ["missing vector", { invariantcadEdgeTreatmentAtomic: vi.fn() }],
    ["missing entry point", { VectorUint32: FakeVector }],
  ])("rejects a structurally invalid %s before allocation", (_label, module) => {
    expect(() => adoptOcctEdgeTreatment(options(module, vi.fn()))).toThrow(
      OcctEdgeTreatmentFacadeProtocolError,
    );
  });

  it("rejects malformed request data before native allocation", () => {
    for (const operation of [
      "round",
      "",
      "toString",
      "constructor",
      "__proto__",
      0,
      null,
    ]) {
      const fixture = exactModule();
      const request = {
        ...options(fixture.module, vi.fn()),
        operation: operation as OcctEdgeTreatmentOperation,
      };
      expect(() => adoptOcctEdgeTreatment(request)).toThrow("unsupported operation");
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const amount of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      const fixture = exactModule();
      expect(() =>
        adoptOcctEdgeTreatment({ ...options(fixture.module, vi.fn()), amount }),
      ).toThrow("amount must be finite and positive");
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const inputId of [-1, 1.5, 4_294_967_296, Number.NaN]) {
      const fixture = exactModule();
      expect(() =>
        adoptOcctEdgeTreatment({ ...options(fixture.module, vi.fn()), inputId }),
      ).toThrow("unsigned 32-bit integer");
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const edgeIds of [
      [],
      [-1],
      [1.5],
      [4_294_967_296],
      {} as unknown as number[],
    ]) {
      const fixture = exactModule();
      const request = {
        ...options(fixture.module, vi.fn()),
        edgeIds,
        selectedEdgeIndices: Array.isArray(edgeIds)
          ? edgeIds.map((_edge) => 0)
          : [],
      };
      expect(() => adoptOcctEdgeTreatment(request)).toThrow();
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const maxHistoryRecords of [-1, 0.5, 2_147_483_648]) {
      const fixture = exactModule();
      expect(() =>
        adoptOcctEdgeTreatment({
          ...options(fixture.module, vi.fn()),
          maxHistoryRecords,
        }),
      ).toThrow(OcctEdgeTreatmentFacadeProtocolError);
      expect(fixture.vectors).toHaveLength(0);
    }
  });

  it("rejects facade-sized edge arrays before iteration or native allocation", () => {
    const fixture = exactModule();
    const edgeIds: number[] = [];
    const selectedEdgeIndices: number[] = [];
    edgeIds.length = 2_147_483_647;
    selectedEdgeIndices.length = 2_147_483_647;

    expect(() =>
      adoptOcctEdgeTreatment({
        ...options(fixture.module, vi.fn()),
        edgeIds,
        selectedEdgeIndices,
      }),
    ).toThrow("lengths exceed the signed 32-bit facade limit");
    expect(fixture.vectors).toHaveLength(0);
    expect(fixture.module.invariantcadEdgeTreatmentAtomic).not.toHaveBeenCalled();
  });

  it("deletes native vectors and reports across construction and accessor failures", () => {
    const pushFailure = exactModule();
    pushFailure.module.VectorUint32 = class extends FakeVector {
      constructor() {
        super();
        this.push_back.mockImplementationOnce(() => {
          throw new Error("push failed");
        });
        pushFailure.vectors.push(this);
      }
    };
    expect(() =>
      adoptOcctEdgeTreatment(options(pushFailure.module, vi.fn())),
    ).toThrow("push failed");
    expect(pushFailure.vectors[0]!.delete).toHaveBeenCalledTimes(1);

    const invokeFailure = exactModule();
    invokeFailure.module.invariantcadEdgeTreatmentAtomic.mockImplementationOnce(() => {
      throw new Error("invoke failed");
    });
    expect(() =>
      adoptOcctEdgeTreatment(options(invokeFailure.module, vi.fn())),
    ).toThrow("invoke failed");
    expect(invokeFailure.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(invokeFailure.report.delete).not.toHaveBeenCalled();

    const accessorFailure = exactModule();
    accessorFailure.report.topologyResultCounts.mockImplementationOnce(() => {
      throw new Error("counts failed");
    });
    expect(() =>
      adoptOcctEdgeTreatment(options(accessorFailure.module, vi.fn())),
    ).toThrow("counts failed");
    expect(accessorFailure.report.delete).toHaveBeenCalledTimes(1);
    expect(accessorFailure.report.takeResultId).not.toHaveBeenCalled();
  });

  it.each([
    "selectedEdgeCount",
    "selectedEdgeIndex",
    "hasResult",
    "transferCode",
    "takeResultId",
    "topologyHistoryVersion",
    "topologyHistoryComplete",
    "topologyInputShapeCount",
    "topologyInputCounts",
    "topologyResultCounts",
    "topologyRecordCount",
    "topologyRecord",
  ] as const)("rejects missing report method %s and deletes the report", (method) => {
    const fixture = exactModule();
    (fixture.report as unknown as Record<string, unknown>)[method] = undefined;
    expect(() =>
      adoptOcctEdgeTreatment(options(fixture.module, vi.fn())),
    ).toThrow(`report.${method} must be a function`);
    expect(fixture.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed diagnostics and successful-state contradictions", () => {
    const malformed: Array<(report: FakeReport) => void> = [
      (report) => {
        report.ok = "yes";
      },
      (report) => {
        report.amount = Number.POSITIVE_INFINITY;
      },
      (report) => {
        report.operation = 0.5;
      },
      (report) => {
        report.addCount = -1;
      },
      (report) => {
        report.failedSeedIndex = 0.5;
      },
      (report) => {
        report.historyProblemDomain = 1;
      },
      (report) => {
        report.stage = "build";
      },
      (report) => {
        report.code = "NOT_OK";
      },
      (report) => {
        report.operation = 1;
      },
      (report) => {
        report.amount = 3;
      },
      (report) => {
        report.requestedSeedCount = 1;
      },
      (report) => {
        report.addCount = 2;
        report.skippedSeedCount = 1;
      },
      (report) => {
        report.contourCount = 0;
      },
      (report) => {
        report.buildCount = 0;
      },
      (report) => {
        report.failedSeedIndex = 0;
      },
      (report) => {
        report.hasResult.mockReturnValue(false);
      },
      (report) => {
        report.topologyHistoryVersion.mockReturnValue(0);
      },
      (report) => {
        report.topologyHistoryComplete.mockReturnValue(false);
      },
      (report) => {
        report.historyProblemDomain = "source";
        report.historyProblemSourceShapeIndex = 0;
        report.historyProblemKind = KIND.EDGE;
        report.historyProblemIndex = 0;
      },
    ];
    for (const mutate of malformed) {
      const fixture = exactModule();
      mutate(fixture.report);
      expectFacadeFailure(fixture);
    }
  });

  it("validates failed-report diagnostics and history problem sentinels", () => {
    const contradictions: Array<(report: FakeReport) => void> = [
      (report) => {
        report.hasResult.mockReturnValue(true);
      },
      (report) => {
        report.topologyHistoryVersion.mockReturnValue(1);
      },
      (report) => {
        report.topologyHistoryComplete.mockReturnValue(true);
      },
      (report) => {
        report.stage = "complete";
      },
      (report) => {
        report.code = "OK";
      },
      (report) => {
        report.failedSeedIndex = 2;
      },
      (report) => {
        report.historyProblemDomain = "source";
        report.historyProblemSourceShapeIndex = -1;
      },
      (report) => {
        report.historyProblemDomain = "result";
        report.historyProblemSourceShapeIndex = 0;
      },
      (report) => {
        report.historyProblemKind = KIND.NONE;
      },
      (report) => {
        report.historyProblemIndex = -2;
      },
    ];
    for (const mutate of contradictions) {
      const report = failedReport();
      mutate(report);
      expectFacadeFailure(exactModule(report));
    }

    const sourceProblem = failedReport();
    Object.assign(sourceProblem, {
      historyProblemDomain: "source",
      historyProblemSourceShapeIndex: 0,
      historyProblemKind: KIND.VERTEX,
      historyProblemIndex: -1,
    });
    expect(() =>
      adoptOcctEdgeTreatment(options(exactModule(sourceProblem).module, vi.fn())),
    ).toThrow(OcctEdgeTreatmentOperationError);
  });

  it("rejects malformed or incomplete indexed envelopes before transfer", () => {
    const badInputCount = exactModule();
    badInputCount.report.topologyInputShapeCount.mockReturnValue(2);
    expectFacadeFailure(badInputCount);
    expect(badInputCount.report.topologyInputCounts).not.toHaveBeenCalled();

    const badCounts = exactModule();
    badCounts.report.resultCounts.edges = -1;
    expectFacadeFailure(badCounts);

    const badRecordField = exactModule();
    badRecordField.report.records[0]!.relation = 0.5;
    expectFacadeFailure(badRecordField);

    const incomplete = exactModule();
    incomplete.report.records.shift();
    expect(() =>
      adoptOcctEdgeTreatment(options(incomplete.module, vi.fn())),
    ).toThrow(TopologyEvolutionProtocolError);
    expect(incomplete.report.transferCode).not.toHaveBeenCalled();
    expect(incomplete.report.takeResultId).not.toHaveBeenCalled();
    expect(incomplete.report.delete).toHaveBeenCalledTimes(1);

    const selectedOutOfRange = exactModule();
    selectedOutOfRange.report.selectedEdgeIndices.splice(0, 2, 0, 2);
    const selectedRequest = {
      ...options(selectedOutOfRange.module, vi.fn()),
      selectedEdgeIndices: [0, 2],
    };
    expect(() => adoptOcctEdgeTreatment(selectedRequest)).toThrow(
      "selected edge index is outside the input topology",
    );
    expect(selectedOutOfRange.report.takeResultId).not.toHaveBeenCalled();
  });

  it("bounds selected-edge access by the known request before indexed copying", () => {
    const fixture = exactModule();
    fixture.report.selectedEdgeCount.mockReturnValue(2_147_483_647);
    expectFacadeFailure(fixture);
    expect(fixture.report.selectedEdgeIndex).not.toHaveBeenCalled();
    expect(fixture.report.topologyInputShapeCount).not.toHaveBeenCalled();
  });

  it("enforces the configured history record cap before indexed copying", () => {
    const accepted = exactModule();
    const acceptedRequest = {
      ...options(accepted.module, ({ resultId }) => resultId),
      maxHistoryRecords: 7,
    };
    expect(adoptOcctEdgeTreatment(acceptedRequest)).toBe(91);
    expect(accepted.report.topologyRecord).toHaveBeenCalledTimes(7);
    expect(accepted.module.invariantcadEdgeTreatmentAtomic).toHaveBeenCalledWith(
      acceptedRequest.kernel,
      0,
      7,
      accepted.vectors[0],
      2.5,
      7,
    );

    const rejected = exactModule();
    rejected.report.topologyRecordCount.mockReturnValue(8);
    const rejectedRequest = {
      ...options(rejected.module, vi.fn()),
      maxHistoryRecords: 7,
    };
    expect(() => adoptOcctEdgeTreatment(rejectedRequest)).toThrow(
      "exceeding the configured JavaScript copy limit 7",
    );
    expect(rejected.report.topologyRecord).not.toHaveBeenCalled();
    expect(rejected.report.takeResultId).not.toHaveBeenCalled();
    expect(rejected.report.delete).toHaveBeenCalledTimes(1);
    expect(rejectedRequest.kernel.release).not.toHaveBeenCalled();
  });

  it("runs caller validation after READY and before one-shot transfer", () => {
    const fixture = exactModule();
    const adopt = vi.fn();
    const validate = vi.fn(() => {
      expect(fixture.report.transferCode).toHaveBeenCalledTimes(1);
      expect(fixture.report.takeResultId).not.toHaveBeenCalled();
      throw new Error("input count mismatch");
    });
    const request = { ...options(fixture.module, adopt), validate };

    expect(() => adoptOcctEdgeTreatment(request)).toThrow("input count mismatch");
    expect(validate).toHaveBeenCalledTimes(1);
    expect(adopt).not.toHaveBeenCalled();
    expect(fixture.report.takeResultId).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it.each(["NO_RESULT", "ALREADY_TRANSFERRED", "WRONG_KERNEL"])(
    "rejects native transfer state %s without taking or releasing a result",
    (state) => {
      const fixture = exactModule();
      fixture.report.transferCode.mockReturnValue(state);
      const request = options(fixture.module, vi.fn());

      expect(() => adoptOcctEdgeTreatment(request)).toThrow(
        `transfer state is '${state}'`,
      );
      expect(fixture.report.takeResultId).not.toHaveBeenCalled();
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
      expect(request.kernel.release).not.toHaveBeenCalled();
    },
  );

  it("does not release an untaken result when transfer throws or returns an invalid ID", () => {
    const transferFailure = exactModule();
    transferFailure.report.takeResultId.mockImplementationOnce(() => {
      throw new Error("transfer failed");
    });
    const failedRequest = options(transferFailure.module, vi.fn());
    expect(() => adoptOcctEdgeTreatment(failedRequest)).toThrow("transfer failed");
    expect(failedRequest.kernel.release).not.toHaveBeenCalled();
    expect(transferFailure.report.delete).toHaveBeenCalledTimes(1);

    for (const resultId of [0, -1, 1.5, 4_294_967_296]) {
      const invalid = exactModule();
      invalid.report.takeResultId.mockReturnValue(resultId);
      const request = options(invalid.module, vi.fn());
      expect(() => adoptOcctEdgeTreatment(request)).toThrow(
        OcctEdgeTreatmentFacadeProtocolError,
      );
      expect(request.kernel.release).not.toHaveBeenCalled();
      expect(invalid.report.delete).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects transferred result IDs that alias the input or selected edges", () => {
    for (const resultId of [7, 11, 12]) {
      const fixture = exactModule();
      fixture.report.takeResultId.mockReturnValue(resultId);
      const request = options(fixture.module, vi.fn());
      expect(() => adoptOcctEdgeTreatment(request)).toThrow(
        "aliases an input operand",
      );
      expect(request.adopt).not.toHaveBeenCalled();
      expect(request.kernel.release).not.toHaveBeenCalled();
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    }
  });

  it("releases a transferred result exactly once on adoption or cleanup failure", () => {
    const adoptionFailure = exactModule();
    const adoptionRequest = options(adoptionFailure.module, vi.fn(() => {
      throw new Error("reduction failed");
    }));
    expect(() => adoptOcctEdgeTreatment(adoptionRequest)).toThrow(
      "reduction failed",
    );
    expect(adoptionRequest.kernel.release).toHaveBeenCalledTimes(1);
    expect(adoptionRequest.kernel.release).toHaveBeenCalledWith(91);
    expect(adoptionFailure.report.delete).toHaveBeenCalledTimes(1);

    const cleanupFailure = exactModule();
    cleanupFailure.report.delete.mockImplementationOnce(() => {
      throw new Error("report delete failed");
    });
    const cleanupRequest = options(cleanupFailure.module, vi.fn());
    expect(() => adoptOcctEdgeTreatment(cleanupRequest)).toThrow(
      "report delete failed",
    );
    expect(cleanupRequest.kernel.release).toHaveBeenCalledTimes(1);
    expect(cleanupRequest.kernel.release).toHaveBeenCalledWith(91);
  });
});
