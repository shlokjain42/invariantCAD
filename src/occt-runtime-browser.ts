import {
  finishLoadingAttestedOcctRuntime,
  loaderUnavailable,
  moduleImportFailure,
  verifyOcctRuntimeRelease,
  type AttestedOcctRuntime,
  type LoadAttestedOcctRuntimeOptions,
} from "./internal/occt-runtime-attestation.js";

export {
  INVARIANTCAD_OCCT_FACADE_0_9_0_RELEASE_MANIFEST_SHA256,
  OcctRuntimeAttestationError,
  type AttestedOcctRuntime,
  type LoadAttestedOcctRuntimeOptions,
  type OcctRuntimeAttestation,
  type OcctRuntimeAttestationBytes,
  type OcctRuntimeAttestationFailureReason,
  type OcctRuntimeAttestationFile,
} from "./internal/occt-runtime-attestation.js";

/**
 * Verifies and imports an OCCT facade runtime in a browser or Web Worker.
 *
 * The browser must permit `blob:` module scripts. The Blob URL is revoked as
 * soon as import completes; the imported module remains cached by the realm.
 */
export async function loadAttestedOcctRuntime(
  options: LoadAttestedOcctRuntimeOptions,
): Promise<AttestedOcctRuntime> {
  const verified = await verifyOcctRuntimeRelease(options);
  let BlobConstructor: typeof Blob;
  let UrlConstructor: typeof URL;
  let createObjectUrl: typeof URL.createObjectURL;
  let revokeObjectUrl: typeof URL.revokeObjectURL;
  try {
    BlobConstructor = globalThis.Blob;
    UrlConstructor = globalThis.URL;
    createObjectUrl = UrlConstructor?.createObjectURL;
    revokeObjectUrl = UrlConstructor?.revokeObjectURL;
    if (
      typeof BlobConstructor !== "function" ||
      typeof UrlConstructor !== "function" ||
      typeof createObjectUrl !== "function" ||
      typeof revokeObjectUrl !== "function"
    ) {
      throw new TypeError(
        "Blob module URLs are unavailable in this JavaScript realm",
      );
    }
  } catch (error) {
    throw loaderUnavailable(error);
  }
  let moduleUrl: string;
  try {
    const blob = new BlobConstructor(
      [verified.javascript as Uint8Array<ArrayBuffer>],
      {
        type: "text/javascript;charset=utf-8",
      },
    );
    moduleUrl = Reflect.apply(createObjectUrl, UrlConstructor, [blob]) as
      string;
    if (typeof moduleUrl !== "string") {
      throw new TypeError("URL.createObjectURL did not return a string");
    }
  } catch (error) {
    throw loaderUnavailable(error);
  }
  let namespace: unknown;
  try {
    namespace = await import(
      /* @vite-ignore */ moduleUrl
    );
  } catch (error) {
    throw moduleImportFailure(error);
  } finally {
    try {
      Reflect.apply(revokeObjectUrl, UrlConstructor, [moduleUrl]);
    } catch {
      // Revocation must not mask import success or the primary typed failure.
    }
  }
  return finishLoadingAttestedOcctRuntime(verified, namespace);
}
