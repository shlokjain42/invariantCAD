import { spawnSync } from "node:child_process";
import {
  evaluateAuditAdvisories,
  type AuditAdvisory,
} from "./audit-policy.js";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const audit = spawnSync(command, ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

if (audit.error !== undefined) throw audit.error;

let report: { readonly advisories?: Readonly<Record<string, AuditAdvisory>> };
try {
  report = JSON.parse(audit.stdout) as typeof report;
} catch {
  process.stderr.write(audit.stdout);
  process.stderr.write(audit.stderr);
  throw new Error("pnpm audit did not return valid JSON");
}

const advisories = Object.values(report.advisories ?? {});
if (advisories.length === 0 && audit.status !== 0) {
  process.stderr.write(audit.stdout);
  process.stderr.write(audit.stderr);
  console.error("pnpm audit failed without reporting advisories.");
  process.exit(1);
}

const evaluation = evaluateAuditAdvisories(advisories);
if (evaluation.unexcepted.length !== 0) {
  process.stderr.write(
    `${JSON.stringify({ advisories: evaluation.unexcepted }, null, 2)}\n`,
  );
  console.error(
    "Repository dependencies must have zero known advisories outside documented exceptions.",
  );
  process.exit(1);
}
if (evaluation.stale.length !== 0) {
  console.error(
    "Remove documented audit exceptions that no longer match: " +
      evaluation.stale.map((entry) => entry.advisory).join(", "),
  );
  process.exit(1);
}

console.log(
  evaluation.matched.length === 0
    ? "Full dependency audit passed with zero advisories."
    : "Full dependency audit passed; only documented exceptions remain: " +
        evaluation.matched
          .map((entry) => `${entry.advisory} (${entry.module} via ${entry.via})`)
          .join(", ") +
        ".",
);
