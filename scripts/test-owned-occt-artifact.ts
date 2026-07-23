import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
const expectedFacadeVersion = "invariantcad-facade@0.9.0+occt-wasm.3.7.0";
const expectedNativeRequestLimit = 128 * 1024 * 1024;
const expectedPreflightWorkLimit = 1_000_000;
const expectedPreflightNestingDepthLimit = 64;
const expectedPreflightLocationPowerLimit = 1_000_000;

interface NativeAllocationTelemetry {
  readonly operation: "read" | "write";
  readonly maxNativeRequestedBytes: number;
  readonly nativeRequestedBytes: number;
  readonly nativeAllocationCalls: number;
  readonly nativeRequestLimitExceeded: boolean;
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function captureNativeAllocationTelemetry(
  operation: NativeAllocationTelemetry["operation"],
  report: unknown,
): NativeAllocationTelemetry {
  assert.ok(isObject(report), `${operation} must return an object report`);
  const maxNativeRequestedBytes = nonNegativeSafeInteger(
    report.maxNativeRequestedBytes,
    `${operation}.maxNativeRequestedBytes`,
  );
  const nativeRequestedBytes = nonNegativeSafeInteger(
    report.nativeRequestedBytes,
    `${operation}.nativeRequestedBytes`,
  );
  const nativeAllocationCalls = nonNegativeSafeInteger(
    report.nativeAllocationCalls,
    `${operation}.nativeAllocationCalls`,
  );
  assert.equal(
    typeof report.nativeRequestLimitExceeded,
    "boolean",
    `${operation}.nativeRequestLimitExceeded must be boolean`,
  );
  assert.equal(maxNativeRequestedBytes, expectedNativeRequestLimit);
  assert.ok(nativeRequestedBytes > 0, `${operation} observed no native requests`);
  assert.ok(
    nativeRequestedBytes <= maxNativeRequestedBytes,
    `${operation} admitted native requests beyond its limit`,
  );
  assert.ok(nativeAllocationCalls > 0, `${operation} observed no native allocations`);
  assert.equal(report.nativeRequestLimitExceeded, false);
  return Object.freeze({
    operation,
    maxNativeRequestedBytes,
    nativeRequestedBytes,
    nativeAllocationCalls,
    nativeRequestLimitExceeded: report.nativeRequestLimitExceeded,
  });
}

function assertSuccessfulReadPreflightTelemetry(report: unknown): void {
  assert.ok(isObject(report), "read must return an object report");
  const inputByteCount = nonNegativeSafeInteger(
    report.inputByteCount,
    "read.inputByteCount",
  );
  const maxPreflightWorkUnits = nonNegativeSafeInteger(
    report.maxPreflightWorkUnits,
    "read.maxPreflightWorkUnits",
  );
  const preflightWorkUnits = nonNegativeSafeInteger(
    report.preflightWorkUnits,
    "read.preflightWorkUnits",
  );
  const maxPreflightNestingDepth = nonNegativeSafeInteger(
    report.maxPreflightNestingDepth,
    "read.maxPreflightNestingDepth",
  );
  const preflightMaximumDepth = nonNegativeSafeInteger(
    report.preflightMaximumDepth,
    "read.preflightMaximumDepth",
  );
  const maxPreflightLocationPower = nonNegativeSafeInteger(
    report.maxPreflightLocationPower,
    "read.maxPreflightLocationPower",
  );
  const preflightMaximumLocationPower = nonNegativeSafeInteger(
    report.preflightMaximumLocationPower,
    "read.preflightMaximumLocationPower",
  );
  const preflightConsumedByteCount = nonNegativeSafeInteger(
    report.preflightConsumedByteCount,
    "read.preflightConsumedByteCount",
  );
  assert.equal(maxPreflightWorkUnits, expectedPreflightWorkLimit);
  assert.ok(preflightWorkUnits > 0);
  assert.ok(preflightWorkUnits <= maxPreflightWorkUnits);
  assert.equal(
    maxPreflightNestingDepth,
    expectedPreflightNestingDepthLimit,
  );
  assert.ok(preflightMaximumDepth > 0);
  assert.ok(preflightMaximumDepth <= maxPreflightNestingDepth);
  assert.equal(
    maxPreflightLocationPower,
    expectedPreflightLocationPowerLimit,
  );
  assert.ok(preflightMaximumLocationPower <= maxPreflightLocationPower);
  assert.equal(preflightConsumedByteCount, inputByteCount);
  assert.equal(report.preflightCode, "OK");
  assert.equal(report.archivePreflightComplete, true);
  assert.equal(report.deserializationStarted, true);
}

function runTinyQuotaChild(directory: string): void {
  const childPath = fileURLToPath(
    new URL("./test-owned-occt-artifact-quota-child.ts", import.meta.url),
  );
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", childPath, "--runtime-dir", directory],
    {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(
    child.error,
    undefined,
    child.error === undefined
      ? undefined
      : `tiny-quota child failed to start: ${child.error.message}`,
  );
  assert.equal(
    child.status,
    0,
    `tiny-quota child failed with status ${String(child.status)} and signal ${String(child.signal)}\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`,
  );
  assert.match(
    child.stdout,
    /owned OCCT artifact tiny native request quotas denied and recovered/,
  );
}

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
const nativeAllocationTelemetry: NativeAllocationTelemetry[] = [];
const moduleFactory: OcctModuleFactory = async (options) => {
  const module = await loaded.default(options);
  if (typeof module !== "object" || module === null) {
    throw new TypeError("Owned OCCT facade factory returned a non-object module");
  }
  const candidate = module as Record<string, unknown>;
  assert.equal(
    (candidate.invariantcadFacadeVersion as () => unknown)(),
    expectedFacadeVersion,
  );
  assert.equal(typeof candidate.invariantcadWriteArtifactBrep, "function");
  assert.equal(typeof candidate.invariantcadReadArtifactBrep, "function");

  const writeArtifact = candidate.invariantcadWriteArtifactBrep as (
    ...arguments_: unknown[]
  ) => unknown;
  const readArtifact = candidate.invariantcadReadArtifactBrep as (
    ...arguments_: unknown[]
  ) => unknown;
  candidate.invariantcadWriteArtifactBrep = (...arguments_: unknown[]) => {
    assert.equal(arguments_.length, 4);
    assert.equal(arguments_[3], expectedNativeRequestLimit);
    const report = Reflect.apply(writeArtifact, candidate, arguments_);
    try {
      nativeAllocationTelemetry.push(
        captureNativeAllocationTelemetry("write", report),
      );
    } catch (error) {
      if (isObject(report) && typeof report.delete === "function") {
        report.delete();
      }
      throw error;
    }
    return report;
  };
  candidate.invariantcadReadArtifactBrep = (...arguments_: unknown[]) => {
    assert.equal(arguments_.length, 8);
    assert.equal(arguments_[4], expectedNativeRequestLimit);
    assert.equal(arguments_[5], expectedPreflightWorkLimit);
    assert.equal(arguments_[6], expectedPreflightNestingDepthLimit);
    assert.equal(arguments_[7], expectedPreflightLocationPowerLimit);
    const report = Reflect.apply(readArtifact, candidate, arguments_);
    try {
      nativeAllocationTelemetry.push(
        captureNativeAllocationTelemetry("read", report),
      );
      assertSuccessfulReadPreflightTelemetry(report);
    } catch (error) {
      if (isObject(report) && typeof report.delete === "function") {
        report.delete();
      }
      throw error;
    }
    return report;
  };

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
    /nativeRequestLimitBytes=134217728/,
  );
  assert.match(
    producerCodec.capabilities.compatibilityFingerprint,
    /nativeRequestAccounting=scoped-cumulative-reviewed-entrypoints-v1/,
  );
  assert.match(
    producerCodec.capabilities.compatibilityFingerprint,
    /nativeArchivePreflight=invariantcad-bintools-v4-owned-profile@1/,
  );
  assert.match(
    producerCodec.capabilities.compatibilityFingerprint,
    /nativeArchivePreflightWorkUnits=1000000/,
  );
  assert.match(
    producerCodec.capabilities.compatibilityFingerprint,
    /nativeArchivePreflightNestingDepth=64/,
  );
  assert.match(
    producerCodec.capabilities.compatibilityFingerprint,
    /nativeArchivePreflightLocationPower=1000000/,
  );
  assert.match(
    producerCodec.capabilities.compatibilityFingerprint,
    /nativeArchivePreflightAccounting=quota-accounted-metadata-cursor-expanded-topology-geometry-pair-work-v1/,
  );
  assert.match(
    producerCodec.capabilities.compatibilityFingerprint,
    /nativeMaterialization=facade-capped-output-bounded-input-preflighted-cumulative-native-requests-v3/,
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
  const reencoded = consumerCodec.encodeShapeArtifact(restored, {
    feature: "owned-artifact-round-trip",
    maxArtifactBytes: 16 * 1024 * 1024,
  });
  assert.deepEqual(
    reencoded,
    artifact,
    "The owned runtime must re-encode restored v3 artifact state byte-for-byte",
  );
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
  assert.deepEqual(
    nativeAllocationTelemetry.map(({ operation }) => operation),
    ["write", "read", "write"],
  );
} finally {
  if (restored !== undefined) consumer.disposeShape(restored);
  if (source !== undefined) producer.disposeShape(source);
  consumer.dispose();
  producer.dispose();
}

runTinyQuotaChild(directory);
process.stdout.write(
  "owned bounded OCCT artifact candidate and isolated native quota denial passed\n",
);
