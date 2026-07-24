import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
  inspectKernelDocumentBodyImportCapabilities,
  inspectKernelShapeArtifactSupport,
  kernelSupports,
  kernelSupportsDocumentBodyImport,
  momentOfInertiaAboutAxis,
  principalInertia,
  principalRadiiOfGyration,
  type GeometryKernel,
  type KernelShape,
  type ShapeMeasurements,
} from "../src/index.js";
import type { ResolvedLoop, ResolvedProfile } from "../src/index.js";
import type {
  ResolvedCircularArcPath,
  ResolvedCompositePath,
  ResolvedPolylinePath,
} from "../src/index.js";
import { EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION } from "../src/kernel.js";

export interface KernelConformanceOptions {
  readonly id: string;
  readonly create: () => Promise<GeometryKernel>;
  readonly relativeTolerance?: number;
  /** Defaults to absent; codec-capable backends must opt in explicitly. */
  readonly shapeArtifacts?: "absent" | "supported";
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

function expectVector(
  actual: readonly number[],
  expected: readonly number[],
  relativeTolerance: number,
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((coordinate, index) => {
    const expectedCoordinate = expected[index]!;
    expect(Math.abs(coordinate - expectedCoordinate)).toBeLessThanOrEqual(
      Math.max(
        Number.EPSILON,
        Math.max(1, Math.abs(expectedCoordinate)) * relativeTolerance,
      ),
    );
  });
}

function expectInertiaTensor(
  actual: ShapeMeasurements["inertiaTensor"],
  expected: ShapeMeasurements["inertiaTensor"],
  relativeTolerance: number,
): void {
  expect(actual).toHaveLength(3);
  actual.forEach((row, rowIndex) => {
    expectVector(row, expected[rowIndex]!, relativeTolerance);
  });
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
      expect(measurement.centerOfMass).not.toBeNull();
      if (measurement.centerOfMass !== null) {
        expect(measurement.centerOfMass).toHaveLength(3);
        for (const coordinate of measurement.centerOfMass) {
          expect(Number.isFinite(coordinate)).toBe(true);
        }
      }
      expect(measurement.inertiaTensor).toHaveLength(3);
      for (const row of measurement.inertiaTensor) {
        expect(row).toHaveLength(3);
        for (const entry of row) expect(Number.isFinite(entry)).toBe(true);
      }
      const inertiaScale = Math.max(
        1,
        ...measurement.inertiaTensor.flatMap((row) =>
          row.map((entry) => Math.abs(entry)),
        ),
      );
      for (let row = 0; row < 3; row += 1) {
        for (let column = row + 1; column < 3; column += 1) {
          expect(
            Math.abs(
              measurement.inertiaTensor[row]![column]! -
                measurement.inertiaTensor[column]![row]!,
            ),
          ).toBeLessThanOrEqual(
            Math.max(
              Number.EPSILON * 32 * inertiaScale,
              relativeTolerance * inertiaScale,
            ),
          );
        }
      }
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
      expect(inspectKernelShapeArtifactSupport(kernel).status).toBe(
        options.shapeArtifacts ?? "absent",
      );
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
      const exactEvolution =
        kernel.capabilities.exactIndexedTopologyEvolution;
      if (exactEvolution !== undefined) {
        const exactFeatures = Array.from(exactEvolution.features);
        expect(exactEvolution.protocolVersion).toBe(
          EXACT_INDEXED_TOPOLOGY_EVOLUTION_PROTOCOL_VERSION,
        );
        expect(
          exactFeatures.every((feature) => typeof feature === "string"),
        ).toBe(true);
        expect(new Set(exactFeatures).size).toBe(
          exactFeatures.length,
        );
        expect(kernel.capabilities.exact).toBe(true);
        for (const feature of exactFeatures) {
          expect(kernel.capabilities.features).toContain(feature);
          expect(
            kernelSupports(
              kernel.capabilities,
              "exactIndexedTopologyEvolution",
              feature,
            ),
          ).toBe(true);
        }
        if (exactFeatures.length > 0) {
          expect(kernel.capabilities.topology).toBeDefined();
          expect(kernel.capabilities.topology?.provenance).not.toBe("none");
        }
      }
      const compositeSweep = kernel.capabilities.compositeSweep;
      if (compositeSweep !== undefined) {
        const refinements = Array.from(compositeSweep.refinements);
        expect(compositeSweep.protocolVersion).toBe(
          COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
        );
        expect(new Set(refinements).size).toBe(refinements.length);
        expect(kernel.capabilities.features).toContain("compositeSweep");
        for (const refinement of refinements) {
          expect(
            kernelSupports(
              kernel.capabilities,
              "compositeSweepRefinement",
              refinement,
            ),
          ).toBe(true);
        }
      }
      const documentBodyImport =
        inspectKernelDocumentBodyImportCapabilities(kernel.capabilities);
      expect(documentBodyImport.status).not.toBe("malformed");
      if (documentBodyImport.status === "valid") {
        expect(kernel.importDocumentBody).toBeTypeOf("function");
        const formats = documentBodyImport.capabilities.formats;
        expect(new Set(formats.map((entry) => entry.format)).size).toBe(
          formats.length,
        );
        for (const entry of formats) {
          expect(new Set(entry.unitModes).size).toBe(entry.unitModes.length);
          for (const mode of entry.unitModes) {
            expect(
              kernelSupportsDocumentBodyImport(
                kernel.capabilities,
                entry.format,
                mode,
              ),
            ).toBe(true);
          }
        }
      }
      if (kernelSupports(kernel.capabilities, "feature", "draft")) {
        expect(
          kernelSupports(
            kernel.capabilities,
            "exactIndexedTopologyEvolution",
            "draft",
          ),
        ).toBe(true);
        expect(kernel.capabilities.topology?.kinds).toContain("face");
        expect(kernel.capabilities.topology?.provenance).not.toBe("none");
      }
      if (kernelSupports(kernel.capabilities, "feature", "shell")) {
        expect(kernel.capabilities.topology).toBeDefined();
        expect(kernel.capabilities.topology?.kinds).toContain("face");
      }
    });

    it("constructs every declared primitive", () => {
      if (kernelSupports(kernel.capabilities, "primitive", "box")) {
        const box = kernel.box!([2, 3, 4], false);
        const measurement = expectLiveShape(box);
        expectMeasurement(measurement, "volume", 24, relativeTolerance);
        expect(measurement.centerOfMass).not.toBeNull();
        if (measurement.centerOfMass !== null) {
          expectVector(
            measurement.centerOfMass,
            [1, 1.5, 2],
            relativeTolerance,
          );
        }
        expectInertiaTensor(
          measurement.inertiaTensor,
          [
            [50, 0, 0],
            [0, 40, 0],
            [0, 0, 26],
          ],
          relativeTolerance,
        );
        expectVector(
          principalInertia(measurement.inertiaTensor).moments,
          [26, 40, 50],
          relativeTolerance,
        );
        const principalRadii = principalRadiiOfGyration(measurement);
        expect(principalRadii).not.toBeNull();
        if (principalRadii !== null) {
          expectVector(
            principalRadii,
            [Math.sqrt(26 / 24), Math.sqrt(40 / 24), Math.sqrt(50 / 24)],
            relativeTolerance,
          );
        }
        expect(
          Math.abs(
            momentOfInertiaAboutAxis(measurement, {
              point: [0, 0, 0],
              direction: [1, 0, 0],
            }) - 200,
          ),
        ).toBeLessThanOrEqual(200 * relativeTolerance);
        kernel.disposeShape(box);
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

    it("transports center of mass and central inertia through rigid transforms", () => {
      if (
        !kernelSupports(kernel.capabilities, "primitive", "box") ||
        !kernelSupports(kernel.capabilities, "feature", "transform")
      ) {
        return;
      }
      const box = kernel.box!([2, 3, 4], false);
      let transformed: KernelShape | undefined;
      try {
        transformed = kernel.transform!(box, [
          { kind: "rotate", value: [0, 0, Math.PI / 2] },
          { kind: "translate", value: [10, -2, 3] },
        ]);
        const measurement = expectLiveShape(transformed);
        expect(measurement.centerOfMass).not.toBeNull();
        if (measurement.centerOfMass !== null) {
          expectVector(
            measurement.centerOfMass,
            [8.5, -1, 5],
            Math.max(relativeTolerance, 1e-7),
          );
        }
        expectInertiaTensor(
          measurement.inertiaTensor,
          [
            [40, 0, 0],
            [0, 50, 0],
            [0, 0, 26],
          ],
          Math.max(relativeTolerance, 1e-7),
        );
      } finally {
        if (transformed !== undefined) kernel.disposeShape(transformed);
        kernel.disposeShape(box);
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

    it("honors the whole-solid inward/outward offset contract when declared", () => {
      if (!kernelSupports(kernel.capabilities, "feature", "offset")) return;
      if (!kernelSupports(kernel.capabilities, "primitive", "box")) return;
      const box = kernel.box!([2, 3, 4], false, { feature: "box" });

      const outward = kernel.offset!(
        box,
        { distance: 0.2, direction: "outward", tolerance: 1e-6 },
        { feature: "outward" },
      );
      const outwardMeasurement = expectLiveShape(outward);
      expectMeasurement(
        outwardMeasurement,
        "volume",
        35.564483717128844,
        Math.max(relativeTolerance, 1e-8),
      );
      expectBoundingBox(
        outwardMeasurement.boundingBox,
        { min: [-0.2, -0.2, -0.2], max: [2.2, 3.2, 4.2] },
        Math.max(relativeTolerance, 1e-8),
      );

      const inward = kernel.offset!(box, {
        distance: 0.2,
        direction: "inward",
        tolerance: 1e-6,
      });
      const inwardMeasurement = expectLiveShape(inward);
      expectMeasurement(
        inwardMeasurement,
        "volume",
        14.976,
        relativeTolerance,
      );
      expectBoundingBox(
        inwardMeasurement.boundingBox,
        { min: [0.2, 0.2, 0.2], max: [1.8, 2.8, 3.8] },
        relativeTolerance,
      );

      expect(() =>
        kernel.offset!(box, {
          distance: 0,
          direction: "outward",
          tolerance: 1e-6,
        }),
      ).toThrow();
      expect(() =>
        kernel.offset!(box, {
          distance: 0.2,
          direction: "outward",
          tolerance: 0.2,
        }),
      ).toThrow();
      expect(() =>
        kernel.offset!(box, {
          distance: 1,
          direction: "inward",
          tolerance: 1e-6,
        }),
      ).toThrow();

      if (
        kernelSupports(kernel.capabilities, "feature", "transform") &&
        kernelSupports(kernel.capabilities, "feature", "boolean")
      ) {
        const translated = kernel.transform!(box, [
          { kind: "translate", value: [4, 0, 0] },
        ]);
        const disconnected = kernel.boolean!("union", box, [translated]);
        expect(() =>
          kernel.offset!(disconnected, {
            distance: 0.2,
            direction: "outward",
            tolerance: 1e-6,
          }),
        ).toThrow();
        kernel.disposeShape(disconnected);
        kernel.disposeShape(translated);
      }

      kernel.disposeShape(inward);
      kernel.disposeShape(outward);
      kernel.disposeShape(box);
    });

    it("offsets curved cylindrical walls when both capabilities are declared", () => {
      if (!kernelSupports(kernel.capabilities, "feature", "offset")) return;
      if (!kernelSupports(kernel.capabilities, "primitive", "cylinder")) return;
      const cylinder = kernel.cylinder!(4, 2, 2, false, 128, {
        feature: "cylinder",
      });
      const outward = kernel.offset!(cylinder, {
        distance: 0.2,
        direction: "outward",
        tolerance: 1e-6,
      });
      expectMeasurement(
        expectLiveShape(outward),
        "volume",
        66.6708606929675,
        Math.max(relativeTolerance, 2e-4),
      );
      const inward = kernel.offset!(cylinder, {
        distance: 0.2,
        direction: "inward",
        tolerance: 1e-6,
      });
      expectMeasurement(
        expectLiveShape(inward),
        "volume",
        Math.PI * 1.8 ** 2 * 3.6,
        Math.max(relativeTolerance, 2e-4),
      );
      kernel.disposeShape(inward);
      kernel.disposeShape(outward);
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

    it("lofts ordered ruled sections when declared", () => {
      if (!kernelSupports(kernel.capabilities, "feature", "loft")) return;
      const profiles: readonly ResolvedProfile[] = [
        {
          plane: { plane: "XY", origin: [0, 0, 0] },
          outer: rectangleLoop(0, 0, 2, 3),
          holes: [],
        },
        {
          plane: { plane: "XY", origin: [0, 0, 5] },
          outer: rectangleLoop(0, 0, 4, 6),
          holes: [],
        },
      ];
      const loft = kernel.loft!(profiles, { ruled: true }, { tolerance: 1e-7 });
      const measurement = expectLiveShape(loft);
      expectMeasurement(measurement, "volume", 70, relativeTolerance);
      expectBoundingBox(
        measurement.boundingBox,
        { min: [0, 0, 0], max: [4, 6, 5] },
        Math.max(relativeTolerance, 1e-7),
      );
      kernel.disposeShape(loft);
    });

    it("sweeps a closed profile along an open right-corner path when declared", () => {
      if (!kernelSupports(kernel.capabilities, "feature", "sweep")) return;
      const profile: ResolvedProfile = {
        plane: { plane: "YZ", origin: [0, 0, 0] },
        outer: rectangleLoop(-1, -1, 1, 1),
        holes: [],
      };
      const path: ResolvedPolylinePath = {
        kind: "polyline",
        points: [
          [0, 0, 0],
          [5, 0, 0],
          [5, 5, 0],
        ],
        closed: false,
      };
      const sweep = kernel.sweep!(
        profile,
        path,
        { frame: "corrected-frenet", transition: "right-corner" },
        { tolerance: 1e-7 },
      );
      expectMeasurement(expectLiveShape(sweep), "volume", 40, relativeTolerance);
      kernel.disposeShape(sweep);
    });

    it("sweeps a closed profile along an exact circular arc when declared", () => {
      if (
        !kernelSupports(
          kernel.capabilities,
          "feature",
          "circularArcSweep",
        )
      ) {
        return;
      }
      const profile: ResolvedProfile = {
        plane: { plane: "YZ", origin: [0, 0, 0] },
        outer: rectangleLoop(-1, -1, 1, 1),
        holes: [],
      };
      const path: ResolvedCircularArcPath = {
        kind: "circularArc",
        start: [0, 0, 0],
        through: [Math.SQRT1_2 * 10, (1 - Math.SQRT1_2) * 10, 0],
        end: [10, 10, 0],
        closed: false,
      };
      const sweep = kernel.circularArcSweep!(
        profile,
        path,
        { frame: "corrected-frenet", transition: "right-corner" },
        { tolerance: 1e-7 },
      );
      expectMeasurement(
        expectLiveShape(sweep),
        "volume",
        20 * Math.PI,
        relativeTolerance,
      );
      kernel.disposeShape(sweep);
    });

    it("sweeps a closed profile along an exact composite path when declared", () => {
      if (!kernelSupports(kernel.capabilities, "feature", "compositeSweep")) {
        return;
      }
      const profile: ResolvedProfile = {
        plane: { plane: "YZ", origin: [0, 0, 0] },
        outer: rectangleLoop(-1, -1, 1, 1),
        holes: [],
      };
      const path: ResolvedCompositePath = {
        kind: "composite",
        start: [0, 0, 0],
        segments: [
          { kind: "line", end: [5, 0, 0] },
          {
            kind: "circularArc",
            through: [5 + 5 * Math.SQRT1_2, 5 - 5 * Math.SQRT1_2, 0],
            end: [10, 5, 0],
          },
          { kind: "line", end: [10, 10, 0] },
        ],
        closed: false,
      };
      const sweep = kernel.compositeSweep!(
        profile,
        path,
        { frame: "corrected-frenet", transition: "right-corner" },
        { tolerance: 1e-7 },
      );
      expectMeasurement(
        expectLiveShape(sweep),
        "volume",
        40 + 10 * Math.PI,
        relativeTolerance,
      );
      kernel.disposeShape(sweep);
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
