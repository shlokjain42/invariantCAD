import { describe, expect, it } from "vitest";
import {
  deg,
  design,
  hashDocument,
  mm,
  parseDocument,
  parseDocumentValue,
  stringifyDocument,
  validateDocument,
  vec3,
  type DesignDocument,
} from "../src/index.js";

function orderedDocument(reverse: boolean, metadata?: string): DesignDocument {
  const cad = design("canonical", {
    ...(metadata === undefined ? {} : { metadata: { note: metadata } }),
  });
  let box;
  let sphere;
  if (reverse) {
    sphere = cad.sphere("sphere", { radius: mm(2) });
    box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
  } else {
    box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
    sphere = cad.sphere("sphere", { radius: mm(2) });
  }
  const result = cad.subtract("result", box, [sphere]);
  cad.output("result", result);
  return cad.build();
}

describe("document IR", () => {
  it("serializes canonically independent of construction order", () => {
    expect(stringifyDocument(orderedDocument(false))).toBe(
      stringifyDocument(orderedDocument(true)),
    );
  });

  it("round-trips through validated JSON", () => {
    const source = orderedDocument(false);
    const parsed = parseDocument(stringifyDocument(source));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(source);
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.nodes)).toBe(true);
  });

  it("uses semantic hashes that ignore display metadata by default", async () => {
    const first = orderedDocument(false, "first");
    const second = orderedDocument(false, "second");
    const firstHash = await hashDocument(first);
    expect(firstHash).toBe(await hashDocument(second));
    expect(firstHash).toBe(
      "32a0790ed5c968c578f26270a32e3f2b9d2724c4b3de816d26766f009ff6f211",
    );
    expect(await hashDocument(first, { includeMetadata: true })).not.toBe(
      await hashDocument(second, { includeMetadata: true }),
    );
  });

  it("rejects missing references and graph cycles", () => {
    const missing = JSON.parse(stringifyDocument(orderedDocument(false))) as any;
    missing.nodes.result.target.node = "absent";
    const missingResult = parseDocumentValue(missing);
    expect(missingResult.ok).toBe(false);
    expect(missingResult.diagnostics.some((item) => item.code === "REFERENCE_MISSING")).toBe(
      true,
    );

    const cyclic = JSON.parse(stringifyDocument(orderedDocument(false))) as any;
    cyclic.nodes.loop = {
      kind: "transform",
      input: { node: "loop", kind: "solid" },
      operations: [
        {
          kind: "translate",
          value: [mm(1).ir, mm(0).ir, mm(0).ir],
        },
      ],
    };
    cyclic.outputs.result = { node: "loop", kind: "solid" };
    const cycleResult = parseDocumentValue(cyclic);
    expect(cycleResult.ok).toBe(false);
    expect(cycleResult.diagnostics.some((item) => item.code === "GRAPH_CYCLE")).toBe(
      true,
    );
  });

  it("enforces dimensional expressions at compile time and validation time", () => {
    if (false) {
      // @ts-expect-error Lengths and angles cannot be added.
      mm(1).add(deg(1));
    }
    const document = orderedDocument(false);
    const invalid = JSON.parse(stringifyDocument(document)) as any;
    invalid.nodes.box.size[0] = deg(10).ir;
    const result = parseDocumentValue(invalid);
    expect(result.ok).toBe(false);
    expect(
      result.diagnostics.some(
        (item) => item.code === "EXPRESSION_DIMENSION_MISMATCH",
      ),
    ).toBe(true);
  });
});
