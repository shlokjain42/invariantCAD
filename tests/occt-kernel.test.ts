import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  deg,
  design,
  kernelSupports,
  mm,
  plane,
  vec2,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import { geometryKernelConformance } from "./kernel-conformance.js";

geometryKernelConformance({
  id: "occt",
  create: createOcctKernel,
  relativeTolerance: 1e-9,
});

describe("OCCT exact-kernel integration", () => {
  it("extrudes an analytic circular hole without polygonal volume loss", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("exact-hole");
      const profile = cad.sketch("profile", plane.xy(), (sketch) => {
        const outer = sketch.rectangle("outer", {
          width: mm(20),
          height: mm(10),
        });
        const hole = sketch.circle("hole", {
          center: vec2(mm(0), mm(0)),
          radius: mm(2),
          segments: 12,
        });
        return sketch.profile(outer, { holes: [hole.loop()] });
      });
      cad.output("solid", cad.extrude("solid", profile, { distance: mm(5) }));
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        const expected = (20 * 10 - Math.PI * 2 ** 2) * 5;
        const output = result.value.output("solid");
        expect(output.measure().volume).toBeCloseTo(expected, 8);
        const step = output.export("step");
        expect(step).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(step as Uint8Array)).toContain(
          "ISO-10303-21",
        );
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("round-trips STEP and BREP through native exact exchange", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(kernelSupports(kernel.capabilities, "nativeExport", "step")).toBe(
        true,
      );
      const original = kernel.box!([2, 3, 4], false);
      const expectedVolume = kernel.measure(original).volume;
      for (const format of ["step", "brep", "brep-binary"] as const) {
        const bytes = kernel.exportShape!(original, format);
        expect(bytes.byteLength).toBeGreaterThan(0);
        const imported = kernel.importShape!(bytes, format);
        expect(kernel.status(imported).ok).toBe(true);
        expect(kernel.measure(imported).volume).toBeCloseTo(expectedVolume, 8);
        kernel.disposeShape(imported);
      }
      kernel.disposeShape(original);
      expect(() => kernel.disposeShape(original)).not.toThrow();
    } finally {
      kernel.dispose();
    }
  });

  it("rejects mesh-only extrusion controls instead of approximating them", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("twisted-extrusion");
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("outer", { width: mm(10), height: mm(10) }),
        ),
      );
      cad.output(
        "solid",
        cad.extrude("solid", profile, {
          distance: mm(5),
          twist: deg(45),
        }),
      );
      const document = cad.build();
      const result = await evaluator.evaluate(document);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "KERNEL_ERROR", node: "solid" }),
      );
    } finally {
      evaluator.dispose();
    }
  });
});
