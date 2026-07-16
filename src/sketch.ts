import { entityId, type EntityId } from "./core/ids.js";
import { deepFreeze } from "./core/json.js";
import {
  deg,
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
    return new LoopRef(this[SKETCH_OWNER], {
      kind: "circle",
      entity: this.id,
      ...(options.reversed === undefined
        ? {}
        : { reversed: options.reversed }),
    });
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
    if (reference[SKETCH_OWNER] !== this) {
      throw new TypeError("Sketch references cannot cross sketch boundaries");
    }
  }

  private addEntity(id: string, entity: SketchEntityIR): EntityId {
    const key = entityId(id);
    if (this.entities[key] !== undefined || this.constraints[key] !== undefined) {
      throw new TypeError(`Duplicate sketch ID '${id}'`);
    }
    this.entities[key] = deepFreeze(entity);
    return key;
  }

  private addConstraint(id: string, constraint: SketchConstraintIR): void {
    const key = entityId(id);
    if (this.entities[key] !== undefined || this.constraints[key] !== undefined) {
      throw new TypeError(`Duplicate sketch ID '${id}'`);
    }
    this.constraints[key] = deepFreeze(constraint);
  }

  point(id: string, position: Vec2Expression): PointRef {
    const key = this.addEntity(id, {
      kind: "point",
      x: position[0].ir,
      y: position[1].ir,
    });
    return new PointRef(this, key);
  }

  line(id: string, start: PointRef, end: PointRef): LineRef {
    this.assertOwned(start);
    this.assertOwned(end);
    const key = this.addEntity(id, {
      kind: "line",
      start: start.id,
      end: end.id,
    });
    return new LineRef(this, key, start, end);
  }

  circle(id: string, options: CircleOptions): CircleRef {
    const center = this.point(`${id}.center`, options.center ?? [mm(0), mm(0)]);
    const key = this.addEntity(id, {
      kind: "circle",
      center: center.id,
      radius: options.radius.ir,
      ...(options.segments === undefined ? {} : { segments: options.segments }),
    });
    return new CircleRef(this, key, center);
  }

  arc(id: string, options: ArcOptions): ArcRef {
    const center = this.point(`${id}.center`, options.center ?? [mm(0), mm(0)]);
    const key = this.addEntity(id, {
      kind: "arc",
      center: center.id,
      radius: options.radius.ir,
      startAngle: options.startAngle.ir,
      endAngle: options.endAngle.ir,
      clockwise: options.clockwise ?? false,
      ...(options.segments === undefined ? {} : { segments: options.segments }),
    });
    return new ArcRef(this, key, center);
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
    if (edges.length === 0) throw new TypeError("A loop cannot be empty");
    const uses = edges.map((edge): EdgeUseIR => {
      if (edge instanceof LineRef || edge instanceof ArcRef) {
        this.assertOwned(edge);
        return { entity: edge.id };
      }
      return edge;
    });
    return new LoopRef(this, { kind: "edges", edges: uses });
  }

  profile(
    outer: LoopRef,
    options: { readonly holes?: readonly LoopRef[] } = {},
  ): ProfileDefinition {
    this.assertOwned(outer);
    for (const hole of options.holes ?? []) this.assertOwned(hole);
    return new ProfileDefinition(this, {
      outer: outer.ir,
      holes: (options.holes ?? []).map((hole) => hole.ir),
    });
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
      value: value.ir,
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
      value: value.ir,
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
      value: value.ir,
    });
    return this;
  }

  length(id: string, line: LineRef, value: LengthExpression): this {
    this.assertOwned(line);
    this.addConstraint(id, { kind: "length", entity: line.id, value: value.ir });
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
      value: value.ir,
    });
    return this;
  }

  radius(
    id: string,
    circle: CircleRef | ArcRef,
    value: LengthExpression,
  ): this {
    this.assertOwned(circle);
    this.addConstraint(id, { kind: "radius", entity: circle.id, value: value.ir });
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
      value: value.ir,
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
    const [cx, cy] = options.center ?? [mm(0), mm(0)];
    const rotation = options.rotation ?? deg(0);
    const points: Vec2Expression[] = [];
    for (let index = 0; index < sides; index += 1) {
      const angle = rotation.add(deg((index * 360) / sides));
      points.push([
        cx.add(radius.mul(scalar(Math.cos(evaluateLiteralAngle(angle))))),
        cy.add(radius.mul(scalar(Math.sin(evaluateLiteralAngle(angle))))),
      ]);
    }
    return this.polyline(id, points, { closed: true }) as LoopRef;
  }
}

function evaluateLiteralAngle(value: AngleExpression): number {
  if (value.ir.op !== "literal") {
    throw new TypeError(
      "regularPolygon rotation must currently be a literal angle expression",
    );
  }
  return value.ir.value;
}
