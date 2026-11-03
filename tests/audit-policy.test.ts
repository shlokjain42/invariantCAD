import { readFileSync } from "node:fs";
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
const minimatchMintPath =
  ".>mint>@mintlify/cli>@mintlify/common>sucrase>glob>minimatch";

function minimatchAdvisory(findings: AuditAdvisory["findings"]): AuditAdvisory {
  return {
    github_advisory_id: "GHSA-g3hv-75wg-m249",
    module_name: "minimatch",
    findings,
  };
}

describe("dependency audit policy", () => {
  it("documents only dev-only exceptions reached through mint", () => {
    expect(DOCUMENTED_AUDIT_EXCEPTIONS).toEqual([
      expect.objectContaining({
        advisory: "GHSA-mrhx-c7xc-m3w5",
        module: "zod",
        versions: ["3.24.0", "3.25.76"],
        via: "mint",
      }),
      expect.objectContaining({
        advisory: "GHSA-g3hv-75wg-m249",
        module: "minimatch",
        versions: ["3.1.5"],
        via: "mint",
      }),
    ]);
    expect(Object.isFrozen(DOCUMENTED_AUDIT_EXCEPTIONS)).toBe(true);
  });

  it("admits the documented advisories only when every finding is dev-only through mint", () => {
    const admitted = evaluateAuditAdvisories([
      zodAdvisory([
        { version: "3.24.0", paths: [mintPath], dev: true },
        { version: "3.25.76", paths: [`${mintPath}-alias`], dev: true },
      ]),
      minimatchAdvisory([
        { version: "3.1.5", paths: [minimatchMintPath], dev: true },
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
      minimatchAdvisory([
        {
          version: "10.2.3",
          paths: [".>@microsoft/api-extractor>minimatch"],
          dev: true,
        },
      ]),
      minimatchAdvisory([
        {
          version: "3.1.5",
          paths: [minimatchMintPath, ".>@microsoft/api-extractor>minimatch"],
          dev: true,
        },
      ]),
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

  it.each(["SECURITY.md", "docs/project/security.mdx"])(
    "%s states the declared runtime zod range and every documented exception",
    (path) => {
      const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      const manifest = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ) as { dependencies: Record<string, string> };
      const statedRanges = [...text.matchAll(/`zod` `([^`]+)`/gu)].map(
        (match) => match[1],
      );
      expect(statedRanges.length).toBeGreaterThan(0);
      expect(new Set(statedRanges)).toEqual(new Set([manifest.dependencies.zod]));
      for (const exception of DOCUMENTED_AUDIT_EXCEPTIONS) {
        expect(text).toContain(exception.advisory);
      }
    },
  );
});
