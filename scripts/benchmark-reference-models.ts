import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { parseArgs } from "node:util";
import {
  EvaluatedPart,
  EvaluatedSolid,
  createEvaluator,
  createManifoldKernel,
  exportMesh,
  kernelSupports,
  stringifyDocument,
  type GeometryKernel,
  type MeshOptions,
} from "../src/index.js";
import {
  referenceModels,
  type ReferenceKernelId,
  type ReferenceModel,
} from "../examples/reference-models/index.js";

const REPORT_KIND = "invariantcad-reference-model-benchmark" as const;
const REPORT_SCHEMA_VERSION = 2 as const;
const CASE_WORKER_TIMEOUT_MS = 120_000 as const;
const TESSELLATION_OPTIONS = Object.freeze({
  linearDeflection: 0.1,
  angularDeflection: 0.3,
  relative: false,
} as const satisfies MeshOptions);
const MEMORY_CAVEATS = Object.freeze([
  "process-wide, not model-only",
  "cannot separate JavaScript, WebAssembly, and native allocations",
  "boundary values are cumulative high-water marks, not instantaneous RSS",
] as const);
const EXCLUDED_COLDNESS_CLAIMS = Object.freeze([
  "machine-cold",
  "filesystem-cache-cold",
  "WASM-compiler-cache-cold",
  "idle-or-frequency-controlled-hardware",
] as const);

interface TimingSummary {
  readonly samples: readonly number[];
  readonly min: number;
  readonly median: number;
  readonly max: number;
}

interface BenchmarkRunTimings {
  readonly documentBuild: number;
  readonly canonicalSerialization: number;
  readonly evaluation: number;
  readonly measurement: number;
  readonly physicalMassProperties: number;
  readonly tessellation: number;
  readonly stlSerialization: number;
  readonly stepSerialization: number | null;
  readonly resultDisposal: number;
  readonly workflowTotal: number;
}

interface BenchmarkRun {
  readonly class:
    | "fresh-runtime-first-run"
    | "same-runtime-repeat";
  readonly ordinal: number;
  readonly document: {
    readonly canonicalUtf8Bytes: number;
    readonly canonicalSha256: string;
    readonly nodes: number;
    readonly parameters: number;
  };
  readonly geometry: {
    readonly volumeMm3: number;
    readonly surfaceAreaMm2: number;
    readonly boundingBox: {
      readonly min: readonly [number, number, number];
      readonly max: readonly [number, number, number];
    };
    readonly massKg: number;
  };
  readonly tessellation: {
    readonly vertices: number;
    readonly triangles: number;
    readonly positionsBytes: number;
    readonly indicesBytes: number;
    readonly totalBufferBytes: number;
  };
  readonly outputs: {
    readonly binaryStl: {
      readonly status: "observed";
      readonly byteLength: number;
    };
    readonly step:
      | {
          readonly status: "observed";
          readonly byteLength: number;
        }
      | {
          readonly status: "unsupported";
          readonly reason:
            | "kernel-does-not-advertise-step-export"
            | "output-does-not-support-native-export";
        };
  };
  readonly timingsMs: BenchmarkRunTimings;
}

interface RepeatTimingSummary {
  readonly documentBuild: TimingSummary;
  readonly canonicalSerialization: TimingSummary;
  readonly evaluation: TimingSummary;
  readonly measurement: TimingSummary;
  readonly physicalMassProperties: TimingSummary;
  readonly tessellation: TimingSummary;
  readonly stlSerialization: TimingSummary;
  readonly stepSerialization: TimingSummary | null;
  readonly resultDisposal: TimingSummary;
  readonly workflowTotal: TimingSummary;
}

export interface BenchmarkCase {
  readonly kernel: {
    readonly id: ReferenceKernelId;
    readonly protocolVersion: number;
    readonly representation: string;
    readonly exact: boolean;
  };
  readonly model: {
    readonly id: string;
    readonly output: string;
  };
  readonly tessellationControl:
    | {
        readonly mode: "authored-segmentation-and-kernel-default";
        readonly requestedOptions: Readonly<Record<string, never>>;
        readonly note: "Manifold primitive segmentation is authored in the document";
      }
    | {
        readonly mode: "explicit-mesh-options";
        readonly requestedOptions: typeof TESSELLATION_OPTIONS;
      };
  readonly initializationMs: number;
  readonly evaluatorDisposalMs: number;
  readonly runs: {
    readonly first: BenchmarkRun;
    readonly repeats: readonly BenchmarkRun[];
    readonly repeatTimingSummaryMs: RepeatTimingSummary;
  };
  readonly memory: {
    readonly status: "observed";
    readonly metric: "process-max-rss-high-water";
    readonly source: "process.resourceUsage().maxRSS";
    readonly unit: "KiB";
    readonly scope: "dedicated model worker process, including Node.js, modules, JavaScript, WebAssembly, and kernel state";
    readonly boundaries: {
      readonly afterImports: number;
      readonly afterKernelInitialization: number;
      readonly afterFirstRunDisposal: number;
      readonly afterRepeatRunDisposals: readonly number[];
      readonly afterEvaluatorDisposal: number;
    };
    readonly caveats: typeof MEMORY_CAVEATS;
  };
  readonly nativeHandles: {
    readonly status: "unsupported";
    readonly metric: "peak-live-native-handles";
    readonly reasonCode: "kernel-telemetry-unavailable";
    readonly detail: "GeometryKernel protocol v1 exposes disposal but no native allocation counter";
  };
}

export interface BenchmarkReport {
  readonly kind: typeof REPORT_KIND;
  readonly schemaVersion: typeof REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly source: {
    readonly packageVersion: string;
    readonly revision:
      | {
          readonly status: "observed";
          readonly gitCommit: string;
          readonly dirty: boolean;
        }
      | {
          readonly status: "unavailable";
        };
  };
  readonly environment: {
    readonly node: string;
    readonly v8: string;
    readonly platform: string;
    readonly architecture: string;
    readonly cpuModel: string;
    readonly logicalCpuCount: number;
    readonly totalMemoryBytes: number;
    readonly clock: "node:perf_hooks.performance.now";
  };
  readonly semantics: {
    readonly isolation: "fresh-child-process-per-kernel-model";
    readonly firstRun: "new process, new kernel, new evaluator, fresh buildDocument call, first evaluation";
    readonly repeatRun: "fresh buildDocument call with identical canonical bytes, same kernel and evaluator, previous result disposed";
    readonly evaluatorCache: "disabled";
    readonly excludedColdnessClaims: typeof EXCLUDED_COLDNESS_CLAIMS;
  };
  readonly request: {
    readonly kernels: readonly ReferenceKernelId[];
    readonly models: readonly string[];
    readonly repeatRuns: number;
    readonly caseWorkerTimeoutMs: typeof CASE_WORKER_TIMEOUT_MS;
  };
  readonly cases: readonly BenchmarkCase[];
}

export interface BenchmarkCaseExpectation {
  readonly kernelId: ReferenceKernelId;
  readonly modelId: string;
  readonly outputName: string;
  readonly repeatRuns: number;
}

interface Timed<T> {
  readonly value: T;
  readonly milliseconds: number;
}

function timed<T>(operation: () => T): Timed<T> {
  const started = performance.now();
  const value = operation();
  return { value, milliseconds: performance.now() - started };
}

async function timedAsync<T>(operation: () => Promise<T>): Promise<Timed<T>> {
  const started = performance.now();
  const value = await operation();
  return { value, milliseconds: performance.now() - started };
}

function summarize(samples: readonly number[]): TimingSummary {
  if (samples.length === 0) {
    throw new RangeError("A timing summary requires at least one sample");
  }
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

function summarizeRepeats(runs: readonly BenchmarkRun[]): RepeatTimingSummary {
  const values = <K extends keyof BenchmarkRunTimings>(
    key: K,
  ): readonly NonNullable<BenchmarkRunTimings[K]>[] =>
    runs
      .map((run) => run.timingsMs[key])
      .filter(
        (value): value is NonNullable<BenchmarkRunTimings[K]> => value !== null,
      );
  const stepSamples = values("stepSerialization");
  return {
    documentBuild: summarize(values("documentBuild")),
    canonicalSerialization: summarize(values("canonicalSerialization")),
    evaluation: summarize(values("evaluation")),
    measurement: summarize(values("measurement")),
    physicalMassProperties: summarize(values("physicalMassProperties")),
    tessellation: summarize(values("tessellation")),
    stlSerialization: summarize(values("stlSerialization")),
    stepSerialization:
      stepSamples.length === 0 ? null : summarize(stepSamples),
    resultDisposal: summarize(values("resultDisposal")),
    workflowTotal: summarize(values("workflowTotal")),
  };
}

async function createKernel(id: ReferenceKernelId): Promise<GeometryKernel> {
  if (id === "manifold") return createManifoldKernel();
  const { createOcctKernel } = await import("../src/occt-kernel.js");
  return createOcctKernel();
}

function modelById(id: string): ReferenceModel {
  const model = referenceModels.find((candidate) => candidate.id === id);
  if (model === undefined) {
    throw new RangeError(`Unknown reference model '${id}'`);
  }
  return model;
}

function diagnosticMessage(
  kernelId: ReferenceKernelId,
  model: ReferenceModel,
  diagnostics: readonly { readonly code: string; readonly message: string }[],
): string {
  return `${kernelId}/${model.id}: ${diagnostics
    .map((item) => `${item.code}: ${item.message}`)
    .join("\n")}`;
}

function validateEngineeringOutcome(
  kernelId: ReferenceKernelId,
  model: ReferenceModel,
  run: BenchmarkRun,
): void {
  const relativeTolerance = kernelId === "manifold" ? 0.005 : 1e-8;
  const volumeError =
    Math.abs(run.geometry.volumeMm3 - model.expected.volumeMm3) /
    model.expected.volumeMm3;
  if (!(volumeError < relativeTolerance)) {
    throw new Error(
      `${kernelId}/${model.id}: volume error ${volumeError} exceeds ${relativeTolerance}`,
    );
  }
  for (const bound of ["min", "max"] as const) {
    for (let axis = 0; axis < 3; axis += 1) {
      const actual = run.geometry.boundingBox[bound][axis]!;
      const expected = model.expected.boundingBox[bound][axis]!;
      if (Math.abs(actual - expected) > 1e-4) {
        throw new Error(
          `${kernelId}/${model.id}: ${bound}[${axis}] expected ${expected}, received ${actual}`,
        );
      }
    }
  }
  const expectedMass =
    model.expected.volumeMm3 * model.expected.massDensityKgPerM3 * 1e-9;
  const massError = Math.abs(run.geometry.massKg - expectedMass) / expectedMass;
  if (!(massError < relativeTolerance)) {
    throw new Error(
      `${kernelId}/${model.id}: mass error ${massError} exceeds ${relativeTolerance}`,
    );
  }
}

async function executeRun(
  evaluator: Awaited<ReturnType<typeof createEvaluator>>,
  kernelId: ReferenceKernelId,
  model: ReferenceModel,
  runClass: BenchmarkRun["class"],
  ordinal: number,
): Promise<BenchmarkRun> {
  const workflowStarted = performance.now();
  const built = timed(() => model.buildDocument());
  const serialized = timed(() => stringifyDocument(built.value));
  const canonicalBytes = new TextEncoder().encode(serialized.value);
  const canonicalSha256 = createHash("sha256")
    .update(canonicalBytes)
    .digest("hex");
  const evaluated = await timedAsync(() =>
    evaluator.evaluate(built.value, { outputs: [model.outputName] }),
  );
  if (!evaluated.value.ok) {
    throw new Error(
      diagnosticMessage(kernelId, model, evaluated.value.diagnostics),
    );
  }

  let partial:
    | Omit<BenchmarkRun, "timingsMs">
    | undefined;
  let measurementMs = 0;
  let physicalMassPropertiesMs = 0;
  let tessellationMs = 0;
  let stlSerializationMs = 0;
  let stepSerializationMs: number | null = null;
  let resultDisposalMs = 0;
  try {
    const output = evaluated.value.value.output(model.outputName);
    if (!(output instanceof EvaluatedPart)) {
      throw new TypeError(
        `${kernelId}/${model.id}: reference output must be an EvaluatedPart`,
      );
    }

    const measurement = timed(() => output.measure());
    measurementMs = measurement.milliseconds;
    const physical = timed(() => output.physicalMassProperties());
    physicalMassPropertiesMs = physical.milliseconds;
    if (!physical.value.ok) {
      throw new Error(
        diagnosticMessage(kernelId, model, physical.value.diagnostics),
      );
    }

    const mesh = timed(() =>
      kernelId === "occt"
        ? output.mesh(TESSELLATION_OPTIONS)
        : output.mesh(),
    );
    tessellationMs = mesh.milliseconds;
    const stl = timed(() =>
      exportMesh(mesh.value, "stl", model.outputName),
    );
    stlSerializationMs = stl.milliseconds;

    let step: BenchmarkRun["outputs"]["step"];
    if (
      kernelSupports(evaluator.kernel.capabilities, "nativeExport", "step")
    ) {
      if (!(output instanceof EvaluatedSolid)) {
        step = {
          status: "unsupported",
          reason: "output-does-not-support-native-export",
        };
      } else {
        const exported = timed(() => output.export("step"));
        stepSerializationMs = exported.milliseconds;
        step = {
          status: "observed",
          byteLength: exported.value.byteLength,
        };
      }
    } else {
      step = {
        status: "unsupported",
        reason: "kernel-does-not-advertise-step-export",
      };
    }

    partial = {
      class: runClass,
      ordinal,
      document: {
        canonicalUtf8Bytes: canonicalBytes.byteLength,
        canonicalSha256,
        nodes: Object.keys(built.value.nodes).length,
        parameters: Object.keys(built.value.parameters).length,
      },
      geometry: {
        volumeMm3: measurement.value.volume,
        surfaceAreaMm2: measurement.value.surfaceArea,
        boundingBox: measurement.value.boundingBox,
        massKg: physical.value.value.mass,
      },
      tessellation: {
        vertices: mesh.value.positions.length / 3,
        triangles: mesh.value.indices.length / 3,
        positionsBytes: mesh.value.positions.byteLength,
        indicesBytes: mesh.value.indices.byteLength,
        totalBufferBytes:
          mesh.value.positions.byteLength + mesh.value.indices.byteLength,
      },
      outputs: {
        binaryStl: {
          status: "observed",
          byteLength: stl.value.byteLength,
        },
        step,
      },
    };
  } finally {
    const disposalStarted = performance.now();
    evaluated.value.value.dispose();
    resultDisposalMs = performance.now() - disposalStarted;
  }

  if (partial === undefined) {
    throw new Error(`${kernelId}/${model.id}: benchmark run did not complete`);
  }
  const run: BenchmarkRun = {
    ...partial,
    timingsMs: {
      documentBuild: built.milliseconds,
      canonicalSerialization: serialized.milliseconds,
      evaluation: evaluated.milliseconds,
      measurement: measurementMs,
      physicalMassProperties: physicalMassPropertiesMs,
      tessellation: tessellationMs,
      stlSerialization: stlSerializationMs,
      stepSerialization: stepSerializationMs,
      resultDisposal: resultDisposalMs,
      workflowTotal: performance.now() - workflowStarted,
    },
  };
  validateEngineeringOutcome(kernelId, model, run);
  return run;
}

function maxRssKiB(): number {
  return process.resourceUsage().maxRSS;
}

async function executeCase(
  kernelId: ReferenceKernelId,
  modelId: string,
  repeatRuns: number,
): Promise<BenchmarkCase> {
  const model = modelById(modelId);
  if (!model.supportedKernels.includes(kernelId)) {
    throw new RangeError(
      `Reference model '${model.id}' does not support kernel '${kernelId}'`,
    );
  }

  const afterImports = maxRssKiB();
  const initialized = await timedAsync(async () =>
    createEvaluator({ kernel: await createKernel(kernelId) }),
  );
  const evaluator = initialized.value;
  const afterKernelInitialization = maxRssKiB();
  let first: BenchmarkRun | undefined;
  const repeats: BenchmarkRun[] = [];
  let afterFirstRunDisposal = afterKernelInitialization;
  const afterRepeatRunDisposals: number[] = [];
  let evaluatorDisposalMs = 0;
  try {
    first = await executeRun(
      evaluator,
      kernelId,
      model,
      "fresh-runtime-first-run",
      0,
    );
    afterFirstRunDisposal = maxRssKiB();
    for (let ordinal = 1; ordinal <= repeatRuns; ordinal += 1) {
      const repeat = await executeRun(
        evaluator,
        kernelId,
        model,
        "same-runtime-repeat",
        ordinal,
      );
      if (
        repeat.document.canonicalSha256 !== first.document.canonicalSha256 ||
        repeat.document.canonicalUtf8Bytes !==
          first.document.canonicalUtf8Bytes
      ) {
        throw new Error(
          `${kernelId}/${model.id}: repeated document bytes differ from the first run`,
        );
      }
      repeats.push(repeat);
      afterRepeatRunDisposals.push(maxRssKiB());
    }
  } finally {
    const disposalStarted = performance.now();
    evaluator.dispose();
    evaluatorDisposalMs = performance.now() - disposalStarted;
  }
  const afterEvaluatorDisposal = maxRssKiB();
  if (first === undefined) {
    throw new Error(`${kernelId}/${model.id}: first benchmark run is missing`);
  }

  const result: BenchmarkCase = {
    kernel: {
      id: kernelId,
      protocolVersion: evaluator.kernel.capabilities.protocolVersion,
      representation: evaluator.kernel.capabilities.representation,
      exact: evaluator.kernel.capabilities.exact,
    },
    model: {
      id: model.id,
      output: model.outputName,
    },
    tessellationControl:
      kernelId === "manifold"
        ? {
            mode: "authored-segmentation-and-kernel-default",
            requestedOptions: {},
            note: "Manifold primitive segmentation is authored in the document",
          }
        : {
            mode: "explicit-mesh-options",
            requestedOptions: TESSELLATION_OPTIONS,
          },
    initializationMs: initialized.milliseconds,
    evaluatorDisposalMs,
    runs: {
      first,
      repeats,
      repeatTimingSummaryMs: summarizeRepeats(repeats),
    },
    memory: {
      status: "observed",
      metric: "process-max-rss-high-water",
      source: "process.resourceUsage().maxRSS",
      unit: "KiB",
      scope:
        "dedicated model worker process, including Node.js, modules, JavaScript, WebAssembly, and kernel state",
      boundaries: {
        afterImports,
        afterKernelInitialization,
        afterFirstRunDisposal,
        afterRepeatRunDisposals,
        afterEvaluatorDisposal,
      },
      caveats: MEMORY_CAVEATS,
    },
    nativeHandles: {
      status: "unsupported",
      metric: "peak-live-native-handles",
      reasonCode: "kernel-telemetry-unavailable",
      detail:
        "GeometryKernel protocol v1 exposes disposal but no native allocation counter",
    },
  };
  validateBenchmarkCase(result, {
    kernelId,
    modelId: model.id,
    outputName: model.outputName,
    repeatRuns,
  });
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(
      `${label} keys must be exactly ${sortedExpected.join(", ")}`,
    );
  }
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function finiteVector3(
  value: unknown,
): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    )
  );
}

function validateTimingSummary(
  value: unknown,
  expectedSamples: readonly number[],
): asserts value is TimingSummary {
  if (!isRecord(value)) {
    throw new TypeError("Benchmark repeat timing summary must be an object");
  }
  requireExactKeys(
    value,
    ["samples", "min", "median", "max"],
    "Benchmark repeat timing summary",
  );
  if (
    !Array.isArray(value.samples) ||
    value.samples.length !== expectedSamples.length ||
    value.samples.some((sample) => !nonNegativeFinite(sample)) ||
    !nonNegativeFinite(value.min) ||
    !nonNegativeFinite(value.median) ||
    !nonNegativeFinite(value.max)
  ) {
    throw new TypeError("Benchmark repeat timing summary is invalid");
  }
  if (
    value.samples.some(
      (sample, index) => sample !== expectedSamples[index],
    )
  ) {
    throw new TypeError(
      "Benchmark repeat timing samples do not match the repeated runs",
    );
  }
  const expected = summarize(value.samples as number[]);
  if (
    value.min !== expected.min ||
    value.median !== expected.median ||
    value.max !== expected.max
  ) {
    throw new TypeError("Benchmark repeat timing summary is inconsistent");
  }
}

function validateRun(
  value: unknown,
  expectedClass: BenchmarkRun["class"],
  expectedOrdinal: number,
  expectedKernelId: ReferenceKernelId,
): asserts value is BenchmarkRun {
  if (!isRecord(value)) throw new TypeError("Benchmark run must be an object");
  requireExactKeys(
    value,
    [
      "class",
      "ordinal",
      "document",
      "geometry",
      "tessellation",
      "outputs",
      "timingsMs",
    ],
    "Benchmark run",
  );
  if (value.class !== expectedClass || value.ordinal !== expectedOrdinal) {
    throw new TypeError(
      `Benchmark run must be ${expectedClass} with ordinal ${expectedOrdinal}`,
    );
  }
  if (!isRecord(value.document)) {
    throw new TypeError("Benchmark document evidence is invalid");
  }
  requireExactKeys(
    value.document,
    ["canonicalUtf8Bytes", "canonicalSha256", "nodes", "parameters"],
    "Benchmark document evidence",
  );
  if (
    !positiveSafeInteger(value.document.canonicalUtf8Bytes) ||
    typeof value.document.canonicalSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.document.canonicalSha256) ||
    !positiveSafeInteger(value.document.nodes) ||
    !positiveSafeInteger(value.document.parameters)
  ) {
    throw new TypeError("Benchmark canonical document evidence is invalid");
  }
  if (!isRecord(value.geometry)) {
    throw new TypeError("Benchmark geometry evidence is invalid");
  }
  requireExactKeys(
    value.geometry,
    ["volumeMm3", "surfaceAreaMm2", "boundingBox", "massKg"],
    "Benchmark geometry evidence",
  );
  for (const field of ["volumeMm3", "surfaceAreaMm2", "massKg"] as const) {
    if (
      !nonNegativeFinite(value.geometry[field]) ||
      !(value.geometry[field] as number > 0)
    ) {
      throw new TypeError(`Benchmark geometry ${field} is invalid`);
    }
  }
  if (
    !isRecord(value.geometry.boundingBox) ||
    !finiteVector3(value.geometry.boundingBox.min) ||
    !finiteVector3(value.geometry.boundingBox.max)
  ) {
    throw new TypeError("Benchmark geometry bounds are invalid");
  }
  requireExactKeys(
    value.geometry.boundingBox,
    ["min", "max"],
    "Benchmark geometry bounds",
  );
  if (!isRecord(value.tessellation)) {
    throw new TypeError("Benchmark tessellation evidence is invalid");
  }
  requireExactKeys(
    value.tessellation,
    [
      "vertices",
      "triangles",
      "positionsBytes",
      "indicesBytes",
      "totalBufferBytes",
    ],
    "Benchmark tessellation evidence",
  );
  for (const field of [
    "vertices",
    "triangles",
    "positionsBytes",
    "indicesBytes",
    "totalBufferBytes",
  ] as const) {
    if (!positiveSafeInteger(value.tessellation[field])) {
      throw new TypeError(`Benchmark tessellation ${field} is invalid`);
    }
  }
  if (
    value.tessellation.positionsBytes !==
      (value.tessellation.vertices as number) * 3 * Float32Array.BYTES_PER_ELEMENT ||
    value.tessellation.indicesBytes !==
      (value.tessellation.triangles as number) * 3 * Uint32Array.BYTES_PER_ELEMENT
  ) {
    throw new TypeError("Benchmark mesh buffer dimensions are inconsistent");
  }
  if (
    value.tessellation.totalBufferBytes !==
    (value.tessellation.positionsBytes as number) +
      (value.tessellation.indicesBytes as number)
  ) {
    throw new TypeError("Benchmark mesh buffer byte total is inconsistent");
  }
  if (!isRecord(value.outputs) || !isRecord(value.outputs.binaryStl)) {
    throw new TypeError("Benchmark output evidence is invalid");
  }
  requireExactKeys(
    value.outputs,
    ["binaryStl", "step"],
    "Benchmark output evidence",
  );
  requireExactKeys(
    value.outputs.binaryStl,
    ["status", "byteLength"],
    "Benchmark binary STL evidence",
  );
  if (
    value.outputs.binaryStl.status !== "observed" ||
    !positiveSafeInteger(value.outputs.binaryStl.byteLength) ||
    value.outputs.binaryStl.byteLength !==
      84 + (value.tessellation.triangles as number) * 50
  ) {
    throw new TypeError("Benchmark binary STL evidence is inconsistent");
  }
  if (!isRecord(value.outputs.step)) {
    throw new TypeError("Benchmark STEP evidence is invalid");
  }
  if (expectedKernelId === "occt") {
    requireExactKeys(
      value.outputs.step,
      ["status", "byteLength"],
      "Benchmark STEP evidence",
    );
    if (
      value.outputs.step.status !== "observed" ||
      !positiveSafeInteger(value.outputs.step.byteLength)
    ) {
      throw new TypeError("OCCT benchmark STEP evidence must be observed");
    }
  } else {
    requireExactKeys(
      value.outputs.step,
      ["status", "reason"],
      "Benchmark STEP evidence",
    );
    if (
      value.outputs.step.status !== "unsupported" ||
      value.outputs.step.reason !==
        "kernel-does-not-advertise-step-export"
    ) {
      throw new TypeError(
        "Manifold benchmark STEP evidence must be explicitly unsupported",
      );
    }
  }
  if (!isRecord(value.timingsMs)) {
    throw new TypeError("Benchmark timing evidence is invalid");
  }
  const timingFields = [
    "documentBuild",
    "canonicalSerialization",
    "evaluation",
    "measurement",
    "physicalMassProperties",
    "tessellation",
    "stlSerialization",
    "stepSerialization",
    "resultDisposal",
    "workflowTotal",
  ] as const;
  requireExactKeys(
    value.timingsMs,
    timingFields,
    "Benchmark timing evidence",
  );
  for (const field of timingFields) {
    const timing = value.timingsMs[field];
    if (field === "stepSerialization" && timing === null) continue;
    if (!nonNegativeFinite(timing)) {
      throw new TypeError(`Benchmark timing '${field}' is invalid`);
    }
  }
  if (
    (value.outputs.step.status === "observed") !==
    (value.timingsMs.stepSerialization !== null)
  ) {
    throw new TypeError("Benchmark STEP output and timing evidence disagree");
  }
}

export function validateBenchmarkCase(
  value: unknown,
  expected: BenchmarkCaseExpectation,
): asserts value is BenchmarkCase {
  if (!isRecord(value)) throw new TypeError("Benchmark case must be an object");
  requireExactKeys(
    value,
    [
      "kernel",
      "model",
      "tessellationControl",
      "initializationMs",
      "evaluatorDisposalMs",
      "runs",
      "memory",
      "nativeHandles",
    ],
    "Benchmark case",
  );
  if (
    !isRecord(value.kernel) ||
    !isRecord(value.model) ||
    !isRecord(value.tessellationControl) ||
    !nonNegativeFinite(value.initializationMs) ||
    !nonNegativeFinite(value.evaluatorDisposalMs)
  ) {
    throw new TypeError("Benchmark kernel evidence is invalid");
  }
  requireExactKeys(
    value.kernel,
    ["id", "protocolVersion", "representation", "exact"],
    "Benchmark kernel evidence",
  );
  const expectedRepresentation =
    expected.kernelId === "manifold" ? "mesh" : "brep";
  const expectedExact = expected.kernelId === "occt";
  if (
    value.kernel.id !== expected.kernelId ||
    value.kernel.protocolVersion !== 1 ||
    value.kernel.representation !== expectedRepresentation ||
    value.kernel.exact !== expectedExact
  ) {
    throw new TypeError(
      `Benchmark worker output does not match requested kernel '${expected.kernelId}'`,
    );
  }
  requireExactKeys(
    value.model,
    ["id", "output"],
    "Benchmark model evidence",
  );
  if (
    value.model.id !== expected.modelId ||
    value.model.output !== expected.outputName
  ) {
    throw new TypeError(
      `Benchmark worker output does not match requested model/output '${expected.modelId}/${expected.outputName}'`,
    );
  }
  if (expected.kernelId === "manifold") {
    requireExactKeys(
      value.tessellationControl,
      ["mode", "requestedOptions", "note"],
      "Manifold tessellation control",
    );
    if (!isRecord(value.tessellationControl.requestedOptions)) {
      throw new TypeError("Manifold tessellation options must be an object");
    }
    requireExactKeys(
      value.tessellationControl.requestedOptions,
      [],
      "Manifold tessellation options",
    );
    if (
      value.tessellationControl.mode !==
        "authored-segmentation-and-kernel-default" ||
      value.tessellationControl.note !==
        "Manifold primitive segmentation is authored in the document"
    ) {
      throw new TypeError("Manifold tessellation control is inconsistent");
    }
  } else {
    requireExactKeys(
      value.tessellationControl,
      ["mode", "requestedOptions"],
      "OCCT tessellation control",
    );
    if (!isRecord(value.tessellationControl.requestedOptions)) {
      throw new TypeError("OCCT tessellation options must be an object");
    }
    requireExactKeys(
      value.tessellationControl.requestedOptions,
      ["linearDeflection", "angularDeflection", "relative"],
      "OCCT tessellation options",
    );
    if (
      value.tessellationControl.mode !== "explicit-mesh-options" ||
      value.tessellationControl.requestedOptions.linearDeflection !==
        TESSELLATION_OPTIONS.linearDeflection ||
      value.tessellationControl.requestedOptions.angularDeflection !==
        TESSELLATION_OPTIONS.angularDeflection ||
      value.tessellationControl.requestedOptions.relative !==
        TESSELLATION_OPTIONS.relative
    ) {
      throw new TypeError("OCCT tessellation control is inconsistent");
    }
  }
  if (!isRecord(value.runs) || !Array.isArray(value.runs.repeats)) {
    throw new TypeError("Benchmark runs are invalid");
  }
  requireExactKeys(
    value.runs,
    ["first", "repeats", "repeatTimingSummaryMs"],
    "Benchmark runs",
  );
  validateRun(
    value.runs.first,
    "fresh-runtime-first-run",
    0,
    expected.kernelId,
  );
  if (value.runs.repeats.length !== expected.repeatRuns) {
    throw new TypeError("Benchmark repeat count is inconsistent");
  }
  const repeats: BenchmarkRun[] = [];
  for (let index = 0; index < value.runs.repeats.length; index += 1) {
    const repeat = value.runs.repeats[index];
    validateRun(
      repeat,
      "same-runtime-repeat",
      index + 1,
      expected.kernelId,
    );
    if (
      repeat.document.canonicalSha256 !==
        value.runs.first.document.canonicalSha256 ||
      repeat.document.canonicalUtf8Bytes !==
        value.runs.first.document.canonicalUtf8Bytes
    ) {
      throw new TypeError("Benchmark repeated-run evidence is inconsistent");
    }
    repeats.push(repeat);
  }
  if (!isRecord(value.runs.repeatTimingSummaryMs)) {
    throw new TypeError("Benchmark repeat timing summaries are invalid");
  }
  const summarizedTimingFields = [
    "documentBuild",
    "canonicalSerialization",
    "evaluation",
    "measurement",
    "physicalMassProperties",
    "tessellation",
    "stlSerialization",
    "resultDisposal",
    "workflowTotal",
  ] as const;
  requireExactKeys(
    value.runs.repeatTimingSummaryMs,
    [...summarizedTimingFields, "stepSerialization"],
    "Benchmark repeat timing summaries",
  );
  for (const field of summarizedTimingFields) {
    validateTimingSummary(
      value.runs.repeatTimingSummaryMs[field],
      repeats.map((repeat) => repeat.timingsMs[field]),
    );
  }
  const stepSummary = value.runs.repeatTimingSummaryMs.stepSerialization;
  if (value.runs.first.outputs.step.status === "observed") {
    validateTimingSummary(
      stepSummary,
      repeats.map((repeat) => {
        const timing = repeat.timingsMs.stepSerialization;
        if (timing === null) {
          throw new TypeError(
            "Observed STEP output requires a repeated STEP timing",
          );
        }
        return timing;
      }),
    );
  } else if (stepSummary !== null) {
    throw new TypeError("Benchmark STEP timing summary is inconsistent");
  }
  const memory = value.memory;
  if (!isRecord(memory)) {
    throw new TypeError("Benchmark memory evidence must be an object");
  }
  requireExactKeys(
    memory,
    [
      "status",
      "metric",
      "source",
      "unit",
      "scope",
      "boundaries",
      "caveats",
    ],
    "Benchmark memory evidence",
  );
  if (
    memory.status !== "observed" ||
    memory.metric !== "process-max-rss-high-water" ||
    memory.source !== "process.resourceUsage().maxRSS" ||
    memory.unit !== "KiB" ||
    memory.scope !==
      "dedicated model worker process, including Node.js, modules, JavaScript, WebAssembly, and kernel state"
  ) {
    throw new TypeError("Benchmark memory evidence is invalid");
  }
  const caveats = memory.caveats;
  if (
    !Array.isArray(caveats) ||
    caveats.length !== MEMORY_CAVEATS.length ||
    !MEMORY_CAVEATS.every(
      (caveat, index) => caveats[index] === caveat,
    )
  ) {
    throw new TypeError("Benchmark memory caveats are invalid");
  }
  const memoryBoundaries = memory.boundaries;
  if (!isRecord(memoryBoundaries)) {
    throw new TypeError("Benchmark memory boundaries must be an object");
  }
  requireExactKeys(
    memoryBoundaries,
    [
      "afterImports",
      "afterKernelInitialization",
      "afterFirstRunDisposal",
      "afterRepeatRunDisposals",
      "afterEvaluatorDisposal",
    ],
    "Benchmark memory boundaries",
  );
  if (
    !Array.isArray(memoryBoundaries.afterRepeatRunDisposals) ||
    memoryBoundaries.afterRepeatRunDisposals.length !== expected.repeatRuns
  ) {
    throw new TypeError("Benchmark repeat memory boundaries are invalid");
  }
  const boundaries = [
    memoryBoundaries.afterImports,
    memoryBoundaries.afterKernelInitialization,
    memoryBoundaries.afterFirstRunDisposal,
    ...memoryBoundaries.afterRepeatRunDisposals,
    memoryBoundaries.afterEvaluatorDisposal,
  ];
  if (
    boundaries.some((boundary) => !positiveSafeInteger(boundary)) ||
    boundaries.some(
      (boundary, index) =>
        index > 0 && boundary < (boundaries[index - 1] as number),
    )
  ) {
    throw new TypeError(
      "Benchmark process max-RSS boundaries must be positive and nondecreasing",
    );
  }
  if (
    !isRecord(value.nativeHandles) ||
    value.nativeHandles.status !== "unsupported" ||
    value.nativeHandles.metric !== "peak-live-native-handles" ||
    value.nativeHandles.reasonCode !== "kernel-telemetry-unavailable" ||
    value.nativeHandles.detail !==
      "GeometryKernel protocol v1 exposes disposal but no native allocation counter"
  ) {
    throw new TypeError("Benchmark native-handle evidence is invalid");
  }
  requireExactKeys(
    value.nativeHandles,
    ["status", "metric", "reasonCode", "detail"],
    "Benchmark native-handle evidence",
  );
}

export function enforceCrossKernelCanonicalIdentity(
  cases: readonly BenchmarkCase[],
): void {
  const byModel = new Map<
    string,
    {
      readonly kernelId: ReferenceKernelId;
      readonly canonicalUtf8Bytes: number;
      readonly canonicalSha256: string;
    }
  >();
  for (const benchmarkCase of cases) {
    const document = benchmarkCase.runs.first.document;
    const previous = byModel.get(benchmarkCase.model.id);
    if (previous === undefined) {
      byModel.set(benchmarkCase.model.id, {
        kernelId: benchmarkCase.kernel.id,
        canonicalUtf8Bytes: document.canonicalUtf8Bytes,
        canonicalSha256: document.canonicalSha256,
      });
      continue;
    }
    if (
      document.canonicalUtf8Bytes !== previous.canonicalUtf8Bytes ||
      document.canonicalSha256 !== previous.canonicalSha256
    ) {
      throw new TypeError(
        `Reference model '${benchmarkCase.model.id}' canonical document differs between kernels '${previous.kernelId}' and '${benchmarkCase.kernel.id}'`,
      );
    }
  }
}

function parsePositiveInteger(
  value: string | undefined,
  name: string,
  maximum: number,
): number {
  if (value === undefined) {
    throw new RangeError(`${name} is required`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RangeError(`${name} must be an integer from 1 through ${maximum}`);
  }
  return parsed;
}

function selectedKernels(value: string): readonly ReferenceKernelId[] {
  if (value === "all") return ["manifold", "occt"];
  if (value === "manifold" || value === "occt") return [value];
  throw new RangeError("--kernel must be manifold, occt, or all");
}

function selectedModels(values: readonly string[] | undefined): readonly string[] {
  if (values === undefined || values.length === 0) {
    return referenceModels.map((model) => model.id);
  }
  const unique = [...new Set(values)];
  for (const id of unique) modelById(id);
  return unique;
}

function sourceRevision(): BenchmarkReport["source"]["revision"] {
  try {
    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const dirty =
      execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim().length > 0;
    if (!/^[a-f0-9]{40}$/u.test(gitCommit)) return { status: "unavailable" };
    return { status: "observed", gitCommit, dirty };
  } catch {
    return { status: "unavailable" };
  }
}

function executeChild(
  kernelId: ReferenceKernelId,
  modelId: string,
  repeatRuns: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        "--worker",
        "--kernel",
        kernelId,
        "--model",
        modelId,
        "--repeat-runs",
        String(repeatRuns),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: CASE_WORKER_TIMEOUT_MS,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          const context = `${kernelId}/${modelId}`;
          const reason =
            error.killed || error.signal === "SIGKILL"
              ? `exceeded ${CASE_WORKER_TIMEOUT_MS} ms and was killed`
              : `failed: ${error.message}`;
          // execFile invokes this callback after child exit and stdio close, so
          // a timed-out worker has been killed and reaped before rejection.
          reject(
            new Error(
              `Reference benchmark worker '${context}' ${reason}${
                stderr.trim().length === 0 ? "" : `\n${stderr}`
              }`,
              { cause: error },
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      kernel: { type: "string", default: "manifold" },
      model: { type: "string", multiple: true },
      "repeat-runs": { type: "string", default: "2" },
      worker: { type: "boolean", default: false },
    },
    strict: true,
  });

  const repeatRuns = parsePositiveInteger(
    values["repeat-runs"],
    "--repeat-runs",
    20,
  );

  if (values.worker) {
    const kernels = selectedKernels(values.kernel);
    const models = selectedModels(values.model);
    if (kernels.length !== 1 || models.length !== 1) {
      throw new RangeError(
        "A benchmark worker requires exactly one kernel and one model",
      );
    }
    const result = await executeCase(kernels[0]!, models[0]!, repeatRuns);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const kernels = selectedKernels(values.kernel);
  const models = selectedModels(values.model);
  const cases: BenchmarkCase[] = [];
  for (const kernelId of kernels) {
    for (const modelId of models) {
      const model = modelById(modelId);
      if (!model.supportedKernels.includes(kernelId)) continue;
      const stdout = await executeChild(kernelId, modelId, repeatRuns);
      const parsed: unknown = JSON.parse(stdout);
      validateBenchmarkCase(parsed, {
        kernelId,
        modelId,
        outputName: model.outputName,
        repeatRuns,
      });
      cases.push(parsed);
    }
  }
  enforceCrossKernelCanonicalIdentity(cases);

  const packageJson: unknown = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (!isRecord(packageJson) || typeof packageJson.version !== "string") {
    throw new TypeError("package.json does not contain a package version");
  }
  const cpuList = cpus();
  const report: BenchmarkReport = {
    kind: REPORT_KIND,
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    source: {
      packageVersion: packageJson.version,
      revision: sourceRevision(),
    },
    environment: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      architecture: process.arch,
      cpuModel: cpuList[0]?.model ?? "unknown",
      logicalCpuCount: cpuList.length,
      totalMemoryBytes: totalmem(),
      clock: "node:perf_hooks.performance.now",
    },
    semantics: {
      isolation: "fresh-child-process-per-kernel-model",
      firstRun:
        "new process, new kernel, new evaluator, fresh buildDocument call, first evaluation",
      repeatRun:
        "fresh buildDocument call with identical canonical bytes, same kernel and evaluator, previous result disposed",
      evaluatorCache: "disabled",
      excludedColdnessClaims: EXCLUDED_COLDNESS_CLAIMS,
    },
    request: {
      kernels,
      models,
      repeatRuns,
      caseWorkerTimeoutMs: CASE_WORKER_TIMEOUT_MS,
    },
    cases,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return (
    entryPoint !== undefined &&
    pathToFileURL(resolve(entryPoint)).href === import.meta.url
  );
}

if (isMainModule()) {
  await main();
}
