import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { describe, expect, it } from "vitest";

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
        "manifold",
        "--model",
        "electronics-enclosure",
        "--repeat-runs",
        "1",
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
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

describe("reference-model benchmark protocol", () => {
  it(
    "emits truthful fresh-runtime and same-runtime evidence without thresholds",
    async () => {
      const report = JSON.parse(await runBenchmark()) as {
        readonly kind: string;
        readonly schemaVersion: number;
        readonly semantics: {
          readonly isolation: string;
          readonly evaluatorCache: string;
          readonly excludedColdnessClaims: readonly string[];
        };
        readonly request: {
          readonly repeatRuns: number;
        };
        readonly cases: readonly {
          readonly runs: {
            readonly first: {
              readonly class: string;
              readonly document: {
                readonly canonicalSha256: string;
              };
              readonly tessellation: {
                readonly triangles: number;
              };
              readonly outputs: {
                readonly binaryStl: {
                  readonly byteLength: number;
                };
                readonly step: {
                  readonly status: string;
                  readonly reason: string;
                };
              };
            };
            readonly repeats: readonly {
              readonly class: string;
              readonly document: {
                readonly canonicalSha256: string;
              };
            }[];
          };
          readonly memory: {
            readonly status: string;
            readonly metric: string;
            readonly unit: string;
            readonly boundaries: {
              readonly afterImports: number;
              readonly afterKernelInitialization: number;
              readonly afterFirstRunDisposal: number;
              readonly afterRepeatRunDisposals: readonly number[];
              readonly afterEvaluatorDisposal: number;
            };
            readonly caveats: readonly string[];
          };
          readonly nativeHandles: {
            readonly status: string;
            readonly reasonCode: string;
          };
        }[];
      };

      expect(report.kind).toBe("invariantcad-reference-model-benchmark");
      expect(report.schemaVersion).toBe(2);
      expect(report.semantics.isolation).toBe(
        "fresh-child-process-per-kernel-model",
      );
      expect(report.semantics.evaluatorCache).toBe("disabled");
      expect(report.semantics.excludedColdnessClaims).toContain("machine-cold");
      expect(report.request.repeatRuns).toBe(1);
      expect(report.cases).toHaveLength(1);

      const benchmarkCase = report.cases[0]!;
      expect(benchmarkCase.runs.first.class).toBe(
        "fresh-runtime-first-run",
      );
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
    },
    60_000,
  );
});
