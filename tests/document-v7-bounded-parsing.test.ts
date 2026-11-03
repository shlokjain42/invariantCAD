import { describe, expect, it, vi } from "vitest";
import { parseDocumentValue } from "../src/index.js";
import {
  admitDocumentToV7,
  cloneDocumentV7,
  migrateDocumentToV7,
  parseDocumentV7,
  parseDocumentValueV7,
} from "../src/serialization.js";

describe("bounded document-v7 raw parsing", () => {
  it("rejects oversized text before scanning or materializing all UTF-8 bytes", async () => {
    const encodeDescriptor = Object.getOwnPropertyDescriptor(
      TextEncoder.prototype,
      "encode",
    );
    const charCodeAtDescriptor = Object.getOwnPropertyDescriptor(
      String.prototype,
      "charCodeAt",
    );
    const parseDescriptor = Object.getOwnPropertyDescriptor(JSON, "parse");
    expect(encodeDescriptor?.value).toBeTypeOf("function");
    expect(charCodeAtDescriptor?.value).toBeTypeOf("function");
    expect(parseDescriptor?.value).toBeTypeOf("function");
    if (
      encodeDescriptor?.value === undefined ||
      charCodeAtDescriptor?.value === undefined ||
      parseDescriptor?.value === undefined
    ) {
      return;
    }

    const originalEncode =
      encodeDescriptor.value as TextEncoder["encode"];
    const originalCharCodeAt =
      charCodeAtDescriptor.value as String["charCodeAt"];
    const originalParse = parseDescriptor.value as typeof JSON.parse;
    let encodeCalls = 0;
    let charCodeAtCalls = 0;
    let parseCalls = 0;

    try {
      Object.defineProperty(TextEncoder.prototype, "encode", {
        ...encodeDescriptor,
        value: function (
          this: TextEncoder,
          input = "",
        ): Uint8Array {
          encodeCalls += 1;
          return Reflect.apply(originalEncode, this, [input]) as Uint8Array;
        },
      });
      Object.defineProperty(String.prototype, "charCodeAt", {
        ...charCodeAtDescriptor,
        value: function (this: string, index: number): number {
          charCodeAtCalls += 1;
          return Reflect.apply(originalCharCodeAt, this, [index]) as number;
        },
      });
      Object.defineProperty(JSON, "parse", {
        ...parseDescriptor,
        value: ((text: string, reviver?: unknown): unknown => {
          parseCalls += 1;
          return Reflect.apply(originalParse, JSON, [
            text,
            reviver,
          ]) as unknown;
        }) as typeof JSON.parse,
      });

      vi.resetModules();
      const { parseDocumentV7 } = await import(
        "../src/serialization.js"
      );
      const source =
        '{"schema":"https://invariantcad.dev/schema/document/v7",' +
        '"version":7,"name":"bounded-raw","units":{"length":"mm",' +
        '"angle":"rad"},"parameters":{},"nodes":{},"outputs":{},' +
        `"metadata":{"payload":"${"x".repeat(1_000_000)}"}}`;

      encodeCalls = 0;
      charCodeAtCalls = 0;
      parseCalls = 0;
      const result = parseDocumentV7(source, {
        limits: { maxDocumentBytes: 128 },
      });

      expect(result).toMatchObject({
        ok: false,
        diagnostics: [
          {
            message:
              "Design-document maxDocumentBytes limit 128 was exceeded before UTF-8 buffer materialization",
            details: {
              resource: "maxDocumentBytes",
              limit: 128,
              actualAtLeast: source.length,
            },
          },
        ],
      });
      expect(encodeCalls).toBe(0);
      expect(parseCalls).toBe(0);
      expect(charCodeAtCalls).toBeLessThan(512);

      const multibyteSource =
        '{"schema":"https://invariantcad.dev/schema/document/v7",' +
        '"version":7,"name":"bounded-raw","units":{"length":"mm",' +
        '"angle":"rad"},"parameters":{},"nodes":{},"outputs":{},' +
        `"metadata":{"payload":"${"😀".repeat(1_000)}"}}`;
      const multibyteLimit = multibyteSource.length;
      encodeCalls = 0;
      charCodeAtCalls = 0;
      parseCalls = 0;
      const multibyteResult = parseDocumentV7(multibyteSource, {
        limits: { maxDocumentBytes: multibyteLimit },
      });

      expect(multibyteResult).toMatchObject({
        ok: false,
        diagnostics: [
          {
            details: {
              resource: "maxDocumentBytes",
              limit: multibyteLimit,
              actualAtLeast: multibyteLimit + 1,
            },
          },
        ],
      });
      expect(encodeCalls).toBe(0);
      expect(parseCalls).toBe(0);
      expect(charCodeAtCalls).toBeGreaterThan(0);
      expect(charCodeAtCalls).toBeLessThan(multibyteSource.length);
    } finally {
      Object.defineProperty(JSON, "parse", parseDescriptor);
      Object.defineProperty(
        String.prototype,
        "charCodeAt",
        charCodeAtDescriptor,
      );
      Object.defineProperty(
        TextEncoder.prototype,
        "encode",
        encodeDescriptor,
      );
      vi.resetModules();
    }
  });
});

describe("caller limits at the document-v7 schema boundary", () => {
  const literal = (value: number) => ({
    op: "literal",
    dimension: "length",
    value,
  });
  /** A valid box whose first size expression is `levels` nested negations. */
  function deepDocument(version: 6 | 7, levels: number): unknown {
    let expression: unknown = literal(1);
    for (let index = 0; index < levels; index += 1) {
      expression = { op: "neg", dimension: "length", value: expression };
    }
    return {
      schema: `https://invariantcad.dev/schema/document/v${version}`,
      version,
      name: "deep",
      units: { length: "mm", angle: "rad" },
      parameters: {},
      nodes: {
        b: {
          kind: "box",
          size: [expression, literal(1), literal(1)],
          center: false,
        },
      },
      outputs: { o: { node: "b", kind: "solid" } },
    };
  }

  it("honors a raised maxNestingDepth in every staged v7 entry point", () => {
    const raised = { limits: { maxNestingDepth: 1_000 } };
    // About 147 levels deep: over the default 128, under the raised limit.
    const v6 = deepDocument(6, 140);
    const v7 = deepDocument(7, 140);
    expect(parseDocumentValue(v6).ok).toBe(false);
    expect(parseDocumentValue(v6, raised).ok).toBe(true);
    expect(parseDocumentValueV7(v7)).toMatchObject({
      ok: false,
      diagnostics: [{ details: { resource: "maxNestingDepth" } }],
    });

    const parsedValue = parseDocumentValueV7(v7, raised);
    expect(parsedValue.diagnostics).toEqual([]);
    expect(parsedValue.ok).toBe(true);
    expect(parseDocumentV7(JSON.stringify(v7), raised).ok).toBe(true);
    expect(admitDocumentToV7(JSON.stringify(v7), raised).ok).toBe(true);
    expect(admitDocumentToV7(JSON.stringify(v6), raised).ok).toBe(true);
    const migrated = migrateDocumentToV7(v6, raised);
    expect(migrated.diagnostics).toEqual([]);
    expect(migrated.ok).toBe(true);
    if (parsedValue.ok) {
      expect(() => cloneDocumentV7(parsedValue.value, raised)).not.toThrow();
    }

    // Lowered limits are still enforced with structured details.
    expect(
      parseDocumentValueV7(deepDocument(7, 1), {
        limits: { maxNestingDepth: 4 },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [{ details: { resource: "maxNestingDepth", limit: 4 } }],
    });
  });

  it("honors a raised resource limit in the staged v7 parser", () => {
    const document = deepDocument(7, 0) as Record<string, unknown>;
    const resources: Record<string, unknown> = {};
    for (let index = 0; index <= 10_000; index += 1) {
      resources[`r${index}`] = {
        byteLength: index,
        digest: `sha256:${index.toString(16).padStart(64, "0")}`,
        mediaType: "model/step",
      };
    }
    const many = { ...document, resources };
    // 10,001 definitions: one over the default maxResourceDefinitions.
    expect(parseDocumentValueV7(many)).toMatchObject({
      ok: false,
      diagnostics: [{ details: { resource: "maxResourceDefinitions" } }],
    });
    const raised = parseDocumentValueV7(many, {
      limits: { maxResourceDefinitions: 20_000 },
    });
    expect(raised.diagnostics).toEqual([]);
    expect(raised.ok).toBe(true);
    expect(
      parseDocumentV7(JSON.stringify(many), {
        limits: { maxResourceDefinitions: 20_000 },
      }).ok,
    ).toBe(true);
  });
});
