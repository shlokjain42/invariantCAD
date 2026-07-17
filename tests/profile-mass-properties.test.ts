import { describe, expect, it } from "vitest";
import {
  NATIVE_PROFILE_COORDINATE_ULP_FACTOR,
  certifyNativeProfileMassProperties,
  type AnalyticProfileMassProperties,
} from "../src/internal/profile-mass-properties.js";

const ANALYTIC: AnalyticProfileMassProperties = {
  area: 6,
  areaRoundoffBound: 2e-14,
  perimeter: 12,
  maxBoundaryRadius: 3,
  plane: "XY",
  centroidOffset: [0.25, -0.5, 0],
  centroidRoundoffBound: 3e-14,
};

describe("native profile mass-property certification", () => {
  it("retains analytic properties as the source of truth after agreement", () => {
    const result = certifyNativeProfileMassProperties(
      ANALYTIC,
      {
        area: ANALYTIC.area + 1e-10,
        centroid: [10.25 + 1e-8, 19.5 - 1e-8, 30],
      },
      [10, 20, 30],
      { modelingTolerance: 1e-7, requireCentroid: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.properties).toBe(ANALYTIC);
    expect(result.diagnostics.nativeArea).not.toBe(ANALYTIC.area);
    expect(result.diagnostics.nativeCentroidOffset).not.toEqual(
      ANALYTIC.centroidOffset,
    );
  });

  it("supports an area-only independent check", () => {
    const result = certifyNativeProfileMassProperties(
      {
        area: 6,
        areaRoundoffBound: 1e-14,
        perimeter: 12,
        maxBoundaryRadius: 3,
        plane: "XY",
        centroidOffset: [0.25, -0.5, 0],
      },
      { area: 6 },
      [0, 0, 0],
      { modelingTolerance: 1e-7, requireCentroid: false },
    );

    expect(result).toMatchObject({
      ok: true,
      properties: { area: 6, areaRoundoffBound: 1e-14 },
    });
  });

  it("includes an eccentric profile's boundary position in area-only ULP bounds", () => {
    const result = certifyNativeProfileMassProperties(
      {
        area: 4,
        areaRoundoffBound: 0,
        perimeter: 8,
        maxBoundaryRadius: 2,
        plane: "XY",
        centroidOffset: [2 ** 31, 0, 0],
      },
      { area: 4 },
      [0, 0, 0],
      { modelingTolerance: 1e-7, requireCentroid: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.boundaryCoordinateRoundoffBound?.[0]).toBe(
      NATIVE_PROFILE_COORDINATE_ULP_FACTOR * 2 ** -21,
    );
    expect(result.diagnostics.boundaryDisplacementAllowance).toBeGreaterThan(
      1e-7,
    );
  });

  it("reports a structured area disagreement", () => {
    const result = certifyNativeProfileMassProperties(
      ANALYTIC,
      { area: 6.001, centroid: [0.25, -0.5, 0] },
      [0, 0, 0],
      { modelingTolerance: 1e-7, requireCentroid: true },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "area-mismatch",
      diagnostics: {
        analyticArea: 6,
        nativeArea: 6.001,
        areaError: expect.any(Number),
        areaAllowance: expect.any(Number),
      },
    });
  });

  it("classifies a gross finite native area as a mismatch, not indeterminate", () => {
    const result = certifyNativeProfileMassProperties(
      ANALYTIC,
      { area: 1e20, centroid: [0.25, -0.5, 0] },
      [0, 0, 0],
      { modelingTolerance: 1e-7, requireCentroid: true },
    );

    expect(result).toMatchObject({ ok: false, reason: "area-mismatch" });
  });

  it("admits representable native X-coordinate loss at a large translation", () => {
    const origin = 2 ** 31;
    const roundedWorldX = origin + ANALYTIC.centroidOffset![0];
    const result = certifyNativeProfileMassProperties(
      ANALYTIC,
      {
        area: ANALYTIC.area,
        centroid: [roundedWorldX, -0.5, 0],
      },
      [origin, 0, 0],
      { modelingTolerance: 1e-7, requireCentroid: true },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.coordinateRoundoffBound?.[0]).toBe(
      NATIVE_PROFILE_COORDINATE_ULP_FACTOR * 2 ** -21,
    );
  });

  it("does not let a large X translation mask a Y-coordinate disagreement", () => {
    const origin = 2 ** 31;
    const yzAnalytic: AnalyticProfileMassProperties = {
      ...ANALYTIC,
      plane: "YZ",
      centroidOffset: [0, 0.25, -0.5],
    };
    const result = certifyNativeProfileMassProperties(
      yzAnalytic,
      {
        area: yzAnalytic.area,
        centroid: [origin, 0.25 + 1e-5, -0.5],
      },
      [origin, 0, 0],
      { modelingTolerance: 1e-7, requireCentroid: true },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "centroid-mismatch",
      diagnostics: {
        analyticCentroidOffset: yzAnalytic.centroidOffset,
        nativeCentroidOffset: [0, 0.25 + 1e-5, -0.5],
        centroidError: [0, expect.any(Number), 0],
        centroidAllowance: expect.any(Array),
        coordinateRoundoffBound: expect.any(Array),
      },
    });
    if (result.ok || result.diagnostics === undefined) return;
    expect(result.diagnostics.centroidError![1]).toBeGreaterThan(
      result.diagnostics.centroidAllowance![1],
    );
    expect(result.diagnostics.centroidError![0]).toBeLessThanOrEqual(
      result.diagnostics.centroidAllowance![0],
    );
  });

  it.each([
    {
      plane: "XY" as const,
      offset: [0.25, -0.5, 0] as const,
      normal: 2 as const,
    },
    {
      plane: "XZ" as const,
      offset: [0.25, 0, -0.5] as const,
      normal: 1 as const,
    },
    {
      plane: "YZ" as const,
      offset: [0, 0.25, -0.5] as const,
      normal: 0 as const,
    },
  ])(
    "keeps the $plane normal-axis allowance independent of in-plane geometry",
    ({ plane, offset, normal }) => {
      const normalDrift = 1.2e-6;
      const nativeCentroid = [...offset] as [number, number, number];
      nativeCentroid[normal] += normalDrift;
      const result = certifyNativeProfileMassProperties(
        { ...ANALYTIC, plane, centroidOffset: offset },
        { area: ANALYTIC.area, centroid: nativeCentroid },
        [0, 0, 0],
        { modelingTolerance: 1e-7, requireCentroid: true },
      );

      expect(result).toMatchObject({
        ok: false,
        reason: "centroid-mismatch",
      });
      if (result.ok || result.diagnostics === undefined) return;
      expect(result.diagnostics.centroidError![normal]).toBeGreaterThan(
        result.diagnostics.centroidAllowance![normal],
      );
      const inPlaneAllowances = result.diagnostics.centroidAllowance!.filter(
        (_, axis) => axis !== normal,
      );
      expect(Math.min(...inPlaneAllowances)).toBeGreaterThan(normalDrift);
    },
  );

  it("reports when coordinate resolution consumes the reliable area", () => {
    const result = certifyNativeProfileMassProperties(
      { ...ANALYTIC, area: 1e-8, perimeter: 1e8 },
      { area: 1e-8, centroid: [0.25, -0.5, 0] },
      [0, 0, 0],
      { modelingTolerance: 1e-7, requireCentroid: true },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "comparison-indeterminate",
      diagnostics: { reliableArea: expect.any(Number) },
    });
  });

  it("reports indeterminate non-finite centroid bounds without claiming disagreement", () => {
    const result = certifyNativeProfileMassProperties(
      {
        area: 1e300,
        areaRoundoffBound: 0,
        perimeter: 1e150,
        maxBoundaryRadius: 1e150,
        plane: "XY",
        centroidOffset: [0, 0, 0],
        centroidRoundoffBound: 0,
      },
      { area: 1e300, centroid: [0, 0, 0] },
      [0, 0, 0],
      { modelingTolerance: 1e-7, requireCentroid: true },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "comparison-indeterminate",
      diagnostics: {
        centroidError: [0, 0, 0],
        geometricCentroidAllowance: Number.POSITIVE_INFINITY,
      },
    });
  });

  it.each([
    {
      reason: "invalid-tolerance",
      analytic: ANALYTIC,
      native: { area: 6, centroid: [0.25, -0.5, 0] as const },
      origin: [0, 0, 0] as const,
      tolerance: 0,
    },
    {
      reason: "invalid-analytic-area",
      analytic: { ...ANALYTIC, area: Number.NaN },
      native: { area: 6, centroid: [0.25, -0.5, 0] as const },
      origin: [0, 0, 0] as const,
      tolerance: 1e-7,
    },
    {
      reason: "invalid-analytic-geometry",
      analytic: { ...ANALYTIC, perimeter: Number.NaN },
      native: { area: 6, centroid: [0.25, -0.5, 0] as const },
      origin: [0, 0, 0] as const,
      tolerance: 1e-7,
    },
    {
      reason: "invalid-native-area",
      analytic: ANALYTIC,
      native: { area: 0, centroid: [0.25, -0.5, 0] as const },
      origin: [0, 0, 0] as const,
      tolerance: 1e-7,
    },
    {
      reason: "invalid-analytic-centroid",
      analytic: {
        area: 6,
        areaRoundoffBound: 0,
        perimeter: 12,
        maxBoundaryRadius: 3,
        plane: "XY" as const,
        centroidOffset: [0.25, -0.5, 0] as const,
      },
      native: { area: 6, centroid: [0.25, -0.5, 0] as const },
      origin: [0, 0, 0] as const,
      tolerance: 1e-7,
    },
    {
      reason: "invalid-native-centroid",
      analytic: ANALYTIC,
      native: { area: 6, centroid: [Number.NaN, -0.5, 0] as const },
      origin: [0, 0, 0] as const,
      tolerance: 1e-7,
    },
  ])("reports $reason inputs", ({ reason, analytic, native, origin, tolerance }) => {
    const result = certifyNativeProfileMassProperties(
      analytic,
      native,
      origin,
      { modelingTolerance: tolerance, requireCentroid: true },
    );

    expect(result).toMatchObject({ ok: false, reason });
  });
});
