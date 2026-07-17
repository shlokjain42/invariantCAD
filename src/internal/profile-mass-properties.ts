import type { Vec3 } from "../core/math.js";

/** Relative agreement expected from OCCT's exact planar surface integration. */
export const NATIVE_PROFILE_AREA_RELATIVE_TOLERANCE = 1e-9;
/** Linear native-integration allowance expressed in modeling-tolerance units. */
export const NATIVE_PROFILE_CENTROID_TOLERANCE_FACTOR = 8;
/** ULPs admitted for each independently rounded native world coordinate. */
export const NATIVE_PROFILE_COORDINATE_ULP_FACTOR = 2;

export interface AnalyticProfileMassProperties {
  readonly area: number;
  readonly areaRoundoffBound: number;
  /** Exact authored boundary length, including tolerance closure connectors. */
  readonly perimeter: number;
  /** Conservative greatest boundary distance from the analytic centroid. */
  readonly maxBoundaryRadius: number;
  readonly plane: "XY" | "XZ" | "YZ";
  /** World-basis centroid offset from the seated profile-plane origin. */
  readonly centroidOffset: Vec3;
  readonly centroidRoundoffBound?: number;
}

export interface NativeProfileMassProperties {
  readonly area: number;
  readonly centroid?: Vec3;
}

export interface NativeProfileMassPropertyCertificationOptions {
  readonly modelingTolerance: number;
  readonly requireCentroid: boolean;
}

export interface NativeProfileMassPropertyDiagnostics {
  readonly analyticArea: number;
  readonly nativeArea: number;
  readonly analyticAreaRoundoffBound: number;
  readonly analyticPerimeter: number;
  readonly analyticMaxBoundaryRadius: number;
  readonly areaError: number;
  readonly areaAllowance: number;
  readonly numericAreaAllowance: number;
  readonly boundaryAreaAllowance: number;
  readonly boundaryDisplacementAllowance: number;
  readonly reliableArea: number;
  readonly analyticCentroidOffset?: Vec3;
  readonly nativeCentroid?: Vec3;
  readonly nativeCentroidOffset?: Vec3;
  readonly analyticCentroidRoundoffBound?: number;
  readonly centroidError?: Vec3;
  readonly centroidAllowance?: Vec3;
  readonly boundaryCoordinateRoundoffBound: Vec3;
  readonly coordinateRoundoffBound: Vec3;
  readonly geometricCentroidAllowance?: number;
  readonly nativeCentroidFloor?: number;
}

export type NativeProfileMassPropertyCertificationFailureReason =
  | "invalid-tolerance"
  | "invalid-analytic-area"
  | "invalid-analytic-geometry"
  | "invalid-native-area"
  | "comparison-indeterminate"
  | "area-mismatch"
  | "invalid-analytic-centroid"
  | "invalid-native-centroid"
  | "centroid-mismatch";

export interface NativeProfileMassPropertyCertificationSuccess {
  readonly ok: true;
  /** The analytic values remain the source of truth after certification. */
  readonly properties: AnalyticProfileMassProperties;
  readonly diagnostics: NativeProfileMassPropertyDiagnostics;
}

export interface NativeProfileMassPropertyCertificationFailure {
  readonly ok: false;
  readonly reason: NativeProfileMassPropertyCertificationFailureReason;
  readonly message: string;
  readonly diagnostics?: NativeProfileMassPropertyDiagnostics;
}

export type NativeProfileMassPropertyCertification =
  | NativeProfileMassPropertyCertificationSuccess
  | NativeProfileMassPropertyCertificationFailure;

function finiteVector(value: Vec3 | undefined): value is Vec3 {
  return (
    value !== undefined &&
    value.length === 3 &&
    value.every(Number.isFinite)
  );
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return [
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  ];
}

function binary64Ulp(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0 || magnitude < 2 ** -1022) return Number.MIN_VALUE;
  return 2 ** (Math.floor(Math.log2(magnitude)) - 52);
}

function coordinateRoundoffAllowance(
  origin: number,
  centroidOffset: number,
  boundaryExtent: number,
  nativeCentroid: number | undefined,
): number {
  const centroid = origin + centroidOffset;
  const relevant = [
    origin,
    centroid,
    centroid - boundaryExtent,
    centroid + boundaryExtent,
  ];
  if (nativeCentroid !== undefined) relevant.push(nativeCentroid);
  return (
    NATIVE_PROFILE_COORDINATE_ULP_FACTOR *
    Math.max(...relevant.map(binary64Ulp))
  );
}

function planeAxes(
  plane: AnalyticProfileMassProperties["plane"],
): {
  readonly inPlane: readonly [number, number];
  readonly normal: number;
} {
  switch (plane) {
    case "XY":
      return { inPlane: [0, 1], normal: 2 };
    case "XZ":
      return { inPlane: [0, 2], normal: 1 };
    case "YZ":
      return { inPlane: [1, 2], normal: 0 };
  }
}

function failure(
  reason: NativeProfileMassPropertyCertificationFailureReason,
  message: string,
  diagnostics?: NativeProfileMassPropertyDiagnostics,
): NativeProfileMassPropertyCertificationFailure {
  return {
    ok: false,
    reason,
    message,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
}

/**
 * Certifies that an independently integrated native planar face still matches
 * the analytic profile moments used by feature semantics. Native values never
 * replace the analytic source of truth, even when they agree.
 */
export function certifyNativeProfileMassProperties(
  analytic: AnalyticProfileMassProperties,
  native: NativeProfileMassProperties,
  planeOrigin: Vec3,
  options: NativeProfileMassPropertyCertificationOptions,
): NativeProfileMassPropertyCertification {
  const modelingTolerance = options.modelingTolerance;
  if (!Number.isFinite(modelingTolerance) || !(modelingTolerance > 0)) {
    return failure(
      "invalid-tolerance",
      "Native profile mass-property tolerance must be finite and positive",
    );
  }
  if (
    !Number.isFinite(analytic.area) ||
    !(analytic.area > 0) ||
    !Number.isFinite(analytic.areaRoundoffBound) ||
    analytic.areaRoundoffBound < 0
  ) {
    return failure(
      "invalid-analytic-area",
      "Analytic profile area must be finite and positive, with a finite non-negative roundoff bound",
    );
  }
  if (!Number.isFinite(native.area) || !(native.area > 0)) {
    return failure(
      "invalid-native-area",
      "Native profile surface area must be finite and positive",
    );
  }

  if (
    !finiteVector(planeOrigin) ||
    !Number.isFinite(analytic.perimeter) ||
    !(analytic.perimeter > 0) ||
    !Number.isFinite(analytic.maxBoundaryRadius) ||
    analytic.maxBoundaryRadius < 0 ||
    !finiteVector(analytic.centroidOffset) ||
    !["XY", "XZ", "YZ"].includes(analytic.plane)
  ) {
    return failure(
      "invalid-analytic-geometry",
      "Analytic profile plane, perimeter, boundary radius, centroid offset, and origin must be finite",
    );
  }

  const areaError = Math.abs(native.area - analytic.area);
  const axes = planeAxes(analytic.plane);
  const finiteNativeCentroid = finiteVector(native.centroid)
    ? native.centroid
    : undefined;
  const boundaryCoordinateRoundoffBound: Vec3 = [
    coordinateRoundoffAllowance(
      planeOrigin[0],
      analytic.centroidOffset[0],
      axes.normal === 0 ? 0 : analytic.maxBoundaryRadius,
      undefined,
    ),
    coordinateRoundoffAllowance(
      planeOrigin[1],
      analytic.centroidOffset[1],
      axes.normal === 1 ? 0 : analytic.maxBoundaryRadius,
      undefined,
    ),
    coordinateRoundoffAllowance(
      planeOrigin[2],
      analytic.centroidOffset[2],
      axes.normal === 2 ? 0 : analytic.maxBoundaryRadius,
      undefined,
    ),
  ];
  const coordinateRoundoffBound: Vec3 = [
    coordinateRoundoffAllowance(
      planeOrigin[0],
      analytic.centroidOffset[0],
      axes.normal === 0 ? 0 : analytic.maxBoundaryRadius,
      finiteNativeCentroid?.[0],
    ),
    coordinateRoundoffAllowance(
      planeOrigin[1],
      analytic.centroidOffset[1],
      axes.normal === 1 ? 0 : analytic.maxBoundaryRadius,
      finiteNativeCentroid?.[1],
    ),
    coordinateRoundoffAllowance(
      planeOrigin[2],
      analytic.centroidOffset[2],
      axes.normal === 2 ? 0 : analytic.maxBoundaryRadius,
      finiteNativeCentroid?.[2],
    ),
  ];
  const boundaryDisplacementAllowance =
    modelingTolerance +
    Math.hypot(
      boundaryCoordinateRoundoffBound[axes.inPlane[0]]!,
      boundaryCoordinateRoundoffBound[axes.inPlane[1]]!,
    );
  const boundaryAreaAllowance =
    2 * analytic.perimeter * boundaryDisplacementAllowance +
    Math.PI * boundaryDisplacementAllowance ** 2;
  const numericAreaAllowance =
    NATIVE_PROFILE_AREA_RELATIVE_TOLERANCE *
    Math.max(analytic.area, native.area);
  const areaAllowance =
    analytic.areaRoundoffBound +
    boundaryAreaAllowance +
    numericAreaAllowance;
  const reliableArea =
    analytic.area -
    analytic.areaRoundoffBound -
    boundaryAreaAllowance -
    numericAreaAllowance;
  const areaDiagnostics: NativeProfileMassPropertyDiagnostics = {
    analyticArea: analytic.area,
    nativeArea: native.area,
    analyticAreaRoundoffBound: analytic.areaRoundoffBound,
    analyticPerimeter: analytic.perimeter,
    analyticMaxBoundaryRadius: analytic.maxBoundaryRadius,
    areaError,
    areaAllowance,
    numericAreaAllowance,
    boundaryAreaAllowance,
    boundaryDisplacementAllowance,
    reliableArea,
    boundaryCoordinateRoundoffBound,
    coordinateRoundoffBound,
  };
  if (
    !Number.isFinite(areaError) ||
    !Number.isFinite(areaAllowance) ||
    !Number.isFinite(reliableArea)
  ) {
    return failure(
      "comparison-indeterminate",
      "Native profile mass-property comparison does not have finite error bounds",
      areaDiagnostics,
    );
  }
  if (areaError > areaAllowance) {
    return failure(
      "area-mismatch",
      "Native profile surface area disagrees with exact analytic profile moments",
      areaDiagnostics,
    );
  }
  if (!(reliableArea > 0)) {
    return failure(
      "comparison-indeterminate",
      "Coordinate resolution and modeling tolerance consume the reliable analytic profile area",
      areaDiagnostics,
    );
  }
  if (!options.requireCentroid) {
    return {
      ok: true,
      properties: analytic,
      diagnostics: areaDiagnostics,
    };
  }

  const analyticCentroidOffset = analytic.centroidOffset;
  const analyticCentroidRoundoffBound =
    analytic.centroidRoundoffBound;
  if (
    typeof analyticCentroidRoundoffBound !== "number" ||
    !Number.isFinite(analyticCentroidRoundoffBound) ||
    analyticCentroidRoundoffBound < 0
  ) {
    return failure(
      "invalid-analytic-centroid",
      "Analytic profile centroid offset and its roundoff bound must be finite",
      areaDiagnostics,
    );
  }
  if (!finiteVector(native.centroid)) {
    return failure(
      "invalid-native-centroid",
      "Native profile surface centroid must contain three finite coordinates",
      {
        ...areaDiagnostics,
        analyticCentroidOffset,
        analyticCentroidRoundoffBound,
      },
    );
  }

  const nativeCentroid = native.centroid;
  const nativeCentroidOffset = subtract(nativeCentroid, planeOrigin);
  if (!finiteVector(nativeCentroidOffset)) {
    return failure(
      "invalid-native-centroid",
      "Native profile surface centroid cannot be resolved relative to its plane origin",
      {
        ...areaDiagnostics,
        analyticCentroidOffset,
        nativeCentroid,
        analyticCentroidRoundoffBound,
      },
    );
  }
  const centroidError: Vec3 = [
    Math.abs(nativeCentroidOffset[0] - analyticCentroidOffset[0]),
    Math.abs(nativeCentroidOffset[1] - analyticCentroidOffset[1]),
    Math.abs(nativeCentroidOffset[2] - analyticCentroidOffset[2]),
  ];
  const geometricCentroidAllowance =
    ((analytic.maxBoundaryRadius + boundaryDisplacementAllowance) *
      boundaryAreaAllowance) /
    reliableArea;
  const nativeCentroidFloor =
    NATIVE_PROFILE_AREA_RELATIVE_TOLERANCE *
    Math.max(
      analytic.maxBoundaryRadius,
      Math.sqrt(analytic.area),
      modelingTolerance,
    );
  const inPlaneCentroidBaseAllowance =
    analyticCentroidRoundoffBound +
    geometricCentroidAllowance +
    modelingTolerance * NATIVE_PROFILE_CENTROID_TOLERANCE_FACTOR +
    nativeCentroidFloor;
  const normalCentroidBaseAllowance =
    modelingTolerance * NATIVE_PROFILE_CENTROID_TOLERANCE_FACTOR +
    nativeCentroidFloor;
  const centroidAllowance: Vec3 = [
    (axes.normal === 0
      ? normalCentroidBaseAllowance
      : inPlaneCentroidBaseAllowance) + coordinateRoundoffBound[0],
    (axes.normal === 1
      ? normalCentroidBaseAllowance
      : inPlaneCentroidBaseAllowance) + coordinateRoundoffBound[1],
    (axes.normal === 2
      ? normalCentroidBaseAllowance
      : inPlaneCentroidBaseAllowance) + coordinateRoundoffBound[2],
  ];
  const diagnostics: NativeProfileMassPropertyDiagnostics = {
    ...areaDiagnostics,
    analyticCentroidOffset,
    nativeCentroid,
    nativeCentroidOffset,
    analyticCentroidRoundoffBound,
    centroidError,
    centroidAllowance,
    coordinateRoundoffBound,
    geometricCentroidAllowance,
    nativeCentroidFloor,
  };
  if (
    centroidError.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(geometricCentroidAllowance) ||
    !Number.isFinite(nativeCentroidFloor) ||
    centroidAllowance.some((value) => !Number.isFinite(value))
  ) {
    return failure(
      "comparison-indeterminate",
      "Native profile centroid comparison does not have finite error bounds",
      diagnostics,
    );
  }
  if (
    centroidError.some((value, index) => value > centroidAllowance[index]!)
  ) {
    return failure(
      "centroid-mismatch",
      "Native profile surface centroid disagrees with exact analytic profile moments",
      diagnostics,
    );
  }
  return { ok: true, properties: analytic, diagnostics };
}
