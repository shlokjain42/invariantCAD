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
const intrinsicNumberIsSafeInteger = Number.isSafeInteger;
const intrinsicObjectCreate = Object.create;
const intrinsicObjectFreeze = Object.freeze;
const intrinsicObjectIs = Object.is;
const intrinsicObjectIsFrozen = Object.isFrozen;
const intrinsicObjectKeys = Object.keys;
const intrinsicObjectValues = Object.values;
const intrinsicStringCharCodeAt = String.prototype.charCodeAt;
const reflectApply = Reflect.apply;
const canonicalByteLimitExceeded = {};

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

function assertCanonicalByteLimit(maximumBytes: number): void {
  if (
    !reflectApply(intrinsicNumberIsSafeInteger, Number, [maximumBytes]) ||
    maximumBytes < 0
  ) {
    throw new TypeError(
      "maximumBytes must be a nonnegative safe integer",
    );
  }
}

function stringCodeUnitAt(value: string, index: number): number {
  return reflectApply(intrinsicStringCharCodeAt, value, [index]) as number;
}

/**
 * Counts the canonical protocol JSON bytes without constructing the canonical
 * object tree, output string, or UTF-8 buffer. Callers must first detach and
 * structurally bound the JSON-shaped value.
 */
export function canonicalProtocolByteLengthWithin(
  value: unknown,
  maximumBytes: number,
  pretty = false,
): number | undefined {
  assertCanonicalByteLimit(maximumBytes);
  let byteLength = 0;

  const addBytes = (amount: number): void => {
    if (amount > maximumBytes - byteLength) {
      throw canonicalByteLimitExceeded;
    }
    byteLength += amount;
  };

  const countQuotedString = (text: string): void => {
    addBytes(2);
    for (let index = 0; index < text.length; index += 1) {
      const codeUnit = stringCodeUnitAt(text, index);
      if (codeUnit === 0x22 || codeUnit === 0x5c) {
        addBytes(2);
      } else if (
        codeUnit === 0x08 ||
        codeUnit === 0x09 ||
        codeUnit === 0x0a ||
        codeUnit === 0x0c ||
        codeUnit === 0x0d
      ) {
        addBytes(2);
      } else if (codeUnit <= 0x1f) {
        addBytes(6);
      } else if (codeUnit <= 0x7f) {
        addBytes(1);
      } else if (codeUnit <= 0x7ff) {
        addBytes(2);
      } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const trailing =
          index + 1 < text.length
            ? stringCodeUnitAt(text, index + 1)
            : -1;
        if (trailing >= 0xdc00 && trailing <= 0xdfff) {
          addBytes(4);
          index += 1;
        } else {
          addBytes(6);
        }
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        addBytes(6);
      } else {
        addBytes(3);
      }
    }
  };

  const countValue = (child: unknown, depth: number): void => {
    if (typeof child === "number") {
      if (!reflectApply(intrinsicNumberIsFinite, Number, [child])) {
        throw new TypeError(
          "CAD documents cannot contain NaN or infinite numbers",
        );
      }
      const token = reflectApply(intrinsicJsonStringify, JSON, [
        child,
      ]) as string;
      addBytes(token.length);
      return;
    }
    if (child === null) {
      addBytes(4);
      return;
    }
    if (typeof child === "string") {
      countQuotedString(child);
      return;
    }
    if (typeof child === "boolean") {
      addBytes(child ? 4 : 5);
      return;
    }
    if (reflectApply(intrinsicArrayIsArray, Array, [child])) {
      const input = child as readonly unknown[];
      addBytes(1);
      if (input.length > 0) {
        if (pretty) addBytes(1);
        for (let index = 0; index < input.length; index += 1) {
          if (index > 0) addBytes(pretty ? 2 : 1);
          if (pretty) addBytes((depth + 1) * 2);
          countValue(input[index], depth + 1);
        }
        if (pretty) {
          addBytes(1);
          addBytes(depth * 2);
        }
      }
      addBytes(1);
      return;
    }
    if (typeof child === "object") {
      addBytes(1);
      const keys = sortedObjectKeys(child);
      let included = 0;
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        const grandchild = (child as Record<string, unknown>)[key];
        if (grandchild === undefined) continue;
        if (pretty) {
          addBytes(included === 0 ? 1 : 2);
          addBytes((depth + 1) * 2);
        } else if (included > 0) {
          addBytes(1);
        }
        countQuotedString(key);
        addBytes(pretty ? 2 : 1);
        countValue(grandchild, depth + 1);
        included += 1;
      }
      if (pretty && included > 0) {
        addBytes(1);
        addBytes(depth * 2);
      }
      addBytes(1);
      return;
    }
    throw new TypeError(`Unsupported JSON value: ${typeof child}`);
  };

  try {
    countValue(value, 0);
    return byteLength;
  } catch (error) {
    if (error === canonicalByteLimitExceeded) return undefined;
    throw error;
  }
}

/**
 * Serializes only after the canonical output is proven to fit the byte limit.
 * The existing writer remains authoritative so admitted output is unchanged.
 */
export function canonicalStringifyProtocolWithin(
  value: unknown,
  maximumBytes: number,
  pretty = false,
): string | undefined {
  if (
    canonicalProtocolByteLengthWithin(
      value,
      maximumBytes,
      pretty,
    ) === undefined
  ) {
    return undefined;
  }
  return canonicalStringifyProtocol(value, pretty ? 2 : undefined);
}
