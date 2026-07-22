import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectKernelShapeArtifactSupport } from "../src/artifact-cache.js";
import { getOcctShapeArtifactCodecCandidate } from "../src/internal/occt-artifact-candidate.js";
import {
  createOcctKernel,
  type OcctModuleFactory,
} from "../src/occt-kernel.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function runtimeDirectory(arguments_: readonly string[]): string {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (values.length === 0) {
    return resolve(projectRoot, ".artifacts/occt-facade");
  }
  if (
    values.length === 2 &&
    values[0] === "--runtime-dir" &&
    values[1] !== undefined
  ) {
    return resolve(values[1]);
  }
  throw new Error(
    "Usage: tsx scripts/test-owned-occt-artifact.ts [--runtime-dir DIRECTORY]",
  );
}

const directory = runtimeDirectory(process.argv.slice(2));
const gluePath = resolve(directory, "occt-wasm.js");
const wasmPath = resolve(directory, "occt-wasm.wasm");
await Promise.all([access(gluePath), access(wasmPath)]);
const loaded = (await import(pathToFileURL(gluePath).href)) as {
  readonly default: OcctModuleFactory;
};

let legacyReadCount = 0;
let legacyWriteCount = 0;
const moduleFactory: OcctModuleFactory = async (options) => {
  const module = await loaded.default(options);
  if (typeof module !== "object" || module === null) {
    throw new TypeError("Owned OCCT facade factory returned a non-object module");
  }
  const candidate = module as Record<string, unknown>;
  assert.equal(
    (candidate.invariantcadFacadeVersion as () => unknown)(),
    "invariantcad-facade@0.7.0+occt-wasm.3.7.0",
  );
  assert.equal(typeof candidate.invariantcadWriteArtifactBrep, "function");
  assert.equal(typeof candidate.invariantcadReadArtifactBrep, "function");

  const fileSystem = candidate.FS as {
    readFile(path: string, options?: unknown): unknown;
    writeFile(path: string, data: unknown, options?: unknown): unknown;
  };
  const readFile = fileSystem.readFile.bind(fileSystem);
  const writeFile = fileSystem.writeFile.bind(fileSystem);
  fileSystem.readFile = (path, fsOptions) => {
    if (path === "/tmp/export.brep.bin") {
      legacyWriteCount += 1;
      throw new Error("legacy binary BREP writer was invoked");
    }
    return readFile(path, fsOptions);
  };
  fileSystem.writeFile = (path, data, fsOptions) => {
    if (path === "/tmp/occt-import.brep.bin") {
      legacyReadCount += 1;
      throw new Error("legacy binary BREP reader was invoked");
    }
    return writeFile(path, data, fsOptions);
  };
  return module;
};

const producer = await createOcctKernel({ moduleFactory, wasm: wasmPath });
const consumer = await createOcctKernel({ moduleFactory, wasm: wasmPath });
let source: ReturnType<NonNullable<typeof producer.box>> | undefined;
let restored: ReturnType<NonNullable<typeof consumer.box>> | undefined;
try {
  assert.equal(inspectKernelShapeArtifactSupport(producer).status, "absent");
  assert.equal(inspectKernelShapeArtifactSupport(consumer).status, "absent");
  const producerCodec = getOcctShapeArtifactCodecCandidate(producer);
  const consumerCodec = getOcctShapeArtifactCodecCandidate(consumer);
  assert.ok(producerCodec);
  assert.ok(consumerCodec);
  assert.equal(
    producerCodec.capabilities.compatibilityFingerprint,
    consumerCodec.capabilities.compatibilityFingerprint,
  );
  assert.match(
    producerCodec.capabilities.compatibilityFingerprint,
    /nativeMaterialization=facade-capped-output-bounded-input-snapshot-v1/,
  );

  source = producer.box?.([2, 3, 5], false, { feature: "owned-artifact-box" });
  assert.ok(source);
  const sourceTopology = producer.topology?.(source);
  assert.ok(sourceTopology);
  const artifact = producerCodec.encodeShapeArtifact(source, {
    feature: "owned-artifact-round-trip",
    maxArtifactBytes: 16 * 1024 * 1024,
  });
  restored = consumerCodec.decodeShapeArtifact(artifact, {
    feature: "owned-artifact-round-trip",
    maxArtifactBytes: 16 * 1024 * 1024,
  }) as typeof restored;
  assert.ok(restored);
  assert.deepEqual(consumer.measure(restored), producer.measure(source));
  const restoredTopology = consumer.topology?.(restored);
  assert.ok(restoredTopology);
  assert.deepEqual(
    {
      faces: restoredTopology.faces.length,
      edges: restoredTopology.edges.length,
      vertices: restoredTopology.vertices.length,
    },
    {
      faces: sourceTopology.faces.length,
      edges: sourceTopology.edges.length,
      vertices: sourceTopology.vertices.length,
    },
  );
  const sourceKeys = new Set([
    ...sourceTopology.faces,
    ...sourceTopology.edges,
    ...sourceTopology.vertices,
  ].map(({ key }) => key));
  for (const { key } of [
    ...restoredTopology.faces,
    ...restoredTopology.edges,
    ...restoredTopology.vertices,
  ]) {
    assert.equal(sourceKeys.has(key), false);
  }
  assert.equal(legacyWriteCount, 0);
  assert.equal(legacyReadCount, 0);
} finally {
  if (restored !== undefined) consumer.disposeShape(restored);
  if (source !== undefined) producer.disposeShape(source);
  consumer.dispose();
  producer.dispose();
}

process.stdout.write("owned bounded OCCT artifact candidate passed\n");
