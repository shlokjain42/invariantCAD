import { afterEach, describe, expect, it, vi } from "vitest";

const length = (value: number) =>
  ({ op: "literal", dimension: "length", value }) as const;

function selectorDocument(
  schema: string,
  version: 6 | 7,
  kinds: readonly string[],
): unknown {
  return {
    schema,
    version,
    name: `topology-order-v${version}`,
    units: { length: "mm", angle: "rad" },
    parameters: {},
    nodes: {
      box: {
        kind: "box",
        size: [length(10), length(10), length(10)],
        center: false,
      },
      fillet: {
        kind: "fillet",
        input: { node: "box", kind: "solid" },
        edges: {
          topology: "edge",
          query: {
            op: "or",
            queries: kinds.map((kind) => ({ op: "curve", kind })),
          },
          cardinality: { min: 1 },
        },
        radius: length(1),
      },
    },
    outputs: {
      main: { node: "fillet", kind: "solid" },
    },
  };
}

function serializedCurveKinds(text: string): string[] {
  const value = JSON.parse(text) as {
    readonly nodes: {
      readonly fillet: {
        readonly edges: {
          readonly query: {
            readonly queries: readonly {
              readonly kind: string;
            }[];
          };
        };
      };
    };
  };
  return value.nodes.fillet.edges.query.queries.map((query) => query.kind);
}

const localeCompareDescriptor = Object.getOwnPropertyDescriptor(
  String.prototype,
  "localeCompare",
);

afterEach(() => {
  if (localeCompareDescriptor !== undefined) {
    Object.defineProperty(
      String.prototype,
      "localeCompare",
      localeCompareDescriptor,
    );
  }
  vi.resetModules();
});

interface SerializationComparison {
  readonly legacyCalls: number;
  readonly legacyFirst: string;
  readonly legacySecond: string;
  readonly v7Calls: number;
  readonly v7First: string;
  readonly v7Second: string;
}

async function serializeWithLocaleComparator(
  firstKinds: readonly string[],
  secondKinds: readonly string[],
  compare: (first: string, second: string) => number,
): Promise<SerializationComparison> {
  if (localeCompareDescriptor === undefined) {
    throw new TypeError("String.prototype.localeCompare must be available");
  }
  let calls = 0;
  try {
    Object.defineProperty(String.prototype, "localeCompare", {
      ...localeCompareDescriptor,
      value(this: string, other: string): number {
        calls += 1;
        return compare(this, other);
      },
    });
    vi.resetModules();
    const [
      {
        DOCUMENT_SCHEMA_V6,
        DOCUMENT_SCHEMA_V7,
      },
      {
        parseDocumentValue,
        parseDocumentValueV7,
        stringifyDocument,
        stringifyDocumentV7,
      },
    ] = await Promise.all([
      import("../src/ir.js"),
      import("../src/serialization.js"),
    ]);
    const legacyFirst = parseDocumentValue(
      selectorDocument(DOCUMENT_SCHEMA_V6, 6, firstKinds),
    );
    const legacySecond = parseDocumentValue(
      selectorDocument(DOCUMENT_SCHEMA_V6, 6, secondKinds),
    );
    const v7First = parseDocumentValueV7(
      selectorDocument(DOCUMENT_SCHEMA_V7, 7, firstKinds),
    );
    const v7Second = parseDocumentValueV7(
      selectorDocument(DOCUMENT_SCHEMA_V7, 7, secondKinds),
    );
    if (
      !legacyFirst.ok ||
      !legacySecond.ok ||
      !v7First.ok ||
      !v7Second.ok
    ) {
      throw new TypeError("Topology-order fixtures must be valid documents");
    }

    calls = 0;
    const v7FirstText = stringifyDocumentV7(v7First.value);
    const v7SecondText = stringifyDocumentV7(v7Second.value);
    const v7Calls = calls;

    calls = 0;
    const legacyFirstText = stringifyDocument(legacyFirst.value);
    const legacySecondText = stringifyDocument(legacySecond.value);
    return {
      legacyCalls: calls,
      legacyFirst: legacyFirstText,
      legacySecond: legacySecondText,
      v7Calls,
      v7First: v7FirstText,
      v7Second: v7SecondText,
    };
  } finally {
    Object.defineProperty(
      String.prototype,
      "localeCompare",
      localeCompareDescriptor,
    );
    vi.resetModules();
  }
}

describe("staged Document v7 topology-query ordering", () => {
  it("uses UTF-16 lexical order without changing the legacy comparator path", async () => {
    expect(localeCompareDescriptor).toBeDefined();
    if (localeCompareDescriptor === undefined) return;

    const kinds = ["😀", "é", "a", "中", "Z"] as const;
    const compared = await serializeWithLocaleComparator(
      kinds,
      [...kinds].reverse(),
      (first, second) =>
        first < second ? 1 : first > second ? -1 : 0,
    );

    expect(compared.v7Calls).toBe(0);
    expect(compared.v7First).toBe(compared.v7Second);
    expect(serializedCurveKinds(compared.v7First)).toEqual([
      "Z",
      "a",
      "é",
      "中",
      "😀",
    ]);
    expect(compared.legacyCalls).toBeGreaterThan(0);
    expect(compared.legacyFirst).toBe(compared.legacySecond);
    expect(serializedCurveKinds(compared.legacyFirst)).toEqual([
      "😀",
      "中",
      "é",
      "a",
      "Z",
    ]);
  });

  it("canonicalizes distinct strings even when locale collation equates them", async () => {
    expect(localeCompareDescriptor).toBeDefined();
    if (localeCompareDescriptor === undefined) return;

    const forward = ["é", "e\u0301"] as const;
    const reverse = [...forward].reverse();
    const compared = await serializeWithLocaleComparator(
      forward,
      reverse,
      () => 0,
    );

    expect(compared.v7Calls).toBe(0);
    expect(compared.v7First).toBe(compared.v7Second);
    expect(serializedCurveKinds(compared.v7First)).toEqual([
      "e\u0301",
      "é",
    ]);
    expect(compared.legacyCalls).toBeGreaterThan(0);
    expect(compared.legacyFirst).not.toBe(compared.legacySecond);
    expect(serializedCurveKinds(compared.legacyFirst)).toEqual(forward);
    expect(serializedCurveKinds(compared.legacySecond)).toEqual(reverse);
  });

  it("propagates lexical ordering through nested query selections", async () => {
    const {
      canonicalizeTopologySelectionIRV7,
    } = await import("../src/topology.js");
    const { canonicalStringify } = await import("../src/core/json.js");
    const kinds = [
      "A",
      "a",
      "-",
      "_",
      "\"",
      "\\",
      "é",
      "e\u0301",
      "中",
      "😀",
      "\ud800",
      "é",
    ];
    const queries = kinds.map((kind) => ({
      op: "curve" as const,
      kind,
    }));
    const selection = {
      topology: "edge" as const,
      query: {
        op: "and" as const,
        queries: [
          {
            op: "not" as const,
            query: {
              op: "or" as const,
              queries,
            },
          },
          {
            op: "adjacentTo" as const,
            selection: {
              topology: "edge" as const,
              query: {
                op: "or" as const,
                queries: [...queries].reverse(),
              },
              cardinality: { min: 1 },
            },
          },
        ],
      },
      cardinality: { min: 1 },
    };
    const expected = [
      ...new Map(
        queries.map((query) => [canonicalStringify(query), query.kind]),
      ).entries(),
    ]
      .sort(([first], [second]) =>
        first < second ? -1 : first > second ? 1 : 0,
      )
      .map(([, kind]) => kind);

    const normalized = canonicalizeTopologySelectionIRV7(selection);
    expect(normalized.query.op).toBe("and");
    if (normalized.query.op !== "and") return;
    const negated = normalized.query.queries.find(
      (query) => query.op === "not",
    );
    const adjacent = normalized.query.queries.find(
      (query) => query.op === "adjacentTo",
    );
    expect(negated?.op).toBe("not");
    expect(adjacent?.op).toBe("adjacentTo");
    if (
      negated?.op !== "not" ||
      negated.query.op !== "or" ||
      adjacent?.op !== "adjacentTo" ||
      adjacent.selection.query.op !== "or"
    ) {
      return;
    }
    expect(
      negated.query.queries.map((query) =>
        query.op === "curve" ? query.kind : "",
      ),
    ).toEqual(expected);
    expect(
      adjacent.selection.query.queries.map((query) =>
        query.op === "curve" ? query.kind : "",
      ),
    ).toEqual(expected);
  });
});
