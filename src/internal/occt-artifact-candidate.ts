import {
  canonicalStringifyProtocol,
  deepFreeze,
} from "../core/json.js";
import type { ShapeOrientation, ShapeType } from "occt-wasm";
import {
  KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
  type GeometryKernel,
  type KernelShape,
  type KernelShapeArtifactCapabilities,
  type KernelShapeArtifactContext,
} from "../kernel.js";
import { detachKernelTopologySnapshot } from "./topology-snapshot.js";
import type {
  KernelCurveDescriptor,
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelSurfaceDescriptor,
  KernelTopologyKey,
  KernelTopologyLineage,
  KernelTopologySnapshot,
  KernelVertexDescriptor,
} from "../protocol/topology.js";

export const OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS = Symbol(
  "InvariantCAD.OcctShapeArtifactCandidateAccess",
);

export const OCCT_SHAPE_ARTIFACT_CANDIDATE_FORMAT =
  "org.invariantcad.occt-shape-candidate" as const;
export const OCCT_SHAPE_ARTIFACT_CANDIDATE_FORMAT_VERSION = 1 as const;

type TopologyHistory = KernelTopologySnapshot["history"];

/**
 * Detached state crossing the package-private OCCT candidate boundary.
 *
 * `topology` is effective state: hosts must capture it after applying lazy
 * annotations or exact indexed evolution. Runtime topology keys in this value
 * are private to the call and are replaced by the codec wire format.
 */
export interface OcctShapeArtifactCapturedSidecarState {
  readonly lineage: readonly KernelTopologyLineage[];
  readonly history: TopologyHistory;
  readonly topology: KernelTopologySnapshot;
  readonly nativeStructure: OcctShapeArtifactNativeStructure;
  readonly volumeOverride?: number;
}

export interface OcctShapeArtifactCapturedState
  extends OcctShapeArtifactCapturedSidecarState {
  readonly brep: Uint8Array;
}

/** Ordered native structure used only as a fail-closed candidate check. */
export interface OcctShapeArtifactNativeStructure {
  readonly rootType: ShapeType;
  readonly rootOrientation: ShapeOrientation;
  readonly solidOrientations: readonly ShapeOrientation[];
  readonly shellOrientations: readonly ShapeOrientation[];
  readonly wireOrientations: readonly ShapeOrientation[];
  readonly faceOrientations: readonly ShapeOrientation[];
  readonly edgeOrientations: readonly ShapeOrientation[];
  readonly vertexOrientations: readonly ShapeOrientation[];
}

/** Package-private operations implemented by the owning OCCT kernel. */
export interface OcctShapeArtifactCandidateHost {
  /** Candidate runtime/options identity; not a production build attestation. */
  readonly compatibilityFingerprint: string;
  capture(shape: KernelShape): OcctShapeArtifactCapturedSidecarState;
  encodeNative(shape: KernelShape, maxBytes: number): Uint8Array;
  restore(state: OcctShapeArtifactCapturedState): KernelShape;
}

/** Structurally compatible with the public conformance candidate interface. */
export interface OcctShapeArtifactCodecCandidate {
  readonly capabilities: KernelShapeArtifactCapabilities;
  encodeShapeArtifact(
    shape: KernelShape,
    context: KernelShapeArtifactContext,
  ): Uint8Array;
  decodeShapeArtifact(
    artifact: Uint8Array,
    context: KernelShapeArtifactContext,
  ): KernelShape;
}

const ENVELOPE_VERSION = 1;
const HEADER_BYTES = 40;
const MAX_UINT32 = 0xffff_ffff;
const MAX_FINGERPRINT_BYTES = 1_024;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_TOPOLOGY_ITEMS = 100_000;
const MAX_ADJACENCY_LINKS = 1_000_000;
const MAX_LINEAGE_RECORDS = 1_000_000;
const MAX_STRING_BYTES = 1_000_000;
const MAGIC = new Uint8Array([
  0x49, 0x43, 0x41, 0x44, 0x4f, 0x43, 0x43, 0x54,
  0x41, 0x52, 0x54, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const FLOAT64_PATTERN = /^[0-9a-f]{16}$/;
const SHAPE_TYPES = new Set<ShapeType>([
  "compound",
  "compsolid",
  "solid",
  "shell",
  "face",
  "wire",
  "edge",
  "vertex",
  "shape",
]);
const SHAPE_ORIENTATIONS = new Set<ShapeOrientation>([
  "forward",
  "reversed",
  "internal",
  "external",
]);
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

type EncodedFloat64 = string;
type EncodedVec3 = readonly [
  EncodedFloat64,
  EncodedFloat64,
  EncodedFloat64,
];

interface WireLineage {
  readonly feature: string;
  readonly relation: "created" | "modified";
  readonly role: string | null;
  readonly source: {
    readonly kind: "sketch-entity";
    readonly sketch: string;
    readonly entity: string;
  } | null;
}

interface WireSurface {
  readonly kind: string;
  readonly normal: EncodedVec3 | null;
  readonly axis: EncodedVec3 | null;
  readonly radius: EncodedFloat64 | null;
}

interface WireCurve {
  readonly kind: string;
  readonly direction: EncodedVec3 | null;
  readonly axis: EncodedVec3 | null;
  readonly radius: EncodedFloat64 | null;
}

interface WireFace {
  readonly area: EncodedFloat64;
  readonly center: EncodedVec3;
  readonly bounds: {
    readonly min: EncodedVec3;
    readonly max: EncodedVec3;
  };
  readonly surface: WireSurface;
  readonly lineage: readonly WireLineage[];
  /** Artifact-local edge indices, never kernel topology keys. */
  readonly edges: readonly number[];
}

interface WireEdge {
  readonly length: EncodedFloat64;
  readonly center: EncodedVec3;
  readonly bounds: {
    readonly min: EncodedVec3;
    readonly max: EncodedVec3;
  };
  readonly curve: WireCurve;
  readonly lineage: readonly WireLineage[];
  /** Artifact-local face and vertex indices. */
  readonly faces: readonly number[];
  readonly vertices: readonly number[];
}

interface WireVertex {
  readonly point: EncodedVec3;
  readonly lineage: readonly WireLineage[];
  /** Artifact-local edge indices. */
  readonly edges: readonly number[];
}

interface WireStateV1 {
  readonly protocolVersion: 1;
  readonly history: TopologyHistory;
  readonly lineage: readonly WireLineage[];
  readonly nativeStructure: OcctShapeArtifactNativeStructure;
  readonly topology: {
    readonly history: TopologyHistory;
    readonly faces: readonly WireFace[];
    readonly edges: readonly WireEdge[];
    readonly vertices: readonly WireVertex[];
  };
  readonly volumeOverride: EncodedFloat64 | null;
}

interface DecodeBudget {
  topologyItems: number;
  adjacencyLinks: number;
  lineageRecords: number;
  stringBytes: number;
}

function abortError(): DOMException {
  return new DOMException("OCCT shape-artifact operation was aborted", "AbortError");
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError();
}

function capturedSignal(context: KernelShapeArtifactContext): AbortSignal | undefined {
  const signal: unknown = context.signal;
  if (
    signal !== undefined &&
    (typeof signal !== "object" || signal === null ||
      typeof (signal as { readonly aborted?: unknown }).aborted !== "boolean")
  ) {
    throw new TypeError("Shape-artifact signal must be an AbortSignal");
  }
  return signal as AbortSignal | undefined;
}

function artifactLimit(context: KernelShapeArtifactContext): number {
  const limit: unknown = context.maxArtifactBytes;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit <= 0
  ) {
    throw new RangeError("maxArtifactBytes must be a positive safe integer");
  }
  return Math.min(limit, MAX_UINT32);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function requiredRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(value) || !exactKeys(value, keys)) {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function requiredArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function checkedLength(total: number, addition: number, label: string): number {
  const next = total + addition;
  if (!Number.isSafeInteger(next) || next > MAX_UINT32) {
    throw new RangeError(`${label} exceeds the candidate envelope limit`);
  }
  return next;
}

function utf8Length(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function chargeString(
  value: unknown,
  budget: DecodeBudget,
  label: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0)
  ) {
    throw new TypeError(`${label} must be ${allowEmpty ? "a" : "a non-empty"} string`);
  }
  budget.stringBytes = checkedLength(
    budget.stringBytes,
    utf8Length(value),
    "Shape-artifact strings",
  );
  if (budget.stringBytes > MAX_STRING_BYTES) {
    throw new RangeError("Shape-artifact string budget was exceeded");
  }
  return value;
}

function encodeFloat64(value: number, label: string): EncodedFloat64 {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  const bytes = new Uint8Array(8);
  // The repository semantic-observation protocol deliberately identifies the
  // two signed-zero encodings. Keep the sidecar wire form unique as well.
  new DataView(bytes.buffer).setFloat64(
    0,
    Object.is(value, -0) ? 0 : value,
    false,
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeFloat64(
  value: unknown,
  budget: DecodeBudget,
  label: string,
): number {
  const encoded = chargeString(value, budget, label);
  if (!FLOAT64_PATTERN.test(encoded)) {
    throw new TypeError(`${label} must be one canonical binary64 value`);
  }
  const bytes = new Uint8Array(8);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(encoded.slice(index * 2, index * 2 + 2), 16);
  }
  const decoded = new DataView(bytes.buffer).getFloat64(0, false);
  if (!Number.isFinite(decoded)) throw new TypeError(`${label} must be finite`);
  if (Object.is(decoded, -0)) {
    throw new TypeError(`${label} uses a non-canonical signed-zero encoding`);
  }
  return decoded;
}

function encodeVec3(value: readonly number[], label: string): EncodedVec3 {
  if (value.length !== 3) throw new TypeError(`${label} must contain three values`);
  return [
    encodeFloat64(value[0]!, `${label}[0]`),
    encodeFloat64(value[1]!, `${label}[1]`),
    encodeFloat64(value[2]!, `${label}[2]`),
  ];
}

function decodeVec3(
  value: unknown,
  budget: DecodeBudget,
  label: string,
): [number, number, number] {
  const values = requiredArray(value, label);
  if (values.length !== 3) throw new TypeError(`${label} must contain three values`);
  return [
    decodeFloat64(values[0], budget, `${label}[0]`),
    decodeFloat64(values[1], budget, `${label}[1]`),
    decodeFloat64(values[2], budget, `${label}[2]`),
  ];
}

function copyLineageRecord(
  value: KernelTopologyLineage,
  label: string,
): KernelTopologyLineage {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.feature !== "string" ||
    value.feature.length === 0 ||
    (value.relation !== "created" && value.relation !== "modified") ||
    (value.role !== undefined &&
      (typeof value.role !== "string" || value.role.length === 0))
  ) {
    throw new TypeError(`${label} is malformed`);
  }
  const source = value.source;
  if (
    source !== undefined &&
    (value.relation !== "created" ||
      source.kind !== "sketch-entity" ||
      typeof source.sketch !== "string" ||
      source.sketch.length === 0 ||
      typeof source.entity !== "string" ||
      source.entity.length === 0)
  ) {
    throw new TypeError(`${label}.source is malformed`);
  }
  return Object.freeze({
    feature: value.feature,
    relation: value.relation,
    ...(value.role === undefined ? {} : { role: value.role }),
    ...(source === undefined
      ? {}
      : {
          source: Object.freeze({
            kind: "sketch-entity" as const,
            sketch: source.sketch,
            entity: source.entity,
          }),
        }),
  });
}

function copyGlobalLineage(
  value: readonly KernelTopologyLineage[],
): readonly KernelTopologyLineage[] {
  if (!Array.isArray(value) || value.length > MAX_LINEAGE_RECORDS) {
    throw new RangeError("Shape-artifact global lineage is malformed or oversized");
  }
  let stringBytes = 0;
  const charge = (item: string): void => {
    const remaining = MAX_STRING_BYTES - stringBytes;
    if (item.length > remaining) {
      throw new RangeError("Shape-artifact global lineage string budget was exceeded");
    }
    stringBytes = checkedLength(
      stringBytes,
      utf8Length(item),
      "Shape-artifact global lineage strings",
    );
    if (stringBytes > MAX_STRING_BYTES) {
      throw new RangeError("Shape-artifact global lineage string budget was exceeded");
    }
  };
  return Object.freeze(
    value.map((item, index) => {
      const copied = copyLineageRecord(
        item,
        `Shape-artifact global lineage[${index}]`,
      );
      charge(copied.feature);
      charge(copied.relation);
      if (copied.role !== undefined) charge(copied.role);
      if (copied.source !== undefined) {
        charge(copied.source.kind);
        charge(copied.source.sketch);
        charge(copied.source.entity);
      }
      return copied;
    }),
  );
}

function encodeLineage(value: KernelTopologyLineage): WireLineage {
  const copied = copyLineageRecord(value, "Shape-artifact lineage");
  return {
    feature: copied.feature,
    relation: copied.relation,
    role: copied.role ?? null,
    source:
      copied.source === undefined
        ? null
        : {
            kind: "sketch-entity",
            sketch: copied.source.sketch,
            entity: copied.source.entity,
          },
  };
}

function wireLineageKey(value: WireLineage): string {
  return canonicalStringifyProtocol(value);
}

function encodeLineageArray(
  values: readonly KernelTopologyLineage[],
): readonly WireLineage[] {
  const unique = new Map<string, WireLineage>();
  for (const value of values) {
    const encoded = encodeLineage(value);
    unique.set(wireLineageKey(encoded), encoded);
  }
  return Object.freeze(
    [...unique]
      .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
      .map(([, value]) => value),
  );
}

function decodeLineage(
  value: unknown,
  budget: DecodeBudget,
  label: string,
): KernelTopologyLineage {
  budget.lineageRecords += 1;
  if (budget.lineageRecords > MAX_LINEAGE_RECORDS) {
    throw new RangeError("Shape-artifact lineage budget was exceeded");
  }
  const record = requiredRecord(
    value,
    ["feature", "relation", "role", "source"],
    label,
  );
  const feature = chargeString(record.feature, budget, `${label}.feature`);
  const relation = record.relation;
  if (relation !== "created" && relation !== "modified") {
    throw new TypeError(`${label}.relation is malformed`);
  }
  const role =
    record.role === null
      ? undefined
      : chargeString(record.role, budget, `${label}.role`);
  let source: KernelTopologyLineage["source"];
  if (record.source !== null) {
    const rawSource = requiredRecord(
      record.source,
      ["entity", "kind", "sketch"],
      `${label}.source`,
    );
    if (rawSource.kind !== "sketch-entity" || relation !== "created") {
      throw new TypeError(`${label}.source is malformed`);
    }
    chargeString(rawSource.kind, budget, `${label}.source.kind`);
    source = Object.freeze({
      kind: "sketch-entity",
      sketch: chargeString(rawSource.sketch, budget, `${label}.source.sketch`),
      entity: chargeString(rawSource.entity, budget, `${label}.source.entity`),
    });
  }
  return Object.freeze({
    feature,
    relation,
    ...(role === undefined ? {} : { role }),
    ...(source === undefined ? {} : { source }),
  }) as KernelTopologyLineage;
}

function decodeLineageArray(
  value: unknown,
  budget: DecodeBudget,
  label: string,
): readonly KernelTopologyLineage[] {
  const values = requiredArray(value, label);
  if (values.length > MAX_LINEAGE_RECORDS - budget.lineageRecords) {
    throw new RangeError("Shape-artifact lineage budget was exceeded");
  }
  const decoded = Object.freeze(
    values.map((item, index) =>
      decodeLineage(item, budget, `${label}[${index}]`),
    ),
  );
  let previous: string | undefined;
  for (const item of decoded) {
    const key = wireLineageKey(encodeLineage(item));
    if (previous !== undefined && previous >= key) {
      throw new TypeError(`${label} is not in canonical unique order`);
    }
    previous = key;
  }
  return decoded;
}

function encodeSurface(value: KernelSurfaceDescriptor): WireSurface {
  if (typeof value.kind !== "string" || value.kind.length === 0) {
    throw new TypeError("Shape-artifact surface kind is malformed");
  }
  return {
    kind: value.kind,
    normal: value.normal === undefined ? null : encodeVec3(value.normal, "surface.normal"),
    axis: value.axis === undefined ? null : encodeVec3(value.axis, "surface.axis"),
    radius:
      value.radius === undefined
        ? null
        : encodeFloat64(value.radius, "surface.radius"),
  };
}

function decodeSurface(
  value: unknown,
  budget: DecodeBudget,
  label: string,
): KernelSurfaceDescriptor {
  const record = requiredRecord(
    value,
    ["axis", "kind", "normal", "radius"],
    label,
  );
  const normal =
    record.normal === null
      ? undefined
      : decodeVec3(record.normal, budget, `${label}.normal`);
  const axis =
    record.axis === null
      ? undefined
      : decodeVec3(record.axis, budget, `${label}.axis`);
  const radius =
    record.radius === null
      ? undefined
      : decodeFloat64(record.radius, budget, `${label}.radius`);
  return Object.freeze({
    kind: chargeString(record.kind, budget, `${label}.kind`),
    ...(normal === undefined ? {} : { normal }),
    ...(axis === undefined ? {} : { axis }),
    ...(radius === undefined ? {} : { radius }),
  });
}

function encodeCurve(value: KernelCurveDescriptor): WireCurve {
  if (typeof value.kind !== "string" || value.kind.length === 0) {
    throw new TypeError("Shape-artifact curve kind is malformed");
  }
  return {
    kind: value.kind,
    direction:
      value.direction === undefined
        ? null
        : encodeVec3(value.direction, "curve.direction"),
    axis: value.axis === undefined ? null : encodeVec3(value.axis, "curve.axis"),
    radius:
      value.radius === undefined
        ? null
        : encodeFloat64(value.radius, "curve.radius"),
  };
}

function decodeCurve(
  value: unknown,
  budget: DecodeBudget,
  label: string,
): KernelCurveDescriptor {
  const record = requiredRecord(
    value,
    ["axis", "direction", "kind", "radius"],
    label,
  );
  const direction =
    record.direction === null
      ? undefined
      : decodeVec3(record.direction, budget, `${label}.direction`);
  const axis =
    record.axis === null
      ? undefined
      : decodeVec3(record.axis, budget, `${label}.axis`);
  const radius =
    record.radius === null
      ? undefined
      : decodeFloat64(record.radius, budget, `${label}.radius`);
  return Object.freeze({
    kind: chargeString(record.kind, budget, `${label}.kind`),
    ...(direction === undefined ? {} : { direction }),
    ...(axis === undefined ? {} : { axis }),
    ...(radius === undefined ? {} : { radius }),
  });
}

function keyIndices(
  keys: readonly KernelTopologyKey[],
  indices: ReadonlyMap<KernelTopologyKey, number>,
  label: string,
): readonly number[] {
  return Object.freeze(
    keys
      .map((key) => {
        const index = indices.get(key);
        if (index === undefined) {
          throw new TypeError(`${label} references topology outside its snapshot`);
        }
        return index;
      })
      .sort((first, second) => first - second),
  );
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

function nativeShapeType(value: unknown, label: string): ShapeType {
  if (typeof value !== "string" || !SHAPE_TYPES.has(value as ShapeType)) {
    throw new TypeError(`${label} is malformed`);
  }
  return value as ShapeType;
}

function nativeOrientation(
  value: unknown,
  label: string,
): ShapeOrientation {
  if (
    typeof value !== "string" ||
    !SHAPE_ORIENTATIONS.has(value as ShapeOrientation)
  ) {
    throw new TypeError(`${label} is malformed`);
  }
  return value as ShapeOrientation;
}

function nativeOrientationArray(
  value: unknown,
  expectedLength: number | undefined,
  label: string,
): readonly ShapeOrientation[] {
  const values = requiredArray(value, label);
  if (
    (expectedLength !== undefined && values.length !== expectedLength) ||
    values.length > MAX_ADJACENCY_LINKS
  ) {
    throw new RangeError(`${label} has an invalid or oversized length`);
  }
  return Object.freeze(
    values.map((item, index) =>
      nativeOrientation(item, `${label}[${index}]`),
    ),
  );
}

function copyNativeStructure(
  value: unknown,
  counts: {
    readonly faces: number;
    readonly edges: number;
    readonly vertices: number;
  },
): OcctShapeArtifactNativeStructure {
  const record = requiredRecord(
    value,
    [
      "edgeOrientations",
      "faceOrientations",
      "rootOrientation",
      "rootType",
      "shellOrientations",
      "solidOrientations",
      "vertexOrientations",
      "wireOrientations",
    ],
    "Shape-artifact native structure",
  );
  const solidOrientations = nativeOrientationArray(
    record.solidOrientations,
    undefined,
    "Shape-artifact solid orientations",
  );
  const shellOrientations = nativeOrientationArray(
    record.shellOrientations,
    undefined,
    "Shape-artifact shell orientations",
  );
  const wireOrientations = nativeOrientationArray(
    record.wireOrientations,
    undefined,
    "Shape-artifact wire orientations",
  );
  const faceOrientations = nativeOrientationArray(
    record.faceOrientations,
    counts.faces,
    "Shape-artifact face orientations",
  );
  const edgeOrientations = nativeOrientationArray(
    record.edgeOrientations,
    counts.edges,
    "Shape-artifact edge orientations",
  );
  const vertexOrientations = nativeOrientationArray(
    record.vertexOrientations,
    counts.vertices,
    "Shape-artifact vertex orientations",
  );
  const total =
    solidOrientations.length +
    shellOrientations.length +
    wireOrientations.length +
    faceOrientations.length +
    edgeOrientations.length +
    vertexOrientations.length;
  if (!Number.isSafeInteger(total) || total > MAX_ADJACENCY_LINKS) {
    throw new RangeError("Shape-artifact native structure budget was exceeded");
  }
  return Object.freeze({
    rootType: nativeShapeType(record.rootType, "Shape-artifact root type"),
    rootOrientation: nativeOrientation(
      record.rootOrientation,
      "Shape-artifact root orientation",
    ),
    solidOrientations,
    shellOrientations,
    wireOrientations,
    faceOrientations,
    edgeOrientations,
    vertexOrientations,
  });
}

function encodeWireState(
  state: OcctShapeArtifactCapturedSidecarState,
  signal?: AbortSignal,
): WireStateV1 {
  if (state.history !== "complete" && state.history !== "partial") {
    throw new TypeError("Shape-artifact base history is malformed");
  }
  if (
    state.volumeOverride !== undefined &&
    (!Number.isFinite(state.volumeOverride) || state.volumeOverride < 0)
  ) {
    throw new TypeError("Shape-artifact volume override is malformed");
  }
  const topology = detachKernelTopologySnapshot(state.topology, {
    maxTopologyItems: MAX_TOPOLOGY_ITEMS,
    maxAdjacencyLinks: MAX_ADJACENCY_LINKS,
    maxEvidenceRecords: MAX_LINEAGE_RECORDS,
    maxStringBytes: MAX_STRING_BYTES,
  });
  const lineage = copyGlobalLineage(state.lineage);
  const nativeStructure = copyNativeStructure(state.nativeStructure, {
    faces: topology.faces.length,
    edges: topology.edges.length,
    vertices: topology.vertices.length,
  });
  const faceIndices = topologyIndex(
    topology.faces.map((face) => face.key),
    "Shape-artifact faces",
  );
  const edgeIndices = topologyIndex(
    topology.edges.map((edge) => edge.key),
    "Shape-artifact edges",
  );
  const vertexIndices = topologyIndex(
    topology.vertices.map((vertex) => vertex.key),
    "Shape-artifact vertices",
  );
  const faces = topology.faces.map((face, index): WireFace => {
    if ((index & 0xff) === 0) checkAbort(signal);
    return {
      area: encodeFloat64(face.area, `topology.faces[${index}].area`),
      center: encodeVec3(face.center, `topology.faces[${index}].center`),
      bounds: {
        min: encodeVec3(face.bounds.min, `topology.faces[${index}].bounds.min`),
        max: encodeVec3(face.bounds.max, `topology.faces[${index}].bounds.max`),
      },
      surface: encodeSurface(face.surface),
      lineage: encodeLineageArray(face.lineage),
      edges: keyIndices(face.edges, edgeIndices, `topology.faces[${index}].edges`),
    };
  });
  const edges = topology.edges.map((edge, index): WireEdge => {
    if ((index & 0xff) === 0) checkAbort(signal);
    return {
      length: encodeFloat64(edge.length, `topology.edges[${index}].length`),
      center: encodeVec3(edge.center, `topology.edges[${index}].center`),
      bounds: {
        min: encodeVec3(edge.bounds.min, `topology.edges[${index}].bounds.min`),
        max: encodeVec3(edge.bounds.max, `topology.edges[${index}].bounds.max`),
      },
      curve: encodeCurve(edge.curve),
      lineage: encodeLineageArray(edge.lineage),
      faces: keyIndices(edge.faces, faceIndices, `topology.edges[${index}].faces`),
      vertices: keyIndices(
        edge.vertices,
        vertexIndices,
        `topology.edges[${index}].vertices`,
      ),
    };
  });
  const vertices = topology.vertices.map((vertex, index): WireVertex => {
    if ((index & 0xff) === 0) checkAbort(signal);
    return {
      point: encodeVec3(vertex.point, `topology.vertices[${index}].point`),
      lineage: encodeLineageArray(vertex.lineage),
      edges: keyIndices(
        vertex.edges,
        edgeIndices,
        `topology.vertices[${index}].edges`,
      ),
    };
  });
  return {
    protocolVersion: 1,
    history: state.history,
    lineage: encodeLineageArray(lineage),
    nativeStructure,
    topology: {
      history: topology.history,
      faces,
      edges,
      vertices,
    },
    volumeOverride:
      state.volumeOverride === undefined
        ? null
        : encodeFloat64(state.volumeOverride, "volumeOverride"),
  };
}

function decodeHistory(value: unknown, label: string): TopologyHistory {
  if (value !== "complete" && value !== "partial") {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function decodeIndexArray(
  value: unknown,
  count: number,
  budget: DecodeBudget,
  label: string,
): readonly number[] {
  const values = requiredArray(value, label);
  budget.adjacencyLinks = checkedLength(
    budget.adjacencyLinks,
    values.length,
    "Shape-artifact adjacency",
  );
  if (budget.adjacencyLinks > MAX_ADJACENCY_LINKS) {
    throw new RangeError("Shape-artifact adjacency budget was exceeded");
  }
  const output = values.map((item, index) => {
    if (
      typeof item !== "number" ||
      !Number.isSafeInteger(item) ||
      item < 0 ||
      item >= count
    ) {
      throw new TypeError(`${label}[${index}] is outside its topology table`);
    }
    return item;
  });
  for (let index = 1; index < output.length; index += 1) {
    if (output[index - 1]! >= output[index]!) {
      throw new TypeError(`${label} is not in canonical unique order`);
    }
  }
  return Object.freeze(output);
}

function localKey(
  topology: "face" | "edge" | "vertex",
  index: number,
): KernelTopologyKey {
  return `artifact:${topology}:${index}` as KernelTopologyKey;
}

function decodeWireState(
  value: unknown,
  brep: Uint8Array,
  signal?: AbortSignal,
): OcctShapeArtifactCapturedState {
  const record = requiredRecord(
    value,
    [
      "history",
      "lineage",
      "nativeStructure",
      "protocolVersion",
      "topology",
      "volumeOverride",
    ],
    "Shape-artifact state",
  );
  if (record.protocolVersion !== 1) {
    throw new TypeError("Shape-artifact state protocol version is unsupported");
  }
  const rawTopology = requiredRecord(
    record.topology,
    ["edges", "faces", "history", "vertices"],
    "Shape-artifact topology",
  );
  const rawFaces = requiredArray(rawTopology.faces, "Shape-artifact topology faces");
  const rawEdges = requiredArray(rawTopology.edges, "Shape-artifact topology edges");
  const rawVertices = requiredArray(
    rawTopology.vertices,
    "Shape-artifact topology vertices",
  );
  const topologyItems = rawFaces.length + rawEdges.length + rawVertices.length;
  if (!Number.isSafeInteger(topologyItems) || topologyItems > MAX_TOPOLOGY_ITEMS) {
    throw new RangeError("Shape-artifact topology item budget was exceeded");
  }
  const budget: DecodeBudget = {
    topologyItems,
    adjacencyLinks: 0,
    lineageRecords: 0,
    stringBytes: 0,
  };
  const lineage = decodeLineageArray(record.lineage, budget, "Shape-artifact lineage");
  const faces = rawFaces.map((value, index): KernelFaceDescriptor => {
    if ((index & 0xff) === 0) checkAbort(signal);
    const face = requiredRecord(
      value,
      ["area", "bounds", "center", "edges", "lineage", "surface"],
      `Shape-artifact topology.faces[${index}]`,
    );
    const bounds = requiredRecord(
      face.bounds,
      ["max", "min"],
      `Shape-artifact topology.faces[${index}].bounds`,
    );
    return {
      topology: "face",
      key: localKey("face", index),
      area: decodeFloat64(face.area, budget, `topology.faces[${index}].area`),
      center: decodeVec3(face.center, budget, `topology.faces[${index}].center`),
      bounds: {
        min: decodeVec3(bounds.min, budget, `topology.faces[${index}].bounds.min`),
        max: decodeVec3(bounds.max, budget, `topology.faces[${index}].bounds.max`),
      },
      surface: decodeSurface(face.surface, budget, `topology.faces[${index}].surface`),
      lineage: decodeLineageArray(
        face.lineage,
        budget,
        `topology.faces[${index}].lineage`,
      ),
      edges: decodeIndexArray(
        face.edges,
        rawEdges.length,
        budget,
        `topology.faces[${index}].edges`,
      ).map((edge) => localKey("edge", edge)),
    };
  });
  const edges = rawEdges.map((value, index): KernelEdgeDescriptor => {
    if ((index & 0xff) === 0) checkAbort(signal);
    const edge = requiredRecord(
      value,
      ["bounds", "center", "curve", "faces", "length", "lineage", "vertices"],
      `Shape-artifact topology.edges[${index}]`,
    );
    const bounds = requiredRecord(
      edge.bounds,
      ["max", "min"],
      `Shape-artifact topology.edges[${index}].bounds`,
    );
    return {
      topology: "edge",
      key: localKey("edge", index),
      length: decodeFloat64(edge.length, budget, `topology.edges[${index}].length`),
      center: decodeVec3(edge.center, budget, `topology.edges[${index}].center`),
      bounds: {
        min: decodeVec3(bounds.min, budget, `topology.edges[${index}].bounds.min`),
        max: decodeVec3(bounds.max, budget, `topology.edges[${index}].bounds.max`),
      },
      curve: decodeCurve(edge.curve, budget, `topology.edges[${index}].curve`),
      lineage: decodeLineageArray(
        edge.lineage,
        budget,
        `topology.edges[${index}].lineage`,
      ),
      faces: decodeIndexArray(
        edge.faces,
        rawFaces.length,
        budget,
        `topology.edges[${index}].faces`,
      ).map((face) => localKey("face", face)),
      vertices: decodeIndexArray(
        edge.vertices,
        rawVertices.length,
        budget,
        `topology.edges[${index}].vertices`,
      ).map((vertex) => localKey("vertex", vertex)),
    };
  });
  const vertices = rawVertices.map((value, index): KernelVertexDescriptor => {
    if ((index & 0xff) === 0) checkAbort(signal);
    const vertex = requiredRecord(
      value,
      ["edges", "lineage", "point"],
      `Shape-artifact topology.vertices[${index}]`,
    );
    return {
      topology: "vertex",
      key: localKey("vertex", index),
      point: decodeVec3(vertex.point, budget, `topology.vertices[${index}].point`),
      lineage: decodeLineageArray(
        vertex.lineage,
        budget,
        `topology.vertices[${index}].lineage`,
      ),
      edges: decodeIndexArray(
        vertex.edges,
        rawEdges.length,
        budget,
        `topology.vertices[${index}].edges`,
      ).map((edge) => localKey("edge", edge)),
    };
  });
  const topology = detachKernelTopologySnapshot(
    {
      history: decodeHistory(rawTopology.history, "Shape-artifact topology history"),
      faces,
      edges,
      vertices,
    },
    {
      maxTopologyItems: MAX_TOPOLOGY_ITEMS,
      maxAdjacencyLinks: MAX_ADJACENCY_LINKS,
      maxEvidenceRecords: MAX_LINEAGE_RECORDS,
      maxStringBytes: MAX_STRING_BYTES,
    },
  );
  const volumeOverride =
    record.volumeOverride === null
      ? undefined
      : decodeFloat64(record.volumeOverride, budget, "Shape-artifact volumeOverride");
  if (volumeOverride !== undefined && volumeOverride < 0) {
    throw new TypeError("Shape-artifact volumeOverride must be non-negative");
  }
  const nativeStructure = copyNativeStructure(record.nativeStructure, {
    faces: faces.length,
    edges: edges.length,
    vertices: vertices.length,
  });
  return Object.freeze({
    brep,
    lineage,
    history: decodeHistory(record.history, "Shape-artifact base history"),
    topology,
    nativeStructure,
    ...(volumeOverride === undefined ? {} : { volumeOverride }),
  });
}

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.byteLength !== second.byteLength) return false;
  for (let index = 0; index < first.byteLength; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function exactNumber(first: number, second: number): boolean {
  // The repository evaluator-semantic quotient deliberately identifies signed
  // zero. Binary BREP can flip the sign bit of a geometrically zero normal
  // component; every other finite value must remain exactly equal.
  return first === second;
}

function sameVector(first: readonly number[], second: readonly number[]): boolean {
  return (
    first.length === 3 &&
    second.length === 3 &&
    exactNumber(first[0]!, second[0]!) &&
    exactNumber(first[1]!, second[1]!) &&
    exactNumber(first[2]!, second[2]!)
  );
}

function sameOptionalVector(
  first: readonly number[] | undefined,
  second: readonly number[] | undefined,
): boolean {
  return first === undefined || second === undefined
    ? first === second
    : sameVector(first, second);
}

function sameOptionalNumber(
  first: number | undefined,
  second: number | undefined,
): boolean {
  return first === undefined || second === undefined
    ? first === second
    : exactNumber(first, second);
}

function sameSurface(
  first: KernelSurfaceDescriptor,
  second: KernelSurfaceDescriptor,
): boolean {
  return (
    first.kind === second.kind &&
    sameOptionalVector(first.normal, second.normal) &&
    sameOptionalVector(first.axis, second.axis) &&
    sameOptionalNumber(first.radius, second.radius)
  );
}

function sameCurve(
  first: KernelCurveDescriptor,
  second: KernelCurveDescriptor,
): boolean {
  return (
    first.kind === second.kind &&
    sameOptionalVector(first.direction, second.direction) &&
    sameOptionalVector(first.axis, second.axis) &&
    sameOptionalNumber(first.radius, second.radius)
  );
}

function sortedAdjacencyIndices(
  keys: readonly KernelTopologyKey[],
  indices: ReadonlyMap<KernelTopologyKey, number>,
  label: string,
): readonly number[] {
  return [...keyIndices(keys, indices, label)].sort((first, second) => first - second);
}

function sameIndices(first: readonly number[], second: readonly number[]): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function sameOrientations(
  first: readonly ShapeOrientation[],
  second: readonly ShapeOrientation[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function sameNativeStructure(
  first: OcctShapeArtifactNativeStructure,
  second: OcctShapeArtifactNativeStructure,
): boolean {
  return (
    first.rootType === second.rootType &&
    first.rootOrientation === second.rootOrientation &&
    sameOrientations(first.solidOrientations, second.solidOrientations) &&
    sameOrientations(first.shellOrientations, second.shellOrientations) &&
    sameOrientations(first.wireOrientations, second.wireOrientations) &&
    sameOrientations(first.faceOrientations, second.faceOrientations) &&
    sameOrientations(first.edgeOrientations, second.edgeOrientations) &&
    sameOrientations(first.vertexOrientations, second.vertexOrientations)
  );
}

function snapshotIndices(snapshot: KernelTopologySnapshot): {
  readonly faces: ReadonlyMap<KernelTopologyKey, number>;
  readonly edges: ReadonlyMap<KernelTopologyKey, number>;
  readonly vertices: ReadonlyMap<KernelTopologyKey, number>;
} {
  return {
    faces: topologyIndex(
      snapshot.faces.map((face) => face.key),
      "Topology faces",
    ),
    edges: topologyIndex(
      snapshot.edges.map((edge) => edge.key),
      "Topology edges",
    ),
    vertices: topologyIndex(
      snapshot.vertices.map((vertex) => vertex.key),
      "Topology vertices",
    ),
  };
}

/**
 * Verifies exact index-aligned native geometry and incidence, then restores the
 * stored semantic lineage/history onto the fresh root's evaluation-scoped keys.
 * A native BREP reordering fails closed instead of guessing a subshape match.
 */
export function remapOcctShapeArtifactTopology(
  storedSnapshot: KernelTopologySnapshot,
  freshRootSnapshot: KernelTopologySnapshot,
  storedNativeStructure: OcctShapeArtifactNativeStructure,
  freshNativeStructure: OcctShapeArtifactNativeStructure,
): KernelTopologySnapshot {
  const limits = {
    maxTopologyItems: MAX_TOPOLOGY_ITEMS,
    maxAdjacencyLinks: MAX_ADJACENCY_LINKS,
    maxEvidenceRecords: MAX_LINEAGE_RECORDS,
    maxStringBytes: MAX_STRING_BYTES,
  } as const;
  const stored = detachKernelTopologySnapshot(storedSnapshot, limits);
  const fresh = detachKernelTopologySnapshot(freshRootSnapshot, limits);
  if (!sameNativeStructure(storedNativeStructure, freshNativeStructure)) {
    throw new TypeError("OCCT candidate BREP changed ordered native structure");
  }
  if (
    stored.faces.length !== fresh.faces.length ||
    stored.edges.length !== fresh.edges.length ||
    stored.vertices.length !== fresh.vertices.length
  ) {
    throw new TypeError("OCCT candidate BREP changed indexed topology counts");
  }
  const storedIndices = snapshotIndices(stored);
  const freshIndices = snapshotIndices(fresh);
  for (let index = 0; index < stored.faces.length; index += 1) {
    const expected = stored.faces[index]!;
    const actual = fresh.faces[index]!;
    if (
      !exactNumber(expected.area, actual.area) ||
      !sameVector(expected.center, actual.center) ||
      !sameVector(expected.bounds.min, actual.bounds.min) ||
      !sameVector(expected.bounds.max, actual.bounds.max) ||
      !sameSurface(expected.surface, actual.surface) ||
      !sameIndices(
        sortedAdjacencyIndices(expected.edges, storedIndices.edges, "Stored face edges"),
        sortedAdjacencyIndices(actual.edges, freshIndices.edges, "Fresh face edges"),
      )
    ) {
      throw new TypeError(`OCCT candidate BREP changed indexed face ${index}`);
    }
  }
  for (let index = 0; index < stored.edges.length; index += 1) {
    const expected = stored.edges[index]!;
    const actual = fresh.edges[index]!;
    if (
      !exactNumber(expected.length, actual.length) ||
      !sameVector(expected.center, actual.center) ||
      !sameVector(expected.bounds.min, actual.bounds.min) ||
      !sameVector(expected.bounds.max, actual.bounds.max) ||
      !sameCurve(expected.curve, actual.curve) ||
      !sameIndices(
        sortedAdjacencyIndices(expected.faces, storedIndices.faces, "Stored edge faces"),
        sortedAdjacencyIndices(actual.faces, freshIndices.faces, "Fresh edge faces"),
      ) ||
      !sameIndices(
        sortedAdjacencyIndices(
          expected.vertices,
          storedIndices.vertices,
          "Stored edge vertices",
        ),
        sortedAdjacencyIndices(
          actual.vertices,
          freshIndices.vertices,
          "Fresh edge vertices",
        ),
      )
    ) {
      throw new TypeError(`OCCT candidate BREP changed indexed edge ${index}`);
    }
  }
  for (let index = 0; index < stored.vertices.length; index += 1) {
    const expected = stored.vertices[index]!;
    const actual = fresh.vertices[index]!;
    if (
      !sameVector(expected.point, actual.point) ||
      !sameIndices(
        sortedAdjacencyIndices(
          expected.edges,
          storedIndices.edges,
          "Stored vertex edges",
        ),
        sortedAdjacencyIndices(actual.edges, freshIndices.edges, "Fresh vertex edges"),
      )
    ) {
      throw new TypeError(`OCCT candidate BREP changed indexed vertex ${index}`);
    }
  }
  return deepFreeze({
    history: stored.history,
    faces: fresh.faces.map((face, index) => ({
      ...stored.faces[index]!,
      key: face.key,
      edges: face.edges,
    })),
    edges: fresh.edges.map((edge, index) => ({
      ...stored.edges[index]!,
      key: edge.key,
      faces: edge.faces,
      vertices: edge.vertices,
    })),
    vertices: fresh.vertices.map((vertex, index) => ({
      ...stored.vertices[index]!,
      key: vertex.key,
      edges: vertex.edges,
    })),
  }) as KernelTopologySnapshot;
}

function encodeEnvelope(
  host: OcctShapeArtifactCandidateHost,
  shape: KernelShape,
  context: KernelShapeArtifactContext,
): Uint8Array {
  const signal = capturedSignal(context);
  const maximum = artifactLimit(context);
  checkAbort(signal);
  const fingerprint = textEncoder.encode(host.compatibilityFingerprint);
  if (
    fingerprint.byteLength === 0 ||
    fingerprint.byteLength > MAX_FINGERPRINT_BYTES
  ) {
    throw new TypeError("OCCT candidate compatibility fingerprint is malformed");
  }
  const fixedMinimum = checkedLength(
    HEADER_BYTES,
    fingerprint.byteLength,
    "Artifact envelope",
  );
  if (checkedLength(fixedMinimum, 2, "Artifact envelope") > maximum) {
    throw new RangeError("OCCT candidate artifact exceeds maxArtifactBytes");
  }
  let captured: OcctShapeArtifactCapturedSidecarState;
  try {
    captured = host.capture(shape);
  } catch (error) {
    checkAbort(signal);
    throw error;
  }
  checkAbort(signal);
  const wire = encodeWireState(captured, signal);
  checkAbort(signal);
  const state = textEncoder.encode(canonicalStringifyProtocol(wire));
  if (state.byteLength === 0 || state.byteLength > MAX_STATE_BYTES) {
    throw new RangeError("OCCT candidate state section is empty or oversized");
  }
  const nativeBase = checkedLength(
    fixedMinimum,
    state.byteLength,
    "Artifact envelope",
  );
  if (checkedLength(nativeBase, 1, "Artifact envelope") > maximum) {
    throw new RangeError("OCCT candidate artifact exceeds maxArtifactBytes");
  }
  const nativeMaximum = maximum - nativeBase;
  let brep: Uint8Array;
  try {
    brep = host.encodeNative(shape, nativeMaximum);
  } catch (error) {
    checkAbort(signal);
    throw error;
  }
  checkAbort(signal);
  if (
    !(brep instanceof Uint8Array) ||
    brep.byteLength === 0 ||
    brep.byteLength > nativeMaximum
  ) {
    throw new TypeError("OCCT candidate host returned an invalid BREP payload");
  }
  const total = checkedLength(nativeBase, brep.byteLength, "Artifact envelope");
  checkAbort(signal);
  const output = new Uint8Array(total);
  output.set(MAGIC, 0);
  const header = new DataView(output.buffer, output.byteOffset, HEADER_BYTES);
  header.setUint16(16, ENVELOPE_VERSION, false);
  header.setUint16(18, 0, false);
  header.setUint32(20, HEADER_BYTES, false);
  header.setUint32(24, fingerprint.byteLength, false);
  header.setUint32(28, state.byteLength, false);
  header.setUint32(32, brep.byteLength, false);
  header.setUint32(36, total, false);
  let offset = HEADER_BYTES;
  output.set(fingerprint, offset);
  offset += fingerprint.byteLength;
  output.set(state, offset);
  offset += state.byteLength;
  output.set(brep, offset);
  checkAbort(signal);
  return output;
}

function decodeEnvelope(
  kernel: GeometryKernel,
  host: OcctShapeArtifactCandidateHost,
  artifact: Uint8Array,
  context: KernelShapeArtifactContext,
): KernelShape {
  const signal = capturedSignal(context);
  const maximum = artifactLimit(context);
  checkAbort(signal);
  if (!(artifact instanceof Uint8Array)) {
    throw new TypeError("OCCT candidate artifact must be a Uint8Array");
  }
  if (
    artifact.byteLength > maximum ||
    artifact.byteLength < HEADER_BYTES ||
    artifact.byteLength > MAX_UINT32
  ) {
    throw new RangeError("OCCT candidate artifact is empty, truncated, or oversized");
  }
  if (!bytesEqual(artifact.subarray(0, MAGIC.byteLength), MAGIC)) {
    throw new TypeError("OCCT candidate artifact magic is invalid");
  }
  const header = new DataView(
    artifact.buffer,
    artifact.byteOffset,
    HEADER_BYTES,
  );
  if (
    header.getUint16(16, false) !== ENVELOPE_VERSION ||
    header.getUint16(18, false) !== 0 ||
    header.getUint32(20, false) !== HEADER_BYTES
  ) {
    throw new TypeError("OCCT candidate artifact header is unsupported");
  }
  const fingerprintLength = header.getUint32(24, false);
  const stateLength = header.getUint32(28, false);
  const brepLength = header.getUint32(32, false);
  const declaredTotal = header.getUint32(36, false);
  let expectedTotal = checkedLength(
    HEADER_BYTES,
    fingerprintLength,
    "Artifact envelope",
  );
  expectedTotal = checkedLength(expectedTotal, stateLength, "Artifact envelope");
  expectedTotal = checkedLength(expectedTotal, brepLength, "Artifact envelope");
  if (
    fingerprintLength === 0 ||
    fingerprintLength > MAX_FINGERPRINT_BYTES ||
    stateLength === 0 ||
    stateLength > MAX_STATE_BYTES ||
    brepLength === 0 ||
    declaredTotal !== expectedTotal ||
    expectedTotal !== artifact.byteLength
  ) {
    throw new TypeError("OCCT candidate artifact lengths are invalid");
  }
  let offset = HEADER_BYTES;
  const fingerprintBytes = artifact.subarray(offset, offset + fingerprintLength);
  offset += fingerprintLength;
  let fingerprint: string;
  try {
    fingerprint = fatalTextDecoder.decode(fingerprintBytes);
  } catch {
    throw new TypeError("OCCT candidate artifact fingerprint is not UTF-8");
  }
  if (
    fingerprint !== host.compatibilityFingerprint ||
    !bytesEqual(textEncoder.encode(fingerprint), fingerprintBytes)
  ) {
    throw new TypeError("OCCT candidate compatibility fingerprint does not match");
  }
  const stateBytes = artifact.subarray(offset, offset + stateLength);
  offset += stateLength;
  let stateText: string;
  try {
    stateText = fatalTextDecoder.decode(stateBytes);
  } catch {
    throw new TypeError("OCCT candidate state is not UTF-8");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stateText) as unknown;
  } catch {
    throw new TypeError("OCCT candidate state is not valid JSON");
  }
  let canonical: Uint8Array;
  try {
    canonical = textEncoder.encode(canonicalStringifyProtocol(parsed));
  } catch {
    throw new TypeError("OCCT candidate state is not canonical JSON data");
  }
  if (!bytesEqual(canonical, stateBytes)) {
    throw new TypeError("OCCT candidate state JSON is not canonical");
  }
  checkAbort(signal);
  // The host receives a copy, never a view into the caller-owned artifact.
  const brep = artifact.slice(offset, offset + brepLength);
  const state = decodeWireState(parsed, brep, signal);
  checkAbort(signal);
  let restored: KernelShape | undefined;
  try {
    restored = host.restore(state);
    checkAbort(signal);
    const transferred = restored;
    restored = undefined;
    return transferred;
  } catch (error) {
    if (restored !== undefined) {
      try {
        kernel.disposeShape(restored);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "OCCT candidate decode and cleanup both failed",
        );
      }
    }
    throw error;
  }
}

function candidateHost(kernel: GeometryKernel): OcctShapeArtifactCandidateHost | undefined {
  try {
    if (
      kernel.id !== "occt" ||
      kernel.capabilities.shapeArtifacts !== undefined ||
      kernel.encodeShapeArtifact !== undefined ||
      kernel.decodeShapeArtifact !== undefined
    ) {
      return undefined;
    }
    const host: unknown = (
      kernel as GeometryKernel & {
        readonly [OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS]?: unknown;
      }
    )[OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS];
    if (
      typeof host !== "object" ||
      host === null ||
      typeof (host as Partial<OcctShapeArtifactCandidateHost>)
        .compatibilityFingerprint !== "string" ||
      typeof (host as Partial<OcctShapeArtifactCandidateHost>).capture !== "function" ||
      typeof (host as Partial<OcctShapeArtifactCandidateHost>).encodeNative !==
        "function" ||
      typeof (host as Partial<OcctShapeArtifactCandidateHost>).restore !== "function"
    ) {
      return undefined;
    }
    const fingerprint = (host as OcctShapeArtifactCandidateHost)
      .compatibilityFingerprint;
    const bytes = textEncoder.encode(fingerprint);
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_FINGERPRINT_BYTES
      ? (host as OcctShapeArtifactCandidateHost)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns a separate development codec without mutating or advertising the
 * production kernel capability. Invalid/absent hooks fail closed as undefined.
 */
export function getOcctShapeArtifactCodecCandidate(
  kernel: GeometryKernel,
): OcctShapeArtifactCodecCandidate | undefined {
  const host = candidateHost(kernel);
  if (host === undefined) return undefined;
  const capabilities: KernelShapeArtifactCapabilities = Object.freeze({
    protocolVersion: KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
    format: OCCT_SHAPE_ARTIFACT_CANDIDATE_FORMAT,
    formatVersion: OCCT_SHAPE_ARTIFACT_CANDIDATE_FORMAT_VERSION,
    compatibilityFingerprint: host.compatibilityFingerprint,
  });
  return Object.freeze({
    capabilities,
    encodeShapeArtifact: (
      shape: KernelShape,
      context: KernelShapeArtifactContext,
    ) =>
      encodeEnvelope(host, shape, context),
    decodeShapeArtifact: (
      artifact: Uint8Array,
      context: KernelShapeArtifactContext,
    ) =>
      decodeEnvelope(kernel, host, artifact, context),
  });
}
