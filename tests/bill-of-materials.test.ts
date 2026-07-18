import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvaluatedAssembly,
  EvaluatedPart,
  createEvaluator,
  design,
  kgPerCubicMeter,
  mm,
  scalarVec3,
  tf,
  vec3,
  type BillOfMaterials,
  type CadResult,
  type DesignDocument,
  type EvaluatedDesign,
  type Evaluator,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

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
    throw new Error(
      result.diagnostics
        .map((item) => `${item.code}: ${item.message}`)
        .join("\n"),
    );
  }
  return result.value;
}

function bomValue(result: CadResult<BillOfMaterials>): BillOfMaterials {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected a bill of materials");
  return result.value;
}

function expectClose(actual: number | null, expected: number): void {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(
    Math.max(1e-15, Math.abs(expected) * 2e-10),
  );
}

function densityInDocumentUnits(kgPerMeterCubed: number): number {
  const expression = kgPerCubicMeter(kgPerMeterCubed).ir;
  if (expression.op !== "literal") {
    throw new Error("Expected a literal mass-density expression");
  }
  return expression.value;
}

function nestedBomFixture(): DesignDocument {
  const cad = design("nested-bom-golden");
  const steel = cad.material("steel", {
    name: "Fixture Steel",
    massDensity: kgPerCubicMeter(7_850),
  });
  const aluminum = cad.material("aluminum", {
    name: "Fixture Aluminum",
    massDensity: kgPerCubicMeter(2_700),
  });
  const boltSolid = cad.box("bolt-solid", {
    size: vec3(mm(1), mm(2), mm(3)),
  });
  const bracketSolid = cad.box("bracket-solid", {
    size: vec3(mm(2), mm(2), mm(2)),
  });
  const ghostSolid = cad.box("ghost-solid", {
    size: vec3(mm(5), mm(5), mm(5)),
  });
  const bolt = cad.part("bolt", boltSolid, {
    partNumber: "A-010",
    description: "M3 fixture bolt",
    materialRef: steel,
  });
  const bracket = cad.part("bracket", bracketSolid, {
    partNumber: "B-002",
    description: "Scaled fixture bracket",
    materialRef: aluminum,
    massDensity: kgPerCubicMeter(3_000),
  });
  const suppressedGhost = cad.part("suppressed-ghost", ghostSolid);
  const hardware = cad.assembly("hardware", (instances) => {
    instances.instance("z-bolt", bolt, {
      placement: [tf.translate(vec3(mm(10), mm(0), mm(0)))],
    });
    instances.instance("a-bolt", bolt);
    instances.instance("suppressed-ghost", suppressedGhost, {
      suppressed: true,
    });
  });
  const product = cad.assembly("product", (instances) => {
    instances.instance("bracket-scaled", bracket, {
      placement: [tf.scale(scalarVec3(2, 0.5, 3))],
    });
    instances.instance("hardware", hardware, {
      placement: [tf.translate(vec3(mm(0), mm(20), mm(0)))],
    });
    instances.instance("bracket-plain", bracket);
    instances.instance("bracket-mirrored", bracket, {
      placement: [tf.mirror(scalarVec3(1, 0, 0))],
    });
    instances.instance("suppressed-direct", suppressedGhost, {
      suppressed: true,
    });
  });
  cad.output("product", product);
  return cad.build();
}

describe("evaluated bill of materials", () => {
  it("returns a definition-level BOM for a directly evaluated part", async () => {
    const cad = design("part-bom");
    const material = cad.material("steel", {
      name: "Fixture Steel",
      massDensity: kgPerCubicMeter(1_000),
    });
    const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });
    const part = cad.part("part", solid, {
      partNumber: "P-001",
      description: "Direct part",
      materialRef: material,
    });
    cad.output("part", part);

    const evaluated = await evaluate(cad.build());
    try {
      const output = evaluated.output("part");
      expect(output).toBeInstanceOf(EvaluatedPart);
      if (!(output instanceof EvaluatedPart)) return;
      const result = output.billOfMaterials();
      expect(result.diagnostics).toEqual([]);
      const density = densityInDocumentUnits(1_000);
      const mass = 24 * density;
      expect(bomValue(result)).toEqual({
        units: { mass: "kg" },
        items: [
          {
            partNode: "part",
            partNumber: "P-001",
            description: "Direct part",
            materialId: "steel",
            material: "Fixture Steel",
            quantity: 1,
            occurrenceIds: [],
            massDensity: density,
            massDensitySource: "material",
            definitionMass: mass,
            totalMass: mass,
          },
        ],
        totalQuantity: 1,
        massComplete: true,
        knownMass: mass,
        totalMass: mass,
      });
    } finally {
      evaluated.dispose();
    }
  });

  it("matches the deterministic nested BOM golden and actual affine masses", async () => {
    const evaluated = await evaluate(nestedBomFixture());
    try {
      const output = evaluated.output("product");
      expect(output).toBeInstanceOf(EvaluatedAssembly);
      if (!(output instanceof EvaluatedAssembly)) return;
      const result = output.billOfMaterials();
      expect(result.diagnostics).toEqual([]);

      const steelDensity = densityInDocumentUnits(7_850);
      const bracketDensity = densityInDocumentUnits(3_000);
      const boltDefinitionMass = 6 * steelDensity;
      const boltTotalMass = 2 * boltDefinitionMass;
      const bracketDefinitionMass = 8 * bracketDensity;
      // Two unit-determinant occurrences plus one placement with determinant 3.
      const bracketTotalMass = 5 * bracketDefinitionMass;
      const totalMass = boltTotalMass + bracketTotalMass;
      expect(bomValue(result)).toEqual({
        units: { mass: "kg" },
        items: [
          {
            partNode: "bolt",
            partNumber: "A-010",
            description: "M3 fixture bolt",
            materialId: "steel",
            material: "Fixture Steel",
            quantity: 2,
            occurrenceIds: ["hardware/a-bolt", "hardware/z-bolt"],
            massDensity: steelDensity,
            massDensitySource: "material",
            definitionMass: boltDefinitionMass,
            totalMass: boltTotalMass,
          },
          {
            partNode: "bracket",
            partNumber: "B-002",
            description: "Scaled fixture bracket",
            materialId: "aluminum",
            material: "Fixture Aluminum",
            quantity: 3,
            occurrenceIds: [
              "bracket-mirrored",
              "bracket-plain",
              "bracket-scaled",
            ],
            massDensity: bracketDensity,
            massDensitySource: "part",
            definitionMass: bracketDefinitionMass,
            totalMass: bracketTotalMass,
          },
        ],
        totalQuantity: 5,
        massComplete: true,
        knownMass: totalMass,
        totalMass,
      });

      expectClose(result.ok ? result.value.items[1]!.totalMass : null, 120e-6);
      expect(output.instances.map((instance) => instance.id)).not.toContain(
        "suppressed-direct",
      );
      expect(output.instances.map((instance) => instance.id)).not.toContain(
        "hardware/suppressed-ghost",
      );
    } finally {
      evaluated.dispose();
    }
  });

  it("groups by part definition, sorts deterministically, and warns on duplicate numbers", async () => {
    const cad = design("duplicate-part-numbers");
    const solid = cad.box("solid", { size: vec3(mm(1), mm(1), mm(1)) });
    const zPart = cad.part("z-part", solid, {
      partNumber: "DUP-001",
      material: "Fixture",
      massDensity: kgPerCubicMeter(1_000),
    });
    const aPart = cad.part("a-part", solid, {
      partNumber: "DUP-001",
      material: "Fixture",
      massDensity: kgPerCubicMeter(2_000),
    });
    const assembly = cad.assembly("assembly", (instances) => {
      instances.instance("z", zPart);
      instances.instance("a-second", aPart);
      instances.instance("a-first", aPart);
    });
    cad.output("assembly", assembly);

    const evaluated = await evaluate(cad.build());
    try {
      const output = evaluated.output("assembly");
      expect(output).toBeInstanceOf(EvaluatedAssembly);
      if (!(output instanceof EvaluatedAssembly)) return;
      const result = output.billOfMaterials();
      const bom = bomValue(result);

      expect(bom.items.map((item) => item.partNode)).toEqual([
        "a-part",
        "z-part",
      ]);
      expect(bom.items.map((item) => item.quantity)).toEqual([2, 1]);
      expect(bom.items[0]?.occurrenceIds).toEqual(["a-first", "a-second"]);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "BOM_PART_NUMBER_DUPLICATE",
          severity: "warning",
          path: "/outputs/assembly",
          details: {
            partNumber: "DUP-001",
            partNodes: ["a-part", "z-part"],
          },
        }),
      ]);
    } finally {
      evaluated.dispose();
    }
  });

  it("returns partial mass with warnings when authored metadata or density is missing", async () => {
    const cad = design("partial-bom");
    const material = cad.material("dense", {
      name: "Known Material",
      massDensity: kgPerCubicMeter(1_000),
    });
    const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });
    const complete = cad.part("complete", solid, {
      partNumber: "A-001",
      materialRef: material,
    });
    const missing = cad.part("missing", solid);
    const suppressed = cad.part("suppressed", solid);
    const assembly = cad.assembly("assembly", (instances) => {
      instances.instance("missing", missing);
      instances.instance("complete", complete);
      instances.instance("suppressed", suppressed, { suppressed: true });
    });
    cad.output("assembly", assembly);

    const evaluated = await evaluate(cad.build());
    try {
      const output = evaluated.output("assembly");
      expect(output).toBeInstanceOf(EvaluatedAssembly);
      if (!(output instanceof EvaluatedAssembly)) return;
      const result = output.billOfMaterials();
      const bom = bomValue(result);

      expect(bom.items.map((item) => item.partNode)).toEqual([
        "complete",
        "missing",
      ]);
      expect(bom.items[1]).toEqual({
        partNode: "missing",
        partNumber: null,
        description: null,
        materialId: null,
        material: null,
        quantity: 1,
        occurrenceIds: ["missing"],
        massDensity: null,
        massDensitySource: null,
        definitionMass: null,
        totalMass: null,
      });
      expect(bom.totalQuantity).toBe(2);
      expect(bom.massComplete).toBe(false);
      expectClose(bom.knownMass, 24e-6);
      expect(bom.totalMass).toBeNull();

      expect(result.diagnostics).toHaveLength(3);
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "BOM_PART_NUMBER_MISSING",
            severity: "warning",
            node: "missing",
            path: "/nodes/missing/partNumber",
          }),
          expect.objectContaining({
            code: "BOM_MATERIAL_MISSING",
            severity: "warning",
            node: "missing",
            path: "/nodes/missing/material",
          }),
          expect.objectContaining({
            code: "MASS_DENSITY_MISSING",
            severity: "warning",
            node: "missing",
            path: "/nodes/missing/massDensity",
          }),
        ]),
      );
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.node === "suppressed"),
      ).toBe(false);
    } finally {
      evaluated.dispose();
    }
  });

  it("preserves legacy material labels without treating them as registry IDs", async () => {
    const cad = design("legacy-material-bom");
    const solid = cad.box("solid", { size: vec3(mm(1), mm(2), mm(3)) });
    const part = cad.part("part", solid, {
      partNumber: "LEGACY-001",
      material: "Shop-specified alloy",
      massDensity: kgPerCubicMeter(2_000),
    });
    cad.output("part", part);

    const evaluated = await evaluate(cad.build());
    try {
      const output = evaluated.output("part");
      expect(output).toBeInstanceOf(EvaluatedPart);
      if (!(output instanceof EvaluatedPart)) return;
      const result = output.billOfMaterials();
      expect(result.diagnostics).toEqual([]);
      const item = bomValue(result).items[0];
      expect(item).toMatchObject({
        materialId: null,
        material: "Shop-specified alloy",
        massDensitySource: "part",
      });
      expectClose(item?.massDensity ?? null, 2e-6);
    } finally {
      evaluated.dispose();
    }
  });

  it("returns a canonical complete zero BOM for an empty assembly", async () => {
    const cad = design("empty-bom");
    cad.output("assembly", cad.assembly("assembly", () => {}));
    const evaluated = await evaluate(cad.build());
    try {
      const output = evaluated.output("assembly");
      expect(output).toBeInstanceOf(EvaluatedAssembly);
      if (!(output instanceof EvaluatedAssembly)) return;
      const result = output.billOfMaterials();
      expect(result.diagnostics).toEqual([]);
      expect(bomValue(result)).toEqual({
        units: { mass: "kg" },
        items: [],
        totalQuantity: 0,
        massComplete: true,
        knownMass: 0,
        totalMass: 0,
      });
    } finally {
      evaluated.dispose();
    }
  });

  it("uses the same primitive BOM contract across both built-in kernels", async () => {
    const cad = design("cross-kernel-bom");
    const material = cad.material("fixture", {
      name: "Fixture Material",
      massDensity: kgPerCubicMeter(2_500),
    });
    const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });
    cad.output(
      "part",
      cad.part("part", solid, {
        partNumber: "CROSS-001",
        materialRef: material,
      }),
    );
    const document = cad.build();
    const meshEvaluated = await evaluate(document);
    const exactEvaluator = await createEvaluator({
      kernel: await createOcctKernel(),
    });
    const exactResult = await exactEvaluator.evaluate(document);
    expect(exactResult.ok, JSON.stringify(exactResult.diagnostics)).toBe(true);
    if (!exactResult.ok) {
      meshEvaluated.dispose();
      exactEvaluator.dispose();
      return;
    }
    try {
      const meshPart = meshEvaluated.output("part");
      const exactPart = exactResult.value.output("part");
      expect(meshPart).toBeInstanceOf(EvaluatedPart);
      expect(exactPart).toBeInstanceOf(EvaluatedPart);
      if (!(meshPart instanceof EvaluatedPart) || !(exactPart instanceof EvaluatedPart)) {
        return;
      }
      const meshBom = bomValue(meshPart.billOfMaterials());
      const exactBom = bomValue(exactPart.billOfMaterials());
      expect(meshBom.items[0]?.quantity).toBe(1);
      expect(exactBom.items[0]?.quantity).toBe(1);
      expectClose(meshBom.totalMass, 60e-6);
      expectClose(exactBom.totalMass, 60e-6);
      expectClose(
        exactBom.totalMass,
        meshBom.totalMass ?? Number.NaN,
      );
    } finally {
      meshEvaluated.dispose();
      exactResult.value.dispose();
      exactEvaluator.dispose();
    }
  }, 15_000);

  it("is deterministic across calls and enforces evaluation lifecycle", async () => {
    const evaluated = await evaluate(nestedBomFixture());
    const output = evaluated.output("product");
    expect(output).toBeInstanceOf(EvaluatedAssembly);
    if (!(output instanceof EvaluatedAssembly)) {
      evaluated.dispose();
      return;
    }

    const first = output.billOfMaterials();
    const second = output.billOfMaterials();
    expect(second).toEqual(first);
    expect(first.ok).toBe(true);

    evaluated.dispose();
    expect(() => output.billOfMaterials()).toThrowError(/disposed/i);
    expect(() => evaluated.output("product")).toThrowError(/disposed/i);
  });
});
