import { describe, expect, it } from "vitest";
import {
  kernelSupports,
  resolvedCircularArcGeometry,
  type GeometryKernel,
  type KernelShape,
  type KernelTopologySnapshot,
  type ProfileCurveSource,
  type ResolvedCompositePath,
  type ResolvedProfile,
} from "../src/index.js";
import {
  OcctProfileMassPropertyError,
  createOcctKernel,
} from "../src/occt-kernel.js";

const SWEEP_OPTIONS = {
  transition: "right-corner",
  frame: "corrected-frenet",
} as const;

type Vec3 = ResolvedCompositePath["start"];

interface InjectableOcctRaw {
  getSurfaceArea: (...args: any[]) => number;
  getSurfaceCenterOfMass: (...args: any[]) => {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  makeLineEdge: (...args: any[]) => any;
  makeArcEdge: (...args: any[]) => any;
  makeWire: (...args: any[]) => any;
  sweep: (...args: any[]) => any;
  readonly shapeCount: number;
}

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
  plane: ResolvedProfile["plane"]["plane"] = "XY",
): ResolvedProfile {
  const xMin = -width / 2;
  const xMax = width / 2;
  const yMin = -height / 2;
  const yMax = height / 2;
  return {
    plane: { plane, origin: [0, 0, 0] },
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

function translatedRectangleProfile(
  sketch: string,
  width: number,
  height: number,
  offset: readonly [number, number],
  plane: ResolvedProfile["plane"]["plane"] = "XY",
): ResolvedProfile {
  const profile = rectangleProfile(sketch, width, height, plane);
  return {
    ...profile,
    outer: {
      curves: profile.outer.curves.map((curve) => {
        if (curve.kind !== "line") {
          throw new Error("Expected a rectangular line profile");
        }
        return {
          ...curve,
          start: [
            curve.start[0] + offset[0],
            curve.start[1] + offset[1],
          ],
          end: [curve.end[0] + offset[0], curve.end[1] + offset[1]],
        };
      }),
    },
  };
}

function circleProfile(
  sketch: string,
  radius: number,
  plane: ResolvedProfile["plane"]["plane"] = "XY",
): ResolvedProfile {
  return {
    plane: { plane, origin: [0, 0, 0] },
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

function planarCompositePath(): ResolvedCompositePath {
  const radius = 5;
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      { kind: "line", end: [0, 0, 5] },
      {
        kind: "circularArc",
        through: [
          radius - radius / Math.sqrt(2),
          0,
          radius + radius / Math.sqrt(2),
        ],
        end: [5, 0, 10],
      },
      { kind: "line", end: [10, 0, 10] },
    ],
    closed: false,
  };
}

function planarCompositeWithLineCorner(): ResolvedCompositePath {
  const path = planarCompositePath();
  return {
    ...path,
    segments: [...path.segments, { kind: "line", end: [10, 5, 10] }],
  };
}

function integerPlanarCompositePath(): ResolvedCompositePath {
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      { kind: "line", end: [0, 0, 5] },
      {
        kind: "circularArc",
        through: [1, 0, 8],
        end: [5, 0, 10],
      },
      { kind: "line", end: [10, 0, 10] },
    ],
    closed: false,
  };
}

function translateCompositePath(
  path: ResolvedCompositePath,
  translation: Vec3,
): ResolvedCompositePath {
  return {
    ...path,
    start: add(path.start, translation),
    segments: path.segments.map((segment) =>
      segment.kind === "line"
        ? { ...segment, end: add(segment.end, translation) }
        : {
            ...segment,
            through: add(segment.through, translation),
            end: add(segment.end, translation),
          },
    ),
  };
}

function rotateCompositePathAboutY(
  path: ResolvedCompositePath,
  angle: number,
): ResolvedCompositePath {
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const rotate = ([x, y, z]: Vec3): Vec3 => [
    x * cosine + z * sine,
    y,
    -x * sine + z * cosine,
  ];
  return {
    ...path,
    start: rotate(path.start),
    segments: path.segments.map((segment) =>
      segment.kind === "line"
        ? { ...segment, end: rotate(segment.end) }
        : {
            ...segment,
            through: rotate(segment.through),
            end: rotate(segment.end),
          },
    ),
  };
}

function majorCompositePath(): ResolvedCompositePath {
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      { kind: "line", end: [0, 0, 3] },
      {
        kind: "circularArc",
        through: [20, 0, 3],
        end: [10, 0, -7],
      },
      { kind: "line", end: [7, 0, -7] },
    ],
    closed: false,
  };
}

function majorArcChainPath(): ResolvedCompositePath {
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      {
        kind: "circularArc",
        through: [20, 0, 0],
        end: [10, 0, -10],
      },
      {
        kind: "circularArc",
        through: [10 - 10 / Math.sqrt(2), 10 - 10 / Math.sqrt(2), -10],
        end: [0, 10, -10],
      },
    ],
    closed: false,
  };
}

function nearFullCompositePath(): ResolvedCompositePath {
  const radius = 20;
  const gap = 0.02;
  const sweep = Math.PI * 2 - gap;
  const arcStartZ = 0.1;
  const point = (angle: number): Vec3 => [
    radius - radius * Math.cos(angle),
    0,
    arcStartZ + radius * Math.sin(angle),
  ];
  const end = point(sweep);
  const endTangent: Vec3 = [Math.sin(sweep), 0, Math.cos(sweep)];
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      { kind: "line", end: point(0) },
      {
        kind: "circularArc",
        through: point(sweep / 2),
        end,
      },
      { kind: "line", end: add(end, scale(endTangent, 0.1)) },
    ],
    closed: false,
  };
}

function angularlyConditionedNearFullPath(): ResolvedCompositePath {
  const radius = 5;
  const sweep = Math.PI * 2 - 0.05;
  const tilt = Math.PI / 1_800;
  const point = (angle: number): Vec3 => [
    radius * Math.sin(angle),
    radius * Math.cos(tilt) * (1 - Math.cos(angle)),
    radius * Math.sin(tilt) * (1 - Math.cos(angle)),
  ];
  const end = point(sweep);
  const endTangent: Vec3 = [
    Math.cos(sweep),
    Math.cos(tilt) * Math.sin(sweep),
    Math.sin(tilt) * Math.sin(sweep),
  ];
  return {
    kind: "composite",
    start: point(0),
    segments: [
      {
        kind: "circularArc",
        through: point(sweep / 2),
        end,
      },
      { kind: "line", end: add(end, scale(endTangent, 0.1)) },
    ],
    closed: false,
  };
}

function add(first: Vec3, second: Vec3): Vec3 {
  return [
    first[0] + second[0],
    first[1] + second[1],
    first[2] + second[2],
  ];
}

function scale(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function spatialTangentArcChain(): ResolvedCompositePath {
  const radius = 10;
  const arcTurn = Math.PI / 3;
  const firstPoint = (angle: number): Vec3 => [
    radius * Math.sin(angle),
    radius * (1 - Math.cos(angle)),
    0,
  ];
  const junction = firstPoint(arcTurn);
  const planeRotation = Math.PI / 4;
  const junctionTangent: Vec3 = [
    Math.cos(arcTurn),
    Math.sin(arcTurn),
    0,
  ];
  const secondStartRadius: Vec3 = [
    radius * Math.sin(arcTurn) * Math.cos(planeRotation),
    -radius * Math.cos(arcTurn) * Math.cos(planeRotation),
    -radius * Math.sin(planeRotation),
  ];
  const secondCenter: Vec3 = [
    junction[0] - secondStartRadius[0],
    junction[1] - secondStartRadius[1],
    junction[2] - secondStartRadius[2],
  ];
  const secondPoint = (angle: number): Vec3 =>
    add(
      secondCenter,
      add(
        scale(secondStartRadius, Math.cos(angle)),
        scale(junctionTangent, radius * Math.sin(angle)),
      ),
    );

  return {
    kind: "composite",
    start: firstPoint(0),
    segments: [
      {
        kind: "circularArc",
        through: firstPoint(arcTurn / 2),
        end: junction,
      },
      {
        kind: "circularArc",
        through: secondPoint(arcTurn / 2),
        end: secondPoint(arcTurn),
      },
    ],
    closed: false,
  };
}

function shortLineCompositePath(): ResolvedCompositePath {
  const radius = 5;
  const arcStart: Vec3 = [0, 0, 5e-5];
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      { kind: "line", end: arcStart },
      {
        kind: "circularArc",
        through: [
          radius - radius / Math.sqrt(2),
          0,
          arcStart[2] + radius / Math.sqrt(2),
        ],
        end: [radius, 0, arcStart[2] + radius],
      },
    ],
    closed: false,
  };
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

function expectVectorClose(actual: Vec3, expected: Vec3): void {
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
): void {
  expect(snapshot.faces).toHaveLength(faces);
  expect(snapshot.edges).toHaveLength(edges);
  expect(snapshot.edges.every((edge) => edge.faces.length === 2)).toBe(true);
}

describe("OCCT exact composite solid sweep", () => {
  it("advertises and sweeps a tangent line-arc-line path", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(
        kernelSupports(kernel.capabilities, "feature", "compositeSweep"),
      ).toBe(true);
      expect(kernel.capabilities.compositeSweep).toBeUndefined();
      expect(
        kernelSupports(
          kernel.capabilities,
          "compositeSweepRefinement",
          "major-multiple-arcs",
        ),
      ).toBe(false);
      expect(
        kernelSupports(
          kernel.capabilities,
          "compositeSweepRefinement",
          "major-eccentric-profile",
        ),
      ).toBe(false);
      expect(kernel.compositeSweep).toBeTypeOf("function");

      const shape = kernel.compositeSweep!(
        rectangleProfile("planar-composite-profile", 2, 4),
        planarCompositePath(),
        SWEEP_OPTIONS,
        { feature: "planar-composite-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(80 + 20 * Math.PI, 8);
        expect(measured.surfaceArea).toBeCloseTo(136 + 30 * Math.PI, 8);
        expectVectorClose(measured.boundingBox.min, [-1, -2, 0]);
        expectVectorClose(measured.boundingBox.max, [10, 2, 11]);
        expect(measured.genus).toBe(0);

        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 14, 28);
        expectBroadSweepCreation(snapshot, "planar-composite-sweep");
      } finally {
        kernel.disposeShape(shape);
      }

      const cornerShape = kernel.compositeSweep!(
        rectangleProfile("line-corner-composite-profile", 2, 4),
        planarCompositeWithLineCorner(),
        SWEEP_OPTIONS,
        { feature: "line-corner-composite-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(cornerShape)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(cornerShape).volume).toBeCloseTo(
          120 + 20 * Math.PI,
          8,
        );
      } finally {
        kernel.disposeShape(cornerShape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves the profile alignment tolerance admitted by the sweep protocol", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.compositeSweep!(
        rectangleProfile("tolerance-aligned-profile", 2, 4),
        rotateCompositePathAboutY(planarCompositePath(), 5e-8),
        SWEEP_OPTIONS,
        { feature: "tolerance-aligned-sweep", tolerance: 1e-6 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(shape).volume).toBeCloseTo(
          80 + 20 * Math.PI,
          8,
        );
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("transports a rectangle through a spatial tangent arc chain", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.compositeSweep!(
        rectangleProfile("spatial-composite-profile", 2, 4, "YZ"),
        spatialTangentArcChain(),
        SWEEP_OPTIONS,
        { feature: "spatial-composite-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo((160 * Math.PI) / 3, 7);
        expect(measured.surfaceArea).toBeCloseTo(80 * Math.PI + 16, 7);
        expect(measured.genus).toBe(0);

        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 10, 20);
        expectBroadSweepCreation(snapshot, "spatial-composite-sweep");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves selected major and near-full composite traversals", async () => {
    const kernel = await createOcctKernel();
    try {
      const majorShape = kernel.compositeSweep!(
        rectangleProfile("major-composite-profile", 1, 1),
        majorCompositePath(),
        SWEEP_OPTIONS,
        { feature: "major-composite-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(majorShape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(majorShape);
        expect(measured.volume).toBeCloseTo(6 + 15 * Math.PI, 8);
        expect(measured.surfaceArea).toBeCloseTo(26 + 60 * Math.PI, 8);
        const snapshot = topology(kernel, majorShape);
        expectClosedSolidTopology(snapshot, 14, 28);
        expectBroadSweepCreation(snapshot, "major-composite-sweep");
      } finally {
        kernel.disposeShape(majorShape);
      }

      const nearFullShape = kernel.compositeSweep!(
        rectangleProfile("near-full-composite-profile", 0.02, 0.02),
        nearFullCompositePath(),
        SWEEP_OPTIONS,
        { feature: "near-full-composite-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(nearFullShape)).toEqual({
          ok: true,
          code: "VALID",
        });
        const pathLength = 0.2 + 20 * (Math.PI * 2 - 0.02);
        const measured = kernel.measure(nearFullShape);
        expect(measured.volume).toBeCloseTo(0.0004 * pathLength, 9);
        expect(measured.surfaceArea).toBeCloseTo(
          0.08 * pathLength + 0.0008,
          8,
        );
        const snapshot = topology(kernel, nearFullShape);
        expectClosedSolidTopology(snapshot, 14, 28);
        expectBroadSweepCreation(snapshot, "near-full-composite-sweep");
      } finally {
        kernel.disposeShape(nearFullShape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("keeps analytic profile moments authoritative while certifying admitted native noise", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as InjectableOcctRaw;
    const originalArea = raw.getSurfaceArea.bind(raw);
    const originalCentroid = raw.getSurfaceCenterOfMass.bind(raw);
    const baselineShapeCount = raw.shapeCount;
    let areaCalls = 0;
    let centroidCalls = 0;
    let shape: KernelShape | undefined;
    try {
      raw.getSurfaceArea = (...args) => {
        areaCalls += 1;
        return originalArea(...args) * (1 + 5e-10);
      };
      raw.getSurfaceCenterOfMass = (...args) => {
        centroidCalls += 1;
        const centroid = originalCentroid(...args);
        return { ...centroid, x: centroid.x + 5e-7 };
      };

      try {
        shape = kernel.compositeSweep!(
          rectangleProfile("native-noise-profile", 2, 4),
          planarCompositePath(),
          SWEEP_OPTIONS,
          { feature: "native-noise-sweep", tolerance: 1e-6 },
        );
      } finally {
        raw.getSurfaceArea = originalArea;
        raw.getSurfaceCenterOfMass = originalCentroid;
      }

      expect(areaCalls).toBe(1);
      expect(centroidCalls).toBe(1);
      expect(kernel.measure(shape).volume).toBeCloseTo(
        80 + 20 * Math.PI,
        10,
      );
    } finally {
      try {
        raw.getSurfaceArea = originalArea;
        raw.getSurfaceCenterOfMass = originalCentroid;
        if (shape !== undefined) kernel.disposeShape(shape);
        expect(raw.shapeCount).toBe(baselineShapeCount);
      } finally {
        kernel.dispose();
      }
    }
  });

  it("rejects structured native mass-property mismatches before allocating a path and recovers", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as InjectableOcctRaw;
    const originalArea = raw.getSurfaceArea.bind(raw);
    const originalCentroid = raw.getSurfaceCenterOfMass.bind(raw);
    const originalMakeLineEdge = raw.makeLineEdge.bind(raw);
    const originalMakeArcEdge = raw.makeArcEdge.bind(raw);
    const originalMakeWire = raw.makeWire.bind(raw);
    const originalSweep = raw.sweep.bind(raw);
    const baselineShapeCount = raw.shapeCount;
    const profile = circleProfile("native-mismatch-profile", 1);
    const path = planarCompositePath();
    let makeLineEdgeCalls = 0;
    let makeArcEdgeCalls = 0;
    let makeWireCalls = 0;
    let sweepCalls = 0;

    const resetAllocationCalls = (): void => {
      makeLineEdgeCalls = 0;
      makeArcEdgeCalls = 0;
      makeWireCalls = 0;
      sweepCalls = 0;
    };
    const expectPreallocationFailure = (
      reason: "area-mismatch" | "centroid-mismatch",
    ): OcctProfileMassPropertyError => {
      let thrown: unknown;
      try {
        kernel.compositeSweep!(profile, path, SWEEP_OPTIONS, {
          feature: `native-${reason}`,
          tolerance: 1e-7,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(OcctProfileMassPropertyError);
      if (!(thrown instanceof OcctProfileMassPropertyError)) {
        throw new Error("Expected a structured OCCT profile mass-property error");
      }
      const massPropertyError = thrown as OcctProfileMassPropertyError;
      expect(massPropertyError.reason).toBe(reason);
      expect(massPropertyError.diagnostics).toMatchObject({
        analyticArea: Math.PI,
        nativeArea: expect.any(Number),
        areaError: expect.any(Number),
        areaAllowance: expect.any(Number),
      });
      expect(makeWireCalls).toBe(1);
      expect(makeLineEdgeCalls).toBe(0);
      expect(makeArcEdgeCalls).toBe(0);
      expect(sweepCalls).toBe(0);
      expect(raw.shapeCount).toBe(baselineShapeCount);
      return massPropertyError;
    };

    raw.makeLineEdge = (...args) => {
      makeLineEdgeCalls += 1;
      return originalMakeLineEdge(...args);
    };
    raw.makeArcEdge = (...args) => {
      makeArcEdgeCalls += 1;
      return originalMakeArcEdge(...args);
    };
    raw.makeWire = (...args) => {
      makeWireCalls += 1;
      return originalMakeWire(...args);
    };
    raw.sweep = (...args) => {
      sweepCalls += 1;
      return originalSweep(...args);
    };

    try {
      raw.getSurfaceArea = (...args) => originalArea(...args) * 2;
      const areaError = expectPreallocationFailure("area-mismatch");
      expect(areaError.diagnostics!.areaError).toBeGreaterThan(
        areaError.diagnostics!.areaAllowance,
      );

      raw.getSurfaceArea = originalArea;
      raw.getSurfaceCenterOfMass = (...args) => {
        const centroid = originalCentroid(...args);
        return { ...centroid, x: centroid.x + 1e-3 };
      };
      resetAllocationCalls();
      const centroidError = expectPreallocationFailure("centroid-mismatch");
      expect(centroidError.diagnostics!.centroidError?.[0]).toBeGreaterThan(
        centroidError.diagnostics!.centroidAllowance?.[0] ??
          Number.POSITIVE_INFINITY,
      );

      raw.getSurfaceCenterOfMass = originalCentroid;
      resetAllocationCalls();
      const recovered = kernel.compositeSweep!(
        profile,
        path,
        SWEEP_OPTIONS,
        { feature: "native-mismatch-recovery", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(recovered).volume).toBeCloseTo(
          Math.PI * (10 + (5 * Math.PI) / 2),
          8,
        );
      } finally {
        kernel.disposeShape(recovered);
      }
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      raw.getSurfaceArea = originalArea;
      raw.getSurfaceCenterOfMass = originalCentroid;
      raw.makeLineEdge = originalMakeLineEdge;
      raw.makeArcEdge = originalMakeArcEdge;
      raw.makeWire = originalMakeWire;
      raw.sweep = originalSweep;
      kernel.dispose();
    }
  });

  it("rolls back invalid or throwing native integration before path allocation and recovers", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as InjectableOcctRaw;
    const originalArea = raw.getSurfaceArea.bind(raw);
    const originalCentroid = raw.getSurfaceCenterOfMass.bind(raw);
    const originalMakeLineEdge = raw.makeLineEdge.bind(raw);
    const originalMakeArcEdge = raw.makeArcEdge.bind(raw);
    const originalMakeWire = raw.makeWire.bind(raw);
    const originalSweep = raw.sweep.bind(raw);
    const baselineShapeCount = raw.shapeCount;
    const profile = circleProfile("native-integration-failure-profile", 1);
    const path = planarCompositePath();
    const centroidFailure = new Error("injected native centroid failure");
    let makeLineEdgeCalls = 0;
    let makeArcEdgeCalls = 0;
    let makeWireCalls = 0;
    let sweepCalls = 0;

    raw.makeLineEdge = (...args) => {
      makeLineEdgeCalls += 1;
      return originalMakeLineEdge(...args);
    };
    raw.makeArcEdge = (...args) => {
      makeArcEdgeCalls += 1;
      return originalMakeArcEdge(...args);
    };
    raw.makeWire = (...args) => {
      makeWireCalls += 1;
      return originalMakeWire(...args);
    };
    raw.sweep = (...args) => {
      sweepCalls += 1;
      return originalSweep(...args);
    };

    const failures = [
      {
        feature: "non-finite-native-area",
        inject: () => {
          raw.getSurfaceArea = () => Number.NaN;
        },
        assertError: (error: unknown) => {
          expect(error).toBeInstanceOf(RangeError);
          expect((error as Error).message).toContain(
            "valid simple planar face",
          );
        },
      },
      {
        feature: "throwing-native-centroid",
        inject: () => {
          raw.getSurfaceCenterOfMass = () => {
            throw centroidFailure;
          };
        },
        assertError: (error: unknown) => {
          expect(error).toBe(centroidFailure);
        },
      },
    ] as const;

    try {
      for (const failure of failures) {
        makeLineEdgeCalls = 0;
        makeArcEdgeCalls = 0;
        makeWireCalls = 0;
        sweepCalls = 0;
        failure.inject();
        let thrown: unknown;
        let unexpectedShape: KernelShape | undefined;
        try {
          unexpectedShape = kernel.compositeSweep!(
            profile,
            path,
            SWEEP_OPTIONS,
            { feature: failure.feature, tolerance: 1e-7 },
          );
        } catch (error) {
          thrown = error;
        } finally {
          raw.getSurfaceArea = originalArea;
          raw.getSurfaceCenterOfMass = originalCentroid;
          if (unexpectedShape !== undefined) {
            kernel.disposeShape(unexpectedShape);
          }
        }

        failure.assertError(thrown);
        expect(makeWireCalls).toBe(1);
        expect(makeLineEdgeCalls).toBe(0);
        expect(makeArcEdgeCalls).toBe(0);
        expect(sweepCalls).toBe(0);
        expect(raw.shapeCount).toBe(baselineShapeCount);
      }

      const recovered = kernel.compositeSweep!(
        profile,
        path,
        SWEEP_OPTIONS,
        { feature: "native-integration-failure-recovery", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
      } finally {
        kernel.disposeShape(recovered);
      }
    } finally {
      try {
        raw.getSurfaceArea = originalArea;
        raw.getSurfaceCenterOfMass = originalCentroid;
        raw.makeLineEdge = originalMakeLineEdge;
        raw.makeArcEdge = originalMakeArcEdge;
        raw.makeWire = originalMakeWire;
        raw.sweep = originalSweep;
        expect(raw.shapeCount).toBe(baselineShapeCount);
      } finally {
        kernel.dispose();
      }
    }
  });

  it("keeps analytic composite volume invariant at a large world translation", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as InjectableOcctRaw;
    const originalCentroid = raw.getSurfaceCenterOfMass.bind(raw);
    const baselineShapeCount = raw.shapeCount;
    const path = integerPlanarCompositePath();
    const profile = translatedRectangleProfile(
      "large-world-local-profile",
      2,
      4,
      [0.1, 0],
    );
    const translation: Vec3 = [2 ** 31, -(2 ** 31), 2 ** 31];
    const translatedProfile: ResolvedProfile = {
      ...profile,
      plane: { ...profile.plane, origin: translation },
    };
    const translatedPath = translateCompositePath(path, translation);
    let localShape: KernelShape | undefined;
    let translatedShape: KernelShape | undefined;
    let capturedNativeCentroid:
      | { readonly x: number; readonly y: number; readonly z: number }
      | undefined;
    try {
      localShape = kernel.compositeSweep!(
        profile,
        path,
        SWEEP_OPTIONS,
        { feature: "large-world-local-sweep", tolerance: 1e-8 },
      );
      raw.getSurfaceCenterOfMass = (...args) => {
        const centroid = originalCentroid(...args);
        capturedNativeCentroid = centroid;
        return centroid;
      };
      try {
        translatedShape = kernel.compositeSweep!(
          translatedProfile,
          translatedPath,
          SWEEP_OPTIONS,
          { feature: "large-world-translated-sweep", tolerance: 1e-8 },
        );
      } finally {
        raw.getSurfaceCenterOfMass = originalCentroid;
      }

      expect(capturedNativeCentroid).toBeDefined();
      const capturedLocalX = capturedNativeCentroid!.x - translation[0];
      expect(Math.abs(capturedLocalX - 0.1)).toBeGreaterThan(1e-8);
      const expectedVolume = 80 + 19.6 * Math.PI;
      const localVolume = kernel.measure(localShape).volume;
      const translatedVolume = kernel.measure(translatedShape).volume;
      expect(localVolume).toBeCloseTo(expectedVolume, 12);
      expect(translatedVolume).toBe(localVolume);
    } finally {
      try {
        raw.getSurfaceCenterOfMass = originalCentroid;
        if (translatedShape !== undefined) kernel.disposeShape(translatedShape);
        if (localShape !== undefined) kernel.disposeShape(localShape);
        expect(raw.shapeCount).toBe(baselineShapeCount);
      } finally {
        kernel.dispose();
      }
    }
  });

  it("does not let a large X coordinate mask a native Y centroid mismatch", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as InjectableOcctRaw;
    const originalCentroid = raw.getSurfaceCenterOfMass.bind(raw);
    const originalMakeLineEdge = raw.makeLineEdge.bind(raw);
    const originalMakeArcEdge = raw.makeArcEdge.bind(raw);
    const originalMakeWire = raw.makeWire.bind(raw);
    const originalSweep = raw.sweep.bind(raw);
    const baselineShapeCount = raw.shapeCount;
    const translation: Vec3 = [2 ** 31, 0, 0];
    const profile: ResolvedProfile = {
      ...circleProfile("large-x-y-mismatch-profile", 1),
      plane: { plane: "XY", origin: translation },
    };
    const path = translateCompositePath(
      integerPlanarCompositePath(),
      translation,
    );
    let makeLineEdgeCalls = 0;
    let makeArcEdgeCalls = 0;
    let makeWireCalls = 0;
    let sweepCalls = 0;
    try {
      raw.getSurfaceCenterOfMass = (...args) => {
        const centroid = originalCentroid(...args);
        return { ...centroid, y: centroid.y + 1e-5 };
      };
      raw.makeLineEdge = (...args) => {
        makeLineEdgeCalls += 1;
        return originalMakeLineEdge(...args);
      };
      raw.makeArcEdge = (...args) => {
        makeArcEdgeCalls += 1;
        return originalMakeArcEdge(...args);
      };
      raw.makeWire = (...args) => {
        makeWireCalls += 1;
        return originalMakeWire(...args);
      };
      raw.sweep = (...args) => {
        sweepCalls += 1;
        return originalSweep(...args);
      };

      let thrown: unknown;
      try {
        kernel.compositeSweep!(profile, path, SWEEP_OPTIONS, {
          feature: "large-x-y-mismatch-sweep",
          tolerance: 1e-8,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(OcctProfileMassPropertyError);
      if (!(thrown instanceof OcctProfileMassPropertyError)) {
        throw new Error("Expected a structured OCCT profile mass-property error");
      }
      const massPropertyError = thrown as OcctProfileMassPropertyError;
      expect(massPropertyError.reason).toBe("centroid-mismatch");
      expect(massPropertyError.diagnostics!.centroidError?.[1]).toBeGreaterThan(
        massPropertyError.diagnostics!.centroidAllowance?.[1] ??
          Number.POSITIVE_INFINITY,
      );
      expect(
        massPropertyError.diagnostics!.coordinateRoundoffBound?.[1],
      ).toBeLessThan(1e-10);
      expect(makeWireCalls).toBe(1);
      expect(makeLineEdgeCalls).toBe(0);
      expect(makeArcEdgeCalls).toBe(0);
      expect(sweepCalls).toBe(0);
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      raw.getSurfaceCenterOfMass = originalCentroid;
      raw.makeLineEdge = originalMakeLineEdge;
      raw.makeArcEdge = originalMakeArcEdge;
      raw.makeWire = originalMakeWire;
      raw.sweep = originalSweep;
      kernel.dispose();
    }
  });

  it("fails closed on PipeShell angular conditioning and unbounded eccentric major profiles", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as { readonly shapeCount: number };
    const baselineShapeCount = raw.shapeCount;
    try {
      expect(() =>
        kernel.compositeSweep!(
          rectangleProfile("conditioned-near-full-profile", 0.01, 0.01, "YZ"),
          angularlyConditionedNearFullPath(),
          SWEEP_OPTIONS,
          { feature: "conditioned-near-full-sweep", tolerance: 1e-7 },
        ),
      ).toThrow("transported-profile analytic volume postcondition");
      expect(raw.shapeCount).toBe(baselineShapeCount);

      expect(() =>
        kernel.compositeSweep!(
          rectangleProfile("multi-arc-major-profile", 1, 1),
          majorArcChainPath(),
          SWEEP_OPTIONS,
          { feature: "multi-arc-major-sweep", tolerance: 1e-7 },
        ),
      ).toThrow("require exactly one circular-arc segment");
      expect(raw.shapeCount).toBe(baselineShapeCount);

      const eccentric = translatedRectangleProfile(
        "eccentric-major-profile",
        1,
        1,
        [1, 0],
      );
      expect(() =>
        kernel.compositeSweep!(
          eccentric,
          majorCompositePath(),
          SWEEP_OPTIONS,
          { feature: "eccentric-major-sweep", tolerance: 1e-7 },
        ),
      ).toThrow("require the profile area centroid at the path start");
      expect(raw.shapeCount).toBe(baselineShapeCount);

      const recovered = kernel.compositeSweep!(
        rectangleProfile("postcondition-recovery-profile", 1, 1),
        majorCompositePath(),
        SWEEP_OPTIONS,
        { feature: "postcondition-recovery-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
      } finally {
        kernel.disposeShape(recovered);
      }
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      kernel.dispose();
    }
  });

  it("uses the requested context tolerance for stock major eccentricity", async () => {
    const path = majorCompositePath();
    const profile = translatedRectangleProfile(
      "requested-tolerance-major-profile",
      1,
      1,
      [5e-6, 0],
    );

    const strictKernel = await createOcctKernel({ modelingTolerance: 1e-5 });
    const strictRaw = (strictKernel as any).raw as {
      readonly shapeCount: number;
    };
    const strictBaseline = strictRaw.shapeCount;
    try {
      expect(() =>
        strictKernel.compositeSweep!(profile, path, SWEEP_OPTIONS, {
          feature: "strict-requested-tolerance-sweep",
          tolerance: 1e-7,
        }),
      ).toThrow("require the profile area centroid at the path start");
      expect(strictRaw.shapeCount).toBe(strictBaseline);
    } finally {
      strictKernel.dispose();
    }

    const looseKernel = await createOcctKernel({ modelingTolerance: 1e-7 });
    const looseRaw = (looseKernel as any).raw as {
      readonly shapeCount: number;
    };
    const looseBaseline = looseRaw.shapeCount;
    try {
      const shape = looseKernel.compositeSweep!(
        profile,
        path,
        SWEEP_OPTIONS,
        {
          feature: "loose-requested-tolerance-sweep",
          tolerance: 1e-5,
        },
      );
      try {
        expect(looseKernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        expect(looseKernel.measure(shape).volume).toBeGreaterThan(0);
      } finally {
        looseKernel.disposeShape(shape);
      }
      expect(looseRaw.shapeCount).toBe(looseBaseline);
    } finally {
      looseKernel.dispose();
    }
  });

  it("rejects sub-tolerance PipeShell geometry and unstable arc points", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(() =>
        kernel.compositeSweep!(
          rectangleProfile("short-composite-profile", 5e-5, 5e-5),
          planarCompositePath(),
          SWEEP_OPTIONS,
          { feature: "short-composite-profile-sweep", tolerance: 1e-12 },
        ),
      ).toThrow("OCCT pipe-shell linear tolerance");

      const shortChordRadius = 4.5e-5;
      expect(() =>
        kernel.compositeSweep!(
          circleProfile("short-composite-chord-profile", 2e-5, "YZ"),
          {
            kind: "composite",
            start: [0, 0, 0],
            segments: [
              {
                kind: "circularArc",
                through: [shortChordRadius, shortChordRadius, 0],
                end: [0, shortChordRadius * 2, 0],
              },
              { kind: "line", end: [-1, shortChordRadius * 2, 0] },
            ],
            closed: false,
          },
          SWEEP_OPTIONS,
          { feature: "short-composite-chord-sweep", tolerance: 1e-12 },
        ),
      ).toThrow("OCCT pipe-shell linear tolerance");

      expect(() =>
        kernel.compositeSweep!(
          rectangleProfile("short-composite-path-profile", 2, 4),
          shortLineCompositePath(),
          SWEEP_OPTIONS,
          { feature: "short-composite-path-sweep", tolerance: 1e-12 },
        ),
      ).toThrow("OCCT pipe-shell linear tolerance");

      const unstableArc = {
        kind: "circularArc" as const,
        start: [0, 0, 0] as Vec3,
        through: [1.1e-7, 0, 46.90415759823429] as Vec3,
        end: [4.4e-7, 0, 93.80831519646858] as Vec3,
      };
      const endTangent = resolvedCircularArcGeometry(unstableArc)!.endTangent;
      const unstablePath: ResolvedCompositePath = {
        kind: "composite",
        start: unstableArc.start,
        segments: [
          {
            kind: "circularArc",
            through: unstableArc.through,
            end: unstableArc.end,
          },
          {
            kind: "line",
            end: add(unstableArc.end, scale(endTangent, 10)),
          },
        ],
        closed: false,
      };
      expect(() =>
        kernel.compositeSweep!(
          circleProfile("unstable-composite-profile", 0.001),
          unstablePath,
          SWEEP_OPTIONS,
          { feature: "unstable-composite-sweep", tolerance: 1e-7 },
        ),
      ).toThrow("OCCT three-point angular resolution");
    } finally {
      kernel.dispose();
    }
  });

  it("releases every injected native failure and recovers", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as {
      makeArcEdge: (...args: any[]) => any;
      makeWire: (...args: any[]) => any;
      curveTangent: (...args: any[]) => any;
      sweep: (...args: any[]) => any;
      makeNullShape: (...args: any[]) => any;
      readonly shapeCount: number;
    };
    const originalMakeArcEdge = raw.makeArcEdge!.bind(raw);
    const originalMakeWire = raw.makeWire!.bind(raw);
    const originalCurveTangent = raw.curveTangent!.bind(raw);
    const originalSweep = raw.sweep!.bind(raw);
    const originalMakeNullShape = raw.makeNullShape!.bind(raw);
    const baselineShapeCount = raw.shapeCount;
    const profile = rectangleProfile("injected-composite-profile", 2, 4);
    const path = planarCompositePath();

    const expectCleanFailure = (message: string): void => {
      expect(() =>
        kernel.compositeSweep!(profile, path, SWEEP_OPTIONS, {
          feature: `injected-${message}`,
          tolerance: 1e-7,
        }),
      ).toThrow(message);
      expect(raw.shapeCount).toBe(baselineShapeCount);
    };

    try {
      try {
        raw.makeArcEdge = () => {
          throw new Error("injected makeArcEdge failure");
        };
        expectCleanFailure("injected makeArcEdge failure");
      } finally {
        raw.makeArcEdge = originalMakeArcEdge;
      }

      try {
        let makeWireCalls = 0;
        raw.makeWire = (...args: any[]) => {
          makeWireCalls += 1;
          if (makeWireCalls === 2) {
            throw new Error("injected path makeWire failure");
          }
          return originalMakeWire(...args);
        };
        expectCleanFailure("injected path makeWire failure");
      } finally {
        raw.makeWire = originalMakeWire;
      }

      try {
        raw.curveTangent = () => ({ x: 0, y: 1, z: 0 });
        expectCleanFailure("changed its authored tangents");
      } finally {
        raw.curveTangent = originalCurveTangent;
      }

      try {
        raw.sweep = () => {
          throw new Error("injected composite sweep failure");
        };
        expectCleanFailure("injected composite sweep failure");
      } finally {
        raw.sweep = originalSweep;
      }

      try {
        raw.sweep = () => originalMakeNullShape();
        expectCleanFailure("Sweep did not produce one valid solid");
      } finally {
        raw.sweep = originalSweep;
      }

      const recovered = kernel.compositeSweep!(
        rectangleProfile("recovered-composite-profile", 2, 4),
        planarCompositePath(),
        SWEEP_OPTIONS,
        { feature: "recovered-composite-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(recovered).volume).toBeCloseTo(
          80 + 20 * Math.PI,
          8,
        );
      } finally {
        kernel.disposeShape(recovered);
      }
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      raw.makeArcEdge = originalMakeArcEdge;
      raw.makeWire = originalMakeWire;
      raw.curveTangent = originalCurveTangent;
      raw.sweep = originalSweep;
      kernel.dispose();
    }
  });
});
