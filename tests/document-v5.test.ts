import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DOCUMENT_SCHEMA,
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_VERSION,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DesignDocumentSchema,
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
  NodeSchema,
  NodeV4Schema,
  NodeV5Schema,
  PersistentTopologyReferenceSchema,
  PersistentTopologyReferenceV2Schema,
  PersistentTopologyReferenceV3Schema,
  PersistentTopologyReferenceV4Schema,
  PersistentTopologyReferenceV5Schema,
  TOPOLOGY_ROLES,
  TOPOLOGY_ROLES_V1,
  TOPOLOGY_ROLES_V2,
  TOPOLOGY_ROLES_V3,
  TOPOLOGY_ROLES_V4,
  TOPOLOGY_ROLES_V5,
  TopologyQuerySchema,
  TopologyQueryV1Schema,
  TopologyQueryV2Schema,
  TopologyQueryV3Schema,
  TopologyQueryV4Schema,
  TopologyQueryV5Schema,
  TopologyReferenceEntrySchema,
  TopologyReferenceEntryV5Schema,
  TopologySelectionSchema,
  TopologySelectionV5Schema,
  design,
  migrateDocument,
  mm,
  parseDocumentValue,
  stringifyDocument,
  topology,
  vec3,
  type DesignDocumentV1,
  type DesignDocumentV2,
  type DesignDocumentV3,
  type DesignDocumentV4,
  type DesignDocumentV5,
  type ChamferNodeIR,
  type ChamferNodeIRV5,
  type DraftNodeIR,
  type DraftNodeIRV5,
  type FilletNodeIR,
  type FilletNodeIRV5,
  type NodeIR,
  type NodeIRV4,
  type NodeIRV5,
  type PersistentTopologyReference,
  type PersistentTopologyReferenceV4,
  type PersistentTopologyReferenceV5,
  type ShellNodeIR,
  type ShellNodeIRV4,
  type ShellNodeIRV5,
  type TopologyQueryIR,
  type TopologyQueryIRV4,
  type TopologyQueryIRV5,
  type TopologyReferenceEntryIR,
  type TopologyReferenceEntryIRV5,
  type TopologySelectionIR,
  type TopologySelectionIRV4,
  type TopologySelectionIRV5,
  type TopologyRole,
  type TopologyRoleV5,
} from "../src/index.js";

const edgeTreatmentFaceRoles = [
  "fillet.face.blend",
  "chamfer.face.bevel",
] as const satisfies readonly TopologyRoleV5[];

type EdgeTreatmentFaceRole = (typeof edgeTreatmentFaceRoles)[number];

type ExactType<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

const currentFeatureNodeAliases = [
  true,
  true,
  true,
  true,
] as const satisfies readonly [
  ExactType<FilletNodeIR, FilletNodeIRV5>,
  ExactType<ChamferNodeIR, ChamferNodeIRV5>,
  ExactType<ShellNodeIR, ShellNodeIRV5>,
  ExactType<DraftNodeIR, DraftNodeIRV5>,
];

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

function referenceWithRole(
  role: EdgeTreatmentFaceRole,
  placement: "lineage" | "adjacency",
  fingerprint: string,
): PersistentTopologyReferenceV5 {
  const targetTopology = placement === "lineage" ? "face" : "edge";
  return {
    protocolVersion: 1,
    kernelFingerprint: fingerprint,
    topology: targetTopology,
    capturedHistory: "complete",
    tolerance: { linear: 1e-7, angular: 1e-7, relative: 1e-7 },
    lineage:
      placement === "lineage"
        ? [{ feature: "treated", relation: "created", role }]
        : [{ feature: "box", relation: "created" }],
    geometry: topologyGeometry(targetTopology),
    adjacency:
      placement === "adjacency"
        ? [
            {
              topology: "face",
              lineage: [{ feature: "treated", relation: "created", role }],
              geometry: topologyGeometry("face"),
            },
          ]
        : [],
  };
}

function versionedBoxes(): {
  readonly v1: DesignDocumentV1;
  readonly v2: DesignDocumentV2;
  readonly v3: DesignDocumentV3;
  readonly v4: DesignDocumentV4;
  readonly v5: DesignDocumentV5;
} {
  const cad = design("document-v5-boundary");
  const box = cad.box("box", { size: vec3(mm(10), mm(20), mm(30)) });
  cad.output("box", box);
  const v5 = cad.build();
  const { topologyReferences: _topologyReferences, ...body } = v5;
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
    v3: DesignDocumentV3Schema.parse({
      ...body,
      schema: DOCUMENT_SCHEMA_V3,
      version: DOCUMENT_VERSION_V3,
    }),
    v4: DesignDocumentV4Schema.parse({
      ...body,
      schema: DOCUMENT_SCHEMA_V4,
      version: DOCUMENT_VERSION_V4,
    }),
    v5,
  };
}

function withReference(
  document:
    | DesignDocumentV1
    | DesignDocumentV2
    | DesignDocumentV3
    | DesignDocumentV4
    | DesignDocumentV5,
  variant: PersistentTopologyReferenceV5,
): unknown {
  return {
    ...document,
    topologyReferences: {
      selectedTopology: {
        target: { node: "box", kind: "solid" },
        topology: variant.topology,
        variants: [variant],
      },
    },
  };
}

describe("DesignDocument v5 compatibility boundary", () => {
  it("moves every current runtime and authoring alias to v5", () => {
    expect(DOCUMENT_SCHEMA).toBe(DOCUMENT_SCHEMA_V5);
    expect(DOCUMENT_VERSION).toBe(DOCUMENT_VERSION_V5);
    for (const document of Object.values(versionedBoxes())) {
      expect(DesignDocumentSchema.safeParse(document).success).toBe(true);
    }
    expect(NodeSchema).toBe(NodeV5Schema);
    expect(TopologyQuerySchema).toBe(TopologyQueryV5Schema);
    expect(TopologySelectionSchema).toBe(TopologySelectionV5Schema);
    expect(PersistentTopologyReferenceSchema).toBe(
      PersistentTopologyReferenceV5Schema,
    );
    expect(TopologyReferenceEntrySchema).toBe(
      TopologyReferenceEntryV5Schema,
    );
    expect(TOPOLOGY_ROLES).toBe(TOPOLOGY_ROLES_V5);

    const built = versionedBoxes().v5;
    expectTypeOf(built).toEqualTypeOf<DesignDocumentV5>();
    expectTypeOf<NodeIR>().toEqualTypeOf<NodeIRV5>();
    expect(currentFeatureNodeAliases).toEqual([true, true, true, true]);
    expectTypeOf<TopologyQueryIR>().toEqualTypeOf<TopologyQueryIRV5>();
    expectTypeOf<TopologySelectionIR>().toEqualTypeOf<
      TopologySelectionIRV5
    >();
    expectTypeOf<TopologyRole>().toEqualTypeOf<TopologyRoleV5>();
    expectTypeOf<PersistentTopologyReference>().toEqualTypeOf<
      PersistentTopologyReferenceV5
    >();
    expectTypeOf<TopologyReferenceEntryIR>().toEqualTypeOf<
      TopologyReferenceEntryIRV5
    >();
    expect(built).toMatchObject({
      schema: DOCUMENT_SCHEMA_V5,
      version: DOCUMENT_VERSION_V5,
    });
  });

  it.each(edgeTreatmentFaceRoles)(
    "admits '%s' only in the v5 query grammar",
    (role) => {
      const query = {
        op: "origin",
        feature: "treated",
        relation: "created",
        role,
      } as const;
      expect(TopologyQueryV1Schema.safeParse(query).success).toBe(false);
      expect(TopologyQueryV2Schema.safeParse(query).success).toBe(false);
      expect(TopologyQueryV3Schema.safeParse(query).success).toBe(false);
      expect(TopologyQueryV4Schema.safeParse(query).success).toBe(false);
      expect(TopologyQueryV5Schema.safeParse(query).success).toBe(true);
    },
  );

  it.each(edgeTreatmentFaceRoles)(
    "admits '%s' only in v5 persistent lineage and adjacency",
    (role) => {
      expect(TOPOLOGY_ROLES_V1).not.toContain(role);
      expect(TOPOLOGY_ROLES_V2).not.toContain(role);
      expect(TOPOLOGY_ROLES_V3).not.toContain(role);
      expect(TOPOLOGY_ROLES_V4).not.toContain(role);
      expect(TOPOLOGY_ROLES_V5).toContain(role);

      for (const placement of ["lineage", "adjacency"] as const) {
        const reference = referenceWithRole(
          role,
          placement,
          "invariantcad-topology-descriptor@5;document-v5-boundary",
        );
        expect(
          PersistentTopologyReferenceV2Schema.safeParse(reference).success,
        ).toBe(false);
        expect(
          PersistentTopologyReferenceV3Schema.safeParse(reference).success,
        ).toBe(false);
        expect(
          PersistentTopologyReferenceV4Schema.safeParse(reference).success,
        ).toBe(false);
        expect(
          PersistentTopologyReferenceV5Schema.safeParse(reference).success,
        ).toBe(true);
      }
    },
  );

  it.each(edgeTreatmentFaceRoles)(
    "enforces the '%s' boundary through complete document schemas",
    (role) => {
      const documents = versionedBoxes();
      for (const placement of ["lineage", "adjacency"] as const) {
        const reference = referenceWithRole(
          role,
          placement,
          "invariantcad-topology-descriptor@5;document-schema-boundary",
        );
        expect(
          DesignDocumentV1Schema.safeParse(
            withReference(documents.v1, reference),
          ).success,
        ).toBe(false);
        expect(
          DesignDocumentV2Schema.safeParse(
            withReference(documents.v2, reference),
          ).success,
        ).toBe(false);
        expect(
          DesignDocumentV3Schema.safeParse(
            withReference(documents.v3, reference),
          ).success,
        ).toBe(false);
        expect(
          DesignDocumentV4Schema.safeParse(
            withReference(documents.v4, reference),
          ).success,
        ).toBe(false);
        expect(
          DesignDocumentV5Schema.safeParse(
            withReference(documents.v5, reference),
          ).success,
        ).toBe(true);
      }
    },
  );

  it("keeps v5 face-role selectors out of frozen v4 selector-bearing nodes", () => {
    const feature = versionedBoxes().v5.outputs.box!.node;
    const query: TopologyQueryIRV5 = {
      op: "origin",
      feature,
      relation: "created",
      role: "fillet.face.blend",
    };
    const selection: TopologySelectionIRV5<"face"> = {
      topology: "face",
      query,
      cardinality: { min: 1, max: 1 },
    };
    const shell: ShellNodeIR = {
      kind: "shell",
      input: { node: feature, kind: "solid" },
      openings: selection,
      thickness: mm(1).ir,
      direction: "inward",
      tolerance: mm(0.01).ir,
    };

    expect(NodeV4Schema.safeParse(shell).success).toBe(false);
    expect(NodeV5Schema.safeParse(shell).success).toBe(true);

    if (false) {
      // @ts-expect-error Document-v4 queries exclude v5 edge-treatment face roles.
      const invalidQuery: TopologyQueryIRV4 = query;
      // @ts-expect-error Document-v4 selections carry the frozen v4 role grammar.
      const invalidSelection: TopologySelectionIRV4<"face"> = selection;
      // @ts-expect-error Document-v4 shell nodes cannot contain v5 selections.
      const invalidShell: ShellNodeIRV4 = shell;
      // @ts-expect-error The current v5 selector-bearing union is not assignable to v4.
      const invalidNode: NodeIRV4 = shell;
      void [invalidNode, invalidQuery, invalidSelection, invalidShell];
    }
  });

  it.each(["fillet", "chamfer"] as const)(
    "validates a v5 %s face-role selector against its direct producer",
    (operation) => {
      const cad = design(`document-v5-${operation}-role`);
      const box = cad.box("box", { size: vec3(mm(10), mm(20), mm(30)) });
      const edges = topology.edges
        .createdBy(box, { role: "box.edge.x-min-y-min" })
        .select();
      const treated =
        operation === "fillet"
          ? cad.fillet("treated", box, { edges, radius: mm(1) })
          : cad.chamfer("treated", box, { edges, distance: mm(1) });
      const openings = topology.faces
        .createdBy(treated, {
          role:
            operation === "fillet"
              ? "fillet.face.blend"
              : "chamfer.face.bevel",
        })
        .select();
      cad.output(
        "shell",
        cad.shell("shell", treated, { openings, thickness: mm(0.25) }),
      );

      const parsed = parseDocumentValue(cad.build());
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value.version).toBe(DOCUMENT_VERSION_V5);
    },
  );

  it("migrates frozen v4 evidence to v5 without rewriting descriptor data", () => {
    const documents = versionedBoxes();
    const evidence = PersistentTopologyReferenceV4Schema.parse({
      ...referenceWithRole(
        "fillet.face.blend",
        "lineage",
        "invariantcad-topology-descriptor@4;frozen-v4-evidence",
      ),
      lineage: [
        {
          feature: "box",
          relation: "created",
          role: "box.face.x-min",
        },
      ],
    }) as PersistentTopologyReferenceV4<"face">;
    const source = DesignDocumentV4Schema.parse(
      withReference(documents.v4, evidence),
    );
    const sourceRegistry = JSON.parse(stringifyDocument(source))
      .topologyReferences;

    const migrated = migrateDocument(source);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value).toMatchObject({
      schema: DOCUMENT_SCHEMA_V5,
      version: DOCUMENT_VERSION_V5,
    });
    expect(
      JSON.parse(stringifyDocument(migrated.value)).topologyReferences,
    ).toEqual(sourceRegistry);

    const again = migrateDocument(migrated.value);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(stringifyDocument(again.value)).toBe(
        stringifyDocument(migrated.value),
      );
    }
  });
});
