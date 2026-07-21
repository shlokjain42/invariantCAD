import initializeManifold from "manifold-3d";
import { describe, expect, it } from "vitest";
import {
  createManifoldKernel,
  inspectKernelShapeArtifactSupport,
} from "../src/index.js";

describe("Manifold shape-artifact feasibility boundary", () => {
  it("characterizes the full public Mesh round trip as semantically lossy", async () => {
    const module = await initializeManifold();
    module.setup();

    const centered = module.Manifold.cube([1, 2, 3], true);
    const source = centered.translate([0.1, 0, 0]);
    let reconstructed: InstanceType<typeof module.Manifold> | undefined;
    let restoredTolerance: InstanceType<typeof module.Manifold> | undefined;
    try {
      const emitted = source.getMesh();
      const portable = new module.Mesh({
        numProp: emitted.numProp,
        vertProperties: emitted.vertProperties.slice(),
        triVerts: emitted.triVerts.slice(),
        mergeFromVert: emitted.mergeFromVert.slice(),
        mergeToVert: emitted.mergeToVert.slice(),
        runIndex: emitted.runIndex.slice(),
        runOriginalID: emitted.runOriginalID.slice(),
        runTransform: emitted.runTransform.slice(),
        faceID: emitted.faceID.slice(),
        halfedgeTangent: emitted.halfedgeTangent.slice(),
        tolerance: emitted.tolerance,
      });
      // manifold-3d 3.5.1 emits and accepts this field at runtime, although its
      // public MeshOptions declaration currently omits it.
      portable.runFlags = emitted.runFlags.slice();

      reconstructed = new module.Manifold(portable);

      expect(source.status()).toBe("NoError");
      expect(reconstructed.status()).toBe("NoError");
      expect(source.volume()).toBe(6);
      expect(reconstructed.volume()).toBe(6.000000178813934);

      // getMesh() crosses Manifold's internal double-precision boundary through
      // Float32 mesh data. Even after copying every public Mesh field, the
      // evaluator-visible native tolerance cannot survive that boundary by
      // itself.
      expect(source.tolerance()).toBe(1.5e-12);
      expect(emitted.tolerance).toBe(1.7881393432617188e-7);
      expect(reconstructed.tolerance()).toBe(1.7881393432617188e-7);
      expect(reconstructed.tolerance()).not.toBe(source.tolerance());

      // A sidecar can restore the tolerance scalar, but not the source's
      // double-precision geometry or evaluator-visible measurements.
      restoredTolerance = reconstructed.setTolerance(source.tolerance());
      expect(restoredTolerance.tolerance()).toBe(source.tolerance());
      expect(source.boundingBox()).toEqual({
        min: [-0.4, -1, -1.5],
        max: [0.6, 1, 1.5],
      });
      expect(restoredTolerance.boundingBox()).toEqual({
        min: [-0.4000000059604645, -1, -1.5],
        max: [0.6000000238418579, 1, 1.5],
      });
      expect(restoredTolerance.volume()).toBe(6.000000178813934);
      expect(restoredTolerance.volume()).not.toBe(source.volume());
    } finally {
      restoredTolerance?.delete();
      reconstructed?.delete();
      source.delete();
      centered.delete();
    }
  });

  it("keeps the production Manifold kernel artifact capability absent", async () => {
    const kernel = await createManifoldKernel();
    try {
      expect(inspectKernelShapeArtifactSupport(kernel)).toEqual({
        status: "absent",
      });
      expect(kernel.capabilities.shapeArtifacts).toBeUndefined();
      expect(kernel.encodeShapeArtifact).toBeUndefined();
      expect(kernel.decodeShapeArtifact).toBeUndefined();
    } finally {
      kernel.dispose();
    }
  });
});
