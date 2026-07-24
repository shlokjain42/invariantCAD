import { z } from "zod";
import type { JsonValue } from "./core/json.js";
import {
  DEFAULT_DESIGN_DOCUMENT_LIMITS,
  preflightDesignDocumentValue,
} from "./document-limits.js";
import {
  captureDocumentV7RuntimeOwnerIntegrityChecker,
  DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
  documentV7RuntimeIntrinsicsAreIntact,
} from "./internal/document-v7-runtime-integrity.js";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_SCHEMA_V6,
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DOCUMENT_VERSION_V6,
  DOCUMENT_VERSION_V7,
  NODE_KINDS_V1,
  NODE_KINDS_V2,
  NODE_KINDS_V3,
  NODE_KINDS_V4,
  NODE_KINDS_V5,
  NODE_KINDS_V6,
  NODE_KINDS_V7,
  type DesignDocument,
  type DesignDocumentV1,
  type DesignDocumentV2,
  type DesignDocumentV3,
  type DesignDocumentV4,
  type DesignDocumentV5,
  type DesignDocumentV6,
  type DesignDocumentV7,
  type NodeIR,
  type NodeIRV1,
  type NodeIRV2,
  type NodeIRV3,
  type NodeIRV4,
  type NodeIRV5,
  type NodeIRV6,
  type NodeIRV7,
  type TopologyReferenceEntryIR,
  type TopologyReferenceEntryIRV2,
  type TopologyReferenceEntryIRV3,
  type TopologyReferenceEntryIRV4,
  type TopologyReferenceEntryIRV5,
  type TopologyReferenceEntryIRV6,
  type TopologyReferenceEntryIRV7,
  type TopologyQueryIR,
  type TopologyQueryIRFor,
  type TopologyQueryIRV1,
  type TopologyQueryIRV2,
  type TopologyQueryIRV3,
  type TopologyQueryIRV4,
  type TopologyQueryIRV5,
  type TopologyQueryIRV6,
  type TopologySelectionIR,
  type TopologySelectionIRFor,
  type TopologySelectionIRV1,
  type TopologySelectionIRV2,
  type TopologySelectionIRV3,
  type TopologySelectionIRV4,
  type TopologySelectionIRV5,
  type TopologySelectionIRV6,
} from "./ir.js";
import type { ExpressionIR } from "./expressions.js";
import { pluralTopologyKind } from "./internal/topology-language.js";
import {
  TOPOLOGY_ROLES_V1,
  TOPOLOGY_ROLES_V2,
  TOPOLOGY_ROLES_V3,
  TOPOLOGY_ROLES_V4,
  TOPOLOGY_ROLES_V5,
  TOPOLOGY_ROLES_V6,
  type TopologyKind,
  type TopologyKindV1,
  type TopologyRole,
  type TopologyRoleV1,
  type TopologyRoleV2,
  type TopologyRoleV3,
  type TopologyRoleV4,
  type TopologyRoleV5,
  type TopologyRoleV6,
} from "./protocol/topology.js";
import { SHELL_DIRECTIONS } from "./protocol/shell.js";
import { OFFSET_DIRECTIONS } from "./protocol/offset.js";
import {
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1,
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2,
  normalizePersistentTopologyReference,
  type PersistentTopologyReference,
  type PersistentTopologyReferenceV2,
  type PersistentTopologyReferenceV3,
  type PersistentTopologyReferenceV4,
  type PersistentTopologyReferenceV5,
  type PersistentTopologyReferenceV6,
} from "./topology-signatures.js";

const V7IntrinsicArray = Array;
const V7IntrinsicNumber = Number;
const V7IntrinsicObject = Object;
const V7IntrinsicReflect = Reflect;
const V7IntrinsicWeakSet = WeakSet;
const v7IntrinsicArrayIsArray = V7IntrinsicArray.isArray;
const v7IntrinsicArrayPrototype = V7IntrinsicArray.prototype;
const v7IntrinsicNumberIsFinite = Number.isFinite;
const v7IntrinsicNumberIsSafeInteger = Number.isSafeInteger;
const v7IntrinsicObjectCreate = Object.create;
const v7IntrinsicObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const v7IntrinsicObjectGetPrototypeOf = Object.getPrototypeOf;
const v7IntrinsicObjectHasOwn = Object.hasOwn;
const v7IntrinsicObjectIs = Object.is;
const v7IntrinsicObjectKeys = Object.keys;
const v7IntrinsicObjectPrototype = Object.prototype;
const v7IntrinsicReflectOwnKeys = V7IntrinsicReflect.ownKeys;
const v7IntrinsicStringCharCodeAt = String.prototype.charCodeAt;
const v7IntrinsicWeakSetAdd = V7IntrinsicWeakSet.prototype.add;
const v7IntrinsicWeakSetDelete = V7IntrinsicWeakSet.prototype.delete;
const v7IntrinsicWeakSetHas = V7IntrinsicWeakSet.prototype.has;
const v7ReflectApply = Reflect.apply;

function v7ArrayIsArray(value: unknown): value is readonly unknown[] {
  return v7ReflectApply(v7IntrinsicArrayIsArray, V7IntrinsicArray, [
    value,
  ]) as boolean;
}

function v7NumberIsFinite(value: unknown): value is number {
  return v7ReflectApply(v7IntrinsicNumberIsFinite, V7IntrinsicNumber, [
    value,
  ]) as boolean;
}

function v7NumberIsSafeInteger(value: unknown): value is number {
  return v7ReflectApply(v7IntrinsicNumberIsSafeInteger, V7IntrinsicNumber, [
    value,
  ]) as boolean;
}

function v7ObjectCreateNull(): Record<string, JsonValue> {
  return v7ReflectApply(v7IntrinsicObjectCreate, V7IntrinsicObject, [
    null,
  ]) as Record<string, JsonValue>;
}

function v7ObjectGetPrototypeOf(value: object): object | null {
  return v7ReflectApply(v7IntrinsicObjectGetPrototypeOf, V7IntrinsicObject, [
    value,
  ]) as object | null;
}

function v7ObjectGetOwnPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  return v7ReflectApply(
    v7IntrinsicObjectGetOwnPropertyDescriptor,
    V7IntrinsicObject,
    [value, key],
  ) as PropertyDescriptor | undefined;
}

function v7ObjectHasOwn(value: object, key: PropertyKey): boolean {
  return v7ReflectApply(v7IntrinsicObjectHasOwn, V7IntrinsicObject, [
    value,
    key,
  ]) as boolean;
}

function v7ObjectIs(first: unknown, second: unknown): boolean {
  return v7ReflectApply(v7IntrinsicObjectIs, V7IntrinsicObject, [
    first,
    second,
  ]) as boolean;
}

function v7ObjectKeys(value: object): string[] {
  return v7ReflectApply(v7IntrinsicObjectKeys, V7IntrinsicObject, [
    value,
  ]) as string[];
}

function v7ReflectOwnKeys(value: object): (string | symbol)[] {
  return v7ReflectApply(v7IntrinsicReflectOwnKeys, V7IntrinsicReflect, [
    value,
  ]) as (string | symbol)[];
}

function v7StringCharCodeAt(value: string, index: number): number {
  return v7ReflectApply(v7IntrinsicStringCharCodeAt, value, [index]) as number;
}

function v7WeakSetAdd(value: WeakSet<object>, entry: object): void {
  v7ReflectApply(v7IntrinsicWeakSetAdd, value, [entry]);
}

function v7WeakSetDelete(value: WeakSet<object>, entry: object): void {
  v7ReflectApply(v7IntrinsicWeakSetDelete, value, [entry]);
}

function v7WeakSetHas(value: WeakSet<object>, entry: object): boolean {
  return v7ReflectApply(v7IntrinsicWeakSetHas, value, [entry]) as boolean;
}

type V7RawAuditContract = "document" | "node" | "topology-reference-entry";
type V7RawAuditLocation =
  | V7RawAuditContract
  | "parameters"
  | "parameter"
  | "materials"
  | "material"
  | "configurations"
  | "configuration"
  | "resources"
  | "resource"
  | "nodes"
  | "outputs"
  | "topology-references"
  | "body-list"
  | "body"
  | "metadata"
  | "generic";

interface V7RawAuditPath {
  readonly parent: V7RawAuditPath | undefined;
  readonly segment: string | number;
}

interface V7RawAuditFrame {
  readonly value: unknown;
  readonly location: V7RawAuditLocation;
  readonly path: V7RawAuditPath | undefined;
  readonly depth: number;
}

interface V7RawAuditIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

const V7_RAW_AUDIT_MAX_VALUES = 1_000_000;
const V7_RAW_AUDIT_MAX_DEPTH = 128;

function v7RawArrayIndex(
  key: string,
  length: number,
): number | undefined {
  if (key.length === 0 || (key.length > 1 && key[0] === "0")) return undefined;
  let index = 0;
  for (let offset = 0; offset < key.length; offset += 1) {
    const code = v7StringCharCodeAt(key, offset);
    if (code < 0x30 || code > 0x39) return undefined;
    index = index * 10 + code - 0x30;
    if (index > 0xffff_fffe) return undefined;
  }
  return index < length ? index : undefined;
}

function v7AuditPath(
  path: V7RawAuditPath | undefined,
  leaf?: string | number,
): readonly (string | number)[] {
  let length = leaf === undefined ? 0 : 1;
  for (let current = path; current !== undefined; current = current.parent) {
    length += 1;
  }
  const output = new V7IntrinsicArray<string | number>(length);
  let index = length - 1;
  if (leaf !== undefined) {
    output[index] = leaf;
    index -= 1;
  }
  for (let current = path; current !== undefined; current = current.parent) {
    output[index] = current.segment;
    index -= 1;
  }
  return output;
}

function v7MetadataIsAllowed(
  location: V7RawAuditLocation,
  key: string,
): boolean {
  return (
    key === "metadata" &&
    (location === "document" ||
      location === "material" ||
      location === "configuration" ||
      location === "resource" ||
      location === "node" ||
      location === "body")
  );
}

function v7ChildAuditLocation(
  location: V7RawAuditLocation,
  key: string,
): V7RawAuditLocation {
  if (location === "metadata") return "metadata";
  if (v7MetadataIsAllowed(location, key)) return "metadata";
  if (location === "document") {
    if (key === "parameters") return "parameters";
    if (key === "materials") return "materials";
    if (key === "configurations") return "configurations";
    if (key === "resources") return "resources";
    if (key === "nodes") return "nodes";
    if (key === "outputs") return "outputs";
    if (key === "topologyReferences") return "topology-references";
  } else if (location === "parameters") {
    return "parameter";
  } else if (location === "materials") {
    return "material";
  } else if (location === "configurations") {
    return "configuration";
  } else if (location === "resources") {
    return "resource";
  } else if (location === "nodes") {
    return "node";
  } else if (location === "topology-references") {
    return "topology-reference-entry";
  } else if (location === "node" && key === "bodies") {
    return "body-list";
  } else if (location === "body-list") {
    return "body";
  }
  return "generic";
}

/**
 * Zod's object copier treats `__proto__` specially. Inspect the raw protocol
 * graph first so a forbidden own key can never be accepted and then omitted.
 * Metadata is the sole semantic JSON escape hatch and is copied separately.
 */
function auditV7RawKeys(
  value: unknown,
  contract: V7RawAuditContract,
): V7RawAuditIssue | undefined {
  try {
    const seenOutsideMetadata = new V7IntrinsicWeakSet<object>();
    const seenInsideMetadata = new V7IntrinsicWeakSet<object>();
    const stack = new V7IntrinsicArray<V7RawAuditFrame>(1);
    stack[0] = {
      value,
      location: contract,
      path: undefined,
      depth: 0,
    };
    let scheduled = 1;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      stack.length -= 1;
      if (frame.depth > V7_RAW_AUDIT_MAX_DEPTH) {
        return {
          message: `Document-v7 raw key audit exceeded nesting depth ${V7_RAW_AUDIT_MAX_DEPTH}`,
          path: v7AuditPath(frame.path),
        };
      }
      if (typeof frame.value !== "object" || frame.value === null) continue;
      const insideMetadata = frame.location === "metadata";
      if (!insideMetadata && v7ObjectHasOwn(frame.value, "__proto__")) {
        return {
          message:
            "Own '__proto__' keys are forbidden outside document-v7 metadata",
          path: v7AuditPath(frame.path, "__proto__"),
        };
      }
      const seen = insideMetadata
        ? seenInsideMetadata
        : seenOutsideMetadata;
      if (v7WeakSetHas(seen, frame.value)) continue;
      v7WeakSetAdd(seen, frame.value);

      if (v7ArrayIsArray(frame.value)) {
        if (
          v7ObjectGetPrototypeOf(frame.value) !== v7IntrinsicArrayPrototype
        ) {
          return {
            message:
              "Document-v7 arrays must use the intrinsic array prototype",
            path: v7AuditPath(frame.path),
          };
        }
        const lengthDescriptor = v7ObjectGetOwnPropertyDescriptor(
          frame.value,
          "length",
        );
        const length =
          lengthDescriptor !== undefined &&
          lengthDescriptor.enumerable === false &&
          v7ObjectHasOwn(lengthDescriptor, "value") &&
          v7NumberIsSafeInteger(lengthDescriptor.value) &&
          lengthDescriptor.value >= 0 &&
          lengthDescriptor.value <= 0xffff_ffff
            ? lengthDescriptor.value
            : undefined;
        if (length === undefined) {
          return {
            message: "Document-v7 array length is malformed",
            path: v7AuditPath(frame.path),
          };
        }
        const keys = v7ReflectOwnKeys(frame.value);
        if (keys.length !== length + 1) {
          return {
            message:
              "Document-v7 arrays cannot contain sparse, hidden, symbolic, or extra properties",
            path: v7AuditPath(frame.path),
          };
        }
        const descriptors = new V7IntrinsicArray<PropertyDescriptor>(length);
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          const key = keys[keyIndex]!;
          if (typeof key !== "string") {
            return {
              message: "Document-v7 arrays cannot contain symbol properties",
              path: v7AuditPath(frame.path),
            };
          }
          if (key === "length") continue;
          const index = v7RawArrayIndex(key, length);
          const descriptor =
            index === undefined
              ? undefined
              : v7ObjectGetOwnPropertyDescriptor(frame.value, key);
          if (
            index === undefined ||
            descriptor === undefined ||
            descriptor.enumerable !== true ||
            !v7ObjectHasOwn(descriptor, "value") ||
            descriptors[index] !== undefined
          ) {
            return {
              message:
                "Document-v7 arrays require dense enumerable data indices and no extra properties",
              path: v7AuditPath(frame.path, key),
            };
          }
          descriptors[index] = descriptor;
        }
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[index];
          if (descriptor === undefined) {
            return {
              message: "Document-v7 arrays cannot be sparse",
              path: v7AuditPath(frame.path, index),
            };
          }
          scheduled += 1;
          if (scheduled > V7_RAW_AUDIT_MAX_VALUES) {
            return {
              message: `Document-v7 raw key audit exceeded ${V7_RAW_AUDIT_MAX_VALUES} structural values`,
              path: v7AuditPath(frame.path, index),
            };
          }
          stack[stack.length] = {
            value: descriptor.value,
            location:
              frame.location === "body-list"
                ? "body"
                : frame.location === "metadata"
                  ? "metadata"
                  : "generic",
            path: { parent: frame.path, segment: index },
            depth: frame.depth + 1,
          };
        }
        continue;
      }

      const prototype = v7ObjectGetPrototypeOf(frame.value);
      if (prototype !== v7IntrinsicObjectPrototype && prototype !== null) {
        return {
          message: "Document-v7 objects must be plain JSON records",
          path: v7AuditPath(frame.path),
        };
      }
      const keys = v7ReflectOwnKeys(frame.value);
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key !== "string") {
          return {
            message: "Document-v7 objects cannot contain symbol properties",
            path: v7AuditPath(frame.path),
          };
        }
        const descriptor = v7ObjectGetOwnPropertyDescriptor(frame.value, key);
        if (
          descriptor === undefined ||
          descriptor.enumerable !== true ||
          !v7ObjectHasOwn(descriptor, "value")
        ) {
          return {
            message:
              "Document-v7 objects require enumerable data properties",
            path: v7AuditPath(frame.path, key),
          };
        }
        scheduled += 1;
        if (scheduled > V7_RAW_AUDIT_MAX_VALUES) {
          return {
            message: `Document-v7 raw key audit exceeded ${V7_RAW_AUDIT_MAX_VALUES} structural values`,
            path: v7AuditPath(frame.path, key),
          };
        }
        stack[stack.length] = {
          value: descriptor.value,
          location: v7ChildAuditLocation(frame.location, key),
          path: { parent: frame.path, segment: key },
          depth: frame.depth + 1,
        };
      }
    }
    return undefined;
  } catch {
    return {
      message: "Document-v7 raw keys could not be inspected safely",
      path: [],
    };
  }
}

const DOCUMENT_V7_SCHEMA_OPTIONS_MESSAGE =
  "Document-v7 direct schema parse options are unsupported";

function createFrozenV7ZodError(message: string): z.ZodError<unknown> {
  const parsed = z
    .custom<never>(() => false, { error: message })
    .safeParse(undefined);
  if (parsed.success) {
    throw new TypeError("Document-v7 Zod failure could not be initialized");
  }
  const error = parsed.error;
  for (const issue of error.issues) {
    Object.freeze(issue.path);
    Object.freeze(issue);
  }
  Object.freeze(error.issues);
  return Object.freeze(error);
}

const V7_RUNTIME_INTEGRITY_ZOD_ERROR = createFrozenV7ZodError(
  DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
);
const V7_SCHEMA_OPTIONS_ZOD_ERROR = createFrozenV7ZodError(
  DOCUMENT_V7_SCHEMA_OPTIONS_MESSAGE,
);
const V7_SCHEMA_EXECUTION_ZOD_ERROR = createFrozenV7ZodError(
  "Document-v7 direct schema execution failed safely",
);
const V7_ZOD_PARSE_CONTEXT = Object.freeze({
  error: (): string => "Invalid document-v7 value",
  jitless: true,
}) satisfies z.core.ParseContext<z.core.$ZodIssue>;
// Zod's documented process-global configuration is part of this boundary.
// Other exported Zod internals are not trusted inputs; safe methods contain
// their unexpected throws without claiming to freeze or own the dependency.
const v7ZodConfigIsIntact =
  captureDocumentV7RuntimeOwnerIntegrityChecker(z.config());

function v7RuntimeDependenciesAreIntact(): boolean {
  return (
    documentV7RuntimeIntrinsicsAreIntact() && v7ZodConfigIsIntact()
  );
}

function assertV7RuntimeIntegrity(): void {
  if (!v7RuntimeDependenciesAreIntact()) {
    throw V7_RUNTIME_INTEGRITY_ZOD_ERROR;
  }
}

/**
 * Zod checks live globals such as Promise before and after a schema's internal
 * transform. Guard direct parse-family calls outside that machinery so a
 * corrupted realm cannot run ahead of the descriptor checker.
 */
function guardV7SchemaParseBoundary<T>(
  schema: z.ZodType<T>,
): z.ZodType<T> {
  const integrityError = V7_RUNTIME_INTEGRITY_ZOD_ERROR as z.ZodError<T>;
  const optionsError = V7_SCHEMA_OPTIONS_ZOD_ERROR as z.ZodError<T>;
  const executionError = V7_SCHEMA_EXECUTION_ZOD_ERROR as z.ZodError<T>;
  const entryError = (
    arguments_: readonly unknown[],
  ): z.ZodError<T> | undefined => {
    if (!v7RuntimeDependenciesAreIntact()) return integrityError;
    return arguments_.length > 1 && arguments_[1] !== undefined
      ? optionsError
      : undefined;
  };
  const trustedArguments = <Arguments extends unknown[]>(
    arguments_: Arguments,
  ): Arguments =>
    [
      arguments_[0],
      V7_ZOD_PARSE_CONTEXT,
    ] as unknown as Arguments;
  const safeFailure = <Result>(error: z.ZodError<T>): Result =>
    ({ success: false, error }) as Result;
  const guardThrowingSync = <Arguments extends unknown[], Result>(
    original: (...arguments_: Arguments) => Result,
  ): ((...arguments_: Arguments) => Result) => {
    return (...arguments_: Arguments): Result => {
      const errorAtEntry = entryError(arguments_);
      if (errorAtEntry !== undefined) throw errorAtEntry;
      try {
        const result = original(...trustedArguments(arguments_));
        assertV7RuntimeIntegrity();
        return result;
      } catch (error) {
        if (!v7RuntimeDependenciesAreIntact()) throw integrityError;
        throw error;
      }
    };
  };
  const guardSafeSync = <Arguments extends unknown[], Result>(
    original: (...arguments_: Arguments) => Result,
  ): ((...arguments_: Arguments) => Result) => {
    return (...arguments_: Arguments): Result => {
      const errorAtEntry = entryError(arguments_);
      if (errorAtEntry !== undefined) return safeFailure(errorAtEntry);
      try {
        const result = original(...trustedArguments(arguments_));
        return v7RuntimeDependenciesAreIntact()
          ? result
          : safeFailure(integrityError);
      } catch {
        if (!v7RuntimeDependenciesAreIntact()) {
          return safeFailure(integrityError);
        }
        return safeFailure(executionError);
      }
    };
  };
  const guardThrowingAsync = <Arguments extends unknown[], Result>(
    original: (...arguments_: Arguments) => Promise<Result>,
  ): ((...arguments_: Arguments) => Promise<Result>) => {
    return async (...arguments_: Arguments): Promise<Result> => {
      const errorAtEntry = entryError(arguments_);
      if (errorAtEntry !== undefined) throw errorAtEntry;
      try {
        const result = await original(...trustedArguments(arguments_));
        assertV7RuntimeIntegrity();
        return result;
      } catch (error) {
        if (!v7RuntimeDependenciesAreIntact()) throw integrityError;
        throw error;
      }
    };
  };
  const guardSafeAsync = <Arguments extends unknown[], Result>(
    original: (...arguments_: Arguments) => Promise<Result>,
  ): ((...arguments_: Arguments) => Promise<Result>) => {
    return async (...arguments_: Arguments): Promise<Result> => {
      const errorAtEntry = entryError(arguments_);
      if (errorAtEntry !== undefined) return safeFailure(errorAtEntry);
      try {
        const result = await original(...trustedArguments(arguments_));
        return v7RuntimeDependenciesAreIntact()
          ? result
          : safeFailure(integrityError);
      } catch {
        if (!v7RuntimeDependenciesAreIntact()) {
          return safeFailure(integrityError);
        }
        return safeFailure(executionError);
      }
    };
  };
  const guardedParse = guardThrowingSync(schema.parse);
  const guardedSafeParse = guardSafeSync(schema.safeParse);
  const guardedParseAsync = guardThrowingAsync(schema.parseAsync);
  const guardedSafeParseAsync = guardSafeAsync(schema.safeParseAsync);
  const guardedEncode = guardThrowingSync(schema.encode);
  const guardedDecode = guardThrowingSync(schema.decode);
  const guardedSafeEncode = guardSafeSync(schema.safeEncode);
  const guardedSafeDecode = guardSafeSync(schema.safeDecode);
  const guardedEncodeAsync = guardThrowingAsync(schema.encodeAsync);
  const guardedDecodeAsync = guardThrowingAsync(schema.decodeAsync);
  const guardedSafeEncodeAsync = guardSafeAsync(schema.safeEncodeAsync);
  const guardedSafeDecodeAsync = guardSafeAsync(schema.safeDecodeAsync);
  Object.defineProperties(schema, {
    decode: {
      configurable: true,
      enumerable: true,
      value: guardedDecode,
      writable: true,
    },
    decodeAsync: {
      configurable: true,
      enumerable: true,
      value: guardedDecodeAsync,
      writable: true,
    },
    encode: {
      configurable: true,
      enumerable: true,
      value: guardedEncode,
      writable: true,
    },
    encodeAsync: {
      configurable: true,
      enumerable: true,
      value: guardedEncodeAsync,
      writable: true,
    },
    parse: {
      configurable: true,
      enumerable: true,
      value: guardedParse,
      writable: true,
    },
    parseAsync: {
      configurable: true,
      enumerable: true,
      value: guardedParseAsync,
      writable: true,
    },
    safeDecode: {
      configurable: true,
      enumerable: true,
      value: guardedSafeDecode,
      writable: true,
    },
    safeDecodeAsync: {
      configurable: true,
      enumerable: true,
      value: guardedSafeDecodeAsync,
      writable: true,
    },
    safeEncode: {
      configurable: true,
      enumerable: true,
      value: guardedSafeEncode,
      writable: true,
    },
    safeEncodeAsync: {
      configurable: true,
      enumerable: true,
      value: guardedSafeEncodeAsync,
      writable: true,
    },
    safeParse: {
      configurable: true,
      enumerable: true,
      value: guardedSafeParse,
      writable: true,
    },
    safeParseAsync: {
      configurable: true,
      enumerable: true,
      value: guardedSafeParseAsync,
      writable: true,
    },
    spa: {
      configurable: true,
      enumerable: true,
      value: guardedSafeParseAsync,
      writable: true,
    },
  });
  const standard = schema["~standard"];
  Object.defineProperty(standard, "validate", {
    configurable: true,
    enumerable: true,
    value: (value: unknown) => {
      const parsed = guardedSafeParse(value);
      return parsed.success
        ? { value: parsed.data }
        : { issues: parsed.error.issues };
    },
    writable: true,
  });
  return schema;
}

function withV7RawKeyAudit<T>(
  schema: z.ZodType<T>,
  contract: V7RawAuditContract,
): z.ZodType<T> {
  return guardV7SchemaParseBoundary(
    z
      .unknown()
      .transform((value, context) => {
        assertV7RuntimeIntegrity();
        const captured = preflightDesignDocumentValue(
          value,
          DEFAULT_DESIGN_DOCUMENT_LIMITS,
          { strictV7Snapshot: true },
        );
        assertV7RuntimeIntegrity();
        if (!captured.ok) {
          for (const item of captured.diagnostics) {
            context.addIssue({
              code: "custom",
              message: item.message,
            });
          }
          return z.NEVER;
        }
        const issue = auditV7RawKeys(captured.value, contract);
        if (issue === undefined) {
          assertV7RuntimeIntegrity();
          return captured.value;
        }
        context.addIssue({
          code: "custom",
          message: issue.message,
          path: [...issue.path],
        });
        return z.NEVER;
      })
      .pipe(schema)
      .transform((value) => {
        assertV7RuntimeIntegrity();
        return value;
      }) as z.ZodType<T>,
  );
}

const DimensionSchema = z.enum(["scalar", "length", "angle", "massDensity"]);
const IdSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_.:-]*$/,
    "IDs must begin with a letter and contain only letters, digits, dots, colons, underscores, or hyphens",
  );

export const ExpressionSchema: z.ZodType<ExpressionIR> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({
      op: z.literal("literal"),
      dimension: DimensionSchema,
      value: z.number().finite(),
    }),
    z.object({
      op: z.literal("parameter"),
      dimension: DimensionSchema,
      id: z.string(),
    }),
    z.object({
      op: z.enum(["neg", "abs", "sin", "cos", "tan"]),
      dimension: DimensionSchema,
      value: ExpressionSchema,
    }),
    z.object({
      op: z.enum(["add", "sub", "mul", "div"]),
      dimension: DimensionSchema,
      left: ExpressionSchema,
      right: ExpressionSchema,
    }),
    z.object({
      op: z.enum(["min", "max"]),
      dimension: DimensionSchema,
      values: z.array(ExpressionSchema).min(1),
    }),
  ]),
) as z.ZodType<ExpressionIR>;

/**
 * Document v7 is a closed protocol. It cannot reuse the permissive legacy
 * expression objects because those intentionally strip unknown properties.
 */
const ExpressionV7Schema: z.ZodType<ExpressionIR> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z
      .object({
        op: z.literal("literal"),
        dimension: DimensionSchema,
        value: z.number().finite(),
      })
      .strict(),
    z
      .object({
        op: z.literal("parameter"),
        dimension: DimensionSchema,
        id: IdSchema,
      })
      .strict(),
    z
      .object({
        op: z.enum(["neg", "abs", "sin", "cos", "tan"]),
        dimension: DimensionSchema,
        value: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        op: z.enum(["add", "sub", "mul", "div"]),
        dimension: DimensionSchema,
        left: ExpressionV7Schema,
        right: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        op: z.enum(["min", "max"]),
        dimension: DimensionSchema,
        values: z.array(ExpressionV7Schema).min(1),
      })
      .strict(),
  ]),
) as z.ZodType<ExpressionIR>;

const Vec2ExpressionSchema = z.tuple([ExpressionSchema, ExpressionSchema]);
const Vec3ExpressionSchema = z.tuple([
  ExpressionSchema,
  ExpressionSchema,
  ExpressionSchema,
]);
const Vec2ExpressionV7Schema = z.tuple([
  ExpressionV7Schema,
  ExpressionV7Schema,
]);
const Vec3ExpressionV7Schema = z.tuple([
  ExpressionV7Schema,
  ExpressionV7Schema,
  ExpressionV7Schema,
]);

const RefSchema = z.object({
  node: z.string(),
  kind: z.enum(["profile", "path", "solid", "part", "assembly"]),
});

const DesignOutputRefSchema = z.object({
  node: z.string(),
  kind: z.enum(["solid", "part", "assembly"]),
});

const DesignOutputRefV7Schema = z
  .object({
    node: IdSchema,
    kind: z.enum([
      "curve",
      "wire",
      "face",
      "shell",
      "solid",
      "bodySet",
      "part",
      "assembly",
    ]),
  })
  .strict();

const PlaneSchema = z.object({
  type: z.literal("principal"),
  plane: z.enum(["XY", "XZ", "YZ"]),
  origin: Vec3ExpressionSchema,
});

const PlaneV7Schema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("principal"),
      plane: z.enum(["XY", "XZ", "YZ"]),
      origin: Vec3ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      type: z.literal("datum"),
      datum: z
        .object({
          node: IdSchema,
          kind: z.literal("datumPlane"),
        })
        .strict(),
    })
    .strict(),
]);

const EntitySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("point"),
    x: ExpressionSchema,
    y: ExpressionSchema,
  }),
  z.object({
    kind: z.literal("line"),
    start: z.string(),
    end: z.string(),
  }),
  z.object({
    kind: z.literal("circle"),
    center: z.string(),
    radius: ExpressionSchema,
    segments: z.number().int().min(3).optional(),
  }),
  z.object({
    kind: z.literal("arc"),
    center: z.string(),
    radius: ExpressionSchema,
    startAngle: ExpressionSchema,
    endAngle: ExpressionSchema,
    clockwise: z.boolean(),
    segments: z.number().int().min(2).optional(),
  }),
]);

const ConstraintSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("coincident"),
    first: z.string(),
    second: z.string(),
  }),
  z.object({
    kind: z.enum(["horizontal", "vertical", "fixed"]),
    entity: z.string(),
  }),
  z.object({
    kind: z.enum(["distance", "distanceX", "distanceY"]),
    first: z.string(),
    second: z.string(),
    value: ExpressionSchema,
  }),
  z.object({
    kind: z.literal("length"),
    entity: z.string(),
    value: ExpressionSchema,
  }),
  z.object({
    kind: z.enum(["parallel", "perpendicular", "equalLength"]),
    first: z.string(),
    second: z.string(),
  }),
  z.object({
    kind: z.literal("angle"),
    first: z.string(),
    second: z.string(),
    value: ExpressionSchema,
  }),
  z.object({
    kind: z.enum(["radius", "diameter"]),
    entity: z.string(),
    value: ExpressionSchema,
  }),
  z.object({
    kind: z.literal("equalRadius"),
    first: z.string(),
    second: z.string(),
  }),
  z.object({
    kind: z.literal("midpoint"),
    point: z.string(),
    line: z.string(),
  }),
  z.object({
    kind: z.literal("tangent"),
    line: z.string(),
    circle: z.string(),
  }),
]);

const EdgeLoopSchema = z.object({
  kind: z.literal("edges"),
  edges: z
    .array(z.object({ entity: z.string(), reversed: z.boolean().optional() }))
    .min(1),
});
const CircleLoopSchema = z.object({
  kind: z.literal("circle"),
  entity: z.string(),
  reversed: z.boolean().optional(),
});
const LoopSchema = z.discriminatedUnion("kind", [
  EdgeLoopSchema,
  CircleLoopSchema,
]);

const TransformOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("translate"), value: Vec3ExpressionSchema }),
  z.object({ kind: z.literal("rotate"), value: Vec3ExpressionSchema }),
  z.object({ kind: z.literal("scale"), value: Vec3ExpressionSchema }),
  z.object({ kind: z.literal("mirror"), normal: Vec3ExpressionSchema }),
]);

const EntityV7Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("point"),
      x: ExpressionV7Schema,
      y: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("line"),
      start: IdSchema,
      end: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("circle"),
      center: IdSchema,
      radius: ExpressionV7Schema,
      segments: z.number().int().min(3).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("arc"),
      center: IdSchema,
      radius: ExpressionV7Schema,
      startAngle: ExpressionV7Schema,
      endAngle: ExpressionV7Schema,
      clockwise: z.boolean(),
      segments: z.number().int().min(2).optional(),
    })
    .strict(),
]);

const ConstraintV7Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("coincident"),
      first: IdSchema,
      second: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["horizontal", "vertical", "fixed"]),
      entity: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["distance", "distanceX", "distanceY"]),
      first: IdSchema,
      second: IdSchema,
      value: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("length"),
      entity: IdSchema,
      value: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["parallel", "perpendicular", "equalLength"]),
      first: IdSchema,
      second: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("angle"),
      first: IdSchema,
      second: IdSchema,
      value: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(["radius", "diameter"]),
      entity: IdSchema,
      value: ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("equalRadius"),
      first: IdSchema,
      second: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("midpoint"),
      point: IdSchema,
      line: IdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tangent"),
      line: IdSchema,
      circle: IdSchema,
    })
    .strict(),
]);

const EdgeLoopV7Schema = z
  .object({
    kind: z.literal("edges"),
    edges: z
      .array(
        z
          .object({
            entity: IdSchema,
            reversed: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const CircleLoopV7Schema = z
  .object({
    kind: z.literal("circle"),
    entity: IdSchema,
    reversed: z.boolean().optional(),
  })
  .strict();
const LoopV7Schema = z.discriminatedUnion("kind", [
  EdgeLoopV7Schema,
  CircleLoopV7Schema,
]);

const TransformOperationV7Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("translate"),
      value: Vec3ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("rotate"),
      value: Vec3ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("scale"),
      value: Vec3ExpressionV7Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("mirror"),
      normal: Vec3ExpressionV7Schema,
    })
    .strict(),
]);

function copyProtocolJsonValue(
  value: unknown,
  active: WeakSet<object>,
): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!v7NumberIsFinite(value)) {
      throw new TypeError("Protocol metadata numbers must be finite");
    }
    return v7ObjectIs(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Protocol metadata must contain only JSON values");
  }
  if (v7WeakSetHas(active, value)) {
    throw new TypeError("Protocol metadata cannot contain object cycles");
  }
  v7WeakSetAdd(active, value);
  try {
    if (v7ArrayIsArray(value)) {
      const output: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!v7ObjectHasOwn(value, index)) {
          throw new TypeError("Protocol metadata arrays cannot be sparse");
        }
        output.push(copyProtocolJsonValue(value[index], active));
      }
      return output;
    }
    const prototype = v7ObjectGetPrototypeOf(value);
    if (prototype !== v7IntrinsicObjectPrototype && prototype !== null) {
      throw new TypeError("Protocol metadata objects must be plain records");
    }
    const output = v7ObjectCreateNull();
    const keys = v7ObjectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      output[key] = copyProtocolJsonValue(
        (value as Readonly<Record<string, unknown>>)[key],
        active,
      );
    }
    return output;
  } finally {
    v7WeakSetDelete(active, value);
  }
}

const ProtocolJsonRecordV7Schema = z.unknown().transform((value, context) => {
  try {
    const output = copyProtocolJsonValue(
      value,
      new V7IntrinsicWeakSet<object>(),
    );
    if (
      output === null ||
      v7ArrayIsArray(output) ||
      typeof output !== "object"
    ) {
      throw new TypeError("Protocol metadata must be a JSON object");
    }
    return output as Readonly<Record<string, JsonValue>>;
  } catch (error) {
    context.addIssue({
      code: "custom",
      message:
        error instanceof Error
          ? error.message
          : "Protocol metadata is malformed",
    });
    return z.NEVER;
  }
});

const TopologyCardinalitySchema = z
  .object({
    min: z.number().int().min(1),
    max: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.max !== undefined && value.max < value.min) {
      context.addIssue({
        code: "custom",
        message: "Topology selection maximum cannot be less than its minimum",
        path: ["max"],
      });
    }
  });

const TopologySourceSchema = z
  .object({
    kind: z.literal("sketch-entity"),
    sketch: z.string(),
    entity: z.string(),
  })
  .strict();
const TopologySourceV7Schema = z
  .object({
    kind: z.literal("sketch-entity"),
    sketch: IdSchema,
    entity: IdSchema,
  })
  .strict();

type DiscriminatedUnionVariants = Parameters<
  typeof z.discriminatedUnion
>[1];

const TOPOLOGY_KINDS_V1 = Object.freeze([
  "face",
  "edge",
] as const satisfies readonly TopologyKindV1[]);
const TOPOLOGY_KINDS_V2 = Object.freeze([
  ...TOPOLOGY_KINDS_V1,
  "vertex",
] as const satisfies readonly TopologyKind[]);

function createTopologySchemas<
  AllowPersistent extends boolean,
  R extends TopologyRole,
  K extends TopologyKind,
>(
  allowPersistent: AllowPersistent,
  roles: readonly R[],
  topologyKinds: readonly K[],
  expressionSchema: z.ZodType<ExpressionIR> = ExpressionSchema,
  vec3ExpressionSchema: z.ZodType = Vec3ExpressionSchema,
  topologySourceSchema: z.ZodType = TopologySourceSchema,
  nodeIdSchema: z.ZodType<string> = z.string(),
): {
  readonly query: z.ZodType<TopologyQueryIRFor<AllowPersistent, R, K>>;
  readonly selection: z.ZodType<
    TopologySelectionIRFor<K, AllowPersistent, R, K>
  >;
} {
  let selectionSchema!: z.ZodType<
    TopologySelectionIRFor<K, AllowPersistent, R, K>
  >;
  const querySchema = z.lazy(() => {
    const persistent = z
      .object({
        op: z.literal("persistentReference"),
        reference: IdSchema,
      })
      .strict();
    const variants = [
      z.object({ op: z.literal("all") }).strict(),
      ...(allowPersistent ? [persistent] : []),
      z
        .object({
          op: z.literal("origin"),
          feature: nodeIdSchema,
          relation: z.enum(["created", "modified"]),
          role: z.enum(roles as [R, ...R[]]).optional(),
          source: topologySourceSchema.optional(),
        })
        .strict(),
      z
        .object({
          op: z.literal("surface"),
          kind: z.string().min(1),
        })
        .strict(),
      z
        .object({
          op: z.literal("curve"),
          kind: z.string().min(1),
        })
        .strict(),
      z
        .object({
          op: z.enum(["normal", "direction"]),
          value: vec3ExpressionSchema,
          tolerance: expressionSchema,
        })
        .strict(),
      z
        .object({
          op: z.literal("radius"),
          value: expressionSchema,
          tolerance: expressionSchema,
        })
        .strict(),
      ...(topologyKinds.includes("vertex" as K)
        ? [
            z
              .object({
                op: z.literal("position"),
                value: vec3ExpressionSchema,
                tolerance: expressionSchema,
              })
              .strict(),
          ]
        : []),
      z
        .object({
          op: z.literal("adjacentTo"),
          selection: z.lazy(() => selectionSchema),
        })
        .strict(),
      z
        .object({
          op: z.enum(["and", "or"]),
          queries: z.array(z.lazy(() => querySchema)).min(1),
        })
        .strict(),
      z
        .object({
          op: z.literal("not"),
          query: z.lazy(() => querySchema),
        })
        .strict(),
    ];
    return z.discriminatedUnion(
      "op",
      variants as unknown as DiscriminatedUnionVariants,
    );
  }) as z.ZodType<TopologyQueryIRFor<AllowPersistent, R, K>>;

  selectionSchema = z.lazy(() =>
    z
      .object({
        topology: z.enum(topologyKinds as [K, ...K[]]),
        query: querySchema,
        cardinality: TopologyCardinalitySchema,
      })
      .strict(),
  ) as z.ZodType<
    TopologySelectionIRFor<K, AllowPersistent, R, K>
  >;
  return { query: querySchema, selection: selectionSchema };
}

const topologySchemasV1 = createTopologySchemas<
  false,
  TopologyRoleV1,
  TopologyKindV1
>(
  false,
  TOPOLOGY_ROLES_V1,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV2 = createTopologySchemas<
  boolean,
  TopologyRoleV2,
  TopologyKindV1
>(
  true,
  TOPOLOGY_ROLES_V2,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV3 = createTopologySchemas<
  boolean,
  TopologyRoleV3,
  TopologyKindV1
>(
  true,
  TOPOLOGY_ROLES_V3,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV4 = createTopologySchemas<
  boolean,
  TopologyRoleV4,
  TopologyKindV1
>(
  true,
  TOPOLOGY_ROLES_V4,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV5 = createTopologySchemas<
  boolean,
  TopologyRoleV5,
  TopologyKindV1
>(
  true,
  TOPOLOGY_ROLES_V5,
  TOPOLOGY_KINDS_V1,
);
const topologySchemasV6 = createTopologySchemas<
  boolean,
  TopologyRoleV6,
  TopologyKind
>(
  true,
  TOPOLOGY_ROLES_V6,
  TOPOLOGY_KINDS_V2,
);
const topologySchemasV7 = createTopologySchemas<
  boolean,
  TopologyRoleV6,
  TopologyKind
>(
  true,
  TOPOLOGY_ROLES_V6,
  TOPOLOGY_KINDS_V2,
  ExpressionV7Schema,
  Vec3ExpressionV7Schema,
  TopologySourceV7Schema,
  IdSchema,
);
const TopologySelectionV7Schema = topologySchemasV7.selection as z.ZodType<
  TopologySelectionIRV6
>;

export const TopologyQueryV1Schema: z.ZodType<TopologyQueryIRV1> =
  topologySchemasV1.query;
export const TopologyQueryV2Schema: z.ZodType<TopologyQueryIRV2> =
  topologySchemasV2.query as z.ZodType<TopologyQueryIRV2>;
export const TopologyQueryV3Schema: z.ZodType<TopologyQueryIRV3> =
  topologySchemasV3.query as z.ZodType<TopologyQueryIRV3>;
export const TopologyQueryV4Schema: z.ZodType<TopologyQueryIRV4> =
  topologySchemasV4.query as z.ZodType<TopologyQueryIRV4>;
export const TopologyQueryV5Schema: z.ZodType<TopologyQueryIRV5> =
  topologySchemasV5.query as z.ZodType<TopologyQueryIRV5>;
export const TopologyQueryV6Schema: z.ZodType<TopologyQueryIRV6> =
  topologySchemasV6.query as z.ZodType<TopologyQueryIRV6>;
export const TopologySelectionV1Schema: z.ZodType<TopologySelectionIRV1> =
  topologySchemasV1.selection;
export const TopologySelectionV2Schema: z.ZodType<TopologySelectionIRV2> =
  topologySchemasV2.selection as z.ZodType<TopologySelectionIRV2>;
export const TopologySelectionV3Schema: z.ZodType<TopologySelectionIRV3> =
  topologySchemasV3.selection as z.ZodType<TopologySelectionIRV3>;
export const TopologySelectionV4Schema: z.ZodType<TopologySelectionIRV4> =
  topologySchemasV4.selection as z.ZodType<TopologySelectionIRV4>;
export const TopologySelectionV5Schema: z.ZodType<TopologySelectionIRV5> =
  topologySchemasV5.selection as z.ZodType<TopologySelectionIRV5>;
export const TopologySelectionV6Schema: z.ZodType<TopologySelectionIRV6> =
  topologySchemasV6.selection as z.ZodType<TopologySelectionIRV6>;

/** Current document-v6 topology query schema. */
export const TopologyQuerySchema: z.ZodType<TopologyQueryIR> =
  TopologyQueryV6Schema;
/** Current document-v6 topology selection schema. */
export const TopologySelectionSchema: z.ZodType<TopologySelectionIR> =
  TopologySelectionV6Schema;

/**
 * The transform is intentionally the topology-signature implementation's
 * defensive copier rather than a second, drifting structural grammar here.
 * The document-version role check happens only after that defensive copy.
 */
function createPersistentTopologyReferenceSchema<
  K extends TopologyKind,
  R extends TopologyRole,
>(
  roles: readonly R[],
  topologyKinds: readonly K[],
  protocolVersions: readonly (1 | 2)[],
): z.ZodType<PersistentTopologyReference<K, R>> {
  const allowedRoles = new Set<TopologyRole>(roles);
  const allowedTopologyKinds = new Set<TopologyKind>(topologyKinds);
  const allowedProtocolVersions = new Set<number>(protocolVersions);
  return z.unknown().transform((value, context) => {
    const normalized = normalizePersistentTopologyReference(value);
    if (!normalized.ok) {
      for (const item of normalized.diagnostics) {
        context.addIssue({
          code: "custom",
          message: item.message,
        });
      }
      return z.NEVER;
    }

    let valid = true;
    if (!allowedTopologyKinds.has(normalized.value.topology)) {
      valid = false;
      context.addIssue({
        code: "custom",
        message: `Topology kind '${normalized.value.topology}' is not supported by this document version`,
        path: ["topology"],
      });
    }
    if (!allowedProtocolVersions.has(normalized.value.protocolVersion)) {
      valid = false;
      context.addIssue({
        code: "custom",
        message: `Topology signature protocol v${normalized.value.protocolVersion} is not supported by this document version`,
        path: ["protocolVersion"],
      });
    }
    const checkLineage = (
      lineage: PersistentTopologyReference["lineage"],
      path: readonly (string | number)[],
    ): void => {
      lineage.forEach((item, index) => {
        if (item.role !== undefined && !allowedRoles.has(item.role)) {
          valid = false;
          context.addIssue({
            code: "custom",
            message: `Topology role '${item.role}' is not supported by this document version`,
            path: [...path, index, "role"],
          });
        }
      });
    };
    checkLineage(normalized.value.lineage, ["lineage"]);
    normalized.value.adjacency.forEach((neighbor, index) => {
      checkLineage(neighbor.lineage, ["adjacency", index, "lineage"]);
    });
    if (!valid) return z.NEVER;
    return normalized.value as PersistentTopologyReference<K, R>;
  }) as z.ZodType<PersistentTopologyReference<K, R>>;
}

export const PersistentTopologyReferenceV2Schema: z.ZodType<PersistentTopologyReferenceV2> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V2,
    TOPOLOGY_KINDS_V1,
    [TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1],
  ) as z.ZodType<PersistentTopologyReferenceV2>;
export const PersistentTopologyReferenceV3Schema: z.ZodType<PersistentTopologyReferenceV3> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V3,
    TOPOLOGY_KINDS_V1,
    [TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1],
  ) as z.ZodType<PersistentTopologyReferenceV3>;
export const PersistentTopologyReferenceV4Schema: z.ZodType<PersistentTopologyReferenceV4> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V4,
    TOPOLOGY_KINDS_V1,
    [TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1],
  ) as z.ZodType<PersistentTopologyReferenceV4>;
export const PersistentTopologyReferenceV5Schema: z.ZodType<PersistentTopologyReferenceV5> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V5,
    TOPOLOGY_KINDS_V1,
    [TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1],
  ) as z.ZodType<PersistentTopologyReferenceV5>;
export const PersistentTopologyReferenceV6Schema: z.ZodType<PersistentTopologyReferenceV6> =
  createPersistentTopologyReferenceSchema(
    TOPOLOGY_ROLES_V6,
    TOPOLOGY_KINDS_V2,
    [
      TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1,
      TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2,
    ],
  ) as z.ZodType<PersistentTopologyReferenceV6>;
/** Current document-v6 persistent topology evidence schema. */
export const PersistentTopologyReferenceSchema: z.ZodType<PersistentTopologyReference> =
  PersistentTopologyReferenceV6Schema;

const SolidRefSchema = z
  .object({
    node: z.string(),
    kind: z.literal("solid"),
  })
  .strict();
const SolidRefV7Schema = z
  .object({
    node: IdSchema,
    kind: z.literal("solid"),
  })
  .strict();

function createTopologyReferenceEntrySchema<
  K extends TopologyKind,
  R extends TopologyRole,
>(
  referenceSchema: z.ZodType<PersistentTopologyReference<K, R>>,
  topologyKinds: readonly K[],
  targetSchema: z.ZodType = SolidRefSchema,
): z.ZodType<TopologyReferenceEntryIR<K, R>> {
  return z
    .object({
      target: targetSchema,
      topology: z.enum(topologyKinds as [K, ...K[]]),
      variants: z.array(referenceSchema).min(1),
    })
    .strict()
    .superRefine((entry, context) => {
      const fingerprints = new Set<string>();
      entry.variants.forEach((variant, index) => {
        if (variant.topology !== entry.topology) {
          context.addIssue({
            code: "custom",
            message: `Topology reference variant selects ${pluralTopologyKind(variant.topology)}, not ${pluralTopologyKind(entry.topology)}`,
            path: ["variants", index, "topology"],
          });
        }
        const fingerprint = `${variant.protocolVersion}\u0000${variant.kernelFingerprint}`;
        if (fingerprints.has(fingerprint)) {
          context.addIssue({
            code: "custom",
            message: `Topology reference variants must have unique protocol-version and kernel-fingerprint pairs; duplicate '${variant.kernelFingerprint}'`,
            path: ["variants", index, "kernelFingerprint"],
          });
        }
        fingerprints.add(fingerprint);
      });
    }) as unknown as z.ZodType<
    TopologyReferenceEntryIR<K, R>
  >;
}

export const TopologyReferenceEntryV2Schema: z.ZodType<TopologyReferenceEntryIRV2> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV2Schema,
    TOPOLOGY_KINDS_V1,
  ) as z.ZodType<TopologyReferenceEntryIRV2>;
export const TopologyReferenceEntryV3Schema: z.ZodType<TopologyReferenceEntryIRV3> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV3Schema,
    TOPOLOGY_KINDS_V1,
  ) as z.ZodType<TopologyReferenceEntryIRV3>;
export const TopologyReferenceEntryV4Schema: z.ZodType<TopologyReferenceEntryIRV4> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV4Schema,
    TOPOLOGY_KINDS_V1,
  ) as z.ZodType<TopologyReferenceEntryIRV4>;
export const TopologyReferenceEntryV5Schema: z.ZodType<TopologyReferenceEntryIRV5> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV5Schema,
    TOPOLOGY_KINDS_V1,
  ) as z.ZodType<TopologyReferenceEntryIRV5>;
export const TopologyReferenceEntryV6Schema: z.ZodType<TopologyReferenceEntryIRV6> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV6Schema,
    TOPOLOGY_KINDS_V2,
  ) as z.ZodType<TopologyReferenceEntryIRV6>;
const TopologyReferenceEntryV7BaseSchema: z.ZodType<TopologyReferenceEntryIRV7> =
  createTopologyReferenceEntrySchema(
    PersistentTopologyReferenceV6Schema,
    TOPOLOGY_KINDS_V2,
    SolidRefV7Schema,
  )
    .superRefine((entry, context) => {
      const validateLineage = (
        lineage: PersistentTopologyReference["lineage"],
        path: readonly (string | number)[],
      ): void => {
        lineage.forEach((item, index) => {
          if (!IdSchema.safeParse(item.feature).success) {
            context.addIssue({
              code: "custom",
              message: "Topology lineage feature must be a valid ID",
              path: [...path, index, "feature"],
            });
          }
          if (item.source !== undefined) {
            if (!IdSchema.safeParse(item.source.sketch).success) {
              context.addIssue({
                code: "custom",
                message: "Topology source sketch must be a valid ID",
                path: [...path, index, "source", "sketch"],
              });
            }
            if (!IdSchema.safeParse(item.source.entity).success) {
              context.addIssue({
                code: "custom",
                message: "Topology source entity must be a valid ID",
                path: [...path, index, "source", "entity"],
              });
            }
          }
        });
      };
      entry.variants.forEach((variant, variantIndex) => {
        validateLineage(variant.lineage, [
          "variants",
          variantIndex,
          "lineage",
        ]);
        variant.adjacency.forEach((neighbor, neighborIndex) => {
          validateLineage(neighbor.lineage, [
            "variants",
            variantIndex,
            "adjacency",
            neighborIndex,
            "lineage",
          ]);
        });
      });
    }) as z.ZodType<TopologyReferenceEntryIRV7>;
export const TopologyReferenceEntryV7Schema: z.ZodType<TopologyReferenceEntryIRV7> =
  withV7RawKeyAudit(
    TopologyReferenceEntryV7BaseSchema,
    "topology-reference-entry",
  );
/** Current document-v6 topology-reference registry entry schema. */
export const TopologyReferenceEntrySchema: z.ZodType<TopologyReferenceEntryIR> =
  TopologyReferenceEntryV6Schema;

type VersionedNodeKind =
  | NodeIRV1["kind"]
  | NodeIRV2["kind"]
  | NodeIRV3["kind"]
  | NodeIRV4["kind"]
  | NodeIRV5["kind"]
  | NodeIRV6["kind"];

function createNodeSchema(
  topologySelectionSchema: z.ZodType,
  nodeKinds: readonly VersionedNodeKind[],
) {
  const schemas = [
    z.object({
      kind: z.literal("box"),
      size: Vec3ExpressionSchema,
      center: z.boolean(),
    }),
    z.object({
      kind: z.literal("cylinder"),
      height: ExpressionSchema,
      radiusBottom: ExpressionSchema,
      radiusTop: ExpressionSchema,
      center: z.boolean(),
      segments: z.number().int().min(3).optional(),
    }),
    z.object({
      kind: z.literal("sphere"),
      radius: ExpressionSchema,
      segments: z.number().int().min(4).optional(),
    }),
    z.object({
      kind: z.literal("sketch"),
      plane: PlaneSchema,
      entities: z.record(z.string(), EntitySchema),
      constraints: z.record(z.string(), ConstraintSchema),
      profile: z.object({ outer: LoopSchema, holes: z.array(LoopSchema) }),
      tolerance: z.number().positive(),
    }),
    z
      .object({
        kind: z.literal("polylinePath"),
        points: z.array(Vec3ExpressionSchema).min(2),
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("circularArcPath"),
        start: Vec3ExpressionSchema,
        through: Vec3ExpressionSchema,
        end: Vec3ExpressionSchema,
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("compositePath"),
        start: Vec3ExpressionSchema,
        segments: z
          .array(
            z.discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("line"),
                  end: Vec3ExpressionSchema,
                })
                .strict(),
              z
                .object({
                  kind: z.literal("circularArc"),
                  through: Vec3ExpressionSchema,
                  end: Vec3ExpressionSchema,
                })
                .strict(),
            ]),
          )
          .min(2),
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z.object({
      kind: z.literal("extrude"),
      profile: RefSchema,
      distance: ExpressionSchema,
      symmetric: z.boolean(),
      twist: ExpressionSchema,
      scaleTop: Vec2ExpressionSchema,
      divisions: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal("revolve"),
      profile: RefSchema,
      angle: ExpressionSchema,
      segments: z.number().int().min(3).optional(),
    }),
    z
      .object({
        kind: z.literal("loft"),
        profiles: z.array(RefSchema).min(2),
        ruled: z.literal(true),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sweep"),
        profile: RefSchema,
        path: RefSchema,
        transition: z.literal("right-corner"),
        frame: z.literal("corrected-frenet"),
      })
      .strict(),
    z.object({
      kind: z.literal("boolean"),
      operation: z.enum(["union", "subtract", "intersect"]),
      target: RefSchema,
      tools: z.array(RefSchema).min(1),
    }),
    z.object({
      kind: z.literal("transform"),
      input: RefSchema,
      operations: z.array(TransformOperationSchema).min(1),
    }),
    z
      .object({
        kind: z.literal("fillet"),
        input: RefSchema,
        edges: topologySelectionSchema,
        radius: ExpressionSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("chamfer"),
        input: RefSchema,
        edges: topologySelectionSchema,
        distance: ExpressionSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("shell"),
        input: RefSchema,
        openings: topologySelectionSchema,
        thickness: ExpressionSchema,
        direction: z.enum(SHELL_DIRECTIONS),
        tolerance: ExpressionSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("offset"),
        input: RefSchema,
        distance: ExpressionSchema,
        direction: z.enum(OFFSET_DIRECTIONS),
        tolerance: ExpressionSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("draft"),
        input: RefSchema,
        faces: topologySelectionSchema,
        angle: ExpressionSchema,
        pullDirection: Vec3ExpressionSchema,
        neutralPlane: z
          .object({
            origin: Vec3ExpressionSchema,
            normal: Vec3ExpressionSchema,
          })
          .strict(),
      })
      .strict(),
    z.object({
      kind: z.literal("part"),
      solid: RefSchema,
      partNumber: z.string().optional(),
      description: z.string().optional(),
      material: z.string().optional(),
      materialId: IdSchema.optional(),
      massDensity: ExpressionSchema.optional(),
      metadata: z.record(z.string(), z.json()).optional(),
    }),
    z.object({
      kind: z.literal("assembly"),
      instances: z.array(
        z.object({
          id: z.string(),
          component: RefSchema,
          placement: z.array(TransformOperationSchema),
          suppressed: z.boolean(),
        }),
      ),
    }),
  ] as const;

  const allowedKinds = new Set<VersionedNodeKind>(nodeKinds);
  const options = schemas.filter((schema) =>
    allowedKinds.has(schema.shape.kind.value as VersionedNodeKind),
  );
  if (
    nodeKinds.length !== allowedKinds.size ||
    options.length !== nodeKinds.length
  ) {
    throw new Error("Document node-kind grammar has no matching node schema");
  }

  return z.discriminatedUnion(
    "kind",
    options as unknown as typeof schemas,
  );
}

export const NodeV1Schema = createNodeSchema(
  TopologySelectionV1Schema,
  NODE_KINDS_V1,
) as unknown as z.ZodType<NodeIRV1>;
export const NodeV2Schema = createNodeSchema(
  TopologySelectionV2Schema,
  NODE_KINDS_V2,
) as unknown as z.ZodType<NodeIRV2>;
export const NodeV3Schema = createNodeSchema(
  TopologySelectionV3Schema,
  NODE_KINDS_V3,
) as unknown as z.ZodType<NodeIRV3>;
export const NodeV4Schema = createNodeSchema(
  TopologySelectionV4Schema,
  NODE_KINDS_V4,
) as unknown as z.ZodType<NodeIRV4>;
export const NodeV5Schema = createNodeSchema(
  TopologySelectionV5Schema,
  NODE_KINDS_V5,
) as unknown as z.ZodType<NodeIRV5>;
export const NodeV6Schema = createNodeSchema(
  TopologySelectionV6Schema,
  NODE_KINDS_V6,
) as unknown as z.ZodType<NodeIRV6>;

/**
 * Isolated staged-v7 grammar.
 *
 * Do not widen RefSchema, PlaneSchema, or createNodeSchema for v7: every frozen
 * v1-v6 node grammar shares those values. Keeping the new grammar physically
 * separate prevents future kinds and reference values from leaking backwards.
 */
function createNodeV7Schema(): z.ZodType<NodeIRV7> {
  const solidRef = z
    .object({ node: IdSchema, kind: z.literal("solid") })
    .strict();
  const profileRef = z
    .object({ node: IdSchema, kind: z.literal("profile") })
    .strict();
  const pathRef = z
    .object({ node: IdSchema, kind: z.literal("path") })
    .strict();
  const partOrAssemblyRef = z
    .object({
      node: IdSchema,
      kind: z.enum(["part", "assembly"]),
    })
    .strict();
  const solidOrBodySetRef = z
    .object({
      node: IdSchema,
      kind: z.enum(["solid", "bodySet"]),
    })
    .strict();

  const bodySetSchema = z
    .object({
      kind: z.literal("bodySet"),
      bodies: z
        .array(
          z
            .object({
              id: IdSchema,
              solid: solidRef,
              name: z.string().min(1).optional(),
              metadata: ProtocolJsonRecordV7Schema.optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict()
    .superRefine((node, context) => {
      const seen = new Set<string>();
      node.bodies.forEach((body, index) => {
        if (seen.has(body.id)) {
          context.addIssue({
            code: "custom",
            path: ["bodies", index, "id"],
            message: `Body-set member ID '${body.id}' is duplicated`,
          });
        }
        seen.add(body.id);
      });
    });

  const importedBodySchema = z
    .object({
      kind: z.literal("importedBody"),
      resource: IdSchema,
      format: z.enum(["step", "brep", "brep-binary"]),
      units: z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("from-file") }).strict(),
        z
          .object({
            mode: z.literal("declared"),
            length: z.enum(["mm", "cm", "m", "in"]),
          })
          .strict(),
      ]),
      healing: z.object({ mode: z.literal("none") }).strict(),
      expected: z.literal("single-solid"),
    })
    .strict()
    .superRefine((node, context) => {
      if (node.format === "step" && node.units.mode !== "from-file") {
        context.addIssue({
          code: "custom",
          path: ["units"],
          message: "STEP imports must read length units from the source file",
        });
      } else if (
        node.format !== "step" &&
        node.units.mode !== "declared"
      ) {
        context.addIssue({
          code: "custom",
          path: ["units"],
          message: "BREP imports require explicitly declared length units",
        });
      }
    });

  const partSchema = z
    .object({
      kind: z.literal("part"),
      geometry: solidOrBodySetRef,
      partNumber: z.string().optional(),
      description: z.string().optional(),
      material: z.string().optional(),
      materialId: IdSchema.optional(),
      massDensity: ExpressionV7Schema.optional(),
      metadata: ProtocolJsonRecordV7Schema.optional(),
    })
    .strict();

  const occurrenceConfigurationSchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("inherit") }).strict(),
    z.object({ mode: z.literal("base") }).strict(),
    z
      .object({
        mode: z.literal("named"),
        id: IdSchema,
      })
      .strict(),
  ]);
  const assemblyComponentSchema = z.discriminatedUnion("source", [
    z
      .object({
        source: z.literal("local"),
        reference: partOrAssemblyRef,
      })
      .strict(),
    z
      .object({
        source: z.literal("external"),
        resource: IdSchema,
        output: IdSchema,
        outputKind: z.enum(["part", "assembly"]),
      })
      .strict(),
  ]);
  const assemblySchema = z
    .object({
      kind: z.literal("assembly"),
      instances: z.array(
        z
          .object({
            id: IdSchema,
            component: assemblyComponentSchema,
            configuration: occurrenceConfigurationSchema,
            placement: z.array(TransformOperationV7Schema),
            suppressed: z.boolean(),
          })
          .strict(),
      ),
    })
    .strict()
    .superRefine((node, context) => {
      const seen = new Set<string>();
      node.instances.forEach((instance, index) => {
        if (seen.has(instance.id)) {
          context.addIssue({
            code: "custom",
            path: ["instances", index, "id"],
            message: `Assembly occurrence ID '${instance.id}' is duplicated`,
          });
        }
        seen.add(instance.id);
      });
    });

  const schemas = [
    z
      .object({
        kind: z.literal("box"),
        size: Vec3ExpressionV7Schema,
        center: z.boolean(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("cylinder"),
        height: ExpressionV7Schema,
        radiusBottom: ExpressionV7Schema,
        radiusTop: ExpressionV7Schema,
        center: z.boolean(),
        segments: z.number().int().min(3).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sphere"),
        radius: ExpressionV7Schema,
        segments: z.number().int().min(4).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sketch"),
        plane: PlaneV7Schema,
        entities: z.record(IdSchema, EntityV7Schema),
        constraints: z.record(IdSchema, ConstraintV7Schema),
        profile: z
          .object({
            outer: LoopV7Schema,
            holes: z.array(LoopV7Schema),
          })
          .strict(),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("polylinePath"),
        points: z.array(Vec3ExpressionV7Schema).min(2),
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("circularArcPath"),
        start: Vec3ExpressionV7Schema,
        through: Vec3ExpressionV7Schema,
        end: Vec3ExpressionV7Schema,
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("compositePath"),
        start: Vec3ExpressionV7Schema,
        segments: z
          .array(
            z.discriminatedUnion("kind", [
              z
                .object({
                  kind: z.literal("line"),
                  end: Vec3ExpressionV7Schema,
                })
                .strict(),
              z
                .object({
                  kind: z.literal("circularArc"),
                  through: Vec3ExpressionV7Schema,
                  end: Vec3ExpressionV7Schema,
                })
                .strict(),
            ]),
          )
          .min(2),
        closed: z.literal(false),
        tolerance: z.number().positive(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("extrude"),
        profile: profileRef,
        distance: ExpressionV7Schema,
        symmetric: z.boolean(),
        twist: ExpressionV7Schema,
        scaleTop: Vec2ExpressionV7Schema,
        divisions: z.number().int().nonnegative(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("revolve"),
        profile: profileRef,
        angle: ExpressionV7Schema,
        segments: z.number().int().min(3).optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("loft"),
        profiles: z.array(profileRef).min(2),
        ruled: z.literal(true),
      })
      .strict(),
    z
      .object({
        kind: z.literal("sweep"),
        profile: profileRef,
        path: pathRef,
        transition: z.literal("right-corner"),
        frame: z.literal("corrected-frenet"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("boolean"),
        operation: z.enum(["union", "subtract", "intersect"]),
        target: solidRef,
        tools: z.array(solidRef).min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("transform"),
        input: solidRef,
        operations: z.array(TransformOperationV7Schema).min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("fillet"),
        input: solidRef,
        edges: TopologySelectionV7Schema,
        radius: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("chamfer"),
        input: solidRef,
        edges: TopologySelectionV7Schema,
        distance: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("shell"),
        input: solidRef,
        openings: TopologySelectionV7Schema,
        thickness: ExpressionV7Schema,
        direction: z.enum(SHELL_DIRECTIONS),
        tolerance: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("offset"),
        input: solidRef,
        distance: ExpressionV7Schema,
        direction: z.enum(OFFSET_DIRECTIONS),
        tolerance: ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("draft"),
        input: solidRef,
        faces: TopologySelectionV7Schema,
        angle: ExpressionV7Schema,
        pullDirection: Vec3ExpressionV7Schema,
        neutralPlane: z
          .object({
            origin: Vec3ExpressionV7Schema,
            normal: Vec3ExpressionV7Schema,
          })
          .strict(),
      })
      .strict(),
    partSchema,
    assemblySchema,
    z
      .object({
        kind: z.literal("datumPoint"),
        position: Vec3ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("datumAxis"),
        origin: Vec3ExpressionV7Schema,
        direction: Vec3ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("datumPlane"),
        origin: Vec3ExpressionV7Schema,
        xDirection: Vec3ExpressionV7Schema,
        normal: Vec3ExpressionV7Schema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("coordinateSystem"),
        origin: Vec3ExpressionV7Schema,
        xDirection: Vec3ExpressionV7Schema,
        yDirection: Vec3ExpressionV7Schema,
      })
      .strict(),
    bodySetSchema,
    importedBodySchema,
  ] as const;

  const kinds = schemas.map((schema) => schema.shape.kind.value);
  if (
    kinds.length !== NODE_KINDS_V7.length ||
    new Set(kinds).size !== kinds.length ||
    NODE_KINDS_V7.some((kind) => !kinds.includes(kind))
  ) {
    throw new Error("Document-v7 node-kind grammar has no matching node schema");
  }
  return z.discriminatedUnion(
    "kind",
    schemas as unknown as Parameters<typeof z.discriminatedUnion>[1],
  ) as unknown as z.ZodType<NodeIRV7>;
}

const NodeV7BaseSchema: z.ZodType<NodeIRV7> = createNodeV7Schema();
export const NodeV7Schema: z.ZodType<NodeIRV7> = withV7RawKeyAudit(
  NodeV7BaseSchema,
  "node",
);
/** Current document-v6 node schema. */
export const NodeSchema: z.ZodType<NodeIR> = NodeV6Schema;

const ConfigurationSchema = z
  .object({
    description: z.string().optional(),
    parameterOverrides: z
      .record(IdSchema, ExpressionSchema)
      .refine(
        (parameters) => Object.keys(parameters).length > 0,
        "Configuration parameter overrides cannot be empty; omit them instead",
      )
      .optional(),
    instanceSuppressions: z
      .record(
        IdSchema,
        z
          .record(
            IdSchema,
            z.boolean(),
          )
          .refine(
            (instances) => Object.keys(instances).length > 0,
            "Configuration assembly instance overrides cannot be empty",
          ),
      )
      .refine(
        (assemblies) => Object.keys(assemblies).length > 0,
        "Configuration assembly overrides cannot be empty; omit them instead",
      )
      .optional(),
    partMaterialOverrides: z
      .record(IdSchema, IdSchema)
      .refine(
        (parts) => Object.keys(parts).length > 0,
        "Configuration part material overrides cannot be empty; omit them instead",
      )
      .optional(),
    metadata: z.record(z.string(), z.json()).optional(),
  })
  .strict()
  .refine(
    (configuration) =>
      configuration.parameterOverrides !== undefined ||
      configuration.instanceSuppressions !== undefined ||
      configuration.partMaterialOverrides !== undefined,
    "A configuration requires at least one override",
  );

const ConfigurationV7Schema = z
  .object({
    description: z.string().optional(),
    parameterOverrides: z
      .record(IdSchema, ExpressionV7Schema)
      .refine(
        (parameters) => Object.keys(parameters).length > 0,
        "Configuration parameter overrides cannot be empty; omit them instead",
      )
      .optional(),
    instanceSuppressions: z
      .record(
        IdSchema,
        z
          .record(IdSchema, z.boolean())
          .refine(
            (instances) => Object.keys(instances).length > 0,
            "Configuration assembly instance overrides cannot be empty",
          ),
      )
      .refine(
        (assemblies) => Object.keys(assemblies).length > 0,
        "Configuration assembly overrides cannot be empty; omit them instead",
      )
      .optional(),
    partMaterialOverrides: z
      .record(IdSchema, IdSchema)
      .refine(
        (parts) => Object.keys(parts).length > 0,
        "Configuration part material overrides cannot be empty; omit them instead",
      )
      .optional(),
    metadata: ProtocolJsonRecordV7Schema.optional(),
  })
  .strict()
  .refine(
    (configuration) =>
      configuration.parameterOverrides !== undefined ||
      configuration.instanceSuppressions !== undefined ||
      configuration.partMaterialOverrides !== undefined,
    "A configuration requires at least one override",
  );

const DocumentNameSchema = z.string().min(1);
const DocumentUnitsSchema = z.object({
  length: z.literal("mm"),
  angle: z.literal("rad"),
  mass: z.literal("kg").optional(),
});
const DocumentParametersSchema = z.record(
  z.string(),
  z.object({
    dimension: DimensionSchema,
    default: ExpressionSchema,
    min: ExpressionSchema.optional(),
    max: ExpressionSchema.optional(),
    label: z.string().optional(),
    description: z.string().optional(),
  }),
);
const DocumentMaterialsSchema = z
  .record(
    IdSchema,
    z.object({
      name: z
        .string()
        .min(1)
        .refine(
          (value) => value.trim().length > 0,
          "Material name cannot be blank",
        ),
      description: z.string().optional(),
      massDensity: ExpressionSchema,
      metadata: z.record(z.string(), z.json()).optional(),
    }),
  )
  .refine(
    (materials) => Object.keys(materials).length > 0,
    "Material registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentConfigurationsSchema = z
  .record(IdSchema, ConfigurationSchema)
  .refine(
    (configurations) => Object.keys(configurations).length > 0,
    "Configuration registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentUnitsV7Schema = z
  .object({
    length: z.literal("mm"),
    angle: z.literal("rad"),
    mass: z.literal("kg").optional(),
  })
  .strict();
const DocumentParametersV7Schema = z.record(
  IdSchema,
  z
    .object({
      dimension: DimensionSchema,
      default: ExpressionV7Schema,
      min: ExpressionV7Schema.optional(),
      max: ExpressionV7Schema.optional(),
      label: z.string().optional(),
      description: z.string().optional(),
    })
    .strict(),
);
const DocumentMaterialsV7Schema = z
  .record(
    IdSchema,
    z
      .object({
        name: z
          .string()
          .min(1)
          .refine(
            (value) => value.trim().length > 0,
            "Material name cannot be blank",
          ),
        description: z.string().optional(),
        massDensity: ExpressionV7Schema,
        metadata: ProtocolJsonRecordV7Schema.optional(),
      })
      .strict(),
  )
  .refine(
    (materials) => Object.keys(materials).length > 0,
    "Material registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentConfigurationsV7Schema = z
  .record(IdSchema, ConfigurationV7Schema)
  .refine(
    (configurations) => Object.keys(configurations).length > 0,
    "Configuration registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentOutputsSchema = z.record(z.string(), DesignOutputRefSchema);
const DocumentOutputsV7Schema = z.record(IdSchema, DesignOutputRefV7Schema);
const DocumentMetadataSchema = z.record(z.string(), z.json()).optional();
const DocumentMetadataV7Schema = ProtocolJsonRecordV7Schema.optional();
const DocumentResourcesV7Schema = z
  .record(
    IdSchema,
    z
      .object({
        digest: z
          .string()
          .regex(/^sha256:[0-9a-f]{64}$/, "Resource digest must be lowercase SHA-256"),
        byteLength: z.number().int().nonnegative().safe(),
        mediaType: z
          .string()
          .min(1)
          .refine(
            (value) =>
              value.trim() === value &&
              /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;.*)?$/.test(
                value,
              ),
            "Resource mediaType must be a non-empty MIME type",
          ),
        locations: z
          .array(z.string().min(1))
          .min(1)
          .refine(
            (locations) => new Set(locations).size === locations.length,
            "Resource locations cannot contain duplicates",
          )
          .optional(),
        metadata: ProtocolJsonRecordV7Schema.optional(),
      })
      .strict(),
  )
  .refine(
    (resources) => Object.keys(resources).length > 0,
    "Resource registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV2Schema = z
  .record(IdSchema, TopologyReferenceEntryV2Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV3Schema = z
  .record(IdSchema, TopologyReferenceEntryV3Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV4Schema = z
  .record(IdSchema, TopologyReferenceEntryV4Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV5Schema = z
  .record(IdSchema, TopologyReferenceEntryV5Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV6Schema = z
  .record(IdSchema, TopologyReferenceEntryV6Schema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();
const DocumentTopologyReferencesV7Schema = z
  .record(IdSchema, TopologyReferenceEntryV7BaseSchema)
  .refine(
    (references) => Object.keys(references).length > 0,
    "Topology reference registry cannot be empty; omit it instead",
  )
  .optional();

const DesignDocumentBodyShapeV1 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV1Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
} as const;

const DesignDocumentBodyShapeV2 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV2Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV2Schema,
} as const;

const DesignDocumentBodyShapeV3 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV3Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV3Schema,
} as const;

const DesignDocumentBodyShapeV4 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV4Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV4Schema,
} as const;

const DesignDocumentBodyShapeV5 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV5Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV5Schema,
} as const;

const DesignDocumentBodyShapeV6 = {
  name: DocumentNameSchema,
  units: DocumentUnitsSchema,
  parameters: DocumentParametersSchema,
  materials: DocumentMaterialsSchema,
  configurations: DocumentConfigurationsSchema,
  nodes: z.record(z.string(), NodeV6Schema),
  outputs: DocumentOutputsSchema,
  metadata: DocumentMetadataSchema,
  topologyReferences: DocumentTopologyReferencesV6Schema,
} as const;

const DesignDocumentBodyShapeV7 = {
  name: DocumentNameSchema,
  units: DocumentUnitsV7Schema,
  parameters: DocumentParametersV7Schema,
  materials: DocumentMaterialsV7Schema,
  configurations: DocumentConfigurationsV7Schema,
  resources: DocumentResourcesV7Schema,
  nodes: z.record(IdSchema, NodeV7BaseSchema),
  outputs: DocumentOutputsV7Schema,
  metadata: DocumentMetadataV7Schema,
  topologyReferences: DocumentTopologyReferencesV7Schema,
} as const;

export const DesignDocumentV1Schema: z.ZodType<DesignDocumentV1> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V1),
    version: z.literal(DOCUMENT_VERSION_V1),
    ...DesignDocumentBodyShapeV1,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV1>;

export const DesignDocumentV2Schema: z.ZodType<DesignDocumentV2> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V2),
    version: z.literal(DOCUMENT_VERSION_V2),
    ...DesignDocumentBodyShapeV2,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV2>;

export const DesignDocumentV3Schema: z.ZodType<DesignDocumentV3> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V3),
    version: z.literal(DOCUMENT_VERSION_V3),
    ...DesignDocumentBodyShapeV3,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV3>;

export const DesignDocumentV4Schema: z.ZodType<DesignDocumentV4> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V4),
    version: z.literal(DOCUMENT_VERSION_V4),
    ...DesignDocumentBodyShapeV4,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV4>;

export const DesignDocumentV5Schema: z.ZodType<DesignDocumentV5> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V5),
    version: z.literal(DOCUMENT_VERSION_V5),
    ...DesignDocumentBodyShapeV5,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV5>;

export const DesignDocumentV6Schema: z.ZodType<DesignDocumentV6> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V6),
    version: z.literal(DOCUMENT_VERSION_V6),
    ...DesignDocumentBodyShapeV6,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV6>;

/**
 * Staged v7 schema. It is intentionally not part of DesignDocumentSchema until
 * every ordinary public document consumer supports v7.
 */
const DesignDocumentV7BaseSchema: z.ZodType<DesignDocumentV7> = z
  .object({
    schema: z.literal(DOCUMENT_SCHEMA_V7),
    version: z.literal(DOCUMENT_VERSION_V7),
    ...DesignDocumentBodyShapeV7,
  })
  .strict() as unknown as z.ZodType<DesignDocumentV7>;
export const DesignDocumentV7Schema: z.ZodType<DesignDocumentV7> =
  withV7RawKeyAudit(DesignDocumentV7BaseSchema, "document");

export const DesignDocumentSchema: z.ZodType<DesignDocument> = z.union([
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
  DesignDocumentV6Schema,
]) as z.ZodType<DesignDocument>;
