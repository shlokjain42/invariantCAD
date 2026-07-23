import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
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
const stallTimeoutMs = 250;
const feature = "owned-artifact-process.asymmetric-box";

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

const tamperedRuntime = await mkdtemp(
  join(tmpdir(), "invariantcad-tampered-occt-runtime-"),
);
try {
  const javascriptPath = join(tamperedRuntime, "occt-wasm.js");
  const webAssemblyPath = join(tamperedRuntime, "occt-wasm.wasm");
  await Promise.all([
    copyFile(resolve(directory, "occt-wasm.js"), javascriptPath),
    copyFile(resolve(directory, "occt-wasm.wasm"), webAssemblyPath),
  ]);
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
      error.message.includes("do not match trusted release input"),
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
      error.message.includes("do not match trusted release input"),
    "A one-byte WebAssembly mutation must fail before execution",
  );
} finally {
  await rm(tamperedRuntime, { recursive: true, force: true });
}

const stallStarted = performance.now();
await assert.rejects(
  runOcctArtifactProcess({
    operation: "stall-after-start",
    runtimeDirectory: directory,
    feature,
    maxArtifactBytes: maximumArtifactBytes,
    timeoutMs: stallTimeoutMs,
  }),
  (error: unknown) =>
    error instanceof OcctArtifactProcessTimeoutError &&
    error.phase === "operation" &&
    error.timeoutMs === stallTimeoutMs,
  "A synchronous post-start stall must be killed at the operation deadline",
);
const stallElapsedMs = performance.now() - stallStarted;
assert.ok(
  stallElapsedMs < 30_000,
  `Stalled child was not terminated promptly (${stallElapsedMs} ms)`,
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
let resolveAbortStarted = (): void => {};
let rejectAbortStarted = (_error: unknown): void => {};
const abortStarted = new Promise<void>((resolveStarted, rejectStarted) => {
  resolveAbortStarted = resolveStarted;
  rejectAbortStarted = rejectStarted;
});
const abortedOperation = runOcctArtifactProcess({
  operation: "stall-after-start",
  runtimeDirectory: directory,
  feature,
  maxArtifactBytes: maximumArtifactBytes,
  timeoutMs: normalTimeoutMs,
  signal: abortController.signal,
  onStarted: resolveAbortStarted,
});
void abortedOperation.catch(rejectAbortStarted);
await abortStarted;
abortController.abort();
await assert.rejects(
  abortedOperation,
  (error: unknown) =>
    error instanceof DOMException && error.name === "AbortError",
  "A post-start abort must kill and await the disposable child",
);

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
  "owned OCCT artifact one-shot process timeout, trap, recovery, and cross-process evidence passed\n",
);
