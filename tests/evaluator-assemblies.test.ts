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
      const beforePositions = first.assembly.mesh().positions;
      expect(before.centerOfMass![0]).toBeCloseTo(30, 8);
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
      expect(first.assembly.mesh().positions).toEqual(beforePositions);
    } finally {
      first.design.dispose();
    }

    const second = await evaluatePair(50);
    try {
      expect(
        second.assembly.instances.map((item) => item.transform[12]),
      ).toEqual([0, 50]);
      expect(second.assembly.measure().centerOfMass![0]).toBeCloseTo(30, 8);
    } finally {
      second.design.dispose();
    }
  });
});

function fanOutDocument(levels: number, fanOut = 2): DesignDocument {
  const cad = design("occurrence-fan-out");
  const part = cad.part(
    "part",
    cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) }),
  );
  let current = cad.assembly("a0", (instances) => {
    for (let index = 0; index < fanOut; index += 1) {
      instances.instance(`i${index}`, part, {
        placement: [tf.translate(vec3(mm(index * 2), mm(0), mm(0)))],
      });
    }
  });
  for (let level = 1; level < levels; level += 1) {
    const child = current;
    current = cad.assembly(`a${level}`, (instances) => {
      for (let index = 0; index < fanOut; index += 1) {
        instances.instance(`i${index}`, child);
      }
    });
  }
  cad.output("top", current);
  return cad.build();
}

function nestedChainDocument(levels: number): DesignDocument {
  const cad = design("deep-assembly");
  const part = cad.part(
    "part",
    cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) }),
  );
  let current = cad.assembly("a0", (instances) => {
    instances.instance("leaf", part);
  });
  for (let level = 1; level < levels; level += 1) {
    const child = current;
    current = cad.assembly(`a${level}`, (instances) => {
      instances.instance("child", child);
    });
  }
  cad.output("top", current);
  return cad.build();
}

describe("public assembly evaluation ceilings", () => {
  it("evaluates a fan-out within the occurrence ceiling", async () => {
    // 2 + 4 + ... + 32768 = 65,534 materialized occurrence records. One more
    // level needs 131,070, which the next test rejects.
    const result = await evaluator.evaluate(fanOutDocument(15));
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    try {
      const top = result.value.output("top") as EvaluatedAssembly;
      expect(top.instances).toHaveLength(32_768);
      expect(top.instances.at(-1)!.id).toBe(
        Array.from({ length: 15 }, () => "i1").join("/"),
      );
    } finally {
      result.value.dispose();
    }
  });

  it("rejects a wide fan-out over 100,000 occurrence records before flattening it", async () => {
    // a0 holds 400 parts; each of a1's instances copies those 400 records.
    // After 249 copies the evaluation holds 400 + 249 * 400 = 100,000.
    const result = await evaluator.evaluate(fanOutDocument(2, 400));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "RESOURCE_LIMIT_EXCEEDED",
        severity: "error",
        node: "a1",
        path: "/nodes/a1/instances/249",
        details: {
          resource: "maxActiveOccurrences",
          limit: 100_000,
          actual: 100_400,
        },
      }),
    ]);
  });

  it.each([16, 18, 20])(
    "rejects a %i-level binary fan-out with a limit diagnostic, not KERNEL_ERROR",
    async (levels) => {
      // Through a14 the evaluation stores 917,506 path segments; a15's first
      // copy adds 16 * 32,768 more.
      const result = await evaluator.evaluate(fanOutDocument(levels));
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: "RESOURCE_LIMIT_EXCEEDED",
          severity: "error",
          node: "a15",
          path: "/nodes/a15/instances/0",
          details: {
            resource: "maxOccurrencePathSegments",
            limit: 1_000_000,
            actual: 1_441_794,
          },
        }),
      ]);
    },
  );

  it("rejects assemblies nested deeper than 64 levels", async () => {
    const accepted = await evaluator.evaluate(nestedChainDocument(64));
    expect(accepted.ok, JSON.stringify(accepted.diagnostics)).toBe(true);
    if (accepted.ok) {
      expect(
        (accepted.value.output("top") as EvaluatedAssembly).instances[0]!.id
          .split("/"),
      ).toHaveLength(64);
      accepted.value.dispose();
    }

    // The 65th nested assembly is reached from a1 when evaluation descends
    // from a64, so the reference that would exceed the ceiling is a1's.
    for (const levels of [65, 5_000]) {
      const rejected = await evaluator.evaluate(nestedChainDocument(levels));
      expect(rejected.ok).toBe(false);
      const deepest = levels - 64;
      expect(rejected.diagnostics).toEqual([
        expect.objectContaining({
          code: "RESOURCE_LIMIT_EXCEEDED",
          node: `a${deepest}`,
          path: `/nodes/a${deepest}/instances/0/component`,
          details: {
            resource: "maxAssemblyDepth",
            limit: 64,
            actual: 65,
          },
        }),
      ]);
    }
  });

  it("counts the depth of an already evaluated subassembly", async () => {
    // Selecting a63 first caches the 64-deep chain; a64 then reuses it.
    const document = nestedChainDocument(65);
    const cad = structuredClone(document) as DesignDocument;
    (cad.outputs as Record<string, unknown>).inner = {
      node: "a63",
      kind: "assembly",
    };
    const result = await evaluator.evaluate(cad, {
      outputs: ["inner", "top"],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "RESOURCE_LIMIT_EXCEEDED",
        node: "a64",
        path: "/nodes/a64/instances/0/component",
        details: {
          resource: "maxAssemblyDepth",
          limit: 64,
          actual: 65,
        },
      }),
    ]);
  });

  it("bounds the stored occurrence path segments", async () => {
    // A 40-deep chain whose leaf assembly holds 1,000 parts flattens to
    // 40,000 occurrence records but 1,000 * (1 + 2 + ... + 40) = 820,000 path
    // segments; a 45-deep chain needs 1,035,000.
    const chain = (levels: number) => {
      const cad = design("path-segments");
      const part = cad.part(
        "part",
        cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) }),
      );
      let current = cad.assembly("a0", (instances) => {
        for (let index = 0; index < 1_000; index += 1) {
          instances.instance(`p${index}`, part);
        }
      });
      for (let level = 1; level < levels; level += 1) {
        const child = current;
        current = cad.assembly(`a${level}`, (instances) => {
          instances.instance("child", child);
        });
      }
      cad.output("top", current);
      return cad.build();
    };
    const accepted = await evaluator.evaluate(chain(40));
    expect(accepted.ok, JSON.stringify(accepted.diagnostics)).toBe(true);
    if (accepted.ok) accepted.value.dispose();
    const rejected = await evaluator.evaluate(chain(45));
    expect(rejected.ok).toBe(false);
    expect(rejected.diagnostics).toEqual([
      expect.objectContaining({
        code: "RESOURCE_LIMIT_EXCEEDED",
        details: expect.objectContaining({
          resource: "maxOccurrencePathSegments",
          limit: 1_000_000,
        }),
      }),
    ]);
  });
});
