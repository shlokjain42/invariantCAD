import { expect, test } from "@playwright/test";
import type { BrowserSmokeResult } from "./app.js";

test("loads both WASM kernels and confines artifact live shapes to disposable module workers", async ({
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

  expect(result.artifactWorker.fixture.byteLength).toBe(11_591);
  expect(result.artifactWorker.fixture.sourceBytesPreserved).toBe(true);
  expect(result.artifactWorker.fixture.transferDetached).toBe(true);
  expect(result.artifactWorker.preAbort).toEqual({
    name: "AbortError",
    workerCreations: 0,
  });
  expect(result.artifactWorker.timeout).toEqual({
    name: "DisposableWorkerOperationTimeoutError",
    timeoutMs: 5_000,
    started: true,
  });
  expect(result.artifactWorker.workersCreated).toBe(2);
  expect(result.artifactWorker.workersTerminated).toBe(2);

  const recovery = result.artifactWorker.recovery;
  expect(recovery.volume).toBeCloseTo(30, 10);
  expect(recovery.faces).toBe(6);
  expect(recovery.edges).toBe(12);
  expect(recovery.vertices).toBe(8);
  expect(recovery.protocolVersion).toBe(1);
  expect(recovery.format).toBe("org.invariantcad.occt-shape-candidate");
  expect(recovery.formatVersion).toBe(2);
  expect(recovery.compatibilityFingerprint).toContain(
    "invariantcad-occt-shape-candidate@2",
  );
  expect(recovery.compatibilityFingerprint).toContain("runtime=stock");
  expect(recovery.inputBytesPreserved).toBe(true);
});
