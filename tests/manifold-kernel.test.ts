import { describe, expect, it } from "vitest";
import { createManifoldKernel, type KernelShape } from "../src/index.js";
import { geometryKernelConformance } from "./kernel-conformance.js";

geometryKernelConformance({
  id: "manifold",
  create: createManifoldKernel,
  relativeTolerance: 1e-7,
  shapeArtifacts: "absent",
});

describe("Manifold mass-property integration", () => {
  it("recenters the emitted Float32 polyhedron before integrating large translations", async () => {
    const kernel = await createManifoldKernel();
    const box = kernel.box!([2, 4, 6], true);
    let translated: KernelShape | undefined;
    try {
      translated = kernel.transform!(box, [
        { kind: "translate", value: [1e8, -2e8, 3e8] },
      ]);
      const measured = kernel.measure(translated);
      expect(measured.volume).toBeCloseTo(48, 10);
      expect(measured.centerOfMass).toEqual([1e8, -2e8, 3e8]);
      expect(measured.inertiaTensor).toEqual([
        [208, 0, 0],
        [0, 160, 0],
        [0, 0, 80],
      ]);
    } finally {
      if (translated !== undefined) kernel.disposeShape(translated);
      kernel.disposeShape(box);
      kernel.dispose();
    }
  });

  it("certifies slender rotated solids against Float32 mesh quantization", async () => {
    const kernel = await createManifoldKernel();
    try {
      const bar = kernel.box!([2, 2, 500], true);
      const rotated = kernel.transform!(bar, [
        {
          kind: "rotate",
          value: [30, 45, 60].map((degrees) => (degrees * Math.PI) / 180) as [
            number,
            number,
            number,
          ],
        },
      ]);
      const measured = kernel.measure(rotated);
      expect(measured.volume).toBeCloseTo(2000, 6);
      for (const coordinate of measured.centerOfMass!) {
        expect(Math.abs(coordinate)).toBeLessThan(1e-3);
      }
      // The trace of the central inertia is invariant under rotation.
      const trace =
        measured.inertiaTensor[0][0] +
        measured.inertiaTensor[1][1] +
        measured.inertiaTensor[2][2];
      const expectedTrace = (2000 * 2 * (2 * 2 + 2 * 2 + 500 * 500)) / 12;
      expect(Math.abs(trace - expectedTrace) / expectedTrace).toBeLessThan(1e-5);
    } finally {
      kernel.dispose();
    }
  });

  it("certifies disconnected results whose small components are far apart", async () => {
    const kernel = await createManifoldKernel();
    try {
      const near = kernel.sphere!(5, 64);
      const far = kernel.transform!(kernel.sphere!(5, 64), [
        { kind: "translate", value: [20000, 0, 0] },
      ]);
      const union = kernel.boolean!("union", near, [far]);
      const single = kernel.measure(near);
      const measured = kernel.measure(union);
      expect(measured.volume).toBeCloseTo(2 * single.volume, 6);
      expect(measured.centerOfMass![0]).toBeCloseTo(10000, 2);
      expect(Math.abs(measured.centerOfMass![1])).toBeLessThan(1e-3);
      expect(Math.abs(measured.centerOfMass![2])).toBeLessThan(1e-3);
    } finally {
      kernel.dispose();
    }
  });
});
