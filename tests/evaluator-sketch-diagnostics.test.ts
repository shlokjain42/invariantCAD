import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  createReferenceSketchSolver,
  design,
  mm,
  plane,
  vec2,
  type Diagnostic,
  type SketchSolverBackend,
} from "../src/index.js";

function overConstrainedDocument() {
  const cad = design("over-constrained");
  const profile = cad.sketch("profile", plane.xy(), (sketch) => {
    const p0 = sketch.point("p0", vec2(mm(0), mm(0)));
    const p1 = sketch.point("p1", vec2(mm(10), mm(0)));
    const p2 = sketch.point("p2", vec2(mm(10), mm(10)));
    const p3 = sketch.point("p3", vec2(mm(0), mm(10)));
    const bottom = sketch.line("bottom", p0, p1);
    const right = sketch.line("right", p1, p2);
    const top = sketch.line("top", p2, p3);
    const left = sketch.line("left", p3, p0);
    sketch
      .fixed("fix-first", p0)
      .fixed("fix-second", p1)
      .length("impossible", bottom, mm(20));
    return sketch.profile(sketch.loop([bottom, right, top, left]));
  });
  cad.output("solid", cad.extrude("solid", profile, { distance: mm(1) }));
  return cad.build();
}

const summary = (items: readonly Diagnostic[]) =>
  items.map((item) => ({
    code: item.code,
    severity: item.severity,
    node: item.node,
  }));

describe("sketch solve failure diagnostics", () => {
  it("reports a failing solve once, attributed to the sketch node", async () => {
    const evaluator = await createEvaluator();
    try {
      const result = await evaluator.evaluate(overConstrainedDocument());
      if (result.ok) result.value.dispose();
      expect(result.ok).toBe(false);
      expect(summary(result.diagnostics)).toEqual([
        { code: "SKETCH_OVER_CONSTRAINED", severity: "error", node: "profile" },
      ]);
    } finally {
      evaluator.dispose();
    }
  });

  it("fails with the first error, not a leading warning, from a custom solver", async () => {
    const reference = createReferenceSketchSolver();
    const solver: SketchSolverBackend = {
      id: "warning-first",
      capabilities: reference.capabilities,
      solve(sketch, context) {
        const solved = reference.solve(sketch, context);
        return {
          ...solved,
          diagnostics: [
            {
              code: "SKETCH_UNDER_CONSTRAINED",
              severity: "warning",
              message: "advisory first",
            },
            ...solved.diagnostics,
          ],
        };
      },
      dispose() {
        reference.dispose();
      },
    };
    const evaluator = await createEvaluator({ sketchSolver: solver });
    try {
      const result = await evaluator.evaluate(overConstrainedDocument());
      if (result.ok) result.value.dispose();
      expect(result.ok).toBe(false);
      expect(summary(result.diagnostics)).toEqual([
        {
          code: "SKETCH_UNDER_CONSTRAINED",
          severity: "warning",
          node: "profile",
        },
        { code: "SKETCH_OVER_CONSTRAINED", severity: "error", node: "profile" },
      ]);
    } finally {
      evaluator.dispose();
    }
  });
});
