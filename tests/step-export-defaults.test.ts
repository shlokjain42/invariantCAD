import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_STEP_TEXT_FALLBACK,
  fitAutomaticStepTexts,
  normalizeAutomaticStepText,
  resolveAutomaticStepTexts,
  stepTextUtf8Length,
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
});
