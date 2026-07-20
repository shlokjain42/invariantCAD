import { describe, expect, it } from "vitest";
import {
  captureTopologyReference,
  createEvaluator,
  deg,
  design,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
  mm,
  scalarVec3,
  topology,
  vec3,
  type CadResult,
  type DesignDocument,
  type EvaluatedDesign,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelShape,
  type KernelTopologyCapabilities,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
  type PersistentTopologyReference,
} from "../src/index.js";

const fingerprint = "topology-reference-evaluator-test/signatures@1";
const signatureCapabilities = {
  protocolVersion: 1 as const,
  fingerprint,
};
const v2Fingerprint = "topology-reference-evaluator-test/signatures@2";
const signatureCapabilitiesV2 = {
  protocolVersion: 2 as const,
  fingerprint: v2Fingerprint,
};
const tolerance = { linear: 1e-9, angular: 1e-9, relative: 1e-9 };

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

const faces: readonly KernelFaceDescriptor[] = [0, 1].map((index) => ({
  topology: "face",
  key: key(`face-${index}`),
  center: [index * 20, 0, 0],
  bounds: {
    min: [index * 20, 0, 0],
    max: [index * 20 + 10, 10, 0],
  },
  lineage: [{ feature: "box", relation: "created" }],
  area: 100,
  surface: { kind: "plane", normal: [0, 0, 1] },
  edges: [key(`edge-${index}`)],
}));

const edges: readonly KernelEdgeDescriptor[] = [0, 1].map((index) => ({
  topology: "edge",
  key: key(`edge-${index}`),
  center: [index * 20 + 5, 0, 0],
  bounds: {
    min: [index * 20, 0, 0],
    max: [index * 20 + 10, 0, 0],
  },
  lineage: [{ feature: "box", relation: "created" }],
  length: 10,
  curve: { kind: "line", direction: [1, 0, 0] },
  faces: [key(`face-${index}`)],
  vertices: [],
}));

const snapshot: KernelTopologySnapshot = {
  history: "complete",
  faces,
  edges,
  vertices: [],
};

function ambiguousSnapshot(): KernelTopologySnapshot {
  return {
    history: "complete",
    faces: faces.map((descriptor, index) => ({
      ...faces[0]!,
      key: descriptor.key,
      edges: [edges[index]!.key],
    })),
    edges: edges.map((descriptor, index) => ({
      ...edges[0]!,
      key: descriptor.key,
      faces: [faces[index]!.key],
    })),
    vertices: [],
  };
}

function capture<K extends "face" | "edge">(
  kind: K,
  topologyKey: KernelTopologyKey,
): PersistentTopologyReference<K> {
  const result = captureTopologyReference(snapshot, kind, topologyKey, {
    capabilities: signatureCapabilities,
    tolerance,
  });
  if (!result.ok) throw new Error("Evaluator fixture topology did not capture");
  return result.value;
}

const edgeReferences = [capture("edge", edges[0]!.key), capture("edge", edges[1]!.key)] as const;
const faceReference = capture("face", faces[0]!.key);

function captureV2Edge(topologyKey: KernelTopologyKey) {
  const result = captureTopologyReference(snapshot, "edge", topologyKey, {
    capabilities: signatureCapabilitiesV2,
    tolerance,
  });
  if (!result.ok) throw new Error("Evaluator fixture v2 edge did not capture");
  return result.value;
}

const v2EdgeReferences = [
  captureV2Edge(edges[0]!.key),
  captureV2Edge(edges[1]!.key),
] as const;

const OMIT_SIGNATURES = Symbol("omit-signatures");

interface HarnessOptions {
  readonly signatures?: unknown | typeof OMIT_SIGNATURES;
  readonly signatureProfiles?: unknown;
  readonly topology?: Partial<KernelTopologyCapabilities>;
  readonly topologySnapshot?: KernelTopologySnapshot;
  readonly topologyHook?: () => void;
}

interface Harness {
  readonly kernel: GeometryKernel;
  readonly boxCalls: () => number;
  readonly topologyCalls: () => number;
  readonly disposeShapeCalls: () => number;
  readonly disposedShapeSerials: () => readonly number[];
  readonly filletKeys: readonly (readonly KernelTopologyKey[])[];
  readonly chamferKeys: readonly (readonly KernelTopologyKey[])[];
  readonly shellKeys: readonly (readonly KernelTopologyKey[])[];
  readonly draftKeys: readonly (readonly KernelTopologyKey[])[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const id = "persistent-topology-evaluator-test";
  let serial = 0;
  let boxCallCount = 0;
  let topologyCallCount = 0;
  let disposeShapeCallCount = 0;
  const disposedShapeSerials: number[] = [];
  const filletKeys: (readonly KernelTopologyKey[])[] = [];
  const chamferKeys: (readonly KernelTopologyKey[])[] = [];
  const shellKeys: (readonly KernelTopologyKey[])[] = [];
  const draftKeys: (readonly KernelTopologyKey[])[] = [];
  const shape = (): KernelShape =>
    ({ kernel: id, serial: serial++ }) as KernelShape;
  const signatures = Object.hasOwn(options, "signatures")
    ? options.signatures
    : signatureCapabilities;
  const topologyCapabilities = {
    kinds: ["face", "edge", "vertex"],
    provenance: "feature",
    semanticRoles: false,
    sketchSources: false,
    geometry: true,
    adjacency: true,
    ...(signatures === OMIT_SIGNATURES ? {} : { signatures }),
    ...(Object.hasOwn(options, "signatureProfiles")
      ? { signatureProfiles: options.signatureProfiles }
      : {}),
    ...options.topology,
  } as unknown as KernelTopologyCapabilities;
  const capabilities = {
    protocolVersion: 1,
    representation: "brep",
    exact: true,
    primitives: ["box"],
    features: ["fillet", "chamfer", "shell", "draft"],
    nativeImports: [],
    nativeExports: [],
    topology: topologyCapabilities,
    exactIndexedTopologyEvolution: {
      protocolVersion: 1,
      features: ["draft"],
    },
  } as unknown as KernelCapabilities;
  const kernel: GeometryKernel = {
    id,
    capabilities,
    box(): KernelShape {
      boxCallCount += 1;
      return shape();
    },
    fillet(_input, selected): KernelShape {
      filletKeys.push(Object.freeze([...selected]));
      return shape();
    },
    chamfer(_input, selected): KernelShape {
      chamferKeys.push(Object.freeze([...selected]));
      return shape();
    },
    shell(_input, selected): KernelShape {
      shellKeys.push(Object.freeze([...selected]));
      return shape();
    },
    draft(_input, selected): KernelShape {
      draftKeys.push(Object.freeze([...selected]));
      return shape();
    },
    topology(): KernelTopologySnapshot {
      topologyCallCount += 1;
      options.topologyHook?.();
      return options.topologySnapshot ?? snapshot;
    },
    mesh: () => ({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    }),
    measure: () => ({
      volume: 1,
      surfaceArea: 1,
      centerOfMass: [0, 0, 0],
      inertiaTensor: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
      genus: 0,
      tolerance: 1e-7,
    }),
    status: () => ({ ok: true, code: "OK" }),
    disposeShape: (disposed) => {
      disposeShapeCallCount += 1;
      disposedShapeSerials.push(
        (disposed as unknown as { readonly serial: number }).serial,
      );
    },
    dispose: () => {},
  };
  return {
    kernel,
    boxCalls: () => boxCallCount,
    topologyCalls: () => topologyCallCount,
    disposeShapeCalls: () => disposeShapeCallCount,
    disposedShapeSerials: () => Object.freeze([...disposedShapeSerials]),
    filletKeys,
    chamferKeys,
    shellKeys,
    draftKeys,
  };
}

type LogicalWrapper = "plain" | "and" | "or" | "not";

function filletDocument(
  variants: readonly PersistentTopologyReference<"edge">[] = [edgeReferences[0]],
  wrapper: LogicalWrapper = "plain",
) {
  const cad = design("persistent edge evaluator");
  const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
  const stored = cad.topologyReference("stored-edge", box, {
    topology: "edge",
    variants,
  });
  const persistent = topology.edges.persistentReference(stored);
  const query =
    wrapper === "and"
      ? persistent.and(topology.edges.all())
      : wrapper === "or"
        ? persistent.or(topology.edges.all())
        : wrapper === "not"
          ? persistent.not()
          : persistent;
  const treated = cad.fillet("treated", box, {
    edges: query.select(),
    radius: mm(1),
  });
  cad.output("result", treated);
  return cad.build();
}

function twoReferenceFilletDocument() {
  const cad = design("shared persistent edge budget");
  const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
  const first = cad.topologyReference("edge-a", box, {
    topology: "edge",
    variants: [edgeReferences[0]],
  });
  const second = cad.topologyReference("edge-b", box, {
    topology: "edge",
    variants: [edgeReferences[1]],
  });
  const selected = topology.edges
    .persistentReference(first)
    .or(topology.edges.persistentReference(second))
    .exactly(2);
  const treated = cad.fillet("treated", box, {
    edges: selected,
    radius: mm(1),
  });
  cad.output("result", treated);
  return cad.build();
}

function mixedProfileFilletDocument() {
  const cad = design("shared cross-profile persistent edge budget");
  const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
  const v2 = cad.topologyReference("edge-v2", box, {
    topology: "edge",
    variants: [v2EdgeReferences[0]],
  });
  const v1 = cad.topologyReference("edge-v1", box, {
    topology: "edge",
    variants: [edgeReferences[1]],
  });
  const selected = topology.edges
    .persistentReference(v2)
    .or(topology.edges.persistentReference(v1))
    .exactly(2);
  const treated = cad.fillet("treated", box, {
    edges: selected,
    radius: mm(1),
  });
  cad.output("result", treated);
  return cad.build();
}

function shellDocument() {
  const cad = design("persistent face evaluator");
  const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
  const stored = cad.topologyReference("stored-face", box, {
    topology: "face",
    variants: [faceReference],
  });
  const shelled = cad.shell("treated", box, {
    openings: topology.faces.persistentReference(stored).select(),
    thickness: mm(1),
  });
  cad.output("result", shelled);
  return cad.build();
}

type PersistentConsumer = "fillet" | "chamfer" | "shell" | "draft";

function persistentConsumerDocument(consumer: PersistentConsumer) {
  const cad = design(`persistent ${consumer} cancellation`);
  const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
  if (consumer === "fillet" || consumer === "chamfer") {
    const stored = cad.topologyReference("stored-edge", box, {
      topology: "edge",
      variants: [edgeReferences[0]],
    });
    const selected = topology.edges.persistentReference(stored).select();
    const treated =
      consumer === "fillet"
        ? cad.fillet("treated", box, { edges: selected, radius: mm(1) })
        : cad.chamfer("treated", box, { edges: selected, distance: mm(1) });
    cad.output("result", treated);
    return cad.build();
  }

  const stored = cad.topologyReference("stored-face", box, {
    topology: "face",
    variants: [faceReference],
  });
  const selected = topology.faces.persistentReference(stored).select();
  const treated =
    consumer === "shell"
      ? cad.shell("treated", box, {
          openings: selected,
          thickness: mm(1),
        })
      : cad.draft("treated", box, {
          faces: selected,
          angle: deg(1),
          pullDirection: scalarVec3(0, 0, 1),
          neutralPlane: {
            origin: vec3(mm(0), mm(0), mm(0)),
            normal: scalarVec3(0, 0, 1),
          },
        });
  cad.output("result", treated);
  return cad.build();
}

async function evaluate(
  harness: Harness,
  document: DesignDocument = filletDocument(),
  options: Parameters<Awaited<ReturnType<typeof createEvaluator>>["evaluate"]>[1] = {},
): Promise<CadResult<EvaluatedDesign>> {
  const evaluator = await createEvaluator({ kernel: harness.kernel });
  try {
    const result = await evaluator.evaluate(document, options);
    if (result.ok) result.value.dispose();
    return result;
  } finally {
    evaluator.dispose();
  }
}

function expectNoGeometryCalls(harness: Harness): void {
  expect(harness.boxCalls()).toBe(0);
  expect(harness.topologyCalls()).toBe(0);
  expect(harness.disposeShapeCalls()).toBe(0);
  expect(harness.filletKeys).toHaveLength(0);
  expect(harness.chamferKeys).toHaveLength(0);
  expect(harness.shellKeys).toHaveLength(0);
  expect(harness.draftKeys).toHaveLength(0);
}

function expectDisposedSerials(
  harness: Harness,
  expected: readonly number[],
): void {
  expect(
    [...harness.disposedShapeSerials()].sort((first, second) => first - second),
  ).toEqual([...expected].sort((first, second) => first - second));
}

describe("document-owned topology references in evaluator", () => {
  it("rejects a missing signature declaration before evaluating the input", async () => {
    const harness = createHarness({ signatures: OMIT_SIGNATURES });
    const result = await evaluate(harness);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "KERNEL_CAPABILITY_MISSING",
      node: "treated",
      path: "/nodes/treated/edges",
      details: {
        capability: "persistent-topology-signatures",
      },
    });
    expectNoGeometryCalls(harness);
  });

  it.each([
    ["wrong version", { protocolVersion: 3, fingerprint }],
    ["empty fingerprint", { protocolVersion: 1, fingerprint: "" }],
    ["extra key", { protocolVersion: 1, fingerprint, extra: true }],
    ["non-object", "invalid"],
  ])(
    "rejects malformed signature metadata: %s",
    async (_name, signatures) => {
      const harness = createHarness({ signatures });
      const result = await evaluate(harness);

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: "KERNEL_ERROR",
        node: "treated",
        path: "/nodes/treated/edges",
        details: { protocolViolation: true },
      });
      expectNoGeometryCalls(harness);
    },
  );

  it("contains revoked signature metadata and fails before geometry calls", async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const harness = createHarness({ signatures: revoked.proxy });
    const result = await evaluate(harness);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "KERNEL_ERROR",
      details: { protocolViolation: true },
    });
    expectNoGeometryCalls(harness);
  });

  it.each([
    ["non-array", "invalid"],
    ["too many profiles", new Array(2)],
    ["invalid item", [{ protocolVersion: 1, fingerprint: "" }]],
    [
      "duplicate protocol",
      [{ protocolVersion: 1, fingerprint: "other/signatures@1" }],
    ],
  ])(
    "rejects malformed compatibility signature profiles: %s",
    async (_name, signatureProfiles) => {
      const harness = createHarness({ signatureProfiles });
      const result = await evaluate(harness);

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: "KERNEL_ERROR",
        node: "treated",
        path: "/nodes/treated/edges",
        details: { protocolViolation: true },
      });
      expectNoGeometryCalls(harness);
    },
  );

  it("rejects a compatibility profile newer than the primary declaration", async () => {
    const harness = createHarness({
      signatures: signatureCapabilities,
      signatureProfiles: [signatureCapabilitiesV2],
    });
    const result = await evaluate(harness);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "KERNEL_ERROR",
      details: { protocolViolation: true },
    });
    expectNoGeometryCalls(harness);
  });

  it("rejects compatibility profiles without a primary declaration", async () => {
    const harness = createHarness({
      signatures: OMIT_SIGNATURES,
      signatureProfiles: [signatureCapabilities],
    });
    const result = await evaluate(harness);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "KERNEL_ERROR",
      details: { protocolViolation: true },
    });
    expectNoGeometryCalls(harness);
  });

  it("resolves frozen protocol-v1 evidence through a v2 kernel compatibility profile", async () => {
    const harness = createHarness({
      signatures: signatureCapabilitiesV2,
      signatureProfiles: [signatureCapabilities],
    });
    const result = await evaluate(harness);

    expect(result.ok).toBe(true);
    expect(harness.filletKeys).toEqual([[edges[0]!.key]]);
    expect(harness.topologyCalls()).toBe(1);
    expectDisposedSerials(harness, [0, 1]);
  });

  it("resolves protocol-v1 evidence with a v1-only face/edge kernel", async () => {
    const harness = createHarness({
      signatures: signatureCapabilities,
      topology: { kinds: ["face", "edge"] },
    });
    const result = await evaluate(harness);

    expect(result.ok).toBe(true);
    expect(harness.filletKeys).toEqual([[edges[0]!.key]]);
    expect(harness.topologyCalls()).toBe(1);
    expectDisposedSerials(harness, [0, 1]);
  });

  it("captures a compatibility-profile array length once before inspection", async () => {
    let lengthReads = 0;
    let itemReads = 0;
    const profiles = new Proxy([signatureCapabilities], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 1 : 1_000_000;
        }
        if (property === "0") itemReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const harness = createHarness({
      signatures: signatureCapabilitiesV2,
      signatureProfiles: profiles,
    });
    const result = await evaluate(harness);

    expect(result.ok).toBe(true);
    expect(lengthReads).toBe(1);
    expect(itemReads).toBe(1);
    expect(harness.filletKeys).toEqual([[edges[0]!.key]]);
  });

  it("prefers protocol v2 deterministically when both stored variants are compatible", async () => {
    const harness = createHarness({
      signatures: signatureCapabilitiesV2,
      signatureProfiles: [signatureCapabilities],
    });
    const result = await evaluate(
      harness,
      filletDocument([edgeReferences[0], v2EdgeReferences[1]]),
    );

    expect(result.ok).toBe(true);
    expect(harness.filletKeys).toEqual([[edges[1]!.key]]);
    expect(harness.topologyCalls()).toBe(1);
    expectDisposedSerials(harness, [0, 1]);
  });

  it("resolves v2 and protocol-v1 compatibility references in one operation", async () => {
    const harness = createHarness({
      signatures: signatureCapabilitiesV2,
      signatureProfiles: [signatureCapabilities],
    });
    const result = await evaluate(harness, mixedProfileFilletDocument());

    expect(result.ok).toBe(true);
    expect(harness.filletKeys).toEqual([[edges[0]!.key, edges[1]!.key]]);
    expect(harness.topologyCalls()).toBe(1);
    expectDisposedSerials(harness, [0, 1]);
  });

  it("rejects an unavailable exact fingerprint before evaluating the input", async () => {
    const harness = createHarness({
      signatures: { protocolVersion: 1, fingerprint: "other/signatures@1" },
    });
    const result = await evaluate(harness);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_FINGERPRINT_MISMATCH",
      node: "treated",
      path: "/nodes/treated/edges",
    });
    expectNoGeometryCalls(harness);
  });

  it.each(["before", "after"] as const)(
    "selects the current fingerprint when an unrelated variant is authored %s it",
    async (position) => {
      const foreign = {
        ...edgeReferences[0],
        kernelFingerprint: "other/signatures@1",
        geometry: {
          ...edgeReferences[0].geometry,
          center: [1_000, 1_000, 1_000],
        },
      } as PersistentTopologyReference<"edge">;
      const variants =
        position === "before"
          ? [foreign, edgeReferences[0]]
          : [edgeReferences[0], foreign];
      const document = JSON.parse(
        JSON.stringify(filletDocument()),
      ) as any;
      document.topologyReferences["stored-edge"].variants = variants;
      expect(
        document.topologyReferences["stored-edge"].variants[0]
          .kernelFingerprint,
      ).toBe(position === "before" ? foreign.kernelFingerprint : fingerprint);
      const harness = createHarness();
      const result = await evaluate(harness, document);

      expect(result.ok).toBe(true);
      expect(harness.boxCalls()).toBe(1);
      expect(harness.filletKeys).toEqual([[edges[0]!.key]]);
      expect(harness.disposeShapeCalls()).toBe(2);
      expectDisposedSerials(harness, [0, 1]);
    },
  );

  it("defensively rejects a prototype-named reference that ceases to be own", async () => {
    const document = JSON.parse(JSON.stringify(filletDocument())) as any;
    document.nodes.treated.edges.query.reference = "toString";
    const registry = document.topologyReferences;
    const entry = registry["stored-edge"];
    let ownChecks = 0;
    document.topologyReferences = new Proxy(registry, {
      getOwnPropertyDescriptor(target, property) {
        if (property === "toString") {
          ownChecks += 1;
          return ownChecks === 1
            ? {
                configurable: true,
                enumerable: false,
                value: entry,
                writable: false,
              }
            : undefined;
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      get(target, property, receiver) {
        return property === "toString"
          ? entry
          : Reflect.get(target, property, receiver);
      },
    });
    const harness = createHarness();

    await expect(evaluate(harness, document)).resolves.toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "REFERENCE_MISSING",
          node: "treated",
          path: "/nodes/treated/edges",
          details: { reference: "toString" },
        },
      ],
    });
    expect(ownChecks).toBe(2);
    expectNoGeometryCalls(harness);
  });

  it("passes the exact resolved edge and face keys into fillet and shell", async () => {
    const filletHarness = createHarness();
    const filletResult = await evaluate(filletHarness);
    expect(filletResult.ok).toBe(true);
    expect(filletHarness.boxCalls()).toBe(1);
    expect(filletHarness.topologyCalls()).toBe(1);
    expect(filletHarness.filletKeys).toEqual([[edges[0]!.key]]);
    expect(filletHarness.disposeShapeCalls()).toBe(2);
    expectDisposedSerials(filletHarness, [0, 1]);

    const shellHarness = createHarness();
    const shellResult = await evaluate(shellHarness, shellDocument());
    expect(shellResult.ok).toBe(true);
    expect(shellHarness.boxCalls()).toBe(1);
    expect(shellHarness.topologyCalls()).toBe(1);
    expect(shellHarness.shellKeys).toEqual([[faces[0]!.key]]);
    expect(shellHarness.disposeShapeCalls()).toBe(2);
    expectDisposedSerials(shellHarness, [0, 1]);
  });

  it.each([
    ["v2", DesignDocumentV2Schema, DOCUMENT_SCHEMA_V2, DOCUMENT_VERSION_V2],
    ["v3", DesignDocumentV3Schema, DOCUMENT_SCHEMA_V3, DOCUMENT_VERSION_V3],
    ["v4", DesignDocumentV4Schema, DOCUMENT_SCHEMA_V4, DOCUMENT_VERSION_V4],
    ["v5", DesignDocumentV5Schema, DOCUMENT_SCHEMA_V5, DOCUMENT_VERSION_V5],
  ] as const)(
    "directly evaluates a persistent selector under the frozen %s envelope",
    async (_label, schema, documentSchema, version) => {
      const document = schema.parse({
        ...filletDocument(),
        schema: documentSchema,
        version,
      });
      const harness = createHarness();
      const result = await evaluate(harness, document);

      expect(result.ok).toBe(true);
      expect(harness.filletKeys).toEqual([[edges[0]!.key]]);
      expect(harness.topologyCalls()).toBe(1);
      expectDisposedSerials(harness, [0, 1]);
    },
  );

  it.each([
    "fillet",
    "chamfer",
    "shell",
    "draft",
  ] as const)(
    "honors cancellation raised during persistent topology extraction before invoking %s",
    async (consumer) => {
      const abort = new AbortController();
      const harness = createHarness({
        topologyHook: () => abort.abort(),
      });
      const result = await evaluate(
        harness,
        persistentConsumerDocument(consumer),
        { signal: abort.signal },
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: "EVALUATION_ABORTED",
      });
      expect(harness.boxCalls()).toBe(1);
      expect(harness.topologyCalls()).toBe(1);
      expect(harness.filletKeys).toHaveLength(0);
      expect(harness.chamferKeys).toHaveLength(0);
      expect(harness.shellKeys).toHaveLength(0);
      expect(harness.draftKeys).toHaveLength(0);
      expect(harness.disposeShapeCalls()).toBe(1);
      expectDisposedSerials(harness, [0]);
    },
  );

  it("gives cancellation precedence over a simultaneous topology-match failure", async () => {
    const abort = new AbortController();
    const ambiguous = ambiguousSnapshot();
    const harness = createHarness({
      topologySnapshot: {
        history: ambiguous.history,
        get faces() {
          abort.abort();
          return ambiguous.faces;
        },
        edges: ambiguous.edges,
        vertices: ambiguous.vertices,
      },
    });
    const result = await evaluate(harness, filletDocument(), {
      signal: abort.signal,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "EVALUATION_ABORTED" }),
    ]);
    expect(harness.topologyCalls()).toBe(1);
    expect(harness.filletKeys).toHaveLength(0);
    expect(harness.disposeShapeCalls()).toBe(1);
    expectDisposedSerials(harness, [0]);
  });

  it("gives cancellation precedence over an extraction exception from the same callback", async () => {
    const abort = new AbortController();
    const harness = createHarness({
      topologyHook: () => {
        abort.abort();
        throw new Error("simultaneous extraction failure");
      },
    });
    const result = await evaluate(harness, filletDocument(), {
      signal: abort.signal,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "EVALUATION_ABORTED" }),
    ]);
    expect(harness.topologyCalls()).toBe(1);
    expect(harness.filletKeys).toHaveLength(0);
    expect(harness.disposeShapeCalls()).toBe(1);
    expectDisposedSerials(harness, [0]);
  });

  it("disposes the input exactly once when persistent evidence becomes ambiguous", async () => {
    const harness = createHarness({ topologySnapshot: ambiguousSnapshot() });
    const result = await evaluate(harness);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_MATCH_AMBIGUOUS",
      node: "treated",
      details: {
        reference: "stored-edge",
        explanation: {
          version: 1,
          outcome: "ambiguous",
          topology: "edge",
          candidatesConsidered: 2,
          candidatesMatched: 2,
        },
      },
    });
    expect(harness.filletKeys).toHaveLength(0);
    expect(harness.disposeShapeCalls()).toBe(1);
    expectDisposedSerials(harness, [0]);
  });

  it("shares operational matching work limits across stored references", async () => {
    const harness = createHarness();
    const result = await evaluate(harness, twoReferenceFilletDocument(), {
      topologySignatureLimits: { maxCandidatePairs: 3 },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
      node: "treated",
      path: "/nodes/treated/edges/query/queries/1/reference",
      details: {
        resource: "maxCandidatePairs",
        limit: 3,
        actual: 4,
      },
    });
    expect(harness.boxCalls()).toBe(1);
    expect(harness.topologyCalls()).toBe(1);
    expect(harness.filletKeys).toHaveLength(0);
    expect(harness.disposeShapeCalls()).toBe(1);
  });

  it("shares one matching work budget across v2 and compatibility-profile sessions", async () => {
    const harness = createHarness({
      signatures: signatureCapabilitiesV2,
      signatureProfiles: [signatureCapabilities],
    });
    const result = await evaluate(harness, mixedProfileFilletDocument(), {
      topologySignatureLimits: { maxCandidatePairs: 3 },
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
      node: "treated",
      path: "/nodes/treated/edges/query/queries/1/reference",
      details: {
        resource: "maxCandidatePairs",
        limit: 3,
        actual: 4,
        reference: "edge-v2",
      },
    });
    expect(harness.boxCalls()).toBe(1);
    expect(harness.topologyCalls()).toBe(1);
    expect(harness.filletKeys).toHaveLength(0);
    expect(harness.disposeShapeCalls()).toBe(1);
  });

  it.each(["and", "or", "not"] as const)(
    "keeps a persistent failure fatal through %s",
    async (wrapper) => {
      const displaced = {
        ...edgeReferences[0],
        geometry: {
          ...edgeReferences[0].geometry,
          center: [1_000, 1_000, 1_000],
          bounds: {
            min: [999, 999, 999],
            max: [1_001, 1_001, 1_001],
          },
        },
      } as PersistentTopologyReference<"edge">;
      const harness = createHarness();
      const result = await evaluate(
        harness,
        filletDocument([displaced], wrapper),
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: "TOPOLOGY_MATCH_MISSING",
        node: "treated",
        details: {
          reference: "stored-edge",
          explanation: {
            version: 1,
            outcome: "missing",
            topology: "edge",
            candidatesConsidered: 2,
            candidatesMatched: 0,
          },
        },
      });
      expect(result.diagnostics[0]?.path).toMatch(/\/reference$/u);
      expect(harness.boxCalls()).toBe(1);
      expect(harness.topologyCalls()).toBe(1);
      expect(harness.filletKeys).toHaveLength(0);
      expect(harness.disposeShapeCalls()).toBe(1);
    },
  );

  it.each([
    ["face topology", { kinds: ["edge"] }, "face-topology"],
    ["edge topology", { kinds: ["face"] }, "edge-topology"],
    ["geometry", { geometry: false }, "topology-geometry"],
    ["adjacency", { adjacency: false }, "topology-adjacency"],
  ] as const)(
    "requires both topology kinds plus %s descriptors",
    async (_name, topologyCapabilities, missing) => {
      const harness = createHarness({ topology: topologyCapabilities });
      const result = await evaluate(harness);

      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]).toMatchObject({
        code: "KERNEL_CAPABILITY_MISSING",
        node: "treated",
        path: "/nodes/treated/edges",
        details: { missing: expect.arrayContaining([missing]) },
      });
      expectNoGeometryCalls(harness);
    },
  );

  it("rejects a protocol-v2 declaration without the complete vertex graph capability", async () => {
    const captured = captureTopologyReference(
      snapshot,
      "edge",
      edges[0]!.key,
      {
        capabilities: signatureCapabilitiesV2,
        tolerance,
      },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const harness = createHarness({
      signatures: signatureCapabilitiesV2,
      topology: { kinds: ["face", "edge"] },
    });
    const document = filletDocument([captured.value]);
    const result = await evaluate(harness, document);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "KERNEL_ERROR",
      details: {
        protocolViolation: true,
        requiredTopologyKinds: ["face", "edge", "vertex"],
      },
    });
    expectNoGeometryCalls(harness);
  });
});
