import { describe, expect, it, vi } from "vitest";

describe("bounded document-v7 canonical serialization", () => {
  it("rejects oversized values before canonical or UTF-8 materialization", async () => {
    const stringifyDescriptor = Object.getOwnPropertyDescriptor(
      JSON,
      "stringify",
    );
    const encodeDescriptor = Object.getOwnPropertyDescriptor(
      TextEncoder.prototype,
      "encode",
    );
    const charCodeAtDescriptor = Object.getOwnPropertyDescriptor(
      String.prototype,
      "charCodeAt",
    );
    expect(stringifyDescriptor?.value).toBeTypeOf("function");
    expect(encodeDescriptor?.value).toBeTypeOf("function");
    expect(charCodeAtDescriptor?.value).toBeTypeOf("function");
    if (
      stringifyDescriptor?.value === undefined ||
      encodeDescriptor?.value === undefined ||
      charCodeAtDescriptor?.value === undefined
    ) {
      return;
    }

    const originalStringify =
      stringifyDescriptor.value as typeof JSON.stringify;
    const originalEncode =
      encodeDescriptor.value as TextEncoder["encode"];
    const originalCharCodeAt =
      charCodeAtDescriptor.value as String["charCodeAt"];
    let objectStringifyCalls = 0;
    let largestEncodedInput = 0;
    let charCodeAtCalls = 0;

    try {
      Object.defineProperty(JSON, "stringify", {
        ...stringifyDescriptor,
        value: ((
          value: unknown,
          replacer?: unknown,
          space?: unknown,
        ): string | undefined => {
          if (typeof value === "object" && value !== null) {
            objectStringifyCalls += 1;
          }
          return Reflect.apply(originalStringify, JSON, [
            value,
            replacer,
            space,
          ]) as string | undefined;
        }) as typeof JSON.stringify,
      });
      Object.defineProperty(TextEncoder.prototype, "encode", {
        ...encodeDescriptor,
        value: function (
          this: TextEncoder,
          input = "",
        ): Uint8Array {
          largestEncodedInput = Math.max(
            largestEncodedInput,
            input.length,
          );
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

      vi.resetModules();
      const {
        cloneDocumentV7,
        parseDocumentValueV7,
        stringifyDocumentV7,
      } = await import("../src/serialization.js");
      const source = {
        schema: "https://invariantcad.dev/schema/document/v7",
        version: 7,
        name: "bounded-allocation",
        units: { length: "mm", angle: "rad" },
        parameters: {},
        nodes: {},
        outputs: {},
        metadata: {
          payload: "x".repeat(1_000_000),
        },
      } as const;
      const parsed = parseDocumentValueV7(source);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      objectStringifyCalls = 0;
      largestEncodedInput = 0;
      charCodeAtCalls = 0;
      const limits = { maxDocumentBytes: 128 };

      expect(() =>
        stringifyDocumentV7(parsed.value, { limits }),
      ).toThrow(/before canonical JSON materialization/);
      expect(() => cloneDocumentV7(parsed.value, { limits })).toThrow(
        /before canonical JSON materialization/,
      );
      expect(objectStringifyCalls).toBe(0);
      expect(largestEncodedInput).toBe(0);
      expect(charCodeAtCalls).toBeLessThan(512);
    } finally {
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
      Object.defineProperty(JSON, "stringify", stringifyDescriptor);
      vi.resetModules();
    }
  });
});
