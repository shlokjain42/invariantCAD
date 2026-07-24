import { readdir, readFile } from "node:fs/promises";

const apiExtractorDirectory = "config/api-extractor";
const apiReportDirectory = "etc/api";

export const PUBLIC_ENTRYPOINTS = Object.freeze([
  Object.freeze({
    exportKey: ".",
    packageName: "invariantcad",
    source: "src/index.ts",
    apiExtractorConfig: "config/api-extractor/root.json",
    apiReport: "etc/api/invariantcad.api.md",
    importTarget: "./dist/index.js",
    typesTarget: "./dist/index.d.ts",
  }),
  Object.freeze({
    exportKey: "./conformance",
    packageName: "invariantcad/conformance",
    source: "src/conformance.ts",
    apiExtractorConfig: "config/api-extractor/conformance.json",
    apiReport: "etc/api/conformance.api.md",
    importTarget: "./dist/conformance.js",
    typesTarget: "./dist/conformance.d.ts",
  }),
  Object.freeze({
    exportKey: "./kernels/occt",
    packageName: "invariantcad/kernels/occt",
    source: "src/occt-kernel.ts",
    apiExtractorConfig: "config/api-extractor/occt.json",
    apiReport: "etc/api/kernels-occt.api.md",
    importTarget: "./dist/occt-kernel.js",
    typesTarget: "./dist/occt-kernel.d.ts",
  }),
  Object.freeze({
    exportKey: "./kernels/occt/browser",
    packageName: "invariantcad/kernels/occt/browser",
    source: "src/occt-runtime-browser.ts",
    apiExtractorConfig: "config/api-extractor/occt-browser.json",
    apiReport: "etc/api/kernels-occt-browser.api.md",
    importTarget: "./dist/occt-runtime-browser.js",
    typesTarget: "./dist/occt-runtime-browser.d.ts",
  }),
  Object.freeze({
    exportKey: "./kernels/occt/node",
    packageName: "invariantcad/kernels/occt/node",
    source: "src/occt-runtime-node.ts",
    apiExtractorConfig: "config/api-extractor/occt-node.json",
    apiReport: "etc/api/kernels-occt-node.api.md",
    importTarget: "./dist/occt-runtime-node.js",
    typesTarget: "./dist/occt-runtime-node.d.ts",
  }),
]);

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sameValues(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function describeValues(values) {
  return values.length === 0 ? "(none)" : values.join(", ");
}

async function readJson(projectPath, diagnostics) {
  try {
    return JSON.parse(await readFile(new URL(`../${projectPath}`, import.meta.url), "utf8"));
  } catch (error) {
    diagnostics.push(
      `${projectPath} could not be read as JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
}

async function assertFile(projectPath, diagnostics) {
  try {
    await readFile(new URL(`../${projectPath}`, import.meta.url));
  } catch {
    diagnostics.push(`${projectPath} does not exist or is not readable`);
  }
}

function checkUnique(entries, field, diagnostics) {
  const seen = new Set();
  for (const entry of entries) {
    const value = entry[field];
    if (seen.has(value)) {
      diagnostics.push(`public entry-point manifest repeats ${field} '${value}'`);
    }
    seen.add(value);
  }
}

function expectedPackageName(packageName, exportKey) {
  return exportKey === "." ? packageName : `${packageName}/${exportKey.slice(2)}`;
}

async function checkDirectoryCoverage(
  directory,
  extension,
  ignoredNames,
  expectedPaths,
  allowMissing,
  diagnostics,
) {
  let names;
  try {
    names = await readdir(new URL(`../${directory}/`, import.meta.url));
  } catch {
    diagnostics.push(`${directory} does not exist or is not readable`);
    return;
  }

  const actual = sorted(
    names
      .filter((name) => name.endsWith(extension) && !ignoredNames.has(name))
      .map((name) => `${directory}/${name}`),
  );
  const expected = sorted(expectedPaths);
  const extras = actual.filter((path) => !expected.includes(path));
  const missing = expected.filter((path) => !actual.includes(path));

  if (extras.length !== 0 || (!allowMissing && missing.length !== 0)) {
    diagnostics.push(
      `${directory} coverage drifted; expected ${describeValues(expected)}, received ${describeValues(actual)}`,
    );
  }
}

export async function validatePublicEntrypoints(options = {}) {
  const allowMissingReports = options.allowMissingReports === true;
  const diagnostics = [];
  const packageJson = await readJson("package.json", diagnostics);

  for (const field of [
    "exportKey",
    "packageName",
    "source",
    "apiExtractorConfig",
    "apiReport",
    "importTarget",
    "typesTarget",
  ]) {
    checkUnique(PUBLIC_ENTRYPOINTS, field, diagnostics);
  }

  if (
    packageJson === undefined ||
    typeof packageJson.name !== "string" ||
    packageJson.exports === null ||
    typeof packageJson.exports !== "object" ||
    Array.isArray(packageJson.exports)
  ) {
    diagnostics.push("package.json must declare a package name and object export map");
  } else {
    const packageExportKeys = sorted(
      Object.keys(packageJson.exports).filter((key) => key !== "./package.json"),
    );
    const manifestExportKeys = sorted(
      PUBLIC_ENTRYPOINTS.map((entry) => entry.exportKey),
    );
    if (!sameValues(packageExportKeys, manifestExportKeys)) {
      diagnostics.push(
        `package.json JavaScript export coverage drifted; expected ${describeValues(
          manifestExportKeys,
        )}, received ${describeValues(packageExportKeys)}`,
      );
    }

    for (const entry of PUBLIC_ENTRYPOINTS) {
      const expectedName = expectedPackageName(packageJson.name, entry.exportKey);
      if (entry.packageName !== expectedName) {
        diagnostics.push(
          `${entry.exportKey} packageName must be '${expectedName}', received '${entry.packageName}'`,
        );
      }

      const packageExport = packageJson.exports[entry.exportKey];
      if (
        packageExport === null ||
        typeof packageExport !== "object" ||
        Array.isArray(packageExport)
      ) {
        diagnostics.push(
          `package.json exports['${entry.exportKey}'] must be an object with types and import targets`,
        );
        continue;
      }
      const conditions = Object.keys(packageExport);
      if (!sameValues(conditions, ["types", "import"])) {
        diagnostics.push(
          `package.json exports['${entry.exportKey}'] conditions must be ordered as types, import; received ${describeValues(
            conditions,
          )}`,
        );
      }
      if (packageExport.types !== entry.typesTarget) {
        diagnostics.push(
          `${entry.exportKey} types target must be '${entry.typesTarget}', received '${String(
            packageExport.types,
          )}'`,
        );
      }
      if (packageExport.import !== entry.importTarget) {
        diagnostics.push(
          `${entry.exportKey} import target must be '${entry.importTarget}', received '${String(
            packageExport.import,
          )}'`,
        );
      }
    }

    const rootEntrypoint = PUBLIC_ENTRYPOINTS.find(
      (entry) => entry.exportKey === ".",
    );
    if (rootEntrypoint !== undefined) {
      for (const field of ["main", "module"]) {
        if (packageJson[field] !== rootEntrypoint.importTarget) {
          diagnostics.push(
            `package.json ${field} must be '${rootEntrypoint.importTarget}', received '${String(
              packageJson[field],
            )}'`,
          );
        }
      }
      if (packageJson.types !== rootEntrypoint.typesTarget) {
        diagnostics.push(
          `package.json types must be '${rootEntrypoint.typesTarget}', received '${String(
            packageJson.types,
          )}'`,
        );
      }
    }
  }

  await checkDirectoryCoverage(
    apiExtractorDirectory,
    ".json",
    new Set(["base.json"]),
    PUBLIC_ENTRYPOINTS.map((entry) => entry.apiExtractorConfig),
    false,
    diagnostics,
  );
  await checkDirectoryCoverage(
    apiReportDirectory,
    ".api.md",
    new Set(),
    PUBLIC_ENTRYPOINTS.map((entry) => entry.apiReport),
    allowMissingReports,
    diagnostics,
  );

  for (const entry of PUBLIC_ENTRYPOINTS) {
    await assertFile(entry.source, diagnostics);
    const extractorConfig = await readJson(entry.apiExtractorConfig, diagnostics);
    if (extractorConfig === undefined) continue;

    if (extractorConfig.extends !== "./base.json") {
      diagnostics.push(
        `${entry.apiExtractorConfig} must extend './base.json'`,
      );
    }
    const expectedEntryPoint = `<projectFolder>/${entry.typesTarget.slice(2)}`;
    if (extractorConfig.mainEntryPointFilePath !== expectedEntryPoint) {
      diagnostics.push(
        `${entry.apiExtractorConfig} mainEntryPointFilePath must be '${expectedEntryPoint}', received '${String(
          extractorConfig.mainEntryPointFilePath,
        )}'`,
      );
    }
    const expectedReportFileName = entry.apiReport
      .slice(`${apiReportDirectory}/`.length)
      .replace(/\.api\.md$/u, "");
    if (extractorConfig.apiReport?.reportFileName !== expectedReportFileName) {
      diagnostics.push(
        `${entry.apiExtractorConfig} apiReport.reportFileName must be '${expectedReportFileName}', received '${String(
          extractorConfig.apiReport?.reportFileName,
        )}'`,
      );
    }
  }

  if (diagnostics.length !== 0) {
    throw new Error(
      `Public entry-point manifest validation failed:\n${diagnostics
        .map((diagnostic) => `- ${diagnostic}`)
        .join("\n")}`,
    );
  }

  return Object.freeze({
    packageName: packageJson.name,
    entrypointCount: PUBLIC_ENTRYPOINTS.length,
  });
}
