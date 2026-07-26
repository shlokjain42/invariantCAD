import type { Vec2 } from "../core/math.js";
import { distance2 } from "../core/math.js";
import {
  resolvedArcSweep,
  type ResolvedCurve,
} from "../protocol/profile.js";

export interface AllowedJunction {
  readonly firstParameter: 0 | 1;
  readonly secondParameter: 0 | 1;
}

export type AdjacentContactCertification =
  | "clear"
  | "blocked"
  | "uncertain";

const FULL_TURN = Math.PI * 2;
const NUMERIC_GUARD_FACTOR = 256;

function subtractPoint(point: Vec2, anchor: Vec2): Vec2 {
  return [point[0] - anchor[0], point[1] - anchor[1]];
}

function curveAnchor(curve: ResolvedCurve): Vec2 {
  return curve.kind === "line" ? curve.start : curve.center;
}

function translatedCurve(
  curve: ResolvedCurve,
  anchor: Vec2,
): ResolvedCurve {
  switch (curve.kind) {
    case "line":
      return {
        kind: "line",
        start: subtractPoint(curve.start, anchor),
        end: subtractPoint(curve.end, anchor),
      };
    case "arc":
      return {
        kind: "arc",
        center: subtractPoint(curve.center, anchor),
        radius: curve.radius,
        startAngle: curve.startAngle,
        endAngle: curve.endAngle,
        clockwise: curve.clockwise,
      };
    case "circle":
      return {
        kind: "circle",
        center: subtractPoint(curve.center, anchor),
        radius: curve.radius,
        reversed: curve.reversed,
      };
  }
}

function curveEndpoint(
  curve: ResolvedCurve,
  parameter: 0 | 1,
): Vec2 {
  switch (curve.kind) {
    case "line":
      return parameter === 0 ? curve.start : curve.end;
    case "arc": {
      const angle =
        parameter === 0 ? curve.startAngle : curve.endAngle;
      return [
        curve.center[0] + curve.radius * Math.cos(angle),
        curve.center[1] + curve.radius * Math.sin(angle),
      ];
    }
    case "circle":
      return [curve.center[0] + curve.radius, curve.center[1]];
  }
}

function curveAngularSweep(
  curve: Extract<
    ResolvedCurve,
    { readonly kind: "arc" | "circle" }
  >,
): number {
  return curve.kind === "arc"
    ? resolvedArcSweep(curve)
    : curve.reversed
      ? -FULL_TURN
      : FULL_TURN;
}

function curveNumericScale(curve: ResolvedCurve): number {
  switch (curve.kind) {
    case "line":
      return Math.max(1, distance2(curve.start, curve.end));
    case "arc":
    case "circle":
      return Math.max(1, curve.radius);
  }
}

export function scalarNumericGuard(
  tolerance: number,
  ...values: readonly number[]
): number {
  return (
    Number.EPSILON *
    Math.max(
      1,
      tolerance,
      ...values.map((value) => Math.abs(value)),
    ) *
    NUMERIC_GUARD_FACTOR
  );
}

function dot2(first: Vec2, second: Vec2): number {
  return first[0] * second[0] + first[1] * second[1];
}

function cross2(first: Vec2, second: Vec2): number {
  return first[0] * second[1] - first[1] * second[0];
}

function vector(start: Vec2, end: Vec2): Vec2 {
  return [end[0] - start[0], end[1] - start[1]];
}

export function normalizedAngle(angle: number): number {
  const normalized = angle % FULL_TURN;
  return normalized < 0 ? normalized + FULL_TURN : normalized;
}

export function roundCurveParameter(
  curve: Extract<
    ResolvedCurve,
    { readonly kind: "arc" | "circle" }
  >,
  angle: number,
  tolerance: number,
): number | undefined {
  const sweep = curveAngularSweep(curve);
  const span = Math.abs(sweep);
  const start = curve.kind === "arc" ? curve.startAngle : 0;
  const directed =
    sweep > 0
      ? normalizedAngle(angle - start)
      : normalizedAngle(start - angle);
  const angularGuard = Math.min(
    Math.PI / 8,
    tolerance / curve.radius +
      scalarNumericGuard(tolerance, span, angle, start),
  );
  if (directed > span + angularGuard) return undefined;
  if (directed <= angularGuard) return 0;
  if (span - directed <= angularGuard) return 1;
  return directed / span;
}

function allowedAdjacentContact(
  point: Vec2,
  first: ResolvedCurve,
  second: ResolvedCurve,
  allowed: readonly AllowedJunction[],
  tolerance: number,
): boolean {
  const guard = scalarNumericGuard(
    tolerance,
    point[0],
    point[1],
    curveNumericScale(first),
    curveNumericScale(second),
  );
  return allowed.some((junction) => {
    const firstPoint = curveEndpoint(
      first,
      junction.firstParameter,
    );
    const secondPoint = curveEndpoint(
      second,
      junction.secondParameter,
    );
    return (
      distance2(point, firstPoint) <= tolerance + guard &&
      distance2(point, secondPoint) <= tolerance + guard
    );
  });
}

function lineParameterIsOnSegment(
  parameter: number,
  length: number,
  tolerance: number,
): boolean {
  const guard =
    tolerance / Math.max(length, tolerance) +
    scalarNumericGuard(tolerance, parameter, length);
  return parameter >= -guard && parameter <= 1 + guard;
}

function certifyAdjacentLineContact(
  first: Extract<ResolvedCurve, { readonly kind: "line" }>,
  second: Extract<ResolvedCurve, { readonly kind: "line" }>,
  allowed: readonly AllowedJunction[],
  tolerance: number,
): AdjacentContactCertification {
  const firstDirection = vector(first.start, first.end);
  const secondDirection = vector(second.start, second.end);
  const offset = vector(first.start, second.start);
  const firstLength = Math.hypot(...firstDirection);
  const secondLength = Math.hypot(...secondDirection);
  const denominator = cross2(firstDirection, secondDirection);
  const determinantGuard =
    scalarNumericGuard(
      tolerance,
      firstLength,
      secondLength,
      ...firstDirection,
      ...secondDirection,
      ...offset,
    ) *
    Math.max(1, firstLength, secondLength);
  if (Math.abs(denominator) > determinantGuard) {
    const firstParameter =
      cross2(offset, secondDirection) / denominator;
    const secondParameter =
      cross2(offset, firstDirection) / denominator;
    if (
      !lineParameterIsOnSegment(
        firstParameter,
        firstLength,
        tolerance,
      ) ||
      !lineParameterIsOnSegment(
        secondParameter,
        secondLength,
        tolerance,
      )
    ) {
      return "clear";
    }
    const point: Vec2 = [
      first.start[0] + firstDirection[0] * firstParameter,
      first.start[1] + firstDirection[1] * firstParameter,
    ];
    return allowedAdjacentContact(
      point,
      first,
      second,
      allowed,
      tolerance,
    )
      ? "clear"
      : "blocked";
  }
  if (denominator !== 0) return "uncertain";

  const supportDistance =
    Math.abs(cross2(offset, firstDirection)) /
    Math.max(firstLength, tolerance);
  if (supportDistance > tolerance + determinantGuard) {
    return "clear";
  }
  const denominatorSquared = dot2(
    firstDirection,
    firstDirection,
  );
  if (!(denominatorSquared > 0)) return "uncertain";
  const firstAtSecondStart =
    dot2(offset, firstDirection) / denominatorSquared;
  const firstAtSecondEnd =
    dot2(
      vector(first.start, second.end),
      firstDirection,
    ) / denominatorSquared;
  const overlapStart = Math.max(
    0,
    Math.min(firstAtSecondStart, firstAtSecondEnd),
  );
  const overlapEnd = Math.min(
    1,
    Math.max(firstAtSecondStart, firstAtSecondEnd),
  );
  if (overlapEnd < overlapStart) return "clear";
  for (const parameter of [
    overlapStart,
    (overlapStart + overlapEnd) / 2,
    overlapEnd,
  ]) {
    const point: Vec2 = [
      first.start[0] + firstDirection[0] * parameter,
      first.start[1] + firstDirection[1] * parameter,
    ];
    if (
      !allowedAdjacentContact(
        point,
        first,
        second,
        allowed,
        tolerance,
      )
    ) {
      return "blocked";
    }
  }
  return "clear";
}

function certifyAdjacentLineRoundContact(
  first: ResolvedCurve,
  second: ResolvedCurve,
  allowed: readonly AllowedJunction[],
  tolerance: number,
): AdjacentContactCertification {
  const line = (
    first.kind === "line" ? first : second
  ) as Extract<ResolvedCurve, { readonly kind: "line" }>;
  const round = (
    first.kind === "line" ? second : first
  ) as Extract<
    ResolvedCurve,
    { readonly kind: "arc" | "circle" }
  >;
  const direction = vector(line.start, line.end);
  const fromCenter = vector(round.center, line.start);
  const a = dot2(direction, direction);
  const b = 2 * dot2(fromCenter, direction);
  const c =
    dot2(fromCenter, fromCenter) - round.radius ** 2;
  const discriminant = b ** 2 - 4 * a * c;
  const discriminantGuard =
    scalarNumericGuard(
      tolerance,
      a,
      b,
      c,
      round.radius,
      ...direction,
      ...fromCenter,
    ) *
    Math.max(1, Math.abs(b), Math.abs(a), Math.abs(c));
  if (discriminant < -discriminantGuard) return "clear";
  if (!(a > 0) || !Number.isFinite(discriminant)) {
    return "uncertain";
  }
  const lineLength = Math.sqrt(a);
  const roots =
    Math.abs(discriminant) <= discriminantGuard
      ? [-b / (2 * a)]
      : [
          (-b - Math.sqrt(discriminant)) / (2 * a),
          (-b + Math.sqrt(discriminant)) / (2 * a),
        ];
  let foundAllowedNearUncertainRoot = false;
  for (const parameter of roots) {
    if (
      !lineParameterIsOnSegment(
        parameter,
        lineLength,
        tolerance,
      )
    ) {
      continue;
    }
    const point: Vec2 = [
      line.start[0] + direction[0] * parameter,
      line.start[1] + direction[1] * parameter,
    ];
    if (
      roundCurveParameter(
        round,
        Math.atan2(
          point[1] - round.center[1],
          point[0] - round.center[0],
        ),
        tolerance,
      ) === undefined
    ) {
      continue;
    }
    if (
      !allowedAdjacentContact(
        point,
        first,
        second,
        allowed,
        tolerance,
      )
    ) {
      return "blocked";
    }
    foundAllowedNearUncertainRoot = true;
  }
  if (
    discriminant < 0 &&
    Math.abs(discriminant) <= discriminantGuard &&
    !foundAllowedNearUncertainRoot
  ) {
    return "uncertain";
  }
  return "clear";
}

function roundCurveIntervals(
  curve: Extract<
    ResolvedCurve,
    { readonly kind: "arc" | "circle" }
  >,
): readonly (readonly [number, number])[] {
  if (curve.kind === "circle") return [[0, FULL_TURN]];
  const sweep = resolvedArcSweep(curve);
  const intervalStart = normalizedAngle(
    sweep > 0 ? curve.startAngle : curve.endAngle,
  );
  const intervalEnd = intervalStart + Math.abs(sweep);
  if (intervalEnd <= FULL_TURN) {
    return [[intervalStart, intervalEnd]];
  }
  return [
    [intervalStart, FULL_TURN],
    [0, intervalEnd - FULL_TURN],
  ];
}

function certifyCoincidentRoundContact(
  first: Extract<
    ResolvedCurve,
    { readonly kind: "arc" | "circle" }
  >,
  second: Extract<
    ResolvedCurve,
    { readonly kind: "arc" | "circle" }
  >,
  allowed: readonly AllowedJunction[],
  tolerance: number,
): AdjacentContactCertification {
  const angularGuard =
    tolerance / Math.max(first.radius, tolerance) +
    scalarNumericGuard(
      tolerance,
      first.radius,
      curveAngularSweep(first),
      curveAngularSweep(second),
    );
  for (const firstInterval of roundCurveIntervals(first)) {
    for (const secondInterval of roundCurveIntervals(second)) {
      const overlapStart = Math.max(
        firstInterval[0],
        secondInterval[0],
      );
      const overlapEnd = Math.min(
        firstInterval[1],
        secondInterval[1],
      );
      if (overlapEnd < overlapStart - angularGuard) {
        continue;
      }
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const angle =
          overlapStart +
          (overlapEnd - overlapStart) * fraction;
        const point: Vec2 = [
          first.center[0] +
            first.radius * Math.cos(angle),
          first.center[1] +
            first.radius * Math.sin(angle),
        ];
        if (
          !allowedAdjacentContact(
            point,
            first,
            second,
            allowed,
            tolerance,
          )
        ) {
          return "blocked";
        }
      }
    }
  }
  return "clear";
}

function certifyAdjacentRoundContact(
  first: Extract<
    ResolvedCurve,
    { readonly kind: "arc" | "circle" }
  >,
  second: Extract<
    ResolvedCurve,
    { readonly kind: "arc" | "circle" }
  >,
  allowed: readonly AllowedJunction[],
  tolerance: number,
): AdjacentContactCertification {
  const offset = vector(first.center, second.center);
  const centerDistance = Math.hypot(...offset);
  const supportGuard = scalarNumericGuard(
    tolerance,
    centerDistance,
    first.radius,
    second.radius,
    ...offset,
  );
  if (
    centerDistance <= supportGuard &&
    Math.abs(first.radius - second.radius) <= supportGuard
  ) {
    return certifyCoincidentRoundContact(
      first,
      second,
      allowed,
      tolerance,
    );
  }
  if (!(centerDistance > supportGuard)) return "uncertain";
  const radiusSum = first.radius + second.radius;
  const radiusDifference = Math.abs(
    first.radius - second.radius,
  );
  if (
    centerDistance > radiusSum + supportGuard ||
    centerDistance < radiusDifference - supportGuard
  ) {
    return "clear";
  }
  const along =
    (first.radius ** 2 -
      second.radius ** 2 +
      centerDistance ** 2) /
    (2 * centerDistance);
  const heightSquared = first.radius ** 2 - along ** 2;
  const heightGuard =
    scalarNumericGuard(
      tolerance,
      along,
      centerDistance,
      first.radius,
      second.radius,
    ) *
    Math.max(
      1,
      first.radius,
      second.radius,
      centerDistance,
    );
  if (heightSquared < -heightGuard) return "clear";
  if (!Number.isFinite(heightSquared)) return "uncertain";
  const base: Vec2 = [
    first.center[0] +
      (offset[0] * along) / centerDistance,
    first.center[1] +
      (offset[1] * along) / centerDistance,
  ];
  const height =
    Math.abs(heightSquared) <= heightGuard
      ? 0
      : Math.sqrt(heightSquared);
  const perpendicular: Vec2 = [
    (-offset[1] * height) / centerDistance,
    (offset[0] * height) / centerDistance,
  ];
  const candidates: readonly Vec2[] =
    height === 0
      ? [base]
      : [
          [
            base[0] + perpendicular[0],
            base[1] + perpendicular[1],
          ],
          [
            base[0] - perpendicular[0],
            base[1] - perpendicular[1],
          ],
        ];
  let foundAllowedNearUncertainPoint = false;
  for (const point of candidates) {
    const firstParameter = roundCurveParameter(
      first,
      Math.atan2(
        point[1] - first.center[1],
        point[0] - first.center[0],
      ),
      tolerance,
    );
    const secondParameter = roundCurveParameter(
      second,
      Math.atan2(
        point[1] - second.center[1],
        point[0] - second.center[0],
      ),
      tolerance,
    );
    if (
      firstParameter === undefined ||
      secondParameter === undefined
    ) {
      continue;
    }
    if (
      !allowedAdjacentContact(
        point,
        first,
        second,
        allowed,
        tolerance,
      )
    ) {
      return "blocked";
    }
    foundAllowedNearUncertainPoint = true;
  }
  if (
    heightSquared < 0 &&
    Math.abs(heightSquared) <= heightGuard &&
    !foundAllowedNearUncertainPoint
  ) {
    return "uncertain";
  }
  return "clear";
}

export function certifyAdjacentCurveContact(
  first: ResolvedCurve,
  second: ResolvedCurve,
  allowed: readonly AllowedJunction[],
  tolerance: number,
): AdjacentContactCertification {
  const anchor = curveAnchor(first);
  const localFirst = translatedCurve(first, anchor);
  const localSecond = translatedCurve(second, anchor);
  if (
    localFirst.kind === "line" &&
    localSecond.kind === "line"
  ) {
    return certifyAdjacentLineContact(
      localFirst,
      localSecond,
      allowed,
      tolerance,
    );
  }
  if (
    localFirst.kind === "line" ||
    localSecond.kind === "line"
  ) {
    return certifyAdjacentLineRoundContact(
      localFirst,
      localSecond,
      allowed,
      tolerance,
    );
  }
  return certifyAdjacentRoundContact(
    localFirst,
    localSecond,
    allowed,
    tolerance,
  );
}
