import { entityId, type EntityId } from "./core/ids.js";
import { deepFreeze } from "./core/json.js";
import { DEFAULT_DESIGN_DOCUMENT_LIMITS } from "./document-limits.js";
import {
  deg,
  expressionIROf,
  mm,
  scalar,
  type AngleExpression,
  type LengthExpression,
  type Vec2Expression,
} from "./expressions.js";
import type {
  EdgeUseIR,
  SketchConstraintIR,
  SketchEntityIR,
  SketchLoopIR,
  SketchProfileIR,
} from "./ir.js";

const SKETCH_OWNER = Symbol("InvariantCAD.SketchOwner");

/**
 * References returned by SketchBuilder methods. The reference classes keep
 * public constructors, so the owner field alone cannot prove that a reference
 * names an entity or loop its sketch actually authored.
 */
const ISSUED_SKETCH_REFERENCES = new WeakSet<object>();
/** Entity and constraint records each builder stored, with their keys. */
const ISSUED_SKETCH_RECORDS = new WeakMap<
  object,
  { readonly owner: SketchBuilder; readonly key: EntityId }
>();
const CLOSED_SKETCH_BUILDERS = new WeakSet<SketchBuilder>();

function issued<T extends object>(reference: T): T {
  ISSUED_SKETCH_REFERENCES.add(reference);
  return reference;
}

interface OwnedSketchReference {
  readonly [SKETCH_OWNER]: SketchBuilder;
}

export class PointRef implements OwnedSketchReference {
  readonly id: EntityId;
  readonly [SKETCH_OWNER]: SketchBuilder;

  constructor(owner: SketchBuilder, id: EntityId) {
    this[SKETCH_OWNER] = owner;
    this.id = id;
    Object.freeze(this);
  }
}

export class LineRef implements OwnedSketchReference {
  readonly id: EntityId;
  readonly start: PointRef;
  readonly end: PointRef;
  readonly [SKETCH_OWNER]: SketchBuilder;

  constructor(
    owner: SketchBuilder,
    id: EntityId,
    start: PointRef,
    end: PointRef,
  ) {
    this[SKETCH_OWNER] = owner;
    this.id = id;
    this.start = start;
    this.end = end;
    Object.freeze(this);
  }
}

export class CircleRef implements OwnedSketchReference {
  readonly id: EntityId;
  readonly center: PointRef;
  readonly [SKETCH_OWNER]: SketchBuilder;

  constructor(owner: SketchBuilder, id: EntityId, center: PointRef) {
    this[SKETCH_OWNER] = owner;
    this.id = id;
    this.center = center;
    Object.freeze(this);
  }

  loop(options: { readonly reversed?: boolean } = {}): LoopRef {
    const loop = new LoopRef(this[SKETCH_OWNER], {
      kind: "circle",
      entity: this.id,
      ...optionalReversed(options.reversed, `Circle loop '${this.id}'`),
    });
    // Only a circle its sketch issued can issue a loop the sketch accepts.
    return ISSUED_SKETCH_REFERENCES.has(this) ? issued(loop) : loop;
  }
}

export class ArcRef implements OwnedSketchReference {
  readonly id: EntityId;
  readonly center: PointRef;
  readonly [SKETCH_OWNER]: SketchBuilder;

  constructor(owner: SketchBuilder, id: EntityId, center: PointRef) {
    this[SKETCH_OWNER] = owner;
    this.id = id;
    this.center = center;
    Object.freeze(this);
  }
}

export class LoopRef implements OwnedSketchReference {
  readonly ir: SketchLoopIR;
  readonly [SKETCH_OWNER]: SketchBuilder;

  constructor(owner: SketchBuilder, ir: SketchLoopIR) {
    this[SKETCH_OWNER] = owner;
    this.ir = deepFreeze(ir);
    Object.freeze(this);
  }
}

export class ProfileDefinition implements OwnedSketchReference {
  readonly ir: SketchProfileIR;
  readonly [SKETCH_OWNER]: SketchBuilder;

  constructor(owner: SketchBuilder, ir: SketchProfileIR) {
    this[SKETCH_OWNER] = owner;
    this.ir = deepFreeze(ir);
    Object.freeze(this);
  }
}

function optionalReversed(
  value: unknown,
  label: string,
): { readonly reversed?: boolean } {
  if (value === undefined) return {};
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} reversed must be a boolean`);
  }
  return { reversed: value };
}

function optionalClockwise(value: unknown, id: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new TypeError(`Sketch arc '${id}' clockwise must be a boolean`);
  }
  return value;
}

function optionalSegments(
  value: unknown,
  minimum: number,
  label: string,
): { readonly segments?: number } {
  if (value === undefined) return {};
  if (typeof value !== "number") {
    throw new TypeError(`${label} segments must be a number`);
  }
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(
      `${label} segments must be an integer of at least ${minimum}`,
    );
  }
  return { segments: value };
}

export interface RectangleOptions {
  readonly width: LengthExpression;
  readonly height: LengthExpression;
  readonly center?: Vec2Expression;
}

export interface CircleOptions {
  readonly center?: Vec2Expression;
  readonly radius: LengthExpression;
  readonly segments?: number;
}

export interface ArcOptions extends CircleOptions {
  readonly startAngle: AngleExpression;
  readonly endAngle: AngleExpression;
  readonly clockwise?: boolean;
}

export class SketchBuilder {
  readonly entities: Record<EntityId, SketchEntityIR> = {};
  readonly constraints: Record<EntityId, SketchConstraintIR> = {};

  private assertOwned(reference: OwnedSketchReference): void {
    assertSketchReference(this, reference);
  }

  private assertOpen(): void {
    if (CLOSED_SKETCH_BUILDERS.has(this)) {
      throw new TypeError(
        "This sketch builder is closed; author entities inside its sketch() callback",
      );
    }
  }

  private addEntity(id: string, entity: SketchEntityIR): EntityId {
    this.assertOpen();
    const key = entityId(id);
    if (this.entities[key] !== undefined || this.constraints[key] !== undefined) {
      throw new TypeError(`Duplicate sketch ID '${id}'`);
    }
    const record = deepFreeze(entity);
    ISSUED_SKETCH_RECORDS.set(record, { owner: this, key });
    this.entities[key] = record;
    return key;
  }

  private addConstraint(id: string, constraint: SketchConstraintIR): void {
    this.assertOpen();
    const key = entityId(id);
    if (this.entities[key] !== undefined || this.constraints[key] !== undefined) {
      throw new TypeError(`Duplicate sketch ID '${id}'`);
    }
    const record = deepFreeze(constraint);
    ISSUED_SKETCH_RECORDS.set(record, { owner: this, key });
    this.constraints[key] = record;
  }

  point(id: string, position: Vec2Expression): PointRef {
    if (!Array.isArray(position) || position.length !== 2) {
      throw new TypeError(`Sketch point '${id}' requires two length coordinates`);
    }
    const key = this.addEntity(id, {
      kind: "point",
      x: expressionIROf(position[0], "length", `Sketch point '${id}' x`),
      y: expressionIROf(position[1], "length", `Sketch point '${id}' y`),
    });
    return issued(new PointRef(this, key));
  }

  line(id: string, start: PointRef, end: PointRef): LineRef {
    this.assertOwned(start);
    this.assertOwned(end);
    const key = this.addEntity(id, {
      kind: "line",
      start: start.id,
      end: end.id,
    });
    return issued(new LineRef(this, key, start, end));
  }

  circle(id: string, options: CircleOptions): CircleRef {
    const center = this.point(`${id}.center`, options.center ?? [mm(0), mm(0)]);
    const key = this.addEntity(id, {
      kind: "circle",
      center: center.id,
      radius: expressionIROf(options.radius, "length", `Sketch circle '${id}' radius`),
      ...optionalSegments(options.segments, 3, `Sketch circle '${id}'`),
    });
    return issued(new CircleRef(this, key, center));
  }

  arc(id: string, options: ArcOptions): ArcRef {
    const center = this.point(`${id}.center`, options.center ?? [mm(0), mm(0)]);
    const key = this.addEntity(id, {
      kind: "arc",
      center: center.id,
      radius: expressionIROf(options.radius, "length", `Sketch arc '${id}' radius`),
      startAngle: expressionIROf(
        options.startAngle,
        "angle",
        `Sketch arc '${id}' startAngle`,
      ),
      endAngle: expressionIROf(
        options.endAngle,
        "angle",
        `Sketch arc '${id}' endAngle`,
      ),
      clockwise: optionalClockwise(options.clockwise, id),
      ...optionalSegments(options.segments, 2, `Sketch arc '${id}'`),
    });
    return issued(new ArcRef(this, key, center));
  }

  polyline(
    id: string,
    positions: readonly Vec2Expression[],
    options: { readonly closed?: boolean } = {},
  ): LoopRef | readonly LineRef[] {
    if (positions.length < 2) {
      throw new TypeError("A polyline requires at least two points");
    }
    const points = positions.map((position, index) =>
      this.point(`${id}.p${index}`, position),
    );
    const lines: LineRef[] = [];
    const lineCount = options.closed ? points.length : points.length - 1;
    for (let index = 0; index < lineCount; index += 1) {
      lines.push(
        this.line(
          `${id}.e${index}`,
          points[index]!,
          points[(index + 1) % points.length]!,
        ),
      );
    }
    if (!options.closed) return deepFreeze(lines);
    return this.loop(lines);
  }

  rectangle(id: string, options: RectangleOptions): LoopRef {
    const [cx, cy] = options.center ?? [mm(0), mm(0)];
    expressionIROf(options.width, "length", `Sketch rectangle '${id}' width`);
    expressionIROf(options.height, "length", `Sketch rectangle '${id}' height`);
    const halfWidth = options.width.mul(0.5);
    const halfHeight = options.height.mul(0.5);
    return this.polyline(
      id,
      [
        [cx.sub(halfWidth), cy.sub(halfHeight)],
        [cx.add(halfWidth), cy.sub(halfHeight)],
        [cx.add(halfWidth), cy.add(halfHeight)],
        [cx.sub(halfWidth), cy.add(halfHeight)],
      ],
      { closed: true },
    ) as LoopRef;
  }

  loop(edges: readonly (LineRef | ArcRef | EdgeUseIR)[]): LoopRef {
    this.assertOpen();
    if (edges.length === 0) throw new TypeError("A loop cannot be empty");
    const uses = edges.map((edge, index): EdgeUseIR => {
      if (edge instanceof LineRef || edge instanceof ArcRef) {
        this.assertOwned(edge);
        return { entity: edge.id };
      }
      if (typeof edge !== "object" || edge === null) {
        throw new TypeError(`Loop edge ${index} must be a line, arc, or edge use`);
      }
      return {
        entity: entityId(edge.entity),
        ...optionalReversed(edge.reversed, `Loop edge ${index}`),
      };
    });
    return issued(new LoopRef(this, { kind: "edges", edges: uses }));
  }

  profile(
    outer: LoopRef,
    options: { readonly holes?: readonly LoopRef[] } = {},
  ): ProfileDefinition {
    this.assertOpen();
    this.assertOwned(outer);
    for (const hole of options.holes ?? []) this.assertOwned(hole);
    return issued(
      new ProfileDefinition(this, {
        outer: outer.ir,
        holes: (options.holes ?? []).map((hole) => hole.ir),
      }),
    );
  }

  coincident(id: string, first: PointRef, second: PointRef): this {
    this.assertOwned(first);
    this.assertOwned(second);
    this.addConstraint(id, {
      kind: "coincident",
      first: first.id,
      second: second.id,
    });
    return this;
  }

  horizontal(id: string, line: LineRef): this {
    this.assertOwned(line);
    this.addConstraint(id, { kind: "horizontal", entity: line.id });
    return this;
  }

  vertical(id: string, line: LineRef): this {
    this.assertOwned(line);
    this.addConstraint(id, { kind: "vertical", entity: line.id });
    return this;
  }

  fixed(id: string, point: PointRef): this {
    this.assertOwned(point);
    this.addConstraint(id, { kind: "fixed", entity: point.id });
    return this;
  }

  distance(
    id: string,
    first: PointRef,
    second: PointRef,
    value: LengthExpression,
  ): this {
    this.assertOwned(first);
    this.assertOwned(second);
    this.addConstraint(id, {
      kind: "distance",
      first: first.id,
      second: second.id,
      value: expressionIROf(value, "length", `Sketch constraint '${id}' value`),
    });
    return this;
  }

  distanceX(
    id: string,
    first: PointRef,
    second: PointRef,
    value: LengthExpression,
  ): this {
    this.assertOwned(first);
    this.assertOwned(second);
    this.addConstraint(id, {
      kind: "distanceX",
      first: first.id,
      second: second.id,
      value: expressionIROf(value, "length", `Sketch constraint '${id}' value`),
    });
    return this;
  }

  distanceY(
    id: string,
    first: PointRef,
    second: PointRef,
    value: LengthExpression,
  ): this {
    this.assertOwned(first);
    this.assertOwned(second);
    this.addConstraint(id, {
      kind: "distanceY",
      first: first.id,
      second: second.id,
      value: expressionIROf(value, "length", `Sketch constraint '${id}' value`),
    });
    return this;
  }

  length(id: string, line: LineRef, value: LengthExpression): this {
    this.assertOwned(line);
    this.addConstraint(id, {
      kind: "length",
      entity: line.id,
      value: expressionIROf(value, "length", `Sketch constraint '${id}' value`),
    });
    return this;
  }

  parallel(id: string, first: LineRef, second: LineRef): this {
    this.assertOwned(first);
    this.assertOwned(second);
    this.addConstraint(id, {
      kind: "parallel",
      first: first.id,
      second: second.id,
    });
    return this;
  }

  perpendicular(id: string, first: LineRef, second: LineRef): this {
    this.assertOwned(first);
    this.assertOwned(second);
    this.addConstraint(id, {
      kind: "perpendicular",
      first: first.id,
      second: second.id,
    });
    return this;
  }

  equalLength(id: string, first: LineRef, second: LineRef): this {
    this.assertOwned(first);
    this.assertOwned(second);
    this.addConstraint(id, {
      kind: "equalLength",
      first: first.id,
      second: second.id,
    });
    return this;
  }

  angle(
    id: string,
    first: LineRef,
    second: LineRef,
    value: AngleExpression,
  ): this {
    this.assertOwned(first);
    this.assertOwned(second);
    this.addConstraint(id, {
      kind: "angle",
      first: first.id,
      second: second.id,
      value: expressionIROf(value, "angle", `Sketch constraint '${id}' value`),
    });
    return this;
  }

  radius(
    id: string,
    circle: CircleRef | ArcRef,
    value: LengthExpression,
  ): this {
    this.assertOwned(circle);
    this.addConstraint(id, {
      kind: "radius",
      entity: circle.id,
      value: expressionIROf(value, "length", `Sketch constraint '${id}' value`),
    });
    return this;
  }

  diameter(
    id: string,
    circle: CircleRef | ArcRef,
    value: LengthExpression,
  ): this {
    this.assertOwned(circle);
    this.addConstraint(id, {
      kind: "diameter",
      entity: circle.id,
      value: expressionIROf(value, "length", `Sketch constraint '${id}' value`),
    });
    return this;
  }

  equalRadius(
    id: string,
    first: CircleRef | ArcRef,
    second: CircleRef | ArcRef,
  ): this {
    this.assertOwned(first);
    this.assertOwned(second);
    this.addConstraint(id, {
      kind: "equalRadius",
      first: first.id,
      second: second.id,
    });
    return this;
  }

  midpoint(id: string, point: PointRef, line: LineRef): this {
    this.assertOwned(point);
    this.assertOwned(line);
    this.addConstraint(id, {
      kind: "midpoint",
      point: point.id,
      line: line.id,
    });
    return this;
  }

  tangent(id: string, line: LineRef, circle: CircleRef): this {
    this.assertOwned(line);
    this.assertOwned(circle);
    this.addConstraint(id, {
      kind: "tangent",
      line: line.id,
      circle: circle.id,
    });
    return this;
  }

  regularPolygon(
    id: string,
    sides: number,
    radius: LengthExpression,
    options: {
      readonly center?: Vec2Expression;
      readonly rotation?: AngleExpression;
    } = {},
  ): LoopRef {
    if (!Number.isInteger(sides) || sides < 3) {
      throw new TypeError("A regular polygon requires at least three sides");
    }
    if (sides > DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues) {
      throw new RangeError(
        `A regular polygon cannot have more than ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues} sides`,
      );
    }
    expressionIROf(radius, "length", `Sketch regular polygon '${id}' radius`);
    const [cx, cy] = options.center ?? [mm(0), mm(0)];
    // Vertex directions are resolved while authoring, so only the base
    // rotation must be literal; each vertex angle is computed numerically.
    const rotation = evaluateLiteralAngle(options.rotation ?? deg(0));
    const points: Vec2Expression[] = [];
    for (let index = 0; index < sides; index += 1) {
      const angle = rotation + (index * 2 * Math.PI) / sides;
      points.push([
        cx.add(radius.mul(scalar(Math.cos(angle)))),
        cy.add(radius.mul(scalar(Math.sin(angle)))),
      ]);
    }
    return this.polyline(id, points, { closed: true }) as LoopRef;
  }
}

function assertSketchReference(
  sketch: SketchBuilder,
  reference: unknown,
): void {
  if (
    typeof reference !== "object" ||
    reference === null ||
    !ISSUED_SKETCH_REFERENCES.has(reference)
  ) {
    throw new TypeError(
      "Sketch references must be returned by a SketchBuilder method",
    );
  }
  if ((reference as OwnedSketchReference)[SKETCH_OWNER] !== sketch) {
    throw new TypeError("Sketch references cannot cross sketch boundaries");
  }
}

/**
 * Ends a sketch callback: later authoring through an escaped builder throws
 * and its public entity and constraint records are frozen.
 *
 * @internal Not re-exported from the package root.
 */
export function closeSketchBuilder(sketch: SketchBuilder): void {
  CLOSED_SKETCH_BUILDERS.add(sketch);
  Object.freeze(sketch.entities);
  Object.freeze(sketch.constraints);
}

/**
 * Requires a closed sketch callback's result to be a profile its own builder
 * issued, and every stored entity and constraint to be a record a builder
 * method created under the same key.
 *
 * @internal Not re-exported from the package root.
 */
export function assertSketchProfile(
  sketch: SketchBuilder,
  profile: ProfileDefinition,
): void {
  assertSketchReference(sketch, profile);
  for (const records of [sketch.entities, sketch.constraints]) {
    for (const [key, record] of Object.entries(records)) {
      const issuedRecord =
        typeof record === "object" && record !== null
          ? ISSUED_SKETCH_RECORDS.get(record)
          : undefined;
      if (issuedRecord?.owner !== sketch || issuedRecord.key !== key) {
        throw new TypeError(
          `Sketch record '${key}' must be created by a SketchBuilder method`,
        );
      }
    }
  }
}

function evaluateLiteralAngle(value: AngleExpression): number {
  const ir = expressionIROf(value, "angle", "regularPolygon rotation");
  if (ir.op !== "literal") {
    throw new TypeError(
      "regularPolygon rotation must currently be a literal angle expression",
    );
  }
  return ir.value;
}
