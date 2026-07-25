import { describe, expect, it } from "vitest";
import { utf8ByteLengthWithin } from "../src/core/utf8.js";

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
