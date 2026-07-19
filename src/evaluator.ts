import type {
  ConfigurationId,
  EntityId,
  MaterialId,
  NodeId,
  ParameterId,
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
  CadError,
  diagnostic,
  failure,
  hasErrors,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import { exportMesh, type MeshExportFormat } from "./exporters.js";
import {
  evaluateExpression,
  Expression,
  type Dimension,
  type ExpressionIR,
} from "./expressions.js";
import type {
  AssemblyInstanceIR,
  DesignConfigurationIR,
  DesignDocument,
  MaterialDefinitionIR,
  NodeIR,
  PartNodeIR,
  RefIR,
  TopologySelectionIR,
  TransformOperationIR,
} from "./ir.js";
import {
  COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
  EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
  GEOMETRY_KERNEL_PROTOCOL_VERSION,
  inspectKernelCompositeSweepCapabilities,
  mergeMeshes,
  transformMesh,
  type BoundingBox,
  type GeometryKernel,
  type KernelCapabilityKind,
  type KernelCompositeSweepRefinement,
  type KernelExchangeFormat,
  type KernelFeature,
  type KernelFeatureContext,
  type KernelPrimitive,
  type KernelShape,
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
import {
  combineMassProperties,
  transformMassProperties,
} from "./internal/mesh-mass-properties.js";
import {
  combinePhysicalMassProperties,
  physicalMassProperties as scalePhysicalMassProperties,
  type PhysicalMassProperties,
} from "./mass-properties.js";
import {
  createReferenceSketchSolver,
  type SketchSolverBackend,
} from "./solver.js";
import {
  resolvedLoopIsClosed,
  type ResolvedProfile,
} from "./protocol/profile.js";
import { validateDocument } from "./validation.js";
import {
  resolveTopologySelection,
  topologySelectionRequirements,
} from "./topology-resolution.js";
import type {
  KernelTopologyKey,
  TopologyKind,
} from "./protocol/topology.js";
import {
  DRAFT_MIN_ANGLE_RADIANS,
  type ResolvedDraftOptions,
} from "./protocol/draft.js";
import { TopologyEvolutionProtocolError } from "./internal/topology-evolution.js";

export type ParameterOverride = number | Expression<Dimension>;
export type ShapeExportFormat = MeshExportFormat | KernelExchangeFormat;

export interface EvaluationOptions {
  /** Exact document-owned configuration ID; omitted selects the base design. */
  readonly configuration?: string;
  readonly parameters?: Readonly<Record<string, ParameterOverride>>;
  readonly outputs?: readonly string[];
  readonly signal?: AbortSignal;
  readonly allowEmpty?: boolean;
}

export interface CreateEvaluatorOptions {
  readonly kernel?: GeometryKernel;
  readonly manifold?: ManifoldKernelOptions;
  readonly sketchSolver?: SketchSolverBackend;
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

interface ParameterResolution {
  readonly values: ReadonlyMap<ParameterId, number>;
  readonly diagnostics: readonly Diagnostic[];
}

function resolveParameters(
  document: DesignDocument,
  overrides: Readonly<Record<string, ParameterOverride>>,
  configurationId: ConfigurationId | null,
  configuration: DesignConfigurationIR | undefined,
): CadResult<ParameterResolution> {
  const diagnostics: Diagnostic[] = [];
  const values = new Map<ParameterId, number>();
  const states = new Map<ParameterId, "visiting" | "resolved">();
  const configurationOverrides = configuration?.parameterOverrides ?? {};
  const sourcePath = (id: ParameterId): string => {
    if (Object.hasOwn(overrides, id)) return `/parameters/${id}`;
    if (Object.hasOwn(configurationOverrides, id)) {
      return `/configurations/${configurationId}/parameterOverrides/${id}`;
    }
    return `/parameters/${id}/default`;
  };
  const resolve = (id: ParameterId, expected: Dimension): number => {
    const existing = values.get(id);
    if (existing !== undefined) return existing;
    const definition = Object.hasOwn(document.parameters, id)
      ? document.parameters[id]
      : undefined;
    if (definition === undefined) {
      throw new EvaluationFailure(
        diagnostic("PARAMETER_MISSING", `Missing parameter '${id}'`, {
          severity: "error",
          path: `/parameters/${id}`,
        }),
      );
    }
    if (definition.dimension !== expected) {
      throw new EvaluationFailure(
        diagnostic(
          "EXPRESSION_DIMENSION_MISMATCH",
          `Parameter '${id}' is ${definition.dimension}, expected ${expected}`,
          { severity: "error", path: `/parameters/${id}` },
        ),
      );
    }
    if (states.get(id) === "visiting") {
      throw new EvaluationFailure(
        diagnostic("PARAMETER_CYCLE", `Parameter '${id}' is part of a cycle`, {
          severity: "error",
          path: sourcePath(id),
        }),
      );
    }
    states.set(id, "visiting");
    const override = Object.hasOwn(overrides, id)
      ? overrides[id]
      : undefined;
    const hasConfigurationOverride = Object.hasOwn(configurationOverrides, id);
    let value: number;
    if (typeof override === "number") {
      value = override;
    } else {
      const expression =
        override instanceof Expression
          ? override.ir
          : hasConfigurationOverride
            ? configurationOverrides[id]!
            : definition.default;
      if (override instanceof Expression && override.dimension !== definition.dimension) {
        throw new EvaluationFailure(
          diagnostic(
            "EXPRESSION_DIMENSION_MISMATCH",
            `Override for '${id}' is ${override.dimension}, expected ${definition.dimension}`,
            { severity: "error", path: `/parameters/${id}` },
          ),
        );
      }
      value = evaluateExpression(expression, { resolveParameter: resolve });
    }
    if (
      definition.dimension === "massDensity" &&
      (!Number.isFinite(value) || !(value > 0))
    ) {
      throw new EvaluationFailure(
        diagnostic(
          "MASS_DENSITY_INVALID",
          `Mass-density parameter '${id}' must be finite and strictly positive`,
          {
            severity: "error",
            path: sourcePath(id),
            details: { value },
          },
        ),
      );
    }
    if (!Number.isFinite(value)) {
      throw new EvaluationFailure(
        diagnostic("EXPRESSION_INVALID", `Parameter '${id}' is not finite`, {
          severity: "error",
          path: sourcePath(id),
        }),
      );
    }
    values.set(id, value);
    states.set(id, "resolved");
    return value;
  };

  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(document.parameters, key)) {
      diagnostics.push(
        diagnostic("PARAMETER_MISSING", `Unknown parameter override '${key}'`, {
          severity: "error",
          path: `/parameters/${key}`,
        }),
      );
    }
  }
  for (const [rawId, definition] of Object.entries(document.parameters) as [
    ParameterId,
    DesignDocument["parameters"][ParameterId],
  ][]) {
    try {
      resolve(rawId, definition.dimension);
    } catch (error) {
      diagnostics.push(
        error instanceof EvaluationFailure
          ? error.diagnostic
          : diagnostic(
              definition.dimension === "massDensity"
                ? "MASS_DENSITY_INVALID"
                : "EXPRESSION_INVALID",
              error instanceof Error ? error.message : String(error),
              { severity: "error", path: sourcePath(rawId) },
            ),
      );
    }
  }
  if (!hasErrors(diagnostics)) {
    const context = { resolveParameter: resolve };
    for (const [rawId, definition] of Object.entries(document.parameters) as [
      ParameterId,
      DesignDocument["parameters"][ParameterId],
    ][]) {
      const value = values.get(rawId)!;
      let boundInvalid = false;
      const bound = (
        field: "min" | "max",
        expression: ExpressionIR | undefined,
      ): number | undefined => {
        if (expression === undefined) return undefined;
        try {
          return evaluateExpression(expression, context);
        } catch (error) {
          boundInvalid = true;
          diagnostics.push(
            error instanceof EvaluationFailure
              ? error.diagnostic
              : diagnostic(
                  definition.dimension === "massDensity"
                    ? "MASS_DENSITY_INVALID"
                    : "EXPRESSION_INVALID",
                  `Parameter '${rawId}' ${field} bound is invalid: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                  {
                    severity: "error",
                    path: `/parameters/${rawId}/${field}`,
                  },
                ),
          );
          return undefined;
        }
      };
      const min = bound("min", definition.min);
      const max = bound("max", definition.max);
      if (boundInvalid) continue;
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        diagnostics.push(
          diagnostic(
            "PARAMETER_OUT_OF_RANGE",
            `Parameter '${rawId}' value ${value} is outside ${min ?? "-∞"}..${max ?? "∞"}`,
            {
              severity: "error",
              path: sourcePath(rawId),
              details: { value, min, max },
            },
          ),
        );
      }
    }
  }
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };
  return success({ values, diagnostics }, diagnostics);
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

class EvaluationOwner {
  disposed = false;
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
  }

  assertLive(): void {
    if (this.disposed) throw new Error("This evaluation result has been disposed");
  }

  dispose(): void {
    if (this.disposed) return;
    for (const shape of this.shapes) this.kernel.disposeShape(shape);
    this.disposed = true;
  }
}

export class EvaluatedSolid {
  readonly name: string;
  protected readonly owner: EvaluationOwner;
  protected readonly shape: KernelShape;

  constructor(name: string, owner: EvaluationOwner, shape: KernelShape) {
    this.name = name;
    this.owner = owner;
    this.shape = shape;
  }

  mesh(options?: MeshOptions): MeshData {
    this.owner.assertLive();
    return this.owner.kernel.mesh(this.shape, options);
  }

  measure(): ShapeMeasurements {
    this.owner.assertLive();
    return this.owner.kernel.measure(this.shape);
  }

  export(format: ShapeExportFormat): Uint8Array | string {
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
    return this.owner.kernel.exportShape(this.shape, format, {
      feature: this.name,
    });
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
      genus: 0,
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

export class Evaluator {
  readonly kernel: GeometryKernel;
  readonly sketchSolver: SketchSolverBackend;
  private disposed = false;

  constructor(kernel: GeometryKernel, sketchSolver: SketchSolverBackend) {
    this.kernel = kernel;
    this.sketchSolver = sketchSolver;
  }

  async evaluate(
    document: DesignDocument,
    options: EvaluationOptions = {},
  ): Promise<CadResult<EvaluatedDesign>> {
    if (this.disposed) throw new Error("This evaluator has been disposed");
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
    const parameterResult = resolveParameters(
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
        "compositeSweepRefinement" | "exactIndexedTopologyEvolution"
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
        capability === "chamfer"
      ) {
        const requiresEdges = capability !== "draft";
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
          (requiresEdges &&
            !(topology as { readonly kinds: readonly unknown[] }).kinds.includes(
              "edge",
            )) ||
          (topologyProvenance !== "feature" &&
            topologyProvenance !== "history") ||
          typeof this.kernel.topology !== "function"
        ) {
          protocolViolation(
            `${capability} evolution requires ${requiresEdges ? "face and edge" : "face"} topology with feature-or-history provenance`,
            {
              requiredTopologyKinds:
                requiresEdges ? ["face", "edge"] : ["face"],
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
      const input = resolveInput();
      const selected = resolveTopologySelection(
        selection,
        this.kernel.topology(input),
        {
          evaluate: expression,
          node: id,
          path,
        },
      );
      if (!selected.ok) {
        throw new EvaluationFailure(selected.diagnostics[0]!);
      }
      return { input, keys: selected.value };
    };
    const evaluateNode = (id: NodeId): NodeValue => {
      ensureLive();
      const cached = cache.get(id);
      if (cached !== undefined) return cached;
      const node = document.nodes[id];
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
            const profileLoops = [
              solved.profile.outer,
              ...solved.profile.holes,
            ];
            if (
              profileLoops.some(
                (loop) => !resolvedLoopIsClosed(loop, node.tolerance),
              )
            ) {
              throw new EvaluationFailure(
                diagnostic(
                  "SKETCH_NO_CLOSED_REGION",
                  "Sketch did not produce a closed region",
                  { severity: "error", node: id, path: `/nodes/${id}/profile` },
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
            result = ownShape(
              this.kernel.revolve!(profile.profile, {
                angle,
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
                const profileNode = document.nodes[reference.node];
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
            const pathNode = document.nodes[node.path.node];
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
            const profileNode = document.nodes[node.profile.node];
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
              () => solidRef(node.input),
            );
            result = ownShape(
              this.kernel.fillet!(
                selected.input,
                selected.keys,
                { radius: positive(expression(node.radius), id, "radius") },
                featureContext(id),
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
              () => solidRef(node.input),
            );
            result = ownShape(
              this.kernel.chamfer!(
                selected.input,
                selected.keys,
                {
                  distance: positive(
                    expression(node.distance),
                    id,
                    "distance",
                  ),
                },
                featureContext(id),
              ),
              id,
            );
            break;
          }
          case "shell": {
            requireKernelCapability("feature", "shell", id);
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
              () => solidRef(node.input),
            );
            result = ownShape(
              this.kernel.shell!(
                selected.input,
                selected.keys,
                {
                  thickness,
                  direction: node.direction,
                  tolerance,
                },
                featureContext(id),
              ),
              id,
            );
            break;
          }
          case "offset": {
            requireKernelCapability("feature", "offset", id);
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
              () => solidRef(node.input),
            );
            result = ownShape(
              this.kernel.draft!(
                selected.input,
                selected.keys,
                draftOptions,
                featureContext(id),
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
        rawOutputs.set(name, evaluateNode(reference.node));
      }
      const owner = new EvaluationOwner(
        this.kernel,
        createdShapes,
        selectedConfigurationId,
      );
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
    if (this.disposed) return;
    this.sketchSolver.dispose();
    this.kernel.dispose();
    this.disposed = true;
  }
}

export async function createEvaluator(
  options: CreateEvaluatorOptions = {},
): Promise<Evaluator> {
  const kernel = options.kernel ?? (await createManifoldKernel(options.manifold));
  return new Evaluator(
    kernel,
    options.sketchSolver ?? createReferenceSketchSolver(),
  );
}
