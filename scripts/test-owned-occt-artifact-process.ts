import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  OcctArtifactProcessChildError,
  OcctArtifactProcessTimeoutError,
  runOcctArtifactProcess,
} from "./run-occt-artifact-process.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const maximumArtifactBytes = 16 * 1024 * 1024;
const normalTimeoutMs = 30_000;
const stallTimeoutMs = 1_000;
const feature = "owned-artifact-process.asymmetric-box";
const evaluatorFeature = "result";

function runtimeDirectory(arguments_: readonly string[]): string {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (values.length === 0) {
    return resolve(
      projectRoot,
      ".artifacts/occt-facade-bundle/invariantcad-occt-facade-0.9.0/runtime",
    );
  }
  if (
    values.length === 2 &&
    values[0] === "--runtime-dir" &&
    values[1] !== undefined
  ) {
    return resolve(values[1]);
  }
  throw new Error(
    "Usage: tsx scripts/test-owned-occt-artifact-process.ts [--runtime-dir DIRECTORY]",
  );
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return Buffer.from(first).equals(Buffer.from(second));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function mutateFirstByte(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    const byte = new Uint8Array(1);
    const { bytesRead } = await handle.read(byte, 0, 1, 0);
    assert.equal(bytesRead, 1);
    byte[0] = byte[0]! ^ 0xff;
    const { bytesWritten } = await handle.write(byte, 0, 1, 0);
    assert.equal(bytesWritten, 1);
  } finally {
    await handle.close();
  }
}

const directory = runtimeDirectory(process.argv.slice(2));

const preAborted = new AbortController();
preAborted.abort();
await assert.rejects(
  runOcctArtifactProcess({
    operation: "produce",
    runtimeDirectory: resolve(projectRoot, ".definitely-missing-runtime"),
    feature,
    maxArtifactBytes: maximumArtifactBytes,
    timeoutMs: normalTimeoutMs,
    signal: preAborted.signal,
  }),
  (error: unknown) =>
    error instanceof DOMException && error.name === "AbortError",
  "A pre-aborted request must fail before spawning or inspecting a runtime",
);

await assert.rejects(
  runOcctArtifactProcess({
    operation: "evaluate",
    runtimeDirectory: resolve(projectRoot, ".definitely-missing-runtime"),
    feature: evaluatorFeature,
    maxArtifactBytes: maximumArtifactBytes,
    timeoutMs: normalTimeoutMs,
    signal: preAborted.signal,
  }),
  (error: unknown) =>
    error instanceof DOMException && error.name === "AbortError",
  "A pre-aborted evaluator request must fail before spawning or inspecting a runtime",
);

await assert.rejects(
  runOcctArtifactProcess({
    operation: "produce",
    runtimeDirectory: resolve(projectRoot, ".definitely-missing-runtime"),
    feature,
    maxArtifactBytes: maximumArtifactBytes,
    timeoutMs: 0,
  }),
  /timeoutMs must be a positive safe integer/,
  "An invalid deadline must fail before spawning a child",
);

const unbrandedSignal = {
  aborted: false,
  addEventListener: () => {},
  removeEventListener: () => {},
} as unknown as AbortSignal;
await assert.rejects(
  runOcctArtifactProcess({
    operation: "produce",
    runtimeDirectory: resolve(projectRoot, ".definitely-missing-runtime"),
    feature,
    maxArtifactBytes: maximumArtifactBytes,
    timeoutMs: normalTimeoutMs,
    signal: unbrandedSignal,
  }),
  /signal must be an AbortSignal/,
  "A non-branded signal wrapper must fail before spawning a child",
);

const producerA = await runOcctArtifactProcess({
  operation: "produce",
  runtimeDirectory: directory,
  feature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
});
const producerB = await runOcctArtifactProcess({
  operation: "produce",
  runtimeDirectory: directory,
  feature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
});

assert.ok(producerA.artifact.byteLength > 0);
assert.ok(producerA.artifact.byteLength <= maximumArtifactBytes);
assert.ok(
  sameBytes(producerA.artifact, producerB.artifact),
  "Fresh verified producer processes must emit byte-identical artifacts",
);
assert.deepEqual(producerA.evidence, producerB.evidence);
assert.equal(producerA.evidence.operation, "produce");
assert.equal(producerA.evidence.advertisement, "unadvertised");
assert.equal(producerA.evidence.shapeArtifactsAbsent, true);
assert.equal(producerA.evidence.certifiesCompatibility, false);
assert.equal(
  producerA.evidence.runtime.verifiedBytesWereExecutionInputs,
  true,
);
assert.equal(
  producerA.evidence.runtime.releaseManifest,
  "metadata/release.json",
);
assert.equal(
  producerA.evidence.runtime.releaseManifestSha256,
  "3403826c60c891c132c2890e8a87d33f91883f98d53014483d7e90cd2006ab6c",
);
assert.match(
  producerA.evidence.runtime.runtimePairIdentity,
  /^invariantcad-occt-runtime-pair@1:sha256:[0-9a-f]{64}$/u,
);
assert.equal(
  producerA.evidence.runtime.declaredBuildIdentity,
  `invariantcad-occt-release-manifest@1:sha256:${producerA.evidence.runtime.releaseManifestSha256}`,
);
assert.equal(producerA.evidence.runtime.buildExecutionObserved, false);
assert.equal(producerA.evidence.runtime.buildExecutionAuthenticated, false);
assert.equal(producerA.evidence.runtime.publisherAuthenticated, false);
assert.equal(
  producerA.evidence.runtime.facadeMarker,
  "invariantcad-facade@0.9.0+occt-wasm.3.7.0",
);
const releaseInput = JSON.parse(
  await readFile(
    resolve(projectRoot, "native/occt/bundle/release-input.json"),
    "utf8",
  ),
) as {
  readonly runtime: readonly {
    readonly source: string;
    readonly size: number;
    readonly sha256: string;
  }[];
};
for (const fileName of ["occt-wasm.js", "occt-wasm.wasm"] as const) {
  const pin = releaseInput.runtime.find((entry) => entry.source === fileName);
  assert.ok(pin, `Missing ${fileName} release-input pin`);
  const actual = await readFile(resolve(directory, fileName));
  assert.equal(actual.byteLength, pin.size);
  assert.equal(sha256(actual), pin.sha256);
  const reported =
    fileName === "occt-wasm.js"
      ? producerA.evidence.runtime.javascript
      : producerA.evidence.runtime.webAssembly;
  assert.deepEqual(reported, {
    fileName,
    byteLength: pin.size,
    sha256: pin.sha256,
  });
}
assert.match(
  producerA.evidence.capabilities.compatibilityFingerprint,
  /nativeArchivePreflight=invariantcad-bintools-v4-owned-profile@1/,
);
assert.ok(
  producerA.evidence.capabilities.compatibilityFingerprint.includes(
    `runtimeAttestation=${producerA.evidence.runtime.runtimePairIdentity}`,
  ),
);

const evaluationA = await runOcctArtifactProcess({
  operation: "evaluate",
  runtimeDirectory: directory,
  feature: evaluatorFeature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
});
const evaluationB = await runOcctArtifactProcess({
  operation: "evaluate",
  runtimeDirectory: directory,
  feature: evaluatorFeature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
});
assert.deepEqual(
  evaluationA.evidence,
  evaluationB.evidence,
  "Fresh verified evaluator processes must emit identical detached evidence",
);
assert.equal(evaluationA.evidence.operation, "evaluate");
assert.equal(evaluationA.evidence.evaluatorPath, "Evaluator.evaluate");
assert.equal(
  evaluationA.evidence.fixture,
  "owned-occt-evaluator-isolation-v1",
);
assert.equal(
  evaluationA.evidence.documentSha256,
  "db15aae91480395965c78682736b16534443d589424c77ec02837d3ccf767dcd",
);
assert.equal(evaluationA.evidence.configurationId, null);
assert.deepEqual(evaluationA.evidence.parameters, {});
assert.equal(evaluationA.evidence.output.name, "result");
assert.equal(evaluationA.evidence.output.kind, "solid");
assert.equal(evaluationA.evidence.output.measurements.volume, 9_750);
assert.equal(
  evaluationA.evidence.output.measurements.surfaceArea,
  3_050,
);
assert.deepEqual(evaluationA.evidence.output.measurements.centerOfMass, [
  7.5,
  12.5,
  15,
]);
assert.deepEqual(evaluationA.evidence.output.measurements.boundingBox, {
  min: [0, 0, 0],
  max: [15, 25, 30],
});
assert.equal(evaluationA.evidence.output.measurements.genus, 0);
assert.equal(evaluationA.evidence.output.measurements.tolerance, 1e-7);
assert.deepEqual(evaluationA.evidence.output.topology, {
  history: "complete",
  faces: 14,
  edges: 32,
  vertices: 20,
});
assert.equal(evaluationA.evidence.evaluatorKernelOperation, "boolean");
assert.equal(evaluationA.evidence.evaluatorKernelOperationObserved, true);
assert.equal(evaluationA.evidence.shapeArtifactsAbsent, true);
assert.equal(evaluationA.evidence.ordinaryEvaluatorRemainsCooperative, true);
assert.equal(evaluationA.evidence.certifiesOperationalCancellation, false);
assert.equal(evaluationA.evidence.certifiesCompatibility, false);
assert.equal(evaluationA.evidence.cleanupCompletedBeforeResponse, true);
assert.deepEqual(evaluationA.evidence.runtime, producerA.evidence.runtime);

const borrowedArtifact = producerA.artifact;
const beforeConsume = borrowedArtifact.slice();
const consumerB = await runOcctArtifactProcess({
  operation: "consume",
  runtimeDirectory: directory,
  feature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
  artifact: borrowedArtifact,
});
assert.ok(
  sameBytes(borrowedArtifact, beforeConsume),
  "The parent-owned artifact must remain unchanged after child consumption",
);
assert.equal(consumerB.evidence.operation, "consume");
assert.equal(
  consumerB.evidence.semanticWitness,
  producerA.evidence.semanticWitness,
);
assert.deepEqual(
  consumerB.evidence.capabilities,
  producerA.evidence.capabilities,
);
assert.deepEqual(consumerB.evidence.runtime, producerA.evidence.runtime);
assert.deepEqual(consumerB.evidence.artifact, producerA.evidence.artifact);
assert.equal(consumerB.evidence.shapeArtifactsAbsent, true);
assert.equal(consumerB.evidence.certifiesCompatibility, false);

const tamperedBundle = await mkdtemp(
  join(tmpdir(), "invariantcad-tampered-occt-bundle-"),
);
try {
  const tamperedRuntime = join(tamperedBundle, "runtime");
  const tamperedMetadata = join(tamperedBundle, "metadata");
  await Promise.all([
    mkdir(tamperedRuntime),
    mkdir(tamperedMetadata),
  ]);
  const javascriptPath = join(tamperedRuntime, "occt-wasm.js");
  const webAssemblyPath = join(tamperedRuntime, "occt-wasm.wasm");
  const releaseManifestPath = join(tamperedMetadata, "release.json");
  await Promise.all([
    copyFile(resolve(directory, "occt-wasm.js"), javascriptPath),
    copyFile(resolve(directory, "occt-wasm.wasm"), webAssemblyPath),
    copyFile(
      resolve(directory, "../metadata/release.json"),
      releaseManifestPath,
    ),
  ]);
  await mutateFirstByte(releaseManifestPath);
  await assert.rejects(
    runOcctArtifactProcess({
      operation: "produce",
      runtimeDirectory: tamperedRuntime,
      feature,
      maxArtifactBytes: maximumArtifactBytes,
      timeoutMs: normalTimeoutMs,
    }),
    (error: unknown) =>
      error instanceof OcctArtifactProcessChildError &&
      error.childError.code === "OPERATION_FAILED" &&
      error.message.includes("independently trusted SHA-256 pin"),
    "A one-byte release-manifest mutation must fail before execution",
  );

  await copyFile(
    resolve(directory, "../metadata/release.json"),
    releaseManifestPath,
  );
  await mutateFirstByte(javascriptPath);
  await assert.rejects(
    runOcctArtifactProcess({
      operation: "produce",
      runtimeDirectory: tamperedRuntime,
      feature,
      maxArtifactBytes: maximumArtifactBytes,
      timeoutMs: normalTimeoutMs,
    }),
    (error: unknown) =>
      error instanceof OcctArtifactProcessChildError &&
      error.childError.code === "OPERATION_FAILED" &&
      error.message.includes("does not match the trusted release manifest"),
    "A one-byte JavaScript mutation must fail before execution",
  );

  await copyFile(resolve(directory, "occt-wasm.js"), javascriptPath);
  await mutateFirstByte(webAssemblyPath);
  await assert.rejects(
    runOcctArtifactProcess({
      operation: "produce",
      runtimeDirectory: tamperedRuntime,
      feature,
      maxArtifactBytes: maximumArtifactBytes,
      timeoutMs: normalTimeoutMs,
    }),
    (error: unknown) =>
      error instanceof OcctArtifactProcessChildError &&
      error.childError.code === "OPERATION_FAILED" &&
      error.message.includes("does not match the trusted release manifest"),
    "A one-byte WebAssembly mutation must fail before execution",
  );
} finally {
  await rm(tamperedBundle, { recursive: true, force: true });
}

let timeoutKernelOperationStartedAt: number | undefined;
let timeoutNonYieldingStallStartedAt: number | undefined;
await assert.rejects(
  runOcctArtifactProcess({
    operation: "stall-during-evaluate",
    runtimeDirectory: directory,
    feature: evaluatorFeature,
    maxArtifactBytes: maximumArtifactBytes,
    timeoutMs: stallTimeoutMs,
    onKernelOperationStarted: () => {
      timeoutKernelOperationStartedAt = performance.now();
    },
    onNonYieldingStallStarted: () => {
      timeoutNonYieldingStallStartedAt = performance.now();
    },
  }),
  (error: unknown) =>
    error instanceof OcctArtifactProcessTimeoutError &&
    error.phase === "operation" &&
    error.timeoutMs === stallTimeoutMs,
  "A synchronous post-start stall must be killed at the operation deadline",
);
assert.notEqual(
  timeoutKernelOperationStartedAt,
  undefined,
  "The operation deadline must expire after the evaluator entered its native Boolean path",
);
assert.notEqual(
  timeoutNonYieldingStallStartedAt,
  undefined,
  "The operation deadline must expire after the native Boolean returned and the non-yielding stall began",
);
const timeoutStallEntry = timeoutNonYieldingStallStartedAt;
if (timeoutStallEntry === undefined) {
  throw new Error("The evaluator stall-entry timestamp is unavailable");
}
const stallElapsedMs = performance.now() - timeoutStallEntry;
assert.ok(
  stallElapsedMs < 5_000,
  `Stalled child was not terminated promptly after the deliberate stall began (${stallElapsedMs} ms)`,
);

const recoveredAfterTimeout = await runOcctArtifactProcess({
  operation: "evaluate",
  runtimeDirectory: directory,
  feature: evaluatorFeature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
});
assert.deepEqual(recoveredAfterTimeout.evidence, evaluationA.evidence);

let cleanupKernelOperationStarted = false;
await assert.rejects(
  runOcctArtifactProcess({
    operation: "fail-cleanup-during-evaluate",
    runtimeDirectory: directory,
    feature: evaluatorFeature,
    maxArtifactBytes: maximumArtifactBytes,
    timeoutMs: normalTimeoutMs,
    onKernelOperationStarted: () => {
      cleanupKernelOperationStarted = true;
    },
  }),
  (error: unknown) =>
    error instanceof OcctArtifactProcessChildError &&
    error.childError.code === "CLEANUP_FAILED" &&
    error.message.includes("cleanup failed"),
  "A cleanup failure after evaluation must never produce successful evidence",
);
assert.equal(
  cleanupKernelOperationStarted,
  true,
  "The injected cleanup failure must happen after the evaluator entered its native Boolean path",
);

await assert.rejects(
  runOcctArtifactProcess({
    operation: "trap",
    runtimeDirectory: directory,
    feature,
    maxArtifactBytes: maximumArtifactBytes,
    timeoutMs: normalTimeoutMs,
  }),
  (error: unknown) =>
    error instanceof OcctArtifactProcessChildError &&
    error.childError.code === "INJECTED_TRAP",
  "A trapped runtime must fail and be discarded",
);

const abortController = new AbortController();
Object.defineProperties(abortController.signal, {
  addEventListener: {
    value: () => {
      throw new Error("Instance listener override must not be called");
    },
  },
  removeEventListener: {
    value: () => {
      throw new Error("Instance listener override must not be called");
    },
  },
});
let abortKernelOperationStarted = false;
let resolveNonYieldingStallStarted = (): void => {};
let rejectNonYieldingStallStarted = (_error: unknown): void => {};
const nonYieldingStallStarted = new Promise<void>(
  (resolveStarted, rejectStarted) => {
    resolveNonYieldingStallStarted = resolveStarted;
    rejectNonYieldingStallStarted = rejectStarted;
  },
);
const abortedOperation = runOcctArtifactProcess({
  operation: "stall-during-evaluate",
  runtimeDirectory: directory,
  feature: evaluatorFeature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
  signal: abortController.signal,
  onKernelOperationStarted: () => {
    abortKernelOperationStarted = true;
  },
  onNonYieldingStallStarted: resolveNonYieldingStallStarted,
});
void abortedOperation.catch(rejectNonYieldingStallStarted);
await nonYieldingStallStarted;
assert.equal(
  abortKernelOperationStarted,
  true,
  "The evaluator must enter its native Boolean path before the post-stall abort",
);
const abortStartedAt = performance.now();
abortController.abort();
await assert.rejects(
  abortedOperation,
  (error: unknown) =>
    error instanceof DOMException && error.name === "AbortError",
  "A post-start abort must kill and await the disposable child",
);
const abortElapsedMs = performance.now() - abortStartedAt;
assert.ok(
  abortElapsedMs < 5_000,
  `Aborted evaluator child was not terminated promptly (${abortElapsedMs} ms)`,
);

const recoveredEvaluator = await runOcctArtifactProcess({
  operation: "evaluate",
  runtimeDirectory: directory,
  feature: evaluatorFeature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
});
assert.deepEqual(recoveredEvaluator.evidence, evaluationA.evidence);

const recovered = await runOcctArtifactProcess({
  operation: "consume",
  runtimeDirectory: directory,
  feature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
  artifact: borrowedArtifact,
});
assert.equal(
  recovered.evidence.semanticWitness,
  producerA.evidence.semanticWitness,
);
assert.deepEqual(
  recovered.evidence.capabilities,
  producerA.evidence.capabilities,
);
assert.deepEqual(recovered.evidence.runtime, producerA.evidence.runtime);
assert.equal(recovered.evidence.shapeArtifactsAbsent, true);
assert.equal(recovered.evidence.certifiesCompatibility, false);
assert.ok(sameBytes(borrowedArtifact, beforeConsume));

process.stdout.write(
  "owned OCCT artifact/evaluator one-shot process isolation, cleanup, recovery, and cross-process evidence passed\n",
);
