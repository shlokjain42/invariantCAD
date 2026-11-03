import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDENTITY_MATRIX } from "../src/core/math.js";
import {
  EvaluatedAssembly,
  createEvaluator,
  design,
  mm,
  tf,
  vec3,
  type DesignDocument,
  type Evaluator,
} from "../src/index.js";

let evaluator: Evaluator;

beforeAll(async () => {
  evaluator = await createEvaluator();
});

afterAll(() => {
  evaluator.dispose();
});

function placedPair(offset: number): DesignDocument {
  const cad = design("placed-pair");
  const part = cad.part(
    "part",
    cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) }),
  );
  cad.output(
    "pair",
    cad.assembly("pair", (instances) => {
      instances.instance("origin", part);
      instances.instance("offset", part, {
        placement: [tf.translate(vec3(mm(offset), mm(0), mm(0)))],
      });
    }),
  );
  return cad.build();
}

async function evaluatePair(offset: number) {
  const result = await evaluator.evaluate(placedPair(offset));
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("evaluation failed");
  const output = result.value.output("pair");
  expect(output).toBeInstanceOf(EvaluatedAssembly);
  return { design: result.value, assembly: output as EvaluatedAssembly };
}

describe("evaluated assembly occurrence transforms", () => {
  it("keeps the shared identity matrix immutable", () => {
    expect(Object.isFrozen(IDENTITY_MATRIX)).toBe(true);
    expect(() => {
      (IDENTITY_MATRIX as unknown as number[])[12] = 1000;
    }).toThrow(TypeError);
    expect(IDENTITY_MATRIX[12]).toBe(0);
  });

  it("exposes detached frozen transforms that cannot corrupt results", async () => {
    const first = await evaluatePair(50);
    try {
      const before = first.assembly.measure();
      expect(before.centerOfMass[0]).toBeCloseTo(30, 8);
      for (const instance of first.assembly.instances) {
        expect(Object.isFrozen(instance.transform)).toBe(true);
        expect(instance.transform).not.toBe(IDENTITY_MATRIX);
        expect(
          Reflect.set(instance.transform as unknown as number[], 12, 1000),
        ).toBe(false);
        expect(() => {
          (instance.transform as unknown as number[])[12] = 1000;
        }).toThrow(TypeError);
      }
      expect(first.assembly.instances.map((item) => item.transform[12])).toEqual(
        [0, 50],
      );
      expect(first.assembly.measure().centerOfMass).toEqual(before.centerOfMass);
      expect(first.assembly.mesh().positions).toEqual(
        first.assembly.mesh().positions,
      );
    } finally {
      first.design.dispose();
    }

    const second = await evaluatePair(50);
    try {
      expect(
        second.assembly.instances.map((item) => item.transform[12]),
      ).toEqual([0, 50]);
      expect(second.assembly.measure().centerOfMass[0]).toBeCloseTo(30, 8);
    } finally {
      second.design.dispose();
    }
  });
});
