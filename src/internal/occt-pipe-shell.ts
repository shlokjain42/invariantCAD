import {
  OcctFacadeProtocolError,
  probeOcctFacade,
  type OcctPipeShellRawReport,
} from "./occt-facade.js";
import type { OcctDraftRawKernel } from "./occt-draft.js";

const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;
const UINT32_MAX = 4_294_967_295;

export const OCCT_PIPE_SHELL_MAX_LINEAR_TOLERANCE = 1;
export const OCCT_PIPE_SHELL_MAX_ANGULAR_TOLERANCE = 0.1;

export interface OcctPipeShellReportDiagnostics {
  readonly ok: boolean;
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly occtStatus: number;
  readonly errorOnSurface: number;
  readonly tolerance3d: number;
  readonly boundaryTolerance: number;
  readonly angularTolerance: number;
  readonly buildCount: number;
  readonly solidificationCount: number;
  readonly hasResult: boolean;
}

export interface OcctPipeShellReportSnapshot {
  readonly diagnostics: OcctPipeShellReportDiagnostics;
  readonly transferCode: "READY";
}

export interface OcctPipeShellTransferredResult {
  readonly resultId: number;
  readonly report: OcctPipeShellReportSnapshot;
}

export interface AdoptOcctControlledPipeShellOptions<T> {
  readonly module: unknown;
  readonly kernel: OcctDraftRawKernel;
  readonly profileWireId: number;
  readonly spineWireId: number;
  readonly tolerance3d: number;
  readonly boundaryTolerance: number;
  readonly angularTolerance: number;
  /** Maximum measured OCCT surface approximation error accepted by TS. */
  readonly maxSurfaceError: number;
  /** Runs after complete report and READY validation but before transfer. */
  readonly validate?: (report: OcctPipeShellReportSnapshot) => void;
  /**
   * Takes ownership of `resultId` only by returning successfully. If this
   * callback throws, the helper releases the transferred result exactly once.
   */
  readonly adopt: (result: OcctPipeShellTransferredResult) => T;
}

export class OcctPipeShellUnsupportedError extends Error {
  constructor() {
    super(
      "The loaded OCCT module does not provide the InvariantCAD controlled PipeShell facade",
    );
    this.name = "OcctPipeShellUnsupportedError";
  }
}

export class OcctPipeShellOperationError extends Error {
  readonly diagnostics: OcctPipeShellReportDiagnostics;

  constructor(diagnostics: OcctPipeShellReportDiagnostics) {
    super(
      `OCCT controlled PipeShell failed at '${diagnostics.stage}' with '${diagnostics.code}': ${diagnostics.message}`,
    );
    this.name = "OcctPipeShellOperationError";
    this.diagnostics = diagnostics;
  }
}

export class OcctPipeShellQualityError extends Error {
  readonly diagnostics: OcctPipeShellReportDiagnostics;
  readonly maxSurfaceError: number;

  constructor(
    diagnostics: OcctPipeShellReportDiagnostics,
    maxSurfaceError: number,
  ) {
    super(
      `OCCT PipeShell surface error ${diagnostics.errorOnSurface} exceeds accepted maximum ${maxSurfaceError}`,
    );
    this.name = "OcctPipeShellQualityError";
    this.diagnostics = diagnostics;
    this.maxSurfaceError = maxSurfaceError;
  }
}

function protocolError(message: string): never {
  throw new OcctFacadeProtocolError(message);
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") protocolError(`${label} must be a boolean`);
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") protocolError(`${label} must be a string`);
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number") protocolError(`${label} must be a number`);
  return value;
}

function assertSignedInt32(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < INT32_MIN ||
    value > INT32_MAX
  ) {
    protocolError(`${label} must be a signed 32-bit integer`);
  }
}

function assertCount(value: unknown, label: string): asserts value is number {
  assertSignedInt32(value, label);
  if (value < 0) protocolError(`${label} must be non-negative`);
}

function assertUint32(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > UINT32_MAX
  ) {
    protocolError(`${label} must be an unsigned 32-bit integer`);
  }
}

function assertFinitePositiveBounded(
  value: unknown,
  label: string,
  upperBound: number,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    protocolError(`${label} must be finite and positive`);
  }
  if (value > upperBound) {
    protocolError(`${label} must not exceed ${upperBound}`);
  }
}

function assertFiniteNonNegative(
  value: unknown,
  label: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    protocolError(`${label} must be finite and non-negative`);
  }
}

function assertRawReport(value: unknown): asserts value is OcctPipeShellRawReport {
  if (!isObject(value) || typeof value.delete !== "function") {
    protocolError("invariantcadPipeShellSolid() must return a deletable report");
  }
}

function assertRawReportMethods(report: OcctPipeShellRawReport): void {
  for (const method of ["hasResult", "transferCode", "takeResultId"] as const) {
    if (typeof report[method] !== "function") {
      protocolError(`PipeShell report.${method} must be a function`);
    }
  }
}

function copyDiagnostics(
  report: OcctPipeShellRawReport,
): OcctPipeShellReportDiagnostics {
  const ok = readBoolean(report.ok, "PipeShell report.ok");
  const stage = readString(report.stage, "PipeShell report.stage");
  const code = readString(report.code, "PipeShell report.code");
  const message = readString(report.message, "PipeShell report.message");
  const occtStatus = report.occtStatus;
  const errorOnSurface = readNumber(
    report.errorOnSurface,
    "PipeShell report.errorOnSurface",
  );
  const tolerance3d = readNumber(
    report.tolerance3d,
    "PipeShell report.tolerance3d",
  );
  const boundaryTolerance = readNumber(
    report.boundaryTolerance,
    "PipeShell report.boundaryTolerance",
  );
  const angularTolerance = readNumber(
    report.angularTolerance,
    "PipeShell report.angularTolerance",
  );
  const buildCount = report.buildCount;
  const solidificationCount = report.solidificationCount;
  const hasResult = readBoolean(
    report.hasResult(),
    "PipeShell report.hasResult()",
  );

  assertSignedInt32(occtStatus, "PipeShell report.occtStatus");
  assertCount(buildCount, "PipeShell report.buildCount");
  assertCount(
    solidificationCount,
    "PipeShell report.solidificationCount",
  );

  return Object.freeze({
    ok,
    stage,
    code,
    message,
    occtStatus,
    errorOnSurface,
    tolerance3d,
    boundaryTolerance,
    angularTolerance,
    buildCount,
    solidificationCount,
    hasResult,
  });
}

function validateEchoes(
  diagnostics: OcctPipeShellReportDiagnostics,
  options: AdoptOcctControlledPipeShellOptions<unknown>,
): void {
  for (const [name, actual, expected] of [
    ["tolerance3d", diagnostics.tolerance3d, options.tolerance3d],
    [
      "boundaryTolerance",
      diagnostics.boundaryTolerance,
      options.boundaryTolerance,
    ],
    ["angularTolerance", diagnostics.angularTolerance, options.angularTolerance],
  ] as const) {
    if (!Number.isFinite(actual) || !Object.is(actual, expected)) {
      protocolError(
        `PipeShell report.${name} is '${String(actual)}', expected exact echo '${String(expected)}'`,
      );
    }
  }
}

function validateReportSemantics(
  diagnostics: OcctPipeShellReportDiagnostics,
): void {
  if (diagnostics.buildCount > 1) {
    protocolError("PipeShell report.buildCount must not exceed 1");
  }
  if (diagnostics.solidificationCount > 1) {
    protocolError("PipeShell report.solidificationCount must not exceed 1");
  }
  if (diagnostics.solidificationCount > diagnostics.buildCount) {
    protocolError(
      "PipeShell report.solidificationCount must not exceed buildCount",
    );
  }

  if (!diagnostics.ok) {
    if (diagnostics.hasResult) {
      protocolError("failed PipeShell report unexpectedly owns a result");
    }
    if (diagnostics.stage === "complete" || diagnostics.code === "OK") {
      protocolError(
        "failed PipeShell report uses successful stage or code diagnostics",
      );
    }
    const isAvailableSurfaceError =
      Number.isFinite(diagnostics.errorOnSurface) &&
      diagnostics.errorOnSurface >= 0;
    const isUnavailableSurfaceError = diagnostics.errorOnSurface === -1;
    const isDiagnosedInvalidSurfaceError =
      diagnostics.code === "INVALID_SURFACE_ERROR" &&
      (!Number.isFinite(diagnostics.errorOnSurface) ||
        diagnostics.errorOnSurface < 0);
    if (
      !isAvailableSurfaceError &&
      !isUnavailableSurfaceError &&
      !isDiagnosedInvalidSurfaceError
    ) {
      protocolError(
        "failed PipeShell report.errorOnSurface must be measured, unavailable as -1, or diagnosed invalid",
      );
    }
    return;
  }

  if (diagnostics.stage !== "complete" || diagnostics.code !== "OK") {
    protocolError(
      "successful PipeShell report must have stage 'complete' and code 'OK'",
    );
  }
  if (!diagnostics.hasResult) {
    protocolError("successful PipeShell report does not own a result");
  }
  if (diagnostics.buildCount !== 1) {
    protocolError("successful PipeShell report buildCount must be 1");
  }
  if (diagnostics.solidificationCount !== 1) {
    protocolError("successful PipeShell report solidificationCount must be 1");
  }
  if (
    !Number.isFinite(diagnostics.errorOnSurface) ||
    diagnostics.errorOnSurface < 0
  ) {
    protocolError(
      "successful PipeShell report.errorOnSurface must be finite and non-negative",
    );
  }
}

/**
 * Executes controlled PipeShell as an ownership transaction. No native result
 * enters caller ownership until the report, echoed controls, quality bound,
 * and READY preflight are validated.
 */
export function adoptOcctControlledPipeShell<T>(
  options: AdoptOcctControlledPipeShellOptions<T>,
): T {
  const facade = probeOcctFacade(options.module);
  if (facade?.pipeShell === undefined) {
    throw new OcctPipeShellUnsupportedError();
  }
  if (!isObject(options.kernel) || typeof options.kernel.release !== "function") {
    protocolError("kernel must provide release(resultId)");
  }
  assertUint32(options.profileWireId, "profileWireId");
  assertUint32(options.spineWireId, "spineWireId");
  assertFinitePositiveBounded(
    options.tolerance3d,
    "tolerance3d",
    OCCT_PIPE_SHELL_MAX_LINEAR_TOLERANCE,
  );
  assertFinitePositiveBounded(
    options.boundaryTolerance,
    "boundaryTolerance",
    OCCT_PIPE_SHELL_MAX_LINEAR_TOLERANCE,
  );
  assertFinitePositiveBounded(
    options.angularTolerance,
    "angularTolerance",
    OCCT_PIPE_SHELL_MAX_ANGULAR_TOLERANCE,
  );
  assertFiniteNonNegative(options.maxSurfaceError, "maxSurfaceError");

  let resultToRelease: number | undefined;
  try {
    let report: OcctPipeShellRawReport | undefined;
    let transferred: OcctPipeShellTransferredResult;
    try {
      const rawReport = facade.pipeShell.invariantcadPipeShellSolid(
        options.kernel,
        options.profileWireId,
        options.spineWireId,
        options.tolerance3d,
        options.boundaryTolerance,
        options.angularTolerance,
      );
      assertRawReport(rawReport);
      report = rawReport;
      assertRawReportMethods(report);

      const diagnostics = copyDiagnostics(report);
      validateEchoes(
        diagnostics,
        options as AdoptOcctControlledPipeShellOptions<unknown>,
      );
      validateReportSemantics(diagnostics);
      if (!diagnostics.ok) {
        throw new OcctPipeShellOperationError(diagnostics);
      }
      if (diagnostics.errorOnSurface > options.maxSurfaceError) {
        throw new OcctPipeShellQualityError(
          diagnostics,
          options.maxSurfaceError,
        );
      }

      const transferCode = readString(
        report.transferCode(options.kernel),
        "PipeShell report.transferCode()",
      );
      if (transferCode !== "READY") {
        protocolError(
          `PipeShell report transfer state is '${transferCode}', expected 'READY'`,
        );
      }

      const reportSnapshot = Object.freeze({
        diagnostics,
        transferCode: "READY" as const,
      });
      options.validate?.(reportSnapshot);

      const resultId = report.takeResultId(options.kernel);
      assertUint32(resultId, "PipeShell report.takeResultId()");
      if (resultId === 0) {
        protocolError(
          "PipeShell report.takeResultId() returned reserved result ID 0",
        );
      }
      resultToRelease = resultId;
      transferred = Object.freeze({ resultId, report: reportSnapshot });
    } finally {
      report?.delete();
    }

    const result = options.adopt(transferred);
    resultToRelease = undefined;
    return result;
  } finally {
    if (resultToRelease !== undefined) {
      options.kernel.release(resultToRelease);
    }
  }
}

/** Short compatibility alias for integration sites that already say PipeShell. */
export const adoptOcctPipeShell = adoptOcctControlledPipeShell;
