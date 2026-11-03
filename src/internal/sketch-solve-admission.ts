import type { EntityId, NodeId } from "../core/ids.js";
import { diagnostic, type Diagnostic } from "../core/result.js";
import type {
  SketchConstraintIR,
  SketchEntityIR,
  SketchNodeIR,
} from "../ir.js";
import type {
  SketchSolverBackend,
  SketchSolveStatus,
  SolvedSketch,
} from "../solver.js";
import { jsonPointerSegment } from "../core/json-pointer.js";

const ADMITTED_SKETCH_SOLVE_STATUSES: ReadonlySet<unknown> = new Set<
  SketchSolveStatus
>(["solved", "underconstrained"]);

const KNOWN_SKETCH_SOLVE_STATUSES: ReadonlySet<unknown> = new Set<
  SketchSolveStatus
>([
  "solved",
  "underconstrained",
  "overconstrained",
  "nonconvergent",
  "invalid",
]);

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function declares(values: unknown, kind: string): boolean {
  return Array.isArray(values) && values.includes(kind);
}

/**
 * Rejects a sketch whose entity or constraint kinds the configured solver does
 * not advertise, before the solver is asked to interpret them.
 */
export function sketchSolverCapabilityDiagnostic(
  solver: SketchSolverBackend,
  sketch: SketchNodeIR,
  node: NodeId,
): Diagnostic | undefined {
  const capabilities = solver.capabilities as Partial<
    SketchSolverBackend["capabilities"]
  > | null | undefined;
  const missing = (
    collection: "entities" | "constraints",
    id: EntityId,
    kind: SketchEntityIR["kind"] | SketchConstraintIR["kind"],
  ): Diagnostic =>
    diagnostic(
      "KERNEL_CAPABILITY_MISSING",
      `Sketch solver '${solver.id}' does not support ${collection === "entities" ? "entity" : "constraint"} '${kind}'`,
      {
        severity: "error",
        node,
        path: `/nodes/${jsonPointerSegment(node)}/${collection}/${jsonPointerSegment(id)}`,
        hints: ["Choose a sketch solver that advertises this capability"],
        details: {
          sketchSolver: solver.id,
          kind: collection === "entities" ? "entity" : "constraint",
          capability: kind,
        },
      },
    );
  for (const [id, entity] of (
    Object.entries(sketch.entities) as [EntityId, SketchEntityIR][]
  ).sort(([first], [second]) => lexicalCompare(first, second))) {
    if (!declares(capabilities?.entities, entity.kind)) {
      return missing("entities", id, entity.kind);
    }
  }
  for (const [id, constraint] of (
    Object.entries(sketch.constraints) as [EntityId, SketchConstraintIR][]
  ).sort(([first], [second]) => lexicalCompare(first, second))) {
    if (!declares(capabilities?.constraints, constraint.kind)) {
      return missing("constraints", id, constraint.kind);
    }
  }
  return undefined;
}

/**
 * Selects the node-scoped failure for a solve that must not produce geometry.
 *
 * The solver's own first error diagnostic wins. Otherwise `status` is
 * authoritative: only `solved` and `underconstrained` with a finite residual
 * are admitted, and every other value, including one outside the declared
 * union, fails with a structured diagnostic instead of trusting the profile.
 */
export function sketchSolveFailureDiagnostic(
  solver: SketchSolverBackend,
  solved: SolvedSketch,
  diagnostics: readonly Diagnostic[],
  node: NodeId,
): Diagnostic | undefined {
  const reported = diagnostics.find((item) => item.severity === "error");
  if (reported !== undefined) return reported;
  const status: unknown = solved.status;
  const residual: unknown = solved.residual;
  if (
    ADMITTED_SKETCH_SOLVE_STATUSES.has(status) &&
    typeof residual === "number" &&
    Number.isFinite(residual)
  ) {
    return undefined;
  }
  const knownStatus = KNOWN_SKETCH_SOLVE_STATUSES.has(status)
    ? (status as SketchSolveStatus)
    : undefined;
  const nonFiniteResidual =
    knownStatus !== undefined && ADMITTED_SKETCH_SOLVE_STATUSES.has(knownStatus);
  const details = {
    sketchSolver: solver.id,
    status: knownStatus ?? "unrecognized",
    ...(nonFiniteResidual ? { reason: "non-finite-residual" } : {}),
  };
  if (knownStatus === "overconstrained") {
    return diagnostic(
      "SKETCH_OVER_CONSTRAINED",
      `Sketch solver '${solver.id}' reported overconstrained constraints`,
      {
        severity: "error",
        node,
        path: `/nodes/${jsonPointerSegment(node)}/constraints`,
        details,
      },
    );
  }
  return diagnostic(
    "SKETCH_SOLVE_FAILED",
    knownStatus === undefined
      ? `Sketch solver '${solver.id}' returned an unrecognized solve status`
      : nonFiniteResidual
        ? `Sketch solver '${solver.id}' returned a non-finite residual`
        : `Sketch solver '${solver.id}' reported a ${knownStatus} solve`,
    {
      severity: "error",
      node,
      path: `/nodes/${jsonPointerSegment(node)}`,
      details,
    },
  );
}
