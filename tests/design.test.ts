import { afterAll, describe, expect, it } from "vitest";
import {
  createEvaluator,
  deg,
  design,
  evaluateExpression,
  expr,
  fromExpressionIR,
  gramsPerCubicCentimeter,
  hashDocument,
  mm,
  parseDocument,
  parseDocumentValue,
  plane,
  scalar,
  scalarVec3,
  stringifyDocument,
  tf,
  topology,
  validateDocument,
  vec2,
  vec3,
  type DesignBuilder,
  type DesignDocument,
  type Evaluator,
  type ExpressionIR,
  type NodeId,
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
    const node = document.nodes["profile" as NodeId];
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
        const node = document.nodes["profile" as NodeId];
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
    const node = document.nodes["profile" as NodeId];
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

describe("builder expression inputs", () => {
  type Use = (
    cad: DesignBuilder,
    width: ReturnType<DesignBuilder["parameter"]["length"]>,
  ) => unknown;

  function box(cad: DesignBuilder) {
    return cad.box("base", { size: vec3(mm(10), mm(10), mm(10)) });
  }

  function profile(cad: DesignBuilder) {
    return cad.sketch("base-profile", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("rectangle", { width: mm(4), height: mm(4) }),
      ),
    );
  }

  const uses: readonly (readonly [string, Use])[] = [
    ["box size", (cad, width) => cad.box("b", { size: vec3(width, mm(1), mm(1)) })],
    [
      "cylinder height",
      (cad, width) => cad.cylinder("c", { height: width, radius: mm(1) }),
    ],
    [
      "cylinder radiusTop",
      (cad, width) =>
        cad.cylinder("c", { height: mm(1), radius: mm(1), radiusTop: width }),
    ],
    ["sphere radius", (cad, width) => cad.sphere("s", { radius: width })],
    [
      "derived expression",
      (cad, width) => cad.sphere("s", { radius: width.mul(2).add(mm(1)) }),
    ],
    [
      "parameter default",
      (cad, width) => cad.parameter.length("derived", width.mul(2)),
    ],
    [
      "parameter min",
      (cad, width) => cad.parameter.length("bounded", mm(5), { min: width }),
    ],
    [
      "parameter max",
      (cad, width) => cad.parameter.length("bounded", mm(5), { max: width }),
    ],
    [
      "material density",
      (cad, width) =>
        cad.material("steel", {
          name: "Steel",
          massDensity: gramsPerCubicCentimeter(7.8).mul(
            expressionRatio(width),
          ),
        }),
    ],
    [
      "part density",
      (cad, width) =>
        cad.part("p", box(cad), {
          massDensity: gramsPerCubicCentimeter(1).mul(expressionRatio(width)),
        }),
    ],
    [
      "sketch plane origin",
      (cad, width) =>
        cad.sketch("sk", plane.xy(vec3(width, mm(0), mm(0))), (sketch) =>
          sketch.profile(sketch.circle("circle", { radius: mm(1) }).loop()),
        ),
    ],
    [
      "sketch point",
      (cad, width) =>
        cad.sketch("sk", plane.xy(), (sketch) =>
          sketch.profile(
            sketch.polyline(
              "triangle",
              [vec2(mm(0), mm(0)), vec2(width, mm(0)), vec2(mm(0), mm(1))],
              { closed: true },
            ) as never,
          ),
        ),
    ],
    [
      "sketch circle radius",
      (cad, width) =>
        cad.sketch("sk", plane.xy(), (sketch) =>
          sketch.profile(sketch.circle("circle", { radius: width }).loop()),
        ),
    ],
    [
      "sketch constraint",
      (cad, width) =>
        cad.sketch("sk", plane.xy(), (sketch) => {
          const circle = sketch.circle("circle", { radius: mm(1) });
          sketch.radius("r", circle, width);
          return sketch.profile(circle.loop());
        }),
    ],
    [
      "sketch rectangle",
      (cad, width) =>
        cad.sketch("sk", plane.xy(), (sketch) =>
          sketch.profile(
            sketch.rectangle("rectangle", { width, height: mm(1) }),
          ),
        ),
    ],
    [
      "polyline path",
      (cad, width) =>
        cad.polylinePath("path", [vec3(mm(0), mm(0), mm(0)), vec3(width, mm(0), mm(0))]),
    ],
    [
      "circular-arc path",
      (cad, width) =>
        cad.circularArcPath("path", {
          start: vec3(mm(0), mm(0), mm(0)),
          through: vec3(width, mm(1), mm(0)),
          end: vec3(mm(2), mm(0), mm(0)),
        }),
    ],
    [
      "composite path",
      (cad, width) =>
        cad.compositePath("path", {
          start: vec3(mm(0), mm(0), mm(0)),
          segments: [
            { kind: "line", end: vec3(mm(1), mm(0), mm(0)) },
            {
              kind: "circularArc",
              through: vec3(mm(2), width, mm(0)),
              end: vec3(mm(3), mm(0), mm(0)),
            },
          ],
        }),
    ],
    [
      "extrude distance",
      (cad, width) => cad.extrude("e", profile(cad), { distance: width }),
    ],
    [
      "extrude scaleTop",
      (cad, width) =>
        cad.extrude("e", profile(cad), {
          distance: mm(1),
          scaleTop: [expressionRatio(width), scalar(1)],
        }),
    ],
    [
      "transform operation",
      (cad, width) =>
        cad.transform("t", box(cad), [tf.translate(vec3(width, mm(0), mm(0)))]),
    ],
    [
      "translate convenience",
      (cad, width) => cad.translate("t", box(cad), vec3(mm(0), width, mm(0))),
    ],
    [
      "fillet radius",
      (cad, width) => {
        const base = box(cad);
        return cad.fillet("f", base, {
          edges: topology.edges.createdBy(base).atLeast(1),
          radius: width,
        });
      },
    ],
    [
      "topology predicate",
      (cad, width) => {
        const base = box(cad);
        return cad.fillet("f", base, {
          edges: topology.edges.radius(width).atLeast(1),
          radius: mm(1),
        });
      },
    ],
    [
      "shell thickness",
      (cad, width) => {
        const base = box(cad);
        return cad.shell("s", base, {
          openings: topology.faces.createdBy(base).select(),
          thickness: width,
        });
      },
    ],
    [
      "offset tolerance",
      (cad, width) =>
        cad.offset("o", box(cad), { distance: mm(1), tolerance: width }),
    ],
    [
      "draft neutral plane",
      (cad, width) => {
        const base = box(cad);
        return cad.draft("d", base, {
          faces: topology.faces.createdBy(base).select(),
          angle: deg(1),
          pullDirection: scalarVec3(0, 0, 1),
          neutralPlane: {
            origin: vec3(mm(0), mm(0), width),
            normal: scalarVec3(0, 0, 1),
          },
        });
      },
    ],
    [
      "configuration value",
      (cad, width) => {
        const local = cad.parameter.length("local", mm(1));
        return cad.configuration("config", (configuration) =>
          configuration.parameter(local, width),
        );
      },
    ],
    [
      "assembly placement",
      (cad, width) => {
        const part = cad.part("part", box(cad));
        return cad.assembly("assembly", (assembly) =>
          assembly.instance("instance", part, {
            placement: [tf.translate(vec3(width, mm(0), mm(0)))],
          }),
        );
      },
    ],
  ];

  function expressionRatio(
    width: ReturnType<DesignBuilder["parameter"]["length"]>,
  ) {
    return expr.ratio(width, mm(1));
  }

  it("accepts each input with the builder's own parameters", () => {
    for (const [label, use] of uses) {
      const cad = design(`owned-${label.replaceAll(" ", "-")}`);
      const width = cad.parameter.length("width", mm(10));
      expect(() => use(cad, width), label).not.toThrow();
    }
  });

  it("rejects a parameter from another builder at every input", () => {
    for (const [label, use] of uses) {
      const library = design("library");
      const foreignWidth = library.parameter.length("width", mm(10));
      const consumer = design("consumer");
      expect(() => use(consumer, foreignWidth), label).toThrow(
        "Parameter references cannot cross design boundaries",
      );
    }
  });

  it("does not silently rebind a foreign parameter to a same-ID local one", () => {
    for (const [label, use] of uses) {
      const library = design("library");
      const foreignWidth = library.parameter.length("width", mm(10));
      const consumer = design("consumer");
      consumer.parameter.length("width", mm(500));
      expect(() => use(consumer, foreignWidth), label).toThrow(
        "Parameter references cannot cross design boundaries",
      );
    }
  });

  it("binds raw IR by ID only to an existing parameter of the same dimension", () => {
    const cad = design("raw-parameter-ir");
    cad.parameter.length("width", mm(10));
    cad.parameter.angle("taper", deg(1));
    const raw = (id: string) =>
      fromExpressionIR(
        { op: "parameter", id: id as never, dimension: "length" },
        "length",
      );
    expect(() =>
      cad.box("ok", { size: vec3(raw("width"), mm(1), mm(1)) }),
    ).not.toThrow();
    expect(() =>
      cad.box("missing", { size: vec3(raw("depth"), mm(1), mm(1)) }),
    ).toThrow(/parameter 'depth', which this design does not define/);
    expect(() =>
      cad.box("wrong", { size: vec3(raw("taper"), mm(1), mm(1)) }),
    ).toThrow(/angle parameter 'taper' as length/);
    const document = cad.build();
    expect(validateDocument(document).ok).toBe(true);
  });

  it("rejects wrong-dimensional expressions at every builder input", () => {
    const angle = deg(1) as never;
    const cases: readonly (readonly [string, (cad: DesignBuilder) => unknown])[] = [
      ["box", (cad) => cad.box("b", { size: [mm(1), angle, mm(1)] as never })],
      ["cylinder", (cad) => cad.cylinder("c", { height: angle, radius: mm(1) })],
      ["sphere", (cad) => cad.sphere("s", { radius: angle })],
      ["parameter min", (cad) => cad.parameter.length("p", mm(1), { min: angle })],
      ["parameter max", (cad) => cad.parameter.angle("p", deg(1), { max: mm(1) as never })],
      ["material", (cad) => cad.material("m", { name: "M", massDensity: angle })],
      ["part", (cad) => cad.part("p", box(cad), { massDensity: angle })],
      ["plane", (cad) => plane.xy([mm(0), angle, mm(0)] as never) && cad],
      [
        "sketch point",
        (cad) =>
          cad.sketch("sk", plane.xy(), (sketch) => {
            sketch.point("p", [mm(0), angle] as never);
            return sketch.profile(sketch.circle("c", { radius: mm(1) }).loop());
          }),
      ],
      [
        "sketch arc angle",
        (cad) =>
          cad.sketch("sk", plane.xy(), (sketch) => {
            sketch.arc("a", {
              radius: mm(1),
              startAngle: mm(0) as never,
              endAngle: deg(90),
            });
            return sketch.profile(sketch.circle("c", { radius: mm(1) }).loop());
          }),
      ],
      [
        "sketch angle constraint",
        (cad) =>
          cad.sketch("sk", plane.xy(), (sketch) => {
            const [a, b] = sketch.polyline("l", [
              vec2(mm(0), mm(0)),
              vec2(mm(1), mm(0)),
              vec2(mm(1), mm(1)),
            ]) as readonly [never, never];
            sketch.angle("angle", a, b, mm(1) as never);
            return sketch.profile(sketch.circle("c", { radius: mm(1) }).loop());
          }),
      ],
      [
        "polyline path",
        (cad) => cad.polylinePath("p", [vec3(mm(0), mm(0), mm(0)), [mm(1), mm(0), angle] as never]),
      ],
      ["extrude", (cad) => cad.extrude("e", profile(cad), { distance: angle })],
      ["extrude twist", (cad) => cad.extrude("e", profile(cad), { distance: mm(1), twist: mm(1) as never })],
      ["revolve", (cad) => cad.revolve("r", profile(cad), { angle: mm(1) as never })],
      ["translate", (cad) => cad.translate("t", box(cad), [mm(1), angle, mm(1)] as never)],
      ["rotate", (cad) => cad.rotate("t", box(cad), [deg(1), mm(1), deg(1)] as never)],
      ["scale", (cad) => cad.scale("t", box(cad), [scalar(1), mm(1), scalar(1)] as never)],
      [
        "raw transform",
        (cad) =>
          cad.transform("t", box(cad), [
            { kind: "translate", value: [mm(1).ir, deg(1).ir, mm(1).ir] },
          ]),
      ],
      [
        "fillet",
        (cad) => {
          const base = box(cad);
          return cad.fillet("f", base, {
            edges: topology.edges.createdBy(base).atLeast(1),
            radius: angle,
          });
        },
      ],
      [
        "draft pull direction",
        (cad) => {
          const base = box(cad);
          return cad.draft("d", base, {
            faces: topology.faces.createdBy(base).select(),
            angle: deg(1),
            pullDirection: [scalar(0), scalar(0), mm(1)] as never,
            neutralPlane: {
              origin: vec3(mm(0), mm(0), mm(0)),
              normal: scalarVec3(0, 0, 1),
            },
          });
        },
      ],
      ["topology direction", () => topology.edges.direction([scalar(1), scalar(0), mm(0)] as never)],
      ["topology tolerance", () => topology.faces.normal(scalarVec3(0, 0, 1), mm(1) as never)],
      ["topology position", () => topology.vertices.position(vec3(mm(0), mm(0), mm(0)), angle)],
      [
        "configuration",
        (cad) => {
          const width = cad.parameter.length("w", mm(1));
          return cad.configuration("c", (configuration) =>
            configuration.parameter(width, angle),
          );
        },
      ],
    ];
    for (const [label, use] of cases) {
      const cad = design(`wrong-dimension-${label.replaceAll(" ", "-")}`);
      expect(() => use(cad), label).toThrow(TypeError);
    }
  });
});
