import type {
  Brand,
  ConfigurationId,
  MaterialId,
  NodeId,
  ParameterId,
  ResourceId,
  TopologyReferenceId,
} from "./core/ids.js";
import {
  canonicalStringifyProtocol as canonicalStringify,
  deepFreeze,
} from "./core/json.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import type { DesignDocumentLimits } from "./document-limits.js";
import {
  evaluateExpression,
  expressionDependencies,
  Expression,
  type Dimension,
  type ExpressionIR,
} from "./expressions.js";
import {
  resolveEvaluationParameters,
  type EvaluationParameterOverride,
} from "./internal/evaluation-parameters.js";
import {
  nodeDependenciesV7,
  nodeParameterDependenciesV7,
  nodeResourceDependenciesV7,
  outputKindForNodeV7,
  type DesignConfigurationIR,
  type DesignDocument,
  type DesignDocumentV7,
  type DesignOutputKindV7,
  type MaterialDefinitionIR,
  type NodeIRV7,
  type NodeKindV7,
  type ResourceDefinitionIR,
  type TopologyQueryIRV7,
  type TopologyReferenceEntryIRV7,
  type TopologySelectionIRV7,
} from "./ir.js";
import { parseDocumentValueV7 } from "./serialization.js";
import { normalizePersistentTopologyReference } from "./topology-signatures.js";

/** Staged feature-intent hashing protocol for the document-v7 grammar. */
export const FEATURE_HASH_PROTOCOL_VERSION_V2 = 2 as const;
/** Staged report shape paired exclusively with feature-hash protocol v2. */
export const DESIGN_FEATURE_HASH_REPORT_VERSION_V2 = 2 as const;
export const FEATURE_HASH_ALGORITHM_V2 = "sha256" as const;
export const FEATURE_HASH_PREFIX_V2 =
  "invariantcad:feature:v2:sha256:" as const;
export const FEATURE_HASH_DOMAIN_V2 = "invariantcad.feature.v2" as const;
export const FEATURE_HASH_RESOURCE_DOMAIN_V2 =
  "invariantcad.feature.resource.v2" as const;
export const FEATURE_HASH_TOPOLOGY_REFERENCE_DOMAIN_V2 =
  "invariantcad.feature.topology-reference.v2" as const;

/**
 * A protocol-v2 feature hash. Its distinct brand prevents accidental use as a
 * protocol-v1 artifact-cache key.
 */
export type FeatureHashV2 = Brand<string, "FeatureHashV2">;

export interface FeatureHashLimitsV2 {
  /** Expanded `(node, configuration)` states, including occurrence contexts. */
  readonly maxFeatureNodes: number;
  readonly maxDependencyLinks: number;
  /** Selector and persistent-evidence work, independent of canonical bytes. */
  readonly maxTopologyWork: number;
  readonly maxCanonicalBytes: number;
}

export const DEFAULT_FEATURE_HASH_LIMITS_V2: FeatureHashLimitsV2 =
  Object.freeze({
    maxFeatureNodes: 100_000,
    maxDependencyLinks: 1_000_000,
    maxTopologyWork: 2_000_000,
    maxCanonicalBytes: 256 * 1024 * 1024,
  });

export interface HashDesignFeaturesV2Options {
  /** Exact document-owned configuration ID; omitted selects the base design. */
  readonly configuration?: string;
  /** Call-time overrides use the evaluator's precedence and base units. */
  readonly parameters?: Readonly<
    Record<string, number | Expression<Dimension>>
  >;
  /** Limits used while detaching and validating the document-v7 value. */
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  /** Limits for Merkle-DAG hashing work after document validation. */
  readonly limits?: Partial<FeatureHashLimitsV2>;
  /** Cancels hashing cooperatively between canonicalization and digest steps. */
  readonly signal?: AbortSignal;
}

export interface DesignFeatureHashEntryV2 {
  readonly node: string;
  readonly kind: NodeKindV7;
  readonly outputKind: ReturnType<typeof outputKindForNodeV7>;
  readonly hash: FeatureHashV2;
  /** Active local dependencies in effective node order. */
  readonly dependencies: readonly string[];
  /**
   * Direct dependency hashes with the effective occurrence configuration that
   * produced each child state. Duplicates retain occurrence order.
   */
  readonly contextualDependencies: readonly DesignFeatureDependencyHashV2[];
  /** Effective direct parameter inputs, sorted by parameter ID. */
  readonly parameterValues: Readonly<Record<string, number>>;
  /** Persistent references actually consumed by this node, sorted by ID. */
  readonly topologyReferences: readonly string[];
  /** Semantic external resources consumed by this node, sorted and unique. */
  readonly resources: readonly string[];
}

export interface DesignFeatureDependencyHashV2 {
  readonly node: string;
  readonly kind: ReturnType<typeof outputKindForNodeV7>;
  readonly configurationId: string | null;
  readonly featureHash: FeatureHashV2;
}

export interface DesignFeatureOutputHashV2 {
  readonly name: string;
  readonly node: string;
  readonly kind: DesignOutputKindV7;
  readonly featureHash: FeatureHashV2;
}

export interface DesignFeatureHashReportV2 {
  readonly version: typeof DESIGN_FEATURE_HASH_REPORT_VERSION_V2;
  readonly hashProtocolVersion: typeof FEATURE_HASH_PROTOCOL_VERSION_V2;
  readonly algorithm: typeof FEATURE_HASH_ALGORITHM_V2;
  readonly configurationId: string | null;
  readonly parameterValues: Readonly<Record<string, number>>;
  readonly nodes: readonly DesignFeatureHashEntryV2[];
  readonly outputs: readonly DesignFeatureOutputHashV2[];
}

interface CapturedOptionsV2 {
  readonly configuration?: string;
  readonly parameters: Readonly<Record<string, EvaluationParameterOverride>>;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly limits: FeatureHashLimitsV2;
  readonly signal?: AbortSignal;
}

interface ResolvedMaterialHashPayloadV2 {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly massDensity: number;
  readonly massDensityExpression: ExpressionIR;
  readonly metadata?: MaterialDefinitionIR["metadata"];
}

interface ResolvedMaterialV2 {
  readonly hashPayload: ResolvedMaterialHashPayloadV2;
  readonly parameterDependencies: readonly ParameterId[];
}

interface ResourceHashPayloadV2 {
  readonly id: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly metadata?: ResourceDefinitionIR["metadata"];
}

interface HashMeterV2 {
  bytes: number;
  readonly limit: number;
}

interface TopologyWorkMeterV2 {
  work: number;
  readonly limit: number;
}

interface ResolvedFeatureContextV2 {
  readonly configurationId: ConfigurationId | null;
  readonly configuration?: DesignConfigurationIR;
  readonly parameterValues: ReadonlyMap<ParameterId, number>;
  readonly materials: ReadonlyMap<string, ResolvedMaterialV2>;
  readonly diagnostics: readonly Diagnostic[];
}

interface ContextualDependencyV2 {
  readonly node: NodeId;
  readonly kind: ReturnType<typeof outputKindForNodeV7>;
  readonly configurationId: ConfigurationId | null;
  readonly stateKey: string;
}

interface ContextualFeatureStateV2 {
  readonly key: string;
  readonly node: NodeId;
  readonly configurationId: ConfigurationId | null;
  readonly effectiveNode: NodeIRV7;
  readonly dependencies: readonly ContextualDependencyV2[];
  readonly resources: readonly ResourceId[];
}

const FEATURE_HASH_LIMIT_KEYS_V2 = Object.freeze(
  Object.keys(DEFAULT_FEATURE_HASH_LIMITS_V2) as readonly (
    keyof FeatureHashLimitsV2
  )[],
);
const OPTION_KEYS_V2 = Object.freeze([
  "configuration",
  "parameters",
  "documentLimits",
  "limits",
  "signal",
] as const);
const ABORT_SIGNAL_ABORTED_GETTER =
  typeof AbortSignal === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicReflect = Reflect;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const typedArrayPrototype = objectGetPrototypeOf(
  IntrinsicUint8Array.prototype,
) as object;
const typedArrayByteLengthGetter = objectGetOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const arrayIteratorPrototype = objectGetPrototypeOf(
  reflectApply(Array.prototype[Symbol.iterator], [], []) as object,
) as object;
const mapIteratorPrototype = objectGetPrototypeOf(
  reflectApply(Map.prototype[Symbol.iterator], new Map(), []) as object,
) as object;
const setIteratorPrototype = objectGetPrototypeOf(
  reflectApply(Set.prototype[Symbol.iterator], new Set(), []) as object,
) as object;
const iteratorPrototype = objectGetPrototypeOf(
  arrayIteratorPrototype,
) as object;
const HEX_DIGITS = "0123456789abcdef";

interface CapturedIntrinsicMethod {
  readonly target: object;
  readonly method: (...arguments_: readonly unknown[]) => unknown;
}

function capturePrototypeMethod(
  target: unknown,
  name: string,
): CapturedIntrinsicMethod | undefined {
  if (typeof target !== "object" || target === null) return undefined;
  let prototype: object | null = objectGetPrototypeOf(target);
  while (prototype !== null) {
    const descriptor = objectGetOwnPropertyDescriptor(prototype, name);
    if (descriptor !== undefined && typeof descriptor.value === "function") {
      return objectFreeze({
        target,
        method: descriptor.value as (
          ...arguments_: readonly unknown[]
        ) => unknown,
      });
    }
    prototype = objectGetPrototypeOf(prototype);
  }
  return undefined;
}

const capturedCrypto = (() => {
  try {
    return globalThis.crypto;
  } catch {
    return undefined;
  }
})();
const capturedCryptoDigest = (() => {
  try {
    return capturePrototypeMethod(capturedCrypto?.subtle, "digest");
  } catch {
    return undefined;
  }
})();

const capturedTextEncoder = (() => {
  try {
    if (typeof globalThis.TextEncoder !== "function") return undefined;
    return capturePrototypeMethod(new globalThis.TextEncoder(), "encode");
  } catch {
    return undefined;
  }
})();

type CapturedRealmDescriptor =
  | Readonly<{
      kind: "data";
      configurable: boolean;
      enumerable: boolean;
      writable: boolean;
      value: unknown;
    }>
  | Readonly<{
      kind: "accessor";
      configurable: boolean;
      enumerable: boolean;
      get: (() => unknown) | undefined;
      set: ((value: unknown) => void) | undefined;
    }>;

interface RealmMemberSnapshot {
  readonly label: string;
  readonly key: PropertyKey;
  readonly descriptor: CapturedRealmDescriptor | undefined;
}

interface RealmOwnerSnapshot {
  readonly label: string;
  readonly target: object;
  readonly prototype: object | null;
  /** Present only when additions, removals, and key reordering are forbidden. */
  readonly exactOwnKeys?: readonly PropertyKey[];
  readonly members: readonly RealmMemberSnapshot[];
}

function descriptorField(
  descriptor: PropertyDescriptor,
  key: keyof PropertyDescriptor,
): unknown {
  return objectGetOwnPropertyDescriptor(descriptor, key)?.value;
}

function captureRealmDescriptor(
  target: object,
  key: PropertyKey,
): CapturedRealmDescriptor | undefined {
  const descriptor = objectGetOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) return undefined;
  const configurable = descriptorField(descriptor, "configurable") === true;
  const enumerable = descriptorField(descriptor, "enumerable") === true;
  if (objectGetOwnPropertyDescriptor(descriptor, "value") !== undefined) {
    return objectFreeze({
      kind: "data" as const,
      configurable,
      enumerable,
      writable: descriptorField(descriptor, "writable") === true,
      value: descriptorField(descriptor, "value"),
    });
  }
  return objectFreeze({
    kind: "accessor" as const,
    configurable,
    enumerable,
    get: descriptorField(descriptor, "get") as (() => unknown) | undefined,
    set: descriptorField(descriptor, "set") as
      | ((value: unknown) => void)
      | undefined,
  });
}

function capturedOwnKeys(target: object): readonly PropertyKey[] {
  return reflectApply(reflectOwnKeys, IntrinsicReflect, [
    target,
  ]) as PropertyKey[];
}

function captureRealmMember(
  ownerLabel: string,
  target: object,
  key: PropertyKey,
): RealmMemberSnapshot {
  return objectFreeze({
    label: `${ownerLabel}.${String(key)}`,
    key,
    descriptor: captureRealmDescriptor(target, key),
  });
}

function captureSelectedRealmOwner(
  label: string,
  target: object,
  keys: readonly PropertyKey[],
): RealmOwnerSnapshot {
  return objectFreeze({
    label,
    target,
    prototype: objectGetPrototypeOf(target),
    members: objectFreeze(
      keys.map((key) => captureRealmMember(label, target, key)),
    ),
  });
}

function captureFullRealmOwner(
  label: string,
  target: object,
): RealmOwnerSnapshot {
  const keys = objectFreeze([...capturedOwnKeys(target)]);
  return objectFreeze({
    label,
    target,
    prototype: objectGetPrototypeOf(target),
    exactOwnKeys: keys,
    members: objectFreeze(
      keys.map((key) => captureRealmMember(label, target, key)),
    ),
  });
}

function capturePresentFullRealmOwners(
  inputs: readonly (readonly [label: string, target: object | undefined])[],
): readonly RealmOwnerSnapshot[] {
  const snapshots: RealmOwnerSnapshot[] = [];
  for (const [label, target] of inputs) {
    if (target !== undefined) {
      snapshots.push(captureFullRealmOwner(label, target));
    }
  }
  return objectFreeze(snapshots);
}

const REALM_OWNER_SNAPSHOTS: readonly RealmOwnerSnapshot[] = objectFreeze([
  ...capturePresentFullRealmOwners([
    ["Object.prototype", Object.prototype],
    ["Array.prototype", Array.prototype],
    ["Map.prototype", Map.prototype],
    ["Set.prototype", Set.prototype],
    ["WeakMap.prototype", WeakMap.prototype],
    ["WeakSet.prototype", WeakSet.prototype],
    ["Promise.prototype", Promise.prototype],
    ["String.prototype", String.prototype],
    ["RegExp.prototype", RegExp.prototype],
    ["Error.prototype", Error.prototype],
    ["TypeError.prototype", TypeError.prototype],
    ["RangeError.prototype", RangeError.prototype],
    ["ArrayBuffer.prototype", ArrayBuffer.prototype],
    ["Uint8Array.prototype", IntrinsicUint8Array.prototype],
    ["%TypedArray%.prototype", typedArrayPrototype],
    ["%IteratorPrototype%", iteratorPrototype],
    ["ArrayIterator.prototype", arrayIteratorPrototype],
    ["MapIterator.prototype", mapIteratorPrototype],
    ["SetIterator.prototype", setIteratorPrototype],
    [
      "AbortSignal.prototype",
      typeof AbortSignal === "undefined" ? undefined : AbortSignal.prototype,
    ],
    [
      "Crypto.prototype",
      capturedCrypto === undefined
        ? undefined
        : (objectGetPrototypeOf(capturedCrypto) as object),
    ],
    [
      "SubtleCrypto.prototype",
      capturedCryptoDigest === undefined
        ? undefined
        : (objectGetPrototypeOf(capturedCryptoDigest.target) as object),
    ],
    [
      "TextEncoder.prototype",
      capturedTextEncoder === undefined
        ? undefined
        : (objectGetPrototypeOf(capturedTextEncoder.target) as object),
    ],
  ]),
  captureSelectedRealmOwner("globalThis", globalThis, [
    "Object",
    "Array",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Number",
    "String",
    "Symbol",
    "Promise",
    "ArrayBuffer",
    "Uint8Array",
    "TextEncoder",
    "AbortSignal",
    "RegExp",
    "Error",
    "TypeError",
    "RangeError",
    "JSON",
    "Reflect",
    "Math",
    "crypto",
  ]),
  captureSelectedRealmOwner("Object", Object, [
    "assign",
    "create",
    "defineProperty",
    "entries",
    "freeze",
    "fromEntries",
    "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors",
    "getPrototypeOf",
    "hasOwn",
    "is",
    "isFrozen",
    "keys",
    "values",
  ]),
  captureSelectedRealmOwner("Array", Array, ["isArray"]),
  captureSelectedRealmOwner("Map", Map, []),
  captureSelectedRealmOwner("Set", Set, []),
  captureSelectedRealmOwner("WeakMap", WeakMap, []),
  captureSelectedRealmOwner("WeakSet", WeakSet, []),
  captureSelectedRealmOwner("Number", Number, [
    "isFinite",
    "isSafeInteger",
    "isInteger",
    "EPSILON",
    "POSITIVE_INFINITY",
  ]),
  captureSelectedRealmOwner("String", String, []),
  captureSelectedRealmOwner("Symbol", Symbol, []),
  captureSelectedRealmOwner("Promise", Promise, []),
  captureSelectedRealmOwner("ArrayBuffer", ArrayBuffer, []),
  captureSelectedRealmOwner("Uint8Array", IntrinsicUint8Array, []),
  ...(typeof TextEncoder === "undefined"
    ? []
    : [captureSelectedRealmOwner("TextEncoder", TextEncoder, [])]),
  ...(typeof AbortSignal === "undefined"
    ? []
    : [captureSelectedRealmOwner("AbortSignal", AbortSignal, [])]),
  captureSelectedRealmOwner("RegExp", RegExp, []),
  captureSelectedRealmOwner("Error", Error, []),
  captureSelectedRealmOwner("TypeError", TypeError, []),
  captureSelectedRealmOwner("RangeError", RangeError, []),
  captureSelectedRealmOwner("JSON", JSON, ["parse", "stringify"]),
  captureSelectedRealmOwner("Reflect", IntrinsicReflect, [
    "apply",
    "ownKeys",
  ]),
  captureSelectedRealmOwner("Math", Math, [
    "abs",
    "min",
    "max",
    "sin",
    "cos",
    "tan",
    "atan",
    "atan2",
    "hypot",
    "sqrt",
    "PI",
  ]),
]);

function realmIntegrityFailure(
  label: string,
  cause?: unknown,
): CadResult<never> {
  return failure(
    diagnostic(
      "IR_INVALID",
      `Feature hashing refused a mutated JavaScript realm (${label})`,
      {
        severity: "error",
        details: {
          phase: "featureHashV2",
          resource: "realmIntegrity",
          intrinsic: label,
          ...(cause === undefined ? {} : { cause: safeErrorMessage(cause) }),
        },
      },
    ),
  );
}

function realmDescriptorsEqual(
  first: CapturedRealmDescriptor | undefined,
  second: CapturedRealmDescriptor | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  if (
    first.kind !== second.kind ||
    first.configurable !== second.configurable ||
    first.enumerable !== second.enumerable
  ) {
    return false;
  }
  if (first.kind === "data" && second.kind === "data") {
    return (
      first.writable === second.writable && objectIs(first.value, second.value)
    );
  }
  return (
    first.kind === "accessor" &&
    second.kind === "accessor" &&
    first.get === second.get &&
    first.set === second.set
  );
}

function realmIntegrityError(): CadResult<never> | undefined {
  try {
    for (
      let index = 0;
      index < REALM_OWNER_SNAPSHOTS.length;
      index += 1
    ) {
      const owner = REALM_OWNER_SNAPSHOTS[index]!;
      if (objectGetPrototypeOf(owner.target) !== owner.prototype) {
        return realmIntegrityFailure(`${owner.label}.[[Prototype]]`);
      }
      if (owner.exactOwnKeys !== undefined) {
        const currentKeys = capturedOwnKeys(owner.target);
        if (currentKeys.length !== owner.exactOwnKeys.length) {
          return realmIntegrityFailure(`${owner.label}.[[OwnKeys]]`);
        }
        for (
          let keyIndex = 0;
          keyIndex < currentKeys.length;
          keyIndex += 1
        ) {
          if (!objectIs(currentKeys[keyIndex], owner.exactOwnKeys[keyIndex])) {
            return realmIntegrityFailure(`${owner.label}.[[OwnKeys]]`);
          }
        }
      }
      for (
        let memberIndex = 0;
        memberIndex < owner.members.length;
        memberIndex += 1
      ) {
        const member = owner.members[memberIndex]!;
        if (
          !realmDescriptorsEqual(
            captureRealmDescriptor(owner.target, member.key),
            member.descriptor,
          )
        ) {
          return realmIntegrityFailure(member.label);
        }
      }
    }
    return undefined;
  } catch (error) {
    return realmIntegrityFailure("realm inspection", error);
  }
}

function throwIfRealmCompromised(): void {
  const compromised = realmIntegrityError();
  if (compromised !== undefined) throw compromised;
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function unreachableVariant(value: never, label: string): never {
  throw new TypeError(`Unsupported ${label}: ${canonicalStringify(value)}`);
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function invalidOptions(message: string, path?: string): CadResult<never> {
  return failure(
    diagnostic("IR_INVALID", message, {
      severity: "error",
      ...(path === undefined ? {} : { path }),
      details: { phase: "featureHashV2" },
    }),
  );
}

function abortSignalState(value: unknown): boolean | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    ABORT_SIGNAL_ABORTED_GETTER === undefined
  ) {
    return undefined;
  }
  try {
    const state = reflectApply(ABORT_SIGNAL_ABORTED_GETTER, value, []);
    return typeof state === "boolean" ? state : undefined;
  } catch {
    return undefined;
  }
}

function abortFailure(): CadResult<never> {
  return failure(
    diagnostic("EVALUATION_ABORTED", "Feature hashing was aborted", {
      severity: "error",
      details: { phase: "featureHashV2" },
    }),
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal !== undefined && abortSignalState(signal) !== false) {
    throw abortFailure();
  }
}

function snapshotRecord(
  value: unknown,
  path: string,
): CadResult<Readonly<Record<string, unknown>>> {
  if (!isPlainRecord(value)) {
    return invalidOptions(`${path} must be a plain record`, path);
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) output[key] = value[key];
  return success(output);
}

function normalizeFeatureHashLimits(
  value: unknown,
): CadResult<FeatureHashLimitsV2> {
  if (value === undefined) return success(DEFAULT_FEATURE_HASH_LIMITS_V2);
  const captured = snapshotRecord(value, "/limits");
  if (!captured.ok) return captured;
  const unknown = Object.keys(captured.value).find(
    (key) =>
      !FEATURE_HASH_LIMIT_KEYS_V2.includes(
        key as keyof FeatureHashLimitsV2,
      ),
  );
  if (unknown !== undefined) {
    return invalidOptions(
      `Unknown feature-hash limit '${unknown}'`,
      `/limits/${unknown}`,
    );
  }
  const normalized: Record<keyof FeatureHashLimitsV2, number> = {
    ...DEFAULT_FEATURE_HASH_LIMITS_V2,
  };
  for (const key of FEATURE_HASH_LIMIT_KEYS_V2) {
    if (!Object.hasOwn(captured.value, key)) continue;
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !Number.isSafeInteger(candidate) ||
      candidate < 0
    ) {
      return invalidOptions(
        `Feature-hash limit '${key}' must be a non-negative safe integer`,
        `/limits/${key}`,
      );
    }
    normalized[key] = candidate;
  }
  return success(Object.freeze(normalized));
}

function captureOptions(value: unknown): CadResult<CapturedOptionsV2> {
  try {
    const captured = snapshotRecord(value, "/");
    if (!captured.ok) return captured;
    const unknown = Object.keys(captured.value).find(
      (key) => !OPTION_KEYS_V2.includes(key as (typeof OPTION_KEYS_V2)[number]),
    );
    if (unknown !== undefined) {
      return invalidOptions(
        `Unknown feature-hash option '${unknown}'`,
        `/${unknown}`,
      );
    }
    const configuration = captured.value.configuration;
    if (configuration !== undefined && typeof configuration !== "string") {
      return invalidOptions("configuration must be a string", "/configuration");
    }
    const parameters = Object.create(null) as Record<
      string,
      EvaluationParameterOverride
    >;
    const rawParameters = captured.value.parameters;
    if (rawParameters !== undefined) {
      const parameterRecord = snapshotRecord(rawParameters, "/parameters");
      if (!parameterRecord.ok) return parameterRecord;
      for (const [id, override] of Object.entries(parameterRecord.value)) {
        if (typeof override !== "number" && !(override instanceof Expression)) {
          return invalidOptions(
            `Parameter override '${id}' must be a number or Expression`,
            `/parameters/${id}`,
          );
        }
        parameters[id] = override;
      }
    }
    const limits = normalizeFeatureHashLimits(captured.value.limits);
    if (!limits.ok) return limits;
    const signal = captured.value.signal;
    if (signal !== undefined && abortSignalState(signal) === undefined) {
      return invalidOptions("signal must be an AbortSignal", "/signal");
    }
    let documentLimits: Partial<DesignDocumentLimits> | undefined;
    if (captured.value.documentLimits !== undefined) {
      const documentLimitRecord = snapshotRecord(
        captured.value.documentLimits,
        "/documentLimits",
      );
      if (!documentLimitRecord.ok) return documentLimitRecord;
      documentLimits = documentLimitRecord.value as Partial<DesignDocumentLimits>;
    }
    return success({
      ...(configuration === undefined ? {} : { configuration }),
      parameters,
      ...(documentLimits === undefined ? {} : { documentLimits }),
      limits: limits.value,
      ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
    });
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Feature-hash options could not be read safely"),
    );
  }
}

function limitFailure(
  resource: keyof FeatureHashLimitsV2,
  limit: number,
  actual: number,
): CadResult<never> {
  return failure(
    diagnostic(
      "IR_INVALID",
      `Feature-hash ${resource} limit ${limit} was exceeded by ${actual}`,
      {
        severity: "error",
        details: { phase: "featureHashV2", resource, limit, actual },
      },
    ),
  );
}

function resolvedExpression(
  expression: ExpressionIR,
  values: ReadonlyMap<ParameterId, number>,
): number {
  const value = evaluateExpression(expression, {
    resolveParameter: (id) => {
      const resolved = values.get(id);
      if (resolved === undefined) throw new Error(`Unresolved parameter '${id}'`);
      return resolved;
    },
  });
  if (!Number.isFinite(value)) {
    throw new RangeError("A feature expression did not resolve to a finite number");
  }
  return value;
}

function consumeTopologyWork(
  meter: TopologyWorkMeterV2,
  amount: number,
  signal: AbortSignal | undefined,
): void {
  throwIfAborted(signal);
  throwIfRealmCompromised();
  if (amount > meter.limit - meter.work) {
    throw limitFailure(
      "maxTopologyWork",
      meter.limit,
      meter.limit + 1,
    );
  }
  meter.work += amount;
}

function accountTopologyValue(
  value: unknown,
  meter: TopologyWorkMeterV2,
  signal: AbortSignal | undefined,
): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    consumeTopologyWork(meter, 1, signal);
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        stack.push(current[index]);
      }
    } else if (typeof current === "object" && current !== null) {
      for (const key of Object.keys(current)) {
        stack.push((current as Readonly<Record<string, unknown>>)[key]);
      }
    }
  }
}

function canonicalizeFeatureTopologyQuery(
  query: TopologyQueryIRV7,
  meter: TopologyWorkMeterV2,
  signal: AbortSignal | undefined,
): TopologyQueryIRV7 {
  consumeTopologyWork(meter, 1, signal);
  switch (query.op) {
    case "and":
    case "or": {
      const op = query.op;
      const flattened = query.queries
        .map((child) =>
          canonicalizeFeatureTopologyQuery(child, meter, signal),
        )
        .flatMap((child) => (child.op === op ? child.queries : [child]));
      const unique = new Map<string, TopologyQueryIRV7>();
      for (const child of flattened) {
        unique.set(canonicalStringify(child), child);
      }
      return {
        op,
        queries: [...unique.entries()]
          .sort(([first], [second]) => lexicalCompare(first, second))
          .map(([, child]) => child),
      };
    }
    case "not":
      return {
        op: "not",
        query: canonicalizeFeatureTopologyQuery(query.query, meter, signal),
      };
    case "adjacentTo":
      return {
        op: "adjacentTo",
        selection: canonicalizeFeatureTopologySelection(
          query.selection,
          meter,
          signal,
        ),
      };
    case "all":
    case "persistentReference":
    case "origin":
    case "surface":
    case "curve":
    case "normal":
    case "direction":
    case "radius":
    case "position":
      return query;
  }
  return unreachableVariant(query, "topology query");
}

function canonicalizeFeatureTopologySelection<
  K extends TopologySelectionIRV7,
>(
  selection: K,
  meter: TopologyWorkMeterV2,
  signal: AbortSignal | undefined,
): K {
  return {
    ...selection,
    query: canonicalizeFeatureTopologyQuery(
      selection.query,
      meter,
      signal,
    ),
  } as K;
}

function configuredInstanceSuppression(
  configuration: DesignConfigurationIR | undefined,
  assembly: NodeId,
  instance: string,
): boolean | undefined {
  const assemblies = configuration?.instanceSuppressions;
  if (assemblies === undefined || !Object.hasOwn(assemblies, assembly)) {
    return undefined;
  }
  const instances = assemblies[assembly]!;
  return Object.hasOwn(instances, instance)
    ? instances[instance as keyof typeof instances]
    : undefined;
}

function effectiveNode(
  id: NodeId,
  node: NodeIRV7,
  configurationId: ConfigurationId | null,
  configuration: DesignConfigurationIR | undefined,
): NodeIRV7 {
  switch (node.kind) {
    case "box":
    case "cylinder":
    case "sphere":
    case "sketch":
    case "polylinePath":
    case "circularArcPath":
    case "compositePath":
    case "extrude":
    case "revolve":
    case "loft":
    case "sweep":
    case "boolean":
    case "transform":
    case "offset":
    case "datumPoint":
    case "datumAxis":
    case "datumPlane":
    case "coordinateSystem":
    case "bodySet":
    case "importedBody":
    case "fillet":
    case "chamfer":
    case "shell":
    case "draft":
      return node;
    case "part": {
      const materialOverrides = configuration?.partMaterialOverrides;
      const materialId =
        materialOverrides !== undefined && Object.hasOwn(materialOverrides, id)
          ? materialOverrides[id]
          : node.materialId;
      const { materialId: _materialId, ...rest } = node;
      return {
        ...rest,
        ...(materialId === undefined ? {} : { materialId }),
      } as NodeIRV7;
    }
    case "assembly":
      return {
        ...node,
        instances: node.instances
          .filter(
            (instance) =>
              !(
                configuredInstanceSuppression(
                  configuration,
                  id,
                  instance.id,
                ) ?? instance.suppressed
              ),
          )
          .map((instance) => {
            if (instance.component.source === "external") {
              // External selectors belong to another document and cannot be
              // resolved or normalized by the owner.
              return { ...instance, suppressed: false };
            }
            const childConfigurationId = occurrenceConfigurationId(
              instance.configuration,
              configurationId,
            );
            return {
              ...instance,
              configuration:
                childConfigurationId === null
                  ? { mode: "base" as const }
                  : {
                      mode: "named" as const,
                      id: childConfigurationId,
                    },
              suppressed: false,
            };
          }),
      };
  }
  return unreachableVariant(node, "document-v7 node");
}

function occurrenceConfigurationId(
  selector: {
    readonly mode: "inherit" | "base" | "named";
    readonly id?: ConfigurationId;
  },
  parent: ConfigurationId | null,
): ConfigurationId | null {
  switch (selector.mode) {
    case "inherit":
      return parent;
    case "base":
      return null;
    case "named":
      return selector.id!;
  }
}

function canonicalTopologyNode(
  node: NodeIRV7,
  meter: TopologyWorkMeterV2,
  signal: AbortSignal | undefined,
): NodeIRV7 {
  switch (node.kind) {
    case "fillet":
    case "chamfer":
      return {
        ...node,
        edges: canonicalizeFeatureTopologySelection(
          node.edges,
          meter,
          signal,
        ),
      } as NodeIRV7;
    case "shell":
      return {
        ...node,
        openings: canonicalizeFeatureTopologySelection(
          node.openings,
          meter,
          signal,
        ),
      } as NodeIRV7;
    case "draft":
      return {
        ...node,
        faces: canonicalizeFeatureTopologySelection(
          node.faces,
          meter,
          signal,
        ),
      } as NodeIRV7;
    case "box":
    case "cylinder":
    case "sphere":
    case "sketch":
    case "polylinePath":
    case "circularArcPath":
    case "compositePath":
    case "extrude":
    case "revolve":
    case "loft":
    case "sweep":
    case "boolean":
    case "transform":
    case "offset":
    case "part":
    case "assembly":
    case "datumPoint":
    case "datumAxis":
    case "datumPlane":
    case "coordinateSystem":
    case "bodySet":
    case "importedBody":
      return node;
  }
  return unreachableVariant(node, "document-v7 node");
}

function topologyReferenceIds(
  selection: TopologySelectionIRV7,
  meter: TopologyWorkMeterV2,
  signal: AbortSignal | undefined,
): readonly TopologyReferenceId[] {
  const output = new Set<TopologyReferenceId>();
  const stack: TopologyQueryIRV7[] = [selection.query];
  while (stack.length > 0) {
    consumeTopologyWork(meter, 1, signal);
    const query = stack.pop()!;
    switch (query.op) {
      case "persistentReference":
        output.add(query.reference);
        break;
      case "adjacentTo":
        stack.push(query.selection.query);
        break;
      case "and":
      case "or":
        for (const child of query.queries) stack.push(child);
        break;
      case "not":
        stack.push(query.query);
        break;
      case "all":
      case "origin":
      case "surface":
      case "curve":
      case "normal":
      case "direction":
      case "radius":
      case "position":
        break;
      default:
        unreachableVariant(query, "topology query");
    }
  }
  return Object.freeze([...output].sort(lexicalCompare));
}

function nodeTopologyReferenceIds(
  node: NodeIRV7,
  meter: TopologyWorkMeterV2,
  signal: AbortSignal | undefined,
): readonly TopologyReferenceId[] {
  switch (node.kind) {
    case "fillet":
    case "chamfer":
      return topologyReferenceIds(node.edges, meter, signal);
    case "shell":
      return topologyReferenceIds(node.openings, meter, signal);
    case "draft":
      return topologyReferenceIds(node.faces, meter, signal);
    case "box":
    case "cylinder":
    case "sphere":
    case "sketch":
    case "polylinePath":
    case "circularArcPath":
    case "compositePath":
    case "extrude":
    case "revolve":
    case "loft":
    case "sweep":
    case "boolean":
    case "transform":
    case "offset":
    case "part":
    case "assembly":
    case "datumPoint":
    case "datumAxis":
    case "datumPlane":
    case "coordinateSystem":
    case "bodySet":
    case "importedBody":
      return [];
  }
  return unreachableVariant(node, "document-v7 node");
}

function canonicalTopologyReferenceEntry(
  entry: TopologyReferenceEntryIRV7,
  meter: TopologyWorkMeterV2,
  signal: AbortSignal | undefined,
): TopologyReferenceEntryIRV7 {
  consumeTopologyWork(meter, 1, signal);
  const variants = entry.variants.map((variant) => {
    accountTopologyValue(variant, meter, signal);
    const normalized = normalizePersistentTopologyReference(variant);
    if (!normalized.ok) {
      throw new TypeError(
        normalized.diagnostics[0]?.message ??
          "A persistent topology reference could not be normalized",
      );
    }
    return {
      value: normalized.value,
      canonical: canonicalStringify(normalized.value),
    };
  });
  variants.sort(
    (first, second) =>
      first.value.protocolVersion - second.value.protocolVersion ||
      lexicalCompare(
        first.value.kernelFingerprint,
        second.value.kernelFingerprint,
      ) ||
      lexicalCompare(first.canonical, second.canonical),
  );
  return {
    target: entry.target,
    topology: entry.topology,
    variants: variants.map(({ value }) => value),
  };
}

function canonicalJsonUtf8Length(value: unknown, ceiling: number): number {
  let byteLength = 0;
  let exceeded = false;

  const add = (amount: number): void => {
    if (exceeded) return;
    if (amount > ceiling - byteLength) {
      exceeded = true;
      return;
    }
    byteLength += amount;
  };

  const measureString = (current: string): void => {
    add(2);
    if (exceeded) return;
    for (let index = 0; index < current.length; index += 1) {
      const code = current.charCodeAt(index);
      let width: number;
      if (code === 0x22 || code === 0x5c) width = 2;
      else if (
        code === 0x08 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0c ||
        code === 0x0d
      ) {
        width = 2;
      } else if (code <= 0x1f) width = 6;
      else if (code <= 0x7f) width = 1;
      else if (code <= 0x7ff) width = 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = current.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          width = 4;
          index += 1;
        } else {
          width = 6;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) width = 6;
      else width = 3;
      add(width);
      if (exceeded) return;
    }
  };

  const measure = (current: unknown): void => {
    if (current === null) {
      add(4);
      return;
    }
    if (typeof current === "string") {
      measureString(current);
      return;
    }
    if (typeof current === "boolean") {
      add(current ? 4 : 5);
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("CAD hashes cannot contain non-finite numbers");
      }
      add(String(Object.is(current, -0) ? 0 : current).length);
      return;
    }
    if (Array.isArray(current)) {
      add(2);
      for (let index = 0; index < current.length; index += 1) {
        if (index > 0) add(1);
        measure(current[index]);
        if (exceeded) return;
      }
      return;
    }
    if (typeof current === "object" && current !== null) {
      add(2);
      let emitted = 0;
      const record = current as Readonly<Record<string, unknown>>;
      for (const key of Object.keys(record).sort(lexicalCompare)) {
        const child = record[key];
        if (child === undefined) continue;
        if (emitted > 0) add(1);
        measureString(key);
        add(1);
        measure(child);
        emitted += 1;
        if (exceeded) return;
      }
      return;
    }
    throw new TypeError(`Unsupported JSON value: ${typeof current}`);
  };

  measure(value);
  return exceeded ? Number.POSITIVE_INFINITY : byteLength;
}

async function digestEnvelope(
  domain: string,
  payload: unknown,
  meter: HashMeterV2,
  signal: AbortSignal | undefined,
): Promise<string> {
  throwIfRealmCompromised();
  throwIfAborted(signal);
  const envelope = {
    algorithm: FEATURE_HASH_ALGORITHM_V2,
    domain,
    protocolVersion: FEATURE_HASH_PROTOCOL_VERSION_V2,
    payload,
  };
  const remaining = meter.limit - meter.bytes;
  const byteLength = canonicalJsonUtf8Length(envelope, remaining);
  if (byteLength > remaining) {
    throw limitFailure("maxCanonicalBytes", meter.limit, meter.limit + 1);
  }
  const source = canonicalStringify(envelope);
  if (capturedTextEncoder === undefined) {
    throw new TypeError("UTF-8 encoding is unavailable");
  }
  const bytes = reflectApply(
    capturedTextEncoder.method,
    capturedTextEncoder.target,
    [source],
  ) as Uint8Array;
  const encodedByteLength =
    typedArrayByteLengthGetter === undefined
      ? undefined
      : reflectApply(typedArrayByteLengthGetter, bytes, []);
  if (encodedByteLength !== byteLength) {
    throw new TypeError(
      "Canonical JSON byte-length preflight disagreed with encoding",
    );
  }
  meter.bytes += byteLength;
  if (capturedCryptoDigest === undefined) {
    throw new TypeError("WebCrypto SHA-256 is unavailable");
  }
  throwIfRealmCompromised();
  const digest = await (reflectApply(
    capturedCryptoDigest.method,
    capturedCryptoDigest.target,
    ["SHA-256", bytes],
  ) as PromiseLike<ArrayBuffer>);
  throwIfRealmCompromised();
  throwIfAborted(signal);
  const digestBytes = new IntrinsicUint8Array(digest);
  const digestByteLength =
    typedArrayByteLengthGetter === undefined
      ? undefined
      : reflectApply(typedArrayByteLengthGetter, digestBytes, []);
  if (digestByteLength !== 32) {
    throw new TypeError("WebCrypto returned a malformed SHA-256 digest");
  }
  let output = "";
  for (let index = 0; index < digestByteLength; index += 1) {
    const byte = digestBytes[index]!;
    output += HEX_DIGITS[byte >>> 4]!;
    output += HEX_DIGITS[byte & 0x0f]!;
  }
  throwIfRealmCompromised();
  return output;
}

function isCadFailure(value: unknown): value is CadResult<never> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return (
      (value as { readonly ok?: unknown }).ok === false &&
      Array.isArray((value as { readonly diagnostics?: unknown }).diagnostics)
    );
  } catch {
    return false;
  }
}

function resolvedMaterialDefinitions(
  document: DesignDocumentV7,
  parameterValues: ReadonlyMap<ParameterId, number>,
): CadResult<ReadonlyMap<string, ResolvedMaterialV2>> {
  const materials = new Map<string, ResolvedMaterialV2>();
  const diagnostics: Diagnostic[] = [];
  for (const id of Object.keys(document.materials ?? {}).sort(
    lexicalCompare,
  ) as MaterialId[]) {
    const definition = document.materials![id]!;
    let massDensity: number;
    try {
      massDensity = resolvedExpression(definition.massDensity, parameterValues);
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "MASS_DENSITY_INVALID",
          `Material '${id}' massDensity must evaluate to a finite, strictly positive number`,
          {
            severity: "error",
            path: `/materials/${id}/massDensity`,
            details: { cause: safeErrorMessage(error) },
          },
        ),
      );
      continue;
    }
    if (!(massDensity > 0)) {
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
    materials.set(id, {
      hashPayload: {
        id,
        name: definition.name,
        ...(definition.description === undefined
          ? {}
          : { description: definition.description }),
        massDensity,
        massDensityExpression: definition.massDensity,
        ...(definition.metadata === undefined
          ? {}
          : { metadata: definition.metadata }),
      },
      parameterDependencies: Object.freeze(
        [...expressionDependencies(definition.massDensity)].sort(
          lexicalCompare,
        ),
      ),
    });
  }
  return diagnostics.length === 0
    ? success(materials)
    : { ok: false, diagnostics };
}

function resourceHashPayload(
  id: ResourceId,
  definition: ResourceDefinitionIR,
): ResourceHashPayloadV2 {
  return {
    id,
    digest: definition.digest,
    byteLength: definition.byteLength,
    mediaType: definition.mediaType,
    ...(definition.metadata === undefined
      ? {}
      : { metadata: definition.metadata }),
  };
}

function contextualStateKey(
  node: NodeId,
  configurationId: ConfigurationId | null,
): string {
  return `${configurationId ?? ""}\u0000${node}`;
}

function contextualNodeDependencies(
  node: NodeIRV7,
  configurationId: ConfigurationId | null,
): readonly ContextualDependencyV2[] {
  if (node.kind !== "assembly") {
    return Object.freeze(
      nodeDependenciesV7(node).map((reference) => ({
        node: reference.node,
        kind: reference.kind,
        configurationId,
        stateKey: contextualStateKey(reference.node, configurationId),
      })),
    );
  }
  return Object.freeze(
    node.instances.flatMap((instance) => {
      if (instance.component.source === "external") return [];
      const reference = instance.component.reference;
      const childConfigurationId = occurrenceConfigurationId(
        instance.configuration,
        configurationId,
      );
      return [
        {
          node: reference.node,
          kind: reference.kind,
          configurationId: childConfigurationId,
          stateKey: contextualStateKey(
            reference.node,
            childConfigurationId,
          ),
        },
      ];
    }),
  );
}

/**
 * Computes root-context protocol-v2 Merkle hashes for a staged document-v7.
 *
 * Local assembly occurrences expand internal `(node, configuration)` states.
 * Only root-context entries appear in the report; contextual direct-child
 * evidence remains observable on every reported entry.
 *
 * Equality means equal v2 effective intent. It does not mean geometric
 * equality, kernel compatibility, or protocol-v1 artifact compatibility.
 */
export async function hashDesignFeaturesV2(
  document: DesignDocumentV7,
  options: HashDesignFeaturesV2Options = {},
): Promise<CadResult<DesignFeatureHashReportV2>> {
  let compromised = realmIntegrityError();
  if (compromised !== undefined) return compromised;
  const capturedOptions = captureOptions(options);
  compromised = realmIntegrityError();
  if (compromised !== undefined) return compromised;
  if (!capturedOptions.ok) return capturedOptions;
  if (
    capturedOptions.value.signal !== undefined &&
    abortSignalState(capturedOptions.value.signal) !== false
  ) {
    return abortFailure();
  }
  const parsed = parseDocumentValueV7(document, {
    ...(capturedOptions.value.documentLimits === undefined
      ? {}
      : { limits: capturedOptions.value.documentLimits }),
  });
  compromised = realmIntegrityError();
  if (compromised !== undefined) return compromised;
  if (!parsed.ok) return parsed;
  const snapshot = parsed.value;
  const nodeIds = Object.keys(snapshot.nodes).sort(lexicalCompare) as NodeId[];
  const limits = capturedOptions.value.limits;

  let rootConfigurationId: ConfigurationId | null = null;
  if (capturedOptions.value.configuration !== undefined) {
    const requested = capturedOptions.value.configuration;
    if (!Object.hasOwn(snapshot.configurations ?? {}, requested)) {
      return failure(
        diagnostic(
          "CONFIGURATION_MISSING",
          `Unknown configuration '${requested}'`,
          {
            severity: "error",
            path: `/configurations/${requested}`,
            details: {
              available: Object.keys(snapshot.configurations ?? {}).sort(
                lexicalCompare,
              ),
            },
          },
        ),
      );
    }
    rootConfigurationId = requested as ConfigurationId;
  }

  const contexts = new Map<
    ConfigurationId | null,
    ResolvedFeatureContextV2
  >();
  const resolveContext = (
    configurationId: ConfigurationId | null,
  ): CadResult<ResolvedFeatureContextV2> => {
    const cached = contexts.get(configurationId);
    if (cached !== undefined) return success(cached);
    const configuration =
      configurationId === null
        ? undefined
        : snapshot.configurations?.[configurationId];
    if (configurationId !== null && configuration === undefined) {
      return failure(
        diagnostic(
          "CONFIGURATION_MISSING",
          `Unknown configuration '${configurationId}'`,
          {
            severity: "error",
            path: `/configurations/${configurationId}`,
          },
        ),
      );
    }
    // The shared resolver observes only parameter and configuration fields.
    const parameters = resolveEvaluationParameters(
      snapshot as unknown as DesignDocument,
      capturedOptions.value.parameters,
      configurationId,
      configuration,
    );
    if (!parameters.ok) return parameters;
    const materials = resolvedMaterialDefinitions(
      snapshot,
      parameters.value.values,
    );
    if (!materials.ok) return materials;
    const resolved = Object.freeze({
      configurationId,
      ...(configuration === undefined ? {} : { configuration }),
      parameterValues: parameters.value.values,
      materials: materials.value,
      diagnostics: parameters.value.diagnostics,
    }) as ResolvedFeatureContextV2;
    contexts.set(configurationId, resolved);
    return success(resolved, parameters.value.diagnostics);
  };

  const requests = new Map<
    string,
    Readonly<{
      node: NodeId;
      configurationId: ConfigurationId | null;
    }>
  >();
  const requestOrder: string[] = [];
  const states = new Map<string, ContextualFeatureStateV2>();
  const reverse = new Map<string, string[]>();
  const indegrees = new Map<string, number>();
  let dependencyLinks = 0;
  const scheduleState = (
    node: NodeId,
    configurationId: ConfigurationId | null,
  ): void => {
    const key = contextualStateKey(node, configurationId);
    if (requests.has(key)) return;
    const actual = requests.size + 1;
    if (actual > limits.maxFeatureNodes) {
      throw limitFailure("maxFeatureNodes", limits.maxFeatureNodes, actual);
    }
    requests.set(key, Object.freeze({ node, configurationId }));
    requestOrder.push(key);
  };

  try {
    for (const id of nodeIds) scheduleState(id, rootConfigurationId);
    let discoveryCursor = 0;
    while (discoveryCursor < requestOrder.length) {
      throwIfAborted(capturedOptions.value.signal);
      throwIfRealmCompromised();
      const key = requestOrder[discoveryCursor++]!;
      const request = requests.get(key)!;
      const context = resolveContext(request.configurationId);
      throwIfRealmCompromised();
      if (!context.ok) throw context;
      const node = effectiveNode(
        request.node,
        snapshot.nodes[request.node] as NodeIRV7,
        request.configurationId,
        context.value.configuration,
      );
      const dependencies = contextualNodeDependencies(
        node,
        request.configurationId,
      );
      const resources = nodeResourceDependenciesV7(node);
      states.set(
        key,
        Object.freeze({
          key,
          node: request.node,
          configurationId: request.configurationId,
          effectiveNode: node,
          dependencies,
          resources,
        }),
      );
      indegrees.set(key, dependencies.length);
      dependencyLinks += dependencies.length + resources.length;
      if (dependencyLinks > limits.maxDependencyLinks) {
        throw limitFailure(
          "maxDependencyLinks",
          limits.maxDependencyLinks,
          dependencyLinks,
        );
      }
      for (const dependency of dependencies) {
        scheduleState(dependency.node, dependency.configurationId);
        const consumers = reverse.get(dependency.stateKey);
        if (consumers === undefined) {
          reverse.set(dependency.stateKey, [key]);
        } else {
          consumers.push(key);
        }
      }
    }
  } catch (error) {
    const integrityFailure = realmIntegrityError();
    if (integrityFailure !== undefined) return integrityFailure;
    if (isCadFailure(error)) return error;
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(error, "Feature dependencies could not be read safely"),
        { severity: "error", details: { phase: "featureHashV2" } },
      ),
    );
  }

  const ready = requestOrder.filter((key) => indegrees.get(key) === 0);
  const hashes = new Map<string, FeatureHashV2>();
  const entries = new Map<string, DesignFeatureHashEntryV2>();
  const referenceHashes = new Map<TopologyReferenceId, string>();
  const resourceHashes = new Map<ResourceId, string>();
  const meter: HashMeterV2 = {
    bytes: 0,
    limit: limits.maxCanonicalBytes,
  };
  const topologyMeter: TopologyWorkMeterV2 = {
    work: 0,
    limit: limits.maxTopologyWork,
  };
  let cursor = 0;
  try {
    while (cursor < ready.length) {
      throwIfAborted(capturedOptions.value.signal);
      throwIfRealmCompromised();
      const key = ready[cursor++]!;
      const state = states.get(key)!;
      const context = contexts.get(state.configurationId)!;
      const node = canonicalTopologyNode(
        state.effectiveNode,
        topologyMeter,
        capturedOptions.value.signal,
      );
      const dependencyPayload = state.dependencies.map((dependency) => ({
        node: dependency.node,
        kind: dependency.kind,
        configurationId: dependency.configurationId,
        hash: hashes.get(dependency.stateKey)!,
      }));

      const directParameterIds = new Set(
        nodeParameterDependenciesV7(node),
      );
      let effectiveMaterial: ResolvedMaterialV2 | undefined;
      if (node.kind === "part" && node.materialId !== undefined) {
        effectiveMaterial = context.materials.get(node.materialId);
        for (const parameter of
          effectiveMaterial?.parameterDependencies ?? []) {
          directParameterIds.add(parameter);
        }
      }
      const directParameterValues = Object.fromEntries(
        [...directParameterIds]
          .sort(lexicalCompare)
          .map((parameter) => [
            parameter,
            context.parameterValues.get(parameter)!,
          ]),
      ) as Readonly<Record<string, number>>;

      const usedReferences = nodeTopologyReferenceIds(
        node,
        topologyMeter,
        capturedOptions.value.signal,
      );
      const dependencyLinkActual = dependencyLinks + usedReferences.length;
      if (dependencyLinkActual > limits.maxDependencyLinks) {
        throw limitFailure(
          "maxDependencyLinks",
          limits.maxDependencyLinks,
          dependencyLinkActual,
        );
      }
      dependencyLinks = dependencyLinkActual;
      const topologyReferencePayload: {
        readonly reference: TopologyReferenceId;
        readonly hash: string;
      }[] = [];
      for (const reference of usedReferences) {
        let hash = referenceHashes.get(reference);
        if (hash === undefined) {
          const entry = snapshot.topologyReferences?.[reference];
          if (entry === undefined) {
            throw new TypeError(`Missing topology reference '${reference}'`);
          }
          hash = await digestEnvelope(
            FEATURE_HASH_TOPOLOGY_REFERENCE_DOMAIN_V2,
            {
              reference,
              entry: canonicalTopologyReferenceEntry(
                entry as TopologyReferenceEntryIRV7,
                topologyMeter,
                capturedOptions.value.signal,
              ),
            },
            meter,
            capturedOptions.value.signal,
          );
          referenceHashes.set(reference, hash);
        }
        topologyReferencePayload.push({ reference, hash });
      }

      const usedResources = state.resources;
      const resourcePayload: {
        readonly resource: ResourceId;
        readonly hash: string;
      }[] = [];
      for (const resource of usedResources) {
        let hash = resourceHashes.get(resource);
        if (hash === undefined) {
          const definition = snapshot.resources?.[resource];
          if (definition === undefined) {
            throw new TypeError(`Missing resource '${resource}'`);
          }
          hash = await digestEnvelope(
            FEATURE_HASH_RESOURCE_DOMAIN_V2,
            resourceHashPayload(resource, definition),
            meter,
            capturedOptions.value.signal,
          );
          resourceHashes.set(resource, hash);
        }
        resourcePayload.push({ resource, hash });
      }

      const digest = await digestEnvelope(
        FEATURE_HASH_DOMAIN_V2,
        {
          node: state.node,
          kind: node.kind,
          units: snapshot.units,
          local: node,
          parameters: directParameterValues,
          dependencies: dependencyPayload,
          topologyReferences: topologyReferencePayload,
          resources: resourcePayload,
          ...(effectiveMaterial === undefined
            ? {}
            : { material: effectiveMaterial.hashPayload }),
        },
        meter,
        capturedOptions.value.signal,
      );
      const hash = `${FEATURE_HASH_PREFIX_V2}${digest}` as FeatureHashV2;
      hashes.set(key, hash);
      entries.set(
        key,
        deepFreeze({
          node: state.node,
          kind: node.kind,
          outputKind: outputKindForNodeV7(node),
          hash,
          dependencies: state.dependencies.map(
            (dependency) => dependency.node,
          ),
          contextualDependencies: state.dependencies.map((dependency) => ({
            node: dependency.node,
            kind: dependency.kind,
            configurationId: dependency.configurationId,
            featureHash: hashes.get(dependency.stateKey)!,
          })),
          parameterValues: directParameterValues,
          topologyReferences: usedReferences,
          resources: usedResources,
        }) as DesignFeatureHashEntryV2,
      );
      for (const consumer of reverse.get(key) ?? []) {
        const remaining = indegrees.get(consumer)! - 1;
        indegrees.set(consumer, remaining);
        if (remaining === 0) ready.push(consumer);
      }
    }
  } catch (error) {
    const integrityFailure = realmIntegrityError();
    if (integrityFailure !== undefined) return integrityFailure;
    if (isCadFailure(error)) return error;
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(error, "Feature hashes could not be computed"),
        { severity: "error", details: { phase: "featureHashV2" } },
      ),
    );
  }

  if (entries.size !== states.size) {
    return failure(
      diagnostic("GRAPH_CYCLE", "The feature graph contains a cycle", {
        severity: "error",
        details: { phase: "featureHashV2" },
      }),
    );
  }
  const rootContext = resolveContext(rootConfigurationId);
  if (!rootContext.ok) return rootContext;
  const reportEntries = nodeIds.map(
    (id) =>
      entries.get(contextualStateKey(id, rootConfigurationId))!,
  );
  const outputs = Object.keys(snapshot.outputs)
    .sort(lexicalCompare)
    .map((name) => {
      const output = snapshot.outputs[name]!;
      return {
        name,
        node: output.node,
        kind: output.kind,
        featureHash: hashes.get(
          contextualStateKey(output.node, rootConfigurationId),
        )!,
      };
    });
  const allParameterValues = Object.fromEntries(
    [...rootContext.value.parameterValues.entries()].sort(
      ([first], [second]) => lexicalCompare(first, second),
    ),
  ) as Readonly<Record<string, number>>;
  const contextDiagnostics = new Map<string, Diagnostic>();
  for (const context of contexts.values()) {
    for (const item of context.diagnostics) {
      contextDiagnostics.set(canonicalStringify(item), item);
    }
  }
  compromised = realmIntegrityError();
  if (compromised !== undefined) return compromised;
  const report = deepFreeze({
    version: DESIGN_FEATURE_HASH_REPORT_VERSION_V2,
    hashProtocolVersion: FEATURE_HASH_PROTOCOL_VERSION_V2,
    algorithm: FEATURE_HASH_ALGORITHM_V2,
    configurationId: rootConfigurationId,
    parameterValues: allParameterValues,
    nodes: reportEntries,
    outputs,
  }) as DesignFeatureHashReportV2;
  compromised = realmIntegrityError();
  if (compromised !== undefined) return compromised;
  return success(
    report,
    Object.freeze([...contextDiagnostics.values()]),
  );
}
