import type { Vec3 } from "../core/math.js";

export type TopologyKind = "face" | "edge";

/** Face-role vocabulary frozen into document v1. */
export const FACE_TOPOLOGY_ROLES_V1 = Object.freeze([
  "box.face.x-min",
  "box.face.x-max",
  "box.face.y-min",
  "box.face.y-max",
  "box.face.z-min",
  "box.face.z-max",
  "cylinder.face.start-cap",
  "cylinder.face.end-cap",
  "cylinder.face.side",
  "sphere.face.surface",
  "extrude.face.start-cap",
  "extrude.face.end-cap",
  "extrude.face.side",
  "revolve.face.start-cap",
  "revolve.face.end-cap",
  "revolve.face.swept",
] as const);

/** Document v2 did not expand the semantic role vocabulary. */
export const FACE_TOPOLOGY_ROLES_V2 = FACE_TOPOLOGY_ROLES_V1;

/** Face-role vocabulary introduced by document v3. */
export const FACE_TOPOLOGY_ROLES_V3 = Object.freeze([
  ...FACE_TOPOLOGY_ROLES_V2,
  "loft.face.start-cap",
  "loft.face.end-cap",
  "loft.face.side",
] as const);

/** Edge-role vocabulary frozen into document v1. */
export const EDGE_TOPOLOGY_ROLES_V1 = Object.freeze([
  "box.edge.x-min-y-min",
  "box.edge.x-min-y-max",
  "box.edge.x-max-y-min",
  "box.edge.x-max-y-max",
  "box.edge.x-min-z-min",
  "box.edge.x-min-z-max",
  "box.edge.x-max-z-min",
  "box.edge.x-max-z-max",
  "box.edge.y-min-z-min",
  "box.edge.y-min-z-max",
  "box.edge.y-max-z-min",
  "box.edge.y-max-z-max",
  "cylinder.edge.start-rim",
  "cylinder.edge.end-rim",
  "extrude.edge.start-rim",
  "extrude.edge.end-rim",
  "extrude.edge.lateral",
] as const);

/** Document v2 did not expand the semantic role vocabulary. */
export const EDGE_TOPOLOGY_ROLES_V2 = EDGE_TOPOLOGY_ROLES_V1;

/** Edge-role vocabulary introduced by document v3. */
export const EDGE_TOPOLOGY_ROLES_V3 = Object.freeze([
  ...EDGE_TOPOLOGY_ROLES_V2,
  "loft.edge.section-rim",
  "loft.edge.lateral",
] as const);

export const TOPOLOGY_ROLES_V1 = Object.freeze([
  ...FACE_TOPOLOGY_ROLES_V1,
  ...EDGE_TOPOLOGY_ROLES_V1,
] as const);

export const TOPOLOGY_ROLES_V2 = TOPOLOGY_ROLES_V1;

export const TOPOLOGY_ROLES_V3 = Object.freeze([
  ...FACE_TOPOLOGY_ROLES_V3,
  ...EDGE_TOPOLOGY_ROLES_V3,
] as const);

/** Current face-role vocabulary. */
export const FACE_TOPOLOGY_ROLES = FACE_TOPOLOGY_ROLES_V3;
/** Current edge-role vocabulary. */
export const EDGE_TOPOLOGY_ROLES = EDGE_TOPOLOGY_ROLES_V3;
/** Current closed semantic-role vocabulary. */
export const TOPOLOGY_ROLES = TOPOLOGY_ROLES_V3;

export type FaceTopologyRoleV1 = (typeof FACE_TOPOLOGY_ROLES_V1)[number];
export type FaceTopologyRoleV2 = (typeof FACE_TOPOLOGY_ROLES_V2)[number];
export type FaceTopologyRoleV3 = (typeof FACE_TOPOLOGY_ROLES_V3)[number];
export type EdgeTopologyRoleV1 = (typeof EDGE_TOPOLOGY_ROLES_V1)[number];
export type EdgeTopologyRoleV2 = (typeof EDGE_TOPOLOGY_ROLES_V2)[number];
export type EdgeTopologyRoleV3 = (typeof EDGE_TOPOLOGY_ROLES_V3)[number];
export type TopologyRoleV1 = (typeof TOPOLOGY_ROLES_V1)[number];
export type TopologyRoleV2 = (typeof TOPOLOGY_ROLES_V2)[number];
export type TopologyRoleV3 = (typeof TOPOLOGY_ROLES_V3)[number];

export type FaceTopologyRole = FaceTopologyRoleV3;
export type EdgeTopologyRole = EdgeTopologyRoleV3;
export type TopologyRole = TopologyRoleV3;

export type TopologyRoleProducer =
  | "box"
  | "cylinder"
  | "sphere"
  | "extrude"
  | "revolve"
  | "loft";
export type TopologyRoleSource = "none" | "sketch-curve";

export interface TopologyRoleRule {
  readonly producer: TopologyRoleProducer;
  readonly topology: TopologyKind;
  readonly relation: "created";
  readonly source: TopologyRoleSource;
}

const roleRule = (
  producer: TopologyRoleProducer,
  topology: TopologyKind,
  source: TopologyRoleSource = "none",
): TopologyRoleRule => Object.freeze({ producer, topology, relation: "created", source });

/** Closed semantic vocabulary shared by documents, validators, and kernels. */
export const TOPOLOGY_ROLE_RULES = Object.freeze({
  "box.face.x-min": roleRule("box", "face"),
  "box.face.x-max": roleRule("box", "face"),
  "box.face.y-min": roleRule("box", "face"),
  "box.face.y-max": roleRule("box", "face"),
  "box.face.z-min": roleRule("box", "face"),
  "box.face.z-max": roleRule("box", "face"),
  "box.edge.x-min-y-min": roleRule("box", "edge"),
  "box.edge.x-min-y-max": roleRule("box", "edge"),
  "box.edge.x-max-y-min": roleRule("box", "edge"),
  "box.edge.x-max-y-max": roleRule("box", "edge"),
  "box.edge.x-min-z-min": roleRule("box", "edge"),
  "box.edge.x-min-z-max": roleRule("box", "edge"),
  "box.edge.x-max-z-min": roleRule("box", "edge"),
  "box.edge.x-max-z-max": roleRule("box", "edge"),
  "box.edge.y-min-z-min": roleRule("box", "edge"),
  "box.edge.y-min-z-max": roleRule("box", "edge"),
  "box.edge.y-max-z-min": roleRule("box", "edge"),
  "box.edge.y-max-z-max": roleRule("box", "edge"),
  "cylinder.face.start-cap": roleRule("cylinder", "face"),
  "cylinder.face.end-cap": roleRule("cylinder", "face"),
  "cylinder.face.side": roleRule("cylinder", "face"),
  "cylinder.edge.start-rim": roleRule("cylinder", "edge"),
  "cylinder.edge.end-rim": roleRule("cylinder", "edge"),
  "sphere.face.surface": roleRule("sphere", "face"),
  "extrude.face.start-cap": roleRule("extrude", "face"),
  "extrude.face.end-cap": roleRule("extrude", "face"),
  "extrude.face.side": roleRule("extrude", "face", "sketch-curve"),
  "extrude.edge.start-rim": roleRule("extrude", "edge", "sketch-curve"),
  "extrude.edge.end-rim": roleRule("extrude", "edge", "sketch-curve"),
  "extrude.edge.lateral": roleRule("extrude", "edge"),
  "revolve.face.start-cap": roleRule("revolve", "face"),
  "revolve.face.end-cap": roleRule("revolve", "face"),
  "revolve.face.swept": roleRule("revolve", "face", "sketch-curve"),
  "loft.face.start-cap": roleRule("loft", "face"),
  "loft.face.end-cap": roleRule("loft", "face"),
  "loft.face.side": roleRule("loft", "face", "sketch-curve"),
  "loft.edge.section-rim": roleRule("loft", "edge", "sketch-curve"),
  "loft.edge.lateral": roleRule("loft", "edge"),
} as const satisfies Readonly<Record<TopologyRole, TopologyRoleRule>>);

declare const KERNEL_TOPOLOGY_KEY: unique symbol;

/**
 * Evaluation-scoped topology identity. Keys are opaque, kernel-owned, and must
 * never be persisted in a design document.
 */
export type KernelTopologyKey = string & {
  readonly [KERNEL_TOPOLOGY_KEY]: never;
};

export interface KernelTopologyCapabilities {
  readonly kinds: readonly TopologyKind[];
  readonly provenance: "none" | "feature" | "history";
  readonly semanticRoles: boolean;
  readonly sketchSources: boolean;
  readonly geometry: boolean;
  readonly adjacency: boolean;
  /**
   * Optional declaration that this kernel can produce topology descriptors
   * compatible with the versioned persistent-reference protocol.
   */
  readonly signatures?: KernelTopologySignatureCapabilities;
}

export interface KernelTopologySignatureCapabilities {
  readonly protocolVersion: 1;
  /**
   * Semantic compatibility fingerprint for the descriptor implementation.
   * This is not a cryptographic attestation of native runtime bytes.
   */
  readonly fingerprint: string;
}

export interface KernelTopologySource {
  readonly kind: "sketch-entity";
  readonly sketch: string;
  readonly entity: string;
}

export interface KernelTopologyLineage {
  readonly feature: string;
  readonly relation: "created" | "modified";
  readonly role?: TopologyRole;
  readonly source?: KernelTopologySource;
}

export interface KernelTopologyBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface KernelSurfaceDescriptor {
  readonly kind: string;
  readonly normal?: Vec3;
  readonly axis?: Vec3;
  readonly radius?: number;
}

export interface KernelCurveDescriptor {
  readonly kind: string;
  readonly direction?: Vec3;
  readonly axis?: Vec3;
  readonly radius?: number;
}

interface KernelTopologyDescriptorBase {
  readonly key: KernelTopologyKey;
  readonly center: Vec3;
  readonly bounds: KernelTopologyBounds;
  readonly lineage: readonly KernelTopologyLineage[];
}

export interface KernelFaceDescriptor extends KernelTopologyDescriptorBase {
  readonly topology: "face";
  readonly area: number;
  readonly surface: KernelSurfaceDescriptor;
  readonly edges: readonly KernelTopologyKey[];
}

export interface KernelEdgeDescriptor extends KernelTopologyDescriptorBase {
  readonly topology: "edge";
  readonly length: number;
  readonly curve: KernelCurveDescriptor;
  readonly faces: readonly KernelTopologyKey[];
}

export interface KernelTopologySnapshot {
  /** Whether feature lineage is trustworthy for every topology item. */
  readonly history: "complete" | "partial";
  readonly faces: readonly KernelFaceDescriptor[];
  readonly edges: readonly KernelEdgeDescriptor[];
}
