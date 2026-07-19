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

const RECTANGLE_ENTITIES = ["bottom", "right", "top", "left"] as const;
const SWEEP_ROLES = [
  "sweep.face.start-cap",
  "sweep.face.end-cap",
  "sweep.face.side",
  "sweep.edge.start-rim",
  "sweep.edge.end-rim",
  "sweep.edge.lateral",
] as const;

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

function sourceFreeRectangleProfile(
  width: number,
  height: number,
): ResolvedProfile {
  const profile = rectangleProfile("discarded-source", width, height);
  return {
    ...profile,
    outer: {
      curves: profile.outer.curves.map((curve) => {
        const { source: _source, ...sourceFreeCurve } = curve;
        return sourceFreeCurve;
      }),
    },
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

function archedProfile(sketch: string): ResolvedProfile {
  return {
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
          source: source(sketch, "arc"),
        },
        {
          kind: "line",
          start: [-2, 0],
          end: [-2, -3],
          source: source(sketch, "left"),
        },
        {
          kind: "line",
          start: [-2, -3],
          end: [2, -3],
          source: source(sketch, "bottom"),
        },
        {
          kind: "line",
          start: [2, -3],
          end: [2, 0],
          source: source(sketch, "right"),
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

function expectExactSweepCreation(
  snapshot: KernelTopologySnapshot,
  options: {
    readonly feature: string;
    readonly sketch?: string;
    readonly entities: readonly string[];
    readonly segments: number;
    readonly circle?: boolean;
    readonly sourceFree?: boolean;
  },
): readonly KernelTopologySnapshot["edges"][number][] {
  const {
    feature,
    sketch,
    entities,
    segments,
    circle = false,
    sourceFree = false,
  } = options;
  const descriptors = [...snapshot.faces, ...snapshot.edges];
  const semanticEntries = descriptors.flatMap((descriptor) =>
    descriptor.lineage.filter(
      (lineage) => lineage.feature === feature && lineage.role !== undefined,
    ),
  );
  const roleEntries = (
    descriptor: (typeof descriptors)[number],
  ) =>
    descriptor.lineage.filter(
      (lineage) => lineage.feature === feature && lineage.role !== undefined,
    );

  expect(snapshot.history).toBe("complete");
  for (const descriptor of descriptors) {
    expect(descriptor.lineage).toContainEqual({
      feature,
      relation: "created",
    });
    expect(
      descriptor.lineage.every(
        (lineage) => lineage.feature === feature && lineage.relation === "created",
      ),
    ).toBe(true);
    expect(roleEntries(descriptor).length).toBeLessThanOrEqual(1);
  }

  const expectedCounts = {
    "sweep.face.start-cap": 1,
    "sweep.face.end-cap": 1,
    "sweep.face.side": entities.length * segments,
    "sweep.edge.start-rim": entities.length,
    "sweep.edge.end-rim": entities.length,
    "sweep.edge.lateral": circle ? 0 : entities.length * segments,
  } as const;
  expect(
    Object.fromEntries(
      SWEEP_ROLES.map((role) => [
        role,
        descriptors.filter((descriptor) =>
          roleEntries(descriptor).some((lineage) => lineage.role === role),
        ).length,
      ]),
    ),
  ).toEqual(expectedCounts);
  expect(
    snapshot.faces.every((face) =>
      roleEntries(face).every((lineage) => lineage.role?.startsWith("sweep.face.")),
    ),
  ).toBe(true);
  expect(
    snapshot.edges.every((edge) =>
      roleEntries(edge).every((lineage) => lineage.role?.startsWith("sweep.edge.")),
    ),
  ).toBe(true);

  const sourceRoles = new Set([
    "sweep.face.side",
    "sweep.edge.start-rim",
    "sweep.edge.end-rim",
  ]);
  for (const lineage of semanticEntries) {
    expect(SWEEP_ROLES).toContain(lineage.role);
    if (sourceRoles.has(lineage.role!)) {
      if (sourceFree) {
        expect(lineage.source).toBeUndefined();
      } else {
        expect(lineage.source).toBeDefined();
        expect(lineage.source?.kind).toBe("sketch-entity");
        expect(lineage.source?.sketch).toBe(sketch);
        expect(entities).toContain(lineage.source?.entity);
      }
    } else {
      expect(lineage.source).toBeUndefined();
    }
  }
  if (sourceFree) {
    expect(
      descriptors.every((descriptor) =>
        descriptor.lineage.every((lineage) => lineage.source === undefined),
      ),
    ).toBe(true);
  } else {
    expect(sketch).toBeDefined();
    for (const entity of entities) {
      const count = (role: (typeof SWEEP_ROLES)[number]): number =>
        semanticEntries.filter(
          (lineage) =>
            lineage.role === role &&
            lineage.source?.sketch === sketch &&
            lineage.source?.entity === entity,
        ).length;
      expect(count("sweep.face.side")).toBe(segments);
      expect(count("sweep.edge.start-rim")).toBe(1);
      expect(count("sweep.edge.end-rim")).toBe(1);
    }
  }

  const unnamedEdges = snapshot.edges.filter(
    (edge) => roleEntries(edge).length === 0,
  );
  for (const edge of unnamedEdges) {
    expect(edge.lineage).toEqual([{ feature, relation: "created" }]);
  }
  return unnamedEdges;
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
        expectExactSweepCreation(snapshot, {
          feature: "straight-sweep",
          sketch: "straight-profile",
          entities: RECTANGLE_ENTITIES,
          segments: 1,
        });

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

  it("publishes every semantic role without inventing sources for a direct source-free profile", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.sweep!(
        sourceFreeRectangleProfile(2, 4),
        path([
          [0, 0, 0],
          [0, 0, 10],
        ]),
        SWEEP_OPTIONS,
        { feature: "source-free-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 6, 12);
        const unnamed = expectExactSweepCreation(snapshot, {
          feature: "source-free-sweep",
          entities: RECTANGLE_ENTITIES,
          segments: 1,
          sourceFree: true,
        });
        expect(unnamed).toHaveLength(0);
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
        const unnamed = expectExactSweepCreation(snapshot, {
          feature: "planar-sweep",
          sketch: "planar-profile",
          entities: RECTANGLE_ENTITIES,
          segments: 2,
        });
        expect(unnamed).toHaveLength(4);
        expect(unnamed.every((edge) => edge.faces.length === 2)).toBe(true);
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
        const unnamed = expectExactSweepCreation(snapshot, {
          feature: "spatial-sweep",
          sketch: "spatial-profile",
          entities: RECTANGLE_ENTITIES,
          segments: 3,
        });
        expect(unnamed).toHaveLength(8);
        expect(unnamed.every((edge) => edge.faces.length === 2)).toBe(true);
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
        const planarUnnamed = expectExactSweepCreation(planarTopology, {
          feature: "circular-planar-sweep",
          sketch: "circular-profile",
          entities: ["circle"],
          segments: 2,
          circle: true,
        });
        expect(planarUnnamed).toHaveLength(6);
        expect(
          planarUnnamed.filter((edge) => edge.faces.length === 1),
        ).toHaveLength(2);
        expect(
          planarUnnamed.filter((edge) => edge.curve.kind === "ellipse"),
        ).toHaveLength(4);

        expect(kernel.measure(spatial).volume).toBeCloseTo(30 * Math.PI, 7);
        expectVectorClose(kernel.measure(spatial).boundingBox.min, [-1, -1, 0]);
        expectVectorClose(kernel.measure(spatial).boundingBox.max, [11, 10, 11]);
        const spatialTopology = topology(kernel, spatial);
        expectClosedSolidTopology(spatialTopology, 5, 12, false);
        const spatialUnnamed = expectExactSweepCreation(spatialTopology, {
          feature: "circular-spatial-sweep",
          sketch: "circular-profile",
          entities: ["circle"],
          segments: 3,
          circle: true,
        });
        expect(spatialUnnamed).toHaveLength(10);
        expect(
          spatialUnnamed.filter((edge) => edge.faces.length === 1),
        ).toHaveLength(3);
      } finally {
        kernel.disposeShape(spatial);
        kernel.disposeShape(planar);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("leaves split curved-profile miter contours unnamed", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.sweep!(
        archedProfile("arched-corner-profile"),
        path([
          [0, 0, 0],
          [0, 0, 10],
          [10, 0, 10],
        ]),
        SWEEP_OPTIONS,
        { feature: "arched-corner-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 10, 21);
        const unnamed = expectExactSweepCreation(snapshot, {
          feature: "arched-corner-sweep",
          sketch: "arched-corner-profile",
          entities: ["arc", "left", "bottom", "right"],
          segments: 2,
        });
        expect(unnamed).toHaveLength(5);
        expect(unnamed.every((edge) => edge.faces.length === 2)).toBe(true);
        expect(
          unnamed.filter((edge) => edge.curve.kind === "ellipse"),
        ).toHaveLength(2);
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("downgrades annotation-time native failures, disposes cleanly, and recovers", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as Record<string, any> & {
      readonly shapeCount: number;
    };
    const originalSweep = raw.sweep.bind(raw) as (...args: any[]) => any;
    const originalHashCode = raw.hashCode.bind(raw) as (...args: any[]) => any;
    const baselineShapeCount = raw.shapeCount;
    let resultBuilt = false;
    let annotationFailures = 0;
    let shape: KernelShape | undefined;
    try {
      raw.sweep = (...args: any[]) => {
        const result = originalSweep(...args);
        resultBuilt = true;
        return result;
      };
      raw.hashCode = (...args: any[]) => {
        if (resultBuilt && annotationFailures === 0) {
          annotationFailures += 1;
          throw new Error("injected sweep annotation hash failure");
        }
        return originalHashCode(...args);
      };
      try {
        shape = kernel.sweep!(
          rectangleProfile("partial-annotation-profile", 2, 4),
          path([
            [0, 0, 0],
            [0, 0, 10],
            [10, 0, 10],
          ]),
          SWEEP_OPTIONS,
          { feature: "partial-annotation-sweep", tolerance: 1e-7 },
        );
      } finally {
        raw.sweep = originalSweep;
        raw.hashCode = originalHashCode;
      }

      expect(annotationFailures).toBe(1);
      expect(shape).toBeDefined();
      if (shape === undefined) throw new Error("Expected a partial sweep shape");
      expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
      expect(kernel.measure(shape).volume).toBeCloseTo(160, 8);
      expect(topology(kernel, shape).history).toBe("partial");
      kernel.disposeShape(shape);
      shape = undefined;
      expect(raw.shapeCount).toBe(baselineShapeCount);

      const recovered = kernel.sweep!(
        rectangleProfile("annotation-recovery-profile", 2, 4),
        path([
          [0, 0, 0],
          [0, 0, 5],
        ]),
        SWEEP_OPTIONS,
        { feature: "annotation-recovery-sweep", tolerance: 1e-7 },
      );
      try {
        const snapshot = topology(kernel, recovered);
        expectExactSweepCreation(snapshot, {
          feature: "annotation-recovery-sweep",
          sketch: "annotation-recovery-profile",
          entities: RECTANGLE_ENTITIES,
          segments: 1,
        });
      } finally {
        kernel.disposeShape(recovered);
      }
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      raw.sweep = originalSweep;
      raw.hashCode = originalHashCode;
      if (shape !== undefined) kernel.disposeShape(shape);
      kernel.dispose();
    }
  });

  it("propagates annotation cancellation and releases the valid native result", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as Record<string, any> & {
      readonly shapeCount: number;
    };
    const originalSweep = raw.sweep.bind(raw) as (...args: any[]) => any;
    const originalHashCode = raw.hashCode.bind(raw) as (...args: any[]) => any;
    const baselineShapeCount = raw.shapeCount;
    const abort = new AbortController();
    let resultBuilt = false;
    let annotationAborts = 0;
    try {
      raw.sweep = (...args: any[]) => {
        const result = originalSweep(...args);
        resultBuilt = true;
        return result;
      };
      raw.hashCode = (...args: any[]) => {
        if (resultBuilt && annotationAborts === 0) {
          annotationAborts += 1;
          abort.abort();
        }
        return originalHashCode(...args);
      };

      let thrown: unknown;
      try {
        kernel.sweep!(
          rectangleProfile("cancelled-annotation-profile", 2, 4),
          path([
            [0, 0, 0],
            [0, 0, 10],
            [10, 0, 10],
          ]),
          SWEEP_OPTIONS,
          {
            feature: "cancelled-annotation-sweep",
            tolerance: 1e-7,
            signal: abort.signal,
          },
        );
      } catch (error) {
        thrown = error;
      } finally {
        raw.sweep = originalSweep;
        raw.hashCode = originalHashCode;
      }
      expect(annotationAborts).toBe(1);
      expect(thrown).toBeInstanceOf(DOMException);
      expect((thrown as DOMException).name).toBe("AbortError");
      expect(raw.shapeCount).toBe(baselineShapeCount);

      const recovered = kernel.sweep!(
        rectangleProfile("cancel-recovery-profile", 2, 4),
        path([
          [0, 0, 0],
          [0, 0, 5],
        ]),
        SWEEP_OPTIONS,
        { feature: "cancel-recovery-sweep", tolerance: 1e-7 },
      );
      try {
        expect(topology(kernel, recovered).history).toBe("complete");
      } finally {
        kernel.disposeShape(recovered);
      }
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      raw.sweep = originalSweep;
      raw.hashCode = originalHashCode;
      kernel.dispose();
    }
  });

  it("fails closed when annotation observes a nonlocal face adjacency", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as Record<string, any> & {
      readonly shapeCount: number;
    };
    const originalSweep = raw.sweep.bind(raw) as (...args: any[]) => any;
    const originalGetSubShapes = raw.getSubShapes.bind(raw) as (
      handle: unknown,
      topology: string,
    ) => any[];
    const originalArea = raw.getSurfaceArea.bind(raw) as (
      handle: unknown,
    ) => number;
    const originalIsSame = raw.isSame.bind(raw) as (
      first: unknown,
      second: unknown,
    ) => boolean;
    const originalRelease = raw.release.bind(raw) as (handle: unknown) => void;
    const baselineShapeCount = raw.shapeCount;
    let resultHandle: unknown;
    let resultFaces: unknown[] = [];
    let injected = false;
    let shape: KernelShape | undefined;
    try {
      raw.sweep = (...args: any[]) => {
        resultHandle = originalSweep(...args);
        return resultHandle;
      };
      raw.getSubShapes = (handle: unknown, topologyKind: string) => {
        const shapes = originalGetSubShapes(handle, topologyKind);
        if (handle === resultHandle && topologyKind === "face") {
          resultFaces = [...shapes];
          return shapes;
        }
        if (
          !injected &&
          topologyKind === "edge" &&
          resultFaces.includes(handle) &&
          Math.abs(originalArea(handle) - 8) > 1e-8
        ) {
          for (const candidateFace of resultFaces) {
            if (
              candidateFace === handle ||
              Math.abs(originalArea(candidateFace) - 8) > 1e-8
            ) {
              continue;
            }
            const remoteEdges = originalGetSubShapes(candidateFace, "edge");
            const sharesEdge = remoteEdges.some((remote) =>
              shapes.some((local) => originalIsSame(local, remote)),
            );
            if (!sharesEdge && remoteEdges.length > 0) {
              const [extra, ...unused] = remoteEdges;
              for (const edge of unused) originalRelease(edge);
              injected = true;
              return [...shapes, extra];
            }
            for (const edge of remoteEdges) originalRelease(edge);
          }
        }
        return shapes;
      };
      try {
        shape = kernel.sweep!(
          rectangleProfile("nonlocal-adjacency-profile", 2, 4),
          path([
            [0, 0, 0],
            [0, 0, 10],
            [10, 0, 10],
            [10, 10, 10],
          ]),
          SWEEP_OPTIONS,
          { feature: "nonlocal-adjacency-sweep", tolerance: 1e-7 },
        );
      } finally {
        raw.sweep = originalSweep;
        raw.getSubShapes = originalGetSubShapes;
      }

      expect(injected).toBe(true);
      expect(shape).toBeDefined();
      if (shape === undefined) throw new Error("Expected a partial sweep shape");
      expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
      expect(kernel.measure(shape).volume).toBeCloseTo(240, 8);
      expect(topology(kernel, shape).history).toBe("partial");
      kernel.disposeShape(shape);
      shape = undefined;
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      raw.sweep = originalSweep;
      raw.getSubShapes = originalGetSubShapes;
      if (shape !== undefined) kernel.disposeShape(shape);
      kernel.dispose();
    }
  });

  it("fails closed when lateral incidence duplicates one pair and omits another", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as Record<string, any> & {
      readonly shapeCount: number;
    };
    const originalSweep = raw.sweep.bind(raw) as (...args: any[]) => any;
    const originalGetSubShapes = raw.getSubShapes.bind(raw) as (
      handle: unknown,
      topology: string,
    ) => any[];
    const originalArea = raw.getSurfaceArea.bind(raw) as (
      handle: unknown,
    ) => number;
    const originalIsSame = raw.isSame.bind(raw) as (
      first: unknown,
      second: unknown,
    ) => boolean;
    const originalRelease = raw.release.bind(raw) as (handle: unknown) => void;
    const baselineShapeCount = raw.shapeCount;
    let resultHandle: unknown;
    let resultFaces: unknown[] = [];
    let cachedFaceEdges: Map<unknown, any[]> | undefined;
    let injected = false;
    let shape: KernelShape | undefined;
    try {
      raw.sweep = (...args: any[]) => {
        resultHandle = originalSweep(...args);
        return resultHandle;
      };
      raw.getSubShapes = (handle: unknown, topologyKind: string) => {
        if (topologyKind === "edge" && cachedFaceEdges?.has(handle)) {
          return cachedFaceEdges.get(handle)!;
        }
        const shapes = originalGetSubShapes(handle, topologyKind);
        if (handle === resultHandle && topologyKind === "face") {
          resultFaces = [...shapes];
          return shapes;
        }
        if (
          topologyKind !== "edge" ||
          !resultFaces.includes(handle) ||
          cachedFaceEdges !== undefined
        ) {
          return shapes;
        }

        cachedFaceEdges = new Map([[handle, shapes]]);
        for (const face of resultFaces) {
          if (face !== handle) {
            cachedFaceEdges.set(face, originalGetSubShapes(face, "edge"));
          }
        }
        const sideFaces = resultFaces.filter(
          (face) => Math.abs(originalArea(face) - 8) > 1e-8,
        );
        const sharedEdges = (
          first: unknown,
          second: unknown,
        ): readonly { readonly first: unknown; readonly second: unknown }[] =>
          cachedFaceEdges!
            .get(first)!
            .flatMap((firstEdge) => {
              const secondEdge = cachedFaceEdges!
                .get(second)!
                .find((candidate) => originalIsSame(firstEdge, candidate));
              return secondEdge === undefined
                ? []
                : [{ first: firstEdge, second: secondEdge }];
            });

        for (const middle of sideFaces) {
          const neighbors = sideFaces.filter(
            (candidate) =>
              candidate !== middle && sharedEdges(middle, candidate).length > 0,
          );
          if (neighbors.length !== 2) continue;
          const [first, missing] = neighbors;
          if (sharedEdges(first, missing).length !== 0) continue;
          const middleMissing = sharedEdges(middle, missing);
          if (middleMissing.length !== 1) continue;

          const missingEdges = cachedFaceEdges.get(missing)!;
          const removedIndex = missingEdges.findIndex((edge) =>
            originalIsSame(edge, middleMissing[0]!.first),
          );
          if (removedIndex === -1) continue;
          const [removed] = missingEdges.splice(removedIndex, 1);
          originalRelease(removed);

          const duplicates = originalGetSubShapes(middle, "edge");
          const duplicateIndex = duplicates.findIndex((edge) =>
            originalIsSame(edge, middleMissing[0]!.first),
          );
          if (duplicateIndex === -1) {
            for (const edge of duplicates) originalRelease(edge);
            break;
          }
          const [duplicate] = duplicates.splice(duplicateIndex, 1);
          for (const edge of duplicates) originalRelease(edge);
          cachedFaceEdges.get(first)!.push(duplicate);
          injected = true;
          break;
        }
        return cachedFaceEdges.get(handle)!;
      };
      try {
        shape = kernel.sweep!(
          rectangleProfile("duplicate-lateral-profile", 2, 4),
          path([
            [0, 0, 0],
            [0, 0, 10],
          ]),
          SWEEP_OPTIONS,
          { feature: "duplicate-lateral-sweep", tolerance: 1e-7 },
        );
      } finally {
        raw.sweep = originalSweep;
        raw.getSubShapes = originalGetSubShapes;
      }

      expect(injected).toBe(true);
      expect(shape).toBeDefined();
      if (shape === undefined) throw new Error("Expected a partial sweep shape");
      expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
      expect(kernel.measure(shape).volume).toBeCloseTo(80, 8);
      expect(topology(kernel, shape).history).toBe("partial");
      kernel.disposeShape(shape);
      shape = undefined;
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      raw.sweep = originalSweep;
      raw.getSubShapes = originalGetSubShapes;
      if (shape !== undefined) kernel.disposeShape(shape);
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
        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 6, 12);
        expectExactSweepCreation(snapshot, {
          feature: "negative-normal-sweep",
          sketch: "negative-normal-profile",
          entities: RECTANGLE_ENTITIES,
          segments: 1,
        });
        const cap = (
          role: "sweep.face.start-cap" | "sweep.face.end-cap",
        ) =>
          snapshot.faces.filter((face) =>
            face.lineage.some(
              (lineage) =>
                lineage.feature === "negative-normal-sweep" &&
                lineage.role === role,
            ),
          );
        const startCaps = cap("sweep.face.start-cap");
        const endCaps = cap("sweep.face.end-cap");
        expect(startCaps).toHaveLength(1);
        expect(endCaps).toHaveLength(1);
        expect(startCaps[0]!.surface.kind).toBe("plane");
        expect(endCaps[0]!.surface.kind).toBe("plane");
        expectVectorClose(startCaps[0]!.center, [0, 0, 0]);
        expectVectorClose(endCaps[0]!.center, [0, 0, -10]);
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
      expect(() =>
        kernel.sweep!(
          rectangleProfile("sub-pipe-profile", 2e-5, 2e-5),
          path([
            [0, 0, 0],
            [0, 0, 1],
          ]),
          SWEEP_OPTIONS,
          { feature: "sub-pipe-profile-sweep", tolerance: 1e-12 },
        ),
      ).toThrow("OCCT pipe-shell linear tolerance");
      expect(() =>
        kernel.sweep!(
          rectangleProfile("sub-pipe-path-profile", 2, 2),
          path([
            [0, 0, 0],
            [0, 0, 5e-5],
          ]),
          SWEEP_OPTIONS,
          { feature: "sub-pipe-path-sweep", tolerance: 1e-12 },
        ),
      ).toThrow("OCCT pipe-shell linear tolerance");

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
