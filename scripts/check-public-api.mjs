import { mkdir } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import {
  PUBLIC_ENTRYPOINTS,
  validatePublicEntrypoints,
} from "./public-entrypoints.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const update = process.argv.includes("--write");
const check = process.argv.includes("--check");

if (update === check) {
  console.error("Usage: node scripts/check-public-api.mjs (--check | --write)");
  process.exit(2);
}

await validatePublicEntrypoints({ allowMissingReports: update });

await Promise.all([
  mkdir(new URL("../etc/api/", import.meta.url), { recursive: true }),
  mkdir(new URL("../.artifacts/api/", import.meta.url), { recursive: true }),
]);

let errorCount = 0;
let warningCount = 0;
for (const entrypoint of PUBLIC_ENTRYPOINTS) {
  const configPath = fileURLToPath(
    new URL(`../${entrypoint.apiExtractorConfig}`, import.meta.url),
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

if (update) await validatePublicEntrypoints();

console.log(
  update
    ? `Updated ${PUBLIC_ENTRYPOINTS.length} public API reports under ${root}etc/api${
        warningCount === 0 ? "." : ` (${warningCount} expected update warning(s)).`
      }`
    : `Verified ${PUBLIC_ENTRYPOINTS.length} public API reports.`,
);
