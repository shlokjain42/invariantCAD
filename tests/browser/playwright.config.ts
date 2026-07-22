import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "smoke.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 120_000,
  },
  outputDir: fileURLToPath(
    new URL("../../.artifacts/playwright-results/", import.meta.url),
  ),
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "pnpm exec vite preview --config tests/browser/vite.config.ts " +
      "--host 127.0.0.1 --port 4173 --strictPort",
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    port: 4173,
    reuseExistingServer: process.env.CI !== "true",
    timeout: 120_000,
  },
});
