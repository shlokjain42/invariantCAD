import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEvaluator,
  createReferenceSketchSolver,
  design,
  evaluateExpression,
  mm,
  plane,
  rad,
  tessellateProfile,
  vec2,
  type DesignBuilder,
  type DesignDocument,
  type Evaluator,
  type ExpressionIR,
  type SketchBuilder,
  type SketchNodeIR,
  type SketchSolveStatus,
  type SketchSolverBackend,
  type SolvedSketch,
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

function literalEvaluate(expression: ExpressionIR): number {
  return evaluateExpression(expression, {
    resolveParameter: () => {
      throw new Error("This sketch has no parameters");
    },
  });
}

function sketchNode(
  document: DesignDocument,
  id = "profile",
): SketchNodeIR {
  const node = document.nodes[id as keyof typeof document.nodes];
  if (node?.kind !== "sketch") throw new Error(`Sketch '${id}' was not built`);
  return node;
}

function sketchDocument(
  build: (sketch: SketchBuilder) => ReturnType<SketchBuilder["profile"]>,
  extrude = true,
): DesignDocument {
  const cad: DesignBuilder = design("solver-fixture");
  const profile = cad.sketch("profile", plane.xy(), build);
  if (extrude) {
    cad.output("solid", cad.extrude("solid", profile, { distance: mm(2) }));
  }
  return cad.build();
}

function solveReference(
  document: DesignDocument,
  evaluate: (expression: ExpressionIR) => number = literalEvaluate,
): SolvedSketch {
  const solver = createReferenceSketchSolver();
  try {
    return solver.solve(sketchNode(document), { evaluate, feature: "profile" });
  } finally {
    solver.dispose();
  }
}

function angleTriangle(value: number): DesignDocument {
  return sketchDocument((sketch) => {
    const a = sketch.point("a", vec2(mm(0), mm(0)));
    const b = sketch.point("b", vec2(mm(10), mm(0)));
    const c = sketch.point("c", vec2(mm(0), mm(10)));
    const ab = sketch.line("ab", a, b);
    const bc = sketch.line("bc", b, c);
    const ca = sketch.line("ca", c, a);
    sketch
      .fixed("anchor", a)
      .horizontal("base", ab)
      .length("base-length", ab, mm(10))
      .length("side-length", ca, mm(10))
      .angle("apex", ab, ca, rad(value));
    return sketch.profile(sketch.loop([ab, bc, ca]));
  });
}

describe("reference solver angle constraints", () => {
  it("reduces huge finite angle constraints in bounded time", () => {
    const reduced = (value: number): number => Math.atan2(Math.sin(value), Math.cos(value));
    for (const value of [1e7, 1e17, 1e20, Number.MAX_VALUE, -1e20]) {
      const started = performance.now();
      const solved = solveReference(angleTriangle(value));
      expect(performance.now() - started).toBeLessThan(2_000);
      const equivalent = solveReference(angleTriangle(reduced(value)));
      expect(solved.status).toBe("solved");
      expect(equivalent.status).toBe("solved");
      expect(solved.points["c" as never]![0]).toBeCloseTo(
        equivalent.points["c" as never]![0],
        6,
      );
      expect(solved.points["c" as never]![1]).toBeCloseTo(
        equivalent.points["c" as never]![1],
        6,
      );
    }
  });

  it("keeps a huge angle document cancellable and bounded through the evaluator", async () => {
    const result = await evaluator.evaluate(angleTriangle(1e20), {
      signal: AbortSignal.timeout(5_000),
    });
    expect(result.diagnostics.some((item) => item.code === "EVALUATION_ABORTED")).toBe(
      false,
    );
    if (result.ok) result.value.dispose();
  });
});

function statusSolver(
  status: SketchSolveStatus | string,
  options: {
    readonly diagnostics?: SolvedSketch["diagnostics"];
    readonly residual?: number;
    readonly capabilities?: Partial<SketchSolverBackend["capabilities"]>;
  } = {},
): SketchSolverBackend & { readonly solveCalls: () => number } {
  const delegate = createReferenceSketchSolver();
  let calls = 0;
  return {
    id: "status-fixture",
    capabilities: { ...delegate.capabilities, ...options.capabilities },
    solve(sketch, context) {
      calls += 1;
      const solved = delegate.solve(sketch, context);
      return {
        ...solved,
        status: status as SketchSolveStatus,
        residual: options.residual ?? solved.residual,
        diagnostics: options.diagnostics ?? [],
      };
    },
    dispose() {
      delegate.dispose();
    },
    solveCalls: () => calls,
  };
}

function conflictingCircleDocument(): DesignDocument {
  return sketchDocument((sketch) => {
    const circle = sketch.circle("circle", {
      center: vec2(mm(0), mm(0)),
      radius: mm(7),
    });
    sketch.radius("radius", circle, mm(7)).diameter("diameter", circle, mm(20));
    return sketch.profile(circle.loop());
  });
}

describe("evaluator sketch-solver status and capability admission", () => {
  it("does not report a non-finite residual as solved", () => {
    const document = sketchDocument((sketch) => {
      const circle = sketch.circle("circle", {
        center: vec2(mm(0), mm(0)),
        radius: mm(7),
      });
      sketch.radius("radius", circle, mm(7));
      return sketch.profile(circle.loop());
    });
    const radiusValue = (
      sketchNode(document).constraints[
        "radius" as keyof SketchNodeIR["constraints"]
      ] as { readonly value: ExpressionIR }
    ).value;
    const solved = solveReference(document, (expression) =>
      expression === radiusValue ? Number.NaN : literalEvaluate(expression),
    );
    expect(solved.status).toBe("nonconvergent");
    expect(solved.diagnostics).toEqual([
      expect.objectContaining({ code: "SKETCH_SOLVE_FAILED", severity: "error" }),
    ]);
  });

  it.each([
    ["overconstrained", "SKETCH_OVER_CONSTRAINED", "/nodes/profile/constraints", "overconstrained"],
    ["nonconvergent", "SKETCH_SOLVE_FAILED", "/nodes/profile", "nonconvergent"],
    ["invalid", "SKETCH_SOLVE_FAILED", "/nodes/profile", "invalid"],
    ["mystery", "SKETCH_SOLVE_FAILED", "/nodes/profile", "unrecognized"],
  ] as const)(
    "rejects a custom %s solve that reports no error diagnostic",
    async (status, code, path, detailStatus) => {
      const custom = await createEvaluator({ sketchSolver: statusSolver(status) });
      try {
        const result = await custom.evaluate(conflictingCircleDocument());
        expect(result.ok).toBe(false);
        expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([
          expect.objectContaining({
            code,
            node: "profile",
            path,
            details: { sketchSolver: "status-fixture", status: detailStatus },
          }),
        ]);
      } finally {
        custom.dispose();
      }
    },
  );

  it("rejects a failed status even when the solver only reports warnings", async () => {
    const custom = await createEvaluator({
      sketchSolver: statusSolver("nonconvergent", {
        diagnostics: [
          {
            code: "SKETCH_UNDER_CONSTRAINED",
            severity: "warning",
            message: "Solver warning only",
          },
        ],
      }),
    });
    try {
      const result = await custom.evaluate(conflictingCircleDocument());
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((item) => [item.code, item.severity])).toEqual([
        ["SKETCH_UNDER_CONSTRAINED", "warning"],
        ["SKETCH_SOLVE_FAILED", "error"],
      ]);
    } finally {
      custom.dispose();
    }
  });

  it("rejects an admitted status with a non-finite residual", async () => {
    const custom = await createEvaluator({
      sketchSolver: statusSolver("solved", { residual: Number.NaN }),
    });
    try {
      const result = await custom.evaluate(conflictingCircleDocument());
      expect(result.ok).toBe(false);
      expect(result.diagnostics.at(-1)).toEqual(
        expect.objectContaining({
          code: "SKETCH_SOLVE_FAILED",
          details: {
            sketchSolver: "status-fixture",
            status: "solved",
            reason: "non-finite-residual",
          },
        }),
      );
    } finally {
      custom.dispose();
    }
  });

  it("reports the solver's own first error once, scoped to the sketch node", async () => {
    const result = await evaluator.evaluate(conflictingCircleDocument());
    expect(result.ok).toBe(false);
    const errors = result.diagnostics.filter((item) => item.severity === "error");
    expect(errors).toEqual([
      expect.objectContaining({ code: "SKETCH_OVER_CONSTRAINED", node: "profile" }),
    ]);
  });

  it("rejects unadvertised constraint and entity kinds before solving", async () => {
    const constraintSolver = statusSolver("solved", {
      capabilities: { constraints: ["radius"] },
    });
    const constraintEvaluator = await createEvaluator({
      sketchSolver: constraintSolver,
    });
    try {
      const result = await constraintEvaluator.evaluate(conflictingCircleDocument());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "profile",
          path: "/nodes/profile/constraints/diameter",
          details: {
            sketchSolver: "status-fixture",
            kind: "constraint",
            capability: "diameter",
          },
        }),
      ]);
      expect(constraintSolver.solveCalls()).toBe(0);
    } finally {
      constraintEvaluator.dispose();
    }

    const entitySolver = statusSolver("solved", {
      capabilities: { entities: ["point", "line"] },
    });
    const entityEvaluator = await createEvaluator({ sketchSolver: entitySolver });
    try {
      const result = await entityEvaluator.evaluate(conflictingCircleDocument());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          path: "/nodes/profile/entities/circle",
          details: {
            sketchSolver: "status-fixture",
            kind: "entity",
            capability: "circle",
          },
        }),
      ]);
      expect(entitySolver.solveCalls()).toBe(0);
    } finally {
      entityEvaluator.dispose();
    }
  });

  it("admits an advertised underconstrained custom solve", async () => {
    const custom = await createEvaluator({
      sketchSolver: statusSolver("underconstrained", {
        diagnostics: [],
      }),
    });
    try {
      const result = await custom.evaluate(
        sketchDocument((sketch) => {
          const circle = sketch.circle("circle", {
            center: vec2(mm(0), mm(0)),
            radius: mm(7),
          });
          return sketch.profile(circle.loop());
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) result.value.dispose();
    } finally {
      custom.dispose();
    }
  });
});
