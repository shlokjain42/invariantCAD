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

export interface ResourceResolverRequestV7 {
  readonly id: ResourceId;
  readonly digest: ResourceDigestIR;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly locations?: readonly string[];
  readonly signal?: AbortSignal;
}

export type ResourceResolverV7 = (
  request: ResourceResolverRequestV7,
) =>
  | ArrayBuffer
  | Uint8Array
  | PromiseLike<ArrayBuffer | Uint8Array>;

export interface ResourceResolutionLimitsV7 {
  readonly maxResolvedResources: number;
  readonly maxResourceBytes: number;
  readonly maxTotalResourceBytes: number;
}

export const DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7: ResourceResolutionLimitsV7 =
  Object.freeze({
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

interface CapturedResourceDefinition {
  readonly id: ResourceId;
  readonly digest: ResourceDigestIR;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly locations?: readonly string[];
}

interface CapturedResolveOptions {
  readonly resolver?: ResourceResolverV7;
  readonly limits: ResourceResolutionLimitsV7;
  readonly signal?: AbortSignal;
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

const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicMap = Map;
const arrayBufferIsView = ArrayBuffer.isView;
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

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
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
  definition: CapturedResourceDefinition,
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
    const state = Reflect.apply(abortSignalAbortedGetter, value, []);
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
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) snapshot[key] = value[key];
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
  const keys = Object.keys(snapshot);
  if (
    keys.some(
      (key) =>
        !LIMIT_KEYS.includes(key as keyof ResourceResolutionLimitsV7),
    )
  ) {
    return undefined;
  }
  const normalized: Record<keyof ResourceResolutionLimitsV7, number> = {
    ...DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
  };
  for (const key of LIMIT_KEYS) {
    if (!Object.hasOwn(snapshot, key)) continue;
    const candidate = snapshot[key];
    if (
      typeof candidate !== "number" ||
      !Number.isSafeInteger(candidate) ||
      candidate < 0
    ) {
      return undefined;
    }
    normalized[key] = candidate;
  }
  return Object.freeze(normalized);
}

function captureOptions(value: unknown): CadResult<CapturedResolveOptions> {
  const snapshot = snapshotPlainRecord(value);
  if (snapshot === undefined) {
    return invalidInput("Resource-resolution options must be a plain record");
  }
  const unknownKey = Object.keys(snapshot).find(
    (key) => !OPTION_KEYS.includes(key as (typeof OPTION_KEYS)[number]),
  );
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
  return success(
    Object.freeze({
      ...(resolver === undefined
        ? {}
        : { resolver: resolver as ResourceResolverV7 }),
      limits,
      ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
    }),
  );
}

function captureRequestedIds(value: unknown): CadResult<readonly ResourceId[]> {
  try {
    if (!Array.isArray(value)) {
      return invalidInput("Requested resource IDs must be an array");
    }
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0) {
      return invalidInput("Requested resource ID array length is invalid");
    }
    const ids = new Set<ResourceId>();
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        return invalidInput(
          "Requested resource IDs cannot be sparse",
          `/requestedIds/${index}`,
        );
      }
      const id: unknown = value[index];
      if (typeof id !== "string" || id.length === 0) {
        return invalidInput(
          "Requested resource IDs must be non-empty strings",
          `/requestedIds/${index}`,
        );
      }
      ids.add(id as ResourceId);
    }
    return success(Object.freeze([...ids].sort(lexicalCompare)));
  } catch {
    return invalidInput("Requested resource IDs could not be read safely");
  }
}

function captureLocations(
  value: unknown,
  id: ResourceId,
): CadResult<readonly string[] | undefined> {
  if (value === undefined) return success(undefined);
  try {
    if (!Array.isArray(value)) {
      return invalidInput(
        `Resource '${id}' locations must be a non-empty array`,
        `/resources/${id}/locations`,
      );
    }
    const length = value.length;
    if (!Number.isSafeInteger(length) || length <= 0) {
      return invalidInput(
        `Resource '${id}' locations must be a non-empty array`,
        `/resources/${id}/locations`,
      );
    }
    const output: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        return invalidInput(
          `Resource '${id}' locations cannot be sparse`,
          `/resources/${id}/locations/${index}`,
        );
      }
      const location: unknown = value[index];
      if (typeof location !== "string" || location.length === 0) {
        return invalidInput(
          `Resource '${id}' locations must be non-empty strings`,
          `/resources/${id}/locations/${index}`,
        );
      }
      if (seen.has(location)) {
        return invalidInput(
          `Resource '${id}' locations cannot contain duplicates`,
          `/resources/${id}/locations/${index}`,
        );
      }
      seen.add(location);
      output.push(location);
    }
    return success(Object.freeze(output));
  } catch {
    return invalidInput(
      `Resource '${id}' locations could not be read safely`,
      `/resources/${id}/locations`,
    );
  }
}

function captureDefinition(
  id: ResourceId,
  value: unknown,
): CadResult<CapturedResourceDefinition> {
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
    digest = value.digest;
    byteLength = value.byteLength;
    mediaType = value.mediaType;
    rawLocations = value.locations;
  } catch {
    return invalidInput(
      `Resource '${id}' definition could not be read safely`,
      `/resources/${id}`,
    );
  }
  if (
    typeof digest !== "string" ||
    !RESOURCE_DIGEST_PATTERN.test(digest)
  ) {
    return invalidInput(
      `Resource '${id}' digest must be lowercase SHA-256`,
      `/resources/${id}/digest`,
    );
  }
  if (
    typeof byteLength !== "number" ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    return invalidInput(
      `Resource '${id}' byteLength must be a non-negative safe integer`,
      `/resources/${id}/byteLength`,
    );
  }
  if (
    typeof mediaType !== "string" ||
    mediaType.trim() !== mediaType ||
    !RESOURCE_MEDIA_TYPE_PATTERN.test(mediaType)
  ) {
    return invalidInput(
      `Resource '${id}' mediaType must be a non-empty MIME type`,
      `/resources/${id}/mediaType`,
    );
  }
  const locations = captureLocations(rawLocations, id);
  if (!locations.ok) return locations;
  return success(
    Object.freeze({
      id,
      digest: digest as ResourceDigestIR,
      byteLength,
      mediaType,
      ...(locations.value === undefined
        ? {}
        : { locations: locations.value }),
    }),
  );
}

function captureDefinitions(
  definitions: unknown,
  ids: readonly ResourceId[],
): CadResult<readonly CapturedResourceDefinition[]> {
  try {
    if (!isPlainRecord(definitions)) {
      return invalidInput("Resource definitions must be a plain record");
    }
    const captured: CapturedResourceDefinition[] = [];
    for (const id of ids) {
      if (!Object.hasOwn(definitions, id)) {
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
      const definition = captureDefinition(id, definitions[id]);
      if (!definition.ok) return definition;
      captured.push(definition.value);
    }
    return success(Object.freeze(captured));
  } catch {
    return invalidInput("Resource definitions could not be read safely");
  }
}

function preflightDeclaredLimits(
  definitions: readonly CapturedResourceDefinition[],
  limits: ResourceResolutionLimitsV7,
): CadResult<void> {
  if (definitions.length > limits.maxResolvedResources) {
    return limitFailure(
      "maxResolvedResources",
      limits.maxResolvedResources,
      { actual: definitions.length },
    );
  }
  let total = 0;
  for (const definition of definitions) {
    if (definition.byteLength > limits.maxResourceBytes) {
      return limitFailure("maxResourceBytes", limits.maxResourceBytes, {
        resourceId: definition.id,
        actual: definition.byteLength,
      });
    }
    if (definition.byteLength > limits.maxTotalResourceBytes - total) {
      return limitFailure(
        "maxTotalResourceBytes",
        limits.maxTotalResourceBytes,
        {
          resourceId: definition.id,
          consumed: total,
          requested: definition.byteLength,
        },
      );
    }
    total += definition.byteLength;
  }
  return success(undefined);
}

function hasArrayBufferBrand(value: unknown): value is ArrayBuffer {
  if (arrayBufferByteLengthGetter === undefined) return false;
  try {
    Reflect.apply(arrayBufferByteLengthGetter, value, []);
    return true;
  } catch {
    return false;
  }
}

function byteSource(value: unknown): ByteSource | undefined {
  try {
    if (hasArrayBufferBrand(value)) {
      const byteLength = Reflect.apply(
        arrayBufferByteLengthGetter!,
        value,
        [],
      ) as unknown;
      return typeof byteLength === "number" &&
        Number.isSafeInteger(byteLength) &&
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
      !Reflect.apply(arrayBufferIsView, IntrinsicArrayBuffer, [value]) ||
      Reflect.apply(typedArrayTagGetter, value, []) !== "Uint8Array"
    ) {
      return undefined;
    }
    const buffer: unknown = Reflect.apply(
      typedArrayBufferGetter,
      value,
      [],
    );
    // The ArrayBuffer intrinsic rejects SharedArrayBuffer-backed views.
    Reflect.apply(arrayBufferByteLengthGetter, buffer, []);
    const byteLength: unknown = Reflect.apply(
      typedArrayByteLengthGetter,
      value,
      [],
    );
    return typeof byteLength === "number" &&
      Number.isSafeInteger(byteLength) &&
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
    Reflect.apply(typedArraySet, copied, [view]);
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
  const then = Reflect.get(value, "then");
  return typeof then === "function"
    ? Object.freeze({ target: value, then })
    : undefined;
}

class ResourceResolutionAbort {
  readonly name = "ResourceResolutionAbort";
}

function awaitResolverResult(
  pending: CapturedPromiseLike,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
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
        Reflect.apply(eventTargetRemoveEventListener, signal, [
          "abort",
          onAbort,
        ]);
      } catch {
        // Listener cleanup must not replace the selected resolution outcome.
      }
    };
    const settle = (
      callback: (value: unknown) => void,
      value: unknown,
    ): void => {
      if (settled) return;
      settled = true;
      removeListener();
      callback(value);
    };
    const onAbort = (): void => {
      settle(reject, new ResourceResolutionAbort());
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
        Reflect.apply(eventTargetAddEventListener, signal, [
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
      Reflect.apply(pending.then, pending.target, [
        (value: unknown) => settle(resolve, value),
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
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new IntrinsicUint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function createResolvedResources(
  ids: readonly ResourceId[],
  resources: Map<ResourceId, OwnedResourceBytes>,
): ResolvedResourcesV7 {
  const publicIds = Object.freeze(Array.from(ids));
  return Object.freeze({
    ids: publicIds,
    has: (id: ResourceId): boolean =>
      Reflect.apply(mapHas, resources, [id]) as boolean,
    byteLength: (id: ResourceId): number | undefined => {
      const bytes = Reflect.apply(mapGet, resources, [
        id,
      ]) as OwnedResourceBytes | undefined;
      if (bytes === undefined) return undefined;
      return Reflect.apply(
        typedArrayByteLengthGetter!,
        bytes,
        [],
      ) as number;
    },
    read: (id: ResourceId): Uint8Array | undefined => {
      const bytes = Reflect.apply(mapGet, resources, [
        id,
      ]) as OwnedResourceBytes | undefined;
      if (bytes === undefined) return undefined;
      const byteLength = Reflect.apply(
        typedArrayByteLengthGetter!,
        bytes,
        [],
      ) as number;
      const copied = new IntrinsicUint8Array(byteLength);
      Reflect.apply(typedArraySet, copied, [bytes]);
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
  const capturedOptions = captureOptions(options);
  if (!capturedOptions.ok) return capturedOptions;
  if (isAborted(capturedOptions.value.signal)) return abortFailure();

  const capturedIds = captureRequestedIds(requestedIds);
  if (!capturedIds.ok) return capturedIds;
  const capturedDefinitions = captureDefinitions(
    definitions,
    capturedIds.value,
  );
  if (!capturedDefinitions.ok) return capturedDefinitions;
  const preflight = preflightDeclaredLimits(
    capturedDefinitions.value,
    capturedOptions.value.limits,
  );
  if (!preflight.ok) return preflight;

  if (capturedDefinitions.value.length === 0) {
    return success(
      createResolvedResources(capturedIds.value, new IntrinsicMap()),
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
            resources: capturedIds.value.length,
          },
        },
      ),
    );
  }

  const resolved = new IntrinsicMap<ResourceId, OwnedResourceBytes>();
  let consumedBytes = 0;
  for (const definition of capturedDefinitions.value) {
    if (isAborted(capturedOptions.value.signal)) return abortFailure();
    const request = Object.freeze({
      id: definition.id,
      digest: definition.digest,
      byteLength: definition.byteLength,
      mediaType: definition.mediaType,
      ...(definition.locations === undefined
        ? {}
        : { locations: Object.freeze(Array.from(definition.locations)) }),
      ...(capturedOptions.value.signal === undefined
        ? {}
        : { signal: capturedOptions.value.signal }),
    }) as ResourceResolverRequestV7;

    let returned: unknown;
    try {
      const candidate: unknown = Reflect.apply(resolver, undefined, [request]);
      if (byteSource(candidate) !== undefined) {
        returned = candidate;
      } else {
        const pending = capturePromiseLike(candidate);
        if (pending === undefined) {
          return resolutionFailure(
            definition.id,
            `Resolver returned unsupported bytes for resource '${definition.id}'`,
          );
        }
        returned = await awaitResolverResult(
          pending,
          capturedOptions.value.signal,
        );
      }
    } catch (error) {
      if (
        error instanceof ResourceResolutionAbort ||
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
    consumedBytes += copied.byteLength;

    let digest: ResourceDigestIR;
    try {
      digest = await sha256Digest(copied);
    } catch {
      return resolutionFailure(
        definition.id,
        `Resource '${definition.id}' could not be hashed`,
      );
    }
    if (isAborted(capturedOptions.value.signal)) return abortFailure();
    if (digest !== definition.digest) {
      return integrityFailure(
        definition,
        `Resource '${definition.id}' digest does not match its commitment`,
        { expectedDigest: definition.digest },
      );
    }
    Reflect.apply(mapSet, resolved, [definition.id, copied]);
  }

  return success(createResolvedResources(capturedIds.value, resolved));
}
