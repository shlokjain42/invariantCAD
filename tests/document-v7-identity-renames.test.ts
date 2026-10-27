import { describe, expect, it } from "vitest";
import { design, plane, tf } from "../src/design.js";
import { kgPerCubicMeter, mm, vec2, vec3 } from "../src/expressions.js";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_SCHEMA_V6,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DOCUMENT_VERSION_V6,
  type DesignDocument,
} from "../src/ir.js";
import {
  DesignDocumentV1Schema,
  DesignDocumentV2Schema,
  DesignDocumentV3Schema,
  DesignDocumentV4Schema,
  DesignDocumentV5Schema,
  DesignDocumentV6Schema,
} from "../src/schema.js";
import {
  migrateDocumentToV7,
  migrateDocumentToV7WithIdentityRenames,
  parseDocumentValue,
  stringifyDocument,
  stringifyDocumentV7,
} from "../src/serialization.js";
import { topology } from "../src/topology.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Conforming builder IDs and the non-conforming legacy IDs that replace them. */
const LEGACY_IDS: Readonly<Record<string, string>> = {
  rnWidth: "rn width",
  rnDepth: "1 depth",
  rnProfile: "rn profile",
  rnCenter: "rn center",
  "rnOutline.e0": "rn outline/e0",
  rnFixed: "rn fixed",
  rnExtrusion: "body #1",
  rnRounded: "rounded edges",
  rnPlate: "plate part",
  rnStack: "top stack",
  rnLeft: "left side",
  rnMain: "main output",
};

const RENAMES = {
  parameters: { "rn width": "rnWidth", "1 depth": "rnDepth" },
  nodes: {
    "rn profile": "rnProfile",
    "body #1": "rnExtrusion",
    "rounded edges": "rnRounded",
    "plate part": "rnPlate",
    "top stack": "rnStack",
  },
  outputs: { "main output": "rnMain" },
  sketchEntities: {
    "rn profile": {
      "rn center": "rnCenter",
      "rn outline/e0": "rnOutline.e0",
    },
  },
  sketchConstraints: { "rn profile": { "rn fixed": "rnFixed" } },
  assemblyOccurrences: { "top stack": { "0": "rnLeft" } },
} as const;

function conformingDocument(): DesignDocument {
  const cad = design("identity-rename-source");
  const width = cad.parameter.length("rnWidth", mm(20));
  const depth = cad.parameter.length("rnDepth", width.mul(0.25));
  const height = cad.parameter.length("height", mm(10));
  const steel = cad.material("steel", {
    name: "Rename Steel",
    massDensity: kgPerCubicMeter(7_850),
  });
  const profile = cad.sketch("rnProfile", plane.xy(), (sketch) => {
    const center = sketch.point("rnCenter", vec2(mm(0), mm(0)));
    sketch.fixed("rnFixed", center);
    return sketch.profile(
      sketch.rectangle("rnOutline", { width, height }),
    );
  });
  const extrusion = cad.extrude("rnExtrusion", profile, { distance: depth });
  const rim = topology.edges
    .createdBy(extrusion, {
      role: "extrude.edge.end-rim",
      source: { sketch: profile, entity: "rnOutline.e0" },
    })
    .select();
  const rounded = cad.fillet("rnRounded", extrusion, {
    edges: rim,
    radius: mm(1),
  });
  const plate = cad.part("rnPlate", rounded, {
    materialRef: steel,
    description: "Plate keeps its text",
  });
  const stack = cad.assembly("rnStack", (instances) => {
    instances.instance("rnLeft", plate);
    instances.instance("right", plate, {
      placement: [tf.translate(vec3(width, mm(0), mm(0)))],
    });
  });
  // Legacy configuration keys already use the v7 grammar, so they target
  // conforming identities while their expressions reference renamed ones.
  const rack = cad.assembly("rack", (instances) => {
    instances.instance("bay", stack);
  });
  cad.configuration("tall", (configuration) => {
    configuration.parameter(height, depth.mul(4));
    configuration.instanceSuppressed(rack, "bay");
  });
  cad.output("rack", rack);
  cad.output("rnMain", stack);
  cad.output("plate", plate);
  const document = JSON.parse(stringifyDocument(cad.build())) as Record<
    string,
    Json
  >;
  document.topologyReferences = {
    rim: {
      target: { node: "rnExtrusion", kind: "solid" },
      topology: "edge",
      variants: [
        {
          protocolVersion: 1,
          kernelFingerprint: "identity-rename-evidence",
          topology: "edge",
          capturedHistory: "complete",
          tolerance: { linear: 1e-7, angular: 1e-7, relative: 1e-7 },
          lineage: [
            {
              feature: "rnExtrusion",
              relation: "created",
              source: {
                kind: "sketch-entity",
                sketch: "rnProfile",
                entity: "rnOutline.e0",
              },
            },
          ],
          geometry: {
            topology: "edge",
            kind: "line",
            measure: 20,
            center: [0, -5, 5],
            bounds: { min: [-10, -5, 5], max: [10, -5, 5] },
            direction: [1, 0, 0],
          },
          adjacency: [
            {
              topology: "face",
              lineage: [{ feature: "rnExtrusion", relation: "created" }],
              geometry: {
                topology: "face",
                kind: "plane",
                measure: 200,
                center: [0, 0, 5],
                bounds: { min: [-10, -5, 5], max: [10, 5, 5] },
                normal: [0, 0, 1],
              },
            },
          ],
        },
      ],
    },
  };
  const parsed = parseDocumentValue(document);
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  return parsed.value;
}

/**
 * Independent oracle: replaces exact-match keys and string values, unlike the
 * structural rewriter under test. Builder IDs are chosen to collide with no
 * other string in the document.
 */
function replaceTokens(
  value: Json,
  replacements: Readonly<Record<string, string>>,
): Json {
  if (typeof value === "string") {
    return Object.hasOwn(replacements, value) ? replacements[value]! : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceTokens(item, replacements));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value)) {
      const renamed = Object.hasOwn(replacements, key)
        ? replacements[key]!
        : key;
      result[renamed] = replaceTokens(item, replacements);
    }
    return result;
  }
  return value;
}

function legacyDocument(
  source: DesignDocument = conformingDocument(),
): Record<string, Json> {
  return replaceTokens(
    JSON.parse(stringifyDocument(source)) as Json,
    LEGACY_IDS,
  ) as Record<string, Json>;
}

const legacyVersions = [
  [DOCUMENT_SCHEMA_V1, DOCUMENT_VERSION_V1, DesignDocumentV1Schema],
  [DOCUMENT_SCHEMA_V2, DOCUMENT_VERSION_V2, DesignDocumentV2Schema],
  [DOCUMENT_SCHEMA_V3, DOCUMENT_VERSION_V3, DesignDocumentV3Schema],
  [DOCUMENT_SCHEMA_V4, DOCUMENT_VERSION_V4, DesignDocumentV4Schema],
  [DOCUMENT_SCHEMA_V5, DOCUMENT_VERSION_V5, DesignDocumentV5Schema],
  [DOCUMENT_SCHEMA_V6, DOCUMENT_VERSION_V6, DesignDocumentV6Schema],
] as const;

function expectReason(
  result: { readonly ok: boolean; readonly diagnostics: readonly unknown[] },
  reason: string,
  path?: string,
): void {
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "IR_INVALID",
        ...(path === undefined ? {} : { path }),
        details: expect.objectContaining({ reason }),
      }),
    ]),
  );
}

describe("staged Document v7 identity renames", () => {
  it("migrates every frozen grammar with renames exactly as the conforming document migrates", () => {
    const conforming = conformingDocument();
    for (const [schema, version, parser] of legacyVersions) {
      const source = JSON.parse(stringifyDocument(conforming)) as Record<
        string,
        Json
      >;
      // Document v1 predates stored persistent topology references.
      if (version === DOCUMENT_VERSION_V1) delete source.topologyReferences;
      const original = parser.parse({
        ...source,
        schema,
        version,
      }) as DesignDocument;
      const expected = migrateDocumentToV7(original);
      expect(expected.ok, `v${version} oracle`).toBe(true);
      if (!expected.ok) continue;

      const legacy = parser.parse({
        ...legacyDocument(original),
        schema,
        version,
      }) as DesignDocument;
      expect(parseDocumentValue(legacy).ok, `v${version} legacy`).toBe(true);
      const before = stringifyDocument(legacy);
      expect(migrateDocumentToV7(legacy).ok, `v${version} default`).toBe(
        false,
      );

      const migrated = migrateDocumentToV7WithIdentityRenames(legacy, RENAMES);
      expect(migrated.ok, JSON.stringify(migrated.diagnostics)).toBe(true);
      if (!migrated.ok) continue;
      expect(stringifyDocumentV7(migrated.value.document)).toBe(
        stringifyDocumentV7(expected.value),
      );
      expect(stringifyDocument(legacy)).toBe(before);
      expect(Object.isFrozen(migrated.value)).toBe(true);
      expect(Object.isFrozen(migrated.value.identityRenames)).toBe(true);
      expect(migrated.value.identityRenames).toEqual([
        { kind: "parameter", from: "1 depth", to: "rnDepth", consumerVisible: false },
        { kind: "parameter", from: "rn width", to: "rnWidth", consumerVisible: false },
        { kind: "node", from: "body #1", to: "rnExtrusion", consumerVisible: false },
        { kind: "node", from: "plate part", to: "rnPlate", consumerVisible: false },
        { kind: "node", from: "rn profile", to: "rnProfile", consumerVisible: false },
        { kind: "node", from: "rounded edges", to: "rnRounded", consumerVisible: false },
        { kind: "node", from: "top stack", to: "rnStack", consumerVisible: false },
        { kind: "output", from: "main output", to: "rnMain", consumerVisible: true },
        {
          kind: "sketch-entity",
          from: "rn center",
          to: "rnCenter",
          scope: { from: "rn profile", to: "rnProfile" },
          consumerVisible: false,
        },
        {
          kind: "sketch-entity",
          from: "rn outline/e0",
          to: "rnOutline.e0",
          scope: { from: "rn profile", to: "rnProfile" },
          consumerVisible: false,
        },
        {
          kind: "sketch-constraint",
          from: "rn fixed",
          to: "rnFixed",
          scope: { from: "rn profile", to: "rnProfile" },
          consumerVisible: false,
        },
        {
          kind: "assembly-occurrence",
          from: "left side",
          to: "rnLeft",
          scope: { from: "top stack", to: "rnStack" },
          instanceIndex: 0,
          consumerVisible: false,
        },
      ]);
    }
  });

  it("never rewrites metadata or other free-form text", () => {
    const legacy = legacyDocument();
    legacy.metadata = { note: "rn width", owner: { node: "rn profile" } };
    const nodes = legacy.nodes as Record<string, Record<string, Json>>;
    nodes["plate part"]!.metadata = {
      lookalike: { op: "parameter", dimension: "length", id: "rn width" },
      ref: { node: "body #1", kind: "solid" },
    };
    nodes["plate part"]!.description = "rn width";
    const migrated = migrateDocumentToV7WithIdentityRenames(legacy, RENAMES);
    expect(migrated.ok, JSON.stringify(migrated.diagnostics)).toBe(true);
    if (!migrated.ok) return;
    const document = migrated.value.document;
    expect(document.metadata).toEqual(legacy.metadata);
    const plate = document.nodes["rnPlate" as never] as unknown as Record<
      string,
      Json
    >;
    expect(plate.metadata).toEqual(nodes["plate part"]!.metadata);
    expect(plate.description).toBe("rn width");
  });

  it("renames historical identities that exist only in stored lineage", () => {
    const legacy = legacyDocument();
    const reference = (legacy.topologyReferences as Record<string, Json>)
      .rim as Record<string, Json[]>;
    const variant = reference.variants![0] as Record<string, Json[]>;
    variant.lineage!.push({
      feature: "old feature",
      relation: "created",
      source: {
        kind: "sketch-entity",
        sketch: "old sketch",
        entity: "old/edge",
      },
    });
    const without = migrateDocumentToV7WithIdentityRenames(legacy, RENAMES);
    expectReason(
      without,
      "document-v7-id-grammar-incompatible",
      "/topologyReferences/rim/variants/0/lineage/1/feature",
    );
    const migrated = migrateDocumentToV7WithIdentityRenames(legacy, {
      ...RENAMES,
      nodes: {
        ...RENAMES.nodes,
        "old feature": "oldFeature",
        "old sketch": "oldSketch",
      },
      sketchEntities: {
        ...RENAMES.sketchEntities,
        "old sketch": { "old/edge": "oldEdge" },
      },
    });
    expect(migrated.ok, JSON.stringify(migrated.diagnostics)).toBe(true);
    if (!migrated.ok) return;
    const stored = migrated.value.document.topologyReferences as unknown as {
      readonly rim: {
        readonly variants: readonly { readonly lineage: readonly unknown[] }[];
      };
    };
    expect(stored.rim.variants[0]!.lineage).toContainEqual({
      feature: "oldFeature",
      relation: "created",
      source: { kind: "sketch-entity", sketch: "oldSketch", entity: "oldEdge" },
    });
    expect(migrated.value.identityRenames).toEqual(
      expect.arrayContaining([
        {
          kind: "sketch-entity",
          from: "old/edge",
          to: "oldEdge",
          scope: { from: "old sketch", to: "oldSketch" },
          consumerVisible: false,
        },
      ]),
    );
  });

  it("separates duplicate occurrences by index unless a configuration names them", () => {
    const cad = design("duplicate-occurrences");
    const box = cad.box("box", { size: vec3(mm(1), mm(2), mm(3)) });
    const part = cad.part("part", box);
    const assembly = cad.assembly("assembly", (instances) => {
      instances.instance("dup", part);
      instances.instance("other", part);
    });
    cad.output("assembly", assembly);
    const legacy = JSON.parse(stringifyDocument(cad.build())) as Record<
      string,
      Json
    >;
    const instances = (
      (legacy.nodes as Record<string, Record<string, Json>>).assembly!
        .instances as Record<string, Json>[]
    );
    instances[1]!.id = "dup";
    expect(parseDocumentValue(legacy).ok).toBe(true);
    expect(migrateDocumentToV7(legacy).ok).toBe(false);

    const migrated = migrateDocumentToV7WithIdentityRenames(legacy, {
      assemblyOccurrences: { assembly: { "1": "dupSecond" } },
    });
    expect(migrated.ok, JSON.stringify(migrated.diagnostics)).toBe(true);
    if (migrated.ok) {
      const assemblyNode = migrated.value.document.nodes[
        "assembly" as never
      ] as unknown as { readonly instances: readonly { readonly id: string }[] };
      expect(assemblyNode.instances.map((instance) => instance.id)).toEqual([
        "dup",
        "dupSecond",
      ]);
      expect(migrated.value.identityRenames).toEqual([
        {
          kind: "assembly-occurrence",
          from: "dup",
          to: "dupSecond",
          scope: { from: "assembly", to: "assembly" },
          instanceIndex: 1,
          consumerVisible: false,
        },
      ]);
    }

    legacy.configurations = {
      hidden: { instanceSuppressions: { assembly: { dup: true } } },
    };
    expect(parseDocumentValue(legacy).ok).toBe(true);
    expectReason(
      migrateDocumentToV7WithIdentityRenames(legacy, {
        assemblyOccurrences: { assembly: { "1": "dupSecond" } },
      }),
      "identity-rename-ambiguous-reference",
      "/identityRenames/assemblyOccurrences/assembly/1",
    );
  });

  it("rejects unknown, unnecessary, invalid, colliding, and incomplete renames", () => {
    const legacy = legacyDocument();
    const cases: readonly [unknown, string, string][] = [
      [
        { ...RENAMES, nodes: { ...RENAMES.nodes, "no such": "noSuch" } },
        "identity-rename-unknown-source",
        "/identityRenames/nodes/no such",
      ],
      [
        { ...RENAMES, outputs: { ...RENAMES.outputs, plate: "platePart" } },
        "identity-rename-not-required",
        "/identityRenames/outputs/plate",
      ],
      [
        { ...RENAMES, outputs: { "main output": "1main" } },
        "identity-rename-invalid-target",
        "/identityRenames/outputs/main output",
      ],
      [
        { ...RENAMES, outputs: { "main output": "plate" } },
        "identity-rename-collision",
        "/identityRenames/outputs/main output",
      ],
      [
        {
          ...RENAMES,
          parameters: { "rn width": "same", "1 depth": "same" },
        },
        "identity-rename-collision",
        "/identityRenames/parameters/1 depth",
      ],
      [
        {
          ...RENAMES,
          assemblyOccurrences: { "top stack": { "0": "right" } },
        },
        "identity-rename-collision",
        "/identityRenames/assemblyOccurrences/top stack/0",
      ],
      [
        {
          ...RENAMES,
          assemblyOccurrences: { "top stack": { "1": "rightSide" } },
        },
        "identity-rename-not-required",
        "/identityRenames/assemblyOccurrences/top stack/1",
      ],
      [
        {
          ...RENAMES,
          assemblyOccurrences: { "top stack": { "01": "rnLeft" } },
        },
        "identity-rename-unknown-source",
        "/identityRenames/assemblyOccurrences/top stack/01",
      ],
      [
        { ...RENAMES, sketchEntities: { "body #1": { x: "y" } } },
        "identity-rename-unknown-source",
        "/identityRenames/sketchEntities/body #1",
      ],
      [
        { ...RENAMES, nodes: "rn profile" },
        "identity-rename-map-malformed",
        "/identityRenames/nodes",
      ],
      [
        { ...RENAMES, outputs: { "main output": 7 } },
        "identity-rename-map-malformed",
        "/identityRenames/outputs/main output",
      ],
      [
        { ...RENAMES, aliases: {} },
        "identity-rename-map-malformed",
        "/identityRenames/aliases",
      ],
      [
        { ...RENAMES, outputs: {} },
        "document-v7-id-grammar-incompatible",
        "/outputs/main output",
      ],
    ];
    for (const [renames, reason, path] of cases) {
      expectReason(
        migrateDocumentToV7WithIdentityRenames(legacy, renames),
        reason,
        path,
      );
    }

    let reads = 0;
    const accessor = { ...RENAMES };
    Object.defineProperty(accessor, "outputs", {
      enumerable: true,
      get() {
        reads += 1;
        return RENAMES.outputs;
      },
    });
    const rejected = migrateDocumentToV7WithIdentityRenames(legacy, accessor);
    expect(rejected.ok).toBe(false);
    expect(rejected.diagnostics[0]?.path?.startsWith("/identityRenames")).toBe(
      true,
    );
    expect(reads).toBe(0);
  });

  it("keeps v7 input unchanged and rejects renames for it", () => {
    const migrated = migrateDocumentToV7(conformingDocument());
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const passthrough = migrateDocumentToV7WithIdentityRenames(
      migrated.value,
      {},
    );
    expect(passthrough.ok).toBe(true);
    if (passthrough.ok) {
      expect(stringifyDocumentV7(passthrough.value.document)).toBe(
        stringifyDocumentV7(migrated.value),
      );
      expect(passthrough.value.identityRenames).toEqual([]);
    }
    expectReason(
      migrateDocumentToV7WithIdentityRenames(migrated.value, {
        nodes: { rnProfile: "profile" },
      }),
      "identity-renames-require-legacy-document",
      "/identityRenames",
    );
  });
});
