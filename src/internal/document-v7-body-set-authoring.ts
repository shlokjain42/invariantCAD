import {
  assertValidId,
  configurationId,
  entityId,
  materialId,
  nodeId,
  parameterId,
  resourceId,
  type ConfigurationId,
  type EntityId,
  type MaterialId,
  type NodeId,
  type ParameterId,
  type ResourceId,
} from "../core/ids.js";
import { deepFreeze, type JsonValue } from "../core/json.js";
import { CadError } from "../core/result.js";
import { utf8ByteLengthWithin } from "../core/utf8.js";
import {
  AssemblyRef,
  DesignBuilder,
  type ConfigurationOptions,
  type DesignOptions,
  MaterialRef,
  type MaterialOptions,
  type ParameterOptions,
  PartRef,
  type PartOptions,
} from "../design.js";
import {
  Expression,
  type AngleExpression,
  type AngleVec3Expression,
  type ExpressionIR,
  type LengthExpression,
  type MassDensityExpression,
  Parameter,
  type Vec3Expression,
  type ScalarExpression,
  type ScalarVec3Expression,
} from "../expressions.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type AssemblyInstanceIRV7,
  type AssemblyNodeIRV7,
  type BodySetMemberIRV7,
  type CoordinateSystemNodeIRV7,
  type DatumAxisNodeIRV7,
  type DatumPlaneNodeIRV7,
  type DatumPointNodeIRV7,
  type DesignConfigurationIR,
  type DesignDocumentV7,
  type ImportedBodyNodeIRV7,
  type ImportedBodyLengthUnitV7,
  type MaterialDefinitionIR,
  type NodeIRV7,
  type OccurrenceConfigurationIRV7,
  type PartNodeIRV7,
  type RefIRV7,
  type ResourceDefinitionIR,
  type ResourceDigestIR,
  type TransformOperationIR,
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
const STAGED_CONFIGURATION_TO_IR = Symbol(
  "InvariantCAD.StagedConfigurationToIRV7",
);
const STAGED_LOCAL_ASSEMBLY_TO_IR = Symbol(
  "InvariantCAD.StagedLocalAssemblyToIRV7",
);
const STAGED_DATUM_REFERENCE_CONSTRUCTION = Symbol(
  "InvariantCAD.StagedDatumReferenceConstructionV7",
);
const RESOURCE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RESOURCE_MEDIA_TYPE_PATTERN =
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$/;

interface StagedParameterIdentityV7 {
  readonly id: ParameterId;
  readonly dimension: "scalar" | "length" | "angle" | "massDensity";
}
const authoringObjectPrototype = Object.prototype;
const authoringArrayPrototype = Array.prototype;
const authoringExpressionPrototype = Expression.prototype;
const authoringParameterPrototype = Parameter.prototype;
const authoringObjectCreate = Object.create;
const authoringObjectDefineProperty = Object.defineProperty;
const authoringObjectFreeze = Object.freeze;
const authoringObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const authoringObjectGetPrototypeOf = Object.getPrototypeOf;
const authoringObjectHasOwn = Object.hasOwn;
const authoringObjectKeys = Object.keys;
const authoringReflectApply = Reflect.apply;
const authoringReflectOwnKeys = Reflect.ownKeys;
const AuthoringArray = Array;
const authoringArrayIsArray = Array.isArray;
const AuthoringSet = Set;
const authoringSetAdd = Set.prototype.add;
const authoringSetDelete = Set.prototype.delete;
const authoringSetHas = Set.prototype.has;
const AuthoringWeakMap = WeakMap;
const authoringWeakMapGet = WeakMap.prototype.get;
const authoringWeakMapSet = WeakMap.prototype.set;
const AuthoringWeakSet = WeakSet;
const authoringWeakSetAdd = WeakSet.prototype.add;
const authoringWeakSetHas = WeakSet.prototype.has;
const authoringCaptureFailures = new AuthoringWeakSet<object>();
const authoringRegExpTest = RegExp.prototype.test;
const authoringStringTrim = String.prototype.trim;
const authoringNumberIsSafeInteger = Number.isSafeInteger;

function authoringApply<T>(
  method: CallableFunction,
  receiver: unknown,
  arguments_: readonly unknown[],
): T {
  return authoringReflectApply(method, receiver, arguments_) as T;
}

function authoringFreeze<T>(value: T): T {
  return authoringApply<T>(authoringObjectFreeze, Object, [value]);
}

function authoringNullRecord<T extends object>(): T {
  return authoringApply<T>(authoringObjectCreate, Object, [null]);
}

function authoringHasOwn(
  value: object,
  key: PropertyKey,
): boolean {
  return authoringApply<boolean>(authoringObjectHasOwn, Object, [
    value,
    key,
  ]);
}

function authoringKeys(value: object): string[] {
  return authoringApply<string[]>(authoringObjectKeys, Object, [value]);
}

function authoringDenseArray<T>(length: number): T[] {
  return authoringApply<T[]>(AuthoringArray, undefined, [length]);
}

function authoringDefineArraySlot<T>(
  value: T[],
  index: number,
  item: T,
): void {
  authoringApply<T[]>(authoringObjectDefineProperty, Object, [
    value,
    index,
    {
      configurable: true,
      enumerable: true,
      value: item,
      writable: true,
    },
  ]);
}

function authoringSetContains<T>(
  set: ReadonlySet<T>,
  value: T,
): boolean {
  return authoringApply<boolean>(authoringSetHas, set, [value]);
}

function authoringSetInsert<T>(set: Set<T>, value: T): void {
  authoringApply<Set<T>>(authoringSetAdd, set, [value]);
}

function authoringSetRemove<T>(set: Set<T>, value: T): void {
  authoringApply<boolean>(authoringSetDelete, set, [value]);
}

function authoringWeakSetContains(
  set: WeakSet<object>,
  value: object,
): boolean {
  return authoringApply<boolean>(authoringWeakSetHas, set, [value]);
}

function authoringWeakSetInsert(
  set: WeakSet<object>,
  value: object,
): void {
  authoringApply<WeakSet<object>>(authoringWeakSetAdd, set, [value]);
}

function authoringWeakMapRead<V>(
  map: WeakMap<object, V>,
  key: object,
): V | undefined {
  return authoringApply<V | undefined>(authoringWeakMapGet, map, [key]);
}

function authoringWeakMapWrite<V>(
  map: WeakMap<object, V>,
  key: object,
  value: V,
): void {
  authoringApply<WeakMap<object, V>>(authoringWeakMapSet, map, [
    key,
    value,
  ]);
}

function authoringPatternMatches(
  pattern: RegExp,
  value: string,
): boolean {
  return authoringApply<boolean>(authoringRegExpTest, pattern, [value]);
}

function authoringTrim(value: string): string {
  return authoringApply<string>(authoringStringTrim, value, []);
}

function authoringIsSafeInteger(value: unknown): boolean {
  return authoringApply<boolean>(
    authoringNumberIsSafeInteger,
    Number,
    [value],
  );
}

function authoringIsArray(value: unknown): value is unknown[] {
  return authoringApply<boolean>(authoringArrayIsArray, Array, [value]);
}

function authoringCaptureFailure(message: string): TypeError {
  const error = new TypeError(message);
  authoringWeakSetInsert(authoringCaptureFailures, error);
  return error;
}

function isAuthoringCaptureFailure(value: unknown): value is TypeError {
  return (
    typeof value === "object" &&
    value !== null &&
    authoringWeakSetContains(authoringCaptureFailures, value)
  );
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
    authoringIsArray(captured.value)
  ) {
    throw new TypeError(`${label} must be a JSON record`);
  }
  return deepFreeze(
    captured.value as Readonly<Record<string, JsonValue>>,
  );
}

function captureParameterOptionsV7<
  D extends "scalar" | "length" | "angle" | "massDensity",
>(
  value: ParameterOptions<D>,
  dimension: D,
): ParameterOptions<D> {
  const label =
    dimension === "scalar"
      ? "Scalar-parameter options"
      : dimension === "length"
        ? "Length-parameter options"
        : dimension === "angle"
          ? "Angle-parameter options"
          : "Mass-density-parameter options";
  const captured = captureExactOwnDataRecord(
    value,
    ["min", "max", "label", "description"],
    label,
  );
  const min =
    captured.min === undefined
      ? undefined
      : captureStagedExpression(
          captured.min,
          dimension,
          `${label}.min`,
        );
  const max =
    captured.max === undefined
      ? undefined
      : captureStagedExpression(
          captured.max,
          dimension,
          `${label}.max`,
        );
  if (
    captured.label !== undefined &&
    typeof captured.label !== "string"
  ) {
    throw new TypeError(`${label}.label must be a string`);
  }
  if (
    captured.description !== undefined &&
    typeof captured.description !== "string"
  ) {
    throw new TypeError(`${label}.description must be a string`);
  }
  return authoringApply<ParameterOptions<D>>(
    authoringObjectFreeze,
    Object,
    [
      {
        ...(min === undefined ? {} : { min }),
        ...(max === undefined ? {} : { max }),
        ...(captured.label === undefined
          ? {}
          : { label: captured.label as string }),
        ...(captured.description === undefined
          ? {}
          : { description: captured.description as string }),
      },
    ],
  );
}

function captureDatumExpressionIR<
  D extends "length" | "angle" | "scalar" | "massDensity",
>(
  value: unknown,
  dimension: D,
  label: string,
): ExpressionIR {
  let expressionIR: unknown;
  try {
    if (typeof value !== "object" || value === null) {
      throw authoringCaptureFailure(
        `${label} must be a ${dimension} expression`,
      );
    }
    const prototype = authoringApply<object | null>(
      authoringObjectGetPrototypeOf,
      Object,
      [value],
    );
    if (
      prototype !== authoringExpressionPrototype &&
      prototype !== authoringParameterPrototype
    ) {
      throw authoringCaptureFailure(
        `${label} must be a ${dimension} expression`,
      );
    }
    const dimensionDescriptor = authoringApply<
      PropertyDescriptor | undefined
    >(authoringObjectGetOwnPropertyDescriptor, Object, [
      value,
      "dimension",
    ]);
    const irDescriptor = authoringApply<PropertyDescriptor | undefined>(
      authoringObjectGetOwnPropertyDescriptor,
      Object,
      [value, "ir"],
    );
    if (
      dimensionDescriptor === undefined ||
      !authoringHasOwn(dimensionDescriptor, "value") ||
      dimensionDescriptor.value !== dimension ||
      irDescriptor === undefined ||
      !authoringHasOwn(irDescriptor, "value")
    ) {
      throw authoringCaptureFailure(
        `${label} must be a ${dimension} expression`,
      );
    }
    expressionIR = irDescriptor.value;
  } catch (error) {
    if (isAuthoringCaptureFailure(error)) throw error;
    throw new TypeError(`${label} could not be read safely`);
  }

  const captured = preflightDesignDocumentValue(
    expressionIR,
    DEFAULT_DESIGN_DOCUMENT_LIMITS,
    { strictV7Snapshot: true },
  );
  if (!captured.ok) {
    throw new CadError(
      captured.diagnostics[0]?.message ??
        `${label} expression IR is invalid`,
      captured.diagnostics,
    );
  }
  if (
    typeof captured.value !== "object" ||
    captured.value === null ||
    authoringIsArray(captured.value) ||
    !authoringHasOwn(captured.value, "dimension") ||
    (captured.value as { readonly dimension?: unknown }).dimension !==
      dimension
  ) {
    throw new TypeError(`${label} must be a ${dimension} expression`);
  }
  return captured.value as ExpressionIR;
}

function captureStagedExpression<
  D extends "length" | "angle" | "scalar" | "massDensity",
>(
  value: unknown,
  dimension: D,
  label: string,
): Expression<D> {
  return authoringFreeze({
    dimension,
    ir: captureDatumExpressionIR(value, dimension, label),
  }) as Expression<D>;
}

function captureDatumVectorIR<D extends "length" | "angle" | "scalar">(
  value: unknown,
  dimension: D,
  label: string,
): readonly [ExpressionIR, ExpressionIR, ExpressionIR] {
  let values: readonly [unknown, unknown, unknown];
  try {
    if (!authoringIsArray(value)) {
      throw authoringCaptureFailure(
        `${label} must be a dense three-element array`,
      );
    }
    const prototype = authoringApply<object | null>(
      authoringObjectGetPrototypeOf,
      Object,
      [value],
    );
    if (prototype !== authoringArrayPrototype) {
      throw authoringCaptureFailure(`${label} must be a plain array`);
    }
    const keys = authoringApply<(string | symbol)[]>(
      authoringReflectOwnKeys,
      Reflect,
      [value],
    );
    if (keys.length !== 4) {
      throw authoringCaptureFailure(
        `${label} must be a dense three-element array`,
      );
    }
    const allowed = ["0", "1", "2", "length"];
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      let supported = false;
      for (
        let allowedIndex = 0;
        allowedIndex < allowed.length;
        allowedIndex += 1
      ) {
        if (key === allowed[allowedIndex]) {
          supported = true;
          break;
        }
      }
      if (!supported) {
        throw authoringCaptureFailure(
          `${label} contains unsupported properties`,
        );
      }
    }
    const lengthDescriptor = authoringApply<
      PropertyDescriptor | undefined
    >(authoringObjectGetOwnPropertyDescriptor, Object, [value, "length"]);
    if (
      lengthDescriptor === undefined ||
      !authoringHasOwn(lengthDescriptor, "value") ||
      lengthDescriptor.value !== 3
    ) {
      throw authoringCaptureFailure(
        `${label} must contain exactly three elements`,
      );
    }
    const copied = authoringDenseArray<unknown>(3);
    for (let index = 0; index < 3; index += 1) {
      const descriptor = authoringApply<
        PropertyDescriptor | undefined
      >(authoringObjectGetOwnPropertyDescriptor, Object, [
        value,
        String(index),
      ]);
      if (
        descriptor === undefined ||
        !authoringHasOwn(descriptor, "value")
      ) {
        throw authoringCaptureFailure(
          `${label}/${index} must be an own data property`,
        );
      }
      copied[index] = descriptor.value;
    }
    values = copied as unknown as readonly [unknown, unknown, unknown];
  } catch (error) {
    if (isAuthoringCaptureFailure(error)) throw error;
    throw new TypeError(`${label} could not be read safely`);
  }

  return authoringFreeze([
    captureDatumExpressionIR(values[0], dimension, `${label}/0`),
    captureDatumExpressionIR(values[1], dimension, `${label}/1`),
    captureDatumExpressionIR(values[2], dimension, `${label}/2`),
  ]);
}

function captureDenseOwnDataArray(
  value: unknown,
  label: string,
  options: {
    readonly exactLength?: number;
    readonly maximumLength?: number;
  } = {},
): readonly unknown[] {
  let copied: unknown[] | undefined;
  let problem: string | undefined;
  let rangeProblem: string | undefined;
  try {
    if (!authoringIsArray(value)) {
      problem = `${label} must be a dense array`;
    } else {
      const prototype = authoringApply<object | null>(
        authoringObjectGetPrototypeOf,
        Object,
        [value],
      );
      if (prototype !== authoringArrayPrototype) {
        problem = `${label} must be a plain array`;
      } else {
        const lengthDescriptor = authoringApply<
          PropertyDescriptor | undefined
        >(authoringObjectGetOwnPropertyDescriptor, Object, [
          value,
          "length",
        ]);
        const length =
          lengthDescriptor !== undefined &&
          authoringHasOwn(lengthDescriptor, "value")
            ? lengthDescriptor.value
            : undefined;
        if (
          !authoringIsSafeInteger(length) ||
          (length as number) < 0
        ) {
          problem = `${label} has an invalid length`;
        } else if (
          options.exactLength !== undefined &&
          length !== options.exactLength
        ) {
          problem = `${label} must contain exactly ${options.exactLength} elements`;
        } else if (
          options.maximumLength !== undefined &&
          (length as number) > options.maximumLength
        ) {
          rangeProblem = `${label} exceeds the authoring limit of ${options.maximumLength}`;
        } else {
          const ownKeys = authoringApply<(string | symbol)[]>(
            authoringReflectOwnKeys,
            Reflect,
            [value],
          );
          if (ownKeys.length !== (length as number) + 1) {
            problem = `${label} must be dense and cannot contain non-index properties`;
          } else {
            const allowed = new AuthoringSet<PropertyKey>();
            authoringSetInsert(allowed, "length");
            for (let index = 0; index < (length as number); index += 1) {
              authoringSetInsert(allowed, String(index));
            }
            for (let index = 0; index < ownKeys.length; index += 1) {
              if (!authoringSetContains(allowed, ownKeys[index]!)) {
                problem = `${label} must be dense and cannot contain non-index properties`;
                break;
              }
            }
            if (problem === undefined) {
              copied = authoringDenseArray<unknown>(length as number);
              for (
                let index = 0;
                index < (length as number);
                index += 1
              ) {
                const descriptor = authoringApply<
                  PropertyDescriptor | undefined
                >(authoringObjectGetOwnPropertyDescriptor, Object, [
                  value,
                  String(index),
                ]);
                if (
                  descriptor === undefined ||
                  !authoringHasOwn(descriptor, "value")
                ) {
                  problem = `${label}/${index} must be an own data property`;
                  break;
                }
                authoringDefineArraySlot(copied, index, descriptor.value);
              }
            }
          }
        }
      }
    }
  } catch {
    throw new TypeError(`${label} could not be read safely`);
  }
  if (rangeProblem !== undefined) throw new RangeError(rangeProblem);
  if (problem !== undefined) throw new TypeError(problem);
  return authoringFreeze(copied!);
}

function captureTransformExpressionIR(
  value: unknown,
  dimension: "length" | "angle" | "scalar",
  label: string,
): ExpressionIR {
  const captured = preflightDesignDocumentValue(
    value,
    DEFAULT_DESIGN_DOCUMENT_LIMITS,
    { strictV7Snapshot: true },
  );
  if (!captured.ok) {
    throw new CadError(
      captured.diagnostics[0]?.message ??
        `${label} expression IR is invalid`,
      captured.diagnostics,
    );
  }
  if (
    typeof captured.value !== "object" ||
    captured.value === null ||
    authoringIsArray(captured.value) ||
    !authoringHasOwn(captured.value, "dimension") ||
    (captured.value as { readonly dimension?: unknown }).dimension !==
      dimension
  ) {
    throw new TypeError(`${label} must be a ${dimension} expression IR`);
  }
  return deepFreeze(captured.value as ExpressionIR);
}

function captureTransformVectorIR(
  value: unknown,
  dimension: "length" | "angle" | "scalar",
  label: string,
): readonly [ExpressionIR, ExpressionIR, ExpressionIR] {
  const values = captureDenseOwnDataArray(value, label, {
    exactLength: 3,
  });
  return authoringFreeze([
    captureTransformExpressionIR(values[0], dimension, `${label}/0`),
    captureTransformExpressionIR(values[1], dimension, `${label}/1`),
    captureTransformExpressionIR(values[2], dimension, `${label}/2`),
  ]);
}

function captureTransformOperationIR(
  value: unknown,
  label: string,
): TransformOperationIR {
  const captured = captureExactOwnDataRecord(
    value,
    ["kind", "value", "normal"],
    label,
  );
  const kind = captured.kind;
  if (
    kind === "translate" ||
    kind === "rotate" ||
    kind === "scale"
  ) {
    if (
      !authoringHasOwn(captured, "value") ||
      authoringHasOwn(captured, "normal")
    ) {
      throw new TypeError(
        `${label} '${kind}' requires only a value vector`,
      );
    }
    return deepFreeze({
      kind,
      value: captureTransformVectorIR(
        captured.value,
        kind === "translate"
          ? "length"
          : kind === "rotate"
            ? "angle"
            : "scalar",
        `${label}.value`,
      ),
    });
  }
  if (kind === "mirror") {
    if (
      !authoringHasOwn(captured, "normal") ||
      authoringHasOwn(captured, "value")
    ) {
      throw new TypeError(
        `${label} 'mirror' requires only a normal vector`,
      );
    }
    return deepFreeze({
      kind: "mirror",
      normal: captureTransformVectorIR(
        captured.normal,
        "scalar",
        `${label}.normal`,
      ),
    });
  }
  throw new TypeError(`${label}.kind is not a supported transform`);
}

function capturePlacementIR(
  value: unknown,
  label: string,
): readonly TransformOperationIR[] {
  const operations = captureDenseOwnDataArray(value, label, {
    maximumLength: DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues,
  });
  const copied = authoringDenseArray<TransformOperationIR>(
    operations.length,
  );
  for (let index = 0; index < operations.length; index += 1) {
    authoringDefineArraySlot(
      copied,
      index,
      captureTransformOperationIR(
        operations[index],
        `${label}/${index}`,
      ),
    );
  }
  return authoringFreeze(copied);
}

function captureOccurrenceConfigurationIR(
  value: unknown,
  label: string,
): OccurrenceConfigurationIRV7 {
  const captured = captureExactOwnDataRecord(
    value,
    ["mode", "id"],
    label,
  );
  if (captured.mode === "inherit" || captured.mode === "base") {
    if (authoringHasOwn(captured, "id")) {
      throw new TypeError(
        `${label} mode '${captured.mode}' cannot contain an id`,
      );
    }
    return authoringFreeze({ mode: captured.mode });
  }
  if (captured.mode === "named") {
    if (
      !authoringHasOwn(captured, "id") ||
      typeof captured.id !== "string"
    ) {
      throw new TypeError(`${label} mode 'named' requires an id`);
    }
    return authoringFreeze({
      mode: "named",
      id: configurationId(captured.id),
    });
  }
  throw new TypeError(`${label}.mode is invalid`);
}

function assertOptionalString(
  value: unknown,
  label: string,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${label} must be a string`);
  }
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
  readonly solid: StagedSolidRefV7;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

/** Options for one local part or assembly occurrence. @internal */
export interface StagedLocalAssemblyInstanceOptionsV7 {
  readonly placement?: readonly TransformOperationIR[];
  readonly suppressed?: boolean;
  readonly configuration?: OccurrenceConfigurationIRV7;
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
    authoringFreeze(this);
  }
}

/**
 * General executable solid reference owned by one staged builder.
 *
 * This handle currently covers native/imported leaves and transform nodes.
 * Additional solid-producing graph nodes remain outside this executable slice.
 *
 * @internal
 */
export class StagedSolidRefV7 {
  readonly kind = "solid" as const;
  readonly node: NodeId;
  readonly [STAGED_BODY_SET_DESIGN_OWNER]: StagedBodySetDesignBuilderV7;

  constructor(owner: StagedBodySetDesignBuilderV7, node: NodeId) {
    this[STAGED_BODY_SET_DESIGN_OWNER] = owner;
    this.node = node;
    authoringFreeze(this);
  }

  toIR(): RefIRV7<"solid"> {
    return { node: this.node, kind: "solid" };
  }
}

/** Direct primitive or imported-body leaf owned by one staged builder. @internal */
export class StagedBodyLeafRefV7 extends StagedSolidRefV7 {
  declare private readonly stagedBodyLeafRefV7Brand: void;

  override toIR(): RefIRV7<"solid"> {
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
    authoringFreeze(this);
  }

  toIR(): RefIRV7<"bodySet"> {
    return { node: this.node, kind: "bodySet" };
  }
}

type StagedDatumKindV7 =
  | "datumPoint"
  | "datumAxis"
  | "datumPlane"
  | "coordinateSystem";

/**
 * Owner-bound reference to one staged datum definition.
 *
 * Datums are not document outputs in this slice. The frozen reference shape
 * is reserved for later feature consumers without exposing v7 publicly.
 *
 * @internal
 */
export class StagedDatumRefV7<K extends StagedDatumKindV7> {
  readonly kind: K;
  readonly node: NodeId;
  readonly [STAGED_BODY_SET_DESIGN_OWNER]: StagedBodySetDesignBuilderV7;

  constructor(
    owner: StagedBodySetDesignBuilderV7,
    node: NodeId,
    kind: K,
    construction: unknown,
  ) {
    if (construction !== STAGED_DATUM_REFERENCE_CONSTRUCTION) {
      throw new TypeError(
        "Staged datum references can only be created by their owning design",
      );
    }
    this[STAGED_BODY_SET_DESIGN_OWNER] = owner;
    this.node = node;
    this.kind = kind;
    authoringFreeze(this);
  }

  toIR(): RefIRV7<K> {
    return authoringFreeze({ node: this.node, kind: this.kind });
  }
}

/** @internal */
export class StagedDatumPointRefV7 extends StagedDatumRefV7<"datumPoint"> {
  declare private readonly stagedDatumPointRefV7Brand: void;

  constructor(
    owner: StagedBodySetDesignBuilderV7,
    node: NodeId,
    construction: unknown,
  ) {
    super(owner, node, "datumPoint", construction);
  }
}

/** @internal */
export class StagedDatumAxisRefV7 extends StagedDatumRefV7<"datumAxis"> {
  declare private readonly stagedDatumAxisRefV7Brand: void;

  constructor(
    owner: StagedBodySetDesignBuilderV7,
    node: NodeId,
    construction: unknown,
  ) {
    super(owner, node, "datumAxis", construction);
  }
}

/** @internal */
export class StagedDatumPlaneRefV7 extends StagedDatumRefV7<"datumPlane"> {
  declare private readonly stagedDatumPlaneRefV7Brand: void;

  constructor(
    owner: StagedBodySetDesignBuilderV7,
    node: NodeId,
    construction: unknown,
  ) {
    super(owner, node, "datumPlane", construction);
  }
}

/** @internal */
export class StagedCoordinateSystemRefV7 extends StagedDatumRefV7<"coordinateSystem"> {
  declare private readonly stagedCoordinateSystemRefV7Brand: void;

  constructor(
    owner: StagedBodySetDesignBuilderV7,
    node: NodeId,
    construction: unknown,
  ) {
    super(owner, node, "coordinateSystem", construction);
  }
}

/**
 * Local part and nested-assembly authoring for the executable staged graph.
 *
 * External document occurrences remain outside this slice even though the
 * frozen v7 grammar already reserves them.
 *
 * @internal
 */
export class StagedLocalAssemblyBuilderV7 {
  readonly #partHandles: WeakSet<object>;
  readonly #assemblyHandles: WeakSet<object>;
  readonly #partHandleIds: WeakMap<object, NodeId>;
  readonly #assemblyHandleIds: WeakMap<object, NodeId>;
  readonly #instances: AssemblyInstanceIRV7[] = [];
  readonly #instanceIds = new AuthoringSet<EntityId>();

  constructor(
    partHandles: WeakSet<object>,
    assemblyHandles: WeakSet<object>,
    partHandleIds: WeakMap<object, NodeId>,
    assemblyHandleIds: WeakMap<object, NodeId>,
  ) {
    this.#partHandles = partHandles;
    this.#assemblyHandles = assemblyHandles;
    this.#partHandleIds = partHandleIds;
    this.#assemblyHandleIds = assemblyHandleIds;
    authoringFreeze(this);
  }

  instance(
    id: string,
    component: PartRef | AssemblyRef,
    options: StagedLocalAssemblyInstanceOptionsV7 = {},
  ): this {
    const partNode = authoringWeakMapRead(
      this.#partHandleIds,
      component,
    );
    const assemblyNode = authoringWeakMapRead(
      this.#assemblyHandleIds,
      component,
    );
    let componentReference: RefIRV7<"part" | "assembly">;
    if (
      partNode !== undefined &&
      authoringWeakSetContains(this.#partHandles, component)
    ) {
      componentReference = { node: partNode, kind: "part" };
    } else if (
      assemblyNode !== undefined &&
      authoringWeakSetContains(this.#assemblyHandles, component)
    ) {
      // Only already-completed assemblies have an owned handle, so authored
      // nested graphs are acyclic by construction.
      componentReference = {
        node: assemblyNode,
        kind: "assembly",
      };
    } else {
      throw new TypeError(
        "Assembly components cannot cross staged design boundaries",
      );
    }
    if (
      this.#instances.length >=
      DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues
    ) {
      throw new RangeError(
        `Assembly instances exceed the authoring structural-value limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues}`,
      );
    }
    const captured = captureExactOwnDataRecord(
      options,
      ["placement", "suppressed", "configuration"],
      `Assembly instance '${id}' options`,
    );
    if (
      captured.suppressed !== undefined &&
      typeof captured.suppressed !== "boolean"
    ) {
      throw new TypeError(
        `Assembly instance '${id}' suppressed must be a boolean`,
      );
    }
    const stableId = entityId(id);
    if (authoringSetContains(this.#instanceIds, stableId)) {
      throw new TypeError(`Duplicate assembly instance '${id}'`);
    }
    const placement =
      captured.placement === undefined
        ? authoringFreeze([] as TransformOperationIR[])
        : capturePlacementIR(
            captured.placement,
            `Assembly instance '${id}' placement`,
          );
    const configuration =
      captured.configuration === undefined
        ? authoringFreeze({ mode: "inherit" as const })
        : captureOccurrenceConfigurationIR(
            captured.configuration,
            `Assembly instance '${id}' configuration`,
          );
    const instance: AssemblyInstanceIRV7 = deepFreeze({
      id: stableId,
      component: {
        source: "local",
        reference: componentReference,
      },
      configuration,
      placement,
      suppressed: captured.suppressed ?? false,
    });
    authoringSetInsert(this.#instanceIds, stableId);
    authoringDefineArraySlot(
      this.#instances,
      this.#instances.length,
      instance,
    );
    return this;
  }

  [STAGED_LOCAL_ASSEMBLY_TO_IR](): readonly AssemblyInstanceIRV7[] {
    const copied = authoringDenseArray<AssemblyInstanceIRV7>(
      this.#instances.length,
    );
    for (let index = 0; index < this.#instances.length; index += 1) {
      authoringDefineArraySlot(copied, index, this.#instances[index]!);
    }
    return authoringFreeze(copied);
  }
}

const stagedLocalAssemblyToIRV7 =
  StagedLocalAssemblyBuilderV7.prototype[STAGED_LOCAL_ASSEMBLY_TO_IR];

/** Configuration surface for the executable staged graph. @internal */
export class StagedBodySetConfigurationBuilderV7 {
  readonly #parameterHandles: WeakMap<
    object,
    StagedParameterIdentityV7
  >;
  readonly #partHandles: WeakSet<object>;
  readonly #materialHandles: WeakSet<object>;
  readonly #assemblyHandles: WeakSet<object>;
  readonly #partHandleIds: WeakMap<object, NodeId>;
  readonly #materialHandleIds: WeakMap<object, MaterialId>;
  readonly #assemblyHandleIds: WeakMap<object, NodeId>;
  readonly #assemblyHandleInstanceIds: WeakMap<
    object,
    ReadonlySet<EntityId>
  >;
  readonly #parameterRecords = authoringNullRecord<Record<
    ParameterId,
    ExpressionIR
  >>();
  readonly #partMaterialRecords = authoringNullRecord<Record<
    NodeId,
    MaterialId
  >>();
  readonly #instanceSuppressionRecords = authoringNullRecord<Record<
    NodeId,
    Record<EntityId, boolean>
  >>();

  constructor(
    parameterHandles: WeakMap<object, StagedParameterIdentityV7>,
    partHandles: WeakSet<object>,
    materialHandles: WeakSet<object>,
    assemblyHandles: WeakSet<object>,
    partHandleIds: WeakMap<object, NodeId>,
    materialHandleIds: WeakMap<object, MaterialId>,
    assemblyHandleIds: WeakMap<object, NodeId>,
    assemblyHandleInstanceIds: WeakMap<
      object,
      ReadonlySet<EntityId>
    >,
  ) {
    this.#parameterHandles = parameterHandles;
    this.#partHandles = partHandles;
    this.#materialHandles = materialHandles;
    this.#assemblyHandles = assemblyHandles;
    this.#partHandleIds = partHandleIds;
    this.#materialHandleIds = materialHandleIds;
    this.#assemblyHandleIds = assemblyHandleIds;
    this.#assemblyHandleInstanceIds = assemblyHandleInstanceIds;
    authoringFreeze(this);
  }

  parameter<
    D extends "scalar" | "length" | "angle" | "massDensity",
  >(
    parameter: Parameter<D>,
    value: Expression<NoInfer<D>>,
  ): this {
    const identity = authoringWeakMapRead(
      this.#parameterHandles,
      parameter,
    );
    if (identity === undefined) {
      throw new TypeError(
        "Parameter references cannot cross staged design boundaries",
      );
    }
    const expression = captureDatumExpressionIR(
      value,
      identity.dimension,
      `Configuration value for '${identity.id}'`,
    );
    if (authoringHasOwn(this.#parameterRecords, identity.id)) {
      throw new TypeError(
        `Duplicate configuration parameter override '${identity.id}'`,
      );
    }
    this.#parameterRecords[identity.id] = expression;
    return this;
  }

  partMaterial(part: PartRef, material: MaterialRef): this {
    const partId = authoringWeakMapRead(this.#partHandleIds, part);
    if (
      !authoringWeakSetContains(this.#partHandles, part) ||
      partId === undefined
    ) {
      throw new TypeError(
        "Parts cannot cross staged design boundaries",
      );
    }
    const materialId = authoringWeakMapRead(
      this.#materialHandleIds,
      material,
    );
    if (
      !authoringWeakSetContains(this.#materialHandles, material) ||
      materialId === undefined
    ) {
      throw new TypeError(
        "Materials cannot cross staged design boundaries",
      );
    }
    if (authoringHasOwn(this.#partMaterialRecords, partId)) {
      throw new TypeError(
        `Duplicate configuration material override '${partId}'`,
      );
    }
    this.#partMaterialRecords[partId] = materialId;
    return this;
  }

  instanceSuppressed(
    assembly: AssemblyRef,
    instanceId: string,
    suppressed = true,
  ): this {
    const assemblyId = authoringWeakMapRead(
      this.#assemblyHandleIds,
      assembly,
    );
    const instanceIds = authoringWeakMapRead(
      this.#assemblyHandleInstanceIds,
      assembly,
    );
    if (
      !authoringWeakSetContains(this.#assemblyHandles, assembly) ||
      assemblyId === undefined ||
      instanceIds === undefined
    ) {
      throw new TypeError(
        "Assemblies cannot cross staged design boundaries",
      );
    }
    if (typeof suppressed !== "boolean") {
      throw new TypeError(
        "Configuration instance suppression must be a boolean",
      );
    }
    const stableId = entityId(instanceId);
    if (!authoringSetContains(instanceIds, stableId)) {
      throw new RangeError(
        `Assembly '${assemblyId}' has no instance '${instanceId}'`,
      );
    }
    let records = this.#instanceSuppressionRecords[assemblyId];
    if (records === undefined) {
      records = authoringNullRecord<Record<EntityId, boolean>>();
      this.#instanceSuppressionRecords[assemblyId] = records;
    }
    if (authoringHasOwn(records, stableId)) {
      throw new TypeError(
        `Duplicate configuration instance override '${assemblyId}/${stableId}'`,
      );
    }
    records[stableId] = suppressed;
    return this;
  }

  [STAGED_CONFIGURATION_TO_IR](
    options: ConfigurationOptions,
  ): DesignConfigurationIR {
    const parameterIds = authoringKeys(this.#parameterRecords);
    const partIds = authoringKeys(this.#partMaterialRecords);
    const assemblyIds = authoringKeys(
      this.#instanceSuppressionRecords,
    );
    if (
      parameterIds.length === 0 &&
      partIds.length === 0 &&
      assemblyIds.length === 0
    ) {
      throw new TypeError("A configuration requires at least one override");
    }
    return deepFreeze({
      ...(options.description === undefined
        ? {}
        : { description: options.description }),
      ...(parameterIds.length === 0
        ? {}
        : { parameterOverrides: { ...this.#parameterRecords } }),
      ...(partIds.length === 0
        ? {}
        : { partMaterialOverrides: { ...this.#partMaterialRecords } }),
      ...(assemblyIds.length === 0
        ? {}
        : {
            instanceSuppressions: deepFreeze({
              ...this.#instanceSuppressionRecords,
            }),
          }),
      ...(options.metadata === undefined
        ? {}
        : { metadata: options.metadata }),
    });
  }
}

/**
 * Repository-only authoring facade for the currently executable v7 graph.
 *
 * It composes the frozen v6 builder for admitted parameters and native
 * primitives, then adds staged configurations, direct resources, imported
 * bodies, body sets, parts, and material intent before strict v7 parsing.
 *
 * @internal
 */
export class StagedBodySetDesignBuilderV7 {
  readonly parameter: Readonly<{
    readonly scalar: (
      id: string,
      defaultValue: ScalarExpression,
      options?: ParameterOptions<"scalar">,
    ) => Parameter<"scalar">;
    readonly length: (
      id: string,
      defaultValue: LengthExpression,
      options?: ParameterOptions<"length">,
    ) => Parameter<"length">;
    readonly angle: (
      id: string,
      defaultValue: AngleExpression,
      options?: ParameterOptions<"angle">,
    ) => Parameter<"angle">;
    readonly massDensity: (
      id: string,
      defaultValue: MassDensityExpression,
      options?: ParameterOptions<"massDensity">,
    ) => Parameter<"massDensity">;
  }>;

  readonly #base: DesignBuilder;
  readonly #handleOwner: DesignBuilder;
  readonly #nodeIds = new AuthoringSet<NodeId>();
  readonly #configurationRecords = authoringNullRecord<Record<
    ConfigurationId,
    DesignConfigurationIR
  >>();
  readonly #materialRecords = authoringNullRecord<Record<
    MaterialId,
    MaterialDefinitionIR
  >>();
  readonly #resourceRecords = authoringNullRecord<Record<
    ResourceId,
    ResourceDefinitionIR
  >>();
  readonly #nodeRecords = authoringNullRecord<Record<NodeId, NodeIRV7>>();
  readonly #outputRecords = authoringNullRecord<Record<
    string,
    RefIRV7<"solid" | "bodySet" | "part" | "assembly">
  >>();
  readonly #materialHandles = new AuthoringWeakSet<object>();
  readonly #materialHandleIds = new AuthoringWeakMap<
    object,
    MaterialId
  >();
  readonly #resourceHandles = new AuthoringWeakSet<object>();
  readonly #solidHandles = new AuthoringWeakSet<object>();
  readonly #importedBodyHandles = new AuthoringWeakSet<object>();
  readonly #bodySetHandles = new AuthoringWeakSet<object>();
  readonly #partHandles = new AuthoringWeakSet<object>();
  readonly #partHandleIds = new AuthoringWeakMap<object, NodeId>();
  readonly #assemblyHandles = new AuthoringWeakSet<object>();
  readonly #assemblyHandleIds = new AuthoringWeakMap<object, NodeId>();
  readonly #assemblyHandleInstanceIds = new AuthoringWeakMap<
    object,
    ReadonlySet<EntityId>
  >();
  readonly #parameterHandles = new AuthoringWeakMap<
    object,
    StagedParameterIdentityV7
  >();
  readonly #parameterIds = new AuthoringSet<ParameterId>();
  #resourceCount = 0;
  #resourceLocationCount = 0;
  #resourceLocationBytes = 0;
  #usesMassDensity = false;

  constructor(name: string, options: DesignOptions = {}) {
    this.#base = new DesignBuilder(name, {
      ...(options.metadata === undefined
        ? {}
        : { metadata: detachMetadata(options.metadata, "Design metadata") }),
    });
    this.#handleOwner = new DesignBuilder(
      "InvariantCAD staged-v7 inert reference owner",
    );
    this.parameter = authoringFreeze({
      scalar: (
        id: string,
        defaultValue: ScalarExpression,
        parameterOptions: ParameterOptions<"scalar"> = {},
      ): Parameter<"scalar"> => {
        const key = this.#assertParameterAvailable(id);
        const parameter = this.#base.parameter.scalar(
          id,
          captureStagedExpression(
            defaultValue,
            "scalar",
            `Scalar parameter '${id}' default`,
          ),
          captureParameterOptionsV7(parameterOptions, "scalar"),
        );
        return this.#registerParameter(key, "scalar", parameter);
      },
      length: (
        id: string,
        defaultValue: LengthExpression,
        parameterOptions: ParameterOptions<"length"> = {},
      ): Parameter<"length"> => {
        const key = this.#assertParameterAvailable(id);
        const parameter = this.#base.parameter.length(
          id,
          captureStagedExpression(
            defaultValue,
            "length",
            `Length parameter '${id}' default`,
          ),
          captureParameterOptionsV7(parameterOptions, "length"),
        );
        return this.#registerParameter(key, "length", parameter);
      },
      angle: (
        id: string,
        defaultValue: AngleExpression,
        parameterOptions: ParameterOptions<"angle"> = {},
      ): Parameter<"angle"> => {
        const key = this.#assertParameterAvailable(id);
        const parameter = this.#base.parameter.angle(
          id,
          captureStagedExpression(
            defaultValue,
            "angle",
            `Angle parameter '${id}' default`,
          ),
          captureParameterOptionsV7(parameterOptions, "angle"),
        );
        return this.#registerParameter(key, "angle", parameter);
      },
      massDensity: (
        id: string,
        defaultValue: MassDensityExpression,
        parameterOptions: ParameterOptions<"massDensity"> = {},
      ): Parameter<"massDensity"> => {
        const key = this.#assertParameterAvailable(id);
        const parameter = this.#base.parameter.massDensity(
          id,
          captureStagedExpression(
            defaultValue,
            "massDensity",
            `Mass-density parameter '${id}' default`,
          ),
          captureParameterOptionsV7(parameterOptions, "massDensity"),
        );
        return this.#registerParameter(
          key,
          "massDensity",
          parameter,
        );
      },
    });
  }

  #assertParameterAvailable(id: string): ParameterId {
    const key = parameterId(id);
    if (authoringSetContains(this.#parameterIds, key)) {
      throw new TypeError(`Duplicate parameter '${id}'`);
    }
    return key;
  }

  #registerParameter<
    D extends "scalar" | "length" | "angle" | "massDensity",
  >(
    id: ParameterId,
    dimension: D,
    parameter: Parameter<D>,
  ): Parameter<D> {
    authoringFreeze(parameter);
    authoringWeakMapWrite(
      this.#parameterHandles,
      parameter,
      authoringFreeze({ id, dimension }),
    );
    authoringSetInsert(this.#parameterIds, id);
    return parameter;
  }

  #assertNodeAvailable(id: string): NodeId {
    const key = nodeId(id);
    if (authoringSetContains(this.#nodeIds, key)) {
      throw new TypeError(`Duplicate feature '${id}'`);
    }
    return key;
  }

  #registerLeaf<T extends StagedBodyLeafRefV7>(reference: T): T {
    authoringWeakSetInsert(this.#solidHandles, reference);
    return reference;
  }

  #assertSolidOwned(reference: StagedSolidRefV7): void {
    if (
      !authoringWeakSetContains(this.#solidHandles, reference) ||
      reference[STAGED_BODY_SET_DESIGN_OWNER] !== this
    ) {
      throw new TypeError(
        "Solid references cannot cross staged design boundaries",
      );
    }
  }

  box(
    id: string,
    options: { readonly size: Vec3Expression; readonly center?: boolean },
  ): StagedBodyLeafRefV7 {
    const key = this.#assertNodeAvailable(id);
    const reference = this.#base.box(id, options);
    authoringSetInsert(this.#nodeIds, key);
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
    authoringSetInsert(this.#nodeIds, key);
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
    authoringSetInsert(this.#nodeIds, key);
    return this.#registerLeaf(
      new StagedBodyLeafRefV7(this, reference.node),
    );
  }

  transform(
    id: string,
    input: StagedSolidRefV7,
    operations: readonly TransformOperationIR[],
  ): StagedSolidRefV7 {
    this.#assertSolidOwned(input);
    const capturedOperations = capturePlacementIR(
      operations,
      `Transform '${id}' operations`,
    );
    if (capturedOperations.length === 0) {
      throw new TypeError("A transform requires at least one operation");
    }
    const key = this.#assertNodeAvailable(id);
    const node: NodeIRV7 = {
      kind: "transform",
      input: { node: input.node, kind: "solid" },
      operations: capturedOperations,
    };
    const definition = deepFreeze(node);
    const reference = new StagedSolidRefV7(this, key);
    authoringWeakSetInsert(this.#solidHandles, reference);
    authoringSetInsert(this.#nodeIds, key);
    this.#nodeRecords[key] = definition;
    return reference;
  }

  translate(
    id: string,
    input: StagedSolidRefV7,
    value: Vec3Expression,
  ): StagedSolidRefV7 {
    this.#assertSolidOwned(input);
    return this.transform(id, input, [
      {
        kind: "translate",
        value: captureDatumVectorIR(
          value,
          "length",
          `Transform '${id}' translation`,
        ),
      },
    ]);
  }

  rotate(
    id: string,
    input: StagedSolidRefV7,
    value: AngleVec3Expression,
  ): StagedSolidRefV7 {
    this.#assertSolidOwned(input);
    return this.transform(id, input, [
      {
        kind: "rotate",
        value: captureDatumVectorIR(
          value,
          "angle",
          `Transform '${id}' rotation`,
        ),
      },
    ]);
  }

  scale(
    id: string,
    input: StagedSolidRefV7,
    value: ScalarVec3Expression,
  ): StagedSolidRefV7 {
    this.#assertSolidOwned(input);
    return this.transform(id, input, [
      {
        kind: "scale",
        value: captureDatumVectorIR(
          value,
          "scalar",
          `Transform '${id}' scale`,
        ),
      },
    ]);
  }

  mirror(
    id: string,
    input: StagedSolidRefV7,
    normal: ScalarVec3Expression,
  ): StagedSolidRefV7 {
    this.#assertSolidOwned(input);
    return this.transform(id, input, [
      {
        kind: "mirror",
        normal: captureDatumVectorIR(
          normal,
          "scalar",
          `Transform '${id}' mirror normal`,
        ),
      },
    ]);
  }

  datumPoint(
    id: string,
    options: { readonly position: Vec3Expression },
  ): StagedDatumPointRefV7 {
    const captured = captureExactOwnDataRecord(
      options,
      ["position"],
      "Datum-point options",
    );
    const key = this.#assertNodeAvailable(id);
    const node: DatumPointNodeIRV7 = {
      kind: "datumPoint",
      position: captureDatumVectorIR(
        captured.position,
        "length",
        "Datum-point position",
      ),
    };
    const definition = deepFreeze(node);
    const reference = new StagedDatumPointRefV7(
      this,
      key,
      STAGED_DATUM_REFERENCE_CONSTRUCTION,
    );
    authoringSetInsert(this.#nodeIds, key);
    this.#nodeRecords[key] = definition;
    return reference;
  }

  datumAxis(
    id: string,
    options: {
      readonly origin: Vec3Expression;
      readonly direction: ScalarVec3Expression;
    },
  ): StagedDatumAxisRefV7 {
    const captured = captureExactOwnDataRecord(
      options,
      ["origin", "direction"],
      "Datum-axis options",
    );
    const key = this.#assertNodeAvailable(id);
    const node: DatumAxisNodeIRV7 = {
      kind: "datumAxis",
      origin: captureDatumVectorIR(
        captured.origin,
        "length",
        "Datum-axis origin",
      ),
      direction: captureDatumVectorIR(
        captured.direction,
        "scalar",
        "Datum-axis direction",
      ),
    };
    const definition = deepFreeze(node);
    const reference = new StagedDatumAxisRefV7(
      this,
      key,
      STAGED_DATUM_REFERENCE_CONSTRUCTION,
    );
    authoringSetInsert(this.#nodeIds, key);
    this.#nodeRecords[key] = definition;
    return reference;
  }

  datumPlane(
    id: string,
    options: {
      readonly origin: Vec3Expression;
      readonly xDirection: ScalarVec3Expression;
      readonly normal: ScalarVec3Expression;
    },
  ): StagedDatumPlaneRefV7 {
    const captured = captureExactOwnDataRecord(
      options,
      ["origin", "xDirection", "normal"],
      "Datum-plane options",
    );
    const key = this.#assertNodeAvailable(id);
    const node: DatumPlaneNodeIRV7 = {
      kind: "datumPlane",
      origin: captureDatumVectorIR(
        captured.origin,
        "length",
        "Datum-plane origin",
      ),
      xDirection: captureDatumVectorIR(
        captured.xDirection,
        "scalar",
        "Datum-plane xDirection",
      ),
      normal: captureDatumVectorIR(
        captured.normal,
        "scalar",
        "Datum-plane normal",
      ),
    };
    const definition = deepFreeze(node);
    const reference = new StagedDatumPlaneRefV7(
      this,
      key,
      STAGED_DATUM_REFERENCE_CONSTRUCTION,
    );
    authoringSetInsert(this.#nodeIds, key);
    this.#nodeRecords[key] = definition;
    return reference;
  }

  coordinateSystem(
    id: string,
    options: {
      readonly origin: Vec3Expression;
      readonly xDirection: ScalarVec3Expression;
      readonly yDirection: ScalarVec3Expression;
    },
  ): StagedCoordinateSystemRefV7 {
    const captured = captureExactOwnDataRecord(
      options,
      ["origin", "xDirection", "yDirection"],
      "Coordinate-system options",
    );
    const key = this.#assertNodeAvailable(id);
    const node: CoordinateSystemNodeIRV7 = {
      kind: "coordinateSystem",
      origin: captureDatumVectorIR(
        captured.origin,
        "length",
        "Coordinate-system origin",
      ),
      xDirection: captureDatumVectorIR(
        captured.xDirection,
        "scalar",
        "Coordinate-system xDirection",
      ),
      yDirection: captureDatumVectorIR(
        captured.yDirection,
        "scalar",
        "Coordinate-system yDirection",
      ),
    };
    const definition = deepFreeze(node);
    const reference = new StagedCoordinateSystemRefV7(
      this,
      key,
      STAGED_DATUM_REFERENCE_CONSTRUCTION,
    );
    authoringSetInsert(this.#nodeIds, key);
    this.#nodeRecords[key] = definition;
    return reference;
  }

  configuration(
    id: string,
    build: (configuration: StagedBodySetConfigurationBuilderV7) => void,
    options: ConfigurationOptions = {},
  ): ConfigurationId {
    const key = configurationId(id);
    if (authoringHasOwn(this.#configurationRecords, key)) {
      throw new TypeError(`Duplicate configuration '${id}'`);
    }
    const captured = captureExactOwnDataRecord(
      options,
      ["description", "metadata"],
      "Configuration options",
    );
    assertOptionalString(
      captured.description,
      "Configuration options.description",
    );
    const capturedOptions: ConfigurationOptions = {
      ...(captured.description === undefined
        ? {}
        : { description: captured.description }),
      ...(captured.metadata === undefined
        ? {}
        : {
            metadata: detachMetadata(
              captured.metadata as Readonly<Record<string, JsonValue>>,
              "Configuration metadata",
            ),
          }),
    };
    const configuration = new StagedBodySetConfigurationBuilderV7(
      this.#parameterHandles,
      this.#partHandles,
      this.#materialHandles,
      this.#assemblyHandles,
      this.#partHandleIds,
      this.#materialHandleIds,
      this.#assemblyHandleIds,
      this.#assemblyHandleInstanceIds,
    );
    build(configuration);
    this.#configurationRecords[key] =
      configuration[STAGED_CONFIGURATION_TO_IR](capturedOptions);
    return key;
  }

  material(id: string, options: MaterialOptions): MaterialRef {
    const captured = captureExactOwnDataRecord(
      options,
      ["name", "massDensity", "description", "metadata"],
      "Material options",
    );
    const key = materialId(id);
    if (authoringHasOwn(this.#materialRecords, key)) {
      throw new TypeError(`Duplicate material '${id}'`);
    }
    if (
      typeof captured.name !== "string" ||
      authoringTrim(captured.name).length === 0
    ) {
      throw new TypeError(`Material '${id}' requires a non-empty name`);
    }
    const massDensity = captured.massDensity as
      | MassDensityExpression
      | undefined;
    if (
      massDensity === undefined ||
      massDensity.dimension !== "massDensity"
    ) {
      throw new TypeError(
        "Material massDensity must be a mass-density expression",
      );
    }
    assertOptionalString(
      captured.description,
      "Material options.description",
    );
    const definition = deepFreeze({
      name: captured.name,
      massDensity: massDensity.ir,
      ...(captured.description === undefined
        ? {}
        : { description: captured.description }),
      ...(captured.metadata === undefined
        ? {}
        : {
            metadata: detachMetadata(
              captured.metadata as Readonly<Record<string, JsonValue>>,
              "Material metadata",
            ),
          }),
    });
    const reference = authoringFreeze(
      new MaterialRef(this.#handleOwner, key),
    );
    authoringWeakSetInsert(this.#materialHandles, reference);
    authoringWeakMapWrite(this.#materialHandleIds, reference, key);
    this.#materialRecords[key] = definition;
    this.#usesMassDensity = true;
    return reference;
  }

  part(
    id: string,
    geometry: StagedSolidRefV7 | StagedBodySetRefV7,
    options: PartOptions = {},
  ): PartRef {
    const leaf =
      authoringWeakSetContains(this.#solidHandles, geometry) &&
      geometry[STAGED_BODY_SET_DESIGN_OWNER] === this;
    const bodySet =
      authoringWeakSetContains(this.#bodySetHandles, geometry) &&
      geometry[STAGED_BODY_SET_DESIGN_OWNER] === this;
    if (!leaf && !bodySet) {
      throw new TypeError(
        "Part geometry cannot cross staged design boundaries",
      );
    }
    const captured = captureExactOwnDataRecord(
      options,
      [
        "partNumber",
        "description",
        "material",
        "materialRef",
        "massDensity",
        "metadata",
      ],
      "Part options",
    );
    assertOptionalString(
      captured.partNumber,
      "Part options.partNumber",
    );
    assertOptionalString(
      captured.description,
      "Part options.description",
    );
    assertOptionalString(captured.material, "Part options.material");
    const material = captured.material;
    const materialReference = captured.materialRef as
      | MaterialRef
      | undefined;
    if (material !== undefined && materialReference !== undefined) {
      throw new TypeError(
        "A part cannot use both material and materialRef",
      );
    }
    const materialReferenceId =
      materialReference === undefined
        ? undefined
        : authoringWeakMapRead(
            this.#materialHandleIds,
            materialReference,
          );
    if (materialReference !== undefined) {
      if (
        !authoringWeakSetContains(
          this.#materialHandles,
          materialReference,
        ) ||
        materialReferenceId === undefined
      ) {
        throw new TypeError(
          "Materials cannot cross staged design boundaries",
        );
      }
    }
    const massDensity = captured.massDensity as
      | MassDensityExpression
      | undefined;
    if (
      massDensity !== undefined &&
      massDensity.dimension !== "massDensity"
    ) {
      throw new TypeError(
        "Part massDensity must be a mass-density expression",
      );
    }
    const metadata =
      captured.metadata === undefined
        ? undefined
        : detachMetadata(
            captured.metadata as Readonly<Record<string, JsonValue>>,
            "Part metadata",
          );
    const key = this.#assertNodeAvailable(id);
    const node: PartNodeIRV7 = {
      kind: "part",
      geometry: {
        node: geometry.node,
        kind: bodySet ? "bodySet" : "solid",
      },
      ...(captured.partNumber === undefined
        ? {}
        : { partNumber: captured.partNumber }),
      ...(captured.description === undefined
        ? {}
        : { description: captured.description }),
      ...(material === undefined ? {} : { material }),
      ...(materialReferenceId === undefined
        ? {}
        : { materialId: materialReferenceId }),
      ...(massDensity === undefined
        ? {}
        : { massDensity: massDensity.ir }),
      ...(metadata === undefined ? {} : { metadata }),
    };
    const definition = deepFreeze(node);
    const reference = authoringFreeze(
      new PartRef(this.#handleOwner, key),
    );
    authoringWeakSetInsert(this.#partHandles, reference);
    authoringWeakMapWrite(this.#partHandleIds, reference, key);
    authoringSetInsert(this.#nodeIds, key);
    this.#nodeRecords[key] = definition;
    if (massDensity !== undefined) this.#usesMassDensity = true;
    return reference;
  }

  assembly(
    id: string,
    build: (assembly: StagedLocalAssemblyBuilderV7) => void,
  ): AssemblyRef {
    if (typeof build !== "function") {
      throw new TypeError("Assembly build callback must be a function");
    }
    const key = this.#assertNodeAvailable(id);
    authoringSetInsert(this.#nodeIds, key);
    try {
      const builder = new StagedLocalAssemblyBuilderV7(
        this.#partHandles,
        this.#assemblyHandles,
        this.#partHandleIds,
        this.#assemblyHandleIds,
      );
      build(builder);
      const instances = authoringApply<
        readonly AssemblyInstanceIRV7[]
      >(stagedLocalAssemblyToIRV7, builder, []);
      const node: AssemblyNodeIRV7 = {
        kind: "assembly",
        instances,
      };
      const definition = deepFreeze(node);
      const reference = authoringFreeze(
        new AssemblyRef(this.#handleOwner, key),
      );
      const instanceIds = new AuthoringSet<EntityId>();
      for (let index = 0; index < instances.length; index += 1) {
        authoringSetInsert(instanceIds, instances[index]!.id);
      }
      authoringWeakSetInsert(this.#assemblyHandles, reference);
      authoringWeakMapWrite(this.#assemblyHandleIds, reference, key);
      authoringWeakMapWrite(
        this.#assemblyHandleInstanceIds,
        reference,
        instanceIds,
      );
      this.#nodeRecords[key] = definition;
      return reference;
    } catch (error) {
      authoringSetRemove(this.#nodeIds, key);
      throw error;
    }
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
    if (authoringHasOwn(this.#resourceRecords, key)) {
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
      !authoringPatternMatches(RESOURCE_DIGEST_PATTERN, digest)
    ) {
      throw new TypeError(
        "Resource digest must be a lowercase sha256 commitment",
      );
    }
    if (
      !authoringIsSafeInteger(byteLength) ||
      (byteLength as number) < 0
    ) {
      throw new TypeError(
        "Resource byteLength must be a non-negative safe integer",
      );
    }
    if (
      typeof mediaType !== "string" ||
      authoringTrim(mediaType) !== mediaType ||
      !authoringPatternMatches(RESOURCE_MEDIA_TYPE_PATTERN, mediaType)
    ) {
      throw new TypeError("Resource mediaType must be a non-empty MIME type");
    }

    let locations: readonly string[] | undefined;
    let addedLocationBytes = 0;
    if (rawLocations !== undefined) {
      if (!authoringIsArray(rawLocations) || rawLocations.length === 0) {
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
      const copied = authoringDenseArray<string>(rawLocations.length);
      const seen = new AuthoringSet<string>();
      for (let index = 0; index < rawLocations.length; index += 1) {
        if (!authoringHasOwn(rawLocations, index)) {
          throw new TypeError("Resource locations must be a dense array");
        }
        const location = rawLocations[index];
        if (typeof location !== "string" || location.length === 0) {
          throw new TypeError("Resource locations must be non-empty strings");
        }
        if (authoringSetContains(seen, location)) {
          throw new TypeError(
            `Resource location '${location}' is duplicated`,
          );
        }
        authoringSetInsert(seen, location);
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
      locations = authoringFreeze(copied);
    }

    const definition = deepFreeze({
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
    const reference = new StagedResourceRefV7(this, key);
    authoringWeakSetInsert(this.#resourceHandles, reference);
    this.#resourceRecords[key] = definition;
    this.#resourceCount += 1;
    this.#resourceLocationCount += locations?.length ?? 0;
    this.#resourceLocationBytes += addedLocationBytes;
    return reference;
  }

  importedBody(
    id: string,
    resource: StagedResourceRefV7,
    options: StagedImportedBodyAuthoringOptionsV7,
  ): StagedImportedBodyRefV7 {
    if (
      !authoringWeakSetContains(this.#resourceHandles, resource) ||
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
    const definition = deepFreeze(node);
    const reference = new StagedImportedBodyRefV7(this, key);
    this.#registerLeaf(reference);
    authoringWeakSetInsert(this.#importedBodyHandles, reference);
    authoringSetInsert(this.#nodeIds, key);
    this.#nodeRecords[key] = definition;
    return reference;
  }

  bodySet(
    id: string,
    members: readonly StagedBodySetMemberAuthoringV7[],
  ): StagedBodySetRefV7 {
    const key = this.#assertNodeAvailable(id);
    if (!authoringIsArray(members) || members.length === 0) {
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
    const copied = authoringDenseArray<BodySetMemberIRV7>(
      members.length,
    );
    const seen = new AuthoringSet<EntityId>();
    for (let index = 0; index < members.length; index += 1) {
      if (!authoringHasOwn(members, index)) {
        throw new TypeError("Body-set members must be a dense array");
      }
      const member = captureExactOwnDataRecord(
        members[index],
        ["id", "solid", "name", "metadata"],
        `Body-set member ${index}`,
      );
      const memberId = entityId(member.id as string);
      if (authoringSetContains(seen, memberId)) {
        throw new TypeError(
          `Body-set member ID '${member.id}' is duplicated`,
        );
      }
      authoringSetInsert(seen, memberId);
      const solid = member.solid as StagedSolidRefV7;
      this.#assertSolidOwned(solid);
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
    const definition: NodeIRV7 = deepFreeze({
      kind: "bodySet",
      bodies: authoringFreeze(copied),
    });
    const reference = new StagedBodySetRefV7(this, key);
    authoringWeakSetInsert(this.#bodySetHandles, reference);
    authoringSetInsert(this.#nodeIds, key);
    this.#nodeRecords[key] = definition;
    return reference;
  }

  output(
    name: string,
    reference:
      | StagedImportedBodyRefV7
      | StagedBodySetRefV7
      | PartRef
      | AssemblyRef,
  ): this {
    assertValidId(name, "Output name");
    const imported = authoringWeakSetContains(
      this.#importedBodyHandles,
      reference,
    );
    const bodySet = authoringWeakSetContains(
      this.#bodySetHandles,
      reference,
    );
    const partNode = authoringWeakMapRead(
      this.#partHandleIds,
      reference,
    );
    const part =
      authoringWeakSetContains(this.#partHandles, reference) &&
      partNode !== undefined;
    const assemblyNode = authoringWeakMapRead(
      this.#assemblyHandleIds,
      reference,
    );
    const assembly =
      authoringWeakSetContains(this.#assemblyHandles, reference) &&
      assemblyNode !== undefined;
    if (!imported && !bodySet && !part && !assembly) {
      throw new TypeError(
        "Only owned direct imported bodies, body sets, and parts or owned assemblies can be staged outputs",
      );
    }
    if (authoringHasOwn(this.#outputRecords, name)) {
      throw new TypeError(`Duplicate output '${name}'`);
    }
    this.#outputRecords[name] = deepFreeze({
      node: part ? partNode : assembly ? assemblyNode : reference.node,
      kind: part
        ? "part"
        : assembly
          ? "assembly"
          : bodySet
            ? "bodySet"
            : "solid",
    });
    return this;
  }

  build(options: ParseDocumentOptions = {}): DesignDocumentV7 {
    const base = this.#base.build();
    const nativeNodes = authoringNullRecord<Record<NodeId, NodeIRV7>>();
    const nativeNodeIds = authoringKeys(base.nodes) as NodeId[];
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
      units: {
        ...base.units,
        ...(this.#usesMassDensity ? { mass: "kg" as const } : {}),
      },
      parameters: base.parameters,
      ...(authoringKeys(this.#materialRecords).length === 0
        ? {}
        : { materials: { ...this.#materialRecords } }),
      ...(authoringKeys(this.#configurationRecords).length === 0
        ? {}
        : { configurations: { ...this.#configurationRecords } }),
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
 * imports, body sets, parts, and material intent.
 *
 * @internal
 */
export function stagedBodySetDesignV7(
  name: string,
  options?: DesignOptions,
): StagedBodySetDesignBuilderV7 {
  return new StagedBodySetDesignBuilderV7(name, options);
}
