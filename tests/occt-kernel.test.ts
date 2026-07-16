import { describe, expect, it } from "vitest";
import {
  angleVec3,
  createEvaluator,
  deg,
  design,
  kernelSupports,
  mm,
  plane,
  scalarVec3,
  topology,
  tf,
  vec2,
  vec3,
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

  it("enumerates reciprocal topology and applies an exact selected-edge fillet", async () => {
    const kernel = await createOcctKernel();
    try {
      const box = kernel.box!([10, 20, 30], false, { feature: "box" });
      const snapshot = kernel.topology!(box);
      expect(snapshot.history).toBe("complete");
      expect(snapshot.faces).toHaveLength(6);
      expect(snapshot.edges).toHaveLength(12);
      expect(new Set([...snapshot.faces, ...snapshot.edges].map((item) => item.key)).size).toBe(18);
      for (const face of snapshot.faces) {
        expect(face.edges.length).toBeGreaterThanOrEqual(4);
        for (const edge of face.edges) {
          expect(snapshot.edges.find((candidate) => candidate.key === edge)?.faces).toContain(
            face.key,
          );
        }
      }
      const vertical = snapshot.edges.filter((edge) => {
        const direction = edge.curve.direction;
        return direction !== undefined && Math.abs(direction[2]) > 0.999;
      });
      expect(vertical).toHaveLength(4);
      const rounded = kernel.fillet!(
        box,
        vertical.map((edge) => edge.key),
        { radius: 2 },
        { feature: "rounded" },
      );
      expect(kernel.measure(box).volume).toBeCloseTo(6_000, 8);
      expect(kernel.measure(rounded).volume).toBeCloseTo(
        6_000 - 4 * 30 * 2 ** 2 * (1 - Math.PI / 4),
        8,
      );
      kernel.disposeShape(rounded);
      kernel.disposeShape(box);
    } finally {
      kernel.dispose();
    }
  });

  it("keeps a semantic fillet selection stable across parameter changes", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("parametric-fillet");
      const height = cad.parameter.length("height", mm(30));
      const box = cad.box("box", {
        size: vec3(mm(10), mm(20), height),
      });
      const verticalEdges = topology.edges
        .createdBy(box)
        .and(topology.edges.direction(scalarVec3(0, 0, 1)))
        .exactly(4);
      cad.output(
        "rounded",
        cad.fillet("rounded", box, {
          edges: verticalEdges,
          radius: mm(2),
        }),
      );
      const document = cad.build();
      const first = await evaluator.evaluate(document);
      const second = await evaluator.evaluate(document, {
        parameters: { height: 40 },
      });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      try {
        expect(first.value.output("rounded").measure().volume).toBeCloseTo(
          6_000 - 4 * 30 * 2 ** 2 * (1 - Math.PI / 4),
          8,
        );
        expect(second.value.output("rounded").measure().volume).toBeCloseTo(
          8_000 - 4 * 40 * 2 ** 2 * (1 - Math.PI / 4),
          8,
        );
        expect(
          new TextDecoder().decode(
            first.value.output("rounded").export("step") as Uint8Array,
          ),
        ).toContain("ISO-10303-21");
      } finally {
        first.value.dispose();
        second.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("preserves extrusion roles and sketch sources through transforms", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("source-stable-fillet");
      const width = cad.parameter.length("width", mm(40));
      const height = cad.parameter.length("height", mm(20));
      const depth = cad.parameter.length("depth", mm(10));
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("outline", { width, height }),
        ),
      );
      const extrusion = cad.extrude("extrusion", profile, {
        distance: depth,
      });
      const moved = cad.transform("moved", extrusion, [
        tf.rotate(angleVec3(deg(0), deg(0), deg(90))),
        tf.translate(vec3(mm(100), mm(5), mm(7))),
      ]);
      const rightEndRim = topology.edges
        .createdBy(extrusion, {
          role: "extrude.edge.end-rim",
          source: { sketch: profile, entity: "outline.e1" },
        })
        .and(topology.edges.modifiedBy(moved))
        .select();
      cad.output(
        "rounded",
        cad.fillet("rounded", moved, {
          edges: rightEndRim,
          radius: mm(2),
        }),
      );
      const document = cad.build();
      const cases = [
        { width: 40, height: 20 },
        { width: 20, height: 40 },
        { width: 30, height: 30 },
      ];
      for (const dimensions of cases) {
        const result = await evaluator.evaluate(document, {
          parameters: dimensions,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        try {
          const expected =
            dimensions.width * dimensions.height * 10 -
            dimensions.height * 2 ** 2 * (1 - Math.PI / 4);
          expect(result.value.output("rounded").measure().volume).toBeCloseTo(
            expected,
            8,
          );
          expect(
            result.diagnostics.some((item) => item.code.startsWith("TOPOLOGY_")),
          ).toBe(false);
        } finally {
          result.value.dispose();
        }
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects provenance selectors after topology-changing booleans", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("boolean-history-boundary");
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("outline", { width: mm(20), height: mm(10) }),
        ),
      );
      const extrusion = cad.extrude("extrusion", profile, {
        distance: mm(5),
      });
      const hole = cad.cylinder("hole", {
        height: mm(10),
        radius: mm(2),
        center: true,
      });
      const drilled = cad.subtract("drilled", extrusion, [hole]);
      const originalEndRim = topology.edges
        .createdBy(extrusion, {
          role: "extrude.edge.end-rim",
          source: { sketch: profile, entity: "outline.e1" },
        })
        .select();
      cad.output(
        "rounded",
        cad.fillet("rounded", drilled, {
          edges: originalEndRim,
          radius: mm(1),
        }),
      );

      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "TOPOLOGY_HISTORY_UNAVAILABLE",
          node: "rounded",
          path: expect.stringMatching(/^\/nodes\/rounded\/edges\/query/),
          details: expect.objectContaining({
            feature: "extrusion",
            relation: "created",
            history: "partial",
          }),
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });
});
