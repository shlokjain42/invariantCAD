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

export const DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT =
  1_000_000;

export type OcctEdgeTreatmentOperation = "fillet" | "chamfer";

export const OCCT_EDGE_TREATMENT_OPERATION_CODE = Object.freeze({
  fillet: 0,
  chamfer: 1,
} as const satisfies Readonly<Record<OcctEdgeTreatmentOperation, number>>);

export interface OcctEdgeTreatmentEmbindVectorUint32 {
  push_back(value: number): void;
  delete(): void;
}

export interface OcctEdgeTreatmentRawKernel {
  release(resultId: number): void;
}

interface OcctEdgeTreatmentRawCounts {
  readonly faces: unknown;
  readonly edges: unknown;
  readonly vertices: unknown;
}

interface OcctEdgeTreatmentRawRecord {
  readonly sourceShapeIndex: unknown;
  readonly sourceKind: unknown;
  readonly sourceIndex: unknown;
  readonly relation: unknown;
  readonly resultKind: unknown;
  readonly resultIndex: unknown;
}

export interface OcctEdgeTreatmentRawReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly message: unknown;
  readonly operation: unknown;
  readonly amount: unknown;
  readonly requestedSeedCount: unknown;
  readonly addCount: unknown;
  readonly skippedSeedCount: unknown;
  readonly contourCount: unknown;
  readonly buildCount: unknown;
  readonly failedSeedIndex: unknown;
  readonly historyProblemDomain: unknown;
  readonly historyProblemSourceShapeIndex: unknown;
  readonly historyProblemKind: unknown;
  readonly historyProblemIndex: unknown;
  selectedEdgeCount(): unknown;
  selectedEdgeIndex(selectedIndex: number): unknown;
  hasResult(): unknown;
  transferCode(kernel: OcctEdgeTreatmentRawKernel): unknown;
  takeResultId(kernel: OcctEdgeTreatmentRawKernel): unknown;
  topologyHistoryVersion(): unknown;
  topologyHistoryComplete(): unknown;
  topologyInputShapeCount(): unknown;
  topologyInputCounts(sourceShapeIndex: number): OcctEdgeTreatmentRawCounts;
  topologyResultCounts(): OcctEdgeTreatmentRawCounts;
  topologyRecordCount(): unknown;
  topologyRecord(recordIndex: number): OcctEdgeTreatmentRawRecord;
  delete(): void;
}

export interface OcctEdgeTreatmentFacadeModule {
  readonly VectorUint32: new () => OcctEdgeTreatmentEmbindVectorUint32;
  invariantcadEdgeTreatmentAtomic(
    kernel: OcctEdgeTreatmentRawKernel,
    operation: number,
    inputId: number,
    edgeIds: OcctEdgeTreatmentEmbindVectorUint32,
    amount: number,
    maxHistoryRecords: number,
  ): unknown;
}

export interface OcctEdgeTreatmentReportDiagnostics {
  readonly ok: boolean;
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly operation: number;
  readonly amount: number;
  readonly requestedSeedCount: number;
  readonly addCount: number;
  readonly skippedSeedCount: number;
  readonly contourCount: number;
  readonly buildCount: number;
  readonly failedSeedIndex: number;
  readonly historyProblemDomain: string;
  readonly historyProblemSourceShapeIndex: number;
  readonly historyProblemKind: number;
  readonly historyProblemIndex: number;
  readonly hasResult: boolean;
  readonly topologyHistoryVersion: number;
  readonly topologyHistoryComplete: boolean;
}

export interface OcctEdgeTreatmentReportSnapshot {
  readonly diagnostics: OcctEdgeTreatmentReportDiagnostics;
  readonly selectedEdgeIndices: readonly number[];
  readonly evolution: IndexedTopologyEvolutionEnvelope;
  readonly transferCode: "READY";
}

export interface OcctEdgeTreatmentTransferredResult {
  readonly resultId: number;
  readonly report: OcctEdgeTreatmentReportSnapshot;
}

export interface AdoptOcctEdgeTreatmentOptions<T> {
  readonly module: unknown;
  readonly kernel: OcctEdgeTreatmentRawKernel;
  readonly operation: OcctEdgeTreatmentOperation;
  readonly inputId: number;
  readonly edgeIds: readonly number[];
  readonly selectedEdgeIndices: readonly number[];
  readonly amount: number;
  readonly maxHistoryRecords?: number;
  readonly validate?: (report: OcctEdgeTreatmentReportSnapshot) => void;
  readonly adopt: (result: OcctEdgeTreatmentTransferredResult) => T;
}

export class OcctEdgeTreatmentFacadeProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid InvariantCAD OCCT edge-treatment facade: ${message}`);
    this.name = "OcctEdgeTreatmentFacadeProtocolError";
  }
}

export class OcctEdgeTreatmentOperationError extends Error {
  readonly diagnostics: OcctEdgeTreatmentReportDiagnostics;

  constructor(diagnostics: OcctEdgeTreatmentReportDiagnostics) {
    super(
      `OCCT edge treatment failed at '${diagnostics.stage}' with '${diagnostics.code}': ${diagnostics.message}`,
    );
    this.name = "OcctEdgeTreatmentOperationError";
    this.diagnostics = diagnostics;
  }
}

function protocolError(message: string): never {
  throw new OcctEdgeTreatmentFacadeProtocolError(message);
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

const REPORT_METHODS = Object.freeze([
  "selectedEdgeCount",
  "selectedEdgeIndex",
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

function assertModule(value: unknown): asserts value is OcctEdgeTreatmentFacadeModule {
  if (!isObject(value)) protocolError("module must be an object");
  if (typeof value.VectorUint32 !== "function") {
    protocolError("module.VectorUint32 must be an Embind constructor");
  }
  if (typeof value.invariantcadEdgeTreatmentAtomic !== "function") {
    protocolError("module.invariantcadEdgeTreatmentAtomic must be a function");
  }
}

function assertDeletableReport(
  value: unknown,
): asserts value is Record<PropertyKey, unknown> & { delete(): void } {
  if (!isObject(value)) {
    protocolError("invariantcadEdgeTreatmentAtomic() must return a report object");
  }
  if (typeof value.delete !== "function") {
    protocolError("report.delete must be a function");
  }
}

function assertRawReport(value: unknown): asserts value is OcctEdgeTreatmentRawReport {
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
  report: OcctEdgeTreatmentRawReport,
  version: number,
  complete: boolean,
): OcctEdgeTreatmentReportDiagnostics {
  const operation = report.operation;
  const requestedSeedCount = report.requestedSeedCount;
  const addCount = report.addCount;
  const skippedSeedCount = report.skippedSeedCount;
  const contourCount = report.contourCount;
  const buildCount = report.buildCount;
  const failedSeedIndex = report.failedSeedIndex;
  const historyProblemSourceShapeIndex = report.historyProblemSourceShapeIndex;
  const historyProblemKind = report.historyProblemKind;
  const historyProblemIndex = report.historyProblemIndex;
  assertSignedInt32(operation, "report.operation");
  assertSignedInt32(requestedSeedCount, "report.requestedSeedCount");
  assertCount(addCount, "report.addCount");
  assertCount(skippedSeedCount, "report.skippedSeedCount");
  assertCount(contourCount, "report.contourCount");
  assertCount(buildCount, "report.buildCount");
  assertSignedInt32(failedSeedIndex, "report.failedSeedIndex");
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
    amount: readFinite(report.amount, "report.amount"),
    requestedSeedCount,
    addCount,
    skippedSeedCount,
    contourCount,
    buildCount,
    failedSeedIndex,
    historyProblemDomain: readString(
      report.historyProblemDomain,
      "report.historyProblemDomain",
    ),
    historyProblemSourceShapeIndex,
    historyProblemKind,
    historyProblemIndex,
    hasResult: readBoolean(report.hasResult(), "report.hasResult()"),
    topologyHistoryVersion: version,
    topologyHistoryComplete: complete,
  });
}

function copySelectedEdges(
  report: OcctEdgeTreatmentRawReport,
  maximumCount: number,
): readonly number[] {
  const count = report.selectedEdgeCount();
  assertCount(count, "report.selectedEdgeCount()");
  if (count > maximumCount) {
    protocolError(
      `report.selectedEdgeCount() is ${count}, exceeding the requested selection bound ${maximumCount}`,
    );
  }
  const selected: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const edgeIndex = report.selectedEdgeIndex(index);
    assertCount(edgeIndex, `report.selectedEdgeIndex(${index})`);
    if (index > 0 && edgeIndex <= selected[index - 1]!) {
      protocolError("report selected edge indices must be strictly increasing");
    }
    selected.push(edgeIndex);
  }
  return Object.freeze(selected);
}

function validateProblem(diagnostics: OcctEdgeTreatmentReportDiagnostics): void {
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
      protocolError("edge-treatment source history problems must identify source 0");
    }
  } else if (diagnostics.historyProblemSourceShapeIndex !== -1) {
    protocolError("result history problems must use source-shape sentinel -1");
  }
}

function validateDiagnostics(
  diagnostics: OcctEdgeTreatmentReportDiagnostics,
  operation: OcctEdgeTreatmentOperation,
  amount: number,
  requestedSeedCount: number,
  selectedCount: number,
): void {
  const expectedOperation = OCCT_EDGE_TREATMENT_OPERATION_CODE[operation];
  if (diagnostics.operation !== expectedOperation) {
    protocolError(`report.operation is ${diagnostics.operation}, expected ${expectedOperation}`);
  }
  if (diagnostics.amount !== amount) {
    protocolError(`report.amount is ${diagnostics.amount}, expected ${amount}`);
  }
  if (diagnostics.requestedSeedCount !== requestedSeedCount) {
    protocolError(
      `report.requestedSeedCount is ${diagnostics.requestedSeedCount}, expected ${requestedSeedCount}`,
    );
  }
  if (diagnostics.buildCount > 1) protocolError("report.buildCount exceeds one");
  if (diagnostics.addCount + diagnostics.skippedSeedCount > selectedCount) {
    protocolError("report seed progress exceeds the canonical selection");
  }
  if (diagnostics.contourCount > diagnostics.addCount) {
    protocolError("report.contourCount exceeds report.addCount");
  }
  validateProblem(diagnostics);

  if (!diagnostics.ok) {
    if (diagnostics.hasResult) protocolError("failed report unexpectedly owns a result");
    if (diagnostics.topologyHistoryComplete || diagnostics.topologyHistoryVersion !== 0) {
      protocolError("failed report unexpectedly exposes exact history");
    }
    if (diagnostics.stage === "complete" || diagnostics.code === "OK") {
      protocolError("failed report uses successful diagnostics");
    }
    if (
      diagnostics.failedSeedIndex < -1 ||
      diagnostics.failedSeedIndex >= requestedSeedCount
    ) {
      protocolError("report.failedSeedIndex is outside the requested seed list");
    }
    return;
  }

  if (diagnostics.stage !== "complete" || diagnostics.code !== "OK") {
    protocolError("successful report must have stage 'complete' and code 'OK'");
  }
  if (!diagnostics.hasResult) protocolError("successful report does not own a result");
  if (diagnostics.topologyHistoryVersion !== 1 || !diagnostics.topologyHistoryComplete) {
    protocolError("successful report must expose complete topology history version 1");
  }
  if (
    diagnostics.addCount + diagnostics.skippedSeedCount !== selectedCount ||
    diagnostics.addCount <= 0 ||
    diagnostics.contourCount !== diagnostics.addCount ||
    diagnostics.buildCount !== 1 ||
    diagnostics.failedSeedIndex !== -1
  ) {
    protocolError("successful report has inconsistent seed/build progress");
  }
  if (diagnostics.historyProblemDomain !== "none") {
    protocolError("successful report cannot identify a history problem");
  }
}

function copyEvolution(
  report: OcctEdgeTreatmentRawReport,
  version: number,
  complete: boolean,
  maxHistoryRecords: number,
): IndexedTopologyEvolutionEnvelope | undefined {
  if (!complete) return undefined;
  const inputShapeCount = report.topologyInputShapeCount();
  assertCount(inputShapeCount, "report.topologyInputShapeCount()");
  if (inputShapeCount !== 1) {
    protocolError(`report.topologyInputShapeCount() is ${inputShapeCount}, expected 1`);
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
  if (BigInt(recordCount) > sourceItems * resultItems + sourceItems + resultItems) {
    protocolError("report.topologyRecordCount() exceeds the structural graph maximum");
  }
  if (recordCount > maxHistoryRecords) {
    throw new RangeError(
      `Exact edge-treatment topology history has ${recordCount} records, exceeding the configured JavaScript copy limit ${maxHistoryRecords}`,
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

function makeVector(
  module: OcctEdgeTreatmentFacadeModule,
  values: readonly number[],
): OcctEdgeTreatmentEmbindVectorUint32 {
  const vector = new module.VectorUint32();
  try {
    for (const value of values) vector.push_back(value);
    return vector;
  } catch (error) {
    vector.delete();
    throw error;
  }
}

export function adoptOcctEdgeTreatment<T>(
  options: AdoptOcctEdgeTreatmentOptions<T>,
): T {
  assertModule(options.module);
  if (!isObject(options.kernel) || typeof options.kernel.release !== "function") {
    protocolError("kernel must provide release(resultId)");
  }
  if (!Number.isFinite(options.amount) || !(options.amount > 0)) {
    throw new RangeError("amount must be finite and positive");
  }
  const maxHistoryRecords =
    options.maxHistoryRecords ??
    DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT;
  assertCount(maxHistoryRecords, "maxHistoryRecords");
  assertUint32(options.inputId, "inputId");
  if (!Array.isArray(options.edgeIds) || options.edgeIds.length === 0) {
    protocolError("edgeIds must be a nonempty array");
  }
  if (!Array.isArray(options.selectedEdgeIndices)) {
    protocolError("selectedEdgeIndices must be an array");
  }
  if (options.edgeIds.length !== options.selectedEdgeIndices.length) {
    protocolError("edgeIds and selectedEdgeIndices must have equal length");
  }
  if (options.edgeIds.length >= INT32_MAX) {
    protocolError(
      "edgeIds and selectedEdgeIndices lengths exceed the signed 32-bit facade limit",
    );
  }
  const edgeIds = Array.from(options.edgeIds, (edgeId, index) => {
    assertUint32(edgeId, `edgeIds[${index}]`);
    return edgeId;
  });
  const expectedSelected = Array.from(
    options.selectedEdgeIndices,
    (edgeIndex, index) => {
      assertCount(edgeIndex, `selectedEdgeIndices[${index}]`);
      if (index > 0 && edgeIndex <= options.selectedEdgeIndices[index - 1]!) {
        protocolError("selectedEdgeIndices must be strictly increasing");
      }
      return edgeIndex;
    },
  );
  let operationCode: number;
  switch (options.operation) {
    case "fillet":
      operationCode = OCCT_EDGE_TREATMENT_OPERATION_CODE.fillet;
      break;
    case "chamfer":
      operationCode = OCCT_EDGE_TREATMENT_OPERATION_CODE.chamfer;
      break;
    default:
      protocolError(`unsupported operation '${String(options.operation)}'`);
  }

  let resultToRelease: number | undefined;
  try {
    let reportToDelete:
      | (Record<PropertyKey, unknown> & { delete(): void })
      | undefined;
    let transferred: OcctEdgeTreatmentTransferredResult;
    try {
      const vector = makeVector(options.module, edgeIds);
      let report: OcctEdgeTreatmentRawReport;
      try {
        const rawReport = options.module.invariantcadEdgeTreatmentAtomic(
          options.kernel,
          operationCode,
          options.inputId,
          vector,
          options.amount,
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
      const selectedEdgeIndices = copySelectedEdges(
        report,
        expectedSelected.length,
      );
      validateDiagnostics(
        diagnostics,
        options.operation,
        options.amount,
        edgeIds.length,
        selectedEdgeIndices.length,
      );
      if (!diagnostics.ok) throw new OcctEdgeTreatmentOperationError(diagnostics);
      if (
        selectedEdgeIndices.length !== expectedSelected.length ||
        selectedEdgeIndices.some((value, index) => value !== expectedSelected[index])
      ) {
        protocolError("report selected edge indices do not match the request");
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
      if (selectedEdgeIndices.some((index) => index >= evolution.inputCounts[0]!.edges)) {
        protocolError("report selected edge index is outside the input topology");
      }
      validateCompleteIndexedTopologyEvolutionEnvelope(evolution, {
        allowCreated: true,
      });
      const transferCode = readString(
        report.transferCode(options.kernel),
        "report.transferCode()",
      );
      if (transferCode !== "READY") {
        protocolError(`report transfer state is '${transferCode}', expected 'READY'`);
      }
      const snapshot: OcctEdgeTreatmentReportSnapshot = Object.freeze({
        diagnostics,
        selectedEdgeIndices,
        evolution,
        transferCode: "READY",
      });
      options.validate?.(snapshot);
      const resultId = report.takeResultId(options.kernel);
      assertUint32(resultId, "report.takeResultId()");
      if (resultId === 0) protocolError("report returned reserved result ID 0");
      if (resultId === options.inputId || edgeIds.includes(resultId)) {
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
