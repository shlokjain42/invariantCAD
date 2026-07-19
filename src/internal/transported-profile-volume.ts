import type { Vec3 } from "../core/math.js";
import {
  COMPOSITE_PATH_MAX_JUNCTION_SINE,
  POLYLINE_PATH_MIN_CORNER_SINE,
  resolvedCircularArcGeometry,
  resolvedCompositePathSegments,
  type ResolvedCircularArcGeometry,
  type ResolvedCompositePath,
  type ResolvedPathSegment,
} from "../protocol/path.js";

/**
 * The area moments needed by the transported-profile volume identity.
 *
 * `centroidOffsetFromPathStart` is the translation-invariant vector from the
 * composite path start to the seated section's centroid. `normal` may have
 * either orientation, but its plane must be normal to the initial path
 * tangent.
 */
export interface TransportedProfileMoments {
  readonly area: number;
  readonly centroidOffsetFromPathStart: Vec3;
  readonly normal: Vec3;
}

export interface TransportedProfileLineVolumeTerm {
  readonly kind: "line";
  readonly segmentIndex: number;
  readonly value: number;
  readonly length: number;
  readonly normalProjection: number;
}

export interface TransportedProfileArcVolumeTerm {
  readonly kind: "circularArc";
  readonly segmentIndex: number;
  readonly value: number;
  readonly sweep: number;
  /** Signed centroid-orbit radius seen by the transported section normal. */
  readonly centroidOrbitRadius: number;
}

export interface TransportedProfileRightCornerVolumeTerm {
  readonly kind: "rightCorner";
  readonly priorSegmentIndex: number;
  readonly segmentIndex: number;
  readonly value: number;
  readonly turn: number;
  readonly tangentHalfTurn: number;
  readonly centroidInwardOffset: number;
  readonly normalProjection: number;
}

export type TransportedProfileVolumeTerm =
  | TransportedProfileLineVolumeTerm
  | TransportedProfileArcVolumeTerm
  | TransportedProfileRightCornerVolumeTerm;

export interface TransportedProfileVolumeDiagnostics {
  /** Compensated signed sum of every ideal-volume contribution. */
  readonly signedVolume: number;
  /** Ordinary (uncompensated) signed sum, exposed for arithmetic diagnosis. */
  readonly naiveSignedVolume: number;
  readonly compensation: number;
  readonly absoluteTermSum: number;
  /** `abs(signedVolume) / absoluteTermSum`; one means no cancellation. */
  readonly cancellationRatio: number;
  /** `absoluteTermSum / abs(signedVolume)`; one is best conditioned. */
  readonly conditionNumber: number;
  /** Conservative floating-point uncertainty attributed to term aggregation. */
  readonly roundoffBound: number;
  readonly relativeRoundoffBound: number;
  readonly terms: readonly TransportedProfileVolumeTerm[];
}

export type TransportedProfileVolumeFailureReason =
  | "invalid-profile"
  | "invalid-tolerance"
  | "invalid-path"
  | "unsupported-profile-alignment"
  | "unsupported-junction"
  | "unsupported-right-corner"
  | "ill-conditioned"
  | "non-positive-volume";

export interface TransportedProfileVolumeSuccess {
  readonly ok: true;
  readonly volume: number;
  readonly diagnostics: TransportedProfileVolumeDiagnostics;
}

export interface TransportedProfileVolumeFailure {
  readonly ok: false;
  readonly reason: TransportedProfileVolumeFailureReason;
  readonly message: string;
  readonly segmentIndex?: number;
  readonly otherSegmentIndex?: number;
  readonly diagnostics?: TransportedProfileVolumeDiagnostics;
}

export type TransportedProfileVolumeResult =
  | TransportedProfileVolumeSuccess
  | TransportedProfileVolumeFailure;

interface SegmentFacts {
  readonly segment: ResolvedPathSegment;
  readonly length: number;
  readonly startTangent: Vec3;
  readonly endTangent: Vec3;
  readonly arc?: ResolvedCircularArcGeometry;
}

interface FailureLocation {
  readonly segmentIndex?: number;
  readonly otherSegmentIndex?: number;
}

interface CompensatedAccumulator {
  readonly add: (value: number) => void;
  readonly naive: () => number;
  readonly compensation: () => number;
  readonly value: () => number;
}

// The oracle is intended to be substantially more accurate than the native
// volume postcondition it informs. Beyond this bound, cancellation has consumed
// too much of that margin and returning a scalar would be misleading.
const MAX_SUPPORTED_RELATIVE_ROUNDOFF = 1e-10;
const SUMMATION_ROUNDOFF_FACTOR = 64;
const RIGHT_CORNER_DENOMINATOR_GUARD = Number.EPSILON * 256;
const TRANSPORTED_FRAME_ROUNDOFF_SINE = Number.EPSILON * 256;

function dot(first: Vec3, second: Vec3): number {
  return (
    first[0] * second[0] +
    first[1] * second[1] +
    first[2] * second[2]
  );
}

function add(first: Vec3, second: Vec3): Vec3 {
  return [
    first[0] + second[0],
    first[1] + second[1],
    first[2] + second[2],
  ];
}

function subtract(first: Vec3, second: Vec3): Vec3 {
  return [
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  ];
}

function scale(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function cross(first: Vec3, second: Vec3): Vec3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function length(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function finiteVector(value: Vec3): boolean {
  return (
    value.length === 3 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Number.isFinite(value[2])
  );
}

function normalize(value: Vec3): Vec3 | undefined {
  const magnitude = length(value);
  if (!Number.isFinite(magnitude) || !(magnitude > 0)) return undefined;
  const result = scale(value, 1 / magnitude);
  return finiteVector(result) ? result : undefined;
}

function rotate(value: Vec3, axis: Vec3, angle: number): Vec3 {
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  return add(
    add(scale(value, cosine), scale(cross(axis, value), sine)),
    scale(axis, dot(axis, value) * (1 - cosine)),
  );
}

/** Neumaier compensated addition, including the case where a new term wins. */
function compensatedAccumulator(): CompensatedAccumulator {
  let sum = 0;
  let correction = 0;
  return {
    add(value): void {
      const next = sum + value;
      correction +=
        Math.abs(sum) >= Math.abs(value)
          ? sum - next + value
          : value - next + sum;
      sum = next;
    },
    naive: () => sum,
    compensation: () => correction,
    value: () => sum + correction,
  };
}

function diagnostics(
  volume: CompensatedAccumulator,
  absoluteTerms: CompensatedAccumulator,
  terms: readonly TransportedProfileVolumeTerm[],
): TransportedProfileVolumeDiagnostics {
  const signedVolume = volume.value();
  const absoluteTermSum = absoluteTerms.value();
  const absoluteVolume = Math.abs(signedVolume);
  const cancellationRatio =
    absoluteTermSum > 0
      ? Math.min(1, absoluteVolume / absoluteTermSum)
      : 0;
  const conditionNumber =
    absoluteVolume > 0
      ? Math.max(1, absoluteTermSum / absoluteVolume)
      : Number.POSITIVE_INFINITY;
  const roundoffBound =
    Number.EPSILON * SUMMATION_ROUNDOFF_FACTOR * absoluteTermSum;
  const relativeRoundoffBound =
    absoluteVolume > 0
      ? roundoffBound / absoluteVolume
      : Number.POSITIVE_INFINITY;
  return {
    signedVolume,
    naiveSignedVolume: volume.naive(),
    compensation: volume.compensation(),
    absoluteTermSum,
    cancellationRatio,
    conditionNumber,
    roundoffBound,
    relativeRoundoffBound,
    terms,
  };
}

function failure(
  reason: TransportedProfileVolumeFailureReason,
  message: string,
  location: FailureLocation = {},
  diagnostic?: TransportedProfileVolumeDiagnostics,
): TransportedProfileVolumeFailure {
  return {
    ok: false,
    reason,
    message,
    ...location,
    ...(diagnostic === undefined ? {} : { diagnostics: diagnostic }),
  };
}

function segmentFacts(
  path: ResolvedCompositePath,
): readonly SegmentFacts[] | TransportedProfileVolumeFailure {
  if (
    path.kind !== "composite" ||
    path.closed !== false ||
    !finiteVector(path.start) ||
    path.segments.length < 2 ||
    !path.segments.some((segment) => segment.kind === "circularArc")
  ) {
    return failure(
      "invalid-path",
      "The volume oracle requires one open composite path with at least two segments and one circular arc",
    );
  }

  const facts: SegmentFacts[] = [];
  const segments = resolvedCompositePathSegments(path);
  for (const [segmentIndex, segment] of segments.entries()) {
    if (!finiteVector(segment.start) || !finiteVector(segment.end)) {
      return failure(
        "invalid-path",
        `Composite path segment ${segmentIndex} contains a non-finite endpoint`,
        { segmentIndex },
      );
    }
    if (segment.kind === "line") {
      const delta = subtract(segment.end, segment.start);
      const segmentLength = length(delta);
      const tangent = normalize(delta);
      if (
        tangent === undefined ||
        !Number.isFinite(segmentLength) ||
        !(segmentLength > 0)
      ) {
        return failure(
          "invalid-path",
          `Composite line segment ${segmentIndex} must have finite positive length`,
          { segmentIndex },
        );
      }
      facts.push({
        segment,
        length: segmentLength,
        startTangent: tangent,
        endTangent: tangent,
      });
      continue;
    }

    if (!finiteVector(segment.through)) {
      return failure(
        "invalid-path",
        `Composite circular-arc segment ${segmentIndex} has a non-finite through point`,
        { segmentIndex },
      );
    }
    const arc = resolvedCircularArcGeometry(segment);
    if (
      arc === undefined ||
      !(arc.radius > 0) ||
      !(arc.sweep > 0) ||
      !(arc.length > 0) ||
      !(arc.closingSweep > 0) ||
      !(arc.closingLength > 0) ||
      !finiteVector(arc.center) ||
      !finiteVector(arc.centerOffsetFromStart) ||
      !finiteVector(arc.normal) ||
      !finiteVector(arc.startTangent) ||
      !finiteVector(arc.endTangent)
    ) {
      return failure(
        "invalid-path",
        `Composite circular-arc segment ${segmentIndex} must resolve to one finite open arc`,
        { segmentIndex },
      );
    }
    facts.push({
      segment,
      length: arc.length,
      startTangent: arc.startTangent,
      endTangent: arc.endTangent,
      arc,
    });
  }
  return facts;
}

function isFailure(
  value: readonly SegmentFacts[] | TransportedProfileVolumeFailure,
): value is TransportedProfileVolumeFailure {
  return !Array.isArray(value);
}

/**
 * Evaluates the exact ideal volume of a current-document corrected-Frenet,
 * RightCorner composite sweep from its starting section's area moments.
 *
 * This is a kernel-neutral postcondition oracle, not a replacement for sweep
 * admission. The caller must still establish profile simplicity and path/profile
 * clearance and must pass the same linear tolerance used for that admission.
 * This function independently rejects every local path, frame, and arithmetic
 * condition for which the area/centroid identity is not supported.
 */
export function resolvedCompositeSweepVolumeOracle(
  profile: TransportedProfileMoments,
  path: ResolvedCompositePath,
  profileAlignmentTolerance: number,
): TransportedProfileVolumeResult {
  if (
    !Number.isFinite(profileAlignmentTolerance) ||
    !(profileAlignmentTolerance > 0)
  ) {
    return failure(
      "invalid-tolerance",
      "Transported-profile alignment tolerance must be finite and positive",
    );
  }
  if (
    !Number.isFinite(profile.area) ||
    !(profile.area > 0) ||
    !finiteVector(profile.centroidOffsetFromPathStart) ||
    !finiteVector(profile.normal)
  ) {
    return failure(
      "invalid-profile",
      "Transported profile area must be finite and positive, and its centroid offset and normal must be finite",
    );
  }
  const initialNormal = normalize(profile.normal);
  if (initialNormal === undefined) {
    return failure(
      "invalid-profile",
      "Transported profile normal must have finite positive length",
    );
  }

  const resolvedFacts = segmentFacts(path);
  if (isFailure(resolvedFacts)) return resolvedFacts;
  const firstFacts = resolvedFacts[0]!;
  const firstTangent = firstFacts.startTangent;
  const firstTangentScale = firstFacts.arc?.radius ?? firstFacts.length;
  const initialAlignmentSine = length(cross(initialNormal, firstTangent));
  const initialAlignmentDot = dot(initialNormal, firstTangent);
  if (
    !Number.isFinite(initialAlignmentSine) ||
    !Number.isFinite(initialAlignmentDot) ||
    initialAlignmentSine * firstTangentScale > profileAlignmentTolerance ||
    !(Math.abs(initialAlignmentDot) > 0)
  ) {
    return failure(
      "unsupported-profile-alignment",
      "The transported profile plane must be normal to the initial composite-path tangent",
      { segmentIndex: 0 },
    );
  }

  const orientation = initialAlignmentDot < 0 ? -1 : 1;
  const rightCornerAlignmentMaxSine = Math.min(
    1,
    profileAlignmentTolerance / firstTangentScale +
      resolvedFacts.length * COMPOSITE_PATH_MAX_JUNCTION_SINE +
      TRANSPORTED_FRAME_ROUNDOFF_SINE,
  );
  let transportedNormal = initialNormal;
  let centroidOffset = profile.centroidOffsetFromPathStart;
  const volume = compensatedAccumulator();
  const absoluteTerms = compensatedAccumulator();
  const terms: TransportedProfileVolumeTerm[] = [];

  const currentDiagnostics = (): TransportedProfileVolumeDiagnostics =>
    diagnostics(volume, absoluteTerms, terms);
  const appendTerm = (term: TransportedProfileVolumeTerm): boolean => {
    if (!Number.isFinite(term.value)) return false;
    volume.add(term.value);
    absoluteTerms.add(Math.abs(term.value));
    terms.push(term);
    return true;
  };

  for (const [segmentIndex, facts] of resolvedFacts.entries()) {
    if (facts.segment.kind === "line") {
      const normalProjection = dot(
        transportedNormal,
        facts.startTangent,
      );
      const value =
        profile.area * orientation * normalProjection * facts.length;
      if (
        !appendTerm({
          kind: "line",
          segmentIndex,
          value,
          length: facts.length,
          normalProjection,
        })
      ) {
        return failure(
          "ill-conditioned",
          `Composite line segment ${segmentIndex} produced a non-finite volume contribution`,
          { segmentIndex },
          currentDiagnostics(),
        );
      }
    } else {
      const arc = facts.arc!;
      const centroidFromCenter = subtract(
        centroidOffset,
        arc.centerOffsetFromStart,
      );
      const centroidOrbitRadius = dot(
        transportedNormal,
        cross(arc.normal, centroidFromCenter),
      );
      const value =
        profile.area * orientation * arc.sweep * centroidOrbitRadius;
      if (
        !appendTerm({
          kind: "circularArc",
          segmentIndex,
          value,
          sweep: arc.sweep,
          centroidOrbitRadius,
        })
      ) {
        return failure(
          "ill-conditioned",
          `Composite circular-arc segment ${segmentIndex} produced a non-finite volume contribution`,
          { segmentIndex },
          currentDiagnostics(),
        );
      }
      centroidOffset = rotate(centroidOffset, arc.normal, arc.sweep);
      const rotatedNormal = normalize(
        rotate(transportedNormal, arc.normal, arc.sweep),
      );
      if (!finiteVector(centroidOffset) || rotatedNormal === undefined) {
        return failure(
          "ill-conditioned",
          `Composite circular-arc segment ${segmentIndex} produced a non-finite transported frame`,
          { segmentIndex },
          currentDiagnostics(),
        );
      }
      transportedNormal = rotatedNormal;
    }

    const nextFacts = resolvedFacts[segmentIndex + 1];
    if (nextFacts === undefined) continue;
    const tangentCross = cross(facts.endTangent, nextFacts.startTangent);
    const junctionSine = length(tangentCross);
    const junctionDot = dot(facts.endTangent, nextFacts.startTangent);
    if (!Number.isFinite(junctionSine) || !Number.isFinite(junctionDot)) {
      return failure(
        "invalid-path",
        `Composite junction ${segmentIndex}-${segmentIndex + 1} has non-finite tangents`,
        { segmentIndex: segmentIndex + 1, otherSegmentIndex: segmentIndex },
        currentDiagnostics(),
      );
    }

    if (
      facts.segment.kind === "circularArc" ||
      nextFacts.segment.kind === "circularArc"
    ) {
      if (
        junctionSine > COMPOSITE_PATH_MAX_JUNCTION_SINE ||
        !(junctionDot > 0)
      ) {
        return failure(
          "unsupported-junction",
          "Every arc-bearing volume-oracle junction must be forward G1 tangent",
          { segmentIndex: segmentIndex + 1, otherSegmentIndex: segmentIndex },
          currentDiagnostics(),
        );
      }
      continue;
    }

    if (!(junctionSine > POLYLINE_PATH_MIN_CORNER_SINE)) {
      return failure(
        "unsupported-right-corner",
        "The volume oracle does not support a collinear or reversal line-line RightCorner junction",
        { segmentIndex: segmentIndex + 1, otherSegmentIndex: segmentIndex },
        currentDiagnostics(),
      );
    }
    const clampedJunctionDot = Math.max(-1, Math.min(1, junctionDot));
    const halfTurnDenominator = 1 + clampedJunctionDot;
    if (!(halfTurnDenominator > RIGHT_CORNER_DENOMINATOR_GUARD)) {
      return failure(
        "unsupported-right-corner",
        "The line-line RightCorner turn is too close to reversal for a stable miter-volume identity",
        { segmentIndex: segmentIndex + 1, otherSegmentIndex: segmentIndex },
        currentDiagnostics(),
      );
    }
    const normalAlignmentSine = length(
      cross(transportedNormal, facts.endTangent),
    );
    if (
      !Number.isFinite(normalAlignmentSine) ||
      normalAlignmentSine > rightCornerAlignmentMaxSine
    ) {
      return failure(
        "unsupported-right-corner",
        "The transported section is not stably normal to the incoming line at the RightCorner junction",
        { segmentIndex: segmentIndex + 1, otherSegmentIndex: segmentIndex },
        currentDiagnostics(),
      );
    }

    const cornerAxis = scale(tangentCross, 1 / junctionSine);
    const inward = cross(cornerAxis, facts.endTangent);
    const centroidInwardOffset = dot(centroidOffset, inward);
    const normalProjection = dot(transportedNormal, facts.endTangent);
    const tangentHalfTurn = junctionSine / halfTurnDenominator;
    const turn = Math.atan2(junctionSine, clampedJunctionDot);
    const cornerValue =
      -2 *
      profile.area *
      orientation *
      normalProjection *
      centroidInwardOffset *
      tangentHalfTurn;
    if (
      !finiteVector(cornerAxis) ||
      !Number.isFinite(centroidInwardOffset) ||
      !Number.isFinite(tangentHalfTurn) ||
      !Number.isFinite(turn) ||
      !appendTerm({
        kind: "rightCorner",
        priorSegmentIndex: segmentIndex,
        segmentIndex: segmentIndex + 1,
        value: cornerValue,
        turn,
        tangentHalfTurn,
        centroidInwardOffset,
        normalProjection,
      })
    ) {
      return failure(
        "ill-conditioned",
        `Composite RightCorner junction ${segmentIndex}-${segmentIndex + 1} produced a non-finite volume contribution`,
        { segmentIndex: segmentIndex + 1, otherSegmentIndex: segmentIndex },
        currentDiagnostics(),
      );
    }

    centroidOffset = rotate(centroidOffset, cornerAxis, turn);
    const rotatedNormal = normalize(
      rotate(transportedNormal, cornerAxis, turn),
    );
    if (!finiteVector(centroidOffset) || rotatedNormal === undefined) {
      return failure(
        "ill-conditioned",
        `Composite RightCorner junction ${segmentIndex}-${segmentIndex + 1} produced a non-finite transported frame`,
        { segmentIndex: segmentIndex + 1, otherSegmentIndex: segmentIndex },
        currentDiagnostics(),
      );
    }
    transportedNormal = rotatedNormal;
  }

  const finalDiagnostics = currentDiagnostics();
  if (
    !Number.isFinite(finalDiagnostics.signedVolume) ||
    !Number.isFinite(finalDiagnostics.absoluteTermSum) ||
    !Number.isFinite(finalDiagnostics.roundoffBound) ||
    finalDiagnostics.absoluteTermSum === 0 ||
    !Number.isFinite(finalDiagnostics.relativeRoundoffBound) ||
    finalDiagnostics.relativeRoundoffBound >
      MAX_SUPPORTED_RELATIVE_ROUNDOFF
  ) {
    return failure(
      "ill-conditioned",
      "Transported-profile volume terms cancel too strongly for a reliable scalar expectation",
      {},
      finalDiagnostics,
    );
  }
  if (!(finalDiagnostics.signedVolume > 0)) {
    return failure(
      "non-positive-volume",
      "Transported-profile volume must be reliably positive under the supported sweep contract",
      {},
      finalDiagnostics,
    );
  }
  return {
    ok: true,
    volume: finalDiagnostics.signedVolume,
    diagnostics: finalDiagnostics,
  };
}
