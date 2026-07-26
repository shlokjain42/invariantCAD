import type { Vec2 } from "../core/math.js";
import { distance2 } from "../core/math.js";
import { DEFAULT_DESIGN_DOCUMENT_LIMITS } from "../document-limits.js";
import { resolvedPolylineSegmentDistance } from "../protocol/path.js";
import {
  curveEnd,
  curveStart,
  resolvedArcSweep,
  resolvedCurveIsFinite,
  type ProfileCurveSource,
  type ResolvedCurve,
  type ResolvedLoop,
  type ResolvedProfile,
} from "../protocol/profile.js";
import { resolvedLoopSignedArea } from "../protocol/profile-moments.js";
import {
  certifyAdjacentCurveContact,
  normalizedAngle,
  roundCurveParameter,
  scalarNumericGuard,
  type AllowedJunction,
} from "./resolved-profile-adjacent-contact.js";

export type ResolvedProfileRegionValidationReason =
  | "invalid-tolerance"
  | "invalid-work-limit"
  | "invalid-loop"
  | "loop-self-contact"
  | "hole-outer-boundary-contact"
  | "hole-outside-outer"
  | "hole-hole-boundary-contact"
  | "hole-nesting"
  | "uncertified-clearance"
  | "validation-work-limit"
  | "evaluation-aborted";

export interface ResolvedProfileRegionValidationIssue {
  readonly reason: ResolvedProfileRegionValidationReason;
  readonly message: string;
  readonly loop?: "outer" | "hole";
  readonly otherLoop?: "outer" | "hole";
  readonly holeIndex?: number;
  readonly otherHoleIndex?: number;
  readonly nestedHoleIndex?: number;
  readonly curveIndex?: number;
  readonly otherCurveIndex?: number;
  readonly connectorAfterCurve?: boolean;
  readonly otherConnectorAfterCurve?: boolean;
  readonly curveSource?: ProfileCurveSource;
  readonly otherCurveSource?: ProfileCurveSource;
  readonly loopIssueReason?: string;
  readonly workUnits: number;
  readonly maxWorkUnits: number;
}

export interface ResolvedProfileRegionValidationOptions {
  readonly signal?: AbortSignal;
  readonly maxWorkUnits?: number;
}

interface WorkState {
  readonly signal?: AbortSignal;
  readonly maxWorkUnits: number;
  workUnits: number;
}

interface BoundaryCurve {
  readonly curve: ResolvedCurve;
  readonly curveIndex: number;
  readonly connectorAfterCurve: boolean;
  readonly startJunction: number;
  readonly endJunction: number;
}

interface ValidatedLoop {
  readonly loop: ResolvedLoop;
  readonly boundary: readonly BoundaryCurve[];
  readonly role: "outer" | "hole";
  readonly holeIndex?: number;
}

interface CertifiedCurvePiece {
  readonly curve: ResolvedCurve;
  readonly anchor?: Vec2;
  readonly from: number;
  readonly to: number;
  readonly start: Vec2;
  readonly end: Vec2;
  readonly deviation: number;
  readonly depth: number;
}

type WorkStop = "evaluation-aborted" | "validation-work-limit";

type ClearanceCertification =
  | { readonly status: "clear" }
  | { readonly status: "blocked" }
  | { readonly status: "uncertain" }
  | { readonly status: "stopped"; readonly reason: WorkStop };

interface LoopClearanceCertification {
  readonly status: ClearanceCertification["status"];
  readonly reason?: WorkStop;
  readonly curveIndex?: number;
  readonly otherCurveIndex?: number;
  readonly connectorAfterCurve?: boolean;
  readonly otherConnectorAfterCurve?: boolean;
  readonly curveSource?: ProfileCurveSource;
  readonly otherCurveSource?: ProfileCurveSource;
}

type PointClassification =
  | { readonly status: "inside" | "outside" }
  | { readonly status: "uncertain" }
  | { readonly status: "stopped"; readonly reason: WorkStop };

const MAX_CERTIFICATION_DEPTH = 32;
const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = Math.PI * 2;
const NUMERIC_GUARD_FACTOR = 256;

function issue(
  state: WorkState,
  reason: ResolvedProfileRegionValidationReason,
  message: string,
  details: Omit<
    ResolvedProfileRegionValidationIssue,
    "reason" | "message" | "workUnits" | "maxWorkUnits"
  > = {},
): ResolvedProfileRegionValidationIssue {
  return {
    reason,
    message,
    ...details,
    workUnits: state.workUnits,
    maxWorkUnits: state.maxWorkUnits,
  };
}

function capturedCurveSource(
  curve: ResolvedCurve,
): ProfileCurveSource | undefined {
  try {
    return curve.source;
  } catch {
    return undefined;
  }
}

function curveSourceDetails(
  curve: ResolvedCurve,
): Pick<ResolvedProfileRegionValidationIssue, "curveSource"> {
  const source = capturedCurveSource(curve);
  return source === undefined ? {} : { curveSource: source };
}

function otherCurveSourceDetails(
  curve: ResolvedCurve,
): Pick<ResolvedProfileRegionValidationIssue, "otherCurveSource"> {
  const source = capturedCurveSource(curve);
  return source === undefined ? {} : { otherCurveSource: source };
}

function stoppedIssue(
  state: WorkState,
  reason: WorkStop,
): ResolvedProfileRegionValidationIssue {
  return reason === "evaluation-aborted"
    ? issue(
        state,
        "evaluation-aborted",
        "Sketch profile-region validation was aborted",
      )
    : issue(
        state,
        "validation-work-limit",
        `Sketch profile-region validation exceeded its ${state.maxWorkUnits}-unit work limit`,
      );
}

function consumeWork(state: WorkState): WorkStop | undefined {
  if (state.signal?.aborted) return "evaluation-aborted";
  if (state.workUnits >= state.maxWorkUnits) {
    return "validation-work-limit";
  }
  state.workUnits += 1;
  return undefined;
}

function subtractPoint(point: Vec2, anchor: Vec2): Vec2 {
  return [point[0] - anchor[0], point[1] - anchor[1]];
}

function curveAnchor(curve: ResolvedCurve): Vec2 {
  return curve.kind === "line" ? curve.start : curve.center;
}

function curvePoint(
  curve: ResolvedCurve,
  parameter: number,
  anchor?: Vec2,
): Vec2 {
  const translated = (point: Vec2): Vec2 =>
    anchor === undefined ? point : subtractPoint(point, anchor);
  if (parameter <= 0) {
    if (curve.kind === "line") return translated(curve.start);
    if (curve.kind === "arc") {
      const center =
        anchor === undefined
          ? curve.center
          : subtractPoint(curve.center, anchor);
      return [
        center[0] + curve.radius * Math.cos(curve.startAngle),
        center[1] + curve.radius * Math.sin(curve.startAngle),
      ];
    }
    const center =
      anchor === undefined
        ? curve.center
        : subtractPoint(curve.center, anchor);
    return [center[0] + curve.radius, center[1]];
  }
  if (parameter >= 1) {
    if (curve.kind === "line") return translated(curve.end);
    if (curve.kind === "arc") {
      const center =
        anchor === undefined
          ? curve.center
          : subtractPoint(curve.center, anchor);
      return [
        center[0] + curve.radius * Math.cos(curve.endAngle),
        center[1] + curve.radius * Math.sin(curve.endAngle),
      ];
    }
    const center =
      anchor === undefined
        ? curve.center
        : subtractPoint(curve.center, anchor);
    return [center[0] + curve.radius, center[1]];
  }
  switch (curve.kind) {
    case "line": {
      const start = translated(curve.start);
      return [
        start[0] + (curve.end[0] - curve.start[0]) * parameter,
        start[1] + (curve.end[1] - curve.start[1]) * parameter,
      ];
    }
    case "arc": {
      const center =
        anchor === undefined
          ? curve.center
          : subtractPoint(curve.center, anchor);
      const angle =
        curve.startAngle + resolvedArcSweep(curve) * parameter;
      return [
        center[0] + curve.radius * Math.cos(angle),
        center[1] + curve.radius * Math.sin(angle),
      ];
    }
    case "circle": {
      const center =
        anchor === undefined
          ? curve.center
          : subtractPoint(curve.center, anchor);
      const direction = curve.reversed ? -1 : 1;
      const angle = direction * FULL_TURN * parameter;
      return [
        center[0] + curve.radius * Math.cos(angle),
        center[1] + curve.radius * Math.sin(angle),
      ];
    }
  }
}

function curveAngularSweep(curve: ResolvedCurve): number {
  switch (curve.kind) {
    case "line":
      return 0;
    case "arc":
      return resolvedArcSweep(curve);
    case "circle":
      return curve.reversed ? -FULL_TURN : FULL_TURN;
  }
}

function certifiedCurvePiece(
  curve: ResolvedCurve,
  from: number,
  to: number,
  depth: number,
  anchor?: Vec2,
): CertifiedCurvePiece {
  if (curve.kind === "line") {
    return {
      curve,
      ...(anchor === undefined ? {} : { anchor }),
      from,
      to,
      start: curvePoint(curve, from, anchor),
      end: curvePoint(curve, to, anchor),
      deviation: 0,
      depth,
    };
  }
  const angularSpan = Math.abs(curveAngularSweep(curve) * (to - from));
  return {
    curve,
    ...(anchor === undefined ? {} : { anchor }),
    from,
    to,
    start: curvePoint(curve, from, anchor),
    end: curvePoint(curve, to, anchor),
    deviation:
      2 * curve.radius * Math.sin(angularSpan / 4) ** 2,
    depth,
  };
}

function initialCurvePieces(
  curve: ResolvedCurve,
  anchor?: Vec2,
): readonly CertifiedCurvePiece[] {
  if (curve.kind === "line") {
    return [certifiedCurvePiece(curve, 0, 1, 0, anchor)];
  }
  const count = Math.max(
    1,
    Math.ceil(Math.abs(curveAngularSweep(curve)) / QUARTER_TURN),
  );
  return Array.from({ length: count }, (_, index) =>
    certifiedCurvePiece(
      curve,
      index / count,
      (index + 1) / count,
      0,
      anchor,
    ),
  );
}

function subdivideCurvePiece(
  piece: CertifiedCurvePiece,
):
  | readonly [CertifiedCurvePiece, CertifiedCurvePiece]
  | undefined {
  const midpoint = (piece.from + piece.to) / 2;
  if (!(midpoint > piece.from && midpoint < piece.to)) {
    return undefined;
  }
  return [
    certifiedCurvePiece(
      piece.curve,
      piece.from,
      midpoint,
      piece.depth + 1,
      piece.anchor,
    ),
    certifiedCurvePiece(
      piece.curve,
      midpoint,
      piece.to,
      piece.depth + 1,
      piece.anchor,
    ),
  ];
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

function numericGuard(
  tolerance: number,
  ...pieces: readonly CertifiedCurvePiece[]
): number {
  let scale = Math.max(1, tolerance);
  for (const piece of pieces) {
    scale = Math.max(
      scale,
      Math.abs(piece.start[0]),
      Math.abs(piece.start[1]),
      Math.abs(piece.end[0]),
      Math.abs(piece.end[1]),
      piece.deviation,
      curveNumericScale(piece.curve),
    );
  }
  return Number.EPSILON * scale * NUMERIC_GUARD_FACTOR;
}

function chordDistance(
  first: CertifiedCurvePiece,
  second: CertifiedCurvePiece,
): number {
  return resolvedPolylineSegmentDistance(
    [first.start[0], first.start[1], 0],
    [first.end[0], first.end[1], 0],
    [second.start[0], second.start[1], 0],
    [second.end[0], second.end[1], 0],
  );
}

function certifyCurveClearance(
  first: ResolvedCurve,
  second: ResolvedCurve,
  tolerance: number,
  state: WorkState,
): ClearanceCertification {
  const anchor = curveAnchor(first);
  const pending: Array<
    readonly [CertifiedCurvePiece, CertifiedCurvePiece]
  > = [];
  for (const firstPiece of initialCurvePieces(first, anchor)) {
    for (const secondPiece of initialCurvePieces(second, anchor)) {
      pending.push([firstPiece, secondPiece]);
    }
  }

  while (pending.length > 0) {
    const stop = consumeWork(state);
    if (stop !== undefined) {
      return { status: "stopped", reason: stop };
    }
    const [firstPiece, secondPiece] = pending.pop()!;
    const guard = numericGuard(tolerance, firstPiece, secondPiece);
    const distance = chordDistance(firstPiece, secondPiece);
    if (!Number.isFinite(distance) || !Number.isFinite(guard)) {
      return { status: "uncertain" };
    }
    const deviation =
      firstPiece.deviation + secondPiece.deviation + guard;
    const lower = distance - deviation;
    const upper = distance + deviation;
    if (lower > tolerance) continue;
    if (upper <= tolerance) return { status: "blocked" };
    if (
      firstPiece.curve.kind === "line" &&
      secondPiece.curve.kind === "line"
    ) {
      return { status: "uncertain" };
    }

    const splitFirst =
      firstPiece.curve.kind !== "line" &&
      (secondPiece.curve.kind === "line" ||
        firstPiece.deviation >= secondPiece.deviation);
    const selected = splitFirst ? firstPiece : secondPiece;
    if (selected.depth >= MAX_CERTIFICATION_DEPTH) {
      return { status: "uncertain" };
    }
    const subdivided = subdivideCurvePiece(selected);
    if (subdivided === undefined) return { status: "uncertain" };
    for (const piece of subdivided) {
      pending.push(
        splitFirst
          ? [piece, secondPiece]
          : [firstPiece, piece],
      );
    }
  }
  return { status: "clear" };
}

function certifyLoopClearance(
  first: readonly BoundaryCurve[],
  second: readonly BoundaryCurve[],
  tolerance: number,
  state: WorkState,
): LoopClearanceCertification {
  for (const firstCurve of first) {
    for (const secondCurve of second) {
      const certification = certifyCurveClearance(
        firstCurve.curve,
        secondCurve.curve,
        tolerance,
        state,
      );
      if (certification.status === "clear") continue;
      return {
        status: certification.status,
        ...(certification.status === "stopped"
          ? { reason: certification.reason }
          : {}),
        curveIndex: firstCurve.curveIndex,
        otherCurveIndex: secondCurve.curveIndex,
        ...curveSourceDetails(firstCurve.curve),
        ...otherCurveSourceDetails(secondCurve.curve),
        ...(firstCurve.connectorAfterCurve
          ? { connectorAfterCurve: true }
          : {}),
        ...(secondCurve.connectorAfterCurve
          ? { otherConnectorAfterCurve: true }
          : {}),
      };
    }
  }
  return { status: "clear" };
}

function adjacentJunctions(
  first: BoundaryCurve,
  second: BoundaryCurve,
): readonly AllowedJunction[] {
  const junctions: AllowedJunction[] = [];
  if (first.endJunction === second.startJunction) {
    junctions.push({ firstParameter: 1, secondParameter: 0 });
  }
  if (first.startJunction === second.endJunction) {
    junctions.push({ firstParameter: 0, secondParameter: 1 });
  }
  return junctions;
}

function loopDescription(
  role: "outer" | "hole",
  holeIndex: number | undefined,
): string {
  return role === "outer" ? "Outer profile" : `Hole ${holeIndex}`;
}

function validateLoopClosure(
  loop: ResolvedLoop,
  role: "outer" | "hole",
  holeIndex: number | undefined,
  tolerance: number,
  state: WorkState,
): ResolvedProfileRegionValidationIssue | undefined {
  if (loop.curves.length === 0) {
    const stop = consumeWork(state);
    if (stop !== undefined) return stoppedIssue(state, stop);
    return issue(
      state,
      "invalid-loop",
      `${loopDescription(role, holeIndex)} must be closed within sketch tolerance`,
      {
        loop: role,
        ...(holeIndex === undefined ? {} : { holeIndex }),
        loopIssueReason: "open-loop",
      },
    );
  }
  for (let curveIndex = 0; curveIndex < loop.curves.length; curveIndex += 1) {
    const stop = consumeWork(state);
    if (stop !== undefined) return stoppedIssue(state, stop);
    const curve = loop.curves[curveIndex]!;
    if (curve.kind === "circle") {
      if (loop.curves.length === 1) return undefined;
      return issue(
        state,
        "invalid-loop",
        `${loopDescription(role, holeIndex)} must be closed within sketch tolerance`,
        {
          loop: role,
          ...(holeIndex === undefined ? {} : { holeIndex }),
          curveIndex,
          ...curveSourceDetails(curve),
          loopIssueReason: "open-loop",
        },
      );
    }
    const next = loop.curves[(curveIndex + 1) % loop.curves.length]!;
    const gap = distance2(curveEnd(curve), curveStart(next));
    if (!Number.isFinite(gap) || gap > tolerance) {
      return issue(
        state,
        "invalid-loop",
        `${loopDescription(role, holeIndex)} must be closed within sketch tolerance`,
        {
          loop: role,
          ...(holeIndex === undefined ? {} : { holeIndex }),
          curveIndex,
          ...curveSourceDetails(curve),
          loopIssueReason: "open-loop",
        },
      );
    }
  }
  return undefined;
}

function consumeLoopPass(
  state: WorkState,
  curveCount: number,
): WorkStop | undefined {
  for (let index = 0; index < curveCount; index += 1) {
    const stop = consumeWork(state);
    if (stop !== undefined) return stop;
  }
  return undefined;
}

function validateLoop(
  loop: ResolvedLoop,
  role: "outer" | "hole",
  holeIndex: number | undefined,
  tolerance: number,
  state: WorkState,
):
  | { readonly ok: true; readonly value: ValidatedLoop }
  | {
      readonly ok: false;
      readonly issue: ResolvedProfileRegionValidationIssue;
    } {
  const boundary: BoundaryCurve[] = [];
  const areaAnchor = curveAnchor(loop.curves[0]!);
  let areaScale = Math.max(1, tolerance);
  for (let curveIndex = 0; curveIndex < loop.curves.length; curveIndex += 1) {
    const stop = consumeWork(state);
    if (stop !== undefined) {
      return { ok: false, issue: stoppedIssue(state, stop) };
    }
    if (!resolvedCurveIsFinite(loop.curves[curveIndex]!, tolerance)) {
      return {
        ok: false,
        issue: issue(
          state,
          "invalid-loop",
          `${role === "outer" ? "Outer profile" : `Hole ${holeIndex}`} curve ${curveIndex} must be finite and nondegenerate`,
          {
            loop: role,
            ...(holeIndex === undefined ? {} : { holeIndex }),
            curveIndex,
            ...curveSourceDetails(loop.curves[curveIndex]!),
            loopIssueReason: "invalid-curve",
          },
        ),
      };
    }
    const curve = loop.curves[curveIndex]!;
    const start = curvePoint(curve, 0, areaAnchor);
    const end = curvePoint(curve, 1, areaAnchor);
    areaScale = Math.max(
      areaScale,
      Math.abs(start[0]),
      Math.abs(start[1]),
      Math.abs(end[0]),
      Math.abs(end[1]),
      curveNumericScale(curve),
    );
    boundary.push({
      curve,
      curveIndex,
      connectorAfterCurve: false,
      startJunction:
        (curveIndex - 1 + loop.curves.length) %
        loop.curves.length,
      endJunction: curveIndex,
    });
    if (curve.kind !== "circle") {
      const next = loop.curves[(curveIndex + 1) % loop.curves.length]!;
      const connectorStart = curveEnd(curve);
      const connectorEnd = curveStart(next);
      const connectorLength = distance2(
        connectorStart,
        connectorEnd,
      );
      const connectorGuard = scalarNumericGuard(
        tolerance,
        areaScale,
        connectorLength,
      );
      if (connectorLength > connectorGuard) {
        boundary.push({
          curve: {
            kind: "line",
            start: connectorStart,
            end: connectorEnd,
          },
          curveIndex,
          connectorAfterCurve: true,
          startJunction: curveIndex,
          endJunction: curveIndex,
        });
      }
    }
  }
  const areaPassStop = consumeLoopPass(state, loop.curves.length);
  if (areaPassStop !== undefined) {
    return { ok: false, issue: stoppedIssue(state, areaPassStop) };
  }
  const areaTolerance =
    tolerance +
    Number.EPSILON * areaScale * NUMERIC_GUARD_FACTOR;
  const area = resolvedLoopSignedArea(loop, areaTolerance, areaAnchor);
  if (!area.ok) {
    return {
      ok: false,
      issue: issue(
        state,
        "invalid-loop",
        `${role === "outer" ? "Outer profile" : `Hole ${holeIndex}`} must enclose reliably nonzero finite area`,
        {
          loop: role,
          ...(holeIndex === undefined ? {} : { holeIndex }),
          ...(area.curveIndex === undefined
            ? {}
            : { curveIndex: area.curveIndex }),
          ...(area.curveIndex === undefined
            ? {}
            : curveSourceDetails(
                loop.curves[area.curveIndex]!,
              )),
          loopIssueReason: area.reason,
        },
      ),
    };
  }

  for (
    let firstIndex = 0;
    firstIndex < boundary.length;
    firstIndex += 1
  ) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < boundary.length;
      secondIndex += 1
    ) {
      const first = boundary[firstIndex]!;
      const second = boundary[secondIndex]!;
      const junctions = adjacentJunctions(first, second);
      let certification: ClearanceCertification;
      if (junctions.length > 0) {
        const stop = consumeWork(state);
        if (stop !== undefined) {
          return { ok: false, issue: stoppedIssue(state, stop) };
        }
        const adjacent = certifyAdjacentCurveContact(
          first.curve,
          second.curve,
          junctions,
          tolerance,
        );
        certification =
          adjacent === "clear"
            ? { status: "clear" }
            : adjacent === "blocked"
              ? { status: "blocked" }
              : { status: "uncertain" };
      } else {
        certification = certifyCurveClearance(
          first.curve,
          second.curve,
          tolerance,
          state,
        );
      }
      if (certification.status === "clear") continue;
      if (certification.status === "stopped") {
        return {
          ok: false,
          issue: stoppedIssue(state, certification.reason),
        };
      }
      if (certification.status === "uncertain") {
        return {
          ok: false,
          issue: issue(
            state,
            "uncertified-clearance",
            `Could not certify ${role === "outer" ? "outer-profile" : `hole ${holeIndex}`} self-clearance`,
            {
              loop: role,
              otherLoop: role,
              ...(holeIndex === undefined ? {} : { holeIndex }),
              curveIndex: first.curveIndex,
              otherCurveIndex: second.curveIndex,
              ...curveSourceDetails(first.curve),
              ...otherCurveSourceDetails(second.curve),
              ...(first.connectorAfterCurve
                ? { connectorAfterCurve: true }
                : {}),
              ...(second.connectorAfterCurve
                ? { otherConnectorAfterCurve: true }
                : {}),
            },
          ),
        };
      }
      return {
        ok: false,
        issue: issue(
          state,
          "loop-self-contact",
          `${role === "outer" ? "Outer profile" : `Hole ${holeIndex}`} contains a self-contact or self-intersection`,
          {
            loop: role,
            otherLoop: role,
            ...(holeIndex === undefined ? {} : { holeIndex }),
            curveIndex: first.curveIndex,
            otherCurveIndex: second.curveIndex,
            ...curveSourceDetails(first.curve),
            ...otherCurveSourceDetails(second.curve),
            ...(first.connectorAfterCurve
              ? { connectorAfterCurve: true }
              : {}),
            ...(second.connectorAfterCurve
              ? { otherConnectorAfterCurve: true }
              : {}),
          },
        ),
      };
    }
  }

  return {
    ok: true,
    value: {
      loop,
      boundary,
      role,
      ...(holeIndex === undefined ? {} : { holeIndex }),
    },
  };
}

function lineRayCrossings(
  curve: Extract<ResolvedCurve, { readonly kind: "line" }>,
  point: Vec2,
  tolerance: number,
): number | "uncertain" {
  const start = curvePoint(curve, 0, point);
  const end = curvePoint(curve, 1, point);
  const startAbove = start[1] > 0;
  const endAbove = end[1] > 0;
  if (startAbove === endAbove) return 0;
  const determinant =
    start[0] * end[1] - start[1] * end[0];
  const guard =
    Number.EPSILON *
    NUMERIC_GUARD_FACTOR *
    Math.max(
      1,
      tolerance,
      Math.abs(start[0] * end[1]) +
        Math.abs(start[1] * end[0]),
    );
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= guard) {
    return "uncertain";
  }
  const crosses =
    end[1] > start[1]
      ? determinant > 0
      : determinant < 0;
  return crosses ? 1 : 0;
}

function roundRayCrossings(
  curve: Extract<ResolvedCurve, { readonly kind: "arc" | "circle" }>,
  point: Vec2,
  tolerance: number,
): number | "uncertain" {
  const center = subtractPoint(curve.center, point);
  const normalizedY = -center[1] / curve.radius;
  const ratioGuard =
    scalarNumericGuard(
      tolerance,
      ...center,
      curve.radius,
      normalizedY,
    ) / curve.radius;
  if (!Number.isFinite(normalizedY) || !Number.isFinite(ratioGuard)) {
    return "uncertain";
  }
  if (normalizedY < -1 - ratioGuard || normalizedY > 1 + ratioGuard) {
    return 0;
  }
  if (Math.abs(Math.abs(normalizedY) - 1) <= ratioGuard) {
    // A horizontal-ray tangency does not change even/odd parity.
    return 0;
  }
  const principal = Math.asin(Math.max(-1, Math.min(1, normalizedY)));
  const candidateAngles = [
    normalizedAngle(principal),
    normalizedAngle(Math.PI - principal),
  ];
  let crossings = 0;
  let previousAngle: number | undefined;
  for (const angle of candidateAngles.sort((first, second) => first - second)) {
    if (
      previousAngle !== undefined &&
      Math.abs(angle - previousAngle) <= ratioGuard
    ) {
      continue;
    }
    previousAngle = angle;
    const parameter = roundCurveParameter(curve, angle, 0);
    if (parameter === undefined) continue;
    const derivative = Math.cos(angle) * curveAngularSweep(curve);
    const derivativeGuard = scalarNumericGuard(
      tolerance,
      derivative,
      curve.radius,
      curveAngularSweep(curve),
    );
    if (
      curve.kind === "arc" &&
      (parameter === 0 || parameter === 1)
    ) {
      let interiorAbove: boolean;
      if (Math.abs(derivative) > derivativeGuard) {
        interiorAbove =
          parameter === 0 ? derivative > 0 : derivative < 0;
      } else {
        const secondDerivative =
          -curve.radius *
          Math.sin(angle) *
          curveAngularSweep(curve) ** 2;
        if (
          Math.abs(secondDerivative) <= derivativeGuard
        ) {
          return "uncertain";
        }
        interiorAbove = secondDerivative > 0;
      }
      if (!interiorAbove) continue;
    } else if (Math.abs(derivative) <= derivativeGuard) {
      // An interior horizontal-ray tangency does not change parity.
      continue;
    }
    const intersectionX =
      center[0] + curve.radius * Math.cos(angle);
    const xGuard = scalarNumericGuard(
      tolerance,
      ...center,
      curve.radius,
      intersectionX,
    );
    if (!Number.isFinite(intersectionX) || !Number.isFinite(xGuard)) {
      return "uncertain";
    }
    if (Math.abs(intersectionX) <= xGuard) return "uncertain";
    if (intersectionX > 0) crossings += 1;
  }
  return crossings;
}

function classifyPointInLoop(
  point: Vec2,
  boundary: readonly BoundaryCurve[],
  tolerance: number,
  state: WorkState,
): PointClassification {
  let crossings = 0;
  for (const boundaryCurve of boundary) {
    const stop = consumeWork(state);
    if (stop !== undefined) {
      return { status: "stopped", reason: stop };
    }
    const curveCrossings =
      boundaryCurve.curve.kind === "line"
        ? lineRayCrossings(boundaryCurve.curve, point, tolerance)
        : roundRayCrossings(boundaryCurve.curve, point, tolerance);
    if (curveCrossings === "uncertain") return { status: "uncertain" };
    crossings += curveCrossings;
  }
  return { status: crossings % 2 === 1 ? "inside" : "outside" };
}

function clearanceIssueDetails(
  certification: LoopClearanceCertification,
): Pick<
  ResolvedProfileRegionValidationIssue,
  | "curveIndex"
  | "otherCurveIndex"
  | "connectorAfterCurve"
  | "otherConnectorAfterCurve"
  | "curveSource"
  | "otherCurveSource"
> {
  return {
    ...(certification.curveIndex === undefined
      ? {}
      : { curveIndex: certification.curveIndex }),
    ...(certification.otherCurveIndex === undefined
      ? {}
      : { otherCurveIndex: certification.otherCurveIndex }),
    ...(certification.connectorAfterCurve === undefined
      ? {}
      : { connectorAfterCurve: true }),
    ...(certification.otherConnectorAfterCurve === undefined
      ? {}
      : { otherConnectorAfterCurve: true }),
    ...(certification.curveSource === undefined
      ? {}
      : { curveSource: certification.curveSource }),
    ...(certification.otherCurveSource === undefined
      ? {}
      : { otherCurveSource: certification.otherCurveSource }),
  };
}

function uncertaintyOrStop(
  certification: LoopClearanceCertification,
  state: WorkState,
  message: string,
  details: Omit<
    ResolvedProfileRegionValidationIssue,
    "reason" | "message" | "workUnits" | "maxWorkUnits"
  >,
): ResolvedProfileRegionValidationIssue | undefined {
  if (certification.status === "stopped") {
    return stoppedIssue(state, certification.reason!);
  }
  if (certification.status === "uncertain") {
    return issue(
      state,
      "uncertified-clearance",
      message,
      {
        ...details,
        ...clearanceIssueDetails(certification),
      },
    );
  }
  return undefined;
}

/**
 * Validates the current single-outer-region profile contract after expression
 * and configuration resolution and before any geometry-kernel profile call.
 *
 * Exact line/circular predicates establish loop simplicity and winding;
 * cross-loop separation uses adaptive chord pieces with exact circular
 * sagitta bounds. Authored tessellation hints never participate. Equality,
 * numeric uncertainty, cancellation, and exhausted work all fail closed.
 *
 * @internal
 */
export function validateResolvedProfileRegion(
  profile: ResolvedProfile,
  tolerance: number,
  options: ResolvedProfileRegionValidationOptions = {},
): ResolvedProfileRegionValidationIssue | undefined {
  const maxWorkUnits =
    options.maxWorkUnits ??
    DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues;
  const state: WorkState = {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    maxWorkUnits,
    workUnits: 0,
  };
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) {
    return issue(
      state,
      "invalid-tolerance",
      "Sketch profile-region tolerance must be finite and positive",
    );
  }
  if (
    !Number.isSafeInteger(maxWorkUnits) ||
    maxWorkUnits < 0
  ) {
    return issue(
      state,
      "invalid-work-limit",
      "Sketch profile-region maxWorkUnits must be a nonnegative safe integer",
    );
  }
  if (state.signal?.aborted) {
    return stoppedIssue(state, "evaluation-aborted");
  }
  const outerClosureIssue = validateLoopClosure(
    profile.outer,
    "outer",
    undefined,
    tolerance,
    state,
  );
  if (outerClosureIssue !== undefined) return outerClosureIssue;
  for (
    let holeIndex = 0;
    holeIndex < profile.holes.length;
    holeIndex += 1
  ) {
    const holeClosureIssue = validateLoopClosure(
      profile.holes[holeIndex]!,
      "hole",
      holeIndex,
      tolerance,
      state,
    );
    if (holeClosureIssue !== undefined) return holeClosureIssue;
  }
  // A closed hole-free profile has no region relationship to certify here.
  // Preserve established feature-specific admission after the same bounded,
  // cancellable closure gate previously owned by the evaluator.
  if (profile.holes.length === 0) return undefined;

  const outer = validateLoop(
    profile.outer,
    "outer",
    undefined,
    tolerance,
    state,
  );
  if (!outer.ok) return outer.issue;
  const holes: ValidatedLoop[] = [];
  for (let holeIndex = 0; holeIndex < profile.holes.length; holeIndex += 1) {
    const validated = validateLoop(
      profile.holes[holeIndex]!,
      "hole",
      holeIndex,
      tolerance,
      state,
    );
    if (!validated.ok) return validated.issue;
    holes.push(validated.value);
  }

  for (let holeIndex = 0; holeIndex < holes.length; holeIndex += 1) {
    const hole = holes[holeIndex]!;
    const clearance = certifyLoopClearance(
      hole.boundary,
      outer.value.boundary,
      tolerance,
      state,
    );
    const boundaryFailure = uncertaintyOrStop(
      clearance,
      state,
      `Could not certify strict clearance between hole ${holeIndex} and the outer profile`,
      { loop: "hole", otherLoop: "outer", holeIndex },
    );
    if (boundaryFailure !== undefined) return boundaryFailure;
    if (clearance.status === "blocked") {
      return issue(
        state,
        "hole-outer-boundary-contact",
        `Hole ${holeIndex} must be separated from the outer profile by more than the sketch tolerance`,
        {
          loop: "hole",
          otherLoop: "outer",
          holeIndex,
          ...clearanceIssueDetails(clearance),
        },
      );
    }

    const witness = curveStart(hole.loop.curves[0]!);
    const containment = classifyPointInLoop(
      witness,
      outer.value.boundary,
      tolerance,
      state,
    );
    if (containment.status === "stopped") {
      return stoppedIssue(state, containment.reason);
    }
    if (containment.status === "uncertain") {
      return issue(
        state,
        "uncertified-clearance",
        `Could not certify whether hole ${holeIndex} is inside the outer profile`,
        {
          loop: "hole",
          holeIndex,
          curveIndex: 0,
          ...curveSourceDetails(hole.loop.curves[0]!),
        },
      );
    }
    if (containment.status === "outside") {
      return issue(
        state,
        "hole-outside-outer",
        `Hole ${holeIndex} is not strictly contained by the outer profile`,
        {
          loop: "hole",
          holeIndex,
          curveIndex: 0,
          ...curveSourceDetails(hole.loop.curves[0]!),
        },
      );
    }
  }

  for (let holeIndex = 1; holeIndex < holes.length; holeIndex += 1) {
    const hole = holes[holeIndex]!;
    for (
      let otherHoleIndex = 0;
      otherHoleIndex < holeIndex;
      otherHoleIndex += 1
    ) {
      const other = holes[otherHoleIndex]!;
      const clearance = certifyLoopClearance(
        hole.boundary,
        other.boundary,
        tolerance,
        state,
      );
      const boundaryFailure = uncertaintyOrStop(
        clearance,
        state,
        `Could not certify strict clearance between holes ${otherHoleIndex} and ${holeIndex}`,
        {
          loop: "hole",
          otherLoop: "hole",
          holeIndex,
          otherHoleIndex,
        },
      );
      if (boundaryFailure !== undefined) return boundaryFailure;
      if (clearance.status === "blocked") {
        return issue(
          state,
          "hole-hole-boundary-contact",
          `Holes ${otherHoleIndex} and ${holeIndex} must not touch or intersect`,
          {
            loop: "hole",
            otherLoop: "hole",
            holeIndex,
            otherHoleIndex,
            ...clearanceIssueDetails(clearance),
          },
        );
      }

      const holeInOther = classifyPointInLoop(
        curveStart(hole.loop.curves[0]!),
        other.boundary,
        tolerance,
        state,
      );
      if (holeInOther.status === "stopped") {
        return stoppedIssue(state, holeInOther.reason);
      }
      if (holeInOther.status === "uncertain") {
        return issue(
          state,
          "uncertified-clearance",
          `Could not certify whether hole ${holeIndex} is nested in hole ${otherHoleIndex}`,
          {
            loop: "hole",
            otherLoop: "hole",
            holeIndex,
            otherHoleIndex,
            curveIndex: 0,
            otherCurveIndex: 0,
            ...curveSourceDetails(hole.loop.curves[0]!),
            ...otherCurveSourceDetails(other.loop.curves[0]!),
          },
        );
      }
      if (holeInOther.status === "inside") {
        return issue(
          state,
          "hole-nesting",
          `Hole ${holeIndex} must not be nested in hole ${otherHoleIndex}`,
          {
            loop: "hole",
            otherLoop: "hole",
            holeIndex,
            otherHoleIndex,
            nestedHoleIndex: holeIndex,
            curveIndex: 0,
            otherCurveIndex: 0,
            ...curveSourceDetails(hole.loop.curves[0]!),
            ...otherCurveSourceDetails(other.loop.curves[0]!),
          },
        );
      }

      const otherInHole = classifyPointInLoop(
        curveStart(other.loop.curves[0]!),
        hole.boundary,
        tolerance,
        state,
      );
      if (otherInHole.status === "stopped") {
        return stoppedIssue(state, otherInHole.reason);
      }
      if (otherInHole.status === "uncertain") {
        return issue(
          state,
          "uncertified-clearance",
          `Could not certify whether hole ${otherHoleIndex} is nested in hole ${holeIndex}`,
          {
            loop: "hole",
            otherLoop: "hole",
            holeIndex,
            otherHoleIndex,
            curveIndex: 0,
            otherCurveIndex: 0,
            ...curveSourceDetails(hole.loop.curves[0]!),
            ...otherCurveSourceDetails(other.loop.curves[0]!),
          },
        );
      }
      if (otherInHole.status === "inside") {
        return issue(
          state,
          "hole-nesting",
          `Hole ${otherHoleIndex} must not be nested in hole ${holeIndex}`,
          {
            loop: "hole",
            otherLoop: "hole",
            holeIndex,
            otherHoleIndex,
            nestedHoleIndex: otherHoleIndex,
            curveIndex: 0,
            otherCurveIndex: 0,
            ...curveSourceDetails(hole.loop.curves[0]!),
            ...otherCurveSourceDetails(other.loop.curves[0]!),
          },
        );
      }
    }
  }
  return undefined;
}
