import { deepFreeze } from "../core/json.js";
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
  KernelSurfaceDescriptor,
  KernelTopologyKey,
  KernelTopologyLineage,
  KernelTopologySnapshot,
} from "../protocol/topology.js";
import {
  decodeOcctArtifactSidecarV2,
  encodeOcctArtifactSidecarV2,
  OCCT_ARTIFACT_SIDECAR_V2_MIN_BYTES,
} from "./occt-artifact-sidecar-v2.js";

export const OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS = Symbol(
  "InvariantCAD.OcctShapeArtifactCandidateAccess",
);

export const OCCT_SHAPE_ARTIFACT_CANDIDATE_FORMAT =
  "org.invariantcad.occt-shape-candidate" as const;
export const OCCT_SHAPE_ARTIFACT_CANDIDATE_FORMAT_VERSION = 2 as const;

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

const ENVELOPE_VERSION = 2;
const HEADER_BYTES = 40;
const MAX_UINT32 = 0xffff_ffff;
const MAX_FINGERPRINT_BYTES = 2_048;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const MAX_TOPOLOGY_ITEMS = 100_000;
const MAX_ADJACENCY_LINKS = 1_000_000;
const MAX_LINEAGE_RECORDS = 1_000_000;
const MAX_STRING_BYTES = 1_000_000;
const MAGIC = new Uint8Array([
  0x49, 0x43, 0x41, 0x44, 0x4f, 0x43, 0x43, 0x54,
  0x41, 0x52, 0x54, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder("utf-8", { fatal: true });

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

function checkedLength(total: number, addition: number, label: string): number {
  const next = total + addition;
  if (!Number.isSafeInteger(next) || next > MAX_UINT32) {
    throw new RangeError(`${label} exceeds the candidate envelope limit`);
  }
  return next;
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
  if (
    checkedLength(
      fixedMinimum,
      OCCT_ARTIFACT_SIDECAR_V2_MIN_BYTES + 1,
      "Artifact envelope",
    ) > maximum
  ) {
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
  const stateMaximum = Math.min(MAX_STATE_BYTES, maximum - fixedMinimum - 1);
  const state = encodeOcctArtifactSidecarV2(captured, {
    maxBytes: stateMaximum,
    ...(signal === undefined ? {} : { signal }),
  });
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
  checkAbort(signal);
  const sidecar = decodeOcctArtifactSidecarV2(stateBytes, {
    ...(signal === undefined ? {} : { signal }),
  });
  checkAbort(signal);
  // The host receives a copy, never a view into the caller-owned artifact.
  const brep = artifact.slice(offset, offset + brepLength);
  const state: OcctShapeArtifactCapturedState = Object.freeze({
    ...sidecar,
    brep,
  });
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
