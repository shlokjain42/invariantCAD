import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DOCUMENTED_AUDIT_EXCEPTIONS,
  evaluateAuditAdvisories,
  pnpmAuditCommand,
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
    ]);
    expect(Object.isFrozen(DOCUMENTED_AUDIT_EXCEPTIONS)).toBe(true);
  });

  it("admits the documented advisories only when every finding is dev-only through mint", () => {
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

  it("no longer excepts minimatch 3.1.5, which the advisory stopped covering", () => {
    // GHSA-g3hv-75wg-m249 was narrowed to >= 7.0.0, < 11.0.1 on 2026-11-04,
    // so a finding for the minimatch 3 inside mint must now fail the audit.
    const advisory = minimatchAdvisory([
      { version: "3.1.5", paths: [minimatchMintPath], dev: true },
    ]);
    expect(evaluateAuditAdvisories([advisory]).unexcepted).toEqual([advisory]);
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

  it("runs pnpm audit through a shell only on Windows, without separate arguments", () => {
    // Node refuses to spawn the pnpm.cmd shim without a shell (CVE-2024-27980),
    // and passing arguments alongside shell: true is deprecated (DEP0190).
    expect(pnpmAuditCommand("win32")).toEqual({
      command: "pnpm audit --json",
      args: [],
      shell: true,
    });
    for (const platform of ["linux", "darwin", "freebsd"] as const) {
      expect(pnpmAuditCommand(platform)).toEqual({
        command: "pnpm",
        args: ["audit", "--json"],
        shell: false,
      });
    }
  });
});
