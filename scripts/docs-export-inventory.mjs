// Inventory rules for the generated documentation export index.
//
// Public entry points intentionally use explicit named exports. Parsing that
// constrained syntax keeps the generator independent of TypeScript's compiler
// API, which changed in TypeScript 7. The parser fails closed: every
// line-start `export` statement must be consumed by a supported form, and the
// result must name exactly the exports in the entry point's API Extractor
// report, so a public symbol cannot be left out of the index silently.

const blockExportPattern =
  /^export[ \t]+(type[ \t]+)?\{([^{}]*)\}(?:\s*from\s*(["'])([^"'\n]+)\3)?[ \t]*;?[ \t]*$/gm;
const declarationExportPattern =
  /^export[ \t]+(?:(?:declare|abstract|async)[ \t]+)*(const[ \t]+enum|const|let|var|class|function|interface|type|enum)[ \t]+([A-Za-z_$][\w$]*)/gm;
const exportStatementPattern = /^export\b[^\n]*/gm;
const specifierPattern =
  /^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/;
const apiReportDeclarationPattern =
  /^export[ \t]+(?:(?:declare|abstract)[ \t]+)*(?:const[ \t]+enum|const|let|var|class|function|interface|type|enum|namespace)[ \t]+([A-Za-z_$][\w$]*)/;

// An explicit locale keeps the generated order identical on every host; the
// process default locale would reorder rows on, for example, cs-CZ or da-DK.
const exportNameCollator = new Intl.Collator("en");

/** Orders export names identically regardless of the host locale. */
export function compareExportNames(first, second) {
  return (
    exportNameCollator.compare(first, second) ||
    (first < second ? -1 : first > second ? 1 : 0)
  );
}

function blockSpecifiers(body, sourcePath) {
  const uncommented = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const specifiers = [];
  for (const rawSpecifier of uncommented.split(",")) {
    const specifier = rawSpecifier.trim();
    if (specifier === "") continue;
    const match = specifierPattern.exec(specifier);
    if (match === null) {
      throw new Error(`${sourcePath} has an unsupported export: ${specifier}`);
    }
    specifiers.push({
      typeOnly: match[1] !== undefined,
      name: match[3] ?? match[2],
    });
  }
  return specifiers;
}

function declarationKind(declaration) {
  switch (declaration) {
    case "class":
    case "enum":
    case "function":
    case "interface":
    case "type":
      return declaration;
    case "const enum":
      return "enum";
    default:
      return "value";
  }
}

/**
 * Lists the named exports of one entry-point source, sorted by name. Throws
 * for any export statement it cannot attribute to a supported form.
 */
export function collectNamedExports(sourceText, sourcePath) {
  const exports = [];
  const consumed = new Set();

  for (const match of sourceText.matchAll(blockExportPattern)) {
    consumed.add(match.index);
    const blockIsTypeOnly = match[1] !== undefined;
    const source = match[4] ?? "local";
    for (const specifier of blockSpecifiers(match[2], sourcePath)) {
      exports.push({
        name: specifier.name,
        kind: blockIsTypeOnly || specifier.typeOnly ? "type" : "value",
        source,
      });
    }
  }

  for (const match of sourceText.matchAll(declarationExportPattern)) {
    consumed.add(match.index);
    exports.push({
      name: match[2],
      kind: declarationKind(match[1].replace(/[ \t]+/g, " ")),
      source: "local",
    });
  }

  for (const match of sourceText.matchAll(exportStatementPattern)) {
    if (!consumed.has(match.index)) {
      throw new Error(
        `${sourcePath} contains an unsupported export declaration: ${match[0]}`,
      );
    }
  }

  const unique = new Map();
  for (const item of exports) {
    const existing = unique.get(item.name);
    if (existing === undefined) {
      unique.set(item.name, item);
      continue;
    }
    // TypeScript function overloads repeat one local function declaration.
    const overload =
      existing.kind === "function" &&
      item.kind === "function" &&
      existing.source === "local" &&
      item.source === "local";
    if (!overload) {
      throw new Error(`${sourcePath} exports '${item.name}' more than once`);
    }
  }
  return [...unique.values()].sort((first, second) =>
    compareExportNames(first.name, second.name),
  );
}

/** Lists the distinct exported names declared by an API Extractor report. */
export function apiReportExportNames(reportText, reportPath) {
  const names = new Set();
  for (const match of reportText.matchAll(exportStatementPattern)) {
    const statement = match[0];
    const declaration = apiReportDeclarationPattern.exec(statement);
    if (declaration !== null) {
      names.add(declaration[1]);
      continue;
    }
    const block = /^export[ \t]+(?:type[ \t]+)?\{([^{}]*)\}/.exec(statement);
    if (block === null) {
      throw new Error(
        `${reportPath} contains an unsupported export declaration: ${statement}`,
      );
    }
    for (const specifier of blockSpecifiers(block[1], reportPath)) {
      names.add(specifier.name);
    }
  }
  return [...names].sort(compareExportNames);
}

/**
 * Requires a source inventory to name exactly the exports recorded in the
 * entry point's API Extractor report.
 */
export function assertInventoryMatchesApiReport(
  exports,
  reportText,
  sourcePath,
  reportPath,
) {
  const inventoryNames = new Set(exports.map((item) => item.name));
  const reportNames = new Set(apiReportExportNames(reportText, reportPath));
  const onlyInSource = [...inventoryNames].filter((name) => !reportNames.has(name));
  const onlyInReport = [...reportNames].filter((name) => !inventoryNames.has(name));
  if (onlyInSource.length === 0 && onlyInReport.length === 0) return;
  const describe = (names) =>
    names.length === 0 ? "(none)" : names.sort(compareExportNames).join(", ");
  throw new Error(
    `${sourcePath} and ${reportPath} disagree on the public exports. ` +
      `Only in source: ${describe(onlyInSource)}. ` +
      `Only in the API report: ${describe(onlyInReport)}. ` +
      "Run pnpm api:generate, review etc/api/, then run pnpm docs:generate.",
  );
}
