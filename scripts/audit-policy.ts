/** One finding from `pnpm audit --json`. */
export interface AuditFinding {
  readonly version: string;
  readonly paths: readonly string[];
  readonly dev: boolean;
}

/** One advisory from `pnpm audit --json`. */
export interface AuditAdvisory {
  readonly github_advisory_id: string;
  readonly module_name: string;
  readonly findings: readonly AuditFinding[];
}

/**
 * An advisory with no installable fix, tolerated only while every finding is
 * a listed version of `module`, is a development dependency, and is reached
 * exclusively through the root dependency `via`.
 */
export interface DocumentedAuditException {
  readonly advisory: string;
  readonly module: string;
  readonly versions: readonly string[];
  readonly via: string;
  readonly reason: string;
}

export const DOCUMENTED_AUDIT_EXCEPTIONS: readonly DocumentedAuditException[] =
  Object.freeze([
    Object.freeze({
      advisory: "GHSA-mrhx-c7xc-m3w5",
      module: "zod",
      versions: Object.freeze(["3.24.0", "3.25.76"]),
      via: "mint",
      reason:
        "Every published mint release pins zod 3, which has no patched " +
        "release; mint is documentation tooling that is neither shipped nor " +
        "imported at runtime.",
    }),
  ]);

export interface AuditPolicyEvaluation {
  /** Advisories that no documented exception fully covers. */
  readonly unexcepted: readonly AuditAdvisory[];
  /** Exceptions that covered at least one advisory. */
  readonly matched: readonly DocumentedAuditException[];
  /** Exceptions that no longer match anything and must be removed. */
  readonly stale: readonly DocumentedAuditException[];
}

function findingIsExcepted(
  exception: DocumentedAuditException,
  finding: AuditFinding,
): boolean {
  return (
    finding.dev === true &&
    exception.versions.includes(finding.version) &&
    finding.paths.length > 0 &&
    finding.paths.every((path) => path.startsWith(`.>${exception.via}>`))
  );
}

/** Applies the zero-advisory policy and its documented exceptions. */
export function evaluateAuditAdvisories(
  advisories: readonly AuditAdvisory[],
  exceptions: readonly DocumentedAuditException[] = DOCUMENTED_AUDIT_EXCEPTIONS,
): AuditPolicyEvaluation {
  const unexcepted: AuditAdvisory[] = [];
  const matched = new Set<DocumentedAuditException>();
  for (const advisory of advisories) {
    const exception = exceptions.find(
      (entry) =>
        entry.advisory === advisory.github_advisory_id &&
        entry.module === advisory.module_name,
    );
    if (
      exception !== undefined &&
      advisory.findings.length > 0 &&
      advisory.findings.every((finding) =>
        findingIsExcepted(exception, finding),
      )
    ) {
      matched.add(exception);
    } else {
      unexcepted.push(advisory);
    }
  }
  return {
    unexcepted,
    matched: [...matched],
    stale: exceptions.filter((entry) => !matched.has(entry)),
  };
}
