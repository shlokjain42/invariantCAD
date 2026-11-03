import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  deg,
  design,
  mm,
  plane,
  stringifyDocument,
  vec2,
  type DesignDocument,
} from "../src/index.js";
import { jsonPointerSegment } from "../src/core/json-pointer.js";

// Document v1-v6 IDs may contain "/" and "~", which the builder does not
// author, so the documents are built with plain IDs and renamed as JSON.
function renamed(document: DesignDocument, from: string, to: string): DesignDocument {
  return JSON.parse(
    stringifyDocument(document).replaceAll(`"${from}"`, JSON.stringify(to)),
  ) as DesignDocument;
}

describe("JSON Pointer escaping in modeling diagnostics", () => {
  it("escapes tilde and slash in reference tokens", () => {
    expect(jsonPointerSegment("rev/1~x")).toBe("rev~11~0x");
    expect(jsonPointerSegment("~/")).toBe("~0~1");
    expect(jsonPointerSegment("plain")).toBe("plain");
  });

  it("points revolve-axis and sketch-solver failures at the authored node", async () => {
    const evaluator = await createEvaluator();
    try {
      const revolveDesign = design("pointer-revolve");
      const profile = revolveDesign.sketch("profileSketch", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("outline", {
            width: mm(10),
            height: mm(10),
            center: vec2(mm(0), mm(0)),
          }),
        ),
      );
      revolveDesign.output(
        "part",
        revolveDesign.revolve("revolveNode", profile, { angle: deg(360) }),
      );
      const revolve = await evaluator.evaluate(
        renamed(revolveDesign.build(), "revolveNode", "rev/1~x"),
      );
      expect(revolve.ok).toBe(false);
      if (!revolve.ok) {
        expect(
          revolve.diagnostics.find((item) => item.severity === "error"),
        ).toMatchObject({
          code: "FEATURE_INVALID",
          path: "/nodes/rev~11~0x/profile",
        });
      }

      const sketchDesign = design("pointer-solver");
      const sketchProfile = sketchDesign.sketch(
        "sketchNode",
        plane.xy(),
        (sketch) => {
          const a = sketch.point("a", vec2(mm(0), mm(0)));
          const b = sketch.point("b", vec2(mm(10), mm(0)));
          sketch.line("l", a, b);
          sketch.distance("d1", a, b, mm(10));
          sketch.distance("d2", a, b, mm(20));
          return sketch.profile(
            sketch.rectangle("outline", { width: mm(10), height: mm(10) }),
          );
        },
      );
      sketchDesign.output(
        "part",
        sketchDesign.extrude("extrusion", sketchProfile, { distance: mm(1) }),
      );
      const solve = await evaluator.evaluate(
        renamed(sketchDesign.build(), "sketchNode", "sk/1~a"),
      );
      expect(solve.ok).toBe(false);
      if (!solve.ok) {
        expect(
          solve.diagnostics.find((item) => item.severity === "error"),
        ).toMatchObject({
          code: "SKETCH_OVER_CONSTRAINED",
          path: "/nodes/sk~11~0a/constraints",
        });
      }
    } finally {
      evaluator.dispose();
    }
  });
});
