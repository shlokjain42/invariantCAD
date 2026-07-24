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
export type KernelDocumentBodyLengthUnit = "mm" | "cm" | "m" | "in";
export type KernelDocumentBodyUnitMode = "from-file" | "declared";

export const GEOMETRY_KERNEL_PROTOCOL_VERSION = 1 as const;
export const COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION = 1 as const;
export const EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION = 1 as const;
export const KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION = 1 as const;
export const KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION = 1 as const;
export const KERNEL_SHAPE_ARTIFACT_MAX_COMPATIBILITY_FINGERPRINT_BYTES =
  2_048 as const;

export type Awaitable<T> = T | PromiseLike<T>;

/**
 * Strong, backend-owned round-trip support for disposable kernel shapes.
 * Native exchange formats do not imply this capability.
 */
export interface KernelShapeArtifactCapabilities {
  readonly protocolVersion: typeof KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION;
  /** Globally stable codec namespace. */
  readonly format: string;
  /** Backend-owned wire-format version. */
  readonly formatVersion: number;
  /** Exact runtime, implementation, tolerance, and option compatibility. */
  readonly compatibilityFingerprint: string;
}

export interface KernelShapeArtifactContext {
  readonly feature: string;
  readonly signal?: AbortSignal;
  readonly maxArtifactBytes: number;
}

export interface KernelDocumentBodyImportFormatCapabilities {
  readonly format: KernelExchangeFormat;
  readonly unitModes: readonly KernelDocumentBodyUnitMode[];
}

/**
 * Strong imported-body support for canonical design documents.
 *
 * Unlike `nativeImports`, this capability promises that successful import
 * yields exactly one valid, positive-volume solid with no loose topology.
 */
export interface KernelDocumentBodyImportCapabilities {
  readonly protocolVersion: typeof KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION;
  readonly formats: readonly KernelDocumentBodyImportFormatCapabilities[];
}

export type KernelDocumentBodyImportUnits =
  | {
      /** Read units from a format that carries authoritative unit metadata. */
      readonly mode: "from-file";
    }
  | {
      /** Treat unitless source coordinates as this declared length unit. */
      readonly mode: "declared";
      readonly length: KernelDocumentBodyLengthUnit;
    };

export interface KernelDocumentBodyImportOptions {
  readonly format: KernelExchangeFormat;
  readonly units: KernelDocumentBodyImportUnits;
  /** Protocol v1 admits no geometry-changing healing operation. */
  readonly healing: {
    readonly mode: "none";
  };
}

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

export type KernelDocumentBodyImportCapabilitiesMalformedReason =
  | "not-object"
  | "unsupported-protocol-version"
  | "formats-not-array"
  | "invalid-format-entry"
  | "unknown-format"
  | "duplicate-format"
  | "unit-modes-not-array"
  | "invalid-unit-mode"
  | "duplicate-unit-mode"
  | "empty-unit-modes";

export interface KernelDocumentBodyImportCapabilitiesAbsent {
  readonly status: "absent";
}

export interface KernelDocumentBodyImportCapabilitiesValid {
  readonly status: "valid";
  /** A validated snapshot, isolated from later mutation of kernel metadata. */
  readonly capabilities: KernelDocumentBodyImportCapabilities;
}

export interface KernelDocumentBodyImportCapabilitiesMalformed {
  readonly status: "malformed";
  readonly reason: KernelDocumentBodyImportCapabilitiesMalformedReason;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type KernelDocumentBodyImportCapabilitiesInspection =
  | KernelDocumentBodyImportCapabilitiesAbsent
  | KernelDocumentBodyImportCapabilitiesValid
  | KernelDocumentBodyImportCapabilitiesMalformed;

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
  /** Optional strong shape round-trip contract; ordinary import/export is weaker. */
  readonly shapeArtifacts?: KernelShapeArtifactCapabilities;
  /** Optional strong single-solid import contract for document resources. */
  readonly documentBodyImport?: KernelDocumentBodyImportCapabilities;
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

/**
 * Validates and snapshots the optional strong document-body import envelope.
 *
 * Malformed metadata fails closed instead of being confused with an
 * unsupported format or unit combination.
 */
export function inspectKernelDocumentBodyImportCapabilities(
  capabilities: KernelCapabilities,
): KernelDocumentBodyImportCapabilitiesInspection {
  const raw: unknown = capabilities.documentBodyImport;
  if (raw === undefined) return { status: "absent" };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      status: "malformed",
      reason: "not-object",
      message: "Document-body import capability metadata must be an object",
      details: { actualType: metadataType(raw) },
    };
  }

  const metadata = raw as {
    readonly protocolVersion?: unknown;
    readonly formats?: unknown;
  };
  const protocolVersion: unknown = metadata.protocolVersion;
  const formatsValue: unknown = metadata.formats;
  if (
    protocolVersion !== KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION
  ) {
    return {
      status: "malformed",
      reason: "unsupported-protocol-version",
      message:
        "Document-body import capability metadata uses an unsupported protocol version",
      details: {
        expectedProtocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
        actualProtocolVersion: protocolVersion,
      },
    };
  }
  if (!Array.isArray(formatsValue)) {
    return {
      status: "malformed",
      reason: "formats-not-array",
      message: "Document-body import formats must be an array",
      details: { actualType: metadataType(formatsValue) },
    };
  }

  const knownFormats = new Set<KernelExchangeFormat>([
    "step",
    "brep",
    "brep-binary",
  ]);
  const knownModes = new Set<KernelDocumentBodyUnitMode>([
    "from-file",
    "declared",
  ]);
  const seenFormats = new Set<KernelExchangeFormat>();
  const formats: KernelDocumentBodyImportFormatCapabilities[] = [];
  for (let index = 0; index < formatsValue.length; index += 1) {
    if (!Object.hasOwn(formatsValue, index)) {
      return {
        status: "malformed",
        reason: "invalid-format-entry",
        message: "Document-body import formats must be a dense array",
        details: { index, actualType: "missing" },
      };
    }
    const entry: unknown = formatsValue[index];
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry)
    ) {
      return {
        status: "malformed",
        reason: "invalid-format-entry",
        message: "Each document-body import format must be an object",
        details: { index, actualType: metadataType(entry) },
      };
    }
    const candidate = entry as {
      readonly format?: unknown;
      readonly unitModes?: unknown;
    };
    const formatValue: unknown = candidate.format;
    const unitModesValue: unknown = candidate.unitModes;
    if (
      typeof formatValue !== "string" ||
      !knownFormats.has(formatValue as KernelExchangeFormat)
    ) {
      return {
        status: "malformed",
        reason: "unknown-format",
        message: "Document-body import capability contains an unknown format",
        details: { index, format: formatValue },
      };
    }
    const format = formatValue as KernelExchangeFormat;
    if (seenFormats.has(format)) {
      return {
        status: "malformed",
        reason: "duplicate-format",
        message: `Document-body import format '${format}' is duplicated`,
        details: { index, format },
      };
    }
    if (!Array.isArray(unitModesValue)) {
      return {
        status: "malformed",
        reason: "unit-modes-not-array",
        message: `Document-body import unit modes for '${format}' must be an array`,
        details: { index, actualType: metadataType(unitModesValue) },
      };
    }
    if (unitModesValue.length === 0) {
      return {
        status: "malformed",
        reason: "empty-unit-modes",
        message: `Document-body import format '${format}' must support at least one unit mode`,
        details: { index, format },
      };
    }

    const seenModes = new Set<KernelDocumentBodyUnitMode>();
    const unitModes: KernelDocumentBodyUnitMode[] = [];
    for (
      let modeIndex = 0;
      modeIndex < unitModesValue.length;
      modeIndex += 1
    ) {
      if (!Object.hasOwn(unitModesValue, modeIndex)) {
        return {
          status: "malformed",
          reason: "invalid-unit-mode",
          message: `Document-body import unit modes for '${format}' must be a dense array`,
          details: { index, modeIndex, actualType: "missing" },
        };
      }
      const mode: unknown = unitModesValue[modeIndex];
      if (
        typeof mode !== "string" ||
        !knownModes.has(mode as KernelDocumentBodyUnitMode)
      ) {
        return {
          status: "malformed",
          reason: "invalid-unit-mode",
          message: `Document-body import format '${format}' contains an unknown unit mode`,
          details: { index, modeIndex, mode },
        };
      }
      const knownMode = mode as KernelDocumentBodyUnitMode;
      if (seenModes.has(knownMode)) {
        return {
          status: "malformed",
          reason: "duplicate-unit-mode",
          message: `Document-body import unit mode '${knownMode}' is duplicated for '${format}'`,
          details: { index, modeIndex, format, mode: knownMode },
        };
      }
      seenModes.add(knownMode);
      unitModes.push(knownMode);
    }
    seenFormats.add(format);
    formats.push(
      Object.freeze({ format, unitModes: Object.freeze(unitModes) }),
    );
  }

  return {
    status: "valid",
    capabilities: Object.freeze({
      protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
      formats: Object.freeze(formats),
    }),
  };
}

export function kernelSupportsDocumentBodyImport(
  capabilities: KernelCapabilities,
  format: KernelExchangeFormat,
  unitMode: KernelDocumentBodyUnitMode,
): boolean {
  const inspection = inspectKernelDocumentBodyImportCapabilities(capabilities);
  return (
    inspection.status === "valid" &&
    inspection.capabilities.formats.some(
      (candidate) =>
        candidate.format === format &&
        candidate.unitModes.includes(unitMode),
    )
  );
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
  /**
   * Imports verified resource bytes as exactly one valid positive solid.
   *
   * `data` is borrowed for this call. The kernel must neither mutate nor retain
   * it. A successful result owns no loose topology and is disposed through
   * `disposeShape`; every failure releases all provisional native state.
   */
  importDocumentBody?(
    data: Uint8Array,
    options: KernelDocumentBodyImportOptions,
    context?: KernelFeatureContext,
  ): KernelShape;
  exportShape?(
    shape: KernelShape,
    format: KernelExchangeFormat,
    context?: KernelFeatureContext,
  ): Uint8Array;
  /**
   * Encodes without transferring ownership of `shape`. The payload must
   * preserve every evaluator-observable shape semantic promised by
   * `shapeArtifacts` and be a fresh, detached byte array owned by the caller.
   * `maxArtifactBytes` is a hard output/materialization ceiling. The codec must
   * observe cancellation at entry and during material work, and must not return
   * an oversized or partial payload.
   */
  encodeShapeArtifact?(
    shape: KernelShape,
    context: KernelShapeArtifactContext,
  ): Awaitable<Uint8Array>;
  /**
   * Returns one new live current-kernel shape owned by the caller. `artifact`
   * is borrowed for this call: the codec must not mutate or retain it.
   * `maxArtifactBytes` is a hard input/materialization ceiling. The codec must
   * observe cancellation at entry and during material work, dispose any
   * partially decoded native state on failure, and never return a partial
   * shape.
   */
  decodeShapeArtifact?(
    artifact: Uint8Array,
    context: KernelShapeArtifactContext,
  ): Awaitable<KernelShape>;
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
