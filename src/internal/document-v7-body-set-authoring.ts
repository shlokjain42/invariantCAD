import {
  assertValidId,
  entityId,
  nodeId,
  resourceId,
  type EntityId,
  type NodeId,
  type ResourceId,
} from "../core/ids.js";
import { deepFreeze, type JsonValue } from "../core/json.js";
import { CadError } from "../core/result.js";
import { utf8ByteLengthWithin } from "../core/utf8.js";
import {
  ConfigurationBuilder,
  DesignBuilder,
  type ConfigurationOptions,
  type DesignOptions,
  type ParameterOptions,
} from "../design.js";
import {
  type Expression,
  type LengthExpression,
  type Parameter,
  type Vec3Expression,
} from "../expressions.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type BodySetMemberIRV7,
  type DesignDocumentV7,
  type ImportedBodyNodeIRV7,
  type ImportedBodyLengthUnitV7,
  type NodeIRV7,
  type RefIRV7,
  type ResourceDefinitionIR,
  type ResourceDigestIR,
} from "../ir.js";
import {
  DEFAULT_DESIGN_DOCUMENT_LIMITS,
  preflightDesignDocumentValue,
} from "../document-limits.js";
import {
  parseDocumentValueV7,
  type ParseDocumentOptions,
} from "../serialization.js";

const STAGED_BODY_SET_DESIGN_OWNER = Symbol(
  "InvariantCAD.StagedBodySetDesignOwnerV7",
);
const RESOURCE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RESOURCE_MEDIA_TYPE_PATTERN =
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$/;
const authoringObjectPrototype = Object.prototype;
const authoringObjectCreate = Object.create;
const authoringObjectFreeze = Object.freeze;
const authoringObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const authoringObjectGetPrototypeOf = Object.getPrototypeOf;
const authoringObjectHasOwn = Object.hasOwn;
const authoringReflectApply = Reflect.apply;
const authoringReflectOwnKeys = Reflect.ownKeys;
const authoringArrayIsArray = Array.isArray;

function authoringApply<T>(
  method: CallableFunction,
  receiver: unknown,
  arguments_: readonly unknown[],
): T {
  return authoringReflectApply(method, receiver, arguments_) as T;
}

function captureExactOwnDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  let snapshot: Record<string, unknown> | undefined;
  let problem: string | undefined;
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      authoringApply<boolean>(authoringArrayIsArray, Array, [value])
    ) {
      problem = `${label} must be a plain record`;
    } else {
      const prototype = authoringApply<object | null>(
        authoringObjectGetPrototypeOf,
        Object,
        [value],
      );
      if (prototype !== null && prototype !== authoringObjectPrototype) {
        problem = `${label} must be a plain record`;
      } else {
        snapshot = authoringApply<Record<string, unknown>>(
          authoringObjectCreate,
          Object,
          [null],
        );
        const keys = authoringApply<(string | symbol)[]>(
          authoringReflectOwnKeys,
          Reflect,
          [value],
        );
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index]!;
          if (typeof key !== "string") {
            problem = `${label} cannot contain symbol properties`;
            break;
          }
          let supported = false;
          for (
            let allowedIndex = 0;
            allowedIndex < allowedKeys.length;
            allowedIndex += 1
          ) {
            if (allowedKeys[allowedIndex] === key) {
              supported = true;
              break;
            }
          }
          if (!supported) {
            problem = `${label} contains unsupported field '${key}'`;
            break;
          }
          const descriptor = authoringApply<
            PropertyDescriptor | undefined
          >(authoringObjectGetOwnPropertyDescriptor, Object, [value, key]);
          if (
            descriptor === undefined ||
            !authoringApply<boolean>(
              authoringObjectHasOwn,
              Object,
              [descriptor, "value"],
            )
          ) {
            problem = `${label}.${key} must be an own data property`;
            break;
          }
          snapshot[key] = descriptor.value;
        }
      }
    }
  } catch {
    throw new TypeError(`${label} could not be read safely`);
  }
  if (problem !== undefined) throw new TypeError(problem);
  return authoringApply<Readonly<Record<string, unknown>>>(
    authoringObjectFreeze,
    Object,
    [snapshot!],
  );
}

function detachMetadata(
  value: Readonly<Record<string, JsonValue>>,
  label: string,
): Readonly<Record<string, JsonValue>> {
  const captured = preflightDesignDocumentValue(
    value,
    DEFAULT_DESIGN_DOCUMENT_LIMITS,
    { strictV7Snapshot: true },
  );
  if (!captured.ok) {
    throw new CadError(
      captured.diagnostics[0]?.message ?? `${label} is invalid`,
      captured.diagnostics,
    );
  }
  if (
    typeof captured.value !== "object" ||
    captured.value === null ||
    Array.isArray(captured.value)
  ) {
    throw new TypeError(`${label} must be a JSON record`);
  }
  return deepFreeze(
    captured.value as Readonly<Record<string, JsonValue>>,
  );
}

/**
 * Caller-authored commitment to resolver-supplied bytes.
 *
 * Bytes, digest calculation, and location I/O deliberately remain outside the
 * staged builder.
 *
 * @internal
 */
export interface StagedResourceAuthoringOptionsV7 {
  readonly digest: ResourceDigestIR;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly locations?: readonly string[];
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/** Exact imported-body combinations admitted by protocol v1. @internal */
export type StagedImportedBodyAuthoringOptionsV7 =
  | {
      readonly format: "step";
      readonly units: { readonly mode: "from-file" };
    }
  | {
      readonly format: "brep" | "brep-binary";
      readonly units: {
        readonly mode: "declared";
        readonly length: ImportedBodyLengthUnitV7;
      };
    };

/** One active authored body-set membership. @internal */
export interface StagedBodySetMemberAuthoringV7 {
  readonly id: string;
  readonly solid: StagedBodyLeafRefV7;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/**
 * Document-owned resource handle for the staged authoring facade.
 *
 * @internal
 */
export class StagedResourceRefV7 {
  readonly id: ResourceId;
  readonly [STAGED_BODY_SET_DESIGN_OWNER]: StagedBodySetDesignBuilderV7;

  constructor(owner: StagedBodySetDesignBuilderV7, id: ResourceId) {
    this[STAGED_BODY_SET_DESIGN_OWNER] = owner;
    this.id = id;
    Object.freeze(this);
  }
}

/**
 * Direct primitive or imported-body leaf owned by one staged builder.
 *
 * This is deliberately not a general solid reference: transforms, Booleans,
 * sketches, and other downstream nodes are outside this executable slice.
 *
 * @internal
 */
export class StagedBodyLeafRefV7 {
  readonly kind = "solid" as const;
  readonly node: NodeId;
  readonly [STAGED_BODY_SET_DESIGN_OWNER]: StagedBodySetDesignBuilderV7;

  constructor(owner: StagedBodySetDesignBuilderV7, node: NodeId) {
    this[STAGED_BODY_SET_DESIGN_OWNER] = owner;
    this.node = node;
    Object.freeze(this);
  }

  toIR(): RefIRV7<"solid"> {
    return { node: this.node, kind: "solid" };
  }
}

/** Direct imported-body output handle. @internal */
export class StagedImportedBodyRefV7 extends StagedBodyLeafRefV7 {
  declare private readonly stagedImportedBodyRefV7Brand: void;
}

/** Direct body-set output handle. @internal */
export class StagedBodySetRefV7 {
  readonly kind = "bodySet" as const;
  readonly node: NodeId;
  readonly [STAGED_BODY_SET_DESIGN_OWNER]: StagedBodySetDesignBuilderV7;

  constructor(owner: StagedBodySetDesignBuilderV7, node: NodeId) {
    this[STAGED_BODY_SET_DESIGN_OWNER] = owner;
    this.node = node;
    Object.freeze(this);
  }

  toIR(): RefIRV7<"bodySet"> {
    return { node: this.node, kind: "bodySet" };
  }
}

/**
 * Parameter-only configuration surface for the executable staged graph.
 *
 * @internal
 */
export class StagedBodySetConfigurationBuilderV7 {
  readonly #builder: ConfigurationBuilder;

  constructor(builder: ConfigurationBuilder) {
    this.#builder = builder;
    Object.freeze(this);
  }

  parameter(
    parameter: Parameter<"length">,
    value: Expression<"length">,
  ): this {
    this.#builder.parameter(parameter, value);
    return this;
  }
}

/**
 * Repository-only authoring facade for the currently executable v7 graph.
 *
 * It composes the frozen v6 builder for length parameters and native
 * primitives, then emits a strictly parsed v7 document containing only direct
 * imported-body and body-set outputs.
 *
 * @internal
 */
export class StagedBodySetDesignBuilderV7 {
  readonly parameter: Readonly<{
    readonly length: (
      id: string,
      defaultValue: LengthExpression,
      options?: ParameterOptions<"length">,
    ) => Parameter<"length">;
  }>;

  readonly #base: DesignBuilder;
  readonly #nodeIds = new Set<NodeId>();
  readonly #resourceRecords = Object.create(null) as Record<
    ResourceId,
    ResourceDefinitionIR
  >;
  readonly #nodeRecords = Object.create(null) as Record<NodeId, NodeIRV7>;
  readonly #outputRecords = Object.create(null) as Record<
    string,
    RefIRV7<"solid" | "bodySet">
  >;
  readonly #resourceHandles = new WeakSet<object>();
  readonly #leafHandles = new WeakSet<object>();
  readonly #importedBodyHandles = new WeakSet<object>();
  readonly #bodySetHandles = new WeakSet<object>();
  #resourceCount = 0;
  #resourceLocationCount = 0;
  #resourceLocationBytes = 0;

  constructor(name: string, options: DesignOptions = {}) {
    this.#base = new DesignBuilder(name, {
      ...(options.metadata === undefined
        ? {}
        : { metadata: detachMetadata(options.metadata, "Design metadata") }),
    });
    this.parameter = Object.freeze({
      length: (
        id: string,
        defaultValue: LengthExpression,
        parameterOptions: ParameterOptions<"length"> = {},
      ): Parameter<"length"> =>
        this.#base.parameter.length(id, defaultValue, parameterOptions),
    });
  }

  #assertNodeAvailable(id: string): NodeId {
    const key = nodeId(id);
    if (this.#nodeIds.has(key)) {
      throw new TypeError(`Duplicate feature '${id}'`);
    }
    return key;
  }

  #registerLeaf(reference: StagedBodyLeafRefV7): StagedBodyLeafRefV7 {
    this.#leafHandles.add(reference);
    return reference;
  }

  #assertLeafOwned(reference: StagedBodyLeafRefV7): void {
    if (
      !this.#leafHandles.has(reference) ||
      reference[STAGED_BODY_SET_DESIGN_OWNER] !== this
    ) {
      throw new TypeError(
        "Body leaves cannot cross staged design boundaries",
      );
    }
  }

  box(
    id: string,
    options: { readonly size: Vec3Expression; readonly center?: boolean },
  ): StagedBodyLeafRefV7 {
    const key = this.#assertNodeAvailable(id);
    const reference = this.#base.box(id, options);
    this.#nodeIds.add(key);
    return this.#registerLeaf(
      new StagedBodyLeafRefV7(this, reference.node),
    );
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
  ): StagedBodyLeafRefV7 {
    const key = this.#assertNodeAvailable(id);
    const reference = this.#base.cylinder(id, options);
    this.#nodeIds.add(key);
    return this.#registerLeaf(
      new StagedBodyLeafRefV7(this, reference.node),
    );
  }

  sphere(
    id: string,
    options: {
      readonly radius: LengthExpression;
      readonly segments?: number;
    },
  ): StagedBodyLeafRefV7 {
    const key = this.#assertNodeAvailable(id);
    const reference = this.#base.sphere(id, options);
    this.#nodeIds.add(key);
    return this.#registerLeaf(
      new StagedBodyLeafRefV7(this, reference.node),
    );
  }

  configuration(
    id: string,
    build: (configuration: StagedBodySetConfigurationBuilderV7) => void,
    options: ConfigurationOptions = {},
  ): ReturnType<DesignBuilder["configuration"]> {
    const capturedOptions: ConfigurationOptions = {
      ...(options.description === undefined
        ? {}
        : { description: options.description }),
      ...(options.metadata === undefined
        ? {}
        : {
            metadata: detachMetadata(
              options.metadata,
              "Configuration metadata",
            ),
          }),
    };
    return this.#base.configuration(
      id,
      (configuration) =>
        build(new StagedBodySetConfigurationBuilderV7(configuration)),
      capturedOptions,
    );
  }

  resource(
    id: string,
    options: StagedResourceAuthoringOptionsV7,
  ): StagedResourceRefV7 {
    const capturedOptions = captureExactOwnDataRecord(
      options,
      ["digest", "byteLength", "mediaType", "locations", "metadata"],
      "Resource options",
    );
    const digest = capturedOptions.digest;
    const byteLength = capturedOptions.byteLength;
    const mediaType = capturedOptions.mediaType;
    const rawLocations = capturedOptions.locations;
    const metadata = capturedOptions.metadata;
    const key = resourceId(id);
    if (Object.hasOwn(this.#resourceRecords, key)) {
      throw new TypeError(`Duplicate resource '${id}'`);
    }
    if (
      this.#resourceCount >=
      DEFAULT_DESIGN_DOCUMENT_LIMITS.maxResourceDefinitions
    ) {
      throw new RangeError(
        `Resource definition count exceeds the authoring limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxResourceDefinitions}`,
      );
    }
    if (
      typeof digest !== "string" ||
      !RESOURCE_DIGEST_PATTERN.test(digest)
    ) {
      throw new TypeError(
        "Resource digest must be a lowercase sha256 commitment",
      );
    }
    if (
      !Number.isSafeInteger(byteLength) ||
      (byteLength as number) < 0
    ) {
      throw new TypeError(
        "Resource byteLength must be a non-negative safe integer",
      );
    }
    if (
      typeof mediaType !== "string" ||
      mediaType.trim() !== mediaType ||
      !RESOURCE_MEDIA_TYPE_PATTERN.test(mediaType)
    ) {
      throw new TypeError("Resource mediaType must be a non-empty MIME type");
    }

    let locations: readonly string[] | undefined;
    let addedLocationBytes = 0;
    if (rawLocations !== undefined) {
      if (!Array.isArray(rawLocations) || rawLocations.length === 0) {
        throw new TypeError(
          "Resource locations must be a non-empty dense array",
        );
      }
      if (
        this.#resourceLocationCount + rawLocations.length >
        DEFAULT_DESIGN_DOCUMENT_LIMITS.maxResourceLocations
      ) {
        throw new RangeError(
          `Resource locations exceed the authoring limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxResourceLocations}`,
        );
      }
      const copied = new Array<string>(rawLocations.length);
      const seen = new Set<string>();
      for (let index = 0; index < rawLocations.length; index += 1) {
        if (!Object.hasOwn(rawLocations, index)) {
          throw new TypeError("Resource locations must be a dense array");
        }
        const location = rawLocations[index];
        if (typeof location !== "string" || location.length === 0) {
          throw new TypeError("Resource locations must be non-empty strings");
        }
        if (seen.has(location)) {
          throw new TypeError(
            `Resource location '${location}' is duplicated`,
          );
        }
        seen.add(location);
        const remaining =
          DEFAULT_DESIGN_DOCUMENT_LIMITS.maxResourceLocationBytes -
          this.#resourceLocationBytes -
          addedLocationBytes;
        const byteLength = utf8ByteLengthWithin(location, remaining);
        if (byteLength === undefined) {
          throw new RangeError(
            `Resource location bytes exceed the authoring limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxResourceLocationBytes}`,
          );
        }
        addedLocationBytes += byteLength;
        copied[index] = location;
      }
      locations = Object.freeze(copied);
    }

    this.#resourceRecords[key] = deepFreeze({
      digest: digest as ResourceDigestIR,
      byteLength: byteLength as number,
      mediaType,
      ...(locations === undefined ? {} : { locations }),
      ...(metadata === undefined
        ? {}
        : {
            metadata: detachMetadata(
              metadata as Readonly<Record<string, JsonValue>>,
              "Resource metadata",
            ),
          }),
    });
    this.#resourceCount += 1;
    this.#resourceLocationCount += locations?.length ?? 0;
    this.#resourceLocationBytes += addedLocationBytes;
    const reference = new StagedResourceRefV7(this, key);
    this.#resourceHandles.add(reference);
    return reference;
  }

  importedBody(
    id: string,
    resource: StagedResourceRefV7,
    options: StagedImportedBodyAuthoringOptionsV7,
  ): StagedImportedBodyRefV7 {
    if (
      !this.#resourceHandles.has(resource) ||
      resource[STAGED_BODY_SET_DESIGN_OWNER] !== this
    ) {
      throw new TypeError(
        "Resources cannot cross staged design boundaries",
      );
    }
    const capturedOptions = captureExactOwnDataRecord(
      options,
      ["format", "units"],
      "Imported-body options",
    );
    const format = capturedOptions.format;
    const units = captureExactOwnDataRecord(
      capturedOptions.units,
      format === "step" ? ["mode"] : ["mode", "length"],
      "Imported-body units",
    );
    const key = this.#assertNodeAvailable(id);
    const validOptions =
      (format === "step" &&
        units.mode === "from-file") ||
      ((format === "brep" ||
        format === "brep-binary") &&
        units.mode === "declared" &&
        (units.length === "mm" ||
          units.length === "cm" ||
          units.length === "m" ||
          units.length === "in"));
    if (!validOptions) {
      throw new TypeError(
        "Imported-body format and unit mode are incompatible",
      );
    }
    const node: ImportedBodyNodeIRV7 =
      format === "step"
        ? {
            kind: "importedBody",
            resource: resource.id,
            format: "step",
            units: { mode: "from-file" },
            healing: { mode: "none" },
            expected: "single-solid",
          }
        : {
            kind: "importedBody",
            resource: resource.id,
            format,
            units: {
              mode: "declared",
              length: units.length as ImportedBodyLengthUnitV7,
            },
            healing: { mode: "none" },
            expected: "single-solid",
          };
    this.#nodeRecords[key] = deepFreeze(node);
    this.#nodeIds.add(key);
    const reference = new StagedImportedBodyRefV7(this, key);
    this.#registerLeaf(reference);
    this.#importedBodyHandles.add(reference);
    return reference;
  }

  bodySet(
    id: string,
    members: readonly StagedBodySetMemberAuthoringV7[],
  ): StagedBodySetRefV7 {
    const key = this.#assertNodeAvailable(id);
    if (!Array.isArray(members) || members.length === 0) {
      throw new TypeError("A body set requires a non-empty dense array");
    }
    if (
      members.length >
      DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues
    ) {
      throw new RangeError(
        `Body-set members exceed the authoring structural-value limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues}`,
      );
    }
    const copied = new Array<BodySetMemberIRV7>(members.length);
    const seen = new Set<EntityId>();
    for (let index = 0; index < members.length; index += 1) {
      if (!Object.hasOwn(members, index)) {
        throw new TypeError("Body-set members must be a dense array");
      }
      const member = captureExactOwnDataRecord(
        members[index],
        ["id", "solid", "name", "metadata"],
        `Body-set member ${index}`,
      );
      const memberId = entityId(member.id as string);
      if (seen.has(memberId)) {
        throw new TypeError(
          `Body-set member ID '${member.id}' is duplicated`,
        );
      }
      seen.add(memberId);
      const solid = member.solid as StagedBodyLeafRefV7;
      this.#assertLeafOwned(solid);
      if (
        member.name !== undefined &&
        (typeof member.name !== "string" || member.name.length === 0)
      ) {
        throw new TypeError("Body-set member names cannot be empty");
      }
      copied[index] = deepFreeze({
        id: memberId,
        solid: { node: solid.node, kind: "solid" },
        ...(member.name === undefined ? {} : { name: member.name }),
        ...(member.metadata === undefined
          ? {}
          : {
              metadata: detachMetadata(
                member.metadata as Readonly<Record<string, JsonValue>>,
                "Body-set member metadata",
              ),
            }),
      });
    }
    this.#nodeRecords[key] = deepFreeze({
      kind: "bodySet",
      bodies: Object.freeze(copied),
    });
    this.#nodeIds.add(key);
    const reference = new StagedBodySetRefV7(this, key);
    this.#bodySetHandles.add(reference);
    return reference;
  }

  output(
    name: string,
    reference: StagedImportedBodyRefV7 | StagedBodySetRefV7,
  ): this {
    assertValidId(name, "Output name");
    const imported =
      this.#importedBodyHandles.has(reference) &&
      reference[STAGED_BODY_SET_DESIGN_OWNER] === this;
    const bodySet =
      this.#bodySetHandles.has(reference) &&
      reference[STAGED_BODY_SET_DESIGN_OWNER] === this;
    if (!imported && !bodySet) {
      throw new TypeError(
        "Only owned direct imported bodies and body sets can be staged outputs",
      );
    }
    if (Object.hasOwn(this.#outputRecords, name)) {
      throw new TypeError(`Duplicate output '${name}'`);
    }
    this.#outputRecords[name] = deepFreeze({
      node: reference.node,
      kind: bodySet ? "bodySet" : "solid",
    });
    return this;
  }

  build(options: ParseDocumentOptions = {}): DesignDocumentV7 {
    const base = this.#base.build();
    const nativeNodes = Object.create(null) as Record<NodeId, NodeIRV7>;
    const nativeNodeIds = Object.keys(base.nodes) as NodeId[];
    for (let index = 0; index < nativeNodeIds.length; index += 1) {
      const id = nativeNodeIds[index]!;
      const node = base.nodes[id]!;
      if (
        node.kind !== "box" &&
        node.kind !== "cylinder" &&
        node.kind !== "sphere"
      ) {
        throw new TypeError(
          `Unsupported node '${id}' escaped the staged authoring facade`,
        );
      }
      nativeNodes[id] = node;
    }
    const candidate = {
      schema: DOCUMENT_SCHEMA_V7,
      version: DOCUMENT_VERSION_V7,
      name: base.name,
      units: base.units,
      parameters: base.parameters,
      ...(base.configurations === undefined
        ? {}
        : { configurations: base.configurations }),
      ...(this.#resourceCount === 0
        ? {}
        : { resources: { ...this.#resourceRecords } }),
      nodes: {
        ...nativeNodes,
        ...this.#nodeRecords,
      },
      outputs: { ...this.#outputRecords },
      ...(base.metadata === undefined ? {} : { metadata: base.metadata }),
    } satisfies DesignDocumentV7;
    const parsed = parseDocumentValueV7(candidate, options);
    if (!parsed.ok) {
      throw new CadError(
        parsed.diagnostics[0]?.message ??
          "The staged document-v7 design is invalid",
        parsed.diagnostics,
      );
    }
    return parsed.value;
  }
}

/**
 * Creates the repository-only authoring facade for executable direct v7 body
 * imports and body sets.
 *
 * @internal
 */
export function stagedBodySetDesignV7(
  name: string,
  options?: DesignOptions,
): StagedBodySetDesignBuilderV7 {
  return new StagedBodySetDesignBuilderV7(name, options);
}
