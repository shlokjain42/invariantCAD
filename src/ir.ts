import type {
  ConfigurationId,
  EntityId,
  MaterialId,
  NodeId,
  ParameterId,
  TopologyReferenceId,
} from "./core/ids.js";
import type { JsonValue } from "./core/json.js";
import {
  expressionDependencies,
  type Dimension,
  type ExpressionIR,
} from "./expressions.js";
import type {
  TopologyKind,
  TopologyKindV1,
  TopologyRole,
  TopologyRoleV1,
  TopologyRoleV2,
  TopologyRoleV3,
  TopologyRoleV4,
  TopologyRoleV5,
  TopologyRoleV6,
} from "./protocol/topology.js";
import type { ShellDirection } from "./protocol/shell.js";
import type { OffsetDirection } from "./protocol/offset.js";
import type { SweepFrame, SweepTransition } from "./protocol/sweep.js";
import type {
  PersistentTopologyReference,
  PersistentTopologyReferenceProtocolV1,
} from "./topology-signatures.js";

export const DOCUMENT_SCHEMA_V1 =
  "https://invariantcad.dev/schema/document/v1" as const;
export const DOCUMENT_VERSION_V1 = 1 as const;
export const DOCUMENT_SCHEMA_V2 =
  "https://invariantcad.dev/schema/document/v2" as const;
export const DOCUMENT_VERSION_V2 = 2 as const;
export const DOCUMENT_SCHEMA_V3 =
  "https://invariantcad.dev/schema/document/v3" as const;
export const DOCUMENT_VERSION_V3 = 3 as const;
export const DOCUMENT_SCHEMA_V4 =
  "https://invariantcad.dev/schema/document/v4" as const;
export const DOCUMENT_VERSION_V4 = 4 as const;
export const DOCUMENT_SCHEMA_V5 =
  "https://invariantcad.dev/schema/document/v5" as const;
export const DOCUMENT_VERSION_V5 = 5 as const;
export const DOCUMENT_SCHEMA_V6 =
  "https://invariantcad.dev/schema/document/v6" as const;
export const DOCUMENT_VERSION_V6 = 6 as const;

/** Schema emitted by the current authoring API. */
export const DOCUMENT_SCHEMA = DOCUMENT_SCHEMA_V6;
/** Version emitted by the current authoring API. */
export const DOCUMENT_VERSION = DOCUMENT_VERSION_V6;

/** Node discriminants accepted by the original document-v1 grammar. */
export const NODE_KINDS_V1 = Object.freeze([
  "box",
  "cylinder",
  "sphere",
  "sketch",
  "polylinePath",
  "circularArcPath",
  "compositePath",
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "boolean",
  "transform",
  "fillet",
  "chamfer",
  "shell",
  "offset",
  "draft",
  "part",
  "assembly",
] as const);
/** Node discriminants accepted by the frozen document-v2 grammar. */
export const NODE_KINDS_V2 = Object.freeze([
  "box",
  "cylinder",
  "sphere",
  "sketch",
  "polylinePath",
  "circularArcPath",
  "compositePath",
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "boolean",
  "transform",
  "fillet",
  "chamfer",
  "shell",
  "offset",
  "draft",
  "part",
  "assembly",
] as const);
/** Node discriminants accepted by the frozen document-v3 grammar. */
export const NODE_KINDS_V3 = Object.freeze([
  "box",
  "cylinder",
  "sphere",
  "sketch",
  "polylinePath",
  "circularArcPath",
  "compositePath",
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "boolean",
  "transform",
  "fillet",
  "chamfer",
  "shell",
  "offset",
  "draft",
  "part",
  "assembly",
] as const);
/** Node discriminants accepted by the frozen document-v4 grammar. */
export const NODE_KINDS_V4 = Object.freeze([
  "box",
  "cylinder",
  "sphere",
  "sketch",
  "polylinePath",
  "circularArcPath",
  "compositePath",
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "boolean",
  "transform",
  "fillet",
  "chamfer",
  "shell",
  "offset",
  "draft",
  "part",
  "assembly",
] as const);
/** Node discriminants accepted by the frozen document-v5 grammar. */
export const NODE_KINDS_V5 = Object.freeze([
  "box",
  "cylinder",
  "sphere",
  "sketch",
  "polylinePath",
  "circularArcPath",
  "compositePath",
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "boolean",
  "transform",
  "fillet",
  "chamfer",
  "shell",
  "offset",
  "draft",
  "part",
  "assembly",
] as const);
/** Document v6 does not expand the node-kind vocabulary. */
export const NODE_KINDS_V6 = NODE_KINDS_V5;
/** Node discriminants accepted by the current authoring grammar. */
export const NODE_KINDS = NODE_KINDS_V6;

export type NodeKindV1 = (typeof NODE_KINDS_V1)[number];
export type NodeKindV2 = (typeof NODE_KINDS_V2)[number];
export type NodeKindV3 = (typeof NODE_KINDS_V3)[number];
export type NodeKindV4 = (typeof NODE_KINDS_V4)[number];
export type NodeKindV5 = (typeof NODE_KINDS_V5)[number];
export type NodeKindV6 = (typeof NODE_KINDS_V6)[number];
/** Current node discriminant vocabulary. */
export type NodeKind = NodeKindV6;

export type OutputKind = "profile" | "path" | "solid" | "part" | "assembly";
export type DesignOutputKind = Exclude<OutputKind, "profile" | "path">;

export interface RefIR<K extends OutputKind = OutputKind> {
  readonly node: NodeId;
  readonly kind: K;
}

export interface ParameterIR {
  readonly dimension: Dimension;
  readonly default: ExpressionIR;
  readonly min?: ExpressionIR;
  readonly max?: ExpressionIR;
  readonly label?: string;
  readonly description?: string;
}

/** A document-owned material definition. No property is inferred from its name. */
export interface MaterialDefinitionIR {
  readonly name: string;
  readonly description?: string;
  /** Explicit physical density expression in kg/mm^3. */
  readonly massDensity: ExpressionIR;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/** Definition-targeted overrides selected together as one named design variant. */
export interface DesignConfigurationIR {
  readonly description?: string;
  readonly parameterOverrides?: Readonly<Record<ParameterId, ExpressionIR>>;
  readonly instanceSuppressions?: Readonly<
    Record<NodeId, Readonly<Record<EntityId, boolean>>>
  >;
  readonly partMaterialOverrides?: Readonly<Record<NodeId, MaterialId>>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export type Vec2ExpressionIR = readonly [ExpressionIR, ExpressionIR];
export type Vec3ExpressionIR = readonly [
  ExpressionIR,
  ExpressionIR,
  ExpressionIR,
];

export type PrincipalPlane = "XY" | "XZ" | "YZ";

export interface PlaneIR {
  readonly type: "principal";
  readonly plane: PrincipalPlane;
  readonly origin: Vec3ExpressionIR;
}

export interface PointEntityIR {
  readonly kind: "point";
  readonly x: ExpressionIR;
  readonly y: ExpressionIR;
}

export interface LineEntityIR {
  readonly kind: "line";
  readonly start: EntityId;
  readonly end: EntityId;
}

export interface CircleEntityIR {
  readonly kind: "circle";
  readonly center: EntityId;
  readonly radius: ExpressionIR;
  readonly segments?: number;
}

export interface ArcEntityIR {
  readonly kind: "arc";
  readonly center: EntityId;
  readonly radius: ExpressionIR;
  readonly startAngle: ExpressionIR;
  readonly endAngle: ExpressionIR;
  readonly clockwise: boolean;
  readonly segments?: number;
}

export type SketchEntityIR =
  | PointEntityIR
  | LineEntityIR
  | CircleEntityIR
  | ArcEntityIR;

export type SketchConstraintIR =
  | {
      readonly kind: "coincident";
      readonly first: EntityId;
      readonly second: EntityId;
    }
  | {
      readonly kind: "horizontal" | "vertical" | "fixed";
      readonly entity: EntityId;
    }
  | {
      readonly kind: "distance" | "distanceX" | "distanceY";
      readonly first: EntityId;
      readonly second: EntityId;
      readonly value: ExpressionIR;
    }
  | {
      readonly kind: "length";
      readonly entity: EntityId;
      readonly value: ExpressionIR;
    }
  | {
      readonly kind: "parallel" | "perpendicular" | "equalLength";
      readonly first: EntityId;
      readonly second: EntityId;
    }
  | {
      readonly kind: "angle";
      readonly first: EntityId;
      readonly second: EntityId;
      readonly value: ExpressionIR;
    }
  | {
      readonly kind: "radius" | "diameter";
      readonly entity: EntityId;
      readonly value: ExpressionIR;
    }
  | {
      readonly kind: "equalRadius";
      readonly first: EntityId;
      readonly second: EntityId;
    }
  | {
      readonly kind: "midpoint";
      readonly point: EntityId;
      readonly line: EntityId;
    }
  | {
      readonly kind: "tangent";
      readonly line: EntityId;
      readonly circle: EntityId;
    };

export interface EdgeUseIR {
  readonly entity: EntityId;
  readonly reversed?: boolean;
}

export type SketchLoopIR =
  | {
      readonly kind: "edges";
      readonly edges: readonly EdgeUseIR[];
    }
  | {
      readonly kind: "circle";
      readonly entity: EntityId;
      readonly reversed?: boolean;
    };

export interface SketchProfileIR {
  readonly outer: SketchLoopIR;
  readonly holes: readonly SketchLoopIR[];
}

export interface BoxNodeIR {
  readonly kind: "box";
  readonly size: Vec3ExpressionIR;
  readonly center: boolean;
}

export interface CylinderNodeIR {
  readonly kind: "cylinder";
  readonly height: ExpressionIR;
  readonly radiusBottom: ExpressionIR;
  readonly radiusTop: ExpressionIR;
  readonly center: boolean;
  readonly segments?: number;
}

export interface SphereNodeIR {
  readonly kind: "sphere";
  readonly radius: ExpressionIR;
  readonly segments?: number;
}

export interface SketchNodeIR {
  readonly kind: "sketch";
  readonly plane: PlaneIR;
  readonly entities: Readonly<Record<EntityId, SketchEntityIR>>;
  readonly constraints: Readonly<Record<EntityId, SketchConstraintIR>>;
  readonly profile: SketchProfileIR;
  readonly tolerance: number;
}

export interface PolylinePathNodeIR {
  readonly kind: "polylinePath";
  readonly points: readonly Vec3ExpressionIR[];
  readonly closed: false;
  readonly tolerance: number;
}

export interface CircularArcPathNodeIR {
  readonly kind: "circularArcPath";
  readonly start: Vec3ExpressionIR;
  readonly through: Vec3ExpressionIR;
  readonly end: Vec3ExpressionIR;
  readonly closed: false;
  readonly tolerance: number;
}

export interface CompositeLinePathSegmentIR {
  readonly kind: "line";
  /** The start is the preceding segment endpoint, or the path start. */
  readonly end: Vec3ExpressionIR;
}

export interface CompositeCircularArcPathSegmentIR {
  readonly kind: "circularArc";
  /** Authored interior point selecting the exact oriented arc. */
  readonly through: Vec3ExpressionIR;
  /** The start is the preceding segment endpoint, or the path start. */
  readonly end: Vec3ExpressionIR;
}

export type CompositePathSegmentIR =
  | CompositeLinePathSegmentIR
  | CompositeCircularArcPathSegmentIR;

export interface CompositePathNodeIR {
  readonly kind: "compositePath";
  readonly start: Vec3ExpressionIR;
  /** Ordered exact segments whose starts are structurally connected. */
  readonly segments: readonly CompositePathSegmentIR[];
  readonly closed: false;
  readonly tolerance: number;
}

export interface ExtrudeNodeIR {
  readonly kind: "extrude";
  readonly profile: RefIR<"profile">;
  readonly distance: ExpressionIR;
  readonly symmetric: boolean;
  readonly twist: ExpressionIR;
  readonly scaleTop: readonly [ExpressionIR, ExpressionIR];
  readonly divisions: number;
}

export interface RevolveNodeIR {
  readonly kind: "revolve";
  readonly profile: RefIR<"profile">;
  readonly angle: ExpressionIR;
  readonly segments?: number;
}

export interface LoftNodeIR {
  readonly kind: "loft";
  /** Ordered profile sections; the current document grammar requires at least two. */
  readonly profiles: readonly RefIR<"profile">[];
  /** The current document grammar supports ruled interpolation only. */
  readonly ruled: true;
}

export interface SweepNodeIR {
  readonly kind: "sweep";
  readonly profile: RefIR<"profile">;
  readonly path: RefIR<"path">;
  readonly transition: SweepTransition;
  readonly frame: SweepFrame;
}

export interface BooleanNodeIR {
  readonly kind: "boolean";
  readonly operation: "union" | "subtract" | "intersect";
  readonly target: RefIR<"solid">;
  readonly tools: readonly RefIR<"solid">[];
}

export type TransformOperationIR =
  | {
      readonly kind: "translate";
      readonly value: Vec3ExpressionIR;
    }
  | {
      readonly kind: "rotate";
      readonly value: Vec3ExpressionIR;
    }
  | {
      readonly kind: "scale";
      readonly value: Vec3ExpressionIR;
    }
  | {
      readonly kind: "mirror";
      readonly normal: Vec3ExpressionIR;
    };

export interface TransformNodeIR {
  readonly kind: "transform";
  readonly input: RefIR<"solid">;
  readonly operations: readonly TransformOperationIR[];
}

export type TopologyOriginRelation = "created" | "modified";

export interface TopologySourceIR {
  readonly kind: "sketch-entity";
  readonly sketch: NodeId;
  readonly entity: EntityId;
}

export interface TopologyCardinalityIR {
  readonly min: number;
  readonly max?: number;
}

/**
 * Document-owned persistent evidence for one exact solid-node snapshot.
 * Variants represent the same design intent under distinct kernel descriptor
 * fingerprints; evaluation never falls back between fingerprints.
 */
export interface TopologyReferenceEntryIR<
  K extends TopologyKind = TopologyKind,
  R extends TopologyRole = TopologyRole,
> {
  readonly target: RefIR<"solid">;
  readonly topology: K;
  readonly variants: readonly PersistentTopologyReference<K, R>[];
}

export type TopologyReferenceEntryIRV2<
  K extends TopologyKindV1 = TopologyKindV1,
> = Omit<TopologyReferenceEntryIR<K, TopologyRoleV2>, "variants"> & {
  readonly variants: readonly PersistentTopologyReferenceProtocolV1<
    K,
    TopologyRoleV2
  >[];
};
export type TopologyReferenceEntryIRV3<
  K extends TopologyKindV1 = TopologyKindV1,
> = Omit<TopologyReferenceEntryIR<K, TopologyRoleV3>, "variants"> & {
  readonly variants: readonly PersistentTopologyReferenceProtocolV1<
    K,
    TopologyRoleV3
  >[];
};
export type TopologyReferenceEntryIRV4<
  K extends TopologyKindV1 = TopologyKindV1,
> = Omit<TopologyReferenceEntryIR<K, TopologyRoleV4>, "variants"> & {
  readonly variants: readonly PersistentTopologyReferenceProtocolV1<
    K,
    TopologyRoleV4
  >[];
};
export type TopologyReferenceEntryIRV5<
  K extends TopologyKindV1 = TopologyKindV1,
> = Omit<TopologyReferenceEntryIR<K, TopologyRoleV5>, "variants"> & {
  readonly variants: readonly PersistentTopologyReferenceProtocolV1<
    K,
    TopologyRoleV5
  >[];
};
export type TopologyReferenceEntryIRV6<
  K extends TopologyKind = TopologyKind,
> = TopologyReferenceEntryIR<K, TopologyRoleV6>;

/**
 * Version-aware topology query grammar. Persistent-reference atoms were added
 * in document v2 and are deliberately absent when `AllowPersistent` is false.
 */
declare const topologyQueryPersistentCapability: unique symbol;

export type TopologyQueryIRFor<
  AllowPersistent extends boolean,
  R extends TopologyRole = TopologyRole,
  AllowedTopology extends TopologyKind = TopologyKind,
> = {
  /** Type-only variance marker; never serialized into a document. */
  readonly [topologyQueryPersistentCapability]?: readonly [
    AllowPersistent,
    R,
    AllowedTopology,
  ];
} &
  (
    | { readonly op: "all" }
    | (AllowPersistent extends true
      ? {
          readonly op: "persistentReference";
          readonly reference: TopologyReferenceId;
        }
      : never)
    | {
        readonly op: "origin";
        readonly feature: NodeId;
        readonly relation: TopologyOriginRelation;
        readonly role?: R;
        readonly source?: TopologySourceIR;
      }
    | { readonly op: "surface"; readonly kind: string }
    | { readonly op: "curve"; readonly kind: string }
    | {
        readonly op: "normal" | "direction";
        readonly value: Vec3ExpressionIR;
        readonly tolerance: ExpressionIR;
      }
    | {
        readonly op: "radius";
        readonly value: ExpressionIR;
        readonly tolerance: ExpressionIR;
      }
    | ("vertex" extends AllowedTopology
        ? {
            readonly op: "position";
            readonly value: Vec3ExpressionIR;
            readonly tolerance: ExpressionIR;
          }
        : never)
    | {
        readonly op: "adjacentTo";
        readonly selection: TopologySelectionIRFor<
          AllowedTopology,
          AllowPersistent,
          R,
          AllowedTopology
        >;
      }
    | {
        readonly op: "and" | "or";
        readonly queries: readonly TopologyQueryIRFor<
          AllowPersistent,
          R,
          AllowedTopology
        >[];
      }
    | {
        readonly op: "not";
        readonly query: TopologyQueryIRFor<
          AllowPersistent,
          R,
          AllowedTopology
        >;
      }
  );

export interface TopologySelectionIRFor<
  K extends TopologyKind = TopologyKind,
  AllowPersistent extends boolean = boolean,
  R extends TopologyRole = TopologyRole,
  AllowedTopology extends TopologyKind = TopologyKind,
> {
  readonly topology: K;
  readonly query: TopologyQueryIRFor<AllowPersistent, R, AllowedTopology>;
  readonly cardinality: TopologyCardinalityIR;
}

/** Topology queries accepted by the original document-v1 grammar. */
export type TopologyQueryIRV1 = TopologyQueryIRFor<
  false,
  TopologyRoleV1,
  TopologyKindV1
>;
/** Topology queries accepted by the frozen document-v2 grammar. */
export type TopologyQueryIRV2 = TopologyQueryIRFor<
  boolean,
  TopologyRoleV2,
  TopologyKindV1
>;
/** Topology queries accepted by the frozen document-v3 grammar. */
export type TopologyQueryIRV3 = TopologyQueryIRFor<
  boolean,
  TopologyRoleV3,
  TopologyKindV1
>;
/** Topology queries accepted by the frozen document-v4 grammar. */
export type TopologyQueryIRV4 = TopologyQueryIRFor<
  boolean,
  TopologyRoleV4,
  TopologyKindV1
>;
/** Topology queries accepted by the frozen document-v5 grammar. */
export type TopologyQueryIRV5 = TopologyQueryIRFor<
  boolean,
  TopologyRoleV5,
  TopologyKindV1
>;
/** Topology queries accepted by the current document-v6 grammar. */
export type TopologyQueryIRV6 = TopologyQueryIRFor<
  boolean,
  TopologyRoleV6,
  TopologyKind
>;
/** Current topology query grammar. */
export type TopologyQueryIR = TopologyQueryIRV6;

export type TopologySelectionIRV1<
  K extends TopologyKindV1 = TopologyKindV1,
> = TopologySelectionIRFor<K, false, TopologyRoleV1, TopologyKindV1>;
export type TopologySelectionIRV2<
  K extends TopologyKindV1 = TopologyKindV1,
> = TopologySelectionIRFor<K, boolean, TopologyRoleV2, TopologyKindV1>;
export type TopologySelectionIRV3<
  K extends TopologyKindV1 = TopologyKindV1,
> = TopologySelectionIRFor<K, boolean, TopologyRoleV3, TopologyKindV1>;
export type TopologySelectionIRV4<
  K extends TopologyKindV1 = TopologyKindV1,
> = TopologySelectionIRFor<K, boolean, TopologyRoleV4, TopologyKindV1>;
export type TopologySelectionIRV5<
  K extends TopologyKindV1 = TopologyKindV1,
> = TopologySelectionIRFor<K, boolean, TopologyRoleV5, TopologyKindV1>;
export type TopologySelectionIRV6<
  K extends TopologyKind = TopologyKind,
> = TopologySelectionIRFor<K, boolean, TopologyRoleV6, TopologyKind>;
/** Current topology selection grammar. */
export type TopologySelectionIR<
  K extends TopologyKind = TopologyKind,
> = TopologySelectionIRV6<K>;

export interface FilletNodeIR {
  readonly kind: "fillet";
  readonly input: RefIR<"solid">;
  /** Seeds for maximal tangent-edge contours, not hard modification boundaries. */
  readonly edges: TopologySelectionIR<"edge">;
  readonly radius: ExpressionIR;
}

export interface ChamferNodeIR {
  readonly kind: "chamfer";
  readonly input: RefIR<"solid">;
  /** Seeds for maximal tangent-edge contours, not hard modification boundaries. */
  readonly edges: TopologySelectionIR<"edge">;
  readonly distance: ExpressionIR;
}

export interface ShellNodeIR {
  readonly kind: "shell";
  readonly input: RefIR<"solid">;
  /** Exact input faces removed as openings; unlike edge contours, no propagation occurs. */
  readonly openings: TopologySelectionIR<"face">;
  /** Positive wall-thickness magnitude. */
  readonly thickness: ExpressionIR;
  readonly direction: ShellDirection;
  readonly tolerance: ExpressionIR;
}

export interface OffsetNodeIR {
  readonly kind: "offset";
  readonly input: RefIR<"solid">;
  /** Positive normal-offset magnitude. */
  readonly distance: ExpressionIR;
  readonly direction: OffsetDirection;
  readonly tolerance: ExpressionIR;
}

export interface DraftNeutralPlaneIR {
  readonly origin: Vec3ExpressionIR;
  readonly normal: Vec3ExpressionIR;
}

export interface DraftNodeIR {
  readonly kind: "draft";
  readonly input: RefIR<"solid">;
  /** Exact input faces drafted together in one atomic operation. */
  readonly faces: TopologySelectionIR<"face">;
  /** Signed draft angle. */
  readonly angle: ExpressionIR;
  /** Scalar direction along which the drafted faces are pulled. */
  readonly pullDirection: Vec3ExpressionIR;
  /** Arbitrary plane whose intersection with the drafted faces remains fixed. */
  readonly neutralPlane: DraftNeutralPlaneIR;
}

export interface PartNodeIR {
  readonly kind: "part";
  readonly solid: RefIR<"solid">;
  readonly partNumber?: string;
  readonly description?: string;
  /** Legacy descriptive material label; never used as a catalogue lookup key. */
  readonly material?: string;
  /** Explicit reference to a document-owned material definition. */
  readonly materialId?: MaterialId;
  /** Explicit per-part density in kg/mm^3; overrides referenced material density. */
  readonly massDensity?: ExpressionIR;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface AssemblyInstanceIR {
  readonly id: EntityId;
  readonly component: RefIR<"part" | "assembly">;
  readonly placement: readonly TransformOperationIR[];
  readonly suppressed: boolean;
}

export interface AssemblyNodeIR {
  readonly kind: "assembly";
  readonly instances: readonly AssemblyInstanceIR[];
}

/** Nodes accepted by the frozen document-v3 grammar. */
export type NodeIRV3 =
  | BoxNodeIR
  | CylinderNodeIR
  | SphereNodeIR
  | SketchNodeIR
  | PolylinePathNodeIR
  | CircularArcPathNodeIR
  | CompositePathNodeIR
  | ExtrudeNodeIR
  | RevolveNodeIR
  | LoftNodeIR
  | SweepNodeIR
  | BooleanNodeIR
  | TransformNodeIR
  | FilletNodeIRV3
  | ChamferNodeIRV3
  | ShellNodeIRV3
  | OffsetNodeIR
  | DraftNodeIRV3
  | PartNodeIR
  | AssemblyNodeIR;

export type FilletNodeIRV1 = Omit<FilletNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV1<"edge">;
};
export type ChamferNodeIRV1 = Omit<ChamferNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV1<"edge">;
};
export type ShellNodeIRV1 = Omit<ShellNodeIR, "openings"> & {
  readonly openings: TopologySelectionIRV1<"face">;
};
export type DraftNodeIRV1 = Omit<DraftNodeIR, "faces"> & {
  readonly faces: TopologySelectionIRV1<"face">;
};

export type FilletNodeIRV2 = Omit<FilletNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV2<"edge">;
};
export type ChamferNodeIRV2 = Omit<ChamferNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV2<"edge">;
};
export type ShellNodeIRV2 = Omit<ShellNodeIR, "openings"> & {
  readonly openings: TopologySelectionIRV2<"face">;
};
export type DraftNodeIRV2 = Omit<DraftNodeIR, "faces"> & {
  readonly faces: TopologySelectionIRV2<"face">;
};

export type FilletNodeIRV3 = Omit<FilletNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV3<"edge">;
};
export type ChamferNodeIRV3 = Omit<ChamferNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV3<"edge">;
};
export type ShellNodeIRV3 = Omit<ShellNodeIR, "openings"> & {
  readonly openings: TopologySelectionIRV3<"face">;
};
export type DraftNodeIRV3 = Omit<DraftNodeIR, "faces"> & {
  readonly faces: TopologySelectionIRV3<"face">;
};

export type FilletNodeIRV4 = Omit<FilletNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV4<"edge">;
};
export type ChamferNodeIRV4 = Omit<ChamferNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV4<"edge">;
};
export type ShellNodeIRV4 = Omit<ShellNodeIR, "openings"> & {
  readonly openings: TopologySelectionIRV4<"face">;
};
export type DraftNodeIRV4 = Omit<DraftNodeIR, "faces"> & {
  readonly faces: TopologySelectionIRV4<"face">;
};

export type FilletNodeIRV5 = Omit<FilletNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV5<"edge">;
};
export type ChamferNodeIRV5 = Omit<ChamferNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV5<"edge">;
};
export type ShellNodeIRV5 = Omit<ShellNodeIR, "openings"> & {
  readonly openings: TopologySelectionIRV5<"face">;
};
export type DraftNodeIRV5 = Omit<DraftNodeIR, "faces"> & {
  readonly faces: TopologySelectionIRV5<"face">;
};

export type FilletNodeIRV6 = Omit<FilletNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV6<"edge">;
};
export type ChamferNodeIRV6 = Omit<ChamferNodeIR, "edges"> & {
  readonly edges: TopologySelectionIRV6<"edge">;
};
export type ShellNodeIRV6 = Omit<ShellNodeIR, "openings"> & {
  readonly openings: TopologySelectionIRV6<"face">;
};
export type DraftNodeIRV6 = Omit<DraftNodeIR, "faces"> & {
  readonly faces: TopologySelectionIRV6<"face">;
};

/** Nodes accepted by the frozen document-v4 grammar. */
export type NodeIRV4 =
  | BoxNodeIR
  | CylinderNodeIR
  | SphereNodeIR
  | SketchNodeIR
  | PolylinePathNodeIR
  | CircularArcPathNodeIR
  | CompositePathNodeIR
  | ExtrudeNodeIR
  | RevolveNodeIR
  | LoftNodeIR
  | SweepNodeIR
  | BooleanNodeIR
  | TransformNodeIR
  | FilletNodeIRV4
  | ChamferNodeIRV4
  | ShellNodeIRV4
  | OffsetNodeIR
  | DraftNodeIRV4
  | PartNodeIR
  | AssemblyNodeIR;

/** Nodes accepted by the frozen document-v5 grammar. */
export type NodeIRV5 =
  | BoxNodeIR
  | CylinderNodeIR
  | SphereNodeIR
  | SketchNodeIR
  | PolylinePathNodeIR
  | CircularArcPathNodeIR
  | CompositePathNodeIR
  | ExtrudeNodeIR
  | RevolveNodeIR
  | LoftNodeIR
  | SweepNodeIR
  | BooleanNodeIR
  | TransformNodeIR
  | FilletNodeIRV5
  | ChamferNodeIRV5
  | ShellNodeIRV5
  | OffsetNodeIR
  | DraftNodeIRV5
  | PartNodeIR
  | AssemblyNodeIR;

/** Nodes accepted by the current document-v6 grammar. */
export type NodeIRV6 =
  | BoxNodeIR
  | CylinderNodeIR
  | SphereNodeIR
  | SketchNodeIR
  | PolylinePathNodeIR
  | CircularArcPathNodeIR
  | CompositePathNodeIR
  | ExtrudeNodeIR
  | RevolveNodeIR
  | LoftNodeIR
  | SweepNodeIR
  | BooleanNodeIR
  | TransformNodeIR
  | FilletNodeIRV6
  | ChamferNodeIRV6
  | ShellNodeIRV6
  | OffsetNodeIR
  | DraftNodeIRV6
  | PartNodeIR
  | AssemblyNodeIR;

/** Current node grammar. */
export type NodeIR = NodeIRV6;

/** Nodes accepted by the original document-v1 grammar. */
export type NodeIRV1 =
  | BoxNodeIR
  | CylinderNodeIR
  | SphereNodeIR
  | SketchNodeIR
  | PolylinePathNodeIR
  | CircularArcPathNodeIR
  | CompositePathNodeIR
  | ExtrudeNodeIR
  | RevolveNodeIR
  | LoftNodeIR
  | SweepNodeIR
  | BooleanNodeIR
  | TransformNodeIR
  | FilletNodeIRV1
  | ChamferNodeIRV1
  | ShellNodeIRV1
  | OffsetNodeIR
  | DraftNodeIRV1
  | PartNodeIR
  | AssemblyNodeIR;
/** Nodes accepted by the frozen document-v2 grammar. */
export type NodeIRV2 =
  | BoxNodeIR
  | CylinderNodeIR
  | SphereNodeIR
  | SketchNodeIR
  | PolylinePathNodeIR
  | CircularArcPathNodeIR
  | CompositePathNodeIR
  | ExtrudeNodeIR
  | RevolveNodeIR
  | LoftNodeIR
  | SweepNodeIR
  | BooleanNodeIR
  | TransformNodeIR
  | FilletNodeIRV2
  | ChamferNodeIRV2
  | ShellNodeIRV2
  | OffsetNodeIR
  | DraftNodeIRV2
  | PartNodeIR
  | AssemblyNodeIR;

type ExactType<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type AssertExact<T extends true> = T;
/** Compile-time tripwires: tuple and union membership must evolve together. */
type NodeKindsV1AreExact = AssertExact<
  ExactType<NodeKindV1, NodeIRV1["kind"]>
>;
type NodeKindsV2AreExact = AssertExact<
  ExactType<NodeKindV2, NodeIRV2["kind"]>
>;
type NodeKindsV3AreExact = AssertExact<
  ExactType<NodeKindV3, NodeIRV3["kind"]>
>;
type NodeKindsV4AreExact = AssertExact<
  ExactType<NodeKindV4, NodeIRV4["kind"]>
>;
type NodeKindsV5AreExact = AssertExact<
  ExactType<NodeKindV5, NodeIRV5["kind"]>
>;
type NodeKindsV6AreExact = AssertExact<
  ExactType<NodeKindV6, NodeIRV6["kind"]>
>;

interface DesignDocumentBodyV1 {
  readonly name: string;
  readonly units: {
    readonly length: "mm";
    readonly angle: "rad";
    readonly mass?: "kg";
  };
  readonly parameters: Readonly<Record<ParameterId, ParameterIR>>;
  /** Omitted for legacy documents that do not define a material catalogue. */
  readonly materials?: Readonly<Record<MaterialId, MaterialDefinitionIR>>;
  /** Omitted when the design has no named configurations. */
  readonly configurations?: Readonly<
    Record<ConfigurationId, DesignConfigurationIR>
  >;
  readonly nodes: Readonly<Record<NodeId, NodeIRV1>>;
  readonly outputs: Readonly<Record<string, RefIR<DesignOutputKind>>>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

interface DesignDocumentBodyV2 {
  readonly name: string;
  readonly units: {
    readonly length: "mm";
    readonly angle: "rad";
    readonly mass?: "kg";
  };
  readonly parameters: Readonly<Record<ParameterId, ParameterIR>>;
  /** Omitted for legacy documents that do not define a material catalogue. */
  readonly materials?: Readonly<Record<MaterialId, MaterialDefinitionIR>>;
  /** Omitted when the design has no named configurations. */
  readonly configurations?: Readonly<
    Record<ConfigurationId, DesignConfigurationIR>
  >;
  readonly nodes: Readonly<Record<NodeId, NodeIRV2>>;
  readonly outputs: Readonly<Record<string, RefIR<DesignOutputKind>>>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

interface DesignDocumentBodyV3 {
  readonly name: string;
  readonly units: {
    readonly length: "mm";
    readonly angle: "rad";
    readonly mass?: "kg";
  };
  readonly parameters: Readonly<Record<ParameterId, ParameterIR>>;
  /** Omitted for legacy documents that do not define a material catalogue. */
  readonly materials?: Readonly<Record<MaterialId, MaterialDefinitionIR>>;
  /** Omitted when the design has no named configurations. */
  readonly configurations?: Readonly<
    Record<ConfigurationId, DesignConfigurationIR>
  >;
  readonly nodes: Readonly<Record<NodeId, NodeIRV3>>;
  readonly outputs: Readonly<Record<string, RefIR<DesignOutputKind>>>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

interface DesignDocumentBodyV4 {
  readonly name: string;
  readonly units: {
    readonly length: "mm";
    readonly angle: "rad";
    readonly mass?: "kg";
  };
  readonly parameters: Readonly<Record<ParameterId, ParameterIR>>;
  /** Omitted for legacy documents that do not define a material catalogue. */
  readonly materials?: Readonly<Record<MaterialId, MaterialDefinitionIR>>;
  /** Omitted when the design has no named configurations. */
  readonly configurations?: Readonly<
    Record<ConfigurationId, DesignConfigurationIR>
  >;
  readonly nodes: Readonly<Record<NodeId, NodeIRV4>>;
  readonly outputs: Readonly<Record<string, RefIR<DesignOutputKind>>>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

interface DesignDocumentBodyV5 {
  readonly name: string;
  readonly units: {
    readonly length: "mm";
    readonly angle: "rad";
    readonly mass?: "kg";
  };
  readonly parameters: Readonly<Record<ParameterId, ParameterIR>>;
  /** Omitted for legacy documents that do not define a material catalogue. */
  readonly materials?: Readonly<Record<MaterialId, MaterialDefinitionIR>>;
  /** Omitted when the design has no named configurations. */
  readonly configurations?: Readonly<
    Record<ConfigurationId, DesignConfigurationIR>
  >;
  readonly nodes: Readonly<Record<NodeId, NodeIRV5>>;
  readonly outputs: Readonly<Record<string, RefIR<DesignOutputKind>>>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

interface DesignDocumentBodyV6 {
  readonly name: string;
  readonly units: {
    readonly length: "mm";
    readonly angle: "rad";
    readonly mass?: "kg";
  };
  readonly parameters: Readonly<Record<ParameterId, ParameterIR>>;
  /** Omitted for legacy documents that do not define a material catalogue. */
  readonly materials?: Readonly<Record<MaterialId, MaterialDefinitionIR>>;
  /** Omitted when the design has no named configurations. */
  readonly configurations?: Readonly<
    Record<ConfigurationId, DesignConfigurationIR>
  >;
  readonly nodes: Readonly<Record<NodeId, NodeIRV6>>;
  readonly outputs: Readonly<Record<string, RefIR<DesignOutputKind>>>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/** Original document grammar, retained for parsing and direct evaluation. */
export interface DesignDocumentV1 extends DesignDocumentBodyV1 {
  readonly schema: typeof DOCUMENT_SCHEMA_V1;
  readonly version: typeof DOCUMENT_VERSION_V1;
  readonly topologyReferences?: never;
}

/** Frozen document-v2 grammar with document-owned persistent topology evidence. */
export interface DesignDocumentV2 extends DesignDocumentBodyV2 {
  readonly schema: typeof DOCUMENT_SCHEMA_V2;
  readonly version: typeof DOCUMENT_VERSION_V2;
  readonly topologyReferences?: Readonly<
    Record<TopologyReferenceId, TopologyReferenceEntryIRV2>
  >;
}

/** Frozen document grammar with the v3 semantic topology-role vocabulary. */
export interface DesignDocumentV3 extends DesignDocumentBodyV3 {
  readonly schema: typeof DOCUMENT_SCHEMA_V3;
  readonly version: typeof DOCUMENT_VERSION_V3;
  readonly topologyReferences?: Readonly<
    Record<TopologyReferenceId, TopologyReferenceEntryIRV3>
  >;
}

/** Frozen document grammar with the v4 semantic topology-role vocabulary. */
export interface DesignDocumentV4 extends DesignDocumentBodyV4 {
  readonly schema: typeof DOCUMENT_SCHEMA_V4;
  readonly version: typeof DOCUMENT_VERSION_V4;
  readonly topologyReferences?: Readonly<
    Record<TopologyReferenceId, TopologyReferenceEntryIRV4>
  >;
}

/** Frozen document grammar with the v5 semantic topology-role vocabulary. */
export interface DesignDocumentV5 extends DesignDocumentBodyV5 {
  readonly schema: typeof DOCUMENT_SCHEMA_V5;
  readonly version: typeof DOCUMENT_VERSION_V5;
  readonly topologyReferences?: Readonly<
    Record<TopologyReferenceId, TopologyReferenceEntryIRV5>
  >;
}

/** Current document grammar with persistent vertex topology support. */
export interface DesignDocumentV6 extends DesignDocumentBodyV6 {
  readonly schema: typeof DOCUMENT_SCHEMA_V6;
  readonly version: typeof DOCUMENT_VERSION_V6;
  readonly topologyReferences?: Readonly<
    Record<TopologyReferenceId, TopologyReferenceEntryIRV6>
  >;
}

/** Every document version accepted by validation and evaluation. */
export type DesignDocument =
  | DesignDocumentV1
  | DesignDocumentV2
  | DesignDocumentV3
  | DesignDocumentV4
  | DesignDocumentV5
  | DesignDocumentV6;

export type NodeReference = RefIR<OutputKind>;

function unreachableIrVariant(value: never, family: string): never {
  const discriminant = (value as { readonly kind?: unknown; readonly op?: unknown })
    .kind ?? (value as { readonly op?: unknown }).op;
  throw new TypeError(
    `Unsupported ${family} variant '${String(discriminant)}'`,
  );
}

function collectVecParameterDependencies(
  value: Vec2ExpressionIR | Vec3ExpressionIR,
  output: Set<ParameterId>,
): void {
  for (const expression of value) expressionDependencies(expression, output);
}

function collectTransformParameterDependencies(
  operation: TransformOperationIR,
  output: Set<ParameterId>,
): void {
  switch (operation.kind) {
    case "translate":
    case "rotate":
    case "scale":
      collectVecParameterDependencies(operation.value, output);
      return;
    case "mirror":
      collectVecParameterDependencies(operation.normal, output);
      return;
    default:
      return unreachableIrVariant(operation, "transform operation");
  }
}

function collectTopologyQueryParameterDependencies(
  query: TopologyQueryIR,
  output: Set<ParameterId>,
): void {
  switch (query.op) {
    case "all":
    case "persistentReference":
    case "origin":
    case "surface":
    case "curve":
      return;
    case "normal":
    case "direction":
      collectVecParameterDependencies(query.value, output);
      expressionDependencies(query.tolerance, output);
      return;
    case "radius":
      expressionDependencies(query.value, output);
      expressionDependencies(query.tolerance, output);
      return;
    case "position":
      collectVecParameterDependencies(query.value, output);
      expressionDependencies(query.tolerance, output);
      return;
    case "adjacentTo":
      collectTopologyQueryParameterDependencies(query.selection.query, output);
      return;
    case "and":
    case "or":
      for (const child of query.queries) {
        collectTopologyQueryParameterDependencies(child, output);
      }
      return;
    case "not":
      collectTopologyQueryParameterDependencies(query.query, output);
      return;
    default:
      return unreachableIrVariant(query, "topology query");
  }
}

function collectSketchEntityParameterDependencies(
  entity: SketchEntityIR,
  output: Set<ParameterId>,
): void {
  switch (entity.kind) {
    case "point":
      expressionDependencies(entity.x, output);
      expressionDependencies(entity.y, output);
      return;
    case "line":
      return;
    case "circle":
      expressionDependencies(entity.radius, output);
      return;
    case "arc":
      expressionDependencies(entity.radius, output);
      expressionDependencies(entity.startAngle, output);
      expressionDependencies(entity.endAngle, output);
      return;
    default:
      return unreachableIrVariant(entity, "sketch entity");
  }
}

function collectSketchConstraintParameterDependencies(
  constraint: SketchConstraintIR,
  output: Set<ParameterId>,
): void {
  switch (constraint.kind) {
    case "coincident":
    case "horizontal":
    case "vertical":
    case "fixed":
    case "parallel":
    case "perpendicular":
    case "equalLength":
    case "equalRadius":
    case "midpoint":
    case "tangent":
      return;
    case "distance":
    case "distanceX":
    case "distanceY":
    case "length":
    case "angle":
    case "radius":
    case "diameter":
      expressionDependencies(constraint.value, output);
      return;
    default:
      return unreachableIrVariant(constraint, "sketch constraint");
  }
}

function collectCompositePathSegmentParameterDependencies(
  segment: CompositePathSegmentIR,
  output: Set<ParameterId>,
): void {
  switch (segment.kind) {
    case "line":
      collectVecParameterDependencies(segment.end, output);
      return;
    case "circularArc":
      collectVecParameterDependencies(segment.through, output);
      collectVecParameterDependencies(segment.end, output);
      return;
    default:
      return unreachableIrVariant(segment, "composite path segment");
  }
}

/**
 * Returns the parameter IDs referenced by every expression owned by `node`.
 *
 * The traversal is structural and deliberately ignores arbitrary metadata JSON.
 * Results are unique, sorted by ID, and frozen so callers can safely reuse them
 * as deterministic dependency-graph inputs.
 */
export function nodeParameterDependencies(
  node: NodeIR,
): readonly ParameterId[] {
  const output = new Set<ParameterId>();
  switch (node.kind) {
    case "box":
      collectVecParameterDependencies(node.size, output);
      break;
    case "cylinder":
      expressionDependencies(node.height, output);
      expressionDependencies(node.radiusBottom, output);
      expressionDependencies(node.radiusTop, output);
      break;
    case "sphere":
      expressionDependencies(node.radius, output);
      break;
    case "sketch":
      collectVecParameterDependencies(node.plane.origin, output);
      for (const entity of Object.values(node.entities)) {
        collectSketchEntityParameterDependencies(entity, output);
      }
      for (const constraint of Object.values(node.constraints)) {
        collectSketchConstraintParameterDependencies(constraint, output);
      }
      break;
    case "polylinePath":
      for (const point of node.points) {
        collectVecParameterDependencies(point, output);
      }
      break;
    case "circularArcPath":
      collectVecParameterDependencies(node.start, output);
      collectVecParameterDependencies(node.through, output);
      collectVecParameterDependencies(node.end, output);
      break;
    case "compositePath":
      collectVecParameterDependencies(node.start, output);
      for (const segment of node.segments) {
        collectCompositePathSegmentParameterDependencies(segment, output);
      }
      break;
    case "extrude":
      expressionDependencies(node.distance, output);
      expressionDependencies(node.twist, output);
      collectVecParameterDependencies(node.scaleTop, output);
      break;
    case "revolve":
      expressionDependencies(node.angle, output);
      break;
    case "loft":
    case "sweep":
    case "boolean":
      break;
    case "transform":
      for (const operation of node.operations) {
        collectTransformParameterDependencies(operation, output);
      }
      break;
    case "fillet":
      collectTopologyQueryParameterDependencies(node.edges.query, output);
      expressionDependencies(node.radius, output);
      break;
    case "chamfer":
      collectTopologyQueryParameterDependencies(node.edges.query, output);
      expressionDependencies(node.distance, output);
      break;
    case "shell":
      collectTopologyQueryParameterDependencies(node.openings.query, output);
      expressionDependencies(node.thickness, output);
      expressionDependencies(node.tolerance, output);
      break;
    case "offset":
      expressionDependencies(node.distance, output);
      expressionDependencies(node.tolerance, output);
      break;
    case "draft":
      collectTopologyQueryParameterDependencies(node.faces.query, output);
      expressionDependencies(node.angle, output);
      collectVecParameterDependencies(node.pullDirection, output);
      collectVecParameterDependencies(node.neutralPlane.origin, output);
      collectVecParameterDependencies(node.neutralPlane.normal, output);
      break;
    case "part":
      if (node.massDensity !== undefined) {
        expressionDependencies(node.massDensity, output);
      }
      break;
    case "assembly":
      for (const instance of node.instances) {
        for (const operation of instance.placement) {
          collectTransformParameterDependencies(operation, output);
        }
      }
      break;
    default:
      return unreachableIrVariant(node, "node");
  }
  return Object.freeze([...output].sort());
}

export function nodeDependencies(node: NodeIR): readonly RefIR[] {
  switch (node.kind) {
    case "box":
    case "cylinder":
    case "sphere":
    case "sketch":
    case "polylinePath":
    case "circularArcPath":
    case "compositePath":
      return [];
    case "extrude":
    case "revolve":
      return [node.profile];
    case "loft":
      return node.profiles;
    case "sweep":
      return [node.profile, node.path];
    case "boolean":
      return [node.target, ...node.tools];
    case "transform":
      return [node.input];
    case "fillet":
    case "chamfer":
    case "shell":
    case "offset":
    case "draft":
      return [node.input];
    case "part":
      return [node.solid];
    case "assembly":
      return node.instances.map((instance) => instance.component);
  }
}

export function outputKindForNode(node: NodeIR): OutputKind {
  switch (node.kind) {
    case "sketch":
      return "profile";
    case "polylinePath":
    case "circularArcPath":
    case "compositePath":
      return "path";
    case "part":
      return "part";
    case "assembly":
      return "assembly";
    default:
      return "solid";
  }
}
