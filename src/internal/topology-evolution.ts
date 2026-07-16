import type {
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelTopologyLineage,
  KernelTopologySnapshot,
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

interface ValidatedRecord {
  readonly sourceShapeIndex: number;
  readonly sourceKind: SupportedTopologyKind;
  readonly sourceIndex: number;
  readonly relation: SupportedEvolutionRelation;
  readonly resultKind: SupportedTopologyKind;
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

function validateEvolution(
  evolution: IndexedTopologyEvolutionEnvelope,
  inputs: readonly KernelTopologySnapshot[],
  output: KernelTopologySnapshot,
): {
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
  if (!Array.isArray(inputs) || inputs.length !== evolution.inputShapeCount) {
    protocolError(
      `inputs has ${Array.isArray(inputs) ? inputs.length : "an invalid"} count; expected ${evolution.inputShapeCount}`,
    );
  }

  const inputCounts = Array.from(evolution.inputCounts, (counts, index) =>
    validateCounts(counts, `inputCounts[${index}]`),
  );
  const resultCounts = validateCounts(evolution.resultCounts, "resultCounts");
  for (let index = 0; index < inputCounts.length; index += 1) {
    const counts = inputCounts[index]!;
    validateSnapshot(inputs[index]!, counts, `inputs[${index}]`);
  }
  validateSnapshot(output, resultCounts, "output");

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

function inheritedLineage(
  source: KernelFaceDescriptor | KernelEdgeDescriptor,
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
  const validated = validateEvolution(
    options.evolution,
    options.inputs,
    options.output,
  );
  const faceEvolution: Array<DescriptorEvolution | undefined> = Array.from(
    { length: validated.resultCounts.faces },
  );
  const edgeEvolution: Array<DescriptorEvolution | undefined> = Array.from(
    { length: validated.resultCounts.edges },
  );
  for (const record of validated.records) {
    const target =
      record.resultKind === INDEXED_TOPOLOGY_KIND.FACE
        ? faceEvolution
        : record.resultKind === INDEXED_TOPOLOGY_KIND.EDGE
          ? edgeEvolution
          : undefined;
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

  return Object.freeze({
    history: options.inputs.every((input) => input.history === "complete")
      ? "complete"
      : "partial",
    faces: Object.freeze(faces),
    edges: Object.freeze(edges),
  });
}
