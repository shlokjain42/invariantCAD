import type { ResourceId } from "./core/ids.js";
import {
  diagnostic,
  failure,
  success,
  type CadResult,
} from "./core/result.js";
import type {
  ResourceDefinitionIR,
  ResourceDigestIR,
} from "./ir.js";
import {
  DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
  documentV7RuntimeIntrinsicsAreIntact,
} from "./internal/document-v7-runtime-integrity.js";

/**
 * The document registry whose resource commitment is being resolved.
 *
 * External scope identity includes the root-document resource commitment so
 * two external documents may safely reuse the same document-local resource ID.
 *
 * @internal
 */
export type DocumentV7ResourceScope =
  | {
      readonly source: "root";
    }
  | {
      readonly source: "external";
      readonly resource: ResourceId;
      readonly digest: ResourceDigestIR;
    };

export interface ResourceResolverRequestV7 {
  readonly id: ResourceId;
  readonly digest: ResourceDigestIR;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly locations?: readonly string[];
  readonly signal?: AbortSignal;
  /**
   * Present only for document-scoped session resolution. Ordinary
   * `resolveResourcesV7` calls omit this property.
   *
   * @internal
   */
  readonly documentScope?: DocumentV7ResourceScope;
}

export type ResourceResolverV7 = (
  request: ResourceResolverRequestV7,
) =>
  | ArrayBuffer
  | Uint8Array
  | PromiseLike<ArrayBuffer | Uint8Array>;

export interface ResourceResolutionLimitsV7 {
  readonly maxRequestedResourceIds: number;
  readonly maxResolvedResources: number;
  readonly maxResourceBytes: number;
  readonly maxTotalResourceBytes: number;
}

export const DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7: ResourceResolutionLimitsV7 =
  Object.freeze({
    maxRequestedResourceIds: 4_096,
    maxResolvedResources: 1_024,
    maxResourceBytes: 64 * 1024 * 1024,
    maxTotalResourceBytes: 256 * 1024 * 1024,
  });

export interface ResolveResourcesOptionsV7 {
  readonly resolver?: ResourceResolverV7;
  readonly limits?: Partial<ResourceResolutionLimitsV7>;
  readonly signal?: AbortSignal;
}

/**
 * Verified resource bytes owned by one resolution operation.
 *
 * `read` always returns a new copy. The retained verified bytes are never
 * exposed, so callers cannot alter later reads or another consumer's input.
 */
export interface ResolvedResourcesV7 {
  readonly ids: readonly ResourceId[];
  has(id: ResourceId): boolean;
  byteLength(id: ResourceId): number | undefined;
  read(id: ResourceId): Uint8Array | undefined;
}

/** Detached resource commitment produced by v7 resolution preflight. @internal */
export interface CapturedResourceDefinitionV7 {
  readonly id: ResourceId;
  readonly digest: ResourceDigestIR;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly locations: readonly string[] | undefined;
}

/** Detached, fully preflighted input for one v7 resolution batch. @internal */
export interface ResourceResolutionPlanV7 {
  readonly ids: readonly ResourceId[];
  readonly definitions: readonly CapturedResourceDefinitionV7[];
  readonly committedByteLength: number;
}

interface CapturedResolveOptions {
  readonly resolver: ResourceResolverV7 | undefined;
  readonly limits: ResourceResolutionLimitsV7;
  readonly signal: AbortSignal | undefined;
}

interface ByteSource {
  readonly value: ArrayBuffer | Uint8Array;
  readonly byteLength: number;
  readonly kind: "array-buffer" | "uint8-array";
}

type OwnedResourceBytes = Uint8Array<ArrayBuffer>;

const LIMIT_KEYS = Object.freeze(
  Object.keys(
    DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
  ) as readonly (keyof ResourceResolutionLimitsV7)[],
);
const OPTION_KEYS = Object.freeze([
  "resolver",
  "limits",
  "signal",
] as const);
const RESOURCE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RESOURCE_MEDIA_TYPE_PATTERN =
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$/;

const IntrinsicArray = Array;
const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicNumber = Number;
const IntrinsicObject = Object;
const IntrinsicReflect = Reflect;
const IntrinsicSet = Set;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicMap = Map;
const IntrinsicPromise = Promise;
const IntrinsicWeakSet = WeakSet;
const reflectApply = Reflect.apply;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectKeys = Object.keys;
const arrayFrom = Array.from;
const arrayIsArray = Array.isArray;
const arraySort = Array.prototype.sort;
const arrayBufferIsView = ArrayBuffer.isView;
const numberIsSafeInteger = Number.isSafeInteger;
const regexpTest = RegExp.prototype.test;
const reflectGet = Reflect.get;
const stringTrim = String.prototype.trim;
const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
)?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const typedArraySet = Uint8Array.prototype.set;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;
const abortSignalAbortedGetter =
  typeof AbortSignal === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;
const eventTargetAddEventListener =
  typeof EventTarget === "undefined"
    ? undefined
    : EventTarget.prototype.addEventListener;
const eventTargetRemoveEventListener =
  typeof EventTarget === "undefined"
    ? undefined
    : EventTarget.prototype.removeEventListener;
const HEX_DIGITS = "0123456789abcdef";

function intrinsicArrayIsArray(value: unknown): value is readonly unknown[] {
  return reflectApply(arrayIsArray, IntrinsicArray, [value]) as boolean;
}

function intrinsicArrayFrom<T>(value: ArrayLike<T> | Iterable<T>): T[] {
  return reflectApply(arrayFrom, IntrinsicArray, [value]) as T[];
}

function intrinsicArrayAppend<T>(value: T[], entry: T): void {
  reflectApply(objectDefineProperty, IntrinsicObject, [
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

function intrinsicArraySort<T>(
  value: T[],
  compare: (first: T, second: T) => number,
): T[] {
  return reflectApply(arraySort, value, [compare]) as T[];
}

function intrinsicObjectCreateNull(): Record<string, unknown> {
  return reflectApply(objectCreate, IntrinsicObject, [
    null,
  ]) as Record<string, unknown>;
}

function intrinsicObjectFreeze<T>(value: T): Readonly<T> {
  return reflectApply(objectFreeze, IntrinsicObject, [value]) as Readonly<T>;
}

function intrinsicObjectKeys(value: object): string[] {
  return reflectApply(objectKeys, IntrinsicObject, [value]) as string[];
}

function intrinsicNumberIsSafeInteger(value: unknown): value is number {
  return reflectApply(numberIsSafeInteger, IntrinsicNumber, [
    value,
  ]) as boolean;
}

function intrinsicRegExpTest(value: RegExp, candidate: string): boolean {
  return reflectApply(regexpTest, value, [candidate]) as boolean;
}

function intrinsicReflectGet(value: object, key: PropertyKey): unknown {
  return reflectApply(reflectGet, IntrinsicReflect, [value, key]);
}

function intrinsicStringTrim(value: string): string {
  return reflectApply(stringTrim, value, []) as string;
}

function intrinsicSetAdd<T>(value: Set<T>, entry: T): void {
  reflectApply(setAdd, value, [entry]);
}

function intrinsicSetHas<T>(value: Set<T>, entry: T): boolean {
  return reflectApply(setHas, value, [entry]) as boolean;
}

interface CapturedCryptoDigest {
  readonly target: object;
  readonly method: (...arguments_: readonly unknown[]) => unknown;
}

const capturedCryptoDigest = (() => {
  try {
    const target: unknown = globalThis.crypto?.subtle;
    if (typeof target !== "object" || target === null) return undefined;
    let prototype: object | null = objectGetPrototypeOf(target);
    while (prototype !== null) {
      const descriptor = objectGetOwnPropertyDescriptor(prototype, "digest");
      if (descriptor !== undefined && typeof descriptor.value === "function") {
        return objectFreeze({
          target,
          method: descriptor.value as (
            ...arguments_: readonly unknown[]
          ) => unknown,
        }) satisfies CapturedCryptoDigest;
      }
      prototype = objectGetPrototypeOf(prototype);
    }
  } catch {
    // Resource resolution reports unavailable cryptographic support as a
    // structured resolution failure when hashing is attempted.
  }
  return undefined;
})();

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    intrinsicArrayIsArray(value)
  ) {
    return false;
  }
  const prototype = objectGetPrototypeOf(value);
  return prototype === null || objectGetPrototypeOf(prototype) === null;
}

function invalidInput<T = never>(
  message: string,
  path?: string,
): CadResult<T> {
  return failure(
    diagnostic("IR_INVALID", message, {
      severity: "error",
      ...(path === undefined ? {} : { path }),
      details: { phase: "resourceResolution" },
    }),
  );
}

function abortFailure<T = never>(): CadResult<T> {
  return failure(
    diagnostic("EVALUATION_ABORTED", "Resource resolution was aborted", {
      severity: "error",
      details: { phase: "resourceResolution" },
    }),
  );
}

function runtimeIntegrityFailure<T = never>(): CadResult<T> {
  return failure(
    diagnostic("IR_INVALID", DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE, {
      severity: "error",
      details: {
        phase: "resourceResolution",
        runtimeIntegrity: false,
      },
    }),
  );
}

function resolutionFailure<T = never>(
  id: ResourceId,
  message: string,
): CadResult<T> {
  return failure(
    diagnostic("RESOURCE_RESOLUTION_FAILED", message, {
      severity: "error",
      path: `/resources/${id}`,
      details: { phase: "resourceResolution", resourceId: id },
    }),
  );
}

function integrityFailure<T = never>(
  definition: CapturedResourceDefinitionV7,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): CadResult<T> {
  return failure(
    diagnostic("RESOURCE_INTEGRITY_MISMATCH", message, {
      severity: "error",
      path: `/resources/${definition.id}`,
      details: {
        phase: "resourceResolution",
        resourceId: definition.id,
        ...details,
      },
    }),
  );
}

function limitFailure<T = never>(
  resource: keyof ResourceResolutionLimitsV7,
  limit: number,
  details: Readonly<Record<string, unknown>>,
): CadResult<T> {
  return failure(
    diagnostic(
      "RESOURCE_LIMIT_EXCEEDED",
      `Resource-resolution ${resource} limit ${limit} was exceeded`,
      {
        severity: "error",
        details: {
          phase: "resourceResolution",
          resource,
          limit,
          ...details,
        },
      },
    ),
  );
}

function abortSignalState(value: unknown): boolean | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    abortSignalAbortedGetter === undefined
  ) {
    return undefined;
  }
  try {
    const state = reflectApply(abortSignalAbortedGetter, value, []);
    return typeof state === "boolean" ? state : undefined;
  } catch {
    return undefined;
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && abortSignalState(signal) !== false;
}

function snapshotPlainRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isPlainRecord(value)) return undefined;
    const snapshot = intrinsicObjectCreateNull();
    const keys = intrinsicObjectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      snapshot[key] = value[key];
    }
    return snapshot;
  } catch {
    return undefined;
  }
}

export function normalizeResourceResolutionLimitsV7(
  value: unknown,
): ResourceResolutionLimitsV7 | undefined {
  if (value === undefined) return DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7;
  const snapshot = snapshotPlainRecord(value);
  if (snapshot === undefined) return undefined;
  const keys = intrinsicObjectKeys(snapshot);
  for (let index = 0; index < keys.length; index += 1) {
    let known = false;
    for (
      let limitIndex = 0;
      limitIndex < LIMIT_KEYS.length;
      limitIndex += 1
    ) {
      if (LIMIT_KEYS[limitIndex] === keys[index]) {
        known = true;
        break;
      }
    }
    if (!known) return undefined;
  }
  const normalized: Record<keyof ResourceResolutionLimitsV7, number> = {
    ...DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
  };
  for (let index = 0; index < LIMIT_KEYS.length; index += 1) {
    const key = LIMIT_KEYS[index]!;
    if (!objectHasOwn(snapshot, key)) continue;
    const candidate = snapshot[key];
    if (
      typeof candidate !== "number" ||
      !intrinsicNumberIsSafeInteger(candidate) ||
      candidate < 0
    ) {
      return undefined;
    }
    normalized[key] = candidate;
  }
  return intrinsicObjectFreeze(normalized);
}

function captureOptions(value: unknown): CadResult<CapturedResolveOptions> {
  const snapshot = snapshotPlainRecord(value);
  if (snapshot === undefined) {
    return invalidInput("Resource-resolution options must be a plain record");
  }
  const optionKeys = intrinsicObjectKeys(snapshot);
  let unknownKey: string | undefined;
  for (let index = 0; index < optionKeys.length; index += 1) {
    const key = optionKeys[index]!;
    let known = false;
    for (
      let optionIndex = 0;
      optionIndex < OPTION_KEYS.length;
      optionIndex += 1
    ) {
      if (OPTION_KEYS[optionIndex] === key) {
        known = true;
        break;
      }
    }
    if (!known) {
      unknownKey = key;
      break;
    }
  }
  if (unknownKey !== undefined) {
    return invalidInput(
      `Unknown resource-resolution option '${unknownKey}'`,
      `/${unknownKey}`,
    );
  }
  const resolver = snapshot.resolver;
  if (resolver !== undefined && typeof resolver !== "function") {
    return invalidInput("Resource resolver must be a function", "/resolver");
  }
  const limits = normalizeResourceResolutionLimitsV7(snapshot.limits);
  if (limits === undefined) {
    return invalidInput(
      "Resource-resolution limits are malformed or unsupported",
      "/limits",
    );
  }
  const signal = snapshot.signal;
  if (signal !== undefined && abortSignalState(signal) === undefined) {
    return invalidInput("signal must be an AbortSignal", "/signal");
  }
  const captured = intrinsicObjectCreateNull() as {
    resolver: ResourceResolverV7 | undefined;
    limits: ResourceResolutionLimitsV7;
    signal: AbortSignal | undefined;
  };
  captured.resolver =
    resolver === undefined ? undefined : resolver as ResourceResolverV7;
  captured.limits = limits;
  captured.signal = signal === undefined ? undefined : signal as AbortSignal;
  return success(
    intrinsicObjectFreeze(captured) as CapturedResolveOptions,
  );
}

function captureRequestedIds(
  value: unknown,
  limits: ResourceResolutionLimitsV7,
  signal: AbortSignal | undefined,
): CadResult<readonly ResourceId[]> {
  try {
    if (!intrinsicArrayIsArray(value)) {
      return invalidInput("Requested resource IDs must be an array");
    }
    const length = value.length;
    if (!intrinsicNumberIsSafeInteger(length) || length < 0) {
      return invalidInput("Requested resource ID array length is invalid");
    }
    if (length > limits.maxRequestedResourceIds) {
      return limitFailure(
        "maxRequestedResourceIds",
        limits.maxRequestedResourceIds,
        { actual: length },
      );
    }
    const ids = new IntrinsicSet<ResourceId>();
    const ordered: ResourceId[] = [];
    for (let index = 0; index < length; index += 1) {
      if (isAborted(signal)) return abortFailure();
      if (!objectHasOwn(value, index)) {
        return invalidInput(
          "Requested resource IDs cannot be sparse",
          `/requestedIds/${index}`,
        );
      }
      const id: unknown = value[index];
      if (isAborted(signal)) return abortFailure();
      if (typeof id !== "string" || id.length === 0) {
        return invalidInput(
          "Requested resource IDs must be non-empty strings",
          `/requestedIds/${index}`,
        );
      }
      if (!intrinsicSetHas(ids, id as ResourceId)) {
        const actual = ordered.length + 1;
        if (actual > limits.maxResolvedResources) {
          return limitFailure(
            "maxResolvedResources",
            limits.maxResolvedResources,
            { actual },
          );
        }
        intrinsicSetAdd(ids, id as ResourceId);
        intrinsicArrayAppend(ordered, id as ResourceId);
      }
    }
    if (isAborted(signal)) return abortFailure();
    intrinsicArraySort(ordered, lexicalCompare);
    return success(intrinsicObjectFreeze(ordered));
  } catch {
    return invalidInput("Requested resource IDs could not be read safely");
  }
}

function captureLocations(
  value: unknown,
  id: ResourceId,
  signal: AbortSignal | undefined,
): CadResult<readonly string[] | undefined> {
  if (value === undefined) return success(undefined);
  try {
    if (!intrinsicArrayIsArray(value)) {
      return invalidInput(
        `Resource '${id}' locations must be a non-empty array`,
        `/resources/${id}/locations`,
      );
    }
    const length = value.length;
    if (!intrinsicNumberIsSafeInteger(length) || length <= 0) {
      return invalidInput(
        `Resource '${id}' locations must be a non-empty array`,
        `/resources/${id}/locations`,
      );
    }
    const output: string[] = [];
    const seen = new IntrinsicSet<string>();
    for (let index = 0; index < length; index += 1) {
      if (isAborted(signal)) return abortFailure();
      if (!objectHasOwn(value, index)) {
        return invalidInput(
          `Resource '${id}' locations cannot be sparse`,
          `/resources/${id}/locations/${index}`,
        );
      }
      const location: unknown = value[index];
      if (isAborted(signal)) return abortFailure();
      if (typeof location !== "string" || location.length === 0) {
        return invalidInput(
          `Resource '${id}' locations must be non-empty strings`,
          `/resources/${id}/locations/${index}`,
        );
      }
      if (intrinsicSetHas(seen, location)) {
        return invalidInput(
          `Resource '${id}' locations cannot contain duplicates`,
          `/resources/${id}/locations/${index}`,
        );
      }
      intrinsicSetAdd(seen, location);
      intrinsicArrayAppend(output, location);
    }
    if (isAborted(signal)) return abortFailure();
    return success(intrinsicObjectFreeze(output));
  } catch {
    return invalidInput(
      `Resource '${id}' locations could not be read safely`,
      `/resources/${id}/locations`,
    );
  }
}

type OwnDataProperty =
  | { readonly kind: "missing" }
  | { readonly kind: "accessor" }
  | { readonly kind: "data"; readonly value: unknown };

function ownDataProperty(
  value: object,
  key: string,
): OwnDataProperty {
  const descriptor = objectGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return { kind: "missing" };
  if (!objectHasOwn(descriptor, "value")) return { kind: "accessor" };
  return { kind: "data", value: descriptor.value };
}

function captureDefinition(
  id: ResourceId,
  value: unknown,
  signal: AbortSignal | undefined,
): CadResult<CapturedResourceDefinitionV7> {
  let digest: unknown;
  let byteLength: unknown;
  let mediaType: unknown;
  let rawLocations: unknown;
  try {
    if (!isPlainRecord(value)) {
      return invalidInput(
        `Resource '${id}' definition must be a plain record`,
        `/resources/${id}`,
      );
    }
    if (isAborted(signal)) return abortFailure();
    const digestProperty = ownDataProperty(value, "digest");
    if (isAborted(signal)) return abortFailure();
    if (digestProperty.kind !== "data") {
      return invalidInput(
        `Resource '${id}' digest must be an own data property`,
        `/resources/${id}/digest`,
      );
    }
    digest = digestProperty.value;

    const byteLengthProperty = ownDataProperty(value, "byteLength");
    if (isAborted(signal)) return abortFailure();
    if (byteLengthProperty.kind !== "data") {
      return invalidInput(
        `Resource '${id}' byteLength must be an own data property`,
        `/resources/${id}/byteLength`,
      );
    }
    byteLength = byteLengthProperty.value;

    const mediaTypeProperty = ownDataProperty(value, "mediaType");
    if (isAborted(signal)) return abortFailure();
    if (mediaTypeProperty.kind !== "data") {
      return invalidInput(
        `Resource '${id}' mediaType must be an own data property`,
        `/resources/${id}/mediaType`,
      );
    }
    mediaType = mediaTypeProperty.value;

    const locationsProperty = ownDataProperty(value, "locations");
    if (isAborted(signal)) return abortFailure();
    if (locationsProperty.kind === "accessor") {
      return invalidInput(
        `Resource '${id}' locations must be an own data property`,
        `/resources/${id}/locations`,
      );
    }
    rawLocations =
      locationsProperty.kind === "data"
        ? locationsProperty.value
        : undefined;
  } catch {
    return invalidInput(
      `Resource '${id}' definition could not be read safely`,
      `/resources/${id}`,
    );
  }
  if (
    typeof digest !== "string" ||
    !intrinsicRegExpTest(RESOURCE_DIGEST_PATTERN, digest)
  ) {
    return invalidInput(
      `Resource '${id}' digest must be lowercase SHA-256`,
      `/resources/${id}/digest`,
    );
  }
  if (
    typeof byteLength !== "number" ||
    !intrinsicNumberIsSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    return invalidInput(
      `Resource '${id}' byteLength must be a non-negative safe integer`,
      `/resources/${id}/byteLength`,
    );
  }
  if (
    typeof mediaType !== "string" ||
    intrinsicStringTrim(mediaType) !== mediaType ||
    !intrinsicRegExpTest(RESOURCE_MEDIA_TYPE_PATTERN, mediaType)
  ) {
    return invalidInput(
      `Resource '${id}' mediaType must be a non-empty MIME type`,
      `/resources/${id}/mediaType`,
    );
  }
  const locations = captureLocations(rawLocations, id, signal);
  if (!locations.ok) return locations;
  const captured = intrinsicObjectCreateNull() as {
    id: ResourceId;
    digest: ResourceDigestIR;
    byteLength: number;
    mediaType: string;
    locations: readonly string[] | undefined;
  };
  captured.id = id;
  captured.digest = digest as ResourceDigestIR;
  captured.byteLength = byteLength;
  captured.mediaType = mediaType;
  captured.locations = locations.value;
  return success(
    intrinsicObjectFreeze(captured) as CapturedResourceDefinitionV7,
  );
}

function captureDefinitions(
  definitions: unknown,
  ids: readonly ResourceId[],
  limits: ResourceResolutionLimitsV7,
  signal: AbortSignal | undefined,
): CadResult<readonly CapturedResourceDefinitionV7[]> {
  try {
    if (!isPlainRecord(definitions)) {
      return invalidInput("Resource definitions must be a plain record");
    }
    const captured: CapturedResourceDefinitionV7[] = [];
    let total = 0;
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index]!;
      if (isAborted(signal)) return abortFailure();
      if (!objectHasOwn(definitions, id)) {
        return failure(
          diagnostic(
            "REFERENCE_MISSING",
            `Requested resource '${id}' is not defined`,
            {
              severity: "error",
              path: `/resources/${id}`,
              details: { phase: "resourceResolution", resourceId: id },
            },
          ),
        );
      }
      const definitionProperty = ownDataProperty(definitions, id);
      if (definitionProperty.kind !== "data") {
        return invalidInput(
          `Resource '${id}' registry entry must be an own data property`,
          `/resources/${id}`,
        );
      }
      const rawDefinition = definitionProperty.value;
      if (isAborted(signal)) return abortFailure();
      const definition = captureDefinition(id, rawDefinition, signal);
      if (!definition.ok) return definition;
      if (definition.value.byteLength > limits.maxResourceBytes) {
        return limitFailure("maxResourceBytes", limits.maxResourceBytes, {
          resourceId: definition.value.id,
          actual: definition.value.byteLength,
        });
      }
      if (definition.value.byteLength > limits.maxTotalResourceBytes - total) {
        return limitFailure(
          "maxTotalResourceBytes",
          limits.maxTotalResourceBytes,
          {
            resourceId: definition.value.id,
            consumed: total,
            requested: definition.value.byteLength,
          },
        );
      }
      total += definition.value.byteLength;
      intrinsicArrayAppend(captured, definition.value);
    }
    if (isAborted(signal)) return abortFailure();
    return success(intrinsicObjectFreeze(captured));
  } catch {
    return invalidInput("Resource definitions could not be read safely");
  }
}

/**
 * Captures and validates one complete resource batch without invoking a
 * resolver. Callers may compose multiple plans and enforce aggregate limits
 * before beginning any I/O.
 *
 * @internal
 */
export function preflightResourceResolutionV7(
  definitions: Readonly<Record<string, ResourceDefinitionIR>>,
  requestedIds: readonly ResourceId[],
  limits: ResourceResolutionLimitsV7,
  signal?: AbortSignal,
): CadResult<ResourceResolutionPlanV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  if (isAborted(signal)) return abortFailure();
  const capturedIds = captureRequestedIds(requestedIds, limits, signal);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  if (isAborted(signal)) return abortFailure();
  if (!capturedIds.ok) return capturedIds;
  const capturedDefinitions = captureDefinitions(
    definitions,
    capturedIds.value,
    limits,
    signal,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  if (isAborted(signal)) return abortFailure();
  if (!capturedDefinitions.ok) return capturedDefinitions;

  let committedByteLength = 0;
  for (
    let index = 0;
    index < capturedDefinitions.value.length;
    index += 1
  ) {
    committedByteLength +=
      capturedDefinitions.value[index]!.byteLength;
  }
  return success(
    intrinsicObjectFreeze({
      ids: capturedIds.value,
      definitions: capturedDefinitions.value,
      committedByteLength,
    }),
  );
}

function hasArrayBufferBrand(value: unknown): value is ArrayBuffer {
  if (arrayBufferByteLengthGetter === undefined) return false;
  try {
    reflectApply(arrayBufferByteLengthGetter, value, []);
    return true;
  } catch {
    return false;
  }
}

function byteSource(value: unknown): ByteSource | undefined {
  try {
    if (hasArrayBufferBrand(value)) {
      const byteLength = reflectApply(
        arrayBufferByteLengthGetter!,
        value,
        [],
      ) as unknown;
      return typeof byteLength === "number" &&
        intrinsicNumberIsSafeInteger(byteLength) &&
        byteLength >= 0
        ? {
            value,
            byteLength,
            kind: "array-buffer",
          }
        : undefined;
    }
    if (
      typedArrayTagGetter === undefined ||
      typedArrayByteLengthGetter === undefined ||
      typedArrayBufferGetter === undefined ||
      arrayBufferByteLengthGetter === undefined ||
      !reflectApply(arrayBufferIsView, IntrinsicArrayBuffer, [value]) ||
      reflectApply(typedArrayTagGetter, value, []) !== "Uint8Array"
    ) {
      return undefined;
    }
    const buffer: unknown = reflectApply(
      typedArrayBufferGetter,
      value,
      [],
    );
    // The ArrayBuffer intrinsic rejects SharedArrayBuffer-backed views.
    reflectApply(arrayBufferByteLengthGetter, buffer, []);
    const byteLength: unknown = reflectApply(
      typedArrayByteLengthGetter,
      value,
      [],
    );
    return typeof byteLength === "number" &&
      intrinsicNumberIsSafeInteger(byteLength) &&
      byteLength >= 0
      ? {
          value: value as Uint8Array,
          byteLength,
          kind: "uint8-array",
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function copyByteSource(
  source: ByteSource,
): OwnedResourceBytes | undefined {
  try {
    const copied = new IntrinsicUint8Array(source.byteLength);
    const view =
      source.kind === "array-buffer"
        ? new IntrinsicUint8Array(source.value as ArrayBuffer)
        : source.value;
    reflectApply(typedArraySet, copied, [view]);
    return copied;
  } catch {
    return undefined;
  }
}

interface CapturedPromiseLike {
  readonly target: object | ((...arguments_: readonly unknown[]) => unknown);
  readonly then: (...arguments_: readonly unknown[]) => unknown;
}

function capturePromiseLike(value: unknown): CapturedPromiseLike | undefined {
  if (
    !(
      (typeof value === "object" && value !== null) ||
      typeof value === "function"
    )
  ) {
    return undefined;
  }
  const then = intrinsicReflectGet(value, "then");
  return typeof then === "function"
    ? intrinsicObjectFreeze({
        target: value,
        then: then as (...arguments_: readonly unknown[]) => unknown,
      })
    : undefined;
}

class ResourceResolutionAbort {
  readonly name = "ResourceResolutionAbort";
}

const resourceResolutionAborts = new IntrinsicWeakSet<object>();

function resourceResolutionAbort(): ResourceResolutionAbort {
  const value = new ResourceResolutionAbort();
  reflectApply(weakSetAdd, resourceResolutionAborts, [value]);
  return value;
}

function isResourceResolutionAbort(value: unknown): boolean {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    (reflectApply(weakSetHas, resourceResolutionAborts, [value]) as boolean)
  );
}

interface ResolverSettlement {
  value: unknown;
}

function resolverSettlement(value: unknown): ResolverSettlement {
  const settlement = objectCreate(null) as ResolverSettlement;
  settlement.value = value;
  return settlement;
}

function awaitResolverResult(
  pending: CapturedPromiseLike,
  signal: AbortSignal | undefined,
): Promise<ResolverSettlement> {
  return new IntrinsicPromise((resolve, reject) => {
    let settled = false;
    let listenerAttached = false;
    const removeListener = (): void => {
      if (
        !listenerAttached ||
        signal === undefined ||
        eventTargetRemoveEventListener === undefined
      ) {
        return;
      }
      listenerAttached = false;
      try {
        reflectApply(eventTargetRemoveEventListener, signal, [
          "abort",
          onAbort,
        ]);
      } catch {
        // Listener cleanup must not replace the selected resolution outcome.
      }
    };
    const settle = <Value>(
      callback: (value: Value) => void,
      value: Value,
    ): void => {
      if (settled) return;
      settled = true;
      removeListener();
      callback(value);
    };
    const onAbort = (): void => {
      settle(reject, resourceResolutionAbort());
    };
    if (signal !== undefined) {
      if (
        eventTargetAddEventListener === undefined ||
        eventTargetRemoveEventListener === undefined
      ) {
        reject(new TypeError("AbortSignal event intrinsics are unavailable"));
        return;
      }
      try {
        reflectApply(eventTargetAddEventListener, signal, [
          "abort",
          onAbort,
          { once: true },
        ]);
        listenerAttached = true;
        if (isAborted(signal)) {
          onAbort();
          return;
        }
      } catch (error) {
        removeListener();
        reject(error);
        return;
      }
    }
    try {
      reflectApply(pending.then, pending.target, [
        (value: unknown) => settle(resolve, resolverSettlement(value)),
        (error: unknown) => settle(reject, error),
      ]);
    } catch (error) {
      settle(reject, error);
    }
  });
}

async function sha256Digest(
  bytes: OwnedResourceBytes,
): Promise<ResourceDigestIR> {
  if (capturedCryptoDigest === undefined) {
    throw new TypeError("WebCrypto SHA-256 is unavailable");
  }
  const buffer = reflectApply(
    typedArrayBufferGetter!,
    bytes,
    [],
  ) as ArrayBuffer;
  const digest = await (reflectApply(
    capturedCryptoDigest.method,
    capturedCryptoDigest.target,
    ["SHA-256", buffer],
  ) as PromiseLike<ArrayBuffer>);
  const digestBytes = new IntrinsicUint8Array(digest);
  const digestByteLength = reflectApply(
    typedArrayByteLengthGetter!,
    digestBytes,
    [],
  ) as number;
  let output = "sha256:";
  for (let index = 0; index < digestByteLength; index += 1) {
    const byte = digestBytes[index]!;
    output += HEX_DIGITS[byte >>> 4]!;
    output += HEX_DIGITS[byte & 0x0f]!;
  }
  return output as ResourceDigestIR;
}

function createResolvedResources(
  ids: readonly ResourceId[],
  resources: Map<ResourceId, OwnedResourceBytes>,
): ResolvedResourcesV7 {
  const publicIds = intrinsicObjectFreeze(intrinsicArrayFrom(ids));
  return intrinsicObjectFreeze({
    ids: publicIds,
    has: (id: ResourceId): boolean =>
      reflectApply(mapHas, resources, [id]) as boolean,
    byteLength: (id: ResourceId): number | undefined => {
      const bytes = reflectApply(mapGet, resources, [
        id,
      ]) as OwnedResourceBytes | undefined;
      if (bytes === undefined) return undefined;
      return reflectApply(
        typedArrayByteLengthGetter!,
        bytes,
        [],
      ) as number;
    },
    read: (id: ResourceId): Uint8Array | undefined => {
      const bytes = reflectApply(mapGet, resources, [
        id,
      ]) as OwnedResourceBytes | undefined;
      if (bytes === undefined) return undefined;
      const byteLength = reflectApply(
        typedArrayByteLengthGetter!,
        bytes,
        [],
      ) as number;
      const copied = new IntrinsicUint8Array(byteLength);
      reflectApply(typedArraySet, copied, [bytes]);
      return copied;
    },
  });
}

/**
 * Resolves and verifies an explicit set of staged document-v7 resources.
 *
 * Core code never dereferences `locations`. Each distinct requested ID is
 * resolved once in lexical order, and all definitions and options are detached
 * before the first resolver call.
 */
export async function resolveResourcesV7(
  definitions: Readonly<Record<string, ResourceDefinitionIR>>,
  requestedIds: readonly ResourceId[],
  options: ResolveResourcesOptionsV7 = {},
): Promise<CadResult<ResolvedResourcesV7>> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  const capturedOptions = captureOptions(options);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  if (!capturedOptions.ok) return capturedOptions;
  if (isAborted(capturedOptions.value.signal)) return abortFailure();

  const plan = preflightResourceResolutionV7(
    definitions,
    requestedIds,
    capturedOptions.value.limits,
    capturedOptions.value.signal,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  if (isAborted(capturedOptions.value.signal)) return abortFailure();
  if (!plan.ok) return plan;

  if (plan.value.definitions.length === 0) {
    return success(
      createResolvedResources(plan.value.ids, new IntrinsicMap()),
    );
  }
  const resolver = capturedOptions.value.resolver;
  if (resolver === undefined) {
    return failure(
      diagnostic(
        "RESOURCE_RESOLVER_MISSING",
        "Resource resolution requires an application-supplied resolver",
        {
          severity: "error",
          details: {
            phase: "resourceResolution",
            resources: plan.value.ids.length,
          },
        },
      ),
    );
  }

  const resolved = new IntrinsicMap<ResourceId, OwnedResourceBytes>();
  let consumedBytes = 0;
  for (
    let definitionIndex = 0;
    definitionIndex < plan.value.definitions.length;
    definitionIndex += 1
  ) {
    const definition = plan.value.definitions[definitionIndex]!;
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return runtimeIntegrityFailure();
    }
    if (isAborted(capturedOptions.value.signal)) return abortFailure();
    const request = intrinsicObjectFreeze({
      id: definition.id,
      digest: definition.digest,
      byteLength: definition.byteLength,
      mediaType: definition.mediaType,
      ...(definition.locations === undefined
        ? {}
        : {
            locations: intrinsicObjectFreeze(
              intrinsicArrayFrom(definition.locations),
            ),
          }),
      ...(capturedOptions.value.signal === undefined
        ? {}
        : { signal: capturedOptions.value.signal }),
    }) as ResourceResolverRequestV7;

    let returned: unknown;
    try {
      const candidate: unknown = reflectApply(resolver, undefined, [request]);
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return runtimeIntegrityFailure();
      }
      if (isAborted(capturedOptions.value.signal)) return abortFailure();
      if (byteSource(candidate) !== undefined) {
        returned = candidate;
      } else {
        const pending = capturePromiseLike(candidate);
        if (!documentV7RuntimeIntrinsicsAreIntact()) {
          return runtimeIntegrityFailure();
        }
        if (isAborted(capturedOptions.value.signal)) return abortFailure();
        if (pending === undefined) {
          return resolutionFailure(
            definition.id,
            `Resolver returned unsupported bytes for resource '${definition.id}'`,
          );
        }
        const settlement = await awaitResolverResult(
          pending,
          capturedOptions.value.signal,
        );
        if (!documentV7RuntimeIntrinsicsAreIntact()) {
          return runtimeIntegrityFailure();
        }
        if (isAborted(capturedOptions.value.signal)) return abortFailure();
        returned = settlement.value;
      }
    } catch (error) {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return runtimeIntegrityFailure();
      }
      if (
        isResourceResolutionAbort(error) ||
        isAborted(capturedOptions.value.signal)
      ) {
        return abortFailure();
      }
      return resolutionFailure(
        definition.id,
        `Resolver failed for resource '${definition.id}'`,
      );
    }
    if (isAborted(capturedOptions.value.signal)) return abortFailure();

    const source = byteSource(returned);
    if (source === undefined) {
      return resolutionFailure(
        definition.id,
        `Resolver returned unsupported bytes for resource '${definition.id}'`,
      );
    }
    if (source.byteLength > capturedOptions.value.limits.maxResourceBytes) {
      return limitFailure(
        "maxResourceBytes",
        capturedOptions.value.limits.maxResourceBytes,
        { resourceId: definition.id, actual: source.byteLength },
      );
    }
    if (
      source.byteLength >
      capturedOptions.value.limits.maxTotalResourceBytes - consumedBytes
    ) {
      return limitFailure(
        "maxTotalResourceBytes",
        capturedOptions.value.limits.maxTotalResourceBytes,
        {
          resourceId: definition.id,
          consumed: consumedBytes,
          requested: source.byteLength,
        },
      );
    }
    if (source.byteLength !== definition.byteLength) {
      return integrityFailure(
        definition,
        `Resource '${definition.id}' byte length does not match its commitment`,
        {
          expectedByteLength: definition.byteLength,
          actualByteLength: source.byteLength,
        },
      );
    }
    const copied = copyByteSource(source);
    if (copied === undefined) {
      return resolutionFailure(
        definition.id,
        `Resolver returned invalid or detached bytes for resource '${definition.id}'`,
      );
    }
    consumedBytes += reflectApply(
      typedArrayByteLengthGetter!,
      copied,
      [],
    ) as number;

    let digest: ResourceDigestIR;
    try {
      digest = await sha256Digest(copied);
    } catch {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return runtimeIntegrityFailure();
      }
      if (isAborted(capturedOptions.value.signal)) return abortFailure();
      return resolutionFailure(
        definition.id,
        `Resource '${definition.id}' could not be hashed`,
      );
    }
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return runtimeIntegrityFailure();
    }
    if (isAborted(capturedOptions.value.signal)) return abortFailure();
    if (digest !== definition.digest) {
      return integrityFailure(
        definition,
        `Resource '${definition.id}' digest does not match its commitment`,
        { expectedDigest: definition.digest },
      );
    }
    reflectApply(mapSet, resolved, [definition.id, copied]);
  }

  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  if (isAborted(capturedOptions.value.signal)) return abortFailure();
  return success(createResolvedResources(plan.value.ids, resolved));
}
