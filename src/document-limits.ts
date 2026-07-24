import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
} from "./core/result.js";

const IntrinsicArray = Array;
const IntrinsicNumber = Number;
const IntrinsicObject = Object;
const IntrinsicReflect = Reflect;
const IntrinsicWeakMap = WeakMap;
const IntrinsicWeakSet = WeakSet;
const intrinsicArrayIsArray = IntrinsicArray.isArray;
const intrinsicArrayPrototype = IntrinsicArray.prototype;
const intrinsicNumberIsFinite = IntrinsicNumber.isFinite;
const intrinsicNumberIsSafeInteger = IntrinsicNumber.isSafeInteger;
const intrinsicObjectCreate = IntrinsicObject.create;
const intrinsicObjectFreeze = IntrinsicObject.freeze;
const intrinsicObjectGetOwnPropertyDescriptor =
  IntrinsicObject.getOwnPropertyDescriptor;
const intrinsicObjectGetPrototypeOf = IntrinsicObject.getPrototypeOf;
const intrinsicObjectHasOwn = IntrinsicObject.hasOwn;
const intrinsicObjectKeys = IntrinsicObject.keys;
const intrinsicObjectPrototype = IntrinsicObject.prototype;
const intrinsicObjectValues = IntrinsicObject.values;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const intrinsicReflectOwnKeys = IntrinsicReflect.ownKeys;
const intrinsicWeakMapGet = IntrinsicWeakMap.prototype.get;
const intrinsicWeakMapSet = IntrinsicWeakMap.prototype.set;
const intrinsicWeakSetAdd = IntrinsicWeakSet.prototype.add;
const intrinsicWeakSetHas = IntrinsicWeakSet.prototype.has;
const reflectApply = Reflect.apply;

function arrayIsArray(value: unknown): value is readonly unknown[] {
  return reflectApply(intrinsicArrayIsArray, IntrinsicArray, [value]) as boolean;
}

function numberIsSafeInteger(value: unknown): value is number {
  return reflectApply(intrinsicNumberIsSafeInteger, IntrinsicNumber, [
    value,
  ]) as boolean;
}

function numberIsFinite(value: unknown): value is number {
  return reflectApply(intrinsicNumberIsFinite, IntrinsicNumber, [
    value,
  ]) as boolean;
}

function objectCreateNull(): Record<string, unknown> {
  return reflectApply(intrinsicObjectCreate, IntrinsicObject, [
    null,
  ]) as Record<string, unknown>;
}

function objectFreeze<T>(value: T): Readonly<T> {
  return reflectApply(intrinsicObjectFreeze, IntrinsicObject, [
    value,
  ]) as Readonly<T>;
}

function objectGetPrototypeOf(value: object): object | null {
  return reflectApply(
    intrinsicObjectGetPrototypeOf,
    IntrinsicObject,
    [value],
  ) as object | null;
}

function objectGetOwnPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  return reflectApply(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [value, key],
  ) as PropertyDescriptor | undefined;
}

function objectHasOwn(value: object, key: PropertyKey): boolean {
  return reflectApply(intrinsicObjectHasOwn, IntrinsicObject, [
    value,
    key,
  ]) as boolean;
}

function objectKeys(value: object): string[] {
  return reflectApply(intrinsicObjectKeys, IntrinsicObject, [
    value,
  ]) as string[];
}

function objectValues(value: object): unknown[] {
  return reflectApply(intrinsicObjectValues, IntrinsicObject, [
    value,
  ]) as unknown[];
}

function reflectOwnKeys(value: object): (string | symbol)[] {
  return reflectApply(intrinsicReflectOwnKeys, IntrinsicReflect, [
    value,
  ]) as (string | symbol)[];
}

function stringCharCodeAt(value: string, index: number): number {
  return reflectApply(intrinsicStringCharCodeAt, value, [index]) as number;
}

function weakMapGet<K extends object, V>(
  value: WeakMap<K, V>,
  key: K,
): V | undefined {
  return reflectApply(intrinsicWeakMapGet, value, [key]) as V | undefined;
}

function weakMapSet<K extends object, V>(
  value: WeakMap<K, V>,
  key: K,
  entry: V,
): void {
  reflectApply(intrinsicWeakMapSet, value, [key, entry]);
}

function weakSetAdd<K extends object>(value: WeakSet<K>, key: K): void {
  reflectApply(intrinsicWeakSetAdd, value, [key]);
}

function weakSetHas<K extends object>(value: WeakSet<K>, key: K): boolean {
  return reflectApply(intrinsicWeakSetHas, value, [key]) as boolean;
}

export interface DesignDocumentLimits {
  readonly maxDocumentBytes: number;
  readonly maxStructuralValues: number;
  readonly maxNestingDepth: number;
  readonly maxTopologyReferences: number;
  readonly maxTopologyReferenceVariants: number;
  readonly maxStoredAdjacencyLinks: number;
  readonly maxStoredEvidenceRecords: number;
  readonly maxTopologyQueryNodes: number;
  readonly maxResourceDefinitions: number;
  readonly maxResourceLocations: number;
  readonly maxResourceLocationBytes: number;
}

export const DEFAULT_DESIGN_DOCUMENT_LIMITS: DesignDocumentLimits =
  objectFreeze({
    maxDocumentBytes: 64 * 1024 * 1024,
    maxStructuralValues: 1_000_000,
    maxNestingDepth: 128,
    maxTopologyReferences: 10_000,
    maxTopologyReferenceVariants: 20_000,
    maxStoredAdjacencyLinks: 1_000_000,
    maxStoredEvidenceRecords: 1_000_000,
    maxTopologyQueryNodes: 100_000,
    maxResourceDefinitions: 10_000,
    maxResourceLocations: 100_000,
    maxResourceLocationBytes: 16 * 1024 * 1024,
  });

const LIMIT_KEYS = objectFreeze(
  objectKeys(DEFAULT_DESIGN_DOCUMENT_LIMITS) as readonly (
    keyof DesignDocumentLimits
  )[],
);

function isLimitKey(value: string): value is keyof DesignDocumentLimits {
  for (let index = 0; index < LIMIT_KEYS.length; index += 1) {
    if (LIMIT_KEYS[index] === value) return true;
  }
  return false;
}

export function normalizeDesignDocumentLimits(
  value: unknown,
): DesignDocumentLimits | undefined {
  if (value === undefined) return DEFAULT_DESIGN_DOCUMENT_LIMITS;
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    return undefined;
  }
  const raw = value as Readonly<Record<string, unknown>>;
  const keys = objectKeys(raw);
  for (let index = 0; index < keys.length; index += 1) {
    if (!isLimitKey(keys[index]!)) return undefined;
  }
  const normalized: Record<keyof DesignDocumentLimits, number> = {
    ...DEFAULT_DESIGN_DOCUMENT_LIMITS,
  };
  for (let index = 0; index < LIMIT_KEYS.length; index += 1) {
    const key = LIMIT_KEYS[index]!;
    if (!objectHasOwn(raw, key)) continue;
    const candidate = raw[key];
    if (
      typeof candidate !== "number" ||
      !numberIsSafeInteger(candidate) ||
      candidate < 0
    ) {
      return undefined;
    }
    normalized[key] = candidate;
  }
  return objectFreeze(normalized);
}

function limitFailure<T = never>(
  resource: keyof DesignDocumentLimits,
  limit: number,
  actual: number,
): CadResult<T> {
  return failure(
    diagnostic(
      "IR_INVALID",
      `Design-document ${resource} limit ${limit} was exceeded by ${actual}`,
      {
        severity: "error",
        details: { resource, limit, actual },
      },
    ),
  );
}

const documentPreflightFailures = new IntrinsicWeakSet<object>();

class DocumentPreflightFailure {
  constructor(readonly result: CadResult<never>) {
    weakSetAdd(documentPreflightFailures, this);
  }
}

function stopWith(result: CadResult<never>): never {
  throw new DocumentPreflightFailure(result);
}

function stopAtLimit(
  resource: keyof DesignDocumentLimits,
  limit: number,
  actual: number,
): never {
  stopWith(limitFailure(resource, limit, actual));
}

function arrayLength(value: unknown): number | undefined {
  if (!arrayIsArray(value)) return undefined;
  const length = value.length;
  return numberIsSafeInteger(length) && length >= 0 && length <= 0xffff_ffff
    ? length
    : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !arrayIsArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function assertSchedulingCapacity(
  resource: "maxStructuralValues" | "maxTopologyQueryNodes",
  limit: number,
  visited: number,
  scheduled: number,
  additions: number,
): void {
  if (additions > limit - visited - scheduled) {
    stopAtLimit(resource, limit, limit + 1);
  }
}

interface CapturedObject {
  readonly output: Record<string, unknown> | unknown[];
  state: "active" | "complete";
}

function malformedStrictV7Snapshot(message: string): never {
  stopWith(
    failure(
      diagnostic("IR_INVALID", message, {
        severity: "error",
      }),
    ),
  );
}

function strictV7ArrayIndex(
  key: string,
  length: number,
): number | undefined {
  if (key.length === 0 || (key.length > 1 && key[0] === "0")) return undefined;
  let index = 0;
  for (let offset = 0; offset < key.length; offset += 1) {
    const code = stringCharCodeAt(key, offset);
    if (code < 0x30 || code > 0x39) return undefined;
    index = index * 10 + code - 0x30;
    if (index > 0xffff_fffe) return undefined;
  }
  return index < length ? index : undefined;
}

/**
 * Copies an untrusted JSON-shaped value into the only graph later handed to
 * schemas. Frozen protocols retain their one-read behavior; strict v7 accepts
 * enumerable data descriptors only and therefore never invokes input getters.
 */
function captureDocumentValue(
  value: unknown,
  limits: DesignDocumentLimits,
  strictV7Snapshot: boolean,
): unknown {
  const captured = new IntrinsicWeakMap<object, CapturedObject>();
  let structuralValues = 0;

  const capture = (current: unknown, depth: number): unknown => {
    structuralValues += 1;
    if (structuralValues > limits.maxStructuralValues) {
      stopAtLimit(
        "maxStructuralValues",
        limits.maxStructuralValues,
        structuralValues,
      );
    }
    if (depth > limits.maxNestingDepth) {
      stopAtLimit("maxNestingDepth", limits.maxNestingDepth, depth);
    }
    if (typeof current !== "object" || current === null) {
      if (
        strictV7Snapshot &&
        (current === undefined ||
          typeof current === "bigint" ||
          typeof current === "function" ||
          typeof current === "symbol" ||
          (typeof current === "number" && !numberIsFinite(current)))
      ) {
        malformedStrictV7Snapshot(
          "Document-v7 values must be lossless JSON primitives",
        );
      }
      return current;
    }

    const known = weakMapGet(captured, current);
    if (known !== undefined) {
      if (known.state === "active") {
        stopWith(
          failure(
            diagnostic(
              "IR_INVALID",
              "Design-document input cannot contain object cycles",
              { severity: "error" },
            ),
          ),
        );
      }
      return known.output;
    }

    if (arrayIsArray(current)) {
      if (
        strictV7Snapshot &&
        objectGetPrototypeOf(current) !== intrinsicArrayPrototype
      ) {
        malformedStrictV7Snapshot(
          "Document-v7 arrays must use the intrinsic array prototype",
        );
      }
      const strictLengthDescriptor = strictV7Snapshot
        ? objectGetOwnPropertyDescriptor(current, "length")
        : undefined;
      const strictLength =
        strictLengthDescriptor !== undefined &&
        strictLengthDescriptor.enumerable === false &&
        objectHasOwn(strictLengthDescriptor, "value") &&
        numberIsSafeInteger(strictLengthDescriptor.value) &&
        strictLengthDescriptor.value >= 0 &&
        strictLengthDescriptor.value <= 0xffff_ffff
          ? strictLengthDescriptor.value
          : undefined;
      const length = strictV7Snapshot ? strictLength : arrayLength(current);
      if (length === undefined) {
        stopWith(
          failure(
            diagnostic("IR_INVALID", "Design-document array length is invalid", {
              severity: "error",
            }),
          ),
        );
      }
      assertSchedulingCapacity(
        "maxStructuralValues",
        limits.maxStructuralValues,
        structuralValues,
        0,
        length,
      );
      if (strictV7Snapshot) {
        const ownKeys = reflectOwnKeys(current);
        if (ownKeys.length !== length + 1) {
          malformedStrictV7Snapshot(
            "Document-v7 arrays cannot contain sparse, hidden, symbolic, or extra properties",
          );
        }
        const descriptors = new IntrinsicArray<PropertyDescriptor>(length);
        for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
          const key = ownKeys[keyIndex]!;
          if (typeof key !== "string") {
            malformedStrictV7Snapshot(
              "Document-v7 arrays cannot contain symbol properties",
            );
          }
          if (key === "length") continue;
          const index = strictV7ArrayIndex(key, length);
          const descriptor =
            index === undefined
              ? undefined
              : objectGetOwnPropertyDescriptor(current, key);
          if (
            index === undefined ||
            descriptor === undefined ||
            descriptor.enumerable !== true ||
            !objectHasOwn(descriptor, "value") ||
            descriptors[index] !== undefined
          ) {
            malformedStrictV7Snapshot(
              "Document-v7 arrays require dense enumerable data indices and no extra properties",
            );
          }
          descriptors[index] = descriptor;
        }
        for (let index = 0; index < length; index += 1) {
          if (descriptors[index] === undefined) {
            malformedStrictV7Snapshot(
              "Document-v7 arrays cannot be sparse",
            );
          }
        }
        const output = new IntrinsicArray<unknown>(length);
        const state: CapturedObject = { output, state: "active" };
        weakMapSet(captured, current, state);
        for (let index = 0; index < length; index += 1) {
          output[index] = capture(descriptors[index]!.value, depth + 1);
        }
        state.state = "complete";
        return output;
      } else {
        const output = new IntrinsicArray<unknown>(length);
        const state: CapturedObject = { output, state: "active" };
        weakMapSet(captured, current, state);
        for (let index = 0; index < length; index += 1) {
          if (!objectHasOwn(current, index)) {
            stopWith(
              failure(
                diagnostic(
                  "IR_INVALID",
                  "Design-document arrays cannot be sparse",
                  { severity: "error" },
                ),
              ),
            );
          }
          output[index] = capture(current[index], depth + 1);
        }
        state.state = "complete";
        return output;
      }
    }

    const prototype = objectGetPrototypeOf(current);
    if (prototype !== intrinsicObjectPrototype && prototype !== null) {
      stopWith(
        failure(
          diagnostic(
            "IR_INVALID",
            "Design-document objects must be plain JSON records",
            { severity: "error" },
          ),
        ),
      );
    }
    const keys = strictV7Snapshot
      ? reflectOwnKeys(current)
      : objectKeys(current);
    assertSchedulingCapacity(
      "maxStructuralValues",
      limits.maxStructuralValues,
      structuralValues,
      0,
      keys.length,
    );
    const source = current as Readonly<Record<string, unknown>>;
    if (strictV7Snapshot) {
      const stringKeys = new IntrinsicArray<string>(keys.length);
      const descriptors = new IntrinsicArray<PropertyDescriptor>(keys.length);
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (typeof key !== "string") {
          malformedStrictV7Snapshot(
            "Document-v7 objects cannot contain symbol properties",
          );
        }
        const descriptor = objectGetOwnPropertyDescriptor(current, key);
        if (
          descriptor === undefined ||
          descriptor.enumerable !== true ||
          !objectHasOwn(descriptor, "value")
        ) {
          malformedStrictV7Snapshot(
            "Document-v7 objects require enumerable data properties",
          );
        }
        stringKeys[index] = key;
        descriptors[index] = descriptor;
      }
      const output = objectCreateNull();
      const state: CapturedObject = { output, state: "active" };
      weakMapSet(captured, current, state);
      for (let index = 0; index < keys.length; index += 1) {
        output[stringKeys[index]!] = capture(
          descriptors[index]!.value,
          depth + 1,
        );
      }
      state.state = "complete";
      return output;
    } else {
      const output = objectCreateNull();
      const state: CapturedObject = { output, state: "active" };
      weakMapSet(captured, current, state);
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index] as string;
        const child = source[key];
        output[key] = capture(child, depth + 1);
      }
      state.state = "complete";
      return output;
    }
  };

  return capture(value, 0);
}

/** Counts every structural occurrence, including repeated aliases. */
function checkStructuralOccurrences(
  value: unknown,
  limits: DesignDocumentLimits,
): void {
  const stack: { readonly value: unknown; readonly depth: number }[] = [
    { value, depth: 0 },
  ];
  let structuralValues = 0;
  while (stack.length > 0) {
    const current = stack[stack.length - 1]!;
    stack.length -= 1;
    structuralValues += 1;
    if (structuralValues > limits.maxStructuralValues) {
      stopAtLimit(
        "maxStructuralValues",
        limits.maxStructuralValues,
        structuralValues,
      );
    }
    if (current.depth > limits.maxNestingDepth) {
      stopAtLimit("maxNestingDepth", limits.maxNestingDepth, current.depth);
    }
    if (typeof current.value !== "object" || current.value === null) continue;

    const children = arrayIsArray(current.value)
      ? current.value
      : objectValues(current.value as Readonly<Record<string, unknown>>);
    assertSchedulingCapacity(
      "maxStructuralValues",
      limits.maxStructuralValues,
      structuralValues,
      stack.length,
      children.length,
    );
    for (let index = 0; index < children.length; index += 1) {
      stack[stack.length] = {
        value: children[index],
        depth: current.depth + 1,
      };
    }
  }
}

function topologyQueryRoots(value: unknown): readonly unknown[] {
  const root = record(value);
  const nodes = record(root?.nodes);
  if (nodes === undefined) return [];
  const roots: unknown[] = [];
  const nodeValues = objectValues(nodes);
  for (let index = 0; index < nodeValues.length; index += 1) {
    const node = nodeValues[index];
    const candidate = record(node);
    if (candidate === undefined) continue;
    const selection =
      candidate.kind === "fillet" || candidate.kind === "chamfer"
        ? record(candidate.edges)
        : candidate.kind === "shell"
          ? record(candidate.openings)
          : candidate.kind === "draft"
            ? record(candidate.faces)
            : undefined;
    if (selection !== undefined && objectHasOwn(selection, "query")) {
      roots[roots.length] = selection.query;
    }
  }
  return roots;
}

/** Counts only selector query trees, never lookalike `op` keys in metadata. */
function checkTopologyQueryOccurrences(
  value: unknown,
  limits: DesignDocumentLimits,
): void {
  const roots = topologyQueryRoots(value);
  const stack = new IntrinsicArray<unknown>(roots.length);
  for (let index = 0; index < roots.length; index += 1) {
    stack[index] = roots[index];
  }
  let topologyQueryNodes = 0;
  assertSchedulingCapacity(
    "maxTopologyQueryNodes",
    limits.maxTopologyQueryNodes,
    0,
    0,
    stack.length,
  );
  while (stack.length > 0) {
    const query = stack[stack.length - 1];
    stack.length -= 1;
    topologyQueryNodes += 1;
    if (topologyQueryNodes > limits.maxTopologyQueryNodes) {
      stopAtLimit(
        "maxTopologyQueryNodes",
        limits.maxTopologyQueryNodes,
        topologyQueryNodes,
      );
    }
    const candidate = record(query);
    if (candidate === undefined) continue;

    let children: readonly unknown[] = [];
    if (
      (candidate.op === "and" || candidate.op === "or") &&
      arrayIsArray(candidate.queries)
    ) {
      children = candidate.queries;
    } else if (candidate.op === "not" && objectHasOwn(candidate, "query")) {
      children = [candidate.query];
    } else if (candidate.op === "adjacentTo") {
      const selection = record(candidate.selection);
      if (selection !== undefined && objectHasOwn(selection, "query")) {
        children = [selection.query];
      }
    }
    assertSchedulingCapacity(
      "maxTopologyQueryNodes",
      limits.maxTopologyQueryNodes,
      topologyQueryNodes,
      stack.length,
      children.length,
    );
    for (let index = 0; index < children.length; index += 1) {
      stack[stack.length] = children[index];
    }
  }
}

function checkTopologyReferenceResources(
  value: unknown,
  limits: DesignDocumentLimits,
): void {
  const root = record(value);
  const registry = record(root?.topologyReferences);
  if (registry === undefined) return;
  const referenceIds = objectKeys(registry);
  if (referenceIds.length > limits.maxTopologyReferences) {
    stopAtLimit(
      "maxTopologyReferences",
      limits.maxTopologyReferences,
      referenceIds.length,
    );
  }
  let variants = 0;
  let adjacencyLinks = 0;
  let evidenceRecords = 0;
  for (
    let referenceIndex = 0;
    referenceIndex < referenceIds.length;
    referenceIndex += 1
  ) {
    const id = referenceIds[referenceIndex]!;
    const entry = record(registry[id]);
    const entryVariants = entry?.variants;
    const variantLength = arrayLength(entryVariants);
    if (variantLength === undefined || !arrayIsArray(entryVariants)) continue;
    variants += variantLength;
    if (variants > limits.maxTopologyReferenceVariants) {
      stopAtLimit(
        "maxTopologyReferenceVariants",
        limits.maxTopologyReferenceVariants,
        variants,
      );
    }
    for (let index = 0; index < variantLength; index += 1) {
      const variant = record(entryVariants[index]);
      evidenceRecords += arrayLength(variant?.lineage) ?? 0;
      const adjacency = variant?.adjacency;
      const adjacencyLength = arrayLength(adjacency) ?? 0;
      adjacencyLinks += adjacencyLength;
      if (arrayIsArray(adjacency)) {
        for (
          let neighborIndex = 0;
          neighborIndex < adjacency.length;
          neighborIndex += 1
        ) {
          const neighborValue = adjacency[neighborIndex];
          const neighbor = record(neighborValue);
          evidenceRecords += arrayLength(neighbor?.lineage) ?? 0;
        }
      }
      if (adjacencyLinks > limits.maxStoredAdjacencyLinks) {
        stopAtLimit(
          "maxStoredAdjacencyLinks",
          limits.maxStoredAdjacencyLinks,
          adjacencyLinks,
        );
      }
      if (evidenceRecords > limits.maxStoredEvidenceRecords) {
        stopAtLimit(
          "maxStoredEvidenceRecords",
          limits.maxStoredEvidenceRecords,
          evidenceRecords,
        );
      }
    }
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = stringCharCodeAt(value, index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length
    ) {
      const trailing = stringCharCodeAt(value, index + 1);
      if (trailing >= 0xdc00 && trailing <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function checkResourceDefinitionResources(
  value: unknown,
  limits: DesignDocumentLimits,
): void {
  const root = record(value);
  // Resource registries are staged document-v7 grammar. Version-gating these
  // checks preserves the frozen diagnostic order and behavior of v1-v6.
  if (root?.version !== 7) return;
  const resources = record(root.resources);
  if (resources === undefined) return;
  const resourceIds = objectKeys(resources);
  if (resourceIds.length > limits.maxResourceDefinitions) {
    stopAtLimit(
      "maxResourceDefinitions",
      limits.maxResourceDefinitions,
      resourceIds.length,
    );
  }
  let locations = 0;
  let locationBytes = 0;
  for (
    let resourceIndex = 0;
    resourceIndex < resourceIds.length;
    resourceIndex += 1
  ) {
    const id = resourceIds[resourceIndex]!;
    const definition = record(resources[id]);
    const definitionLocations = definition?.locations;
    const locationCount = arrayLength(definitionLocations);
    if (
      locationCount === undefined ||
      !arrayIsArray(definitionLocations)
    ) {
      continue;
    }
    locations += locationCount;
    if (locations > limits.maxResourceLocations) {
      stopAtLimit(
        "maxResourceLocations",
        limits.maxResourceLocations,
        locations,
      );
    }
    for (let index = 0; index < locationCount; index += 1) {
      const location = definitionLocations[index];
      if (typeof location !== "string") continue;
      locationBytes += utf8ByteLength(location);
      if (locationBytes > limits.maxResourceLocationBytes) {
        stopAtLimit(
          "maxResourceLocationBytes",
          limits.maxResourceLocationBytes,
          locationBytes,
        );
      }
    }
  }
}

/**
 * Detaches and bounds untrusted document structure before recursive schemas or
 * freezing can consume it. The returned plain snapshot is the value that must
 * be parsed; callers must not inspect the original input again.
 */
export function preflightDesignDocumentValue(
  value: unknown,
  limits: DesignDocumentLimits,
  options: { readonly strictV7Snapshot?: boolean } = {},
): CadResult<unknown> {
  let strictV7Snapshot = false;
  try {
    strictV7Snapshot = options.strictV7Snapshot === true;
    const snapshot = captureDocumentValue(
      value,
      limits,
      strictV7Snapshot,
    );
    checkStructuralOccurrences(snapshot, limits);
    checkTopologyQueryOccurrences(snapshot, limits);
    checkTopologyReferenceResources(snapshot, limits);
    checkResourceDefinitionResources(snapshot, limits);
    return success(snapshot);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      weakSetHas(documentPreflightFailures, error)
    ) {
      return (error as DocumentPreflightFailure).result;
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        strictV7Snapshot
          ? "Design-document input could not be read safely"
          : safeErrorMessage(
              error,
              "Design-document input could not be read safely",
            ),
        { severity: "error" },
      ),
    );
  }
}
