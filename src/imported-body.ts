import {
  DEFAULT_DESIGN_DOCUMENT_LIMITS,
  type DesignDocumentLimits,
} from "./document-limits.js";
import type { NodeId, ResourceId } from "./core/ids.js";
import {
  CadError,
  diagnostic,
  failure,
  success,
  type CadResult,
} from "./core/result.js";
import type {
  BinaryShapeExportFormat,
  ShapeExportFormat,
  StepExportOptions,
  TextShapeExportFormat,
} from "./evaluator.js";
import type {
  DesignDocumentV7,
  ResourceDigestIR,
} from "./ir.js";
import type {
  MeshData,
  MeshOptions,
  ShapeMeasurements,
} from "./kernel.js";
import type { KernelTopologySnapshot } from "./protocol/topology.js";
import {
  parseDocumentV7,
  stringifyDocumentV7,
  type ParseDocumentOptions,
} from "./serialization.js";
import {
  stagedBodySetDesignV7,
  type StagedImportedBodyAuthoringOptionsV7,
} from "./internal/document-v7-body-set-authoring.js";
import {
  capturedImportedBodyDocument,
  defaultImportedBodyResourceLimits,
  publicImportedBodyErrorMessage,
  publicImportedBodyResult,
  retainImportedBodyDocument,
} from "./internal/imported-body-runtime.js";

/**
 * Version of the public, single-body admitted-resource workflow.
 *
 * This is intentionally independent from the broader design-document version.
 */
export const IMPORTED_BODY_WORKFLOW_PROTOCOL_VERSION = 1 as const;

/**
 * Closed format-to-media-type policy for imported-body workflow protocol v1.
 *
 * The media type is committed provenance. The explicit `format` still chooses
 * the reader; no MIME sniffing or format inference occurs.
 */
export const IMPORTED_BODY_MEDIA_TYPES = Object.freeze({
  step: "model/step",
  brep: "text/plain",
  "brep-binary": "application/octet-stream",
} as const);

/** Exact native formats admitted by imported-body workflow protocol v1. */
export type ImportedBodyFormat = "step" | "brep" | "brep-binary";
/** Media types committed by the protocol-v1 format policy. */
export type ImportedBodyMediaType =
  (typeof IMPORTED_BODY_MEDIA_TYPES)[keyof typeof IMPORTED_BODY_MEDIA_TYPES];
/** Declared source length units available to unitless BREP data. */
export type ImportedBodyLengthUnit = "mm" | "cm" | "m" | "in";
/** Lowercase SHA-256 resource commitment. */
export type ImportedBodyResourceDigest = `sha256:${string}`;

/** Immutable provenance needed to resolve and verify one native body source. */
export interface ImportedBodyResourceCommitment {
  /** Stable authored identity in this imported-body document. */
  readonly id: string;
  /** Lowercase `sha256:<64 hex>` commitment to the resolver-supplied bytes. */
  readonly digest: ImportedBodyResourceDigest;
  /** Exact committed byte length checked before native parsing. */
  readonly byteLength: number;
  /** Protocol-defined media type; the explicit format still selects the reader. */
  readonly mediaType: ImportedBodyMediaType;
  /** Ordered resolver hints only. InvariantCAD performs no location I/O. */
  readonly locations?: readonly string[];
}

/** Authored source and unit policy for one exact imported solid. */
export type ImportedBodyDefinition =
  | {
      /** Stable body, feature, and sole output identity. */
      readonly id: string;
      readonly resource: ImportedBodyResourceCommitment & {
        readonly mediaType: "model/step";
      };
      readonly format: "step";
      readonly units: { readonly mode: "from-file" };
    }
  | {
      /** Stable body, feature, and sole output identity. */
      readonly id: string;
      readonly resource: ImportedBodyResourceCommitment & {
        readonly mediaType: "text/plain";
      };
      readonly format: "brep";
      readonly units: {
        readonly mode: "declared";
        readonly length: ImportedBodyLengthUnit;
      };
    }
  | {
      /** Stable body, feature, and sole output identity. */
      readonly id: string;
      readonly resource: ImportedBodyResourceCommitment & {
        readonly mediaType: "application/octet-stream";
      };
      readonly format: "brep-binary";
      readonly units: {
        readonly mode: "declared";
        readonly length: ImportedBodyLengthUnit;
      };
    };

/** Frozen, inspectable provenance retained by the document and result. */
export interface ImportedBodyProvenance {
  /** Stable body, feature, and sole output identity. */
  readonly id: string;
  /** Detached resource commitment and resolver hints. */
  readonly resource: ImportedBodyResourceCommitment;
  /** Exact native reader selected for this body. */
  readonly format: ImportedBodyFormat;
  /** File-authored STEP units or explicitly declared BREP units. */
  readonly units:
    | { readonly mode: "from-file" }
    | {
        readonly mode: "declared";
        readonly length: ImportedBodyLengthUnit;
      };
  /** Protocol v1 performs no automatic repair or healing. */
  readonly healing: { readonly mode: "none" };
  /** Protocol v1 admits exactly one valid positive-volume solid. */
  readonly expected: "single-solid";
}

/**
 * Identity-checked, deeply frozen document for one verified imported solid.
 *
 * Persist it with {@link stringifyImportedBodyDocument} and reopen it with
 * {@link parseImportedBodyDocument}. The broad design-document aliases remain
 * on their frozen public version until complete product-model promotion.
 */
export interface ImportedBodyDocument {
  /** Version of this narrow public workflow, independent of design documents. */
  readonly protocolVersion: typeof IMPORTED_BODY_WORKFLOW_PROTOCOL_VERSION;
  /** Authored document label. */
  readonly name: string;
  /** Frozen source commitment and exact import policy. */
  readonly provenance: ImportedBodyProvenance;
}

/** Frozen request passed to the caller-owned resource resolver. */
export interface ImportedBodyResolverRequest {
  /** Authored resource identity. */
  readonly id: string;
  /** Expected SHA-256 commitment. */
  readonly digest: ImportedBodyResourceDigest;
  /** Expected exact byte length. */
  readonly byteLength: number;
  /** Committed media type. */
  readonly mediaType: ImportedBodyMediaType;
  /** Ordered, uninterpreted resolver hints. */
  readonly locations?: readonly string[];
  /** Cancellation signal for this evaluation, when supplied. */
  readonly signal?: AbortSignal;
}

/** Caller-owned resource lookup; InvariantCAD performs no location I/O. */
export type ImportedBodyResolver = (
  request: ImportedBodyResolverRequest,
) =>
  | ArrayBuffer
  | Uint8Array
  | PromiseLike<ArrayBuffer | Uint8Array>;

/** Resource work ceilings exposed by the narrow public workflow. */
export interface ImportedBodyResourceLimits {
  /** Maximum admitted bytes for the single resolved source. */
  readonly maxResourceBytes: number;
}

/** Default resource ceilings for one imported-body evaluation. */
export const DEFAULT_IMPORTED_BODY_RESOURCE_LIMITS: ImportedBodyResourceLimits =
  defaultImportedBodyResourceLimits;

/** Bounded resolution, validation, and cancellation controls. */
export interface EvaluateImportedBodyOptions {
  /** Required callback that supplies bytes for the committed resource. */
  readonly resolver?: ImportedBodyResolver;
  /** Single-resource byte ceiling. */
  readonly resourceLimits?: Partial<ImportedBodyResourceLimits>;
  /** Structural and canonical document work ceilings. */
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  /** Cooperative cancellation signal. */
  readonly signal?: AbortSignal;
}

/** Canonical serialization controls and structural work ceilings. */
export interface StringifyImportedBodyDocumentOptions
  extends ParseDocumentOptions {
  /** Emit stable two-space JSON formatting instead of compact JSON. */
  readonly pretty?: boolean;
}

/**
 * Owned evaluated exact body.
 *
 * `dispose()` releases only this evaluation's imported native shape. It does
 * not dispose the evaluator or its kernel.
 */
export interface EvaluatedImportedBody {
  /** Sole authored output identity. */
  readonly name: string;
  /** Imported bodies never silently fall back to approximate geometry. */
  readonly exact: true;
  /** Native representation retained by the strong import contract. */
  readonly representation: "brep";
  /** Frozen source commitment and import policy. */
  readonly provenance: ImportedBodyProvenance;
  /** Tessellates the retained exact body without changing its representation. */
  mesh(options?: MeshOptions): MeshData;
  /** Measures the retained exact body. */
  measure(): ShapeMeasurements;
  /** Returns capability-gated topology or structured diagnostics. */
  topology(): CadResult<KernelTopologySnapshot>;
  /** Exports deterministic STEP when the kernel supports the strong contract. */
  export(format: "step", options?: StepExportOptions): Uint8Array;
  /** Exports a supported binary native or mesh format. */
  export(format: BinaryShapeExportFormat): Uint8Array;
  /** Exports a supported text mesh format. */
  export(format: TextShapeExportFormat): string;
  /** Exports any supported single-shape exchange format. */
  export(format: ShapeExportFormat): Uint8Array | string;
  /** Idempotently releases this result's native body. */
  dispose(): void;
}

type SourceFailure = {
  readonly message: string;
  readonly path: string;
};

const ImportedBodyArray = Array;
const ImportedBodyNumber = Number;
const ImportedBodyObject = Object;
const ImportedBodyReflect = Reflect;
const ImportedBodyWeakSet = WeakSet;
const importedBodyArrayIsArray = Array.isArray;
const importedBodyObjectCreate = Object.create;
const importedBodyObjectDefineProperty = Object.defineProperty;
const importedBodyObjectFreeze = Object.freeze;
const importedBodyObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const importedBodyObjectGetPrototypeOf = Object.getPrototypeOf;
const importedBodyObjectHasOwn = Object.hasOwn;
const importedBodyObjectKeys = Object.keys;
const importedBodyObjectPrototype = Object.prototype;
const importedBodyNumberIsSafeInteger = Number.isSafeInteger;
const importedBodyReflectApply = Reflect.apply;
const importedBodyReflectOwnKeys = Reflect.ownKeys;
const importedBodyWeakSetAdd = WeakSet.prototype.add;
const importedBodyWeakSetHas = WeakSet.prototype.has;

const importedBodySourceFailures = new ImportedBodyWeakSet<object>();

function applyImportedBody<T>(
  operation: CallableFunction,
  receiver: unknown,
  arguments_: readonly unknown[],
): T {
  return importedBodyReflectApply(
    operation,
    receiver,
    arguments_,
  ) as T;
}

function defineImportedBodyValue(
  target: object,
  property: PropertyKey,
  value: unknown,
  enumerable = true,
): void {
  applyImportedBody<void>(
    importedBodyObjectDefineProperty,
    ImportedBodyObject,
    [
      target,
      property,
      {
        configurable: false,
        enumerable,
        writable: false,
        value,
      },
    ],
  );
}

function freezeImportedBody<T>(value: T): T {
  return applyImportedBody<T>(
    importedBodyObjectFreeze,
    ImportedBodyObject,
    [value],
  );
}

function sourceFailure(message: string, path: string): never {
  const value = freezeImportedBody({ message, path });
  applyImportedBody<WeakSet<object>>(
    importedBodyWeakSetAdd,
    importedBodySourceFailures,
    [value],
  );
  throw value;
}

function capturedSourceFailure(value: unknown): SourceFailure | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return applyImportedBody<boolean>(
      importedBodyWeakSetHas,
      importedBodySourceFailures,
      [value],
    )
      ? (value as SourceFailure)
      : undefined;
  } catch {
    return undefined;
  }
}

function importedBodyHasOwn(
  value: object,
  property: PropertyKey,
): boolean {
  return applyImportedBody<boolean>(
    importedBodyObjectHasOwn,
    ImportedBodyObject,
    [value, property],
  );
}

function importedBodyStringListHas(
  values: readonly string[],
  expected: string,
): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function importedBodyKeys(value: object): string[] {
  return applyImportedBody<string[]>(
    importedBodyObjectKeys,
    ImportedBodyObject,
    [value],
  );
}

function captureOwnDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  label: string,
  path: string,
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    applyImportedBody<boolean>(
      importedBodyArrayIsArray,
      ImportedBodyArray,
      [value],
    )
  ) {
    sourceFailure(`${label} must be a plain object`, path);
  }
  const record = value as object;
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = applyImportedBody<object | null>(
      importedBodyObjectGetPrototypeOf,
      ImportedBodyObject,
      [record],
    );
    keys = applyImportedBody<readonly PropertyKey[]>(
      importedBodyReflectOwnKeys,
      ImportedBodyReflect,
      [record],
    );
  } catch {
    sourceFailure(`${label} could not be inspected safely`, path);
  }
  if (prototype !== importedBodyObjectPrototype && prototype !== null) {
    sourceFailure(`${label} must be a plain object`, path);
  }
  const captured = applyImportedBody<Record<string, unknown>>(
    importedBodyObjectCreate,
    ImportedBodyObject,
    [null],
  );
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (
      typeof key !== "string" ||
      !importedBodyStringListHas(allowedKeys, key)
    ) {
      sourceFailure(
        typeof key === "string"
          ? `${label} contains unknown property '${key}'`
          : `${label} contains an unsupported symbol property`,
        path,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = applyImportedBody<PropertyDescriptor | undefined>(
        importedBodyObjectGetOwnPropertyDescriptor,
        ImportedBodyObject,
        [record, key],
      );
    } catch {
      sourceFailure(`${label}.${key} could not be inspected safely`, `${path}/${key}`);
    }
    if (
      descriptor === undefined ||
      !importedBodyHasOwn(descriptor, "value")
    ) {
      sourceFailure(
        `${label}.${key} must be an own data property`,
        `${path}/${key}`,
      );
    }
    defineImportedBodyValue(captured, key, descriptor.value);
  }
  for (let index = 0; index < requiredKeys.length; index += 1) {
    const key = requiredKeys[index]!;
    if (!importedBodyHasOwn(captured, key)) {
      sourceFailure(
        `${label}.${key} is required`,
        `${path}/${key}`,
      );
    }
  }
  return freezeImportedBody(captured);
}

function captureLocations(
  value: unknown,
  path: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !applyImportedBody<boolean>(
      importedBodyArrayIsArray,
      ImportedBodyArray,
      [value],
    )
  ) {
    sourceFailure("Resource locations must be a dense array", path);
  }
  const source = value as readonly unknown[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = applyImportedBody<
      PropertyDescriptor | undefined
    >(
      importedBodyObjectGetOwnPropertyDescriptor,
      ImportedBodyObject,
      [source, "length"],
    );
  } catch {
    sourceFailure("Resource locations length could not be inspected safely", path);
  }
  const length = lengthDescriptor?.value;
  if (
    typeof length !== "number" ||
    !applyImportedBody<boolean>(
      importedBodyNumberIsSafeInteger,
      ImportedBodyNumber,
      [length],
    ) ||
    length < 0
  ) {
    sourceFailure("Resource locations length is malformed", path);
  }
  if (length === 0) {
    sourceFailure("Resource locations must not be empty", path);
  }
  if (
    length >
    DEFAULT_DESIGN_DOCUMENT_LIMITS.maxResourceLocations
  ) {
    sourceFailure(
      `Resource locations exceed the limit of ${DEFAULT_DESIGN_DOCUMENT_LIMITS.maxResourceLocations}`,
      path,
    );
  }
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = applyImportedBody<readonly PropertyKey[]>(
      importedBodyReflectOwnKeys,
      ImportedBodyReflect,
      [source],
    );
  } catch {
    sourceFailure("Resource locations could not be inspected safely", path);
  }
  if (ownKeys.length !== length + 1) {
    sourceFailure(
      "Resource locations must not contain custom properties",
      path,
    );
  }
  const copied = new ImportedBodyArray<string>(length);
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = applyImportedBody<PropertyDescriptor | undefined>(
        importedBodyObjectGetOwnPropertyDescriptor,
        ImportedBodyObject,
        [source, index],
      );
    } catch {
      sourceFailure(
        `Resource location ${index} could not be inspected safely`,
        `${path}/${index}`,
      );
    }
    if (
      descriptor === undefined ||
      !importedBodyHasOwn(descriptor, "value") ||
      typeof descriptor.value !== "string" ||
      descriptor.value.length === 0
    ) {
      sourceFailure(
        `Resource location ${index} must be a non-empty own data string`,
        `${path}/${index}`,
      );
    }
    defineImportedBodyValue(copied, index, descriptor.value);
  }
  return freezeImportedBody(copied);
}

function expectedMediaType(format: ImportedBodyFormat): ImportedBodyMediaType {
  switch (format) {
    case "step":
      return IMPORTED_BODY_MEDIA_TYPES.step;
    case "brep":
      return IMPORTED_BODY_MEDIA_TYPES.brep;
    case "brep-binary":
      return IMPORTED_BODY_MEDIA_TYPES["brep-binary"];
  }
}

interface CapturedImportedBodyDefinition {
  readonly definition: ImportedBodyDefinition;
  readonly provenance: ImportedBodyProvenance;
}

function captureImportedBodyDefinition(
  value: unknown,
): CapturedImportedBodyDefinition {
  const definition = captureOwnDataRecord(
    value,
    ["id", "resource", "format", "units"],
    ["id", "resource", "format", "units"],
    "Imported-body definition",
    "/definition",
  );
  const id = definition.id;
  const format = definition.format;
  if (typeof id !== "string") {
    sourceFailure(
      "Imported-body definition.id must be a string",
      "/definition/id",
    );
  }
  if (
    format !== "step" &&
    format !== "brep" &&
    format !== "brep-binary"
  ) {
    sourceFailure(
      "Imported-body definition.format is unsupported",
      "/definition/format",
    );
  }
  const resource = captureOwnDataRecord(
    definition.resource,
    ["id", "digest", "byteLength", "mediaType", "locations"],
    ["id", "digest", "byteLength", "mediaType"],
    "Imported-body resource",
    "/definition/resource",
  );
  const resourceId = resource.id;
  const digest = resource.digest;
  const byteLength = resource.byteLength;
  const mediaType = resource.mediaType;
  if (typeof resourceId !== "string") {
    sourceFailure(
      "Imported-body resource.id must be a string",
      "/definition/resource/id",
    );
  }
  if (typeof digest !== "string") {
    sourceFailure(
      "Imported-body resource.digest must be a string",
      "/definition/resource/digest",
    );
  }
  if (typeof byteLength !== "number") {
    sourceFailure(
      "Imported-body resource.byteLength must be a number",
      "/definition/resource/byteLength",
    );
  }
  if (mediaType !== expectedMediaType(format)) {
    sourceFailure(
      `Imported-body ${format} requires mediaType '${expectedMediaType(format)}'`,
      "/definition/resource/mediaType",
    );
  }
  const locations = captureLocations(
    resource.locations,
    "/definition/resource/locations",
  );
  const units = captureOwnDataRecord(
    definition.units,
    format === "step" ? ["mode"] : ["mode", "length"],
    format === "step" ? ["mode"] : ["mode", "length"],
    "Imported-body units",
    "/definition/units",
  );
  let capturedUnits: ImportedBodyProvenance["units"];
  if (format === "step") {
    if (units.mode !== "from-file") {
      sourceFailure(
        "STEP imported bodies require units.mode 'from-file'",
        "/definition/units/mode",
      );
    }
    capturedUnits = freezeImportedBody({ mode: "from-file" as const });
  } else {
    const length = units.length;
    if (
      units.mode !== "declared" ||
      (length !== "mm" &&
        length !== "cm" &&
        length !== "m" &&
        length !== "in")
    ) {
      sourceFailure(
        "BREP imported bodies require a declared mm, cm, m, or in length unit",
        "/definition/units",
      );
    }
    capturedUnits = freezeImportedBody({
      mode: "declared" as const,
      length,
    });
  }
  const capturedResource = freezeImportedBody({
    id: resourceId,
    digest: digest as ResourceDigestIR,
    byteLength,
    mediaType,
    ...(locations === undefined ? {} : { locations }),
  }) as ImportedBodyResourceCommitment;
  const capturedDefinition = freezeImportedBody({
    id,
    resource: capturedResource,
    format,
    units: capturedUnits,
  }) as ImportedBodyDefinition;
  const provenance = freezeImportedBody({
    ...capturedDefinition,
    healing: freezeImportedBody({ mode: "none" as const }),
    expected: "single-solid" as const,
  });
  return freezeImportedBody({
    definition: capturedDefinition,
    provenance,
  });
}

function importedBodySourceFailureResult(
  error: unknown,
): CadResult<ImportedBodyDocument> {
  const captured = capturedSourceFailure(error);
  return failure(
    diagnostic(
      "IMPORT_SOURCE_INVALID",
      captured?.message ??
        publicImportedBodyErrorMessage(
          error,
          "Imported-body definition could not be captured safely",
        ),
      {
        severity: "error",
        path: captured?.path ?? "/definition",
        details: {
          phase: "importedBodyDocumentAuthoring",
          protocolVersion: IMPORTED_BODY_WORKFLOW_PROTOCOL_VERSION,
        },
      },
    ),
  );
}

/**
 * Creates one canonical imported-body document without reading resource bytes.
 */
export function createImportedBodyDocument(
  name: string,
  definition: ImportedBodyDefinition,
): CadResult<ImportedBodyDocument> {
  try {
    if (typeof name !== "string") {
      sourceFailure(
        "Imported-body document name must be a string",
        "/name",
      );
    }
    const captured = captureImportedBodyDefinition(definition);
    const builder = stagedBodySetDesignV7(name);
    const resource = builder.resource(
      captured.definition.resource.id,
      {
        digest: captured.definition.resource.digest,
        byteLength: captured.definition.resource.byteLength,
        mediaType: captured.definition.resource.mediaType,
        ...(captured.definition.resource.locations === undefined
          ? {}
          : { locations: captured.definition.resource.locations }),
      },
    );
    const authoringOptions: StagedImportedBodyAuthoringOptionsV7 =
      captured.definition.format === "step"
        ? {
            format: "step",
            units: { mode: "from-file" },
          }
        : {
            format: captured.definition.format,
            units: captured.definition.units as {
              readonly mode: "declared";
              readonly length: ImportedBodyLengthUnit;
            },
          };
    const body = builder.importedBody(
      captured.definition.id,
      resource,
      authoringOptions,
    );
    builder.output(captured.definition.id, body);
    const document = builder.build();
    return success(
      retainImportedBodyDocument(
        document,
        captured.definition.id,
        captured.provenance,
        IMPORTED_BODY_WORKFLOW_PROTOCOL_VERSION,
      ),
    );
  } catch (error) {
    return importedBodySourceFailureResult(error);
  }
}

function importedBodySubsetFailure(
  message: string,
  path = "/",
): CadResult<ImportedBodyDocument> {
  return failure(
    diagnostic("IR_INVALID", message, {
      severity: "error",
      path,
      details: {
        phase: "importedBodyDocumentParsing",
        supported: "one-resource-one-imported-body-one-solid-output",
      },
    }),
  );
}

function narrowImportedBodyDocument(
  document: DesignDocumentV7,
): CadResult<ImportedBodyDocument> {
  const resourceIds = importedBodyKeys(document.resources ?? {});
  const nodeIds = importedBodyKeys(document.nodes);
  const outputNames = importedBodyKeys(document.outputs);
  if (
    resourceIds.length !== 1 ||
    nodeIds.length !== 1 ||
    outputNames.length !== 1
  ) {
    return importedBodySubsetFailure(
      "Imported-body documents require exactly one resource, one imported-body node, and one output",
    );
  }
  const resourceId = resourceIds[0]!;
  const nodeId = nodeIds[0]!;
  const output = outputNames[0]!;
  const resource = document.resources![resourceId as ResourceId]!;
  const node = document.nodes[nodeId as NodeId]!;
  const reference = document.outputs[output]!;
  if (
    node.kind !== "importedBody" ||
    reference.kind !== "solid" ||
    reference.node !== nodeId ||
    output !== nodeId ||
    node.resource !== resourceId
  ) {
    return importedBodySubsetFailure(
      "The sole output must directly reference the sole imported-body node",
      `/outputs/${output}`,
    );
  }
  const definition = {
    id: nodeId,
    resource: {
      id: resourceId,
      digest: resource.digest,
      byteLength: resource.byteLength,
      mediaType: resource.mediaType,
      ...(resource.locations === undefined
        ? {}
        : { locations: resource.locations }),
    },
    format: node.format,
    units: node.units,
  } as ImportedBodyDefinition;
  const recreated = createImportedBodyDocument(document.name, definition);
  if (!recreated.ok) {
    return importedBodySubsetFailure(
      recreated.diagnostics[0]?.message ??
        "The imported-body document violates the public workflow policy",
      recreated.diagnostics[0]?.path,
    );
  }
  const recreatedState = capturedImportedBodyDocument(recreated.value);
  if (recreatedState === undefined) {
    return importedBodySubsetFailure(
      "The imported-body document could not be retained safely",
    );
  }
  try {
    if (
      stringifyDocumentV7(document) !==
      stringifyDocumentV7(recreatedState.document)
    ) {
      return importedBodySubsetFailure(
        "The document contains fields outside the public imported-body workflow",
      );
    }
  } catch (error) {
    return importedBodySubsetFailure(
      publicImportedBodyErrorMessage(
        error,
        "The imported-body document could not be canonicalized safely",
      ),
    );
  }
  return recreated;
}

/**
 * Parses only the public single-imported-body document subset.
 *
 * The underlying raw boundary rejects duplicate JSON member names and applies
 * the existing bounded document parser before this narrower policy check.
 */
export function parseImportedBodyDocument(
  text: string,
  options: ParseDocumentOptions = {},
): CadResult<ImportedBodyDocument> {
  const parsed = publicImportedBodyResult(
    parseDocumentV7(text, options),
  );
  if (!parsed.ok) return parsed;
  const narrowed = narrowImportedBodyDocument(parsed.value);
  return narrowed.ok
    ? success(narrowed.value, parsed.diagnostics)
    : narrowed;
}

/**
 * Canonically serializes one identity-checked imported-body document.
 */
export function stringifyImportedBodyDocument(
  document: ImportedBodyDocument,
  options: StringifyImportedBodyDocumentOptions = {},
): string {
  const state = capturedImportedBodyDocument(document);
  if (state === undefined) {
    const value = diagnostic(
      "IR_INVALID",
      "Expected an ImportedBodyDocument created or parsed by InvariantCAD",
      {
        severity: "error",
        path: "/",
        details: { phase: "importedBodyDocumentSerialization" },
      },
    );
    throw new CadError(value.message, [value]);
  }
  try {
    return stringifyDocumentV7(state.document, options);
  } catch (error) {
    throw new TypeError(
      publicImportedBodyErrorMessage(
        error,
        "Cannot serialize the imported-body document safely",
      ),
    );
  }
}
