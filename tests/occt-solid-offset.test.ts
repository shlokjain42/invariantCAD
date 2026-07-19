import { describe, expect, it, vi, type Mock } from "vitest";
import {
  INDEXED_TOPOLOGY_KIND as KIND,
  INDEXED_TOPOLOGY_RELATION as RELATION,
  TopologyEvolutionProtocolError,
  type IndexedTopologyEvolutionRecord,
} from "../src/internal/topology-evolution.js";
import {
  DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT,
  OCCT_SOLID_OFFSET_DIRECTION_CODE,
  OCCT_SOLID_OFFSET_OPERATION_CODE,
  OcctSolidOffsetFacadeProtocolError,
  OcctSolidOffsetOperationError,
  adoptOcctSolidOffset,
  type AdoptOcctSolidOffsetOptions,
  type OcctSolidOffsetDirection,
  type OcctSolidOffsetOperation,
} from "../src/internal/occt-solid-offset.js";

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
  direction: unknown;
  amount: unknown;
  tolerance: unknown;
  requestedOpeningFaceCount: unknown;
  buildCount: unknown;
  occtStatus: unknown;
  failedOpeningFaceIndex: unknown;
  historyProblemDomain: unknown;
  historyProblemSourceShapeIndex: unknown;
  historyProblemKind: unknown;
  historyProblemIndex: unknown;
  selectedOpeningFaceIndices: unknown[];
  inputCounts: MutableCounts[];
  resultCounts: MutableCounts;
  records: MutableRecord[];
  selectedOpeningFaceCount: Mock<() => unknown>;
  selectedOpeningFaceIndex: Mock<(index: number) => unknown>;
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
  operation: OcctSolidOffsetOperation = "shell",
  direction: OcctSolidOffsetDirection = "inward",
  amount = 2.5,
  tolerance = 0.01,
): FakeReport {
  const selectedOpeningFaceIndices: unknown[] =
    operation === "shell" ? [0] : [];
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
    message: "Solid offset and exact indexed history are ready",
    operation: OCCT_SOLID_OFFSET_OPERATION_CODE[operation],
    direction: OCCT_SOLID_OFFSET_DIRECTION_CODE[direction],
    amount,
    tolerance,
    requestedOpeningFaceCount: operation === "shell" ? 2 : 0,
    buildCount: 1,
    occtStatus: 0,
    failedOpeningFaceIndex: -1,
    historyProblemDomain: "none",
    historyProblemSourceShapeIndex: -1,
    historyProblemKind: KIND.NONE,
    historyProblemIndex: -1,
    selectedOpeningFaceIndices,
    inputCounts,
    resultCounts,
    records,
    selectedOpeningFaceCount: vi.fn(() => selectedOpeningFaceIndices.length),
    selectedOpeningFaceIndex: vi.fn(
      (index: number) => selectedOpeningFaceIndices[index],
    ),
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

function failedReport(): FakeReport {
  const report = fakeReport();
  Object.assign(report, {
    ok: false,
    stage: "history",
    code: "HISTORY_SUCCESSOR_NOT_IN_RESULT",
    message: "a shell successor is absent from the result",
    buildCount: 1,
    occtStatus: 7,
    failedOpeningFaceIndex: 1,
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
    InvariantCadSolidOffsetOperation: { SHELL: 0, OFFSET: 1 },
    InvariantCadSolidOffsetDirection: { INWARD: 0, OUTWARD: 1 },
    InvariantCadSolidOffsetReport: class {},
    invariantcadSolidOffsetAtomic: vi.fn(() => report),
  };
  return { module, report, vectors };
}

function options<T>(
  module: unknown,
  adopt: AdoptOcctSolidOffsetOptions<T>["adopt"],
  operation: OcctSolidOffsetOperation = "shell",
  direction: OcctSolidOffsetDirection = "inward",
): AdoptOcctSolidOffsetOptions<T> & {
  readonly kernel: { readonly release: Mock<(resultId: number) => void> };
} {
  return {
    module,
    kernel: { release: vi.fn() },
    operation,
    inputId: 7,
    openingFaceIds: operation === "shell" ? [11, 11] : [],
    selectedOpeningFaceIndices: operation === "shell" ? [0] : [],
    amount: 2.5,
    direction,
    tolerance: 0.01,
    adopt,
  };
}

function expectFacadeFailure(
  fixture: ReturnType<typeof exactModule>,
  request = options(fixture.module, vi.fn()),
): void {
  expect(() => adoptOcctSolidOffset(request)).toThrow(
    OcctSolidOffsetFacadeProtocolError,
  );
  expect(fixture.report.takeResultId).not.toHaveBeenCalled();
  expect(fixture.report.delete).toHaveBeenCalledTimes(1);
  expect(request.kernel.release).not.toHaveBeenCalled();
}

describe("owned exact OCCT shell/offset transaction", () => {
  it.each([
    ["shell", "inward", 0, 0],
    ["shell", "outward", 0, 1],
    ["offset", "inward", 1, 0],
    ["offset", "outward", 1, 1],
  ] as const)(
    "passes stable %s/%s codes and the independent default cap",
    (operation, direction, operationCode, directionCode) => {
      const report = fakeReport(operation, direction);
      const fixture = exactModule(report);
      const request = options(
        fixture.module,
        ({ resultId }) => resultId,
        operation,
        direction,
      );

      expect(adoptOcctSolidOffset(request)).toBe(91);
      expect(fixture.module.invariantcadSolidOffsetAtomic).toHaveBeenCalledWith(
        request.kernel,
        operationCode,
        7,
        fixture.vectors[0],
        2.5,
        directionCode,
        0.01,
        DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT,
      );
      expect(fixture.vectors[0]!.values).toEqual(
        operation === "shell" ? [11, 11] : [],
      );
      expect(fixture.vectors[0]!.delete).toHaveBeenCalledTimes(1);
      expect(report.takeResultId).toHaveBeenCalledWith(request.kernel);
      expect(report.delete).toHaveBeenCalledTimes(1);
      expect(request.kernel.release).not.toHaveBeenCalled();
    },
  );

  it("copies, freezes, validates, and transfers a complete created-capable report", () => {
    const fixture = exactModule();
    const validate = vi.fn((snapshot) => {
      expect(snapshot.transferCode).toBe("READY");
      expect(snapshot.selectedOpeningFaceIndices).toEqual([0]);
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
        message: "Solid offset and exact indexed history are ready",
        operation: 0,
        direction: 0,
        amount: 2.5,
        tolerance: 0.01,
        requestedOpeningFaceCount: 2,
        buildCount: 1,
        occtStatus: 0,
        failedOpeningFaceIndex: -1,
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
      expect(Object.isFrozen(report.selectedOpeningFaceIndices)).toBe(true);
      expect(Object.isFrozen(report.evolution)).toBe(true);
      expect(Object.isFrozen(report.evolution.inputCounts)).toBe(true);
      expect(Object.isFrozen(report.evolution.inputCounts[0])).toBe(true);
      expect(Object.isFrozen(report.evolution.resultCounts)).toBe(true);
      expect(Object.isFrozen(report.evolution.records)).toBe(true);
      expect(Object.isFrozen(report.evolution.records[0])).toBe(true);
      return "adopted";
    });

    expect(
      adoptOcctSolidOffset({ ...options(fixture.module, adopt), validate }),
    ).toBe("adopted");
    expect(validate).toHaveBeenCalledTimes(1);
    expect(fixture.report.selectedOpeningFaceIndex.mock.calls).toEqual([[0]]);
    expect(fixture.report.topologyInputCounts).toHaveBeenCalledWith(0);
    expect(fixture.report.topologyRecord).toHaveBeenCalledTimes(7);
  });

  it("isolates the frozen snapshot from native mutation during transfer", () => {
    const fixture = exactModule();
    fixture.report.takeResultId.mockImplementationOnce(() => {
      fixture.report.code = "MUTATED";
      fixture.report.selectedOpeningFaceIndices[0] = 99;
      fixture.report.inputCounts[0]!.faces = 99;
      fixture.report.resultCounts.faces = 99;
      fixture.report.records[0]!.relation = RELATION.CREATED;
      return 91;
    });
    const request = options(fixture.module, ({ report }) => {
      expect(report.diagnostics.code).toBe("OK");
      expect(report.selectedOpeningFaceIndices).toEqual([0]);
      expect(report.evolution.inputCounts[0]!.faces).toBe(1);
      expect(report.evolution.resultCounts.faces).toBe(2);
      expect(report.evolution.records[0]!.relation).toBe(RELATION.MODIFIED);
      expect(() => {
        (report.selectedOpeningFaceIndices as number[])[0] = 3;
      }).toThrow(TypeError);
      return true;
    });

    expect(adoptOcctSolidOffset(request)).toBe(true);
  });

  it("requires the exact sorted canonical opening echo while preserving duplicates in the native request", () => {
    const mismatch = exactModule();
    mismatch.report.selectedOpeningFaceIndices.splice(0, 1);
    expect(() =>
      adoptOcctSolidOffset(options(mismatch.module, vi.fn())),
    ).toThrow("must select at least one requested opening face");
    expect(mismatch.report.takeResultId).not.toHaveBeenCalled();

    const different = exactModule();
    different.report.inputCounts[0]!.faces = 2;
    different.report.selectedOpeningFaceIndices.splice(0, 1, 1);
    expect(() =>
      adoptOcctSolidOffset(options(different.module, vi.fn())),
    ).toThrow("selected opening face indices do not match the request");

    const unsortedReport = exactModule();
    unsortedReport.report.inputCounts[0]!.faces = 2;
    unsortedReport.report.requestedOpeningFaceCount = 2;
    unsortedReport.report.selectedOpeningFaceIndices.splice(0, 1, 1, 0);
    expectFacadeFailure(unsortedReport, {
      ...options(unsortedReport.module, vi.fn()),
      selectedOpeningFaceIndices: [0, 1],
    });

    const unsortedRequest = exactModule();
    const request = {
      ...options(unsortedRequest.module, vi.fn()),
      openingFaceIds: [11, 12],
      selectedOpeningFaceIndices: [1, 0],
    };
    expect(() => adoptOcctSolidOffset(request)).toThrow(
      "selectedOpeningFaceIndices must be strictly increasing",
    );
    expect(unsortedRequest.vectors).toHaveLength(0);
  });

  it("preserves a well-formed native failure without reading or transferring history", () => {
    const report = failedReport();
    const fixture = exactModule(report);
    const request = options(fixture.module, vi.fn());

    let caught: unknown;
    try {
      adoptOcctSolidOffset(request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OcctSolidOffsetOperationError);
    expect((caught as OcctSolidOffsetOperationError).diagnostics).toEqual({
      ok: false,
      stage: "history",
      code: "HISTORY_SUCCESSOR_NOT_IN_RESULT",
      message: "a shell successor is absent from the result",
      operation: 0,
      direction: 0,
      amount: 2.5,
      tolerance: 0.01,
      requestedOpeningFaceCount: 2,
      buildCount: 1,
      occtStatus: 7,
      failedOpeningFaceIndex: 1,
      historyProblemDomain: "result",
      historyProblemSourceShapeIndex: -1,
      historyProblemKind: KIND.EDGE,
      historyProblemIndex: 4,
      hasResult: false,
      topologyHistoryVersion: 0,
      topologyHistoryComplete: false,
    });
    expect(
      Object.isFrozen((caught as OcctSolidOffsetOperationError).diagnostics),
    ).toBe(true);
    expect(report.topologyInputShapeCount).not.toHaveBeenCalled();
    expect(report.transferCode).not.toHaveBeenCalled();
    expect(report.takeResultId).not.toHaveBeenCalled();
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });
});

describe("solid-offset ABI validation and rollback", () => {
  it.each([
    ["null module", null],
    ["missing vector", { invariantcadSolidOffsetAtomic: vi.fn() }],
    ["missing entry point", { VectorUint32: FakeVector }],
  ])("rejects a structurally invalid %s before allocation", (_label, module) => {
    expect(() => adoptOcctSolidOffset(options(module, vi.fn()))).toThrow(
      OcctSolidOffsetFacadeProtocolError,
    );
  });

  it("uses explicit operation and direction switches against prototype-key inputs", () => {
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
        operation: operation as OcctSolidOffsetOperation,
      };
      expect(() => adoptOcctSolidOffset(request)).toThrow(
        "operation must be 'shell' or 'offset'",
      );
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const direction of [
      "inside",
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
        direction: direction as OcctSolidOffsetDirection,
      };
      expect(() => adoptOcctSolidOffset(request)).toThrow(
        "direction must be 'inward' or 'outward'",
      );
      expect(fixture.vectors).toHaveLength(0);
    }
  });

  it("rejects malformed scalar request data before native allocation", () => {
    for (const amount of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      const fixture = exactModule();
      expect(() =>
        adoptOcctSolidOffset({ ...options(fixture.module, vi.fn()), amount }),
      ).toThrow("amount must be finite and positive");
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const tolerance of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
      const fixture = exactModule();
      expect(() =>
        adoptOcctSolidOffset({
          ...options(fixture.module, vi.fn()),
          tolerance,
        }),
      ).toThrow("tolerance must be finite and positive");
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const tolerance of [2.5, 3]) {
      const fixture = exactModule();
      expect(() =>
        adoptOcctSolidOffset({
          ...options(fixture.module, vi.fn()),
          tolerance,
        }),
      ).toThrow("tolerance must be less than amount");
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const inputId of [-1, 1.5, 4_294_967_296, Number.NaN]) {
      const fixture = exactModule();
      expect(() =>
        adoptOcctSolidOffset({ ...options(fixture.module, vi.fn()), inputId }),
      ).toThrow("unsigned 32-bit integer");
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const maxHistoryRecords of [-1, 0.5, 2_147_483_648]) {
      const fixture = exactModule();
      expect(() =>
        adoptOcctSolidOffset({
          ...options(fixture.module, vi.fn()),
          maxHistoryRecords,
        }),
      ).toThrow(OcctSolidOffsetFacadeProtocolError);
      expect(fixture.vectors).toHaveLength(0);
    }
  });

  it("enforces operation-specific opening request shapes before allocation", () => {
    const emptyShell = exactModule();
    expect(() =>
      adoptOcctSolidOffset({
        ...options(emptyShell.module, vi.fn()),
        openingFaceIds: [],
        selectedOpeningFaceIndices: [],
      }),
    ).toThrow("shell requires at least one opening face ID");
    expect(emptyShell.vectors).toHaveLength(0);

    const noCanonicalShell = exactModule();
    expect(() =>
      adoptOcctSolidOffset({
        ...options(noCanonicalShell.module, vi.fn()),
        selectedOpeningFaceIndices: [],
      }),
    ).toThrow("shell requires at least one canonical opening face index");
    expect(noCanonicalShell.vectors).toHaveLength(0);

    for (const requestPatch of [
      { openingFaceIds: [11], selectedOpeningFaceIndices: [] },
      { openingFaceIds: [], selectedOpeningFaceIndices: [0] },
    ]) {
      const offset = exactModule(fakeReport("offset"));
      expect(() =>
        adoptOcctSolidOffset({
          ...options(offset.module, vi.fn(), "offset"),
          ...requestPatch,
        }),
      ).toThrow("offset does not accept opening faces");
      expect(offset.vectors).toHaveLength(0);
    }

    const tooManyCanonical = exactModule();
    expect(() =>
      adoptOcctSolidOffset({
        ...options(tooManyCanonical.module, vi.fn()),
        openingFaceIds: [11],
        selectedOpeningFaceIndices: [0, 1],
      }),
    ).toThrow("cannot exceed the requested opening-face count");
    expect(tooManyCanonical.vectors).toHaveLength(0);
  });

  it("rejects malformed opening arrays and entries before allocation", () => {
    for (const openingFaceIds of [
      [-1],
      [1.5],
      [4_294_967_296],
      {} as unknown as number[],
    ]) {
      const fixture = exactModule();
      const request = {
        ...options(fixture.module, vi.fn()),
        openingFaceIds,
        selectedOpeningFaceIndices: Array.isArray(openingFaceIds) ? [0] : [],
      };
      expect(() => adoptOcctSolidOffset(request)).toThrow();
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const selectedOpeningFaceIndices of [
      [-1],
      [1.5],
      [2_147_483_648],
      {} as unknown as number[],
    ]) {
      const fixture = exactModule();
      const request = {
        ...options(fixture.module, vi.fn()),
        openingFaceIds: [11],
        selectedOpeningFaceIndices,
      };
      expect(() => adoptOcctSolidOffset(request)).toThrow();
      expect(fixture.vectors).toHaveLength(0);
    }
  });

  it("rejects facade-sized arrays before iteration or native allocation", () => {
    const oversizedOpenings = exactModule();
    const openingFaceIds: number[] = [];
    openingFaceIds.length = 2_147_483_647;
    expect(() =>
      adoptOcctSolidOffset({
        ...options(oversizedOpenings.module, vi.fn()),
        openingFaceIds,
      }),
    ).toThrow("openingFaceIds length exceeds the signed 32-bit facade limit");
    expect(oversizedOpenings.vectors).toHaveLength(0);

    const oversizedSelected = exactModule();
    const selectedOpeningFaceIndices: number[] = [];
    selectedOpeningFaceIndices.length = 2_147_483_647;
    expect(() =>
      adoptOcctSolidOffset({
        ...options(oversizedSelected.module, vi.fn()),
        selectedOpeningFaceIndices,
      }),
    ).toThrow(
      "selectedOpeningFaceIndices length exceeds the signed 32-bit facade limit",
    );
    expect(oversizedSelected.vectors).toHaveLength(0);
  });

  it("deletes native vectors and deletable reports across failures", () => {
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
      adoptOcctSolidOffset(options(pushFailure.module, vi.fn())),
    ).toThrow("push failed");
    expect(pushFailure.vectors[0]!.delete).toHaveBeenCalledTimes(1);

    const invokeFailure = exactModule();
    invokeFailure.module.invariantcadSolidOffsetAtomic.mockImplementationOnce(
      () => {
        throw new Error("invoke failed");
      },
    );
    expect(() =>
      adoptOcctSolidOffset(options(invokeFailure.module, vi.fn())),
    ).toThrow("invoke failed");
    expect(invokeFailure.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(invokeFailure.report.delete).not.toHaveBeenCalled();

    const malformed = exactModule();
    const deletable = { delete: vi.fn() };
    malformed.module.invariantcadSolidOffsetAtomic.mockReturnValueOnce(
      deletable as unknown as FakeReport,
    );
    expect(() =>
      adoptOcctSolidOffset(options(malformed.module, vi.fn())),
    ).toThrow("report.selectedOpeningFaceCount must be a function");
    expect(deletable.delete).toHaveBeenCalledTimes(1);

    const accessorFailure = exactModule();
    accessorFailure.report.topologyResultCounts.mockImplementationOnce(() => {
      throw new Error("counts failed");
    });
    expect(() =>
      adoptOcctSolidOffset(options(accessorFailure.module, vi.fn())),
    ).toThrow("counts failed");
    expect(accessorFailure.report.delete).toHaveBeenCalledTimes(1);
    expect(accessorFailure.report.takeResultId).not.toHaveBeenCalled();
  });

  it.each([
    "selectedOpeningFaceCount",
    "selectedOpeningFaceIndex",
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
      adoptOcctSolidOffset(options(fixture.module, vi.fn())),
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
        report.operation = 0.5;
      },
      (report) => {
        report.direction = 0.5;
      },
      (report) => {
        report.amount = Number.POSITIVE_INFINITY;
      },
      (report) => {
        report.tolerance = Number.NaN;
      },
      (report) => {
        report.requestedOpeningFaceCount = -1;
      },
      (report) => {
        report.buildCount = -1;
      },
      (report) => {
        report.occtStatus = 0.5;
      },
      (report) => {
        report.failedOpeningFaceIndex = 0.5;
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
        report.direction = 1;
      },
      (report) => {
        report.amount = 3;
      },
      (report) => {
        report.tolerance = 0.02;
      },
      (report) => {
        report.requestedOpeningFaceCount = 1;
      },
      (report) => {
        report.buildCount = 0;
      },
      (report) => {
        report.buildCount = 2;
      },
      (report) => {
        report.occtStatus = -2;
      },
      (report) => {
        report.occtStatus = 1;
      },
      (report) => {
        report.occtStatus = 11;
      },
      (report) => {
        report.failedOpeningFaceIndex = 0;
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

  it("validates failed-report state, OCCT status, and history sentinels", () => {
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
        report.buildCount = 2;
      },
      (report) => {
        report.occtStatus = -2;
      },
      (report) => {
        report.occtStatus = 11;
      },
      (report) => {
        report.failedOpeningFaceIndex = -2;
      },
      (report) => {
        report.failedOpeningFaceIndex = 2;
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
      adoptOcctSolidOffset(
        options(exactModule(sourceProblem).module, vi.fn()),
      ),
    ).toThrow(OcctSolidOffsetOperationError);

    const preBuildFailure = failedReport();
    Object.assign(preBuildFailure, {
      buildCount: 0,
      occtStatus: -1,
      failedOpeningFaceIndex: -1,
      historyProblemDomain: "none",
      historyProblemSourceShapeIndex: -1,
      historyProblemKind: KIND.NONE,
      historyProblemIndex: -1,
    });
    expect(() =>
      adoptOcctSolidOffset(
        options(exactModule(preBuildFailure).module, vi.fn()),
      ),
    ).toThrow(OcctSolidOffsetOperationError);
  });

  it("requires offset reports to echo no opening request or selection", () => {
    const selected = fakeReport("offset");
    selected.selectedOpeningFaceIndices.push(0);
    expectFacadeFailure(
      exactModule(selected),
      options(exactModule(selected).module, vi.fn(), "offset"),
    );

    const requested = fakeReport("offset");
    requested.requestedOpeningFaceCount = 1;
    const fixture = exactModule(requested);
    expectFacadeFailure(
      fixture,
      options(fixture.module, vi.fn(), "offset"),
    );
  });
});

describe("solid-offset exact history and one-shot transfer", () => {
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
      adoptOcctSolidOffset(options(incomplete.module, vi.fn())),
    ).toThrow(TopologyEvolutionProtocolError);
    expect(incomplete.report.transferCode).not.toHaveBeenCalled();
    expect(incomplete.report.takeResultId).not.toHaveBeenCalled();
    expect(incomplete.report.delete).toHaveBeenCalledTimes(1);

    const selectedOutOfRange = exactModule();
    selectedOutOfRange.report.inputCounts[0]!.faces = 0;
    expect(() =>
      adoptOcctSolidOffset(options(selectedOutOfRange.module, vi.fn())),
    ).toThrow("selected opening face index is outside the input topology");
    expect(selectedOutOfRange.report.takeResultId).not.toHaveBeenCalled();
  });

  it("accepts generated, deleted, and source-less created topology", () => {
    const fixture = exactModule();
    const request = options(fixture.module, ({ report }) => report.evolution);

    const evolution = adoptOcctSolidOffset(request);
    expect(
      evolution.records.map((record) => record.relation),
    ).toEqual(
      expect.arrayContaining([
        RELATION.GENERATED,
        RELATION.DELETED,
        RELATION.CREATED,
      ]),
    );
  });

  it("bounds selected-opening access by the request before indexed copying", () => {
    const fixture = exactModule();
    fixture.report.selectedOpeningFaceCount.mockReturnValue(2_147_483_647);
    expectFacadeFailure(fixture);
    expect(fixture.report.selectedOpeningFaceIndex).not.toHaveBeenCalled();
    expect(fixture.report.topologyInputShapeCount).not.toHaveBeenCalled();

    const malformedCount = exactModule();
    malformedCount.report.selectedOpeningFaceCount.mockReturnValue(0.5);
    expectFacadeFailure(malformedCount);
    expect(malformedCount.report.selectedOpeningFaceIndex).not.toHaveBeenCalled();

    const malformedIndex = exactModule();
    malformedIndex.report.selectedOpeningFaceIndices[0] = -1;
    expectFacadeFailure(malformedIndex);
    expect(malformedIndex.report.topologyInputShapeCount).not.toHaveBeenCalled();
  });

  it("enforces the structural graph maximum before record access", () => {
    const fixture = exactModule();
    Object.assign(fixture.report.inputCounts[0]!, {
      faces: 0,
      edges: 0,
      vertices: 0,
    });
    Object.assign(fixture.report.resultCounts, {
      faces: 0,
      edges: 0,
      vertices: 0,
    });
    fixture.report.topologyRecordCount.mockReturnValue(1);

    expect(() =>
      adoptOcctSolidOffset(options(fixture.module, vi.fn())),
    ).toThrow("exceeding the structural solid-offset graph maximum 0");
    expect(fixture.report.topologyRecord).not.toHaveBeenCalled();
    expect(fixture.report.takeResultId).not.toHaveBeenCalled();
  });

  it("enforces the configured record cap before indexed copying", () => {
    const accepted = exactModule();
    const acceptedRequest = {
      ...options(accepted.module, ({ resultId }) => resultId),
      maxHistoryRecords: 7,
    };
    expect(adoptOcctSolidOffset(acceptedRequest)).toBe(91);
    expect(accepted.report.topologyRecord).toHaveBeenCalledTimes(7);
    expect(accepted.module.invariantcadSolidOffsetAtomic).toHaveBeenCalledWith(
      acceptedRequest.kernel,
      0,
      7,
      accepted.vectors[0],
      2.5,
      0,
      0.01,
      7,
    );

    const rejected = exactModule();
    rejected.report.topologyRecordCount.mockReturnValue(8);
    const rejectedRequest = {
      ...options(rejected.module, vi.fn()),
      maxHistoryRecords: 7,
    };
    expect(() => adoptOcctSolidOffset(rejectedRequest)).toThrow(
      "exceeding the configured JavaScript copy limit 7",
    );
    expect(rejected.report.topologyRecord).not.toHaveBeenCalled();
    expect(rejected.report.takeResultId).not.toHaveBeenCalled();
    expect(rejected.report.delete).toHaveBeenCalledTimes(1);
    expect(rejectedRequest.kernel.release).not.toHaveBeenCalled();

    const zeroCap = exactModule();
    const zeroRequest = {
      ...options(zeroCap.module, vi.fn()),
      maxHistoryRecords: 0,
    };
    expect(() => adoptOcctSolidOffset(zeroRequest)).toThrow(
      "configured JavaScript copy limit 0",
    );
    expect(zeroCap.report.topologyRecord).not.toHaveBeenCalled();
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

    expect(() => adoptOcctSolidOffset(request)).toThrow("input count mismatch");
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

      expect(() => adoptOcctSolidOffset(request)).toThrow(
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
    expect(() => adoptOcctSolidOffset(failedRequest)).toThrow("transfer failed");
    expect(failedRequest.kernel.release).not.toHaveBeenCalled();
    expect(transferFailure.report.delete).toHaveBeenCalledTimes(1);

    for (const resultId of [0, -1, 1.5, 4_294_967_296, Number.NaN]) {
      const invalid = exactModule();
      invalid.report.takeResultId.mockReturnValue(resultId);
      const request = options(invalid.module, vi.fn());
      expect(() => adoptOcctSolidOffset(request)).toThrow(
        OcctSolidOffsetFacadeProtocolError,
      );
      expect(request.kernel.release).not.toHaveBeenCalled();
      expect(invalid.report.delete).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects result IDs aliasing the root or any requested opening without release", () => {
    for (const resultId of [7, 11, 12]) {
      const fixture = exactModule();
      fixture.report.takeResultId.mockReturnValue(resultId);
      const request = {
        ...options(fixture.module, vi.fn()),
        openingFaceIds: [11, 12],
      };
      expect(() => adoptOcctSolidOffset(request)).toThrow(
        "aliases an input operand",
      );
      expect(request.adopt).not.toHaveBeenCalled();
      expect(request.kernel.release).not.toHaveBeenCalled();
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    }
  });

  it("releases a transferred result exactly once when adoption throws", () => {
    const fixture = exactModule();
    const request = options(
      fixture.module,
      vi.fn(() => {
        throw new Error("lineage reduction failed");
      }),
    );

    expect(() => adoptOcctSolidOffset(request)).toThrow(
      "lineage reduction failed",
    );
    expect(request.kernel.release).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).toHaveBeenCalledWith(91);
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
  });

  it("releases a transferred result when report cleanup fails before adoption", () => {
    const fixture = exactModule();
    fixture.report.delete.mockImplementationOnce(() => {
      throw new Error("report delete failed");
    });
    const request = options(fixture.module, vi.fn());

    expect(() => adoptOcctSolidOffset(request)).toThrow("report delete failed");
    expect(request.adopt).not.toHaveBeenCalled();
    expect(request.kernel.release).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).toHaveBeenCalledWith(91);
  });

  it("commits ownership only after adoption returns successfully", () => {
    const fixture = exactModule();
    const request = options(fixture.module, ({ resultId, report }) => ({
      resultId,
      transferCode: report.transferCode,
    }));

    expect(adoptOcctSolidOffset(request)).toEqual({
      resultId: 91,
      transferCode: "READY",
    });
    expect(request.kernel.release).not.toHaveBeenCalled();
    expect(fixture.report.takeResultId).toHaveBeenCalledTimes(1);
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
  });
});
