import { describe, expect, it } from "vitest";
import { createOcctKernel } from "../src/occt-kernel.js";

describe("OCCT kernel instance contracts", () => {
  it("keeps capability declarations immutable and independent per kernel", async () => {
    const first = await createOcctKernel();
    const second = await createOcctKernel();
    try {
      const capabilities = first.capabilities;
      expect(Object.isFrozen(capabilities)).toBe(true);
      expect(Object.isFrozen(capabilities.primitives)).toBe(true);
      expect(Object.isFrozen(capabilities.features)).toBe(true);
      expect(Object.isFrozen(capabilities.nativeExports)).toBe(true);
      expect(Object.isFrozen(capabilities.topology?.kinds)).toBe(true);
      expect(
        Object.isFrozen(capabilities.documentBodyImport?.formats[0]?.unitModes),
      ).toBe(true);
      expect(() =>
        (capabilities.primitives as string[]).pop(),
      ).toThrow(TypeError);
      expect(() =>
        (capabilities.features as string[]).push("draft"),
      ).toThrow(TypeError);
      expect(() => {
        (capabilities.nativeExports as string[]).length = 0;
      }).toThrow(TypeError);

      const fresh = await createOcctKernel();
      try {
        for (const kernel of [second, fresh]) {
          expect(kernel.capabilities.primitives).toEqual([
            "box",
            "cylinder",
            "sphere",
          ]);
          expect(kernel.capabilities.features).not.toContain("draft");
          expect(kernel.capabilities.nativeExports).toEqual([
            "step",
            "brep",
            "brep-binary",
          ]);
        }
      } finally {
        fresh.dispose();
      }
    } finally {
      second.dispose();
      first.dispose();
    }
  });
});
