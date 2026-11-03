import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createManifoldKernel } from "../src/index.js";

// Vitest isolates module state per test file, so this file observes the first
// Manifold initialization of its realm. The steps share that state in order.
const bundledWasm = fileURLToPath(
  new URL("../src/vendor/manifold-3d/manifold.wasm", import.meta.url),
);
const missingWasm = fileURLToPath(
  new URL("../src/vendor/manifold-3d/missing-runtime.wasm", import.meta.url),
);

async function expectWorkingKernel(
  kernel: Awaited<ReturnType<typeof createManifoldKernel>>,
): Promise<void> {
  try {
    const box = kernel.box!([1, 2, 3], false);
    expect(kernel.measure(box).volume).toBeCloseTo(6, 12);
  } finally {
    kernel.dispose();
  }
}

describe("Manifold runtime initialization", () => {
  it("retries after a failed load and then pins the successful URL", async () => {
    await expect(
      createManifoldKernel({ wasmUrl: missingWasm }),
    ).rejects.toThrow();
    // The failed attempt is not cached: the same URL is attempted again.
    await expect(
      createManifoldKernel({ wasmUrl: missingWasm }),
    ).rejects.toThrow();

    // A corrected URL initializes the runtime instead of being refused.
    await expectWorkingKernel(
      await createManifoldKernel({ wasmUrl: bundledWasm }),
    );

    // Only the successful initialization is cached and pins its URL.
    await expectWorkingKernel(await createManifoldKernel());
    await expectWorkingKernel(
      await createManifoldKernel({ wasmUrl: bundledWasm }),
    );
    await expect(
      createManifoldKernel({ wasmUrl: missingWasm }),
    ).rejects.toThrow(
      "The Manifold runtime is already initialized with a different WASM URL",
    );
  });
});
