import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  design,
  kgPerCubicMeter,
  mm,
  stringifyDocument,
  vec3,
} from "../src/index.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

describe("CLI", () => {
  it("prints help successfully when --help is the first argument", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "--help"],
      { cwd: projectRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("InvariantCAD CLI");
    expect(result.stdout).toContain("invariantcad export");
  });

  it("reports center of mass and inertia in inspect JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-measurements");
      cad.output(
        "solid",
        cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) }),
      );
      const documentPath = join(directory, "model.json");
      await writeFile(documentPath, stringifyDocument(cad.build()));

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "inspect", documentPath],
        { cwd: projectRoot, encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout) as {
        readonly solid: {
          readonly centerOfMass: readonly number[] | null;
          readonly inertiaTensor: readonly (readonly number[])[];
          readonly principalInertia: {
            readonly moments: readonly number[];
            readonly degeneracy: string;
          };
          readonly worldRadiiOfGyration: readonly number[] | null;
          readonly principalRadiiOfGyration: readonly number[] | null;
          readonly physicalMassProperties?: unknown;
        };
      };
      expect(report.solid.centerOfMass).not.toBeNull();
      report.solid.centerOfMass?.forEach((coordinate, index) => {
        expect(coordinate).toBeCloseTo([1, 1.5, 2][index]!, 8);
      });
      const expectedTensor = [
        [50, 0, 0],
        [0, 40, 0],
        [0, 0, 26],
      ] as const;
      expect(report.solid.inertiaTensor).toHaveLength(3);
      report.solid.inertiaTensor.forEach((row, rowIndex) => {
        expect(row).toHaveLength(3);
        row.forEach((entry, columnIndex) => {
          expect(entry).toBeCloseTo(
            expectedTensor[rowIndex]![columnIndex]!,
            8,
          );
        });
      });
      expect(report.solid.principalInertia.moments).toEqual([26, 40, 50]);
      expect(report.solid.principalInertia.degeneracy).toBe("distinct");
      report.solid.worldRadiiOfGyration?.forEach((radius, index) => {
        expect(radius).toBeCloseTo(
          [Math.sqrt(50 / 24), Math.sqrt(40 / 24), Math.sqrt(26 / 24)][
            index
          ]!,
          12,
        );
      });
      report.solid.principalRadiiOfGyration?.forEach((radius, index) => {
        expect(radius).toBeCloseTo(
          [Math.sqrt(26 / 24), Math.sqrt(40 / 24), Math.sqrt(50 / 24)][
            index
          ]!,
          12,
        );
      });
      expect(report.solid.physicalMassProperties).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("reports physical analysis or a structured missing-density result for parts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-physical-mass");
      const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });
      cad.output(
        "dense",
        cad.part("dense", solid, {
          material: "Test steel",
          massDensity: kgPerCubicMeter(7_850),
        }),
      );
      cad.output("missing", cad.part("missing", solid));
      const documentPath = join(directory, "model.json");
      await writeFile(documentPath, stringifyDocument(cad.build()));

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "inspect", documentPath],
        { cwd: projectRoot, encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout) as {
        readonly dense: {
          readonly physicalMassProperties: {
            readonly mass: number;
            readonly inertiaTensor: readonly (readonly number[])[];
            readonly principalInertia: { readonly moments: readonly number[] };
            readonly principalRadiiOfGyration: readonly number[];
          };
        };
        readonly missing: {
          readonly physicalMassProperties: null;
          readonly physicalMassDiagnostics: readonly {
            readonly code: string;
          }[];
        };
      };
      expect(report.dense.physicalMassProperties.mass).toBeCloseTo(
        0.0001884,
        12,
      );
      expect(report.dense.physicalMassProperties.inertiaTensor[0]![0]).toBeCloseTo(
        0.0003925,
        12,
      );
      report.dense.physicalMassProperties.principalInertia.moments.forEach(
        (moment, index) => {
          expect(moment).toBeCloseTo(
            [0.0002041, 0.000314, 0.0003925][index]!,
            12,
          );
        },
      );
      report.dense.physicalMassProperties.principalRadiiOfGyration.forEach(
        (radius, index) => {
          expect(radius).toBeCloseTo(
            [Math.sqrt(26 / 24), Math.sqrt(40 / 24), Math.sqrt(50 / 24)][
              index
            ]!,
            12,
          );
        },
      );
      expect(report.missing.physicalMassProperties).toBeNull();
      expect(report.missing.physicalMassDiagnostics).toContainEqual(
        expect.objectContaining({ code: "MASS_DENSITY_MISSING" }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("selects the exact kernel automatically for STEP export", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-step");
      cad.output(
        "solid",
        cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) }),
      );
      const documentPath = join(directory, "model.json");
      const outputPath = join(directory, "model.step");
      await writeFile(documentPath, stringifyDocument(cad.build()));
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "export",
          documentPath,
          "--to",
          outputPath,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe(`Wrote ${outputPath}`);
      expect((await stat(outputPath)).size).toBeGreaterThan(100);
      expect(await readFile(outputPath, "utf8")).toContain("ISO-10303-21");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
