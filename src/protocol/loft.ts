import {
  resolvedCurveIsFinite,
  resolvedLoopIsClosed,
  type NumericPlane,
  type ResolvedCurve,
  type ResolvedProfile,
} from "./profile.js";
import { resolvedLoopSignedArea } from "./profile-moments.js";

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
      profile.outer.curves.some(
        (curve) => !resolvedCurveIsFinite(curve, tolerance),
      )
    ) {
      return {
        message: `Loft profile ${index} contains a degenerate or non-finite curve`,
        path: profilePath,
        reason: "degenerate-profile",
        profileIndex: index,
      };
    }

    const area = resolvedLoopSignedArea(profile.outer, tolerance);
    if (!area.ok) {
      return {
        message: `Loft profile ${index} must enclose nonzero finite area`,
        path: profilePath,
        reason: "degenerate-profile",
        profileIndex: index,
      };
    }
    const profileOrientation = Math.sign(area.signedArea);
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
