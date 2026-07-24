import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { OcctModuleFactory } from "../src/occt-kernel.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedFacadeVersion = "invariantcad-facade@0.9.0+occt-wasm.3.8.0";
const tinyNativeRequestLimit = 1;
const recoveryNativeRequestLimit = 128 * 1024 * 1024;
const preflightWorkLimit = 1_000_000;
const preflightNestingDepthLimit = 64;
const preflightLocationPowerLimit = 1_000_000;

interface ArtifactWriteReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly maxOutputBytes: unknown;
  readonly maxNativeRequestedBytes: unknown;
  readonly nativeRequestedBytes: unknown;
  readonly nativeAllocationCalls: unknown;
  readonly nativeRequestLimitExceeded: unknown;
  hasBytes(): unknown;
  byteCount(): unknown;
  copyBytes(): unknown;
  delete(): void;
}

interface ArtifactReadReport {
  readonly ok: unknown;
  readonly stage: unknown;
  readonly code: unknown;
  readonly maxNativeRequestedBytes: unknown;
  readonly nativeRequestedBytes: unknown;
  readonly nativeAllocationCalls: unknown;
  readonly nativeRequestLimitExceeded: unknown;
  readonly maxPreflightWorkUnits: unknown;
  readonly preflightWorkUnits: unknown;
  readonly maxPreflightNestingDepth: unknown;
  readonly preflightMaximumDepth: unknown;
  readonly maxPreflightLocationPower: unknown;
  readonly preflightMaximumLocationPower: unknown;
  readonly preflightConsumedByteCount: unknown;
  readonly preflightCode: unknown;
  readonly archivePreflightComplete: unknown;
  readonly deserializationStarted: unknown;
  hasResult(): unknown;
  transferCode(kernel: RawKernel): unknown;
  takeResultId(kernel: RawKernel): unknown;
  delete(): void;
}

interface RawKernel {
  makeBox(x: number, y: number, z: number): number;
  isValid(shapeId: number): boolean;
  release(shapeId: number): void;
  delete(): void;
}

interface OwnedArtifactModule {
  readonly OcctKernel: new () => RawKernel;
  invariantcadFacadeVersion(): unknown;
  invariantcadWriteArtifactBrep(
    kernel: RawKernel,
    shapeId: number,
    maxOutputBytes: number,
    maxNativeRequestedBytes: number,
  ): unknown;
  invariantcadReadArtifactBrep(
    kernel: RawKernel,
    input: Uint8Array,
    maxInputBytes: number,
    maxTopologyItems: number,
    maxNativeRequestedBytes: number,
    maxPreflightWorkUnits: number,
    maxPreflightNestingDepth: number,
    maxPreflightLocationPower: number,
  ): unknown;
}

function runtimeDirectory(arguments_: readonly string[]): string {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (
    values.length === 2 &&
    values[0] === "--runtime-dir" &&
    values[1] !== undefined
  ) {
    return resolve(values[1]);
  }
  throw new Error(
    "Usage: tsx scripts/test-owned-occt-artifact-quota-child.ts --runtime-dir DIRECTORY",
  );
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function assertWriteReport(value: unknown): asserts value is ArtifactWriteReport {
  assert.ok(isObject(value), "tiny-quota write must return an object report");
  assert.equal(typeof value.hasBytes, "function");
  assert.equal(typeof value.byteCount, "function");
  assert.equal(typeof value.copyBytes, "function");
  assert.equal(typeof value.delete, "function");
}

function assertReadReport(value: unknown): asserts value is ArtifactReadReport {
  assert.ok(isObject(value), "tiny-quota read must return an object report");
  assert.equal(typeof value.hasResult, "function");
  assert.equal(typeof value.transferCode, "function");
  assert.equal(typeof value.takeResultId, "function");
  assert.equal(typeof value.delete, "function");
}

function assertNativeRequestDenial(
  report: ArtifactWriteReport | ArtifactReadReport,
): void {
  assert.equal(report.ok, false);
  assert.equal(report.code, "NATIVE_REQUEST_LIMIT_EXCEEDED");
  assert.equal(report.maxNativeRequestedBytes, tinyNativeRequestLimit);
  assert.equal(report.nativeRequestLimitExceeded, true);
  assert.equal(typeof report.nativeRequestedBytes, "number");
  assert.ok(Number.isSafeInteger(report.nativeRequestedBytes));
  assert.ok(report.nativeRequestedBytes >= 0);
  assert.ok(report.nativeRequestedBytes <= tinyNativeRequestLimit);
  assert.equal(typeof report.nativeAllocationCalls, "number");
  assert.ok(Number.isSafeInteger(report.nativeAllocationCalls));
  assert.ok(report.nativeAllocationCalls > 0);
}

function assertPreflightLimits(report: ArtifactReadReport): void {
  assert.equal(report.maxPreflightWorkUnits, preflightWorkLimit);
  assert.equal(
    report.maxPreflightNestingDepth,
    preflightNestingDepthLimit,
  );
  assert.equal(
    report.maxPreflightLocationPower,
    preflightLocationPowerLimit,
  );
}

function assertPreflightNotRun(report: ArtifactReadReport): void {
  assertPreflightLimits(report);
  assert.equal(report.preflightWorkUnits, 0);
  assert.equal(report.preflightMaximumDepth, 0);
  assert.equal(report.preflightMaximumLocationPower, 0);
  assert.equal(report.preflightConsumedByteCount, 0);
  assert.equal(report.preflightCode, "NOT_RUN");
  assert.equal(report.archivePreflightComplete, false);
  assert.equal(report.deserializationStarted, false);
}

function assertSuccessfulPreflight(
  report: ArtifactReadReport,
  inputByteCount: number,
): void {
  assertPreflightLimits(report);
  assert.equal(typeof report.preflightWorkUnits, "number");
  assert.ok(Number.isSafeInteger(report.preflightWorkUnits));
  assert.ok(report.preflightWorkUnits > 0);
  assert.ok(report.preflightWorkUnits <= preflightWorkLimit);
  assert.equal(typeof report.preflightMaximumDepth, "number");
  assert.ok(Number.isSafeInteger(report.preflightMaximumDepth));
  assert.ok(report.preflightMaximumDepth > 0);
  assert.ok(
    report.preflightMaximumDepth <= preflightNestingDepthLimit,
  );
  assert.equal(typeof report.preflightMaximumLocationPower, "number");
  assert.ok(Number.isSafeInteger(report.preflightMaximumLocationPower));
  assert.ok(report.preflightMaximumLocationPower >= 0);
  assert.ok(
    report.preflightMaximumLocationPower <= preflightLocationPowerLimit,
  );
  assert.equal(report.preflightConsumedByteCount, inputByteCount);
  assert.equal(report.preflightCode, "OK");
  assert.equal(report.archivePreflightComplete, true);
  assert.equal(report.deserializationStarted, true);
}

const directory = runtimeDirectory(process.argv.slice(2));
const gluePath = resolve(directory, "occt-wasm.js");
const wasmPath = resolve(directory, "occt-wasm.wasm");
await Promise.all([access(gluePath), access(wasmPath)]);
const loaded = (await import(pathToFileURL(gluePath).href)) as {
  readonly default: OcctModuleFactory;
};
const rawModule = await loaded.default({
  locateFile: (path) => (path.endsWith(".wasm") ? wasmPath : path),
  print: () => {},
  printErr: () => {},
});
assert.ok(isObject(rawModule), "owned OCCT facade factory returned no module");
const module = rawModule as unknown as OwnedArtifactModule;
assert.equal(module.invariantcadFacadeVersion(), expectedFacadeVersion);
assert.equal(typeof module.OcctKernel, "function");
assert.equal(typeof module.invariantcadWriteArtifactBrep, "function");
assert.equal(typeof module.invariantcadReadArtifactBrep, "function");

const kernel = new module.OcctKernel();
let source: number | undefined;
let restored: number | undefined;
const reports: Array<ArtifactWriteReport | ArtifactReadReport> = [];
try {
  source = kernel.makeBox(1, 2, 3);
  assert.equal(kernel.isValid(source), true);
  const rawDeniedWrite = module.invariantcadWriteArtifactBrep(
    kernel,
    source,
    1_000_000,
    tinyNativeRequestLimit,
  );
  assertWriteReport(rawDeniedWrite);
  reports.push(rawDeniedWrite);
  assertNativeRequestDenial(rawDeniedWrite);
  assert.equal(rawDeniedWrite.stage, "serialization");
  assert.equal(rawDeniedWrite.maxOutputBytes, 1_000_000);
  assert.equal(rawDeniedWrite.hasBytes(), false);
  assert.equal(rawDeniedWrite.byteCount(), 0);

  const rawRecoveredWrite = module.invariantcadWriteArtifactBrep(
    kernel,
    source,
    1_000_000,
    recoveryNativeRequestLimit,
  );
  assertWriteReport(rawRecoveredWrite);
  reports.push(rawRecoveredWrite);
  assert.equal(rawRecoveredWrite.ok, true);
  assert.equal(rawRecoveredWrite.nativeRequestLimitExceeded, false);
  assert.equal(rawRecoveredWrite.hasBytes(), true);
  const copied = rawRecoveredWrite.copyBytes();
  assert.ok(copied instanceof Uint8Array);
  assert.ok(copied.byteLength > 0);

  const rawDeniedRead = module.invariantcadReadArtifactBrep(
    kernel,
    copied,
    copied.byteLength,
    100,
    tinyNativeRequestLimit,
    preflightWorkLimit,
    preflightNestingDepthLimit,
    preflightLocationPowerLimit,
  );
  assertReadReport(rawDeniedRead);
  reports.push(rawDeniedRead);
  assertNativeRequestDenial(rawDeniedRead);
  assert.equal(rawDeniedRead.stage, "copy");
  assertPreflightNotRun(rawDeniedRead);
  assert.equal(rawDeniedRead.hasResult(), false);
  assert.equal(rawDeniedRead.transferCode(kernel), "NO_RESULT");

  const rawRecoveredRead = module.invariantcadReadArtifactBrep(
    kernel,
    copied,
    copied.byteLength,
    100,
    recoveryNativeRequestLimit,
    preflightWorkLimit,
    preflightNestingDepthLimit,
    preflightLocationPowerLimit,
  );
  assertReadReport(rawRecoveredRead);
  reports.push(rawRecoveredRead);
  assert.equal(rawRecoveredRead.ok, true);
  assert.equal(rawRecoveredRead.nativeRequestLimitExceeded, false);
  assertSuccessfulPreflight(rawRecoveredRead, copied.byteLength);
  assert.equal(rawRecoveredRead.hasResult(), true);
  assert.equal(rawRecoveredRead.transferCode(kernel), "READY");
  const rawRestored = rawRecoveredRead.takeResultId(kernel);
  assert.equal(typeof rawRestored, "number");
  restored = rawRestored;
  assert.equal(kernel.isValid(restored), true);
} finally {
  if (restored !== undefined) kernel.release(restored);
  for (const report of reports.reverse()) report.delete();
  if (source !== undefined) kernel.release(source);
  kernel.delete();
}

process.stdout.write(
  "owned OCCT artifact tiny native request quotas denied and recovered\n",
);
