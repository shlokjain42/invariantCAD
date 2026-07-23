const INT32_MAX = 2_147_483_647;
const UINT32_MAX = 4_294_967_295;

export const OCCT_ARTIFACT_MAX_NATIVE_REQUESTED_BYTES = 128 * 1024 * 1024;
export const OCCT_ARTIFACT_MAX_PREFLIGHT_WORK_UNITS = 1_000_000;
export const OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH = 64;
export const OCCT_ARTIFACT_MAX_PREFLIGHT_LOCATION_POWER = 1_000_000;

export interface OcctArtifactRawKernel {
  release(resultId: number): void;
}

export interface OcctArtifactWriteRawReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly message: unknown;
  readonly maxOutputBytes: unknown;
  readonly maxNativeRequestedBytes?: unknown;
  readonly nativeRequestedBytes?: unknown;
  readonly nativeAllocationCalls?: unknown;
  readonly nativeRequestLimitExceeded?: unknown;
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
  readonly maxNativeRequestedBytes?: unknown;
  readonly nativeRequestedBytes?: unknown;
  readonly nativeAllocationCalls?: unknown;
  readonly nativeRequestLimitExceeded?: unknown;
  readonly maxPreflightWorkUnits?: unknown;
  readonly preflightWorkUnits?: unknown;
  readonly maxPreflightNestingDepth?: unknown;
  readonly preflightMaximumDepth?: unknown;
  readonly maxPreflightLocationPower?: unknown;
  readonly preflightMaximumLocationPower?: unknown;
  readonly preflightConsumedByteCount?: unknown;
  readonly preflightCode?: unknown;
  readonly archivePreflightComplete?: unknown;
  readonly deserializationStarted?: unknown;
  hasResult(): unknown;
  transferCode(kernel: OcctArtifactRawKernel): unknown;
  takeResultId(kernel: OcctArtifactRawKernel): unknown;
  delete(): void;
}

/**
 * Structural view of the bounded artifact additions in owned facade ABI
 * 0.7/0.8/0.9.
 */
export interface OcctArtifactFacadeModule {
  readonly InvariantCadArtifactWriteReport: Function;
  readonly InvariantCadArtifactReadReport: Function;
  invariantcadWriteArtifactBrep(
    kernel: OcctArtifactRawKernel,
    shapeId: number,
    maxOutputBytes: number,
    maxNativeRequestedBytes?: number,
  ): unknown;
  invariantcadReadArtifactBrep(
    kernel: OcctArtifactRawKernel,
    input: Uint8Array,
    maxInputBytes: number,
    maxTopologyItems: number,
    maxNativeRequestedBytes?: number,
    maxPreflightWorkUnits?: number,
    maxPreflightNestingDepth?: number,
    maxPreflightLocationPower?: number,
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
  readonly maxNativeRequestedBytes?: number;
  readonly nativeRequestedBytes?: number;
  readonly nativeAllocationCalls?: number;
  readonly nativeRequestLimitExceeded?: boolean;
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
  readonly maxNativeRequestedBytes?: number;
  readonly nativeRequestedBytes?: number;
  readonly nativeAllocationCalls?: number;
  readonly nativeRequestLimitExceeded?: boolean;
  readonly maxPreflightWorkUnits?: number;
  readonly preflightWorkUnits?: number;
  readonly maxPreflightNestingDepth?: number;
  readonly preflightMaximumDepth?: number;
  readonly maxPreflightLocationPower?: number;
  readonly preflightMaximumLocationPower?: number;
  readonly preflightConsumedByteCount?: number;
  readonly preflightCode?: string;
  readonly archivePreflightComplete?: boolean;
  readonly deserializationStarted?: boolean;
}

interface OcctArtifactNativeRequestDiagnostics {
  readonly maxNativeRequestedBytes: number;
  readonly nativeRequestedBytes: number;
  readonly nativeAllocationCalls: number;
  readonly nativeRequestLimitExceeded: boolean;
}

interface OcctArtifactPreflightLimits {
  readonly maxPreflightWorkUnits: number;
  readonly maxPreflightNestingDepth: number;
  readonly maxPreflightLocationPower: number;
}

interface OcctArtifactPreflightDiagnostics
  extends OcctArtifactPreflightLimits {
  readonly preflightWorkUnits: number;
  readonly preflightMaximumDepth: number;
  readonly preflightMaximumLocationPower: number;
  readonly preflightConsumedByteCount: number;
  readonly preflightCode: string;
  readonly archivePreflightComplete: boolean;
  readonly deserializationStarted: boolean;
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

function copyNativeRequestDiagnostics(
  report:
    | OcctArtifactWriteRawReport
    | OcctArtifactReadRawReport,
  requestedLimit: number | undefined,
  ok: boolean,
  code: string,
): OcctArtifactNativeRequestDiagnostics | undefined {
  if (requestedLimit === undefined) return undefined;
  const diagnostics: OcctArtifactNativeRequestDiagnostics = {
    maxNativeRequestedBytes: readCount(
      report.maxNativeRequestedBytes,
      "report.maxNativeRequestedBytes",
    ),
    nativeRequestedBytes: readCount(
      report.nativeRequestedBytes,
      "report.nativeRequestedBytes",
    ),
    nativeAllocationCalls: readCount(
      report.nativeAllocationCalls,
      "report.nativeAllocationCalls",
    ),
    nativeRequestLimitExceeded: readBoolean(
      report.nativeRequestLimitExceeded,
      "report.nativeRequestLimitExceeded",
    ),
  };
  if (diagnostics.maxNativeRequestedBytes !== requestedLimit) {
    protocolError("report native request limit does not echo the request");
  }
  if (
    diagnostics.nativeRequestedBytes > diagnostics.maxNativeRequestedBytes
  ) {
    protocolError("report native requested bytes exceed their limit");
  }
  if (ok && diagnostics.nativeRequestLimitExceeded) {
    protocolError(
      "successful artifact report must not exceed the native request limit",
    );
  }
  if (
    code === "NATIVE_REQUEST_LIMIT_EXCEEDED" &&
    !diagnostics.nativeRequestLimitExceeded
  ) {
    protocolError(
      "native request limit failure must set report.nativeRequestLimitExceeded",
    );
  }
  if (
    diagnostics.nativeRequestLimitExceeded &&
    code !== "NATIVE_REQUEST_LIMIT_EXCEEDED"
  ) {
    protocolError(
      "report.nativeRequestLimitExceeded requires a native request limit failure",
    );
  }
  return diagnostics;
}

function copyPreflightDiagnostics(
  report: OcctArtifactReadRawReport,
  requestedLimits: OcctArtifactPreflightLimits | undefined,
  code: string,
): OcctArtifactPreflightDiagnostics | undefined {
  if (requestedLimits === undefined) return undefined;
  const diagnostics: OcctArtifactPreflightDiagnostics = {
    maxPreflightWorkUnits: readCount(
      report.maxPreflightWorkUnits,
      "report.maxPreflightWorkUnits",
    ),
    preflightWorkUnits: readCount(
      report.preflightWorkUnits,
      "report.preflightWorkUnits",
    ),
    maxPreflightNestingDepth: readCount(
      report.maxPreflightNestingDepth,
      "report.maxPreflightNestingDepth",
    ),
    preflightMaximumDepth: readCount(
      report.preflightMaximumDepth,
      "report.preflightMaximumDepth",
    ),
    maxPreflightLocationPower: readCount(
      report.maxPreflightLocationPower,
      "report.maxPreflightLocationPower",
    ),
    preflightMaximumLocationPower: readCount(
      report.preflightMaximumLocationPower,
      "report.preflightMaximumLocationPower",
    ),
    preflightConsumedByteCount: readCount(
      report.preflightConsumedByteCount,
      "report.preflightConsumedByteCount",
    ),
    preflightCode: readString(
      report.preflightCode,
      "report.preflightCode",
    ),
    archivePreflightComplete: readBoolean(
      report.archivePreflightComplete,
      "report.archivePreflightComplete",
    ),
    deserializationStarted: readBoolean(
      report.deserializationStarted,
      "report.deserializationStarted",
    ),
  };
  if (
    diagnostics.maxPreflightWorkUnits !==
      requestedLimits.maxPreflightWorkUnits ||
    diagnostics.maxPreflightNestingDepth !==
      requestedLimits.maxPreflightNestingDepth ||
    diagnostics.maxPreflightLocationPower !==
      requestedLimits.maxPreflightLocationPower
  ) {
    protocolError("report preflight limits do not echo the request");
  }
  if (
    diagnostics.preflightWorkUnits > diagnostics.maxPreflightWorkUnits ||
    diagnostics.preflightMaximumDepth >
      diagnostics.maxPreflightNestingDepth ||
    diagnostics.preflightMaximumLocationPower >
      diagnostics.maxPreflightLocationPower
  ) {
    protocolError("report preflight counters exceed their limits");
  }
  if (
    diagnostics.archivePreflightComplete !==
    (diagnostics.preflightCode === "OK")
  ) {
    protocolError(
      "report preflight completion must exactly match report.preflightCode",
    );
  }
  if (
    diagnostics.archivePreflightComplete !==
    diagnostics.deserializationStarted
  ) {
    protocolError(
      "deserialization start must exactly match completed preflight",
    );
  }
  if (
    diagnostics.preflightCode === "NOT_RUN" &&
    (diagnostics.preflightWorkUnits !== 0 ||
      diagnostics.preflightMaximumDepth !== 0 ||
      diagnostics.preflightMaximumLocationPower !== 0 ||
      diagnostics.preflightConsumedByteCount !== 0)
  ) {
    protocolError("preflight counters must be zero before preflight runs");
  }
  if (
    !diagnostics.archivePreflightComplete &&
    diagnostics.preflightCode !== "NOT_RUN" &&
    code !== diagnostics.preflightCode
  ) {
    protocolError("preflight failure code does not match the report code");
  }
  return diagnostics;
}

function copyWriteDiagnostics(
  report: OcctArtifactWriteRawReport,
  maxNativeRequestedBytes: number | undefined,
): OcctArtifactWriteDiagnostics {
  const ok = readBoolean(report.ok, "report.ok");
  const code = readString(report.code, "report.code");
  const nativeRequest = copyNativeRequestDiagnostics(
    report,
    maxNativeRequestedBytes,
    ok,
    code,
  );
  return Object.freeze({
    ok,
    stage: readString(report.stage, "report.stage"),
    code,
    message: readString(report.message, "report.message"),
    maxOutputBytes: readCount(
      report.maxOutputBytes,
      "report.maxOutputBytes",
    ),
    byteCount: readCount(report.byteCount(), "report.byteCount()"),
    hasBytes: readBoolean(report.hasBytes(), "report.hasBytes()"),
    ...(nativeRequest ?? {}),
  });
}

function copyReadDiagnostics(
  report: OcctArtifactReadRawReport,
  kernel: OcctArtifactRawKernel,
  maxNativeRequestedBytes: number | undefined,
  preflightLimits: OcctArtifactPreflightLimits | undefined,
): OcctArtifactReadDiagnostics {
  const ok = readBoolean(report.ok, "report.ok");
  const code = readString(report.code, "report.code");
  const nativeRequest = copyNativeRequestDiagnostics(
    report,
    maxNativeRequestedBytes,
    ok,
    code,
  );
  const preflight = copyPreflightDiagnostics(
    report,
    preflightLimits,
    code,
  );
  return Object.freeze({
    ok,
    stage: readString(report.stage, "report.stage"),
    code,
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
    ...(nativeRequest ?? {}),
    ...(preflight ?? {}),
  });
}

export interface WriteBoundedOcctArtifactBrepOptions {
  readonly module: unknown;
  readonly kernel: OcctArtifactRawKernel;
  readonly shapeId: number;
  readonly maxOutputBytes: number;
  readonly maxNativeRequestedBytes?: number;
}

/** Copies a native-capped binary BREP into one detached caller-owned array. */
export function writeBoundedOcctArtifactBrep(
  options: WriteBoundedOcctArtifactBrepOptions,
): Uint8Array {
  assertModule(options.module);
  assertKernel(options.kernel);
  assertUint32(options.shapeId, "shapeId");
  assertPositiveInt32(options.maxOutputBytes, "maxOutputBytes");
  if (options.maxNativeRequestedBytes !== undefined) {
    assertPositiveInt32(
      options.maxNativeRequestedBytes,
      "maxNativeRequestedBytes",
    );
  }

  const rawReport =
    options.maxNativeRequestedBytes === undefined
      ? options.module.invariantcadWriteArtifactBrep(
          options.kernel,
          options.shapeId,
          options.maxOutputBytes,
        )
      : options.module.invariantcadWriteArtifactBrep(
          options.kernel,
          options.shapeId,
          options.maxOutputBytes,
          options.maxNativeRequestedBytes,
        );
  assertDeletableWriteReport(rawReport);
  let primary: unknown;
  let hasPrimary = false;
  let output: Uint8Array | undefined;
  try {
    const diagnostics = copyWriteDiagnostics(
      rawReport,
      options.maxNativeRequestedBytes,
    );
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
  readonly maxNativeRequestedBytes?: number;
  readonly maxPreflightWorkUnits?: number;
  readonly maxPreflightNestingDepth?: number;
  readonly maxPreflightLocationPower?: number;
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
  if (options.maxNativeRequestedBytes !== undefined) {
    assertPositiveInt32(
      options.maxNativeRequestedBytes,
      "maxNativeRequestedBytes",
    );
  }
  const hasAnyPreflightLimit =
    options.maxPreflightWorkUnits !== undefined ||
    options.maxPreflightNestingDepth !== undefined ||
    options.maxPreflightLocationPower !== undefined;
  const hasEveryPreflightLimit =
    options.maxPreflightWorkUnits !== undefined &&
    options.maxPreflightNestingDepth !== undefined &&
    options.maxPreflightLocationPower !== undefined;
  if (hasAnyPreflightLimit !== hasEveryPreflightLimit) {
    throw new TypeError("preflight limits must be supplied together");
  }
  if (hasEveryPreflightLimit && options.maxNativeRequestedBytes === undefined) {
    throw new TypeError(
      "preflight limits require maxNativeRequestedBytes",
    );
  }
  const preflightLimits: OcctArtifactPreflightLimits | undefined =
    hasEveryPreflightLimit
      ? {
          maxPreflightWorkUnits: options.maxPreflightWorkUnits,
          maxPreflightNestingDepth: options.maxPreflightNestingDepth,
          maxPreflightLocationPower: options.maxPreflightLocationPower,
        }
      : undefined;
  if (preflightLimits !== undefined) {
    assertPositiveInt32(
      preflightLimits.maxPreflightWorkUnits,
      "maxPreflightWorkUnits",
    );
    assertPositiveInt32(
      preflightLimits.maxPreflightNestingDepth,
      "maxPreflightNestingDepth",
    );
    if (
      preflightLimits.maxPreflightNestingDepth >
      OCCT_ARTIFACT_MAX_PREFLIGHT_NESTING_DEPTH
    ) {
      throw new RangeError("maxPreflightNestingDepth must not exceed 64");
    }
    assertPositiveInt32(
      preflightLimits.maxPreflightLocationPower,
      "maxPreflightLocationPower",
    );
  }
  if (options.input.byteLength === 0) {
    throw new RangeError("input must not be empty");
  }
  if (options.input.byteLength > options.maxInputBytes) {
    throw new RangeError("input exceeds maxInputBytes");
  }

  const rawReport =
    preflightLimits !== undefined
      ? options.module.invariantcadReadArtifactBrep(
          options.kernel,
          options.input,
          options.maxInputBytes,
          options.maxTopologyItems,
          options.maxNativeRequestedBytes,
          preflightLimits.maxPreflightWorkUnits,
          preflightLimits.maxPreflightNestingDepth,
          preflightLimits.maxPreflightLocationPower,
        )
      : options.maxNativeRequestedBytes === undefined
      ? options.module.invariantcadReadArtifactBrep(
          options.kernel,
          options.input,
          options.maxInputBytes,
          options.maxTopologyItems,
        )
      : options.module.invariantcadReadArtifactBrep(
          options.kernel,
          options.input,
          options.maxInputBytes,
          options.maxTopologyItems,
          options.maxNativeRequestedBytes,
        );
  assertDeletableReadReport(rawReport);
  let transferred: number | undefined;
  let primary: unknown;
  let hasPrimary = false;
  try {
    const diagnostics = copyReadDiagnostics(
      rawReport,
      options.kernel,
      options.maxNativeRequestedBytes,
      preflightLimits,
    );
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
    if (preflightLimits !== undefined) {
      const preflightConsumed = diagnostics.preflightConsumedByteCount;
      const preflightCode = diagnostics.preflightCode;
      const preflightComplete = diagnostics.archivePreflightComplete;
      const deserializationStarted = diagnostics.deserializationStarted;
      if (
        preflightConsumed === undefined ||
        preflightCode === undefined ||
        preflightComplete === undefined ||
        deserializationStarted === undefined
      ) {
        protocolError("artifact read report omitted preflight diagnostics");
      }
      if (preflightConsumed > diagnostics.inputByteCount) {
        protocolError("preflight consumed bytes exceed the input length");
      }
      if (
        preflightComplete &&
        preflightConsumed !== diagnostics.inputByteCount
      ) {
        protocolError("completed preflight must consume the exact input");
      }
      if (
        !preflightComplete &&
        (diagnostics.consumedByteCount !== 0 ||
          diagnostics.topologyItemCount !== 0)
      ) {
        protocolError(
          "incomplete preflight must precede all OCCT decode counters",
        );
      }
      if (
        !preflightComplete &&
        preflightCode !== "NOT_RUN" &&
        diagnostics.stage !== "preflight"
      ) {
        protocolError("preflight rejection must use the preflight stage");
      }
      if (diagnostics.ok && (!preflightComplete || !deserializationStarted)) {
        protocolError("successful artifact read must complete preflight first");
      }
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
