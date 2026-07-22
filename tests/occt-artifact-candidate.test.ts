import { describe, expect, it } from "vitest";
import type {
  OcctKernel as RawOcctKernel,
  ShapeHandle,
} from "occt-wasm";
import { inspectKernelShapeArtifactSupport } from "../src/artifact-cache.js";
import type { KernelShapeArtifactCodecCandidate } from "../src/conformance.js";
import { canonicalStringifyProtocol } from "../src/core/json.js";
import { getOcctShapeArtifactCodecCandidate } from "../src/internal/occt-artifact-candidate.js";
import type {
  GeometryKernel,
  KernelShape,
  KernelShapeArtifactContext,
} from "../src/kernel.js";
import {
  createOcctKernel,
  type OcctKernelOptions,
} from "../src/occt-kernel.js";
import type { ResolvedCircularArcPath } from "../src/protocol/path.js";
import type {
  ProfileCurveSource,
  ResolvedProfile,
} from "../src/protocol/profile.js";
import type { KernelTopologySnapshot } from "../src/protocol/topology.js";
import {
  observeKernelShapeSemantics,
  type KernelShapeSemanticObservation,
  type KernelShapeSemanticObservationPlan,
} from "../src/shape-semantic-observation.js";

const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const ARTIFACT_CONTEXT: KernelShapeArtifactContext = Object.freeze({
  feature: "occt-artifact-candidate-test",
  maxArtifactBytes: MAX_ARTIFACT_BYTES,
});

function codec(kernel: GeometryKernel): KernelShapeArtifactCodecCandidate {
  const candidate = getOcctShapeArtifactCodecCandidate(kernel);
  expect(candidate).toBeDefined();
  if (candidate === undefined) {
    throw new Error("The stock OCCT runtime did not expose its artifact candidate");
  }
  return candidate;
}

function box(kernel: GeometryKernel, feature = "role-box"): KernelShape {
  if (kernel.box === undefined) throw new Error("OCCT box support is unavailable");
  return kernel.box([2, 3, 5], false, { feature });
}

function topology(
  kernel: GeometryKernel,
  shape: KernelShape,
): KernelTopologySnapshot {
  const snapshot = kernel.topology?.(shape);
  if (snapshot === undefined) throw new Error("OCCT topology support is unavailable");
  return snapshot;
}

function observationPlan(
  kernel: GeometryKernel,
): KernelShapeSemanticObservationPlan {
  return {
    id: "occt-artifact-candidate-direct-v1",
    meshes: [
      { id: "default" },
      {
        id: "fine-absolute",
        options: {
          linearDeflection: 0.05,
          angularDeflection: 0.2,
          relative: false,
        },
      },
    ],
    topology: "required",
    nativeExchanges: [],
    probes: [],
    notApplicableFeatures: kernel.capabilities.features.map((feature) => ({
      feature,
      reason: "Direct artifact-state comparison; downstream use is tested separately",
    })),
  };
}

async function observe(
  kernel: GeometryKernel,
  shape: KernelShape,
  plan = observationPlan(kernel),
): Promise<KernelShapeSemanticObservation> {
  const result = await observeKernelShapeSemantics(kernel, shape, plan);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected a semantic observation");
  return result.value;
}

function topologyKeys(snapshot: KernelTopologySnapshot): readonly string[] {
  return [...snapshot.faces, ...snapshot.edges, ...snapshot.vertices].map(
    ({ key }) => key,
  );
}

function expectFreshTopologyKeys(
  source: KernelTopologySnapshot,
  decoded: KernelTopologySnapshot,
): void {
  const sourceKeys = new Set(topologyKeys(source));
  expect(topologyKeys(decoded)).not.toEqual(topologyKeys(source));
  expect(topologyKeys(decoded).every((key) => !sourceKeys.has(key))).toBe(true);
}

interface CandidateEnvelopeSections {
  readonly fingerprintOffset: number;
  readonly fingerprintLength: number;
  readonly stateOffset: number;
  readonly stateLength: number;
  readonly brepOffset: number;
  readonly brepLength: number;
}

function envelopeSections(artifact: Uint8Array): CandidateEnvelopeSections {
  // Candidate format v1 uses a fixed 40-byte big-endian header. Keeping this
  // parser here makes corruption cases target declared sections, not lucky
  // byte positions inside one fixture.
  expect(artifact.byteLength).toBeGreaterThanOrEqual(40);
  const header = new DataView(artifact.buffer, artifact.byteOffset, 40);
  expect(header.getUint32(20, false)).toBe(40);
  const fingerprintLength = header.getUint32(24, false);
  const stateLength = header.getUint32(28, false);
  const brepLength = header.getUint32(32, false);
  const fingerprintOffset = 40;
  const stateOffset = fingerprintOffset + fingerprintLength;
  return {
    fingerprintOffset,
    fingerprintLength,
    stateOffset,
    stateLength,
    brepOffset: stateOffset + stateLength,
    brepLength,
  };
}

function withIncrementedUint32(
  artifact: Uint8Array,
  offset: number,
): Uint8Array {
  const corrupted = artifact.slice();
  const view = new DataView(
    corrupted.buffer,
    corrupted.byteOffset,
    corrupted.byteLength,
  );
  view.setUint32(offset, view.getUint32(offset, false) + 1, false);
  return corrupted;
}

function testRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function testArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} is not an array`);
  return value;
}

function rewriteCanonicalState(
  artifact: Uint8Array,
  mutate: (state: Record<string, unknown>) => void,
): Uint8Array {
  const sections = envelopeSections(artifact);
  const state = testRecord(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        artifact.subarray(
          sections.stateOffset,
          sections.stateOffset + sections.stateLength,
        ),
      ),
    ) as unknown,
    "candidate state",
  );
  mutate(state);
  const encodedState = new TextEncoder().encode(
    canonicalStringifyProtocol(state),
  );
  const nextLength =
    artifact.byteLength - sections.stateLength + encodedState.byteLength;
  const rewritten = new Uint8Array(nextLength);
  rewritten.set(artifact.subarray(0, sections.stateOffset), 0);
  rewritten.set(encodedState, sections.stateOffset);
  rewritten.set(
    artifact.subarray(
      sections.brepOffset,
      sections.brepOffset + sections.brepLength,
    ),
    sections.stateOffset + encodedState.byteLength,
  );
  const header = new DataView(
    rewritten.buffer,
    rewritten.byteOffset,
    rewritten.byteLength,
  );
  header.setUint32(28, encodedState.byteLength, false);
  header.setUint32(36, rewritten.byteLength, false);
  return rewritten;
}

function replaceBrepSection(
  artifact: Uint8Array,
  brep: Uint8Array,
): Uint8Array {
  const sections = envelopeSections(artifact);
  const nextLength = artifact.byteLength - sections.brepLength + brep.byteLength;
  const rewritten = new Uint8Array(nextLength);
  rewritten.set(artifact.subarray(0, sections.brepOffset), 0);
  rewritten.set(brep, sections.brepOffset);
  const header = new DataView(
    rewritten.buffer,
    rewritten.byteOffset,
    rewritten.byteLength,
  );
  header.setUint32(32, brep.byteLength, false);
  header.setUint32(36, rewritten.byteLength, false);
  return rewritten;
}

function firstWireFace(state: Record<string, unknown>): Record<string, unknown> {
  const topology = testRecord(state.topology, "candidate topology");
  const faces = testArray(topology.faces, "candidate faces");
  return testRecord(faces[0], "candidate first face");
}

function liveShapeCount(kernel: GeometryKernel): number {
  const liveShapes = (kernel as unknown as { readonly liveShapes?: unknown })
    .liveShapes;
  if (!(liveShapes instanceof Set)) {
    throw new TypeError("OCCT test could not inspect live shape ownership");
  }
  return liveShapes.size;
}

function rawOcctKernel(kernel: GeometryKernel): RawOcctKernel {
  const raw = (kernel as unknown as { readonly raw?: unknown }).raw;
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("OCCT test could not inspect the raw kernel");
  }
  return raw as RawOcctKernel;
}

function rawOcctShapeHandle(shape: KernelShape): ShapeHandle {
  for (const symbol of Object.getOwnPropertySymbols(shape)) {
    const value = (shape as unknown as Record<symbol, unknown>)[symbol];
    if (typeof value === "number") return value as ShapeHandle;
  }
  throw new TypeError("OCCT test could not inspect the raw shape handle");
}

async function expectRejected(
  operation: () => unknown | PromiseLike<unknown>,
): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error;
  }
  throw new Error("Expected the artifact operation to reject");
}

async function expectAborted(
  operation: () => unknown | PromiseLike<unknown>,
): Promise<void> {
  const error = await expectRejected(operation);
  expect(error).toMatchObject({ name: "AbortError" });
}

function rectangleProfile(width: number, height: number): ResolvedProfile {
  const source = (entity: string): ProfileCurveSource => ({
    kind: "sketch-entity",
    sketch: "artifact-sweep-profile",
    entity: entity as ProfileCurveSource["entity"],
  });
  const x = width / 2;
  const y = height / 2;
  return {
    plane: { plane: "XY", origin: [0, 0, 0] },
    outer: {
      curves: [
        { kind: "line", start: [-x, -y], end: [x, -y], source: source("bottom") },
        { kind: "line", start: [x, -y], end: [x, y], source: source("right") },
        { kind: "line", start: [x, y], end: [-x, y], source: source("top") },
        { kind: "line", start: [-x, y], end: [-x, -y], source: source("left") },
      ],
    },
    holes: [],
  };
}

function quarterCirclePath(radius: number): ResolvedCircularArcPath {
  return {
    kind: "circularArc",
    start: [0, 0, 0],
    through: [
      radius - radius / Math.sqrt(2),
      0,
      radius / Math.sqrt(2),
    ],
    end: [radius, 0, radius],
    closed: false,
  };
}

describe("OCCT shape-artifact codec candidate", () => {
  it("stays separate from production capability advertising", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(inspectKernelShapeArtifactSupport(kernel)).toEqual({
        status: "absent",
      });
      const candidate = codec(kernel);
      expect(candidate.capabilities).toEqual(
        getOcctShapeArtifactCodecCandidate(kernel)?.capabilities,
      );
      expect(inspectKernelShapeArtifactSupport(kernel)).toEqual({
        status: "absent",
      });
    } finally {
      kernel.dispose();
    }
  });

  it("round-trips a cold role-rich asymmetric box exactly with fresh topology keys", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      const producerCodec = codec(producer);
      const consumerCodec = codec(consumer);
      expect(producerCodec.capabilities).toEqual(consumerCodec.capabilities);
      source = box(producer);

      // Encoding is deliberately the first observation of the new source.
      const artifact = await producerCodec.encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      decoded = await consumerCodec.decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );

      const plan = observationPlan(producer);
      expect(await observe(consumer, decoded, plan)).toEqual(
        await observe(producer, source, plan),
      );
      expectFreshTopologyKeys(
        topology(producer, source),
        topology(consumer, decoded),
      );
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });

  it("does not change an already mesh- and topology-warm source", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = box(producer, "warm-role-box");
      const plan = observationPlan(producer);
      const beforeObservation = await observe(producer, source, plan);
      const beforeMesh = producer.mesh(source);
      const beforeTopology = topology(producer, source);

      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      expect(await observe(producer, source, plan)).toEqual(beforeObservation);
      expect(producer.mesh(source)).toEqual(beforeMesh);
      expect(topology(producer, source)).toEqual(beforeTopology);

      decoded = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      expect(await observe(consumer, decoded, plan)).toEqual(beforeObservation);
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });

  it("preserves partial history from a binary-BREP import", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let original: KernelShape | undefined;
    let imported: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      if (producer.exportShape === undefined || producer.importShape === undefined) {
        throw new Error("OCCT binary-BREP exchange support is unavailable");
      }
      original = box(producer, "brep-origin");
      const brep = producer.exportShape(original, "brep-binary", {
        feature: "brep-export",
      });
      imported = producer.importShape(brep, "brep-binary", {
        feature: "brep-import",
      });
      producer.disposeShape(original);
      original = undefined;
      expect(topology(producer, imported).history).toBe("partial");

      const artifact = await codec(producer).encodeShapeArtifact(
        imported,
        ARTIFACT_CONTEXT,
      );
      decoded = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      expect(topology(consumer, decoded).history).toBe("partial");
      const plan = observationPlan(producer);
      expect(await observe(consumer, decoded, plan)).toEqual(
        await observe(producer, imported, plan),
      );
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (imported !== undefined) producer.disposeShape(imported);
      if (original !== undefined) producer.disposeShape(original);
      consumer.dispose();
      producer.dispose();
    }
  });

  it("preserves an analytic circular-sweep volume override", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      if (producer.circularArcSweep === undefined) {
        throw new Error("OCCT circular-arc sweep support is unavailable");
      }
      const width = 0.75;
      const height = 0.5;
      const radius = 5;
      source = producer.circularArcSweep(
        rectangleProfile(width, height),
        quarterCirclePath(radius),
        { transition: "right-corner", frame: "corrected-frenet" },
        { feature: "analytic-sweep" },
      );
      const expectedVolume = width * height * radius * (Math.PI / 2);
      const sourceVolume = producer.measure(source).volume;
      expect(sourceVolume).toBeCloseTo(expectedVolume, 12);

      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      decoded = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      expect(consumer.measure(decoded).volume).toBe(sourceVolume);
      const plan = observationPlan(producer);
      expect(await observe(consumer, decoded, plan)).toEqual(
        await observe(producer, source, plan),
      );
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });

  it("restores enough selected topology to drive a downstream stock fillet", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    let filleted: KernelShape | undefined;
    try {
      source = box(producer, "downstream-box");
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      decoded = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      const selected = topology(consumer, decoded).edges.find((edge) =>
        edge.lineage.some(
          (lineage) => lineage.role === "box.edge.x-min-y-min",
        ),
      );
      expect(selected).toBeDefined();
      if (selected === undefined || consumer.fillet === undefined) {
        throw new Error("OCCT selected-edge fillet support is unavailable");
      }
      filleted = consumer.fillet(
        decoded,
        [selected.key],
        { radius: 0.2 },
        { feature: "post-artifact-fillet" },
      );
      expect(consumer.status(filleted)).toEqual({ ok: true, code: "VALID" });
      expect(consumer.measure(filleted).volume).toBeGreaterThan(0);
    } finally {
      if (filleted !== undefined) consumer.disposeShape(filleted);
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });

  it("enforces ceilings and pre-abort without changing borrowed state", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    try {
      source = box(producer, "bounded-box");
      const producerCodec = codec(producer);
      const consumerCodec = codec(consumer);
      expect(
        (source as KernelShape & { readonly topologySnapshot?: unknown })
          .topologySnapshot,
      ).toBeUndefined();
      await expectRejected(() =>
        producerCodec.encodeShapeArtifact(source!, {
          ...ARTIFACT_CONTEXT,
          maxArtifactBytes: 1,
        }),
      );
      expect(
        (source as KernelShape & { readonly topologySnapshot?: unknown })
          .topologySnapshot,
      ).toBeUndefined();
      const artifact = await producerCodec.encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const artifactCopy = artifact.slice();
      const before = await observe(producer, source);

      await expectRejected(() =>
        producerCodec.encodeShapeArtifact(source!, {
          ...ARTIFACT_CONTEXT,
          maxArtifactBytes: artifact.byteLength - 1,
        }),
      );
      await expectRejected(() =>
        consumerCodec.decodeShapeArtifact(artifact, {
          ...ARTIFACT_CONTEXT,
          maxArtifactBytes: artifact.byteLength - 1,
        }),
      );

      const controller = new AbortController();
      controller.abort();
      await expectAborted(() =>
        producerCodec.encodeShapeArtifact(source!, {
          ...ARTIFACT_CONTEXT,
          signal: controller.signal,
        }),
      );
      await expectAborted(() =>
        consumerCodec.decodeShapeArtifact(artifact, {
          ...ARTIFACT_CONTEXT,
          signal: controller.signal,
        }),
      );
      expect(artifact).toEqual(artifactCopy);
      expect(await observe(producer, source)).toEqual(before);
    } finally {
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });

  it("copies borrowed input and keeps source and decoded ownership independent", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decodedSourceFirst: KernelShape | undefined;
    let decodedResultFirst: KernelShape | undefined;
    try {
      source = box(producer, "ownership-box");
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const pristine = artifact.slice();
      decodedSourceFirst = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      expect(artifact).toEqual(pristine);
      const decodedBeforeMutation = await observe(consumer, decodedSourceFirst);
      artifact.fill(0xa5);
      expect(await observe(consumer, decodedSourceFirst)).toEqual(
        decodedBeforeMutation,
      );

      decodedResultFirst = await codec(consumer).decodeShapeArtifact(
        pristine,
        ARTIFACT_CONTEXT,
      );
      expect(() => producer.disposeShape(decodedSourceFirst!)).toThrow(TypeError);
      expect(() => consumer.disposeShape(source!)).toThrow(TypeError);
      expect(consumer.status(decodedSourceFirst)).toEqual({
        ok: true,
        code: "VALID",
      });
      expect(producer.status(source)).toEqual({ ok: true, code: "VALID" });

      consumer.disposeShape(decodedResultFirst);
      decodedResultFirst = undefined;
      expect(producer.status(source)).toEqual({ ok: true, code: "VALID" });
      producer.disposeShape(source);
      source = undefined;
      expect(consumer.status(decodedSourceFirst)).toEqual({
        ok: true,
        code: "VALID",
      });
    } finally {
      if (decodedResultFirst !== undefined) {
        consumer.disposeShape(decodedResultFirst);
      }
      if (decodedSourceFirst !== undefined) {
        consumer.disposeShape(decodedSourceFirst);
      }
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });

  it("rejects malformed envelope sections without mutating input or poisoning the kernel", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = box(producer, "malformed-box");
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const sections = envelopeSections(artifact);
      expect(sections.fingerprintLength).toBeGreaterThan(0);
      expect(sections.stateLength).toBeGreaterThan(0);
      expect(sections.brepLength).toBeGreaterThan(0);
      expect(sections.brepOffset + sections.brepLength).toBe(
        artifact.byteLength,
      );

      const badMagic = artifact.slice();
      badMagic[0] = badMagic[0]! ^ 0xff;
      const trailing = new Uint8Array(artifact.byteLength + 1);
      trailing.set(artifact);
      trailing[trailing.length - 1] = 0xa5;
      const badFingerprint = artifact.slice();
      badFingerprint[sections.fingerprintOffset] =
        badFingerprint[sections.fingerprintOffset]! ^ 1;
      const badState = artifact.slice();
      badState[sections.stateOffset] = 0xff;
      const badBrep = artifact.slice();
      badBrep[sections.brepOffset] =
        badBrep[sections.brepOffset]! ^ 0xff;
      const unorderedAdjacency = rewriteCanonicalState(artifact, (state) => {
        const edges = testArray(
          firstWireFace(state).edges,
          "candidate first-face edges",
        );
        expect(edges.length).toBeGreaterThan(1);
        [edges[0], edges[1]] = [edges[1], edges[0]];
      });
      const unorderedLineage = rewriteCanonicalState(artifact, (state) => {
        const lineage = testArray(
          firstWireFace(state).lineage,
          "candidate first-face lineage",
        );
        expect(lineage.length).toBeGreaterThan(1);
        [lineage[0], lineage[1]] = [lineage[1], lineage[0]];
      });
      const negativeZero = rewriteCanonicalState(artifact, (state) => {
        const surface = testRecord(
          firstWireFace(state).surface,
          "candidate first-face surface",
        );
        const normal = testArray(surface.normal, "candidate first-face normal");
        const zeroIndex = normal.findIndex(
          (value) => value === "0000000000000000",
        );
        expect(zeroIndex).toBeGreaterThanOrEqual(0);
        normal[zeroIndex] = "8000000000000000";
      });
      const topologyMismatch = rewriteCanonicalState(artifact, (state) => {
        const face = firstWireFace(state);
        expect(face.area).toEqual(expect.stringMatching(/^[0-9a-f]{16}$/));
        const area = face.area as string;
        face.area = `${area.slice(0, -1)}${area.endsWith("0") ? "1" : "0"}`;
      });
      const malformed = [
        ["magic", badMagic],
        ["declared state length", withIncrementedUint32(artifact, 28)],
        ["declared BREP length", withIncrementedUint32(artifact, 32)],
        ["trailing bytes", trailing],
        ["fingerprint", badFingerprint],
        ["state", badState],
        ["BREP", badBrep],
        ["unordered adjacency", unorderedAdjacency],
        ["unordered lineage", unorderedLineage],
        ["negative zero", negativeZero],
        ["post-adoption topology mismatch", topologyMismatch],
      ] as const;

      const consumerCodec = codec(consumer);
      expect(liveShapeCount(consumer)).toBe(0);
      for (const [label, payload] of malformed) {
        expect(payload, label).not.toEqual(artifact);
        const borrowedCopy = payload.slice();
        await expectRejected(() =>
          consumerCodec.decodeShapeArtifact(payload, ARTIFACT_CONTEXT),
        );
        expect(payload, `${label} input mutation`).toEqual(borrowedCopy);
        expect(liveShapeCount(consumer), `${label} leaked a shape`).toBe(0);
      }
      expect(producer.status(source)).toEqual({ ok: true, code: "VALID" });

      decoded = await consumerCodec.decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      expect(consumer.status(decoded)).toEqual({ ok: true, code: "VALID" });
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });

  it("rejects valid BREP substitutions with different orientation or root structure", async () => {
    const producer = await createOcctKernel();
    const alternate = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let alternateSphere: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      if (producer.sphere === undefined || alternate.sphere === undefined) {
        throw new Error("OCCT sphere support is unavailable");
      }
      source = producer.sphere(2, undefined, { feature: "oriented-sphere" });
      alternateSphere = alternate.sphere(2, undefined, {
        feature: "alternate-sphere",
      });
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const raw = rawOcctKernel(alternate);
      const alternateHandle = rawOcctShapeHandle(alternateSphere);
      const reversedHandle = raw.reverseShape(alternateHandle);
      let reversedBrep: Uint8Array;
      try {
        reversedBrep = raw.toBREPBinary(reversedHandle).slice();
      } finally {
        raw.release(reversedHandle);
      }
      const compoundHandle = raw.makeCompound([alternateHandle]);
      let compoundBrep: Uint8Array;
      try {
        compoundBrep = raw.toBREPBinary(compoundHandle).slice();
      } finally {
        raw.release(compoundHandle);
      }

      const consumerCodec = codec(consumer);
      for (const [label, payload] of [
        ["reversed root", replaceBrepSection(artifact, reversedBrep)],
        ["compound root", replaceBrepSection(artifact, compoundBrep)],
      ] as const) {
        const borrowed = payload.slice();
        await expectRejected(() =>
          consumerCodec.decodeShapeArtifact(payload, ARTIFACT_CONTEXT),
        );
        expect(payload, `${label} input mutation`).toEqual(borrowed);
        expect(liveShapeCount(consumer), `${label} leaked a shape`).toBe(0);
      }

      decoded = await consumerCodec.decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      expect(consumer.status(decoded)).toEqual({ ok: true, code: "VALID" });
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (alternateSphere !== undefined) {
        alternate.disposeShape(alternateSphere);
      }
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      alternate.dispose();
      producer.dispose();
    }
  });

  it("cleans a restored owner when abort-state inspection throws", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = box(producer, "throwing-signal-box");
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const borrowed = artifact.slice();
      const signal = Object.defineProperty({}, "aborted", {
        enumerable: true,
        get: () => {
          if (liveShapeCount(consumer) > 0) {
            throw new Error("Abort state inspection failed after restore");
          }
          return false;
        },
      }) as AbortSignal;
      const error = await expectRejected(() =>
        codec(consumer).decodeShapeArtifact(artifact, {
          ...ARTIFACT_CONTEXT,
          signal,
        }),
      );
      expect(error).toMatchObject({
        message: "Abort state inspection failed after restore",
      });
      expect(artifact).toEqual(borrowed);
      expect(liveShapeCount(consumer)).toBe(0);

      decoded = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      expect(consumer.status(decoded)).toEqual({ ok: true, code: "VALID" });
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });

  it.each(
    [
      ["modeling tolerance", { modelingTolerance: 2e-7 }],
      [
        "tessellation defaults",
        {
          tessellation: {
            linearDeflection: 0.05,
            angularDeflection: 0.2,
            relative: false,
          },
        },
      ],
      [
        "exact-evolution budgets",
        {
          maxExactBooleanHistoryRecords: 999_999,
          maxExactEdgeTreatmentHistoryRecords: 999_998,
          maxExactSolidOffsetHistoryRecords: 999_997,
        },
      ],
    ] as const satisfies readonly (readonly [string, OcctKernelOptions])[],
  )("rejects an artifact with different %s fingerprint inputs", async (_label, options) => {
    const producer = await createOcctKernel();
    const incompatible = await createOcctKernel(options);
    let source: KernelShape | undefined;
    try {
      const producerCodec = codec(producer);
      const incompatibleCodec = codec(incompatible);
      expect(incompatibleCodec.capabilities.compatibilityFingerprint).not.toBe(
        producerCodec.capabilities.compatibilityFingerprint,
      );
      source = box(producer, "fingerprint-box");
      const artifact = await producerCodec.encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const copy = artifact.slice();
      await expectRejected(() =>
        incompatibleCodec.decodeShapeArtifact(artifact, ARTIFACT_CONTEXT),
      );
      expect(artifact).toEqual(copy);
      expect(producer.status(source)).toEqual({ ok: true, code: "VALID" });
    } finally {
      if (source !== undefined) producer.disposeShape(source);
      incompatible.dispose();
      producer.dispose();
    }
  });
});
