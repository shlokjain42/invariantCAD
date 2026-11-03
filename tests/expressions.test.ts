import { describe, expect, it } from "vitest";
import {
  Expression,
  angleVec3,
  cm,
  deg,
  evaluateExpression,
  expr,
  expressionDependencies,
  fromExpressionIR,
  gramsPerCubicCentimeter,
  inch,
  kgPerCubicMeter,
  kgPerCubicMillimeter,
  meters,
  mm,
  rad,
  scalar,
  scalarVec3,
  vec2,
  vec3,
  type ExpressionContext,
  type ExpressionIR,
} from "../src/index.js";

const noParameters: ExpressionContext = {
  resolveParameter(id) {
    throw new Error(`Unexpected parameter '${id}'`);
  },
};

function evaluate(
  value: { readonly ir: ExpressionIR },
  parameters: Readonly<Record<string, number>> = {},
): number {
  return evaluateExpression(value.ir, {
    resolveParameter(id) {
      const resolved = parameters[id];
      if (resolved === undefined) throw new Error(`Missing parameter '${id}'`);
      return resolved;
    },
  });
}

function literalValue(value: { readonly ir: ExpressionIR }): number {
  if (value.ir.op !== "literal") throw new Error("Expected a literal");
  return value.ir.value;
}

const parameterIR = (
  id: string,
  dimension: ExpressionIR["dimension"],
): ExpressionIR => ({ op: "parameter", id: id as never, dimension });

describe("unit helpers", () => {
  it("converts lengths, angles, and densities to document base units", () => {
    expect(literalValue(mm(12.5))).toBe(12.5);
    expect(literalValue(cm(2.54))).toBeCloseTo(25.4, 12);
    expect(literalValue(meters(0.1))).toBeCloseTo(100, 12);
    expect(literalValue(inch(1))).toBeCloseTo(25.4, 12);
    expect(literalValue(cm(2.54))).toBeCloseTo(literalValue(inch(1)), 12);
    expect(literalValue(rad(1.25))).toBe(1.25);
    expect(literalValue(deg(180))).toBeCloseTo(Math.PI, 15);
    expect(literalValue(scalar(3))).toBe(3);
    expect(literalValue(kgPerCubicMillimeter(2.7e-6))).toBe(2.7e-6);
    expect(literalValue(kgPerCubicMeter(2700))).toBeCloseTo(2.7e-6, 18);
    expect(literalValue(gramsPerCubicCentimeter(2.7))).toBeCloseTo(2.7e-6, 18);
    for (const value of [
      cm(1),
      meters(1),
      inch(1),
    ]) {
      expect(value.dimension).toBe("length");
    }
    expect(deg(1).dimension).toBe("angle");
    expect(gramsPerCubicCentimeter(1).dimension).toBe("massDensity");
    expect(kgPerCubicMeter(1).dimension).toBe("massDensity");
  });

  it("rejects non-finite literals", () => {
    expect(() => mm(Number.NaN)).toThrow(TypeError);
    expect(() => cm(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => deg(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
    expect(() => scalar(Number.NaN)).toThrow(TypeError);
  });
});

describe("expression operations", () => {
  it("evaluates arithmetic, min, max, trigonometry, and ratios", () => {
    const width = mm(30);
    expect(evaluate(width.add(mm(5)))).toBe(35);
    expect(evaluate(width.sub(mm(5)))).toBe(25);
    expect(evaluate(width.mul(2))).toBe(60);
    expect(evaluate(width.mul(scalar(0.5)))).toBe(15);
    expect(evaluate(width.div(4))).toBe(7.5);
    expect(evaluate(width.neg())).toBe(-30);
    expect(evaluate(mm(-3).abs())).toBe(3);
    expect(evaluate(expr.add(mm(1), mm(2)))).toBe(3);
    expect(evaluate(expr.sub(mm(1), mm(2)))).toBe(-1);
    expect(evaluate(expr.mul(mm(2), 3))).toBe(6);
    expect(evaluate(expr.div(mm(9), 3))).toBe(3);
    expect(evaluate(expr.neg(mm(2)))).toBe(-2);
    expect(evaluate(expr.abs(mm(-2)))).toBe(2);
    expect(evaluate(expr.min(mm(4), mm(-2), mm(7)))).toBe(-2);
    expect(evaluate(expr.max(mm(4), mm(-2), mm(7)))).toBe(7);
    expect(evaluate(expr.min(mm(4)))).toBe(4);
    expect(evaluate(expr.sin(deg(30)))).toBeCloseTo(0.5, 15);
    expect(evaluate(expr.cos(deg(60)))).toBeCloseTo(0.5, 15);
    expect(evaluate(expr.tan(deg(45)))).toBeCloseTo(1, 15);
    expect(evaluate(expr.ratio(mm(30), mm(12)))).toBe(2.5);
    expect(evaluate(expr.ratio(deg(90), deg(45)))).toBeCloseTo(2, 15);

    expect(expr.sin(deg(30)).dimension).toBe("scalar");
    expect(expr.ratio(mm(1), mm(2)).dimension).toBe("scalar");
    expect(expr.min(deg(1), deg(2)).dimension).toBe("angle");
    expect(expr.max(scalar(1), scalar(2)).ir).toEqual({
      op: "max",
      dimension: "scalar",
      values: [scalar(1).ir, scalar(2).ir],
    });
    expect(() => expr.min()).toThrow(TypeError);
    expect(() => expr.max()).toThrow(TypeError);
  });

  it("resolves parameters with their expected dimension", () => {
    const seen: string[] = [];
    const result = evaluateExpression(
      {
        op: "add",
        dimension: "length",
        left: parameterIR("width", "length"),
        right: {
          op: "mul",
          dimension: "length",
          left: parameterIR("wall", "length"),
          right: parameterIR("count", "scalar"),
        },
      },
      {
        resolveParameter(id, dimension) {
          seen.push(`${id}:${dimension}`);
          return id === "width" ? 10 : id === "wall" ? 2 : 3;
        },
      },
    );
    expect(result).toBe(16);
    expect(seen).toEqual(["width:length", "wall:length", "count:scalar"]);
  });

  it("reports division by zero and non-finite results", () => {
    expect(() => evaluate(mm(1).div(0))).toThrow(/Division by zero/);
    expect(() => evaluate(expr.ratio(mm(1), mm(0)))).toThrow(/Division by zero/);
    expect(() =>
      evaluate(mm(Number.MAX_VALUE).add(mm(Number.MAX_VALUE))),
    ).toThrow(/non-finite/);
    expect(Object.is(evaluate(mm(0).neg()), 0)).toBe(true);
  });

  it("folds min and max over very many operands without argument spread", () => {
    const count = 200_000;
    const values = Array.from({ length: count }, (_, index) => ({
      op: "literal" as const,
      dimension: "length" as const,
      value: index % 2 === 0 ? index : -index,
    }));
    expect(
      evaluateExpression({ op: "max", dimension: "length", values }, noParameters),
    ).toBe(count - 2);
    expect(
      evaluateExpression({ op: "min", dimension: "length", values }, noParameters),
    ).toBe(-(count - 1));
  });

  it("lists every referenced parameter for every operation", () => {
    const dependencies = (ir: ExpressionIR): string[] =>
      [...expressionDependencies(ir)].sort();
    expect(dependencies(mm(1).ir)).toEqual([]);
    expect(dependencies(parameterIR("a", "length"))).toEqual(["a"]);
    for (const op of ["neg", "abs"] as const) {
      expect(
        dependencies({ op, dimension: "length", value: parameterIR("a", "length") }),
      ).toEqual(["a"]);
    }
    for (const op of ["sin", "cos", "tan"] as const) {
      expect(
        dependencies({ op, dimension: "scalar", value: parameterIR("t", "angle") }),
      ).toEqual(["t"]);
    }
    for (const op of ["add", "sub"] as const) {
      expect(
        dependencies({
          op,
          dimension: "length",
          left: parameterIR("a", "length"),
          right: parameterIR("b", "length"),
        }),
      ).toEqual(["a", "b"]);
    }
    for (const op of ["mul", "div"] as const) {
      expect(
        dependencies({
          op,
          dimension: "length",
          left: parameterIR("a", "length"),
          right: parameterIR("k", "scalar"),
        }),
      ).toEqual(["a", "k"]);
    }
    for (const op of ["min", "max"] as const) {
      expect(
        dependencies({
          op,
          dimension: "length",
          values: [
            parameterIR("c", "length"),
            mm(1).ir,
            parameterIR("a", "length"),
            parameterIR("c", "length"),
          ],
        }),
      ).toEqual(["a", "c"]);
    }
    const accumulated = new Set<never>();
    expressionDependencies(parameterIR("x", "scalar"), accumulated);
    expressionDependencies(parameterIR("y", "scalar"), accumulated);
    expect([...accumulated].sort()).toEqual(["x", "y"]);
  });
});

describe("runtime expression dimensions", () => {
  const untyped = (value: unknown): never => value as never;

  it("rejects wrong-dimensional arithmetic from untyped callers", () => {
    expect(() => mm(1).add(untyped(deg(1)))).toThrow(TypeError);
    expect(() => mm(1).sub(untyped(scalar(1)))).toThrow(TypeError);
    expect(() => mm(1).mul(untyped(mm(2)))).toThrow(TypeError);
    expect(() => mm(1).div(untyped(deg(2)))).toThrow(TypeError);
    expect(() => mm(1).add(untyped(1))).toThrow(TypeError);
    expect(() => mm(1).mul(untyped("2"))).toThrow(TypeError);
    expect(() => expr.min(mm(1), untyped(deg(1)))).toThrow(TypeError);
    expect(() => expr.max(deg(1), untyped(mm(1)))).toThrow(TypeError);
    expect(() => expr.sin(untyped(mm(1)))).toThrow(TypeError);
    expect(() => expr.cos(untyped(scalar(1)))).toThrow(TypeError);
    expect(() => expr.tan(untyped(mm(1)))).toThrow(TypeError);
    expect(() => expr.ratio(mm(1), untyped(deg(1)))).toThrow(TypeError);
    expect(() => vec2(mm(1), untyped(deg(1)))).toThrow(TypeError);
    expect(() => vec3(mm(1), mm(1), untyped(scalar(1)))).toThrow(TypeError);
    expect(() => angleVec3(deg(1), untyped(mm(1)), deg(1))).toThrow(TypeError);
    expect(() => scalarVec3(1, untyped(mm(1)), 1)).toThrow(TypeError);
  });

  it("rejects malformed or inconsistent raw expression IR", () => {
    const invalid: unknown[] = [
      { op: "pow", dimension: "length", value: mm(1).ir },
      { op: "literal", dimension: "length", value: Number.NaN },
      { op: "literal", dimension: "length", value: "1" },
      { op: "literal", dimension: "length", value: 1, extra: true },
      { op: "parameter", dimension: "length", id: "not valid" },
      { op: "add", dimension: "length", left: mm(1).ir, right: deg(1).ir },
      { op: "mul", dimension: "length", left: mm(1).ir, right: mm(1).ir },
      { op: "div", dimension: "length", left: mm(1).ir, right: mm(1).ir },
      { op: "neg", dimension: "length", value: deg(1).ir },
      { op: "sin", dimension: "length", value: deg(1).ir },
      { op: "sin", dimension: "scalar", value: mm(1).ir },
      { op: "min", dimension: "length", values: [] },
      { op: "max", dimension: "length", values: [mm(1).ir, deg(1).ir] },
      { op: "max", dimension: "length", values: mm(1).ir },
      { op: "add", dimension: "length", left: mm(1).ir },
    ];
    for (const ir of invalid) {
      expect(() => fromExpressionIR(ir as ExpressionIR, "length"), JSON.stringify(ir))
        .toThrow(TypeError);
    }

    const cyclic: Record<string, unknown> = { op: "neg", dimension: "length" };
    cyclic.value = cyclic;
    expect(() => fromExpressionIR(cyclic as never, "length")).toThrow(/cycle/i);
    expect(() => fromExpressionIR(mm(1).ir, "angle")).toThrow(TypeError);
  });

  it("accepts well-formed raw IR, including shared subtrees", () => {
    const shared = parameterIR("a", "length");
    const ir: ExpressionIR = {
      op: "div",
      dimension: "scalar",
      left: { op: "max", dimension: "length", values: [shared, shared] },
      right: shared,
    };
    const value = fromExpressionIR(ir, "scalar");
    expect(value.ir).toBe(ir);
    expect(evaluate(value, { a: 4 })).toBe(1);
  });
});

describe("expression immutability", () => {
  it("deeply freezes raw IR even when the caller froze only its root", () => {
    const left = { op: "literal", dimension: "length", value: 1 };
    const ir = Object.freeze({
      op: "add",
      dimension: "length",
      left,
      right: { op: "literal", dimension: "length", value: 2 },
    }) as unknown as ExpressionIR;
    const value = fromExpressionIR(ir, "length");
    expect(Object.isFrozen(left)).toBe(true);
    expect(() => {
      (left as { value: number }).value = 99;
    }).toThrow(TypeError);
    expect(evaluate(value)).toBe(3);

    const values = [mm(1).ir, mm(2).ir];
    const constructed = new Expression("length", {
      op: "max",
      dimension: "length",
      values,
    });
    expect(Object.isFrozen(values)).toBe(true);
    expect(Object.isFrozen(constructed)).toBe(true);
    expect(evaluate(constructed)).toBe(2);
  });

  it("constructs long derived chains without re-inspecting earlier nodes", () => {
    let total = mm(0);
    for (let index = 0; index < 20_000; index += 1) {
      total = total.add(mm(1));
    }
    expect(total.ir.op).toBe("add");
    expect(Object.isFrozen(total.ir)).toBe(true);
  });
});
