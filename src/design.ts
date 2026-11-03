import {
  assertValidId,
  configurationId,
  entityId,
  materialId,
  nodeId,
  parameterId,
  topologyReferenceId,
  type ConfigurationId,
  type EntityId,
  type MaterialId,
  type NodeId,
  type ParameterId,
  type TopologyReferenceId,
} from "./core/ids.js";
import { deepFreeze, type JsonValue } from "./core/json.js";
import { DEFAULT_DESIGN_DOCUMENT_LIMITS } from "./document-limits.js";
import {
  assertExpressionIR,
  deg,
  expressionIROf,
  expressionVectorIROf,
  forEachExpressionParameter,
  mm,
  scalar,
  type AngleExpression,
  type AngleVec3Expression,
  type Dimension,
  type Expression,
  type ExpressionIR,
  type LengthExpression,
  type MassDensityExpression,
  type Parameter,
  Parameter as ParameterClass,
  type ScalarExpression,
  type ScalarVec3Expression,
  type Vec3Expression,
} from "./expressions.js";
import {
  DOCUMENT_SCHEMA,
  DOCUMENT_VERSION,
  type AssemblyInstanceIR,
  type AssemblyNodeIR,
  type DesignConfigurationIR,
  type DesignDocumentV6,
  type DesignOutputKind,
  type MaterialDefinitionIR,
  type NodeIR,
  type OutputKind,
  type ParameterIR,
  type PlaneIR,
  type PrincipalPlane,
  type RefIR,
  type TopologyReferenceEntryIR,
  type TransformOperationIR,
} from "./ir.js";
import {
  ProfileDefinition,
  SketchBuilder,
  assertSketchProfile,
  closeSketchBuilder,
} from "./sketch.js";
import { TopologySelection } from "./topology.js";
import {
  SHELL_DIRECTIONS,
  type ShellDirection,
} from "./protocol/shell.js";
import {
  OFFSET_DIRECTIONS,
  type OffsetDirection,
} from "./protocol/offset.js";
import type { TopologyKind } from "./protocol/topology.js";
import {
  normalizePersistentTopologyReference,
  type PersistentTopologyReference,
} from "./topology-signatures.js";

const DESIGN_OWNER = Symbol("InvariantCAD.DesignOwner");

/**
 * Handles returned by builder methods. The handle classes keep public
 * constructors for compatibility, so the owner field alone cannot prove that
 * a handle names a node or material its builder actually authored.
 */
const ISSUED_DESIGN_HANDLES = new WeakSet<object>();

function issued<T extends object>(handle: T): T {
  ISSUED_DESIGN_HANDLES.add(handle);
  return handle;
}

/** Instance records created by AssemblyBuilder.instance(), by builder. */
const ISSUED_ASSEMBLY_INSTANCES = new WeakMap<object, AssemblyBuilder>();
const CLOSED_ASSEMBLY_BUILDERS = new WeakSet<AssemblyBuilder>();
const CLOSED_CONFIGURATION_BUILDERS = new WeakSet<ConfigurationBuilder>();

function assertConfigurationBuilderOpen(builder: ConfigurationBuilder): void {
  if (CLOSED_CONFIGURATION_BUILDERS.has(builder)) {
    throw new TypeError(
      "This configuration builder is closed; add overrides inside its configuration() callback",
    );
  }
}

type Vec3ExpressionIR = readonly [ExpressionIR, ExpressionIR, ExpressionIR];

/** Parameter IR nodes issued by a builder, keyed by node identity. */
const PARAMETER_NODE_OWNERS = new WeakMap<object, DesignBuilder>();
/** Each builder's parameter records, for raw IR that names a parameter by ID. */
const DESIGN_PARAMETER_RECORDS = new WeakMap<
  DesignBuilder,
  Readonly<Record<ParameterId, ParameterIR>>
>();

/**
 * Expressions carry only parameter IDs, so identity is checked through the
 * issued parameter node. Raw IR without an issued node binds by ID and must
 * name a parameter this design already defines, with the same dimension.
 */
function assertExpressionParametersOwned(
  owner: DesignBuilder,
  ir: ExpressionIR,
  label: string,
): void {
  const records = DESIGN_PARAMETER_RECORDS.get(owner);
  forEachExpressionParameter(ir, (node) => {
    const nodeOwner = PARAMETER_NODE_OWNERS.get(node);
    if (nodeOwner !== undefined) {
      if (nodeOwner !== owner) {
        throw new TypeError(
          "Parameter references cannot cross design boundaries",
        );
      }
      return;
    }
    const record =
      records !== undefined && Object.hasOwn(records, node.id)
        ? records[node.id]
        : undefined;
    if (record === undefined) {
      throw new TypeError(
        `${label} references parameter '${node.id}', which this design does not define`,
      );
    }
    if (record.dimension !== node.dimension) {
      throw new TypeError(
        `${label} references ${record.dimension} parameter '${node.id}' as ${node.dimension}`,
      );
    }
  });
}

/** Reads an expression's IR after checking its dimension and parameter owner. */
function ownedExpressionIR(
  owner: DesignBuilder,
  value: unknown,
  dimension: Dimension,
  label: string,
): ExpressionIR {
  const ir = expressionIROf(value, dimension, label);
  assertExpressionParametersOwned(owner, ir, label);
  return ir;
}

/** Checks raw expression IR, such as a transform-operation component. */
function ownedRawExpressionIR(
  owner: DesignBuilder,
  value: unknown,
  dimension: Dimension,
  label: string,
): ExpressionIR {
  const ir = assertExpressionIR(value, label);
  if (ir.dimension !== dimension) {
    throw new TypeError(
      `${label} must be ${dimension === "angle" ? "an" : "a"} ${dimension} expression, received ${ir.dimension}`,
    );
  }
  assertExpressionParametersOwned(owner, ir, label);
  return ir;
}

function threeComponents(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} must contain exactly three components`);
  }
  return value;
}

function ownedVec3IR(
  owner: DesignBuilder,
  value: unknown,
  dimension: Dimension,
  label: string,
): Vec3ExpressionIR {
  const components = threeComponents(value, label);
  return [
    ownedExpressionIR(owner, components[0], dimension, `${label}[0]`),
    ownedExpressionIR(owner, components[1], dimension, `${label}[1]`),
    ownedExpressionIR(owner, components[2], dimension, `${label}[2]`),
  ];
}

function ownedRawVec3IR(
  owner: DesignBuilder,
  value: unknown,
  dimension: Dimension,
  label: string,
): Vec3ExpressionIR {
  const components = threeComponents(value, label);
  return [
    ownedRawExpressionIR(owner, components[0], dimension, `${label}[0]`),
    ownedRawExpressionIR(owner, components[1], dimension, `${label}[1]`),
    ownedRawExpressionIR(owner, components[2], dimension, `${label}[2]`),
  ];
}

/**
 * Copies one transform operation into a builder-owned record after checking
 * its kind, component dimensions, and parameter owners.
 */
function ownedTransformOperation(
  owner: DesignBuilder,
  value: unknown,
  label: string,
): TransformOperationIR {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${label} must be a transform operation`);
  }
  const operation = value as {
    readonly kind?: unknown;
    readonly value?: unknown;
    readonly normal?: unknown;
  };
  switch (operation.kind) {
    case "translate":
      return {
        kind: "translate",
        value: ownedRawVec3IR(owner, operation.value, "length", `${label} value`),
      };
    case "rotate":
      return {
        kind: "rotate",
        value: ownedRawVec3IR(owner, operation.value, "angle", `${label} value`),
      };
    case "scale":
      return {
        kind: "scale",
        value: ownedRawVec3IR(owner, operation.value, "scalar", `${label} value`),
      };
    case "mirror":
      return {
        kind: "mirror",
        normal: ownedRawVec3IR(
          owner,
          operation.normal,
          "scalar",
          `${label} normal`,
        ),
      };
    default:
      throw new TypeError(
        `${label} must be a translate, rotate, scale, or mirror operation`,
      );
  }
}

/** Copies a caller array after rejecting holes, which `map` would skip. */
function denseArray<T>(value: readonly T[], label: string): readonly T[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const items: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${label} cannot be sparse`);
    }
    items.push(value[index]!);
  }
  return items;
}

function ownedTransformOperations(
  owner: DesignBuilder,
  value: unknown,
  label: string,
): TransformOperationIR[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array of transform operations`);
  }
  if (value.length > DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues) {
    throw new RangeError(
      `${label} exceed the authoring limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues} operations`,
    );
  }
  const operations: TransformOperationIR[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${label} cannot be sparse`);
    }
    operations.push(
      ownedTransformOperation(owner, value[index], `${label}[${index}]`),
    );
  }
  return operations;
}

function ownedPlaneIR(
  owner: DesignBuilder,
  value: unknown,
  label: string,
): PlaneIR {
  const ir =
    typeof value === "object" && value !== null
      ? (value as { readonly ir?: unknown }).ir
      : undefined;
  if (typeof ir !== "object" || ir === null) {
    throw new TypeError(`${label} must be created by plane.xy(), plane.xz(), or plane.yz()`);
  }
  const candidate = ir as {
    readonly type?: unknown;
    readonly plane?: unknown;
    readonly origin?: unknown;
  };
  if (
    candidate.type !== "principal" ||
    (candidate.plane !== "XY" &&
      candidate.plane !== "XZ" &&
      candidate.plane !== "YZ")
  ) {
    throw new TypeError(`${label} must be a principal XY, XZ, or YZ plane`);
  }
  return {
    type: "principal",
    plane: candidate.plane,
    origin: ownedRawVec3IR(owner, candidate.origin, "length", `${label} origin`),
  };
}

/** Checks parameter owners in every expression a topology selection holds. */
function assertTopologySelectionParametersOwned(
  owner: DesignBuilder,
  selection: TopologySelection,
  label: string,
): void {
  const pending: unknown[] = [selection.ir.query];
  const expression = (value: unknown): void => {
    assertExpressionParametersOwned(
      owner,
      assertExpressionIR(value, label),
      label,
    );
  };
  while (pending.length > 0) {
    const query = pending.pop();
    if (typeof query !== "object" || query === null) continue;
    const node = query as {
      readonly op?: unknown;
      readonly queries?: unknown;
      readonly query?: unknown;
      readonly selection?: { readonly query?: unknown };
      readonly value?: unknown;
      readonly tolerance?: unknown;
    };
    switch (node.op) {
      case "and":
      case "or":
        if (Array.isArray(node.queries)) pending.push(...node.queries);
        break;
      case "not":
        pending.push(node.query);
        break;
      case "adjacentTo":
        pending.push(node.selection?.query);
        break;
      case "direction":
      case "normal":
      case "position":
        if (Array.isArray(node.value)) node.value.forEach(expression);
        expression(node.tolerance);
        break;
      case "radius":
        expression(node.value);
        expression(node.tolerance);
        break;
      default:
        break;
    }
  }
}

/**
 * Copies caller metadata into builder-owned plain JSON records, so later
 * caller mutation cannot reach a built document and authoring never freezes
 * caller objects. Values JSON cannot preserve are rejected rather than being
 * written as `{}` or failing only when the document is saved.
 */
function detachMetadata(
  value: unknown,
  label: string,
): Readonly<Record<string, JsonValue>> {
  const limits = DEFAULT_DESIGN_DOCUMENT_LIMITS;
  const copies = new Map<object, JsonValue>();
  const active = new Set<object>();
  let structuralValues = 0;
  // Reads own data properties only, so caller accessors never run and an
  // inherited value never reaches the document.
  const ownData = (container: object, key: string, path: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(container, key);
    if (descriptor === undefined) return undefined;
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(
        `${label}${path} must be a data property, not an accessor`,
      );
    }
    return descriptor.value as unknown;
  };
  const copy = (current: unknown, depth: number, path: string): JsonValue => {
    structuralValues += 1;
    if (structuralValues > limits.maxStructuralValues) {
      throw new RangeError(
        `${label} exceeds the authoring limit of ${limits.maxStructuralValues} structural values`,
      );
    }
    if (depth > limits.maxNestingDepth) {
      throw new RangeError(
        `${label} exceeds the authoring nesting depth of ${limits.maxNestingDepth}`,
      );
    }
    switch (typeof current) {
      case "string":
      case "boolean":
        return current;
      case "number":
        if (!Number.isFinite(current)) {
          throw new TypeError(`${label}${path} must be a finite number`);
        }
        return current;
      case "object":
        break;
      default:
        throw new TypeError(
          `${label}${path} cannot contain a ${typeof current} value`,
        );
    }
    if (current === null) return null;
    const known = copies.get(current);
    if (known !== undefined) return known;
    if (active.has(current)) {
      throw new TypeError(`${label} cannot contain object cycles`);
    }
    active.add(current);
    let result: JsonValue;
    if (Array.isArray(current)) {
      const items: JsonValue[] = [];
      for (let index = 0; index < current.length; index += 1) {
        const itemPath = `${path}/${index}`;
        const item = ownData(current, String(index), itemPath);
        if (item === undefined) {
          throw new TypeError(
            `${label}${itemPath} must be a JSON value; arrays cannot be sparse or hold undefined`,
          );
        }
        items.push(copy(item, depth + 1, itemPath));
      }
      result = items;
    } else {
      // A plain record's prototype is some realm's Object.prototype or null.
      const prototype = Object.getPrototypeOf(current) as object | null;
      if (prototype !== null && Object.getPrototypeOf(prototype) !== null) {
        throw new TypeError(
          `${label}${path} must contain only plain JSON objects and arrays`,
        );
      }
      const record: Record<string, JsonValue> = {};
      for (const key of Object.keys(current)) {
        const childPath = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
        const child = ownData(current, key, childPath);
        // Undefined members are omitted, exactly as the canonical writer does.
        if (child === undefined) continue;
        const copied = copy(child, depth + 1, childPath);
        // Define rather than assign so an own "__proto__" key stays data.
        Object.defineProperty(record, key, {
          value: copied,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      result = record;
    }
    active.delete(current);
    copies.set(current, result);
    return result;
  };
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be a plain JSON record`);
  }
  return deepFreeze(copy(value, 0, "")) as Readonly<Record<string, JsonValue>>;
}

function optionalBoolean(
  value: unknown,
  fallback: boolean,
  label: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
  return value;
}

/** Checks an integer option against the document grammar's lower bound. */
function optionalInteger(
  value: unknown,
  minimum: number,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw new TypeError(`${label} must be a number`);
  }
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be an integer of at least ${minimum}`);
  }
  return value;
}

function optionalSegments(
  value: unknown,
  minimum: number,
  label: string,
): { readonly segments?: number } {
  const segments = optionalInteger(value, minimum, label);
  return segments === undefined ? {} : { segments };
}

function positiveTolerance(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new TypeError(`${label} must be a number`);
  }
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new RangeError(`${label} must be finite and positive`);
  }
  return value;
}

const PART_OPTION_KEYS: readonly string[] = Object.freeze([
  "partNumber",
  "description",
  "material",
  "materialRef",
  "massDensity",
  "metadata",
]);

/** Checks parameter owners in every expression a sketch callback authored. */
function assertSketchParametersOwned(
  owner: DesignBuilder,
  id: string,
  sketch: SketchBuilder,
): void {
  const check = (value: ExpressionIR, path: string): void =>
    assertExpressionParametersOwned(owner, value, `Sketch '${id}' ${path}`);
  for (const [entityKey, entity] of Object.entries(sketch.entities)) {
    switch (entity.kind) {
      case "point":
        check(entity.x, `entity '${entityKey}' x`);
        check(entity.y, `entity '${entityKey}' y`);
        break;
      case "circle":
        check(entity.radius, `entity '${entityKey}' radius`);
        break;
      case "arc":
        check(entity.radius, `entity '${entityKey}' radius`);
        check(entity.startAngle, `entity '${entityKey}' startAngle`);
        check(entity.endAngle, `entity '${entityKey}' endAngle`);
        break;
      default:
        break;
    }
  }
  for (const [constraintKey, constraint] of Object.entries(
    sketch.constraints,
  )) {
    if ("value" in constraint) {
      check(constraint.value, `constraint '${constraintKey}' value`);
    }
  }
}

export class ModelRef<K extends OutputKind> {
  readonly kind: K;
  readonly node: NodeId;
  readonly [DESIGN_OWNER]: DesignBuilder;

  constructor(owner: DesignBuilder, kind: K, node: NodeId) {
    this[DESIGN_OWNER] = owner;
    this.kind = kind;
    this.node = node;
    Object.freeze(this);
  }

  toIR(): RefIR<K> {
    return { node: this.node, kind: this.kind };
  }
}

export class ProfileRef extends ModelRef<"profile"> {
  constructor(owner: DesignBuilder, node: NodeId) {
    super(owner, "profile", node);
  }
}

export class PathRef extends ModelRef<"path"> {
  constructor(owner: DesignBuilder, node: NodeId) {
    super(owner, "path", node);
  }
}

export class SolidRef extends ModelRef<"solid"> {
  constructor(owner: DesignBuilder, node: NodeId) {
    super(owner, "solid", node);
  }
}

export class PartRef extends ModelRef<"part"> {
  constructor(owner: DesignBuilder, node: NodeId) {
    super(owner, "part", node);
  }
}

export class AssemblyRef extends ModelRef<"assembly"> {
  constructor(owner: DesignBuilder, node: NodeId) {
    super(owner, "assembly", node);
  }
}

/** An immutable, design-owned reference to a material definition. */
export class MaterialRef {
  readonly id: MaterialId;
  readonly [DESIGN_OWNER]: DesignBuilder;

  constructor(owner: DesignBuilder, id: MaterialId) {
    this[DESIGN_OWNER] = owner;
    this.id = id;
    Object.freeze(this);
  }
}

/** Immutable authoring handle for one document-owned persistent topology entry. */
export class TopologyReferenceRef<K extends TopologyKind = TopologyKind> {
  readonly id: TopologyReferenceId;
  readonly topology: K;
  readonly target: SolidRef;
  readonly [DESIGN_OWNER]: DesignBuilder;

  constructor(
    owner: DesignBuilder,
    id: TopologyReferenceId,
    topology: K,
    target: SolidRef,
  ) {
    this[DESIGN_OWNER] = owner;
    this.id = id;
    this.topology = topology;
    this.target = target;
    Object.freeze(this);
  }
}

export interface TopologyReferenceOptions<K extends TopologyKind> {
  readonly topology: K;
  /** The topology discriminant is authoritative for generic inference. */
  readonly variants: readonly PersistentTopologyReference<NoInfer<K>>[];
}

function copyTopologyReferenceVariants(value: unknown): readonly unknown[] {
  let array: readonly unknown[];
  try {
    if (!Array.isArray(value)) {
      throw new TypeError();
    }
    array = value;
  } catch {
    throw new TypeError("Topology reference variants must be an array");
  }

  let length: number;
  try {
    length = array.length;
  } catch {
    throw new TypeError("Topology reference variant length could not be read");
  }
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new TypeError("Topology reference variant length is invalid");
  }
  if (length === 0) {
    throw new TypeError("A topology reference requires at least one variant");
  }
  if (length > DEFAULT_DESIGN_DOCUMENT_LIMITS.maxTopologyReferenceVariants) {
    throw new RangeError(
      `Topology reference variant count exceeds the authoring limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxTopologyReferenceVariants}`,
    );
  }

  const copied = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    let present: boolean;
    try {
      present = Object.hasOwn(array, index);
    } catch {
      throw new TypeError("Topology reference variants could not be read safely");
    }
    if (!present) {
      throw new TypeError("Topology reference variants must be a dense array");
    }
    try {
      copied[index] = array[index];
    } catch {
      throw new TypeError("Topology reference variants could not be read safely");
    }
  }
  return copied;
}

function readTopologyReferenceOptions(value: unknown): {
  readonly topology: unknown;
  readonly variants: unknown;
} {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError();
    }
    const options = value as Readonly<Record<string, unknown>>;
    return { topology: options.topology, variants: options.variants };
  } catch {
    throw new TypeError("Topology reference options could not be read safely");
  }
}

export interface ParameterOptions<D extends Dimension> {
  readonly min?: Expression<D>;
  readonly max?: Expression<D>;
  readonly label?: string;
  readonly description?: string;
}

export type CompositePathSegmentExpression =
  | {
      readonly kind: "line";
      readonly end: Vec3Expression;
    }
  | {
      readonly kind: "circularArc";
      readonly through: Vec3Expression;
      readonly end: Vec3Expression;
    };

export interface Plane {
  readonly ir: PlaneIR;
}

function principalPlane(
  value: PrincipalPlane,
  origin: Vec3Expression = [mm(0), mm(0), mm(0)],
): Plane {
  return deepFreeze({
    ir: {
      type: "principal",
      plane: value,
      origin: expressionVectorIROf(origin, "length", "Plane origin"),
    },
  });
}

export const plane = {
  xy(origin?: Vec3Expression): Plane {
    return principalPlane("XY", origin);
  },
  xz(origin?: Vec3Expression): Plane {
    return principalPlane("XZ", origin);
  },
  yz(origin?: Vec3Expression): Plane {
    return principalPlane("YZ", origin);
  },
};

export const tf = {
  translate(value: Vec3Expression): TransformOperationIR {
    return deepFreeze({
      kind: "translate",
      value: expressionVectorIROf(value, "length", "Translation"),
    });
  },
  rotate(value: AngleVec3Expression): TransformOperationIR {
    return deepFreeze({
      kind: "rotate",
      value: expressionVectorIROf(value, "angle", "Rotation"),
    });
  },
  scale(value: ScalarVec3Expression): TransformOperationIR {
    return deepFreeze({
      kind: "scale",
      value: expressionVectorIROf(value, "scalar", "Scale"),
    });
  },
  mirror(normal: ScalarVec3Expression): TransformOperationIR {
    const operation: TransformOperationIR = {
      kind: "mirror",
      normal: expressionVectorIROf(normal, "scalar", "Mirror normal"),
    };
    return deepFreeze(operation);
  },
};

export class AssemblyBuilder {
  readonly instances: AssemblyInstanceIR[] = [];
  readonly owner: DesignBuilder;

  constructor(owner: DesignBuilder) {
    this.owner = owner;
  }

  instance(
    id: string,
    component: PartRef | AssemblyRef,
    options: {
      readonly placement?: readonly TransformOperationIR[];
      readonly suppressed?: boolean;
    } = {},
  ): this {
    if (CLOSED_ASSEMBLY_BUILDERS.has(this)) {
      throw new TypeError(
        "This assembly builder is closed; add instances inside its assembly() callback",
      );
    }
    this.owner.assertOwned(component);
    const stableId = entityId(id);
    if (this.instances.some((instance) => instance.id === stableId)) {
      throw new TypeError(`Duplicate assembly instance '${id}'`);
    }
    const placement = ownedTransformOperations(
      this.owner,
      options.placement ?? [],
      `Assembly instance '${id}' placement`,
    );
    const suppressed = optionalBoolean(
      options.suppressed,
      false,
      `Assembly instance '${id}' suppressed`,
    );
    const record = deepFreeze({
      id: stableId,
      component: component.toIR(),
      placement,
      suppressed,
    });
    ISSUED_ASSEMBLY_INSTANCES.set(record, this);
    this.instances.push(record);
    return this;
  }
}

export interface ConfigurationOptions {
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export class ConfigurationBuilder {
  readonly owner: DesignBuilder;
  private readonly parameterRecords = Object.create(null) as Record<
    ParameterId,
    ExpressionIR
  >;
  private readonly instanceSuppressionRecords = Object.create(null) as Record<
    NodeId,
    Record<EntityId, boolean>
  >;
  private readonly partMaterialRecords = Object.create(null) as Record<
    NodeId,
    MaterialId
  >;

  constructor(owner: DesignBuilder) {
    this.owner = owner;
  }

  parameter<D extends Dimension>(
    parameter: Parameter<D>,
    value: Expression<NoInfer<D>>,
  ): this {
    assertConfigurationBuilderOpen(this);
    this.owner.assertParameterOwned(parameter);
    if (
      typeof value !== "object" ||
      value === null ||
      value.dimension !== parameter.dimension
    ) {
      throw new TypeError(
        `Configuration value for '${parameter.id}' must have dimension ${parameter.dimension}`,
      );
    }
    const ir = ownedExpressionIR(
      this.owner,
      value,
      parameter.dimension,
      `Configuration value for '${parameter.id}'`,
    );
    if (Object.hasOwn(this.parameterRecords, parameter.id)) {
      throw new TypeError(
        `Duplicate configuration parameter override '${parameter.id}'`,
      );
    }
    this.parameterRecords[parameter.id] = ir;
    return this;
  }

  instanceSuppressed(
    assembly: AssemblyRef,
    instanceId: string,
    suppressed = true,
  ): this {
    assertConfigurationBuilderOpen(this);
    const stableId = this.owner.assertAssemblyInstance(assembly, instanceId);
    const flag = optionalBoolean(
      suppressed,
      true,
      `Configuration suppression of '${assembly.node}/${stableId}'`,
    );
    let instances = this.instanceSuppressionRecords[assembly.node];
    if (instances === undefined) {
      instances = Object.create(null) as Record<EntityId, boolean>;
      this.instanceSuppressionRecords[assembly.node] = instances;
    }
    if (Object.hasOwn(instances, stableId)) {
      throw new TypeError(
        `Duplicate configuration instance override '${assembly.node}/${stableId}'`,
      );
    }
    instances[stableId] = flag;
    return this;
  }

  partMaterial(part: PartRef, material: MaterialRef): this {
    assertConfigurationBuilderOpen(this);
    this.owner.assertOwned(part);
    this.owner.assertOwned(material);
    if (Object.hasOwn(this.partMaterialRecords, part.node)) {
      throw new TypeError(
        `Duplicate configuration material override '${part.node}'`,
      );
    }
    this.partMaterialRecords[part.node] = material.id;
    return this;
  }

  toIR(options: ConfigurationOptions = {}): DesignConfigurationIR {
    if (
      Object.keys(this.parameterRecords).length === 0 &&
      Object.keys(this.instanceSuppressionRecords).length === 0 &&
      Object.keys(this.partMaterialRecords).length === 0
    ) {
      throw new TypeError("A configuration requires at least one override");
    }
    const description = optionalString(
      options.description,
      "Configuration description",
    );
    return deepFreeze({
      ...(description === undefined ? {} : { description }),
      ...(Object.keys(this.parameterRecords).length === 0
        ? {}
        : { parameterOverrides: { ...this.parameterRecords } }),
      ...(Object.keys(this.instanceSuppressionRecords).length === 0
        ? {}
        : {
            instanceSuppressions: Object.fromEntries(
              Object.entries(this.instanceSuppressionRecords).map(
                ([assembly, instances]) => [assembly, { ...instances }],
              ),
            ),
          }),
      ...(Object.keys(this.partMaterialRecords).length === 0
        ? {}
        : { partMaterialOverrides: { ...this.partMaterialRecords } }),
      ...(options.metadata === undefined
        ? {}
        : {
            metadata: detachMetadata(
              options.metadata,
              "Configuration metadata",
            ),
          }),
    });
  }
}

export interface DesignOptions {
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface MaterialOptions {
  readonly name: string;
  readonly massDensity: MassDensityExpression;
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

interface PartCommonOptions {
  readonly partNumber?: string;
  readonly description?: string;
  /** Explicit per-part override; otherwise a referenced material supplies density. */
  readonly massDensity?: MassDensityExpression;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export type PartOptions = PartCommonOptions &
  (
    | {
        /** Legacy descriptive label. It is never resolved against the material registry. */
        readonly material?: string;
        readonly materialRef?: never;
      }
    | {
        readonly material?: never;
        readonly materialRef: MaterialRef;
      }
  );

export class DesignBuilder {
  readonly name: string;
  readonly metadata: Readonly<Record<string, JsonValue>> | undefined;
  private readonly parameterRecords = Object.create(null) as Record<
    ParameterId,
    ParameterIR
  >;
  private readonly parameterReferences = new WeakSet<object>();
  private readonly materialRecords = Object.create(null) as Record<
    MaterialId,
    MaterialDefinitionIR
  >;
  private readonly topologyReferenceRecords = Object.create(null) as Record<
    TopologyReferenceId,
    TopologyReferenceEntryIR
  >;
  private readonly topologyReferenceHandles = new WeakSet<object>();
  private topologyReferenceCount = 0;
  private topologyReferenceVariantCount = 0;
  private topologyReferenceAdjacencyCount = 0;
  private topologyReferenceEvidenceCount = 0;
  private readonly nodeRecords = Object.create(null) as Record<NodeId, NodeIR>;
  private readonly configurationRecords = Object.create(null) as Record<
    ConfigurationId,
    DesignConfigurationIR
  >;
  /** IDs whose configuration() callback is still running. */
  private readonly pendingConfigurations = new Set<ConfigurationId>();
  private readonly outputRecords = Object.create(null) as Record<
    string,
    RefIR<DesignOutputKind>
  >;
  private usesMassDensity = false;

  constructor(name: string, options: DesignOptions = {}) {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError("A design requires a name");
    }
    this.name = name;
    this.metadata =
      options.metadata === undefined
        ? undefined
        : detachMetadata(options.metadata, "Design metadata");
    DESIGN_PARAMETER_RECORDS.set(this, this.parameterRecords);
  }

  assertOwned(reference: ModelRef<OutputKind> | MaterialRef): void {
    if (
      typeof reference !== "object" ||
      reference === null ||
      !ISSUED_DESIGN_HANDLES.has(reference)
    ) {
      throw new TypeError(
        "Model references must be returned by a DesignBuilder method",
      );
    }
    if (reference[DESIGN_OWNER] !== this) {
      throw new TypeError("Model references cannot cross design boundaries");
    }
  }

  assertParameterOwned(parameter: Parameter<Dimension>): void {
    if (!this.parameterReferences.has(parameter)) {
      throw new TypeError("Parameter references cannot cross design boundaries");
    }
  }

  private assertPersistentTopologyReferences(
    selection: TopologySelection,
    input: SolidRef,
  ): void {
    for (const reference of selection.persistentReferences) {
      if (
        !this.topologyReferenceHandles.has(reference) ||
        reference[DESIGN_OWNER] !== this
      ) {
        throw new TypeError(
          "Persistent topology references cannot cross design boundaries",
        );
      }
      const entry = this.topologyReferenceRecords[reference.id];
      if (
        entry === undefined ||
        entry.topology !== reference.topology ||
        entry.target.node !== reference.target.node
      ) {
        throw new TypeError(
          `Persistent topology reference '${reference.id}' is not owned by this design`,
        );
      }
      if (reference.target.node !== input.node) {
        throw new TypeError(
          `Persistent topology reference '${reference.id}' targets solid '${reference.target.node}', not selector input '${input.node}'`,
        );
      }
    }
  }

  assertAssemblyInstance(assembly: AssemblyRef, id: string): EntityId {
    this.assertOwned(assembly);
    const stableId = entityId(id);
    const node = Object.hasOwn(this.nodeRecords, assembly.node)
      ? this.nodeRecords[assembly.node]
      : undefined;
    if (
      node?.kind !== "assembly" ||
      !node.instances.some((instance) => instance.id === stableId)
    ) {
      throw new RangeError(
        `Assembly '${assembly.node}' has no instance '${id}'`,
      );
    }
    return stableId;
  }

  private parameterOf<D extends Dimension>(
    id: string,
    dimension: D,
    defaultValue: Expression<D>,
    options: ParameterOptions<D> = {},
  ): Parameter<D> {
    const key = parameterId(id);
    if (Object.hasOwn(this.parameterRecords, key)) {
      throw new TypeError(`Duplicate parameter '${id}'`);
    }
    if (
      typeof defaultValue !== "object" ||
      defaultValue === null ||
      defaultValue.dimension !== dimension
    ) {
      throw new TypeError(`Parameter '${id}' must have dimension ${dimension}`);
    }
    const defaultIR = ownedExpressionIR(
      this,
      defaultValue,
      dimension,
      `Parameter '${id}' default`,
    );
    const min =
      options.min === undefined
        ? undefined
        : ownedExpressionIR(this, options.min, dimension, `Parameter '${id}' min`);
    const max =
      options.max === undefined
        ? undefined
        : ownedExpressionIR(this, options.max, dimension, `Parameter '${id}' max`);
    const label = optionalString(options.label, `Parameter '${id}' label`);
    const description = optionalString(
      options.description,
      `Parameter '${id}' description`,
    );
    this.parameterRecords[key] = deepFreeze({
      dimension,
      default: defaultIR,
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
      ...(label === undefined ? {} : { label }),
      ...(description === undefined ? {} : { description }),
    });
    if (dimension === "massDensity") this.usesMassDensity = true;
    const parameter = new ParameterClass(key, dimension);
    this.parameterReferences.add(parameter);
    PARAMETER_NODE_OWNERS.set(parameter.ir, this);
    return parameter;
  }

  readonly parameter = {
    length: (
      id: string,
      defaultValue: LengthExpression,
      options: ParameterOptions<"length"> = {},
    ): Parameter<"length"> =>
      this.parameterOf(id, "length", defaultValue, options),
    angle: (
      id: string,
      defaultValue: AngleExpression,
      options: ParameterOptions<"angle"> = {},
    ): Parameter<"angle"> =>
      this.parameterOf(id, "angle", defaultValue, options),
    scalar: (
      id: string,
      defaultValue: ScalarExpression,
      options: ParameterOptions<"scalar"> = {},
    ): Parameter<"scalar"> =>
      this.parameterOf(id, "scalar", defaultValue, options),
    massDensity: (
      id: string,
      defaultValue: MassDensityExpression,
      options: ParameterOptions<"massDensity"> = {},
    ): Parameter<"massDensity"> =>
      this.parameterOf(id, "massDensity", defaultValue, options),
  };

  material(id: string, options: MaterialOptions): MaterialRef {
    const key = materialId(id);
    if (Object.hasOwn(this.materialRecords, key)) {
      throw new TypeError(`Duplicate material '${id}'`);
    }
    // Read each option once, so an accessor cannot pass a check with one
    // value and supply another to the stored record.
    const {
      name,
      description: rawDescription,
      massDensity: rawMassDensity,
      metadata: rawMetadata,
    } = options;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new TypeError(`Material '${id}' requires a non-empty name`);
    }
    const description = optionalString(
      rawDescription,
      `Material '${id}' description`,
    );
    if (rawMassDensity?.dimension !== "massDensity") {
      throw new TypeError("Material massDensity must be a mass-density expression");
    }
    const massDensity = ownedExpressionIR(
      this,
      rawMassDensity,
      "massDensity",
      `Material '${id}' massDensity`,
    );
    this.materialRecords[key] = deepFreeze({
      name,
      massDensity,
      ...(description === undefined ? {} : { description }),
      ...(rawMetadata === undefined
        ? {}
        : { metadata: detachMetadata(rawMetadata, `Material '${id}' metadata`) }),
    });
    this.usesMassDensity = true;
    return issued(new MaterialRef(this, key));
  }

  topologyReference<K extends TopologyKind>(
    id: string,
    target: SolidRef,
    options: TopologyReferenceOptions<K>,
  ): TopologyReferenceRef<K> {
    this.assertOwned(target);
    const key = topologyReferenceId(id);
    if (Object.hasOwn(this.topologyReferenceRecords, key)) {
      throw new TypeError(`Duplicate topology reference '${id}'`);
    }
    if (
      this.topologyReferenceCount >=
      DEFAULT_DESIGN_DOCUMENT_LIMITS.maxTopologyReferences
    ) {
      throw new RangeError(
        `Topology reference count exceeds the authoring limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxTopologyReferences}`,
      );
    }

    const rawOptions = readTopologyReferenceOptions(options);
    if (
      rawOptions.topology !== "face" &&
      rawOptions.topology !== "edge" &&
      rawOptions.topology !== "vertex"
    ) {
      throw new TypeError(
        "Topology reference kind must be 'face', 'edge', or 'vertex'",
      );
    }
    const copiedVariants = copyTopologyReferenceVariants(rawOptions.variants);
    const aggregateVariantCount =
      this.topologyReferenceVariantCount + copiedVariants.length;
    if (
      aggregateVariantCount >
      DEFAULT_DESIGN_DOCUMENT_LIMITS.maxTopologyReferenceVariants
    ) {
      throw new RangeError(
        `Topology reference variants exceed the aggregate authoring limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxTopologyReferenceVariants}`,
      );
    }

    const variants: PersistentTopologyReference<K>[] = [];
    const fingerprints = new Set<string>();
    let addedAdjacencyCount = 0;
    let addedEvidenceCount = 0;
    for (const candidate of copiedVariants) {
      const normalized = normalizePersistentTopologyReference(candidate);
      if (!normalized.ok) {
        throw new TypeError(
          normalized.diagnostics[0]?.message ??
            "Persistent topology reference is malformed or unsupported",
        );
      }
      const variant = normalized.value;
      if (variant.topology !== rawOptions.topology) {
        throw new TypeError(
          `Topology reference '${id}' declares ${rawOptions.topology} topology but contains a ${variant.topology} variant`,
        );
      }
      const fingerprint = `${variant.protocolVersion}\u0000${variant.kernelFingerprint}`;
      if (fingerprints.has(fingerprint)) {
        throw new TypeError(
          `Topology reference '${id}' contains duplicate kernel fingerprint '${variant.kernelFingerprint}'`,
        );
      }
      fingerprints.add(fingerprint);
      addedAdjacencyCount += variant.adjacency.length;
      addedEvidenceCount +=
        variant.lineage.length +
        variant.adjacency.reduce(
          (count, neighbor) => count + neighbor.lineage.length,
          0,
        );
      const aggregateAdjacencyCount =
        this.topologyReferenceAdjacencyCount + addedAdjacencyCount;
      if (
        aggregateAdjacencyCount >
        DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStoredAdjacencyLinks
      ) {
        throw new RangeError(
          `Stored topology adjacency exceeds the aggregate authoring limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStoredAdjacencyLinks}`,
        );
      }
      const aggregateEvidenceCount =
        this.topologyReferenceEvidenceCount + addedEvidenceCount;
      if (
        aggregateEvidenceCount >
        DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStoredEvidenceRecords
      ) {
        throw new RangeError(
          `Stored topology evidence exceeds the aggregate authoring limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStoredEvidenceRecords}`,
        );
      }
      variants.push(variant as PersistentTopologyReference<K>);
    }
    variants.sort((first, second) =>
      first.protocolVersion !== second.protocolVersion
        ? first.protocolVersion - second.protocolVersion
        : first.kernelFingerprint < second.kernelFingerprint
          ? -1
          : first.kernelFingerprint > second.kernelFingerprint
            ? 1
            : 0,
    );

    const topology = rawOptions.topology as K;
    const entry = deepFreeze({
      target: target.toIR(),
      topology,
      variants,
    }) as TopologyReferenceEntryIR<K>;
    this.topologyReferenceRecords[key] = entry;
    this.topologyReferenceCount += 1;
    this.topologyReferenceVariantCount = aggregateVariantCount;
    this.topologyReferenceAdjacencyCount += addedAdjacencyCount;
    this.topologyReferenceEvidenceCount += addedEvidenceCount;
    const reference = issued(
      new TopologyReferenceRef(this, key, topology, target),
    );
    this.topologyReferenceHandles.add(reference);
    return reference;
  }

  private addNode(id: string, node: NodeIR): NodeId {
    const key = nodeId(id);
    if (Object.hasOwn(this.nodeRecords, key)) {
      throw new TypeError(`Duplicate feature '${id}'`);
    }
    this.nodeRecords[key] = deepFreeze(node);
    return key;
  }

  box(
    id: string,
    options: { readonly size: Vec3Expression; readonly center?: boolean },
  ): SolidRef {
    const key = this.addNode(id, {
      kind: "box",
      size: ownedVec3IR(this, options.size, "length", `Box '${id}' size`),
      center: optionalBoolean(options.center, false, `Box '${id}' center`),
    });
    return issued(new SolidRef(this, key));
  }

  cylinder(
    id: string,
    options: {
      readonly height: LengthExpression;
      readonly radius: LengthExpression;
      readonly radiusTop?: LengthExpression;
      readonly center?: boolean;
      readonly segments?: number;
    },
  ): SolidRef {
    const key = this.addNode(id, {
      kind: "cylinder",
      height: ownedExpressionIR(
        this,
        options.height,
        "length",
        `Cylinder '${id}' height`,
      ),
      radiusBottom: ownedExpressionIR(
        this,
        options.radius,
        "length",
        `Cylinder '${id}' radius`,
      ),
      radiusTop: ownedExpressionIR(
        this,
        options.radiusTop ?? options.radius,
        "length",
        `Cylinder '${id}' radiusTop`,
      ),
      center: optionalBoolean(options.center, false, `Cylinder '${id}' center`),
      ...optionalSegments(options.segments, 3, `Cylinder '${id}' segments`),
    });
    return issued(new SolidRef(this, key));
  }

  sphere(
    id: string,
    options: { readonly radius: LengthExpression; readonly segments?: number },
  ): SolidRef {
    const key = this.addNode(id, {
      kind: "sphere",
      radius: ownedExpressionIR(
        this,
        options.radius,
        "length",
        `Sphere '${id}' radius`,
      ),
      ...optionalSegments(options.segments, 4, `Sphere '${id}' segments`),
    });
    return issued(new SolidRef(this, key));
  }

  sketch(
    id: string,
    sketchPlane: Plane,
    build: (sketch: SketchBuilder) => ProfileDefinition,
    options: { readonly tolerance?: number } = {},
  ): ProfileRef {
    const planeIR = ownedPlaneIR(this, sketchPlane, `Sketch '${id}' plane`);
    const tolerance = positiveTolerance(
      options.tolerance ?? 1e-7,
      `Sketch '${id}' tolerance`,
    );
    const sketch = new SketchBuilder();
    let profile: ProfileDefinition;
    try {
      profile = build(sketch);
    } finally {
      closeSketchBuilder(sketch);
    }
    if (!(profile instanceof ProfileDefinition)) {
      throw new TypeError("A sketch callback must return sketch.profile(...)");
    }
    assertSketchProfile(sketch, profile);
    assertSketchParametersOwned(this, id, sketch);
    const key = this.addNode(id, {
      kind: "sketch",
      plane: planeIR,
      entities: sketch.entities,
      constraints: sketch.constraints,
      profile: profile.ir,
      tolerance,
    });
    return issued(new ProfileRef(this, key));
  }

  polylinePath(
    id: string,
    points: readonly Vec3Expression[],
    options: { readonly tolerance?: number } = {},
  ): PathRef {
    const orderedPoints = denseArray(points, `Polyline path '${id}' points`);
    if (orderedPoints.length < 2) {
      throw new TypeError("A polyline path requires at least two ordered points");
    }
    const tolerance = options.tolerance ?? 1e-7;
    if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
      throw new RangeError("Polyline path tolerance must be finite and positive");
    }
    const key = this.addNode(id, {
      kind: "polylinePath",
      points: orderedPoints.map((point, index) =>
        ownedVec3IR(this, point, "length", `Polyline path '${id}' point ${index}`),
      ),
      closed: false,
      tolerance,
    });
    return issued(new PathRef(this, key));
  }

  circularArcPath(
    id: string,
    points: {
      readonly start: Vec3Expression;
      readonly through: Vec3Expression;
      readonly end: Vec3Expression;
    },
    options: { readonly tolerance?: number } = {},
  ): PathRef {
    const tolerance = options.tolerance ?? 1e-7;
    if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
      throw new RangeError(
        "Circular-arc path tolerance must be finite and positive",
      );
    }
    const vector = (point: Vec3Expression, name: string) =>
      ownedVec3IR(this, point, "length", `Circular-arc path '${id}' ${name}`);
    const key = this.addNode(id, {
      kind: "circularArcPath",
      start: vector(points.start, "start"),
      through: vector(points.through, "through"),
      end: vector(points.end, "end"),
      closed: false,
      tolerance,
    });
    return issued(new PathRef(this, key));
  }

  compositePath(
    id: string,
    path: {
      readonly start: Vec3Expression;
      readonly segments: readonly CompositePathSegmentExpression[];
    },
    options: { readonly tolerance?: number } = {},
  ): PathRef {
    const segments = denseArray(
      path.segments,
      `Composite path '${id}' segments`,
    );
    if (segments.length < 2) {
      throw new TypeError(
        "A composite path requires at least two ordered segments",
      );
    }
    segments.forEach((segment, index) => {
      if (
        typeof segment !== "object" ||
        segment === null ||
        (segment.kind !== "line" && segment.kind !== "circularArc")
      ) {
        throw new TypeError(
          `Composite path '${id}' segment ${index} must be a line or circularArc segment`,
        );
      }
    });
    if (!segments.some((segment) => segment.kind === "circularArc")) {
      throw new TypeError(
        "A composite path requires at least one circular-arc segment; use polylinePath for line-only paths",
      );
    }
    const tolerance = options.tolerance ?? 1e-7;
    if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
      throw new RangeError(
        "Composite path tolerance must be finite and positive",
      );
    }
    const vector = (point: Vec3Expression, name: string) =>
      ownedVec3IR(this, point, "length", `Composite path '${id}' ${name}`);
    const key = this.addNode(id, {
      kind: "compositePath",
      start: vector(path.start, "start"),
      segments: segments.map((segment, index) =>
        segment.kind === "line"
          ? { kind: "line", end: vector(segment.end, `segment ${index} end`) }
          : {
              kind: "circularArc",
              through: vector(segment.through, `segment ${index} through`),
              end: vector(segment.end, `segment ${index} end`),
            },
      ),
      closed: false,
      tolerance,
    });
    return issued(new PathRef(this, key));
  }

  extrude(
    id: string,
    profile: ProfileRef,
    options: {
      readonly distance: LengthExpression;
      readonly symmetric?: boolean;
      readonly twist?: AngleExpression;
      readonly scaleTop?: readonly [ScalarExpression, ScalarExpression];
      readonly divisions?: number;
    },
  ): SolidRef {
    this.assertOwned(profile);
    const scaleTop = options.scaleTop ?? [scalar(1), scalar(1)];
    if (!Array.isArray(scaleTop) || scaleTop.length !== 2) {
      throw new TypeError(`Extrude '${id}' scaleTop must contain two scalars`);
    }
    const key = this.addNode(id, {
      kind: "extrude",
      profile: profile.toIR(),
      distance: ownedExpressionIR(
        this,
        options.distance,
        "length",
        `Extrude '${id}' distance`,
      ),
      symmetric: optionalBoolean(
        options.symmetric,
        false,
        `Extrude '${id}' symmetric`,
      ),
      twist: ownedExpressionIR(
        this,
        options.twist ?? deg(0),
        "angle",
        `Extrude '${id}' twist`,
      ),
      scaleTop: [
        ownedExpressionIR(this, scaleTop[0], "scalar", `Extrude '${id}' scaleTop[0]`),
        ownedExpressionIR(this, scaleTop[1], "scalar", `Extrude '${id}' scaleTop[1]`),
      ],
      divisions:
        optionalInteger(options.divisions, 0, `Extrude '${id}' divisions`) ?? 0,
    });
    return issued(new SolidRef(this, key));
  }

  revolve(
    id: string,
    profile: ProfileRef,
    options: {
      readonly angle?: AngleExpression;
      readonly segments?: number;
    } = {},
  ): SolidRef {
    this.assertOwned(profile);
    const key = this.addNode(id, {
      kind: "revolve",
      profile: profile.toIR(),
      angle: ownedExpressionIR(
        this,
        options.angle ?? deg(360),
        "angle",
        `Revolve '${id}' angle`,
      ),
      ...optionalSegments(options.segments, 3, `Revolve '${id}' segments`),
    });
    return issued(new SolidRef(this, key));
  }

  loft(
    id: string,
    profiles: readonly ProfileRef[],
    options: {
      /** The current document grammar supports ruled interpolation only. */
      readonly ruled?: true;
    } = {},
  ): SolidRef {
    if (profiles.length < 2) {
      throw new TypeError("Loft requires at least two ordered profiles");
    }
    for (const profile of profiles) this.assertOwned(profile);
    if (
      new Set(profiles.map((profile) => profile.node)).size !== profiles.length
    ) {
      throw new TypeError("Loft requires distinct ordered profiles");
    }
    if (options.ruled !== undefined && options.ruled !== true) {
      throw new TypeError("Document lofts must be ruled");
    }
    const key = this.addNode(id, {
      kind: "loft",
      profiles: profiles.map((profile) => profile.toIR()),
      ruled: true,
    });
    return issued(new SolidRef(this, key));
  }

  sweep(
    id: string,
    profile: ProfileRef,
    path: PathRef,
    options: {
      readonly transition?: "right-corner";
      readonly frame?: "corrected-frenet";
    } = {},
  ): SolidRef {
    this.assertOwned(profile);
    this.assertOwned(path);
    if (
      options.transition !== undefined &&
      options.transition !== "right-corner"
    ) {
      throw new TypeError("Document sweeps require right-corner transitions");
    }
    if (options.frame !== undefined && options.frame !== "corrected-frenet") {
      throw new TypeError("Document sweeps require a corrected-Frenet frame");
    }
    const key = this.addNode(id, {
      kind: "sweep",
      profile: profile.toIR(),
      path: path.toIR(),
      transition: "right-corner",
      frame: "corrected-frenet",
    });
    return issued(new SolidRef(this, key));
  }

  private boolean(
    id: string,
    operation: "union" | "subtract" | "intersect",
    target: SolidRef,
    tools: readonly SolidRef[],
  ): SolidRef {
    this.assertOwned(target);
    if (tools.length === 0) {
      throw new TypeError(`${operation} requires at least one tool solid`);
    }
    for (const tool of tools) this.assertOwned(tool);
    const key = this.addNode(id, {
      kind: "boolean",
      operation,
      target: target.toIR(),
      tools: tools.map((tool) => tool.toIR()),
    });
    return issued(new SolidRef(this, key));
  }

  union(id: string, target: SolidRef, tools: readonly SolidRef[]): SolidRef {
    return this.boolean(id, "union", target, tools);
  }

  subtract(id: string, target: SolidRef, tools: readonly SolidRef[]): SolidRef {
    return this.boolean(id, "subtract", target, tools);
  }

  intersect(id: string, target: SolidRef, tools: readonly SolidRef[]): SolidRef {
    return this.boolean(id, "intersect", target, tools);
  }

  transform(
    id: string,
    input: SolidRef,
    operations: readonly TransformOperationIR[],
  ): SolidRef {
    this.assertOwned(input);
    const ownedOperations = ownedTransformOperations(
      this,
      operations,
      `Transform '${id}' operations`,
    );
    if (ownedOperations.length === 0) {
      throw new TypeError("A transform requires at least one operation");
    }
    const key = this.addNode(id, {
      kind: "transform",
      input: input.toIR(),
      operations: ownedOperations,
    });
    return issued(new SolidRef(this, key));
  }

  translate(id: string, input: SolidRef, value: Vec3Expression): SolidRef {
    return this.transform(id, input, [tf.translate(value)]);
  }

  rotate(id: string, input: SolidRef, value: AngleVec3Expression): SolidRef {
    return this.transform(id, input, [tf.rotate(value)]);
  }

  scale(id: string, input: SolidRef, value: ScalarVec3Expression): SolidRef {
    return this.transform(id, input, [tf.scale(value)]);
  }

  mirror(id: string, input: SolidRef, normal: ScalarVec3Expression): SolidRef {
    return this.transform(id, input, [tf.mirror(normal)]);
  }

  fillet(
    id: string,
    input: SolidRef,
    options: {
      /** Seeds for maximal tangent-edge contours. */
      readonly edges: TopologySelection<"edge">;
      readonly radius: LengthExpression;
    },
  ): SolidRef {
    this.assertOwned(input);
    if (!(options.edges instanceof TopologySelection)) {
      throw new TypeError("Fillet edges must be an explicit topology selection");
    }
    if (options.edges.topology !== "edge") {
      throw new TypeError("A fillet requires an edge topology selection");
    }
    for (const reference of options.edges.references) {
      this.assertOwned(reference);
    }
    this.assertPersistentTopologyReferences(options.edges, input);
    assertTopologySelectionParametersOwned(
      this,
      options.edges,
      `Fillet '${id}' edges`,
    );
    const key = this.addNode(id, {
      kind: "fillet",
      input: input.toIR(),
      edges: options.edges.toIR(),
      radius: ownedExpressionIR(
        this,
        options.radius,
        "length",
        `Fillet '${id}' radius`,
      ),
    });
    return issued(new SolidRef(this, key));
  }

  chamfer(
    id: string,
    input: SolidRef,
    options: {
      /** Seeds for maximal tangent-edge contours. */
      readonly edges: TopologySelection<"edge">;
      readonly distance: LengthExpression;
    },
  ): SolidRef {
    this.assertOwned(input);
    if (!(options.edges instanceof TopologySelection)) {
      throw new TypeError("Chamfer edges must be an explicit topology selection");
    }
    if (options.edges.topology !== "edge") {
      throw new TypeError("A chamfer requires an edge topology selection");
    }
    for (const reference of options.edges.references) {
      this.assertOwned(reference);
    }
    this.assertPersistentTopologyReferences(options.edges, input);
    assertTopologySelectionParametersOwned(
      this,
      options.edges,
      `Chamfer '${id}' edges`,
    );
    const key = this.addNode(id, {
      kind: "chamfer",
      input: input.toIR(),
      edges: options.edges.toIR(),
      distance: ownedExpressionIR(
        this,
        options.distance,
        "length",
        `Chamfer '${id}' distance`,
      ),
    });
    return issued(new SolidRef(this, key));
  }

  shell(
    id: string,
    input: SolidRef,
    options: {
      readonly openings: TopologySelection<"face">;
      /** Positive wall-thickness magnitude. */
      readonly thickness: LengthExpression;
      readonly direction?: ShellDirection;
      readonly tolerance?: LengthExpression;
    },
  ): SolidRef {
    this.assertOwned(input);
    if (!(options.openings instanceof TopologySelection)) {
      throw new TypeError("Shell openings must be an explicit topology selection");
    }
    if (options.openings.topology !== "face") {
      throw new TypeError("A shell requires a face topology selection");
    }
    for (const reference of options.openings.references) {
      this.assertOwned(reference);
    }
    this.assertPersistentTopologyReferences(options.openings, input);
    const direction = options.direction ?? "inward";
    if (!SHELL_DIRECTIONS.includes(direction)) {
      throw new TypeError("Shell direction must be 'inward' or 'outward'");
    }
    assertTopologySelectionParametersOwned(
      this,
      options.openings,
      `Shell '${id}' openings`,
    );
    const key = this.addNode(id, {
      kind: "shell",
      input: input.toIR(),
      openings: options.openings.toIR(),
      thickness: ownedExpressionIR(
        this,
        options.thickness,
        "length",
        `Shell '${id}' thickness`,
      ),
      direction,
      tolerance: ownedExpressionIR(
        this,
        options.tolerance ?? mm(1e-6),
        "length",
        `Shell '${id}' tolerance`,
      ),
    });
    return issued(new SolidRef(this, key));
  }

  offset(
    id: string,
    input: SolidRef,
    options: {
      /** Positive normal-offset magnitude. */
      readonly distance: LengthExpression;
      readonly direction?: OffsetDirection;
      readonly tolerance?: LengthExpression;
    },
  ): SolidRef {
    this.assertOwned(input);
    const direction = options.direction ?? "outward";
    if (!OFFSET_DIRECTIONS.includes(direction)) {
      throw new TypeError("Offset direction must be 'outward' or 'inward'");
    }
    const key = this.addNode(id, {
      kind: "offset",
      input: input.toIR(),
      distance: ownedExpressionIR(
        this,
        options.distance,
        "length",
        `Offset '${id}' distance`,
      ),
      direction,
      tolerance: ownedExpressionIR(
        this,
        options.tolerance ?? mm(1e-6),
        "length",
        `Offset '${id}' tolerance`,
      ),
    });
    return issued(new SolidRef(this, key));
  }

  draft(
    id: string,
    input: SolidRef,
    options: {
      /** Exact input faces drafted together in one atomic operation. */
      readonly faces: TopologySelection<"face">;
      /** Signed draft angle. */
      readonly angle: AngleExpression;
      /** Direction along which the drafted faces are pulled. */
      readonly pullDirection: ScalarVec3Expression;
      /** Arbitrary plane whose intersection with the drafted faces remains fixed. */
      readonly neutralPlane: {
        readonly origin: Vec3Expression;
        readonly normal: ScalarVec3Expression;
      };
    },
  ): SolidRef {
    this.assertOwned(input);
    if (!(options.faces instanceof TopologySelection)) {
      throw new TypeError("Draft faces must be an explicit topology selection");
    }
    if (options.faces.topology !== "face") {
      throw new TypeError("A draft requires a face topology selection");
    }
    for (const reference of options.faces.references) {
      this.assertOwned(reference);
    }
    this.assertPersistentTopologyReferences(options.faces, input);
    assertTopologySelectionParametersOwned(
      this,
      options.faces,
      `Draft '${id}' faces`,
    );
    const key = this.addNode(id, {
      kind: "draft",
      input: input.toIR(),
      faces: options.faces.toIR(),
      angle: ownedExpressionIR(this, options.angle, "angle", `Draft '${id}' angle`),
      pullDirection: ownedVec3IR(
        this,
        options.pullDirection,
        "scalar",
        `Draft '${id}' pullDirection`,
      ),
      neutralPlane: {
        origin: ownedVec3IR(
          this,
          options.neutralPlane.origin,
          "length",
          `Draft '${id}' neutralPlane origin`,
        ),
        normal: ownedVec3IR(
          this,
          options.neutralPlane.normal,
          "scalar",
          `Draft '${id}' neutralPlane normal`,
        ),
      },
    });
    return issued(new SolidRef(this, key));
  }

  part(
    id: string,
    solid: SolidRef,
    options: PartOptions = {},
  ): PartRef {
    this.assertOwned(solid);
    if (typeof options !== "object" || options === null) {
      throw new TypeError(`Part '${id}' options must be a record`);
    }
    // Options often come from a variable, which TypeScript's excess-property
    // check does not cover; unknown keys must not reach or override the node.
    for (const key of Object.keys(options)) {
      if (!PART_OPTION_KEYS.includes(key)) {
        throw new TypeError(
          `Part '${id}' options contain unsupported field '${key}'`,
        );
      }
    }
    // Read each option once, so an accessor cannot pass a check with one
    // value and supply another to the stored node.
    const {
      partNumber: rawPartNumber,
      description: rawDescription,
      material: rawMaterial,
      materialRef,
      massDensity: rawMassDensity,
      metadata: rawMetadata,
    } = options;
    if (rawMaterial !== undefined && materialRef !== undefined) {
      throw new TypeError("A part cannot use both material and materialRef");
    }
    if (materialRef !== undefined) this.assertOwned(materialRef);
    if (
      rawMassDensity !== undefined &&
      rawMassDensity?.dimension !== "massDensity"
    ) {
      throw new TypeError("Part massDensity must be a mass-density expression");
    }
    const partNumber = optionalString(
      rawPartNumber,
      `Part '${id}' partNumber`,
    );
    const description = optionalString(
      rawDescription,
      `Part '${id}' description`,
    );
    const material = optionalString(rawMaterial, `Part '${id}' material`);
    const metadata =
      rawMetadata === undefined
        ? undefined
        : detachMetadata(rawMetadata, `Part '${id}' metadata`);
    const massDensity =
      rawMassDensity === undefined
        ? undefined
        : ownedExpressionIR(
            this,
            rawMassDensity,
            "massDensity",
            `Part '${id}' massDensity`,
          );
    const materialId = materialRef?.id;
    const key = this.addNode(id, {
      kind: "part",
      solid: solid.toIR(),
      ...(partNumber === undefined ? {} : { partNumber }),
      ...(description === undefined ? {} : { description }),
      ...(material === undefined ? {} : { material }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(materialId === undefined ? {} : { materialId }),
      ...(massDensity === undefined ? {} : { massDensity }),
    });
    if (massDensity !== undefined) this.usesMassDensity = true;
    return issued(new PartRef(this, key));
  }

  assembly(
    id: string,
    build: (assembly: AssemblyBuilder) => void,
  ): AssemblyRef {
    const builder = new AssemblyBuilder(this);
    try {
      build(builder);
    } finally {
      CLOSED_ASSEMBLY_BUILDERS.add(builder);
      Object.freeze(builder.instances);
    }
    // instances is a public array, so only records instance() issued for
    // this builder may reach the document.
    const instances: AssemblyInstanceIR[] = [];
    const instanceIds = new Set<EntityId>();
    for (const instance of builder.instances) {
      if (ISSUED_ASSEMBLY_INSTANCES.get(instance) !== builder) {
        throw new TypeError(
          `Assembly '${id}' instances must be added with instance()`,
        );
      }
      if (instanceIds.has(instance.id)) {
        throw new TypeError(`Duplicate assembly instance '${instance.id}'`);
      }
      instanceIds.add(instance.id);
      instances.push(instance);
    }
    const node: AssemblyNodeIR = {
      kind: "assembly",
      instances,
    };
    const key = this.addNode(id, node);
    return issued(new AssemblyRef(this, key));
  }

  configuration(
    id: string,
    build: (configuration: ConfigurationBuilder) => void,
    options: ConfigurationOptions = {},
  ): ConfigurationId {
    const key = configurationId(id);
    if (
      Object.hasOwn(this.configurationRecords, key) ||
      this.pendingConfigurations.has(key)
    ) {
      throw new TypeError(`Duplicate configuration '${id}'`);
    }
    const builder = new ConfigurationBuilder(this);
    // Reserve the ID while the callback runs, so a nested configuration()
    // with the same ID cannot succeed and then be overwritten.
    this.pendingConfigurations.add(key);
    try {
      build(builder);
    } finally {
      this.pendingConfigurations.delete(key);
      CLOSED_CONFIGURATION_BUILDERS.add(builder);
    }
    this.configurationRecords[key] = builder.toIR(options);
    return key;
  }

  output(name: string, reference: SolidRef | PartRef | AssemblyRef): this {
    assertValidId(name, "Output name");
    this.assertOwned(reference);
    if (Object.hasOwn(this.outputRecords, name)) {
      throw new TypeError(`Duplicate output '${name}'`);
    }
    this.outputRecords[name] = deepFreeze(reference.toIR());
    return this;
  }

  build(): DesignDocumentV6 {
    return deepFreeze({
      schema: DOCUMENT_SCHEMA,
      version: DOCUMENT_VERSION,
      name: this.name,
      units: {
        length: "mm",
        angle: "rad",
        ...(this.usesMassDensity ? { mass: "kg" as const } : {}),
      },
      parameters: { ...this.parameterRecords },
      ...(Object.keys(this.materialRecords).length === 0
        ? {}
        : { materials: { ...this.materialRecords } }),
      ...(Object.keys(this.configurationRecords).length === 0
        ? {}
        : { configurations: { ...this.configurationRecords } }),
      ...(this.topologyReferenceCount === 0
        ? {}
        : { topologyReferences: { ...this.topologyReferenceRecords } }),
      nodes: { ...this.nodeRecords },
      outputs: { ...this.outputRecords },
      ...(this.metadata === undefined ? {} : { metadata: this.metadata }),
    });
  }
}

export function design(name: string, options?: DesignOptions): DesignBuilder {
  return new DesignBuilder(name, options);
}
