import type { Vec2, Vec3 } from "../core/math.js";
import {
  curveStart,
  resolvedLoopIsClosed,
  type ResolvedArcCurve,
  type ResolvedCurve,
  type ResolvedLoop,
  type ResolvedProfile,
} from "./profile.js";
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

function planeNormal(profile: ResolvedProfile): Vec3 {
  switch (profile.plane.plane) {
    case "XY":
      return [0, 0, 1];
    case "XZ":
      return [0, -1, 0];
    case "YZ":
      return [1, 0, 0];
  }
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function arcSweep(curve: ResolvedArcCurve): number {
  let sweep = curve.endAngle - curve.startAngle;
  if (curve.clockwise && sweep > 0) sweep -= Math.PI * 2;
  if (!curve.clockwise && sweep < 0) sweep += Math.PI * 2;
  return sweep;
}

function curveIsFinite(curve: ResolvedCurve, tolerance: number): boolean {
  switch (curve.kind) {
    case "line":
      return (
        finitePoint(curve.start) &&
        finitePoint(curve.end) &&
        Math.hypot(
          curve.end[0] - curve.start[0],
          curve.end[1] - curve.start[1],
        ) > tolerance
      );
    case "arc": {
      const sweep = Math.abs(arcSweep(curve));
      return (
        finitePoint(curve.center) &&
        Number.isFinite(curve.radius) &&
        curve.radius > tolerance &&
        Number.isFinite(curve.startAngle) &&
        Number.isFinite(curve.endAngle) &&
        curve.radius * sweep > tolerance &&
        curve.radius * (Math.PI * 2 - sweep) > tolerance
      );
    }
    case "circle":
      return (
        finitePoint(curve.center) &&
        Number.isFinite(curve.radius) &&
        curve.radius > tolerance
      );
  }
}

function curveSignedArea(curve: ResolvedCurve, reference: Vec2): number {
  switch (curve.kind) {
    case "line":
      return (
        ((curve.start[0] - reference[0]) *
          (curve.end[1] - reference[1]) -
          (curve.end[0] - reference[0]) *
            (curve.start[1] - reference[1])) /
        2
      );
    case "arc": {
      const sweep = arcSweep(curve);
      const start = curve.startAngle;
      const end = start + sweep;
      return (
        (curve.radius *
          ((curve.center[0] - reference[0]) *
            (Math.sin(end) - Math.sin(start)) -
            (curve.center[1] - reference[1]) *
              (Math.cos(end) - Math.cos(start))) +
          curve.radius ** 2 * sweep) /
        2
      );
    }
    case "circle":
      return Math.PI * curve.radius ** 2 * (curve.reversed ? -1 : 1);
  }
}

function loopSignedArea(loop: ResolvedLoop): number {
  const reference = curveStart(loop.curves[0]!);
  return loop.curves.reduce(
    (area, curve) => area + curveSignedArea(curve, reference),
    0,
  );
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
    profile.outer.curves.some((curve) => !curveIsFinite(curve, tolerance))
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
  const area = loopSignedArea(profile.outer);
  if (!Number.isFinite(area) || !(Math.abs(area) > tolerance ** 2)) {
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
  const normal = planeNormal(profile);
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
