#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  createEvaluator,
  type EvaluatedOutput,
  type ShapeExportFormat,
} from "./evaluator.js";
import { parseDocument } from "./serialization.js";
import type { Diagnostic } from "./core/result.js";

interface ParsedArguments {
  readonly command: string | undefined;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

function parseArguments(values: readonly string[]): ParsedArguments {
  const [command, ...rest] = values;
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]!;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const [rawName, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) {
      flags[rawName!] = inline;
    } else if (rest[index + 1] !== undefined && !rest[index + 1]!.startsWith("--")) {
      flags[rawName!] = rest[index + 1]!;
      index += 1;
    } else {
      flags[rawName!] = true;
    }
  }
  return { command, positional, flags };
}

function usage(): string {
  return `InvariantCAD CLI

Usage:
  invariantcad validate <document.json>
  invariantcad inspect <document.json> [--kernel manifold|occt] [--parameters values.json]
  invariantcad export <document.json> --to model.stl [--kernel manifold|occt] [--output name] [--format stl|stl-ascii|obj|step|brep|brep-binary] [--parameters values.json]
`;
}

function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .map(
      (item) =>
        `${item.severity.toUpperCase()} ${item.code}${item.path === undefined ? "" : ` ${item.path}`}: ${item.message}`,
    )
    .join("\n");
}

async function loadParameters(path: string | true | undefined): Promise<Record<string, number>> {
  if (typeof path !== "string") return {};
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Parameter file must contain a JSON object");
  }
  const output: Record<string, number> = {};
  for (const [name, parameter] of Object.entries(value)) {
    if (typeof parameter !== "number" || !Number.isFinite(parameter)) {
      throw new TypeError(`Parameter '${name}' must be a finite number in base units`);
    }
    output[name] = parameter;
  }
  return output;
}

function inferFormat(path: string, explicit?: string | true): ShapeExportFormat {
  if (typeof explicit === "string") {
    if (
      explicit === "stl" ||
      explicit === "stl-ascii" ||
      explicit === "obj" ||
      explicit === "step" ||
      explicit === "brep" ||
      explicit === "brep-binary"
    ) {
      return explicit;
    }
    throw new TypeError(`Unsupported export format '${explicit}'`);
  }
  switch (extname(path).toLowerCase()) {
    case ".obj":
      return "obj";
    case ".step":
    case ".stp":
      return "step";
    case ".brep":
    case ".brp":
      return "brep";
    default:
      return "stl";
  }
}

function measurements(output: EvaluatedOutput): object {
  const measured = output.measure();
  return {
    volume: measured.volume,
    surfaceArea: measured.surfaceArea,
    centerOfMass: measured.centerOfMass,
    inertiaTensor: measured.inertiaTensor,
    boundingBox: measured.boundingBox,
    genus: measured.genus,
    tolerance: measured.tolerance,
    triangles: output.mesh().indices.length / 3,
  };
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArguments(argv);
  if (
    args.command === undefined ||
    args.command === "--help" ||
    args.command === "-h" ||
    args.flags.help === true
  ) {
    process.stdout.write(usage());
    return 0;
  }
  const documentPath = args.positional[0];
  if (documentPath === undefined) {
    process.stderr.write(usage());
    return 2;
  }
  const parsed = parseDocument(await readFile(documentPath, "utf8"));
  if (!parsed.ok) {
    process.stderr.write(`${formatDiagnostics(parsed.diagnostics)}\n`);
    return 1;
  }
  if (args.command === "validate") {
    process.stdout.write(`Valid InvariantCAD v${parsed.value.version} document: ${parsed.value.name}\n`);
    return 0;
  }
  if (args.command !== "inspect" && args.command !== "export") {
    process.stderr.write(`Unknown command '${args.command}'\n${usage()}`);
    return 2;
  }
  const requestedKernel = args.flags.kernel;
  if (
    requestedKernel !== undefined &&
    requestedKernel !== "manifold" &&
    requestedKernel !== "occt"
  ) {
    process.stderr.write(`Unsupported kernel '${String(requestedKernel)}'\n`);
    return 2;
  }
  const destination = args.command === "export" ? args.flags.to : undefined;
  const exportFormat =
    typeof destination === "string"
      ? inferFormat(destination, args.flags.format)
      : undefined;
  const exactExport =
    exportFormat === "step" ||
    exportFormat === "brep" ||
    exportFormat === "brep-binary";
  const kernelChoice = requestedKernel ?? (exactExport ? "occt" : "manifold");
  const evaluator =
    kernelChoice === "occt"
      ? await import("./occt-kernel.js").then(async ({ createOcctKernel }) =>
          createEvaluator({ kernel: await createOcctKernel() }),
        )
      : await createEvaluator();
  try {
    const evaluated = await evaluator.evaluate(parsed.value, {
      parameters: await loadParameters(args.flags.parameters),
      ...(typeof args.flags.output === "string"
        ? { outputs: [args.flags.output] }
        : {}),
    });
    if (!evaluated.ok) {
      process.stderr.write(`${formatDiagnostics(evaluated.diagnostics)}\n`);
      return 1;
    }
    try {
      if (args.command === "inspect") {
        const report = Object.fromEntries(
          evaluated.value.outputNames.map((name) => [
            name,
            measurements(evaluated.value.output(name)),
          ]),
        );
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return 0;
      }
      if (typeof destination !== "string") {
        process.stderr.write("export requires --to <path>\n");
        return 2;
      }
      const outputName =
        typeof args.flags.output === "string"
          ? args.flags.output
          : evaluated.value.outputNames[0];
      if (outputName === undefined) throw new Error("No output is available to export");
      const data = evaluated.value.output(outputName).export(
        exportFormat ?? inferFormat(destination, args.flags.format),
      );
      await writeFile(destination, data);
      process.stdout.write(`Wrote ${destination}\n`);
      return 0;
    } finally {
      evaluated.value.dispose();
    }
  } finally {
    evaluator.dispose();
  }
}

runCli().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
