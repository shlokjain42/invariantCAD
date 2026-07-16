import type { Vec3 } from "../core/math.js";

export type TopologyKind = "face" | "edge";

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
}

export interface KernelTopologySource {
  readonly kind: "sketch-entity";
  readonly sketch: string;
  readonly entity: string;
}

export interface KernelTopologyLineage {
  readonly feature: string;
  readonly relation: "created" | "modified";
  readonly role?: string;
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
