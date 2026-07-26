import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP,
  KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
  EvaluatedPart,
  EvaluatedSolid,
  createEvaluator,
  design,
  inspectKernelStepExportCapabilities,
  mm,
  vec3,
  type KernelStepExportMetadata,
} from "../src/index.js";
import {
  createOcctKernel,
  type OcctKernelOptions,
  type OcctModuleFactory,
} from "../src/occt-kernel.js";
import { shaftReferenceModel } from "../examples/reference-models/shaft.js";

const decoder = new TextDecoder();

const FRESH_PROCESS_FILE_NAME = "Release's Ω\\fixture.step";
const FRESH_PROCESS_TIMESTAMP = "2026-07-26T12:34:56";
const FRESH_PROCESS_PART_NUMBER = "REF-SHAFT-001";
const FRESH_PROCESS_PART_NAME = "shaft-part";
const FRESH_PROCESS_PART_DESCRIPTION =
  "Hollow stepped shaft — Café \\ datum Ω";

function stepString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function stepRecord(source: string, keyword: string): string {
  const match = new RegExp(`\\b${keyword}\\s*\\(`, "u").exec(source);
  if (match === null) {
    throw new Error(`Missing ${keyword} record`);
  }
  const end = source.indexOf(";", match.index);
  if (end < 0) {
    throw new Error(`Unterminated ${keyword} record`);
  }
  return source.slice(match.index, end + 1);
}

function directStepStrings(record: string): readonly string[] {
  return record.match(/'(?:''|[^'\r\n])*'/gu) ?? [];
}

function decodeDirectStepString(value: string): string {
  if (!value.startsWith("'") || !value.endsWith("'")) {
    throw new Error("Expected a direct STEP string");
  }
  const content = value.slice(1, -1);
  let decoded = "";
  let index = 0;
  while (index < content.length) {
    if (content.startsWith("''", index)) {
      decoded += "'";
      index += 2;
      continue;
    }
    if (content.startsWith("\\\\", index)) {
      decoded += "\\";
      index += 2;
      continue;
    }
    const width = content.startsWith("\\X2\\", index)
      ? 4
      : content.startsWith("\\X4\\", index)
        ? 8
        : 0;
    if (width > 0) {
      const start = index + 4;
      const end = content.indexOf("\\X0\\", start);
      if (end < 0 || (end - start) % width !== 0) {
        throw new Error("Malformed extended STEP string encoding");
      }
      for (let offset = start; offset < end; offset += width) {
        const codePoint = Number.parseInt(
          content.slice(offset, offset + width),
          16,
        );
        if (!Number.isInteger(codePoint)) {
          throw new Error("Malformed extended STEP string code point");
        }
        decoded += String.fromCodePoint(codePoint);
      }
      index = end + 4;
      continue;
    }
    if (content[index] === "\\") {
      throw new Error("Unsupported STEP string escape");
    }
    decoded += content[index];
    index += 1;
  }
  return decoded;
}

function freshProcessStep(): Promise<Uint8Array> {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const indexModule = new URL("../src/index.ts", import.meta.url).href;
  const kernelModule = new URL("../src/occt-kernel.ts", import.meta.url).href;
  const shaftModule =
    new URL("../examples/reference-models/shaft.ts", import.meta.url).href;
  const script = `
    const {
      createEvaluator,
    } = await import(${JSON.stringify(indexModule)});
    const { createOcctKernel } = await import(${JSON.stringify(kernelModule)});
    const { shaftReferenceModel } = await import(${JSON.stringify(shaftModule)});
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const result = await evaluator.evaluate(
        shaftReferenceModel.buildDocument(),
        { outputs: [shaftReferenceModel.outputName] },
      );
      if (!result.ok) {
        throw new Error(JSON.stringify(result.diagnostics));
      }
      try {
        const output = result.value.output(shaftReferenceModel.outputName);
        const bytes = output.export("step", {
          metadata: {
            fileName: ${JSON.stringify(FRESH_PROCESS_FILE_NAME)},
            timestamp: ${JSON.stringify(FRESH_PROCESS_TIMESTAMP)},
            productDescription: ${JSON.stringify(FRESH_PROCESS_PART_DESCRIPTION)},
          },
        });
        process.stdout.write(Buffer.from(bytes).toString("base64"));
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  `;

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: repository,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 20_000,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            new Error(
              `Fresh-process STEP export failed: ${error.message}\n${stderr}`,
              { cause: error },
            ),
          );
          return;
        }
        resolve(new Uint8Array(Buffer.from(stdout, "base64")));
      },
    );
  });
}

describe("OCCT deterministic STEP export", () => {
  it("advertises a valid, bounded exact STEP determinism envelope", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(kernel.capabilities.nativeExports).toContain("step");
      const inspection = inspectKernelStepExportCapabilities(
        kernel.capabilities,
      );
      expect(inspection).toEqual({
        status: "valid",
        capabilities: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
          schema: "AP214IS",
          byteDeterminism: "same-shape-representation-and-metadata",
          maxOutputBytes: expect.any(Number),
          maxMetadataBytes: expect.any(Number),
        },
      });
      if (inspection.status !== "valid") return;
      expect(Number.isSafeInteger(inspection.capabilities.maxOutputBytes)).toBe(
        true,
      );
      expect(inspection.capabilities.maxOutputBytes).toBeGreaterThan(0);
      expect(
        Number.isSafeInteger(inspection.capabilities.maxMetadataBytes),
      ).toBe(true);
      expect(inspection.capabilities.maxMetadataBytes).toBeGreaterThan(0);
      expect(Object.isFrozen(inspection.capabilities)).toBe(true);
    } finally {
      kernel.dispose();
    }
  });

  it("keeps caller-supplied runtimes on the weak raw STEP contract", async () => {
    const { default: stockModuleFactory } =
      await import("occt-wasm/dist/occt-wasm.js");
    const stockWasm = new URL(
      import.meta.resolve("occt-wasm/dist/occt-wasm.wasm"),
    );
    const runtimeCases: readonly [
      string,
      OcctKernelOptions,
    ][] = [
      [
        "moduleFactory",
        {
          moduleFactory:
            stockModuleFactory as unknown as OcctModuleFactory,
        },
      ],
      ["wasm", { wasm: stockWasm }],
    ];
    const metadata: KernelStepExportMetadata = {
      fileName: "unqualified.step",
      timestamp: DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP,
      productId: "UNQUALIFIED",
      productName: "unqualified",
      productDescription: "",
    };

    for (const [label, options] of runtimeCases) {
      const kernel = await createOcctKernel(options);
      const shape = kernel.box!([1, 2, 3], false, {
        feature: label,
      });
      try {
        expect(
          inspectKernelStepExportCapabilities(kernel.capabilities),
        ).toEqual({ status: "absent" });
        expect(kernel.exportShape!(shape, "step").byteLength).toBeGreaterThan(
          100,
        );
        expect(() =>
          kernel.exportShape!(shape, "step", {
            feature: label,
            stepExport: {
              protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
              metadata,
            },
          }),
        ).toThrow(
          "runtime is not qualified for deterministic STEP export",
        );
      } finally {
        kernel.disposeShape(shape);
        kernel.dispose();
      }
    }
  }, 30_000);

  it("ignores inherited low-level export fields and never invokes context accessors", async () => {
    const kernel = await createOcctKernel();
    const shape = kernel.box!([1, 2, 3], false);
    const controller = new AbortController();
    controller.abort();
    let getterCalls = 0;
    const accessorContext = { feature: "accessor-boundary" };
    Object.defineProperty(accessorContext, "stepExport", {
      get() {
        getterCalls += 1;
        kernel.disposeShape(shape);
        return undefined;
      },
    });

    try {
      expect(() =>
        kernel.exportShape!(shape, "step", accessorContext),
      ).toThrow("must be an own data property");
      expect(getterCalls).toBe(0);
      expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });

      Object.defineProperty(Object.prototype, "signal", {
        configurable: true,
        value: controller.signal,
      });
      Object.defineProperty(Object.prototype, "stepExport", {
        configurable: true,
        value: { protocolVersion: 999 },
      });
      const bytes = kernel.exportShape!(shape, "step", {
        feature: "prototype-safe",
      });
      expect(bytes.byteLength).toBeGreaterThan(100);
    } finally {
      Reflect.deleteProperty(Object.prototype, "signal");
      Reflect.deleteProperty(Object.prototype, "stepExport");
      if (kernel.status(shape).ok) kernel.disposeShape(shape);
      kernel.dispose();
    }
  });

  it("rechecks low-level shape ownership after hostile context inspection", async () => {
    const kernel = await createOcctKernel();
    const shape = kernel.box!([1, 2, 3], false);
    let traps = 0;
    const context = new Proxy(
      { feature: "ownership-boundary" },
      {
        getOwnPropertyDescriptor(target, property) {
          if (property === "stepExport") {
            traps += 1;
            kernel.disposeShape(shape);
          }
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );

    try {
      expect(() =>
        kernel.exportShape!(shape, "step", context),
      ).toThrow("Expected a live OCCT kernel shape");
      expect(traps).toBe(1);
      expect(kernel.status(shape)).toMatchObject({
        ok: false,
        code: "STATUS_ERROR",
      });
    } finally {
      kernel.dispose();
    }
  });

  it("uses captured typed-array bounds after hostile metadata inspection", async () => {
    const kernel = await createOcctKernel();
    const shape = kernel.box!([1, 2, 3], false);
    const typedArrayPrototype = Object.getPrototypeOf(
      Uint8Array.prototype,
    ) as object;
    const byteLengthDescriptor = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "byteLength",
    );
    if (byteLengthDescriptor === undefined) {
      kernel.disposeShape(shape);
      kernel.dispose();
      throw new Error("Typed-array byteLength descriptor is unavailable");
    }
    let traps = 0;
    let poisonedCalls = 0;
    const metadata = new Proxy<KernelStepExportMetadata>(
      {
        fileName: "intrinsic-boundary.step",
        timestamp: DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP,
        productId: "INTRINSIC",
        productName: "intrinsic-boundary",
        productDescription: "",
      },
      {
        getOwnPropertyDescriptor(target, property) {
          traps += 1;
          Object.defineProperty(typedArrayPrototype, "byteLength", {
            ...byteLengthDescriptor,
            get() {
              poisonedCalls += 1;
              throw Object.create(null);
            },
          });
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );

    let bytes: Uint8Array | undefined;
    try {
      bytes = kernel.exportShape!(shape, "step", {
        stepExport: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
          metadata,
        },
      });
    } finally {
      Object.defineProperty(
        typedArrayPrototype,
        "byteLength",
        byteLengthDescriptor,
      );
      if (kernel.status(shape).ok) kernel.disposeShape(shape);
      kernel.dispose();
    }

    expect(bytes?.byteLength).toBeGreaterThan(100);
    expect(traps).toBe(5);
    expect(poisonedCalls).toBe(0);
  });

  it("keeps default low-level bytes stable across translator counter churn", async () => {
    const kernel = await createOcctKernel();
    const shape = kernel.box!([2, 3, 5], false);
    const counterChurn = kernel.box!([7, 11, 13], false);
    let imported: ReturnType<NonNullable<typeof kernel.importShape>> | undefined;
    try {
      const first = kernel.exportShape!(shape, "step");
      kernel.exportShape!(counterChurn, "step");
      const second = kernel.exportShape!(shape, "step");

      expect(second).toEqual(first);
      const text = decoder.decode(first);
      expect(text).toContain("ISO-10303-21;");
      expect(text).toContain("END-ISO-10303-21;");
      const fileNameStrings = directStepStrings(
        stepRecord(text, "FILE_NAME"),
      );
      expect(fileNameStrings[1]).toBe(
        stepString(DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP),
      );

      const schema = stepRecord(text, "FILE_SCHEMA");
      expect(schema).toContain("AUTOMOTIVE_DESIGN");
      imported = kernel.importShape!(first, "step");
      expect(kernel.status(imported)).toEqual({ ok: true, code: "VALID" });
      const measured = kernel.measure(imported);
      expect(measured.volume).toBeCloseTo(30, 8);
      expect(measured.surfaceArea).toBeCloseTo(62, 8);
      expect(measured.centerOfMass).toEqual([
        expect.closeTo(1, 8),
        expect.closeTo(1.5, 8),
        expect.closeTo(2.5, 8),
      ]);
      expect(measured.boundingBox.min).toEqual([
        expect.closeTo(0, 8),
        expect.closeTo(0, 8),
        expect.closeTo(0, 8),
      ]);
      expect(measured.boundingBox.max).toEqual([
        expect.closeTo(2, 8),
        expect.closeTo(3, 8),
        expect.closeTo(5, 8),
      ]);
    } finally {
      if (imported !== undefined) kernel.disposeShape(imported);
      kernel.disposeShape(counterChurn);
      kernel.disposeShape(shape);
      kernel.dispose();
    }
  });

  it("maps evaluated solid and part identity and escapes apostrophes", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    const cad = design("Fixture O'Clock");
    const body = cad.box("body", {
      size: vec3(mm(2), mm(3), mm(5)),
    });
    const part = cad.part("bracket-part", body, {
      partNumber: "PN-'42",
      description: "Operator's bracket",
    });
    cad.output("solid-output", body).output("part-output", part);

    const result = await evaluator.evaluate(cad.build());
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      evaluator.dispose();
      return;
    }
    try {
      const solid = result.value.output("solid-output");
      const evaluatedPart = result.value.output("part-output");
      expect(solid).toBeInstanceOf(EvaluatedSolid);
      expect(evaluatedPart).toBeInstanceOf(EvaluatedPart);
      if (
        !(solid instanceof EvaluatedSolid) ||
        !(evaluatedPart instanceof EvaluatedPart)
      ) {
        return;
      }

      const solidText = decoder.decode(solid.export("step"));
      expect(
        directStepStrings(stepRecord(solidText, "FILE_NAME")).slice(0, 2),
      ).toEqual([
        stepString("Fixture O'Clock"),
        stepString(DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP),
      ]);
      expect(
        directStepStrings(stepRecord(solidText, "PRODUCT")).slice(0, 3),
      ).toEqual([
        stepString("solid-output"),
        stepString("solid-output"),
        stepString(""),
      ]);

      const partText = decoder.decode(evaluatedPart.export("step"));
      expect(
        directStepStrings(stepRecord(partText, "PRODUCT")).slice(0, 3),
      ).toEqual([
        stepString("PN-'42"),
        stepString("bracket-part"),
        stepString("Operator's bracket"),
      ]);
    } finally {
      result.value.dispose();
      evaluator.dispose();
    }
  });

  it("keeps an exact cylinder stable and re-importable", async () => {
    const kernel = await createOcctKernel();
    const cylinder = kernel.cylinder!(7, 2, 2, false, 64, {
      feature: "deterministic-cylinder",
    });
    let imported: ReturnType<NonNullable<typeof kernel.importShape>> | undefined;
    try {
      const first = kernel.exportShape!(cylinder, "step", {
        feature: "deterministic-cylinder",
      });
      const second = kernel.exportShape!(cylinder, "step", {
        feature: "deterministic-cylinder",
      });

      expect(second).toEqual(first);
      imported = kernel.importShape!(first, "step");
      expect(kernel.status(imported)).toEqual({ ok: true, code: "VALID" });
      const measured = kernel.measure(imported);
      expect(measured.volume).toBeCloseTo(Math.PI * 2 ** 2 * 7, 8);
      expect(measured.surfaceArea).toBeCloseTo(
        2 * Math.PI * 2 * (2 + 7),
        8,
      );
    } finally {
      if (imported !== undefined) kernel.disposeShape(imported);
      kernel.disposeShape(cylinder);
      kernel.dispose();
    }
  });

  it("keeps the hollow stepped-shaft reference model stable and re-importable", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    let imported:
      | ReturnType<NonNullable<typeof kernel.importShape>>
      | undefined;
    try {
      const result = await evaluator.evaluate(
        shaftReferenceModel.buildDocument(),
        { outputs: [shaftReferenceModel.outputName] },
      );
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      try {
        const output = result.value.output(
          shaftReferenceModel.outputName,
        );
        expect(output).toBeInstanceOf(EvaluatedPart);
        if (!(output instanceof EvaluatedPart)) return;
        const first = output.export("step");
        const second = output.export("step");
        expect(second).toEqual(first);
        imported = kernel.importShape!(first, "step");
        expect(kernel.status(imported)).toEqual({
          ok: true,
          code: "VALID",
        });
        const measured = kernel.measure(imported);
        expect(measured.volume).toBeCloseTo(
          shaftReferenceModel.expected.volumeMm3,
          6,
        );
        expect(measured.boundingBox).toEqual({
          min: shaftReferenceModel.expected.boundingBox.min.map((value) =>
            expect.closeTo(value, 6),
          ),
          max: shaftReferenceModel.expected.boundingBox.max.map((value) =>
            expect.closeTo(value, 6),
          ),
        });
      } finally {
        result.value.dispose();
      }
    } finally {
      if (imported !== undefined) kernel.disposeShape(imported);
      evaluator.dispose();
    }
  }, 30_000);

  it("applies explicit metadata and enforces output and cancellation limits", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    let imported:
      | ReturnType<NonNullable<typeof kernel.importShape>>
      | undefined;
    const cad = design("override-source");
    const body = cad.box("body", {
      size: vec3(mm(2), mm(3), mm(5)),
    });
    cad.output("shipping-output", body);

    const result = await evaluator.evaluate(cad.build());
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      evaluator.dispose();
      return;
    }
    try {
      const output = result.value.output("shipping-output");
      expect(output).toBeInstanceOf(EvaluatedSolid);
      if (!(output instanceof EvaluatedSolid)) return;

      const metadata: KernelStepExportMetadata = {
        fileName: "Release's Ω\\model.step",
        timestamp: "2026-07-26T12:34:56",
        productId: "SKU-轴-'9000",
        productName: "Customer's Café 😀 bracket",
        productDescription: "Machined for O'Connell \\ datum Ω",
      };
      const bytes = output.export("step", { metadata });
      const text = decoder.decode(bytes);
      expect(
        directStepStrings(stepRecord(text, "FILE_NAME"))
          .slice(0, 2)
          .map(decodeDirectStepString),
      ).toEqual([
        metadata.fileName,
        metadata.timestamp,
      ]);
      expect(
        directStepStrings(stepRecord(text, "PRODUCT"))
          .slice(0, 3)
          .map(decodeDirectStepString),
      ).toEqual([
        metadata.productId,
        metadata.productName,
        metadata.productDescription,
      ]);
      imported = kernel.importShape!(bytes, "step");
      expect(kernel.status(imported)).toEqual({
        ok: true,
        code: "VALID",
      });
      expect(kernel.measure(imported).volume).toBeCloseTo(30, 8);

      expect(() =>
        output.export("step", {
          metadata,
          maxOutputBytes: bytes.byteLength,
        }),
      ).not.toThrow();
      expect(() =>
        output.export("step", {
          metadata,
          maxOutputBytes: bytes.byteLength - 1,
        }),
      ).toThrow(/maxOutputBytes/u);

      const controller = new AbortController();
      controller.abort();
      expect(() =>
        output.export("step", { metadata, signal: controller.signal }),
      ).toThrow(expect.objectContaining({ name: "AbortError" }));
    } finally {
      if (imported !== undefined) kernel.disposeShape(imported);
      result.value.dispose();
      evaluator.dispose();
    }
  });

  it(
    "emits byte-identical STEP in separate Node processes",
    async () => {
      const first = await freshProcessStep();
      await new Promise((resolve) => {
        setTimeout(resolve, 1_100);
      });
      const second = await freshProcessStep();
      expect(second).toEqual(first);

      const text = decoder.decode(first);
      const fileNameRecord = stepRecord(text, "FILE_NAME");
      const productRecord = stepRecord(text, "PRODUCT");
      expect(fileNameRecord).toContain("\\X2\\03A9\\X0\\");
      expect(fileNameRecord).toContain("\\X2\\005C\\X0\\");
      expect(productRecord).toContain("\\X2\\00E9\\X0\\");
      expect(
        directStepStrings(fileNameRecord)
          .slice(0, 2)
          .map(decodeDirectStepString),
      ).toEqual([FRESH_PROCESS_FILE_NAME, FRESH_PROCESS_TIMESTAMP]);
      expect(
        directStepStrings(productRecord)
          .slice(0, 3)
          .map(decodeDirectStepString),
      ).toEqual([
        FRESH_PROCESS_PART_NUMBER,
        FRESH_PROCESS_PART_NAME,
        FRESH_PROCESS_PART_DESCRIPTION,
      ]);
    },
    30_000,
  );
});
