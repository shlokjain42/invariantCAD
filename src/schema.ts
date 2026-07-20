import { z } from "zod";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  NODE_KINDS_V1,
  NODE_KINDS_V2,
  NODE_KINDS_V3,
  NODE_KINDS_V4,
  NODE_KINDS_V5,
  type DesignDocument,
  type DesignDocumentV1,
  type DesignDocumentV2,
  type DesignDocumentV3,
  type DesignDocumentV4,
  type DesignDocumentV5,
  type NodeIR,
  type NodeIRV1,
  type NodeIRV2,
  type NodeIRV3,
  type NodeIRV4,
  type NodeIRV5,
  type TopologyReferenceEntryIR,
  type TopologyReferenceEntryIRV2,
  type TopologyReferenceEntryIRV3,
  type TopologyReferenceEntryIRV4,
  type TopologyReferenceEntryIRV5,
  type TopologyQueryIR,
  type TopologyQueryIRFor,
  type TopologyQueryIRV1,
  type TopologyQueryIRV2,
  type TopologyQueryIRV3,
  type TopologyQueryIRV4,
  type TopologyQueryIRV5,
  type TopologySelectionIR,
  type TopologySelectionIRFor,
  type TopologySelectionIRV1,
  type TopologySelectionIRV2,
  type TopologySelectionIRV3,
  type TopologySelectionIRV4,
  type TopologySelectionIRV5,
} from "./ir.js";
import type { ExpressionIR } from "./expressions.js";
import {
  TOPOLOGY_ROLES_V1,
  TOPOLOGY_ROLES_V2,
  TOPOLOGY_ROLES_V3,
  TOPOLOGY_ROLES_V4,
  TOPOLOGY_ROLES_V5,
  type TopologyRole,
  type TopologyRoleV1,
  type TopologyRoleV2,
  type TopologyRoleV3,
  type TopologyRoleV4,
  type TopologyRoleV5,
} from "./protocol/topology.js";
import { SHELL_DIRECTIONS } from "./protocol/shell.js";
import { OFFSET_DIRECTIONS } from "./protocol/offset.js";
import {
  normalizePersistentTopologyReference,
  type PersistentTopologyReference,
  type PersistentTopologyReferenceV2,
  type PersistentTopologyReferenceV3,
  type PersistentTopologyReferenceV4,
  type PersistentTopologyReferenceV5,
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

const Vec2ExpressionSchema = z.tuple([ExpressionSchema, ExpressionSchema]);
const Vec3ExpressionSchema = z.tuple([
  ExpressionSchema,
  ExpressionSchema,
  ExpressionSchema,
]);

const RefSchema = z.object({
  node: z.string(),
  kind: z.enum(["profile", "path", "solid", "part", "assembly"]),
});

const DesignOutputRefSchema = z.object({
  node: z.string(),
  kind: z.enum(["solid", "part", "assembly"]),
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

type DiscriminatedUnionVariants = Parameters<
  typeof z.discriminatedUnion
>[1];

function createTopologySchemas<
  AllowPersistent extends boolean,
  R extends TopologyRole,
>(
  allowPersistent: AllowPersistent,
  roles: readonly R[],
): {
  readonly query: z.ZodType<TopologyQueryIRFor<AllowPersistent, R>>;
  readonly selection: z.ZodType<
    TopologySelectionIRFor<"face" | "edge", AllowPersistent, R>
  >;
} {
  let selectionSchema!: z.ZodType<
    TopologySelectionIRFor<"face" | "edge", AllowPersistent, R>
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
          feature: z.string(),
          relation: z.enum(["created", "modified"]),
          role: z.enum(roles as [R, ...R[]]).optional(),
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
  }) as z.ZodType<TopologyQueryIRFor<AllowPersistent, R>>;

  selectionSchema = z.lazy(() =>
    z
      .object({
        topology: z.enum(["face", "edge"]),
        query: querySchema,
        cardinality: TopologyCardinalitySchema,
      })
      .strict(),
  ) as z.ZodType<
    TopologySelectionIRFor<"face" | "edge", AllowPersistent, R>
  >;
  return { query: querySchema, selection: selectionSchema };
}

const topologySchemasV1 = createTopologySchemas<false, TopologyRoleV1>(
  false,
  TOPOLOGY_ROLES_V1,
);
const topologySchemasV2 = createTopologySchemas<boolean, TopologyRoleV2>(
  true,
  TOPOLOGY_ROLES_V2,
);
const topologySchemasV3 = createTopologySchemas<boolean, TopologyRoleV3>(
  true,
  TOPOLOGY_ROLES_V3,
);
const topologySchemasV4 = createTopologySchemas<boolean, TopologyRoleV4>(
  true,
  TOPOLOGY_ROLES_V4,
);
const topologySchemasV5 = createTopologySchemas<boolean, TopologyRoleV5>(
  true,
  TOPOLOGY_ROLES_V5,
);

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

/** Current document-v5 topology query schema. */
export const TopologyQuerySchema: z.ZodType<TopologyQueryIR> =
  TopologyQueryV5Schema;
/** Current document-v5 topology selection schema. */
export const TopologySelectionSchema: z.ZodType<TopologySelectionIR> =
  TopologySelectionV5Schema;

/**
 * The transform is intentionally the topology-signature implementation's
 * defensive copier rather than a second, drifting structural grammar here.
 * The document-version role check happens only after that defensive copy.
 */
function createPersistentTopologyReferenceSchema<R extends TopologyRole>(
  roles: readonly R[],
): z.ZodType<PersistentTopologyReference<"face" | "edge", R>> {
  const allowedRoles = new Set<TopologyRole>(roles);
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
    return normalized.value as PersistentTopologyReference<
      "face" | "edge",
      R
    >;
  }) as z.ZodType<PersistentTopologyReference<"face" | "edge", R>>;
}

export const PersistentTopologyReferenceV2Schema: z.ZodType<PersistentTopologyReferenceV2> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V2,
  ) as z.ZodType<PersistentTopologyReferenceV2>;
export const PersistentTopologyReferenceV3Schema: z.ZodType<PersistentTopologyReferenceV3> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V3,
  ) as z.ZodType<PersistentTopologyReferenceV3>;
export const PersistentTopologyReferenceV4Schema: z.ZodType<PersistentTopologyReferenceV4> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V4,
  ) as z.ZodType<PersistentTopologyReferenceV4>;
export const PersistentTopologyReferenceV5Schema: z.ZodType<PersistentTopologyReferenceV5> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V5,
  ) as z.ZodType<PersistentTopologyReferenceV5>;
/** Current document-v5 persistent topology evidence schema. */
export const PersistentTopologyReferenceSchema: z.ZodType<PersistentTopologyReference> =
  PersistentTopologyReferenceV5Schema;

const SolidRefSchema = z
  .object({
    node: z.string(),
    kind: z.literal("solid"),
  })
  .strict();

function createTopologyReferenceEntrySchema<R extends TopologyRole>(
  referenceSchema: z.ZodType<
    PersistentTopologyReference<"face" | "edge", R>
  >,
): z.ZodType<TopologyReferenceEntryIR<"face" | "edge", R>> {
  return z
    .object({
      target: SolidRefSchema,
      topology: z.enum(["face", "edge"]),
      variants: z.array(referenceSchema).min(1),
    })
    .strict()
    .superRefine((entry, context) => {
      const fingerprints = new Set<string>();
      entry.variants.forEach((variant, index) => {
        if (variant.topology !== entry.topology) {
          context.addIssue({
            code: "custom",
            message: `Topology reference variant selects ${variant.topology}s, not ${entry.topology}s`,
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
    TopologyReferenceEntryIR<"face" | "edge", R>
  >;
}

export const TopologyReferenceEntryV2Schema: z.ZodType<TopologyReferenceEntryIRV2> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV2Schema,
  ) as z.ZodType<TopologyReferenceEntryIRV2>;
export const TopologyReferenceEntryV3Schema: z.ZodType<TopologyReferenceEntryIRV3> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV3Schema,
  ) as z.ZodType<TopologyReferenceEntryIRV3>;
export const TopologyReferenceEntryV4Schema: z.ZodType<TopologyReferenceEntryIRV4> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV4Schema,
  ) as z.ZodType<TopologyReferenceEntryIRV4>;
export const TopologyReferenceEntryV5Schema: z.ZodType<TopologyReferenceEntryIRV5> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV5Schema,
  ) as z.ZodType<TopologyReferenceEntryIRV5>;
/** Current document-v5 topology-reference registry entry schema. */
export const TopologyReferenceEntrySchema: z.ZodType<TopologyReferenceEntryIR> =
  TopologyReferenceEntryV5Schema;

type VersionedNodeKind =
  | NodeIRV1["kind"]
  | NodeIRV2["kind"]
  | NodeIRV3["kind"]
  | NodeIRV4["kind"]
  | NodeIRV5["kind"];

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
/** Current document-v5 node schema. */
export const NodeSchema: z.ZodType<NodeIR> = NodeV5Schema;

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
const DocumentOutputsSchema = z.record(z.string(), DesignOutputRefSchema);
const DocumentMetadataSchema = z.record(z.string(), z.json()).optional();
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

export const DesignDocumentSchema: z.ZodType<DesignDocument> = z.union([
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
]) as z.ZodType<DesignDocument>;
