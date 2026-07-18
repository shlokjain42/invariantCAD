import type {
  EntityId,
  MaterialId,
  NodeId,
  ParameterId,
} from "./core/ids.js";
import type { JsonValue } from "./core/json.js";
import type { Dimension, ExpressionIR } from "./expressions.js";
import type { TopologyKind, TopologyRole } from "./protocol/topology.js";
import type { ShellDirection } from "./protocol/shell.js";
import type { OffsetDirection } from "./protocol/offset.js";
import type { SweepFrame, SweepTransition } from "./protocol/sweep.js";

export const DOCUMENT_SCHEMA =
  "https://invariantcad.dev/schema/document/v1" as const;
export const DOCUMENT_VERSION = 1 as const;

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
  /** Ordered profile sections; document v1 requires at least two. */
  readonly profiles: readonly RefIR<"profile">[];
  /** Document v1 supports ruled interpolation only. */
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

export type TopologyQueryIR =
  | { readonly op: "all" }
  | {
      readonly op: "origin";
      readonly feature: NodeId;
      readonly relation: TopologyOriginRelation;
      readonly role?: TopologyRole;
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
      readonly selection: TopologySelectionIR;
    }
  | {
      readonly op: "and" | "or";
      readonly queries: readonly TopologyQueryIR[];
    }
  | { readonly op: "not"; readonly query: TopologyQueryIR };

export interface TopologySelectionIR<
  K extends TopologyKind = TopologyKind,
> {
  readonly topology: K;
  readonly query: TopologyQueryIR;
  readonly cardinality: TopologyCardinalityIR;
}

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

export interface DesignDocument {
  readonly schema: typeof DOCUMENT_SCHEMA;
  readonly version: typeof DOCUMENT_VERSION;
  readonly name: string;
  readonly units: {
    readonly length: "mm";
    readonly angle: "rad";
    readonly mass?: "kg";
  };
  readonly parameters: Readonly<Record<ParameterId, ParameterIR>>;
  /** Omitted for legacy documents that do not define a material catalogue. */
  readonly materials?: Readonly<Record<MaterialId, MaterialDefinitionIR>>;
  readonly nodes: Readonly<Record<NodeId, NodeIR>>;
  readonly outputs: Readonly<Record<string, RefIR<DesignOutputKind>>>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

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
