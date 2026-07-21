export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
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
    if (!Number.isFinite(value)) {
      throw new TypeError("CAD documents cannot contain NaN or infinite numbers");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child) => canonicalizeValue(child, createRecord));
  }
  if (typeof value === "object") {
    const output = createRecord();
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
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
    () => Object.create(null) as Record<string, unknown>,
  );
}

export function canonicalStringify(value: unknown, space?: number): string {
  return JSON.stringify(canonicalize(value), null, space);
}

/** Stringifies new protocol payloads while preserving every own JSON key. */
export function canonicalStringifyProtocol(
  value: unknown,
  space?: number,
): string {
  return JSON.stringify(canonicalizeProtocol(value), null, space);
}
