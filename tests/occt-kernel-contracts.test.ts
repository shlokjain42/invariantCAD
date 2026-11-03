import { describe, expect, it } from "vitest";
import type { MeshOptions, ResolvedProfile } from "../src/index.js";
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

  it("applies anisotropic scale factors independently of the length tolerance", async () => {
    // modelingTolerance is a length; a 0.9 % anisotropy on a 100 mm box moves
    // a face by 0.9 mm, ninety times this tolerance.
    const kernel = await createOcctKernel({ modelingTolerance: 0.01 });
    const box = kernel.box!([100, 100, 100], false);
    const scaled = kernel.transform!(box, [
      { kind: "scale", value: [1, 1.009, 1] },
    ]);
    const uniform = kernel.transform!(box, [
      { kind: "scale", value: [2, 2, 2] },
    ]);
    try {
      const measured = kernel.measure(scaled);
      expect(measured.boundingBox.max[1]).toBeCloseTo(100.9, 6);
      expect(measured.boundingBox.max[0]).toBeCloseTo(100, 6);
      expect(measured.volume).toBeCloseTo(1_009_000, 3);
      expect(kernel.measure(uniform).volume).toBeCloseTo(8_000_000, 3);
    } finally {
      kernel.disposeShape(uniform);
      kernel.disposeShape(scaled);
      kernel.disposeShape(box);
      kernel.dispose();
    }
  });

  it("rejects every nonzero twist and non-unit top scale regardless of tolerance", async () => {
    const kernel = await createOcctKernel({ modelingTolerance: 0.01 });
    const square: ResolvedProfile = {
      plane: { plane: "XY", origin: [0, 0, 0] },
      outer: {
        curves: [
          { kind: "line", start: [-50, -50], end: [50, -50] },
          { kind: "line", start: [50, -50], end: [50, 50] },
          { kind: "line", start: [50, 50], end: [-50, 50] },
          { kind: "line", start: [-50, 50], end: [-50, -50] },
        ],
      },
      holes: [],
    };
    const base = {
      distance: 10,
      symmetric: false,
      twist: 0,
      scaleTop: [1, 1] as const,
      divisions: 0,
    };
    try {
      for (const options of [
        { ...base, twist: (0.5 * Math.PI) / 180 },
        { ...base, twist: -1e-9 },
        { ...base, scaleTop: [0.995, 0.995] as const },
        { ...base, scaleTop: [1, 1 + 1e-9] as const },
      ]) {
        expect(
          () => kernel.extrude!(square, options),
          JSON.stringify(options),
        ).toThrow(/zero twist, unit top scale/u);
      }
      const prism = kernel.extrude!(square, base);
      try {
        expect(kernel.measure(prism).volume).toBeCloseTo(100_000, 3);
      } finally {
        kernel.disposeShape(prism);
      }
    } finally {
      kernel.dispose();
    }
  });
});
