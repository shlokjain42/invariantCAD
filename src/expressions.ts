import { deepFreeze } from "./core/json.js";
import { assertValidId, type ParameterId } from "./core/ids.js";

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

// Captured at load so expression validation keeps its guarantees even if a
// caller later replaces these globals or their prototype methods.
const reflectApply = Reflect.apply;
const objectFreeze = Object.freeze;
const objectHasOwn = Object.hasOwn;
const objectKeys = Object.keys;
const arrayIsArray = Array.isArray;
const objectDefineProperty = Object.defineProperty;
const IntrinsicWeakSet = WeakSet;
const intrinsicWeakSetAdd = WeakSet.prototype.add;
const intrinsicWeakSetHas = WeakSet.prototype.has;
const IntrinsicWeakMap = WeakMap;
const intrinsicWeakMapGet = WeakMap.prototype.get;
const intrinsicWeakMapSet = WeakMap.prototype.set;

function weakSetAdd(set: WeakSet<object>, value: object): void {
  reflectApply(intrinsicWeakSetAdd, set, [value]);
}

function weakSetHas(set: WeakSet<object>, value: object): boolean {
  return reflectApply(intrinsicWeakSetHas, set, [value]) as boolean;
}

function weakMapGet<V>(map: WeakMap<object, V>, key: object): V | undefined {
  return reflectApply(intrinsicWeakMapGet, map, [key]) as V | undefined;
}

function weakMapSet<V>(map: WeakMap<object, V>, key: object, value: V): void {
  reflectApply(intrinsicWeakMapSet, map, [key, value]);
}

/** Appends without consulting Array.prototype index accessors. */
function arrayAppend<T>(array: T[], value: T): void {
  objectDefineProperty(array, array.length, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function isDimension(value: unknown): value is Dimension {
  return (
    value === "scalar" ||
    value === "length" ||
    value === "angle" ||
    value === "massDensity"
  );
}

function describeDimension(value: unknown): string {
  return isDimension(value) ? value : "a non-expression value";
}

function expressionKind(dimension: Dimension): string {
  return `${dimension === "angle" ? "an" : "a"} ${dimension} expression`;
}

const EXPRESSION_IR_FIELDS: Readonly<Record<ExpressionIR["op"], readonly string[]>> =
  objectFreeze({
    literal: objectFreeze(["op", "dimension", "value"]),
    parameter: objectFreeze(["op", "dimension", "id"]),
    neg: objectFreeze(["op", "dimension", "value"]),
    abs: objectFreeze(["op", "dimension", "value"]),
    sin: objectFreeze(["op", "dimension", "value"]),
    cos: objectFreeze(["op", "dimension", "value"]),
    tan: objectFreeze(["op", "dimension", "value"]),
    add: objectFreeze(["op", "dimension", "left", "right"]),
    sub: objectFreeze(["op", "dimension", "left", "right"]),
    mul: objectFreeze(["op", "dimension", "left", "right"]),
    div: objectFreeze(["op", "dimension", "left", "right"]),
    min: objectFreeze(["op", "dimension", "values"]),
    max: objectFreeze(["op", "dimension", "values"]),
  });

/**
 * IR nodes already proven well-formed and deeply frozen. Derived expressions
 * reuse their operands' nodes, so only each new root needs inspection.
 */
const wellFormedExpressionNodes = new IntrinsicWeakSet<object>();

function malformedExpression(label: string, problem: string): TypeError {
  return new TypeError(`${label} is malformed: ${problem}`);
}

function expressionChild(
  container: object,
  key: string | number,
  op: string,
  label: string,
): Readonly<Record<string, unknown>> {
  const child = (container as Readonly<Record<string, unknown>>)[key];
  if (typeof child !== "object" || child === null || arrayIsArray(child)) {
    throw malformedExpression(label, `'${op}' requires an expression operand '${key}'`);
  }
  const record = child as Readonly<Record<string, unknown>>;
  if (!isDimension(record.dimension)) {
    throw malformedExpression(label, `'${op}' has an operand without a valid dimension`);
  }
  return record;
}

/** Checks one frozen node's own fields and returns its expression operands. */
function expressionNodeOperands(
  node: Readonly<Record<string, unknown>>,
  label: string,
): readonly object[] {
  const op = node.op;
  if (typeof op !== "string" || !objectHasOwn(EXPRESSION_IR_FIELDS, op)) {
    throw malformedExpression(label, `unsupported operation '${String(op)}'`);
  }
  const dimension = node.dimension;
  if (!isDimension(dimension)) {
    throw malformedExpression(label, `'${op}' has an invalid dimension`);
  }
  const allowed = EXPRESSION_IR_FIELDS[op as ExpressionIR["op"]];
  const keys = objectKeys(node);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex]!;
    let supported = false;
    for (let index = 0; index < allowed.length; index += 1) {
      if (allowed[index] === key) {
        supported = true;
        break;
      }
    }
    if (!supported) {
      throw malformedExpression(label, `'${op}' contains unsupported field '${key}'`);
    }
  }
  const mismatch = (problem: string): TypeError =>
    new TypeError(`${label} has mismatched dimensions: ${problem}`);
  switch (op as ExpressionIR["op"]) {
    case "literal": {
      const value = node.value;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw malformedExpression(label, "literals must be finite numbers");
      }
      return [];
    }
    case "parameter": {
      const id = node.id;
      if (typeof id !== "string") {
        throw malformedExpression(label, "parameter IDs must be strings");
      }
      assertValidId(id, "Parameter ID");
      return [];
    }
    case "neg":
    case "abs": {
      const value = expressionChild(node, "value", op, label);
      if (value.dimension !== dimension) {
        throw mismatch(`'${op}' of ${String(value.dimension)} cannot produce ${dimension}`);
      }
      return [value];
    }
    case "sin":
    case "cos":
    case "tan": {
      const value = expressionChild(node, "value", op, label);
      if (dimension !== "scalar" || value.dimension !== "angle") {
        throw mismatch(`'${op}' requires an angle and produces a scalar`);
      }
      return [value];
    }
    case "add":
    case "sub": {
      const left = expressionChild(node, "left", op, label);
      const right = expressionChild(node, "right", op, label);
      if (left.dimension !== dimension || right.dimension !== dimension) {
        throw mismatch(
          `'${op}' requires two ${dimension} operands, received ${String(left.dimension)} and ${String(right.dimension)}`,
        );
      }
      return [left, right];
    }
    case "mul": {
      const left = expressionChild(node, "left", op, label);
      const right = expressionChild(node, "right", op, label);
      const inferred =
        left.dimension === "scalar"
          ? right.dimension
          : right.dimension === "scalar"
            ? left.dimension
            : undefined;
      if (inferred !== dimension) {
        throw mismatch(
          "multiplication requires at least one scalar operand and preserves the other dimension",
        );
      }
      return [left, right];
    }
    case "div": {
      const left = expressionChild(node, "left", op, label);
      const right = expressionChild(node, "right", op, label);
      const valid =
        right.dimension === "scalar"
          ? left.dimension === dimension
          : left.dimension === right.dimension && dimension === "scalar";
      if (!valid) {
        throw mismatch(
          "division by a scalar preserves the numerator dimension; other divisions require equal dimensions and produce a scalar",
        );
      }
      return [left, right];
    }
    case "min":
    case "max": {
      const values = node.values;
      if (!arrayIsArray(values) || values.length === 0) {
        throw malformedExpression(label, `'${op}' requires a non-empty value array`);
      }
      objectFreeze(values);
      const operands: object[] = [];
      for (let index = 0; index < values.length; index += 1) {
        if (!objectHasOwn(values, index)) {
          throw malformedExpression(label, `'${op}' values cannot be sparse`);
        }
        const value = expressionChild(values, index, op, label);
        if (value.dimension !== dimension) {
          throw mismatch(`'${op}' requires ${dimension} values, received ${String(value.dimension)}`);
        }
        arrayAppend(operands, value);
      }
      return operands;
    }
  }
}

const EXPRESSION_ACTIVE = 1;
const EXPRESSION_COMPLETE = 2;

/**
 * Validates expression IR against the document expression grammar and its
 * dimension rules, freezing every node it inspects. The walk is iterative and
 * shares work across DAG-shaped trees, so deep or wide IR cannot overflow the
 * stack, and nodes already proven well-formed are skipped.
 *
 * @internal Not re-exported from the package root.
 */
export function assertExpressionIR(
  ir: unknown,
  label = "Expression IR",
): ExpressionIR {
  if (typeof ir !== "object" || ir === null || arrayIsArray(ir)) {
    throw malformedExpression(label, "expected an expression object");
  }
  if (weakSetHas(wellFormedExpressionNodes, ir)) return ir as ExpressionIR;
  const states = new IntrinsicWeakMap<object, number>();
  const visited: object[] = [];
  const nodes: object[] = [ir];
  const exits: boolean[] = [false];
  while (nodes.length > 0) {
    const top = nodes.length - 1;
    const node = nodes[top]!;
    const exit = exits[top]!;
    nodes.length = top;
    exits.length = top;
    if (exit) {
      weakMapSet(states, node, EXPRESSION_COMPLETE);
      continue;
    }
    if (weakSetHas(wellFormedExpressionNodes, node)) continue;
    const state = weakMapGet(states, node);
    if (state === EXPRESSION_COMPLETE) continue;
    if (state === EXPRESSION_ACTIVE) {
      throw malformedExpression(label, "expression IR cannot contain cycles");
    }
    weakMapSet(states, node, EXPRESSION_ACTIVE);
    arrayAppend(visited, node);
    objectFreeze(node);
    const operands = expressionNodeOperands(
      node as Readonly<Record<string, unknown>>,
      label,
    );
    arrayAppend(nodes, node);
    arrayAppend(exits, true);
    for (let index = operands.length - 1; index >= 0; index -= 1) {
      arrayAppend(nodes, operands[index]!);
      arrayAppend(exits, false);
    }
  }
  for (let index = 0; index < visited.length; index += 1) {
    weakSetAdd(wellFormedExpressionNodes, visited[index]!);
  }
  return ir as ExpressionIR;
}

/**
 * Visits each distinct parameter node in already validated expression IR.
 *
 * @internal Not re-exported from the package root.
 */
export function forEachExpressionParameter(
  ir: ExpressionIR,
  visit: (node: Extract<ExpressionIR, { readonly op: "parameter" }>) => void,
): void {
  const seen = new IntrinsicWeakSet<object>();
  const stack: ExpressionIR[] = [ir];
  while (stack.length > 0) {
    const node = stack[stack.length - 1]!;
    stack.length -= 1;
    if (weakSetHas(seen, node)) continue;
    weakSetAdd(seen, node);
    switch (node.op) {
      case "parameter":
        visit(node);
        break;
      case "literal":
        break;
      case "neg":
      case "abs":
      case "sin":
      case "cos":
      case "tan":
        arrayAppend(stack, node.value);
        break;
      case "add":
      case "sub":
      case "mul":
      case "div":
        arrayAppend(stack, node.right);
        arrayAppend(stack, node.left);
        break;
      case "min":
      case "max":
        for (let index = node.values.length - 1; index >= 0; index -= 1) {
          arrayAppend(stack, node.values[index]!);
        }
        break;
    }
  }
}

/**
 * Reads the IR of an authoring expression after checking its dimension. Plain
 * `{ dimension, ir }` records are accepted for repository-internal callers.
 *
 * @internal Not re-exported from the package root.
 */
export function expressionIROf(
  value: unknown,
  dimension: Dimension,
  label: string,
): ExpressionIR {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${label} must be ${expressionKind(dimension)}`);
  }
  const candidate = value as { readonly dimension?: unknown; readonly ir?: unknown };
  if (candidate.dimension !== dimension) {
    throw new TypeError(
      `${label} must be ${expressionKind(dimension)}, received ${describeDimension(candidate.dimension)}`,
    );
  }
  const ir = assertExpressionIR(candidate.ir, label);
  if (ir.dimension !== dimension) {
    throw new TypeError(
      `${label} must be ${expressionKind(dimension)}, received ${ir.dimension}`,
    );
  }
  return ir;
}

function expressionOperand<D extends Dimension>(
  value: unknown,
  dimension: D,
  label: string,
): Expression<D> {
  expressionIROf(value, dimension, label);
  return value as Expression<D>;
}

export class Expression<D extends Dimension> {
  readonly dimension: D;
  readonly ir: ExpressionIR;
  readonly [EXPRESSION_MARKER] = true;

  constructor(dimension: D, ir: ExpressionIR) {
    if (!isDimension(dimension)) {
      throw new TypeError(`Unsupported expression dimension '${String(dimension)}'`);
    }
    if (typeof ir !== "object" || ir === null || ir.dimension !== dimension) {
      throw new TypeError(
        `Expression dimension mismatch: expected ${dimension}, received ${describeDimension((ir as { readonly dimension?: unknown } | null)?.dimension)}`,
      );
    }
    this.dimension = dimension;
    this.ir = assertExpressionIR(ir);
    if (new.target === Expression) Object.freeze(this);
  }

  add(other: Expression<D>): Expression<D> {
    return binary(
      "add",
      this,
      expressionOperand(other, this.dimension, "Added expression"),
      this.dimension,
    );
  }

  sub(other: Expression<D>): Expression<D> {
    return binary(
      "sub",
      this,
      expressionOperand(other, this.dimension, "Subtracted expression"),
      this.dimension,
    );
  }

  mul(factor: ScalarLike): Expression<D> {
    return binary(
      "mul",
      this,
      asScalar(factor, "Multiplication factor"),
      this.dimension,
    );
  }

  div(divisor: ScalarLike): Expression<D> {
    return binary(
      "div",
      this,
      asScalar(divisor, "Division divisor"),
      this.dimension,
    );
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

function asScalar(value: ScalarLike, label = "Scalar value"): ScalarExpression {
  return typeof value === "number"
    ? scalar(value)
    : expressionOperand(value, "scalar", label);
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
  return deepFreeze([
    expressionOperand(x, "length", "vec2 x"),
    expressionOperand(y, "length", "vec2 y"),
  ]);
}

export function vec3(
  x: LengthExpression,
  y: LengthExpression,
  z: LengthExpression,
): Vec3Expression {
  return deepFreeze([
    expressionOperand(x, "length", "vec3 x"),
    expressionOperand(y, "length", "vec3 y"),
    expressionOperand(z, "length", "vec3 z"),
  ]);
}

export function scalarVec3(
  x: ScalarLike,
  y: ScalarLike,
  z: ScalarLike,
): ScalarVec3Expression {
  return deepFreeze([
    asScalar(x, "scalarVec3 x"),
    asScalar(y, "scalarVec3 y"),
    asScalar(z, "scalarVec3 z"),
  ]);
}

export function angleVec3(
  x: AngleExpression,
  y: AngleExpression,
  z: AngleExpression,
): AngleVec3Expression {
  return deepFreeze([
    expressionOperand(x, "angle", "angleVec3 x"),
    expressionOperand(y, "angle", "angleVec3 y"),
    expressionOperand(z, "angle", "angleVec3 z"),
  ]);
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
    const dimension = (numerator as { readonly dimension?: unknown } | null)
      ?.dimension;
    if (!isDimension(dimension)) {
      throw new TypeError("ratio() numerator must be an expression");
    }
    return binary(
      "div",
      numerator,
      expressionOperand(denominator, dimension, "ratio() denominator"),
      "scalar",
    );
  },

  neg<D extends Dimension>(value: Expression<D>): Expression<D> {
    return value.neg();
  },

  abs<D extends Dimension>(value: Expression<D>): Expression<D> {
    return value.abs();
  },

  sin(value: AngleExpression): ScalarExpression {
    return unary(
      "sin",
      expressionOperand(value, "angle", "sin() argument"),
      "scalar",
    );
  },

  cos(value: AngleExpression): ScalarExpression {
    return unary(
      "cos",
      expressionOperand(value, "angle", "cos() argument"),
      "scalar",
    );
  },

  tan(value: AngleExpression): ScalarExpression {
    return unary(
      "tan",
      expressionOperand(value, "angle", "tan() argument"),
      "scalar",
    );
  },

  min<D extends Dimension>(...values: readonly Expression<D>[]): Expression<D> {
    return extremum("min", values);
  },

  max<D extends Dimension>(...values: readonly Expression<D>[]): Expression<D> {
    return extremum("max", values);
  },
};

function extremum<D extends Dimension>(
  op: "min" | "max",
  values: readonly Expression<D>[],
): Expression<D> {
  if (values.length === 0) throw new TypeError(`${op}() requires a value`);
  const dimension = (values[0] as { readonly dimension?: unknown } | undefined)
    ?.dimension;
  if (!isDimension(dimension)) {
    throw new TypeError(`${op}() values must be expressions`);
  }
  return new Expression(dimension as D, {
    op,
    dimension,
    values: values.map(
      (value, index) =>
        expressionOperand(value, dimension, `${op}() value ${index}`).ir,
    ),
  });
}

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
    case "max": {
      // Fold instead of spreading: a valid document may hold more operands
      // than a call can pass as arguments.
      const fold = expression.op === "min" ? Math.min : Math.max;
      result = expression.op === "min" ? Infinity : -Infinity;
      for (let index = 0; index < expression.values.length; index += 1) {
        result = fold(
          result,
          evaluateExpression(expression.values[index]!, context),
        );
      }
      break;
    }
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
