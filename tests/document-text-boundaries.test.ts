import { describe, expect, it } from "vitest";
import {
  design,
  mm,
  parseDocument,
  parseDocumentValue,
  stringifyDocument,
  vec3,
  type CadResult,
  type DesignDocument,
} from "../src/index.js";

type JsonPath = readonly (string | number)[];

function sourceDocument(): DesignDocument {
  const cad = design("document-text-boundaries");
  const width = cad.parameter.length("width", mm(10));
  const box = cad.box("box", { size: vec3(width, mm(20), mm(30)) });
  cad.output("box", box);
  return cad.build();
}

function objectPaths(value: unknown, path: JsonPath = []): JsonPath[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => objectPaths(child, [...path, index]));
  }
  if (typeof value !== "object" || value === null) return [];
  return [
    path,
    ...Object.entries(value).flatMap(([key, child]) =>
      objectPaths(child, [...path, key]),
    ),
  ];
}

function escapedName(name: string): string {
  return `"${[...name]
    .map((character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
    .join("")}"`;
}

/**
 * Writes JSON whose object at `target` first repeats its first member as
 * `erased`, which native last-key-wins parsing then discards.
 */
function withLeadingMember(
  value: unknown,
  target: JsonPath,
  member: (name: string) => string,
  path: JsonPath = [],
): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((child, index) =>
        withLeadingMember(child, target, member, [...path, index]),
      )
      .join(",")}]`;
  }
  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value);
  }
  const entries = Object.entries(value).map(
    ([key, child]) =>
      `${JSON.stringify(key)}:${withLeadingMember(child, target, member, [
        ...path,
        key,
      ])}`,
  );
  const isTarget =
    path.length === target.length &&
    path.every((segment, index) => segment === target[index]);
  const first = Object.keys(value)[0];
  return `{${[
    ...(isTarget && first !== undefined ? [member(first)] : []),
    ...entries,
  ].join(",")}}`;
}

function failureDetails(
  result: CadResult<unknown>,
): Readonly<Record<string, unknown>> | undefined {
  expect(result.ok).toBe(false);
  if (result.ok) return undefined;
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]!.code).toBe("IR_INVALID");
  return result.diagnostics[0]!.details as Readonly<Record<string, unknown>>;
}

function smallestPassingLimit(
  text: string,
  resource: "maxStructuralValues" | "maxNestingDepth",
): number {
  let low = 0;
  let high = 1_000_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (parseDocument(text, { limits: { [resource]: middle } }).ok) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

describe("public document text boundaries", () => {
  it("parses canonical text exactly like the detached value", () => {
    const text = stringifyDocument(sourceDocument());
    const fromText = parseDocument(text);
    const fromValue = parseDocumentValue(JSON.parse(text));

    expect(fromText.ok).toBe(true);
    expect(fromValue.ok).toBe(true);
    if (!fromText.ok || !fromValue.ok) return;
    expect(fromText.value).toEqual(fromValue.value);
    expect(stringifyDocument(fromText.value)).toBe(text);
  });

  it("rejects repeated and escape-equivalent member names in every object scope", () => {
    const value = JSON.parse(stringifyDocument(sourceDocument())) as unknown;
    const paths = objectPaths(value);
    expect(paths.length).toBeGreaterThan(10);

    for (const path of paths) {
      for (const member of [
        (name: string) => `${JSON.stringify(name)}:"erased"`,
        (name: string) => `${escapedName(name)}:"erased"`,
        (name: string) => `${JSON.stringify(name)}:{"erased":["value"]}`,
      ]) {
        const text = withLeadingMember(value, path, member);
        // Native parsing silently resolves the repeat to the later member.
        expect(JSON.parse(text), path.join("/")).toEqual(value);
        expect(failureDetails(parseDocument(text)), path.join("/")).toEqual({
          reason: "duplicate-json-member",
        });
      }
    }
  });

  it("keeps sibling object scopes independent", () => {
    const text = stringifyDocument(sourceDocument());

    expect(text.match(/"kind":/g)!.length).toBeGreaterThan(1);
    expect(parseDocument(text).ok).toBe(true);
  });

  it("charges erased duplicate subtrees against raw structural and nesting ceilings", () => {
    const text = stringifyDocument(sourceDocument());
    const value = JSON.parse(text) as unknown;
    const structuralValues = smallestPassingLimit(text, "maxStructuralValues");
    const nestingDepth = smallestPassingLimit(text, "maxNestingDepth");
    const wide = withLeadingMember(
      value,
      [],
      (name) => `${JSON.stringify(name)}:[1,2,3]`,
    );
    const deep = withLeadingMember(
      value,
      [],
      (name) =>
        `${JSON.stringify(name)}:${"[".repeat(nestingDepth + 1)}${"]".repeat(nestingDepth + 1)}`,
    );

    for (const [erased, limits] of [
      [wide, { maxStructuralValues: structuralValues }],
      [deep, { maxNestingDepth: nestingDepth }],
    ] as const) {
      expect(JSON.parse(erased)).toEqual(value);
      expect(parseDocumentValue(JSON.parse(erased), { limits }).ok).toBe(true);
    }
    expect(
      failureDetails(
        parseDocument(wide, {
          limits: { maxStructuralValues: structuralValues },
        }),
      ),
    ).toEqual({
      resource: "maxStructuralValues",
      limit: structuralValues,
      actual: structuralValues + 1,
    });
    expect(
      failureDetails(
        parseDocument(deep, { limits: { maxNestingDepth: nestingDepth } }),
      ),
    ).toEqual({
      resource: "maxNestingDepth",
      limit: nestingDepth,
      actual: nestingDepth + 1,
    });
    // The erased array and its three numbers are the only extra raw values.
    expect(
      failureDetails(
        parseDocument(wide, {
          limits: { maxStructuralValues: structuralValues + 4 },
        }),
      ),
    ).toEqual({ reason: "duplicate-json-member" });
  });

  it("stops UTF-8 measurement at the byte ceiling without encoding", () => {
    const text = stringifyDocument({
      ...sourceDocument(),
      metadata: { note: "é😀" },
    } as DesignDocument);
    const bytes = new TextEncoder().encode(text).byteLength;
    expect(bytes).toBeGreaterThan(text.length);

    expect(parseDocument(text, { limits: { maxDocumentBytes: bytes } }).ok).toBe(
      true,
    );
    const originalEncode = TextEncoder.prototype.encode;
    let encodes = 0;
    let result: CadResult<DesignDocument>;
    try {
      TextEncoder.prototype.encode = function (): never {
        encodes += 1;
        throw new Error("parseDocument must not encode rejected text");
      };
      result = parseDocument(text, {
        limits: { maxDocumentBytes: bytes - 1 },
      });
    } finally {
      TextEncoder.prototype.encode = originalEncode;
    }
    expect(encodes).toBe(0);
    // Measurement stops one byte past the ceiling, so `actual` is the size
    // observed at that point rather than the full UTF-8 length.
    expect(failureDetails(result)).toEqual({
      resource: "maxDocumentBytes",
      limit: bytes - 1,
      actual: bytes,
    });
    expect(
      failureDetails(
        parseDocument(text, { limits: { maxDocumentBytes: text.length - 1 } }),
      ),
    ).toEqual({
      resource: "maxDocumentBytes",
      limit: text.length - 1,
      actual: text.length,
    });
    expect(text.length).toBeLessThan(bytes);
  });

  it("requires primitive string text", () => {
    const text = stringifyDocument(sourceDocument());

    for (const input of [new String(text), { toString: () => text }, 1, null]) {
      const result = parseDocument(input as unknown as string);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.diagnostics[0]?.message).toBe(
        "Design-document text must be a primitive string",
      );
    }
  });
});
