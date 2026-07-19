import { describe, expect, it, vi, type Mock } from "vitest";
import {
  OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
  OCCT_DRAFT_FACADE_VERSION,
  OcctFacadeProtocolError,
} from "../src/internal/occt-facade.js";
import {
  OcctPipeShellOperationError,
  OcctPipeShellQualityError,
  OcctPipeShellUnsupportedError,
  adoptOcctControlledPipeShell,
  type AdoptOcctControlledPipeShellOptions,
} from "../src/internal/occt-pipe-shell.js";

interface FakePipeShellReport {
  ok: unknown;
  stage: unknown;
  code: unknown;
  message: unknown;
  occtStatus: unknown;
  errorOnSurface: unknown;
  tolerance3d: unknown;
  boundaryTolerance: unknown;
  angularTolerance: unknown;
  buildCount: unknown;
  solidificationCount: unknown;
  hasResult: ReturnType<typeof vi.fn>;
  transferCode: ReturnType<typeof vi.fn>;
  takeResultId: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function fakeReport(): FakePipeShellReport {
  return {
    ok: true,
    stage: "complete",
    code: "OK",
    message: "Controlled PipeShell completed",
    occtStatus: 0,
    errorOnSurface: 2e-8,
    tolerance3d: 1e-7,
    boundaryTolerance: 2e-7,
    angularTolerance: 1e-8,
    buildCount: 1,
    solidificationCount: 1,
    hasResult: vi.fn(() => true),
    transferCode: vi.fn(() => "READY"),
    takeResultId: vi.fn(() => 73),
    delete: vi.fn(),
  };
}

function facadeModule(report: unknown = fakeReport()) {
  return {
    VectorUint32: class {},
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
    InvariantCadPipeShellReport: class {},
    invariantcadFacadeVersion: vi.fn(
      () => OCCT_CONTROLLED_PIPE_SHELL_FACADE_VERSION,
    ),
    invariantcadDraftFacesAtomic: vi.fn(),
    invariantcadPipeShellSolid: vi.fn(() => report),
  };
}

function draftOnlyModule() {
  const module = facadeModule();
  const {
    InvariantCadPipeShellReport: _report,
    invariantcadPipeShellSolid: _pipeShell,
    ...draft
  } = module;
  draft.invariantcadFacadeVersion.mockReturnValue(OCCT_DRAFT_FACADE_VERSION);
  return draft;
}

function options<T>(
  module: unknown,
  adopt: AdoptOcctControlledPipeShellOptions<T>["adopt"],
): AdoptOcctControlledPipeShellOptions<T> & {
  readonly kernel: { readonly release: Mock<(resultId: number) => void> };
} {
  return {
    module,
    kernel: { release: vi.fn() },
    profileWireId: 11,
    spineWireId: 12,
    tolerance3d: 1e-7,
    boundaryTolerance: 2e-7,
    angularTolerance: 1e-8,
    maxSurfaceError: 5e-8,
    adopt,
  };
}

describe("controlled OCCT PipeShell facade adapter", () => {
  it("rejects stock and legacy draft-only modules without invoking native code", () => {
    expect(() =>
      adoptOcctControlledPipeShell(
        options({ VectorUint32: class {} }, vi.fn()),
      ),
    ).toThrow(OcctPipeShellUnsupportedError);

    const legacy = draftOnlyModule();
    expect(() =>
      adoptOcctControlledPipeShell(options(legacy, vi.fn())),
    ).toThrow(OcctPipeShellUnsupportedError);
    expect(legacy.invariantcadDraftFacesAtomic).not.toHaveBeenCalled();
  });

  it("validates handles, native bounds, and the TS quality bound before invocation", () => {
    const invalidRequests: Array<
      Partial<AdoptOcctControlledPipeShellOptions<unknown>>
    > = [
      { profileWireId: -1 },
      { spineWireId: 4_294_967_296 },
      { tolerance3d: 0 },
      { tolerance3d: Number.NaN },
      { tolerance3d: 1.000_001 },
      { boundaryTolerance: Number.POSITIVE_INFINITY },
      { angularTolerance: 0.100_001 },
      { maxSurfaceError: -1 },
      { maxSurfaceError: Number.NaN },
    ];

    for (const override of invalidRequests) {
      const module = facadeModule();
      const request = { ...options(module, vi.fn()), ...override };
      expect(() => adoptOcctControlledPipeShell(request)).toThrow(
        OcctFacadeProtocolError,
      );
      expect(module.invariantcadPipeShellSolid).not.toHaveBeenCalled();
    }
  });

  it("validates READY, transfers once, deletes the report, and adopts frozen data", () => {
    const report = fakeReport();
    const module = facadeModule(report);
    const adopt = vi.fn(({ resultId, report: snapshot }) => {
      expect(report.delete).toHaveBeenCalledTimes(1);
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.diagnostics)).toBe(true);
      expect(snapshot).toEqual({
        diagnostics: {
          ok: true,
          stage: "complete",
          code: "OK",
          message: "Controlled PipeShell completed",
          occtStatus: 0,
          errorOnSurface: 2e-8,
          tolerance3d: 1e-7,
          boundaryTolerance: 2e-7,
          angularTolerance: 1e-8,
          buildCount: 1,
          solidificationCount: 1,
          hasResult: true,
        },
        transferCode: "READY",
      });
      return resultId;
    });
    const request = options(module, adopt);

    expect(adoptOcctControlledPipeShell(request)).toBe(73);
    expect(module.invariantcadPipeShellSolid).toHaveBeenCalledExactlyOnceWith(
      request.kernel,
      11,
      12,
      1e-7,
      2e-7,
      1e-8,
    );
    expect(report.hasResult).toHaveBeenCalledTimes(1);
    expect(report.transferCode).toHaveBeenCalledExactlyOnceWith(request.kernel);
    expect(report.takeResultId).toHaveBeenCalledExactlyOnceWith(request.kernel);
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("preserves a coherent native failure without preflighting or taking", () => {
    const report = fakeReport();
    Object.assign(report, {
      ok: false,
      stage: "solid",
      code: "SOLID_FAILED",
      message: "PipeShell could not close the profile into a solid",
      occtStatus: 3,
      errorOnSurface: 2e-8,
      buildCount: 1,
      solidificationCount: 1,
    });
    report.hasResult.mockReturnValue(false);
    const module = facadeModule(report);
    const request = options(module, vi.fn());

    let error: unknown;
    try {
      adoptOcctControlledPipeShell(request);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(OcctPipeShellOperationError);
    expect((error as OcctPipeShellOperationError).diagnostics).toEqual({
      ok: false,
      stage: "solid",
      code: "SOLID_FAILED",
      message: "PipeShell could not close the profile into a solid",
      occtStatus: 3,
      errorOnSurface: 2e-8,
      tolerance3d: 1e-7,
      boundaryTolerance: 2e-7,
      angularTolerance: 1e-8,
      buildCount: 1,
      solidificationCount: 1,
      hasResult: false,
    });
    expect(Object.isFrozen((error as OcctPipeShellOperationError).diagnostics)).toBe(
      true,
    );
    expect(report.transferCode).not.toHaveBeenCalled();
    expect(report.takeResultId).not.toHaveBeenCalled();
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("rejects malformed fields, echoes, counters, and quality before transfer", () => {
    const contradictions: Array<(report: FakePipeShellReport) => void> = [
      (report) => {
        report.ok = "yes";
      },
      (report) => {
        report.occtStatus = 1.5;
      },
      (report) => {
        report.tolerance3d = 1.1e-7;
      },
      (report) => {
        report.boundaryTolerance = Number.NaN;
      },
      (report) => {
        report.buildCount = 2;
      },
      (report) => {
        report.solidificationCount = 0;
      },
      (report) => {
        report.buildCount = 0;
        report.solidificationCount = 1;
      },
      (report) => {
        report.errorOnSurface = Number.NaN;
      },
      (report) => {
        report.hasResult.mockReturnValue(false);
      },
      (report) => {
        report.stage = "build";
      },
    ];

    for (const contradict of contradictions) {
      const report = fakeReport();
      contradict(report);
      const module = facadeModule(report);
      const request = options(module, vi.fn());
      expect(() => adoptOcctControlledPipeShell(request)).toThrow(
        OcctFacadeProtocolError,
      );
      expect(report.transferCode).not.toHaveBeenCalled();
      expect(report.takeResultId).not.toHaveBeenCalled();
      expect(report.delete).toHaveBeenCalledTimes(1);
      expect(request.kernel.release).not.toHaveBeenCalled();
    }
  });

  it("rejects a measured surface error above the caller's quality bound", () => {
    const report = fakeReport();
    report.errorOnSurface = 6e-8;
    const request = options(facadeModule(report), vi.fn());

    let error: unknown;
    try {
      adoptOcctControlledPipeShell(request);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(OcctPipeShellQualityError);
    expect((error as OcctPipeShellQualityError).maxSurfaceError).toBe(5e-8);
    expect((error as OcctPipeShellQualityError).diagnostics.errorOnSurface).toBe(
      6e-8,
    );
    expect(report.transferCode).not.toHaveBeenCalled();
    expect(report.takeResultId).not.toHaveBeenCalled();
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("rejects contradictory failed reports before raising operation failure", () => {
    for (const contradiction of [
      "result",
      "success-diagnostic",
      "invalid-error",
    ] as const) {
      const report = fakeReport();
      Object.assign(report, {
        ok: false,
        stage: contradiction === "success-diagnostic" ? "complete" : "build",
        code: "BUILD_FAILED",
        message: "failed",
        errorOnSurface:
          contradiction === "invalid-error" ? Number.NaN : -1,
        buildCount: 1,
        solidificationCount: 0,
      });
      report.hasResult.mockReturnValue(contradiction === "result");
      const request = options(facadeModule(report), vi.fn());

      expect(() => adoptOcctControlledPipeShell(request)).toThrow(
        OcctFacadeProtocolError,
      );
      expect(report.takeResultId).not.toHaveBeenCalled();
      expect(report.delete).toHaveBeenCalledTimes(1);
      expect(request.kernel.release).not.toHaveBeenCalled();
    }
  });

  it("accepts an explicitly diagnosed invalid native surface measurement", () => {
    const report = fakeReport();
    Object.assign(report, {
      ok: false,
      stage: "quality",
      code: "INVALID_SURFACE_ERROR",
      message: "PipeShell returned an invalid surface error",
      errorOnSurface: Number.NaN,
      buildCount: 1,
      solidificationCount: 0,
    });
    report.hasResult.mockReturnValue(false);
    const request = options(facadeModule(report), vi.fn());

    expect(() => adoptOcctControlledPipeShell(request)).toThrow(
      OcctPipeShellOperationError,
    );
    expect(report.transferCode).not.toHaveBeenCalled();
    expect(report.takeResultId).not.toHaveBeenCalled();
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();
  });

  it("runs caller validation after READY and before the exactly-once transfer", () => {
    const report = fakeReport();
    const module = facadeModule(report);
    const validate = vi.fn((snapshot) => {
      expect(snapshot.transferCode).toBe("READY");
      expect(report.transferCode).toHaveBeenCalledTimes(1);
      expect(report.takeResultId).not.toHaveBeenCalled();
      throw new Error("postcondition mismatch");
    });
    const request = { ...options(module, vi.fn()), validate };

    expect(() => adoptOcctControlledPipeShell(request)).toThrow(
      "postcondition mismatch",
    );
    expect(validate).toHaveBeenCalledTimes(1);
    expect(report.takeResultId).not.toHaveBeenCalled();
    expect(report.delete).toHaveBeenCalledTimes(1);
    expect(request.kernel.release).not.toHaveBeenCalled();

    const wrongState = fakeReport();
    wrongState.transferCode.mockReturnValue("WRONG_KERNEL");
    expect(() =>
      adoptOcctControlledPipeShell(
        options(facadeModule(wrongState), vi.fn()),
      ),
    ).toThrow("transfer state is 'WRONG_KERNEL'");
    expect(wrongState.takeResultId).not.toHaveBeenCalled();
    expect(wrongState.delete).toHaveBeenCalledTimes(1);
  });

  it("deletes malformed reports and reports whose accessors throw", () => {
    const malformed = {
      ...fakeReport(),
      transferCode: undefined,
    };
    expect(() =>
      adoptOcctControlledPipeShell(
        options(facadeModule(malformed), vi.fn()),
      ),
    ).toThrow("report.transferCode must be a function");
    expect(malformed.delete).toHaveBeenCalledTimes(1);

    const accessorFailure = fakeReport();
    accessorFailure.hasResult.mockImplementationOnce(() => {
      throw new Error("hasResult failed");
    });
    expect(() =>
      adoptOcctControlledPipeShell(
        options(facadeModule(accessorFailure), vi.fn()),
      ),
    ).toThrow("hasResult failed");
    expect(accessorFailure.delete).toHaveBeenCalledTimes(1);
    expect(accessorFailure.takeResultId).not.toHaveBeenCalled();
  });

  it("does not invent ownership when invocation or transfer fails", () => {
    const invocationModule = facadeModule();
    invocationModule.invariantcadPipeShellSolid.mockImplementationOnce(() => {
      throw new Error("invoke failed");
    });
    const invocationRequest = options(invocationModule, vi.fn());
    expect(() => adoptOcctControlledPipeShell(invocationRequest)).toThrow(
      "invoke failed",
    );
    expect(invocationRequest.kernel.release).not.toHaveBeenCalled();

    const transferFailure = fakeReport();
    transferFailure.takeResultId.mockImplementationOnce(() => {
      throw new Error("transfer failed");
    });
    const transferRequest = options(facadeModule(transferFailure), vi.fn());
    expect(() => adoptOcctControlledPipeShell(transferRequest)).toThrow(
      "transfer failed",
    );
    expect(transferFailure.delete).toHaveBeenCalledTimes(1);
    expect(transferRequest.kernel.release).not.toHaveBeenCalled();

    const zero = fakeReport();
    zero.takeResultId.mockReturnValue(0);
    const zeroRequest = options(facadeModule(zero), vi.fn());
    expect(() => adoptOcctControlledPipeShell(zeroRequest)).toThrow(
      "reserved result ID 0",
    );
    expect(zero.delete).toHaveBeenCalledTimes(1);
    expect(zeroRequest.kernel.release).not.toHaveBeenCalled();

    for (const resultId of [11, 12]) {
      const alias = fakeReport();
      alias.takeResultId.mockReturnValue(resultId);
      const aliasRequest = options(facadeModule(alias), vi.fn());
      expect(() => adoptOcctControlledPipeShell(aliasRequest)).toThrow(
        "operand-aliasing result ID",
      );
      expect(aliasRequest.adopt).not.toHaveBeenCalled();
      expect(alias.delete).toHaveBeenCalledTimes(1);
      expect(aliasRequest.kernel.release).not.toHaveBeenCalled();
    }
  });

  it("releases a transferred result exactly once when adoption or deletion fails", () => {
    const adoptionReport = fakeReport();
    const adoptionRequest = options(
      facadeModule(adoptionReport),
      vi.fn(() => {
        throw new Error("adoption failed");
      }),
    );
    expect(() => adoptOcctControlledPipeShell(adoptionRequest)).toThrow(
      "adoption failed",
    );
    expect(adoptionReport.takeResultId).toHaveBeenCalledTimes(1);
    expect(adoptionReport.delete).toHaveBeenCalledTimes(1);
    expect(adoptionRequest.kernel.release).toHaveBeenCalledExactlyOnceWith(73);

    const deletionReport = fakeReport();
    deletionReport.delete.mockImplementationOnce(() => {
      throw new Error("report deletion failed");
    });
    const deletionRequest = options(facadeModule(deletionReport), vi.fn());
    expect(() => adoptOcctControlledPipeShell(deletionRequest)).toThrow(
      "report deletion failed",
    );
    expect(deletionReport.takeResultId).toHaveBeenCalledTimes(1);
    expect(deletionRequest.kernel.release).toHaveBeenCalledExactlyOnceWith(73);
  });

  it("copies report values before native transfer can mutate them", () => {
    const report = fakeReport();
    report.takeResultId.mockImplementationOnce(() => {
      report.code = "MUTATED";
      report.errorOnSurface = 999;
      return 73;
    });
    const request = options(
      facadeModule(report),
      vi.fn(({ report: snapshot }) => {
        expect(snapshot.diagnostics.code).toBe("OK");
        expect(snapshot.diagnostics.errorOnSurface).toBe(2e-8);
        return "adopted";
      }),
    );

    expect(adoptOcctControlledPipeShell(request)).toBe("adopted");
    expect(request.kernel.release).not.toHaveBeenCalled();
  });
});
