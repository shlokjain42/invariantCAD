import type { Mat4, Vec3 } from "./core/math.js";
import type { ResolvedProfile } from "./protocol/profile.js";
import type { ResolvedDraftOptions } from "./protocol/draft.js";
import type { ResolvedShellOptions } from "./protocol/shell.js";
import type { ResolvedOffsetOptions } from "./protocol/offset.js";
import type { ResolvedLoftOptions } from "./protocol/loft.js";
import type {
  ResolvedCompositePath,
  ResolvedCircularArcPath,
  ResolvedPolylinePath,
} from "./protocol/path.js";
import {
  COMPOSITE_SWEEP_REFINEMENTS,
  type CompositeSweepRefinement,
  type ResolvedSweepOptions,
} from "./protocol/sweep.js";
import type {
  KernelTopologyCapabilities,
  KernelTopologyKey,
  KernelTopologySnapshot,
} from "./protocol/topology.js";

export type KernelRepresentation = "mesh" | "brep" | "sdf";
export type KernelPrimitive = "box" | "cylinder" | "sphere";
export type KernelFeature =
  | "extrude"
  | "revolve"
  | "loft"
  | "sweep"
  | "circularArcSweep"
  | "compositeSweep"
  | "boolean"
  | "transform"
  | "fillet"
  | "chamfer"
  | "shell"
  | "offset"
  | "draft";
/** @see CompositeSweepRefinement */
export type KernelCompositeSweepRefinement = CompositeSweepRefinement;
export type KernelCapabilityKind =
  | "primitive"
  | "feature"
  | "compositeSweepRefinement"
  | "exactIndexedTopologyEvolution"
  | "nativeImport"
  | "nativeExport";
export type KernelExchangeFormat = "step" | "brep" | "brep-binary";

export const GEOMETRY_KERNEL_PROTOCOL_VERSION = 1 as const;
export const COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION = 1 as const;
export const EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION = 1 as const;

/**
 * Additive guarantees beyond the base `compositeSweep` feature contract.
 *
 * The envelope is optional so kernels that implement the original composite
 * sweep contract remain compatible without claiming either stronger case.
 */
export interface KernelCompositeSweepCapabilities {
  readonly protocolVersion: typeof COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION;
  readonly refinements: readonly KernelCompositeSweepRefinement[];
}

export type KernelCompositeSweepCapabilitiesMalformedReason =
  | "not-object"
  | "unsupported-protocol-version"
  | "refinements-not-array"
  | "invalid-refinement"
  | "unknown-refinement"
  | "duplicate-refinement";

export interface KernelCompositeSweepCapabilitiesAbsent {
  readonly status: "absent";
}

export interface KernelCompositeSweepCapabilitiesValid {
  readonly status: "valid";
  /** A validated snapshot, isolated from later mutation of kernel metadata. */
  readonly capabilities: KernelCompositeSweepCapabilities;
}

export interface KernelCompositeSweepCapabilitiesMalformed {
  readonly status: "malformed";
  readonly reason: KernelCompositeSweepCapabilitiesMalformedReason;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type KernelCompositeSweepCapabilitiesInspection =
  | KernelCompositeSweepCapabilitiesAbsent
  | KernelCompositeSweepCapabilitiesValid
  | KernelCompositeSweepCapabilitiesMalformed;

/**
 * Feature-scoped support for complete, exact, indexed topology evolution.
 *
 * Advertising a feature here is a stronger promise than advertising the
 * corresponding modeling method in `features`: the kernel must also return
 * complete topology history for that feature through the indexed protocol.
 */
export interface KernelExactIndexedTopologyEvolutionCapabilities {
  readonly protocolVersion: typeof EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION;
  readonly features: readonly KernelFeature[];
}

export interface KernelCapabilities {
  readonly protocolVersion: typeof GEOMETRY_KERNEL_PROTOCOL_VERSION;
  readonly representation: KernelRepresentation;
  readonly exact: boolean;
  readonly primitives: readonly KernelPrimitive[];
  readonly features: readonly KernelFeature[];
  readonly nativeImports: readonly KernelExchangeFormat[];
  readonly nativeExports: readonly KernelExchangeFormat[];
  readonly topology?: KernelTopologyCapabilities;
  readonly compositeSweep?: KernelCompositeSweepCapabilities;
  readonly exactIndexedTopologyEvolution?: KernelExactIndexedTopologyEvolutionCapabilities;
}

function metadataType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Inspects the optional composite-sweep refinement envelope without conflating
 * absent support with malformed metadata. The base `compositeSweep` feature is
 * deliberately checked separately by `kernelSupports` and evaluator preflight.
 */
export function inspectKernelCompositeSweepCapabilities(
  capabilities: KernelCapabilities,
): KernelCompositeSweepCapabilitiesInspection {
  const raw: unknown = capabilities.compositeSweep;
  if (raw === undefined) return { status: "absent" };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      status: "malformed",
      reason: "not-object",
      message: "Composite-sweep capability metadata must be an object",
      details: { actualType: metadataType(raw) },
    };
  }

  const metadata = raw as {
    readonly protocolVersion?: unknown;
    readonly refinements?: unknown;
  };
  if (
    metadata.protocolVersion !==
    COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION
  ) {
    return {
      status: "malformed",
      reason: "unsupported-protocol-version",
      message: "Composite-sweep capability metadata uses an unsupported protocol version",
      details: {
        expectedProtocolVersion:
          COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
        actualProtocolVersion: metadata.protocolVersion,
      },
    };
  }
  if (!Array.isArray(metadata.refinements)) {
    return {
      status: "malformed",
      reason: "refinements-not-array",
      message: "Composite-sweep refinements must be an array",
      details: { actualType: metadataType(metadata.refinements) },
    };
  }

  const knownRefinements = new Set<string>(COMPOSITE_SWEEP_REFINEMENTS);
  const seen = new Set<KernelCompositeSweepRefinement>();
  const refinements: KernelCompositeSweepRefinement[] = [];
  for (let index = 0; index < metadata.refinements.length; index += 1) {
    if (!Object.hasOwn(metadata.refinements, index)) {
      return {
        status: "malformed",
        reason: "invalid-refinement",
        message: "Composite-sweep refinements must be a dense array of names",
        details: { index, actualType: "missing" },
      };
    }
    const refinement: unknown = metadata.refinements[index];
    if (typeof refinement !== "string") {
      return {
        status: "malformed",
        reason: "invalid-refinement",
        message: "Composite-sweep refinements must be a dense array of names",
        details: { index, actualType: metadataType(refinement) },
      };
    }
    if (!knownRefinements.has(refinement)) {
      return {
        status: "malformed",
        reason: "unknown-refinement",
        message: `Composite-sweep refinement '${refinement}' is unknown`,
        details: { index, refinement },
      };
    }
    const known = refinement as KernelCompositeSweepRefinement;
    if (seen.has(known)) {
      return {
        status: "malformed",
        reason: "duplicate-refinement",
        message: `Composite-sweep refinement '${known}' is duplicated`,
        details: { index, refinement: known },
      };
    }
    seen.add(known);
    refinements.push(known);
  }
  return {
    status: "valid",
    capabilities: Object.freeze({
      protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
      refinements: Object.freeze(refinements),
    }),
  };
}

function supportedCompositeSweepRefinements(
  capabilities: KernelCapabilities,
): readonly KernelCompositeSweepRefinement[] {
  if (!capabilities.features.includes("compositeSweep")) return [];
  const inspection = inspectKernelCompositeSweepCapabilities(capabilities);
  return inspection.status === "valid"
    ? inspection.capabilities.refinements
    : [];
}

export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: "primitive",
  capability: KernelPrimitive,
): boolean;
export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: "feature",
  capability: KernelFeature,
): boolean;
export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: "compositeSweepRefinement",
  capability: KernelCompositeSweepRefinement,
): boolean;
export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: "exactIndexedTopologyEvolution",
  capability: KernelFeature,
): boolean;
export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: "nativeImport" | "nativeExport",
  capability: KernelExchangeFormat,
): boolean;
export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: KernelCapabilityKind,
  capability: string,
): boolean {
  const supported =
    kind === "primitive"
      ? capabilities.primitives
      : kind === "feature"
        ? capabilities.features
        : kind === "compositeSweepRefinement"
          ? supportedCompositeSweepRefinements(capabilities)
        : kind === "exactIndexedTopologyEvolution"
          ? capabilities.exactIndexedTopologyEvolution?.protocolVersion ===
              EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION &&
            Array.isArray(capabilities.exactIndexedTopologyEvolution.features)
            ? capabilities.exactIndexedTopologyEvolution.features
            : []
        : kind === "nativeImport"
          ? capabilities.nativeImports
          : capabilities.nativeExports;
  return (supported as readonly string[]).includes(capability);
}

export interface KernelShape {
  readonly kernel: string;
}

export interface KernelShapeStatus {
  readonly ok: boolean;
  readonly code: string;
  readonly message?: string;
}

export interface MeshData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface MeshOptions {
  readonly linearDeflection?: number;
  readonly angularDeflection?: number;
  readonly relative?: boolean;
}

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Symmetric 3x3 inertia tensor in world-axis coordinates.
 *
 * Rows use the standard mechanics sign convention
 * `integral((r dot r) I - r r^T)`. The property carrying the tensor defines
 * its reference point and whether the integration measure is volume or mass.
 */
export type InertiaTensor = readonly [Vec3, Vec3, Vec3];

export interface VolumetricMassProperties {
  /** Enclosed volume in cubic model units (mm^3 for authored documents). */
  readonly volume: number;
  /** World-coordinate centroid for homogeneous density, or `null` at zero volume. */
  readonly centerOfMass: Vec3 | null;
  /** Central volumetric inertia in mm^5 about `centerOfMass`. */
  readonly inertiaTensor: InertiaTensor;
}

export interface ShapeMeasurements extends VolumetricMassProperties {
  /** Boundary area in square model units (mm^2 for authored documents). */
  readonly surfaceArea: number;
  /** World-axis-aligned bounds in model coordinates. */
  readonly boundingBox: BoundingBox;
  readonly genus: number;
  /** Kernel geometric tolerance in model units. */
  readonly tolerance: number;
}

export type ResolvedTransformOperation =
  | { readonly kind: "translate"; readonly value: Vec3 }
  | { readonly kind: "rotate"; readonly value: Vec3 }
  | { readonly kind: "scale"; readonly value: Vec3 }
  | { readonly kind: "mirror"; readonly normal: Vec3 };

export interface KernelFeatureContext {
  readonly feature?: string;
  readonly signal?: AbortSignal;
  readonly tolerance?: number;
}

export interface GeometryKernel {
  readonly id: string;
  readonly capabilities: KernelCapabilities;

  box?(
    size: Vec3,
    center: boolean,
    context?: KernelFeatureContext,
  ): KernelShape;
  cylinder?(
    height: number,
    radiusBottom: number,
    radiusTop: number,
    center: boolean,
    segments?: number,
    context?: KernelFeatureContext,
  ): KernelShape;
  sphere?(
    radius: number,
    segments?: number,
    context?: KernelFeatureContext,
  ): KernelShape;
  extrude?(
    profile: ResolvedProfile,
    options: {
      readonly distance: number;
      readonly symmetric: boolean;
      readonly twist: number;
      readonly scaleTop: readonly [number, number];
      readonly divisions: number;
    },
    context?: KernelFeatureContext,
  ): KernelShape;
  revolve?(
    profile: ResolvedProfile,
    options: { readonly angle: number; readonly segments?: number },
    context?: KernelFeatureContext,
  ): KernelShape;
  loft?(
    profiles: readonly ResolvedProfile[],
    options: ResolvedLoftOptions,
    context?: KernelFeatureContext,
  ): KernelShape;
  sweep?(
    profile: ResolvedProfile,
    path: ResolvedPolylinePath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape;
  circularArcSweep?(
    profile: ResolvedProfile,
    path: ResolvedCircularArcPath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape;
  compositeSweep?(
    profile: ResolvedProfile,
    path: ResolvedCompositePath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape;
  boolean?(
    operation: "union" | "subtract" | "intersect",
    target: KernelShape,
    tools: readonly KernelShape[],
    context?: KernelFeatureContext,
  ): KernelShape;
  transform?(
    shape: KernelShape,
    operations: readonly ResolvedTransformOperation[],
    context?: KernelFeatureContext,
  ): KernelShape;
  fillet?(
    shape: KernelShape,
    /** Each key seeds a maximal tangent-connected contour. */
    edges: readonly KernelTopologyKey[],
    options: { readonly radius: number },
    context?: KernelFeatureContext,
  ): KernelShape;
  chamfer?(
    shape: KernelShape,
    /** Each key seeds a maximal tangent-connected contour. */
    edges: readonly KernelTopologyKey[],
    options: { readonly distance: number },
    context?: KernelFeatureContext,
  ): KernelShape;
  shell?(
    shape: KernelShape,
    /**
     * Exact input faces removed as openings; these keys do not propagate.
     * Protocol v1 requires round/arc joins at offset-face transitions.
     */
    openings: readonly KernelTopologyKey[],
    options: ResolvedShellOptions,
    context?: KernelFeatureContext,
  ): KernelShape;
  offset?(
    shape: KernelShape,
    /** Protocol v1 requires round/arc joins at face transitions. */
    options: ResolvedOffsetOptions,
    context?: KernelFeatureContext,
  ): KernelShape;
  draft?(
    shape: KernelShape,
    /** Exact input faces drafted together in one atomic operation. */
    faces: readonly KernelTopologyKey[],
    options: ResolvedDraftOptions,
    context?: KernelFeatureContext,
  ): KernelShape;
  topology?(shape: KernelShape): KernelTopologySnapshot;
  importShape?(
    data: string | ArrayBuffer | Uint8Array,
    format: KernelExchangeFormat,
    context?: KernelFeatureContext,
  ): KernelShape;
  exportShape?(
    shape: KernelShape,
    format: KernelExchangeFormat,
    context?: KernelFeatureContext,
  ): Uint8Array;
  mesh(shape: KernelShape, options?: MeshOptions): MeshData;
  measure(shape: KernelShape): ShapeMeasurements;
  status(shape: KernelShape): KernelShapeStatus;
  disposeShape(shape: KernelShape): void;
  dispose(): void;
}

export interface TopologyGeometryKernel extends GeometryKernel {
  readonly capabilities: KernelCapabilities & {
    readonly topology: KernelTopologyCapabilities;
  };
  topology(shape: KernelShape): KernelTopologySnapshot;
}

export function kernelSupportsTopology(
  kernel: GeometryKernel,
): kernel is TopologyGeometryKernel {
  return kernel.capabilities.topology !== undefined && kernel.topology !== undefined;
}

export function transformMesh(mesh: MeshData, matrix: Mat4): MeshData {
  const positions = new Float32Array(mesh.positions.length);
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index]!;
    const y = mesh.positions[index + 1]!;
    const z = mesh.positions[index + 2]!;
    positions[index] =
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    positions[index + 1] =
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    positions[index + 2] =
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  }
  const indices = mesh.indices.slice();
  const determinant =
    matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6]) -
    matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2]) +
    matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]);
  if (determinant < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      const second = indices[index + 1]!;
      indices[index + 1] = indices[index + 2]!;
      indices[index + 2] = second;
    }
  }
  return { positions, indices };
}

export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  const positionLength = meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0);
  const indexLength = meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const positions = new Float32Array(positionLength);
  const indices = new Uint32Array(indexLength);
  let positionOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset);
    for (let index = 0; index < mesh.indices.length; index += 1) {
      indices[indexOffset + index] = mesh.indices[index]! + vertexOffset;
    }
    positionOffset += mesh.positions.length;
    indexOffset += mesh.indices.length;
    vertexOffset += mesh.positions.length / 3;
  }
  return { positions, indices };
}
