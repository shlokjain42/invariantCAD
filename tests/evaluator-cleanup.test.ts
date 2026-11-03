import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  design,
  mm,
  vec3,
  type DesignDocument,
  type GeometryKernel,
  type KernelShape,
} from "../src/index.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";

interface DisposeHarness {
  readonly kernel: GeometryKernel;
  readonly created: KernelShape[];
  readonly attempts: KernelShape[];
  readonly released: Set<KernelShape>;
}

/**
 * Wraps a real Manifold kernel and fails the nth disposeShape call once
 * without releasing that shape.
 */
async function failingDisposeKernel(failOnCall: number): Promise<DisposeHarness> {
  const inner = await createManifoldKernel();
  const created: KernelShape[] = [];
  const attempts: KernelShape[] = [];
  const released = new Set<KernelShape>();
  let calls = 0;
  const kernel = new Proxy(inner, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property === "disposeShape") {
        return (shape: KernelShape) => {
          calls += 1;
          attempts.push(shape);
          if (calls === failOnCall) {
            throw new Error(`transient release failure on call ${calls}`);
          }
          target.disposeShape(shape);
          released.add(shape);
        };
      }
      if (property === "box") {
        return (...args: Parameters<NonNullable<GeometryKernel["box"]>>) => {
          const shape = target.box!(...args);
          created.push(shape);
          return shape;
        };
      }
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        (value as (...values: unknown[]) => unknown).apply(target, args);
    },
  });
  return { kernel, created, attempts, released };
}

function threeBoxes(options: { readonly invalidThird?: boolean } = {}): DesignDocument {
  const cad = design("cleanup");
  cad.output("a", cad.box("a", { size: vec3(mm(1), mm(1), mm(1)) }));
  cad.output("b", cad.box("b", { size: vec3(mm(2), mm(2), mm(2)) }));
  cad.output("c", cad.box("c", { size: vec3(mm(3), mm(3), mm(3)) }));
  const document = structuredClone(cad.build()) as DesignDocument;
  if (options.invalidThird === true) {
    (
      (document.nodes as Record<string, unknown>).c as {
        size: { value: number }[];
      }
    ).size[0]!.value = 0;
  }
  return document;
}

describe("evaluation failure cleanup", () => {
  it("returns the structured failure and attempts every created shape when one release throws", async () => {
    const harness = await failingDisposeKernel(1);
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(
        threeBoxes({ invalidThird: true }),
        { outputs: ["a", "b", "c"] },
      );
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "FEATURE_INVALID",
          node: "c",
          path: "/nodes/c/size/0",
        }),
      ]);
      expect(harness.created).toHaveLength(2);
      expect(harness.attempts).toEqual(harness.created);
      expect(harness.released).toEqual(new Set([harness.created[1]]));
    } finally {
      evaluator.dispose();
    }
  });
});

describe("EvaluatedDesign disposal", () => {
  it("marks the result disposed and attempts every shape once when a release throws", async () => {
    const harness = await failingDisposeKernel(2);
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(threeBoxes());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(harness.created).toHaveLength(3);
      expect(() => result.value.dispose()).toThrow(
        "transient release failure on call 2",
      );
      expect(harness.attempts).toEqual(harness.created);
      expect(harness.released).toEqual(
        new Set([harness.created[0], harness.created[2]]),
      );
      expect(() => result.value.output("a").measure()).toThrow(
        "This evaluation result has been disposed",
      );
      result.value.dispose();
      expect(harness.attempts).toHaveLength(3);
    } finally {
      evaluator.dispose();
    }
  });
});
