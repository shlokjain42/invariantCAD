import { z } from "zod";
import {
  DOCUMENT_SCHEMA,
  DOCUMENT_VERSION,
  type DesignDocument,
  type TopologyQueryIR,
  type TopologySelectionIR,
} from "./ir.js";
import type { ExpressionIR } from "./expressions.js";
import { TOPOLOGY_ROLES } from "./protocol/topology.js";
import { SHELL_DIRECTIONS } from "./protocol/shell.js";
import { OFFSET_DIRECTIONS } from "./protocol/offset.js";

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

const TopologyCardinalitySchema = z
  .object({
    min: z.number().int().min(1),
    max: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.max !== undefined && value.max < value.min) {
      context.addIssue({
        code: "custom",
        message: "Topology selection maximum cannot be less than its minimum",
        path: ["max"],
      });
    }
  });

const TopologySourceSchema = z
  .object({
    kind: z.literal("sketch-entity"),
    sketch: z.string(),
    entity: z.string(),
  })
  .strict();

export const TopologyQuerySchema: z.ZodType<TopologyQueryIR> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal("all") }).strict(),
    z
      .object({
        op: z.literal("origin"),
        feature: z.string(),
        relation: z.enum(["created", "modified"]),
        role: z.enum(TOPOLOGY_ROLES).optional(),
        source: TopologySourceSchema.optional(),
      })
      .strict(),
    z
      .object({
        op: z.literal("surface"),
        kind: z.string().min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("curve"),
        kind: z.string().min(1),
      })
      .strict(),
    z
      .object({
        op: z.enum(["normal", "direction"]),
        value: Vec3ExpressionSchema,
        tolerance: ExpressionSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("radius"),
        value: ExpressionSchema,
        tolerance: ExpressionSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("adjacentTo"),
        selection: z.lazy(() => TopologySelectionSchema),
      })
      .strict(),
    z
      .object({
        op: z.enum(["and", "or"]),
        queries: z.array(TopologyQuerySchema).min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("not"),
        query: TopologyQuerySchema,
      })
      .strict(),
  ]),
) as z.ZodType<TopologyQueryIR>;

export const TopologySelectionSchema: z.ZodType<TopologySelectionIR> = z.lazy(
  () =>
    z
      .object({
        topology: z.enum(["face", "edge"]),
        query: TopologyQuerySchema,
        cardinality: TopologyCardinalitySchema,
      })
      .strict(),
) as z.ZodType<TopologySelectionIR>;

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
  z
    .object({
      kind: z.literal("fillet"),
      input: RefSchema,
      edges: TopologySelectionSchema,
      radius: ExpressionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("chamfer"),
      input: RefSchema,
      edges: TopologySelectionSchema,
      distance: ExpressionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("shell"),
      input: RefSchema,
      openings: TopologySelectionSchema,
      thickness: ExpressionSchema,
      direction: z.enum(SHELL_DIRECTIONS),
      tolerance: ExpressionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("offset"),
      input: RefSchema,
      distance: ExpressionSchema,
      direction: z.enum(OFFSET_DIRECTIONS),
      tolerance: ExpressionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("draft"),
      input: RefSchema,
      faces: TopologySelectionSchema,
      angle: ExpressionSchema,
      pullDirection: Vec3ExpressionSchema,
      neutralPlane: z
        .object({
          origin: Vec3ExpressionSchema,
          normal: Vec3ExpressionSchema,
        })
        .strict(),
    })
    .strict(),
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
