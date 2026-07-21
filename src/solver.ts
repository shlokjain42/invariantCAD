import type { EntityId } from "./core/ids.js";
import type { Vec2 } from "./core/math.js";
import {
  cross2,
  distance2,
  dot2,
  length2,
  subtract2,
} from "./core/math.js";
import { diagnostic, type Diagnostic } from "./core/result.js";
import type { ExpressionIR } from "./expressions.js";
import type {
  ArcEntityIR,
  CircleEntityIR,
  LineEntityIR,
  SketchConstraintIR,
  SketchEntityIR,
  SketchLoopIR,
  SketchNodeIR,
} from "./ir.js";
import type {
  NumericPlane,
  ProfileCurveSource,
  ResolvedArcCurve,
  ResolvedCurve,
  ResolvedLoop,
  ResolvedProfile,
} from "./protocol/profile.js";

export type SketchSolveStatus =
  | "solved"
  | "underconstrained"
  | "overconstrained"
  | "nonconvergent"
  | "invalid";

export interface SketchSolverCapabilities {
  readonly entities: readonly SketchEntityIR["kind"][];
  readonly constraints: readonly SketchConstraintIR["kind"][];
  readonly reportsDegreesOfFreedom: boolean;
  readonly reportsConflicts: boolean;
}

export interface SolvedSketch {
  readonly status: SketchSolveStatus;
  readonly points: Readonly<Record<EntityId, Vec2>>;
  readonly radii: Readonly<Record<EntityId, number>>;
  readonly profile: ResolvedProfile;
  readonly degreesOfFreedom: number;
  readonly iterations: number;
  readonly residual: number;
  readonly diagnostics: readonly Diagnostic[];
}

export interface SketchSolveContext {
  readonly evaluate: (expression: ExpressionIR) => number;
  readonly signal?: AbortSignal;
  readonly maxIterations?: number;
  readonly feature?: string;
}

export interface SketchSolverBackend {
  readonly id: string;
  readonly capabilities: SketchSolverCapabilities;
  /**
   * Exact cross-run numeric-semantics identity required by shape-artifact keys.
   * Advertise this only after the solver has established compatibility across
   * every runtime encoded by the value. Omission means cross-run artifact
   * caching is unsupported for this solver.
   */
  readonly artifactCompatibilityFingerprint?: string;
  solve(sketch: SketchNodeIR, context: SketchSolveContext): SolvedSketch;
  dispose(): void;
}

interface VariableMap {
  readonly pointOffset: Map<EntityId, number>;
  readonly radiusOffset: Map<EntityId, number>;
  readonly initial: number[];
}

interface ResidualTerm {
  readonly constraint: EntityId;
  readonly values: readonly number[];
}

const SUPPORTED_CONSTRAINTS = [
  "coincident",
  "horizontal",
  "vertical",
  "fixed",
  "distance",
  "distanceX",
  "distanceY",
  "length",
  "parallel",
  "perpendicular",
  "equalLength",
  "angle",
  "radius",
  "diameter",
  "equalRadius",
  "midpoint",
  "tangent",
] as const satisfies readonly SketchConstraintIR["kind"][];

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function makeVariables(
  sketch: SketchNodeIR,
  evaluate: (expression: ExpressionIR) => number,
): VariableMap {
  const pointOffset = new Map<EntityId, number>();
  const radiusOffset = new Map<EntityId, number>();
  const initial: number[] = [];
  for (const [rawId, entity] of (Object.entries(sketch.entities) as [
    EntityId,
    SketchEntityIR,
  ][]).sort(([first], [second]) => lexicalCompare(first, second))) {
    if (entity.kind === "point") {
      pointOffset.set(rawId, initial.length);
      initial.push(evaluate(entity.x), evaluate(entity.y));
    } else if (entity.kind === "circle" || entity.kind === "arc") {
      radiusOffset.set(rawId, initial.length);
      initial.push(evaluate(entity.radius));
    }
  }
  return { pointOffset, radiusOffset, initial };
}

function pointAt(variables: VariableMap, values: readonly number[], id: EntityId): Vec2 {
  const offset = variables.pointOffset.get(id);
  if (offset === undefined) throw new Error(`Missing point variable '${id}'`);
  return [values[offset]!, values[offset + 1]!];
}

function radiusAt(
  variables: VariableMap,
  values: readonly number[],
  id: EntityId,
): number {
  const offset = variables.radiusOffset.get(id);
  if (offset === undefined) throw new Error(`Missing radius variable '${id}'`);
  return values[offset]!;
}

function lineAt(
  sketch: SketchNodeIR,
  variables: VariableMap,
  values: readonly number[],
  id: EntityId,
): readonly [Vec2, Vec2] {
  const line = sketch.entities[id];
  if (line?.kind !== "line") throw new Error(`Entity '${id}' is not a line`);
  return [pointAt(variables, values, line.start), pointAt(variables, values, line.end)];
}

function lineVector(
  sketch: SketchNodeIR,
  variables: VariableMap,
  values: readonly number[],
  id: EntityId,
): Vec2 {
  const [start, end] = lineAt(sketch, variables, values, id);
  return subtract2(end, start);
}

function wrapAngle(value: number): number {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function residualTerms(
  sketch: SketchNodeIR,
  variables: VariableMap,
  values: readonly number[],
  evaluate: (expression: ExpressionIR) => number,
): readonly ResidualTerm[] {
  const terms: ResidualTerm[] = [];
  for (const [rawId, constraint] of (Object.entries(sketch.constraints) as [
    EntityId,
    SketchConstraintIR,
  ][]).sort(([first], [second]) => lexicalCompare(first, second))) {
    const term = (...residuals: number[]): void => {
      terms.push({ constraint: rawId, values: residuals });
    };
    switch (constraint.kind) {
      case "coincident": {
        const first = pointAt(variables, values, constraint.first);
        const second = pointAt(variables, values, constraint.second);
        term(first[0] - second[0], first[1] - second[1]);
        break;
      }
      case "horizontal": {
        const [start, end] = lineAt(sketch, variables, values, constraint.entity);
        term(end[1] - start[1]);
        break;
      }
      case "vertical": {
        const [start, end] = lineAt(sketch, variables, values, constraint.entity);
        term(end[0] - start[0]);
        break;
      }
      case "fixed": {
        const point = pointAt(variables, values, constraint.entity);
        const original = pointAt(variables, variables.initial, constraint.entity);
        term(point[0] - original[0], point[1] - original[1]);
        break;
      }
      case "distance": {
        const first = pointAt(variables, values, constraint.first);
        const second = pointAt(variables, values, constraint.second);
        term(distance2(first, second) - evaluate(constraint.value));
        break;
      }
      case "distanceX": {
        const first = pointAt(variables, values, constraint.first);
        const second = pointAt(variables, values, constraint.second);
        term(second[0] - first[0] - evaluate(constraint.value));
        break;
      }
      case "distanceY": {
        const first = pointAt(variables, values, constraint.first);
        const second = pointAt(variables, values, constraint.second);
        term(second[1] - first[1] - evaluate(constraint.value));
        break;
      }
      case "length":
        term(
          length2(lineVector(sketch, variables, values, constraint.entity)) -
            evaluate(constraint.value),
        );
        break;
      case "parallel": {
        const first = lineVector(sketch, variables, values, constraint.first);
        const second = lineVector(sketch, variables, values, constraint.second);
        term(cross2(first, second) / Math.max(length2(first) * length2(second), 1e-12));
        break;
      }
      case "perpendicular": {
        const first = lineVector(sketch, variables, values, constraint.first);
        const second = lineVector(sketch, variables, values, constraint.second);
        term(dot2(first, second) / Math.max(length2(first) * length2(second), 1e-12));
        break;
      }
      case "equalLength":
        term(
          length2(lineVector(sketch, variables, values, constraint.first)) -
            length2(lineVector(sketch, variables, values, constraint.second)),
        );
        break;
      case "angle": {
        const first = lineVector(sketch, variables, values, constraint.first);
        const second = lineVector(sketch, variables, values, constraint.second);
        const actual = Math.atan2(cross2(first, second), dot2(first, second));
        term(wrapAngle(actual - evaluate(constraint.value)));
        break;
      }
      case "radius":
        term(radiusAt(variables, values, constraint.entity) - evaluate(constraint.value));
        break;
      case "diameter":
        term(radiusAt(variables, values, constraint.entity) * 2 - evaluate(constraint.value));
        break;
      case "equalRadius":
        term(
          radiusAt(variables, values, constraint.first) -
            radiusAt(variables, values, constraint.second),
        );
        break;
      case "midpoint": {
        const point = pointAt(variables, values, constraint.point);
        const [start, end] = lineAt(sketch, variables, values, constraint.line);
        term(
          point[0] - (start[0] + end[0]) / 2,
          point[1] - (start[1] + end[1]) / 2,
        );
        break;
      }
      case "tangent": {
        const [start, end] = lineAt(sketch, variables, values, constraint.line);
        const line = subtract2(end, start);
        const circle = sketch.entities[constraint.circle];
        if (circle?.kind !== "circle") throw new Error("Tangent target is not a circle");
        const center = pointAt(variables, values, circle.center);
        const distance =
          Math.abs(cross2(line, subtract2(center, start))) /
          Math.max(length2(line), 1e-12);
        term(distance - radiusAt(variables, values, constraint.circle));
        break;
      }
    }
  }
  return terms;
}

function flattenResiduals(terms: readonly ResidualTerm[]): number[] {
  return terms.flatMap((term) => [...term.values]);
}

function squaredNorm(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value * value, 0);
}

function maxAbsolute(values: readonly number[]): number {
  return values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
}

function solveLinearSystem(matrix: number[][], right: number[]): number[] | null {
  const size = right.length;
  const augmented = matrix.map((row, index) => [...row, right[index]!]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot]![column]!) < 1e-14) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const divisor = augmented[column]![column]!;
    for (let item = column; item <= size; item += 1) {
      augmented[column]![item] = augmented[column]![item]! / divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let item = column; item <= size; item += 1) {
        augmented[row]![item] =
          augmented[row]![item]! - factor * augmented[column]![item]!;
      }
    }
  }
  return augmented.map((row) => row[size]!);
}

function jacobian(
  evaluateResidual: (values: readonly number[]) => readonly number[],
  values: readonly number[],
  base: readonly number[],
): number[][] {
  const result = Array.from({ length: base.length }, () =>
    new Array<number>(values.length).fill(0),
  );
  for (let column = 0; column < values.length; column += 1) {
    const step = 1e-6 * Math.max(1, Math.abs(values[column]!));
    const shifted = [...values];
    shifted[column] = shifted[column]! + step;
    const residual = evaluateResidual(shifted);
    for (let row = 0; row < base.length; row += 1) {
      result[row]![column] = (residual[row]! - base[row]!) / step;
    }
  }
  return result;
}

function matrixRank(input: readonly (readonly number[])[], tolerance = 1e-9): number {
  if (input.length === 0) return 0;
  const matrix = input.map((row) => [...row]);
  const rows = matrix.length;
  const columns = matrix[0]!.length;
  let rank = 0;
  for (let column = 0; column < columns && rank < rows; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < rows; row += 1) {
      if (Math.abs(matrix[row]![column]!) > Math.abs(matrix[pivot]![column]!)) {
        pivot = row;
      }
    }
    if (Math.abs(matrix[pivot]![column]!) <= tolerance) continue;
    [matrix[rank], matrix[pivot]] = [matrix[pivot]!, matrix[rank]!];
    const divisor = matrix[rank]![column]!;
    for (let item = column; item < columns; item += 1) {
      matrix[rank]![item] = matrix[rank]![item]! / divisor;
    }
    for (let row = 0; row < rows; row += 1) {
      if (row === rank) continue;
      const factor = matrix[row]![column]!;
      for (let item = column; item < columns; item += 1) {
        matrix[row]![item] =
          matrix[row]![item]! - factor * matrix[rank]![item]!;
      }
    }
    rank += 1;
  }
  return rank;
}

function optimize(
  initial: readonly number[],
  evaluateResidual: (values: readonly number[]) => readonly number[],
  tolerance: number,
  maxIterations: number,
  signal?: AbortSignal,
): {
  readonly values: readonly number[];
  readonly iterations: number;
  readonly residual: readonly number[];
  readonly jacobian: readonly (readonly number[])[];
} {
  let values = [...initial];
  let residual = [...evaluateResidual(values)];
  let damping = 1e-3;
  let finalJacobian: number[][] = [];
  let iterations = 0;
  for (; iterations < maxIterations && maxAbsolute(residual) > tolerance; iterations += 1) {
    if (signal?.aborted) throw new DOMException("Evaluation aborted", "AbortError");
    const jac = jacobian(evaluateResidual, values, residual);
    finalJacobian = jac;
    const columns = values.length;
    const normal = Array.from({ length: columns }, () =>
      new Array<number>(columns).fill(0),
    );
    const right = new Array<number>(columns).fill(0);
    for (let row = 0; row < jac.length; row += 1) {
      for (let first = 0; first < columns; first += 1) {
        right[first] = right[first]! - jac[row]![first]! * residual[row]!;
        for (let second = 0; second < columns; second += 1) {
          normal[first]![second] =
            normal[first]![second]! + jac[row]![first]! * jac[row]![second]!;
        }
      }
    }
    for (let index = 0; index < columns; index += 1) {
      normal[index]![index] = normal[index]![index]! + damping;
    }
    const delta = solveLinearSystem(normal, right);
    if (delta === null) break;
    const candidate = values.map((value, index) => value + delta[index]!);
    const candidateResidual = [...evaluateResidual(candidate)];
    if (squaredNorm(candidateResidual) < squaredNorm(residual)) {
      values = candidate;
      residual = candidateResidual;
      damping = Math.max(damping * 0.3, 1e-12);
      if (maxAbsolute(delta) < tolerance * 0.1) break;
    } else {
      damping = Math.min(damping * 10, 1e12);
    }
  }
  if (finalJacobian.length === 0 && residual.length > 0) {
    finalJacobian = jacobian(evaluateResidual, values, residual);
  }
  return { values, iterations, residual, jacobian: finalJacobian };
}

function resolvedArc(
  entity: ArcEntityIR,
  center: Vec2,
  radius: number,
  evaluate: (expression: ExpressionIR) => number,
  reversed: boolean,
  source?: ProfileCurveSource,
): ResolvedArcCurve {
  let start = evaluate(entity.startAngle);
  let end = evaluate(entity.endAngle);
  let clockwise = entity.clockwise;
  if (reversed) {
    [start, end] = [end, start];
    clockwise = !clockwise;
  }
  return {
    kind: "arc",
    center,
    radius,
    startAngle: start,
    endAngle: end,
    clockwise,
    ...(entity.segments === undefined ? {} : { segments: entity.segments }),
    ...(source === undefined ? {} : { source }),
  };
}

function resolveLoop(
  loop: SketchLoopIR,
  sketch: SketchNodeIR,
  variables: VariableMap,
  values: readonly number[],
  evaluate: (expression: ExpressionIR) => number,
  feature?: string,
): ResolvedLoop {
  const source = (entity: EntityId): ProfileCurveSource | undefined =>
    feature === undefined
      ? undefined
      : { kind: "sketch-entity", sketch: feature, entity };
  if (loop.kind === "circle") {
    const entity = sketch.entities[loop.entity] as CircleEntityIR;
    const provenance = source(loop.entity);
    return {
      curves: [
        {
          kind: "circle",
          center: pointAt(variables, values, entity.center),
          radius: radiusAt(variables, values, loop.entity),
          reversed: loop.reversed ?? false,
          ...(entity.segments === undefined ? {} : { segments: entity.segments }),
          ...(provenance === undefined ? {} : { source: provenance }),
        },
      ],
    };
  }
  const curves: ResolvedCurve[] = [];
  for (const use of loop.edges) {
    const entity = sketch.entities[use.entity]!;
    if (entity.kind === "line") {
      const start = pointAt(variables, values, entity.start);
      const end = pointAt(variables, values, entity.end);
      const provenance = source(use.entity);
      curves.push({
        kind: "line",
        start: use.reversed ? end : start,
        end: use.reversed ? start : end,
        ...(provenance === undefined ? {} : { source: provenance }),
      });
    } else if (entity.kind === "arc") {
      curves.push(
        resolvedArc(
          entity,
          pointAt(variables, values, entity.center),
          radiusAt(variables, values, use.entity),
          evaluate,
          use.reversed ?? false,
          source(use.entity),
        ),
      );
    } else {
      throw new Error(`Profile edge '${use.entity}' is not a line or arc`);
    }
  }
  return { curves };
}

export class ReferenceSketchSolver implements SketchSolverBackend {
  readonly id = "invariantcad.reference";
  readonly capabilities: SketchSolverCapabilities = {
    entities: ["point", "line", "circle", "arc"],
    constraints: SUPPORTED_CONSTRAINTS,
    reportsDegreesOfFreedom: true,
    reportsConflicts: false,
  };

  solve(sketch: SketchNodeIR, context: SketchSolveContext): SolvedSketch {
    const variables = makeVariables(sketch, context.evaluate);
    const evaluateResidual = (values: readonly number[]): readonly number[] =>
      flattenResiduals(
        residualTerms(sketch, variables, values, context.evaluate),
      );
    const solved = optimize(
      variables.initial,
      evaluateResidual,
      sketch.tolerance,
      context.maxIterations ?? 100,
      context.signal,
    );
    const maximumResidual = maxAbsolute(solved.residual);
    const rank = matrixRank(solved.jacobian);
    const degreesOfFreedom = Math.max(0, variables.initial.length - rank);
    const diagnostics: Diagnostic[] = [];
    let status: SketchSolveStatus;
    if (maximumResidual > sketch.tolerance) {
      status = "overconstrained";
      diagnostics.push(
        diagnostic(
          "SKETCH_OVER_CONSTRAINED",
          `Sketch constraints could not be satisfied; maximum residual is ${maximumResidual}`,
          { severity: "error", details: { maximumResidual } },
        ),
      );
    } else if (degreesOfFreedom > 0) {
      status = "underconstrained";
      diagnostics.push(
        diagnostic(
          "SKETCH_UNDER_CONSTRAINED",
          `Sketch has ${degreesOfFreedom} remaining degree${degreesOfFreedom === 1 ? "" : "s"} of freedom`,
          { severity: "info", details: { degreesOfFreedom } },
        ),
      );
    } else {
      status = "solved";
    }
    const points: Record<EntityId, Vec2> = {};
    for (const id of variables.pointOffset.keys()) {
      points[id] = pointAt(variables, solved.values, id);
    }
    const radii: Record<EntityId, number> = {};
    for (const id of variables.radiusOffset.keys()) {
      radii[id] = radiusAt(variables, solved.values, id);
    }
    const loops = [
      resolveLoop(
        sketch.profile.outer,
        sketch,
        variables,
        solved.values,
        context.evaluate,
        context.feature,
      ),
      ...sketch.profile.holes.map((loop) =>
        resolveLoop(
          loop,
          sketch,
          variables,
          solved.values,
          context.evaluate,
          context.feature,
        ),
      ),
    ];
    return {
      status,
      points,
      radii,
      profile: {
        outer: loops[0]!,
        holes: loops.slice(1),
        plane: {
          plane: sketch.plane.plane,
          origin: sketch.plane.origin.map(context.evaluate) as [number, number, number],
        },
      },
      degreesOfFreedom,
      iterations: solved.iterations,
      residual: maximumResidual,
      diagnostics,
    };
  }

  dispose(): void {}
}

export function createReferenceSketchSolver(): SketchSolverBackend {
  return new ReferenceSketchSolver();
}
