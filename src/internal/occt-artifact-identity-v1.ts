import type { ShapeOrientation, ShapeType } from "occt-wasm";

export const OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES = 64;
export const OCCT_ARTIFACT_NATIVE_IDENTITY_V1_OCCURRENCE_BYTES = 12;
export const OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATHS = 100_000;
export const OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATH_COMPONENTS = 1_000_000;
export const OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATH_DEPTH = 64;
export const OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_CHILD_INDEX = 999_999;
export const OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_OCCURRENCES = 100_000;

const FORMAT_VERSION = 1;
const UNINDEXED_OCCURRENCE = 0xffff_ffff;
const MAGIC = new Uint8Array([
  0x49, 0x43, 0x41, 0x44, 0x4f, 0x43, 0x43, 0x54,
  0x49, 0x44, 0x45, 0x4e, 0x54, 0x00, 0x00, 0x00,
]);
const SHAPE_TYPES = Object.freeze([
  "compound",
  "compsolid",
  "solid",
  "shell",
  "face",
  "wire",
  "edge",
  "vertex",
  "shape",
] as const satisfies readonly ShapeType[]);
const SHAPE_ORIENTATIONS = Object.freeze([
  "forward",
  "reversed",
  "internal",
  "external",
] as const satisfies readonly ShapeOrientation[]);

export type OcctShapeArtifactNativePath = readonly number[];

/**
 * One node in the complete rooted, direct-child, pre-order occurrence stream.
 *
 * `identityIndex` names the unique located IsSame class for the six indexed
 * topology kinds. Compound, compsolid, and generic-shape nodes use `null`;
 * their exact ordered structure, type, orientation, and multiplicity are still
 * preserved by this stream.
 */
export interface OcctShapeArtifactNativeOccurrenceV1 {
  readonly shapeType: ShapeType;
  readonly orientation: ShapeOrientation;
  readonly childCount: number;
  readonly identityIndex: number | null;
}

/**
 * Artifact-local coordinates for OCCT's unique located native subshapes plus
 * the complete serialized occurrence hierarchy.
 *
 * Every unique-class path is the zero-based child-index sequence of its first
 * IsSame occurrence in a pre-order walk. The occurrence stream prevents a
 * repeated or omitted use of the same class from disappearing behind the
 * unique TopExp quotient.
 */
export interface OcctShapeArtifactNativeIdentityV1 {
  readonly solidPaths: readonly OcctShapeArtifactNativePath[];
  readonly shellPaths: readonly OcctShapeArtifactNativePath[];
  readonly wirePaths: readonly OcctShapeArtifactNativePath[];
  readonly facePaths: readonly OcctShapeArtifactNativePath[];
  readonly edgePaths: readonly OcctShapeArtifactNativePath[];
  readonly vertexPaths: readonly OcctShapeArtifactNativePath[];
  readonly occurrences: readonly OcctShapeArtifactNativeOccurrenceV1[];
}

export interface OcctShapeArtifactNativeIdentityCounts {
  readonly solids: number;
  readonly shells: number;
  readonly wires: number;
  readonly faces: number;
  readonly edges: number;
  readonly vertices: number;
}

export interface OcctShapeArtifactNativeIdentityCodecOptions {
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

export function compareOcctShapeArtifactNativePaths(
  first: OcctShapeArtifactNativePath,
  second: OcctShapeArtifactNativePath,
): number {
  const common = Math.min(first.length, second.length);
  for (let index = 0; index < common; index += 1) {
    const difference = first[index]! - second[index]!;
    if (difference !== 0) return difference;
  }
  return first.length - second.length;
}

const PATH_FIELDS = Object.freeze([
  ["solidPaths", "solids", "solid"],
  ["shellPaths", "shells", "shell"],
  ["wirePaths", "wires", "wire"],
  ["facePaths", "faces", "face"],
  ["edgePaths", "edges", "edge"],
  ["vertexPaths", "vertices", "vertex"],
] as const);

type PathField = (typeof PATH_FIELDS)[number][0];
type CountField = (typeof PATH_FIELDS)[number][1];
type IndexedShapeType = (typeof PATH_FIELDS)[number][2];
type IdentityPaths = Readonly<Record<PathField, readonly OcctShapeArtifactNativePath[]>>;

function abortError(): DOMException {
  return new DOMException(
    "OCCT shape-artifact native identity operation was aborted",
    "AbortError",
  );
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError();
}

function checkedMaximum(options: OcctShapeArtifactNativeIdentityCodecOptions): number {
  const maximum: unknown = options.maxBytes;
  if (
    typeof maximum !== "number" ||
    !Number.isSafeInteger(maximum) ||
    maximum <= 0
  ) {
    throw new RangeError("Native identity maxBytes must be a positive safe integer");
  }
  return maximum;
}

function checkedCount(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATHS
  ) {
    throw new RangeError(`${label} must be a bounded non-negative safe integer`);
  }
  return value;
}

function pathKey(path: readonly number[]): string {
  return path.join("/");
}

function indexedPathField(shapeType: ShapeType): PathField | undefined {
  return PATH_FIELDS.find((entry) => entry[2] === shapeType)?.[0];
}

function samePath(
  first: readonly number[],
  second: readonly number[],
): boolean {
  return (
    first.length === second.length &&
    first.every((component, index) => component === second[index])
  );
}

function copyOccurrences(
  raw: unknown,
  paths: IdentityPaths,
  signal: AbortSignal | undefined,
  detach: boolean,
): readonly OcctShapeArtifactNativeOccurrenceV1[] {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_OCCURRENCES
  ) {
    throw new RangeError(
      "Native identity occurrences must be a non-empty bounded array",
    );
  }
  const seen: Record<PathField, boolean[]> = {
    solidPaths: Array.from({ length: paths.solidPaths.length }, () => false),
    shellPaths: Array.from({ length: paths.shellPaths.length }, () => false),
    wirePaths: Array.from({ length: paths.wirePaths.length }, () => false),
    facePaths: Array.from({ length: paths.facePaths.length }, () => false),
    edgePaths: Array.from({ length: paths.edgePaths.length }, () => false),
    vertexPaths: Array.from({ length: paths.vertexPaths.length }, () => false),
  };
  const output: OcctShapeArtifactNativeOccurrenceV1[] = [];
  const path: number[] = [];
  const parentRemaining: number[] = [];
  let hierarchyComplete = false;
  for (let index = 0; index < raw.length; index += 1) {
    if ((index & 0x3ff) === 0) checkAbort(signal);
    if (hierarchyComplete || !Object.hasOwn(raw, index)) {
      throw new TypeError(
        "Native identity occurrences do not form one rooted pre-order hierarchy",
      );
    }
    const value: unknown = raw[index];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError(`Native identity occurrence ${index} is malformed`);
    }
    const record = value as Readonly<Record<string, unknown>>;
    const shapeType = record.shapeType;
    const orientation = record.orientation;
    const childCount = record.childCount;
    const identityIndex = record.identityIndex;
    if (!SHAPE_TYPES.includes(shapeType as ShapeType)) {
      throw new TypeError(
        `Native identity occurrence ${index} shape type is malformed`,
      );
    }
    if (!SHAPE_ORIENTATIONS.includes(orientation as ShapeOrientation)) {
      throw new TypeError(
        `Native identity occurrence ${index} orientation is malformed`,
      );
    }
    if (
      typeof childCount !== "number" ||
      !Number.isSafeInteger(childCount) ||
      childCount < 0 ||
      childCount > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_CHILD_INDEX + 1
    ) {
      throw new RangeError(
        `Native identity occurrence ${index} child count is invalid`,
      );
    }
    const pathField = indexedPathField(shapeType as ShapeType);
    let copiedIdentityIndex: number | null;
    if (pathField === undefined) {
      if (identityIndex !== null) {
        throw new TypeError(
          `Native identity occurrence ${index} must be unindexed`,
        );
      }
      copiedIdentityIndex = null;
    } else {
      if (
        typeof identityIndex !== "number" ||
        !Number.isSafeInteger(identityIndex) ||
        identityIndex < 0 ||
        identityIndex >= paths[pathField].length
      ) {
        throw new RangeError(
          `Native identity occurrence ${index} class index is invalid`,
        );
      }
      copiedIdentityIndex = identityIndex;
      if (!seen[pathField][identityIndex]) {
        if (!samePath(paths[pathField][identityIndex]!, path)) {
          throw new TypeError(
            `Native identity occurrence ${index} is not its class's first path`,
          );
        }
        seen[pathField][identityIndex] = true;
      }
    }
    if (detach) {
      output.push(
        Object.freeze({
          shapeType: shapeType as ShapeType,
          orientation: orientation as ShapeOrientation,
          childCount,
          identityIndex: copiedIdentityIndex,
        }),
      );
    }

    if (childCount > 0) {
      if (path.length >= OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATH_DEPTH) {
        throw new RangeError("Native identity occurrence hierarchy is too deep");
      }
      parentRemaining.push(childCount);
      path.push(0);
      continue;
    }
    while (parentRemaining.length > 0) {
      const parent = parentRemaining.length - 1;
      const remaining = parentRemaining[parent]! - 1;
      parentRemaining[parent] = remaining;
      if (remaining > 0) {
        path[path.length - 1] = path[path.length - 1]! + 1;
        break;
      }
      parentRemaining.pop();
      path.pop();
    }
    if (parentRemaining.length === 0) hierarchyComplete = true;
  }
  if (
    !hierarchyComplete ||
    parentRemaining.length !== 0 ||
    path.length !== 0 ||
    PATH_FIELDS.some(([field]) => seen[field].some((value) => !value))
  ) {
    throw new TypeError(
      "Native identity occurrences do not cover one complete rooted hierarchy",
    );
  }
  return detach
    ? Object.freeze(output)
    : (Object.freeze(raw) as readonly OcctShapeArtifactNativeOccurrenceV1[]);
}

function copyIdentity(
  value: OcctShapeArtifactNativeIdentityV1,
  expected: OcctShapeArtifactNativeIdentityCounts | undefined,
  signal: AbortSignal | undefined,
  detach = true,
): {
  readonly identity: OcctShapeArtifactNativeIdentityV1;
  readonly counts: OcctShapeArtifactNativeIdentityCounts;
  readonly totalPaths: number;
  readonly totalComponents: number;
} {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("OCCT shape-artifact native identity must be an object");
  }
  const copied: Partial<Record<PathField, readonly OcctShapeArtifactNativePath[]>> =
    {};
  const counts: Partial<Record<CountField, number>> = {};
  const seenPaths = new Set<string>();
  let totalPaths = 0;
  let totalComponents = 0;
  for (const [field, countField] of PATH_FIELDS) {
    checkAbort(signal);
    const raw: unknown = value[field];
    if (!Array.isArray(raw)) {
      throw new TypeError(`Native identity ${field} must be an array`);
    }
    const count = checkedCount(raw.length, `Native identity ${field}.length`);
    if (expected !== undefined && count !== expected[countField]) {
      throw new TypeError(
        `Native identity ${field} count does not match the captured structure`,
      );
    }
    totalPaths += count;
    if (totalPaths > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATHS) {
      throw new RangeError("Native identity contains too many paths");
    }
    const paths: OcctShapeArtifactNativePath[] = [];
    let previous: OcctShapeArtifactNativePath | undefined;
    for (let pathIndex = 0; pathIndex < count; pathIndex += 1) {
      if ((pathIndex & 0x3ff) === 0) checkAbort(signal);
      if (!Object.hasOwn(raw, pathIndex)) {
        throw new TypeError(`Native identity ${field} contains a sparse path`);
      }
      const rawPath: unknown = raw[pathIndex];
      if (
        !Array.isArray(rawPath) ||
        rawPath.length > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATH_DEPTH
      ) {
        throw new RangeError(
          `Native identity ${field}[${pathIndex}] has invalid depth`,
        );
      }
      const path: number[] = [];
      for (
        let componentIndex = 0;
        componentIndex < rawPath.length;
        componentIndex += 1
      ) {
        if (!Object.hasOwn(rawPath, componentIndex)) {
          throw new TypeError(
            `Native identity ${field}[${pathIndex}] contains a sparse component`,
          );
        }
        const component: unknown = rawPath[componentIndex];
        if (
          typeof component !== "number" ||
          !Number.isSafeInteger(component) ||
          component < 0 ||
          component > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_CHILD_INDEX
        ) {
          throw new RangeError(
            `Native identity ${field}[${pathIndex}][${componentIndex}] is invalid`,
          );
        }
        if (detach) path.push(component);
      }
      totalComponents += rawPath.length;
      if (
        totalComponents >
        OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATH_COMPONENTS
      ) {
        throw new RangeError("Native identity contains too many path components");
      }
      const frozen = detach
        ? Object.freeze(path)
        : (Object.freeze(rawPath) as readonly number[]);
      if (
        previous !== undefined &&
        compareOcctShapeArtifactNativePaths(previous, frozen) >= 0
      ) {
        throw new TypeError(
          `Native identity ${field} paths must be in strict canonical order`,
        );
      }
      const key = pathKey(frozen);
      if (seenPaths.has(key)) {
        throw new TypeError("Native identity paths must be globally unique");
      }
      seenPaths.add(key);
      if (detach) paths.push(frozen);
      previous = frozen;
    }
    copied[field] = detach
      ? Object.freeze(paths)
      : (Object.freeze(raw) as readonly OcctShapeArtifactNativePath[]);
    counts[countField] = count;
  }
  const identityPaths = Object.freeze(copied) as IdentityPaths;
  const occurrences = copyOccurrences(
    value.occurrences,
    identityPaths,
    signal,
    detach,
  );
  return {
    identity: Object.freeze({
      ...identityPaths,
      occurrences,
    }) as OcctShapeArtifactNativeIdentityV1,
    counts: Object.freeze(counts) as OcctShapeArtifactNativeIdentityCounts,
    totalPaths,
    totalComponents,
  };
}

function exactByteLength(
  totalPaths: number,
  totalComponents: number,
  totalOccurrences: number,
): number {
  const pathBytes =
    (totalPaths + totalComponents) * Uint32Array.BYTES_PER_ELEMENT;
  const occurrenceBytes =
    totalOccurrences * OCCT_ARTIFACT_NATIVE_IDENTITY_V1_OCCURRENCE_BYTES;
  const bytes =
    OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES +
    pathBytes +
    occurrenceBytes;
  if (!Number.isSafeInteger(bytes) || bytes > 0xffff_ffff) {
    throw new RangeError("Native identity byte length exceeds the format limit");
  }
  return bytes;
}

export function encodeOcctArtifactNativeIdentityV1(
  value: OcctShapeArtifactNativeIdentityV1,
  options: OcctShapeArtifactNativeIdentityCodecOptions,
  expected?: OcctShapeArtifactNativeIdentityCounts,
): Uint8Array {
  const maximum = checkedMaximum(options);
  const signal = options.signal;
  checkAbort(signal);
  const prepared = copyIdentity(value, expected, signal);
  const byteLength = exactByteLength(
    prepared.totalPaths,
    prepared.totalComponents,
    prepared.identity.occurrences.length,
  );
  if (byteLength > maximum) {
    throw new RangeError("OCCT shape-artifact native identity exceeds maxBytes");
  }
  const output = new Uint8Array(byteLength);
  output.set(MAGIC);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  view.setUint16(16, FORMAT_VERSION, false);
  view.setUint16(18, 0, false);
  view.setUint32(
    20,
    OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES,
    false,
  );
  view.setUint32(24, byteLength, false);
  view.setUint32(28, prepared.totalComponents, false);
  view.setUint32(32, prepared.counts.solids, false);
  view.setUint32(36, prepared.counts.shells, false);
  view.setUint32(40, prepared.counts.wires, false);
  view.setUint32(44, prepared.counts.faces, false);
  view.setUint32(48, prepared.counts.edges, false);
  view.setUint32(52, prepared.counts.vertices, false);
  view.setUint32(56, prepared.identity.occurrences.length, false);
  view.setUint32(
    60,
    OCCT_ARTIFACT_NATIVE_IDENTITY_V1_OCCURRENCE_BYTES,
    false,
  );
  let offset = OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES;
  for (const [field] of PATH_FIELDS) {
    for (const path of prepared.identity[field]) {
      checkAbort(signal);
      view.setUint32(offset, path.length, false);
      offset += 4;
      for (const component of path) {
        view.setUint32(offset, component, false);
        offset += 4;
      }
    }
  }
  for (
    let index = 0;
    index < prepared.identity.occurrences.length;
    index += 1
  ) {
    if ((index & 0x3ff) === 0) checkAbort(signal);
    const occurrence = prepared.identity.occurrences[index]!;
    view.setUint8(offset, SHAPE_TYPES.indexOf(occurrence.shapeType));
    view.setUint8(offset + 1, SHAPE_ORIENTATIONS.indexOf(occurrence.orientation));
    view.setUint16(offset + 2, 0, false);
    view.setUint32(offset + 4, occurrence.childCount, false);
    view.setUint32(
      offset + 8,
      occurrence.identityIndex ?? UNINDEXED_OCCURRENCE,
      false,
    );
    offset += OCCT_ARTIFACT_NATIVE_IDENTITY_V1_OCCURRENCE_BYTES;
  }
  if (offset !== byteLength) {
    throw new Error("OCCT shape-artifact native identity length accounting failed");
  }
  checkAbort(signal);
  return output;
}

function equalMagic(bytes: Uint8Array): boolean {
  if (bytes.byteLength < MAGIC.byteLength) return false;
  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (bytes[index] !== MAGIC[index]) return false;
  }
  return true;
}

export function decodeOcctArtifactNativeIdentityV1(
  bytes: Uint8Array,
  expected: OcctShapeArtifactNativeIdentityCounts,
  options: OcctShapeArtifactNativeIdentityCodecOptions,
): OcctShapeArtifactNativeIdentityV1 {
  const maximum = checkedMaximum(options);
  const signal = options.signal;
  checkAbort(signal);
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("OCCT shape-artifact native identity must be a Uint8Array");
  }
  if (
    bytes.byteLength < OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES ||
    bytes.byteLength > maximum ||
    bytes.byteLength > 0xffff_ffff
  ) {
    throw new RangeError("OCCT shape-artifact native identity is truncated or oversized");
  }
  if (!equalMagic(bytes)) {
    throw new TypeError("OCCT shape-artifact native identity magic is invalid");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint16(16, false) !== FORMAT_VERSION ||
    view.getUint16(18, false) !== 0 ||
    view.getUint32(20, false) !==
      OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES ||
    view.getUint32(24, false) !== bytes.byteLength ||
    view.getUint32(60, false) !==
      OCCT_ARTIFACT_NATIVE_IDENTITY_V1_OCCURRENCE_BYTES
  ) {
    throw new TypeError("OCCT shape-artifact native identity header is unsupported");
  }
  const declaredComponents = view.getUint32(28, false);
  const declaredCounts: OcctShapeArtifactNativeIdentityCounts = Object.freeze({
    solids: view.getUint32(32, false),
    shells: view.getUint32(36, false),
    wires: view.getUint32(40, false),
    faces: view.getUint32(44, false),
    edges: view.getUint32(48, false),
    vertices: view.getUint32(52, false),
  });
  const declaredOccurrences = view.getUint32(56, false);
  let totalPaths = 0;
  for (const [, countField] of PATH_FIELDS) {
    const count = checkedCount(
      declaredCounts[countField],
      `Native identity ${countField}`,
    );
    if (count !== expected[countField]) {
      throw new TypeError(
        `Native identity ${countField} count does not match the sidecar`,
      );
    }
    totalPaths += count;
  }
  if (
    totalPaths > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATHS ||
    declaredComponents >
      OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATH_COMPONENTS ||
    declaredOccurrences === 0 ||
    declaredOccurrences > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_OCCURRENCES ||
    exactByteLength(
      totalPaths,
      declaredComponents,
      declaredOccurrences,
    ) !== bytes.byteLength
  ) {
    throw new TypeError("OCCT shape-artifact native identity totals are invalid");
  }
  let offset = OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES;
  let consumedComponents = 0;
  const decoded: Partial<
    Record<PathField, readonly OcctShapeArtifactNativePath[]>
  > = {};
  for (const [field, countField] of PATH_FIELDS) {
    const paths: OcctShapeArtifactNativePath[] = [];
    for (
      let pathIndex = 0;
      pathIndex < declaredCounts[countField];
      pathIndex += 1
    ) {
      if ((pathIndex & 0x3ff) === 0) checkAbort(signal);
      const depth = view.getUint32(offset, false);
      offset += 4;
      if (
        depth > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATH_DEPTH ||
        consumedComponents + depth > declaredComponents
      ) {
        throw new RangeError("OCCT shape-artifact native identity path is oversized");
      }
      const path: number[] = [];
      for (
        let componentIndex = 0;
        componentIndex < depth;
        componentIndex += 1
      ) {
        const component = view.getUint32(offset, false);
        offset += 4;
        if (component > OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_CHILD_INDEX) {
          throw new RangeError(
            "OCCT shape-artifact native identity child index is oversized",
          );
        }
        path.push(component);
      }
      consumedComponents += depth;
      paths.push(Object.freeze(path));
    }
    decoded[field] = Object.freeze(paths);
  }
  const occurrences: OcctShapeArtifactNativeOccurrenceV1[] = [];
  for (let index = 0; index < declaredOccurrences; index += 1) {
    if ((index & 0x3ff) === 0) checkAbort(signal);
    const shapeType = SHAPE_TYPES[view.getUint8(offset)];
    const orientation = SHAPE_ORIENTATIONS[view.getUint8(offset + 1)];
    const reserved = view.getUint16(offset + 2, false);
    const childCount = view.getUint32(offset + 4, false);
    const rawIdentityIndex = view.getUint32(offset + 8, false);
    if (
      shapeType === undefined ||
      orientation === undefined ||
      reserved !== 0
    ) {
      throw new TypeError(
        `OCCT shape-artifact native occurrence ${index} is malformed`,
      );
    }
    occurrences.push(
      Object.freeze({
        shapeType,
        orientation,
        childCount,
        identityIndex:
          rawIdentityIndex === UNINDEXED_OCCURRENCE
            ? null
            : rawIdentityIndex,
      }),
    );
    offset += OCCT_ARTIFACT_NATIVE_IDENTITY_V1_OCCURRENCE_BYTES;
  }
  if (
    consumedComponents !== declaredComponents ||
    offset !== bytes.byteLength
  ) {
    throw new TypeError("OCCT shape-artifact native identity payload is inconsistent");
  }
  return copyIdentity(
    Object.freeze({
      ...decoded,
      occurrences: Object.freeze(occurrences),
    }) as unknown as OcctShapeArtifactNativeIdentityV1,
    expected,
    signal,
    false,
  ).identity;
}
