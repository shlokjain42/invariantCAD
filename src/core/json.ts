export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const IntrinsicArray = Array;
const intrinsicArrayIsArray = IntrinsicArray.isArray;
const intrinsicArraySort = IntrinsicArray.prototype.sort;
const intrinsicJsonStringify = JSON.stringify;
const intrinsicNumberIsFinite = Number.isFinite;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectIs = Object.is;
const intrinsicObjectIsFrozen = Object.isFrozen;
const intrinsicObjectKeys = Object.keys;
const intrinsicObjectValues = Object.values;
const reflectApply = Reflect.apply;

function objectKeys(value: object): string[] {
  return reflectApply(intrinsicObjectKeys, Object, [value]) as string[];
}

function sortedObjectKeys(value: object): string[] {
  const keys = objectKeys(value);
  reflectApply(intrinsicArraySort, keys, []);
  return keys;
}

function objectValues(value: object): unknown[] {
  return reflectApply(intrinsicObjectValues, Object, [value]) as unknown[];
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (
    value !== null &&
    typeof value === "object" &&
    !reflectApply(intrinsicObjectIsFrozen, Object, [value])
  ) {
    reflectApply(intrinsicObjectFreeze, Object, [value]);
    for (const child of objectValues(value)) {
      deepFreeze(child);
    }
  }
  return value as Readonly<T>;
}

function canonicalizeValue(
  value: unknown,
  createRecord: () => Record<string, unknown>,
): unknown {
  if (typeof value === "number") {
    if (!reflectApply(intrinsicNumberIsFinite, Number, [value])) {
      throw new TypeError("CAD documents cannot contain NaN or infinite numbers");
    }
    return reflectApply(intrinsicObjectIs, Object, [value, -0]) ? 0 : value;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (reflectApply(intrinsicArrayIsArray, Array, [value])) {
    const input = value as readonly unknown[];
    const output = new IntrinsicArray<unknown>(input.length);
    for (let index = 0; index < input.length; index += 1) {
      output[index] = canonicalizeValue(input[index], createRecord);
    }
    return output;
  }
  if (typeof value === "object") {
    const output = createRecord();
    for (const key of sortedObjectKeys(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        output[key] = canonicalizeValue(child, createRecord);
      }
    }
    return output;
  }
  throw new TypeError(`Unsupported JSON value: ${typeof value}`);
}

/**
 * Frozen document protocols retain their original ordinary-object behavior.
 * In particular, an own `__proto__` key is omitted by the legacy setter.
 */
export function canonicalize(value: unknown): unknown {
  return canonicalizeValue(value, () => ({}));
}

/** Canonicalizes protocol payloads without invoking Object.prototype setters. */
export function canonicalizeProtocol(value: unknown): unknown {
  return canonicalizeValue(
    value,
    () =>
      reflectApply(intrinsicObjectCreate, Object, [
        null,
      ]) as Record<string, unknown>,
  );
}

export function canonicalStringify(value: unknown, space?: number): string {
  return reflectApply(intrinsicJsonStringify, JSON, [
    canonicalize(value),
    null,
    space,
  ]) as string;
}

/** Stringifies new protocol payloads while preserving every own JSON key. */
export function canonicalStringifyProtocol(
  value: unknown,
  space?: number,
): string {
  return reflectApply(intrinsicJsonStringify, JSON, [
    canonicalizeProtocol(value),
    null,
    space,
  ]) as string;
}
