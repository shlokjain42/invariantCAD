import { describe, expect, it } from "vitest";
import {
  kernelSupports,
  type GeometryKernel,
  type KernelShape,
  type KernelTopologySnapshot,
  type ProfileCurveSource,
  type ResolvedPolylinePath,
  type ResolvedProfile,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

const SWEEP_OPTIONS = {
  transition: "right-corner",
  frame: "corrected-frenet",
} as const;

function source(sketch: string, entity: string): ProfileCurveSource {
  return {
    kind: "sketch-entity",
    sketch,
    entity: entity as ProfileCurveSource["entity"],
  };
}

function rectangleProfile(
  sketch: string,
  width: number,
  height: number,
): ResolvedProfile {
  const xMin = -width / 2;
  const xMax = width / 2;
  const yMin = -height / 2;
  const yMax = height / 2;
  return {
    plane: { plane: "XY", origin: [0, 0, 0] },
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

function circleProfile(sketch: string, radius: number): ResolvedProfile {
  return {
    plane: { plane: "XY", origin: [0, 0, 0] },
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

function path(
  points: ResolvedPolylinePath["points"],
): ResolvedPolylinePath {
  return { kind: "polyline", points, closed: false };
}

function topology(
  kernel: GeometryKernel,
  shape: KernelShape,
): KernelTopologySnapshot {
  const snapshot = kernel.topology?.(shape);
  if (snapshot === undefined) {
    throw new Error("OCCT topology support is unavailable");
  }
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

function expectBroadSweepCreation(
  snapshot: KernelTopologySnapshot,
  feature: string,
): void {
  expect(snapshot.history).toBe("complete");
  for (const descriptor of [...snapshot.faces, ...snapshot.edges]) {
    expect(descriptor.lineage).toEqual([{ feature, relation: "created" }]);
    expect(
      descriptor.lineage.some(
        (lineage) => lineage.role !== undefined || lineage.source !== undefined,
      ),
    ).toBe(false);
  }
}

function expectClosedSolidTopology(
  snapshot: KernelTopologySnapshot,
  faces: number,
  edges: number,
  expectTwoFaceAdjacency = true,
): void {
  expect(snapshot.faces).toHaveLength(faces);
  expect(snapshot.edges).toHaveLength(edges);
  if (expectTwoFaceAdjacency) {
    expect(snapshot.edges.every((edge) => edge.faces.length === 2)).toBe(true);
  }
}

describe("OCCT bounded solid sweep", () => {
  it("sweeps and exports an exact asymmetric rectangle on a straight path", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(kernelSupports(kernel.capabilities, "feature", "sweep")).toBe(
        true,
      );
      expect(kernel.sweep).toBeTypeOf("function");

      const shape = kernel.sweep!(
        rectangleProfile("straight-profile", 2, 4),
        path([
          [0, 0, 0],
          [0, 0, 10],
        ]),
        SWEEP_OPTIONS,
        { feature: "straight-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(80, 8);
        expect(measured.surfaceArea).toBeCloseTo(136, 8);
        expectVectorClose(measured.boundingBox.min, [-1, -2, 0]);
        expectVectorClose(measured.boundingBox.max, [1, 2, 10]);
        expect(measured.genus).toBe(0);

        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 6, 12);
        expectBroadSweepCreation(snapshot, "straight-sweep");

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

  it("uses a right corner and preserves the asymmetric section orientation", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.sweep!(
        rectangleProfile("planar-profile", 2, 4),
        path([
          [0, 0, 0],
          [0, 0, 10],
          [10, 0, 10],
        ]),
        SWEEP_OPTIONS,
        { feature: "planar-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(160, 8);
        expectVectorClose(measured.boundingBox.min, [-1, -2, 0]);
        expectVectorClose(measured.boundingBox.max, [10, 2, 11]);

        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 10, 20);
        expectBroadSweepCreation(snapshot, "planar-sweep");
        const endCap = snapshot.faces.find(
          (face) =>
            face.surface.kind === "plane" &&
            Math.abs(face.center[0] - 10) < 1e-7 &&
            Math.abs(face.center[1]) < 1e-7 &&
            Math.abs(face.center[2] - 10) < 1e-7,
        );
        expect(endCap).toBeDefined();
        expectVectorClose(endCap!.bounds.min, [10, -2, 9]);
        expectVectorClose(endCap!.bounds.max, [10, 2, 11]);
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("transports an asymmetric section through a non-planar three-axis path", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.sweep!(
        rectangleProfile("spatial-profile", 2, 4),
        path([
          [0, 0, 0],
          [0, 0, 10],
          [10, 0, 10],
          [10, 10, 10],
        ]),
        SWEEP_OPTIONS,
        { feature: "spatial-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(240, 8);
        expectVectorClose(measured.boundingBox.min, [-1, -2, 0]);
        expectVectorClose(measured.boundingBox.max, [12, 10, 11]);
        expect(measured.genus).toBe(0);

        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 14, 28);
        expectBroadSweepCreation(snapshot, "spatial-sweep");
        const endCap = snapshot.faces.find(
          (face) =>
            face.surface.kind === "plane" &&
            Math.abs(face.center[0] - 10) < 1e-7 &&
            Math.abs(face.center[1] - 10) < 1e-7 &&
            Math.abs(face.center[2] - 10) < 1e-7,
        );
        expect(endCap).toBeDefined();
        expectVectorClose(endCap!.bounds.min, [8, 10, 9]);
        expectVectorClose(endCap!.bounds.max, [12, 10, 11]);
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves an exact circular section across planar and spatial corners", async () => {
    const kernel = await createOcctKernel();
    try {
      const profile = circleProfile("circular-profile", 1);
      const planar = kernel.sweep!(
        profile,
        path([
          [0, 0, 0],
          [0, 0, 10],
          [10, 0, 10],
        ]),
        SWEEP_OPTIONS,
        { feature: "circular-planar-sweep", tolerance: 1e-7 },
      );
      const spatial = kernel.sweep!(
        profile,
        path([
          [0, 0, 0],
          [0, 0, 10],
          [10, 0, 10],
          [10, 10, 10],
        ]),
        SWEEP_OPTIONS,
        { feature: "circular-spatial-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.measure(planar).volume).toBeCloseTo(20 * Math.PI, 8);
        expectVectorClose(kernel.measure(planar).boundingBox.min, [-1, -1, 0]);
        expectVectorClose(kernel.measure(planar).boundingBox.max, [10, 1, 11]);
        const planarTopology = topology(kernel, planar);
        expectClosedSolidTopology(planarTopology, 4, 8, false);
        expectBroadSweepCreation(planarTopology, "circular-planar-sweep");

        expect(kernel.measure(spatial).volume).toBeCloseTo(30 * Math.PI, 7);
        expectVectorClose(kernel.measure(spatial).boundingBox.min, [-1, -1, 0]);
        expectVectorClose(kernel.measure(spatial).boundingBox.max, [11, 10, 11]);
        const spatialTopology = topology(kernel, spatial);
        expectClosedSolidTopology(spatialTopology, 5, 12, false);
        expectBroadSweepCreation(spatialTopology, "circular-spatial-sweep");
      } finally {
        kernel.disposeShape(spatial);
        kernel.disposeShape(planar);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("accepts a first path segment opposite the profile-plane normal", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.sweep!(
        rectangleProfile("negative-normal-profile", 2, 4),
        path([
          [0, 0, 0],
          [0, 0, -10],
        ]),
        SWEEP_OPTIONS,
        { feature: "negative-normal-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(80, 8);
        expectVectorClose(measured.boundingBox.min, [-1, -2, -10]);
        expectVectorClose(measured.boundingBox.max, [1, 2, 0]);
        expectClosedSolidTopology(topology(kernel, shape), 6, 12);
        expectBroadSweepCreation(
          topology(kernel, shape),
          "negative-normal-sweep",
        );
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("releases failed sweeps and remains usable", async () => {
    const kernel = await createOcctKernel();
    try {
      const oversized = circleProfile("oversized-profile", 5);
      const tightCorner = path([
        [0, 0, 0],
        [0, 0, 2],
        [2, 0, 2],
      ]);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(() =>
          kernel.sweep!(oversized, tightCorner, SWEEP_OPTIONS, {
            feature: `failed-sweep-${attempt}`,
            tolerance: 1e-7,
          }),
        ).toThrow("Sweep did not produce one valid solid");
      }

      const box = kernel.box!([2, 3, 4], false, { feature: "after-failure" });
      const recovered = kernel.sweep!(
        rectangleProfile("recovery-profile", 2, 4),
        path([
          [0, 0, 0],
          [0, 0, 5],
        ]),
        SWEEP_OPTIONS,
        { feature: "recovered-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(box)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(box).volume).toBeCloseTo(24, 8);
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(recovered).volume).toBeCloseTo(40, 8);
        expectClosedSolidTopology(topology(kernel, recovered), 6, 12);
      } finally {
        kernel.disposeShape(recovered);
        kernel.disposeShape(box);
      }
    } finally {
      kernel.dispose();
    }
  });
});
