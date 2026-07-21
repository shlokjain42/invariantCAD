import { describe, expect, it } from "vitest";
import {
  canonicalStringify,
  canonicalStringifyProtocol,
  canonicalizeProtocol,
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
});
