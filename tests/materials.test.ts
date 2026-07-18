import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvaluatedPart,
  MaterialRef,
  createEvaluator,
  design,
  hashDocument,
  kgPerCubicMeter,
  mm,
  parseDocument,
  parseDocumentValue,
  stringifyDocument,
  vec3,
  type DesignDocument,
  type EvaluatedDesign,
  type Evaluator,
  type PartNodeIR,
} from "../src/index.js";

let evaluator: Evaluator;

beforeAll(async () => {
  evaluator = await createEvaluator();
});

afterAll(() => {
  evaluator.dispose();
});

function partNode(document: DesignDocument, id = "part"): PartNodeIR {
  const node = Object.entries(document.nodes).find(
    ([nodeId]) => nodeId === id,
  )?.[1];
  if (node?.kind !== "part") throw new Error(`Expected '${id}' to be a part`);
  return node;
}

async function evaluate(
  document: DesignDocument,
  parameters: Readonly<Record<string, number>> = {},
): Promise<EvaluatedDesign> {
  const result = await evaluator.evaluate(document, { parameters });
  if (!result.ok) {
    throw new Error(
      result.diagnostics
        .map((item) => `${item.code}: ${item.message}`)
        .join("\n"),
    );
  }
  return result.value;
}

function materialDocument(reverse: boolean): DesignDocument {
  const cad = design("material-canonical-order");
  let aluminum;
  let steel;
  if (reverse) {
    steel = cad.material("steel", {
      name: "Steel",
      massDensity: kgPerCubicMeter(7_850),
    });
    aluminum = cad.material("aluminum", {
      name: "6061-T6 Aluminum",
      massDensity: kgPerCubicMeter(2_700),
    });
  } else {
    aluminum = cad.material("aluminum", {
      name: "6061-T6 Aluminum",
      massDensity: kgPerCubicMeter(2_700),
    });
    steel = cad.material("steel", {
      name: "Steel",
      massDensity: kgPerCubicMeter(7_850),
    });
  }
  const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });
  cad
    .output(
      "aluminum-part",
      cad.part("aluminum-part", solid, { materialRef: aluminum }),
    )
    .output("steel-part", cad.part("steel-part", solid, { materialRef: steel }));
  return cad.build();
}

describe("document-owned materials", () => {
  it("authors an explicit material registry and immutable design-owned reference", () => {
    const cad = design("material-registry");
    const density = cad.parameter.massDensity(
      "aluminum-density",
      kgPerCubicMeter(2_700),
    );
    const aluminum = cad.material("aluminum-6061", {
      name: "6061-T6 Aluminum",
      description: "Heat-treated wrought aluminum alloy",
      massDensity: density,
      metadata: { standard: "ASTM B221", recyclable: true },
    });
    expect(aluminum).toBeInstanceOf(MaterialRef);
    expect(aluminum.id).toBe("aluminum-6061");
    expect(Object.isFrozen(aluminum)).toBe(true);

    const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });
    cad.output(
      "part",
      cad.part("part", solid, {
        partNumber: "AL-001",
        materialRef: aluminum,
      }),
    );
    const document = cad.build();

    expect(document.units).toEqual({ length: "mm", angle: "rad", mass: "kg" });
    expect(document.materials).toEqual({
      "aluminum-6061": {
        name: "6061-T6 Aluminum",
        description: "Heat-treated wrought aluminum alloy",
        massDensity: {
          op: "parameter",
          dimension: "massDensity",
          id: "aluminum-density",
        },
        metadata: { standard: "ASTM B221", recyclable: true },
      },
    });
    expect(partNode(document)).toMatchObject({
      kind: "part",
      materialId: "aluminum-6061",
    });
    expect(partNode(document).material).toBeUndefined();
    expect(partNode(document).massDensity).toBeUndefined();
    expect(Object.isFrozen(document.materials)).toBe(true);
    const authoredMaterial = Object.entries(document.materials ?? {}).find(
      ([id]) => id === "aluminum-6061",
    )?.[1];
    expect(Object.isFrozen(authoredMaterial)).toBe(true);
    expect(Object.isFrozen(authoredMaterial?.massDensity)).toBe(true);
  });

  it("omits the registry from legacy documents and never guesses from a label", async () => {
    const legacy = design("legacy-material-label");
    const solid = legacy.box("solid", {
      size: vec3(mm(2), mm(3), mm(4)),
    });
    legacy.output(
      "part",
      legacy.part("part", solid, { material: "steel" }),
    );
    const legacyDocument = legacy.build();
    expect(legacyDocument.materials).toBeUndefined();
    expect(stringifyDocument(legacyDocument)).not.toContain('"materials"');

    const explicitRegistry = design("no-name-lookup");
    explicitRegistry.material("steel", {
      name: "Steel",
      massDensity: kgPerCubicMeter(7_850),
    });
    const explicitSolid = explicitRegistry.box("solid", {
      size: vec3(mm(2), mm(3), mm(4)),
    });
    explicitRegistry.output(
      "part",
      explicitRegistry.part("part", explicitSolid, { material: "steel" }),
    );

    const evaluated = await evaluate(explicitRegistry.build());
    try {
      const output = evaluated.output("part");
      expect(output).toBeInstanceOf(EvaluatedPart);
      if (!(output instanceof EvaluatedPart)) return;
      expect(output.material).toBe("steel");
      expect(output.massDensity).toBeUndefined();
      expect(output.physicalMassProperties()).toMatchObject({
        ok: false,
        diagnostics: [expect.objectContaining({ code: "MASS_DENSITY_MISSING" })],
      });
    } finally {
      evaluated.dispose();
    }
  });

  it("round-trips canonically and includes material semantics in document hashes", async () => {
    const first = materialDocument(false);
    const reordered = materialDocument(true);
    expect(stringifyDocument(first)).toBe(stringifyDocument(reordered));
    expect(await hashDocument(first)).toBe(await hashDocument(reordered));

    const parsed = parseDocument(stringifyDocument(first));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(first);
    expect(await hashDocument(parsed.value)).toBe(await hashDocument(first));
    expect(Object.isFrozen(parsed.value.materials)).toBe(true);

    const changed = design("material-canonical-order");
    const aluminum = changed.material("aluminum", {
      name: "6061-T6 Aluminum",
      massDensity: kgPerCubicMeter(2_710),
    });
    const steel = changed.material("steel", {
      name: "Steel",
      massDensity: kgPerCubicMeter(7_850),
    });
    const solid = changed.box("solid", {
      size: vec3(mm(2), mm(3), mm(4)),
    });
    changed
      .output(
        "aluminum-part",
        changed.part("aluminum-part", solid, { materialRef: aluminum }),
      )
      .output(
        "steel-part",
        changed.part("steel-part", solid, { materialRef: steel }),
      );
    expect(await hashDocument(changed.build())).not.toBe(
      await hashDocument(first),
    );
  });

  it("enforces material IDs, uniqueness, names, expression dimensions, and ownership", () => {
    const cad = design("material-builder-errors");
    expect(() =>
      cad.material("1-invalid", {
        name: "Invalid ID",
        massDensity: kgPerCubicMeter(1_000),
      }),
    ).toThrow(/material id/i);
    expect(() =>
      cad.material("blank", {
        name: "   ",
        massDensity: kgPerCubicMeter(1_000),
      }),
    ).toThrow(/non-empty name/i);

    cad.material("steel", {
      name: "Steel",
      massDensity: kgPerCubicMeter(7_850),
    });
    expect(() =>
      cad.material("steel", {
        name: "Duplicate Steel",
        massDensity: kgPerCubicMeter(8_000),
      }),
    ).toThrow(/duplicate material/i);

    expect(() =>
      cad.material("wrong-dimension", {
        name: "Wrong",
        massDensity: mm(1) as unknown as ReturnType<
          typeof kgPerCubicMeter
        >,
      }),
    ).toThrow(/mass-density expression/i);

    const prototypeSafe = design("prototype-safe-material-id");
    const constructorMaterial = prototypeSafe.material("constructor", {
      name: "Constructor Alloy",
      massDensity: kgPerCubicMeter(1_000),
    });
    const prototypeSafeSolid = prototypeSafe.box("solid", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    prototypeSafe.output(
      "part",
      prototypeSafe.part("part", prototypeSafeSolid, {
        materialRef: constructorMaterial,
      }),
    );
    const prototypeSafeDocument = prototypeSafe.build();
    expect(Object.hasOwn(prototypeSafeDocument.materials ?? {}, "constructor")).toBe(
      true,
    );
    expect(
      parseDocument(stringifyDocument(prototypeSafeDocument)).ok,
    ).toBe(true);

    const owner = design("owner");
    const ownedMaterial = owner.material("owned", {
      name: "Owned",
      massDensity: kgPerCubicMeter(1_000),
    });
    const foreign = design("foreign");
    const foreignSolid = foreign.box("solid", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    expect(() =>
      foreign.part("part", foreignSolid, { materialRef: ownedMaterial }),
    ).toThrow(/design boundaries/i);

    if (false) {
      // @ts-expect-error A material must use a mass-density expression.
      cad.material("compile-time-dimension", { name: "Wrong", massDensity: mm(1) });
      foreign.part("compile-time-mixed", foreignSolid, {
        material: "Owned",
        // @ts-expect-error A part cannot mix a legacy label with a material reference.
        materialRef: ownedMaterial,
      });
    }
  });

  it("rejects malformed registries, density dimensions, missing units, and references", () => {
    const source = materialDocument(false);

    const wrongDimension = JSON.parse(stringifyDocument(source)) as any;
    wrongDimension.materials.steel.massDensity = mm(1).ir;
    const wrongDimensionResult = parseDocumentValue(wrongDimension);
    expect(wrongDimensionResult.ok).toBe(false);
    expect(wrongDimensionResult.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "EXPRESSION_DIMENSION_MISMATCH",
        path: "/materials/steel/massDensity",
      }),
    );

    const missingDensity = JSON.parse(stringifyDocument(source)) as any;
    delete missingDensity.materials.steel.massDensity;
    const missingDensityResult = parseDocumentValue(missingDensity);
    expect(missingDensityResult.ok).toBe(false);
    expect(missingDensityResult.diagnostics).toContainEqual(
      expect.objectContaining({ path: "/materials/steel/massDensity" }),
    );

    const missingUnit = JSON.parse(stringifyDocument(source)) as any;
    delete missingUnit.units.mass;
    const missingUnitResult = parseDocumentValue(missingUnit);
    expect(missingUnitResult.ok).toBe(false);
    expect(missingUnitResult.diagnostics).toContainEqual(
      expect.objectContaining({ path: "/units/mass" }),
    );

    const missingReference = JSON.parse(stringifyDocument(source)) as any;
    missingReference.nodes["steel-part"].materialId = "absent";
    const missingReferenceResult = parseDocumentValue(missingReference);
    expect(missingReferenceResult.ok).toBe(false);
    expect(missingReferenceResult.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_MISSING",
        path: "/nodes/steel-part/materialId",
      }),
    );

    const mixedLegacyAndReference = JSON.parse(
      stringifyDocument(source),
    ) as any;
    mixedLegacyAndReference.nodes["steel-part"].material = "legacy";
    const mixedResult = parseDocumentValue(mixedLegacyAndReference);
    expect(mixedResult.ok).toBe(false);
    expect(mixedResult.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IR_INVALID",
        path: "/nodes/steel-part",
      }),
    );

    const emptyRegistry = JSON.parse(stringifyDocument(source)) as any;
    emptyRegistry.materials = {};
    const emptyRegistryResult = parseDocumentValue(emptyRegistry);
    expect(emptyRegistryResult.ok).toBe(false);
    expect(emptyRegistryResult.diagnostics).toContainEqual(
      expect.objectContaining({ path: "/materials" }),
    );
  });

  it("uses material density by default and lets a part override it", async () => {
    const cad = design("material-density-precedence");
    const density = cad.parameter.massDensity(
      "steel-density",
      kgPerCubicMeter(1_000),
    );
    const steel = cad.material("steel", {
      name: "Fixture Steel",
      massDensity: density,
    });
    const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });
    const inherited = cad.part("inherited", solid, {
      partNumber: "P-001",
      materialRef: steel,
    });
    const overridden = cad.part("overridden", solid, {
      partNumber: "P-002",
      materialRef: steel,
      massDensity: kgPerCubicMeter(3_000),
    });
    cad.output("inherited", inherited).output("overridden", overridden);

    const base = await evaluate(cad.build());
    const parameterOverride = await evaluate(cad.build(), {
      "steel-density": 2e-6,
    });
    try {
      const baseInherited = base.output("inherited");
      const baseOverridden = base.output("overridden");
      const changedInherited = parameterOverride.output("inherited");
      const changedOverridden = parameterOverride.output("overridden");
      for (const output of [
        baseInherited,
        baseOverridden,
        changedInherited,
        changedOverridden,
      ]) {
        expect(output).toBeInstanceOf(EvaluatedPart);
      }
      if (
        !(baseInherited instanceof EvaluatedPart) ||
        !(baseOverridden instanceof EvaluatedPart) ||
        !(changedInherited instanceof EvaluatedPart) ||
        !(changedOverridden instanceof EvaluatedPart)
      ) {
        return;
      }

      expect(baseInherited.materialId).toBe("steel");
      expect(baseInherited.material).toBeUndefined();
      expect(baseInherited.materialName).toBe("Fixture Steel");
      expect(baseInherited.materialDefinition).toMatchObject({
        id: "steel",
        name: "Fixture Steel",
      });
      expect(baseInherited.materialDefinition?.massDensity).toBeCloseTo(
        1e-6,
        15,
      );
      expect(baseInherited.massDensity).toBeCloseTo(1e-6, 15);
      expect(baseOverridden.massDensity).toBeCloseTo(3e-6, 15);
      expect(changedInherited.massDensity).toBeCloseTo(2e-6, 15);
      expect(changedOverridden.massDensity).toBeCloseTo(3e-6, 15);

      const baseInheritedMass = baseInherited.physicalMassProperties();
      const baseOverriddenMass = baseOverridden.physicalMassProperties();
      const changedInheritedMass = changedInherited.physicalMassProperties();
      const changedOverriddenMass = changedOverridden.physicalMassProperties();
      for (const result of [
        baseInheritedMass,
        baseOverriddenMass,
        changedInheritedMass,
        changedOverriddenMass,
      ]) {
        expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      }
      expect(baseInheritedMass.ok && baseInheritedMass.value.mass).toBeCloseTo(
        24e-6,
        15,
      );
      expect(baseOverriddenMass.ok && baseOverriddenMass.value.mass).toBeCloseTo(
        72e-6,
        15,
      );
      expect(
        changedInheritedMass.ok && changedInheritedMass.value.mass,
      ).toBeCloseTo(48e-6, 15);
      expect(
        changedOverriddenMass.ok && changedOverriddenMass.value.mass,
      ).toBeCloseTo(72e-6, 15);
    } finally {
      base.dispose();
      parameterOverride.dispose();
    }
  });

  it("reports invalid resolved material density at the material definition", async () => {
    const cad = design("invalid-material-density");
    const density = cad.parameter.massDensity(
      "density",
      kgPerCubicMeter(1_000),
    );
    const material = cad.material("material", {
      name: "Parameterized Material",
      massDensity: density,
    });
    const solid = cad.box("solid", { size: vec3(mm(1), mm(1), mm(1)) });
    cad.output("part", cad.part("part", solid, { materialRef: material }));

    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await evaluator.evaluate(cad.build(), {
        parameters: { density: invalid },
      });
      expect(result.ok).toBe(false);
      if (result.ok) {
        result.value.dispose();
        continue;
      }
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "MASS_DENSITY_INVALID",
          path: "/parameters/density",
        }),
      );
    }

    const direct = design("invalid-direct-material-density");
    direct.material("invalid", {
      name: "Invalid Material",
      massDensity: kgPerCubicMeter(1_000).mul(-1),
    });
    direct.output(
      "solid",
      direct.box("solid", { size: vec3(mm(1), mm(1), mm(1)) }),
    );
    const directResult = await evaluator.evaluate(direct.build());
    expect(directResult.ok).toBe(false);
    if (directResult.ok) {
      directResult.value.dispose();
    } else {
      expect(directResult.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "MASS_DENSITY_INVALID",
          path: "/materials/invalid/massDensity",
        }),
      );
    }
  });
});
