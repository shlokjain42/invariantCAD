import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEvaluator,
  createReferenceSketchSolver,
  design,
  evaluateExpression,
  mm,
  plane,
  tessellateProfile,
  vec2,
  type Evaluator,
} from "../src/index.js";

let evaluator: Evaluator;

beforeAll(async () => {
  evaluator = await createEvaluator();
});

afterAll(() => evaluator.dispose());

describe("reference sketch solver", () => {
  it("preserves analytic profile curves and sketch provenance", () => {
    const cad = design("analytic-profile");
    cad.sketch("profile", plane.xy(), (sketch) => {
      const p0 = sketch.point("p0", vec2(mm(0), mm(0)));
      const p1 = sketch.point("p1", vec2(mm(10), mm(0)));
      const p2 = sketch.point("p2", vec2(mm(10), mm(10)));
      const p3 = sketch.point("p3", vec2(mm(0), mm(10)));
      const bottom = sketch.line("bottom", p0, p1);
      const right = sketch.line("right", p1, p2);
      const top = sketch.line("top", p2, p3);
      const left = sketch.line("left", p3, p0);
      const hole = sketch.circle("hole", {
        center: vec2(mm(5), mm(5)),
        radius: mm(2),
        segments: 32,
      });
      return sketch.profile(sketch.loop([bottom, right, top, left]), {
        holes: [hole.loop()],
      });
    });
    const node = Object.values(cad.build().nodes).find(
      (candidate) => candidate.kind === "sketch",
    );
    if (node?.kind !== "sketch") throw new Error("Sketch node was not built");
    const solver = createReferenceSketchSolver();
    try {
      // The numeric implementation has not established cross-runtime exactness.
      expect(solver.artifactCompatibilityFingerprint).toBeUndefined();
      const solved = solver.solve(node, {
        evaluate: (expression) =>
          evaluateExpression(expression, {
            resolveParameter: () => {
              throw new Error("This sketch has no parameters");
            },
          }),
        feature: "profile",
      });
      expect(solved.profile.outer.curves).toHaveLength(4);
      expect(solved.profile.outer.curves[0]).toEqual({
        kind: "line",
        start: [0, 0],
        end: [10, 0],
        source: {
          kind: "sketch-entity",
          sketch: "profile",
          entity: "bottom",
        },
      });
      expect(solved.profile.holes).toHaveLength(1);
      expect(solved.profile.holes[0]!.curves).toEqual([
        {
          kind: "circle",
          center: [5, 5],
          radius: 2,
          reversed: false,
          segments: 32,
          source: {
            kind: "sketch-entity",
            sketch: "profile",
            entity: "hole",
          },
        },
      ]);
      const tessellated = tessellateProfile(solved.profile);
      expect(tessellated.contours[0]).toHaveLength(4);
      expect(tessellated.contours[1]).toHaveLength(32);
    } finally {
      solver.dispose();
    }
  });

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
