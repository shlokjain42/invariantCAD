import type { ResourceId } from "../core/ids.js";
import {
  diagnostic,
  failure,
  success,
  type CadResult,
  type Diagnostic,
} from "../core/result.js";
import type {
  ResourceDefinitionIR,
  ResourceDigestIR,
} from "../ir.js";
import {
  normalizeResourceResolutionLimitsV7,
  preflightResourceResolutionV7,
  resolveResourcesV7,
  type CapturedResourceDefinitionV7,
  type DocumentV7ResourceScope,
  type ResolvedResourcesV7,
  type ResourceResolutionLimitsV7,
  type ResourceResolverRequestV7,
  type ResourceResolverV7,
} from "../resource-resolution.js";
import {
  DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
  documentV7RuntimeIntrinsicsAreIntact,
} from "./document-v7-runtime-integrity.js";

/** One document-local resource registry and its requested IDs. @internal */
export interface DocumentV7ResourceResolutionBatch {
  readonly scope: DocumentV7ResourceScope;
  readonly definitions: Readonly<
    Record<string, ResourceDefinitionIR>
  >;
  readonly ids: readonly ResourceId[];
}

/** Construction options for a document-scoped resolution session. @internal */
export interface DocumentV7ResourceResolutionSessionOptions {
  readonly resolver?: ResourceResolverV7;
  readonly limits?: Partial<ResourceResolutionLimitsV7>;
  readonly signal?: AbortSignal;
}

/**
 * Cumulative verified resources retained by one session generation.
 *
 * Every read is a defensive copy. A reader remains a stable snapshot across
 * later successful phases, and becomes inert after session clear/disposal.
 *
 * @internal
 */
export interface ResolvedDocumentResourcesV7 {
  readonly scopes: readonly DocumentV7ResourceScope[];
  has(scope: DocumentV7ResourceScope, id: ResourceId): boolean;
  byteLength(
    scope: DocumentV7ResourceScope,
    id: ResourceId,
  ): number | undefined;
  read(
    scope: DocumentV7ResourceScope,
    id: ResourceId,
  ): Uint8Array | undefined;
  forScope(
    scope: DocumentV7ResourceScope,
  ): ResolvedResourcesV7 | undefined;
}

interface CapturedSessionOptions {
  readonly resolver: ResourceResolverV7 | undefined;
  readonly limits: ResourceResolutionLimitsV7;
  readonly signal: AbortSignal | undefined;
}

interface CapturedScope {
  readonly value: DocumentV7ResourceScope;
  readonly key: string;
  readonly sortKey: string;
}

interface PlannedResource {
  readonly key: string;
  readonly scope: CapturedScope;
  readonly definition: CapturedResourceDefinitionV7;
}

interface SessionPlan {
  readonly pending: readonly PlannedResource[];
}

type OwnedResourceBytes = Uint8Array<ArrayBuffer>;

interface CachedResource {
  readonly key: string;
  readonly scope: CapturedScope;
  readonly definition: CapturedResourceDefinitionV7;
  readonly bytes: OwnedResourceBytes;
}

const IntrinsicArray = Array;
const IntrinsicMap = Map;
const IntrinsicNumber = Number;
const IntrinsicObject = Object;
const IntrinsicReflect = Reflect;
const IntrinsicUint8Array = Uint8Array;
const arrayIsArray = Array.isArray;
const arraySort = Array.prototype.sort;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const regexpTest = RegExp.prototype.test;
const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayFill = Uint8Array.prototype.fill;
const typedArraySet = Uint8Array.prototype.set;
const abortSignalAbortedGetter =
  typeof AbortSignal === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
        AbortSignal.prototype,
        "aborted",
      )?.get;

const OPTION_KEYS = Object.freeze([
  "resolver",
  "limits",
  "signal",
] as const);
const LIMIT_KEYS = Object.freeze([
  "maxRequestedResourceIds",
  "maxResolvedResources",
  "maxResourceBytes",
  "maxTotalResourceBytes",
] as const);
const BATCH_KEYS = Object.freeze([
  "scope",
  "definitions",
  "ids",
] as const);
const ROOT_SCOPE_KEYS = Object.freeze(["source"] as const);
const EXTERNAL_SCOPE_KEYS = Object.freeze([
  "source",
  "resource",
  "digest",
] as const);
const RESOURCE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
const RESOURCE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function intrinsicArrayIsArray(
  value: unknown,
): value is readonly unknown[] {
  return reflectApply(arrayIsArray, IntrinsicArray, [value]) as boolean;
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
  return reflectApply(objectFreeze, IntrinsicObject, [
    value,
  ]) as Readonly<T>;
}

function intrinsicNumberIsSafeInteger(
  value: unknown,
): value is number {
  return reflectApply(numberIsSafeInteger, IntrinsicNumber, [
    value,
  ]) as boolean;
}

function intrinsicRegExpTest(
  expression: RegExp,
  value: string,
): boolean {
  return reflectApply(regexpTest, expression, [value]) as boolean;
}

function intrinsicMapGet<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
): Value | undefined {
  return reflectApply(mapGet, map, [key]) as Value | undefined;
}

function intrinsicMapHas<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
): boolean {
  return reflectApply(mapHas, map, [key]) as boolean;
}

function intrinsicMapSet<Key, Value>(
  map: Map<Key, Value>,
  key: Key,
  value: Value,
): void {
  reflectApply(mapSet, map, [key, value]);
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function invalidInput<T = never>(
  message: string,
  path?: string,
): CadResult<T> {
  return failure(
    diagnostic("IR_INVALID", message, {
      severity: "error",
      ...(path === undefined ? {} : { path }),
      details: {
        phase: "resourceResolution",
        session: true,
      },
    }),
  );
}

function abortFailure<T = never>(): CadResult<T> {
  return failure(
    diagnostic("EVALUATION_ABORTED", "Resource resolution was aborted", {
      severity: "error",
      details: {
        phase: "resourceResolution",
        session: true,
      },
    }),
  );
}

function runtimeIntegrityFailure<T = never>(): CadResult<T> {
  return failure(
    diagnostic("IR_INVALID", DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE, {
      severity: "error",
      details: {
        phase: "resourceResolution",
        session: true,
        runtimeIntegrity: false,
      },
    }),
  );
}

function sessionFailure<T = never>(message: string): CadResult<T> {
  return failure(
    diagnostic("RESOURCE_RESOLUTION_FAILED", message, {
      severity: "error",
      details: {
        phase: "resourceResolution",
        session: true,
      },
    }),
  );
}

function limitFailure<T = never>(
  resource: keyof ResourceResolutionLimitsV7,
  limit: number,
  actual: number,
): CadResult<T> {
  return failure(
    diagnostic(
      "RESOURCE_LIMIT_EXCEEDED",
      `Resource-resolution ${resource} limit ${limit} was exceeded`,
      {
        severity: "error",
        details: {
          phase: "resourceResolution",
          session: true,
          resource,
          limit,
          actual,
        },
      },
    ),
  );
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<PropertyKey, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    intrinsicArrayIsArray(value)
  ) {
    return false;
  }
  const prototype = reflectApply(
    objectGetPrototypeOf,
    IntrinsicObject,
    [value],
  ) as object | null;
  return (
    prototype === null ||
    reflectApply(objectGetPrototypeOf, IntrinsicObject, [
        prototype,
      ]) === null
  );
}

type OwnDataProperty =
  | { readonly kind: "missing" }
  | { readonly kind: "accessor" }
  | { readonly kind: "data"; readonly value: unknown };

function ownDataProperty(
  value: object,
  key: PropertyKey,
): OwnDataProperty {
  const descriptor = reflectApply(
    objectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [value, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined) return { kind: "missing" };
  if (!objectHasOwn(descriptor, "value")) {
    return { kind: "accessor" };
  }
  return { kind: "data", value: descriptor.value };
}

function knownKey(
  key: string,
  allowed: readonly string[],
): boolean {
  for (let index = 0; index < allowed.length; index += 1) {
    if (allowed[index] === key) return true;
  }
  return false;
}

function captureExactRecord(
  value: unknown,
  allowed: readonly string[],
  label: string,
  path: string,
): CadResult<Readonly<Record<string, unknown>>> {
  try {
    if (!isPlainRecord(value)) {
      return invalidInput(`${label} must be a plain record`, path);
    }
    const keys = reflectApply(reflectOwnKeys, IntrinsicReflect, [
      value,
    ]) as PropertyKey[];
    const snapshot = intrinsicObjectCreateNull();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key !== "string" || !knownKey(key, allowed)) {
        return invalidInput(
          `${label} contains an unknown property`,
          path,
        );
      }
      const property = ownDataProperty(value, key);
      if (property.kind !== "data") {
        return invalidInput(
          `${label} properties must be own data properties`,
          `${path}/${key}`,
        );
      }
      snapshot[key] = property.value;
    }
    return success(intrinsicObjectFreeze(snapshot));
  } catch {
    return invalidInput(`${label} could not be read safely`, path);
  }
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

function captureLimits(
  value: unknown,
): ResourceResolutionLimitsV7 | undefined {
  if (value === undefined) {
    return normalizeResourceResolutionLimitsV7(undefined);
  }
  const captured = captureExactRecord(
    value,
    LIMIT_KEYS,
    "Resource-resolution limits",
    "/limits",
  );
  if (!captured.ok) return undefined;
  return normalizeResourceResolutionLimitsV7(captured.value);
}

function captureOptions(
  value: unknown,
): CadResult<CapturedSessionOptions> {
  const captured = captureExactRecord(
    value,
    OPTION_KEYS,
    "Resource-resolution session options",
    "",
  );
  if (!captured.ok) return captured;
  const resolver = captured.value.resolver;
  if (resolver !== undefined && typeof resolver !== "function") {
    return invalidInput("Resource resolver must be a function", "/resolver");
  }
  const limits = captureLimits(captured.value.limits);
  if (limits === undefined) {
    return invalidInput(
      "Resource-resolution limits are malformed or unsupported",
      "/limits",
    );
  }
  const signal = captured.value.signal;
  if (signal !== undefined && abortSignalState(signal) === undefined) {
    return invalidInput("signal must be an AbortSignal", "/signal");
  }
  return success(
    intrinsicObjectFreeze({
      resolver:
        resolver === undefined
          ? undefined
          : resolver as ResourceResolverV7,
      limits,
      signal:
        signal === undefined ? undefined : signal as AbortSignal,
    }),
  );
}

function captureScope(
  value: unknown,
  path: string,
): CadResult<CapturedScope> {
  try {
    if (!isPlainRecord(value)) {
      return invalidInput(
        "Document resource scope must be a plain record",
        path,
      );
    }
    const sourceProperty = ownDataProperty(value, "source");
    if (sourceProperty.kind !== "data") {
      return invalidInput(
        "Document resource scope source must be an own data property",
        `${path}/source`,
      );
    }
    const source = sourceProperty.value;
    const allowed =
      source === "root"
        ? ROOT_SCOPE_KEYS
        : source === "external"
          ? EXTERNAL_SCOPE_KEYS
          : undefined;
    if (allowed === undefined) {
      return invalidInput(
        "Document resource scope source must be 'root' or 'external'",
        `${path}/source`,
      );
    }
    const captured = captureExactRecord(
      value,
      allowed,
      "Document resource scope",
      path,
    );
    if (!captured.ok) return captured;
    if (captured.value.source !== source) {
      return invalidInput(
        "Document resource scope changed while it was captured",
        `${path}/source`,
      );
    }
    if (source === "root") {
      const root = intrinsicObjectFreeze({
        source: "root" as const,
      });
      return success(
        intrinsicObjectFreeze({
          value: root,
          key: "root",
          sortKey: "root",
        }),
      );
    }
    const resource = captured.value.resource;
    if (
      typeof resource !== "string" ||
      !intrinsicRegExpTest(RESOURCE_ID_PATTERN, resource)
    ) {
      return invalidInput(
        "External document scope resource must be a valid resource ID",
        `${path}/resource`,
      );
    }
    const digest = captured.value.digest;
    if (
      typeof digest !== "string" ||
      !intrinsicRegExpTest(RESOURCE_DIGEST_PATTERN, digest)
    ) {
      return invalidInput(
        "External document scope digest must be lowercase SHA-256",
        `${path}/digest`,
      );
    }
    const external = intrinsicObjectFreeze({
      source: "external" as const,
      resource: resource as ResourceId,
      digest: digest as ResourceDigestIR,
    });
    const key = `external\u0000${resource}\u0000${digest}`;
    return success(
      intrinsicObjectFreeze({
        value: external,
        key,
        sortKey: key,
      }),
    );
  } catch {
    return invalidInput(
      "Document resource scope could not be read safely",
      path,
    );
  }
}

function captureArrayLength(
  value: unknown,
  label: string,
  path: string,
): CadResult<number> {
  try {
    if (!intrinsicArrayIsArray(value)) {
      return invalidInput(`${label} must be an array`, path);
    }
    const length = ownDataProperty(value, "length");
    if (
      length.kind !== "data" ||
      !intrinsicNumberIsSafeInteger(length.value) ||
      length.value < 0
    ) {
      return invalidInput(`${label} length is invalid`, path);
    }
    return success(length.value);
  } catch {
    return invalidInput(`${label} could not be read safely`, path);
  }
}

function captureIds(
  value: unknown,
  path: string,
  limits: ResourceResolutionLimitsV7,
): CadResult<readonly ResourceId[]> {
  const length = captureArrayLength(
    value,
    "Requested resource IDs",
    path,
  );
  if (!length.ok) return length;
  if (length.value > limits.maxRequestedResourceIds) {
    return limitFailure(
      "maxRequestedResourceIds",
      limits.maxRequestedResourceIds,
      length.value,
    );
  }
  try {
    const output: ResourceId[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const property = ownDataProperty(value as object, String(index));
      if (property.kind !== "data") {
        return invalidInput(
          "Requested resource IDs must be dense own data properties",
          `${path}/${index}`,
        );
      }
      if (
        typeof property.value !== "string" ||
        property.value.length === 0
      ) {
        return invalidInput(
          "Requested resource IDs must be non-empty strings",
          `${path}/${index}`,
        );
      }
      intrinsicArrayAppend(output, property.value as ResourceId);
    }
    return success(intrinsicObjectFreeze(output));
  } catch {
    return invalidInput(
      "Requested resource IDs could not be read safely",
      path,
    );
  }
}

function captureBatchArray(
  value: unknown,
): CadResult<readonly unknown[]> {
  const length = captureArrayLength(
    value,
    "Resource-resolution batches",
    "/batches",
  );
  if (!length.ok) return length;
  try {
    const batches: unknown[] = [];
    for (let index = 0; index < length.value; index += 1) {
      const property = ownDataProperty(value as object, String(index));
      if (property.kind !== "data") {
        return invalidInput(
          "Resource-resolution batches must be dense own data properties",
          `/batches/${index}`,
        );
      }
      intrinsicArrayAppend(batches, property.value);
    }
    return success(intrinsicObjectFreeze(batches));
  } catch {
    return invalidInput(
      "Resource-resolution batches could not be read safely",
      "/batches",
    );
  }
}

function scopedResourceKey(
  scope: CapturedScope,
  id: ResourceId,
): string {
  return `${scope.key.length}:${scope.key}${id.length}:${id}`;
}

function sameLocations(
  first: readonly string[] | undefined,
  second: readonly string[] | undefined,
): boolean {
  if (first === undefined || second === undefined) {
    return first === second;
  }
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

function sameCommitment(
  first: CapturedResourceDefinitionV7,
  second: CapturedResourceDefinitionV7,
): boolean {
  return (
    first.id === second.id &&
    first.digest === second.digest &&
    first.byteLength === second.byteLength &&
    first.mediaType === second.mediaType &&
    sameLocations(first.locations, second.locations)
  );
}

function commitmentConflict(
  resource: PlannedResource,
): CadResult<never> {
  return invalidInput(
    `Scoped resource '${resource.definition.id}' has conflicting commitments`,
    `/resources/${resource.definition.id}`,
  );
}

function plannedCompare(
  first: PlannedResource,
  second: PlannedResource,
): number {
  const scope = lexicalCompare(
    first.scope.sortKey,
    second.scope.sortKey,
  );
  return scope === 0
    ? lexicalCompare(first.definition.id, second.definition.id)
    : scope;
}

function ownedCopy(
  value: Uint8Array,
): OwnedResourceBytes | undefined {
  if (typedArrayByteLengthGetter === undefined) return undefined;
  try {
    const byteLength = reflectApply(
      typedArrayByteLengthGetter,
      value,
      [],
    ) as number;
    const copied = new IntrinsicUint8Array(byteLength);
    reflectApply(typedArraySet, copied, [value]);
    return copied;
  } catch {
    return undefined;
  }
}

function wipeBytes(value: OwnedResourceBytes): void {
  try {
    reflectApply(typedArrayFill, value, [0]);
  } catch {
    // Clearing/disposal is intentionally no-throw and best effort.
  }
}

function definitionRegistry(
  definition: CapturedResourceDefinitionV7,
): Readonly<Record<string, ResourceDefinitionIR>> {
  const capturedDefinition = intrinsicObjectCreateNull();
  capturedDefinition.digest = definition.digest;
  capturedDefinition.byteLength = definition.byteLength;
  capturedDefinition.mediaType = definition.mediaType;
  if (definition.locations !== undefined) {
    capturedDefinition.locations = definition.locations;
  }
  const registry = intrinsicObjectCreateNull();
  registry[definition.id] = intrinsicObjectFreeze(
    capturedDefinition,
  ) as unknown as ResourceDefinitionIR;
  return intrinsicObjectFreeze(
    registry,
  ) as Readonly<Record<string, ResourceDefinitionIR>>;
}

function scopedRequest(
  request: ResourceResolverRequestV7,
  scope: DocumentV7ResourceScope,
): ResourceResolverRequestV7 {
  return intrinsicObjectFreeze({
    id: request.id,
    digest: request.digest,
    byteLength: request.byteLength,
    mediaType: request.mediaType,
    ...(request.locations === undefined
      ? {}
      : { locations: request.locations }),
    ...(request.signal === undefined
      ? {}
      : { signal: request.signal }),
    documentScope: scope,
  });
}

function scopedDiagnostics(
  diagnostics: readonly Diagnostic[],
  scope: DocumentV7ResourceScope,
): CadResult<never> {
  const output: Diagnostic[] = [];
  for (let index = 0; index < diagnostics.length; index += 1) {
    const item = diagnostics[index]!;
    intrinsicArrayAppend(
      output,
      intrinsicObjectFreeze({
        ...item,
        details: intrinsicObjectFreeze({
          ...item.details,
          documentScope: scope,
        }),
      }),
    );
  }
  return {
    ok: false,
    diagnostics: intrinsicObjectFreeze(output),
  };
}

function createScopedView(
  entries: Map<string, CachedResource>,
  scope: CapturedScope,
  ids: readonly ResourceId[],
  isLive: () => boolean,
): ResolvedResourcesV7 {
  const publicIds = intrinsicObjectFreeze(
    (() => {
      const copied: ResourceId[] = [];
      for (let index = 0; index < ids.length; index += 1) {
        intrinsicArrayAppend(copied, ids[index]!);
      }
      return copied;
    })(),
  );
  const cached = (id: ResourceId): CachedResource | undefined => {
    if (!isLive() || typeof id !== "string") return undefined;
    return intrinsicMapGet(entries, scopedResourceKey(scope, id));
  };
  return intrinsicObjectFreeze({
    ids: publicIds,
    has: (id: ResourceId): boolean => cached(id) !== undefined,
    byteLength: (id: ResourceId): number | undefined => {
      const resource = cached(id);
      if (
        resource === undefined ||
        typedArrayByteLengthGetter === undefined
      ) {
        return undefined;
      }
      try {
        return reflectApply(
          typedArrayByteLengthGetter,
          resource.bytes,
          [],
        ) as number;
      } catch {
        return undefined;
      }
    },
    read: (id: ResourceId): Uint8Array | undefined => {
      const resource = cached(id);
      return resource === undefined
        ? undefined
        : ownedCopy(resource.bytes);
    },
  });
}

function lookupScopeKey(value: unknown): string | undefined {
  if (!documentV7RuntimeIntrinsicsAreIntact()) return undefined;
  const captured = captureScope(value, "/scope");
  return captured.ok ? captured.value.key : undefined;
}

function createReader(
  entries: Map<string, CachedResource>,
  orderedKeys: readonly string[],
  isLive: () => boolean,
): ResolvedDocumentResourcesV7 {
  const scopeByKey = new IntrinsicMap<string, CapturedScope>();
  const idsByScope = new IntrinsicMap<string, ResourceId[]>();
  const scopeKeys: string[] = [];
  for (let index = 0; index < orderedKeys.length; index += 1) {
    const entry = intrinsicMapGet(entries, orderedKeys[index]!)!;
    if (!intrinsicMapHas(scopeByKey, entry.scope.key)) {
      intrinsicMapSet(scopeByKey, entry.scope.key, entry.scope);
      intrinsicMapSet(idsByScope, entry.scope.key, []);
      intrinsicArrayAppend(scopeKeys, entry.scope.key);
    }
    intrinsicArrayAppend(
      intrinsicMapGet(idsByScope, entry.scope.key)!,
      entry.definition.id,
    );
  }
  intrinsicArraySort(scopeKeys, lexicalCompare);
  const scopes: DocumentV7ResourceScope[] = [];
  const views = new IntrinsicMap<string, ResolvedResourcesV7>();
  for (let index = 0; index < scopeKeys.length; index += 1) {
    const key = scopeKeys[index]!;
    const scope = intrinsicMapGet(scopeByKey, key)!;
    const ids = intrinsicMapGet(idsByScope, key)!;
    intrinsicArraySort(ids, lexicalCompare);
    intrinsicArrayAppend(scopes, scope.value);
    intrinsicMapSet(
      views,
      key,
      createScopedView(
        entries,
        scope,
        intrinsicObjectFreeze(ids),
        isLive,
      ),
    );
  }
  const publicScopes = intrinsicObjectFreeze(scopes);
  const view = (
    scope: DocumentV7ResourceScope,
  ): ResolvedResourcesV7 | undefined => {
    if (!isLive()) return undefined;
    const key = lookupScopeKey(scope);
    return key === undefined ? undefined : intrinsicMapGet(views, key);
  };
  return intrinsicObjectFreeze({
    scopes: publicScopes,
    has: (
      scope: DocumentV7ResourceScope,
      id: ResourceId,
    ): boolean => view(scope)?.has(id) ?? false,
    byteLength: (
      scope: DocumentV7ResourceScope,
      id: ResourceId,
    ): number | undefined => view(scope)?.byteLength(id),
    read: (
      scope: DocumentV7ResourceScope,
      id: ResourceId,
    ): Uint8Array | undefined => view(scope)?.read(id),
    forScope: view,
  });
}

/**
 * Document-scoped, cumulative v7 resource resolution with one global budget.
 *
 * A call is transactional: every batch and aggregate commitment is preflighted
 * before the first resolver callback, and newly verified bytes are retained
 * only if the complete call succeeds. Calls must not overlap.
 *
 * @internal
 */
export class DocumentV7ResourceResolutionSession {
  readonly #resolver: ResourceResolverV7 | undefined;
  readonly #limits: ResourceResolutionLimitsV7;
  readonly #signal: AbortSignal | undefined;
  #entries = new IntrinsicMap<string, CachedResource>();
  #orderedKeys: readonly string[] = intrinsicObjectFreeze(
    [] as string[],
  );
  #requested = 0;
  #resolved = 0;
  #consumedBytes = 0;
  #generation: object = {};
  #active = false;
  #disposed = false;

  constructor(options: CapturedSessionOptions) {
    this.#resolver = options.resolver;
    this.#limits = options.limits;
    this.#signal = options.signal;
    intrinsicObjectFreeze(this);
  }

  #clearRetained(): void {
    const entries = this.#entries;
    const keys = this.#orderedKeys;
    this.#entries = new IntrinsicMap<string, CachedResource>();
    this.#orderedKeys = intrinsicObjectFreeze([] as string[]);
    this.#requested = 0;
    this.#resolved = 0;
    this.#consumedBytes = 0;
    this.#generation = {};
    for (let index = 0; index < keys.length; index += 1) {
      const entry = intrinsicMapGet(entries, keys[index]!);
      if (entry !== undefined) wipeBytes(entry.bytes);
    }
  }

  #preflight(value: unknown): CadResult<SessionPlan> {
    const batches = captureBatchArray(value);
    if (!batches.ok) return batches;
    const plannedByKey =
      new IntrinsicMap<string, PlannedResource>();
    const planned: PlannedResource[] = [];
    for (
      let batchIndex = 0;
      batchIndex < batches.value.length;
      batchIndex += 1
    ) {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return runtimeIntegrityFailure();
      }
      if (isAborted(this.#signal)) return abortFailure();
      const path = `/batches/${batchIndex}`;
      const batch = captureExactRecord(
        batches.value[batchIndex],
        BATCH_KEYS,
        "Resource-resolution batch",
        path,
      );
      if (!batch.ok) return batch;
      for (let index = 0; index < BATCH_KEYS.length; index += 1) {
        const key = BATCH_KEYS[index]!;
        if (!objectHasOwn(batch.value, key)) {
          return invalidInput(
            `Resource-resolution batch is missing '${key}'`,
            `${path}/${key}`,
          );
        }
      }
      const scope = captureScope(batch.value.scope, `${path}/scope`);
      if (!scope.ok) return scope;
      const ids = captureIds(
        batch.value.ids,
        `${path}/ids`,
        this.#limits,
      );
      if (!ids.ok) return ids;
      const batchPlan = preflightResourceResolutionV7(
        batch.value.definitions as Readonly<
          Record<string, ResourceDefinitionIR>
        >,
        ids.value,
        this.#limits,
        this.#signal,
      );
      if (!batchPlan.ok) return batchPlan;
      for (
        let definitionIndex = 0;
        definitionIndex < batchPlan.value.definitions.length;
        definitionIndex += 1
      ) {
        const definition =
          batchPlan.value.definitions[definitionIndex]!;
        const key = scopedResourceKey(scope.value, definition.id);
        const candidate = intrinsicObjectFreeze({
          key,
          scope: scope.value,
          definition,
        });
        const earlier = intrinsicMapGet(plannedByKey, key);
        if (
          earlier !== undefined &&
          !sameCommitment(earlier.definition, definition)
        ) {
          return commitmentConflict(candidate);
        }
        const cached = intrinsicMapGet(this.#entries, key);
        if (
          cached !== undefined &&
          !sameCommitment(cached.definition, definition)
        ) {
          return commitmentConflict(candidate);
        }
        if (earlier === undefined && cached === undefined) {
          intrinsicMapSet(plannedByKey, key, candidate);
          intrinsicArrayAppend(planned, candidate);
        }
      }
    }

    intrinsicArraySort(planned, plannedCompare);
    const pendingCount = planned.length;
    if (
      pendingCount >
      this.#limits.maxRequestedResourceIds - this.#requested
    ) {
      return limitFailure(
        "maxRequestedResourceIds",
        this.#limits.maxRequestedResourceIds,
        this.#requested + pendingCount,
      );
    }
    if (
      pendingCount >
      this.#limits.maxResolvedResources - this.#resolved
    ) {
      return limitFailure(
        "maxResolvedResources",
        this.#limits.maxResolvedResources,
        this.#resolved + pendingCount,
      );
    }
    let pendingBytes = 0;
    const remainingBytes =
      this.#limits.maxTotalResourceBytes - this.#consumedBytes;
    for (let index = 0; index < planned.length; index += 1) {
      const byteLength = planned[index]!.definition.byteLength;
      if (byteLength > remainingBytes - pendingBytes) {
        return limitFailure(
          "maxTotalResourceBytes",
          this.#limits.maxTotalResourceBytes,
          this.#consumedBytes + pendingBytes + byteLength,
        );
      }
      pendingBytes += byteLength;
    }
    return success(
      intrinsicObjectFreeze({
        pending: intrinsicObjectFreeze(planned),
      }),
    );
  }

  async resolve(
    batches: readonly DocumentV7ResourceResolutionBatch[],
  ): Promise<CadResult<ResolvedDocumentResourcesV7>> {
    if (this.#disposed) {
      return invalidInput(
        "Resource-resolution session has been disposed",
      );
    }
    if (this.#active) {
      return invalidInput(
        "Concurrent resource-resolution session calls are unsupported",
      );
    }
    this.#active = true;
    const generation = this.#generation;
    const temporary: CachedResource[] = [];
    let committed = false;
    try {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return runtimeIntegrityFailure();
      }
      if (isAborted(this.#signal)) return abortFailure();
      const plan = this.#preflight(batches);
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return runtimeIntegrityFailure();
      }
      if (isAborted(this.#signal)) return abortFailure();
      if (!plan.ok) return plan;

      const diagnostics: Diagnostic[] = [];
      for (
        let index = 0;
        index < plan.value.pending.length;
        index += 1
      ) {
        if (this.#generation !== generation || this.#disposed) {
          return invalidInput(
            "Resource-resolution session was invalidated during resolution",
          );
        }
        if (!documentV7RuntimeIntrinsicsAreIntact()) {
          return runtimeIntegrityFailure();
        }
        if (isAborted(this.#signal)) return abortFailure();
        const item = plan.value.pending[index]!;
        const resolver =
          this.#resolver === undefined
            ? undefined
            : (request: ResourceResolverRequestV7) =>
                reflectApply(this.#resolver!, undefined, [
                  scopedRequest(request, item.scope.value),
                ]) as
                  | ArrayBuffer
                  | Uint8Array
                  | PromiseLike<ArrayBuffer | Uint8Array>;
        let resolved: CadResult<ResolvedResourcesV7>;
        try {
          resolved = await resolveResourcesV7(
            definitionRegistry(item.definition),
            intrinsicObjectFreeze([item.definition.id]),
            {
              ...(resolver === undefined ? {} : { resolver }),
              limits: {
                maxRequestedResourceIds: 1,
                maxResolvedResources: 1,
                maxResourceBytes: this.#limits.maxResourceBytes,
                maxTotalResourceBytes: item.definition.byteLength,
              },
              ...(this.#signal === undefined
                ? {}
                : { signal: this.#signal }),
            },
          );
        } catch {
          return sessionFailure(
            `Scoped resource '${item.definition.id}' resolution rejected unexpectedly`,
          );
        }
        if (this.#generation !== generation || this.#disposed) {
          return invalidInput(
            "Resource-resolution session was invalidated during resolution",
          );
        }
        if (!documentV7RuntimeIntrinsicsAreIntact()) {
          return runtimeIntegrityFailure();
        }
        if (isAborted(this.#signal)) return abortFailure();
        if (!resolved.ok) {
          return scopedDiagnostics(
            resolved.diagnostics,
            item.scope.value,
          );
        }
        for (
          let diagnosticIndex = 0;
          diagnosticIndex < resolved.diagnostics.length;
          diagnosticIndex += 1
        ) {
          intrinsicArrayAppend(
            diagnostics,
            resolved.diagnostics[diagnosticIndex]!,
          );
        }
        let read: Uint8Array | undefined;
        try {
          read = resolved.value.read(item.definition.id);
        } catch {
          return sessionFailure(
            `Verified scoped resource '${item.definition.id}' could not be retained`,
          );
        }
        if (read === undefined) {
          return sessionFailure(
            `Verified scoped resource '${item.definition.id}' was missing`,
          );
        }
        const bytes = ownedCopy(read);
        if (bytes === undefined) {
          return sessionFailure(
            `Verified scoped resource '${item.definition.id}' could not be copied`,
          );
        }
        intrinsicArrayAppend(
          temporary,
          intrinsicObjectFreeze({
            key: item.key,
            scope: item.scope,
            definition: item.definition,
            bytes,
          }),
        );
      }

      if (this.#generation !== generation || this.#disposed) {
        return invalidInput(
          "Resource-resolution session was invalidated during resolution",
        );
      }
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        return runtimeIntegrityFailure();
      }
      if (isAborted(this.#signal)) return abortFailure();

      const nextEntries =
        new IntrinsicMap<string, CachedResource>();
      const nextKeys: string[] = [];
      for (
        let index = 0;
        index < this.#orderedKeys.length;
        index += 1
      ) {
        const key = this.#orderedKeys[index]!;
        intrinsicMapSet(
          nextEntries,
          key,
          intrinsicMapGet(this.#entries, key)!,
        );
        intrinsicArrayAppend(nextKeys, key);
      }
      let addedBytes = 0;
      for (let index = 0; index < temporary.length; index += 1) {
        const entry = temporary[index]!;
        intrinsicMapSet(nextEntries, entry.key, entry);
        intrinsicArrayAppend(nextKeys, entry.key);
        addedBytes += entry.definition.byteLength;
      }
      intrinsicArraySort(nextKeys, lexicalCompare);
      const frozenKeys = intrinsicObjectFreeze(nextKeys);
      const reader = createReader(
        nextEntries,
        frozenKeys,
        () =>
          this.#generation === generation &&
          !this.#disposed &&
          documentV7RuntimeIntrinsicsAreIntact(),
      );

      this.#entries = nextEntries;
      this.#orderedKeys = frozenKeys;
      this.#requested += temporary.length;
      this.#resolved += temporary.length;
      this.#consumedBytes += addedBytes;
      committed = true;
      return success(reader, intrinsicObjectFreeze(diagnostics));
    } catch {
      return sessionFailure(
        "Document-scoped resource resolution failed unexpectedly",
      );
    } finally {
      if (!committed) {
        for (let index = 0; index < temporary.length; index += 1) {
          wipeBytes(temporary[index]!.bytes);
        }
      }
      this.#active = false;
    }
  }

  clear(): void {
    try {
      this.#clearRetained();
    } catch {
      // Clearing is deliberately idempotent and no-throw.
    }
  }

  dispose(): void {
    try {
      if (this.#disposed) return;
      this.#disposed = true;
      this.#clearRetained();
    } catch {
      // Disposal is deliberately idempotent and no-throw.
    }
  }
}

/**
 * Creates a validated document-scoped v7 resource session.
 *
 * @internal
 */
export function createDocumentV7ResourceResolutionSession(
  options: DocumentV7ResourceResolutionSessionOptions = {},
): CadResult<DocumentV7ResourceResolutionSession> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  const captured = captureOptions(options);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  if (!captured.ok) return captured;
  if (isAborted(captured.value.signal)) return abortFailure();
  try {
    return success(
      new DocumentV7ResourceResolutionSession(captured.value),
    );
  } catch {
    return sessionFailure(
      "Resource-resolution session could not be created",
    );
  }
}
