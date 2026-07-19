import {
  validateCompleteIndexedTopologyEvolutionEnvelope,
  type IndexedTopologyCounts,
  type IndexedTopologyEvolutionEnvelope,
  type IndexedTopologyEvolutionRecord,
} from "./topology-evolution.js";

const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;
const UINT32_MAX = 4_294_967_295;
// Copying an Embind record crosses the JS/Wasm boundary and materializes a
// six-field object. Reject absurd advertised histories before any indexed
// accessor calls can consume unbounded time or heap.
export const DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT = 1_000_000;

const TOPOLOGY_KIND_NONE = -1;
const TOPOLOGY_KINDS = new Set([0, 1, 2]);

export type OcctBooleanOperation = "union" | "subtract" | "intersect";

/** Stable operation codes shared with the owned OCCT facade ABI 0.4. */
export const OCCT_BOOLEAN_OPERATION_CODE = Object.freeze({
  union: 0,
  subtract: 1,
  intersect: 2,
} as const satisfies Readonly<Record<OcctBooleanOperation, number>>);

/** Input-only Embind vector used by the owned Boolean facade global. */
export interface OcctBooleanEmbindVectorUint32 {
  push_back(value: number): void;
  delete(): void;
}

/** Raw OCCT kernel surface that owns transferred arena results. */
export interface OcctBooleanRawKernel {
  release(resultId: number): void;
}

interface OcctBooleanRawCounts {
  readonly faces: unknown;
  readonly edges: unknown;
  readonly vertices: unknown;
}

interface OcctBooleanRawRecord {
  readonly sourceShapeIndex: unknown;
  readonly sourceKind: unknown;
  readonly sourceIndex: unknown;
  readonly relation: unknown;
  readonly resultKind: unknown;
  readonly resultIndex: unknown;
}

/** Structural view of a Boolean report returned by the generated ABI 0.4 glue. */
export interface OcctBooleanRawReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly message: unknown;
  readonly operation: unknown;
  readonly requestedToolCount: unknown;
  readonly buildCount: unknown;
  readonly failedToolIndex: unknown;
  readonly historyProblemDomain: unknown;
  readonly historyProblemSourceShapeIndex: unknown;
  readonly historyProblemKind: unknown;
  readonly historyProblemIndex: unknown;
  hasResult(): unknown;
  transferCode(kernel: OcctBooleanRawKernel): unknown;
  takeResultId(kernel: OcctBooleanRawKernel): unknown;
  topologyHistoryVersion(): unknown;
  topologyHistoryComplete(): unknown;
  topologyInputShapeCount(): unknown;
  topologyInputCounts(sourceShapeIndex: number): OcctBooleanRawCounts;
  topologyResultCounts(): OcctBooleanRawCounts;
  topologyRecordCount(): unknown;
  topologyRecord(recordIndex: number): OcctBooleanRawRecord;
  delete(): void;
}

/** Minimal already-probed ABI 0.4 module surface consumed by this adapter. */
export interface OcctBooleanFacadeModule {
  readonly VectorUint32: new () => OcctBooleanEmbindVectorUint32;
  invariantcadBooleanAtomic(
    kernel: OcctBooleanRawKernel,
    operation: number,
    targetId: number,
    toolIds: OcctBooleanEmbindVectorUint32,
    maxHistoryRecords: number,
  ): unknown;
}

export interface OcctBooleanReportDiagnostics {
  readonly ok: boolean;
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly operation: number;
  readonly requestedToolCount: number;
  readonly buildCount: number;
  readonly failedToolIndex: number;
  readonly historyProblemDomain: string;
  readonly historyProblemSourceShapeIndex: number;
  readonly historyProblemKind: number;
  readonly historyProblemIndex: number;
  readonly hasResult: boolean;
  readonly topologyHistoryVersion: number;
  readonly topologyHistoryComplete: boolean;
}

export interface OcctBooleanReportSnapshot {
  readonly diagnostics: OcctBooleanReportDiagnostics;
  readonly evolution: IndexedTopologyEvolutionEnvelope;
  readonly transferCode: "READY";
}

export interface OcctBooleanTransferredResult {
  readonly resultId: number;
  readonly report: OcctBooleanReportSnapshot;
}

export interface AdoptOcctBooleanOptions<T> {
  readonly module: unknown;
  readonly kernel: OcctBooleanRawKernel;
  readonly operation: OcctBooleanOperation;
  readonly targetId: number;
  readonly toolIds: readonly number[];
  /** Maximum number of native history records copied into JavaScript. */
  readonly maxHistoryRecords?: number;
  /** Runs after READY validation but before the report transfers its result. */
  readonly validate?: (report: OcctBooleanReportSnapshot) => void;
  /**
   * Takes ownership of the transferred result only by returning successfully.
   * A throw releases the transferred root exactly once through `kernel`.
   */
  readonly adopt: (result: OcctBooleanTransferredResult) => T;
}

/** A malformed ABI surface or report is authoritative protocol failure. */
export class OcctBooleanFacadeProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid InvariantCAD OCCT Boolean facade: ${message}`);
    this.name = "OcctBooleanFacadeProtocolError";
  }
}

/** A well-formed native report describing an unsuccessful Boolean operation. */
export class OcctBooleanOperationError extends Error {
  readonly diagnostics: OcctBooleanReportDiagnostics;

  constructor(diagnostics: OcctBooleanReportDiagnostics) {
    super(
      `OCCT Boolean failed at '${diagnostics.stage}' with '${diagnostics.code}': ${diagnostics.message}`,
    );
    this.name = "OcctBooleanOperationError";
    this.diagnostics = diagnostics;
  }
}

function protocolError(message: string): never {
  throw new OcctBooleanFacadeProtocolError(message);
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
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

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") protocolError(`${label} must be a string`);
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") protocolError(`${label} must be a boolean`);
  return value;
}

function operationCode(operation: unknown): number {
  switch (operation) {
    case "union":
    case "subtract":
    case "intersect":
      return OCCT_BOOLEAN_OPERATION_CODE[operation];
    default:
      return protocolError(
        `operation must be 'union', 'subtract', or 'intersect', received '${String(operation)}'`,
      );
  }
}

const REPORT_METHODS = Object.freeze([
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
  "delete",
] as const);

function assertModule(value: unknown): asserts value is OcctBooleanFacadeModule {
  if (!isObject(value)) protocolError("module must be an object");
  if (typeof value.VectorUint32 !== "function") {
    protocolError("module.VectorUint32 must be an Embind constructor");
  }
  if (typeof value.invariantcadBooleanAtomic !== "function") {
    protocolError("module.invariantcadBooleanAtomic must be a function");
  }
}

function assertDeletableRawReport(
  value: unknown,
): asserts value is Record<PropertyKey, unknown> & { delete(): void } {
  if (!isObject(value)) {
    protocolError("invariantcadBooleanAtomic() must return a report object");
  }
  if (typeof value.delete !== "function") {
    protocolError("report.delete must be a function");
  }
}

function assertRawReport(value: unknown): asserts value is OcctBooleanRawReport {
  assertDeletableRawReport(value);
  for (const method of REPORT_METHODS) {
    if (typeof value[method] !== "function") {
      protocolError(`report.${method} must be a function`);
    }
  }
}

function copyCounts(value: unknown, label: string): IndexedTopologyCounts {
  if (!isObject(value)) protocolError(`${label} must be an object`);
  const faces = value.faces;
  const edges = value.edges;
  const vertices = value.vertices;
  assertCount(faces, `${label}.faces`);
  assertCount(edges, `${label}.edges`);
  assertCount(vertices, `${label}.vertices`);
  return Object.freeze({ faces, edges, vertices });
}

function copyRecord(
  value: unknown,
  label: string,
): IndexedTopologyEvolutionRecord {
  if (!isObject(value)) protocolError(`${label} must be an object`);
  const sourceShapeIndex = value.sourceShapeIndex;
  const sourceKind = value.sourceKind;
  const sourceIndex = value.sourceIndex;
  const relation = value.relation;
  const resultKind = value.resultKind;
  const resultIndex = value.resultIndex;
  assertSignedInt32(sourceShapeIndex, `${label}.sourceShapeIndex`);
  assertSignedInt32(sourceKind, `${label}.sourceKind`);
  assertSignedInt32(sourceIndex, `${label}.sourceIndex`);
  assertSignedInt32(relation, `${label}.relation`);
  assertSignedInt32(resultKind, `${label}.resultKind`);
  assertSignedInt32(resultIndex, `${label}.resultIndex`);
  return Object.freeze({
    sourceShapeIndex,
    sourceKind,
    sourceIndex,
    relation,
    resultKind,
    resultIndex,
  });
}

function copyDiagnostics(
  report: OcctBooleanRawReport,
  topologyHistoryVersion: number,
  topologyHistoryComplete: boolean,
): OcctBooleanReportDiagnostics {
  const ok = readBoolean(report.ok, "report.ok");
  const stage = readString(report.stage, "report.stage");
  const code = readString(report.code, "report.code");
  const message = readString(report.message, "report.message");
  const operation = report.operation;
  const requestedToolCount = report.requestedToolCount;
  const buildCount = report.buildCount;
  const failedToolIndex = report.failedToolIndex;
  const historyProblemDomain = readString(
    report.historyProblemDomain,
    "report.historyProblemDomain",
  );
  const historyProblemSourceShapeIndex = report.historyProblemSourceShapeIndex;
  const historyProblemKind = report.historyProblemKind;
  const historyProblemIndex = report.historyProblemIndex;
  const hasResult = readBoolean(report.hasResult(), "report.hasResult()");

  assertSignedInt32(operation, "report.operation");
  assertCount(requestedToolCount, "report.requestedToolCount");
  assertCount(buildCount, "report.buildCount");
  assertSignedInt32(failedToolIndex, "report.failedToolIndex");
  assertSignedInt32(
    historyProblemSourceShapeIndex,
    "report.historyProblemSourceShapeIndex",
  );
  assertSignedInt32(historyProblemKind, "report.historyProblemKind");
  assertSignedInt32(historyProblemIndex, "report.historyProblemIndex");

  return Object.freeze({
    ok,
    stage,
    code,
    message,
    operation,
    requestedToolCount,
    buildCount,
    failedToolIndex,
    historyProblemDomain,
    historyProblemSourceShapeIndex,
    historyProblemKind,
    historyProblemIndex,
    hasResult,
    topologyHistoryVersion,
    topologyHistoryComplete,
  });
}

function validateHistoryProblem(
  diagnostics: OcctBooleanReportDiagnostics,
): void {
  const { historyProblemDomain: domain } = diagnostics;
  if (domain !== "none" && domain !== "source" && domain !== "result") {
    protocolError(
      `report.historyProblemDomain is '${domain}', expected 'none', 'source', or 'result'`,
    );
  }
  if (domain === "none") {
    if (
      diagnostics.historyProblemSourceShapeIndex !== -1 ||
      diagnostics.historyProblemKind !== TOPOLOGY_KIND_NONE ||
      diagnostics.historyProblemIndex !== -1
    ) {
      protocolError("report uses non-sentinel history fields without a problem domain");
    }
    return;
  }
  if (!TOPOLOGY_KINDS.has(diagnostics.historyProblemKind)) {
    protocolError("report.historyProblemKind must identify face, edge, or vertex");
  }
  if (diagnostics.historyProblemIndex < -1) {
    protocolError(
      "report.historyProblemIndex must be -1 for a domain-level failure or a non-negative topology index",
    );
  }
  if (domain === "source") {
    if (
      diagnostics.historyProblemSourceShapeIndex < 0 ||
      diagnostics.historyProblemSourceShapeIndex > diagnostics.requestedToolCount
    ) {
      protocolError("report history source-shape index is out of range");
    }
  } else if (diagnostics.historyProblemSourceShapeIndex !== -1) {
    protocolError("report must use source-shape sentinel -1 for a result problem");
  }
}

function expectedBuildCount(
  operation: OcctBooleanOperation,
  toolCount: number,
): number {
  return operation === "subtract" ? 1 : toolCount;
}

function validateReportSemantics(
  diagnostics: OcctBooleanReportDiagnostics,
  operation: OcctBooleanOperation,
  requestedToolCount: number,
): void {
  const requestedOperation = OCCT_BOOLEAN_OPERATION_CODE[operation];
  if (diagnostics.operation !== requestedOperation) {
    protocolError(
      `report.operation is ${diagnostics.operation}, expected ${requestedOperation}`,
    );
  }
  if (diagnostics.requestedToolCount !== requestedToolCount) {
    protocolError(
      `report.requestedToolCount is ${diagnostics.requestedToolCount}, expected ${requestedToolCount}`,
    );
  }
  validateHistoryProblem(diagnostics);

  const expectedBuilds = expectedBuildCount(operation, requestedToolCount);
  if (diagnostics.buildCount > expectedBuilds) {
    protocolError(
      `report.buildCount is ${diagnostics.buildCount}, expected at most ${expectedBuilds}`,
    );
  }

  if (!diagnostics.ok) {
    if (diagnostics.hasResult) {
      protocolError("failed report unexpectedly owns a result");
    }
    if (diagnostics.topologyHistoryComplete) {
      protocolError("failed report unexpectedly exposes complete history");
    }
    if (diagnostics.topologyHistoryVersion !== 0) {
      protocolError(
        `failed report history version is ${diagnostics.topologyHistoryVersion}, expected 0`,
      );
    }
    if (diagnostics.stage === "complete" || diagnostics.code === "OK") {
      protocolError("failed report uses successful stage or code diagnostics");
    }
    if (
      diagnostics.failedToolIndex < -1 ||
      diagnostics.failedToolIndex >= requestedToolCount
    ) {
      protocolError("report.failedToolIndex is outside the requested tool list");
    }
    return;
  }

  if (diagnostics.stage !== "complete" || diagnostics.code !== "OK") {
    protocolError("successful report must have stage 'complete' and code 'OK'");
  }
  if (!diagnostics.hasResult) {
    protocolError("successful report does not own a result");
  }
  if (
    diagnostics.topologyHistoryVersion !== 1 ||
    !diagnostics.topologyHistoryComplete
  ) {
    protocolError(
      "successful report must expose complete topology history version 1",
    );
  }
  if (diagnostics.buildCount !== expectedBuilds) {
    protocolError(
      `successful report.buildCount is ${diagnostics.buildCount}, expected ${expectedBuilds}`,
    );
  }
  if (diagnostics.failedToolIndex !== -1) {
    protocolError("successful report must use failed-tool sentinel -1");
  }
  if (diagnostics.historyProblemDomain !== "none") {
    protocolError("successful report cannot identify a history problem");
  }
}

function copyEvolution(
  report: OcctBooleanRawReport,
  version: number,
  complete: boolean,
  expectedInputShapeCount: number,
  maxHistoryRecords: number,
): IndexedTopologyEvolutionEnvelope | undefined {
  if (!complete) return undefined;

  const inputShapeCount = report.topologyInputShapeCount();
  assertCount(inputShapeCount, "report.topologyInputShapeCount()");
  if (inputShapeCount !== expectedInputShapeCount) {
    protocolError(
      `report.topologyInputShapeCount() is ${inputShapeCount}, expected ${expectedInputShapeCount}`,
    );
  }
  const inputCounts: IndexedTopologyCounts[] = [];
  for (let index = 0; index < inputShapeCount; index += 1) {
    inputCounts.push(
      copyCounts(
        report.topologyInputCounts(index),
        `report.topologyInputCounts(${index})`,
      ),
    );
  }
  const resultCounts = copyCounts(
    report.topologyResultCounts(),
    "report.topologyResultCounts()",
  );
  const recordCount = report.topologyRecordCount();
  assertCount(recordCount, "report.topologyRecordCount()");
  const sourceItemCount = inputCounts.reduce(
    (total, counts) =>
      total + BigInt(counts.faces) + BigInt(counts.edges) + BigInt(counts.vertices),
    0n,
  );
  const resultItemCount =
    BigInt(resultCounts.faces) +
    BigInt(resultCounts.edges) +
    BigInt(resultCounts.vertices);
  // With at most one relation per source/result pair, one DELETED per source,
  // and one source-less CREATED per result, this is a strict structural ceiling
  // even for a fully connected Boolean history graph.
  const structuralMaximum =
    sourceItemCount * resultItemCount + sourceItemCount + resultItemCount;
  if (BigInt(recordCount) > structuralMaximum) {
    protocolError(
      `report.topologyRecordCount() is ${recordCount}, exceeding the structural Boolean graph maximum ${structuralMaximum}`,
    );
  }
  if (recordCount > maxHistoryRecords) {
    throw new RangeError(
      `Exact Boolean topology history has ${recordCount} records, exceeding the configured JavaScript copy limit ${maxHistoryRecords}`,
    );
  }
  const records: IndexedTopologyEvolutionRecord[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    records.push(
      copyRecord(report.topologyRecord(index), `report.topologyRecord(${index})`),
    );
  }
  return Object.freeze({
    version,
    complete,
    inputShapeCount,
    inputCounts: Object.freeze(inputCounts),
    resultCounts,
    records: Object.freeze(records),
  });
}

function makeToolVector(
  module: OcctBooleanFacadeModule,
  toolIds: readonly number[],
): OcctBooleanEmbindVectorUint32 {
  const vector = new module.VectorUint32();
  try {
    for (const toolId of toolIds) vector.push_back(toolId);
    return vector;
  } catch (error) {
    vector.delete();
    throw error;
  }
}

/**
 * Executes one owned exact Boolean as a strict transfer transaction.
 *
 * Native data is copied, frozen, and validated before `takeResultId`. The raw
 * report is deleted before caller adoption, and a transferred result is
 * released exactly once when adoption does not complete successfully.
 */
export function adoptOcctBoolean<T>(options: AdoptOcctBooleanOptions<T>): T {
  assertModule(options.module);
  if (!isObject(options.kernel) || typeof options.kernel.release !== "function") {
    protocolError("kernel must provide release(resultId)");
  }
  const code = operationCode(options.operation);
  const maxHistoryRecords =
    options.maxHistoryRecords ??
    DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT;
  assertCount(maxHistoryRecords, "maxHistoryRecords");
  assertUint32(options.targetId, "targetId");
  if (!Array.isArray(options.toolIds)) {
    protocolError("toolIds must be an array");
  }
  if (options.toolIds.length === 0) {
    protocolError("toolIds must contain at least one tool shape");
  }
  if (options.toolIds.length >= INT32_MAX) {
    protocolError("toolIds length exceeds the signed 32-bit facade limit");
  }
  const toolIds = Array.from(options.toolIds, (toolId, index) => {
    assertUint32(toolId, `toolIds[${index}]`);
    return toolId;
  });

  let resultToRelease: number | undefined;
  try {
    let report: OcctBooleanRawReport | undefined;
    let reportToDelete:
      | (Record<PropertyKey, unknown> & { delete(): void })
      | undefined;
    let transferred: OcctBooleanTransferredResult;
    try {
      const vector = makeToolVector(options.module, toolIds);
      try {
        const rawReport = options.module.invariantcadBooleanAtomic(
          options.kernel,
          code,
          options.targetId,
          vector,
          maxHistoryRecords,
        );
        assertDeletableRawReport(rawReport);
        reportToDelete = rawReport;
        assertRawReport(rawReport);
        report = rawReport;
      } finally {
        vector.delete();
      }

      const topologyHistoryVersion = report.topologyHistoryVersion();
      assertSignedInt32(
        topologyHistoryVersion,
        "report.topologyHistoryVersion()",
      );
      const topologyHistoryComplete = readBoolean(
        report.topologyHistoryComplete(),
        "report.topologyHistoryComplete()",
      );
      const diagnostics = copyDiagnostics(
        report,
        topologyHistoryVersion,
        topologyHistoryComplete,
      );
      validateReportSemantics(diagnostics, options.operation, toolIds.length);
      if (!diagnostics.ok) throw new OcctBooleanOperationError(diagnostics);

      const evolution = copyEvolution(
        report,
        topologyHistoryVersion,
        topologyHistoryComplete,
        toolIds.length + 1,
        maxHistoryRecords,
      );
      if (evolution === undefined) {
        protocolError("successful report does not provide complete history");
      }
      validateCompleteIndexedTopologyEvolutionEnvelope(evolution, {
        allowCreated: true,
      });

      const transferCode = readString(
        report.transferCode(options.kernel),
        "report.transferCode()",
      );
      if (transferCode !== "READY") {
        protocolError(
          `report transfer state is '${transferCode}', expected 'READY'`,
        );
      }
      const snapshot: OcctBooleanReportSnapshot = Object.freeze({
        diagnostics,
        evolution,
        transferCode: "READY",
      });
      options.validate?.(snapshot);

      const resultId = report.takeResultId(options.kernel);
      assertUint32(resultId, "report.takeResultId()");
      if (resultId === 0) {
        protocolError("report.takeResultId() returned reserved result ID 0");
      }
      resultToRelease = resultId;
      transferred = Object.freeze({ resultId, report: snapshot });
    } finally {
      reportToDelete?.delete();
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
