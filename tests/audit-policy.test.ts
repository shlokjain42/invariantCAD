import { describe, expect, it } from "vitest";
import {
  DOCUMENTED_AUDIT_EXCEPTIONS,
  evaluateAuditAdvisories,
  type AuditAdvisory,
} from "../scripts/audit-policy.js";

function zodAdvisory(
  findings: AuditAdvisory["findings"],
  id = "GHSA-mrhx-c7xc-m3w5",
): AuditAdvisory {
  return { github_advisory_id: id, module_name: "zod", findings };
}

const mintPath =
  ".>mint>@mintlify/cli>@mintlify/common>@mintlify/validation>zod";

describe("dependency audit policy", () => {
  it("documents exactly one dev-only exception reached through mint", () => {
    expect(DOCUMENTED_AUDIT_EXCEPTIONS).toEqual([
      expect.objectContaining({
        advisory: "GHSA-mrhx-c7xc-m3w5",
        module: "zod",
        versions: ["3.24.0", "3.25.76"],
        via: "mint",
      }),
    ]);
    expect(Object.isFrozen(DOCUMENTED_AUDIT_EXCEPTIONS)).toBe(true);
  });

  it("admits the documented advisory only when every finding is dev-only through mint", () => {
    const admitted = evaluateAuditAdvisories([
      zodAdvisory([
        { version: "3.24.0", paths: [mintPath], dev: true },
        { version: "3.25.76", paths: [`${mintPath}-alias`], dev: true },
      ]),
    ]);
    expect(admitted.unexcepted).toEqual([]);
    expect(admitted.matched).toEqual(DOCUMENTED_AUDIT_EXCEPTIONS);
    expect(admitted.stale).toEqual([]);
  });

  it("fails closed on runtime, other-root, unlisted-version, and other advisories", () => {
    for (const advisory of [
      zodAdvisory([{ version: "3.24.0", paths: [mintPath], dev: false }]),
      zodAdvisory([
        { version: "3.24.0", paths: [mintPath, ".>zod"], dev: true },
      ]),
      zodAdvisory([{ version: "4.4.3", paths: [".>zod"], dev: false }]),
      zodAdvisory([{ version: "4.3.6", paths: [mintPath], dev: true }]),
      zodAdvisory([{ version: "3.24.0", paths: [], dev: true }]),
      zodAdvisory([]),
      zodAdvisory(
        [{ version: "3.24.0", paths: [mintPath], dev: true }],
        "GHSA-0000-0000-0000",
      ),
      {
        github_advisory_id: "GHSA-mrhx-c7xc-m3w5",
        module_name: "not-zod",
        findings: [{ version: "3.24.0", paths: [mintPath], dev: true }],
      },
    ]) {
      const evaluation = evaluateAuditAdvisories([advisory]);
      expect(evaluation.unexcepted).toEqual([advisory]);
    }
  });

  it("reports an exception as stale once nothing matches it", () => {
    expect(evaluateAuditAdvisories([]).stale).toEqual(
      DOCUMENTED_AUDIT_EXCEPTIONS,
    );
  });
});
