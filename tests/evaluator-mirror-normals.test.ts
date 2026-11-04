import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unitVector3 } from "../src/core/math.js";
import type { ExpressionIR } from "../src/expressions.js";
import {
  EvaluatedAssembly,
  EvaluatedSolid,
  createEvaluator,
  design,
  mm,
  scalar,
  scalarVec3,
  tf,
  vec3,
  type CadResult,
  type Evaluator,
  type GeometryKernel,
  type ResolvedTransformOperation,
} from "../src/index.js";
import { evaluateBodySetOutputsV7 } from "../src/evaluator.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type DesignDocumentV7,
} from "../src/ir.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import { evaluateLocalAssemblyOutputsV7 } from "../src/internal/document-v7-local-assembly-evaluation.js";

const profiles = ["mesh-preview", "mechanical-exact"] as const;
const evaluators = new Map<(typeof profiles)[number], Evaluator>();

beforeAll(async () => {
  for (const profile of profiles) {
    evaluators.set(profile, await createEvaluator({ profile }));
  }
});

afterAll(() => {
  for (const evaluator of evaluators.values()) evaluator.dispose();
});

function mirroredBox(normal: number) {
  const cad = design("mirror-normal");
  const n = cad.parameter.scalar("n", scalar(normal));
  const box = cad.box("box", { size: vec3(mm(1), mm(2), mm(3)) });
  cad.output("mirrored", cad.mirror("mirrored", box, scalarVec3(n, 0, 0)));
  return cad.build();
}

function mirroredAssembly(normal: number) {
  const cad = design("mirror-placement");
  const n = cad.parameter.scalar("n", scalar(normal));
  const box = cad.box("box", { size: vec3(mm(1), mm(2), mm(3)) });
  const part = cad.part("part", box);
  cad.output(
    "assembly",
    cad.assembly("assembly", (instances) => {
      instances.instance("plain", part);
      instances.instance("mirrored", part, {
        placement: [
          tf.translate(vec3(mm(5), mm(0), mm(0))),
          tf.mirror(scalarVec3(n, 0, 0)),
        ],
      });
    }),
  );
  return cad.build();
}

function countingKernel(kernel: GeometryKernel): {
  readonly kernel: GeometryKernel;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const proxy = new Proxy(kernel, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        return (value as (...values: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { kernel: proxy, calls };
}

function failureOf<T extends { dispose(): void }>(result: CadResult<T>) {
  if (result.ok) {
    // Release an unexpected success before the assertion fails.
    result.value.dispose();
  }
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected failure");
  return result.diagnostics;
}

describe("shared mirror-normal normalization", () => {
  it("normalizes every finite non-zero vector and rejects the rest", () => {
    expect(unitVector3([2, 0, 0])).toEqual([1, 0, 0]);
    expect(unitVector3([1e200, 0, 0])).toEqual([1, 0, 0]);
    expect(unitVector3([1e-200, 0, 0])).toEqual([1, 0, 0]);
    const subnormal = unitVector3([5e-324, 0, -5e-324])!;
    expect(subnormal[0]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(subnormal[1]).toBe(0);
    expect(subnormal[2]).toBeCloseTo(-Math.SQRT1_2, 15);
    const huge = unitVector3([1.7e308, 1.7e308, 1.7e308])!;
    for (const value of huge) expect(value).toBeCloseTo(1 / Math.sqrt(3), 15);
    expect(unitVector3([0, 0, 0])).toBeUndefined();
    expect(unitVector3([-0, 0, -0])).toBeUndefined();
    expect(unitVector3([Number.NaN, 1, 0])).toBeUndefined();
    expect(unitVector3([Infinity, 0, 0])).toBeUndefined();
  });
});

describe.each(profiles)("public mirror normals on %s", (profile) => {
  it("rejects a zero normal as FEATURE_INVALID before the transform kernel call", async () => {
    const { kernel, calls } = countingKernel(
      profile === "mesh-preview"
        ? await createManifoldKernel()
        : await createOcctKernel(),
    );
    const evaluator = await createEvaluator({ kernel });
    try {
      for (const allowEmpty of [false, true]) {
        calls.length = 0;
        const diagnostics = failureOf(
          await evaluator.evaluate(mirroredBox(0), { allowEmpty }),
        );
        expect(diagnostics).toEqual([
          expect.objectContaining({
            code: "FEATURE_INVALID",
            severity: "error",
            node: "mirrored",
            path: "/nodes/mirrored/operations/0/normal",
          }),
        ]);
        expect(calls).toContain("box");
        expect(calls).not.toContain("transform");
      }
    } finally {
      evaluator.dispose();
    }
  });

  it.each([1, 1e200, 1e-200, 1.7e308])(
    "mirrors across the plane for a finite non-zero normal %s",
    async (normal) => {
      const result = await evaluators.get(profile)!.evaluate(mirroredBox(normal));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        const output = result.value.output("mirrored");
        expect(output).toBeInstanceOf(EvaluatedSolid);
        const measured = (output as EvaluatedSolid).measure();
        expect(measured.volume).toBeCloseTo(6, 6);
        expect(measured.boundingBox.min[0]).toBeCloseTo(-1, 6);
        expect(measured.boundingBox.max[0]).toBeCloseTo(0, 6);
      } finally {
        result.value.dispose();
      }
    },
  );

  it("rejects a zero assembly placement normal at its placement path", async () => {
    const diagnostics = failureOf(
      await evaluators.get(profile)!.evaluate(mirroredAssembly(0)),
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "FEATURE_INVALID",
        node: "assembly",
        path: "/nodes/assembly/instances/1/placement/1/normal",
      }),
    ]);
  });

  it.each([1e200, 1e-200])(
    "places a mirrored occurrence for a finite non-zero placement normal %s",
    async (normal) => {
      const result = await evaluators.get(profile)!.evaluate(
        mirroredAssembly(normal),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        const output = result.value.output("assembly") as EvaluatedAssembly;
        expect(output.instances[1]!.transform).toEqual([
          -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -5, 0, 0, 1,
        ]);
      } finally {
        result.value.dispose();
      }
    },
  );
});

const literal = (
  dimension: "length" | "scalar",
  value: number,
): ExpressionIR => ({ op: "literal", dimension, value });

function stagedMirrorDocument(normal: number): DesignDocumentV7 {
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "staged-mirror-normal",
    units: { length: "mm", angle: "rad" },
    parameters: {},
    nodes: {
      box: {
        kind: "box",
        size: [literal("length", 1), literal("length", 2), literal("length", 3)],
        center: false,
      },
      mirrored: {
        kind: "transform",
        input: { node: "box", kind: "solid" },
        operations: [
          {
            kind: "mirror",
            normal: [
              literal("scalar", normal),
              literal("scalar", 0),
              literal("scalar", 0),
            ],
          },
        ],
      },
      bodies: {
        kind: "bodySet",
        bodies: [{ id: "mirrored", solid: { node: "mirrored", kind: "solid" } }],
      },
    },
    outputs: { bodies: { node: "bodies", kind: "bodySet" } },
  } as unknown as DesignDocumentV7;
}

function stagedMirroredAssembly(normal: number): DesignDocumentV7 {
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "staged-mirror-placement",
    units: { length: "mm", angle: "rad" },
    parameters: {},
    nodes: {
      box: {
        kind: "box",
        size: [literal("length", 1), literal("length", 2), literal("length", 3)],
        center: false,
      },
      part: { kind: "part", geometry: { node: "box", kind: "solid" } },
      assembly: {
        kind: "assembly",
        instances: [
          {
            id: "mirrored",
            component: {
              source: "local",
              reference: { node: "part", kind: "part" },
            },
            configuration: { mode: "base" },
            placement: [
              {
                kind: "mirror",
                normal: [
                  literal("scalar", normal),
                  literal("scalar", 0),
                  literal("scalar", 0),
                ],
              },
            ],
            suppressed: false,
          },
        ],
      },
    },
    outputs: { product: { node: "assembly", kind: "assembly" } },
  } as unknown as DesignDocumentV7;
}

describe("staged v7 mirror normals", () => {
  it.each([1, 1e200, 1e-200, 1.7e308])(
    "accepts and normalizes the finite non-zero transform normal %s",
    async (normal) => {
      const kernel = await createManifoldKernel();
      const transformed: ResolvedTransformOperation[][] = [];
      const transform = kernel.transform!.bind(kernel);
      kernel.transform = (shape, operations, context) => {
        transformed.push([...operations]);
        return transform(shape, operations, context);
      };
      try {
        const result = await evaluateBodySetOutputsV7(
          kernel,
          stagedMirrorDocument(normal),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        try {
          expect(transformed).toEqual([[{ kind: "mirror", normal: [1, 0, 0] }]]);
          const box = result.value
            .output("bodies")
            .body("mirrored")
            .solid.measure().boundingBox;
          expect(box.min[0]).toBeCloseTo(-1, 6);
          expect(box.max[0]).toBeCloseTo(0, 6);
        } finally {
          result.value.dispose();
        }
      } finally {
        kernel.dispose();
      }
    },
  );

  it("still rejects a zero transform normal", async () => {
    const kernel = await createManifoldKernel();
    try {
      const diagnostics = failureOf(
        await evaluateBodySetOutputsV7(kernel, stagedMirrorDocument(0)),
      );
      expect(diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "FEATURE_INVALID",
            path: "/nodes/mirrored/operations/0/normal",
          }),
        ]),
      );
    } finally {
      kernel.dispose();
    }
  });

  it.each([1e200, 1e-200, 1.7e308])(
    "accepts the finite non-zero assembly placement normal %s",
    async (normal) => {
      const kernel = await createManifoldKernel();
      try {
        const result = await evaluateLocalAssemblyOutputsV7(
          kernel,
          stagedMirroredAssembly(normal),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        try {
          expect(
            result.value.output("product").occurrences[0]!.transform,
          ).toEqual([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        } finally {
          result.value.dispose();
        }
      } finally {
        kernel.dispose();
      }
    },
  );
});
