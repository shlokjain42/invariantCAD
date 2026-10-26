/**
 * Zod 4.4 skipped every own `__proto__` key, so the frozen v1-v6 grammars
 * silently stripped it even from strict objects. Zod 4.6 reports that key as
 * unrecognized on strict objects. Frozen boundaries run this pass before
 * validation so admitted legacy bytes keep their published meaning on every
 * supported Zod release; Document v7 does not use it.
 */

const LegacyProtoObject = Object;
const LegacyProtoReflect = Reflect;
const LegacyProtoMap = Map;
const LegacyProtoSet = Set;
const legacyProtoArrayIsArray = Array.isArray;
const legacyProtoObjectPrototype = Object.prototype;
const legacyProtoObjectCreate = Object.create;
const legacyProtoObjectDefineProperty = Object.defineProperty;
const legacyProtoObjectGetPrototypeOf = Object.getPrototypeOf;
const legacyProtoObjectSetPrototypeOf = Object.setPrototypeOf;
const legacyProtoReflectApply = Reflect.apply;
const legacyProtoReflectGetOwnPropertyDescriptor =
  Reflect.getOwnPropertyDescriptor;
const legacyProtoReflectOwnKeys = Reflect.ownKeys;
const legacyProtoMapGet = Map.prototype.get;
const legacyProtoMapSet = Map.prototype.set;
const legacyProtoSetAdd = Set.prototype.add;
const legacyProtoSetHas = Set.prototype.has;

const LEGACY_PROTO_KEY = "__proto__";

function apply<T>(
  method: CallableFunction,
  receiver: unknown,
  arguments_: readonly unknown[],
): T {
  return legacyProtoReflectApply(method, receiver, arguments_) as T;
}

function ownDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  return apply<PropertyDescriptor | undefined>(
    legacyProtoReflectGetOwnPropertyDescriptor,
    LegacyProtoReflect,
    [value, key],
  );
}

function isArray(value: object): boolean {
  return apply<boolean>(legacyProtoArrayIsArray, Array, [value]);
}

function prototypeOf(value: object): object | null {
  return apply<object | null>(
    legacyProtoObjectGetPrototypeOf,
    LegacyProtoObject,
    [value],
  );
}

/** Plain records and arrays are the only containers the pass rebuilds. */
function isPlainContainer(value: object): boolean {
  if (isArray(value)) return true;
  const prototype = prototypeOf(value);
  return prototype === null || prototype === legacyProtoObjectPrototype;
}

/**
 * Returns `input` unchanged unless a plain record or array reachable through
 * own data properties owns an enumerable `__proto__` key. Otherwise it returns
 * a copy of every reachable plain container without those keys, preserving
 * prototypes, property descriptors, sharing, and cycles. It never invokes
 * accessors and never mutates `input`.
 */
export function stripLegacyOwnProtoKeys(input: unknown): unknown {
  if (typeof input !== "object" || input === null) return input;
  const visited = new LegacyProtoSet<object>();
  const containers: object[] = [];
  const pending: object[] = [input];
  let found = false;
  while (pending.length > 0) {
    const value = pending.pop()!;
    if (
      apply<boolean>(legacyProtoSetHas, visited, [value]) ||
      !isPlainContainer(value)
    ) {
      continue;
    }
    apply(legacyProtoSetAdd, visited, [value]);
    containers.push(value);
    const keys = apply<(string | symbol)[]>(
      legacyProtoReflectOwnKeys,
      LegacyProtoReflect,
      [value],
    );
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      const descriptor = ownDescriptor(value, key);
      // A stripped key's value can never reach the validated result.
      if (key === LEGACY_PROTO_KEY && descriptor?.enumerable === true) {
        found = true;
        continue;
      }
      const child: unknown = descriptor?.value;
      if (typeof child === "object" && child !== null) pending.push(child);
    }
  }
  if (!found) return input;

  const copies = new LegacyProtoMap<object, object>();
  for (let index = 0; index < containers.length; index += 1) {
    const original = containers[index]!;
    let copy: object;
    if (isArray(original)) {
      copy = [];
      apply(legacyProtoObjectSetPrototypeOf, LegacyProtoObject, [
        copy,
        prototypeOf(original),
      ]);
    } else {
      copy = apply<object>(legacyProtoObjectCreate, LegacyProtoObject, [
        prototypeOf(original),
      ]);
    }
    apply(legacyProtoMapSet, copies, [original, copy]);
  }
  for (let index = 0; index < containers.length; index += 1) {
    const original = containers[index]!;
    const copy = apply<object>(legacyProtoMapGet, copies, [original]);
    const keys = apply<(string | symbol)[]>(
      legacyProtoReflectOwnKeys,
      LegacyProtoReflect,
      [original],
    );
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex]!;
      const descriptor = ownDescriptor(original, key)!;
      if (key === LEGACY_PROTO_KEY && descriptor.enumerable === true) continue;
      if (typeof descriptor.value === "object" && descriptor.value !== null) {
        const replacement = apply<object | undefined>(
          legacyProtoMapGet,
          copies,
          [descriptor.value],
        );
        if (replacement !== undefined) descriptor.value = replacement;
      }
      apply(legacyProtoObjectDefineProperty, LegacyProtoObject, [
        copy,
        key,
        descriptor,
      ]);
    }
  }
  return apply<object>(legacyProtoMapGet, copies, [input]);
}
