import { describe, expect, it } from "vitest";
import {
  decodeUtf8Fatal,
  isCanonicalUtf8StringWithin,
  utf8ByteLengthWithin,
} from "../src/core/utf8.js";

describe("bounded UTF-8 byte counting", () => {
  it("matches TextEncoder across Unicode and surrogate boundaries", () => {
    const values = [
      "",
      "ASCII control:\u0000 quote:\" slash:/ backslash:\\",
      "é",
      "中",
      "😀",
      "\ud800",
      "\udc00",
      "\ud800x",
      "x\udc00",
      "\ud800\ud800",
      "\udc00\udc00",
      "é中😀\ud800x\udc00",
    ];
    const encoder = new TextEncoder();

    for (const value of values) {
      const expected = encoder.encode(value).byteLength;
      expect(
        utf8ByteLengthWithin(value, Number.MAX_SAFE_INTEGER),
        JSON.stringify(value),
      ).toBe(expected);
      expect(utf8ByteLengthWithin(value, expected)).toBe(expected);
      if (expected > 0) {
        expect(
          utf8ByteLengthWithin(value, expected - 1),
        ).toBeUndefined();
      }
    }
  });

  it("handles zero and rejects invalid ceilings", () => {
    expect(utf8ByteLengthWithin("", 0)).toBe(0);
    expect(utf8ByteLengthWithin("a", 0)).toBeUndefined();

    for (const maximumBytes of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => utf8ByteLengthWithin("", maximumBytes)).toThrow(
        "maximumBytes must be a nonnegative safe integer",
      );
    }
  });
});

describe("fatal UTF-8 decoding and canonical strings", () => {
  it("keeps a leading byte-order mark instead of stripping it", () => {
    const bytes = Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d);
    expect(decodeUtf8Fatal(bytes)).toBe("\ufeff{}");
    expect(decodeUtf8Fatal(Uint8Array.of(0x7b, 0x7d))).toBe("{}");
    expect(() => decodeUtf8Fatal(Uint8Array.of(0xc3, 0x28))).toThrow(
      TypeError,
    );
  });

  it("rejects a leading U+FEFF but accepts it later in a canonical string", () => {
    // A leading U+FEFF is the published artifact-cache identity rule: such a
    // string is not canonical even though the decoder now keeps the mark.
    for (const value of ["\ufeffkernel", "\ufeff"]) {
      expect(
        isCanonicalUtf8StringWithin(value, 64),
        JSON.stringify(value),
      ).toBe(false);
    }
    for (const value of ["ker\ufeffnel", "kernel\ufeff"]) {
      expect(
        isCanonicalUtf8StringWithin(value, 64),
        JSON.stringify(value),
      ).toBe(true);
    }
    expect(isCanonicalUtf8StringWithin("kernel\ufeff", 8)).toBe(false);
    expect(isCanonicalUtf8StringWithin("\ud800", 64)).toBe(false);
    expect(isCanonicalUtf8StringWithin("", 64)).toBe(false);
  });
});
