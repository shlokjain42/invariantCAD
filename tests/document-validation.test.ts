import { describe, expect, it } from "vitest";
import {
  DOCUMENT_SCHEMA_V6,
  createEvaluator,
  design,
  mm,
  parseDocumentValue,
  stringifyDocument,
  topology,
  validateDocument,
  vec3,
  type CadResult,
  type DesignDocument,
  type GeometryKernel,
} from "../src/index.js";

type MutableDocument = {
  schema: unknown;
  version: unknown;
  nodes: Record<string, Record<string, unknown>>;
  outputs: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

/** A v6 box with a fillet whose edge query names a semantic box role. */
function roleDocument(): MutableDocument {
  const cad = design("validation-probe");
  const base = cad.box("base", { size: vec3(mm(10), mm(10), mm(10)) });
  const edge = topology.edges
    .createdBy(base, { role: "box.edge.x-max-y-max" })
    .select();
  cad.output("rounded", cad.fillet("rounded", base, { edges: edge, radius: mm(1) }));
  return JSON.parse(stringifyDocument(cad.build())) as MutableDocument;
}

function asDocument(value: MutableDocument): DesignDocument {
  return value as unknown as DesignDocument;
}

function inertKernel(): GeometryKernel {
  return {
    id: "validation-probe",
    capabilities: {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: ["box"],
      features: ["fillet"],
      nativeImports: [],
      nativeExports: [],
    },
    box: () => {
      throw new Error("validation must fail before kernel work");
    },
    mesh: () => ({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    }),
    measure: () => {
      throw new Error("validation must fail before kernel work");
    },
    status: () => ({ ok: true, code: "VALID" }),
    disposeShape: () => undefined,
    dispose: () => undefined,
  };
}

function codesAndPaths(result: CadResult<unknown>): [string, string | undefined][] {
  return result.diagnostics.map((item) => [item.code, item.path]);
}

describe("semantic validation of malformed in-memory documents", () => {
  it("reports an unsupported schema/version identity alone instead of throwing", async () => {
    expect(validateDocument(asDocument(roleDocument())).ok).toBe(true);
    for (const version of [8, "6", undefined]) {
      const document = roleDocument();
      document.version = version;
      const result = validateDocument(asDocument(document));
      expect(result.ok, String(version)).toBe(false);
      expect(codesAndPaths(result)).toEqual([["IR_INVALID", "/"]]);
      expect(result.diagnostics[0]?.message).toBe(
        "Document schema and version must identify the same supported document grammar",
      );
    }
    const mismatched = roleDocument();
    mismatched.schema = "https://invariantcad.dev/schema/document/v5";
    expect(codesAndPaths(validateDocument(asDocument(mismatched)))).toEqual([
      ["IR_INVALID", "/"],
    ]);

    const evaluator = await createEvaluator({ kernel: inertKernel() });
    try {
      const document = roleDocument();
      document.version = 8;
      const result = await evaluator.evaluate(asDocument(document));
      expect(codesAndPaths(result)).toEqual([["IR_INVALID", "/"]]);
    } finally {
      evaluator.dispose();
    }
  });

  it("reports unknown and out-of-grammar node kinds as IR_INVALID", async () => {
    for (const kind of ["futureFeature", "importedBody", "datumPlane"]) {
      const document = roleDocument();
      document.nodes.extra = { kind };
      document.outputs.extra = { node: "extra", kind: "solid" };
      const result = validateDocument(asDocument(document));
      expect(result.ok, kind).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "IR_INVALID",
          node: "extra",
          path: "/nodes/extra/kind",
          message: `Node kind '${kind}' is not supported by document version 6`,
        }),
      );
      // The frozen structural parser already rejects the same value.
      expect(parseDocumentValue(document).ok, kind).toBe(false);
    }

    const cyclic = roleDocument();
    cyclic.nodes.extra = { kind: "futureFeature", input: { node: "extra" } };
    cyclic.nodes.rounded!.input = { node: "extra", kind: "solid" };
    expect(validateDocument(asDocument(cyclic)).ok).toBe(false);

    const evaluator = await createEvaluator({ kernel: inertKernel() });
    try {
      const document = roleDocument();
      document.nodes.extra = { kind: "futureFeature" };
      const result = await evaluator.evaluate(asDocument(document));
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "IR_INVALID",
          path: "/nodes/extra/kind",
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("keeps the v6 schema constant aligned with the probe document", () => {
    expect(roleDocument().schema).toBe(DOCUMENT_SCHEMA_V6);
  });
});
