import { describe, expect, it } from "vitest";
import {
  frontmatterScalar,
  pageFrontmatter,
} from "../scripts/docs-frontmatter.mjs";

describe("documentation page frontmatter", () => {
  it("extracts the leading YAML block", () => {
    expect(pageFrontmatter('---\ntitle: "A"\n---\n\nBody\n')).toBe('title: "A"');
    expect(pageFrontmatter("# No frontmatter\n")).toBeUndefined();
    expect(pageFrontmatter('Intro\n---\ntitle: "A"\n---\n')).toBeUndefined();
  });

  it.each([
    ['title: "Export index"', "Export index"],
    ["title: 'It''s quoted'", "It''s quoted"],
    ['title: "Escaped \\" quote"', 'Escaped \\" quote'],
    ["title: Plain words", "Plain words"],
    ['title:   "Padded"   ', "Padded"],
    ['title: "Commented" # note', "Commented"],
  ])("reads %s", (line, value) => {
    expect(frontmatterScalar(`${line}\ndescription: "Other"`, "title")).toBe(value);
  });

  it.each([
    ["an empty double-quoted value", 'title: ""\ndescription: "Real"'],
    ["an empty single-quoted value", "title: ''\ndescription: \"Real\""],
    ["a whitespace-only quoted value", 'title: "   "\ndescription: "Real"'],
    ["a blank value followed by another key", 'title:\ndescription: "Real"'],
    ["a blank value at the end", 'description: "Real"\ntitle:'],
    ["a blank value followed by an indented line", "title:\n  Continued"],
    ["a YAML null", 'title: null\ndescription: "Real"'],
    ["a YAML tilde null", 'title: ~\ndescription: "Real"'],
    ["a block scalar", "title: >-\n  Folded title"],
    ["an unterminated quote", 'title: "Open\ndescription: "Real"'],
    ["a comment only", "title: # nothing"],
    ["a missing key", 'description: "Real"'],
    ["a repeated key", 'title: "One"\ntitle: "Two"'],
    ["a nested key only", 'meta:\n  title: "Nested"'],
  ])("rejects %s", (_label, frontmatter) => {
    expect(frontmatterScalar(frontmatter, "title")).toBeUndefined();
  });
});
