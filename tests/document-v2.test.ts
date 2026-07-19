import { describe, expect, it } from "vitest";
import { nodeId, topologyReferenceId } from "../src/core/ids.js";
import { design } from "../src/design.js";
import { mm } from "../src/expressions.js";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  type DesignDocumentV1,
  type DesignDocumentV2,
  type TopologyQueryIRV1,
} from "../src/ir.js";
import {
  cloneDocument,
  hashDocument,
  migrateDocument,
  parseDocument,
  parseDocumentValue,
  stringifyDocument,
} from "../src/serialization.js";
import {
  DesignDocumentSchema,
  DesignDocumentV1Schema,
  TopologyQuerySchema,
  TopologyQueryV1Schema,
  TopologyQueryV2Schema,
} from "../src/schema.js";
import type {
  PersistentTopologyReference,
  TopologyMatchTolerance,
} from "../src/topology-signatures.js";
import type { CadResult, Diagnostic } from "../src/core/result.js";

const tolerance: TopologyMatchTolerance = Object.freeze({
  linear: 1e-7,
  angular: 1e-5,
  relative: 1e-7,
});

function faceReference(
  kernelFingerprint: string,
): PersistentTopologyReference<"face"> {
  return {
    protocolVersion: 1,
    kernelFingerprint,
    topology: "face",
    capturedHistory: "complete",
    tolerance,
    lineage: [
      {
        feature: "box",
        relation: "created",
        role: "box.face.x-min",
      },
    ],
    geometry: {
      topology: "face",
      kind: "plane",
      measure: 100,
      center: [0, 5, 5],
      bounds: { min: [0, 0, 0], max: [0, 10, 10] },
      normal: [-1, 0, 0],
    },
    adjacency: [
      {
        topology: "edge",
        lineage: [
          {
            feature: "box",
            relation: "created",
            role: "box.edge.x-min-y-min",
          },
        ],
        geometry: {
          topology: "edge",
          kind: "line",
          measure: 10,
          center: [0, 0, 5],
          bounds: { min: [0, 0, 0], max: [0, 0, 10] },
          direction: [0, 0, 1],
        },
      },
    ],
  };
}

function edgeReference(
  kernelFingerprint: string,
): PersistentTopologyReference<"edge"> {
  return {
    protocolVersion: 1,
    kernelFingerprint,
    topology: "edge",
    capturedHistory: "complete",
    tolerance,
    lineage: [
      {
        feature: "box",
        relation: "created",
        role: "box.edge.x-min-y-min",
      },
    ],
    geometry: {
      topology: "edge",
      kind: "line",
      measure: 10,
      center: [0, 0, 5],
      bounds: { min: [0, 0, 0], max: [0, 0, 10] },
      direction: [0, 0, 1],
    },
    adjacency: [],
  };
}

function baseV2(name = "document-v2"): DesignDocumentV2 {
  const cad = design(name);
  const box = cad.box("box", {
    size: [mm(10), mm(10), mm(10)],
  });
  cad.output("box", box);
  const document = cad.build();
  if (document.version !== DOCUMENT_VERSION_V2) {
    throw new TypeError("The current authoring API did not emit document v2");
  }
  return document;
}

function legacyV1(): DesignDocumentV1 {
  const cad = design("canonical");
  const box = cad.box("box", {
    size: [mm(10), mm(10), mm(10)],
  });
  const sphere = cad.sphere("sphere", { radius: mm(2) });
  const result = cad.subtract("result", box, [sphere]);
  cad.output("result", result);
  const document = cad.build();
  if (document.version !== DOCUMENT_VERSION_V2) {
    throw new TypeError("The current authoring API did not emit document v2");
  }
  const { topologyReferences: _topologyReferences, ...body } = document;
  const legacy = DesignDocumentV1Schema.safeParse({
    ...body,
    schema: DOCUMENT_SCHEMA_V1,
    version: DOCUMENT_VERSION_V1,
  });
  if (!legacy.success) {
    throw new TypeError(`Legacy fixture is invalid: ${legacy.error.message}`);
  }
  return legacy.data;
}

function withFaceRegistry(
  variants: readonly PersistentTopologyReference<"face">[] = [
    faceReference("test-kernel/z"),
    faceReference("test-kernel/a"),
  ],
): DesignDocumentV2 {
  return {
    ...baseV2(),
    topologyReferences: {
      [topologyReferenceId("selectedFace")]: {
        target: { node: nodeId("box"), kind: "solid" },
        topology: "face",
        variants,
      },
    },
  };
}

function mutable<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}

function diagnostics<T>(result: CadResult<T>): readonly Diagnostic[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.diagnostics;
}

function expectLimit<T>(result: CadResult<T>, resource: string): void {
  expect(diagnostics(result)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "IR_INVALID",
        details: expect.objectContaining({ resource }),
      }),
    ]),
  );
}

describe("DesignDocument v2 serialization", () => {
  it("preserves legacy v1 parsing, serialization, cloning, and semantic hashes", async () => {
    const source = legacyV1();
    const serialized = stringifyDocument(source);
    const parsed = parseDocument(serialized);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.version).toBe(DOCUMENT_VERSION_V1);
    expect(parsed.value.schema).toBe(DOCUMENT_SCHEMA_V1);
    expect(stringifyDocument(parsed.value)).toBe(serialized);

    const cloned = cloneDocument(parsed.value);
    expect(cloned).toEqual(parsed.value);
    expect(cloned.version).toBe(DOCUMENT_VERSION_V1);
    expect(Object.isFrozen(cloned)).toBe(true);
    expect(await hashDocument(parsed.value)).toBe(
      "3fbe5c59c8de1daaaf6146c2875c491817533f5818059a0c58be0d32fdb34565",
    );
  });

  it("validates before migrating v1 to v2 and treats v2 migration as idempotent", () => {
    const source = legacyV1();
    const migrated = migrateDocument(source);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value).toEqual({
      ...source,
      schema: DOCUMENT_SCHEMA_V2,
      version: DOCUMENT_VERSION_V2,
    });
    expect(Object.isFrozen(migrated.value)).toBe(true);

    const repeated = migrateDocument(migrated.value);
    expect(repeated).toEqual({
      ok: true,
      value: migrated.value,
      diagnostics: [],
    });

    const invalid = mutable(source);
    invalid.outputs.result.node = "missing";
    expect(
      diagnostics(migrateDocument(invalid)).some(
        (item) => item.code === "REFERENCE_MISSING",
      ),
    ).toBe(true);
  });

  it("round-trips, deeply freezes, and canonically orders a v2 registry", async () => {
    const source = withFaceRegistry();
    const canonical = stringifyDocument(source);
    const parsed = parseDocument(canonical);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.version !== DOCUMENT_VERSION_V2) return;
    expect(stringifyDocument(parsed.value)).toBe(canonical);

    const registry = parsed.value.topologyReferences!;
    const entry = registry[topologyReferenceId("selectedFace")]!;
    expect(entry.variants.map((variant) => variant.kernelFingerprint)).toEqual([
      "test-kernel/a",
      "test-kernel/z",
    ]);
    for (const value of [
      parsed.value,
      registry,
      entry,
      entry.target,
      entry.variants,
      entry.variants[0],
      entry.variants[0]!.geometry,
      entry.variants[0]!.geometry.bounds,
      entry.variants[0]!.geometry.bounds.min,
      entry.variants[0]!.adjacency,
      entry.variants[0]!.adjacency[0],
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }

    const reversed = withFaceRegistry([
      faceReference("test-kernel/a"),
      faceReference("test-kernel/z"),
    ]);
    expect(stringifyDocument(reversed)).toBe(canonical);
    expect(await hashDocument(reversed)).toBe(await hashDocument(source));
    expect(await hashDocument(source)).not.toBe(await hashDocument(baseV2()));
  });

  it("rejects registry data and nested persistent selectors in v1", () => {
    const legacy = mutable(legacyV1());
    legacy.topologyReferences = {};
    expect(parseDocumentValue(legacy).ok).toBe(false);

    const selected = mutable(legacyV1());
    selected.nodes.fillet = {
      kind: "fillet",
      input: { node: "box", kind: "solid" },
      edges: {
        topology: "edge",
        query: { op: "persistentReference", reference: "storedEdge" },
        cardinality: { min: 1, max: 1 },
      },
      radius: mm(1).ir,
    };
    expect(diagnostics(parseDocumentValue(selected))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "IR_INVALID",
          path: "/nodes/fillet/edges/query/op",
        }),
      ]),
    );
    expect(DesignDocumentV1Schema.safeParse(selected).success).toBe(false);
    expect(DesignDocumentSchema.safeParse(selected).success).toBe(false);

    const persistentQuery = {
      op: "persistentReference",
      reference: topologyReferenceId("storedEdge"),
    } as const;
    expect(TopologyQueryV1Schema.safeParse(persistentQuery).success).toBe(false);
    expect(TopologyQueryV2Schema.safeParse(persistentQuery).success).toBe(true);

    // @ts-expect-error document v1 has no persistent-reference query atom
    const _invalidV1Query: TopologyQueryIRV1 = persistentQuery;
  });

  it("keeps every new v2 object boundary strict", () => {
    const unknownRoot = mutable(baseV2());
    unknownRoot.future = true;
    expect(parseDocumentValue(unknownRoot).ok).toBe(false);

    expect(
      TopologyQuerySchema.safeParse({
        op: "persistentReference",
        reference: "selectedFace",
        future: true,
      }).success,
    ).toBe(false);

    const unknownEntry = mutable(withFaceRegistry());
    unknownEntry.topologyReferences.selectedFace.future = true;
    expect(parseDocumentValue(unknownEntry).ok).toBe(false);

    const unknownTarget = mutable(withFaceRegistry());
    unknownTarget.topologyReferences.selectedFace.target.future = true;
    expect(parseDocumentValue(unknownTarget).ok).toBe(false);

    const unknownEvidence = mutable(withFaceRegistry());
    unknownEvidence.topologyReferences.selectedFace.variants[0].geometry.future =
      true;
    expect(parseDocumentValue(unknownEvidence).ok).toBe(false);
  });

  it("treats a missing prototype-named persistent reference as missing", () => {
    const document = mutable(withFaceRegistry());
    document.nodes.shell = {
      kind: "shell",
      input: { node: "box", kind: "solid" },
      openings: {
        topology: "face",
        query: { op: "persistentReference", reference: "toString" },
        cardinality: { min: 1, max: 1 },
      },
      thickness: mm(1).ir,
      direction: "inward",
      tolerance: mm(0.01).ir,
    };

    let result: ReturnType<typeof parseDocumentValue> | undefined;
    expect(() => {
      result = parseDocumentValue(document);
    }).not.toThrow();
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "REFERENCE_MISSING",
          path: "/nodes/shell/openings/query/reference",
          details: { reference: "toString" },
        },
      ],
    });
  });

  it("treats a missing prototype-named topology origin as missing", () => {
    const document = mutable(baseV2());
    document.nodes.fillet = {
      kind: "fillet",
      input: { node: "box", kind: "solid" },
      edges: {
        topology: "edge",
        query: {
          op: "origin",
          feature: "toString",
          relation: "created",
        },
        cardinality: { min: 1 },
      },
      radius: mm(1).ir,
    };

    expect(diagnostics(parseDocumentValue(document))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_MISSING",
          path: "/nodes/fillet/edges/query/feature",
        }),
      ]),
    );
  });

  it("treats a prototype-named persistent target node as missing", () => {
    const document = mutable(withFaceRegistry());
    document.topologyReferences.selectedFace.target.node = "toString";

    let result: ReturnType<typeof parseDocumentValue> | undefined;
    expect(() => {
      result = parseDocumentValue(document);
    }).not.toThrow();
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "REFERENCE_MISSING",
          path: "/topologyReferences/selectedFace/target/node",
        },
      ],
    });
  });

  it("rejects empty, duplicate, and topology-mismatched registry variants", () => {
    const emptyRegistry = mutable(baseV2());
    emptyRegistry.topologyReferences = {};
    expect(parseDocumentValue(emptyRegistry).ok).toBe(false);

    const emptyVariants = mutable(withFaceRegistry());
    emptyVariants.topologyReferences.selectedFace.variants = [];
    expect(parseDocumentValue(emptyVariants).ok).toBe(false);

    const duplicate = mutable(withFaceRegistry([
      faceReference("same-fingerprint"),
      faceReference("same-fingerprint"),
    ]));
    expect(diagnostics(parseDocumentValue(duplicate))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "IR_INVALID",
          path: expect.stringContaining("/variants/1/kernelFingerprint"),
        }),
      ]),
    );

    const mismatched = mutable(withFaceRegistry());
    mismatched.topologyReferences.selectedFace.variants = [
      edgeReference("test-kernel/edge"),
    ];
    expect(diagnostics(parseDocumentValue(mismatched))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "IR_INVALID",
          path: expect.stringContaining("/variants/0/topology"),
        }),
      ]),
    );
  });

  it("enforces UTF-8 byte, structural, and nesting limits before parsing", () => {
    const unicode = baseV2("é");
    const text = stringifyDocument(unicode);
    const bytes = new TextEncoder().encode(text).byteLength;
    expect(bytes).toBeGreaterThan(text.length);
    expectLimit(
      parseDocument(text, { limits: { maxDocumentBytes: bytes - 1 } }),
      "maxDocumentBytes",
    );
    expectLimit(
      parseDocumentValue(unicode, { limits: { maxStructuralValues: 0 } }),
      "maxStructuralValues",
    );
    expectLimit(
      parseDocumentValue(unicode, { limits: { maxNestingDepth: 0 } }),
      "maxNestingDepth",
    );
  });

  it("enforces query, registry, variant, adjacency, and evidence limits", () => {
    const queried = mutable(baseV2());
    queried.nodes.fillet = {
      kind: "fillet",
      input: { node: "box", kind: "solid" },
      edges: {
        topology: "edge",
        query: { op: "persistentReference", reference: "storedEdge" },
        cardinality: { min: 1, max: 1 },
      },
      radius: mm(1).ir,
    };
    queried.topologyReferences = {
      storedEdge: {
        target: { node: "box", kind: "solid" },
        topology: "edge",
        variants: [edgeReference("test-kernel/edge")],
      },
    };
    expectLimit(
      parseDocumentValue(queried, { limits: { maxTopologyQueryNodes: 0 } }),
      "maxTopologyQueryNodes",
    );

    const registered = withFaceRegistry([faceReference("test-kernel/face")]);
    expectLimit(
      parseDocumentValue(registered, {
        limits: { maxTopologyReferences: 0 },
      }),
      "maxTopologyReferences",
    );
    expectLimit(
      parseDocumentValue(registered, {
        limits: { maxTopologyReferenceVariants: 0 },
      }),
      "maxTopologyReferenceVariants",
    );
    expectLimit(
      parseDocumentValue(registered, {
        limits: { maxStoredAdjacencyLinks: 0 },
      }),
      "maxStoredAdjacencyLinks",
    );
    expectLimit(
      parseDocumentValue(registered, {
        limits: { maxStoredEvidenceRecords: 0 },
      }),
      "maxStoredEvidenceRecords",
    );
  });

  it("counts only real selector queries and expands shared query occurrences", () => {
    const metadataOnly = mutable(baseV2());
    metadataOnly.metadata = { nested: { op: "all" } };
    expect(
      parseDocumentValue(metadataOnly, {
        limits: { maxTopologyQueryNodes: 0 },
      }).ok,
    ).toBe(true);

    const shared = mutable(baseV2());
    let query: any = { op: "all" };
    for (let depth = 0; depth < 12; depth += 1) {
      query = { op: "and", queries: [query, query] };
    }
    shared.nodes.fillet = {
      kind: "fillet",
      input: { node: "box", kind: "solid" },
      edges: {
        topology: "edge",
        query,
        cardinality: { min: 1 },
      },
      radius: mm(1).ir,
    };
    expectLimit(
      parseDocumentValue(shared, {
        limits: { maxTopologyQueryNodes: 100 },
      }),
      "maxTopologyQueryNodes",
    );
    expectLimit(
      parseDocumentValue(shared, {
        limits: {
          maxStructuralValues: 100,
          maxTopologyQueryNodes: 100_000,
        },
      }),
      "maxStructuralValues",
    );
  });

  it("parses one-read snapshots instead of re-reading stateful getters", () => {
    const statefulRoot = mutable(baseV2());
    statefulRoot.outputs = {};
    let nodeReads = 0;
    Object.defineProperty(statefulRoot, "nodes", {
      enumerable: true,
      get(): Record<string, unknown> {
        nodeReads += 1;
        return nodeReads === 1
          ? {}
          : Object.fromEntries(
              Array.from({ length: 1_000 }, (_, index) => [
                `box-${index}`,
                mutable(baseV2()).nodes.box,
              ]),
            );
      },
    });
    const rootResult = parseDocumentValue(statefulRoot, {
      limits: { maxStructuralValues: 50 },
    });
    expect(rootResult.ok).toBe(true);
    expect(nodeReads).toBe(1);
    if (rootResult.ok) expect(rootResult.value.nodes).toEqual({});

    const statefulQuery = mutable(baseV2());
    let queryReads = 0;
    const compoundQuery = { op: "and" } as Record<string, unknown>;
    Object.defineProperty(compoundQuery, "queries", {
      enumerable: true,
      get(): readonly unknown[] {
        queryReads += 1;
        return queryReads === 1
          ? [{ op: "all" }]
          : Array.from({ length: 50_000 }, () => ({ op: "all" }));
      },
    });
    statefulQuery.nodes.fillet = {
      kind: "fillet",
      input: { node: "box", kind: "solid" },
      edges: {
        topology: "edge",
        query: compoundQuery,
        cardinality: { min: 1 },
      },
      radius: mm(1).ir,
    };
    expect(
      parseDocumentValue(statefulQuery, {
        limits: {
          maxStructuralValues: 200,
          maxTopologyQueryNodes: 10,
        },
      }).ok,
    ).toBe(true);
    expect(queryReads).toBe(1);
  });

  it("rejects forged array lengths before reading any indexed values", () => {
    let indexReads = 0;
    const forged = new Proxy([], {
      get(target, property, receiver): unknown {
        if (property === "length") return 0xffff_ffff;
        if (typeof property === "string" && /^\d+$/.test(property)) {
          indexReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
      getOwnPropertyDescriptor(target, property): PropertyDescriptor | undefined {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          return { configurable: true, enumerable: true, value: undefined };
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    expectLimit(
      parseDocumentValue(forged, { limits: { maxStructuralValues: 10 } }),
      "maxStructuralValues",
    );
    expect(indexReads).toBe(0);
  });

  it("contains sparse, cyclic, deep, revoked, and hostile values in CadResult", () => {
    const sparse = new Array(1);
    expect(() => parseDocumentValue(sparse)).not.toThrow();
    expect(diagnostics(parseDocumentValue(sparse))[0]?.message).toContain(
      "sparse",
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => parseDocumentValue(cyclic)).not.toThrow();
    expect(diagnostics(parseDocumentValue(cyclic))[0]?.message).toContain(
      "cycles",
    );

    let deep: Record<string, unknown> = {};
    const deepRoot = deep;
    for (let index = 0; index < 200; index += 1) {
      const child: Record<string, unknown> = {};
      deep.child = child;
      deep = child;
    }
    expect(() => parseDocumentValue(deepRoot)).not.toThrow();
    expectLimit(parseDocumentValue(deepRoot), "maxNestingDepth");

    const hostile = Object.defineProperty({}, "schema", {
      enumerable: true,
      get(): never {
        throw new Error("hostile getter");
      },
    });
    expect(() => parseDocumentValue(hostile)).not.toThrow();
    expect(diagnostics(parseDocumentValue(hostile))[0]?.message).toContain(
      "hostile getter",
    );

    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    expect(() => parseDocumentValue(revocable.proxy)).not.toThrow();
    expect(parseDocumentValue(revocable.proxy).ok).toBe(false);
  });
});
