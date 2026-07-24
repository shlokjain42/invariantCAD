import { describe, expect, it } from "vitest";
import {
  EvaluatedPart,
  createEvaluator,
  createManifoldKernel,
  stringifyDocument,
  validateDocument,
  type GeometryKernel,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import {
  referenceModels,
  type ReferenceKernelId,
} from "../examples/reference-models/index.js";

const kernelCases: readonly {
  readonly id: ReferenceKernelId;
  readonly create: () => Promise<GeometryKernel>;
  readonly volumeRelativeTolerance: number;
}[] = [
  {
    id: "manifold",
    create: createManifoldKernel,
    volumeRelativeTolerance: 0.005,
  },
  {
    id: "occt",
    create: createOcctKernel,
    volumeRelativeTolerance: 1e-8,
  },
];

describe("reference-model authoring corpus", () => {
  it("builds valid canonical documents deterministically", () => {
    expect(referenceModels.map((model) => model.id)).toEqual([
      "electronics-enclosure",
      "six-bolt-flange",
      "hollow-stepped-shaft",
    ]);

    for (const model of referenceModels) {
      const first = model.buildDocument();
      const second = model.buildDocument();
      expect(validateDocument(first).ok, model.id).toBe(true);
      expect(stringifyDocument(first), model.id).toBe(
        stringifyDocument(second),
      );
      expect(Object.keys(first.nodes).length, model.id).toBeGreaterThan(0);
      expect(first.outputs[model.outputName], model.id).toBeDefined();
    }
  });
});

describe.each(kernelCases)("$id reference-model evaluation", (kernelCase) => {
  it(
    "evaluates every compatible model to stable engineering measurements",
    async () => {
      const evaluator = await createEvaluator({
        kernel: await kernelCase.create(),
      });
      try {
        for (const model of referenceModels.filter((candidate) =>
          candidate.supportedKernels.includes(kernelCase.id),
        )) {
          const result = await evaluator.evaluate(model.buildDocument(), {
            outputs: [model.outputName],
          });
          if (!result.ok) {
            throw new Error(
              `${kernelCase.id}/${model.id}: ${result.diagnostics
                .map((item) => `${item.code}: ${item.message}`)
                .join("\n")}`,
            );
          }

          try {
            const output = result.value.output(model.outputName);
            const measured = output.measure();
            const volumeError =
              Math.abs(measured.volume - model.expected.volumeMm3) /
              model.expected.volumeMm3;
            expect(volumeError, `${kernelCase.id}/${model.id} volume`).toBeLessThan(
              kernelCase.volumeRelativeTolerance,
            );

            for (const bound of ["min", "max"] as const) {
              for (let axis = 0; axis < 3; axis += 1) {
                expect(
                  measured.boundingBox[bound][axis],
                  `${kernelCase.id}/${model.id} ${bound}[${axis}]`,
                ).toBeCloseTo(model.expected.boundingBox[bound][axis]!, 4);
              }
            }

            const mesh = output.mesh();
            expect(mesh.positions.length, model.id).toBeGreaterThan(0);
            expect(mesh.positions.length % 3, model.id).toBe(0);
            expect(mesh.indices.length, model.id).toBeGreaterThan(0);
            expect(mesh.indices.length % 3, model.id).toBe(0);

            expect(output, model.id).toBeInstanceOf(EvaluatedPart);
            if (output instanceof EvaluatedPart) {
              const physical = output.physicalMassProperties();
              expect(physical.ok, model.id).toBe(true);
              if (physical.ok) {
                const expectedMass =
                  model.expected.volumeMm3 *
                  model.expected.massDensityKgPerM3 *
                  1e-9;
                const massError =
                  Math.abs(physical.value.mass - expectedMass) / expectedMass;
                expect(
                  massError,
                  `${kernelCase.id}/${model.id} mass`,
                ).toBeLessThan(kernelCase.volumeRelativeTolerance);
              }
            }
          } finally {
            result.value.dispose();
          }
        }
      } finally {
        evaluator.dispose();
      }
    },
    60_000,
  );
});
