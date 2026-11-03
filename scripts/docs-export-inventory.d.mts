/** One named export listed by the generated documentation export index. */
export interface DocumentedExport {
  readonly name: string;
  readonly kind: "value" | "type" | "interface" | "class" | "function" | "enum";
  /** The re-exported module specifier, or `local` for a local declaration. */
  readonly source: string;
}

/** Orders export names identically regardless of the host locale. */
export function compareExportNames(first: string, second: string): number;

/**
 * Lists the named exports of one entry-point source, sorted by name. Throws
 * for any export statement it cannot attribute to a supported form.
 */
export function collectNamedExports(
  sourceText: string,
  sourcePath: string,
): DocumentedExport[];

/** Lists the distinct exported names declared by an API Extractor report. */
export function apiReportExportNames(
  reportText: string,
  reportPath: string,
): string[];

/**
 * Requires a source inventory to name exactly the exports recorded in the
 * entry point's API Extractor report.
 */
export function assertInventoryMatchesApiReport(
  exports: readonly DocumentedExport[],
  reportText: string,
  sourcePath: string,
  reportPath: string,
): void;
