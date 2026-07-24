/**
 * Document v7 treats schemas and semantic validation as one synchronous trust
 * boundary. Capture complete inheritance-bearing prototypes plus the selected
 * constructor and namespace properties used by that dependency closure.
 */

const IntrinsicArray = Array;
const IntrinsicError = Error;
const IntrinsicFunction = Function;
const IntrinsicGlobalThis = globalThis;
const IntrinsicJSON = JSON;
const IntrinsicMap = Map;
const IntrinsicMath = Math;
const IntrinsicNumber = Number;
const IntrinsicObject = Object;
const IntrinsicPromise = Promise;
const IntrinsicReflect = Reflect;
const IntrinsicRegExp = RegExp;
const IntrinsicSet = Set;
const IntrinsicString = String;
const IntrinsicSymbol = Symbol;
const IntrinsicSyntaxError = SyntaxError;
const IntrinsicTextEncoder = TextEncoder;
const IntrinsicTypeError = TypeError;
const IntrinsicUint8Array = Uint8Array;
const IntrinsicWeakMap = WeakMap;
const IntrinsicWeakSet = WeakSet;

const intrinsicObjectGetOwnPropertyDescriptor =
  IntrinsicObject.getOwnPropertyDescriptor;
const intrinsicObjectGetPrototypeOf = IntrinsicObject.getPrototypeOf;
const intrinsicObjectHasOwn = IntrinsicObject.hasOwn;
const intrinsicObjectIs = IntrinsicObject.is;
const intrinsicReflectApply = IntrinsicReflect.apply;
const intrinsicReflectOwnKeys = IntrinsicReflect.ownKeys;
const intrinsicIteratorSymbol = IntrinsicSymbol.iterator;

type DescriptorSnapshot =
  | {
      readonly key: PropertyKey;
      readonly kind: "data";
      readonly configurable: boolean;
      readonly enumerable: boolean;
      readonly writable: boolean;
      readonly value: unknown;
    }
  | {
      readonly key: PropertyKey;
      readonly kind: "accessor";
      readonly configurable: boolean;
      readonly enumerable: boolean;
      readonly get: (() => unknown) | undefined;
      readonly set: ((value: unknown) => void) | undefined;
    };

interface OwnerSnapshot {
  readonly owner: object;
  readonly prototype: object | null;
  readonly descriptors: readonly DescriptorSnapshot[];
}

interface PropertySnapshot {
  readonly owner: object;
  readonly descriptor: DescriptorSnapshot;
}

interface GlobalBindingSnapshot {
  readonly key: string;
  readonly descriptor: DescriptorSnapshot;
}

function objectGetOwnPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  return intrinsicReflectApply(
    intrinsicObjectGetOwnPropertyDescriptor,
    IntrinsicObject,
    [value, key],
  ) as PropertyDescriptor | undefined;
}

function objectGetPrototypeOf(value: object): object | null {
  return intrinsicReflectApply(
    intrinsicObjectGetPrototypeOf,
    IntrinsicObject,
    [value],
  ) as object | null;
}

function objectHasOwn(value: object, key: PropertyKey): boolean {
  return intrinsicReflectApply(intrinsicObjectHasOwn, IntrinsicObject, [
    value,
    key,
  ]) as boolean;
}

function objectIs(first: unknown, second: unknown): boolean {
  return intrinsicReflectApply(intrinsicObjectIs, IntrinsicObject, [
    first,
    second,
  ]) as boolean;
}

function reflectApply(
  target: (...arguments_: never[]) => unknown,
  receiver: unknown,
  arguments_: readonly unknown[],
): unknown {
  return intrinsicReflectApply(target, receiver, arguments_);
}

function reflectOwnKeys(value: object): (string | symbol)[] {
  return intrinsicReflectApply(intrinsicReflectOwnKeys, IntrinsicReflect, [
    value,
  ]) as (string | symbol)[];
}

function snapshotDescriptor(
  owner: object,
  key: PropertyKey,
): DescriptorSnapshot {
  const descriptor = objectGetOwnPropertyDescriptor(owner, key);
  if (descriptor === undefined) {
    throw new TypeError("Document-v7 intrinsic descriptor is missing");
  }
  return objectHasOwn(descriptor, "value")
    ? {
        key,
        kind: "data",
        configurable: descriptor.configurable === true,
        enumerable: descriptor.enumerable === true,
        writable: descriptor.writable === true,
        value: descriptor.value,
      }
    : {
        key,
        kind: "accessor",
        configurable: descriptor.configurable === true,
        enumerable: descriptor.enumerable === true,
        get: descriptor.get,
        set: descriptor.set,
      };
}

function snapshotOwner(owner: object): OwnerSnapshot {
  const keys = reflectOwnKeys(owner);
  const descriptors = new IntrinsicArray<DescriptorSnapshot>(keys.length);
  for (let index = 0; index < keys.length; index += 1) {
    descriptors[index] = snapshotDescriptor(owner, keys[index]!);
  }
  return {
    owner,
    prototype: objectGetPrototypeOf(owner),
    descriptors,
  };
}

function descriptorMatches(
  snapshot: DescriptorSnapshot,
  descriptor: PropertyDescriptor | undefined,
): boolean {
  if (
    descriptor === undefined ||
    descriptor.configurable === true !== snapshot.configurable ||
    descriptor.enumerable === true !== snapshot.enumerable
  ) {
    return false;
  }
  const data = objectHasOwn(descriptor, "value");
  if (snapshot.kind === "data") {
    return (
      data &&
      descriptor.writable === true === snapshot.writable &&
      objectIs(descriptor.value, snapshot.value)
    );
  }
  return (
    !data &&
    objectIs(descriptor.get, snapshot.get) &&
    objectIs(descriptor.set, snapshot.set)
  );
}

function ownerMatches(snapshot: OwnerSnapshot): boolean {
  if (!objectIs(objectGetPrototypeOf(snapshot.owner), snapshot.prototype)) {
    return false;
  }
  const keys = reflectOwnKeys(snapshot.owner);
  if (keys.length !== snapshot.descriptors.length) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = snapshot.descriptors[index]!;
    if (
      !objectIs(keys[index], descriptor.key) ||
      !descriptorMatches(
        descriptor,
        objectGetOwnPropertyDescriptor(snapshot.owner, descriptor.key),
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Captures a non-intrinsic synchronous dependency, such as Zod's global
 * configuration record, with the same accessor-free owner comparison.
 */
export function captureDocumentV7RuntimeOwnerIntegrityChecker(
  owner: object,
): () => boolean {
  const snapshot = snapshotOwner(owner);
  return (): boolean => {
    try {
      return ownerMatches(snapshot);
    } catch {
      return false;
    }
  };
}

function appendUniqueOwner(owners: object[], owner: object | null): void {
  if (owner === null) return;
  for (let index = 0; index < owners.length; index += 1) {
    if (objectIs(owners[index], owner)) return;
  }
  owners[owners.length] = owner;
}

function iteratorPrototype(
  prototype: object,
  receiver: unknown,
): object {
  const descriptor = objectGetOwnPropertyDescriptor(
    prototype,
    intrinsicIteratorSymbol,
  );
  if (
    descriptor === undefined ||
    !objectHasOwn(descriptor, "value") ||
    typeof descriptor.value !== "function"
  ) {
    throw new TypeError("Document-v7 iterator intrinsic is missing");
  }
  const iterator = reflectApply(
    descriptor.value as (...arguments_: never[]) => unknown,
    receiver,
    [],
  );
  if (typeof iterator !== "object" || iterator === null) {
    throw new TypeError("Document-v7 iterator intrinsic is malformed");
  }
  const prototypeValue = objectGetPrototypeOf(iterator);
  if (prototypeValue === null) {
    throw new TypeError("Document-v7 iterator prototype is missing");
  }
  return prototypeValue;
}

const arrayIteratorPrototype = iteratorPrototype(
  IntrinsicArray.prototype,
  new IntrinsicArray<unknown>(),
);
const mapIteratorPrototype = iteratorPrototype(
  IntrinsicMap.prototype,
  new IntrinsicMap<unknown, unknown>(),
);
const setIteratorPrototype = iteratorPrototype(
  IntrinsicSet.prototype,
  new IntrinsicSet<unknown>(),
);
const intrinsicTypedArrayPrototype = objectGetPrototypeOf(
  IntrinsicUint8Array.prototype,
);

const completeOwners = new IntrinsicArray<object>();
for (const owner of [
  IntrinsicArray.prototype,
  IntrinsicError.prototype,
  IntrinsicFunction.prototype,
  IntrinsicMap.prototype,
  IntrinsicObject.prototype,
  IntrinsicPromise.prototype,
  IntrinsicRegExp.prototype,
  IntrinsicSet.prototype,
  IntrinsicString.prototype,
  IntrinsicSyntaxError.prototype,
  IntrinsicTextEncoder.prototype,
  IntrinsicTypeError.prototype,
  IntrinsicUint8Array.prototype,
  IntrinsicWeakMap.prototype,
  IntrinsicWeakSet.prototype,
  arrayIteratorPrototype,
  mapIteratorPrototype,
  setIteratorPrototype,
  intrinsicTypedArrayPrototype,
] as const) {
  appendUniqueOwner(completeOwners, owner);
}
for (const iteratorOwner of [
  arrayIteratorPrototype,
  mapIteratorPrototype,
  setIteratorPrototype,
] as const) {
  appendUniqueOwner(
    completeOwners,
    objectGetPrototypeOf(iteratorOwner),
  );
}

const OWNER_SNAPSHOTS = new IntrinsicArray<OwnerSnapshot>(
  completeOwners.length,
);
for (let index = 0; index < completeOwners.length; index += 1) {
  OWNER_SNAPSHOTS[index] = snapshotOwner(completeOwners[index]!);
}

// Updating Zod or the v7 validation path requires re-auditing this manifest.
// Constructor/namespace additions outside it are intentionally not lockdown
// events; inheritance-bearing prototypes above remain complete snapshots.
const SELECTED_PROPERTIES = [
  [
    IntrinsicArray,
    ["prototype", "isArray", "from", IntrinsicSymbol.species],
  ],
  [
    IntrinsicObject,
    [
      "prototype",
      "assign",
      "create",
      "defineProperty",
      "defineProperties",
      "entries",
      "freeze",
      "fromEntries",
      "getOwnPropertyDescriptor",
      "getOwnPropertyDescriptors",
      "getPrototypeOf",
      "hasOwn",
      "is",
      "isFrozen",
      "keys",
      "values",
    ],
  ],
  [
    IntrinsicNumber,
    [
      "isFinite",
      "isInteger",
      "isNaN",
      "isSafeInteger",
      "parseInt",
      "EPSILON",
      "MIN_SAFE_INTEGER",
      "MAX_SAFE_INTEGER",
      "MAX_VALUE",
      "NEGATIVE_INFINITY",
      "POSITIVE_INFINITY",
    ],
  ],
  [IntrinsicMath, ["PI", "abs", "ceil", "hypot", "max", "min", "round"]],
  [IntrinsicReflect, ["apply", "ownKeys"]],
  [IntrinsicJSON, ["parse", "stringify"]],
  [
    IntrinsicSymbol,
    ["iterator", "hasInstance", "species"],
  ],
  [IntrinsicPromise, ["prototype", "resolve", "all"]],
  [IntrinsicError, ["prototype"]],
  [IntrinsicTypeError, ["prototype"]],
  [IntrinsicSyntaxError, ["prototype"]],
  [IntrinsicFunction, ["prototype"]],
  [IntrinsicMap, ["prototype"]],
  [IntrinsicSet, ["prototype"]],
  [IntrinsicWeakMap, ["prototype"]],
  [IntrinsicWeakSet, ["prototype"]],
  [IntrinsicRegExp, ["prototype"]],
  [IntrinsicString, ["prototype"]],
  [IntrinsicTextEncoder, ["prototype"]],
  [IntrinsicUint8Array, ["prototype"]],
] as const satisfies readonly (
  readonly [object, readonly PropertyKey[]]
)[];

let selectedPropertyCount = 0;
for (let index = 0; index < SELECTED_PROPERTIES.length; index += 1) {
  selectedPropertyCount += SELECTED_PROPERTIES[index]![1].length;
}
const PROPERTY_SNAPSHOTS = new IntrinsicArray<PropertySnapshot>(
  selectedPropertyCount,
);
let selectedPropertyIndex = 0;
for (let ownerIndex = 0; ownerIndex < SELECTED_PROPERTIES.length; ownerIndex += 1) {
  const [owner, keys] = SELECTED_PROPERTIES[ownerIndex]!;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    PROPERTY_SNAPSHOTS[selectedPropertyIndex] = {
      owner,
      descriptor: snapshotDescriptor(owner, keys[keyIndex]!),
    };
    selectedPropertyIndex += 1;
  }
}

const GLOBAL_BINDING_NAMES = [
  "Array",
  "Error",
  "Function",
  "globalThis",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "SyntaxError",
  "TextEncoder",
  "TypeError",
  "WeakMap",
  "WeakSet",
] as const;

const GLOBAL_BINDING_SNAPSHOTS =
  new IntrinsicArray<GlobalBindingSnapshot>(GLOBAL_BINDING_NAMES.length);
for (let index = 0; index < GLOBAL_BINDING_NAMES.length; index += 1) {
  const key = GLOBAL_BINDING_NAMES[index]!;
  GLOBAL_BINDING_SNAPSHOTS[index] = {
    key,
    descriptor: snapshotDescriptor(IntrinsicGlobalThis, key),
  };
}

/**
 * This checker intentionally reads descriptors rather than property values.
 * Replacing an intrinsic with an accessor that throws an opaque value must
 * report corruption, never invoke the accessor.
 */
export function documentV7RuntimeIntrinsicsAreIntact(): boolean {
  try {
    for (
      let index = 0;
      index < GLOBAL_BINDING_SNAPSHOTS.length;
      index += 1
    ) {
      const snapshot = GLOBAL_BINDING_SNAPSHOTS[index]!;
      if (
        !descriptorMatches(
          snapshot.descriptor,
          objectGetOwnPropertyDescriptor(IntrinsicGlobalThis, snapshot.key),
        )
      ) {
        return false;
      }
    }
    for (let index = 0; index < OWNER_SNAPSHOTS.length; index += 1) {
      if (!ownerMatches(OWNER_SNAPSHOTS[index]!)) return false;
    }
    for (let index = 0; index < PROPERTY_SNAPSHOTS.length; index += 1) {
      const snapshot = PROPERTY_SNAPSHOTS[index]!;
      if (
        !descriptorMatches(
          snapshot.descriptor,
          objectGetOwnPropertyDescriptor(
            snapshot.owner,
            snapshot.descriptor.key,
          ),
        )
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export const DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE =
  "Document-v7 runtime intrinsics changed during the operation";
const DOCUMENT_V7_RUNTIME_INTEGRITY_ERROR = IntrinsicObject.freeze(
  new IntrinsicTypeError(DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE),
);

/** Throws a preconstructed realm error without reading corrupted descriptors. */
export function throwDocumentV7RuntimeIntegrityError(): never {
  throw DOCUMENT_V7_RUNTIME_INTEGRITY_ERROR;
}
