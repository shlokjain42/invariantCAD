import { describe, expect, it } from "vitest";
import {
  kernelSupports,
  type GeometryKernel,
  type KernelShape,
  type KernelTopologySnapshot,
  type ProfileCurveSource,
  type ResolvedProfile,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

function source(sketch: string, entity: string): ProfileCurveSource {
  return {
    kind: "sketch-entity",
    sketch,
    entity: entity as ProfileCurveSource["entity"],
  };
}

function rectangleProfile(
  sketch: string,
  station: number,
  width: number,
  height: number,
  offset: readonly [number, number] = [0, 0],
): ResolvedProfile {
  const xMin = -width / 2;
  const xMax = width / 2;
  const yMin = -height / 2;
  const yMax = height / 2;
  return {
    plane: { plane: "XY", origin: [offset[0], offset[1], station] },
    outer: {
      curves: [
        {
          kind: "line",
          start: [xMin, yMin],
          end: [xMax, yMin],
          source: source(sketch, "bottom"),
        },
        {
          kind: "line",
          start: [xMax, yMin],
          end: [xMax, yMax],
          source: source(sketch, "right"),
        },
        {
          kind: "line",
          start: [xMax, yMax],
          end: [xMin, yMax],
          source: source(sketch, "top"),
        },
        {
          kind: "line",
          start: [xMin, yMax],
          end: [xMin, yMin],
          source: source(sketch, "left"),
        },
      ],
    },
    holes: [],
  };
}

function selfIntersectingProfile(
  sketch: string,
  station: number,
): ResolvedProfile {
  const points = [
    [0, 0],
    [4, 4],
    [0, 4],
    [3, 0],
  ] as const;
  return {
    plane: { plane: "XY", origin: [0, 0, station] },
    outer: {
      curves: points.map((start, index) => ({
        kind: "line" as const,
        start,
        end: points[(index + 1) % points.length]!,
        source: source(sketch, `edge-${index}`),
      })),
    },
    holes: [],
  };
}

function circleProfile(
  sketch: string,
  station: number,
  radius: number,
): ResolvedProfile {
  return {
    plane: { plane: "XY", origin: [0, 0, station] },
    outer: {
      curves: [
        {
          kind: "circle",
          center: [0, 0],
          radius,
          reversed: false,
          source: source(sketch, "circle"),
        },
      ],
    },
    holes: [],
  };
}

function topology(kernel: GeometryKernel, shape: KernelShape): KernelTopologySnapshot {
  const snapshot = kernel.topology?.(shape);
  if (snapshot === undefined) throw new Error("OCCT topology support is unavailable");
  return snapshot;
}

function expectVectorClose(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
): void {
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index]!, 6);
  }
}

function expectBroadLoftCreation(
  snapshot: KernelTopologySnapshot,
  feature: string,
): void {
  expect(snapshot.history).toBe("complete");
  for (const descriptor of [...snapshot.faces, ...snapshot.edges]) {
    expect(descriptor.lineage).toEqual([
      { feature, relation: "created" },
    ]);
    expect(
      descriptor.lineage.some(
        (lineage) => lineage.role !== undefined || lineage.source !== undefined,
      ),
    ).toBe(false);
  }
}

describe("OCCT ruled solid loft", () => {
  it("builds and exports a two-section rectangular frustum", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(kernelSupports(kernel.capabilities, "feature", "loft")).toBe(true);
      expect(kernel.loft).toBeTypeOf("function");

      const shape = kernel.loft!(
        [
          rectangleProfile("bottom-profile", 0, 10, 8),
          rectangleProfile("top-profile", 10, 5, 4),
        ],
        { ruled: true },
        { feature: "two-section-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(1_400 / 3, 8);
        expectVectorClose(measured.boundingBox.min, [-5, -4, 0]);
        expectVectorClose(measured.boundingBox.max, [5, 4, 10]);
        expect(measured.genus).toBe(0);

        const snapshot = topology(kernel, shape);
        expect(snapshot.faces).toHaveLength(6);
        expect(snapshot.edges).toHaveLength(12);
        expect(snapshot.faces.every((face) => face.edges.length === 4)).toBe(
          true,
        );
        expect(snapshot.edges.every((edge) => edge.faces.length === 2)).toBe(
          true,
        );
        expectBroadLoftCreation(snapshot, "two-section-loft");

        const step = kernel.exportShape!(shape, "step");
        expect(step).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(step)).toContain("ISO-10303-21");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves the bounded topology inventory across three ruled sections", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.loft!(
        [
          rectangleProfile("section-0", 0, 10, 10),
          rectangleProfile("section-1", 4, 6, 6),
          rectangleProfile("section-2", 10, 8, 8),
        ],
        { ruled: true },
        { feature: "three-section-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(1_672 / 3, 8);
        expectVectorClose(measured.boundingBox.min, [-5, -5, 0]);
        expectVectorClose(measured.boundingBox.max, [5, 5, 10]);
        expect(measured.genus).toBe(0);

        const snapshot = topology(kernel, shape);
        expect(snapshot.faces).toHaveLength(10);
        expect(snapshot.edges).toHaveLength(20);
        expect(snapshot.faces.every((face) => face.edges.length === 4)).toBe(
          true,
        );
        expect(snapshot.edges.every((edge) => edge.faces.length === 2)).toBe(
          true,
        );
        expectBroadLoftCreation(snapshot, "three-section-loft");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves exact circular sections in a conical frustum", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.loft!(
        [circleProfile("base", 0, 4), circleProfile("tip", 6, 2)],
        { ruled: true },
        { feature: "circular-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(56 * Math.PI, 8);
        expectVectorClose(measured.boundingBox.min, [-4, -4, 0]);
        expectVectorClose(measured.boundingBox.max, [4, 4, 6]);

        const snapshot = topology(kernel, shape);
        expect(snapshot.faces).toHaveLength(3);
        expect(snapshot.edges).toHaveLength(3);
        expectBroadLoftCreation(snapshot, "circular-loft");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("cleans failed section construction and remains usable", async () => {
    const kernel = await createOcctKernel();
    try {
      const valid = rectangleProfile("valid-profile", 0, 4, 4);
      const invalid = selfIntersectingProfile("crossed-profile", 5);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(() =>
          kernel.loft!(
            [valid, invalid],
            { ruled: true },
            { feature: `failed-loft-${attempt}`, tolerance: 1e-7 },
          ),
        ).toThrow("does not form a valid simple planar face");
      }

      const box = kernel.box!([2, 3, 4], false, { feature: "after-failure" });
      const recovered = kernel.loft!(
        [valid, rectangleProfile("recovery-profile", 5, 2, 2)],
        { ruled: true },
        { feature: "recovered-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(box)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(box).volume).toBeCloseTo(24, 8);
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(recovered).volume).toBeCloseTo(140 / 3, 8);
        expect(topology(kernel, recovered).faces).toHaveLength(6);
      } finally {
        kernel.disposeShape(recovered);
        kernel.disposeShape(box);
      }
    } finally {
      kernel.dispose();
    }
  });
});
