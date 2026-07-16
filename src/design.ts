import {
  assertValidId,
  entityId,
  nodeId,
  parameterId,
  type NodeId,
  type ParameterId,
} from "./core/ids.js";
import { deepFreeze, type JsonValue } from "./core/json.js";
import {
  deg,
  mm,
  scalar,
  type AngleExpression,
  type AngleVec3Expression,
  type Dimension,
  type Expression,
  type LengthExpression,
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
  type DesignDocument,
  type NodeIR,
  type OutputKind,
  type ParameterIR,
  type PlaneIR,
  type PrincipalPlane,
  type RefIR,
  type TransformOperationIR,
} from "./ir.js";
import { ProfileDefinition, SketchBuilder } from "./sketch.js";
import { TopologySelection } from "./topology.js";
import {
  SHELL_DIRECTIONS,
  type ShellDirection,
} from "./protocol/shell.js";

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

export interface ParameterOptions<D extends Dimension> {
  readonly min?: Expression<D>;
  readonly max?: Expression<D>;
  readonly label?: string;
  readonly description?: string;
}

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

export interface DesignOptions {
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export class DesignBuilder {
  readonly name: string;
  readonly metadata: Readonly<Record<string, JsonValue>> | undefined;
  private readonly parameterRecords: Record<ParameterId, ParameterIR> = {};
  private readonly nodeRecords: Record<NodeId, NodeIR> = {};
  private readonly outputRecords: Record<string, RefIR> = {};

  constructor(name: string, options: DesignOptions = {}) {
    if (name.trim().length === 0) throw new TypeError("A design requires a name");
    this.name = name;
    this.metadata = options.metadata;
  }

  assertOwned(reference: ModelRef<OutputKind>): void {
    if (reference[DESIGN_OWNER] !== this) {
      throw new TypeError("Model references cannot cross design boundaries");
    }
  }

  private parameterOf<D extends Dimension>(
    id: string,
    dimension: D,
    defaultValue: Expression<D>,
    options: ParameterOptions<D> = {},
  ): Parameter<D> {
    const key = parameterId(id);
    if (this.parameterRecords[key] !== undefined) {
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
    return new ParameterClass(key, dimension);
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
  };

  private addNode(id: string, node: NodeIR): NodeId {
    const key = nodeId(id);
    if (this.nodeRecords[key] !== undefined) {
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

  part(
    id: string,
    solid: SolidRef,
    options: {
      readonly partNumber?: string;
      readonly description?: string;
      readonly material?: string;
      readonly metadata?: Readonly<Record<string, JsonValue>>;
    } = {},
  ): PartRef {
    this.assertOwned(solid);
    const key = this.addNode(id, {
      kind: "part",
      solid: solid.toIR(),
      ...options,
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

  output(name: string, reference: SolidRef | PartRef | AssemblyRef): this {
    assertValidId(name, "Output name");
    this.assertOwned(reference);
    if (this.outputRecords[name] !== undefined) {
      throw new TypeError(`Duplicate output '${name}'`);
    }
    this.outputRecords[name] = deepFreeze(reference.toIR());
    return this;
  }

  build(): DesignDocument {
    return deepFreeze({
      schema: DOCUMENT_SCHEMA,
      version: DOCUMENT_VERSION,
      name: this.name,
      units: { length: "mm", angle: "rad" },
      parameters: { ...this.parameterRecords },
      nodes: { ...this.nodeRecords },
      outputs: { ...this.outputRecords },
      ...(this.metadata === undefined ? {} : { metadata: this.metadata }),
    });
  }
}

export function design(name: string, options?: DesignOptions): DesignBuilder {
  return new DesignBuilder(name, options);
}
