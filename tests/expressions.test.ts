import { describe, expect, it } from "vitest";
import {
  cm,
  deg,
  evaluateExpression,
  expr,
  expressionDependencies,
  gramsPerCubicCentimeter,
  inch,
  kgPerCubicMeter,
  kgPerCubicMillimeter,
  meters,
  mm,
  rad,
  scalar,
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
