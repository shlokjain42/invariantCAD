#!/usr/bin/env node

import { open, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  createEvaluator,
  EvaluatedAssembly,
  EvaluatedPart,
  type EvaluatedOutput,
  type ShapeExportFormat,
} from "./evaluator.js";
import {
  principalInertia,
  principalRadiiOfGyration,
  worldRadiiOfGyration,
  type PhysicalMassProperties,
} from "./mass-properties.js";
import { parseDocument } from "./serialization.js";
import { DEFAULT_DESIGN_DOCUMENT_LIMITS } from "./document-limits.js";
import { auditJsonMemberNames } from "./internal/json-member-audit.js";
import type { Diagnostic } from "./core/result.js";

type CliCommand = "validate" | "inspect" | "bom" | "export";
type CliValueOption =
  | "configuration"
  | "kernel"
  | "parameters"
  | "parameter"
  | "output"
  | "to"
  | "format";

interface ParsedArguments {
  readonly command: CliCommand;
  readonly documentPath: string | undefined;
  readonly help: boolean;
  readonly options: ReadonlyMap<CliValueOption, readonly string[]>;
}

type ParsedArgumentsResult =
  | { readonly ok: true; readonly globalHelp: true }
  | {
      readonly ok: true;
      readonly globalHelp: false;
      readonly value: ParsedArguments;
    }
  | { readonly ok: false; readonly message: string };

const COMMAND_OPTIONS: Readonly<
  Record<CliCommand, readonly CliValueOption[]>
> = {
  validate: [],
  inspect: ["configuration", "kernel", "parameters", "parameter", "output"],
  bom: ["configuration", "kernel", "parameters", "parameter", "output"],
  export: [
    "configuration",
    "kernel",
    "parameters",
    "parameter",
    "output",
    "to",
    "format",
  ],
};

const ALL_VALUE_OPTIONS: readonly CliValueOption[] = [
  "configuration",
  "kernel",
  "parameters",
  "parameter",
  "output",
  "to",
  "format",
];

function isCommand(value: string): value is CliCommand {
  return (
    value === "validate" ||
    value === "inspect" ||
    value === "bom" ||
    value === "export"
  );
}

function isValueOption(value: string): value is CliValueOption {
  return ALL_VALUE_OPTIONS.includes(value as CliValueOption);
}

function parseArguments(values: readonly string[]): ParsedArgumentsResult {
  const command = values[0];
  if (command === undefined) {
    return { ok: true, globalHelp: true };
  }
  if (command === "--help" || command === "-h") {
    return values.length === 1
      ? { ok: true, globalHelp: true }
      : {
          ok: false,
          message: `Unexpected argument '${values[1]}' after '${command}'`,
        };
  }
  if (!isCommand(command)) {
    return {
      ok: false,
      message: `Unknown command '${command}'`,
    };
  }

  const positional: string[] = [];
  const options = new Map<CliValueOption, string[]>();
  let help = false;
  let optionsEnded = false;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    if (!optionsEnded && value === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && (value === "--help" || value === "-h")) {
      if (help) {
        return { ok: false, message: "Option '--help' may only be supplied once" };
      }
      help = true;
      continue;
    }
    if (!optionsEnded && value.startsWith("-") && !value.startsWith("--")) {
      return { ok: false, message: `Unknown option '${value}'` };
    }
    if (optionsEnded || !value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const equalsIndex = value.indexOf("=");
    const rawName = value.slice(
      2,
      equalsIndex === -1 ? undefined : equalsIndex,
    );
    if (!isValueOption(rawName)) {
      return {
        ok: false,
        message: `Unknown option '--${rawName}'`,
      };
    }
    if (!COMMAND_OPTIONS[command].includes(rawName)) {
      return {
        ok: false,
        message: `Option '--${rawName}' is not valid for '${command}'`,
      };
    }

    let optionValue: string;
    if (equalsIndex !== -1) {
      optionValue = value.slice(equalsIndex + 1);
    } else {
      const next = values[index + 1];
      if (next === undefined || next === "--" || next.startsWith("-")) {
        return {
          ok: false,
          message: `Option '--${rawName}' requires a value`,
        };
      }
      optionValue = next;
      index += 1;
    }
    if (optionValue.length === 0) {
      return {
        ok: false,
        message: `Option '--${rawName}' requires a non-empty value`,
      };
    }

    const prior = options.get(rawName);
    if (prior !== undefined && rawName !== "parameter") {
      return {
        ok: false,
        message: `Option '--${rawName}' may only be supplied once`,
      };
    }
    options.set(rawName, [...(prior ?? []), optionValue]);
  }

  if (positional.length > 1) {
    return {
      ok: false,
      message: `Unexpected positional argument '${positional[1]}'`,
    };
  }
  const documentPath = positional[0];
  if (!help && documentPath === undefined) {
    return {
      ok: false,
      message: `Command '${command}' requires one document path`,
    };
  }
  if (documentPath !== undefined && documentPath.length === 0) {
    return {
      ok: false,
      message: `Command '${command}' requires a non-empty document path`,
    };
  }
  return {
    ok: true,
    globalHelp: false,
    value: {
      command,
      documentPath,
      help,
      options,
    },
  };
}

function usage(): string {
  return `InvariantCAD CLI

Usage:
  invariantcad validate <document.json>
  invariantcad inspect <document.json> [--output name] [--configuration id] [--kernel manifold|occt] [--parameters values.json | --parameter name=value ...]
  invariantcad bom <document.json> --output name [--configuration id] [--kernel manifold|occt] [--parameters values.json | --parameter name=value ...]
  invariantcad export <document.json> --to model.stl [--configuration id] [--kernel manifold|occt] [--output name] [--format stl|stl-ascii|obj|step|brep|brep-binary] [--parameters values.json | --parameter name=value ...]
`;
}

function usageError(message: string): number {
  process.stderr.write(`${message}\n${usage()}`);
  return 2;
}

function option(
  arguments_: ParsedArguments,
  name: CliValueOption,
): string | undefined {
  return arguments_.options.get(name)?.[0];
}

function optionValues(
  arguments_: ParsedArguments,
  name: CliValueOption,
): readonly string[] {
  return arguments_.options.get(name) ?? [];
}

function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .map(
      (item) =>
        `${item.severity.toUpperCase()} ${item.code}${item.path === undefined ? "" : ` ${item.path}`}: ${item.message}`,
    )
    .join("\n");
}

type InlineParametersResult =
  | {
      readonly ok: true;
      readonly value: Readonly<Record<string, number>>;
    }
  | { readonly ok: false; readonly message: string };

function parseInlineParameters(
  assignments: readonly string[],
): InlineParametersResult {
  const output = Object.create(null) as Record<string, number>;
  for (const assignment of assignments) {
    const equalsIndex = assignment.lastIndexOf("=");
    if (equalsIndex === -1 || equalsIndex === assignment.length - 1) {
      return {
        ok: false,
        message: `Invalid --parameter '${assignment}'; expected name=value`,
      };
    }
    const name = assignment.slice(0, equalsIndex);
    if (Object.hasOwn(output, name)) {
      return {
        ok: false,
        message: `Parameter '${name}' may only be overridden once`,
      };
    }
    const rawValue = assignment.slice(equalsIndex + 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue) as unknown;
    } catch {
      return {
        ok: false,
        message: `Parameter '${name}' must use finite JSON-number syntax`,
      };
    }
    if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
      return {
        ok: false,
        message: `Parameter '${name}' must use finite JSON-number syntax`,
      };
    }
    output[name] = parsed;
  }
  return { ok: true, value: output };
}

type CliInputResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const CLI_INPUT_READ_CHUNK_BYTES = 64 * 1024;
// A leading byte-order mark stays in the text, which JSON parsing rejects.
const fatalUtf8Decoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

/**
 * Reads one bounded input file and decodes it without replacement characters.
 * Every failure, including a missing file, becomes a one-line reason.
 */
async function readUtf8FileWithin(
  path: string,
  label: string,
  maximumBytes: number,
): Promise<CliInputResult<string>> {
  let bytes: Uint8Array | undefined;
  try {
    bytes = await readFileWithin(path, maximumBytes);
  } catch (error) {
    return {
      ok: false,
      message: `${label} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (bytes === undefined) {
    return {
      ok: false,
      message: `${label} exceeds the ${maximumBytes}-byte input limit`,
    };
  }
  try {
    return { ok: true, value: fatalUtf8Decoder.decode(bytes) };
  } catch {
    return { ok: false, message: `${label} is not valid UTF-8` };
  }
}

/**
 * Reads at most one byte past the ceiling, so an oversized or growing file is
 * rejected without buffering it. Returns undefined above the ceiling.
 */
async function readFileWithin(
  path: string,
  maximumBytes: number,
): Promise<Uint8Array | undefined> {
  const handle = await open(path, "r");
  try {
    if ((await handle.stat()).size > maximumBytes) return undefined;
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for (;;) {
      const chunk = new Uint8Array(
        Math.min(CLI_INPUT_READ_CHUNK_BYTES, maximumBytes - byteLength + 1),
      );
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      byteLength += bytesRead;
      if (byteLength > maximumBytes) return undefined;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function loadParameters(
  path: string | undefined,
  inline: Readonly<Record<string, number>>,
): Promise<CliInputResult<Record<string, number>>> {
  if (path === undefined) return { ok: true, value: { ...inline } };
  const text = await readUtf8FileWithin(
    path,
    "Parameter file",
    DEFAULT_DESIGN_DOCUMENT_LIMITS.maxDocumentBytes,
  );
  if (!text.ok) return text;
  let value: unknown;
  try {
    value = JSON.parse(text.value);
  } catch {
    return { ok: false, message: "Parameter file is not valid JSON" };
  }
  const memberAudit = auditJsonMemberNames(
    text.value,
    DEFAULT_DESIGN_DOCUMENT_LIMITS,
  );
  if (memberAudit.status === "duplicate") {
    return {
      ok: false,
      message: "Parameter file contains a duplicate object member name",
    };
  }
  if (memberAudit.status === "limit-exceeded") {
    return {
      ok: false,
      message: `Parameter file ${memberAudit.resource} limit ${memberAudit.limit} was exceeded by ${memberAudit.actual}`,
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, message: "Parameter file must contain a JSON object" };
  }
  const output = Object.create(null) as Record<string, number>;
  for (const [name, parameter] of Object.entries(value)) {
    if (typeof parameter !== "number" || !Number.isFinite(parameter)) {
      return {
        ok: false,
        message: `Parameter '${name}' must be a finite number in base units`,
      };
    }
    output[name] = parameter;
  }
  return { ok: true, value: output };
}

function inferFormat(path: string, explicit?: string): ShapeExportFormat {
  if (explicit !== undefined) {
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
  const physical =
    output instanceof EvaluatedPart || output instanceof EvaluatedAssembly
      ? output.physicalMassProperties()
      : undefined;
  const analyzedPhysical = (
    properties: PhysicalMassProperties,
  ): object => ({
    ...properties,
    principalInertia: principalInertia(properties.inertiaTensor),
    worldRadiiOfGyration: worldRadiiOfGyration(properties),
    principalRadiiOfGyration: principalRadiiOfGyration(properties),
  });
  return {
    volume: measured.volume,
    surfaceArea: measured.surfaceArea,
    centerOfMass: measured.centerOfMass,
    inertiaTensor: measured.inertiaTensor,
    principalInertia: principalInertia(measured.inertiaTensor),
    worldRadiiOfGyration: worldRadiiOfGyration(measured),
    principalRadiiOfGyration: principalRadiiOfGyration(measured),
    boundingBox: measured.boundingBox,
    genus: measured.genus,
    tolerance: measured.tolerance,
    triangles: output.mesh().indices.length / 3,
    ...(physical === undefined
      ? {}
      : physical.ok
        ? { physicalMassProperties: analyzedPhysical(physical.value) }
        : {
            physicalMassProperties: null,
            physicalMassDiagnostics: physical.diagnostics,
          }),
  };
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const parsedArguments = parseArguments(argv);
  if (!parsedArguments.ok) {
    return usageError(parsedArguments.message);
  }
  if (parsedArguments.globalHelp) {
    process.stdout.write(usage());
    return 0;
  }

  const args = parsedArguments.value;
  const requestedConfiguration = option(args, "configuration");
  const requestedKernel = option(args, "kernel");
  if (
    requestedKernel !== undefined &&
    requestedKernel !== "manifold" &&
    requestedKernel !== "occt"
  ) {
    return usageError(`Unsupported kernel '${requestedKernel}'`);
  }
  const parametersPath = option(args, "parameters");
  const inlineParameterAssignments = optionValues(args, "parameter");
  if (
    parametersPath !== undefined &&
    inlineParameterAssignments.length > 0
  ) {
    return usageError("--parameters and --parameter cannot be used together");
  }
  const inlineParameters = parseInlineParameters(inlineParameterAssignments);
  if (!inlineParameters.ok) {
    return usageError(inlineParameters.message);
  }
  const requestedOutput = option(args, "output");
  const destination = option(args, "to");
  const requestedFormat = option(args, "format");
  let exportFormat: ShapeExportFormat | undefined;
  if (
    args.command === "export" &&
    (destination !== undefined || requestedFormat !== undefined)
  ) {
    try {
      exportFormat = inferFormat(destination ?? "model.stl", requestedFormat);
    } catch (error: unknown) {
      return usageError(
        error instanceof Error ? error.message : "Invalid export format",
      );
    }
  }

  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (args.command === "bom" && requestedOutput === undefined) {
    return usageError("bom requires --output <name>");
  }
  if (args.command === "export" && destination === undefined) {
    return usageError("export requires --to <path>");
  }
  if (args.documentPath === undefined) {
    return usageError(`Command '${args.command}' requires one document path`);
  }

  const documentText = await readUtf8FileWithin(
    args.documentPath,
    "Document file",
    DEFAULT_DESIGN_DOCUMENT_LIMITS.maxDocumentBytes,
  );
  if (!documentText.ok) {
    process.stderr.write(`${documentText.message}\n`);
    return 1;
  }
  const parsed = parseDocument(documentText.value);
  if (!parsed.ok) {
    process.stderr.write(`${formatDiagnostics(parsed.diagnostics)}\n`);
    return 1;
  }
  if (args.command === "validate") {
    process.stdout.write(`Valid InvariantCAD v${parsed.value.version} document: ${parsed.value.name}\n`);
    return 0;
  }
  const parameterOverrides = await loadParameters(
    parametersPath,
    inlineParameters.value,
  );
  if (!parameterOverrides.ok) {
    process.stderr.write(`${parameterOverrides.message}\n`);
    return 1;
  }
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
      parameters: parameterOverrides.value,
      ...(requestedConfiguration !== undefined
        ? { configuration: requestedConfiguration }
        : {}),
      ...(requestedOutput !== undefined ? { outputs: [requestedOutput] } : {}),
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
      if (args.command === "bom") {
        const outputName = requestedOutput!;
        const output = evaluated.value.output(outputName);
        if (
          !(output instanceof EvaluatedPart) &&
          !(output instanceof EvaluatedAssembly)
        ) {
          const value: Diagnostic = {
            code: "BOM_OUTPUT_UNSUPPORTED",
            severity: "error",
            message: `Output '${outputName}' is a solid; BOM requires a part or assembly`,
            path: `/outputs/${outputName}`,
          };
          process.stderr.write(`${formatDiagnostics([value])}\n`);
          return 1;
        }
        const bom = output.billOfMaterials();
        if (!bom.ok) {
          process.stderr.write(`${formatDiagnostics(bom.diagnostics)}\n`);
          return 1;
        }
        process.stdout.write(
          `${JSON.stringify(
            {
              output: outputName,
              ...bom.value,
              diagnostics: bom.diagnostics,
            },
            null,
            2,
          )}\n`,
        );
        return 0;
      }
      if (typeof destination !== "string") {
        throw new Error("Export destination was not captured");
      }
      const outputName =
        requestedOutput !== undefined
          ? requestedOutput
          : evaluated.value.outputNames[0];
      if (outputName === undefined) throw new Error("No output is available to export");
      const data = evaluated.value.output(outputName).export(
        exportFormat ?? inferFormat(destination, requestedFormat),
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
