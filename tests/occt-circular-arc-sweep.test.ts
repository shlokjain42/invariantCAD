import { describe, expect, it, vi } from "vitest";
import {
  kernelSupports,
  resolvedCircularArcGeometry,
  resolvedProfileLocalAreaMoments,
  type GeometryKernel,
  type KernelShape,
  type KernelTopologySnapshot,
  type ProfileCurveSource,
  type ResolvedCircularArcPath,
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

type Vec3 = ResolvedCircularArcPath["start"];

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

function arcPath(
  start: Vec3,
  through: Vec3,
  end: Vec3,
): ResolvedCircularArcPath {
  return { kind: "circularArc", start, through, end, closed: false };
}

function quarterArc(direction: 1 | -1 = 1): ResolvedCircularArcPath {
  return arcPath(
    [0, 0, 0],
    [5 - 5 / Math.sqrt(2), 0, direction * (5 / Math.sqrt(2))],
    [5, 0, direction * 5],
  );
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

function cross(first: Vec3, second: Vec3): Vec3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function dot(first: Vec3, second: Vec3): number {
  return (
    first[0] * second[0] +
    first[1] * second[1] +
    first[2] * second[2]
  );
}

function rotateAroundAxis(value: Vec3, axis: Vec3, angle: number): Vec3 {
  return add(
    add(
      scale(value, Math.cos(angle)),
      scale(cross(axis, value), Math.sin(angle)),
    ),
    scale(axis, dot(axis, value) * (1 - Math.cos(angle))),
  );
}

function spatialArc(): ResolvedCircularArcPath {
  const inverseSqrtTwo = 1 / Math.sqrt(2);
  const normal: Vec3 = [inverseSqrtTwo, inverseSqrtTwo, 0];
  const startRadius: Vec3 = [
    -7 * inverseSqrtTwo,
    7 * inverseSqrtTwo,
    0,
  ];
  const center = scale(startRadius, -1);
  const point = (angle: number): Vec3 =>
    add(center, rotateAroundAxis(startRadius, normal, angle));
  return arcPath(point(0), point(Math.PI / 3), point((Math.PI * 2) / 3));
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
  expectTwoFaceAdjacency = true,
): void {
  expect(snapshot.faces).toHaveLength(faces);
  expect(snapshot.edges).toHaveLength(edges);
  if (expectTwoFaceAdjacency) {
    expect(snapshot.edges.every((edge) => edge.faces.length === 2)).toBe(true);
  }
}

describe("OCCT exact circular-arc solid sweep", () => {
  it("advertises the dedicated bounded capability", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(
        kernelSupports(kernel.capabilities, "feature", "circularArcSweep"),
      ).toBe(true);
      expect(kernel.circularArcSweep).toBeTypeOf("function");
      expect(kernelSupports(kernel.capabilities, "feature", "sweep")).toBe(
        true,
      );
    } finally {
      kernel.dispose();
    }
  });

  it("sweeps and exports an exact quarter-arc rectangle", async () => {
    const kernel = await createOcctKernel();
    try {
      const path = quarterArc();
      const geometry = resolvedCircularArcGeometry(path)!;
      expect(geometry.radius).toBeCloseTo(5, 12);
      expect(geometry.sweep).toBeCloseTo(Math.PI / 2, 12);
      expect(geometry.length).toBeCloseTo((5 * Math.PI) / 2, 12);
      expectVectorClose(geometry.startTangent, [0, 0, 1]);

      const shape = kernel.circularArcSweep!(
        rectangleProfile("quarter-profile", 2, 4),
        path,
        SWEEP_OPTIONS,
        { feature: "quarter-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(20 * Math.PI, 8);
        expect(measured.surfaceArea).toBeCloseTo(30 * Math.PI + 16, 8);
        expectVectorClose(measured.boundingBox.min, [-1, -2, 0]);
        expectVectorClose(measured.boundingBox.max, [5, 2, 6]);
        expect(measured.genus).toBe(0);

        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 6, 12);
        expectBroadSweepCreation(snapshot, "quarter-arc-sweep");
        const longitudinal = snapshot.edges
          .filter((edge) => edge.curve.kind === "circle")
          .map((edge) => edge.length)
          .sort((first, second) => first - second);
        expect(longitudinal).toHaveLength(4);
        for (const [index, length] of longitudinal.entries()) {
          expect(length).toBeCloseTo(
            index < 2 ? 2 * Math.PI : 3 * Math.PI,
            8,
          );
        }

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

  it("keeps analytic volume exact when native profile area and centroid contain admitted noise", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as {
      getSurfaceArea: (...args: any[]) => number;
      getSurfaceCenterOfMass: (...args: any[]) => {
        readonly x: number;
        readonly y: number;
        readonly z: number;
      };
    };
    const originalArea = raw.getSurfaceArea.bind(raw);
    const originalCentroid = raw.getSurfaceCenterOfMass.bind(raw);
    let areaNoiseInjected = false;
    let centroidNoiseInjected = false;
    try {
      raw.getSurfaceArea = (...args: any[]) => {
        const area = originalArea(...args);
        if (areaNoiseInjected) return area;
        areaNoiseInjected = true;
        return area + 4e-9;
      };
      raw.getSurfaceCenterOfMass = (...args: any[]) => {
        const centroid = originalCentroid(...args);
        if (centroidNoiseInjected) return centroid;
        centroidNoiseInjected = true;
        return {
          x: centroid.x + 2e-7,
          y: centroid.y - 3e-7,
          z: centroid.z + 1e-7,
        };
      };

      const shape = kernel.circularArcSweep!(
        rectangleProfile("noisy-native-profile", 2, 4),
        quarterArc(),
        SWEEP_OPTIONS,
        { feature: "noisy-native-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(areaNoiseInjected).toBe(true);
        expect(centroidNoiseInjected).toBe(true);
        expect(kernel.measure(shape).volume).toBeCloseTo(20 * Math.PI, 12);
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      raw.getSurfaceArea = originalArea;
      raw.getSurfaceCenterOfMass = originalCentroid;
      kernel.dispose();
    }
  });

  it("admits certified translated circular-revolution drift and preserves analytic volume", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as { readonly shapeCount: number };
    const baselineShapeCount = raw.shapeCount;
    const translation = 1e12;
    const nominalRadius = 5 / 6;
    const start: Vec3 = [translation, 0, translation];
    const fractionalRadiusPath = arcPath(
      start,
      [translation + nominalRadius, 0, translation + nominalRadius],
      [translation, 0, translation + 2 * nominalRadius],
    );
    const halfSize = 0.05;
    const translatedProfile: ResolvedProfile = {
      plane: { plane: "YZ", origin: start },
      outer: {
        curves: [
          {
            kind: "line",
            start: [-halfSize, -halfSize],
            end: [halfSize, -halfSize],
          },
          {
            kind: "line",
            start: [halfSize, -halfSize],
            end: [halfSize, halfSize],
          },
          {
            kind: "line",
            start: [halfSize, halfSize],
            end: [-halfSize, halfSize],
          },
          {
            kind: "line",
            start: [-halfSize, halfSize],
            end: [-halfSize, -halfSize],
          },
        ],
      },
      holes: [],
    };

    try {
      const translated = kernel.circularArcSweep!(
        translatedProfile,
        fractionalRadiusPath,
        SWEEP_OPTIONS,
        {
          feature: "translated-fractional-radius-sweep",
          tolerance: 1e-4,
        },
      );
      try {
        const geometry = resolvedCircularArcGeometry(fractionalRadiusPath)!;
        const moments = resolvedProfileLocalAreaMoments(
          translatedProfile,
          1e-4,
        );
        expect(moments.ok).toBe(true);
        if (!moments.ok) throw new Error(moments.message);
        const centroidFromCenter: Vec3 = [
          -geometry.centerOffsetFromStart[0],
          moments.localCentroid[0] - geometry.centerOffsetFromStart[1],
          moments.localCentroid[1] - geometry.centerOffsetFromStart[2],
        ];
        const normalSpeed = Math.abs(
          geometry.normal[1] * centroidFromCenter[2] -
            geometry.normal[2] * centroidFromCenter[1],
        );
        expect(kernel.status(translated)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(translated).volume).toBeCloseTo(
          moments.area * normalSpeed * geometry.sweep,
          14,
        );
      } finally {
        kernel.disposeShape(translated);
      }
      expect(raw.shapeCount).toBe(baselineShapeCount);

      const recovered = kernel.circularArcSweep!(
        rectangleProfile("postcondition-recovery-profile", 2, 4),
        quarterArc(),
        SWEEP_OPTIONS,
        { feature: "postcondition-recovery-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(recovered).volume).toBeCloseTo(20 * Math.PI, 12);
      } finally {
        kernel.disposeShape(recovered);
      }
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      kernel.dispose();
    }
  });

  it("reports native centroid disagreement before revolve, rolls back, and recovers", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as {
      getSurfaceCenterOfMass: (...args: any[]) => {
        readonly x: number;
        readonly y: number;
        readonly z: number;
      };
      revolve: (...args: any[]) => any;
      readonly shapeCount: number;
    };
    const originalCentroid = raw.getSurfaceCenterOfMass.bind(raw);
    const originalRevolve = raw.revolve.bind(raw);
    const baselineShapeCount = raw.shapeCount;
    let centroidMismatchInjected = false;
    let revolveCalls = 0;
    try {
      raw.getSurfaceCenterOfMass = (...args: any[]) => {
        const centroid = originalCentroid(...args);
        if (centroidMismatchInjected) return centroid;
        centroidMismatchInjected = true;
        return {
          x: centroid.x + 1e-4,
          y: centroid.y,
          z: centroid.z,
        };
      };
      raw.revolve = (...args: any[]) => {
        revolveCalls += 1;
        return originalRevolve(...args);
      };

      let error: unknown;
      try {
        kernel.circularArcSweep!(
          rectangleProfile("mismatched-native-profile", 2, 4),
          quarterArc(),
          SWEEP_OPTIONS,
          { feature: "mismatched-native-arc-sweep", tolerance: 1e-7 },
        );
      } catch (caught) {
        error = caught;
      }
      expect(centroidMismatchInjected).toBe(true);
      expect(error).toBeInstanceOf(OcctProfileMassPropertyError);
      if (!(error instanceof OcctProfileMassPropertyError)) {
        throw new Error("Expected a structured profile mass-property error");
      }
      const profileError = error;
      expect(profileError.reason).toBe("centroid-mismatch");
      expect(Object.isFrozen(profileError)).toBe(true);
      expect(Object.isFrozen(profileError.diagnostics)).toBe(true);
      expect(profileError.diagnostics).toMatchObject({
        analyticArea: 8,
        nativeArea: 8,
        analyticCentroidOffset: [0, 0, 0],
        centroidError: [
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
        ],
        centroidAllowance: expect.any(Array),
      });
      expect(
        Object.isFrozen(profileError.diagnostics!.centroidError),
      ).toBe(true);
      expect(profileError.diagnostics!.centroidError![0]).toBeGreaterThan(
        profileError.diagnostics!.centroidAllowance![0],
      );
      expect(revolveCalls).toBe(0);
      expect(raw.shapeCount).toBe(baselineShapeCount);

      raw.getSurfaceCenterOfMass = originalCentroid;
      const recovered = kernel.circularArcSweep!(
        rectangleProfile("recovered-native-profile", 2, 4),
        quarterArc(),
        SWEEP_OPTIONS,
        { feature: "recovered-native-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(recovered).volume).toBeCloseTo(
          20 * Math.PI,
          12,
        );
        expect(revolveCalls).toBe(1);
      } finally {
        kernel.disposeShape(recovered);
      }
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      raw.getSurfaceCenterOfMass = originalCentroid;
      raw.revolve = originalRevolve;
      kernel.dispose();
    }
  });

  it("transports a rectangle along an arbitrarily oriented spatial arc", async () => {
    const kernel = await createOcctKernel();
    try {
      const path = spatialArc();
      const geometry = resolvedCircularArcGeometry(path)!;
      expect(geometry.radius).toBeCloseTo(7, 10);
      expect(geometry.sweep).toBeCloseTo((Math.PI * 2) / 3, 10);
      expect(geometry.length).toBeCloseTo((Math.PI * 14) / 3, 10);
      expectVectorClose(geometry.startTangent, [0, 0, 1]);

      const shape = kernel.circularArcSweep!(
        rectangleProfile("spatial-arc-profile", 2, 4),
        path,
        SWEEP_OPTIONS,
        { feature: "spatial-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo((Math.PI * 112) / 3, 8);
        expect(measured.surfaceArea).toBeCloseTo(56 * Math.PI + 16, 8);
        expect(measured.genus).toBe(0);
        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 6, 12);
        expectBroadSweepCreation(snapshot, "spatial-arc-sweep");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves profile roll and snaps a tolerance-close seat", async () => {
    const kernel = await createOcctKernel();
    try {
      const xMin = -0.5;
      const xMax = 1.5;
      const yMin = -0.25;
      const yMax = 0.75;
      const profile: ResolvedProfile = {
        plane: { plane: "XY", origin: [0, 0, 5e-8] },
        outer: {
          curves: [
            {
              kind: "line",
              start: [xMin, yMin],
              end: [xMax, yMin],
              source: source("off-center-profile", "bottom"),
            },
            {
              kind: "line",
              start: [xMax, yMin],
              end: [xMax, yMax],
              source: source("off-center-profile", "right"),
            },
            {
              kind: "line",
              start: [xMax, yMax],
              end: [xMin, yMax],
              source: source("off-center-profile", "top"),
            },
            {
              kind: "line",
              start: [xMin, yMax],
              end: [xMin, yMin],
              source: source("off-center-profile", "left"),
            },
          ],
        },
        holes: [],
      };
      const shape = kernel.circularArcSweep!(
        profile,
        quarterArc(),
        SWEEP_OPTIONS,
        { feature: "off-center-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(4.5 * Math.PI, 8);
        expect(Math.abs(measured.boundingBox.min[2])).toBeLessThan(1e-10);
        expectClosedSolidTopology(topology(kernel, shape), 6, 12);
        expectBroadSweepCreation(topology(kernel, shape), "off-center-arc-sweep");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves a tiny polygon at near-axis spatial alignment", async () => {
    const kernel = await createOcctKernel();
    try {
      const beta = Math.PI / 180;
      const radius = 1000;
      const sweep = 0.1;
      const startRadius: Vec3 = [0, -Math.sin(beta), Math.cos(beta)];
      const point = (angle: number): Vec3 => [
        radius * Math.sin(angle),
        -2 * radius * Math.sin(angle / 2) ** 2 * startRadius[1],
        -2 * radius * Math.sin(angle / 2) ** 2 * startRadius[2],
      ];
      const profile: ResolvedProfile = {
        ...rectangleProfile("near-axis-profile", 0.002, 0.002),
        plane: { plane: "YZ", origin: [0, 0, 0] },
      };
      const shape = kernel.circularArcSweep!(
        profile,
        arcPath(point(0), point(sweep / 2), point(sweep)),
        SWEEP_OPTIONS,
        { feature: "near-axis-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(0.0004, 12);
        expect(measured.surfaceArea).toBeCloseTo(0.800008, 9);
        expectClosedSolidTopology(topology(kernel, shape), 6, 12);
        expectBroadSweepCreation(topology(kernel, shape), "near-axis-arc-sweep");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("reports stable analytic volume for thin high-radius revolutions", async () => {
    const kernel = await createOcctKernel();
    try {
      const profileRadius = 0.001;
      const phase = 0.123;
      const points = [0, 1, 2].map((index) => {
        const angle = phase + (index * Math.PI * 2) / 3;
        return [
          profileRadius * Math.cos(angle),
          profileRadius * Math.sin(angle),
        ] as const;
      });
      const profile: ResolvedProfile = {
        plane: { plane: "YZ", origin: [0, 0, 0] },
        outer: {
          curves: points.map((start, index) => ({
            kind: "line" as const,
            start,
            end: points[(index + 1) % points.length]!,
            source: source("thin-high-radius-profile", `edge-${index}`),
          })),
        },
        holes: [],
      };
      const radius = 1000;
      const sweep = 1;
      const beta = (97 * Math.PI) / 180;
      const startRadius: Vec3 = [0, -Math.sin(beta), Math.cos(beta)];
      const point = (angle: number): Vec3 => [
        radius * Math.sin(angle),
        -2 * radius * Math.sin(angle / 2) ** 2 * startRadius[1],
        -2 * radius * Math.sin(angle / 2) ** 2 * startRadius[2],
      ];
      const shape = kernel.circularArcSweep!(
        profile,
        arcPath(point(0), point(sweep / 2), point(sweep)),
        SWEEP_OPTIONS,
        { feature: "thin-high-radius-sweep", tolerance: 1e-7 },
      );
      const expectedVolume =
        ((3 * Math.sqrt(3)) / 4) * profileRadius ** 2 * radius * sweep;
      let transformed: KernelShape | undefined;
      let nearUniformlyTransformed: KernelShape | undefined;
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(expectedVolume, 14);
        expect(measured.centerOfMass).not.toBeNull();
        expect(measured.inertiaTensor.flat().every(Number.isFinite)).toBe(true);
        transformed = kernel.transform!(
          shape,
          [
            { kind: "translate", value: [10, -20, 30] },
            { kind: "scale", value: [2, 2, 2] },
          ],
          { feature: "scaled-thin-high-radius-sweep" },
        );
        expect(kernel.status(transformed)).toEqual({ ok: true, code: "VALID" });
        const transformedMeasurement = kernel.measure(transformed);
        expect(transformedMeasurement.volume).toBeCloseTo(
          expectedVolume * 8,
          13,
        );
        for (let row = 0; row < 3; row += 1) {
          for (let column = 0; column < 3; column += 1) {
            expect(transformedMeasurement.inertiaTensor[row]![column]!).toBeCloseTo(
              measured.inertiaTensor[row]![column]! * 32,
              7,
            );
          }
        }
        nearUniformlyTransformed = kernel.transform!(
          shape,
          [{ kind: "scale", value: [2, 2 + 5e-8, 2] }],
          { feature: "near-uniformly-scaled-thin-high-radius-sweep" },
        );
        expect(kernel.status(nearUniformlyTransformed)).toEqual({
          ok: true,
          code: "VALID",
        });
        expect(kernel.measure(nearUniformlyTransformed).volume).toBeCloseTo(
          expectedVolume * 8,
          13,
        );
      } finally {
        if (nearUniformlyTransformed !== undefined) {
          kernel.disposeShape(nearUniformlyTransformed);
        }
        if (transformed !== undefined) kernel.disposeShape(transformed);
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("accounts for a tolerance-admitted profile-tangent skew", async () => {
    const kernel = await createOcctKernel();
    try {
      const skew = 0.005;
      const axis: Vec3 = [0, Math.cos(skew), -Math.sin(skew)];
      const startRadius: Vec3 = [-1, 0, 0];
      const center: Vec3 = [1, 0, 0];
      const point = (angle: number): Vec3 =>
        add(center, rotateAroundAxis(startRadius, axis, angle));
      const sweep = Math.PI / 2;
      const shape = kernel.circularArcSweep!(
        circleProfile("skewed-profile", 0.1),
        arcPath(point(0), point(sweep / 2), point(sweep)),
        SWEEP_OPTIONS,
        { feature: "skewed-profile-sweep", tolerance: 0.01 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const expectedVolume =
          Math.PI * 0.1 ** 2 * Math.cos(skew) * sweep;
        expect(kernel.measure(shape).volume).toBeCloseTo(expectedVolume, 12);
        expectClosedSolidTopology(topology(kernel, shape), 3, 3, false);
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves the authored route through a 270-degree major arc", async () => {
    const kernel = await createOcctKernel();
    try {
      const path = arcPath([0, 0, 0], [10, 0, 0], [5, 0, -5]);
      const geometry = resolvedCircularArcGeometry(path)!;
      expect(geometry.radius).toBeCloseTo(5, 12);
      expect(geometry.sweep).toBeCloseTo((Math.PI * 3) / 2, 12);
      expect(geometry.length).toBeCloseTo((Math.PI * 15) / 2, 12);

      const shape = kernel.circularArcSweep!(
        rectangleProfile("major-arc-profile", 2, 4),
        path,
        SWEEP_OPTIONS,
        { feature: "major-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(60 * Math.PI, 8);
        expect(measured.surfaceArea).toBeCloseTo(90 * Math.PI + 16, 8);
        expectClosedSolidTopology(topology(kernel, shape), 6, 12);
        expectBroadSweepCreation(topology(kernel, shape), "major-arc-sweep");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves a near-full major arc without cap overlap", async () => {
    const kernel = await createOcctKernel();
    try {
      const radius = 5;
      const sweep = Math.PI * 2 - 0.05;
      const point = (angle: number): Vec3 => [
        radius - radius * Math.cos(angle),
        0,
        radius * Math.sin(angle),
      ];
      const path = arcPath(point(0), point(sweep / 2), point(sweep));
      expect(Math.hypot(...path.end)).toBeLessThan(2);
      const shape = kernel.circularArcSweep!(
        circleProfile("near-full-arc-profile", 1),
        path,
        SWEEP_OPTIONS,
        { feature: "near-full-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(Math.PI * radius * sweep, 8);
        expect(measured.surfaceArea).toBeCloseTo(
          2 * Math.PI * radius * sweep + 2 * Math.PI,
          8,
        );
        expectClosedSolidTopology(topology(kernel, shape), 3, 3, false);
        expectBroadSweepCreation(topology(kernel, shape), "near-full-arc-sweep");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves an exact circular profile", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.circularArcSweep!(
        circleProfile("circular-arc-profile", 1),
        quarterArc(),
        SWEEP_OPTIONS,
        { feature: "circular-arc-profile-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo((5 * Math.PI ** 2) / 2, 8);
        expect(measured.surfaceArea).toBeCloseTo(
          5 * Math.PI ** 2 + 2 * Math.PI,
          8,
        );
        expectVectorClose(measured.boundingBox.min, [-1, -1, 0]);
        expectVectorClose(measured.boundingBox.max, [5, 1, 6]);
        const snapshot = topology(kernel, shape);
        expectClosedSolidTopology(snapshot, 3, 3, false);
        expectBroadSweepCreation(snapshot, "circular-arc-profile-sweep");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("accepts an initial tangent opposite the profile-plane normal", async () => {
    const kernel = await createOcctKernel();
    try {
      const path = quarterArc(-1);
      expectVectorClose(resolvedCircularArcGeometry(path)!.startTangent, [
        0, 0, -1,
      ]);
      const shape = kernel.circularArcSweep!(
        rectangleProfile("negative-normal-arc-profile", 2, 4),
        path,
        SWEEP_OPTIONS,
        { feature: "negative-normal-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(20 * Math.PI, 8);
        expectVectorClose(measured.boundingBox.min, [-1, -2, -6]);
        expectVectorClose(measured.boundingBox.max, [5, 2, 0]);
        expectClosedSolidTopology(topology(kernel, shape), 6, 12);
        expectBroadSweepCreation(
          topology(kernel, shape),
          "negative-normal-arc-sweep",
        );
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("releases arc-specific allocations when native construction throws", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as Record<
      string,
      (...args: any[]) => any
    >;
    const allocated: unknown[] = [];
    const released: unknown[] = [];
    const methodNames = [
      "makeLineEdge",
      "makeWire",
      "makeFace",
    ] as const;
    const originals = new Map<string, (...args: any[]) => any>();
    const originalRelease = raw.release!.bind(raw);
    const originalRevolve = raw.revolve!.bind(raw);
    try {
      try {
        for (const name of methodNames) {
          const original = raw[name]!.bind(raw);
          originals.set(name, original);
          raw[name] = (...args: any[]) => {
            const handle = original(...args);
            allocated.push(handle);
            return handle;
          };
        }
        raw.release = (handle: unknown) => {
          released.push(handle);
          return originalRelease(handle);
        };
        raw.revolve = () => {
          throw new Error("injected native circular-arc sweep failure");
        };

        expect(() =>
          kernel.circularArcSweep!(
            rectangleProfile("injected-failure-profile", 2, 4),
            quarterArc(),
            SWEEP_OPTIONS,
            { feature: "injected-failure-sweep", tolerance: 1e-7 },
          ),
        ).toThrow("injected native circular-arc sweep failure");
        expect(allocated).toHaveLength(6);
        for (const handle of allocated) expect(released).toContain(handle);
      } finally {
        for (const [name, original] of originals) raw[name] = original;
        raw.release = originalRelease;
        raw.revolve = originalRevolve;
      }

      const recovered = kernel.circularArcSweep!(
        rectangleProfile("post-injected-failure-profile", 2, 4),
        quarterArc(),
        SWEEP_OPTIONS,
        { feature: "post-injected-failure-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(recovered).volume).toBeCloseTo(20 * Math.PI, 8);
      } finally {
        kernel.disposeShape(recovered);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("rejects insufficient curvature clearance repeatedly and recovers", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(() =>
        kernel.circularArcSweep!(
          circleProfile("invalid-tolerance-profile", 1),
          quarterArc(),
          SWEEP_OPTIONS,
          { feature: "invalid-tolerance-sweep", tolerance: 0 },
        ),
      ).toThrow("Path tolerance must be finite and positive");

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(() =>
          kernel.circularArcSweep!(
            circleProfile(`oversized-arc-profile-${attempt}`, 5),
            quarterArc(),
            SWEEP_OPTIONS,
            {
              feature: `failed-circular-arc-sweep-${attempt}`,
              tolerance: 1e-7,
            },
          ),
        ).toThrow(
          "Circular-arc sweep radius must exceed the profile envelope radius",
        );
      }

      expect(() =>
        kernel.circularArcSweep!(
          circleProfile("shallow-arc-profile", 0.001),
          arcPath(
            [0, 0, 0],
            [0.9999999999999999, 9.999999999999999e-10, 0],
            [1.9999999999999998, 3.9999999999999994e-9, 0],
          ),
          SWEEP_OPTIONS,
          { feature: "shallow-arc-sweep", tolerance: 1e-12 },
        ),
      ).toThrow("must define a stable plane");

      expect(() =>
        kernel.circularArcSweep!(
          circleProfile("occt-angular-resolution-profile", 0.001),
          arcPath(
            [0, 0, 0],
            [1.1e-7, 0, 46.90415759823429],
            [4.4e-7, 0, 93.80831519646858],
          ),
          SWEEP_OPTIONS,
          { feature: "occt-angular-resolution-sweep", tolerance: 1e-7 },
        ),
      ).toThrow("OCCT three-point angular resolution");

      expect(() =>
        kernel.circularArcSweep!(
          {
            ...circleProfile("near-full-occt-resolution-profile", 0.001),
            plane: { plane: "YZ", origin: [0, 0, 0] },
          },
          arcPath(
            [0, 0, 0],
            [0.012246467991473532, 200000000000000, 0],
            [-0.024492935982947064, 2.999519565323715e-18, 0],
          ),
          SWEEP_OPTIONS,
          { feature: "near-full-occt-resolution-sweep", tolerance: 1e-7 },
        ),
      ).toThrow("OCCT three-point angular resolution");

      const smallRadius = 1e-4;
      const tiny = kernel.circularArcSweep!(
        rectangleProfile("tiny-revolved-profile", 2e-5, 2e-5),
        arcPath(
          [0, 0, 0],
          [
            smallRadius - smallRadius / Math.sqrt(2),
            0,
            smallRadius / Math.sqrt(2),
          ],
          [smallRadius, 0, smallRadius],
        ),
        SWEEP_OPTIONS,
        { feature: "tiny-revolved-sweep", tolerance: 1e-12 },
      );
      try {
        expect(kernel.status(tiny)).toEqual({ ok: true, code: "VALID" });
        const expectedVolume =
          2e-5 * 2e-5 * ((smallRadius * Math.PI) / 2);
        expect(kernel.measure(tiny).volume / expectedVolume).toBeCloseTo(1, 6);
        expectClosedSolidTopology(topology(kernel, tiny), 6, 12);
      } finally {
        kernel.disposeShape(tiny);
      }

      const microSweep = 0.1;
      const microPoint = (angle: number): Vec3 => [
        smallRadius - smallRadius * Math.cos(angle),
        0,
        smallRadius * Math.sin(angle),
      ];
      const micro = kernel.circularArcSweep!(
        rectangleProfile("micro-volume-profile", 1e-6, 1e-6),
        arcPath(
          microPoint(0),
          microPoint(microSweep / 2),
          microPoint(microSweep),
        ),
        SWEEP_OPTIONS,
        { feature: "micro-volume-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(micro)).toEqual({ ok: true, code: "VALID" });
        const expectedVolume = 1e-6 * 1e-6 * smallRadius * microSweep;
        expect(kernel.measure(micro).volume / expectedVolume).toBeCloseTo(1, 12);
        expectClosedSolidTopology(topology(kernel, micro), 6, 12);
      } finally {
        kernel.disposeShape(micro);
      }

      const box = kernel.box!([2, 3, 4], false, {
        feature: "after-circular-arc-failure",
      });
      const recovered = kernel.circularArcSweep!(
        rectangleProfile("recovered-arc-profile", 2, 4),
        quarterArc(),
        SWEEP_OPTIONS,
        { feature: "recovered-circular-arc-sweep", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(box)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(box).volume).toBeCloseTo(24, 8);
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(recovered).volume).toBeCloseTo(20 * Math.PI, 8);
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
