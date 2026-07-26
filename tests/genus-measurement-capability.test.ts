import { describe, expect, it } from "vitest";
import {
  KERNEL_MEASUREMENT_PROTOCOL_VERSION,
  ManifoldKernel,
  createEvaluator,
  createManifoldKernel,
  design,
  inspectKernelMeasurementCapabilities,
  kgPerCubicMillimeter,
  kernelSupports,
  mm,
  vec3,
  type GeometryKernel,
  type KernelShape,
  type ResolvedLoop,
  type ResolvedProfile,
} from "../src/index.js";
import { evaluatePartOutputsV7 } from "../src/evaluator.js";
import { stagedBodySetDesignV7 } from "../src/internal/document-v7-body-set-authoring.js";
import { createOcctKernel } from "../src/occt-kernel.js";

function rectangleLoop(
  minimumX: number,
  minimumY: number,
  maximumX: number,
  maximumY: number,
): ResolvedLoop {
  return {
    curves: [
      {
        kind: "line",
        start: [minimumX, minimumY],
        end: [maximumX, minimumY],
      },
      {
        kind: "line",
        start: [maximumX, minimumY],
        end: [maximumX, maximumY],
      },
      {
        kind: "line",
        start: [maximumX, maximumY],
        end: [minimumX, maximumY],
      },
      {
        kind: "line",
        start: [minimumX, maximumY],
        end: [minimumX, minimumY],
      },
    ],
  };
}

function circleLoop(
  center: readonly [number, number],
  radius: number,
  reversed = false,
): ResolvedLoop {
  return {
    curves: [
      {
        kind: "circle",
        center,
        radius,
        reversed,
        segments: 96,
      },
    ],
  };
}

function profile(holes: readonly ResolvedLoop[] = []): ResolvedProfile {
  return {
    plane: { plane: "XY", origin: [0, 0, 0] },
    outer: rectangleLoop(-20, -20, 20, 20),
    holes,
  };
}

function torusProfile(): ResolvedProfile {
  return {
    plane: { plane: "XY", origin: [0, 0, 0] },
    outer: circleLoop([10, 0], 2),
    holes: [],
  };
}

function extrudeProfile(
  kernel: GeometryKernel,
  resolved: ResolvedProfile,
): KernelShape {
  return kernel.extrude!(resolved, {
    distance: 5,
    symmetric: false,
    twist: 0,
    scaleTop: [1, 1],
    divisions: 0,
  });
}

describe("genus measurement capability", () => {
  it("reports exact Manifold genus per disconnected solid component", async () => {
    const kernel = await createManifoldKernel();
    const shapes: KernelShape[] = [];
    const own = (shape: KernelShape): KernelShape => {
      shapes.push(shape);
      return shape;
    };
    try {
      expect(inspectKernelMeasurementCapabilities(kernel.capabilities)).toEqual({
        status: "valid",
        capabilities: {
          protocolVersion: KERNEL_MEASUREMENT_PROTOCOL_VERSION,
          genus: "exact-per-connected-component",
        },
      });
      expect(
        kernelSupports(kernel.capabilities, "measurement", "genus"),
      ).toBe(true);

      const box = own(kernel.box!([4, 5, 6], false));
      const sphere = own(kernel.sphere!(4, 96));
      const cone = own(kernel.cylinder!(8, 4, 0, false, 96));
      const torus = own(
        kernel.revolve!(torusProfile(), {
          angle: Math.PI * 2,
          segments: 96,
        }),
      );
      const oneHole = own(
        extrudeProfile(kernel, profile([circleLoop([0, 0], 3, true)])),
      );
      const fiveHole = own(
        extrudeProfile(
          kernel,
          profile([
            circleLoop([-10, -10], 2, true),
            circleLoop([10, -10], 2, true),
            circleLoop([10, 10], 2, true),
            circleLoop([-10, 10], 2, true),
            circleLoop([0, 0], 3, true),
          ]),
        ),
      );

      expect(kernel.measure(box).genus).toBe(0);
      expect(kernel.measure(sphere).genus).toBe(0);
      expect(kernel.measure(cone).genus).toBe(0);
      expect(kernel.measure(torus).genus).toBe(1);
      expect(kernel.measure(oneHole).genus).toBe(1);
      expect(kernel.measure(fiveHole).genus).toBe(5);

      const movedTorus = own(
        kernel.transform!(torus, [
          { kind: "translate", value: [100, 0, 0] },
        ]),
      );
      const disconnected = own(kernel.boolean!("union", box, [movedTorus]));
      expect(kernel.measure(disconnected).genus).toBe(1);

      const cavityOuter = own(kernel.box!([20, 20, 20], true));
      const cavityInner = own(kernel.box!([10, 10, 10], true));
      const cavity = own(
        kernel.boolean!("subtract", cavityOuter, [cavityInner]),
      );
      expect(kernel.measure(cavity).genus).toBe(0);

      const disjoint = own(
        kernel.transform!(box, [
          { kind: "translate", value: [200, 0, 0] },
        ]),
      );
      const empty = own(kernel.boolean!("intersect", box, [disjoint]));
      expect(kernel.measure(empty).genus).toBe(0);
    } finally {
      for (let index = shapes.length - 1; index >= 0; index -= 1) {
        kernel.disposeShape(shapes[index]!);
      }
      kernel.dispose();
    }
  });

  it("returns unsupported OCCT genus without disturbing other measurements", async () => {
    const kernel = await createOcctKernel();
    const shapes: KernelShape[] = [];
    const own = (shape: KernelShape): KernelShape => {
      shapes.push(shape);
      return shape;
    };
    try {
      expect(inspectKernelMeasurementCapabilities(kernel.capabilities)).toEqual({
        status: "valid",
        capabilities: {
          protocolVersion: KERNEL_MEASUREMENT_PROTOCOL_VERSION,
          genus: "unsupported",
        },
      });
      expect(
        kernelSupports(kernel.capabilities, "measurement", "genus"),
      ).toBe(false);

      const box = own(kernel.box!([4, 5, 6], false));
      const sphere = own(kernel.sphere!(4, 96));
      const cone = own(kernel.cylinder!(8, 4, 0, false, 96));
      const torus = own(
        kernel.revolve!(torusProfile(), {
          angle: Math.PI * 2,
          segments: 96,
        }),
      );
      const fiveHole = own(
        extrudeProfile(
          kernel,
          profile([
            circleLoop([-10, -10], 2, true),
            circleLoop([10, -10], 2, true),
            circleLoop([10, 10], 2, true),
            circleLoop([-10, 10], 2, true),
            circleLoop([0, 0], 3, true),
          ]),
        ),
      );
      const cavityOuter = own(kernel.box!([20, 20, 20], true));
      const cavityInner = own(kernel.box!([10, 10, 10], true));
      const cavity = own(
        kernel.boolean!("subtract", cavityOuter, [cavityInner]),
      );
      for (const shape of [box, sphere, cone, torus, fiveHole, cavity]) {
        const measured = kernel.measure(shape);
        expect(measured.genus).toBeNull();
        expect(measured.volume).toBeGreaterThan(0);
        expect(measured.surfaceArea).toBeGreaterThan(0);
        expect(measured.centerOfMass).not.toBeNull();
        expect(measured.boundingBox.min.every(Number.isFinite)).toBe(true);
        expect(measured.boundingBox.max.every(Number.isFinite)).toBe(true);
        expect(Number.isFinite(measured.tolerance)).toBe(true);
      }

      const disjoint = own(
        kernel.transform!(box, [
          { kind: "translate", value: [200, 0, 0] },
        ]),
      );
      const empty = own(kernel.boolean!("intersect", box, [disjoint]));
      const emptyMeasurement = kernel.measure(empty);
      expect(emptyMeasurement).toMatchObject({
        volume: 0,
        surfaceArea: 0,
        centerOfMass: null,
        genus: null,
      });
    } finally {
      for (let index = shapes.length - 1; index >= 0; index -= 1) {
        kernel.disposeShape(shapes[index]!);
      }
      kernel.dispose();
    }
  });

  it("reports empty, single, and overlapping assembly genus as unsupported", async () => {
    const kernel = await createManifoldKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("assembly-genus");
      const solid = cad.box("solid", {
        size: vec3(mm(4), mm(5), mm(6)),
      });
      const part = cad.part("part", solid);
      const empty = cad.assembly("empty", () => {});
      const single = cad.assembly("single", (instances) => {
        instances.instance("only", part);
      });
      const overlapping = cad.assembly("overlapping", (instances) => {
        instances.instance("first", part);
        instances.instance("second", part);
      });
      cad.output("empty", empty);
      cad.output("single", single);
      cad.output("overlapping", overlapping);
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        for (const output of ["empty", "single", "overlapping"]) {
          expect(result.value.output(output).measure().genus).toBeNull();
        }
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("admits exact integer and unsupported null genus through staged measurement capture", async () => {
    const cad = stagedBodySetDesignV7("staged-genus-capture");
    const material = cad.material("material", {
      name: "Material",
      massDensity: kgPerCubicMillimeter(1e-6),
    });
    const box = cad.box("box", {
      size: [mm(2), mm(3), mm(4)],
    });
    const part = cad.part("part", box, { materialRef: material });
    cad.output("part", part);
    const document = cad.build();

    for (const [createKernel, expectedGenus] of [
      [createManifoldKernel, 0],
      [createOcctKernel, null],
    ] as const) {
      const kernel = await createKernel();
      try {
        const result = await evaluatePartOutputsV7(kernel, document);
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        try {
          const output = result.value.output("part");
          expect(output.geometry.kind).toBe("solid");
          if (output.geometry.kind === "solid") {
            expect(output.geometry.solid.measure().genus).toBe(expectedGenus);
          }
          expect(output.physicalMassProperties().ok).toBe(true);
        } finally {
          result.value.dispose();
        }
      } finally {
        kernel.dispose();
      }
    }
  });

  it("cleans every decomposed Manifold component on success and failure", () => {
    const run = (
      genera: readonly number[],
      throwOnDeleteIndex?: number,
    ): {
      readonly kernel: ManifoldKernel;
      readonly shape: KernelShape;
      readonly deletions: number[];
    } => {
      const deletions = genera.map(() => 0);
      const components = genera.map((genus, index) => ({
        genus: () => genus,
        delete: () => {
          deletions[index]! += 1;
          if (index === throwOnDeleteIndex) {
            throw new Error("component cleanup failed");
          }
        },
      }));
      const solid = {
        boundingBox: () => ({ min: [0, 0, 0], max: [0, 0, 0] }),
        volume: () => 0,
        surfaceArea: () => 0,
        tolerance: () => 0,
        decompose: () => components,
        delete: () => {},
      };
      const kernel = new ManifoldKernel({
        Manifold: { cube: () => solid },
      } as never);
      return {
        kernel,
        shape: kernel.box([1, 1, 1], false),
        deletions,
      };
    };

    const successful = run([0, 1, 2]);
    try {
      expect(successful.kernel.measure(successful.shape).genus).toBe(3);
      expect(successful.deletions).toEqual([1, 1, 1]);
    } finally {
      successful.kernel.disposeShape(successful.shape);
      successful.kernel.dispose();
    }

    for (const invalid of [-1, 0.5, Number.NaN]) {
      const failed = run([invalid, 0, 1]);
      try {
        expect(() => failed.kernel.measure(failed.shape)).toThrow(
          "invalid connected-component genus",
        );
        expect(failed.deletions).toEqual([1, 1, 1]);
      } finally {
        failed.kernel.disposeShape(failed.shape);
        failed.kernel.dispose();
      }
    }

    const overflow = run([Number.MAX_SAFE_INTEGER, 1]);
    try {
      expect(() => overflow.kernel.measure(overflow.shape)).toThrow(
        "sum exceeds safe integer range",
      );
      expect(overflow.deletions).toEqual([1, 1]);
    } finally {
      overflow.kernel.disposeShape(overflow.shape);
      overflow.kernel.dispose();
    }

    const cleanupFailed = run([0, 1], 0);
    try {
      expect(() => cleanupFailed.kernel.measure(cleanupFailed.shape)).toThrow(
        "component cleanup failed",
      );
      expect(cleanupFailed.deletions).toEqual([1, 1]);
    } finally {
      cleanupFailed.kernel.disposeShape(cleanupFailed.shape);
      cleanupFailed.kernel.dispose();
    }
  });
});
