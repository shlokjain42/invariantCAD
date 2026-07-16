import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  createManifoldKernel,
  design,
  kernelSupports,
  mm,
  type GeometryKernel,
} from "../src/index.js";

describe("kernel capability negotiation", () => {
  it("queries primitive, feature, and export capabilities", async () => {
    const kernel = await createManifoldKernel();
    try {
      expect(kernelSupports(kernel.capabilities, "primitive", "box")).toBe(true);
      expect(kernelSupports(kernel.capabilities, "feature", "boolean")).toBe(true);
      expect(kernelSupports(kernel.capabilities, "export", "stl")).toBe(true);
      expect(kernelSupports(kernel.capabilities, "export", "step")).toBe(false);
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
          return (...arguments_: Parameters<GeometryKernel["sphere"]>) => {
            sphereInvoked = true;
            return target.sphere(...arguments_);
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
