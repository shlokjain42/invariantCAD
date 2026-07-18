import { deepFreeze } from "./core/json.js";
import type { ParameterId } from "./core/ids.js";

export type Dimension = "scalar" | "length" | "angle" | "massDensity";

export type ExpressionIR =
  | {
      readonly op: "literal";
      readonly dimension: Dimension;
      readonly value: number;
    }
  | {
      readonly op: "parameter";
      readonly dimension: Dimension;
      readonly id: ParameterId;
    }
  | {
      readonly op: "neg" | "abs" | "sin" | "cos" | "tan";
      readonly dimension: Dimension;
      readonly value: ExpressionIR;
    }
  | {
      readonly op: "add" | "sub" | "mul" | "div";
      readonly dimension: Dimension;
      readonly left: ExpressionIR;
      readonly right: ExpressionIR;
    }
  | {
      readonly op: "min" | "max";
      readonly dimension: Dimension;
      readonly values: readonly ExpressionIR[];
    };

const EXPRESSION_MARKER = Symbol("InvariantCAD.Expression");

export class Expression<D extends Dimension> {
  readonly dimension: D;
  readonly ir: ExpressionIR;
  readonly [EXPRESSION_MARKER] = true;

  constructor(dimension: D, ir: ExpressionIR) {
    if (ir.dimension !== dimension) {
      throw new TypeError(
        `Expression dimension mismatch: expected ${dimension}, received ${ir.dimension}`,
      );
    }
    this.dimension = dimension;
    this.ir = deepFreeze(ir);
    if (new.target === Expression) Object.freeze(this);
  }

  add(other: Expression<D>): Expression<D> {
    return binary("add", this, other, this.dimension);
  }

  sub(other: Expression<D>): Expression<D> {
    return binary("sub", this, other, this.dimension);
  }

  mul(factor: ScalarLike): Expression<D> {
    return binary("mul", this, asScalar(factor), this.dimension);
  }

  div(divisor: ScalarLike): Expression<D> {
    return binary("div", this, asScalar(divisor), this.dimension);
  }

  neg(): Expression<D> {
    return unary("neg", this, this.dimension);
  }

  abs(): Expression<D> {
    return unary("abs", this, this.dimension);
  }
}

export class Parameter<D extends Dimension> extends Expression<D> {
  readonly id: ParameterId;

  constructor(id: ParameterId, dimension: D) {
    super(dimension, { op: "parameter", id, dimension });
    this.id = id;
    Object.freeze(this);
  }
}

export type ScalarExpression = Expression<"scalar">;
export type LengthExpression = Expression<"length">;
export type AngleExpression = Expression<"angle">;
/** Mass per volume in the document base unit kg/mm^3. */
export type MassDensityExpression = Expression<"massDensity">;
export type ScalarLike = ScalarExpression | number;

export type Vec2Expression = readonly [LengthExpression, LengthExpression];
export type Vec3Expression = readonly [
  LengthExpression,
  LengthExpression,
  LengthExpression,
];
export type ScalarVec3Expression = readonly [
  ScalarExpression,
  ScalarExpression,
  ScalarExpression,
];
export type AngleVec3Expression = readonly [
  AngleExpression,
  AngleExpression,
  AngleExpression,
];

function literal<D extends Dimension>(
  dimension: D,
  value: number,
): Expression<D> {
  if (!Number.isFinite(value)) {
    throw new TypeError("Expression literals must be finite numbers");
  }
  return new Expression(dimension, { op: "literal", dimension, value });
}

function binary<D extends Dimension>(
  op: "add" | "sub" | "mul" | "div",
  left: Expression<Dimension>,
  right: Expression<Dimension>,
  dimension: D,
): Expression<D> {
  return new Expression(dimension, {
    op,
    dimension,
    left: left.ir,
    right: right.ir,
  });
}

function unary<D extends Dimension>(
  op: "neg" | "abs" | "sin" | "cos" | "tan",
  value: Expression<Dimension>,
  dimension: D,
): Expression<D> {
  return new Expression(dimension, {
    op,
    dimension,
    value: value.ir,
  });
}

function asScalar(value: ScalarLike): ScalarExpression {
  return typeof value === "number" ? scalar(value) : value;
}

export function scalar(value: number): ScalarExpression {
  return literal("scalar", value);
}

export function mm(value: number): LengthExpression {
  return literal("length", value);
}

export function cm(value: number): LengthExpression {
  return mm(value * 10);
}

export function meters(value: number): LengthExpression {
  return mm(value * 1_000);
}

export function inch(value: number): LengthExpression {
  return mm(value * 25.4);
}

/** Kilograms per cubic millimetre, the document base mass-density unit. */
export function kgPerCubicMillimeter(value: number): MassDensityExpression {
  return literal("massDensity", value);
}

/** Kilograms per cubic metre converted to kg/mm^3. */
export function kgPerCubicMeter(value: number): MassDensityExpression {
  return kgPerCubicMillimeter(value * 1e-9);
}

/** Grams per cubic centimetre converted to kg/mm^3. */
export function gramsPerCubicCentimeter(value: number): MassDensityExpression {
  return kgPerCubicMillimeter(value * 1e-6);
}

export function rad(value: number): AngleExpression {
  return literal("angle", value);
}

export function deg(value: number): AngleExpression {
  return rad((value * Math.PI) / 180);
}

export function vec2(
  x: LengthExpression,
  y: LengthExpression,
): Vec2Expression {
  return deepFreeze([x, y]);
}

export function vec3(
  x: LengthExpression,
  y: LengthExpression,
  z: LengthExpression,
): Vec3Expression {
  return deepFreeze([x, y, z]);
}

export function scalarVec3(
  x: ScalarLike,
  y: ScalarLike,
  z: ScalarLike,
): ScalarVec3Expression {
  return deepFreeze([asScalar(x), asScalar(y), asScalar(z)]);
}

export function angleVec3(
  x: AngleExpression,
  y: AngleExpression,
  z: AngleExpression,
): AngleVec3Expression {
  return deepFreeze([x, y, z]);
}

export function fromExpressionIR<D extends Dimension>(
  ir: ExpressionIR,
  expectedDimension: D,
): Expression<D> {
  return new Expression(expectedDimension, ir);
}

export const expr = {
  add<D extends Dimension>(
    left: Expression<D>,
    right: Expression<D>,
  ): Expression<D> {
    return left.add(right);
  },

  sub<D extends Dimension>(
    left: Expression<D>,
    right: Expression<D>,
  ): Expression<D> {
    return left.sub(right);
  },

  mul<D extends Dimension>(
    value: Expression<D>,
    factor: ScalarLike,
  ): Expression<D> {
    return value.mul(factor);
  },

  div<D extends Dimension>(
    value: Expression<D>,
    divisor: ScalarLike,
  ): Expression<D> {
    return value.div(divisor);
  },

  ratio<D extends Exclude<Dimension, "scalar">>(
    numerator: Expression<D>,
    denominator: Expression<D>,
  ): ScalarExpression {
    return binary("div", numerator, denominator, "scalar");
  },

  neg<D extends Dimension>(value: Expression<D>): Expression<D> {
    return value.neg();
  },

  abs<D extends Dimension>(value: Expression<D>): Expression<D> {
    return value.abs();
  },

  sin(value: AngleExpression): ScalarExpression {
    return unary("sin", value, "scalar");
  },

  cos(value: AngleExpression): ScalarExpression {
    return unary("cos", value, "scalar");
  },

  tan(value: AngleExpression): ScalarExpression {
    return unary("tan", value, "scalar");
  },

  min<D extends Dimension>(...values: readonly Expression<D>[]): Expression<D> {
    if (values.length === 0) throw new TypeError("min() requires a value");
    return new Expression(values[0]!.dimension, {
      op: "min",
      dimension: values[0]!.dimension,
      values: values.map((value) => value.ir),
    });
  },

  max<D extends Dimension>(...values: readonly Expression<D>[]): Expression<D> {
    if (values.length === 0) throw new TypeError("max() requires a value");
    return new Expression(values[0]!.dimension, {
      op: "max",
      dimension: values[0]!.dimension,
      values: values.map((value) => value.ir),
    });
  },
};

export interface ExpressionContext {
  readonly resolveParameter: (
    id: ParameterId,
    expectedDimension: Dimension,
  ) => number;
}

export function evaluateExpression(
  expression: ExpressionIR,
  context: ExpressionContext,
): number {
  let result: number;
  switch (expression.op) {
    case "literal":
      result = expression.value;
      break;
    case "parameter":
      result = context.resolveParameter(expression.id, expression.dimension);
      break;
    case "neg":
      result = -evaluateExpression(expression.value, context);
      break;
    case "abs":
      result = Math.abs(evaluateExpression(expression.value, context));
      break;
    case "sin":
      result = Math.sin(evaluateExpression(expression.value, context));
      break;
    case "cos":
      result = Math.cos(evaluateExpression(expression.value, context));
      break;
    case "tan":
      result = Math.tan(evaluateExpression(expression.value, context));
      break;
    case "add":
      result =
        evaluateExpression(expression.left, context) +
        evaluateExpression(expression.right, context);
      break;
    case "sub":
      result =
        evaluateExpression(expression.left, context) -
        evaluateExpression(expression.right, context);
      break;
    case "mul":
      result =
        evaluateExpression(expression.left, context) *
        evaluateExpression(expression.right, context);
      break;
    case "div": {
      const divisor = evaluateExpression(expression.right, context);
      if (Math.abs(divisor) < Number.EPSILON) {
        throw new RangeError("Division by zero in CAD expression");
      }
      result = evaluateExpression(expression.left, context) / divisor;
      break;
    }
    case "min":
      result = Math.min(
        ...expression.values.map((value) => evaluateExpression(value, context)),
      );
      break;
    case "max":
      result = Math.max(
        ...expression.values.map((value) => evaluateExpression(value, context)),
      );
      break;
  }
  if (!Number.isFinite(result)) {
    throw new RangeError("CAD expression evaluated to a non-finite number");
  }
  return Object.is(result, -0) ? 0 : result;
}

export function expressionDependencies(
  expression: ExpressionIR,
  output = new Set<ParameterId>(),
): ReadonlySet<ParameterId> {
  switch (expression.op) {
    case "parameter":
      output.add(expression.id);
      break;
    case "neg":
    case "abs":
    case "sin":
    case "cos":
    case "tan":
      expressionDependencies(expression.value, output);
      break;
    case "add":
    case "sub":
    case "mul":
    case "div":
      expressionDependencies(expression.left, output);
      expressionDependencies(expression.right, output);
      break;
    case "min":
    case "max":
      for (const value of expression.values) expressionDependencies(value, output);
      break;
    case "literal":
      break;
  }
  return output;
}
