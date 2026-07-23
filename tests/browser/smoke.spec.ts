import { expect, test } from "@playwright/test";
import type { BrowserSmokeResult } from "./app.js";

test("loads both WASM kernels and confines artifact/evaluator native work to disposable module workers", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(
    () => window.invariantCadBrowserSmoke,
  ) as BrowserSmokeResult;

  expect(result.manifold.volume).toBeCloseTo(24, 10);
  expect(result.manifold.triangles).toBe(12);
  expect(result.manifold.stlBytes).toBe(684);

  expect(result.occt.volume).toBeCloseTo(24, 10);
  expect(result.occt.faces).toBe(6);
  expect(result.occt.edges).toBe(12);
  expect(result.occt.vertices).toBe(8);
  expect(result.occt.stepBytes).toBeGreaterThan(100);
  expect(result.occt.crossRealmWasmUrlCaptured).toBe(true);

  expect(result.artifactWorker.fixture.byteLength).toBe(13_735);
  expect(result.artifactWorker.fixture.sourceBytesPreserved).toBe(true);
  expect(result.artifactWorker.fixture.transferDetached).toBe(true);
  expect(result.artifactWorker.preAbort).toEqual({
    name: "AbortError",
    workerCreations: 0,
  });
  expect(result.artifactWorker.timeout).toEqual({
    name: "DisposableWorkerOperationTimeoutError",
    timeoutMs: 10_000,
    started: true,
    kernelOperationStarted: true,
    kernelOperation: "box",
  });
  expect(result.artifactWorker.abort).toEqual({
    name: "AbortError",
    started: true,
    kernelOperationStarted: true,
    kernelOperation: "box",
  });
  expect(result.artifactWorker.workersCreated).toBe(5);
  expect(result.artifactWorker.workerTerminationRequests).toBe(5);

  const completed = result.artifactWorker.evaluator.completed;
  expect(completed).toEqual({
    volume: 42,
    faces: 6,
    edges: 12,
    vertices: 8,
    outputCount: 1,
    diagnosticCount: 0,
    cacheColdNativeBoxCalls: 1,
    cacheWarmNativeBoxCalls: 0,
    cacheEntries: 1,
    cacheColdEvents: "miss,write",
    cacheWarmEvents: "hit",
    cacheMeasurementsMatch: true,
    shapeArtifactsAbsent: true,
    trustedStoreOnly: true,
    certifiesCompatibility: false,
    certifiesOperationalCancellation: false,
    cleanupCompletedBeforeResponse: true,
  });
  expect(result.artifactWorker.evaluator.recovery).toEqual(completed);
  expect(result.artifactWorker.evaluator.recoveryMatches).toBe(true);

  const recovery = result.artifactWorker.recovery;
  expect(recovery.volume).toBeCloseTo(30, 10);
  expect(recovery.faces).toBe(6);
  expect(recovery.edges).toBe(12);
  expect(recovery.vertices).toBe(8);
  expect(recovery.protocolVersion).toBe(1);
  expect(recovery.format).toBe("org.invariantcad.occt-shape-candidate");
  expect(recovery.formatVersion).toBe(3);
  expect(recovery.compatibilityFingerprint).toContain(
    "invariantcad-occt-shape-candidate@3",
  );
  expect(recovery.compatibilityFingerprint).toContain("runtime=stock");
  expect(recovery.inputBytesPreserved).toBe(true);

  const attestation = result.runtimeAttestation;
  expect(attestation.runtimePairIdentity).toMatch(
    /^invariantcad-occt-runtime-pair@1:sha256:[0-9a-f]{64}$/u,
  );
  expect(attestation.declaredBuildIdentity).toMatch(
    /^invariantcad-occt-release-manifest@1:sha256:[0-9a-f]{64}$/u,
  );
  expect(attestation.imports).toBe(2);
  expect(attestation.factories).toBe(2);
  expect(attestation.constructed).toBe(2);
  expect(attestation.disposed).toBe(2);
  expect(attestation.exactWasmReceived).toBe(true);
  expect(attestation.draftAdvertised).toBe(true);
  expect(attestation.shapeArtifactsAbsent).toBe(true);
  expect(attestation.topologyFingerprint).toContain(
    "runtime=invariantcad-facade@0.2.0+occt-wasm.3.7.0",
  );
  expect(attestation.topologyFingerprint).not.toContain(
    "runtimeAttestation=",
  );
  expect(attestation.tamperReason).toBe("javascript-digest-mismatch");
  expect(attestation.tamperExecutedJavaScript).toBe(false);
  expect(attestation.importFailureReason).toBe("module-import-failed");
  expect(attestation.recoverySameIdentity).toBe(true);
  expect(attestation.blobUrlsCreated).toBe(3);
  expect(attestation.blobUrlsRevoked).toBe(3);
  expect(attestation.blobUrlsOutstanding).toBe(0);
});
