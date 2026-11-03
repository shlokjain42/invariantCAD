import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_STEP_TEXT_FALLBACK,
  boundedAutomaticStepText,
  fitAutomaticStepTexts,
  normalizeAutomaticStepText,
  resolveAutomaticStepTexts,
  stepTextUtf8Length,
  stepTextUtf8LengthUpTo,
} from "../src/internal/step-export-defaults.js";

const emoji = "\u{1F600}";

function utf8(values: readonly string[]): number {
  return values.reduce((total, value) => total + stepTextUtf8Length(value), 0);
}

describe("automatic STEP metadata defaults", () => {
  it("normalizes control characters and unpaired surrogates", () => {
    expect(normalizeAutomaticStepText("a\tb\r\n\u0000\u007f\u0085c")).toBe(
      `a b${" ".repeat(5)}c`,
    );
    expect(normalizeAutomaticStepText("x\ud800y\udc00z")).toBe(
      "x\uFFFDy\uFFFDz",
    );
    expect(normalizeAutomaticStepText(`ok ${emoji}`)).toBe(`ok ${emoji}`);
  });

  it("returns values unchanged when they already fit", () => {
    const values = ["name", emoji, ""];
    expect(fitAutomaticStepTexts(values, utf8(values), [true, true, false]))
      .toEqual(values);
  });

  it("keeps the first scalar of every required value under a short budget", () => {
    // Nine bytes fit "a" plus two four-byte scalars. Sharing the budget
    // evenly before reserving the scalars would empty both emoji fields.
    const values = ["aaaaaaaaaa", emoji, emoji];
    const fitted = fitAutomaticStepTexts(values, 9, [true, true, true]);
    expect(fitted).toEqual(["a", emoji, emoji]);
    expect(utf8(fitted)).toBe(9);

    expect(
      resolveAutomaticStepTexts(
        [undefined, undefined, undefined, undefined],
        ["aaaaaaaaaa", emoji, emoji, "description"],
        [true, true, true, false],
        9,
      ),
    ).toEqual(["a", emoji, emoji, ""]);
  });

  it("shares the remaining budget fairly and truncates at scalar boundaries", () => {
    const values = ["short", "Ω".repeat(100), `${emoji}`.repeat(100)];
    const fitted = fitAutomaticStepTexts(values, 125, [true, true, false]);
    expect(fitted[0]).toBe("short");
    expect(utf8(fitted)).toBeLessThanOrEqual(125);
    expect(values[1]!.startsWith(fitted[1]!)).toBe(true);
    expect(values[2]!.startsWith(fitted[2]!)).toBe(true);
    // Each long value gets an even share of the 120 bytes left after "short".
    expect(stepTextUtf8Length(fitted[1]!)).toBe(60);
    expect(stepTextUtf8Length(fitted[2]!)).toBe(60);
  });

  it("leaves explicit values verbatim and reports impossible budgets", () => {
    expect(
      resolveAutomaticStepTexts(
        ["explicit", undefined, undefined, undefined],
        ["document", "", "\u0001", ""],
        [true, true, true, false],
        1_000,
      ),
    ).toEqual(["explicit", AUTOMATIC_STEP_TEXT_FALLBACK, " ", ""]);

    // Two required automatic fields cannot each keep a scalar in one byte,
    // so the values are returned untruncated for strict validation to reject.
    expect(
      resolveAutomaticStepTexts(
        ["explicit", undefined, undefined, undefined],
        ["document", "product", "name", ""],
        [true, true, true, false],
        "explicit".length + 1,
      ),
    ).toEqual(["explicit", "product", "name", ""]);
  });

  it("never reads text past the budget", () => {
    // Measuring stops once the size exceeds the limit.
    expect(stepTextUtf8LengthUpTo("abc", 3)).toBe(3);
    expect(stepTextUtf8LengthUpTo("a".repeat(1_000_000), 10)).toBe(11);
    expect(stepTextUtf8LengthUpTo(emoji.repeat(10), 5)).toBe(8);

    // Only maximumBytes + 1 code units are normalized and kept, extended so a
    // surrogate pair is never split.
    const long = "a\u0001".repeat(500_000);
    expect(boundedAutomaticStepText(long, 6)).toBe("a a a a");
    expect(boundedAutomaticStepText(`abc${emoji}def`, 3)).toBe(`abc${emoji}`);
    expect(boundedAutomaticStepText("short\t", 64)).toBe("short ");

    // Values longer than the whole budget tie, so their text past the budget
    // cannot reorder them or change the result.
    const full = ["b".repeat(1_000), "a".repeat(500)];
    const prefixes = full.map((value) => value.slice(0, 120));
    const fitted = fitAutomaticStepTexts(full, 101);
    expect(fitted).toEqual(fitAutomaticStepTexts(prefixes, 101));
    expect(fitted).toEqual(["b".repeat(50), "a".repeat(51)]);

    // An explicit overflow returns the automatic values for strict
    // validation without copying long authored text.
    const resolved = resolveAutomaticStepTexts(
      ["x".repeat(100), undefined, undefined, undefined],
      [long, "id", "name", long],
      [true, true, true, false],
      50,
      64,
    );
    expect(resolved[0]).toBe("x".repeat(100));
    expect(resolved.slice(1, 3)).toEqual(["id", "name"]);
    expect(resolved[3]).toBe(normalizeAutomaticStepText(long.slice(0, 65)));
  });
});
