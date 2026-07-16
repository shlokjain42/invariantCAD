import { canonicalStringify, deepFreeze } from "./core/json.js";
import {
  diagnostic,
  failure,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import type { DesignDocument } from "./ir.js";
import { DesignDocumentSchema } from "./schema.js";
import { canonicalizeTopologySelectionIR } from "./topology.js";
import { validateDocument } from "./validation.js";

export interface StringifyOptions {
  readonly pretty?: boolean;
}

function canonicalizeDocumentTopology(
  document: DesignDocument,
): DesignDocument {
  return {
    ...document,
    nodes: Object.fromEntries(
      Object.entries(document.nodes).map(([id, node]) => [
        id,
        node.kind === "fillet" || node.kind === "chamfer"
          ? {
              ...node,
              edges: canonicalizeTopologySelectionIR(node.edges),
            }
          : node.kind === "shell"
            ? {
                ...node,
                openings: canonicalizeTopologySelectionIR(node.openings),
              }
          : node,
      ]),
    ) as DesignDocument["nodes"],
  };
}

export function stringifyDocument(
  document: DesignDocument,
  options: StringifyOptions = {},
): string {
  return canonicalStringify(
    canonicalizeDocumentTopology(document),
    options.pretty ? 2 : undefined,
  );
}

export function parseDocument(text: string): CadResult<DesignDocument> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return failure(
      diagnostic("IR_INVALID", "The document is not valid JSON", {
        severity: "error",
        details: { error: error instanceof Error ? error.message : String(error) },
      }),
    );
  }
  return parseDocumentValue(value);
}

export function parseDocumentValue(value: unknown): CadResult<DesignDocument> {
  const parsed = DesignDocumentSchema.safeParse(value);
  if (!parsed.success) {
    const diagnostics: Diagnostic[] = parsed.error.issues.map((issue) =>
      diagnostic("IR_INVALID", issue.message, {
        severity: "error",
        path: `/${issue.path.map(String).join("/")}`,
        details: { code: issue.code },
      }),
    );
    return { ok: false, diagnostics };
  }
  const document = deepFreeze(parsed.data) as DesignDocument;
  return validateDocument(document);
}

export async function hashDocument(
  document: DesignDocument,
  options: { readonly includeMetadata?: boolean } = {},
): Promise<string> {
  const canonicalDocument = canonicalizeDocumentTopology(document);
  const source = options.includeMetadata
    ? canonicalDocument
    : (() => {
        const { metadata: _metadata, ...semanticDocument } = canonicalDocument;
        return semanticDocument;
      })();
  const bytes = new TextEncoder().encode(canonicalStringify(source));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function cloneDocument(document: DesignDocument): DesignDocument {
  const parsed = parseDocument(stringifyDocument(document));
  if (!parsed.ok) {
    throw new TypeError("Cannot clone an invalid InvariantCAD document");
  }
  return parsed.value;
}

export function migrateDocument(value: unknown): CadResult<DesignDocument> {
  if (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    (value as { version?: unknown }).version !== 1
  ) {
    return failure(
      diagnostic(
        "IR_INVALID",
        `No migration is registered for document version ${String((value as { version?: unknown }).version)}`,
        { severity: "error", path: "/version" },
      ),
    );
  }
  return parseDocumentValue(value);
}
