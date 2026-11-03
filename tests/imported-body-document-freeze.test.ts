import { describe, expect, it } from "vitest";
import {
  createImportedBodyDocument,
  parseDocument,
  parseImportedBodyDocument,
  stringifyImportedBodyDocument,
  type CadResult,
  type ImportedBodyDefinition,
  type ImportedBodyDocument,
} from "../src/index.js";
import { DOCUMENT_SCHEMA_V7, DOCUMENT_VERSION_V7 } from "../src/ir.js";
import { parseDocumentV7, stringifyDocumentV7 } from "../src/serialization.js";

/**
 * Frozen bytes of the fixed minimal Document v7 subset written by the public
 * imported-body workflow: one resource, one importedBody node, and one direct
 * solid output. A future public Document v7 must keep accepting these bytes,
 * so any change here is a protocol change, not a refactor.
 */
const STEP_DEFINITION: ImportedBodyDefinition = {
  id: "housing",
  resource: {
    id: "housingStep",
    digest: `sha256:${"0123456789abcdef".repeat(4)}`,
    byteLength: 2048,
    mediaType: "model/step",
    locations: ["memory:housing.step", "https://example.invalid/housing.step"],
  },
  format: "step",
  units: { mode: "from-file" },
};

const STEP_BYTES =
  '{"name":"Frozen imported housing","nodes":{"housing":{"expected":"single-solid","format":"step","healing":{"mode":"none"},"kind":"importedBody","resource":"housingStep","units":{"mode":"from-file"}}},"outputs":{"housing":{"kind":"solid","node":"housing"}},"parameters":{},"resources":{"housingStep":{"byteLength":2048,"digest":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","locations":["memory:housing.step","https://example.invalid/housing.step"],"mediaType":"model/step"}},"schema":"https://invariantcad.dev/schema/document/v7","units":{"angle":"rad","length":"mm"},"version":7}';

const STEP_SHA256 =
  "5d3b71eb9280a64bacab6dfd978811a09eb8ea05b739860af275f2559ebdcb41";

const BREP_DEFINITION: ImportedBodyDefinition = {
  id: "bracket",
  resource: {
    id: "bracketBrep",
    digest: `sha256:${"fedcba9876543210".repeat(4)}`,
    byteLength: 0,
    mediaType: "application/octet-stream",
  },
  format: "brep-binary",
  units: { mode: "declared", length: "in" },
};

const BREP_BYTES =
  '{"name":"Frozen imported bracket","nodes":{"bracket":{"expected":"single-solid","format":"brep-binary","healing":{"mode":"none"},"kind":"importedBody","resource":"bracketBrep","units":{"length":"in","mode":"declared"}}},"outputs":{"bracket":{"kind":"solid","node":"bracket"}},"parameters":{},"resources":{"bracketBrep":{"byteLength":0,"digest":"sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210","mediaType":"application/octet-stream"}},"schema":"https://invariantcad.dev/schema/document/v7","units":{"angle":"rad","length":"mm"},"version":7}';

const BREP_SHA256 =
  "a59504a3a03b28818f6fd05852944ce3f7dad2e18de1f13678c6f89f94f78d6a";

function valueOf<T>(result: CadResult<T>): T {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected success");
  return result.value;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("frozen imported-body Document v7 subset", () => {
  for (const [label, name, definition, bytes, hash] of [
    [
      "STEP",
      "Frozen imported housing",
      STEP_DEFINITION,
      STEP_BYTES,
      STEP_SHA256,
    ],
    [
      "binary BREP",
      "Frozen imported bracket",
      BREP_DEFINITION,
      BREP_BYTES,
      BREP_SHA256,
    ],
  ] as const) {
    it(`pins the canonical bytes and hash of a ${label} document`, async () => {
      const document: ImportedBodyDocument = valueOf(
        createImportedBodyDocument(name, definition),
      );
      expect(stringifyImportedBodyDocument(document)).toBe(bytes);
      expect(await sha256Hex(bytes)).toBe(hash);

      const raw = JSON.parse(bytes) as Record<string, unknown>;
      expect(raw.schema).toBe(DOCUMENT_SCHEMA_V7);
      expect(raw.schema).toBe("https://invariantcad.dev/schema/document/v7");
      expect(raw.version).toBe(DOCUMENT_VERSION_V7);
      expect(raw.version).toBe(7);

      // Readable only through the imported-body entry point.
      const parsed = valueOf(parseImportedBodyDocument(bytes));
      expect(parsed).toEqual(document);
      expect(stringifyImportedBodyDocument(parsed)).toBe(bytes);
      expect(
        JSON.parse(stringifyImportedBodyDocument(parsed, { pretty: true })),
      ).toEqual(raw);

      // The bytes are an exact staged Document v7 value.
      expect(stringifyDocumentV7(valueOf(parseDocumentV7(bytes)))).toBe(bytes);

      // The frozen v1-v6 reader refuses them with one clear diagnostic.
      const legacy = parseDocument(bytes);
      expect(legacy.ok).toBe(false);
      expect(legacy.diagnostics).toEqual([
        expect.objectContaining({ code: "IR_INVALID", path: "/" }),
      ]);
    });
  }

  it("admits nothing outside one resource, one imported body, and one solid output", () => {
    const raw = JSON.parse(STEP_BYTES) as {
      nodes: Record<string, unknown>;
      outputs: Record<string, unknown>;
      resources: Record<string, unknown>;
      metadata?: unknown;
    };
    const variants: unknown[] = [
      { ...raw, metadata: { note: "outside the subset" } },
      {
        ...raw,
        resources: { ...raw.resources, spare: raw.resources.housingStep },
      },
      {
        ...raw,
        outputs: { ...raw.outputs, copy: raw.outputs.housing },
      },
      { ...raw, outputs: { renamed: raw.outputs.housing } },
    ];
    for (const variant of variants) {
      const result = parseImportedBodyDocument(JSON.stringify(variant));
      expect(result.ok, JSON.stringify(variant)).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("IR_INVALID");
    }
  });
});
