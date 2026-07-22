import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/conformance.ts",
    "src/occt-kernel.ts",
  ],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
  target: "es2022",
  external: ["./vendor/manifold-3d/manifold.js"],
  banner: {
    js: "// SPDX-License-Identifier: Apache-2.0",
  },
});
