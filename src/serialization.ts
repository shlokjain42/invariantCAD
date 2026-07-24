import {
  canonicalStringify,
  canonicalStringifyProtocol,
  deepFreeze,
} from "./core/json.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import {
  DOCUMENT_SCHEMA_V6,
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DOCUMENT_VERSION_V6,
  DOCUMENT_VERSION_V7,
  type DesignDocument,
  type DesignDocumentV6,
  type DesignDocumentV7,
  type NodeIR,
  type NodeIRV7,
  type TopologyReferenceEntryIR,
} from "./ir.js";
import {
  DesignDocumentSchema,
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
  DesignDocumentV6Schema,
  DesignDocumentV7Schema,
} from "./schema.js";
import { canonicalizeTopologySelectionIR } from "./topology.js";
import { normalizePersistentTopologyReference } from "./topology-signatures.js";
import { validateDocument, validateDocumentV7 } from "./validation.js";
import {
  DEFAULT_DESIGN_DOCUMENT_LIMITS,
  normalizeDesignDocumentLimits,
  preflightDesignDocumentValue,
  type DesignDocumentLimits,
} from "./document-limits.js";
import {
  DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
  documentV7RuntimeIntrinsicsAreIntact,
  throwDocumentV7RuntimeIntegrityError,
} from "./internal/document-v7-runtime-integrity.js";

const SerializationIntrinsicArray = Array;
const SerializationIntrinsicArrayPrototype = Array.prototype;
const SerializationIntrinsicJson = JSON;
const SerializationIntrinsicObject = Object;
const SerializationIntrinsicReflect = Reflect;
const SerializationIntrinsicTextEncoder = TextEncoder;
const serializationIntrinsicArrayIsArray =
  SerializationIntrinsicArray.isArray;
const serializationIntrinsicArrayMap =
  SerializationIntrinsicArrayPrototype.map;
const serializationIntrinsicArraySort =
  SerializationIntrinsicArrayPrototype.sort;
const serializationIntrinsicJsonParse = SerializationIntrinsicJson.parse;
const serializationIntrinsicJsonStringify =
  SerializationIntrinsicJson.stringify;
const serializationIntrinsicObjectCreate =
  SerializationIntrinsicObject.create;
const serializationIntrinsicObjectGetPrototypeOf =
  SerializationIntrinsicObject.getPrototypeOf;
const serializationIntrinsicObjectHasOwn =
  SerializationIntrinsicObject.hasOwn;
const serializationIntrinsicObjectKeys = SerializationIntrinsicObject.keys;
const serializationIntrinsicReflectOwnKeys =
  SerializationIntrinsicReflect.ownKeys;
const serializationIntrinsicTextEncoderEncode =
  SerializationIntrinsicTextEncoder.prototype.encode;
const serializationReflectApply = SerializationIntrinsicReflect.apply;
const serializationTextEncoder = new SerializationIntrinsicTextEncoder();

function serializationIntegrityFailure<T>(): CadResult<T> {
  return failure(
    diagnostic(
      "IR_INVALID",
      DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
      { severity: "error" },
    ),
  );
}

function serializationObjectKeys(value: object): string[] {
  return serializationReflectApply(
    serializationIntrinsicObjectKeys,
    SerializationIntrinsicObject,
    [value],
  ) as string[];
}

function serializationArrayIsArray(
  value: unknown,
): value is readonly unknown[] {
  return serializationReflectApply(
    serializationIntrinsicArrayIsArray,
    SerializationIntrinsicArray,
    [value],
  ) as boolean;
}

function serializationObjectHasOwn(
  value: object,
  key: PropertyKey,
): boolean {
  return serializationReflectApply(
    serializationIntrinsicObjectHasOwn,
    SerializationIntrinsicObject,
    [value, key],
  ) as boolean;
}

function serializationObjectCreateNull<T>(): Record<string, T> {
  return serializationReflectApply(
    serializationIntrinsicObjectCreate,
    SerializationIntrinsicObject,
    [null],
  ) as Record<string, T>;
}

function serializationSort<T>(
  value: T[],
  compare: (first: T, second: T) => number,
): void {
  serializationReflectApply(serializationIntrinsicArraySort, value, [compare]);
}

function serializationUtf8ByteLength(value: string): number {
  const bytes = serializationReflectApply(
    serializationIntrinsicTextEncoderEncode,
    serializationTextEncoder,
    [value],
  ) as Uint8Array;
  return bytes.byteLength;
}

function serializationJsonParse(value: string): unknown {
  return serializationReflectApply(
    serializationIntrinsicJsonParse,
    SerializationIntrinsicJson,
    [value],
  );
}

function v7ParsedShapeMatchesSnapshot(
  snapshot: unknown,
  parsed: unknown,
): boolean {
  const pending = new SerializationIntrinsicArray<{
    readonly snapshot: unknown;
    readonly parsed: unknown;
  }>(1);
  pending[0] = { snapshot, parsed };
  while (pending.length > 0) {
    const pair = pending[pending.length - 1]!;
    pending.length -= 1;
    if (typeof pair.snapshot !== "object" || pair.snapshot === null) {
      if (typeof pair.parsed === "object" && pair.parsed !== null) return false;
      continue;
    }
    if (typeof pair.parsed !== "object" || pair.parsed === null) return false;
    const snapshotIsArray = serializationArrayIsArray(pair.snapshot);
    if (snapshotIsArray !== serializationArrayIsArray(pair.parsed)) {
      return false;
    }
    if (snapshotIsArray) {
      if (pair.snapshot.length !== (pair.parsed as readonly unknown[]).length) {
        return false;
      }
      for (let index = 0; index < pair.snapshot.length; index += 1) {
        pending[pending.length] = {
          snapshot: pair.snapshot[index],
          parsed: (pair.parsed as readonly unknown[])[index],
        };
      }
      continue;
    }
    const snapshotRecord = pair.snapshot as Readonly<
      Record<string, unknown>
    >;
    const parsedRecord = pair.parsed as Readonly<Record<string, unknown>>;
    const snapshotKeys = serializationObjectKeys(snapshotRecord);
    const parsedKeys = serializationObjectKeys(parsedRecord);
    if (snapshotKeys.length !== parsedKeys.length) return false;
    for (let index = 0; index < snapshotKeys.length; index += 1) {
      const key = snapshotKeys[index]!;
      if (!serializationObjectHasOwn(parsedRecord, key)) return false;
      pending[pending.length] = {
        snapshot: snapshotRecord[key],
        parsed: parsedRecord[key],
      };
    }
  }
  return true;
}

export interface StringifyOptions {
  readonly pretty?: boolean;
}

export interface ParseDocumentOptions {
  readonly limits?: Partial<DesignDocumentLimits>;
}

export interface StringifyDocumentV7Options
  extends StringifyOptions,
    ParseDocumentOptions {}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function canonicalizeTopologyReferenceEntry(
  entry: TopologyReferenceEntryIR,
): TopologyReferenceEntryIR {
  const variants = new SerializationIntrinsicArray<
    TopologyReferenceEntryIR["variants"][number]
  >(entry.variants.length);
  for (let index = 0; index < entry.variants.length; index += 1) {
    const variant = entry.variants[index]!;
    const normalized = normalizePersistentTopologyReference(variant);
    if (!normalized.ok) {
      throw new TypeError(
        normalized.diagnostics[0]?.message ??
          "Cannot serialize a malformed persistent topology reference",
      );
    }
    variants[index] = normalized.value;
  }
  serializationSort(
    variants,
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

type SerializableDocument = DesignDocument | DesignDocumentV7;

function canonicalizeDocumentTopology<T extends SerializableDocument>(
  document: T,
): T {
  const sourceNodes = document.nodes as unknown as Readonly<
    Record<string, NodeIR | NodeIRV7>
  >;
  const nodes = serializationObjectCreateNull<NodeIR | NodeIRV7>();
  const nodeIds = serializationObjectKeys(sourceNodes);
  for (let index = 0; index < nodeIds.length; index += 1) {
    const id = nodeIds[index]!;
    const node = sourceNodes[id]!;
    nodes[id] =
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
            : node;
  }
  const canonicalDocument = {
    ...document,
    nodes: nodes as T["nodes"],
  } as T;
  if (
    (canonicalDocument.version !== DOCUMENT_VERSION_V2 &&
      canonicalDocument.version !== DOCUMENT_VERSION_V3 &&
      canonicalDocument.version !== DOCUMENT_VERSION_V4 &&
      canonicalDocument.version !== DOCUMENT_VERSION_V5 &&
      canonicalDocument.version !== DOCUMENT_VERSION_V6 &&
      canonicalDocument.version !== DOCUMENT_VERSION_V7) ||
    canonicalDocument.topologyReferences === undefined
  ) {
    return canonicalDocument;
  }
  const topologyReferences = serializationObjectCreateNull<
    TopologyReferenceEntryIR
  >();
  const sourceReferences =
    canonicalDocument.topologyReferences as unknown as Readonly<
      Record<string, TopologyReferenceEntryIR>
    >;
  const referenceIds = serializationObjectKeys(sourceReferences);
  for (let index = 0; index < referenceIds.length; index += 1) {
    const id = referenceIds[index]!;
    topologyReferences[id] = canonicalizeTopologyReferenceEntry(
      sourceReferences[id]!,
    );
  }
  return {
    ...canonicalDocument,
    topologyReferences,
  } as T;
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

/**
 * Validates, detaches, and canonically serializes an isolated staged v7
 * document. This is intentionally not re-exported from the package root.
 */
export function stringifyDocumentV7(
  document: DesignDocumentV7,
  options: StringifyDocumentV7Options = {},
): string {
  const normalizedLimits = parseV7Limits(options);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    throwDocumentV7RuntimeIntegrityError();
  }
  if (!normalizedLimits.ok) {
    throw new TypeError(
      normalizedLimits.diagnostics[0]?.message ??
        "Cannot normalize InvariantCAD document-v7 serialization limits",
    );
  }
  let pretty: boolean;
  try {
    pretty = options.pretty === true;
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      throwDocumentV7RuntimeIntegrityError();
    }
    throw new TypeError(
      "Cannot read InvariantCAD document-v7 serialization options safely",
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    throwDocumentV7RuntimeIntegrityError();
  }
  const parsed = parseDocumentValueV7WithLimits(
    document,
    normalizedLimits.value,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    throwDocumentV7RuntimeIntegrityError();
  }
  if (!parsed.ok) {
    throw new TypeError(
      parsed.diagnostics[0]?.message ??
        "Cannot serialize an invalid InvariantCAD document-v7 value",
    );
  }
  const text = canonicalStringifyProtocol(
    canonicalizeDocumentTopology(parsed.value),
    pretty ? 2 : undefined,
  );
  const documentBytes = serializationUtf8ByteLength(text);
  if (documentBytes > normalizedLimits.value.maxDocumentBytes) {
    throw new TypeError(
      `Design-document maxDocumentBytes limit ${normalizedLimits.value.maxDocumentBytes} was exceeded by ${documentBytes}`,
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    throwDocumentV7RuntimeIntegrityError();
  }
  return text;
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

function parseV7Limits(
  options: ParseDocumentOptions,
): CadResult<DesignDocumentLimits> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  try {
    const rawLimits = options.limits;
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    if (rawLimits === undefined) {
      return success(DEFAULT_DESIGN_DOCUMENT_LIMITS);
    }
    const captured = preflightDesignDocumentValue(
      rawLimits,
      DEFAULT_DESIGN_DOCUMENT_LIMITS,
      { strictV7Snapshot: true },
    );
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    if (!captured.ok) return captured;
    const limits = normalizeDesignDocumentLimits(captured.value);
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return limits === undefined
      ? failure(
          diagnostic(
            "IR_INVALID",
            "Design-document-v7 parse limits are malformed or unsupported",
            { severity: "error" },
          ),
        )
      : success(limits);
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        "Design-document-v7 parse limits could not be read safely",
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
                : version === 6
                  ? DesignDocumentV6Schema
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

function parseDocumentValueV7WithLimits(
  value: unknown,
  limits: DesignDocumentLimits,
): CadResult<DesignDocumentV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  const preflight = preflightDesignDocumentValue(value, limits, {
    strictV7Snapshot: true,
  });
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!preflight.ok) return preflight;
  let parsed: ReturnType<typeof DesignDocumentV7Schema.safeParse>;
  try {
    parsed = DesignDocumentV7Schema.safeParse(preflight.value);
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        "The document-v7 value could not be parsed safely",
        { severity: "error" },
      ),
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues.map((issue) =>
        diagnostic("IR_INVALID", issue.message, {
          severity: "error",
          path: `/${issue.path.map(String).join("/")}`,
          details: { code: issue.code },
        }),
      ),
    };
  }
  if (!v7ParsedShapeMatchesSnapshot(preflight.value, parsed.data)) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Document-v7 schema parsing changed the protocol key shape",
        { severity: "error" },
      ),
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  const validated = validateDocumentV7(
    deepFreeze(parsed.data) as DesignDocumentV7,
  );
  return documentV7RuntimeIntrinsicsAreIntact()
    ? validated
    : serializationIntegrityFailure();
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

/**
 * Parses only the isolated staged document-v7 grammar. Ordinary parsing stays
 * frozen on v1-v6 until the complete runtime switch.
 */
export function parseDocumentV7(
  text: string,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocumentV7> {
  if (typeof text !== "string") {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Document-v7 text must be a primitive string",
        { severity: "error" },
      ),
    );
  }
  const source = text;
  const normalizedLimits = parseV7Limits(options);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!normalizedLimits.ok) return normalizedLimits;
  let documentBytes: number;
  try {
    documentBytes = serializationUtf8ByteLength(source);
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        "The document text could not be read safely",
        { severity: "error" },
      ),
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
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
    value = serializationJsonParse(source);
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return failure(
      diagnostic("IR_INVALID", "The document is not valid JSON", {
        severity: "error",
        details: {
          error: "JSON parsing failed safely",
        },
      }),
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  return parseDocumentValueV7WithLimits(value, normalizedLimits.value);
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

/** Parses a detached value as the isolated staged document-v7 grammar. */
export function parseDocumentValueV7(
  value: unknown,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocumentV7> {
  const normalizedLimits = parseV7Limits(options);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!normalizedLimits.ok) return normalizedLimits;
  const parsed = parseDocumentValueV7WithLimits(value, normalizedLimits.value);
  return documentV7RuntimeIntrinsicsAreIntact()
    ? parsed
    : serializationIntegrityFailure();
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

/** Returns a detached, deeply frozen clone of a valid staged v7 document. */
export function cloneDocumentV7(
  document: DesignDocumentV7,
  options: ParseDocumentOptions = {},
): DesignDocumentV7 {
  const normalizedLimits = parseV7Limits(options);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    throwDocumentV7RuntimeIntegrityError();
  }
  if (!normalizedLimits.ok) {
    throw new TypeError(
      normalizedLimits.diagnostics[0]?.message ??
        "Cannot normalize InvariantCAD document-v7 clone limits",
    );
  }
  const parsed = parseDocumentValueV7WithLimits(
    document,
    normalizedLimits.value,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    throwDocumentV7RuntimeIntegrityError();
  }
  if (!parsed.ok) {
    throw new TypeError(
      parsed.diagnostics[0]?.message ??
        "Cannot clone an invalid InvariantCAD document-v7 value",
    );
  }
  const text = canonicalStringifyProtocol(
    canonicalizeDocumentTopology(parsed.value),
  );
  const documentBytes = serializationUtf8ByteLength(text);
  if (documentBytes > normalizedLimits.value.maxDocumentBytes) {
    throw new TypeError(
      `Design-document maxDocumentBytes limit ${normalizedLimits.value.maxDocumentBytes} was exceeded by ${documentBytes}`,
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    throwDocumentV7RuntimeIntegrityError();
  }
  return parsed.value;
}

export function migrateDocument(
  value: unknown,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocumentV6> {
  const parsed = parseDocumentValue(value, options);
  if (!parsed.ok) return parsed;
  if (parsed.value.version === DOCUMENT_VERSION_V6) {
    return success(parsed.value, parsed.diagnostics);
  }
  const source = parsed.value;
  const migrated = parseDocumentValue(
    {
      schema: DOCUMENT_SCHEMA_V6,
      version: DOCUMENT_VERSION_V6,
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
        source.version === DOCUMENT_VERSION_V4 ||
        source.version === DOCUMENT_VERSION_V5) &&
      Object.hasOwn(source, "topologyReferences")
        ? { topologyReferences: source.topologyReferences }
        : {}),
    },
    options,
  );
  if (!migrated.ok) return migrated;
  return migrated.value.version === DOCUMENT_VERSION_V6
    ? success(migrated.value, migrated.diagnostics)
    : failure(
        diagnostic("IR_INVALID", "Document migration did not produce version 6", {
          severity: "error",
          path: "/version",
        }),
      );
}

function migrateNodeToV7(node: NodeIR): NodeIRV7 {
  if (node.kind === "part") {
    const { solid, ...definition } = node;
    return {
      ...definition,
      geometry: solid,
    };
  }
  if (node.kind === "assembly") {
    return {
      kind: "assembly",
      instances: node.instances.map((instance) => {
        const { component, ...definition } = instance;
        return {
          ...definition,
          component: {
            source: "local",
            reference: component,
          },
          configuration: { mode: "inherit" },
        };
      }),
    };
  }
  // Every other v1-v6 node is a structural member of NodeIRV7. In particular,
  // a principal PlaneIR is one arm of PlaneIRV7.
  return node;
}

/**
 * Internal staging migration from any frozen public grammar to the reserved v7
 * foundation.
 *
 * This helper is intentionally not re-exported from the root package while
 * ordinary authoring, parsing, evaluation, hashes, and impact analysis remain
 * on v6. Its input still travels through the bounded public v1-v6 parser, and
 * the transformed result must satisfy the isolated strict v7 schema.
 */
export function migrateDocumentToV7(
  value: unknown,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocumentV7> {
  const parsed = parseDocumentValue(value, options);
  if (!parsed.ok) return parsed;
  const source = parsed.value;
  const candidate = {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: source.name,
    units: source.units,
    parameters: source.parameters,
    ...(Object.hasOwn(source, "materials")
      ? { materials: source.materials }
      : {}),
    ...(Object.hasOwn(source, "configurations")
      ? { configurations: source.configurations }
      : {}),
    nodes: Object.fromEntries(
      Object.entries(source.nodes).map(([id, node]) => [
        id,
        migrateNodeToV7(node),
      ]),
    ),
    outputs: source.outputs,
    ...(Object.hasOwn(source, "metadata")
      ? { metadata: source.metadata }
      : {}),
    ...((source.version === DOCUMENT_VERSION_V2 ||
      source.version === DOCUMENT_VERSION_V3 ||
      source.version === DOCUMENT_VERSION_V4 ||
      source.version === DOCUMENT_VERSION_V5 ||
      source.version === DOCUMENT_VERSION_V6) &&
    Object.hasOwn(source, "topologyReferences")
      ? { topologyReferences: source.topologyReferences }
      : {}),
  };
  const migrated = parseDocumentValueV7(candidate, options);
  if (!migrated.ok) return migrated;
  return success(migrated.value, [
    ...parsed.diagnostics,
    ...migrated.diagnostics,
  ]);
}
