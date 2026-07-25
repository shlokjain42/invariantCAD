import { describe, expect, it } from "vitest";
import {
  canonicalProtocolByteLengthWithin,
  canonicalStringify,
  canonicalStringifyProtocol,
  canonicalStringifyProtocolWithin,
  canonicalizeProtocol,
  deepFreeze,
} from "../src/core/json.js";

describe("canonical JSON", () => {
  it("counts and writes bounded protocol JSON byte-for-byte", () => {
    const ownProto = JSON.parse(
      '{"z":1,"__proto__":{"polluted":true},"a":2}',
    ) as Record<string, unknown>;
    const integerLikeKeys = {
      "4294967295": "not-an-array-index",
      "01": "leading-zero",
      "10": "ten",
      "2": "two",
      "4294967294": "largest-array-index",
      __proto__: null,
    };
    const cases: unknown[] = [
      null,
      true,
      false,
      0,
      -0,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      1e-7,
      1e21,
      1.2345678901234567,
      "",
      '"\\/\b\t\n\f\r\u0000\u001fé中😀',
      "\ud800x",
      "x\udc00",
      [],
      {},
      [null, true, false, -0, "é", ["😀"], {}],
      {
        emptyArray: [],
        emptyObject: {},
        nested: { z: 1, a: [2, { y: false, x: null }] },
        omitted: undefined,
      },
      ownProto,
      integerLikeKeys,
    ];
    const encoder = new TextEncoder();

    for (const pretty of [false, true]) {
      for (const value of cases) {
        const expected = canonicalStringifyProtocol(
          value,
          pretty ? 2 : undefined,
        );
        const expectedBytes = encoder.encode(expected).byteLength;

        expect(
          canonicalProtocolByteLengthWithin(
            value,
            Number.MAX_SAFE_INTEGER,
            pretty,
          ),
        ).toBe(expectedBytes);
        expect(
          canonicalStringifyProtocolWithin(
            value,
            Number.MAX_SAFE_INTEGER,
            pretty,
          ),
        ).toBe(expected);
      }
    }
  });

  it("accepts the exact byte ceiling and stops one byte below it", () => {
    const value = {
      z: ["é", "😀", "\ud800", "\udc00"],
      a: { nested: true },
    };
    const encoder = new TextEncoder();

    for (const pretty of [false, true]) {
      const expected = canonicalStringifyProtocol(
        value,
        pretty ? 2 : undefined,
      );
      const bytes = encoder.encode(expected).byteLength;

      expect(canonicalProtocolByteLengthWithin(value, bytes, pretty)).toBe(
        bytes,
      );
      expect(canonicalStringifyProtocolWithin(value, bytes, pretty)).toBe(
        expected,
      );
      expect(
        canonicalProtocolByteLengthWithin(value, bytes - 1, pretty),
      ).toBeUndefined();
      expect(
        canonicalStringifyProtocolWithin(value, bytes - 1, pretty),
      ).toBeUndefined();
    }
  });

  it("rejects invalid byte ceilings and invalid JSON values", () => {
    const boundedOperations = [
      canonicalProtocolByteLengthWithin,
      canonicalStringifyProtocolWithin,
    ];

    for (const operation of boundedOperations) {
      for (const maximumBytes of [
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        expect(() => operation(null, maximumBytes)).toThrow(TypeError);
      }

      for (const value of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ]) {
        expect(() => operation(value, 1_000)).toThrow(
          "CAD documents cannot contain NaN or infinite numbers",
        );
      }

      for (const value of [
        undefined,
        Symbol("unsupported"),
        1n,
        () => undefined,
        [undefined],
      ]) {
        expect(() => operation(value, 1_000)).toThrow(
          /Unsupported JSON value/,
        );
      }
    }
  });

  it("stops before reading later properties once the byte ceiling is exceeded", () => {
    let getterReads = 0;
    const source = Object.defineProperty(
      { a: "a value that already exceeds the ceiling" },
      "z",
      {
        enumerable: true,
        get(): never {
          getterReads += 1;
          throw new Error("later getter must not run");
        },
      },
    );

    expect(canonicalProtocolByteLengthWithin(source, 5)).toBeUndefined();
    expect(canonicalStringifyProtocolWithin(source, 5)).toBeUndefined();
    expect(getterReads).toBe(0);
  });

  it("preserves own __proto__ keys without mutating object prototypes", () => {
    const source = JSON.parse(
      '{"z":1,"__proto__":{"polluted":true},"a":2}',
    ) as Record<string, unknown>;

    const canonical = canonicalizeProtocol(source) as Record<string, unknown>;

    expect(Object.getPrototypeOf(canonical)).toBeNull();
    expect(Object.hasOwn(canonical, "__proto__")).toBe(true);
    expect(canonical.__proto__).toEqual({ polluted: true });
    expect(canonicalStringifyProtocol(source)).toBe(
      '{"__proto__":{"polluted":true},"a":2,"z":1}',
    );
    expect(canonicalStringify(source)).toBe('{"a":2,"z":1}');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("uses captured canonicalization and freezing intrinsics", () => {
    const source = {
      z: [3, 2, 1],
      a: { value: 4 },
    };
    const expected = canonicalStringifyProtocol(source);
    const originalStringify = JSON.stringify;
    const originalKeys = Object.keys;
    const originalArray = globalThis.Array;
    const originalSort = Array.prototype.sort;
    const originalFreeze = Object.freeze;
    const originalIsFrozen = Object.isFrozen;
    const originalValues = Object.values;
    let serialized: string | undefined;
    let serializedArray: string | undefined;
    const frozen = { nested: { value: true } };
    try {
      JSON.stringify = (() => '{"forged":true}') as typeof JSON.stringify;
      Object.keys = (() => []) as typeof Object.keys;
      Array.prototype.sort = function (): unknown[] {
        return [];
      } as typeof Array.prototype.sort;
      Object.freeze = ((value: object) => value) as typeof Object.freeze;
      Object.isFrozen = (() => false) as typeof Object.isFrozen;
      Object.values = (() => []) as typeof Object.values;
      globalThis.Array = (function (length: number): unknown[] {
        return new Proxy(new originalArray<unknown>(length), {
          set: () => true,
        });
      }) as ArrayConstructor;
      serialized = canonicalStringifyProtocol(source);
      serializedArray = canonicalStringifyProtocol([1, 2]);
      deepFreeze(frozen);
    } finally {
      globalThis.Array = originalArray;
      JSON.stringify = originalStringify;
      Object.keys = originalKeys;
      Array.prototype.sort = originalSort;
      Object.freeze = originalFreeze;
      Object.isFrozen = originalIsFrozen;
      Object.values = originalValues;
    }

    expect(serialized).toBe(expected);
    expect(serializedArray).toBe("[1,2]");
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
  });
});
