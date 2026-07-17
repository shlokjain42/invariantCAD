import { describe, expect, it } from "vitest";
import {
  COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
  createEvaluator,
  createManifoldKernel,
  design,
  kernelSupports,
  mm,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelCompositeSweepRefinement,
} from "../src/index.js";

describe("kernel capability negotiation", () => {
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
