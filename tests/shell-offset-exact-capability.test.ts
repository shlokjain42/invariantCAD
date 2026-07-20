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
  type KernelFeature,
  type KernelFeatureContext,
  type KernelShape,
  type KernelTopologyCapabilities,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
} from "../src/index.js";

type ShellOffsetFeature = "shell" | "offset";

type ShellOffsetInvocation =
  | {
      readonly feature: "shell";
      readonly input: KernelShape;
      readonly openings: readonly KernelTopologyKey[];
      readonly thickness: number;
      readonly direction: "inward" | "outward";
      readonly tolerance: number;
      readonly context?: KernelFeatureContext;
    }
  | {
      readonly feature: "offset";
      readonly input: KernelShape;
      readonly distance: number;
      readonly direction: "inward" | "outward";
      readonly tolerance: number;
      readonly context?: KernelFeatureContext;
    };

interface ShellOffsetKernelHarness {
  readonly kernel: GeometryKernel;
  readonly invocations: readonly ShellOffsetInvocation[];
  readonly topologyCalls: () => number;
}

interface ShellOffsetKernelOptions {
  readonly exact?: boolean;
  readonly features?: readonly KernelFeature[];
  readonly exactEvolution?: unknown;
  /** `null` deliberately omits topology capability metadata. */
  readonly topologyCapabilities?: KernelTopologyCapabilities | null;
  readonly implementTopology?: boolean;
}

const exactShellOffsetTopology: KernelTopologyCapabilities = {
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

const openingFaceKey = key("face-0");
const topologySnapshot: KernelTopologySnapshot = {
  history: "complete",
  faces: [
    {
      topology: "face",
      key: openingFaceKey,
      center: [5, 5, 10],
      bounds: { min: [0, 0, 10], max: [10, 10, 10] },
      lineage: [{ feature: "box", relation: "created" }],
      area: 100,
      surface: { kind: "plane", normal: [0, 0, 1] },
      edges: [],
    },
  ],
  edges: [],
  vertices: [],
};

function createShellOffsetKernelHarness(
  options: ShellOffsetKernelOptions = {},
): ShellOffsetKernelHarness {
  const id = "shell-offset-exact-capability-test";
  let serial = 0;
  let topologyCallCount = 0;
  const invocations: ShellOffsetInvocation[] = [];
  const shape = (): KernelShape =>
    ({ kernel: id, serial: serial++ }) as KernelShape;
  const topologyCapabilities =
    options.topologyCapabilities === undefined
      ? exactShellOffsetTopology
      : options.topologyCapabilities;
  const capabilities = {
    protocolVersion: 1,
    representation: "brep",
    exact: options.exact ?? false,
    primitives: ["box"],
    features: options.features ?? ["shell", "offset"],
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
    shell(input, openings, treatment, context): KernelShape {
      invocations.push({
        feature: "shell",
        input,
        openings: [...openings],
        thickness: treatment.thickness,
        direction: treatment.direction,
        tolerance: treatment.tolerance,
        ...(context === undefined ? {} : { context }),
      });
      return shape();
    },
    offset(input, treatment, context): KernelShape {
      invocations.push({
        feature: "offset",
        input,
        distance: treatment.distance,
        direction: treatment.direction,
        tolerance: treatment.tolerance,
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

function shellOffsetDocument(feature: ShellOffsetFeature, amount = 2) {
  const cad = design(`${feature} exact capability`);
  const box = cad.box("box", {
    size: vec3(mm(10), mm(10), mm(10)),
  });
  const result =
    feature === "shell"
      ? cad.shell("result", box, {
          openings: topology.faces.all().exactly(1),
          thickness: mm(amount),
          direction: "inward",
          tolerance: mm(1e-6),
        })
      : cad.offset("result", box, {
          distance: mm(amount),
          direction: "outward",
          tolerance: mm(1e-6),
        });
  cad.output("result", result);
  return cad.build();
}

async function evaluateWithHarness(
  feature: ShellOffsetFeature,
  options: ShellOffsetKernelOptions,
  amount = 2,
): Promise<{
  readonly harness: ShellOffsetKernelHarness;
  readonly result: CadResult<EvaluatedDesign>;
}> {
  const harness = createShellOffsetKernelHarness(options);
  const evaluator = await createEvaluator({ kernel: harness.kernel });
  const result = await evaluator.evaluate(shellOffsetDocument(feature, amount));
  if (result.ok) result.value.dispose();
  evaluator.dispose();
  return { harness, result };
}

function expectExactProtocolViolation(
  result: CadResult<EvaluatedDesign>,
  feature: ShellOffsetFeature,
  reason?: string,
): void {
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "KERNEL_ERROR",
      node: "result",
      path: "/nodes/result",
      details: expect.objectContaining({
        kernel: "shell-offset-exact-capability-test",
        kind: "exactIndexedTopologyEvolution",
        capability: feature,
        protocolViolation: true,
        ...(reason === undefined ? {} : { reason }),
      }),
    }),
  );
}

function expectedTopologyCalls(feature: ShellOffsetFeature): number {
  return feature === "shell" ? 1 : 0;
}

describe.each<ShellOffsetFeature>(["shell", "offset"])(
  "optional exact %s capability",
  (feature) => {
    it("runs through the partial-history path when exact metadata is absent", async () => {
      const { harness, result } = await evaluateWithHarness(feature, {
        exact: false,
      });

      expect(result.ok).toBe(true);
      expect(harness.topologyCalls()).toBe(expectedTopologyCalls(feature));
      expect(harness.invocations).toHaveLength(1);
      expect(harness.invocations[0]).toEqual(
        feature === "shell"
          ? expect.objectContaining({
              feature,
              openings: [openingFaceKey],
              thickness: 2,
              direction: "inward",
              tolerance: 1e-6,
            })
          : expect.objectContaining({
              feature,
              distance: 2,
              direction: "outward",
              tolerance: 1e-6,
            }),
      );
    });

    it("runs through the partial-history path when valid exact metadata omits the feature", async () => {
      const { harness, result } = await evaluateWithHarness(feature, {
        exact: true,
        exactEvolution: {
          protocolVersion: EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
          features: [],
        },
      });

      expect(result.ok).toBe(true);
      expect(harness.topologyCalls()).toBe(expectedTopologyCalls(feature));
      expect(harness.invocations).toHaveLength(1);
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
        name: "a sparse feature declaration",
        exactEvolution: {
          protocolVersion: 1,
          features: Array(1),
        },
        reason: "features must be a dense array of feature names",
      },
      {
        name: "duplicate features",
        exactEvolution: {
          protocolVersion: 1,
          features: [feature, feature],
        },
        reason: "features must not contain duplicates",
      },
      {
        name: "an undeclared exact feature",
        exactEvolution: {
          protocolVersion: 1,
          features: [feature, "boolean"],
        },
        reason: "exact evolution features must be declared kernel features",
      },
    ])(
      "fails closed for $name before selection or kernel execution",
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

    it("preflights malformed exact metadata before numeric validation", async () => {
      const { harness, result } = await evaluateWithHarness(
        feature,
        { exact: true, exactEvolution: null },
        0,
      );

      expectExactProtocolViolation(
        result,
        feature,
        "capability metadata must be an object",
      );
      expect(harness.topologyCalls()).toBe(0);
      expect(harness.invocations).toHaveLength(0);
      expect(result.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: "FEATURE_INVALID" }),
      );
    });

    it.each([
      {
        name: "an exact kernel",
        exact: false,
        topologyCapabilities: exactShellOffsetTopology,
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
          ...exactShellOffsetTopology,
          kinds: ["edge"] as const,
        },
        implementTopology: true,
        reason: `${feature} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
      },
      {
        name: "edge topology",
        exact: true,
        topologyCapabilities: {
          ...exactShellOffsetTopology,
          kinds: ["face"] as const,
        },
        implementTopology: true,
        reason: `${feature} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
      },
      {
        name: "feature provenance",
        exact: true,
        topologyCapabilities: {
          ...exactShellOffsetTopology,
          provenance: "none" as const,
        },
        implementTopology: true,
        reason: `${feature} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
      },
      {
        name: "topology()",
        exact: true,
        topologyCapabilities: exactShellOffsetTopology,
        implementTopology: false,
        reason: `${feature} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
      },
    ])(
      "requires $name before selection or kernel execution when exact evolution is advertised",
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
            ...exactShellOffsetTopology,
            provenance,
          },
          implementTopology: true,
        });

        expect(result.ok).toBe(true);
        expect(harness.topologyCalls()).toBe(expectedTopologyCalls(feature));
        expect(harness.invocations).toHaveLength(1);
        expect(harness.invocations[0]?.feature).toBe(feature);
      },
    );
  },
);
