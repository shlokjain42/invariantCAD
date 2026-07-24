import { performance } from "node:perf_hooks";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  EvaluatedPart,
  createEvaluator,
  createManifoldKernel,
  stringifyDocument,
  type GeometryKernel,
} from "../src/index.js";
import {
  referenceModels,
  type ReferenceKernelId,
} from "../examples/reference-models/index.js";

interface TimingSummary {
  readonly samples: readonly number[];
  readonly min: number;
  readonly median: number;
  readonly max: number;
}

function summarize(samples: readonly number[]): TimingSummary {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[middle]!;
  return {
    samples,
    min: sorted[0]!,
    median,
    max: sorted.at(-1)!,
  };
}

async function createKernel(id: ReferenceKernelId): Promise<GeometryKernel> {
  if (id === "manifold") return createManifoldKernel();
  const { createOcctKernel } = await import("../src/occt-kernel.js");
  return createOcctKernel();
}

const { values } = parseArgs({
  options: {
    kernel: { type: "string", default: "manifold" },
    iterations: { type: "string", default: "1" },
  },
  strict: true,
});

const iterations = Number(values.iterations);
if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) {
  throw new RangeError("--iterations must be an integer from 1 through 100");
}
if (
  values.kernel !== "manifold" &&
  values.kernel !== "occt" &&
  values.kernel !== "all"
) {
  throw new RangeError("--kernel must be manifold, occt, or all");
}
const kernelIds: readonly ReferenceKernelId[] =
  values.kernel === "all"
    ? ["manifold", "occt"]
    : [values.kernel as ReferenceKernelId];

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  options: { kernels: kernelIds, iterations },
  kernels: [] as unknown[],
};

for (const kernelId of kernelIds) {
  const initializationStarted = performance.now();
  const evaluator = await createEvaluator({
    kernel: await createKernel(kernelId),
  });
  const initializationMs = performance.now() - initializationStarted;
  const models = [];

  try {
    for (const model of referenceModels.filter((candidate) =>
      candidate.supportedKernels.includes(kernelId),
    )) {
      const buildMs: number[] = [];
      const evaluationMs: number[] = [];
      const measurementMs: number[] = [];
      const meshMs: number[] = [];
      let geometry:
        | {
            readonly volumeMm3: number;
            readonly surfaceAreaMm2: number;
            readonly boundingBox: unknown;
            readonly massKg: number | null;
            readonly vertices: number;
            readonly triangles: number;
            readonly meshBytes: number;
          }
        | undefined;
      let documentMetrics:
        | {
            readonly bytes: number;
            readonly nodes: number;
            readonly parameters: number;
          }
        | undefined;

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const buildStarted = performance.now();
        const document = model.buildDocument();
        buildMs.push(performance.now() - buildStarted);
        const serialized = stringifyDocument(document);
        documentMetrics ??= {
          bytes: new TextEncoder().encode(serialized).byteLength,
          nodes: Object.keys(document.nodes).length,
          parameters: Object.keys(document.parameters).length,
        };

        const evaluationStarted = performance.now();
        const result = await evaluator.evaluate(document, {
          outputs: [model.outputName],
        });
        evaluationMs.push(performance.now() - evaluationStarted);
        if (!result.ok) {
          throw new Error(
            `${kernelId}/${model.id}: ${result.diagnostics
              .map((item) => `${item.code}: ${item.message}`)
              .join("\n")}`,
          );
        }

        try {
          const output = result.value.output(model.outputName);
          const measurementStarted = performance.now();
          const measured = output.measure();
          measurementMs.push(performance.now() - measurementStarted);
          const meshStarted = performance.now();
          const mesh = output.mesh();
          meshMs.push(performance.now() - meshStarted);
          const physical =
            output instanceof EvaluatedPart
              ? output.physicalMassProperties()
              : undefined;
          geometry ??= {
            volumeMm3: measured.volume,
            surfaceAreaMm2: measured.surfaceArea,
            boundingBox: measured.boundingBox,
            massKg: physical?.ok ? physical.value.mass : null,
            vertices: mesh.positions.length / 3,
            triangles: mesh.indices.length / 3,
            meshBytes: mesh.positions.byteLength + mesh.indices.byteLength,
          };
        } finally {
          result.value.dispose();
        }
      }

      models.push({
        id: model.id,
        output: model.outputName,
        document: documentMetrics,
        geometry,
        timingsMs: {
          build: summarize(buildMs),
          evaluate: summarize(evaluationMs),
          measure: summarize(measurementMs),
          mesh: summarize(meshMs),
        },
      });
    }
  } finally {
    evaluator.dispose();
  }

  report.kernels.push({
    id: kernelId,
    initializationMs,
    models,
  });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
