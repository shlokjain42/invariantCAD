import { describe, expect, it } from "vitest";
import { OcctKernel as RawOcctKernel } from "occt-wasm";
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

  it("normalizes reversed imported solids before directional features", async () => {
    const raw = await RawOcctKernel.init();
    let reversedBrep: string;
    try {
      const box = raw.makeBox(10, 20, 30);
      const reversed = raw.reverseShape(box);
      expect(raw.isValid(reversed)).toBe(true);
      expect(raw.getVolume(reversed)).toBeCloseTo(-6_000, 8);
      reversedBrep = raw.toBREP(reversed);
      raw.release(reversed);
      raw.release(box);
    } finally {
      raw[Symbol.dispose]();
    }

    const kernel = await createOcctKernel();
    try {
      const imported = kernel.importShape!(reversedBrep, "brep");
      expect(kernel.measure(imported).volume).toBeCloseTo(6_000, 8);
      const top = kernel
        .topology!(imported)
        .faces.reduce((highest, face) =>
          face.center[2] > highest.center[2] ? face : highest,
        );
      const inward = kernel.shell!(imported, [top.key], {
        thickness: 2,
        direction: "inward",
        tolerance: 1e-6,
      });
      expect(kernel.measure(inward).volume).toBeCloseTo(3_312, 8);
      expect(kernel.measure(inward).boundingBox).toEqual({
        min: [0, 0, 0],
        max: [10, 20, 30],
      });
      const outward = kernel.shell!(imported, [top.key], {
        thickness: 1,
        direction: "outward",
        tolerance: 1e-6,
      });
      expect(kernel.measure(outward).volume).toBeCloseTo(2_143.466064545511, 8);

      const expanded = kernel.offset!(imported, {
        distance: 1,
        direction: "outward",
        tolerance: 1e-6,
      });
      expect(kernel.measure(expanded).volume).toBeCloseTo(
        8_392.684349493147,
        8,
      );
      const shrunk = kernel.offset!(imported, {
        distance: 1,
        direction: "inward",
        tolerance: 1e-6,
      });
      expect(kernel.measure(shrunk).volume).toBeCloseTo(4_032, 8);

      kernel.disposeShape(shrunk);
      kernel.disposeShape(expanded);
      kernel.disposeShape(outward);
      kernel.disposeShape(inward);
      kernel.disposeShape(imported);
    } finally {
      kernel.dispose();
    }
  });

  it("rejects feature inputs with loose topology outside their sole solid", async () => {
    const raw = await RawOcctKernel.init();
    let mixedBrep: string;
    try {
      const box = raw.makeBox(10, 20, 30);
      const reversedBox = raw.reverseShape(box);
      const other = raw.makeBox(1, 1, 1);
      const otherFaces = raw.getSubShapes(other, "face");
      const looseTop = otherFaces.find((face) => {
        const bounds = raw.getBoundingBox(face, false);
        return (
          Math.abs(bounds.zmin - 1) < 1e-10 &&
          Math.abs(bounds.zmax - 1) < 1e-10
        );
      });
      expect(looseTop).toBeDefined();
      if (looseTop === undefined) throw new Error("Missing loose top face");
      const mixed = raw.makeCompound([reversedBox, looseTop]);
      mixedBrep = raw.toBREP(mixed);
      raw.release(mixed);
      otherFaces.forEach((face) => raw.release(face));
      raw.release(other);
      raw.release(reversedBox);
      raw.release(box);
    } finally {
      raw[Symbol.dispose]();
    }

    const kernel = await createOcctKernel();
    try {
      const imported = kernel.importShape!(mixedBrep, "brep");
      const snapshot = kernel.topology!(imported);
      const looseTop = snapshot.faces.find(
        (face) =>
          Math.abs(face.area - 1) < 1e-8 &&
          Math.abs(face.center[2] - 1) < 1e-8,
      );
      expect(looseTop?.surface).toEqual({
        kind: "plane",
        normal: [0, 0, 1],
      });
      const top = snapshot.faces.reduce((highest, face) =>
        face.center[2] > highest.center[2] ? face : highest,
      );
      expect(() =>
        kernel.shell!(imported, [top.key], {
          thickness: 1,
          direction: "inward",
          tolerance: 1e-6,
        }),
      ).toThrow("loose topology outside its solid");
      expect(() =>
        kernel.offset!(imported, {
          distance: 1,
          direction: "outward",
          tolerance: 1e-6,
        }),
      ).toThrow("loose topology outside its solid");
      kernel.disposeShape(imported);
    } finally {
      kernel.dispose();
    }
  });

  it("rejects wrappers that duplicate one of their solid's own subshapes", async () => {
    const raw = await RawOcctKernel.init();
    let duplicateBrep: string;
    try {
      const box = raw.makeBox(10, 20, 30);
      const faces = raw.getSubShapes(box, "face");
      const duplicate = raw.makeCompound([box, faces[0]!]);
      duplicateBrep = raw.toBREP(duplicate);
      raw.release(duplicate);
      faces.forEach((face) => raw.release(face));
      raw.release(box);
    } finally {
      raw[Symbol.dispose]();
    }

    const kernel = await createOcctKernel();
    try {
      const imported = kernel.importShape!(duplicateBrep, "brep");
      const face = kernel.topology!(imported).faces[0]!;
      expect(() =>
        kernel.offset!(imported, {
          distance: 1,
          direction: "outward",
          tolerance: 1e-6,
        }),
      ).toThrow("loose topology outside its solid");
      expect(() =>
        kernel.shell!(imported, [face.key], {
          thickness: 1,
          direction: "inward",
          tolerance: 1e-6,
        }),
      ).toThrow("loose topology outside its solid");
      kernel.disposeShape(imported);
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
      const foreignFaces = secondKernel.topology!(secondBox).faces;
      const foreignFace = foreignFaces[0]!;
      expect(() =>
        firstKernel.shell!(firstBox, [foreignFace.key], {
          thickness: 1,
          direction: "inward",
          tolerance: 1e-6,
        }),
      ).toThrow("is not a face of the input shape");
      expect(() =>
        firstKernel.shell!(
          firstBox,
          foreignFaces.map((face) => face.key),
          {
            thickness: 1,
            direction: "inward",
            tolerance: 1e-6,
          },
        ),
      ).toThrow("is not a face of the input shape");
      expect(() =>
        firstKernel.offset!(secondBox, {
          distance: 1,
          direction: "outward",
          tolerance: 1e-6,
        }),
      ).toThrow("Expected a live OCCT kernel shape");
      expect(() => firstKernel.measure(secondBox)).toThrow(
        "Expected a live OCCT kernel shape",
      );
      expect(() => firstKernel.disposeShape(secondBox)).toThrow(
        "owned by this kernel",
      );
      firstKernel.disposeShape(firstBox);
      secondKernel.disposeShape(secondBox);
    } finally {
      firstKernel.dispose();
      secondKernel.dispose();
    }
  });

  it("hollows exact solids through selected opening faces", async () => {
    const kernel = await createOcctKernel();
    try {
      const shellOptions = (
        thickness: number,
        direction: "inward" | "outward" = "inward",
        tolerance = 1e-6,
      ) => ({ thickness, direction, tolerance });
      expect(kernelSupports(kernel.capabilities, "feature", "shell")).toBe(true);
      const box = kernel.box!([10, 20, 30], false, { feature: "box" });
      const snapshot = kernel.topology!(box);
      const faceWithRole = (role: string) =>
        snapshot.faces.find((face) =>
          face.lineage.some((lineage) => lineage.role === role),
        );
      const top = faceWithRole("box.face.z-max");
      const bottom = faceWithRole("box.face.z-min");
      expect(top).toBeDefined();
      expect(bottom).toBeDefined();
      if (top === undefined || bottom === undefined) return;

      const hollow = kernel.shell!(
        box,
        [top.key],
        shellOptions(2),
        { feature: "hollow" },
      );
      expect(kernel.measure(box).volume).toBeCloseTo(6_000, 8);
      expect(kernel.measure(hollow).volume).toBeCloseTo(3_312, 8);
      expect(kernel.measure(hollow).boundingBox).toEqual(
        kernel.measure(box).boundingBox,
      );
      const hollowTopology = kernel.topology!(hollow);
      expect(hollowTopology.history).toBe("partial");
      expect(hollowTopology.faces).toHaveLength(11);
      expect(hollowTopology.edges).toHaveLength(24);

      const tunnel = kernel.shell!(
        box,
        [top.key, bottom.key],
        shellOptions(2),
      );
      expect(kernel.measure(tunnel).volume).toBeCloseTo(3_120, 8);
      const duplicate = kernel.shell!(
        box,
        [top.key, top.key],
        shellOptions(2),
      );
      expect(kernel.measure(duplicate).volume).toBeCloseTo(3_312, 8);

      const outward = kernel.shell!(box, [top.key], shellOptions(1, "outward"));
      expect(kernel.measure(outward).volume).toBeCloseTo(2_143.466064545511, 8);
      expect(kernel.measure(outward).boundingBox).toEqual({
        min: [-1, -1, -1],
        max: [11, 21, 30],
      });
      expect(kernel.topology!(outward).faces).toHaveLength(23);

      const allButTop = snapshot.faces
        .filter((face) => face.key !== top.key)
        .map((face) => face.key);
      const inwardSlab = kernel.shell!(box, allButTop, shellOptions(1));
      expect(kernel.measure(inwardSlab).volume).toBeCloseTo(200, 8);
      expect(kernel.measure(inwardSlab).boundingBox).toEqual({
        min: [0, 0, 29],
        max: [10, 20, 30],
      });
      const outwardSlab = kernel.shell!(
        box,
        allButTop,
        shellOptions(1, "outward"),
      );
      expect(kernel.measure(outwardSlab).volume).toBeCloseTo(200, 8);
      expect(kernel.measure(outwardSlab).boundingBox).toEqual({
        min: [0, 0, 30],
        max: [10, 20, 31],
      });

      expect(() => kernel.shell!(box, [], shellOptions(1))).toThrow(
        "at least one opening face",
      );
      for (const thickness of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => kernel.shell!(box, [top.key], shellOptions(thickness))).toThrow(
          "finite and positive",
        );
      }
      expect(() =>
        kernel.shell!(box, [snapshot.edges[0]!.key], shellOptions(1)),
      ).toThrow("is not a face");
      expect(() =>
        kernel.shell!(box, [top.key], shellOptions(1, "inward", 0)),
      ).toThrow("tolerance must be finite and positive");
      expect(() =>
        kernel.shell!(box, [top.key], shellOptions(1, "inward", 1)),
      ).toThrow("less than its thickness");
      expect(() =>
        kernel.shell!(
          box,
          snapshot.faces.map((face) => face.key),
          shellOptions(1),
        ),
      ).toThrow("at least one retained face");
      expect(() => kernel.shell!(box, [top.key], shellOptions(5.1))).toThrow(
        "did not produce a hollowed solid",
      );
      expect(() => kernel.shell!(box, [top.key], shellOptions(5))).toThrow(
        "invalid solid",
      );

      const translated = kernel.transform!(box, [
        { kind: "translate", value: [20, 0, 0] },
      ]);
      const disconnected = kernel.boolean!("union", box, [translated]);
      expect(() =>
        kernel.shell!(disconnected, [top.key], shellOptions(1)),
      ).toThrow("exactly one solid");

      kernel.disposeShape(disconnected);
      kernel.disposeShape(translated);
      kernel.disposeShape(outwardSlab);
      kernel.disposeShape(inwardSlab);
      kernel.disposeShape(outward);
      kernel.disposeShape(duplicate);
      kernel.disposeShape(tunnel);
      kernel.disposeShape(hollow);
      kernel.disposeShape(box);
    } finally {
      kernel.dispose();
    }
  });

  it("offsets exact solids with fixed round joins and strict collapse checks", async () => {
    const raw = await RawOcctKernel.init();
    let compoundBrep: string;
    try {
      const box = raw.makeBox(10, 20, 30);
      const compound = raw.makeCompound([box]);
      compoundBrep = raw.toBREP(compound);
      raw.release(compound);
      raw.release(box);
    } finally {
      raw[Symbol.dispose]();
    }

    const kernel = await createOcctKernel();
    try {
      expect(kernelSupports(kernel.capabilities, "feature", "offset")).toBe(
        true,
      );
      const box = kernel.box!([10, 20, 30], false, { feature: "box" });
      const expanded = kernel.offset!(
        box,
        { distance: 1, direction: "outward", tolerance: 1e-6 },
        { feature: "expanded" },
      );
      const expandedMeasurement = kernel.measure(expanded);
      expect(expandedMeasurement.volume).toBeCloseTo(8_392.684349493147, 8);
      expect(expandedMeasurement.surfaceArea).toBeCloseTo(
        2_589.55748905025,
        8,
      );
      expect(expandedMeasurement.boundingBox.min).toEqual([-1, -1, -1]);
      expect(expandedMeasurement.boundingBox.max[0]).toBeCloseTo(11, 10);
      expect(expandedMeasurement.boundingBox.max[1]).toBeCloseTo(21, 10);
      expect(expandedMeasurement.boundingBox.max[2]).toBeCloseTo(31, 10);
      const expandedTopology = kernel.topology!(expanded);
      expect(expandedTopology.history).toBe("partial");
      expect(expandedTopology.faces).toHaveLength(26);
      expect(expandedTopology.edges).toHaveLength(48);
      expect(
        expandedTopology.faces.filter((face) => face.surface.kind === "plane"),
      ).toHaveLength(6);
      expect(
        expandedTopology.faces.filter(
          (face) => face.surface.kind === "cylinder",
        ),
      ).toHaveLength(12);
      expect(
        expandedTopology.faces.filter((face) => face.surface.kind === "sphere"),
      ).toHaveLength(8);

      const shrunk = kernel.offset!(box, {
        distance: 1,
        direction: "inward",
        tolerance: 1e-6,
      });
      const shrunkMeasurement = kernel.measure(shrunk);
      expect(shrunkMeasurement.volume).toBeCloseTo(4_032, 8);
      expect(shrunkMeasurement.surfaceArea).toBeCloseTo(1_744, 8);
      expect(shrunkMeasurement.boundingBox).toEqual({
        min: [1, 1, 1],
        max: [9, 19, 29],
      });
      const shrunkTopology = kernel.topology!(shrunk);
      expect(shrunkTopology.history).toBe("partial");
      expect(shrunkTopology.faces).toHaveLength(6);
      expect(shrunkTopology.edges).toHaveLength(12);

      const wrapped = kernel.importShape!(compoundBrep, "brep");
      expect(kernel.measure(wrapped).volume).toBeCloseTo(6_000, 8);
      const wrappedOffset = kernel.offset!(wrapped, {
        distance: 1,
        direction: "outward",
        tolerance: 1e-6,
      });
      expect(kernel.status(wrappedOffset).ok).toBe(true);
      expect(kernel.measure(wrappedOffset).volume).toBeCloseTo(
        8_392.684349493147,
        8,
      );

      for (const distance of [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]) {
        expect(() =>
          kernel.offset!(box, {
            distance,
            direction: "outward",
            tolerance: 1e-6,
          }),
        ).toThrow("distance must be finite and positive");
      }
      for (const tolerance of [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]) {
        expect(() =>
          kernel.offset!(box, {
            distance: 1,
            direction: "outward",
            tolerance,
          }),
        ).toThrow("tolerance must be finite and positive");
      }
      expect(() =>
        kernel.offset!(box, {
          distance: 1,
          direction: "sideways" as any,
          tolerance: 1e-6,
        }),
      ).toThrow("'outward' or 'inward'");
      expect(() =>
        kernel.offset!(box, {
          distance: 1,
          direction: "outward",
          tolerance: 1,
        }),
      ).toThrow("less than its distance");
      const abort = new AbortController();
      abort.abort();
      expect(() =>
        kernel.offset!(
          box,
          { distance: 1, direction: "outward", tolerance: 1e-6 },
          { signal: abort.signal },
        ),
      ).toThrow("aborted");
      for (const distance of [5, 5.000001, 5.1]) {
        expect(() =>
          kernel.offset!(box, {
            distance,
            direction: "inward",
            tolerance: 1e-6,
          }),
        ).toThrow();
      }
      expect(kernel.status(box).ok).toBe(true);

      const overlapping = kernel.transform!(box, [
        { kind: "translate", value: [5, 0, 0] },
      ]);
      const connected = kernel.boolean!("union", box, [overlapping]);
      const connectedOffset = kernel.offset!(connected, {
        distance: 1,
        direction: "outward",
        tolerance: 1e-6,
      });
      expect(kernel.measure(connectedOffset).volume).toBeCloseTo(
        11_908.392312763915,
        8,
      );
      expect(kernel.status(connectedOffset).ok).toBe(true);

      const translated = kernel.transform!(box, [
        { kind: "translate", value: [20, 0, 0] },
      ]);
      const disconnected = kernel.boolean!("union", box, [translated]);
      expect(() =>
        kernel.offset!(disconnected, {
          distance: 1,
          direction: "outward",
          tolerance: 1e-6,
        }),
      ).toThrow("exactly one solid");

      kernel.disposeShape(disconnected);
      kernel.disposeShape(translated);
      kernel.disposeShape(connectedOffset);
      kernel.disposeShape(connected);
      kernel.disposeShape(overlapping);
      kernel.disposeShape(wrappedOffset);
      kernel.disposeShape(wrapped);
      kernel.disposeShape(shrunk);
      kernel.disposeShape(expanded);
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

  it("keeps source-aware transformed shell openings stable across parameters", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("source-stable-shell");
      const width = cad.parameter.length("width", mm(40));
      const height = cad.parameter.length("height", mm(20));
      const depth = cad.parameter.length("depth", mm(10));
      const thickness = cad.parameter.length("thickness", mm(2));
      const tolerance = cad.parameter.length("tolerance", mm(1e-6));
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(sketch.rectangle("outline", { width, height })),
      );
      const extrusion = cad.extrude("extrusion", profile, { distance: depth });
      const moved = cad.transform("moved", extrusion, [
        tf.rotate(angleVec3(deg(0), deg(0), deg(90))),
        tf.translate(vec3(mm(100), mm(5), mm(7))),
      ]);
      const rightSide = topology.faces
        .createdBy(extrusion, {
          role: "extrude.face.side",
          source: { sketch: profile, entity: "outline.e1" },
        })
        .and(topology.faces.modifiedBy(moved))
        .select();
      cad.output(
        "hollow",
        cad.shell("hollow", moved, {
          openings: rightSide,
          thickness,
          tolerance,
        }),
      );
      const document = cad.build();
      const cases = [
        { width: 40, height: 20, depth: 10, thickness: 2 },
        { width: 20, height: 40, depth: 10, thickness: 2 },
        { width: 30, height: 30, depth: 12, thickness: 3 },
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
          const cavity =
            (dimensions.width - dimensions.thickness) *
            (dimensions.height - 2 * dimensions.thickness) *
            (dimensions.depth - 2 * dimensions.thickness);
          expect(result.value.output("hollow").measure().volume).toBeCloseTo(
            base - cavity,
            8,
          );
          expect(
            result.diagnostics.some((item) => item.code.startsWith("TOPOLOGY_")),
          ).toBe(false);
        } finally {
          result.value.dispose();
        }
      }

      const zeroThickness = await evaluator.evaluate(document, {
        parameters: { thickness: 0 },
      });
      expect(zeroThickness.ok).toBe(false);
      expect(zeroThickness.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "FEATURE_INVALID",
          node: "hollow",
          path: "/nodes/hollow/thickness",
          details: { value: 0 },
        }),
      );

      const excessiveTolerance = await evaluator.evaluate(document, {
        parameters: { tolerance: 2, thickness: 2 },
      });
      expect(excessiveTolerance.ok).toBe(false);
      expect(excessiveTolerance.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "FEATURE_INVALID",
          node: "hollow",
          path: "/nodes/hollow/tolerance",
          details: { tolerance: 2, thickness: 2 },
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("keeps transformed whole-solid offsets stable across parameter changes", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("parametric-offset");
      const width = cad.parameter.length("width", mm(40));
      const height = cad.parameter.length("height", mm(20));
      const depth = cad.parameter.length("depth", mm(10));
      const distance = cad.parameter.length("distance", mm(1));
      const box = cad.box("box", { size: vec3(width, height, depth) });
      const moved = cad.transform("moved", box, [
        tf.rotate(angleVec3(deg(0), deg(0), deg(90))),
        tf.translate(vec3(mm(100), mm(5), mm(7))),
      ]);
      cad.output(
        "expanded",
        cad.offset("expanded", moved, {
          distance,
          direction: "outward",
        }),
      );
      cad.output(
        "shrunk",
        cad.offset("shrunk", moved, {
          distance,
          direction: "inward",
        }),
      );
      const document = cad.build();
      const cases = [
        { width: 40, height: 20, depth: 10, distance: 1 },
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
          const expanded = result.value.output("expanded");
          const expandedMeasurement = expanded.measure();
          expect(expandedMeasurement.volume).toBeGreaterThan(base);
          const expectedBounds = {
            min: [
              100 - dimensions.height - dimensions.distance,
              5 - dimensions.distance,
              7 - dimensions.distance,
            ],
            max: [
              100 + dimensions.distance,
              5 + dimensions.width + dimensions.distance,
              7 + dimensions.depth + dimensions.distance,
            ],
          } as const;
          for (const bound of ["min", "max"] as const) {
            expandedMeasurement.boundingBox[bound].forEach(
              (coordinate, index) => {
                expect(coordinate).toBeCloseTo(
                  expectedBounds[bound][index]!,
                  6,
                );
              },
            );
          }
          const shrunk = result.value.output("shrunk");
          expect(shrunk.measure().volume).toBeCloseTo(
            (dimensions.width - 2 * dimensions.distance) *
              (dimensions.height - 2 * dimensions.distance) *
              (dimensions.depth - 2 * dimensions.distance),
            8,
          );
        } finally {
          result.value.dispose();
        }
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("reports the offset provenance boundary to downstream selectors", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("offset-history-boundary");
      const box = cad.box("box", {
        size: vec3(mm(10), mm(20), mm(30)),
      });
      const first = cad.offset("first", box, {
        distance: mm(1),
        direction: "outward",
      });
      cad.output(
        "second",
        cad.shell("second", first, {
          openings: topology.faces.modifiedBy(first).atLeast(1),
          thickness: mm(0.5),
        }),
      );
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "TOPOLOGY_HISTORY_UNAVAILABLE",
          node: "second",
          path: expect.stringMatching(/^\/nodes\/second\/openings\/query/),
          details: expect.objectContaining({ history: "partial" }),
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("shells a connected boolean union as one solid", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const cad = design("connected-union-shell");
      const first = cad.box("first", {
        size: vec3(mm(10), mm(20), mm(30)),
      });
      const secondBase = cad.box("second-base", {
        size: vec3(mm(10), mm(20), mm(30)),
      });
      const second = cad.transform("second", secondBase, [
        tf.translate(vec3(mm(5), mm(0), mm(0))),
      ]);
      const connected = cad.union("connected", first, [second]);
      const openings = topology.faces
        .normal(scalarVec3(0, 0, 1))
        .atLeast(1);
      cad.output(
        "hollow",
        cad.shell("hollow", connected, {
          openings,
          thickness: mm(1),
        }),
      );

      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        const measurement = result.value.output("hollow").measure();
        expect(measurement.volume).toBeCloseTo(2_214, 8);
        expect(measurement.boundingBox).toEqual({
          min: [0, 0, 0],
          max: [15, 20, 30],
        });
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("reports shell collapse and downstream provenance gaps structurally", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const collapseCad = design("collapsed-shell");
      const collapseBox = collapseCad.box("box", {
        size: vec3(mm(10), mm(20), mm(30)),
      });
      collapseCad.output(
        "hollow",
        collapseCad.shell("hollow", collapseBox, {
          openings: topology.faces
            .createdBy(collapseBox, { role: "box.face.z-max" })
            .select(),
          thickness: mm(5.1),
        }),
      );
      const collapsed = await evaluator.evaluate(collapseCad.build());
      expect(collapsed.ok).toBe(false);
      expect(collapsed.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "hollow",
          path: "/nodes/hollow",
        }),
      );

      const historyCad = design("shell-history-boundary");
      const historyBox = historyCad.box("box", {
        size: vec3(mm(10), mm(20), mm(30)),
      });
      const first = historyCad.shell("first", historyBox, {
        openings: topology.faces
          .createdBy(historyBox, { role: "box.face.z-max" })
          .select(),
        thickness: mm(1),
      });
      historyCad.output(
        "second",
        historyCad.shell("second", first, {
          openings: topology.faces.modifiedBy(first).atLeast(1),
          thickness: mm(0.5),
        }),
      );
      const history = await evaluator.evaluate(historyCad.build());
      expect(history.ok).toBe(false);
      expect(history.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "TOPOLOGY_HISTORY_UNAVAILABLE",
          node: "second",
          path: expect.stringMatching(/^\/nodes\/second\/openings\/query/),
          details: expect.objectContaining({ history: "partial" }),
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
