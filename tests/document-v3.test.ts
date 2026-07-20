import { describe, expect, it } from "vitest";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_VERSION,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V5,
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  PersistentTopologyReferenceV2Schema,
  PersistentTopologyReferenceV3Schema,
  TOPOLOGY_ROLES_V1,
  TOPOLOGY_ROLES_V2,
  TOPOLOGY_ROLES_V3,
  TopologyQueryV1Schema,
  TopologyQueryV2Schema,
  TopologyQueryV3Schema,
  design,
  hashDocument,
  migrateDocument,
  mm,
  parseDocumentValue,
  plane,
  stringifyDocument,
  topology,
  vec3,
  type DesignDocumentV1,
  type DesignDocumentV2,
  type DesignDocumentV3,
  type NodeIRV2,
  type NodeIRV3,
  type PersistentTopologyReferenceV2,
  type PersistentTopologyReferenceV3,
  type TopologyQueryIRV2,
  type TopologyQueryIRV3,
  type TopologySelectionIRV2,
  type TopologySelectionIRV3,
  type TopologyRoleV3,
} from "../src/index.js";

const loftRoles = [
  "loft.face.start-cap",
  "loft.face.end-cap",
  "loft.face.side",
  "loft.edge.section-rim",
  "loft.edge.lateral",
] as const satisfies readonly TopologyRoleV3[];

const expectedV1 =
  '{"name":"document-version-fixture","nodes":{"box":{"center":false,"kind":"box","size":[{"dimension":"length","op":"literal","value":10},{"dimension":"length","op":"literal","value":20},{"dimension":"length","op":"literal","value":30}]}},"outputs":{"box":{"kind":"solid","node":"box"}},"parameters":{},"schema":"https://invariantcad.dev/schema/document/v1","units":{"angle":"rad","length":"mm"},"version":1}';
const expectedV2 =
  '{"name":"document-version-fixture","nodes":{"box":{"center":false,"kind":"box","size":[{"dimension":"length","op":"literal","value":10},{"dimension":"length","op":"literal","value":20},{"dimension":"length","op":"literal","value":30}]}},"outputs":{"box":{"kind":"solid","node":"box"}},"parameters":{},"schema":"https://invariantcad.dev/schema/document/v2","units":{"angle":"rad","length":"mm"},"version":2}';

function legacyV3Box(): DesignDocumentV3 {
  const cad = design("document-version-fixture");
  const box = cad.box("box", { size: vec3(mm(10), mm(20), mm(30)) });
  cad.output("box", box);
  return DesignDocumentV3Schema.parse({
    ...cad.build(),
    schema: DOCUMENT_SCHEMA_V3,
    version: DOCUMENT_VERSION_V3,
  });
}

function legacyDocuments(): {
  readonly v1: DesignDocumentV1;
  readonly v2: DesignDocumentV2;
} {
  const current = legacyV3Box();
  const { topologyReferences: _topologyReferences, ...body } = current;
  const v1 = DesignDocumentV1Schema.parse({
    ...body,
    schema: DOCUMENT_SCHEMA_V1,
    version: DOCUMENT_VERSION_V1,
  });
  const v2 = DesignDocumentV2Schema.parse({
    ...body,
    schema: DOCUMENT_SCHEMA_V2,
    version: DOCUMENT_VERSION_V2,
  });
  return { v1, v2 };
}

function topologyGeometry(topologyKind: "face" | "edge") {
  return topologyKind === "face"
    ? {
        topology: "face" as const,
        kind: "plane",
        measure: 1,
        center: [0, 0.5, 0.5] as const,
        bounds: {
          min: [0, 0, 0] as const,
          max: [0, 1, 1] as const,
        },
        normal: [-1, 0, 0] as const,
      }
    : {
        topology: "edge" as const,
        kind: "line",
        measure: 1,
        center: [0, 0, 0.5] as const,
        bounds: {
          min: [0, 0, 0] as const,
          max: [0, 0, 1] as const,
        },
        direction: [0, 0, 1] as const,
      };
}

function referenceWithLoftRole(
  role: (typeof loftRoles)[number],
  placement: "lineage" | "adjacency",
  fingerprint = "invariantcad-topology-descriptor@3;test-runtime",
): PersistentTopologyReferenceV3 {
  const roleTopology = role.startsWith("loft.face.") ? "face" : "edge";
  const targetTopology =
    placement === "lineage"
      ? roleTopology
      : roleTopology === "face"
        ? "edge"
        : "face";
  return {
    protocolVersion: 1,
    kernelFingerprint: fingerprint,
    topology: targetTopology,
    capturedHistory: "complete",
    tolerance: { linear: 1e-7, angular: 1e-7, relative: 1e-7 },
    lineage:
      placement === "lineage"
        ? [{ feature: "loft", relation: "created", role }]
        : [{ feature: "box", relation: "created" }],
    geometry: topologyGeometry(targetTopology),
    adjacency:
      placement === "adjacency"
        ? [
            {
              topology: roleTopology,
              lineage: [{ feature: "loft", relation: "created", role }],
              geometry: topologyGeometry(roleTopology),
            },
          ]
        : [],
  };
}

function withReference(
  document: DesignDocumentV1 | DesignDocumentV2 | DesignDocumentV3,
  variant: PersistentTopologyReferenceV3,
): unknown {
  return {
    ...document,
    topologyReferences: {
      loftEvidence: {
        target: { node: "box", kind: "solid" },
        topology: variant.topology,
        variants: [variant],
      },
    },
  };
}

describe("DesignDocument v3 compatibility boundary", () => {
  it("keeps the v3 role vocabulary frozen after v5 becomes current", () => {
    expect(DOCUMENT_VERSION).toBe(DOCUMENT_VERSION_V5);
    expect(Object.isFrozen(TOPOLOGY_ROLES_V1)).toBe(true);
    expect(Object.isFrozen(TOPOLOGY_ROLES_V2)).toBe(true);
    expect(Object.isFrozen(TOPOLOGY_ROLES_V3)).toBe(true);
    expect(TOPOLOGY_ROLES_V2).toBe(TOPOLOGY_ROLES_V1);
    for (const role of loftRoles) {
      expect(TOPOLOGY_ROLES_V1).not.toContain(role);
      expect(TOPOLOGY_ROLES_V2).not.toContain(role);
      expect(TOPOLOGY_ROLES_V3).toContain(role);
    }

    const document: DesignDocumentV3 = legacyV3Box();
    expect(document).toMatchObject({
      schema: DOCUMENT_SCHEMA_V3,
      version: DOCUMENT_VERSION_V3,
    });
  });

  it.each(loftRoles)(
    "keeps '%s' out of v1/v2 queries while admitting it in v3",
    (role) => {
      const query = {
        op: "origin",
        feature: "loft",
        relation: "created",
        role,
      } as const;
      expect(TopologyQueryV1Schema.safeParse(query).success).toBe(false);
      expect(TopologyQueryV2Schema.safeParse(query).success).toBe(false);
      expect(TopologyQueryV3Schema.safeParse(query).success).toBe(true);
    },
  );

  it.each(loftRoles)(
    "rejects '%s' from v2 stored lineage and adjacency but accepts both in v3",
    (role) => {
      for (const placement of ["lineage", "adjacency"] as const) {
        const variant = referenceWithLoftRole(role, placement);
        expect(PersistentTopologyReferenceV2Schema.safeParse(variant).success).toBe(
          false,
        );
        expect(PersistentTopologyReferenceV3Schema.safeParse(variant).success).toBe(
          true,
        );
      }
    },
  );

  it("applies the nested role boundary through complete document schemas", () => {
    const { v1, v2 } = legacyDocuments();
    const variant = referenceWithLoftRole("loft.face.side", "adjacency");
    expect(DesignDocumentV1Schema.safeParse(withReference(v1, variant)).success).toBe(
      false,
    );
    expect(DesignDocumentV2Schema.safeParse(withReference(v2, variant)).success).toBe(
      false,
    );
    const current = legacyV3Box();
    expect(DesignDocumentV3Schema.safeParse(withReference(current, variant)).success).toBe(
      true,
    );
  });

  it("accepts a semantically valid source-aware loft selector in v3", () => {
    const cad = design("document-v3-loft-role");
    const lower = cad.sketch("lower", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("outline", { width: mm(20), height: mm(10) }),
      ),
    );
    const upper = cad.sketch(
      "upper",
      plane.xy(vec3(mm(0), mm(0), mm(10))),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("outline", { width: mm(10), height: mm(5) }),
        ),
    );
    const loft = cad.loft("loft", [lower, upper]);
    const side = topology.faces
      .createdBy(loft, {
        role: "loft.face.side",
        source: { sketch: lower, entity: "outline.e0" },
      })
      .select();
    cad.output(
      "shell",
      cad.shell("shell", loft, { openings: side, thickness: mm(0.5) }),
    );

    const result = parseDocumentValue(
      DesignDocumentV3Schema.parse({
        ...cad.build(),
        schema: DOCUMENT_SCHEMA_V3,
        version: DOCUMENT_VERSION_V3,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.version).toBe(DOCUMENT_VERSION_V3);
  });

  it("preserves pinned v1/v2 bytes and semantic hashes", async () => {
    const { v1, v2 } = legacyDocuments();
    expect(stringifyDocument(v1)).toBe(expectedV1);
    expect(stringifyDocument(v2)).toBe(expectedV2);
    expect(await hashDocument(v1)).toBe(
      "b34eeeea032a5ada3572bfd1566783fd62aa147f2da7597e2b9c18f4dd155005",
    );
    expect(await hashDocument(v2)).toBe(
      "2c67684a3b43bdf142f8a0cf4a7e11293e59370389a6b0265a4029a2ca15f007",
    );
  });

  it("migrates v1/v2/v3 to v5 and preserves @2 evidence", () => {
    const { v1, v2 } = legacyDocuments();
    const legacyVariant = PersistentTopologyReferenceV2Schema.parse({
      ...referenceWithLoftRole(
        "loft.face.start-cap",
        "lineage",
        "invariantcad-topology-descriptor@2;legacy-runtime",
      ),
      lineage: [
        {
          feature: "box",
          relation: "created" as const,
          role: "box.face.x-min" as const,
        },
      ],
    }) as PersistentTopologyReferenceV2<"face">;
    const v2WithEvidence = DesignDocumentV2Schema.parse(
      withReference(v2, legacyVariant),
    );

    for (const source of [v1, v2WithEvidence, legacyV3Box()]) {
      const migrated = migrateDocument(source);
      expect(migrated.ok).toBe(true);
      if (!migrated.ok) continue;
      expect(migrated.value).toMatchObject({
        schema: DOCUMENT_SCHEMA_V5,
        version: DOCUMENT_VERSION_V5,
      });
      expect(Object.isFrozen(migrated.value)).toBe(true);
      if (source.version === DOCUMENT_VERSION_V2) {
        expect(
          Object.values(migrated.value.topologyReferences ?? {})[0]?.variants[0],
        ).toEqual(legacyVariant);
      }
    }

    const invalid = JSON.parse(stringifyDocument(v2));
    invalid.outputs.box.node = "missing";
    expect(migrateDocument(invalid).ok).toBe(false);
  });

  it("keeps v3-only queries, selections, nodes, evidence, and documents out of v2 types", () => {
    const currentDocument: DesignDocumentV3 = legacyV3Box();
    const currentQuery: TopologyQueryIRV3 = {
      op: "origin",
      feature: currentDocument.outputs.box!.node,
      relation: "created",
      role: "loft.face.side",
    };
    const currentSelection: TopologySelectionIRV3<"face"> = {
      topology: "face",
      query: currentQuery,
      cardinality: { min: 1, max: 1 },
    };
    const currentNode: NodeIRV3 = Object.values(currentDocument.nodes)[0]!;
    const currentReference = referenceWithLoftRole(
      "loft.face.side",
      "lineage",
    );

    if (false) {
      // @ts-expect-error Document-v2 queries exclude loft roles.
      const invalidQuery: TopologyQueryIRV2 = currentQuery;
      // @ts-expect-error Document-v2 selections carry the frozen v2 role grammar.
      const invalidSelection: TopologySelectionIRV2<"face"> = currentSelection;
      // @ts-expect-error Document-v3 nodes are not widened into document v2.
      const invalidNode: NodeIRV2 = currentNode;
      // @ts-expect-error Document-v2 persistent evidence excludes loft roles.
      const invalidReference: PersistentTopologyReferenceV2 = currentReference;
      // @ts-expect-error The current v3 document cannot be assigned to v2.
      const invalidDocument: DesignDocumentV2 = currentDocument;
      void [
        invalidDocument,
        invalidNode,
        invalidQuery,
        invalidReference,
        invalidSelection,
      ];
    }

    expect(currentSelection.query).toBe(currentQuery);
  });
});
