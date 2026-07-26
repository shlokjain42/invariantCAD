import {
  canonicalProtocolByteLengthWithin,
  canonicalStringify,
  canonicalStringifyProtocol,
  canonicalStringifyProtocolWithin,
  deepFreeze,
} from "./core/json.js";
import {
  decodeUtf8Fatal,
  utf8ByteLengthWithin,
} from "./core/utf8.js";
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
  DOCUMENT_VERSION_V1,
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
import {
  canonicalizeTopologySelectionIR,
  canonicalizeTopologySelectionIRV7,
} from "./topology.js";
import { normalizePersistentTopologyReference } from "./topology-signatures.js";
import { validateDocument, validateDocumentV7 } from "./validation.js";
import {
  checkTrustedDesignDocumentSnapshotLimits,
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
import {
  diagnoseDocumentV7IdentityRepresentability,
} from "./internal/document-v7-identity-representability.js";
import { auditJsonMemberNames } from "./internal/json-member-audit.js";

const SerializationIntrinsicArray = Array;
const SerializationIntrinsicArrayPrototype = Array.prototype;
const SerializationIntrinsicJson = JSON;
const SerializationIntrinsicObject = Object;
const SerializationIntrinsicReflect = Reflect;
const SerializationIntrinsicUint8Array = Uint8Array;
const SerializationIntrinsicTypedArrayPrototype =
  SerializationIntrinsicObject.getPrototypeOf(
    SerializationIntrinsicUint8Array.prototype,
  );
const serializationIntrinsicTypedArrayByteLength =
  SerializationIntrinsicObject.getOwnPropertyDescriptor(
    SerializationIntrinsicTypedArrayPrototype,
    "byteLength",
  )?.get;
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
const serializationReflectApply = SerializationIntrinsicReflect.apply;

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

function serializationUint8ArrayByteLength(value: Uint8Array): number {
  if (serializationIntrinsicTypedArrayByteLength === undefined) {
    throw new TypeError("Uint8Array byteLength intrinsic is unavailable");
  }
  return serializationReflectApply(
    serializationIntrinsicTypedArrayByteLength,
    value,
    [],
  ) as number;
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

function serializationJsonParse(value: string): unknown {
  return serializationReflectApply(
    serializationIntrinsicJsonParse,
    SerializationIntrinsicJson,
    [value],
  );
}

function concatenateDiagnostics(
  first: readonly Diagnostic[],
  second: readonly Diagnostic[],
): Diagnostic[] {
  const diagnostics = new SerializationIntrinsicArray<Diagnostic>(
    first.length + second.length,
  );
  for (let index = 0; index < first.length; index += 1) {
    diagnostics[index] = first[index]!;
  }
  for (let index = 0; index < second.length; index += 1) {
    diagnostics[first.length + index] = second[index]!;
  }
  return diagnostics;
}

function prependDiagnostics<T>(
  diagnostics: readonly Diagnostic[],
  result: CadResult<T>,
): CadResult<T> {
  if (diagnostics.length === 0) return result;
  const combined = concatenateDiagnostics(diagnostics, result.diagnostics);
  return result.ok
    ? success(result.value, combined)
    : { ok: false, diagnostics: combined };
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
  const canonicalizeSelection: typeof canonicalizeTopologySelectionIR =
    document.version === DOCUMENT_VERSION_V7
      ? canonicalizeTopologySelectionIRV7
      : canonicalizeTopologySelectionIR;
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
            edges: canonicalizeSelection(node.edges),
          }
        : node.kind === "shell"
          ? {
              ...node,
              openings: canonicalizeSelection(node.openings),
            }
          : node.kind === "draft"
            ? {
                ...node,
                faces: canonicalizeSelection(node.faces),
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
  const canonicalDocument = canonicalizeDocumentTopology(parsed.value);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    throwDocumentV7RuntimeIntegrityError();
  }
  const text = canonicalStringifyProtocolWithin(
    canonicalDocument,
    normalizedLimits.value.maxDocumentBytes,
    pretty,
  );
  if (text === undefined) {
    throw new TypeError(
      `Design-document maxDocumentBytes limit ${normalizedLimits.value.maxDocumentBytes} was exceeded before canonical JSON materialization`,
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

function validateLegacyDocumentSnapshot(
  snapshot: unknown,
): CadResult<DesignDocument> {
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

function parseDocumentValueWithLimits(
  value: unknown,
  limits: DesignDocumentLimits,
): CadResult<DesignDocument> {
  const preflight = preflightDesignDocumentValue(value, limits);
  return preflight.ok
    ? validateLegacyDocumentSnapshot(preflight.value)
    : preflight;
}

function preflightDocumentValueV7WithLimits(
  value: unknown,
  limits: DesignDocumentLimits,
): CadResult<unknown> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  const preflight = preflightDesignDocumentValue(value, limits, {
    strictV7Snapshot: true,
  });
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  return preflight;
}

function validateDocumentV7Snapshot(
  snapshot: unknown,
): CadResult<DesignDocumentV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  let parsed: ReturnType<typeof DesignDocumentV7Schema.safeParse>;
  try {
    parsed = DesignDocumentV7Schema.safeParse(snapshot);
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
  if (!v7ParsedShapeMatchesSnapshot(snapshot, parsed.data)) {
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

function parseDocumentValueV7WithLimits(
  value: unknown,
  limits: DesignDocumentLimits,
): CadResult<DesignDocumentV7> {
  const preflight = preflightDocumentValueV7WithLimits(value, limits);
  return preflight.ok
    ? validateDocumentV7Snapshot(preflight.value)
    : preflight;
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

interface CapturedDocumentTextV7Boundary {
  readonly snapshot: unknown;
  readonly limits: DesignDocumentLimits;
}

export type AdmittedDocumentSourceVersion =
  | typeof DOCUMENT_VERSION_V1
  | typeof DOCUMENT_VERSION_V2
  | typeof DOCUMENT_VERSION_V3
  | typeof DOCUMENT_VERSION_V4
  | typeof DOCUMENT_VERSION_V5
  | typeof DOCUMENT_VERSION_V6
  | typeof DOCUMENT_VERSION_V7;

/** Source-version provenance retained by the internal composition boundary. */
export interface AdmittedDesignDocumentV7 {
  readonly document: DesignDocumentV7;
  readonly sourceVersion: AdmittedDocumentSourceVersion;
}

interface DocumentTextV7BoundaryMessages {
  readonly primitiveText: string;
  readonly memberAudit: string;
  readonly duplicateMember: string;
}

const STAGED_DOCUMENT_V7_TEXT_MESSAGES: DocumentTextV7BoundaryMessages = {
  primitiveText: "Document-v7 text must be a primitive string",
  memberAudit: "Document-v7 JSON member names could not be audited safely",
  duplicateMember: "Document-v7 JSON contains a duplicate object member name",
};

const COMPATIBLE_DOCUMENT_TEXT_MESSAGES: DocumentTextV7BoundaryMessages = {
  primitiveText: "Design-document text must be a primitive string",
  memberAudit: "Design-document JSON member names could not be audited safely",
  duplicateMember: "Design-document JSON contains a duplicate object member name",
};

function captureDocumentTextV7WithLimits(
  source: string,
  limits: DesignDocumentLimits,
  messages: DocumentTextV7BoundaryMessages,
): CadResult<CapturedDocumentTextV7Boundary> {
  let documentBytes: number | undefined;
  try {
    documentBytes = utf8ByteLengthWithin(
      source,
      limits.maxDocumentBytes,
    );
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
  if (documentBytes === undefined) {
    return failure(
      diagnostic(
        "IR_INVALID",
        `Design-document maxDocumentBytes limit ${limits.maxDocumentBytes} was exceeded before UTF-8 buffer materialization`,
        {
          severity: "error",
          details: {
            resource: "maxDocumentBytes",
            limit: limits.maxDocumentBytes,
            actualAtLeast:
              source.length > limits.maxDocumentBytes
                ? source.length
                : limits.maxDocumentBytes + 1,
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
  const preflight = preflightDocumentValueV7WithLimits(value, limits);
  if (!preflight.ok) return preflight;
  let memberAudit: ReturnType<typeof auditJsonMemberNames>;
  try {
    memberAudit = auditJsonMemberNames(source, limits);
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        messages.memberAudit,
        {
          severity: "error",
          details: {
            reason: "json-member-audit-failed",
          },
        },
      ),
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (memberAudit.status === "limit-exceeded") {
    return failure(
      diagnostic(
        "IR_INVALID",
        `Design-document ${memberAudit.resource} limit ${memberAudit.limit} was exceeded by ${memberAudit.actual}`,
        {
          severity: "error",
          details: {
            resource: memberAudit.resource,
            limit: memberAudit.limit,
            actual: memberAudit.actual,
          },
        },
      ),
    );
  }
  if (memberAudit.status === "duplicate") {
    return failure(
      diagnostic(
        "IR_INVALID",
        messages.duplicateMember,
        {
          severity: "error",
          details: {
            reason: "duplicate-json-member",
          },
        },
      ),
    );
  }
  return success({
    snapshot: preflight.value,
    limits,
  });
}

function captureDocumentTextV7Boundary(
  text: string,
  options: ParseDocumentOptions,
  messages: DocumentTextV7BoundaryMessages,
): CadResult<CapturedDocumentTextV7Boundary> {
  if (typeof text !== "string") {
    return failure(
      diagnostic(
        "IR_INVALID",
        messages.primitiveText,
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
  return captureDocumentTextV7WithLimits(
    source,
    normalizedLimits.value,
    messages,
  );
}

/**
 * Parses only the isolated staged document-v7 grammar and rejects repeated
 * object member names from the raw JSON text. Ordinary parsing stays frozen on
 * v1-v6 until the complete runtime switch.
 */
export function parseDocumentV7(
  text: string,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocumentV7> {
  const captured = captureDocumentTextV7Boundary(
    text,
    options,
    STAGED_DOCUMENT_V7_TEXT_MESSAGES,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  return captured.ok
    ? validateDocumentV7Snapshot(captured.value.snapshot)
    : captured;
}

function capturedDocumentSourceVersion(
  snapshot: unknown,
): AdmittedDocumentSourceVersion | undefined {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    serializationArrayIsArray(snapshot)
  ) {
    return undefined;
  }
  const version = (
    snapshot as Readonly<Record<string, unknown>>
  ).version;
  return version === DOCUMENT_VERSION_V1 ||
    version === DOCUMENT_VERSION_V2 ||
    version === DOCUMENT_VERSION_V3 ||
    version === DOCUMENT_VERSION_V4 ||
    version === DOCUMENT_VERSION_V5 ||
    version === DOCUMENT_VERSION_V6 ||
    version === DOCUMENT_VERSION_V7
    ? version
    : undefined;
}

function admitCapturedDocumentToV7(
  captured: CapturedDocumentTextV7Boundary,
): CadResult<AdmittedDesignDocumentV7> {
  const sourceVersion = capturedDocumentSourceVersion(
    captured.snapshot,
  );
  const migrated = migrateTrustedDocumentSnapshotToV7(
    captured.snapshot,
    captured.limits,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!migrated.ok) return migrated;
  if (sourceVersion === undefined) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Design-document version is malformed or unsupported",
        {
          severity: "error",
          path: "/version",
        },
      ),
    );
  }
  return success(
    {
      document: migrated.value,
      sourceVersion,
    },
    migrated.diagnostics,
  );
}

/**
 * Admits raw JSON from any frozen public document grammar or the staged v7
 * grammar into one detached, validated v7 snapshot while retaining the
 * authored source version for provenance. This internal composition boundary
 * is intentionally not re-exported from the package root.
 */
export function admitDocumentToV7(
  text: string,
  options: ParseDocumentOptions = {},
): CadResult<AdmittedDesignDocumentV7> {
  const captured = captureDocumentTextV7Boundary(
    text,
    options,
    COMPATIBLE_DOCUMENT_TEXT_MESSAGES,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  return captured.ok ? admitCapturedDocumentToV7(captured.value) : captured;
}

/** Document-only convenience form of {@link admitDocumentToV7}. */
export function parseDocumentToV7(
  text: string,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocumentV7> {
  const admitted = admitDocumentToV7(text, options);
  return admitted.ok
    ? success(admitted.value.document, admitted.diagnostics)
    : admitted;
}

/**
 * Fatal UTF-8 byte form of {@link admitDocumentToV7} for resolved document
 * resources. The encoded payload is bounded before decoding and retains source
 * version provenance without parsing the JSON twice.
 */
export function admitDocumentBytesToV7(
  bytes: Uint8Array,
  options: ParseDocumentOptions = {},
): CadResult<AdmittedDesignDocumentV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  let isUint8Array: boolean;
  let byteLength: number;
  try {
    isUint8Array = bytes instanceof SerializationIntrinsicUint8Array;
    if (isUint8Array) {
      byteLength = serializationUint8ArrayByteLength(bytes);
    } else {
      byteLength = 0;
    }
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        "Design-document bytes could not be read safely",
        { severity: "error" },
      ),
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!isUint8Array) {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Design-document bytes must be a Uint8Array",
        { severity: "error" },
      ),
    );
  }
  const normalizedLimits = parseV7Limits(options);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!normalizedLimits.ok) return normalizedLimits;
  if (byteLength > normalizedLimits.value.maxDocumentBytes) {
    return failure(
      diagnostic(
        "IR_INVALID",
        `Design-document maxDocumentBytes limit ${normalizedLimits.value.maxDocumentBytes} was exceeded by ${byteLength}`,
        {
          severity: "error",
          details: {
            resource: "maxDocumentBytes",
            limit: normalizedLimits.value.maxDocumentBytes,
            actual: byteLength,
          },
        },
      ),
    );
  }
  let text: string;
  try {
    text = decodeUtf8Fatal(bytes);
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        "Design-document bytes are not valid UTF-8",
        {
          severity: "error",
          details: {
            reason: "invalid-utf8",
          },
        },
      ),
    );
  }
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  const captured = captureDocumentTextV7WithLimits(
    text,
    normalizedLimits.value,
    COMPATIBLE_DOCUMENT_TEXT_MESSAGES,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  return captured.ok ? admitCapturedDocumentToV7(captured.value) : captured;
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

/**
 * Parses a detached value as the isolated staged document-v7 grammar.
 * Duplicate JSON member occurrences cannot be reconstructed after another
 * parser has already collapsed them; use {@link parseDocumentV7} at text
 * boundaries that require that guarantee.
 */
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
  const canonicalDocument = canonicalizeDocumentTopology(parsed.value);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    throwDocumentV7RuntimeIntegrityError();
  }
  const documentBytes = canonicalProtocolByteLengthWithin(
    canonicalDocument,
    normalizedLimits.value.maxDocumentBytes,
  );
  if (documentBytes === undefined) {
    throw new TypeError(
      `Design-document maxDocumentBytes limit ${normalizedLimits.value.maxDocumentBytes} was exceeded before canonical JSON materialization`,
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

function checkDocumentV7CanonicalByteLimit(
  document: DesignDocumentV7,
  limits: DesignDocumentLimits,
): CadResult<void> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  try {
    const canonicalDocument = canonicalizeDocumentTopology(document);
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    const documentBytes = canonicalProtocolByteLengthWithin(
      canonicalDocument,
      limits.maxDocumentBytes,
    );
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return documentBytes === undefined
      ? failure(
          diagnostic(
            "IR_INVALID",
            `Design-document maxDocumentBytes limit ${limits.maxDocumentBytes} was exceeded before canonical JSON materialization`,
            {
              severity: "error",
              details: {
                resource: "maxDocumentBytes",
                limit: limits.maxDocumentBytes,
                actualAtLeast: limits.maxDocumentBytes + 1,
              },
            },
          ),
        )
      : success(undefined);
  } catch {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        "Document-v7 canonical byte length could not be checked safely",
        { severity: "error" },
      ),
    );
  }
}

function isDocumentByteLimitFailure(result: CadResult<void>): boolean {
  if (result.ok) return false;
  for (let index = 0; index < result.diagnostics.length; index += 1) {
    if (
      result.diagnostics[index]?.details?.resource === "maxDocumentBytes"
    ) {
      return true;
    }
  }
  return false;
}

function migrateNodeToV7(node: NodeIR): NodeIRV7 {
  if (node.kind === "part") {
    const source = node as unknown as Readonly<Record<string, unknown>>;
    const definition = serializationObjectCreateNull<unknown>();
    const keys = serializationObjectKeys(source);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (key !== "solid") definition[key] = source[key];
    }
    definition.geometry = node.solid;
    return definition as unknown as NodeIRV7;
  }
  if (node.kind === "assembly") {
    const instances = new SerializationIntrinsicArray<unknown>(
      node.instances.length,
    );
    for (let index = 0; index < node.instances.length; index += 1) {
      const instance = node.instances[index]!;
      const source = instance as unknown as Readonly<Record<string, unknown>>;
      const definition = serializationObjectCreateNull<unknown>();
      const keys = serializationObjectKeys(source);
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = keys[keyIndex]!;
        if (key !== "component") definition[key] = source[key];
      }
      const component = serializationObjectCreateNull<unknown>();
      component.source = "local";
      component.reference = instance.component;
      definition.component = component;
      const configuration = serializationObjectCreateNull<unknown>();
      configuration.mode = "inherit";
      definition.configuration = configuration;
      instances[index] = definition;
    }
    const assembly = serializationObjectCreateNull<unknown>();
    assembly.kind = "assembly";
    assembly.instances = instances;
    return assembly as unknown as NodeIRV7;
  }
  // Every other v1-v6 node is a structural member of NodeIRV7. In particular,
  // a principal PlaneIR is one arm of PlaneIRV7.
  return node;
}

function migrateLegacyDocumentSnapshotToV7(
  source: DesignDocument,
): DesignDocumentV7 {
  const nodes = serializationObjectCreateNull<NodeIRV7>();
  const sourceNodes = source.nodes as Readonly<Record<string, NodeIR>>;
  const nodeIds = serializationObjectKeys(sourceNodes);
  for (let index = 0; index < nodeIds.length; index += 1) {
    const id = nodeIds[index]!;
    nodes[id] = migrateNodeToV7(sourceNodes[id]!);
  }

  const candidate = serializationObjectCreateNull<unknown>();
  candidate.schema = DOCUMENT_SCHEMA_V7;
  candidate.version = DOCUMENT_VERSION_V7;
  candidate.name = source.name;
  candidate.units = source.units;
  candidate.parameters = source.parameters;
  if (serializationObjectHasOwn(source, "materials")) {
    candidate.materials = source.materials;
  }
  if (serializationObjectHasOwn(source, "configurations")) {
    candidate.configurations = source.configurations;
  }
  candidate.nodes = nodes;
  candidate.outputs = source.outputs;
  if (serializationObjectHasOwn(source, "metadata")) {
    candidate.metadata = source.metadata;
  }
  if (
    (source.version === DOCUMENT_VERSION_V2 ||
      source.version === DOCUMENT_VERSION_V3 ||
      source.version === DOCUMENT_VERSION_V4 ||
      source.version === DOCUMENT_VERSION_V5 ||
      source.version === DOCUMENT_VERSION_V6) &&
    serializationObjectHasOwn(source, "topologyReferences")
  ) {
    candidate.topologyReferences = source.topologyReferences;
  }
  return candidate as unknown as DesignDocumentV7;
}

/**
 * Internal staging migration from any frozen public grammar to the reserved v7
 * foundation.
 *
 * This helper is intentionally not re-exported from the root package while
 * ordinary authoring, parsing, evaluation, hashes, and impact analysis remain
 * on v6. It performs one strict descriptor capture of either a frozen legacy
 * document or an already-staged v7 document, then validates and bounds the
 * trusted snapshot without reading caller-owned objects again. Durable legacy
 * identities that v7 cannot represent verbatim are diagnosed, never rewritten.
 */
export function migrateDocumentToV7(
  value: unknown,
  options: ParseDocumentOptions = {},
): CadResult<DesignDocumentV7> {
  const normalizedLimits = parseV7Limits(options);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!normalizedLimits.ok) return normalizedLimits;

  const preflight = preflightDocumentValueV7WithLimits(
    value,
    normalizedLimits.value,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!preflight.ok) return preflight;

  return migrateTrustedDocumentSnapshotToV7(
    preflight.value,
    normalizedLimits.value,
  );
}

function migrateTrustedDocumentSnapshotToV7(
  snapshot: unknown,
  limits: DesignDocumentLimits,
): CadResult<DesignDocumentV7> {
  const snapshotRecord =
    typeof snapshot === "object" &&
    snapshot !== null &&
    !serializationArrayIsArray(snapshot)
      ? (snapshot as Readonly<Record<string, unknown>>)
      : undefined;
  if (snapshotRecord?.version === DOCUMENT_VERSION_V7) {
    // A valid v7 snapshot can be topology-canonicalized before Zod clones it.
    // If a malformed shape prevents that early check, validation supplies the
    // precise schema diagnostic and the exact byte check is retried afterward.
    const earlyBytes = checkDocumentV7CanonicalByteLimit(
      snapshot as DesignDocumentV7,
      limits,
    );
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    if (!earlyBytes.ok && isDocumentByteLimitFailure(earlyBytes)) {
      return earlyBytes;
    }
    const parsedV7 = validateDocumentV7Snapshot(snapshot);
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    if (!parsedV7.ok) return parsedV7;
    if (!earlyBytes.ok) {
      const bytes = checkDocumentV7CanonicalByteLimit(
        parsedV7.value,
        limits,
      );
      if (!bytes.ok) {
        return {
          ok: false,
          diagnostics: concatenateDiagnostics(
            parsedV7.diagnostics,
            bytes.diagnostics,
          ),
        };
      }
    }
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return serializationIntegrityFailure();
    }
    return parsedV7;
  }

  const parsedLegacy = validateLegacyDocumentSnapshot(snapshot);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!parsedLegacy.ok) return parsedLegacy;

  const identityDiagnostics =
    diagnoseDocumentV7IdentityRepresentability(parsedLegacy.value);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (identityDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: concatenateDiagnostics(
        parsedLegacy.diagnostics,
        identityDiagnostics,
      ),
    };
  }

  const candidate = migrateLegacyDocumentSnapshotToV7(parsedLegacy.value);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  const limitCheck = checkTrustedDesignDocumentSnapshotLimits(
    candidate,
    limits,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!limitCheck.ok) {
    return {
      ok: false,
      diagnostics: concatenateDiagnostics(
        parsedLegacy.diagnostics,
        limitCheck.diagnostics,
      ),
    };
  }

  const bytes = checkDocumentV7CanonicalByteLimit(
    candidate,
    limits,
  );
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!bytes.ok) {
    return {
      ok: false,
      diagnostics: concatenateDiagnostics(
        parsedLegacy.diagnostics,
        bytes.diagnostics,
      ),
    };
  }

  const migrated = validateDocumentV7Snapshot(candidate);
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return serializationIntegrityFailure();
  }
  if (!migrated.ok) {
    return {
      ok: false,
      diagnostics: concatenateDiagnostics(
        parsedLegacy.diagnostics,
        migrated.diagnostics,
      ),
    };
  }
  return documentV7RuntimeIntrinsicsAreIntact()
    ? prependDiagnostics(parsedLegacy.diagnostics, migrated)
    : serializationIntegrityFailure();
}
