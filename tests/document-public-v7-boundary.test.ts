import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_SCHEMA_V6,
  DOCUMENT_VERSION_V6,
  analyzeDesignImpact,
  cloneDocument,
  createEvaluator,
  createImportedBodyDocument,
  design,
  hashDesignFeatures,
  hashDocument,
  migrateDocument,
  mm,
  parseDocument,
  parseDocumentValue,
  parseImportedBodyDocument,
  stringifyDocument,
  stringifyImportedBodyDocument,
  validateDocument,
  vec3,
  type CadResult,
  type DesignDocument,
  type GeometryKernel,
  type KernelShape,
} from "../src/index.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type DesignDocumentV7,
} from "../src/ir.js";
import {
  parseDocumentValueV7,
  stringifyDocumentV7,
} from "../src/serialization.js";
import { validateDocumentV7 } from "../src/validation.js";

const V7_REJECTION =
  "Document v7 is not supported by the v1-v6 design-document APIs";

function importedBodyText(): string {
  const created = createImportedBodyDocument("Boundary probe", {
    id: "housing",
    resource: {
      id: "housingStep",
      digest: `sha256:${"a".repeat(64)}`,
      byteLength: 10,
      mediaType: "model/step",
    },
    format: "step",
    units: { mode: "from-file" },
  });
  if (!created.ok) {
    throw new Error(created.diagnostics[0]?.message ?? "creation failed");
  }
  return stringifyImportedBodyDocument(created.value);
}

/** The audit trigger: a public imported-body document read as plain JSON. */
function v7AsLegacy(): DesignDocument {
  return JSON.parse(importedBodyText()) as DesignDocument;
}

function expectV7Rejection(
  result: CadResult<unknown>,
  identity: { readonly schema: unknown; readonly version: unknown } = {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
  },
): void {
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toHaveLength(1);
  expect(result.diagnostics[0]).toMatchObject({
    code: "IR_INVALID",
    severity: "error",
    path: "/",
    message: V7_REJECTION,
    details: identity,
  });
  const supported = result.diagnostics[0]?.details?.supported as
    | readonly { readonly version: number }[]
    | undefined;
  expect(supported?.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(result.diagnostics[0]?.hints?.[0]).toMatch(
    /parseImportedBodyDocument/,
  );
}

function legacyDocument(): DesignDocument {
  const cad = design("legacy-control");
  cad.output(
    "body",
    cad.box("body", { size: vec3(mm(1), mm(2), mm(3)) }),
  );
  return cad.build();
}

describe("public v1-v6 document APIs at the Document v7 boundary", () => {
  it("rejects v7 in validateDocument while the staged validator still admits it", () => {
    const document = v7AsLegacy();
    expectV7Rejection(validateDocument(document));
    expect(validateDocumentV7(document as unknown as DesignDocumentV7).ok).toBe(
      true,
    );
    expect(validateDocument(legacyDocument()).ok).toBe(true);
  });

  it("rejects mixed v7 identity fields at validateDocument", () => {
    const document = v7AsLegacy() as unknown as Record<string, unknown>;
    expectV7Rejection(
      validateDocument({
        ...document,
        version: DOCUMENT_VERSION_V6,
      } as unknown as DesignDocument),
      { schema: DOCUMENT_SCHEMA_V7, version: DOCUMENT_VERSION_V6 },
    );
    expectV7Rejection(
      validateDocument({
        ...legacyDocument(),
        version: DOCUMENT_VERSION_V7,
      } as unknown as DesignDocument),
      { schema: DOCUMENT_SCHEMA_V6, version: DOCUMENT_VERSION_V7 },
    );
  });

  it("rejects v7 in parseDocument, parseDocumentValue, and migrateDocument", () => {
    const text = importedBodyText();
    expectV7Rejection(parseDocument(text));
    expectV7Rejection(parseDocumentValue(JSON.parse(text)));
    expectV7Rejection(migrateDocument(JSON.parse(text)));
    // The staged reader and the public imported-body reader keep working.
    expect(parseDocumentValueV7(JSON.parse(text)).ok).toBe(true);
    expect(parseImportedBodyDocument(text).ok).toBe(true);
  });

  it("refuses to write or hash v7 through the frozen writers", async () => {
    const document = v7AsLegacy();
    expect(() => stringifyDocument(document)).toThrow(TypeError);
    expect(() => stringifyDocument(document)).toThrow(V7_REJECTION);
    expect(() => stringifyDocument(document, { pretty: true })).toThrow(
      TypeError,
    );
    await expect(hashDocument(document)).rejects.toThrow(TypeError);
    await expect(
      hashDocument(document, { includeMetadata: true }),
    ).rejects.toThrow(V7_REJECTION);
    expect(() => cloneDocument(document)).toThrow(TypeError);
    expect(() => cloneDocument(document)).toThrow(V7_REJECTION);
    // The staged writer is unaffected.
    expect(stringifyDocumentV7(document as unknown as DesignDocumentV7)).toBe(
      importedBodyText(),
    );
  });

  it("keeps v1-v6 writer output unchanged", async () => {
    const legacy = legacyDocument();
    expect(legacy).toMatchObject({
      schema: DOCUMENT_SCHEMA_V6,
      version: DOCUMENT_VERSION_V6,
    });
    const text = stringifyDocument(legacy);
    expect(cloneDocument(legacy)).toEqual(legacy);
    expect(await hashDocument(legacy)).toMatch(/^[0-9a-f]{64}$/);
    expect(parseDocument(text).ok).toBe(true);
  });

  it("rejects v7 in feature hashing and design-impact analysis", async () => {
    expectV7Rejection(await hashDesignFeatures(v7AsLegacy()));
    expectV7Rejection(analyzeDesignImpact(v7AsLegacy(), {}));
  });

  it("returns IR_INVALID from Evaluator.evaluate without touching the kernel", async () => {
    const shape: KernelShape = { kernel: "v7-boundary-test" };
    const box = vi.fn(() => shape);
    const importDocumentBody = vi.fn(() => shape);
    const kernel: GeometryKernel = {
      id: "v7-boundary-test",
      capabilities: {
        protocolVersion: 1,
        representation: "brep",
        exact: true,
        primitives: ["box"],
        features: [],
        nativeImports: [],
        nativeExports: [],
      },
      box,
      importDocumentBody,
      mesh: () => ({
        positions: new Float32Array(),
        indices: new Uint32Array(),
      }),
      measure: () => {
        throw new Error("must not measure");
      },
      status: () => ({ ok: true, code: "VALID" }),
      disposeShape: () => undefined,
      dispose: () => undefined,
    };
    const evaluator = await createEvaluator({ kernel });
    try {
      expectV7Rejection(await evaluator.evaluate(v7AsLegacy()));
      expect(box).not.toHaveBeenCalled();
      expect(importDocumentBody).not.toHaveBeenCalled();
    } finally {
      evaluator.dispose();
    }
  });
});
