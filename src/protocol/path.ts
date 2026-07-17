import type { Vec3 } from "../core/math.js";

export interface ResolvedPolylinePath {
  readonly kind: "polyline";
  /** Ordered vertices of one open 3D polyline. */
  readonly points: readonly Vec3[];
  readonly closed: false;
}

export interface ResolvedCircularArcPath {
  readonly kind: "circularArc";
  readonly start: Vec3;
  /** Authored interior point selecting the oriented arc from start to end. */
  readonly through: Vec3;
  readonly end: Vec3;
  readonly closed: false;
}

export type ResolvedPath = ResolvedPolylinePath | ResolvedCircularArcPath;

export interface ResolvedCircularArcGeometry {
  readonly center: Vec3;
  readonly normal: Vec3;
  readonly radius: number;
  /** Oriented selected sweep in radians; conceptually below one full turn. */
  readonly sweep: number;
  readonly length: number;
  /** Complementary end-to-start gap, computed directly to avoid 2π cancellation. */
  readonly closingSweep: number;
  readonly closingLength: number;
  readonly startTangent: Vec3;
}

/** Minimum sine of an authored polyline corner retained as a distinct vertex. */
export const POLYLINE_PATH_MIN_CORNER_SINE = 1e-10;
/** Minimum scale-independent sine between the three authored arc points. */
export const CIRCULAR_ARC_PATH_MIN_POINT_SINE = 1e-10;

export type PathValidationReason =
  | "invalid-tolerance"
  | "point-count"
  | "non-finite-point"
  | "degenerate-segment"
  | "duplicate-point"
  | "closed-path"
  | "collinear-segments"
  | "collinear-arc-points"
  | "degenerate-arc"
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

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(value: Vec3): number {
  return Math.hypot(...value);
}

function orientedAngle(from: Vec3, to: Vec3, normal: Vec3): number {
  const angle = Math.atan2(dot(normal, cross(from, to)), dot(from, to));
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

/** Resolves the exact oriented circle selected by three valid authored points. */
export function resolvedCircularArcGeometry(
  path: ResolvedCircularArcPath,
): ResolvedCircularArcGeometry | undefined {
  const startToThrough = subtract(path.through, path.start);
  const startToEnd = subtract(path.end, path.start);
  const planeNormal = cross(startToThrough, startToEnd);
  const normalSquared = dot(planeNormal, planeNormal);
  if (!Number.isFinite(normalSquared) || !(normalSquared > 0)) return undefined;

  const throughSquared = dot(startToThrough, startToThrough);
  const endSquared = dot(startToEnd, startToEnd);
  const centerOffset = scale(
    add(
      scale(cross(startToEnd, planeNormal), throughSquared),
      scale(cross(planeNormal, startToThrough), endSquared),
    ),
    1 / (2 * normalSquared),
  );
  const center = add(path.start, centerOffset);
  const normal = scale(planeNormal, 1 / Math.sqrt(normalSquared));
  const startRadius = subtract(path.start, center);
  const throughRadius = subtract(path.through, center);
  const endRadius = subtract(path.end, center);
  const radius = length(startRadius);
  const sweep =
    orientedAngle(startRadius, throughRadius, normal) +
    orientedAngle(throughRadius, endRadius, normal);
  const arcLength = radius * sweep;
  const closingSweep = orientedAngle(endRadius, startRadius, normal);
  const closingLength = radius * closingSweep;
  const startTangent = scale(cross(normal, startRadius), 1 / radius);
  if (
    center.some((component) => !Number.isFinite(component)) ||
    normal.some((component) => !Number.isFinite(component)) ||
    startTangent.some((component) => !Number.isFinite(component)) ||
    !Number.isFinite(radius) ||
    !Number.isFinite(sweep) ||
    !Number.isFinite(arcLength) ||
    !Number.isFinite(closingSweep) ||
    !Number.isFinite(closingLength)
  ) {
    return undefined;
  }
  return {
    center,
    normal,
    radius,
    sweep,
    length: arcLength,
    closingSweep,
    closingLength,
    startTangent,
  };
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

/** Checks the document-v1 exact open three-point circular-arc contract. */
export function validateResolvedCircularArcPath(
  path: ResolvedCircularArcPath,
  tolerance: number,
): PathValidationIssue | undefined {
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    return {
      reason: "invalid-tolerance",
      message: "Path tolerance must be finite and positive",
    };
  }
  if (path.closed !== false) {
    return {
      reason: "closed-path",
      message: "Document v1 circular-arc paths must be open",
    };
  }
  const points = [path.start, path.through, path.end] as const;
  for (const [index, point] of points.entries()) {
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
  if (distance(path.start, path.end) <= tolerance) {
    return {
      reason: "closed-path",
      message: "A circular-arc path requires distinct open endpoints",
      pointIndex: 2,
    };
  }
  if (distance(path.start, path.through) <= tolerance) {
    return {
      reason: "duplicate-point",
      message: "Circular-arc through point duplicates its start point",
      pointIndex: 1,
    };
  }
  if (distance(path.through, path.end) <= tolerance) {
    return {
      reason: "duplicate-point",
      message: "Circular-arc through point duplicates its end point",
      pointIndex: 1,
    };
  }

  const startToThrough = subtract(path.through, path.start);
  const startToEnd = subtract(path.end, path.start);
  const planeNormalLength = length(cross(startToThrough, startToEnd));
  const sine =
    planeNormalLength / (length(startToThrough) * length(startToEnd));
  const authoredHeight = planeNormalLength / length(startToEnd);
  if (
    !Number.isFinite(sine) ||
    !(sine > CIRCULAR_ARC_PATH_MIN_POINT_SINE) ||
    !Number.isFinite(authoredHeight) ||
    !(authoredHeight > tolerance)
  ) {
    return {
      reason: "collinear-arc-points",
      message:
        "Circular-arc start, through, and end points must define a stable plane",
      pointIndex: 1,
    };
  }

  const geometry = resolvedCircularArcGeometry(path);
  if (
    geometry === undefined ||
    !(geometry.radius > tolerance) ||
    !(geometry.sweep > 0) ||
    !(geometry.length > tolerance) ||
    !(geometry.closingSweep > 0) ||
    !(geometry.closingLength > tolerance)
  ) {
    return {
      reason: "degenerate-arc",
      message:
        "Circular-arc path must resolve to one finite open arc below a full turn",
    };
  }
  return undefined;
}

/** Checks the concrete contract for any document-v1 path representation. */
export function validateResolvedPath(
  path: ResolvedPath,
  tolerance: number,
): PathValidationIssue | undefined {
  switch (path.kind) {
    case "polyline":
      return validateResolvedPolylinePath(path, tolerance);
    case "circularArc":
      return validateResolvedCircularArcPath(path, tolerance);
  }
}

export function resolvedPathStart(path: ResolvedPath): Vec3 {
  return path.kind === "polyline" ? path.points[0]! : path.start;
}

/** Unit tangent in the authored traversal direction at the open path start. */
export function resolvedPathInitialTangent(path: ResolvedPath): Vec3 {
  if (path.kind === "polyline") {
    const tangent = segment(path, 0);
    return scale(tangent, 1 / length(tangent));
  }
  return resolvedCircularArcGeometry(path)!.startTangent;
}

export function resolvedPathEdgeCount(path: ResolvedPath): number {
  return path.kind === "polyline" ? path.points.length - 1 : 1;
}
