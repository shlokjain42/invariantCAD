import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvaluatedAssembly,
  EvaluatedPart,
  createEvaluator,
  design,
  kgPerCubicMeter,
  kgPerCubicMillimeter,
  mm,
  scalarVec3,
  tf,
  vec3,
  type CadResult,
  type DesignDocument,
  type EvaluatedDesign,
  type Evaluator,
  type PhysicalMassProperties,
  type Vec3,
} from "../src/index.js";

let evaluator: Evaluator;

beforeAll(async () => {
  evaluator = await createEvaluator();
});

afterAll(() => {
  evaluator.dispose();
});

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

function physicalValue(
  result: CadResult<PhysicalMassProperties>,
): PhysicalMassProperties {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected physical mass properties");
  expect(result.diagnostics).toEqual([]);
  return result.value;
}

function expectClose(actual: number, expected: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    Math.max(1e-15, Math.abs(expected) * 2e-10),
  );
}

function expectVectorClose(actual: Vec3 | null, expected: Vec3 | null): void {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  for (let axis = 0; axis < 3; axis += 1) {
    expectClose(actual![axis]!, expected[axis]!);
  }
}

function expectPhysicalProperties(
  actual: PhysicalMassProperties,
  expected: PhysicalMassProperties,
): void {
  expectClose(actual.mass, expected.mass);
  expectVectorClose(actual.centerOfMass, expected.centerOfMass);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      expectClose(
        actual.inertiaTensor[row]![column]!,
        expected.inertiaTensor[row]![column]!,
      );
    }
  }
}

const BOX_DENSITY_ONE_THOUSAND = {
  mass: 48e-6,
  centerOfMass: [1, 2, 3],
  inertiaTensor: [
    [208e-6, 0, 0],
    [0, 160e-6, 0],
    [0, 0, 80e-6],
  ],
} as const satisfies PhysicalMassProperties;

describe("evaluated physical mass properties", () => {
  it("converts an authored part density into kg and kg*mm^2", async () => {
    const cad = design("physical-part");
    const solid = cad.box("solid", { size: vec3(mm(2), mm(4), mm(6)) });
    const part = cad.part("part", solid, {
      material: "fixture-1000",
      massDensity: kgPerCubicMeter(1_000),
    });
    cad.output("part", part);

    const result = await evaluate(cad.build());
    try {
      const output = result.output("part");
      expect(output).toBeInstanceOf(EvaluatedPart);
      if (!(output instanceof EvaluatedPart)) return;
      expectPhysicalProperties(
        physicalValue(output.physicalMassProperties()),
        BOX_DENSITY_ONE_THOUSAND,
      );
      expect(output.material).toBe("fixture-1000");
    } finally {
      result.dispose();
    }
  });

  it("keeps different densities on part definitions that share one solid", async () => {
    const cad = design("shared-solid-densities");
    const solid = cad.box("solid", { size: vec3(mm(2), mm(4), mm(6)) });
    const light = cad.part("light", solid, {
      massDensity: kgPerCubicMeter(1_000),
    });
    const heavy = cad.part("heavy", solid, {
      massDensity: kgPerCubicMeter(3_000),
    });
    cad.output("light", light).output("heavy", heavy);

    const result = await evaluate(cad.build());
    try {
      const lightOutput = result.output("light");
      const heavyOutput = result.output("heavy");
      expect(lightOutput).toBeInstanceOf(EvaluatedPart);
      expect(heavyOutput).toBeInstanceOf(EvaluatedPart);
      if (
        !(lightOutput instanceof EvaluatedPart) ||
        !(heavyOutput instanceof EvaluatedPart)
      ) {
        return;
      }
      const lightProperties = physicalValue(
        lightOutput.physicalMassProperties(),
      );
      const heavyProperties = physicalValue(
        heavyOutput.physicalMassProperties(),
      );
      expectPhysicalProperties(lightProperties, BOX_DENSITY_ONE_THOUSAND);
      expectPhysicalProperties(heavyProperties, {
        mass: 144e-6,
        centerOfMass: [1, 2, 3],
        inertiaTensor: [
          [624e-6, 0, 0],
          [0, 480e-6, 0],
          [0, 0, 240e-6],
        ],
      });
    } finally {
      result.dispose();
    }
  });

  it("mass-weights a heterogeneous translated assembly", async () => {
    const cad = design("heterogeneous-assembly");
    const solid = cad.box("solid", { size: vec3(mm(2), mm(4), mm(6)) });
    const light = cad.part("light", solid, {
      massDensity: kgPerCubicMeter(1_000),
    });
    const heavy = cad.part("heavy", solid, {
      massDensity: kgPerCubicMeter(3_000),
    });
    const assembly = cad.assembly("assembly", (instances) => {
      instances.instance("light", light);
      instances.instance("heavy", heavy, {
        placement: [tf.translate(vec3(mm(10), mm(0), mm(0)))],
      });
    });
    cad.output("assembly", assembly);

    const result = await evaluate(cad.build());
    try {
      const output = result.output("assembly");
      expect(output).toBeInstanceOf(EvaluatedAssembly);
      if (!(output instanceof EvaluatedAssembly)) return;
      expectPhysicalProperties(
        physicalValue(output.physicalMassProperties()),
        {
          mass: 192e-6,
          centerOfMass: [8.5, 2, 3],
          inertiaTensor: [
            [832e-6, 0, 0],
            [0, 4_240e-6, 0],
            [0, 0, 3_920e-6],
          ],
        },
      );

      // Geometry remains volume-weighted and therefore has a different center.
      expectVectorClose(output.measure().centerOfMass, [6, 2, 3]);
    } finally {
      result.dispose();
    }
  });

  it("composes nested placements and reports full missing-density leaf paths", async () => {
    const cad = design("nested-physical-assembly");
    const solid = cad.box("solid", { size: vec3(mm(2), mm(4), mm(6)) });
    const dense = cad.part("dense", solid, {
      massDensity: kgPerCubicMeter(1_000),
    });
    const missing = cad.part("missing", solid);
    const nestedDense = cad.assembly("nested-dense", (instances) => {
      instances.instance("nested-part", dense, {
        placement: [tf.translate(vec3(mm(10), mm(0), mm(0)))],
      });
    });
    const nestedMissing = cad.assembly("nested-missing", (instances) => {
      instances.instance("missing-leaf", missing);
    });
    const valid = cad.assembly("valid", (instances) => {
      instances.instance("root-part", dense);
      instances.instance("sub", nestedDense, {
        placement: [tf.translate(vec3(mm(0), mm(20), mm(0)))],
      });
    });
    const invalid = cad.assembly("invalid", (instances) => {
      instances.instance("sub", nestedMissing);
    });
    cad.output("valid", valid).output("invalid", invalid);

    const result = await evaluate(cad.build());
    try {
      const validOutput = result.output("valid");
      const invalidOutput = result.output("invalid");
      expect(validOutput).toBeInstanceOf(EvaluatedAssembly);
      expect(invalidOutput).toBeInstanceOf(EvaluatedAssembly);
      if (
        !(validOutput instanceof EvaluatedAssembly) ||
        !(invalidOutput instanceof EvaluatedAssembly)
      ) {
        return;
      }
      expectPhysicalProperties(
        physicalValue(validOutput.physicalMassProperties()),
        {
          mass: 96e-6,
          centerOfMass: [6, 12, 3],
          inertiaTensor: [
            [10_016e-6, -4_800e-6, 0],
            [-4_800e-6, 2_720e-6, 0],
            [0, 0, 12_160e-6],
          ],
        },
      );
      expect(validOutput.instances.map((instance) => instance.id)).toEqual([
        "root-part",
        "sub/nested-part",
      ]);

      const missingResult = invalidOutput.physicalMassProperties();
      expect(missingResult.ok).toBe(false);
      if (missingResult.ok) return;
      expect(missingResult.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "MASS_DENSITY_MISSING",
          path: "/outputs/invalid",
          related: [
            expect.objectContaining({
              node: "missing",
              path: "/nodes/missing/massDensity",
            }),
          ],
          details: expect.objectContaining({
            occurrenceIds: ["sub/missing-leaf"],
          }),
        }),
      );
    } finally {
      result.dispose();
    }
  });

  it("ignores suppressed missing-density occurrences but diagnoses live ones", async () => {
    const cad = design("missing-density-assembly");
    const solid = cad.box("solid", { size: vec3(mm(2), mm(4), mm(6)) });
    const dense = cad.part("dense", solid, {
      massDensity: kgPerCubicMeter(1_000),
    });
    const missing = cad.part("missing", solid);
    const safe = cad.assembly("safe", (instances) => {
      instances.instance("dense", dense);
      instances.instance("suppressed-missing", missing, { suppressed: true });
    });
    const invalid = cad.assembly("invalid", (instances) => {
      instances.instance("dense", dense);
      instances.instance("live-missing", missing);
    });
    cad.output("safe", safe).output("invalid", invalid).output("missing", missing);

    const result = await evaluate(cad.build());
    try {
      const safeOutput = result.output("safe");
      const invalidOutput = result.output("invalid");
      const missingOutput = result.output("missing");
      expect(safeOutput).toBeInstanceOf(EvaluatedAssembly);
      expect(invalidOutput).toBeInstanceOf(EvaluatedAssembly);
      expect(missingOutput).toBeInstanceOf(EvaluatedPart);
      if (
        !(safeOutput instanceof EvaluatedAssembly) ||
        !(invalidOutput instanceof EvaluatedAssembly) ||
        !(missingOutput instanceof EvaluatedPart)
      ) {
        return;
      }

      expectPhysicalProperties(
        physicalValue(safeOutput.physicalMassProperties()),
        BOX_DENSITY_ONE_THOUSAND,
      );
      for (const failure of [
        invalidOutput.physicalMassProperties(),
        missingOutput.physicalMassProperties(),
      ]) {
        expect(failure.ok).toBe(false);
        if (failure.ok) continue;
        expect(failure.diagnostics.some((item) => item.code === "MASS_DENSITY_MISSING")).toBe(
          true,
        );
      }
    } finally {
      result.dispose();
    }
  });

  it("returns canonical zero physical properties for an empty assembly", async () => {
    const cad = design("empty-assembly");
    const assembly = cad.assembly("assembly", () => {});
    cad.output("assembly", assembly);

    const result = await evaluate(cad.build());
    try {
      const output = result.output("assembly");
      expect(output).toBeInstanceOf(EvaluatedAssembly);
      if (!(output instanceof EvaluatedAssembly)) return;
      expect(physicalValue(output.physicalMassProperties())).toEqual({
        mass: 0,
        centerOfMass: null,
        inertiaTensor: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
      });
    } finally {
      result.dispose();
    }
  });

  it("applies nonuniform scale and reflection to occurrence properties", async () => {
    const cad = design("affine-physical-assembly");
    const solid = cad.box("solid", { size: vec3(mm(2), mm(4), mm(6)) });
    const part = cad.part("part", solid, {
      massDensity: kgPerCubicMeter(1_000),
    });
    const scaled = cad.assembly("scaled", (instances) => {
      instances.instance("part", part, {
        placement: [tf.scale(scalarVec3(2, 0.5, 3))],
      });
    });
    const mirrored = cad.assembly("mirrored", (instances) => {
      instances.instance("part", part, {
        placement: [
          tf.mirror(scalarVec3(1, 0, 0)),
          tf.translate(vec3(mm(4), mm(0), mm(0))),
        ],
      });
    });
    cad.output("scaled", scaled).output("mirrored", mirrored);

    const result = await evaluate(cad.build());
    try {
      const scaledOutput = result.output("scaled");
      const mirroredOutput = result.output("mirrored");
      expect(scaledOutput).toBeInstanceOf(EvaluatedAssembly);
      expect(mirroredOutput).toBeInstanceOf(EvaluatedAssembly);
      if (
        !(scaledOutput instanceof EvaluatedAssembly) ||
        !(mirroredOutput instanceof EvaluatedAssembly)
      ) {
        return;
      }
      expectPhysicalProperties(
        physicalValue(scaledOutput.physicalMassProperties()),
        {
          mass: 144e-6,
          centerOfMass: [2, 1, 9],
          inertiaTensor: [
            [3_936e-6, 0, 0],
            [0, 4_080e-6, 0],
            [0, 0, 240e-6],
          ],
        },
      );
      expectPhysicalProperties(
        physicalValue(mirroredOutput.physicalMassProperties()),
        {
          ...BOX_DENSITY_ONE_THOUSAND,
          centerOfMass: [3, 2, 3],
        },
      );
    } finally {
      result.dispose();
    }
  });

  it("resolves parameter overrides in base kg/mm^3 units", async () => {
    const cad = design("parameterized-density");
    const density = cad.parameter.massDensity(
      "density",
      kgPerCubicMeter(1_000),
      { min: kgPerCubicMeter(1) },
    );
    const solid = cad.box("solid", { size: vec3(mm(2), mm(4), mm(6)) });
    const part = cad.part("part", solid, { massDensity: density });
    cad.output("part", part);
    const document = cad.build();

    const baseResult = await evaluate(document);
    const overriddenResult = await evaluate(document, { density: 3e-6 });
    try {
      const base = baseResult.output("part");
      const overridden = overriddenResult.output("part");
      expect(base).toBeInstanceOf(EvaluatedPart);
      expect(overridden).toBeInstanceOf(EvaluatedPart);
      if (!(base instanceof EvaluatedPart) || !(overridden instanceof EvaluatedPart)) {
        return;
      }
      expectClose(
        physicalValue(base.physicalMassProperties()).mass,
        48e-6,
      );
      expectClose(
        physicalValue(overridden.physicalMassProperties()).mass,
        144e-6,
      );
    } finally {
      baseResult.dispose();
      overriddenResult.dispose();
    }
  });

  it("rejects non-positive and non-finite resolved density", async () => {
    const parameterized = design("invalid-density-parameter");
    const density = parameterized.parameter.massDensity(
      "density",
      kgPerCubicMeter(1_000),
    );
    const parameterizedSolid = parameterized.box("solid", {
      size: vec3(mm(2), mm(4), mm(6)),
    });
    parameterized.output(
      "part",
      parameterized.part("part", parameterizedSolid, { massDensity: density }),
    );

    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await evaluator.evaluate(parameterized.build(), {
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

    const direct = design("invalid-direct-density");
    const directSolid = direct.box("solid", {
      size: vec3(mm(2), mm(4), mm(6)),
    });
    direct.output(
      "part",
      direct.part("part", directSolid, {
        massDensity: kgPerCubicMillimeter(Number.MAX_VALUE).mul(
          Number.MAX_VALUE,
        ),
      }),
    );
    const directResult = await evaluator.evaluate(direct.build());
    expect(directResult.ok).toBe(false);
    if (directResult.ok) {
      directResult.value.dispose();
    } else {
      expect(directResult.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "MASS_DENSITY_INVALID",
          path: "/nodes/part/massDensity",
        }),
      );
    }

    const bounded = design("invalid-density-bound");
    const boundedDensity = bounded.parameter.massDensity(
      "density",
      kgPerCubicMeter(1_000),
      {
        min: kgPerCubicMillimeter(Number.MAX_VALUE).mul(Number.MAX_VALUE),
      },
    );
    const boundedSolid = bounded.box("solid", {
      size: vec3(mm(2), mm(4), mm(6)),
    });
    bounded.output(
      "part",
      bounded.part("part", boundedSolid, { massDensity: boundedDensity }),
    );
    const boundedResult = await evaluator.evaluate(bounded.build());
    expect(boundedResult.ok).toBe(false);
    if (boundedResult.ok) {
      boundedResult.value.dispose();
    } else {
      expect(boundedResult.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "MASS_DENSITY_INVALID",
          path: "/parameters/density/min",
        }),
      );
    }
  });

  it("returns structured failures when finite density overflows physical results", async () => {
    const cad = design("physical-overflow");
    const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });
    const part = cad.part("part", solid, {
      massDensity: kgPerCubicMillimeter(Number.MAX_VALUE),
    });
    const assembly = cad.assembly("assembly", (instances) => {
      instances.instance("part", part);
    });
    cad.output("part", part).output("assembly", assembly);

    const result = await evaluate(cad.build());
    try {
      for (const name of ["part", "assembly"] as const) {
        const output = result.output(name);
        if (
          !(output instanceof EvaluatedPart) &&
          !(output instanceof EvaluatedAssembly)
        ) {
          throw new Error(`Expected '${name}' to expose physical properties`);
        }
        expect(() => output.physicalMassProperties()).not.toThrow();
        const physical = output.physicalMassProperties();
        expect(physical.ok).toBe(false);
        if (physical.ok) continue;
        expect(physical.diagnostics).toContainEqual(
          expect.objectContaining({ code: "MASS_PROPERTIES_INVALID" }),
        );
      }
    } finally {
      result.dispose();
    }
  });

  it("is deterministic across calls and enforces evaluation ownership", async () => {
    const cad = design("physical-lifecycle");
    const solid = cad.box("solid", { size: vec3(mm(2), mm(4), mm(6)) });
    const part = cad.part("part", solid, {
      massDensity: kgPerCubicMeter(1_000),
    });
    cad.output("part", part);

    const result = await evaluate(cad.build());
    const output = result.output("part");
    expect(output).toBeInstanceOf(EvaluatedPart);
    if (!(output instanceof EvaluatedPart)) {
      result.dispose();
      return;
    }
    const first = output.physicalMassProperties();
    const second = output.physicalMassProperties();
    expect(second).toEqual(first);
    expectPhysicalProperties(physicalValue(first), BOX_DENSITY_ONE_THOUSAND);

    result.dispose();
    expect(() => output.physicalMassProperties()).toThrowError(/disposed/i);
    expect(() => result.output("part")).toThrowError(/disposed/i);
  });
});
