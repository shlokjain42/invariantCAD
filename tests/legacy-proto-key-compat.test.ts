import { describe, expect, it } from "vitest";
import { stripLegacyOwnProtoKeys } from "../src/internal/legacy-proto-key-compat.js";
import {
  NodeV7Schema,
  TopologyQuerySchema,
  TopologyQueryV1Schema,
  TopologyQueryV2Schema,
  TopologyQueryV3Schema,
  TopologyQueryV4Schema,
  TopologyQueryV5Schema,
  TopologyQueryV6Schema,
} from "../src/schema.js";
import { parseDocument, stringifyDocument } from "../src/serialization.js";
import { design } from "../src/design.js";
import { mm, vec3 } from "../src/expressions.js";

function withOwnProto<T extends object>(
  value: T,
  proto: unknown = { polluted: true },
): T {
  Object.defineProperty(value, "__proto__", {
    configurable: true,
    enumerable: true,
    value: proto,
    writable: true,
  });
  return value;
}

describe("legacy own __proto__ key compatibility", () => {
  it("returns the original input when no own enumerable __proto__ key exists", () => {
    const hidden = { nested: [{ value: 1 }] };
    Object.defineProperty(hidden, "__proto__", {
      enumerable: false,
      value: { ignored: true },
    });
    for (const value of [
      undefined,
      null,
      7,
      "text",
      { a: { b: [1, { c: 2 }] } },
      [1, [2, [3]]],
      hidden,
    ]) {
      expect(stripLegacyOwnProtoKeys(value)).toBe(value);
    }
  });

  it("strips nested keys without mutating input or invoking accessors", () => {
    let getterCalls = 0;
    const shared = withOwnProto({ shared: true });
    const accessorHost = {};
    Object.defineProperty(accessorHost, "computed", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return withOwnProto({});
      },
    });
    const sparse: unknown[] = [];
    sparse[2] = withOwnProto({ index: 2 });
    const nullPrototype = Object.assign(Object.create(null) as object, {
      flag: true,
    });
    withOwnProto(nullPrototype);
    const cycle: Record<string, unknown> = withOwnProto({});
    cycle.self = cycle;
    const root = withOwnProto({
      left: shared,
      right: shared,
      accessorHost,
      sparse,
      nullPrototype,
      frozen: Object.freeze(withOwnProto({ frozen: true })),
      cycle,
    });

    const stripped = stripLegacyOwnProtoKeys(root) as typeof root;
    expect(stripped).not.toBe(root);
    expect(Object.hasOwn(root, "__proto__")).toBe(true);
    expect(Object.hasOwn(shared, "__proto__")).toBe(true);
    for (const value of [
      stripped,
      stripped.left,
      stripped.sparse[2] as object,
      stripped.nullPrototype,
      stripped.frozen,
      stripped.cycle,
    ]) {
      expect(Object.hasOwn(value, "__proto__")).toBe(false);
    }
    expect(stripped.left).toBe(stripped.right);
    expect((stripped.cycle as Record<string, unknown>).self).toBe(stripped.cycle);
    expect(Object.getPrototypeOf(stripped)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(stripped.nullPrototype)).toBeNull();
    expect(Array.isArray(stripped.sparse)).toBe(true);
    expect(stripped.sparse).toHaveLength(3);
    expect(0 in stripped.sparse).toBe(false);
    expect(Object.isFrozen(stripped.frozen)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(stripped.frozen, "frozen")).toEqual({
      value: true,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    expect(
      Object.getOwnPropertyDescriptor(stripped.accessorHost, "computed")?.get,
    ).toBeTypeOf("function");
    expect(getterCalls).toBe(0);
  });

  it("keeps frozen topology roots and legacy text admitting own __proto__ keys", () => {
    for (const schema of [
      TopologyQueryV1Schema,
      TopologyQueryV2Schema,
      TopologyQueryV3Schema,
      TopologyQueryV4Schema,
      TopologyQueryV5Schema,
      TopologyQueryV6Schema,
      TopologyQuerySchema,
    ]) {
      const parsed = schema.safeParse(withOwnProto({ op: "all" }));
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(Object.hasOwn(parsed.data as object, "__proto__")).toBe(false);
      }
    }

    const cad = design("legacy-proto-text");
    cad.output("box", cad.box("box", { size: vec3(mm(1), mm(2), mm(3)) }));
    const canonical = stringifyDocument(cad.build());
    const hostile = canonical
      .replace("{", '{"__proto__":{"polluted":true},')
      .replace('"units":{', '"units":{"__proto__":{"polluted":true},');
    const parsed = parseDocument(hostile);
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true);
    if (parsed.ok) {
      expect(Object.hasOwn(parsed.value, "__proto__")).toBe(false);
      expect(Object.hasOwn(parsed.value.units, "__proto__")).toBe(false);
      expect(stringifyDocument(parsed.value)).toBe(canonical);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not relax the staged v7 strict grammar", () => {
    const node = withOwnProto({
      kind: "datumPoint",
      position: [0, 0, 0].map((value) => ({
        op: "literal",
        dimension: "length",
        value,
      })),
    });
    expect(NodeV7Schema.safeParse(node).success).toBe(false);
  });
});
