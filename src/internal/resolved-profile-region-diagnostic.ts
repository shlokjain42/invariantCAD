import type { EntityId, NodeId } from "../core/ids.js";
import {
  diagnostic,
  type Diagnostic,
} from "../core/result.js";
import type { SketchNodeIR } from "../ir.js";
import type { ResolvedProfileRegionValidationIssue } from "./resolved-profile-region.js";
import { jsonPointerSegment } from "../core/json-pointer.js";

function authoredProfileCurveEntity(
  sketch: SketchNodeIR,
  role: "outer" | "hole" | undefined,
  holeIndex: number | undefined,
  curveIndex: number | undefined,
): EntityId | undefined {
  if (role === undefined || curveIndex === undefined) return undefined;
  const loop =
    role === "outer"
      ? sketch.profile.outer
      : holeIndex === undefined
        ? undefined
        : sketch.profile.holes[holeIndex];
  if (loop === undefined) return undefined;
  if (loop.kind === "circle") {
    return curveIndex === 0 ? loop.entity : undefined;
  }
  return loop.edges[curveIndex]?.entity;
}

function admittedProfileCurveSource(
  node: NodeId,
  sketch: SketchNodeIR,
  source: ResolvedProfileRegionValidationIssue["curveSource"],
  role: "outer" | "hole" | undefined,
  holeIndex: number | undefined,
  curveIndex: number | undefined,
): ResolvedProfileRegionValidationIssue["curveSource"] {
  const expectedEntity = authoredProfileCurveEntity(
    sketch,
    role,
    holeIndex,
    curveIndex,
  );
  if (expectedEntity === undefined || source === undefined) {
    return undefined;
  }
  try {
    if (
      typeof source !== "object" ||
      source === null ||
      source.kind !== "sketch-entity" ||
      typeof source.sketch !== "string" ||
      typeof source.entity !== "string" ||
      source.sketch !== node ||
      source.entity !== expectedEntity ||
      !Object.prototype.hasOwnProperty.call(
        sketch.entities,
        source.entity,
      )
    ) {
      return undefined;
    }
    return {
      kind: "sketch-entity",
      sketch: node,
      entity: expectedEntity,
    };
  } catch {
    return undefined;
  }
}

const ARC_GAP_HINT =
  "With the reference solver, arc endpoints follow the arc center, radius, and authored start and end angles; constraints that change a loop arc's radius or move its center do not move the adjacent line endpoints. Drive those endpoints from the same expressions, or constrain them to the arc center with distanceX and distanceY.";

/**
 * Keeps the established profile-scoped closure diagnostic and adds the first
 * gap's resolved curve indices, its size, and, where solver provenance matches
 * the authored loop, the entities on either side.
 */
function openLoopDiagnostic(
  node: NodeId,
  sketch: SketchNodeIR,
  tolerance: number,
  issue: ResolvedProfileRegionValidationIssue,
  profilePath: string,
): Diagnostic {
  const sides = [
    [issue.curveSource, issue.curveIndex],
    [issue.otherCurveSource, issue.otherCurveIndex],
  ] as const;
  const sources = sides.map(([source, curveIndex]) =>
    admittedProfileCurveSource(
      node,
      sketch,
      source,
      issue.loop,
      issue.holeIndex,
      curveIndex,
    ),
  );
  const related = sources.flatMap((source, index) =>
    source === undefined
      ? []
      : [
          {
            node,
            path: `/nodes/${jsonPointerSegment(node)}/entities/${jsonPointerSegment(source.entity)}`,
            message:
              index === 0
                ? "Profile boundary entity before the gap"
                : "Profile boundary entity after the gap",
          },
        ],
  );
  // Only provenance-confirmed sides name an authored entity; a solver whose
  // resolved curves do not follow the authored loop gets no arc hint.
  const touchesArc = sources.some(
    (source) =>
      source !== undefined && sketch.entities[source.entity]?.kind === "arc",
  );
  const [curveSource, otherCurveSource] = sources;
  return diagnostic(
    "SKETCH_NO_CLOSED_REGION",
    "Sketch did not produce a closed region",
    {
      severity: "error",
      node,
      path: profilePath,
      ...(related.length === 0 ? {} : { related }),
      ...(touchesArc ? { hints: [ARC_GAP_HINT] } : {}),
      details: {
        phase: "sketch-profile-validation",
        reason: issue.reason,
        loopIssueReason: "open-loop",
        tolerance,
        indexSpace: "resolved-profile",
        ...(issue.loop === undefined ? {} : { loop: issue.loop }),
        ...(issue.holeIndex === undefined
          ? {}
          : { holeIndex: issue.holeIndex }),
        ...(issue.curveIndex === undefined
          ? {}
          : { curveIndex: issue.curveIndex }),
        ...(issue.otherCurveIndex === undefined
          ? {}
          : { otherCurveIndex: issue.otherCurveIndex }),
        ...(issue.gap === undefined ? {} : { gap: issue.gap }),
        ...(curveSource === undefined ? {} : { curveSource }),
        ...(otherCurveSource === undefined ? {} : { otherCurveSource }),
      },
    },
  );
}

export function resolvedProfileRegionDiagnostic(
  node: NodeId,
  sketch: SketchNodeIR,
  tolerance: number,
  issue: ResolvedProfileRegionValidationIssue,
): Diagnostic {
  const profilePath = `/nodes/${node}/profile`;
  if (issue.reason === "evaluation-aborted") {
    return diagnostic(
      "EVALUATION_ABORTED",
      "CAD evaluation was aborted during sketch profile validation",
      {
        severity: "error",
        node,
        path: profilePath,
        details: {
          phase: "sketch-profile-validation",
          reason: issue.reason,
          workUnits: issue.workUnits,
          maxWorkUnits: issue.maxWorkUnits,
        },
      },
    );
  }
  if (
    issue.reason === "validation-work-limit" ||
    issue.reason === "invalid-work-limit"
  ) {
    return diagnostic(
      "RESOURCE_LIMIT_EXCEEDED",
      issue.message,
      {
        severity: "error",
        node,
        path: profilePath,
        details: {
          phase: "sketch-profile-validation",
          resource: "profileRegionWorkUnits",
          limit: issue.maxWorkUnits,
          actual: issue.workUnits + 1,
          reason: issue.reason,
        },
      },
    );
  }
  if (
    issue.reason === "invalid-loop" &&
    issue.loopIssueReason === "open-loop"
  ) {
    return openLoopDiagnostic(node, sketch, tolerance, issue, profilePath);
  }

  const curveSource = admittedProfileCurveSource(
    node,
    sketch,
    issue.curveSource,
    issue.loop,
    issue.holeIndex,
    issue.curveIndex,
  );
  const otherHoleIndex =
    issue.otherLoop === "hole"
      ? issue.otherHoleIndex ?? issue.holeIndex
      : undefined;
  const otherCurveSource = admittedProfileCurveSource(
    node,
    sketch,
    issue.otherCurveSource,
    issue.otherLoop,
    otherHoleIndex,
    issue.otherCurveIndex,
  );
  const path =
    curveSource === undefined
      ? profilePath
      : `/nodes/${node}/entities/${curveSource.entity}`;
  const related =
    otherCurveSource === undefined
      ? undefined
      : [
          {
            node,
            path: `/nodes/${node}/entities/${otherCurveSource.entity}`,
            message: "Conflicting profile boundary entity",
          },
        ];
  return diagnostic("SKETCH_NO_CLOSED_REGION", issue.message, {
    severity: "error",
    node,
    path,
    ...(related === undefined ? {} : { related }),
    details: {
      phase: "sketch-profile-validation",
      reason: issue.reason,
      tolerance,
      indexSpace: "resolved-profile",
      ...(issue.loop === undefined ? {} : { loop: issue.loop }),
      ...(issue.otherLoop === undefined
        ? {}
        : { otherLoop: issue.otherLoop }),
      ...(issue.holeIndex === undefined
        ? {}
        : { holeIndex: issue.holeIndex }),
      ...(issue.otherHoleIndex === undefined
        ? {}
        : { otherHoleIndex: issue.otherHoleIndex }),
      ...(issue.nestedHoleIndex === undefined
        ? {}
        : { nestedHoleIndex: issue.nestedHoleIndex }),
      ...(issue.curveIndex === undefined
        ? {}
        : { curveIndex: issue.curveIndex }),
      ...(issue.otherCurveIndex === undefined
        ? {}
        : { otherCurveIndex: issue.otherCurveIndex }),
      ...(issue.connectorAfterCurve === undefined
        ? {}
        : { connectorAfterCurve: issue.connectorAfterCurve }),
      ...(issue.otherConnectorAfterCurve === undefined
        ? {}
        : {
            otherConnectorAfterCurve:
              issue.otherConnectorAfterCurve,
          }),
      ...(issue.loopIssueReason === undefined
        ? {}
        : { loopIssueReason: issue.loopIssueReason }),
      ...(curveSource === undefined
        ? {}
        : { curveSource }),
      ...(otherCurveSource === undefined
        ? {}
        : { otherCurveSource }),
    },
  });
}
