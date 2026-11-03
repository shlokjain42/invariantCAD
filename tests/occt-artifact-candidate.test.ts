import { describe, expect, it } from "vitest";
import type {
  OcctKernel as RawOcctKernel,
  ShapeHandle,
} from "occt-wasm";
import { inspectKernelShapeArtifactSupport } from "../src/artifact-cache.js";
import type { KernelShapeArtifactCodecCandidate } from "../src/conformance.js";
import {
  getOcctShapeArtifactCandidateHost,
  getOcctShapeArtifactCodecCandidate,
  registerOcctShapeArtifactCandidateHost,
  type OcctShapeArtifactCandidateHost,
  type OcctShapeArtifactCapturedSidecarState,
  type OcctShapeArtifactCapturedState,
} from "../src/internal/occt-artifact-candidate.js";
import {
  decodeOcctArtifactSidecarV2,
  encodeOcctArtifactSidecarV2,
} from "../src/internal/occt-artifact-sidecar-v2.js";
import { OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATHS } from "../src/internal/occt-artifact-identity-v1.js";
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
import type {
  KernelTopologyLineage,
  KernelTopologySnapshot,
} from "../src/protocol/topology.js";
import {
  observeKernelShapeSemanticsV2,
  type KernelShapeSemanticObservationV2,
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

/**
 * Creates a producer and a consumer kernel. When the second creation fails,
 * the first kernel is disposed before the failure propagates, so a test's own
 * try/finally only ever owns kernels that both exist.
 */
async function createProducerAndConsumer(): Promise<
  readonly [GeometryKernel, GeometryKernel]
> {
  const producer = await createOcctKernel();
  try {
    return [producer, await createOcctKernel()];
  } catch (error) {
    producer.dispose();
    throw error;
  }
}

function codecWithRuntimePairIdentity(
  kernel: GeometryKernel,
  runtimePairIdentity: string,
): {
  readonly codec: KernelShapeArtifactCodecCandidate;
  readonly restoreCalls: () => number;
} {
  const host = getOcctShapeArtifactCandidateHost(kernel);
  if (host === undefined) {
    throw new Error("The stock OCCT runtime did not expose its candidate host");
  }
  const compatibilityFingerprint = host.compatibilityFingerprint.replace(
    ";modelingTolerance=",
    `;runtimeAttestation=${runtimePairIdentity};modelingTolerance=`,
  );
  if (compatibilityFingerprint === host.compatibilityFingerprint) {
    throw new Error("The OCCT candidate fingerprint shape changed");
  }
  let restoreCalls = 0;
  const wrappedHost: OcctShapeArtifactCandidateHost = Object.freeze({
    compatibilityFingerprint,
    capture: host.capture,
    encodeNative: host.encodeNative,
    restore: (
      state: OcctShapeArtifactCapturedState,
      signal?: AbortSignal,
    ) => {
      restoreCalls += 1;
      return host.restore(state, signal);
    },
  });
  const wrappedKernel = new Proxy(kernel, {});
  registerOcctShapeArtifactCandidateHost(wrappedKernel, wrappedHost);
  const candidate = getOcctShapeArtifactCodecCandidate(wrappedKernel);
  if (candidate === undefined) {
    throw new Error("The runtime-pair candidate codec was unavailable");
  }
  return {
    codec: candidate,
    restoreCalls: () => restoreCalls,
  };
}

function box(kernel: GeometryKernel, feature = "role-box"): KernelShape {
  if (kernel.box === undefined) throw new Error("OCCT box support is unavailable");
  return kernel.box([2, 3, 5], false, { feature });
}

function sphere(kernel: GeometryKernel, feature: string): KernelShape {
  if (kernel.sphere === undefined) {
    throw new Error("OCCT sphere support is unavailable");
  }
  return kernel.sphere(2, undefined, { feature });
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
    id: "occt-artifact-candidate-direct-v2",
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
): Promise<KernelShapeSemanticObservationV2> {
  const result = await observeKernelShapeSemanticsV2(kernel, shape, plan);
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
  readonly identityOffset: number;
  readonly identityLength: number;
  readonly brepOffset: number;
  readonly brepLength: number;
}

function envelopeSections(artifact: Uint8Array): CandidateEnvelopeSections {
  // Candidate format v3 uses a fixed 44-byte big-endian header. Keeping this
  // parser here makes corruption cases target declared sections, not lucky
  // byte positions inside one fixture.
  expect(artifact.byteLength).toBeGreaterThanOrEqual(44);
  const header = new DataView(artifact.buffer, artifact.byteOffset, 44);
  expect(header.getUint32(20, false)).toBe(44);
  const fingerprintLength = header.getUint32(24, false);
  const stateLength = header.getUint32(28, false);
  const identityLength = header.getUint32(32, false);
  const brepLength = header.getUint32(36, false);
  const fingerprintOffset = 44;
  const stateOffset = fingerprintOffset + fingerprintLength;
  const identityOffset = stateOffset + stateLength;
  return {
    fingerprintOffset,
    fingerprintLength,
    stateOffset,
    stateLength,
    identityOffset,
    identityLength,
    brepOffset: identityOffset + identityLength,
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

function rewriteSidecarState(
  artifact: Uint8Array,
  transform: (
    state: OcctShapeArtifactCapturedSidecarState,
  ) => OcctShapeArtifactCapturedSidecarState,
): Uint8Array {
  const sections = envelopeSections(artifact);
  const state = decodeOcctArtifactSidecarV2(
    artifact.subarray(
      sections.stateOffset,
      sections.stateOffset + sections.stateLength,
    ),
  );
  const encodedState = encodeOcctArtifactSidecarV2(transform(state), {
    maxBytes: MAX_ARTIFACT_BYTES,
  });
  const nextLength =
    artifact.byteLength - sections.stateLength + encodedState.byteLength;
  const rewritten = new Uint8Array(nextLength);
  rewritten.set(artifact.subarray(0, sections.stateOffset), 0);
  rewritten.set(encodedState, sections.stateOffset);
  rewritten.set(
    artifact.subarray(
      sections.identityOffset,
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
  header.setUint32(40, rewritten.byteLength, false);
  return rewritten;
}

function withFirstFaceAreaMismatch(
  state: OcctShapeArtifactCapturedSidecarState,
): OcctShapeArtifactCapturedSidecarState {
  const face = state.topology.faces[0];
  if (face === undefined) throw new TypeError("Candidate state has no first face");
  return {
    ...state,
    topology: {
      ...state.topology,
      faces: [{ ...face, area: face.area + 0.125 }, ...state.topology.faces.slice(1)],
    },
  };
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
  header.setUint32(36, brep.byteLength, false);
  header.setUint32(40, rewritten.byteLength, false);
  return rewritten;
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

function reverseRawSubshapeEnumeration(kernel: GeometryKernel): () => void {
  const raw = rawOcctKernel(kernel);
  const original = raw.getSubShapes.bind(raw);
  raw.getSubShapes = ((...args: Parameters<typeof original>) =>
    original(...args).reverse()) as typeof raw.getSubShapes;
  return () => {
    raw.getSubShapes = original;
  };
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

function regularPolygonProfile(sides: number, radius: number): ResolvedProfile {
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = (2 * Math.PI * index) / sides;
    return [radius * Math.cos(angle), radius * Math.sin(angle)] as const;
  });
  return {
    plane: { plane: "XY", origin: [0, 0, 0] },
    outer: {
      curves: points.map((start, index) => ({
        kind: "line" as const,
        start,
        end: points[(index + 1) % sides]!,
        source: {
          kind: "sketch-entity" as const,
          sketch: "artifact-polygon-profile",
          entity: `side-${index}` as ProfileCurveSource["entity"],
        },
      })),
    },
    holes: [],
  };
}

function polygonPrism(
  kernel: GeometryKernel,
  sides: number,
  feature: string,
): KernelShape {
  if (kernel.extrude === undefined) {
    throw new Error("OCCT extrusion support is unavailable");
  }
  return kernel.extrude(
    regularPolygonProfile(sides, 10),
    { distance: 10, symmetric: false, twist: 0, scaleTop: [1, 1], divisions: 0 },
    { feature },
  );
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

// These tests start real OCCT WebAssembly runtimes, which can exceed vitest's
// 5 s default under coverage on a loaded host; 30 s still fails a real hang.
describe("OCCT shape-artifact codec candidate", { timeout: 30_000 }, () => {
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
      const host = getOcctShapeArtifactCandidateHost(kernel);
      expect(host).toBeDefined();
      if (host === undefined) throw new Error("Expected candidate host");
      const malformedHost = Object.freeze({
        ...host,
        compatibilityFingerprint: `unpaired-\ud800`,
      });
      const malformedKernel = new Proxy(kernel, {});
      registerOcctShapeArtifactCandidateHost(malformedKernel, malformedHost);
      expect(getOcctShapeArtifactCodecCandidate(malformedKernel)).toBeUndefined();
    } finally {
      kernel.dispose();
    }
  });

  it("keeps the candidate host unreachable by reflection on the kernel", async () => {
    const kernel = await createOcctKernel();
    try {
      const host = getOcctShapeArtifactCandidateHost(kernel);
      expect(host).toBeDefined();
      if (host === undefined) throw new Error("Expected candidate host");
      const reachable = new Set<unknown>();
      for (
        let target: object | null = kernel;
        target !== null && target !== Object.prototype;
        target = Object.getPrototypeOf(target) as object | null
      ) {
        for (const key of Reflect.ownKeys(target)) {
          // Package consumers can enumerate every own key; none may be a
          // symbol, and no member may name the candidate operations.
          expect(typeof key).toBe("string");
          expect(String(key)).not.toMatch(/shapeartifactcandidate/iu);
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          if (descriptor !== undefined && "value" in descriptor) {
            reachable.add(descriptor.value);
          }
        }
      }
      expect(reachable.has(host)).toBe(false);
      expect(reachable.has(host.capture)).toBe(false);
      expect(reachable.has(host.encodeNative)).toBe(false);
      expect(reachable.has(host.restore)).toBe(false);

      // The registry is keyed by object identity: an unregistered wrapper
      // gets no candidate, and an existing registration cannot be replaced.
      expect(getOcctShapeArtifactCodecCandidate(new Proxy(kernel, {})))
        .toBeUndefined();
      expect(() => registerOcctShapeArtifactCandidateHost(kernel, host))
        .toThrow(/already registered/u);
      expect(getOcctShapeArtifactCandidateHost(kernel)).toBe(host);
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

  it.each([7, 24])(
    "round-trips a non-rectilinear %i-sided prism whose derived bounds drift in binary BREP",
    async (sides) => {
      const [producer, consumer] = await createProducerAndConsumer();
      let source: KernelShape | undefined;
      let reimported: KernelShape | undefined;
      const decoded: (readonly [GeometryKernel, KernelShape])[] = [];
      try {
        source = polygonPrism(producer, sides, `prism-${sides}`);
        const artifact = await codec(producer).encodeShapeArtifact(
          source,
          ARTIFACT_CONTEXT,
        );
        for (const kernel of [producer, consumer]) {
          const shape = await codec(kernel).decodeShapeArtifact(
            artifact,
            ARTIFACT_CONTEXT,
          );
          decoded.push([kernel, shape]);
          expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
          // The stored descriptors, not native recomputations, are restored,
          // so the semantic observation still matches the source exactly.
          const plan = observationPlan(producer);
          expect(await observe(kernel, shape, plan)).toEqual(
            await observe(producer, source, plan),
          );
          expectFreshTopologyKeys(
            topology(producer, source),
            topology(kernel, shape),
          );
        }

        // A source that already went through one binary-BREP reload drifts
        // again on the next reload and must still round-trip.
        if (producer.exportShape === undefined || producer.importShape === undefined) {
          throw new Error("OCCT binary-BREP exchange support is unavailable");
        }
        reimported = producer.importShape(
          producer.exportShape(source, "brep-binary", { feature: "prism-export" }),
          "brep-binary",
          { feature: "prism-import" },
        );
        const reimportedArtifact = await codec(producer).encodeShapeArtifact(
          reimported,
          ARTIFACT_CONTEXT,
        );
        const shape = await codec(consumer).decodeShapeArtifact(
          reimportedArtifact,
          ARTIFACT_CONTEXT,
        );
        decoded.push([consumer, shape]);
        expect(consumer.status(shape)).toEqual({ ok: true, code: "VALID" });
      } finally {
        for (const [kernel, shape] of decoded) kernel.disposeShape(shape);
        if (reimported !== undefined) producer.disposeShape(reimported);
        if (source !== undefined) producer.disposeShape(source);
        consumer.dispose();
        producer.dispose();
      }
    },
    60_000,
  );

  it("derives the descriptor tolerance from each restored native item, not the sidecar", async () => {
    const [producer, consumer] = await createProducerAndConsumer();
    let roleBox: KernelShape | undefined;
    let slenderBox: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      if (producer.box === undefined) {
        throw new Error("OCCT box support is unavailable");
      }
      roleBox = box(producer);
      // The far end face sits at 1e9 while the near end face stays at unit
      // scale, so one model-wide scale would loosen the near face's checks.
      slenderBox = producer.box([1e9, 1, 1], false, { feature: "slender-box" });
      const producerCodec = codec(producer);
      const roleArtifact = await producerCodec.encodeShapeArtifact(
        roleBox,
        ARTIFACT_CONTEXT,
      );
      const slenderArtifact = await producerCodec.encodeShapeArtifact(
        slenderBox,
        ARTIFACT_CONTEXT,
      );

      // A finite but extreme stored bound once became the comparison scale,
      // whose unit in the last place overflowed to Infinity and admitted any
      // other stored descriptor.
      const overflowingBound = rewriteSidecarState(roleArtifact, (state) => {
        const [face, ...faces] = state.topology.faces;
        const [edge, ...edges] = state.topology.edges;
        if (face === undefined || edge === undefined) {
          throw new TypeError("Candidate state lacks a face or an edge");
        }
        const [x, y, z] = edge.center;
        return {
          ...state,
          topology: {
            ...state.topology,
            faces: [
              {
                ...face,
                bounds: {
                  ...face.bounds,
                  max: [Number.MAX_VALUE, face.bounds.max[1], face.bounds.max[2]],
                },
              },
              ...faces,
            ],
            edges: [{ ...edge, center: [x + 0.5, y, z] }, ...edges],
          },
        };
      });
      // A small shift on the unit-scale end face hides inside 64 units in
      // the last place of 1e9 but not of the face's own native scale.
      const nearFaceShift = rewriteSidecarState(slenderArtifact, (state) => {
        const index = state.topology.faces.findIndex(
          (face) => face.bounds.max[0] < 1,
        );
        const face = state.topology.faces[index];
        if (face === undefined) {
          throw new TypeError("Slender box state lacks its near end face");
        }
        const [x, y, z] = face.center;
        const faces = [...state.topology.faces];
        faces[index] = { ...face, center: [x, y + 1e-6, z] };
        return { ...state, topology: { ...state.topology, faces } };
      });

      const consumerCodec = codec(consumer);
      for (const [label, payload] of [
        ["overflowing stored bound", overflowingBound],
        ["near-face shift on a slender box", nearFaceShift],
      ] as const) {
        const borrowed = payload.slice();
        await expectRejected(() =>
          consumerCodec.decodeShapeArtifact(payload, ARTIFACT_CONTEXT),
        );
        expect(payload, `${label} input mutation`).toEqual(borrowed);
        expect(liveShapeCount(consumer), `${label} leaked a shape`).toBe(0);
      }

      decoded = await consumerCodec.decodeShapeArtifact(
        slenderArtifact,
        ARTIFACT_CONTEXT,
      );
      expect(consumer.status(decoded)).toEqual({ ok: true, code: "VALID" });
      const centers = (snapshot: KernelTopologySnapshot) =>
        snapshot.faces.map((face) => JSON.stringify(face.center)).sort();
      expect(centers(topology(consumer, decoded))).toEqual(
        centers(topology(producer, slenderBox)),
      );
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (slenderBox !== undefined) producer.disposeShape(slenderBox);
      if (roleBox !== undefined) producer.disposeShape(roleBox);
      consumer.dispose();
      producer.dispose();
    }
  }, 30_000);

  it("does not let distance from the origin loosen lengths, areas, or radii", async () => {
    const [producer, consumer] = await createProducerAndConsumer();
    const sources: KernelShape[] = [];
    const decoded: KernelShape[] = [];
    try {
      if (
        producer.box === undefined ||
        producer.cylinder === undefined ||
        producer.transform === undefined
      ) {
        throw new Error("OCCT box, cylinder, or transform support is unavailable");
      }
      const transform = producer.transform.bind(producer);
      // At x = 1e12 a coordinate's unit in the last place is about 1.2e-4,
      // so 64 of them exceed the 0.01 size of these items. Lengths, areas,
      // and radii do not depend on position, so that distance must not widen
      // their checks the way it widens checks on centers and bounds.
      const farAway = (shape: KernelShape, feature: string): KernelShape => {
        try {
          return transform(
            shape,
            [{ kind: "translate", value: [1e12, 0, 0] }],
            { feature },
          );
        } finally {
          producer.disposeShape(shape);
        }
      };
      const farBox = farAway(
        producer.box([1, 0.01, 0.01], false, { feature: "far-small-box" }),
        "far-small-box-move",
      );
      sources.push(farBox);
      const farCylinder = farAway(
        producer.cylinder(1, 0.01, 0.01, false, undefined, {
          feature: "far-small-cylinder",
        }),
        "far-small-cylinder-move",
      );
      sources.push(farCylinder);
      const producerCodec = codec(producer);
      const boxArtifact = await producerCodec.encodeShapeArtifact(
        farBox,
        ARTIFACT_CONTEXT,
      );
      const cylinderArtifact = await producerCodec.encodeShapeArtifact(
        farCylinder,
        ARTIFACT_CONTEXT,
      );

      const rewriteEdge = (
        artifact: Uint8Array,
        select: (edge: KernelTopologySnapshot["edges"][number]) => boolean,
        change: (
          edge: KernelTopologySnapshot["edges"][number],
        ) => KernelTopologySnapshot["edges"][number],
      ) =>
        rewriteSidecarState(artifact, (state) => {
          const edges = [...state.topology.edges];
          const index = edges.findIndex(select);
          const edge = edges[index];
          if (edge === undefined) {
            throw new TypeError("Far-away state lacks the selected edge");
          }
          edges[index] = change(edge);
          return { ...state, topology: { ...state.topology, edges } };
        });
      const shortEdge = (edge: KernelTopologySnapshot["edges"][number]) =>
        edge.length < 0.1;
      const circularEdge = (edge: KernelTopologySnapshot["edges"][number]) =>
        edge.curve.radius !== undefined;
      const halvedLength = rewriteEdge(boxArtifact, shortEdge, (edge) => ({
        ...edge,
        length: edge.length / 2,
      }));
      const halvedArea = rewriteSidecarState(boxArtifact, (state) => {
        const faces = [...state.topology.faces];
        const index = faces.findIndex((face) => face.area < 0.001);
        const face = faces[index];
        if (face === undefined) {
          throw new TypeError("Far-away box state lacks a small end face");
        }
        faces[index] = { ...face, area: face.area / 2 };
        return { ...state, topology: { ...state.topology, faces } };
      });
      const halvedRadius = rewriteEdge(cylinderArtifact, circularEdge, (edge) => ({
        ...edge,
        curve: { ...edge.curve, radius: edge.curve.radius! / 2 },
      }));

      const consumerCodec = codec(consumer);
      for (const [label, payload] of [
        ["halved short-edge length", halvedLength],
        ["halved end-face area", halvedArea],
        ["halved circular-edge radius", halvedRadius],
      ] as const) {
        const borrowed = payload.slice();
        const error = await expectRejected(() =>
          consumerCodec.decodeShapeArtifact(payload, ARTIFACT_CONTEXT),
        );
        expect(String(error), label).toMatch(/changed identified (face|edge)/u);
        expect(payload, `${label} input mutation`).toEqual(borrowed);
        expect(liveShapeCount(consumer), `${label} leaked a shape`).toBe(0);
      }

      // Unchanged artifacts, and a sidecar rewritten within its own scale,
      // still decode, so the rejections above come from the size checks.
      const nudgedLength = rewriteEdge(boxArtifact, shortEdge, (edge) => ({
        ...edge,
        length: edge.length + 4 * Number.EPSILON * edge.length,
      }));
      for (const payload of [boxArtifact, cylinderArtifact, nudgedLength]) {
        const shape = await consumerCodec.decodeShapeArtifact(
          payload,
          ARTIFACT_CONTEXT,
        );
        decoded.push(shape);
        expect(consumer.status(shape)).toEqual({ ok: true, code: "VALID" });
      }
    } finally {
      for (const shape of decoded) consumer.disposeShape(shape);
      for (const shape of sources) producer.disposeShape(shape);
      consumer.dispose();
      producer.dispose();
    }
  }, 30_000);

  it("emits identical bytes and remaps a symmetric solid when TopExp enumeration reverses", async () => {
    const normalProducer = await createOcctKernel();
    const reversedProducer = await createOcctKernel();
    const reversedConsumer = await createOcctKernel();
    const restoreProducerEnumeration =
      reverseRawSubshapeEnumeration(reversedProducer);
    const restoreConsumerEnumeration =
      reverseRawSubshapeEnumeration(reversedConsumer);
    let normalSource: KernelShape | undefined;
    let reversedSource: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      if (
        normalProducer.box === undefined ||
        reversedProducer.box === undefined
      ) {
        throw new Error("OCCT box support is unavailable");
      }
      normalSource = normalProducer.box([5, 5, 5], false, {
        feature: "symmetric-identity-box",
      });
      reversedSource = reversedProducer.box([5, 5, 5], false, {
        feature: "symmetric-identity-box",
      });
      const normalArtifact = await codec(normalProducer).encodeShapeArtifact(
        normalSource,
        ARTIFACT_CONTEXT,
      );
      const reversedArtifact = await codec(reversedProducer).encodeShapeArtifact(
        reversedSource,
        ARTIFACT_CONTEXT,
      );
      expect(reversedArtifact).toEqual(normalArtifact);

      decoded = await codec(reversedConsumer).decodeShapeArtifact(
        normalArtifact,
        ARTIFACT_CONTEXT,
      );
      const plan = observationPlan(normalProducer);
      expect(await observe(reversedConsumer, decoded, plan)).toEqual(
        await observe(normalProducer, normalSource, plan),
      );
      expectFreshTopologyKeys(
        topology(normalProducer, normalSource),
        topology(reversedConsumer, decoded),
      );
    } finally {
      restoreConsumerEnumeration();
      restoreProducerEnumeration();
      if (decoded !== undefined) reversedConsumer.disposeShape(decoded);
      if (reversedSource !== undefined) {
        reversedProducer.disposeShape(reversedSource);
      }
      if (normalSource !== undefined) {
        normalProducer.disposeShape(normalSource);
      }
      reversedConsumer.dispose();
      reversedProducer.dispose();
      normalProducer.dispose();
    }
  });

  it.each([
    ["role-rich box", (kernel: GeometryKernel) => box(kernel, "warm-role-box")],
    ["curved sphere", (kernel: GeometryKernel) => sphere(kernel, "warm-sphere")],
  ] as const)("does not change an already mesh- and topology-warm %s source", async (_name, create) => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = create(producer);
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
  }, 30_000);

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

  it("keeps NUL-containing lineage fields structurally distinct", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = box(producer, "nul-lineage-box");
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const collidingUnderDelimiterJoin: readonly KernelTopologyLineage[] = [
        {
          feature: "nul-lineage",
          relation: "created",
          source: {
            kind: "sketch-entity",
            sketch: "a\0b",
            entity: "c",
          },
        },
        {
          feature: "nul-lineage",
          relation: "created",
          source: {
            kind: "sketch-entity",
            sketch: "a",
            entity: "b\0c",
          },
        },
      ];
      const rewritten = rewriteSidecarState(artifact, (state) => ({
        ...state,
        lineage: collidingUnderDelimiterJoin,
      }));
      decoded = await codec(consumer).decodeShapeArtifact(
        rewritten,
        ARTIFACT_CONTEXT,
      );
      const restoredLineage = (
        decoded as KernelShape & {
          readonly lineage: readonly KernelTopologyLineage[];
        }
      ).lineage;
      expect(restoredLineage).toHaveLength(2);
      expect(restoredLineage.map(({ source }) => source)).toEqual(
        expect.arrayContaining(collidingUnderDelimiterJoin.map(({ source }) => source)),
      );
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
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

  it("decodes every artifact the encoder admits at the sidecar string ceiling", async () => {
    const [producer, consumer] = await createProducerAndConsumer();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      const producerCodec = codec(producer);
      // U+4E00 is two UTF-16 bytes, which the sidecar ceiling counts, but three
      // UTF-8 bytes. Synthesized topology keys and every adjacency occurrence
      // add further UTF-8 strings that no declared sidecar total includes.
      const featureOf = (length: number) => "一".repeat(length);
      const encodes = async (length: number): Promise<boolean> => {
        const shape = box(producer, featureOf(length));
        try {
          await producerCodec.encodeShapeArtifact(shape, ARTIFACT_CONTEXT);
          return true;
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          expect(error.message).toMatch(/string budget was exceeded/u);
          return false;
        } finally {
          producer.disposeShape(shape);
        }
      };
      let admitted = 1;
      let refused = 64_000;
      expect(await encodes(admitted)).toBe(true);
      expect(await encodes(refused)).toBe(false);
      while (refused - admitted > 1) {
        const middle = Math.floor((admitted + refused) / 2);
        if (await encodes(middle)) admitted = middle;
        else refused = middle;
      }

      source = box(producer, featureOf(admitted));
      const artifact = await producerCodec.encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      decoded = await codec(consumer).decodeShapeArtifact(artifact, {
        ...ARTIFACT_CONTEXT,
        maxArtifactBytes: artifact.byteLength,
      });
      expect(consumer.status(decoded)).toEqual({ ok: true, code: "VALID" });
      expect(topology(consumer, decoded).faces[0]?.lineage).toEqual(
        topology(producer, source).faces[0]?.lineage,
      );
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  }, 60_000);

  it("preflights unique identity counts before materializing topology handle arrays", async () => {
    const kernel = await createOcctKernel();
    let source: KernelShape | undefined;
    try {
      source = box(kernel, "identity-preflight-box");
      const raw = rawOcctKernel(kernel);
      const originalSubShapeCount = raw.subShapeCount;
      const originalGetSubShapes = raw.getSubShapes;
      let materializationCalls = 0;
      raw.subShapeCount = ((shape, kind) =>
        kind === "solid"
          ? OCCT_ARTIFACT_NATIVE_IDENTITY_V1_MAX_PATHS + 1
          : originalSubShapeCount.call(raw, shape, kind)) as typeof raw.subShapeCount;
      raw.getSubShapes = ((shape, kind) => {
        materializationCalls += 1;
        return originalGetSubShapes.call(raw, shape, kind);
      }) as typeof raw.getSubShapes;
      try {
        const error = await expectRejected(() =>
          codec(kernel).encodeShapeArtifact(source!, ARTIFACT_CONTEXT),
        );
        expect(error).toBeInstanceOf(RangeError);
        expect(error).toMatchObject({
          message: expect.stringMatching(/too many unique subshapes/),
        });
        expect(materializationCalls).toBe(0);
      } finally {
        raw.getSubShapes = originalGetSubShapes;
        raw.subShapeCount = originalSubShapeCount;
      }
      expect(kernel.status(source)).toEqual({ ok: true, code: "VALID" });
    } finally {
      if (source !== undefined) kernel.disposeShape(source);
      kernel.dispose();
    }
  });

  it("snapshots hostile Uint8Array subclasses before section parsing", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = box(producer, "hostile-artifact-array-box");
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      if (typeof SharedArrayBuffer === "undefined") return;
      const sharedBytes = new Uint8Array(
        new SharedArrayBuffer(artifact.byteLength),
      );
      sharedBytes.set(artifact);
      let attackerMethodCalls = 0;
      class HostileArtifactArray extends Uint8Array {
        override subarray(
          begin?: number,
          end?: number,
        ): Uint8Array<ArrayBuffer> {
          attackerMethodCalls += 1;
          return sharedBytes.subarray(
            begin,
            end,
          ) as unknown as Uint8Array<ArrayBuffer>;
        }

        override slice(
          start?: number,
          end?: number,
        ): Uint8Array<ArrayBuffer> {
          attackerMethodCalls += 1;
          return sharedBytes.slice(
            start,
            end,
          ) as unknown as Uint8Array<ArrayBuffer>;
        }
      }
      const hostile = new HostileArtifactArray(artifact);
      decoded = await codec(consumer).decodeShapeArtifact(
        hostile,
        ARTIFACT_CONTEXT,
      );
      expect(attackerMethodCalls).toBe(0);
      expect(consumer.measure(decoded)).toEqual(producer.measure(source));
      expect(new Uint8Array(hostile.buffer)).toEqual(artifact);
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
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
      expect(sections.identityLength).toBeGreaterThan(0);
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
      const badIdentity = artifact.slice();
      badIdentity[sections.identityOffset] = 0xff;
      const badStateLength = withIncrementedUint32(
        artifact,
        sections.stateOffset + 12,
      );
      const badBrep = artifact.slice();
      badBrep[sections.brepOffset] =
        badBrep[sections.brepOffset]! ^ 0xff;
      const topologyMismatch = rewriteSidecarState(
        artifact,
        withFirstFaceAreaMismatch,
      );
      const malformed = [
        ["magic", badMagic],
        ["declared state length", withIncrementedUint32(artifact, 28)],
        ["declared identity length", withIncrementedUint32(artifact, 32)],
        ["declared BREP length", withIncrementedUint32(artifact, 36)],
        ["trailing bytes", trailing],
        ["fingerprint", badFingerprint],
        ["state", badState],
        ["identity", badIdentity],
        ["inner state length", badStateLength],
        ["BREP", badBrep],
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
      if (typeof SharedArrayBuffer !== "undefined") {
        const shared = new Uint8Array(
          new SharedArrayBuffer(artifact.byteLength),
        );
        shared.set(artifact);
        const error = await expectRejected(() =>
          consumerCodec.decodeShapeArtifact(shared, ARTIFACT_CONTEXT),
        );
        expect(error).toMatchObject({
          message: expect.stringMatching(/SharedArrayBuffer/),
        });
        expect(liveShapeCount(consumer)).toBe(0);
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

  it("does not claim strict BREP-section EOF for the stock runtime", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = box(producer, "stock-brep-eof-box");
      const producerCodec = codec(producer);
      const consumerCodec = codec(consumer);
      const artifact = await producerCodec.encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const sections = envelopeSections(artifact);
      const brepWithSuffix = new Uint8Array(sections.brepLength + 1);
      brepWithSuffix.set(
        artifact.subarray(
          sections.brepOffset,
          sections.brepOffset + sections.brepLength,
        ),
      );
      brepWithSuffix[brepWithSuffix.byteLength - 1] = 0xa5;
      const suffixedArtifact = replaceBrepSection(artifact, brepWithSuffix);
      const borrowed = suffixedArtifact.slice();

      decoded = await consumerCodec.decodeShapeArtifact(
        suffixedArtifact,
        ARTIFACT_CONTEXT,
      );
      expect(suffixedArtifact).toEqual(borrowed);
      expect(await observe(consumer, decoded)).toEqual(
        await observe(producer, source),
      );

      const canonical = await consumerCodec.encodeShapeArtifact(
        decoded,
        ARTIFACT_CONTEXT,
      );
      expect(canonical).not.toEqual(suffixedArtifact);
      const canonicalSections = envelopeSections(canonical);
      expect(
        canonical.subarray(
          canonicalSections.brepOffset,
          canonicalSections.brepOffset + canonicalSections.brepLength,
        ),
      ).not.toEqual(brepWithSuffix);
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
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

  it("best-effort releases a partially restored owner after one retained-handle release throws", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = box(producer, "release-failure-box");
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const topologyMismatch = rewriteSidecarState(
        artifact,
        withFirstFaceAreaMismatch,
      );
      const raw = rawOcctKernel(consumer);
      const originalRelease = raw.release.bind(raw);
      const arenaBefore = raw.shapeCount;
      let injected = false;
      raw.release = (handle: ShapeHandle): void => {
        const liveShapes = (
          consumer as unknown as { readonly liveShapes: Set<unknown> }
        ).liveShapes;
        const provisional = [...liveShapes][0] as
          | {
              readonly topologyHandles: Map<
                unknown,
                { readonly handle: ShapeHandle }
              >;
            }
          | undefined;
        const isRetained =
          provisional !== undefined &&
          [...provisional.topologyHandles.values()].some(
            (retained) => retained.handle === handle,
          );
        originalRelease(handle);
        if (!injected && isRetained) {
          injected = true;
          throw new Error("Injected retained-handle release failure");
        }
      };
      let error: unknown;
      try {
        error = await expectRejected(() =>
          codec(consumer).decodeShapeArtifact(
            topologyMismatch,
            ARTIFACT_CONTEXT,
          ),
        );
      } finally {
        raw.release = originalRelease;
      }
      expect(injected).toBe(true);
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "Injected retained-handle release failure",
          }),
        ]),
      );
      expect(liveShapeCount(consumer)).toBe(0);
      expect(raw.shapeCount).toBe(arenaBefore);

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

  it("rejects another attested runtime-pair identity before native restore", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    const firstPair =
      `invariantcad-occt-runtime-pair@1:sha256:${"a".repeat(64)}`;
    const secondPair =
      `invariantcad-occt-runtime-pair@1:sha256:${"b".repeat(64)}`;
    const producerCandidate = codecWithRuntimePairIdentity(
      producer,
      firstPair,
    );
    const compatibleCandidate = codecWithRuntimePairIdentity(
      consumer,
      firstPair,
    );
    const incompatibleCandidate = codecWithRuntimePairIdentity(
      consumer,
      secondPair,
    );
    let source: KernelShape | undefined;
    let restored: KernelShape | undefined;
    try {
      expect(producerCandidate.codec.capabilities.compatibilityFingerprint).toBe(
        compatibleCandidate.codec.capabilities.compatibilityFingerprint,
      );
      expect(
        incompatibleCandidate.codec.capabilities.compatibilityFingerprint,
      ).not.toBe(
        producerCandidate.codec.capabilities.compatibilityFingerprint,
      );
      source = box(producer, "runtime-pair-fingerprint-box");
      const artifact = await producerCandidate.codec.encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const borrowed = artifact.slice();

      await expectRejected(() =>
        incompatibleCandidate.codec.decodeShapeArtifact(
          artifact,
          ARTIFACT_CONTEXT,
        ),
      );
      expect(artifact).toEqual(borrowed);
      expect(incompatibleCandidate.restoreCalls()).toBe(0);
      expect(liveShapeCount(consumer)).toBe(0);

      restored = await compatibleCandidate.codec.decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      expect(compatibleCandidate.restoreCalls()).toBe(1);
      expect(consumer.status(restored)).toEqual({ ok: true, code: "VALID" });
    } finally {
      if (restored !== undefined) consumer.disposeShape(restored);
      if (source !== undefined) producer.disposeShape(source);
      consumer.dispose();
      producer.dispose();
    }
  });
});

describe("stock OCCT semantic observation repeatability", () => {
  const coarse = Object.freeze({ linearDeflection: 1 });
  const fine = Object.freeze({ linearDeflection: 0.05 });

  function meshPlan(
    kernel: GeometryKernel,
    meshes: KernelShapeSemanticObservationPlan["meshes"],
  ): KernelShapeSemanticObservationPlan {
    return {
      id: "occt-mesh-repeatability",
      meshes,
      topology: "omit",
      nativeExchanges: [],
      probes: [],
      notApplicableFeatures: kernel.capabilities.features.map((feature) => ({
        feature,
        reason: "Mesh repeatability does not exercise downstream features",
      })),
    };
  }

  function triangles(
    observation: KernelShapeSemanticObservationV2,
    id: string,
  ): KernelShapeSemanticObservationV2["meshes"][number]["triangles"] {
    const mesh = observation.meshes.find((candidate) => candidate.id === id);
    if (mesh === undefined) throw new Error(`Missing observed mesh ${id}`);
    return mesh.triangles;
  }

  function curvedSphere(kernel: GeometryKernel, feature: string): KernelShape {
    if (kernel.sphere === undefined) {
      throw new Error("OCCT sphere support is unavailable");
    }
    return kernel.sphere(5, undefined, { feature });
  }

  it("observes the same curved shape twice with equal witnesses", async () => {
    const kernel = await createOcctKernel();
    let shape: KernelShape | undefined;
    try {
      shape = curvedSphere(kernel, "repeat-sphere");
      const plan = meshPlan(kernel, [
        { id: "a-fine", options: fine },
        { id: "b-coarse", options: coarse },
      ]);
      const first = await observe(kernel, shape, plan);
      const second = await observe(kernel, shape, plan);
      expect(triangles(first, "b-coarse").length).toBeLessThan(
        triangles(first, "a-fine").length,
      );
      expect(second).toEqual(first);
    } finally {
      if (shape !== undefined) kernel.disposeShape(shape);
      kernel.dispose();
    }
  }, 30_000);

  it("does not let request-id order change any request's triangles", async () => {
    const kernel = await createOcctKernel();
    const shapes: KernelShape[] = [];
    try {
      const fineFirst = curvedSphere(kernel, "fine-first-sphere");
      shapes.push(fineFirst);
      const coarseFirst = curvedSphere(kernel, "coarse-first-sphere");
      shapes.push(coarseFirst);
      const fineSortsFirst = await observe(
        kernel,
        fineFirst,
        meshPlan(kernel, [
          { id: "b-coarse", options: coarse },
          { id: "a-fine", options: fine },
        ]),
      );
      const coarseSortsFirst = await observe(
        kernel,
        coarseFirst,
        meshPlan(kernel, [
          { id: "a-coarse", options: coarse },
          { id: "b-fine", options: fine },
        ]),
      );
      expect(triangles(fineSortsFirst, "b-coarse")).toEqual(
        triangles(coarseSortsFirst, "a-coarse"),
      );
      expect(triangles(fineSortsFirst, "a-fine")).toEqual(
        triangles(coarseSortsFirst, "b-fine"),
      );
    } finally {
      for (const shape of shapes) kernel.disposeShape(shape);
      kernel.dispose();
    }
  }, 30_000);

  it("does not let an earlier kernel mesh change the observation", async () => {
    const kernel = await createOcctKernel();
    const shapes: KernelShape[] = [];
    try {
      const plan = meshPlan(kernel, [{ id: "coarse", options: coarse }]);
      const cold = curvedSphere(kernel, "cold-sphere");
      shapes.push(cold);
      const warmed = curvedSphere(kernel, "warmed-sphere");
      shapes.push(warmed);
      expect(kernel.mesh(warmed, fine).indices.length).toBeGreaterThan(0);
      const coldObservation = await observe(kernel, cold, plan);
      const warmedObservation = await observe(kernel, warmed, plan);
      expect(warmedObservation.meshes).toEqual(coldObservation.meshes);
    } finally {
      for (const shape of shapes) kernel.disposeShape(shape);
      kernel.dispose();
    }
  }, 30_000);
});
