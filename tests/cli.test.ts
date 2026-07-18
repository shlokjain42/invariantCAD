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
  tf,
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
    expect(result.stdout).toContain("invariantcad bom");
    expect(result.stdout).toContain("invariantcad export");
  });

  it("rolls up a nested material-backed assembly with parameter overrides", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-bom");
      const density = cad.parameter.massDensity(
        "alloy-density",
        kgPerCubicMeter(1_000),
      );
      const alloy = cad.material("alloy", {
        name: "Parameterized Alloy",
        massDensity: density,
      });
      const solid = cad.box("solid", {
        size: vec3(mm(2), mm(3), mm(4)),
      });
      const standard = cad.part("standard", solid, {
        partNumber: "A-100",
        materialRef: alloy,
      });
      const override = cad.part("override", solid, {
        partNumber: "B-200",
        materialRef: alloy,
        massDensity: kgPerCubicMeter(5_000),
      });
      const nested = cad.assembly("nested", (assembly) => {
        assembly.instance("left", standard);
        assembly.instance("right", standard, {
          placement: [tf.translate(vec3(mm(10), mm(0), mm(0)))],
        });
      });
      const product = cad.assembly("product", (assembly) => {
        assembly.instance("nested", nested);
        assembly.instance("override", override);
      });
      cad.output("product", product);

      const documentPath = join(directory, "model.json");
      const parametersPath = join(directory, "parameters.json");
      await writeFile(documentPath, stringifyDocument(cad.build()));
      await writeFile(
        parametersPath,
        JSON.stringify({ "alloy-density": 2_000e-9 }),
      );

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "bom",
          documentPath,
          "--output",
          "product",
          "--parameters",
          parametersPath,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout) as {
        readonly output: string;
        readonly units: { readonly mass: string };
        readonly items: readonly {
          readonly partNode: string;
          readonly partNumber: string | null;
          readonly materialId: string | null;
          readonly material: string | null;
          readonly quantity: number;
          readonly occurrenceIds: readonly string[];
          readonly massDensity: number | null;
          readonly massDensitySource: string | null;
          readonly definitionMass: number | null;
          readonly totalMass: number | null;
        }[];
        readonly totalQuantity: number;
        readonly massComplete: boolean;
        readonly knownMass: number;
        readonly totalMass: number | null;
        readonly diagnostics: readonly unknown[];
      };
      expect(report.output).toBe("product");
      expect(report.units).toEqual({ mass: "kg" });
      expect(report.totalQuantity).toBe(3);
      expect(report.massComplete).toBe(true);
      expect(report.knownMass).toBeCloseTo(0.000216, 12);
      expect(report.totalMass).toBeCloseTo(0.000216, 12);
      expect(report.diagnostics).toEqual([]);
      expect(report.items).toHaveLength(2);

      const standardItem = report.items.find(
        (item) => item.partNode === "standard",
      );
      expect(standardItem).toEqual(
        expect.objectContaining({
          partNumber: "A-100",
          materialId: "alloy",
          material: "Parameterized Alloy",
          quantity: 2,
          occurrenceIds: ["nested/left", "nested/right"],
          massDensitySource: "material",
        }),
      );
      expect(standardItem?.massDensity).toBeCloseTo(2e-6, 15);
      expect(standardItem?.definitionMass).toBeCloseTo(0.000048, 12);
      expect(standardItem?.totalMass).toBeCloseTo(0.000096, 12);

      const overrideItem = report.items.find(
        (item) => item.partNode === "override",
      );
      expect(overrideItem).toEqual(
        expect.objectContaining({
          partNumber: "B-200",
          materialId: "alloy",
          material: "Parameterized Alloy",
          quantity: 1,
          occurrenceIds: ["override"],
          massDensitySource: "part",
        }),
      );
      expect(overrideItem?.massDensity).toBeCloseTo(5e-6, 15);
      expect(overrideItem?.definitionMass).toBeCloseTo(0.00012, 12);
      expect(overrideItem?.totalMass).toBeCloseTo(0.00012, 12);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("requires a BOM output and rejects raw-solid outputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-bom-boundaries");
      cad.output(
        "solid",
        cad.box("solid", { size: vec3(mm(1), mm(1), mm(1)) }),
      );
      const documentPath = join(directory, "model.json");
      await writeFile(documentPath, stringifyDocument(cad.build()));

      const missingOutput = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", "bom", documentPath],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(missingOutput.status).toBe(2);
      expect(missingOutput.stderr).toContain("bom requires --output <name>");

      const rawSolid = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "bom",
          documentPath,
          "--output",
          "solid",
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(rawSolid.status).toBe(1);
      expect(rawSolid.stderr).toContain("BOM_OUTPUT_UNSUPPORTED");
      expect(rawSolid.stdout).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("emits an incomplete BOM with warning diagnostics and a zero exit code", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-incomplete-bom");
      const solid = cad.box("solid", {
        size: vec3(mm(2), mm(3), mm(4)),
      });
      cad.output(
        "part",
        cad.part("part", solid, {
          partNumber: "NO-DENSITY",
          material: "Unspecified grade",
        }),
      );
      const documentPath = join(directory, "model.json");
      await writeFile(documentPath, stringifyDocument(cad.build()));

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "bom",
          documentPath,
          "--output",
          "part",
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout) as {
        readonly totalQuantity: number;
        readonly massComplete: boolean;
        readonly knownMass: number;
        readonly totalMass: number | null;
        readonly diagnostics: readonly { readonly code: string }[];
      };
      expect(report.totalQuantity).toBe(1);
      expect(report.massComplete).toBe(false);
      expect(report.knownMass).toBe(0);
      expect(report.totalMass).toBeNull();
      expect(report.diagnostics).toContainEqual(
        expect.objectContaining({ code: "MASS_DENSITY_MISSING" }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

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
