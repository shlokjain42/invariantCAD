import { describe, expect, it } from "vitest";
import {
  decodeOcctArtifactNativeIdentityV1,
  encodeOcctArtifactNativeIdentityV1,
  OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES,
  OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_OCCURRENCES,
  OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATHS,
  type OcctShapeArtifactNativeIdentityCounts,
  type OcctShapeArtifactNativeIdentityV1,
} from "../src/internal/occt-artifact-identity-v1.js";

const MAX_BYTES = 1024 * 1024;
const IDENTITY: OcctShapeArtifactNativeIdentityV1 = Object.freeze({
  solidPaths: Object.freeze([Object.freeze([])]),
  shellPaths: Object.freeze([Object.freeze([0])]),
  wirePaths: Object.freeze([Object.freeze([0, 0, 0])]),
  facePaths: Object.freeze([Object.freeze([0, 0])]),
  edgePaths: Object.freeze([Object.freeze([0, 0, 0, 0])]),
  vertexPaths: Object.freeze([
    Object.freeze([0, 0, 0, 0, 0]),
    Object.freeze([0, 0, 0, 0, 1]),
  ]),
  occurrences: Object.freeze([
    Object.freeze({
      shapeType: "solid",
      orientation: "forward",
      childCount: 1,
      identityIndex: 0,
    }),
    Object.freeze({
      shapeType: "shell",
      orientation: "forward",
      childCount: 1,
      identityIndex: 0,
    }),
    Object.freeze({
      shapeType: "face",
      orientation: "forward",
      childCount: 1,
      identityIndex: 0,
    }),
    Object.freeze({
      shapeType: "wire",
      orientation: "forward",
      childCount: 1,
      identityIndex: 0,
    }),
    Object.freeze({
      shapeType: "edge",
      orientation: "forward",
      childCount: 2,
      identityIndex: 0,
    }),
    Object.freeze({
      shapeType: "vertex",
      orientation: "forward",
      childCount: 0,
      identityIndex: 0,
    }),
    Object.freeze({
      shapeType: "vertex",
      orientation: "reversed",
      childCount: 0,
      identityIndex: 1,
    }),
  ]),
});
const COUNTS: OcctShapeArtifactNativeIdentityCounts = Object.freeze({
  solids: 1,
  shells: 1,
  wires: 1,
  faces: 1,
  edges: 1,
  vertices: 2,
});

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(child, seen);
  }
}

describe("OCCT artifact-local native identity v1", () => {
  it("round-trips one exact-size canonical path table as detached frozen state", () => {
    const encoded = encodeOcctArtifactNativeIdentityV1(
      IDENTITY,
      { maxBytes: MAX_BYTES },
      COUNTS,
    );
    expect(encoded.byteLength).toBe(256);
    const header = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength,
    );
    expect(header.getUint16(16, false)).toBe(1);
    expect(header.getUint32(20, false)).toBe(
      OCCT_ARTIFACT_NATIVE_IDENTITY_V1_HEADER_BYTES,
    );
    expect(header.getUint32(24, false)).toBe(encoded.byteLength);
    expect(header.getUint32(28, false)).toBe(20);
    expect(header.getUint32(56, false)).toBe(7);
    expect(header.getUint32(60, false)).toBe(12);

    const borrowed = encoded.slice();
    const decoded = decodeOcctArtifactNativeIdentityV1(
      encoded,
      COUNTS,
      { maxBytes: encoded.byteLength },
    );
    expect(decoded).toEqual(IDENTITY);
    expectDeeplyFrozen(decoded);
    encoded.fill(0);
    expect(decoded).toEqual(IDENTITY);
    expect(borrowed.some((byte) => byte !== 0)).toBe(true);
  });

  it("enforces exact byte ceilings and pre-aborted operations", () => {
    const encoded = encodeOcctArtifactNativeIdentityV1(
      IDENTITY,
      { maxBytes: MAX_BYTES },
      COUNTS,
    );
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        IDENTITY,
        { maxBytes: encoded.byteLength },
        COUNTS,
      ),
    ).not.toThrow();
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        IDENTITY,
        { maxBytes: encoded.byteLength - 1 },
        COUNTS,
      ),
    ).toThrow(/maxBytes/);
    expect(() =>
      decodeOcctArtifactNativeIdentityV1(
        encoded,
        COUNTS,
        { maxBytes: encoded.byteLength - 1 },
      ),
    ).toThrow(/oversized/);
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        {
          ...IDENTITY,
          solidPaths: new Array(OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATHS + 1),
        },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/bounded/);
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        {
          ...IDENTITY,
          occurrences: new Array(
            OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_OCCURRENCES + 1,
          ),
        },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/bounded/);

    const controller = new AbortController();
    controller.abort();
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        IDENTITY,
        { maxBytes: MAX_BYTES, signal: controller.signal },
        COUNTS,
      ),
    ).toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(() =>
      decodeOcctArtifactNativeIdentityV1(
        encoded,
        COUNTS,
        { maxBytes: MAX_BYTES, signal: controller.signal },
      ),
    ).toThrow(expect.objectContaining({ name: "AbortError" }));
  });

  it("rejects noncanonical, duplicate, sparse, deep, and count-mismatched paths", () => {
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        {
          ...IDENTITY,
          vertexPaths: [
            [0, 0, 0, 0, 1],
            [0, 0, 0, 0, 0],
          ],
        },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/canonical order/);
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        {
          ...IDENTITY,
          edgePaths: [[0, 0]],
        },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/globally unique/);
    const sparse = new Array<readonly number[]>(1);
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        { ...IDENTITY, facePaths: sparse },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/sparse/);
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        {
          ...IDENTITY,
          facePaths: [Array.from({ length: 65 }, () => 0)],
        },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/depth/);
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        IDENTITY,
        { maxBytes: MAX_BYTES },
        { ...COUNTS, faces: 2 },
      ),
    ).toThrow(/count/);
  });

  it("rejects incomplete, overfull, malformed, and misclassified occurrence hierarchies", () => {
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        { ...IDENTITY, occurrences: IDENTITY.occurrences.slice(0, -1) },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/complete rooted hierarchy/);
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        {
          ...IDENTITY,
          occurrences: [
            ...IDENTITY.occurrences,
            IDENTITY.occurrences.at(-1)!,
          ],
        },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/rooted pre-order hierarchy/);
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        {
          ...IDENTITY,
          occurrences: IDENTITY.occurrences.map((occurrence, index) =>
            index === 1
              ? { ...occurrence, identityIndex: null }
              : occurrence,
          ),
        },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/class index/);
    expect(() =>
      encodeOcctArtifactNativeIdentityV1(
        {
          ...IDENTITY,
          occurrences: IDENTITY.occurrences.map((occurrence, index) =>
            index === 5
              ? { ...occurrence, identityIndex: 1 }
              : occurrence,
          ),
        },
        { maxBytes: MAX_BYTES },
        COUNTS,
      ),
    ).toThrow(/first path/);
  });

  it("rejects corrupt headers, totals, child indices, truncation, and expected counts", () => {
    const encoded = encodeOcctArtifactNativeIdentityV1(
      IDENTITY,
      { maxBytes: MAX_BYTES },
      COUNTS,
    );
    const corruptions: Uint8Array[] = [];
    const badMagic = encoded.slice();
    badMagic[0] = badMagic[0]! ^ 0xff;
    corruptions.push(badMagic);
    const badVersion = encoded.slice();
    new DataView(badVersion.buffer).setUint16(16, 2, false);
    corruptions.push(badVersion);
    const badTotal = encoded.slice();
    new DataView(badTotal.buffer).setUint32(24, encoded.byteLength + 1, false);
    corruptions.push(badTotal);
    const badComponents = encoded.slice();
    new DataView(badComponents.buffer).setUint32(28, 19, false);
    corruptions.push(badComponents);
    const badOccurrenceCount = encoded.slice();
    new DataView(badOccurrenceCount.buffer).setUint32(56, 8, false);
    corruptions.push(badOccurrenceCount);
    const badOccurrenceWidth = encoded.slice();
    new DataView(badOccurrenceWidth.buffer).setUint32(60, 16, false);
    corruptions.push(badOccurrenceWidth);
    const badChildIndex = encoded.slice();
    // The empty solid path occupies one word; the shell length and component
    // follow at offsets 68 and 72.
    new DataView(badChildIndex.buffer).setUint32(72, 1_000_000, false);
    corruptions.push(badChildIndex);
    const occurrenceOffset = encoded.byteLength - 7 * 12;
    const badOccurrenceType = encoded.slice();
    badOccurrenceType[occurrenceOffset] = 0xff;
    corruptions.push(badOccurrenceType);
    const badOccurrenceOrientation = encoded.slice();
    badOccurrenceOrientation[occurrenceOffset + 1] = 0xff;
    corruptions.push(badOccurrenceOrientation);
    const badOccurrenceReserved = encoded.slice();
    new DataView(badOccurrenceReserved.buffer).setUint16(
      occurrenceOffset + 2,
      1,
      false,
    );
    corruptions.push(badOccurrenceReserved);
    const badOccurrenceChildCount = encoded.slice();
    new DataView(badOccurrenceChildCount.buffer).setUint32(
      occurrenceOffset + 4,
      0,
      false,
    );
    corruptions.push(badOccurrenceChildCount);
    const badOccurrenceClass = encoded.slice();
    new DataView(badOccurrenceClass.buffer).setUint32(
      occurrenceOffset + 8,
      1,
      false,
    );
    corruptions.push(badOccurrenceClass);
    corruptions.push(encoded.subarray(0, encoded.byteLength - 1));
    for (const corruption of corruptions) {
      const borrowed = corruption.slice();
      expect(() =>
        decodeOcctArtifactNativeIdentityV1(
          corruption,
          COUNTS,
          { maxBytes: MAX_BYTES },
        ),
      ).toThrow();
      expect(corruption).toEqual(borrowed);
    }
    expect(() =>
      decodeOcctArtifactNativeIdentityV1(
        encoded,
        { ...COUNTS, vertices: 1 },
        { maxBytes: MAX_BYTES },
      ),
    ).toThrow(/count/);
  });
});
