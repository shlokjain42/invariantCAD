import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvaluatedAssembly,
  createEvaluator,
  design,
  mm,
  plane,
  tf,
  vec2,
  vec3,
  type CadResult,
  type DesignDocument,
  type EvaluatedDesign,
  type Evaluator,
} from "../src/index.js";

let evaluator: Evaluator;

beforeAll(async () => {
  evaluator = await createEvaluator();
});

afterAll(() => {
  evaluator.dispose();
});

async function evaluate(document: DesignDocument): Promise<EvaluatedDesign> {
  const result = await evaluator.evaluate(document);
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
  }
  return result.value;
}

describe("geometry evaluation", () => {
  it("creates and measures a real solid", async () => {
    const cad = design("box");
    const box = cad.box("box", {
      size: vec3(mm(10), mm(20), mm(30)),
      center: true,
    });
    cad.output("box", box);
    const result = await evaluate(cad.build());
    try {
      const output = result.output("box");
      const measured = output.measure();
      expect(measured.volume).toBeCloseTo(6_000, 8);
      expect(measured.surfaceArea).toBeCloseTo(2_200, 8);
      expect(measured.boundingBox).toEqual({ min: [-5, -10, -15], max: [5, 10, 15] });
      expect(output.mesh().indices.length / 3).toBe(12);
    } finally {
      result.dispose();
    }
  });

  it("recomputes a parameterized sketch and hole", async () => {
    const cad = design("plate");
    const width = cad.parameter.length("width", mm(80), { min: mm(1) });
    const height = cad.parameter.length("height", mm(50), { min: mm(1) });
    const thickness = cad.parameter.length("thickness", mm(6), { min: mm(1) });
    const radius = cad.parameter.length("radius", mm(4), { min: mm(0.1) });
    const profile = cad.sketch("profile", plane.xy(), (sketch) => {
      const outer = sketch.rectangle("outer", { width, height });
      const hole = sketch.circle("hole", {
        center: vec2(width.mul(0.25), mm(0)),
        radius,
        segments: 96,
      });
      return sketch.profile(outer, { holes: [hole.loop()] });
    });
    const solid = cad.extrude("solid", profile, {
      distance: thickness,
      symmetric: true,
    });
    cad.output("plate", solid);
    const document = cad.build();

    const firstResult = await evaluator.evaluate(document);
    const secondResult = await evaluator.evaluate(document, { parameters: { width: 100 } });
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    if (!firstResult.ok || !secondResult.ok) return;
    try {
      const first = firstResult.value.output("plate").measure();
      const second = secondResult.value.output("plate").measure();
      expect(first.boundingBox.min[0]).toBeCloseTo(-40, 5);
      expect(first.boundingBox.max[0]).toBeCloseTo(40, 5);
      expect(second.boundingBox.min[0]).toBeCloseTo(-50, 5);
      expect(second.boundingBox.max[0]).toBeCloseTo(50, 5);
      expect(second.volume - first.volume).toBeCloseTo(20 * 50 * 6, 1);
      expect(firstResult.value.parameters.width).toBe(80);
      expect(secondResult.value.parameters.width).toBe(100);
      expect(Object.keys(document.nodes)).toContain("solid");
    } finally {
      firstResult.value.dispose();
      secondResult.value.dispose();
    }
  });

  it("revolves a profile around its local Y axis", async () => {
    const cad = design("revolve");
    const radius = mm(10);
    const height = mm(30);
    const profile = cad.sketch("profile", plane.xy(), (sketch) => {
      const rectangle = sketch.rectangle("section", {
        width: radius,
        height,
        center: vec2(radius.mul(0.5), mm(0)),
      });
      return sketch.profile(rectangle);
    });
    const solid = cad.revolve("solid", profile, { segments: 128 });
    cad.output("solid", solid);
    const result = await evaluate(cad.build());
    try {
      const measured = result.output("solid").measure();
      expect(Math.abs(measured.volume - Math.PI * 10 * 10 * 30)).toBeLessThan(5);
      expect(measured.boundingBox.min[1]).toBeCloseTo(-15, 4);
      expect(measured.boundingBox.max[1]).toBeCloseTo(15, 4);
      expect(measured.boundingBox.min[0]).toBeCloseTo(-10, 2);
      expect(measured.boundingBox.max[2]).toBeCloseTo(10, 2);
    } finally {
      result.dispose();
    }
  });

  it("executes union, subtraction, and intersection", async () => {
    const cad = design("booleans");
    const first = cad.box("first", { size: vec3(mm(10), mm(10), mm(10)) });
    const rawSecond = cad.box("raw-second", {
      size: vec3(mm(10), mm(10), mm(10)),
    });
    const second = cad.translate("second", rawSecond, vec3(mm(5), mm(0), mm(0)));
    const union = cad.union("union", first, [second]);
    const difference = cad.subtract("difference", first, [second]);
    const intersection = cad.intersect("intersection", first, [second]);
    cad
      .output("union", union)
      .output("difference", difference)
      .output("intersection", intersection);
    const result = await evaluate(cad.build());
    try {
      expect(result.output("union").measure().volume).toBeCloseTo(1_500, 8);
      expect(result.output("difference").measure().volume).toBeCloseTo(500, 8);
      expect(result.output("intersection").measure().volume).toBeCloseTo(500, 8);
    } finally {
      result.dispose();
    }
  });

  it("reports a valid but empty boolean result", async () => {
    const cad = design("empty");
    const first = cad.box("first", { size: vec3(mm(1), mm(1), mm(1)) });
    const rawSecond = cad.box("raw-second", { size: vec3(mm(1), mm(1), mm(1)) });
    const second = cad.translate("second", rawSecond, vec3(mm(10), mm(0), mm(0)));
    cad.output("empty", cad.intersect("empty", first, [second]));
    const result = await evaluator.evaluate(cad.build());
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "EMPTY_RESULT")).toBe(true);
  });

  it("places shared parts in a nested assembly without copying definitions", async () => {
    const cad = design("assembly");
    const solid = cad.box("solid", { size: vec3(mm(10), mm(10), mm(10)) });
    const part = cad.part("part", solid, { partNumber: "P-001" });
    const subassembly = cad.assembly("subassembly", (assembly) => {
      assembly.instance("first", part);
      assembly.instance("second", part, {
        placement: [tf.translate(vec3(mm(15), mm(0), mm(0)))],
      });
    });
    const product = cad.assembly("product", (assembly) => {
      assembly.instance("sub", subassembly, {
        placement: [tf.translate(vec3(mm(0), mm(20), mm(0)))],
      });
    });
    cad.output("product", product);
    const result = await evaluate(cad.build());
    try {
      const output = result.output("product");
      expect(output).toBeInstanceOf(EvaluatedAssembly);
      if (!(output instanceof EvaluatedAssembly)) return;
      expect(output.instances.map((instance) => instance.id)).toEqual([
        "sub/first",
        "sub/second",
      ]);
      expect(output.instances.every((instance) => instance.partNode === "part")).toBe(true);
      expect(output.measure().volume).toBeCloseTo(2_000, 3);
      expect(output.measure().boundingBox).toEqual({
        min: [0, 20, 0],
        max: [25, 30, 10],
      });
    } finally {
      result.dispose();
    }
  });

  it("exports binary STL and OBJ", async () => {
    const cad = design("export");
    const solid = cad.box("solid", { size: vec3(mm(1), mm(1), mm(1)) });
    cad.output("solid", solid);
    const result = await evaluate(cad.build());
    try {
      const output = result.output("solid");
      const stl = output.export("stl");
      const obj = output.export("obj");
      expect(stl).toBeInstanceOf(Uint8Array);
      expect((stl as Uint8Array).byteLength).toBe(84 + 12 * 50);
      expect(obj).toContain("o solid");
      expect(obj).toContain("f ");
    } finally {
      result.dispose();
    }
  });
});
