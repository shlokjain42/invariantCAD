import { describe, expect, it } from "vitest";
import {
  canonicalStringify,
  canonicalStringifyProtocol,
  canonicalizeProtocol,
  deepFreeze,
} from "../src/core/json.js";

describe("canonical JSON", () => {
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
    const originalSort = Array.prototype.sort;
    const originalFreeze = Object.freeze;
    const originalIsFrozen = Object.isFrozen;
    const originalValues = Object.values;
    let serialized: string | undefined;
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
      serialized = canonicalStringifyProtocol(source);
      deepFreeze(frozen);
    } finally {
      JSON.stringify = originalStringify;
      Object.keys = originalKeys;
      Array.prototype.sort = originalSort;
      Object.freeze = originalFreeze;
      Object.isFrozen = originalIsFrozen;
      Object.values = originalValues;
    }

    expect(serialized).toBe(expected);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
  });
});
