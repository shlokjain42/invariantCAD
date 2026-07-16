import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEvaluator,
  design,
  mm,
  plane,
  vec2,
  type Evaluator,
} from "../src/index.js";

let evaluator: Evaluator;

beforeAll(async () => {
  evaluator = await createEvaluator();
});

afterAll(() => evaluator.dispose());

describe("reference sketch solver", () => {
  it("solves dimensional and orientation constraints", async () => {
    const cad = design("constrained-square");
    const profile = cad.sketch("profile", plane.xy(), (sketch) => {
      const p0 = sketch.point("p0", vec2(mm(0), mm(0)));
      const p1 = sketch.point("p1", vec2(mm(9), mm(1)));
      const p2 = sketch.point("p2", vec2(mm(9), mm(9)));
      const p3 = sketch.point("p3", vec2(mm(1), mm(9)));
      const bottom = sketch.line("bottom", p0, p1);
      const right = sketch.line("right", p1, p2);
      const top = sketch.line("top", p2, p3);
      const left = sketch.line("left", p3, p0);
      sketch
        .fixed("fix-origin", p0)
        .horizontal("bottom-horizontal", bottom)
        .vertical("right-vertical", right)
        .horizontal("top-horizontal", top)
        .vertical("left-vertical", left)
        .length("bottom-length", bottom, mm(10))
        .length("left-length", left, mm(10));
      return sketch.profile(sketch.loop([bottom, right, top, left]));
    });
    const solid = cad.extrude("solid", profile, { distance: mm(2) });
    cad.output("solid", solid);
    const result = await evaluator.evaluate(cad.build());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.value.output("solid").measure().volume).toBeCloseTo(200, 3);
      expect(
        result.diagnostics.some((item) => item.code === "SKETCH_OVER_CONSTRAINED"),
      ).toBe(false);
    } finally {
      result.value.dispose();
    }
  });

  it("reports unsatisfiable constraints structurally", async () => {
    const cad = design("bad-sketch");
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
    const result = await evaluator.evaluate(cad.build());
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some((item) => item.code === "SKETCH_OVER_CONSTRAINED"),
    ).toBe(true);
  });
});
