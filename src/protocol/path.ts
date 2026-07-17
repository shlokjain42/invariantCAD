import type { Vec3 } from "../core/math.js";

export interface ResolvedPolylinePath {
  readonly kind: "polyline";
  /** Ordered vertices of one open 3D polyline. */
  readonly points: readonly Vec3[];
  readonly closed: false;
}

export interface ResolvedCircularArcDefinition {
  readonly start: Vec3;
  /** Authored interior point selecting the oriented arc from start to end. */
  readonly through: Vec3;
  readonly end: Vec3;
}

export interface ResolvedCircularArcPath
  extends ResolvedCircularArcDefinition {
  readonly kind: "circularArc";
  readonly closed: false;
}

export interface ResolvedCompositeLinePathSegment {
  readonly kind: "line";
  readonly end: Vec3;
}

export interface ResolvedCompositeCircularArcPathSegment {
  readonly kind: "circularArc";
  readonly through: Vec3;
  readonly end: Vec3;
}

export type ResolvedCompositePathSegment =
  | ResolvedCompositeLinePathSegment
  | ResolvedCompositeCircularArcPathSegment;

export interface ResolvedCompositePath {
  readonly kind: "composite";
  readonly start: Vec3;
  readonly segments: readonly ResolvedCompositePathSegment[];
  readonly closed: false;
}

export interface ResolvedLinePathSegment {
  readonly kind: "line";
  readonly start: Vec3;
  readonly end: Vec3;
}

export interface ResolvedCircularArcPathSegment
  extends ResolvedCircularArcDefinition {
  readonly kind: "circularArc";
}

export type ResolvedPathSegment =
  | ResolvedLinePathSegment
  | ResolvedCircularArcPathSegment;

export type ResolvedPath =
  | ResolvedPolylinePath
  | ResolvedCircularArcPath
  | ResolvedCompositePath;

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
  readonly endTangent: Vec3;
}

/** Minimum sine of an authored polyline corner retained as a distinct vertex. */
export const POLYLINE_PATH_MIN_CORNER_SINE = 1e-10;
/** Minimum scale-independent sine between the three authored arc points. */
export const CIRCULAR_ARC_PATH_MIN_POINT_SINE = 1e-10;
/** Maximum scale-independent tangent mismatch at an arc-bearing junction. */
export const COMPOSITE_PATH_MAX_JUNCTION_SINE = 1e-8;

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
  | "segment-count"
  | "line-only-composite"
  | "major-arc-unsupported"
  | "non-tangent-junction"
  | "redundant-segments"
  | "adjacent-arc-reach"
  | "uncertified-clearance"
  | "self-intersection";

export interface PathValidationIssue {
  readonly reason: PathValidationReason;
  readonly message: string;
  readonly pointIndex?: number;
  readonly segmentIndex?: number;
  readonly otherSegmentIndex?: number;
  readonly pointRole?: "start" | "through" | "end";
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
  path: ResolvedCircularArcDefinition,
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
  const endTangent = scale(cross(normal, endRadius), 1 / radius);
  if (
    center.some((component) => !Number.isFinite(component)) ||
    normal.some((component) => !Number.isFinite(component)) ||
    startTangent.some((component) => !Number.isFinite(component)) ||
    endTangent.some((component) => !Number.isFinite(component)) ||
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
    endTangent,
  };
}

export function resolvedPolylineSegmentDistance(
  firstStart: Vec3,
  firstEnd: Vec3,
  secondStart: Vec3,
  secondEnd: Vec3,
): number {
  const coordinateScale = Math.max(
    1,
    ...firstStart.map(Math.abs),
    ...firstEnd.map(Math.abs),
    ...secondStart.map(Math.abs),
    ...secondEnd.map(Math.abs),
  );
  if (!Number.isFinite(coordinateScale)) return 0;
  const inverseScale = 1 / coordinateScale;
  const normalizedFirstStart = scale(firstStart, inverseScale);
  const normalizedFirstEnd = scale(firstEnd, inverseScale);
  const normalizedSecondStart = scale(secondStart, inverseScale);
  const normalizedSecondEnd = scale(secondEnd, inverseScale);
  const first: Vec3 = [
    normalizedFirstEnd[0] - normalizedFirstStart[0],
    normalizedFirstEnd[1] - normalizedFirstStart[1],
    normalizedFirstEnd[2] - normalizedFirstStart[2],
  ];
  const second: Vec3 = [
    normalizedSecondEnd[0] - normalizedSecondStart[0],
    normalizedSecondEnd[1] - normalizedSecondStart[1],
    normalizedSecondEnd[2] - normalizedSecondStart[2],
  ];
  const offset: Vec3 = [
    normalizedFirstStart[0] - normalizedSecondStart[0],
    normalizedFirstStart[1] - normalizedSecondStart[1],
    normalizedFirstStart[2] - normalizedSecondStart[2],
  ];
  const normal = cross(first, second);
  const denominator = dot(normal, normal);
  const pointSegmentDistance = (
    point: Vec3,
    start: Vec3,
    end: Vec3,
  ): number => {
    const direction = subtract(end, start);
    const squaredLength = dot(direction, direction);
    if (!(squaredLength > 0)) return distance(point, start);
    const parameter = Math.min(
      1,
      Math.max(0, dot(subtract(point, start), direction) / squaredLength),
    );
    return distance(point, add(start, scale(direction, parameter)));
  };
  let minimum = Math.min(
    pointSegmentDistance(
      normalizedFirstStart,
      normalizedSecondStart,
      normalizedSecondEnd,
    ),
    pointSegmentDistance(
      normalizedFirstEnd,
      normalizedSecondStart,
      normalizedSecondEnd,
    ),
    pointSegmentDistance(
      normalizedSecondStart,
      normalizedFirstStart,
      normalizedFirstEnd,
    ),
    pointSegmentDistance(
      normalizedSecondEnd,
      normalizedFirstStart,
      normalizedFirstEnd,
    ),
  );
  if (denominator > 0 && Number.isFinite(denominator)) {
    const firstParameter = dot(cross(second, offset), normal) / denominator;
    const secondParameter = dot(cross(first, offset), normal) / denominator;
    if (
      firstParameter >= 0 &&
      firstParameter <= 1 &&
      secondParameter >= 0 &&
      secondParameter <= 1
    ) {
      minimum = Math.min(
        minimum,
        Math.hypot(
          offset[0] + firstParameter * first[0] - secondParameter * second[0],
          offset[1] + firstParameter * first[1] - secondParameter * second[1],
          offset[2] + firstParameter * first[2] - secondParameter * second[2],
        ),
      );
    }
  }
  const resolvedDistance = minimum * coordinateScale;
  return Number.isFinite(resolvedDistance) ? resolvedDistance : 0;
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
    const segmentLength = distance(
      path.points[index]!,
      path.points[index + 1]!,
    );
    if (!Number.isFinite(segmentLength) || !(segmentLength > tolerance)) {
      return {
        reason: "degenerate-segment",
        message: `Path segment ${index} must have finite positive length`,
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

/** Expands structurally connected composite segments into explicit exact starts. */
export function resolvedCompositePathSegments(
  path: ResolvedCompositePath,
): readonly ResolvedPathSegment[] {
  const resolved: ResolvedPathSegment[] = [];
  let start = path.start;
  for (const segment of path.segments) {
    if (segment.kind === "line") {
      resolved.push({ kind: "line", start, end: segment.end });
    } else {
      resolved.push({
        kind: "circularArc",
        start,
        through: segment.through,
        end: segment.end,
      });
    }
    start = segment.end;
  }
  return resolved;
}

export function resolvedPathSegmentLength(
  segment: ResolvedPathSegment,
): number {
  return segment.kind === "line"
    ? distance(segment.start, segment.end)
    : (resolvedCircularArcGeometry(segment)?.length ?? Number.NaN);
}

export function resolvedPathSegmentStartTangent(
  segment: ResolvedPathSegment,
): Vec3 {
  if (segment.kind === "line") {
    const direction = subtract(segment.end, segment.start);
    return scale(direction, 1 / length(direction));
  }
  return resolvedCircularArcGeometry(segment)!.startTangent;
}

export function resolvedPathSegmentEndTangent(
  segment: ResolvedPathSegment,
): Vec3 {
  if (segment.kind === "line") {
    return resolvedPathSegmentStartTangent(segment);
  }
  return resolvedCircularArcGeometry(segment)!.endTangent;
}

interface CertifiedCurvePiece {
  readonly kind: "line" | "circularArc";
  readonly segment: ResolvedPathSegment;
  readonly from: number;
  readonly to: number;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly deviation: number;
  readonly depth: number;
}

function arcPoint(
  segment: ResolvedCircularArcPathSegment,
  parameter: number,
): Vec3 {
  if (parameter <= 0) return segment.start;
  if (parameter >= 1) return segment.end;
  const geometry = resolvedCircularArcGeometry(segment)!;
  const startRadius = subtract(segment.start, geometry.center);
  const angle = geometry.sweep * parameter;
  const sine = Math.sin(angle);
  const cosineMinusOne = -2 * Math.sin(angle / 2) ** 2;
  return add(
    segment.start,
    add(
      scale(startRadius, cosineMinusOne),
      scale(cross(geometry.normal, startRadius), sine),
    ),
  );
}

function curvePiece(
  segment: ResolvedPathSegment,
  from: number,
  to: number,
  depth: number,
): CertifiedCurvePiece {
  if (segment.kind === "line") {
    return {
      kind: "line",
      segment,
      from: 0,
      to: 1,
      start: segment.start,
      end: segment.end,
      deviation: 0,
      depth,
    };
  }
  const geometry = resolvedCircularArcGeometry(segment)!;
  const angularSpan = geometry.sweep * (to - from);
  return {
    kind: "circularArc",
    segment,
    from,
    to,
    start: arcPoint(segment, from),
    end: arcPoint(segment, to),
    deviation: 2 * geometry.radius * Math.sin(angularSpan / 4) ** 2,
    depth,
  };
}

function initialCurvePieces(
  segment: ResolvedPathSegment,
): readonly CertifiedCurvePiece[] {
  if (segment.kind === "line") return [curvePiece(segment, 0, 1, 0)];
  const geometry = resolvedCircularArcGeometry(segment)!;
  const count = Math.max(1, Math.ceil(geometry.sweep / (Math.PI / 2)));
  return Array.from({ length: count }, (_, index) =>
    curvePiece(segment, index / count, (index + 1) / count, 0),
  );
}

function subdivideCurvePiece(
  piece: CertifiedCurvePiece,
): readonly [CertifiedCurvePiece, CertifiedCurvePiece] | undefined {
  if (piece.kind !== "circularArc") return undefined;
  const midpoint = (piece.from + piece.to) / 2;
  return [
    curvePiece(piece.segment, piece.from, midpoint, piece.depth + 1),
    curvePiece(piece.segment, midpoint, piece.to, piece.depth + 1),
  ];
}

/**
 * Certifies a strict lower distance between two exact line/arc segments.
 *
 * Arc pieces are bounded by their chord plus the exact circular sagitta. An
 * unresolved floating-point threshold case fails closed instead of sampling.
 */
type PathClearanceCertification = "clear" | "blocked" | "uncertain";

function certifyResolvedPathSegmentClearance(
  first: ResolvedPathSegment,
  second: ResolvedPathSegment,
  clearance: number,
): PathClearanceCertification {
  if (!Number.isFinite(clearance) || clearance < 0) return "uncertain";
  const pending: Array<readonly [CertifiedCurvePiece, CertifiedCurvePiece]> = [];
  for (const firstPiece of initialCurvePieces(first)) {
    for (const secondPiece of initialCurvePieces(second)) {
      pending.push([firstPiece, secondPiece]);
    }
  }
  let work = 0;
  while (pending.length > 0) {
    work += 1;
    if (work > 32_768) return "uncertain";
    const [firstPiece, secondPiece] = pending.pop()!;
    const chordDistance = resolvedPolylineSegmentDistance(
      firstPiece.start,
      firstPiece.end,
      secondPiece.start,
      secondPiece.end,
    );
    const numericScale = Math.max(
      1,
      clearance,
      ...firstPiece.start.map(Math.abs),
      ...firstPiece.end.map(Math.abs),
      ...secondPiece.start.map(Math.abs),
      ...secondPiece.end.map(Math.abs),
      firstPiece.deviation,
      secondPiece.deviation,
      ...(firstPiece.segment.kind === "circularArc"
        ? [
            resolvedCircularArcGeometry(firstPiece.segment)!.radius,
            ...resolvedCircularArcGeometry(firstPiece.segment)!.center.map(
              Math.abs,
            ),
            ...firstPiece.segment.start.map(Math.abs),
            ...firstPiece.segment.through.map(Math.abs),
            ...firstPiece.segment.end.map(Math.abs),
          ]
        : []),
      ...(secondPiece.segment.kind === "circularArc"
        ? [
            resolvedCircularArcGeometry(secondPiece.segment)!.radius,
            ...resolvedCircularArcGeometry(secondPiece.segment)!.center.map(
              Math.abs,
            ),
            ...secondPiece.segment.start.map(Math.abs),
            ...secondPiece.segment.through.map(Math.abs),
            ...secondPiece.segment.end.map(Math.abs),
          ]
        : []),
    );
    const numericGuard = Number.EPSILON * numericScale * 256;
    if (
      chordDistance - firstPiece.deviation - secondPiece.deviation -
        numericGuard >
      clearance
    ) {
      continue;
    }
    if (
      chordDistance + firstPiece.deviation + secondPiece.deviation +
        numericGuard <=
      clearance
    ) {
      return "blocked";
    }
    const splitFirst =
      firstPiece.kind === "circularArc" &&
      (secondPiece.kind !== "circularArc" ||
        firstPiece.deviation >= secondPiece.deviation);
    const selectedPiece = splitFirst ? firstPiece : secondPiece;
    if (selectedPiece.depth >= 28) return "uncertain";
    const pieces = subdivideCurvePiece(selectedPiece);
    if (pieces === undefined) return "uncertain";
    for (const piece of pieces) {
      pending.push(
        splitFirst ? [piece, secondPiece] : [firstPiece, piece],
      );
    }
  }
  return "clear";
}

export function resolvedPathSegmentsHaveClearance(
  first: ResolvedPathSegment,
  second: ResolvedPathSegment,
  clearance: number,
): boolean {
  return (
    certifyResolvedPathSegmentClearance(first, second, clearance) === "clear"
  );
}

function sameSupportingCircle(
  first: ResolvedCircularArcPathSegment,
  second: ResolvedCircularArcPathSegment,
  tolerance: number,
): boolean {
  const firstGeometry = resolvedCircularArcGeometry(first)!;
  const secondGeometry = resolvedCircularArcGeometry(second)!;
  return (
    distance(firstGeometry.center, secondGeometry.center) <= tolerance &&
    Math.abs(firstGeometry.radius - secondGeometry.radius) <= tolerance &&
    Math.abs(dot(firstGeometry.normal, secondGeometry.normal)) >=
      1 - COMPOSITE_PATH_MAX_JUNCTION_SINE ** 2
  );
}

/** Checks one open, structurally connected exact line/arc path. */
export function validateResolvedCompositePath(
  path: ResolvedCompositePath,
  tolerance: number,
): PathValidationIssue | undefined {
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    return {
      reason: "invalid-tolerance",
      message: "Path tolerance must be finite and positive",
    };
  }
  if (path.segments.length < 2) {
    return {
      reason: "segment-count",
      message: "A composite path requires at least two ordered segments",
    };
  }
  if (path.closed !== false) {
    return {
      reason: "closed-path",
      message: "Document v1 composite paths must be open",
    };
  }
  if (!path.segments.some((segment) => segment.kind === "circularArc")) {
    return {
      reason: "line-only-composite",
      message:
        "A composite path requires at least one circular-arc segment; use a polyline path for line-only paths",
    };
  }
  if (
    path.start.length !== 3 ||
    path.start.some((component) => !Number.isFinite(component))
  ) {
    return {
      reason: "non-finite-point",
      message: "Composite path start must contain three finite coordinates",
      pointIndex: 0,
      pointRole: "start",
    };
  }
  const segments = resolvedCompositePathSegments(path);
  for (const [index, segment] of segments.entries()) {
    if (
      segment.end.length !== 3 ||
      segment.end.some((component) => !Number.isFinite(component))
    ) {
      return {
        reason: "non-finite-point",
        message: `Composite path segment ${index} end must contain three finite coordinates`,
        segmentIndex: index,
        pointRole: "end",
      };
    }
    if (segment.kind === "line") {
      const segmentLength = distance(segment.start, segment.end);
      if (!Number.isFinite(segmentLength) || !(segmentLength > tolerance)) {
        return {
          reason: "degenerate-segment",
          message: `Composite path line segment ${index} must have finite positive length`,
          segmentIndex: index,
          pointRole: "end",
        };
      }
      continue;
    }
    const arcIssue = validateResolvedCircularArcPath(
      { ...segment, kind: "circularArc", closed: false },
      tolerance,
    );
    if (arcIssue !== undefined) {
      const { pointIndex, ...translatedIssue } = arcIssue;
      const pointRole =
        pointIndex === undefined
          ? undefined
          : (["start", "through", "end"] as const)[pointIndex];
      return {
        ...translatedIssue,
        segmentIndex: index,
        ...(pointRole === undefined ? {} : { pointRole }),
      };
    }
    if (resolvedCircularArcGeometry(segment)!.sweep > Math.PI + 1e-12) {
      return {
        reason: "major-arc-unsupported",
        message:
          "Composite paths currently require each circular arc to be minor or semicircular",
        segmentIndex: index,
      };
    }
  }
  if (distance(path.start, segments.at(-1)!.end) <= tolerance) {
    return {
      reason: "closed-path",
      message: "Document v1 composite paths must have distinct open endpoints",
      segmentIndex: segments.length - 1,
      pointRole: "end",
    };
  }
  for (let index = 1; index < segments.length; index += 1) {
    const prior = segments[index - 1]!;
    const current = segments[index]!;
    const priorTangent = resolvedPathSegmentEndTangent(prior);
    const currentTangent = resolvedPathSegmentStartTangent(current);
    const tangentSine = length(cross(priorTangent, currentTangent));
    const tangentDot = dot(priorTangent, currentTangent);
    if (prior.kind === "line" && current.kind === "line") {
      if (!(tangentSine > POLYLINE_PATH_MIN_CORNER_SINE)) {
        if (!(tangentDot > 0)) {
          return {
            reason: "non-tangent-junction",
            message: "Composite paths cannot contain a line-line reversal cusp",
            segmentIndex: index,
            otherSegmentIndex: index - 1,
          };
        }
        return {
          reason: "redundant-segments",
          message:
            "Adjacent collinear composite line segments must be represented as one segment",
          segmentIndex: index,
          otherSegmentIndex: index - 1,
        };
      }
      continue;
    }
    if (
      !Number.isFinite(tangentSine) ||
      tangentSine > COMPOSITE_PATH_MAX_JUNCTION_SINE ||
      !(tangentDot > 0)
    ) {
      return {
        reason: "non-tangent-junction",
        message:
          "Every composite junction touching a circular arc must be forward G1 tangent",
        segmentIndex: index,
        otherSegmentIndex: index - 1,
      };
    }
    if (
      prior.kind === "circularArc" &&
      current.kind === "circularArc" &&
      sameSupportingCircle(prior, current, tolerance)
    ) {
      return {
        reason: "redundant-segments",
        message:
          "Adjacent arcs on one supporting circle must be represented as one segment",
        segmentIndex: index,
        otherSegmentIndex: index - 1,
      };
    }
    if (prior.kind === "circularArc" && current.kind === "circularArc") {
      const priorGeometry = resolvedCircularArcGeometry(prior)!;
      const currentGeometry = resolvedCircularArcGeometry(current)!;
      const junctionTurn = Math.atan2(tangentSine, tangentDot);
      // A piecewise-smooth chain with curvature bounded by 1 / min(radius)
      // cannot make a nonlocal return before its accumulated arclength plus
      // junction turn reaches pi at that curvature bound.
      const localReach =
        (Math.PI - junctionTurn) *
        Math.min(priorGeometry.radius, currentGeometry.radius);
      if (priorGeometry.length + currentGeometry.length > localReach) {
        return {
          reason: "adjacent-arc-reach",
          message:
            "Adjacent composite arcs must remain within their certified local-curvature reach",
          segmentIndex: index,
          otherSegmentIndex: index - 1,
        };
      }
    }
  }
  for (let first = 0; first < segments.length; first += 1) {
    for (let second = first + 2; second < segments.length; second += 1) {
      const certification = certifyResolvedPathSegmentClearance(
        segments[first]!,
        segments[second]!,
        tolerance,
      );
      if (certification !== "clear") {
        return {
          reason:
            certification === "blocked"
              ? "self-intersection"
              : "uncertified-clearance",
          message:
            certification === "blocked"
              ? `Composite path segments ${first} and ${second} intersect within tolerance`
              : `Composite path segments ${first} and ${second} cannot be certified disjoint at this numeric scale`,
          segmentIndex: second,
          otherSegmentIndex: first,
        };
      }
    }
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
    case "composite":
      return validateResolvedCompositePath(path, tolerance);
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
  if (path.kind === "composite") {
    return resolvedPathSegmentStartTangent(
      resolvedCompositePathSegments(path)[0]!,
    );
  }
  return resolvedCircularArcGeometry(path)!.startTangent;
}

export function resolvedPathEdgeCount(path: ResolvedPath): number {
  if (path.kind === "polyline") return path.points.length - 1;
  return path.kind === "composite" ? path.segments.length : 1;
}
