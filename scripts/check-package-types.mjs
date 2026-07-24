import {
  checkPackage,
  createPackageFromTarballData,
} from "@arethetypeswrong/core";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ignoredResolutionKinds = new Set(["node10", "node16-cjs"]);

async function main() {
  const packageDirectory = resolve(".");
  const manifest = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8"),
  );
  const stagingDirectory = await mkdtemp(join(tmpdir(), "invariantcad-attw-"));
  const archiveName =
    `${manifest.name.replace("@", "").replace("/", "-")}-` +
    `${manifest.version}.tgz`;

  let analysis;
  try {
    execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["pack", "--pack-destination", stagingDirectory],
      { cwd: packageDirectory, stdio: "ignore" },
    );
    const tarball = new Uint8Array(
      await readFile(join(stagingDirectory, archiveName)),
    );
    analysis = await checkPackage(createPackageFromTarballData(tarball));
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }

  if (analysis.types === false) {
    console.log(
      `ATTW esm-only: ${analysis.packageName}@${analysis.packageVersion} ` +
        "has no types to analyze.",
    );
    return;
  }

  const failures = analysis.problems.filter(
    (problem) =>
      !(
        "resolutionKind" in problem &&
        ignoredResolutionKinds.has(problem.resolutionKind)
      ),
  );

  if (failures.length === 0) {
    const ignoredCount = analysis.problems.length;
    console.log(
      `ATTW esm-only: ${analysis.packageName}@${analysis.packageVersion} ` +
        `passed (${ignoredCount} ignored CJS/Node 10 finding` +
        `${ignoredCount === 1 ? "" : "s"}).`,
    );
    return;
  }

  console.error(
    `ATTW esm-only: ${analysis.packageName}@${analysis.packageVersion} ` +
      `failed with ${failures.length} problem` +
      `${failures.length === 1 ? "" : "s"}:`,
  );
  for (const problem of failures) {
    console.error(`\n- ${problem.kind}`);
    console.error(JSON.stringify(problem, undefined, 2));
  }
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error("ATTW esm-only check could not run.");
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 3;
}
