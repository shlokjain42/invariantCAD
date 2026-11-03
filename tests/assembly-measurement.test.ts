import { describe, expect, it } from "vitest";
import {
  EvaluatedAssembly,
  createEvaluator,
  deg,
  design,
  mm,
  scalarVec3,
  tf,
  vec3,
  type EvaluatedDesign,
  type Evaluator,
  type ShapeMeasurements,
} from "../src/index.js";

async function evaluateWith(
  evaluator: Evaluator,
  build: (cad: ReturnType<typeof design>) => void,
): Promise<EvaluatedDesign> {
  const cad = design("assembly-measurement");
  build(cad);
  const result = await evaluator.evaluate(cad.build());
  if (!result.ok) {
    throw new Error(
      result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
    );
  }
  return result.value;
}

function assemblyMeasure(result: EvaluatedDesign, name: string): ShapeMeasurements {
  const output = result.output(name);
  expect(output).toBeInstanceOf(EvaluatedAssembly);
  return output.measure();
}

function expectRelativelyClose(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    Math.max(1e-12, Math.abs(expected) * tolerance),
  );
}

function expectBoxClose(
  actual: ShapeMeasurements["boundingBox"],
  expected: ShapeMeasurements["boundingBox"],
  tolerance = 1e-9,
): void {
  for (const bound of ["min", "max"] as const) {
    for (let axis = 0; axis < 3; axis += 1) {
      expect(
        Math.abs(actual[bound][axis]! - expected[bound][axis]!),
      ).toBeLessThanOrEqual(tolerance);
    }
  }
}

describe("assembly geometric measurements", () => {
  it("matches an exact OCCT part for a single identity occurrence", async () => {
    const evaluator = await createEvaluator({ profile: "mechanical-exact" });
    try {
      const result = await evaluateWith(evaluator, (cad) => {
        const cylinder = cad.cylinder("cylinder", {
          radius: mm(10),
          height: mm(20),
        });
        const part = cad.part("part", cylinder);
        cad.output("part", part);
        cad.output(
          "assembly",
          cad.assembly("assembly", (instances) => {
            instances.instance("only", part);
          }),
        );
      });
      try {
        const part = result.output("part").measure();
        const assembly = assemblyMeasure(result, "assembly");
        const exactArea = 2 * Math.PI * 10 * 20 + 2 * Math.PI * 10 * 10;
        expectRelativelyClose(part.surfaceArea, exactArea, 1e-9);
        expect(assembly.surfaceArea).toBe(part.surfaceArea);
        expect(assembly.boundingBox).toEqual(part.boundingBox);
        expect(assembly.tolerance).toBe(part.tolerance);
        expect(assembly.tolerance).toBeGreaterThan(0);
        expect(assembly.volume).toBe(part.volume);
        expect(assembly.genus).toBeNull();
      } finally {
        result.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("aggregates kernel area, enclosing bounds, and tolerance across placements", async () => {
    const evaluator = await createEvaluator();
    try {
      const result = await evaluateWith(evaluator, (cad) => {
        const box = cad.box("box", { size: vec3(mm(1), mm(2), mm(3)) });
        const part = cad.part("part", box);
        cad.output("part", part);
        cad.output(
          "assembly",
          cad.assembly("assembly", (instances) => {
            instances.instance("identity", part);
            instances.instance("rotated", part, {
              placement: [
                tf.rotate([deg(0), deg(0), deg(90)]),
                tf.translate(vec3(mm(10), mm(0), mm(0))),
              ],
            });
            instances.instance("mirrored", part, {
              placement: [
                tf.mirror(scalarVec3(0, 0, 1)),
                tf.translate(vec3(mm(0), mm(0), mm(-5))),
              ],
            });
            instances.instance("scaled", part, {
              placement: [
                tf.scale(scalarVec3(2, 2, 2)),
                tf.translate(vec3(mm(0), mm(20), mm(0))),
              ],
            });
            instances.instance("stretched", part, {
              placement: [
                tf.scale(scalarVec3(3, 1, 1)),
                tf.translate(vec3(mm(-10), mm(0), mm(0))),
              ],
            });
          }),
        );
        cad.output(
          "empty",
          cad.assembly("empty", () => {}),
        );
      });
      try {
        const part = result.output("part").measure();
        const assembly = assemblyMeasure(result, "assembly");
        const partArea = 2 * (1 * 2 + 1 * 3 + 2 * 3);
        expectRelativelyClose(part.surfaceArea, partArea, 1e-12);
        // Rigid and mirrored occurrences keep the kernel area, a uniform
        // scale multiplies it by s^2, and the stretched 3x2x3 box is measured
        // from its tessellation.
        const stretchedArea = 2 * (3 * 2 + 3 * 3 + 2 * 3);
        expectRelativelyClose(
          assembly.surfaceArea,
          3 * partArea + 4 * partArea + stretchedArea,
          1e-6,
        );
        expectBoxClose(assembly.boundingBox, {
          min: [-10, 0, -8],
          max: [10, 24, 6],
        });
        expect(assembly.tolerance).toBeGreaterThan(0);
        expect(assembly.tolerance).toBeGreaterThanOrEqual(part.tolerance);
        expectRelativelyClose(assembly.volume, 3 * 6 + 8 * 6 + 3 * 6, 1e-9);

        expect(assemblyMeasure(result, "empty")).toMatchObject({
          volume: 0,
          surfaceArea: 0,
          centerOfMass: null,
          boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
          genus: null,
          tolerance: 0,
        });
      } finally {
        result.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("encloses occurrences placed with arbitrary rotations", async () => {
    const evaluator = await createEvaluator();
    try {
      const placement = [
        tf.rotate([deg(30), deg(45), deg(60)]),
        tf.translate(vec3(mm(7), mm(-3), mm(11))),
      ];
      const result = await evaluateWith(evaluator, (cad) => {
        const box = cad.part(
          "box-part",
          cad.box("box", { size: vec3(mm(1), mm(2), mm(3)) }),
        );
        const sphere = cad.part(
          "sphere-part",
          cad.sphere("sphere", { radius: mm(4) }),
        );
        cad.output(
          "rotated-box",
          cad.assembly("rotated-box", (instances) => {
            instances.instance("box", box, { placement });
          }),
        );
        cad.output(
          "rotated-sphere",
          cad.assembly("rotated-sphere", (instances) => {
            instances.instance("sphere", sphere, { placement });
          }),
        );
      });
      try {
        // A Float32 mesh coordinate of magnitude near 15 rounds by ~1e-6.
        const slack = 1e-5;
        const meshBounds = (name: string): ShapeMeasurements["boundingBox"] => {
          const output = result.output(name);
          expect(output).toBeInstanceOf(EvaluatedAssembly);
          const { positions } = output.mesh();
          const min: [number, number, number] = [Infinity, Infinity, Infinity];
          const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
          for (let index = 0; index < positions.length; index += 3) {
            for (let axis = 0; axis < 3; axis += 1) {
              min[axis] = Math.min(min[axis]!, positions[index + axis]!);
              max[axis] = Math.max(max[axis]!, positions[index + axis]!);
            }
          }
          return { min, max };
        };
        const expectEncloses = (
          outer: ShapeMeasurements["boundingBox"],
          inner: ShapeMeasurements["boundingBox"],
        ): void => {
          for (let axis = 0; axis < 3; axis += 1) {
            expect(outer.min[axis]!).toBeLessThanOrEqual(inner.min[axis]! + slack);
            expect(outer.max[axis]!).toBeGreaterThanOrEqual(inner.max[axis]! - slack);
          }
        };

        // A box's kernel bounding box is the box itself, so its placed
        // corners give the tight placed bounds.
        const box = assemblyMeasure(result, "rotated-box");
        const boxMesh = meshBounds("rotated-box");
        expectEncloses(box.boundingBox, boxMesh);
        expectBoxClose(box.boundingBox, boxMesh, slack);
        expectRelativelyClose(box.surfaceArea, 2 * (1 * 2 + 1 * 3 + 2 * 3), 1e-12);

        // A rotated sphere's placed kernel box encloses the sphere but is
        // larger than its tight bounds, never smaller.
        const sphere = assemblyMeasure(result, "rotated-sphere");
        const sphereMesh = meshBounds("rotated-sphere");
        expectEncloses(sphere.boundingBox, sphereMesh);
        const center = [7, -3, 11];
        for (let axis = 0; axis < 3; axis += 1) {
          expect(sphere.boundingBox.max[axis]! - center[axis]!).toBeLessThanOrEqual(
            4 * Math.sqrt(3) + slack,
          );
          expect(center[axis]! - sphere.boundingBox.min[axis]!).toBeLessThanOrEqual(
            4 * Math.sqrt(3) + slack,
          );
        }
      } finally {
        result.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });
});
