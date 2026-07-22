import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const audit = spawnSync(command, ["audit", "--json"], {
  encoding: "utf8",
});

if (audit.error !== undefined) throw audit.error;

if (audit.status !== 0) {
  process.stderr.write(audit.stdout);
  process.stderr.write(audit.stderr);
  console.error("Repository dependencies must have zero known advisories.");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stdout);
  process.stderr.write(audit.stderr);
  throw new Error("pnpm audit did not return valid JSON");
}

const advisories = Object.values(report.advisories ?? {});
if (advisories.length !== 0) {
  console.error("Dependency audit returned advisories with a successful status.");
  process.exit(1);
}

console.log("Full dependency audit passed with zero advisories.");
