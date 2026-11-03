import { runInNewContext } from "node:vm";
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
  type ConfigurationBuilder,
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

  it("bounds wide topology selections and rejects cyclic ones", () => {
    const cad = design("wide-selection");
    const width = cad.parameter.length("width", mm(1));
    const base = cad.box("base", { size: vec3(mm(10), mm(10), mm(10)) });
    const template = topology.edges.radius(width).atLeast(1);
    const Selection = template.constructor as new (
      ...args: readonly unknown[]
    ) => typeof template;
    const operand = template.ir.query;
    const wide = (length: number) =>
      new Selection(
        "edge",
        { op: "or", queries: Array.from({ length }, () => operand) },
        template.ir.cardinality,
      );
    // The root and its aliased operands count toward the query-node limit,
    // exactly as the parser counts them.
    const limit = 100_000;
    expect(() =>
      cad.fillet("widest", base, { edges: wide(limit - 1), radius: mm(1) }),
    ).not.toThrow();
    expect(() =>
      cad.fillet("too-wide", base, { edges: wide(300_000), radius: mm(1) }),
    ).toThrow(/authoring limit of 100000 topology query nodes/);

    const cyclic: { op: "or"; queries: unknown[] } = { op: "or", queries: [] };
    cyclic.queries.push(operand, cyclic);
    Object.freeze(cyclic.queries);
    Object.freeze(cyclic);
    expect(() =>
      cad.fillet("cyclic", base, {
        edges: new Selection("edge", cyclic, template.ir.cardinality),
        radius: mm(1),
      }),
    ).toThrow(/cannot contain cyclic topology queries/);
    const notCycle: { op: "not"; query: unknown } = { op: "not", query: undefined };
    notCycle.query = { op: "and", queries: Object.freeze([operand, notCycle]) };
    Object.freeze(notCycle.query);
    Object.freeze(notCycle);
    expect(() =>
      cad.chamfer("indirect", base, {
        edges: new Selection("edge", notCycle, template.ir.cardinality),
        distance: mm(1),
      }),
    ).toThrow(/cannot contain cyclic topology queries/);
    const holes: unknown[] = [operand, operand, operand];
    delete holes[1];
    const sparse = { op: "or", queries: Object.freeze(holes) };
    expect(() =>
      cad.fillet("sparse", base, {
        edges: new Selection("edge", Object.freeze(sparse), template.ir.cardinality),
        radius: mm(1),
      }),
    ).toThrow(/query list cannot be sparse/);
    expect(cad.build().nodes).not.toHaveProperty("cyclic");
  });

  it("counts every occurrence of a shared selection query at its own depth", () => {
    const cad = design("shared-selection");
    const base = cad.box("base", { size: vec3(mm(10), mm(10), mm(10)) });
    const template = topology.edges.radius(mm(1)).atLeast(1);
    const Selection = template.constructor as new (
      ...args: readonly unknown[]
    ) => typeof template;
    const selection = (query: unknown) =>
      new Selection("edge", query, template.ir.cardinality);
    const layered = (layers: number): unknown => {
      let query: unknown = template.ir.query;
      for (let layer = 0; layer < layers; layer += 1) {
        query = { op: "and", queries: [query, query] };
      }
      return query;
    };

    // Shared subtrees within the limit are still accepted, and the written
    // document, which expands every alias, reloads.
    cad.fillet("ten-layers", base, { edges: selection(layered(10)), radius: mm(1) });
    const document = cad.build();
    const reparsed = parseDocument(stringifyDocument(document));
    expect(reparsed.ok, JSON.stringify(reparsed.diagnostics)).toBe(true);

    // Forty layers that each alias one operand twice hold 41 distinct
    // queries, but the writer and parser see 2^41 - 1 of them.
    expect(() =>
      cad.fillet("forty-layers", base, {
        edges: selection(layered(40)),
        radius: mm(1),
      }),
    ).toThrow(/authoring limit of 100000 topology query nodes/);

    // A chain first copied near the root counts its whole height again where
    // it recurs deeper.
    let chain: unknown = template.ir.query;
    for (let level = 0; level < 100; level += 1) chain = { op: "not", query: chain };
    let deeper: unknown = chain;
    for (let level = 0; level < 40; level += 1) deeper = { op: "not", query: deeper };
    expect(() =>
      cad.fillet("chain", base, { edges: selection(chain), radius: mm(1) }),
    ).not.toThrow();
    expect(() =>
      cad.fillet("deep-alias", base, {
        edges: selection({ op: "and", queries: [chain, deeper] }),
        radius: mm(1),
      }),
    ).toThrow(/authoring nesting depth of 128/);

    // A list longer than the remaining capacity is rejected before any item
    // is copied, so the accessor on its last item is never reached.
    const items = new Array<number>(1_000_001).fill(0);
    Object.defineProperty(items, 1_000_000, {
      get: () => {
        throw new Error("read the last item");
      },
      enumerable: true,
      configurable: true,
    });
    // Frozen first, so the selection constructor's deepFreeze skips it.
    Object.freeze(items);
    expect(() =>
      cad.chamfer("long-list", base, {
        edges: selection({
          op: "origin",
          feature: "base",
          relation: "created",
          source: { kind: "sketch-entity", items },
        }),
        distance: mm(1),
      }),
    ).toThrow(/authoring limit of 1000000 structural values/);
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
      ["sketch tolerance string", (cad) => profile(cad, { tolerance: "0.1" as never }), TypeError],
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

  it("rejects sparse point, segment, and edge lists while authoring", () => {
    const point = (x: number) => vec3(mm(x), mm(0), mm(0));
    const sparse = <T,>(length: number, items: Readonly<Record<number, T>>): T[] =>
      Object.assign(new Array<T>(length), items);

    const paths = design("sparse-paths");
    expect(() =>
      paths.polylinePath("missing-point", sparse(3, { 0: point(0), 2: point(2) })),
    ).toThrow("Polyline path 'missing-point' points cannot be sparse");
    expect(() =>
      paths.compositePath("missing-segment", {
        start: point(0),
        segments: sparse(3, {
          0: { kind: "line", end: point(1) },
          2: { kind: "circularArc", through: point(2), end: point(3) },
        }),
      }),
    ).toThrow("Composite path 'missing-segment' segments cannot be sparse");
    expect(() =>
      paths.compositePath("unknown-segment", {
        start: point(0),
        segments: [
          { kind: "spline", end: point(1) } as never,
          { kind: "circularArc", through: point(2), end: point(3) },
        ],
      }),
    ).toThrow("segment 0 must be a line or circularArc segment");
    // Nothing was stored, so the document still serializes.
    expect(() => stringifyDocument(paths.build())).not.toThrow();

    const sketches = design("sparse-sketch");
    expect(() =>
      sketches.sketch("missing-position", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.polyline(
            "outline",
            sparse(4, {
              0: vec2(mm(0), mm(0)),
              1: vec2(mm(1), mm(0)),
              3: vec2(mm(0), mm(1)),
            }),
            { closed: true },
          ) as LoopRef,
        ),
      ),
    ).toThrow("Sketch polyline 'outline' points cannot be sparse");
    expect(() =>
      sketches.sketch("missing-edge", plane.xy(), (sketch) => {
        const lines = sketch.polyline("open", [
          vec2(mm(0), mm(0)),
          vec2(mm(1), mm(0)),
          vec2(mm(0), mm(1)),
        ]) as readonly ReturnType<SketchBuilder["line"]>[];
        return sketch.profile(
          sketch.loop(sparse(3, { 0: lines[0]!, 2: lines[1]! })),
        );
      }),
    ).toThrow("Sketch loop edges cannot be sparse");
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

  it("counts every occurrence of shared metadata at its own depth", () => {
    // Thirty layers that each alias one record twice hold 31 distinct
    // records, but the writer and parser see more than a billion values.
    let layered: unknown = { leaf: 1 };
    for (let layer = 0; layer < 30; layer += 1) {
      layered = { left: layered, right: layered };
    }
    expect(() => design("layered", { metadata: layered as never })).toThrow(
      /authoring limit of 1000000 structural values/,
    );
    const cad = design("layered-part");
    const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
    expect(() =>
      cad.part("part", box, { metadata: { layered } as never }),
    ).toThrow(RangeError);

    // A chain first copied near the root counts its whole height again where
    // it recurs deeper.
    let chain: unknown = 1;
    for (let level = 0; level < 100; level += 1) chain = [chain];
    let deeper: unknown = chain;
    for (let level = 0; level < 40; level += 1) deeper = { nested: deeper };
    expect(() => design("chain", { metadata: { chain } as never })).not.toThrow();
    expect(() =>
      design("deep-alias", { metadata: { chain, deeper } as never }),
    ).toThrow(/authoring nesting depth of 128/);
  });

  it("copies metadata through own data properties without running accessors", () => {
    let reads = 0;
    const accessorRecord = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        reads += 1;
        return 1;
      },
    });
    const accessorItem = Object.defineProperty([0], "0", {
      enumerable: true,
      get: () => {
        reads += 1;
        return 1;
      },
    });
    for (const metadata of [
      accessorRecord,
      { nested: accessorRecord },
      { list: accessorItem },
    ]) {
      expect(() => design("accessor", { metadata: metadata as never })).toThrow(
        "must be a data property, not an accessor",
      );
    }
    expect(reads).toBe(0);

    const inherited = Object.assign(Object.create({ hidden: 1 }) as object, {
      shown: 2,
    });
    expect(() => design("inherited", { metadata: inherited as never })).toThrow(
      "must contain only plain JSON objects and arrays",
    );
  });

  it("accepts plain metadata records and arrays from another realm", () => {
    const foreign = runInNewContext(
      '({ owner: "ops", tags: ["a", "b"], nested: { count: 2 } })',
    ) as Readonly<Record<string, unknown>>;
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);
    const local = { owner: "ops", tags: ["a", "b"], nested: { count: 2 } };
    const fromForeign = design("realm", { metadata: foreign as never }).build();
    const fromLocal = design("realm", { metadata: local }).build();
    expect(Object.getPrototypeOf(fromForeign.metadata)).toBe(Object.prototype);
    expect(stringifyDocument(fromForeign)).toBe(stringifyDocument(fromLocal));
    expect(() =>
      design("realm", {
        metadata: { value: runInNewContext("new Map()") } as never,
      }),
    ).toThrow("must contain only plain JSON objects and arrays");
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

describe("builder own-data reads", () => {
  /** An enumerable accessor that counts its reads and returns `value`. */
  function countingAccessor(value: unknown, counter: { reads: number }) {
    return {
      enumerable: true,
      configurable: true,
      get: () => {
        counter.reads += 1;
        return value;
      },
    };
  }

  it("reads transform operations and plane IR without running accessors", () => {
    const cad = design("own-data-transforms");
    const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
    const part = cad.part("part", box);
    const translation = tf.translate(vec3(mm(1), mm(0), mm(0)));
    const counter = { reads: 0 };
    const accessorKind = Object.defineProperties(
      {},
      {
        kind: countingAccessor("translate", counter),
        value: { value: (translation as { readonly value: unknown }).value, enumerable: true },
      },
    );
    expect(() => cad.transform("t1", box, [accessorKind as never])).toThrow(
      "must be a data property, not an accessor",
    );
    expect(() =>
      cad.assembly("a1", (assembly) =>
        assembly.instance("i", part, { placement: [accessorKind as never] }),
      ),
    ).toThrow("must be a data property, not an accessor");
    const accessorItem = Object.defineProperty(
      [translation],
      0,
      countingAccessor(translation, counter),
    );
    expect(() => cad.transform("t2", box, accessorItem)).toThrow(
      "must be a data property, not an accessor",
    );
    // Inherited fields never supply an operation.
    const inherited = Object.create(translation) as typeof translation;
    expect(() => cad.transform("t3", box, [inherited])).toThrow(
      "must be a plain record",
    );

    const origin = plane.xy().ir.origin;
    const accessorPlane = Object.defineProperty({}, "ir", countingAccessor(plane.xy().ir, counter));
    const accessorOrigin = {
      ir: Object.defineProperties(
        {},
        {
          type: { value: "principal", enumerable: true },
          plane: { value: "XY", enumerable: true },
          origin: countingAccessor(origin, counter),
        },
      ),
    };
    for (const sketchPlane of [accessorPlane, accessorOrigin]) {
      expect(() =>
        cad.sketch("s", sketchPlane as never, (sketch) =>
          sketch.profile(sketch.circle("disk", { radius: mm(1) }).loop()),
        ),
      ).toThrow(TypeError);
    }
    expect(counter.reads).toBe(0);
    expect(validateDocument(cad.build()).ok).toBe(true);
  });

  it("reads path points, segments, and solid lists once without accessors", () => {
    const cad = design("own-data-paths");
    const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
    const sphere = cad.sphere("sphere", { radius: mm(2) });
    const counter = { reads: 0 };
    const start = vec3(mm(0), mm(0), mm(0));
    const end = vec3(mm(10), mm(0), mm(0));
    const points = Object.defineProperty([start, end], 1, countingAccessor(end, counter));
    expect(() => cad.polylinePath("polyline", points)).toThrow(
      "must be a data property, not an accessor",
    );
    const arc = {
      kind: "circularArc" as const,
      through: vec3(mm(5), mm(5), mm(0)),
      end,
    };
    const accessorSegment = Object.defineProperties(
      {},
      {
        kind: countingAccessor("line", counter),
        end: { value: vec3(mm(20), mm(0), mm(0)), enumerable: true },
      },
    );
    expect(() =>
      cad.compositePath("composite", {
        start,
        segments: [arc, accessorSegment as never],
      }),
    ).toThrow("must be a data property, not an accessor");
    expect(() =>
      cad.union("union", box, Object.defineProperty([sphere], 0, countingAccessor(sphere, counter))),
    ).toThrow("must be a data property, not an accessor");
    const profile = cad.sketch("profile", plane.xy(), (sketch) =>
      sketch.profile(sketch.circle("disk", { radius: mm(1) }).loop()),
    );
    const top = cad.sketch("top", plane.xy(vec3(mm(0), mm(0), mm(5))), (sketch) =>
      sketch.profile(sketch.circle("disk", { radius: mm(1) }).loop()),
    );
    expect(() =>
      cad.loft(
        "loft",
        Object.defineProperty([profile, top], 1, countingAccessor(top, counter)),
      ),
    ).toThrow("must be a data property, not an accessor");
    expect(counter.reads).toBe(0);

    const segment = cad.compositePath("valid", {
      start,
      segments: [arc, { kind: "line", end: vec3(mm(20), mm(0), mm(0)) }],
    });
    cad.output("result", cad.union("joined", box, [sphere]));
    const document = cad.build();
    expect((document.nodes as Readonly<Record<string, any>>)[segment.node].segments).toEqual([
      { kind: "circularArc", through: arc.through.map((value) => value.ir), end: end.map((value) => value.ir) },
      { kind: "line", end: vec3(mm(20), mm(0), mm(0)).map((value) => value.ir) },
    ]);
    expect(validateDocument(document).ok).toBe(true);
  });

  it("stores the topology selection IR it checked", () => {
    const cad = design("own-data-selection");
    const width = cad.parameter.length("width", mm(1));
    const base = cad.box("base", { size: vec3(mm(10), mm(10), mm(10)) });
    const other = design("other");
    const foreignWidth = other.parameter.length("width", mm(1));
    const own = topology.edges.radius(width).atLeast(1);
    const foreign = topology.edges.radius(foreignWidth).atLeast(1);
    const Selection = own.constructor as new (
      ...args: readonly unknown[]
    ) => typeof own;

    // An overridden toIR() cannot substitute IR that was never checked.
    class Substituting extends Selection {
      override toIR() {
        return foreign.ir;
      }
    }
    const substituting = new Substituting("edge", own.ir.query, own.ir.cardinality);
    const filleted = cad.fillet("fillet", base, { edges: substituting, radius: mm(1) });

    const counter = { reads: 0 };
    const forged = (ir: PropertyDescriptor) =>
      Object.create(Selection.prototype, {
        topology: { value: "edge" },
        references: { value: [] },
        persistentReferences: { value: [] },
        ir,
      }) as typeof own;
    expect(() =>
      cad.fillet("accessor", base, {
        edges: forged(countingAccessor(own.ir, counter)),
        radius: mm(1),
      }),
    ).toThrow("must contain only data properties");
    expect(counter.reads).toBe(0);
    expect(() =>
      cad.chamfer("mismatch", base, {
        edges: forged({ value: { ...own.ir, topology: "face" }, enumerable: true }),
        distance: mm(1),
      }),
    ).toThrow("must select edge topology");
    // The selection's kind and handle lists are own data too.
    const forgedFields = (fields: PropertyDescriptorMap) =>
      Object.create(Selection.prototype, {
        topology: { value: "edge" },
        references: { value: [] },
        persistentReferences: { value: [] },
        ir: { value: own.ir },
        ...fields,
      }) as typeof own;
    for (const fields of [
      { topology: countingAccessor("edge", counter) },
      { references: countingAccessor([], counter) },
      { persistentReferences: countingAccessor([], counter) },
      { references: { value: Object.defineProperty([base], 0, countingAccessor(base, counter)) } },
    ]) {
      expect(() =>
        cad.fillet("forged-fields", base, { edges: forgedFields(fields), radius: mm(1) }),
      ).toThrow(TypeError);
    }
    expect(counter.reads).toBe(0);

    // Unchecked query fields cannot hide behind a frozen record.
    const curve = Object.freeze(
      Object.defineProperty({ op: "curve" }, "kind", countingAccessor("line", counter)),
    );
    expect(() =>
      cad.fillet("frozen-getter", base, {
        edges: new Selection("edge", curve, own.ir.cardinality),
        radius: mm(1),
      }),
    ).toThrow("must be a data property, not an accessor");
    expect(counter.reads).toBe(0);

    // The node stores a builder-owned copy, so caller records nested inside
    // a frozen query cannot change the built document later.
    const source = { kind: "sketch-entity", sketch: "profile", entity: "disk" };
    const origin = Object.freeze({
      op: "origin",
      feature: "base",
      relation: "created",
      source,
    });
    const aliased = cad.chamfer("aliased", base, {
      edges: new Selection("edge", origin, own.ir.cardinality),
      distance: mm(1),
    });

    cad.output("result", filleted);
    cad.output("aliased", aliased);
    const document = cad.build();
    const nodes = document.nodes as Readonly<Record<string, any>>;
    const stored = nodes.fillet.edges;
    expect(stored).toEqual(own.ir);
    expect(stored).not.toBe(substituting.ir);
    // Expression IR keeps its identity: the stored radius is this design's
    // own parameter node, not the foreign one toIR() returned.
    expect(stored.query.value).toBe(width.ir);
    expect(stored.query.value).not.toBe(foreignWidth.ir);
    const before = stringifyDocument(document);
    source.entity = "mutated";
    expect(nodes.aliased.edges.query.source).toEqual({
      kind: "sketch-entity",
      sketch: "profile",
      entity: "disk",
    });
    expect(Object.isFrozen(nodes.aliased.edges.query.source)).toBe(true);
    expect(stringifyDocument(document)).toBe(before);
  });

  it("reads expression dimensions without running accessors", () => {
    const cad = design("own-data-dimensions");
    const width = cad.parameter.length("width", mm(1));
    const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
    const counter = { reads: 0 };
    const accessorDimension = (expression: { readonly ir: ExpressionIR }, dimension: string) =>
      Object.defineProperty({ ir: expression.ir }, "dimension", countingAccessor(dimension, counter)) as never;
    expect(() => cad.parameter.length("p", accessorDimension(mm(1), "length"))).toThrow(
      "must have dimension length",
    );
    expect(() =>
      cad.configuration("variant", (configuration) =>
        configuration.parameter(width, accessorDimension(mm(2), "length")),
      ),
    ).toThrow("must have dimension length");
    const density = gramsPerCubicCentimeter(1);
    expect(() =>
      cad.material("m", { name: "M", massDensity: accessorDimension(density, "massDensity") }),
    ).toThrow("must be a mass-density expression");
    expect(() =>
      cad.part("p", box, { massDensity: accessorDimension(density, "massDensity") }),
    ).toThrow("must be a mass-density expression");
    expect(counter.reads).toBe(0);
  });

  it("stores only the sketch records and profile holes it checked", () => {
    const cad = design("own-data-sketch");
    const counter = { reads: 0 };
    expect(() =>
      cad.sketch("accessor-entity", plane.xy(), (sketch) => {
        sketch.circle("disk", { radius: mm(2) });
        const record = sketch.entities["disk" as never];
        Object.defineProperty(sketch.entities, "disk", countingAccessor(record, counter));
        return sketch.profile(sketch.circle("outer", { radius: mm(3) }).loop());
      }),
    ).toThrow(/SketchBuilder method/);
    expect(() =>
      cad.sketch("accessor-edge", plane.xy(), (sketch) => {
        const a = sketch.point("a", vec2(mm(0), mm(0)));
        const b = sketch.point("b", vec2(mm(1), mm(0)));
        sketch.line("ab", a, b);
        const use = Object.defineProperty({}, "entity", countingAccessor("ab", counter));
        return sketch.profile(sketch.loop([use as never]));
      }),
    ).toThrow("must be a data property, not an accessor");
    expect(() =>
      cad.sketch("object-edge", plane.xy(), (sketch) => {
        const a = sketch.point("a", vec2(mm(0), mm(0)));
        const b = sketch.point("b", vec2(mm(1), mm(0)));
        sketch.line("ab", a, b);
        const entity = {
          toString: () => {
            counter.reads += 1;
            return "ab";
          },
        };
        return sketch.profile(sketch.loop([{ entity } as never]));
      }),
    ).toThrow("Loop edge 0 entity must be a string ID");
    expect(counter.reads).toBe(0);

    // A getter that could change the holes after the ownership check never runs.
    expect(() =>
      cad.sketch("accessor-holes", plane.xy(), (sketch) => {
        const hole = sketch.circle("hole", { radius: mm(1) }).loop();
        const options = Object.defineProperty({}, "holes", countingAccessor([hole], counter));
        return sketch.profile(sketch.circle("outer", { radius: mm(3) }).loop(), options);
      }),
    ).toThrow("must be a data property, not an accessor");
    expect(counter.reads).toBe(0);
    const profile = cad.sketch("holes", plane.xy(), (sketch) => {
      const hole = sketch.circle("hole", { radius: mm(1) }).loop();
      return sketch.profile(sketch.circle("outer", { radius: mm(3) }).loop(), {
        holes: [hole],
      });
    });
    const document = cad.build();
    expect((document.nodes as Readonly<Record<string, any>>)[profile.node].profile.holes).toEqual([
      { kind: "circle", entity: "hole" },
    ]);
    expect(validateDocument(document).ok).toBe(true);
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

  it("reads part and material options only through own data properties", () => {
    const { cad, housing, steel } = setup();
    let reads = 0;
    const accessor = (value: unknown) => ({
      enumerable: true,
      get: () => {
        reads += 1;
        return value;
      },
    });
    const accessorPart = Object.defineProperties(
      { partNumber: "HSG-1" },
      { materialRef: accessor(steel) },
    );
    expect(() => cad.part("part", housing, accessorPart as never)).toThrow(
      "must be a data property, not an accessor",
    );
    const accessorMaterial = Object.defineProperties(
      { name: "Brass" },
      { massDensity: accessor(gramsPerCubicCentimeter(8.5)) },
    );
    expect(() => cad.material("brass", accessorMaterial as never)).toThrow(
      "must be a data property, not an accessor",
    );
    expect(reads).toBe(0);

    // Inherited fields never supply an option.
    const inheritedPart = Object.create({ materialRef: steel }) as object;
    expect(() => cad.part("inherited", housing, inheritedPart as never)).toThrow(
      "must be a plain record",
    );
    const inheritedMaterial = Object.assign(
      Object.create({ massDensity: gramsPerCubicCentimeter(8.5) }) as object,
      { name: "Brass" },
    );
    expect(() => cad.material("inherited", inheritedMaterial as never)).toThrow(
      "must be a plain record",
    );
    const document = cad.build();
    expect(document.nodes).not.toHaveProperty("part");
    expect(document.materials).not.toHaveProperty("brass");
  });

  it("reads every builder option record only through own data properties", () => {
    const cad = design("option-records");
    const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
    const profile = cad.sketch("profile", plane.xy(), (sketch) =>
      sketch.profile(sketch.circle("disk", { radius: mm(1) }).loop()),
    );
    let reads = 0;
    const withAccessor = (
      fields: Record<string, unknown>,
      key: string,
      value: unknown,
    ) =>
      Object.defineProperty({ ...fields }, key, {
        enumerable: true,
        get: () => {
          reads += 1;
          return value;
        },
      }) as never;
    const size = vec3(mm(1), mm(1), mm(1));
    const calls: readonly (readonly [string, () => unknown])[] = [
      ["design", () => design("d", withAccessor({}, "metadata", { a: 1 }))],
      ["parameter", () => cad.parameter.length("p", mm(1), withAccessor({}, "min", mm(0)))],
      ["box", () => cad.box("b", withAccessor({ size }, "center", true))],
      ["cylinder", () => cad.cylinder("c", withAccessor({ height: mm(1) }, "radius", mm(1)))],
      ["sphere", () => cad.sphere("s", withAccessor({}, "radius", mm(1)))],
      [
        "sketch",
        () =>
          cad.sketch(
            "k",
            plane.xy(),
            (sketch) => sketch.profile(sketch.circle("disk", { radius: mm(1) }).loop()),
            withAccessor({}, "tolerance", 1e-6),
          ),
      ],
      [
        "polylinePath",
        () => cad.polylinePath("l", [size, vec3(mm(2), mm(1), mm(1))], withAccessor({}, "tolerance", 1e-6)),
      ],
      [
        "circularArcPath",
        () =>
          cad.circularArcPath(
            "a",
            withAccessor({ start: size, through: vec3(mm(2), mm(2), mm(1)) }, "end", vec3(mm(3), mm(1), mm(1))),
          ),
      ],
      ["extrude", () => cad.extrude("e", profile, withAccessor({}, "distance", mm(1)))],
      ["revolve", () => cad.revolve("r", profile, withAccessor({}, "angle", deg(90)))],
      ["offset", () => cad.offset("o", box, withAccessor({}, "distance", mm(1)))],
      [
        "fillet",
        () =>
          cad.fillet("f", box, withAccessor({ radius: mm(1) }, "edges", topology.edges.createdBy(box).atLeast(1))),
      ],
      [
        "draft neutralPlane",
        () =>
          cad.draft("dr", box, {
            faces: topology.faces.createdBy(box).select(),
            angle: deg(1),
            pullDirection: scalarVec3(0, 0, 1),
            neutralPlane: withAccessor({ origin: size }, "normal", scalarVec3(0, 0, 1)),
          }),
      ],
      [
        "assembly instance",
        () => {
          const part = cad.part("instanced", box);
          return cad.assembly("assembly", (assembly) =>
            assembly.instance("i", part, withAccessor({}, "suppressed", false)),
          );
        },
      ],
      [
        "configuration",
        () =>
          cad.configuration(
            "variant",
            (configuration) => configuration.parameter(cad.parameter.length("w", mm(1)), mm(2)),
            withAccessor({}, "description", "Variant"),
          ),
      ],
      [
        "sketch circle",
        () =>
          cad.sketch("sc", plane.xy(), (sketch) =>
            sketch.profile(sketch.circle("disk", withAccessor({}, "radius", mm(1))).loop()),
          ),
      ],
      [
        "sketch rectangle",
        () =>
          cad.sketch("sr", plane.xy(), (sketch) =>
            sketch.profile(sketch.rectangle("r", withAccessor({ width: mm(1) }, "height", mm(1)))),
          ),
      ],
      [
        "sketch center pair",
        () =>
          cad.sketch("sp", plane.xy(), (sketch) =>
            sketch.profile(
              sketch.regularPolygon("g", 5, mm(1), {
                center: Object.defineProperty([mm(0), mm(0)], 1, {
                  enumerable: true,
                  get: () => {
                    reads += 1;
                    return mm(0);
                  },
                }) as never,
              }),
            ),
          ),
      ],
      [
        "circle loop",
        () =>
          cad.sketch("sl", plane.xy(), (sketch) =>
            sketch.profile(sketch.circle("disk", { radius: mm(1) }).loop(withAccessor({}, "reversed", true))),
          ),
      ],
    ];
    for (const [label, call] of calls) {
      expect(call, label).toThrow("must be a data property, not an accessor");
    }
    expect(reads).toBe(0);
    expect(validateDocument(cad.build()).ok).toBe(true);
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

  it("reads callback builder records without running accessors", () => {
    const { cad, part } = setup();
    let reads = 0;
    const accessor = (value: unknown) => ({
      enumerable: true,
      configurable: true,
      get: () => {
        reads += 1;
        return value;
      },
    });
    expect(() =>
      cad.assembly("accessor-entry", (assembly) => {
        assembly.instance("first", part);
        Object.defineProperty(assembly.instances, 0, accessor(assembly.instances[0]));
      }),
    ).toThrow("must be a data property, not an accessor");
    expect(() =>
      cad.assembly("accessor-field", (assembly) => {
        assembly.instance("first", part);
        Object.defineProperty(assembly, "instances", accessor([...assembly.instances]));
      }),
    ).toThrow(TypeError);
    expect(() =>
      cad.sketch("accessor-records", plane.xy(), (sketch) => {
        const profile = sketch.profile(sketch.circle("disk", { radius: mm(1) }).loop());
        Object.defineProperty(sketch, "entities", accessor({ ...sketch.entities }));
        return profile;
      }),
    ).toThrow(TypeError);
    expect(reads).toBe(0);

    // Configuration records are private to the builder, not public fields.
    const width = cad.parameter.length("width", mm(1));
    cad.configuration("variant", (configuration) => {
      configuration.parameter(width, mm(2));
      Object.assign(configuration, {
        parameterRecords: { depth: mm(9).ir },
        partMaterialRecords: { part: "ghost" },
      });
    });
    expect(cad.build().configurations).toEqual({
      variant: { parameterOverrides: { width: mm(2).ir } },
    });
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

describe("configuration builders", () => {
  it("rejects a nested configuration with the same ID", () => {
    const cad = design("nested-configuration");
    const width = cad.parameter.length("w", mm(10));
    let innerError: unknown;
    cad.configuration("c", (outer) => {
      try {
        cad.configuration("c", (inner) => inner.parameter(width, mm(30)));
      } catch (error) {
        innerError = error;
      }
      outer.parameter(width, mm(20));
    });
    expect(innerError).toBeInstanceOf(TypeError);
    expect((innerError as Error).message).toMatch(/Duplicate configuration 'c'/);
    expect(cad.build().configurations).toEqual({
      c: { parameterOverrides: { w: mm(20).ir } },
    });
    expect(() =>
      cad.configuration("c", (configuration) =>
        configuration.parameter(width, mm(40)),
      ),
    ).toThrow(/Duplicate configuration 'c'/);
  });

  it("closes the builder when its callback returns or throws", () => {
    const cad = design("escaped-configuration");
    const width = cad.parameter.length("w", mm(10));
    const height = cad.parameter.length("h", mm(1));
    const part = cad.part("part", cad.box("box", { size: vec3(width, height, mm(1)) }));
    const steel = cad.material("steel", {
      name: "Steel",
      massDensity: gramsPerCubicCentimeter(7.8),
    });
    const assembly = cad.assembly("assembly", (builder) =>
      builder.instance("first", part),
    );
    let escaped: ConfigurationBuilder | undefined;
    cad.configuration("d", (configuration) => {
      escaped = configuration;
      configuration.parameter(width, mm(40));
    });
    expect(() => escaped!.parameter(height, mm(2))).toThrow(/closed/);
    expect(() => escaped!.instanceSuppressed(assembly, "first")).toThrow(/closed/);
    expect(() =>
      cad.configuration("flag", (configuration) =>
        configuration.instanceSuppressed(assembly, "first", "yes" as never),
      ),
    ).toThrow(/must be a boolean/);
    expect(() => escaped!.partMaterial(part, steel)).toThrow(/closed/);
    expect(cad.build().configurations).toEqual({
      d: { parameterOverrides: { w: mm(40).ir } },
    });

    let failed: ConfigurationBuilder | undefined;
    expect(() =>
      cad.configuration("e", (configuration) => {
        failed = configuration;
        configuration.parameter(width, mm(5));
        throw new Error("callback failed");
      }),
    ).toThrow("callback failed");
    expect(() => failed!.parameter(height, mm(3))).toThrow(/closed/);
    expect(cad.build().configurations).not.toHaveProperty("e");
    expect(
      cad.configuration("e", (configuration) =>
        configuration.parameter(width, mm(6)),
      ),
    ).toBe("e");
  });
});
