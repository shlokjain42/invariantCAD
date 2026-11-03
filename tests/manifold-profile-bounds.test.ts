import { describe, expect, it } from "vitest";
import { createEvaluator, design, mm, plane, vec2 } from "../src/index.js";
import { MANIFOLD_MAX_PROFILE_COORDINATE } from "../src/manifold-kernel.js";

function squarePlate(halfExtent: number) {
  const cad = design("bounded-plate");
  const profile = cad.sketch("plate-profile", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("outline", {
        width: mm(halfExtent * 2),
        height: mm(halfExtent * 2),
        center: vec2(mm(0), mm(0)),
      }),
    ),
  );
  cad.output("plate", cad.extrude("plate", profile, { distance: mm(1) }));
  return cad.build();
}

describe("Manifold profile coordinate ceiling", () => {
  it("evaluates a profile that reaches the documented ceiling", async () => {
    const evaluator = await createEvaluator();
    try {
      const result = await evaluator.evaluate(
        squarePlate(MANIFOLD_MAX_PROFILE_COORDINATE),
      );
      expect(result.ok, JSON.stringify(!result.ok && result.diagnostics)).toBe(true);
      if (!result.ok) return;
      try {
        const volume = result.value.output("plate").measure().volume;
        expect(volume / (4 * MANIFOLD_MAX_PROFILE_COORDINATE ** 2)).toBeCloseTo(1, 6);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects larger profiles with a readable diagnostic instead of a native code", async () => {
    const evaluator = await createEvaluator();
    try {
      for (const halfExtent of [
        MANIFOLD_MAX_PROFILE_COORDINATE * 1.000001,
        5e11,
        1e200,
      ]) {
        const result = await evaluator.evaluate(squarePlate(halfExtent));
        expect(result.ok).toBe(false);
        if (result.ok) {
          result.value.dispose();
          continue;
        }
        const error = result.diagnostics.find((item) => item.severity === "error");
        expect(error?.code).toBe("KERNEL_ERROR");
        expect(error?.node).toBe("plate");
        expect(error?.message).toMatch(
          /Manifold profiles are limited to coordinates within ±10000000000 mm/u,
        );
        expect(error?.message).not.toMatch(/^\d+$/u);
      }
    } finally {
      evaluator.dispose();
    }
  });
});
