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

describe("OCCT transform of shapes with degenerate edges", () => {
  const operations = [
    ["translate", [{ kind: "translate", value: [5, -3, 2] }]],
    ["rotate", [{ kind: "rotate", value: [0.3, 0.4, 0.5] }]],
    ["uniform scale", [{ kind: "scale", value: [2, 2, 2] }]],
    ["nonuniform scale", [{ kind: "scale", value: [2, 1, 1] }]],
    ["mirror", [{ kind: "mirror", normal: [1, 0, 0] }]],
  ] as const;

  it("transforms spheres and cones without failing on pole or apex edges", async () => {
    const kernel = await createOcctKernel();
    const sphere = kernel.sphere!(10, undefined, { feature: "ball" });
    const cone = kernel.cylinder!(10, 5, 0, false, 32, { feature: "tip" });
    const sources = [
      ["sphere", sphere, (4 / 3) * Math.PI * 1000],
      ["cone", cone, (Math.PI * 25 * 10) / 3],
    ] as const;
    try {
      expect(kernel.topology!(sphere).history).toBe("complete");
      expect(kernel.topology!(cone).history).toBe("complete");
      for (const [sourceName, source, volume] of sources) {
        for (const [operationName, ops] of operations) {
          const label = `${sourceName} ${operationName}`;
          const transformed = kernel.transform!(source, ops, {
            feature: "moved",
          });
          try {
            const factor =
              ops[0].kind === "scale"
                ? ops[0].value[0] * ops[0].value[1] * ops[0].value[2]
                : 1;
            const rigidOrUniform =
              ops[0].kind !== "scale" || ops[0].value[1] === 2;
            const measured = kernel.measure(transformed).volume;
            // A nonuniform scale goes through BRepBuilderAPI_GTransform, which
            // approximates curved surfaces, so its measured volume is only
            // approximate; the regression here is that it no longer throws.
            expect(
              Math.abs(measured - volume * factor) / (volume * factor),
              label,
            ).toBeLessThan(rigidOrUniform ? 1e-9 : 2e-2);
            expect(kernel.status(transformed), label).toEqual({
              ok: true,
              code: "VALID",
            });
            const snapshot = kernel.topology!(transformed);
            if (rigidOrUniform) {
              // Rigid motions and uniform scale keep complete history: the
              // degenerate edge is seeded through its adjacent face.
              expect(snapshot.history, label).toBe("complete");
              for (const edge of snapshot.edges) {
                expect(
                  edge.lineage.some(
                    (entry) =>
                      entry.feature === "moved" &&
                      entry.relation === "modified",
                  ),
                  label,
                ).toBe(true);
              }
            }
          } finally {
            kernel.disposeShape(transformed);
          }
        }
      }
    } finally {
      kernel.disposeShape(cone);
      kernel.disposeShape(sphere);
      kernel.dispose();
    }
  });
});

describe("OCCT mesh call-order independence", () => {
  it("keeps meshes and exact exports independent of earlier mesh requests", async () => {
    const kernel = await createOcctKernel();
    const sphere = kernel.sphere!(10);
    const fresh = kernel.sphere!(10);
    try {
      const brepBefore = kernel.exportShape!(sphere, "brep");
      const binaryBefore = kernel.exportShape!(sphere, "brep-binary");
      const coarse = { linearDeflection: 1, angularDeflection: 0.8 };
      const fine = { linearDeflection: 0.05, angularDeflection: 0.1 };
      const coarseFirst = kernel.mesh(sphere, coarse);
      const fineMesh = kernel.mesh(sphere, fine);
      const coarseAfterFine = kernel.mesh(sphere, coarse);

      expect(fineMesh.indices.length).toBeGreaterThan(
        coarseFirst.indices.length,
      );
      expect(coarseAfterFine.indices).toEqual(coarseFirst.indices);
      expect(coarseAfterFine.positions).toEqual(coarseFirst.positions);
      expect(kernel.mesh(fresh, coarse).indices).toEqual(coarseFirst.indices);
      // Tessellation must not leak into the exact B-Rep serialization.
      expect(kernel.exportShape!(sphere, "brep")).toEqual(brepBefore);
      expect(kernel.exportShape!(sphere, "brep-binary")).toEqual(binaryBefore);
      expect(kernel.measure(sphere)).toEqual(kernel.measure(fresh));
    } finally {
      kernel.disposeShape(fresh);
      kernel.disposeShape(sphere);
      kernel.dispose();
    }
  });
});

describe("OCCT kernel disposal", () => {
  it("releases every shape and the native kernel when one release fails", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as unknown as {
      raw: {
        release(handle: unknown): void;
        shapeCount?: unknown;
        [Symbol.dispose](): void;
      };
    }).raw;
    const boxes = [
      kernel.box!([1, 1, 1], false),
      kernel.box!([2, 2, 2], false),
      kernel.box!([3, 3, 3], false),
    ];
    const release = raw.release.bind(raw);
    const nativeDispose = raw[Symbol.dispose].bind(raw);
    let injected = false;
    const released: unknown[] = [];
    let nativeDisposed = false;
    raw.release = (handle: unknown) => {
      if (!injected) {
        injected = true;
        release(handle);
        throw new Error("injected release failure");
      }
      released.push(handle);
      release(handle);
    };
    raw[Symbol.dispose] = () => {
      nativeDisposed = true;
      nativeDispose();
    };

    expect(() => kernel.dispose()).toThrow("injected release failure");
    expect(released).toHaveLength(boxes.length - 1);
    expect(nativeDisposed).toBe(true);
    expect(() => kernel.disposeShape(boxes[0]!)).not.toThrow();
    expect(() => kernel.measure(boxes[2]!)).toThrow(/disposed/u);
    // A second dispose is a no-op.
    expect(() => kernel.dispose()).not.toThrow();
  });
});
