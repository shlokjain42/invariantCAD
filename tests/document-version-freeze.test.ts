import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DOCUMENT_SCHEMA,
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_VERSION,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  NodeSchema,
  NodeV1Schema,
  NodeV2Schema,
  NodeV3Schema,
  PersistentTopologyReferenceV2Schema,
  design,
  migrateDocument,
  mm,
  parseDocumentValue,
  stringifyDocument,
  vec3,
  type DesignDocumentV1,
  type DesignDocumentV2,
  type DesignDocumentV3,
  type NodeIR,
  type NodeIRV1,
  type NodeIRV2,
  type NodeIRV3,
  type PersistentTopologyReferenceV2,
} from "../src/index.js";

const frozenNodeKinds = [
  "assembly",
  "boolean",
  "box",
  "chamfer",
  "circularArcPath",
  "compositePath",
  "cylinder",
  "draft",
  "extrude",
  "fillet",
  "loft",
  "offset",
  "part",
  "polylinePath",
  "revolve",
  "shell",
  "sketch",
  "sphere",
  "sweep",
  "transform",
] as const;

const frozenV1DocumentFields = [
  "configurations",
  "materials",
  "metadata",
  "name",
  "nodes",
  "outputs",
  "parameters",
  "schema",
  "units",
  "version",
] as const;

const frozenV2V3DocumentFields = [
  ...frozenV1DocumentFields,
  "topologyReferences",
].sort();

type FrozenNodeKind = (typeof frozenNodeKinds)[number];
type FrozenDocumentField =
  | (typeof frozenV1DocumentFields)[number]
  | "topologyReferences";

const expectedV1Bytes =
  '{"name":"document-version-freeze","nodes":{"box":{"center":false,"kind":"box","size":[{"dimension":"length","op":"literal","value":10},{"dimension":"length","op":"literal","value":20},{"dimension":"length","op":"literal","value":30}]}},"outputs":{"box":{"kind":"solid","node":"box"}},"parameters":{},"schema":"https://invariantcad.dev/schema/document/v1","units":{"angle":"rad","length":"mm"},"version":1}';
const expectedV2Bytes =
  '{"name":"document-version-freeze","nodes":{"box":{"center":false,"kind":"box","size":[{"dimension":"length","op":"literal","value":10},{"dimension":"length","op":"literal","value":20},{"dimension":"length","op":"literal","value":30}]}},"outputs":{"box":{"kind":"solid","node":"box"}},"parameters":{},"schema":"https://invariantcad.dev/schema/document/v2","units":{"angle":"rad","length":"mm"},"version":2}';

type RuntimeSchema = {
  readonly safeParse: (value: unknown) => { readonly success: boolean };
};

type NodeUnionOption = {
  readonly shape?: {
    readonly kind?: { readonly value?: unknown };
  };
};

function nodeKinds(schema: unknown): readonly string[] {
  const options = (schema as { readonly options?: readonly NodeUnionOption[] })
    .options;
  if (options === undefined) {
    throw new TypeError("Expected a public discriminated-union node schema");
  }
  return options
    .map((option) => option.shape?.kind?.value)
    .map((kind) => {
      if (typeof kind !== "string") {
        throw new TypeError(
          "Expected every node variant to have one literal kind",
        );
      }
      return kind;
    })
    .sort();
}

function documentFields(schema: unknown): readonly string[] {
  const shape = (schema as {
    readonly shape?: Readonly<Record<string, unknown>>;
  }).shape;
  if (shape === undefined) {
    throw new TypeError("Expected a public object document schema");
  }
  return Object.keys(shape).sort();
}

function currentBox(): DesignDocumentV3 {
  const cad = design("document-version-freeze");
  const box = cad.box("box", { size: vec3(mm(10), mm(20), mm(30)) });
  cad.output("box", box);
  return cad.build();
}

function versionedDocuments(): {
  readonly v1: DesignDocumentV1;
  readonly v2: DesignDocumentV2;
  readonly v3: DesignDocumentV3;
} {
  const v3 = currentBox();
  const { topologyReferences: _topologyReferences, ...body } = v3;
  return {
    v1: DesignDocumentV1Schema.parse({
      ...body,
      schema: DOCUMENT_SCHEMA_V1,
      version: DOCUMENT_VERSION_V1,
    }),
    v2: DesignDocumentV2Schema.parse({
      ...body,
      schema: DOCUMENT_SCHEMA_V2,
      version: DOCUMENT_VERSION_V2,
    }),
    v3,
  };
}

function versionCases(): readonly {
  readonly label: string;
  readonly schema: RuntimeSchema;
  readonly document: DesignDocumentV1 | DesignDocumentV2 | DesignDocumentV3;
}[] {
  const documents = versionedDocuments();
  return [
    { label: "v1", schema: DesignDocumentV1Schema, document: documents.v1 },
    { label: "v2", schema: DesignDocumentV2Schema, document: documents.v2 },
    { label: "v3", schema: DesignDocumentV3Schema, document: documents.v3 },
  ];
}

function mutable(value: unknown): Record<string, any> {
  return JSON.parse(JSON.stringify(value)) as Record<string, any>;
}

function legacyFaceEvidence(): PersistentTopologyReferenceV2<"face"> {
  return PersistentTopologyReferenceV2Schema.parse({
    protocolVersion: 1,
    kernelFingerprint: "invariantcad-topology-descriptor@2;freeze-fixture",
    topology: "face",
    capturedHistory: "complete",
    tolerance: { linear: 1e-7, angular: 1e-7, relative: 1e-7 },
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
      measure: 600,
      center: [0, 10, 15],
      bounds: { min: [0, 0, 0], max: [0, 20, 30] },
      normal: [-1, 0, 0],
    },
    adjacency: [],
  }) as PersistentTopologyReferenceV2<"face">;
}

function withoutEnvelope(serialized: string): Readonly<Record<string, unknown>> {
  const { schema: _schema, version: _version, ...body } = JSON.parse(
    serialized,
  ) as Record<string, unknown>;
  return body;
}

describe("frozen document-version grammar", () => {
  it("pins exact node-kind membership independently for v1, v2, and v3", () => {
    expect(nodeKinds(NodeV1Schema)).toEqual(frozenNodeKinds);
    expect(nodeKinds(NodeV2Schema)).toEqual(frozenNodeKinds);
    expect(nodeKinds(NodeV3Schema)).toEqual(frozenNodeKinds);
  });

  it("pins exact top-level document fields independently for every version", () => {
    expect(documentFields(DesignDocumentV1Schema)).toEqual(
      frozenV1DocumentFields,
    );
    expect(documentFields(DesignDocumentV2Schema)).toEqual(
      frozenV2V3DocumentFields,
    );
    expect(documentFields(DesignDocumentV3Schema)).toEqual(
      frozenV2V3DocumentFields,
    );
  });

  it.each(versionCases())(
    "$label rejects an unknown future node kind through its schema and parser",
    ({ schema, document }) => {
      const future = mutable(document);
      future.nodes.futureFeature = {
        kind: "futureFeature",
        input: { node: "box", kind: "solid" },
      };

      expect(schema.safeParse(future).success).toBe(false);
      expect(parseDocumentValue(future).ok).toBe(false);
    },
  );

  it.each(versionCases())(
    "$label rejects an unknown future document-body field through its schema and parser",
    ({ schema, document }) => {
      const future = mutable(document);
      future.futureDocumentField = { enabled: true };

      expect(schema.safeParse(future).success).toBe(false);
      expect(parseDocumentValue(future).ok).toBe(false);
    },
  );

  it("keeps all current runtime and authoring aliases on document v3", () => {
    expect(DOCUMENT_SCHEMA).toBe(DOCUMENT_SCHEMA_V3);
    expect(DOCUMENT_VERSION).toBe(DOCUMENT_VERSION_V3);
    expect(NodeSchema).toBe(NodeV3Schema);

    const cad = design("current-version-type-probe");
    const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
    cad.output("box", box);
    const built = cad.build();
    expectTypeOf<NodeIR>().toEqualTypeOf<NodeIRV3>();
    expectTypeOf<NodeIRV1["kind"]>().toEqualTypeOf<FrozenNodeKind>();
    expectTypeOf<NodeIRV2["kind"]>().toEqualTypeOf<FrozenNodeKind>();
    expectTypeOf<NodeIRV3["kind"]>().toEqualTypeOf<FrozenNodeKind>();
    expectTypeOf<keyof DesignDocumentV1>().toEqualTypeOf<FrozenDocumentField>();
    expectTypeOf<keyof DesignDocumentV2>().toEqualTypeOf<FrozenDocumentField>();
    expectTypeOf<keyof DesignDocumentV3>().toEqualTypeOf<FrozenDocumentField>();
    expectTypeOf(built).toEqualTypeOf<DesignDocumentV3>();
    expect(built).toMatchObject({
      schema: DOCUMENT_SCHEMA_V3,
      version: DOCUMENT_VERSION_V3,
    });
  });

  it("keeps legacy canonical bytes stable and migration body data unchanged", () => {
    const { v1, v2 } = versionedDocuments();
    expect(stringifyDocument(v1)).toBe(expectedV1Bytes);
    expect(stringifyDocument(v2)).toBe(expectedV2Bytes);

    for (const source of [v1, v2]) {
      const sourceBytes = stringifyDocument(source);
      const migrated = migrateDocument(source);
      expect(migrated.ok).toBe(true);
      expect(stringifyDocument(source)).toBe(sourceBytes);
      if (!migrated.ok) continue;
      expect(withoutEnvelope(stringifyDocument(migrated.value))).toEqual(
        withoutEnvelope(sourceBytes),
      );
    }
  });

  it("preserves explicitly present undefined optional fields during migration", () => {
    const { v1, v2 } = versionedDocuments();
    const sources = [
      DesignDocumentV1Schema.parse({
        ...v1,
        materials: undefined,
        configurations: undefined,
        metadata: undefined,
      }),
      DesignDocumentV2Schema.parse({
        ...v2,
        materials: undefined,
        configurations: undefined,
        metadata: undefined,
        topologyReferences: undefined,
      }),
    ] as const;

    for (const source of sources) {
      const optionalFields = [
        "materials",
        "configurations",
        "metadata",
        ...(source.version === DOCUMENT_VERSION_V2
          ? (["topologyReferences"] as const)
          : []),
      ] as const;
      const migrated = migrateDocument(source);
      expect(migrated.ok).toBe(true);
      if (!migrated.ok) continue;

      for (const field of optionalFields) {
        expect(Object.hasOwn(source, field)).toBe(true);
        expect(Object.hasOwn(migrated.value, field)).toBe(true);
        expect(migrated.value[field]).toBeUndefined();
      }
    }
  });

  it("preserves v2 persistent evidence exactly while migrating its envelope", () => {
    const { v2 } = versionedDocuments();
    const evidence = legacyFaceEvidence();
    const source = DesignDocumentV2Schema.parse({
      ...v2,
      topologyReferences: {
        selectedFace: {
          target: { node: "box", kind: "solid" },
          topology: "face",
          variants: [evidence],
        },
      },
    });
    const sourceBytes = stringifyDocument(source);
    const sourceRegistry = JSON.parse(sourceBytes).topologyReferences;

    const migrated = migrateDocument(source);
    expect(migrated.ok).toBe(true);
    expect(stringifyDocument(source)).toBe(sourceBytes);
    if (!migrated.ok) return;

    expect(migrated.value).toMatchObject({
      schema: DOCUMENT_SCHEMA_V3,
      version: DOCUMENT_VERSION_V3,
    });
    expect(
      JSON.parse(stringifyDocument(migrated.value)).topologyReferences,
    ).toEqual(sourceRegistry);
    expect(
      Object.values(migrated.value.topologyReferences ?? {})[0]?.variants[0],
    ).toEqual(evidence);
  });

  it("keeps future node kinds and body fields outside the public versioned types", () => {
    const { v1, v2, v3 } = versionedDocuments();
    const futureNode = { kind: "futureFeature" } as const;

    if (false) {
      // @ts-expect-error Document-v1 node membership is closed.
      const invalidV1Node: NodeIRV1 = futureNode;
      // @ts-expect-error Document-v2 node membership is closed.
      const invalidV2Node: NodeIRV2 = futureNode;
      // @ts-expect-error Document-v3 node membership is closed.
      const invalidV3Node: NodeIRV3 = futureNode;

      const invalidV1Document: DesignDocumentV1 = {
        ...v1,
        // @ts-expect-error Document-v1 has no future body field.
        futureDocumentField: true,
      };
      const invalidV2Document: DesignDocumentV2 = {
        ...v2,
        // @ts-expect-error Document-v2 has no future body field.
        futureDocumentField: true,
      };
      const invalidV3Document: DesignDocumentV3 = {
        ...v3,
        // @ts-expect-error Document-v3 has no future body field.
        futureDocumentField: true,
      };
      void [
        invalidV1Document,
        invalidV1Node,
        invalidV2Document,
        invalidV2Node,
        invalidV3Document,
        invalidV3Node,
      ];
    }

    expect(v3.version).toBe(DOCUMENT_VERSION_V3);
  });
});
