import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DOCUMENT_SCHEMA,
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_SCHEMA_V6,
  DOCUMENT_VERSION,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DOCUMENT_VERSION_V6,
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
  DesignDocumentV6Schema,
  PersistentTopologyReferenceV2Schema,
  PersistentTopologyReferenceV3Schema,
  PersistentTopologyReferenceV4Schema,
  PersistentTopologyReferenceV5Schema,
  PersistentTopologyReferenceV6Schema,
  TopologyQuerySchema,
  TopologyQueryV1Schema,
  TopologyQueryV2Schema,
  TopologyQueryV3Schema,
  TopologyQueryV4Schema,
  TopologyQueryV5Schema,
  TopologyQueryV6Schema,
  TopologySelectionSchema,
  TopologySelectionV1Schema,
  TopologySelectionV2Schema,
  TopologySelectionV3Schema,
  TopologySelectionV4Schema,
  TopologySelectionV5Schema,
  TopologySelectionV6Schema,
  design,
  migrateDocument,
  mm,
  parseDocumentValue,
  stringifyDocument,
  vec3,
  type DesignDocumentV5,
  type DesignDocumentV6,
  type PersistentTopologyReferenceV5,
  type PersistentTopologyReferenceV6,
  type TopologyQueryIR,
  type TopologyQueryIRV5,
  type TopologyQueryIRV6,
  type TopologySelectionIR,
  type TopologySelectionIRV5,
  type TopologySelectionIRV6,
} from "../src/index.js";

const positionQuery = {
  op: "position",
  value: [mm(0).ir, mm(0).ir, mm(0).ir],
  tolerance: mm(0.001).ir,
} as const;

const vertexSelection = {
  topology: "vertex",
  query: positionQuery,
  cardinality: { min: 1, max: 1 },
} as const;

function vertexEvidence(
  fingerprint = "invariantcad-topology-descriptor@6;vertex-fixture",
): PersistentTopologyReferenceV6<"vertex"> {
  return PersistentTopologyReferenceV6Schema.parse({
    protocolVersion: 2,
    kernelFingerprint: fingerprint,
    topology: "vertex",
    capturedHistory: "complete",
    tolerance: { linear: 1e-7, angular: 1e-7, relative: 1e-7 },
    lineage: [{ feature: "box", relation: "created" }],
    geometry: { topology: "vertex", point: [0, 0, 0] },
    adjacency: [],
  }) as PersistentTopologyReferenceV6<"vertex">;
}

function protocolV2FaceEvidence() {
  return {
    protocolVersion: 2,
    kernelFingerprint: "invariantcad-topology-descriptor@6;face-fixture",
    topology: "face",
    capturedHistory: "complete",
    tolerance: { linear: 1e-7, angular: 1e-7, relative: 1e-7 },
    lineage: [{ feature: "box", relation: "created" }],
    geometry: {
      topology: "face",
      kind: "plane",
      measure: 100,
      center: [0, 5, 5],
      bounds: { min: [0, 0, 0], max: [0, 10, 10] },
      normal: [-1, 0, 0],
    },
    adjacency: [],
  } as const;
}

function currentBox(): DesignDocumentV6 {
  const cad = design("document-v6-boundary");
  const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
  cad.output("box", box);
  return cad.build();
}

function withVertexAdjacentFillet(document: DesignDocumentV6): unknown {
  return {
    ...document,
    nodes: {
      ...document.nodes,
      rounded: {
        kind: "fillet",
        input: { node: "box", kind: "solid" },
        edges: {
          topology: "edge",
          query: { op: "adjacentTo", selection: vertexSelection },
          cardinality: { min: 1 },
        },
        radius: mm(1).ir,
      },
    },
    outputs: { rounded: { node: "rounded", kind: "solid" } },
  };
}

describe("DesignDocument v6 production boundary", () => {
  it("moves current document and topology aliases to v6", () => {
    expect(DOCUMENT_SCHEMA).toBe(DOCUMENT_SCHEMA_V6);
    expect(DOCUMENT_VERSION).toBe(DOCUMENT_VERSION_V6);
    expect(TopologyQuerySchema).toBe(TopologyQueryV6Schema);
    expect(TopologySelectionSchema).toBe(TopologySelectionV6Schema);
    expectTypeOf<TopologyQueryIR>().toEqualTypeOf<TopologyQueryIRV6>();
    expectTypeOf<TopologySelectionIR>().toEqualTypeOf<
      TopologySelectionIRV6
    >();
    expectTypeOf(currentBox()).toEqualTypeOf<DesignDocumentV6>();
  });

  it("admits position queries and vertex selections only in v6", () => {
    for (const schema of [
      TopologyQueryV1Schema,
      TopologyQueryV2Schema,
      TopologyQueryV3Schema,
      TopologyQueryV4Schema,
      TopologyQueryV5Schema,
    ]) {
      expect(schema.safeParse(positionQuery).success).toBe(false);
    }
    expect(TopologyQueryV6Schema.safeParse(positionQuery).success).toBe(true);

    for (const schema of [
      TopologySelectionV1Schema,
      TopologySelectionV2Schema,
      TopologySelectionV3Schema,
      TopologySelectionV4Schema,
      TopologySelectionV5Schema,
    ]) {
      expect(schema.safeParse(vertexSelection).success).toBe(false);
    }
    expect(TopologySelectionV6Schema.safeParse(vertexSelection).success).toBe(
      true,
    );

    if (false) {
      // @ts-expect-error Frozen document-v5 queries exclude the v6 position atom.
      const invalidQuery: TopologyQueryIRV5 = positionQuery;
      // @ts-expect-error Frozen document-v5 selections exclude vertex topology.
      const invalidSelection: TopologySelectionIRV5 = vertexSelection;
      const validQuery: TopologyQueryIRV6 = positionQuery;
      const validSelection: TopologySelectionIRV6<"vertex"> = vertexSelection;
      void [invalidQuery, invalidSelection, validQuery, validSelection];
    }
  });

  it("freezes v2-v5 to protocol-v1 face/edge evidence and enables protocol v2 in v6", () => {
    const face = protocolV2FaceEvidence();
    const vertex = vertexEvidence();
    for (const schema of [
      PersistentTopologyReferenceV2Schema,
      PersistentTopologyReferenceV3Schema,
      PersistentTopologyReferenceV4Schema,
      PersistentTopologyReferenceV5Schema,
    ]) {
      expect(schema.safeParse(face).success).toBe(false);
      expect(schema.safeParse(vertex).success).toBe(false);
    }
    expect(PersistentTopologyReferenceV6Schema.safeParse(face).success).toBe(
      true,
    );
    expect(PersistentTopologyReferenceV6Schema.safeParse(vertex).success).toBe(
      true,
    );
    expect(
      PersistentTopologyReferenceV6Schema.safeParse({
        ...vertex,
        protocolVersion: 1,
      }).success,
    ).toBe(false);

    if (false) {
      // @ts-expect-error Document-v5 persistent evidence has no vertex kind.
      const invalidV5Evidence: PersistentTopologyReferenceV5<"vertex"> =
        vertex;
      const validV6Evidence: PersistentTopologyReferenceV6<"vertex"> = vertex;
      void [invalidV5Evidence, validV6Evidence];
    }
  });

  it("accepts legal edge-vertex adjacency in a complete v6 document and rejects it in v1-v5", () => {
    const candidate = withVertexAdjacentFillet(currentBox()) as Record<
      string,
      unknown
    >;
    expect(DesignDocumentV6Schema.safeParse(candidate).success).toBe(true);
    expect(parseDocumentValue(candidate).ok).toBe(true);

    const frozenSchemas = [
      [DesignDocumentV1Schema, DOCUMENT_SCHEMA_V1, DOCUMENT_VERSION_V1],
      [DesignDocumentV2Schema, DOCUMENT_SCHEMA_V2, DOCUMENT_VERSION_V2],
      [DesignDocumentV3Schema, DOCUMENT_SCHEMA_V3, DOCUMENT_VERSION_V3],
      [DesignDocumentV4Schema, DOCUMENT_SCHEMA_V4, DOCUMENT_VERSION_V4],
      [DesignDocumentV5Schema, DOCUMENT_SCHEMA_V5, DOCUMENT_VERSION_V5],
    ] as const;
    for (const [schema, documentSchema, version] of frozenSchemas) {
      const frozenCandidate = { ...candidate, schema: documentSchema, version };
      expect(schema.safeParse(frozenCandidate).success).toBe(false);
      expect(parseDocumentValue(frozenCandidate).ok).toBe(false);
    }
  });

  it("enforces position dimensions and the face-edge-vertex adjacency matrix", () => {
    const valid = withVertexAdjacentFillet(currentBox()) as Record<string, any>;
    const positionOnEdge = structuredClone(valid);
    positionOnEdge.nodes.rounded.edges.query = positionQuery;
    const positionResult = parseDocumentValue(positionOnEdge);
    expect(positionResult.ok).toBe(false);
    if (!positionResult.ok) {
      expect(positionResult.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "TOPOLOGY_SELECTOR_INVALID",
            path: "/nodes/rounded/edges/query",
          }),
        ]),
      );
    }

    const vertexAdjacentToFace = structuredClone(valid);
    vertexAdjacentToFace.nodes.rounded.edges.query.selection.query = {
      op: "adjacentTo",
      selection: {
        topology: "face",
        query: { op: "all" },
        cardinality: { min: 1 },
      },
    };
    const adjacencyResult = parseDocumentValue(vertexAdjacentToFace);
    expect(adjacencyResult.ok).toBe(false);
    if (!adjacencyResult.ok) {
      expect(adjacencyResult.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "TOPOLOGY_SELECTOR_INVALID",
            path: "/nodes/rounded/edges/query/selection/query/selection/topology",
          }),
        ]),
      );
    }

    const scalarPosition = structuredClone(valid);
    scalarPosition.nodes.rounded.edges.query.selection.query.value[0] = {
      dimension: "scalar",
      op: "literal",
      value: 0,
    };
    const dimensionResult = parseDocumentValue(scalarPosition);
    expect(dimensionResult.ok).toBe(false);
    if (!dimensionResult.ok) {
      expect(dimensionResult.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "EXPRESSION_DIMENSION_MISMATCH",
            path: "/nodes/rounded/edges/query/selection/query/value/0",
          }),
        ]),
      );
    }
  });

  it("authors, serializes, and parses protocol-v2 vertex evidence", () => {
    const cad = design("document-v6-vertex-evidence");
    const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
    const evidence = vertexEvidence();
    const reference = cad.topologyReference("corner", box, {
      topology: "vertex",
      variants: [evidence],
    });
    cad.output("box", box);
    const document = cad.build();

    expect(reference.topology).toBe("vertex");
    expect(Object.values(document.topologyReferences ?? {})[0]?.variants[0]).toEqual(
      evidence,
    );
    const parsed = parseDocumentValue(
      JSON.parse(stringifyDocument(document)) as unknown,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.version).toBe(DOCUMENT_VERSION_V6);
      expect(
        Object.values(parsed.value.topologyReferences ?? {})[0]?.topology,
      ).toBe("vertex");
    }
  });

  it("migrates v5 evidence to v6 verbatim and is idempotent at v6", () => {
    const current = currentBox();
    const face = PersistentTopologyReferenceV5Schema.parse({
      ...protocolV2FaceEvidence(),
      protocolVersion: 1,
    }) as PersistentTopologyReferenceV5<"face">;
    const v5 = DesignDocumentV5Schema.parse({
      ...current,
      schema: DOCUMENT_SCHEMA_V5,
      version: DOCUMENT_VERSION_V5,
      topologyReferences: {
        selectedFace: {
          target: { node: "box", kind: "solid" },
          topology: "face",
          variants: [face],
        },
      },
    }) as DesignDocumentV5;
    const sourceRegistry = JSON.parse(stringifyDocument(v5)).topologyReferences;

    const migrated = migrateDocument(v5);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value).toMatchObject({
      schema: DOCUMENT_SCHEMA_V6,
      version: DOCUMENT_VERSION_V6,
    });
    expect(JSON.parse(stringifyDocument(migrated.value)).topologyReferences).toEqual(
      sourceRegistry,
    );

    const again = migrateDocument(migrated.value);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(stringifyDocument(again.value)).toBe(
        stringifyDocument(migrated.value),
      );
    }
  });
});
