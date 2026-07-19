import type {
  ConfigurationId,
  EntityId,
  MaterialId,
  NodeId,
  ParameterId,
  TopologyReferenceId,
} from "./core/ids.js";
import type { JsonValue } from "./core/json.js";
import type { Dimension, ExpressionIR } from "./expressions.js";
import type {
  TopologyKind,
  TopologyRole,
  TopologyRoleV1,
  TopologyRoleV2,
  TopologyRoleV3,
} from "./protocol/topology.js";
import type { ShellDirection } from "./protocol/shell.js";
import type { OffsetDirection } from "./protocol/offset.js";
import type { SweepFrame, SweepTransition } from "./protocol/sweep.js";
import type { PersistentTopologyReference } from "./topology-signatures.js";

export const DOCUMENT_SCHEMA_V1 =
  "https://invariantcad.dev/schema/document/v1" as const;
export const DOCUMENT_VERSION_V1 = 1 as const;
export const DOCUMENT_SCHEMA_V2 =
  "https://invariantcad.dev/schema/document/v2" as const;
export const DOCUMENT_VERSION_V2 = 2 as const;
export const DOCUMENT_SCHEMA_V3 =
  "https://invariantcad.dev/schema/document/v3" as const;
export const DOCUMENT_VERSION_V3 = 3 as const;

/** Schema emitted by the current authoring API. */
export const DOCUMENT_SCHEMA = DOCUMENT_SCHEMA_V3;
/** Version emitted by the current authoring API. */
export const DOCUMENT_VERSION = DOCUMENT_VERSION_V3;

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
  K extends TopologyKind = TopologyKind,
> = TopologyReferenceEntryIR<K, TopologyRoleV2>;
export type TopologyReferenceEntryIRV3<
  K extends TopologyKind = TopologyKind,
> = TopologyReferenceEntryIR<K, TopologyRoleV3>;

/**
 * Version-aware topology query grammar. Persistent-reference atoms were added
 * in document v2 and are deliberately absent when `AllowPersistent` is false.
 */
declare const topologyQueryPersistentCapability: unique symbol;

export type TopologyQueryIRFor<
  AllowPersistent extends boolean,
  R extends TopologyRole = TopologyRole,
> = {
  /** Type-only variance marker; never serialized into a document. */
  readonly [topologyQueryPersistentCapability]?: readonly [AllowPersistent, R];
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
    | {
        readonly op: "adjacentTo";
        readonly selection: TopologySelectionIRFor<
          TopologyKind,
          AllowPersistent,
          R
        >;
      }
    | {
        readonly op: "and" | "or";
        readonly queries: readonly TopologyQueryIRFor<AllowPersistent, R>[];
      }
    | {
        readonly op: "not";
        readonly query: TopologyQueryIRFor<AllowPersistent, R>;
      }
  );

export interface TopologySelectionIRFor<
  K extends TopologyKind = TopologyKind,
  AllowPersistent extends boolean = boolean,
  R extends TopologyRole = TopologyRole,
> {
  readonly topology: K;
  readonly query: TopologyQueryIRFor<AllowPersistent, R>;
  readonly cardinality: TopologyCardinalityIR;
}

/** Topology queries accepted by the original document-v1 grammar. */
export type TopologyQueryIRV1 = TopologyQueryIRFor<false, TopologyRoleV1>;
/** Topology queries accepted by the frozen document-v2 grammar. */
export type TopologyQueryIRV2 = TopologyQueryIRFor<boolean, TopologyRoleV2>;
/** Topology queries accepted by the current document-v3 grammar. */
export type TopologyQueryIRV3 = TopologyQueryIRFor<boolean, TopologyRoleV3>;
/** Current topology query grammar. */
export type TopologyQueryIR = TopologyQueryIRV3;

export type TopologySelectionIRV1<
  K extends TopologyKind = TopologyKind,
> = TopologySelectionIRFor<K, false, TopologyRoleV1>;
export type TopologySelectionIRV2<
  K extends TopologyKind = TopologyKind,
> = TopologySelectionIRFor<K, boolean, TopologyRoleV2>;
export type TopologySelectionIRV3<
  K extends TopologyKind = TopologyKind,
> = TopologySelectionIRFor<K, boolean, TopologyRoleV3>;
/** Current topology selection grammar. */
export type TopologySelectionIR<
  K extends TopologyKind = TopologyKind,
> = TopologySelectionIRV3<K>;

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

export type NodeIR =
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
  | FilletNodeIR
  | ChamferNodeIR
  | ShellNodeIR
  | OffsetNodeIR
  | DraftNodeIR
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

/** Nodes accepted by the original document-v1 grammar. */
export type NodeIRV1 =
  | Exclude<
      NodeIR,
      FilletNodeIR | ChamferNodeIR | ShellNodeIR | DraftNodeIR
    >
  | FilletNodeIRV1
  | ChamferNodeIRV1
  | ShellNodeIRV1
  | DraftNodeIRV1;
/** Nodes accepted by the frozen document-v2 grammar. */
export type NodeIRV2 =
  | Exclude<
      NodeIR,
      FilletNodeIR | ChamferNodeIR | ShellNodeIR | DraftNodeIR
    >
  | FilletNodeIRV2
  | ChamferNodeIRV2
  | ShellNodeIRV2
  | DraftNodeIRV2;
/** Nodes accepted by the current document-v3 grammar. */
export type NodeIRV3 = NodeIR;

interface DesignDocumentBody<N extends NodeIR = NodeIR> {
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
  readonly nodes: Readonly<Record<NodeId, N>>;
  readonly outputs: Readonly<Record<string, RefIR<DesignOutputKind>>>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/** Original document grammar, retained for parsing and direct evaluation. */
export interface DesignDocumentV1 extends DesignDocumentBody<NodeIRV1> {
  readonly schema: typeof DOCUMENT_SCHEMA_V1;
  readonly version: typeof DOCUMENT_VERSION_V1;
  readonly topologyReferences?: never;
}

/** Frozen document-v2 grammar with document-owned persistent topology evidence. */
export interface DesignDocumentV2 extends DesignDocumentBody<NodeIRV2> {
  readonly schema: typeof DOCUMENT_SCHEMA_V2;
  readonly version: typeof DOCUMENT_VERSION_V2;
  readonly topologyReferences?: Readonly<
    Record<TopologyReferenceId, TopologyReferenceEntryIRV2>
  >;
}

/** Current document grammar with the v3 semantic topology-role vocabulary. */
export interface DesignDocumentV3 extends DesignDocumentBody<NodeIRV3> {
  readonly schema: typeof DOCUMENT_SCHEMA_V3;
  readonly version: typeof DOCUMENT_VERSION_V3;
  readonly topologyReferences?: Readonly<
    Record<TopologyReferenceId, TopologyReferenceEntryIRV3>
  >;
}

/** Every document version accepted by validation and evaluation. */
export type DesignDocument =
  | DesignDocumentV1
  | DesignDocumentV2
  | DesignDocumentV3;

export type NodeReference = RefIR<OutputKind>;

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
