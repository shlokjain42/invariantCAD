import { describe, expect, it } from "vitest";
import type { MeshOptions } from "../src/index.js";
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

  it("rejects invalid modeling tolerances and tessellation options before loading", async () => {
    for (const modelingTolerance of [
      Number.NaN,
      -1,
      0,
      -0,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      await expect(
        createOcctKernel({ modelingTolerance }),
        String(modelingTolerance),
      ).rejects.toThrow(RangeError);
    }
    for (const modelingTolerance of ["abc", 1n, null, {}]) {
      await expect(
        createOcctKernel({
          modelingTolerance: modelingTolerance as unknown as number,
        }),
      ).rejects.toThrow(TypeError);
    }
    for (const tessellation of [
      { linearDeflection: Number.NaN },
      { linearDeflection: 0 },
      { angularDeflection: -1 },
      { angularDeflection: Number.POSITIVE_INFINITY },
    ]) {
      await expect(
        createOcctKernel({ tessellation }),
        JSON.stringify(tessellation),
      ).rejects.toThrow(RangeError);
    }
    for (const tessellation of [
      { linearDeflection: "0.1" },
      { relative: "yes" },
      null,
    ]) {
      await expect(
        createOcctKernel({
          tessellation: tessellation as unknown as MeshOptions,
        }),
      ).rejects.toThrow(TypeError);
    }

    const kernel = await createOcctKernel({
      modelingTolerance: 1e-3,
      tessellation: { linearDeflection: 0.5, relative: false },
    });
    const sphere = kernel.sphere!(5);
    try {
      expect(kernel.measure(sphere).tolerance).toBe(1e-3);
      expect(kernel.capabilities.topology?.signatures?.fingerprint).toContain(
        "modelingTolerance=0.001",
      );
      // A NaN deflection previously sent OCCT's mesher into an unbounded
      // loop; per-call options are now validated before native work.
      expect(() =>
        kernel.mesh(sphere, { linearDeflection: Number.NaN }),
      ).toThrow(RangeError);
      expect(() =>
        kernel.mesh(sphere, { angularDeflection: 0 }),
      ).toThrow(RangeError);
      expect(() =>
        kernel.mesh(sphere, { relative: 1 as unknown as boolean }),
      ).toThrow(TypeError);
      expect(kernel.mesh(sphere).indices.length).toBeGreaterThan(0);
    } finally {
      kernel.disposeShape(sphere);
      kernel.dispose();
    }
  });
});
