import { describe, expect, it, vi, type Mock } from "vitest";
import {
  INDEXED_TOPOLOGY_KIND as KIND,
  INDEXED_TOPOLOGY_RELATION as RELATION,
  TopologyEvolutionProtocolError,
} from "../src/internal/topology-evolution.js";
import {
  DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT,
  OCCT_BOOLEAN_OPERATION_CODE,
  OcctBooleanFacadeProtocolError,
  OcctBooleanOperationError,
  adoptOcctBoolean,
  type AdoptOcctBooleanOptions,
  type OcctBooleanOperation,
} from "../src/internal/occt-boolean.js";

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
  requestedToolCount: unknown;
  buildCount: unknown;
  failedToolIndex: unknown;
  historyProblemDomain: unknown;
  historyProblemSourceShapeIndex: unknown;
  historyProblemKind: unknown;
  historyProblemIndex: unknown;
  inputCounts: MutableCounts[];
  resultCounts: MutableCounts;
  records: MutableRecord[];
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

function operationBuildCount(
  operation: OcctBooleanOperation,
  toolCount: number,
): number {
  return operation === "subtract" ? 1 : toolCount;
}

function fakeReport(
  operation: OcctBooleanOperation = "union",
  toolCount = 2,
): FakeReport {
  const inputCounts: MutableCounts[] = Array.from(
    { length: toolCount + 1 },
    () => ({ faces: 1, edges: 0, vertices: 0 }),
  );
  const resultCounts: MutableCounts = { faces: 1, edges: 0, vertices: 0 };
  const records: MutableRecord[] = [
    {
      sourceShapeIndex: 0,
      sourceKind: KIND.FACE,
      sourceIndex: 0,
      relation: RELATION.MODIFIED,
      resultKind: KIND.FACE,
      resultIndex: 0,
    },
  ];
  for (let sourceShapeIndex = 1; sourceShapeIndex <= toolCount; sourceShapeIndex += 1) {
    records.push(
      {
        sourceShapeIndex,
        sourceKind: KIND.FACE,
        sourceIndex: 0,
        relation: RELATION.GENERATED,
        resultKind: KIND.FACE,
        resultIndex: 0,
      },
      {
        sourceShapeIndex,
        sourceKind: KIND.FACE,
        sourceIndex: 0,
        relation: RELATION.DELETED,
        resultKind: KIND.NONE,
        resultIndex: -1,
      },
    );
  }
  return {
    ok: true,
    stage: "complete",
    code: "OK",
    message: "Boolean result and exact indexed history are ready",
    operation: OCCT_BOOLEAN_OPERATION_CODE[operation],
    requestedToolCount: toolCount,
    buildCount: operationBuildCount(operation, toolCount),
    failedToolIndex: -1,
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
    topologyInputShapeCount: vi.fn(() => inputCounts.length),
    topologyInputCounts: vi.fn((index: number) => inputCounts[index]),
    topologyResultCounts: vi.fn(() => resultCounts),
    topologyRecordCount: vi.fn(() => records.length),
    topologyRecord: vi.fn((index: number) => records[index]),
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
    invariantcadBooleanAtomic: vi.fn(() => report),
  };
  return { module, report, vectors };
}

function options<T>(
  module: unknown,
  adopt: AdoptOcctBooleanOptions<T>["adopt"],
  operation: OcctBooleanOperation = "union",
): AdoptOcctBooleanOptions<T> & {
  readonly kernel: { readonly release: Mock<(resultId: number) => void> };
} {
  return {
    module,
    kernel: { release: vi.fn() },
    operation,
    targetId: 7,
    toolIds: [11, 12],
    adopt,
  };
}

function failedReport(
  operation: OcctBooleanOperation = "union",
): FakeReport {
  const report = fakeReport(operation);
  Object.assign(report, {
    ok: false,
    stage: "history",
    code: "HISTORY_RESULT_UNCLAIMED",
    message: "result edge has no predecessor",
    buildCount: operationBuildCount(operation, 2),
    failedToolIndex: 1,
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

function expectProtocolFailure(
  fixture: ReturnType<typeof exactModule>,
  request = options(fixture.module, vi.fn()),
): void {
  expect(() => adoptOcctBoolean(request)).toThrow(
    OcctBooleanFacadeProtocolError,
  );
  expect(fixture.report.takeResultId).not.toHaveBeenCalled();
  expect(fixture.report.delete).toHaveBeenCalledTimes(1);
  expect(request.kernel.release).not.toHaveBeenCalled();
}

describe("owned exact OCCT Boolean transaction", () => {
  it.each([
    ["union", 0, 2],
    ["subtract", 1, 1],
    ["intersect", 2, 2],
  ] as const)(
    "passes stable %s operation code %s and validates its build count",
    (operation, code, buildCount) => {
      const report = fakeReport(operation);
      const fixture = exactModule(report);
      const request = options(fixture.module, ({ resultId }) => resultId, operation);

      expect(adoptOcctBoolean(request)).toBe(91);
      expect(report.buildCount).toBe(buildCount);
      expect(fixture.module.invariantcadBooleanAtomic).toHaveBeenCalledWith(
        request.kernel,
        code,
        7,
        fixture.vectors[0],
        DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT,
      );
      expect(fixture.vectors[0]!.values).toEqual([11, 12]);
      expect(fixture.vectors[0]!.delete).toHaveBeenCalledTimes(1);
      expect(report.delete).toHaveBeenCalledTimes(1);
      expect(request.kernel.release).not.toHaveBeenCalled();
    },
  );

  it("copies, freezes, and transfers complete multi-input history before adoption", () => {
    const fixture = exactModule();
    const adopt = vi.fn(({ resultId, report }) => {
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
      expect(resultId).toBe(91);
      expect(report.diagnostics).toEqual({
        ok: true,
        stage: "complete",
        code: "OK",
        message: "Boolean result and exact indexed history are ready",
        operation: 0,
        requestedToolCount: 2,
        buildCount: 2,
        failedToolIndex: -1,
        historyProblemDomain: "none",
        historyProblemSourceShapeIndex: -1,
        historyProblemKind: -1,
        historyProblemIndex: -1,
        hasResult: true,
        topologyHistoryVersion: 1,
        topologyHistoryComplete: true,
      });
      expect(report.evolution.inputShapeCount).toBe(3);
      expect(report.evolution.inputCounts).toHaveLength(3);
      expect(report.evolution.records).toHaveLength(5);
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.diagnostics)).toBe(true);
      expect(Object.isFrozen(report.evolution)).toBe(true);
      expect(Object.isFrozen(report.evolution.inputCounts)).toBe(true);
      expect(Object.isFrozen(report.evolution.inputCounts[0])).toBe(true);
      expect(Object.isFrozen(report.evolution.resultCounts)).toBe(true);
      expect(Object.isFrozen(report.evolution.records)).toBe(true);
      expect(Object.isFrozen(report.evolution.records[0])).toBe(true);
      return "adopted";
    });
    const request = options(fixture.module, adopt);

    expect(adoptOcctBoolean(request)).toBe("adopted");
    expect(fixture.report.topologyInputCounts.mock.calls).toEqual([[0], [1], [2]]);
    expect(fixture.report.topologyRecord).toHaveBeenCalledTimes(5);
    expect(fixture.report.transferCode).toHaveBeenCalledWith(request.kernel);
    expect(fixture.report.takeResultId).toHaveBeenCalledWith(request.kernel);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("isolates the frozen copy from every later native mutation", () => {
    const fixture = exactModule();
    fixture.report.takeResultId.mockImplementationOnce(() => {
      fixture.report.code = "MUTATED";
      fixture.report.inputCounts[0]!.faces = 99;
      fixture.report.resultCounts.faces = 99;
      fixture.report.records[0]!.relation = RELATION.CREATED;
      return 91;
    });
    const request = options(fixture.module, ({ report }) => {
      expect(report.diagnostics.code).toBe("OK");
      expect(report.evolution.inputCounts[0]!.faces).toBe(1);
      expect(report.evolution.resultCounts.faces).toBe(1);
      expect(report.evolution.records[0]!.relation).toBe(RELATION.MODIFIED);
      expect(() => {
        (report.evolution.records[0] as unknown as MutableRecord).relation =
          RELATION.CREATED;
      }).toThrow(TypeError);
      return true;
    });

    expect(adoptOcctBoolean(request)).toBe(true);
  });

  it("preserves every well-formed native failure diagnostic without reading history", () => {
    const report = failedReport();
    const fixture = exactModule(report);
    const request = options(fixture.module, vi.fn());

    let caught: unknown;
    try {
      adoptOcctBoolean(request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(OcctBooleanOperationError);
    expect((caught as OcctBooleanOperationError).diagnostics).toEqual({
      ok: false,
      stage: "history",
      code: "HISTORY_RESULT_UNCLAIMED",
      message: "result edge has no predecessor",
      operation: 0,
      requestedToolCount: 2,
      buildCount: 2,
      failedToolIndex: 1,
      historyProblemDomain: "result",
      historyProblemSourceShapeIndex: -1,
      historyProblemKind: KIND.EDGE,
      historyProblemIndex: 4,
      hasResult: false,
      topologyHistoryVersion: 0,
      topologyHistoryComplete: false,
    });
    expect(Object.isFrozen((caught as OcctBooleanOperationError).diagnostics)).toBe(
      true,
    );
    expect(report.topologyInputShapeCount).not.toHaveBeenCalled();
    expect(report.transferCode).not.toHaveBeenCalled();
    expect(report.takeResultId).not.toHaveBeenCalled();
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it.each([
    ["null module", null],
    ["missing vector", { invariantcadBooleanAtomic: vi.fn() }],
    ["missing global", { VectorUint32: FakeVector }],
  ])("rejects a structurally invalid %s before allocation", (_label, module) => {
    expect(() => adoptOcctBoolean(options(module, vi.fn()))).toThrow(
      OcctBooleanFacadeProtocolError,
    );
  });

  it.each(["xor", "", 0, null])(
    "rejects invalid operation %j before allocation",
    (operation) => {
      const fixture = exactModule();
      const request = {
        ...options(fixture.module, vi.fn()),
        operation: operation as OcctBooleanOperation,
      };
      expect(() => adoptOcctBoolean(request)).toThrow("operation must be");
      expect(fixture.vectors).toHaveLength(0);
      expect(fixture.module.invariantcadBooleanAtomic).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed target/tool IDs and empty/non-array tools before allocation", () => {
    for (const targetId of [-1, 1.5, 4_294_967_296, Number.NaN]) {
      const fixture = exactModule();
      const request = { ...options(fixture.module, vi.fn()), targetId };
      expect(() => adoptOcctBoolean(request)).toThrow("unsigned 32-bit integer");
      expect(fixture.vectors).toHaveLength(0);
    }
    for (const toolIds of [
      [-1],
      [1.5],
      [4_294_967_296],
      [Number.NaN],
      [],
      {} as unknown as number[],
    ]) {
      const fixture = exactModule();
      const request = { ...options(fixture.module, vi.fn()), toolIds };
      expect(() => adoptOcctBoolean(request)).toThrow(
        OcctBooleanFacadeProtocolError,
      );
      expect(fixture.vectors).toHaveLength(0);
      expect(fixture.module.invariantcadBooleanAtomic).not.toHaveBeenCalled();
    }
  });

  it("deletes the tool vector when push or invocation fails", () => {
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
    expect(() => adoptOcctBoolean(options(pushFailure.module, vi.fn()))).toThrow(
      "push failed",
    );
    expect(pushFailure.vectors[0]!.delete).toHaveBeenCalledTimes(1);

    const invokeFailure = exactModule();
    invokeFailure.module.invariantcadBooleanAtomic.mockImplementationOnce(() => {
      throw new Error("invoke failed");
    });
    expect(() => adoptOcctBoolean(options(invokeFailure.module, vi.fn()))).toThrow(
      "invoke failed",
    );
    expect(invokeFailure.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(invokeFailure.report.delete).not.toHaveBeenCalled();
  });

  it("deletes a returned report even when vector cleanup or another report method fails", () => {
    const vectorFailure = exactModule();
    vectorFailure.module.VectorUint32 = class extends FakeVector {
      constructor() {
        super();
        this.delete.mockImplementationOnce(() => {
          throw new Error("vector delete failed");
        });
        vectorFailure.vectors.push(this);
      }
    };
    expect(() => adoptOcctBoolean(options(vectorFailure.module, vi.fn()))).toThrow(
      "vector delete failed",
    );
    expect(vectorFailure.report.delete).toHaveBeenCalledTimes(1);

    const accessorFailure = exactModule();
    accessorFailure.report.topologyResultCounts.mockImplementationOnce(() => {
      throw new Error("counts failed");
    });
    expect(() => adoptOcctBoolean(options(accessorFailure.module, vi.fn()))).toThrow(
      "counts failed",
    );
    expect(accessorFailure.report.delete).toHaveBeenCalledTimes(1);
    expect(accessorFailure.report.takeResultId).not.toHaveBeenCalled();
  });

  it.each([
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
  ] as const)("rejects malformed report accessor %s and deletes the report", (method) => {
    const fixture = exactModule();
    (fixture.report as unknown as Record<string, unknown>)[method] = undefined;
    expect(() => adoptOcctBoolean(options(fixture.module, vi.fn()))).toThrow(
      `report.${method} must be a function`,
    );
    expect(fixture.vectors[0]!.delete).toHaveBeenCalledTimes(1);
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-deletable or non-object report without attempting transfer", () => {
    for (const rawReport of [null, {}, { delete: 1 }]) {
      const fixture = exactModule();
      fixture.module.invariantcadBooleanAtomic.mockReturnValueOnce(
        rawReport as unknown as FakeReport,
      );
      expect(() => adoptOcctBoolean(options(fixture.module, vi.fn()))).toThrow(
        OcctBooleanFacadeProtocolError,
      );
      expect(fixture.vectors[0]!.delete).toHaveBeenCalledTimes(1);
      expect(fixture.report.takeResultId).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["ok", "yes"],
    ["stage", 1],
    ["code", null],
    ["message", false],
    ["operation", 0.5],
    ["requestedToolCount", -1],
    ["buildCount", Number.NaN],
    ["failedToolIndex", 2.5],
    ["historyProblemDomain", 1],
    ["historyProblemSourceShapeIndex", 0.5],
    ["historyProblemKind", 0.5],
    ["historyProblemIndex", 0.5],
  ])("rejects malformed report field %s before transfer", (field, value) => {
    const fixture = exactModule();
    (fixture.report as unknown as Record<string, unknown>)[field] = value;
    expectProtocolFailure(fixture);
  });

  it.each([
    ["hasResult", "yes"],
    ["topologyHistoryVersion", 1.5],
    ["topologyHistoryComplete", 1],
  ] as const)("rejects malformed %s accessor return", (method, value) => {
    const fixture = exactModule();
    (fixture.report[method] as Mock).mockReturnValue(value);
    expectProtocolFailure(fixture);
  });

  it("rejects every successful-report semantic contradiction before history transfer", () => {
    const contradictions: Array<(report: FakeReport) => void> = [
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
        report.requestedToolCount = 1;
      },
      (report) => {
        report.buildCount = 1;
      },
      (report) => {
        report.buildCount = 3;
      },
      (report) => {
        report.failedToolIndex = 0;
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
        report.historyProblemKind = KIND.FACE;
        report.historyProblemIndex = 0;
      },
      (report) => {
        report.historyProblemSourceShapeIndex = 0;
      },
      (report) => {
        report.historyProblemKind = KIND.FACE;
      },
      (report) => {
        report.historyProblemIndex = 0;
      },
    ];
    for (const contradict of contradictions) {
      const fixture = exactModule();
      contradict(fixture.report);
      expectProtocolFailure(fixture);
      expect(fixture.report.topologyInputShapeCount).not.toHaveBeenCalled();
    }
  });

  it("accepts indexed and domain-level source/result failures and rejects every bad sentinel", () => {
    const validSource = failedReport();
    Object.assign(validSource, {
      historyProblemDomain: "source",
      historyProblemSourceShapeIndex: 2,
      historyProblemKind: KIND.VERTEX,
      historyProblemIndex: 3,
    });
    const sourceFixture = exactModule(validSource);
    expect(() => adoptOcctBoolean(options(sourceFixture.module, vi.fn()))).toThrow(
      OcctBooleanOperationError,
    );

    for (const historyProblemDomain of ["source", "result"] as const) {
      const domainLevel = failedReport();
      Object.assign(domainLevel, {
        code: "HISTORY_MAP_NATIVE_EXCEPTION",
        historyProblemDomain,
        historyProblemSourceShapeIndex:
          historyProblemDomain === "source" ? 1 : -1,
        historyProblemKind: KIND.EDGE,
        historyProblemIndex: -1,
      });
      const fixture = exactModule(domainLevel);
      expect(() => adoptOcctBoolean(options(fixture.module, vi.fn()))).toThrow(
        OcctBooleanOperationError,
      );
    }

    const badLocations: Array<(report: FakeReport) => void> = [
      (report) => {
        report.historyProblemDomain = "future";
      },
      (report) => {
        report.historyProblemDomain = "source";
        report.historyProblemSourceShapeIndex = -1;
        report.historyProblemKind = KIND.FACE;
        report.historyProblemIndex = 0;
      },
      (report) => {
        report.historyProblemDomain = "source";
        report.historyProblemSourceShapeIndex = 3;
        report.historyProblemKind = KIND.FACE;
        report.historyProblemIndex = 0;
      },
      (report) => {
        report.historyProblemDomain = "result";
        report.historyProblemSourceShapeIndex = 0;
        report.historyProblemKind = KIND.FACE;
        report.historyProblemIndex = 0;
      },
      (report) => {
        report.historyProblemDomain = "result";
        report.historyProblemSourceShapeIndex = -1;
        report.historyProblemKind = KIND.NONE;
        report.historyProblemIndex = 0;
      },
      (report) => {
        report.historyProblemDomain = "result";
        report.historyProblemSourceShapeIndex = -1;
        report.historyProblemKind = KIND.FACE;
        report.historyProblemIndex = -2;
      },
    ];
    for (const mutate of badLocations) {
      const report = failedReport();
      mutate(report);
      expectProtocolFailure(exactModule(report));
    }
  });

  it("rejects every failed-report contradiction before operation error", () => {
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
        report.buildCount = 3;
      },
      (report) => {
        report.failedToolIndex = -2;
      },
      (report) => {
        report.failedToolIndex = 2;
      },
    ];
    for (const contradict of contradictions) {
      const report = failedReport();
      contradict(report);
      expectProtocolFailure(exactModule(report));
    }
  });

  it.each([
    ["input shape count", "topologyInputShapeCount", 2],
    ["fractional input shape count", "topologyInputShapeCount", 3.5],
    ["oversized input shape count", "topologyInputShapeCount", 2_147_483_648],
    ["negative record count", "topologyRecordCount", -1],
    ["fractional record count", "topologyRecordCount", 1.5],
    ["structurally impossible record count", "topologyRecordCount", 8],
    ["unsafe signed-int32 record count", "topologyRecordCount", 2_147_483_647],
    ["oversized record count", "topologyRecordCount", 2_147_483_648],
  ] as const)("rejects malformed %s before indexed access", (_label, method, value) => {
    const fixture = exactModule();
    fixture.report[method].mockReturnValue(value);
    expectProtocolFailure(fixture);
    if (method === "topologyInputShapeCount") {
      expect(fixture.report.topologyInputCounts).not.toHaveBeenCalled();
    } else {
      expect(fixture.report.topologyRecord).not.toHaveBeenCalled();
    }
  });

  it("caps structurally plausible history before copying indexed records", () => {
    const fixture = exactModule();
    for (const counts of fixture.report.inputCounts) counts.faces = 1_000;
    fixture.report.resultCounts.faces = 1_000;
    fixture.report.topologyRecordCount.mockReturnValue(1_000_001);
    const request = options(fixture.module, vi.fn());

    expect(() => adoptOcctBoolean(request)).toThrow(
      "exceeding the configured JavaScript copy limit 1000000",
    );
    expect(fixture.report.topologyRecord).not.toHaveBeenCalled();
    expect(fixture.report.takeResultId).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("accepts the configured record limit boundary and rejects limit plus one", () => {
    const accepted = exactModule();
    const acceptedRequest = {
      ...options(accepted.module, ({ resultId }) => resultId),
      maxHistoryRecords: 5,
    };
    expect(adoptOcctBoolean(acceptedRequest)).toBe(91);
    expect(accepted.report.topologyRecord).toHaveBeenCalledTimes(5);

    const rejected = exactModule();
    const rejectedRequest = {
      ...options(rejected.module, vi.fn()),
      maxHistoryRecords: 4,
    };
    expect(() => adoptOcctBoolean(rejectedRequest)).toThrow(
      "exceeding the configured JavaScript copy limit 4",
    );
    expect(rejected.report.topologyRecord).not.toHaveBeenCalled();
    expect(rejected.report.takeResultId).not.toHaveBeenCalled();
    expect(rejected.report.delete).toHaveBeenCalledTimes(1);
  });

  it.each(["faces", "edges", "vertices"] as const)(
    "rejects malformed input and result %s counts",
    (field) => {
      for (const value of [-1, 0.5, 2_147_483_648, "1"]) {
        const input = exactModule();
        input.report.inputCounts[1]![field] = value;
        expectProtocolFailure(input);

        const result = exactModule();
        result.report.resultCounts[field] = value;
        expectProtocolFailure(result);
      }
    },
  );

  it.each([
    "sourceShapeIndex",
    "sourceKind",
    "sourceIndex",
    "relation",
    "resultKind",
    "resultIndex",
  ] as const)("rejects a malformed signed-int32 record field %s", (field) => {
    for (const value of [0.5, 2_147_483_648, Number.NaN, "0"]) {
      const fixture = exactModule();
      fixture.report.records[0]![field] = value;
      expectProtocolFailure(fixture);
    }
  });

  it("accepts source-less CREATED for an otherwise-unclaimed Boolean result", () => {
    const report = fakeReport();
    const records = [
      ...report.inputCounts.map((_counts, sourceShapeIndex) => ({
        sourceShapeIndex,
        sourceKind: KIND.FACE,
        sourceIndex: 0,
        relation: RELATION.DELETED,
        resultKind: KIND.NONE,
        resultIndex: -1,
      })),
      {
        sourceShapeIndex: -1,
        sourceKind: KIND.NONE,
        sourceIndex: -1,
        relation: RELATION.CREATED,
        resultKind: KIND.FACE,
        resultIndex: 0,
      },
    ];
    report.records.splice(0, report.records.length, ...records);
    const fixture = exactModule(report);

    expect(
      adoptOcctBoolean(
        options(fixture.module, ({ report: snapshot }) =>
          snapshot.evolution.records.some(
            (record) => record.relation === RELATION.CREATED,
          ),
        ),
      ),
    ).toBe(true);
  });

  it("rejects invalid endpoint sentinels, mixed CREATED, and incomplete coverage", () => {
    const invalidRecords: Array<(report: FakeReport) => void> = [
      (report) => {
        const deleted = report.records.find(
          (record) => record.relation === RELATION.DELETED,
        )!;
        deleted.resultKind = KIND.FACE;
      },
      (report) => {
        const deleted = report.records.find(
          (record) => record.relation === RELATION.DELETED,
        )!;
        deleted.resultIndex = 0;
      },
      (report) => {
        report.records[0] = {
          sourceShapeIndex: -1,
          sourceKind: KIND.NONE,
          sourceIndex: -1,
          relation: RELATION.CREATED,
          resultKind: KIND.FACE,
          resultIndex: 0,
        };
      },
      (report) => {
        report.records.shift();
      },
      (report) => {
        report.records[0]!.sourceShapeIndex = -1;
      },
      (report) => {
        report.records[0]!.resultKind = KIND.NONE;
      },
    ];
    for (const mutate of invalidRecords) {
      const fixture = exactModule();
      mutate(fixture.report);
      expect(() => adoptOcctBoolean(options(fixture.module, vi.fn()))).toThrow(
        TopologyEvolutionProtocolError,
      );
      expect(fixture.report.transferCode).not.toHaveBeenCalled();
      expect(fixture.report.takeResultId).not.toHaveBeenCalled();
      expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    }
  });

  it("runs caller validation after READY but before one-shot transfer", () => {
    const fixture = exactModule();
    const adopt = vi.fn();
    const validate = vi.fn((snapshot) => {
      expect(snapshot.transferCode).toBe("READY");
      expect(fixture.report.transferCode).toHaveBeenCalledTimes(1);
      expect(fixture.report.takeResultId).not.toHaveBeenCalled();
      throw new Error("raw count mismatch");
    });
    const request = { ...options(fixture.module, adopt), validate };

    expect(() => adoptOcctBoolean(request)).toThrow("raw count mismatch");
    expect(validate).toHaveBeenCalledTimes(1);
    expect(adopt).not.toHaveBeenCalled();
    expect(fixture.report.takeResultId).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("requires READY from and transfers through the same kernel exactly once", () => {
    const fixture = exactModule();
    const request = options(fixture.module, ({ resultId }) => resultId);
    expect(adoptOcctBoolean(request)).toBe(91);
    expect(fixture.report.transferCode).toHaveBeenCalledTimes(1);
    expect(fixture.report.transferCode).toHaveBeenCalledWith(request.kernel);
    expect(fixture.report.takeResultId).toHaveBeenCalledTimes(1);
    expect(fixture.report.takeResultId).toHaveBeenCalledWith(request.kernel);

    const wrongKernel = exactModule();
    wrongKernel.report.transferCode.mockReturnValue("WRONG_KERNEL");
    const wrongRequest = options(wrongKernel.module, vi.fn());
    expect(() => adoptOcctBoolean(wrongRequest)).toThrow(
      "transfer state is 'WRONG_KERNEL'",
    );
    expect(wrongKernel.report.takeResultId).not.toHaveBeenCalled();
    expect(wrongKernel.report.delete).toHaveBeenCalledTimes(1);
    expect(wrongRequest.kernel.release).not.toHaveBeenCalled();
  });

  it("does not release when transfer throws or returns an invalid result ID", () => {
    const transferFailure = exactModule();
    transferFailure.report.takeResultId.mockImplementationOnce(() => {
      throw new Error("transfer failed");
    });
    const failedRequest = options(transferFailure.module, vi.fn());
    expect(() => adoptOcctBoolean(failedRequest)).toThrow("transfer failed");
    expect(failedRequest.kernel.release).not.toHaveBeenCalled();
    expect(transferFailure.report.delete).toHaveBeenCalledTimes(1);

    for (const resultId of [0, -1, 1.5, 4_294_967_296]) {
      const invalid = exactModule();
      invalid.report.takeResultId.mockReturnValue(resultId);
      const request = options(invalid.module, vi.fn());
      expect(() => adoptOcctBoolean(request)).toThrow(
        OcctBooleanFacadeProtocolError,
      );
      expect(request.kernel.release).not.toHaveBeenCalled();
      expect(invalid.report.delete).toHaveBeenCalledTimes(1);
    }

    for (const resultId of [7, 11, 12]) {
      const alias = exactModule();
      alias.report.takeResultId.mockReturnValue(resultId);
      const request = options(alias.module, vi.fn());
      expect(() => adoptOcctBoolean(request)).toThrow(
        "operand-aliasing result ID",
      );
      expect(request.adopt).not.toHaveBeenCalled();
      expect(request.kernel.release).not.toHaveBeenCalled();
      expect(alias.report.delete).toHaveBeenCalledTimes(1);
    }
  });

  it("releases a transferred result exactly once when adoption or report cleanup throws", () => {
    const adoptionFailure = exactModule();
    const failedRequest = options(adoptionFailure.module, vi.fn(() => {
      throw new Error("reduction failed");
    }));
    expect(() => adoptOcctBoolean(failedRequest)).toThrow("reduction failed");
    expect(failedRequest.kernel.release).toHaveBeenCalledTimes(1);
    expect(failedRequest.kernel.release).toHaveBeenCalledWith(91);
    expect(adoptionFailure.report.delete).toHaveBeenCalledTimes(1);

    const cleanupFailure = exactModule();
    cleanupFailure.report.delete.mockImplementationOnce(() => {
      throw new Error("report delete failed");
    });
    const cleanupRequest = options(cleanupFailure.module, vi.fn());
    expect(() => adoptOcctBoolean(cleanupRequest)).toThrow("report delete failed");
    expect(cleanupRequest.kernel.release).toHaveBeenCalledTimes(1);
    expect(cleanupRequest.kernel.release).toHaveBeenCalledWith(91);
  });
});
