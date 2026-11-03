import { describe, expect, it } from "vitest";
import { evaluateExpression, type ExpressionContext } from "../src/index.js";

const noParameters: ExpressionContext = {
  resolveParameter(id) {
    throw new Error(`Unexpected parameter '${id}'`);
  },
};

describe("expression operations", () => {
  it("folds min and max over very many operands without argument spread", () => {
    const count = 200_000;
    const values = Array.from({ length: count }, (_, index) => ({
      op: "literal" as const,
      dimension: "length" as const,
      value: index % 2 === 0 ? index : -index,
    }));
    expect(
      evaluateExpression({ op: "max", dimension: "length", values }, noParameters),
    ).toBe(count - 2);
    expect(
      evaluateExpression({ op: "min", dimension: "length", values }, noParameters),
    ).toBe(-(count - 1));
  });
});
