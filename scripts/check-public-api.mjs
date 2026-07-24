import { mkdir } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";

const root = fileURLToPath(new URL("../", import.meta.url));
const update = process.argv.includes("--write");
const check = process.argv.includes("--check");

if (update === check) {
  console.error("Usage: node scripts/check-public-api.mjs (--check | --write)");
  process.exit(2);
}

const configurations = [
  "root.json",
  "conformance.json",
  "occt.json",
  "occt-browser.json",
  "occt-node.json",
];

await Promise.all([
  mkdir(new URL("../etc/api/", import.meta.url), { recursive: true }),
  mkdir(new URL("../.artifacts/api/", import.meta.url), { recursive: true }),
]);

let errorCount = 0;
let warningCount = 0;
for (const file of configurations) {
  const configPath = fileURLToPath(
    new URL(`../config/api-extractor/${file}`, import.meta.url),
  );
  const extractorConfig = ExtractorConfig.loadFileAndPrepare(configPath);
  const result = Extractor.invoke(extractorConfig, {
    localBuild: update,
    showVerboseMessages: false,
  });
  errorCount += result.errorCount;
  warningCount += result.warningCount;
}

if (errorCount > 0) {
  console.error(`Public API analysis failed with ${errorCount} error(s).`);
  process.exit(1);
}

if (check && warningCount > 0) {
  console.error(
    `Public API analysis produced ${warningCount} warning(s); warnings are release-blocking.`,
  );
  process.exit(1);
}

console.log(
  update
    ? `Updated ${configurations.length} public API reports under ${root}etc/api${
        warningCount === 0 ? "." : ` (${warningCount} expected update warning(s)).`
      }`
    : `Verified ${configurations.length} public API reports.`,
);
