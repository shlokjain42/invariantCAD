import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  kernelSupports,
  type GeometryKernel,
  type KernelShape,
  type ShapeMeasurements,
} from "../src/index.js";
import type { ResolvedLoop, ResolvedProfile } from "../src/index.js";

export interface KernelConformanceOptions {
  readonly id: string;
  readonly create: () => Promise<GeometryKernel>;
  readonly relativeTolerance?: number;
}

function rectangleLoop(
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
): ResolvedLoop {
  return {
    curves: [
      { kind: "line", start: [xMin, yMin], end: [xMax, yMin] },
      { kind: "line", start: [xMax, yMin], end: [xMax, yMax] },
      { kind: "line", start: [xMax, yMax], end: [xMin, yMax] },
      { kind: "line", start: [xMin, yMax], end: [xMin, yMin] },
    ],
  };
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

function expectBoundingBox(
  actual: ShapeMeasurements["boundingBox"],
  expected: ShapeMeasurements["boundingBox"],
  relativeTolerance: number,
): void {
  for (const bound of ["min", "max"] as const) {
    actual[bound].forEach((coordinate, index) => {
      const expectedCoordinate = expected[bound][index]!;
      expect(Math.abs(coordinate - expectedCoordinate)).toBeLessThanOrEqual(
        Math.max(
          Number.EPSILON,
          Math.max(1, Math.abs(expectedCoordinate)) * relativeTolerance,
        ),
      );
    });
  }
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
      expect(kernel.status(shape)).toEqual(
        expect.objectContaining({ ok: true }),
      );
      const measurement = kernel.measure(shape);
      expect(Number.isFinite(measurement.volume)).toBe(true);
      expect(Number.isFinite(measurement.surfaceArea)).toBe(true);
      expect(measurement.volume).toBeGreaterThan(0);
      expect(measurement.surfaceArea).toBeGreaterThan(0);
      return measurement;
    }

    it("publishes internally consistent capability metadata", () => {
      expect(kernel.id).toBe(options.id);
      expect(kernel.capabilities.protocolVersion).toBe(1);
      expect(["mesh", "brep", "sdf"]).toContain(
        kernel.capabilities.representation,
      );
      expect(new Set(kernel.capabilities.primitives).size).toBe(
        kernel.capabilities.primitives.length,
      );
      expect(new Set(kernel.capabilities.features).size).toBe(
        kernel.capabilities.features.length,
      );
      for (const feature of kernel.capabilities.features) {
        expect(
          (kernel as unknown as Record<string, unknown>)[feature],
        ).toBeTypeOf("function");
      }
      expect(new Set(kernel.capabilities.nativeImports).size).toBe(
        kernel.capabilities.nativeImports.length,
      );
      expect(new Set(kernel.capabilities.nativeExports).size).toBe(
        kernel.capabilities.nativeExports.length,
      );
      if (kernel.capabilities.nativeImports.length > 0) {
        expect(kernel.importShape).toBeTypeOf("function");
      }
      if (kernel.capabilities.nativeExports.length > 0) {
        expect(kernel.exportShape).toBeTypeOf("function");
      }
      if (kernel.capabilities.topology !== undefined) {
        expect(kernel.topology).toBeTypeOf("function");
        expect(new Set(kernel.capabilities.topology.kinds).size).toBe(
          kernel.capabilities.topology.kinds.length,
        );
        expect(["none", "feature", "history"]).toContain(
          kernel.capabilities.topology.provenance,
        );
        expect(kernel.capabilities.topology.semanticRoles).toBeTypeOf("boolean");
        expect(kernel.capabilities.topology.sketchSources).toBeTypeOf("boolean");
        expect(kernel.capabilities.topology.geometry).toBeTypeOf("boolean");
        expect(kernel.capabilities.topology.adjacency).toBeTypeOf("boolean");
      }
      if (kernelSupports(kernel.capabilities, "feature", "shell")) {
        expect(kernel.capabilities.topology).toBeDefined();
        expect(kernel.capabilities.topology?.kinds).toContain("face");
      }
    });

    it("constructs every declared primitive", () => {
      if (kernelSupports(kernel.capabilities, "primitive", "box")) {
        const box = kernel.box!([2, 3, 4], false);
        expectMeasurement(expectLiveShape(box), "volume", 24, relativeTolerance);
      }
      if (kernelSupports(kernel.capabilities, "primitive", "cylinder")) {
        const cylinder = kernel.cylinder!(4, 2, 2, false, 256);
        expectMeasurement(
          expectLiveShape(cylinder),
          "volume",
          Math.PI * 16,
          Math.max(relativeTolerance, 2e-4),
        );
      }
      if (kernelSupports(kernel.capabilities, "primitive", "sphere")) {
        const sphere = kernel.sphere!(2, 256);
        expectMeasurement(
          expectLiveShape(sphere),
          "volume",
          (4 / 3) * Math.PI * 8,
          Math.max(relativeTolerance, 5e-4),
        );
      }
    });

    it("honors the face-selected inward/outward shell contract when declared", () => {
      if (!kernelSupports(kernel.capabilities, "feature", "shell")) return;
      if (!kernelSupports(kernel.capabilities, "primitive", "box")) return;
      const box = kernel.box!([2, 3, 4], false, { feature: "box" });
      const snapshot = kernel.topology!(box);
      const top = snapshot.faces.reduce((highest, face) =>
        face.center[2] > highest.center[2] ? face : highest,
      );

      const inward = kernel.shell!(
        box,
        [top.key],
        { thickness: 0.2, direction: "inward", tolerance: 1e-6 },
        { feature: "inward" },
      );
      const inwardMeasurement = expectLiveShape(inward);
      expectMeasurement(inwardMeasurement, "volume", 8.192, relativeTolerance);
      expectBoundingBox(
        inwardMeasurement.boundingBox,
        { min: [0, 0, 0], max: [2, 3, 4] },
        relativeTolerance,
      );

      const outward = kernel.shell!(box, [top.key], {
        thickness: 0.2,
        direction: "outward",
        tolerance: 1e-6,
      });
      const outwardMeasurement = expectLiveShape(outward);
      expectMeasurement(
        outwardMeasurement,
        "volume",
        10.033569268660488,
        Math.max(relativeTolerance, 1e-8),
      );
      expectBoundingBox(
        outwardMeasurement.boundingBox,
        { min: [-0.2, -0.2, -0.2], max: [2.2, 3.2, 4] },
        relativeTolerance,
      );

      expect(() =>
        kernel.shell!(box, [], {
          thickness: 0.2,
          direction: "inward",
          tolerance: 1e-6,
        }),
      ).toThrow();
      expect(() =>
        kernel.shell!(box, [top.key], {
          thickness: 0.2,
          direction: "inward",
          tolerance: 0.2,
        }),
      ).toThrow();

      kernel.disposeShape(outward);
      kernel.disposeShape(inward);
      kernel.disposeShape(box);
    });

    it("shells curved cylindrical walls when both capabilities are declared", () => {
      if (!kernelSupports(kernel.capabilities, "feature", "shell")) return;
      if (!kernelSupports(kernel.capabilities, "primitive", "cylinder")) return;
      const cylinder = kernel.cylinder!(4, 2, 2, false, 128, {
        feature: "cylinder",
      });
      const snapshot = kernel.topology!(cylinder);
      const top = snapshot.faces.reduce((highest, face) =>
        face.center[2] > highest.center[2] ? face : highest,
      );
      const hollow = kernel.shell!(cylinder, [top.key], {
        thickness: 0.2,
        direction: "inward",
        tolerance: 1e-6,
      });
      expectMeasurement(
        expectLiveShape(hollow),
        "volume",
        Math.PI * (2 ** 2 * 4 - (2 - 0.2) ** 2 * (4 - 0.2)),
        Math.max(relativeTolerance, 2e-4),
      );
      kernel.disposeShape(hollow);
      kernel.disposeShape(cylinder);
    });

    it("extrudes and revolves exact profile semantics when declared", () => {
      const rectangle: ResolvedProfile = {
        plane: { plane: "XY", origin: [0, 0, 0] },
        outer: rectangleLoop(0, 0, 2, 3),
        holes: [],
      };
      if (kernelSupports(kernel.capabilities, "feature", "extrude")) {
        const extrusion = kernel.extrude!(rectangle, {
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
        const annulus: ResolvedProfile = {
          plane: { plane: "XY", origin: [0, 0, 0] },
          outer: rectangleLoop(2, -2, 3, 2),
          holes: [],
        };
        const revolution = kernel.revolve!(annulus, {
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
      const first = kernel.box!([2, 2, 2], false);
      const rawSecond = kernel.box!([2, 2, 2], false);
      const second = kernel.transform!(rawSecond, [
        { kind: "translate", value: [1, 0, 0] },
      ]);
      const union = kernel.boolean!("union", first, [second]);
      const intersection = kernel.boolean!("intersect", first, [second]);
      const subtraction = kernel.boolean!("subtract", first, [second]);

      expectMeasurement(expectLiveShape(first), "volume", 8, relativeTolerance);
      expectMeasurement(expectLiveShape(rawSecond), "volume", 8, relativeTolerance);
      expectMeasurement(expectLiveShape(second), "volume", 8, relativeTolerance);
      expectMeasurement(expectLiveShape(union), "volume", 12, relativeTolerance);
      expectMeasurement(expectLiveShape(intersection), "volume", 4, relativeTolerance);
      expectMeasurement(expectLiveShape(subtraction), "volume", 4, relativeTolerance);
    });

    it("extracts a valid standalone triangle mesh", () => {
      if (!kernelSupports(kernel.capabilities, "primitive", "box")) return;
      const shape = kernel.box!([2, 3, 4], true);
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
