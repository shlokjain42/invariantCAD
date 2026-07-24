import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
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

interface BenchmarkCase {
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

interface BenchmarkReport {
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
  };
  readonly cases: readonly BenchmarkCase[];
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
  validateCase(result, repeatRuns);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  expectedSamples: number,
): asserts value is TimingSummary {
  if (
    !isRecord(value) ||
    !Array.isArray(value.samples) ||
    value.samples.length !== expectedSamples ||
    value.samples.some((sample) => !nonNegativeFinite(sample)) ||
    !nonNegativeFinite(value.min) ||
    !nonNegativeFinite(value.median) ||
    !nonNegativeFinite(value.max)
  ) {
    throw new TypeError("Benchmark repeat timing summary is invalid");
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

function validateRun(value: unknown): asserts value is BenchmarkRun {
  if (!isRecord(value)) throw new TypeError("Benchmark run must be an object");
  if (
    value.class !== "fresh-runtime-first-run" &&
    value.class !== "same-runtime-repeat"
  ) {
    throw new TypeError("Benchmark run class is invalid");
  }
  if (
    !Number.isSafeInteger(value.ordinal) ||
    (value.ordinal as number) < 0
  ) {
    throw new TypeError("Benchmark run ordinal is invalid");
  }
  if (!isRecord(value.document)) {
    throw new TypeError("Benchmark document evidence is invalid");
  }
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
  if (!isRecord(value.tessellation)) {
    throw new TypeError("Benchmark tessellation evidence is invalid");
  }
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
  if (
    value.outputs.step.status === "observed"
      ? !positiveSafeInteger(value.outputs.step.byteLength)
      : value.outputs.step.status !== "unsupported" ||
        (value.outputs.step.reason !==
          "kernel-does-not-advertise-step-export" &&
          value.outputs.step.reason !==
            "output-does-not-support-native-export")
  ) {
    throw new TypeError("Benchmark STEP evidence is invalid");
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

function validateCase(
  value: unknown,
  expectedRepeatRuns: number,
): asserts value is BenchmarkCase {
  if (!isRecord(value)) throw new TypeError("Benchmark case must be an object");
  if (
    !isRecord(value.kernel) ||
    (value.kernel.id !== "manifold" && value.kernel.id !== "occt") ||
    !positiveSafeInteger(value.kernel.protocolVersion) ||
    typeof value.kernel.representation !== "string" ||
    typeof value.kernel.exact !== "boolean" ||
    !isRecord(value.model) ||
    typeof value.model.id !== "string" ||
    typeof value.model.output !== "string" ||
    !isRecord(value.tessellationControl) ||
    !nonNegativeFinite(value.initializationMs) ||
    !nonNegativeFinite(value.evaluatorDisposalMs)
  ) {
    throw new TypeError("Benchmark kernel evidence is invalid");
  }
  if (
    value.kernel.id === "manifold"
      ? value.tessellationControl.mode !==
        "authored-segmentation-and-kernel-default"
      : value.tessellationControl.mode !== "explicit-mesh-options"
  ) {
    throw new TypeError("Benchmark tessellation control is inconsistent");
  }
  if (!isRecord(value.runs) || !Array.isArray(value.runs.repeats)) {
    throw new TypeError("Benchmark runs are invalid");
  }
  validateRun(value.runs.first);
  if (value.runs.first.class !== "fresh-runtime-first-run") {
    throw new TypeError("Benchmark first run has the wrong class");
  }
  if (value.runs.repeats.length !== expectedRepeatRuns) {
    throw new TypeError("Benchmark repeat count is inconsistent");
  }
  for (let index = 0; index < value.runs.repeats.length; index += 1) {
    const repeat = value.runs.repeats[index];
    validateRun(repeat);
    if (
      repeat.class !== "same-runtime-repeat" ||
      repeat.ordinal !== index + 1 ||
      repeat.document.canonicalSha256 !==
        value.runs.first.document.canonicalSha256 ||
      repeat.document.canonicalUtf8Bytes !==
        value.runs.first.document.canonicalUtf8Bytes
    ) {
      throw new TypeError("Benchmark repeated-run evidence is inconsistent");
    }
  }
  if (!isRecord(value.runs.repeatTimingSummaryMs)) {
    throw new TypeError("Benchmark repeat timing summaries are invalid");
  }
  for (const field of [
    "documentBuild",
    "canonicalSerialization",
    "evaluation",
    "measurement",
    "physicalMassProperties",
    "tessellation",
    "stlSerialization",
    "resultDisposal",
    "workflowTotal",
  ] as const) {
    validateTimingSummary(
      value.runs.repeatTimingSummaryMs[field],
      expectedRepeatRuns,
    );
  }
  const stepSummary = value.runs.repeatTimingSummaryMs.stepSerialization;
  if (value.runs.first.outputs.step.status === "observed") {
    validateTimingSummary(stepSummary, expectedRepeatRuns);
  } else if (stepSummary !== null) {
    throw new TypeError("Benchmark STEP timing summary is inconsistent");
  }
  if (
    !isRecord(value.memory) ||
    value.memory.status !== "observed" ||
    value.memory.metric !== "process-max-rss-high-water" ||
    value.memory.source !== "process.resourceUsage().maxRSS" ||
    value.memory.unit !== "KiB" ||
    value.memory.scope !==
      "dedicated model worker process, including Node.js, modules, JavaScript, WebAssembly, and kernel state" ||
    !Array.isArray(value.memory.caveats) ||
    value.memory.caveats.length !== MEMORY_CAVEATS.length ||
    !MEMORY_CAVEATS.every(
      (caveat, index) => value.memory.caveats[index] === caveat,
    ) ||
    !isRecord(value.memory.boundaries) ||
    !Array.isArray(value.memory.boundaries.afterRepeatRunDisposals) ||
    value.memory.boundaries.afterRepeatRunDisposals.length !==
      expectedRepeatRuns
  ) {
    throw new TypeError("Benchmark memory evidence is invalid");
  }
  const boundaries = [
    value.memory.boundaries.afterImports,
    value.memory.boundaries.afterKernelInitialization,
    value.memory.boundaries.afterFirstRunDisposal,
    ...value.memory.boundaries.afterRepeatRunDisposals,
    value.memory.boundaries.afterEvaluatorDisposal,
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

function executeChild(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", fileURLToPath(import.meta.url), ...args],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            new Error(
              `Reference benchmark worker failed: ${error.message}\n${stderr}`,
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
} else {
  const kernels = selectedKernels(values.kernel);
  const models = selectedModels(values.model);
  const cases: BenchmarkCase[] = [];
  for (const kernelId of kernels) {
    for (const modelId of models) {
      const model = modelById(modelId);
      if (!model.supportedKernels.includes(kernelId)) continue;
      const stdout = await executeChild([
        "--worker",
        "--kernel",
        kernelId,
        "--model",
        modelId,
        "--repeat-runs",
        String(repeatRuns),
      ]);
      const parsed: unknown = JSON.parse(stdout);
      validateCase(parsed, repeatRuns);
      cases.push(parsed);
    }
  }

  const packageJson: unknown = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (
    !isRecord(packageJson) ||
    typeof packageJson.version !== "string"
  ) {
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
    },
    cases,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
