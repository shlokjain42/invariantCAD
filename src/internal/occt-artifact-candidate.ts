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
import {
  compareOcctShapeArtifactNativePaths,
  decodeOcctArtifactNativeIdentityV1,
  encodeOcctArtifactNativeIdentityV1,
  OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES,
  OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_CHILD_INDEX,
  OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATH_DEPTH,
  type OcctShapeArtifactNativeIdentityCounts,
  type OcctShapeArtifactNativeIdentityV1,
  type OcctShapeArtifactNativeOccurrenceV1,
  type OcctShapeArtifactNativePath,
} from "./occt-artifact-identity-v1.js";

export const OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS = Symbol(
  "InvariantCAD.OcctShapeArtifactCandidateAccess",
);

export const OCCT_SHAPE_ARTIFACT_CANDIDATE_FORMAT =
  "org.invariantcad.occt-shape-candidate" as const;
export const OCCT_SHAPE_ARTIFACT_CANDIDATE_FORMAT_VERSION = 3 as const;

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

export interface OcctShapeArtifactCapturedCandidateState
  extends OcctShapeArtifactCapturedSidecarState {
  readonly nativeIdentity: OcctShapeArtifactNativeIdentityV1;
}

export interface OcctShapeArtifactCapturedState
  extends OcctShapeArtifactCapturedCandidateState {
  readonly brep: Uint8Array;
}

/** Native type and orientation evidence aligned with the identity path arrays. */
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
  capture(
    shape: KernelShape,
    signal?: AbortSignal,
  ): OcctShapeArtifactCapturedCandidateState;
  encodeNative(
    shape: KernelShape,
    maxBytes: number,
    signal?: AbortSignal,
  ): Uint8Array;
  restore(
    state: OcctShapeArtifactCapturedState,
    signal?: AbortSignal,
  ): KernelShape;
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

const ENVELOPE_VERSION = 3;
const HEADER_BYTES = 44;
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
const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
)?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const sharedArrayBufferByteLengthGetter =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
        SharedArrayBuffer.prototype,
        "byteLength",
      )?.get;

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

function isSharedArrayBuffer(value: ArrayBufferLike): boolean {
  if (sharedArrayBufferByteLengthGetter === undefined) return false;
  try {
    Reflect.apply(sharedArrayBufferByteLengthGetter, value, []);
    return true;
  } catch {
    return false;
  }
}

function snapshotArtifactInput(
  artifact: Uint8Array,
  maximum: number,
): Uint8Array {
  if (
    typedArrayBufferGetter === undefined ||
    typedArrayByteOffsetGetter === undefined ||
    typedArrayByteLengthGetter === undefined
  ) {
    throw new Error("Typed-array intrinsic accessors are unavailable");
  }
  let buffer: ArrayBufferLike;
  let byteOffset: number;
  let byteLength: number;
  try {
    buffer = Reflect.apply(typedArrayBufferGetter, artifact, []) as ArrayBufferLike;
    byteOffset = Reflect.apply(
      typedArrayByteOffsetGetter,
      artifact,
      [],
    ) as number;
    byteLength = Reflect.apply(
      typedArrayByteLengthGetter,
      artifact,
      [],
    ) as number;
  } catch {
    throw new TypeError("OCCT candidate artifact must be a Uint8Array");
  }
  if (isSharedArrayBuffer(buffer)) {
    throw new TypeError(
      "OCCT candidate artifact must not use a SharedArrayBuffer",
    );
  }
  if (
    byteLength > maximum ||
    byteLength < HEADER_BYTES ||
    byteLength > MAX_UINT32
  ) {
    throw new RangeError("OCCT candidate artifact is empty, truncated, or oversized");
  }
  const output = new Uint8Array(byteLength);
  output.set(new Uint8Array(buffer, byteOffset, byteLength));
  return output;
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
  signal?: AbortSignal,
): readonly number[] {
  const output: number[] = [];
  for (let item = 0; item < keys.length; item += 1) {
    if ((item & 0x3ff) === 0) checkAbort(signal);
    const index = indices.get(keys[item]!);
    if (index === undefined) {
      throw new TypeError(`${label} references topology outside its snapshot`);
    }
    output.push(index);
  }
  output.sort((first, second) => first - second);
  checkAbort(signal);
  return Object.freeze(output);
}

function topologyIndex(
  keys: readonly KernelTopologyKey[],
  label: string,
  signal?: AbortSignal,
): ReadonlyMap<KernelTopologyKey, number> {
  const result = new Map<KernelTopologyKey, number>();
  keys.forEach((key, index) => {
    if ((index & 0x3ff) === 0) checkAbort(signal);
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
  signal?: AbortSignal,
): readonly number[] {
  return keyIndices(keys, indices, label, signal);
}

function sameIndices(first: readonly number[], second: readonly number[]): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

const NATIVE_IDENTITY_FIELDS = Object.freeze([
  ["solidPaths", "solidOrientations", "solid"],
  ["shellPaths", "shellOrientations", "shell"],
  ["wirePaths", "wireOrientations", "wire"],
  ["facePaths", "faceOrientations", "face"],
  ["edgePaths", "edgeOrientations", "edge"],
  ["vertexPaths", "vertexOrientations", "vertex"],
] as const);
type NativeIdentityKind = (typeof NATIVE_IDENTITY_FIELDS)[number][2];
type NativeIdentityMappings = Readonly<
  Record<NativeIdentityKind, readonly number[]>
>;

function canonicalNativePermutation(
  rawPaths: unknown,
  label: string,
  signal?: AbortSignal,
): {
  readonly paths: readonly OcctShapeArtifactNativePath[];
  readonly permutation: readonly number[];
} {
  if (!Array.isArray(rawPaths)) {
    throw new TypeError(`OCCT candidate ${label} identity paths must be an array`);
  }
  const entries: {
    readonly path: OcctShapeArtifactNativePath;
    readonly index: number;
  }[] = [];
  for (let index = 0; index < rawPaths.length; index += 1) {
    if ((index & 0x3ff) === 0) checkAbort(signal);
    if (!Object.hasOwn(rawPaths, index)) {
      throw new TypeError(
        `OCCT candidate ${label} identity paths must not be sparse`,
      );
    }
    const rawPath: unknown = rawPaths[index];
    if (
      !Array.isArray(rawPath) ||
      rawPath.length > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATH_DEPTH
    ) {
      throw new TypeError(`OCCT candidate ${label} identity path is malformed`);
    }
    const path = rawPath.map((component) => {
      if (
        typeof component !== "number" ||
        !Number.isSafeInteger(component) ||
        component < 0 ||
        component > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_CHILD_INDEX
      ) {
        throw new TypeError(
          `OCCT candidate ${label} identity path component is malformed`,
        );
      }
      return component;
    });
    entries.push({ path: Object.freeze(path), index });
  }
  checkAbort(signal);
  entries.sort((first, second) =>
    compareOcctShapeArtifactNativePaths(first.path, second.path),
  );
  checkAbort(signal);
  if (
    entries.some(
      (entry, index) =>
        index > 0 &&
        compareOcctShapeArtifactNativePaths(
          entries[index - 1]!.path,
          entry.path,
        ) === 0,
    )
  ) {
    throw new TypeError(`OCCT candidate ${label} identity paths are duplicated`);
  }
  return Object.freeze({
    paths: Object.freeze(entries.map((entry) => entry.path)),
    permutation: Object.freeze(entries.map((entry) => entry.index)),
  });
}

function permuteNativeValues<T>(
  rawValues: unknown,
  permutation: readonly number[],
  label: string,
  signal?: AbortSignal,
): readonly T[] {
  if (!Array.isArray(rawValues) || rawValues.length !== permutation.length) {
    throw new TypeError(`OCCT candidate ${label} values do not match identity paths`);
  }
  const output: T[] = [];
  for (let index = 0; index < permutation.length; index += 1) {
    if ((index & 0x3ff) === 0) checkAbort(signal);
    const sourceIndex = permutation[index]!;
    if (!Object.hasOwn(rawValues, sourceIndex)) {
      throw new TypeError(`OCCT candidate ${label} values must not be sparse`);
    }
    output.push(rawValues[sourceIndex] as T);
  }
  return Object.freeze(output);
}

function inverseNativePermutation(
  permutation: readonly number[],
  label: string,
  signal?: AbortSignal,
): readonly number[] {
  const inverse: (number | undefined)[] = Array.from({
    length: permutation.length,
  });
  permutation.forEach((rawIndex, canonicalIndex) => {
    if ((canonicalIndex & 0x3ff) === 0) checkAbort(signal);
    if (
      !Number.isSafeInteger(rawIndex) ||
      rawIndex < 0 ||
      rawIndex >= permutation.length ||
      inverse[rawIndex] !== undefined
    ) {
      throw new TypeError(`OCCT candidate ${label} permutation is malformed`);
    }
    inverse[rawIndex] = canonicalIndex;
  });
  if (inverse.some((value) => value === undefined)) {
    throw new TypeError(`OCCT candidate ${label} permutation is incomplete`);
  }
  return Object.freeze(inverse as number[]);
}

function canonicalizeNativeOccurrences(
  raw: unknown,
  permutations: Readonly<Record<
    "solid" | "shell" | "wire" | "face" | "edge" | "vertex",
    readonly number[]
  >>,
  signal?: AbortSignal,
): readonly OcctShapeArtifactNativeOccurrenceV1[] {
  if (!Array.isArray(raw)) {
    throw new TypeError("OCCT candidate native occurrences must be an array");
  }
  const output: OcctShapeArtifactNativeOccurrenceV1[] = [];
  for (
    let occurrenceIndex = 0;
    occurrenceIndex < raw.length;
    occurrenceIndex += 1
  ) {
    if ((occurrenceIndex & 0x3ff) === 0) checkAbort(signal);
    if (!Object.hasOwn(raw, occurrenceIndex)) {
      throw new TypeError("OCCT candidate native occurrences must not be sparse");
    }
    const value: unknown = raw[occurrenceIndex];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError(
        `OCCT candidate native occurrence ${occurrenceIndex} is malformed`,
      );
    }
    const occurrence =
      value as unknown as OcctShapeArtifactNativeOccurrenceV1;
    const permutation =
      permutations[occurrence.shapeType as keyof typeof permutations];
    if (permutation === undefined) {
      output.push(
        Object.freeze({
          shapeType: occurrence.shapeType,
          orientation: occurrence.orientation,
          childCount: occurrence.childCount,
          identityIndex: occurrence.identityIndex,
        }),
      );
      continue;
    }
    const rawIndex = occurrence.identityIndex;
    if (
      typeof rawIndex !== "number" ||
      !Number.isSafeInteger(rawIndex) ||
      rawIndex < 0 ||
      rawIndex >= permutation.length
    ) {
      throw new TypeError(
        `OCCT candidate native occurrence ${occurrenceIndex} class index is malformed`,
      );
    }
    output.push(
      Object.freeze({
        shapeType: occurrence.shapeType,
        orientation: occurrence.orientation,
        childCount: occurrence.childCount,
        identityIndex: permutation[rawIndex]!,
      }),
    );
  }
  return Object.freeze(output);
}

/**
 * Removes producer TopExp enumeration order from candidate bytes. Native paths
 * are the ordering authority; topology records, incidence indices, and
 * orientation evidence are emitted in that same strict path order.
 */
export function canonicalizeOcctShapeArtifactCapturedCandidateState(
  raw: OcctShapeArtifactCapturedCandidateState,
  signal?: AbortSignal,
): OcctShapeArtifactCapturedCandidateState {
  checkAbort(signal);
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.nativeIdentity !== "object" ||
    raw.nativeIdentity === null ||
    typeof raw.nativeStructure !== "object" ||
    raw.nativeStructure === null ||
    typeof raw.topology !== "object" ||
    raw.topology === null
  ) {
    throw new TypeError("OCCT candidate captured state is malformed");
  }
  const solids = canonicalNativePermutation(
    raw.nativeIdentity.solidPaths,
    "solid",
    signal,
  );
  const shells = canonicalNativePermutation(
    raw.nativeIdentity.shellPaths,
    "shell",
    signal,
  );
  const wires = canonicalNativePermutation(
    raw.nativeIdentity.wirePaths,
    "wire",
    signal,
  );
  const faces = canonicalNativePermutation(
    raw.nativeIdentity.facePaths,
    "face",
    signal,
  );
  const edges = canonicalNativePermutation(
    raw.nativeIdentity.edgePaths,
    "edge",
    signal,
  );
  const vertices = canonicalNativePermutation(
    raw.nativeIdentity.vertexPaths,
    "vertex",
    signal,
  );
  const occurrencePermutations = Object.freeze({
    solid: inverseNativePermutation(solids.permutation, "solid", signal),
    shell: inverseNativePermutation(shells.permutation, "shell", signal),
    wire: inverseNativePermutation(wires.permutation, "wire", signal),
    face: inverseNativePermutation(faces.permutation, "face", signal),
    edge: inverseNativePermutation(edges.permutation, "edge", signal),
    vertex: inverseNativePermutation(vertices.permutation, "vertex", signal),
  });
  const nativeIdentity: OcctShapeArtifactNativeIdentityV1 = Object.freeze({
    solidPaths: solids.paths,
    shellPaths: shells.paths,
    wirePaths: wires.paths,
    facePaths: faces.paths,
    edgePaths: edges.paths,
    vertexPaths: vertices.paths,
    occurrences: canonicalizeNativeOccurrences(
      raw.nativeIdentity.occurrences,
      occurrencePermutations,
      signal,
    ),
  });
  const nativeStructure: OcctShapeArtifactNativeStructure = Object.freeze({
    rootType: raw.nativeStructure.rootType,
    rootOrientation: raw.nativeStructure.rootOrientation,
    solidOrientations: permuteNativeValues<ShapeOrientation>(
      raw.nativeStructure.solidOrientations,
      solids.permutation,
      "solid orientation",
      signal,
    ),
    shellOrientations: permuteNativeValues<ShapeOrientation>(
      raw.nativeStructure.shellOrientations,
      shells.permutation,
      "shell orientation",
      signal,
    ),
    wireOrientations: permuteNativeValues<ShapeOrientation>(
      raw.nativeStructure.wireOrientations,
      wires.permutation,
      "wire orientation",
      signal,
    ),
    faceOrientations: permuteNativeValues<ShapeOrientation>(
      raw.nativeStructure.faceOrientations,
      faces.permutation,
      "face orientation",
      signal,
    ),
    edgeOrientations: permuteNativeValues<ShapeOrientation>(
      raw.nativeStructure.edgeOrientations,
      edges.permutation,
      "edge orientation",
      signal,
    ),
    vertexOrientations: permuteNativeValues<ShapeOrientation>(
      raw.nativeStructure.vertexOrientations,
      vertices.permutation,
      "vertex orientation",
      signal,
    ),
  });
  const topology: KernelTopologySnapshot = Object.freeze({
    history: raw.topology.history,
    faces: permuteNativeValues<KernelTopologySnapshot["faces"][number]>(
      raw.topology.faces,
      faces.permutation,
      "face topology",
      signal,
    ),
    edges: permuteNativeValues<KernelTopologySnapshot["edges"][number]>(
      raw.topology.edges,
      edges.permutation,
      "edge topology",
      signal,
    ),
    vertices: permuteNativeValues<KernelTopologySnapshot["vertices"][number]>(
      raw.topology.vertices,
      vertices.permutation,
      "vertex topology",
      signal,
    ),
  });
  return Object.freeze({
    lineage: raw.lineage,
    history: raw.history,
    topology,
    nativeStructure,
    nativeIdentity,
    ...(raw.volumeOverride === undefined
      ? {}
      : { volumeOverride: raw.volumeOverride }),
  });
}

function nativeIdentityCounts(
  structure: OcctShapeArtifactNativeStructure,
): OcctShapeArtifactNativeIdentityCounts {
  return Object.freeze({
    solids: structure.solidOrientations.length,
    shells: structure.shellOrientations.length,
    wires: structure.wireOrientations.length,
    faces: structure.faceOrientations.length,
    edges: structure.edgeOrientations.length,
    vertices: structure.vertexOrientations.length,
  });
}

function nativePathKey(path: OcctShapeArtifactNativePath): string {
  return path.join("/");
}

function nativeIndexMapping(
  stored: readonly OcctShapeArtifactNativePath[],
  fresh: readonly OcctShapeArtifactNativePath[],
  label: string,
  signal?: AbortSignal,
): readonly number[] {
  if (stored.length !== fresh.length) {
    throw new TypeError(`OCCT candidate BREP changed ${label} identity count`);
  }
  const freshIndices = new Map<string, number>();
  fresh.forEach((path, index) => {
    if ((index & 0x3ff) === 0) checkAbort(signal);
    const key = nativePathKey(path);
    if (freshIndices.has(key)) {
      throw new TypeError(`OCCT candidate BREP duplicated a ${label} identity path`);
    }
    freshIndices.set(key, index);
  });
  const seen = new Set<number>();
  const mapping = stored.map((path, storedIndex) => {
    if ((storedIndex & 0x3ff) === 0) checkAbort(signal);
    const index = freshIndices.get(nativePathKey(path));
    if (index === undefined || seen.has(index)) {
      throw new TypeError(`OCCT candidate BREP changed ${label} identity paths`);
    }
    seen.add(index);
    return index;
  });
  return Object.freeze(mapping);
}

function occurrenceClassPath(
  identity: OcctShapeArtifactNativeIdentityV1,
  occurrence: OcctShapeArtifactNativeOccurrenceV1,
): OcctShapeArtifactNativePath | null | undefined {
  const index = occurrence.identityIndex;
  if (index === null) return null;
  switch (occurrence.shapeType) {
    case "solid":
      return identity.solidPaths[index];
    case "shell":
      return identity.shellPaths[index];
    case "wire":
      return identity.wirePaths[index];
    case "face":
      return identity.facePaths[index];
    case "edge":
      return identity.edgePaths[index];
    case "vertex":
      return identity.vertexPaths[index];
    default:
      return undefined;
  }
}

function assertSameOccurrenceManifest(
  stored: OcctShapeArtifactNativeIdentityV1,
  fresh: OcctShapeArtifactNativeIdentityV1,
  signal?: AbortSignal,
): void {
  if (stored.occurrences.length !== fresh.occurrences.length) {
    throw new TypeError(
      "OCCT candidate BREP changed native occurrence multiplicity",
    );
  }
  for (let index = 0; index < stored.occurrences.length; index += 1) {
    if ((index & 0x3ff) === 0) checkAbort(signal);
    const expected = stored.occurrences[index]!;
    const actual = fresh.occurrences[index]!;
    const expectedClass = occurrenceClassPath(stored, expected);
    const actualClass = occurrenceClassPath(fresh, actual);
    if (
      expected.shapeType !== actual.shapeType ||
      expected.orientation !== actual.orientation ||
      expected.childCount !== actual.childCount ||
      expectedClass === undefined ||
      actualClass === undefined ||
      (expectedClass === null) !== (actualClass === null) ||
      (expectedClass !== null &&
        actualClass !== null &&
        compareOcctShapeArtifactNativePaths(expectedClass, actualClass) !== 0)
    ) {
      throw new TypeError(
        `OCCT candidate BREP changed native occurrence ${index}`,
      );
    }
  }
}

function assertSameNativeStructure(
  storedStructure: OcctShapeArtifactNativeStructure,
  freshStructure: OcctShapeArtifactNativeStructure,
  storedIdentity: OcctShapeArtifactNativeIdentityV1,
  freshIdentity: OcctShapeArtifactNativeIdentityV1,
  signal?: AbortSignal,
): NativeIdentityMappings {
  if (
    storedStructure.rootType !== freshStructure.rootType ||
    storedStructure.rootOrientation !== freshStructure.rootOrientation
  ) {
    throw new TypeError("OCCT candidate BREP changed root type or orientation");
  }
  assertSameOccurrenceManifest(storedIdentity, freshIdentity, signal);
  const mappings: Partial<Record<NativeIdentityKind, readonly number[]>> = {};
  for (const [pathField, orientationField, label] of NATIVE_IDENTITY_FIELDS) {
    const mapping = nativeIndexMapping(
      storedIdentity[pathField],
      freshIdentity[pathField],
      label,
      signal,
    );
    const storedOrientations = storedStructure[orientationField];
    const freshOrientations = freshStructure[orientationField];
    if (
      storedOrientations.length !== mapping.length ||
      freshOrientations.length !== mapping.length ||
      storedOrientations.some(
        (orientation, index) =>
          orientation !== freshOrientations[mapping[index]!],
      )
    ) {
      throw new TypeError(
        `OCCT candidate BREP changed ${label} identity orientation`,
      );
    }
    mappings[label] = mapping;
  }
  return Object.freeze(mappings) as NativeIdentityMappings;
}

function snapshotIndices(
  snapshot: KernelTopologySnapshot,
  signal?: AbortSignal,
): {
  readonly faces: ReadonlyMap<KernelTopologyKey, number>;
  readonly edges: ReadonlyMap<KernelTopologyKey, number>;
  readonly vertices: ReadonlyMap<KernelTopologyKey, number>;
} {
  return {
    faces: topologyIndex(
      snapshot.faces.map((face) => face.key),
      "Topology faces",
      signal,
    ),
    edges: topologyIndex(
      snapshot.edges.map((edge) => edge.key),
      "Topology edges",
      signal,
    ),
    vertices: topologyIndex(
      snapshot.vertices.map((vertex) => vertex.key),
      "Topology vertices",
      signal,
    ),
  };
}

function mappedIndices(
  keys: readonly KernelTopologyKey[],
  indices: ReadonlyMap<KernelTopologyKey, number>,
  mapping: readonly number[],
  label: string,
  signal?: AbortSignal,
): readonly number[] {
  return Object.freeze(
    keyIndices(keys, indices, label, signal)
      .map((index) => mapping[index]!)
      .sort((first, second) => first - second),
  );
}

function inverseMapping(
  mapping: readonly number[],
  label: string,
  signal?: AbortSignal,
): readonly number[] {
  const inverse: (number | undefined)[] = Array.from({
    length: mapping.length,
  });
  mapping.forEach((freshIndex, storedIndex) => {
    if ((storedIndex & 0x3ff) === 0) checkAbort(signal);
    if (
      freshIndex < 0 ||
      freshIndex >= mapping.length ||
      inverse[freshIndex] !== undefined
    ) {
      throw new TypeError(`OCCT candidate ${label} identity mapping is invalid`);
    }
    inverse[freshIndex] = storedIndex;
  });
  if (inverse.some((value) => value === undefined)) {
    throw new TypeError(`OCCT candidate ${label} identity mapping is incomplete`);
  }
  return Object.freeze(inverse as number[]);
}

/**
 * Matches source and restored topology through serialized child-occurrence
 * paths, verifies exact geometry/incidence/orientation, and only then restores
 * semantic lineage/history onto fresh evaluation-scoped keys.
 */
export function remapOcctShapeArtifactTopology(
  storedSnapshot: KernelTopologySnapshot,
  freshRootSnapshot: KernelTopologySnapshot,
  storedNativeStructure: OcctShapeArtifactNativeStructure,
  freshNativeStructure: OcctShapeArtifactNativeStructure,
  storedNativeIdentity: OcctShapeArtifactNativeIdentityV1,
  freshNativeIdentity: OcctShapeArtifactNativeIdentityV1,
  signal?: AbortSignal,
): KernelTopologySnapshot {
  checkAbort(signal);
  const limits = {
    maxTopologyItems: MAX_TOPOLOGY_ITEMS,
    maxAdjacencyLinks: MAX_ADJACENCY_LINKS,
    maxEvidenceRecords: MAX_LINEAGE_RECORDS,
    maxStringBytes: MAX_STRING_BYTES,
  } as const;
  const stored = detachKernelTopologySnapshot(storedSnapshot, limits);
  checkAbort(signal);
  const fresh = detachKernelTopologySnapshot(freshRootSnapshot, limits);
  checkAbort(signal);
  const nativeMappings = assertSameNativeStructure(
    storedNativeStructure,
    freshNativeStructure,
    storedNativeIdentity,
    freshNativeIdentity,
    signal,
  );
  if (
    stored.faces.length !== fresh.faces.length ||
    stored.edges.length !== fresh.edges.length ||
    stored.vertices.length !== fresh.vertices.length
  ) {
    throw new TypeError("OCCT candidate BREP changed indexed topology counts");
  }
  const storedIndices = snapshotIndices(stored, signal);
  const freshIndices = snapshotIndices(fresh, signal);
  const faceMapping = nativeMappings.face;
  const edgeMapping = nativeMappings.edge;
  const vertexMapping = nativeMappings.vertex;
  for (let index = 0; index < stored.faces.length; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    const expected = stored.faces[index]!;
    const actual = fresh.faces[faceMapping[index]!]!;
    if (
      !exactNumber(expected.area, actual.area) ||
      !sameVector(expected.center, actual.center) ||
      !sameVector(expected.bounds.min, actual.bounds.min) ||
      !sameVector(expected.bounds.max, actual.bounds.max) ||
      !sameSurface(expected.surface, actual.surface) ||
      !sameIndices(
        mappedIndices(
          expected.edges,
          storedIndices.edges,
          edgeMapping,
          "Stored face edges",
          signal,
        ),
        sortedAdjacencyIndices(
          actual.edges,
          freshIndices.edges,
          "Fresh face edges",
          signal,
        ),
      )
    ) {
      throw new TypeError(`OCCT candidate BREP changed identified face ${index}`);
    }
  }
  for (let index = 0; index < stored.edges.length; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    const expected = stored.edges[index]!;
    const actual = fresh.edges[edgeMapping[index]!]!;
    if (
      !exactNumber(expected.length, actual.length) ||
      !sameVector(expected.center, actual.center) ||
      !sameVector(expected.bounds.min, actual.bounds.min) ||
      !sameVector(expected.bounds.max, actual.bounds.max) ||
      !sameCurve(expected.curve, actual.curve) ||
      !sameIndices(
        mappedIndices(
          expected.faces,
          storedIndices.faces,
          faceMapping,
          "Stored edge faces",
          signal,
        ),
        sortedAdjacencyIndices(
          actual.faces,
          freshIndices.faces,
          "Fresh edge faces",
          signal,
        ),
      ) ||
      !sameIndices(
        mappedIndices(
          expected.vertices,
          storedIndices.vertices,
          vertexMapping,
          "Stored edge vertices",
          signal,
        ),
        sortedAdjacencyIndices(
          actual.vertices,
          freshIndices.vertices,
          "Fresh edge vertices",
          signal,
        ),
      )
    ) {
      throw new TypeError(`OCCT candidate BREP changed identified edge ${index}`);
    }
  }
  for (let index = 0; index < stored.vertices.length; index += 1) {
    if ((index & 0xff) === 0) checkAbort(signal);
    const expected = stored.vertices[index]!;
    const actual = fresh.vertices[vertexMapping[index]!]!;
    if (
      !sameVector(expected.point, actual.point) ||
      !sameIndices(
        mappedIndices(
          expected.edges,
          storedIndices.edges,
          edgeMapping,
          "Stored vertex edges",
          signal,
        ),
        sortedAdjacencyIndices(
          actual.edges,
          freshIndices.edges,
          "Fresh vertex edges",
          signal,
        ),
      )
    ) {
      throw new TypeError(`OCCT candidate BREP changed identified vertex ${index}`);
    }
  }
  const storedFaceByFresh = inverseMapping(faceMapping, "face", signal);
  const storedEdgeByFresh = inverseMapping(edgeMapping, "edge", signal);
  const storedVertexByFresh = inverseMapping(vertexMapping, "vertex", signal);
  checkAbort(signal);
  return deepFreeze({
    history: stored.history,
    faces: fresh.faces.map((face, freshIndex) => ({
      ...stored.faces[storedFaceByFresh[freshIndex]!]!,
      key: face.key,
      edges: face.edges,
    })),
    edges: fresh.edges.map((edge, freshIndex) => ({
      ...stored.edges[storedEdgeByFresh[freshIndex]!]!,
      key: edge.key,
      faces: edge.faces,
      vertices: edge.vertices,
    })),
    vertices: fresh.vertices.map((vertex, freshIndex) => ({
      ...stored.vertices[storedVertexByFresh[freshIndex]!]!,
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
      OCCT_ARTIFACT_SIDECAR_V2_MIN_BYTES +
        OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES +
        1,
      "Artifact envelope",
    ) > maximum
  ) {
    throw new RangeError("OCCT candidate artifact exceeds maxArtifactBytes");
  }
  let captured: OcctShapeArtifactCapturedCandidateState;
  try {
    captured = canonicalizeOcctShapeArtifactCapturedCandidateState(
      host.capture(shape, signal),
      signal,
    );
  } catch (error) {
    checkAbort(signal);
    throw error;
  }
  checkAbort(signal);
  const stateMaximum = Math.min(
    MAX_STATE_BYTES,
    maximum -
      fixedMinimum -
      OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES -
      1,
  );
  const state = encodeOcctArtifactSidecarV2(captured, {
    maxBytes: stateMaximum,
    ...(signal === undefined ? {} : { signal }),
  });
  if (state.byteLength === 0 || state.byteLength > MAX_STATE_BYTES) {
    throw new RangeError("OCCT candidate state section is empty or oversized");
  }
  const identityBase = checkedLength(
    fixedMinimum,
    state.byteLength,
    "Artifact envelope",
  );
  const identityMaximum = maximum - identityBase - 1;
  const identity = encodeOcctArtifactNativeIdentityV1(
    captured.nativeIdentity,
    {
      maxBytes: identityMaximum,
      ...(signal === undefined ? {} : { signal }),
    },
    nativeIdentityCounts(captured.nativeStructure),
  );
  const nativeBase = checkedLength(
    identityBase,
    identity.byteLength,
    "Artifact envelope",
  );
  if (checkedLength(nativeBase, 1, "Artifact envelope") > maximum) {
    throw new RangeError("OCCT candidate artifact exceeds maxArtifactBytes");
  }
  const nativeMaximum = maximum - nativeBase;
  let brep: Uint8Array;
  try {
    brep = host.encodeNative(shape, nativeMaximum, signal);
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
  header.setUint32(32, identity.byteLength, false);
  header.setUint32(36, brep.byteLength, false);
  header.setUint32(40, total, false);
  let offset = HEADER_BYTES;
  output.set(fingerprint, offset);
  offset += fingerprint.byteLength;
  output.set(state, offset);
  offset += state.byteLength;
  output.set(identity, offset);
  offset += identity.byteLength;
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
  const input = snapshotArtifactInput(artifact, maximum);
  if (!bytesEqual(input.subarray(0, MAGIC.byteLength), MAGIC)) {
    throw new TypeError("OCCT candidate artifact magic is invalid");
  }
  const header = new DataView(
    input.buffer,
    input.byteOffset,
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
  const identityLength = header.getUint32(32, false);
  const brepLength = header.getUint32(36, false);
  const declaredTotal = header.getUint32(40, false);
  let expectedTotal = checkedLength(
    HEADER_BYTES,
    fingerprintLength,
    "Artifact envelope",
  );
  expectedTotal = checkedLength(expectedTotal, stateLength, "Artifact envelope");
  expectedTotal = checkedLength(
    expectedTotal,
    identityLength,
    "Artifact envelope",
  );
  expectedTotal = checkedLength(expectedTotal, brepLength, "Artifact envelope");
  if (
    fingerprintLength === 0 ||
    fingerprintLength > MAX_FINGERPRINT_BYTES ||
    stateLength === 0 ||
    stateLength > MAX_STATE_BYTES ||
    identityLength < OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES ||
    brepLength === 0 ||
    declaredTotal !== expectedTotal ||
    expectedTotal !== input.byteLength
  ) {
    throw new TypeError("OCCT candidate artifact lengths are invalid");
  }
  let offset = HEADER_BYTES;
  const fingerprintBytes = input.subarray(offset, offset + fingerprintLength);
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
  const stateBytes = input.subarray(offset, offset + stateLength);
  offset += stateLength;
  checkAbort(signal);
  const sidecar = decodeOcctArtifactSidecarV2(stateBytes, {
    ...(signal === undefined ? {} : { signal }),
  });
  const identityBytes = input.subarray(offset, offset + identityLength);
  offset += identityLength;
  const nativeIdentity = decodeOcctArtifactNativeIdentityV1(
    identityBytes,
    nativeIdentityCounts(sidecar.nativeStructure),
    {
      maxBytes: identityLength,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  checkAbort(signal);
  // The host receives a copy from the plain entry snapshot, never a view into
  // the caller-owned or attacker-overridable typed array.
  const brep = input.slice(offset, offset + brepLength);
  const state: OcctShapeArtifactCapturedState = Object.freeze({
    ...sidecar,
    nativeIdentity,
    brep,
  });
  checkAbort(signal);
  let restored: KernelShape | undefined;
  try {
    restored = host.restore(state, signal);
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
