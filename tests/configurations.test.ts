import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvaluatedAssembly,
  EvaluatedPart,
  createEvaluator,
  design,
  hashDocument,
  kgPerCubicMeter,
  mm,
  parseDocument,
  parseDocumentValue,
  scalar,
  stringifyDocument,
  vec3,
  type BillOfMaterials,
  type CadResult,
  type ConfigurationId,
  type DesignDocument,
  type EvaluatedDesign,
  type EvaluationOptions,
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

function densityInDocumentUnits(kgPerMeterCubed: number): number {
  const expression = kgPerCubicMeter(kgPerMeterCubed).ir;
  if (expression.op !== "literal") {
    throw new Error("Expected a literal mass-density expression");
  }
  return expression.value;
}

function bomValue(result: CadResult<BillOfMaterials>): BillOfMaterials {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected a bill of materials");
  return result.value;
}

async function evaluate(
  document: DesignDocument,
  options: EvaluationOptions = {},
): Promise<EvaluatedDesign> {
  const result = await evaluator.evaluate(document, options);
  if (!result.ok) {
    throw new Error(
      result.diagnostics
        .map((item) => `${item.code}: ${item.message}`)
        .join("\n"),
    );
  }
  return result.value;
}

function goldenConfigurationFixture(
  reverseConfigurationOrder = false,
): { readonly document: DesignDocument; readonly lightweight: ConfigurationId } {
  const cad = design("configured-product");
  const width = cad.parameter.length("width", mm(10), {
    min: mm(1),
    max: mm(100),
  });
  const steel = cad.material("steel", {
    name: "Fixture Steel",
    massDensity: kgPerCubicMeter(7_850),
  });
  const aluminum = cad.material("aluminum", {
    name: "Fixture Aluminum",
    massDensity: kgPerCubicMeter(2_700),
  });
  const bodySolid = cad.box("body-solid", {
    size: vec3(width, mm(10), mm(2)),
  });
  const boltSolid = cad.box("bolt-solid", {
    size: vec3(mm(2), mm(2), mm(5)),
  });
  const body = cad.part("body", bodySolid, {
    partNumber: "BODY-001",
    description: "Parameterized product body",
    materialRef: steel,
  });
  const bolt = cad.part("bolt", boltSolid, {
    partNumber: "BOLT-001",
    description: "Fixture bolt",
    materialRef: steel,
  });
  const hardware = cad.assembly("hardware", (instances) => {
    instances.instance("bolt-a", bolt);
    instances.instance("bolt-b", bolt);
  });
  const product = cad.assembly("product", (instances) => {
    instances.instance("body", body);
    instances.instance("hardware-left", hardware);
    instances.instance("hardware-right", hardware);
  });

  let lightweight: ConfigurationId | undefined;
  const authorLightweight = (reverseOverrides: boolean): void => {
    lightweight = cad.configuration(
      "lightweight",
      (configuration) => {
        if (reverseOverrides) {
          configuration
            .partMaterial(body, aluminum)
            .instanceSuppressed(hardware, "bolt-b")
            .parameter(width, mm(20));
        } else {
          configuration
            .parameter(width, mm(20))
            .instanceSuppressed(hardware, "bolt-b")
            .partMaterial(body, aluminum);
        }
      },
      {
        description: "Larger aluminum body with reduced hardware",
        metadata: { intent: "lower-mass" },
      },
    );
  };
  const authorProduction = (): void => {
    cad.configuration(
      "production",
      (configuration) => configuration.parameter(width, mm(12)),
      { description: "Production width" },
    );
  };
  if (reverseConfigurationOrder) {
    authorProduction();
    authorLightweight(true);
  } else {
    authorLightweight(false);
    authorProduction();
  }
  cad.output("product", product);
  if (lightweight === undefined) throw new Error("Missing configuration ID");
  return { document: cad.build(), lightweight };
}

describe("named design configurations", () => {
  it("authors literal, immutable configuration IR and returns a nominal ID", () => {
    const { document, lightweight } = goldenConfigurationFixture();
    const typedId: ConfigurationId = lightweight;
    expect(typedId).toBe("lightweight");
    expect(document.configurations).toEqual({
      lightweight: {
        description: "Larger aluminum body with reduced hardware",
        parameterOverrides: {
          width: { op: "literal", dimension: "length", value: 20 },
        },
        instanceSuppressions: { hardware: { "bolt-b": true } },
        partMaterialOverrides: { body: "aluminum" },
        metadata: { intent: "lower-mass" },
      },
      production: {
        description: "Production width",
        parameterOverrides: {
          width: { op: "literal", dimension: "length", value: 12 },
        },
      },
    });
    expect(Object.isFrozen(document.configurations)).toBe(true);
    const authored = document.configurations?.[lightweight];
    const hardwareSuppressions = Object.entries(
      authored?.instanceSuppressions ?? {},
    ).find(([assembly]) => assembly === "hardware")?.[1];
    expect(Object.isFrozen(authored)).toBe(true);
    expect(Object.isFrozen(hardwareSuppressions)).toBe(true);

    if (false) {
      // @ts-expect-error Configuration IDs are nominal, not arbitrary strings.
      const rawId: ConfigurationId = "lightweight";
      expect(rawId).toBe(typedId);
    }
  });

  it("round-trips, hashes, and serializes independently of authoring order", async () => {
    const first = goldenConfigurationFixture(false).document;
    const reordered = goldenConfigurationFixture(true).document;
    expect(stringifyDocument(reordered)).toBe(stringifyDocument(first));
    expect(await hashDocument(reordered)).toBe(await hashDocument(first));

    const parsed = parseDocument(stringifyDocument(first));
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(first);
    expect(await hashDocument(parsed.value)).toBe(await hashDocument(first));
    expect(Object.isFrozen(parsed.value.configurations)).toBe(true);

    const changedValue = JSON.parse(stringifyDocument(first)) as any;
    changedValue.configurations.lightweight.parameterOverrides.width.value = 21;
    const changed = parseDocumentValue(changedValue);
    expect(changed.ok, JSON.stringify(changed.diagnostics)).toBe(true);
    if (!changed.ok) return;
    expect(await hashDocument(changed.value)).not.toBe(await hashDocument(first));

    const changedMetadataValue = JSON.parse(stringifyDocument(first)) as any;
    changedMetadataValue.configurations.lightweight.metadata.intent = "review";
    const changedMetadata = parseDocumentValue(changedMetadataValue);
    expect(changedMetadata.ok, JSON.stringify(changedMetadata.diagnostics)).toBe(
      true,
    );
    if (!changedMetadata.ok) return;
    expect(await hashDocument(changedMetadata.value)).not.toBe(
      await hashDocument(first),
    );
  });

  it("enforces IDs, ownership, dimensions, uniqueness, and prototype-safe targets", async () => {
    const cad = design("configuration-builder-errors");
    const width = cad.parameter.length("width", mm(10));
    const steel = cad.material("steel", {
      name: "Steel",
      massDensity: kgPerCubicMeter(7_850),
    });
    const aluminum = cad.material("aluminum", {
      name: "Aluminum",
      massDensity: kgPerCubicMeter(2_700),
    });
    const solid = cad.box("solid", { size: vec3(width, mm(2), mm(3)) });
    const part = cad.part("part", solid, { materialRef: steel });
    const assembly = cad.assembly("assembly", (instances) => {
      instances.instance("part", part);
    });

    expect(() => cad.configuration("1-invalid", () => {})).toThrow(
      /configuration id/i,
    );
    expect(() => cad.configuration("empty", () => {})).toThrow(
      /at least one override/i,
    );
    expect(() =>
      cad.configuration("wrong-instance", (configuration) =>
        configuration.instanceSuppressed(assembly, "missing"),
      ),
    ).toThrow(/has no instance/i);
    expect(() =>
      cad.configuration("wrong-dimension", (configuration) =>
        configuration.parameter(width, scalar(2) as any),
      ),
    ).toThrow(/dimension length/i);
    expect(() =>
      cad.configuration("duplicate-parameter", (configuration) =>
        configuration.parameter(width, mm(20)).parameter(width, mm(30)),
      ),
    ).toThrow(/duplicate configuration parameter/i);
    expect(() =>
      cad.configuration("duplicate-instance", (configuration) =>
        configuration
          .instanceSuppressed(assembly, "part")
          .instanceSuppressed(assembly, "part", false),
      ),
    ).toThrow(/duplicate configuration instance/i);
    expect(() =>
      cad.configuration("duplicate-material", (configuration) =>
        configuration
          .partMaterial(part, aluminum)
          .partMaterial(part, steel),
      ),
    ).toThrow(/duplicate configuration material/i);

    const foreign = design("foreign-configuration-owner");
    const foreignWidth = foreign.parameter.length("foreign-width", mm(1));
    const foreignMaterial = foreign.material("foreign-material", {
      name: "Foreign",
      massDensity: kgPerCubicMeter(1_000),
    });
    expect(() =>
      cad.configuration("foreign-parameter", (configuration) =>
        configuration.parameter(foreignWidth, mm(2)),
      ),
    ).toThrow(/parameter references cannot cross/i);
    expect(() =>
      cad.configuration("foreign-material", (configuration) =>
        configuration.partMaterial(part, foreignMaterial),
      ),
    ).toThrow(/model references cannot cross/i);

    cad.configuration("one", (configuration) =>
      configuration.parameter(width, mm(20)),
    );
    expect(() =>
      cad.configuration("one", (configuration) =>
        configuration.parameter(width, mm(30)),
      ),
    ).toThrow(/duplicate configuration/i);

    const prototypeParameter = cad.parameter.length("constructor", mm(1));
    const prototypeMaterial = cad.material("toString", {
      name: "Prototype-safe material",
      massDensity: kgPerCubicMeter(1_000),
    });
    const prototypeSolid = cad.box("valueOf-solid", {
      size: vec3(prototypeParameter, mm(1), mm(1)),
    });
    const prototypePart = cad.part("valueOf", prototypeSolid);
    const prototypeAssembly = cad.assembly("hasOwnProperty", (instances) => {
      instances.instance("constructor", prototypePart);
    });
    const constructorId = cad.configuration("constructor", (configuration) =>
      configuration
        .parameter(prototypeParameter, mm(15))
        .instanceSuppressed(prototypeAssembly, "constructor", false)
        .partMaterial(prototypePart, prototypeMaterial),
    );
    cad.output("constructor", prototypeAssembly);
    expect(constructorId).toBe("constructor");
    const prototypeSafeDocument = cad.build();
    expect(
      Object.hasOwn(prototypeSafeDocument.configurations ?? {}, "constructor"),
    ).toBe(true);
    expect(
      prototypeSafeDocument.configurations?.[constructorId],
    ).toMatchObject({
      parameterOverrides: { constructor: mm(15).ir },
      instanceSuppressions: {
        hasOwnProperty: { constructor: false },
      },
      partMaterialOverrides: { valueOf: "toString" },
    });
    expect(Object.hasOwn(prototypeSafeDocument.parameters, "constructor")).toBe(
      true,
    );
    expect(Object.hasOwn(prototypeSafeDocument.nodes, "hasOwnProperty")).toBe(
      true,
    );
    expect(Object.hasOwn(prototypeSafeDocument.outputs, "constructor")).toBe(
      true,
    );
    const parsedPrototypeSafe = parseDocument(
      stringifyDocument(prototypeSafeDocument),
    );
    expect(
      parsedPrototypeSafe.ok,
      JSON.stringify(parsedPrototypeSafe.diagnostics),
    ).toBe(true);
    if (!parsedPrototypeSafe.ok) return;
    const prototypeEvaluation = await evaluate(parsedPrototypeSafe.value, {
      configuration: constructorId,
    });
    try {
      expect(prototypeEvaluation.parameters.constructor).toBe(15);
      const output = prototypeEvaluation.output("constructor");
      expect(output).toBeInstanceOf(EvaluatedAssembly);
      if (!(output instanceof EvaluatedAssembly)) return;
      expect(output.measure().volume).toBeCloseTo(15, 10);
      expect(output.instances).toMatchObject([
        {
          id: "constructor",
          partNode: "valueOf",
          materialId: "toString",
          materialName: "Prototype-safe material",
        },
      ]);
      expect(bomValue(output.billOfMaterials())).toMatchObject({
        configurationId: "constructor",
        totalQuantity: 1,
        items: [expect.objectContaining({ materialId: "toString" })],
      });
    } finally {
      prototypeEvaluation.dispose();
    }

    if (false) {
      cad.configuration("compile-time-dimension", (configuration) => {
        // @ts-expect-error A length parameter cannot take a scalar expression.
        configuration.parameter(width, scalar(2));
      });
    }
  });

  it("rejects malformed and semantically invalid configuration records", () => {
    const source = goldenConfigurationFixture().document;
    const mutate = (change: (value: any) => void) => {
      const value = JSON.parse(stringifyDocument(source)) as any;
      change(value);
      return parseDocumentValue(value);
    };

    const emptyRegistry = mutate((value) => {
      value.configurations = {};
    });
    expect(emptyRegistry.ok).toBe(false);
    expect(emptyRegistry.diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID", path: "/configurations" }),
    );

    const emptyConfiguration = mutate((value) => {
      value.configurations.lightweight = {};
    });
    expect(emptyConfiguration.ok).toBe(false);
    expect(emptyConfiguration.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IR_INVALID",
        path: "/configurations/lightweight",
      }),
    );

    const emptyOverrideMap = mutate((value) => {
      value.configurations.lightweight.parameterOverrides = {};
    });
    expect(emptyOverrideMap.ok).toBe(false);
    expect(emptyOverrideMap.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IR_INVALID",
        path: "/configurations/lightweight/parameterOverrides",
      }),
    );

    for (const [label, change, path] of [
      [
        "empty suppression registry",
        (value: any) => {
          value.configurations.lightweight.instanceSuppressions = {};
        },
        "/configurations/lightweight/instanceSuppressions",
      ],
      [
        "empty direct-instance registry",
        (value: any) => {
          value.configurations.lightweight.instanceSuppressions.hardware = {};
        },
        "/configurations/lightweight/instanceSuppressions/hardware",
      ],
      [
        "empty material registry",
        (value: any) => {
          value.configurations.lightweight.partMaterialOverrides = {};
        },
        "/configurations/lightweight/partMaterialOverrides",
      ],
      [
        "non-boolean suppression",
        (value: any) => {
          value.configurations.lightweight.instanceSuppressions.hardware[
            "bolt-b"
          ] = "true";
        },
        "/configurations/lightweight/instanceSuppressions/hardware/bolt-b",
      ],
      [
        "unknown configuration field",
        (value: any) => {
          value.configurations.lightweight.unknown = true;
        },
        "/configurations/lightweight",
      ],
    ] as const) {
      const result = mutate(change);
      expect(result.ok, label).toBe(false);
      expect(result.diagnostics, label).toContainEqual(
        expect.objectContaining({ code: "IR_INVALID", path }),
      );
    }

    const malformedExpression = mutate((value) => {
      value.configurations.lightweight.parameterOverrides.width.value = "20";
    });
    expect(malformedExpression.ok).toBe(false);
    expect(malformedExpression.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IR_INVALID",
        path:
          "/configurations/lightweight/parameterOverrides/width/value",
      }),
    );

    const missingParameter = mutate((value) => {
      value.configurations.lightweight.parameterOverrides = {
        missing: mm(20).ir,
      };
    });
    expect(missingParameter.ok).toBe(false);
    expect(missingParameter.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "PARAMETER_MISSING",
        path: "/configurations/lightweight/parameterOverrides/missing",
      }),
    );

    const wrongParameterDimension = mutate((value) => {
      value.configurations.lightweight.parameterOverrides.width = scalar(2).ir;
    });
    expect(wrongParameterDimension.ok).toBe(false);
    expect(wrongParameterDimension.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "EXPRESSION_DIMENSION_MISMATCH",
        path: "/configurations/lightweight/parameterOverrides/width",
      }),
    );

    const missingAssembly = mutate((value) => {
      value.configurations.lightweight.instanceSuppressions = {
        absent: { "bolt-b": true },
      };
    });
    expect(missingAssembly.ok).toBe(false);
    expect(missingAssembly.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_MISSING",
        path: "/configurations/lightweight/instanceSuppressions/absent",
      }),
    );

    const wrongAssemblyKind = mutate((value) => {
      value.configurations.lightweight.instanceSuppressions = {
        body: { "bolt-b": true },
      };
    });
    expect(wrongAssemblyKind.ok).toBe(false);
    expect(wrongAssemblyKind.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        path: "/configurations/lightweight/instanceSuppressions/body",
      }),
    );

    const missingInstance = mutate((value) => {
      value.configurations.lightweight.instanceSuppressions.hardware = {
        missing: true,
      };
    });
    expect(missingInstance.ok).toBe(false);
    expect(missingInstance.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_MISSING",
        path:
          "/configurations/lightweight/instanceSuppressions/hardware/missing",
      }),
    );

    const wrongPartKind = mutate((value) => {
      value.configurations.lightweight.partMaterialOverrides = {
        hardware: "aluminum",
      };
    });
    expect(wrongPartKind.ok).toBe(false);
    expect(wrongPartKind.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        path: "/configurations/lightweight/partMaterialOverrides/hardware",
      }),
    );

    const missingPart = mutate((value) => {
      value.configurations.lightweight.partMaterialOverrides = {
        absent: "aluminum",
      };
    });
    expect(missingPart.ok).toBe(false);
    expect(missingPart.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_MISSING",
        path: "/configurations/lightweight/partMaterialOverrides/absent",
      }),
    );

    const missingMaterial = mutate((value) => {
      value.configurations.lightweight.partMaterialOverrides.body = "absent";
    });
    expect(missingMaterial.ok).toBe(false);
    expect(missingMaterial.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_MISSING",
        path: "/configurations/lightweight/partMaterialOverrides/body",
      }),
    );
  });

  it("evaluates defaults, configuration overrides, and call-time overrides in precedence order", async () => {
    const document = goldenConfigurationFixture().document;
    const baseline = await evaluate(document);
    const lightweight = await evaluate(document, { configuration: "lightweight" });
    const baselineAgain = await evaluate(document);
    const runtime = await evaluate(document, {
      configuration: "lightweight",
      parameters: { width: 30 },
    });
    const inheritedParameters = Object.create({ width: 40 }) as Record<
      string,
      number
    >;
    const inherited = await evaluate(document, {
      configuration: "lightweight",
      parameters: inheritedParameters,
    });
    let disposedOutput: EvaluatedAssembly | undefined;
    try {
      expect(baseline.configurationId).toBeNull();
      expect(lightweight.configurationId).toBe("lightweight");
      expect(baselineAgain.configurationId).toBeNull();
      expect(runtime.configurationId).toBe("lightweight");
      expect(inherited.configurationId).toBe("lightweight");
      expect([
        baseline.parameters.width,
        lightweight.parameters.width,
        baselineAgain.parameters.width,
        runtime.parameters.width,
        inherited.parameters.width,
      ]).toEqual([10, 20, 10, 30, 20]);

      const baselineOutput = baseline.output("product");
      const lightweightOutput = lightweight.output("product");
      const baselineAgainOutput = baselineAgain.output("product");
      const runtimeOutput = runtime.output("product");
      for (const output of [
        baselineOutput,
        lightweightOutput,
        baselineAgainOutput,
        runtimeOutput,
      ]) {
        expect(output).toBeInstanceOf(EvaluatedAssembly);
      }
      if (
        !(baselineOutput instanceof EvaluatedAssembly) ||
        !(lightweightOutput instanceof EvaluatedAssembly) ||
        !(baselineAgainOutput instanceof EvaluatedAssembly) ||
        !(runtimeOutput instanceof EvaluatedAssembly)
      ) {
        return;
      }
      disposedOutput = lightweightOutput;

      expect(baselineOutput.measure().volume).toBeCloseTo(280, 8);
      expect(lightweightOutput.measure().volume).toBeCloseTo(440, 8);
      expect(baselineAgainOutput.measure().volume).toBeCloseTo(280, 8);
      expect(runtimeOutput.measure().volume).toBeCloseTo(640, 8);
      expect(lightweightOutput.instances.map((instance) => instance.id)).toEqual([
        "body",
        "hardware-left/bolt-a",
        "hardware-right/bolt-a",
      ]);
      expect(
        lightweightOutput.instances.find((instance) => instance.id === "body"),
      ).toMatchObject({
        partNode: "body",
        materialId: "aluminum",
        materialName: "Fixture Aluminum",
        massDensitySource: "material",
      });
      expect(
        baselineOutput.instances.find((instance) => instance.id === "body"),
      ).toMatchObject({
        partNode: "body",
        materialId: "steel",
        materialName: "Fixture Steel",
      });

      const baselineBom = bomValue(baselineOutput.billOfMaterials());
      const lightweightBom = bomValue(lightweightOutput.billOfMaterials());
      const baselineAgainBom = bomValue(
        baselineAgainOutput.billOfMaterials(),
      );
      const runtimeBom = bomValue(runtimeOutput.billOfMaterials());
      expect(baselineBom.configurationId).toBeNull();
      expect(lightweightBom.configurationId).toBe("lightweight");
      expect(runtimeBom.configurationId).toBe("lightweight");
      expect([
        baselineBom.totalQuantity,
        lightweightBom.totalQuantity,
        baselineAgainBom.totalQuantity,
        runtimeBom.totalQuantity,
      ]).toEqual([5, 3, 5, 3]);
      expect(baselineBom.totalMass).toBeCloseTo(0.002198, 12);
      expect(lightweightBom.totalMass).toBeCloseTo(0.001394, 12);
      expect(baselineAgainBom).toEqual(baselineBom);
      expect(runtimeBom.totalMass).toBeCloseTo(0.001934, 12);

      const lightweightBolt = lightweightBom.items.find(
        (item) => item.partNode === "bolt",
      );
      expect(lightweightBolt).toMatchObject({
        materialId: "steel",
        quantity: 2,
        occurrenceIds: [
          "hardware-left/bolt-a",
          "hardware-right/bolt-a",
        ],
      });
      const lightweightBody = lightweightBom.items.find(
        (item) => item.partNode === "body",
      );
      expect(lightweightBody).toMatchObject({
        materialId: "aluminum",
        material: "Fixture Aluminum",
        quantity: 1,
        occurrenceIds: ["body"],
      });
    } finally {
      baseline.dispose();
      lightweight.dispose();
      baselineAgain.dispose();
      runtime.dispose();
      inherited.dispose();
      expect(lightweight.configurationId).toBe("lightweight");
      expect(lightweight.parameters.width).toBe(20);
      expect(() => lightweight.output("product")).toThrow(/disposed/i);
      const outputAfterDisposal = disposedOutput;
      if (outputAfterDisposal !== undefined) {
        expect(() => outputAfterDisposal.measure()).toThrow(/disposed/i);
        expect(() => outputAfterDisposal.billOfMaterials()).toThrow(/disposed/i);
      }
    }
  });

  it("applies false suppression overrides to every use of a shared definition", async () => {
    const cad = design("configuration-unsuppression");
    const solid = cad.box("solid", { size: vec3(mm(1), mm(1), mm(1)) });
    const part = cad.part("part", solid, {
      partNumber: "P-001",
      massDensity: kgPerCubicMeter(1_000),
      material: "Fixture",
    });
    const shared = cad.assembly("shared", (instances) => {
      instances.instance("active", part);
      instances.instance("authored-suppressed", part, { suppressed: true });
    });
    const root = cad.assembly("root", (instances) => {
      instances.instance("left", shared);
      instances.instance("right", shared);
    });
    cad.configuration("service", (configuration) =>
      configuration.instanceSuppressed(
        shared,
        "authored-suppressed",
        false,
      ),
    );
    cad.output("root", root);

    const baseline = await evaluate(cad.build());
    const service = await evaluate(cad.build(), { configuration: "service" });
    try {
      const baselineOutput = baseline.output("root");
      const serviceOutput = service.output("root");
      expect(baselineOutput).toBeInstanceOf(EvaluatedAssembly);
      expect(serviceOutput).toBeInstanceOf(EvaluatedAssembly);
      if (
        !(baselineOutput instanceof EvaluatedAssembly) ||
        !(serviceOutput instanceof EvaluatedAssembly)
      ) {
        return;
      }
      expect(baselineOutput.instances.map((instance) => instance.id)).toEqual([
        "left/active",
        "right/active",
      ]);
      expect(serviceOutput.instances.map((instance) => instance.id)).toEqual([
        "left/active",
        "left/authored-suppressed",
        "right/active",
        "right/authored-suppressed",
      ]);
      expect(bomValue(serviceOutput.billOfMaterials())).toMatchObject({
        configurationId: "service",
        totalQuantity: 4,
      });
    } finally {
      baseline.dispose();
      service.dispose();
    }
  });

  it("changes effective material identity while preserving explicit part density", async () => {
    const cad = design("configured-explicit-density");
    const aluminum = cad.material("aluminum", {
      name: "Aluminum",
      massDensity: kgPerCubicMeter(2_700),
    });
    const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });
    const part = cad.part("part", solid, {
      partNumber: "P-001",
      material: "Legacy steel label",
      massDensity: kgPerCubicMeter(3_000),
    });
    cad.configuration("aluminum", (configuration) =>
      configuration.partMaterial(part, aluminum),
    );
    cad.output("part", part);
    const document = cad.build();

    const baseline = await evaluate(document);
    const configured = await evaluate(document, { configuration: "aluminum" });
    try {
      const baselinePart = baseline.output("part");
      const configuredPart = configured.output("part");
      expect(baselinePart).toBeInstanceOf(EvaluatedPart);
      expect(configuredPart).toBeInstanceOf(EvaluatedPart);
      if (
        !(baselinePart instanceof EvaluatedPart) ||
        !(configuredPart instanceof EvaluatedPart)
      ) {
        return;
      }
      expect(baselinePart).toMatchObject({
        material: "Legacy steel label",
        materialId: undefined,
        materialName: undefined,
        massDensitySource: "part",
      });
      expect(configuredPart).toMatchObject({
        material: "Legacy steel label",
        materialId: "aluminum",
        materialName: "Aluminum",
        massDensitySource: "part",
      });
      expect(configuredPart.massDensity).toBeCloseTo(
        densityInDocumentUnits(3_000),
        15,
      );
      const baselineBom = bomValue(baselinePart.billOfMaterials());
      const configuredBom = bomValue(configuredPart.billOfMaterials());
      expect(baselineBom.items[0]).toMatchObject({
        materialId: null,
        material: "Legacy steel label",
      });
      expect(configuredBom).toMatchObject({
        configurationId: "aluminum",
        totalMass: baselineBom.totalMass,
        items: [
          expect.objectContaining({
            materialId: "aluminum",
            material: "Aluminum",
            massDensitySource: "part",
          }),
        ],
      });
      expect(document.nodes["part" as keyof typeof document.nodes]).toMatchObject({
        material: "Legacy steel label",
      });
    } finally {
      baseline.dispose();
      configured.dispose();
    }
  });

  it("resolves configuration expressions through effective dependencies and detects selected cycles", async () => {
    const cad = design("configuration-expression-dependencies");
    const width = cad.parameter.length("width", mm(10));
    const height = cad.parameter.length("height", mm(5));
    const solid = cad.box("solid", {
      size: vec3(width, height, mm(1)),
    });
    cad.configuration("linked", (configuration) =>
      configuration
        .parameter(width, height.mul(2))
        .parameter(height, mm(20)),
    );
    cad.output("solid", solid);

    const baseline = await evaluate(cad.build());
    const linked = await evaluate(cad.build(), { configuration: "linked" });
    const runtime = await evaluate(cad.build(), {
      configuration: "linked",
      parameters: { height: 30 },
    });
    try {
      expect(baseline.parameters).toMatchObject({ width: 10, height: 5 });
      expect(linked.parameters).toMatchObject({ width: 40, height: 20 });
      expect(runtime.parameters).toMatchObject({ width: 60, height: 30 });
      expect(baseline.output("solid").measure().volume).toBeCloseTo(50, 10);
      expect(linked.output("solid").measure().volume).toBeCloseTo(800, 10);
      expect(runtime.output("solid").measure().volume).toBeCloseTo(1_800, 10);
    } finally {
      baseline.dispose();
      linked.dispose();
      runtime.dispose();
    }

    const cyclicCad = design("configuration-expression-cycle");
    const first = cyclicCad.parameter.length("first", mm(1));
    const second = cyclicCad.parameter.length("second", mm(2));
    const cyclicSolid = cyclicCad.box("solid", {
      size: vec3(first, mm(1), mm(1)),
    });
    cyclicCad.configuration("cyclic", (configuration) =>
      configuration.parameter(first, second).parameter(second, first),
    );
    cyclicCad.output("solid", cyclicSolid);
    const cycle = await evaluator.evaluate(cyclicCad.build(), {
      configuration: "cyclic",
    });
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) {
      expect(cycle.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "PARAMETER_CYCLE",
          path: "/configurations/cyclic/parameterOverrides/first",
        }),
      );
    }
  });

  it("reports unknown selections and selected parameter errors precisely", async () => {
    const document = goldenConfigurationFixture().document;
    const missing = await evaluator.evaluate(document, {
      configuration: "absent",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.diagnostics).toEqual([
        expect.objectContaining({
          code: "CONFIGURATION_MISSING",
          path: "/configurations/absent",
          details: { available: ["lightweight", "production"] },
        }),
      ]);
    }

    const cad = design("invalid-selected-configuration");
    const width = cad.parameter.length("width", mm(10), { max: mm(25) });
    const solid = cad.box("solid", { size: vec3(width, mm(1), mm(1)) });
    cad.configuration("too-wide", (configuration) =>
      configuration.parameter(width, mm(30)),
    );
    cad.output("solid", solid);
    const validBaseline = await evaluator.evaluate(cad.build());
    expect(validBaseline.ok, JSON.stringify(validBaseline.diagnostics)).toBe(true);
    if (validBaseline.ok) validBaseline.value.dispose();
    const invalidSelection = await evaluator.evaluate(cad.build(), {
      configuration: "too-wide",
    });
    expect(invalidSelection.ok).toBe(false);
    if (!invalidSelection.ok) {
      expect(invalidSelection.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "PARAMETER_OUT_OF_RANGE",
          path: "/configurations/too-wide/parameterOverrides/width",
        }),
      );
    }
  });

  it("preserves configuration-free documents and exposes null selection identity", async () => {
    const cad = design("configuration-free");
    const solid = cad.box("solid", { size: vec3(mm(1), mm(2), mm(3)) });
    const part = cad.part("part", solid, {
      partNumber: "P-001",
      material: "Fixture",
      massDensity: kgPerCubicMeter(1_000),
    });
    cad.output("part", part);
    const document = cad.build();
    expect(document.configurations).toBeUndefined();
    expect(stringifyDocument(document)).not.toContain('"configurations"');

    const evaluated = await evaluate(document);
    try {
      expect(evaluated.configurationId).toBeNull();
      const output = evaluated.output("part");
      expect(output).toBeInstanceOf(EvaluatedPart);
      if (!(output instanceof EvaluatedPart)) return;
      expect(bomValue(output.billOfMaterials()).configurationId).toBeNull();
    } finally {
      evaluated.dispose();
    }
  });

  it("keeps configured geometry and BOM semantics aligned across both built-in kernels", async () => {
    const document = goldenConfigurationFixture().document;
    const mesh = await evaluate(document, { configuration: "lightweight" });
    const exactEvaluator = await createEvaluator({
      kernel: await createOcctKernel(),
    });
    const exactResult = await exactEvaluator.evaluate(document, {
      configuration: "lightweight",
    });
    expect(exactResult.ok, JSON.stringify(exactResult.diagnostics)).toBe(true);
    if (!exactResult.ok) {
      mesh.dispose();
      exactEvaluator.dispose();
      return;
    }
    try {
      const meshOutput = mesh.output("product");
      const exactOutput = exactResult.value.output("product");
      expect(meshOutput).toBeInstanceOf(EvaluatedAssembly);
      expect(exactOutput).toBeInstanceOf(EvaluatedAssembly);
      if (
        !(meshOutput instanceof EvaluatedAssembly) ||
        !(exactOutput instanceof EvaluatedAssembly)
      ) {
        return;
      }
      expect(exactResult.value.configurationId).toBe("lightweight");
      expect(exactOutput.instances).toEqual(meshOutput.instances);
      expect(exactOutput.measure().volume).toBeCloseTo(
        meshOutput.measure().volume,
        7,
      );
      const meshBom = bomValue(meshOutput.billOfMaterials());
      const exactBom = bomValue(exactOutput.billOfMaterials());
      expect(exactBom.configurationId).toBe("lightweight");
      expect(
        exactBom.items.map((item) => ({
          partNode: item.partNode,
          materialId: item.materialId,
          quantity: item.quantity,
          occurrenceIds: item.occurrenceIds,
        })),
      ).toEqual(
        meshBom.items.map((item) => ({
          partNode: item.partNode,
          materialId: item.materialId,
          quantity: item.quantity,
          occurrenceIds: item.occurrenceIds,
        })),
      );
      expect(exactBom.totalMass).toBeCloseTo(meshBom.totalMass ?? Number.NaN, 12);
    } finally {
      mesh.dispose();
      exactResult.value.dispose();
      exactEvaluator.dispose();
    }
  }, 20_000);
});
