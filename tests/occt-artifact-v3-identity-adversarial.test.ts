import { describe, expect, it } from "vitest";
import type {
  OcctKernel as RawOcctKernel,
  ShapeHandle,
} from "occt-wasm";
import type { KernelShapeArtifactCodecCandidate } from "../src/conformance.js";
import {
  OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS,
  getOcctShapeArtifactCodecCandidate,
  type OcctShapeArtifactCandidateHost,
  type OcctShapeArtifactCapturedCandidateState,
  type OcctShapeArtifactCapturedSidecarState,
} from "../src/internal/occt-artifact-candidate.js";
import {
  decodeOcctArtifactNativeIdentityV1,
  type OcctShapeArtifactNativeIdentityCounts,
  type OcctShapeArtifactNativeIdentityV1,
  type OcctShapeArtifactNativePath,
} from "../src/internal/occt-artifact-identity-v1.js";
import {
  decodeOcctArtifactSidecarV2,
  encodeOcctArtifactSidecarV2,
} from "../src/internal/occt-artifact-sidecar-v2.js";
import type {
  GeometryKernel,
  KernelShape,
  KernelShapeArtifactContext,
  ShapeMeasurements,
} from "../src/kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import type {
  KernelTopologyLineage,
  KernelTopologySnapshot,
} from "../src/protocol/topology.js";

const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const ARTIFACT_CONTEXT: KernelShapeArtifactContext = Object.freeze({
  feature: "occt-artifact-v3-identity-adversarial",
  maxArtifactBytes: MAX_ARTIFACT_BYTES,
});

function codec(kernel: GeometryKernel): KernelShapeArtifactCodecCandidate {
  const candidate = getOcctShapeArtifactCodecCandidate(kernel);
  if (candidate === undefined) {
    throw new Error("OCCT did not expose its private artifact candidate");
  }
  return candidate;
}

function candidateHost(
  kernel: GeometryKernel,
): OcctShapeArtifactCandidateHost {
  const host = (
    kernel as GeometryKernel & {
      readonly [OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS]?:
        OcctShapeArtifactCandidateHost;
    }
  )[OCCT_SHAPE_ARTIFACT_CANDIDATE_ACCESS];
  if (host === undefined) {
    throw new Error("OCCT did not expose its private artifact host");
  }
  return host;
}

function capturedState(
  kernel: GeometryKernel,
  shape: KernelShape,
): OcctShapeArtifactCapturedCandidateState {
  return candidateHost(kernel).capture(shape);
}

function rawKernel(kernel: GeometryKernel): RawOcctKernel {
  const raw = (kernel as unknown as { readonly raw?: unknown }).raw;
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("Could not inspect the raw OCCT kernel");
  }
  return raw as RawOcctKernel;
}

function rawShapeHandle(shape: KernelShape): ShapeHandle {
  for (const symbol of Object.getOwnPropertySymbols(shape)) {
    const value = (shape as unknown as Record<symbol, unknown>)[symbol];
    if (typeof value === "number") return value as ShapeHandle;
  }
  throw new TypeError("Could not inspect the raw OCCT shape handle");
}

function liveShapeCount(kernel: GeometryKernel): number {
  const live = (kernel as unknown as { readonly liveShapes?: unknown })
    .liveShapes;
  if (!(live instanceof Set)) {
    throw new TypeError("Could not inspect OCCT shape ownership");
  }
  return live.size;
}

function topology(
  kernel: GeometryKernel,
  shape: KernelShape,
): KernelTopologySnapshot {
  const snapshot = kernel.topology?.(shape);
  if (snapshot === undefined) {
    throw new Error("OCCT topology support is unavailable");
  }
  return snapshot;
}

function pathKey(path: OcctShapeArtifactNativePath): string {
  return path.join("/");
}

function sortedPathKeys(
  paths: readonly OcctShapeArtifactNativePath[],
): readonly string[] {
  return paths.map(pathKey).sort();
}

function topologyCounts(snapshot: KernelTopologySnapshot): {
  readonly faces: number;
  readonly edges: number;
  readonly vertices: number;
} {
  return {
    faces: snapshot.faces.length,
    edges: snapshot.edges.length,
    vertices: snapshot.vertices.length,
  };
}

function releaseRawHandles(
  raw: RawOcctKernel,
  handles: readonly ShapeHandle[],
): void {
  const errors: unknown[] = [];
  for (let index = handles.length - 1; index >= 0; index -= 1) {
    try {
      raw.release(handles[index]!);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Raw OCCT test-shape cleanup failed");
  }
}

function importRawShape(
  kernel: GeometryKernel,
  feature: string,
  build: (
    raw: RawOcctKernel,
    retain: (handle: ShapeHandle) => ShapeHandle,
  ) => ShapeHandle,
): KernelShape {
  if (kernel.importShape === undefined) {
    throw new Error("OCCT binary-BREP import support is unavailable");
  }
  const raw = rawKernel(kernel);
  const allocated: ShapeHandle[] = [];
  const retain = (handle: ShapeHandle): ShapeHandle => {
    allocated.push(handle);
    return handle;
  };
  try {
    const root = build(raw, retain);
    const brep = raw.toBREPBinary(root).slice();
    return kernel.importShape(brep, "brep-binary", { feature });
  } finally {
    releaseRawHandles(raw, allocated);
  }
}

function buildRawBrep(
  kernel: GeometryKernel,
  build: (
    raw: RawOcctKernel,
    retain: (handle: ShapeHandle) => ShapeHandle,
  ) => ShapeHandle,
): Uint8Array {
  const raw = rawKernel(kernel);
  const allocated: ShapeHandle[] = [];
  const retain = (handle: ShapeHandle): ShapeHandle => {
    allocated.push(handle);
    return handle;
  };
  try {
    return raw.toBREPBinary(build(raw, retain)).slice();
  } finally {
    releaseRawHandles(raw, allocated);
  }
}

function translationMatrix(
  x: number,
  y: number,
  z: number,
): readonly number[] {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
}

type EnumerationPermutation = "rotate" | "reverse-rotate";

const KIND_OFFSET = Object.freeze({
  solid: 1,
  shell: 2,
  wire: 3,
  face: 4,
  edge: 5,
  vertex: 6,
} as const);

function permuteSubshapeEnumeration(
  kernel: GeometryKernel,
  mode: EnumerationPermutation,
): () => void {
  const raw = rawKernel(kernel);
  const original = raw.getSubShapes;
  raw.getSubShapes = ((
    shape: ShapeHandle,
    kind: Parameters<RawOcctKernel["getSubShapes"]>[1],
  ): ShapeHandle[] => {
    const result = [...original.call(raw, shape, kind)];
    if (result.length < 2) return result;
    if (mode === "reverse-rotate") result.reverse();
    const offset = KIND_OFFSET[kind] % result.length;
    return [...result.slice(offset), ...result.slice(0, offset)];
  }) as RawOcctKernel["getSubShapes"];
  return () => {
    raw.getSubShapes = original;
  };
}

function assertMeasurementEqual(
  actual: ShapeMeasurements,
  expected: ShapeMeasurements,
): void {
  expect(actual).toEqual(expected);
}

function releaseChildren(
  raw: RawOcctKernel,
  parent: ShapeHandle,
): readonly ShapeHandle[] {
  return raw.iterShapes(parent);
}

interface EnvelopeSections {
  readonly stateOffset: number;
  readonly stateLength: number;
  readonly identityOffset: number;
  readonly identityLength: number;
  readonly brepOffset: number;
  readonly brepLength: number;
}

function envelopeSections(artifact: Uint8Array): EnvelopeSections {
  if (artifact.byteLength < 44) {
    throw new TypeError("Candidate v3 artifact is truncated");
  }
  const header = new DataView(
    artifact.buffer,
    artifact.byteOffset,
    artifact.byteLength,
  );
  expect(header.getUint16(16, false)).toBe(3);
  expect(header.getUint32(20, false)).toBe(44);
  const fingerprintLength = header.getUint32(24, false);
  const stateLength = header.getUint32(28, false);
  const identityLength = header.getUint32(32, false);
  const brepLength = header.getUint32(36, false);
  expect(header.getUint32(40, false)).toBe(artifact.byteLength);
  const stateOffset = 44 + fingerprintLength;
  const identityOffset = stateOffset + stateLength;
  const brepOffset = identityOffset + identityLength;
  expect(brepOffset + brepLength).toBe(artifact.byteLength);
  return {
    stateOffset,
    stateLength,
    identityOffset,
    identityLength,
    brepOffset,
    brepLength,
  };
}

function identityCounts(
  sidecar: OcctShapeArtifactCapturedSidecarState,
): OcctShapeArtifactNativeIdentityCounts {
  return {
    solids: sidecar.nativeStructure.solidOrientations.length,
    shells: sidecar.nativeStructure.shellOrientations.length,
    wires: sidecar.nativeStructure.wireOrientations.length,
    faces: sidecar.nativeStructure.faceOrientations.length,
    edges: sidecar.nativeStructure.edgeOrientations.length,
    vertices: sidecar.nativeStructure.vertexOrientations.length,
  };
}

function rewriteArtifactSidecar(
  artifact: Uint8Array,
  transform: (
    state: OcctShapeArtifactCapturedSidecarState,
    identity: OcctShapeArtifactNativeIdentityV1,
  ) => OcctShapeArtifactCapturedSidecarState,
): Uint8Array {
  const sections = envelopeSections(artifact);
  const state = decodeOcctArtifactSidecarV2(
    artifact.subarray(
      sections.stateOffset,
      sections.stateOffset + sections.stateLength,
    ),
  );
  const identity = decodeOcctArtifactNativeIdentityV1(
    artifact.subarray(
      sections.identityOffset,
      sections.identityOffset + sections.identityLength,
    ),
    identityCounts(state),
    { maxBytes: sections.identityLength },
  );
  const encoded = encodeOcctArtifactSidecarV2(transform(state, identity), {
    maxBytes: MAX_ARTIFACT_BYTES,
  });
  const output = new Uint8Array(
    artifact.byteLength - sections.stateLength + encoded.byteLength,
  );
  output.set(artifact.subarray(0, sections.stateOffset));
  output.set(encoded, sections.stateOffset);
  output.set(
    artifact.subarray(
      sections.identityOffset,
      sections.brepOffset + sections.brepLength,
    ),
    sections.stateOffset + encoded.byteLength,
  );
  const header = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  header.setUint32(28, encoded.byteLength, false);
  header.setUint32(40, output.byteLength, false);
  return output;
}

function replaceArtifactBrep(
  artifact: Uint8Array,
  brep: Uint8Array,
): Uint8Array {
  const sections = envelopeSections(artifact);
  const output = new Uint8Array(
    artifact.byteLength - sections.brepLength + brep.byteLength,
  );
  output.set(artifact.subarray(0, sections.brepOffset));
  output.set(brep, sections.brepOffset);
  const header = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  header.setUint32(36, brep.byteLength, false);
  header.setUint32(40, output.byteLength, false);
  return output;
}

async function expectArtifactDecodeRejected(
  kernel: GeometryKernel,
  artifact: Uint8Array,
): Promise<unknown> {
  try {
    const unexpectedlyDecoded = await codec(kernel).decodeShapeArtifact(
      artifact,
      ARTIFACT_CONTEXT,
    );
    kernel.disposeShape(unexpectedlyDecoded);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error;
  }
  throw new Error("Expected the OCCT artifact operation to reject");
}

function componentLineage(
  path: OcctShapeArtifactNativePath,
): readonly KernelTopologyLineage[] {
  const component = path[0];
  if (component !== 0 && component !== 1) {
    throw new TypeError("Expected one of two direct compound components");
  }
  return Object.freeze([
    Object.freeze({
      feature: `coincident-component-${component}`,
      relation: "created" as const,
    }),
  ]);
}

function assertComponentLineage(
  state: OcctShapeArtifactCapturedCandidateState,
): void {
  const groups = [
    [state.topology.faces, state.nativeIdentity.facePaths],
    [state.topology.edges, state.nativeIdentity.edgePaths],
    [state.topology.vertices, state.nativeIdentity.vertexPaths],
  ] as const;
  for (const [descriptors, paths] of groups) {
    expect(descriptors).toHaveLength(paths.length);
    descriptors.forEach((descriptor, index) => {
      const component = paths[index]![0];
      expect(component === 0 || component === 1).toBe(true);
      expect(descriptor.lineage).toEqual([
        {
          feature: `coincident-component-${component}`,
          relation: "created",
        },
      ]);
    });
  }
}

function ownershipEvidence(
  kernels: readonly {
    readonly kernel: GeometryKernel;
    readonly baselineRawShapes: number;
  }[],
): readonly {
  readonly live: number;
  readonly raw: number;
  readonly baseline: number;
}[] {
  return kernels.map(({ kernel, baselineRawShapes }) => ({
    live: liveShapeCount(kernel),
    raw: rawKernel(kernel).shapeCount,
    baseline: baselineRawShapes,
  }));
}

function disposeKernelsAndAssertOwnership(
  kernels: readonly {
    readonly kernel: GeometryKernel;
    readonly baselineRawShapes: number;
  }[],
): void {
  const evidence = ownershipEvidence(kernels);
  for (let index = kernels.length - 1; index >= 0; index -= 1) {
    kernels[index]!.kernel.dispose();
  }
  for (const item of evidence) {
    expect(item.live).toBe(0);
    expect(item.raw).toBe(item.baseline);
  }
}

describe("OCCT artifact v3 adversarial native identity", () => {
  it("canonicalizes producer permutations and preserves fresh consumer order through a selected-edge fillet", async () => {
    const normalProducer = await createOcctKernel();
    const permutedProducer = await createOcctKernel();
    const permutedConsumer = await createOcctKernel();
    const kernels = [normalProducer, permutedProducer, permutedConsumer].map(
      (kernel) => ({
        kernel,
        baselineRawShapes: rawKernel(kernel).shapeCount,
      }),
    );
    const restoreProducerPermutation = permuteSubshapeEnumeration(
      permutedProducer,
      "rotate",
    );
    const restoreConsumerPermutation = permuteSubshapeEnumeration(
      permutedConsumer,
      "reverse-rotate",
    );
    let normalSource: KernelShape | undefined;
    let permutedSource: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    let normalFillet: KernelShape | undefined;
    let decodedFillet: KernelShape | undefined;
    try {
      if (
        normalProducer.box === undefined ||
        permutedProducer.box === undefined ||
        normalProducer.fillet === undefined ||
        permutedConsumer.fillet === undefined
      ) {
        throw new Error("OCCT box/fillet support is unavailable");
      }
      normalSource = normalProducer.box([2, 3, 5], false, {
        feature: "permutation-box",
      });
      permutedSource = permutedProducer.box([2, 3, 5], false, {
        feature: "permutation-box",
      });
      const normalArtifact = await codec(normalProducer).encodeShapeArtifact(
        normalSource,
        ARTIFACT_CONTEXT,
      );
      const permutedArtifact = await codec(
        permutedProducer,
      ).encodeShapeArtifact(permutedSource, ARTIFACT_CONTEXT);
      expect(permutedArtifact).toEqual(normalArtifact);

      decoded = await codec(permutedConsumer).decodeShapeArtifact(
        normalArtifact,
        ARTIFACT_CONTEXT,
      );
      const normalState = capturedState(normalProducer, normalSource);
      const decodedState = capturedState(permutedConsumer, decoded);
      expect(
        sortedPathKeys(decodedState.nativeIdentity.facePaths),
      ).toEqual(sortedPathKeys(normalState.nativeIdentity.facePaths));
      expect(
        decodedState.nativeIdentity.facePaths.map(pathKey),
      ).not.toEqual(normalState.nativeIdentity.facePaths.map(pathKey));
      expect(
        sortedPathKeys(decodedState.nativeIdentity.edgePaths),
      ).toEqual(sortedPathKeys(normalState.nativeIdentity.edgePaths));
      expect(
        decodedState.nativeIdentity.edgePaths.map(pathKey),
      ).not.toEqual(normalState.nativeIdentity.edgePaths.map(pathKey));
      const normalSnapshot = topology(normalProducer, normalSource);
      const decodedSnapshot = topology(permutedConsumer, decoded);
      expect(topologyCounts(decodedSnapshot)).toEqual(
        topologyCounts(normalSnapshot),
      );
      const role = "box.edge.x-min-y-min";
      const normalEdge = normalSnapshot.edges.find((edge) =>
        edge.lineage.some((item) => item.role === role),
      );
      const decodedEdge = decodedSnapshot.edges.find((edge) =>
        edge.lineage.some((item) => item.role === role),
      );
      expect(normalEdge).toBeDefined();
      expect(decodedEdge).toBeDefined();
      if (normalEdge === undefined || decodedEdge === undefined) {
        throw new Error("The selected box edge role was unavailable");
      }
      expect(decodedEdge.length).toBe(normalEdge.length);
      expect(decodedEdge.center).toEqual(normalEdge.center);

      normalFillet = normalProducer.fillet(
        normalSource,
        [normalEdge.key],
        { radius: 0.2 },
        { feature: "post-artifact-index-sensitive-fillet" },
      );
      decodedFillet = permutedConsumer.fillet(
        decoded,
        [decodedEdge.key],
        { radius: 0.2 },
        { feature: "post-artifact-index-sensitive-fillet" },
      );
      expect(permutedConsumer.status(decodedFillet)).toEqual({
        ok: true,
        code: "VALID",
      });
      assertMeasurementEqual(
        permutedConsumer.measure(decodedFillet),
        normalProducer.measure(normalFillet),
      );
      expect(topologyCounts(topology(permutedConsumer, decodedFillet))).toEqual(
        topologyCounts(topology(normalProducer, normalFillet)),
      );
      expect(
        await codec(permutedConsumer).encodeShapeArtifact(
          decoded,
          ARTIFACT_CONTEXT,
        ),
      ).toEqual(normalArtifact);
    } finally {
      restoreConsumerPermutation();
      restoreProducerPermutation();
      if (decodedFillet !== undefined) {
        permutedConsumer.disposeShape(decodedFillet);
      }
      if (normalFillet !== undefined) {
        normalProducer.disposeShape(normalFillet);
      }
      if (decoded !== undefined) permutedConsumer.disposeShape(decoded);
      if (permutedSource !== undefined) {
        permutedProducer.disposeShape(permutedSource);
      }
      if (normalSource !== undefined) {
        normalProducer.disposeShape(normalSource);
      }
      disposeKernelsAndAssertOwnership(kernels);
    }
  });

  it("keeps distinct semantic payloads on coincident symmetric TShapes by serialized path", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    const kernels = [producer, consumer].map((kernel) => ({
      kernel,
      baselineRawShapes: rawKernel(kernel).shapeCount,
    }));
    const restoreConsumerPermutation = permuteSubshapeEnumeration(
      consumer,
      "reverse-rotate",
    );
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = importRawShape(
        producer,
        "coincident-distinct-tshape-import",
        (raw, retain) => {
          const first = retain(raw.makeBox(2, 3, 5));
          const second = retain(raw.makeBox(2, 3, 5));
          expect(raw.isSame(first, second)).toBe(false);
          return retain(raw.makeCompound([first, second]));
        },
      );
      const sourceState = capturedState(producer, source);
      expect(sortedPathKeys(sourceState.nativeIdentity.solidPaths)).toEqual([
        "0",
        "1",
      ]);
      expect(topologyCounts(sourceState.topology)).toEqual({
        faces: 12,
        edges: 24,
        vertices: 16,
      });

      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const markedArtifact = rewriteArtifactSidecar(
        artifact,
        (state, identity) => ({
          ...state,
          topology: {
            ...state.topology,
            faces: state.topology.faces.map((face, index) => ({
              ...face,
              lineage: componentLineage(identity.facePaths[index]!),
            })),
            edges: state.topology.edges.map((edge, index) => ({
              ...edge,
              lineage: componentLineage(identity.edgePaths[index]!),
            })),
            vertices: state.topology.vertices.map((vertex, index) => ({
              ...vertex,
              lineage: componentLineage(identity.vertexPaths[index]!),
            })),
          },
        }),
      );
      decoded = await codec(consumer).decodeShapeArtifact(
        markedArtifact,
        ARTIFACT_CONTEXT,
      );
      expect(consumer.status(decoded)).toEqual({ ok: true, code: "VALID" });
      const restoredState = capturedState(consumer, decoded);
      expect(sortedPathKeys(restoredState.nativeIdentity.solidPaths)).toEqual([
        "0",
        "1",
      ]);
      assertComponentLineage(restoredState);
      expect(
        await codec(consumer).encodeShapeArtifact(decoded, ARTIFACT_CONTEXT),
      ).toEqual(markedArtifact);
    } finally {
      restoreConsumerPermutation();
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      disposeKernelsAndAssertOwnership(kernels);
    }
  });

  it("distinguishes instances of one shared TShape at different composed locations", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    const kernels = [producer, consumer].map((kernel) => ({
      kernel,
      baselineRawShapes: rawKernel(kernel).shapeCount,
    }));
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = importRawShape(
        producer,
        "shared-tshape-distinct-location-import",
        (raw, retain) => {
          const base = retain(raw.makeBox(2, 3, 5));
          const left = retain(raw.located(base, [...translationMatrix(-7, 0, 0)]));
          const right = retain(raw.located(base, [...translationMatrix(7, 0, 0)]));
          expect(raw.isSame(left, right)).toBe(false);
          return retain(raw.makeCompound([left, right]));
        },
      );
      const state = capturedState(producer, source);
      expect(sortedPathKeys(state.nativeIdentity.solidPaths)).toEqual([
        "0",
        "1",
      ]);
      expect(
        state.nativeIdentity.occurrences
          .filter((item) => item.shapeType === "solid")
          .map((item) => item.identityIndex),
      ).toEqual([0, 1]);
      expect(topologyCounts(state.topology)).toEqual({
        faces: 12,
        edges: 24,
        vertices: 16,
      });
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      decoded = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      const restored = capturedState(consumer, decoded);
      expect(restored.nativeIdentity).toEqual(state.nativeIdentity);
      expect(consumer.measure(decoded)).toEqual(producer.measure(source));

      const raw = rawKernel(consumer);
      const children = releaseChildren(raw, rawShapeHandle(decoded));
      try {
        expect(children).toHaveLength(2);
        expect(raw.isSame(children[0]!, children[1]!)).toBe(false);
        const firstBounds = raw.getBoundingBox(children[0]!, false);
        const secondBounds = raw.getBoundingBox(children[1]!, false);
        expect(firstBounds.xmax).toBeLessThan(secondBounds.xmin);
      } finally {
        releaseRawHandles(raw, children);
      }
      expect(
        await codec(consumer).encodeShapeArtifact(decoded, ARTIFACT_CONTEXT),
      ).toEqual(artifact);
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      disposeKernelsAndAssertOwnership(kernels);
    }
  });

  it("collapses opposite orientations of the same located TShape to one IsSame identity while preserving both occurrences", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    const kernels = [producer, consumer].map((kernel) => ({
      kernel,
      baselineRawShapes: rawKernel(kernel).shapeCount,
    }));
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = importRawShape(
        producer,
        "same-located-tshape-opposite-orientation-import",
        (raw, retain) => {
          const base = retain(raw.makeBox(2, 3, 5));
          const reversed = retain(raw.reverseShape(base));
          expect(raw.isSame(base, reversed)).toBe(true);
          expect(raw.isEqual(base, reversed)).toBe(false);
          return retain(raw.makeCompound([base, reversed]));
        },
      );
      const state = capturedState(producer, source);
      expect(sortedPathKeys(state.nativeIdentity.solidPaths)).toEqual(["0"]);
      expect(state.nativeStructure.solidOrientations).toEqual(["forward"]);
      expect(
        state.nativeIdentity.occurrences
          .filter((item) => item.shapeType === "solid")
          .map(({ orientation, identityIndex }) => ({
            orientation,
            identityIndex,
          })),
      ).toEqual([
        { orientation: "forward", identityIndex: 0 },
        { orientation: "reversed", identityIndex: 0 },
      ]);
      expect(topologyCounts(state.topology)).toEqual({
        faces: 6,
        edges: 12,
        vertices: 8,
      });
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      decoded = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      const restored = capturedState(consumer, decoded);
      expect(restored.nativeIdentity).toEqual(state.nativeIdentity);
      expect(restored.nativeStructure).toEqual(state.nativeStructure);

      const raw = rawKernel(consumer);
      const children = releaseChildren(raw, rawShapeHandle(decoded));
      try {
        expect(children).toHaveLength(2);
        expect(raw.isSame(children[0]!, children[1]!)).toBe(true);
        expect(raw.isEqual(children[0]!, children[1]!)).toBe(false);
        expect([
          raw.shapeOrientation(children[0]!),
          raw.shapeOrientation(children[1]!),
        ]).toEqual(["forward", "reversed"]);
      } finally {
        releaseRawHandles(raw, children);
      }
      expect(
        await codec(consumer).encodeShapeArtifact(decoded, ARTIFACT_CONTEXT),
      ).toEqual(artifact);
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      disposeKernelsAndAssertOwnership(kernels);
    }
  });

  it("rejects BREP substitutions that change occurrence multiplicity, orientation, or IsSame class mapping", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    const kernels = [producer, consumer].map((kernel) => ({
      kernel,
      baselineRawShapes: rawKernel(kernel).shapeCount,
    }));
    const sources: KernelShape[] = [];
    let recovered: KernelShape | undefined;
    try {
      const single = importRawShape(
        producer,
        "single-occurrence-source",
        (raw, retain) => {
          const base = retain(raw.makeBox(2, 3, 5));
          return retain(raw.makeCompound([base]));
        },
      );
      sources.push(single);
      const duplicatedBrep = buildRawBrep(producer, (raw, retain) => {
        const base = retain(raw.makeBox(2, 3, 5));
        return retain(raw.makeCompound([base, base]));
      });

      const opposite = importRawShape(
        producer,
        "opposite-orientation-occurrence-source",
        (raw, retain) => {
          const base = retain(raw.makeBox(2, 3, 5));
          const reversed = retain(raw.reverseShape(base));
          return retain(raw.makeCompound([base, reversed]));
        },
      );
      sources.push(opposite);
      const sameOrientationBrep = buildRawBrep(producer, (raw, retain) => {
        const base = retain(raw.makeBox(2, 3, 5));
        return retain(raw.makeCompound([base, base]));
      });

      const repeatedClasses = importRawShape(
        producer,
        "repeated-issame-class-source",
        (raw, retain) => {
          const first = retain(raw.makeBox(2, 3, 5));
          const second = retain(raw.makeBox(2, 3, 5));
          expect(raw.isSame(first, second)).toBe(false);
          return retain(raw.makeCompound([first, second, first]));
        },
      );
      sources.push(repeatedClasses);
      const changedClassMappingBrep = buildRawBrep(producer, (raw, retain) => {
        const first = retain(raw.makeBox(2, 3, 5));
        const second = retain(raw.makeBox(2, 3, 5));
        expect(raw.isSame(first, second)).toBe(false);
        return retain(raw.makeCompound([first, second, second]));
      });

      const cases = [
        {
          label: "duplicated identical occurrence",
          source: single,
          brep: duplicatedBrep,
        },
        {
          label: "changed second-occurrence orientation",
          source: opposite,
          brep: sameOrientationBrep,
        },
        {
          label: "changed a later occurrence's IsSame class",
          source: repeatedClasses,
          brep: changedClassMappingBrep,
        },
      ] as const;
      for (const item of cases) {
        const artifact = await codec(producer).encodeShapeArtifact(
          item.source,
          ARTIFACT_CONTEXT,
        );
        const substituted = replaceArtifactBrep(artifact, item.brep);
        const borrowed = substituted.slice();
        const error = await expectArtifactDecodeRejected(
          consumer,
          substituted,
        );
        expect((error as Error).message).toContain("native occurrence");
        expect(substituted, `${item.label} mutated its borrowed input`).toEqual(
          borrowed,
        );
        expect(
          liveShapeCount(consumer),
          `${item.label} leaked a high-level shape`,
        ).toBe(0);
        expect(
          rawKernel(consumer).shapeCount,
          `${item.label} leaked a raw shape`,
        ).toBe(kernels[1]!.baselineRawShapes);
      }

      const recoveryArtifact = await codec(producer).encodeShapeArtifact(
        repeatedClasses,
        ARTIFACT_CONTEXT,
      );
      recovered = await codec(consumer).decodeShapeArtifact(
        recoveryArtifact,
        ARTIFACT_CONTEXT,
      );
      expect(consumer.status(recovered)).toEqual({ ok: true, code: "VALID" });
      expect(
        await codec(consumer).encodeShapeArtifact(
          recovered,
          ARTIFACT_CONTEXT,
        ),
      ).toEqual(recoveryArtifact);
    } finally {
      if (recovered !== undefined) consumer.disposeShape(recovered);
      for (let index = sources.length - 1; index >= 0; index -= 1) {
        producer.disposeShape(sources[index]!);
      }
      disposeKernelsAndAssertOwnership(kernels);
    }
  });

  it("documents that stock v3 cannot attest IsPartner sharing across distinct locations", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    const kernels = [producer, consumer].map((kernel) => ({
      kernel,
      baselineRawShapes: rawKernel(kernel).shapeCount,
    }));
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = importRawShape(
        producer,
        "shared-tshape-distinct-location-nonclaim",
        (raw, retain) => {
          const base = retain(raw.makeBox(2, 3, 5));
          const left = retain(
            raw.located(base, [...translationMatrix(-7, 0, 0)]),
          );
          const right = retain(
            raw.located(base, [...translationMatrix(7, 0, 0)]),
          );
          return retain(raw.makeCompound([left, right]));
        },
      );
      const independentLocationsBrep = buildRawBrep(
        producer,
        (raw, retain) => {
          const first = retain(raw.makeBox(2, 3, 5));
          const second = retain(raw.makeBox(2, 3, 5));
          const left = retain(
            raw.located(first, [...translationMatrix(-7, 0, 0)]),
          );
          const right = retain(
            raw.located(second, [...translationMatrix(7, 0, 0)]),
          );
          return retain(raw.makeCompound([left, right]));
        },
      );
      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      const substituted = replaceArtifactBrep(
        artifact,
        independentLocationsBrep,
      );
      decoded = await codec(consumer).decodeShapeArtifact(
        substituted,
        ARTIFACT_CONTEXT,
      );
      expect(consumer.status(decoded)).toEqual({ ok: true, code: "VALID" });
      expect(consumer.measure(decoded)).toEqual(producer.measure(source));
      expect(topologyCounts(topology(consumer, decoded))).toEqual(
        topologyCounts(topology(producer, source)),
      );
      expect(
        await codec(consumer).encodeShapeArtifact(decoded, ARTIFACT_CONTEXT),
      ).toEqual(substituted);
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      disposeKernelsAndAssertOwnership(kernels);
    }
  });

  it("round-trips a located and reversed nested root without flattening its serialized path", async () => {
    const producer = await createOcctKernel();
    const consumer = await createOcctKernel();
    const kernels = [producer, consumer].map((kernel) => ({
      kernel,
      baselineRawShapes: rawKernel(kernel).shapeCount,
    }));
    let source: KernelShape | undefined;
    let decoded: KernelShape | undefined;
    try {
      source = importRawShape(
        producer,
        "located-reversed-nested-root-import",
        (raw, retain) => {
          const base = retain(raw.makeBox(2, 3, 5));
          const movedSolid = retain(
            raw.located(base, [...translationMatrix(3, 4, 5)]),
          );
          const reversedSolid = retain(raw.reverseShape(movedSolid));
          const inner = retain(raw.makeCompound([reversedSolid]));
          const movedInner = retain(
            raw.located(inner, [...translationMatrix(7, -2, 1)]),
          );
          const outer = retain(raw.makeCompound([movedInner]));
          const reversedOuter = retain(raw.reverseShape(outer));
          return retain(
            raw.located(reversedOuter, [...translationMatrix(-1, 6, 2)]),
          );
        },
      );
      const state = capturedState(producer, source);
      expect(state.nativeStructure.rootType).toBe("compound");
      expect(state.nativeStructure.rootOrientation).toBe("reversed");
      expect(sortedPathKeys(state.nativeIdentity.solidPaths)).toEqual(["0/0"]);
      const sourceMeasurement = producer.measure(source);

      const artifact = await codec(producer).encodeShapeArtifact(
        source,
        ARTIFACT_CONTEXT,
      );
      decoded = await codec(consumer).decodeShapeArtifact(
        artifact,
        ARTIFACT_CONTEXT,
      );
      const restored = capturedState(consumer, decoded);
      expect(restored.nativeIdentity).toEqual(state.nativeIdentity);
      expect(restored.nativeStructure).toEqual(state.nativeStructure);
      expect(consumer.measure(decoded)).toEqual(sourceMeasurement);

      const raw = rawKernel(consumer);
      const root = rawShapeHandle(decoded);
      expect(raw.shapeOrientation(root)).toBe("reversed");
      const outerChildren = releaseChildren(raw, root);
      try {
        expect(outerChildren).toHaveLength(1);
        expect(raw.getShapeType(outerChildren[0]!)).toBe("compound");
        const innerChildren = releaseChildren(raw, outerChildren[0]!);
        try {
          expect(innerChildren).toHaveLength(1);
          expect(raw.getShapeType(innerChildren[0]!)).toBe("solid");
        } finally {
          releaseRawHandles(raw, innerChildren);
        }
      } finally {
        releaseRawHandles(raw, outerChildren);
      }
      expect(
        await codec(consumer).encodeShapeArtifact(decoded, ARTIFACT_CONTEXT),
      ).toEqual(artifact);
    } finally {
      if (decoded !== undefined) consumer.disposeShape(decoded);
      if (source !== undefined) producer.disposeShape(source);
      disposeKernelsAndAssertOwnership(kernels);
    }
  });
});
