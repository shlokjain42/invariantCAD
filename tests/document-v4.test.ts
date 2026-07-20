import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  NodeV3Schema,
  NodeV4Schema,
  PersistentTopologyReferenceV2Schema,
  PersistentTopologyReferenceV3Schema,
  PersistentTopologyReferenceV4Schema,
  TOPOLOGY_ROLES_V1,
  TOPOLOGY_ROLES_V2,
  TOPOLOGY_ROLES_V3,
  TOPOLOGY_ROLES_V4,
  TopologyQueryV1Schema,
  TopologyQueryV2Schema,
  TopologyQueryV3Schema,
  TopologyQueryV4Schema,
  design,
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
  type DesignDocumentV4,
  type DesignDocumentV5,
  type NodeIRV3,
  type NodeIRV4,
  type PersistentTopologyReferenceV2,
  type PersistentTopologyReferenceV3,
  type PersistentTopologyReferenceV4,
  type ShellNodeIRV4,
  type ShellNodeIRV3,
  type TopologyQueryIRV3,
  type TopologyQueryIRV4,
  type TopologySelectionIRV3,
  type TopologySelectionIRV4,
  type TopologyRoleV4,
} from "../src/index.js";

const sweepRoles = [
  "sweep.face.start-cap",
  "sweep.face.end-cap",
  "sweep.face.side",
  "sweep.edge.start-rim",
  "sweep.edge.end-rim",
  "sweep.edge.lateral",
] as const satisfies readonly TopologyRoleV4[];

type SweepRole = (typeof sweepRoles)[number];

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
  role: TopologyRoleV4,
  placement: "lineage" | "adjacency",
  fingerprint: string,
): PersistentTopologyReferenceV4 {
  const roleTopology = role.includes(".face.") ? "face" : "edge";
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
        ? [{ feature: "feature", relation: "created", role }]
        : [{ feature: "box", relation: "created" }],
    geometry: topologyGeometry(targetTopology),
    adjacency:
      placement === "adjacency"
        ? [
            {
              topology: roleTopology,
              lineage: [{ feature: "feature", relation: "created", role }],
              geometry: topologyGeometry(roleTopology),
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
} {
  const cad = design("document-v4-boundary");
  const box = cad.box("box", { size: vec3(mm(10), mm(20), mm(30)) });
  cad.output("box", box);
  const current = cad.build();
  const { topologyReferences: _topologyReferences, ...body } = current;
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
  };
}

function withReference(
  document:
    | DesignDocumentV1
    | DesignDocumentV2
    | DesignDocumentV3
    | DesignDocumentV4,
  variant: PersistentTopologyReferenceV4,
): unknown {
  return {
    ...document,
    topologyReferences: {
      selectedTopology: {
        target: { node: document.outputs.box!.node, kind: "solid" },
        topology: variant.topology,
        variants: [variant],
      },
    },
  };
}

function canonicalRegistry(
  document:
    | DesignDocumentV2
    | DesignDocumentV3
    | DesignDocumentV4
    | DesignDocumentV5,
): string {
  const serialized = JSON.parse(stringifyDocument(document)) as {
    readonly topologyReferences?: unknown;
  };
  return JSON.stringify(serialized.topologyReferences);
}

function sourceAwareSweepDocument(useDirectProfile: boolean): DesignDocumentV4 {
  const cad = design(
    useDirectProfile ? "valid-sweep-source" : "foreign-sweep-source",
  );
  const profile = cad.sketch("profile", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("outline", { width: mm(4), height: mm(2) }),
    ),
  );
  const foreign = cad.sketch("foreign", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("outline", { width: mm(3), height: mm(1) }),
    ),
  );
  const path = cad.polylinePath("path", [
    vec3(mm(0), mm(0), mm(0)),
    vec3(mm(0), mm(0), mm(10)),
  ]);
  const sweep = cad.sweep("sweep", profile, path);
  const side = topology.faces
    .createdBy(sweep, {
      role: "sweep.face.side",
      source: {
        sketch: useDirectProfile ? profile : foreign,
        entity: "outline.e0",
      },
    })
    .select();
  cad.output(
    "shell",
    cad.shell("shell", sweep, { openings: side, thickness: mm(0.25) }),
  );
  return DesignDocumentV4Schema.parse({
    ...cad.build(),
    schema: DOCUMENT_SCHEMA_V4,
    version: DOCUMENT_VERSION_V4,
  });
}

describe("DesignDocument v4 compatibility boundary", () => {
  it("keeps the six-role v4 vocabulary frozen", () => {
    for (const roles of [
      TOPOLOGY_ROLES_V1,
      TOPOLOGY_ROLES_V2,
      TOPOLOGY_ROLES_V3,
      TOPOLOGY_ROLES_V4,
    ]) {
      expect(Object.isFrozen(roles)).toBe(true);
    }
    for (const role of sweepRoles) {
      expect(TOPOLOGY_ROLES_V1).not.toContain(role);
      expect(TOPOLOGY_ROLES_V2).not.toContain(role);
      expect(TOPOLOGY_ROLES_V3).not.toContain(role);
      expect(TOPOLOGY_ROLES_V4).toContain(role);
    }

    const document = versionedBoxes().v4;
    expectTypeOf(document).toEqualTypeOf<DesignDocumentV4>();
    const node = Object.values(document.nodes)[0]!;
    expectTypeOf(node).toEqualTypeOf<NodeIRV4>();
    expect(document).toMatchObject({
      schema: DOCUMENT_SCHEMA_V4,
      version: DOCUMENT_VERSION_V4,
    });
  });

  it.each(sweepRoles)(
    "keeps '%s' out of v1-v3 queries while admitting it in v4",
    (role) => {
      const query = {
        op: "origin",
        feature: "sweep",
        relation: "created",
        role,
      } as const;
      expect(TopologyQueryV1Schema.safeParse(query).success).toBe(false);
      expect(TopologyQueryV2Schema.safeParse(query).success).toBe(false);
      expect(TopologyQueryV3Schema.safeParse(query).success).toBe(false);
      expect(TopologyQueryV4Schema.safeParse(query).success).toBe(true);
    },
  );

  it.each(sweepRoles)(
    "rejects '%s' from v2/v3 stored lineage and adjacency while v4 accepts it",
    (role) => {
      for (const placement of ["lineage", "adjacency"] as const) {
        const variant = referenceWithRole(
          role,
          placement,
          "invariantcad-topology-descriptor@4;v4-boundary",
        );
        expect(PersistentTopologyReferenceV2Schema.safeParse(variant).success).toBe(
          false,
        );
        expect(PersistentTopologyReferenceV3Schema.safeParse(variant).success).toBe(
          false,
        );
        expect(PersistentTopologyReferenceV4Schema.safeParse(variant).success).toBe(
          true,
        );
      }
    },
  );

  it.each(sweepRoles)(
    "enforces the '%s' boundary through complete document schemas",
    (role) => {
      const documents = versionedBoxes();
      for (const placement of ["lineage", "adjacency"] as const) {
        const variant = referenceWithRole(
          role,
          placement,
          "invariantcad-topology-descriptor@4;document-boundary",
        );
        expect(
          DesignDocumentV1Schema.safeParse(withReference(documents.v1, variant))
            .success,
        ).toBe(false);
        expect(
          DesignDocumentV2Schema.safeParse(withReference(documents.v2, variant))
            .success,
        ).toBe(false);
        expect(
          DesignDocumentV3Schema.safeParse(withReference(documents.v3, variant))
            .success,
        ).toBe(false);
        expect(
          DesignDocumentV4Schema.safeParse(withReference(documents.v4, variant))
            .success,
        ).toBe(true);
      }
    },
  );

  it("accepts only the sweep's direct profile as a sketch-curve source", () => {
    const valid = parseDocumentValue(sourceAwareSweepDocument(true));
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.value.version).toBe(DOCUMENT_VERSION_V4);

    const invalid = parseDocumentValue(sourceAwareSweepDocument(false));
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TOPOLOGY_SELECTOR_INVALID",
          path: "/nodes/shell/openings/query/source/sketch",
          message: expect.stringContaining("direct profile of sweep"),
        }),
      ]),
    );
  });

  it("keeps v4 sweep selections out of frozen v3 selector-bearing nodes", () => {
    const feature = versionedBoxes().v4.outputs.box!.node;
    const query: TopologyQueryIRV4 = {
      op: "origin",
      feature,
      relation: "created",
      role: "sweep.face.side",
    };
    const selection: TopologySelectionIRV4<"face"> = {
      topology: "face",
      query,
      cardinality: { min: 1, max: 1 },
    };
    const shell: ShellNodeIRV4 = {
      kind: "shell",
      input: { node: feature, kind: "solid" },
      openings: selection,
      thickness: mm(1).ir,
      direction: "inward",
      tolerance: mm(0.01).ir,
    };

    expect(NodeV3Schema.safeParse(shell).success).toBe(false);
    expect(NodeV4Schema.safeParse(shell).success).toBe(true);

    if (false) {
      // @ts-expect-error Document-v3 queries exclude sweep roles.
      const invalidQuery: TopologyQueryIRV3 = query;
      // @ts-expect-error Document-v3 selections carry the frozen v3 role grammar.
      const invalidSelection: TopologySelectionIRV3<"face"> = selection;
      // @ts-expect-error Document-v3 shell nodes cannot contain v4 selections.
      const invalidShell: ShellNodeIRV3 = shell;
      // @ts-expect-error The v4 selector-bearing node union is not assignable to v3.
      const invalidNode: NodeIRV3 = shell;
      void [invalidNode, invalidQuery, invalidSelection, invalidShell];
    }
  });

  it("migrates v1-v4 to v5 while preserving legacy evidence", () => {
    const documents = versionedBoxes();
    const v2Evidence = PersistentTopologyReferenceV2Schema.parse(
      referenceWithRole(
        "box.face.x-min",
        "lineage",
        "invariantcad-topology-descriptor@2;legacy-runtime",
      ),
    ) as PersistentTopologyReferenceV2<"face">;
    const v3Evidence = PersistentTopologyReferenceV3Schema.parse(
      referenceWithRole(
        "loft.face.side",
        "adjacency",
        "invariantcad-topology-descriptor@3;legacy-runtime",
      ),
    ) as PersistentTopologyReferenceV3;
    const v2 = DesignDocumentV2Schema.parse(
      withReference(documents.v2, v2Evidence),
    );
    const v3 = DesignDocumentV3Schema.parse(
      withReference(documents.v3, v3Evidence),
    );

    for (const source of [documents.v1, v2, v3, documents.v4]) {
      const sourceBytes = stringifyDocument(source);
      const sourceRegistry =
        source.version === DOCUMENT_VERSION_V1
          ? undefined
          : canonicalRegistry(source);
      const migrated = migrateDocument(source);
      expect(migrated.ok).toBe(true);
      expect(stringifyDocument(source)).toBe(sourceBytes);
      if (!migrated.ok) continue;
      expect(migrated.value).toMatchObject({
        schema: DOCUMENT_SCHEMA_V5,
        version: DOCUMENT_VERSION_V5,
      });
      if (sourceRegistry !== undefined) {
        expect(canonicalRegistry(migrated.value)).toBe(sourceRegistry);
        expect(migrated.value.topologyReferences).toEqual(
          source.topologyReferences,
        );
      }
    }
  });
});
