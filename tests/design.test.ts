import { afterAll, describe, expect, it } from "vitest";
import {
  createEvaluator,
  deg,
  design,
  evaluateExpression,
  hashDocument,
  mm,
  parseDocument,
  parseDocumentValue,
  plane,
  stringifyDocument,
  validateDocument,
  vec2,
  vec3,
  type DesignDocument,
  type Evaluator,
  type ExpressionIR,
  type SketchBuilder,
} from "../src/index.js";

let evaluator: Evaluator | undefined;

async function sharedEvaluator(): Promise<Evaluator> {
  evaluator ??= await createEvaluator();
  return evaluator;
}

afterAll(() => {
  evaluator?.dispose();
});

function evaluateLiteralIR(ir: ExpressionIR): number {
  return evaluateExpression(ir, {
    resolveParameter(id) {
      throw new Error(`Unexpected parameter '${id}'`);
    },
  });
}

function orderedDocument(reverse: boolean, metadata?: string): DesignDocument {
  const cad = design("canonical", {
    ...(metadata === undefined ? {} : { metadata: { note: metadata } }),
  });
  let box;
  let sphere;
  if (reverse) {
    sphere = cad.sphere("sphere", { radius: mm(2) });
    box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
  } else {
    box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
    sphere = cad.sphere("sphere", { radius: mm(2) });
  }
  const result = cad.subtract("result", box, [sphere]);
  cad.output("result", result);
  return cad.build();
}

describe("document IR", () => {
  it("serializes canonically independent of construction order", () => {
    expect(stringifyDocument(orderedDocument(false))).toBe(
      stringifyDocument(orderedDocument(true)),
    );
  });

  it("round-trips through validated JSON", () => {
    const source = orderedDocument(false);
    const parsed = parseDocument(stringifyDocument(source));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(source);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.nodes)).toBe(true);
  });

  it("uses semantic hashes that ignore display metadata by default", async () => {
    const first = orderedDocument(false, "first");
    const second = orderedDocument(false, "second");
    const firstHash = await hashDocument(first);
    expect(firstHash).toBe(await hashDocument(second));
    expect(firstHash).toBe(
      "8360a68e448e2d3431bf697e2d4b48d9b4d7151ecb3a1243b9a25f9bb6603db6",
    );
    expect(await hashDocument(first, { includeMetadata: true })).not.toBe(
      await hashDocument(second, { includeMetadata: true }),
    );
  });

  it("rejects missing references and graph cycles", () => {
    const missing = JSON.parse(stringifyDocument(orderedDocument(false))) as any;
    missing.nodes.result.target.node = "absent";
    const missingResult = parseDocumentValue(missing);
    expect(missingResult.ok).toBe(false);
    expect(missingResult.diagnostics.some((item) => item.code === "REFERENCE_MISSING")).toBe(
      true,
    );

    const cyclic = JSON.parse(stringifyDocument(orderedDocument(false))) as any;
    cyclic.nodes.loop = {
      kind: "transform",
      input: { node: "loop", kind: "solid" },
      operations: [
        {
          kind: "translate",
          value: [mm(1).ir, mm(0).ir, mm(0).ir],
        },
      ],
    };
    cyclic.outputs.result = { node: "loop", kind: "solid" };
    const cycleResult = parseDocumentValue(cyclic);
    expect(cycleResult.ok).toBe(false);
    expect(cycleResult.diagnostics.some((item) => item.code === "GRAPH_CYCLE")).toBe(
      true,
    );
  });

  it("enforces dimensional expressions at compile time and validation time", () => {
    if (false) {
      // @ts-expect-error Lengths and angles cannot be added.
      mm(1).add(deg(1));
    }
    const document = orderedDocument(false);
    const invalid = JSON.parse(stringifyDocument(document)) as any;
    invalid.nodes.box.size[0] = deg(10).ir;
    const result = parseDocumentValue(invalid);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "EXPRESSION_DIMENSION_MISMATCH",
      ),
    ).toBe(true);
  });
});

describe("SketchBuilder.regularPolygon", () => {
  function polygonDocument(
    sides: number,
    options: Parameters<SketchBuilder["regularPolygon"]>[3] = {},
  ): DesignDocument {
    const cad = design("regular-polygon");
    const profile = cad.sketch("profile", plane.xy(), (sketch) =>
      sketch.profile(sketch.regularPolygon("polygon", sides, mm(10), options)),
    );
    const prism = cad.extrude("prism", profile, { distance: mm(2) });
    cad.output("prism", prism);
    return cad.build();
  }

  function vertices(document: DesignDocument): [number, number][] {
    const node = document.nodes.profile;
    if (node?.kind !== "sketch") throw new Error("Expected a sketch node");
    const points: [number, number][] = [];
    for (let index = 0; ; index += 1) {
      const point = node.entities[`polygon.p${index}` as never];
      if (point === undefined) break;
      if (point.kind !== "point") throw new Error("Expected a point");
      points.push([evaluateLiteralIR(point.x), evaluateLiteralIR(point.y)]);
    }
    return points;
  }

  it("places every vertex on the circumcircle from the literal rotation", () => {
    for (const sides of [3, 6, 11]) {
      for (const rotationDegrees of [undefined, 0, 15, -90]) {
        const document = polygonDocument(
          sides,
          rotationDegrees === undefined ? {} : { rotation: deg(rotationDegrees) },
        );
        const points = vertices(document);
        expect(points).toHaveLength(sides);
        const base = ((rotationDegrees ?? 0) * Math.PI) / 180;
        points.forEach(([x, y], index) => {
          const angle = base + (index * 2 * Math.PI) / sides;
          expect(x).toBeCloseTo(10 * Math.cos(angle), 12);
          expect(y).toBeCloseTo(10 * Math.sin(angle), 12);
        });
        const node = document.nodes.profile;
        if (node?.kind !== "sketch") throw new Error("Expected a sketch node");
        expect(node.profile.outer).toEqual({
          kind: "edges",
          edges: Array.from({ length: sides }, (_, index) => ({
            entity: `polygon.e${index}`,
          })),
        });
        const reparsed = parseDocument(stringifyDocument(document));
        expect(reparsed.ok, JSON.stringify(reparsed.diagnostics)).toBe(true);
      }
    }
  });

  it("offsets vertices by a parametric center", () => {
    const cad = design("centered-polygon");
    const x = cad.parameter.length("x", mm(5));
    cad.sketch("profile", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.regularPolygon("polygon", 4, mm(2), {
          center: vec2(x, mm(-1)),
          rotation: deg(90),
        }),
      ),
    );
    const document = cad.build();
    const node = document.nodes.profile;
    if (node?.kind !== "sketch") throw new Error("Expected a sketch node");
    const first = node.entities["polygon.p0" as never];
    if (first?.kind !== "point") throw new Error("Expected a point");
    expect(
      evaluateExpression(first.x, { resolveParameter: () => 5 }),
    ).toBeCloseTo(5, 12);
    expect(evaluateLiteralIR(first.y)).toBeCloseTo(1, 12);
    expect(validateDocument(document).ok).toBe(true);
  });

  it("evaluates to the regular-prism volume", async () => {
    for (const [sides, rotation] of [
      [3, 0],
      [6, 30],
      [12, 7.5],
    ] as const) {
      const result = await (await sharedEvaluator()).evaluate(
        polygonDocument(sides, { rotation: deg(rotation) }),
      );
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) continue;
      try {
        const area = (sides / 2) * 10 * 10 * Math.sin((2 * Math.PI) / sides);
        expect(result.value.output("prism").measure().volume).toBeCloseTo(
          area * 2,
          6,
        );
      } finally {
        result.value.dispose();
      }
    }
  });

  it("rejects invalid side counts and non-literal rotations", () => {
    for (const sides of [2, 3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => polygonDocument(sides)).toThrow(TypeError);
    }
    expect(() => polygonDocument(1e12)).toThrow(RangeError);
    const cad = design("parametric-rotation");
    const rotation = cad.parameter.angle("rotation", deg(10));
    expect(() =>
      cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(sketch.regularPolygon("polygon", 5, mm(3), { rotation })),
      ),
    ).toThrow(/literal angle/);
    expect(() =>
      cad.sketch("length-rotation", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.regularPolygon("polygon", 5, mm(3), {
            rotation: mm(1) as never,
          }),
        ),
      ),
    ).toThrow(/rotation must be an angle expression/);
  });
});
