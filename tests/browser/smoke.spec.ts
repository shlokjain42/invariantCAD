import { expect, test } from "@playwright/test";
import type { BrowserSmokeResult } from "./app.js";

test("loads both WASM kernels from a production browser bundle", async ({
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
});
