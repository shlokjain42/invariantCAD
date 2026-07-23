import { describe, expect, it } from "vitest";
import { OcctKernel as RawOcctKernel } from "occt-wasm";
import type {
  GeometryKernel,
  KernelShape,
  KernelShapeArtifactContext,
} from "../src/kernel.js";
import {
  getOcctShapeArtifactCodecCandidate,
  type OcctShapeArtifactCodecCandidate,
} from "../src/internal/occt-artifact-candidate.js";
import { createOcctKernel } from "../src/occt-kernel.js";

const ARTIFACT_CONTEXT: KernelShapeArtifactContext = Object.freeze({
  feature: "occt-artifact-native-occurrence-regression",
  maxArtifactBytes: 16 * 1024 * 1024,
});

function codec(kernel: GeometryKernel): OcctShapeArtifactCodecCandidate {
  const candidate = getOcctShapeArtifactCodecCandidate(kernel);
  if (candidate === undefined) {
    throw new Error("The OCCT artifact candidate is unavailable");
  }
  return candidate;
}

function liveShapeCount(kernel: GeometryKernel): number {
  const liveShapes = (kernel as unknown as { readonly liveShapes?: unknown })
    .liveShapes;
  if (!(liveShapes instanceof Set)) {
    throw new TypeError("OCCT test could not inspect live shape ownership");
  }
  return liveShapes.size;
}

function nativeHandleCount(kernel: GeometryKernel): number {
  const raw = (kernel as unknown as {
    readonly raw?: { readonly shapeCount?: unknown };
  }).raw;
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof raw.shapeCount !== "number"
  ) {
    throw new TypeError("OCCT test could not inspect native handle ownership");
  }
  return raw.shapeCount;
}

function replaceBrepSection(
  artifact: Uint8Array,
  replacement: Uint8Array,
): Uint8Array {
  const headerBytes = 44;
  const header = new DataView(
    artifact.buffer,
    artifact.byteOffset,
    headerBytes,
  );
  expect(header.getUint16(16, false)).toBe(3);
  expect(header.getUint32(20, false)).toBe(headerBytes);
  const fingerprintLength = header.getUint32(24, false);
  const stateLength = header.getUint32(28, false);
  const identityLength = header.getUint32(32, false);
  const originalBrepLength = header.getUint32(36, false);
  const brepOffset =
    headerBytes + fingerprintLength + stateLength + identityLength;
  expect(brepOffset + originalBrepLength).toBe(artifact.byteLength);

  const rewritten = new Uint8Array(brepOffset + replacement.byteLength);
  rewritten.set(artifact.subarray(0, brepOffset));
  rewritten.set(replacement, brepOffset);
  const rewrittenHeader = new DataView(
    rewritten.buffer,
    rewritten.byteOffset,
    headerBytes,
  );
  rewrittenHeader.setUint32(36, replacement.byteLength, false);
  rewrittenHeader.setUint32(40, rewritten.byteLength, false);
  return rewritten;
}

describe("OCCT artifact native occurrence integrity", () => {
  it("rejects a duplicate occurrence of the same located TShape transactionally", async () => {
    const raw = await RawOcctKernel.init();
    let sourceBrep: Uint8Array;
    let duplicatedBrep: Uint8Array;
    try {
      const box = raw.makeBox(2, 2, 2);
      const single = raw.makeCompound([box]);
      const duplicated = raw.makeCompound([box, box]);
      try {
        expect(raw.getVolume(single)).toBeCloseTo(8, 12);
        expect(raw.getVolume(duplicated)).toBeCloseTo(16, 12);
        expect(raw.tessellate(duplicated).indices.length).toBe(
          raw.tessellate(single).indices.length * 2,
        );
        sourceBrep = raw.toBREPBinary(single).slice();
        duplicatedBrep = raw.toBREPBinary(duplicated).slice();
      } finally {
        raw.release(duplicated);
        raw.release(single);
        raw.release(box);
      }
    } finally {
      raw[Symbol.dispose]();
    }

    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let unexpectedDecoded: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      if (producer.importShape === undefined) {
        throw new Error("OCCT binary BREP import is unavailable");
      }
      source = producer.importShape(sourceBrep, "brep-binary", {
        feature: "single-occurrence-source",
      });
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const substituted = replaceBrepSection(artifact, duplicatedBrep);
      const borrowed = substituted.slice();
      let rejection: unknown;
      try {
        unexpectedDecoded = await codec(consumer).decodeShapeArtifact(
          substituted,
          ARTIFACT_CONTEXT,
        );
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeDefined();
      expect(unexpectedDecoded).toBeUndefined();
      expect(substituted).toEqual(borrowed);
      expect(liveShapeCount(consumer)).toBe(0);
      expect(nativeHandleCount(consumer)).toBe(0);
      expect(producer.status(source)).toEqual({ ok: true, code: "VALID" });

      decoded = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      expect(consumer.status(decoded)).toEqual({ ok: true, code: "VALID" });
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (unexpectedDecoded !== undefined) {
        consumer.disposeShape(unexpectedDecoded);
      }
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });
});
