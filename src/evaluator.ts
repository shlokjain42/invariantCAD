import type { EntityId, NodeId, ParameterId } from "./core/ids.js";
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
  diagnostic,
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
  DesignDocument,
  NodeIR,
  PartNodeIR,
  RefIR,
  TransformOperationIR,
} from "./ir.js";
import {
  mergeMeshes,
  transformMesh,
  type BoundingBox,
  type GeometryKernel,
  type KernelCapabilityKind,
  type KernelFeature,
  type KernelPrimitive,
  type KernelShape,
  type MeshData,
  type ResolvedTransformOperation,
  type ShapeMeasurements,
  kernelSupports,
} from "./kernel.js";
import { createManifoldKernel, type ManifoldKernelOptions } from "./manifold-kernel.js";
import {
  createReferenceSketchSolver,
  type SketchSolverBackend,
} from "./solver.js";
import {
  resolvedLoopIsClosed,
  type ResolvedProfile,
} from "./protocol/profile.js";
import { validateDocument } from "./validation.js";

export type ParameterOverride = number | Expression<Dimension>;

export interface EvaluationOptions {
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

interface ProfileValue {
  readonly kind: "profile";
  readonly profile: ResolvedProfile;
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

type NodeValue = ProfileValue | SolidValue | PartValue | AssemblyValue;

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
): CadResult<ParameterResolution> {
  const diagnostics: Diagnostic[] = [];
  const values = new Map<ParameterId, number>();
  const states = new Map<ParameterId, "visiting" | "resolved">();
  const resolve = (id: ParameterId, expected: Dimension): number => {
    const existing = values.get(id);
    if (existing !== undefined) return existing;
    const definition = document.parameters[id];
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
          path: `/parameters/${id}/default`,
        }),
      );
    }
    states.set(id, "visiting");
    const override = overrides[id];
    let value: number;
    if (typeof override === "number") {
      value = override;
    } else {
      const expression = override instanceof Expression ? override.ir : definition.default;
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
    if (!Number.isFinite(value)) {
      throw new EvaluationFailure(
        diagnostic("EXPRESSION_INVALID", `Parameter '${id}' is not finite`, {
          severity: "error",
          path: `/parameters/${id}`,
        }),
      );
    }
    values.set(id, value);
    states.set(id, "resolved");
    return value;
  };

  for (const key of Object.keys(overrides)) {
    if (document.parameters[key as ParameterId] === undefined) {
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
              "EXPRESSION_INVALID",
              error instanceof Error ? error.message : String(error),
              { severity: "error", path: `/parameters/${rawId}` },
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
      const min =
        definition.min === undefined
          ? undefined
          : evaluateExpression(definition.min, context);
      const max =
        definition.max === undefined
          ? undefined
          : evaluateExpression(definition.max, context);
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        diagnostics.push(
          diagnostic(
            "PARAMETER_OUT_OF_RANGE",
            `Parameter '${rawId}' value ${value} is outside ${min ?? "-∞"}..${max ?? "∞"}`,
            {
              severity: "error",
              path: `/parameters/${rawId}`,
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

function meshMeasurements(mesh: MeshData): ShapeMeasurements {
  if (mesh.positions.length === 0) {
    const zero: Vec3 = [0, 0, 0];
    return {
      volume: 0,
      surfaceArea: 0,
      boundingBox: { min: zero, max: zero },
      genus: 0,
      tolerance: 0,
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
  let signedVolume = 0;
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
    signedVolume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return {
    volume: Math.abs(signedVolume),
    surfaceArea,
    boundingBox: { min, max },
    genus: 0,
    tolerance: 0,
  };
}

class EvaluationOwner {
  disposed = false;
  readonly kernel: GeometryKernel;
  readonly shapes: ReadonlySet<KernelShape>;

  constructor(kernel: GeometryKernel, shapes: ReadonlySet<KernelShape>) {
    this.kernel = kernel;
    this.shapes = shapes;
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

  mesh(): MeshData {
    this.owner.assertLive();
    return this.owner.kernel.mesh(this.shape);
  }

  measure(): ShapeMeasurements {
    this.owner.assertLive();
    return this.owner.kernel.measure(this.shape);
  }

  export(format: MeshExportFormat): Uint8Array | string {
    return exportMesh(this.mesh(), format, this.name);
  }
}

export class EvaluatedPart extends EvaluatedSolid {
  readonly partNumber: string | undefined;
  readonly description: string | undefined;
  readonly material: string | undefined;

  constructor(name: string, owner: EvaluationOwner, part: PartValue) {
    super(name, owner, part.shape);
    this.partNumber = part.definition.partNumber;
    this.description = part.definition.description;
    this.material = part.definition.material;
  }
}

export interface EvaluatedOccurrence {
  readonly id: string;
  readonly partNode: string;
  readonly partNumber?: string;
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
      transform: occurrence.transform,
    }));
  }

  mesh(): MeshData {
    this.owner.assertLive();
    return mergeMeshes(
      this.occurrences.map((occurrence) =>
        transformMesh(this.owner.kernel.mesh(occurrence.part.shape), occurrence.transform),
      ),
    );
  }

  measure(): ShapeMeasurements {
    return meshMeasurements(this.mesh());
  }

  export(format: MeshExportFormat): Uint8Array | string {
    return exportMesh(this.mesh(), format, this.name);
  }
}

export type EvaluatedOutput = EvaluatedSolid | EvaluatedPart | EvaluatedAssembly;

export class EvaluatedDesign {
  readonly parameters: Readonly<Record<string, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly outputNames: readonly string[];
  private readonly outputs: ReadonlyMap<string, EvaluatedOutput>;
  private readonly owner: EvaluationOwner;

  constructor(
    owner: EvaluationOwner,
    outputs: ReadonlyMap<string, EvaluatedOutput>,
    parameters: Readonly<Record<string, number>>,
    diagnostics: readonly Diagnostic[],
  ) {
    this.owner = owner;
    this.outputs = outputs;
    this.outputNames = [...outputs.keys()];
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
    const validation = validateDocument(document);
    if (!validation.ok) return validation;
    const parameterResult = resolveParameters(document, options.parameters ?? {});
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
      if (status !== "NoError") {
        throw new EvaluationFailure(
          diagnostic("KERNEL_ERROR", `Kernel failed with status ${status}`, {
            severity: "error",
            node: id,
            path: `/nodes/${id}`,
            details: { kernel: this.kernel.id, status },
          }),
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
      kind: KernelCapabilityKind,
      capability: KernelPrimitive | KernelFeature | string,
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
            : kernelSupports(this.kernel.capabilities, "export", capability);
      if (supported) return;
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
    };
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
              this.kernel.box(
                node.size.map((value, index) =>
                  positive(expression(value), id, `size/${index}`),
                ) as unknown as Vec3,
                node.center,
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
              this.kernel.cylinder(
                height,
                radiusBottom,
                radiusTop,
                node.center,
                node.segments,
              ),
              id,
            );
            break;
          }
          case "sphere":
            requireKernelCapability("primitive", "sphere", id);
            result = ownShape(
              this.kernel.sphere(
                positive(expression(node.radius), id, "radius"),
                node.segments,
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
          case "extrude": {
            requireKernelCapability("feature", "extrude", id);
            const profile = evaluateNode(node.profile.node);
            if (profile.kind !== "profile") throw new Error("Extrude profile mismatch");
            result = ownShape(
              this.kernel.extrude(profile.profile, {
                distance: positive(expression(node.distance), id, "distance"),
                symmetric: node.symmetric,
                twist: expression(node.twist),
                scaleTop: [expression(node.scaleTop[0]), expression(node.scaleTop[1])],
                divisions: node.divisions,
              }),
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
              this.kernel.revolve(profile.profile, {
                angle,
                ...(node.segments === undefined ? {} : { segments: node.segments }),
              }),
              id,
            );
            break;
          }
          case "boolean":
            requireKernelCapability("feature", "boolean", id);
            result = ownShape(
              this.kernel.boolean(
                node.operation,
                solidRef(node.target),
                node.tools.map(solidRef),
              ),
              id,
            );
            break;
          case "transform":
            requireKernelCapability("feature", "transform", id);
            result = ownShape(
              this.kernel.transform(
                solidRef(node.input),
                node.operations.map(resolvedTransform),
              ),
              id,
            );
            break;
          case "part":
            result = {
              kind: "part",
              node: id,
              definition: node,
              shape: solidRef(node.solid),
            };
            break;
          case "assembly": {
            const occurrences: AssemblyOccurrence[] = [];
            for (const instance of node.instances) {
              if (instance.suppressed) continue;
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
              details: { kernel: this.kernel.id },
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
      const owner = new EvaluationOwner(this.kernel, createdShapes);
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
            diagnostic("OUTPUT_MISSING", "Profiles cannot be final design outputs", {
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
