import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN_DOCUMENT_LIMITS } from "../src/document-limits.js";
import { auditJsonMemberNames } from "../src/internal/json-member-audit.js";

function audit(source: string) {
  return auditJsonMemberNames(source, DEFAULT_DESIGN_DOCUMENT_LIMITS);
}

describe("raw JSON member audit", () => {
  it("keeps member scopes independent and ignores JSON punctuation in strings", () => {
    const sources = [
      "null",
      "[]",
      '{"name":{"name":1}}',
      '{"left":{"name":1},"right":{"name":2}}',
      '{"items":[{"name":1},{"name":2}]}',
      String.raw`{"é":1,"e\u0301":2}`,
      String.raw`{"value":"{\"name\":1,\"name\":2}","punctuation":":,{}[]"}`,
    ];
    for (const source of sources) {
      expect(() => JSON.parse(source), source).not.toThrow();
      expect(audit(source), source).toEqual({ status: "unique" });
    }
  });

  it("detects repeated names in every object scope", () => {
    const sources = [
      '{"name":1,"name":2}',
      '{"name"\t\n\r :1,"name":2}',
      '{"metadata":{"name":1,"name":2}}',
      '{"items":[{"id":1},{"id":2,"id":3}]}',
      '{"outer":{"nested":{"value":1,"value":2}}}',
      '{"replaced":{"nested":1,"nested":2},"replaced":0}',
    ];
    for (const source of sources) {
      expect(() => JSON.parse(source), source).not.toThrow();
      expect(audit(source), source).toEqual({ status: "duplicate" });
    }
  });

  it("compares decoded names across escape spellings", () => {
    const sources = [
      String.raw`{"name":1,"na\u006de":2}`,
      String.raw`{"a\"b":1,"a\u0022b":2}`,
      String.raw`{"a\\b":1,"a\u005cb":2}`,
      String.raw`{"a/b":1,"a\/b":2}`,
      String.raw`{"é":1,"\u00e9":2}`,
      String.raw`{"😀":1,"\ud83d\ude00":2}`,
      String.raw`{"__proto__":1,"\u005f_proto__":2}`,
    ];
    for (const source of sources) {
      expect(() => JSON.parse(source), source).not.toThrow();
      expect(audit(source), source).toEqual({ status: "duplicate" });
    }
  });

  it("treats raw and escaped lone-surrogate names as identical", () => {
    const source = `{"${"\ud800"}":1,"\\ud800":2}`;
    expect(() => JSON.parse(source)).not.toThrow();
    expect(audit(source)).toEqual({ status: "duplicate" });
  });

  it("does not recurse with deeply nested valid JSON", () => {
    const depth = 20_000;
    const source = `${"[".repeat(depth)}{"name":1,"name":2}${"]".repeat(
      depth,
    )}`;
    expect(() => JSON.parse(source)).not.toThrow();
    expect(
      auditJsonMemberNames(source, {
        maxNestingDepth: depth + 1,
        maxStructuralValues: depth + 3,
      }),
    ).toEqual({ status: "duplicate" });
  });

  it("bounds raw values that native last-key-wins parsing would erase", () => {
    expect(
      auditJsonMemberNames('{"discarded":[0,1,2],"discarded":0}', {
        maxNestingDepth: 10,
        maxStructuralValues: 4,
      }),
    ).toEqual({
      status: "limit-exceeded",
      resource: "maxStructuralValues",
      limit: 4,
      actual: 5,
    });

    expect(
      auditJsonMemberNames(
        '{"discarded":0,"discarded":[0,1,2],"discarded":0}',
        {
          maxNestingDepth: 10,
          maxStructuralValues: 4,
        },
      ),
    ).toEqual({
      status: "limit-exceeded",
      resource: "maxStructuralValues",
      limit: 4,
      actual: 5,
    });

    expect(
      auditJsonMemberNames(
        `{"discarded":${"[".repeat(11)}0${"]".repeat(
          11,
        )},"discarded":0}`,
        {
          maxNestingDepth: 10,
          maxStructuralValues: 100,
        },
      ),
    ).toEqual({
      status: "limit-exceeded",
      resource: "maxNestingDepth",
      limit: 10,
      actual: 11,
    });
  });
});
