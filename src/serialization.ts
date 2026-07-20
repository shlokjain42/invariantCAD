import { canonicalStringify, deepFreeze } from "./core/json.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import {
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  type DesignDocument,
  type DesignDocumentV5,
  type TopologyReferenceEntryIR,
} from "./ir.js";
import {
  DesignDocumentSchema,
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
} from "./schema.js";
import { canonicalizeTopologySelectionIR } from "./topology.js";
import { normalizePersistentTopologyReference } from "./topology-signatures.js";
import { validateDocument } from "./validation.js";
import {
  normalizeDesignDocumentLimits,
  preflightDesignDocumentValue,
  type DesignDocumentLimits,
} from "./document-limits.js";

export interface StringifyOptions {
  readonly pretty?: boolean;
}

export interface ParseDocumentOptions {
  readonly limits?: Partial<DesignDocumentLimits>;
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function canonicalizeTopologyReferenceEntry(
  entry: TopologyReferenceEntryIR,
): TopologyReferenceEntryIR {
  const variants = entry.variants.map((variant) => {
    const normalized = normalizePersistentTopologyReference(variant);
    if (!normalized.ok) {
      throw new TypeError(
        normalized.diagnostics[0]?.message ??
          "Cannot serialize a malformed persistent topology reference",
      );
    }
    return normalized.value;
  });
  variants.sort(
    (first, second) =>
      first.protocolVersion - second.protocolVersion ||
      lexicalCompare(first.kernelFingerprint, second.kernelFingerprint) ||
      lexicalCompare(canonicalStringify(first), canonicalStringify(second)),
  );
  return {
    target: entry.target,
    topology: entry.topology,
    variants,
  };
}

function canonicalizeDocumentTopology(
  document: DesignDocument,
): DesignDocument {
  const canonicalDocument = {
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
          : node.kind === "draft"
            ? {
                ...node,
                faces: canonicalizeTopologySelectionIR(node.faces),
              }
          : node,
      ]),
    ) as DesignDocument["nodes"],
  } as DesignDocument;
  if (
    (canonicalDocument.version !== DOCUMENT_VERSION_V2 &&
      canonicalDocument.version !== DOCUMENT_VERSION_V3 &&
      canonicalDocument.version !== DOCUMENT_VERSION_V4 &&
      canonicalDocument.version !== DOCUMENT_VERSION_V5) ||
    canonicalDocument.topologyReferences === undefined
  ) {
    return canonicalDocument;
  }
  return {
    ...canonicalDocument,
    topologyReferences: Object.fromEntries(
      Object.entries(canonicalDocument.topologyReferences).map(([id, entry]) => [
        id,
        canonicalizeTopologyReferenceEntry(entry),
      ]),
    ),
  } as DesignDocument;
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

function parseLimits(
  options: ParseDocumentOptions,
): CadResult<DesignDocumentLimits> {
  try {
    const limits = normalizeDesignDocumentLimits(options.limits);
    return limits === undefined
      ? failure(
          diagnostic(
            "IR_INVALID",
            "Design-document parse limits are malformed or unsupported",
            { severity: "error" },
          ),
        )
      : success(limits);
  } catch (error) {
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(
          error,
          "Design-document parse limits could not be read safely",
        ),
        { severity: "error" },
      ),
    );
  }
}

function parseDocumentValueWithLimits(
  value: unknown,
  limits: DesignDocumentLimits,
): CadResult<DesignDocument> {
  const preflight = preflightDesignDocumentValue(value, limits);
  if (!preflight.ok) return preflight;
  const snapshot = preflight.value;
  let parsed: ReturnType<typeof DesignDocumentSchema.safeParse>;
  try {
    const version =
      typeof snapshot === "object" &&
      snapshot !== null &&
      !Array.isArray(snapshot)
        ? (snapshot as Readonly<Record<string, unknown>>).version
        : undefined;
    const schema =
      version === 1
        ? DesignDocumentV1Schema
        : version === 2
          ? DesignDocumentV2Schema
          : version === 3
            ? DesignDocumentV3Schema
            : version === 4
              ? DesignDocumentV4Schema
              : version === 5
                ? DesignDocumentV5Schema
                : DesignDocumentSchema;
    parsed = schema.safeParse(snapshot) as ReturnType<
      typeof DesignDocumentSchema.safeParse
    >;
  } catch (error) {
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(error, "The document could not be parsed safely"),
        { severity: "error" },
      ),
    );
  }
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

export function parseDocument(
  text: string,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocument> {
  const normalizedLimits = parseLimits(options);
  if (!normalizedLimits.ok) return normalizedLimits;
  let documentBytes: number;
  try {
    documentBytes = new TextEncoder().encode(text).byteLength;
  } catch (error) {
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(error, "The document text could not be read safely"),
        { severity: "error" },
      ),
    );
  }
  if (documentBytes > normalizedLimits.value.maxDocumentBytes) {
    return failure(
      diagnostic(
        "IR_INVALID",
        `Design-document maxDocumentBytes limit ${normalizedLimits.value.maxDocumentBytes} was exceeded by ${documentBytes}`,
        {
          severity: "error",
          details: {
            resource: "maxDocumentBytes",
            limit: normalizedLimits.value.maxDocumentBytes,
            actual: documentBytes,
          },
        },
      ),
    );
  }
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
  return parseDocumentValueWithLimits(value, normalizedLimits.value);
}

export function parseDocumentValue(
  value: unknown,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocument> {
  const normalizedLimits = parseLimits(options);
  return normalizedLimits.ok
    ? parseDocumentValueWithLimits(value, normalizedLimits.value)
    : normalizedLimits;
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

export function cloneDocument(
  document: DesignDocument,
  options: ParseDocumentOptions = {},
): DesignDocument {
  const parsed = parseDocument(stringifyDocument(document), options);
  if (!parsed.ok) {
    throw new TypeError("Cannot clone an invalid InvariantCAD document");
  }
  return parsed.value;
}

export function migrateDocument(
  value: unknown,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocumentV5> {
  const parsed = parseDocumentValue(value, options);
  if (!parsed.ok) return parsed;
  if (parsed.value.version === DOCUMENT_VERSION_V5) {
    return success(parsed.value, parsed.diagnostics);
  }
  const source = parsed.value;
  const migrated = parseDocumentValue(
    {
      schema: DOCUMENT_SCHEMA_V5,
      version: DOCUMENT_VERSION_V5,
      name: source.name,
      units: source.units,
      parameters: source.parameters,
      ...(Object.hasOwn(source, "materials")
        ? { materials: source.materials }
        : {}),
      ...(Object.hasOwn(source, "configurations")
        ? { configurations: source.configurations }
        : {}),
      nodes: source.nodes,
      outputs: source.outputs,
      ...(Object.hasOwn(source, "metadata")
        ? { metadata: source.metadata }
        : {}),
      ...((source.version === DOCUMENT_VERSION_V2 ||
        source.version === DOCUMENT_VERSION_V3 ||
        source.version === DOCUMENT_VERSION_V4) &&
      Object.hasOwn(source, "topologyReferences")
        ? { topologyReferences: source.topologyReferences }
        : {}),
    },
    options,
  );
  if (!migrated.ok) return migrated;
  return migrated.value.version === DOCUMENT_VERSION_V5
    ? success(migrated.value, migrated.diagnostics)
    : failure(
        diagnostic("IR_INVALID", "Document migration did not produce version 5", {
          severity: "error",
          path: "/version",
        }),
      );
}
