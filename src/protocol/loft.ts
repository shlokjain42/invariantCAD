import type { Vec2 } from "../core/math.js";
import {
  curveStart,
  resolvedLoopIsClosed,
  type NumericPlane,
  type ResolvedCurve,
  type ResolvedLoop,
  type ResolvedProfile,
} from "./profile.js";

/** Document v1 lofts connect corresponding section curves with ruled faces. */
export const LOFT_RULED_SEMANTICS = true as const;

export interface ResolvedLoftOptions {
  /** Document v1 supports ruled interpolation only. */
  readonly ruled: typeof LOFT_RULED_SEMANTICS;
}

export interface LoftProfileValidationIssue {
  readonly message: string;
  /** Path relative to the loft node. */
  readonly path: string;
  readonly reason:
    | "invalid-tolerance"
    | "profile-count"
    | "non-finite-profile"
    | "holes-unsupported"
    | "plane-family-mismatch"
    | "degenerate-profile"
    | "orientation-mismatch"
    | "curve-signature-mismatch"
    | "coincident-station"
    | "non-monotonic-stations";
  readonly profileIndex?: number;
  readonly curveIndex?: number;
  readonly expected?: unknown;
  readonly actual?: unknown;
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
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

function arcSweep(curve: Extract<ResolvedCurve, { readonly kind: "arc" }>): number {
  let sweep = curve.endAngle - curve.startAngle;
  if (curve.clockwise && sweep > 0) sweep -= Math.PI * 2;
  if (!curve.clockwise && sweep < 0) sweep += Math.PI * 2;
  return sweep;
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

function normalStation(plane: NumericPlane): number {
  switch (plane.plane) {
    case "XY":
      return plane.origin[2];
    case "XZ":
      return -plane.origin[1];
    case "YZ":
      return plane.origin[0];
  }
}

function directedCurveKind(curve: ResolvedCurve): string {
  switch (curve.kind) {
    case "line":
      return "line";
    case "arc":
      return curve.clockwise ? "arc:clockwise" : "arc:counterclockwise";
    case "circle":
      return curve.reversed ? "circle:reversed" : "circle:forward";
  }
}

/**
 * Checks the deliberately bounded document-v1 ruled-solid loft contract.
 * The returned path is suitable for a node-scoped structured diagnostic.
 */
export function validateRuledSolidLoftProfiles(
  profiles: readonly ResolvedProfile[],
  tolerance: number,
): LoftProfileValidationIssue | undefined {
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    return {
      message: "Loft validation tolerance must be finite and positive",
      path: "profiles",
      reason: "invalid-tolerance",
    };
  }
  if (profiles.length < 2) {
    return {
      message: "Loft requires at least two ordered profiles",
      path: "profiles",
      reason: "profile-count",
    };
  }

  const first = profiles[0]!;
  const firstPlane = first.plane.plane;
  const firstSignature = first.outer.curves.map(directedCurveKind);
  let orientation: number | undefined;
  let priorStation: number | undefined;
  let stationDirection: number | undefined;

  for (const [index, profile] of profiles.entries()) {
    const profilePath = `profiles/${index}`;
    if (
      profile.plane.origin.length !== 3 ||
      profile.plane.origin.some((component) => !Number.isFinite(component))
    ) {
      return {
        message: `Loft profile ${index} must have a finite plane origin`,
        path: profilePath,
        reason: "non-finite-profile",
        profileIndex: index,
      };
    }
    if (profile.plane.plane !== firstPlane) {
      return {
        message: "Loft profiles must use the same principal-plane family",
        path: profilePath,
        reason: "plane-family-mismatch",
        profileIndex: index,
        expected: firstPlane,
        actual: profile.plane.plane,
      };
    }
    if (profile.holes.length !== 0) {
      return {
        message: "Document v1 loft profiles cannot contain holes",
        path: profilePath,
        reason: "holes-unsupported",
        profileIndex: index,
        actual: profile.holes.length,
      };
    }
    if (!resolvedLoopIsClosed(profile.outer, tolerance)) {
      return {
        message: `Loft profile ${index} must contain one closed outer loop`,
        path: profilePath,
        reason: "degenerate-profile",
        profileIndex: index,
      };
    }
    if (
      profile.outer.curves.some((curve) => !curveIsFinite(curve, tolerance))
    ) {
      return {
        message: `Loft profile ${index} contains a degenerate or non-finite curve`,
        path: profilePath,
        reason: "degenerate-profile",
        profileIndex: index,
      };
    }

    const area = loopSignedArea(profile.outer);
    if (!Number.isFinite(area) || !(Math.abs(area) > tolerance ** 2)) {
      return {
        message: `Loft profile ${index} must enclose nonzero finite area`,
        path: profilePath,
        reason: "degenerate-profile",
        profileIndex: index,
      };
    }
    const profileOrientation = Math.sign(area);
    orientation ??= profileOrientation;
    if (profileOrientation !== orientation) {
      return {
        message: "Loft profiles must have matching loop traversal orientation",
        path: profilePath,
        reason: "orientation-mismatch",
        profileIndex: index,
        expected: orientation,
        actual: profileOrientation,
      };
    }

    const signature = profile.outer.curves.map(directedCurveKind);
    const mismatchIndex = signature.findIndex(
      (kind, curveIndex) => kind !== firstSignature[curveIndex],
    );
    if (signature.length !== firstSignature.length || mismatchIndex !== -1) {
      const curveIndex =
        mismatchIndex === -1
          ? Math.min(signature.length, firstSignature.length)
          : mismatchIndex;
      return {
        message:
          "Loft profiles must have matching ordered curve kinds and directions",
        path: profilePath,
        reason: "curve-signature-mismatch",
        profileIndex: index,
        curveIndex,
        expected: firstSignature[curveIndex],
        actual: signature[curveIndex],
      };
    }

    const station = normalStation(profile.plane);
    if (priorStation !== undefined) {
      const delta = station - priorStation;
      if (!(Math.abs(delta) > tolerance)) {
        return {
          message: "Adjacent loft profiles must occupy distinct stations",
          path: profilePath,
          reason: "coincident-station",
          profileIndex: index,
        };
      }
      stationDirection ??= Math.sign(delta);
      if (Math.sign(delta) !== stationDirection) {
        return {
          message: "Loft profile stations must be strictly monotonic",
          path: profilePath,
          reason: "non-monotonic-stations",
          profileIndex: index,
        };
      }
    }
    priorStation = station;
  }
  return undefined;
}
