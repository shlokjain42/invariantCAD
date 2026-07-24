import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { beforeAll, describe, expect, it } from "vitest";
import {
  enforceCrossKernelCanonicalIdentity,
  validateBenchmarkCase,
  type BenchmarkCase,
  type BenchmarkCaseExpectation,
  type BenchmarkReport,
} from "../scripts/benchmark-reference-models.js";

const EXPECTED_CASE = Object.freeze({
  kernelId: "manifold",
  modelId: "electronics-enclosure",
  outputName: "enclosure",
  repeatRuns: 1,
} as const satisfies BenchmarkCaseExpectation);

function runBenchmark(): Promise<string> {
  const script = fileURLToPath(
    new URL("../scripts/benchmark-reference-models.ts", import.meta.url),
  );
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        "--import",
        "tsx",
        script,
        "--kernel",
        EXPECTED_CASE.kernelId,
        "--model",
        EXPECTED_CASE.modelId,
        "--repeat-runs",
        String(EXPECTED_CASE.repeatRuns),
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 30_000,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`${error.message}\n${stderr}`, { cause: error }));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function cloneCase(
  benchmarkCase: BenchmarkCase,
): Record<string, unknown> {
  return structuredClone(benchmarkCase) as unknown as Record<string, unknown>;
}

describe("reference-model benchmark protocol", () => {
  let report: BenchmarkReport;

  beforeAll(async () => {
    report = JSON.parse(await runBenchmark()) as BenchmarkReport;
  }, 60_000);

  it("emits truthful fresh-runtime and same-runtime evidence without thresholds", () => {
    expect(report.kind).toBe("invariantcad-reference-model-benchmark");
    expect(report.schemaVersion).toBe(2);
    expect(report.semantics.isolation).toBe(
      "fresh-child-process-per-kernel-model",
    );
    expect(report.semantics.evaluatorCache).toBe("disabled");
    expect(report.semantics.excludedColdnessClaims).toContain("machine-cold");
    expect(report.request.repeatRuns).toBe(1);
    expect(report.request.caseWorkerTimeoutMs).toBe(120_000);
    expect(report.cases).toHaveLength(1);

    const benchmarkCase = report.cases[0]!;
    expect(() =>
      validateBenchmarkCase(benchmarkCase, EXPECTED_CASE),
    ).not.toThrow();
    expect(benchmarkCase.runs.first.class).toBe(
      "fresh-runtime-first-run",
    );
    expect(benchmarkCase.runs.first.ordinal).toBe(0);
    expect(benchmarkCase.runs.repeats).toHaveLength(1);
    expect(benchmarkCase.runs.repeats[0]!.class).toBe(
      "same-runtime-repeat",
    );
    expect(
      benchmarkCase.runs.repeats[0]!.document.canonicalSha256,
    ).toBe(benchmarkCase.runs.first.document.canonicalSha256);
    expect(benchmarkCase.runs.first.outputs.binaryStl.byteLength).toBe(
      84 + benchmarkCase.runs.first.tessellation.triangles * 50,
    );
    expect(benchmarkCase.runs.first.outputs.step).toEqual({
      status: "unsupported",
      reason: "kernel-does-not-advertise-step-export",
    });

    expect(benchmarkCase.memory.status).toBe("observed");
    expect(benchmarkCase.memory.metric).toBe(
      "process-max-rss-high-water",
    );
    expect(benchmarkCase.memory.unit).toBe("KiB");
    expect(benchmarkCase.memory.caveats).toContain(
      "process-wide, not model-only",
    );
    const memoryBoundaries = [
      benchmarkCase.memory.boundaries.afterImports,
      benchmarkCase.memory.boundaries.afterKernelInitialization,
      benchmarkCase.memory.boundaries.afterFirstRunDisposal,
      ...benchmarkCase.memory.boundaries.afterRepeatRunDisposals,
      benchmarkCase.memory.boundaries.afterEvaluatorDisposal,
    ];
    expect(
      memoryBoundaries.every(
        (value, index) =>
          index === 0 || value >= memoryBoundaries[index - 1]!,
      ),
    ).toBe(true);
    expect(benchmarkCase.nativeHandles).toEqual({
      status: "unsupported",
      metric: "peak-live-native-handles",
      reasonCode: "kernel-telemetry-unavailable",
      detail:
        "GeometryKernel protocol v1 exposes disposal but no native allocation counter",
    });
  });

  it("rejects unknown case fields and a mismatched requested tuple", () => {
    const extraField = cloneCase(report.cases[0]!);
    extraField.unexpected = true;
    expect(() =>
      validateBenchmarkCase(extraField, EXPECTED_CASE),
    ).toThrow(/keys must be exactly/u);

    expect(() =>
      validateBenchmarkCase(report.cases[0], {
        ...EXPECTED_CASE,
        outputName: "wrong-output",
      }),
    ).toThrow(/requested model\/output/u);
    expect(() =>
      validateBenchmarkCase(report.cases[0], {
        ...EXPECTED_CASE,
        kernelId: "occt",
      }),
    ).toThrow(/requested kernel/u);
  });

  it("rejects a nonzero first ordinal and altered tessellation controls", () => {
    const wrongOrdinal = cloneCase(report.cases[0]!) as unknown as {
      readonly runs: {
        readonly first: {
          ordinal: number;
        };
      };
    };
    wrongOrdinal.runs.first.ordinal = 1;
    expect(() =>
      validateBenchmarkCase(wrongOrdinal, EXPECTED_CASE),
    ).toThrow(/ordinal 0/u);

    const alteredTessellation = cloneCase(
      report.cases[0]!,
    ) as unknown as {
      readonly tessellationControl: {
        readonly requestedOptions: Record<string, unknown>;
      };
    };
    alteredTessellation.tessellationControl.requestedOptions.linearDeflection =
      0.2;
    expect(() =>
      validateBenchmarkCase(alteredTessellation, EXPECTED_CASE),
    ).toThrow(/Manifold tessellation options/u);

    const alteredNote = cloneCase(report.cases[0]!) as unknown as {
      readonly tessellationControl: {
        note: string;
      };
    };
    alteredNote.tessellationControl.note = "implicit defaults";
    expect(() =>
      validateBenchmarkCase(alteredNote, EXPECTED_CASE),
    ).toThrow(/tessellation control is inconsistent/u);
  });

  it("rejects different canonical documents for the same model across kernels", () => {
    const first = structuredClone(report.cases[0]!);
    const second = structuredClone(report.cases[0]!) as unknown as {
      kernel: { id: "manifold" | "occt" };
      runs: {
        first: {
          document: {
            canonicalUtf8Bytes: number;
            canonicalSha256: string;
          };
        };
      };
    };
    second.kernel.id = "occt";
    second.runs.first.document.canonicalUtf8Bytes += 1;
    second.runs.first.document.canonicalSha256 = "b".repeat(64);
    expect(() =>
      enforceCrossKernelCanonicalIdentity([
        first,
        second as unknown as BenchmarkCase,
      ]),
    ).toThrow(/differs between kernels/u);
  });
});
