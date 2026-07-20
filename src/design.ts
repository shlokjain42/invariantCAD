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
  deg,
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
import { ProfileDefinition, SketchBuilder } from "./sketch.js";
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
      origin: [origin[0].ir, origin[1].ir, origin[2].ir],
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
      value: [value[0].ir, value[1].ir, value[2].ir],
    });
  },
  rotate(value: AngleVec3Expression): TransformOperationIR {
    return deepFreeze({
      kind: "rotate",
      value: [value[0].ir, value[1].ir, value[2].ir],
    });
  },
  scale(value: ScalarVec3Expression): TransformOperationIR {
    return deepFreeze({
      kind: "scale",
      value: [value[0].ir, value[1].ir, value[2].ir],
    });
  },
  mirror(normal: ScalarVec3Expression): TransformOperationIR {
    const operation: TransformOperationIR = {
      kind: "mirror",
      normal: [normal[0].ir, normal[1].ir, normal[2].ir],
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
    this.owner.assertOwned(component);
    const stableId = entityId(id);
    if (this.instances.some((instance) => instance.id === stableId)) {
      throw new TypeError(`Duplicate assembly instance '${id}'`);
    }
    this.instances.push(
      deepFreeze({
        id: stableId,
        component: component.toIR(),
        placement: options.placement ?? [],
        suppressed: options.suppressed ?? false,
      }),
    );
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
    this.owner.assertParameterOwned(parameter);
    if (value.dimension !== parameter.dimension) {
      throw new TypeError(
        `Configuration value for '${parameter.id}' must have dimension ${parameter.dimension}`,
      );
    }
    if (Object.hasOwn(this.parameterRecords, parameter.id)) {
      throw new TypeError(
        `Duplicate configuration parameter override '${parameter.id}'`,
      );
    }
    this.parameterRecords[parameter.id] = value.ir;
    return this;
  }

  instanceSuppressed(
    assembly: AssemblyRef,
    instanceId: string,
    suppressed = true,
  ): this {
    const stableId = this.owner.assertAssemblyInstance(assembly, instanceId);
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
    instances[stableId] = suppressed;
    return this;
  }

  partMaterial(part: PartRef, material: MaterialRef): this {
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
    return deepFreeze({
      ...(options.description === undefined
        ? {}
        : { description: options.description }),
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
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
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
  private readonly outputRecords = Object.create(null) as Record<
    string,
    RefIR<DesignOutputKind>
  >;
  private usesMassDensity = false;

  constructor(name: string, options: DesignOptions = {}) {
    if (name.trim().length === 0) throw new TypeError("A design requires a name");
    this.name = name;
    this.metadata = options.metadata;
  }

  assertOwned(reference: ModelRef<OutputKind> | MaterialRef): void {
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
    if (defaultValue.dimension !== dimension) {
      throw new TypeError(`Parameter '${id}' must have dimension ${dimension}`);
    }
    this.parameterRecords[key] = deepFreeze({
      dimension,
      default: defaultValue.ir,
      ...(options.min === undefined ? {} : { min: options.min.ir }),
      ...(options.max === undefined ? {} : { max: options.max.ir }),
      ...(options.label === undefined ? {} : { label: options.label }),
      ...(options.description === undefined
        ? {}
        : { description: options.description }),
    });
    if (dimension === "massDensity") this.usesMassDensity = true;
    const parameter = new ParameterClass(key, dimension);
    this.parameterReferences.add(parameter);
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
    if (options.name.trim().length === 0) {
      throw new TypeError(`Material '${id}' requires a non-empty name`);
    }
    if (options.massDensity.dimension !== "massDensity") {
      throw new TypeError("Material massDensity must be a mass-density expression");
    }
    this.materialRecords[key] = deepFreeze({
      name: options.name,
      massDensity: options.massDensity.ir,
      ...(options.description === undefined
        ? {}
        : { description: options.description }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    });
    this.usesMassDensity = true;
    return new MaterialRef(this, key);
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
    const reference = new TopologyReferenceRef(this, key, topology, target);
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
      size: options.size.map((item) => item.ir) as [
        typeof options.size[0]["ir"],
        typeof options.size[1]["ir"],
        typeof options.size[2]["ir"],
      ],
      center: options.center ?? false,
    });
    return new SolidRef(this, key);
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
      height: options.height.ir,
      radiusBottom: options.radius.ir,
      radiusTop: (options.radiusTop ?? options.radius).ir,
      center: options.center ?? false,
      ...(options.segments === undefined ? {} : { segments: options.segments }),
    });
    return new SolidRef(this, key);
  }

  sphere(
    id: string,
    options: { readonly radius: LengthExpression; readonly segments?: number },
  ): SolidRef {
    const key = this.addNode(id, {
      kind: "sphere",
      radius: options.radius.ir,
      ...(options.segments === undefined ? {} : { segments: options.segments }),
    });
    return new SolidRef(this, key);
  }

  sketch(
    id: string,
    sketchPlane: Plane,
    build: (sketch: SketchBuilder) => ProfileDefinition,
    options: { readonly tolerance?: number } = {},
  ): ProfileRef {
    const sketch = new SketchBuilder();
    const profile = build(sketch);
    if (!(profile instanceof ProfileDefinition)) {
      throw new TypeError("A sketch callback must return sketch.profile(...)");
    }
    const key = this.addNode(id, {
      kind: "sketch",
      plane: sketchPlane.ir,
      entities: sketch.entities,
      constraints: sketch.constraints,
      profile: profile.ir,
      tolerance: options.tolerance ?? 1e-7,
    });
    return new ProfileRef(this, key);
  }

  polylinePath(
    id: string,
    points: readonly Vec3Expression[],
    options: { readonly tolerance?: number } = {},
  ): PathRef {
    if (points.length < 2) {
      throw new TypeError("A polyline path requires at least two ordered points");
    }
    const tolerance = options.tolerance ?? 1e-7;
    if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
      throw new RangeError("Polyline path tolerance must be finite and positive");
    }
    const key = this.addNode(id, {
      kind: "polylinePath",
      points: points.map((point) => [point[0].ir, point[1].ir, point[2].ir]),
      closed: false,
      tolerance,
    });
    return new PathRef(this, key);
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
    const vector = (point: Vec3Expression) =>
      [point[0].ir, point[1].ir, point[2].ir] as const;
    const key = this.addNode(id, {
      kind: "circularArcPath",
      start: vector(points.start),
      through: vector(points.through),
      end: vector(points.end),
      closed: false,
      tolerance,
    });
    return new PathRef(this, key);
  }

  compositePath(
    id: string,
    path: {
      readonly start: Vec3Expression;
      readonly segments: readonly CompositePathSegmentExpression[];
    },
    options: { readonly tolerance?: number } = {},
  ): PathRef {
    if (path.segments.length < 2) {
      throw new TypeError(
        "A composite path requires at least two ordered segments",
      );
    }
    if (!path.segments.some((segment) => segment.kind === "circularArc")) {
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
    const vector = (point: Vec3Expression) =>
      [point[0].ir, point[1].ir, point[2].ir] as const;
    const key = this.addNode(id, {
      kind: "compositePath",
      start: vector(path.start),
      segments: path.segments.map((segment) =>
        segment.kind === "line"
          ? { kind: "line", end: vector(segment.end) }
          : {
              kind: "circularArc",
              through: vector(segment.through),
              end: vector(segment.end),
            },
      ),
      closed: false,
      tolerance,
    });
    return new PathRef(this, key);
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
    const key = this.addNode(id, {
      kind: "extrude",
      profile: profile.toIR(),
      distance: options.distance.ir,
      symmetric: options.symmetric ?? false,
      twist: (options.twist ?? deg(0)).ir,
      scaleTop: [scaleTop[0].ir, scaleTop[1].ir],
      divisions: options.divisions ?? 0,
    });
    return new SolidRef(this, key);
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
      angle: (options.angle ?? deg(360)).ir,
      ...(options.segments === undefined ? {} : { segments: options.segments }),
    });
    return new SolidRef(this, key);
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
    return new SolidRef(this, key);
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
    return new SolidRef(this, key);
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
    return new SolidRef(this, key);
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
    if (operations.length === 0) {
      throw new TypeError("A transform requires at least one operation");
    }
    const key = this.addNode(id, {
      kind: "transform",
      input: input.toIR(),
      operations,
    });
    return new SolidRef(this, key);
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
    const key = this.addNode(id, {
      kind: "fillet",
      input: input.toIR(),
      edges: options.edges.toIR(),
      radius: options.radius.ir,
    });
    return new SolidRef(this, key);
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
    const key = this.addNode(id, {
      kind: "chamfer",
      input: input.toIR(),
      edges: options.edges.toIR(),
      distance: options.distance.ir,
    });
    return new SolidRef(this, key);
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
    const key = this.addNode(id, {
      kind: "shell",
      input: input.toIR(),
      openings: options.openings.toIR(),
      thickness: options.thickness.ir,
      direction,
      tolerance: (options.tolerance ?? mm(1e-6)).ir,
    });
    return new SolidRef(this, key);
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
      distance: options.distance.ir,
      direction,
      tolerance: (options.tolerance ?? mm(1e-6)).ir,
    });
    return new SolidRef(this, key);
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
    const key = this.addNode(id, {
      kind: "draft",
      input: input.toIR(),
      faces: options.faces.toIR(),
      angle: options.angle.ir,
      pullDirection: [
        options.pullDirection[0].ir,
        options.pullDirection[1].ir,
        options.pullDirection[2].ir,
      ],
      neutralPlane: {
        origin: [
          options.neutralPlane.origin[0].ir,
          options.neutralPlane.origin[1].ir,
          options.neutralPlane.origin[2].ir,
        ],
        normal: [
          options.neutralPlane.normal[0].ir,
          options.neutralPlane.normal[1].ir,
          options.neutralPlane.normal[2].ir,
        ],
      },
    });
    return new SolidRef(this, key);
  }

  part(
    id: string,
    solid: SolidRef,
    options: PartOptions = {},
  ): PartRef {
    this.assertOwned(solid);
    if (options.material !== undefined && options.materialRef !== undefined) {
      throw new TypeError("A part cannot use both material and materialRef");
    }
    if (options.materialRef !== undefined) this.assertOwned(options.materialRef);
    if (
      options.massDensity !== undefined &&
      options.massDensity.dimension !== "massDensity"
    ) {
      throw new TypeError("Part massDensity must be a mass-density expression");
    }
    const { massDensity, materialRef, ...definition } = options;
    if (massDensity !== undefined) this.usesMassDensity = true;
    const key = this.addNode(id, {
      kind: "part",
      solid: solid.toIR(),
      ...definition,
      ...(materialRef === undefined ? {} : { materialId: materialRef.id }),
      ...(massDensity === undefined ? {} : { massDensity: massDensity.ir }),
    });
    return new PartRef(this, key);
  }

  assembly(
    id: string,
    build: (assembly: AssemblyBuilder) => void,
  ): AssemblyRef {
    const builder = new AssemblyBuilder(this);
    build(builder);
    const node: AssemblyNodeIR = {
      kind: "assembly",
      instances: builder.instances,
    };
    const key = this.addNode(id, node);
    return new AssemblyRef(this, key);
  }

  configuration(
    id: string,
    build: (configuration: ConfigurationBuilder) => void,
    options: ConfigurationOptions = {},
  ): ConfigurationId {
    const key = configurationId(id);
    if (Object.hasOwn(this.configurationRecords, key)) {
      throw new TypeError(`Duplicate configuration '${id}'`);
    }
    const builder = new ConfigurationBuilder(this);
    build(builder);
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
