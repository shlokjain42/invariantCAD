import { describe, expect, it } from "vitest";
import {
  EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
  createEvaluator,
  design,
  mm,
  topology,
  vec3,
  type CadResult,
  type EvaluatedDesign,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelEdgeDescriptor,
  type KernelFeature,
  type KernelFeatureContext,
  type KernelShape,
  type KernelTopologyCapabilities,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
} from "../src/index.js";

type EdgeTreatmentFeature = "fillet" | "chamfer";

interface EdgeTreatmentInvocation {
  readonly feature: EdgeTreatmentFeature;
  readonly input: KernelShape;
  readonly edges: readonly KernelTopologyKey[];
  readonly amount: number;
  readonly context?: KernelFeatureContext;
}

interface EdgeTreatmentKernelHarness {
  readonly kernel: GeometryKernel;
  readonly invocations: readonly EdgeTreatmentInvocation[];
  readonly topologyCalls: () => number;
}

interface EdgeTreatmentKernelOptions {
  readonly exact?: boolean;
  readonly features?: readonly KernelFeature[];
  readonly exactEvolution?: unknown;
  /** `null` deliberately omits topology capability metadata. */
  readonly topologyCapabilities?: KernelTopologyCapabilities | null;
  readonly implementTopology?: boolean;
}

const exactEdgeTreatmentTopology: KernelTopologyCapabilities = {
  kinds: ["face", "edge", "vertex"],
  provenance: "feature",
  semanticRoles: false,
  sketchSources: false,
  geometry: true,
  adjacency: true,
};

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

const selectedEdge: KernelEdgeDescriptor = {
  topology: "edge",
  key: key("edge-0"),
  center: [5, 0, 5],
  bounds: { min: [0, 0, 0], max: [10, 0, 10] },
  lineage: [{ feature: "box", relation: "created" }],
  length: 10,
  curve: { kind: "line", direction: [0, 0, 1] },
  faces: [],
  vertices: [],
};

const topologySnapshot: KernelTopologySnapshot = {
  history: "complete",
  faces: [],
  edges: [selectedEdge],
  vertices: [],
};

function createEdgeTreatmentKernelHarness(
  options: EdgeTreatmentKernelOptions = {},
): EdgeTreatmentKernelHarness {
  const id = "edge-treatment-exact-capability-test";
  let serial = 0;
  let topologyCallCount = 0;
  const invocations: EdgeTreatmentInvocation[] = [];
  const shape = (): KernelShape =>
    ({ kernel: id, serial: serial++ }) as KernelShape;
  const topologyCapabilities =
    options.topologyCapabilities === undefined
      ? exactEdgeTreatmentTopology
      : options.topologyCapabilities;
  const capabilities = {
    protocolVersion: 1,
    representation: "brep",
    exact: options.exact ?? false,
    primitives: ["box"],
    features: options.features ?? ["fillet", "chamfer"],
    nativeImports: [],
    nativeExports: [],
    ...(Object.hasOwn(options, "exactEvolution")
      ? { exactIndexedTopologyEvolution: options.exactEvolution }
      : {}),
    ...(topologyCapabilities === null
      ? {}
      : { topology: topologyCapabilities }),
  } as unknown as KernelCapabilities;
  const kernel: GeometryKernel = {
    id,
    capabilities,
    box: () => shape(),
    fillet(input, edges, treatment, context): KernelShape {
      invocations.push({
        feature: "fillet",
        input,
        edges: [...edges],
        amount: treatment.radius,
        ...(context === undefined ? {} : { context }),
      });
      return shape();
    },
    chamfer(input, edges, treatment, context): KernelShape {
      invocations.push({
        feature: "chamfer",
        input,
        edges: [...edges],
        amount: treatment.distance,
        ...(context === undefined ? {} : { context }),
      });
      return shape();
    },
    ...(options.implementTopology === false
      ? {}
      : {
          topology(): KernelTopologySnapshot {
            topologyCallCount += 1;
            return topologySnapshot;
          },
        }),
    mesh: () => ({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    }),
    measure: () => ({
      volume: 1,
      surfaceArea: 1,
      centerOfMass: [0.5, 0.5, 0.5],
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
    disposeShape: () => {},
    dispose: () => {},
  };
  return {
    kernel,
    invocations,
    topologyCalls: () => topologyCallCount,
  };
}

function edgeTreatmentDocument(feature: EdgeTreatmentFeature) {
  const cad = design(`${feature} exact capability`);
  const box = cad.box("box", {
    size: vec3(mm(10), mm(10), mm(10)),
  });
  const edges = topology.edges.all().exactly(1);
  const treated =
    feature === "fillet"
      ? cad.fillet("treated", box, { edges, radius: mm(2) })
      : cad.chamfer("treated", box, { edges, distance: mm(2) });
  cad.output("result", treated);
  return cad.build();
}

async function evaluateWithHarness(
  feature: EdgeTreatmentFeature,
  options: EdgeTreatmentKernelOptions,
): Promise<{
  readonly harness: EdgeTreatmentKernelHarness;
  readonly result: CadResult<EvaluatedDesign>;
}> {
  const harness = createEdgeTreatmentKernelHarness(options);
  const evaluator = await createEvaluator({ kernel: harness.kernel });
  const result = await evaluator.evaluate(edgeTreatmentDocument(feature));
  if (result.ok) result.value.dispose();
  evaluator.dispose();
  return { harness, result };
}

function expectExactProtocolViolation(
  result: CadResult<EvaluatedDesign>,
  feature: EdgeTreatmentFeature,
  reason?: string,
): void {
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "KERNEL_ERROR",
      node: "treated",
      path: "/nodes/treated",
      details: expect.objectContaining({
        kernel: "edge-treatment-exact-capability-test",
        kind: "exactIndexedTopologyEvolution",
        capability: feature,
        protocolViolation: true,
        ...(reason === undefined ? {} : { reason }),
      }),
    }),
  );
}

describe.each<EdgeTreatmentFeature>(["fillet", "chamfer"])(
  "optional exact %s capability",
  (feature) => {
    it("runs through the legacy topology path when exact metadata is absent", async () => {
      const { harness, result } = await evaluateWithHarness(feature, {
        exact: false,
      });

      expect(result.ok).toBe(true);
      expect(harness.topologyCalls()).toBe(1);
      expect(harness.invocations).toEqual([
        expect.objectContaining({
          feature,
          edges: [selectedEdge.key],
          amount: 2,
        }),
      ]);
    });

    it("runs through the legacy topology path when valid exact metadata omits the feature", async () => {
      const { harness, result } = await evaluateWithHarness(feature, {
        exact: true,
        exactEvolution: {
          protocolVersion: EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
          features: [],
        },
      });

      expect(result.ok).toBe(true);
      expect(harness.topologyCalls()).toBe(1);
      expect(harness.invocations).toHaveLength(1);
      expect(harness.invocations[0]).toEqual(
        expect.objectContaining({ feature, edges: [selectedEdge.key] }),
      );
    });

    it.each([
      {
        name: "non-object metadata",
        exactEvolution: null,
        reason: "capability metadata must be an object",
      },
      {
        name: "a stale protocol",
        exactEvolution: { protocolVersion: 2, features: [feature] },
        reason: "unsupported protocol version",
      },
      {
        name: "a non-array feature declaration",
        exactEvolution: { protocolVersion: 1, features: feature },
        reason: "features must be an array of feature names",
      },
      {
        name: "duplicate features",
        exactEvolution: {
          protocolVersion: 1,
          features: [feature, feature],
        },
        reason: "features must not contain duplicates",
      },
    ])(
      "fails closed for $name before selector resolution",
      async ({ exactEvolution, reason }) => {
        const { harness, result } = await evaluateWithHarness(feature, {
          exact: true,
          exactEvolution,
        });

        expectExactProtocolViolation(result, feature, reason);
        expect(harness.topologyCalls()).toBe(0);
        expect(harness.invocations).toHaveLength(0);
      },
    );

    it.each([
      {
        name: "an exact kernel",
        exact: false,
        topologyCapabilities: exactEdgeTreatmentTopology,
        implementTopology: true,
        reason: "exact evolution requires an exact kernel",
      },
      {
        name: "topology capability metadata",
        exact: true,
        topologyCapabilities: null,
        implementTopology: true,
        reason: `${feature} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
      },
      {
        name: "face topology",
        exact: true,
        topologyCapabilities: {
          ...exactEdgeTreatmentTopology,
          kinds: ["edge"] as const,
        },
        implementTopology: true,
        reason: `${feature} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
      },
      {
        name: "edge topology",
        exact: true,
        topologyCapabilities: {
          ...exactEdgeTreatmentTopology,
          kinds: ["face"] as const,
        },
        implementTopology: true,
        reason: `${feature} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
      },
      {
        name: "feature provenance",
        exact: true,
        topologyCapabilities: {
          ...exactEdgeTreatmentTopology,
          provenance: "none" as const,
        },
        implementTopology: true,
        reason: `${feature} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
      },
      {
        name: "topology()",
        exact: true,
        topologyCapabilities: exactEdgeTreatmentTopology,
        implementTopology: false,
        reason: `${feature} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
      },
    ])(
      "requires $name before selector resolution when exact evolution is advertised",
      async ({
        exact,
        topologyCapabilities,
        implementTopology,
        reason,
      }) => {
        const { harness, result } = await evaluateWithHarness(feature, {
          exact,
          exactEvolution: {
            protocolVersion:
              EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
            features: [feature],
          },
          topologyCapabilities,
          implementTopology,
        });

        expectExactProtocolViolation(result, feature, reason);
        expect(harness.topologyCalls()).toBe(0);
        expect(harness.invocations).toHaveLength(0);
      },
    );

    it.each(["feature", "history"] as const)(
      "runs when exact evolution is consistently advertised with %s provenance",
      async (provenance) => {
        const { harness, result } = await evaluateWithHarness(feature, {
          exact: true,
          exactEvolution: {
            protocolVersion:
              EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
            features: [feature],
          },
          topologyCapabilities: {
            ...exactEdgeTreatmentTopology,
            provenance,
          },
          implementTopology: true,
        });

        expect(result.ok).toBe(true);
        expect(harness.topologyCalls()).toBe(1);
        expect(harness.invocations).toHaveLength(1);
        expect(harness.invocations[0]).toEqual(
          expect.objectContaining({ feature, edges: [selectedEdge.key] }),
        );
      },
    );
  },
);
