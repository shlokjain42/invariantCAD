import {
  validateCompleteIndexedTopologyEvolutionEnvelope,
  type IndexedTopologyCounts,
  type IndexedTopologyEvolutionEnvelope,
  type IndexedTopologyEvolutionRecord,
} from "./topology-evolution.js";

const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;
const UINT32_MAX = 4_294_967_295;
const TOPOLOGY_KIND_NONE = -1;
const TOPOLOGY_KINDS = new Set([0, 1, 2]);
const MAX_BREP_OFFSET_ERROR = 10;

/** Independent JavaScript copy ceiling for exact shell/offset history. */
export const DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT = 1_000_000;

export type OcctSolidOffsetOperation = "shell" | "offset";
export type OcctSolidOffsetDirection = "inward" | "outward";

export const OCCT_SOLID_OFFSET_OPERATION_CODE = Object.freeze({
  shell: 0,
  offset: 1,
} as const satisfies Readonly<Record<OcctSolidOffsetOperation, number>>);

export const OCCT_SOLID_OFFSET_DIRECTION_CODE = Object.freeze({
  inward: 0,
  outward: 1,
} as const satisfies Readonly<Record<OcctSolidOffsetDirection, number>>);

export interface OcctSolidOffsetEmbindVectorUint32 {
  push_back(value: number): void;
  delete(): void;
}

export interface OcctSolidOffsetRawKernel {
  release(resultId: number): void;
}

interface OcctSolidOffsetRawCounts {
  readonly faces: unknown;
  readonly edges: unknown;
  readonly vertices: unknown;
}

interface OcctSolidOffsetRawRecord {
  readonly sourceShapeIndex: unknown;
  readonly sourceKind: unknown;
  readonly sourceIndex: unknown;
  readonly relation: unknown;
  readonly resultKind: unknown;
  readonly resultIndex: unknown;
}

/** Structural view of the native `InvariantCadSolidOffsetReport`. */
export interface InvariantCadSolidOffsetReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly message: unknown;
  readonly operation: unknown;
  readonly direction: unknown;
  readonly amount: unknown;
  readonly tolerance: unknown;
  readonly requestedOpeningFaceCount: unknown;
  readonly buildCount: unknown;
  readonly occtStatus: unknown;
  readonly failedOpeningFaceIndex: unknown;
  readonly historyProblemDomain: unknown;
  readonly historyProblemSourceShapeIndex: unknown;
  readonly historyProblemKind: unknown;
  readonly historyProblemIndex: unknown;
  selectedOpeningFaceCount(): unknown;
  selectedOpeningFaceIndex(selectedIndex: number): unknown;
  hasResult(): unknown;
  transferCode(kernel: OcctSolidOffsetRawKernel): unknown;
  takeResultId(kernel: OcctSolidOffsetRawKernel): unknown;
  topologyHistoryVersion(): unknown;
  topologyHistoryComplete(): unknown;
  topologyInputShapeCount(): unknown;
  topologyInputCounts(sourceShapeIndex: number): OcctSolidOffsetRawCounts;
  topologyResultCounts(): OcctSolidOffsetRawCounts;
  topologyRecordCount(): unknown;
  topologyRecord(recordIndex: number): OcctSolidOffsetRawRecord;
  delete(): void;
}

export type OcctSolidOffsetRawReport = InvariantCadSolidOffsetReport;

/** Structural view of the ABI 0.6 generated facade module. */
export interface OcctSolidOffsetFacadeModule {
  readonly VectorUint32: new () => OcctSolidOffsetEmbindVectorUint32;
  readonly InvariantCadSolidOffsetOperation: Readonly<Record<string, unknown>>;
  readonly InvariantCadSolidOffsetDirection: Readonly<Record<string, unknown>>;
  readonly InvariantCadSolidOffsetReport: Function;
  invariantcadSolidOffsetAtomic(
    kernel: OcctSolidOffsetRawKernel,
    operation: number,
    inputId: number,
    openingFaceIds: OcctSolidOffsetEmbindVectorUint32,
    amount: number,
    direction: number,
    tolerance: number,
    maxHistoryRecords: number,
  ): unknown;
}

export interface OcctSolidOffsetReportDiagnostics {
  readonly ok: boolean;
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly operation: number;
  readonly direction: number;
  readonly amount: number;
  readonly tolerance: number;
  readonly requestedOpeningFaceCount: number;
  readonly buildCount: number;
  readonly occtStatus: number;
  readonly failedOpeningFaceIndex: number;
  readonly historyProblemDomain: string;
  readonly historyProblemSourceShapeIndex: number;
  readonly historyProblemKind: number;
  readonly historyProblemIndex: number;
  readonly hasResult: boolean;
  readonly topologyHistoryVersion: number;
  readonly topologyHistoryComplete: boolean;
}

export interface OcctSolidOffsetReportSnapshot {
  readonly diagnostics: OcctSolidOffsetReportDiagnostics;
  readonly selectedOpeningFaceIndices: readonly number[];
  readonly evolution: IndexedTopologyEvolutionEnvelope;
  readonly transferCode: "READY";
}

export interface OcctSolidOffsetTransferredResult {
  readonly resultId: number;
  readonly report: OcctSolidOffsetReportSnapshot;
}

export interface AdoptOcctSolidOffsetOptions<T> {
  readonly module: unknown;
  readonly kernel: OcctSolidOffsetRawKernel;
  readonly operation: OcctSolidOffsetOperation;
  readonly inputId: number;
  readonly openingFaceIds: readonly number[];
  readonly selectedOpeningFaceIndices: readonly number[];
  readonly amount: number;
  readonly direction: OcctSolidOffsetDirection;
  readonly tolerance: number;
  readonly maxHistoryRecords?: number;
  /** Runs after exact-history and READY validation, before result transfer. */
  readonly validate?: (report: OcctSolidOffsetReportSnapshot) => void;
  /** Owns the transferred result only by returning successfully. */
  readonly adopt: (result: OcctSolidOffsetTransferredResult) => T;
}

export class OcctSolidOffsetFacadeProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid InvariantCAD OCCT solid-offset facade: ${message}`);
    this.name = "OcctSolidOffsetFacadeProtocolError";
  }
}

export class OcctSolidOffsetOperationError extends Error {
  readonly diagnostics: OcctSolidOffsetReportDiagnostics;

  constructor(diagnostics: OcctSolidOffsetReportDiagnostics) {
    super(
      `OCCT ${diagnostics.operation === OCCT_SOLID_OFFSET_OPERATION_CODE.shell ? "shell" : "offset"} failed at '${diagnostics.stage}' with '${diagnostics.code}': ${diagnostics.message}`,
    );
    this.name = "OcctSolidOffsetOperationError";
    this.diagnostics = diagnostics;
  }
}

function protocolError(message: string): never {
  throw new OcctSolidOffsetFacadeProtocolError(message);
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

function readFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    protocolError(`${label} must be finite`);
  }
  return value;
}

function operationCode(operation: unknown): number {
  switch (operation) {
    case "shell":
      return OCCT_SOLID_OFFSET_OPERATION_CODE.shell;
    case "offset":
      return OCCT_SOLID_OFFSET_OPERATION_CODE.offset;
    default:
      return protocolError(
        `operation must be 'shell' or 'offset', received '${String(operation)}'`,
      );
  }
}

function directionCode(direction: unknown): number {
  switch (direction) {
    case "inward":
      return OCCT_SOLID_OFFSET_DIRECTION_CODE.inward;
    case "outward":
      return OCCT_SOLID_OFFSET_DIRECTION_CODE.outward;
    default:
      return protocolError(
        `direction must be 'inward' or 'outward', received '${String(direction)}'`,
      );
  }
}

const REPORT_METHODS = Object.freeze([
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
  "delete",
] as const);

function assertModule(value: unknown): asserts value is OcctSolidOffsetFacadeModule {
  if (!isObject(value)) protocolError("module must be an object");
  if (typeof value.VectorUint32 !== "function") {
    protocolError("module.VectorUint32 must be an Embind constructor");
  }
  if (typeof value.invariantcadSolidOffsetAtomic !== "function") {
    protocolError("module.invariantcadSolidOffsetAtomic must be a function");
  }
}

function assertDeletableReport(
  value: unknown,
): asserts value is Record<PropertyKey, unknown> & { delete(): void } {
  if (!isObject(value)) {
    protocolError("invariantcadSolidOffsetAtomic() must return a report object");
  }
  if (typeof value.delete !== "function") {
    protocolError("report.delete must be a function");
  }
}

function assertRawReport(value: unknown): asserts value is InvariantCadSolidOffsetReport {
  assertDeletableReport(value);
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

function copyRecord(value: unknown, label: string): IndexedTopologyEvolutionRecord {
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
  report: InvariantCadSolidOffsetReport,
  topologyHistoryVersion: number,
  topologyHistoryComplete: boolean,
): OcctSolidOffsetReportDiagnostics {
  const operation = report.operation;
  const direction = report.direction;
  const requestedOpeningFaceCount = report.requestedOpeningFaceCount;
  const buildCount = report.buildCount;
  const occtStatus = report.occtStatus;
  const failedOpeningFaceIndex = report.failedOpeningFaceIndex;
  const historyProblemSourceShapeIndex = report.historyProblemSourceShapeIndex;
  const historyProblemKind = report.historyProblemKind;
  const historyProblemIndex = report.historyProblemIndex;
  assertSignedInt32(operation, "report.operation");
  assertSignedInt32(direction, "report.direction");
  assertCount(requestedOpeningFaceCount, "report.requestedOpeningFaceCount");
  assertCount(buildCount, "report.buildCount");
  assertSignedInt32(occtStatus, "report.occtStatus");
  assertSignedInt32(failedOpeningFaceIndex, "report.failedOpeningFaceIndex");
  assertSignedInt32(
    historyProblemSourceShapeIndex,
    "report.historyProblemSourceShapeIndex",
  );
  assertSignedInt32(historyProblemKind, "report.historyProblemKind");
  assertSignedInt32(historyProblemIndex, "report.historyProblemIndex");
  return Object.freeze({
    ok: readBoolean(report.ok, "report.ok"),
    stage: readString(report.stage, "report.stage"),
    code: readString(report.code, "report.code"),
    message: readString(report.message, "report.message"),
    operation,
    direction,
    amount: readFinite(report.amount, "report.amount"),
    tolerance: readFinite(report.tolerance, "report.tolerance"),
    requestedOpeningFaceCount,
    buildCount,
    occtStatus,
    failedOpeningFaceIndex,
    historyProblemDomain: readString(
      report.historyProblemDomain,
      "report.historyProblemDomain",
    ),
    historyProblemSourceShapeIndex,
    historyProblemKind,
    historyProblemIndex,
    hasResult: readBoolean(report.hasResult(), "report.hasResult()"),
    topologyHistoryVersion,
    topologyHistoryComplete,
  });
}

function copySelectedOpeningFaces(
  report: InvariantCadSolidOffsetReport,
  maximumCount: number,
): readonly number[] {
  const count = report.selectedOpeningFaceCount();
  assertCount(count, "report.selectedOpeningFaceCount()");
  if (count > maximumCount) {
    protocolError(
      `report.selectedOpeningFaceCount() is ${count}, exceeding the requested opening bound ${maximumCount}`,
    );
  }
  const selected: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const faceIndex = report.selectedOpeningFaceIndex(index);
    assertCount(faceIndex, `report.selectedOpeningFaceIndex(${index})`);
    if (index > 0 && faceIndex <= selected[index - 1]!) {
      protocolError("report selected opening face indices must be strictly increasing");
    }
    selected.push(faceIndex);
  }
  return Object.freeze(selected);
}

function validateHistoryProblem(
  diagnostics: OcctSolidOffsetReportDiagnostics,
): void {
  const domain = diagnostics.historyProblemDomain;
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
    protocolError("report.historyProblemIndex must be -1 or non-negative");
  }
  if (domain === "source") {
    if (diagnostics.historyProblemSourceShapeIndex !== 0) {
      protocolError("solid-offset source history problems must identify source 0");
    }
  } else if (diagnostics.historyProblemSourceShapeIndex !== -1) {
    protocolError("result history problems must use source-shape sentinel -1");
  }
}

function validateDiagnostics(
  diagnostics: OcctSolidOffsetReportDiagnostics,
  operation: OcctSolidOffsetOperation,
  direction: OcctSolidOffsetDirection,
  amount: number,
  tolerance: number,
  requestedOpeningFaceCount: number,
  selectedOpeningFaceCount: number,
): void {
  const expectedOperation = OCCT_SOLID_OFFSET_OPERATION_CODE[operation];
  const expectedDirection = OCCT_SOLID_OFFSET_DIRECTION_CODE[direction];
  if (diagnostics.operation !== expectedOperation) {
    protocolError(
      `report.operation is ${diagnostics.operation}, expected ${expectedOperation}`,
    );
  }
  if (diagnostics.direction !== expectedDirection) {
    protocolError(
      `report.direction is ${diagnostics.direction}, expected ${expectedDirection}`,
    );
  }
  if (diagnostics.amount !== amount) {
    protocolError(`report.amount is ${diagnostics.amount}, expected ${amount}`);
  }
  if (diagnostics.tolerance !== tolerance) {
    protocolError(
      `report.tolerance is ${diagnostics.tolerance}, expected ${tolerance}`,
    );
  }
  if (diagnostics.requestedOpeningFaceCount !== requestedOpeningFaceCount) {
    protocolError(
      `report.requestedOpeningFaceCount is ${diagnostics.requestedOpeningFaceCount}, expected ${requestedOpeningFaceCount}`,
    );
  }
  if (diagnostics.buildCount > 1) {
    protocolError("report.buildCount exceeds one");
  }
  if (diagnostics.occtStatus < -1 || diagnostics.occtStatus > MAX_BREP_OFFSET_ERROR) {
    protocolError(
      `report.occtStatus is ${diagnostics.occtStatus}, expected an OCCT BRepOffset error code from -1 through ${MAX_BREP_OFFSET_ERROR}`,
    );
  }
  if (operation === "offset" && selectedOpeningFaceCount !== 0) {
    protocolError("offset report unexpectedly selected opening faces");
  }
  validateHistoryProblem(diagnostics);

  if (!diagnostics.ok) {
    if (diagnostics.hasResult) protocolError("failed report unexpectedly owns a result");
    if (
      diagnostics.topologyHistoryComplete ||
      diagnostics.topologyHistoryVersion !== 0
    ) {
      protocolError("failed report unexpectedly exposes exact history");
    }
    if (diagnostics.stage === "complete" || diagnostics.code === "OK") {
      protocolError("failed report uses successful diagnostics");
    }
    if (
      diagnostics.failedOpeningFaceIndex < -1 ||
      diagnostics.failedOpeningFaceIndex >= requestedOpeningFaceCount
    ) {
      protocolError(
        "report.failedOpeningFaceIndex is outside the requested opening-face list",
      );
    }
    return;
  }

  if (diagnostics.stage !== "complete" || diagnostics.code !== "OK") {
    protocolError("successful report must have stage 'complete' and code 'OK'");
  }
  if (!diagnostics.hasResult) protocolError("successful report does not own a result");
  if (
    diagnostics.topologyHistoryVersion !== 1 ||
    !diagnostics.topologyHistoryComplete
  ) {
    protocolError("successful report must expose complete topology history version 1");
  }
  if (diagnostics.buildCount !== 1) {
    protocolError("successful report.buildCount must be one");
  }
  if (diagnostics.occtStatus !== 0) {
    protocolError("successful report.occtStatus must be zero");
  }
  if (diagnostics.failedOpeningFaceIndex !== -1) {
    protocolError("successful report must use failed-opening-face sentinel -1");
  }
  if (diagnostics.historyProblemDomain !== "none") {
    protocolError("successful report cannot identify a history problem");
  }
  if (
    operation === "shell" &&
    (selectedOpeningFaceCount === 0 ||
      selectedOpeningFaceCount > requestedOpeningFaceCount)
  ) {
    protocolError("successful shell report must select at least one requested opening face");
  }
}

function copyEvolution(
  report: InvariantCadSolidOffsetReport,
  version: number,
  complete: boolean,
  maxHistoryRecords: number,
): IndexedTopologyEvolutionEnvelope | undefined {
  if (!complete) return undefined;
  const inputShapeCount = report.topologyInputShapeCount();
  assertCount(inputShapeCount, "report.topologyInputShapeCount()");
  if (inputShapeCount !== 1) {
    protocolError(
      `report.topologyInputShapeCount() is ${inputShapeCount}, expected 1`,
    );
  }
  const inputCounts = Object.freeze([
    copyCounts(report.topologyInputCounts(0), "report.topologyInputCounts(0)"),
  ]);
  const resultCounts = copyCounts(
    report.topologyResultCounts(),
    "report.topologyResultCounts()",
  );
  const recordCount = report.topologyRecordCount();
  assertCount(recordCount, "report.topologyRecordCount()");
  const sourceItems =
    BigInt(inputCounts[0]!.faces) +
    BigInt(inputCounts[0]!.edges) +
    BigInt(inputCounts[0]!.vertices);
  const resultItems =
    BigInt(resultCounts.faces) +
    BigInt(resultCounts.edges) +
    BigInt(resultCounts.vertices);
  const structuralMaximum =
    sourceItems * resultItems + sourceItems + resultItems;
  if (BigInt(recordCount) > structuralMaximum) {
    protocolError(
      `report.topologyRecordCount() is ${recordCount}, exceeding the structural solid-offset graph maximum ${structuralMaximum}`,
    );
  }
  if (recordCount > maxHistoryRecords) {
    throw new RangeError(
      `Exact solid-offset topology history has ${recordCount} records, exceeding the configured JavaScript copy limit ${maxHistoryRecords}`,
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
    inputCounts,
    resultCounts,
    records: Object.freeze(records),
  });
}

function makeOpeningFaceVector(
  module: OcctSolidOffsetFacadeModule,
  openingFaceIds: readonly number[],
): OcctSolidOffsetEmbindVectorUint32 {
  const vector = new module.VectorUint32();
  try {
    for (const faceId of openingFaceIds) vector.push_back(faceId);
    return vector;
  } catch (error) {
    vector.delete();
    throw error;
  }
}

/** Executes an ABI 0.6 shell/offset as a strict report-owned transaction. */
export function adoptOcctSolidOffset<T>(
  options: AdoptOcctSolidOffsetOptions<T>,
): T {
  assertModule(options.module);
  if (!isObject(options.kernel) || typeof options.kernel.release !== "function") {
    protocolError("kernel must provide release(resultId)");
  }
  const operation = options.operation;
  const operationValue = operationCode(operation);
  const direction = options.direction;
  const directionValue = directionCode(direction);
  if (!Number.isFinite(options.amount) || !(options.amount > 0)) {
    throw new RangeError("amount must be finite and positive");
  }
  if (!Number.isFinite(options.tolerance) || !(options.tolerance > 0)) {
    throw new RangeError("tolerance must be finite and positive");
  }
  if (!(options.tolerance < options.amount)) {
    throw new RangeError("tolerance must be less than amount");
  }
  const maxHistoryRecords =
    options.maxHistoryRecords ??
    DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT;
  assertCount(maxHistoryRecords, "maxHistoryRecords");
  assertUint32(options.inputId, "inputId");
  if (!Array.isArray(options.openingFaceIds)) {
    protocolError("openingFaceIds must be an array");
  }
  if (!Array.isArray(options.selectedOpeningFaceIndices)) {
    protocolError("selectedOpeningFaceIndices must be an array");
  }
  if (options.openingFaceIds.length >= INT32_MAX) {
    protocolError("openingFaceIds length exceeds the signed 32-bit facade limit");
  }
  if (options.selectedOpeningFaceIndices.length >= INT32_MAX) {
    protocolError(
      "selectedOpeningFaceIndices length exceeds the signed 32-bit facade limit",
    );
  }
  if (operation === "shell" && options.openingFaceIds.length === 0) {
    protocolError("shell requires at least one opening face ID");
  }
  if (
    operation === "offset" &&
    (options.openingFaceIds.length !== 0 ||
      options.selectedOpeningFaceIndices.length !== 0)
  ) {
    protocolError("offset does not accept opening faces");
  }
  if (
    options.selectedOpeningFaceIndices.length > options.openingFaceIds.length
  ) {
    protocolError(
      "selectedOpeningFaceIndices cannot exceed the requested opening-face count",
    );
  }
  const openingFaceIds = Array.from(
    options.openingFaceIds,
    (faceId, index) => {
      assertUint32(faceId, `openingFaceIds[${index}]`);
      return faceId;
    },
  );
  const expectedSelected = Array.from(
    options.selectedOpeningFaceIndices,
    (faceIndex, index) => {
      assertCount(faceIndex, `selectedOpeningFaceIndices[${index}]`);
      if (
        index > 0 &&
        faceIndex <= options.selectedOpeningFaceIndices[index - 1]!
      ) {
        protocolError("selectedOpeningFaceIndices must be strictly increasing");
      }
      return faceIndex;
    },
  );
  if (operation === "shell" && expectedSelected.length === 0) {
    protocolError("shell requires at least one canonical opening face index");
  }

  let resultToRelease: number | undefined;
  try {
    let reportToDelete:
      | (Record<PropertyKey, unknown> & { delete(): void })
      | undefined;
    let transferred: OcctSolidOffsetTransferredResult;
    try {
      const vector = makeOpeningFaceVector(options.module, openingFaceIds);
      let report: InvariantCadSolidOffsetReport;
      try {
        const rawReport = options.module.invariantcadSolidOffsetAtomic(
          options.kernel,
          operationValue,
          options.inputId,
          vector,
          options.amount,
          directionValue,
          options.tolerance,
          maxHistoryRecords,
        );
        assertDeletableReport(rawReport);
        reportToDelete = rawReport;
        assertRawReport(rawReport);
        report = rawReport;
      } finally {
        vector.delete();
      }

      const version = report.topologyHistoryVersion();
      assertSignedInt32(version, "report.topologyHistoryVersion()");
      const complete = readBoolean(
        report.topologyHistoryComplete(),
        "report.topologyHistoryComplete()",
      );
      const diagnostics = copyDiagnostics(report, version, complete);
      const selectedOpeningFaceIndices = copySelectedOpeningFaces(
        report,
        openingFaceIds.length,
      );
      validateDiagnostics(
        diagnostics,
        operation,
        direction,
        options.amount,
        options.tolerance,
        openingFaceIds.length,
        selectedOpeningFaceIndices.length,
      );
      if (!diagnostics.ok) throw new OcctSolidOffsetOperationError(diagnostics);
      if (
        selectedOpeningFaceIndices.length !== expectedSelected.length ||
        selectedOpeningFaceIndices.some(
          (value, index) => value !== expectedSelected[index],
        )
      ) {
        protocolError(
          "report selected opening face indices do not match the request",
        );
      }

      const evolution = copyEvolution(
        report,
        version,
        complete,
        maxHistoryRecords,
      );
      if (evolution === undefined) {
        protocolError("successful report does not provide complete history");
      }
      if (
        selectedOpeningFaceIndices.some(
          (index) => index >= evolution.inputCounts[0]!.faces,
        )
      ) {
        protocolError(
          "report selected opening face index is outside the input topology",
        );
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
      const snapshot: OcctSolidOffsetReportSnapshot = Object.freeze({
        diagnostics,
        selectedOpeningFaceIndices,
        evolution,
        transferCode: "READY",
      });
      options.validate?.(snapshot);
      const resultId = report.takeResultId(options.kernel);
      assertUint32(resultId, "report.takeResultId()");
      if (resultId === 0) protocolError("report returned reserved result ID 0");
      if (resultId === options.inputId || openingFaceIds.includes(resultId)) {
        protocolError("report returned a result ID that aliases an input operand");
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
    if (resultToRelease !== undefined) options.kernel.release(resultToRelease);
  }
}
