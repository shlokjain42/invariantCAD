import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const audit = spawnSync(command, ["audit", "--prod", "--json"], {
  encoding: "utf8",
});

if (audit.error !== undefined) {
  throw audit.error;
}

if (audit.status === 0) {
  console.log("Production dependency audit passed with no advisories.");
  process.exit(0);
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  process.stderr.write(audit.stderr);
  throw new Error("pnpm audit did not return valid JSON");
}

const advisories = Object.values(report.advisories ?? {});
const allowed = [];
const unexpected = [];

for (const advisory of advisories) {
  const findings = Array.isArray(advisory.findings) ? advisory.findings : [];
  const paths = findings.flatMap((finding) =>
    Array.isArray(finding.paths) ? finding.paths : [],
  );
  const versions = findings.map((finding) => finding.version);
  const isReviewedSharpAdvisory =
    advisory.github_advisory_id === "GHSA-f88m-g3jw-g9cj" &&
    advisory.module_name === "sharp" &&
    advisory.severity === "high" &&
    advisory.vulnerable_versions === "<0.35.0" &&
    versions.length === 1 &&
    versions[0] === "0.34.5" &&
    paths.length === 1 &&
    paths[0].endsWith(
      "manifold-3d>@gltf-transform/functions>ndarray-pixels>sharp",
    );

  (isReviewedSharpAdvisory ? allowed : unexpected).push(advisory);
}

if (unexpected.length > 0 || allowed.length !== 1) {
  console.error("Production dependency audit found an unreviewed change.");
  for (const advisory of unexpected) {
    console.error(
      "- " +
        String(advisory.github_advisory_id ?? advisory.id) +
        " " +
        String(advisory.module_name ?? "unknown") +
        " (" +
        String(advisory.severity ?? "unknown") +
        ")",
    );
  }
  process.exit(1);
}

const why = spawnSync(command, ["why", "--prod", "--json", "sharp"], {
  encoding: "utf8",
});
if (why.error !== undefined) {
  throw why.error;
}
if (why.status !== 0) {
  process.stderr.write(why.stderr);
  throw new Error("pnpm why could not verify the reviewed dependency chain");
}

let whyReport;
try {
  whyReport = JSON.parse(why.stdout);
} catch {
  process.stderr.write(why.stderr);
  throw new Error("pnpm why did not return valid JSON");
}

const expectedChain = [
  ["sharp", "0.34.5"],
  ["ndarray-pixels", "5.0.1"],
  ["@gltf-transform/functions", "4.4.1"],
  ["manifold-3d", "3.5.1"],
];
let nodes = whyReport;
for (const [name, version] of expectedChain) {
  if (!Array.isArray(nodes) || nodes.length !== 1) {
    console.error("Production dependency audit path is no longer unique.");
    process.exit(1);
  }
  const node = nodes[0];
  if (node?.name !== name || node?.version !== version) {
    console.error(
      `Production dependency audit expected ${name}@${version}, received ` +
        `${String(node?.name)}@${String(node?.version)}.`,
    );
    process.exit(1);
  }
  nodes = node.dependents;
}

if (
  !Array.isArray(nodes) ||
  nodes.length !== 1 ||
  nodes[0]?.name !== "invariantcad" ||
  nodes[0]?.depField !== "dependencies"
) {
  console.error(
    "Production dependency audit no longer ends at invariantcad dependencies.",
  );
  process.exit(1);
}

console.warn(
  "Production audit contains the reviewed GHSA-f88m-g3jw-g9cj exception: " +
    "sharp 0.34.5 is installed only through Manifold's unused glTF/image " +
    "toolchain. See SECURITY.md. Any advisory or dependency-path change " +
    "fails this check for fresh review.",
);
