import type { Vec2, Vec3 } from "../core/math.js";
import {
  numericPlaneBasis,
  resolvedCurveIsFinite,
  resolvedLoopIsClosed,
  type ResolvedProfile,
} from "./profile.js";
import {
  resolvedLoopSignedArea,
  resolvedProfileLocalAreaMoments,
  type ResolvedProfileLocalAreaMomentsResult,
} from "./profile-moments.js";
import {
  resolvedAdjacentPathSegmentsHaveRemoteClearance,
  resolvedCompositePathSegments,
  resolvedCircularArcGeometry,
  resolvedPathInitialTangent,
  resolvedPathSegmentEndTangent,
  resolvedPathSegmentLength,
  resolvedPathSegmentsHaveClearance,
  resolvedPathSegmentStartTangent,
  resolvedPathStart,
  resolvedPolylineSegmentDistance,
  validateResolvedPath,
  type PathValidationReason,
  type ResolvedCompositePath,
  type ResolvedPath,
} from "./path.js";

export const SWEEP_TRANSITIONS = Object.freeze(["right-corner"] as const);
export type SweepTransition = (typeof SWEEP_TRANSITIONS)[number];
export const SWEEP_FRAMES = Object.freeze(["corrected-frenet"] as const);
export type SweepFrame = (typeof SWEEP_FRAMES)[number];

/**
 * Canonical order for additive guarantees beyond the base composite-sweep
 * contract. A classifier result always follows this order, independently of
 * the order in which a kernel advertises its guarantees.
 */
export const COMPOSITE_SWEEP_REFINEMENTS = Object.freeze([
  "major-multiple-arcs",
  "major-eccentric-profile",
] as const);
export type CompositeSweepRefinement =
  (typeof COMPOSITE_SWEEP_REFINEMENTS)[number];

/** Angular ambiguity retained around an exact semicircle, in radians. */
export const COMPOSITE_SWEEP_MAJOR_ARC_ANGLE_EPSILON = 1e-12;
/** Strict lower bound for classifying a selected composite arc as major. */
export const COMPOSITE_SWEEP_MAJOR_ARC_THRESHOLD =
  Math.PI + COMPOSITE_SWEEP_MAJOR_ARC_ANGLE_EPSILON;

export interface CompositeSweepArcRefinementEvidence {
  readonly segmentIndex: number;
  readonly sweep: number;
  readonly major: boolean;
}

export interface CompositeSweepProfileRefinementEvidence {
  readonly area: number;
  /** Area centroid in the authored profile plane's local coordinates. */
  readonly localCentroid: Vec2;
  /**
   * Translation-invariant distance from the centroid of the profile after its
  * plane origin is seated exactly at the composite path start.
  */
  readonly seatedCentroidDistance: number;
  /** Conservative Euclidean error bound for `localCentroid`. */
  readonly centroidRoundoffBound: number;
  /**
   * Lower bound on the true seated distance after accounting for analytic
   * moment roundoff. Eccentricity is required only when this exceeds the
   * selected centering tolerance.
   */
  readonly certifiedSeatedCentroidDistanceLowerBound: number;
  readonly centeringTolerance: number;
}

export interface CompositeSweepRefinementEvidence {
  readonly majorArcThreshold: number;
  readonly circularArcCount: number;
  readonly arcs: readonly CompositeSweepArcRefinementEvidence[];
  readonly majorArcSegmentIndices: readonly number[];
  /** Present only when at least one arc is classified as major. */
  readonly profile?: CompositeSweepProfileRefinementEvidence;
}

export interface CompositeSweepRefinementClassificationSuccess {
  readonly ok: true;
  /** A duplicate-free subset of `COMPOSITE_SWEEP_REFINEMENTS`, in its order. */
  readonly requiredRefinements: readonly CompositeSweepRefinement[];
  readonly evidence: CompositeSweepRefinementEvidence;
}

export type CompositeSweepRefinementClassificationFailureReason =
  | "invalid-tolerance"
  | "invalid-path"
  | "invalid-profile-moments";

export interface CompositeSweepRefinementClassificationFailure {
  readonly ok: false;
  readonly reason: CompositeSweepRefinementClassificationFailureReason;
  readonly message: string;
  readonly segmentIndex?: number;
  readonly profileMoments?: Extract<
    ResolvedProfileLocalAreaMomentsResult,
    { readonly ok: false }
  >;
}

export type CompositeSweepRefinementClassification =
  | CompositeSweepRefinementClassificationSuccess
  | CompositeSweepRefinementClassificationFailure;

export interface ResolvedSweepOptions {
  /** Document v1 uses intersected right-corner transitions at spine vertices. */
  readonly transition: SweepTransition;
  /** Minimal-torsion section transport along each spine segment. */
  readonly frame: SweepFrame;
}

export type SweepValidationReason =
  | PathValidationReason
  | "holes-unsupported"
  | "open-profile"
  | "non-finite-profile"
  | "degenerate-profile"
  | "profile-origin-mismatch"
  | "profile-tangent-mismatch"
  | "path-clearance";

export interface SweepValidationIssue {
  readonly reason: SweepValidationReason;
  readonly message: string;
  readonly input: "profile" | "path";
  readonly pointIndex?: number;
  readonly segmentIndex?: number;
  readonly otherSegmentIndex?: number;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function profileRadius(profile: ResolvedProfile): number {
  return profile.outer.curves.reduce((maximum, curve) => {
    switch (curve.kind) {
      case "line":
        return Math.max(
          maximum,
          Math.hypot(...curve.start),
          Math.hypot(...curve.end),
        );
      case "arc":
      case "circle":
        return Math.max(maximum, Math.hypot(...curve.center) + curve.radius);
    }
  }, 0);
}

/**
 * Classifies the additive guarantees needed by one validated composite sweep.
 *
 * Profile eccentricity is intentionally measured in profile-local
 * coordinates. Composite transfer seats the profile plane origin exactly at
 * `path.start`, so including an admitted authored origin mismatch would make
 * the classification translation-dependent and disagree with the transferred
 * section.
 */
export function classifyResolvedCompositeSweepRefinements(
  profile: ResolvedProfile,
  path: ResolvedCompositePath,
  centeringTolerance: number,
): CompositeSweepRefinementClassification {
  if (
    !Number.isFinite(centeringTolerance) ||
    !(centeringTolerance > 0)
  ) {
    return {
      ok: false,
      reason: "invalid-tolerance",
      message:
        "Composite-sweep refinement centering tolerance must be finite and positive",
    };
  }

  const pathIssue = validateResolvedPath(path, centeringTolerance);
  if (pathIssue !== undefined) {
    return {
      ok: false,
      reason: "invalid-path",
      message: pathIssue.message,
      ...(pathIssue.segmentIndex === undefined
        ? {}
        : { segmentIndex: pathIssue.segmentIndex }),
    };
  }

  const segments = resolvedCompositePathSegments(path);
  const arcs: CompositeSweepArcRefinementEvidence[] = [];
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.kind !== "circularArc") continue;
    const geometry = resolvedCircularArcGeometry(segment);
    if (
      geometry === undefined ||
      !Number.isFinite(geometry.sweep) ||
      !(geometry.sweep > 0)
    ) {
      return {
        ok: false,
        reason: "invalid-path",
        message: `Composite circular-arc segment ${segmentIndex} does not resolve to a finite positive sweep`,
        segmentIndex,
      };
    }
    arcs.push({
      segmentIndex,
      sweep: geometry.sweep,
      major: geometry.sweep > COMPOSITE_SWEEP_MAJOR_ARC_THRESHOLD,
    });
  }

  const majorArcSegmentIndices = arcs
    .filter((arc) => arc.major)
    .map((arc) => arc.segmentIndex);
  const pathEvidence = {
    majorArcThreshold: COMPOSITE_SWEEP_MAJOR_ARC_THRESHOLD,
    circularArcCount: arcs.length,
    arcs,
    majorArcSegmentIndices,
  } as const;
  if (majorArcSegmentIndices.length === 0) {
    return {
      ok: true,
      requiredRefinements: [],
      evidence: pathEvidence,
    };
  }

  const profileMoments = resolvedProfileLocalAreaMoments(
    profile,
    centeringTolerance,
  );
  if (!profileMoments.ok) {
    return {
      ok: false,
      reason: "invalid-profile-moments",
      message: profileMoments.message,
      profileMoments,
    };
  }
  const localCentroid = profileMoments.localCentroid;
  const seatedCentroidDistance = Math.hypot(
    localCentroid[0],
    localCentroid[1],
  );
  const centroidRoundoffBound =
    profileMoments.diagnostics.centroidRoundoffBound;
  const certifiedSeatedCentroidDistanceLowerBound = Math.max(
    0,
    seatedCentroidDistance - centroidRoundoffBound,
  );
  if (
    !Number.isFinite(seatedCentroidDistance) ||
    !Number.isFinite(centroidRoundoffBound) ||
    !Number.isFinite(certifiedSeatedCentroidDistanceLowerBound)
  ) {
    return {
      ok: false,
      reason: "invalid-profile-moments",
      message:
        "Composite-sweep profile area centroid must have a finite certified seated distance",
    };
  }

  const requiredRefinements = COMPOSITE_SWEEP_REFINEMENTS.filter(
    (refinement) =>
      refinement === "major-multiple-arcs"
        ? arcs.length !== 1
        : certifiedSeatedCentroidDistanceLowerBound > centeringTolerance,
  );
  return {
    ok: true,
    requiredRefinements,
    evidence: {
      ...pathEvidence,
      profile: {
        area: profileMoments.area,
        localCentroid,
        seatedCentroidDistance,
        centroidRoundoffBound,
        certifiedSeatedCentroidDistanceLowerBound,
        centeringTolerance,
      },
    },
  };
}

/** Checks the bounded document-v1 solid-sweep admission contract. */
export function validateResolvedSweep(
  profile: ResolvedProfile,
  path: ResolvedPath,
  tolerance: number,
): SweepValidationIssue | undefined {
  const pathIssue = validateResolvedPath(path, tolerance);
  if (pathIssue !== undefined) {
    return { ...pathIssue, input: "path" };
  }
  if (profile.holes.length !== 0) {
    return {
      reason: "holes-unsupported",
      message: "Document v1 sweep profiles cannot contain holes",
      input: "profile",
    };
  }
  if (
    profile.plane.origin.some((component) => !Number.isFinite(component)) ||
    profile.outer.curves.some(
      (curve) => !resolvedCurveIsFinite(curve, tolerance),
    )
  ) {
    return {
      reason: "non-finite-profile",
      message: "Sweep profile must contain finite, nondegenerate curves",
      input: "profile",
    };
  }
  if (!resolvedLoopIsClosed(profile.outer, tolerance)) {
    return {
      reason: "open-profile",
      message: "A solid sweep requires one closed outer profile loop",
      input: "profile",
    };
  }
  const area = resolvedLoopSignedArea(profile.outer, tolerance);
  if (!area.ok) {
    return {
      reason: "degenerate-profile",
      message: "Sweep profile must enclose nonzero finite area",
      input: "profile",
    };
  }
  const start = resolvedPathStart(path);
  if (distance(profile.plane.origin as Vec3, start) > tolerance) {
    return {
      reason: "profile-origin-mismatch",
      message: "Sweep profile origin must coincide with the path start",
      input: "profile",
      pointIndex: 0,
    };
  }
  const tangent = resolvedPathInitialTangent(path);
  const firstCompositeSegment =
    path.kind === "composite"
      ? resolvedCompositePathSegments(path)[0]!
      : undefined;
  const tangentScale =
    path.kind === "polyline"
      ? distance(path.points[0]!, path.points[1]!)
      : path.kind === "circularArc"
        ? resolvedCircularArcGeometry(path)!.radius
        : firstCompositeSegment!.kind === "circularArc"
          ? resolvedCircularArcGeometry(firstCompositeSegment!)!.radius
          : resolvedPathSegmentLength(firstCompositeSegment!);
  const normal = numericPlaneBasis(profile.plane).n;
  const cross: Vec3 = [
    normal[1] * tangent[2] - normal[2] * tangent[1],
    normal[2] * tangent[0] - normal[0] * tangent[2],
    normal[0] * tangent[1] - normal[1] * tangent[0],
  ];
  if (Math.hypot(...cross) * tangentScale > tolerance) {
    return {
      reason: "profile-tangent-mismatch",
      message: "Sweep profile plane must be normal to the initial path tangent",
      input: "profile",
      segmentIndex: 0,
    };
  }
  const radius = profileRadius(profile);
  if (path.kind === "polyline") {
    const clearance = radius * 2 + tolerance;
    for (let first = 0; first < path.points.length - 1; first += 1) {
      for (let second = first + 2; second < path.points.length - 1; second += 1) {
        if (
          resolvedPolylineSegmentDistance(
            path.points[first]!,
            path.points[first + 1]!,
            path.points[second]!,
            path.points[second + 1]!,
          ) <= clearance
        ) {
          return {
            reason: "path-clearance",
            message:
              "Non-adjacent sweep path segments are too close for the profile envelope",
            input: "path",
            segmentIndex: second,
            otherSegmentIndex: first,
          };
        }
      }
    }
  } else if (path.kind === "circularArc") {
    const geometry = resolvedCircularArcGeometry(path)!;
    if (!(geometry.radius > radius + tolerance)) {
      return {
        reason: "path-clearance",
        message:
          "Circular-arc sweep radius must exceed the profile envelope radius",
        input: "path",
        segmentIndex: 0,
      };
    }
  } else {
    const segments = resolvedCompositePathSegments(
      path as ResolvedCompositePath,
    );
    for (const [index, segment] of segments.entries()) {
      if (
        segment.kind === "circularArc" &&
        !(resolvedCircularArcGeometry(segment)!.radius > radius + tolerance)
      ) {
        return {
          reason: "path-clearance",
          message:
            "Every composite circular-arc radius must exceed the profile envelope radius",
          input: "path",
          segmentIndex: index,
        };
      }
    }
    for (let index = 1; index < segments.length; index += 1) {
      const prior = segments[index - 1]!;
      const current = segments[index]!;
      if (prior.kind === "line" && current.kind === "line") continue;
      const priorTangent = resolvedPathSegmentEndTangent(prior);
      const currentTangent = resolvedPathSegmentStartTangent(current);
      const mismatch = Math.hypot(
        priorTangent[1] * currentTangent[2] -
          priorTangent[2] * currentTangent[1],
        priorTangent[2] * currentTangent[0] -
          priorTangent[0] * currentTangent[2],
        priorTangent[0] * currentTangent[1] -
          priorTangent[1] * currentTangent[0],
      );
      if (radius * mismatch > tolerance) {
        return {
          reason: "path-clearance",
          message:
            "Composite arc-junction tangent mismatch exceeds the profile-envelope tolerance",
          input: "path",
          segmentIndex: index,
          otherSegmentIndex: index - 1,
        };
      }
      if (
        !resolvedAdjacentPathSegmentsHaveRemoteClearance(
          prior,
          current,
          radius * 2 + tolerance,
        )
      ) {
        return {
          reason: "path-clearance",
          message:
            "Adjacent composite path segments make an uncertified nonlocal return into the profile envelope",
          input: "path",
          segmentIndex: index,
          otherSegmentIndex: index - 1,
        };
      }
    }
    const clearance = radius * 2 + tolerance;
    for (let first = 0; first < segments.length; first += 1) {
      for (let second = first + 2; second < segments.length; second += 1) {
        if (
          !resolvedPathSegmentsHaveClearance(
            segments[first]!,
            segments[second]!,
            clearance,
          )
        ) {
          return {
            reason: "path-clearance",
            message:
              "Non-adjacent composite path segments are too close for the profile envelope or cannot be certified clear",
            input: "path",
            segmentIndex: second,
            otherSegmentIndex: first,
          };
        }
      }
    }
  }
  return undefined;
}
