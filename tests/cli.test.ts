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

function invokeCli(arguments_: readonly string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", ...arguments_],
    { cwd: projectRoot, encoding: "utf8" },
  );
}

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

    const commandHelp = invokeCli(["inspect", "--help"]);
    expect(commandHelp.status).toBe(0);
    expect(commandHelp.stderr).toBe("");
    expect(commandHelp.stdout).toContain("InvariantCAD CLI");
  });

  it("rejects unknown, stray, inapplicable, missing, and duplicate options before document I/O", () => {
    const missingDocument = join(
      tmpdir(),
      `invariantcad-cli-missing-${process.pid}.json`,
    );
    const cases = [
      {
        arguments: ["not-a-command", missingDocument],
        option: "Unknown command",
      },
      {
        arguments: ["--help", "--definitely-not-a-real-option"],
        option: "--definitely-not-a-real-option",
      },
      {
        arguments: [
          "validate",
          missingDocument,
          "--definitely-not-a-real-option",
        ],
        option: "--definitely-not-a-real-option",
      },
      {
        arguments: ["validate", missingDocument, "stray-document.json"],
        option: "stray-document.json",
      },
      {
        arguments: ["inspect", ""],
        option: "document path",
      },
      {
        arguments: ["validate", missingDocument, "--kernel", "manifold"],
        option: "--kernel",
      },
      {
        arguments: [
          "validate",
          missingDocument,
          "--parameter",
          "width=5",
        ],
        option: "--parameter",
      },
      {
        arguments: ["inspect", missingDocument, "--to", "ignored.stl"],
        option: "--to",
      },
      {
        arguments: ["bom", missingDocument, "--format", "obj"],
        option: "--format",
      },
      {
        arguments: ["inspect", missingDocument, "--configuration"],
        option: "--configuration",
      },
      {
        arguments: ["inspect", missingDocument, "--kernel"],
        option: "--kernel",
      },
      {
        arguments: ["inspect", missingDocument, "--parameters"],
        option: "--parameters",
      },
      {
        arguments: ["inspect", missingDocument, "--output"],
        option: "--output",
      },
      {
        arguments: ["inspect", missingDocument, "--parameter"],
        option: "--parameter",
      },
      {
        arguments: ["bom", missingDocument, "--output"],
        option: "--output",
      },
      {
        arguments: ["export", missingDocument, "--to"],
        option: "--to",
      },
      {
        arguments: [
          "export",
          missingDocument,
          "--to",
          "model.stl",
          "--format",
        ],
        option: "--format",
      },
      {
        arguments: [
          "inspect",
          missingDocument,
          "--kernel",
          "manifold",
          "--kernel=occt",
        ],
        option: "--kernel",
      },
      {
        arguments: ["inspect", missingDocument, "--help", "--help"],
        option: "--help",
      },
      {
        arguments: ["inspect", missingDocument, "--configuration="],
        option: "--configuration",
      },
      {
        arguments: ["inspect", "--help", "--kernel", "not-a-kernel"],
        option: "not-a-kernel",
      },
    ] as const;

    for (const testCase of cases) {
      const result = invokeCli(testCase.arguments);

      expect(result.status, testCase.arguments.join(" ")).toBe(2);
      expect(result.stdout, testCase.arguments.join(" ")).toBe("");
      expect(result.stderr, testCase.arguments.join(" ")).toContain(
        testCase.option,
      );
      expect(result.stderr, testCase.arguments.join(" ")).toContain("Usage:");
      expect(result.stderr, testCase.arguments.join(" ")).not.toContain(
        "ENOENT",
      );
    }
  }, 30_000);

  it("rejects malformed or ambiguous inline parameters before document I/O", () => {
    const missingDocument = join(
      tmpdir(),
      `invariantcad-cli-missing-parameters-${process.pid}.json`,
    );
    const malformed = [
      ["inspect", missingDocument, "--parameter", "width"],
      ["inspect", missingDocument, "--parameter", "width="],
      ["inspect", missingDocument, "--parameter", "width=NaN"],
      ["inspect", missingDocument, "--parameter", "width=Infinity"],
      ["inspect", missingDocument, "--parameter", "width=0x10"],
      ["inspect", missingDocument, "--parameter", "width=+5"],
      ["inspect", missingDocument, "--parameter", "width=.5"],
      ["inspect", missingDocument, "--parameter", "width=5mm"],
      ["inspect", missingDocument, "--parameter", "width=true"],
      ["inspect", missingDocument, "--parameter", "width=null"],
      [
        "inspect",
        missingDocument,
        "--parameter",
        "width=5",
        "--parameter=width=6",
      ],
      [
        "inspect",
        missingDocument,
        "--parameters",
        "values.json",
        "--parameter",
        "width=5",
      ],
      ["inspect", "--help", "--parameter", "width=NaN"],
      [
        "inspect",
        "--help",
        "--parameter",
        "width=5",
        "--parameter=width=6",
      ],
      [
        "inspect",
        "--help",
        "--parameters",
        "values.json",
        "--parameter",
        "width=5",
      ],
    ] as const;

    for (const arguments_ of malformed) {
      const result = invokeCli(arguments_);

      expect(result.status, arguments_.join(" ")).toBe(2);
      expect(result.stdout, arguments_.join(" ")).toBe("");
      expect(result.stderr, arguments_.join(" ")).toContain("parameter");
      expect(result.stderr, arguments_.join(" ")).toContain("Usage:");
      expect(result.stderr, arguments_.join(" ")).not.toContain("ENOENT");
    }
  }, 30_000);

  it("applies repeatable finite inline parameters above named configurations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-inline-parameters");
      const width = cad.parameter.length("width", mm(2));
      const height = cad.parameter.length("height", mm(3));
      const offset = cad.parameter.length("offset", mm(0));
      const solid = cad.box("solid", {
        size: vec3(width, height, mm(4)),
      });
      const moved = cad.transform("moved", solid, [
        tf.translate(vec3(offset, mm(0), mm(0))),
      ]);
      const part = cad.part("part", moved, {
        massDensity: kgPerCubicMeter(1_000),
      });
      cad.configuration("configured", (configuration) => {
        configuration.parameter(width, mm(5));
        configuration.parameter(height, mm(6));
        configuration.parameter(offset, mm(10));
      });
      cad.output("moved", moved);
      cad.output("part", part);

      const documentPath = join(directory, "model.json");
      const exportPath = join(directory, "moved.obj");
      await writeFile(documentPath, stringifyDocument(cad.build()));

      const overrides = [
        "--configuration",
        "configured",
        "--parameter",
        "width=7.5",
        "--parameter=height=8e0",
        "--parameter",
        "offset=-1.25e1",
      ] as const;
      const result = invokeCli([
        "inspect",
        documentPath,
        "--output",
        "moved",
        ...overrides,
      ]);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout) as {
        readonly moved: {
          readonly volume: number;
          readonly boundingBox: {
            readonly min: readonly number[];
            readonly max: readonly number[];
          };
        };
      };
      expect(report.moved.volume).toBeCloseTo(240, 10);
      expect(report.moved.boundingBox.min).toEqual([-12.5, 0, 0]);
      expect(report.moved.boundingBox.max).toEqual([-5, 8, 4]);

      const bomResult = invokeCli([
        "bom",
        documentPath,
        "--output",
        "part",
        ...overrides,
      ]);
      expect(bomResult.status).toBe(0);
      expect(bomResult.stderr).toBe("");
      const bom = JSON.parse(bomResult.stdout) as {
        readonly totalQuantity: number;
        readonly totalMass: number | null;
      };
      expect(bom.totalQuantity).toBe(1);
      expect(bom.totalMass).toBeCloseTo(0.00024, 12);

      const exportResult = invokeCli([
        "export",
        documentPath,
        "--output",
        "moved",
        "--to",
        exportPath,
        ...overrides,
      ]);
      expect(exportResult.status).toBe(0);
      expect(exportResult.stderr).toBe("");
      const vertices = (await readFile(exportPath, "utf8"))
        .split("\n")
        .filter((line) => line.startsWith("v "))
        .map((line) => line.split(/\s+/).slice(1).map(Number));
      expect(vertices.length).toBeGreaterThan(0);
      expect(Math.min(...vertices.map((vertex) => vertex[0]!))).toBeCloseTo(
        -12.5,
        10,
      );
      expect(Math.max(...vertices.map((vertex) => vertex[0]!))).toBeCloseTo(
        -5,
        10,
      );
      expect(Math.max(...vertices.map((vertex) => vertex[1]!))).toBeCloseTo(
        8,
        10,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("addresses exact parameter keys in directly evaluable legacy documents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-legacy-parameter-key");
      const width = cad.parameter.length("width", mm(2));
      cad.output(
        "solid",
        cad.box("solid", { size: vec3(width, mm(3), mm(4)) }),
      );
      const current = stringifyDocument(cad.build());
      const legacyEqualsPath = join(directory, "legacy-equals.json");
      const legacyEmptyPath = join(directory, "legacy-empty.json");
      const legacyDashPath = join(directory, "legacy-dash.json");
      await writeFile(
        legacyEqualsPath,
        current.replaceAll('"width"', '"legacy=width"'),
      );
      await writeFile(
        legacyEmptyPath,
        current.replaceAll('"width"', '""'),
      );
      await writeFile(
        legacyDashPath,
        current.replaceAll('"width"', '"-legacy"'),
      );

      const equalsResult = invokeCli([
        "inspect",
        legacyEqualsPath,
        "--parameter=legacy=width=5",
      ]);
      expect(equalsResult.status).toBe(0);
      expect(equalsResult.stderr).toBe("");
      expect(
        (JSON.parse(equalsResult.stdout) as { solid: { volume: number } }).solid
          .volume,
      ).toBeCloseTo(60, 10);

      const emptyResult = invokeCli([
        "inspect",
        legacyEmptyPath,
        "--parameter",
        "=7",
      ]);
      expect(emptyResult.status).toBe(0);
      expect(emptyResult.stderr).toBe("");
      expect(
        (JSON.parse(emptyResult.stdout) as { solid: { volume: number } }).solid
          .volume,
      ).toBeCloseTo(84, 10);

      const dashResult = invokeCli([
        "inspect",
        legacyDashPath,
        "--parameter=-legacy=9",
      ]);
      expect(dashResult.status).toBe(0);
      expect(dashResult.stderr).toBe("");
      expect(
        (JSON.parse(dashResult.stdout) as { solid: { volume: number } }).solid
          .volume,
      ).toBeCloseTo(108, 10);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("preserves evaluator diagnostics for syntactically valid unknown inline parameters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-unknown-inline-parameter");
      const width = cad.parameter.length("width", mm(2));
      cad.output(
        "solid",
        cad.box("solid", { size: vec3(width, mm(3), mm(4)) }),
      );
      const documentPath = join(directory, "model.json");
      await writeFile(documentPath, stringifyDocument(cad.build()));

      const result = invokeCli([
        "inspect",
        documentPath,
        "--parameter",
        "missing=5",
      ]);

      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("PARAMETER_MISSING");
      expect(result.stderr).toContain("Unknown parameter override 'missing'");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

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
        readonly configurationId: string | null;
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
      expect(report.configurationId).toBeNull();
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

  it("selects named configurations for inspect, BOM, and export", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-configuration");
      const width = cad.parameter.length("width", mm(2));
      const solid = cad.box("solid", {
        size: vec3(width, mm(3), mm(4)),
      });
      const steel = cad.material("steel", {
        name: "Steel",
        massDensity: kgPerCubicMeter(7_850),
      });
      const part = cad.part("part", solid, {
        partNumber: "CFG-001",
        materialRef: steel,
      });
      const product = cad.assembly("product", (assembly) => {
        assembly.instance("left", part);
        assembly.instance("right", part, {
          placement: [tf.translate(vec3(mm(10), mm(0), mm(0)))],
        });
      });
      cad.configuration("wide-single", (configuration) => {
        configuration.parameter(width, mm(5));
        configuration.instanceSuppressed(product, "right");
      });
      cad.output("product", product);

      const documentPath = join(directory, "model.json");
      const outputPath = join(directory, "configured.obj");
      await writeFile(documentPath, stringifyDocument(cad.build()));

      const inspectResult = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "inspect",
          documentPath,
          "--configuration",
          "wide-single",
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(inspectResult.status).toBe(0);
      expect(inspectResult.stderr).toBe("");
      const inspection = JSON.parse(inspectResult.stdout) as {
        readonly product: { readonly volume: number };
      };
      expect(inspection.product.volume).toBeCloseTo(60, 10);

      const bomResult = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "bom",
          documentPath,
          "--output",
          "product",
          "--configuration=wide-single",
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(bomResult.status).toBe(0);
      expect(bomResult.stderr).toBe("");
      const bom = JSON.parse(bomResult.stdout) as {
        readonly configurationId: string | null;
        readonly totalQuantity: number;
        readonly items: readonly { readonly occurrenceIds: readonly string[] }[];
      };
      expect(bom.configurationId).toBe("wide-single");
      expect(bom.totalQuantity).toBe(1);
      expect(bom.items[0]?.occurrenceIds).toEqual(["left"]);

      const exportResult = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "export",
          documentPath,
          "--output",
          "product",
          "--configuration",
          "wide-single",
          "--to",
          outputPath,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(exportResult.status).toBe(0);
      expect(exportResult.stderr).toBe("");
      const vertexXs = (await readFile(outputPath, "utf8"))
        .split("\n")
        .filter((line) => line.startsWith("v "))
        .map((line) => Number(line.split(/\s+/)[1]));
      expect(vertexXs.length).toBeGreaterThan(0);
      expect(Math.max(...vertexXs)).toBeCloseTo(5, 10);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("requires configuration values and preserves evaluation diagnostics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-configuration-errors");
      const solid = cad.box("solid", {
        size: vec3(mm(1), mm(1), mm(1)),
      });
      const part = cad.part("part", solid);
      cad.output("part", part);
      const documentPath = join(directory, "model.json");
      await writeFile(documentPath, stringifyDocument(cad.build()));

      const missingValueCommands = [
        ["inspect", documentPath, "--configuration"],
        ["bom", documentPath, "--output", "part", "--configuration"],
        [
          "export",
          documentPath,
          "--to",
          join(directory, "part.obj"),
          "--configuration",
        ],
      ] as const;
      for (const command of missingValueCommands) {
        const result = spawnSync(
          process.execPath,
          ["--import", "tsx", "src/cli.ts", ...command],
          { cwd: projectRoot, encoding: "utf8" },
        );
        expect(result.status).toBe(2);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("--configuration");
        expect(result.stderr).toContain("requires a value");
      }

      const unknown = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "inspect",
          documentPath,
          "--configuration",
          "missing",
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(unknown.status).toBe(1);
      expect(unknown.stdout).toBe("");
      expect(unknown.stderr).toContain("CONFIGURATION_MISSING");
      expect(unknown.stderr).toContain("/configurations/missing");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

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

  it("serializes unsupported OCCT genus as JSON null", async () => {
    const directory = await mkdtemp(join(tmpdir(), "invariantcad-cli-"));
    try {
      const cad = design("cli-occt-genus");
      cad.output(
        "solid",
        cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) }),
      );
      const documentPath = join(directory, "model.json");
      await writeFile(documentPath, stringifyDocument(cad.build()));

      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/cli.ts",
          "inspect",
          documentPath,
          "--kernel",
          "occt",
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const report = JSON.parse(result.stdout) as {
        readonly solid: {
          readonly volume: number;
          readonly genus: number | null;
        };
      };
      expect(report.solid.volume).toBeCloseTo(24, 10);
      expect(report.solid.genus).toBeNull();
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
