import type { EntityId } from "../core/ids.js";
import { distance2, type Vec2, type Vec3 } from "../core/math.js";

export interface NumericPlane {
  readonly plane: "XY" | "XZ" | "YZ";
  readonly origin: readonly [number, number, number];
}

export interface NumericPlaneBasis {
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

export interface ProfileCurveSource {
  readonly kind: "sketch-entity";
  readonly sketch: string;
  readonly entity: EntityId;
}

interface ResolvedCurveBase {
  readonly source?: ProfileCurveSource;
}

export interface ResolvedLineCurve extends ResolvedCurveBase {
  readonly kind: "line";
  readonly start: Vec2;
  readonly end: Vec2;
}

export interface ResolvedArcCurve extends ResolvedCurveBase {
  readonly kind: "arc";
  readonly center: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly clockwise: boolean;
  readonly segments?: number;
}

export interface ResolvedCircleCurve extends ResolvedCurveBase {
  readonly kind: "circle";
  readonly center: Vec2;
  readonly radius: number;
  readonly reversed: boolean;
  readonly segments?: number;
}

export type ResolvedCurve =
  | ResolvedLineCurve
  | ResolvedArcCurve
  | ResolvedCircleCurve;

export interface ResolvedLoop {
  readonly curves: readonly ResolvedCurve[];
}

export interface ResolvedProfile {
  readonly outer: ResolvedLoop;
  readonly holes: readonly ResolvedLoop[];
  readonly plane: NumericPlane;
}

/** @deprecated Use ResolvedProfile. */
export type NumericProfile = ResolvedProfile;

export interface TessellatedProfile {
  readonly contours: readonly (readonly Vec2[])[];
  readonly plane: NumericPlane;
}

/** Returns the signed authored traversal; curve validation bounds it below one turn. */
export function resolvedArcSweep(curve: ResolvedArcCurve): number {
  let sweep = curve.endAngle - curve.startAngle;
  if (curve.clockwise && sweep > 0) sweep -= Math.PI * 2;
  if (!curve.clockwise && sweep < 0) sweep += Math.PI * 2;
  return sweep;
}

/** The right-handed world basis of a principal numeric sketch plane. */
export function numericPlaneBasis(plane: NumericPlane): NumericPlaneBasis {
  switch (plane.plane) {
    case "XY":
      return { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
    case "XZ":
      return { u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] };
    case "YZ":
      return { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] };
  }
}

/** Lifts one sketch-local point into its principal plane in world space. */
export function pointOnNumericPlane(point: Vec2, plane: NumericPlane): Vec3 {
  const { u, v } = numericPlaneBasis(plane);
  return [
    plane.origin[0] + point[0] * u[0] + point[1] * v[0],
    plane.origin[1] + point[0] * u[1] + point[1] * v[1],
    plane.origin[2] + point[0] * u[2] + point[1] * v[2],
  ];
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

/** Checks the shared finite, tolerance-bounded analytic curve contract. */
export function resolvedCurveIsFinite(
  curve: ResolvedCurve,
  tolerance: number,
): boolean {
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) return false;
  switch (curve.kind) {
    case "line": {
      const length = distance2(curve.start, curve.end);
      return (
        finitePoint(curve.start) &&
        finitePoint(curve.end) &&
        Number.isFinite(length) &&
        length > tolerance
      );
    }
    case "arc": {
      const sweep = Math.abs(resolvedArcSweep(curve));
      const length = curve.radius * sweep;
      const complementLength = curve.radius * (Math.PI * 2 - sweep);
      return (
        finitePoint(curve.center) &&
        Number.isFinite(curve.radius) &&
        curve.radius > tolerance &&
        Number.isFinite(curve.startAngle) &&
        Number.isFinite(curve.endAngle) &&
        Number.isFinite(sweep) &&
        sweep > 0 &&
        sweep < Math.PI * 2 &&
        Number.isFinite(length) &&
        length > tolerance &&
        Number.isFinite(complementLength) &&
        complementLength > tolerance
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

export function curveStart(curve: ResolvedCurve): Vec2 {
  switch (curve.kind) {
    case "line":
      return curve.start;
    case "arc":
      return [
        curve.center[0] + curve.radius * Math.cos(curve.startAngle),
        curve.center[1] + curve.radius * Math.sin(curve.startAngle),
      ];
    case "circle":
      return [curve.center[0] + curve.radius, curve.center[1]];
  }
}

export function curveEnd(curve: ResolvedCurve): Vec2 {
  switch (curve.kind) {
    case "line":
      return curve.end;
    case "arc":
      return [
        curve.center[0] + curve.radius * Math.cos(curve.endAngle),
        curve.center[1] + curve.radius * Math.sin(curve.endAngle),
      ];
    case "circle":
      return curveStart(curve);
  }
}

export function resolvedLoopIsClosed(
  loop: ResolvedLoop,
  tolerance: number,
): boolean {
  if (loop.curves.length === 0) return false;
  if (loop.curves.length === 1 && loop.curves[0]!.kind === "circle") return true;
  if (loop.curves.some((curve) => curve.kind === "circle")) return false;
  for (let index = 0; index < loop.curves.length; index += 1) {
    const current = loop.curves[index]!;
    const next = loop.curves[(index + 1) % loop.curves.length]!;
    if (distance2(curveEnd(current), curveStart(next)) > tolerance) return false;
  }
  return true;
}

function tessellateCurve(curve: ResolvedCurve): readonly Vec2[] {
  switch (curve.kind) {
    case "line":
      return [curve.start, curve.end];
    case "arc": {
      const sweep = resolvedArcSweep(curve);
      const segments =
        curve.segments ??
        Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 24)));
      return Array.from({ length: segments + 1 }, (_, index): Vec2 => {
        const angle = curve.startAngle + (sweep * index) / segments;
        return [
          curve.center[0] + curve.radius * Math.cos(angle),
          curve.center[1] + curve.radius * Math.sin(angle),
        ];
      });
    }
    case "circle": {
      const segments = curve.segments ?? 64;
      const direction = curve.reversed ? -1 : 1;
      return Array.from({ length: segments }, (_, index): Vec2 => {
        const angle = (direction * Math.PI * 2 * index) / segments;
        return [
          curve.center[0] + curve.radius * Math.cos(angle),
          curve.center[1] + curve.radius * Math.sin(angle),
        ];
      });
    }
  }
}

export function tessellateResolvedLoop(
  loop: ResolvedLoop,
  tolerance = 1e-9,
): readonly Vec2[] {
  if (loop.curves.length === 1 && loop.curves[0]!.kind === "circle") {
    return tessellateCurve(loop.curves[0]!);
  }
  const points: Vec2[] = [];
  for (const curve of loop.curves) {
    const tessellated = tessellateCurve(curve);
    if (points.length === 0) {
      points.push(...tessellated);
    } else if (distance2(points.at(-1)!, tessellated[0]!) <= tolerance) {
      points.push(...tessellated.slice(1));
    } else {
      points.push(...tessellated);
    }
  }
  if (
    points.length > 1 &&
    distance2(points[0]!, points.at(-1)!) <= tolerance
  ) {
    points.pop();
  }
  return points;
}

export function tessellateProfile(
  profile: ResolvedProfile,
  tolerance = 1e-9,
): TessellatedProfile {
  return {
    plane: profile.plane,
    contours: [
      tessellateResolvedLoop(profile.outer, tolerance),
      ...profile.holes.map((hole) =>
        tessellateResolvedLoop(hole, tolerance),
      ),
    ],
  };
}
