import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  deg,
  design,
  mm,
  plane,
  scalar,
  scalarVec3,
  stringifyDocument,
  tf,
  vec2,
  vec3,
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
  it("escapes caller-supplied parameter and configuration names", async () => {
    const evaluator = await createEvaluator();
    try {
      const cad = design("pointer-options");
      cad.output("part", cad.box("part", { size: vec3(mm(1), mm(1), mm(1)) }));
      const document = cad.build();
      const parameter = await evaluator.evaluate(document, {
        parameters: { "p/1~x": 1 },
      });
      if (parameter.ok) parameter.value.dispose();
      expect(parameter.ok).toBe(false);
      expect(parameter.diagnostics).toEqual([
        expect.objectContaining({
          code: "PARAMETER_MISSING",
          path: "/parameters/p~11~0x",
        }),
      ]);
      const configuration = await evaluator.evaluate(document, {
        configuration: "c/1~x",
      });
      if (configuration.ok) configuration.value.dispose();
      expect(configuration.ok).toBe(false);
      expect(configuration.diagnostics).toEqual([
        expect.objectContaining({
          code: "CONFIGURATION_MISSING",
          path: "/configurations/c~11~0x",
        }),
      ]);
    } finally {
      evaluator.dispose();
    }
  });

  it("escapes node and parameter IDs in evaluation diagnostics", async () => {
    const evaluator = await createEvaluator();
    try {
      const cad = design("pointer-feature");
      const radius = cad.parameter.length("radiusParameter", mm(0));
      cad.output("ball", cad.sphere("sphereNode", { radius }));
      const document = renamed(
        renamed(cad.build(), "sphereNode", "sph/1~x"),
        "radiusParameter",
        "r/1~x",
      );
      const sphere = await evaluator.evaluate(document);
      if (sphere.ok) sphere.value.dispose();
      expect(sphere.ok).toBe(false);
      expect(sphere.diagnostics).toEqual([
        expect.objectContaining({
          code: "FEATURE_INVALID",
          path: "/nodes/sph~11~0x/radius",
        }),
      ]);
      const override = await evaluator.evaluate(document, {
        parameters: { "r/1~x": Number.NaN },
      });
      if (override.ok) override.value.dispose();
      expect(override.ok).toBe(false);
      expect(override.diagnostics[0]).toMatchObject({
        path: "/parameters/r~11~0x",
      });
    } finally {
      evaluator.dispose();
    }
  });

  it("points mirror-normal and placement failures at escaped node IDs", async () => {
    const evaluator = await createEvaluator();
    try {
      const mirror = design("pointer-mirror");
      const n = mirror.parameter.scalar("n", scalar(0));
      const box = mirror.box("box", { size: vec3(mm(1), mm(2), mm(3)) });
      mirror.output(
        "mirrored",
        mirror.mirror("mirrorNode", box, scalarVec3(n, 0, 0)),
      );
      const mirrored = await evaluator.evaluate(
        renamed(mirror.build(), "mirrorNode", "mir/1~x"),
      );
      if (mirrored.ok) mirrored.value.dispose();
      expect(mirrored.ok).toBe(false);
      expect(mirrored.diagnostics).toEqual([
        expect.objectContaining({
          code: "FEATURE_INVALID",
          path: "/nodes/mir~11~0x/operations/0/normal",
        }),
      ]);

      const assembly = design("pointer-placement");
      const m = assembly.parameter.scalar("m", scalar(0));
      const part = assembly.part(
        "part",
        assembly.box("box", { size: vec3(mm(1), mm(2), mm(3)) }),
      );
      assembly.output(
        "assembly",
        assembly.assembly("assemblyNode", (instances) => {
          instances.instance("plain", part);
          instances.instance("mirrored", part, {
            placement: [tf.mirror(scalarVec3(m, 0, 0))],
          });
        }),
      );
      const placed = await evaluator.evaluate(
        renamed(assembly.build(), "assemblyNode", "asm/1~x"),
      );
      if (placed.ok) placed.value.dispose();
      expect(placed.ok).toBe(false);
      expect(placed.diagnostics).toEqual([
        expect.objectContaining({
          code: "FEATURE_INVALID",
          path: "/nodes/asm~11~0x/instances/1/placement/0/normal",
        }),
      ]);
    } finally {
      evaluator.dispose();
    }
  });

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
