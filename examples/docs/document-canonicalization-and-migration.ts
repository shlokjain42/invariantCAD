import type { DocumentationExample } from "./example-contract.js";

// docs-example:start document-canonicalization-and-migration
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_VERSION,
  hashDocument,
  migrateDocument,
  parseDocument,
  stringifyDocument,
  type CadResult,
} from "invariantcad";

function valueOrThrow<T>(result: CadResult<T>): T {
  if (!result.ok) {
    throw new Error(
      result.diagnostics.map((item) => item.message).join("\n"),
    );
  }
  return result.value;
}

const legacyDocument = {
  schema: DOCUMENT_SCHEMA_V1,
  version: 1,
  name: "legacy-box",
  units: { length: "mm", angle: "rad" },
  parameters: {},
  nodes: {
    box: {
      kind: "box",
      size: [
        { op: "literal", dimension: "length", value: 10 },
        { op: "literal", dimension: "length", value: 20 },
        { op: "literal", dimension: "length", value: 30 },
      ],
      center: false,
    },
  },
  outputs: { box: { kind: "solid", node: "box" } },
} as const;

const migrated = valueOrThrow(migrateDocument(legacyDocument));
const canonicalJson = stringifyDocument(migrated);
const reparsed = valueOrThrow(parseDocument(canonicalJson));
const semanticHash = await hashDocument(reparsed);

export const documentLifecycleSummary = {
  sourceVersion: legacyDocument.version,
  targetVersion: migrated.version,
  currentVersion: DOCUMENT_VERSION,
  canonicalRoundTrip:
    stringifyDocument(reparsed) === canonicalJson,
  semanticHash,
};
console.log(documentLifecycleSummary);
// docs-example:end document-canonicalization-and-migration

export const documentationExample = {
  id: "document-canonicalization-and-migration",
  checks: {
    migratedFromV1: documentLifecycleSummary.sourceVersion === 1,
    migratedToCurrent:
      documentLifecycleSummary.targetVersion ===
      documentLifecycleSummary.currentVersion,
    canonicalRoundTrip: documentLifecycleSummary.canonicalRoundTrip,
    sha256:
      /^[\da-f]{64}$/u.test(documentLifecycleSummary.semanticHash),
  },
} satisfies DocumentationExample;
