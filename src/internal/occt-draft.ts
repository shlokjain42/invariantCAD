import {
  TopologyEvolutionProtocolError,
  validateExactIndexedTopologyEvolutionEnvelope,
  type IndexedTopologyCounts,
  type IndexedTopologyEvolutionEnvelope,
  type IndexedTopologyEvolutionRecord,
} from "./topology-evolution.js";
import {
  OcctDraftFacadeProtocolError,
  probeOcctDraftFacade,
} from "./occt-facade.js";

export {
  OCCT_DRAFT_FACADE_VERSION,
  OcctDraftFacadeProtocolError,
  probeOcctDraftFacade,
} from "./occt-facade.js";

const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;
const UINT32_MAX = 4_294_967_295;

type Vec3 = readonly [number, number, number];

/** The input-only Embind vector used by the owned facade global. */
export interface OcctDraftEmbindVectorUint32 {
  push_back(value: number): void;
  delete(): void;
}

/** The raw OCCT kernel surface whose arena receives a transferred result. */
export interface OcctDraftRawKernel {
  release(resultId: number): void;
}

interface OcctDraftRawCounts {
  readonly faces: unknown;
  readonly edges: unknown;
  readonly vertices: unknown;
}

interface OcctDraftRawRecord {
  readonly sourceShapeIndex: unknown;
  readonly sourceKind: unknown;
  readonly sourceIndex: unknown;
  readonly relation: unknown;
  readonly resultKind: unknown;
  readonly resultIndex: unknown;
}

/** Structural view of the report returned by the matched generated glue. */
export interface OcctDraftRawReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly message: unknown;
  readonly failedSeedIndex: unknown;
  readonly occtStatus: unknown;
  readonly requestedSeedCount: unknown;
  readonly addCount: unknown;
  readonly skippedSeedCount: unknown;
  readonly buildCount: unknown;
  readonly problematicShapeType: unknown;
  readonly problematicShapeIndex: unknown;
  readonly historyProblemDomain: unknown;
  readonly historyProblemSourceShapeIndex: unknown;
  readonly historyProblemKind: unknown;
  readonly historyProblemIndex: unknown;
  hasResult(): unknown;
  transferCode(kernel: OcctDraftRawKernel): unknown;
  takeResultId(kernel: OcctDraftRawKernel): unknown;
  topologyHistoryVersion(): unknown;
  topologyHistoryComplete(): unknown;
  topologyInputShapeCount(): unknown;
  topologyInputCounts(sourceShapeIndex: number): OcctDraftRawCounts;
  topologyResultCounts(): OcctDraftRawCounts;
  topologyRecordCount(): unknown;
  topologyRecord(recordIndex: number): OcctDraftRawRecord;
  delete(): void;
}

/** Structural view of the exact InvariantCAD-owned generated module. */
export interface OcctDraftFacadeModule {
  readonly VectorUint32: new () => OcctDraftEmbindVectorUint32;
  readonly InvariantCadDraftReport: Function;
  readonly InvariantCadTopologyKind: Readonly<Record<string, unknown>>;
  readonly InvariantCadTopologyRelation: Readonly<Record<string, unknown>>;
  invariantcadFacadeVersion(): unknown;
  invariantcadDraftFacesAtomic(
    kernel: OcctDraftRawKernel,
    shapeId: number,
    faceIds: OcctDraftEmbindVectorUint32,
    angleRad: number,
    pullX: number,
    pullY: number,
    pullZ: number,
    neutralOriginX: number,
    neutralOriginY: number,
    neutralOriginZ: number,
    neutralNormalX: number,
    neutralNormalY: number,
    neutralNormalZ: number,
  ): OcctDraftRawReport;
}

export interface OcctDraftReportDiagnostics {
  readonly ok: boolean;
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly failedSeedIndex: number;
  readonly occtStatus: number;
  readonly requestedSeedCount: number;
  readonly addCount: number;
  readonly skippedSeedCount: number;
  readonly buildCount: number;
  readonly problematicShapeType: string;
  readonly problematicShapeIndex: number;
  readonly historyProblemDomain: string;
  readonly historyProblemSourceShapeIndex: number;
  readonly historyProblemKind: number;
  readonly historyProblemIndex: number;
  readonly hasResult: boolean;
  readonly topologyHistoryVersion: number;
  readonly topologyHistoryComplete: boolean;
}

export interface OcctDraftReportSnapshot {
  readonly diagnostics: OcctDraftReportDiagnostics;
  readonly evolution: IndexedTopologyEvolutionEnvelope;
  readonly transferCode: "READY";
}

export interface OcctDraftTransferredResult {
  readonly resultId: number;
  readonly report: OcctDraftReportSnapshot;
}

export interface AdoptOcctDraftOptions<T> {
  readonly module: unknown;
  readonly kernel: OcctDraftRawKernel;
  readonly shapeId: number;
  readonly faceIds: readonly number[];
  readonly angleRad: number;
  readonly pullDirection: Vec3;
  readonly neutralOrigin: Vec3;
  readonly neutralNormal: Vec3;
  /**
   * Runs after the report, exact history, and READY preflight are validated,
   * but before `takeResultId()`. Throwing leaves the result report-owned.
   */
  readonly validate?: (report: OcctDraftReportSnapshot) => void;
  /**
   * Takes ownership of `resultId` only by returning successfully. The helper
   * releases it exactly once if this callback (including lineage reduction)
   * throws.
   */
  readonly adopt: (result: OcctDraftTransferredResult) => T;
}

export class OcctDraftUnsupportedError extends Error {
  constructor() {
    super("The loaded stock OCCT module does not provide the InvariantCAD draft facade");
    this.name = "OcctDraftUnsupportedError";
  }
}

export class OcctDraftOperationError extends Error {
  readonly diagnostics: OcctDraftReportDiagnostics;

  constructor(diagnostics: OcctDraftReportDiagnostics) {
    super(
      `OCCT draft failed at '${diagnostics.stage}' with '${diagnostics.code}': ${diagnostics.message}`,
    );
    this.name = "OcctDraftOperationError";
    this.diagnostics = diagnostics;
  }
}

function facadeProtocolError(message: string): never {
  throw new OcctDraftFacadeProtocolError(message);
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
    facadeProtocolError(`${label} must be a signed 32-bit integer`);
  }
}

function assertCount(value: unknown, label: string): asserts value is number {
  assertSignedInt32(value, label);
  if (value < 0) facadeProtocolError(`${label} must be non-negative`);
}

function assertAccessorIndex(value: number, label: string): void {
  assertCount(value, label);
}

function assertUint32(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > UINT32_MAX
  ) {
    facadeProtocolError(`${label} must be an unsigned 32-bit integer`);
  }
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") facadeProtocolError(`${label} must be a string`);
  return value;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") facadeProtocolError(`${label} must be a boolean`);
  return value;
}

function copyCounts(value: unknown, label: string): IndexedTopologyCounts {
  if (!isObject(value)) facadeProtocolError(`${label} must be an object`);
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
  if (!isObject(value)) facadeProtocolError(`${label} must be an object`);
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

function checkedCountTotal(
  counts: readonly IndexedTopologyCounts[],
  label: string,
): number {
  let total = 0;
  for (const item of counts) {
    for (const count of [item.faces, item.edges, item.vertices]) {
      total += count;
      if (!Number.isSafeInteger(total) || total > INT32_MAX) {
        facadeProtocolError(`${label} exceeds the signed 32-bit record limit`);
      }
    }
  }
  return total;
}

function copyDiagnostics(
  report: OcctDraftRawReport,
  topologyHistoryVersion: number,
  topologyHistoryComplete: boolean,
): OcctDraftReportDiagnostics {
  const ok = readBoolean(report.ok, "report.ok");
  const stage = readString(report.stage, "report.stage");
  const code = readString(report.code, "report.code");
  const message = readString(report.message, "report.message");
  const failedSeedIndex = report.failedSeedIndex;
  const occtStatus = report.occtStatus;
  const requestedSeedCount = report.requestedSeedCount;
  const addCount = report.addCount;
  const skippedSeedCount = report.skippedSeedCount;
  const buildCount = report.buildCount;
  const problematicShapeType = readString(
    report.problematicShapeType,
    "report.problematicShapeType",
  );
  const problematicShapeIndex = report.problematicShapeIndex;
  const historyProblemDomain = readString(
    report.historyProblemDomain,
    "report.historyProblemDomain",
  );
  const historyProblemSourceShapeIndex = report.historyProblemSourceShapeIndex;
  const historyProblemKind = report.historyProblemKind;
  const historyProblemIndex = report.historyProblemIndex;
  const hasResult = readBoolean(report.hasResult(), "report.hasResult()");

  assertSignedInt32(failedSeedIndex, "report.failedSeedIndex");
  assertSignedInt32(occtStatus, "report.occtStatus");
  assertCount(requestedSeedCount, "report.requestedSeedCount");
  assertCount(addCount, "report.addCount");
  assertCount(skippedSeedCount, "report.skippedSeedCount");
  assertCount(buildCount, "report.buildCount");
  assertSignedInt32(problematicShapeIndex, "report.problematicShapeIndex");
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
    failedSeedIndex,
    occtStatus,
    requestedSeedCount,
    addCount,
    skippedSeedCount,
    buildCount,
    problematicShapeType,
    problematicShapeIndex,
    historyProblemDomain,
    historyProblemSourceShapeIndex,
    historyProblemKind,
    historyProblemIndex,
    hasResult,
    topologyHistoryVersion,
    topologyHistoryComplete,
  });
}

function validateReportSemantics(
  diagnostics: OcctDraftReportDiagnostics,
  requestedFaceCount: number,
): void {
  if (
    diagnostics.historyProblemDomain !== "none" &&
    diagnostics.historyProblemDomain !== "source" &&
    diagnostics.historyProblemDomain !== "result"
  ) {
    facadeProtocolError(
      `report.historyProblemDomain is '${diagnostics.historyProblemDomain}', expected 'none', 'source', or 'result'`,
    );
  }
  if (diagnostics.requestedSeedCount !== requestedFaceCount) {
    facadeProtocolError(
      `report.requestedSeedCount is ${diagnostics.requestedSeedCount}, expected ${requestedFaceCount}`,
    );
  }

  if (!diagnostics.ok) {
    if (diagnostics.hasResult) {
      facadeProtocolError("failed report unexpectedly owns a result");
    }
    if (diagnostics.topologyHistoryComplete) {
      facadeProtocolError("failed report unexpectedly exposes complete history");
    }
    if (diagnostics.topologyHistoryVersion !== 0) {
      facadeProtocolError(
        `failed report history version is ${diagnostics.topologyHistoryVersion}, expected 0`,
      );
    }
    if (diagnostics.stage === "complete" || diagnostics.code === "OK") {
      facadeProtocolError("failed report uses successful stage or code diagnostics");
    }
    return;
  }

  if (diagnostics.stage !== "complete" || diagnostics.code !== "OK") {
    facadeProtocolError("successful report must have stage 'complete' and code 'OK'");
  }
  if (
    diagnostics.topologyHistoryVersion !== 1 ||
    !diagnostics.topologyHistoryComplete
  ) {
    facadeProtocolError(
      "successful report must expose complete topology history version 1",
    );
  }
  if (!diagnostics.hasResult) {
    facadeProtocolError("successful report does not own a result");
  }
  if (
    diagnostics.addCount + diagnostics.skippedSeedCount !==
    diagnostics.requestedSeedCount
  ) {
    facadeProtocolError(
      "successful report addCount plus skippedSeedCount must equal requestedSeedCount",
    );
  }
  if (diagnostics.buildCount !== 1) {
    facadeProtocolError("successful report buildCount must be 1");
  }
}

function copyEvolution(
  report: OcctDraftRawReport,
  version: number,
  complete: boolean,
): IndexedTopologyEvolutionEnvelope | undefined {
  if (!complete) return undefined;

  const inputShapeCount = report.topologyInputShapeCount();
  assertCount(inputShapeCount, "report.topologyInputShapeCount()");
  // Facade 0.2 atomic draft is deliberately a one-source operation. Checking
  // this before its indexed accessor also bounds an adversarial native count.
  if (inputShapeCount !== 1) {
    facadeProtocolError(
      `report.topologyInputShapeCount() must be 1, received '${inputShapeCount}'`,
    );
  }

  const inputCounts: IndexedTopologyCounts[] = [];
  for (let index = 0; index < inputShapeCount; index += 1) {
    assertAccessorIndex(index, "topologyInputCounts sourceShapeIndex");
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
  const sourceTotal = checkedCountTotal(inputCounts, "source record count");
  const resultTotal = checkedCountTotal([resultCounts], "result record count");
  if (recordCount !== sourceTotal || recordCount !== resultTotal) {
    throw new TopologyEvolutionProtocolError(
      `records has ${recordCount} entries; expected ${sourceTotal}`,
    );
  }

  const records: IndexedTopologyEvolutionRecord[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    assertAccessorIndex(index, "topologyRecord recordIndex");
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

function makeFaceVector(
  module: OcctDraftFacadeModule,
  faceIds: readonly number[],
): OcctDraftEmbindVectorUint32 {
  const vector = new module.VectorUint32();
  try {
    for (const faceId of faceIds) vector.push_back(faceId);
    return vector;
  } catch (error) {
    vector.delete();
    throw error;
  }
}

function assertRawReport(value: unknown): asserts value is OcctDraftRawReport {
  if (!isObject(value) || typeof value.delete !== "function") {
    facadeProtocolError("invariantcadDraftFacesAtomic() must return a deletable report");
  }
}

/**
 * Executes the owned atomic draft as a strict ownership transaction.
 *
 * No native result is transferred until the complete report and exact indexed
 * bijection have been copied and validated. The report is deleted before the
 * adoption callback runs, so that callback sees plain JavaScript data only.
 */
export function adoptOcctDraft<T>(options: AdoptOcctDraftOptions<T>): T {
  const module = probeOcctDraftFacade(options.module);
  if (module === undefined) throw new OcctDraftUnsupportedError();
  if (!isObject(options.kernel) || typeof options.kernel.release !== "function") {
    facadeProtocolError("kernel must provide release(resultId)");
  }
  assertUint32(options.shapeId, "shapeId");
  if (!Array.isArray(options.faceIds)) {
    facadeProtocolError("faceIds must be an array");
  }
  if (options.faceIds.length > INT32_MAX) {
    facadeProtocolError("faceIds length exceeds the signed 32-bit facade limit");
  }
  const faceIds = Array.from(options.faceIds, (faceId, index) => {
    assertUint32(faceId, `faceIds[${index}]`);
    return faceId;
  });

  let resultToRelease: number | undefined;
  try {
    let report: OcctDraftRawReport | undefined;
    let transferred: OcctDraftTransferredResult;
    try {
      const vector = makeFaceVector(module, faceIds);
      try {
        const rawReport = module.invariantcadDraftFacesAtomic(
          options.kernel,
          options.shapeId,
          vector,
          options.angleRad,
          options.pullDirection[0],
          options.pullDirection[1],
          options.pullDirection[2],
          options.neutralOrigin[0],
          options.neutralOrigin[1],
          options.neutralOrigin[2],
          options.neutralNormal[0],
          options.neutralNormal[1],
          options.neutralNormal[2],
        );
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
      validateReportSemantics(diagnostics, faceIds.length);

      if (!diagnostics.ok) throw new OcctDraftOperationError(diagnostics);
      const evolution = copyEvolution(
        report,
        topologyHistoryVersion,
        topologyHistoryComplete,
      );

      if (evolution === undefined) {
        facadeProtocolError("successful report does not provide complete history");
      }
      validateExactIndexedTopologyEvolutionEnvelope(evolution);

      const transferCode = readString(
        report.transferCode(options.kernel),
        "report.transferCode()",
      );
      if (transferCode !== "READY") {
        facadeProtocolError(
          `report transfer state is '${transferCode}', expected 'READY'`,
        );
      }

      const reportSnapshot = Object.freeze({
        diagnostics,
        evolution,
        transferCode: "READY" as const,
      });
      options.validate?.(reportSnapshot);

      const resultId = report.takeResultId(options.kernel);
      assertUint32(resultId, "report.takeResultId()");
      if (resultId === 0) {
        facadeProtocolError("report.takeResultId() returned reserved result ID 0");
      }
      resultToRelease = resultId;
      transferred = Object.freeze({
        resultId,
        report: reportSnapshot,
      });
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
