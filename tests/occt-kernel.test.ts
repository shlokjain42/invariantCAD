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
  type ProfileCurveSource,
  type ResolvedProfile,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import { geometryKernelConformance } from "./kernel-conformance.js";

geometryKernelConformance({
  id: "occt",
  create: createOcctKernel,
  relativeTolerance: 1e-9,
});

function profileCurveSource(entity: string): ProfileCurveSource {
  return {
    kind: "sketch-entity",
    sketch: "semicircle-profile",
    entity: entity as ProfileCurveSource["entity"],
  };
}

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

  it("applies exact selected-edge chamfers and supports chained chamfers", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(kernelSupports(kernel.capabilities, "feature", "chamfer")).toBe(
        true,
      );
      const box = kernel.box!([10, 20, 30], false, { feature: "box" });
      const snapshot = kernel.topology!(box);
      const vertical = snapshot.edges.filter((edge) => {
        const direction = edge.curve.direction;
        return direction !== undefined && Math.abs(direction[2]) > 0.999;
      });
      expect(vertical).toHaveLength(4);

      const beveled = kernel.chamfer!(
        box,
        vertical.map((edge) => edge.key),
        { distance: 2 },
        { feature: "beveled" },
      );
      expect(kernel.measure(box).volume).toBeCloseTo(6_000, 8);
      expect(kernel.measure(beveled).volume).toBeCloseTo(5_760, 8);
      const beveledTopology = kernel.topology!(beveled);
      expect(beveledTopology.history).toBe("partial");
      expect(beveledTopology.faces).toHaveLength(10);
      expect(beveledTopology.edges).toHaveLength(24);

      const opposite = snapshot.edges.find((edge) =>
        edge.lineage.some(
          (lineage) => lineage.role === "box.edge.x-max-y-max",
        ),
      );
      expect(opposite).toBeDefined();
      if (opposite === undefined) return;
      const first = kernel.chamfer!(box, [vertical[0]!.key], { distance: 2 });
      const firstTopology = kernel.topology!(first);
      const remainingOpposite = firstTopology.edges.find((edge) => {
        const direction = edge.curve.direction;
        return (
          direction !== undefined &&
          Math.abs(direction[2]) > 0.999 &&
          Math.abs(edge.center[0] - opposite.center[0]) < 1e-7 &&
          Math.abs(edge.center[1] - opposite.center[1]) < 1e-7
        );
      });
      expect(remainingOpposite).toBeDefined();
      if (remainingOpposite === undefined) return;
      const second = kernel.chamfer!(
        first,
        [remainingOpposite.key],
        { distance: 0.5 },
      );
      expect(kernel.status(second).ok).toBe(true);
      expect(kernel.measure(second).volume).toBeCloseTo(5_936.25, 8);

      expect(() => kernel.chamfer!(box, [], { distance: 1 })).toThrow(
        "at least one edge",
      );
      for (const distance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          kernel.chamfer!(box, [vertical[0]!.key], { distance }),
        ).toThrow("finite and positive");
      }
      expect(() =>
        kernel.chamfer!(box, [snapshot.faces[0]!.key], { distance: 1 }),
      ).toThrow("is not an edge");
      const duplicate = kernel.chamfer!(
        box,
        [vertical[0]!.key, vertical[0]!.key],
        { distance: 2 },
      );
      expect(kernel.measure(duplicate).volume).toBeCloseTo(5_940, 8);
      const foreignBox = kernel.box!([10, 20, 30], false);
      const foreignEdge = kernel.topology!(foreignBox).edges[0]!;
      expect(() =>
        kernel.chamfer!(box, [foreignEdge.key], { distance: 1 }),
      ).toThrow("is not an edge of the input shape");

      kernel.disposeShape(foreignBox);
      kernel.disposeShape(duplicate);
      kernel.disposeShape(second);
      kernel.disposeShape(first);
      kernel.disposeShape(beveled);
      kernel.disposeShape(box);
    } finally {
      kernel.dispose();
    }
  });

  it("treats selected chamfer edges as idempotent tangent-contour seeds", async () => {
    const kernel = await createOcctKernel();
    try {
      const profile: ResolvedProfile = {
        plane: { plane: "XY", origin: [0, 0, 0] },
        outer: {
          curves: [
            {
              kind: "arc",
              center: [0, 0],
              radius: 2,
              startAngle: 0,
              endAngle: Math.PI,
              clockwise: false,
              source: profileCurveSource("upper"),
            },
            {
              kind: "arc",
              center: [0, 0],
              radius: 2,
              startAngle: Math.PI,
              endAngle: Math.PI * 2,
              clockwise: false,
              source: profileCurveSource("lower"),
            },
          ],
        },
        holes: [],
      };
      const extrusion = kernel.extrude!(
        profile,
        {
          distance: 4,
          symmetric: false,
          twist: 0,
          scaleTop: [1, 1],
          divisions: 0,
        },
        { feature: "extrusion" },
      );
      const input = kernel.topology!(extrusion);
      const endRim = (entity: string) =>
        input.edges.filter((edge) =>
          edge.lineage.some(
            (lineage) =>
              lineage.feature === "extrusion" &&
              lineage.role === "extrude.edge.end-rim" &&
              lineage.source?.sketch === "semicircle-profile" &&
              lineage.source.entity === entity,
          ),
        );
      const upper = endRim("upper");
      const lower = endRim("lower");
      expect(upper).toHaveLength(1);
      expect(lower).toHaveLength(1);
      expect(upper[0]!.key).not.toBe(lower[0]!.key);

      const oneSeed = kernel.chamfer!(
        extrusion,
        [upper[0]!.key],
        { distance: 0.2 },
        { feature: "one-seed" },
      );
      const bothSeeds = kernel.chamfer!(
        extrusion,
        [upper[0]!.key, lower[0]!.key],
        { distance: 0.2 },
        { feature: "both-seeds" },
      );
      expect(kernel.measure(extrusion).volume).toBeCloseTo(16 * Math.PI, 12);
      expect(kernel.measure(oneSeed).volume).toBeCloseTo(50.02253262555907, 10);
      expect(kernel.measure(bothSeeds).volume).toBeCloseTo(
        kernel.measure(oneSeed).volume,
        12,
      );
      for (const result of [oneSeed, bothSeeds]) {
        const resultTopology = kernel.topology!(result);
        expect(resultTopology.faces).toHaveLength(6);
        expect(resultTopology.edges).toHaveLength(10);
      }

      kernel.disposeShape(bothSeeds);
      kernel.disposeShape(oneSeed);
      kernel.disposeShape(extrusion);
    } finally {
      kernel.dispose();
    }
  });

  it("rejects topology keys from another OCCT kernel instance", async () => {
    const firstKernel = await createOcctKernel();
    const secondKernel = await createOcctKernel();
    try {
      const firstBox = firstKernel.box!([10, 20, 30], false);
      const secondBox = secondKernel.box!([10, 20, 30], false);
      const firstEdge = firstKernel.topology!(firstBox).edges[0]!;
      const foreignEdge = secondKernel.topology!(secondBox).edges[0]!;
      expect(firstEdge.key).not.toBe(foreignEdge.key);
      expect(() =>
        firstKernel.chamfer!(firstBox, [foreignEdge.key], { distance: 1 }),
      ).toThrow("is not an edge of the input shape");
      firstKernel.disposeShape(firstBox);
      secondKernel.disposeShape(secondBox);
    } finally {
      firstKernel.dispose();
      secondKernel.dispose();
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

  it("keeps source-aware transformed chamfers stable across parameter changes", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("source-stable-chamfer");
      const width = cad.parameter.length("width", mm(40));
      const height = cad.parameter.length("height", mm(20));
      const depth = cad.parameter.length("depth", mm(10));
      const distance = cad.parameter.length("distance", mm(2));
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(sketch.rectangle("outline", { width, height })),
      );
      const extrusion = cad.extrude("extrusion", profile, { distance: depth });
      const moved = cad.transform("moved", extrusion, [
        tf.rotate(angleVec3(deg(0), deg(0), deg(90))),
        tf.translate(vec3(mm(100), mm(5), mm(7))),
      ]);
      const endRimFrom = (entity: "outline.e1" | "outline.e3") =>
        topology.edges
          .createdBy(extrusion, {
            role: "extrude.edge.end-rim",
            source: { sketch: profile, entity },
          })
          .and(topology.edges.modifiedBy(moved));
      const single = endRimFrom("outline.e1").select();
      const pair = endRimFrom("outline.e1")
        .or(endRimFrom("outline.e3"))
        .exactly(2);
      cad.output(
        "single",
        cad.chamfer("single", moved, { edges: single, distance }),
      );
      cad.output(
        "pair",
        cad.chamfer("pair", moved, { edges: pair, distance }),
      );
      const document = cad.build();
      const cases = [
        { width: 40, height: 20, depth: 10, distance: 2 },
        { width: 20, height: 40, depth: 10, distance: 2 },
        { width: 30, height: 30, depth: 12, distance: 3 },
      ];
      for (const dimensions of cases) {
        const result = await evaluator.evaluate(document, {
          parameters: dimensions,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        try {
          const base =
            dimensions.width * dimensions.height * dimensions.depth;
          const oneCut =
            (dimensions.height * dimensions.distance ** 2) / 2;
          expect(result.value.output("single").measure().volume).toBeCloseTo(
            base - oneCut,
            8,
          );
          expect(result.value.output("pair").measure().volume).toBeCloseTo(
            base - 2 * oneCut,
            8,
          );
          expect(
            result.diagnostics.some((item) => item.code.startsWith("TOPOLOGY_")),
          ).toBe(false);
        } finally {
          result.value.dispose();
        }
      }

      const invalid = await evaluator.evaluate(document, {
        parameters: { distance: 0 },
      });
      expect(invalid.ok).toBe(false);
      expect(invalid.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "FEATURE_INVALID",
          node: "single",
          path: "/nodes/single/distance",
          details: { value: 0 },
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("reports excessive chamfers and downstream provenance gaps structurally", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const excessiveCad = design("excessive-chamfer");
      const excessiveBox = excessiveCad.box("box", {
        size: vec3(mm(10), mm(20), mm(30)),
      });
      excessiveCad.output(
        "beveled",
        excessiveCad.chamfer("beveled", excessiveBox, {
          edges: topology.edges
            .createdBy(excessiveBox, { role: "box.edge.x-min-y-min" })
            .select(),
          distance: mm(10),
        }),
      );
      const excessive = await evaluator.evaluate(excessiveCad.build());
      expect(excessive.ok).toBe(false);
      expect(excessive.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "beveled",
          path: "/nodes/beveled",
        }),
      );

      const historyCad = design("chamfer-history-boundary");
      const historyBox = historyCad.box("box", {
        size: vec3(mm(10), mm(20), mm(30)),
      });
      const first = historyCad.chamfer("first", historyBox, {
        edges: topology.edges
          .createdBy(historyBox, { role: "box.edge.x-min-y-min" })
          .select(),
        distance: mm(1),
      });
      historyCad.output(
        "second",
        historyCad.chamfer("second", first, {
          edges: topology.edges.modifiedBy(first).atLeast(1),
          distance: mm(0.5),
        }),
      );
      const history = await evaluator.evaluate(historyCad.build());
      expect(history.ok).toBe(false);
      expect(history.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "TOPOLOGY_HISTORY_UNAVAILABLE",
          node: "second",
          path: expect.stringMatching(/^\/nodes\/second\/edges\/query/),
          details: expect.objectContaining({ history: "partial" }),
        }),
      );
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
