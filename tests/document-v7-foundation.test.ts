import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DOCUMENT_SCHEMA,
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_SCHEMA_V6,
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DOCUMENT_VERSION_V6,
  DOCUMENT_VERSION_V7,
  NODE_KINDS,
  NODE_KINDS_V6,
  NODE_KINDS_V7,
  type DesignDocument,
  type DesignDocumentV7,
  type NodeIR,
  type NodeIRV6,
  type NodeIRV7,
  type ResourceDefinitionIR,
} from "../src/ir.js";
import {
  DesignDocumentSchema,
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
  DesignDocumentV6Schema,
  DesignDocumentV7Schema,
  NodeSchema,
  NodeV1Schema,
  NodeV2Schema,
  NodeV3Schema,
  NodeV4Schema,
  NodeV5Schema,
  NodeV6Schema,
  NodeV7Schema,
} from "../src/schema.js";
import {
  migrateDocumentToV7,
  parseDocumentValue,
  stringifyDocument,
} from "../src/serialization.js";
import { design } from "../src/design.js";
import { mm } from "../src/expressions.js";

const length = (value: number) =>
  ({
    op: "literal",
    dimension: "length",
    value,
  }) as const;
const scalar = (value: number) =>
  ({
    op: "literal",
    dimension: "scalar",
    value,
  }) as const;

function stagedV7Document(): DesignDocumentV7 {
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "document-v7-foundation",
    units: { length: "mm", angle: "rad" },
    parameters: {},
    resources: {
      importedStep: {
        digest: `sha256:${"0".repeat(64)}`,
        byteLength: 1_024,
        mediaType: "model/step",
        locations: ["project://models/imported.step"],
      },
      externalDocument: {
        digest: `sha256:${"1".repeat(64)}`,
        byteLength: 2_048,
        mediaType: "application/vnd.invariantcad.document+json",
      },
    },
    nodes: {
      origin: {
        kind: "datumPoint",
        position: [length(0), length(0), length(0)],
      },
      axis: {
        kind: "datumAxis",
        origin: [length(0), length(0), length(0)],
        direction: [scalar(0), scalar(0), scalar(1)],
      },
      plane: {
        kind: "datumPlane",
        origin: [length(0), length(0), length(0)],
        xDirection: [scalar(1), scalar(0), scalar(0)],
        normal: [scalar(0), scalar(0), scalar(1)],
      },
      frame: {
        kind: "coordinateSystem",
        origin: [length(0), length(0), length(0)],
        xDirection: [scalar(1), scalar(0), scalar(0)],
        yDirection: [scalar(0), scalar(1), scalar(0)],
      },
      profile: {
        kind: "sketch",
        plane: {
          type: "datum",
          datum: { node: "plane", kind: "datumPlane" },
        },
        entities: {
          center: { kind: "point", x: length(0), y: length(0) },
          circle: { kind: "circle", center: "center", radius: length(5) },
        },
        constraints: {},
        profile: {
          outer: { kind: "circle", entity: "circle" },
          holes: [],
        },
        tolerance: 1e-7,
      },
      imported: {
        kind: "importedBody",
        resource: "importedStep",
        format: "step",
        units: { mode: "from-file" },
        healing: { mode: "reader-default" },
        expected: "single-solid",
      },
      primitive: {
        kind: "box",
        size: [length(10), length(20), length(30)],
        center: false,
      },
      bodies: {
        kind: "bodySet",
        bodies: [
          {
            id: "primary",
            solid: { node: "primitive", kind: "solid" },
            name: "Primary body",
          },
          {
            id: "imported",
            solid: { node: "imported", kind: "solid" },
          },
        ],
      },
      part: {
        kind: "part",
        geometry: { node: "bodies", kind: "bodySet" },
        partNumber: "V7-001",
      },
      assembly: {
        kind: "assembly",
        instances: [
          {
            id: "local",
            component: {
              source: "local",
              reference: { node: "part", kind: "part" },
            },
            configuration: { mode: "inherit" },
            placement: [],
            suppressed: false,
          },
          {
            id: "external",
            component: {
              source: "external",
              resource: "externalDocument",
              output: "main",
              outputKind: "part",
            },
            configuration: { mode: "named", id: "manufacturing" },
            placement: [],
            suppressed: false,
          },
        ],
      },
    },
    outputs: {
      bodies: { node: "bodies", kind: "bodySet" },
      part: { node: "part", kind: "part" },
      assembly: { node: "assembly", kind: "assembly" },
    },
  } as unknown as DesignDocumentV7;
}

function legacyAssemblyDocument(): DesignDocument {
  const cad = design("v7-migration");
  const body = cad.box("body", {
    size: [mm(10), mm(20), mm(30)],
  });
  const part = cad.part("part", body, { partNumber: "LEGACY-1" });
  const assembly = cad.assembly("assembly", (value) => {
    value.instance("partOccurrence", part);
  });
  cad.output("assembly", assembly);
  return cad.build();
}

describe("staged document-v7 foundation", () => {
  it("keeps all current public aliases pinned to v6", () => {
    expect(DOCUMENT_SCHEMA).toBe(DOCUMENT_SCHEMA_V6);
    expect(DOCUMENT_VERSION).toBe(DOCUMENT_VERSION_V6);
    expect(NODE_KINDS).toBe(NODE_KINDS_V6);
    expect(NodeSchema).toBe(NodeV6Schema);
    expect(DesignDocumentSchema.safeParse(stagedV7Document()).success).toBe(false);
    expect(parseDocumentValue(stagedV7Document()).ok).toBe(false);
    expectTypeOf<NodeIR>().toEqualTypeOf<NodeIRV6>();
  });

  it("admits the isolated v7 resource, datum, import, multibody, and component grammar", () => {
    const document = stagedV7Document();
    const nodes = document.nodes as unknown as Readonly<
      Record<string, NodeIRV7>
    >;
    const parsed = DesignDocumentV7Schema.safeParse(document);
    expect(parsed.success).toBe(true);
    expect(NodeV7Schema.safeParse(nodes.plane).success).toBe(true);
    expect(NodeV7Schema.safeParse(nodes.bodies).success).toBe(true);
    expect(NodeV7Schema.safeParse(nodes.imported).success).toBe(true);
    expect(NodeV7Schema.safeParse(nodes.assembly).success).toBe(true);
    expect(NODE_KINDS_V7).toEqual([
      ...NODE_KINDS_V6,
      "datumPoint",
      "datumAxis",
      "datumPlane",
      "coordinateSystem",
      "bodySet",
      "importedBody",
    ]);
  });

  it("keeps every frozen node and document schema closed against v7", () => {
    const document = stagedV7Document();
    const nodes = document.nodes as unknown as Readonly<
      Record<string, NodeIRV7>
    >;
    const v7Node = nodes.imported!;
    for (const schema of [
      NodeV1Schema,
      NodeV2Schema,
      NodeV3Schema,
      NodeV4Schema,
      NodeV5Schema,
      NodeV6Schema,
    ]) {
      expect(schema.safeParse(v7Node).success).toBe(false);
    }
    for (const schema of [
      DesignDocumentV1Schema,
      DesignDocumentV2Schema,
      DesignDocumentV3Schema,
      DesignDocumentV4Schema,
      DesignDocumentV5Schema,
      DesignDocumentV6Schema,
    ]) {
      expect(schema.safeParse(document).success).toBe(false);
    }
  });

  it("rejects malformed commitments and ambiguous v7 structural identity", () => {
    const source = stagedV7Document();
    const resources = source.resources as unknown as Readonly<
      Record<string, ResourceDefinitionIR>
    >;
    expect(
      DesignDocumentV7Schema.safeParse({
        ...source,
        resources: {
          ...source.resources,
          importedStep: {
            ...(resources.importedStep as object),
            digest: `sha256:${"A".repeat(64)}`,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      NodeV7Schema.safeParse({
        kind: "bodySet",
        bodies: [
          { id: "same", solid: { node: "primitive", kind: "solid" } },
          { id: "same", solid: { node: "imported", kind: "solid" } },
        ],
      }).success,
    ).toBe(false);
    expect(
      NodeV7Schema.safeParse({
        kind: "importedBody",
        resource: "importedStep",
        format: "brep",
        units: { mode: "from-file" },
        healing: { mode: "reader-default" },
        expected: "single-solid",
      }).success,
    ).toBe(false);
    const nodes = source.nodes as unknown as Readonly<Record<string, NodeIRV7>>;
    const assembly = nodes.assembly;
    expect(assembly?.kind).toBe("assembly");
    if (assembly?.kind !== "assembly") return;
    expect(
      NodeV7Schema.safeParse({
        ...assembly,
        instances: [
          assembly.instances[0],
          { ...assembly.instances[1], id: assembly.instances[0]!.id },
        ],
      }).success,
    ).toBe(false);
  });

  it("migrates every frozen envelope without mutating legacy bytes", () => {
    const current = legacyAssemblyDocument();
    const cases = [
      [DOCUMENT_SCHEMA_V1, DOCUMENT_VERSION_V1, DesignDocumentV1Schema],
      [DOCUMENT_SCHEMA_V2, DOCUMENT_VERSION_V2, DesignDocumentV2Schema],
      [DOCUMENT_SCHEMA_V3, DOCUMENT_VERSION_V3, DesignDocumentV3Schema],
      [DOCUMENT_SCHEMA_V4, DOCUMENT_VERSION_V4, DesignDocumentV4Schema],
      [DOCUMENT_SCHEMA_V5, DOCUMENT_VERSION_V5, DesignDocumentV5Schema],
      [DOCUMENT_SCHEMA_V6, DOCUMENT_VERSION_V6, DesignDocumentV6Schema],
    ] as const;

    for (const [schema, version, parser] of cases) {
      const source = parser.parse({ ...current, schema, version });
      const before = stringifyDocument(source);
      const migrated = migrateDocumentToV7(source);
      expect(migrated.ok, `document v${version}`).toBe(true);
      expect(stringifyDocument(source), `document v${version}`).toBe(before);
      if (!migrated.ok) continue;
      expect(migrated.value.schema).toBe(DOCUMENT_SCHEMA_V7);
      expect(migrated.value.version).toBe(DOCUMENT_VERSION_V7);
      expect(Object.isFrozen(migrated.value)).toBe(true);
      expect(Object.isFrozen(migrated.value.nodes)).toBe(true);
      expect(DesignDocumentV7Schema.safeParse(migrated.value).success).toBe(true);
      expect(migrated.value.resources).toBeUndefined();
      const nodes = migrated.value.nodes as unknown as Readonly<
        Record<string, NodeIRV7>
      >;
      expect(nodes.part).toMatchObject({
        kind: "part",
        geometry: { node: "body", kind: "solid" },
      });
      expect(nodes.assembly).toMatchObject({
        kind: "assembly",
        instances: [
          {
            id: "partOccurrence",
            component: {
              source: "local",
              reference: { node: "part", kind: "part" },
            },
            configuration: { mode: "inherit" },
          },
        ],
      });
    }
  });

  it("keeps v7 types separate from current public node and document unions", () => {
    const datum = {
      kind: "datumPoint",
      position: [length(0), length(0), length(0)],
    } as const satisfies NodeIRV7;
    if (false) {
      // @ts-expect-error Staged v7 nodes are not current NodeIR yet.
      const currentNode: NodeIR = datum;
      // @ts-expect-error Staged v7 documents are not current DesignDocument yet.
      const currentDocument: DesignDocument = stagedV7Document();
      void [currentNode, currentDocument];
    }
    expect(datum.kind).toBe("datumPoint");
  });
});
