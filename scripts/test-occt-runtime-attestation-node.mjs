#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  loadAttestedOcctRuntime,
  OcctRuntimeAttestationError,
} from "../dist/occt-runtime-node.js";
import { createOcctKernel } from "../dist/occt-kernel.js";

const STATE_KEY = "__invariantCadNodeAttestationGate";
const FACADE_MARKER = "invariantcad-facade@0.2.0+occt-wasm.3.7.0";
const EXPECTED_RUNTIME_PAIR_IDENTITY =
  "invariantcad-occt-runtime-pair@1:sha256:722b07c01b7260f4b10c06e85aab4c5f7e4189b95d374e425104e687559bd822";
const encoder = new TextEncoder();
const webassembly = new Uint8Array([9, 8, 7, 6]);
const javascript = encoder.encode(`
const state = globalThis.${STATE_KEY} ??= {
  imports: 0,
  factories: 0,
  constructed: 0,
  disposed: 0,
  wasmBuffers: []
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
  if (
    bytes.length !== 4 ||
    bytes[0] !== 9 ||
    bytes[1] !== 8 ||
    bytes[2] !== 7 ||
    bytes[3] !== 6
  ) {
    throw new Error("factory did not receive exact verified WASM");
  }
  state.wasmBuffers.push(options.wasmBinary);
  return {
    OcctKernel: MinimalRawKernel,
    VectorUint32: class {},
    InvariantCadDraftReport: class {},
    InvariantCadTopologyKind: topologyKind,
    InvariantCadTopologyRelation: topologyRelation,
    invariantcadFacadeVersion: () => ${JSON.stringify(FACADE_MARKER)},
    invariantcadDraftFacesAtomic: () => {
      throw new Error("not invoked");
    }
  };
}
`);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function manifestBytes(
  runtimeJavascript = javascript,
  runtimeWebassembly = webassembly,
) {
  const patch = {
    path: "source/native/occt/patches/0001-test.patch",
    size: 1,
    sha256: digest("patch"),
  };
  const manifest = {
    schemaVersion: 1,
    bundle: {
      name: "invariantcad-occt-facade",
      version: "0.2.0",
      layoutVersion: 1,
    },
    facade: {
      marker: FACADE_MARKER,
      abiVersion: "0.2.0",
      upstreamOcctWasmVersion: "3.7.0",
    },
    runtime: [
      {
        path: "runtime/occt-wasm.js",
        mediaType: "text/javascript",
        size: runtimeJavascript.byteLength,
        sha256: digest(runtimeJavascript),
      },
      {
        path: "runtime/occt-wasm.wasm",
        mediaType: "application/wasm",
        size: runtimeWebassembly.byteLength,
        sha256: digest(runtimeWebassembly),
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
          sha256: digest("lock"),
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
          sha256: digest("build"),
        },
      ],
    },
    integrity: {
      algorithm: "SHA-256",
      manifestPath: "SHA256SUMS",
      coverage: "all regular bundle files except SHA256SUMS",
    },
  };
  return encoder.encode(`${JSON.stringify(manifest, undefined, 2)}\n`);
}

const releaseManifest = manifestBytes();
const options = {
  releaseManifest,
  expectedReleaseManifestSha256: digest(releaseManifest),
  javascript,
  webassembly,
};

const [firstRuntime, secondRuntime] = await Promise.all([
  loadAttestedOcctRuntime(options),
  loadAttestedOcctRuntime(options),
]);
assert.equal(
  firstRuntime.attestation.runtimePairIdentity,
  secondRuntime.attestation.runtimePairIdentity,
);
assert.equal(
  firstRuntime.attestation.runtimePairIdentity,
  EXPECTED_RUNTIME_PAIR_IDENTITY,
  "Runtime-pair protocol v1 identity changed",
);
assert.equal(globalThis[STATE_KEY].imports, 2);

const firstKernel = await createOcctKernel({
  attestedRuntime: firstRuntime,
});
const secondKernel = await createOcctKernel({
  attestedRuntime: secondRuntime,
});
try {
  assert.equal(firstKernel.draft instanceof Function, true);
  assert.equal(secondKernel.draft instanceof Function, true);
  assert.equal(firstKernel.capabilities.shapeArtifacts, undefined);
  assert.equal(globalThis[STATE_KEY].factories, 2);
  assert.equal(globalThis[STATE_KEY].constructed, 2);
  assert.notEqual(
    globalThis[STATE_KEY].wasmBuffers[0],
    globalThis[STATE_KEY].wasmBuffers[1],
  );
  assert.deepEqual(
    [...new Uint8Array(globalThis[STATE_KEY].wasmBuffers[0])],
    [...webassembly],
  );
} finally {
  secondKernel.dispose();
  firstKernel.dispose();
}
assert.equal(globalThis[STATE_KEY].disposed, 2);

const invalidJavascript = encoder.encode("export default function (\n");
const invalidManifest = manifestBytes(invalidJavascript, webassembly);
const invalidLoad = loadAttestedOcctRuntime({
  releaseManifest: invalidManifest,
  expectedReleaseManifestSha256: digest(invalidManifest),
  javascript: invalidJavascript,
  webassembly,
});
const concurrentValidLoad = loadAttestedOcctRuntime(options);
await assert.rejects(
  invalidLoad,
  (error) =>
    error instanceof OcctRuntimeAttestationError &&
    error.reason === "module-import-failed",
  "Invalid verified JavaScript must fail at the public Node import boundary",
);
const concurrentRuntime = await concurrentValidLoad;
assert.equal(
  concurrentRuntime.attestation.runtimePairIdentity,
  EXPECTED_RUNTIME_PAIR_IDENTITY,
  "A concurrent failed hook load must not cross-wire the valid runtime",
);
const concurrentKernel = await createOcctKernel({
  attestedRuntime: concurrentRuntime,
});
concurrentKernel.dispose();

const recoveredRuntime = await loadAttestedOcctRuntime(options);
const recoveredKernel = await createOcctKernel({
  attestedRuntime: recoveredRuntime,
});
recoveredKernel.dispose();
assert.equal(
  globalThis[STATE_KEY].imports,
  4,
  "A failed module import must release hook state and permit fresh recovery",
);
assert.equal(globalThis[STATE_KEY].factories, 4);
assert.equal(globalThis[STATE_KEY].constructed, 4);
assert.equal(globalThis[STATE_KEY].disposed, 4);

const tamperedJavascript = javascript.slice();
tamperedJavascript[0] ^= 1;
await assert.rejects(
  loadAttestedOcctRuntime({
    ...options,
    javascript: tamperedJavascript,
  }),
  (error) =>
    error instanceof OcctRuntimeAttestationError &&
    error.reason === "javascript-digest-mismatch",
);
assert.equal(globalThis[STATE_KEY].imports, 4);

process.stdout.write(
  `[occt-runtime-attestation-node] verified ${firstRuntime.attestation.runtimePairIdentity}\n`,
);
