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
});
