import { describe, expect, it, vi } from "vitest";
import {
  OcctArtifactFacadeProtocolError,
  OcctArtifactReadError,
  OcctArtifactWriteError,
  readBoundedOcctArtifactBrep,
  writeBoundedOcctArtifactBrep,
  type OcctArtifactReadRawReport,
  type OcctArtifactWriteRawReport,
} from "../src/internal/occt-artifact-facade.js";

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

  it("passes the exact borrowed view and transfers a validated result once", () => {
    const fixture = readFixture();
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
    expect(fixture.take).toHaveBeenCalledOnce();
    expect(kernel.release).not.toHaveBeenCalled();
    expect(fixture.report.delete).toHaveBeenCalledOnce();
    expect(backing).toEqual(new Uint8Array([90, 1, 2, 3, 4, 91]));
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
