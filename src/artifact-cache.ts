import { type Brand } from "./core/ids.js";
import {
  canonicalStringifyProtocol as canonicalStringify,
  deepFreeze,
} from "./core/json.js";
import { isCanonicalUtf8StringWithin } from "./core/utf8.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
} from "./core/result.js";
import {
  FEATURE_HASH_ALGORITHM,
  FEATURE_HASH_PREFIX,
  FEATURE_HASH_PROTOCOL_VERSION,
  type DesignFeatureHashEntry,
} from "./feature-hashes.js";
import {
  KERNEL_SHAPE_ARTIFACT_MAX_COMPATIBILITY_FINGERPRINT_BYTES,
  KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
  type Awaitable,
  type GeometryKernel,
  type KernelShapeArtifactCapabilities,
} from "./kernel.js";
import { registerArtifactCacheSessionInternalAccess } from "./internal/artifact-cache-session-access.js";
import type { SketchSolverBackend } from "./solver.js";

export const ARTIFACT_CACHE_PROTOCOL_VERSION = 1 as const;
export const ARTIFACT_CACHE_NAMESPACE = "invariantcad.kernel-shape" as const;
export const ARTIFACT_CACHE_KEY_PREFIX =
  "invariantcad:kernel-shape:v1:sha256:" as const;
export const ARTIFACT_CACHE_INTEGRITY_ALGORITHM = "sha256" as const;
export const ARTIFACT_EVALUATION_SEMANTICS_VERSION = 1 as const;
export const ARTIFACT_CACHE_MAX_KEY_MATERIAL_BYTES = 16_384 as const;

export type ArtifactCacheKey = Brand<string, "ArtifactCacheKey">;

export interface ArtifactFeatureHashV1 {
  readonly protocolVersion: typeof FEATURE_HASH_PROTOCOL_VERSION;
  readonly algorithm: typeof FEATURE_HASH_ALGORITHM;
  readonly digest: string;
}

export interface ArtifactCacheKeyMaterialV1 {
  readonly namespace: typeof ARTIFACT_CACHE_NAMESPACE;
  readonly protocolVersion: typeof ARTIFACT_CACHE_PROTOCOL_VERSION;
  readonly kind: "solid";
  readonly node: string;
  readonly featureHash: ArtifactFeatureHashV1;
  readonly evaluation: {
    readonly semanticsVersion: typeof ARTIFACT_EVALUATION_SEMANTICS_VERSION;
  };
  readonly kernel: {
    readonly id: string;
    readonly artifact: KernelShapeArtifactCapabilities;
  };
  readonly sketchSolver: {
    readonly id: string;
    readonly compatibilityFingerprint: string;
  };
}

export interface KernelShapeArtifactCacheKey {
  readonly key: ArtifactCacheKey;
  readonly material: ArtifactCacheKeyMaterialV1;
}

/** The report-owned identity required to derive one solid artifact key. */
export type ArtifactCacheFeature = Pick<
  DesignFeatureHashEntry,
  "node" | "outputKind" | "hash"
>;

export interface ArtifactCacheIntegrityV1 {
  readonly algorithm: typeof ARTIFACT_CACHE_INTEGRITY_ALGORITHM;
  readonly digest: string;
  readonly byteLength: number;
}

export interface ArtifactCacheRecordV1 {
  readonly protocolVersion: typeof ARTIFACT_CACHE_PROTOCOL_VERSION;
  readonly key: ArtifactCacheKey;
  readonly metadata: ArtifactCacheKeyMaterialV1;
  /** A detached byte snapshot. Consumers must not retain or mutate it in place. */
  readonly payload: Uint8Array;
  readonly integrity: ArtifactCacheIntegrityV1;
}

export interface ArtifactCacheLimits {
  readonly maxOperations: number;
  readonly maxEntryBytes: number;
  readonly maxTotalReadBytes: number;
  readonly maxTotalWriteBytes: number;
}

export const DEFAULT_ARTIFACT_CACHE_LIMITS: ArtifactCacheLimits = Object.freeze({
  maxOperations: 100_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalReadBytes: 256 * 1024 * 1024,
  maxTotalWriteBytes: 256 * 1024 * 1024,
});

export interface ArtifactCacheStoreContext {
  readonly signal?: AbortSignal;
  /** The store must enforce this before materializing a larger entry. */
  readonly maxBytes: number;
}

export interface ArtifactCacheDeleteContext {
  readonly signal?: AbortSignal;
}

/** Raw, untrusted store output. Core validation owns the record boundary. */
export type ArtifactCacheStoreValue = unknown;

export interface ArtifactCacheStore {
  /**
   * Return `undefined` for a miss. If known metadata proves the entry exceeds
   * `context.maxBytes`, throw `ArtifactCacheStoreLimitError` before payload
   * materialization so the caller can preserve a structured limit diagnostic.
   */
  read(
    key: ArtifactCacheKey,
    context: ArtifactCacheStoreContext,
  ): ArtifactCacheStoreValue | PromiseLike<ArtifactCacheStoreValue>;
  /**
   * Publishes either one complete record or nothing. A store-side byte refusal
   * must use `ArtifactCacheStoreLimitError`.
   */
  write(
    record: ArtifactCacheRecordV1,
    context: ArtifactCacheStoreContext,
  ): void | PromiseLike<void>;
  delete(
    key: ArtifactCacheKey,
    context: ArtifactCacheDeleteContext,
  ): void | PromiseLike<void>;
}

export type ArtifactCacheMode = "read-write" | "read-only" | "write-only";

export type ArtifactCacheEvent =
  | {
      readonly kind: "hit" | "miss" | "write" | "delete";
      readonly node: string;
      readonly key: ArtifactCacheKey;
    }
  | {
      readonly kind: "bypass" | "invalid" | "error" | "limit";
      readonly node: string;
      readonly operation: "read" | "write" | "delete" | "decode" | "encode";
      readonly reason: string;
      readonly key?: ArtifactCacheKey;
    };

export interface ArtifactCacheOptions {
  readonly store: ArtifactCacheStore;
  readonly mode?: ArtifactCacheMode;
  readonly limits?: Partial<ArtifactCacheLimits>;
  readonly onEvent?: (event: ArtifactCacheEvent) => void | PromiseLike<void>;
}

export interface ArtifactCacheSessionUsage {
  readonly operations: number;
  readonly readBytes: number;
  readonly writeBytes: number;
}

export interface ArtifactCacheSessionOperationOptions {
  readonly signal?: AbortSignal;
}

export type KernelShapeArtifactSupportInspection =
  | { readonly status: "absent" }
  | {
      readonly status: "malformed";
      readonly reason: string;
      readonly message: string;
    }
  | {
      readonly status: "supported";
      readonly capabilities: KernelShapeArtifactCapabilities;
    };

export type ArtifactCacheReadResult =
  | { readonly status: "miss" }
  | { readonly status: "hit"; readonly record: ArtifactCacheRecordV1 };

const LIMIT_KEYS = Object.freeze(
  Object.keys(DEFAULT_ARTIFACT_CACHE_LIMITS) as readonly (
    keyof ArtifactCacheLimits
  )[],
);
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const ARTIFACT_CACHE_MAX_RECORD_FIELDS = 8;
const ARTIFACT_CACHE_MAX_NODE_ID_BYTES = 1_024;
export const ARTIFACT_CACHE_MAX_IDENTITY_BYTES = 256 as const;
export const ARTIFACT_CACHE_MAX_SOLVER_FINGERPRINT_BYTES = 2_048 as const;

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

function snapshotPlainRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (!isPlainRecord(value)) return undefined;
    const keys = Object.keys(value);
    if (keys.length > ARTIFACT_CACHE_MAX_RECORD_FIELDS) return undefined;
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) output[key] = value[key];
    return output;
  } catch {
    return undefined;
  }
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort(lexicalCompare);
  const sortedExpected = [...expected].sort(lexicalCompare);
  return (
    keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
  );
}

function normalizeArtifactCapabilities(
  value: unknown,
): KernelShapeArtifactCapabilities | undefined {
  const captured = snapshotPlainRecord(value);
  if (captured === undefined) return undefined;
  if (
    !exactKeys(captured, [
      "protocolVersion",
      "format",
      "formatVersion",
      "compatibilityFingerprint",
    ]) ||
    captured.protocolVersion !== KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION ||
    !isCanonicalUtf8StringWithin(
      captured.format,
      ARTIFACT_CACHE_MAX_IDENTITY_BYTES,
    ) ||
    typeof captured.formatVersion !== "number" ||
    !Number.isSafeInteger(captured.formatVersion) ||
    captured.formatVersion < 1 ||
    !isCanonicalUtf8StringWithin(
      captured.compatibilityFingerprint,
      KERNEL_SHAPE_ARTIFACT_MAX_COMPATIBILITY_FINGERPRINT_BYTES,
    )
  ) {
    return undefined;
  }
  return Object.freeze({
    protocolVersion: KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
    format: captured.format,
    formatVersion: captured.formatVersion,
    compatibilityFingerprint: captured.compatibilityFingerprint,
  });
}

export function inspectKernelShapeArtifactSupport(
  kernel: GeometryKernel,
): KernelShapeArtifactSupportInspection {
  try {
    const descriptor: unknown = kernel.capabilities.shapeArtifacts;
    const hasEncoder = typeof kernel.encodeShapeArtifact === "function";
    const hasDecoder = typeof kernel.decodeShapeArtifact === "function";
    if (descriptor === undefined && !hasEncoder && !hasDecoder) {
      return Object.freeze({ status: "absent" });
    }
    if (descriptor === undefined || !hasEncoder || !hasDecoder) {
      return Object.freeze({
        status: "malformed",
        reason: "incomplete-declaration",
        message:
          "Kernel shape-artifact capability and encode/decode methods must be declared together",
      });
    }
    const capabilities = normalizeArtifactCapabilities(descriptor);
    if (capabilities === undefined) {
      return Object.freeze({
        status: "malformed",
        reason: "invalid-capabilities",
        message: "Kernel shape-artifact capability metadata is malformed",
      });
    }
    return Object.freeze({ status: "supported", capabilities });
  } catch (error) {
    return Object.freeze({
      status: "malformed",
      reason: "inspection-failed",
      message: safeErrorMessage(
        error,
        "Kernel shape-artifact support could not be inspected safely",
      ),
    });
  }
}

export function normalizeArtifactCacheLimits(
  value: unknown,
): ArtifactCacheLimits | undefined {
  if (value === undefined) return DEFAULT_ARTIFACT_CACHE_LIMITS;
  try {
    const captured = snapshotPlainRecord(value);
    if (captured === undefined) return undefined;
    const keys = Object.keys(captured);
    if (keys.some((key) => !LIMIT_KEYS.includes(key as keyof ArtifactCacheLimits))) {
      return undefined;
    }
    const normalized: Record<keyof ArtifactCacheLimits, number> = {
      ...DEFAULT_ARTIFACT_CACHE_LIMITS,
    };
    for (const key of LIMIT_KEYS) {
      if (!Object.hasOwn(captured, key)) continue;
      const candidate = captured[key];
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
  } catch {
    return undefined;
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function featureDigest(value: string): string | undefined {
  if (
    value.length !== FEATURE_HASH_PREFIX.length + 64 ||
    !value.startsWith(FEATURE_HASH_PREFIX)
  ) return undefined;
  const digest = value.slice(FEATURE_HASH_PREFIX.length);
  return HEX_DIGEST.test(digest) ? digest : undefined;
}

function artifactCacheKeyBytes(
  material: ArtifactCacheKeyMaterialV1,
): Uint8Array | undefined {
  if (
    !isCanonicalUtf8StringWithin(
      material.node,
      ARTIFACT_CACHE_MAX_NODE_ID_BYTES,
    )
  ) return undefined;
  const canonical = canonicalStringify({
    domain: ARTIFACT_CACHE_NAMESPACE,
    material,
  });
  if (canonical.length > ARTIFACT_CACHE_MAX_KEY_MATERIAL_BYTES) {
    return undefined;
  }
  const bytes = new TextEncoder().encode(canonical);
  return bytes.byteLength <= ARTIFACT_CACHE_MAX_KEY_MATERIAL_BYTES
    ? bytes
    : undefined;
}

async function deriveArtifactCacheKey(
  material: ArtifactCacheKeyMaterialV1,
): Promise<ArtifactCacheKey | undefined> {
  const bytes = artifactCacheKeyBytes(material);
  if (bytes === undefined) return undefined;
  return `${ARTIFACT_CACHE_KEY_PREFIX}${await sha256(bytes)}` as ArtifactCacheKey;
}

interface CapturedArtifactCacheFeature {
  readonly node: string;
  readonly hash: string;
}

function captureArtifactCacheFeature(
  feature: ArtifactCacheFeature,
): CapturedArtifactCacheFeature | undefined {
  const captured = snapshotPlainRecord(feature);
  return captured !== undefined &&
      isCanonicalUtf8StringWithin(
        captured.node,
        ARTIFACT_CACHE_MAX_NODE_ID_BYTES,
      ) &&
      captured.outputKind === "solid" &&
      typeof captured.hash === "string"
    ? Object.freeze({ node: captured.node, hash: captured.hash })
    : undefined;
}

async function createArtifactCacheKeyForIdentity(
  feature: CapturedArtifactCacheFeature,
  kernelId: unknown,
  artifact: KernelShapeArtifactCapabilities,
  sketchSolver: SketchSolverBackend,
): Promise<CadResult<KernelShapeArtifactCacheKey>> {
  const node = feature.node;
  const digest = featureDigest(feature.hash);
  if (digest === undefined) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_ENTRY_INVALID",
        "Feature hash is not a tagged feature-hash protocol-v1 SHA-256 digest",
        { severity: "error", node },
      ),
    );
  }
  if (
    !isCanonicalUtf8StringWithin(
      kernelId,
      ARTIFACT_CACHE_MAX_IDENTITY_BYTES,
    )
  ) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_ENTRY_INVALID",
        "Kernel ID is missing or too long for an artifact cache key",
        { severity: "error", node },
      ),
    );
  }
  const sketchSolverId: unknown = sketchSolver.id;
  const sketchSolverFingerprint: unknown =
    sketchSolver.artifactCompatibilityFingerprint;
  if (
    !isCanonicalUtf8StringWithin(
      sketchSolverId,
      ARTIFACT_CACHE_MAX_IDENTITY_BYTES,
    ) ||
    !isCanonicalUtf8StringWithin(
      sketchSolverFingerprint,
      ARTIFACT_CACHE_MAX_SOLVER_FINGERPRINT_BYTES,
    )
  ) {
    return failure(
      diagnostic(
        "KERNEL_CAPABILITY_MISSING",
        `Sketch solver '${String(sketchSolverId)}' does not declare artifact compatibility`,
        {
          severity: "error",
          node,
          details: {
            sketchSolver: sketchSolverId,
            capability: "artifactCompatibilityFingerprint",
          },
        },
      ),
    );
  }
  const material = deepFreeze({
    namespace: ARTIFACT_CACHE_NAMESPACE,
    protocolVersion: ARTIFACT_CACHE_PROTOCOL_VERSION,
    kind: "solid",
    node,
    featureHash: {
      protocolVersion: FEATURE_HASH_PROTOCOL_VERSION,
      algorithm: FEATURE_HASH_ALGORITHM,
      digest,
    },
    evaluation: {
      semanticsVersion: ARTIFACT_EVALUATION_SEMANTICS_VERSION,
    },
    kernel: {
      id: kernelId,
      artifact,
    },
    sketchSolver: {
      id: sketchSolverId,
      compatibilityFingerprint: sketchSolverFingerprint,
    },
  }) as ArtifactCacheKeyMaterialV1;
  const key = await deriveArtifactCacheKey(material);
  if (key === undefined) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_ENTRY_INVALID",
        `Artifact cache key material exceeds ${ARTIFACT_CACHE_MAX_KEY_MATERIAL_BYTES} UTF-8 bytes`,
        { severity: "error", node },
      ),
    );
  }
  return success(deepFreeze({ key, material }) as KernelShapeArtifactCacheKey);
}

/**
 * Builds a cache key only for a kernel/solver pair that explicitly advertises
 * exact artifact compatibility. The topology-signature fingerprint is never
 * substituted for this stronger identity.
 */
export async function createKernelShapeArtifactCacheKey(
  feature: ArtifactCacheFeature,
  kernel: GeometryKernel,
  sketchSolver: SketchSolverBackend,
): Promise<CadResult<KernelShapeArtifactCacheKey>> {
  let node: string | undefined;
  try {
    const capturedFeature = captureArtifactCacheFeature(feature);
    if (capturedFeature === undefined) {
      return failure(
        diagnostic(
          "ARTIFACT_CACHE_ENTRY_INVALID",
          "Artifact cache keys require one solid feature-hash report entry",
          { severity: "error" },
        ),
      );
    }
    node = capturedFeature.node;
    const kernelId: unknown = kernel.id;
    const support = inspectKernelShapeArtifactSupport(kernel);
    if (support.status === "absent") {
      return failure(
        diagnostic(
          "KERNEL_CAPABILITY_MISSING",
          `Kernel '${String(kernelId)}' does not support shape artifacts`,
          {
            severity: "error",
            node,
            details: { kernel: kernelId, capability: "shapeArtifacts" },
          },
        ),
      );
    }
    if (support.status === "malformed") {
      return failure(
        diagnostic("ARTIFACT_CACHE_ENTRY_INVALID", support.message, {
          severity: "error",
          node,
          details: {
            kernel: kernelId,
            reason: support.reason,
          },
        }),
      );
    }
    return await createArtifactCacheKeyForIdentity(
      capturedFeature,
      kernelId,
      support.capabilities,
      sketchSolver,
    );
  } catch (error) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_OPERATION_FAILED",
        safeErrorMessage(error, "Artifact cache key creation failed"),
        {
          severity: "error",
          ...(node === undefined ? {} : { node }),
        },
      ),
    );
  }
}

/**
 * Package-private candidate key path. It never inspects or changes the
 * production kernel capability surface and is intentionally not root-exported.
 */
export async function createKernelShapeArtifactCacheKeyForCandidate(
  feature: ArtifactCacheFeature,
  kernelId: unknown,
  artifactCapabilities: unknown,
  sketchSolver: SketchSolverBackend,
): Promise<CadResult<KernelShapeArtifactCacheKey>> {
  let node: string | undefined;
  try {
    const capturedFeature = captureArtifactCacheFeature(feature);
    if (capturedFeature === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache keys require one solid feature-hash report entry",
      );
    }
    node = capturedFeature.node;
    const artifact = normalizeArtifactCapabilities(artifactCapabilities);
    if (artifact === undefined) {
      return invalidArtifactEntryFailure(
        "Candidate shape-artifact capability metadata is malformed",
      );
    }
    return await createArtifactCacheKeyForIdentity(
      capturedFeature,
      kernelId,
      artifact,
      sketchSolver,
    );
  } catch (error) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_OPERATION_FAILED",
        safeErrorMessage(error, "Artifact cache candidate key creation failed"),
        {
          severity: "error",
          ...(node === undefined ? {} : { node }),
        },
      ),
    );
  }
}

function limitsOrFailure(
  value: unknown,
): CadResult<ArtifactCacheLimits> {
  const limits = normalizeArtifactCacheLimits(value);
  return limits === undefined
    ? failure(
        diagnostic(
          "ARTIFACT_CACHE_LIMIT_EXCEEDED",
          "Artifact-cache limits are malformed or unsupported",
          { severity: "error" },
        ),
      )
    : success(limits);
}

function cacheLimitFailure<T = never>(
  resource: keyof ArtifactCacheLimits | "maxBytes",
  limit: number,
  actual: number,
  key?: KernelShapeArtifactCacheKey,
): CadResult<T> {
  return failure(
    diagnostic(
      "ARTIFACT_CACHE_LIMIT_EXCEEDED",
      `Artifact-cache ${resource} limit ${limit} was exceeded by ${actual}`,
      {
        severity: "error",
        ...(key === undefined ? {} : { node: key.material.node }),
        details: {
          resource,
          limit,
          actual,
          ...(key === undefined ? {} : { key: key.key }),
        },
      },
    ),
  );
}

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

function exactUint8ArrayByteLength(value: unknown): number | undefined {
  if (
    TYPED_ARRAY_TAG_GETTER === undefined ||
    TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined ||
    TYPED_ARRAY_BUFFER_GETTER === undefined ||
    ARRAY_BUFFER_BYTE_LENGTH_GETTER === undefined
  ) return undefined;
  try {
    if (!ArrayBuffer.isView(value)) return undefined;
    if (Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) !== "Uint8Array") {
      return undefined;
    }
    const buffer: unknown = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []);
    // Applying the ArrayBuffer intrinsic rejects SharedArrayBuffer-backed views.
    Reflect.apply(ARRAY_BUFFER_BYTE_LENGTH_GETTER, buffer, []);
    const byteLength: unknown = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    );
    return typeof byteLength === "number" &&
      Number.isSafeInteger(byteLength) &&
      byteLength >= 0
      ? byteLength
      : undefined;
  } catch {
    return undefined;
  }
}

function copyExactUint8Array(
  value: unknown,
  byteLength: number,
): Uint8Array | undefined {
  try {
    const copied = new Uint8Array(byteLength);
    Reflect.apply(Uint8Array.prototype.set, copied, [value]);
    return copied;
  } catch {
    return undefined;
  }
}

interface PayloadLimit {
  readonly resource: keyof ArtifactCacheLimits;
  readonly limit: number;
  readonly aggregate?: {
    readonly configuredLimit: number;
    readonly consumed: number;
  };
}

function stricterPayloadLimit(
  first: PayloadLimit,
  second: PayloadLimit,
): PayloadLimit {
  return second.limit < first.limit ? second : first;
}

function payloadLimitFailure<T = never>(
  payloadLimit: PayloadLimit,
  actualBytes: number,
  key?: KernelShapeArtifactCacheKey,
): CadResult<T> {
  return cacheLimitFailure(
    payloadLimit.resource,
    payloadLimit.aggregate?.configuredLimit ?? payloadLimit.limit,
    (payloadLimit.aggregate?.consumed ?? 0) + actualBytes,
    key,
  );
}

function immutableRecord(
  key: KernelShapeArtifactCacheKey,
  payload: Uint8Array,
  digest: string,
): ArtifactCacheRecordV1 {
  return Object.freeze({
    protocolVersion: ARTIFACT_CACHE_PROTOCOL_VERSION,
    key: key.key,
    metadata: key.material,
    payload,
    integrity: Object.freeze({
      algorithm: ARTIFACT_CACHE_INTEGRITY_ALGORITHM,
      digest,
      byteLength: payload.byteLength,
    }),
  });
}

export async function createArtifactCacheRecord(
  key: KernelShapeArtifactCacheKey,
  payload: Uint8Array,
  limits?: Partial<ArtifactCacheLimits>,
): Promise<CadResult<ArtifactCacheRecordV1>> {
  const normalizedLimits = limitsOrFailure(limits);
  if (!normalizedLimits.ok) return normalizedLimits;
  const payloadLimit = stricterPayloadLimit(
    {
      resource: "maxEntryBytes",
      limit: normalizedLimits.value.maxEntryBytes,
    },
    {
      resource: "maxTotalWriteBytes",
      limit: normalizedLimits.value.maxTotalWriteBytes,
    },
  );
  const byteLength = exactUint8ArrayByteLength(payload);
  if (byteLength === undefined) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_ENTRY_INVALID",
        "Kernel shape artifact payload must be an exact, non-shared Uint8Array",
        { severity: "error" },
      ),
    );
  }
  if (byteLength > payloadLimit.limit) {
    return payloadLimitFailure(payloadLimit, byteLength);
  }
  const copied = copyExactUint8Array(payload, byteLength);
  if (copied === undefined) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_ENTRY_INVALID",
        "Kernel shape artifact payload could not be snapshotted safely",
        { severity: "error" },
      ),
    );
  }
  // The payload snapshot must precede the first await. A caller can mutate its
  // source as soon as this async function returns its promise.
  const normalizedKey = await normalizeArtifactCacheKey(key);
  if (normalizedKey === undefined) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_ENTRY_INVALID",
        "Artifact cache key does not match its canonical metadata",
        { severity: "error" },
      ),
    );
  }
  try {
    return success(immutableRecord(normalizedKey, copied, await sha256(copied)));
  } catch (error) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_OPERATION_FAILED",
        safeErrorMessage(error, "Artifact payload integrity hashing failed"),
        { severity: "error", node: normalizedKey.material.node },
      ),
    );
  }
}

function normalizedMetadata(
  value: unknown,
): ArtifactCacheKeyMaterialV1 | undefined {
  const captured = snapshotPlainRecord(value);
  if (captured === undefined || !exactKeys(captured, [
    "namespace",
    "protocolVersion",
    "kind",
    "node",
    "featureHash",
    "evaluation",
    "kernel",
    "sketchSolver",
  ])) return undefined;
  if (
    captured.namespace !== ARTIFACT_CACHE_NAMESPACE ||
    captured.protocolVersion !== ARTIFACT_CACHE_PROTOCOL_VERSION ||
    captured.kind !== "solid" ||
    !isCanonicalUtf8StringWithin(
      captured.node,
      ARTIFACT_CACHE_MAX_NODE_ID_BYTES,
    )
  ) return undefined;
  const featureHash = snapshotPlainRecord(captured.featureHash);
  if (
    featureHash === undefined ||
    !exactKeys(featureHash, ["protocolVersion", "algorithm", "digest"]) ||
    featureHash.protocolVersion !== FEATURE_HASH_PROTOCOL_VERSION ||
    featureHash.algorithm !== FEATURE_HASH_ALGORITHM ||
    typeof featureHash.digest !== "string" ||
    featureHash.digest.length !== 64 ||
    !HEX_DIGEST.test(featureHash.digest)
  ) return undefined;
  const evaluation = snapshotPlainRecord(captured.evaluation);
  if (
    evaluation === undefined ||
    !exactKeys(evaluation, ["semanticsVersion"]) ||
    evaluation.semanticsVersion !== ARTIFACT_EVALUATION_SEMANTICS_VERSION
  ) return undefined;
  const kernel = snapshotPlainRecord(captured.kernel);
  if (
    kernel === undefined ||
    !exactKeys(kernel, ["id", "artifact"]) ||
    !isCanonicalUtf8StringWithin(
      kernel.id,
      ARTIFACT_CACHE_MAX_IDENTITY_BYTES,
    )
  ) return undefined;
  const artifact = normalizeArtifactCapabilities(kernel.artifact);
  if (artifact === undefined) return undefined;
  const sketchSolver = snapshotPlainRecord(captured.sketchSolver);
  if (
    sketchSolver === undefined ||
    !exactKeys(sketchSolver, ["id", "compatibilityFingerprint"]) ||
    !isCanonicalUtf8StringWithin(
      sketchSolver.id,
      ARTIFACT_CACHE_MAX_IDENTITY_BYTES,
    ) ||
    !isCanonicalUtf8StringWithin(
      sketchSolver.compatibilityFingerprint,
      ARTIFACT_CACHE_MAX_SOLVER_FINGERPRINT_BYTES,
    )
  ) return undefined;
  const material = deepFreeze({
    namespace: ARTIFACT_CACHE_NAMESPACE,
    protocolVersion: ARTIFACT_CACHE_PROTOCOL_VERSION,
    kind: "solid",
    node: captured.node,
    featureHash: {
      protocolVersion: FEATURE_HASH_PROTOCOL_VERSION,
      algorithm: FEATURE_HASH_ALGORITHM,
      digest: featureHash.digest,
    },
    evaluation: {
      semanticsVersion: ARTIFACT_EVALUATION_SEMANTICS_VERSION,
    },
    kernel: { id: kernel.id, artifact },
    sketchSolver: {
      id: sketchSolver.id,
      compatibilityFingerprint: sketchSolver.compatibilityFingerprint,
    },
  }) as ArtifactCacheKeyMaterialV1;
  return artifactCacheKeyBytes(material) === undefined ? undefined : material;
}

function validArtifactCacheKey(value: unknown): value is ArtifactCacheKey {
  return typeof value === "string" &&
    value.length === ARTIFACT_CACHE_KEY_PREFIX.length + 64 &&
    value.startsWith(ARTIFACT_CACHE_KEY_PREFIX) &&
    HEX_DIGEST.test(value.slice(ARTIFACT_CACHE_KEY_PREFIX.length));
}

async function normalizeArtifactCacheKey(
  value: unknown,
): Promise<KernelShapeArtifactCacheKey | undefined> {
  try {
    const captured = snapshotPlainRecord(value);
    if (
      captured === undefined ||
      !exactKeys(captured, ["key", "material"]) ||
      !validArtifactCacheKey(captured.key)
    ) return undefined;
    const material = normalizedMetadata(captured.material);
    if (material === undefined) return undefined;
    const derivedKey = await deriveArtifactCacheKey(material);
    if (derivedKey === undefined || captured.key !== derivedKey) return undefined;
    return deepFreeze({ key: derivedKey, material }) as KernelShapeArtifactCacheKey;
  } catch {
    return undefined;
  }
}

type CapturedArtifactCacheRecord = Readonly<{
  protocolVersion: unknown;
  key: unknown;
  metadata: unknown;
  payload: unknown;
  integrity: unknown;
}>;

function captureArtifactCacheRecord(
  value: unknown,
): CapturedArtifactCacheRecord | undefined {
  const captured = snapshotPlainRecord(value);
  if (
    captured === undefined ||
    !exactKeys(captured, [
      "protocolVersion",
      "key",
      "metadata",
      "payload",
      "integrity",
    ])
  ) return undefined;
  return captured as CapturedArtifactCacheRecord;
}

function invalidArtifactEntryFailure<T = never>(
  message: string,
  key?: KernelShapeArtifactCacheKey,
): CadResult<T> {
  return failure(
    diagnostic("ARTIFACT_CACHE_ENTRY_INVALID", message, {
      severity: "error",
      ...(key === undefined ? {} : { node: key.material.node }),
      ...(key === undefined ? {} : { details: { key: key.key } }),
    }),
  );
}

async function keyFromCapturedArtifactCacheRecord(
  captured: CapturedArtifactCacheRecord,
): Promise<KernelShapeArtifactCacheKey | undefined> {
  try {
    if (
      captured.protocolVersion !== ARTIFACT_CACHE_PROTOCOL_VERSION ||
      !validArtifactCacheKey(captured.key)
    ) return undefined;
    const material = normalizedMetadata(captured.metadata);
    if (material === undefined) return undefined;
    const derivedKey = await deriveArtifactCacheKey(material);
    if (derivedKey === undefined || captured.key !== derivedKey) return undefined;
    return deepFreeze({ key: derivedKey, material }) as KernelShapeArtifactCacheKey;
  } catch {
    return undefined;
  }
}

async function validateCapturedArtifactCacheRecord(
  expected: KernelShapeArtifactCacheKey,
  captured: CapturedArtifactCacheRecord,
  payloadLimit: PayloadLimit,
  beforePayloadCopy?: (byteLength: number) => CadResult<void>,
): Promise<CadResult<ArtifactCacheRecordV1>> {
  try {
    const byteLength = exactUint8ArrayByteLength(captured.payload);
    if (byteLength === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache payload is not an exact Uint8Array",
        expected,
      );
    }
    if (byteLength > payloadLimit.limit) {
      return payloadLimitFailure(payloadLimit, byteLength, expected);
    }
    const reservation = beforePayloadCopy?.(byteLength);
    if (reservation !== undefined && !reservation.ok) return reservation;

    if (
      captured.protocolVersion !== ARTIFACT_CACHE_PROTOCOL_VERSION ||
      captured.key !== expected.key
    ) {
      return invalidArtifactEntryFailure(
        "Artifact cache record envelope does not match its key",
        expected,
      );
    }
    const metadata = normalizedMetadata(captured.metadata);
    if (metadata === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache record metadata is malformed or unsupported",
        expected,
      );
    }
    const metadataKey = await deriveArtifactCacheKey(metadata);
    if (
      metadataKey === undefined ||
      metadataKey !== captured.key ||
      metadataKey !== expected.key ||
      canonicalStringify(metadata) !== canonicalStringify(expected.material)
    ) {
      return invalidArtifactEntryFailure(
        "Artifact cache record metadata is invalid, forged, or misrouted",
        expected,
      );
    }
    const integrity = snapshotPlainRecord(captured.integrity);
    if (
      integrity === undefined ||
      !exactKeys(integrity, ["algorithm", "digest", "byteLength"]) ||
      integrity.algorithm !== ARTIFACT_CACHE_INTEGRITY_ALGORITHM ||
      typeof integrity.digest !== "string" ||
      integrity.digest.length !== 64 ||
      !HEX_DIGEST.test(integrity.digest) ||
      integrity.byteLength !== byteLength
    ) {
      return invalidArtifactEntryFailure(
        "Artifact cache integrity metadata is invalid",
        expected,
      );
    }
    const payload = copyExactUint8Array(captured.payload, byteLength);
    if (payload === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache payload could not be snapshotted safely",
        expected,
      );
    }
    const actualDigest = await sha256(payload);
    if (actualDigest !== integrity.digest) {
      return invalidArtifactEntryFailure(
        "Artifact cache payload integrity digest does not match",
        expected,
      );
    }
    return success(immutableRecord(expected, payload, actualDigest));
  } catch (error) {
    return invalidArtifactEntryFailure(
      safeErrorMessage(error, "Artifact cache record validation failed"),
      expected,
    );
  }
}

export async function validateArtifactCacheRecord(
  expected: KernelShapeArtifactCacheKey,
  value: unknown,
  limits?: Partial<ArtifactCacheLimits>,
): Promise<CadResult<ArtifactCacheRecordV1>> {
  const normalizedLimits = limitsOrFailure(limits);
  if (!normalizedLimits.ok) return normalizedLimits;
  const normalizedExpected = await normalizeArtifactCacheKey(expected);
  if (normalizedExpected === undefined) {
    return invalidArtifactEntryFailure(
      "Expected artifact cache key does not match its canonical metadata",
    );
  }
  const captured = captureArtifactCacheRecord(value);
  return captured === undefined
    ? invalidArtifactEntryFailure(
        "Artifact cache record envelope is malformed or unsupported",
        normalizedExpected,
      )
    : validateCapturedArtifactCacheRecord(
        normalizedExpected,
        captured,
        {
          resource: "maxEntryBytes",
          limit: normalizedLimits.value.maxEntryBytes,
        },
      );
}

function operationFailure(
  operation: "read" | "write" | "delete" | "decode" | "encode",
  key: KernelShapeArtifactCacheKey | undefined,
  error: unknown,
  signal?: AbortSignal,
  storePayloadLimit?: PayloadLimit,
): CadResult<never> {
  const aborted = isAbortFailure(error, signal);
  if (!aborted) {
    const storeLimit = artifactCacheStoreLimit(error);
    if (
      storeLimit !== undefined &&
      (storePayloadLimit === undefined ||
        storeLimit.limit === storePayloadLimit.limit)
    ) {
      return storePayloadLimit === undefined
        ? cacheLimitFailure("maxBytes", storeLimit.limit, storeLimit.actual, key)
        : payloadLimitFailure(storePayloadLimit, storeLimit.actual, key);
    }
  }
  return failure(
    diagnostic(
      aborted ? "EVALUATION_ABORTED" : "ARTIFACT_CACHE_OPERATION_FAILED",
      aborted
        ? "Artifact cache operation was aborted"
        : safeErrorMessage(error, `Artifact cache ${operation} failed`),
      {
        severity: "error",
        ...(key === undefined ? {} : { node: key.material.node }),
        details: {
          operation,
          ...(key === undefined ? {} : { key: key.key }),
        },
      },
    ),
  );
}

function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
  try {
    if (signal?.aborted === true) return true;
  } catch {
    // A hostile signal does not make an unrelated error look like cancellation.
  }
  try {
    return (
      (typeof error === "object" || typeof error === "function") &&
      error !== null &&
      Reflect.get(error, "name") === "AbortError"
    );
  } catch {
    return false;
  }
}

interface CapturedArtifactCacheCallOptions {
  readonly signal?: AbortSignal;
  readonly limits?: Partial<ArtifactCacheLimits>;
}

function captureArtifactCacheCallOptions(
  value: unknown,
): CapturedArtifactCacheCallOptions | undefined {
  const captured = snapshotPlainRecord(value);
  if (
    captured === undefined ||
    Object.keys(captured).some(
      (key) => key !== "signal" && key !== "limits",
    )
  ) return undefined;
  return Object.freeze({
    ...(captured.signal === undefined
      ? {}
      : { signal: captured.signal as AbortSignal }),
    ...(captured.limits === undefined
      ? {}
      : { limits: captured.limits as Partial<ArtifactCacheLimits> }),
  });
}

function malformedOperationOptionsFailure<T = never>(): CadResult<T> {
  return failure(
    diagnostic(
      "ARTIFACT_CACHE_ENTRY_INVALID",
      "Artifact-cache operation options are malformed or unsupported",
      { severity: "error" },
    ),
  );
}

/**
 * Performs one independent store read. Total-byte and operation limits are
 * ceilings for this call; use ArtifactCacheSession for aggregate accounting.
 */
export async function readArtifactCacheRecord(
  store: ArtifactCacheStore,
  key: KernelShapeArtifactCacheKey,
  options: {
    readonly signal?: AbortSignal;
    readonly limits?: Partial<ArtifactCacheLimits>;
  } = {},
): Promise<CadResult<ArtifactCacheReadResult>> {
  const capturedOptions = captureArtifactCacheCallOptions(options);
  if (capturedOptions === undefined) return malformedOperationOptionsFailure();
  try {
    abortIfRequested(capturedOptions.signal);
  } catch (error) {
    return operationFailure("read", undefined, error, capturedOptions.signal);
  }
  const normalizedKey = await normalizeArtifactCacheKey(key);
  if (normalizedKey === undefined) {
    return invalidArtifactEntryFailure(
      "Artifact cache key does not match its canonical metadata",
    );
  }
  const limits = limitsOrFailure(capturedOptions.limits);
  if (!limits.ok) return limits;
  if (limits.value.maxOperations < 1) {
    return cacheLimitFailure(
      "maxOperations",
      limits.value.maxOperations,
      1,
      normalizedKey,
    );
  }
  const payloadLimit = stricterPayloadLimit(
    { resource: "maxEntryBytes", limit: limits.value.maxEntryBytes },
    {
      resource: "maxTotalReadBytes",
      limit: limits.value.maxTotalReadBytes,
    },
  );
  try {
    abortIfRequested(capturedOptions.signal);
    const value = await store.read(normalizedKey.key, {
      ...(capturedOptions.signal === undefined
        ? {}
        : { signal: capturedOptions.signal }),
      maxBytes: payloadLimit.limit,
    });
    abortIfRequested(capturedOptions.signal);
    if (value === undefined) return success(Object.freeze({ status: "miss" }));
    const captured = captureArtifactCacheRecord(value);
    if (captured === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache record envelope is malformed or unsupported",
        normalizedKey,
      );
    }
    const validated = await validateCapturedArtifactCacheRecord(
      normalizedKey,
      captured,
      payloadLimit,
    );
    abortIfRequested(capturedOptions.signal);
    if (!validated.ok) return validated;
    return success(
      Object.freeze({ status: "hit", record: validated.value }),
    );
  } catch (error) {
    return operationFailure(
      "read",
      normalizedKey,
      error,
      capturedOptions.signal,
      payloadLimit,
    );
  }
}

/**
 * Performs one independent store write. Total-byte and operation limits are
 * ceilings for this call; use ArtifactCacheSession for aggregate accounting.
 */
export async function writeArtifactCacheRecord(
  store: ArtifactCacheStore,
  record: ArtifactCacheRecordV1,
  options: {
    readonly signal?: AbortSignal;
    readonly limits?: Partial<ArtifactCacheLimits>;
  } = {},
): Promise<CadResult<void>> {
  const capturedOptions = captureArtifactCacheCallOptions(options);
  if (capturedOptions === undefined) return malformedOperationOptionsFailure();
  try {
    abortIfRequested(capturedOptions.signal);
  } catch (error) {
    return operationFailure("write", undefined, error, capturedOptions.signal);
  }
  const captured = captureArtifactCacheRecord(record);
  if (captured === undefined) {
    return invalidArtifactEntryFailure(
      "Artifact cache record envelope is malformed or unsupported",
    );
  }
  const key = await keyFromCapturedArtifactCacheRecord(captured);
  if (key === undefined) {
    return invalidArtifactEntryFailure(
      "Artifact cache record key does not match its canonical metadata",
    );
  }
  const limits = limitsOrFailure(capturedOptions.limits);
  if (!limits.ok) return limits;
  if (limits.value.maxOperations < 1) {
    return cacheLimitFailure("maxOperations", limits.value.maxOperations, 1, key);
  }
  const payloadLimit = stricterPayloadLimit(
    { resource: "maxEntryBytes", limit: limits.value.maxEntryBytes },
    {
      resource: "maxTotalWriteBytes",
      limit: limits.value.maxTotalWriteBytes,
    },
  );
  const validated = await validateCapturedArtifactCacheRecord(
    key,
    captured,
    payloadLimit,
  );
  if (!validated.ok) return validated;
  try {
    abortIfRequested(capturedOptions.signal);
    await store.write(validated.value, {
      ...(capturedOptions.signal === undefined
        ? {}
        : { signal: capturedOptions.signal }),
      maxBytes: payloadLimit.limit,
    });
    abortIfRequested(capturedOptions.signal);
    return success(undefined);
  } catch (error) {
    return operationFailure(
      "write",
      key,
      error,
      capturedOptions.signal,
      payloadLimit,
    );
  }
}

/** Performs one independent delete; use ArtifactCacheSession to share limits. */
export async function deleteArtifactCacheRecord(
  store: ArtifactCacheStore,
  key: KernelShapeArtifactCacheKey,
  options: {
    readonly signal?: AbortSignal;
    readonly limits?: Partial<ArtifactCacheLimits>;
  } = {},
): Promise<CadResult<void>> {
  const capturedOptions = captureArtifactCacheCallOptions(options);
  if (capturedOptions === undefined) return malformedOperationOptionsFailure();
  try {
    abortIfRequested(capturedOptions.signal);
  } catch (error) {
    return operationFailure("delete", undefined, error, capturedOptions.signal);
  }
  const normalizedKey = await normalizeArtifactCacheKey(key);
  if (normalizedKey === undefined) {
    return invalidArtifactEntryFailure(
      "Artifact cache key does not match its canonical metadata",
    );
  }
  const limits = limitsOrFailure(capturedOptions.limits);
  if (!limits.ok) return limits;
  if (limits.value.maxOperations < 1) {
    return cacheLimitFailure(
      "maxOperations",
      limits.value.maxOperations,
      1,
      normalizedKey,
    );
  }
  try {
    abortIfRequested(capturedOptions.signal);
    await store.delete(normalizedKey.key, {
      ...(capturedOptions.signal === undefined
        ? {}
        : { signal: capturedOptions.signal }),
    });
    abortIfRequested(capturedOptions.signal);
    return success(undefined);
  } catch (error) {
    return operationFailure(
      "delete",
      normalizedKey,
      error,
      capturedOptions.signal,
    );
  }
}

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new DOMException("Artifact cache operation was aborted", "AbortError");
  throw error;
}

const ARTIFACT_CACHE_STORE_LIMIT_ERRORS = new WeakSet<object>();

/**
 * Trusted store-side signal that a payload was refused before materialization
 * because it exceeded `ArtifactCacheStoreContext.maxBytes`.
 */
export class ArtifactCacheStoreLimitError extends Error {
  constructor(
    readonly limit: number,
    readonly actual: number,
  ) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 0 ||
      !Number.isSafeInteger(actual) ||
      actual <= limit
    ) {
      throw new RangeError(
        "Artifact cache store limits require safe integers with actual > limit",
      );
    }
    super(`Stored artifact exceeds maxBytes ${limit}`);
    this.name = "ArtifactCacheStoreLimitError";
    ARTIFACT_CACHE_STORE_LIMIT_ERRORS.add(this);
  }
}

function artifactCacheStoreLimit(
  error: unknown,
): { readonly limit: number; readonly actual: number } | undefined {
  try {
    if (
      (typeof error !== "object" && typeof error !== "function") ||
      error === null ||
      !ARTIFACT_CACHE_STORE_LIMIT_ERRORS.has(error)
    ) return undefined;
    const limit: unknown = Reflect.get(error, "limit");
    const actual: unknown = Reflect.get(error, "actual");
    return Number.isSafeInteger(limit) &&
      typeof limit === "number" &&
      limit >= 0 &&
      Number.isSafeInteger(actual) &&
      typeof actual === "number" &&
      actual > limit
      ? Object.freeze({ limit, actual })
      : undefined;
  } catch {
    return undefined;
  }
}

function captureArtifactCacheStore(
  value: unknown,
): ArtifactCacheStore | undefined {
  try {
    if (
      (typeof value !== "object" && typeof value !== "function") ||
      value === null
    ) return undefined;
    const read: unknown = Reflect.get(value, "read");
    const write: unknown = Reflect.get(value, "write");
    const remove: unknown = Reflect.get(value, "delete");
    if (
      typeof read !== "function" ||
      typeof write !== "function" ||
      typeof remove !== "function"
    ) return undefined;
    return Object.freeze({
      read: (key: ArtifactCacheKey, context: ArtifactCacheStoreContext) =>
        Reflect.apply(read, value, [key, context]) as ArtifactCacheStoreValue,
      write: (
        record: ArtifactCacheRecordV1,
        context: ArtifactCacheStoreContext,
      ) => Reflect.apply(write, value, [record, context]) as void,
      delete: (key: ArtifactCacheKey, context: ArtifactCacheDeleteContext) =>
        Reflect.apply(remove, value, [key, context]) as void,
    });
  } catch {
    return undefined;
  }
}

function captureSessionOperationOptions(
  value: unknown,
): ArtifactCacheSessionOperationOptions | undefined {
  const captured = snapshotPlainRecord(value);
  if (
    captured === undefined ||
    Object.keys(captured).some((key) => key !== "signal")
  ) return undefined;
  return Object.freeze(
    captured.signal === undefined
      ? {}
      : { signal: captured.signal as AbortSignal },
  );
}

/**
 * Stateful artifact-cache boundary with aggregate, concurrency-safe budgets.
 * Operations on one session are serialized; limits are consumed conservatively
 * and are never reset by a failed store call.
 */
const ARTIFACT_CACHE_SESSION_CONSTRUCTOR = Symbol(
  "invariantcad.artifact-cache-session.constructor",
);
const ARTIFACT_CACHE_ENCODER_LIMIT_REFUSALS = new WeakMap<object, number>();

function throwArtifactCacheEncoderLimitRefusal(
  limit: number,
  actual: number,
): never {
  if (!Number.isSafeInteger(actual) || actual <= limit) {
    throw new RangeError(
      "Artifact-cache encoder refusals require a safe integer above the ceiling",
    );
  }
  const error = new RangeError(
    `Kernel shape artifact requires at least ${actual} bytes`,
  );
  ARTIFACT_CACHE_ENCODER_LIMIT_REFUSALS.set(error, actual);
  throw error;
}

function artifactCacheEncoderLimitActual(error: unknown): number | undefined {
  if (
    (typeof error !== "object" && typeof error !== "function") ||
    error === null
  ) return undefined;
  return ARTIFACT_CACHE_ENCODER_LIMIT_REFUSALS.get(error);
}

export class ArtifactCacheSession {
  readonly #store: ArtifactCacheStore;
  readonly #mode: ArtifactCacheMode;
  readonly #limits: ArtifactCacheLimits;
  readonly #onEvent:
    | ((event: ArtifactCacheEvent) => void | PromiseLike<void>)
    | undefined;
  #operationCount = 0;
  #readByteCount = 0;
  #writeByteCount = 0;
  #tail: Promise<void> = Promise.resolve();

  private constructor(
    constructorToken: typeof ARTIFACT_CACHE_SESSION_CONSTRUCTOR,
    store: ArtifactCacheStore,
    mode: ArtifactCacheMode,
    limits: ArtifactCacheLimits,
    onEvent?: (event: ArtifactCacheEvent) => void | PromiseLike<void>,
  ) {
    if (constructorToken !== ARTIFACT_CACHE_SESSION_CONSTRUCTOR) {
      throw new TypeError(
        "ArtifactCacheSession must be created through createArtifactCacheSession",
      );
    }
    this.#store = store;
    this.#mode = mode;
    this.#limits = limits;
    this.#onEvent = onEvent;
    registerArtifactCacheSessionInternalAccess(this, {
      createSibling: () =>
        new ArtifactCacheSession(
          ARTIFACT_CACHE_SESSION_CONSTRUCTOR,
          this.#store,
          this.#mode,
          this.#limits,
          this.#onEvent,
        ),
      encodeAndWrite: (key, options, encode) =>
        this.#encodeAndWrite(key, options, encode),
      reportCodecFailure: (operation, key, result) => {
        this.#emitFailure(operation, key, result);
      },
    });
    // Public read-only projections cannot be shadowed to misrepresent the
    // private mode or limits; private counters remain mutable under Object.freeze.
    Object.freeze(this);
  }

  get mode(): ArtifactCacheMode {
    return this.#mode;
  }

  get limits(): ArtifactCacheLimits {
    return this.#limits;
  }

  static create(
    options: ArtifactCacheOptions,
  ): CadResult<ArtifactCacheSession> {
    const captured = snapshotPlainRecord(options);
    if (
      captured === undefined ||
      !Object.hasOwn(captured, "store") ||
      Object.keys(captured).some(
        (key) =>
          key !== "store" &&
          key !== "mode" &&
          key !== "limits" &&
          key !== "onEvent",
      )
    ) {
      return invalidArtifactEntryFailure(
        "Artifact-cache session options are malformed or unsupported",
      );
    }
    const store = captureArtifactCacheStore(captured.store);
    const mode = captured.mode ?? "read-write";
    const onEvent = captured.onEvent;
    if (
      store === undefined ||
      (mode !== "read-write" && mode !== "read-only" && mode !== "write-only") ||
      (onEvent !== undefined && typeof onEvent !== "function")
    ) {
      return invalidArtifactEntryFailure(
        "Artifact-cache session store, mode, or event listener is invalid",
      );
    }
    const limits = limitsOrFailure(captured.limits);
    if (!limits.ok) return limits;
    return success(
      new ArtifactCacheSession(
        ARTIFACT_CACHE_SESSION_CONSTRUCTOR,
        store,
        mode,
        limits.value,
        onEvent as
          | ((event: ArtifactCacheEvent) => void | PromiseLike<void>)
          | undefined,
      ),
    );
  }

  get usage(): ArtifactCacheSessionUsage {
    return Object.freeze({
      operations: this.#operationCount,
      readBytes: this.#readByteCount,
      writeBytes: this.#writeByteCount,
    });
  }

  read(
    key: KernelShapeArtifactCacheKey,
    options: ArtifactCacheSessionOperationOptions = {},
  ): Promise<CadResult<ArtifactCacheReadResult>> {
    const capturedOptions = captureSessionOperationOptions(options);
    if (capturedOptions === undefined) {
      return Promise.resolve(malformedOperationOptionsFailure());
    }
    return this.#exclusive("read", capturedOptions.signal, () =>
      this.#readExclusive(key, capturedOptions.signal));
  }

  write(
    record: ArtifactCacheRecordV1,
    options: ArtifactCacheSessionOperationOptions = {},
  ): Promise<CadResult<void>> {
    const capturedOptions = captureSessionOperationOptions(options);
    if (capturedOptions === undefined) {
      return Promise.resolve(malformedOperationOptionsFailure());
    }
    return this.#exclusive("write", capturedOptions.signal, () =>
      this.#writeExclusive(record, capturedOptions.signal));
  }

  delete(
    key: KernelShapeArtifactCacheKey,
    options: ArtifactCacheSessionOperationOptions = {},
  ): Promise<CadResult<void>> {
    const capturedOptions = captureSessionOperationOptions(options);
    if (capturedOptions === undefined) {
      return Promise.resolve(malformedOperationOptionsFailure());
    }
    return this.#exclusive("delete", capturedOptions.signal, () =>
      this.#deleteExclusive(key, capturedOptions.signal));
  }

  #encodeAndWrite(
    key: KernelShapeArtifactCacheKey,
    options: ArtifactCacheSessionOperationOptions,
    encode: (
      maxArtifactBytes: number,
      limitExceeded: (actualArtifactBytes: number) => never,
    ) => Awaitable<Uint8Array>,
  ): Promise<CadResult<"written" | "bypassed">> {
    const capturedOptions = captureSessionOperationOptions(options);
    if (capturedOptions === undefined || typeof encode !== "function") {
      return Promise.resolve(malformedOperationOptionsFailure());
    }
    return this.#exclusive("write", capturedOptions.signal, () =>
      this.#encodeAndWriteExclusive(key, encode, capturedOptions.signal));
  }

  async #exclusive<T>(
    operationName: "read" | "write" | "delete",
    signal: AbortSignal | undefined,
    operation: () => Promise<CadResult<T>>,
  ): Promise<CadResult<T>> {
    try {
      abortIfRequested(signal);
    } catch (error) {
      return operationFailure(operationName, undefined, error, signal);
    }
    let release = (): void => {};
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const predecessor = this.#tail;
    this.#tail = turn;
    let detachAbortListener = (): void => {};
    let aborted: Promise<CadResult<T>> | undefined;
    if (signal !== undefined) {
      let resolveAborted = (_result: CadResult<T>): void => {};
      aborted = new Promise<CadResult<T>>((resolve) => {
        resolveAborted = resolve;
      });
      const onAbort = (): void => {
        const error = new DOMException(
          "Artifact cache operation was aborted",
          "AbortError",
        );
        resolveAborted(operationFailure(operationName, undefined, error, signal));
      };
      detachAbortListener = () => {
        try {
          signal.removeEventListener("abort", onAbort);
        } catch {
          // Cancellation-listener cleanup must not poison the queue.
        }
      };
      try {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      } catch (error) {
        detachAbortListener();
        void predecessor.then(release, release);
        return operationFailure(operationName, undefined, error, signal);
      }
    }
    const acquired = predecessor.then(() => undefined);
    if (aborted !== undefined) {
      const outcome = await Promise.race([
        acquired.then(() => ({ acquired: true as const })),
        aborted.then((result) => ({ acquired: false as const, result })),
      ]);
      detachAbortListener();
      if (!outcome.acquired) {
        // Preserve the cancelled turn until its predecessor releases so later
        // operations cannot overtake a still-running store call.
        void predecessor.then(release, release);
        return outcome.result;
      }
    } else {
      await acquired;
    }
    try {
      return await operation();
    } finally {
      release();
    }
  }

  #reserveOperation(
    key: KernelShapeArtifactCacheKey,
  ): CadResult<void> {
    const actual = this.#operationCount + 1;
    if (actual > this.#limits.maxOperations) {
      return cacheLimitFailure(
        "maxOperations",
        this.#limits.maxOperations,
        actual,
        key,
      );
    }
    this.#operationCount = actual;
    return success(undefined);
  }

  #emit(event: ArtifactCacheEvent): void {
    if (this.#onEvent === undefined) return;
    try {
      const observed = this.#onEvent(Object.freeze(event));
      void Promise.resolve(observed).catch(() => {
        // Observability must never affect cache correctness.
      });
    } catch {
      // Observability must never affect cache correctness.
    }
  }

  #emitFailure(
    operation: "read" | "write" | "delete" | "decode" | "encode",
    key: KernelShapeArtifactCacheKey,
    result: CadResult<unknown>,
  ): void {
    if (result.ok) return;
    const item = result.diagnostics[0];
    const kind = item?.code === "ARTIFACT_CACHE_LIMIT_EXCEEDED"
      ? "limit"
      : item?.code === "ARTIFACT_CACHE_ENTRY_INVALID"
        ? "invalid"
        : "error";
    this.#emit({
      kind,
      node: key.material.node,
      operation,
      reason: item?.message ?? `Artifact cache ${operation} failed`,
      key: key.key,
    });
  }

  async #readExclusive(
    suppliedKey: KernelShapeArtifactCacheKey,
    signal?: AbortSignal,
  ): Promise<CadResult<ArtifactCacheReadResult>> {
    try {
      abortIfRequested(signal);
    } catch (error) {
      return operationFailure("read", undefined, error, signal);
    }
    const key = await normalizeArtifactCacheKey(suppliedKey);
    if (key === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache key does not match its canonical metadata",
      );
    }
    try {
      abortIfRequested(signal);
    } catch (error) {
      const result = operationFailure("read", key, error, signal);
      this.#emitFailure("read", key, result);
      return result;
    }
    if (this.#mode === "write-only") {
      this.#emit({
        kind: "bypass",
        node: key.material.node,
        operation: "read",
        reason: "Artifact-cache session is write-only",
        key: key.key,
      });
      return success(Object.freeze({ status: "miss" }));
    }
    const reservation = this.#reserveOperation(key);
    if (!reservation.ok) {
      this.#emitFailure("read", key, reservation);
      return reservation;
    }
    const readBytesBefore = this.#readByteCount;
    const remaining = this.#limits.maxTotalReadBytes - readBytesBefore;
    const payloadLimit = stricterPayloadLimit(
      { resource: "maxEntryBytes", limit: this.#limits.maxEntryBytes },
      {
        resource: "maxTotalReadBytes",
        limit: remaining,
        aggregate: {
          configuredLimit: this.#limits.maxTotalReadBytes,
          consumed: readBytesBefore,
        },
      },
    );
    try {
      const value = await this.#store.read(key.key, {
        ...(signal === undefined ? {} : { signal }),
        maxBytes: payloadLimit.limit,
      });
      abortIfRequested(signal);
      if (value === undefined) {
        this.#emit({ kind: "miss", node: key.material.node, key: key.key });
        return success(Object.freeze({ status: "miss" }));
      }
      const captured = captureArtifactCacheRecord(value);
      if (captured === undefined) {
        const result = invalidArtifactEntryFailure<ArtifactCacheReadResult>(
          "Artifact cache record envelope is malformed or unsupported",
          key,
        );
        this.#emitFailure("read", key, result);
        return result;
      }
      const validated = await validateCapturedArtifactCacheRecord(
        key,
        captured,
        payloadLimit,
        (byteLength) => {
          const actual = this.#readByteCount + byteLength;
          if (actual > this.#limits.maxTotalReadBytes) {
            return cacheLimitFailure(
              "maxTotalReadBytes",
              this.#limits.maxTotalReadBytes,
              actual,
              key,
            );
          }
          this.#readByteCount = actual;
          return success(undefined);
        },
      );
      abortIfRequested(signal);
      if (!validated.ok) {
        this.#emitFailure("read", key, validated);
        return validated;
      }
      this.#emit({ kind: "hit", node: key.material.node, key: key.key });
      return success(Object.freeze({ status: "hit", record: validated.value }));
    } catch (error) {
      const result = operationFailure(
        "read",
        key,
        error,
        signal,
        payloadLimit,
      );
      this.#emitFailure("read", key, result);
      return result;
    }
  }

  async #encodeAndWriteExclusive(
    suppliedKey: KernelShapeArtifactCacheKey,
    encode: (
      maxArtifactBytes: number,
      limitExceeded: (actualArtifactBytes: number) => never,
    ) => Awaitable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<CadResult<"written" | "bypassed">> {
    try {
      abortIfRequested(signal);
    } catch (error) {
      return operationFailure("encode", undefined, error, signal);
    }
    const key = await normalizeArtifactCacheKey(suppliedKey);
    if (key === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache key does not match its canonical metadata",
      );
    }
    try {
      abortIfRequested(signal);
    } catch (error) {
      const result = operationFailure("encode", key, error, signal);
      this.#emitFailure("encode", key, result);
      return result;
    }
    if (this.#mode === "read-only") {
      this.#emit({
        kind: "bypass",
        node: key.material.node,
        operation: "encode",
        reason: "Artifact-cache session is read-only",
        key: key.key,
      });
      return success("bypassed");
    }
    const reservation = this.#reserveOperation(key);
    if (!reservation.ok) {
      this.#emitFailure("encode", key, reservation);
      return reservation;
    }
    const writeBytesBefore = this.#writeByteCount;
    const remaining = this.#limits.maxTotalWriteBytes - writeBytesBefore;
    const payloadLimit = stricterPayloadLimit(
      { resource: "maxEntryBytes", limit: this.#limits.maxEntryBytes },
      {
        resource: "maxTotalWriteBytes",
        limit: remaining,
        aggregate: {
          configuredLimit: this.#limits.maxTotalWriteBytes,
          consumed: writeBytesBefore,
        },
      },
    );
    if (payloadLimit.limit === 0) {
      const result = payloadLimitFailure<"written" | "bypassed">(
        payloadLimit,
        1,
        key,
      );
      this.#emitFailure("encode", key, result);
      return result;
    }
    let encoded: unknown;
    try {
      encoded = await encode(
        payloadLimit.limit,
        (actualArtifactBytes) =>
          throwArtifactCacheEncoderLimitRefusal(
            payloadLimit.limit,
            actualArtifactBytes,
          ),
      );
      abortIfRequested(signal);
    } catch (error) {
      const actual = artifactCacheEncoderLimitActual(error);
      if (actual !== undefined) {
        const result = payloadLimitFailure<"written" | "bypassed">(
          payloadLimit,
          actual,
          key,
        );
        this.#emitFailure("encode", key, result);
        return result;
      }
      const result = operationFailure("encode", key, error, signal);
      this.#emitFailure("encode", key, result);
      return result;
    }
    const byteLength = exactUint8ArrayByteLength(encoded);
    if (byteLength === undefined) {
      const result = invalidArtifactEntryFailure<"written" | "bypassed">(
        "Kernel shape artifact encoder must return an exact, non-shared Uint8Array",
        key,
      );
      this.#emitFailure("encode", key, result);
      return result;
    }
    if (byteLength > payloadLimit.limit) {
      const result = payloadLimitFailure<"written" | "bypassed">(
        payloadLimit,
        byteLength,
        key,
      );
      this.#emitFailure("encode", key, result);
      return result;
    }
    const payload = copyExactUint8Array(encoded, byteLength);
    if (payload === undefined) {
      const result = invalidArtifactEntryFailure<"written" | "bypassed">(
        "Kernel shape artifact payload could not be snapshotted safely",
        key,
      );
      this.#emitFailure("encode", key, result);
      return result;
    }
    // Reserve bytes before hashing or publishing. Failed work remains charged.
    this.#writeByteCount += byteLength;
    let record: ArtifactCacheRecordV1;
    try {
      record = immutableRecord(key, payload, await sha256(payload));
      abortIfRequested(signal);
    } catch (error) {
      const result = operationFailure("encode", key, error, signal);
      this.#emitFailure("encode", key, result);
      return result;
    }
    try {
      await this.#store.write(record, {
        ...(signal === undefined ? {} : { signal }),
        maxBytes: payloadLimit.limit,
      });
      abortIfRequested(signal);
      this.#emit({ kind: "write", node: key.material.node, key: key.key });
      return success("written");
    } catch (error) {
      const result = operationFailure(
        "write",
        key,
        error,
        signal,
        payloadLimit,
      );
      this.#emitFailure("write", key, result);
      return result;
    }
  }

  async #writeExclusive(
    suppliedRecord: ArtifactCacheRecordV1,
    signal?: AbortSignal,
  ): Promise<CadResult<void>> {
    try {
      abortIfRequested(signal);
    } catch (error) {
      return operationFailure("write", undefined, error, signal);
    }
    const captured = captureArtifactCacheRecord(suppliedRecord);
    if (captured === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache record envelope is malformed or unsupported",
      );
    }
    const key = await keyFromCapturedArtifactCacheRecord(captured);
    if (key === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache record key does not match its canonical metadata",
      );
    }
    try {
      abortIfRequested(signal);
    } catch (error) {
      const result = operationFailure("write", key, error, signal);
      this.#emitFailure("write", key, result);
      return result;
    }
    if (this.#mode === "read-only") {
      this.#emit({
        kind: "bypass",
        node: key.material.node,
        operation: "write",
        reason: "Artifact-cache session is read-only",
        key: key.key,
      });
      return success(undefined);
    }
    const reservation = this.#reserveOperation(key);
    if (!reservation.ok) {
      this.#emitFailure("write", key, reservation);
      return reservation;
    }
    const writeBytesBefore = this.#writeByteCount;
    const remaining = this.#limits.maxTotalWriteBytes - writeBytesBefore;
    const payloadLimit = stricterPayloadLimit(
      { resource: "maxEntryBytes", limit: this.#limits.maxEntryBytes },
      {
        resource: "maxTotalWriteBytes",
        limit: remaining,
        aggregate: {
          configuredLimit: this.#limits.maxTotalWriteBytes,
          consumed: writeBytesBefore,
        },
      },
    );
    const validated = await validateCapturedArtifactCacheRecord(
      key,
      captured,
      payloadLimit,
      (byteLength) => {
        const actual = this.#writeByteCount + byteLength;
        if (actual > this.#limits.maxTotalWriteBytes) {
          return cacheLimitFailure(
            "maxTotalWriteBytes",
            this.#limits.maxTotalWriteBytes,
            actual,
            key,
          );
        }
        this.#writeByteCount = actual;
        return success(undefined);
      },
    );
    try {
      abortIfRequested(signal);
    } catch (error) {
      const result = operationFailure("write", key, error, signal);
      this.#emitFailure("write", key, result);
      return result;
    }
    if (!validated.ok) {
      this.#emitFailure("write", key, validated);
      return validated;
    }
    try {
      await this.#store.write(validated.value, {
        ...(signal === undefined ? {} : { signal }),
        maxBytes: payloadLimit.limit,
      });
      abortIfRequested(signal);
      this.#emit({ kind: "write", node: key.material.node, key: key.key });
      return success(undefined);
    } catch (error) {
      const result = operationFailure(
        "write",
        key,
        error,
        signal,
        payloadLimit,
      );
      this.#emitFailure("write", key, result);
      return result;
    }
  }

  async #deleteExclusive(
    suppliedKey: KernelShapeArtifactCacheKey,
    signal?: AbortSignal,
  ): Promise<CadResult<void>> {
    try {
      abortIfRequested(signal);
    } catch (error) {
      return operationFailure("delete", undefined, error, signal);
    }
    const key = await normalizeArtifactCacheKey(suppliedKey);
    if (key === undefined) {
      return invalidArtifactEntryFailure(
        "Artifact cache key does not match its canonical metadata",
      );
    }
    try {
      abortIfRequested(signal);
    } catch (error) {
      const result = operationFailure("delete", key, error, signal);
      this.#emitFailure("delete", key, result);
      return result;
    }
    if (this.#mode === "read-only") {
      this.#emit({
        kind: "bypass",
        node: key.material.node,
        operation: "delete",
        reason: "Artifact-cache session is read-only",
        key: key.key,
      });
      return success(undefined);
    }
    const reservation = this.#reserveOperation(key);
    if (!reservation.ok) {
      this.#emitFailure("delete", key, reservation);
      return reservation;
    }
    try {
      await this.#store.delete(key.key, {
        ...(signal === undefined ? {} : { signal }),
      });
      abortIfRequested(signal);
      this.#emit({ kind: "delete", node: key.material.node, key: key.key });
      return success(undefined);
    } catch (error) {
      const result = operationFailure("delete", key, error, signal);
      this.#emitFailure("delete", key, result);
      return result;
    }
  }
}

export function createArtifactCacheSession(
  options: ArtifactCacheOptions,
): CadResult<ArtifactCacheSession> {
  return ArtifactCacheSession.create(options);
}

function cloneRecord(record: ArtifactCacheRecordV1): ArtifactCacheRecordV1 {
  const captured = captureArtifactCacheRecord(record);
  if (
    captured === undefined ||
    captured.protocolVersion !== ARTIFACT_CACHE_PROTOCOL_VERSION ||
    !validArtifactCacheKey(captured.key)
  ) throw new TypeError("Artifact cache store record envelope is malformed");
  const metadata = normalizedMetadata(captured.metadata);
  const integrity = snapshotPlainRecord(captured.integrity);
  const byteLength = exactUint8ArrayByteLength(captured.payload);
  if (
    metadata === undefined ||
    integrity === undefined ||
    byteLength === undefined ||
    !exactKeys(integrity, ["algorithm", "digest", "byteLength"]) ||
    integrity.algorithm !== ARTIFACT_CACHE_INTEGRITY_ALGORITHM ||
    typeof integrity.digest !== "string" ||
    integrity.digest.length !== 64 ||
    !HEX_DIGEST.test(integrity.digest) ||
    integrity.byteLength !== byteLength
  ) throw new TypeError("Artifact cache store record fields are malformed");
  const payload = copyExactUint8Array(captured.payload, byteLength);
  if (payload === undefined) {
    throw new TypeError("Artifact cache store payload could not be snapshotted");
  }
  return immutableRecord(
    { key: captured.key, material: metadata },
    payload,
    integrity.digest,
  );
}

/** Reference process-local store for protocol tests and short-lived reuse. */
export class MemoryArtifactCacheStore implements ArtifactCacheStore {
  private readonly records = new Map<ArtifactCacheKey, ArtifactCacheRecordV1>();

  get size(): number {
    return this.records.size;
  }

  read(
    key: ArtifactCacheKey,
    context: ArtifactCacheStoreContext,
  ): ArtifactCacheRecordV1 | undefined {
    abortIfRequested(context.signal);
    const record = this.records.get(key);
    if (record === undefined) return undefined;
    if (record.payload.byteLength > context.maxBytes) {
      throw new ArtifactCacheStoreLimitError(
        context.maxBytes,
        record.payload.byteLength,
      );
    }
    return cloneRecord(record);
  }

  write(
    record: ArtifactCacheRecordV1,
    context: ArtifactCacheStoreContext,
  ): void {
    abortIfRequested(context.signal);
    if (record.payload.byteLength > context.maxBytes) {
      throw new ArtifactCacheStoreLimitError(
        context.maxBytes,
        record.payload.byteLength,
      );
    }
    this.records.set(record.key, cloneRecord(record));
  }

  delete(key: ArtifactCacheKey, context: ArtifactCacheDeleteContext): void {
    abortIfRequested(context.signal);
    this.records.delete(key);
  }

  clear(): void {
    this.records.clear();
  }
}
