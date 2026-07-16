import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  kernelSupports,
  type GeometryKernel,
  type KernelShape,
  type ShapeMeasurements,
} from "../src/index.js";
import type { NumericProfile } from "../src/solver.js";

export interface KernelConformanceOptions {
  readonly id: string;
  readonly create: () => Promise<GeometryKernel>;
  readonly relativeTolerance?: number;
}

function expectMeasurement(
  measurement: ShapeMeasurements,
  field: "volume" | "surfaceArea",
  expected: number,
  relativeTolerance: number,
): void {
  const error = Math.abs(measurement[field] - expected);
  expect(error).toBeLessThanOrEqual(
    Math.max(Number.EPSILON, Math.abs(expected) * relativeTolerance),
  );
}

export function geometryKernelConformance(
  options: KernelConformanceOptions,
): void {
  describe(`${options.id} geometry-kernel conformance`, () => {
    let kernel: GeometryKernel;
    const relativeTolerance = options.relativeTolerance ?? 1e-5;

    beforeEach(async () => {
      kernel = await options.create();
    });

    afterEach(() => {
      kernel.dispose();
    });

    function expectLiveShape(shape: KernelShape): ShapeMeasurements {
      expect(shape.kernel).toBe(kernel.id);
      expect(kernel.status(shape)).toBe("NoError");
      const measurement = kernel.measure(shape);
      expect(Number.isFinite(measurement.volume)).toBe(true);
      expect(Number.isFinite(measurement.surfaceArea)).toBe(true);
      expect(measurement.volume).toBeGreaterThan(0);
      expect(measurement.surfaceArea).toBeGreaterThan(0);
      return measurement;
    }

    it("publishes internally consistent capability metadata", () => {
      expect(kernel.id).toBe(options.id);
      expect(["mesh", "brep", "sdf"]).toContain(
        kernel.capabilities.representation,
      );
      expect(new Set(kernel.capabilities.primitives).size).toBe(
        kernel.capabilities.primitives.length,
      );
      expect(new Set(kernel.capabilities.features).size).toBe(
        kernel.capabilities.features.length,
      );
      expect(new Set(kernel.capabilities.exports).size).toBe(
        kernel.capabilities.exports.length,
      );
    });

    it("constructs every declared primitive", () => {
      if (kernelSupports(kernel.capabilities, "primitive", "box")) {
        const box = kernel.box([2, 3, 4], false);
        expectMeasurement(expectLiveShape(box), "volume", 24, relativeTolerance);
      }
      if (kernelSupports(kernel.capabilities, "primitive", "cylinder")) {
        const cylinder = kernel.cylinder(4, 2, 2, false, 256);
        expectMeasurement(
          expectLiveShape(cylinder),
          "volume",
          Math.PI * 16,
          Math.max(relativeTolerance, 2e-4),
        );
      }
      if (kernelSupports(kernel.capabilities, "primitive", "sphere")) {
        const sphere = kernel.sphere(2, 256);
        expectMeasurement(
          expectLiveShape(sphere),
          "volume",
          (4 / 3) * Math.PI * 8,
          Math.max(relativeTolerance, 5e-4),
        );
      }
    });

    it("extrudes and revolves exact profile semantics when declared", () => {
      const rectangle: NumericProfile = {
        plane: { plane: "XY", origin: [0, 0, 0] },
        contours: [[[0, 0], [2, 0], [2, 3], [0, 3]]],
      };
      if (kernelSupports(kernel.capabilities, "feature", "extrude")) {
        const extrusion = kernel.extrude(rectangle, {
          distance: 4,
          symmetric: false,
          twist: 0,
          scaleTop: [1, 1],
          divisions: 0,
        });
        expectMeasurement(
          expectLiveShape(extrusion),
          "volume",
          24,
          relativeTolerance,
        );
      }
      if (kernelSupports(kernel.capabilities, "feature", "revolve")) {
        const annulus: NumericProfile = {
          plane: { plane: "XY", origin: [0, 0, 0] },
          contours: [[[2, -2], [3, -2], [3, 2], [2, 2]]],
        };
        const revolution = kernel.revolve(annulus, {
          angle: Math.PI * 2,
          segments: 256,
        });
        expectMeasurement(
          expectLiveShape(revolution),
          "volume",
          Math.PI * (3 ** 2 - 2 ** 2) * 4,
          Math.max(relativeTolerance, 2e-4),
        );
      }
    });

    it("applies transforms and booleans without consuming inputs", () => {
      if (
        !kernelSupports(kernel.capabilities, "primitive", "box") ||
        !kernelSupports(kernel.capabilities, "feature", "transform") ||
        !kernelSupports(kernel.capabilities, "feature", "boolean")
      ) {
        return;
      }
      const first = kernel.box([2, 2, 2], false);
      const rawSecond = kernel.box([2, 2, 2], false);
      const second = kernel.transform(rawSecond, [
        { kind: "translate", value: [1, 0, 0] },
      ]);
      const union = kernel.boolean("union", first, [second]);
      const intersection = kernel.boolean("intersect", first, [second]);
      const subtraction = kernel.boolean("subtract", first, [second]);

      expectMeasurement(expectLiveShape(first), "volume", 8, relativeTolerance);
      expectMeasurement(expectLiveShape(rawSecond), "volume", 8, relativeTolerance);
      expectMeasurement(expectLiveShape(second), "volume", 8, relativeTolerance);
      expectMeasurement(expectLiveShape(union), "volume", 12, relativeTolerance);
      expectMeasurement(expectLiveShape(intersection), "volume", 4, relativeTolerance);
      expectMeasurement(expectLiveShape(subtraction), "volume", 4, relativeTolerance);
    });

    it("extracts a valid standalone triangle mesh", () => {
      if (!kernelSupports(kernel.capabilities, "primitive", "box")) return;
      const shape = kernel.box([2, 3, 4], true);
      const mesh = kernel.mesh(shape);
      expect(mesh.positions).toBeInstanceOf(Float32Array);
      expect(mesh.indices).toBeInstanceOf(Uint32Array);
      expect(mesh.positions.length).toBeGreaterThan(0);
      expect(mesh.positions.length % 3).toBe(0);
      expect(mesh.indices.length).toBeGreaterThan(0);
      expect(mesh.indices.length % 3).toBe(0);
      expect(Math.max(...mesh.indices)).toBeLessThan(mesh.positions.length / 3);
    });
  });
}
