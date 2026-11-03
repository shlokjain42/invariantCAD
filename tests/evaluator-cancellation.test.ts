import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  design,
  mm,
  vec3,
  type GeometryKernel,
  type KernelShape,
} from "../src/index.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";

interface KernelHarness {
  readonly kernel: GeometryKernel;
  readonly calls: string[];
  readonly live: Set<KernelShape>;
}

/** Records kernel feature calls and live shapes, running `hook` after each. */
async function recordingKernel(
  hook: (method: string) => void = () => undefined,
): Promise<KernelHarness> {
  const inner = await createManifoldKernel();
  const calls: string[] = [];
  const live = new Set<KernelShape>();
  const recorded = new Set(["box", "transform", "boolean"]);
  const kernel = new Proxy(inner, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      const method = String(property);
      return (...args: unknown[]) => {
        const output = (value as (...values: unknown[]) => unknown).apply(
          target,
          args,
        );
        if (method === "disposeShape") live.delete(args[0] as KernelShape);
        if (recorded.has(method)) {
          calls.push(method);
          live.add(output as KernelShape);
          hook(method);
        }
        return output;
      };
    },
  });
  return { kernel, calls, live };
}

function twoBoxes() {
  const cad = design("two-boxes");
  cad.output("a", cad.box("a", { size: vec3(mm(1), mm(1), mm(1)) }));
  cad.output("b", cad.box("b", { size: vec3(mm(2), mm(2), mm(2)) }));
  return cad.build();
}

describe("evaluation cancellation", () => {
  it("observes an abort raised inside a dependency before the dependent kernel call", async () => {
    const controller = new AbortController();
    const harness = await recordingKernel((method) => {
      if (method === "transform") controller.abort();
    });
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const cad = design("abort-in-dependency");
      const target = cad.box("target", { size: vec3(mm(4), mm(4), mm(4)) });
      const tool = cad.translate(
        "tool",
        cad.box("raw-tool", { size: vec3(mm(1), mm(1), mm(1)) }),
        vec3(mm(1), mm(1), mm(1)),
      );
      cad.output("cut", cad.subtract("cut", target, [tool]));
      const result = await evaluator.evaluate(cad.build(), {
        signal: controller.signal,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: "EVALUATION_ABORTED" }),
      ]);
      expect(harness.calls).toEqual(["box", "box", "transform"]);
      expect(harness.live.size).toBe(0);
    } finally {
      evaluator.dispose();
    }
  });

  it("lets a host abort scheduled before evaluation land before any kernel work", async () => {
    const harness = await recordingKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 0);
      const result = await evaluator.evaluate(twoBoxes(), {
        signal: controller.signal,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: "EVALUATION_ABORTED" }),
      ]);
      expect(harness.calls).toEqual([]);
    } finally {
      evaluator.dispose();
    }
  });

  it("lets a timer abort land between selected outputs and releases finished work", async () => {
    const controller = new AbortController();
    const harness = await recordingKernel((method) => {
      if (method === "box") setTimeout(() => controller.abort(), 0);
    });
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(twoBoxes(), {
        outputs: ["a", "b"],
        signal: controller.signal,
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({ code: "EVALUATION_ABORTED" }),
      ]);
      expect(harness.calls).toEqual(["box"]);
      expect(harness.live.size).toBe(0);
    } finally {
      evaluator.dispose();
    }
  });

  it("refuses to dispose the evaluator while a cancellable evaluation is pending", async () => {
    const harness = await recordingKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    const pending = evaluator.evaluate(twoBoxes(), {
      signal: new AbortController().signal,
    });
    expect(() => evaluator.dispose()).toThrow(
      "Cannot dispose an evaluator during an evaluation",
    );
    const result = await pending;
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.ok) result.value.dispose();
    evaluator.dispose();
  });

  it("still completes an evaluation without a signal inside the evaluate() call", async () => {
    const harness = await recordingKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const pending = evaluator.evaluate(twoBoxes());
      expect(harness.calls).toEqual(["box", "box"]);
      const result = await pending;
      expect(result.ok).toBe(true);
      if (result.ok) result.value.dispose();
    } finally {
      evaluator.dispose();
    }
  });
});
