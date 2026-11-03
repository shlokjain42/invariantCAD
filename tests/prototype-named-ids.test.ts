import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createEvaluator,
  design,
  mm,
  parseDocument,
  plane,
  stringifyDocument,
  validateDocument,
  vec2,
  vec3,
  type DesignDocument,
  type Evaluator,
} from "../src/index.js";

const PROTOTYPE_NAMES = [
  "toString",
  "constructor",
  "__proto__",
  "hasOwnProperty",
  "valueOf",
] as const;

let evaluator: Evaluator;

beforeAll(async () => {
  evaluator = await createEvaluator();
});

afterAll(() => {
  evaluator.dispose();
});

function boxDocument(): DesignDocument {
  const cad = design("prototype-outputs");
  cad.output(
    "body",
    cad.box("body", { size: vec3(mm(7), mm(7), mm(7)) }),
  );
  return cad.build();
}

describe("prototype-named evaluation outputs", () => {
  it.each(PROTOTYPE_NAMES)(
    "reports an unknown output named %s as OUTPUT_MISSING",
    async (name) => {
      const result = await evaluator.evaluate(boxDocument(), {
        outputs: [name],
      });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "OUTPUT_MISSING",
          path: `/outputs/${name}`,
        }),
      ]);
    },
  );

  it("never evaluates an undeclared node named 'undefined' through an inherited output", async () => {
    const cad = design("prototype-output-alias");
    cad.box("undefined", { size: vec3(mm(7), mm(7), mm(7)) });
    cad.output("body", cad.box("body", { size: vec3(mm(1), mm(1), mm(1)) }));
    const document = parseDocument(stringifyDocument(cad.build()));
    expect(document.ok).toBe(true);
    if (!document.ok) return;
    for (const name of PROTOTYPE_NAMES) {
      const result = await evaluator.evaluate(document.value, {
        outputs: [name],
      });
      if (result.ok) result.value.dispose();
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((item) => item.code)).toEqual([
        "OUTPUT_MISSING",
      ]);
    }
  });
});

describe("prototype-named parameter references", () => {
  it.each(PROTOTYPE_NAMES)(
    "reports a reference to a missing parameter %s as PARAMETER_MISSING",
    (name) => {
      const document = structuredClone(boxDocument()) as DesignDocument;
      (document.nodes.body as { size: unknown[] }).size[0] = {
        op: "parameter",
        dimension: "length",
        id: name,
      };
      const result = validateDocument(document);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "PARAMETER_MISSING",
          path: "/nodes/body/size/0/id",
        }),
      ]);
      const parsed = parseDocument(JSON.stringify(document));
      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics.map((item) => item.code)).toEqual([
        "PARAMETER_MISSING",
      ]);
    },
  );
});

describe("prototype-named sketch IDs", () => {
  it("accepts constructor, toString, and valueOf as first-use sketch IDs", async () => {
    const cad = design("prototype-sketch");
    const profile = cad.sketch("profile", plane.xy(), (sketch) => {
      const first = sketch.point("constructor", vec2(mm(0), mm(0)));
      const second = sketch.point("toString", vec2(mm(10), mm(0)));
      const third = sketch.point("valueOf", vec2(mm(10), mm(10)));
      const fourth = sketch.point("hasOwnProperty", vec2(mm(0), mm(10)));
      const loop = sketch.loop([
        sketch.line("isPrototypeOf", first, second),
        sketch.line("propertyIsEnumerable", second, third),
        sketch.line("toLocaleString", third, fourth),
        sketch.line("line.closing", fourth, first),
      ]);
      sketch.fixed("fixed", first);
      return sketch.profile(loop);
    });
    cad.output(
      "solid",
      cad.extrude("solid", profile, { distance: mm(2) }),
    );
    const document = cad.build();
    const sketchNode = document.nodes.profile as { entities: object };
    expect(Object.keys(sketchNode.entities)).toEqual(
      expect.arrayContaining(["constructor", "toString", "valueOf"]),
    );
    const result = await evaluator.evaluate(document);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.value.output("solid").measure().volume).toBeCloseTo(200, 6);
    } finally {
      result.value.dispose();
    }
  });

  it("still rejects a true duplicate sketch ID", () => {
    const cad = design("prototype-sketch-duplicate");
    expect(() =>
      cad.sketch("profile", plane.xy(), (sketch) => {
        sketch.point("constructor", vec2(mm(0), mm(0)));
        sketch.point("constructor", vec2(mm(1), mm(0)));
        return sketch.profile(
          sketch.rectangle("box", { width: mm(1), height: mm(1) }),
        );
      }),
    ).toThrow("Duplicate sketch ID 'constructor'");
  });
});
