import {
  resolvedArcSweep,
  type ResolvedArcCurve,
  type ResolvedCurve,
  type ResolvedProfile,
} from "../protocol/profile.js";

const FULL_TURN = Math.PI * 2;

/** The sketch-local `u` extent of a profile that lies on both sides of its revolve axis. */
export interface RevolveAxisCrossing {
  readonly minimumU: number;
  readonly maximumU: number;
}

function normalizedTurn(angle: number): number {
  const turn = angle % FULL_TURN;
  return turn < 0 ? turn + FULL_TURN : turn;
}

/** Whether an arc's authored traversal passes through the given polar angle. */
function arcReachesAngle(curve: ResolvedArcCurve, angle: number): boolean {
  const sweep = resolvedArcSweep(curve);
  const travelled =
    sweep >= 0
      ? normalizedTurn(angle - curve.startAngle)
      : normalizedTurn(curve.startAngle - angle);
  return travelled <= Math.abs(sweep);
}

function curveExtentU(curve: ResolvedCurve): readonly [number, number] {
  switch (curve.kind) {
    case "line":
      return [
        Math.min(curve.start[0], curve.end[0]),
        Math.max(curve.start[0], curve.end[0]),
      ];
    case "circle":
      return [curve.center[0] - curve.radius, curve.center[0] + curve.radius];
    case "arc": {
      const start = curve.center[0] + curve.radius * Math.cos(curve.startAngle);
      const end = curve.center[0] + curve.radius * Math.cos(curve.endAngle);
      return [
        arcReachesAngle(curve, Math.PI)
          ? curve.center[0] - curve.radius
          : Math.min(start, end),
        arcReachesAngle(curve, 0)
          ? curve.center[0] + curve.radius
          : Math.max(start, end),
      ];
    }
  }
}

/**
 * Finds a resolved profile that lies on both sides of its revolve axis, the
 * sketch plane's local `v` axis through the sketch origin (`u = 0`).
 *
 * The extent is exact for lines, arcs, and circles. A profile may touch the
 * axis, and material within `tolerance` of the far side counts as touching.
 * Kernels disagree on a straddling profile (Manifold silently keeps the
 * positive side, OCCT fails natively), so the evaluator rejects it before any
 * kernel call.
 */
export function revolveAxisCrossing(
  profile: ResolvedProfile,
  tolerance: number,
): RevolveAxisCrossing | undefined {
  let minimumU = Number.POSITIVE_INFINITY;
  let maximumU = Number.NEGATIVE_INFINITY;
  for (const loop of [profile.outer, ...profile.holes]) {
    for (const curve of loop.curves) {
      const [low, high] = curveExtentU(curve);
      minimumU = Math.min(minimumU, low);
      maximumU = Math.max(maximumU, high);
    }
  }
  return minimumU < -tolerance && maximumU > tolerance
    ? { minimumU, maximumU }
    : undefined;
}
