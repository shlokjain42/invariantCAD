import { distance2, type Vec2, type Vec3 } from "../core/math.js";
import {
  curveEnd,
  curveStart,
  numericPlaneBasis,
  pointOnNumericPlane,
  resolvedArcSweep,
  resolvedCurveIsFinite,
  type ResolvedArcCurve,
  type ResolvedCurve,
  type ResolvedLoop,
  type ResolvedProfile,
} from "./profile.js";

const TWO_PI = Math.PI * 2;
const SUMMATION_ROUNDOFF_FACTOR = 64;
const MAX_SUPPORTED_RELATIVE_AREA_ROUNDOFF = 1e-10;

export type ResolvedLoopOrientation = "counterclockwise" | "clockwise";

export interface ResolvedLoopAreaMomentsDiagnostics {
  readonly reference: Vec2;
  readonly naiveSignedArea: number;
  readonly areaCompensation: number;
  readonly absoluteAreaTermSum: number;
  readonly areaRoundoffBound: number;
  readonly relativeAreaRoundoffBound: number;
  readonly conditionNumber: number;
  readonly naiveSignedFirstMoment: Vec2;
  readonly firstMomentCompensation: Vec2;
  readonly absoluteFirstMomentTermSum: Vec2;
  readonly firstMomentRoundoffBound: Vec2;
  readonly centroidRoundoffBound: number;
  readonly maxClosureGap: number;
  readonly connectorCount: number;
}

export type ResolvedLoopAreaMomentsFailureReason =
  | "invalid-tolerance"
  | "invalid-reference"
  | "empty-loop"
  | "invalid-curve"
  | "circle-must-be-sole-curve"
  | "open-loop"
  | "degenerate-area"
  | "ill-conditioned";

export interface ResolvedLoopAreaMomentsSuccess {
  readonly ok: true;
  readonly signedArea: number;
  /** Signed first area moment about `diagnostics.reference`. */
  readonly signedFirstMoment: Vec2;
  readonly centroid: Vec2;
  readonly orientation: ResolvedLoopOrientation;
  readonly diagnostics: ResolvedLoopAreaMomentsDiagnostics;
}

export interface ResolvedLoopAreaMomentsFailure {
  readonly ok: false;
  readonly reason: ResolvedLoopAreaMomentsFailureReason;
  readonly message: string;
  readonly curveIndex?: number;
  readonly diagnostics?: ResolvedLoopAreaMomentsDiagnostics;
}

export type ResolvedLoopAreaMomentsResult =
  | ResolvedLoopAreaMomentsSuccess
  | ResolvedLoopAreaMomentsFailure;

export interface ResolvedLoopSignedAreaDiagnostics {
  readonly reference: Vec2;
  readonly naiveSignedArea: number;
  readonly areaCompensation: number;
  readonly absoluteAreaTermSum: number;
  readonly areaRoundoffBound: number;
  readonly relativeAreaRoundoffBound: number;
  readonly conditionNumber: number;
  readonly maxClosureGap: number;
  readonly connectorCount: number;
}

export interface ResolvedLoopSignedAreaSuccess {
  readonly ok: true;
  readonly signedArea: number;
  readonly orientation: ResolvedLoopOrientation;
  readonly diagnostics: ResolvedLoopSignedAreaDiagnostics;
}

export interface ResolvedLoopSignedAreaFailure {
  readonly ok: false;
  readonly reason: ResolvedLoopAreaMomentsFailureReason;
  readonly message: string;
  readonly curveIndex?: number;
  readonly diagnostics?: ResolvedLoopSignedAreaDiagnostics;
}

export type ResolvedLoopSignedAreaResult =
  | ResolvedLoopSignedAreaSuccess
  | ResolvedLoopSignedAreaFailure;

export interface ResolvedProfileAreaMomentsDiagnostics {
  readonly reference: Vec2;
  readonly semanticFirstMoment: Vec2;
  readonly absoluteAreaTermSum: number;
  readonly areaRoundoffBound: number;
  readonly relativeAreaRoundoffBound: number;
  readonly conditionNumber: number;
  readonly absoluteFirstMomentTermSum: Vec2;
  readonly firstMomentRoundoffBound: Vec2;
  readonly centroidRoundoffBound: number;
  readonly worldCentroidRoundoffBound: number;
  readonly maxClosureGap: number;
}

export type ResolvedProfileLocalAreaMomentsDiagnostics = Omit<
  ResolvedProfileAreaMomentsDiagnostics,
  "worldCentroidRoundoffBound"
>;

export type ResolvedProfileAreaMomentsFailureReason =
  | ResolvedLoopAreaMomentsFailureReason
  | "invalid-plane"
  | "non-positive-profile-area";

export interface ResolvedProfileAreaMomentsSuccess {
  readonly ok: true;
  /** Positive material area after semantic hole subtraction. */
  readonly area: number;
  readonly localCentroid: Vec2;
  readonly centroid: Vec3;
  readonly normal: Vec3;
  readonly outer: ResolvedLoopAreaMomentsSuccess;
  readonly holes: readonly ResolvedLoopAreaMomentsSuccess[];
  readonly diagnostics: ResolvedProfileAreaMomentsDiagnostics;
}

export interface ResolvedProfileAreaMomentsFailure {
  readonly ok: false;
  readonly reason: ResolvedProfileAreaMomentsFailureReason;
  readonly message: string;
  readonly loop?: "outer" | "hole";
  readonly holeIndex?: number;
  readonly curveIndex?: number;
  readonly diagnostics?:
    | ResolvedLoopAreaMomentsDiagnostics
    | ResolvedProfileAreaMomentsDiagnostics;
}

export type ResolvedProfileAreaMomentsResult =
  | ResolvedProfileAreaMomentsSuccess
  | ResolvedProfileAreaMomentsFailure;

export interface ResolvedProfileLocalAreaMomentsSuccess {
  readonly ok: true;
  /** Positive material area after semantic hole subtraction. */
  readonly area: number;
  readonly localCentroid: Vec2;
  readonly normal: Vec3;
  readonly outer: ResolvedLoopAreaMomentsSuccess;
  readonly holes: readonly ResolvedLoopAreaMomentsSuccess[];
  readonly diagnostics: ResolvedProfileLocalAreaMomentsDiagnostics;
}

export interface ResolvedProfileLocalAreaMomentsFailure {
  readonly ok: false;
  readonly reason: ResolvedProfileAreaMomentsFailureReason;
  readonly message: string;
  readonly loop?: "outer" | "hole";
  readonly holeIndex?: number;
  readonly curveIndex?: number;
  readonly diagnostics?:
    | ResolvedLoopAreaMomentsDiagnostics
    | ResolvedProfileLocalAreaMomentsDiagnostics;
}

export type ResolvedProfileLocalAreaMomentsResult =
  | ResolvedProfileLocalAreaMomentsSuccess
  | ResolvedProfileLocalAreaMomentsFailure;

interface ScalarAccumulator {
  readonly add: (value: number, evaluationError?: number) => boolean;
  readonly value: () => number;
  readonly naive: () => number;
  readonly compensation: () => number;
  readonly absoluteTermSum: () => number;
  readonly evaluationError: () => number;
}

interface MomentAccumulator {
  readonly area: ScalarAccumulator;
  readonly x: ScalarAccumulator;
  readonly y: ScalarAccumulator;
}

function scalarAccumulator(): ScalarAccumulator {
  let sum = 0;
  let correction = 0;
  let absoluteSum = 0;
  let absoluteCorrection = 0;
  let evaluationErrorSum = 0;
  let evaluationErrorCorrection = 0;
  const addCompensated = (
    value: number,
    current: number,
    currentCorrection: number,
  ): readonly [number, number] => {
    const next = current + value;
    const adjustment =
      Math.abs(current) >= Math.abs(value)
        ? current - next + value
        : value - next + current;
    return [next, currentCorrection + adjustment];
  };
  return {
    add(value, evaluationError = 0): boolean {
      if (
        !Number.isFinite(value) ||
        !Number.isFinite(evaluationError) ||
        evaluationError < 0
      ) {
        return false;
      }
      [sum, correction] = addCompensated(value, sum, correction);
      [absoluteSum, absoluteCorrection] = addCompensated(
        Math.abs(value),
        absoluteSum,
        absoluteCorrection,
      );
      [evaluationErrorSum, evaluationErrorCorrection] = addCompensated(
        evaluationError,
        evaluationErrorSum,
        evaluationErrorCorrection,
      );
      return true;
    },
    value: () => sum + correction,
    naive: () => sum,
    compensation: () => correction,
    absoluteTermSum: () => absoluteSum + absoluteCorrection,
    evaluationError: () =>
      evaluationErrorSum + evaluationErrorCorrection,
  };
}

function momentAccumulator(): MomentAccumulator {
  return {
    area: scalarAccumulator(),
    x: scalarAccumulator(),
    y: scalarAccumulator(),
  };
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

/** Error-free transformation of one finite binary64 addition. */
function twoSum(
  first: number,
  second: number,
): { readonly value: number; readonly error: number } {
  const value = first + second;
  const secondVirtual = value - first;
  const firstVirtual = value - secondVirtual;
  return {
    value,
    error:
      first - firstVirtual + (second - secondVirtual),
  };
}

function shifted(point: Vec2, reference: Vec2): Vec2 {
  return [point[0] - reference[0], point[1] - reference[1]];
}

function appendLineMoments(
  moments: MomentAccumulator,
  start: Vec2,
  end: Vec2,
  includeFirstMoments: boolean,
): boolean {
  const firstProduct = start[0] * end[1];
  const secondProduct = start[1] * end[0];
  const cross = firstProduct - secondProduct;
  const crossError =
    Number.EPSILON *
    16 *
    (Math.abs(firstProduct) + Math.abs(secondProduct));
  const area = cross / 2;
  if (
    !moments.area.add(
      area,
      crossError / 2 + Number.EPSILON * 4 * Math.abs(area),
    )
  ) {
    return false;
  }
  if (!includeFirstMoments) return true;
  const xSum = start[0] + end[0];
  const ySum = start[1] + end[1];
  const xSumError =
    Number.EPSILON * 4 * (Math.abs(start[0]) + Math.abs(end[0]));
  const ySumError =
    Number.EPSILON * 4 * (Math.abs(start[1]) + Math.abs(end[1]));
  const xMoment = (cross * xSum) / 6;
  const yMoment = (cross * ySum) / 6;
  const xMomentError =
    (Math.abs(xSum) * crossError + Math.abs(cross) * xSumError) / 6 +
    Number.EPSILON * 8 * Math.abs(xMoment);
  const yMomentError =
    (Math.abs(ySum) * crossError + Math.abs(cross) * ySumError) / 6 +
    Number.EPSILON * 8 * Math.abs(yMoment);
  return (
    moments.x.add(xMoment, xMomentError) &&
    moments.y.add(yMoment, yMomentError)
  );
}

function deltaMinusSine(
  delta: number,
): { readonly value: number; readonly error: number } {
  const absolute = Math.abs(delta);
  if (absolute >= 0.5) {
    const sine = Math.sin(delta);
    const value = delta - sine;
    return {
      value,
      error:
        Number.EPSILON * 16 * (Math.abs(delta) + Math.abs(sine)),
    };
  }
  const square = delta * delta;
  const value =
    delta *
    square *
    (1 / 6 +
      square *
        (-1 / 120 +
          square *
            (1 / 5040 + square * (-1 / 362880 + square / 39916800))));
  const truncationBound = absolute ** 13 / 6_227_020_800;
  return {
    value,
    error:
      truncationBound + Number.EPSILON * 64 * Math.abs(value),
  };
}

function arcEndpointsRelative(
  curve: ResolvedArcCurve,
  reference: Vec2,
): readonly [Vec2, Vec2] | undefined {
  const center = shifted(curve.center, reference);
  const sweep = resolvedArcSweep(curve);
  const startAngle = curve.startAngle;
  const endAngle = startAngle + sweep;
  const start: Vec2 = [
    center[0] + curve.radius * Math.cos(startAngle),
    center[1] + curve.radius * Math.sin(startAngle),
  ];
  const end: Vec2 = [
    center[0] + curve.radius * Math.cos(endAngle),
    center[1] + curve.radius * Math.sin(endAngle),
  ];
  return finitePoint(start) && finitePoint(end) ? [start, end] : undefined;
}

function curveEndpointsRelative(
  curve: ResolvedCurve,
  reference: Vec2,
): readonly [Vec2, Vec2] | undefined {
  if (curve.kind === "arc") return arcEndpointsRelative(curve, reference);
  const start = shifted(curveStart(curve), reference);
  const end = shifted(curveEnd(curve), reference);
  return finitePoint(start) && finitePoint(end) ? [start, end] : undefined;
}

function appendArcMoments(
  moments: MomentAccumulator,
  curve: ResolvedArcCurve,
  reference: Vec2,
  endpoints: readonly [Vec2, Vec2],
  includeFirstMoments: boolean,
): boolean {
  if (
    !appendLineMoments(
      moments,
      endpoints[0],
      endpoints[1],
      includeFirstMoments,
    )
  ) {
    return false;
  }

  const sweep = resolvedArcSweep(curve);
  const center = shifted(curve.center, reference);
  const deltaTerm = deltaMinusSine(sweep);
  const segmentArea =
    (curve.radius * curve.radius * deltaTerm.value) / 2;
  const segmentAreaError =
    (curve.radius * curve.radius * deltaTerm.error) / 2 +
    Number.EPSILON * 16 * Math.abs(segmentArea);
  if (!moments.area.add(segmentArea, segmentAreaError)) return false;
  if (!includeFirstMoments) return true;
  const halfSine = Math.sin(sweep / 2);
  const centralMomentScale =
    (2 / 3) * curve.radius ** 3 * halfSine ** 3;
  const centralMomentScaleError =
    Number.EPSILON * 64 * Math.abs(centralMomentScale);
  const middle = curve.startAngle + sweep / 2;
  const centerXMoment = segmentArea * center[0];
  const centerYMoment = segmentArea * center[1];
  const centralXMoment = centralMomentScale * Math.cos(middle);
  const centralYMoment = centralMomentScale * Math.sin(middle);
  return (
    moments.x.add(
      centerXMoment,
      Math.abs(center[0]) * segmentAreaError +
        Number.EPSILON * 16 * Math.abs(centerXMoment),
    ) &&
    moments.x.add(
      centralXMoment,
      centralMomentScaleError +
        Number.EPSILON * 16 * Math.abs(centralXMoment),
    ) &&
    moments.y.add(
      centerYMoment,
      Math.abs(center[1]) * segmentAreaError +
        Number.EPSILON * 16 * Math.abs(centerYMoment),
    ) &&
    moments.y.add(
      centralYMoment,
      centralMomentScaleError +
        Number.EPSILON * 16 * Math.abs(centralYMoment),
    )
  );
}

function appendCircleMoments(
  moments: MomentAccumulator,
  curve: Extract<ResolvedCurve, { readonly kind: "circle" }>,
  reference: Vec2,
  includeFirstMoments: boolean,
): boolean {
  const orientation = curve.reversed ? -1 : 1;
  const area = orientation * Math.PI * curve.radius ** 2;
  const center = shifted(curve.center, reference);
  const areaError = Number.EPSILON * 16 * Math.abs(area);
  if (!moments.area.add(area, areaError)) return false;
  if (!includeFirstMoments) return true;
  const xMoment = area * center[0];
  const yMoment = area * center[1];
  return (
    moments.x.add(
      xMoment,
      Math.abs(center[0]) * areaError +
        Number.EPSILON * 16 * Math.abs(xMoment),
    ) &&
    moments.y.add(
      yMoment,
      Math.abs(center[1]) * areaError +
        Number.EPSILON * 16 * Math.abs(yMoment),
    )
  );
}

function roundoffBound(accumulator: ScalarAccumulator): number {
  return (
    accumulator.evaluationError() +
    Number.EPSILON *
      SUMMATION_ROUNDOFF_FACTOR *
      accumulator.absoluteTermSum()
  );
}

function diagnostics(
  moments: MomentAccumulator,
  reference: Vec2,
  maxClosureGap: number,
  connectorCount: number,
): ResolvedLoopAreaMomentsDiagnostics {
  const signedArea = moments.area.value();
  const absoluteAreaTermSum = moments.area.absoluteTermSum();
  const absoluteArea = Math.abs(signedArea);
  const areaRoundoffBound = roundoffBound(moments.area);
  const relativeAreaRoundoffBound =
    absoluteArea > 0
      ? areaRoundoffBound / absoluteArea
      : Number.POSITIVE_INFINITY;
  const conditionNumber =
    absoluteArea > 0
      ? Math.max(1, absoluteAreaTermSum / absoluteArea)
      : Number.POSITIVE_INFINITY;
  const signedFirstMoment: Vec2 = [moments.x.value(), moments.y.value()];
  const firstMomentRoundoffBound: Vec2 = [
    roundoffBound(moments.x),
    roundoffBound(moments.y),
  ];
  const reliableArea = absoluteArea - areaRoundoffBound;
  const relativeCentroid: Vec2 =
    signedArea === 0
      ? [Number.NaN, Number.NaN]
      : [signedFirstMoment[0] / signedArea, signedFirstMoment[1] / signedArea];
  const centroidCoordinateBounds: Vec2 =
    reliableArea > 0
      ? [
          (firstMomentRoundoffBound[0] +
            Math.abs(relativeCentroid[0]) * areaRoundoffBound) /
            reliableArea +
            Number.EPSILON * 4 * Math.abs(relativeCentroid[0]) +
            Math.abs(twoSum(reference[0], relativeCentroid[0]).error),
          (firstMomentRoundoffBound[1] +
            Math.abs(relativeCentroid[1]) * areaRoundoffBound) /
            reliableArea +
            Number.EPSILON * 4 * Math.abs(relativeCentroid[1]) +
            Math.abs(twoSum(reference[1], relativeCentroid[1]).error),
        ]
      : [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  return {
    reference,
    naiveSignedArea: moments.area.naive(),
    areaCompensation: moments.area.compensation(),
    absoluteAreaTermSum,
    areaRoundoffBound,
    relativeAreaRoundoffBound,
    conditionNumber,
    naiveSignedFirstMoment: [moments.x.naive(), moments.y.naive()],
    firstMomentCompensation: [
      moments.x.compensation(),
      moments.y.compensation(),
    ],
    absoluteFirstMomentTermSum: [
      moments.x.absoluteTermSum(),
      moments.y.absoluteTermSum(),
    ],
    firstMomentRoundoffBound,
    centroidRoundoffBound: Math.hypot(...centroidCoordinateBounds),
    maxClosureGap,
    connectorCount,
  };
}

function loopFailure(
  reason: ResolvedLoopAreaMomentsFailureReason,
  message: string,
  options: {
    readonly curveIndex?: number;
    readonly diagnostics?: ResolvedLoopAreaMomentsDiagnostics;
  } = {},
): ResolvedLoopAreaMomentsFailure {
  return { ok: false, reason, message, ...options };
}

/**
 * Evaluates analytic signed area and first moments for one tolerantly closed
 * line/arc loop. Sub-tolerance endpoint gaps are closed by explicit line
 * connectors, making the measured boundary deterministic without tessellation.
 */
function evaluateResolvedLoop(
  loop: ResolvedLoop,
  tolerance: number,
  reference: Vec2 | undefined,
  includeFirstMoments: boolean,
): ResolvedLoopAreaMomentsResult {
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    return loopFailure(
      "invalid-tolerance",
      "Profile-moment tolerance must be finite and positive",
    );
  }
  if (loop.curves.length === 0) {
    return loopFailure("empty-loop", "A profile-moment loop cannot be empty");
  }
  const circleIndex = loop.curves.findIndex((curve) => curve.kind === "circle");
  if (circleIndex !== -1 && loop.curves.length !== 1) {
    return loopFailure(
      "circle-must-be-sole-curve",
      "A full circle must be the sole curve in a resolved loop",
      { curveIndex: circleIndex },
    );
  }
  for (const [curveIndex, curve] of loop.curves.entries()) {
    if (!resolvedCurveIsFinite(curve, tolerance)) {
      return loopFailure(
        "invalid-curve",
        `Profile curve ${curveIndex} must be finite and nondegenerate`,
        { curveIndex },
      );
    }
  }

  const selectedReference = reference ?? curveStart(loop.curves[0]!);
  if (!finitePoint(selectedReference)) {
    return loopFailure(
      reference === undefined ? "invalid-curve" : "invalid-reference",
      reference === undefined
        ? "The first profile curve does not have a finite start point"
        : "Profile-moment reference must contain two finite coordinates",
      reference === undefined ? { curveIndex: 0 } : {},
    );
  }

  const moments = momentAccumulator();
  const endpoints: Array<readonly [Vec2, Vec2]> = [];
  for (const [curveIndex, curve] of loop.curves.entries()) {
    const curveEndpoints = curveEndpointsRelative(curve, selectedReference);
    if (curveEndpoints === undefined) {
      return loopFailure(
        "invalid-curve",
        `Profile curve ${curveIndex} produces non-finite endpoints`,
        { curveIndex },
      );
    }
    endpoints.push(curveEndpoints);
    const appended =
      curve.kind === "line"
        ? appendLineMoments(
            moments,
            curveEndpoints[0],
            curveEndpoints[1],
            includeFirstMoments,
          )
        : curve.kind === "arc"
          ? appendArcMoments(
              moments,
              curve,
              selectedReference,
              curveEndpoints,
              includeFirstMoments,
            )
          : appendCircleMoments(
              moments,
              curve,
              selectedReference,
              includeFirstMoments,
            );
    if (!appended) {
      return loopFailure(
        "ill-conditioned",
        `Profile curve ${curveIndex} overflows the supported analytic moment range`,
        { curveIndex },
      );
    }
  }

  let maxClosureGap = 0;
  let connectorCount = 0;
  if (circleIndex === -1) {
    for (let index = 0; index < endpoints.length; index += 1) {
      const end = endpoints[index]![1];
      const nextStart = endpoints[(index + 1) % endpoints.length]![0];
      const gap = distance2(end, nextStart);
      if (!Number.isFinite(gap) || gap > tolerance) {
        return loopFailure(
          "open-loop",
          `Profile curve ${index} does not meet the next curve within tolerance`,
          { curveIndex: index },
        );
      }
      maxClosureGap = Math.max(maxClosureGap, gap);
      if (gap > 0) {
        connectorCount += 1;
        if (
          !appendLineMoments(
            moments,
            end,
            nextStart,
            includeFirstMoments,
          )
        ) {
          return loopFailure(
            "ill-conditioned",
            `Closure connector after profile curve ${index} overflows the supported analytic moment range`,
            { curveIndex: index },
          );
        }
      }
    }
  }

  const loopDiagnostics = diagnostics(
    moments,
    selectedReference,
    maxClosureGap,
    connectorCount,
  );
  const signedArea = moments.area.value();
  const signedFirstMoment: Vec2 = [moments.x.value(), moments.y.value()];
  if (
    !Number.isFinite(signedArea) ||
    !finitePoint(signedFirstMoment) ||
    !(Math.abs(signedArea) > tolerance ** 2 + loopDiagnostics.areaRoundoffBound)
  ) {
    return loopFailure(
      "degenerate-area",
      "Profile loop must enclose reliably nonzero finite area",
      { diagnostics: loopDiagnostics },
    );
  }
  if (
    !Number.isFinite(loopDiagnostics.relativeAreaRoundoffBound) ||
    loopDiagnostics.relativeAreaRoundoffBound >
      MAX_SUPPORTED_RELATIVE_AREA_ROUNDOFF
  ) {
    return loopFailure(
      "ill-conditioned",
      "Profile loop area terms cancel too strongly for a reliable signed area",
      { diagnostics: loopDiagnostics },
    );
  }
  if (
    includeFirstMoments &&
    (!Number.isFinite(loopDiagnostics.centroidRoundoffBound) ||
      loopDiagnostics.centroidRoundoffBound > tolerance)
  ) {
    return loopFailure(
      "ill-conditioned",
      "Profile loop moments cancel too strongly for a reliable centroid",
      { diagnostics: loopDiagnostics },
    );
  }
  const centroid: Vec2 = [
    twoSum(selectedReference[0], signedFirstMoment[0] / signedArea).value,
    twoSum(selectedReference[1], signedFirstMoment[1] / signedArea).value,
  ];
  if (!finitePoint(centroid)) {
    return loopFailure(
      "ill-conditioned",
      "Profile loop produces a non-finite centroid",
      { diagnostics: loopDiagnostics },
    );
  }
  return {
    ok: true,
    signedArea,
    signedFirstMoment,
    centroid,
    orientation: signedArea > 0 ? "counterclockwise" : "clockwise",
    diagnostics: loopDiagnostics,
  };
}

/**
 * Evaluates a reliably signed analytic loop area without requiring its first
 * moments or centroid to meet the selected coordinate tolerance.
 */
export function resolvedLoopSignedArea(
  loop: ResolvedLoop,
  tolerance: number,
  reference?: Vec2,
): ResolvedLoopSignedAreaResult {
  const result = evaluateResolvedLoop(loop, tolerance, reference, false);
  const areaDiagnostics = (
    value: ResolvedLoopAreaMomentsDiagnostics,
  ): ResolvedLoopSignedAreaDiagnostics => ({
    reference: value.reference,
    naiveSignedArea: value.naiveSignedArea,
    areaCompensation: value.areaCompensation,
    absoluteAreaTermSum: value.absoluteAreaTermSum,
    areaRoundoffBound: value.areaRoundoffBound,
    relativeAreaRoundoffBound: value.relativeAreaRoundoffBound,
    conditionNumber: value.conditionNumber,
    maxClosureGap: value.maxClosureGap,
    connectorCount: value.connectorCount,
  });
  if (!result.ok) {
    return {
      ...result,
      ...(result.diagnostics === undefined
        ? {}
        : { diagnostics: areaDiagnostics(result.diagnostics) }),
    };
  }
  return {
    ok: true,
    signedArea: result.signedArea,
    orientation: result.orientation,
    diagnostics: areaDiagnostics(result.diagnostics),
  };
}

/**
 * Evaluates analytic signed area and first moments for one tolerantly closed
 * line/arc loop, including a centroid certified to the selected tolerance.
 */
export function resolvedLoopAreaMoments(
  loop: ResolvedLoop,
  tolerance: number,
  reference?: Vec2,
): ResolvedLoopAreaMomentsResult {
  return evaluateResolvedLoop(loop, tolerance, reference, true);
}

function validPlane(profile: ResolvedProfile): boolean {
  return (
    (profile.plane.plane === "XY" ||
      profile.plane.plane === "XZ" ||
      profile.plane.plane === "YZ") &&
    profile.plane.origin.length === 3 &&
    profile.plane.origin.every(Number.isFinite)
  );
}

function wrapLoopFailure(
  failure: ResolvedLoopAreaMomentsFailure,
  loop: "outer" | "hole",
  holeIndex?: number,
): ResolvedProfileAreaMomentsFailure {
  return {
    ...failure,
    loop,
    ...(holeIndex === undefined ? {} : { holeIndex }),
  };
}

function evaluateResolvedProfileAreaMoments(
  profile: ResolvedProfile,
  tolerance: number,
  requireWorldCentroid: boolean,
): ResolvedProfileAreaMomentsResult {
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    return {
      ok: false,
      reason: "invalid-tolerance",
      message: "Profile-moment tolerance must be finite and positive",
    };
  }
  if (!validPlane(profile)) {
    return {
      ok: false,
      reason: "invalid-plane",
      message: "Profile plane must be a supported principal plane with a finite origin",
    };
  }

  const outer = resolvedLoopAreaMoments(profile.outer, tolerance);
  if (!outer.ok) return wrapLoopFailure(outer, "outer");
  const reference = outer.diagnostics.reference;
  const holes: ResolvedLoopAreaMomentsSuccess[] = [];
  for (const [holeIndex, hole] of profile.holes.entries()) {
    const result = resolvedLoopAreaMoments(hole, tolerance, reference);
    if (!result.ok) return wrapLoopFailure(result, "hole", holeIndex);
    holes.push(result);
  }

  const semantic = momentAccumulator();
  let inheritedAreaRoundoff = outer.diagnostics.areaRoundoffBound;
  let inheritedXRoundoff = outer.diagnostics.firstMomentRoundoffBound[0];
  let inheritedYRoundoff = outer.diagnostics.firstMomentRoundoffBound[1];
  const appendLoop = (
    loop: ResolvedLoopAreaMomentsSuccess,
    role: 1 | -1,
  ): boolean => {
    const orientation = loop.signedArea > 0 ? 1 : -1;
    return (
      semantic.area.add(role * Math.abs(loop.signedArea)) &&
      semantic.x.add(role * orientation * loop.signedFirstMoment[0]) &&
      semantic.y.add(role * orientation * loop.signedFirstMoment[1])
    );
  };
  if (!appendLoop(outer, 1)) {
    return {
      ok: false,
      reason: "ill-conditioned",
      message: "Outer profile moments overflow the supported aggregate range",
      loop: "outer",
    };
  }
  for (const [holeIndex, hole] of holes.entries()) {
    inheritedAreaRoundoff += hole.diagnostics.areaRoundoffBound;
    inheritedXRoundoff += hole.diagnostics.firstMomentRoundoffBound[0];
    inheritedYRoundoff += hole.diagnostics.firstMomentRoundoffBound[1];
    if (!appendLoop(hole, -1)) {
      return {
        ok: false,
        reason: "ill-conditioned",
        message: `Hole ${holeIndex} moments overflow the supported aggregate range`,
        loop: "hole",
        holeIndex,
      };
    }
  }

  const area = semantic.area.value();
  const semanticFirstMoment: Vec2 = [semantic.x.value(), semantic.y.value()];
  const absoluteAreaTermSum = semantic.area.absoluteTermSum();
  const aggregationAreaRoundoff = roundoffBound(semantic.area);
  const areaRoundoffBound = inheritedAreaRoundoff + aggregationAreaRoundoff;
  const firstMomentRoundoffBound: Vec2 = [
    inheritedXRoundoff + roundoffBound(semantic.x),
    inheritedYRoundoff + roundoffBound(semantic.y),
  ];
  const reliableArea = area - areaRoundoffBound;
  const relativeCentroid: Vec2 =
    area === 0
      ? [Number.NaN, Number.NaN]
      : [semanticFirstMoment[0] / area, semanticFirstMoment[1] / area];
  const localCentroidSums = [
    twoSum(reference[0], relativeCentroid[0]),
    twoSum(reference[1], relativeCentroid[1]),
  ] as const;
  const localCentroid: Vec2 = [
    localCentroidSums[0].value,
    localCentroidSums[1].value,
  ];
  const centroidCoordinateBounds: Vec2 =
    reliableArea > 0
      ? [
          (firstMomentRoundoffBound[0] +
            Math.abs(relativeCentroid[0]) * areaRoundoffBound) /
            reliableArea +
            Number.EPSILON * 4 * Math.abs(relativeCentroid[0]) +
            Math.abs(localCentroidSums[0].error),
          (firstMomentRoundoffBound[1] +
            Math.abs(relativeCentroid[1]) * areaRoundoffBound) /
            reliableArea +
            Number.EPSILON * 4 * Math.abs(relativeCentroid[1]) +
            Math.abs(localCentroidSums[1].error),
        ]
      : [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const centroid = pointOnNumericPlane(localCentroid, profile.plane);
  const worldCoordinateBounds: Vec3 = (() => {
    switch (profile.plane.plane) {
      case "XY":
        return [
          centroidCoordinateBounds[0] +
            Math.abs(twoSum(profile.plane.origin[0], localCentroid[0]).error),
          centroidCoordinateBounds[1] +
            Math.abs(twoSum(profile.plane.origin[1], localCentroid[1]).error),
          0,
        ];
      case "XZ":
        return [
          centroidCoordinateBounds[0] +
            Math.abs(twoSum(profile.plane.origin[0], localCentroid[0]).error),
          0,
          centroidCoordinateBounds[1] +
            Math.abs(twoSum(profile.plane.origin[2], localCentroid[1]).error),
        ];
      case "YZ":
        return [
          0,
          centroidCoordinateBounds[0] +
            Math.abs(twoSum(profile.plane.origin[1], localCentroid[0]).error),
          centroidCoordinateBounds[1] +
            Math.abs(twoSum(profile.plane.origin[2], localCentroid[1]).error),
        ];
    }
  })();
  const profileDiagnostics: ResolvedProfileAreaMomentsDiagnostics = {
    reference,
    semanticFirstMoment,
    absoluteAreaTermSum,
    areaRoundoffBound,
    relativeAreaRoundoffBound:
      area > 0 ? areaRoundoffBound / area : Number.POSITIVE_INFINITY,
    conditionNumber:
      area > 0
        ? Math.max(1, absoluteAreaTermSum / area)
        : Number.POSITIVE_INFINITY,
    absoluteFirstMomentTermSum: [
      semantic.x.absoluteTermSum(),
      semantic.y.absoluteTermSum(),
    ],
    firstMomentRoundoffBound,
    centroidRoundoffBound: Math.hypot(...centroidCoordinateBounds),
    worldCentroidRoundoffBound: Math.hypot(...worldCoordinateBounds),
    maxClosureGap: Math.max(
      outer.diagnostics.maxClosureGap,
      ...holes.map((hole) => hole.diagnostics.maxClosureGap),
    ),
  };

  if (
    !Number.isFinite(area) ||
    !finitePoint(semanticFirstMoment) ||
    !(area > tolerance ** 2 + areaRoundoffBound)
  ) {
    return {
      ok: false,
      reason: "non-positive-profile-area",
      message: "Profile holes must leave reliably positive finite material area",
      diagnostics: profileDiagnostics,
    };
  }
  if (
    !Number.isFinite(profileDiagnostics.relativeAreaRoundoffBound) ||
    profileDiagnostics.relativeAreaRoundoffBound >
      MAX_SUPPORTED_RELATIVE_AREA_ROUNDOFF ||
    !Number.isFinite(profileDiagnostics.centroidRoundoffBound) ||
    profileDiagnostics.centroidRoundoffBound > tolerance
  ) {
    return {
      ok: false,
      reason: "ill-conditioned",
      message:
        "Profile area moments cancel too strongly for a reliable local centroid",
      diagnostics: profileDiagnostics,
    };
  }
  if (
    requireWorldCentroid &&
    (!Number.isFinite(profileDiagnostics.worldCentroidRoundoffBound) ||
      profileDiagnostics.worldCentroidRoundoffBound > tolerance)
  ) {
    return {
      ok: false,
      reason: "ill-conditioned",
      message:
        "Profile origin and local moments do not produce a reliable world centroid",
      diagnostics: profileDiagnostics,
    };
  }

  const normal = numericPlaneBasis(profile.plane).n;
  if (
    !finitePoint(localCentroid) ||
    (requireWorldCentroid && !centroid.every(Number.isFinite))
  ) {
    return {
      ok: false,
      reason: "ill-conditioned",
      message: requireWorldCentroid
        ? "Profile produces a non-finite local or world centroid"
        : "Profile produces a non-finite local centroid",
      diagnostics: profileDiagnostics,
    };
  }
  return {
    ok: true,
    area,
    localCentroid,
    centroid,
    normal,
    outer,
    holes,
    diagnostics: profileDiagnostics,
  };
}

/**
 * Evaluates positive material area and a profile-local centroid without making
 * classification depend on the profile's world translation.
 */
export function resolvedProfileLocalAreaMoments(
  profile: ResolvedProfile,
  tolerance: number,
): ResolvedProfileLocalAreaMomentsResult {
  const localDiagnostics = (
    value: ResolvedProfileAreaMomentsDiagnostics,
  ): ResolvedProfileLocalAreaMomentsDiagnostics => {
    const { worldCentroidRoundoffBound: _, ...local } = value;
    return local;
  };
  const result = evaluateResolvedProfileAreaMoments(
    profile,
    tolerance,
    false,
  );
  if (!result.ok) {
    return {
      ...result,
      ...(result.diagnostics !== undefined &&
      "worldCentroidRoundoffBound" in result.diagnostics
        ? { diagnostics: localDiagnostics(result.diagnostics) }
        : {}),
    };
  }
  return {
    ok: true,
    area: result.area,
    localCentroid: result.localCentroid,
    normal: result.normal,
    outer: result.outer,
    holes: result.holes,
    diagnostics: localDiagnostics(result.diagnostics),
  };
}

/**
 * Evaluates positive material area and centroid for a resolved profile.
 * Outer/hole roles determine addition and subtraction independently of each
 * loop's authored traversal orientation. This is an algebraic area-moment
 * oracle; callers must establish loop simplicity, containment, and disjoint
 * holes separately when those are required by a feature contract.
 */
export function resolvedProfileAreaMoments(
  profile: ResolvedProfile,
  tolerance: number,
): ResolvedProfileAreaMomentsResult {
  return evaluateResolvedProfileAreaMoments(profile, tolerance, true);
}
