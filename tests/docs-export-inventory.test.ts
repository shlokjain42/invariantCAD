import { describe, expect, it } from "vitest";
import {
  apiReportExportNames,
  assertInventoryMatchesApiReport,
  collectNamedExports,
  compareExportNames,
} from "../scripts/docs-export-inventory.mjs";

describe("documentation export inventory", () => {
  it("collects every supported export form with its kind and source", () => {
    const source = [
      'export { createThing, type ThingOptions } from "./thing.js";',
      'export type { Vec2, Vec3 as Point } from "./math.js";',
      "export {",
      "  // A comment inside the block.",
      "  localValue,",
      "};",
      "export const LIMIT = 1 as const;",
      "export const enum Mode { A }",
      "export async function load(): Promise<void> {}",
      "export abstract class Shape {}",
      "export interface Options {}",
      "export type Kind = string;",
      "export function overload(value: string): void;",
      "export function overload(value: number): void;",
      "export function overload(value: unknown): void {}",
      "const localValue = 1;",
      "",
    ].join("\n");
    expect(collectNamedExports(source, "entry.ts")).toEqual([
      { name: "createThing", kind: "value", source: "./thing.js" },
      { name: "LIMIT", kind: "value", source: "local" },
      { name: "load", kind: "function", source: "local" },
      { name: "localValue", kind: "value", source: "local" },
      { name: "Mode", kind: "enum", source: "local" },
      { name: "Options", kind: "interface", source: "local" },
      { name: "overload", kind: "function", source: "local" },
      { name: "Point", kind: "type", source: "./math.js" },
      { name: "Shape", kind: "class", source: "local" },
      { name: "ThingOptions", kind: "type", source: "./thing.js" },
      { name: "Kind", kind: "type", source: "local" },
      { name: "Vec2", kind: "type", source: "./math.js" },
    ].sort((first, second) => compareExportNames(first.name, second.name)));
  });

  it("collects a final re-export block written without a semicolon", () => {
    const source =
      'export { createThing } from "./thing.js";\n' +
      'export { newPublicHelper } from "./helper.js"\n';
    expect(collectNamedExports(source, "entry.ts").map((item) => item.name)).toEqual([
      "createThing",
      "newPublicHelper",
    ]);
    expect(
      collectNamedExports('export type { Helper } from "./helper.js"\n', "entry.ts"),
    ).toEqual([{ name: "Helper", kind: "type", source: "./helper.js" }]);
  });

  it.each([
    ["a destructured constant", "export const { first, second } = source;\n"],
    ["a generator function", "export function* generate() {}\n"],
    ["an async generator function", "export async function* generate() {}\n"],
    ["a default export", "export default createThing;\n"],
    ["a star re-export", 'export * from "./thing.js";\n'],
    ["a namespace re-export", 'export * as thing from "./thing.js";\n'],
    ["an unterminated block", 'export { first,\nexport { second } from "./x.js";\n'],
    ["a statement after a block", 'export { first }; export { second };\nconst first = 1;\n'],
  ])("rejects %s instead of dropping it", (_label, source) => {
    expect(() => collectNamedExports(source, "entry.ts")).toThrow(
      /entry\.ts (?:contains an unsupported export declaration|has an unsupported export)/u,
    );
  });

  it("rejects a name exported twice", () => {
    expect(() =>
      collectNamedExports(
        'export { thing } from "./a.js";\nexport { thing } from "./b.js";\n',
        "entry.ts",
      ),
    ).toThrow("entry.ts exports 'thing' more than once");
  });
});

describe("API report cross-check", () => {
  const report = [
    "## API Report File for \"invariantcad\"",
    "",
    "```ts",
    "// @public",
    "export function overload(value: string): void;",
    "// @public",
    "export function overload(value: number): void;",
    "// @public (undocumented)",
    "export const first = 1;",
    "// @public (undocumented)",
    "export const second = 2;",
    "// @public",
    "export interface Options {",
    "}",
    "// @public",
    "export { aliased }",
    "```",
    "",
  ].join("\n");

  it("lists each exported report name once", () => {
    expect(apiReportExportNames(report, "entry.api.md")).toEqual([
      "aliased",
      "first",
      "Options",
      "overload",
      "second",
    ]);
  });

  it("rejects an unsupported report export", () => {
    expect(() =>
      apiReportExportNames("export default thing;\n", "entry.api.md"),
    ).toThrow("entry.api.md contains an unsupported export declaration");
  });

  it("names the exports a source inventory missed or invented", () => {
    // A multi-declarator constant is only partly visible to the line parser,
    // so the API report is the backstop.
    const inventory = collectNamedExports(
      [
        "export const first = 1, second = 2;",
        "export function overload(value: unknown): void {}",
        "export interface Options {}",
        "export const extra = 3;",
        "",
      ].join("\n"),
      "entry.ts",
    );
    expect(() =>
      assertInventoryMatchesApiReport(inventory, report, "entry.ts", "entry.api.md"),
    ).toThrow(
      "entry.ts and entry.api.md disagree on the public exports. " +
        "Only in source: extra. Only in the API report: aliased, second.",
    );
    expect(() =>
      assertInventoryMatchesApiReport(
        collectNamedExports(
          [
            "export const first = 1;",
            "export const second = 2;",
            "export function overload(value: unknown): void {}",
            "export interface Options {}",
            "export { aliased };",
            "const aliased = 3;",
            "",
          ].join("\n"),
          "entry.ts",
        ),
        report,
        "entry.ts",
        "entry.api.md",
      ),
    ).not.toThrow();
  });
});
