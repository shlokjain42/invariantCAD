import { canonicalStringifyProtocol } from "../core/json.js";
import type { OcctModuleFactory } from "../occt-kernel.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._+-]+$/u;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_JAVASCRIPT_BYTES = 16 * 1024 * 1024;
const MAX_WEBASSEMBLY_BYTES = 512 * 1024 * 1024;

const IntrinsicArrayBuffer = ArrayBuffer;
const IntrinsicUint8Array = Uint8Array;
const arrayBufferIsView = ArrayBuffer.isView;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const typedArrayPrototype = Object.getPrototypeOf(
  Uint8Array.prototype,
) as object;
const typedArrayNameGetter = Object.getOwnPropertyDescriptor(
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
const typedArraySet = Uint8Array.prototype.set;

declare const ATTESTED_OCCT_RUNTIME_BRAND: unique symbol;

export const INVARIANTCAD_OCCT_FACADE_0_9_0_RELEASE_MANIFEST_SHA256 =
  "3403826c60c891c132c2890e8a87d33f91883f98d53014483d7e90cd2006ab6c";

export type OcctRuntimeAttestationFailureReason =
  | "invalid-trust-pin"
  | "invalid-input"
  | "resource-limit"
  | "cryptography-unavailable"
  | "release-manifest-digest-mismatch"
  | "invalid-release-manifest"
  | "javascript-size-mismatch"
  | "webassembly-size-mismatch"
  | "javascript-digest-mismatch"
  | "webassembly-digest-mismatch"
  | "loader-unavailable"
  | "module-hook-failed"
  | "module-import-failed"
  | "module-factory-missing"
  | "facade-marker-mismatch";

export class OcctRuntimeAttestationError extends Error {
  readonly reason: OcctRuntimeAttestationFailureReason;

  constructor(
    reason: OcctRuntimeAttestationFailureReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`OCCT runtime attestation failed: ${message}`, options);
    this.name = "OcctRuntimeAttestationError";
    this.reason = reason;
  }
}

export type OcctRuntimeAttestationBytes = ArrayBuffer | Uint8Array;

export interface LoadAttestedOcctRuntimeOptions {
  /**
   * Exact canonical `metadata/release.json` bytes from an OCCT facade bundle.
   */
  readonly releaseManifest: OcctRuntimeAttestationBytes;
  /**
   * Independently trusted lowercase SHA-256 pin for `releaseManifest`.
   * A digest fetched beside an untrusted bundle is not an independent trust
   * anchor.
   */
  readonly expectedReleaseManifestSha256: string;
  /** Exact `runtime/occt-wasm.js` bytes named by the release manifest. */
  readonly javascript: OcctRuntimeAttestationBytes;
  /** Exact `runtime/occt-wasm.wasm` bytes named by the release manifest. */
  readonly webassembly: OcctRuntimeAttestationBytes;
}

export interface OcctRuntimeAttestationFile {
  readonly path: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
}

export interface OcctRuntimeAttestation {
  readonly protocolVersion: 1;
  readonly runtimePairIdentity: string;
  readonly declaredBuildIdentity: string;
  readonly releaseManifestSha256: string;
  readonly bundle: {
    readonly name: string;
    readonly version: string;
    readonly layoutVersion: number;
  };
  readonly facade: {
    readonly marker: string;
    readonly abiVersion: string;
    readonly upstreamOcctWasmVersion: string;
  };
  readonly javascript: OcctRuntimeAttestationFile;
  readonly webassembly: OcctRuntimeAttestationFile;
  readonly evidence: {
    readonly exactReleaseManifestBytesVerified: true;
    readonly exactRuntimeBytesVerified: true;
    readonly buildExecutionObserved: false;
    readonly buildExecutionAuthenticated: false;
    readonly publisherAuthenticated: false;
    readonly certifiesCompatibility: false;
  };
}

/**
 * Opaque, reusable matched OCCT JavaScript/WASM pair. Only the immutable
 * attestation report is public; executable state remains module-private.
 */
export interface AttestedOcctRuntime {
  readonly attestation: OcctRuntimeAttestation;
  readonly [ATTESTED_OCCT_RUNTIME_BRAND]: never;
}

interface ReleaseFile {
  readonly path: string;
  readonly mediaType: string;
  readonly size: number;
  readonly sha256: string;
}

interface SourcePatch {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

interface SourceMaterial {
  readonly path: string;
  readonly role: "source-lock" | "source-patch" | "build-script";
  readonly size: number;
  readonly sha256: string;
}

interface ReleaseManifestV1 {
  readonly schemaVersion: 1;
  readonly bundle: {
    readonly name: string;
    readonly version: string;
    readonly layoutVersion: number;
  };
  readonly facade: {
    readonly marker: string;
    readonly abiVersion: string;
    readonly upstreamOcctWasmVersion: string;
  };
  readonly runtime: readonly [ReleaseFile, ReleaseFile];
  readonly source: {
    readonly lockPath: "source/native/occt/upstream.lock.json";
    readonly buildScriptPath: "source/scripts/build-occt-facade.sh";
    readonly patches: readonly SourcePatch[];
    readonly relinkInstructionsPath: "SOURCE_AND_RELINK.md";
    readonly materials: readonly SourceMaterial[];
  };
  readonly integrity: {
    readonly algorithm: "SHA-256";
    readonly manifestPath: "SHA256SUMS";
    readonly coverage: "all regular bundle files except SHA256SUMS";
  };
}

interface VerifiedOcctRuntime {
  readonly manifest: ReleaseManifestV1;
  readonly javascript: Uint8Array;
  readonly webassembly: Uint8Array;
  readonly attestation: OcctRuntimeAttestation;
}

interface AttestedOcctRuntimeState {
  readonly moduleFactory: OcctModuleFactory;
  readonly webassembly: Uint8Array;
  readonly expectedFacadeMarker: string;
  readonly runtimePairIdentity: string;
}

const attestedRuntimeStates = new WeakMap<
  AttestedOcctRuntime,
  AttestedOcctRuntimeState
>();

function failure(
  reason: OcctRuntimeAttestationFailureReason,
  message: string,
  cause?: unknown,
): OcctRuntimeAttestationError {
  return new OcctRuntimeAttestationError(
    reason,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(
      `${label} must contain exactly: ${sortedExpected.join(", ")}`,
    );
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function nonemptyString(
  value: unknown,
  label: string,
  maxLength = 1024,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new TypeError(
      `${label} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || !(Number(value) > 0)) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function safePath(value: unknown, label: string): string {
  const path = nonemptyString(value, label, 2048);
  if (
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !SAFE_PATH_SEGMENT_PATTERN.test(segment),
    )
  ) {
    throw new TypeError(`${label} must be a normalized safe relative path`);
  }
  return path;
}

function releaseFile(value: unknown, label: string): ReleaseFile {
  const entry = record(value, label);
  assertExactKeys(
    entry,
    ["path", "mediaType", "size", "sha256"],
    label,
  );
  return {
    path: safePath(entry.path, `${label}.path`),
    mediaType: nonemptyString(entry.mediaType, `${label}.mediaType`, 256),
    size: positiveInteger(entry.size, `${label}.size`),
    sha256: sha256(entry.sha256, `${label}.sha256`),
  };
}

function sourcePatch(value: unknown, label: string): SourcePatch {
  const entry = record(value, label);
  assertExactKeys(entry, ["path", "size", "sha256"], label);
  return {
    path: safePath(entry.path, `${label}.path`),
    size: positiveInteger(entry.size, `${label}.size`),
    sha256: sha256(entry.sha256, `${label}.sha256`),
  };
}

function sourceMaterial(value: unknown, label: string): SourceMaterial {
  const entry = record(value, label);
  assertExactKeys(entry, ["path", "role", "size", "sha256"], label);
  if (
    entry.role !== "source-lock" &&
    entry.role !== "source-patch" &&
    entry.role !== "build-script"
  ) {
    throw new TypeError(`${label}.role is unsupported`);
  }
  return {
    path: safePath(entry.path, `${label}.path`),
    role: entry.role,
    size: positiveInteger(entry.size, `${label}.size`),
    sha256: sha256(entry.sha256, `${label}.sha256`),
  };
}

function sameSourceFile(
  first: SourcePatch,
  second: SourceMaterial,
): boolean {
  return (
    first.path === second.path &&
    first.size === second.size &&
    first.sha256 === second.sha256
  );
}

function parseReleaseManifest(
  bytes: Uint8Array,
): ReleaseManifestV1 {
  let text: string;
  let parsed: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw failure(
      "invalid-release-manifest",
      "the trusted release manifest is not valid UTF-8 JSON",
      error,
    );
  }

  try {
    const root = record(parsed, "release manifest");
    assertExactKeys(
      root,
      ["schemaVersion", "bundle", "facade", "runtime", "source", "integrity"],
      "release manifest",
    );
    if (root.schemaVersion !== 1) {
      throw new TypeError("release manifest.schemaVersion must be 1");
    }

    const rawBundle = record(root.bundle, "release manifest.bundle");
    assertExactKeys(
      rawBundle,
      ["name", "version", "layoutVersion"],
      "release manifest.bundle",
    );
    const bundle = {
      name: nonemptyString(
        rawBundle.name,
        "release manifest.bundle.name",
        256,
      ),
      version: nonemptyString(
        rawBundle.version,
        "release manifest.bundle.version",
        256,
      ),
      layoutVersion: positiveInteger(
        rawBundle.layoutVersion,
        "release manifest.bundle.layoutVersion",
      ),
    };
    if (
      bundle.name !== "invariantcad-occt-facade" ||
      bundle.layoutVersion !== 1
    ) {
      throw new TypeError(
        "release manifest.bundle must use the invariantcad-occt-facade layout v1",
      );
    }

    const rawFacade = record(root.facade, "release manifest.facade");
    assertExactKeys(
      rawFacade,
      ["marker", "abiVersion", "upstreamOcctWasmVersion"],
      "release manifest.facade",
    );
    const facade = {
      marker: nonemptyString(
        rawFacade.marker,
        "release manifest.facade.marker",
      ),
      abiVersion: nonemptyString(
        rawFacade.abiVersion,
        "release manifest.facade.abiVersion",
        256,
      ),
      upstreamOcctWasmVersion: nonemptyString(
        rawFacade.upstreamOcctWasmVersion,
        "release manifest.facade.upstreamOcctWasmVersion",
        256,
      ),
    };
    if (
      bundle.version !== facade.abiVersion ||
      facade.marker !==
        `invariantcad-facade@${facade.abiVersion}+occt-wasm.${facade.upstreamOcctWasmVersion}`
    ) {
      throw new TypeError(
        "release manifest bundle/facade version fields are inconsistent",
      );
    }

    if (!Array.isArray(root.runtime) || root.runtime.length !== 2) {
      throw new TypeError(
        "release manifest.runtime must contain exactly JavaScript then WebAssembly",
      );
    }
    const javascript = releaseFile(
      root.runtime[0],
      "release manifest.runtime[0]",
    );
    const webassembly = releaseFile(
      root.runtime[1],
      "release manifest.runtime[1]",
    );
    if (
      javascript.path !== "runtime/occt-wasm.js" ||
      javascript.mediaType !== "text/javascript" ||
      webassembly.path !== "runtime/occt-wasm.wasm" ||
      webassembly.mediaType !== "application/wasm"
    ) {
      throw new TypeError(
        "release manifest.runtime must name the fixed OCCT JavaScript/WASM layout and media types",
      );
    }
    if (javascript.size > MAX_JAVASCRIPT_BYTES) {
      throw new RangeError(
        `release manifest JavaScript exceeds ${MAX_JAVASCRIPT_BYTES} bytes`,
      );
    }
    if (webassembly.size > MAX_WEBASSEMBLY_BYTES) {
      throw new RangeError(
        `release manifest WebAssembly exceeds ${MAX_WEBASSEMBLY_BYTES} bytes`,
      );
    }

    const rawSource = record(root.source, "release manifest.source");
    assertExactKeys(
      rawSource,
      [
        "lockPath",
        "buildScriptPath",
        "patches",
        "relinkInstructionsPath",
        "materials",
      ],
      "release manifest.source",
    );
    if (
      rawSource.lockPath !== "source/native/occt/upstream.lock.json" ||
      rawSource.buildScriptPath !== "source/scripts/build-occt-facade.sh" ||
      rawSource.relinkInstructionsPath !== "SOURCE_AND_RELINK.md"
    ) {
      throw new TypeError("release manifest.source uses an unsupported layout");
    }
    if (!Array.isArray(rawSource.patches) || rawSource.patches.length === 0) {
      throw new TypeError(
        "release manifest.source.patches must be a non-empty array",
      );
    }
    const patches = rawSource.patches.map((entry, index) =>
      sourcePatch(entry, `release manifest.source.patches[${index}]`),
    );
    if (
      patches.some(
        (entry, index) =>
          !entry.path.startsWith("source/native/occt/patches/") ||
          (index > 0 && patches[index - 1]!.path >= entry.path),
      )
    ) {
      throw new TypeError(
        "release manifest source patches must be unique and bytewise ordered",
      );
    }
    if (
      !Array.isArray(rawSource.materials) ||
      rawSource.materials.length !== patches.length + 2
    ) {
      throw new TypeError(
        "release manifest source materials must contain one lock, every patch, and one build script",
      );
    }
    const materials = rawSource.materials.map((entry, index) =>
      sourceMaterial(entry, `release manifest.source.materials[${index}]`),
    );
    const firstMaterial = materials[0]!;
    const lastMaterial = materials.at(-1)!;
    if (
      firstMaterial.path !== rawSource.lockPath ||
      firstMaterial.role !== "source-lock" ||
      lastMaterial.path !== rawSource.buildScriptPath ||
      lastMaterial.role !== "build-script" ||
      patches.some(
        (patch, index) =>
          materials[index + 1]?.role !== "source-patch" ||
          !sameSourceFile(patch, materials[index + 1]!),
      )
    ) {
      throw new TypeError(
        "release manifest source materials do not exactly match the declared recipe order",
      );
    }

    const rawIntegrity = record(
      root.integrity,
      "release manifest.integrity",
    );
    assertExactKeys(
      rawIntegrity,
      ["algorithm", "manifestPath", "coverage"],
      "release manifest.integrity",
    );
    if (
      rawIntegrity.algorithm !== "SHA-256" ||
      rawIntegrity.manifestPath !== "SHA256SUMS" ||
      rawIntegrity.coverage !==
        "all regular bundle files except SHA256SUMS"
    ) {
      throw new TypeError(
        "release manifest.integrity uses unsupported integrity semantics",
      );
    }

    const normalized: ReleaseManifestV1 = {
      schemaVersion: 1,
      bundle,
      facade,
      runtime: [javascript, webassembly],
      source: {
        lockPath: "source/native/occt/upstream.lock.json",
        buildScriptPath: "source/scripts/build-occt-facade.sh",
        patches,
        relinkInstructionsPath: "SOURCE_AND_RELINK.md",
        materials,
      },
      integrity: {
        algorithm: "SHA-256",
        manifestPath: "SHA256SUMS",
        coverage: "all regular bundle files except SHA256SUMS",
      },
    };
    if (`${JSON.stringify(normalized, undefined, 2)}\n` !== text) {
      throw new TypeError(
        "release manifest must use the exact canonical v1 JSON encoding",
      );
    }
    return normalized;
  } catch (error) {
    if (error instanceof OcctRuntimeAttestationError) throw error;
    throw failure(
      error instanceof RangeError
        ? "resource-limit"
        : "invalid-release-manifest",
      error instanceof Error
        ? error.message
        : "the release manifest is malformed",
      error,
    );
  }
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

function hasUint8ArrayBrand(value: unknown): value is Uint8Array {
  if (
    !Reflect.apply(arrayBufferIsView, IntrinsicArrayBuffer, [value]) ||
    typedArrayNameGetter === undefined
  ) {
    return false;
  }
  try {
    return Reflect.apply(typedArrayNameGetter, value, []) === "Uint8Array";
  } catch {
    return false;
  }
}

function snapshotBytes(
  value: unknown,
  label: string,
  maximum: number,
): Uint8Array {
  let view: Uint8Array;
  try {
    if (hasArrayBufferBrand(value)) view = new IntrinsicUint8Array(value);
    else if (hasUint8ArrayBrand(value)) view = value;
    else {
      throw new TypeError(`${label} must be an ArrayBuffer or Uint8Array`);
    }
    if (
      typedArrayByteLengthGetter === undefined ||
      typedArrayBufferGetter === undefined
    ) {
      throw new TypeError("Uint8Array intrinsic accessors are unavailable");
    }
    const backingBuffer = Reflect.apply(typedArrayBufferGetter, view, []) as
      | ArrayBuffer
      | SharedArrayBuffer;
    if (!hasArrayBufferBrand(backingBuffer)) {
      throw new TypeError(
        `${label} must not use SharedArrayBuffer storage`,
      );
    }
    const byteLength = Reflect.apply(typedArrayByteLengthGetter, view, []) as
      number;
    if (byteLength === 0) {
      try {
        Reflect.apply(typedArraySet, new IntrinsicUint8Array(0), [view]);
      } catch {
        throw new TypeError(`${label} must not be detached`);
      }
      throw new RangeError(`${label} must not be empty`);
    }
    if (byteLength > maximum) {
      throw new RangeError(`${label} exceeds ${maximum} bytes`);
    }
    const copy = new IntrinsicUint8Array(byteLength);
    Reflect.apply(typedArraySet, copy, [view]);
    return copy;
  } catch (error) {
    throw failure(
      error instanceof RangeError ? "resource-limit" : "invalid-input",
      error instanceof Error ? error.message : `${label} is invalid`,
      error,
    );
  }
}

function loaderOptionsRecord(value: unknown): Record<string, unknown> {
  try {
    if (!isRecord(value)) {
      throw new TypeError("loader options must be an object");
    }
    return value;
  } catch (error) {
    throw failure(
      "invalid-input",
      "loader options must be a readable object",
      error,
    );
  }
}

function loaderOption(
  options: Record<string, unknown>,
  key: keyof LoadAttestedOcctRuntimeOptions,
): unknown {
  try {
    return options[key];
  } catch (error) {
    throw failure(
      "invalid-input",
      `loader option ${key} could not be read`,
      error,
    );
  }
}

interface CapturedSubtleDigest {
  readonly receiver: SubtleCrypto;
  readonly method: SubtleCrypto["digest"];
}

function subtleDigest(): CapturedSubtleDigest {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle == null || typeof subtle.digest !== "function") {
      throw new TypeError("Web Crypto SHA-256 is unavailable");
    }
    return {
      receiver: subtle,
      method: subtle.digest,
    };
  } catch (error) {
    throw failure(
      "cryptography-unavailable",
      "Web Crypto SHA-256 is unavailable in this JavaScript realm",
      error,
    );
  }
}

async function digestHex(
  subtle: CapturedSubtleDigest,
  value: Uint8Array,
): Promise<string> {
  let digest: Uint8Array;
  try {
    const result = await Reflect.apply(subtle.method, subtle.receiver, [
      "SHA-256",
      value as Uint8Array<ArrayBuffer>,
    ]);
    digest = new IntrinsicUint8Array(result);
    if (digest.byteLength !== 32) {
      throw new TypeError("Web Crypto SHA-256 returned a non-256-bit digest");
    }
  } catch (error) {
    throw failure(
      "cryptography-unavailable",
      "Web Crypto SHA-256 failed in this JavaScript realm",
      error,
    );
  }
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function immutableFile(value: ReleaseFile): OcctRuntimeAttestationFile {
  return Object.freeze({ ...value });
}

export async function verifyOcctRuntimeRelease(
  options: LoadAttestedOcctRuntimeOptions,
): Promise<VerifiedOcctRuntime> {
  // Capture all caller-owned values before the first await. In particular,
  // hashing never races mutation of a supplied view or backing buffer.
  const capturedOptions = loaderOptionsRecord(options);
  const expectedReleaseManifestSha256 = loaderOption(
    capturedOptions,
    "expectedReleaseManifestSha256",
  );
  if (
    typeof expectedReleaseManifestSha256 !== "string" ||
    !SHA256_PATTERN.test(expectedReleaseManifestSha256)
  ) {
    throw failure(
      "invalid-trust-pin",
      "expectedReleaseManifestSha256 must be a lowercase SHA-256 digest",
    );
  }
  const releaseManifest = snapshotBytes(
    loaderOption(capturedOptions, "releaseManifest"),
    "releaseManifest",
    MAX_MANIFEST_BYTES,
  );
  const javascript = snapshotBytes(
    loaderOption(capturedOptions, "javascript"),
    "javascript",
    MAX_JAVASCRIPT_BYTES,
  );
  const webassembly = snapshotBytes(
    loaderOption(capturedOptions, "webassembly"),
    "webassembly",
    MAX_WEBASSEMBLY_BYTES,
  );
  const subtle = subtleDigest();

  const actualReleaseManifestSha256 = await digestHex(
    subtle,
    releaseManifest,
  );
  if (actualReleaseManifestSha256 !== expectedReleaseManifestSha256) {
    throw failure(
      "release-manifest-digest-mismatch",
      "releaseManifest does not match its independently trusted SHA-256 pin",
    );
  }

  const manifest = parseReleaseManifest(releaseManifest);
  const [javascriptPin, webassemblyPin] = manifest.runtime;
  if (javascript.byteLength !== javascriptPin.size) {
    throw failure(
      "javascript-size-mismatch",
      `javascript has ${javascript.byteLength} bytes; the trusted manifest requires ${javascriptPin.size}`,
    );
  }
  if (webassembly.byteLength !== webassemblyPin.size) {
    throw failure(
      "webassembly-size-mismatch",
      `webassembly has ${webassembly.byteLength} bytes; the trusted manifest requires ${webassemblyPin.size}`,
    );
  }

  const runtimePairProjection = new TextEncoder().encode(
    canonicalStringifyProtocol({
      protocolVersion: 1,
      facade: manifest.facade,
      javascript: {
        role: "javascript",
        size: javascriptPin.size,
        sha256: javascriptPin.sha256,
      },
      webassembly: {
        role: "webassembly",
        size: webassemblyPin.size,
        sha256: webassemblyPin.sha256,
      },
    }),
  );
  const [actualJavascriptSha256, actualWebassemblySha256, pairSha256] =
    await Promise.all([
      digestHex(subtle, javascript),
      digestHex(subtle, webassembly),
      digestHex(subtle, runtimePairProjection),
    ]);
  if (actualJavascriptSha256 !== javascriptPin.sha256) {
    throw failure(
      "javascript-digest-mismatch",
      "javascript does not match the trusted release manifest",
    );
  }
  if (actualWebassemblySha256 !== webassemblyPin.sha256) {
    throw failure(
      "webassembly-digest-mismatch",
      "webassembly does not match the trusted release manifest",
    );
  }

  const attestation: OcctRuntimeAttestation = Object.freeze({
    protocolVersion: 1,
    runtimePairIdentity:
      `invariantcad-occt-runtime-pair@1:sha256:${pairSha256}`,
    declaredBuildIdentity:
      `invariantcad-occt-release-manifest@1:sha256:${actualReleaseManifestSha256}`,
    releaseManifestSha256: actualReleaseManifestSha256,
    bundle: Object.freeze({ ...manifest.bundle }),
    facade: Object.freeze({ ...manifest.facade }),
    javascript: immutableFile(javascriptPin),
    webassembly: immutableFile(webassemblyPin),
    evidence: Object.freeze({
      exactReleaseManifestBytesVerified: true,
      exactRuntimeBytesVerified: true,
      buildExecutionObserved: false,
      buildExecutionAuthenticated: false,
      publisherAuthenticated: false,
      certifiesCompatibility: false,
    }),
  });
  return { manifest, javascript, webassembly, attestation };
}

export function finishLoadingAttestedOcctRuntime(
  verified: VerifiedOcctRuntime,
  namespace: unknown,
): AttestedOcctRuntime {
  if (
    !isRecord(namespace) ||
    typeof namespace.default !== "function"
  ) {
    throw failure(
      "module-factory-missing",
      "verified JavaScript must export one default OCCT module factory",
    );
  }
  const runtime = Object.freeze({
    attestation: verified.attestation,
  }) as AttestedOcctRuntime;
  attestedRuntimeStates.set(runtime, {
    moduleFactory: namespace.default as OcctModuleFactory,
    webassembly: verified.webassembly,
    expectedFacadeMarker: verified.manifest.facade.marker,
    runtimePairIdentity: verified.attestation.runtimePairIdentity,
  });
  return runtime;
}

export function moduleImportFailure(error: unknown): OcctRuntimeAttestationError {
  return failure(
    "module-import-failed",
    "the verified JavaScript module could not be imported",
    error,
  );
}

export function loaderUnavailable(error: unknown): OcctRuntimeAttestationError {
  return failure(
    "loader-unavailable",
    "this JavaScript host cannot create the verified module loader",
    error,
  );
}

export function moduleHookFailure(error: unknown): OcctRuntimeAttestationError {
  return failure(
    "module-hook-failed",
    "the Node.js verified-module hook could not be installed",
    error,
  );
}

export interface CapturedAttestedOcctRuntime {
  readonly moduleFactory: OcctModuleFactory;
  readonly wasmBinary: ArrayBuffer;
  readonly expectedFacadeMarker: string;
  readonly runtimePairIdentity: string;
  readonly attestation: OcctRuntimeAttestation;
}

function copyArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new IntrinsicArrayBuffer(value.byteLength);
  Reflect.apply(typedArraySet, new IntrinsicUint8Array(copy), [value]);
  return copy;
}

export function captureAttestedOcctRuntime(
  runtime: AttestedOcctRuntime,
): CapturedAttestedOcctRuntime {
  const state = attestedRuntimeStates.get(runtime);
  if (state === undefined) {
    throw new TypeError(
      "attestedRuntime must be an opaque runtime returned by an InvariantCAD attested loader",
    );
  }
  return Object.freeze({
    moduleFactory: state.moduleFactory,
    wasmBinary: copyArrayBuffer(state.webassembly),
    expectedFacadeMarker: state.expectedFacadeMarker,
    runtimePairIdentity: state.runtimePairIdentity,
    attestation: runtime.attestation,
  });
}

export function assertAttestedFacadeMarker(
  expected: string,
  actual: string | undefined,
  cause?: unknown,
): void {
  if (actual !== expected) {
    throw failure(
      "facade-marker-mismatch",
      `loaded facade marker ${JSON.stringify(actual)} does not match trusted marker ${JSON.stringify(expected)}`,
      cause,
    );
  }
}
