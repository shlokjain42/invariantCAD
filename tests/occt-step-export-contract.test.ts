import { describe, expect, it } from "vitest";
import {
  CadError,
  EvaluatedPart,
  EvaluatedSolid,
  createEvaluator,
  design,
  mm,
  vec3,
  type DesignDocument,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

const decoder = new TextDecoder();

function productRecords(text: string): number {
  return text.match(/\bPRODUCT\s*\(/gu)?.length ?? 0;
}

function stepRecord(source: string, keyword: string): string {
  const match = new RegExp(`\\b${keyword}\\s*\\(`, "u").exec(source);
  if (match === null) throw new Error(`Missing ${keyword} record`);
  return source.slice(match.index, source.indexOf(";", match.index) + 1);
}

function directStepStrings(record: string): readonly string[] {
  return (record.match(/'(?:''|[^'\r\n])*'/gu) ?? []).map((value) =>
    value.slice(1, -1).replaceAll("''", "'"),
  );
}

function cadErrorDiagnostic(action: () => unknown): {
  readonly code: string;
  readonly path?: string;
  readonly details?: Readonly<Record<string, unknown>>;
} {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CadError);
    const [first] = (error as CadError).diagnostics;
    expect(first).toBeDefined();
    return first!;
  }
  throw new Error("Expected a CadError");
}

function twoSolidDocument(kind: "union" | "subtract"): DesignDocument {
  const cad = design(`two-solid-${kind}`);
  if (kind === "union") {
    const left = cad.box("left", { size: vec3(mm(10), mm(10), mm(10)) });
    const right = cad.translate(
      "right",
      cad.box("right-source", { size: vec3(mm(10), mm(10), mm(10)) }),
      vec3(mm(20), mm(0), mm(0)),
    );
    cad.output("pair", cad.union("pair-union", left, [right]));
  } else {
    const plate = cad.box("plate", { size: vec3(mm(30), mm(10), mm(2)) });
    const slot = cad.translate(
      "slot",
      cad.box("slot-source", { size: vec3(mm(2), mm(20), mm(10)) }),
      vec3(mm(14), mm(-5), mm(-4)),
    );
    cad.output("pair", cad.subtract("pair-split", plate, [slot]));
  }
  return cad.build();
}

describe("OCCT STEP export contract", () => {
  it("keeps plain STEP export working for valid multi-solid outputs", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      for (const kind of ["union", "subtract"] as const) {
        const result = await evaluator.evaluate(twoSolidDocument(kind));
        expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
        if (!result.ok) continue;
        let imported:
          | ReturnType<NonNullable<typeof kernel.importShape>>
          | undefined;
        try {
          const output = result.value.output("pair");
          expect(output).toBeInstanceOf(EvaluatedSolid);
          if (!(output instanceof EvaluatedSolid)) continue;
          const expectedVolume = output.measure().volume;

          // No options: the weak native exchange, as in 0.1.1.
          const bytes = output.export("step");
          const text = decoder.decode(bytes);
          expect(productRecords(text), kind).toBeGreaterThan(1);
          imported = kernel.importShape!(bytes, "step");
          expect(kernel.measure(imported).volume, kind).toBeCloseTo(
            expectedVolume,
            6,
          );

          // Explicit options request the strong single-product contract.
          for (const options of [{}, { metadata: { fileName: "pair" } }]) {
            const refused = cadErrorDiagnostic(() =>
              output.export("step", options),
            );
            expect(refused.code).toBe("EXPORT_UNSUPPORTED");
            expect(refused.details).toMatchObject({
              kernel: "occt",
              format: "step",
              reason: "multiple-products",
            });
          }
        } finally {
          if (imported !== undefined) kernel.disposeShape(imported);
          result.value.dispose();
        }
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("keeps low-level weak STEP export for multi-product shapes and normalizes feature text", async () => {
    const kernel = await createOcctKernel();
    const left = kernel.box!([1, 1, 1], false);
    const rightSource = kernel.box!([1, 1, 1], false);
    const right = kernel.transform!(rightSource, [
      { kind: "translate", value: [3, 0, 0] },
    ]);
    const pair = kernel.boolean!("union", left, [right]);
    try {
      const raw = decoder.decode(kernel.exportShape!(pair, "step"));
      expect(productRecords(raw)).toBeGreaterThan(1);
      const refused = cadErrorDiagnostic(() =>
        kernel.exportShape!(pair, "step", {
          stepExport: {
            protocolVersion: 1,
            metadata: {
              fileName: "pair",
              timestamp: "1970-01-01T00:00:00",
              productId: "pair",
              productName: "pair",
              productDescription: "",
            },
          },
        }),
      );
      expect(refused.code).toBe("EXPORT_UNSUPPORTED");
      expect(refused.details?.reason).toBe("multiple-products");

      // Feature text that strict metadata rules reject becomes a valid
      // automatic default instead of failing a call that asked for nothing.
      const text = decoder.decode(
        kernel.exportShape!(left, "step", { feature: "bad\nname\u0007" }),
      );
      expect(productRecords(text)).toBe(1);
      expect(directStepStrings(stepRecord(text, "FILE_NAME"))[0]).toBe(
        "bad name ",
      );
      expect(directStepStrings(stepRecord(text, "PRODUCT")).slice(0, 2)).toEqual(
        ["bad name ", "bad name "],
      );
    } finally {
      kernel.disposeShape(pair);
      kernel.disposeShape(right);
      kernel.disposeShape(rightSource);
      kernel.disposeShape(left);
      kernel.dispose();
    }
  });

  it("derives total automatic metadata from unrestricted authored text", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    const longDescription = "Ω".repeat(40_000);
    const cad = design("Bracket\tRev B\r\n");
    const body = cad.box("body", { size: vec3(mm(2), mm(3), mm(5)) });
    const multiline = cad.part("bracket", body, {
      partNumber: "PN\u0001-7",
      description: "Bracket\nAnodize after machining\u0085",
    });
    const long = cad.part("long", body, { description: longDescription });
    cad
      .output("solid-alias", body)
      .output("multiline", multiline)
      .output("long", long);
    // The design builder restricts output names to IDs, but JSON documents
    // accept any output name string.
    const built = cad.build();
    const { "solid-alias": solidOutput, ...otherOutputs } = built.outputs;
    const document = {
      ...built,
      outputs: { "solid\u0000alias": solidOutput!, ...otherOutputs },
    } as DesignDocument;
    const result = await evaluator.evaluate(document);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      evaluator.dispose();
      return;
    }
    try {
      const solid = result.value.output("solid\u0000alias");
      const part = result.value.output("multiline");
      const longPart = result.value.output("long");
      expect(solid).toBeInstanceOf(EvaluatedSolid);
      expect(part).toBeInstanceOf(EvaluatedPart);
      expect(longPart).toBeInstanceOf(EvaluatedPart);
      if (
        !(solid instanceof EvaluatedSolid) ||
        !(part instanceof EvaluatedPart) ||
        !(longPart instanceof EvaluatedPart)
      ) {
        return;
      }

      const solidText = decoder.decode(solid.export("step"));
      expect(directStepStrings(stepRecord(solidText, "FILE_NAME"))[0]).toBe(
        "Bracket Rev B  ",
      );
      expect(
        directStepStrings(stepRecord(solidText, "PRODUCT")).slice(0, 2),
      ).toEqual(["solid alias", "solid alias"]);

      const partText = decoder.decode(part.export("step"));
      expect(
        directStepStrings(stepRecord(partText, "PRODUCT")).slice(0, 3),
      ).toEqual(["PN -7", "bracket", "Bracket Anodize after machining "]);

      // The long description is truncated so the five resolved strings fit
      // the advertised 64 KiB metadata budget.
      const longText = decoder.decode(longPart.export("step"));
      const description = directStepStrings(stepRecord(longText, "PRODUCT"))[2]!;
      const decoded = description.replaceAll(
        /\\X2\\((?:[0-9A-F]{4})+)\\X0\\/gu,
        (_, hex: string) =>
          String.fromCodePoint(
            ...hex.match(/.{4}/gu)!.map((unit) => Number.parseInt(unit, 16)),
          ),
      );
      expect(decoded.length).toBeGreaterThan(20_000);
      expect(longDescription.startsWith(decoded)).toBe(true);
      const budget = kernel.capabilities.stepExport!.maxMetadataBytes;
      const used =
        new TextEncoder().encode(
          "Bracket Rev B  " + "1970-01-01T00:00:00" + "long" + "long",
        ).byteLength + new TextEncoder().encode(decoded).byteLength;
      expect(used).toBeLessThanOrEqual(budget);

      // Explicit caller metadata keeps the strict rules.
      const invalid = cadErrorDiagnostic(() =>
        part.export("step", {
          metadata: { productDescription: "line\nbreak" },
        }),
      );
      expect(invalid.code).toBe("EXPORT_OPTIONS_INVALID");
      expect(invalid.path).toBe("/metadata/productDescription");
    } finally {
      result.value.dispose();
      evaluator.dispose();
    }
  });

  it("reports exceeded STEP output ceilings as structured errors", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    const cad = design("ceiling");
    cad.output("body", cad.box("body", { size: vec3(mm(2), mm(3), mm(5)) }));
    const result = await evaluator.evaluate(cad.build());
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      evaluator.dispose();
      return;
    }
    try {
      const output = result.value.output("body");
      if (!(output instanceof EvaluatedSolid)) throw new Error("not a solid");
      const exceeded = cadErrorDiagnostic(() =>
        output.export("step", { maxOutputBytes: 1000 }),
      );
      expect(exceeded.code).toBe("RESOURCE_LIMIT_EXCEEDED");
      expect(exceeded.details).toMatchObject({
        kernel: "occt",
        operation: "export",
        format: "step",
        resource: "maxOutputBytes",
        limit: 1000,
      });
      expect(exceeded.details?.actual).toBeGreaterThan(1000);

      // The low-level kernel boundary reports the same structured ceiling.
      const box = kernel.box!([2, 3, 5], false);
      try {
        const lowLevel = cadErrorDiagnostic(() =>
          kernel.exportShape!(box, "step", {
            stepExport: {
              protocolVersion: 1,
              maxOutputBytes: 1000,
              metadata: {
                fileName: "ceiling",
                timestamp: "1970-01-01T00:00:00",
                productId: "body",
                productName: "body",
                productDescription: "",
              },
            },
          }),
        );
        expect(lowLevel.code).toBe("RESOURCE_LIMIT_EXCEEDED");
        expect(lowLevel.details).toMatchObject({
          kernel: "occt",
          operation: "export",
          format: "step",
          resource: "maxOutputBytes",
          limit: 1000,
        });
      } finally {
        kernel.disposeShape(box);
      }
    } finally {
      result.value.dispose();
      evaluator.dispose();
    }
  });
});
