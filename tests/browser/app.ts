/// <reference types="vite/client" />

import {
  createEvaluator,
  design,
  EvaluatedSolid,
  mm,
  vec3,
} from "invariantcad";
import { createOcctKernel } from "invariantcad/kernels/occt";
import {
  loadAttestedOcctRuntime,
  type OcctRuntimeAttestationFailureReason,
} from "invariantcad/kernels/occt/browser";
import stockOcctWasmUrl from "occt-wasm/dist/occt-wasm.wasm?url";
import {
  DisposableWorkerOperationTimeoutError,
  runDisposableWorkerOperation,
  type DisposableWorkerOperationHandle,
} from "../../src/internal/disposable-worker-operation.js";
import artifactFixtureBase64 from "../fixtures/occt-shape-candidate-v2-asymmetric-box.b64?raw";
import type {
  ArtifactWorkerEvidence,
  ArtifactWorkerRequest,
  ArtifactWorkerResponse,
} from "./artifact.worker.js";

export interface BrowserSmokeResult {
  readonly manifold: {
    readonly volume: number;
    readonly triangles: number;
    readonly stlBytes: number;
  };
  readonly occt: {
    readonly volume: number;
    readonly faces: number;
    readonly edges: number;
    readonly vertices: number;
    readonly stepBytes: number;
    readonly crossRealmWasmUrlCaptured: boolean;
  };
  readonly artifactWorker: {
    readonly fixture: {
      readonly byteLength: number;
      readonly sourceBytesPreserved: boolean;
      readonly transferDetached: boolean;
    };
    readonly preAbort: {
      readonly name: string;
      readonly workerCreations: number;
    };
    readonly timeout: {
      readonly name: string;
      readonly timeoutMs: number;
      readonly started: boolean;
    };
    readonly recovery: ArtifactWorkerEvidence;
    readonly workersCreated: number;
    readonly workersTerminated: number;
  };
  readonly runtimeAttestation: {
    readonly runtimePairIdentity: string;
    readonly declaredBuildIdentity: string;
    readonly imports: number;
    readonly factories: number;
    readonly constructed: number;
    readonly disposed: number;
    readonly exactWasmReceived: boolean;
    readonly draftAdvertised: boolean;
    readonly shapeArtifactsAbsent: boolean;
    readonly topologyFingerprint: string;
    readonly tamperReason: OcctRuntimeAttestationFailureReason;
    readonly tamperExecutedJavaScript: boolean;
    readonly importFailureReason: OcctRuntimeAttestationFailureReason;
    readonly recoverySameIdentity: boolean;
    readonly blobUrlsCreated: number;
    readonly blobUrlsRevoked: number;
    readonly blobUrlsOutstanding: number;
  };
}

declare global {
  interface Window {
    invariantCadBrowserSmoke: Promise<BrowserSmokeResult>;
  }
}

function browserSmokeDocument() {
  const cad = design("browser-smoke");
  const box = cad.box("box", {
    size: vec3(mm(2), mm(3), mm(4)),
  });
  cad.output("box", box);
  return cad.build();
}

function diagnosticMessage(
  diagnostics: readonly { readonly code: string; readonly message: string }[],
): string {
  return diagnostics
    .map((item) => item.code + ": " + item.message)
    .join("\n");
}

function decodeFixtureBase64(value: string): Uint8Array {
  const encoded = value.replace(/\s/gu, "");
  const binary = atob(encoded);
  if (binary.length === 0) {
    throw new Error("The committed OCCT artifact fixture is empty");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength &&
    first.every((byte, index) => byte === second[index])
  );
}

interface BrowserAttestationState {
  imports: number;
  factories: number;
  constructed: number;
  disposed: number;
  exactWasmReceived: boolean;
}

const BROWSER_ATTESTATION_STATE =
  "__invariantCadBrowserRuntimeAttestation";
const BROWSER_ATTESTATION_FACADE =
  "invariantcad-facade@0.2.0+occt-wasm.3.7.0";
const browserAttestationWasm = new Uint8Array([9, 8, 7, 6]);
const browserAttestationJavascript = new TextEncoder().encode(`
const state = globalThis.${BROWSER_ATTESTATION_STATE} ??= {
  imports: 0,
  factories: 0,
  constructed: 0,
  disposed: 0,
  exactWasmReceived: false
};
state.imports += 1;
const topologyKind = Object.freeze({ NONE: -1, FACE: 0, EDGE: 1, VERTEX: 2 });
const topologyRelation = Object.freeze({
  PRESERVED: 0,
  MODIFIED: 1,
  GENERATED: 2,
  DELETED: 3,
  CREATED: 4
});
class MinimalRawKernel {
  constructor() { state.constructed += 1; }
  releaseAll() {}
  delete() { state.disposed += 1; }
}
export default async function createModule(options = {}) {
  state.factories += 1;
  const bytes = new Uint8Array(options.wasmBinary);
  state.exactWasmReceived =
    bytes.length === 4 &&
    bytes[0] === 9 &&
    bytes[1] === 8 &&
    bytes[2] === 7 &&
    bytes[3] === 6;
  if (!state.exactWasmReceived) throw new Error("wrong verified WASM bytes");
  return {
    OcctKernel: MinimalRawKernel,
    VectorUint32: class {},
    InvariantCadDraftReport: class {},
    InvariantCadTopologyKind: topologyKind,
    InvariantCadTopologyRelation: topologyRelation,
    invariantcadFacadeVersion: () => ${JSON.stringify(BROWSER_ATTESTATION_FACADE)},
    invariantcadDraftFacesAtomic: () => {
      throw new Error("not invoked");
    }
  };
}
`);

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      value as Uint8Array<ArrayBuffer>,
    ),
  );
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function browserAttestationManifest(
  javascript = browserAttestationJavascript,
  webassembly = browserAttestationWasm,
): Promise<Uint8Array> {
  const [javascriptSha256, webassemblySha256, lockSha256, patchSha256, buildSha256] =
    await Promise.all([
      sha256Hex(javascript),
      sha256Hex(webassembly),
      sha256Hex(new TextEncoder().encode("lock")),
      sha256Hex(new TextEncoder().encode("patch")),
      sha256Hex(new TextEncoder().encode("build")),
    ]);
  const patch = {
    path: "source/native/occt/patches/0001-test.patch",
    size: 1,
    sha256: patchSha256,
  };
  const manifest = {
    schemaVersion: 1,
    bundle: {
      name: "invariantcad-occt-facade",
      version: "0.2.0",
      layoutVersion: 1,
    },
    facade: {
      marker: BROWSER_ATTESTATION_FACADE,
      abiVersion: "0.2.0",
      upstreamOcctWasmVersion: "3.7.0",
    },
    runtime: [
      {
        path: "runtime/occt-wasm.js",
        mediaType: "text/javascript",
        size: javascript.byteLength,
        sha256: javascriptSha256,
      },
      {
        path: "runtime/occt-wasm.wasm",
        mediaType: "application/wasm",
        size: webassembly.byteLength,
        sha256: webassemblySha256,
      },
    ],
    source: {
      lockPath: "source/native/occt/upstream.lock.json",
      buildScriptPath: "source/scripts/build-occt-facade.sh",
      patches: [patch],
      relinkInstructionsPath: "SOURCE_AND_RELINK.md",
      materials: [
        {
          path: "source/native/occt/upstream.lock.json",
          role: "source-lock",
          size: 1,
          sha256: lockSha256,
        },
        {
          path: patch.path,
          role: "source-patch",
          size: patch.size,
          sha256: patch.sha256,
        },
        {
          path: "source/scripts/build-occt-facade.sh",
          role: "build-script",
          size: 1,
          sha256: buildSha256,
        },
      ],
    },
    integrity: {
      algorithm: "SHA-256",
      manifestPath: "SHA256SUMS",
      coverage: "all regular bundle files except SHA256SUMS",
    },
  };
  return new TextEncoder().encode(
    `${JSON.stringify(manifest, undefined, 2)}\n`,
  );
}

async function executeBrowserRuntimeAttestationGate(): Promise<
  Omit<
    BrowserSmokeResult["runtimeAttestation"],
    "blobUrlsCreated" | "blobUrlsRevoked" | "blobUrlsOutstanding"
  >
> {
  delete (globalThis as Record<string, unknown>)[BROWSER_ATTESTATION_STATE];
  const releaseManifest = await browserAttestationManifest();
  const expectedReleaseManifestSha256 = await sha256Hex(releaseManifest);
  const runtimePromise = loadAttestedOcctRuntime({
    releaseManifest,
    expectedReleaseManifestSha256,
    javascript: browserAttestationJavascript,
    webassembly: browserAttestationWasm,
  });
  releaseManifest.fill(0);
  const runtime = await runtimePromise;
  const kernel = await createOcctKernel({ attestedRuntime: runtime });
  const topologyFingerprint =
    kernel.capabilities.topology?.signatures?.fingerprint;
  if (topologyFingerprint === undefined) {
    kernel.dispose();
    throw new Error("Attested browser runtime omitted topology signatures");
  }
  const draftAdvertised = kernel.draft instanceof Function;
  const shapeArtifactsAbsent =
    kernel.capabilities.shapeArtifacts === undefined &&
    !("encodeShapeArtifact" in kernel) &&
    !("decodeShapeArtifact" in kernel);
  kernel.dispose();

  const beforeTamper = (
    globalThis as Record<string, unknown>
  )[BROWSER_ATTESTATION_STATE] as BrowserAttestationState;
  const importsBeforeTamper = beforeTamper.imports;
  const tamperedJavascript = browserAttestationJavascript.slice();
  tamperedJavascript[0] = tamperedJavascript[0]! ^ 1;
  let tamperReason: OcctRuntimeAttestationFailureReason | undefined;
  try {
    const untamperedManifest = await browserAttestationManifest();
    await loadAttestedOcctRuntime({
      releaseManifest: untamperedManifest,
      expectedReleaseManifestSha256: await sha256Hex(untamperedManifest),
      javascript: tamperedJavascript,
      webassembly: browserAttestationWasm,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      typeof error.reason === "string"
    ) {
      tamperReason = error.reason as OcctRuntimeAttestationFailureReason;
    } else {
      throw error;
    }
  }
  if (tamperReason === undefined) {
    throw new Error("Tampered browser JavaScript was accepted");
  }
  const importsAfterTamper = (
    (
      globalThis as Record<string, unknown>
    )[BROWSER_ATTESTATION_STATE] as BrowserAttestationState
  ).imports;

  const invalidJavascript = new TextEncoder().encode(
    `throw new Proxy({}, {
  getPrototypeOf() {
    throw new Error("import rejection prototype trap must not run");
  }
});
export default function unreachable() {}
`,
  );
  const invalidManifest =
    await browserAttestationManifest(invalidJavascript);
  let importFailureReason: OcctRuntimeAttestationFailureReason | undefined;
  try {
    await loadAttestedOcctRuntime({
      releaseManifest: invalidManifest,
      expectedReleaseManifestSha256: await sha256Hex(invalidManifest),
      javascript: invalidJavascript,
      webassembly: browserAttestationWasm,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      typeof error.reason === "string"
    ) {
      importFailureReason =
        error.reason as OcctRuntimeAttestationFailureReason;
    } else {
      throw error;
    }
  }
  if (importFailureReason === undefined) {
    throw new Error("Invalid verified browser JavaScript was accepted");
  }

  const recoveryManifest = await browserAttestationManifest();
  const recoveredRuntime = await loadAttestedOcctRuntime({
    releaseManifest: recoveryManifest,
    expectedReleaseManifestSha256: await sha256Hex(recoveryManifest),
    javascript: browserAttestationJavascript,
    webassembly: browserAttestationWasm,
  });
  const recoveredKernel = await createOcctKernel({
    attestedRuntime: recoveredRuntime,
  });
  recoveredKernel.dispose();

  const finalState = (
    globalThis as Record<string, unknown>
  )[BROWSER_ATTESTATION_STATE] as BrowserAttestationState;
  return {
    runtimePairIdentity: runtime.attestation.runtimePairIdentity,
    declaredBuildIdentity: runtime.attestation.declaredBuildIdentity,
    imports: finalState.imports,
    factories: finalState.factories,
    constructed: finalState.constructed,
    disposed: finalState.disposed,
    exactWasmReceived: finalState.exactWasmReceived,
    draftAdvertised,
    shapeArtifactsAbsent,
    topologyFingerprint,
    tamperReason,
    tamperExecutedJavaScript: importsAfterTamper !== importsBeforeTamper,
    importFailureReason,
    recoverySameIdentity:
      recoveredRuntime.attestation.runtimePairIdentity ===
      runtime.attestation.runtimePairIdentity,
  };
}

async function runBrowserRuntimeAttestationGate(): Promise<
  BrowserSmokeResult["runtimeAttestation"]
> {
  const createObjectUrl = URL.createObjectURL;
  const revokeObjectUrl = URL.revokeObjectURL;
  const activeUrls = new Set<string>();
  let blobUrlsCreated = 0;
  let blobUrlsRevoked = 0;
  URL.createObjectURL = (object: Blob | MediaSource): string => {
    const url = Reflect.apply(createObjectUrl, URL, [object]) as string;
    blobUrlsCreated += 1;
    activeUrls.add(url);
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    blobUrlsRevoked += 1;
    activeUrls.delete(url);
    Reflect.apply(revokeObjectUrl, URL, [url]);
    throw new Error(
      "caller-controlled URL.revokeObjectURL failure must not mask the load",
    );
  };
  try {
    const result = await executeBrowserRuntimeAttestationGate();
    return {
      ...result,
      blobUrlsCreated,
      blobUrlsRevoked,
      blobUrlsOutstanding: activeUrls.size,
    };
  } finally {
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;
  }
}

function workerFailure(error: {
  readonly name: string;
  readonly message: string;
}): Error {
  const failure = new Error(error.message);
  failure.name = error.name;
  return failure;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function parseArtifactWorkerResponse(
  value: unknown,
): ArtifactWorkerResponse {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new TypeError("Artifact worker returned a malformed response");
  }
  if (value.kind === "started") {
    if (
      !hasExactKeys(value, ["kind", "operation"]) ||
      (value.operation !== "decode" && value.operation !== "hang")
    ) {
      throw new TypeError("Artifact worker returned a malformed start event");
    }
    return value as unknown as ArtifactWorkerResponse;
  }
  if (value.kind === "failure") {
    if (
      !hasExactKeys(value, ["kind", "error"]) ||
      !isRecord(value.error) ||
      !hasExactKeys(value.error, ["name", "message"]) ||
      typeof value.error.name !== "string" ||
      value.error.name.length === 0 ||
      typeof value.error.message !== "string" ||
      value.error.message.length === 0
    ) {
      throw new TypeError("Artifact worker returned a malformed failure");
    }
    return value as unknown as ArtifactWorkerResponse;
  }
  if (value.kind === "success") {
    const evidence = value.evidence;
    if (
      !hasExactKeys(value, ["kind", "evidence"]) ||
      !isRecord(evidence) ||
      !hasExactKeys(evidence, [
        "volume",
        "faces",
        "edges",
        "vertices",
        "protocolVersion",
        "format",
        "formatVersion",
        "compatibilityFingerprint",
        "inputBytesPreserved",
      ]) ||
      typeof evidence.volume !== "number" ||
      !Number.isFinite(evidence.volume) ||
      typeof evidence.faces !== "number" ||
      !Number.isSafeInteger(evidence.faces) ||
      typeof evidence.edges !== "number" ||
      !Number.isSafeInteger(evidence.edges) ||
      typeof evidence.vertices !== "number" ||
      !Number.isSafeInteger(evidence.vertices) ||
      typeof evidence.protocolVersion !== "number" ||
      !Number.isSafeInteger(evidence.protocolVersion) ||
      typeof evidence.format !== "string" ||
      typeof evidence.formatVersion !== "number" ||
      !Number.isSafeInteger(evidence.formatVersion) ||
      typeof evidence.compatibilityFingerprint !== "string" ||
      evidence.inputBytesPreserved !== true
    ) {
      throw new TypeError("Artifact worker returned malformed success evidence");
    }
    return value as unknown as ArtifactWorkerResponse;
  }
  throw new TypeError("Artifact worker returned an unknown response");
}

function startArtifactWorker(
  request: ArtifactWorkerRequest,
  transfer: readonly Transferable[],
  onStarted: (() => void) | undefined,
  onPosted: (() => void) | undefined,
): DisposableWorkerOperationHandle<ArtifactWorkerEvidence> {
  const worker = new Worker(
    new URL("./artifact.worker.ts", import.meta.url),
    { type: "module" },
  );
  const result = new Promise<ArtifactWorkerEvidence>((resolve, reject) => {
    let phase: "awaiting-start" | "awaiting-result" | "settled" =
      "awaiting-start";
    const rejectOnce = (error: unknown): void => {
      if (phase === "settled") return;
      phase = "settled";
      reject(error);
    };
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      let response: ArtifactWorkerResponse;
      try {
        response = parseArtifactWorkerResponse(event.data);
      } catch (error) {
        rejectOnce(error);
        return;
      }
      if (response.kind === "started") {
        if (
          phase !== "awaiting-start" ||
          response.operation !== request.kind
        ) {
          rejectOnce(new Error("Artifact worker start event was inconsistent"));
          return;
        }
        phase = "awaiting-result";
        onStarted?.();
        return;
      }
      if (phase !== "awaiting-result") {
        rejectOnce(new Error("Artifact worker returned a result before starting"));
        return;
      }
      phase = "settled";
      if (response.kind === "failure") {
        reject(workerFailure(response.error));
        return;
      }
      resolve(response.evidence);
    });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      rejectOnce(new Error(event.message || "Artifact worker failed"));
    });
    worker.addEventListener("messageerror", () => {
      rejectOnce(
        new TypeError("Artifact worker response could not be cloned"),
      );
    });
    try {
      worker.postMessage(request, [...transfer]);
      onPosted?.();
    } catch (error) {
      rejectOnce(error);
    }
  });
  return {
    result,
    terminate: () => worker.terminate(),
  };
}

async function runArtifactWorkerGate(): Promise<
  BrowserSmokeResult["artifactWorker"]
> {
  const fixture = decodeFixtureBase64(artifactFixtureBase64);
  const fixtureSnapshot = fixture.slice();
  const workerCounts = { created: 0, terminated: 0 };
  const readWorkerCounts = (): {
    readonly created: number;
    readonly terminated: number;
  } => ({ ...workerCounts });

  const start = (
    request: ArtifactWorkerRequest,
    transfer: readonly Transferable[] = [],
    onStarted?: () => void,
    onPosted?: () => void,
  ): DisposableWorkerOperationHandle<ArtifactWorkerEvidence> => {
    workerCounts.created += 1;
    const handle = startArtifactWorker(
      request,
      transfer,
      onStarted,
      onPosted,
    );
    return {
      result: handle.result,
      terminate: () => {
        workerCounts.terminated += 1;
        return handle.terminate();
      },
    };
  };

  const preAbortController = new AbortController();
  preAbortController.abort();
  let preAbortError: unknown;
  try {
    await runDisposableWorkerOperation(
      () => start({ kind: "hang" }),
      { timeoutMs: 5_000, signal: preAbortController.signal },
    );
  } catch (error) {
    preAbortError = error;
  }
  if (
    !(preAbortError instanceof DOMException) ||
    preAbortError.name !== "AbortError" ||
    workerCounts.created !== 0
  ) {
    throw new Error(
      "A pre-aborted artifact operation must fail without creating a worker",
    );
  }

  const hangTimeoutMs = 5_000;
  let hangStarted = false;
  let timeoutError: unknown;
  try {
    await runDisposableWorkerOperation(
      () =>
        start(
          { kind: "hang" },
          [],
          () => {
            hangStarted = true;
          },
        ),
      { timeoutMs: hangTimeoutMs },
    );
  } catch (error) {
    timeoutError = error;
  }
  if (
    !(timeoutError instanceof DisposableWorkerOperationTimeoutError) ||
    timeoutError.timeoutMs !== hangTimeoutMs ||
    !hangStarted
  ) {
    throw new Error(
      "A started non-yielding artifact worker must be terminated by its deadline",
    );
  }

  const transferableFixture = copyToArrayBuffer(fixture);
  let transferDetached = false;
  const recovery = await runDisposableWorkerOperation(
    () =>
      start(
        { kind: "decode", artifact: transferableFixture },
        [transferableFixture],
        undefined,
        () => {
          transferDetached = transferableFixture.byteLength === 0;
        },
      ),
    { timeoutMs: 60_000 },
  );
  const sourceBytesPreserved = sameBytes(fixture, fixtureSnapshot);
  if (!sourceBytesPreserved) {
    throw new Error("Transferring the fixture copy mutated its retained source");
  }
  if (!transferDetached) {
    throw new Error("The artifact worker did not take the transfer copy");
  }
  const finalWorkerCounts = readWorkerCounts();
  if (
    finalWorkerCounts.created !== 2 ||
    finalWorkerCounts.terminated !== 2
  ) {
    throw new Error("Every created artifact worker must be terminated exactly once");
  }

  return {
    fixture: {
      byteLength: fixture.byteLength,
      sourceBytesPreserved,
      transferDetached,
    },
    preAbort: {
      name: preAbortError.name,
      workerCreations: 0,
    },
    timeout: {
      name: timeoutError.name,
      timeoutMs: timeoutError.timeoutMs,
      started: hangStarted,
    },
    recovery,
    workersCreated: finalWorkerCounts.created,
    workersTerminated: finalWorkerCounts.terminated,
  };
}

async function verifyCrossRealmWasmUrlCapture(): Promise<boolean> {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  document.body.append(frame);
  try {
    const foreignWindow = frame.contentWindow as
      | (Window & { readonly URL: typeof URL })
      | null;
    const foreignUrlConstructor = foreignWindow?.URL;
    if (foreignUrlConstructor === undefined) {
      throw new Error("The browser did not expose an iframe URL realm");
    }
    const foreignWasmUrl = new foreignUrlConstructor(
      stockOcctWasmUrl,
      window.location.href,
    ) as unknown as {
      href: string;
      pathname: string;
    };
    if (foreignWasmUrl instanceof URL) {
      throw new Error("The WASM URL was not created in a distinct realm");
    }
    const originalHref = foreignWasmUrl.href;
    const kernelPromise = createOcctKernel({
      wasm: foreignWasmUrl as unknown as URL,
    });
    foreignWasmUrl.pathname = "/mutated-after-kernel-start.wasm";
    const kernel = await kernelPromise;
    try {
      if (
        foreignWasmUrl.href === originalHref ||
        kernel.capabilities.topology?.signatures !== undefined
      ) {
        throw new Error(
          "An explicit cross-realm runtime source was not captured as custom",
        );
      }
      return true;
    } finally {
      kernel.dispose();
    }
  } finally {
    frame.remove();
  }
}

async function runBrowserSmoke(): Promise<BrowserSmokeResult> {
  const document = browserSmokeDocument();
  const manifoldEvaluator = await createEvaluator();

  let manifold: BrowserSmokeResult["manifold"];
  try {
    const result = await manifoldEvaluator.evaluate(document);
    if (!result.ok) {
      throw new Error(diagnosticMessage(result.diagnostics));
    }
    try {
      const output = result.value.output("box");
      const mesh = output.mesh();
      const stl = output.export("stl");
      if (!(stl instanceof Uint8Array)) {
        throw new TypeError("Binary STL export did not return bytes");
      }
      manifold = {
        volume: output.measure().volume,
        triangles: mesh.indices.length / 3,
        stlBytes: stl.byteLength,
      };
    } finally {
      result.value.dispose();
    }
  } finally {
    manifoldEvaluator.dispose();
  }

  const crossRealmWasmUrlCaptured =
    await verifyCrossRealmWasmUrlCapture();
  const occtKernel = await createOcctKernel();
  const occtEvaluator = await createEvaluator({ kernel: occtKernel });
  let occt: BrowserSmokeResult["occt"];
  try {
    const result = await occtEvaluator.evaluate(document);
    if (!result.ok) {
      throw new Error(diagnosticMessage(result.diagnostics));
    }
    try {
      const output = result.value.output("box");
      if (!(output instanceof EvaluatedSolid)) {
        throw new TypeError("Expected the browser fixture output to be a solid");
      }
      const topology = output.topology();
      if (!topology.ok) {
        throw new Error(diagnosticMessage(topology.diagnostics));
      }
      const step = output.export("step");
      if (!(step instanceof Uint8Array)) {
        throw new TypeError("STEP export did not return bytes");
      }
      occt = {
        volume: output.measure().volume,
        faces: topology.value.faces.length,
        edges: topology.value.edges.length,
        vertices: topology.value.vertices.length,
        stepBytes: step.byteLength,
        crossRealmWasmUrlCaptured,
      };
    } finally {
      result.value.dispose();
    }
  } finally {
    occtEvaluator.dispose();
  }

  const artifactWorker = await runArtifactWorkerGate();
  const runtimeAttestation = await runBrowserRuntimeAttestationGate();
  return { manifold, occt, artifactWorker, runtimeAttestation };
}

const resultElement = document.querySelector("#result");
const smoke = runBrowserSmoke();
window.invariantCadBrowserSmoke = smoke;

void smoke.then(
  (result) => {
    document.body.dataset.status = "passed";
    if (resultElement !== null) {
      resultElement.textContent = JSON.stringify(result, undefined, 2);
    }
  },
  (error: unknown) => {
    document.body.dataset.status = "failed";
    if (resultElement !== null) {
      resultElement.textContent =
        error instanceof Error ? error.stack ?? error.message : String(error);
    }
    console.error(error);
  },
);
