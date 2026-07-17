import { describe, expect, it } from "vitest";
import type { Vec2, Vec3 } from "../src/core/math.js";
import {
  resolvedLoopAreaMoments,
  resolvedLoopSignedArea,
  resolvedProfileAreaMoments,
  resolvedProfileLocalAreaMoments,
  type ResolvedLoopAreaMomentsSuccess,
  type ResolvedProfileAreaMomentsSuccess,
} from "../src/protocol/profile-moments.js";
import {
  numericPlaneBasis,
  pointOnNumericPlane,
  resolvedArcSweep,
  resolvedCurveIsFinite,
  type NumericPlane,
  type ResolvedLoop,
  type ResolvedProfile,
} from "../src/protocol/profile.js";
import { validateRuledSolidLoftProfiles } from "../src/protocol/loft.js";
import { validateResolvedSweep } from "../src/protocol/sweep.js";

const TOLERANCE = 1e-9;

function expectLoop(
  loop: ResolvedLoop,
  tolerance = TOLERANCE,
  reference?: Vec2,
): ResolvedLoopAreaMomentsSuccess {
  const result = resolvedLoopAreaMoments(loop, tolerance, reference);
  expect(result).toEqual(expect.objectContaining({ ok: true }));
  if (!result.ok) throw new Error(result.message);
  return result;
}

function expectProfile(
  profile: ResolvedProfile,
  tolerance = TOLERANCE,
): ResolvedProfileAreaMomentsSuccess {
  const result = resolvedProfileAreaMoments(profile, tolerance);
  expect(result).toEqual(expect.objectContaining({ ok: true }));
  if (!result.ok) throw new Error(result.message);
  return result;
}

function expectVec2(actual: Vec2, expected: Vec2, digits = 12): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
}

function expectVec3(actual: Vec3, expected: Vec3, digits = 12): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

function rectangle(
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  reversed = false,
): ResolvedLoop {
  const ccw = [
    [xMin, yMin],
    [xMax, yMin],
    [xMax, yMax],
    [xMin, yMax],
  ] as const;
  const points = reversed
    ? [ccw[0], ccw[3], ccw[2], ccw[1]]
    : [...ccw];
  return {
    curves: points.map((start, index) => ({
      kind: "line" as const,
      start,
      end: points[(index + 1) % points.length]!,
    })),
  };
}

function circle(
  center: Vec2,
  radius: number,
  reversed = false,
): ResolvedLoop {
  return {
    curves: [{ kind: "circle", center, radius, reversed }],
  };
}

describe("canonical resolved profile geometry helpers", () => {
  it("resolves signed minor and major arc traversal", () => {
    expect(
      resolvedArcSweep({
        kind: "arc",
        center: [0, 0],
        radius: 1,
        startAngle: 0,
        endAngle: Math.PI / 2,
        clockwise: false,
      }),
    ).toBeCloseTo(Math.PI / 2, 15);
    expect(
      resolvedArcSweep({
        kind: "arc",
        center: [0, 0],
        radius: 1,
        startAngle: 0,
        endAngle: Math.PI / 2,
        clockwise: true,
      }),
    ).toBeCloseTo((-3 * Math.PI) / 2, 15);
  });

  it("shares finite-curve and right-handed principal-plane conventions", () => {
    expect(
      resolvedCurveIsFinite(
        { kind: "line", start: [0, 0], end: [2, 0] },
        TOLERANCE,
      ),
    ).toBe(true);
    expect(
      resolvedCurveIsFinite(
        { kind: "line", start: [0, 0], end: [TOLERANCE / 2, 0] },
        TOLERANCE,
      ),
    ).toBe(false);
    expect(numericPlaneBasis({ plane: "XZ", origin: [0, 0, 0] })).toEqual({
      u: [1, 0, 0],
      v: [0, 0, 1],
      n: [0, -1, 0],
    });
    expect(
      pointOnNumericPlane([2, 3], { plane: "YZ", origin: [5, 7, 11] }),
    ).toEqual([5, 9, 14]);
  });
});

describe("resolvedLoopAreaMoments", () => {
  it("certifies signed area independently of centroid precision", () => {
    const loop = rectangle(0, 0, 1, 1);
    const tolerance = 1e-14;
    expect(resolvedLoopAreaMoments(loop, tolerance)).toEqual(
      expect.objectContaining({ ok: false, reason: "ill-conditioned" }),
    );
    const signedArea = resolvedLoopSignedArea(loop, tolerance);
    expect(signedArea).toEqual(
      expect.objectContaining({
        ok: true,
        signedArea: 1,
        orientation: "counterclockwise",
      }),
    );
    if (!signedArea.ok) throw new Error(signedArea.message);
    expect(signedArea.diagnostics).not.toHaveProperty(
      "naiveSignedFirstMoment",
    );

    const profileAt = (z: number): ResolvedProfile => ({
      plane: { plane: "XY", origin: [0, 0, z] },
      outer: loop,
      holes: [],
    });
    expect(
      validateRuledSolidLoftProfiles(
        [profileAt(0), profileAt(1)],
        tolerance,
      ),
    ).toBeUndefined();
    expect(
      validateResolvedSweep(
        profileAt(0),
        {
          kind: "polyline",
          points: [
            [0, 0, 0],
            [0, 0, 2],
          ],
          closed: false,
        },
        tolerance,
      ),
    ).toBeUndefined();
  });

  it("preserves signed traversal while keeping a rectangle centroid invariant", () => {
    const forward = expectLoop(rectangle(8, -4, 12, -2));
    const reversed = expectLoop(rectangle(8, -4, 12, -2, true));

    expect(forward.signedArea).toBeCloseTo(8, 14);
    expect(forward.orientation).toBe("counterclockwise");
    expectVec2(forward.centroid, [10, -3]);
    expect(reversed.signedArea).toBeCloseTo(-8, 14);
    expect(reversed.orientation).toBe("clockwise");
    expectVec2(reversed.centroid, forward.centroid);
    expectVec2(reversed.signedFirstMoment, [
      -forward.signedFirstMoment[0],
      -forward.signedFirstMoment[1],
    ]);
  });

  it("evaluates eccentric forward and reversed full circles exactly", () => {
    const forward = expectLoop(circle([3, -4], 2));
    const reversed = expectLoop(circle([3, -4], 2, true));

    expect(forward.signedArea).toBeCloseTo(4 * Math.PI, 14);
    expect(reversed.signedArea).toBeCloseTo(-4 * Math.PI, 14);
    expectVec2(forward.centroid, [3, -4]);
    expectVec2(reversed.centroid, [3, -4]);
  });

  it("evaluates a semicircular line/arc profile without tessellation", () => {
    const radius = 3;
    const result = expectLoop({
      curves: [
        {
          kind: "arc",
          center: [0, 0],
          radius,
          startAngle: 0,
          endAngle: Math.PI,
          clockwise: false,
        },
        { kind: "line", start: [-radius, 0], end: [radius, 0] },
      ],
    });

    expect(result.signedArea).toBeCloseTo((Math.PI * radius ** 2) / 2, 13);
    expectVec2(result.centroid, [0, (4 * radius) / (3 * Math.PI)], 11);
    expect(result.diagnostics.maxClosureGap).toBeLessThanOrEqual(TOLERANCE);
    expect(result.diagnostics.connectorCount).toBe(1);
  });

  it("retains the clockwise major-arc branch and its signed centroid", () => {
    const radius = 2;
    const result = expectLoop({
      curves: [
        {
          kind: "arc",
          center: [0, 0],
          radius,
          startAngle: 0,
          endAngle: Math.PI / 2,
          clockwise: true,
        },
        { kind: "line", start: [0, radius], end: [radius, 0] },
      ],
    });
    const absoluteArea =
      (radius ** 2 * ((3 * Math.PI) / 2 + 1)) / 2;
    const centroidCoordinate = -(radius ** 3 / 6) / absoluteArea;

    expect(result.signedArea).toBeCloseTo(-absoluteArea, 13);
    expect(result.orientation).toBe("clockwise");
    expectVec2(
      result.centroid,
      [centroidCoordinate, centroidCoordinate],
      11,
    );
  });

  it("uses a cancellation-safe small-sweep circular-segment formula", () => {
    const radius = 10;
    const sweep = 1e-4;
    const square = sweep ** 2;
    const deltaMinusSine =
      sweep *
      square *
      (1 / 6 + square * (-1 / 120 + square / 5040));
    const area = (radius ** 2 * deltaMinusSine) / 2;
    const centralScale =
      (2 / 3) * radius ** 3 * Math.sin(sweep / 2) ** 3;
    const expectedCentroid: Vec2 = [
      (centralScale * Math.cos(sweep / 2)) / area,
      (centralScale * Math.sin(sweep / 2)) / area,
    ];
    const end: Vec2 = [radius * Math.cos(sweep), radius * Math.sin(sweep)];
    const result = expectLoop(
      {
        curves: [
          {
            kind: "arc",
            center: [0, 0],
            radius,
            startAngle: 0,
            endAngle: sweep,
            clockwise: false,
          },
          { kind: "line", start: end, end: [radius, 0] },
        ],
      },
      1e-10,
    );

    expect(result.signedArea).toBeCloseTo(area, 20);
    expectVec2(result.centroid, expectedCentroid, 8);
  });

  it("keeps the small-sweep series across its former cancellation boundary", () => {
    const sweep = 0.001001;
    const square = sweep ** 2;
    const deltaMinusSine =
      sweep *
      square *
      (1 / 6 +
        square *
          (-1 / 120 +
            square *
              (1 / 5040 +
                square * (-1 / 362880 + square / 39916800))));
    const end: Vec2 = [Math.cos(sweep), Math.sin(sweep)];
    const result = expectLoop(
      {
        curves: [
          {
            kind: "arc",
            center: [0, 0],
            radius: 1,
            startAngle: 0,
            endAngle: sweep,
            clockwise: false,
          },
          { kind: "line", start: end, end: [1, 0] },
        ],
      },
      1e-7,
    );
    expect(result.signedArea).toBeCloseTo(deltaMinusSine / 2, 24);
    expect(result.diagnostics.relativeAreaRoundoffBound).toBeLessThan(1e-10);
  });

  it("closes admitted endpoint gaps with explicit line connectors", () => {
    const gap = 5e-8;
    const loop: ResolvedLoop = {
      curves: [
        { kind: "line", start: [0, 0], end: [2, 0] },
        { kind: "line", start: [2 + gap, gap], end: [2 + gap, 1] },
        { kind: "line", start: [2 + gap, 1], end: [0, 1] },
        { kind: "line", start: [0, 1], end: [0, 0] },
      ],
    };
    const result = expectLoop(loop, 1e-7);
    const explicitlyClosed = expectLoop(
      {
        curves: [
          { kind: "line", start: [0, 0], end: [2, 0] },
          { kind: "line", start: [2, 0], end: [2 + gap, gap] },
          { kind: "line", start: [2 + gap, gap], end: [2 + gap, 1] },
          { kind: "line", start: [2 + gap, 1], end: [0, 1] },
          { kind: "line", start: [0, 1], end: [0, 0] },
        ],
      },
      1e-10,
    );
    expect(result.signedArea).toBeCloseTo(explicitlyClosed.signedArea, 15);
    expectVec2(result.centroid, explicitlyClosed.centroid, 14);
    expect(result.diagnostics.connectorCount).toBe(1);
    expect(result.diagnostics.maxClosureGap).toBeCloseTo(
      Math.SQRT2 * gap,
      15,
    );

    expect(resolvedLoopAreaMoments(loop, gap / 2)).toEqual(
      expect.objectContaining({
        ok: false,
        reason: "open-loop",
        curveIndex: 0,
      }),
    );
  });

  it("remains stable for a small profile at a large coordinate offset", () => {
    const result = expectLoop(
      rectangle(1e9, -1e9, 1e9 + 4, -1e9 + 2),
    );
    expect(result.signedArea).toBeCloseTo(8, 14);
    expectVec2(result.centroid, [1e9 + 2, -1e9 + 1], 6);
  });

  it("returns structured failures for malformed and unreliable loops", () => {
    expect(resolvedLoopAreaMoments({ curves: [] }, TOLERANCE)).toEqual(
      expect.objectContaining({ ok: false, reason: "empty-loop" }),
    );
    expect(
      resolvedLoopAreaMoments(circle([0, 0], 1), Number.NaN),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: "invalid-tolerance" }),
    );
    expect(
      resolvedLoopAreaMoments(circle([0, 0], 1), TOLERANCE, [0, Infinity]),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: "invalid-reference" }),
    );
    expect(
      resolvedLoopAreaMoments(
        {
          curves: [
            { kind: "circle", center: [0, 0], radius: 1, reversed: false },
            { kind: "line", start: [1, 0], end: [2, 0] },
          ],
        },
        TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        reason: "circle-must-be-sole-curve",
        curveIndex: 0,
      }),
    );
    expect(
      resolvedLoopAreaMoments(
        {
          curves: [
            { kind: "line", start: [0, 0], end: [1, 0] },
            { kind: "line", start: [1, 0], end: [0, 0] },
          ],
        },
        TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: "degenerate-area" }),
    );

    const cancellationTriangle: ResolvedLoop = {
      curves: [
        { kind: "line", start: [0, 0], end: [1e12, 1e12] },
        {
          kind: "line",
          start: [1e12, 1e12],
          end: [1e12, 1e12 + 0.2],
        },
        { kind: "line", start: [1e12, 1e12 + 0.2], end: [0, 0] },
      ],
    };
    expect(resolvedLoopAreaMoments(cancellationTriangle, 0.1)).toEqual(
      expect.objectContaining({ ok: false, reason: "ill-conditioned" }),
    );

    expect(
      resolvedLoopAreaMoments(
        rectangle(1e16, 0, 1e16 + 6, 2),
        TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: "ill-conditioned" }),
    );
  });
});

describe("resolvedProfileAreaMoments", () => {
  it("separates local centroid certification from world lifting", () => {
    const profile: ResolvedProfile = {
      plane: { plane: "XY", origin: [1e12, 0, 0] },
      outer: rectangle(-0.4, -0.5, 0.6, 0.5),
      holes: [],
    };
    const local = resolvedProfileLocalAreaMoments(profile, 1e-7);
    expect(local).toEqual(expect.objectContaining({ ok: true, area: 1 }));
    if (!local.ok) throw new Error(local.message);
    expectVec2(local.localCentroid, [0.1, 0]);
    expect(local.diagnostics.centroidRoundoffBound).toBeLessThan(1e-7);
    expect(local.diagnostics).not.toHaveProperty(
      "worldCentroidRoundoffBound",
    );

    expect(resolvedProfileAreaMoments(profile, 1e-7)).toEqual(
      expect.objectContaining({ ok: false, reason: "ill-conditioned" }),
    );
  });

  it("subtracts off-center holes semantically regardless of orientation", () => {
    const expectedArea = 24 * Math.PI;
    const expectedCentroid: Vec2 = [-1 / 12, 0];
    const profile = (holeReversed: boolean): ResolvedProfile => ({
      plane: { plane: "XY", origin: [0, 0, 7] },
      outer: circle([0, 0], 5),
      holes: [circle([2, 0], 1, holeReversed)],
    });

    const forwardHole = expectProfile(profile(false));
    const reversedHole = expectProfile(profile(true));
    for (const result of [forwardHole, reversedHole]) {
      expect(result.area).toBeCloseTo(expectedArea, 13);
      expectVec2(result.localCentroid, expectedCentroid);
      expectVec3(result.centroid, [-1 / 12, 0, 7]);
      expect(result.normal).toEqual([0, 0, 1]);
    }
  });

  it("normalizes a reversed outer loop without moving its centroid", () => {
    const profile: ResolvedProfile = {
      plane: { plane: "XY", origin: [1, 2, 3] },
      outer: rectangle(-2, -1, 2, 1, true),
      holes: [],
    };
    const result = expectProfile(profile);
    expect(result.area).toBeCloseTo(8, 14);
    expect(result.outer.orientation).toBe("clockwise");
    expectVec2(result.localCentroid, [0, 0]);
    expectVec3(result.centroid, [1, 2, 3]);
  });

  it("lifts one local centroid through every NumericPlane basis", () => {
    const expectations: readonly [NumericPlane, Vec3, Vec3][] = [
      [
        { plane: "XY", origin: [5, 7, 11] },
        [7, 10, 11],
        [0, 0, 1],
      ],
      [
        { plane: "XZ", origin: [5, 7, 11] },
        [7, 7, 14],
        [0, -1, 0],
      ],
      [
        { plane: "YZ", origin: [5, 7, 11] },
        [5, 9, 14],
        [1, 0, 0],
      ],
    ];
    for (const [plane, centroid, normal] of expectations) {
      const result = expectProfile({
        plane,
        outer: rectangle(1, 2, 3, 4),
        holes: [],
      });
      expectVec2(result.localCentroid, [2, 3]);
      expectVec3(result.centroid, centroid);
      expect(result.normal).toEqual(normal);
    }
  });

  it("fails on invalid planes, non-positive material, and cancellation", () => {
    expect(
      resolvedProfileAreaMoments(
        {
          plane: { plane: "XY", origin: [0, Number.NaN, 0] },
          outer: circle([0, 0], 2),
          holes: [],
        },
        TOLERANCE,
      ),
    ).toEqual(expect.objectContaining({ ok: false, reason: "invalid-plane" }));

    expect(
      resolvedProfileAreaMoments(
        {
          plane: { plane: "XY", origin: [0, 0, 0] },
          outer: circle([0, 0], 1),
          holes: [circle([0, 0], 2)],
        },
        1e-12,
      ),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        reason: "non-positive-profile-area",
      }),
    );

    expect(
      resolvedProfileAreaMoments(
        {
          plane: { plane: "XY", origin: [0, 0, 0] },
          outer: circle([0, 0], 1),
          holes: [circle([0, 0], 1 - 1e-8)],
        },
        1e-12,
      ),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: "ill-conditioned" }),
    );

    expect(
      resolvedProfileAreaMoments(
        {
          plane: { plane: "XY", origin: [1e16, 0, 0] },
          outer: rectangle(2, 0, 4, 2),
          holes: [],
        },
        TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({ ok: false, reason: "ill-conditioned" }),
    );
  });

  it("locates failures in an individual hole", () => {
    const result = resolvedProfileAreaMoments(
      {
        plane: { plane: "XY", origin: [0, 0, 0] },
        outer: circle([0, 0], 5),
        holes: [
          {
            curves: [
              { kind: "line", start: [0, 0], end: [1, 0] },
              { kind: "line", start: [1, 0], end: [0, 0] },
            ],
          },
        ],
      },
      TOLERANCE,
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        reason: "degenerate-area",
        loop: "hole",
        holeIndex: 0,
      }),
    );
  });
});
