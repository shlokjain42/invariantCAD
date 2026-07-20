import {
  TOPOLOGY_ROLE_RULES,
  type TopologyKind,
  type TopologyRole,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelTopologyLineage,
  type KernelTopologySnapshot,
  type KernelVertexDescriptor,
} from "../protocol/topology.js";

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/** Stable numeric topology-kind codes shared with exact-kernel adapters. */
export const INDEXED_TOPOLOGY_KIND = Object.freeze({
  NONE: -1,
  FACE: 0,
  EDGE: 1,
  VERTEX: 2,
} as const);

/** Stable numeric evolution-relation codes shared with exact-kernel adapters. */
export const INDEXED_TOPOLOGY_RELATION = Object.freeze({
  PRESERVED: 0,
  MODIFIED: 1,
  GENERATED: 2,
  DELETED: 3,
  CREATED: 4,
} as const);

export interface IndexedTopologyCounts {
  readonly faces: number;
  readonly edges: number;
  readonly vertices: number;
}

/**
 * One generic N-input-to-one-result indexed evolution record.
 *
 * The fields remain numbers at this untrusted protocol boundary so adapters can
 * copy native records before validation without assertions or enum coercions.
 */
export interface IndexedTopologyEvolutionRecord {
  readonly sourceShapeIndex: number;
  readonly sourceKind: number;
  readonly sourceIndex: number;
  readonly relation: number;
  readonly resultKind: number;
  readonly resultIndex: number;
}

export interface IndexedTopologyEvolutionEnvelope {
  readonly version: number;
  readonly complete: boolean;
  readonly inputShapeCount: number;
  readonly inputCounts: readonly IndexedTopologyCounts[];
  readonly resultCounts: IndexedTopologyCounts;
  readonly records: readonly IndexedTopologyEvolutionRecord[];
}

export interface ReduceIndexedTopologyEvolutionOptions {
  readonly evolution: IndexedTopologyEvolutionEnvelope;
  readonly inputs: readonly KernelTopologySnapshot[];
  readonly output: KernelTopologySnapshot;
  readonly feature?: string;
}

/** Options for a complete, potentially non-bijective topology evolution. */
export interface ReduceCompleteIndexedTopologyEvolutionOptions
  extends ReduceIndexedTopologyEvolutionOptions {
  /**
   * Whether source-less CREATED records are valid for this feature profile.
   * Exact topology-changing features permit them only for residual result
   * topology that native source history cannot causally attribute.
   */
  readonly allowCreated?: boolean;
  /**
   * Treatment-face roles granted only to identity-less results with a matching
   * exact GENERATED edge-to-face relation. Source-less CREATED results do not
   * satisfy these rules.
   */
  readonly generatedTopologyRoles?: readonly ExactGeneratedTopologyRole[];
}

export interface ExactGeneratedTopologyRole {
  readonly producer: "fillet" | "chamfer";
  readonly source: "edge";
  readonly result: "face";
  readonly role: "fillet.face.blend" | "chamfer.face.bevel";
}

/** Exact-capability data is authoritative; malformed data must never downgrade. */
export class TopologyEvolutionProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid indexed topology evolution protocol: ${message}`);
    this.name = "TopologyEvolutionProtocolError";
  }
}

type SupportedTopologyKind =
  | typeof INDEXED_TOPOLOGY_KIND.FACE
  | typeof INDEXED_TOPOLOGY_KIND.EDGE
  | typeof INDEXED_TOPOLOGY_KIND.VERTEX;

type SupportedEvolutionRelation =
  | typeof INDEXED_TOPOLOGY_RELATION.PRESERVED
  | typeof INDEXED_TOPOLOGY_RELATION.MODIFIED;

type CompleteEvolutionRelation =
  | SupportedEvolutionRelation
  | typeof INDEXED_TOPOLOGY_RELATION.GENERATED
  | typeof INDEXED_TOPOLOGY_RELATION.DELETED
  | typeof INDEXED_TOPOLOGY_RELATION.CREATED;

interface ValidatedRecord {
  readonly sourceShapeIndex: number;
  readonly sourceKind: SupportedTopologyKind;
  readonly sourceIndex: number;
  readonly relation: SupportedEvolutionRelation;
  readonly resultKind: SupportedTopologyKind;
  readonly resultIndex: number;
}

interface ValidatedCompleteRecord {
  readonly sourceShapeIndex: number;
  readonly sourceKind: SupportedTopologyKind | typeof INDEXED_TOPOLOGY_KIND.NONE;
  readonly sourceIndex: number;
  readonly relation: CompleteEvolutionRelation;
  readonly resultKind: SupportedTopologyKind | typeof INDEXED_TOPOLOGY_KIND.NONE;
  readonly resultIndex: number;
}

interface DescriptorEvolution {
  readonly sourceShapeIndex: number;
  readonly sourceIndex: number;
  readonly relation: SupportedEvolutionRelation;
}

function protocolError(message: string): never {
  throw new TopologyEvolutionProtocolError(message);
}

function assertInt32(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < INT32_MIN ||
    value > INT32_MAX
  ) {
    protocolError(`${label} must be a signed 32-bit integer`);
  }
}

function assertIndex(value: unknown, label: string): asserts value is number {
  assertInt32(value, label);
  if (value < 0) protocolError(`${label} must be non-negative`);
}

function assertCount(value: unknown, label: string): asserts value is number {
  assertIndex(value, label);
}

function checkedAdd(first: number, second: number, label: string): number {
  const result = first + second;
  if (!Number.isSafeInteger(result) || result > INT32_MAX) {
    protocolError(`${label} exceeds the signed 32-bit record limit`);
  }
  return result;
}

function validateCounts(value: unknown, label: string): IndexedTopologyCounts {
  if (typeof value !== "object" || value === null) {
    protocolError(`${label} must be an object`);
  }
  const counts = value as Partial<IndexedTopologyCounts>;
  assertCount(counts.faces, `${label}.faces`);
  assertCount(counts.edges, `${label}.edges`);
  assertCount(counts.vertices, `${label}.vertices`);
  return {
    faces: counts.faces,
    edges: counts.edges,
    vertices: counts.vertices,
  };
}

function countForKind(
  counts: IndexedTopologyCounts,
  kind: SupportedTopologyKind,
): number {
  switch (kind) {
    case INDEXED_TOPOLOGY_KIND.FACE:
      return counts.faces;
    case INDEXED_TOPOLOGY_KIND.EDGE:
      return counts.edges;
    case INDEXED_TOPOLOGY_KIND.VERTEX:
      return counts.vertices;
  }
}

function kindName(kind: SupportedTopologyKind): "face" | "edge" | "vertex" {
  switch (kind) {
    case INDEXED_TOPOLOGY_KIND.FACE:
      return "face";
    case INDEXED_TOPOLOGY_KIND.EDGE:
      return "edge";
    case INDEXED_TOPOLOGY_KIND.VERTEX:
      return "vertex";
  }
}

function validateKind(value: number, label: string): SupportedTopologyKind {
  switch (value) {
    case INDEXED_TOPOLOGY_KIND.FACE:
    case INDEXED_TOPOLOGY_KIND.EDGE:
    case INDEXED_TOPOLOGY_KIND.VERTEX:
      return value;
    case INDEXED_TOPOLOGY_KIND.NONE:
      return protocolError(`${label} cannot be NONE for a preserved/modified record`);
    default:
      return protocolError(`${label} contains unknown topology kind '${value}'`);
  }
}

function validateRelation(value: number): SupportedEvolutionRelation {
  switch (value) {
    case INDEXED_TOPOLOGY_RELATION.PRESERVED:
    case INDEXED_TOPOLOGY_RELATION.MODIFIED:
      return value;
    case INDEXED_TOPOLOGY_RELATION.GENERATED:
    case INDEXED_TOPOLOGY_RELATION.DELETED:
    case INDEXED_TOPOLOGY_RELATION.CREATED:
      return protocolError(
        `relation '${value}' is not supported by the exact-bijection reducer`,
      );
    default:
      return protocolError(`record contains unknown relation '${value}'`);
  }
}

function recordKey(shape: number, kind: number, index: number): string {
  return `${shape}:${kind}:${index}`;
}

function resultKey(kind: number, index: number): string {
  return `${kind}:${index}`;
}

function validateSnapshot(
  snapshot: unknown,
  counts: IndexedTopologyCounts,
  label: string,
): asserts snapshot is KernelTopologySnapshot {
  if (typeof snapshot !== "object" || snapshot === null) {
    protocolError(`${label} must be a topology snapshot`);
  }
  const candidate = snapshot as Partial<KernelTopologySnapshot>;
  if (candidate.history !== "complete" && candidate.history !== "partial") {
    protocolError(`${label}.history must be 'complete' or 'partial'`);
  }
  if (!Array.isArray(candidate.faces) || candidate.faces.length !== counts.faces) {
    protocolError(
      `${label}.faces has ${Array.isArray(candidate.faces) ? candidate.faces.length : "an invalid"} count; expected ${counts.faces}`,
    );
  }
  if (!Array.isArray(candidate.edges) || candidate.edges.length !== counts.edges) {
    protocolError(
      `${label}.edges has ${Array.isArray(candidate.edges) ? candidate.edges.length : "an invalid"} count; expected ${counts.edges}`,
    );
  }
  if (
    !Array.isArray(candidate.vertices) ||
    candidate.vertices.length !== counts.vertices
  ) {
    protocolError(
      `${label}.vertices has ${Array.isArray(candidate.vertices) ? candidate.vertices.length : "an invalid"} count; expected ${counts.vertices}`,
    );
  }
  for (let index = 0; index < candidate.faces.length; index += 1) {
    const descriptor = candidate.faces[index];
    if (typeof descriptor !== "object" || descriptor === null) {
      protocolError(`${label}.faces[${index}] must be a descriptor`);
    }
    if (descriptor.topology !== "face") {
      protocolError(`${label}.faces[${index}] is not a face descriptor`);
    }
    validateLineage(descriptor.lineage, `${label}.faces[${index}].lineage`);
  }
  for (let index = 0; index < candidate.edges.length; index += 1) {
    const descriptor = candidate.edges[index];
    if (typeof descriptor !== "object" || descriptor === null) {
      protocolError(`${label}.edges[${index}] must be a descriptor`);
    }
    if (descriptor.topology !== "edge") {
      protocolError(`${label}.edges[${index}] is not an edge descriptor`);
    }
    validateLineage(descriptor.lineage, `${label}.edges[${index}].lineage`);
  }
  for (let index = 0; index < candidate.vertices.length; index += 1) {
    const descriptor = candidate.vertices[index];
    if (typeof descriptor !== "object" || descriptor === null) {
      protocolError(`${label}.vertices[${index}] must be a descriptor`);
    }
    if (descriptor.topology !== "vertex") {
      protocolError(`${label}.vertices[${index}] is not a vertex descriptor`);
    }
    validateLineage(descriptor.lineage, `${label}.vertices[${index}].lineage`);
  }
}

function validateLineage(value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    protocolError(`${label} must be an array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "object" || item === null) {
      protocolError(`${label}[${index}] must be a lineage record`);
    }
    const lineage = item as Partial<KernelTopologyLineage>;
    if (typeof lineage.feature !== "string") {
      protocolError(`${label}[${index}].feature must be a string`);
    }
    if (lineage.relation !== "created" && lineage.relation !== "modified") {
      protocolError(`${label}[${index}].relation is invalid`);
    }
    if (lineage.role !== undefined && typeof lineage.role !== "string") {
      protocolError(`${label}[${index}].role must be a string when present`);
    }
    if (lineage.source !== undefined) {
      if (
        typeof lineage.source !== "object" ||
        lineage.source === null ||
        lineage.source.kind !== "sketch-entity" ||
        typeof lineage.source.sketch !== "string" ||
        typeof lineage.source.entity !== "string"
      ) {
        protocolError(`${label}[${index}].source is invalid`);
      }
    }
  }
}

function aggregateInputCounts(
  counts: readonly IndexedTopologyCounts[],
  kind: SupportedTopologyKind,
): number {
  return counts.reduce(
    (total, item) =>
      checkedAdd(total, countForKind(item, kind), `${kindName(kind)} source count`),
    0,
  );
}

function validateEvolutionEnvelope(evolution: IndexedTopologyEvolutionEnvelope): {
  readonly records: readonly ValidatedRecord[];
  readonly inputCounts: readonly IndexedTopologyCounts[];
  readonly resultCounts: IndexedTopologyCounts;
} {
  if (typeof evolution !== "object" || evolution === null) {
    protocolError("evolution must be an object");
  }
  if (evolution.version !== 1) {
    protocolError(`version must be 1, received '${String(evolution.version)}'`);
  }
  if (evolution.complete !== true) {
    protocolError("history must declare complete coverage");
  }
  assertCount(evolution.inputShapeCount, "inputShapeCount");
  if (evolution.inputShapeCount === 0) {
    protocolError("inputShapeCount must be at least one");
  }
  if (!Array.isArray(evolution.inputCounts)) {
    protocolError("inputCounts must be an array");
  }
  if (evolution.inputCounts.length !== evolution.inputShapeCount) {
    protocolError(
      `inputCounts has ${evolution.inputCounts.length} entries; expected ${evolution.inputShapeCount}`,
    );
  }
  const inputCounts = Array.from(evolution.inputCounts, (counts, index) =>
    validateCounts(counts, `inputCounts[${index}]`),
  );
  const resultCounts = validateCounts(evolution.resultCounts, "resultCounts");

  const kinds = [
    INDEXED_TOPOLOGY_KIND.FACE,
    INDEXED_TOPOLOGY_KIND.EDGE,
    INDEXED_TOPOLOGY_KIND.VERTEX,
  ] as const;
  let sourceTotal = 0;
  let resultTotal = 0;
  for (const kind of kinds) {
    const sourceKindCount = aggregateInputCounts(inputCounts, kind);
    const resultKindCount = countForKind(resultCounts, kind);
    if (sourceKindCount !== resultKindCount) {
      protocolError(
        `${kindName(kind)} cardinality changed from ${sourceKindCount} to ${resultKindCount}`,
      );
    }
    sourceTotal = checkedAdd(sourceTotal, sourceKindCount, "source record count");
    resultTotal = checkedAdd(resultTotal, resultKindCount, "result record count");
  }

  if (!Array.isArray(evolution.records)) {
    protocolError("records must be an array");
  }
  if (
    evolution.records.length !== sourceTotal ||
    evolution.records.length !== resultTotal
  ) {
    protocolError(
      `records has ${evolution.records.length} entries; expected ${sourceTotal}`,
    );
  }

  const sourceRecords = new Set<string>();
  const resultRecords = new Set<string>();
  const records = Array.from(
    evolution.records,
    (record, recordIndex): ValidatedRecord => {
      if (typeof record !== "object" || record === null) {
        protocolError(`records[${recordIndex}] must be an object`);
      }
      const label = `records[${recordIndex}]`;
      assertInt32(record.sourceShapeIndex, `${label}.sourceShapeIndex`);
      assertInt32(record.sourceKind, `${label}.sourceKind`);
      assertInt32(record.sourceIndex, `${label}.sourceIndex`);
      assertInt32(record.relation, `${label}.relation`);
      assertInt32(record.resultKind, `${label}.resultKind`);
      assertInt32(record.resultIndex, `${label}.resultIndex`);

      const relation = validateRelation(record.relation);
      const sourceKind = validateKind(record.sourceKind, `${label}.sourceKind`);
      const resultKind = validateKind(record.resultKind, `${label}.resultKind`);
      assertIndex(record.sourceShapeIndex, `${label}.sourceShapeIndex`);
      assertIndex(record.sourceIndex, `${label}.sourceIndex`);
      assertIndex(record.resultIndex, `${label}.resultIndex`);

      if (record.sourceShapeIndex >= inputCounts.length) {
        protocolError(
          `${label}.sourceShapeIndex '${record.sourceShapeIndex}' is out of range`,
        );
      }
      if (sourceKind !== resultKind) {
        protocolError(`${label} changes topology kind`);
      }
      if (
        record.sourceIndex >=
        countForKind(inputCounts[record.sourceShapeIndex]!, sourceKind)
      ) {
        protocolError(`${label}.sourceIndex '${record.sourceIndex}' is out of range`);
      }
      if (record.resultIndex >= countForKind(resultCounts, resultKind)) {
        protocolError(`${label}.resultIndex '${record.resultIndex}' is out of range`);
      }

      const source = recordKey(
        record.sourceShapeIndex,
        sourceKind,
        record.sourceIndex,
      );
      if (sourceRecords.has(source)) {
        protocolError(`${label} duplicates source topology '${source}'`);
      }
      sourceRecords.add(source);

      const result = resultKey(resultKind, record.resultIndex);
      if (resultRecords.has(result)) {
        protocolError(`${label} duplicates result topology '${result}'`);
      }
      resultRecords.add(result);

      return {
        sourceShapeIndex: record.sourceShapeIndex,
        sourceKind,
        sourceIndex: record.sourceIndex,
        relation,
        resultKind,
        resultIndex: record.resultIndex,
      };
    },
  );

  if (sourceRecords.size !== sourceTotal || resultRecords.size !== resultTotal) {
    protocolError("records do not provide complete one-to-one topology coverage");
  }
  return { records, inputCounts, resultCounts };
}

interface CompleteEvolutionValidationOptions {
  readonly allowCreated: boolean;
}

function completeRecordKey(record: IndexedTopologyEvolutionRecord): string {
  return [
    record.sourceShapeIndex,
    record.sourceKind,
    record.sourceIndex,
    record.relation,
    record.resultKind,
    record.resultIndex,
  ].join(":");
}

function validateCompleteKind(
  value: number,
  label: string,
): SupportedTopologyKind {
  switch (value) {
    case INDEXED_TOPOLOGY_KIND.FACE:
    case INDEXED_TOPOLOGY_KIND.EDGE:
    case INDEXED_TOPOLOGY_KIND.VERTEX:
      return value;
    case INDEXED_TOPOLOGY_KIND.NONE:
      return protocolError(`${label} cannot be NONE for this relation`);
    default:
      return protocolError(`${label} contains unknown topology kind '${value}'`);
  }
}

function validateCompleteEvolutionEnvelope(
  evolution: IndexedTopologyEvolutionEnvelope,
  options: CompleteEvolutionValidationOptions,
): {
  readonly records: readonly ValidatedCompleteRecord[];
  readonly inputCounts: readonly IndexedTopologyCounts[];
  readonly resultCounts: IndexedTopologyCounts;
} {
  if (typeof evolution !== "object" || evolution === null) {
    protocolError("evolution must be an object");
  }
  if (evolution.version !== 1) {
    protocolError(`version must be 1, received '${String(evolution.version)}'`);
  }
  if (evolution.complete !== true) {
    protocolError("history must declare complete coverage");
  }
  assertCount(evolution.inputShapeCount, "inputShapeCount");
  if (evolution.inputShapeCount === 0) {
    protocolError("inputShapeCount must be at least one");
  }
  if (!Array.isArray(evolution.inputCounts)) {
    protocolError("inputCounts must be an array");
  }
  if (evolution.inputCounts.length !== evolution.inputShapeCount) {
    protocolError(
      `inputCounts has ${evolution.inputCounts.length} entries; expected ${evolution.inputShapeCount}`,
    );
  }
  const inputCounts = Array.from(evolution.inputCounts, (counts, index) =>
    validateCounts(counts, `inputCounts[${index}]`),
  );
  const resultCounts = validateCounts(evolution.resultCounts, "resultCounts");
  if (!Array.isArray(evolution.records)) {
    protocolError("records must be an array");
  }
  if (evolution.records.length > INT32_MAX) {
    protocolError("records exceeds the signed 32-bit record limit");
  }

  const exactRecords = new Set<string>();
  const linkedPairs = new Set<string>();
  const sourceStates = new Map<
    string,
    { successor: boolean; deleted: boolean }
  >();
  const resultStates = new Map<
    string,
    { attributed: boolean; created: boolean }
  >();

  const requireSource = (
    sourceShapeIndex: number,
    sourceKind: SupportedTopologyKind,
    sourceIndex: number,
    label: string,
  ): void => {
    assertIndex(sourceShapeIndex, `${label}.sourceShapeIndex`);
    assertIndex(sourceIndex, `${label}.sourceIndex`);
    if (sourceShapeIndex >= inputCounts.length) {
      protocolError(
        `${label}.sourceShapeIndex '${sourceShapeIndex}' is out of range`,
      );
    }
    if (sourceIndex >= countForKind(inputCounts[sourceShapeIndex]!, sourceKind)) {
      protocolError(`${label}.sourceIndex '${sourceIndex}' is out of range`);
    }
  };
  const requireResult = (
    resultKind: SupportedTopologyKind,
    resultIndex: number,
    label: string,
  ): void => {
    assertIndex(resultIndex, `${label}.resultIndex`);
    if (resultIndex >= countForKind(resultCounts, resultKind)) {
      protocolError(`${label}.resultIndex '${resultIndex}' is out of range`);
    }
  };

  const records = Array.from(
    evolution.records,
    (record, recordIndex): ValidatedCompleteRecord => {
      if (typeof record !== "object" || record === null) {
        protocolError(`records[${recordIndex}] must be an object`);
      }
      const label = `records[${recordIndex}]`;
      assertInt32(record.sourceShapeIndex, `${label}.sourceShapeIndex`);
      assertInt32(record.sourceKind, `${label}.sourceKind`);
      assertInt32(record.sourceIndex, `${label}.sourceIndex`);
      assertInt32(record.relation, `${label}.relation`);
      assertInt32(record.resultKind, `${label}.resultKind`);
      assertInt32(record.resultIndex, `${label}.resultIndex`);

      const exact = completeRecordKey(record);
      if (exactRecords.has(exact)) {
        protocolError(`${label} duplicates an earlier evolution record`);
      }
      exactRecords.add(exact);

      switch (record.relation) {
        case INDEXED_TOPOLOGY_RELATION.PRESERVED:
        case INDEXED_TOPOLOGY_RELATION.MODIFIED:
        case INDEXED_TOPOLOGY_RELATION.GENERATED: {
          const sourceKind = validateCompleteKind(
            record.sourceKind,
            `${label}.sourceKind`,
          );
          const resultKind = validateCompleteKind(
            record.resultKind,
            `${label}.resultKind`,
          );
          requireSource(
            record.sourceShapeIndex,
            sourceKind,
            record.sourceIndex,
            label,
          );
          requireResult(resultKind, record.resultIndex, label);
          if (
            record.relation !== INDEXED_TOPOLOGY_RELATION.GENERATED &&
            sourceKind !== resultKind
          ) {
            protocolError(`${label} changes topology kind without GENERATED`);
          }

          const source = recordKey(
            record.sourceShapeIndex,
            sourceKind,
            record.sourceIndex,
          );
          const result = resultKey(resultKind, record.resultIndex);
          const pair = `${source}>${result}`;
          if (linkedPairs.has(pair)) {
            protocolError(`${label} gives one source/result pair multiple relations`);
          }
          linkedPairs.add(pair);

          const sourceState = sourceStates.get(source) ?? {
            successor: false,
            deleted: false,
          };
          if (
            record.relation !== INDEXED_TOPOLOGY_RELATION.GENERATED
          ) {
            if (sourceState.deleted) {
              protocolError(`${label} contradicts a DELETED source record`);
            }
            sourceState.successor = true;
          }
          sourceStates.set(source, sourceState);

          const resultState = resultStates.get(result) ?? {
            attributed: false,
            created: false,
          };
          if (resultState.created) {
            protocolError(`${label} attributes a source-less CREATED result`);
          }
          resultState.attributed = true;
          resultStates.set(result, resultState);
          return {
            sourceShapeIndex: record.sourceShapeIndex,
            sourceKind,
            sourceIndex: record.sourceIndex,
            relation: record.relation,
            resultKind,
            resultIndex: record.resultIndex,
          };
        }
        case INDEXED_TOPOLOGY_RELATION.DELETED: {
          const sourceKind = validateCompleteKind(
            record.sourceKind,
            `${label}.sourceKind`,
          );
          requireSource(
            record.sourceShapeIndex,
            sourceKind,
            record.sourceIndex,
            label,
          );
          if (
            record.resultKind !== INDEXED_TOPOLOGY_KIND.NONE ||
            record.resultIndex !== -1
          ) {
            protocolError(`${label} must use NONE/-1 for a DELETED result`);
          }
          const source = recordKey(
            record.sourceShapeIndex,
            sourceKind,
            record.sourceIndex,
          );
          const sourceState = sourceStates.get(source) ?? {
            successor: false,
            deleted: false,
          };
          if (sourceState.successor) {
            protocolError(`${label} contradicts a preserved/modified successor`);
          }
          sourceState.deleted = true;
          sourceStates.set(source, sourceState);
          return {
            sourceShapeIndex: record.sourceShapeIndex,
            sourceKind,
            sourceIndex: record.sourceIndex,
            relation: record.relation,
            resultKind: INDEXED_TOPOLOGY_KIND.NONE,
            resultIndex: -1,
          };
        }
        case INDEXED_TOPOLOGY_RELATION.CREATED: {
          if (!options.allowCreated) {
            protocolError(`${label} uses CREATED, which this feature profile forbids`);
          }
          if (
            record.sourceShapeIndex !== -1 ||
            record.sourceKind !== INDEXED_TOPOLOGY_KIND.NONE ||
            record.sourceIndex !== -1
          ) {
            protocolError(`${label} must use -1/NONE/-1 for a CREATED source`);
          }
          const resultKind = validateCompleteKind(
            record.resultKind,
            `${label}.resultKind`,
          );
          requireResult(resultKind, record.resultIndex, label);
          const result = resultKey(resultKind, record.resultIndex);
          const resultState = resultStates.get(result) ?? {
            attributed: false,
            created: false,
          };
          if (resultState.attributed) {
            protocolError(`${label} marks an attributed result as source-less CREATED`);
          }
          resultState.created = true;
          resultStates.set(result, resultState);
          return {
            sourceShapeIndex: -1,
            sourceKind: INDEXED_TOPOLOGY_KIND.NONE,
            sourceIndex: -1,
            relation: record.relation,
            resultKind,
            resultIndex: record.resultIndex,
          };
        }
        default:
          return protocolError(
            `record contains unknown relation '${record.relation}'`,
          );
      }
    },
  );

  const kinds = [
    INDEXED_TOPOLOGY_KIND.FACE,
    INDEXED_TOPOLOGY_KIND.EDGE,
    INDEXED_TOPOLOGY_KIND.VERTEX,
  ] as const;
  let sourceTotal = 0;
  for (const count of inputCounts) {
    for (const kind of kinds) {
      sourceTotal = checkedAdd(
        sourceTotal,
        countForKind(count, kind),
        "source topology count",
      );
    }
  }
  if (sourceStates.size !== sourceTotal) {
    protocolError(
      `records cover ${sourceStates.size} source topology items; expected ${sourceTotal}`,
    );
  }
  for (const [source, state] of sourceStates) {
    if (!state.successor && !state.deleted) {
      protocolError(`source topology '${source}' has no successor or DELETED record`);
    }
  }
  let resultTotal = 0;
  for (const kind of kinds) {
    resultTotal = checkedAdd(
      resultTotal,
      countForKind(resultCounts, kind),
      "result topology count",
    );
  }
  if (resultStates.size !== resultTotal) {
    protocolError(
      `records cover ${resultStates.size} result topology items; expected ${resultTotal}`,
    );
  }
  for (const [result, state] of resultStates) {
    if (!state.attributed && !state.created) {
      protocolError(`result topology '${result}' has no evolution record`);
    }
  }

  return { records, inputCounts, resultCounts };
}

/**
 * Validates the version-1 exact preserved/modified bijection without touching
 * any topology snapshots. Raw-kernel adapters use this before transferring an
 * owned native result; malformed exact-capability data must fail while the
 * native report still owns that result.
 */
export function validateExactIndexedTopologyEvolutionEnvelope(
  evolution: IndexedTopologyEvolutionEnvelope,
): void {
  validateEvolutionEnvelope(evolution);
}

/**
 * Validates complete version-1 non-bijective topology evolution.
 *
 * PRESERVED and MODIFIED are same-kind source/result links; GENERATED may
 * change kind; DELETED terminates a source with NONE/-1; and CREATED starts a
 * source-less result with -1/NONE/-1. Feature adapters may forbid CREATED when
 * their operation contract requires every result to be attributable.
 */
export function validateCompleteIndexedTopologyEvolutionEnvelope(
  evolution: IndexedTopologyEvolutionEnvelope,
  options: { readonly allowCreated?: boolean } = {},
): void {
  validateCompleteEvolutionEnvelope(evolution, {
    allowCreated: options.allowCreated ?? true,
  });
}

function inheritedLineage(
  source: KernelFaceDescriptor | KernelEdgeDescriptor | KernelVertexDescriptor,
  relation: SupportedEvolutionRelation,
  feature: string | undefined,
): readonly KernelTopologyLineage[] {
  const alreadyModified =
    feature !== undefined &&
    source.lineage.some(
      (item) =>
        item.feature === feature &&
        item.relation === "modified" &&
        item.role === undefined &&
        item.source === undefined,
    );
  const copied = Array.from(source.lineage, (item) =>
    Object.freeze({
      ...item,
      ...(item.source === undefined
        ? {}
        : { source: Object.freeze({ ...item.source }) }),
    }),
  );
  return Object.freeze([
    ...copied,
    ...(relation === INDEXED_TOPOLOGY_RELATION.MODIFIED &&
      feature !== undefined &&
      !alreadyModified
      ? [Object.freeze({ feature, relation: "modified" as const })]
      : []),
  ]);
}

/**
 * Applies a complete exact indexed topology bijection to an output snapshot.
 *
 * Only PRESERVED and MODIFIED are intentionally supported. Supporting
 * GENERATED, CREATED, or DELETED requires non-bijective ancestry semantics;
 * until those semantics are specified, receiving them is a protocol failure.
 */
export function reduceIndexedTopologyEvolution(
  options: ReduceIndexedTopologyEvolutionOptions,
): KernelTopologySnapshot {
  if (
    options.feature !== undefined &&
    (typeof options.feature !== "string" || options.feature.length === 0)
  ) {
    throw new TypeError(
      "Topology evolution feature must be a non-empty string when provided",
    );
  }
  const validated = validateEvolutionEnvelope(options.evolution);
  if (
    !Array.isArray(options.inputs) ||
    options.inputs.length !== options.evolution.inputShapeCount
  ) {
    protocolError(
      `inputs has ${Array.isArray(options.inputs) ? options.inputs.length : "an invalid"} count; expected ${options.evolution.inputShapeCount}`,
    );
  }
  for (let index = 0; index < validated.inputCounts.length; index += 1) {
    validateSnapshot(
      options.inputs[index]!,
      validated.inputCounts[index]!,
      `inputs[${index}]`,
    );
  }
  validateSnapshot(options.output, validated.resultCounts, "output");
  const faceEvolution: Array<DescriptorEvolution | undefined> = Array.from(
    { length: validated.resultCounts.faces },
  );
  const edgeEvolution: Array<DescriptorEvolution | undefined> = Array.from(
    { length: validated.resultCounts.edges },
  );
  const vertexEvolution: Array<DescriptorEvolution | undefined> = Array.from(
    { length: validated.resultCounts.vertices },
  );
  for (const record of validated.records) {
    const target =
      record.resultKind === INDEXED_TOPOLOGY_KIND.FACE
        ? faceEvolution
        : record.resultKind === INDEXED_TOPOLOGY_KIND.EDGE
          ? edgeEvolution
          : vertexEvolution;
    if (target !== undefined) {
      target[record.resultIndex] = {
        sourceShapeIndex: record.sourceShapeIndex,
        sourceIndex: record.sourceIndex,
        relation: record.relation,
      };
    }
  }

  const faces = options.output.faces.map((descriptor, resultIndex) => {
    const evolution = faceEvolution[resultIndex];
    if (evolution === undefined) {
      return protocolError(`face result '${resultIndex}' has no evolution record`);
    }
    const source = options.inputs[evolution.sourceShapeIndex]!.faces[
      evolution.sourceIndex
    ]!;
    return Object.freeze({
      ...descriptor,
      lineage: inheritedLineage(source, evolution.relation, options.feature),
    });
  });
  const edges = options.output.edges.map((descriptor, resultIndex) => {
    const evolution = edgeEvolution[resultIndex];
    if (evolution === undefined) {
      return protocolError(`edge result '${resultIndex}' has no evolution record`);
    }
    const source = options.inputs[evolution.sourceShapeIndex]!.edges[
      evolution.sourceIndex
    ]!;
    return Object.freeze({
      ...descriptor,
      lineage: inheritedLineage(source, evolution.relation, options.feature),
    });
  });
  const vertices = options.output.vertices.map((descriptor, resultIndex) => {
    const evolution = vertexEvolution[resultIndex];
    if (evolution === undefined) {
      return protocolError(`vertex result '${resultIndex}' has no evolution record`);
    }
    const source = options.inputs[evolution.sourceShapeIndex]!.vertices[
      evolution.sourceIndex
    ]!;
    return Object.freeze({
      ...descriptor,
      lineage: inheritedLineage(source, evolution.relation, options.feature),
    });
  });

  return Object.freeze({
    history: options.inputs.every((input) => input.history === "complete")
      ? "complete"
      : "partial",
    faces: Object.freeze(faces),
    edges: Object.freeze(edges),
    vertices: Object.freeze(vertices),
  });
}

function lineageIdentity(lineage: KernelTopologyLineage): string {
  return [
    lineage.feature,
    lineage.relation,
    lineage.role ?? "",
    lineage.source?.kind ?? "",
    lineage.source?.sketch ?? "",
    lineage.source?.entity ?? "",
  ].join("\u0000");
}

function copyDescriptorLineage(
  source: KernelFaceDescriptor | KernelEdgeDescriptor | KernelVertexDescriptor,
): readonly KernelTopologyLineage[] {
  return source.lineage.map((item) => {
    return Object.freeze({
      ...item,
      ...(item.source === undefined
        ? {}
        : { source: Object.freeze({ ...item.source }) }),
    });
  });
}

function compareCompleteRecords(
  first: ValidatedCompleteRecord,
  second: ValidatedCompleteRecord,
): number {
  return (
    first.resultKind - second.resultKind ||
    first.resultIndex - second.resultIndex ||
    first.sourceShapeIndex - second.sourceShapeIndex ||
    first.sourceKind - second.sourceKind ||
    first.sourceIndex - second.sourceIndex ||
    first.relation - second.relation
  );
}

/**
 * Applies a complete non-bijective indexed evolution graph to an output.
 *
 * Lineage is merged in canonical source-index order, independent of native
 * record order. Only same-kind PRESERVED/MODIFIED identity links inherit
 * semantic lineage. GENERATED remains exact causal coverage without pretending
 * that a new subshape has the source's identity. Results without an identity
 * predecessor are created by the current feature; otherwise MODIFIED reflects
 * whether any identity predecessor changed.
 */
export function reduceCompleteIndexedTopologyEvolution(
  options: ReduceCompleteIndexedTopologyEvolutionOptions,
): KernelTopologySnapshot {
  if (
    options.feature !== undefined &&
    (typeof options.feature !== "string" || options.feature.length === 0)
  ) {
    throw new TypeError(
      "Topology evolution feature must be a non-empty string when provided",
    );
  }
  const generatedTopologyRoles = options.generatedTopologyRoles ?? [];
  if (generatedTopologyRoles.length > 0 && options.feature === undefined) {
    throw new TypeError(
      "Generated topology roles require a current topology evolution feature",
    );
  }
  const generatedRoleResults = new Set<TopologyKind>();
  for (const [index, generatedRole] of generatedTopologyRoles.entries()) {
    const roleRule = TOPOLOGY_ROLE_RULES[generatedRole.role];
    if (
      roleRule === undefined ||
      (generatedRole.role !== "fillet.face.blend" &&
        generatedRole.role !== "chamfer.face.bevel") ||
      generatedRole.source !== "edge" ||
      generatedRole.result !== "face" ||
      roleRule.producer !== generatedRole.producer ||
      roleRule.topology !== generatedRole.result ||
      roleRule.relation !== "created" ||
      roleRule.source !== "none"
    ) {
      throw new TypeError(
        `Generated topology role rule ${index} is incompatible with '${String(generatedRole.role)}'`,
      );
    }
    if (generatedRoleResults.has(generatedRole.result)) {
      throw new TypeError(
        `Generated topology role rule ${index} duplicates result topology '${generatedRole.result}'`,
      );
    }
    generatedRoleResults.add(generatedRole.result);
  }
  const validated = validateCompleteEvolutionEnvelope(options.evolution, {
    allowCreated: options.allowCreated ?? true,
  });
  if (
    !Array.isArray(options.inputs) ||
    options.inputs.length !== options.evolution.inputShapeCount
  ) {
    protocolError(
      `inputs has ${Array.isArray(options.inputs) ? options.inputs.length : "an invalid"} count; expected ${options.evolution.inputShapeCount}`,
    );
  }
  for (let index = 0; index < validated.inputCounts.length; index += 1) {
    validateSnapshot(
      options.inputs[index]!,
      validated.inputCounts[index]!,
      `inputs[${index}]`,
    );
  }
  validateSnapshot(options.output, validated.resultCounts, "output");

  const faceEvolution = Array.from(
    { length: validated.resultCounts.faces },
    (): ValidatedCompleteRecord[] => [],
  );
  const edgeEvolution = Array.from(
    { length: validated.resultCounts.edges },
    (): ValidatedCompleteRecord[] => [],
  );
  const vertexEvolution = Array.from(
    { length: validated.resultCounts.vertices },
    (): ValidatedCompleteRecord[] => [],
  );
  for (const record of [...validated.records].sort(compareCompleteRecords)) {
    if (record.resultKind === INDEXED_TOPOLOGY_KIND.FACE) {
      faceEvolution[record.resultIndex]!.push(record);
    } else if (record.resultKind === INDEXED_TOPOLOGY_KIND.EDGE) {
      edgeEvolution[record.resultIndex]!.push(record);
    } else if (record.resultKind === INDEXED_TOPOLOGY_KIND.VERTEX) {
      vertexEvolution[record.resultIndex]!.push(record);
    }
  }

  const reduceDescriptor = <
    Descriptor extends
      | KernelFaceDescriptor
      | KernelEdgeDescriptor
      | KernelVertexDescriptor,
  >(
    topology: TopologyKind,
    descriptor: Descriptor,
    records: readonly ValidatedCompleteRecord[],
  ): Descriptor => {
    const lineage: KernelTopologyLineage[] = [];
    const seen = new Set<string>();
    let hasIdentityPredecessor = false;
    let hasModifiedIdentity = false;
    let hasCreationCause = false;
    const append = (item: KernelTopologyLineage): void => {
      const identity = lineageIdentity(item);
      if (seen.has(identity)) return;
      seen.add(identity);
      lineage.push(item);
    };

    for (const record of records) {
      if (
        record.relation === INDEXED_TOPOLOGY_RELATION.CREATED
      ) {
        hasCreationCause = true;
        continue;
      }
      if (
        record.relation === INDEXED_TOPOLOGY_RELATION.DELETED ||
        record.sourceKind === INDEXED_TOPOLOGY_KIND.NONE
      ) {
        continue;
      }
      if (record.relation === INDEXED_TOPOLOGY_RELATION.GENERATED) {
        hasCreationCause = true;
        continue;
      }
      hasIdentityPredecessor = true;
      if (record.relation === INDEXED_TOPOLOGY_RELATION.MODIFIED) {
        hasModifiedIdentity = true;
      }
      const sourceSnapshot = options.inputs[record.sourceShapeIndex]!;
      const source =
        record.sourceKind === INDEXED_TOPOLOGY_KIND.FACE
          ? sourceSnapshot.faces[record.sourceIndex]
          : record.sourceKind === INDEXED_TOPOLOGY_KIND.EDGE
            ? sourceSnapshot.edges[record.sourceIndex]
            : sourceSnapshot.vertices[record.sourceIndex];
      if (source !== undefined) {
        for (const item of copyDescriptorLineage(source)) {
          append(item);
        }
      }
    }
    const currentRelation = hasIdentityPredecessor
      ? hasModifiedIdentity
        ? "modified"
        : undefined
      : hasCreationCause
        ? "created"
        : undefined;
    const generatedRole =
      currentRelation === "created"
        ? generatedTopologyRoles.find(
            (rule) =>
              rule.result === topology &&
              records.some(
                (record) =>
                  record.relation === INDEXED_TOPOLOGY_RELATION.GENERATED &&
                  record.sourceKind !== INDEXED_TOPOLOGY_KIND.NONE &&
                  kindName(record.sourceKind) === rule.source,
              ),
          )?.role
        : undefined;
    const alreadyCreatedByCurrentFeature =
      options.feature !== undefined &&
      lineage.some(
        (item) =>
          item.feature === options.feature &&
          item.relation === "created" &&
          item.role === undefined &&
          item.source === undefined,
      );
    if (
      options.feature !== undefined &&
      currentRelation !== undefined &&
      !(currentRelation === "modified" && alreadyCreatedByCurrentFeature)
    ) {
      append(
        Object.freeze({
          feature: options.feature,
          relation: currentRelation,
          ...(generatedRole === undefined ? {} : { role: generatedRole }),
        }),
      );
    }
    return Object.freeze({
      ...descriptor,
      lineage: Object.freeze(lineage),
    }) as unknown as Descriptor;
  };

  const faces = options.output.faces.map((descriptor, resultIndex) =>
    reduceDescriptor(
      "face",
      descriptor,
      faceEvolution[resultIndex]!,
    ),
  );
  const edges = options.output.edges.map((descriptor, resultIndex) =>
    reduceDescriptor(
      "edge",
      descriptor,
      edgeEvolution[resultIndex]!,
    ),
  );
  const vertices = options.output.vertices.map((descriptor, resultIndex) =>
    reduceDescriptor(
      "vertex",
      descriptor,
      vertexEvolution[resultIndex]!,
    ),
  );

  return Object.freeze({
    history: options.inputs.every((input) => input.history === "complete")
      ? "complete"
      : "partial",
    faces: Object.freeze(faces),
    edges: Object.freeze(edges),
    vertices: Object.freeze(vertices),
  });
}
