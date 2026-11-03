import { afterAll, describe, expect, it } from "vitest";
import {
  AssemblyRef,
  LoopRef,
  MaterialRef,
  PartRef,
  PointRef,
  ProfileDefinition,
  SolidRef,
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

describe("builder option values", () => {
  function profile(cad: DesignBuilder, options?: { readonly tolerance?: number }) {
    return cad.sketch(
      "profile",
      plane.xy(),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("rectangle", { width: mm(4), height: mm(4) }),
        ),
      options,
    );
  }

  it("rejects option values the document grammar cannot store", () => {
    const cases: readonly (readonly [
      string,
      (cad: DesignBuilder) => unknown,
      ErrorConstructor,
    ])[] = [
      ["box center", (cad) => cad.box("b", { size: vec3(mm(1), mm(1), mm(1)), center: "yes" as never }), TypeError],
      ["cylinder center", (cad) => cad.cylinder("c", { height: mm(1), radius: mm(1), center: 1 as never }), TypeError],
      ["cylinder segments 2", (cad) => cad.cylinder("c", { height: mm(1), radius: mm(1), segments: 2 }), RangeError],
      ["cylinder segments 7.5", (cad) => cad.cylinder("c", { height: mm(1), radius: mm(1), segments: 7.5 }), RangeError],
      ["cylinder segments string", (cad) => cad.cylinder("c", { height: mm(1), radius: mm(1), segments: "8" as never }), TypeError],
      ["sphere segments 3", (cad) => cad.sphere("s", { radius: mm(1), segments: 3 }), RangeError],
      ["sphere segments NaN", (cad) => cad.sphere("s", { radius: mm(1), segments: Number.NaN }), RangeError],
      ["sketch tolerance 0", (cad) => profile(cad, { tolerance: 0 }), RangeError],
      ["sketch tolerance -1", (cad) => profile(cad, { tolerance: -1 }), RangeError],
      ["sketch tolerance NaN", (cad) => profile(cad, { tolerance: Number.NaN }), RangeError],
      ["sketch tolerance Infinity", (cad) => profile(cad, { tolerance: Number.POSITIVE_INFINITY }), RangeError],
      [
        "circle segments",
        (cad) =>
          cad.sketch("s", plane.xy(), (sketch) =>
            sketch.profile(sketch.circle("c", { radius: mm(1), segments: 2 }).loop()),
          ),
        RangeError,
      ],
      [
        "arc segments",
        (cad) =>
          cad.sketch("s", plane.xy(), (sketch) => {
            sketch.arc("a", { radius: mm(1), startAngle: deg(0), endAngle: deg(90), segments: 1 });
            return sketch.profile(sketch.circle("c", { radius: mm(1) }).loop());
          }),
        RangeError,
      ],
      [
        "arc clockwise",
        (cad) =>
          cad.sketch("s", plane.xy(), (sketch) => {
            sketch.arc("a", { radius: mm(1), startAngle: deg(0), endAngle: deg(90), clockwise: "no" as never });
            return sketch.profile(sketch.circle("c", { radius: mm(1) }).loop());
          }),
        TypeError,
      ],
      [
        "loop reversed",
        (cad) =>
          cad.sketch("s", plane.xy(), (sketch) =>
            sketch.profile(sketch.circle("c", { radius: mm(1) }).loop({ reversed: 1 as never })),
          ),
        TypeError,
      ],
      ["extrude divisions -1", (cad) => cad.extrude("e", profile(cad), { distance: mm(1), divisions: -1 }), RangeError],
      ["extrude divisions 1.5", (cad) => cad.extrude("e", profile(cad), { distance: mm(1), divisions: 1.5 }), RangeError],
      ["extrude symmetric", (cad) => cad.extrude("e", profile(cad), { distance: mm(1), symmetric: "true" as never }), TypeError],
      ["revolve segments", (cad) => cad.revolve("r", profile(cad), { segments: 2 }), RangeError],
      [
        "assembly suppressed",
        (cad) => {
          const part = cad.part("p", cad.box("b", { size: vec3(mm(1), mm(1), mm(1)) }));
          return cad.assembly("a", (assembly) =>
            assembly.instance("i", part, { suppressed: "no" as never }),
          );
        },
        TypeError,
      ],
      ["parameter label", (cad) => cad.parameter.length("p", mm(1), { label: 1 as never }), TypeError],
      ["parameter description", (cad) => cad.parameter.length("p", mm(1), { description: {} as never }), TypeError],
      [
        "material description",
        (cad) => cad.material("m", { name: "M", massDensity: gramsPerCubicCentimeter(1), description: 1 as never }),
        TypeError,
      ],
      [
        "configuration description",
        (cad) => {
          const width = cad.parameter.length("w", mm(1));
          return cad.configuration("c", (configuration) => configuration.parameter(width, mm(2)), {
            description: 2 as never,
          });
        },
        TypeError,
      ],
    ];
    for (const [label, use, errorType] of cases) {
      const cad = design(`invalid-option-${label.replaceAll(" ", "-")}`);
      expect(() => use(cad), label).toThrow(errorType);
    }
  });

  it("emits builder output that strict parsing reloads unchanged", async () => {
    const cad = design("round-trip-options", { metadata: { revision: 3 } });
    const width = cad.parameter.length("width", mm(20), {
      min: mm(1),
      max: mm(100),
      label: "Width",
      description: "Overall width",
    });
    const box = cad.box("box", { size: vec3(width, mm(10), mm(5)), center: true });
    const cylinder = cad.cylinder("cylinder", {
      height: mm(4),
      radius: mm(2),
      radiusTop: mm(1),
      center: false,
      segments: 3,
    });
    const sphere = cad.sphere("sphere", { radius: mm(2), segments: 4 });
    const sketch = cad.sketch(
      "sketch",
      plane.xz(vec3(mm(0), mm(1), mm(0))),
      (builder) => {
        builder.arc("arc", {
          radius: mm(1),
          startAngle: deg(0),
          endAngle: deg(45),
          clockwise: true,
          segments: 2,
        });
        return builder.profile(
          builder.circle("circle", { radius: mm(3), segments: 3 }).loop({ reversed: true }),
        );
      },
      { tolerance: 1e-5 },
    );
    const extruded = cad.extrude("extruded", sketch, {
      distance: mm(2),
      symmetric: true,
      divisions: 3,
    });
    const revolved = cad.revolve("revolved", sketch, { angle: deg(90), segments: 3 });
    const union = cad.union("union", box, [cylinder, sphere, extruded, revolved]);
    const steel = cad.material("steel", {
      name: "Steel",
      massDensity: gramsPerCubicCentimeter(7.85),
      description: "Structural steel",
      metadata: { grade: "S355" },
    });
    const part = cad.part("part", union, {
      partNumber: "P-1",
      description: "Bracket",
      materialRef: steel,
      metadata: { finish: "painted" },
    });
    const assembly = cad.assembly("assembly", (builder) =>
      builder.instance("first", part, {
        placement: [tf.translate(vec3(mm(1), mm(0), mm(0)))],
        suppressed: true,
      }),
    );
    cad.configuration(
      "large",
      (configuration) =>
        configuration
          .parameter(width, mm(50))
          .instanceSuppressed(assembly, "first", false),
      { description: "Large variant", metadata: { tier: "pro" } },
    );
    cad.output("assembly", assembly);
    const document = cad.build();
    expect(validateDocument(document).ok).toBe(true);
    const text = stringifyDocument(document);
    const reparsed = parseDocument(text);
    expect(reparsed.ok, JSON.stringify(reparsed.diagnostics)).toBe(true);
    if (!reparsed.ok) return;
    expect(stringifyDocument(reparsed.value)).toBe(text);
    expect(await hashDocument(reparsed.value, { includeMetadata: true })).toBe(
      await hashDocument(document, { includeMetadata: true }),
    );
  });

  it("reports grammar-invalid feature options in in-memory documents", () => {
    const cad = design("invalid-in-memory");
    const profile = cad.sketch("sketch", plane.xy(), (builder) =>
      builder.profile(builder.circle("circle", { radius: mm(3) }).loop()),
    );
    const cylinder = cad.cylinder("cylinder", { height: mm(1), radius: mm(1) });
    const sphere = cad.sphere("sphere", { radius: mm(1) });
    const extruded = cad.extrude("extruded", profile, { distance: mm(1) });
    const revolved = cad.revolve("revolved", profile);
    cad.output("result", cad.union("result", cylinder, [sphere, extruded, revolved]));
    const source = JSON.parse(stringifyDocument(cad.build())) as any;
    const cases: readonly (readonly [string, (value: any) => void])[] = [
      ["/nodes/sketch/tolerance", (value) => (value.nodes.sketch.tolerance = -1)],
      ["/nodes/sketch/tolerance", (value) => (value.nodes.sketch.tolerance = 0)],
      [
        "/nodes/sketch/entities/circle/segments",
        (value) => (value.nodes.sketch.entities.circle.segments = 2),
      ],
      ["/nodes/cylinder/segments", (value) => (value.nodes.cylinder.segments = 2.5)],
      ["/nodes/sphere/segments", (value) => (value.nodes.sphere.segments = 3)],
      ["/nodes/extruded/divisions", (value) => (value.nodes.extruded.divisions = -1)],
      ["/nodes/revolved/segments", (value) => (value.nodes.revolved.segments = 0)],
    ];
    for (const [path, mutate] of cases) {
      const invalid = structuredClone(source);
      mutate(invalid);
      expect(validateDocument(invalid).diagnostics, path).toContainEqual(
        expect.objectContaining({ code: "FEATURE_INVALID", path }),
      );
      expect(parseDocumentValue(invalid).ok, path).toBe(false);
    }
    const arc = structuredClone(source);
    arc.nodes.sketch.entities.arc = {
      kind: "arc",
      center: "circle.center",
      radius: mm(1).ir,
      startAngle: deg(0).ir,
      endAngle: deg(90).ir,
      clockwise: false,
      segments: 1,
    };
    expect(validateDocument(arc).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FEATURE_INVALID",
        path: "/nodes/sketch/entities/arc/segments",
      }),
    );
    expect(validateDocument(source).ok).toBe(true);
  });
});

describe("builder input detachment", () => {
  it("deeply freezes documents built from shallow-frozen caller data", async () => {
    const owner = { team: "fixtures" };
    const supplier = { name: "Acme" };
    const translation = { op: "literal", dimension: "length", value: 5 };
    const cad = design("detached", { metadata: Object.freeze({ owner }) });
    const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
    const moved = cad.transform("moved", box, [
      Object.freeze({
        kind: "translate" as const,
        value: [translation as never, mm(0).ir, mm(0).ir] as const,
      }),
    ]);
    const steel = cad.material("steel", {
      name: "Steel",
      massDensity: gramsPerCubicCentimeter(7.8),
      metadata: Object.freeze({ supplier }),
    });
    const part = cad.part("part", moved, {
      materialRef: steel,
      metadata: Object.freeze({ supplier }),
    });
    cad.configuration(
      "variant",
      (configuration) => configuration.partMaterial(part, steel),
      { metadata: Object.freeze({ owner }) },
    );
    cad.output("part", part);
    const document = cad.build();
    const before = stringifyDocument(document);
    const hash = await hashDocument(document, { includeMetadata: true });

    const unfrozen: string[] = [];
    const visit = (value: unknown, path: string): void => {
      if (typeof value !== "object" || value === null) return;
      if (!Object.isFrozen(value)) unfrozen.push(path);
      for (const [key, child] of Object.entries(value)) visit(child, `${path}/${key}`);
    };
    visit(document, "");
    expect(unfrozen).toEqual([]);

    owner.team = "mutated";
    supplier.name = "Mutated";
    expect(() => {
      translation.value = 100;
    }).toThrow(TypeError);
    expect(stringifyDocument(document)).toBe(before);
    expect(await hashDocument(document, { includeMetadata: true })).toBe(hash);
  });

  it("leaves caller arrays and metadata reusable after authoring", () => {
    const cad = design("reusable");
    const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
    const operations = [tf.translate(vec3(mm(1), mm(0), mm(0)))];
    cad.transform("first", box, operations);
    operations.push(tf.translate(vec3(mm(0), mm(1), mm(0))));
    cad.transform("second", box, operations);
    const metadata: Record<string, unknown> = { revision: 1 };
    const part = cad.part("part", box, { metadata: metadata as never });
    metadata.revision = 2;
    const placement = [tf.translate(vec3(mm(1), mm(0), mm(0)))];
    cad.assembly("assembly", (assembly) => {
      assembly.instance("first", part, { placement });
      placement.push(tf.translate(vec3(mm(0), mm(0), mm(1))));
      assembly.instance("second", part, { placement });
    });
    const document = cad.build();
    expect(Object.isFrozen(operations)).toBe(false);
    expect(Object.isFrozen(metadata)).toBe(false);
    expect(Object.isFrozen(placement)).toBe(false);
    const nodes = document.nodes as Readonly<Record<string, any>>;
    expect(nodes.first.operations).toHaveLength(1);
    expect(nodes.second.operations).toHaveLength(2);
    expect(nodes.part.metadata).toEqual({ revision: 1 });
    expect(nodes.assembly.instances[0].placement).toHaveLength(1);
    expect(nodes.assembly.instances[1].placement).toHaveLength(2);
  });

  it("rejects metadata that JSON cannot preserve", () => {
    class Tag {
      readonly label = "tag";
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const invalid: readonly unknown[] = [
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: new Map([["a", 1]]) },
      { value: new Set([1]) },
      { value: new Date(0) },
      { value: new Tag() },
      { value: 1n },
      { value: () => undefined },
      { value: Symbol("symbol") },
      { value: [undefined] },
      { value: Object.assign(new Array<number>(3), { 0: 1, 2: 3 }) },
      cyclic,
      new Map(),
      ["not", "a", "record"],
    ];
    for (const metadata of invalid) {
      expect(() => design("metadata", { metadata: metadata as never })).toThrow(
        TypeError,
      );
      const cad = design("metadata");
      const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
      expect(() => cad.part("part", box, { metadata: metadata as never })).toThrow(
        TypeError,
      );
      expect(() =>
        cad.material("material", {
          name: "Material",
          massDensity: gramsPerCubicCentimeter(1),
          metadata: metadata as never,
        }),
      ).toThrow(TypeError);
    }

    const shared = { a: 1 };
    const accepted = design("accepted", {
      metadata: {
        nested: { list: [1, "two", true, null, shared, shared] },
        omitted: undefined,
        own: JSON.parse('{"__proto__":{"kept":true}}'),
      } as never,
    }).build();
    expect(accepted.metadata).toEqual({
      nested: { list: [1, "two", true, null, { a: 1 }, { a: 1 }] },
      own: JSON.parse('{"__proto__":{"kept":true}}'),
    });
    expect(Object.hasOwn(accepted.metadata!.own as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(accepted.metadata!.own)).toBe(Object.prototype);
    const reparsed = parseDocument(stringifyDocument(accepted));
    expect(reparsed.ok, JSON.stringify(reparsed.diagnostics)).toBe(true);
  });

  it("refuses to write hand-built documents with non-JSON metadata", async () => {
    const document = design("hand-built").build();
    for (const value of [new Map([["a", 1]]), new Date(0), new Set([1])]) {
      const handBuilt = { ...document, metadata: { value } } as never;
      expect(() => stringifyDocument(handBuilt)).toThrow(
        "CAD documents can contain only plain JSON objects and arrays",
      );
      await expect(
        hashDocument(handBuilt, { includeMetadata: true }),
      ).rejects.toThrow("CAD documents can contain only plain JSON objects and arrays");
    }
  });
});

describe("part options", () => {
  function setup() {
    const cad = design("part-options");
    const housing = cad.box("housing", { size: vec3(mm(100), mm(10), mm(100)) });
    const fastener = cad.box("fastener", { size: vec3(mm(1), mm(1), mm(1)) });
    const steel = cad.material("steel", {
      name: "Steel",
      massDensity: gramsPerCubicCentimeter(7.8),
    });
    return { cad, housing, fastener, steel };
  }

  it("rejects unknown and node-overriding keys from an options variable", () => {
    const { cad, housing, fastener } = setup();
    const bomRow = { partNumber: "BRK-1", quantity: 4 };
    const overrides: readonly Record<string, unknown>[] = [
      bomRow,
      { partNumber: "HSG-100", solid: fastener.toIR() },
      { kind: "assembly" },
      { material: "Aluminium 6061", materialId: "steel" },
      { materialId: "steel" },
    ];
    for (const options of overrides) {
      expect(() => cad.part("part", housing, options as never), JSON.stringify(options))
        .toThrow(/unsupported field/);
    }
    expect(cad.build().nodes).not.toHaveProperty("part");
  });

  it("checks part field types and builds only authored fields", async () => {
    const { cad, housing, steel } = setup();
    expect(() => cad.part("p1", housing, { partNumber: 7 as never })).toThrow(TypeError);
    expect(() => cad.part("p2", housing, { description: {} as never })).toThrow(TypeError);
    expect(() => cad.part("p3", housing, { material: false as never })).toThrow(TypeError);
    const part = cad.part("part", housing, {
      partNumber: "HSG-100",
      description: "Housing",
      materialRef: steel,
      massDensity: gramsPerCubicCentimeter(2.7),
      metadata: { finish: "anodized" },
      material: undefined as never,
    });
    const labelled = cad.part("labelled", housing, { material: "Aluminium 6061" });
    cad.output("part", part);
    cad.output("labelled", labelled);
    const document = cad.build();
    const nodes = document.nodes as Readonly<Record<string, unknown>>;
    expect(nodes.part).toEqual({
      kind: "part",
      solid: { node: "housing", kind: "solid" },
      partNumber: "HSG-100",
      description: "Housing",
      materialId: "steel",
      massDensity: gramsPerCubicCentimeter(2.7).ir,
      metadata: { finish: "anodized" },
    });
    expect(nodes.labelled).toEqual({
      kind: "part",
      solid: { node: "housing", kind: "solid" },
      material: "Aluminium 6061",
    });
    const reparsed = parseDocument(stringifyDocument(document));
    expect(reparsed.ok, JSON.stringify(reparsed.diagnostics)).toBe(true);
    if (!reparsed.ok) return;
    expect(await hashDocument(reparsed.value)).toBe(await hashDocument(document));
  });
});

describe("builder ownership boundary", () => {
  function setup() {
    const cad = design("ownership");
    const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
    const part = cad.part("part", box);
    return { cad, box, part };
  }

  it("rejects handles built with public constructors instead of builder methods", () => {
    const { cad, box } = setup();
    expect(() => cad.translate("t", new SolidRef(cad, "ghost" as never), vec3(mm(1), mm(0), mm(0))))
      .toThrow(/returned by a DesignBuilder method/);
    expect(() => cad.union("u", box, [new SolidRef(cad, "box" as never)]))
      .toThrow(/returned by a DesignBuilder method/);
    expect(() =>
      cad.assembly("a", (assembly) =>
        assembly.instance("i", new PartRef(cad, "box" as never)),
      ),
    ).toThrow(/returned by a DesignBuilder method/);
    expect(() =>
      cad.part("p", box, { materialRef: new MaterialRef(cad, "ghost" as never) }),
    ).toThrow(/returned by a DesignBuilder method/);
    expect(() => cad.output("o", new AssemblyRef(cad, "box" as never)))
      .toThrow(/returned by a DesignBuilder method/);
    expect(validateDocument(cad.build()).ok).toBe(true);
  });

  it("only stores assembly instances added through instance()", () => {
    const { cad, part } = setup();
    expect(() =>
      cad.assembly("raw", (assembly) => {
        assembly.instances.push({
          id: "ghost" as never,
          component: { node: "ghost" as never, kind: "part" },
          placement: [],
          suppressed: false,
        });
      }),
    ).toThrow(/instance\(\)/);

    const other = design("other");
    const otherPart = other.part("part", other.box("box", { size: vec3(mm(1), mm(1), mm(1)) }));
    let foreignRecord: unknown;
    other.assembly("source", (assembly) => {
      assembly.instance("foreign", otherPart);
      foreignRecord = assembly.instances[0];
    });
    expect(() =>
      cad.assembly("borrowed", (assembly) => {
        assembly.instances.push(foreignRecord as never);
      }),
    ).toThrow(/instance\(\)/);

    expect(() =>
      cad.assembly("duplicate", (assembly) => {
        assembly.instance("first", part);
        assembly.instances.push(assembly.instances[0]!);
      }),
    ).toThrow(/Duplicate assembly instance/);

    let escaped: import("../src/index.js").AssemblyBuilder | undefined;
    const assembly = cad.assembly("assembly", (builder) => {
      escaped = builder;
      builder.instance("first", part);
    });
    expect(() => escaped!.instance("late", part)).toThrow(/closed/);
    cad.output("assembly", assembly);
    const node = (cad.build().nodes as Readonly<Record<string, any>>).assembly;
    expect(node.instances.map((instance: { id: string }) => instance.id)).toEqual(["first"]);
    expect(validateDocument(cad.build()).ok).toBe(true);
  });

  it("requires the sketch callback to return its own builder's profile", () => {
    const { cad } = setup();
    let foreignProfile: ProfileDefinition | undefined;
    cad.sketch("source", plane.xy(), (sketch) => {
      foreignProfile = sketch.profile(sketch.circle("disk", { radius: mm(1) }).loop());
      return foreignProfile;
    });
    expect(() =>
      cad.sketch("borrowed", plane.xy(), (sketch) => {
        sketch.circle("other", { radius: mm(2) });
        return foreignProfile!;
      }),
    ).toThrow(/cannot cross sketch boundaries/);
    expect(() =>
      cad.sketch("forged-profile", plane.xy(), (sketch) => {
        sketch.circle("disk", { radius: mm(2) });
        return new ProfileDefinition(sketch, {
          outer: { kind: "circle", entity: "disk" as never },
          holes: [],
        });
      }),
    ).toThrow(/returned by a SketchBuilder method/);
    expect(() =>
      cad.sketch("forged-loop", plane.xy(), (sketch) => {
        sketch.circle("disk", { radius: mm(2) });
        return sketch.profile(
          new LoopRef(sketch, { kind: "circle", entity: "disk" as never }),
        );
      }),
    ).toThrow(/returned by a SketchBuilder method/);
    expect(() =>
      cad.sketch("forged-point", plane.xy(), (sketch) => {
        const a = sketch.point("a", vec2(mm(0), mm(0)));
        sketch.line("l", a, new PointRef(sketch, "ghost" as never));
        return sketch.profile(sketch.circle("disk", { radius: mm(2) }).loop());
      }),
    ).toThrow(/returned by a SketchBuilder method/);
    expect(() =>
      cad.sketch("raw-entity", plane.xy(), (sketch) => {
        (sketch.entities as Record<string, unknown>).ghost = {
          kind: "circle",
          center: "nowhere",
          radius: mm(1).ir,
        };
        return sketch.profile(sketch.circle("disk", { radius: mm(2) }).loop());
      }),
    ).toThrow(/SketchBuilder method/);

    let escaped: SketchBuilder | undefined;
    cad.sketch("escaped", plane.xy(), (sketch) => {
      escaped = sketch;
      return sketch.profile(sketch.circle("disk", { radius: mm(2) }).loop());
    });
    expect(() => escaped!.point("late", vec2(mm(0), mm(0)))).toThrow(/closed/);
    expect(validateDocument(cad.build()).ok).toBe(true);
  });
});
