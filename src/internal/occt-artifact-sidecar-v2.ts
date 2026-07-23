import type { ShapeOrientation, ShapeType } from "occt-wasm";
import { deepFreeze } from "../core/json.js";
import type {
  KernelCurveDescriptor,
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelSurfaceDescriptor,
  KernelTopologyKey,
  KernelTopologyLineage,
  KernelTopologySnapshot,
  KernelVertexDescriptor,
  TopologyRole,
} from "../protocol/topology.js";
import { TOPOLOGY_ROLE_RULES } from "../protocol/topology.js";
import {
  assertValidKernelTopologySnapshot,
  detachKernelTopologySnapshot,
} from "./topology-snapshot.js";
import { throwOcctArtifactLimitRefusal } from "./occt-artifact-limit.js";
import type {
  OcctShapeArtifactCapturedSidecarState,
  OcctShapeArtifactNativeStructure,
} from "./occt-artifact-candidate.js";

export const OCCT_ARTIFACT_SIDECAR_V2_HEADER_BYTES = 48;
export const OCCT_ARTIFACT_SIDECAR_V2_MAX_BYTES = 16 * 1024 * 1024;
export const OCCT_ARTIFACT_SIDECAR_V2_MIN_BYTES = 66;

const MAX_UINT32 = 0xffff_ffff;
const MAX_TOPOLOGY_ITEMS = 100_000;
const MAX_ADJACENCY_LINKS = 1_000_000;
const MAX_LINEAGE_RECORDS = 1_000_000;
const MAX_STRING_BYTES = 1_000_000;
const MAX_PREPARATION_STRING_WORK_BYTES = OCCT_ARTIFACT_SIDECAR_V2_MAX_BYTES;
const MAX_NATIVE_ORIENTATIONS = 1_000_000;
const VERSION = 2;
const MAGIC = new Uint8Array([
  0x49, 0x43, 0x41, 0x44, 0x53, 0x49, 0x44, 0x45, // ICADSIDE
]);

const SHAPE_TYPES = [
  "compound",
  "compsolid",
  "solid",
  "shell",
  "face",
  "wire",
  "edge",
  "vertex",
  "shape",
] as const satisfies readonly ShapeType[];
const SHAPE_ORIENTATIONS = [
  "forward",
  "reversed",
  "internal",
  "external",
] as const satisfies readonly ShapeOrientation[];
const HISTORIES = ["complete", "partial"] as const;
const RELATIONS = ["created", "modified"] as const;

type TopologyHistory = KernelTopologySnapshot["history"];

export interface OcctArtifactSidecarV2EncodeOptions {
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

export interface OcctArtifactSidecarV2DecodeOptions {
  readonly signal?: AbortSignal;
}

interface PreparedFace {
  readonly value: KernelFaceDescriptor;
  readonly lineage: readonly KernelTopologyLineage[];
  readonly edges: readonly number[];
}

interface PreparedEdge {
  readonly value: KernelEdgeDescriptor;
  readonly lineage: readonly KernelTopologyLineage[];
  readonly faces: readonly number[];
  readonly vertices: readonly number[];
}

interface PreparedVertex {
  readonly value: KernelVertexDescriptor;
  readonly lineage: readonly KernelTopologyLineage[];
  readonly edges: readonly number[];
}

interface PreparedSidecar {
  readonly history: TopologyHistory;
  readonly topologyHistory: TopologyHistory;
  readonly volumeOverride?: number;
  readonly nativeStructure: OcctShapeArtifactNativeStructure;
  readonly lineage: readonly KernelTopologyLineage[];
  readonly faces: readonly PreparedFace[];
  readonly edges: readonly PreparedEdge[];
  readonly vertices: readonly PreparedVertex[];
  readonly adjacencyLinks: number;
  readonly lineageRecords: number;
  readonly stringBytes: number;
  readonly nativeOrientations: number;
}

interface SidecarHeader {
  readonly totalBytes: number;
  readonly faces: number;
  readonly edges: number;
  readonly vertices: number;
  readonly adjacencyLinks: number;
  readonly lineageRecords: number;
  readonly stringBytes: number;
  readonly nativeOrientations: number;
  readonly history: TopologyHistory;
  readonly topologyHistory: TopologyHistory;
  readonly volumePresent: boolean;
}

interface PreparationBudget {
  lineageRecords: number;
  stringBytes: number;
}

interface CapturedArray {
  readonly value: readonly unknown[];
  readonly length: number;
}

function abortError(): DOMException {
  return new DOMException("OCCT shape-artifact operation was aborted", "AbortError");
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError();
}

function checkedAdd(total: number, addition: number, label: string): number {
  const next = total + addition;
  if (
    !Number.isSafeInteger(addition) ||
    addition < 0 ||
    !Number.isSafeInteger(next) ||
    next > MAX_UINT32
  ) {
    throw new RangeError(`${label} exceeds the sidecar format limit`);
  }
  return next;
}

function checkedMultiply(
  value: number,
  multiplier: number,
  label: string,
): number {
  const result = value * multiplier;
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_UINT32) {
    throw new RangeError(`${label} exceeds the sidecar format limit`);
  }
  return result;
}

function assertBudget(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${label} budget was exceeded`);
  }
}

function stringByteLength(value: string): number {
  return checkedMultiply(value.length, 2, "Shape-artifact strings");
}

function chargePreparationString(
  value: string,
  budget: PreparationBudget,
): void {
  budget.stringBytes = checkedAdd(
    budget.stringBytes,
    stringByteLength(value),
    "Shape-artifact preparation strings",
  );
  assertBudget(
    budget.stringBytes,
    MAX_PREPARATION_STRING_WORK_BYTES,
    "Shape-artifact preparation string",
  );
}

function compareStrings(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function compareOptionalStrings(
  first: string | undefined,
  second: string | undefined,
): number {
  if (first === undefined) return second === undefined ? 0 : -1;
  if (second === undefined) return 1;
  return compareStrings(first, second);
}

/**
 * Canonical lineage order is fieldwise, using JavaScript UTF-16 code-unit
 * ordering for strings: feature, relation, role presence/value, then source
 * presence/sketch/entity. It is locale-independent and collision-free.
 */
function compareLineage(
  first: KernelTopologyLineage,
  second: KernelTopologyLineage,
): number {
  let compared = compareStrings(first.feature, second.feature);
  if (compared !== 0) return compared;
  compared =
    RELATIONS.indexOf(first.relation) - RELATIONS.indexOf(second.relation);
  if (compared !== 0) return compared;
  compared = compareOptionalStrings(first.role, second.role);
  if (compared !== 0) return compared;
  const firstSource = first.source;
  const secondSource = second.source;
  if (firstSource === undefined) return secondSource === undefined ? 0 : -1;
  if (secondSource === undefined) return 1;
  compared = compareStrings(firstSource.sketch, secondSource.sketch);
  return compared !== 0
    ? compared
    : compareStrings(firstSource.entity, secondSource.entity);
}

function validateLineageRole(
  role: string | undefined,
  relation: KernelTopologyLineage["relation"],
  hasSource: boolean,
  label: string,
): asserts role is TopologyRole | undefined {
  if (role === undefined) return;
  const rule = TOPOLOGY_ROLE_RULES[role as TopologyRole] as
    | (typeof TOPOLOGY_ROLE_RULES)[TopologyRole]
    | undefined;
  if (
    rule === undefined ||
    rule.relation !== relation ||
    (hasSource && rule.source !== "sketch-curve")
  ) {
    throw new TypeError(`${label}.role is malformed`);
  }
}

function copyLineage(
  value: unknown,
  label: string,
  budget: PreparationBudget,
): KernelTopologyLineage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is malformed`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const feature = record.feature;
  const relation = record.relation;
  const role = record.role;
  const rawSource = record.source;
  if (
    typeof feature !== "string" ||
    feature.length === 0 ||
    (relation !== "created" && relation !== "modified") ||
    (role !== undefined && (typeof role !== "string" || role.length === 0))
  ) {
    throw new TypeError(`${label} is malformed`);
  }
  const typedRole = role as string | undefined;
  chargePreparationString(feature, budget);
  if (typedRole !== undefined) chargePreparationString(typedRole, budget);
  let source: KernelTopologyLineage["source"];
  if (rawSource !== undefined) {
    if (
      typeof rawSource !== "object" ||
      rawSource === null ||
      Array.isArray(rawSource)
    ) {
      throw new TypeError(`${label}.source is malformed`);
    }
    const sourceRecord = rawSource as Readonly<Record<string, unknown>>;
    const kind = sourceRecord.kind;
    const sketch = sourceRecord.sketch;
    const entity = sourceRecord.entity;
    if (
      relation !== "created" ||
      kind !== "sketch-entity" ||
      typeof sketch !== "string" ||
      sketch.length === 0 ||
      typeof entity !== "string" ||
      entity.length === 0
    ) {
      throw new TypeError(`${label}.source is malformed`);
    }
    chargePreparationString(sketch, budget);
    chargePreparationString(entity, budget);
    source = Object.freeze({
      kind: "sketch-entity" as const,
      sketch,
      entity,
    });
  }
  validateLineageRole(typedRole, relation, source !== undefined, label);
  return Object.freeze({
    feature,
    relation,
    ...(typedRole === undefined ? {} : { role: typedRole }),
    ...(source === undefined ? {} : { source }),
  }) as KernelTopologyLineage;
}

function normalizeLineageArray(
  value: unknown,
  label: string,
  budget: PreparationBudget,
  signal?: AbortSignal,
  capturedLength?: number,
): readonly KernelTopologyLineage[] {
  if (!Array.isArray(value)) {
    throw new RangeError(`${label} is malformed or oversized`);
  }
  const length = capturedLength ?? value.length;
  budget.lineageRecords = checkedAdd(
    budget.lineageRecords,
    length,
    "Shape-artifact preparation lineage",
  );
  assertBudget(
    budget.lineageRecords,
    MAX_LINEAGE_RECORDS,
    "Shape-artifact preparation lineage",
  );
  const copied = new Array<KernelTopologyLineage>(length);
  for (let index = 0; index < length; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${label} must not be sparse`);
    }
    const item = value[index];
    copied[index] = copyLineage(item, `${label}[${index}]`, budget);
  }
  copied.sort(compareLineage);
  const unique: KernelTopologyLineage[] = [];
  for (let index = 0; index < copied.length; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    const item = copied[index]!;
    if (
      unique.length === 0 ||
      compareLineage(unique[unique.length - 1]!, item) !== 0
    ) {
      unique.push(item);
    }
  }
  return Object.freeze(unique);
}

function captureArray(
  value: unknown,
  expectedLength: number | undefined,
  label: string,
): CapturedArray {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const length = value.length;
  if (
    length > MAX_NATIVE_ORIENTATIONS ||
    (expectedLength !== undefined && length !== expectedLength)
  ) {
    throw new RangeError(`${label} has an invalid or oversized length`);
  }
  return { value, length };
}

function topologyIndex(
  keys: readonly KernelTopologyKey[],
  label: string,
): ReadonlyMap<KernelTopologyKey, number> {
  const result = new Map<KernelTopologyKey, number>();
  keys.forEach((key, index) => {
    if (result.has(key)) throw new TypeError(`${label} contains duplicate keys`);
    result.set(key, index);
  });
  return result;
}

function sortedIndices(
  keys: readonly KernelTopologyKey[],
  indices: ReadonlyMap<KernelTopologyKey, number>,
  label: string,
  signal?: AbortSignal,
): readonly number[] {
  const output = new Array<number>(keys.length);
  for (let item = 0; item < keys.length; item += 1) {
    if ((item & 0xff) === 0) checkAbort(signal);
    const key = keys[item]!;
    const index = indices.get(key);
    if (index === undefined) {
      throw new TypeError(`${label} references topology outside its snapshot`);
    }
    output[item] = index;
  }
  output.sort((first, second) => first - second);
  for (let index = 1; index < output.length; index += 1) {
    if (output[index - 1] === output[index]) {
      throw new TypeError(`${label} contains duplicate topology references`);
    }
  }
  return Object.freeze(output);
}

function copyOrientationArray(
  captured: CapturedArray,
  label: string,
  signal: AbortSignal | undefined,
): readonly ShapeOrientation[] {
  const output = new Array<ShapeOrientation>(captured.length);
  for (let index = 0; index < captured.length; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    if (!Object.hasOwn(captured.value, index)) {
      throw new TypeError(`${label} must not be sparse`);
    }
    const orientation = captured.value[index];
    if (!SHAPE_ORIENTATIONS.includes(orientation as ShapeOrientation)) {
      throw new TypeError(`${label}[${index}] is malformed`);
    }
    output[index] = orientation as ShapeOrientation;
  }
  return Object.freeze(output);
}

function copyNativeStructure(
  value: unknown,
  counts: { readonly faces: number; readonly edges: number; readonly vertices: number },
  signal: AbortSignal | undefined,
): OcctShapeArtifactNativeStructure {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Shape-artifact native structure is malformed");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const rootType = record.rootType;
  const rootOrientation = record.rootOrientation;
  const solid = captureArray(
    record.solidOrientations,
    undefined,
    "Shape-artifact solid orientations",
  );
  const shell = captureArray(
    record.shellOrientations,
    undefined,
    "Shape-artifact shell orientations",
  );
  const wire = captureArray(
    record.wireOrientations,
    undefined,
    "Shape-artifact wire orientations",
  );
  const face = captureArray(
    record.faceOrientations,
    counts.faces,
    "Shape-artifact face orientations",
  );
  const edge = captureArray(
    record.edgeOrientations,
    counts.edges,
    "Shape-artifact edge orientations",
  );
  const vertex = captureArray(
    record.vertexOrientations,
    counts.vertices,
    "Shape-artifact vertex orientations",
  );
  const orientationCount = [solid, shell, wire, face, edge, vertex].reduce(
    (total, item) =>
      checkedAdd(total, item.length, "Shape-artifact native orientations"),
    0,
  );
  assertBudget(
    orientationCount,
    MAX_NATIVE_ORIENTATIONS,
    "Shape-artifact native orientation",
  );
  if (!SHAPE_TYPES.includes(rootType as ShapeType)) {
    throw new TypeError("Shape-artifact native root type is malformed");
  }
  if (!SHAPE_ORIENTATIONS.includes(rootOrientation as ShapeOrientation)) {
    throw new TypeError("Shape-artifact native root orientation is malformed");
  }
  return Object.freeze({
    rootType: rootType as ShapeType,
    rootOrientation: rootOrientation as ShapeOrientation,
    solidOrientations: copyOrientationArray(
      solid,
      "Shape-artifact solid orientations",
      signal,
    ),
    shellOrientations: copyOrientationArray(
      shell,
      "Shape-artifact shell orientations",
      signal,
    ),
    wireOrientations: copyOrientationArray(
      wire,
      "Shape-artifact wire orientations",
      signal,
    ),
    faceOrientations: copyOrientationArray(
      face,
      "Shape-artifact face orientations",
      signal,
    ),
    edgeOrientations: copyOrientationArray(
      edge,
      "Shape-artifact edge orientations",
      signal,
    ),
    vertexOrientations: copyOrientationArray(
      vertex,
      "Shape-artifact vertex orientations",
      signal,
    ),
  });
}

function chargeLineageStrings(
  values: readonly KernelTopologyLineage[],
  current: number,
): number {
  let total = current;
  for (const value of values) {
    total = checkedAdd(total, stringByteLength(value.feature), "Shape-artifact strings");
    if (value.role !== undefined) {
      total = checkedAdd(total, stringByteLength(value.role), "Shape-artifact strings");
    }
    if (value.source !== undefined) {
      total = checkedAdd(
        total,
        stringByteLength(value.source.sketch),
        "Shape-artifact strings",
      );
      total = checkedAdd(
        total,
        stringByteLength(value.source.entity),
        "Shape-artifact strings",
      );
    }
    assertBudget(total, MAX_STRING_BYTES, "Shape-artifact string");
  }
  return total;
}

function prepareSidecar(
  state: OcctShapeArtifactCapturedSidecarState,
  maximum: number,
  signal: AbortSignal | undefined,
): PreparedSidecar {
  if (typeof state !== "object" || state === null) {
    throw new TypeError("Shape-artifact sidecar state is malformed");
  }
  const history = state.history;
  const rawTopology = state.topology;
  const rawLineage = state.lineage;
  const rawNativeStructure = state.nativeStructure;
  const volumeOverride = state.volumeOverride;
  if (!HISTORIES.includes(history)) {
    throw new TypeError("Shape-artifact base history is malformed");
  }
  if (
    volumeOverride !== undefined &&
    (!Number.isFinite(volumeOverride) || volumeOverride < 0)
  ) {
    throw new TypeError("Shape-artifact volume override is malformed");
  }
  if (!Array.isArray(rawLineage)) {
    throw new TypeError("Shape-artifact lineage must be an array");
  }
  const globalLineageLength = rawLineage.length;
  assertBudget(
    globalLineageLength,
    MAX_LINEAGE_RECORDS,
    "Shape-artifact preparation lineage",
  );
  checkAbort(signal);
  const topology = detachKernelTopologySnapshot(rawTopology, {
    maxTopologyItems: MAX_TOPOLOGY_ITEMS,
    maxAdjacencyLinks: MAX_ADJACENCY_LINKS,
    maxEvidenceRecords: MAX_LINEAGE_RECORDS - globalLineageLength,
    maxStringBytes: MAX_PREPARATION_STRING_WORK_BYTES,
  });
  let conservativeMinimum =
    OCCT_ARTIFACT_SIDECAR_V2_MIN_BYTES +
    (volumeOverride === undefined ? 0 : 8);
  conservativeMinimum = checkedAdd(
    conservativeMinimum,
    checkedMultiply(topology.faces.length, 96, "Shape-artifact faces"),
    "Shape-artifact sidecar minimum",
  );
  conservativeMinimum = checkedAdd(
    conservativeMinimum,
    checkedMultiply(topology.edges.length, 100, "Shape-artifact edges"),
    "Shape-artifact sidecar minimum",
  );
  conservativeMinimum = checkedAdd(
    conservativeMinimum,
    checkedMultiply(topology.vertices.length, 33, "Shape-artifact vertices"),
    "Shape-artifact sidecar minimum",
  );
  let rawLineageRecords = globalLineageLength;
  let nonEmptyLineageArrays = globalLineageLength === 0 ? 0 : 1;
  for (const descriptors of [
    topology.faces,
    topology.edges,
    topology.vertices,
  ]) {
    for (const descriptor of descriptors) {
      rawLineageRecords = checkedAdd(
        rawLineageRecords,
        descriptor.lineage.length,
        "Shape-artifact preparation lineage",
      );
      if (descriptor.lineage.length !== 0) nonEmptyLineageArrays += 1;
    }
  }
  conservativeMinimum = checkedAdd(
    conservativeMinimum,
    checkedMultiply(
      nonEmptyLineageArrays,
      8,
      "Shape-artifact non-empty lineage arrays",
    ),
    "Shape-artifact sidecar minimum",
  );
  if (conservativeMinimum > maximum) {
    throwOcctArtifactLimitRefusal(
      maximum,
      conservativeMinimum,
      "Shape-artifact sidecar exceeds maxBytes",
    );
  }
  assertBudget(
    rawLineageRecords,
    MAX_LINEAGE_RECORDS,
    "Shape-artifact preparation lineage",
  );
  const preparationBudget: PreparationBudget = {
    lineageRecords: 0,
    stringBytes: 0,
  };
  const lineage = normalizeLineageArray(
    rawLineage,
    "Shape-artifact lineage",
    preparationBudget,
    signal,
    globalLineageLength,
  );
  const faceIndices = topologyIndex(
    topology.faces.map(({ key }) => key),
    "Shape-artifact faces",
  );
  const edgeIndices = topologyIndex(
    topology.edges.map(({ key }) => key),
    "Shape-artifact edges",
  );
  const vertexIndices = topologyIndex(
    topology.vertices.map(({ key }) => key),
    "Shape-artifact vertices",
  );
  let adjacencyLinks = 0;
  let lineageRecords = lineage.length;
  let stringBytes = chargeLineageStrings(lineage, 0);
  const faces = topology.faces.map((value, index): PreparedFace => {
    if ((index & 0xff) === 0) checkAbort(signal);
    const itemLineage = normalizeLineageArray(
      value.lineage,
      `Shape-artifact topology.faces[${index}].lineage`,
      preparationBudget,
      signal,
    );
    const edges = sortedIndices(
      value.edges,
      edgeIndices,
      `Shape-artifact topology.faces[${index}].edges`,
      signal,
    );
    adjacencyLinks = checkedAdd(adjacencyLinks, edges.length, "Shape-artifact adjacency");
    lineageRecords = checkedAdd(lineageRecords, itemLineage.length, "Shape-artifact lineage");
    stringBytes = chargeLineageStrings(itemLineage, stringBytes);
    stringBytes = checkedAdd(
      stringBytes,
      stringByteLength(value.surface.kind),
      "Shape-artifact strings",
    );
    assertBudget(adjacencyLinks, MAX_ADJACENCY_LINKS, "Shape-artifact adjacency");
    assertBudget(lineageRecords, MAX_LINEAGE_RECORDS, "Shape-artifact lineage");
    assertBudget(stringBytes, MAX_STRING_BYTES, "Shape-artifact string");
    return Object.freeze({ value, lineage: itemLineage, edges });
  });
  const edges = topology.edges.map((value, index): PreparedEdge => {
    if ((index & 0xff) === 0) checkAbort(signal);
    const itemLineage = normalizeLineageArray(
      value.lineage,
      `Shape-artifact topology.edges[${index}].lineage`,
      preparationBudget,
      signal,
    );
    const facesForEdge = sortedIndices(
      value.faces,
      faceIndices,
      `Shape-artifact topology.edges[${index}].faces`,
      signal,
    );
    const vertices = sortedIndices(
      value.vertices,
      vertexIndices,
      `Shape-artifact topology.edges[${index}].vertices`,
      signal,
    );
    adjacencyLinks = checkedAdd(
      adjacencyLinks,
      facesForEdge.length + vertices.length,
      "Shape-artifact adjacency",
    );
    lineageRecords = checkedAdd(lineageRecords, itemLineage.length, "Shape-artifact lineage");
    stringBytes = chargeLineageStrings(itemLineage, stringBytes);
    stringBytes = checkedAdd(
      stringBytes,
      stringByteLength(value.curve.kind),
      "Shape-artifact strings",
    );
    assertBudget(adjacencyLinks, MAX_ADJACENCY_LINKS, "Shape-artifact adjacency");
    assertBudget(lineageRecords, MAX_LINEAGE_RECORDS, "Shape-artifact lineage");
    assertBudget(stringBytes, MAX_STRING_BYTES, "Shape-artifact string");
    return Object.freeze({
      value,
      lineage: itemLineage,
      faces: facesForEdge,
      vertices,
    });
  });
  const vertices = topology.vertices.map((value, index): PreparedVertex => {
    if ((index & 0xff) === 0) checkAbort(signal);
    const itemLineage = normalizeLineageArray(
      value.lineage,
      `Shape-artifact topology.vertices[${index}].lineage`,
      preparationBudget,
      signal,
    );
    const vertexEdges = sortedIndices(
      value.edges,
      edgeIndices,
      `Shape-artifact topology.vertices[${index}].edges`,
      signal,
    );
    adjacencyLinks = checkedAdd(
      adjacencyLinks,
      vertexEdges.length,
      "Shape-artifact adjacency",
    );
    lineageRecords = checkedAdd(lineageRecords, itemLineage.length, "Shape-artifact lineage");
    stringBytes = chargeLineageStrings(itemLineage, stringBytes);
    assertBudget(adjacencyLinks, MAX_ADJACENCY_LINKS, "Shape-artifact adjacency");
    assertBudget(lineageRecords, MAX_LINEAGE_RECORDS, "Shape-artifact lineage");
    return Object.freeze({ value, lineage: itemLineage, edges: vertexEdges });
  });
  const nativeStructure = copyNativeStructure(rawNativeStructure, {
    faces: faces.length,
    edges: edges.length,
    vertices: vertices.length,
  }, signal);
  const nativeOrientations = [
    nativeStructure.solidOrientations,
    nativeStructure.shellOrientations,
    nativeStructure.wireOrientations,
    nativeStructure.faceOrientations,
    nativeStructure.edgeOrientations,
    nativeStructure.vertexOrientations,
  ].reduce(
    (total, values) =>
      checkedAdd(total, values.length, "Shape-artifact native orientations"),
    0,
  );
  assertBudget(
    nativeOrientations,
    MAX_NATIVE_ORIENTATIONS,
    "Shape-artifact native orientation",
  );
  checkAbort(signal);
  return Object.freeze({
    history,
    topologyHistory: topology.history,
    ...(volumeOverride === undefined ? {} : { volumeOverride }),
    nativeStructure,
    lineage,
    faces: Object.freeze(faces),
    edges: Object.freeze(edges),
    vertices: Object.freeze(vertices),
    adjacencyLinks,
    lineageRecords,
    stringBytes,
    nativeOrientations,
  });
}

abstract class SidecarWriter {
  offset = 0;

  constructor(
    readonly signal: AbortSignal | undefined,
    private readonly maximum = MAX_UINT32,
  ) {}

  protected abstract storeUint8(value: number): void;
  protected abstract storeUint16(value: number): void;
  protected abstract storeUint32(value: number): void;
  protected abstract storeFloat64(value: number): void;
  protected abstract storeStringPayload(value: string): void;

  private advance(bytes: number): void {
    const next = checkedAdd(this.offset, bytes, "Shape-artifact sidecar");
    if (next > this.maximum) {
      throwOcctArtifactLimitRefusal(
        this.maximum,
        next,
        "Shape-artifact sidecar exceeds maxBytes",
      );
    }
    this.offset = next;
  }

  uint8(value: number): void {
    this.storeUint8(value);
    this.advance(1);
  }

  uint16(value: number): void {
    this.storeUint16(value);
    this.advance(2);
  }

  uint32(value: number): void {
    this.storeUint32(value);
    this.advance(4);
  }

  float64(value: number, label: string): void {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    this.storeFloat64(Object.is(value, -0) ? 0 : value);
    this.advance(8);
  }

  bytes(value: Uint8Array): void {
    for (const byte of value) this.uint8(byte);
  }

  string(value: string, label: string): void {
    if (value.length === 0) throw new TypeError(`${label} must be non-empty`);
    const byteLength = stringByteLength(value);
    this.uint32(byteLength);
    this.storeStringPayload(value);
    this.advance(byteLength);
  }
}

class CountingWriter extends SidecarWriter {
  protected storeUint8(_value: number): void {}
  protected storeUint16(_value: number): void {}
  protected storeUint32(_value: number): void {}
  protected storeFloat64(_value: number): void {}
  protected storeStringPayload(_value: string): void {}
}

class BufferWriter extends SidecarWriter {
  readonly bytesValue: Uint8Array;
  private readonly view: DataView;

  constructor(length: number, signal: AbortSignal | undefined) {
    super(signal, length);
    this.bytesValue = new Uint8Array(length);
    this.view = new DataView(this.bytesValue.buffer);
  }

  protected storeUint8(value: number): void {
    this.view.setUint8(this.offset, value);
  }

  protected storeUint16(value: number): void {
    this.view.setUint16(this.offset, value, false);
  }

  protected storeUint32(value: number): void {
    this.view.setUint32(this.offset, value, false);
  }

  protected storeFloat64(value: number): void {
    this.view.setFloat64(this.offset, value, false);
  }

  protected storeStringPayload(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      if ((index & 0xfff) === 0) checkAbort(this.signal);
      this.view.setUint16(
        this.offset + index * 2,
        value.charCodeAt(index),
        false,
      );
    }
  }
}

function enumTag<T extends string>(
  value: T,
  values: readonly T[],
  label: string,
): number {
  const index = values.indexOf(value);
  if (index < 0) throw new TypeError(`${label} is malformed`);
  return index + 1;
}

function writeVector(
  writer: SidecarWriter,
  value: readonly number[],
  label: string,
): void {
  if (value.length !== 3) throw new TypeError(`${label} must contain three values`);
  writer.float64(value[0]!, `${label}[0]`);
  writer.float64(value[1]!, `${label}[1]`);
  writer.float64(value[2]!, `${label}[2]`);
}

function writeLineage(
  writer: SidecarWriter,
  value: KernelTopologyLineage,
): void {
  writer.uint8(enumTag(value.relation, RELATIONS, "Shape-artifact lineage relation"));
  writer.uint8((value.role === undefined ? 0 : 1) | (value.source === undefined ? 0 : 2));
  writer.string(value.feature, "Shape-artifact lineage feature");
  if (value.role !== undefined) writer.string(value.role, "Shape-artifact lineage role");
  if (value.source !== undefined) {
    writer.string(value.source.sketch, "Shape-artifact lineage source sketch");
    writer.string(value.source.entity, "Shape-artifact lineage source entity");
  }
}

function writeLineageArray(
  writer: SidecarWriter,
  values: readonly KernelTopologyLineage[],
  signal: AbortSignal | undefined,
): void {
  writer.uint32(values.length);
  values.forEach((value, index) => {
    if ((index & 0xff) === 0) checkAbort(signal);
    writeLineage(writer, value);
  });
}

function writeIndexArray(writer: SidecarWriter, values: readonly number[]): void {
  writer.uint32(values.length);
  for (let index = 0; index < values.length; index += 1) {
    if ((index & 0xff) === 0) checkAbort(writer.signal);
    writer.uint32(values[index]!);
  }
}

function descriptorMask(
  first: readonly number[] | undefined,
  second: readonly number[] | undefined,
  radius: number | undefined,
): number {
  return (first === undefined ? 0 : 1) |
    (second === undefined ? 0 : 2) |
    (radius === undefined ? 0 : 4);
}

function writeSurface(
  writer: SidecarWriter,
  surface: KernelSurfaceDescriptor,
): void {
  writer.uint8(descriptorMask(surface.normal, surface.axis, surface.radius));
  writer.string(surface.kind, "Shape-artifact surface kind");
  if (surface.normal !== undefined) writeVector(writer, surface.normal, "surface.normal");
  if (surface.axis !== undefined) writeVector(writer, surface.axis, "surface.axis");
  if (surface.radius !== undefined) writer.float64(surface.radius, "surface.radius");
}

function writeCurve(writer: SidecarWriter, curve: KernelCurveDescriptor): void {
  writer.uint8(descriptorMask(curve.direction, curve.axis, curve.radius));
  writer.string(curve.kind, "Shape-artifact curve kind");
  if (curve.direction !== undefined) writeVector(writer, curve.direction, "curve.direction");
  if (curve.axis !== undefined) writeVector(writer, curve.axis, "curve.axis");
  if (curve.radius !== undefined) writer.float64(curve.radius, "curve.radius");
}

function writeOrientations(
  writer: SidecarWriter,
  values: readonly ShapeOrientation[],
): void {
  for (let index = 0; index < values.length; index += 1) {
    if ((index & 0xff) === 0) checkAbort(writer.signal);
    writer.uint8(
      enumTag(
        values[index]!,
        SHAPE_ORIENTATIONS,
        "Shape-artifact orientation",
      ),
    );
  }
}

function writePreparedSidecar(
  writer: SidecarWriter,
  prepared: PreparedSidecar,
  totalBytes: number,
  signal: AbortSignal | undefined,
): void {
  writer.bytes(MAGIC);
  writer.uint16(VERSION);
  writer.uint16(0);
  writer.uint32(totalBytes);
  writer.uint32(prepared.faces.length);
  writer.uint32(prepared.edges.length);
  writer.uint32(prepared.vertices.length);
  writer.uint32(prepared.adjacencyLinks);
  writer.uint32(prepared.lineageRecords);
  writer.uint32(prepared.stringBytes);
  writer.uint32(prepared.nativeOrientations);
  writer.uint8(enumTag(prepared.history, HISTORIES, "Shape-artifact base history"));
  writer.uint8(
    enumTag(prepared.topologyHistory, HISTORIES, "Shape-artifact topology history"),
  );
  writer.uint8(prepared.volumeOverride === undefined ? 0 : 1);
  writer.uint8(0);
  if (prepared.volumeOverride !== undefined) {
    writer.float64(prepared.volumeOverride, "Shape-artifact volume override");
  }
  const native = prepared.nativeStructure;
  writer.uint8(enumTag(native.rootType, SHAPE_TYPES, "Shape-artifact root type"));
  writer.uint8(
    enumTag(native.rootOrientation, SHAPE_ORIENTATIONS, "Shape-artifact root orientation"),
  );
  writer.uint32(native.solidOrientations.length);
  writer.uint32(native.shellOrientations.length);
  writer.uint32(native.wireOrientations.length);
  writeOrientations(writer, native.solidOrientations);
  writeOrientations(writer, native.shellOrientations);
  writeOrientations(writer, native.wireOrientations);
  writeOrientations(writer, native.faceOrientations);
  writeOrientations(writer, native.edgeOrientations);
  writeOrientations(writer, native.vertexOrientations);
  writeLineageArray(writer, prepared.lineage, signal);
  prepared.faces.forEach((face, index) => {
    if ((index & 0xff) === 0) checkAbort(signal);
    writer.float64(face.value.area, `topology.faces[${index}].area`);
    writeVector(writer, face.value.center, `topology.faces[${index}].center`);
    writeVector(writer, face.value.bounds.min, `topology.faces[${index}].bounds.min`);
    writeVector(writer, face.value.bounds.max, `topology.faces[${index}].bounds.max`);
    writeSurface(writer, face.value.surface);
    writeLineageArray(writer, face.lineage, signal);
    writeIndexArray(writer, face.edges);
  });
  prepared.edges.forEach((edge, index) => {
    if ((index & 0xff) === 0) checkAbort(signal);
    writer.float64(edge.value.length, `topology.edges[${index}].length`);
    writeVector(writer, edge.value.center, `topology.edges[${index}].center`);
    writeVector(writer, edge.value.bounds.min, `topology.edges[${index}].bounds.min`);
    writeVector(writer, edge.value.bounds.max, `topology.edges[${index}].bounds.max`);
    writeCurve(writer, edge.value.curve);
    writeLineageArray(writer, edge.lineage, signal);
    writeIndexArray(writer, edge.faces);
    writeIndexArray(writer, edge.vertices);
  });
  prepared.vertices.forEach((vertex, index) => {
    if ((index & 0xff) === 0) checkAbort(signal);
    writeVector(writer, vertex.value.point, `topology.vertices[${index}].point`);
    writeLineageArray(writer, vertex.lineage, signal);
    writeIndexArray(writer, vertex.edges);
  });
}

export function encodeOcctArtifactSidecarV2(
  state: OcctShapeArtifactCapturedSidecarState,
  options: OcctArtifactSidecarV2EncodeOptions,
): Uint8Array {
  const signal = options.signal;
  const maximum = options.maxBytes;
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    throw new RangeError("Shape-artifact sidecar maxBytes must be a positive safe integer");
  }
  const effectiveMaximum = Math.min(maximum, OCCT_ARTIFACT_SIDECAR_V2_MAX_BYTES);
  checkAbort(signal);
  if (effectiveMaximum < OCCT_ARTIFACT_SIDECAR_V2_MIN_BYTES) {
    throwOcctArtifactLimitRefusal(
      effectiveMaximum,
      OCCT_ARTIFACT_SIDECAR_V2_MIN_BYTES,
      "Shape-artifact sidecar exceeds maxBytes",
    );
  }
  const prepared = prepareSidecar(state, effectiveMaximum, signal);
  const counter = new CountingWriter(signal, effectiveMaximum);
  writePreparedSidecar(counter, prepared, 0, signal);
  const totalBytes = counter.offset;
  if (totalBytes > effectiveMaximum) {
    throwOcctArtifactLimitRefusal(
      effectiveMaximum,
      totalBytes,
      "Shape-artifact sidecar exceeds maxBytes",
    );
  }
  checkAbort(signal);
  const writer = new BufferWriter(totalBytes, signal);
  writePreparedSidecar(writer, prepared, totalBytes, signal);
  if (writer.offset !== totalBytes) {
    throw new Error("Shape-artifact sidecar counting and writing passes diverged");
  }
  checkAbort(signal);
  return writer.bytesValue;
}

class SidecarReader {
  offset: number;
  stringBytes = 0;
  lineageRecords = 0;
  adjacencyLinks = 0;
  nativeOrientations = 0;
  private readonly view: DataView;

  constructor(
    readonly bytes: Uint8Array,
    offset: number,
    readonly header: SidecarHeader,
    readonly signal: AbortSignal | undefined,
  ) {
    this.offset = offset;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private require(bytes: number, label: string): void {
    if (bytes > this.bytes.byteLength - this.offset) {
      throw new TypeError(`${label} is truncated`);
    }
  }

  ensureRemaining(bytes: number, label: string): void {
    this.require(bytes, label);
  }

  uint8(label: string): number {
    this.require(1, label);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  uint32(label: string): number {
    this.require(4, label);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  float64(label: string): number {
    this.require(8, label);
    const value = this.view.getFloat64(this.offset, false);
    this.offset += 8;
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    if (Object.is(value, -0)) {
      throw new TypeError(`${label} uses a non-canonical signed-zero encoding`);
    }
    return value;
  }

  string(label: string): string {
    const byteLength = this.uint32(`${label} length`);
    if (byteLength === 0 || (byteLength & 1) !== 0) {
      throw new TypeError(`${label} has an invalid UTF-16BE byte length`);
    }
    const nextStringBytes = checkedAdd(
      this.stringBytes,
      byteLength,
      "Shape-artifact strings",
    );
    if (
      nextStringBytes > this.header.stringBytes ||
      nextStringBytes > MAX_STRING_BYTES
    ) {
      throw new RangeError("Shape-artifact string budget was exceeded");
    }
    this.require(byteLength, label);
    const chunks: string[] = [];
    const end = this.offset + byteLength;
    while (this.offset < end) {
      checkAbort(this.signal);
      const chunkUnits = Math.min((end - this.offset) / 2, 4_096);
      const units = new Array<number>(chunkUnits);
      for (let index = 0; index < chunkUnits; index += 1) {
        units[index] = this.view.getUint16(this.offset, false);
        this.offset += 2;
      }
      chunks.push(String.fromCharCode(...units));
    }
    this.stringBytes = nextStringBytes;
    return chunks.join("");
  }

  chargeLineage(count: number): void {
    this.lineageRecords = checkedAdd(
      this.lineageRecords,
      count,
      "Shape-artifact lineage",
    );
    if (
      this.lineageRecords > this.header.lineageRecords ||
      this.lineageRecords > MAX_LINEAGE_RECORDS
    ) {
      throw new RangeError("Shape-artifact lineage budget was exceeded");
    }
  }

  chargeAdjacency(count: number): void {
    this.adjacencyLinks = checkedAdd(
      this.adjacencyLinks,
      count,
      "Shape-artifact adjacency",
    );
    if (
      this.adjacencyLinks > this.header.adjacencyLinks ||
      this.adjacencyLinks > MAX_ADJACENCY_LINKS
    ) {
      throw new RangeError("Shape-artifact adjacency budget was exceeded");
    }
  }

  chargeOrientations(count: number): void {
    this.nativeOrientations = checkedAdd(
      this.nativeOrientations,
      count,
      "Shape-artifact native orientations",
    );
    if (
      this.nativeOrientations > this.header.nativeOrientations ||
      this.nativeOrientations > MAX_NATIVE_ORIENTATIONS
    ) {
      throw new RangeError("Shape-artifact native orientation budget was exceeded");
    }
  }
}

function decodeEnum<T extends string>(
  tag: number,
  values: readonly T[],
  label: string,
): T {
  const value = values[tag - 1];
  if (value === undefined) throw new TypeError(`${label} is unsupported`);
  return value;
}

function readVector(reader: SidecarReader, label: string): [number, number, number] {
  return [
    reader.float64(`${label}[0]`),
    reader.float64(`${label}[1]`),
    reader.float64(`${label}[2]`),
  ];
}

function nonZeroVector(value: readonly number[], label: string): void {
  if (!value.some((component) => component !== 0)) {
    throw new TypeError(`${label} must be non-zero`);
  }
}

function readLineage(reader: SidecarReader, label: string): KernelTopologyLineage {
  const relation = decodeEnum(
    reader.uint8(`${label}.relation`),
    RELATIONS,
    `${label}.relation`,
  );
  const mask = reader.uint8(`${label}.mask`);
  if ((mask & ~0x03) !== 0) throw new TypeError(`${label}.mask is unsupported`);
  const feature = reader.string(`${label}.feature`);
  const role = (mask & 1) === 0 ? undefined : reader.string(`${label}.role`);
  let source: KernelTopologyLineage["source"];
  if ((mask & 2) !== 0) {
    if (relation !== "created") throw new TypeError(`${label}.source is malformed`);
    source = Object.freeze({
      kind: "sketch-entity" as const,
      sketch: reader.string(`${label}.source.sketch`),
      entity: reader.string(`${label}.source.entity`),
    });
  }
  validateLineageRole(role, relation, source !== undefined, label);
  return Object.freeze({
    feature,
    relation,
    ...(role === undefined ? {} : { role }),
    ...(source === undefined ? {} : { source }),
  }) as KernelTopologyLineage;
}

function readLineageArray(
  reader: SidecarReader,
  label: string,
): readonly KernelTopologyLineage[] {
  const count = reader.uint32(`${label} count`);
  reader.chargeLineage(count);
  reader.ensureRemaining(
    checkedMultiply(count, 8, `${label} minimum`),
    `${label} records`,
  );
  const values = new Array<KernelTopologyLineage>(count);
  for (let index = 0; index < count; index += 1) {
    if ((index & 0xff) === 0) checkAbort(reader.signal);
    const value = readLineage(reader, `${label}[${index}]`);
    if (index > 0 && compareLineage(values[index - 1]!, value) >= 0) {
      throw new TypeError(`${label} is not in canonical unique order`);
    }
    values[index] = value;
  }
  return Object.freeze(values);
}

function readIndexArray(
  reader: SidecarReader,
  targetCount: number,
  label: string,
): readonly number[] {
  const count = reader.uint32(`${label} count`);
  if (count > targetCount) throw new RangeError(`${label} has too many entries`);
  reader.chargeAdjacency(count);
  reader.ensureRemaining(
    checkedMultiply(count, 4, `${label} entries`),
    `${label} entries`,
  );
  const values = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    if ((index & 0xff) === 0) checkAbort(reader.signal);
    const value = reader.uint32(`${label}[${index}]`);
    if (value >= targetCount) {
      throw new TypeError(`${label}[${index}] is outside its topology table`);
    }
    if (index > 0 && values[index - 1]! >= value) {
      throw new TypeError(`${label} is not in canonical unique order`);
    }
    values[index] = value;
  }
  return Object.freeze(values);
}

function readSurface(reader: SidecarReader, label: string): KernelSurfaceDescriptor {
  const mask = reader.uint8(`${label}.mask`);
  if ((mask & ~0x07) !== 0) throw new TypeError(`${label}.mask is unsupported`);
  const kind = reader.string(`${label}.kind`);
  const normal = (mask & 1) === 0 ? undefined : readVector(reader, `${label}.normal`);
  const axis = (mask & 2) === 0 ? undefined : readVector(reader, `${label}.axis`);
  const radius = (mask & 4) === 0 ? undefined : reader.float64(`${label}.radius`);
  if (normal !== undefined) nonZeroVector(normal, `${label}.normal`);
  if (axis !== undefined) nonZeroVector(axis, `${label}.axis`);
  if (radius !== undefined && radius < 0) throw new TypeError(`${label}.radius is negative`);
  return Object.freeze({
    kind,
    ...(normal === undefined ? {} : { normal }),
    ...(axis === undefined ? {} : { axis }),
    ...(radius === undefined ? {} : { radius }),
  });
}

function readCurve(reader: SidecarReader, label: string): KernelCurveDescriptor {
  const mask = reader.uint8(`${label}.mask`);
  if ((mask & ~0x07) !== 0) throw new TypeError(`${label}.mask is unsupported`);
  const kind = reader.string(`${label}.kind`);
  const direction = (mask & 1) === 0
    ? undefined
    : readVector(reader, `${label}.direction`);
  const axis = (mask & 2) === 0 ? undefined : readVector(reader, `${label}.axis`);
  const radius = (mask & 4) === 0 ? undefined : reader.float64(`${label}.radius`);
  if (direction !== undefined) nonZeroVector(direction, `${label}.direction`);
  if (axis !== undefined) nonZeroVector(axis, `${label}.axis`);
  if (radius !== undefined && radius < 0) throw new TypeError(`${label}.radius is negative`);
  return Object.freeze({
    kind,
    ...(direction === undefined ? {} : { direction }),
    ...(axis === undefined ? {} : { axis }),
    ...(radius === undefined ? {} : { radius }),
  });
}

function localKey(
  topology: "face" | "edge" | "vertex",
  index: number,
): KernelTopologyKey {
  return `artifact:${topology}:${index}` as KernelTopologyKey;
}

function readOrientations(
  reader: SidecarReader,
  count: number,
  label: string,
): readonly ShapeOrientation[] {
  reader.chargeOrientations(count);
  reader.ensureRemaining(count, label);
  const values = new Array<ShapeOrientation>(count);
  for (let index = 0; index < count; index += 1) {
    if ((index & 0xff) === 0) checkAbort(reader.signal);
    values[index] = decodeEnum(
      reader.uint8(`${label}[${index}]`),
      SHAPE_ORIENTATIONS,
      `${label}[${index}]`,
    );
  }
  return Object.freeze(values);
}

function readHeader(bytes: Uint8Array): SidecarHeader {
  if (
    bytes.byteLength < OCCT_ARTIFACT_SIDECAR_V2_HEADER_BYTES ||
    bytes.byteLength > OCCT_ARTIFACT_SIDECAR_V2_MAX_BYTES
  ) {
    throw new RangeError("Shape-artifact sidecar is truncated or oversized");
  }
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (bytes[index] !== MAGIC[index]) {
      throw new TypeError("Shape-artifact sidecar magic is invalid");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint16(8, false) !== VERSION ||
    view.getUint16(10, false) !== 0 ||
    view.getUint32(12, false) !== bytes.byteLength ||
    view.getUint8(47) !== 0
  ) {
    throw new TypeError("Shape-artifact sidecar header is unsupported");
  }
  const faces = view.getUint32(16, false);
  const edges = view.getUint32(20, false);
  const vertices = view.getUint32(24, false);
  const topologyItems = checkedAdd(
    checkedAdd(faces, edges, "Shape-artifact topology"),
    vertices,
    "Shape-artifact topology",
  );
  assertBudget(topologyItems, MAX_TOPOLOGY_ITEMS, "Shape-artifact topology item");
  const adjacencyLinks = view.getUint32(28, false);
  const lineageRecords = view.getUint32(32, false);
  const stringBytes = view.getUint32(36, false);
  const nativeOrientations = view.getUint32(40, false);
  assertBudget(adjacencyLinks, MAX_ADJACENCY_LINKS, "Shape-artifact adjacency");
  assertBudget(lineageRecords, MAX_LINEAGE_RECORDS, "Shape-artifact lineage");
  assertBudget(stringBytes, MAX_STRING_BYTES, "Shape-artifact string");
  assertBudget(
    nativeOrientations,
    MAX_NATIVE_ORIENTATIONS,
    "Shape-artifact native orientation",
  );
  if ((stringBytes & 1) !== 0 || nativeOrientations < topologyItems) {
    throw new TypeError("Shape-artifact sidecar aggregate counts are invalid");
  }
  const history = decodeEnum(view.getUint8(44), HISTORIES, "Shape-artifact base history");
  const topologyHistory = decodeEnum(
    view.getUint8(45),
    HISTORIES,
    "Shape-artifact topology history",
  );
  const volumeTag = view.getUint8(46);
  if (volumeTag > 1) throw new TypeError("Shape-artifact volume flag is unsupported");
  let minimum = OCCT_ARTIFACT_SIDECAR_V2_HEADER_BYTES;
  minimum = checkedAdd(minimum, volumeTag * 8, "Shape-artifact sidecar minimum");
  minimum = checkedAdd(minimum, 14, "Shape-artifact sidecar minimum");
  minimum = checkedAdd(minimum, nativeOrientations, "Shape-artifact sidecar minimum");
  minimum = checkedAdd(minimum, 4, "Shape-artifact sidecar minimum");
  minimum = checkedAdd(minimum, checkedMultiply(faces, 93, "Shape-artifact faces"), "Shape-artifact sidecar minimum");
  minimum = checkedAdd(minimum, checkedMultiply(edges, 97, "Shape-artifact edges"), "Shape-artifact sidecar minimum");
  minimum = checkedAdd(minimum, checkedMultiply(vertices, 32, "Shape-artifact vertices"), "Shape-artifact sidecar minimum");
  minimum = checkedAdd(minimum, checkedMultiply(lineageRecords, 6, "Shape-artifact lineage"), "Shape-artifact sidecar minimum");
  minimum = checkedAdd(minimum, checkedMultiply(adjacencyLinks, 4, "Shape-artifact adjacency"), "Shape-artifact sidecar minimum");
  minimum = checkedAdd(minimum, stringBytes, "Shape-artifact sidecar minimum");
  const mandatoryStringBytes = checkedMultiply(
    checkedAdd(checkedAdd(faces, edges, "Shape-artifact strings"), lineageRecords, "Shape-artifact strings"),
    2,
    "Shape-artifact strings",
  );
  if (minimum > bytes.byteLength || stringBytes < mandatoryStringBytes) {
    throw new TypeError("Shape-artifact sidecar cannot contain its declared counts");
  }
  return {
    totalBytes: bytes.byteLength,
    faces,
    edges,
    vertices,
    adjacencyLinks,
    lineageRecords,
    stringBytes,
    nativeOrientations,
    history,
    topologyHistory,
    volumePresent: volumeTag === 1,
  };
}

export function decodeOcctArtifactSidecarV2(
  bytes: Uint8Array,
  options: OcctArtifactSidecarV2DecodeOptions = {},
): OcctShapeArtifactCapturedSidecarState {
  const signal = options.signal;
  checkAbort(signal);
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Shape-artifact sidecar must be a Uint8Array");
  }
  const header = readHeader(bytes);
  const reader = new SidecarReader(
    bytes,
    OCCT_ARTIFACT_SIDECAR_V2_HEADER_BYTES,
    header,
    signal,
  );
  const volumeOverride = header.volumePresent
    ? reader.float64("Shape-artifact volume override")
    : undefined;
  if (volumeOverride !== undefined && volumeOverride < 0) {
    throw new TypeError("Shape-artifact volume override is negative");
  }
  const rootType = decodeEnum(
    reader.uint8("Shape-artifact root type"),
    SHAPE_TYPES,
    "Shape-artifact root type",
  );
  const rootOrientation = decodeEnum(
    reader.uint8("Shape-artifact root orientation"),
    SHAPE_ORIENTATIONS,
    "Shape-artifact root orientation",
  );
  const solidCount = reader.uint32("Shape-artifact solid orientation count");
  const shellCount = reader.uint32("Shape-artifact shell orientation count");
  const wireCount = reader.uint32("Shape-artifact wire orientation count");
  let expectedOrientations = checkedAdd(solidCount, shellCount, "Shape-artifact native orientations");
  expectedOrientations = checkedAdd(expectedOrientations, wireCount, "Shape-artifact native orientations");
  expectedOrientations = checkedAdd(expectedOrientations, header.faces, "Shape-artifact native orientations");
  expectedOrientations = checkedAdd(expectedOrientations, header.edges, "Shape-artifact native orientations");
  expectedOrientations = checkedAdd(expectedOrientations, header.vertices, "Shape-artifact native orientations");
  if (expectedOrientations !== header.nativeOrientations) {
    throw new TypeError("Shape-artifact native orientation count does not match");
  }
  const nativeStructure: OcctShapeArtifactNativeStructure = Object.freeze({
    rootType,
    rootOrientation,
    solidOrientations: readOrientations(reader, solidCount, "Shape-artifact solids"),
    shellOrientations: readOrientations(reader, shellCount, "Shape-artifact shells"),
    wireOrientations: readOrientations(reader, wireCount, "Shape-artifact wires"),
    faceOrientations: readOrientations(reader, header.faces, "Shape-artifact faces"),
    edgeOrientations: readOrientations(reader, header.edges, "Shape-artifact edges"),
    vertexOrientations: readOrientations(reader, header.vertices, "Shape-artifact vertices"),
  });
  const lineage = readLineageArray(reader, "Shape-artifact lineage");
  const faces = new Array<KernelFaceDescriptor>(header.faces);
  for (let index = 0; index < header.faces; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    const area = reader.float64(`topology.faces[${index}].area`);
    if (area < 0) throw new TypeError(`topology.faces[${index}].area is negative`);
    const center = readVector(reader, `topology.faces[${index}].center`);
    const minimum = readVector(reader, `topology.faces[${index}].bounds.min`);
    const maximum = readVector(reader, `topology.faces[${index}].bounds.max`);
    if (minimum.some((value, axis) => value > maximum[axis]!)) {
      throw new TypeError(`topology.faces[${index}].bounds is inverted`);
    }
    faces[index] = {
      topology: "face",
      key: localKey("face", index),
      area,
      center,
      bounds: { min: minimum, max: maximum },
      surface: readSurface(reader, `topology.faces[${index}].surface`),
      lineage: readLineageArray(reader, `topology.faces[${index}].lineage`),
      edges: readIndexArray(reader, header.edges, `topology.faces[${index}].edges`).map(
        (edge) => localKey("edge", edge),
      ),
    };
  }
  const edges = new Array<KernelEdgeDescriptor>(header.edges);
  for (let index = 0; index < header.edges; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    const length = reader.float64(`topology.edges[${index}].length`);
    if (length < 0) throw new TypeError(`topology.edges[${index}].length is negative`);
    const center = readVector(reader, `topology.edges[${index}].center`);
    const minimum = readVector(reader, `topology.edges[${index}].bounds.min`);
    const maximum = readVector(reader, `topology.edges[${index}].bounds.max`);
    if (minimum.some((value, axis) => value > maximum[axis]!)) {
      throw new TypeError(`topology.edges[${index}].bounds is inverted`);
    }
    edges[index] = {
      topology: "edge",
      key: localKey("edge", index),
      length,
      center,
      bounds: { min: minimum, max: maximum },
      curve: readCurve(reader, `topology.edges[${index}].curve`),
      lineage: readLineageArray(reader, `topology.edges[${index}].lineage`),
      faces: readIndexArray(reader, header.faces, `topology.edges[${index}].faces`).map(
        (face) => localKey("face", face),
      ),
      vertices: readIndexArray(
        reader,
        header.vertices,
        `topology.edges[${index}].vertices`,
      ).map((vertex) => localKey("vertex", vertex)),
    };
  }
  const vertices = new Array<KernelVertexDescriptor>(header.vertices);
  for (let index = 0; index < header.vertices; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    vertices[index] = {
      topology: "vertex",
      key: localKey("vertex", index),
      point: readVector(reader, `topology.vertices[${index}].point`),
      lineage: readLineageArray(reader, `topology.vertices[${index}].lineage`),
      edges: readIndexArray(reader, header.edges, `topology.vertices[${index}].edges`).map(
        (edge) => localKey("edge", edge),
      ),
    };
  }
  if (
    reader.offset !== bytes.byteLength ||
    reader.stringBytes !== header.stringBytes ||
    reader.lineageRecords !== header.lineageRecords ||
    reader.adjacencyLinks !== header.adjacencyLinks ||
    reader.nativeOrientations !== header.nativeOrientations
  ) {
    throw new TypeError("Shape-artifact sidecar totals or trailing bytes are invalid");
  }
  const topology: KernelTopologySnapshot = {
    history: header.topologyHistory,
    faces,
    edges,
    vertices,
  };
  assertValidKernelTopologySnapshot(topology, (message): never => {
    throw new TypeError(message);
  });
  checkAbort(signal);
  return deepFreeze({
    history: header.history,
    lineage,
    topology,
    nativeStructure,
    ...(volumeOverride === undefined ? {} : { volumeOverride }),
  }) as OcctShapeArtifactCapturedSidecarState;
}
