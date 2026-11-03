/**
 * Reads caller-supplied authoring records and arrays through own data
 * properties only, so caller accessors never run and inherited or
 * prototype-supplied fields never reach a document. Intrinsics are captured
 * at load so later changes to these globals cannot weaken the checks.
 *
 * @internal Not re-exported from the package root.
 */

const reflectApply = Reflect.apply;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectGetOwnPropertyNames = Object.getOwnPropertyNames;
const arrayIsArray = Array.isArray;

function prototypeOf(value: object): object | null {
  return reflectApply(objectGetPrototypeOf, Object, [value]) as object | null;
}

/** A plain record's prototype is null or some realm's Object.prototype. */
export function isPlainRecord(value: object): boolean {
  if (arrayIsArray(value)) return false;
  const prototype = prototypeOf(value);
  return prototype === null || prototypeOf(prototype) === null;
}

/**
 * A plain array's prototype is some realm's Array.prototype, which is itself
 * an array and inherits directly from that realm's Object.prototype.
 */
export function isPlainArray(value: object): boolean {
  if (!arrayIsArray(value)) return false;
  const prototype = prototypeOf(value);
  if (prototype === null || !arrayIsArray(prototype)) return false;
  const root = prototypeOf(prototype);
  return root !== null && prototypeOf(root) === null;
}

/** Marks a property that exists but is not a usable own data property. */
export const NOT_OWN_DATA: unique symbol = Symbol("InvariantCAD.NotOwnData");

/**
 * Reads an own data property without running accessors or consulting the
 * prototype chain. A missing property reads as undefined; an accessor, or a
 * non-enumerable property when `enumerableOnly` is set, reads as
 * {@link NOT_OWN_DATA}.
 */
export function readOwnData(
  container: object,
  key: string | number,
  enumerableOnly = false,
): unknown {
  const descriptor = reflectApply(objectGetOwnPropertyDescriptor, Object, [
    container,
    key,
  ]) as PropertyDescriptor | undefined;
  if (descriptor === undefined) return undefined;
  if (
    !reflectApply(objectHasOwn, Object, [descriptor, "value"]) ||
    (enumerableOnly && descriptor.enumerable !== true)
  ) {
    return NOT_OWN_DATA;
  }
  return descriptor.value;
}

function ownDataField(container: object, key: string | number, label: string): unknown {
  const value = readOwnData(container, key);
  if (value === NOT_OWN_DATA) {
    throw new TypeError(`${label} must be a data property, not an accessor`);
  }
  return value;
}

/**
 * Snapshots a caller record into a frozen null-prototype record of its own
 * string-keyed data fields, enumerable or not, so each field is read exactly
 * once and a field defined as non-enumerable is honored rather than silently
 * replaced by its default. Non-plain records, accessors, and, when
 * `allowedKeys` is given, other fields throw TypeError.
 */
export function ownRecord<T extends object>(
  value: T,
  label: string,
  allowedKeys?: readonly string[],
): T {
  if (typeof value !== "object" || value === null || !isPlainRecord(value)) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const snapshot = reflectApply(objectCreate, Object, [null]) as Record<
    string,
    unknown
  >;
  const keys = reflectApply(objectGetOwnPropertyNames, Object, [
    value,
  ]) as string[];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (allowedKeys !== undefined) {
      let supported = false;
      for (let allowed = 0; allowed < allowedKeys.length; allowed += 1) {
        if (allowedKeys[allowed] === key) {
          supported = true;
          break;
        }
      }
      if (!supported) {
        throw new TypeError(`${label} contain unsupported field '${key}'`);
      }
    }
    reflectApply(objectDefineProperty, Object, [
      snapshot,
      key,
      {
        value: ownDataField(value, key, `${label} field '${key}'`),
        enumerable: true,
      },
    ]);
  }
  return reflectApply(objectFreeze, Object, [snapshot]) as T;
}

/**
 * Copies a dense plain caller array through its own data elements. Holes,
 * which `map` would skip, accessors, and lengths outside the given bounds
 * throw.
 */
export function ownDenseArray<T>(
  value: readonly T[],
  label: string,
  bounds: {
    readonly exactLength?: number;
    readonly maximumLength?: number;
  } = {},
): T[] {
  if (typeof value !== "object" || value === null || !isPlainArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const length = value.length;
  if (bounds.exactLength !== undefined && length !== bounds.exactLength) {
    throw new TypeError(
      `${label} must contain exactly ${bounds.exactLength} items`,
    );
  }
  if (bounds.maximumLength !== undefined && length > bounds.maximumLength) {
    throw new RangeError(
      `${label} exceed the authoring limit of ${bounds.maximumLength} items`,
    );
  }
  const items: T[] = [];
  for (let index = 0; index < length; index += 1) {
    if (!reflectApply(objectHasOwn, Object, [value, index])) {
      throw new TypeError(`${label} cannot be sparse`);
    }
    reflectApply(objectDefineProperty, Object, [
      items,
      index,
      {
        value: ownDataField(value, index, `${label}[${index}]`),
        writable: true,
        enumerable: true,
        configurable: true,
      },
    ]);
  }
  return items;
}
