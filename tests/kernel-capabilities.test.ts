import { describe, expect, it } from "vitest";
import {
  COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
  createEvaluator,
  createManifoldKernel,
  design,
  inspectKernelCompositeSweepCapabilities,
  kernelSupports,
  mm,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelCompositeSweepRefinement,
} from "../src/index.js";

describe("kernel capability negotiation", () => {
  it("distinguishes absent, valid, and malformed composite refinement metadata", () => {
    const base: KernelCapabilities = {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: ["compositeSweep"],
      nativeImports: [],
      nativeExports: [],
    };
    expect(inspectKernelCompositeSweepCapabilities(base)).toEqual({
      status: "absent",
    });

    const refinements = ["major-multiple-arcs"];
    const valid = inspectKernelCompositeSweepCapabilities({
      ...base,
      compositeSweep: {
        protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
        refinements: refinements as KernelCompositeSweepRefinement[],
      },
    });
    expect(valid).toEqual({
      status: "valid",
      capabilities: {
        protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
        refinements: ["major-multiple-arcs"],
      },
    });
    expect(valid.status === "valid" && Object.isFrozen(valid.capabilities)).toBe(
      true,
    );
    expect(
      valid.status === "valid" &&
        Object.isFrozen(valid.capabilities.refinements),
    ).toBe(true);
    refinements.push("major-eccentric-profile");
    expect(
      valid.status === "valid" ? valid.capabilities.refinements : [],
    ).toEqual(["major-multiple-arcs"]);

    const sparseRefinements = new Array(1) as string[];
    const malformedCases: readonly {
      readonly envelope: unknown;
      readonly reason: string;
      readonly details?: Readonly<Record<string, unknown>>;
    }[] = [
      {
        envelope: null,
        reason: "not-object",
        details: { actualType: "null" },
      },
      {
        envelope: { protocolVersion: 2, refinements: [] },
        reason: "unsupported-protocol-version",
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: "major-multiple-arcs",
        },
        reason: "refinements-not-array",
        details: { actualType: "string" },
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: sparseRefinements,
        },
        reason: "invalid-refinement",
        details: { index: 0, actualType: "missing" },
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: [42],
        },
        reason: "invalid-refinement",
        details: { index: 0, actualType: "number" },
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: ["future-refinement"],
        },
        reason: "unknown-refinement",
        details: { index: 0, refinement: "future-refinement" },
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: ["major-multiple-arcs", "major-multiple-arcs"],
        },
        reason: "duplicate-refinement",
        details: { index: 1, refinement: "major-multiple-arcs" },
      },
    ];
    for (const testCase of malformedCases) {
      expect(
        inspectKernelCompositeSweepCapabilities({
          ...base,
          compositeSweep:
            testCase.envelope as NonNullable<
              KernelCapabilities["compositeSweep"]
            >,
        }),
      ).toEqual(
        expect.objectContaining({
          status: "malformed",
          reason: testCase.reason,
          ...(testCase.details === undefined
            ? {}
            : { details: expect.objectContaining(testCase.details) }),
        }),
      );
    }
  });

  it("queries primitive, feature, and export capabilities", async () => {
    const kernel = await createManifoldKernel();
    try {
      expect(kernelSupports(kernel.capabilities, "primitive", "box")).toBe(true);
      expect(kernelSupports(kernel.capabilities, "feature", "boolean")).toBe(true);
      expect(
        kernelSupports(
          kernel.capabilities,
          "exactIndexedTopologyEvolution",
          "draft",
        ),
      ).toBe(false);
      expect(kernelSupports(kernel.capabilities, "nativeExport", "step")).toBe(
        false,
      );
    } finally {
      kernel.dispose();
    }
  });

  it("negotiates exact indexed topology evolution by protocol and feature", async () => {
    const kernel = await createManifoldKernel();
    try {
      const capable: KernelCapabilities = {
        ...kernel.capabilities,
        exact: true,
        exactIndexedTopologyEvolution: {
          protocolVersion: 1,
          features: ["draft"],
        },
      };
      expect(
        kernelSupports(capable, "exactIndexedTopologyEvolution", "draft"),
      ).toBe(true);
      expect(
        kernelSupports(capable, "exactIndexedTopologyEvolution", "fillet"),
      ).toBe(false);

      const stale = {
        ...capable,
        exactIndexedTopologyEvolution: {
          protocolVersion: 2,
          features: ["draft"],
        },
      } as unknown as KernelCapabilities;
      expect(
        kernelSupports(stale, "exactIndexedTopologyEvolution", "draft"),
      ).toBe(false);
    } finally {
      kernel.dispose();
    }
  });

  it("negotiates versioned composite-sweep refinements fail closed", async () => {
    const kernel = await createManifoldKernel();
    try {
      const refinements: readonly KernelCompositeSweepRefinement[] = [
        "major-multiple-arcs",
        "major-eccentric-profile",
      ];
      const capable: KernelCapabilities = {
        ...kernel.capabilities,
        features: [...kernel.capabilities.features, "compositeSweep"],
        compositeSweep: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements,
        },
      };
      for (const refinement of refinements) {
        expect(
          kernelSupports(capable, "compositeSweepRefinement", refinement),
        ).toBe(true);
      }

      const withoutBaseFeature: KernelCapabilities = {
        ...capable,
        features: capable.features.filter(
          (feature) => feature !== "compositeSweep",
        ),
      };
      expect(
        kernelSupports(
          withoutBaseFeature,
          "compositeSweepRefinement",
          "major-multiple-arcs",
        ),
      ).toBe(false);

      for (const malformedEnvelope of [
        { protocolVersion: 2, refinements },
        {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: ["major-multiple-arcs", "major-multiple-arcs"],
        },
        {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: ["major-multiple-arcs", "unknown-refinement"],
        },
        {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: "major-multiple-arcs",
        },
      ]) {
        const malformed = {
          ...capable,
          compositeSweep: malformedEnvelope,
        } as unknown as KernelCapabilities;
        expect(
          kernelSupports(
            malformed,
            "compositeSweepRefinement",
            "major-multiple-arcs",
          ),
        ).toBe(false);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("returns a structured failure before invoking an unsupported operation", async () => {
    const delegate = await createManifoldKernel();
    let sphereInvoked = false;
    const limited = new Proxy(delegate, {
      get(target, property) {
        if (property === "id") return "limited-test-kernel";
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            primitives: target.capabilities.primitives.filter(
              (primitive) => primitive !== "sphere",
            ),
          };
        }
        if (property === "sphere") {
          return (
            ...arguments_: Parameters<NonNullable<GeometryKernel["sphere"]>>
          ) => {
            sphereInvoked = true;
            return target.sphere!(...arguments_);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GeometryKernel;
    const evaluator = await createEvaluator({ kernel: limited });
    try {
      const cad = design("unsupported-sphere");
      cad.output("sphere", cad.sphere("sphere", { radius: mm(2) }));
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(false);
      expect(sphereInvoked).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "sphere",
          path: "/nodes/sphere",
          details: {
            kernel: "limited-test-kernel",
            kind: "primitive",
            capability: "sphere",
          },
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });
});
