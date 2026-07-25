import { describe, expect, it, vi } from "vitest";

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
