import { z } from "zod";
import type { JsonValue } from "./core/json.js";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_SCHEMA_V6,
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DOCUMENT_VERSION_V6,
  DOCUMENT_VERSION_V7,
  NODE_KINDS_V1,
  NODE_KINDS_V2,
  NODE_KINDS_V3,
  NODE_KINDS_V4,
  NODE_KINDS_V5,
  NODE_KINDS_V6,
  NODE_KINDS_V7,
  type DesignDocument,
  type DesignDocumentV1,
  type DesignDocumentV2,
  type DesignDocumentV3,
  type DesignDocumentV4,
  type DesignDocumentV5,
  type DesignDocumentV6,
  type DesignDocumentV7,
  type NodeIR,
  type NodeIRV1,
  type NodeIRV2,
  type NodeIRV3,
  type NodeIRV4,
  type NodeIRV5,
  type NodeIRV6,
  type NodeIRV7,
  type TopologyReferenceEntryIR,
  type TopologyReferenceEntryIRV2,
  type TopologyReferenceEntryIRV3,
  type TopologyReferenceEntryIRV4,
  type TopologyReferenceEntryIRV5,
  type TopologyReferenceEntryIRV6,
  type TopologyReferenceEntryIRV7,
  type TopologyQueryIR,
  type TopologyQueryIRFor,
  type TopologyQueryIRV1,
  type TopologyQueryIRV2,
  type TopologyQueryIRV3,
  type TopologyQueryIRV4,
  type TopologyQueryIRV5,
  type TopologyQueryIRV6,
  type TopologySelectionIR,
  type TopologySelectionIRFor,
  type TopologySelectionIRV1,
  type TopologySelectionIRV2,
  type TopologySelectionIRV3,
  type TopologySelectionIRV4,
  type TopologySelectionIRV5,
  type TopologySelectionIRV6,
} from "./ir.js";
import type { ExpressionIR } from "./expressions.js";
import { pluralTopologyKind } from "./internal/topology-language.js";
import {
  TOPOLOGY_ROLES_V1,
  TOPOLOGY_ROLES_V2,
  TOPOLOGY_ROLES_V3,
  TOPOLOGY_ROLES_V4,
  TOPOLOGY_ROLES_V5,
  TOPOLOGY_ROLES_V6,
  type TopologyKind,
  type TopologyKindV1,
  type TopologyRole,
  type TopologyRoleV1,
  type TopologyRoleV2,
  type TopologyRoleV3,
  type TopologyRoleV4,
  type TopologyRoleV5,
  type TopologyRoleV6,
} from "./protocol/topology.js";
import { SHELL_DIRECTIONS } from "./protocol/shell.js";
import { OFFSET_DIRECTIONS } from "./protocol/offset.js";
import {
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1,
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2,
  normalizePersistentTopologyReference,
  type PersistentTopologyReference,
  type PersistentTopologyReferenceV2,
  type PersistentTopologyReferenceV3,
  type PersistentTopologyReferenceV4,
  type PersistentTopologyReferenceV5,
  type PersistentTopologyReferenceV6,
} from "./topology-signatures.js";

const DimensionSchema = z.enum(["scalar", "length", "angle", "massDensity"]);
const IdSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_.:-]*$/,
    "IDs must begin with a letter and contain only letters, digits, dots, colons, underscores, or hyphens",
  );

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

/**
 * Document v7 is a closed protocol. It cannot reuse the permissive legacy
 * expression objects because those intentionally strip unknown properties.
 */
const ExpressionV7Schema: z.ZodType<ExpressionIR> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z
      .object({
        op: z.literal("literal"),
        dimension: DimensionSchema,
        value: z.number().finite(),
      })
      .strict(),
    z
      .object({
        op: z.literal("parameter"),
        dimension: DimensionSchema,
        id: IdSchema,
      })
      .strict(),
    z
      .object({
        op: z.enum(["neg", "abs", "sin", "cos", "tan"]),
        dimension: DimensionSchema,
        value: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        op: z.enum(["add", "sub", "mul", "div"]),
        dimension: DimensionSchema,
        left: ExpressionV7Schema,
        right: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        op: z.enum(["min", "max"]),
        dimension: DimensionSchema,
        values: z.array(ExpressionV7Schema).min(1),
      })
      .strict(),
  ]),
) as z.ZodType<ExpressionIR>;

const Vec2ExpressionSchema = z.tuple([ExpressionSchema, ExpressionSchema]);
const Vec3ExpressionSchema = z.tuple([
  ExpressionSchema,
  ExpressionSchema,
  ExpressionSchema,
]);
const Vec2ExpressionV7Schema = z.tuple([
  ExpressionV7Schema,
  ExpressionV7Schema,
]);
const Vec3ExpressionV7Schema = z.tuple([
  ExpressionV7Schema,
  ExpressionV7Schema,
  ExpressionV7Schema,
]);

const RefSchema = z.object({
  node: z.string(),
  kind: z.enum(["profile", "path", "solid", "part", "assembly"]),
});

const DesignOutputRefSchema = z.object({
  node: z.string(),
  kind: z.enum(["solid", "part", "assembly"]),
});

const DesignOutputRefV7Schema = z
  .object({
    node: IdSchema,
    kind: z.enum([
      "curve",
      "wire",
      "face",
      "shell",
      "solid",
      "bodySet",
      "part",
      "assembly",
    ]),
  })
  .strict();

const PlaneSchema = z.object({
  type: z.literal("principal"),
  plane: z.enum(["XY", "XZ", "YZ"]),
  origin: Vec3ExpressionSchema,
});

const PlaneV7Schema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("principal"),
      plane: z.enum(["XY", "XZ", "YZ"]),
      origin: Vec3ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal("datum"),
      datum: z
        .object({
          node: IdSchema,
          kind: z.literal("datumPlane"),
        })
        .strict(),
    })
    .strict(),
]);

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

const EntityV7Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("point"),
      x: ExpressionV7Schema,
      y: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("line"),
      start: IdSchema,
      end: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("circle"),
      center: IdSchema,
      radius: ExpressionV7Schema,
      segments: z.number().int().min(3).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("arc"),
      center: IdSchema,
      radius: ExpressionV7Schema,
      startAngle: ExpressionV7Schema,
      endAngle: ExpressionV7Schema,
      clockwise: z.boolean(),
      segments: z.number().int().min(2).optional(),
    })
    .strict(),
]);

const ConstraintV7Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("coincident"),
      first: IdSchema,
      second: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["horizontal", "vertical", "fixed"]),
      entity: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["distance", "distanceX", "distanceY"]),
      first: IdSchema,
      second: IdSchema,
      value: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("length"),
      entity: IdSchema,
      value: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["parallel", "perpendicular", "equalLength"]),
      first: IdSchema,
      second: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("angle"),
      first: IdSchema,
      second: IdSchema,
      value: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["radius", "diameter"]),
      entity: IdSchema,
      value: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("equalRadius"),
      first: IdSchema,
      second: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("midpoint"),
      point: IdSchema,
      line: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tangent"),
      line: IdSchema,
      circle: IdSchema,
    })
    .strict(),
]);

const EdgeLoopV7Schema = z
  .object({
    kind: z.literal("edges"),
    edges: z
      .array(
        z
          .object({
            entity: IdSchema,
            reversed: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const CircleLoopV7Schema = z
  .object({
    kind: z.literal("circle"),
    entity: IdSchema,
    reversed: z.boolean().optional(),
  })
  .strict();
const LoopV7Schema = z.discriminatedUnion("kind", [
  EdgeLoopV7Schema,
  CircleLoopV7Schema,
]);

const TransformOperationV7Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("translate"),
      value: Vec3ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("rotate"),
      value: Vec3ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("scale"),
      value: Vec3ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("mirror"),
      normal: Vec3ExpressionV7Schema,
    })
    .strict(),
]);

function copyProtocolJsonValue(
  value: unknown,
  active: WeakSet<object>,
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Protocol metadata numbers must be finite");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Protocol metadata must contain only JSON values");
  }
  if (active.has(value)) {
    throw new TypeError("Protocol metadata cannot contain object cycles");
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError("Protocol metadata arrays cannot be sparse");
        }
        output.push(copyProtocolJsonValue(value[index], active));
      }
      return output;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Protocol metadata objects must be plain records");
    }
    const output = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value)) {
      output[key] = copyProtocolJsonValue(
        (value as Readonly<Record<string, unknown>>)[key],
        active,
      );
    }
    return output;
  } finally {
    active.delete(value);
  }
}

const ProtocolJsonRecordV7Schema = z.unknown().transform((value, context) => {
  try {
    const output = copyProtocolJsonValue(value, new WeakSet());
    if (output === null || Array.isArray(output) || typeof output !== "object") {
      throw new TypeError("Protocol metadata must be a JSON object");
    }
    return output as Readonly<Record<string, JsonValue>>;
  } catch (error) {
    context.addIssue({
      code: "custom",
      message:
        error instanceof Error
          ? error.message
          : "Protocol metadata is malformed",
    });
    return z.NEVER;
  }
});

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
const TopologySourceV7Schema = z
  .object({
    kind: z.literal("sketch-entity"),
    sketch: IdSchema,
    entity: IdSchema,
  })
  .strict();

type DiscriminatedUnionVariants = Parameters<
  typeof z.discriminatedUnion
>[1];

const TOPOLOGY_KINDS_V1 = Object.freeze([
  "face",
  "edge",
] as const satisfies readonly TopologyKindV1[]);
const TOPOLOGY_KINDS_V2 = Object.freeze([
  ...TOPOLOGY_KINDS_V1,
  "vertex",
] as const satisfies readonly TopologyKind[]);

function createTopologySchemas<
  AllowPersistent extends boolean,
  R extends TopologyRole,
  K extends TopologyKind,
>(
  allowPersistent: AllowPersistent,
  roles: readonly R[],
  topologyKinds: readonly K[],
  expressionSchema: z.ZodType<ExpressionIR> = ExpressionSchema,
  vec3ExpressionSchema: z.ZodType = Vec3ExpressionSchema,
  topologySourceSchema: z.ZodType = TopologySourceSchema,
  nodeIdSchema: z.ZodType<string> = z.string(),
): {
  readonly query: z.ZodType<TopologyQueryIRFor<AllowPersistent, R, K>>;
  readonly selection: z.ZodType<
    TopologySelectionIRFor<K, AllowPersistent, R, K>
  >;
} {
  let selectionSchema!: z.ZodType<
    TopologySelectionIRFor<K, AllowPersistent, R, K>
  >;
  const querySchema = z.lazy(() => {
    const persistent = z
      .object({
        op: z.literal("persistentReference"),
        reference: IdSchema,
      })
      .strict();
    const variants = [
      z.object({ op: z.literal("all") }).strict(),
      ...(allowPersistent ? [persistent] : []),
      z
        .object({
          op: z.literal("origin"),
          feature: nodeIdSchema,
          relation: z.enum(["created", "modified"]),
          role: z.enum(roles as [R, ...R[]]).optional(),
          source: topologySourceSchema.optional(),
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
          value: vec3ExpressionSchema,
          tolerance: expressionSchema,
        })
        .strict(),
      z
        .object({
          op: z.literal("radius"),
          value: expressionSchema,
          tolerance: expressionSchema,
        })
        .strict(),
      ...(topologyKinds.includes("vertex" as K)
        ? [
            z
              .object({
                op: z.literal("position"),
                value: vec3ExpressionSchema,
                tolerance: expressionSchema,
              })
              .strict(),
          ]
        : []),
      z
        .object({
          op: z.literal("adjacentTo"),
          selection: z.lazy(() => selectionSchema),
        })
        .strict(),
      z
        .object({
          op: z.enum(["and", "or"]),
          queries: z.array(z.lazy(() => querySchema)).min(1),
        })
        .strict(),
      z
        .object({
          op: z.literal("not"),
          query: z.lazy(() => querySchema),
        })
        .strict(),
    ];
    return z.discriminatedUnion(
      "op",
      variants as unknown as DiscriminatedUnionVariants,
    );
  }) as z.ZodType<TopologyQueryIRFor<AllowPersistent, R, K>>;

  selectionSchema = z.lazy(() =>
    z
      .object({
        topology: z.enum(topologyKinds as [K, ...K[]]),
        query: querySchema,
        cardinality: TopologyCardinalitySchema,
      })
      .strict(),
  ) as z.ZodType<
    TopologySelectionIRFor<K, AllowPersistent, R, K>
  >;
  return { query: querySchema, selection: selectionSchema };
}

const topologySchemasV1 = createTopologySchemas<
  false,
  TopologyRoleV1,
  TopologyKindV1
>(
  false,
  TOPOLOGY_ROLES_V1,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV2 = createTopologySchemas<
  boolean,
  TopologyRoleV2,
  TopologyKindV1
>(
  true,
  TOPOLOGY_ROLES_V2,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV3 = createTopologySchemas<
  boolean,
  TopologyRoleV3,
  TopologyKindV1
>(
  true,
  TOPOLOGY_ROLES_V3,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV4 = createTopologySchemas<
  boolean,
  TopologyRoleV4,
  TopologyKindV1
>(
  true,
  TOPOLOGY_ROLES_V4,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV5 = createTopologySchemas<
  boolean,
  TopologyRoleV5,
  TopologyKindV1
>(
  true,
  TOPOLOGY_ROLES_V5,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV6 = createTopologySchemas<
  boolean,
  TopologyRoleV6,
  TopologyKind
>(
  true,
  TOPOLOGY_ROLES_V6,
  TOPOLOGY_KINDS_V2,
);
const topologySchemasV7 = createTopologySchemas<
  boolean,
  TopologyRoleV6,
  TopologyKind
>(
  true,
  TOPOLOGY_ROLES_V6,
  TOPOLOGY_KINDS_V2,
  ExpressionV7Schema,
  Vec3ExpressionV7Schema,
  TopologySourceV7Schema,
  IdSchema,
);
const TopologySelectionV7Schema = topologySchemasV7.selection as z.ZodType<
  TopologySelectionIRV6
>;

export const TopologyQueryV1Schema: z.ZodType<TopologyQueryIRV1> =
  topologySchemasV1.query;
export const TopologyQueryV2Schema: z.ZodType<TopologyQueryIRV2> =
  topologySchemasV2.query as z.ZodType<TopologyQueryIRV2>;
export const TopologyQueryV3Schema: z.ZodType<TopologyQueryIRV3> =
  topologySchemasV3.query as z.ZodType<TopologyQueryIRV3>;
export const TopologyQueryV4Schema: z.ZodType<TopologyQueryIRV4> =
  topologySchemasV4.query as z.ZodType<TopologyQueryIRV4>;
export const TopologyQueryV5Schema: z.ZodType<TopologyQueryIRV5> =
  topologySchemasV5.query as z.ZodType<TopologyQueryIRV5>;
export const TopologyQueryV6Schema: z.ZodType<TopologyQueryIRV6> =
  topologySchemasV6.query as z.ZodType<TopologyQueryIRV6>;
export const TopologySelectionV1Schema: z.ZodType<TopologySelectionIRV1> =
  topologySchemasV1.selection;
export const TopologySelectionV2Schema: z.ZodType<TopologySelectionIRV2> =
  topologySchemasV2.selection as z.ZodType<TopologySelectionIRV2>;
export const TopologySelectionV3Schema: z.ZodType<TopologySelectionIRV3> =
  topologySchemasV3.selection as z.ZodType<TopologySelectionIRV3>;
export const TopologySelectionV4Schema: z.ZodType<TopologySelectionIRV4> =
  topologySchemasV4.selection as z.ZodType<TopologySelectionIRV4>;
export const TopologySelectionV5Schema: z.ZodType<TopologySelectionIRV5> =
  topologySchemasV5.selection as z.ZodType<TopologySelectionIRV5>;
export const TopologySelectionV6Schema: z.ZodType<TopologySelectionIRV6> =
  topologySchemasV6.selection as z.ZodType<TopologySelectionIRV6>;

/** Current document-v6 topology query schema. */
export const TopologyQuerySchema: z.ZodType<TopologyQueryIR> =
  TopologyQueryV6Schema;
/** Current document-v6 topology selection schema. */
export const TopologySelectionSchema: z.ZodType<TopologySelectionIR> =
  TopologySelectionV6Schema;

/**
 * The transform is intentionally the topology-signature implementation's
 * defensive copier rather than a second, drifting structural grammar here.
 * The document-version role check happens only after that defensive copy.
 */
function createPersistentTopologyReferenceSchema<
  K extends TopologyKind,
  R extends TopologyRole,
>(
  roles: readonly R[],
  topologyKinds: readonly K[],
  protocolVersions: readonly (1 | 2)[],
): z.ZodType<PersistentTopologyReference<K, R>> {
  const allowedRoles = new Set<TopologyRole>(roles);
  const allowedTopologyKinds = new Set<TopologyKind>(topologyKinds);
  const allowedProtocolVersions = new Set<number>(protocolVersions);
  return z.unknown().transform((value, context) => {
    const normalized = normalizePersistentTopologyReference(value);
    if (!normalized.ok) {
      for (const item of normalized.diagnostics) {
        context.addIssue({
          code: "custom",
          message: item.message,
        });
      }
      return z.NEVER;
    }

    let valid = true;
    if (!allowedTopologyKinds.has(normalized.value.topology)) {
      valid = false;
      context.addIssue({
        code: "custom",
        message: `Topology kind '${normalized.value.topology}' is not supported by this document version`,
        path: ["topology"],
      });
    }
    if (!allowedProtocolVersions.has(normalized.value.protocolVersion)) {
      valid = false;
      context.addIssue({
        code: "custom",
        message: `Topology signature protocol v${normalized.value.protocolVersion} is not supported by this document version`,
        path: ["protocolVersion"],
      });
    }
    const checkLineage = (
      lineage: PersistentTopologyReference["lineage"],
      path: readonly (string | number)[],
    ): void => {
      lineage.forEach((item, index) => {
        if (item.role !== undefined && !allowedRoles.has(item.role)) {
          valid = false;
          context.addIssue({
            code: "custom",
            message: `Topology role '${item.role}' is not supported by this document version`,
            path: [...path, index, "role"],
          });
        }
      });
    };
    checkLineage(normalized.value.lineage, ["lineage"]);
    normalized.value.adjacency.forEach((neighbor, index) => {
      checkLineage(neighbor.lineage, ["adjacency", index, "lineage"]);
    });
    if (!valid) return z.NEVER;
    return normalized.value as PersistentTopologyReference<K, R>;
  }) as z.ZodType<PersistentTopologyReference<K, R>>;
}

export const PersistentTopologyReferenceV2Schema: z.ZodType<PersistentTopologyReferenceV2> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V2,
    TOPOLOGY_KINDS_V1,
    [TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1],
  ) as z.ZodType<PersistentTopologyReferenceV2>;
export const PersistentTopologyReferenceV3Schema: z.ZodType<PersistentTopologyReferenceV3> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V3,
    TOPOLOGY_KINDS_V1,
    [TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1],
  ) as z.ZodType<PersistentTopologyReferenceV3>;
export const PersistentTopologyReferenceV4Schema: z.ZodType<PersistentTopologyReferenceV4> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V4,
    TOPOLOGY_KINDS_V1,
    [TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1],
  ) as z.ZodType<PersistentTopologyReferenceV4>;
export const PersistentTopologyReferenceV5Schema: z.ZodType<PersistentTopologyReferenceV5> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V5,
    TOPOLOGY_KINDS_V1,
    [TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1],
  ) as z.ZodType<PersistentTopologyReferenceV5>;
export const PersistentTopologyReferenceV6Schema: z.ZodType<PersistentTopologyReferenceV6> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V6,
    TOPOLOGY_KINDS_V2,
    [
      TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1,
      TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2,
    ],
  ) as z.ZodType<PersistentTopologyReferenceV6>;
/** Current document-v6 persistent topology evidence schema. */
export const PersistentTopologyReferenceSchema: z.ZodType<PersistentTopologyReference> =
  PersistentTopologyReferenceV6Schema;

const SolidRefSchema = z
  .object({
    node: z.string(),
    kind: z.literal("solid"),
  })
  .strict();
const SolidRefV7Schema = z
  .object({
    node: IdSchema,
    kind: z.literal("solid"),
  })
  .strict();

function createTopologyReferenceEntrySchema<
  K extends TopologyKind,
  R extends TopologyRole,
>(
  referenceSchema: z.ZodType<PersistentTopologyReference<K, R>>,
  topologyKinds: readonly K[],
  targetSchema: z.ZodType = SolidRefSchema,
): z.ZodType<TopologyReferenceEntryIR<K, R>> {
  return z
    .object({
      target: targetSchema,
      topology: z.enum(topologyKinds as [K, ...K[]]),
      variants: z.array(referenceSchema).min(1),
    })
    .strict()
    .superRefine((entry, context) => {
      const fingerprints = new Set<string>();
      entry.variants.forEach((variant, index) => {
        if (variant.topology !== entry.topology) {
          context.addIssue({
            code: "custom",
            message: `Topology reference variant selects ${pluralTopologyKind(variant.topology)}, not ${pluralTopologyKind(entry.topology)}`,
            path: ["variants", index, "topology"],
          });
        }
        const fingerprint = `${variant.protocolVersion}\u0000${variant.kernelFingerprint}`;
        if (fingerprints.has(fingerprint)) {
          context.addIssue({
            code: "custom",
            message: `Topology reference variants must have unique protocol-version and kernel-fingerprint pairs; duplicate '${variant.kernelFingerprint}'`,
            path: ["variants", index, "kernelFingerprint"],
          });
        }
        fingerprints.add(fingerprint);
      });
    }) as unknown as z.ZodType<
    TopologyReferenceEntryIR<K, R>
  >;
}

export const TopologyReferenceEntryV2Schema: z.ZodType<TopologyReferenceEntryIRV2> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV2Schema,
    TOPOLOGY_KINDS_V1,
  ) as z.ZodType<TopologyReferenceEntryIRV2>;
export const TopologyReferenceEntryV3Schema: z.ZodType<TopologyReferenceEntryIRV3> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV3Schema,
    TOPOLOGY_KINDS_V1,
  ) as z.ZodType<TopologyReferenceEntryIRV3>;
export const TopologyReferenceEntryV4Schema: z.ZodType<TopologyReferenceEntryIRV4> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV4Schema,
    TOPOLOGY_KINDS_V1,
  ) as z.ZodType<TopologyReferenceEntryIRV4>;
export const TopologyReferenceEntryV5Schema: z.ZodType<TopologyReferenceEntryIRV5> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV5Schema,
    TOPOLOGY_KINDS_V1,
  ) as z.ZodType<TopologyReferenceEntryIRV5>;
export const TopologyReferenceEntryV6Schema: z.ZodType<TopologyReferenceEntryIRV6> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV6Schema,
    TOPOLOGY_KINDS_V2,
  ) as z.ZodType<TopologyReferenceEntryIRV6>;
export const TopologyReferenceEntryV7Schema: z.ZodType<TopologyReferenceEntryIRV7> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV6Schema,
    TOPOLOGY_KINDS_V2,
    SolidRefV7Schema,
  )
    .superRefine((entry, context) => {
      const validateLineage = (
        lineage: PersistentTopologyReference["lineage"],
        path: readonly (string | number)[],
      ): void => {
        lineage.forEach((item, index) => {
          if (!IdSchema.safeParse(item.feature).success) {
            context.addIssue({
              code: "custom",
              message: "Topology lineage feature must be a valid ID",
              path: [...path, index, "feature"],
            });
          }
          if (item.source !== undefined) {
            if (!IdSchema.safeParse(item.source.sketch).success) {
              context.addIssue({
                code: "custom",
                message: "Topology source sketch must be a valid ID",
                path: [...path, index, "source", "sketch"],
              });
            }
            if (!IdSchema.safeParse(item.source.entity).success) {
              context.addIssue({
                code: "custom",
                message: "Topology source entity must be a valid ID",
                path: [...path, index, "source", "entity"],
              });
            }
          }
        });
      };
      entry.variants.forEach((variant, variantIndex) => {
        validateLineage(variant.lineage, [
          "variants",
          variantIndex,
          "lineage",
        ]);
        variant.adjacency.forEach((neighbor, neighborIndex) => {
          validateLineage(neighbor.lineage, [
            "variants",
            variantIndex,
            "adjacency",
            neighborIndex,
            "lineage",
          ]);
        });
      });
    }) as z.ZodType<TopologyReferenceEntryIRV7>;
/** Current document-v6 topology-reference registry entry schema. */
export const TopologyReferenceEntrySchema: z.ZodType<TopologyReferenceEntryIR> =
  TopologyReferenceEntryV6Schema;

type VersionedNodeKind =
  | NodeIRV1["kind"]
  | NodeIRV2["kind"]
  | NodeIRV3["kind"]
  | NodeIRV4["kind"]
  | NodeIRV5["kind"]
  | NodeIRV6["kind"];

function createNodeSchema(
  topologySelectionSchema: z.ZodType,
  nodeKinds: readonly VersionedNodeKind[],
) {
  const schemas = [
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
    z
      .object({
        kind: z.literal("polylinePath"),
        points: z.array(Vec3ExpressionSchema).min(2),
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("circularArcPath"),
        start: Vec3ExpressionSchema,
        through: Vec3ExpressionSchema,
        end: Vec3ExpressionSchema,
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("compositePath"),
        start: Vec3ExpressionSchema,
        segments: z
          .array(
            z.discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("line"),
                  end: Vec3ExpressionSchema,
                })
                .strict(),
              z
                .object({
                  kind: z.literal("circularArc"),
                  through: Vec3ExpressionSchema,
                  end: Vec3ExpressionSchema,
                })
                .strict(),
            ]),
          )
          .min(2),
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
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
    z
      .object({
        kind: z.literal("loft"),
        profiles: z.array(RefSchema).min(2),
        ruled: z.literal(true),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sweep"),
        profile: RefSchema,
        path: RefSchema,
        transition: z.literal("right-corner"),
        frame: z.literal("corrected-frenet"),
      })
      .strict(),
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
        edges: topologySelectionSchema,
        radius: ExpressionSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("chamfer"),
        input: RefSchema,
        edges: topologySelectionSchema,
        distance: ExpressionSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("shell"),
        input: RefSchema,
        openings: topologySelectionSchema,
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
        faces: topologySelectionSchema,
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
      materialId: IdSchema.optional(),
      massDensity: ExpressionSchema.optional(),
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
  ] as const;

  const allowedKinds = new Set<VersionedNodeKind>(nodeKinds);
  const options = schemas.filter((schema) =>
    allowedKinds.has(schema.shape.kind.value as VersionedNodeKind),
  );
  if (
    nodeKinds.length !== allowedKinds.size ||
    options.length !== nodeKinds.length
  ) {
    throw new Error("Document node-kind grammar has no matching node schema");
  }

  return z.discriminatedUnion(
    "kind",
    options as unknown as typeof schemas,
  );
}

export const NodeV1Schema = createNodeSchema(
  TopologySelectionV1Schema,
  NODE_KINDS_V1,
) as unknown as z.ZodType<NodeIRV1>;
export const NodeV2Schema = createNodeSchema(
  TopologySelectionV2Schema,
  NODE_KINDS_V2,
) as unknown as z.ZodType<NodeIRV2>;
export const NodeV3Schema = createNodeSchema(
  TopologySelectionV3Schema,
  NODE_KINDS_V3,
) as unknown as z.ZodType<NodeIRV3>;
export const NodeV4Schema = createNodeSchema(
  TopologySelectionV4Schema,
  NODE_KINDS_V4,
) as unknown as z.ZodType<NodeIRV4>;
export const NodeV5Schema = createNodeSchema(
  TopologySelectionV5Schema,
  NODE_KINDS_V5,
) as unknown as z.ZodType<NodeIRV5>;
export const NodeV6Schema = createNodeSchema(
  TopologySelectionV6Schema,
  NODE_KINDS_V6,
) as unknown as z.ZodType<NodeIRV6>;

/**
 * Isolated staged-v7 grammar.
 *
 * Do not widen RefSchema, PlaneSchema, or createNodeSchema for v7: every frozen
 * v1-v6 node grammar shares those values. Keeping the new grammar physically
 * separate prevents future kinds and reference values from leaking backwards.
 */
function createNodeV7Schema(): z.ZodType<NodeIRV7> {
  const solidRef = z
    .object({ node: IdSchema, kind: z.literal("solid") })
    .strict();
  const profileRef = z
    .object({ node: IdSchema, kind: z.literal("profile") })
    .strict();
  const pathRef = z
    .object({ node: IdSchema, kind: z.literal("path") })
    .strict();
  const partOrAssemblyRef = z
    .object({
      node: IdSchema,
      kind: z.enum(["part", "assembly"]),
    })
    .strict();
  const solidOrBodySetRef = z
    .object({
      node: IdSchema,
      kind: z.enum(["solid", "bodySet"]),
    })
    .strict();

  const bodySetSchema = z
    .object({
      kind: z.literal("bodySet"),
      bodies: z
        .array(
          z
            .object({
              id: IdSchema,
              solid: solidRef,
              name: z.string().min(1).optional(),
              metadata: ProtocolJsonRecordV7Schema.optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict()
    .superRefine((node, context) => {
      const seen = new Set<string>();
      node.bodies.forEach((body, index) => {
        if (seen.has(body.id)) {
          context.addIssue({
            code: "custom",
            path: ["bodies", index, "id"],
            message: `Body-set member ID '${body.id}' is duplicated`,
          });
        }
        seen.add(body.id);
      });
    });

  const importedBodySchema = z
    .object({
      kind: z.literal("importedBody"),
      resource: IdSchema,
      format: z.enum(["step", "brep", "brep-binary"]),
      units: z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("from-file") }).strict(),
        z
          .object({
            mode: z.literal("declared"),
            length: z.enum(["mm", "cm", "m", "in"]),
          })
          .strict(),
      ]),
      healing: z.object({ mode: z.literal("none") }).strict(),
      expected: z.literal("single-solid"),
    })
    .strict()
    .superRefine((node, context) => {
      if (node.format === "step" && node.units.mode !== "from-file") {
        context.addIssue({
          code: "custom",
          path: ["units"],
          message: "STEP imports must read length units from the source file",
        });
      } else if (
        node.format !== "step" &&
        node.units.mode !== "declared"
      ) {
        context.addIssue({
          code: "custom",
          path: ["units"],
          message: "BREP imports require explicitly declared length units",
        });
      }
    });

  const partSchema = z
    .object({
      kind: z.literal("part"),
      geometry: solidOrBodySetRef,
      partNumber: z.string().optional(),
      description: z.string().optional(),
      material: z.string().optional(),
      materialId: IdSchema.optional(),
      massDensity: ExpressionV7Schema.optional(),
      metadata: ProtocolJsonRecordV7Schema.optional(),
    })
    .strict();

  const occurrenceConfigurationSchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("inherit") }).strict(),
    z.object({ mode: z.literal("base") }).strict(),
    z
      .object({
        mode: z.literal("named"),
        id: IdSchema,
      })
      .strict(),
  ]);
  const assemblyComponentSchema = z.discriminatedUnion("source", [
    z
      .object({
        source: z.literal("local"),
        reference: partOrAssemblyRef,
      })
      .strict(),
    z
      .object({
        source: z.literal("external"),
        resource: IdSchema,
        output: IdSchema,
        outputKind: z.enum(["part", "assembly"]),
      })
      .strict(),
  ]);
  const assemblySchema = z
    .object({
      kind: z.literal("assembly"),
      instances: z.array(
        z
          .object({
            id: IdSchema,
            component: assemblyComponentSchema,
            configuration: occurrenceConfigurationSchema,
            placement: z.array(TransformOperationV7Schema),
            suppressed: z.boolean(),
          })
          .strict(),
      ),
    })
    .strict()
    .superRefine((node, context) => {
      const seen = new Set<string>();
      node.instances.forEach((instance, index) => {
        if (seen.has(instance.id)) {
          context.addIssue({
            code: "custom",
            path: ["instances", index, "id"],
            message: `Assembly occurrence ID '${instance.id}' is duplicated`,
          });
        }
        seen.add(instance.id);
      });
    });

  const schemas = [
    z
      .object({
        kind: z.literal("box"),
        size: Vec3ExpressionV7Schema,
        center: z.boolean(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("cylinder"),
        height: ExpressionV7Schema,
        radiusBottom: ExpressionV7Schema,
        radiusTop: ExpressionV7Schema,
        center: z.boolean(),
        segments: z.number().int().min(3).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sphere"),
        radius: ExpressionV7Schema,
        segments: z.number().int().min(4).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sketch"),
        plane: PlaneV7Schema,
        entities: z.record(IdSchema, EntityV7Schema),
        constraints: z.record(IdSchema, ConstraintV7Schema),
        profile: z
          .object({
            outer: LoopV7Schema,
            holes: z.array(LoopV7Schema),
          })
          .strict(),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("polylinePath"),
        points: z.array(Vec3ExpressionV7Schema).min(2),
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("circularArcPath"),
        start: Vec3ExpressionV7Schema,
        through: Vec3ExpressionV7Schema,
        end: Vec3ExpressionV7Schema,
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("compositePath"),
        start: Vec3ExpressionV7Schema,
        segments: z
          .array(
            z.discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("line"),
                  end: Vec3ExpressionV7Schema,
                })
                .strict(),
              z
                .object({
                  kind: z.literal("circularArc"),
                  through: Vec3ExpressionV7Schema,
                  end: Vec3ExpressionV7Schema,
                })
                .strict(),
            ]),
          )
          .min(2),
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("extrude"),
        profile: profileRef,
        distance: ExpressionV7Schema,
        symmetric: z.boolean(),
        twist: ExpressionV7Schema,
        scaleTop: Vec2ExpressionV7Schema,
        divisions: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("revolve"),
        profile: profileRef,
        angle: ExpressionV7Schema,
        segments: z.number().int().min(3).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("loft"),
        profiles: z.array(profileRef).min(2),
        ruled: z.literal(true),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sweep"),
        profile: profileRef,
        path: pathRef,
        transition: z.literal("right-corner"),
        frame: z.literal("corrected-frenet"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("boolean"),
        operation: z.enum(["union", "subtract", "intersect"]),
        target: solidRef,
        tools: z.array(solidRef).min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("transform"),
        input: solidRef,
        operations: z.array(TransformOperationV7Schema).min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("fillet"),
        input: solidRef,
        edges: TopologySelectionV7Schema,
        radius: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("chamfer"),
        input: solidRef,
        edges: TopologySelectionV7Schema,
        distance: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("shell"),
        input: solidRef,
        openings: TopologySelectionV7Schema,
        thickness: ExpressionV7Schema,
        direction: z.enum(SHELL_DIRECTIONS),
        tolerance: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("offset"),
        input: solidRef,
        distance: ExpressionV7Schema,
        direction: z.enum(OFFSET_DIRECTIONS),
        tolerance: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("draft"),
        input: solidRef,
        faces: TopologySelectionV7Schema,
        angle: ExpressionV7Schema,
        pullDirection: Vec3ExpressionV7Schema,
        neutralPlane: z
          .object({
            origin: Vec3ExpressionV7Schema,
            normal: Vec3ExpressionV7Schema,
          })
          .strict(),
      })
      .strict(),
    partSchema,
    assemblySchema,
    z
      .object({
        kind: z.literal("datumPoint"),
        position: Vec3ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("datumAxis"),
        origin: Vec3ExpressionV7Schema,
        direction: Vec3ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("datumPlane"),
        origin: Vec3ExpressionV7Schema,
        xDirection: Vec3ExpressionV7Schema,
        normal: Vec3ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("coordinateSystem"),
        origin: Vec3ExpressionV7Schema,
        xDirection: Vec3ExpressionV7Schema,
        yDirection: Vec3ExpressionV7Schema,
      })
      .strict(),
    bodySetSchema,
    importedBodySchema,
  ] as const;

  const kinds = schemas.map((schema) => schema.shape.kind.value);
  if (
    kinds.length !== NODE_KINDS_V7.length ||
    new Set(kinds).size !== kinds.length ||
    NODE_KINDS_V7.some((kind) => !kinds.includes(kind))
  ) {
    throw new Error("Document-v7 node-kind grammar has no matching node schema");
  }
  return z.discriminatedUnion(
    "kind",
    schemas as unknown as Parameters<typeof z.discriminatedUnion>[1],
  ) as unknown as z.ZodType<NodeIRV7>;
}

export const NodeV7Schema: z.ZodType<NodeIRV7> = createNodeV7Schema();
/** Current document-v6 node schema. */
export const NodeSchema: z.ZodType<NodeIR> = NodeV6Schema;

const ConfigurationSchema = z
  .object({
    description: z.string().optional(),
    parameterOverrides: z
      .record(IdSchema, ExpressionSchema)
      .refine(
        (parameters) => Object.keys(parameters).length > 0,
        "Configuration parameter overrides cannot be empty; omit them instead",
      )
      .optional(),
    instanceSuppressions: z
      .record(
        IdSchema,
        z
          .record(
            IdSchema,
            z.boolean(),
          )
          .refine(
            (instances) => Object.keys(instances).length > 0,
            "Configuration assembly instance overrides cannot be empty",
          ),
      )
      .refine(
        (assemblies) => Object.keys(assemblies).length > 0,
        "Configuration assembly overrides cannot be empty; omit them instead",
      )
      .optional(),
    partMaterialOverrides: z
      .record(IdSchema, IdSchema)
      .refine(
        (parts) => Object.keys(parts).length > 0,
        "Configuration part material overrides cannot be empty; omit them instead",
      )
      .optional(),
    metadata: z.record(z.string(), z.json()).optional(),
  })
  .strict()
  .refine(
    (configuration) =>
      configuration.parameterOverrides !== undefined ||
      configuration.instanceSuppressions !== undefined ||
      configuration.partMaterialOverrides !== undefined,
    "A configuration requires at least one override",
  );

const ConfigurationV7Schema = z
  .object({
    description: z.string().optional(),
    parameterOverrides: z
      .record(IdSchema, ExpressionV7Schema)
      .refine(
        (parameters) => Object.keys(parameters).length > 0,
        "Configuration parameter overrides cannot be empty; omit them instead",
      )
      .optional(),
    instanceSuppressions: z
      .record(
        IdSchema,
        z
          .record(IdSchema, z.boolean())
          .refine(
            (instances) => Object.keys(instances).length > 0,
            "Configuration assembly instance overrides cannot be empty",
          ),
      )
      .refine(
        (assemblies) => Object.keys(assemblies).length > 0,
        "Configuration assembly overrides cannot be empty; omit them instead",
      )
      .optional(),
    partMaterialOverrides: z
      .record(IdSchema, IdSchema)
      .refine(
        (parts) => Object.keys(parts).length > 0,
        "Configuration part material overrides cannot be empty; omit them instead",
      )
      .optional(),
    metadata: ProtocolJsonRecordV7Schema.optional(),
  })
  .strict()
  .refine(
    (configuration) =>
      configuration.parameterOverrides !== undefined ||
      configuration.instanceSuppressions !== undefined ||
      configuration.partMaterialOverrides !== undefined,
    "A configuration requires at least one override",
  );

const DocumentNameSchema = z.string().min(1);
const DocumentUnitsSchema = z.object({
  length: z.literal("mm"),
  angle: z.literal("rad"),
  mass: z.literal("kg").optional(),
});
const DocumentParametersSchema = z.record(
  z.string(),
  z.object({
    dimension: DimensionSchema,
    default: ExpressionSchema,
    min: ExpressionSchema.optional(),
    max: ExpressionSchema.optional(),
    label: z.string().optional(),
    description: z.string().optional(),
  }),
);
const DocumentMaterialsSchema = z
  .record(
    IdSchema,
    z.object({
      name: z
        .string()
        .min(1)
        .refine(
          (value) => value.trim().length > 0,
          "Material name cannot be blank",
        ),
      description: z.string().optional(),
      massDensity: ExpressionSchema,
      metadata: z.record(z.string(), z.json()).optional(),
    }),
  )
  .refine(
    (materials) => Object.keys(materials).length > 0,
    "Material registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentConfigurationsSchema = z
  .record(IdSchema, ConfigurationSchema)
  .refine(
    (configurations) => Object.keys(configurations).length > 0,
    "Configuration registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentUnitsV7Schema = z
  .object({
    length: z.literal("mm"),
    angle: z.literal("rad"),
    mass: z.literal("kg").optional(),
  })
  .strict();
const DocumentParametersV7Schema = z.record(
  IdSchema,
  z
    .object({
      dimension: DimensionSchema,
      default: ExpressionV7Schema,
      min: ExpressionV7Schema.optional(),
      max: ExpressionV7Schema.optional(),
      label: z.string().optional(),
      description: z.string().optional(),
    })
    .strict(),
);
const DocumentMaterialsV7Schema = z
  .record(
    IdSchema,
    z
      .object({
        name: z
          .string()
          .min(1)
          .refine(
            (value) => value.trim().length > 0,
            "Material name cannot be blank",
          ),
        description: z.string().optional(),
        massDensity: ExpressionV7Schema,
        metadata: ProtocolJsonRecordV7Schema.optional(),
      })
      .strict(),
  )
  .refine(
    (materials) => Object.keys(materials).length > 0,
    "Material registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentConfigurationsV7Schema = z
  .record(IdSchema, ConfigurationV7Schema)
  .refine(
    (configurations) => Object.keys(configurations).length > 0,
    "Configuration registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentOutputsSchema = z.record(z.string(), DesignOutputRefSchema);
const DocumentOutputsV7Schema = z.record(IdSchema, DesignOutputRefV7Schema);
const DocumentMetadataSchema = z.record(z.string(), z.json()).optional();
const DocumentMetadataV7Schema = ProtocolJsonRecordV7Schema.optional();
const DocumentResourcesV7Schema = z
  .record(
    IdSchema,
    z
      .object({
        digest: z
          .string()
          .regex(/^sha256:[0-9a-f]{64}$/, "Resource digest must be lowercase SHA-256"),
        byteLength: z.number().int().nonnegative().safe(),
        mediaType: z
          .string()
          .min(1)
          .refine(
            (value) =>
              value.trim() === value &&
              /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$/.test(
                value,
              ),
            "Resource mediaType must be a non-empty MIME type",
          ),
        locations: z
          .array(z.string().min(1))
          .min(1)
          .refine(
            (locations) => new Set(locations).size === locations.length,
            "Resource locations cannot contain duplicates",
          )
          .optional(),
        metadata: ProtocolJsonRecordV7Schema.optional(),
      })
      .strict(),
  )
  .refine(
    (resources) => Object.keys(resources).length > 0,
    "Resource registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV2Schema = z
  .record(IdSchema, TopologyReferenceEntryV2Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV3Schema = z
  .record(IdSchema, TopologyReferenceEntryV3Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV4Schema = z
  .record(IdSchema, TopologyReferenceEntryV4Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV5Schema = z
  .record(IdSchema, TopologyReferenceEntryV5Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV6Schema = z
  .record(IdSchema, TopologyReferenceEntryV6Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV7Schema = z
  .record(IdSchema, TopologyReferenceEntryV7Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();

const DesignDocumentBodyShapeV1 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV1Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
} as const;

const DesignDocumentBodyShapeV2 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV2Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV2Schema,
} as const;

const DesignDocumentBodyShapeV3 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV3Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV3Schema,
} as const;

const DesignDocumentBodyShapeV4 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV4Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV4Schema,
} as const;

const DesignDocumentBodyShapeV5 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV5Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV5Schema,
} as const;

const DesignDocumentBodyShapeV6 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV6Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV6Schema,
} as const;

const DesignDocumentBodyShapeV7 = {
  name: DocumentNameSchema,
  units: DocumentUnitsV7Schema,
  parameters: DocumentParametersV7Schema,
  materials: DocumentMaterialsV7Schema,
  configurations: DocumentConfigurationsV7Schema,
  resources: DocumentResourcesV7Schema,
  nodes: z.record(IdSchema, NodeV7Schema),
  outputs: DocumentOutputsV7Schema,
  metadata: DocumentMetadataV7Schema,
  topologyReferences: DocumentTopologyReferencesV7Schema,
} as const;

export const DesignDocumentV1Schema: z.ZodType<DesignDocumentV1> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V1),
    version: z.literal(DOCUMENT_VERSION_V1),
    ...DesignDocumentBodyShapeV1,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV1>;

export const DesignDocumentV2Schema: z.ZodType<DesignDocumentV2> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V2),
    version: z.literal(DOCUMENT_VERSION_V2),
    ...DesignDocumentBodyShapeV2,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV2>;

export const DesignDocumentV3Schema: z.ZodType<DesignDocumentV3> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V3),
    version: z.literal(DOCUMENT_VERSION_V3),
    ...DesignDocumentBodyShapeV3,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV3>;

export const DesignDocumentV4Schema: z.ZodType<DesignDocumentV4> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V4),
    version: z.literal(DOCUMENT_VERSION_V4),
    ...DesignDocumentBodyShapeV4,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV4>;

export const DesignDocumentV5Schema: z.ZodType<DesignDocumentV5> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V5),
    version: z.literal(DOCUMENT_VERSION_V5),
    ...DesignDocumentBodyShapeV5,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV5>;

export const DesignDocumentV6Schema: z.ZodType<DesignDocumentV6> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V6),
    version: z.literal(DOCUMENT_VERSION_V6),
    ...DesignDocumentBodyShapeV6,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV6>;

/**
 * Staged v7 schema. It is intentionally not part of DesignDocumentSchema until
 * every ordinary public document consumer supports v7.
 */
export const DesignDocumentV7Schema: z.ZodType<DesignDocumentV7> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V7),
    version: z.literal(DOCUMENT_VERSION_V7),
    ...DesignDocumentBodyShapeV7,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV7>;

export const DesignDocumentSchema: z.ZodType<DesignDocument> = z.union([
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
  DesignDocumentV6Schema,
]) as z.ZodType<DesignDocument>;
