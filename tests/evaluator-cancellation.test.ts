import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  design,
  mm,
  vec3,
  type DesignDocument,
  type EvaluatedSolid,
  type EvaluationOptions,
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
      if (result.ok) result.value.dispose();
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
      if (result.ok) result.value.dispose();
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
      if (result.ok) result.value.dispose();
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

  it("observes a timer abort issued while the last output was evaluated", async () => {
    const controller = new AbortController();
    const harness = await recordingKernel((method) => {
      if (method === "box") setTimeout(() => controller.abort(), 0);
    });
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(twoBoxes(), {
        outputs: ["a"],
        signal: controller.signal,
      });
      if (result.ok) result.value.dispose();
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

  it("captures a signal-bearing request so caller changes at a yield are ignored", async () => {
    const document = structuredClone(twoBoxes()) as DesignDocument;
    const nodes = document.nodes as Record<string, unknown>;
    const outputs = ["a", "b"];
    let changed = false;
    const harness = await recordingKernel((method) => {
      if (method !== "box" || changed) return;
      // Runs at the yield before output 'b'.
      setTimeout(() => {
        nodes.b = nodes.a;
        outputs[1] = "missing";
        changed = true;
      }, 0);
    });
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(document, {
        outputs,
        signal: new AbortController().signal,
      });
      expect(changed).toBe(true);
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      try {
        expect(result.value.outputNames).toEqual(["a", "b"]);
        const b = result.value.output("b") as EvaluatedSolid;
        expect(b.measure().volume).toBeCloseTo(8, 6);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("bounds a signal-bearing document before capturing it", async () => {
    const harness = await recordingKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      let deep: unknown = 1;
      for (let depth = 0; depth < 200; depth += 1) deep = [deep];
      const document = {
        ...twoBoxes(),
        metadata: { deep },
      } as unknown as DesignDocument;
      const result = await evaluator.evaluate(document, {
        signal: new AbortController().signal,
      });
      if (result.ok) result.value.dispose();
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "IR_INVALID",
          details: { resource: "maxNestingDepth", limit: 128, actual: 129 },
        }),
      ]);
      expect(harness.calls).toEqual([]);
    } finally {
      evaluator.dispose();
    }
  });

  it("captures options as own data without iterating or invoking caller code", async () => {
    const harness = await recordingKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const signal = new AbortController().signal;
      let advanced = 0;
      function* forever() {
        for (;;) {
          advanced += 1;
          yield "a";
        }
      }
      let getterReads = 0;
      const sparse: string[] = [];
      sparse[0] = "a";
      sparse[2] = "b";
      const cases: readonly {
        readonly options: EvaluationOptions;
        readonly path: string;
      }[] = [
        {
          options: {
            signal,
            outputs: forever() as unknown as readonly string[],
          },
          path: "/options/outputs",
        },
        {
          options: {
            signal,
            get allowEmpty() {
              getterReads += 1;
              return true;
            },
          },
          path: "/options/allowEmpty",
        },
        { options: { signal, outputs: sparse }, path: "/options/outputs/1" },
      ];
      for (const { options, path } of cases) {
        const result = await evaluator.evaluate(twoBoxes(), options);
        if (result.ok) result.value.dispose();
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toEqual([
          expect.objectContaining({ code: "IR_INVALID", path }),
        ]);
      }
      expect(advanced).toBe(0);
      expect(getterReads).toBe(0);
      expect(harness.calls).toEqual([]);
    } finally {
      evaluator.dispose();
    }
  });

  it("reads the output selection only up to the first undeclared name", async () => {
    const harness = await recordingKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      let laterReads = 0;
      const outputs = ["a", "a", "missing"];
      Object.defineProperty(outputs, 3, {
        enumerable: true,
        get() {
          laterReads += 1;
          return "b";
        },
      });
      const result = await evaluator.evaluate(twoBoxes(), {
        outputs,
        signal: new AbortController().signal,
      });
      if (result.ok) result.value.dispose();
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "OUTPUT_MISSING",
          path: "/outputs/missing",
        }),
      ]);
      expect(harness.calls).toEqual(["box"]);
      expect(harness.live.size).toBe(0);
      expect(laterReads).toBe(0);
    } finally {
      evaluator.dispose();
    }
  });

  it("evaluates synchronously when the signal is not an own data property", async () => {
    const harness = await recordingKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const controller = new AbortController();
      const options = {
        get signal() {
          return controller.signal;
        },
      };
      const pending = evaluator.evaluate(twoBoxes(), options);
      const callsInsideEvaluate = [...harness.calls];
      const result = await pending;
      try {
        expect(callsInsideEvaluate).toEqual(["box", "box"]);
        expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      } finally {
        if (result.ok) result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("refuses to dispose the evaluator while a cancellable evaluation is pending", async () => {
    const harness = await recordingKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const pending = evaluator.evaluate(twoBoxes(), {
        signal: new AbortController().signal,
      });
      let disposeError: unknown;
      try {
        evaluator.dispose();
      } catch (error) {
        disposeError = error;
      }
      const result = await pending;
      try {
        expect(disposeError).toEqual(
          new Error("Cannot dispose an evaluator during an evaluation"),
        );
        expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      } finally {
        if (result.ok) result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("still completes an evaluation without a signal inside the evaluate() call", async () => {
    const harness = await recordingKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const pending = evaluator.evaluate(twoBoxes());
      const callsInsideEvaluate = [...harness.calls];
      const result = await pending;
      try {
        expect(callsInsideEvaluate).toEqual(["box", "box"]);
        expect(result.ok).toBe(true);
      } finally {
        if (result.ok) result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });
});
