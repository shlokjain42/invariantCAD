const INT32_MAX = 2_147_483_647;
const UINT32_MAX = 4_294_967_295;

export interface OcctArtifactRawKernel {
  release(resultId: number): void;
}

export interface OcctArtifactWriteRawReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly message: unknown;
  readonly maxOutputBytes: unknown;
  hasBytes(): unknown;
  byteCount(): unknown;
  copyBytes(): unknown;
  delete(): void;
}

export interface OcctArtifactReadRawReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly message: unknown;
  readonly inputByteCount: unknown;
  readonly maxInputBytes: unknown;
  readonly consumedByteCount: unknown;
  readonly topologyItemCount: unknown;
  readonly maxTopologyItems: unknown;
  hasResult(): unknown;
  transferCode(kernel: OcctArtifactRawKernel): unknown;
  takeResultId(kernel: OcctArtifactRawKernel): unknown;
  delete(): void;
}

/** Structural view of the bounded artifact additions in owned facade ABI 0.7. */
export interface OcctArtifactFacadeModule {
  readonly InvariantCadArtifactWriteReport: Function;
  readonly InvariantCadArtifactReadReport: Function;
  invariantcadWriteArtifactBrep(
    kernel: OcctArtifactRawKernel,
    shapeId: number,
    maxOutputBytes: number,
  ): unknown;
  invariantcadReadArtifactBrep(
    kernel: OcctArtifactRawKernel,
    input: Uint8Array,
    maxInputBytes: number,
    maxTopologyItems: number,
  ): unknown;
}

export interface OcctArtifactWriteDiagnostics {
  readonly ok: boolean;
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly maxOutputBytes: number;
  readonly byteCount: number;
  readonly hasBytes: boolean;
}

export interface OcctArtifactReadDiagnostics {
  readonly ok: boolean;
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly inputByteCount: number;
  readonly maxInputBytes: number;
  readonly consumedByteCount: number;
  readonly topologyItemCount: number;
  readonly maxTopologyItems: number;
  readonly hasResult: boolean;
  readonly transferCode: string;
}

export class OcctArtifactFacadeProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid InvariantCAD OCCT artifact facade: ${message}`);
    this.name = "OcctArtifactFacadeProtocolError";
  }
}

export class OcctArtifactWriteError extends Error {
  readonly diagnostics: OcctArtifactWriteDiagnostics;

  constructor(diagnostics: OcctArtifactWriteDiagnostics) {
    super(
      `OCCT artifact write failed at '${diagnostics.stage}' with '${diagnostics.code}': ${diagnostics.message}`,
    );
    this.name = "OcctArtifactWriteError";
    this.diagnostics = diagnostics;
  }
}

export class OcctArtifactReadError extends Error {
  readonly diagnostics: OcctArtifactReadDiagnostics;

  constructor(diagnostics: OcctArtifactReadDiagnostics) {
    super(
      `OCCT artifact read failed at '${diagnostics.stage}' with '${diagnostics.code}': ${diagnostics.message}`,
    );
    this.name = "OcctArtifactReadError";
    this.diagnostics = diagnostics;
  }
}

function protocolError(message: string): never {
  throw new OcctArtifactFacadeProtocolError(message);
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function assertModule(
  value: unknown,
): asserts value is OcctArtifactFacadeModule {
  if (!isObject(value)) protocolError("module must be an object");
  if (typeof value.InvariantCadArtifactWriteReport !== "function") {
    protocolError("InvariantCadArtifactWriteReport must be a constructor");
  }
  if (typeof value.InvariantCadArtifactReadReport !== "function") {
    protocolError("InvariantCadArtifactReadReport must be a constructor");
  }
  if (typeof value.invariantcadWriteArtifactBrep !== "function") {
    protocolError("invariantcadWriteArtifactBrep must be a function");
  }
  if (typeof value.invariantcadReadArtifactBrep !== "function") {
    protocolError("invariantcadReadArtifactBrep must be a function");
  }
}

function assertKernel(
  value: unknown,
): asserts value is OcctArtifactRawKernel {
  if (!isObject(value) || typeof value.release !== "function") {
    protocolError("kernel must provide release(resultId)");
  }
}

function assertPositiveInt32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > INT32_MAX) {
    throw new RangeError(`${label} must be a positive signed 32-bit integer`);
  }
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

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") protocolError(`${label} must be boolean`);
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") protocolError(`${label} must be a string`);
  return value;
}

function readCount(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > INT32_MAX
  ) {
    protocolError(`${label} must be a non-negative signed 32-bit integer`);
  }
  return value;
}

function assertDeletableWriteReport(
  value: unknown,
): asserts value is OcctArtifactWriteRawReport {
  if (!isObject(value) || typeof value.delete !== "function") {
    protocolError("artifact write invocation must return a deletable report");
  }
}

function assertDeletableReadReport(
  value: unknown,
): asserts value is OcctArtifactReadRawReport {
  if (!isObject(value) || typeof value.delete !== "function") {
    protocolError("artifact read invocation must return a deletable report");
  }
}

function cleanupFailure(
  primary: unknown,
  hasPrimary: boolean,
  cleanup: unknown,
  message: string,
): never {
  if (hasPrimary) throw new AggregateError([primary, cleanup], message);
  throw cleanup;
}

function copyWriteDiagnostics(
  report: OcctArtifactWriteRawReport,
): OcctArtifactWriteDiagnostics {
  return Object.freeze({
    ok: readBoolean(report.ok, "report.ok"),
    stage: readString(report.stage, "report.stage"),
    code: readString(report.code, "report.code"),
    message: readString(report.message, "report.message"),
    maxOutputBytes: readCount(
      report.maxOutputBytes,
      "report.maxOutputBytes",
    ),
    byteCount: readCount(report.byteCount(), "report.byteCount()"),
    hasBytes: readBoolean(report.hasBytes(), "report.hasBytes()"),
  });
}

function copyReadDiagnostics(
  report: OcctArtifactReadRawReport,
  kernel: OcctArtifactRawKernel,
): OcctArtifactReadDiagnostics {
  return Object.freeze({
    ok: readBoolean(report.ok, "report.ok"),
    stage: readString(report.stage, "report.stage"),
    code: readString(report.code, "report.code"),
    message: readString(report.message, "report.message"),
    inputByteCount: readCount(
      report.inputByteCount,
      "report.inputByteCount",
    ),
    maxInputBytes: readCount(report.maxInputBytes, "report.maxInputBytes"),
    consumedByteCount: readCount(
      report.consumedByteCount,
      "report.consumedByteCount",
    ),
    topologyItemCount: readCount(
      report.topologyItemCount,
      "report.topologyItemCount",
    ),
    maxTopologyItems: readCount(
      report.maxTopologyItems,
      "report.maxTopologyItems",
    ),
    hasResult: readBoolean(report.hasResult(), "report.hasResult()"),
    transferCode: readString(
      report.transferCode(kernel),
      "report.transferCode(kernel)",
    ),
  });
}

export interface WriteBoundedOcctArtifactBrepOptions {
  readonly module: unknown;
  readonly kernel: OcctArtifactRawKernel;
  readonly shapeId: number;
  readonly maxOutputBytes: number;
}

/** Copies a native-capped binary BREP into one detached caller-owned array. */
export function writeBoundedOcctArtifactBrep(
  options: WriteBoundedOcctArtifactBrepOptions,
): Uint8Array {
  assertModule(options.module);
  assertKernel(options.kernel);
  assertUint32(options.shapeId, "shapeId");
  assertPositiveInt32(options.maxOutputBytes, "maxOutputBytes");

  const rawReport = options.module.invariantcadWriteArtifactBrep(
    options.kernel,
    options.shapeId,
    options.maxOutputBytes,
  );
  assertDeletableWriteReport(rawReport);
  let primary: unknown;
  let hasPrimary = false;
  let output: Uint8Array | undefined;
  try {
    const diagnostics = copyWriteDiagnostics(rawReport);
    if (diagnostics.maxOutputBytes !== options.maxOutputBytes) {
      protocolError("report output limit does not echo the request");
    }
    if (!diagnostics.ok) {
      if (diagnostics.hasBytes || diagnostics.byteCount !== 0) {
        protocolError("failed artifact write report must not retain bytes");
      }
      throw new OcctArtifactWriteError(diagnostics);
    }
    if (
      diagnostics.stage !== "complete" ||
      diagnostics.code !== "OK" ||
      !diagnostics.hasBytes ||
      diagnostics.byteCount === 0 ||
      diagnostics.byteCount > options.maxOutputBytes
    ) {
      protocolError("successful artifact write report is inconsistent");
    }
    const bytes = rawReport.copyBytes();
    if (!(bytes instanceof Uint8Array)) {
      protocolError("report.copyBytes() must return a Uint8Array");
    }
    if (bytes.byteLength !== diagnostics.byteCount) {
      protocolError("copied artifact byte length does not match the report");
    }
    output = bytes.slice();
  } catch (error) {
    primary = error;
    hasPrimary = true;
  }
  try {
    rawReport.delete();
  } catch (cleanup) {
    cleanupFailure(
      primary,
      hasPrimary,
      cleanup,
      "OCCT artifact write and report cleanup both failed",
    );
  }
  if (hasPrimary) throw primary;
  if (output === undefined) protocolError("artifact write produced no output");
  return output;
}

export interface ReadBoundedOcctArtifactBrepOptions {
  readonly module: unknown;
  readonly kernel: OcctArtifactRawKernel;
  readonly input: Uint8Array;
  readonly maxInputBytes: number;
  readonly maxTopologyItems: number;
}

/**
 * Decodes borrowed bytes into a report-owned shape and transfers it once only
 * after every report echo and ownership preflight has been validated.
 */
export function readBoundedOcctArtifactBrep(
  options: ReadBoundedOcctArtifactBrepOptions,
): number {
  assertModule(options.module);
  assertKernel(options.kernel);
  if (!(options.input instanceof Uint8Array)) {
    throw new TypeError("input must be a Uint8Array");
  }
  assertPositiveInt32(options.maxInputBytes, "maxInputBytes");
  assertPositiveInt32(options.maxTopologyItems, "maxTopologyItems");
  if (options.input.byteLength === 0) {
    throw new RangeError("input must not be empty");
  }
  if (options.input.byteLength > options.maxInputBytes) {
    throw new RangeError("input exceeds maxInputBytes");
  }

  const rawReport = options.module.invariantcadReadArtifactBrep(
    options.kernel,
    options.input,
    options.maxInputBytes,
    options.maxTopologyItems,
  );
  assertDeletableReadReport(rawReport);
  let transferred: number | undefined;
  let primary: unknown;
  let hasPrimary = false;
  try {
    const diagnostics = copyReadDiagnostics(rawReport, options.kernel);
    if (
      diagnostics.inputByteCount !== options.input.byteLength ||
      diagnostics.maxInputBytes !== options.maxInputBytes ||
      diagnostics.maxTopologyItems !== options.maxTopologyItems
    ) {
      protocolError("artifact read report limits do not echo the request");
    }
    if (
      diagnostics.consumedByteCount > diagnostics.inputByteCount ||
      diagnostics.topologyItemCount > diagnostics.maxTopologyItems
    ) {
      protocolError("artifact read report counters exceed their limits");
    }
    if (!diagnostics.ok) {
      if (diagnostics.hasResult || diagnostics.transferCode !== "NO_RESULT") {
        protocolError("failed artifact read report must not retain a result");
      }
      throw new OcctArtifactReadError(diagnostics);
    }
    if (
      diagnostics.stage !== "complete" ||
      diagnostics.code !== "OK" ||
      diagnostics.consumedByteCount !== diagnostics.inputByteCount ||
      diagnostics.topologyItemCount === 0 ||
      !diagnostics.hasResult ||
      diagnostics.transferCode !== "READY"
    ) {
      protocolError("successful artifact read report is inconsistent");
    }
    const resultId = rawReport.takeResultId(options.kernel);
    assertUint32(resultId, "report.takeResultId(kernel)");
    if (resultId === 0) {
      protocolError("report.takeResultId(kernel) must return a nonzero ID");
    }
    transferred = resultId;
    if (
      readBoolean(rawReport.hasResult(), "report.hasResult() after transfer") ||
      readString(
        rawReport.transferCode(options.kernel),
        "report.transferCode(kernel) after transfer",
      ) !== "ALREADY_TRANSFERRED"
    ) {
      protocolError("artifact read result did not become transferred exactly once");
    }
  } catch (error) {
    primary = error;
    hasPrimary = true;
  }

  try {
    rawReport.delete();
  } catch (cleanup) {
    if (!hasPrimary) {
      primary = cleanup;
      hasPrimary = true;
    } else {
      primary = new AggregateError(
        [primary, cleanup],
        "OCCT artifact read and report cleanup both failed",
      );
    }
  }
  if (hasPrimary) {
    if (transferred !== undefined) {
      try {
        options.kernel.release(transferred);
      } catch (cleanup) {
        throw new AggregateError(
          [primary, cleanup],
          "OCCT artifact read and transferred-result cleanup both failed",
        );
      }
    }
    throw primary;
  }
  if (transferred === undefined) protocolError("artifact read transferred no result");
  return transferred;
}
