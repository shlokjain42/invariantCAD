import { describe, expect, it } from "vitest";
import {
  EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
  createEvaluator,
  design,
  mm,
  vec3,
  type CadResult,
  type EvaluatedDesign,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelFeature,
  type KernelFeatureContext,
  type KernelShape,
  type KernelTopologyCapabilities,
  type KernelTopologySnapshot,
} from "../src/index.js";

interface BooleanInvocation {
  readonly operation: "union" | "subtract" | "intersect";
  readonly target: KernelShape;
  readonly tools: readonly KernelShape[];
  readonly context?: KernelFeatureContext;
}

interface BooleanKernelHarness {
  readonly kernel: GeometryKernel;
  readonly invocations: readonly BooleanInvocation[];
  readonly topologyCalls: () => number;
}

interface BooleanKernelOptions {
  readonly exact?: boolean;
  readonly features?: readonly KernelFeature[];
  readonly exactEvolution?: unknown;
  readonly topologyCapabilities?: KernelTopologyCapabilities;
  readonly implementTopology?: boolean;
}

const exactBooleanTopology: KernelTopologyCapabilities = {
  kinds: ["face", "edge"],
  provenance: "feature",
  semanticRoles: false,
  sketchSources: false,
  geometry: true,
  adjacency: true,
};

const emptyTopologySnapshot: KernelTopologySnapshot = {
  history: "complete",
  faces: [],
  edges: [],
};

function createBooleanKernelHarness(
  options: BooleanKernelOptions = {},
): BooleanKernelHarness {
  const id = "boolean-exact-capability-test";
  let serial = 0;
  let topologyCallCount = 0;
  const invocations: BooleanInvocation[] = [];
  const shape = (): KernelShape =>
    ({ kernel: id, serial: serial++ }) as KernelShape;
  const capabilities = {
    protocolVersion: 1,
    representation: "brep",
    exact: options.exact ?? false,
    primitives: ["box"],
    features: options.features ?? ["boolean"],
    nativeImports: [],
    nativeExports: [],
    ...(Object.hasOwn(options, "exactEvolution")
      ? { exactIndexedTopologyEvolution: options.exactEvolution }
      : {}),
    ...(options.topologyCapabilities === undefined
      ? {}
      : { topology: options.topologyCapabilities }),
  } as unknown as KernelCapabilities;
  const kernel: GeometryKernel = {
    id,
    capabilities,
    box: () => shape(),
    boolean(
      operation: "union" | "subtract" | "intersect",
      target: KernelShape,
      tools: readonly KernelShape[],
      context?: KernelFeatureContext,
    ): KernelShape {
      invocations.push({
        operation,
        target,
        tools: [...tools],
        ...(context === undefined ? {} : { context }),
      });
      return shape();
    },
    ...(options.implementTopology
      ? {
          topology(): KernelTopologySnapshot {
            topologyCallCount += 1;
            return emptyTopologySnapshot;
          },
        }
      : {}),
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

function booleanDocument() {
  const cad = design("boolean exact capability");
  const target = cad.box("target", {
    size: vec3(mm(10), mm(10), mm(10)),
  });
  const tool = cad.box("tool", {
    size: vec3(mm(5), mm(5), mm(5)),
  });
  cad.output("result", cad.union("result", target, [tool]));
  return cad.build();
}

async function evaluateWithHarness(
  options: BooleanKernelOptions,
): Promise<{
  readonly harness: BooleanKernelHarness;
  readonly result: CadResult<EvaluatedDesign>;
}> {
  const harness = createBooleanKernelHarness(options);
  const evaluator = await createEvaluator({ kernel: harness.kernel });
  const result = await evaluator.evaluate(booleanDocument());
  if (result.ok) result.value.dispose();
  evaluator.dispose();
  return { harness, result };
}

function expectExactProtocolViolation(
  result: CadResult<EvaluatedDesign>,
  reason?: string,
): void {
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "KERNEL_ERROR",
      node: "result",
      path: "/nodes/result",
      details: expect.objectContaining({
        kernel: "boolean-exact-capability-test",
        kind: "exactIndexedTopologyEvolution",
        capability: "boolean",
        protocolViolation: true,
        ...(reason === undefined ? {} : { reason }),
      }),
    }),
  );
}

describe("optional exact Boolean capability", () => {
  it("runs an ordinary Boolean when exact-evolution metadata is absent", async () => {
    const { harness, result } = await evaluateWithHarness({ exact: false });

    expect(result.ok).toBe(true);
    expect(harness.invocations).toHaveLength(1);
    expect(harness.invocations[0]).toEqual(
      expect.objectContaining({ operation: "union" }),
    );
    expect(harness.topologyCalls()).toBe(0);
  });

  it("runs a partial Boolean when valid exact metadata omits Boolean", async () => {
    const { harness, result } = await evaluateWithHarness({
      exact: true,
      exactEvolution: {
        protocolVersion: EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
        features: [],
      },
    });

    expect(result.ok).toBe(true);
    expect(harness.invocations).toHaveLength(1);
    expect(harness.topologyCalls()).toBe(0);
  });

  it.each([
    {
      name: "non-object metadata",
      exactEvolution: null,
      reason: "capability metadata must be an object",
    },
    {
      name: "a stale protocol",
      exactEvolution: { protocolVersion: 2, features: ["boolean"] },
      reason: "unsupported protocol version",
    },
    {
      name: "a non-array feature declaration",
      exactEvolution: { protocolVersion: 1, features: "boolean" },
      reason: "features must be an array of feature names",
    },
    {
      name: "duplicate features",
      exactEvolution: {
        protocolVersion: 1,
        features: ["boolean", "boolean"],
      },
      reason: "features must not contain duplicates",
    },
  ])("fails closed for $name", async ({ exactEvolution, reason }) => {
    const { harness, result } = await evaluateWithHarness({
      exact: true,
      exactEvolution,
      topologyCapabilities: exactBooleanTopology,
      implementTopology: true,
    });

    expectExactProtocolViolation(result, reason);
    expect(harness.invocations).toHaveLength(0);
    expect(harness.topologyCalls()).toBe(0);
  });

  it("requires the advertised exact feature to be a declared base feature", async () => {
    const { harness, result } = await evaluateWithHarness({
      exact: true,
      features: [],
      exactEvolution: {
        protocolVersion: EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
        features: ["boolean"],
      },
      topologyCapabilities: exactBooleanTopology,
      implementTopology: true,
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "KERNEL_CAPABILITY_MISSING",
        node: "result",
        path: "/nodes/result",
        details: expect.objectContaining({
          kernel: "boolean-exact-capability-test",
          kind: "feature",
          capability: "boolean",
        }),
      }),
    );
    expect(harness.invocations).toHaveLength(0);
    expect(harness.topologyCalls()).toBe(0);
  });

  it.each([
    {
      name: "an exact kernel",
      exact: false,
      topologyCapabilities: exactBooleanTopology,
      implementTopology: true,
      reason: "exact evolution requires an exact kernel",
    },
    {
      name: "face topology",
      exact: true,
      topologyCapabilities: {
        ...exactBooleanTopology,
        kinds: ["edge"] as const,
      },
      implementTopology: true,
      reason:
        "boolean evolution requires face and edge topology with feature-or-history provenance",
    },
    {
      name: "edge topology",
      exact: true,
      topologyCapabilities: {
        ...exactBooleanTopology,
        kinds: ["face"] as const,
      },
      implementTopology: true,
      reason:
        "boolean evolution requires face and edge topology with feature-or-history provenance",
    },
    {
      name: "feature provenance",
      exact: true,
      topologyCapabilities: {
        ...exactBooleanTopology,
        provenance: "none" as const,
      },
      implementTopology: true,
      reason:
        "boolean evolution requires face and edge topology with feature-or-history provenance",
    },
    {
      name: "topology()",
      exact: true,
      topologyCapabilities: exactBooleanTopology,
      implementTopology: false,
      reason:
        "boolean evolution requires face and edge topology with feature-or-history provenance",
    },
  ])(
    "requires $name when exact Boolean evolution is advertised",
    async ({ exact, topologyCapabilities, implementTopology, reason }) => {
      const { harness, result } = await evaluateWithHarness({
        exact,
        exactEvolution: {
          protocolVersion: EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
          features: ["boolean"],
        },
        topologyCapabilities,
        implementTopology,
      });

      expectExactProtocolViolation(result, reason);
      expect(harness.invocations).toHaveLength(0);
      expect(harness.topologyCalls()).toBe(0);
    },
  );

  it("runs when exact Boolean evolution is advertised consistently", async () => {
    const { harness, result } = await evaluateWithHarness({
      exact: true,
      exactEvolution: {
        protocolVersion: EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
        features: ["boolean"],
      },
      topologyCapabilities: exactBooleanTopology,
      implementTopology: true,
    });

    expect(result.ok).toBe(true);
    expect(harness.invocations).toHaveLength(1);
    expect(harness.invocations[0]).toEqual(
      expect.objectContaining({ operation: "union" }),
    );
    expect(harness.topologyCalls()).toBe(0);
  });
});
