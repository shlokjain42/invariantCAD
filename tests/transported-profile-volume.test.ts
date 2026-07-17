import { describe, expect, it } from "vitest";
import type { Vec3 } from "../src/core/math.js";
import {
  resolvedCompositeSweepVolumeOracle,
  type TransportedProfileVolumeResult,
  type TransportedProfileVolumeSuccess,
} from "../src/internal/transported-profile-volume.js";
import {
  resolvedCircularArcGeometry,
  resolvedCompositePathSegments,
  type ResolvedCompositePath,
} from "../src/protocol/path.js";

function expectSuccess(
  result: TransportedProfileVolumeResult,
): asserts result is TransportedProfileVolumeSuccess {
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.message);
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
  const secondCenter = add(junction, scale(secondStartRadius, -1));
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

function lineThenQuarterArc(): ResolvedCompositePath {
  return {
    kind: "composite",
    start: [0, 0, -1],
    segments: [
      { kind: "line", end: [0, 0, 0] },
      {
        kind: "circularArc",
        through: [1 - 1 / Math.sqrt(2), 0, 1 / Math.sqrt(2)],
        end: [1, 0, 1],
      },
    ],
    closed: false,
  };
}

function fractionalCircumcenterPath(): ResolvedCompositePath {
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      {
        kind: "circularArc",
        through: [1, 0, 3],
        end: [5, 0, 0],
      },
      { kind: "line", end: [4, 0, -3] },
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
        ? { kind: "line", end: add(segment.end, translation) }
        : {
            kind: "circularArc",
            through: add(segment.through, translation),
            end: add(segment.end, translation),
          },
    ),
  };
}

describe("resolvedCompositeSweepVolumeOracle", () => {
  it("reduces a centered line-arc-line sweep to area times path length", () => {
    const area = 2;
    const expectedLength = 10 + (5 * Math.PI) / 2;
    for (const normal of [
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      const result = resolvedCompositeSweepVolumeOracle(
        { area, centroidOffsetFromPathStart: [0, 0, 0], normal },
        planarCompositePath(),
        1e-7,
      );

      expectSuccess(result);
      expect(result.volume).toBeCloseTo(area * expectedLength, 12);
      expect(result.diagnostics.terms.map((term) => term.kind)).toEqual([
        "line",
        "circularArc",
        "line",
      ]);
      expect(result.diagnostics.cancellationRatio).toBeCloseTo(1, 14);
      expect(result.diagnostics.conditionNumber).toBeCloseTo(1, 14);
    }
  });

  it("tracks an eccentric centroid through a spatial tangent arc chain", () => {
    const area = 0.32;
    const result = resolvedCompositeSweepVolumeOracle(
      {
        area,
        centroidOffsetFromPathStart: [0, 0.1, 0.1],
        normal: [1, 0, 0],
      },
      spatialTangentArcChain(),
      1e-7,
    );

    expectSuccess(result);
    const expected =
      area * (Math.PI / 3) * (19.9 - Math.SQRT2 / 10);
    expect(result.volume).toBeCloseTo(expected, 13);
    expect(result.diagnostics.terms).toHaveLength(2);
    expect(result.diagnostics.terms.every((term) =>
      term.kind === "circularArc",
    )).toBe(true);
  });

  it("preserves fractional-center arc geometry and volume diagnostics under a 1e12 translation", () => {
    const path = fractionalCircumcenterPath();
    const translatedPath = translateCompositePath(path, [1e12, -1e12, 1e12]);
    const arc = resolvedCompositePathSegments(path)[0]!;
    const translatedArc = resolvedCompositePathSegments(translatedPath)[0]!;
    if (arc.kind !== "circularArc" || translatedArc.kind !== "circularArc") {
      throw new Error("Expected the fractional-circumcenter arc fixture");
    }
    const { center: _center, ...relativeGeometry } =
      resolvedCircularArcGeometry(arc)!;
    const { center: _translatedCenter, ...translatedRelativeGeometry } =
      resolvedCircularArcGeometry(translatedArc)!;
    expect(relativeGeometry.centerOffsetFromStart).toEqual([2.5, 0, 5 / 6]);
    expect(translatedRelativeGeometry).toEqual(relativeGeometry);

    const profile = {
      area: 0.32,
      centroidOffsetFromPathStart: [0, 0, 0] as Vec3,
      normal: [-1 / Math.sqrt(10), 0, 3 / Math.sqrt(10)] as Vec3,
    };

    const local = resolvedCompositeSweepVolumeOracle(profile, path, 1e-7);
    const translated = resolvedCompositeSweepVolumeOracle(
      profile,
      translatedPath,
      1e-7,
    );

    expectSuccess(local);
    expectSuccess(translated);
    expect(translated).toEqual(local);
  });

  it("includes the exact eccentric RightCorner miter correction", () => {
    const area = 0.32;
    const basePath = planarCompositePath();
    const path: ResolvedCompositePath = {
      ...basePath,
      segments: [
        ...basePath.segments,
        { kind: "line", end: [10, 5, 10] },
      ],
    };
    const result = resolvedCompositeSweepVolumeOracle(
      {
        area,
        centroidOffsetFromPathStart: [0.1, 0.1, 0],
        normal: [0, 0, 1],
      },
      path,
      1e-7,
    );

    expectSuccess(result);
    const expected = area * (15 + (Math.PI / 2) * 4.9 - 0.2);
    expect(result.volume).toBeCloseTo(expected, 13);
    const corner = result.diagnostics.terms.find(
      (term) => term.kind === "rightCorner",
    );
    expect(corner).toMatchObject({
      kind: "rightCorner",
      priorSegmentIndex: 2,
      segmentIndex: 3,
      turn: Math.PI / 2,
      tangentHalfTurn: 1,
    });
    expect(corner?.centroidInwardOffset).toBeCloseTo(0.1, 14);
    expect(corner?.value).toBeCloseTo(-2 * area * 0.1, 14);
  });

  it("fails closed at a non-G1 arc-bearing junction", () => {
    const path: ResolvedCompositePath = {
      kind: "composite",
      start: [0, 0, 0],
      segments: [
        { kind: "line", end: [0, 0, 1] },
        {
          kind: "circularArc",
          through: [1, 1, 1],
          end: [2, 0, 1],
        },
      ],
      closed: false,
    };

    const result = resolvedCompositeSweepVolumeOracle(
      {
        area: 1,
        centroidOffsetFromPathStart: [0, 0, 0],
        normal: [0, 0, 1],
      },
      path,
      1e-7,
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported-junction",
      segmentIndex: 1,
      otherSegmentIndex: 0,
    });
  });

  it("fails closed for a numerically unstable near-reversal RightCorner", () => {
    const basePath = planarCompositePath();
    const path: ResolvedCompositePath = {
      ...basePath,
      segments: [
        ...basePath.segments,
        { kind: "line", end: [5, 1e-9, 10] },
      ],
    };

    const result = resolvedCompositeSweepVolumeOracle(
      {
        area: 1,
        centroidOffsetFromPathStart: [0, 0, 0],
        normal: [0, 0, 1],
      },
      path,
      1e-7,
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported-right-corner",
      segmentIndex: 3,
      otherSegmentIndex: 2,
    });
  });

  it("exposes moderate cancellation while retaining a supported result", () => {
    const result = resolvedCompositeSweepVolumeOracle(
      {
        area: 1,
        centroidOffsetFromPathStart: [1 + 1 / Math.PI, 0, 0],
        normal: [0, 0, 1],
      },
      lineThenQuarterArc(),
      1e-7,
    );

    expectSuccess(result);
    expect(result.volume).toBeCloseTo(0.5, 14);
    expect(result.diagnostics.absoluteTermSum).toBeCloseTo(1.5, 14);
    expect(result.diagnostics.cancellationRatio).toBeCloseTo(1 / 3, 14);
    expect(result.diagnostics.conditionNumber).toBeCloseTo(3, 13);
  });

  it("returns diagnostics instead of a scalar when contributions cancel", () => {
    const result = resolvedCompositeSweepVolumeOracle(
      {
        area: 1,
        centroidOffsetFromPathStart: [1 + 2 / Math.PI, 0, 0],
        normal: [0, 0, 1],
      },
      lineThenQuarterArc(),
      1e-7,
    );

    expect(result).toMatchObject({ ok: false, reason: "ill-conditioned" });
    if (result.ok || result.diagnostics === undefined) {
      throw new Error("Expected cancellation diagnostics");
    }
    expect(result.diagnostics.terms).toHaveLength(2);
    expect(result.diagnostics.absoluteTermSum).toBeCloseTo(2, 13);
    expect(result.diagnostics.cancellationRatio).toBeLessThan(1e-12);
    expect(result.diagnostics.conditionNumber).toBeGreaterThan(1e12);
    expect(result.diagnostics.relativeRoundoffBound).toBeGreaterThan(1e-10);
  });

  it("accepts the same small profile mismatch admitted by sweep validation", () => {
    const angle = 5e-8;
    const profile = {
      area: 1,
      centroidOffsetFromPathStart: [0, 0, 0] as Vec3,
      normal: [Math.sin(angle), 0, Math.cos(angle)] as Vec3,
    };

    const admitted = resolvedCompositeSweepVolumeOracle(
      profile,
      planarCompositePath(),
      1e-6,
    );
    expectSuccess(admitted);

    expect(
      resolvedCompositeSweepVolumeOracle(
        profile,
        planarCompositePath(),
        1e-8,
      ),
    ).toMatchObject({
      ok: false,
      reason: "unsupported-profile-alignment",
      segmentIndex: 0,
    });
  });

  it("rejects a profile plane that is not seated normal to the path", () => {
    const result = resolvedCompositeSweepVolumeOracle(
      {
        area: 1,
        centroidOffsetFromPathStart: [0, 0, 0],
        normal: [1, 0, 0],
      },
      planarCompositePath(),
      1e-7,
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "unsupported-profile-alignment",
      segmentIndex: 0,
    });
  });

  it("rejects a non-finite centroid offset", () => {
    expect(
      resolvedCompositeSweepVolumeOracle(
        {
          area: 1,
          centroidOffsetFromPathStart: [Number.NaN, 0, 0],
          normal: [0, 0, 1],
        },
        planarCompositePath(),
        1e-7,
      ),
    ).toMatchObject({ ok: false, reason: "invalid-profile" });
  });
});
