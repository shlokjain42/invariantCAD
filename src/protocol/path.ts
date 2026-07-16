import type { Vec3 } from "../core/math.js";

export interface ResolvedPolylinePath {
  readonly kind: "polyline";
  /** Ordered vertices of one open 3D polyline. */
  readonly points: readonly Vec3[];
  readonly closed: false;
}

export type ResolvedPath = ResolvedPolylinePath;

/** Minimum sine of an authored polyline corner retained as a distinct vertex. */
export const POLYLINE_PATH_MIN_CORNER_SINE = 1e-10;

export type PathValidationReason =
  | "invalid-tolerance"
  | "point-count"
  | "non-finite-point"
  | "degenerate-segment"
  | "duplicate-point"
  | "closed-path"
  | "collinear-segments"
  | "self-intersection";

export interface PathValidationIssue {
  readonly reason: PathValidationReason;
  readonly message: string;
  readonly pointIndex?: number;
  readonly segmentIndex?: number;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function segment(path: ResolvedPolylinePath, index: number): Vec3 {
  const start = path.points[index]!;
  const end = path.points[index + 1]!;
  return [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function resolvedPolylineSegmentDistance(
  firstStart: Vec3,
  firstEnd: Vec3,
  secondStart: Vec3,
  secondEnd: Vec3,
): number {
  const first: Vec3 = [
    firstEnd[0] - firstStart[0],
    firstEnd[1] - firstStart[1],
    firstEnd[2] - firstStart[2],
  ];
  const second: Vec3 = [
    secondEnd[0] - secondStart[0],
    secondEnd[1] - secondStart[1],
    secondEnd[2] - secondStart[2],
  ];
  const offset: Vec3 = [
    firstStart[0] - secondStart[0],
    firstStart[1] - secondStart[1],
    firstStart[2] - secondStart[2],
  ];
  const a = dot(first, first);
  const b = dot(first, second);
  const c = dot(second, second);
  const d = dot(first, offset);
  const e = dot(second, offset);
  const denominator = a * c - b * b;
  let firstParameter = 0;
  let secondParameter = 0;

  if (denominator > Number.EPSILON * a * c) {
    firstParameter = Math.min(1, Math.max(0, (b * e - c * d) / denominator));
  }
  secondParameter = Math.min(1, Math.max(0, (b * firstParameter + e) / c));
  firstParameter = Math.min(1, Math.max(0, (b * secondParameter - d) / a));

  return Math.hypot(
    offset[0] + firstParameter * first[0] - secondParameter * second[0],
    offset[1] + firstParameter * first[1] - secondParameter * second[1],
    offset[2] + firstParameter * first[2] - secondParameter * second[2],
  );
}

/** Checks the document-v1 open, explicitly segmented polyline-path contract. */
export function validateResolvedPolylinePath(
  path: ResolvedPolylinePath,
  tolerance: number,
): PathValidationIssue | undefined {
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    return {
      reason: "invalid-tolerance",
      message: "Path tolerance must be finite and positive",
    };
  }
  if (path.points.length < 2) {
    return {
      reason: "point-count",
      message: "A polyline path requires at least two ordered points",
    };
  }
  if (path.closed !== false) {
    return {
      reason: "closed-path",
      message: "Document v1 polyline paths must be open",
    };
  }
  for (const [index, point] of path.points.entries()) {
    if (
      point.length !== 3 ||
      point.some((component) => !Number.isFinite(component))
    ) {
      return {
        reason: "non-finite-point",
        message: `Path point ${index} must contain three finite coordinates`,
        pointIndex: index,
      };
    }
  }
  for (let index = 0; index < path.points.length - 1; index += 1) {
    if (!(distance(path.points[index]!, path.points[index + 1]!) > tolerance)) {
      return {
        reason: "degenerate-segment",
        message: `Path segment ${index} must have positive length`,
        segmentIndex: index,
        pointIndex: index + 1,
      };
    }
  }
  for (let index = 1; index < path.points.length; index += 1) {
    for (let prior = 0; prior < index - 1; prior += 1) {
      if (distance(path.points[prior]!, path.points[index]!) <= tolerance) {
        const closed = prior === 0 && index === path.points.length - 1;
        return {
          reason: closed ? "closed-path" : "duplicate-point",
          message: closed
            ? "Document v1 polyline paths must be open"
            : `Path point ${index} duplicates point ${prior}`,
          pointIndex: index,
        };
      }
    }
  }
  for (let index = 1; index < path.points.length - 1; index += 1) {
    const first = segment(path, index - 1);
    const second = segment(path, index);
    const cross: Vec3 = [
      first[1] * second[2] - first[2] * second[1],
      first[2] * second[0] - first[0] * second[2],
      first[0] * second[1] - first[1] * second[0],
    ];
    const sine =
      Math.hypot(...cross) /
      (Math.hypot(...first) * Math.hypot(...second));
    if (!(sine > POLYLINE_PATH_MIN_CORNER_SINE)) {
      return {
        reason: "collinear-segments",
        message:
          "Adjacent path segments must form an explicit non-collinear corner",
        pointIndex: index,
        segmentIndex: index,
      };
    }
  }
  for (let first = 0; first < path.points.length - 1; first += 1) {
    for (let second = first + 2; second < path.points.length - 1; second += 1) {
      if (
        resolvedPolylineSegmentDistance(
          path.points[first]!,
          path.points[first + 1]!,
          path.points[second]!,
          path.points[second + 1]!,
        ) <= tolerance
      ) {
        return {
          reason: "self-intersection",
          message: `Path segments ${first} and ${second} intersect`,
          segmentIndex: second,
        };
      }
    }
  }
  return undefined;
}
