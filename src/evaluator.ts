import type {
  ConfigurationId,
  EntityId,
  MaterialId,
  NodeId,
  ParameterId,
  ResourceId,
} from "./core/ids.js";
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  translationMatrix,
  type Mat4,
  type Vec3,
} from "./core/math.js";
import {
  createKernelShapeArtifactCacheKeyForCandidate,
  type ArtifactCacheSession,
  type KernelShapeArtifactCacheKey,
} from "./artifact-cache.js";
import {
  CadError,
  diagnostic,
  failure,
  hasErrors,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import { exportMesh, type MeshExportFormat } from "./exporters.js";
import {
  hashDesignFeatures,
  type DesignFeatureHashEntry,
} from "./feature-hashes.js";
import {
  evaluateExpression,
  type ExpressionIR,
} from "./expressions.js";
import {
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DOCUMENT_VERSION_V6,
  type AssemblyInstanceIR,
  type BodySetMemberIRV7,
  type BodySetNodeIRV7,
  type DesignConfigurationIR,
  type DesignDocument,
  type DesignDocumentV7,
  type ImportedBodyNodeIRV7,
  type MaterialDefinitionIR,
  type NodeIR,
  type NodeIRV7,
  type PartNodeIR,
  type PartNodeIRV7,
  type RefIR,
  type TopologySelectionIR,
  type TransformOperationIR,
} from "./ir.js";
import {
  COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
  DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP,
  EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
  GEOMETRY_KERNEL_PROTOCOL_VERSION,
  KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
  inspectKernelCompositeSweepCapabilities,
  inspectKernelDocumentBodyImportCapabilities,
  inspectKernelStepExportCapabilities,
  mergeMeshes,
  transformMesh,
  type BoundingBox,
  type GeometryKernel,
  type KernelCapabilityKind,
  type KernelCompositeSweepRefinement,
  type KernelDocumentBodyImportOptions,
  type KernelExchangeFormat,
  type KernelFeature,
  type KernelFeatureContext,
  type KernelPrimitive,
  type KernelRepresentation,
  type KernelShape,
  type KernelShapeExportContext,
  type KernelStepExportMetadata,
  type MeshData,
  type MeshOptions,
  type ResolvedTransformOperation,
  type ShapeMeasurements,
  kernelSupports,
  kernelSupportsTopology,
} from "./kernel.js";
import { validateRuledSolidLoftProfiles } from "./protocol/loft.js";
import {
  validateResolvedPath,
  type ResolvedCircularArcPath,
  type ResolvedCompositePath,
  type ResolvedPath,
} from "./protocol/path.js";
import {
  classifyResolvedCompositeSweepRefinements,
  validateResolvedSweep,
  type CompositeSweepRefinementClassificationSuccess,
} from "./protocol/sweep.js";
import { createManifoldKernel, type ManifoldKernelOptions } from "./manifold-kernel.js";
import type { OcctKernelOptions } from "./occt-kernel.js";
import {
  combineMassProperties,
  transformMassProperties,
} from "./internal/mesh-mass-properties.js";
import {
  validateResolvedProfileRegion,
} from "./internal/resolved-profile-region.js";
import { resolvedProfileRegionDiagnostic } from "./internal/resolved-profile-region-diagnostic.js";
import {
  combinePhysicalMassProperties,
  physicalMassProperties as scalePhysicalMassProperties,
  type PhysicalMassProperties,
} from "./mass-properties.js";
import {
  createReferenceSketchSolver,
  type SketchSolverBackend,
} from "./solver.js";
import type { ResolvedProfile } from "./protocol/profile.js";
import { validateDocument } from "./validation.js";
import {
  resolveTopologySelection,
  topologySelectionRequirements,
  type TopologyResolutionContext,
} from "./topology-resolution.js";
import type {
  KernelTopologyKey,
  KernelTopologySignatureCapabilities,
  KernelTopologySnapshot,
  TopologyKind,
} from "./protocol/topology.js";
import {
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1,
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2,
  type TopologySignatureLimits,
} from "./topology-signatures.js";
import {
  DRAFT_MIN_ANGLE_RADIANS,
  type ResolvedDraftOptions,
} from "./protocol/draft.js";
import { TopologyEvolutionProtocolError } from "./internal/topology-evolution.js";
import { normalizeKernelTopologySnapshot } from "./internal/topology-snapshot.js";
import {
  resolveEvaluationParameters,
  type EvaluationParameterOverride,
} from "./internal/evaluation-parameters.js";
import { getArtifactCacheSessionInternalAccess } from "./internal/artifact-cache-session-access.js";
import {
  getEvaluatorArtifactCacheCandidateBinding,
  type EvaluatorArtifactCacheCandidateBinding,
} from "./internal/evaluator-artifact-cache-candidate.js";
import {
  admitDocumentBytesToV7,
  parseDocumentValue,
  parseDocumentValueV7,
  type AdmittedDocumentSourceVersion,
} from "./serialization.js";
import {
  DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
  resolveResourcesV7,
  type ResourceResolutionLimitsV7,
  type ResourceResolverV7,
  type ResolvedResourcesV7,
  type DocumentV7ResourceScope,
} from "./resource-resolution.js";
import {
  DEFAULT_DESIGN_DOCUMENT_LIMITS,
  preflightDesignDocumentValue,
  type DesignDocumentLimits,
} from "./document-limits.js";
import {
  DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
  documentV7RuntimeIntrinsicsAreIntact,
  throwDocumentV7RuntimeIntegrityError,
} from "./internal/document-v7-runtime-integrity.js";
import {
  planStagedSolidGraphV7,
  stagedSolidNodeIsImportedBodyV7,
  type StagedSolidGraphLimitsV7,
  type StagedSolidGraphNodeV7,
  type StagedSolidGraphPlanV7,
  type StagedSolidGraphRootV7,
  type StagedSolidLeafNodeV7,
} from "./internal/document-v7-solid-graph-evaluation.js";

export type ParameterOverride = EvaluationParameterOverride;
export type ShapeExportFormat = MeshExportFormat | KernelExchangeFormat;
export type BinaryShapeExportFormat = "stl" | KernelExchangeFormat;
export type TextShapeExportFormat = Exclude<MeshExportFormat, "stl">;

/**
 * Caller-authored overrides for deterministic single-shape STEP metadata.
 *
 * The four identity/description overrides support Unicode scalar values other
 * than C0/C1 controls; unpaired UTF-16 surrogates are rejected. The OCCT
 * backend represents reverse solidus and non-ASCII values with Part 21 X2/X4
 * directives. An overridden `fileName`, `productId`, or `productName` must be
 * nonempty. `timestamp` must be a real `YYYY-MM-DDTHH:MM:SS` calendar value.
 */
export interface StepExportMetadata {
  /** Overrides STEP `FILE_NAME`; this need not be a filesystem path. */
  readonly fileName?: string;
  /** Overrides the fixed default with `YYYY-MM-DDTHH:MM:SS`. */
  readonly timestamp?: string;
  /** Overrides the exported single-product identifier. */
  readonly productId?: string;
  /** Overrides the exported single-product name. */
  readonly productName?: string;
  /** Overrides the exported single-product description. */
  readonly productDescription?: string;
}

/**
 * Options for the strong versioned STEP-export contract.
 *
 * Passing any options object, including `{}`, requires a valid kernel
 * `stepExport` envelope. Otherwise export fails with
 * `KERNEL_CAPABILITY_MISSING`. Omitting the second argument remains compatible
 * with weak native exporters, while supporting kernels automatically use
 * their strong deterministic defaults. Invalid option structure, metadata
 * content, calendar values, or authored-metadata size fail with
 * `EXPORT_OPTIONS_INVALID` and an option-relative JSON-Pointer path.
 */
export interface StepExportOptions {
  /** Caller-authored overrides merged over document and part identity. */
  readonly metadata?: StepExportMetadata;
  /** Synchronous cancellation state inspected without invoking shadows. */
  readonly signal?: AbortSignal;
  /**
   * Optional ceiling for the returned STEP bytes; the kernel's advertised
   * ceiling still applies. This does not bound native peak allocation.
   */
  readonly maxOutputBytes?: number;
}

export const EVALUATOR_PROFILES = Object.freeze([
  "mesh-preview",
  "mechanical-exact",
] as const);
export type EvaluatorProfile = (typeof EVALUATOR_PROFILES)[number];

export interface EvaluatorProfileInspection {
  readonly profile: EvaluatorProfile;
  readonly compatible: boolean;
  /**
   * Stable capability paths that the kernel does not satisfy. An empty array
   * means the kernel meets the complete profile contract.
   */
  readonly missing: readonly string[];
}

export interface EvaluationOptions {
  /** Exact document-owned configuration ID; omitted selects the base design. */
  readonly configuration?: string;
  readonly parameters?: Readonly<Record<string, ParameterOverride>>;
  readonly outputs?: readonly string[];
  readonly signal?: AbortSignal;
  readonly allowEmpty?: boolean;
  /** Operational work limits for resolving stored topology evidence. */
  readonly topologySignatureLimits?: Partial<TopologySignatureLimits>;
}

export interface CreateEvaluatorOptions {
  /**
   * Optional complete runtime contract. When omitted, the legacy behavior is
   * preserved: a supplied kernel is accepted as-is and otherwise Manifold is
   * created.
   *
   * `mesh-preview` creates Manifold by default. `mechanical-exact` creates the
   * stock OCCT backend by default.
   */
  readonly profile?: EvaluatorProfile;
  readonly kernel?: GeometryKernel;
  readonly manifold?: ManifoldKernelOptions;
  readonly occt?: OcctKernelOptions;
  readonly sketchSolver?: SketchSolverBackend;
}

const PROFILE_PRIMITIVES = Object.freeze([
  "box",
  "cylinder",
  "sphere",
] as const satisfies readonly KernelPrimitive[]);

const MESH_PREVIEW_FEATURES = Object.freeze([
  "extrude",
  "revolve",
  "boolean",
  "transform",
] as const satisfies readonly KernelFeature[]);

const MECHANICAL_EXACT_FEATURES = Object.freeze([
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "circularArcSweep",
  "compositeSweep",
  "boolean",
  "transform",
  "fillet",
  "chamfer",
  "shell",
  "offset",
] as const satisfies readonly KernelFeature[]);

const MECHANICAL_EXACT_EXCHANGE = Object.freeze([
  "step",
  "brep",
  "brep-binary",
] as const satisfies readonly KernelExchangeFormat[]);

const FEATURE_METHODS = {
  extrude: "extrude",
  revolve: "revolve",
  loft: "loft",
  sweep: "sweep",
  circularArcSweep: "circularArcSweep",
  compositeSweep: "compositeSweep",
  boolean: "boolean",
  transform: "transform",
  fillet: "fillet",
  chamfer: "chamfer",
  shell: "shell",
  offset: "offset",
  draft: "draft",
} as const satisfies Readonly<Record<KernelFeature, keyof GeometryKernel>>;

function hasCallableKernelMember(
  kernel: GeometryKernel,
  member: keyof GeometryKernel,
): boolean {
  return typeof kernel[member] === "function";
}

/**
 * Checks the complete baseline promised by one named evaluator profile.
 *
 * This is deliberately stronger than testing a representation string: it
 * checks capability metadata and the callable operations needed by the
 * profile, so applications can reject an incompatible runtime before model
 * evaluation begins.
 */
export function inspectEvaluatorProfile(
  kernel: GeometryKernel,
  profile: EvaluatorProfile,
): EvaluatorProfileInspection {
  if (!(EVALUATOR_PROFILES as readonly string[]).includes(profile)) {
    throw new TypeError(`Unknown evaluator profile '${String(profile)}'`);
  }

  const missing: string[] = [];
  const capabilities = kernel.capabilities;
  if (capabilities.protocolVersion !== GEOMETRY_KERNEL_PROTOCOL_VERSION) {
    missing.push(
      `protocolVersion:${GEOMETRY_KERNEL_PROTOCOL_VERSION}`,
    );
  }

  const expectedRepresentation =
    profile === "mesh-preview" ? "mesh" : "brep";
  if (capabilities.representation !== expectedRepresentation) {
    missing.push(`representation:${expectedRepresentation}`);
  }
  if (
    profile === "mechanical-exact" &&
    capabilities.exact !== true
  ) {
    missing.push("exact:true");
  }

  for (const primitive of PROFILE_PRIMITIVES) {
    if (
      !capabilities.primitives.includes(primitive) ||
      !hasCallableKernelMember(kernel, primitive)
    ) {
      missing.push(`primitive:${primitive}`);
    }
  }

  const features =
    profile === "mesh-preview"
      ? MESH_PREVIEW_FEATURES
      : MECHANICAL_EXACT_FEATURES;
  for (const feature of features) {
    if (
      !capabilities.features.includes(feature) ||
      !hasCallableKernelMember(kernel, FEATURE_METHODS[feature])
    ) {
      missing.push(`feature:${feature}`);
    }
  }

  if (profile === "mechanical-exact") {
    for (const format of MECHANICAL_EXACT_EXCHANGE) {
      if (
        !capabilities.nativeImports.includes(format) ||
        !hasCallableKernelMember(kernel, "importShape")
      ) {
        missing.push(`nativeImport:${format}`);
      }
      if (
        !capabilities.nativeExports.includes(format) ||
        !hasCallableKernelMember(kernel, "exportShape")
      ) {
        missing.push(`nativeExport:${format}`);
      }
    }

    const topology = capabilities.topology;
    for (const kind of ["face", "edge", "vertex"] as const) {
      if (topology?.kinds.includes(kind) !== true) {
        missing.push(`topology:${kind}`);
      }
    }
    if (topology?.semanticRoles !== true) {
      missing.push("topology:semanticRoles");
    }
    if (topology?.sketchSources !== true) {
      missing.push("topology:sketchSources");
    }
    if (topology?.geometry !== true) {
      missing.push("topology:geometry");
    }
    if (topology?.adjacency !== true) {
      missing.push("topology:adjacency");
    }
    if (!hasCallableKernelMember(kernel, "topology")) {
      missing.push("topology:snapshot");
    }
  }

  return Object.freeze({
    profile,
    compatible: missing.length === 0,
    missing: Object.freeze(missing),
  });
}

function snapshotPrivateEvaluationOptions(
  value: EvaluationOptions,
): CadResult<EvaluationOptions> {
  try {
    const configuration = value.configuration;
    const rawParameters = value.parameters;
    const rawOutputs = value.outputs;
    const signal = value.signal;
    const allowEmpty = value.allowEmpty;
    const rawTopologyLimits = value.topologySignatureLimits;
    const parameters = rawParameters === undefined
      ? undefined
      : Object.freeze(
          Object.fromEntries(
            Object.keys(rawParameters).map((key) => [key, rawParameters[key]!]),
          ),
        );
    const outputs = rawOutputs === undefined
      ? undefined
      : Object.freeze(Array.from(rawOutputs));
    const topologySignatureLimits = rawTopologyLimits === undefined
      ? undefined
      : Object.freeze({ ...rawTopologyLimits });
    return success(
      Object.freeze({
        ...(configuration === undefined ? {} : { configuration }),
        ...(parameters === undefined ? {} : { parameters }),
        ...(outputs === undefined ? {} : { outputs }),
        ...(signal === undefined ? {} : { signal }),
        ...(allowEmpty === undefined ? {} : { allowEmpty }),
        ...(topologySignatureLimits === undefined
          ? {}
          : { topologySignatureLimits }),
      }),
    );
  } catch (error) {
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(error, "Evaluation options could not be snapshotted"),
        { severity: "error" },
      ),
    );
  }
}

type SignatureCapabilityInspection =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | {
      readonly status: "valid";
      readonly value: readonly KernelTopologySignatureCapabilities[];
    };

function inspectTopologySignatureCapability(
  value: unknown,
): KernelTopologySignatureCapabilities | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "fingerprint" ||
    keys[1] !== "protocolVersion"
  ) {
    return undefined;
  }
  const protocolVersion = record.protocolVersion;
  const fingerprint = record.fingerprint;
  if (
    (protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1 &&
      protocolVersion !== TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2) ||
    typeof fingerprint !== "string" ||
    fingerprint.length === 0
  ) {
    return undefined;
  }
  return { protocolVersion, fingerprint };
}

function inspectTopologySignatureCapabilities(
  primary: unknown,
  compatibility: unknown,
): SignatureCapabilityInspection {
  if (primary === undefined && compatibility === undefined) {
    return { status: "missing" };
  }
  try {
    const inspectedPrimary = inspectTopologySignatureCapability(primary);
    if (inspectedPrimary === undefined) {
      return { status: "invalid" };
    }
    if (compatibility !== undefined && !Array.isArray(compatibility)) {
      return { status: "invalid" };
    }
    const compatibilityLength = Array.isArray(compatibility)
      ? compatibility.length
      : 0;
    if (compatibilityLength > 1) return { status: "invalid" };
    const profiles: KernelTopologySignatureCapabilities[] = [inspectedPrimary];
    if (Array.isArray(compatibility)) {
      for (let index = 0; index < compatibilityLength; index += 1) {
        if (!Object.hasOwn(compatibility, index)) {
          return { status: "invalid" };
        }
        const inspected = inspectTopologySignatureCapability(
          compatibility[index],
        );
        if (
          inspected === undefined ||
          inspected.protocolVersion >= inspectedPrimary.protocolVersion
        ) {
          return { status: "invalid" };
        }
        profiles.push(inspected);
      }
    }
    if (new Set(profiles.map((profile) => profile.protocolVersion)).size !== profiles.length) {
      return { status: "invalid" };
    }
    return {
      status: "valid",
      value: Object.freeze(
        profiles.sort(
          (first, second) => second.protocolVersion - first.protocolVersion,
        ),
      ),
    };
  } catch {
    return { status: "invalid" };
  }
}

export type MassDensitySource = "part" | "material";

export interface EvaluatedMaterial {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly massDensity: number;
  readonly metadata?: MaterialDefinitionIR["metadata"];
}

export interface BillOfMaterialsItem {
  readonly partNode: string;
  readonly partNumber: string | null;
  readonly description: string | null;
  readonly materialId: string | null;
  readonly material: string | null;
  readonly quantity: number;
  readonly occurrenceIds: readonly string[];
  readonly massDensity: number | null;
  readonly massDensitySource: MassDensitySource | null;
  /** Mass of the unplaced part definition, in kg. */
  readonly definitionMass: number | null;
  /** Mass of all actual occurrences after affine placement, in kg. */
  readonly totalMass: number | null;
}

export interface BillOfMaterials {
  readonly configurationId: string | null;
  readonly units: { readonly mass: "kg" };
  readonly items: readonly BillOfMaterialsItem[];
  readonly totalQuantity: number;
  readonly massComplete: boolean;
  /** Sum of rows whose density is known, in kg. */
  readonly knownMass: number;
  /** Complete mass in kg, or null when any row lacks density. */
  readonly totalMass: number | null;
}

interface ProfileValue {
  readonly kind: "profile";
  readonly profile: ResolvedProfile;
}

interface PathValue {
  readonly kind: "path";
  readonly path: ResolvedPath;
  readonly tolerance: number;
}

interface SolidValue {
  readonly kind: "solid";
  readonly shape: KernelShape;
}

interface PartValue {
  readonly kind: "part";
  readonly node: NodeId;
  readonly definition: PartNodeIR;
  readonly shape: KernelShape;
  readonly materialId?: MaterialId;
  readonly materialDefinition?: EvaluatedMaterial;
  readonly massDensity?: number;
  readonly massDensitySource?: MassDensitySource;
}

interface AssemblyOccurrence {
  readonly id: string;
  readonly part: PartValue;
  readonly transform: Mat4;
}

interface AssemblyValue {
  readonly kind: "assembly";
  readonly occurrences: readonly AssemblyOccurrence[];
}

type NodeValue = ProfileValue | PathValue | SolidValue | PartValue | AssemblyValue;

class EvaluationFailure extends Error {
  readonly diagnostic: Diagnostic;

  constructor(value: Diagnostic) {
    super(value.message);
    this.name = "EvaluationFailure";
    this.diagnostic = value;
  }
}

function mirrorMatrix(normal: Vec3): Mat4 {
  const magnitude = Math.hypot(...normal);
  if (magnitude < Number.EPSILON) {
    throw new RangeError("Mirror normal cannot be zero");
  }
  const [x, y, z] = normal.map((value) => value / magnitude) as unknown as Vec3;
  return [
    1 - 2 * x * x,
    -2 * x * y,
    -2 * x * z,
    0,
    -2 * y * x,
    1 - 2 * y * y,
    -2 * y * z,
    0,
    -2 * z * x,
    -2 * z * y,
    1 - 2 * z * z,
    0,
    0,
    0,
    0,
    1,
  ];
}

function operationMatrix(operation: ResolvedTransformOperation): Mat4 {
  switch (operation.kind) {
    case "translate":
      return translationMatrix(operation.value);
    case "rotate":
      return rotationMatrix(operation.value);
    case "scale":
      return scaleMatrix(operation.value);
    case "mirror":
      return mirrorMatrix(operation.normal);
  }
}

function operationsMatrix(operations: readonly ResolvedTransformOperation[]): Mat4 {
  let result = IDENTITY_MATRIX;
  for (const operation of operations) {
    result = multiplyMatrices(operationMatrix(operation), result);
  }
  return result;
}

function meshGeometryMeasurements(mesh: MeshData): Pick<
  ShapeMeasurements,
  "surfaceArea" | "boundingBox"
> {
  if (mesh.positions.length === 0) {
    const zero: Vec3 = [0, 0, 0];
    return {
      surfaceArea: 0,
      boundingBox: { min: zero, max: zero },
    };
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[index + axis]!;
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }
  let surfaceArea = 0;
  const vertex = (index: number): Vec3 => {
    const offset = index * 3;
    return [
      mesh.positions[offset]!,
      mesh.positions[offset + 1]!,
      mesh.positions[offset + 2]!,
    ];
  };
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = vertex(mesh.indices[index]!);
    const b = vertex(mesh.indices[index + 1]!);
    const c = vertex(mesh.indices[index + 2]!);
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross: Vec3 = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    surfaceArea += Math.hypot(...cross) / 2;
  }
  return {
    surfaceArea,
    boundingBox: { min, max },
  };
}

interface CapturedEvaluationOwnerDisposal {
  readonly disposeShape: (shape: KernelShape) => void;
  readonly shapes: readonly KernelShape[];
}

const evaluationOwnerDisposers =
  new WeakMap<object, CapturedEvaluationOwnerDisposal>();
const evaluationOwnerDocumentNames = new WeakMap<object, string>();
const evaluationOwnerDisposerGet = WeakMap.prototype.get;
const evaluationOwnerDisposerSet = WeakMap.prototype.set;
const evaluationOwnerReflectApply = Reflect.apply;
const evaluationOwnerReflectHas = Reflect.has;
const evaluationOwnerArrayIsArray = Array.isArray;
const evaluationOwnerArrayFrom = Array.from;
const evaluationOwnerObjectCreate = Object.create;
const evaluationOwnerObjectDefineProperty =
  Object.defineProperty;
const evaluationOwnerObjectFreeze = Object.freeze;
const evaluationOwnerObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const evaluationOwnerObjectGetPrototypeOf = Object.getPrototypeOf;
const evaluationOwnerObjectHasOwn = Object.hasOwn;
const evaluationOwnerNumberIsSafeInteger = Number.isSafeInteger;
const evaluationOwnerStringCharCodeAt = String.prototype.charCodeAt;
const EvaluationOwnerStepDOMException = DOMException;
const evaluationOwnerAbortSignalPrototype =
  typeof AbortSignal === "undefined"
    ? undefined
    : AbortSignal.prototype;
const evaluationOwnerAbortSignalAbortedGetter =
  evaluationOwnerAbortSignalPrototype === undefined
    ? undefined
    : Object.getOwnPropertyDescriptor(
        evaluationOwnerAbortSignalPrototype,
        "aborted",
      )?.get;

function installEvaluationInstanceMethod(
  instance: object,
  key: PropertyKey,
  method: CallableFunction,
): void {
  evaluationOwnerReflectApply(
    evaluationOwnerObjectDefineProperty,
    Object,
    [
      instance,
      key,
      {
        configurable: false,
        enumerable: false,
        writable: false,
        value: method,
      },
    ],
  );
}

class EvaluationOwner {
  #disposed = false;
  readonly #shapes: readonly KernelShape[];
  declare disposed: boolean;
  readonly kernel: GeometryKernel;
  readonly shapes: ReadonlySet<KernelShape>;
  readonly configurationId: string | null;

  constructor(
    kernel: GeometryKernel,
    shapes: ReadonlySet<KernelShape>,
    configurationId: string | null,
  ) {
    this.kernel = kernel;
    this.shapes = shapes;
    this.configurationId = configurationId;
    this.#shapes = evaluationOwnerReflectApply(
      evaluationOwnerObjectFreeze,
      Object,
      [
        evaluationOwnerReflectApply(
          evaluationOwnerArrayFrom,
          Array,
          [shapes],
        ),
      ],
    ) as readonly KernelShape[];
    evaluationOwnerReflectApply(
      evaluationOwnerObjectDefineProperty,
      Object,
      [
        this,
        "disposed",
        {
          configurable: false,
          enumerable: true,
          get: () => this.#disposed,
        },
      ],
    );
    installEvaluationOwnerMethods(this);
    evaluationOwnerReflectApply(
      evaluationOwnerObjectFreeze,
      Object,
      [this],
    );
  }

  assertLive(): void {
    if (this.#disposed) {
      throw new Error("This evaluation result has been disposed");
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    const capturedDisposal = evaluationOwnerReflectApply(
      evaluationOwnerDisposerGet,
      evaluationOwnerDisposers,
      [this],
    ) as CapturedEvaluationOwnerDisposal | undefined;
    if (capturedDisposal === undefined) {
      for (let index = 0; index < this.#shapes.length; index += 1) {
        this.kernel.disposeShape(this.#shapes[index]!);
      }
      this.#disposed = true;
      return;
    }

    this.#disposed = true;
    let firstError: unknown;
    let disposalFailed = false;
    for (let index = 0; index < capturedDisposal.shapes.length; index += 1) {
      try {
        capturedDisposal.disposeShape(capturedDisposal.shapes[index]!);
      } catch (error) {
        if (!disposalFailed) {
          firstError = error;
          disposalFailed = true;
        }
      }
    }
    if (disposalFailed) throw firstError;
  }
}

const evaluationOwnerAssertLive =
  EvaluationOwner.prototype.assertLive;
const evaluationOwnerDispose = EvaluationOwner.prototype.dispose;

function installEvaluationOwnerMethods(
  owner: EvaluationOwner,
): void {
  installEvaluationInstanceMethod(
    owner,
    "assertLive",
    evaluationOwnerAssertLive,
  );
  installEvaluationInstanceMethod(
    owner,
    "dispose",
    evaluationOwnerDispose,
  );
}

function captureEvaluationOwnerDisposer(
  owner: EvaluationOwner,
  shapes: ReadonlySet<KernelShape>,
  disposer: (shape: KernelShape) => void,
): void {
  const capturedShapes = evaluationOwnerReflectApply(
    evaluationOwnerObjectFreeze,
    Object,
    [
      evaluationOwnerReflectApply(
        evaluationOwnerArrayFrom,
        Array,
        [shapes],
      ),
    ],
  ) as readonly KernelShape[];
  evaluationOwnerReflectApply(
    evaluationOwnerDisposerSet,
    evaluationOwnerDisposers,
    [
      owner,
      evaluationOwnerReflectApply(
        evaluationOwnerObjectFreeze,
        Object,
        [{ disposeShape: disposer, shapes: capturedShapes }],
      ),
    ],
  );
}

function captureEvaluationOwnerDocumentName(
  owner: EvaluationOwner,
  documentName: string,
): void {
  evaluationOwnerReflectApply(
    evaluationOwnerDisposerSet,
    evaluationOwnerDocumentNames,
    [owner, documentName],
  );
}

function evaluationOwnerDocumentName(owner: EvaluationOwner): string {
  const documentName = evaluationOwnerReflectApply(
    evaluationOwnerDisposerGet,
    evaluationOwnerDocumentNames,
    [owner],
  ) as string | undefined;
  if (documentName === undefined) {
    throw new TypeError("Evaluation owner has no document identity");
  }
  return documentName;
}

interface EvaluatedStepProductIdentity {
  readonly productId: string;
  readonly productName: string;
  readonly productDescription: string;
}

type StepExportCapabilityState =
  | {
      readonly status: "valid";
      readonly maxMetadataBytes: number;
    }
  | { readonly status: "absent" }
  | {
      readonly status: "malformed";
      readonly reason: string;
    };

interface CapturedStepExportOptions {
  readonly metadata?: StepExportMetadata;
  readonly signal?: AbortSignal;
  readonly maxOutputBytes?: number;
}

const evaluatedStepProductIdentities =
  new WeakMap<object, EvaluatedStepProductIdentity>();

function createEvaluationOwnerRecord(): Record<PropertyKey, unknown> {
  return evaluationOwnerReflectApply(
    evaluationOwnerObjectCreate,
    Object,
    [null],
  ) as Record<PropertyKey, unknown>;
}

function defineEvaluationOwnerRecordValue(
  record: Record<PropertyKey, unknown>,
  property: PropertyKey,
  value: unknown,
): void {
  evaluationOwnerReflectApply(
    evaluationOwnerObjectDefineProperty,
    Object,
    [
      record,
      property,
      {
        configurable: false,
        enumerable: true,
        writable: false,
        value,
      },
    ],
  );
}

function freezeEvaluationOwnerRecord<T extends object>(
  record: T,
): T {
  return evaluationOwnerReflectApply(
    evaluationOwnerObjectFreeze,
    Object,
    [record],
  ) as T;
}

function setEvaluatedStepProductIdentity(
  output: object,
  identity: EvaluatedStepProductIdentity,
): void {
  evaluationOwnerReflectApply(
    evaluationOwnerDisposerSet,
    evaluatedStepProductIdentities,
    [
      output,
      evaluationOwnerReflectApply(
        evaluationOwnerObjectFreeze,
        Object,
        [identity],
      ),
    ],
  );
}

function throwInvalidStepExport(
  message: string,
  path: string,
): never {
  const value = diagnostic("EXPORT_OPTIONS_INVALID", message, {
    severity: "error",
    path,
    details: { operation: "export", format: "step" },
  });
  throw new CadError(value.message, [value]);
}

function stepExportRecord(
  value: unknown,
  label: string,
  path: string,
): object {
  let array = false;
  try {
    array = evaluationOwnerReflectApply(
      evaluationOwnerArrayIsArray,
      Array,
      [value],
    ) as boolean;
  } catch {
    throwInvalidStepExport(
      `${label} could not be inspected safely`,
      path,
    );
  }
  if (typeof value !== "object" || value === null || array) {
    throwInvalidStepExport(`${label} must be an object`, path);
  }
  return value;
}

function stepExportOwnDataValue(
  value: object,
  property: PropertyKey,
  label: string,
  path: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  let inherited = false;
  try {
    descriptor = evaluationOwnerReflectApply(
      evaluationOwnerObjectGetOwnPropertyDescriptor,
      Object,
      [value, property],
    ) as PropertyDescriptor | undefined;
    if (descriptor === undefined) {
      inherited = evaluationOwnerReflectApply(
        evaluationOwnerReflectHas,
        Reflect,
        [value, property],
      ) as boolean;
    }
  } catch {
    throwInvalidStepExport(
      `${label} could not be inspected safely`,
      path,
    );
  }
  if (descriptor === undefined) {
    if (inherited) {
      throwInvalidStepExport(
        `${label} must be an own data property`,
        path,
      );
    }
    return undefined;
  }
  if (
    !(evaluationOwnerReflectApply(
      evaluationOwnerObjectHasOwn,
      Object,
      [descriptor, "value"],
    ) as boolean)
  ) {
    throwInvalidStepExport(
      `${label} must be an own data property`,
      path,
    );
  }
  return descriptor.value;
}

function stepExportOptionalString(
  value: unknown,
  label: string,
  path: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throwInvalidStepExport(`${label} must be a string`, path);
  }
  return value;
}

function stepExportCodeUnitAt(
  value: string,
  index: number,
): number {
  return evaluationOwnerReflectApply(
    evaluationOwnerStringCharCodeAt,
    value,
    [index],
  ) as number;
}

function validateStepExportTimestamp(
  value: string,
  label: string,
  path: string,
): void {
  if (value.length !== 19) {
    throwInvalidStepExport(
      `${label} must use YYYY-MM-DDTHH:MM:SS`,
      path,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = stepExportCodeUnitAt(value, index);
    const separator =
      index === 4 || index === 7
        ? 0x2d
        : index === 10
          ? 0x54
          : index === 13 || index === 16
            ? 0x3a
            : undefined;
    if (
      separator === undefined
        ? code < 0x30 || code > 0x39
        : code !== separator
    ) {
      throwInvalidStepExport(
        `${label} must use YYYY-MM-DDTHH:MM:SS`,
        path,
      );
    }
  }

  const decimalAt = (index: number): number =>
    stepExportCodeUnitAt(value, index) - 0x30;
  const decimalPairAt = (index: number): number =>
    decimalAt(index) * 10 + decimalAt(index + 1);
  const year =
    decimalAt(0) * 1_000 +
    decimalAt(1) * 100 +
    decimalAt(2) * 10 +
    decimalAt(3);
  const month = decimalPairAt(5);
  const day = decimalPairAt(8);
  const hour = decimalPairAt(11);
  const minute = decimalPairAt(14);
  const second = decimalPairAt(17);
  const leapYear =
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays =
    month === 2
      ? leapYear
        ? 29
        : 28
      : month === 4 || month === 6 || month === 9 || month === 11
        ? 30
        : 31;
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throwInvalidStepExport(
      `${label} is outside the supported calendar range`,
      path,
    );
  }
}

function validateStepExportMetadataString(
  value: string,
  label: string,
  path: string,
  nonempty: boolean,
  timestamp: boolean,
  maximumBytes: number,
  remainingBytes: number,
): number {
  if (nonempty && value.length === 0) {
    throwInvalidStepExport(`${label} must be nonempty`, path);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = stepExportCodeUnitAt(value, index);
    let utf8Bytes: number;
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = stepExportCodeUnitAt(value, index + 1);
      if (
        index + 1 >= value.length ||
        following < 0xdc00 ||
        following > 0xdfff
      ) {
        throwInvalidStepExport(
          `${label} must not contain unpaired surrogates`,
          path,
        );
      }
      utf8Bytes = 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throwInvalidStepExport(
        `${label} must not contain unpaired surrogates`,
        path,
      );
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      throwInvalidStepExport(
        `${label} must not contain control characters`,
        path,
      );
    } else if (code <= 0x7f) {
      utf8Bytes = 1;
    } else if (code <= 0x7ff) {
      utf8Bytes = 2;
    } else {
      utf8Bytes = 3;
    }
    if (utf8Bytes > remainingBytes) {
      throwInvalidStepExport(
        `Resolved STEP metadata exceeds maxMetadataBytes ${maximumBytes}`,
        path,
      );
    }
    remainingBytes -= utf8Bytes;
  }
  if (timestamp) {
    validateStepExportTimestamp(value, label, path);
  }
  return remainingBytes;
}

function captureStepExportMetadata(
  value: unknown,
): StepExportMetadata | undefined {
  if (value === undefined) return undefined;
  const metadata = stepExportRecord(
    value,
    "STEP export metadata",
    "/metadata",
  );
  const fileName = stepExportOptionalString(
    stepExportOwnDataValue(
      metadata,
      "fileName",
      "STEP export metadata.fileName",
      "/metadata/fileName",
    ),
    "STEP export metadata.fileName",
    "/metadata/fileName",
  );
  const timestamp = stepExportOptionalString(
    stepExportOwnDataValue(
      metadata,
      "timestamp",
      "STEP export metadata.timestamp",
      "/metadata/timestamp",
    ),
    "STEP export metadata.timestamp",
    "/metadata/timestamp",
  );
  const productId = stepExportOptionalString(
    stepExportOwnDataValue(
      metadata,
      "productId",
      "STEP export metadata.productId",
      "/metadata/productId",
    ),
    "STEP export metadata.productId",
    "/metadata/productId",
  );
  const productName = stepExportOptionalString(
    stepExportOwnDataValue(
      metadata,
      "productName",
      "STEP export metadata.productName",
      "/metadata/productName",
    ),
    "STEP export metadata.productName",
    "/metadata/productName",
  );
  const productDescription = stepExportOptionalString(
    stepExportOwnDataValue(
      metadata,
      "productDescription",
      "STEP export metadata.productDescription",
      "/metadata/productDescription",
    ),
    "STEP export metadata.productDescription",
    "/metadata/productDescription",
  );
  const captured = createEvaluationOwnerRecord();
  if (fileName !== undefined) {
    defineEvaluationOwnerRecordValue(captured, "fileName", fileName);
  }
  if (timestamp !== undefined) {
    defineEvaluationOwnerRecordValue(captured, "timestamp", timestamp);
  }
  if (productId !== undefined) {
    defineEvaluationOwnerRecordValue(captured, "productId", productId);
  }
  if (productName !== undefined) {
    defineEvaluationOwnerRecordValue(captured, "productName", productName);
  }
  if (productDescription !== undefined) {
    defineEvaluationOwnerRecordValue(
      captured,
      "productDescription",
      productDescription,
    );
  }
  return freezeEvaluationOwnerRecord(captured) as StepExportMetadata;
}

function stepExportSignalAborted(value: unknown): boolean {
  if (evaluationOwnerAbortSignalAbortedGetter === undefined) {
    throwInvalidStepExport(
      "STEP export signal is unsupported in this runtime",
      "/signal",
    );
  }
  let shadow: PropertyDescriptor | undefined;
  try {
    shadow = evaluationOwnerReflectApply(
      evaluationOwnerObjectGetOwnPropertyDescriptor,
      Object,
      [value, "aborted"],
    ) as PropertyDescriptor | undefined;
  } catch {
    throwInvalidStepExport(
      "STEP export signal could not be inspected safely",
      "/signal",
    );
  }
  if (shadow !== undefined) {
    throwInvalidStepExport(
      "STEP export signal must not shadow AbortSignal.aborted",
      "/signal",
    );
  }
  let owner: object | null = value as object;
  let resolvedNativeGetter = false;
  try {
    for (let depth = 0; depth < 64 && owner !== null; depth += 1) {
      const descriptor = evaluationOwnerReflectApply(
        evaluationOwnerObjectGetOwnPropertyDescriptor,
        Object,
        [owner, "aborted"],
      ) as PropertyDescriptor | undefined;
      if (descriptor !== undefined) {
        const data = evaluationOwnerReflectApply(
          evaluationOwnerObjectHasOwn,
          Object,
          [descriptor, "value"],
        ) as boolean;
        resolvedNativeGetter =
          owner === evaluationOwnerAbortSignalPrototype &&
          !data &&
          descriptor.get === evaluationOwnerAbortSignalAbortedGetter;
        break;
      }
      owner = evaluationOwnerReflectApply(
        evaluationOwnerObjectGetPrototypeOf,
        Object,
        [owner],
      ) as object | null;
    }
  } catch {
    throwInvalidStepExport(
      "STEP export signal prototype could not be inspected safely",
      "/signal",
    );
  }
  if (!resolvedNativeGetter) {
    throwInvalidStepExport(
      "STEP export signal must resolve AbortSignal.aborted through the native runtime getter",
      "/signal",
    );
  }
  try {
    const aborted = evaluationOwnerReflectApply(
      evaluationOwnerAbortSignalAbortedGetter,
      value,
      [],
    );
    if (typeof aborted === "boolean") return aborted;
  } catch {
    throwInvalidStepExport(
      "STEP export signal must be an AbortSignal",
      "/signal",
    );
  }
  throwInvalidStepExport(
    "STEP export signal must be an AbortSignal",
    "/signal",
  );
}

function captureStepExportSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  stepExportSignalAborted(value);
  return value as AbortSignal;
}

function assertCapturedStepExportSignalReady(
  options: CapturedStepExportOptions | undefined,
): void {
  const signal = options?.signal;
  if (signal !== undefined && stepExportSignalAborted(signal)) {
    throw new EvaluationOwnerStepDOMException(
      "STEP export was aborted",
      "AbortError",
    );
  }
}

function captureStepExportOptions(
  value: unknown,
): CapturedStepExportOptions | undefined {
  if (value === undefined) return undefined;
  const options = stepExportRecord(value, "STEP export options", "/");
  const rawMetadata = stepExportOwnDataValue(
    options,
    "metadata",
    "STEP export options.metadata",
    "/metadata",
  );
  const rawSignal = stepExportOwnDataValue(
    options,
    "signal",
    "STEP export options.signal",
    "/signal",
  );
  const rawMaxOutputBytes = stepExportOwnDataValue(
    options,
    "maxOutputBytes",
    "STEP export options.maxOutputBytes",
    "/maxOutputBytes",
  );
  const metadata = captureStepExportMetadata(rawMetadata);
  const maxOutputBytes = rawMaxOutputBytes;
  if (
    maxOutputBytes !== undefined &&
    (typeof maxOutputBytes !== "number" ||
      !(evaluationOwnerReflectApply(
        evaluationOwnerNumberIsSafeInteger,
        Number,
        [maxOutputBytes],
      ) as boolean) ||
      maxOutputBytes <= 0)
  ) {
    throwInvalidStepExport(
      "STEP export options.maxOutputBytes must be a positive safe integer",
      "/maxOutputBytes",
    );
  }
  const signal = captureStepExportSignal(rawSignal);
  const captured = createEvaluationOwnerRecord();
  if (metadata !== undefined) {
    defineEvaluationOwnerRecordValue(captured, "metadata", metadata);
  }
  if (signal !== undefined) {
    defineEvaluationOwnerRecordValue(captured, "signal", signal);
  }
  if (maxOutputBytes !== undefined) {
    defineEvaluationOwnerRecordValue(
      captured,
      "maxOutputBytes",
      maxOutputBytes,
    );
  }
  return freezeEvaluationOwnerRecord(
    captured,
  ) as CapturedStepExportOptions;
}

function resolveStepExportMetadataLimit(
  kernel: GeometryKernel,
  options: CapturedStepExportOptions | undefined,
  capturedState?: StepExportCapabilityState,
  capturedKernelId?: string,
): number | undefined {
  let status: "absent" | "malformed";
  let reason: string | undefined;
  if (capturedState === undefined) {
    const inspection = inspectKernelStepExportCapabilities(
      kernel.capabilities,
    );
    if (inspection.status === "valid") {
      return inspection.capabilities.maxMetadataBytes;
    }
    status = inspection.status;
    reason =
      inspection.status === "malformed"
        ? inspection.reason
        : undefined;
  } else {
    if (capturedState.status === "valid") {
      return capturedState.maxMetadataBytes;
    }
    status = capturedState.status;
    reason =
      capturedState.status === "malformed"
        ? capturedState.reason
        : undefined;
  }
  if (options === undefined) return undefined;
  const kernelId = capturedKernelId ?? kernel.id;
  const message =
    status === "absent"
      ? `Kernel '${kernelId}' does not advertise deterministic STEP export`
      : `Kernel '${kernelId}' advertises malformed deterministic STEP export metadata`;
  const value = diagnostic("KERNEL_CAPABILITY_MISSING", message, {
    severity: "error",
    details: {
      kernel: kernelId,
      capability: "stepExport",
      status,
      ...(reason === undefined ? {} : { reason }),
    },
  });
  throw new CadError(value.message, [value]);
}

function evaluatedStepExportContext(
  output: object,
  name: string,
  owner: EvaluationOwner,
  maxMetadataBytes: number,
  options?: CapturedStepExportOptions,
): KernelShapeExportContext {
  const identity =
    (evaluationOwnerReflectApply(
      evaluationOwnerDisposerGet,
      evaluatedStepProductIdentities,
      [output],
    ) as EvaluatedStepProductIdentity | undefined) ?? {
      productId: name,
      productName: name,
      productDescription: "",
    };
  const overrides = options?.metadata;
  const fileName =
    overrides?.fileName ?? evaluationOwnerDocumentName(owner);
  const timestamp =
    overrides?.timestamp ?? DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP;
  const productId = overrides?.productId ?? identity.productId;
  const productName = overrides?.productName ?? identity.productName;
  const productDescription =
    overrides?.productDescription ?? identity.productDescription;
  let remainingMetadataBytes = maxMetadataBytes;
  remainingMetadataBytes = validateStepExportMetadataString(
    fileName,
    "Resolved STEP metadata.fileName",
    "/metadata/fileName",
    true,
    false,
    maxMetadataBytes,
    remainingMetadataBytes,
  );
  remainingMetadataBytes = validateStepExportMetadataString(
    timestamp,
    "Resolved STEP metadata.timestamp",
    "/metadata/timestamp",
    false,
    true,
    maxMetadataBytes,
    remainingMetadataBytes,
  );
  remainingMetadataBytes = validateStepExportMetadataString(
    productId,
    "Resolved STEP metadata.productId",
    "/metadata/productId",
    true,
    false,
    maxMetadataBytes,
    remainingMetadataBytes,
  );
  remainingMetadataBytes = validateStepExportMetadataString(
    productName,
    "Resolved STEP metadata.productName",
    "/metadata/productName",
    true,
    false,
    maxMetadataBytes,
    remainingMetadataBytes,
  );
  validateStepExportMetadataString(
    productDescription,
    "Resolved STEP metadata.productDescription",
    "/metadata/productDescription",
    false,
    false,
    maxMetadataBytes,
    remainingMetadataBytes,
  );
  const metadataRecord = createEvaluationOwnerRecord();
  defineEvaluationOwnerRecordValue(
    metadataRecord,
    "fileName",
    fileName,
  );
  defineEvaluationOwnerRecordValue(
    metadataRecord,
    "timestamp",
    timestamp,
  );
  defineEvaluationOwnerRecordValue(
    metadataRecord,
    "productId",
    productId,
  );
  defineEvaluationOwnerRecordValue(
    metadataRecord,
    "productName",
    productName,
  );
  defineEvaluationOwnerRecordValue(
    metadataRecord,
    "productDescription",
    productDescription,
  );
  const metadata = freezeEvaluationOwnerRecord(
    metadataRecord,
  ) as unknown as KernelStepExportMetadata;

  const stepExportRecord = createEvaluationOwnerRecord();
  defineEvaluationOwnerRecordValue(
    stepExportRecord,
    "protocolVersion",
    KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
  );
  defineEvaluationOwnerRecordValue(
    stepExportRecord,
    "metadata",
    metadata,
  );
  if (options?.maxOutputBytes !== undefined) {
    defineEvaluationOwnerRecordValue(
      stepExportRecord,
      "maxOutputBytes",
      options.maxOutputBytes,
    );
  }
  const stepExport = freezeEvaluationOwnerRecord(stepExportRecord);

  const context = createEvaluationOwnerRecord();
  defineEvaluationOwnerRecordValue(context, "feature", name);
  if (options?.signal !== undefined) {
    defineEvaluationOwnerRecordValue(context, "signal", options.signal);
  }
  defineEvaluationOwnerRecordValue(context, "stepExport", stepExport);
  return freezeEvaluationOwnerRecord(
    context,
  ) as KernelShapeExportContext;
}

function evaluatedWeakExportContext(
  name: string,
): KernelShapeExportContext {
  const context = createEvaluationOwnerRecord();
  defineEvaluationOwnerRecordValue(context, "feature", name);
  return freezeEvaluationOwnerRecord(
    context,
  ) as KernelShapeExportContext;
}

export class EvaluatedSolid {
  readonly name: string;
  protected readonly owner: EvaluationOwner;
  protected readonly shape: KernelShape;

  constructor(name: string, owner: EvaluationOwner, shape: KernelShape) {
    this.name = name;
    this.owner = owner;
    this.shape = shape;
    setEvaluatedStepProductIdentity(this, {
      productId: name,
      productName: name,
      productDescription: "",
    });
  }

  mesh(options?: MeshOptions): MeshData {
    this.owner.assertLive();
    return this.owner.kernel.mesh(this.shape, options);
  }

  measure(): ShapeMeasurements {
    this.owner.assertLive();
    return this.owner.kernel.measure(this.shape);
  }

  /**
   * Returns the evaluation-scoped face/edge snapshot for signature capture,
   * selection explanation, and other topology-aware analysis.
   */
  topology(): CadResult<KernelTopologySnapshot> {
    this.owner.assertLive();
    if (!kernelSupportsTopology(this.owner.kernel)) {
      return failure(
        diagnostic(
          "KERNEL_CAPABILITY_MISSING",
          `Kernel '${this.owner.kernel.id}' does not expose topology snapshots`,
          {
            severity: "error",
            details: {
              kernel: this.owner.kernel.id,
              kind: "topology",
              capability: "snapshot",
            },
          },
        ),
      );
    }
    try {
      return normalizeKernelTopologySnapshot(
        this.owner.kernel.topology(this.shape),
      );
    } catch (error) {
      return failure(
        diagnostic(
          "KERNEL_ERROR",
          safeErrorMessage(error, "Geometry kernel topology access failed"),
          {
            severity: "error",
            details: { kernel: this.owner.kernel.id },
          },
        ),
      );
    }
  }

  /**
   * Exports one STEP shape, optionally requesting the strong STEP contract.
   *
   * Invalid STEP options throw `CadError` with `EXPORT_OPTIONS_INVALID`;
   * cancellation continues to throw `AbortError`.
   */
  export(format: "step", options?: StepExportOptions): Uint8Array;
  export(format: BinaryShapeExportFormat): Uint8Array;
  export(format: TextShapeExportFormat): string;
  export(format: ShapeExportFormat): Uint8Array | string;
  export(
    format: ShapeExportFormat,
    options?: StepExportOptions,
  ): Uint8Array | string {
    if (format !== "step" && options !== undefined) {
      throwInvalidStepExport(
        "STEP export options require the 'step' format",
        "/",
      );
    }
    if (
      format === "stl" ||
      format === "stl-ascii" ||
      format === "obj"
    ) {
      return exportMesh(this.mesh(), format, this.name);
    }
    this.owner.assertLive();
    if (
      !kernelSupports(this.owner.kernel.capabilities, "nativeExport", format) ||
      this.owner.kernel.exportShape === undefined
    ) {
      const value = diagnostic(
        "EXPORT_UNSUPPORTED",
        `Kernel '${this.owner.kernel.id}' cannot export ${format}`,
        {
          severity: "error",
          details: { kernel: this.owner.kernel.id, format },
        },
      );
      throw new CadError(value.message, [value]);
    }
    const capturedOptions =
      format === "step"
        ? captureStepExportOptions(options)
        : undefined;
    const stepMetadataLimit =
      format === "step"
        ? resolveStepExportMetadataLimit(
            this.owner.kernel,
            capturedOptions,
          )
        : undefined;
    this.owner.assertLive();
    assertCapturedStepExportSignalReady(capturedOptions);
    return this.owner.kernel.exportShape(
      this.shape,
      format,
      stepMetadataLimit !== undefined
        ? evaluatedStepExportContext(
            this,
            this.name,
            this.owner,
            stepMetadataLimit,
            capturedOptions,
          )
        : evaluatedWeakExportContext(this.name),
    );
  }
}

interface StagedV7SolidKernelAccess {
  readonly id: string;
  readonly nativeExports: readonly KernelExchangeFormat[];
  readonly stepExport: StepExportCapabilityState;
  readonly mesh: GeometryKernel["mesh"];
  readonly measure: GeometryKernel["measure"];
  readonly topology?: NonNullable<GeometryKernel["topology"]>;
  readonly exportShape?: NonNullable<GeometryKernel["exportShape"]>;
}

interface StagedBodySetEvaluatedSolidV7State {
  readonly owner: EvaluationOwner;
  readonly shape: KernelShape;
  readonly access: StagedV7SolidKernelAccess;
}

const stagedBodySetEvaluatedSolidV7States =
  new WeakMap<object, StagedBodySetEvaluatedSolidV7State>();

/**
 * Retains the staged body-set kernel observation boundary without changing
 * the ordinary EvaluatedSolid path used by frozen document versions.
 */
class StagedBodySetEvaluatedSolidV7 extends EvaluatedSolid {
  readonly #access: StagedV7SolidKernelAccess;

  constructor(
    name: string,
    owner: EvaluationOwner,
    shape: KernelShape,
    access: StagedV7SolidKernelAccess,
  ) {
    super(name, owner, shape);
    this.#access = access;
    evaluationOwnerReflectApply(
      evaluationOwnerDisposerSet,
      stagedBodySetEvaluatedSolidV7States,
      [
        this,
        evaluationOwnerReflectApply(
          evaluationOwnerObjectFreeze,
          Object,
          [{ owner, shape, access }],
        ),
      ],
    );
    installStagedBodySetEvaluatedSolidV7Methods(this);
    evaluationOwnerReflectApply(
      evaluationOwnerObjectFreeze,
      Object,
      [this],
    );
  }

  override mesh(options?: MeshOptions): MeshData {
    this.owner.assertLive();
    return evaluationOwnerReflectApply(
      this.#access.mesh,
      this.owner.kernel,
      [this.shape, options],
    ) as MeshData;
  }

  override measure(): ShapeMeasurements {
    this.owner.assertLive();
    return evaluationOwnerReflectApply(
      this.#access.measure,
      this.owner.kernel,
      [this.shape],
    ) as ShapeMeasurements;
  }

  override topology(): CadResult<KernelTopologySnapshot> {
    this.owner.assertLive();
    if (this.#access.topology === undefined) {
      return failure(
        diagnostic(
          "KERNEL_CAPABILITY_MISSING",
          `Kernel '${this.#access.id}' does not expose topology snapshots`,
          {
            severity: "error",
            details: {
              kernel: this.#access.id,
              kind: "topology",
              capability: "snapshot",
            },
          },
        ),
      );
    }
    try {
      return normalizeKernelTopologySnapshot(
        evaluationOwnerReflectApply(
          this.#access.topology,
          this.owner.kernel,
          [this.shape],
        ) as KernelTopologySnapshot,
      );
    } catch (error) {
      return failure(
        diagnostic(
          "KERNEL_ERROR",
          bodySetThrownCause(
            error,
            "Geometry kernel topology access failed with an opaque value",
          ),
          {
            severity: "error",
            details: { kernel: this.#access.id },
          },
        ),
      );
    }
  }

  override export(format: "step", options?: StepExportOptions): Uint8Array;
  override export(format: BinaryShapeExportFormat): Uint8Array;
  override export(format: TextShapeExportFormat): string;
  override export(format: ShapeExportFormat): Uint8Array | string;
  override export(
    format: ShapeExportFormat,
    options?: StepExportOptions,
  ): Uint8Array | string {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      throwDocumentV7RuntimeIntegrityError();
    }
    if (format !== "step" && options !== undefined) {
      throwInvalidStepExport(
        "STEP export options require the 'step' format",
        "/",
      );
    }
    if (
      format === "stl" ||
      format === "stl-ascii" ||
      format === "obj"
    ) {
      return exportMesh(this.mesh(), format, this.name);
    }
    this.owner.assertLive();
    let supported = false;
    for (let index = 0; index < this.#access.nativeExports.length; index += 1) {
      if (this.#access.nativeExports[index] === format) {
        supported = true;
        break;
      }
    }
    if (!supported || this.#access.exportShape === undefined) {
      const renderedFormat =
        typeof format === "string" ? format : "unsupported value";
      const value = diagnostic(
        "EXPORT_UNSUPPORTED",
        `Kernel '${this.#access.id}' cannot export ${renderedFormat}`,
        {
          severity: "error",
          details: {
            kernel: this.#access.id,
            format: renderedFormat,
          },
        },
      );
      throw new CadError(value.message, [value]);
    }
    try {
      const capturedOptions =
        format === "step"
          ? captureStepExportOptions(options)
          : undefined;
      const stepMetadataLimit =
        format === "step"
          ? resolveStepExportMetadataLimit(
              this.owner.kernel,
              capturedOptions,
              this.#access.stepExport,
              this.#access.id,
            )
          : undefined;
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        throwDocumentV7RuntimeIntegrityError();
      }
      this.owner.assertLive();
      assertCapturedStepExportSignalReady(capturedOptions);
      const context =
        stepMetadataLimit !== undefined
          ? evaluatedStepExportContext(
              this,
              this.name,
              this.owner,
              stepMetadataLimit,
              capturedOptions,
            )
          : evaluatedWeakExportContext(this.name);
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        throwDocumentV7RuntimeIntegrityError();
      }
      const exported = evaluationOwnerReflectApply(
        this.#access.exportShape,
        this.owner.kernel,
        [
          this.shape,
          format,
          context,
        ],
      ) as Uint8Array | string;
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        throwDocumentV7RuntimeIntegrityError();
      }
      return exported;
    } catch (error) {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        throwDocumentV7RuntimeIntegrityError();
      }
      throw error;
    }
  }
}

function partMassDensityPath(part: PartValue): string {
  if (part.definition.massDensity !== undefined) {
    return `/nodes/${part.node}/massDensity`;
  }
  if (part.materialId !== undefined) {
    return `/materials/${part.materialId}/massDensity`;
  }
  return `/nodes/${part.node}/massDensity`;
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function nonBlank(value: string | undefined): string | null {
  return value === undefined || value.trim().length === 0 ? null : value;
}

function affineVolumeScale(matrix: Mat4): number {
  if (!matrix.every(Number.isFinite)) {
    throw new RangeError("Occurrence transform matrix must be finite");
  }
  if (
    matrix[3] !== 0 ||
    matrix[7] !== 0 ||
    matrix[11] !== 0 ||
    matrix[15] !== 1
  ) {
    throw new RangeError("Occurrence mass requires an affine transform matrix");
  }
  return Math.abs(
    matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6]) -
      matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2]) +
      matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]),
  );
}

function createBillOfMaterials(
  name: string,
  owner: EvaluationOwner,
  occurrences: readonly AssemblyOccurrence[],
  directPart?: PartValue,
): CadResult<BillOfMaterials> {
  owner.assertLive();
  const grouped = new Map<
    NodeId,
    { readonly part: PartValue; readonly occurrences: AssemblyOccurrence[] }
  >();
  if (directPart !== undefined) {
    grouped.set(directPart.node, { part: directPart, occurrences: [] });
  }
  for (const occurrence of occurrences) {
    const existing = grouped.get(occurrence.part.node);
    if (existing === undefined) {
      grouped.set(occurrence.part.node, {
        part: occurrence.part,
        occurrences: [occurrence],
      });
    } else {
      existing.occurrences.push(occurrence);
    }
  }

  const groups = [...grouped.values()].sort((first, second) => {
    const firstNumber = nonBlank(first.part.definition.partNumber);
    const secondNumber = nonBlank(second.part.definition.partNumber);
    if (firstNumber === null && secondNumber !== null) return 1;
    if (firstNumber !== null && secondNumber === null) return -1;
    if (firstNumber !== null && secondNumber !== null) {
      const byNumber = lexicalCompare(firstNumber, secondNumber);
      if (byNumber !== 0) return byNumber;
    }
    return lexicalCompare(first.part.node, second.part.node);
  });
  const diagnostics: Diagnostic[] = [];
  const measuredShapes = new Map<KernelShape, ShapeMeasurements>();
  const items: BillOfMaterialsItem[] = [];

  for (const group of groups) {
    const { part } = group;
    const partNumber = nonBlank(part.definition.partNumber);
    const material = nonBlank(
      part.materialDefinition?.name ?? part.definition.material,
    );
    const occurrenceIds = group.occurrences
      .map((occurrence) => occurrence.id)
      .sort(lexicalCompare);
    const quantity = directPart === part ? 1 : group.occurrences.length;

    if (partNumber === null) {
      diagnostics.push(
        diagnostic(
          "BOM_PART_NUMBER_MISSING",
          `Part '${part.node}' has no part number`,
          {
            severity: "warning",
            node: part.node,
            path: `/nodes/${part.node}/partNumber`,
          },
        ),
      );
    }
    if (material === null) {
      diagnostics.push(
        diagnostic("BOM_MATERIAL_MISSING", `Part '${part.node}' has no material`, {
          severity: "warning",
          node: part.node,
          path:
            part.materialId === undefined
              ? `/nodes/${part.node}/material`
              : `/nodes/${part.node}/materialId`,
          hints: ["Reference a document material or author a legacy material label"],
        }),
      );
    }

    let definitionMass: number | null = null;
    let totalMass: number | null = null;
    if (part.massDensity === undefined) {
      diagnostics.push(
        diagnostic(
          "MASS_DENSITY_MISSING",
          `Part '${part.node}' has no authored mass density`,
          {
            severity: "warning",
            node: part.node,
            path: partMassDensityPath(part),
            hints: [
              "Author massDensity on the part or reference a material definition",
            ],
            details: { occurrenceIds },
          },
        ),
      );
    } else {
      try {
        let measured = measuredShapes.get(part.shape);
        if (measured === undefined) {
          measured = owner.kernel.measure(part.shape);
          measuredShapes.set(part.shape, measured);
        }
        definitionMass = measured.volume * part.massDensity;
        if (!Number.isFinite(definitionMass) || definitionMass < 0) {
          throw new RangeError("definition mass is not finite and non-negative");
        }
        if (directPart === part) {
          totalMass = definitionMass;
        } else {
          totalMass = 0;
          for (const occurrence of group.occurrences) {
            totalMass += definitionMass * affineVolumeScale(occurrence.transform);
          }
          if (!Number.isFinite(totalMass)) {
            throw new RangeError("occurrence mass total is not finite");
          }
        }
      } catch (error) {
        return failure(
          diagnostic(
            "MASS_PROPERTIES_INVALID",
            `Bill-of-materials mass for part '${part.node}' could not be represented`,
            {
              severity: "error",
              node: part.node,
              path: partMassDensityPath(part),
              details: {
                massDensity: part.massDensity,
                occurrenceIds,
                cause: error instanceof Error ? error.message : String(error),
              },
            },
          ),
        );
      }
    }

    items.push({
      partNode: part.node,
      partNumber,
      description: part.definition.description ?? null,
      materialId: part.materialId ?? null,
      material,
      quantity,
      occurrenceIds,
      massDensity: part.massDensity ?? null,
      massDensitySource: part.massDensitySource ?? null,
      definitionMass,
      totalMass,
    });
  }

  const partNumbers = new Map<string, string[]>();
  for (const item of items) {
    if (item.partNumber === null || item.partNumber.trim().length === 0) continue;
    const nodes = partNumbers.get(item.partNumber) ?? [];
    nodes.push(item.partNode);
    partNumbers.set(item.partNumber, nodes);
  }
  for (const [partNumber, partNodes] of [...partNumbers.entries()].sort(
    ([first], [second]) => lexicalCompare(first, second),
  )) {
    if (partNodes.length < 2) continue;
    diagnostics.push(
      diagnostic(
        "BOM_PART_NUMBER_DUPLICATE",
        `Part number '${partNumber}' is used by ${partNodes.length} distinct part definitions`,
        {
          severity: "warning",
          path: `/outputs/${name}`,
          details: { partNumber, partNodes },
        },
      ),
    );
  }

  const knownMass = items.reduce(
    (sum, item) => sum + (item.totalMass ?? 0),
    0,
  );
  const massComplete = items.every((item) => item.totalMass !== null);
  return success(
    {
      configurationId: owner.configurationId,
      units: { mass: "kg" },
      items,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      massComplete,
      knownMass,
      totalMass: massComplete ? knownMass : null,
    },
    diagnostics,
  );
}

export class EvaluatedPart extends EvaluatedSolid {
  readonly partNumber: string | undefined;
  readonly description: string | undefined;
  /** Legacy descriptive label, preserved exactly as authored. */
  readonly material: string | undefined;
  readonly materialId: string | undefined;
  readonly materialName: string | undefined;
  readonly materialDefinition: EvaluatedMaterial | undefined;
  readonly massDensity: number | undefined;
  readonly massDensitySource: MassDensitySource | undefined;
  private readonly partNode: NodeId;
  private readonly part: PartValue;

  constructor(name: string, owner: EvaluationOwner, part: PartValue) {
    super(name, owner, part.shape);
    this.partNumber = part.definition.partNumber;
    this.description = part.definition.description;
    this.material = part.definition.material;
    this.materialId = part.materialId;
    this.materialName = part.materialDefinition?.name;
    this.materialDefinition = part.materialDefinition;
    this.massDensity = part.massDensity;
    this.massDensitySource = part.massDensitySource;
    this.partNode = part.node;
    this.part = part;
    setEvaluatedStepProductIdentity(this, {
      productId: nonBlank(part.definition.partNumber) ?? part.node,
      productName: part.node,
      productDescription: part.definition.description ?? "",
    });
  }

  billOfMaterials(): CadResult<BillOfMaterials> {
    return createBillOfMaterials(this.name, this.owner, [], this.part);
  }

  physicalMassProperties(): CadResult<PhysicalMassProperties> {
    this.owner.assertLive();
    if (this.massDensity === undefined) {
      return failure(
        diagnostic(
          "MASS_DENSITY_MISSING",
          `Part '${this.partNode}' has no authored mass density`,
          {
            severity: "error",
            node: this.partNode,
            path: partMassDensityPath(this.part),
            hints: [
              "Author massDensity on the part or reference a material definition",
            ],
          },
        ),
      );
    }
    try {
      return success(scalePhysicalMassProperties(this.measure(), this.massDensity));
    } catch (error) {
      return failure(
        diagnostic(
          "MASS_PROPERTIES_INVALID",
          `Physical mass properties for part '${this.partNode}' could not be represented`,
          {
            severity: "error",
            node: this.partNode,
            path: partMassDensityPath(this.part),
            details: {
              massDensity: this.massDensity,
              cause: error instanceof Error ? error.message : String(error),
            },
          },
        ),
      );
    }
  }
}

export interface EvaluatedOccurrence {
  readonly id: string;
  readonly partNode: string;
  readonly partNumber?: string;
  readonly description?: string;
  readonly material?: string;
  readonly materialId?: string;
  readonly materialName?: string;
  readonly massDensity?: number;
  readonly massDensitySource?: MassDensitySource;
  readonly transform: Mat4;
}

export class EvaluatedAssembly {
  readonly name: string;
  readonly instances: readonly EvaluatedOccurrence[];
  private readonly owner: EvaluationOwner;
  private readonly occurrences: readonly AssemblyOccurrence[];

  constructor(
    name: string,
    owner: EvaluationOwner,
    occurrences: readonly AssemblyOccurrence[],
  ) {
    this.name = name;
    this.owner = owner;
    this.occurrences = occurrences;
    this.instances = occurrences.map((occurrence) => ({
      id: occurrence.id,
      partNode: occurrence.part.node,
      ...(occurrence.part.definition.partNumber === undefined
        ? {}
        : { partNumber: occurrence.part.definition.partNumber }),
      ...(occurrence.part.definition.description === undefined
        ? {}
        : { description: occurrence.part.definition.description }),
      ...(occurrence.part.definition.material === undefined
        ? {}
        : { material: occurrence.part.definition.material }),
      ...(occurrence.part.materialId === undefined
        ? {}
        : { materialId: occurrence.part.materialId }),
      ...(occurrence.part.materialDefinition === undefined
        ? {}
        : { materialName: occurrence.part.materialDefinition.name }),
      ...(occurrence.part.massDensity === undefined
        ? {}
        : { massDensity: occurrence.part.massDensity }),
      ...(occurrence.part.massDensitySource === undefined
        ? {}
        : { massDensitySource: occurrence.part.massDensitySource }),
      transform: occurrence.transform,
    }));
  }

  billOfMaterials(): CadResult<BillOfMaterials> {
    return createBillOfMaterials(
      this.name,
      this.owner,
      this.occurrences,
    );
  }

  mesh(options?: MeshOptions): MeshData {
    this.owner.assertLive();
    return mergeMeshes(
      this.occurrences.map((occurrence) =>
        transformMesh(
          this.owner.kernel.mesh(occurrence.part.shape, options),
          occurrence.transform,
        ),
      ),
    );
  }

  measure(): ShapeMeasurements {
    const geometry = meshGeometryMeasurements(this.mesh());
    const measuredShapes = new Map<KernelShape, ShapeMeasurements>();
    const massProperties = combineMassProperties(
      this.occurrences.map((occurrence) => {
        let measured = measuredShapes.get(occurrence.part.shape);
        if (measured === undefined) {
          measured = this.owner.kernel.measure(occurrence.part.shape);
          measuredShapes.set(occurrence.part.shape, measured);
        }
        return transformMassProperties(
          {
            volume: measured.volume,
            centerOfMass: measured.centerOfMass,
            inertiaTensor: measured.inertiaTensor,
          },
          occurrence.transform,
        );
      }),
    );
    return {
      ...massProperties,
      ...geometry,
      genus: null,
      tolerance: 0,
    };
  }

  physicalMassProperties(): CadResult<PhysicalMassProperties> {
    this.owner.assertLive();
    const missing = this.occurrences.filter(
      (occurrence) => occurrence.part.massDensity === undefined,
    );
    if (missing.length > 0) {
      const occurrenceIds = missing.map((occurrence) => occurrence.id);
      const partNodes = [...new Set(missing.map((occurrence) => occurrence.part.node))];
      return failure(
        diagnostic(
          "MASS_DENSITY_MISSING",
          `Assembly '${this.name}' has ${missing.length} active occurrence${
            missing.length === 1 ? "" : "s"
          } without authored mass density`,
          {
            severity: "error",
            path: `/outputs/${this.name}`,
            hints: ["Author massDensity on every active leaf part definition"],
            related: partNodes.map((partNode) => ({
              message: `Part '${partNode}' has no authored mass density`,
              node: partNode,
              path: partMassDensityPath(
                missing.find(
                  (occurrence) => occurrence.part.node === partNode,
                )!.part,
              ),
            })),
            details: { occurrenceIds, partNodes },
          },
        ),
      );
    }

    try {
      const measuredShapes = new Map<KernelShape, ShapeMeasurements>();
      return success(
        combinePhysicalMassProperties(
          this.occurrences.map((occurrence) => {
            let measured = measuredShapes.get(occurrence.part.shape);
            if (measured === undefined) {
              measured = this.owner.kernel.measure(occurrence.part.shape);
              measuredShapes.set(occurrence.part.shape, measured);
            }
            const transformed = transformMassProperties(
              {
                volume: measured.volume,
                centerOfMass: measured.centerOfMass,
                inertiaTensor: measured.inertiaTensor,
              },
              occurrence.transform,
            );
            return scalePhysicalMassProperties(
              transformed,
              occurrence.part.massDensity!,
            );
          }),
        ),
      );
    } catch (error) {
      return failure(
        diagnostic(
          "MASS_PROPERTIES_INVALID",
          `Physical mass properties for assembly '${this.name}' could not be represented`,
          {
            severity: "error",
            path: `/outputs/${this.name}`,
            details: {
              cause: error instanceof Error ? error.message : String(error),
            },
          },
        ),
      );
    }
  }

  export(format: "stl"): Uint8Array;
  export(format: TextShapeExportFormat): string;
  export(format: ShapeExportFormat): Uint8Array | string;
  export(format: ShapeExportFormat): Uint8Array | string {
    if (
      format !== "stl" &&
      format !== "stl-ascii" &&
      format !== "obj"
    ) {
      const value = diagnostic(
        "EXPORT_UNSUPPORTED",
        `Assembly '${this.name}' cannot be exported as ${format} yet`,
        {
          severity: "error",
          details: { output: this.name, format },
        },
      );
      throw new CadError(value.message, [value]);
    }
    return exportMesh(this.mesh(), format, this.name);
  }
}

export type EvaluatedOutput = EvaluatedSolid | EvaluatedPart | EvaluatedAssembly;

export class EvaluatedDesign {
  readonly configurationId: string | null;
  readonly parameters: Readonly<Record<string, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly outputNames: readonly string[];
  private readonly outputs: ReadonlyMap<string, EvaluatedOutput>;
  private readonly owner: EvaluationOwner;

  constructor(
    owner: EvaluationOwner,
    outputs: ReadonlyMap<string, EvaluatedOutput>,
    configurationId: string | null,
    parameters: Readonly<Record<string, number>>,
    diagnostics: readonly Diagnostic[],
  ) {
    this.owner = owner;
    this.outputs = outputs;
    this.outputNames = [...outputs.keys()];
    this.configurationId = configurationId;
    this.parameters = parameters;
    this.diagnostics = diagnostics;
  }

  output(name: string): EvaluatedOutput {
    this.owner.assertLive();
    const output = this.outputs.get(name);
    if (output === undefined) throw new RangeError(`Unknown evaluated output '${name}'`);
    return output;
  }

  dispose(): void {
    this.owner.dispose();
  }
}

const stagedImportedBodyEvaluatedSolidMeshV7 =
  EvaluatedSolid.prototype.mesh;
const stagedImportedBodyEvaluatedSolidMeasureV7 =
  EvaluatedSolid.prototype.measure;
const stagedImportedBodyEvaluatedSolidTopologyV7 =
  EvaluatedSolid.prototype.topology;
const stagedImportedBodyEvaluatedSolidExportV7 =
  EvaluatedSolid.prototype.export;
const stagedImportedBodyEvaluatedDesignOutputV7 =
  EvaluatedDesign.prototype.output;
const stagedImportedBodyEvaluatedDesignDisposeV7 =
  EvaluatedDesign.prototype.dispose;

function retainStagedImportedBodySolidV7(
  solid: EvaluatedSolid,
): EvaluatedSolid {
  installEvaluationInstanceMethod(
    solid,
    "mesh",
    stagedImportedBodyEvaluatedSolidMeshV7,
  );
  installEvaluationInstanceMethod(
    solid,
    "measure",
    stagedImportedBodyEvaluatedSolidMeasureV7,
  );
  installEvaluationInstanceMethod(
    solid,
    "topology",
    stagedImportedBodyEvaluatedSolidTopologyV7,
  );
  installEvaluationInstanceMethod(
    solid,
    "export",
    stagedImportedBodyEvaluatedSolidExportV7,
  );
  return evaluationOwnerReflectApply(
    evaluationOwnerObjectFreeze,
    Object,
    [solid],
  ) as EvaluatedSolid;
}

function retainStagedImportedBodyDesignV7(
  design: EvaluatedDesign,
): EvaluatedDesign {
  installEvaluationInstanceMethod(
    design,
    "output",
    stagedImportedBodyEvaluatedDesignOutputV7,
  );
  installEvaluationInstanceMethod(
    design,
    "dispose",
    stagedImportedBodyEvaluatedDesignDisposeV7,
  );
  evaluationOwnerReflectApply(
    evaluationOwnerObjectFreeze,
    Object,
    [design.outputNames],
  );
  return evaluationOwnerReflectApply(
    evaluationOwnerObjectFreeze,
    Object,
    [design],
  ) as EvaluatedDesign;
}

/**
 * One authored body-set member from the staged document-v7 evaluator.
 *
 * The descriptor and its metadata are detached from caller input and frozen.
 * `solid` exposes the ordinary single-shape mesh, measurement, topology, and
 * capability-gated export behavior without widening the public v6 output
 * union.
 *
 * @internal
 */
export interface EvaluatedBodyV7 {
  readonly id: EntityId;
  readonly node: NodeId;
  readonly name?: string;
  readonly metadata?: BodySetMemberIRV7["metadata"];
  readonly solid: EvaluatedSolid;
}

type EvaluatedPartDiagnosticIdentityV7 =
  | {
      readonly kind: "output";
      readonly output: string;
    }
  | {
      readonly kind: "externalAssemblyPart";
      readonly output: string;
      readonly outputKind: "assembly";
      readonly childPartNode: NodeId;
    };

type EvaluatedBodySetDiagnosticIdentityV7 =
  | EvaluatedPartDiagnosticIdentityV7
  | {
      readonly kind: "part";
      readonly output: string;
      readonly partNode: NodeId;
    };

function evaluatedPartBodySetDiagnosticIdentityV7(
  output: string,
  partNode: NodeId,
): EvaluatedBodySetDiagnosticIdentityV7 {
  return importedBodyApply<EvaluatedBodySetDiagnosticIdentityV7>(
    importedBodyObjectFreeze,
    Object,
    [{ kind: "part", output, partNode }],
  );
}

interface EvaluatedBodySetV7Backing {
  readonly owner: EvaluationOwner;
  readonly bodies: readonly EvaluatedBodyV7[];
  readonly bodyIds: readonly EntityId[];
  readonly bodiesById: ReadonlyMap<EntityId, EvaluatedBodyV7>;
  readonly representation: KernelRepresentation;
  readonly exact: boolean;
}

const evaluatedBodySetV7Backings =
  new WeakMap<object, EvaluatedBodySetV7Backing>();

function evaluatedBodySetV7Backing(
  bodies: readonly EvaluatedBodyV7[],
): EvaluatedBodySetV7Backing | undefined {
  return evaluationOwnerReflectApply(
    evaluationOwnerDisposerGet,
    evaluatedBodySetV7Backings,
    [bodies],
  ) as EvaluatedBodySetV7Backing | undefined;
}

function retainEvaluatedBodySetV7Backing(
  backing: EvaluatedBodySetV7Backing,
): void {
  evaluationOwnerReflectApply(
    evaluationOwnerDisposerSet,
    evaluatedBodySetV7Backings,
    [backing.bodies, backing],
  );
}

type CapturedEvaluatedBodySetMeshV7 =
  | { readonly ok: true; readonly value: MeshData }
  | { readonly ok: false; readonly reason: string };

function evaluatedBodySetV7DiagnosticPath(
  identity: EvaluatedBodySetDiagnosticIdentityV7,
): string {
  return identity.kind === "output"
    ? `/outputs/${importedBodyJsonPointerSegment(identity.output)}`
    : `/nodes/${importedBodyJsonPointerSegment(
        identity.kind === "part"
          ? identity.partNode
          : identity.childPartNode,
      )}/geometry`;
}

function evaluatedBodySetV7DiagnosticDetails(
  identity: EvaluatedBodySetDiagnosticIdentityV7,
): Readonly<Record<string, unknown>> {
  return identity.kind === "output"
    ? {
        phase: BODY_SET_EVALUATION_PHASE,
        output: identity.output,
        outputKind: "bodySet",
      }
    : identity.kind === "part"
      ? {
          phase: PART_EVALUATION_PHASE,
          output: identity.output,
          outputKind: "part",
          partNode: identity.partNode,
        }
      : {
          phase: PART_EVALUATION_PHASE,
          output: identity.output,
          outputKind: identity.outputKind,
          childPartNode: identity.childPartNode,
        };
}

function evaluatedBodySetV7RuntimeCadError(
  identity: EvaluatedBodySetDiagnosticIdentityV7,
): CadError {
  const item = diagnostic(
    "IR_INVALID",
    DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
    {
      severity: "error",
      path: evaluatedBodySetV7DiagnosticPath(identity),
      details: {
        ...evaluatedBodySetV7DiagnosticDetails(identity),
        runtimeIntegrity: false,
      },
    },
  );
  return new CadError(item.message, [item]);
}

function evaluatedBodySetV7MeshCadError(
  identity: EvaluatedBodySetDiagnosticIdentityV7,
  name: string,
  message: string,
  reason: string,
  body?: EvaluatedBodyV7,
  cause?: string,
): CadError {
  const item = diagnostic("KERNEL_ERROR", message, {
    severity: "error",
    ...(body === undefined ? {} : { node: body.node }),
    path: evaluatedBodySetV7DiagnosticPath(identity),
    details: {
      ...evaluatedBodySetV7DiagnosticDetails(identity),
      bodySet: name,
      reason,
      protocolViolation: true,
      ...(body === undefined
        ? {}
        : { bodyId: body.id, bodyNode: body.node }),
      ...(cause === undefined ? {} : { cause }),
    },
  });
  return new CadError(item.message, [item]);
}

function evaluatedBodySetV7IntrinsicTypedArrayLength(
  value: unknown,
  expectedPrototype: object,
): number | undefined {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      importedBodyTypedArrayLengthGetter === undefined ||
      importedBodyTypedArrayBufferGetter === undefined ||
      importedBodyArrayBufferByteLengthGetter === undefined ||
      importedBodyApply<object | null>(
        importedBodyObjectGetPrototypeOf,
        Object,
        [value],
      ) !== expectedPrototype
    ) {
      return undefined;
    }
    const length = importedBodyApply<unknown>(
      importedBodyTypedArrayLengthGetter,
      value,
      [],
    );
    if (
      typeof length !== "number" ||
      !importedBodyApply<boolean>(
        importedBodyNumberIsSafeInteger,
        Number,
        [length],
      ) ||
      length < 0
    ) {
      return undefined;
    }
    const buffer = importedBodyApply<unknown>(
      importedBodyTypedArrayBufferGetter,
      value,
      [],
    );
    if (
      typeof buffer !== "object" ||
      buffer === null ||
      importedBodyApply<object | null>(
        importedBodyObjectGetPrototypeOf,
        Object,
        [buffer],
      ) !== importedBodyArrayBufferPrototype
    ) {
      return undefined;
    }
    const byteLength = importedBodyApply<unknown>(
      importedBodyArrayBufferByteLengthGetter,
      buffer,
      [],
    );
    if (
      typeof byteLength !== "number" ||
      !importedBodyApply<boolean>(
        importedBodyNumberIsSafeInteger,
        Number,
        [byteLength],
      ) ||
      byteLength < 0
    ) {
      return undefined;
    }
    new ImportedBodyUint8Array(buffer as ArrayBuffer, 0, 0);
    return length;
  } catch {
    return undefined;
  }
}

function captureEvaluatedBodySetMeshV7(
  value: unknown,
): CapturedEvaluatedBodySetMeshV7 {
  try {
    const record = importedBodyOwnDataRecord(value, "/mesh");
    if (!record.ok) {
      return { ok: false, reason: "unsafe-mesh-record" };
    }
    const keys = importedBodyObjectKeyList(record.value);
    if (
      keys.length !== 2 ||
      !importedBodyApply<boolean>(
        importedBodyObjectHasOwn,
        Object,
        [record.value, "positions"],
      ) ||
      !importedBodyApply<boolean>(
        importedBodyObjectHasOwn,
        Object,
        [record.value, "indices"],
      )
    ) {
      return { ok: false, reason: "invalid-mesh-record-keys" };
    }
    const sourcePositions = record.value.positions;
    const sourceIndices = record.value.indices;
    const positionLength =
      evaluatedBodySetV7IntrinsicTypedArrayLength(
        sourcePositions,
        importedBodyFloat32ArrayPrototype,
      );
    const indexLength =
      evaluatedBodySetV7IntrinsicTypedArrayLength(
        sourceIndices,
        importedBodyUint32ArrayPrototype,
      );
    if (positionLength === undefined) {
      return {
        ok: false,
        reason: "positions-not-intrinsic-float32-array",
      };
    }
    if (indexLength === undefined) {
      return {
        ok: false,
        reason: "indices-not-intrinsic-uint32-array",
      };
    }
    if (positionLength % 3 !== 0) {
      return { ok: false, reason: "incomplete-xyz-positions" };
    }
    if (indexLength % 3 !== 0) {
      return { ok: false, reason: "incomplete-triangle-indices" };
    }
    const positions = new ImportedBodyFloat32Array(positionLength);
    for (let index = 0; index < positionLength; index += 1) {
      const coordinate = (sourcePositions as Float32Array)[index]!;
      if (
        !importedBodyApply<boolean>(
          importedBodyNumberIsFinite,
          Number,
          [coordinate],
        )
      ) {
        return { ok: false, reason: "non-finite-position" };
      }
      positions[index] = coordinate;
    }
    const vertexCount = positionLength / 3;
    const indices = new ImportedBodyUint32Array(indexLength);
    for (let index = 0; index < indexLength; index += 1) {
      const vertex = (sourceIndices as Uint32Array)[index]!;
      if (vertex >= vertexCount) {
        return {
          ok: false,
          reason: "mesh-index-out-of-bounds",
        };
      }
      indices[index] = vertex;
    }
    return {
      ok: true,
      value: importedBodyApply<MeshData>(
        importedBodyObjectFreeze,
        Object,
        [{ positions, indices }],
      ),
    };
  } catch {
    return { ok: false, reason: "unsafe-mesh-capture" };
  }
}

function mergeCapturedEvaluatedBodySetMeshesV7(
  meshes: readonly MeshData[],
): MeshData {
  let positionLength = 0;
  let indexLength = 0;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex]!;
    const meshPositionLength =
      evaluatedBodySetV7IntrinsicTypedArrayLength(
        mesh.positions,
        importedBodyFloat32ArrayPrototype,
      );
    const meshIndexLength =
      evaluatedBodySetV7IntrinsicTypedArrayLength(
        mesh.indices,
        importedBodyUint32ArrayPrototype,
      );
    if (
      meshPositionLength === undefined ||
      meshIndexLength === undefined ||
      positionLength >
        9_007_199_254_740_991 - meshPositionLength ||
      indexLength > 9_007_199_254_740_991 - meshIndexLength
    ) {
      throw new RangeError(
        "Body-set aggregate mesh lengths are not representable",
      );
    }
    positionLength += meshPositionLength;
    indexLength += meshIndexLength;
  }
  const positions = new ImportedBodyFloat32Array(positionLength);
  const indices = new ImportedBodyUint32Array(indexLength);
  let positionOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;
  for (let meshIndex = 0; meshIndex < meshes.length; meshIndex += 1) {
    const mesh = meshes[meshIndex]!;
    const meshPositionLength =
      evaluatedBodySetV7IntrinsicTypedArrayLength(
        mesh.positions,
        importedBodyFloat32ArrayPrototype,
      )!;
    const meshIndexLength =
      evaluatedBodySetV7IntrinsicTypedArrayLength(
        mesh.indices,
        importedBodyUint32ArrayPrototype,
      )!;
    for (let index = 0; index < meshPositionLength; index += 1) {
      positions[positionOffset + index] = mesh.positions[index]!;
    }
    for (let index = 0; index < meshIndexLength; index += 1) {
      indices[indexOffset + index] =
        mesh.indices[index]! + vertexOffset;
    }
    positionOffset += meshPositionLength;
    indexOffset += meshIndexLength;
    vertexOffset += meshPositionLength / 3;
  }
  return importedBodyApply<MeshData>(
    importedBodyObjectFreeze,
    Object,
    [{ positions, indices }],
  );
}

/**
 * Owned staged multibody output. Protocol v1 has no hidden primary or inactive
 * body: every descriptor in `bodies` is an active authored member.
 *
 * Aggregate geometry remains a mesh view. Exact STEP/BREP aggregate export is
 * unsupported until a versioned multi-shape kernel contract exists.
 *
 * @internal
 */
export class EvaluatedBodySetV7 {
  readonly name: string;
  readonly bodies: readonly EvaluatedBodyV7[];
  readonly bodyIds: readonly EntityId[];
  readonly representation: KernelRepresentation;
  readonly exact: boolean;
  readonly #owner: EvaluationOwner;
  readonly #bodiesById: ReadonlyMap<EntityId, EvaluatedBodyV7>;
  readonly #diagnosticIdentity: EvaluatedBodySetDiagnosticIdentityV7;

  constructor(
    name: string,
    owner: EvaluationOwner,
    bodies: readonly EvaluatedBodyV7[],
    representation: KernelRepresentation,
    exact: boolean,
    diagnosticIdentity?: EvaluatedBodySetDiagnosticIdentityV7,
  ) {
    this.name = name;
    const retained = evaluatedBodySetV7Backing(bodies);
    const backing =
      retained !== undefined &&
      retained.owner === owner &&
      retained.representation === representation &&
      retained.exact === exact
        ? retained
        : (() => {
            const copiedBodies = Object.freeze([...bodies]);
            const value =
              evaluationOwnerReflectApply(
                evaluationOwnerObjectFreeze,
                Object,
                [
                  {
                    owner,
                    bodies: copiedBodies,
                    bodyIds: Object.freeze(
                      copiedBodies.map((body) => body.id),
                    ),
                    bodiesById: new Map(
                      copiedBodies.map((body) => [
                        body.id,
                        body,
                      ]),
                    ),
                    representation,
                    exact,
                  },
                ],
              ) as EvaluatedBodySetV7Backing;
            retainEvaluatedBodySetV7Backing(value);
            return value;
          })();
    this.#owner = backing.owner;
    this.bodies = backing.bodies;
    this.bodyIds = backing.bodyIds;
    this.#bodiesById = backing.bodiesById;
    this.representation = backing.representation;
    this.exact = backing.exact;
    this.#diagnosticIdentity =
      diagnosticIdentity ??
      importedBodyApply<EvaluatedBodySetDiagnosticIdentityV7>(
        importedBodyObjectFreeze,
        Object,
        [{ kind: "output", output: name }],
      );
    installEvaluatedBodySetV7Methods(this);
    importedBodyApply<void>(importedBodyObjectFreeze, Object, [this]);
  }

  body(id: string): EvaluatedBodyV7 {
    this.#owner.assertLive();
    if (typeof id !== "string") {
      throw new TypeError(
        "Evaluated body-set body id must be a string",
      );
    }
    const body = importedBodyMapGetValue(
      this.#bodiesById,
      id as EntityId,
    );
    if (body === undefined) {
      throw new RangeError(
        `Unknown body '${id}' in evaluated body set '${this.name}'`,
      );
    }
    return body;
  }

  mesh(options?: MeshOptions): MeshData {
    const runtimeIntegrityWasIntact =
      documentV7RuntimeIntrinsicsAreIntact();
    this.#owner.assertLive();
    const meshes: MeshData[] = [];
    for (let index = 0; index < this.bodies.length; index += 1) {
      const body = this.bodies[index]!;
      let returned: unknown;
      try {
        returned = body.solid.mesh(options);
      } catch (error) {
        if (
          runtimeIntegrityWasIntact &&
          !documentV7RuntimeIntrinsicsAreIntact()
        ) {
          throw evaluatedBodySetV7RuntimeCadError(
            this.#diagnosticIdentity,
          );
        }
        throw evaluatedBodySetV7MeshCadError(
          this.#diagnosticIdentity,
          this.name,
          `Mesh callback failed for body '${body.id}' in body set '${this.name}'`,
          "mesh-callback-threw",
          body,
          safeErrorMessage(
            error,
            "Body-set mesh callback failed with an opaque value",
          ),
        );
      }
      if (
        runtimeIntegrityWasIntact &&
        !documentV7RuntimeIntrinsicsAreIntact()
      ) {
        throw evaluatedBodySetV7RuntimeCadError(
          this.#diagnosticIdentity,
        );
      }
      const captured = captureEvaluatedBodySetMeshV7(returned);
      if (
        runtimeIntegrityWasIntact &&
        !documentV7RuntimeIntrinsicsAreIntact()
      ) {
        throw evaluatedBodySetV7RuntimeCadError(
          this.#diagnosticIdentity,
        );
      }
      if (!captured.ok) {
        throw evaluatedBodySetV7MeshCadError(
          this.#diagnosticIdentity,
          this.name,
          `Kernel returned malformed mesh data for body '${body.id}' in body set '${this.name}'`,
          captured.reason,
          body,
        );
      }
      importedBodyArrayAppend(meshes, captured.value);
    }
    let merged: unknown;
    try {
      merged = runtimeIntegrityWasIntact
        ? mergeMeshes(meshes)
        : mergeCapturedEvaluatedBodySetMeshesV7(meshes);
    } catch (error) {
      if (
        runtimeIntegrityWasIntact &&
        !documentV7RuntimeIntrinsicsAreIntact()
      ) {
        throw evaluatedBodySetV7RuntimeCadError(
          this.#diagnosticIdentity,
        );
      }
      throw evaluatedBodySetV7MeshCadError(
        this.#diagnosticIdentity,
        this.name,
        `Aggregate mesh for body set '${this.name}' could not be represented`,
        "mesh-merge-failed",
        undefined,
        safeErrorMessage(
          error,
          "Body-set mesh aggregation failed with an opaque value",
        ),
      );
    }
    if (
      runtimeIntegrityWasIntact &&
      !documentV7RuntimeIntrinsicsAreIntact()
    ) {
      throw evaluatedBodySetV7RuntimeCadError(
        this.#diagnosticIdentity,
      );
    }
    const capturedMerged =
      captureEvaluatedBodySetMeshV7(merged);
    if (
      runtimeIntegrityWasIntact &&
      !documentV7RuntimeIntrinsicsAreIntact()
    ) {
      throw evaluatedBodySetV7RuntimeCadError(
        this.#diagnosticIdentity,
      );
    }
    if (!capturedMerged.ok) {
      throw evaluatedBodySetV7MeshCadError(
        this.#diagnosticIdentity,
        this.name,
        `Aggregate mesh for body set '${this.name}' is invalid`,
        `aggregate-${capturedMerged.reason}`,
      );
    }
    return capturedMerged.value;
  }

  export(format: "stl"): Uint8Array;
  export(format: TextShapeExportFormat): string;
  export(format: MeshExportFormat): Uint8Array | string;
  export(format: MeshExportFormat): Uint8Array | string {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      throw evaluatedBodySetV7RuntimeCadError(
        this.#diagnosticIdentity,
      );
    }
    this.#owner.assertLive();
    if (
      format !== "stl" &&
      format !== "stl-ascii" &&
      format !== "obj"
    ) {
      const renderedFormat =
        typeof format === "string" ? format : "unsupported value";
      const value = diagnostic(
        "EXPORT_UNSUPPORTED",
        `Aggregate exact export for body set '${this.name}' is unsupported for ${renderedFormat}`,
        {
          severity: "error",
          path: evaluatedBodySetV7DiagnosticPath(
            this.#diagnosticIdentity,
          ),
          details: {
            ...evaluatedBodySetV7DiagnosticDetails(
              this.#diagnosticIdentity,
            ),
            format: renderedFormat,
            aggregateExactExchange: false,
          },
        },
      );
      throw new CadError(value.message, [value]);
    }
    const exported = exportMesh(this.mesh(), format, this.name);
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      throw evaluatedBodySetV7RuntimeCadError(
        this.#diagnosticIdentity,
      );
    }
    return exported;
  }
}

/**
 * Source-only staged result container for direct document-v7 body-set outputs.
 *
 * @internal
 */
export class EvaluatedBodySetDesignV7 {
  readonly configurationId: string | null;
  readonly parameters: Readonly<Record<string, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly outputNames: readonly string[];
  readonly #outputs: ReadonlyMap<string, EvaluatedBodySetV7>;
  readonly #owner: EvaluationOwner;

  constructor(
    owner: EvaluationOwner,
    outputs: ReadonlyMap<string, EvaluatedBodySetV7>,
    configurationId: string | null,
    parameters: Readonly<Record<string, number>>,
    diagnostics: readonly Diagnostic[],
  ) {
    this.#owner = owner;
    this.#outputs = outputs;
    this.outputNames = Object.freeze([...outputs.keys()]);
    this.configurationId = configurationId;
    this.parameters = parameters;
    this.diagnostics = diagnostics;
    installEvaluatedBodySetDesignV7Methods(this);
    importedBodyApply<void>(importedBodyObjectFreeze, Object, [this]);
  }

  output(name: string): EvaluatedBodySetV7 {
    this.#owner.assertLive();
    const output = this.#outputs.get(name);
    if (output === undefined) {
      throw new RangeError(`Unknown evaluated body-set output '${name}'`);
    }
    return output;
  }

  dispose(): void {
    this.#owner.dispose();
  }
}

/**
 * Geometry owned by one staged document-v7 part result.
 *
 * A single solid retains ordinary native export and topology behavior through
 * `solid`. A body set retains authored body identity and per-body behavior
 * through `bodySet`; no aggregate B-Rep is synthesized.
 *
 * @internal
 */
export type EvaluatedPartGeometryV7 =
  | {
      readonly kind: "solid";
      readonly node: NodeId;
      readonly solid: EvaluatedSolid;
    }
  | {
      readonly kind: "bodySet";
      readonly node: NodeId;
      readonly bodySet: EvaluatedBodySetV7;
    };

interface EvaluatedPartValueV7 {
  readonly node: NodeId;
  readonly kernelId: string;
  readonly definition: PartNodeIRV7;
  readonly geometry: EvaluatedPartGeometryV7;
  readonly representation: KernelRepresentation;
  readonly exact: boolean;
  readonly materialId?: MaterialId;
  readonly materialDefinition?: EvaluatedMaterial;
  readonly massDensity?: number;
  readonly massDensitySource?: MassDensitySource;
}

interface EvaluatedPartV7ViewState {
  readonly owner: EvaluationOwner;
  readonly value: EvaluatedPartValueV7;
}

const evaluatedPartV7ViewStates =
  new WeakMap<object, EvaluatedPartV7ViewState>();

function evaluatedPartV7ViewState(
  part: EvaluatedPartV7,
): EvaluatedPartV7ViewState | undefined {
  return evaluationOwnerReflectApply(
    evaluationOwnerDisposerGet,
    evaluatedPartV7ViewStates,
    [part],
  ) as EvaluatedPartV7ViewState | undefined;
}

function retainEvaluatedPartV7ViewState(
  part: EvaluatedPartV7,
  state: EvaluatedPartV7ViewState,
): void {
  evaluationOwnerReflectApply(
    evaluationOwnerDisposerSet,
    evaluatedPartV7ViewStates,
    [part, state],
  );
}

function partV7MassDensityPath(part: EvaluatedPartValueV7): string {
  if (part.definition.massDensity !== undefined) {
    return `/nodes/${part.node}/massDensity`;
  }
  if (part.materialId !== undefined) {
    return `/materials/${part.materialId}/massDensity`;
  }
  return `/nodes/${part.node}/massDensity`;
}

function partV7NonBlank(value: string | undefined): string | null {
  if (value === undefined) return null;
  return importedBodyApply<string>(
    importedBodyStringTrim,
    value,
    [],
  ).length === 0
    ? null
    : value;
}

const PART_MEASUREMENT_SNAPSHOT_LIMITS = Object.freeze({
  ...DEFAULT_DESIGN_DOCUMENT_LIMITS,
  maxDocumentBytes: 16 * 1024,
  maxStructuralValues: 128,
  maxNestingDepth: 8,
});
const PART_MEASUREMENT_KEYS = Object.freeze([
  "volume",
  "surfaceArea",
  "boundingBox",
  "centerOfMass",
  "inertiaTensor",
  "genus",
  "tolerance",
] as const);
const PART_BOUNDING_BOX_KEYS = Object.freeze(["min", "max"] as const);

function partMeasurementExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    importedBodyArray(value)
  ) {
    return undefined;
  }
  const keys = importedBodyObjectKeyList(value);
  if (keys.length !== expectedKeys.length) return undefined;
  for (let index = 0; index < keys.length; index += 1) {
    let expected = false;
    for (
      let expectedIndex = 0;
      expectedIndex < expectedKeys.length;
      expectedIndex += 1
    ) {
      if (keys[index] === expectedKeys[expectedIndex]) {
        expected = true;
        break;
      }
    }
    if (!expected) return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function partMeasurementVector(value: unknown): Vec3 | undefined {
  if (!importedBodyArray(value) || value.length !== 3) return undefined;
  const first = value[0];
  const second = value[1];
  const third = value[2];
  if (
    typeof first !== "number" ||
    typeof second !== "number" ||
    typeof third !== "number" ||
    !importedBodyApply<boolean>(
      importedBodyNumberIsFinite,
      Number,
      [first],
    ) ||
    !importedBodyApply<boolean>(
      importedBodyNumberIsFinite,
      Number,
      [second],
    ) ||
    !importedBodyApply<boolean>(
      importedBodyNumberIsFinite,
      Number,
      [third],
    )
  ) {
    return undefined;
  }
  return importedBodyApply<Vec3>(
    importedBodyObjectFreeze,
    Object,
    [[first, second, third]],
  );
}

function partMeasurementTensor(
  value: unknown,
): ShapeMeasurements["inertiaTensor"] | undefined {
  if (!importedBodyArray(value) || value.length !== 3) return undefined;
  const first = partMeasurementVector(value[0]);
  const second = partMeasurementVector(value[1]);
  const third = partMeasurementVector(value[2]);
  if (first === undefined || second === undefined || third === undefined) {
    return undefined;
  }
  return importedBodyApply<ShapeMeasurements["inertiaTensor"]>(
    importedBodyObjectFreeze,
    Object,
    [[first, second, third]],
  );
}

function partMeasurementFailure(
  part: EvaluatedPartValueV7,
  leaf: NodeId,
  reason: string,
): CadResult<never> {
  return partKernelFailure(
    part.kernelId,
    `Kernel '${part.kernelId}' returned malformed measurements for part leaf '${leaf}'`,
    {
      node: leaf,
      path: `/nodes/${leaf}`,
      details: {
        protocolViolation: true,
        reason,
        part: part.node,
      },
    },
  );
}

function capturePartMeasurement(
  value: unknown,
  part: EvaluatedPartValueV7,
  leaf: NodeId,
): CadResult<ShapeMeasurements> {
  const captured = preflightDesignDocumentValue(
    value,
    PART_MEASUREMENT_SNAPSHOT_LIMITS,
    { strictV7Snapshot: true },
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  if (!captured.ok) {
    return partMeasurementFailure(
      part,
      leaf,
      "unsafe-measurement-snapshot",
    );
  }
  const measurement = partMeasurementExactRecord(
    captured.value,
    PART_MEASUREMENT_KEYS,
  );
  if (measurement === undefined) {
    return partMeasurementFailure(
      part,
      leaf,
      "invalid-measurement-record",
    );
  }
  const bounds = partMeasurementExactRecord(
    measurement.boundingBox,
    PART_BOUNDING_BOX_KEYS,
  );
  const minimum =
    bounds === undefined
      ? undefined
      : partMeasurementVector(bounds.min);
  const maximum =
    bounds === undefined
      ? undefined
      : partMeasurementVector(bounds.max);
  const center = partMeasurementVector(measurement.centerOfMass);
  const inertia = partMeasurementTensor(measurement.inertiaTensor);
  const volume = measurement.volume;
  const surfaceArea = measurement.surfaceArea;
  const genus = measurement.genus;
  const tolerance = measurement.tolerance;
  if (
    typeof volume !== "number" ||
    !importedBodyApply<boolean>(
      importedBodyNumberIsFinite,
      Number,
      [volume],
    ) ||
    !(volume > 0) ||
    typeof surfaceArea !== "number" ||
    !importedBodyApply<boolean>(
      importedBodyNumberIsFinite,
      Number,
      [surfaceArea],
    ) ||
    surfaceArea < 0 ||
    (genus !== null &&
      (typeof genus !== "number" ||
        !importedBodyApply<boolean>(
          importedBodyNumberIsSafeInteger,
          Number,
          [genus],
        ) ||
        genus < 0)) ||
    typeof tolerance !== "number" ||
    !importedBodyApply<boolean>(
      importedBodyNumberIsFinite,
      Number,
      [tolerance],
    ) ||
    tolerance < 0 ||
    minimum === undefined ||
    maximum === undefined ||
    center === undefined ||
    inertia === undefined
  ) {
    return partMeasurementFailure(
      part,
      leaf,
      "invalid-measurement-fields",
    );
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (minimum[axis]! > maximum[axis]!) {
      return partMeasurementFailure(
        part,
        leaf,
        "invalid-measurement-bounds",
      );
    }
  }
  const boundingBox = importedBodyApply<ShapeMeasurements["boundingBox"]>(
    importedBodyObjectFreeze,
    Object,
    [{ min: minimum, max: maximum }],
  );
  return success(
    importedBodyApply<ShapeMeasurements>(
      importedBodyObjectFreeze,
      Object,
      [
        {
          volume,
          surfaceArea,
          boundingBox,
          centerOfMass: center,
          inertiaTensor: inertia,
          genus,
          tolerance,
        },
      ],
    ),
  );
}

/**
 * Owned staged document-v7 part output.
 *
 * Mesh access is common to single- and multibody parts. Native single-shape
 * export remains available only through the discriminated `geometry.solid`;
 * this class deliberately exposes mesh formats only.
 *
 * Physical mass for a body set is the additive mass of every authored body
 * membership at one uniform effective part density. Overlapping bodies are not
 * Boolean-unioned or deduplicated.
 *
 * @internal
 */
export class EvaluatedPartV7 {
  readonly name: string;
  readonly node: NodeId;
  readonly geometry: EvaluatedPartGeometryV7;
  readonly representation: KernelRepresentation;
  readonly exact: boolean;
  readonly partNumber: string | undefined;
  readonly description: string | undefined;
  readonly metadata: PartNodeIRV7["metadata"] | undefined;
  /** Legacy descriptive label; never resolved as a material identifier. */
  readonly material: string | undefined;
  readonly materialId: string | undefined;
  readonly materialName: string | undefined;
  readonly materialDefinition: EvaluatedMaterial | undefined;
  readonly massDensity: number | undefined;
  readonly massDensitySource: MassDensitySource | undefined;
  readonly #name: string;
  readonly #owner: EvaluationOwner;
  readonly #value: EvaluatedPartValueV7;
  readonly #diagnosticIdentity: EvaluatedPartDiagnosticIdentityV7;

  constructor(
    name: string,
    owner: EvaluationOwner,
    part: EvaluatedPartValueV7,
    diagnosticIdentity?: EvaluatedPartDiagnosticIdentityV7,
  ) {
    this.name = name;
    this.#name = name;
    this.#owner = owner;
    this.#value = part;
    this.#diagnosticIdentity =
      diagnosticIdentity ??
      importedBodyApply<EvaluatedPartDiagnosticIdentityV7>(
        importedBodyObjectFreeze,
        Object,
        [{ kind: "output", output: name }],
      );
    this.node = part.node;
    this.geometry = part.geometry;
    this.representation = part.representation;
    this.exact = part.exact;
    this.partNumber = part.definition.partNumber;
    this.description = part.definition.description;
    this.metadata = part.definition.metadata;
    this.material = part.definition.material;
    this.materialId = part.materialId;
    this.materialName = part.materialDefinition?.name;
    this.materialDefinition = part.materialDefinition;
    this.massDensity = part.massDensity;
    this.massDensitySource = part.massDensitySource;
    if (part.geometry.kind === "solid") {
      setEvaluatedStepProductIdentity(part.geometry.solid, {
        productId:
          partV7NonBlank(part.definition.partNumber) ?? part.node,
        productName: part.node,
        productDescription: part.definition.description ?? "",
      });
    }
    retainEvaluatedPartV7ViewState(
      this,
      evaluationOwnerReflectApply(
        evaluationOwnerObjectFreeze,
        Object,
        [{ owner, value: part }],
      ) as EvaluatedPartV7ViewState,
    );
    installEvaluatedPartV7Methods(this);
    importedBodyApply<void>(importedBodyObjectFreeze, Object, [this]);
  }

  mesh(options?: MeshOptions): MeshData {
    this.#owner.assertLive();
    const geometry = this.#value.geometry;
    return geometry.kind === "solid"
      ? geometry.solid.mesh(options)
      : geometry.bodySet.mesh(options);
  }

  export(format: "stl"): Uint8Array;
  export(format: TextShapeExportFormat): string;
  export(format: MeshExportFormat): Uint8Array | string;
  export(format: MeshExportFormat): Uint8Array | string {
    this.#owner.assertLive();
    if (
      format !== "stl" &&
      format !== "stl-ascii" &&
      format !== "obj"
    ) {
      const renderedFormat =
        typeof format === "string" ? format : "unsupported value";
      const value = diagnostic(
        "EXPORT_UNSUPPORTED",
        this.#diagnosticIdentity.kind === "output"
          ? `Aggregate part export for '${this.#name}' is unsupported for ${renderedFormat}`
          : `Aggregate part export for child part '${this.#diagnosticIdentity.childPartNode}' is unsupported for ${renderedFormat}`,
        {
          severity: "error",
          node: this.#value.node,
          details:
            this.#diagnosticIdentity.kind === "output"
              ? { output: this.#name, format: renderedFormat }
              : {
                  output: this.#diagnosticIdentity.output,
                  outputKind:
                    this.#diagnosticIdentity.outputKind,
                  childPartNode:
                    this.#diagnosticIdentity.childPartNode,
                  format: renderedFormat,
                },
        },
      );
      throw new CadError(value.message, [value]);
    }
    return exportMesh(this.mesh(), format, this.#name);
  }

  physicalMassProperties(): CadResult<PhysicalMassProperties> {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return partRuntimeIntegrityFailure();
    }
    this.#owner.assertLive();
    const part = this.#value;
    if (part.massDensity === undefined) {
      return failure(
        diagnostic(
          "MASS_DENSITY_MISSING",
          `Part '${part.node}' has no authored mass density`,
          {
            severity: "error",
            node: part.node,
            path: partV7MassDensityPath(part),
            hints: [
              "Author massDensity on the part or reference a material definition",
            ],
          },
        ),
      );
    }
    try {
      if (part.geometry.kind === "solid") {
        const rawMeasurement = part.geometry.solid.measure();
        if (!documentV7RuntimeIntrinsicsAreIntact()) {
          return partRuntimeIntegrityFailure();
        }
        const captured = capturePartMeasurement(
          rawMeasurement,
          part,
          part.geometry.node,
        );
        if (!captured.ok) return captured;
        const physical = scalePhysicalMassProperties(
          captured.value,
          part.massDensity,
        );
        if (!documentV7RuntimeIntrinsicsAreIntact()) {
          return partRuntimeIntegrityFailure();
        }
        return success(physical);
      }
      const values: PhysicalMassProperties[] = [];
      const measurements = new ImportedBodyMap<NodeId, ShapeMeasurements>();
      for (
        let index = 0;
        index < part.geometry.bodySet.bodies.length;
        index += 1
      ) {
        const body = part.geometry.bodySet.bodies[index]!;
        let measured = importedBodyMapGetValue(measurements, body.node);
        if (measured === undefined) {
          const rawMeasurement = body.solid.measure();
          if (!documentV7RuntimeIntrinsicsAreIntact()) {
            return partRuntimeIntegrityFailure();
          }
          const captured = capturePartMeasurement(
            rawMeasurement,
            part,
            body.node,
          );
          if (!captured.ok) return captured;
          measured = captured.value;
          importedBodyMapSetValue(measurements, body.node, measured);
        }
        const physical = scalePhysicalMassProperties(
          measured,
          part.massDensity,
        );
        if (!documentV7RuntimeIntrinsicsAreIntact()) {
          return partRuntimeIntegrityFailure();
        }
        importedBodyArrayAppend(
          values,
          physical,
        );
      }
      const combined = combinePhysicalMassProperties(values);
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return partRuntimeIntegrityFailure();
      }
      return success(combined);
    } catch (error) {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return partRuntimeIntegrityFailure();
      }
      return failure(
        diagnostic(
          "MASS_PROPERTIES_INVALID",
          `Physical mass properties for part '${part.node}' could not be represented`,
          {
            severity: "error",
            node: part.node,
            path: partV7MassDensityPath(part),
            details: {
              massDensity: part.massDensity,
              cause: safeErrorMessage(
                error,
                "Part mass properties failed with an opaque value",
              ),
            },
          },
        ),
      );
    }
  }

  billOfMaterials(): CadResult<BillOfMaterials> {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return partRuntimeIntegrityFailure();
    }
    this.#owner.assertLive();
    const part = this.#value;
    const diagnostics: Diagnostic[] = [];
    const partNumber = partV7NonBlank(part.definition.partNumber);
    const material = partV7NonBlank(
      part.materialDefinition?.name ?? part.definition.material,
    );
    if (partNumber === null) {
      importedBodyArrayAppend(
        diagnostics,
        diagnostic(
          "BOM_PART_NUMBER_MISSING",
          `Part '${part.node}' has no part number`,
          {
            severity: "warning",
            node: part.node,
            path: `/nodes/${part.node}/partNumber`,
          },
        ),
      );
    }
    if (material === null) {
      importedBodyArrayAppend(
        diagnostics,
        diagnostic(
          "BOM_MATERIAL_MISSING",
          `Part '${part.node}' has no material`,
          {
            severity: "warning",
            node: part.node,
            path:
              part.materialId === undefined
                ? `/nodes/${part.node}/material`
                : `/nodes/${part.node}/materialId`,
            hints: [
              "Reference a document material or author a legacy material label",
            ],
          },
        ),
      );
    }

    let definitionMass: number | null = null;
    if (part.massDensity === undefined) {
      importedBodyArrayAppend(
        diagnostics,
        diagnostic(
          "MASS_DENSITY_MISSING",
          `Part '${part.node}' has no authored mass density`,
          {
            severity: "warning",
            node: part.node,
            path: partV7MassDensityPath(part),
            hints: [
              "Author massDensity on the part or reference a material definition",
            ],
            details: { occurrenceIds: [] },
          },
        ),
      );
    } else {
      const physical = this.physicalMassProperties();
      if (!physical.ok) return physical;
      definitionMass = physical.value.mass;
    }

    const item: BillOfMaterialsItem = {
      partNode: part.node,
      partNumber,
      description: part.definition.description ?? null,
      materialId: part.materialId ?? null,
      material,
      quantity: 1,
      occurrenceIds: importedBodyApply<readonly string[]>(
        importedBodyObjectFreeze,
        Object,
        [[]],
      ),
      massDensity: part.massDensity ?? null,
      massDensitySource: part.massDensitySource ?? null,
      definitionMass,
      totalMass: definitionMass,
    };
    const massComplete = definitionMass !== null;
    const knownMass = definitionMass ?? 0;
    return success(
      {
        configurationId: this.#owner.configurationId,
        units: { mass: "kg" },
        items: [item],
        totalQuantity: 1,
        massComplete,
        knownMass,
        totalMass: massComplete ? knownMass : null,
      },
      diagnostics,
    );
  }
}

/**
 * Creates an immutable diagnostic facade for one part leaf selected through
 * an authored external assembly output. The facade shares the exact owner,
 * geometry, and multibody backing state; it does not construct or copy shape
 * data. `name` remains the admitted child part-node identity because the leaf
 * is not itself a document output.
 *
 * @internal
 */
export function createExternalAssemblyPartViewV7(
  part: EvaluatedPartV7,
  output: string,
  childPartNode: NodeId,
): CadResult<EvaluatedPartV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const state = evaluatedPartV7ViewState(part);
  if (
    state === undefined ||
    typeof output !== "string" ||
    typeof childPartNode !== "string"
  ) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "External assembly part view is not owned by this evaluator",
        {
          severity: "error",
          details: {
            phase: PART_EVALUATION_PHASE,
            partOwner: state !== undefined,
            outputIsString: typeof output === "string",
            childPartNodeIsString:
              typeof childPartNode === "string",
          },
        },
      ),
    );
  }
  if (state.value.node !== childPartNode) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "External assembly part view does not belong to the selected child part",
        {
          severity: "error",
          node: childPartNode,
          details: {
            phase: PART_EVALUATION_PHASE,
            partOwner: true,
            selectedPartNode: childPartNode,
            evaluatedPartNode: state.value.node,
          },
        },
      ),
    );
  }
  try {
    state.owner.assertLive();
  } catch {
    return failure(
      diagnostic(
        "IR_INVALID",
        "External assembly part view cannot retain a disposed evaluation",
        {
          severity: "error",
          node: childPartNode,
          details: {
            phase: PART_EVALUATION_PHASE,
            evaluationDisposed: true,
          },
        },
      ),
    );
  }
  const diagnosticIdentity =
    importedBodyApply<EvaluatedPartDiagnosticIdentityV7>(
      importedBodyObjectFreeze,
      Object,
      [
        {
          kind: "externalAssemblyPart",
          output,
          outputKind: "assembly",
          childPartNode,
        },
      ],
    );
  let contextualValue = state.value;
  if (state.value.geometry.kind === "bodySet") {
    const source = state.value.geometry.bodySet;
    const bodySet = new EvaluatedBodySetV7(
      childPartNode,
      state.owner,
      source.bodies,
      source.representation,
      source.exact,
      diagnosticIdentity,
    );
    const geometry =
      importedBodyApply<EvaluatedPartGeometryV7>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            kind: "bodySet",
            node: state.value.geometry.node,
            bodySet,
          },
        ],
      );
    contextualValue =
      importedBodyApply<EvaluatedPartValueV7>(
        importedBodyObjectFreeze,
        Object,
        [{ ...state.value, geometry }],
      );
  }
  const view = new EvaluatedPartV7(
    childPartNode,
    state.owner,
    contextualValue,
    diagnosticIdentity,
  );
  const boundary = partPostBoundaryFailure(undefined, childPartNode);
  return boundary ?? success(view);
}

function createStagedBodySetEvaluatedSolidV7Alias(
  solid: EvaluatedSolid,
  name: string,
): StagedBodySetEvaluatedSolidV7 {
  const state = evaluationOwnerReflectApply(
    evaluationOwnerDisposerGet,
    stagedBodySetEvaluatedSolidV7States,
    [solid],
  ) as StagedBodySetEvaluatedSolidV7State | undefined;
  if (state === undefined) {
    throw new TypeError(
      "Product solid alias is not owned by this evaluator",
    );
  }
  state.owner.assertLive();
  return new StagedBodySetEvaluatedSolidV7(
    name,
    state.owner,
    state.shape,
    state.access,
  );
}

function createProductPartAliasViewV7(
  part: EvaluatedPartV7,
  name: string,
): EvaluatedPartV7 {
  const state = evaluatedPartV7ViewState(part);
  if (state === undefined) {
    throw new TypeError(
      "Product part alias is not owned by this evaluator",
    );
  }
  let value = state.value;
  if (value.geometry.kind === "solid") {
    const geometry =
      importedBodyApply<EvaluatedPartGeometryV7>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            kind: "solid",
            node: value.geometry.node,
            solid: createStagedBodySetEvaluatedSolidV7Alias(
              value.geometry.solid,
              name,
            ),
          },
        ],
      );
    value = importedBodyApply<EvaluatedPartValueV7>(
      importedBodyObjectFreeze,
      Object,
      [{ ...value, geometry }],
    );
  } else {
    const source = value.geometry.bodySet;
    const geometry =
      importedBodyApply<EvaluatedPartGeometryV7>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            kind: "bodySet",
            node: value.geometry.node,
            bodySet: new EvaluatedBodySetV7(
              name,
              state.owner,
              source.bodies,
              source.representation,
              source.exact,
              evaluatedPartBodySetDiagnosticIdentityV7(
                name,
                value.node,
              ),
            ),
          },
        ],
      );
    value = importedBodyApply<EvaluatedPartValueV7>(
      importedBodyObjectFreeze,
      Object,
      [{ ...value, geometry }],
    );
  }
  return new EvaluatedPartV7(name, state.owner, value);
}

/**
 * Source-only result container for direct staged document-v7 part outputs.
 *
 * @internal
 */
export class EvaluatedPartDesignV7 {
  readonly configurationId: string | null;
  readonly parameters: Readonly<Record<string, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly outputNames: readonly string[];
  readonly #outputs: ReadonlyMap<string, EvaluatedPartV7>;
  readonly #owner: EvaluationOwner;

  constructor(
    owner: EvaluationOwner,
    outputs: ReadonlyMap<string, EvaluatedPartV7>,
    configurationId: string | null,
    parameters: Readonly<Record<string, number>>,
    diagnostics: readonly Diagnostic[],
  ) {
    this.#owner = owner;
    this.#outputs = outputs;
    this.outputNames = Object.freeze([...outputs.keys()]);
    this.configurationId = configurationId;
    this.parameters = parameters;
    this.diagnostics = diagnostics;
    installEvaluatedPartDesignV7Methods(this);
  }

  output(name: string): EvaluatedPartV7 {
    this.#owner.assertLive();
    const output = this.#outputs.get(name);
    if (output === undefined) {
      throw new RangeError(`Unknown evaluated part output '${name}'`);
    }
    return output;
  }

  dispose(): void {
    this.#owner.dispose();
  }
}

/**
 * One owned native-geometry batch produced by the staged product planner.
 *
 * The ordered aliases live in the higher-level product result. This container
 * is keyed by planner-owned names and exists so assemblies and direct outputs
 * can borrow the same authentic geometry views without duplicating native
 * handles.
 *
 * @internal
 */
export class EvaluatedProductGeometryDesignV7 {
  readonly configurationId: string | null;
  readonly parameters: Readonly<Record<string, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly outputNames: readonly string[];
  readonly #outputs: ReadonlyMap<
    string,
    EvaluatedProductGeometryOutputV7
  >;
  readonly #owner: EvaluationOwner;

  constructor(
    owner: EvaluationOwner,
    outputs: ReadonlyMap<string, EvaluatedProductGeometryOutputV7>,
    configurationId: string | null,
    parameters: Readonly<Record<string, number>>,
    diagnostics: readonly Diagnostic[],
  ) {
    this.#owner = owner;
    this.#outputs = outputs;
    this.outputNames = Object.freeze([...outputs.keys()]);
    this.configurationId = configurationId;
    this.parameters = parameters;
    this.diagnostics = diagnostics;
    installEvaluatedProductGeometryDesignV7Methods(this);
    importedBodyApply<void>(importedBodyObjectFreeze, Object, [this]);
  }

  output(name: string): EvaluatedProductGeometryOutputV7 {
    this.#owner.assertLive();
    if (typeof name !== "string") {
      throw new TypeError(
        "Evaluated product geometry output name must be a string",
      );
    }
    const output = importedBodyMapGetValue(this.#outputs, name);
    if (output === undefined) {
      throw new RangeError(
        `Unknown evaluated product geometry output '${name}'`,
      );
    }
    return output;
  }

  dispose(): void {
    this.#owner.dispose();
  }
}

const stagedBodySetEvaluatedSolidV7Mesh =
  StagedBodySetEvaluatedSolidV7.prototype.mesh;
const stagedBodySetEvaluatedSolidV7Measure =
  StagedBodySetEvaluatedSolidV7.prototype.measure;
const stagedBodySetEvaluatedSolidV7Topology =
  StagedBodySetEvaluatedSolidV7.prototype.topology;
const stagedBodySetEvaluatedSolidV7Export =
  StagedBodySetEvaluatedSolidV7.prototype.export;
const evaluatedBodySetV7Body =
  EvaluatedBodySetV7.prototype.body;
const evaluatedBodySetV7Mesh =
  EvaluatedBodySetV7.prototype.mesh;
const evaluatedBodySetV7Export =
  EvaluatedBodySetV7.prototype.export;
const evaluatedBodySetDesignV7Output =
  EvaluatedBodySetDesignV7.prototype.output;
const evaluatedBodySetDesignV7Dispose =
  EvaluatedBodySetDesignV7.prototype.dispose;
const evaluatedPartV7Mesh = EvaluatedPartV7.prototype.mesh;
const evaluatedPartV7Export = EvaluatedPartV7.prototype.export;
const evaluatedPartV7PhysicalMassProperties =
  EvaluatedPartV7.prototype.physicalMassProperties;
const evaluatedPartV7BillOfMaterials =
  EvaluatedPartV7.prototype.billOfMaterials;
const evaluatedPartDesignV7Output =
  EvaluatedPartDesignV7.prototype.output;
const evaluatedPartDesignV7Dispose =
  EvaluatedPartDesignV7.prototype.dispose;
const evaluatedProductGeometryDesignV7Output =
  EvaluatedProductGeometryDesignV7.prototype.output;
const evaluatedProductGeometryDesignV7Dispose =
  EvaluatedProductGeometryDesignV7.prototype.dispose;

function installStagedBodySetEvaluatedSolidV7Methods(
  value: StagedBodySetEvaluatedSolidV7,
): void {
  installEvaluationInstanceMethod(
    value,
    "mesh",
    stagedBodySetEvaluatedSolidV7Mesh,
  );
  installEvaluationInstanceMethod(
    value,
    "measure",
    stagedBodySetEvaluatedSolidV7Measure,
  );
  installEvaluationInstanceMethod(
    value,
    "topology",
    stagedBodySetEvaluatedSolidV7Topology,
  );
  installEvaluationInstanceMethod(
    value,
    "export",
    stagedBodySetEvaluatedSolidV7Export,
  );
}

function installEvaluatedBodySetV7Methods(
  value: EvaluatedBodySetV7,
): void {
  installEvaluationInstanceMethod(
    value,
    "body",
    evaluatedBodySetV7Body,
  );
  installEvaluationInstanceMethod(
    value,
    "mesh",
    evaluatedBodySetV7Mesh,
  );
  installEvaluationInstanceMethod(
    value,
    "export",
    evaluatedBodySetV7Export,
  );
}

function installEvaluatedBodySetDesignV7Methods(
  value: EvaluatedBodySetDesignV7,
): void {
  installEvaluationInstanceMethod(
    value,
    "output",
    evaluatedBodySetDesignV7Output,
  );
  installEvaluationInstanceMethod(
    value,
    "dispose",
    evaluatedBodySetDesignV7Dispose,
  );
}

function installEvaluatedPartV7Methods(
  value: EvaluatedPartV7,
): void {
  installEvaluationInstanceMethod(
    value,
    "mesh",
    evaluatedPartV7Mesh,
  );
  installEvaluationInstanceMethod(
    value,
    "export",
    evaluatedPartV7Export,
  );
  installEvaluationInstanceMethod(
    value,
    "physicalMassProperties",
    evaluatedPartV7PhysicalMassProperties,
  );
  installEvaluationInstanceMethod(
    value,
    "billOfMaterials",
    evaluatedPartV7BillOfMaterials,
  );
}

function installEvaluatedPartDesignV7Methods(
  value: EvaluatedPartDesignV7,
): void {
  installEvaluationInstanceMethod(
    value,
    "output",
    evaluatedPartDesignV7Output,
  );
  installEvaluationInstanceMethod(
    value,
    "dispose",
    evaluatedPartDesignV7Dispose,
  );
}

function installEvaluatedProductGeometryDesignV7Methods(
  value: EvaluatedProductGeometryDesignV7,
): void {
  installEvaluationInstanceMethod(
    value,
    "output",
    evaluatedProductGeometryDesignV7Output,
  );
  installEvaluationInstanceMethod(
    value,
    "dispose",
    evaluatedProductGeometryDesignV7Dispose,
  );
}

/**
 * Source-only options for the staged direct imported-body evaluator.
 *
 * This contract is deliberately excluded from the package root until the
 * complete document-v7 evaluator is ready for public promotion.
 *
 * @internal
 */
export interface EvaluateImportedBodyOutputsV7Options {
  readonly outputs?: readonly string[];
  readonly resolver?: ResourceResolverV7;
  readonly evaluationLimits?: Partial<ImportedBodyEvaluationLimitsV7>;
  readonly resourceLimits?: Partial<ResourceResolutionLimitsV7>;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

/** @internal */
export interface ImportedBodyEvaluationLimitsV7 {
  readonly maxSelectedOutputs: number;
}

/** @internal */
export const DEFAULT_IMPORTED_BODY_EVALUATION_LIMITS_V7:
  ImportedBodyEvaluationLimitsV7 = Object.freeze({
    maxSelectedOutputs: 10_000,
  });

/**
 * Source-only options for direct staged document-v7 body-set evaluation.
 *
 * @internal
 */
export interface EvaluateBodySetOutputsV7Options {
  readonly configuration?: string;
  /**
   * Bounded caller overrides are finite scalar values. Named configuration
   * overrides retain the full parsed document expression grammar.
   */
  readonly parameters?: Readonly<Record<string, number>>;
  readonly outputs?: readonly string[];
  readonly resolver?: ResourceResolverV7;
  readonly evaluationLimits?: Partial<BodySetEvaluationLimitsV7>;
  readonly resourceLimits?: Partial<ResourceResolutionLimitsV7>;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

/** @internal */
export interface BodySetEvaluationLimitsV7 {
  readonly maxSelectedOutputs: number;
  /** Caller-supplied finite scalar parameter overrides. */
  readonly maxParameterOverrides: number;
  /** Aggregate authored memberships across the selected outputs. */
  readonly maxBodySetMembers: number;
  /** Distinct primitive and imported-body nodes acquired from the kernel. */
  readonly maxDistinctSolids: number;
  /** Distinct primitive, imported-body, transform, and Boolean nodes. */
  readonly maxSolidGraphNodes: number;
  /** Every transform input and authored Boolean operand reference. */
  readonly maxSolidDependencyLinks: number;
  /** Authored operations across distinct transform nodes in the closure. */
  readonly maxTransformOperations: number;
}

/** @internal */
export const DEFAULT_BODY_SET_EVALUATION_LIMITS_V7:
  BodySetEvaluationLimitsV7 = Object.freeze({
    maxSelectedOutputs: 10_000,
  maxParameterOverrides: 10_000,
  maxBodySetMembers: 100_000,
  maxDistinctSolids: 100_000,
  maxSolidGraphNodes: 100_000,
  maxSolidDependencyLinks: 100_000,
  maxTransformOperations: 100_000,
});

/**
 * Source-only options for direct staged document-v7 part evaluation.
 *
 * @internal
 */
declare const preparedPartOutputsV7Brand: unique symbol;
declare const preparedPartKernelAccessV7Brand: unique symbol;
declare const preparedPartShapeOwnershipTransactionV7Brand: unique symbol;
declare const preparedProductGeometryOutputsV7Brand: unique symbol;
declare const capturedProductDocumentV7Brand: unique symbol;
declare const preparedProductGeometryKernelAccessV7Brand: unique symbol;

/** Aggregate work admitted by one prepared staged part evaluation. @internal */
export interface PreparedPartEvaluationMetricsV7 {
  readonly selectedOutputs: number;
  readonly partBodies: number;
  readonly distinctSolids: number;
  readonly solidGraphNodes: number;
  readonly solidDependencyLinks: number;
  readonly transformOperations: number;
  readonly resolvedMaterials: number;
}

/**
 * Owner-checked, opaque prepared part evaluation.
 *
 * Preparation performs document capture, selection, configuration, parameter,
 * material, planning, and scalar-expression work. It performs no resolver or
 * geometry-kernel access.
 *
 * @internal
 */
export interface PreparedPartOutputsV7 {
  readonly resourceIds: readonly ResourceId[];
  readonly metrics: PreparedPartEvaluationMetricsV7;
  readonly [preparedPartOutputsV7Brand]: true;
}

/**
 * Owner-checked retained kernel observation for one prepared part evaluation.
 *
 * @internal
 */
export interface PreparedPartKernelAccessV7 {
  readonly kernelId: string;
  readonly [preparedPartKernelAccessV7Brand]: true;
}

/**
 * Owner-checked transaction for detecting aliased kernel shapes across
 * multiple prepared part batches executed against one borrowed kernel.
 *
 * @internal
 */
export interface PreparedPartShapeOwnershipTransactionV7 {
  readonly [preparedPartShapeOwnershipTransactionV7Brand]: true;
}

/**
 * One trusted native definition selected by the staged product planner.
 *
 * This is a repository-only hand-off between the product planner and the
 * shared solid-graph evaluator. It is deliberately not re-exported from the
 * package root.
 *
 * @internal
 */
export type ProductGeometrySelectionV7 =
  | {
      readonly name: string;
      readonly node: NodeId;
      readonly kind: "solid";
      readonly path: string;
    }
  | {
      readonly name: string;
      readonly node: NodeId;
      readonly kind: "bodySet";
      readonly path: string;
    }
  | {
      readonly name: string;
      readonly node: NodeId;
      readonly kind: "part";
      readonly path: string;
    };

/** @internal */
export type EvaluatedProductGeometryOutputV7 =
  | {
      readonly name: string;
      readonly node: NodeId;
      readonly kind: "solid";
      readonly solid: EvaluatedSolid;
    }
  | {
      readonly name: string;
      readonly node: NodeId;
      readonly kind: "bodySet";
      readonly bodySet: EvaluatedBodySetV7;
    }
  | {
      readonly name: string;
      readonly node: NodeId;
      readonly kind: "part";
      readonly part: EvaluatedPartV7;
    };

/**
 * Opaque prepared native product batch. The batch may contain any mixture of
 * direct solids, body sets, and parts from one effective configuration.
 *
 * @internal
 */
export interface PreparedProductGeometryOutputsV7 {
  readonly resourceIds: readonly ResourceId[];
  readonly metrics: PreparedPartEvaluationMetricsV7;
  readonly [preparedProductGeometryOutputsV7Brand]: true;
}

/** Owner-checked aggregate-retained kernel access for one native product batch. @internal */
export interface PreparedProductGeometryKernelAccessV7 {
  readonly kernelId: string;
  readonly [preparedProductGeometryKernelAccessV7Brand]: true;
}

/** Deterministic document boundary attached to aggregate preflight failures. @internal */
export interface ProductGeometryBatchProvenanceV7 {
  readonly documentScope: DocumentV7ResourceScope;
  readonly selectionPath: string;
}

/**
 * One parsed, detached staged document retained across product planning
 * contexts. The token prevents internal geometry batches from reparsing or
 * re-observing the caller's document.
 *
 * @internal
 */
export interface CapturedProductDocumentV7 {
  readonly document: DesignDocumentV7;
  readonly diagnostics: readonly Diagnostic[];
  readonly [capturedProductDocumentV7Brand]: true;
}

/** Parser-backed capture plus the admitted source version for child documents. @internal */
export interface AdmittedCapturedProductDocumentV7 {
  readonly captured: CapturedProductDocumentV7;
  readonly sourceVersion: AdmittedDocumentSourceVersion;
}

/**
 * Internal options for a trusted product-planner geometry batch.
 *
 * Selection is supplied separately so the caller can retain output aliases
 * without fabricating document nodes or mutating the caller's output table.
 *
 * @internal
 */
export interface PrepareProductGeometryOutputsV7Options {
  readonly configuration?: string;
  readonly parameters: Readonly<Record<string, number>>;
  readonly evaluationLimits: PartEvaluationLimitsV7;
  readonly resourceLimits: ResourceResolutionLimitsV7;
  /** Legacy assembly evaluation validates every document material. */
  readonly materialScope?: "selected" | "document";
  readonly signal?: AbortSignal;
}

export interface EvaluatePartOutputsV7Options {
  readonly configuration?: string;
  /**
   * Bounded caller overrides are finite scalar values. Named configuration
   * overrides retain the full parsed document expression grammar.
   */
  readonly parameters?: Readonly<Record<string, number>>;
  readonly outputs?: readonly string[];
  readonly resolver?: ResourceResolverV7;
  readonly evaluationLimits?: Partial<PartEvaluationLimitsV7>;
  readonly resourceLimits?: Partial<ResourceResolutionLimitsV7>;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

/** @internal */
export interface PartEvaluationLimitsV7 {
  readonly maxSelectedOutputs: number;
  readonly maxParameterOverrides: number;
  /** Solid parts count once; every authored body-set membership counts once. */
  readonly maxPartBodies: number;
  /** Distinct primitive and imported-body nodes acquired from the kernel. */
  readonly maxDistinctSolids: number;
  /** Distinct primitive, imported-body, transform, and Boolean nodes. */
  readonly maxSolidGraphNodes: number;
  /** Every transform input and authored Boolean operand reference. */
  readonly maxSolidDependencyLinks: number;
  /** Authored operations across distinct transform nodes in the closure. */
  readonly maxTransformOperations: number;
  /** Every document material is resolved to preserve the v6 material contract. */
  readonly maxResolvedMaterials: number;
}

/** @internal */
export const DEFAULT_PART_EVALUATION_LIMITS_V7:
  PartEvaluationLimitsV7 = Object.freeze({
    maxSelectedOutputs: 10_000,
  maxParameterOverrides: 10_000,
  maxPartBodies: 100_000,
  maxDistinctSolids: 100_000,
  maxSolidGraphNodes: 100_000,
  maxSolidDependencyLinks: 100_000,
  maxTransformOperations: 100_000,
  maxResolvedMaterials: 10_000,
});

interface CapturedImportedBodyOutputsV7Options {
  readonly outputs?: readonly string[];
  readonly resolver?: ResourceResolverV7;
  readonly evaluationLimits: ImportedBodyEvaluationLimitsV7;
  readonly resourceLimits: ResourceResolutionLimitsV7;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

interface ImportedBodyKernelAccess {
  readonly id: string;
  readonly importDocumentBody: NonNullable<
    GeometryKernel["importDocumentBody"]
  >;
  readonly status: GeometryKernel["status"];
  readonly measure: GeometryKernel["measure"];
  readonly disposeShape: GeometryKernel["disposeShape"];
}

const IMPORTED_BODY_EVALUATION_OPTION_KEYS = Object.freeze([
  "outputs",
  "resolver",
  "evaluationLimits",
  "resourceLimits",
  "documentLimits",
  "signal",
] as const);
const IMPORTED_BODY_RESOURCE_LIMIT_KEYS = Object.freeze(
  Object.keys(
    DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
  ) as readonly (keyof ResourceResolutionLimitsV7)[],
);
const IMPORTED_BODY_EVALUATION_LIMIT_KEYS = Object.freeze([
  "maxSelectedOutputs",
] as const satisfies readonly (keyof ImportedBodyEvaluationLimitsV7)[]);
const IMPORTED_BODY_CAPABILITY_SNAPSHOT_LIMITS = Object.freeze({
  ...DEFAULT_DESIGN_DOCUMENT_LIMITS,
  maxDocumentBytes: 1024 * 1024,
  maxStructuralValues: 10_000,
  maxNestingDepth: 16,
});
const importedBodyObjectPrototype = Object.prototype;
const importedBodyObjectCreate = Object.create;
const importedBodyObjectDefineProperty = Object.defineProperty;
const importedBodyObjectFreeze = Object.freeze;
const importedBodyObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const importedBodyObjectGetPrototypeOf = Object.getPrototypeOf;
const importedBodyObjectHasOwn = Object.hasOwn;
const importedBodyObjectKeys = Object.keys;
const importedBodyReflectApply = Reflect.apply;
const importedBodyReflectOwnKeys = Reflect.ownKeys;
const importedBodyArrayIsArray = Array.isArray;
const importedBodyArraySort = Array.prototype.sort;
const importedBodyNumberIsFinite = Number.isFinite;
const importedBodyNumberIsSafeInteger = Number.isSafeInteger;
const importedBodyStringTrim = String.prototype.trim;
const ImportedBodyMap = Map;
const importedBodyMapGet = Map.prototype.get;
const importedBodyMapSet = Map.prototype.set;
const ImportedBodySet = Set;
const importedBodySetAdd = Set.prototype.add;
const importedBodySetHas = Set.prototype.has;
const ImportedBodyFloat32Array = Float32Array;
const ImportedBodyUint8Array = Uint8Array;
const ImportedBodyUint32Array = Uint32Array;
const importedBodyFloat32ArrayPrototype = Float32Array.prototype;
const importedBodyUint32ArrayPrototype = Uint32Array.prototype;
const importedBodyArrayBufferPrototype = ArrayBuffer.prototype;
const importedBodyTypedArrayPrototype =
  Object.getPrototypeOf(Uint8Array.prototype);
const importedBodyTypedArrayLengthGetter =
  Object.getOwnPropertyDescriptor(
    importedBodyTypedArrayPrototype,
    "length",
  )?.get;
const importedBodyTypedArrayBufferGetter =
  Object.getOwnPropertyDescriptor(
    importedBodyTypedArrayPrototype,
    "buffer",
  )?.get;
const importedBodyArrayBufferByteLengthGetter =
  Object.getOwnPropertyDescriptor(
    ArrayBuffer.prototype,
    "byteLength",
  )?.get;
const importedBodyAbortSignalAbortedGetter =
  typeof AbortSignal === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

function importedBodyApply<T>(
  method: CallableFunction,
  receiver: unknown,
  arguments_: readonly unknown[],
): T {
  return importedBodyReflectApply(method, receiver, arguments_) as T;
}

function importedBodyArray(value: unknown): value is readonly unknown[] {
  return importedBodyApply<boolean>(importedBodyArrayIsArray, Array, [value]);
}

function importedBodyArrayAppend<T>(value: T[], entry: T): void {
  importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
    value,
    value.length,
    {
      configurable: true,
      enumerable: true,
      writable: true,
      value: entry,
    },
  ]);
}

function importedBodyArraySortLexically(value: string[]): string[] {
  return importedBodyApply<string[]>(importedBodyArraySort, value, [
    lexicalCompare,
  ]);
}

function importedBodyObjectKeyList(value: object): string[] {
  return importedBodyApply<string[]>(importedBodyObjectKeys, Object, [value]);
}

function importedBodySetAddValue<T>(set: Set<T>, value: T): void {
  importedBodyApply<Set<T>>(importedBodySetAdd, set, [value]);
}

function importedBodySetHasValue<T>(
  set: ReadonlySet<T>,
  value: T,
): boolean {
  return importedBodyApply<boolean>(importedBodySetHas, set, [value]);
}

function importedBodyMapGetValue<K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
): V | undefined {
  return importedBodyApply<V | undefined>(importedBodyMapGet, map, [key]);
}

function importedBodyMapSetValue<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
): void {
  importedBodyApply<Map<K, V>>(importedBodyMapSet, map, [key, value]);
}

function importedBodyOwnDataRecord(
  value: unknown,
  path: string,
): CadResult<Readonly<Record<string, unknown>>> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      importedBodyArray(value)
    ) {
      return failure(
        diagnostic("IR_INVALID", `${path} must be a plain record`, {
          severity: "error",
          path,
          details: { phase: "documentV7ImportedBodyEvaluation" },
        }),
      );
    }
    const prototype = importedBodyApply<object | null>(
      importedBodyObjectGetPrototypeOf,
      Object,
      [value],
    );
    if (prototype !== null && prototype !== importedBodyObjectPrototype) {
      return failure(
        diagnostic("IR_INVALID", `${path} must be a plain record`, {
          severity: "error",
          path,
          details: { phase: "documentV7ImportedBodyEvaluation" },
        }),
      );
    }
    const keys = importedBodyApply<(string | symbol)[]>(
      importedBodyReflectOwnKeys,
      Reflect,
      [value],
    );
    const snapshot = importedBodyApply<Record<string, unknown>>(
      importedBodyObjectCreate,
      Object,
      [null],
    );
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key !== "string") {
        return failure(
          diagnostic("IR_INVALID", `${path} cannot contain symbol properties`, {
            severity: "error",
            path,
            details: { phase: "documentV7ImportedBodyEvaluation" },
          }),
        );
      }
      const descriptor = importedBodyApply<PropertyDescriptor | undefined>(
        importedBodyObjectGetOwnPropertyDescriptor,
        Object,
        [value, key],
      );
      const propertyPath = path === "/" ? `/${key}` : `${path}/${key}`;
      if (
        descriptor === undefined ||
        !importedBodyApply<boolean>(
          importedBodyObjectHasOwn,
          Object,
          [descriptor, "value"],
        )
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            `${propertyPath} must be an own data property`,
            {
              severity: "error",
              path: propertyPath,
              details: { phase: "documentV7ImportedBodyEvaluation" },
            },
          ),
        );
      }
      snapshot[key] = descriptor.value;
    }
    return success(
      importedBodyApply<Readonly<Record<string, unknown>>>(
        importedBodyObjectFreeze,
        Object,
        [snapshot],
      ),
    );
  } catch {
    return failure(
      diagnostic("IR_INVALID", `${path} could not be read safely`, {
        severity: "error",
        path,
        details: { phase: "documentV7ImportedBodyEvaluation" },
      }),
    );
  }
}

type ImportedBodyOwnDataValue =
  | { readonly kind: "data"; readonly value: unknown }
  | { readonly kind: "missing" | "invalid" };

function importedBodyOwnDataValue(
  value: unknown,
  key: PropertyKey,
): ImportedBodyOwnDataValue {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      importedBodyArray(value)
    ) {
      return { kind: "invalid" };
    }
    const prototype = importedBodyApply<object | null>(
      importedBodyObjectGetPrototypeOf,
      Object,
      [value],
    );
    if (prototype !== null && prototype !== importedBodyObjectPrototype) {
      return { kind: "invalid" };
    }
    const descriptor = importedBodyApply<PropertyDescriptor | undefined>(
      importedBodyObjectGetOwnPropertyDescriptor,
      Object,
      [value, key],
    );
    if (descriptor === undefined) return { kind: "missing" };
    if (
      !importedBodyApply<boolean>(
        importedBodyObjectHasOwn,
        Object,
        [descriptor, "value"],
      )
    ) {
      return { kind: "invalid" };
    }
    return { kind: "data", value: descriptor.value };
  } catch {
    return { kind: "invalid" };
  }
}

function importedBodyOptionKey(value: string): boolean {
  for (
    let index = 0;
    index < IMPORTED_BODY_EVALUATION_OPTION_KEYS.length;
    index += 1
  ) {
    if (IMPORTED_BODY_EVALUATION_OPTION_KEYS[index] === value) return true;
  }
  return false;
}

function importedBodyResourceLimitKey(
  value: string,
): value is keyof ResourceResolutionLimitsV7 {
  for (
    let index = 0;
    index < IMPORTED_BODY_RESOURCE_LIMIT_KEYS.length;
    index += 1
  ) {
    if (IMPORTED_BODY_RESOURCE_LIMIT_KEYS[index] === value) return true;
  }
  return false;
}

function captureImportedBodyEvaluationLimits(
  value: unknown,
): CadResult<ImportedBodyEvaluationLimitsV7> {
  if (value === undefined) {
    return success(DEFAULT_IMPORTED_BODY_EVALUATION_LIMITS_V7);
  }
  const captured = importedBodyOwnDataRecord(value, "/evaluationLimits");
  if (!captured.ok) return captured;
  const keys = importedBodyObjectKeyList(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key !== IMPORTED_BODY_EVALUATION_LIMIT_KEYS[0]) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Unknown imported-body evaluation limit '${key}'`,
          {
            severity: "error",
            path: `/evaluationLimits/${key}`,
            details: { phase: "documentV7ImportedBodyEvaluation" },
          },
        ),
      );
    }
  }
  const candidate = importedBodyApply<boolean>(
    importedBodyObjectHasOwn,
    Object,
    [captured.value, "maxSelectedOutputs"],
  )
    ? captured.value.maxSelectedOutputs
    : DEFAULT_IMPORTED_BODY_EVALUATION_LIMITS_V7.maxSelectedOutputs;
  if (
    typeof candidate !== "number" ||
    !importedBodyApply<boolean>(
      importedBodyNumberIsSafeInteger,
      Number,
      [candidate],
    ) ||
    candidate < 0
  ) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Imported-body maxSelectedOutputs must be a non-negative safe integer",
        {
          severity: "error",
          path: "/evaluationLimits/maxSelectedOutputs",
          details: { phase: "documentV7ImportedBodyEvaluation" },
        },
      ),
    );
  }
  return success(
    importedBodyApply<ImportedBodyEvaluationLimitsV7>(
      importedBodyObjectFreeze,
      Object,
      [{ maxSelectedOutputs: candidate }],
    ),
  );
}

function captureImportedBodyResourceLimits(
  value: unknown,
): CadResult<ResourceResolutionLimitsV7> {
  if (value === undefined) {
    return success(DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7);
  }
  const captured = importedBodyOwnDataRecord(value, "/resourceLimits");
  if (!captured.ok) return captured;
  const normalized: Record<keyof ResourceResolutionLimitsV7, number> = {
    ...DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
  };
  const keys = importedBodyObjectKeyList(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!importedBodyResourceLimitKey(key)) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Unknown resource-resolution limit '${key}'`,
          {
            severity: "error",
            path: `/resourceLimits/${key}`,
            details: { phase: "documentV7ImportedBodyEvaluation" },
          },
        ),
      );
    }
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !importedBodyApply<boolean>(
        importedBodyNumberIsSafeInteger,
        Number,
        [candidate],
      ) ||
      candidate < 0
    ) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Resource-resolution limit '${key}' must be a non-negative safe integer`,
          {
            severity: "error",
            path: `/resourceLimits/${key}`,
            details: { phase: "documentV7ImportedBodyEvaluation" },
          },
        ),
      );
    }
    normalized[key] = candidate;
  }
  return success(
    importedBodyApply<ResourceResolutionLimitsV7>(
      importedBodyObjectFreeze,
      Object,
      [normalized],
    ),
  );
}

function importedBodyOutputLimitFailure(
  limit: number,
  actual: number,
): CadResult<never> {
  return failure(
    diagnostic(
      "RESOURCE_LIMIT_EXCEEDED",
      `Imported-body evaluation selected-output limit ${limit} was exceeded`,
      {
        severity: "error",
        path: "/outputs",
        details: {
          phase: "documentV7ImportedBodyEvaluation",
          resource: "maxSelectedOutputs",
          limit,
          actual,
        },
      },
    ),
  );
}

function captureImportedBodyOutputNames(
  value: unknown,
  maximum: number,
): CadResult<readonly string[] | undefined> {
  if (value === undefined) return success(undefined);
  try {
    if (!importedBodyArray(value)) {
      return failure(
        diagnostic("IR_INVALID", "outputs must be an array", {
          severity: "error",
          path: "/outputs",
          details: { phase: "documentV7ImportedBodyEvaluation" },
        }),
      );
    }
    const lengthDescriptor = importedBodyApply<
      PropertyDescriptor | undefined
    >(importedBodyObjectGetOwnPropertyDescriptor, Object, [value, "length"]);
    const length = lengthDescriptor?.value;
    if (
      typeof length !== "number" ||
      !importedBodyApply<boolean>(
        importedBodyNumberIsSafeInteger,
        Number,
        [length],
      ) ||
      length < 0
    ) {
      return failure(
        diagnostic("IR_INVALID", "outputs has an invalid array length", {
          severity: "error",
          path: "/outputs",
          details: { phase: "documentV7ImportedBodyEvaluation" },
        }),
      );
    }
    if (length > maximum) {
      return importedBodyOutputLimitFailure(maximum, length);
    }
    const names: string[] = [];
    const allowedKeys = new ImportedBodySet<string>();
    const seen = new ImportedBodySet<string>();
    importedBodySetAddValue(allowedKeys, "length");
    for (let index = 0; index < length; index += 1) {
      const key = `${index}`;
      importedBodySetAddValue(allowedKeys, key);
      const descriptor = importedBodyApply<PropertyDescriptor | undefined>(
        importedBodyObjectGetOwnPropertyDescriptor,
        Object,
        [value, key],
      );
      if (
        descriptor === undefined ||
        !importedBodyApply<boolean>(
          importedBodyObjectHasOwn,
          Object,
          [descriptor, "value"],
        ) ||
        typeof descriptor.value !== "string"
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            `outputs[${index}] must be an own string data property`,
            {
              severity: "error",
              path: `/outputs/${index}`,
              details: { phase: "documentV7ImportedBodyEvaluation" },
            },
          ),
        );
      }
      if (!importedBodySetHasValue(seen, descriptor.value)) {
        importedBodySetAddValue(seen, descriptor.value);
        importedBodyArrayAppend(names, descriptor.value);
      }
    }
    const ownKeys = importedBodyApply<(string | symbol)[]>(
      importedBodyReflectOwnKeys,
      Reflect,
      [value],
    );
    for (let index = 0; index < ownKeys.length; index += 1) {
      const key = ownKeys[index]!;
      if (
        typeof key !== "string" ||
        !importedBodySetHasValue(allowedKeys, key)
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            "outputs cannot contain non-index properties",
            {
              severity: "error",
              path: "/outputs",
              details: { phase: "documentV7ImportedBodyEvaluation" },
            },
          ),
        );
      }
    }
    return success(
      importedBodyApply<readonly string[]>(
        importedBodyObjectFreeze,
        Object,
        [names],
      ),
    );
  } catch {
    return failure(
      diagnostic("IR_INVALID", "outputs could not be read safely", {
        severity: "error",
        path: "/outputs",
        details: { phase: "documentV7ImportedBodyEvaluation" },
      }),
    );
  }
}

function importedBodyAbortState(value: unknown): boolean | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    importedBodyAbortSignalAbortedGetter === undefined
  ) {
    return undefined;
  }
  try {
    const state = importedBodyApply<unknown>(
      importedBodyAbortSignalAbortedGetter,
      value,
      [],
    );
    return typeof state === "boolean" ? state : undefined;
  } catch {
    return undefined;
  }
}

function importedBodyEvaluationAborted(
  signal: AbortSignal | undefined,
): boolean {
  return signal !== undefined && importedBodyAbortState(signal) !== false;
}

function importedBodyEvaluationAbortFailure(
  node?: NodeId,
): CadResult<never> {
  return failure(
    diagnostic("EVALUATION_ABORTED", "Imported-body evaluation was aborted", {
      severity: "error",
      ...(node === undefined ? {} : { node, path: `/nodes/${node}` }),
      details: { phase: "documentV7ImportedBodyEvaluation" },
    }),
  );
}

function importedBodyRuntimeIntegrityFailure(): CadResult<never> {
  return failure(
    diagnostic("IR_INVALID", DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE, {
      severity: "error",
      details: {
        phase: "documentV7ImportedBodyEvaluation",
        runtimeIntegrity: false,
      },
    }),
  );
}

function captureImportedBodyEvaluationOptions(
  value: unknown,
): CadResult<CapturedImportedBodyOutputsV7Options> {
  const captured = importedBodyOwnDataRecord(
    value,
    "/",
  );
  if (!captured.ok) return captured;
  const keys = importedBodyObjectKeyList(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!importedBodyOptionKey(key)) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Unknown imported-body evaluation option '${key}'`,
          {
            severity: "error",
            path: `/${key}`,
            details: { phase: "documentV7ImportedBodyEvaluation" },
          },
        ),
      );
    }
  }
  const evaluationLimits = captureImportedBodyEvaluationLimits(
    captured.value.evaluationLimits,
  );
  if (!evaluationLimits.ok) return evaluationLimits;
  const resourceLimits = captureImportedBodyResourceLimits(
    captured.value.resourceLimits,
  );
  if (!resourceLimits.ok) return resourceLimits;
  const outputs = captureImportedBodyOutputNames(
    captured.value.outputs,
    evaluationLimits.value.maxSelectedOutputs,
  );
  if (!outputs.ok) return outputs;
  const resolver = captured.value.resolver;
  if (resolver !== undefined && typeof resolver !== "function") {
    return failure(
      diagnostic("IR_INVALID", "resolver must be a function", {
        severity: "error",
        path: "/resolver",
        details: { phase: "documentV7ImportedBodyEvaluation" },
      }),
    );
  }
  const signal = captured.value.signal;
  if (signal !== undefined && importedBodyAbortState(signal) === undefined) {
    return failure(
      diagnostic("IR_INVALID", "signal must be an AbortSignal", {
        severity: "error",
        path: "/signal",
        details: { phase: "documentV7ImportedBodyEvaluation" },
      }),
    );
  }
  const documentLimits = captured.value.documentLimits;
  if (
    documentLimits !== undefined &&
    (typeof documentLimits !== "object" || documentLimits === null)
  ) {
    return failure(
      diagnostic("IR_INVALID", "documentLimits must be a plain record", {
        severity: "error",
        path: "/documentLimits",
        details: { phase: "documentV7ImportedBodyEvaluation" },
      }),
    );
  }
  return success(
    importedBodyApply<CapturedImportedBodyOutputsV7Options>(
      importedBodyObjectFreeze,
      Object,
      [
        {
          ...(outputs.value === undefined ? {} : { outputs: outputs.value }),
          ...(resolver === undefined
            ? {}
            : { resolver: resolver as ResourceResolverV7 }),
          evaluationLimits: evaluationLimits.value,
          resourceLimits: resourceLimits.value,
          ...(documentLimits === undefined
            ? {}
            : {
                documentLimits:
                  documentLimits as Partial<DesignDocumentLimits>,
              }),
          ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
        },
      ],
    ),
  );
}

function importedBodyJsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function importedBodyKernelFailure(
  kernel: string,
  message: string,
  options: {
    readonly node?: NodeId;
    readonly path?: string;
    readonly details?: Readonly<Record<string, unknown>>;
  } = {},
): CadResult<never> {
  return failure(
    diagnostic("KERNEL_ERROR", message, {
      severity: "error",
      ...(options.node === undefined ? {} : { node: options.node }),
      ...(options.path === undefined ? {} : { path: options.path }),
      details: {
        phase: "documentV7ImportedBodyEvaluation",
        kernel,
        ...options.details,
      },
    }),
  );
}

function importedBodyCapabilityFailure(
  kernel: string,
  node: NodeId,
  imported: ImportedBodyNodeIRV7,
  message: string,
): CadResult<never> {
  return failure(
    diagnostic("KERNEL_CAPABILITY_MISSING", message, {
      severity: "error",
      node,
      path: `/nodes/${node}`,
      details: {
        phase: "documentV7ImportedBodyEvaluation",
        kernel,
        kind: "documentBodyImport",
        format: imported.format,
        unitMode: imported.units.mode,
      },
    }),
  );
}

function captureImportedBodyKernelAccess(
  kernel: GeometryKernel,
  nodes: readonly [NodeId, ImportedBodyNodeIRV7][],
  signal: AbortSignal | undefined,
): CadResult<ImportedBodyKernelAccess> {
  let id = "<unknown>";
  try {
    const rawId: unknown = kernel.id;
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return importedBodyRuntimeIntegrityFailure();
    }
    if (importedBodyEvaluationAborted(signal)) {
      return importedBodyEvaluationAbortFailure();
    }
    if (typeof rawId === "string") id = rawId;
    const rawCapabilities: unknown = kernel.capabilities;
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return importedBodyRuntimeIntegrityFailure();
    }
    if (importedBodyEvaluationAborted(signal)) {
      return importedBodyEvaluationAbortFailure();
    }
    const protocolProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "protocolVersion",
    );
    const representationProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "representation",
    );
    const exactProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "exact",
    );
    const importProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "documentBodyImport",
    );
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return importedBodyRuntimeIntegrityFailure();
    }
    if (importedBodyEvaluationAborted(signal)) {
      return importedBodyEvaluationAbortFailure();
    }
    if (
      protocolProperty.kind !== "data" ||
      representationProperty.kind !== "data" ||
      exactProperty.kind !== "data" ||
      importProperty.kind === "invalid"
    ) {
      return importedBodyKernelFailure(
        id,
        `Kernel '${id}' capabilities must use own data properties`,
        { details: { protocolViolation: true } },
      );
    }
    const protocolVersion = protocolProperty.value;
    if (
      protocolVersion !==
      GEOMETRY_KERNEL_PROTOCOL_VERSION
    ) {
      return failure(
        diagnostic(
          "KERNEL_CAPABILITY_MISSING",
          `Kernel '${id}' uses an unsupported geometry protocol version`,
          {
            severity: "error",
            details: {
              phase: "documentV7ImportedBodyEvaluation",
              kernel: id,
              expected: GEOMETRY_KERNEL_PROTOCOL_VERSION,
              actual:
                typeof protocolVersion === "string" ||
                typeof protocolVersion === "number" ||
                typeof protocolVersion === "boolean" ||
                protocolVersion === null
                  ? protocolVersion
                  : typeof protocolVersion,
            },
          },
        ),
      );
    }
    let documentBodyImport: unknown;
    if (
      importProperty.kind === "data" &&
      importProperty.value !== undefined
    ) {
      const capturedImport = preflightDesignDocumentValue(
        importProperty.value,
        IMPORTED_BODY_CAPABILITY_SNAPSHOT_LIMITS,
        { strictV7Snapshot: true },
      );
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return importedBodyRuntimeIntegrityFailure();
      }
      if (importedBodyEvaluationAborted(signal)) {
        return importedBodyEvaluationAbortFailure();
      }
      if (!capturedImport.ok) {
        return importedBodyKernelFailure(
          id,
          `Kernel '${id}' declares unsafe document-body import capabilities`,
          {
            details: {
              protocolViolation: true,
              reason: "unsafe-capability-metadata",
            },
          },
        );
      }
      documentBodyImport = capturedImport.value;
    }
    const capabilities = {
      protocolVersion,
      representation: representationProperty.value,
      exact: exactProperty.value,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: [],
      ...(documentBodyImport === undefined ? {} : { documentBodyImport }),
    } as unknown as GeometryKernel["capabilities"];
    const inspection =
      inspectKernelDocumentBodyImportCapabilities(capabilities);
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return importedBodyRuntimeIntegrityFailure();
    }
    if (importedBodyEvaluationAborted(signal)) {
      return importedBodyEvaluationAbortFailure();
    }
    if (inspection.status === "malformed") {
      return importedBodyKernelFailure(
        id,
        `Kernel '${id}' declares malformed document-body import capabilities`,
        {
          details: {
            protocolViolation: true,
            reason: inspection.reason,
          },
        },
      );
    }
    if (inspection.status === "absent") {
      const first = nodes[0]!;
      return importedBodyCapabilityFailure(
        id,
        first[0],
        first[1],
        `Kernel '${id}' does not support strong document-body import`,
      );
    }
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const [nodeId, node] = nodes[nodeIndex]!;
      let supported = false;
      for (
        let formatIndex = 0;
        formatIndex < inspection.capabilities.formats.length;
        formatIndex += 1
      ) {
        const format = inspection.capabilities.formats[formatIndex]!;
        if (format.format !== node.format) continue;
        for (
          let modeIndex = 0;
          modeIndex < format.unitModes.length;
          modeIndex += 1
        ) {
          if (format.unitModes[modeIndex] === node.units.mode) {
            supported = true;
            break;
          }
        }
        break;
      }
      if (!supported) {
        return importedBodyCapabilityFailure(
          id,
          nodeId,
          node,
          `Kernel '${id}' does not support ${node.format} document-body import with ${node.units.mode} units`,
        );
      }
    }
    const importDocumentBody = kernel.importDocumentBody;
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return importedBodyRuntimeIntegrityFailure();
    }
    if (importedBodyEvaluationAborted(signal)) {
      return importedBodyEvaluationAbortFailure();
    }
    const status = kernel.status;
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return importedBodyRuntimeIntegrityFailure();
    }
    if (importedBodyEvaluationAborted(signal)) {
      return importedBodyEvaluationAbortFailure();
    }
    const measure = kernel.measure;
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return importedBodyRuntimeIntegrityFailure();
    }
    if (importedBodyEvaluationAborted(signal)) {
      return importedBodyEvaluationAbortFailure();
    }
    const disposeShape = kernel.disposeShape;
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return importedBodyRuntimeIntegrityFailure();
    }
    if (importedBodyEvaluationAborted(signal)) {
      return importedBodyEvaluationAbortFailure();
    }
    if (
      typeof importDocumentBody !== "function" ||
      typeof status !== "function" ||
      typeof measure !== "function" ||
      typeof disposeShape !== "function"
    ) {
      return importedBodyKernelFailure(
        id,
        `Kernel '${id}' advertises document-body import without the required implementation`,
        { details: { protocolViolation: true } },
      );
    }
    return success(
      importedBodyApply<ImportedBodyKernelAccess>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            id,
            importDocumentBody,
            status,
            measure,
            disposeShape,
          },
        ],
      ),
    );
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return importedBodyRuntimeIntegrityFailure();
    }
    if (importedBodyEvaluationAborted(signal)) {
      return importedBodyEvaluationAbortFailure();
    }
    return importedBodyKernelFailure(
      id,
      `Kernel '${id}' document-body import capabilities could not be inspected safely`,
      { details: { protocolViolation: true } },
    );
  }
}

function disposeImportedBodyShapes(
  kernel: GeometryKernel,
  disposeShape: GeometryKernel["disposeShape"],
  shapes: Readonly<Record<number, KernelShape>>,
  shapeCount: number,
): void {
  for (let index = 0; index < shapeCount; index += 1) {
    try {
      importedBodyApply<void>(disposeShape, kernel, [shapes[index]!]);
    } catch {
      // Preserve the original structured failure while making best-effort
      // cleanup of every other shape in this operation.
    }
  }
}

function importedBodyImportOptions(
  node: ImportedBodyNodeIRV7,
): KernelDocumentBodyImportOptions {
  return importedBodyApply<KernelDocumentBodyImportOptions>(
    importedBodyObjectFreeze,
    Object,
    [
      {
        format: node.format,
        units: node.units,
        healing: node.healing,
      },
    ],
  );
}

/**
 * Evaluates only direct document-v7 `importedBody` outputs.
 *
 * The function is source-exported for staged conformance work but deliberately
 * omitted from `src/index.ts`. It performs no I/O from resource locations,
 * never falls back to weak native import or a mesh approximation, and borrows
 * the supplied kernel. A successful `EvaluatedDesign` owns every imported
 * shape until `dispose()`; every failure disposes all shapes already acquired.
 *
 * @internal
 */
export async function evaluateImportedBodyOutputsV7(
  kernel: GeometryKernel,
  inputDocument: DesignDocumentV7,
  inputOptions: EvaluateImportedBodyOutputsV7Options = {},
): Promise<CadResult<EvaluatedDesign>> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return importedBodyRuntimeIntegrityFailure();
  }
  const capturedOptions = captureImportedBodyEvaluationOptions(inputOptions);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return importedBodyRuntimeIntegrityFailure();
  }
  if (!capturedOptions.ok) return capturedOptions;
  const options = capturedOptions.value;
  if (importedBodyEvaluationAborted(options.signal)) {
    return importedBodyEvaluationAbortFailure();
  }

  const parsed = parseDocumentValueV7(
    inputDocument,
    options.documentLimits === undefined
      ? {}
      : { limits: options.documentLimits },
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return importedBodyRuntimeIntegrityFailure();
  }
  if (importedBodyEvaluationAborted(options.signal)) {
    return importedBodyEvaluationAbortFailure();
  }
  if (!parsed.ok) return parsed;
  const document = parsed.value;

  const requested =
    options.outputs === undefined
      ? importedBodyObjectKeyList(document.outputs)
      : [...options.outputs];
  if (requested.length > options.evaluationLimits.maxSelectedOutputs) {
    return importedBodyOutputLimitFailure(
      options.evaluationLimits.maxSelectedOutputs,
      requested.length,
    );
  }
  if (requested.length === 0) {
    return failure(
      diagnostic("OUTPUT_MISSING", "The document has no selected outputs", {
        severity: "error",
        path: "/outputs",
        details: { phase: "documentV7ImportedBodyEvaluation" },
      }),
    );
  }

  const selectedNodes = new Map<NodeId, ImportedBodyNodeIRV7>();
  const outputNodes = new Map<string, NodeId>();
  for (let index = 0; index < requested.length; index += 1) {
    const name = requested[index]!;
    const outputPath = `/outputs/${importedBodyJsonPointerSegment(name)}`;
    const reference = importedBodyApply<boolean>(
      importedBodyObjectHasOwn,
      Object,
      [document.outputs, name],
    )
      ? document.outputs[name]
      : undefined;
    if (reference === undefined) {
      return failure(
        diagnostic("OUTPUT_MISSING", `Unknown output '${name}'`, {
          severity: "error",
          path: outputPath,
          details: { phase: "documentV7ImportedBodyEvaluation" },
        }),
      );
    }
    const node = importedBodyApply<boolean>(
      importedBodyObjectHasOwn,
      Object,
      [document.nodes, reference.node],
    )
      ? document.nodes[reference.node]
      : undefined;
    if (
      reference.kind !== "solid" ||
      node === undefined ||
      node.kind !== "importedBody"
    ) {
      return failure(
        diagnostic(
          "EVALUATION_UNSUPPORTED",
          `Staged imported-body evaluation requires output '${name}' to directly reference an importedBody node`,
          {
            severity: "error",
            node: reference.node,
            path: outputPath,
            details: {
              phase: "documentV7ImportedBodyEvaluation",
              supported: "direct-imported-body-output",
              outputKind: reference.kind,
              nodeKind: node?.kind,
            },
          },
        ),
      );
    }
    selectedNodes.set(reference.node, node);
    outputNodes.set(name, reference.node);
  }

  const orderedNodes = [...selectedNodes.entries()].sort(([first], [second]) =>
    lexicalCompare(first, second),
  );
  const kernelAccess = captureImportedBodyKernelAccess(
    kernel,
    orderedNodes,
    options.signal,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return importedBodyRuntimeIntegrityFailure();
  }
  if (importedBodyEvaluationAborted(options.signal)) {
    return importedBodyEvaluationAbortFailure();
  }
  if (!kernelAccess.ok) return kernelAccess;

  const resourceIds: ResourceId[] = [];
  const seenResourceIds = new ImportedBodySet<ResourceId>();
  for (let index = 0; index < orderedNodes.length; index += 1) {
    const resource = orderedNodes[index]![1].resource;
    if (importedBodySetHasValue(seenResourceIds, resource)) continue;
    importedBodySetAddValue(seenResourceIds, resource);
    resourceIds[resourceIds.length] = resource;
  }
  const resolved = await resolveResourcesV7(
    document.resources ?? {},
    resourceIds,
    {
      ...(options.resolver === undefined
        ? {}
        : { resolver: options.resolver }),
      limits: options.resourceLimits,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return importedBodyRuntimeIntegrityFailure();
  }
  if (importedBodyEvaluationAborted(options.signal)) {
    return importedBodyEvaluationAbortFailure();
  }
  if (!resolved.ok) return resolved;

  const createdShapes = new Set<KernelShape>();
  const createdShapeList = importedBodyApply<Record<number, KernelShape>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  let createdShapeCount = 0;
  const shapesByNode = new Map<NodeId, KernelShape>();
  const failAfterCleanup = (
    result: CadResult<never>,
  ): CadResult<EvaluatedDesign> => {
    disposeImportedBodyShapes(
      kernel,
      kernelAccess.value.disposeShape,
      createdShapeList,
      createdShapeCount,
    );
    return result;
  };

  for (let index = 0; index < orderedNodes.length; index += 1) {
    const [nodeId, node] = orderedNodes[index]!;
    if (importedBodyEvaluationAborted(options.signal)) {
      return failAfterCleanup(importedBodyEvaluationAbortFailure(nodeId));
    }
    const bytes = resolved.value.read(node.resource);
    if (bytes === undefined) {
      return failAfterCleanup(
        importedBodyKernelFailure(
          kernelAccess.value.id,
          `Verified resource '${node.resource}' is unavailable for imported body '${nodeId}'`,
          {
            node: nodeId,
            path: `/nodes/${nodeId}/resource`,
            details: {
              protocolViolation: true,
              resourceId: node.resource,
              format: node.format,
            },
          },
        ),
      );
    }

    let shape: KernelShape;
    try {
      shape = importedBodyApply<KernelShape>(
        kernelAccess.value.importDocumentBody,
        kernel,
        [
          bytes,
          importedBodyImportOptions(node),
          {
            feature: nodeId,
            ...(options.signal === undefined
              ? {}
              : { signal: options.signal }),
          },
        ],
      );
    } catch (error) {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return failAfterCleanup(importedBodyRuntimeIntegrityFailure());
      }
      if (importedBodyEvaluationAborted(options.signal)) {
        return failAfterCleanup(importedBodyEvaluationAbortFailure(nodeId));
      }
      return failAfterCleanup(
        importedBodyKernelFailure(
          kernelAccess.value.id,
          `Kernel '${kernelAccess.value.id}' failed to import document body '${nodeId}'`,
          {
            node: nodeId,
            path: `/nodes/${nodeId}`,
            details: {
              resourceId: node.resource,
              format: node.format,
              unitMode: node.units.mode,
              cause: safeErrorMessage(
                error,
                "Document-body import failed with an opaque value",
              ),
            },
          },
        ),
      );
    }
    const duplicate = importedBodyApply<boolean>(
      importedBodySetHas,
      createdShapes,
      [shape],
    );
    if (duplicate) {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return failAfterCleanup(importedBodyRuntimeIntegrityFailure());
      }
      if (importedBodyEvaluationAborted(options.signal)) {
        return failAfterCleanup(importedBodyEvaluationAbortFailure(nodeId));
      }
      return failAfterCleanup(
        importedBodyKernelFailure(
          kernelAccess.value.id,
          `Kernel '${kernelAccess.value.id}' reused an owned shape across imported-body nodes`,
          {
            node: nodeId,
            path: `/nodes/${nodeId}`,
            details: {
              protocolViolation: true,
              resourceId: node.resource,
              format: node.format,
            },
          },
        ),
      );
    }
    importedBodyApply<Set<KernelShape>>(
      importedBodySetAdd,
      createdShapes,
      [shape],
    );
    createdShapeList[createdShapeCount] = shape;
    createdShapeCount += 1;
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return failAfterCleanup(importedBodyRuntimeIntegrityFailure());
    }
    if (importedBodyEvaluationAborted(options.signal)) {
      return failAfterCleanup(importedBodyEvaluationAbortFailure(nodeId));
    }

    try {
      const rawStatus = importedBodyApply<unknown>(
        kernelAccess.value.status,
        kernel,
        [shape],
      );
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return failAfterCleanup(importedBodyRuntimeIntegrityFailure());
      }
      if (importedBodyEvaluationAborted(options.signal)) {
        return failAfterCleanup(importedBodyEvaluationAbortFailure(nodeId));
      }
      const statusOk = importedBodyOwnDataValue(rawStatus, "ok");
      const statusCode = importedBodyOwnDataValue(rawStatus, "code");
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return failAfterCleanup(importedBodyRuntimeIntegrityFailure());
      }
      if (importedBodyEvaluationAborted(options.signal)) {
        return failAfterCleanup(importedBodyEvaluationAbortFailure(nodeId));
      }
      if (
        statusOk.kind !== "data" ||
        typeof statusOk.value !== "boolean" ||
        statusCode.kind !== "data" ||
        typeof statusCode.value !== "string"
      ) {
        return failAfterCleanup(
          importedBodyKernelFailure(
            kernelAccess.value.id,
            `Kernel '${kernelAccess.value.id}' returned malformed imported-body status`,
            {
              node: nodeId,
              path: `/nodes/${nodeId}`,
              details: {
                protocolViolation: true,
                resourceId: node.resource,
                format: node.format,
              },
            },
          ),
        );
      }
      if (statusOk.value !== true) {
        return failAfterCleanup(
          importedBodyKernelFailure(
            kernelAccess.value.id,
            `Kernel '${kernelAccess.value.id}' returned an invalid imported body '${nodeId}'`,
            {
              node: nodeId,
              path: `/nodes/${nodeId}`,
              details: {
                protocolViolation: true,
                resourceId: node.resource,
                format: node.format,
                status: statusCode.value,
              },
            },
          ),
        );
      }
      const rawMeasurements = importedBodyApply<unknown>(
        kernelAccess.value.measure,
        kernel,
        [shape],
      );
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return failAfterCleanup(importedBodyRuntimeIntegrityFailure());
      }
      if (importedBodyEvaluationAborted(options.signal)) {
        return failAfterCleanup(importedBodyEvaluationAbortFailure(nodeId));
      }
      const volume = importedBodyOwnDataValue(rawMeasurements, "volume");
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return failAfterCleanup(importedBodyRuntimeIntegrityFailure());
      }
      if (importedBodyEvaluationAborted(options.signal)) {
        return failAfterCleanup(importedBodyEvaluationAbortFailure(nodeId));
      }
      if (
        volume.kind !== "data" ||
        !importedBodyApply<boolean>(
          importedBodyNumberIsFinite,
          Number,
          [volume.value],
        ) ||
        !(typeof volume.value === "number" && volume.value > 0)
      ) {
        return failAfterCleanup(
          importedBodyKernelFailure(
            kernelAccess.value.id,
            `Kernel '${kernelAccess.value.id}' returned a non-positive imported body '${nodeId}'`,
            {
              node: nodeId,
              path: `/nodes/${nodeId}`,
              details: {
                protocolViolation: true,
                resourceId: node.resource,
                format: node.format,
                volume:
                  volume.kind === "data" &&
                  (typeof volume.value === "number" ||
                    typeof volume.value === "string" ||
                    typeof volume.value === "boolean" ||
                    volume.value === null)
                    ? volume.value
                    : volume.kind,
              },
            },
          ),
        );
      }
    } catch (error) {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return failAfterCleanup(importedBodyRuntimeIntegrityFailure());
      }
      if (importedBodyEvaluationAborted(options.signal)) {
        return failAfterCleanup(importedBodyEvaluationAbortFailure(nodeId));
      }
      return failAfterCleanup(
        importedBodyKernelFailure(
          kernelAccess.value.id,
          `Kernel '${kernelAccess.value.id}' could not validate imported body '${nodeId}'`,
          {
            node: nodeId,
            path: `/nodes/${nodeId}`,
            details: {
              protocolViolation: true,
              resourceId: node.resource,
              format: node.format,
              cause: safeErrorMessage(
                error,
                "Imported-body validation failed with an opaque value",
              ),
            },
          },
        ),
      );
    }
    shapesByNode.set(nodeId, shape);
  }

  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return failAfterCleanup(importedBodyRuntimeIntegrityFailure());
  }
  if (importedBodyEvaluationAborted(options.signal)) {
    return failAfterCleanup(importedBodyEvaluationAbortFailure());
  }
  const owner = new EvaluationOwner(
    kernel,
    createdShapes,
    null,
  );
  captureEvaluationOwnerDocumentName(owner, document.name);
  captureEvaluationOwnerDisposer(
    owner,
    createdShapes,
    (shape) =>
      importedBodyApply<void>(
        kernelAccess.value.disposeShape,
        kernel,
        [shape],
      ),
  );
  const outputs = new Map<string, EvaluatedOutput>();
  for (let index = 0; index < requested.length; index += 1) {
    const name = requested[index]!;
    const nodeId = outputNodes.get(name)!;
    outputs.set(
      name,
      retainStagedImportedBodySolidV7(
        new EvaluatedSolid(
          name,
          owner,
          shapesByNode.get(nodeId)!,
        ),
      ),
    );
  }
  const evaluated = retainStagedImportedBodyDesignV7(
    new EvaluatedDesign(
      owner,
      outputs,
      null,
      Object.freeze({}),
      Object.freeze([]),
    ),
  );
  return success(evaluated);
}

type BodySetLeafNodeV7 = StagedSolidLeafNodeV7;

interface CapturedStagedV7EvaluationOptions<EvaluationLimits> {
  readonly configuration?: string;
  readonly parameters: Readonly<Record<string, number>>;
  readonly outputs?: readonly string[];
  readonly resolver?: ResourceResolverV7;
  readonly evaluationLimits: EvaluationLimits;
  readonly resourceLimits: ResourceResolutionLimitsV7;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

type CapturedBodySetOutputsV7Options =
  CapturedStagedV7EvaluationOptions<BodySetEvaluationLimitsV7>;

interface BodySetKernelAccess extends StagedV7SolidKernelAccess {
  readonly representation: KernelRepresentation;
  readonly exact: boolean;
  readonly box?: NonNullable<GeometryKernel["box"]>;
  readonly cylinder?: NonNullable<GeometryKernel["cylinder"]>;
  readonly sphere?: NonNullable<GeometryKernel["sphere"]>;
  readonly importDocumentBody?: NonNullable<
    GeometryKernel["importDocumentBody"]
  >;
  readonly boolean?: NonNullable<GeometryKernel["boolean"]>;
  readonly transform?: NonNullable<GeometryKernel["transform"]>;
  readonly status: GeometryKernel["status"];
  readonly disposeShape: GeometryKernel["disposeShape"];
}

interface SelectedBodySetOutputV7 {
  readonly name: string;
  readonly nodeId: NodeId;
  readonly node: BodySetNodeIRV7;
}

type ResolvedBodySetPrimitiveV7 =
  | {
      readonly kind: "box";
      readonly size: Vec3;
      readonly center: boolean;
    }
  | {
      readonly kind: "cylinder";
      readonly height: number;
      readonly radiusBottom: number;
      readonly radiusTop: number;
      readonly center: boolean;
      readonly segments?: number;
    }
  | {
      readonly kind: "sphere";
      readonly radius: number;
      readonly segments?: number;
    };

const BODY_SET_EVALUATION_PHASE = "documentV7BodySetEvaluation";
const BODY_SET_EVALUATION_OPTION_KEYS = Object.freeze([
  "configuration",
  "parameters",
  "outputs",
  "resolver",
  "evaluationLimits",
  "resourceLimits",
  "documentLimits",
  "signal",
] as const);
const BODY_SET_EVALUATION_LIMIT_KEYS = Object.freeze([
  "maxSelectedOutputs",
  "maxParameterOverrides",
  "maxBodySetMembers",
  "maxDistinctSolids",
  "maxSolidGraphNodes",
  "maxSolidDependencyLinks",
  "maxTransformOperations",
] as const satisfies readonly (keyof BodySetEvaluationLimitsV7)[]);
const BODY_SET_DOCUMENT_LIMIT_KEY_COUNT =
  importedBodyObjectKeyList(DEFAULT_DESIGN_DOCUMENT_LIMITS).length;

interface StagedV7OwnDataRecordOptions<LimitKey extends string> {
  readonly signal?: AbortSignal;
  readonly maximumOwnKeys?: number;
  readonly limitResource?: LimitKey;
}

type StagedV7PostBoundaryFailure = (
  signal: AbortSignal | undefined,
) => CadResult<never> | undefined;

type StagedV7LimitFailure<LimitKey extends string> = (
  resource: LimitKey,
  limit: number,
  actual: number,
  path: string,
) => CadResult<never>;

function stagedV7OwnDataRecord<LimitKey extends string>(
  value: unknown,
  path: string,
  options: StagedV7OwnDataRecordOptions<LimitKey>,
  phase: string,
  postBoundaryFailure: StagedV7PostBoundaryFailure,
  limitFailure: StagedV7LimitFailure<LimitKey>,
): CadResult<Readonly<Record<string, unknown>>> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      importedBodyArray(value)
    ) {
      return failure(
        diagnostic("IR_INVALID", `${path} must be a plain record`, {
          severity: "error",
          path,
          details: { phase },
        }),
      );
    }
    const prototype = importedBodyApply<object | null>(
      importedBodyObjectGetPrototypeOf,
      Object,
      [value],
    );
    const afterPrototype = postBoundaryFailure(options.signal);
    if (afterPrototype !== undefined) return afterPrototype;
    if (prototype !== null && prototype !== importedBodyObjectPrototype) {
      return failure(
        diagnostic("IR_INVALID", `${path} must be a plain record`, {
          severity: "error",
          path,
          details: { phase },
        }),
      );
    }
    const keys = importedBodyApply<(string | symbol)[]>(
      importedBodyReflectOwnKeys,
      Reflect,
      [value],
    );
    const afterOwnKeys = postBoundaryFailure(options.signal);
    if (afterOwnKeys !== undefined) return afterOwnKeys;
    if (
      options.maximumOwnKeys !== undefined &&
      keys.length > options.maximumOwnKeys
    ) {
      if (options.limitResource !== undefined) {
        return limitFailure(
          options.limitResource,
          options.maximumOwnKeys,
          keys.length,
          path,
        );
      }
      return failure(
        diagnostic("IR_INVALID", `${path} has too many properties`, {
          severity: "error",
          path,
          details: {
            phase,
            limit: options.maximumOwnKeys,
            actual: keys.length,
          },
        }),
      );
    }
    const snapshot = importedBodyApply<Record<string, unknown>>(
      importedBodyObjectCreate,
      Object,
      [null],
    );
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key !== "string") {
        return failure(
          diagnostic("IR_INVALID", `${path} cannot contain symbol properties`, {
            severity: "error",
            path,
            details: { phase },
          }),
        );
      }
      const descriptor = importedBodyApply<PropertyDescriptor | undefined>(
        importedBodyObjectGetOwnPropertyDescriptor,
        Object,
        [value, key],
      );
      const afterDescriptor = postBoundaryFailure(options.signal);
      if (afterDescriptor !== undefined) return afterDescriptor;
      const propertyPath =
        path === "/"
          ? `/${importedBodyJsonPointerSegment(key)}`
          : `${path}/${importedBodyJsonPointerSegment(key)}`;
      if (
        descriptor === undefined ||
        !importedBodyApply<boolean>(
          importedBodyObjectHasOwn,
          Object,
          [descriptor, "value"],
        )
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            `${propertyPath} must be an own data property`,
            {
              severity: "error",
              path: propertyPath,
              details: { phase },
            },
          ),
        );
      }
      importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
        snapshot,
        key,
        {
          configurable: true,
          enumerable: true,
          writable: true,
          value: descriptor.value,
        },
      ]);
    }
    return success(
      importedBodyApply<Readonly<Record<string, unknown>>>(
        importedBodyObjectFreeze,
        Object,
        [snapshot],
      ),
    );
  } catch {
    const afterFailure = postBoundaryFailure(options.signal);
    if (afterFailure !== undefined) return afterFailure;
    return failure(
      diagnostic("IR_INVALID", `${path} could not be read safely`, {
        severity: "error",
        path,
        details: { phase },
      }),
    );
  }
}

type BodySetOwnDataRecordOptions = StagedV7OwnDataRecordOptions<
  keyof BodySetEvaluationLimitsV7
>;

function bodySetOwnDataRecord(
  value: unknown,
  path: string,
  options: BodySetOwnDataRecordOptions = {},
): CadResult<Readonly<Record<string, unknown>>> {
  return stagedV7OwnDataRecord(
    value,
    path,
    options,
    BODY_SET_EVALUATION_PHASE,
    bodySetPostBoundaryFailure,
    bodySetLimitFailure,
  );
}

function bodySetEvaluationLimitKey(
  value: string,
): value is keyof BodySetEvaluationLimitsV7 {
  for (
    let index = 0;
    index < BODY_SET_EVALUATION_LIMIT_KEYS.length;
    index += 1
  ) {
    if (BODY_SET_EVALUATION_LIMIT_KEYS[index] === value) return true;
  }
  return false;
}

function bodySetLimitFailure(
  resource: keyof BodySetEvaluationLimitsV7,
  limit: number,
  actual: number,
  path: string,
): CadResult<never> {
  return failure(
    diagnostic(
      "RESOURCE_LIMIT_EXCEEDED",
      `Body-set evaluation limit '${resource}' (${limit}) was exceeded`,
      {
        severity: "error",
        path,
        details: {
          phase: BODY_SET_EVALUATION_PHASE,
          resource,
          limit,
          actual,
        },
      },
    ),
  );
}

function captureBodySetEvaluationLimits(
  value: unknown,
  signal: AbortSignal | undefined,
): CadResult<BodySetEvaluationLimitsV7> {
  if (value === undefined) {
    return success(DEFAULT_BODY_SET_EVALUATION_LIMITS_V7);
  }
  const captured = bodySetOwnDataRecord(value, "/evaluationLimits", {
    ...(signal === undefined ? {} : { signal }),
    maximumOwnKeys: BODY_SET_EVALUATION_LIMIT_KEYS.length,
  });
  if (!captured.ok) return captured;
  const keys = importedBodyObjectKeyList(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!bodySetEvaluationLimitKey(key)) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Unknown body-set evaluation limit '${key}'`,
          {
            severity: "error",
            path: `/evaluationLimits/${importedBodyJsonPointerSegment(key)}`,
            details: { phase: BODY_SET_EVALUATION_PHASE },
          },
        ),
      );
    }
  }
  const normalized: Record<keyof BodySetEvaluationLimitsV7, number> = {
    maxSelectedOutputs:
      DEFAULT_BODY_SET_EVALUATION_LIMITS_V7.maxSelectedOutputs,
    maxParameterOverrides:
      DEFAULT_BODY_SET_EVALUATION_LIMITS_V7.maxParameterOverrides,
    maxBodySetMembers:
      DEFAULT_BODY_SET_EVALUATION_LIMITS_V7.maxBodySetMembers,
    maxDistinctSolids:
      DEFAULT_BODY_SET_EVALUATION_LIMITS_V7.maxDistinctSolids,
    maxSolidGraphNodes:
      DEFAULT_BODY_SET_EVALUATION_LIMITS_V7.maxSolidGraphNodes,
    maxSolidDependencyLinks:
      DEFAULT_BODY_SET_EVALUATION_LIMITS_V7.maxSolidDependencyLinks,
    maxTransformOperations:
      DEFAULT_BODY_SET_EVALUATION_LIMITS_V7.maxTransformOperations,
  };
  for (
    let index = 0;
    index < BODY_SET_EVALUATION_LIMIT_KEYS.length;
    index += 1
  ) {
    const key = BODY_SET_EVALUATION_LIMIT_KEYS[index]!;
    if (
      !importedBodyApply<boolean>(
        importedBodyObjectHasOwn,
        Object,
        [captured.value, key],
      )
    ) {
      continue;
    }
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !importedBodyApply<boolean>(
        importedBodyNumberIsSafeInteger,
        Number,
        [candidate],
      ) ||
      candidate < 0
    ) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Body-set evaluation limit '${key}' must be a non-negative safe integer`,
          {
            severity: "error",
            path: `/evaluationLimits/${key}`,
            details: { phase: BODY_SET_EVALUATION_PHASE },
          },
        ),
      );
    }
    normalized[key] = candidate;
  }
  return success(
    importedBodyApply<BodySetEvaluationLimitsV7>(
      importedBodyObjectFreeze,
      Object,
      [normalized],
    ),
  );
}

function captureStagedV7ResourceLimits<LimitKey extends string>(
  value: unknown,
  signal: AbortSignal | undefined,
  phase: string,
  postBoundaryFailure: StagedV7PostBoundaryFailure,
  limitFailure: StagedV7LimitFailure<LimitKey>,
): CadResult<ResourceResolutionLimitsV7> {
  if (value === undefined) {
    return success(DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7);
  }
  const captured = stagedV7OwnDataRecord(
    value,
    "/resourceLimits",
    {
      ...(signal === undefined ? {} : { signal }),
      maximumOwnKeys: IMPORTED_BODY_RESOURCE_LIMIT_KEYS.length,
    },
    phase,
    postBoundaryFailure,
    limitFailure,
  );
  if (!captured.ok) return captured;
  const normalized: Record<keyof ResourceResolutionLimitsV7, number> = {
    maxRequestedResourceIds:
      DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7.maxRequestedResourceIds,
    maxResolvedResources:
      DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7.maxResolvedResources,
    maxResourceBytes: DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7.maxResourceBytes,
    maxTotalResourceBytes:
      DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7.maxTotalResourceBytes,
  };
  const keys = importedBodyObjectKeyList(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!importedBodyResourceLimitKey(key)) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Unknown resource-resolution limit '${key}'`,
          {
            severity: "error",
            path: `/resourceLimits/${importedBodyJsonPointerSegment(key)}`,
            details: { phase },
          },
        ),
      );
    }
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !importedBodyApply<boolean>(
        importedBodyNumberIsSafeInteger,
        Number,
        [candidate],
      ) ||
      candidate < 0
    ) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Resource-resolution limit '${key}' must be a non-negative safe integer`,
          {
            severity: "error",
            path: `/resourceLimits/${key}`,
            details: { phase },
          },
        ),
      );
    }
    normalized[key] = candidate;
  }
  return success(
    importedBodyApply<ResourceResolutionLimitsV7>(
      importedBodyObjectFreeze,
      Object,
      [normalized],
    ),
  );
}

function captureBodySetResourceLimits(
  value: unknown,
  signal: AbortSignal | undefined,
): CadResult<ResourceResolutionLimitsV7> {
  return captureStagedV7ResourceLimits(
    value,
    signal,
    BODY_SET_EVALUATION_PHASE,
    bodySetPostBoundaryFailure,
    bodySetLimitFailure,
  );
}

function captureStagedV7OutputNames<LimitKey extends string>(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
  phase: string,
  postBoundaryFailure: StagedV7PostBoundaryFailure,
  limitFailure: StagedV7LimitFailure<LimitKey>,
  selectedOutputLimit: LimitKey,
): CadResult<readonly string[] | undefined> {
  if (value === undefined) return success(undefined);
  try {
    if (!importedBodyArray(value)) {
      return failure(
        diagnostic("IR_INVALID", "outputs must be an array", {
          severity: "error",
          path: "/outputs",
          details: { phase },
        }),
      );
    }
    const lengthDescriptor = importedBodyApply<
      PropertyDescriptor | undefined
    >(importedBodyObjectGetOwnPropertyDescriptor, Object, [value, "length"]);
    const afterLength = postBoundaryFailure(signal);
    if (afterLength !== undefined) return afterLength;
    const length = lengthDescriptor?.value;
    if (
      typeof length !== "number" ||
      !importedBodyApply<boolean>(
        importedBodyNumberIsSafeInteger,
        Number,
        [length],
      ) ||
      length < 0
    ) {
      return failure(
        diagnostic("IR_INVALID", "outputs has an invalid array length", {
          severity: "error",
          path: "/outputs",
          details: { phase },
        }),
      );
    }
    if (length > maximum) {
      return limitFailure(selectedOutputLimit, maximum, length, "/outputs");
    }
    const names: string[] = [];
    const allowedKeys = new ImportedBodySet<string>();
    const seen = new ImportedBodySet<string>();
    importedBodySetAddValue(allowedKeys, "length");
    for (let index = 0; index < length; index += 1) {
      const key = `${index}`;
      importedBodySetAddValue(allowedKeys, key);
      const descriptor = importedBodyApply<PropertyDescriptor | undefined>(
        importedBodyObjectGetOwnPropertyDescriptor,
        Object,
        [value, key],
      );
      const afterDescriptor = postBoundaryFailure(signal);
      if (afterDescriptor !== undefined) return afterDescriptor;
      if (
        descriptor === undefined ||
        !importedBodyApply<boolean>(
          importedBodyObjectHasOwn,
          Object,
          [descriptor, "value"],
        ) ||
        typeof descriptor.value !== "string"
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            `outputs[${index}] must be an own string data property`,
            {
              severity: "error",
              path: `/outputs/${index}`,
              details: { phase },
            },
          ),
        );
      }
      if (!importedBodySetHasValue(seen, descriptor.value)) {
        importedBodySetAddValue(seen, descriptor.value);
        importedBodyArrayAppend(names, descriptor.value);
      }
    }
    const ownKeys = importedBodyApply<(string | symbol)[]>(
      importedBodyReflectOwnKeys,
      Reflect,
      [value],
    );
    const afterOwnKeys = postBoundaryFailure(signal);
    if (afterOwnKeys !== undefined) return afterOwnKeys;
    if (ownKeys.length !== length + 1) {
      return failure(
        diagnostic(
          "IR_INVALID",
          "outputs cannot contain non-index properties",
          {
            severity: "error",
            path: "/outputs",
            details: { phase },
          },
        ),
      );
    }
    for (let index = 0; index < ownKeys.length; index += 1) {
      const key = ownKeys[index]!;
      if (
        typeof key !== "string" ||
        !importedBodySetHasValue(allowedKeys, key)
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            "outputs cannot contain non-index properties",
            {
              severity: "error",
              path: "/outputs",
              details: { phase },
            },
          ),
        );
      }
    }
    return success(
      importedBodyApply<readonly string[]>(
        importedBodyObjectFreeze,
        Object,
        [names],
      ),
    );
  } catch {
    const afterFailure = postBoundaryFailure(signal);
    if (afterFailure !== undefined) return afterFailure;
    return failure(
      diagnostic("IR_INVALID", "outputs could not be read safely", {
        severity: "error",
        path: "/outputs",
        details: { phase },
      }),
    );
  }
}

function captureBodySetOutputNames(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
): CadResult<readonly string[] | undefined> {
  return captureStagedV7OutputNames(
    value,
    maximum,
    signal,
    BODY_SET_EVALUATION_PHASE,
    bodySetPostBoundaryFailure,
    bodySetLimitFailure,
    "maxSelectedOutputs",
  );
}

function captureStagedV7Parameters<LimitKey extends string>(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
  phase: string,
  postBoundaryFailure: StagedV7PostBoundaryFailure,
  limitFailure: StagedV7LimitFailure<LimitKey>,
  parameterLimit: LimitKey,
): CadResult<Readonly<Record<string, number>>> {
  if (value === undefined) {
    return success(
      importedBodyApply<Readonly<Record<string, number>>>(
        importedBodyObjectFreeze,
        Object,
        [
          importedBodyApply<Record<string, number>>(
            importedBodyObjectCreate,
            Object,
            [null],
          ),
        ],
      ),
    );
  }
  const captured = stagedV7OwnDataRecord(
    value,
    "/parameters",
    {
      ...(signal === undefined ? {} : { signal }),
      maximumOwnKeys: maximum,
      limitResource: parameterLimit,
    },
    phase,
    postBoundaryFailure,
    limitFailure,
  );
  if (!captured.ok) return captured;
  const keys = importedBodyObjectKeyList(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !importedBodyApply<boolean>(
        importedBodyNumberIsFinite,
        Number,
        [candidate],
      )
    ) {
      return failure(
        diagnostic(
          "EXPRESSION_INVALID",
          `Caller parameter override '${key}' must be a finite number`,
          {
            severity: "error",
            path: `/parameters/${importedBodyJsonPointerSegment(key)}`,
            details: { phase },
          },
        ),
      );
    }
  }
  return success(
    captured.value as Readonly<Record<string, number>>,
  );
}

function captureBodySetParameters(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
): CadResult<Readonly<Record<string, number>>> {
  return captureStagedV7Parameters(
    value,
    maximum,
    signal,
    BODY_SET_EVALUATION_PHASE,
    bodySetPostBoundaryFailure,
    bodySetLimitFailure,
    "maxParameterOverrides",
  );
}

interface StagedV7CommonEvaluationLimits {
  readonly maxSelectedOutputs: number;
  readonly maxParameterOverrides: number;
}

function captureStagedV7EvaluationOptions<
  EvaluationLimits extends StagedV7CommonEvaluationLimits,
  LimitKey extends keyof EvaluationLimits & string,
>(
  value: unknown,
  subject: string,
  phase: string,
  optionKeys: readonly string[],
  postBoundaryFailure: StagedV7PostBoundaryFailure,
  limitFailure: StagedV7LimitFailure<LimitKey>,
  captureEvaluationLimits: (
    candidate: unknown,
    signal: AbortSignal | undefined,
  ) => CadResult<EvaluationLimits>,
  captureResourceLimits: (
    candidate: unknown,
    signal: AbortSignal | undefined,
  ) => CadResult<ResourceResolutionLimitsV7>,
  captureOutputNames: (
    candidate: unknown,
    maximum: number,
    signal: AbortSignal | undefined,
  ) => CadResult<readonly string[] | undefined>,
  captureParameters: (
    candidate: unknown,
    maximum: number,
    signal: AbortSignal | undefined,
  ) => CadResult<Readonly<Record<string, number>>>,
): CadResult<CapturedStagedV7EvaluationOptions<EvaluationLimits>> {
  const captured = stagedV7OwnDataRecord(
    value,
    "/",
    { maximumOwnKeys: optionKeys.length },
    phase,
    postBoundaryFailure,
    limitFailure,
  );
  if (!captured.ok) return captured;
  const keys = importedBodyObjectKeyList(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    let known = false;
    for (let optionIndex = 0; optionIndex < optionKeys.length; optionIndex += 1) {
      if (optionKeys[optionIndex] === key) {
        known = true;
        break;
      }
    }
    if (!known) {
      return failure(
        diagnostic("IR_INVALID", `Unknown ${subject} evaluation option '${key}'`, {
          severity: "error",
          path: `/${importedBodyJsonPointerSegment(key)}`,
          details: { phase },
        }),
      );
    }
  }
  const rawSignal = captured.value.signal;
  if (
    rawSignal !== undefined &&
    importedBodyAbortState(rawSignal) === undefined
  ) {
    return failure(
      diagnostic("IR_INVALID", "signal must be an AbortSignal", {
        severity: "error",
        path: "/signal",
        details: { phase },
      }),
    );
  }
  const signal =
    rawSignal === undefined ? undefined : rawSignal as AbortSignal;
  const afterSignal = postBoundaryFailure(signal);
  if (afterSignal !== undefined) return afterSignal;

  const configuration = captured.value.configuration;
  if (configuration !== undefined && typeof configuration !== "string") {
    return failure(
      diagnostic("IR_INVALID", "configuration must be a string", {
        severity: "error",
        path: "/configuration",
        details: { phase },
      }),
    );
  }
  const evaluationLimits = captureEvaluationLimits(
    captured.value.evaluationLimits,
    signal,
  );
  const afterEvaluationLimits = postBoundaryFailure(signal);
  if (afterEvaluationLimits !== undefined) return afterEvaluationLimits;
  if (!evaluationLimits.ok) return evaluationLimits;
  const resourceLimits = captureResourceLimits(
    captured.value.resourceLimits,
    signal,
  );
  const afterResourceLimits = postBoundaryFailure(signal);
  if (afterResourceLimits !== undefined) return afterResourceLimits;
  if (!resourceLimits.ok) return resourceLimits;
  const outputs = captureOutputNames(
    captured.value.outputs,
    evaluationLimits.value.maxSelectedOutputs,
    signal,
  );
  const afterOutputs = postBoundaryFailure(signal);
  if (afterOutputs !== undefined) return afterOutputs;
  if (!outputs.ok) return outputs;
  const parameters = captureParameters(
    captured.value.parameters,
    evaluationLimits.value.maxParameterOverrides,
    signal,
  );
  const afterParameters = postBoundaryFailure(signal);
  if (afterParameters !== undefined) return afterParameters;
  if (!parameters.ok) return parameters;
  const resolver = captured.value.resolver;
  if (resolver !== undefined && typeof resolver !== "function") {
    return failure(
      diagnostic("IR_INVALID", "resolver must be a function", {
        severity: "error",
        path: "/resolver",
        details: { phase },
      }),
    );
  }
  let documentLimits: Partial<DesignDocumentLimits> | undefined;
  if (captured.value.documentLimits !== undefined) {
    const snapshot = stagedV7OwnDataRecord(
      captured.value.documentLimits,
      "/documentLimits",
      {
        ...(signal === undefined ? {} : { signal }),
        maximumOwnKeys: BODY_SET_DOCUMENT_LIMIT_KEY_COUNT,
      },
      phase,
      postBoundaryFailure,
      limitFailure,
    );
    const afterDocumentLimits = postBoundaryFailure(signal);
    if (afterDocumentLimits !== undefined) return afterDocumentLimits;
    if (!snapshot.ok) return snapshot;
    documentLimits =
      snapshot.value as unknown as Partial<DesignDocumentLimits>;
  }
  return success(
    importedBodyApply<CapturedStagedV7EvaluationOptions<EvaluationLimits>>(
      importedBodyObjectFreeze,
      Object,
      [
        {
          ...(configuration === undefined ? {} : { configuration }),
          parameters: parameters.value,
          ...(outputs.value === undefined ? {} : { outputs: outputs.value }),
          ...(resolver === undefined
            ? {}
            : { resolver: resolver as ResourceResolverV7 }),
          evaluationLimits: evaluationLimits.value,
          resourceLimits: resourceLimits.value,
          ...(documentLimits === undefined ? {} : { documentLimits }),
          ...(signal === undefined ? {} : { signal }),
        },
      ],
    ),
  );
}

function captureBodySetEvaluationOptions(
  value: unknown,
): CadResult<CapturedBodySetOutputsV7Options> {
  return captureStagedV7EvaluationOptions(
    value,
    "body-set",
    BODY_SET_EVALUATION_PHASE,
    BODY_SET_EVALUATION_OPTION_KEYS,
    bodySetPostBoundaryFailure,
    bodySetLimitFailure,
    captureBodySetEvaluationLimits,
    captureBodySetResourceLimits,
    captureBodySetOutputNames,
    captureBodySetParameters,
  );
}

function bodySetEvaluationAborted(
  signal: AbortSignal | undefined,
): boolean {
  return importedBodyEvaluationAborted(signal);
}

function bodySetEvaluationAbortFailure(
  node?: NodeId,
): CadResult<never> {
  return failure(
    diagnostic("EVALUATION_ABORTED", "Body-set evaluation was aborted", {
      severity: "error",
      ...(node === undefined ? {} : { node, path: `/nodes/${node}` }),
      details: { phase: BODY_SET_EVALUATION_PHASE },
    }),
  );
}

function bodySetRuntimeIntegrityFailure(): CadResult<never> {
  return failure(
    diagnostic("IR_INVALID", DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE, {
      severity: "error",
      details: {
        phase: BODY_SET_EVALUATION_PHASE,
        runtimeIntegrity: false,
      },
    }),
  );
}

function bodySetThrownCause(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function bodySetKernelFailure(
  kernel: string,
  message: string,
  options: {
    readonly node?: NodeId;
    readonly path?: string;
    readonly details?: Readonly<Record<string, unknown>>;
  } = {},
): CadResult<never> {
  return failure(
    diagnostic("KERNEL_ERROR", message, {
      severity: "error",
      ...(options.node === undefined ? {} : { node: options.node }),
      ...(options.path === undefined ? {} : { path: options.path }),
      details: {
        phase: BODY_SET_EVALUATION_PHASE,
        kernel,
        ...options.details,
      },
    }),
  );
}

function bodySetCapabilityFailure(
  kernel: string,
  node: NodeId,
  kind: "primitive" | "feature" | "documentBodyImport",
  capability: string,
  message: string,
): CadResult<never> {
  return failure(
    diagnostic("KERNEL_CAPABILITY_MISSING", message, {
      severity: "error",
      node,
      path: `/nodes/${node}`,
      details: {
        phase: BODY_SET_EVALUATION_PHASE,
        kernel,
        kind,
        capability,
      },
    }),
  );
}

function bodySetPostBoundaryFailure(
  signal: AbortSignal | undefined,
  node?: NodeId,
): CadResult<never> | undefined {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return bodySetRuntimeIntegrityFailure();
  }
  if (bodySetEvaluationAborted(signal)) {
    return bodySetEvaluationAbortFailure(node);
  }
  return undefined;
}

interface StagedV7SolidDiagnosticContext {
  readonly phase: string;
  readonly capabilityScope: string;
  readonly solidLabel: string;
  readonly solidFailureLabel: string;
  readonly postBoundaryFailure: typeof bodySetPostBoundaryFailure;
  readonly kernelFailure: typeof bodySetKernelFailure;
  readonly capabilityFailure: typeof bodySetCapabilityFailure;
}

const BODY_SET_SOLID_DIAGNOSTICS =
  Object.freeze<StagedV7SolidDiagnosticContext>({
    phase: BODY_SET_EVALUATION_PHASE,
    capabilityScope: "body-set",
    solidLabel: "body-set solid",
    solidFailureLabel: "Body-set solid",
    postBoundaryFailure: bodySetPostBoundaryFailure,
    kernelFailure: bodySetKernelFailure,
    capabilityFailure: bodySetCapabilityFailure,
  });

function validateStagedBooleanExactEvolutionCapabilities(
  property: ImportedBodyOwnDataValue,
  advertisedFeatures: readonly unknown[],
  exact: boolean,
  kernelId: string,
  nodeId: NodeId,
  signal: AbortSignal | undefined,
  diagnostics: StagedV7SolidDiagnosticContext,
): CadResult<undefined> {
  if (
    property.kind === "missing" ||
    (property.kind === "data" && property.value === undefined)
  ) {
    return success(undefined);
  }

  const malformed = (
    reason: string,
    details: Readonly<Record<string, unknown>> = {},
  ): CadResult<never> =>
    diagnostics.kernelFailure(
      kernelId,
      `Kernel '${kernelId}' declares malformed exact indexed topology evolution metadata`,
      {
        node: nodeId,
        path: `/nodes/${nodeId}`,
        details: {
          protocolViolation: true,
          kind: "exactIndexedTopologyEvolution",
          capability: "boolean",
          reason,
          ...details,
        },
      },
    );

  if (property.kind !== "data") {
    return malformed("capability metadata must use an own data property");
  }
  const snapshot = preflightDesignDocumentValue(
    property.value,
    IMPORTED_BODY_CAPABILITY_SNAPSHOT_LIMITS,
    { strictV7Snapshot: true },
  );
  const afterSnapshot = diagnostics.postBoundaryFailure(signal, nodeId);
  if (afterSnapshot !== undefined) return afterSnapshot;
  if (
    !snapshot.ok ||
    typeof snapshot.value !== "object" ||
    snapshot.value === null ||
    importedBodyArray(snapshot.value)
  ) {
    return malformed("capability metadata must be a safe plain object");
  }

  const protocolVersion = importedBodyOwnDataValue(
    snapshot.value,
    "protocolVersion",
  );
  const features = importedBodyOwnDataValue(snapshot.value, "features");
  if (
    protocolVersion.kind !== "data" ||
    protocolVersion.value !==
      EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION
  ) {
    return malformed("unsupported protocol version", {
      expectedProtocolVersion:
        EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
      actualProtocolVersion:
        protocolVersion.kind === "data" &&
        (typeof protocolVersion.value === "string" ||
          typeof protocolVersion.value === "number" ||
          typeof protocolVersion.value === "boolean" ||
          protocolVersion.value === null)
          ? protocolVersion.value
          : protocolVersion.kind,
    });
  }
  if (features.kind !== "data" || !importedBodyArray(features.value)) {
    return malformed("features must be a dense array of feature names");
  }

  const exactFeatures = features.value;
  const seenFeatures = new ImportedBodySet<string>();
  for (let index = 0; index < exactFeatures.length; index += 1) {
    const feature = exactFeatures[index];
    if (typeof feature !== "string") {
      return malformed("features must be a dense array of feature names");
    }
    if (importedBodySetHasValue(seenFeatures, feature)) {
      return malformed("features must not contain duplicates", { feature });
    }
    importedBodySetAddValue(seenFeatures, feature);

    let declared = false;
    for (
      let declaredIndex = 0;
      declaredIndex < advertisedFeatures.length;
      declaredIndex += 1
    ) {
      if (advertisedFeatures[declaredIndex] === feature) {
        declared = true;
        break;
      }
    }
    if (!declared) {
      return malformed(
        "exact evolution features must be declared kernel features",
        { feature },
      );
    }
  }
  if (!exact) {
    return malformed("exact evolution requires an exact kernel");
  }
  return success(undefined);
}

function captureBodySetKernelAccess(
  kernel: GeometryKernel,
  plan: StagedSolidGraphPlanV7,
  signal: AbortSignal | undefined,
  diagnostics: StagedV7SolidDiagnosticContext = BODY_SET_SOLID_DIAGNOSTICS,
): CadResult<BodySetKernelAccess> {
  const orderedLeaves = plan.leafNodes;
  let firstBooleanNode: NodeId | undefined;
  let firstTransformNode: NodeId | undefined;
  for (let index = 0; index < plan.orderedNodes.length; index += 1) {
    const [nodeId, node] = plan.orderedNodes[index]!;
    if (node.kind === "boolean" && firstBooleanNode === undefined) {
      firstBooleanNode = nodeId;
    } else if (
      node.kind === "transform" &&
      firstTransformNode === undefined
    ) {
      firstTransformNode = nodeId;
    }
    if (
      firstBooleanNode !== undefined &&
      firstTransformNode !== undefined
    ) break;
  }
  const {
    postBoundaryFailure,
    kernelFailure,
    capabilityFailure,
  } = diagnostics;
  let importsRequired = false;
  for (let index = 0; index < orderedLeaves.length; index += 1) {
    if (orderedLeaves[index]![1].kind === "importedBody") {
      importsRequired = true;
      break;
    }
  }
  let id = "<unknown>";
  try {
    const rawId: unknown = kernel.id;
    const afterId = postBoundaryFailure(signal);
    if (afterId !== undefined) return afterId;
    if (typeof rawId === "string") id = rawId;

    const rawCapabilities: unknown = kernel.capabilities;
    const afterCapabilities = postBoundaryFailure(signal);
    if (afterCapabilities !== undefined) return afterCapabilities;
    const protocolProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "protocolVersion",
    );
    const afterProtocol = postBoundaryFailure(signal);
    if (afterProtocol !== undefined) return afterProtocol;
    const representationProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "representation",
    );
    const afterRepresentation = postBoundaryFailure(signal);
    if (afterRepresentation !== undefined) return afterRepresentation;
    const exactProperty = importedBodyOwnDataValue(rawCapabilities, "exact");
    const afterExact = postBoundaryFailure(signal);
    if (afterExact !== undefined) return afterExact;
    const primitivesProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "primitives",
    );
    const afterPrimitives = postBoundaryFailure(signal);
    if (afterPrimitives !== undefined) return afterPrimitives;
    const featuresProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "features",
    );
    const afterFeatures = postBoundaryFailure(signal);
    if (afterFeatures !== undefined) return afterFeatures;
    const importProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "documentBodyImport",
    );
    const afterImport = postBoundaryFailure(signal);
    if (afterImport !== undefined) return afterImport;
    const nativeExportsProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "nativeExports",
    );
    const afterNativeExports = postBoundaryFailure(signal);
    if (afterNativeExports !== undefined) return afterNativeExports;
    const stepExportProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "stepExport",
    );
    const afterStepExport = postBoundaryFailure(signal);
    if (afterStepExport !== undefined) return afterStepExport;
    const topologyProperty = importedBodyOwnDataValue(
      rawCapabilities,
      "topology",
    );
    const afterTopology = postBoundaryFailure(signal);
    if (afterTopology !== undefined) return afterTopology;
    const exactEvolutionProperty: ImportedBodyOwnDataValue =
      firstBooleanNode === undefined
        ? { kind: "missing" }
        : importedBodyOwnDataValue(
            rawCapabilities,
            "exactIndexedTopologyEvolution",
          );
    const afterExactEvolution = postBoundaryFailure(signal);
    if (afterExactEvolution !== undefined) return afterExactEvolution;
    if (
      protocolProperty.kind !== "data" ||
      representationProperty.kind !== "data" ||
      exactProperty.kind !== "data" ||
      primitivesProperty.kind !== "data" ||
      featuresProperty.kind !== "data" ||
      nativeExportsProperty.kind !== "data" ||
      topologyProperty.kind === "invalid" ||
      (importsRequired && importProperty.kind === "invalid")
    ) {
      return kernelFailure(
        id,
        `Kernel '${id}' capabilities must use own data properties`,
        { details: { protocolViolation: true } },
      );
    }
    if (
      protocolProperty.value !== GEOMETRY_KERNEL_PROTOCOL_VERSION
    ) {
      return failure(
        diagnostic(
          "KERNEL_CAPABILITY_MISSING",
          `Kernel '${id}' uses an unsupported geometry protocol version`,
          {
            severity: "error",
            details: {
              phase: diagnostics.phase,
              kernel: id,
              expected: GEOMETRY_KERNEL_PROTOCOL_VERSION,
              actual:
                typeof protocolProperty.value === "string" ||
                typeof protocolProperty.value === "number" ||
                typeof protocolProperty.value === "boolean" ||
                protocolProperty.value === null
                  ? protocolProperty.value
                  : typeof protocolProperty.value,
            },
          },
        ),
      );
    }
    const representation = representationProperty.value;
    if (
      representation !== "mesh" &&
      representation !== "brep" &&
      representation !== "sdf"
    ) {
      return kernelFailure(
        id,
        `Kernel '${id}' declares an invalid representation`,
        { details: { protocolViolation: true } },
      );
    }
    if (typeof exactProperty.value !== "boolean") {
      return kernelFailure(
        id,
        `Kernel '${id}' declares an invalid exactness flag`,
        { details: { protocolViolation: true } },
      );
    }
    const exact = exactProperty.value;

    const primitiveSnapshot = preflightDesignDocumentValue(
      primitivesProperty.value,
      IMPORTED_BODY_CAPABILITY_SNAPSHOT_LIMITS,
      { strictV7Snapshot: true },
    );
    const afterPrimitiveSnapshot = postBoundaryFailure(signal);
    if (afterPrimitiveSnapshot !== undefined) {
      return afterPrimitiveSnapshot;
    }
    if (!primitiveSnapshot.ok || !importedBodyArray(primitiveSnapshot.value)) {
      return kernelFailure(
        id,
        `Kernel '${id}' declares unsafe primitive capabilities`,
        {
          details: {
            protocolViolation: true,
            reason: "unsafe-capability-metadata",
          },
        },
      );
    }
    const advertisedPrimitives = primitiveSnapshot.value;
    for (
      let index = 0;
      index < advertisedPrimitives.length;
      index += 1
    ) {
      const primitive = advertisedPrimitives[index];
      if (
        primitive !== "box" &&
        primitive !== "cylinder" &&
        primitive !== "sphere"
      ) {
        return kernelFailure(
          id,
          `Kernel '${id}' declares an invalid primitive capability`,
          {
            details: {
              protocolViolation: true,
              primitive:
                typeof primitive === "string" ? primitive : typeof primitive,
            },
          },
        );
      }
    }

    const featureSnapshot = preflightDesignDocumentValue(
      featuresProperty.value,
      IMPORTED_BODY_CAPABILITY_SNAPSHOT_LIMITS,
      { strictV7Snapshot: true },
    );
    const afterFeatureSnapshot = postBoundaryFailure(signal);
    if (afterFeatureSnapshot !== undefined) {
      return afterFeatureSnapshot;
    }
    if (!featureSnapshot.ok || !importedBodyArray(featureSnapshot.value)) {
      return kernelFailure(
        id,
        `Kernel '${id}' declares unsafe feature capabilities`,
        {
          details: {
            protocolViolation: true,
            reason: "unsafe-capability-metadata",
          },
        },
      );
    }
    const advertisedFeatures = featureSnapshot.value;
    let booleanAdvertised = false;
    let transformAdvertised = false;
    for (
      let index = 0;
      index < advertisedFeatures.length;
      index += 1
    ) {
      const feature = advertisedFeatures[index];
      if (
        feature !== "extrude" &&
        feature !== "revolve" &&
        feature !== "loft" &&
        feature !== "sweep" &&
        feature !== "circularArcSweep" &&
        feature !== "compositeSweep" &&
        feature !== "boolean" &&
        feature !== "transform" &&
        feature !== "fillet" &&
        feature !== "chamfer" &&
        feature !== "shell" &&
        feature !== "offset" &&
        feature !== "draft"
      ) {
        return kernelFailure(
          id,
          `Kernel '${id}' declares an invalid feature capability`,
          {
            details: {
              protocolViolation: true,
              feature:
                typeof feature === "string" ? feature : typeof feature,
            },
          },
        );
      }
      if (feature === "boolean") booleanAdvertised = true;
      if (feature === "transform") transformAdvertised = true;
    }
    if (firstBooleanNode !== undefined && !booleanAdvertised) {
      return capabilityFailure(
        id,
        firstBooleanNode,
        "feature",
        "boolean",
        `Kernel '${id}' does not support feature 'boolean'`,
      );
    }
    if (firstTransformNode !== undefined && !transformAdvertised) {
      return capabilityFailure(
        id,
        firstTransformNode,
        "feature",
        "transform",
        `Kernel '${id}' does not support feature 'transform'`,
      );
    }
    if (firstBooleanNode !== undefined) {
      const exactEvolution =
        validateStagedBooleanExactEvolutionCapabilities(
          exactEvolutionProperty,
          advertisedFeatures,
          exact,
          id,
          firstBooleanNode,
          signal,
          diagnostics,
        );
      if (!exactEvolution.ok) return exactEvolution;
    }

    const nativeExportsSnapshot = preflightDesignDocumentValue(
      nativeExportsProperty.value,
      IMPORTED_BODY_CAPABILITY_SNAPSHOT_LIMITS,
      { strictV7Snapshot: true },
    );
    const afterNativeExportsSnapshot = postBoundaryFailure(signal);
    if (afterNativeExportsSnapshot !== undefined) {
      return afterNativeExportsSnapshot;
    }
    if (
      !nativeExportsSnapshot.ok ||
      !importedBodyArray(nativeExportsSnapshot.value)
    ) {
      return kernelFailure(
        id,
        `Kernel '${id}' declares unsafe native-export capabilities`,
        {
          details: {
            protocolViolation: true,
            reason: "unsafe-capability-metadata",
          },
        },
      );
    }
    const nativeExports: KernelExchangeFormat[] = [];
    for (
      let index = 0;
      index < nativeExportsSnapshot.value.length;
      index += 1
    ) {
      const format = nativeExportsSnapshot.value[index];
      if (
        format !== "step" &&
        format !== "brep" &&
        format !== "brep-binary"
      ) {
        return kernelFailure(
          id,
          `Kernel '${id}' declares an invalid native-export capability`,
          {
            details: {
              protocolViolation: true,
              format: typeof format === "string" ? format : typeof format,
            },
          },
        );
      }
      importedBodyArrayAppend(nativeExports, format);
    }
    importedBodyApply<void>(importedBodyObjectFreeze, Object, [
      nativeExports,
    ]);

    let stepExport: StepExportCapabilityState;
    if (stepExportProperty.kind === "invalid") {
      stepExport = importedBodyApply<StepExportCapabilityState>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            status: "malformed",
            reason: "uninspectable-metadata",
          },
        ],
      );
    } else {
      const inspection = inspectKernelStepExportCapabilities({
        protocolVersion: GEOMETRY_KERNEL_PROTOCOL_VERSION,
        representation,
        exact,
        primitives: [],
        features: [],
        nativeImports: [],
        nativeExports: [],
        ...(stepExportProperty.kind === "data"
          ? { stepExport: stepExportProperty.value as never }
          : {}),
      });
      const afterStepExportInspection = postBoundaryFailure(signal);
      if (afterStepExportInspection !== undefined) {
        return afterStepExportInspection;
      }
      stepExport = importedBodyApply<StepExportCapabilityState>(
        importedBodyObjectFreeze,
        Object,
        [
          inspection.status === "malformed"
            ? {
                status: "malformed",
                reason: inspection.reason,
              }
            : inspection.status === "valid"
              ? {
                  status: "valid",
                  maxMetadataBytes:
                    inspection.capabilities.maxMetadataBytes,
                }
              : { status: "absent" },
        ],
      );
    }

    let topologyAdvertised = false;
    if (
      topologyProperty.kind === "data" &&
      topologyProperty.value !== undefined
    ) {
      const topologySnapshot = preflightDesignDocumentValue(
        topologyProperty.value,
        IMPORTED_BODY_CAPABILITY_SNAPSHOT_LIMITS,
        { strictV7Snapshot: true },
      );
      const afterTopologySnapshot = postBoundaryFailure(signal);
      if (afterTopologySnapshot !== undefined) {
        return afterTopologySnapshot;
      }
      if (
        !topologySnapshot.ok ||
        typeof topologySnapshot.value !== "object" ||
        topologySnapshot.value === null ||
        importedBodyArray(topologySnapshot.value)
      ) {
        return kernelFailure(
          id,
          `Kernel '${id}' declares unsafe topology capabilities`,
          {
            details: {
              protocolViolation: true,
              reason: "unsafe-capability-metadata",
            },
          },
        );
      }
      topologyAdvertised = true;
    }

    const requiredPrimitives = new ImportedBodySet<KernelPrimitive>();
    const firstPrimitiveNodes = new Map<KernelPrimitive, NodeId>();
    const importedNodes: [NodeId, ImportedBodyNodeIRV7][] = [];
    for (let index = 0; index < orderedLeaves.length; index += 1) {
      const [nodeId, node] = orderedLeaves[index]!;
      if (node.kind === "importedBody") {
        importedBodyArrayAppend(importedNodes, [nodeId, node]);
        continue;
      }
      if (!importedBodySetHasValue(requiredPrimitives, node.kind)) {
        importedBodySetAddValue(requiredPrimitives, node.kind);
        firstPrimitiveNodes.set(node.kind, nodeId);
      }
    }
    for (const primitive of ["box", "cylinder", "sphere"] as const) {
      if (!importedBodySetHasValue(requiredPrimitives, primitive)) continue;
      let advertised = false;
      for (
        let index = 0;
        index < advertisedPrimitives.length;
        index += 1
      ) {
        if (advertisedPrimitives[index] === primitive) {
          advertised = true;
          break;
        }
      }
      if (!advertised) {
        const nodeId = firstPrimitiveNodes.get(primitive)!;
        return capabilityFailure(
          id,
          nodeId,
          "primitive",
          primitive,
          `Kernel '${id}' does not support primitive '${primitive}'`,
        );
      }
    }

    let documentBodyImport: unknown;
    if (
      importedNodes.length > 0 &&
      importProperty.kind === "data" &&
      importProperty.value !== undefined
    ) {
      const capturedImport = preflightDesignDocumentValue(
        importProperty.value,
        IMPORTED_BODY_CAPABILITY_SNAPSHOT_LIMITS,
        { strictV7Snapshot: true },
      );
      const afterImportSnapshot = postBoundaryFailure(signal);
      if (afterImportSnapshot !== undefined) return afterImportSnapshot;
      if (!capturedImport.ok) {
        return kernelFailure(
          id,
          `Kernel '${id}' declares unsafe document-body import capabilities`,
          {
            details: {
              protocolViolation: true,
              reason: "unsafe-capability-metadata",
            },
          },
        );
      }
      documentBodyImport = capturedImport.value;
    }
    if (importedNodes.length > 0) {
      const capabilities = {
        protocolVersion: protocolProperty.value,
        representation,
        exact,
        primitives: advertisedPrimitives,
        features: [],
        nativeImports: [],
        nativeExports: [],
        ...(documentBodyImport === undefined ? {} : { documentBodyImport }),
      } as unknown as GeometryKernel["capabilities"];
      const inspection =
        inspectKernelDocumentBodyImportCapabilities(capabilities);
      const afterInspection = postBoundaryFailure(signal);
      if (afterInspection !== undefined) return afterInspection;
      if (inspection.status === "malformed") {
        return kernelFailure(
          id,
          `Kernel '${id}' declares malformed document-body import capabilities`,
          {
            details: {
              protocolViolation: true,
              reason: inspection.reason,
            },
          },
        );
      }
      if (inspection.status === "absent") {
        const [nodeId, node] = importedNodes[0]!;
        return capabilityFailure(
          id,
          nodeId,
          "documentBodyImport",
          `${node.format}:${node.units.mode}`,
          `Kernel '${id}' does not support strong document-body import`,
        );
      }
      for (let nodeIndex = 0; nodeIndex < importedNodes.length; nodeIndex += 1) {
        const [nodeId, node] = importedNodes[nodeIndex]!;
        let supported = false;
        for (
          let formatIndex = 0;
          formatIndex < inspection.capabilities.formats.length;
          formatIndex += 1
        ) {
          const format = inspection.capabilities.formats[formatIndex]!;
          if (format.format !== node.format) continue;
          for (
            let modeIndex = 0;
            modeIndex < format.unitModes.length;
            modeIndex += 1
          ) {
            if (format.unitModes[modeIndex] === node.units.mode) {
              supported = true;
              break;
            }
          }
          break;
        }
        if (!supported) {
          return capabilityFailure(
            id,
            nodeId,
            "documentBodyImport",
            `${node.format}:${node.units.mode}`,
            `Kernel '${id}' does not support ${node.format} document-body import with ${node.units.mode} units`,
          );
        }
      }
    }

    let box: BodySetKernelAccess["box"];
    if (importedBodySetHasValue(requiredPrimitives, "box")) {
      const method = kernel.box;
      const afterMethod = postBoundaryFailure(
        signal,
        firstPrimitiveNodes.get("box"),
      );
      if (afterMethod !== undefined) return afterMethod;
      if (typeof method !== "function") {
        const nodeId = firstPrimitiveNodes.get("box")!;
        return capabilityFailure(
          id,
          nodeId,
          "primitive",
          "box",
          `Kernel '${id}' advertises primitive 'box' without implementing it`,
        );
      }
      box = method;
    }
    let cylinder: BodySetKernelAccess["cylinder"];
    if (importedBodySetHasValue(requiredPrimitives, "cylinder")) {
      const method = kernel.cylinder;
      const afterMethod = postBoundaryFailure(
        signal,
        firstPrimitiveNodes.get("cylinder"),
      );
      if (afterMethod !== undefined) return afterMethod;
      if (typeof method !== "function") {
        const nodeId = firstPrimitiveNodes.get("cylinder")!;
        return capabilityFailure(
          id,
          nodeId,
          "primitive",
          "cylinder",
          `Kernel '${id}' advertises primitive 'cylinder' without implementing it`,
        );
      }
      cylinder = method;
    }
    let sphere: BodySetKernelAccess["sphere"];
    if (importedBodySetHasValue(requiredPrimitives, "sphere")) {
      const method = kernel.sphere;
      const afterMethod = postBoundaryFailure(
        signal,
        firstPrimitiveNodes.get("sphere"),
      );
      if (afterMethod !== undefined) return afterMethod;
      if (typeof method !== "function") {
        const nodeId = firstPrimitiveNodes.get("sphere")!;
        return capabilityFailure(
          id,
          nodeId,
          "primitive",
          "sphere",
          `Kernel '${id}' advertises primitive 'sphere' without implementing it`,
        );
      }
      sphere = method;
    }
    let importDocumentBody: BodySetKernelAccess["importDocumentBody"];
    if (importedNodes.length > 0) {
      const method = kernel.importDocumentBody;
      const afterMethod = postBoundaryFailure(
        signal,
        importedNodes[0]![0],
      );
      if (afterMethod !== undefined) return afterMethod;
      if (typeof method !== "function") {
        const nodeId = importedNodes[0]![0];
        return kernelFailure(
          id,
          `Kernel '${id}' advertises document-body import without implementing it`,
          {
            node: nodeId,
            path: `/nodes/${nodeId}`,
            details: {
              protocolViolation: true,
              kind: "documentBodyImport",
            },
          },
        );
      }
      importDocumentBody = method;
    }
    let boolean: BodySetKernelAccess["boolean"];
    if (firstBooleanNode !== undefined) {
      const method = kernel.boolean;
      const afterMethod = postBoundaryFailure(
        signal,
        firstBooleanNode,
      );
      if (afterMethod !== undefined) return afterMethod;
      if (typeof method !== "function") {
        return kernelFailure(
          id,
          `Kernel '${id}' advertises feature 'boolean' without implementing it`,
          {
            node: firstBooleanNode,
            path: `/nodes/${firstBooleanNode}`,
            details: {
              protocolViolation: true,
              kind: "feature",
              capability: "boolean",
            },
          },
        );
      }
      boolean = method;
    }
    let transform: BodySetKernelAccess["transform"];
    if (firstTransformNode !== undefined) {
      const method = kernel.transform;
      const afterMethod = postBoundaryFailure(
        signal,
        firstTransformNode,
      );
      if (afterMethod !== undefined) return afterMethod;
      if (typeof method !== "function") {
        return kernelFailure(
          id,
          `Kernel '${id}' advertises feature 'transform' without implementing it`,
          {
            node: firstTransformNode,
            path: `/nodes/${firstTransformNode}`,
            details: {
              protocolViolation: true,
              kind: "feature",
              capability: "transform",
            },
          },
        );
      }
      transform = method;
    }
    const status = kernel.status;
    const afterStatus = postBoundaryFailure(signal);
    if (afterStatus !== undefined) return afterStatus;
    const measure = kernel.measure;
    const afterMeasure = postBoundaryFailure(signal);
    if (afterMeasure !== undefined) return afterMeasure;
    const mesh = kernel.mesh;
    const afterMesh = postBoundaryFailure(signal);
    if (afterMesh !== undefined) return afterMesh;
    let topology: BodySetKernelAccess["topology"];
    if (topologyAdvertised) {
      const method = kernel.topology;
      const afterTopologyMethod = postBoundaryFailure(signal);
      if (afterTopologyMethod !== undefined) return afterTopologyMethod;
      if (typeof method === "function") topology = method;
    }
    let exportShape: BodySetKernelAccess["exportShape"];
    if (nativeExports.length > 0) {
      const method = kernel.exportShape;
      const afterExportMethod = postBoundaryFailure(signal);
      if (afterExportMethod !== undefined) return afterExportMethod;
      if (typeof method === "function") exportShape = method;
    }
    const disposeShape = kernel.disposeShape;
    const afterDispose = postBoundaryFailure(signal);
    if (afterDispose !== undefined) return afterDispose;
    if (
      typeof status !== "function" ||
      typeof measure !== "function" ||
      typeof mesh !== "function" ||
      typeof disposeShape !== "function"
    ) {
      return kernelFailure(
        id,
        `Kernel '${id}' does not implement the required owned-shape contract`,
        { details: { protocolViolation: true } },
      );
    }
    return success(
      importedBodyApply<BodySetKernelAccess>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            id,
            representation,
            exact,
            ...(box === undefined ? {} : { box }),
            ...(cylinder === undefined ? {} : { cylinder }),
            ...(sphere === undefined ? {} : { sphere }),
            ...(importDocumentBody === undefined
              ? {}
              : { importDocumentBody }),
            ...(boolean === undefined ? {} : { boolean }),
            ...(transform === undefined ? {} : { transform }),
            status,
            measure,
            mesh,
            nativeExports,
            stepExport,
            ...(topology === undefined ? {} : { topology }),
            ...(exportShape === undefined ? {} : { exportShape }),
            disposeShape,
          },
        ],
      ),
    );
  } catch {
    const afterFailure = postBoundaryFailure(signal);
    if (afterFailure !== undefined) return afterFailure;
    return kernelFailure(
      id,
      `Kernel '${id}' ${diagnostics.capabilityScope} capabilities could not be inspected safely`,
      { details: { protocolViolation: true } },
    );
  }
}

function validateStagedSolidGraphShape(
  kernel: GeometryKernel,
  access: BodySetKernelAccess,
  shape: KernelShape,
  nodeId: NodeId,
  node: StagedSolidGraphNodeV7,
  signal: AbortSignal | undefined,
  diagnostics: StagedV7SolidDiagnosticContext = BODY_SET_SOLID_DIAGNOSTICS,
): CadResult<undefined> {
  const { postBoundaryFailure, kernelFailure } = diagnostics;
  const nodeKind = node.kind;
  try {
    const rawStatus = importedBodyApply<unknown>(
      access.status,
      kernel,
      [shape],
    );
    const afterStatus = postBoundaryFailure(signal, nodeId);
    if (afterStatus !== undefined) return afterStatus;
    const statusOk = importedBodyOwnDataValue(rawStatus, "ok");
    const afterStatusOk = postBoundaryFailure(signal, nodeId);
    if (afterStatusOk !== undefined) return afterStatusOk;
    const statusCode = importedBodyOwnDataValue(rawStatus, "code");
    const afterStatusCode = postBoundaryFailure(signal, nodeId);
    if (afterStatusCode !== undefined) return afterStatusCode;
    if (
      statusOk.kind !== "data" ||
      typeof statusOk.value !== "boolean" ||
      statusCode.kind !== "data" ||
      typeof statusCode.value !== "string"
    ) {
      return kernelFailure(
        access.id,
        `Kernel '${access.id}' returned malformed status for ${diagnostics.solidLabel} '${nodeId}'`,
        {
          node: nodeId,
          path: `/nodes/${nodeId}`,
          details: { protocolViolation: true, nodeKind },
        },
      );
    }
    if (!statusOk.value) {
      if (
        node.kind === "boolean" &&
        node.operation !== "union" &&
        statusCode.value === "NULL_SHAPE"
      ) {
        return failure(
          diagnostic(
            "EMPTY_RESULT",
            `Boolean feature '${nodeId}' produced no solid`,
            {
              severity: "error",
              node: nodeId,
              path: `/nodes/${nodeId}`,
              details: {
                phase: diagnostics.phase,
                kernel: access.id,
                status: statusCode.value,
              },
            },
          ),
        );
      }
      return kernelFailure(
        access.id,
        `Kernel '${access.id}' returned an invalid ${diagnostics.solidLabel} '${nodeId}'`,
        {
          node: nodeId,
          path: `/nodes/${nodeId}`,
          details: {
            protocolViolation: true,
            nodeKind,
            status: statusCode.value,
          },
        },
      );
    }

    const rawMeasurements = importedBodyApply<unknown>(
      access.measure,
      kernel,
      [shape],
    );
    const afterMeasure = postBoundaryFailure(signal, nodeId);
    if (afterMeasure !== undefined) return afterMeasure;
    const volume = importedBodyOwnDataValue(rawMeasurements, "volume");
    const afterMeasurementCapture = postBoundaryFailure(signal, nodeId);
    if (afterMeasurementCapture !== undefined) {
      return afterMeasurementCapture;
    }
    const capturedVolume =
      volume.kind === "data" && typeof volume.value === "number"
        ? volume.value
        : undefined;
    const finiteVolume =
      capturedVolume !== undefined &&
      importedBodyApply<boolean>(
        importedBodyNumberIsFinite,
        Number,
        [capturedVolume],
      );
    if (
      node.kind === "boolean" &&
      node.operation !== "union" &&
      capturedVolume !== undefined &&
      finiteVolume &&
      capturedVolume === 0
    ) {
      return failure(
        diagnostic(
          "EMPTY_RESULT",
          `Boolean feature '${nodeId}' produced no positive-volume solid`,
          {
            severity: "error",
            node: nodeId,
            path: `/nodes/${nodeId}`,
            details: {
              phase: diagnostics.phase,
              kernel: access.id,
              volume: capturedVolume,
            },
          },
        ),
      );
    }
    if (
      capturedVolume === undefined ||
      !finiteVolume ||
      !(capturedVolume > 0)
    ) {
      return kernelFailure(
        access.id,
        `Kernel '${access.id}' returned a non-positive ${diagnostics.solidLabel} '${nodeId}'`,
        {
          node: nodeId,
          path: `/nodes/${nodeId}`,
          details: {
            protocolViolation: true,
            nodeKind,
            volume:
              volume.kind === "data" &&
              (typeof volume.value === "number" ||
                typeof volume.value === "string" ||
                typeof volume.value === "boolean" ||
                volume.value === null)
                ? volume.value
                : volume.kind,
          },
        },
      );
    }
    return success(undefined);
  } catch (error) {
    const afterFailure = postBoundaryFailure(signal, nodeId);
    if (afterFailure !== undefined) return afterFailure;
    return kernelFailure(
      access.id,
      `Kernel '${access.id}' could not validate ${diagnostics.solidLabel} '${nodeId}'`,
      {
        node: nodeId,
        path: `/nodes/${nodeId}`,
        details: {
          protocolViolation: true,
          nodeKind,
          cause: bodySetThrownCause(
            error,
            `${diagnostics.solidFailureLabel} validation failed with an opaque value`,
          ),
        },
      },
    );
  }
}

interface EvaluatedStagedSolidGraphV7 {
  readonly access: BodySetKernelAccess;
  readonly createdShapes: Set<KernelShape>;
  readonly createdShapeList: Readonly<Record<number, KernelShape>>;
  readonly createdShapeCount: number;
  readonly shapesByNode: ReadonlyMap<NodeId, KernelShape>;
  readonly dispose: () => void;
}

interface PreparedStagedSolidGraphV7 {
  readonly plan: StagedSolidGraphPlanV7;
  readonly resolvedPrimitives: Map<
    NodeId,
    ResolvedBodySetPrimitiveV7
  >;
  readonly resolvedTransforms: Map<
    NodeId,
    readonly ResolvedTransformOperation[]
  >;
  readonly resourceIds: readonly ResourceId[];
}

interface EvaluateStagedSolidGraphV7Options {
  readonly kernel: GeometryKernel;
  readonly document: DesignDocumentV7;
  readonly plan: StagedSolidGraphPlanV7;
  readonly expression: (value: ExpressionIR) => number;
  readonly resolver?: ResourceResolverV7;
  readonly resourceLimits: ResourceResolutionLimitsV7;
  readonly signal?: AbortSignal;
  readonly diagnostics: StagedV7SolidDiagnosticContext;
  /**
   * Internal retained pipeline inputs. When supplied together, this evaluator
   * performs no expression work, capability observation, or resource I/O.
   */
  readonly prepared?: PreparedStagedSolidGraphV7;
  readonly access?: BodySetKernelAccess;
  readonly resolvedResources?: ResolvedResourcesV7;
  readonly resourcesArePreResolved?: boolean;
  /**
   * Shapes retained by earlier successful batches in one owner-checked
   * prepared-part transaction.
   */
  readonly previouslyOwnedShapes?: ReadonlySet<KernelShape>;
}

function resolvedTransformOperationV7(
  nodeId: NodeId,
  operation: TransformOperationIR,
  operationIndex: number,
  expression: (value: ExpressionIR) => number,
  diagnostics: StagedV7SolidDiagnosticContext,
): CadResult<ResolvedTransformOperation> {
  const field = operation.kind === "mirror" ? "normal" : "value";
  const source =
    operation.kind === "mirror" ? operation.normal : operation.value;
  const values = new Array<number>(3);
  try {
    for (let axis = 0; axis < 3; axis += 1) {
      values[axis] = expression(source[axis]!);
    }
  } catch (error) {
    return failure(
      diagnostic(
        "EXPRESSION_INVALID",
        bodySetThrownCause(
          error,
          `Transform '${nodeId}' operation ${operationIndex} could not be evaluated`,
        ),
        {
          severity: "error",
          node: nodeId,
          path: `/nodes/${nodeId}/operations/${operationIndex}/${field}`,
          details: { phase: diagnostics.phase },
        },
      ),
    );
  }
  for (let axis = 0; axis < values.length; axis += 1) {
    if (
      !importedBodyApply<boolean>(
        importedBodyNumberIsFinite,
        Number,
        [values[axis]],
      )
    ) {
      return failure(
        diagnostic(
          "FEATURE_INVALID",
          `Transform '${nodeId}' operation ${operationIndex} ${field}/${axis} must be finite`,
          {
            severity: "error",
            node: nodeId,
            path:
              `/nodes/${nodeId}/operations/${operationIndex}/` +
              `${field}/${axis}`,
            details: {
              phase: diagnostics.phase,
              value: values[axis],
            },
          },
        ),
      );
    }
  }
  const vector = importedBodyApply<Vec3>(
    importedBodyObjectFreeze,
    Object,
    [values],
  );
  if (operation.kind === "scale") {
    for (let axis = 0; axis < vector.length; axis += 1) {
      if (vector[axis] === 0) {
        return failure(
          diagnostic(
            "FEATURE_INVALID",
            `Transform '${nodeId}' operation ${operationIndex} scale/${axis} must be non-zero`,
            {
              severity: "error",
              node: nodeId,
              path:
                `/nodes/${nodeId}/operations/${operationIndex}/value/` +
                `${axis}`,
              details: {
                phase: diagnostics.phase,
                value: vector[axis],
              },
            },
          ),
        );
      }
    }
  }
  if (operation.kind === "mirror") {
    const squaredNorm =
      vector[0] * vector[0] +
      vector[1] * vector[1] +
      vector[2] * vector[2];
    if (
      !importedBodyApply<boolean>(
        importedBodyNumberIsFinite,
        Number,
        [squaredNorm],
      ) ||
      !(squaredNorm > 0)
    ) {
      return failure(
        diagnostic(
          "FEATURE_INVALID",
          `Transform '${nodeId}' operation ${operationIndex} mirror normal must be finite and non-zero`,
          {
            severity: "error",
            node: nodeId,
            path: `/nodes/${nodeId}/operations/${operationIndex}/normal`,
            details: {
              phase: diagnostics.phase,
              squaredNorm,
            },
          },
        ),
      );
    }
    return success(
      importedBodyApply<ResolvedTransformOperation>(
        importedBodyObjectFreeze,
        Object,
        [{ kind: "mirror", normal: vector }],
      ),
    );
  }
  return success(
    importedBodyApply<ResolvedTransformOperation>(
      importedBodyObjectFreeze,
      Object,
      [{ kind: operation.kind, value: vector }],
    ),
  );
}

function prepareStagedSolidGraphV7(
  plan: StagedSolidGraphPlanV7,
  expression: (value: ExpressionIR) => number,
  signal: AbortSignal | undefined,
  diagnostics: StagedV7SolidDiagnosticContext,
): CadResult<PreparedStagedSolidGraphV7> {
  const { postBoundaryFailure } = diagnostics;
  const resolvedPrimitives =
    new ImportedBodyMap<NodeId, ResolvedBodySetPrimitiveV7>();
  const resolvedTransforms =
    new ImportedBodyMap<NodeId, readonly ResolvedTransformOperation[]>();
  for (let index = 0; index < plan.orderedNodes.length; index += 1) {
    const [nodeId, node] = plan.orderedNodes[index]!;
    const boundary = postBoundaryFailure(signal, nodeId);
    if (boundary !== undefined) return boundary;
    if (node.kind === "importedBody" || node.kind === "boolean") continue;
    if (node.kind === "transform") {
      const operations = new Array<ResolvedTransformOperation>(
        node.operations.length,
      );
      for (
        let operationIndex = 0;
        operationIndex < node.operations.length;
        operationIndex += 1
      ) {
        const resolved = resolvedTransformOperationV7(
          nodeId,
          node.operations[operationIndex]!,
          operationIndex,
          expression,
          diagnostics,
        );
        if (!resolved.ok) return resolved;
        operations[operationIndex] = resolved.value;
      }
      importedBodyApply<void>(importedBodyObjectFreeze, Object, [
        operations,
      ]);
      importedBodyMapSetValue(resolvedTransforms, nodeId, operations);
      continue;
    }
    try {
      if (node.kind === "box") {
        const size = new Array<number>(3);
        for (let axis = 0; axis < 3; axis += 1) {
          size[axis] = expression(node.size[axis]!);
          if (
            !importedBodyApply<boolean>(
              importedBodyNumberIsFinite,
              Number,
              [size[axis]],
            ) ||
            !(size[axis]! > 0)
          ) {
            return failure(
              diagnostic(
                "FEATURE_INVALID",
                `size/${axis} must be finite and positive`,
                {
                  severity: "error",
                  node: nodeId,
                  path: `/nodes/${nodeId}/size/${axis}`,
                  details: {
                    phase: diagnostics.phase,
                    value: size[axis],
                  },
                },
              ),
            );
          }
        }
        importedBodyMapSetValue(resolvedPrimitives, nodeId, {
          kind: "box",
          size: size as unknown as Vec3,
          center: node.center,
        });
      } else if (node.kind === "cylinder") {
        const height = expression(node.height);
        const radiusBottom = expression(node.radiusBottom);
        const radiusTop = expression(node.radiusTop);
        for (const [field, value, allowZero] of [
          ["height", height, false],
          ["radiusBottom", radiusBottom, false],
          ["radiusTop", radiusTop, true],
        ] as const) {
          if (
            !importedBodyApply<boolean>(
              importedBodyNumberIsFinite,
              Number,
              [value],
            ) ||
            (allowZero ? value < 0 : !(value > 0))
          ) {
            return failure(
              diagnostic(
                "FEATURE_INVALID",
                `${field} must be finite and ${allowZero ? "non-negative" : "positive"}`,
                {
                  severity: "error",
                  node: nodeId,
                  path: `/nodes/${nodeId}/${field}`,
                  details: {
                    phase: diagnostics.phase,
                    value,
                  },
                },
              ),
            );
          }
        }
        importedBodyMapSetValue(resolvedPrimitives, nodeId, {
          kind: "cylinder",
          height,
          radiusBottom,
          radiusTop,
          center: node.center,
          ...(node.segments === undefined
            ? {}
            : { segments: node.segments }),
        });
      } else if (node.kind === "sphere") {
        const radius = expression(node.radius);
        if (
          !importedBodyApply<boolean>(
            importedBodyNumberIsFinite,
            Number,
            [radius],
          ) ||
          !(radius > 0)
        ) {
          return failure(
            diagnostic(
              "FEATURE_INVALID",
              "radius must be finite and positive",
              {
                severity: "error",
                node: nodeId,
                path: `/nodes/${nodeId}/radius`,
                details: {
                  phase: diagnostics.phase,
                  value: radius,
                },
              },
            ),
          );
        }
        importedBodyMapSetValue(resolvedPrimitives, nodeId, {
          kind: "sphere",
          radius,
          ...(node.segments === undefined
            ? {}
            : { segments: node.segments }),
        });
      }
    } catch (error) {
      const afterExpression = postBoundaryFailure(signal, nodeId);
      if (afterExpression !== undefined) return afterExpression;
      return failure(
        diagnostic(
          "EXPRESSION_INVALID",
          bodySetThrownCause(
            error,
            `Primitive leaf '${nodeId}' expressions could not be evaluated`,
          ),
          {
            severity: "error",
            node: nodeId,
            path: `/nodes/${nodeId}`,
            details: { phase: diagnostics.phase },
          },
        ),
      );
    }
  }

  const resourceIds: ResourceId[] = [];
  const seenResourceIds = new ImportedBodySet<ResourceId>();
  for (let index = 0; index < plan.leafNodes.length; index += 1) {
    const node = plan.leafNodes[index]![1];
    if (
      !stagedSolidNodeIsImportedBodyV7(node) ||
      importedBodySetHasValue(seenResourceIds, node.resource)
    ) {
      continue;
    }
    importedBodySetAddValue(seenResourceIds, node.resource);
    importedBodyArrayAppend(resourceIds, node.resource);
  }
  importedBodyArraySortLexically(resourceIds);
  importedBodyApply<void>(importedBodyObjectFreeze, Object, [resourceIds]);
  return success({
    plan,
    resolvedPrimitives,
    resolvedTransforms,
    resourceIds,
  });
}

async function evaluateStagedSolidGraphV7(
  options: EvaluateStagedSolidGraphV7Options,
): Promise<CadResult<EvaluatedStagedSolidGraphV7>> {
  const {
    kernel,
    document,
    plan,
    expression,
    signal,
    diagnostics,
  } = options;
  const {
    postBoundaryFailure,
    kernelFailure,
  } = diagnostics;

  const preparedResult =
    options.prepared === undefined
      ? prepareStagedSolidGraphV7(
          plan,
          expression,
          signal,
          diagnostics,
        )
      : success(options.prepared);
  if (!preparedResult.ok) return preparedResult;
  const prepared = preparedResult.value;
  const resolvedPrimitives = prepared.resolvedPrimitives;
  const resolvedTransforms = prepared.resolvedTransforms;

  const kernelAccess =
    options.access === undefined
      ? captureBodySetKernelAccess(kernel, plan, signal, diagnostics)
      : success(options.access);
  const afterKernelCapture = postBoundaryFailure(signal);
  if (afterKernelCapture !== undefined) return afterKernelCapture;
  if (!kernelAccess.ok) return kernelAccess;

  let resolvedResources = options.resolvedResources;
  if (
    prepared.resourceIds.length > 0 &&
    options.resourcesArePreResolved !== true
  ) {
    const resolved = await resolveResourcesV7(
      document.resources ?? {},
      prepared.resourceIds,
      {
        ...(options.resolver === undefined
          ? {}
          : { resolver: options.resolver }),
        limits: options.resourceLimits,
        ...(signal === undefined ? {} : { signal }),
      },
    );
    const afterResources = postBoundaryFailure(signal);
    if (afterResources !== undefined) return afterResources;
    if (!resolved.ok) return resolved;
    resolvedResources = resolved.value;
  }

  const createdShapes = new ImportedBodySet<KernelShape>();
  const createdShapeList = importedBodyApply<Record<number, KernelShape>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  let createdShapeCount = 0;
  const shapesByNode = new ImportedBodyMap<NodeId, KernelShape>();
  const failAfterCleanup = (
    result: CadResult<never>,
  ): CadResult<EvaluatedStagedSolidGraphV7> => {
    disposeImportedBodyShapes(
      kernel,
      kernelAccess.value.disposeShape,
      createdShapeList,
      createdShapeCount,
    );
    const afterCleanup = postBoundaryFailure(signal);
    if (afterCleanup !== undefined) return afterCleanup;
    return result;
  };

  for (let index = 0; index < plan.orderedNodes.length; index += 1) {
    const [nodeId, node] = plan.orderedNodes[index]!;
    const beforeNode = postBoundaryFailure(signal, nodeId);
    if (beforeNode !== undefined) return failAfterCleanup(beforeNode);
    let shape: KernelShape;
    try {
      const context = importedBodyApply<KernelFeatureContext>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            feature: nodeId,
            ...(signal === undefined ? {} : { signal }),
          },
        ],
      );
      if (node.kind === "importedBody") {
        const bytes = resolvedResources?.read(node.resource);
        const afterRead = postBoundaryFailure(signal, nodeId);
        if (afterRead !== undefined) return failAfterCleanup(afterRead);
        if (bytes === undefined) {
          return failAfterCleanup(
            kernelFailure(
              kernelAccess.value.id,
              `Verified resource '${node.resource}' is unavailable for ${diagnostics.solidLabel} '${nodeId}'`,
              {
                node: nodeId,
                path: `/nodes/${nodeId}/resource`,
                details: {
                  protocolViolation: true,
                  resourceId: node.resource,
                  format: node.format,
                },
              },
            ),
          );
        }
        shape = importedBodyApply<KernelShape>(
          kernelAccess.value.importDocumentBody!,
          kernel,
          [bytes, importedBodyImportOptions(node), context],
        );
      } else if (node.kind === "boolean") {
        const targetShape = importedBodyMapGetValue(
          shapesByNode,
          node.target.node,
        );
        if (targetShape === undefined) {
          return failAfterCleanup(
            kernelFailure(
              kernelAccess.value.id,
              `Solid graph Boolean '${nodeId}' has no evaluated target`,
              {
                node: nodeId,
                path: `/nodes/${nodeId}/target`,
                details: {
                  protocolViolation: true,
                  referencedNode: node.target.node,
                },
              },
            ),
          );
        }
        const toolShapes = new Array<KernelShape>();
        for (
          let toolIndex = 0;
          toolIndex < node.tools.length;
          toolIndex += 1
        ) {
          const referencedNode = node.tools[toolIndex]!.node;
          const toolShape = importedBodyMapGetValue(
            shapesByNode,
            referencedNode,
          );
          if (toolShape === undefined) {
            return failAfterCleanup(
              kernelFailure(
                kernelAccess.value.id,
                `Solid graph Boolean '${nodeId}' has no evaluated tool at index ${toolIndex}`,
                {
                  node: nodeId,
                  path: `/nodes/${nodeId}/tools/${toolIndex}`,
                  details: {
                    protocolViolation: true,
                    referencedNode,
                  },
                },
              ),
            );
          }
          importedBodyArrayAppend(toolShapes, toolShape);
        }
        importedBodyApply<void>(importedBodyObjectFreeze, Object, [
          toolShapes,
        ]);
        shape = importedBodyApply<KernelShape>(
          kernelAccess.value.boolean!,
          kernel,
          [
            node.operation,
            targetShape,
            toolShapes,
            context,
          ],
        );
      } else if (node.kind === "transform") {
        const inputShape = importedBodyMapGetValue(
          shapesByNode,
          node.input.node,
        );
        if (inputShape === undefined) {
          return failAfterCleanup(
            kernelFailure(
              kernelAccess.value.id,
              `Solid graph transform '${nodeId}' has no evaluated input`,
              {
                node: nodeId,
                path: `/nodes/${nodeId}/input`,
                details: {
                  protocolViolation: true,
                  referencedNode: node.input.node,
                },
              },
            ),
          );
        }
        shape = importedBodyApply<KernelShape>(
          kernelAccess.value.transform!,
          kernel,
          [
            inputShape,
            importedBodyMapGetValue(resolvedTransforms, nodeId)!,
            context,
          ],
        );
      } else {
        const resolved = importedBodyMapGetValue(
          resolvedPrimitives,
          nodeId,
        )!;
        if (resolved.kind === "box") {
          shape = importedBodyApply<KernelShape>(
            kernelAccess.value.box!,
            kernel,
            [resolved.size, resolved.center, context],
          );
        } else if (resolved.kind === "cylinder") {
          shape = importedBodyApply<KernelShape>(
            kernelAccess.value.cylinder!,
            kernel,
            [
              resolved.height,
              resolved.radiusBottom,
              resolved.radiusTop,
              resolved.center,
              resolved.segments,
              context,
            ],
          );
        } else {
          shape = importedBodyApply<KernelShape>(
            kernelAccess.value.sphere!,
            kernel,
            [resolved.radius, resolved.segments, context],
          );
        }
      }
    } catch (error) {
      const afterFailure = postBoundaryFailure(signal, nodeId);
      if (afterFailure !== undefined) {
        return failAfterCleanup(afterFailure);
      }
      return failAfterCleanup(
        kernelFailure(
          kernelAccess.value.id,
          `Kernel '${kernelAccess.value.id}' failed to construct solid graph node '${nodeId}'`,
          {
            node: nodeId,
            path: `/nodes/${nodeId}`,
            details: {
              nodeKind: node.kind,
              ...(node.kind === "importedBody"
                ? {
                    resourceId: node.resource,
                    format: node.format,
                    unitMode: node.units.mode,
                  }
                : {}),
              cause: bodySetThrownCause(
                error,
                "Solid graph construction failed with an opaque value",
              ),
            },
          },
        ),
      );
    }

    if (
      options.previouslyOwnedShapes !== undefined &&
      importedBodySetHasValue(options.previouslyOwnedShapes, shape)
    ) {
      return failAfterCleanup(
        kernelFailure(
          kernelAccess.value.id,
          `Kernel '${kernelAccess.value.id}' returned a shape already owned by an earlier prepared part batch for solid graph node '${nodeId}'`,
          {
            node: nodeId,
            path: `/nodes/${nodeId}`,
            details: {
              protocolViolation: true,
              crossBatchShapeOwnership: true,
              nodeKind: node.kind,
            },
          },
        ),
      );
    }
    if (importedBodySetHasValue(createdShapes, shape)) {
      return failAfterCleanup(
        kernelFailure(
          kernelAccess.value.id,
          `Kernel '${kernelAccess.value.id}' reused an owned shape for solid graph node '${nodeId}'`,
          {
            node: nodeId,
            path: `/nodes/${nodeId}`,
            details: {
              protocolViolation: true,
              nodeKind: node.kind,
            },
          },
        ),
      );
    }
    importedBodySetAddValue(createdShapes, shape);
    importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
      createdShapeList,
      createdShapeCount,
      {
        configurable: true,
        enumerable: true,
        writable: true,
        value: shape,
      },
    ]);
    createdShapeCount += 1;
    const afterAcquisition = postBoundaryFailure(signal, nodeId);
    if (afterAcquisition !== undefined) {
      return failAfterCleanup(afterAcquisition);
    }
    const validated = validateStagedSolidGraphShape(
      kernel,
      kernelAccess.value,
      shape,
      nodeId,
      node,
      signal,
      diagnostics,
    );
    if (!validated.ok) return failAfterCleanup(validated);
    importedBodyMapSetValue(shapesByNode, nodeId, shape);
  }

  const beforeSuccess = postBoundaryFailure(signal);
  if (beforeSuccess !== undefined) {
    return failAfterCleanup(beforeSuccess);
  }
  return success({
    access: kernelAccess.value,
    createdShapes,
    createdShapeList,
    createdShapeCount,
    shapesByNode,
    dispose: () =>
      disposeImportedBodyShapes(
        kernel,
        kernelAccess.value.disposeShape,
        createdShapeList,
        createdShapeCount,
      ),
  });
}

/**
 * Evaluates direct document-v7 `bodySet` outputs whose authored members
 * reference bounded graphs of box, cylinder, sphere, importedBody, transform,
 * and Boolean nodes.
 *
 * This source export deliberately remains absent from `src/index.ts`. The
 * supplied kernel is borrowed. Every failure disposes each distinct acquired
 * shape exactly once; a successful result owns those shapes until `dispose()`.
 *
 * @internal
 */
export async function evaluateBodySetOutputsV7(
  kernel: GeometryKernel,
  inputDocument: DesignDocumentV7,
  inputOptions: EvaluateBodySetOutputsV7Options = {},
): Promise<CadResult<EvaluatedBodySetDesignV7>> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return bodySetRuntimeIntegrityFailure();
  }
  const capturedOptions = captureBodySetEvaluationOptions(inputOptions);
  const afterOptions = bodySetPostBoundaryFailure(undefined);
  if (afterOptions !== undefined) return afterOptions;
  if (!capturedOptions.ok) return capturedOptions;
  const options = capturedOptions.value;
  if (bodySetEvaluationAborted(options.signal)) {
    return bodySetEvaluationAbortFailure();
  }

  const parsed = parseDocumentValueV7(
    inputDocument,
    options.documentLimits === undefined
      ? {}
      : { limits: options.documentLimits },
  );
  const afterDocument = bodySetPostBoundaryFailure(options.signal);
  if (afterDocument !== undefined) return afterDocument;
  if (!parsed.ok) return parsed;
  const document = parsed.value;

  const requested: string[] = [];
  if (options.outputs === undefined) {
    const outputNames = importedBodyObjectKeyList(document.outputs);
    if (
      outputNames.length >
      options.evaluationLimits.maxSelectedOutputs
    ) {
      return bodySetLimitFailure(
        "maxSelectedOutputs",
        options.evaluationLimits.maxSelectedOutputs,
        outputNames.length,
        "/outputs",
      );
    }
    for (let index = 0; index < outputNames.length; index += 1) {
      importedBodyArrayAppend(requested, outputNames[index]!);
    }
  } else {
    for (let index = 0; index < options.outputs.length; index += 1) {
      importedBodyArrayAppend(requested, options.outputs[index]!);
    }
  }
  if (requested.length > options.evaluationLimits.maxSelectedOutputs) {
    return bodySetLimitFailure(
      "maxSelectedOutputs",
      options.evaluationLimits.maxSelectedOutputs,
      requested.length,
      "/outputs",
    );
  }
  if (requested.length === 0) {
    return failure(
      diagnostic("OUTPUT_MISSING", "The document has no selected outputs", {
        severity: "error",
        path: "/outputs",
        details: { phase: BODY_SET_EVALUATION_PHASE },
      }),
    );
  }

  const selectedOutputs: SelectedBodySetOutputV7[] = [];
  const solidRoots: StagedSolidGraphRootV7[] = [];
  let selectedMemberCount = 0;
  for (let outputIndex = 0; outputIndex < requested.length; outputIndex += 1) {
    const name = requested[outputIndex]!;
    const outputPath = `/outputs/${importedBodyJsonPointerSegment(name)}`;
    const reference = importedBodyApply<boolean>(
      importedBodyObjectHasOwn,
      Object,
      [document.outputs, name],
    )
      ? document.outputs[name]
      : undefined;
    if (reference === undefined) {
      return failure(
        diagnostic("OUTPUT_MISSING", `Unknown output '${name}'`, {
          severity: "error",
          path: outputPath,
          details: { phase: BODY_SET_EVALUATION_PHASE },
        }),
      );
    }
    const outputNode = importedBodyApply<boolean>(
      importedBodyObjectHasOwn,
      Object,
      [document.nodes, reference.node],
    )
      ? document.nodes[reference.node]
      : undefined;
    if (
      reference.kind !== "bodySet" ||
      outputNode === undefined ||
      outputNode.kind !== "bodySet"
    ) {
      return failure(
        diagnostic(
          "EVALUATION_UNSUPPORTED",
          `Staged body-set evaluation requires output '${name}' to directly reference a bodySet node`,
          {
            severity: "error",
            node: reference.node,
            path: outputPath,
            details: {
              phase: BODY_SET_EVALUATION_PHASE,
              supported: "direct-body-set-output",
              outputKind: reference.kind,
              nodeKind: outputNode?.kind,
            },
          },
        ),
      );
    }
    importedBodyArrayAppend(selectedOutputs, {
      name,
      nodeId: reference.node,
      node: outputNode,
    });
    selectedMemberCount += outputNode.bodies.length;
    if (
      selectedMemberCount >
      options.evaluationLimits.maxBodySetMembers
    ) {
      return bodySetLimitFailure(
        "maxBodySetMembers",
        options.evaluationLimits.maxBodySetMembers,
        selectedMemberCount,
        `/nodes/${reference.node}/bodies`,
      );
    }
    for (
      let bodyIndex = 0;
      bodyIndex < outputNode.bodies.length;
      bodyIndex += 1
    ) {
      const member = outputNode.bodies[bodyIndex]!;
      importedBodyArrayAppend(solidRoots, {
        node: member.solid.node,
        path: `/nodes/${reference.node}/bodies/${bodyIndex}/solid`,
      });
    }
  }
  const solidPlan = planStagedSolidGraphV7(
    document,
    solidRoots,
    options.evaluationLimits,
    BODY_SET_EVALUATION_PHASE,
  );
  const afterSolidPlan = bodySetPostBoundaryFailure(options.signal);
  if (afterSolidPlan !== undefined) return afterSolidPlan;
  if (!solidPlan.ok) return solidPlan;

  let selectedConfigurationId: ConfigurationId | null = null;
  let selectedConfiguration: DesignConfigurationIR | undefined;
  if (options.configuration !== undefined) {
    if (
      !importedBodyApply<boolean>(
        importedBodyObjectHasOwn,
        Object,
        [document.configurations ?? {}, options.configuration],
      )
    ) {
      return failure(
        diagnostic(
          "CONFIGURATION_MISSING",
          `Unknown configuration '${options.configuration}'`,
          {
            severity: "error",
            path: `/configurations/${importedBodyJsonPointerSegment(
              options.configuration,
            )}`,
            details: {
              phase: BODY_SET_EVALUATION_PHASE,
              available: importedBodyObjectKeyList(
                document.configurations ?? {},
              ).sort(lexicalCompare),
            },
          },
        ),
      );
    }
    selectedConfigurationId = options.configuration as ConfigurationId;
    selectedConfiguration =
      document.configurations![selectedConfigurationId];
  }

  let parameterResult: ReturnType<typeof resolveEvaluationParameters>;
  try {
    parameterResult = resolveEvaluationParameters(
      document,
      options.parameters,
      selectedConfigurationId,
      selectedConfiguration,
    );
  } catch (error) {
    const afterParameters = bodySetPostBoundaryFailure(options.signal);
    if (afterParameters !== undefined) return afterParameters;
    return failure(
      diagnostic(
        "EXPRESSION_INVALID",
        bodySetThrownCause(
          error,
          "Body-set parameters could not be resolved safely",
        ),
        {
          severity: "error",
          path: "/parameters",
          details: { phase: BODY_SET_EVALUATION_PHASE },
        },
      ),
    );
  }
  const afterParameters = bodySetPostBoundaryFailure(options.signal);
  if (afterParameters !== undefined) return afterParameters;
  if (!parameterResult.ok) return parameterResult;
  const parameterValues = parameterResult.value.values;
  const diagnostics: Diagnostic[] = [];
  for (let index = 0; index < parsed.diagnostics.length; index += 1) {
    importedBodyArrayAppend(diagnostics, parsed.diagnostics[index]!);
  }
  for (
    let index = 0;
    index < parameterResult.diagnostics.length;
    index += 1
  ) {
    importedBodyArrayAppend(
      diagnostics,
      parameterResult.diagnostics[index]!,
    );
  }

  const expression = (value: ExpressionIR): number =>
    evaluateExpression(value, {
      resolveParameter: (id) => {
        const resolved = parameterValues.get(id);
        if (resolved === undefined) {
          throw new Error(`Unresolved parameter '${id}'`);
        }
        return resolved;
      },
    });
  const solidGraph = await evaluateStagedSolidGraphV7({
    kernel,
    document,
    plan: solidPlan.value,
    expression,
    ...(options.resolver === undefined
      ? {}
      : { resolver: options.resolver }),
    resourceLimits: options.resourceLimits,
    ...(options.signal === undefined
      ? {}
      : { signal: options.signal }),
    diagnostics: BODY_SET_SOLID_DIAGNOSTICS,
  });
  const afterSolidGraph = bodySetPostBoundaryFailure(options.signal);
  if (afterSolidGraph !== undefined) {
    if (!solidGraph.ok) return afterSolidGraph;
    solidGraph.value.dispose();
    return (
      bodySetPostBoundaryFailure(options.signal) ??
      afterSolidGraph
    );
  }
  if (!solidGraph.ok) return solidGraph;
  const kernelAccess = { value: solidGraph.value.access };
  const createdShapes = solidGraph.value.createdShapes;
  const shapesByNode = solidGraph.value.shapesByNode;
  const failAfterCleanup = (
    result: CadResult<never>,
  ): CadResult<EvaluatedBodySetDesignV7> => {
    solidGraph.value.dispose();
    const afterCleanup = bodySetPostBoundaryFailure(options.signal);
    if (afterCleanup !== undefined) return afterCleanup;
    return result;
  };
  const beforeSuccess = bodySetPostBoundaryFailure(options.signal);
  if (beforeSuccess !== undefined) {
    return failAfterCleanup(beforeSuccess);
  }
  const owner = new EvaluationOwner(
    kernel,
    createdShapes,
    selectedConfigurationId,
  );
  captureEvaluationOwnerDocumentName(owner, document.name);
  captureEvaluationOwnerDisposer(
    owner,
    createdShapes,
    (shape) =>
      importedBodyApply<void>(
        kernelAccess.value.disposeShape,
        kernel,
        [shape],
      ),
  );
  const outputs = new Map<string, EvaluatedBodySetV7>();
  for (let outputIndex = 0; outputIndex < selectedOutputs.length; outputIndex += 1) {
    const selected = selectedOutputs[outputIndex]!;
    const bodies: EvaluatedBodyV7[] = [];
    for (
      let bodyIndex = 0;
      bodyIndex < selected.node.bodies.length;
      bodyIndex += 1
    ) {
      const member = selected.node.bodies[bodyIndex]!;
      const solid = new StagedBodySetEvaluatedSolidV7(
        member.name ?? member.id,
        owner,
        shapesByNode.get(member.solid.node)!,
        kernelAccess.value,
      );
      const descriptor = importedBodyApply<EvaluatedBodyV7>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            id: member.id,
            node: member.solid.node,
            ...(member.name === undefined ? {} : { name: member.name }),
            ...(member.metadata === undefined
              ? {}
              : { metadata: member.metadata }),
            solid,
          },
        ],
      );
      importedBodyArrayAppend(bodies, descriptor);
    }
    outputs.set(
      selected.name,
      new EvaluatedBodySetV7(
        selected.name,
        owner,
        bodies,
        kernelAccess.value.representation,
        kernelAccess.value.exact,
      ),
    );
  }
  const publicParameters = importedBodyApply<Record<string, number>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  for (const [id, value] of parameterValues) {
    importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
      publicParameters,
      id,
      {
        configurable: true,
        enumerable: true,
        writable: false,
        value,
      },
    ]);
  }
  importedBodyApply<void>(importedBodyObjectFreeze, Object, [
    publicParameters,
  ]);
  const evaluated = new EvaluatedBodySetDesignV7(
    owner,
    outputs,
    selectedConfigurationId,
    publicParameters,
    Object.freeze(diagnostics),
  );
  const finalBoundary = bodySetPostBoundaryFailure(options.signal);
  if (finalBoundary !== undefined) {
    return failAfterCleanup(finalBoundary);
  }
  return success(evaluated, diagnostics);
}

type CapturedPartOutputsV7Options =
  CapturedStagedV7EvaluationOptions<PartEvaluationLimitsV7>;

type SelectedPartGeometryNodeV7 =
  | {
      readonly kind: "solid";
      readonly nodeId: NodeId;
      readonly node: StagedSolidGraphNodeV7;
    }
  | {
      readonly kind: "bodySet";
      readonly nodeId: NodeId;
      readonly node: BodySetNodeIRV7;
    };

interface SelectedPartOutputV7 {
  readonly name: string;
  readonly nodeId: NodeId;
  readonly node: PartNodeIRV7;
  readonly geometry: SelectedPartGeometryNodeV7;
}

interface ResolvedPartDefinitionV7 {
  readonly materialId?: MaterialId;
  readonly materialDefinition?: EvaluatedMaterial;
  readonly massDensity?: number;
  readonly massDensitySource?: MassDensitySource;
}

interface PreparedPartOutputsV7State {
  readonly options: CapturedPartOutputsV7Options;
  readonly document: DesignDocumentV7;
  readonly selectedOutputs: readonly SelectedPartOutputV7[];
  readonly selectedConfigurationId: ConfigurationId | null;
  readonly publicParameters: Readonly<Record<string, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly resolvedParts: ReadonlyMap<NodeId, ResolvedPartDefinitionV7>;
  readonly expression: (value: ExpressionIR) => number;
  readonly solidGraph: PreparedStagedSolidGraphV7;
}

interface PreparedPartKernelAccessV7State {
  readonly prepared: PreparedPartOutputsV7;
  readonly kernel: GeometryKernel;
  readonly access: BodySetKernelAccess;
}

interface PreparedPartShapeOwnershipTransactionV7State {
  readonly kernel: GeometryKernel;
  readonly ownedShapes: Set<KernelShape>;
  active: boolean;
}

type SelectedProductGeometryOutputV7 =
  | {
      readonly name: string;
      readonly nodeId: NodeId;
      readonly kind: "solid";
      readonly node: StagedSolidGraphNodeV7;
    }
  | {
      readonly name: string;
      readonly nodeId: NodeId;
      readonly kind: "bodySet";
      readonly node: BodySetNodeIRV7;
    }
  | (SelectedPartOutputV7 & { readonly kind: "part" });

interface PreparedProductGeometryOutputsV7State {
  readonly options: PrepareProductGeometryOutputsV7Options;
  readonly document: DesignDocumentV7;
  readonly selectedOutputs: readonly SelectedProductGeometryOutputV7[];
  readonly selectedConfigurationId: ConfigurationId | null;
  readonly publicParameters: Readonly<Record<string, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly resolvedParts: ReadonlyMap<NodeId, ResolvedPartDefinitionV7>;
  readonly expression: (value: ExpressionIR) => number;
  readonly solidGraph: PreparedStagedSolidGraphV7;
}

interface PreparedProductGeometryKernelAccessV7State {
  readonly prepared: PreparedProductGeometryOutputsV7;
  readonly kernel: GeometryKernel;
  readonly access: BodySetKernelAccess;
}

const preparedPartOutputsV7States =
  new WeakMap<object, PreparedPartOutputsV7State>();
const preparedPartKernelAccessV7States =
  new WeakMap<object, PreparedPartKernelAccessV7State>();
const preparedPartShapeOwnershipTransactionV7States =
  new WeakMap<
    object,
    PreparedPartShapeOwnershipTransactionV7State
  >();
const preparedProductGeometryOutputsV7States =
  new WeakMap<object, PreparedProductGeometryOutputsV7State>();
const preparedProductGeometryKernelAccessV7States =
  new WeakMap<object, PreparedProductGeometryKernelAccessV7State>();
const capturedProductDocumentV7States =
  new WeakMap<object, CapturedProductDocumentV7>();
const preparedPartWeakMapGet = WeakMap.prototype.get;
const preparedPartWeakMapSet = WeakMap.prototype.set;

function preparedPartState(
  prepared: PreparedPartOutputsV7,
): PreparedPartOutputsV7State | undefined {
  return importedBodyApply<PreparedPartOutputsV7State | undefined>(
    preparedPartWeakMapGet,
    preparedPartOutputsV7States,
    [prepared],
  );
}

function preparedPartKernelState(
  access: PreparedPartKernelAccessV7,
): PreparedPartKernelAccessV7State | undefined {
  return importedBodyApply<PreparedPartKernelAccessV7State | undefined>(
    preparedPartWeakMapGet,
    preparedPartKernelAccessV7States,
    [access],
  );
}

function preparedPartShapeOwnershipTransactionState(
  transaction: PreparedPartShapeOwnershipTransactionV7,
): PreparedPartShapeOwnershipTransactionV7State | undefined {
  return importedBodyApply<
    PreparedPartShapeOwnershipTransactionV7State | undefined
  >(
    preparedPartWeakMapGet,
    preparedPartShapeOwnershipTransactionV7States,
    [transaction],
  );
}

function preparedProductGeometryState(
  prepared: PreparedProductGeometryOutputsV7,
): PreparedProductGeometryOutputsV7State | undefined {
  return importedBodyApply<
    PreparedProductGeometryOutputsV7State | undefined
  >(
    preparedPartWeakMapGet,
    preparedProductGeometryOutputsV7States,
    [prepared],
  );
}

function preparedProductGeometryKernelState(
  access: PreparedProductGeometryKernelAccessV7,
): PreparedProductGeometryKernelAccessV7State | undefined {
  return importedBodyApply<
    PreparedProductGeometryKernelAccessV7State | undefined
  >(
    preparedPartWeakMapGet,
    preparedProductGeometryKernelAccessV7States,
    [access],
  );
}

function capturedProductDocumentState(
  captured: CapturedProductDocumentV7,
): CapturedProductDocumentV7 | undefined {
  return importedBodyApply<CapturedProductDocumentV7 | undefined>(
    preparedPartWeakMapGet,
    capturedProductDocumentV7States,
    [captured],
  );
}

/**
 * Creates one opaque, kernel-bound transaction for a sequential collection of
 * prepared part batches.
 *
 * @internal
 */
export function createPreparedPartShapeOwnershipTransactionV7(
  kernel: GeometryKernel,
): CadResult<PreparedPartShapeOwnershipTransactionV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const transaction = importedBodyApply<Record<string, never>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [transaction],
  );
  const result =
    transaction as unknown as PreparedPartShapeOwnershipTransactionV7;
  importedBodyApply<void>(
    preparedPartWeakMapSet,
    preparedPartShapeOwnershipTransactionV7States,
    [
      result,
      {
        kernel,
        ownedShapes: new ImportedBodySet<KernelShape>(),
        active: false,
      },
    ],
  );
  const boundary = partPostBoundaryFailure(undefined);
  return boundary ?? success(result);
}

function createPreparedPartOutputsV7(
  resourceIds: readonly ResourceId[],
  metrics: PreparedPartEvaluationMetricsV7,
  state: PreparedPartOutputsV7State,
): PreparedPartOutputsV7 {
  const prepared = importedBodyApply<Record<string, unknown>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
    prepared,
    "resourceIds",
    {
      configurable: false,
      enumerable: true,
      writable: false,
      value: resourceIds,
    },
  ]);
  importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
    prepared,
    "metrics",
    {
      configurable: false,
      enumerable: true,
      writable: false,
      value: metrics,
    },
  ]);
  importedBodyApply<void>(importedBodyObjectFreeze, Object, [prepared]);
  const result = prepared as unknown as PreparedPartOutputsV7;
  importedBodyApply<void>(
    preparedPartWeakMapSet,
    preparedPartOutputsV7States,
    [result, state],
  );
  return result;
}

function createPreparedPartKernelAccessV7(
  prepared: PreparedPartOutputsV7,
  kernel: GeometryKernel,
  access: BodySetKernelAccess,
): PreparedPartKernelAccessV7 {
  const retained = importedBodyApply<Record<string, unknown>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
    retained,
    "kernelId",
    {
      configurable: false,
      enumerable: true,
      writable: false,
      value: access.id,
    },
  ]);
  importedBodyApply<void>(importedBodyObjectFreeze, Object, [retained]);
  const result = retained as unknown as PreparedPartKernelAccessV7;
  importedBodyApply<void>(
    preparedPartWeakMapSet,
    preparedPartKernelAccessV7States,
    [result, { prepared, kernel, access }],
  );
  return result;
}

function createPreparedProductGeometryOutputsV7(
  resourceIds: readonly ResourceId[],
  metrics: PreparedPartEvaluationMetricsV7,
  state: PreparedProductGeometryOutputsV7State,
): PreparedProductGeometryOutputsV7 {
  const prepared = importedBodyApply<Record<string, unknown>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
    prepared,
    "resourceIds",
    {
      configurable: false,
      enumerable: true,
      writable: false,
      value: resourceIds,
    },
  ]);
  importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
    prepared,
    "metrics",
    {
      configurable: false,
      enumerable: true,
      writable: false,
      value: metrics,
    },
  ]);
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [prepared],
  );
  const result =
    prepared as unknown as PreparedProductGeometryOutputsV7;
  importedBodyApply<void>(
    preparedPartWeakMapSet,
    preparedProductGeometryOutputsV7States,
    [result, state],
  );
  return result;
}

function createPreparedProductGeometryKernelAccessV7(
  prepared: PreparedProductGeometryOutputsV7,
  kernel: GeometryKernel,
  access: BodySetKernelAccess,
): PreparedProductGeometryKernelAccessV7 {
  const retained = importedBodyApply<Record<string, unknown>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
    retained,
    "kernelId",
    {
      configurable: false,
      enumerable: true,
      writable: false,
      value: access.id,
    },
  ]);
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [retained],
  );
  const result =
    retained as unknown as PreparedProductGeometryKernelAccessV7;
  importedBodyApply<void>(
    preparedPartWeakMapSet,
    preparedProductGeometryKernelAccessV7States,
    [result, { prepared, kernel, access }],
  );
  return result;
}

const PART_EVALUATION_PHASE = "documentV7PartEvaluation";
const PART_EVALUATION_OPTION_KEYS = Object.freeze([
  "configuration",
  "parameters",
  "outputs",
  "resolver",
  "evaluationLimits",
  "resourceLimits",
  "documentLimits",
  "signal",
] as const);
const PART_EVALUATION_LIMIT_KEYS = Object.freeze([
  "maxSelectedOutputs",
  "maxParameterOverrides",
  "maxPartBodies",
  "maxDistinctSolids",
  "maxSolidGraphNodes",
  "maxSolidDependencyLinks",
  "maxTransformOperations",
  "maxResolvedMaterials",
] as const satisfies readonly (keyof PartEvaluationLimitsV7)[]);

function partEvaluationAborted(signal: AbortSignal | undefined): boolean {
  return importedBodyEvaluationAborted(signal);
}

function partEvaluationAbortFailure(node?: NodeId): CadResult<never> {
  return failure(
    diagnostic("EVALUATION_ABORTED", "Part evaluation was aborted", {
      severity: "error",
      ...(node === undefined ? {} : { node, path: `/nodes/${node}` }),
      details: { phase: PART_EVALUATION_PHASE },
    }),
  );
}

function partRuntimeIntegrityFailure(): CadResult<never> {
  return failure(
    diagnostic("IR_INVALID", DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE, {
      severity: "error",
      details: {
        phase: PART_EVALUATION_PHASE,
        runtimeIntegrity: false,
      },
    }),
  );
}

function partPostBoundaryFailure(
  signal: AbortSignal | undefined,
  node?: NodeId,
): CadResult<never> | undefined {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  if (partEvaluationAborted(signal)) {
    return partEvaluationAbortFailure(node);
  }
  return undefined;
}

function partLimitFailure(
  resource: keyof PartEvaluationLimitsV7,
  limit: number,
  actual: number,
  path: string,
): CadResult<never> {
  return failure(
    diagnostic(
      "RESOURCE_LIMIT_EXCEEDED",
      `Part evaluation limit '${resource}' (${limit}) was exceeded`,
      {
        severity: "error",
        path,
        details: {
          phase: PART_EVALUATION_PHASE,
          resource,
          limit,
          actual,
        },
      },
    ),
  );
}

type PartOwnDataRecordOptions = StagedV7OwnDataRecordOptions<
  keyof PartEvaluationLimitsV7
>;

function partOwnDataRecord(
  value: unknown,
  path: string,
  options: PartOwnDataRecordOptions = {},
): CadResult<Readonly<Record<string, unknown>>> {
  return stagedV7OwnDataRecord(
    value,
    path,
    options,
    PART_EVALUATION_PHASE,
    partPostBoundaryFailure,
    partLimitFailure,
  );
}

function partEvaluationLimitKey(
  value: string,
): value is keyof PartEvaluationLimitsV7 {
  for (let index = 0; index < PART_EVALUATION_LIMIT_KEYS.length; index += 1) {
    if (PART_EVALUATION_LIMIT_KEYS[index] === value) return true;
  }
  return false;
}

function capturePartEvaluationLimits(
  value: unknown,
  signal: AbortSignal | undefined,
): CadResult<PartEvaluationLimitsV7> {
  if (value === undefined) return success(DEFAULT_PART_EVALUATION_LIMITS_V7);
  const captured = partOwnDataRecord(value, "/evaluationLimits", {
    ...(signal === undefined ? {} : { signal }),
    maximumOwnKeys: PART_EVALUATION_LIMIT_KEYS.length,
  });
  if (!captured.ok) return captured;
  const keys = importedBodyObjectKeyList(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!partEvaluationLimitKey(key)) {
      return failure(
        diagnostic("IR_INVALID", `Unknown part evaluation limit '${key}'`, {
          severity: "error",
          path: `/evaluationLimits/${importedBodyJsonPointerSegment(key)}`,
          details: { phase: PART_EVALUATION_PHASE },
        }),
      );
    }
  }
  const normalized: Record<keyof PartEvaluationLimitsV7, number> = {
    maxSelectedOutputs:
      DEFAULT_PART_EVALUATION_LIMITS_V7.maxSelectedOutputs,
    maxParameterOverrides:
      DEFAULT_PART_EVALUATION_LIMITS_V7.maxParameterOverrides,
    maxPartBodies: DEFAULT_PART_EVALUATION_LIMITS_V7.maxPartBodies,
    maxDistinctSolids:
      DEFAULT_PART_EVALUATION_LIMITS_V7.maxDistinctSolids,
    maxSolidGraphNodes:
      DEFAULT_PART_EVALUATION_LIMITS_V7.maxSolidGraphNodes,
    maxSolidDependencyLinks:
      DEFAULT_PART_EVALUATION_LIMITS_V7.maxSolidDependencyLinks,
    maxTransformOperations:
      DEFAULT_PART_EVALUATION_LIMITS_V7.maxTransformOperations,
    maxResolvedMaterials:
      DEFAULT_PART_EVALUATION_LIMITS_V7.maxResolvedMaterials,
  };
  for (let index = 0; index < PART_EVALUATION_LIMIT_KEYS.length; index += 1) {
    const key = PART_EVALUATION_LIMIT_KEYS[index]!;
    if (
      !importedBodyApply<boolean>(
        importedBodyObjectHasOwn,
        Object,
        [captured.value, key],
      )
    ) {
      continue;
    }
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !importedBodyApply<boolean>(
        importedBodyNumberIsSafeInteger,
        Number,
        [candidate],
      ) ||
      candidate < 0
    ) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Part evaluation limit '${key}' must be a non-negative safe integer`,
          {
            severity: "error",
            path: `/evaluationLimits/${key}`,
            details: { phase: PART_EVALUATION_PHASE },
          },
        ),
      );
    }
    normalized[key] = candidate;
  }
  return success(
    importedBodyApply<PartEvaluationLimitsV7>(
      importedBodyObjectFreeze,
      Object,
      [normalized],
    ),
  );
}

function capturePartResourceLimits(
  value: unknown,
  signal: AbortSignal | undefined,
): CadResult<ResourceResolutionLimitsV7> {
  return captureStagedV7ResourceLimits(
    value,
    signal,
    PART_EVALUATION_PHASE,
    partPostBoundaryFailure,
    partLimitFailure,
  );
}

function capturePartOutputNames(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
): CadResult<readonly string[] | undefined> {
  return captureStagedV7OutputNames(
    value,
    maximum,
    signal,
    PART_EVALUATION_PHASE,
    partPostBoundaryFailure,
    partLimitFailure,
    "maxSelectedOutputs",
  );
}

function capturePartParameters(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
): CadResult<Readonly<Record<string, number>>> {
  return captureStagedV7Parameters(
    value,
    maximum,
    signal,
    PART_EVALUATION_PHASE,
    partPostBoundaryFailure,
    partLimitFailure,
    "maxParameterOverrides",
  );
}

function capturePartEvaluationOptions(
  value: unknown,
): CadResult<CapturedPartOutputsV7Options> {
  return captureStagedV7EvaluationOptions(
    value,
    "part",
    PART_EVALUATION_PHASE,
    PART_EVALUATION_OPTION_KEYS,
    partPostBoundaryFailure,
    partLimitFailure,
    capturePartEvaluationLimits,
    capturePartResourceLimits,
    capturePartOutputNames,
    capturePartParameters,
  );
}

function partKernelFailure(
  kernel: string,
  message: string,
  options: {
    readonly node?: NodeId;
    readonly path?: string;
    readonly details?: Readonly<Record<string, unknown>>;
  } = {},
): CadResult<never> {
  return failure(
    diagnostic("KERNEL_ERROR", message, {
      severity: "error",
      ...(options.node === undefined ? {} : { node: options.node }),
      ...(options.path === undefined ? {} : { path: options.path }),
      details: {
        phase: PART_EVALUATION_PHASE,
        kernel,
        ...options.details,
      },
    }),
  );
}

function partCapabilityFailure(
  kernel: string,
  node: NodeId,
  kind: "primitive" | "feature" | "documentBodyImport",
  capability: string,
  message: string,
): CadResult<never> {
  return failure(
    diagnostic("KERNEL_CAPABILITY_MISSING", message, {
      severity: "error",
      node,
      path: `/nodes/${node}`,
      details: {
        phase: PART_EVALUATION_PHASE,
        kernel,
        kind,
        capability,
      },
    }),
  );
}

const PART_SOLID_DIAGNOSTICS =
  Object.freeze<StagedV7SolidDiagnosticContext>({
    phase: PART_EVALUATION_PHASE,
    capabilityScope: "part",
    solidLabel: "part solid",
    solidFailureLabel: "Part solid",
    postBoundaryFailure: partPostBoundaryFailure,
    kernelFailure: partKernelFailure,
    capabilityFailure: partCapabilityFailure,
  });

/**
 * Captures and prepares direct document-v7 `part` outputs without observing a
 * resolver or geometry kernel.
 *
 * @internal
 */
export function preparePartOutputsV7(
  inputDocument: DesignDocumentV7,
  inputOptions: EvaluatePartOutputsV7Options = {},
): CadResult<PreparedPartOutputsV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const capturedOptions = capturePartEvaluationOptions(inputOptions);
  const afterOptions = partPostBoundaryFailure(undefined);
  if (afterOptions !== undefined) return afterOptions;
  if (!capturedOptions.ok) return capturedOptions;
  const options = capturedOptions.value;
  if (partEvaluationAborted(options.signal)) {
    return partEvaluationAbortFailure();
  }
  const capturedDocument = captureProductDocumentV7(
    inputDocument,
    options.documentLimits,
    options.signal,
  );
  if (!capturedDocument.ok) return capturedDocument;
  const document = capturedDocument.value.document;
  const requested: string[] = [];
  if (options.outputs === undefined) {
    const outputNames = importedBodyObjectKeyList(document.outputs);
    if (
      outputNames.length >
      options.evaluationLimits.maxSelectedOutputs
    ) {
      return partLimitFailure(
        "maxSelectedOutputs",
        options.evaluationLimits.maxSelectedOutputs,
        outputNames.length,
        "/outputs",
      );
    }
    for (let index = 0; index < outputNames.length; index += 1) {
      importedBodyArrayAppend(requested, outputNames[index]!);
    }
  } else {
    for (let index = 0; index < options.outputs.length; index += 1) {
      importedBodyArrayAppend(requested, options.outputs[index]!);
    }
  }
  if (requested.length === 0) {
    return failure(
      diagnostic("OUTPUT_MISSING", "The document has no selected outputs", {
        severity: "error",
        path: "/outputs",
        details: { phase: PART_EVALUATION_PHASE },
      }),
    );
  }
  const selections: ProductGeometrySelectionV7[] = [];
  for (let index = 0; index < requested.length; index += 1) {
    const name = requested[index]!;
    const outputPath =
      `/outputs/${importedBodyJsonPointerSegment(name)}`;
    const reference = importedBodyApply<boolean>(
      importedBodyObjectHasOwn,
      Object,
      [document.outputs, name],
    )
      ? document.outputs[name]
      : undefined;
    if (reference === undefined) {
      return failure(
        diagnostic("OUTPUT_MISSING", `Unknown output '${name}'`, {
          severity: "error",
          path: outputPath,
          details: { phase: PART_EVALUATION_PHASE },
        }),
      );
    }
    const node = importedBodyApply<boolean>(
      importedBodyObjectHasOwn,
      Object,
      [document.nodes, reference.node],
    )
      ? document.nodes[reference.node]
      : undefined;
    if (
      reference.kind !== "part" ||
      node === undefined ||
      node.kind !== "part" ||
      !("geometry" in node)
    ) {
      return failure(
        diagnostic(
          "EVALUATION_UNSUPPORTED",
          `Staged part evaluation requires output '${name}' to directly reference a part node`,
          {
            severity: "error",
            node: reference.node,
            path: outputPath,
            details: {
              phase: PART_EVALUATION_PHASE,
              supported: "direct-part-output",
              outputKind: reference.kind,
              nodeKind: node?.kind,
            },
          },
        ),
      );
    }
    importedBodyArrayAppend(selections, {
      name,
      node: reference.node,
      kind: "part",
      path: outputPath,
    });
  }
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [selections],
  );
  return prepareProductGeometryOutputsV7Core(
    capturedDocument.value,
    selections,
    options,
    {
      includeCapturedDiagnostics: true,
      resolveAllMaterials: true,
      resultKind: "part",
      partOptions: options,
    },
  ) as CadResult<PreparedPartOutputsV7>;
}
function productGeometrySolidNodeV7(
  value: NodeIRV7 | undefined,
): value is StagedSolidGraphNodeV7 {
  return (
    value !== undefined &&
    (value.kind === "box" ||
      value.kind === "cylinder" ||
      value.kind === "sphere" ||
      value.kind === "importedBody" ||
      value.kind === "boolean" ||
      value.kind === "transform")
  );
}

function appendProductGeometryBodySetRootsV7(
  roots: StagedSolidGraphRootV7[],
  node: BodySetNodeIRV7,
  nodeId: NodeId,
): void {
  for (let bodyIndex = 0; bodyIndex < node.bodies.length; bodyIndex += 1) {
    importedBodyArrayAppend(roots, {
      node: node.bodies[bodyIndex]!.solid.node,
      path: `/nodes/${nodeId}/bodies/${bodyIndex}/solid`,
    });
  }
}

function advanceProductGeometryBodyCountV7(
  current: number,
  additional: number,
  maximum: number,
  path: string,
): CadResult<number> {
  const actual = current + additional;
  if (actual > maximum) {
    return partLimitFailure(
      "maxPartBodies",
      maximum,
      actual,
      path,
    );
  }
  return success(actual);
}

function retainCapturedProductDocumentV7(
  document: DesignDocumentV7,
  diagnostics: readonly Diagnostic[],
): CapturedProductDocumentV7 {
  const token = importedBodyApply<Record<string, unknown>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
    token,
    "document",
    {
      configurable: false,
      enumerable: true,
      writable: false,
      value: document,
    },
  ]);
  importedBodyApply<void>(importedBodyObjectDefineProperty, Object, [
    token,
    "diagnostics",
    {
      configurable: false,
      enumerable: true,
      writable: false,
      value: diagnostics,
    },
  ]);
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [token],
  );
  const captured = token as unknown as CapturedProductDocumentV7;
  importedBodyApply<void>(
    preparedPartWeakMapSet,
    capturedProductDocumentV7States,
    [captured, captured],
  );
  return captured;
}

/**
 * Captures and validates one root staged product document exactly once.
 *
 * @internal
 */
export function captureProductDocumentV7(
  inputDocument: DesignDocumentV7,
  documentLimits?: Partial<DesignDocumentLimits>,
  signal?: AbortSignal,
): CadResult<CapturedProductDocumentV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const parsed = parseDocumentValueV7(
    inputDocument,
    documentLimits === undefined ? {} : { limits: documentLimits },
  );
  const boundary = partPostBoundaryFailure(signal);
  if (boundary !== undefined) return boundary;
  if (!parsed.ok) return parsed;
  const captured = retainCapturedProductDocumentV7(
    parsed.value,
    parsed.diagnostics,
  );
  const finalBoundary = partPostBoundaryFailure(signal);
  return finalBoundary ?? success(captured, parsed.diagnostics);
}

/**
 * Admits one external document byte source and retains its parsed staged value
 * without a second parse.
 *
 * @internal
 */
export function admitCapturedProductDocumentBytesV7(
  bytes: Uint8Array,
  documentLimits?: Partial<DesignDocumentLimits>,
  signal?: AbortSignal,
): CadResult<AdmittedCapturedProductDocumentV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const admitted = admitDocumentBytesToV7(
    bytes,
    documentLimits === undefined ? {} : { limits: documentLimits },
  );
  const boundary = partPostBoundaryFailure(signal);
  if (boundary !== undefined) return boundary;
  if (!admitted.ok) return admitted;
  const captured = retainCapturedProductDocumentV7(
    admitted.value.document,
    admitted.diagnostics,
  );
  const result = importedBodyApply<AdmittedCapturedProductDocumentV7>(
    importedBodyObjectFreeze,
    Object,
    [
      {
        captured,
        sourceVersion: admitted.value.sourceVersion,
      },
    ],
  );
  const finalBoundary = partPostBoundaryFailure(signal);
  return finalBoundary ?? success(result, admitted.diagnostics);
}

/**
 * Prepares one trusted staged-product native-geometry batch.
 *
 * The product planner supplies detached selections after it has classified the
 * caller's ordered output list. No document nodes or outputs are synthesized.
 * All selected roots enter one solid graph, so definitions shared by a direct
 * output and a part occurrence are acquired exactly once in this effective
 * configuration context.
 *
 * @internal
 */
function prepareProductGeometryOutputsV7Core(
  capturedDocument: CapturedProductDocumentV7,
  selections: readonly ProductGeometrySelectionV7[],
  options: PrepareProductGeometryOutputsV7Options,
  behavior:
    | {
        readonly includeCapturedDiagnostics: true;
        readonly resolveAllMaterials: true;
        readonly resultKind: "part";
        readonly partOptions: CapturedPartOutputsV7Options;
      }
    | {
        readonly includeCapturedDiagnostics: false;
        readonly resolveAllMaterials: boolean;
        readonly resultKind: "product";
      },
): CadResult<
  PreparedPartOutputsV7 | PreparedProductGeometryOutputsV7
> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const capturedState = capturedProductDocumentState(capturedDocument);
  if (capturedState === undefined) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Product geometry document is not owned by this evaluator",
        {
          severity: "error",
          details: {
            phase: PART_EVALUATION_PHASE,
            capturedDocumentOwner: false,
          },
        },
      ),
    );
  }
  const afterOptions = partPostBoundaryFailure(options.signal);
  if (afterOptions !== undefined) return afterOptions;
  const document = capturedState.document;
  if (
    selections.length >
    options.evaluationLimits.maxSelectedOutputs
  ) {
    return partLimitFailure(
      "maxSelectedOutputs",
      options.evaluationLimits.maxSelectedOutputs,
      selections.length,
      "/outputs",
    );
  }
  if (selections.length === 0) {
    return failure(
      diagnostic(
        "OUTPUT_MISSING",
        "The product geometry batch has no selected definitions",
        {
          severity: "error",
          path: "/outputs",
          details: { phase: PART_EVALUATION_PHASE },
        },
      ),
    );
  }

  const selectedOutputs: SelectedProductGeometryOutputV7[] = [];
  const solidRoots: StagedSolidGraphRootV7[] = [];
  const selectedNames = new ImportedBodySet<string>();
  let selectedBodyCount = 0;
  for (
    let selectionIndex = 0;
    selectionIndex < selections.length;
    selectionIndex += 1
  ) {
    const selection = selections[selectionIndex]!;
    const selectionPath =
      typeof selection.path === "string"
        ? selection.path
        : `/outputs/${selectionIndex}`;
    if (
      typeof selection.name !== "string" ||
      typeof selection.node !== "string" ||
      (selection.kind !== "solid" &&
        selection.kind !== "bodySet" &&
        selection.kind !== "part")
    ) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Product geometry selection ${selectionIndex} is invalid`,
          {
            severity: "error",
            path: selectionPath,
            details: { phase: PART_EVALUATION_PHASE },
          },
        ),
      );
    }
    if (importedBodySetHasValue(selectedNames, selection.name)) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Duplicate product geometry selection '${selection.name}'`,
          {
            severity: "error",
            path: selectionPath,
            details: { phase: PART_EVALUATION_PHASE },
          },
        ),
      );
    }
    importedBodySetAddValue(selectedNames, selection.name);
    const node = importedBodyApply<boolean>(
      importedBodyObjectHasOwn,
      Object,
      [document.nodes, selection.node],
    )
      ? document.nodes[selection.node]
      : undefined;
    if (selection.kind === "solid") {
      if (!productGeometrySolidNodeV7(node)) {
        return failure(
          diagnostic(
            "EVALUATION_UNSUPPORTED",
            `Product solid selection '${selection.name}' must reference an admitted solid graph`,
            {
              severity: "error",
              node: selection.node,
              path: selectionPath,
              details: {
                phase: PART_EVALUATION_PHASE,
                outputKind: selection.kind,
                nodeKind: node?.kind,
              },
            },
          ),
        );
      }
      const nextBodyCount = advanceProductGeometryBodyCountV7(
        selectedBodyCount,
        1,
        options.evaluationLimits.maxPartBodies,
        selectionPath,
      );
      if (!nextBodyCount.ok) return nextBodyCount;
      selectedBodyCount = nextBodyCount.value;
      importedBodyArrayAppend(solidRoots, {
        node: selection.node,
        path: selectionPath,
      });
      importedBodyArrayAppend(selectedOutputs, {
        name: selection.name,
        nodeId: selection.node,
        kind: "solid",
        node,
      });
    } else if (selection.kind === "bodySet") {
      if (node === undefined || node.kind !== "bodySet") {
        return failure(
          diagnostic(
            "EVALUATION_UNSUPPORTED",
            `Product body-set selection '${selection.name}' must reference a bodySet node`,
            {
              severity: "error",
              node: selection.node,
              path: selectionPath,
              details: {
                phase: PART_EVALUATION_PHASE,
                outputKind: selection.kind,
                nodeKind: node?.kind,
              },
            },
          ),
        );
      }
      const nextBodyCount = advanceProductGeometryBodyCountV7(
        selectedBodyCount,
        node.bodies.length,
        options.evaluationLimits.maxPartBodies,
        selectionPath,
      );
      if (!nextBodyCount.ok) return nextBodyCount;
      selectedBodyCount = nextBodyCount.value;
      appendProductGeometryBodySetRootsV7(
        solidRoots,
        node,
        selection.node,
      );
      importedBodyArrayAppend(selectedOutputs, {
        name: selection.name,
        nodeId: selection.node,
        kind: "bodySet",
        node,
      });
    } else {
      if (
        node === undefined ||
        node.kind !== "part" ||
        !("geometry" in node)
      ) {
        return failure(
          diagnostic(
            "EVALUATION_UNSUPPORTED",
            `Product part selection '${selection.name}' must reference a staged part node`,
            {
              severity: "error",
              node: selection.node,
              path: selectionPath,
              details: {
                phase: PART_EVALUATION_PHASE,
                outputKind: selection.kind,
                nodeKind: node?.kind,
              },
            },
          ),
        );
      }
      const geometryNode = importedBodyApply<boolean>(
        importedBodyObjectHasOwn,
        Object,
        [document.nodes, node.geometry.node],
      )
        ? document.nodes[node.geometry.node]
        : undefined;
      let geometry: SelectedPartGeometryNodeV7;
      if (
        node.geometry.kind === "solid" &&
        productGeometrySolidNodeV7(geometryNode)
      ) {
        geometry = {
          kind: "solid",
          nodeId: node.geometry.node,
          node: geometryNode,
        };
        const nextBodyCount = advanceProductGeometryBodyCountV7(
          selectedBodyCount,
          1,
          options.evaluationLimits.maxPartBodies,
          selectionPath,
        );
        if (!nextBodyCount.ok) return nextBodyCount;
        selectedBodyCount = nextBodyCount.value;
        importedBodyArrayAppend(solidRoots, {
          node: node.geometry.node,
          path: `/nodes/${selection.node}/geometry`,
        });
      } else if (
        node.geometry.kind === "bodySet" &&
        geometryNode !== undefined &&
        geometryNode.kind === "bodySet"
      ) {
        geometry = {
          kind: "bodySet",
          nodeId: node.geometry.node,
          node: geometryNode,
        };
        const nextBodyCount = advanceProductGeometryBodyCountV7(
          selectedBodyCount,
          geometryNode.bodies.length,
          options.evaluationLimits.maxPartBodies,
          selectionPath,
        );
        if (!nextBodyCount.ok) return nextBodyCount;
        selectedBodyCount = nextBodyCount.value;
        appendProductGeometryBodySetRootsV7(
          solidRoots,
          geometryNode,
          node.geometry.node,
        );
      } else {
        return failure(
          diagnostic(
            "EVALUATION_UNSUPPORTED",
            `Part '${selection.node}' geometry must reference an admitted solid graph or bodySet`,
            {
              severity: "error",
              node: selection.node,
              path: `/nodes/${selection.node}/geometry`,
              details: {
                phase: PART_EVALUATION_PHASE,
                geometryKind: node.geometry.kind,
                referencedNode: node.geometry.node,
                nodeKind: geometryNode?.kind,
              },
            },
          ),
        );
      }
      importedBodyArrayAppend(selectedOutputs, {
        name: selection.name,
        nodeId: selection.node,
        kind: "part",
        node,
        geometry,
      });
    }
  }

  const solidPlan = planStagedSolidGraphV7(
    document,
    solidRoots,
    options.evaluationLimits,
    PART_EVALUATION_PHASE,
  );
  const afterSolidPlan = partPostBoundaryFailure(options.signal);
  if (afterSolidPlan !== undefined) return afterSolidPlan;
  if (!solidPlan.ok) return solidPlan;

  let selectedConfigurationId: ConfigurationId | null = null;
  let selectedConfiguration: DesignConfigurationIR | undefined;
  if (options.configuration !== undefined) {
    if (
      !importedBodyApply<boolean>(
        importedBodyObjectHasOwn,
        Object,
        [document.configurations ?? {}, options.configuration],
      )
    ) {
      return failure(
        diagnostic(
          "CONFIGURATION_MISSING",
          `Unknown configuration '${options.configuration}'`,
          {
            severity: "error",
            path: `/configurations/${importedBodyJsonPointerSegment(
              options.configuration,
            )}`,
            details: {
              phase: PART_EVALUATION_PHASE,
              available: importedBodyObjectKeyList(
                document.configurations ?? {},
              ).sort(lexicalCompare),
            },
          },
        ),
      );
    }
    selectedConfigurationId = options.configuration as ConfigurationId;
    selectedConfiguration =
      document.configurations![selectedConfigurationId];
  }

  let parameterResult: ReturnType<typeof resolveEvaluationParameters>;
  try {
    parameterResult = resolveEvaluationParameters(
      document,
      options.parameters,
      selectedConfigurationId,
      selectedConfiguration,
    );
  } catch (error) {
    const afterParameters = partPostBoundaryFailure(options.signal);
    if (afterParameters !== undefined) return afterParameters;
    return failure(
      diagnostic(
        "EXPRESSION_INVALID",
        bodySetThrownCause(
          error,
          "Product geometry parameters could not be resolved safely",
        ),
        {
          severity: "error",
          path: "/parameters",
          details: { phase: PART_EVALUATION_PHASE },
        },
      ),
    );
  }
  const afterParameters = partPostBoundaryFailure(options.signal);
  if (afterParameters !== undefined) return afterParameters;
  if (!parameterResult.ok) return parameterResult;
  const parameterValues = parameterResult.value.values;
  const diagnostics: Diagnostic[] = [];
  if (behavior.includeCapturedDiagnostics) {
    for (
      let index = 0;
      index < capturedState.diagnostics.length;
      index += 1
    ) {
      importedBodyArrayAppend(
        diagnostics,
        capturedState.diagnostics[index]!,
      );
    }
  }
  for (
    let index = 0;
    index < parameterResult.diagnostics.length;
    index += 1
  ) {
    importedBodyArrayAppend(
      diagnostics,
      parameterResult.diagnostics[index]!,
    );
  }
  const expression = (value: ExpressionIR): number =>
    evaluateExpression(value, {
      resolveParameter: (id) => {
        const resolved = parameterValues.get(id);
        if (resolved === undefined) {
          throw new Error(`Unresolved parameter '${id}'`);
        }
        return resolved;
      },
    });

  let materialIds: string[];
  if (behavior.resolveAllMaterials) {
    materialIds = importedBodyArraySortLexically(
      importedBodyObjectKeyList(document.materials ?? {}),
    );
  } else {
    const selectedMaterialIds = new ImportedBodySet<MaterialId>();
    const materialOverrides =
      selectedConfiguration?.partMaterialOverrides;
    for (let index = 0; index < selectedOutputs.length; index += 1) {
      const selected = selectedOutputs[index]!;
      if (selected.kind !== "part") continue;
      const materialId =
        materialOverrides !== undefined &&
        importedBodyApply<boolean>(
          importedBodyObjectHasOwn,
          Object,
          [materialOverrides, selected.nodeId],
        )
          ? materialOverrides[selected.nodeId]
          : selected.node.materialId;
      if (materialId !== undefined) {
        importedBodySetAddValue(selectedMaterialIds, materialId);
      }
    }
    materialIds = importedBodyArraySortLexically([
      ...selectedMaterialIds,
    ]);
  }
  if (
    materialIds.length >
    options.evaluationLimits.maxResolvedMaterials
  ) {
    return partLimitFailure(
      "maxResolvedMaterials",
      options.evaluationLimits.maxResolvedMaterials,
      materialIds.length,
      "/materials",
    );
  }
  const resolvedMaterials = new Map<MaterialId, EvaluatedMaterial>();
  for (let index = 0; index < materialIds.length; index += 1) {
    const id = materialIds[index] as MaterialId;
    const boundary = partPostBoundaryFailure(options.signal);
    if (boundary !== undefined) return boundary;
    const definition = document.materials![id]!;
    let massDensity: number;
    try {
      massDensity = expression(definition.massDensity);
    } catch (error) {
      const afterMaterial = partPostBoundaryFailure(options.signal);
      if (afterMaterial !== undefined) return afterMaterial;
      importedBodyArrayAppend(
        diagnostics,
        diagnostic(
          "MASS_DENSITY_INVALID",
          `Material '${id}' massDensity must evaluate to a finite, strictly positive number`,
          {
            severity: "error",
            path: `/materials/${id}/massDensity`,
            details: {
              phase: PART_EVALUATION_PHASE,
              cause: bodySetThrownCause(
                error,
                "Material density evaluation failed with an opaque value",
              ),
            },
          },
        ),
      );
      continue;
    }
    if (
      !importedBodyApply<boolean>(
        importedBodyNumberIsFinite,
        Number,
        [massDensity],
      ) ||
      !(massDensity > 0)
    ) {
      importedBodyArrayAppend(
        diagnostics,
        diagnostic(
          "MASS_DENSITY_INVALID",
          `Material '${id}' massDensity must be finite and strictly positive`,
          {
            severity: "error",
            path: `/materials/${id}/massDensity`,
            details: {
              phase: PART_EVALUATION_PHASE,
              value: massDensity,
            },
          },
        ),
      );
      continue;
    }
    resolvedMaterials.set(
      id,
      importedBodyApply<EvaluatedMaterial>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            id,
            name: definition.name,
            ...(definition.description === undefined
              ? {}
              : { description: definition.description }),
            massDensity,
            ...(definition.metadata === undefined
              ? {}
              : { metadata: definition.metadata }),
          },
        ],
      ),
    );
  }
  if (hasErrors(diagnostics)) {
    return { ok: false, diagnostics };
  }

  const resolvedParts = new Map<NodeId, ResolvedPartDefinitionV7>();
  for (let index = 0; index < selectedOutputs.length; index += 1) {
    const selected = selectedOutputs[index]!;
    if (
      selected.kind !== "part" ||
      resolvedParts.has(selected.nodeId)
    ) {
      continue;
    }
    const boundary = partPostBoundaryFailure(
      options.signal,
      selected.nodeId,
    );
    if (boundary !== undefined) return boundary;
    const materialOverrides =
      selectedConfiguration?.partMaterialOverrides;
    const materialId =
      materialOverrides !== undefined &&
      importedBodyApply<boolean>(
        importedBodyObjectHasOwn,
        Object,
        [materialOverrides, selected.nodeId],
      )
        ? materialOverrides[selected.nodeId]
        : selected.node.materialId;
    const materialDefinition =
      materialId === undefined
        ? undefined
        : resolvedMaterials.get(materialId);
    let massDensity: number | undefined;
    let massDensitySource: MassDensitySource | undefined;
    if (selected.node.massDensity !== undefined) {
      try {
        massDensity = expression(selected.node.massDensity);
      } catch (error) {
        const afterDensity = partPostBoundaryFailure(
          options.signal,
          selected.nodeId,
        );
        if (afterDensity !== undefined) return afterDensity;
        return failure(
          diagnostic(
            "MASS_DENSITY_INVALID",
            `Part '${selected.nodeId}' massDensity must evaluate to a finite, strictly positive number`,
            {
              severity: "error",
              node: selected.nodeId,
              path: `/nodes/${selected.nodeId}/massDensity`,
              details: {
                phase: PART_EVALUATION_PHASE,
                cause: bodySetThrownCause(
                  error,
                  "Part density evaluation failed with an opaque value",
                ),
              },
            },
          ),
        );
      }
      if (
        !importedBodyApply<boolean>(
          importedBodyNumberIsFinite,
          Number,
          [massDensity],
        ) ||
        !(massDensity > 0)
      ) {
        return failure(
          diagnostic(
            "MASS_DENSITY_INVALID",
            `Part '${selected.nodeId}' massDensity must be finite and strictly positive`,
            {
              severity: "error",
              node: selected.nodeId,
              path: `/nodes/${selected.nodeId}/massDensity`,
              details: {
                phase: PART_EVALUATION_PHASE,
                value: massDensity,
              },
            },
          ),
        );
      }
      massDensitySource = "part";
    } else if (materialDefinition !== undefined) {
      massDensity = materialDefinition.massDensity;
      massDensitySource = "material";
    }
    resolvedParts.set(
      selected.nodeId,
      importedBodyApply<ResolvedPartDefinitionV7>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            ...(materialId === undefined ? {} : { materialId }),
            ...(materialDefinition === undefined
              ? {}
              : { materialDefinition }),
            ...(massDensity === undefined ? {} : { massDensity }),
            ...(massDensitySource === undefined
              ? {}
              : { massDensitySource }),
          },
        ],
      ),
    );
  }

  const preparedSolidGraph = prepareStagedSolidGraphV7(
    solidPlan.value,
    expression,
    options.signal,
    PART_SOLID_DIAGNOSTICS,
  );
  const afterSolidPreparation = partPostBoundaryFailure(
    options.signal,
  );
  if (afterSolidPreparation !== undefined) {
    return afterSolidPreparation;
  }
  if (!preparedSolidGraph.ok) return preparedSolidGraph;

  const publicParameters = importedBodyApply<Record<string, number>>(
    importedBodyObjectCreate,
    Object,
    [null],
  );
  for (const [id, value] of parameterValues) {
    importedBodyApply<void>(
      importedBodyObjectDefineProperty,
      Object,
      [
        publicParameters,
        id,
        {
          configurable: false,
          enumerable: true,
          writable: false,
          value,
        },
      ],
    );
  }
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [publicParameters],
  );
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [selectedOutputs],
  );
  const frozenDiagnostics =
    importedBodyApply<readonly Diagnostic[]>(
      importedBodyObjectFreeze,
      Object,
      [diagnostics],
    );
  const metrics =
    importedBodyApply<PreparedPartEvaluationMetricsV7>(
      importedBodyObjectFreeze,
      Object,
      [
        {
          selectedOutputs: selectedOutputs.length,
          partBodies: selectedBodyCount,
          distinctSolids: solidPlan.value.leafNodes.length,
          solidGraphNodes: solidPlan.value.graphNodeCount,
          solidDependencyLinks:
            solidPlan.value.dependencyLinkCount,
          transformOperations:
            solidPlan.value.transformOperationCount,
          resolvedMaterials: materialIds.length,
        },
      ],
    );
  let prepared:
    | PreparedPartOutputsV7
    | PreparedProductGeometryOutputsV7;
  if (behavior.resultKind === "part") {
    const partOutputs = new Array<SelectedPartOutputV7>(
      selectedOutputs.length,
    );
    for (let index = 0; index < selectedOutputs.length; index += 1) {
      const selected = selectedOutputs[index]!;
      if (selected.kind !== "part") {
        return failure(
          diagnostic(
            "IR_INVALID",
            "Legacy part preparation admitted a non-part selection",
            {
              severity: "error",
              node: selected.nodeId,
              details: {
                phase: PART_EVALUATION_PHASE,
                protocolViolation: true,
                outputKind: selected.kind,
              },
            },
          ),
        );
      }
      partOutputs[index] = selected;
    }
    importedBodyApply<void>(
      importedBodyObjectFreeze,
      Object,
      [partOutputs],
    );
    prepared = createPreparedPartOutputsV7(
      preparedSolidGraph.value.resourceIds,
      metrics,
      importedBodyApply<PreparedPartOutputsV7State>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            options: behavior.partOptions,
            document,
            selectedOutputs: partOutputs,
            selectedConfigurationId,
            publicParameters,
            diagnostics: frozenDiagnostics,
            resolvedParts,
            expression,
            solidGraph: preparedSolidGraph.value,
          },
        ],
      ),
    );
  } else {
    prepared = createPreparedProductGeometryOutputsV7(
      preparedSolidGraph.value.resourceIds,
      metrics,
      importedBodyApply<PreparedProductGeometryOutputsV7State>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            options,
            document,
            selectedOutputs,
            selectedConfigurationId,
            publicParameters,
            diagnostics: frozenDiagnostics,
            resolvedParts,
            expression,
            solidGraph: preparedSolidGraph.value,
          },
        ],
      ),
    );
  }
  const beforeSuccess = partPostBoundaryFailure(options.signal);
  return beforeSuccess ?? success(prepared, frozenDiagnostics);
}

/**
 * Prepares a planner-owned native product batch without reparsing its captured
 * document or repeating root parse diagnostics.
 *
 * @internal
 */
export function prepareProductGeometryOutputsV7(
  capturedDocument: CapturedProductDocumentV7,
  selections: readonly ProductGeometrySelectionV7[],
  options: PrepareProductGeometryOutputsV7Options,
): CadResult<PreparedProductGeometryOutputsV7> {
  return prepareProductGeometryOutputsV7Core(
    capturedDocument,
    selections,
    options,
    {
      includeCapturedDiagnostics: false,
      resolveAllMaterials: options.materialScope === "document",
      resultKind: "product",
    },
  ) as CadResult<PreparedProductGeometryOutputsV7>;
}

function productGeometryDiagnosticMatchesPlanNodeV7(
  item: Diagnostic,
  candidate: StagedSolidGraphPlanV7["orderedNodes"][number],
): boolean {
  const [nodeId, node] = candidate;
  if (item.node !== nodeId) return false;
  const kind = item.details?.kind;
  if (typeof kind !== "string") return true;
  const capability = item.details?.capability;
  if (kind === "documentBodyImport") {
    return (
      node.kind === "importedBody" &&
      (typeof capability !== "string" ||
        capability === `${node.format}:${node.units.mode}`)
    );
  }
  if (kind === "primitive") {
    return (
      (node.kind === "box" ||
        node.kind === "cylinder" ||
        node.kind === "sphere") &&
      (typeof capability !== "string" || capability === node.kind)
    );
  }
  if (kind === "feature") {
    return (
      (node.kind === "boolean" || node.kind === "transform") &&
      (typeof capability !== "string" || capability === node.kind)
    );
  }
  if (kind === "exactIndexedTopologyEvolution") {
    return (
      node.kind === "boolean" &&
      (typeof capability !== "string" || capability === "boolean")
    );
  }
  return true;
}

/**
 * Captures one aggregate geometry-kernel contract for every prepared native
 * product batch before geometry-resource resolution begins. External document
 * bytes may already have been resolved and admitted so their child plans are
 * available to this aggregate preflight.
 *
 * The returned access tokens are batch-owned, but all retain the same captured
 * method set. No later batch re-observes mutable kernel properties.
 *
 * @internal
 */
export function preflightPreparedProductGeometryOutputsV7(
  kernel: GeometryKernel,
  preparedBatches: readonly PreparedProductGeometryOutputsV7[],
  batchProvenance?: readonly ProductGeometryBatchProvenanceV7[],
): CadResult<readonly PreparedProductGeometryKernelAccessV7[]> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const states =
    new Array<PreparedProductGeometryOutputsV7State>(
      preparedBatches.length,
    );
  if (
    batchProvenance !== undefined &&
    batchProvenance.length !== preparedBatches.length
  ) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Product geometry batch provenance must match the prepared batch count",
        {
          severity: "error",
          details: {
            phase: PART_EVALUATION_PHASE,
            preparedBatches: preparedBatches.length,
            provenanceEntries: batchProvenance.length,
          },
        },
      ),
    );
  }
  const orderedNodes: StagedSolidGraphPlanV7["orderedNodes"][number][] =
    [];
  const leafNodes: StagedSolidGraphPlanV7["leafNodes"][number][] = [];
  for (let index = 0; index < preparedBatches.length; index += 1) {
    const prepared = preparedBatches[index]!;
    const state = preparedProductGeometryState(prepared);
    if (state === undefined) {
      return failure(
        diagnostic(
          "IR_INVALID",
          "Prepared product geometry is not owned by this evaluator",
          {
            severity: "error",
            details: {
              phase: PART_EVALUATION_PHASE,
              preparedOwner: false,
              batchIndex: index,
            },
          },
        ),
      );
    }
    const boundary = partPostBoundaryFailure(state.options.signal);
    if (boundary !== undefined) return boundary;
    states[index] = state;
    const plan = state.solidGraph.plan;
    for (
      let nodeIndex = 0;
      nodeIndex < plan.orderedNodes.length;
      nodeIndex += 1
    ) {
      importedBodyArrayAppend(
        orderedNodes,
        plan.orderedNodes[nodeIndex]!,
      );
    }
    for (
      let leafIndex = 0;
      leafIndex < plan.leafNodes.length;
      leafIndex += 1
    ) {
      importedBodyArrayAppend(
        leafNodes,
        plan.leafNodes[leafIndex]!,
      );
    }
  }
  if (preparedBatches.length === 0) {
    return success(
      importedBodyApply<
        readonly PreparedProductGeometryKernelAccessV7[]
      >(
        importedBodyObjectFreeze,
        Object,
        [[]],
      ),
    );
  }
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [orderedNodes],
  );
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [leafNodes],
  );
  const aggregatePlan =
    importedBodyApply<StagedSolidGraphPlanV7>(
      importedBodyObjectFreeze,
      Object,
      [
        {
          orderedNodes,
          leafNodes,
          graphNodeCount: orderedNodes.length,
          dependencyLinkCount: 0,
          transformOperationCount: 0,
        },
      ],
    );
  const captured = captureBodySetKernelAccess(
    kernel,
    aggregatePlan,
    states[0]!.options.signal,
    PART_SOLID_DIAGNOSTICS,
  );
  for (let index = 0; index < states.length; index += 1) {
    const boundary = partPostBoundaryFailure(
      states[index]!.options.signal,
    );
    if (boundary !== undefined) return boundary;
  }
  if (!captured.ok) {
    const annotated = new Array<Diagnostic>(
      captured.diagnostics.length,
    );
    for (
      let diagnosticIndex = 0;
      diagnosticIndex < captured.diagnostics.length;
      diagnosticIndex += 1
    ) {
      const item = captured.diagnostics[diagnosticIndex]!;
      let batchIndex = 0;
      if (item.node !== undefined) {
        let matched = false;
        for (
          let candidateIndex = 0;
          candidateIndex < states.length && !matched;
          candidateIndex += 1
        ) {
          const nodes =
            states[candidateIndex]!.solidGraph.plan.orderedNodes;
          for (
            let nodeIndex = 0;
            nodeIndex < nodes.length;
            nodeIndex += 1
          ) {
            const candidate = nodes[nodeIndex]!;
            if (
              productGeometryDiagnosticMatchesPlanNodeV7(
                item,
                candidate,
              )
            ) {
              batchIndex = candidateIndex;
              matched = true;
              break;
            }
          }
        }
      }
      const provenance = batchProvenance?.[batchIndex];
      annotated[diagnosticIndex] =
        importedBodyApply<Diagnostic>(
          importedBodyObjectFreeze,
          Object,
          [
            {
              ...item,
              details: {
                ...item.details,
                productBatchIndex: batchIndex,
                ...(provenance === undefined
                  ? {}
                  : {
                      documentScope: provenance.documentScope,
                      selectionPath: provenance.selectionPath,
                    }),
              },
            },
          ],
        );
    }
    importedBodyApply<void>(
      importedBodyObjectFreeze,
      Object,
      [annotated],
    );
    return { ok: false, diagnostics: annotated };
  }
  const retained =
    new Array<PreparedProductGeometryKernelAccessV7>(
    preparedBatches.length,
  );
  for (let index = 0; index < preparedBatches.length; index += 1) {
    retained[index] =
      createPreparedProductGeometryKernelAccessV7(
        preparedBatches[index]!,
        kernel,
        captured.value,
      );
  }
  importedBodyApply<void>(
    importedBodyObjectFreeze,
    Object,
    [retained],
  );
  return success(retained);
}

/**
 * Captures all geometry-kernel access needed by one owned prepared part.
 *
 * No resource is resolved and no shape is constructed by this boundary.
 *
 * @internal
 */
export function preflightPreparedPartOutputsV7(
  kernel: GeometryKernel,
  prepared: PreparedPartOutputsV7,
): CadResult<PreparedPartKernelAccessV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const state = preparedPartState(prepared);
  if (state === undefined) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Prepared part evaluation is not owned by this evaluator module",
        {
          severity: "error",
          details: {
            phase: PART_EVALUATION_PHASE,
            preparedOwner: false,
          },
        },
      ),
    );
  }
  const boundary = partPostBoundaryFailure(state.options.signal);
  if (boundary !== undefined) return boundary;
  const captured = captureBodySetKernelAccess(
    kernel,
    state.solidGraph.plan,
    state.options.signal,
    PART_SOLID_DIAGNOSTICS,
  );
  const afterCapture = partPostBoundaryFailure(state.options.signal);
  if (afterCapture !== undefined) return afterCapture;
  if (!captured.ok) return captured;
  return success(
    createPreparedPartKernelAccessV7(prepared, kernel, captured.value),
    state.diagnostics,
  );
}

/**
 * Executes one owned prepared part using its exact retained kernel access and
 * caller-supplied verified resources.
 *
 * @internal
 */
export async function executePreparedPartOutputsV7(
  kernel: GeometryKernel,
  prepared: PreparedPartOutputsV7,
  retainedAccess: PreparedPartKernelAccessV7,
  resolvedResources?: ResolvedResourcesV7,
  shapeOwnershipTransaction?: PreparedPartShapeOwnershipTransactionV7,
): Promise<CadResult<EvaluatedPartDesignV7>> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const state = preparedPartState(prepared);
  const retained = preparedPartKernelState(retainedAccess);
  const transactionState =
    shapeOwnershipTransaction === undefined
      ? undefined
      : preparedPartShapeOwnershipTransactionState(
          shapeOwnershipTransaction,
        );
  if (
    state === undefined ||
    retained === undefined ||
    retained.prepared !== prepared ||
    retained.kernel !== kernel ||
    (shapeOwnershipTransaction !== undefined &&
      (transactionState === undefined ||
        transactionState.kernel !== kernel))
  ) {
    return failure(
      diagnostic(
        "IR_INVALID",
        shapeOwnershipTransaction !== undefined &&
          (transactionState === undefined ||
            transactionState.kernel !== kernel)
          ? "Prepared part shape-ownership transaction does not belong to this kernel"
          : "Prepared part kernel access does not belong to this evaluation",
        {
          severity: "error",
          details: {
            phase: PART_EVALUATION_PHASE,
            preparedOwner: state !== undefined,
            accessOwner: retained !== undefined,
            preparedMatches: retained?.prepared === prepared,
            kernelMatches: retained?.kernel === kernel,
            shapeOwnershipTransactionOwner:
              shapeOwnershipTransaction === undefined ||
              transactionState !== undefined,
            shapeOwnershipTransactionKernelMatches:
              shapeOwnershipTransaction === undefined ||
              transactionState?.kernel === kernel,
          },
        },
      ),
    );
  }
  if (transactionState?.active === true) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Concurrent prepared part shape-ownership transaction calls are unsupported",
        {
          severity: "error",
          details: {
            phase: PART_EVALUATION_PHASE,
            shapeOwnershipTransactionActive: true,
          },
        },
      ),
    );
  }
  if (transactionState !== undefined) {
    transactionState.active = true;
  }
  try {
    return await executePreparedPartOutputsV7InTransaction(
      kernel,
      state,
      retained,
      resolvedResources,
      transactionState,
    );
  } finally {
    if (transactionState !== undefined) {
      transactionState.active = false;
    }
  }
}

async function executePreparedPartOutputsV7InTransaction(
  kernel: GeometryKernel,
  state: PreparedPartOutputsV7State,
  retained: PreparedPartKernelAccessV7State,
  resolvedResources:
    | ResolvedResourcesV7
    | undefined,
  transaction:
    | PreparedPartShapeOwnershipTransactionV7State
    | undefined,
): Promise<CadResult<EvaluatedPartDesignV7>> {
  const {
    options,
    document,
    selectedOutputs,
    selectedConfigurationId,
    publicParameters,
    diagnostics,
    resolvedParts,
    expression,
  } = state;
  const solidPlan = state.solidGraph.plan;
  const solidGraph = await evaluateStagedSolidGraphV7({
    kernel,
    document,
    plan: solidPlan,
    expression,
    resourceLimits: options.resourceLimits,
    ...(options.signal === undefined
      ? {}
      : { signal: options.signal }),
    diagnostics: PART_SOLID_DIAGNOSTICS,
    prepared: state.solidGraph,
    access: retained.access,
    ...(resolvedResources === undefined ? {} : { resolvedResources }),
    resourcesArePreResolved: true,
    ...(transaction === undefined
      ? {}
      : { previouslyOwnedShapes: transaction.ownedShapes }),
  });
  const afterSolidGraph = partPostBoundaryFailure(options.signal);
  if (afterSolidGraph !== undefined) {
    if (!solidGraph.ok) return afterSolidGraph;
    solidGraph.value.dispose();
    return partPostBoundaryFailure(options.signal) ?? afterSolidGraph;
  }
  if (!solidGraph.ok) return solidGraph;
  const kernelAccess = { value: solidGraph.value.access };
  const createdShapes = solidGraph.value.createdShapes;
  const shapesByNode = solidGraph.value.shapesByNode;
  const failAfterCleanup = (
    result: CadResult<never>,
  ): CadResult<EvaluatedPartDesignV7> => {
    solidGraph.value.dispose();
    const afterCleanup = partPostBoundaryFailure(options.signal);
    if (afterCleanup !== undefined) return afterCleanup;
    return result;
  };
  const beforeSuccess = partPostBoundaryFailure(options.signal);
  if (beforeSuccess !== undefined) {
    return failAfterCleanup(beforeSuccess);
  }
  const owner = new EvaluationOwner(
    kernel,
    createdShapes,
    selectedConfigurationId,
  );
  captureEvaluationOwnerDocumentName(owner, document.name);
  captureEvaluationOwnerDisposer(
    owner,
    createdShapes,
    (shape) =>
      importedBodyApply<void>(
        kernelAccess.value.disposeShape,
        kernel,
        [shape],
      ),
  );
  const outputs = new Map<string, EvaluatedPartV7>();
  for (let outputIndex = 0; outputIndex < selectedOutputs.length; outputIndex += 1) {
    const selected = selectedOutputs[outputIndex]!;
    let geometry: EvaluatedPartGeometryV7;
    if (selected.geometry.kind === "solid") {
      geometry = importedBodyApply<EvaluatedPartGeometryV7>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            kind: "solid",
            node: selected.geometry.nodeId,
            solid: new StagedBodySetEvaluatedSolidV7(
              selected.name,
              owner,
              shapesByNode.get(selected.geometry.nodeId)!,
              kernelAccess.value,
            ),
          },
        ],
      );
    } else {
      const bodies: EvaluatedBodyV7[] = [];
      for (
        let bodyIndex = 0;
        bodyIndex < selected.geometry.node.bodies.length;
        bodyIndex += 1
      ) {
        const member = selected.geometry.node.bodies[bodyIndex]!;
        const solid = new StagedBodySetEvaluatedSolidV7(
          member.name ?? member.id,
          owner,
          shapesByNode.get(member.solid.node)!,
          kernelAccess.value,
        );
        importedBodyArrayAppend(
          bodies,
          importedBodyApply<EvaluatedBodyV7>(
            importedBodyObjectFreeze,
            Object,
            [
              {
                id: member.id,
                node: member.solid.node,
                ...(member.name === undefined
                  ? {}
                  : { name: member.name }),
                ...(member.metadata === undefined
                  ? {}
                  : { metadata: member.metadata }),
                solid,
              },
            ],
          ),
        );
      }
      geometry = importedBodyApply<EvaluatedPartGeometryV7>(
        importedBodyObjectFreeze,
        Object,
        [
          {
            kind: "bodySet",
            node: selected.geometry.nodeId,
            bodySet: new EvaluatedBodySetV7(
              selected.name,
              owner,
              bodies,
              kernelAccess.value.representation,
              kernelAccess.value.exact,
              evaluatedPartBodySetDiagnosticIdentityV7(
                selected.name,
                selected.nodeId,
              ),
            ),
          },
        ],
      );
    }
    const resolved = resolvedParts.get(selected.nodeId)!;
    const value = importedBodyApply<EvaluatedPartValueV7>(
      importedBodyObjectFreeze,
      Object,
      [
        {
          node: selected.nodeId,
          kernelId: kernelAccess.value.id,
          definition: selected.node,
          geometry,
          representation: kernelAccess.value.representation,
          exact: kernelAccess.value.exact,
          ...(resolved.materialId === undefined
            ? {}
            : { materialId: resolved.materialId }),
          ...(resolved.materialDefinition === undefined
            ? {}
            : { materialDefinition: resolved.materialDefinition }),
          ...(resolved.massDensity === undefined
            ? {}
            : { massDensity: resolved.massDensity }),
          ...(resolved.massDensitySource === undefined
            ? {}
            : { massDensitySource: resolved.massDensitySource }),
        },
      ],
    );
    outputs.set(
      selected.name,
      new EvaluatedPartV7(selected.name, owner, value),
    );
  }
  const evaluated = new EvaluatedPartDesignV7(
    owner,
    outputs,
    selectedConfigurationId,
    publicParameters,
    diagnostics,
  );
  const finalBoundary = partPostBoundaryFailure(options.signal);
  if (finalBoundary !== undefined) {
    return failAfterCleanup(finalBoundary);
  }
  if (transaction !== undefined) {
    for (
      let index = 0;
      index < solidGraph.value.createdShapeCount;
      index += 1
    ) {
      importedBodySetAddValue(
        transaction.ownedShapes,
        solidGraph.value.createdShapeList[index]!,
      );
    }
  }
  return success(evaluated, diagnostics);
}

/**
 * Executes one prepared native product batch with aggregate-retained kernel
 * access and one caller-owned cross-batch shape transaction.
 *
 * @internal
 */
export async function executePreparedProductGeometryOutputsV7(
  kernel: GeometryKernel,
  prepared: PreparedProductGeometryOutputsV7,
  retainedAccess: PreparedProductGeometryKernelAccessV7,
  resolvedResources?: ResolvedResourcesV7,
  shapeOwnershipTransaction?: PreparedPartShapeOwnershipTransactionV7,
): Promise<CadResult<EvaluatedProductGeometryDesignV7>> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return partRuntimeIntegrityFailure();
  }
  const state = preparedProductGeometryState(prepared);
  const retained =
    preparedProductGeometryKernelState(retainedAccess);
  const transactionState =
    shapeOwnershipTransaction === undefined
      ? undefined
      : preparedPartShapeOwnershipTransactionState(
          shapeOwnershipTransaction,
        );
  if (
    state === undefined ||
    retained === undefined ||
    retained.prepared !== prepared ||
    retained.kernel !== kernel ||
    (shapeOwnershipTransaction !== undefined &&
      (transactionState === undefined ||
        transactionState.kernel !== kernel))
  ) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Prepared product geometry access does not belong to this evaluation",
        {
          severity: "error",
          details: {
            phase: PART_EVALUATION_PHASE,
            preparedOwner: state !== undefined,
            accessOwner: retained !== undefined,
            preparedMatches: retained?.prepared === prepared,
            kernelMatches: retained?.kernel === kernel,
            shapeOwnershipTransactionOwner:
              shapeOwnershipTransaction === undefined ||
              transactionState !== undefined,
            shapeOwnershipTransactionKernelMatches:
              shapeOwnershipTransaction === undefined ||
              transactionState?.kernel === kernel,
          },
        },
      ),
    );
  }
  if (transactionState?.active === true) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Concurrent prepared product geometry transaction calls are unsupported",
        {
          severity: "error",
          details: {
            phase: PART_EVALUATION_PHASE,
            shapeOwnershipTransactionActive: true,
          },
        },
      ),
    );
  }
  if (transactionState !== undefined) {
    transactionState.active = true;
  }
  try {
    const {
      options,
      document,
      selectedOutputs,
      selectedConfigurationId,
      publicParameters,
      diagnostics,
      resolvedParts,
      expression,
    } = state;
    const solidGraph = await evaluateStagedSolidGraphV7({
      kernel,
      document,
      plan: state.solidGraph.plan,
      expression,
      resourceLimits: options.resourceLimits,
      ...(options.signal === undefined
        ? {}
        : { signal: options.signal }),
      diagnostics: PART_SOLID_DIAGNOSTICS,
      prepared: state.solidGraph,
      access: retained.access,
      ...(resolvedResources === undefined
        ? {}
        : { resolvedResources }),
      resourcesArePreResolved: true,
      ...(transactionState === undefined
        ? {}
        : {
            previouslyOwnedShapes:
              transactionState.ownedShapes,
          }),
    });
    const afterSolidGraph = partPostBoundaryFailure(options.signal);
    if (afterSolidGraph !== undefined) {
      if (solidGraph.ok) solidGraph.value.dispose();
      return afterSolidGraph;
    }
    if (!solidGraph.ok) return solidGraph;
    const kernelAccess = solidGraph.value.access;
    const failAfterCleanup = (
      result: CadResult<never>,
    ): CadResult<EvaluatedProductGeometryDesignV7> => {
      solidGraph.value.dispose();
      return partPostBoundaryFailure(options.signal) ?? result;
    };
    const beforeViews = partPostBoundaryFailure(options.signal);
    if (beforeViews !== undefined) {
      return failAfterCleanup(beforeViews);
    }
    let productOwner: EvaluationOwner | undefined;
    try {
      const owner = new EvaluationOwner(
        kernel,
        solidGraph.value.createdShapes,
        selectedConfigurationId,
      );
      captureEvaluationOwnerDocumentName(owner, document.name);
      productOwner = owner;
      captureEvaluationOwnerDisposer(
        owner,
        solidGraph.value.createdShapes,
        (shape) =>
          importedBodyApply<void>(
            kernelAccess.disposeShape,
            kernel,
            [shape],
          ),
      );
    const outputs =
      new ImportedBodyMap<
        string,
        EvaluatedProductGeometryOutputV7
      >();
    const canonical =
      new ImportedBodyMap<
        string,
        EvaluatedProductGeometryOutputV7
      >();
    for (
      let outputIndex = 0;
      outputIndex < selectedOutputs.length;
      outputIndex += 1
    ) {
      const selected = selectedOutputs[outputIndex]!;
      const definitionKey = `${selected.kind}\u0000${selected.nodeId}`;
      const retainedOutput = importedBodyMapGetValue(
        canonical,
        definitionKey,
      );
      let output: EvaluatedProductGeometryOutputV7;
      if (retainedOutput !== undefined) {
        output =
          retainedOutput.kind === "solid"
            ? importedBodyApply<EvaluatedProductGeometryOutputV7>(
                importedBodyObjectFreeze,
                Object,
                [
                  {
                    name: selected.name,
                    node: selected.nodeId,
                    kind: "solid",
                    solid: new StagedBodySetEvaluatedSolidV7(
                      selected.name,
                      owner,
                      importedBodyMapGetValue(
                        solidGraph.value.shapesByNode,
                        selected.nodeId,
                      )!,
                      kernelAccess,
                    ),
                  },
                ],
              )
            : retainedOutput.kind === "bodySet"
              ? importedBodyApply<EvaluatedProductGeometryOutputV7>(
                  importedBodyObjectFreeze,
                  Object,
                  [
                    {
                      name: selected.name,
                      node: selected.nodeId,
                      kind: "bodySet",
                      bodySet: new EvaluatedBodySetV7(
                        selected.name,
                        owner,
                        retainedOutput.bodySet.bodies,
                        retainedOutput.bodySet.representation,
                        retainedOutput.bodySet.exact,
                      ),
                    },
                  ],
                )
              : importedBodyApply<EvaluatedProductGeometryOutputV7>(
                  importedBodyObjectFreeze,
                  Object,
                  [
                    {
                      name: selected.name,
                      node: selected.nodeId,
                      kind: "part",
                      part: createProductPartAliasViewV7(
                        retainedOutput.part,
                        selected.name,
                      ),
                    },
                  ],
                );
      } else if (selected.kind === "solid") {
        output = importedBodyApply<EvaluatedProductGeometryOutputV7>(
          importedBodyObjectFreeze,
          Object,
          [
            {
              name: selected.name,
              node: selected.nodeId,
              kind: "solid",
              solid: new StagedBodySetEvaluatedSolidV7(
                selected.name,
                owner,
                importedBodyMapGetValue(
                  solidGraph.value.shapesByNode,
                  selected.nodeId,
                )!,
                kernelAccess,
              ),
            },
          ],
        );
      } else if (selected.kind === "bodySet") {
        const bodies: EvaluatedBodyV7[] = [];
        for (
          let bodyIndex = 0;
          bodyIndex < selected.node.bodies.length;
          bodyIndex += 1
        ) {
          const member = selected.node.bodies[bodyIndex]!;
          importedBodyArrayAppend(
            bodies,
            importedBodyApply<EvaluatedBodyV7>(
              importedBodyObjectFreeze,
              Object,
              [
                {
                  id: member.id,
                  node: member.solid.node,
                  ...(member.name === undefined
                    ? {}
                    : { name: member.name }),
                  ...(member.metadata === undefined
                    ? {}
                    : { metadata: member.metadata }),
                  solid: new StagedBodySetEvaluatedSolidV7(
                    member.name ?? member.id,
                    owner,
                    importedBodyMapGetValue(
                      solidGraph.value.shapesByNode,
                      member.solid.node,
                    )!,
                    kernelAccess,
                  ),
                },
              ],
            ),
          );
        }
        output = importedBodyApply<EvaluatedProductGeometryOutputV7>(
          importedBodyObjectFreeze,
          Object,
          [
            {
              name: selected.name,
              node: selected.nodeId,
              kind: "bodySet",
              bodySet: new EvaluatedBodySetV7(
                selected.name,
                owner,
                bodies,
                kernelAccess.representation,
                kernelAccess.exact,
              ),
            },
          ],
        );
      } else {
        let geometry: EvaluatedPartGeometryV7;
        if (selected.geometry.kind === "solid") {
          geometry = importedBodyApply<EvaluatedPartGeometryV7>(
            importedBodyObjectFreeze,
            Object,
            [
              {
                kind: "solid",
                node: selected.geometry.nodeId,
                solid: new StagedBodySetEvaluatedSolidV7(
                  selected.name,
                  owner,
                  importedBodyMapGetValue(
                    solidGraph.value.shapesByNode,
                    selected.geometry.nodeId,
                  )!,
                  kernelAccess,
                ),
              },
            ],
          );
        } else {
          const bodies: EvaluatedBodyV7[] = [];
          for (
            let bodyIndex = 0;
            bodyIndex < selected.geometry.node.bodies.length;
            bodyIndex += 1
          ) {
            const member =
              selected.geometry.node.bodies[bodyIndex]!;
            importedBodyArrayAppend(
              bodies,
              importedBodyApply<EvaluatedBodyV7>(
                importedBodyObjectFreeze,
                Object,
                [
                  {
                    id: member.id,
                    node: member.solid.node,
                    ...(member.name === undefined
                      ? {}
                      : { name: member.name }),
                    ...(member.metadata === undefined
                      ? {}
                      : { metadata: member.metadata }),
                    solid: new StagedBodySetEvaluatedSolidV7(
                      member.name ?? member.id,
                      owner,
                      importedBodyMapGetValue(
                        solidGraph.value.shapesByNode,
                        member.solid.node,
                      )!,
                      kernelAccess,
                    ),
                  },
                ],
              ),
            );
          }
          geometry = importedBodyApply<EvaluatedPartGeometryV7>(
            importedBodyObjectFreeze,
            Object,
            [
              {
                kind: "bodySet",
                node: selected.geometry.nodeId,
                bodySet: new EvaluatedBodySetV7(
                  selected.name,
                  owner,
                  bodies,
                  kernelAccess.representation,
                  kernelAccess.exact,
                  evaluatedPartBodySetDiagnosticIdentityV7(
                    selected.name,
                    selected.nodeId,
                  ),
                ),
              },
            ],
          );
        }
        const resolved = importedBodyMapGetValue(
          resolvedParts,
          selected.nodeId,
        )!;
        const partValue = importedBodyApply<EvaluatedPartValueV7>(
          importedBodyObjectFreeze,
          Object,
          [
            {
              node: selected.nodeId,
              kernelId: kernelAccess.id,
              definition: selected.node,
              geometry,
              representation: kernelAccess.representation,
              exact: kernelAccess.exact,
              ...(resolved.materialId === undefined
                ? {}
                : { materialId: resolved.materialId }),
              ...(resolved.materialDefinition === undefined
                ? {}
                : {
                    materialDefinition:
                      resolved.materialDefinition,
                  }),
              ...(resolved.massDensity === undefined
                ? {}
                : { massDensity: resolved.massDensity }),
              ...(resolved.massDensitySource === undefined
                ? {}
                : {
                    massDensitySource:
                      resolved.massDensitySource,
                  }),
            },
          ],
        );
        output = importedBodyApply<EvaluatedProductGeometryOutputV7>(
          importedBodyObjectFreeze,
          Object,
          [
            {
              name: selected.name,
              node: selected.nodeId,
              kind: "part",
              part: new EvaluatedPartV7(
                selected.name,
                owner,
                partValue,
              ),
            },
          ],
        );
      }
      if (retainedOutput === undefined) {
        importedBodyMapSetValue(canonical, definitionKey, output);
      }
      importedBodyMapSetValue(outputs, selected.name, output);
    }
    const evaluated = new EvaluatedProductGeometryDesignV7(
      owner,
      outputs,
      selectedConfigurationId,
      publicParameters,
      diagnostics,
    );
    const finalBoundary = partPostBoundaryFailure(options.signal);
    if (finalBoundary !== undefined) {
      try {
        owner.dispose();
      } catch {
        // The structured boundary failure remains authoritative.
      }
      return partPostBoundaryFailure(options.signal) ?? finalBoundary;
    }
    if (transactionState !== undefined) {
      for (
        let index = 0;
        index < solidGraph.value.createdShapeCount;
        index += 1
      ) {
        importedBodySetAddValue(
          transactionState.ownedShapes,
          solidGraph.value.createdShapeList[index]!,
        );
      }
    }
      return success(evaluated, diagnostics);
    } catch (error) {
      try {
        if (productOwner === undefined) {
          solidGraph.value.dispose();
        } else {
          productOwner.dispose();
        }
      } catch {
        // Preserve the structured late-construction failure.
      }
      const boundary = partPostBoundaryFailure(options.signal);
      return (
        boundary ??
        failure(
          diagnostic(
            "KERNEL_ERROR",
            "Product geometry result construction failed after shape acquisition",
            {
              severity: "error",
              details: {
                phase: PART_EVALUATION_PHASE,
                lateResultConstruction: true,
                cause: safeErrorMessage(
                  error,
                  "Product geometry result construction failed with an opaque value",
                ),
              },
            },
          ),
        )
      );
    }
  } finally {
    if (transactionState !== undefined) {
      transactionState.active = false;
    }
  }
}

/**
 * Evaluates direct document-v7 `part` outputs whose geometry references a
 * bounded admitted solid graph or a directly supported body set.
 *
 * This behavior-compatible convenience boundary prepares all document work,
 * retains one kernel preflight, resolves verified resources, and then executes
 * without observing kernel capabilities a second time.
 *
 * @internal
 */
export async function evaluatePartOutputsV7(
  kernel: GeometryKernel,
  inputDocument: DesignDocumentV7,
  inputOptions: EvaluatePartOutputsV7Options = {},
): Promise<CadResult<EvaluatedPartDesignV7>> {
  const prepared = preparePartOutputsV7(inputDocument, inputOptions);
  if (!prepared.ok) return prepared;
  const retained = preflightPreparedPartOutputsV7(kernel, prepared.value);
  if (!retained.ok) return retained;
  const state = preparedPartState(prepared.value);
  if (state === undefined) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Prepared part evaluation lost its owned state",
        {
          severity: "error",
          details: {
            phase: PART_EVALUATION_PHASE,
            preparedOwner: false,
          },
        },
      ),
    );
  }

  let resolvedResources: ResolvedResourcesV7 | undefined;
  if (prepared.value.resourceIds.length > 0) {
    const resolved = await resolveResourcesV7(
      state.document.resources ?? {},
      prepared.value.resourceIds,
      {
        ...(state.options.resolver === undefined
          ? {}
          : { resolver: state.options.resolver }),
        limits: state.options.resourceLimits,
        ...(state.options.signal === undefined
          ? {}
          : { signal: state.options.signal }),
      },
    );
    const afterResources = partPostBoundaryFailure(state.options.signal);
    if (afterResources !== undefined) return afterResources;
    if (!resolved.ok) return resolved;
    resolvedResources = resolved.value;
  }
  return executePreparedPartOutputsV7(
    kernel,
    prepared.value,
    retained.value,
    resolvedResources,
  );
}

export class Evaluator {
  readonly kernel: GeometryKernel;
  readonly sketchSolver: SketchSolverBackend;
  #disposed = false;
  #artifactCacheEvaluationActive = false;

  constructor(kernel: GeometryKernel, sketchSolver: SketchSolverBackend) {
    this.kernel = kernel;
    this.sketchSolver = sketchSolver;
  }

  async evaluate(
    document: DesignDocument,
    options: EvaluationOptions = {},
  ): Promise<CadResult<EvaluatedDesign>> {
    if (this.#disposed) throw new Error("This evaluator has been disposed");
    const artifactCache =
      getEvaluatorArtifactCacheCandidateBinding(this);
    if (artifactCache === undefined) {
      return this.#evaluateOnce(document, options);
    }
    if (this.#artifactCacheEvaluationActive) {
      throw new Error(
        "Private artifact-cache evaluations cannot overlap on one evaluator",
      );
    }
    this.#artifactCacheEvaluationActive = true;
    try {
      return await this.#evaluateOnce(document, options, artifactCache);
    } finally {
      this.#artifactCacheEvaluationActive = false;
    }
  }

  async #evaluateOnce(
    inputDocument: DesignDocument,
    inputOptions: EvaluationOptions,
    artifactCache?: EvaluatorArtifactCacheCandidateBinding,
  ): Promise<CadResult<EvaluatedDesign>> {
    let document = inputDocument;
    let options = inputOptions;
    if (artifactCache !== undefined) {
      const parsed = parseDocumentValue(inputDocument);
      if (!parsed.ok) return parsed;
      const capturedOptions = snapshotPrivateEvaluationOptions(inputOptions);
      if (!capturedOptions.ok) return capturedOptions;
      document = parsed.value;
      options = capturedOptions.value;
    }
    if (
      (this.kernel.capabilities.protocolVersion as number) !==
      GEOMETRY_KERNEL_PROTOCOL_VERSION
    ) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            "KERNEL_CAPABILITY_MISSING",
            `Kernel '${this.kernel.id}' uses unsupported protocol version ${this.kernel.capabilities.protocolVersion}`,
            {
              severity: "error",
              details: {
                kernel: this.kernel.id,
                expected: GEOMETRY_KERNEL_PROTOCOL_VERSION,
                actual: this.kernel.capabilities.protocolVersion,
              },
            },
          ),
        ],
      };
    }
    const validation = validateDocument(document);
    if (!validation.ok) return validation;
    let selectedConfigurationId: ConfigurationId | null = null;
    let selectedConfiguration: DesignConfigurationIR | undefined;
    if (options.configuration !== undefined) {
      if (!Object.hasOwn(document.configurations ?? {}, options.configuration)) {
        return failure(
          diagnostic(
            "CONFIGURATION_MISSING",
            `Unknown configuration '${options.configuration}'`,
            {
              severity: "error",
              path: `/configurations/${options.configuration}`,
              details: {
                available: Object.keys(document.configurations ?? {}).sort(),
              },
            },
          ),
        );
      }
      selectedConfigurationId = options.configuration as ConfigurationId;
      selectedConfiguration =
        document.configurations![selectedConfigurationId];
    }
    const parameterResult = resolveEvaluationParameters(
      document,
      options.parameters ?? {},
      selectedConfigurationId,
      selectedConfiguration,
    );
    if (!parameterResult.ok) return parameterResult;
    const diagnostics: Diagnostic[] = [
      ...validation.diagnostics,
      ...parameterResult.diagnostics,
    ];
    const parameterValues = parameterResult.value.values;
    const expression = (value: ExpressionIR): number =>
      evaluateExpression(value, {
        resolveParameter: (id) => {
          const resolved = parameterValues.get(id);
          if (resolved === undefined) throw new Error(`Unresolved parameter '${id}'`);
          return resolved;
        },
      });
    const resolvedMaterials = new Map<MaterialId, EvaluatedMaterial>();
    for (const [id, definition] of Object.entries(document.materials ?? {}) as [
      MaterialId,
      MaterialDefinitionIR,
    ][]) {
      let massDensity: number;
      try {
        massDensity = expression(definition.massDensity);
      } catch (error) {
        diagnostics.push(
          diagnostic(
            "MASS_DENSITY_INVALID",
            `Material '${id}' massDensity must evaluate to a finite, strictly positive number`,
            {
              severity: "error",
              path: `/materials/${id}/massDensity`,
              details: {
                cause: error instanceof Error ? error.message : String(error),
              },
            },
          ),
        );
        continue;
      }
      if (!Number.isFinite(massDensity) || !(massDensity > 0)) {
        diagnostics.push(
          diagnostic(
            "MASS_DENSITY_INVALID",
            `Material '${id}' massDensity must be finite and strictly positive`,
            {
              severity: "error",
              path: `/materials/${id}/massDensity`,
              details: { value: massDensity },
            },
          ),
        );
        continue;
      }
      resolvedMaterials.set(
        id,
        Object.freeze({
          id,
          name: definition.name,
          ...(definition.description === undefined
            ? {}
            : { description: definition.description }),
          massDensity,
          ...(definition.metadata === undefined
            ? {}
            : { metadata: definition.metadata }),
        }),
      );
    }
    if (hasErrors(diagnostics)) return { ok: false, diagnostics };
    const configuredPartMaterial = (id: NodeId): MaterialId | undefined => {
      const overrides = selectedConfiguration?.partMaterialOverrides;
      return overrides !== undefined && Object.hasOwn(overrides, id)
        ? overrides[id]
        : undefined;
    };
    const configuredInstanceSuppression = (
      assembly: NodeId,
      instance: EntityId,
    ): boolean | undefined => {
      const assemblies = selectedConfiguration?.instanceSuppressions;
      if (assemblies === undefined || !Object.hasOwn(assemblies, assembly)) {
        return undefined;
      }
      const instances = assemblies[assembly]!;
      return Object.hasOwn(instances, instance)
        ? instances[instance]
        : undefined;
    };
    const resolvedTransform = (
      operation: TransformOperationIR,
    ): ResolvedTransformOperation => {
      if (operation.kind === "mirror") {
        return {
          kind: "mirror",
          normal: operation.normal.map(expression) as unknown as Vec3,
        };
      }
      return {
        kind: operation.kind,
        value: operation.value.map(expression) as unknown as Vec3,
      } as ResolvedTransformOperation;
    };
    const cache = new Map<NodeId, NodeValue>();
    const createdShapes = new Set<KernelShape>();
    const ensureLive = (): void => {
      if (options.signal?.aborted) {
        throw new EvaluationFailure(
          diagnostic("EVALUATION_ABORTED", "CAD evaluation was aborted", {
            severity: "error",
          }),
        );
      }
    };
    const ownShape = (shape: KernelShape, id: NodeId): SolidValue => {
      createdShapes.add(shape);
      const status = this.kernel.status(shape);
      if (!status.ok) {
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_ERROR",
            status.message ?? `Kernel failed with status ${status.code}`,
            {
            severity: "error",
            node: id,
            path: `/nodes/${id}`,
              details: { kernel: this.kernel.id, status: status.code },
            },
          ),
        );
      }
      const measured = this.kernel.measure(shape);
      if (measured.volume <= 1e-12) {
        const emptyDiagnostic = diagnostic("EMPTY_RESULT", `Feature '${id}' is empty`, {
          severity: options.allowEmpty ? "warning" : "error",
          node: id,
          path: `/nodes/${id}`,
        });
        diagnostics.push(emptyDiagnostic);
        if (!options.allowEmpty) throw new EvaluationFailure(emptyDiagnostic);
      }
      return { kind: "solid", shape };
    };
    const requireKernelCapability = (
      kind: Exclude<
        KernelCapabilityKind,
        | "compositeSweepRefinement"
        | "exactIndexedTopologyEvolution"
        | "measurement"
      >,
      capability: KernelPrimitive | KernelFeature | KernelExchangeFormat,
      id: NodeId,
    ): void => {
      const supported =
        kind === "primitive"
          ? kernelSupports(
              this.kernel.capabilities,
              "primitive",
              capability as KernelPrimitive,
            )
          : kind === "feature"
            ? kernelSupports(
                this.kernel.capabilities,
                "feature",
                capability as KernelFeature,
              )
            : kernelSupports(
                this.kernel.capabilities,
                kind,
                capability as KernelExchangeFormat,
              );
      if (!supported) {
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_CAPABILITY_MISSING",
            `Kernel '${this.kernel.id}' does not support ${kind} '${capability}'`,
            {
              severity: "error",
              node: id,
              path: `/nodes/${id}`,
              hints: ["Choose a compatible geometry kernel for this design"],
              details: { kernel: this.kernel.id, kind, capability },
            },
          ),
        );
      }
      const implementation = this.kernel[
        capability as keyof GeometryKernel
      ];
      if (typeof implementation !== "function") {
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_ERROR",
            `Kernel '${this.kernel.id}' declares ${kind} '${capability}' without implementing it`,
            {
              severity: "error",
              node: id,
              path: `/nodes/${id}`,
              details: {
                kernel: this.kernel.id,
                kind,
                capability,
                protocolViolation: true,
              },
            },
          ),
        );
      }
    };
    const requireExactIndexedTopologyEvolution = (
      capability: KernelFeature,
      id: NodeId,
      optional = false,
    ): boolean => {
      const kind = "exactIndexedTopologyEvolution" as const;
      const raw: unknown = this.kernel.capabilities.exactIndexedTopologyEvolution;
      const capabilityDetails = {
        kernel: this.kernel.id,
        kind,
        capability,
      } as const;
      if (raw === undefined) {
        if (optional) return false;
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_CAPABILITY_MISSING",
            `Kernel '${this.kernel.id}' does not support exact indexed topology evolution for feature '${capability}'`,
            {
              severity: "error",
              node: id,
              path: `/nodes/${id}`,
              hints: ["Choose an exact geometry kernel with indexed topology history"],
              details: {
                ...capabilityDetails,
                protocolVersion:
                  EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
              },
            },
          ),
        );
      }

      const protocolViolation = (
        reason: string,
        details: Readonly<Record<string, unknown>> = {},
      ): never => {
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_ERROR",
            `Kernel '${this.kernel.id}' declares malformed exact indexed topology evolution metadata`,
            {
              severity: "error",
              node: id,
              path: `/nodes/${id}`,
              details: {
                ...capabilityDetails,
                protocolViolation: true,
                reason,
                ...details,
              },
            },
          ),
        );
      };
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        protocolViolation("capability metadata must be an object");
      }
      const metadata = raw as {
        readonly protocolVersion?: unknown;
        readonly features?: unknown;
      };
      if (
        metadata.protocolVersion !==
        EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION
      ) {
        protocolViolation("unsupported protocol version", {
          expectedProtocolVersion:
            EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
          actualProtocolVersion: metadata.protocolVersion,
        });
      }
      const rawFeatures = metadata.features;
      if (!Array.isArray(rawFeatures)) {
        protocolViolation("features must be an array of feature names");
      }
      const exactFeatures = Array.from(rawFeatures as readonly unknown[]);
      if (exactFeatures.some((feature) => typeof feature !== "string")) {
        protocolViolation("features must be a dense array of feature names");
      }
      const exactFeatureNames = exactFeatures as readonly string[];
      if (new Set(exactFeatureNames).size !== exactFeatureNames.length) {
        protocolViolation("features must not contain duplicates");
      }
      const undeclared = exactFeatureNames.filter(
        (feature) =>
          !(this.kernel.capabilities.features as readonly string[]).includes(
            feature,
          ),
      );
      if (undeclared.length > 0) {
        protocolViolation("exact evolution features must be declared kernel features", {
          undeclared,
        });
      }
      if (!this.kernel.capabilities.exact) {
        protocolViolation("exact evolution requires an exact kernel");
      }
      if (
        !kernelSupports(
          this.kernel.capabilities,
          "exactIndexedTopologyEvolution",
          capability,
        )
      ) {
        if (optional) return false;
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_CAPABILITY_MISSING",
            `Kernel '${this.kernel.id}' does not support exact indexed topology evolution for feature '${capability}'`,
            {
              severity: "error",
              node: id,
              path: `/nodes/${id}`,
              hints: ["Choose an exact geometry kernel with indexed topology history"],
              details: {
                ...capabilityDetails,
                protocolVersion:
                  EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
              },
            },
          ),
        );
      }

      if (
        capability === "draft" ||
        capability === "boolean" ||
        capability === "fillet" ||
        capability === "chamfer" ||
        capability === "shell" ||
        capability === "offset"
      ) {
        const topology: unknown = this.kernel.capabilities.topology;
        const topologyProvenance = (
          topology as { readonly provenance?: unknown } | undefined
        )?.provenance;
        if (
          typeof topology !== "object" ||
          topology === null ||
          !Array.isArray((topology as { readonly kinds?: unknown }).kinds) ||
          !(topology as { readonly kinds: readonly unknown[] }).kinds.includes(
            "face",
          ) ||
          !(topology as { readonly kinds: readonly unknown[] }).kinds.includes(
            "edge",
          ) ||
          !(topology as { readonly kinds: readonly unknown[] }).kinds.includes(
            "vertex",
          ) ||
          (topologyProvenance !== "feature" &&
            topologyProvenance !== "history") ||
          typeof this.kernel.topology !== "function"
        ) {
          protocolViolation(
            `${capability} evolution requires face, edge, and vertex topology with feature-or-history provenance`,
            {
              requiredTopologyKinds: ["face", "edge", "vertex"],
              requiredTopologyProvenance: "feature-or-history",
            },
          );
        }
      }
      return true;
    };
    const requireCompositeSweepRefinements = (
      classification: CompositeSweepRefinementClassificationSuccess,
      id: NodeId,
    ): void => {
      if (classification.requiredRefinements.length === 0) return;

      const kind = "compositeSweepRefinement" as const;
      const inspection = inspectKernelCompositeSweepCapabilities(
        this.kernel.capabilities,
      );
      const requiredRefinements = classification.requiredRefinements;
      const capability = requiredRefinements[0]!;
      const sharedDetails = {
        kernel: this.kernel.id,
        kind,
        capability,
        protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
        requiredRefinements,
        evidence: classification.evidence,
      } as const;

      if (inspection.status === "malformed") {
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_ERROR",
            `Kernel '${this.kernel.id}' declares malformed composite-sweep refinement metadata`,
            {
              severity: "error",
              node: id,
              path: `/nodes/${id}`,
              details: {
                ...sharedDetails,
                protocolViolation: true,
                reason: inspection.reason,
                ...inspection.details,
              },
            },
          ),
        );
      }

      const advertised: readonly KernelCompositeSweepRefinement[] =
        inspection.status === "valid"
          ? inspection.capabilities.refinements
          : [];
      const missingRefinements = requiredRefinements.filter(
        (refinement) => !advertised.includes(refinement),
      );
      if (missingRefinements.length === 0) return;

      throw new EvaluationFailure(
        diagnostic(
          "KERNEL_CAPABILITY_MISSING",
          `Kernel '${this.kernel.id}' does not support composite-sweep refinement '${missingRefinements[0]}'`,
          {
            severity: "error",
            node: id,
            path: `/nodes/${id}`,
            hints: [
              "Choose a geometry kernel whose composite-sweep refinements cover this design",
            ],
            details: {
              ...sharedDetails,
              capability: missingRefinements[0],
              advertisedRefinements: advertised,
              missingRefinements,
            },
          },
        ),
      );
    };
    const featureContext = (id: NodeId): KernelFeatureContext => ({
      feature: id,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const positive = (value: number, id: NodeId, field: string): number => {
      if (!(value > 0)) {
        throw new EvaluationFailure(
          diagnostic("FEATURE_INVALID", `${field} must be positive`, {
            severity: "error",
            node: id,
            path: `/nodes/${id}/${field}`,
            details: { value },
          }),
        );
      }
      return value;
    };
    const artifactSession: ArtifactCacheSession | undefined =
      artifactCache?.createSession();
    const artifactSessionAccess = artifactSession === undefined
      ? undefined
      : getArtifactCacheSessionInternalAccess(artifactSession);
    const effectiveParameterOverrides = Object.freeze(
      Object.fromEntries(parameterValues),
    );
    let featureHashReport:
      | ReturnType<typeof hashDesignFeatures>
      | undefined;
    let featureHashEntries:
      | ReadonlyMap<string, DesignFeatureHashEntry>
      | undefined;
    const throwCacheFailure = (
      result: CadResult<unknown>,
      fallback: string,
      id: NodeId,
    ): never => {
      if (result.ok) {
        throw new EvaluationFailure(
          diagnostic("ARTIFACT_CACHE_OPERATION_FAILED", fallback, {
            severity: "error",
            node: id,
          }),
        );
      }
      const items = result.diagnostics.length > 0
        ? result.diagnostics
        : [
            diagnostic("ARTIFACT_CACHE_OPERATION_FAILED", fallback, {
              severity: "error",
              node: id,
            }),
          ];
      for (const item of items) {
        if (!diagnostics.includes(item)) diagnostics.push(item);
      }
      throw new EvaluationFailure(items[0]!);
    };
    const featureEntry = async (
      id: NodeId,
    ): Promise<DesignFeatureHashEntry> => {
      featureHashReport ??= hashDesignFeatures(document, {
        ...(options.configuration === undefined
          ? {}
          : { configuration: options.configuration }),
        parameters: effectiveParameterOverrides,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      const report = await featureHashReport;
      ensureLive();
      if (!report.ok) {
        return throwCacheFailure(
          report,
          "Feature hashing for artifact caching failed",
          id,
        );
      }
      featureHashEntries ??= new Map(
        report.value.nodes.map((candidate) => [candidate.node, candidate]),
      );
      const entry = featureHashEntries.get(id);
      if (entry === undefined || entry.kind !== "box") {
        throw new EvaluationFailure(
          diagnostic(
            "ARTIFACT_CACHE_ENTRY_INVALID",
            `Feature-hash report entry '${id}' is not an eligible box`,
            { severity: "error", node: id },
          ),
        );
      }
      return entry;
    };
    const registerAcquiredShape = (
      shape: KernelShape,
      id: NodeId,
    ): void => {
      if (createdShapes.has(shape)) {
        throw new EvaluationFailure(
          diagnostic(
            "ARTIFACT_CACHE_ENTRY_INVALID",
            `Shape-artifact decode for '${id}' did not return a fresh shape`,
            {
              severity: "error",
              node: id,
              details: { kernel: this.kernel.id },
            },
          ),
        );
      }
      createdShapes.add(shape);
    };
    const cacheKeyForBox = async (
      id: NodeId,
    ): Promise<KernelShapeArtifactCacheKey | undefined> => {
      if (artifactCache === undefined) {
        throw new Error("Private evaluator artifact cache is unavailable");
      }
      const key = await createKernelShapeArtifactCacheKeyForCandidate(
        await featureEntry(id),
        this.kernel.id,
        artifactCache.artifact,
        this.sketchSolver,
      );
      ensureLive();
      if (!key.ok) {
        if (key.diagnostics[0]?.code === "ARTIFACT_CACHE_ENTRY_INVALID") {
          return undefined;
        }
        return throwCacheFailure(key, "Artifact cache key creation failed", id);
      }
      return key.value;
    };
    const decodeFailureResult = (
      id: NodeId,
      key: KernelShapeArtifactCacheKey,
      error: unknown,
    ): CadResult<never> =>
      failure(
        diagnostic(
          "ARTIFACT_CACHE_ENTRY_INVALID",
          safeErrorMessage(
            error,
            `Cached shape artifact for '${id}' could not be decoded`,
          ),
          {
            severity: "error",
            node: id,
            details: { operation: "decode", key: key.key },
          },
        ),
      );
    const prepareDirectCachedBox = async (
      id: NodeId,
      node: Extract<NodeIR, { readonly kind: "box" }>,
    ): Promise<void> => {
      if (artifactCache === undefined || cache.has(id)) return;
      // Match evaluateNode's cancellation precedence before capability,
      // expression, or cache validation.
      ensureLive();
      if (artifactSession === undefined || artifactSessionAccess === undefined) {
        throw new EvaluationFailure(
          diagnostic(
            "ARTIFACT_CACHE_OPERATION_FAILED",
            "Private evaluator-cache session coordination is unavailable",
            { severity: "error", node: id },
          ),
        );
      }

      // Preserve the ordinary evaluator order before touching the cache.
      requireKernelCapability("primitive", "box", id);
      const size = node.size.map((value, index) =>
        positive(expression(value), id, `size/${index}`),
      ) as unknown as Vec3;
      const context = featureContext(id);
      const key = await cacheKeyForBox(id);
      if (key === undefined) {
        ensureLive();
        const uncached = this.kernel.box!(size, node.center, context);
        registerAcquiredShape(uncached, id);
        ensureLive();
        cache.set(id, ownShape(uncached, id));
        return;
      }
      const read = await artifactSession.read(key, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      ensureLive();

      let shouldWrite = false;
      let shape: KernelShape | undefined;
      if (!read.ok) {
        if (
          read.diagnostics[0]?.code !== "ARTIFACT_CACHE_ENTRY_INVALID" ||
          artifactSession.mode !== "read-write"
        ) {
          throwCacheFailure(read, "Artifact cache read failed", id);
        }
        const deleted = await artifactSession.delete(key, {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        ensureLive();
        if (!deleted.ok) {
          throwCacheFailure(deleted, "Invalid artifact eviction failed", id);
        }
        shouldWrite = true;
      } else if (read.value.status === "hit") {
        try {
          shape = await artifactCache.codec.decodeShapeArtifact(
            read.value.record.payload,
            {
              feature: id,
              maxArtifactBytes: read.value.record.payload.byteLength,
              ...(options.signal === undefined
                ? {}
                : { signal: options.signal }),
            },
          );
          registerAcquiredShape(shape, id);
          ensureLive();
        } catch (error) {
          ensureLive();
          if (error instanceof DOMException && error.name === "AbortError") {
            throw new EvaluationFailure(
              diagnostic("EVALUATION_ABORTED", "CAD evaluation was aborted", {
                severity: "error",
                node: id,
              }),
            );
          }
          const invalid = decodeFailureResult(id, key, error);
          artifactSessionAccess.reportCodecFailure(
            "decode",
            key,
            invalid,
          );
          shape = undefined;
          if (artifactSession.mode !== "read-write") {
            throwCacheFailure(invalid, "Shape-artifact decode failed", id);
          }
          const deleted = await artifactSession.delete(key, {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          ensureLive();
          if (!deleted.ok) {
            throwCacheFailure(deleted, "Invalid artifact eviction failed", id);
          }
          shouldWrite = true;
        }
      } else {
        shouldWrite = artifactSession.mode !== "read-only";
      }

      if (shape === undefined) {
        ensureLive();
        shape = this.kernel.box!(size, node.center, context);
        registerAcquiredShape(shape, id);
        ensureLive();
      }
      const value = ownShape(shape, id);
      cache.set(id, value);
      if (shouldWrite) {
        const written = await artifactSessionAccess.encodeAndWrite(
          key,
          {
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          },
          async (maxArtifactBytes, limitExceeded) => {
            try {
              return await artifactCache.codec.encodeShapeArtifact(shape, {
                feature: id,
                maxArtifactBytes,
                ...(options.signal === undefined
                  ? {}
                  : { signal: options.signal }),
              });
            } catch (error) {
              const actual = artifactCache.limitRefusalActual(
                error,
                maxArtifactBytes,
              );
              if (actual !== undefined) limitExceeded(actual);
              throw error;
            }
          },
        );
        ensureLive();
        if (!written.ok) {
          throwCacheFailure(written, "Shape-artifact cache write failed", id);
        }
      }
    };
    const resolvedDraftNumber = (
      value: ExpressionIR,
      id: NodeId,
      path: string,
      label: string,
    ): number => {
      let resolved: number;
      try {
        resolved = expression(value);
      } catch (error) {
        throw new EvaluationFailure(
          diagnostic("FEATURE_INVALID", `${label} must evaluate to a finite number`, {
            severity: "error",
            node: id,
            path: `/nodes/${id}/${path}`,
            details: {
              cause: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      }
      if (!Number.isFinite(resolved)) {
        throw new EvaluationFailure(
          diagnostic("FEATURE_INVALID", `${label} must be finite`, {
            severity: "error",
            node: id,
            path: `/nodes/${id}/${path}`,
            details: { value: resolved },
          }),
        );
      }
      return resolved;
    };
    const resolvedDraftVector = (
      values: readonly [ExpressionIR, ExpressionIR, ExpressionIR],
      id: NodeId,
      path: string,
      label: string,
      nonzero: boolean,
    ): Vec3 => {
      const resolved = values.map((value, index) =>
        resolvedDraftNumber(value, id, `${path}/${index}`, `${label} component`),
      ) as unknown as Vec3;
      if (nonzero && !resolved.some((component) => component !== 0)) {
        throw new EvaluationFailure(
          diagnostic("FEATURE_INVALID", `${label} must be nonzero`, {
            severity: "error",
            node: id,
            path: `/nodes/${id}/${path}`,
            details: { value: resolved },
          }),
        );
      }
      return resolved;
    };
    const resolveSelectedTopology = <K extends TopologyKind>(
      id: NodeId,
      field: string,
      selection: TopologySelectionIR<K>,
      inputNode: NodeId,
      resolveInput: () => KernelShape,
    ): {
      readonly input: KernelShape;
      readonly keys: readonly KernelTopologyKey[];
    } => {
      const path = `/nodes/${id}/${field}`;
      if (!kernelSupportsTopology(this.kernel)) {
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_CAPABILITY_MISSING",
            `Kernel '${this.kernel.id}' cannot resolve topology selections`,
            {
              severity: "error",
              node: id,
              path,
              hints: ["Choose a geometry kernel with persistent topology support"],
              details: {
                kernel: this.kernel.id,
                kind: "topology",
                capability: `${selection.topology}-selection`,
              },
            },
          ),
        );
      }
      const topologyCapabilities = this.kernel.capabilities.topology;
      const requirements = topologySelectionRequirements(selection);
      const missingTopologyCapabilities = [
        ...requirements.kinds
          .filter((kind) => !topologyCapabilities.kinds.includes(kind))
          .map((kind) => `${kind}-topology`),
        ...(requirements.provenance && topologyCapabilities.provenance === "none"
          ? ["feature-provenance"]
          : []),
        ...(requirements.semanticRoles && !topologyCapabilities.semanticRoles
          ? ["semantic-roles"]
          : []),
        ...(requirements.sketchSources && !topologyCapabilities.sketchSources
          ? ["sketch-sources"]
          : []),
        ...(requirements.geometry && !topologyCapabilities.geometry
          ? ["topology-geometry"]
          : []),
        ...(requirements.adjacency && !topologyCapabilities.adjacency
          ? ["topology-adjacency"]
          : []),
      ];
      if (missingTopologyCapabilities.length > 0) {
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_CAPABILITY_MISSING",
            `Kernel '${this.kernel.id}' cannot satisfy this topology selector`,
            {
              severity: "error",
              node: id,
              path,
              details: {
                kernel: this.kernel.id,
                kind: "topology",
                missing: missingTopologyCapabilities,
              },
            },
          ),
        );
      }
      let persistent: TopologyResolutionContext["persistent"];
      if (requirements.persistentReferences.length > 0) {
        const signatureCapabilities = inspectTopologySignatureCapabilities(
          topologyCapabilities.signatures,
          topologyCapabilities.signatureProfiles,
        );
        if (signatureCapabilities.status === "missing") {
          throw new EvaluationFailure(
            diagnostic(
              "KERNEL_CAPABILITY_MISSING",
              `Kernel '${this.kernel.id}' does not declare persistent topology signature compatibility`,
              {
                severity: "error",
                node: id,
                path,
                hints: [
                  "Use a kernel that declares an exact topology signature protocol and fingerprint",
                ],
                details: {
                  kernel: this.kernel.id,
                  kind: "topology",
                  capability: "persistent-topology-signatures",
                },
              },
            ),
          );
        }
        if (signatureCapabilities.status === "invalid") {
          throw new EvaluationFailure(
            diagnostic(
              "KERNEL_ERROR",
              `Kernel '${this.kernel.id}' declares malformed persistent topology signature capabilities`,
              {
                severity: "error",
                node: id,
                path,
                details: {
                  kernel: this.kernel.id,
                  kind: "topology",
                  protocolViolation: true,
                  expectedProtocolVersions: [
                    TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1,
                    TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2,
                  ],
                },
              },
            ),
          );
        }
        if (
          signatureCapabilities.value.some(
            (profile) =>
              profile.protocolVersion ===
              TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2,
          ) &&
          (["face", "edge", "vertex"] as const).some(
            (kind) => !topologyCapabilities.kinds.includes(kind),
          )
        ) {
          throw new EvaluationFailure(
            diagnostic(
              "KERNEL_ERROR",
              `Kernel '${this.kernel.id}' declares topology-signature protocol v2 without the complete vertex topology graph`,
              {
                severity: "error",
                node: id,
                path,
                details: {
                  kernel: this.kernel.id,
                  kind: "topology",
                  protocolViolation: true,
                  requiredTopologyKinds: ["face", "edge", "vertex"],
                },
              },
            ),
          );
        }
        const registry =
          document.version === DOCUMENT_VERSION_V2 ||
          document.version === DOCUMENT_VERSION_V3 ||
          document.version === DOCUMENT_VERSION_V4 ||
          document.version === DOCUMENT_VERSION_V5 ||
          document.version === DOCUMENT_VERSION_V6
            ? document.topologyReferences
            : undefined;
        if (registry === undefined) {
          throw new EvaluationFailure(
            diagnostic(
              "REFERENCE_MISSING",
              "Persistent topology selector has no document-owned reference registry",
              { severity: "error", node: id, path },
            ),
          );
        }
        for (const referenceId of requirements.persistentReferences) {
          const entry = Object.hasOwn(registry, referenceId)
            ? registry[referenceId]
            : undefined;
          if (entry === undefined) {
            throw new EvaluationFailure(
              diagnostic(
                "REFERENCE_MISSING",
                `Persistent topology reference '${referenceId}' is missing`,
                {
                  severity: "error",
                  node: id,
                  path,
                  details: { reference: referenceId },
                },
              ),
            );
          }
          if (entry.target.node !== inputNode) {
            throw new EvaluationFailure(
              diagnostic(
                "TOPOLOGY_SELECTOR_INVALID",
                `Persistent topology reference '${referenceId}' targets '${entry.target.node}', not this feature's direct input '${inputNode}'`,
                {
                  severity: "error",
                  node: id,
                  path,
                  details: {
                    reference: referenceId,
                    expectedTarget: inputNode,
                    actualTarget: entry.target.node,
                  },
                },
              ),
            );
          }
          const compatibleProfile = signatureCapabilities.value.find(
            (profile) =>
              entry.variants.some(
                (variant) =>
                  variant.protocolVersion === profile.protocolVersion &&
                  variant.kernelFingerprint === profile.fingerprint,
              ),
          );
          if (compatibleProfile === undefined) {
            throw new EvaluationFailure(
              diagnostic(
                "TOPOLOGY_FINGERPRINT_MISMATCH",
                `Persistent topology reference '${referenceId}' has no variant for kernel '${this.kernel.id}'`,
                {
                  severity: "error",
                  node: id,
                  path,
                  details: {
                    reference: referenceId,
                    kernel: this.kernel.id,
                    profiles: signatureCapabilities.value,
                    available: entry.variants
                      .map((variant) => ({
                        protocolVersion: variant.protocolVersion,
                        kernelFingerprint: variant.kernelFingerprint,
                      }))
                      .sort((first, second) =>
                        first.kernelFingerprint.localeCompare(
                          second.kernelFingerprint,
                        ),
                      ),
                  },
                },
              ),
            );
          }
          const requiredKinds: readonly TopologyKind[] =
            compatibleProfile.protocolVersion ===
            TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1
              ? ["face", "edge"]
              : entry.topology === "edge"
                ? ["face", "edge", "vertex"]
                : entry.topology === "face"
                  ? ["face", "edge"]
                  : ["edge", "vertex"];
          const missingKinds = requiredKinds.filter(
            (kind) => !topologyCapabilities.kinds.includes(kind),
          );
          if (missingKinds.length > 0) {
            throw new EvaluationFailure(
              diagnostic(
                "KERNEL_CAPABILITY_MISSING",
                `Kernel '${this.kernel.id}' cannot resolve persistent topology reference '${referenceId}'`,
                {
                  severity: "error",
                  node: id,
                  path,
                  details: {
                    kernel: this.kernel.id,
                    kind: "topology",
                    reference: referenceId,
                    missing: missingKinds.map((kind) => `${kind}-topology`),
                  },
                },
              ),
            );
          }
        }
        persistent = {
          registry,
          input: inputNode,
          capabilities: signatureCapabilities.value,
          ...(options.topologySignatureLimits === undefined
            ? {}
            : { limits: options.topologySignatureLimits }),
        };
      }
      ensureLive();
      const input = resolveInput();
      ensureLive();
      let snapshot: KernelTopologySnapshot;
      try {
        snapshot = this.kernel.topology(input);
      } catch (error) {
        // Cancellation wins over an extraction error observed in the same
        // synchronous kernel callback.
        ensureLive();
        throw error;
      }
      ensureLive();
      const selected = resolveTopologySelection(selection, snapshot, {
        evaluate: expression,
        node: id,
        path,
        ...(persistent === undefined ? {} : { persistent }),
      });
      ensureLive();
      if (!selected.ok) {
        throw new EvaluationFailure(selected.diagnostics[0]!);
      }
      return { input, keys: selected.value };
    };
    const evaluateNode = (id: NodeId): NodeValue => {
      ensureLive();
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      const node = Object.hasOwn(document.nodes, id)
        ? document.nodes[id]
        : undefined;
      if (node === undefined) {
        throw new EvaluationFailure(
          diagnostic("REFERENCE_MISSING", `Missing node '${id}'`, {
            severity: "error",
            node: id,
          }),
        );
      }
      const solidRef = (reference: RefIR<"solid">): KernelShape => {
        const value = evaluateNode(reference.node);
        if (value.kind !== "solid") {
          throw new EvaluationFailure(
            diagnostic(
              "REFERENCE_KIND_MISMATCH",
              `Node '${reference.node}' did not evaluate to a solid`,
              { severity: "error", node: id },
            ),
          );
        }
        return value.shape;
      };
      let result: NodeValue;
      try {
        switch (node.kind) {
          case "box":
            requireKernelCapability("primitive", "box", id);
            result = ownShape(
              this.kernel.box!(
                node.size.map((value, index) =>
                  positive(expression(value), id, `size/${index}`),
                ) as unknown as Vec3,
                node.center,
                featureContext(id),
              ),
              id,
            );
            break;
          case "cylinder": {
            requireKernelCapability("primitive", "cylinder", id);
            const height = positive(expression(node.height), id, "height");
            const radiusBottom = positive(
              expression(node.radiusBottom),
              id,
              "radiusBottom",
            );
            const radiusTop = expression(node.radiusTop);
            if (radiusTop < 0) {
              throw new EvaluationFailure(
                diagnostic("FEATURE_INVALID", "radiusTop cannot be negative", {
                  severity: "error",
                  node: id,
                  path: `/nodes/${id}/radiusTop`,
                }),
              );
            }
            result = ownShape(
              this.kernel.cylinder!(
                height,
                radiusBottom,
                radiusTop,
                node.center,
                node.segments,
                featureContext(id),
              ),
              id,
            );
            break;
          }
          case "sphere":
            requireKernelCapability("primitive", "sphere", id);
            result = ownShape(
              this.kernel.sphere!(
                positive(expression(node.radius), id, "radius"),
                node.segments,
                featureContext(id),
              ),
              id,
            );
            break;
          case "sketch": {
            const solved = this.sketchSolver.solve(node, {
              evaluate: expression,
              feature: id,
              ...(options.signal === undefined ? {} : { signal: options.signal }),
            });
            diagnostics.push(
              ...solved.diagnostics.map((item) => ({ ...item, node: id })),
            );
            if (hasErrors(solved.diagnostics)) {
              throw new EvaluationFailure(solved.diagnostics[0]!);
            }
            const regionIssue = validateResolvedProfileRegion(
              solved.profile,
              node.tolerance,
              {
                ...(options.signal === undefined
                  ? {}
                  : { signal: options.signal }),
              },
            );
            if (regionIssue !== undefined) {
              throw new EvaluationFailure(
                resolvedProfileRegionDiagnostic(
                  id,
                  node,
                  node.tolerance,
                  regionIssue,
                ),
              );
            }
            result = { kind: "profile", profile: solved.profile };
            break;
          }
          case "polylinePath": {
            const path: ResolvedPath = {
              kind: "polyline",
              points: node.points.map(
                (point) => point.map(expression) as unknown as Vec3,
              ),
              closed: node.closed,
            };
            const issue = validateResolvedPath(path, node.tolerance);
            if (issue !== undefined) {
              const { message, pointIndex, ...details } = issue;
              throw new EvaluationFailure(
                diagnostic("FEATURE_INVALID", message, {
                  severity: "error",
                  node: id,
                  path:
                    pointIndex === undefined
                      ? `/nodes/${id}/points`
                      : `/nodes/${id}/points/${pointIndex}`,
                  details: {
                    ...details,
                    ...(pointIndex === undefined ? {} : { pointIndex }),
                  },
                }),
              );
            }
            result = { kind: "path", path, tolerance: node.tolerance };
            break;
          }
          case "circularArcPath": {
            const point = (value: typeof node.start): Vec3 =>
              value.map(expression) as unknown as Vec3;
            const path: ResolvedCircularArcPath = {
              kind: "circularArc",
              start: point(node.start),
              through: point(node.through),
              end: point(node.end),
              closed: node.closed,
            };
            const issue = validateResolvedPath(path, node.tolerance);
            if (issue !== undefined) {
              const { message, pointIndex, ...details } = issue;
              const pointName =
                pointIndex === undefined
                  ? undefined
                  : (["start", "through", "end"] as const)[pointIndex];
              throw new EvaluationFailure(
                diagnostic("FEATURE_INVALID", message, {
                  severity: "error",
                  node: id,
                  path:
                    pointName === undefined
                      ? `/nodes/${id}`
                      : `/nodes/${id}/${pointName}`,
                  details: {
                    ...details,
                    ...(pointIndex === undefined ? {} : { pointIndex }),
                  },
                }),
              );
            }
            result = { kind: "path", path, tolerance: node.tolerance };
            break;
          }
          case "compositePath": {
            const point = (value: typeof node.start): Vec3 =>
              value.map(expression) as unknown as Vec3;
            const path: ResolvedCompositePath = {
              kind: "composite",
              start: point(node.start),
              segments: node.segments.map((segment) =>
                segment.kind === "line"
                  ? { kind: "line", end: point(segment.end) }
                  : {
                      kind: "circularArc",
                      through: point(segment.through),
                      end: point(segment.end),
                    },
              ),
              closed: node.closed,
            };
            const issue = validateResolvedPath(path, node.tolerance);
            if (issue !== undefined) {
              const { message, segmentIndex, pointRole, ...details } = issue;
              const issuePath =
                segmentIndex === undefined
                  ? pointRole === "start"
                    ? `/nodes/${id}/start`
                    : `/nodes/${id}`
                  : pointRole === "through" || pointRole === "end"
                    ? `/nodes/${id}/segments/${segmentIndex}/${pointRole}`
                    : `/nodes/${id}/segments/${segmentIndex}`;
              throw new EvaluationFailure(
                diagnostic("FEATURE_INVALID", message, {
                  severity: "error",
                  node: id,
                  path: issuePath,
                  details: {
                    ...details,
                    ...(segmentIndex === undefined ? {} : { segmentIndex }),
                    ...(pointRole === undefined ? {} : { pointRole }),
                  },
                }),
              );
            }
            result = { kind: "path", path, tolerance: node.tolerance };
            break;
          }
          case "extrude": {
            requireKernelCapability("feature", "extrude", id);
            const profile = evaluateNode(node.profile.node);
            if (profile.kind !== "profile") throw new Error("Extrude profile mismatch");
            result = ownShape(
              this.kernel.extrude!(profile.profile, {
                distance: positive(expression(node.distance), id, "distance"),
                symmetric: node.symmetric,
                twist: expression(node.twist),
                scaleTop: [expression(node.scaleTop[0]), expression(node.scaleTop[1])],
                divisions: node.divisions,
              }, featureContext(id)),
              id,
            );
            break;
          }
          case "revolve": {
            requireKernelCapability("feature", "revolve", id);
            const profile = evaluateNode(node.profile.node);
            if (profile.kind !== "profile") throw new Error("Revolve profile mismatch");
            const angle = positive(expression(node.angle), id, "angle");
            if (angle > Math.PI * 2 + 1e-10) {
              throw new EvaluationFailure(
                diagnostic("FEATURE_INVALID", "Revolve angle cannot exceed 360 degrees", {
                  severity: "error",
                  node: id,
                  path: `/nodes/${id}/angle`,
                }),
              );
            }
            const effectiveAngle = Math.min(angle, Math.PI * 2);
            result = ownShape(
              this.kernel.revolve!(profile.profile, {
                angle: effectiveAngle,
                ...(node.segments === undefined ? {} : { segments: node.segments }),
              }, featureContext(id)),
              id,
            );
            break;
          }
          case "loft": {
            requireKernelCapability("feature", "loft", id);
            const profiles = node.profiles.map((reference) => {
              const value = evaluateNode(reference.node);
              if (value.kind !== "profile") {
                throw new Error("Loft profile mismatch");
              }
              return value.profile;
            });
            const tolerance = node.profiles.reduce(
              (maximum, reference) => {
                const profileNode = Object.hasOwn(
                  document.nodes,
                  reference.node,
                )
                  ? document.nodes[reference.node]
                  : undefined;
                return Math.max(
                  maximum,
                  profileNode?.kind === "sketch" ? profileNode.tolerance : 1e-7,
                );
              },
              0,
            );
            const issue = validateRuledSolidLoftProfiles(profiles, tolerance);
            if (issue !== undefined) {
              const { message, path, ...details } = issue;
              throw new EvaluationFailure(
                diagnostic("FEATURE_INVALID", message, {
                  severity: "error",
                  node: id,
                  path: `/nodes/${id}/${path}`,
                  details,
                }),
              );
            }
            result = ownShape(
              this.kernel.loft!(
                profiles,
                { ruled: node.ruled },
                { ...featureContext(id), tolerance },
              ),
              id,
            );
            break;
          }
          case "sweep": {
            const pathNode = Object.hasOwn(document.nodes, node.path.node)
              ? document.nodes[node.path.node]
              : undefined;
            const capability =
              pathNode?.kind === "circularArcPath"
                ? "circularArcSweep"
                : pathNode?.kind === "compositePath"
                  ? "compositeSweep"
                  : "sweep";
            requireKernelCapability("feature", capability, id);
            const profileValue = evaluateNode(node.profile.node);
            if (profileValue.kind !== "profile") {
              throw new Error("Sweep profile mismatch");
            }
            const pathValue = evaluateNode(node.path.node);
            if (pathValue.kind !== "path") {
              throw new Error("Sweep path mismatch");
            }
            const profileNode = Object.hasOwn(
              document.nodes,
              node.profile.node,
            )
              ? document.nodes[node.profile.node]
              : undefined;
            const tolerance = Math.max(
              profileNode?.kind === "sketch" ? profileNode.tolerance : 1e-7,
              pathValue.tolerance,
            );
            const issue = validateResolvedSweep(
              profileValue.profile,
              pathValue.path,
              tolerance,
            );
            if (issue !== undefined) {
              const { message, input, ...details } = issue;
              throw new EvaluationFailure(
                diagnostic("FEATURE_INVALID", message, {
                  severity: "error",
                  node: id,
                  path: `/nodes/${id}/${input}`,
                  details: { ...details, input },
                }),
              );
            }
            if (pathValue.path.kind === "composite") {
              const classification =
                classifyResolvedCompositeSweepRefinements(
                  profileValue.profile,
                  pathValue.path,
                  tolerance,
                );
              if (!classification.ok) {
                throw new EvaluationFailure(
                  diagnostic("FEATURE_INVALID", classification.message, {
                    severity: "error",
                    node: id,
                    path: `/nodes/${id}/profile`,
                    details: {
                      reason: classification.reason,
                      ...(classification.segmentIndex === undefined
                        ? {}
                        : { segmentIndex: classification.segmentIndex }),
                      ...(classification.profileMoments === undefined
                        ? {}
                        : {
                            profileMoments: classification.profileMoments,
                          }),
                    },
                  }),
                );
              }
              requireCompositeSweepRefinements(classification, id);
            }
            result = ownShape(
              pathValue.path.kind === "circularArc"
                ? this.kernel.circularArcSweep!(
                    profileValue.profile,
                    pathValue.path,
                    { transition: node.transition, frame: node.frame },
                    { ...featureContext(id), tolerance },
                  )
                : pathValue.path.kind === "composite"
                  ? this.kernel.compositeSweep!(
                      profileValue.profile,
                      pathValue.path,
                      { transition: node.transition, frame: node.frame },
                      { ...featureContext(id), tolerance },
                    )
                  : this.kernel.sweep!(
                      profileValue.profile,
                      pathValue.path,
                      { transition: node.transition, frame: node.frame },
                      { ...featureContext(id), tolerance },
                    ),
              id,
            );
            break;
          }
          case "boolean":
            requireKernelCapability("feature", "boolean", id);
            requireExactIndexedTopologyEvolution("boolean", id, true);
            result = ownShape(
              this.kernel.boolean!(
                node.operation,
                solidRef(node.target),
                node.tools.map(solidRef),
                featureContext(id),
              ),
              id,
            );
            break;
          case "transform":
            requireKernelCapability("feature", "transform", id);
            result = ownShape(
              this.kernel.transform!(
                solidRef(node.input),
                node.operations.map(resolvedTransform),
                featureContext(id),
              ),
              id,
            );
            break;
          case "fillet": {
            requireKernelCapability("feature", "fillet", id);
            requireExactIndexedTopologyEvolution("fillet", id, true);
            const selected = resolveSelectedTopology(
              id,
              "edges",
              node.edges,
              node.input.node,
              () => solidRef(node.input),
            );
            const radius = positive(expression(node.radius), id, "radius");
            const context = featureContext(id);
            ensureLive();
            result = ownShape(
              this.kernel.fillet!(
                selected.input,
                selected.keys,
                { radius },
                context,
              ),
              id,
            );
            break;
          }
          case "chamfer": {
            requireKernelCapability("feature", "chamfer", id);
            requireExactIndexedTopologyEvolution("chamfer", id, true);
            const selected = resolveSelectedTopology(
              id,
              "edges",
              node.edges,
              node.input.node,
              () => solidRef(node.input),
            );
            const distance = positive(
              expression(node.distance),
              id,
              "distance",
            );
            const context = featureContext(id);
            ensureLive();
            result = ownShape(
              this.kernel.chamfer!(
                selected.input,
                selected.keys,
                { distance },
                context,
              ),
              id,
            );
            break;
          }
          case "shell": {
            requireKernelCapability("feature", "shell", id);
            requireExactIndexedTopologyEvolution("shell", id, true);
            const thickness = positive(
              expression(node.thickness),
              id,
              "thickness",
            );
            const tolerance = positive(
              expression(node.tolerance),
              id,
              "tolerance",
            );
            if (!(tolerance < thickness)) {
              throw new EvaluationFailure(
                diagnostic(
                  "FEATURE_INVALID",
                  "Shell tolerance must be less than its thickness",
                  {
                    severity: "error",
                    node: id,
                    path: `/nodes/${id}/tolerance`,
                    details: { tolerance, thickness },
                  },
                ),
              );
            }
            const selected = resolveSelectedTopology(
              id,
              "openings",
              node.openings,
              node.input.node,
              () => solidRef(node.input),
            );
            const shellOptions = {
              thickness,
              direction: node.direction,
              tolerance,
            } as const;
            const context = featureContext(id);
            ensureLive();
            result = ownShape(
              this.kernel.shell!(
                selected.input,
                selected.keys,
                shellOptions,
                context,
              ),
              id,
            );
            break;
          }
          case "offset": {
            requireKernelCapability("feature", "offset", id);
            requireExactIndexedTopologyEvolution("offset", id, true);
            const distance = positive(
              expression(node.distance),
              id,
              "distance",
            );
            const tolerance = positive(
              expression(node.tolerance),
              id,
              "tolerance",
            );
            if (!(tolerance < distance)) {
              throw new EvaluationFailure(
                diagnostic(
                  "FEATURE_INVALID",
                  "Offset tolerance must be less than its distance",
                  {
                    severity: "error",
                    node: id,
                    path: `/nodes/${id}/tolerance`,
                    details: { tolerance, distance },
                  },
                ),
              );
            }
            result = ownShape(
              this.kernel.offset!(
                solidRef(node.input),
                {
                  distance,
                  direction: node.direction,
                  tolerance,
                },
                featureContext(id),
              ),
              id,
            );
            break;
          }
          case "draft": {
            requireKernelCapability("feature", "draft", id);
            requireExactIndexedTopologyEvolution("draft", id);
            const angle = resolvedDraftNumber(
              node.angle,
              id,
              "angle",
              "Draft angle",
            );
            const absoluteAngle = Math.abs(angle);
            if (
              !(absoluteAngle > DRAFT_MIN_ANGLE_RADIANS) ||
              !(absoluteAngle < Math.PI / 2)
            ) {
              throw new EvaluationFailure(
                diagnostic(
                  "FEATURE_INVALID",
                  "Draft angle must satisfy 1e-4 < abs(angle) < pi / 2 radians",
                  {
                    severity: "error",
                    node: id,
                    path: `/nodes/${id}/angle`,
                    details: {
                      value: angle,
                      minimumExclusive: DRAFT_MIN_ANGLE_RADIANS,
                      maximumExclusive: Math.PI / 2,
                    },
                  },
                ),
              );
            }
            const draftOptions: ResolvedDraftOptions = {
              angle,
              pullDirection: resolvedDraftVector(
                node.pullDirection,
                id,
                "pullDirection",
                "Draft pull direction",
                true,
              ),
              neutralPlane: {
                origin: resolvedDraftVector(
                  node.neutralPlane.origin,
                  id,
                  "neutralPlane/origin",
                  "Draft neutral-plane origin",
                  false,
                ),
                normal: resolvedDraftVector(
                  node.neutralPlane.normal,
                  id,
                  "neutralPlane/normal",
                  "Draft neutral-plane normal",
                  true,
                ),
              },
            };
            const selected = resolveSelectedTopology(
              id,
              "faces",
              node.faces,
              node.input.node,
              () => solidRef(node.input),
            );
            const context = featureContext(id);
            ensureLive();
            result = ownShape(
              this.kernel.draft!(
                selected.input,
                selected.keys,
                draftOptions,
                context,
              ),
              id,
            );
            break;
          }
          case "part": {
            const effectiveMaterialId =
              configuredPartMaterial(id) ?? node.materialId;
            const materialDefinition =
              effectiveMaterialId === undefined
                ? undefined
                : resolvedMaterials.get(effectiveMaterialId);
            let massDensity: number | undefined;
            let massDensitySource: MassDensitySource | undefined;
            if (node.massDensity !== undefined) {
              try {
                massDensity = expression(node.massDensity);
              } catch (error) {
                throw new EvaluationFailure(
                  diagnostic(
                    "MASS_DENSITY_INVALID",
                    "Part massDensity must evaluate to a finite, strictly positive number",
                    {
                      severity: "error",
                      node: id,
                      path: `/nodes/${id}/massDensity`,
                      details: {
                        cause: error instanceof Error ? error.message : String(error),
                      },
                    },
                  ),
                );
              }
              if (!Number.isFinite(massDensity) || !(massDensity > 0)) {
                throw new EvaluationFailure(
                  diagnostic(
                    "MASS_DENSITY_INVALID",
                    "Part massDensity must be finite and strictly positive",
                    {
                      severity: "error",
                      node: id,
                      path: `/nodes/${id}/massDensity`,
                      details: { value: massDensity },
                    },
                  ),
                );
              }
              massDensitySource = "part";
            } else if (materialDefinition !== undefined) {
              massDensity = materialDefinition.massDensity;
              massDensitySource = "material";
            }
            result = {
              kind: "part",
              node: id,
              definition: node,
              shape: solidRef(node.solid),
              ...(effectiveMaterialId === undefined
                ? {}
                : { materialId: effectiveMaterialId }),
              ...(materialDefinition === undefined
                ? {}
                : { materialDefinition }),
              ...(massDensity === undefined ? {} : { massDensity }),
              ...(massDensitySource === undefined
                ? {}
                : { massDensitySource }),
            };
            break;
          }
          case "assembly": {
            const occurrences: AssemblyOccurrence[] = [];
            for (const instance of node.instances) {
              const suppressed =
                configuredInstanceSuppression(id, instance.id) ??
                instance.suppressed;
              if (suppressed) continue;
              const component = evaluateNode(instance.component.node);
              const placement = operationsMatrix(
                instance.placement.map(resolvedTransform),
              );
              if (component.kind === "part") {
                occurrences.push({
                  id: instance.id,
                  part: component,
                  transform: placement,
                });
              } else if (component.kind === "assembly") {
                occurrences.push(
                  ...component.occurrences.map((occurrence) => ({
                    id: `${instance.id}/${occurrence.id}`,
                    part: occurrence.part,
                    transform: multiplyMatrices(placement, occurrence.transform),
                  })),
                );
              } else {
                throw new Error("Assembly component did not evaluate to a part");
              }
            }
            result = { kind: "assembly", occurrences };
            break;
          }
        }
      } catch (error) {
        if (error instanceof EvaluationFailure) throw error;
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new EvaluationFailure(
            diagnostic("EVALUATION_ABORTED", "CAD evaluation was aborted", {
              severity: "error",
              node: id,
            }),
          );
        }
        throw new EvaluationFailure(
          diagnostic(
            "KERNEL_ERROR",
            error instanceof Error ? error.message : String(error),
            {
              severity: "error",
              node: id,
              path: `/nodes/${id}`,
              details: {
                kernel: this.kernel.id,
                ...(error instanceof TopologyEvolutionProtocolError
                  ? { protocolViolation: true }
                  : {}),
              },
            },
          ),
        );
      }
      cache.set(id, result);
      return result;
    };

    try {
      const requested = options.outputs ?? Object.keys(document.outputs);
      if (requested.length === 0) {
        throw new EvaluationFailure(
          diagnostic("OUTPUT_MISSING", "The document has no outputs", {
            severity: "error",
            path: "/outputs",
          }),
        );
      }
      const rawOutputs = new Map<string, NodeValue>();
      for (const name of requested) {
        const reference = document.outputs[name];
        if (reference === undefined) {
          throw new EvaluationFailure(
            diagnostic("OUTPUT_MISSING", `Unknown output '${name}'`, {
              severity: "error",
              path: `/outputs/${name}`,
            }),
          );
        }
        const directNode = Object.hasOwn(document.nodes, reference.node)
          ? document.nodes[reference.node]
          : undefined;
        if (artifactCache !== undefined && directNode?.kind === "box") {
          await prepareDirectCachedBox(reference.node, directNode);
        }
        rawOutputs.set(name, evaluateNode(reference.node));
      }
      const owner = new EvaluationOwner(
        this.kernel,
        createdShapes,
        selectedConfigurationId,
      );
      captureEvaluationOwnerDocumentName(owner, document.name);
      const outputs = new Map<string, EvaluatedOutput>();
      for (const [name, value] of rawOutputs) {
        if (value.kind === "solid") {
          outputs.set(name, new EvaluatedSolid(name, owner, value.shape));
        } else if (value.kind === "part") {
          outputs.set(name, new EvaluatedPart(name, owner, value));
        } else if (value.kind === "assembly") {
          outputs.set(
            name,
            new EvaluatedAssembly(name, owner, value.occurrences),
          );
        } else {
          throw new EvaluationFailure(
            diagnostic("OUTPUT_MISSING", "Profiles and paths cannot be final design outputs", {
              severity: "error",
              path: `/outputs/${name}`,
            }),
          );
        }
      }
      const publicParameters = Object.fromEntries(parameterValues);
      const evaluated = new EvaluatedDesign(
        owner,
        outputs,
        selectedConfigurationId,
        publicParameters,
        diagnostics,
      );
      return success(evaluated, diagnostics);
    } catch (error) {
      for (const shape of createdShapes) this.kernel.disposeShape(shape);
      const value =
        error instanceof EvaluationFailure
          ? error.diagnostic
          : diagnostic(
              "KERNEL_ERROR",
              error instanceof Error ? error.message : String(error),
              { severity: "error", details: { kernel: this.kernel.id } },
            );
      if (!diagnostics.includes(value)) diagnostics.push(value);
      return { ok: false, diagnostics };
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    if (this.#artifactCacheEvaluationActive) {
      throw new Error(
        "Cannot dispose an evaluator during a private artifact-cache evaluation",
      );
    }
    this.sketchSolver.dispose();
    this.kernel.dispose();
    this.#disposed = true;
  }
}

export async function createEvaluator(
  options: CreateEvaluatorOptions = {},
): Promise<Evaluator> {
  const profile = options.profile;
  if (profile !== undefined) {
    if (!(EVALUATOR_PROFILES as readonly string[]).includes(profile)) {
      throw new TypeError(`Unknown evaluator profile '${String(profile)}'`);
    }
    if (profile === "mesh-preview" && options.occt !== undefined) {
      throw new TypeError(
        "OCCT options require the 'mechanical-exact' evaluator profile",
      );
    }
    if (profile === "mechanical-exact" && options.manifold !== undefined) {
      throw new TypeError(
        "Manifold options require the 'mesh-preview' evaluator profile",
      );
    }
  } else if (options.occt !== undefined) {
    throw new TypeError(
      "OCCT options require profile: 'mechanical-exact'",
    );
  }

  const createdKernel = options.kernel === undefined;
  let kernel: GeometryKernel;
  if (options.kernel !== undefined) {
    kernel = options.kernel;
  } else if (profile === "mechanical-exact") {
    const { createOcctKernel } = await import("./occt-kernel.js");
    kernel = await createOcctKernel(options.occt);
  } else {
    kernel = await createManifoldKernel(options.manifold);
  }

  try {
    if (profile !== undefined) {
      const inspection = inspectEvaluatorProfile(kernel, profile);
      if (!inspection.compatible) {
        throw new TypeError(
          `Kernel '${kernel.id}' does not satisfy evaluator profile '${profile}': ${inspection.missing.join(", ")}`,
        );
      }
    }
    return new Evaluator(
      kernel,
      options.sketchSolver ?? createReferenceSketchSolver(),
    );
  } catch (error) {
    if (createdKernel) kernel.dispose();
    throw error;
  }
}
