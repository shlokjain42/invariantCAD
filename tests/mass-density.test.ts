import { describe, expect, it } from "vitest";
import {
  design,
  evaluateExpression,
  gramsPerCubicCentimeter,
  hashDocument,
  kgPerCubicMeter,
  kgPerCubicMillimeter,
  mm,
  parseDocument,
  parseDocumentValue,
  stringifyDocument,
  vec3,
  type DesignDocument,
  type PartNodeIR,
} from "../src/index.js";

function partNode(document: DesignDocument, id = "part"): PartNodeIR {
  const node = Object.entries(document.nodes).find(
    ([nodeId]) => nodeId === id,
  )?.[1];
  if (node?.kind !== "part") throw new Error(`Expected '${id}' to be a part`);
  return node;
}

function legacyPartDocument(): DesignDocument {
  const cad = design("legacy-density-free");
  const solid = cad.box("solid", {
    size: vec3(mm(2), mm(3), mm(4)),
  });
  const part = cad.part("part", solid, {
    partNumber: "LEGACY-001",
    material: "Unspecified alloy",
  });
  cad.output("part", part);
  return cad.build();
}

describe("authored mass density", () => {
  it("converts supported density units to the kg/mm^3 document base unit", () => {
    const base = kgPerCubicMillimeter(7.85e-6);
    const metric = kgPerCubicMeter(7_850);
    const customaryCad = gramsPerCubicCentimeter(7.85);

    for (const value of [base, metric, customaryCad]) {
      expect(value.dimension).toBe("massDensity");
      expect(value.ir).toMatchObject({
        op: "literal",
        dimension: "massDensity",
      });
      expect(value.ir.op === "literal" ? value.ir.value : NaN).toBeCloseTo(
        7.85e-6,
        18,
      );
    }
  });

  it("serializes a density parameter and part reference with explicit mass units", () => {
    const cad = design("parameterized-density");
    const density = cad.parameter.massDensity(
      "density",
      gramsPerCubicCentimeter(2.7),
      {
        min: gramsPerCubicCentimeter(2),
        max: gramsPerCubicCentimeter(3),
        label: "Material density",
      },
    );
    const solid = cad.box("solid", {
      size: vec3(mm(10), mm(20), mm(30)),
    });
    const part = cad.part("part", solid, {
      partNumber: "AL-001",
      material: "6061-T6 Aluminum",
      massDensity: density,
    });
    cad.output("part", part);

    const document = cad.build();
    expect(document.units).toEqual({ length: "mm", angle: "rad", mass: "kg" });
    const densityParameter = Object.entries(document.parameters).find(
      ([id]) => id === "density",
    )?.[1];
    expect(densityParameter).toMatchObject({
      dimension: "massDensity",
      default: {
        op: "literal",
        dimension: "massDensity",
        value: 2.7e-6,
      },
      min: {
        op: "literal",
        dimension: "massDensity",
        value: 2e-6,
      },
      max: {
        op: "literal",
        dimension: "massDensity",
        value: 3e-6,
      },
    });
    expect(partNode(document).massDensity).toEqual({
      op: "parameter",
      dimension: "massDensity",
      id: "density",
    });
    expect(Object.isFrozen(partNode(document).massDensity)).toBe(true);
  });

  it("round-trips the density contract through schema and semantic validation", () => {
    const cad = design("density-round-trip");
    const solid = cad.box("solid", { size: vec3(mm(1), mm(2), mm(3)) });
    const part = cad.part("part", solid, {
      material: "Steel",
      massDensity: kgPerCubicMeter(7_850),
    });
    cad.output("part", part);
    const source = cad.build();

    const parsed = parseDocument(stringifyDocument(source));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(source);
    expect(parsed.value.units.mass).toBe("kg");
    expect(partNode(parsed.value).massDensity).toEqual(
      kgPerCubicMeter(7_850).ir,
    );
  });

  it("makes authored density semantic while preserving density-free documents", async () => {
    const firstCad = design("density-hash");
    const firstSolid = firstCad.box("solid", {
      size: vec3(mm(2), mm(3), mm(4)),
    });
    firstCad.output(
      "part",
      firstCad.part("part", firstSolid, {
        material: "Alloy",
        massDensity: gramsPerCubicCentimeter(2.7),
      }),
    );

    const secondCad = design("density-hash");
    const secondSolid = secondCad.box("solid", {
      size: vec3(mm(2), mm(3), mm(4)),
    });
    secondCad.output(
      "part",
      secondCad.part("part", secondSolid, {
        material: "Alloy",
        massDensity: gramsPerCubicCentimeter(7.85),
      }),
    );

    expect(await hashDocument(firstCad.build())).not.toBe(
      await hashDocument(secondCad.build()),
    );

    const legacy = legacyPartDocument();
    expect(legacy.units).toEqual({ length: "mm", angle: "rad" });
    expect(partNode(legacy).massDensity).toBeUndefined();
    expect(stringifyDocument(legacy)).not.toContain("massDensity");
    expect(stringifyDocument(legacy)).not.toContain('"mass"');
    const parsed = parseDocument(stringifyDocument(legacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(legacy);
    expect(await hashDocument(parsed.value)).toBe(await hashDocument(legacy));
  });

  it("rejects a non-density part expression in the builder and untrusted JSON", () => {
    const cad = design("wrong-density-dimension");
    const solid = cad.box("solid", { size: vec3(mm(1), mm(1), mm(1)) });

    if (false) {
      // @ts-expect-error A length expression cannot be used as mass density.
      cad.part("compile-time-invalid", solid, { massDensity: mm(1) });
    }
    expect(() =>
      cad.part("runtime-invalid", solid, {
        massDensity: mm(1) as unknown as ReturnType<
          typeof kgPerCubicMillimeter
        >,
      }),
    ).toThrow("Part massDensity must be a mass-density expression");

    const validCad = design("untrusted-wrong-density");
    const validSolid = validCad.box("solid", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    validCad.output(
      "part",
      validCad.part("part", validSolid, {
        massDensity: kgPerCubicMeter(1_000),
      }),
    );
    const untrusted = JSON.parse(stringifyDocument(validCad.build())) as any;
    untrusted.nodes.part.massDensity = mm(1).ir;

    const parsed = parseDocumentValue(untrusted);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "EXPRESSION_DIMENSION_MISMATCH",
        path: "/nodes/part/massDensity",
      }),
    );
  });

  it("requires units.mass whenever a density field or parameter is authored", () => {
    const cad = design("missing-density-unit");
    const density = cad.parameter.massDensity(
      "density",
      kgPerCubicMeter(1_000),
    );
    const solid = cad.box("solid", { size: vec3(mm(1), mm(1), mm(1)) });
    cad.output(
      "part",
      cad.part("part", solid, { massDensity: density }),
    );
    const untrusted = JSON.parse(stringifyDocument(cad.build())) as any;
    delete untrusted.units.mass;

    const parsed = parseDocumentValue(untrusted);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IR_INVALID",
        path: "/units/mass",
      }),
    );
  });

  it("requires mass units even for an otherwise unused density parameter", () => {
    const cad = design("density-parameter-unit");
    cad.parameter.massDensity("density", kgPerCubicMeter(1_000));
    const solid = cad.box("solid", { size: vec3(mm(1), mm(1), mm(1)) });
    cad.output("solid", solid);
    const untrusted = JSON.parse(stringifyDocument(cad.build())) as any;
    delete untrusted.units.mass;

    const parsed = parseDocumentValue(untrusted);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ path: "/units/mass" }),
    );
  });

  it("keeps the part density as override-ready parameter IR", () => {
    const cad = design("override-ready-density");
    const density = cad.parameter.massDensity(
      "density",
      gramsPerCubicCentimeter(1),
    );
    const solid = cad.box("solid", { size: vec3(mm(1), mm(1), mm(1)) });
    cad.output("part", cad.part("part", solid, { massDensity: density }));
    const authored = partNode(cad.build()).massDensity;
    if (authored === undefined) throw new Error("Expected authored mass density");

    const resolved = evaluateExpression(authored, {
      resolveParameter(id, expectedDimension) {
        expect(id).toBe("density");
        expect(expectedDimension).toBe("massDensity");
        return 7.85e-6;
      },
    });
    expect(resolved).toBe(7.85e-6);
  });
});
