import { describe, expect, it, vi } from "vitest";
import type {
  KernelShape,
  MeshOptions,
  ResolvedProfile,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

type Defer = (cleanup: () => void) => void;

/**
 * Runs a test body and then every cleanup it registered, newest first, even
 * when the body or another cleanup fails, so a failed setup step still
 * releases every kernel and shape acquired before it. The first failure wins.
 */
async function withCleanup(
  body: (defer: Defer) => Promise<void> | void,
): Promise<void> {
  const cleanups: (() => void)[] = [];
  const failures: unknown[] = [];
  try {
    await body((cleanup) => {
      cleanups.push(cleanup);
    });
  } catch (error) {
    failures.push(error);
  }
  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    try {
      cleanups[index]!();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

describe("OCCT kernel instance contracts", () => {
  it("keeps capability declarations immutable and independent per kernel", () =>
    withCleanup(async (defer) => {
      const first = await createOcctKernel();
      defer(() => first.dispose());
      const second = await createOcctKernel();
      defer(() => second.dispose());
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
      defer(() => fresh.dispose());
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
    }));

  it("rejects invalid modeling tolerances and tessellation options before loading", () =>
    withCleanup(async (defer) => {
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
      defer(() => kernel.dispose());
      const sphere = kernel.sphere!(5);
      defer(() => kernel.disposeShape(sphere));
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
    }));

  it("applies anisotropic scale factors independently of the length tolerance", () =>
    withCleanup(async (defer) => {
      // modelingTolerance is a length; a 0.9 % anisotropy on a 100 mm box
      // moves a face by 0.9 mm, ninety times this tolerance.
      const kernel = await createOcctKernel({ modelingTolerance: 0.01 });
      defer(() => kernel.dispose());
      const box = kernel.box!([100, 100, 100], false);
      defer(() => kernel.disposeShape(box));
      const scaled = kernel.transform!(box, [
        { kind: "scale", value: [1, 1.009, 1] },
      ]);
      defer(() => kernel.disposeShape(scaled));
      const uniform = kernel.transform!(box, [
        { kind: "scale", value: [2, 2, 2] },
      ]);
      defer(() => kernel.disposeShape(uniform));
      const measured = kernel.measure(scaled);
      expect(measured.boundingBox.max[1]).toBeCloseTo(100.9, 6);
      expect(measured.boundingBox.max[0]).toBeCloseTo(100, 6);
      expect(measured.volume).toBeCloseTo(1_009_000, 3);
      expect(kernel.measure(uniform).volume).toBeCloseTo(8_000_000, 3);
    }));

  it("rejects every nonzero twist and non-unit top scale regardless of tolerance", () =>
    withCleanup(async (defer) => {
      const kernel = await createOcctKernel({ modelingTolerance: 0.01 });
      defer(() => kernel.dispose());
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
      defer(() => kernel.disposeShape(prism));
      expect(kernel.measure(prism).volume).toBeCloseTo(100_000, 3);
    }));
});

describe("OCCT transform of shapes with degenerate edges", () => {
  const operations = [
    ["translate", [{ kind: "translate", value: [5, -3, 2] }]],
    ["rotate", [{ kind: "rotate", value: [0.3, 0.4, 0.5] }]],
    ["uniform scale", [{ kind: "scale", value: [2, 2, 2] }]],
    ["nonuniform scale", [{ kind: "scale", value: [2, 1, 1] }]],
    ["mirror", [{ kind: "mirror", normal: [1, 0, 0] }]],
  ] as const;

  it("transforms spheres and cones without failing on pole or apex edges", () =>
    withCleanup(async (defer) => {
      const kernel = await createOcctKernel();
      defer(() => kernel.dispose());
      const sphere = kernel.sphere!(10, undefined, { feature: "ball" });
      defer(() => kernel.disposeShape(sphere));
      const cone = kernel.cylinder!(10, 5, 0, false, 32, { feature: "tip" });
      defer(() => kernel.disposeShape(cone));
      const sources = [
        ["sphere", sphere, (4 / 3) * Math.PI * 1000],
        ["cone", cone, (Math.PI * 25 * 10) / 3],
      ] as const;
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
            // A nonuniform scale goes through BRepBuilderAPI_GTransform,
            // which approximates curved surfaces, so its measured volume is
            // only approximate; the regression here is that it no longer
            // throws.
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
    }));
});

describe("OCCT mesh call-order independence", () => {
  it("keeps meshes and exact exports independent of earlier mesh requests", () =>
    withCleanup(async (defer) => {
      const kernel = await createOcctKernel();
      defer(() => kernel.dispose());
      const sphere = kernel.sphere!(10);
      defer(() => kernel.disposeShape(sphere));
      const fresh = kernel.sphere!(10);
      defer(() => kernel.disposeShape(fresh));
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
    }));
});

describe("OCCT kernel disposal", () => {
  it("releases every shape and the native kernel when one release fails", () =>
    withCleanup(async (defer) => {
      const kernel = await createOcctKernel();
      // Idempotent: a no-op once the test body has disposed the kernel.
      defer(() => kernel.dispose());
      const raw = (kernel as unknown as {
        raw: {
          release(handle: unknown): void;
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
      const releaseSpy = vi
        .spyOn(raw, "release")
        .mockImplementation((handle: unknown) => {
          if (!injected) {
            injected = true;
            release(handle);
            throw new Error("injected release failure");
          }
          released.push(handle);
          release(handle);
        });
      defer(() => releaseSpy.mockRestore());
      const disposeSpy = vi
        .spyOn(raw, Symbol.dispose)
        .mockImplementation(() => {
          nativeDisposed = true;
          nativeDispose();
        });
      defer(() => disposeSpy.mockRestore());

      expect(() => kernel.dispose()).toThrow("injected release failure");
      expect(released).toHaveLength(boxes.length - 1);
      expect(nativeDisposed).toBe(true);
      expect(() => kernel.disposeShape(boxes[0]!)).not.toThrow();
      expect(() => kernel.measure(boxes[2]!)).toThrow(/disposed/u);
      // A second dispose is a no-op.
      expect(() => kernel.dispose()).not.toThrow();
    }));
});

interface RawMeasurementAccess {
  readonly shapeCount: number;
  makeBox(x: number, y: number, z: number): number;
  makeCompound(shapes: number[]): number;
  toBREP(shape: number): string;
  iterShapes(shape: number): number[];
  getShapeType(shape: number): string;
  release(shape: number): void;
}

function rawMeasurementAccess(kernel: object): RawMeasurementAccess {
  return (kernel as { raw: RawMeasurementAccess }).raw;
}

/** Imports a compound that holds the same 1 x 2 x 3 box occurrence twice. */
function importRepeatedBox(
  kernel: Awaited<ReturnType<typeof createOcctKernel>>,
): KernelShape {
  const raw = rawMeasurementAccess(kernel);
  const box = raw.makeBox(1, 2, 3);
  let brep: string;
  try {
    const compound = raw.makeCompound([box, box]);
    try {
      brep = raw.toBREP(compound);
    } finally {
      raw.release(compound);
    }
  } finally {
    raw.release(box);
  }
  return kernel.importShape!(brep, "brep");
}

describe("OCCT measurement multiplicity", () => {
  it("counts a repeated solid occurrence once per occurrence for every quantity", () =>
    withCleanup(async (defer) => {
      const kernel = await createOcctKernel();
      defer(() => kernel.dispose());
      const repeated = importRepeatedBox(kernel);
      defer(() => kernel.disposeShape(repeated));
      const single = kernel.box!([1, 2, 3], false);
      defer(() => kernel.disposeShape(single));
      expect(kernel.classifyBodyResult!(repeated)).toBe("multiple-bodies");
      const measured = kernel.measure(repeated);
      const reference = kernel.measure(single);
      expect(measured.surfaceArea).toBeCloseTo(2 * reference.surfaceArea, 9);
      expect(measured.volume).toBeCloseTo(2 * reference.volume, 9);
      expect(measured.centerOfMass).toEqual([
        expect.closeTo(0.5, 9),
        expect.closeTo(1, 9),
        expect.closeTo(1.5, 9),
      ]);
      for (let index = 0; index < 3; index += 1) {
        expect(measured.inertiaTensor[index]![index]).toBeCloseTo(
          2 * reference.inertiaTensor[index]![index]!,
          9,
        );
      }
    }));

  it("releases every occurrence handle when the traversal fails", () =>
    withCleanup(async (defer) => {
      const kernel = await createOcctKernel();
      defer(() => kernel.dispose());
      const repeated = importRepeatedBox(kernel);
      defer(() => kernel.disposeShape(repeated));
      const raw = rawMeasurementAccess(kernel);
      const getShapeType = raw.getShapeType.bind(raw);
      const before = raw.shapeCount;
      let calls = 0;
      const typeSpy = vi
        .spyOn(raw, "getShapeType")
        .mockImplementation((handle: number) => {
          calls += 1;
          // Call 1 is the root; fail on the second child occurrence, after
          // the first one is retained.
          if (calls === 3) throw new Error("injected traversal failure");
          return getShapeType(handle);
        });
      defer(() => typeSpy.mockRestore());
      expect(() => kernel.measure(repeated)).toThrow(
        "injected traversal failure",
      );
      expect(calls).toBe(3);
      expect(raw.shapeCount).toBe(before);
      typeSpy.mockRestore();
      expect(kernel.measure(repeated).volume).toBeCloseTo(12, 9);
      expect(raw.shapeCount).toBe(before);
    }));

  it("bounds compound traversal and releases a wide compound's children", () =>
    withCleanup(async (defer) => {
      const kernel = await createOcctKernel();
      defer(() => kernel.dispose());
      const repeated = importRepeatedBox(kernel);
      defer(() => kernel.disposeShape(repeated));
      const raw = rawMeasurementAccess(kernel);
      // Stand-in children: far more than one call may spread as arguments,
      // and one more than the occurrence bound admits with the root. They
      // are never passed to native code; only their release is recorded.
      const wide = 1_000_000;
      const fake = -1;
      const iterShapes = raw.iterShapes.bind(raw);
      const release = raw.release.bind(raw);
      let fakeReleases = 0;
      const iterSpy = vi
        .spyOn(raw, "iterShapes")
        .mockImplementation((handle: number) => {
          iterSpy.mockImplementation(iterShapes);
          void handle;
          return new Array<number>(wide).fill(fake);
        });
      defer(() => iterSpy.mockRestore());
      const releaseSpy = vi
        .spyOn(raw, "release")
        .mockImplementation((handle: number) => {
          if (handle === fake) {
            fakeReleases += 1;
            return;
          }
          release(handle);
        });
      defer(() => releaseSpy.mockRestore());
      const before = raw.shapeCount;
      expect(() => kernel.measure(repeated)).toThrow(
        "OCCT measurement exceeded its occurrence limit",
      );
      expect(fakeReleases).toBe(wide);
      expect(raw.shapeCount).toBe(before);
    }));
});

describe("OCCT stock edge-treatment failures", () => {
  it("names the operation and native message instead of a bare WebAssembly.Exception", () =>
    withCleanup(async (defer) => {
      const kernel = await createOcctKernel();
      defer(() => kernel.dispose());
      const box = kernel.box!([2, 3, 4], false, { feature: "block" });
      defer(() => kernel.disposeShape(box));
      const edge = kernel.topology!(box).edges[0]!.key;
      for (const [operation, run] of [
        ["fillet", () => kernel.fillet!(box, [edge], { radius: 3 })],
        ["chamfer", () => kernel.chamfer!(box, [edge], { distance: 5 })],
      ] as const) {
        let thrown: unknown;
        try {
          const result = run();
          kernel.disposeShape(result);
        } catch (error) {
          thrown = error;
        }
        expect(thrown, operation).toBeInstanceOf(Error);
        const message = (thrown as Error).message;
        expect(message).toContain(`OCCT ${operation} failed`);
        expect(message).not.toContain("[object WebAssembly.Exception]");
      }
      // The kernel stays usable after the native failure.
      const rounded = kernel.fillet!(box, [edge], { radius: 0.5 });
      defer(() => kernel.disposeShape(rounded));
      expect(kernel.measure(rounded).volume).toBeLessThan(24);
    }));
});

describe("OCCT feature context capture", () => {
  it("captures feature and tolerance once from own data properties", () =>
    withCleanup(async (defer) => {
      const kernel = await createOcctKernel();
      defer(() => kernel.dispose());
      const track = <T extends KernelShape>(shape: T): T => {
        defer(() => kernel.disposeShape(shape));
        return shape;
      };
      const prototype = Object.prototype as { feature?: unknown };
      // A later change to a reused context must not relabel earlier shapes.
      const context: { feature: string } = { feature: "boxA" };
      const first = track(kernel.box!([1, 1, 1], false, context));
      context.feature = "boxB";
      track(kernel.box!([1, 1, 1], false, context));
      const snapshot = kernel.topology!(first);
      expect(snapshot.history).toBe("complete");
      for (const descriptor of [...snapshot.faces, ...snapshot.edges]) {
        for (const entry of descriptor.lineage) {
          expect(entry.feature).toBe("boxA");
        }
      }

      const cone = track(kernel.cylinder!(2, 1, 0, false, 32, context));
      delete (context as { feature?: string }).feature;
      const coneSnapshot = kernel.topology!(cone);
      expect(coneSnapshot.history).toBe("complete");
      expect(
        coneSnapshot.faces.every((face) =>
          face.lineage.some((entry) => entry.role !== undefined),
        ),
      ).toBe(true);

      // Accessors and caller prototypes fail like context.signal does.
      let reads = 0;
      const accessor = {
        get feature() {
          reads += 1;
          return "getter";
        },
      };
      expect(() => kernel.box!([1, 1, 1], false, accessor)).toThrow(TypeError);
      class InheritedFeature {
        get feature(): string {
          return "fromClass";
        }
      }
      expect(() =>
        kernel.box!([1, 1, 1], false, new InheritedFeature()),
      ).toThrow(TypeError);
      expect(reads).toBe(0);
      expect(() =>
        kernel.box!([1, 1, 1], false, {
          feature: 42 as unknown as string,
        }),
      ).toThrow(TypeError);
      expect(() =>
        kernel.box!([1, 1, 1], false, {
          tolerance: "0.1" as unknown as number,
        }),
      ).toThrow(TypeError);

      // A polluted Object.prototype field is ignored. (Embind itself breaks
      // under this pollution, so topology is read after it is removed; the
      // feature was captured at the call.)
      let plain: KernelShape;
      prototype.feature = "POLLUTED";
      try {
        plain = track(kernel.box!([1, 1, 1], false, {}));
      } finally {
        delete prototype.feature;
      }
      expect(
        (plain as unknown as { lineage: readonly { feature: string }[] })
          .lineage,
      ).toEqual([]);
      const plainSnapshot = kernel.topology!(plain);
      expect(
        [...plainSnapshot.faces, ...plainSnapshot.edges].every(
          (item) => item.lineage.length === 0,
        ),
      ).toBe(true);
    }));
});
