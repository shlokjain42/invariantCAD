import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEvaluator,
  createReferenceSketchSolver,
  deg,
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

function rectangleLines(sketch: SketchBuilder) {
  const p0 = sketch.point("p0", vec2(mm(0), mm(0)));
  const p1 = sketch.point("p1", vec2(mm(40), mm(0)));
  const p2 = sketch.point("p2", vec2(mm(40), mm(20)));
  const p3 = sketch.point("p3", vec2(mm(0), mm(20)));
  return {
    p0,
    p1,
    p2,
    p3,
    bottom: sketch.line("bottom", p0, p1),
    right: sketch.line("right", p1, p2),
    top: sketch.line("top", p2, p3),
    left: sketch.line("left", p3, p0),
  };
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
    if (result.ok) result.value.dispose();
    expect(result.diagnostics.some((item) => item.code === "EVALUATION_ABORTED")).toBe(
      false,
    );
  });
});

describe("reference solver degrees of freedom and status", () => {
  it("reports every free coordinate of an unconstrained rectangle", () => {
    const solved = solveReference(
      sketchDocument((sketch) => {
        const lines = rectangleLines(sketch);
        return sketch.profile(
          sketch.loop([lines.bottom, lines.right, lines.top, lines.left]),
        );
      }),
    );
    expect(solved.status).toBe("underconstrained");
    expect(solved.degreesOfFreedom).toBe(8);
    expect(solved.residual).toBe(0);
    expect(solved.diagnostics).toEqual([
      expect.objectContaining({
        code: "SKETCH_UNDER_CONSTRAINED",
        severity: "info",
        details: { degreesOfFreedom: 8 },
      }),
    ]);
  });

  it("solves the documented fully constrained rectangle with zero freedom", async () => {
    const document = sketchDocument((sketch) => {
      const lines = rectangleLines(sketch);
      sketch
        .fixed("anchor", lines.p0)
        .horizontal("bottom-horizontal", lines.bottom)
        .horizontal("top-horizontal", lines.top)
        .vertical("right-vertical", lines.right)
        .vertical("left-vertical", lines.left)
        .length("width", lines.bottom, mm(40))
        .length("height", lines.left, mm(20));
      return sketch.profile(
        sketch.loop([lines.bottom, lines.right, lines.top, lines.left]),
      );
    });
    const solved = solveReference(document);
    expect(solved.status).toBe("solved");
    expect(solved.degreesOfFreedom).toBe(0);
    expect(solved.diagnostics).toEqual([]);
    expect(solved.residual).toBeLessThanOrEqual(sketchNode(document).tolerance);

    const result = await evaluator.evaluate(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.diagnostics).toEqual([]);
      expect(result.value.output("solid").measure().volume).toBeCloseTo(1600, 6);
    } finally {
      result.value.dispose();
    }
  });

  it("leaves only the radius free on a circle whose centre is fixed", () => {
    const solved = solveReference(
      sketchDocument((sketch) => {
        const circle = sketch.circle("circle", {
          center: vec2(mm(3), mm(4)),
          radius: mm(5),
        });
        sketch.fixed("centre", circle.center);
        return sketch.profile(circle.loop());
      }),
    );
    expect(solved.status).toBe("underconstrained");
    expect(solved.degreesOfFreedom).toBe(1);
    expect(solved.diagnostics).toEqual([
      expect.objectContaining({
        code: "SKETCH_UNDER_CONSTRAINED",
        severity: "info",
        details: { degreesOfFreedom: 1 },
      }),
    ]);
  });

  it("reports a conflicting constraint set as overconstrained", () => {
    const solved = solveReference(
      sketchDocument((sketch) => {
        const circle = sketch.circle("circle", {
          center: vec2(mm(0), mm(0)),
          radius: mm(7),
        });
        sketch.radius("radius", circle, mm(7)).diameter("diameter", circle, mm(20));
        return sketch.profile(circle.loop());
      }),
    );
    expect(solved.status).toBe("overconstrained");
    expect(solved.residual).toBeGreaterThan(1);
    expect(solved.diagnostics).toEqual([
      expect.objectContaining({
        code: "SKETCH_OVER_CONSTRAINED",
        severity: "error",
      }),
    ]);
  });
});

function slotDocument(
  constrain: (
    sketch: SketchBuilder,
    refs: {
      readonly a: ReturnType<SketchBuilder["point"]>;
      readonly b: ReturnType<SketchBuilder["point"]>;
      readonly c: ReturnType<SketchBuilder["point"]>;
      readonly d: ReturnType<SketchBuilder["point"]>;
      readonly right: ReturnType<SketchBuilder["arc"]>;
      readonly left: ReturnType<SketchBuilder["arc"]>;
    },
  ) => void,
  halfWidth = 5,
): DesignDocument {
  return sketchDocument((sketch) => {
    const a = sketch.point("a", vec2(mm(0), mm(-halfWidth)));
    const b = sketch.point("b", vec2(mm(20), mm(-halfWidth)));
    const c = sketch.point("c", vec2(mm(20), mm(halfWidth)));
    const d = sketch.point("d", vec2(mm(0), mm(halfWidth)));
    const right = sketch.arc("right", {
      center: vec2(mm(20), mm(0)),
      radius: mm(halfWidth),
      startAngle: deg(-90),
      endAngle: deg(90),
    });
    const left = sketch.arc("left", {
      center: vec2(mm(0), mm(0)),
      radius: mm(halfWidth),
      startAngle: deg(90),
      endAngle: deg(270),
    });
    constrain(sketch, { a, b, c, d, right, left });
    return sketch.profile(
      sketch.loop([
        sketch.line("bottom", a, b),
        right,
        sketch.line("top", c, d),
        left,
      ]),
    );
  });
}

describe("reference solver arc constraints inside closed loops", () => {
  const slotVolume = (radius: number) => (20 * 2 * radius + Math.PI * radius ** 2) * 2;

  it("keeps a loop closed when an arc constraint restates the authored radius", async () => {
    const result = await evaluator.evaluate(
      slotDocument((sketch, refs) => {
        sketch.radius("radius", refs.right, mm(5));
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(
        Math.abs(result.value.output("solid").measure().volume - slotVolume(5)),
      ).toBeLessThan(1);
    } finally {
      result.value.dispose();
    }
  });

  it("names the first gap when a radius constraint detaches an arc from its lines", async () => {
    const result = await evaluator.evaluate(
      slotDocument((sketch, refs) => {
        sketch.radius("radius", refs.right, mm(6));
      }),
    );
    if (result.ok) result.value.dispose();
    expect(result.ok).toBe(false);
    const errors = result.diagnostics.filter((item) => item.severity === "error");
    expect(errors).toEqual([
      {
        code: "SKETCH_NO_CLOSED_REGION",
        message: "Sketch did not produce a closed region",
        severity: "error",
        node: "profile",
        path: "/nodes/profile/profile",
        related: [
          {
            node: "profile",
            path: "/nodes/profile/entities/bottom",
            message: "Profile boundary entity before the gap",
          },
          {
            node: "profile",
            path: "/nodes/profile/entities/right",
            message: "Profile boundary entity after the gap",
          },
        ],
        hints: [expect.stringContaining("arc endpoints follow the arc center")],
        details: {
          phase: "sketch-profile-validation",
          reason: "invalid-loop",
          loopIssueReason: "open-loop",
          tolerance: 1e-7,
          indexSpace: "resolved-profile",
          loop: "outer",
          curveIndex: 0,
          otherCurveIndex: 1,
          gap: expect.closeTo(1, 9),
          curveSource: { kind: "sketch-entity", sketch: "profile", entity: "bottom" },
          otherCurveSource: { kind: "sketch-entity", sketch: "profile", entity: "right" },
        },
      },
    ]);
  });

  it("omits entity names and the arc hint when solver provenance is missing", async () => {
    const delegate = createReferenceSketchSolver();
    const stripSources = (
      loop: SolvedSketch["profile"]["outer"],
    ): SolvedSketch["profile"]["outer"] => ({
      ...loop,
      curves: loop.curves.map((curve) => {
        const { source: _source, ...unsourced } = curve;
        return unsourced;
      }),
    });
    const unsourced: SketchSolverBackend = {
      id: "unsourced-fixture",
      capabilities: delegate.capabilities,
      solve(sketch, context) {
        const solved = delegate.solve(sketch, context);
        return {
          ...solved,
          profile: {
            ...solved.profile,
            outer: stripSources(solved.profile.outer),
            holes: solved.profile.holes.map(stripSources),
          },
        };
      },
      dispose() {
        delegate.dispose();
      },
    };
    const custom = await createEvaluator({ sketchSolver: unsourced });
    try {
      const result = await custom.evaluate(
        slotDocument((sketch, refs) => {
          sketch.radius("radius", refs.right, mm(6));
        }),
      );
      if (result.ok) result.value.dispose();
      expect(result.ok).toBe(false);
      const error = result.diagnostics.find((item) => item.severity === "error");
      expect(error).toEqual(
        expect.objectContaining({
          code: "SKETCH_NO_CLOSED_REGION",
          path: "/nodes/profile/profile",
          details: expect.objectContaining({
            curveIndex: 0,
            otherCurveIndex: 1,
            gap: expect.closeTo(1, 9),
          }),
        }),
      );
      // Without matching provenance the resolved indices cannot be tied to
      // authored entities, so neither the entities nor the arc hint are named.
      expect(error).not.toHaveProperty("related");
      expect(error).not.toHaveProperty("hints");
      expect(error?.details).not.toHaveProperty("curveSource");
      expect(error?.details).not.toHaveProperty("otherCurveSource");
    } finally {
      custom.dispose();
    }
  });

  it("opens the loop the same way for diameter, equal-radius, and centre moves", async () => {
    for (const [name, constrain] of [
      [
        "diameter",
        (sketch: SketchBuilder, refs: Parameters<Parameters<typeof slotDocument>[0]>[1]) => {
          sketch.diameter("diameter", refs.right, mm(12));
        },
      ],
      [
        "equalRadius",
        (sketch: SketchBuilder, refs: Parameters<Parameters<typeof slotDocument>[0]>[1]) => {
          sketch.radius("radius", refs.left, mm(6)).equalRadius("equal", refs.left, refs.right);
        },
      ],
      [
        "centre move",
        (sketch: SketchBuilder, refs: Parameters<Parameters<typeof slotDocument>[0]>[1]) => {
          sketch
            .fixed("anchor", refs.left.center)
            .distanceX("offset", refs.left.center, refs.right.center, mm(25));
        },
      ],
    ] as const) {
      const result = await evaluator.evaluate(slotDocument(constrain));
      if (result.ok) result.value.dispose();
      expect(result.ok, name).toBe(false);
      expect(
        result.diagnostics.find((item) => item.severity === "error"),
        name,
      ).toEqual(
        expect.objectContaining({
          code: "SKETCH_NO_CLOSED_REGION",
          details: expect.objectContaining({ loopIssueReason: "open-loop" }),
        }),
      );
    }
  });

  it("closes the loop when line endpoints are constrained to follow the arcs", async () => {
    for (const document of [
      slotDocument((sketch, refs) => {
        sketch
          .fixed("left-centre", refs.left.center)
          .fixed("right-centre", refs.right.center)
          .radius("radius", refs.right, mm(6))
          .equalRadius("equal", refs.left, refs.right)
          .distanceX("ax", refs.left.center, refs.a, mm(0))
          .distanceY("ay", refs.left.center, refs.a, mm(-6))
          .distanceX("bx", refs.right.center, refs.b, mm(0))
          .distanceY("by", refs.right.center, refs.b, mm(-6))
          .distanceX("cx", refs.right.center, refs.c, mm(0))
          .distanceY("cy", refs.right.center, refs.c, mm(6))
          .distanceX("dx", refs.left.center, refs.d, mm(0))
          .distanceY("dy", refs.left.center, refs.d, mm(6));
      }),
      slotDocument(() => {}, 6),
    ]) {
      const result = await evaluator.evaluate(document);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      try {
        expect(
          Math.abs(result.value.output("solid").measure().volume - slotVolume(6)),
        ).toBeLessThan(1);
      } finally {
        result.value.dispose();
      }
    }
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
        if (result.ok) result.value.dispose();
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
      if (result.ok) result.value.dispose();
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
      if (result.ok) result.value.dispose();
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
    if (result.ok) result.value.dispose();
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
      if (result.ok) result.value.dispose();
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
      if (result.ok) result.value.dispose();
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
