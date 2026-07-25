import { describe, expect, it } from "vitest";
import {
  configurationId,
  materialId,
  nodeId,
} from "../src/core/ids.js";
import { CadError } from "../src/core/result.js";
import {
  DesignBuilder,
  MaterialRef,
  PartRef,
  type MaterialOptions,
  type PartOptions,
} from "../src/design.js";
import {
  kgPerCubicMeter,
  mm,
  scalar,
} from "../src/expressions.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
} from "../src/ir.js";
import { stagedBodySetDesignV7 } from "../src/internal/document-v7-body-set-authoring.js";
import * as publicApi from "../src/index.js";
import {
  parseDocumentV7,
  stringifyDocumentV7,
} from "../src/serialization.js";

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeepFrozen(descriptor.value, seen);
    }
  }
}

function expectAuthoringFailure(
  author: () => unknown,
  pattern: RegExp,
): void {
  expect(author).toThrow(pattern);
}

function designWithBox(name: string) {
  const cad = stagedBodySetDesignV7(name);
  const box = cad.box("box", {
    size: [mm(2), mm(3), mm(4)],
  });
  return { cad, box };
}

describe("staged document-v7 part authoring", () => {
  it("emits exact detached frozen material, part, and configuration IR", () => {
    const designMetadata = {
      purpose: "part-authoring",
      nested: { revision: 2 },
    };
    const materialMetadata = {
      standard: "fixture-a",
      nested: { temper: "T6" },
    };
    const partMetadata = {
      finish: "ground",
      nested: { inspection: "approved" },
    };
    const multibodyMetadata = {
      finish: "as-machined",
      nested: { station: 3 },
    };
    const configurationMetadata = {
      intent: "high-density",
      nested: { review: "approved" },
    };
    const multibodyPartOptions = {
      partNumber: "PART-MULTI",
      description: "Independent multibody part",
      material: "Legacy fixture label",
      massDensity: kgPerCubicMeter(1_200),
      metadata: multibodyMetadata,
    };

    const cad = stagedBodySetDesignV7("authored-v7-parts", {
      metadata: designMetadata,
    });
    const width = cad.parameter.length("width", mm(2), {
      min: mm(1),
      max: mm(20),
      label: "Width",
    });
    const density = cad.parameter.massDensity(
      "density",
      kgPerCubicMeter(2_700),
      {
        min: kgPerCubicMeter(1_000),
        max: kgPerCubicMeter(10_000),
        description: "Configurable material density",
      },
    );
    const aluminumOptions = {
      name: "Fixture aluminum",
      description: "Base material",
      massDensity: density,
      metadata: materialMetadata,
    };
    const aluminum = cad.material("aluminum", aluminumOptions);
    const steel = cad.material("steel", {
      name: "Fixture steel",
      description: "Configured material",
      massDensity: kgPerCubicMeter(7_850),
      metadata: { standard: "fixture-b" },
    });
    const box = cad.box("box", {
      size: [width, mm(3), mm(4)],
      center: true,
    });
    const bodies = cad.bodySet("bodies", [
      {
        id: "primary",
        solid: box,
        name: "Primary body",
        metadata: { role: "primary" },
      },
      { id: "alias", solid: box, name: "Shared alias" },
    ]);
    const leafPartOptions = {
      partNumber: "PART-LEAF",
      description: "Direct solid part",
      materialRef: aluminum,
      metadata: partMetadata,
    };
    const leafPart = cad.part("leaf-part", box, leafPartOptions);
    const multibodyPart = cad.part(
      "multibody-part",
      bodies,
      multibodyPartOptions,
    );
    const explicitPart = cad.part("explicit-part", box, {
      partNumber: "PART-EXPLICIT",
      materialRef: aluminum,
      massDensity: density,
    });
    cad.configuration(
      "dense",
      (configuration) => {
        configuration.parameter(width, mm(5));
        configuration.parameter(density, kgPerCubicMeter(3_000));
        configuration.partMaterial(leafPart, steel);
        configuration.partMaterial(explicitPart, steel);
      },
      {
        description: "Configured geometry and materials",
        metadata: configurationMetadata,
      },
    );
    cad.output("leaf", leafPart);
    cad.output("multibody", multibodyPart);
    cad.output("explicit", explicitPart);

    expect(aluminum).toBeInstanceOf(MaterialRef);
    expect(leafPart).toBeInstanceOf(PartRef);
    expect(Object.isFrozen(aluminum)).toBe(true);
    expect(Object.isFrozen(leafPart)).toBe(true);

    const document = cad.build();
    expect(document).toMatchObject({
      schema: DOCUMENT_SCHEMA_V7,
      version: DOCUMENT_VERSION_V7,
      name: "authored-v7-parts",
      units: { length: "mm", angle: "rad", mass: "kg" },
    });
    expect(document.parameters).toEqual({
      width: {
        dimension: "length",
        default: mm(2).ir,
        min: mm(1).ir,
        max: mm(20).ir,
        label: "Width",
      },
      density: {
        dimension: "massDensity",
        default: kgPerCubicMeter(2_700).ir,
        min: kgPerCubicMeter(1_000).ir,
        max: kgPerCubicMeter(10_000).ir,
        description: "Configurable material density",
      },
    });
    expect(document.materials).toEqual({
      aluminum: {
        name: "Fixture aluminum",
        description: "Base material",
        massDensity: density.ir,
        metadata: {
          standard: "fixture-a",
          nested: { temper: "T6" },
        },
      },
      steel: {
        name: "Fixture steel",
        description: "Configured material",
        massDensity: kgPerCubicMeter(7_850).ir,
        metadata: { standard: "fixture-b" },
      },
    });
    expect(document.nodes[nodeId("leaf-part")]).toEqual({
      kind: "part",
      geometry: { node: "box", kind: "solid" },
      partNumber: "PART-LEAF",
      description: "Direct solid part",
      materialId: "aluminum",
      metadata: {
        finish: "ground",
        nested: { inspection: "approved" },
      },
    });
    expect(document.nodes[nodeId("multibody-part")]).toEqual({
      kind: "part",
      geometry: { node: "bodies", kind: "bodySet" },
      partNumber: "PART-MULTI",
      description: "Independent multibody part",
      material: "Legacy fixture label",
      massDensity: kgPerCubicMeter(1_200).ir,
      metadata: {
        finish: "as-machined",
        nested: { station: 3 },
      },
    });
    expect(document.nodes[nodeId("explicit-part")]).toEqual({
      kind: "part",
      geometry: { node: "box", kind: "solid" },
      partNumber: "PART-EXPLICIT",
      materialId: "aluminum",
      massDensity: density.ir,
    });
    expect(document.configurations).toEqual({
      dense: {
        description: "Configured geometry and materials",
        parameterOverrides: {
          width: mm(5).ir,
          density: kgPerCubicMeter(3_000).ir,
        },
        partMaterialOverrides: {
          "leaf-part": "steel",
          "explicit-part": "steel",
        },
        metadata: {
          intent: "high-density",
          nested: { review: "approved" },
        },
      },
    });
    expect(document.outputs).toEqual({
      leaf: { node: "leaf-part", kind: "part" },
      multibody: { node: "multibody-part", kind: "part" },
      explicit: { node: "explicit-part", kind: "part" },
    });
    expectDeepFrozen(document);

    expect(Object.isFrozen(designMetadata)).toBe(false);
    expect(Object.isFrozen(materialMetadata)).toBe(false);
    expect(Object.isFrozen(partMetadata)).toBe(false);
    expect(Object.isFrozen(multibodyMetadata)).toBe(false);
    expect(Object.isFrozen(configurationMetadata)).toBe(false);
    designMetadata.nested.revision = 99;
    materialMetadata.nested.temper = "mutated";
    partMetadata.nested.inspection = "mutated";
    multibodyMetadata.nested.station = 99;
    configurationMetadata.nested.review = "mutated";
    aluminumOptions.name = "Mutated material";
    leafPartOptions.partNumber = "MUTATED";
    multibodyPartOptions.description = "Mutated part";
    expect(document.metadata).toEqual({
      purpose: "part-authoring",
      nested: { revision: 2 },
    });
    expect(document.materials?.[materialId("aluminum")]).toMatchObject({
      name: "Fixture aluminum",
      metadata: {
        standard: "fixture-a",
        nested: { temper: "T6" },
      },
    });
    expect(document.nodes[nodeId("leaf-part")]).toMatchObject({
      partNumber: "PART-LEAF",
      metadata: {
        finish: "ground",
        nested: { inspection: "approved" },
      },
    });
    expect(document.nodes[nodeId("multibody-part")]).toMatchObject({
      description: "Independent multibody part",
      metadata: {
        finish: "as-machined",
        nested: { station: 3 },
      },
    });
    expect(
      document.configurations?.[configurationId("dense")]?.metadata,
    ).toEqual({
      intent: "high-density",
      nested: { review: "approved" },
    });

    const text = stringifyDocumentV7(document);
    const parsed = parseDocumentV7(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(document);
    expect(parsed.value).not.toBe(document);
    expect(stringifyDocumentV7(parsed.value)).toBe(text);
    expectDeepFrozen(parsed.value);
  });

  it("rejects foreign and forged geometry, material, part, and configuration handles", () => {
    const first = stagedBodySetDesignV7("first");
    const second = stagedBodySetDesignV7("second");
    const firstBox = first.box("box", {
      size: [mm(1), mm(1), mm(1)],
    });
    const secondBox = second.box("box", {
      size: [mm(1), mm(1), mm(1)],
    });
    const firstSet = first.bodySet("bodies", [
      { id: "box", solid: firstBox },
    ]);
    const secondSet = second.bodySet("bodies", [
      { id: "box", solid: secondBox },
    ]);
    const firstMaterial = first.material("first-material", {
      name: "First",
      massDensity: kgPerCubicMeter(1_000),
    });
    const secondMaterial = second.material("second-material", {
      name: "Second",
      massDensity: kgPerCubicMeter(2_000),
    });
    const firstPart = first.part("part", firstSet, {
      materialRef: firstMaterial,
    });
    const secondPart = second.part("part", secondSet, {
      materialRef: secondMaterial,
    });

    const ownerKey = Reflect.ownKeys(firstMaterial).find(
      (key) =>
        typeof key === "symbol" &&
        key.description === "InvariantCAD.DesignOwner",
    );
    expect(ownerKey).toBeDefined();
    if (ownerKey === undefined) return;
    const inertOwner = Reflect.get(
      firstMaterial,
      ownerKey,
    ) as DesignBuilder;
    expect(Reflect.get(firstPart, ownerKey)).toBe(inertOwner);
    inertOwner.parameter.scalar("escaped", scalar(2));
    inertOwner.box("injected", {
      size: [mm(9), mm(9), mm(9)],
    });

    expect(() => first.part("foreign-leaf", secondBox)).toThrow(
      /geometry|solid|design|owner|boundar/i,
    );
    expect(() => first.part("foreign-set", secondSet)).toThrow(
      /geometry|body.?set|design|owner|boundar/i,
    );
    expect(() =>
      first.part("foreign-material", firstBox, {
        materialRef: secondMaterial,
      }),
    ).toThrow(/material|design|owner|boundar/i);
    expect(() => first.output("foreign-output", secondPart)).toThrow(
      /part|output|design|owner|boundar/i,
    );
    expect(() =>
      first.configuration("foreign-part", (configuration) =>
        configuration.partMaterial(secondPart, firstMaterial),
      ),
    ).toThrow(/part|design|owner|boundar/i);
    expect(() =>
      first.configuration("foreign-material", (configuration) =>
        configuration.partMaterial(firstPart, secondMaterial),
      ),
    ).toThrow(/material|design|owner|boundar/i);

    const forgedPart = Object.create(PartRef.prototype) as PartRef;
    const forgedMaterial = Object.create(
      MaterialRef.prototype,
    ) as MaterialRef;
    expect(() => first.output("forged-output", forgedPart)).toThrow(
      /part|output|design|owner|boundar/i,
    );
    expect(() =>
      first.part("forged-material", firstBox, {
        materialRef: forgedMaterial,
      }),
    ).toThrow(/material|design|owner|boundar/i);
    expect(() =>
      first.configuration("forged-part", (configuration) =>
        configuration.partMaterial(forgedPart, firstMaterial),
      ),
    ).toThrow(/part|design|owner|boundar/i);

    const shared = first.part("shared", firstBox, {
      materialRef: firstMaterial,
    });
    first.output("part", firstPart);
    first.output("shared", shared);
    first.configuration("owned", (configuration) =>
      configuration.partMaterial(firstPart, firstMaterial),
    );
    const document = first.build();
    expect(document.outputs).toEqual({
      part: { node: "part", kind: "part" },
      shared: { node: "shared", kind: "part" },
    });
    expect(document.parameters).not.toHaveProperty("escaped");
    expect(document.nodes).not.toHaveProperty("injected");
  });

  it("uses captured collection and record intrinsics for staged state", () => {
    const first = stagedBodySetDesignV7("captured-first");
    const second = stagedBodySetDesignV7("captured-second");
    const box = first.box("box", {
      size: [mm(1), mm(2), mm(3)],
    });
    first.parameter.massDensity(
      "density",
      kgPerCubicMeter(1_000),
    );
    const foreignDensity = second.parameter.massDensity(
      "density",
      kgPerCubicMeter(9_000),
    );
    first.material("shared", {
      name: "First material",
      massDensity: kgPerCubicMeter(1_000),
    });
    const foreignMaterial = second.material("shared", {
      name: "Foreign material",
      massDensity: kgPerCubicMeter(9_000),
    });

    const weakSetHasDescriptor = Object.getOwnPropertyDescriptor(
      WeakSet.prototype,
      "has",
    );
    let foreignError: unknown;
    let foreignParameterError: unknown;
    try {
      Object.defineProperty(WeakSet.prototype, "has", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: () => true,
      });
      try {
        first.part("foreign", box, {
          materialRef: foreignMaterial,
        });
      } catch (error) {
        foreignError = error;
      }
      try {
        first.configuration("foreign-parameter", (configuration) =>
          configuration.parameter(
            foreignDensity,
            kgPerCubicMeter(2_000),
          ),
        );
      } catch (error) {
        foreignParameterError = error;
      }
    } finally {
      if (weakSetHasDescriptor !== undefined) {
        Object.defineProperty(
          WeakSet.prototype,
          "has",
          weakSetHasDescriptor,
        );
      }
    }
    expect(foreignError).toBeInstanceOf(TypeError);
    expect(foreignParameterError).toBeInstanceOf(TypeError);
    expect(first.build().nodes).not.toHaveProperty("foreign");
    expect(first.build().configurations).toBeUndefined();

    const hasOwnDescriptor = Object.getOwnPropertyDescriptor(
      Object,
      "hasOwn",
    );
    let duplicateError: unknown;
    let duplicateParameterError: unknown;
    try {
      Object.defineProperty(Object, "hasOwn", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: () => false,
      });
      try {
        first.material("shared", {
          name: "Overwrite attempt",
          massDensity: kgPerCubicMeter(2_000),
        });
      } catch (error) {
        duplicateError = error;
      }
      try {
        first.parameter.massDensity(
          "density",
          kgPerCubicMeter(2_000),
        );
      } catch (error) {
        duplicateParameterError = error;
      }
    } finally {
      if (hasOwnDescriptor !== undefined) {
        Object.defineProperty(Object, "hasOwn", hasOwnDescriptor);
      }
    }
    expect(duplicateError).toBeInstanceOf(TypeError);
    expect(duplicateParameterError).toBeInstanceOf(TypeError);
    expect(first.build().materials?.[materialId("shared")]?.name).toBe(
      "First material",
    );

    const setHasDescriptor = Object.getOwnPropertyDescriptor(
      Set.prototype,
      "has",
    );
    let duplicateMemberError: unknown;
    try {
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: () => false,
      });
      try {
        first.bodySet("duplicates", [
          { id: "same", solid: box },
          { id: "same", solid: box },
        ]);
      } catch (error) {
        duplicateMemberError = error;
      }
    } finally {
      if (setHasDescriptor !== undefined) {
        Object.defineProperty(
          Set.prototype,
          "has",
          setHasDescriptor,
        );
      }
    }
    expect(duplicateMemberError).toBeInstanceOf(TypeError);
    expect(first.build().nodes).not.toHaveProperty("duplicates");

    const weakSetAddDescriptor = Object.getOwnPropertyDescriptor(
      WeakSet.prototype,
      "add",
    );
    let capturedMaterial: MaterialRef | undefined;
    try {
      Object.defineProperty(WeakSet.prototype, "add", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: () => {
          throw new Error("ambient WeakSet.add must not run");
        },
      });
      capturedMaterial = first.material("captured-add", {
        name: "Captured add",
        massDensity: kgPerCubicMeter(3_000),
      });
    } finally {
      if (weakSetAddDescriptor !== undefined) {
        Object.defineProperty(
          WeakSet.prototype,
          "add",
          weakSetAddDescriptor,
        );
      }
    }
    expect(capturedMaterial).toBeInstanceOf(MaterialRef);
    expect(
      first.build().materials?.[materialId("captured-add")]?.name,
    ).toBe("Captured add");

    const freezeDescriptor = Object.getOwnPropertyDescriptor(
      Object,
      "freeze",
    );
    let capturedParameter:
      | ReturnType<typeof first.parameter.length>
      | undefined;
    let frozenMaterial: MaterialRef | undefined;
    let frozenPart: PartRef | undefined;
    try {
      Object.defineProperty(Object, "freeze", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: <T,>(value: T): T => value,
      });
      capturedParameter = first.parameter.length(
        "captured-freeze",
        mm(4),
      );
      frozenMaterial = first.material("captured-freeze", {
        name: "Captured freeze",
        massDensity: kgPerCubicMeter(4_000),
      });
      frozenPart = first.part("captured-freeze", box, {
        materialRef: frozenMaterial,
      });
    } finally {
      if (freezeDescriptor !== undefined) {
        Object.defineProperty(Object, "freeze", freezeDescriptor);
      }
    }
    expect(Object.isFrozen(capturedParameter)).toBe(true);
    expect(Object.isFrozen(frozenMaterial)).toBe(true);
    expect(Object.isFrozen(frozenPart)).toBe(true);
  });

  it("does not dispatch through mutable part or material prototypes", () => {
    const cad = stagedBodySetDesignV7("prototype-integrity");
    const box = cad.box("box", {
      size: [mm(1), mm(2), mm(3)],
    });
    const material = cad.material("material", {
      name: "Fixture",
      massDensity: kgPerCubicMeter(1_000),
    });
    const configuredMaterial = cad.material("configured", {
      name: "Configured",
      massDensity: kgPerCubicMeter(2_000),
    });
    const toIRDescriptor = Object.getOwnPropertyDescriptor(
      PartRef.prototype,
      "toIR",
    );
    const materialIdDescriptor = Object.getOwnPropertyDescriptor(
      MaterialRef.prototype,
      "id",
    );
    let toIRCalls = 0;
    let materialPrototypeReads = 0;
    try {
      Object.defineProperty(PartRef.prototype, "toIR", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: () => {
          toIRCalls += 1;
          return { node: "redirected", kind: "part" };
        },
      });
      Object.defineProperty(MaterialRef.prototype, "id", {
        configurable: true,
        enumerable: false,
        get() {
          materialPrototypeReads += 1;
          return "redirected";
        },
      });

      const part = cad.part("part", box, { materialRef: material });
      cad.configuration("configured", (configuration) =>
        configuration.partMaterial(part, configuredMaterial),
      );
      cad.output("result", part);
      const document = cad.build();
      expect(document.nodes[nodeId("part")]).toEqual({
        kind: "part",
        geometry: { node: "box", kind: "solid" },
        materialId: "material",
      });
      expect(
        document.configurations?.[configurationId("configured")],
      ).toEqual({
        partMaterialOverrides: { part: "configured" },
      });
      expect(document.outputs).toEqual({
        result: { node: "part", kind: "part" },
      });
      expect(toIRCalls).toBe(0);
      expect(materialPrototypeReads).toBe(0);
    } finally {
      if (toIRDescriptor === undefined) {
        Reflect.deleteProperty(PartRef.prototype, "toIR");
      } else {
        Object.defineProperty(
          PartRef.prototype,
          "toIR",
          toIRDescriptor,
        );
      }
      if (materialIdDescriptor === undefined) {
        Reflect.deleteProperty(MaterialRef.prototype, "id");
      } else {
        Object.defineProperty(
          MaterialRef.prototype,
          "id",
          materialIdDescriptor,
        );
      }
    }
  });

  it("rejects unknown, symbol, inherited, and accessor-backed options without invoking getters", () => {
    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("part-unknown");
      cad.part("part", box, { primary: true } as never);
    }, /part.*unsupported|unsupported.*primary/i);

    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("part-symbol");
      const options = {} as Record<PropertyKey, unknown>;
      Object.defineProperty(options, Symbol("part-option"), {
        enumerable: true,
        value: true,
      });
      cad.part("part", box, options as never);
    }, /part.*symbol|symbol.*part/i);

    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("part-inherited");
      const options = Object.create({
        partNumber: "INHERITED",
      }) as PartOptions;
      cad.part("part", box, options);
    }, /part.*plain record|plain record.*part/i);

    let partNumberReads = 0;
    const accessorPartOptions = Object.defineProperty({}, "partNumber", {
      enumerable: true,
      get() {
        partNumberReads += 1;
        return "ACCESSOR";
      },
    });
    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("part-accessor");
      cad.part("part", box, accessorPartOptions as never);
    }, /partNumber.*own data|part.*own data/i);
    expect(partNumberReads).toBe(0);

    let densityReads = 0;
    const accessorDensityOptions = Object.defineProperty(
      {},
      "massDensity",
      {
        enumerable: true,
        get() {
          densityReads += 1;
          return kgPerCubicMeter(1_000);
        },
      },
    );
    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("density-accessor");
      cad.part("part", box, accessorDensityOptions as never);
    }, /massDensity.*own data|part.*own data/i);
    expect(densityReads).toBe(0);

    expectAuthoringFailure(() => {
      const { cad } = designWithBox("material-unknown");
      cad.material("material", {
        name: "Fixture",
        massDensity: kgPerCubicMeter(1_000),
        color: "silver",
      } as never);
    }, /material.*unsupported|unsupported.*color/i);

    expectAuthoringFailure(() => {
      const { cad } = designWithBox("material-symbol");
      const options = {
        name: "Fixture",
        massDensity: kgPerCubicMeter(1_000),
      } as Record<PropertyKey, unknown>;
      Object.defineProperty(options, Symbol("material-option"), {
        value: true,
      });
      cad.material("material", options as never);
    }, /material.*symbol|symbol.*material/i);

    expectAuthoringFailure(() => {
      const { cad } = designWithBox("material-inherited");
      const options = Object.create({
        name: "Inherited",
        massDensity: kgPerCubicMeter(1_000),
      }) as MaterialOptions;
      cad.material("material", options);
    }, /material.*plain record|plain record.*material/i);

    let materialNameReads = 0;
    const accessorMaterialOptions = {
      massDensity: kgPerCubicMeter(1_000),
    } as Record<string, unknown>;
    Object.defineProperty(accessorMaterialOptions, "name", {
      enumerable: true,
      get() {
        materialNameReads += 1;
        return "Accessor";
      },
    });
    expectAuthoringFailure(() => {
      const { cad } = designWithBox("material-accessor");
      cad.material("material", accessorMaterialOptions as never);
    }, /name.*own data|material.*own data/i);
    expect(materialNameReads).toBe(0);

    let metadataReads = 0;
    const metadata = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        metadataReads += 1;
        return "not-readable";
      },
    });
    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("metadata-accessor");
      cad.part("part", box, { metadata } as never);
    }, /metadata|accessor|data propert/i);
    expect(metadataReads).toBe(0);

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("parameter-unknown");
      cad.parameter.massDensity(
        "density",
        kgPerCubicMeter(1_000),
        { unit: "kg/m3" } as never,
      );
    }, /mass-density-parameter.*unsupported|unsupported.*unit/i);

    let parameterMinReads = 0;
    const parameterOptions = Object.defineProperty({}, "min", {
      enumerable: true,
      get() {
        parameterMinReads += 1;
        return kgPerCubicMeter(1);
      },
    });
    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("parameter-accessor");
      cad.parameter.massDensity(
        "density",
        kgPerCubicMeter(1_000),
        parameterOptions as never,
      );
    }, /min.*own data|parameter.*own data/i);
    expect(parameterMinReads).toBe(0);

    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("configuration-unknown");
      const part = cad.part("part", box);
      cad.configuration(
        "configured",
        (configuration) =>
          configuration.parameter(
            cad.parameter.length("width", mm(1)),
            mm(2),
          ),
        { effectivity: "all" } as never,
      );
      cad.output("part", part);
    }, /configuration.*unsupported|unsupported.*effectivity/i);

    let configurationDescriptionReads = 0;
    let configurationCallbackCalls = 0;
    const configurationOptions = Object.defineProperty(
      {},
      "description",
      {
        enumerable: true,
        get() {
          configurationDescriptionReads += 1;
          return "Accessor";
        },
      },
    );
    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("configuration-accessor");
      const width = cad.parameter.length("width", mm(1));
      cad.configuration(
        "configured",
        (configuration) => {
          configurationCallbackCalls += 1;
          configuration.parameter(width, mm(2));
        },
        configurationOptions as never,
      );
    }, /description.*own data|configuration.*own data/i);
    expect(configurationDescriptionReads).toBe(0);
    expect(configurationCallbackCalls).toBe(0);
  });

  it("enforces typed density and mutually exclusive material authoring without imposing value policy", () => {
    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("part-density-dimension");
      cad.part("part", box, { massDensity: mm(1) } as never);
    }, /part.*massDensity|mass-density expression/i);

    expectAuthoringFailure(() => {
      const { cad } = designWithBox("material-density-dimension");
      cad.material("material", {
        name: "Wrong dimension",
        massDensity: mm(1),
      } as never);
    }, /material.*massDensity|mass-density expression/i);

    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("exclusive-material");
      const material = cad.material("material", {
        name: "Fixture",
        massDensity: kgPerCubicMeter(1_000),
      });
      cad.part("part", box, {
        material: "Legacy label",
        materialRef: material,
      } as never);
    }, /both material and materialRef|cannot use both/i);

    const { cad, box } = designWithBox("density-value-policy");
    const zero = cad.material("zero", {
      name: "Zero-density structural fixture",
      massDensity: kgPerCubicMeter(0),
    });
    const materialPart = cad.part("material-part", box, {
      materialRef: zero,
    });
    const explicitPart = cad.part("explicit-part", box, {
      massDensity: kgPerCubicMeter(-1),
    });
    cad.output("material", materialPart);
    cad.output("explicit", explicitPart);
    const document = cad.build();
    expect(
      document.materials?.[materialId("zero")]?.massDensity,
    ).toEqual(
      kgPerCubicMeter(0).ir,
    );
    expect(document.nodes[nodeId("explicit-part")]).toMatchObject({
      massDensity: kgPerCubicMeter(-1).ir,
    });
  });

  it("rejects duplicate part identities and recovers after bounded build failure", () => {
    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("duplicate-node");
      cad.part("box", box);
    }, /duplicate.*feature|feature.*duplicate/i);

    expectAuthoringFailure(() => {
      const { cad } = designWithBox("duplicate-material");
      cad.material("material", {
        name: "First",
        massDensity: kgPerCubicMeter(1_000),
      });
      cad.material("material", {
        name: "Second",
        massDensity: kgPerCubicMeter(2_000),
      });
    }, /duplicate.*material|material.*duplicate/i);

    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("duplicate-output");
      const first = cad.part("first", box);
      const second = cad.part("second", box);
      cad.output("result", first);
      cad.output("result", second);
    }, /duplicate.*output|output.*duplicate/i);

    expectAuthoringFailure(() => {
      const { cad, box } = designWithBox("duplicate-override");
      const first = cad.material("first", {
        name: "First",
        massDensity: kgPerCubicMeter(1_000),
      });
      const second = cad.material("second", {
        name: "Second",
        massDensity: kgPerCubicMeter(2_000),
      });
      const part = cad.part("part", box, { materialRef: first });
      cad.configuration("duplicate", (configuration) => {
        configuration.partMaterial(part, first);
        configuration.partMaterial(part, second);
      });
    }, /duplicate.*material override|material override.*duplicate/i);

    const { cad, box } = designWithBox("bounded-build");
    const material = cad.material("material", {
      name: "Fixture",
      massDensity: kgPerCubicMeter(1_000),
    });
    const part = cad.part("part", box, { materialRef: material });
    cad.output("result", part);
    let boundedError: unknown;
    try {
      cad.build({ limits: { maxStructuralValues: 0 } });
    } catch (error) {
      boundedError = error;
    }
    expect(boundedError).toBeInstanceOf(CadError);
    expect((boundedError as CadError).diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "IR_INVALID",
          details: expect.objectContaining({
            resource: "maxStructuralValues",
          }),
        }),
      ]),
    );
    const recovered = cad.build();
    expect(recovered.nodes[nodeId("part")]).toEqual({
      kind: "part",
      geometry: { node: "box", kind: "solid" },
      materialId: "material",
    });
    expect(recovered.outputs).toEqual({
      result: { node: "part", kind: "part" },
    });
  });

  it("keeps package-root part authoring and document aliases on v6", () => {
    const cad = publicApi.design("public-v6-part");
    const material = cad.material("material", {
      name: "Fixture",
      massDensity: publicApi.kgPerCubicMeter(1_000),
    });
    const box = cad.box("box", {
      size: [publicApi.mm(1), publicApi.mm(2), publicApi.mm(3)],
    });
    const part = cad.part("part", box, {
      partNumber: "PUBLIC-V6",
      materialRef: material,
    });
    cad.output("part", part);
    const document: publicApi.DesignDocument = cad.build();

    expect(publicApi.DOCUMENT_VERSION).toBe(6);
    expect(publicApi.DOCUMENT_SCHEMA).toBe(publicApi.DOCUMENT_SCHEMA_V6);
    expect(document.version).toBe(6);
    expect(document.nodes[nodeId("part")]).toEqual({
      kind: "part",
      solid: { node: "box", kind: "solid" },
      partNumber: "PUBLIC-V6",
      materialId: "material",
    });
    expect("geometry" in document.nodes[nodeId("part")]!).toBe(false);
    expect(publicApi.DesignDocumentSchema.safeParse(document).success).toBe(
      true,
    );
    expect("DOCUMENT_VERSION_V7" in publicApi).toBe(false);
    expect("DesignDocumentV7Schema" in publicApi).toBe(false);
    expect("stagedBodySetDesignV7" in publicApi).toBe(false);
    expect("evaluatePartOutputsV7" in publicApi).toBe(false);
  });
});
