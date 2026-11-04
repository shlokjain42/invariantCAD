import { describe, expect, it } from "vitest";
import { createEvaluator, design, mm, vec3 } from "../src/index.js";

function threeBoxes() {
  const cad = design("selection");
  cad.output("a", cad.box("a", { size: vec3(mm(1), mm(1), mm(1)) }));
  cad.output("b", cad.box("b", { size: vec3(mm(2), mm(2), mm(2)) }));
  cad.output("c", cad.box("c", { size: vec3(mm(3), mm(3), mm(3)) }));
  return cad.build();
}

describe("output selection and allowEmpty", () => {
  it("rejects a non-string output entry without converting it to a key", async () => {
    const evaluator = await createEvaluator();
    try {
      for (const signal of [undefined, new AbortController().signal]) {
        let conversions = 0;
        const entry = {
          toString() {
            conversions += 1;
            return "a";
          },
        };
        const result = await evaluator.evaluate(threeBoxes(), {
          outputs: ["b", entry] as unknown as readonly string[],
          ...(signal === undefined ? {} : { signal }),
        });
        if (result.ok) result.value.dispose();
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toEqual([
          expect.objectContaining({
            code: "IR_INVALID",
            path: "/options/outputs/1",
          }),
        ]);
        expect(conversions).toBe(0);
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("escapes an unknown output name in its JSON Pointer", async () => {
    const evaluator = await createEvaluator();
    try {
      const result = await evaluator.evaluate(threeBoxes(), {
        outputs: ["x/y~z"],
      });
      if (result.ok) result.value.dispose();
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "OUTPUT_MISSING",
          path: "/outputs/x~1y~0z",
        }),
      ]);
    } finally {
      evaluator.dispose();
    }
  });

  it("distinguishes an explicitly empty selection from a document without outputs", async () => {
    const evaluator = await createEvaluator();
    try {
      for (const allowEmpty of [false, true]) {
        const result = await evaluator.evaluate(threeBoxes(), {
          outputs: [],
          allowEmpty,
        });
        if (result.ok) result.value.dispose();
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toEqual([
          expect.objectContaining({
            code: "OUTPUT_MISSING",
            path: "/outputs",
            message: "No outputs were selected",
          }),
        ]);
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("only turns a zero-volume feature into an EMPTY_RESULT warning", async () => {
    const cad = design("empty-result");
    const a = cad.box("a", { size: vec3(mm(1), mm(1), mm(1)) });
    cad.output("empty", cad.subtract("empty", a, [a]));
    const document = cad.build();
    const evaluator = await createEvaluator();
    try {
      const strict = await evaluator.evaluate(document);
      if (strict.ok) strict.value.dispose();
      expect(strict.ok).toBe(false);
      expect(strict.diagnostics).toEqual([
        expect.objectContaining({ code: "EMPTY_RESULT", severity: "error" }),
      ]);
      const allowed = await evaluator.evaluate(document, { allowEmpty: true });
      expect(allowed.ok).toBe(true);
      if (!allowed.ok) return;
      try {
        expect(allowed.diagnostics).toEqual([
          expect.objectContaining({ code: "EMPTY_RESULT", severity: "warning" }),
        ]);
        expect(allowed.value.output("empty").measure().volume).toBe(0);
      } finally {
        allowed.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });
});
