import { describe, expect, it, vi } from "vitest";
import {
  OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
  OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER,
  OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH,
  OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS,
  OcctArtifactFacadeProtocolError,
  OcctArtifactReadError,
  OcctArtifactWriteError,
  readBoundedOcctArtifactBrep,
  writeBoundedOcctArtifactBrep,
  type OcctArtifactReadRawReport,
  type OcctArtifactWriteRawReport,
} from "../src/internal/occt-artifact-facade.js";

const nativeRequestFields = Object.freeze({
  maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
  nativeRequestedBytes: 65_536,
  nativeAllocationCalls: 12,
  nativeRequestLimitExceeded: false,
});

const preflightLimits = Object.freeze({
  maxPreflightWorkUnits: OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS,
  maxPreflightNestingDepth: OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH,
  maxPreflightLocationPower: OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER,
});

const successfulPreflightFields = Object.freeze({
  ...preflightLimits,
  preflightWorkUnits: 73,
  preflightMaximumDepth: 9,
  preflightMaximumLocationPower: 4,
  preflightConsumedByteCount: 4,
  preflightCode: "OK",
  archivePreflightComplete: true,
  deserializationStarted: true,
});

const preflightFieldNames = Object.freeze(
  Object.keys(successfulPreflightFields),
);

function installThrowingGetters(
  report: object,
  fields: readonly string[],
  abi: string,
): void {
  for (const field of fields) {
    Object.defineProperty(report, field, {
      get: () => {
        throw new Error(`unexpected ABI ${abi} field read: ${field}`);
      },
    });
  }
}

function writeFixture(
  overrides: Partial<OcctArtifactWriteRawReport> = {},
): {
  readonly module: Record<string, unknown>;
  readonly report: OcctArtifactWriteRawReport;
  readonly invoke: ReturnType<typeof vi.fn>;
} {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const report: OcctArtifactWriteRawReport = {
    ok: true,
    stage: "complete",
    code: "OK",
    message: "done",
    maxOutputBytes: 16,
    hasBytes: vi.fn(() => true),
    byteCount: vi.fn(() => bytes.byteLength),
    copyBytes: vi.fn(() => bytes),
    delete: vi.fn(),
    ...overrides,
  };
  const invoke = vi.fn(() => report);
  return {
    module: {
      InvariantCadArtifactWriteReport: class {},
      InvariantCadArtifactReadReport: class {},
      invariantcadWriteArtifactBrep: invoke,
      invariantcadReadArtifactBrep: vi.fn(),
    },
    report,
    invoke,
  };
}

function readFixture(options: {
  readonly resultId?: number;
  readonly postTransferCode?: string;
  readonly overrides?: Partial<OcctArtifactReadRawReport>;
} = {}): {
  readonly module: Record<string, unknown>;
  readonly report: OcctArtifactReadRawReport;
  readonly invoke: ReturnType<typeof vi.fn>;
  readonly take: ReturnType<typeof vi.fn>;
} {
  let transferred = false;
  const take = vi.fn(() => {
    transferred = true;
    return options.resultId ?? 41;
  });
  const report: OcctArtifactReadRawReport = {
    ok: true,
    stage: "complete",
    code: "OK",
    message: "done",
    inputByteCount: 4,
    maxInputBytes: 16,
    consumedByteCount: 4,
    topologyItemCount: 7,
    maxTopologyItems: 100,
    hasResult: vi.fn(() => !transferred),
    transferCode: vi.fn(() =>
      transferred
        ? (options.postTransferCode ?? "ALREADY_TRANSFERRED")
        : "READY",
    ),
    takeResultId: take,
    delete: vi.fn(),
    ...options.overrides,
  };
  const invoke = vi.fn(() => report);
  return {
    module: {
      InvariantCadArtifactWriteReport: class {},
      InvariantCadArtifactReadReport: class {},
      invariantcadWriteArtifactBrep: vi.fn(),
      invariantcadReadArtifactBrep: invoke,
    },
    report,
    invoke,
    take,
  };
}

describe("bounded OCCT artifact facade adapter", () => {
  it("copies successful capped output before deleting its native report", () => {
    const fixture = writeFixture();
    const kernel = { release: vi.fn() };

    const output = writeBoundedOcctArtifactBrep({
      module: fixture.module,
      kernel,
      shapeId: 9,
      maxOutputBytes: 16,
    });

    expect(output).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(fixture.invoke).toHaveBeenCalledWith(kernel, 9, 16);
    expect(fixture.report.copyBytes).toHaveBeenCalledOnce();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
    const native = (fixture.report.copyBytes as ReturnType<typeof vi.fn>)
      .mock.results[0]!.value as Uint8Array;
    native[0] = 99;
    expect(output[0]).toBe(1);
  });

  it("keeps ABI 0.7 reports and native call arity independent of 0.8 fields", () => {
    const fixture = writeFixture();
    for (const field of Object.keys(nativeRequestFields)) {
      Object.defineProperty(fixture.report, field, {
        get: () => {
          throw new Error(`unexpected ABI 0.8 field read: ${field}`);
        },
      });
    }
    const kernel = { release: vi.fn() };

    expect(
      writeBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel,
        shapeId: 9,
        maxOutputBytes: 16,
      }),
    ).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(fixture.invoke).toHaveBeenCalledWith(kernel, 9, 16);
  });

  it("passes and validates the trailing ABI 0.8 write budget", () => {
    const fixture = writeFixture(nativeRequestFields);
    const kernel = { release: vi.fn() };

    expect(
      writeBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel,
        shapeId: 9,
        maxOutputBytes: 16,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
      }),
    ).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(fixture.invoke).toHaveBeenCalledWith(
      kernel,
      9,
      16,
      OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
    );
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("preserves native write diagnostics and deletes failed reports", () => {
    const fixture = writeFixture({
      ok: false,
      stage: "serialization",
      code: "OUTPUT_LIMIT_EXCEEDED",
      message: "too large",
      maxOutputBytes: 16,
      hasBytes: vi.fn(() => false),
      byteCount: vi.fn(() => 0),
    });

    expect(() =>
      writeBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        shapeId: 9,
        maxOutputBytes: 16,
      }),
    ).toThrow(OcctArtifactWriteError);
    expect(fixture.report.copyBytes).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("propagates ABI 0.8 native request diagnostics on write failure", () => {
    const fixture = writeFixture({
      ...nativeRequestFields,
      ok: false,
      stage: "serialization",
      code: "NATIVE_REQUEST_LIMIT_EXCEEDED",
      message: "native request budget exceeded",
      nativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES - 32,
      nativeAllocationCalls: 19,
      nativeRequestLimitExceeded: true,
      hasBytes: vi.fn(() => false),
      byteCount: vi.fn(() => 0),
    });
    let caught: unknown;

    try {
      writeBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        shapeId: 9,
        maxOutputBytes: 16,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OcctArtifactWriteError);
    expect((caught as OcctArtifactWriteError).diagnostics).toMatchObject({
      maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
      nativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES - 32,
      nativeAllocationCalls: 19,
      nativeRequestLimitExceeded: true,
    });
    expect(Object.isFrozen((caught as OcctArtifactWriteError).diagnostics)).toBe(
      true,
    );
    expect(fixture.report.copyBytes).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("aggregates write validation and report cleanup failures", () => {
    const cleanup = new Error("delete failed");
    const fixture = writeFixture({
      maxOutputBytes: 15,
      delete: vi.fn(() => {
        throw cleanup;
      }),
    });

    expect(() =>
      writeBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        shapeId: 9,
        maxOutputBytes: 16,
      }),
    ).toThrow(AggregateError);
  });

  it("preserves an undefined write failure instead of treating it as success", () => {
    const fixture = writeFixture({
      copyBytes: vi.fn(() => {
        throw undefined;
      }),
    });
    let caught = false;
    try {
      writeBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        shapeId: 9,
        maxOutputBytes: 16,
      });
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("keeps ABI 0.7 read arity independent of every ABI 0.9 field", () => {
    const fixture = readFixture();
    installThrowingGetters(fixture.report, preflightFieldNames, "0.9");
    const kernel = { release: vi.fn() };
    const backing = new Uint8Array([90, 1, 2, 3, 4, 91]);
    const input = backing.subarray(1, 5);

    const result = readBoundedOcctArtifactBrep({
      module: fixture.module,
      kernel,
      input,
      maxInputBytes: 16,
      maxTopologyItems: 100,
    });

    expect(result).toBe(41);
    expect(fixture.invoke).toHaveBeenCalledWith(kernel, input, 16, 100);
    expect(fixture.invoke.mock.calls[0]).toHaveLength(4);
    expect(fixture.take).toHaveBeenCalledOnce();
    expect(kernel.release).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
    expect(backing).toEqual(new Uint8Array([90, 1, 2, 3, 4, 91]));
  });

  it("passes and validates the trailing ABI 0.8 read budget", () => {
    const fixture = readFixture({ overrides: nativeRequestFields });
    installThrowingGetters(fixture.report, preflightFieldNames, "0.9");
    const kernel = { release: vi.fn() };
    const input = new Uint8Array([1, 2, 3, 4]);

    expect(
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel,
        input,
        maxInputBytes: 16,
        maxTopologyItems: 100,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
      }),
    ).toBe(41);
    expect(fixture.invoke).toHaveBeenCalledWith(
      kernel,
      input,
      16,
      100,
      OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
    );
    expect(fixture.invoke.mock.calls[0]).toHaveLength(5);
    expect(fixture.take).toHaveBeenCalledOnce();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("dispatches ABI 0.9 with exactly eight arguments and accepts complete telemetry", () => {
    const fixture = readFixture({
      overrides: {
        ...nativeRequestFields,
        ...successfulPreflightFields,
      },
    });
    const kernel = { release: vi.fn() };
    const input = new Uint8Array([1, 2, 3, 4]);

    expect(
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel,
        input,
        maxInputBytes: 16,
        maxTopologyItems: 100,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
        ...preflightLimits,
      }),
    ).toBe(41);
    expect(fixture.invoke).toHaveBeenCalledWith(
      kernel,
      input,
      16,
      100,
      OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
      OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS,
      OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH,
      OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER,
    );
    expect(fixture.invoke.mock.calls[0]).toHaveLength(8);
    expect(fixture.take).toHaveBeenCalledOnce();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("preserves ABI 0.9 preflight failure telemetry without starting OCCT", () => {
    const fixture = readFixture({
      overrides: {
        ...nativeRequestFields,
        ...successfulPreflightFields,
        ok: false,
        stage: "preflight",
        code: "WORK_LIMIT_EXCEEDED",
        message: "preflight work budget exceeded",
        consumedByteCount: 0,
        topologyItemCount: 0,
        preflightWorkUnits: OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS,
        preflightConsumedByteCount: 3,
        preflightCode: "WORK_LIMIT_EXCEEDED",
        archivePreflightComplete: false,
        deserializationStarted: false,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
    });
    let caught: unknown;

    try {
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        input: new Uint8Array([1, 2, 3, 4]),
        maxInputBytes: 16,
        maxTopologyItems: 100,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
        ...preflightLimits,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OcctArtifactReadError);
    expect((caught as OcctArtifactReadError).diagnostics).toMatchObject({
      ok: false,
      stage: "preflight",
      code: "WORK_LIMIT_EXCEEDED",
      maxPreflightWorkUnits: OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS,
      preflightWorkUnits: OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS,
      maxPreflightNestingDepth: OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH,
      preflightMaximumDepth: 9,
      maxPreflightLocationPower: OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER,
      preflightMaximumLocationPower: 4,
      preflightConsumedByteCount: 3,
      preflightCode: "WORK_LIMIT_EXCEEDED",
      archivePreflightComplete: false,
      deserializationStarted: false,
    });
    expect(Object.isFrozen((caught as OcctArtifactReadError).diagnostics)).toBe(
      true,
    );
    expect(fixture.take).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("does not transfer failed decode reports", () => {
    const fixture = readFixture({
      overrides: {
        ok: false,
        stage: "deserialization",
        code: "UNSUPPORTED_ARCHIVE",
        message: "bad",
        consumedByteCount: 0,
        topologyItemCount: 0,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
    });

    expect(() =>
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
      }),
    ).toThrow(OcctArtifactReadError);
    expect(fixture.take).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("propagates ABI 0.8 native request diagnostics on read failure", () => {
    const fixture = readFixture({
      overrides: {
        ...nativeRequestFields,
        ok: false,
        stage: "deserialization",
        code: "NATIVE_REQUEST_LIMIT_EXCEEDED",
        message: "native request budget exceeded",
        consumedByteCount: 0,
        topologyItemCount: 0,
        nativeRequestedBytes: 8_192,
        nativeAllocationCalls: 3,
        nativeRequestLimitExceeded: true,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
    });
    let caught: unknown;

    try {
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OcctArtifactReadError);
    expect((caught as OcctArtifactReadError).diagnostics).toMatchObject({
      maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
      nativeRequestedBytes: 8_192,
      nativeAllocationCalls: 3,
      nativeRequestLimitExceeded: true,
    });
    expect(fixture.take).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("rejects a read exceeded flag without the native request limit code", () => {
    const fixture = readFixture({
      overrides: {
        ...nativeRequestFields,
        ok: false,
        code: "DESERIALIZATION_FAILED",
        nativeRequestLimitExceeded: true,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
    });

    expect(() =>
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
      }),
    ).toThrow(OcctArtifactFacadeProtocolError);
    expect(fixture.take).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it.each<
    readonly [
      string,
      Partial<{
        readonly maxPreflightWorkUnits: number;
        readonly maxPreflightNestingDepth: number;
        readonly maxPreflightLocationPower: number;
      }>,
    ]
  >([
    [
      "work only",
      { maxPreflightWorkUnits: OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS },
    ],
    [
      "depth only",
      {
        maxPreflightNestingDepth:
          OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH,
      },
    ],
    [
      "location power only",
      {
        maxPreflightLocationPower:
          OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER,
      },
    ],
    [
      "work and depth",
      {
        maxPreflightWorkUnits: OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS,
        maxPreflightNestingDepth:
          OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH,
      },
    ],
    [
      "work and location power",
      {
        maxPreflightWorkUnits: OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS,
        maxPreflightLocationPower:
          OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER,
      },
    ],
    [
      "depth and location power",
      {
        maxPreflightNestingDepth:
          OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH,
        maxPreflightLocationPower:
          OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER,
      },
    ],
  ])("rejects partial ABI 0.9 limits before native work: %s", (_label, limits) => {
    const fixture = readFixture();

    expect(() =>
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
        ...limits,
      }),
    ).toThrow("preflight limits must be supplied together");
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it("requires the ABI 0.8 native budget when enabling ABI 0.9 preflight", () => {
    const fixture = readFixture();

    expect(() =>
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
        ...preflightLimits,
      }),
    ).toThrow("preflight limits require maxNativeRequestedBytes");
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it.each<
    readonly [
      string,
      {
        readonly maxPreflightWorkUnits: number;
        readonly maxPreflightNestingDepth: number;
        readonly maxPreflightLocationPower: number;
      },
    ]
  >([
    [
      "zero work",
      { ...preflightLimits, maxPreflightWorkUnits: 0 },
    ],
    [
      "fractional work",
      { ...preflightLimits, maxPreflightWorkUnits: 1.5 },
    ],
    [
      "work above signed 32-bit",
      { ...preflightLimits, maxPreflightWorkUnits: 2_147_483_648 },
    ],
    [
      "zero depth",
      { ...preflightLimits, maxPreflightNestingDepth: 0 },
    ],
    [
      "depth above the parser hard cap",
      {
        ...preflightLimits,
        maxPreflightNestingDepth:
          OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH + 1,
      },
    ],
    [
      "zero location power",
      { ...preflightLimits, maxPreflightLocationPower: 0 },
    ],
    [
      "location power above signed 32-bit",
      { ...preflightLimits, maxPreflightLocationPower: 2_147_483_648 },
    ],
  ])("rejects invalid ABI 0.9 limits before native work: %s", (_label, limits) => {
    const fixture = readFixture();

    expect(() =>
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
        ...limits,
      }),
    ).toThrow(RangeError);
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it.each<
    readonly [string, Partial<OcctArtifactReadRawReport>, string]
  >([
    [
      "unechoed work cap",
      {
        maxPreflightWorkUnits:
          OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS - 1,
      },
      "report preflight limits do not echo the request",
    ],
    [
      "unechoed depth cap",
      {
        maxPreflightNestingDepth:
          OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH - 1,
      },
      "report preflight limits do not echo the request",
    ],
    [
      "unechoed location-power cap",
      {
        maxPreflightLocationPower:
          OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER - 1,
      },
      "report preflight limits do not echo the request",
    ],
    [
      "work counter above its cap",
      {
        preflightWorkUnits:
          OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS + 1,
      },
      "report preflight counters exceed their limits",
    ],
    [
      "depth counter above its cap",
      {
        preflightMaximumDepth:
          OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH + 1,
      },
      "report preflight counters exceed their limits",
    ],
    [
      "location-power counter above its cap",
      {
        preflightMaximumLocationPower:
          OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER + 1,
      },
      "report preflight counters exceed their limits",
    ],
    [
      "complete flag paired with a failure code",
      {
        preflightCode: "TRUNCATED",
        archivePreflightComplete: true,
      },
      "report preflight completion must exactly match report.preflightCode",
    ],
    [
      "incomplete flag paired with OK",
      {
        preflightCode: "OK",
        archivePreflightComplete: false,
      },
      "report preflight completion must exactly match report.preflightCode",
    ],
    [
      "deserialization started before completion",
      {
        ok: false,
        stage: "preflight",
        code: "TRUNCATED",
        consumedByteCount: 0,
        topologyItemCount: 0,
        preflightCode: "TRUNCATED",
        archivePreflightComplete: false,
        deserializationStarted: true,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
      "deserialization start must exactly match completed preflight",
    ],
    [
      "successful decode without deserialization",
      { deserializationStarted: false },
      "deserialization start must exactly match completed preflight",
    ],
    [
      "preflight counters before execution",
      {
        ok: false,
        stage: "validation",
        code: "EMPTY_INPUT",
        consumedByteCount: 0,
        topologyItemCount: 0,
        preflightWorkUnits: 1,
        preflightMaximumDepth: 0,
        preflightMaximumLocationPower: 0,
        preflightConsumedByteCount: 0,
        preflightCode: "NOT_RUN",
        archivePreflightComplete: false,
        deserializationStarted: false,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
      "preflight counters must be zero before preflight runs",
    ],
    [
      "preflight consumed bytes above input",
      { preflightConsumedByteCount: 5 },
      "preflight consumed bytes exceed the input length",
    ],
    [
      "completed preflight with trailing bytes",
      { preflightConsumedByteCount: 3 },
      "completed preflight must consume the exact input",
    ],
    [
      "incomplete preflight after OCCT consumed bytes",
      {
        ok: false,
        stage: "preflight",
        code: "TRUNCATED",
        consumedByteCount: 1,
        topologyItemCount: 0,
        preflightCode: "TRUNCATED",
        archivePreflightComplete: false,
        deserializationStarted: false,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
      "incomplete preflight must precede all OCCT decode counters",
    ],
    [
      "incomplete preflight after OCCT topology work",
      {
        ok: false,
        stage: "preflight",
        code: "TRUNCATED",
        consumedByteCount: 0,
        topologyItemCount: 1,
        preflightCode: "TRUNCATED",
        archivePreflightComplete: false,
        deserializationStarted: false,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
      "incomplete preflight must precede all OCCT decode counters",
    ],
    [
      "preflight rejection with the wrong stage",
      {
        ok: false,
        stage: "deserialization",
        code: "TRUNCATED",
        consumedByteCount: 0,
        topologyItemCount: 0,
        preflightCode: "TRUNCATED",
        archivePreflightComplete: false,
        deserializationStarted: false,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
      "preflight rejection must use the preflight stage",
    ],
    [
      "preflight failure code disagreeing with the read report",
      {
        ok: false,
        stage: "preflight",
        code: "INVALID_COUNT",
        consumedByteCount: 0,
        topologyItemCount: 0,
        preflightCode: "TRUNCATED",
        archivePreflightComplete: false,
        deserializationStarted: false,
        hasResult: vi.fn(() => false),
        transferCode: vi.fn(() => "NO_RESULT"),
      },
      "preflight failure code does not match the report code",
    ],
    [
      "omitted depth telemetry",
      { preflightMaximumDepth: undefined },
      "report.preflightMaximumDepth must be a non-negative signed 32-bit integer",
    ],
  ])("rejects ABI 0.9 report protocol mismatch: %s", (
    _label,
    overrides,
    message,
  ) => {
    const fixture = readFixture({
      overrides: {
        ...nativeRequestFields,
        ...successfulPreflightFields,
        ...overrides,
      },
    });

    expect(() =>
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
        ...preflightLimits,
      }),
    ).toThrow(message);
    expect(fixture.take).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("releases a transferred result when post-transfer validation fails", () => {
    const fixture = readFixture({ postTransferCode: "READY" });
    const kernel = { release: vi.fn() };

    expect(() =>
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel,
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
      }),
    ).toThrow(OcctArtifactFacadeProtocolError);
    expect(kernel.release).toHaveBeenCalledExactlyOnceWith(41);
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("releases after a post-transfer report deletion failure", () => {
    const cleanup = new Error("delete failed");
    const fixture = readFixture({
      overrides: {
        delete: vi.fn(() => {
          throw cleanup;
        }),
      },
    });
    const kernel = { release: vi.fn() };

    expect(() =>
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel,
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
      }),
    ).toThrow(cleanup);
    expect(kernel.release).toHaveBeenCalledExactlyOnceWith(41);
  });

  it("does not lose an undefined post-transfer cleanup failure", () => {
    const fixture = readFixture({
      overrides: {
        delete: vi.fn(() => {
          throw undefined;
        }),
      },
    });
    const kernel = { release: vi.fn() };
    let caught = false;
    try {
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel,
        input: new Uint8Array(4),
        maxInputBytes: 16,
        maxTopologyItems: 100,
      });
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(kernel.release).toHaveBeenCalledExactlyOnceWith(41);
  });

  it.each<
    readonly [string, Partial<OcctArtifactWriteRawReport>]
  >([
    [
      "an unechoed cap",
      {
        ...nativeRequestFields,
        maxNativeRequestedBytes:
          OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES - 1,
      },
    ],
    [
      "admitted bytes above the cap",
      {
        ...nativeRequestFields,
        nativeRequestedBytes:
          OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES + 1,
      },
    ],
    [
      "a negative allocation-call count",
      { ...nativeRequestFields, nativeAllocationCalls: -1 },
    ],
    [
      "a non-boolean exceeded flag",
      { ...nativeRequestFields, nativeRequestLimitExceeded: 1 },
    ],
    [
      "a successful report with an exceeded flag",
      { ...nativeRequestFields, nativeRequestLimitExceeded: true },
    ],
    [
      "a limit failure without an exceeded flag",
      {
        ...nativeRequestFields,
        ok: false,
        code: "NATIVE_REQUEST_LIMIT_EXCEEDED",
        hasBytes: vi.fn(() => false),
        byteCount: vi.fn(() => 0),
      },
    ],
    [
      "a non-limit failure with an exceeded flag",
      {
        ...nativeRequestFields,
        ok: false,
        code: "SERIALIZATION_FAILED",
        nativeRequestLimitExceeded: true,
        hasBytes: vi.fn(() => false),
        byteCount: vi.fn(() => 0),
      },
    ],
  ])("rejects ABI 0.8 report protocol mismatch: %s", (_label, overrides) => {
    const fixture = writeFixture(overrides);

    expect(() =>
      writeBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        shapeId: 9,
        maxOutputBytes: 16,
        maxNativeRequestedBytes: OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES,
      }),
    ).toThrow(OcctArtifactFacadeProtocolError);
    expect(fixture.report.copyBytes).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
  });

  it("rejects an invalid native request budget before native work", () => {
    const fixture = writeFixture(nativeRequestFields);

    expect(() =>
      writeBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        shapeId: 9,
        maxOutputBytes: 16,
        maxNativeRequestedBytes: 0,
      }),
    ).toThrow(RangeError);
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it("rejects invalid limits and incomplete modules before native work", () => {
    const fixture = readFixture();
    expect(() =>
      readBoundedOcctArtifactBrep({
        module: fixture.module,
        kernel: { release: vi.fn() },
        input: new Uint8Array(17),
        maxInputBytes: 16,
        maxTopologyItems: 100,
      }),
    ).toThrow(RangeError);
    expect(fixture.invoke).not.toHaveBeenCalled();

    expect(() =>
      writeBoundedOcctArtifactBrep({
        module: {},
        kernel: { release: vi.fn() },
        shapeId: 1,
        maxOutputBytes: 16,
      }),
    ).toThrow(OcctArtifactFacadeProtocolError);
  });
});
