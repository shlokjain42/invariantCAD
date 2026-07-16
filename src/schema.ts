import { z } from "zod";
import {
  DOCUMENT_SCHEMA,
  DOCUMENT_VERSION,
  type DesignDocument,
} from "./ir.js";
import type { ExpressionIR } from "./expressions.js";

const DimensionSchema = z.enum(["scalar", "length", "angle"]);

export const ExpressionSchema: z.ZodType<ExpressionIR> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({
      op: z.literal("literal"),
      dimension: DimensionSchema,
      value: z.number().finite(),
    }),
    z.object({
      op: z.literal("parameter"),
      dimension: DimensionSchema,
      id: z.string(),
    }),
    z.object({
      op: z.enum(["neg", "abs", "sin", "cos", "tan"]),
      dimension: DimensionSchema,
      value: ExpressionSchema,
    }),
    z.object({
      op: z.enum(["add", "sub", "mul", "div"]),
      dimension: DimensionSchema,
      left: ExpressionSchema,
      right: ExpressionSchema,
    }),
    z.object({
      op: z.enum(["min", "max"]),
      dimension: DimensionSchema,
      values: z.array(ExpressionSchema).min(1),
    }),
  ]),
) as z.ZodType<ExpressionIR>;

const Vec2ExpressionSchema = z.tuple([ExpressionSchema, ExpressionSchema]);
const Vec3ExpressionSchema = z.tuple([
  ExpressionSchema,
  ExpressionSchema,
  ExpressionSchema,
]);

const RefSchema = z.object({
  node: z.string(),
  kind: z.enum(["profile", "solid", "part", "assembly"]),
});

const PlaneSchema = z.object({
  type: z.literal("principal"),
  plane: z.enum(["XY", "XZ", "YZ"]),
  origin: Vec3ExpressionSchema,
});

const EntitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("point"),
    x: ExpressionSchema,
    y: ExpressionSchema,
  }),
  z.object({
    kind: z.literal("line"),
    start: z.string(),
    end: z.string(),
  }),
  z.object({
    kind: z.literal("circle"),
    center: z.string(),
    radius: ExpressionSchema,
    segments: z.number().int().min(3).optional(),
  }),
  z.object({
    kind: z.literal("arc"),
    center: z.string(),
    radius: ExpressionSchema,
    startAngle: ExpressionSchema,
    endAngle: ExpressionSchema,
    clockwise: z.boolean(),
    segments: z.number().int().min(2).optional(),
  }),
]);

const ConstraintSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("coincident"),
    first: z.string(),
    second: z.string(),
  }),
  z.object({
    kind: z.enum(["horizontal", "vertical", "fixed"]),
    entity: z.string(),
  }),
  z.object({
    kind: z.enum(["distance", "distanceX", "distanceY"]),
    first: z.string(),
    second: z.string(),
    value: ExpressionSchema,
  }),
  z.object({
    kind: z.literal("length"),
    entity: z.string(),
    value: ExpressionSchema,
  }),
  z.object({
    kind: z.enum(["parallel", "perpendicular", "equalLength"]),
    first: z.string(),
    second: z.string(),
  }),
  z.object({
    kind: z.literal("angle"),
    first: z.string(),
    second: z.string(),
    value: ExpressionSchema,
  }),
  z.object({
    kind: z.enum(["radius", "diameter"]),
    entity: z.string(),
    value: ExpressionSchema,
  }),
  z.object({
    kind: z.literal("equalRadius"),
    first: z.string(),
    second: z.string(),
  }),
  z.object({
    kind: z.literal("midpoint"),
    point: z.string(),
    line: z.string(),
  }),
  z.object({
    kind: z.literal("tangent"),
    line: z.string(),
    circle: z.string(),
  }),
]);

const EdgeLoopSchema = z.object({
  kind: z.literal("edges"),
  edges: z
    .array(z.object({ entity: z.string(), reversed: z.boolean().optional() }))
    .min(1),
});
const CircleLoopSchema = z.object({
  kind: z.literal("circle"),
  entity: z.string(),
  reversed: z.boolean().optional(),
});
const LoopSchema = z.discriminatedUnion("kind", [
  EdgeLoopSchema,
  CircleLoopSchema,
]);

const TransformOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("translate"), value: Vec3ExpressionSchema }),
  z.object({ kind: z.literal("rotate"), value: Vec3ExpressionSchema }),
  z.object({ kind: z.literal("scale"), value: Vec3ExpressionSchema }),
  z.object({ kind: z.literal("mirror"), normal: Vec3ExpressionSchema }),
]);

const NodeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("box"),
    size: Vec3ExpressionSchema,
    center: z.boolean(),
  }),
  z.object({
    kind: z.literal("cylinder"),
    height: ExpressionSchema,
    radiusBottom: ExpressionSchema,
    radiusTop: ExpressionSchema,
    center: z.boolean(),
    segments: z.number().int().min(3).optional(),
  }),
  z.object({
    kind: z.literal("sphere"),
    radius: ExpressionSchema,
    segments: z.number().int().min(4).optional(),
  }),
  z.object({
    kind: z.literal("sketch"),
    plane: PlaneSchema,
    entities: z.record(z.string(), EntitySchema),
    constraints: z.record(z.string(), ConstraintSchema),
    profile: z.object({ outer: LoopSchema, holes: z.array(LoopSchema) }),
    tolerance: z.number().positive(),
  }),
  z.object({
    kind: z.literal("extrude"),
    profile: RefSchema,
    distance: ExpressionSchema,
    symmetric: z.boolean(),
    twist: ExpressionSchema,
    scaleTop: Vec2ExpressionSchema,
    divisions: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("revolve"),
    profile: RefSchema,
    angle: ExpressionSchema,
    segments: z.number().int().min(3).optional(),
  }),
  z.object({
    kind: z.literal("boolean"),
    operation: z.enum(["union", "subtract", "intersect"]),
    target: RefSchema,
    tools: z.array(RefSchema).min(1),
  }),
  z.object({
    kind: z.literal("transform"),
    input: RefSchema,
    operations: z.array(TransformOperationSchema).min(1),
  }),
  z.object({
    kind: z.literal("part"),
    solid: RefSchema,
    partNumber: z.string().optional(),
    description: z.string().optional(),
    material: z.string().optional(),
    metadata: z.record(z.string(), z.json()).optional(),
  }),
  z.object({
    kind: z.literal("assembly"),
    instances: z.array(
      z.object({
        id: z.string(),
        component: RefSchema,
        placement: z.array(TransformOperationSchema),
        suppressed: z.boolean(),
      }),
    ),
  }),
]);

export const DesignDocumentSchema: z.ZodType<DesignDocument> = z.object({
  schema: z.literal(DOCUMENT_SCHEMA),
  version: z.literal(DOCUMENT_VERSION),
  name: z.string().min(1),
  units: z.object({ length: z.literal("mm"), angle: z.literal("rad") }),
  parameters: z.record(
    z.string(),
    z.object({
      dimension: DimensionSchema,
      default: ExpressionSchema,
      min: ExpressionSchema.optional(),
      max: ExpressionSchema.optional(),
      label: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
  nodes: z.record(z.string(), NodeSchema),
  outputs: z.record(z.string(), RefSchema),
  metadata: z.record(z.string(), z.json()).optional(),
}) as unknown as z.ZodType<DesignDocument>;
