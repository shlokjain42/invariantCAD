import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { CadResult } from "../src/core/result.js";
import {
  DESIGN_FEATURE_HASH_REPORT_VERSION_V2,
  FEATURE_HASH_DOMAIN_V2,
  FEATURE_HASH_PREFIX_V2,
  FEATURE_HASH_PROTOCOL_VERSION_V2,
  FEATURE_HASH_RESOURCE_DOMAIN_V2,
  FEATURE_HASH_TOPOLOGY_REFERENCE_DOMAIN_V2,
  hashDesignFeaturesV2,
  type DesignFeatureHashReportV2,
  type FeatureHashV2,
} from "../src/feature-hashes-v2.js";
import {
  hashDesignFeatures,
  type FeatureHash,
} from "../src/feature-hashes.js";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_SCHEMA_V6,
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  NODE_KINDS_V7,
  type DesignDocument,
  type DesignDocumentV7,
} from "../src/ir.js";
import {
  migrateDocumentToV7,
  parseDocumentValueV7,
} from "../src/serialization.js";
import {
  captureTopologyReference,
  type PersistentTopologyReference,
} from "../src/topology-signatures.js";
import type { KernelTopologyKey } from "../src/protocol/topology.js";

const length = (value: number) =>
  ({ op: "literal", dimension: "length", value }) as const;
const scalar = (value: number) =>
  ({ op: "literal", dimension: "scalar", value }) as const;
const angle = (value: number) =>
  ({ op: "literal", dimension: "angle", value }) as const;
const density = (value: number) =>
  ({ op: "literal", dimension: "massDensity", value }) as const;
const parameter = (id: string) =>
  ({ op: "parameter", dimension: "length", id }) as const;
const point = (x: number, y: number, z: number) =>
  [length(x), length(y), length(z)] as const;

function topologyKey(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

function edgeReference(
  fingerprint = "feature-hash-v2/signatures@1",
): PersistentTopologyReference<"edge"> {
  const edge = topologyKey("captured-edge");
  const captured = captureTopologyReference(
    {
      history: "complete",
      faces: [],
      edges: [
        {
          topology: "edge",
          key: edge,
          center: [0, 0, 0.5],
          bounds: { min: [0, 0, 0], max: [0, 0, 1] },
          lineage: [
            {
              feature: "box",
              relation: "created",
              role: "box.edge.x-min-y-min",
            },
          ],
          length: 1,
          curve: { kind: "line", direction: [0, 0, 1] },
          faces: [],
          vertices: [],
        },
      ],
      vertices: [],
    },
    "edge",
    edge,
    {
      capabilities: { protocolVersion: 1, fingerprint },
      tolerance: { linear: 1e-6, angular: 1e-6, relative: 1e-8 },
    },
  );
  if (!captured.ok) throw new Error(JSON.stringify(captured.diagnostics));
  return captured.value;
}

function comprehensiveDocument(): DesignDocumentV7 {
  const zero = point(0, 0, 0);
  const one = point(1, 1, 1);
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "feature-hash-v2",
    units: { length: "mm", angle: "rad", mass: "kg" },
    parameters: {
      width: {
        dimension: "length",
        default: length(10),
        min: length(1),
        max: length(100),
      },
    },
    materials: {
      steel: {
        name: "Steel",
        massDensity: density(7.85e-6),
        metadata: { family: "ferrous" },
      },
      aluminum: {
        name: "Aluminum",
        massDensity: density(2.7e-6),
        metadata: { family: "non-ferrous" },
      },
    },
    configurations: {
      configured: {
        parameterOverrides: { width: length(20) },
        partMaterialOverrides: { part: "aluminum" },
        instanceSuppressions: {
          assembly: { externalOne: true, externalTwo: true },
        },
      },
    },
    resources: {
      externalDocument: {
        digest: `sha256:${"1".repeat(64)}`,
        byteLength: 2_048,
        mediaType: "application/vnd.invariantcad.document+json",
        locations: ["https://example.invalid/external.icad"],
        metadata: { revision: 3 },
      },
      importedStep: {
        digest: `sha256:${"0".repeat(64)}`,
        byteLength: 1_024,
        mediaType: "model/step",
        locations: ["file:///models/source.step"],
        metadata: { supplier: "example" },
      },
      unused: {
        digest: `sha256:${"2".repeat(64)}`,
        byteLength: 8,
        mediaType: "application/octet-stream",
        locations: ["memory:unused"],
      },
    },
    nodes: {
      datumPoint: { kind: "datumPoint", position: zero },
      datumAxis: {
        kind: "datumAxis",
        origin: zero,
        direction: [scalar(0), scalar(0), scalar(1)],
      },
      datumPlane: {
        kind: "datumPlane",
        origin: zero,
        xDirection: [scalar(1), scalar(0), scalar(0)],
        normal: [scalar(0), scalar(0), scalar(1)],
      },
      coordinateSystem: {
        kind: "coordinateSystem",
        origin: zero,
        xDirection: [scalar(1), scalar(0), scalar(0)],
        yDirection: [scalar(0), scalar(1), scalar(0)],
      },
      sketch: {
        kind: "sketch",
        plane: {
          type: "datum",
          datum: { node: "datumPlane", kind: "datumPlane" },
        },
        entities: {
          center: { kind: "point", x: length(0), y: length(0) },
          circle: { kind: "circle", center: "center", radius: length(2) },
        },
        constraints: {},
        profile: {
          outer: { kind: "circle", entity: "circle" },
          holes: [],
        },
        tolerance: 1e-7,
      },
      sketchUpper: {
        kind: "sketch",
        plane: {
          type: "principal",
          plane: "XY",
          origin: point(0, 0, 5),
        },
        entities: {
          center: { kind: "point", x: length(0), y: length(0) },
          circle: { kind: "circle", center: "center", radius: length(1) },
        },
        constraints: {},
        profile: {
          outer: { kind: "circle", entity: "circle" },
          holes: [],
        },
        tolerance: 1e-7,
      },
      polylinePath: {
        kind: "polylinePath",
        points: [zero, one],
        closed: false,
        tolerance: 1e-7,
      },
      circularArcPath: {
        kind: "circularArcPath",
        start: zero,
        through: point(1, 1, 0),
        end: point(2, 0, 0),
        closed: false,
        tolerance: 1e-7,
      },
      compositePath: {
        kind: "compositePath",
        start: zero,
        segments: [
          { kind: "line", end: point(1, 0, 0) },
          {
            kind: "circularArc",
            through: point(1.5, 0.5, 0),
            end: point(2, 0, 0),
          },
        ],
        closed: false,
        tolerance: 1e-7,
      },
      box: {
        kind: "box",
        size: [parameter("width"), length(2), length(3)],
        center: false,
      },
      cylinder: {
        kind: "cylinder",
        height: length(3),
        radiusBottom: length(1),
        radiusTop: length(1),
        center: false,
      },
      sphere: { kind: "sphere", radius: length(1) },
      extrude: {
        kind: "extrude",
        profile: { node: "sketch", kind: "profile" },
        distance: length(4),
        symmetric: false,
        twist: angle(0),
        scaleTop: [scalar(1), scalar(1)],
        divisions: 0,
      },
      revolve: {
        kind: "revolve",
        profile: { node: "sketch", kind: "profile" },
        angle: angle(Math.PI),
      },
      loft: {
        kind: "loft",
        profiles: [
          { node: "sketch", kind: "profile" },
          { node: "sketchUpper", kind: "profile" },
        ],
        ruled: true,
      },
      sweep: {
        kind: "sweep",
        profile: { node: "sketch", kind: "profile" },
        path: { node: "polylinePath", kind: "path" },
        transition: "right-corner",
        frame: "corrected-frenet",
      },
      boolean: {
        kind: "boolean",
        operation: "union",
        target: { node: "box", kind: "solid" },
        tools: [{ node: "cylinder", kind: "solid" }],
      },
      transform: {
        kind: "transform",
        input: { node: "box", kind: "solid" },
        operations: [{ kind: "translate", value: point(1, 0, 0) }],
      },
      fillet: {
        kind: "fillet",
        input: { node: "box", kind: "solid" },
        edges: {
          topology: "edge",
          query: { op: "persistentReference", reference: "storedEdge" },
          cardinality: { min: 1 },
        },
        radius: length(0.1),
      },
      chamfer: {
        kind: "chamfer",
        input: { node: "box", kind: "solid" },
        edges: {
          topology: "edge",
          query: { op: "all" },
          cardinality: { min: 1 },
        },
        distance: length(0.1),
      },
      shell: {
        kind: "shell",
        input: { node: "box", kind: "solid" },
        openings: {
          topology: "face",
          query: { op: "all" },
          cardinality: { min: 1 },
        },
        thickness: length(0.1),
        direction: "inward",
        tolerance: length(1e-7),
      },
      offset: {
        kind: "offset",
        input: { node: "box", kind: "solid" },
        distance: length(0.1),
        direction: "outward",
        tolerance: length(1e-7),
      },
      draft: {
        kind: "draft",
        input: { node: "box", kind: "solid" },
        faces: {
          topology: "face",
          query: { op: "all" },
          cardinality: { min: 1 },
        },
        angle: angle(0.05),
        pullDirection: [scalar(0), scalar(0), scalar(1)],
        neutralPlane: {
          origin: zero,
          normal: [scalar(0), scalar(0), scalar(1)],
        },
      },
      importedBody: {
        kind: "importedBody",
        resource: "importedStep",
        format: "step",
        units: { mode: "from-file" },
        healing: { mode: "none" },
        expected: "single-solid",
      },
      bodySet: {
        kind: "bodySet",
        bodies: [
          {
            id: "primary",
            solid: { node: "box", kind: "solid" },
            name: "Primary body",
            metadata: { manufacturing: "machined" },
          },
          {
            id: "supplied",
            solid: { node: "importedBody", kind: "solid" },
            metadata: { manufacturing: "purchased" },
          },
        ],
      },
      part: {
        kind: "part",
        geometry: { node: "bodySet", kind: "bodySet" },
        partNumber: "FH2-001",
        materialId: "steel",
        metadata: { lifecycle: "prototype" },
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
            id: "externalOne",
            component: {
              source: "external",
              resource: "externalDocument",
              output: "main",
              outputKind: "part",
            },
            configuration: { mode: "base" },
            placement: [],
            suppressed: false,
          },
          {
            id: "externalTwo",
            component: {
              source: "external",
              resource: "externalDocument",
              output: "nested",
              outputKind: "assembly",
            },
            configuration: { mode: "named", id: "externalRelease" },
            placement: [{ kind: "translate", value: point(5, 0, 0) }],
            suppressed: false,
          },
        ],
      },
    },
    outputs: {
      assembly: { node: "assembly", kind: "assembly" },
      bodySet: { node: "bodySet", kind: "bodySet" },
      imported: { node: "importedBody", kind: "solid" },
      part: { node: "part", kind: "part" },
      solid: { node: "box", kind: "solid" },
    },
    topologyReferences: {
      storedEdge: {
        target: { node: "box", kind: "solid" },
        topology: "edge",
        variants: [edgeReference()],
      },
    },
  } as unknown as DesignDocumentV7;
}

function clone(document: DesignDocumentV7): DesignDocumentV7 {
  return structuredClone(document);
}

async function reportValue(
  result: Promise<CadResult<DesignFeatureHashReportV2>>,
): Promise<DesignFeatureHashReportV2> {
  const resolved = await result;
  expect(resolved.ok, JSON.stringify(resolved.diagnostics)).toBe(true);
  if (!resolved.ok) throw new Error("Expected protocol-v2 feature hashes");
  return resolved.value;
}

function hashFor(
  report: DesignFeatureHashReportV2,
  node: string,
): FeatureHashV2 {
  const entry = report.nodes.find((candidate) => candidate.node === node);
  if (entry === undefined) throw new Error(`Missing feature hash for '${node}'`);
  return entry.hash;
}

function expectDeeplyFrozen(
  value: unknown,
  seen = new Set<object>(),
): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

async function minimumCanonicalByteBudget(
  document: DesignDocumentV7,
): Promise<number> {
  const succeeds = async (maxCanonicalBytes: number): Promise<boolean> => {
    const result = await hashDesignFeaturesV2(document, {
      limits: { maxCanonicalBytes },
    });
    if (!result.ok) {
      const resource = result.diagnostics[0]?.details?.resource;
      if (resource !== "maxCanonicalBytes") {
        throw new Error(JSON.stringify(result.diagnostics));
      }
    }
    return result.ok;
  };

  let failing = 0;
  let passing = 1;
  while (!(await succeeds(passing))) passing *= 2;
  while (passing - failing > 1) {
    const candidate = Math.floor((passing + failing) / 2);
    if (await succeeds(candidate)) passing = candidate;
    else failing = candidate;
  }
  return passing;
}

function mutateResource(
  document: DesignDocumentV7,
  id: "importedStep" | "externalDocument" | "unused",
  update: (resource: Record<string, unknown>) => void,
): DesignDocumentV7 {
  const changed = clone(document) as unknown as {
    resources: Record<string, Record<string, unknown>>;
  };
  update(changed.resources[id]!);
  return changed as unknown as DesignDocumentV7;
}

describe("document-v7 feature hashes protocol v2", () => {
  it("hashes every v7 node kind into a tagged, deterministic, frozen report", async () => {
    const document = comprehensiveDocument();
    const parsed = parseDocumentValueV7(document);
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true);

    const first = await reportValue(hashDesignFeaturesV2(document));
    const second = await reportValue(hashDesignFeaturesV2(clone(document)));

    expect(FEATURE_HASH_PROTOCOL_VERSION_V2).toBe(2);
    expect(DESIGN_FEATURE_HASH_REPORT_VERSION_V2).toBe(2);
    expect(FEATURE_HASH_DOMAIN_V2).toBe("invariantcad.feature.v2");
    expect(FEATURE_HASH_RESOURCE_DOMAIN_V2).toBe(
      "invariantcad.feature.resource.v2",
    );
    expect(FEATURE_HASH_TOPOLOGY_REFERENCE_DOMAIN_V2).toBe(
      "invariantcad.feature.topology-reference.v2",
    );
    expect(first).toEqual(second);
    expect(first.version).toBe(2);
    expect(first.hashProtocolVersion).toBe(2);
    expect(first.configurationId).toBeNull();
    expect([...new Set(first.nodes.map(({ kind }) => kind))].sort()).toEqual(
      [...NODE_KINDS_V7].sort(),
    );
    for (const entry of first.nodes) {
      expect(entry.hash).toMatch(
        new RegExp(`^${FEATURE_HASH_PREFIX_V2}[0-9a-f]{64}$`),
      );
    }
    expect(
      first.nodes.find(({ node }) => node === "importedBody")?.resources,
    ).toEqual(["importedStep"]);
    expect(
      first.nodes.find(({ node }) => node === "assembly")?.resources,
    ).toEqual(["externalDocument"]);
    expect(
      first.nodes.find(({ node }) => node === "fillet")?.topologyReferences,
    ).toEqual(["storedEdge"]);
    expectDeeplyFrozen(first);
    expectTypeOf(first).toEqualTypeOf<DesignFeatureHashReportV2>();
  });

  it("excludes locations but binds every semantic resource commitment field", async () => {
    const document = comprehensiveDocument();
    const baseline = await reportValue(hashDesignFeaturesV2(document));
    const locations = mutateResource(document, "importedStep", (resource) => {
      resource.locations = [
        "https://mirror.invalid/source.step",
        "memory:verified-source",
      ];
    });
    const locationOnly = await reportValue(hashDesignFeaturesV2(locations));

    expect(hashFor(locationOnly, "importedBody")).toBe(
      hashFor(baseline, "importedBody"),
    );
    expect(hashFor(locationOnly, "assembly")).toBe(
      hashFor(baseline, "assembly"),
    );

    const updates: readonly ((resource: Record<string, unknown>) => void)[] = [
      (resource) => {
        resource.digest = `sha256:${"a".repeat(64)}`;
      },
      (resource) => {
        resource.byteLength = 1_025;
      },
      (resource) => {
        resource.mediaType = "application/step";
      },
      (resource) => {
        resource.metadata = { supplier: "changed" };
      },
    ];
    for (const update of updates) {
      const changed = await reportValue(
        hashDesignFeaturesV2(
          mutateResource(document, "importedStep", update),
        ),
      );
      expect(hashFor(changed, "importedBody")).not.toBe(
        hashFor(baseline, "importedBody"),
      );
      expect(hashFor(changed, "bodySet")).not.toBe(
        hashFor(baseline, "bodySet"),
      );
      expect(hashFor(changed, "part")).not.toBe(hashFor(baseline, "part"));
    }

    const unused = mutateResource(document, "unused", (resource) => {
      resource.metadata = { ignoredBecauseUnreachable: true };
    });
    expect(await reportValue(hashDesignFeaturesV2(unused))).toEqual(baseline);
  });

  it("commits external outputs and resources once while retaining occurrences", async () => {
    const document = comprehensiveDocument();
    const baseline = await reportValue(hashDesignFeaturesV2(document));
    const commitment = mutateResource(
      document,
      "externalDocument",
      (resource) => {
        resource.metadata = { revision: 4 };
      },
    );
    const changedCommitment = await reportValue(
      hashDesignFeaturesV2(commitment),
    );
    expect(hashFor(changedCommitment, "assembly")).not.toBe(
      hashFor(baseline, "assembly"),
    );
    expect(hashFor(changedCommitment, "part")).toBe(hashFor(baseline, "part"));

    const output = clone(document) as unknown as {
      nodes: {
        assembly: {
          instances: {
            component: { output: string };
            configuration: { mode: string; id?: string };
          }[];
        };
      };
    };
    output.nodes.assembly.instances[1]!.component.output = "alternate";
    const changedOutput = await reportValue(
      hashDesignFeaturesV2(output as unknown as DesignDocumentV7),
    );
    expect(hashFor(changedOutput, "assembly")).not.toBe(
      hashFor(baseline, "assembly"),
    );

    output.nodes.assembly.instances[1]!.configuration = {
      mode: "named",
      id: "externalAlternative",
    };
    const changedOccurrenceConfiguration = await reportValue(
      hashDesignFeaturesV2(output as unknown as DesignDocumentV7),
    );
    expect(hashFor(changedOccurrenceConfiguration, "assembly")).not.toBe(
      hashFor(changedOutput, "assembly"),
    );
  });

  it("binds body-set member identity, names, metadata, and dependency intent", async () => {
    const document = comprehensiveDocument();
    const baseline = await reportValue(hashDesignFeaturesV2(document));
    const mutations: readonly ((body: Record<string, unknown>) => void)[] = [
      (body) => {
        body.id = "renamed";
      },
      (body) => {
        body.name = "Renamed body";
      },
      (body) => {
        body.metadata = { manufacturing: "cast" };
      },
      (body) => {
        body.solid = { node: "sphere", kind: "solid" };
      },
    ];
    for (const mutate of mutations) {
      const changed = clone(document) as unknown as {
        nodes: { bodySet: { bodies: Record<string, unknown>[] } };
      };
      mutate(changed.nodes.bodySet.bodies[0]!);
      const report = await reportValue(
        hashDesignFeaturesV2(changed as unknown as DesignDocumentV7),
      );
      expect(hashFor(report, "bodySet")).not.toBe(
        hashFor(baseline, "bodySet"),
      );
      expect(hashFor(report, "part")).not.toBe(hashFor(baseline, "part"));
    }
  });

  it("uses effective parameters, material overrides, and suppression semantics", async () => {
    const document = comprehensiveDocument();
    const base = await reportValue(hashDesignFeaturesV2(document));
    const configured = await reportValue(
      hashDesignFeaturesV2(document, { configuration: "configured" }),
    );
    const callTime = await reportValue(
      hashDesignFeaturesV2(document, {
        configuration: "configured",
        parameters: { width: 10 },
      }),
    );

    expect(configured.configurationId).toBe("configured");
    expect(configured.parameterValues).toEqual({ width: 20 });
    expect(hashFor(configured, "box")).not.toBe(hashFor(base, "box"));
    expect(hashFor(callTime, "box")).toBe(hashFor(base, "box"));
    expect(hashFor(configured, "part")).not.toBe(hashFor(base, "part"));
    expect(
      configured.nodes.find(({ node }) => node === "assembly")?.resources,
    ).toEqual([]);
    expect(
      configured.nodes.find(({ node }) => node === "assembly")?.dependencies,
    ).toEqual(["part"]);

    const externalChanged = mutateResource(
      document,
      "externalDocument",
      (resource) => {
        resource.digest = `sha256:${"f".repeat(64)}`;
      },
    );
    const configuredExternalChanged = await reportValue(
      hashDesignFeaturesV2(externalChanged, {
        configuration: "configured",
      }),
    );
    expect(hashFor(configuredExternalChanged, "assembly")).toBe(
      hashFor(configured, "assembly"),
    );
  });

  it("hashes only consumed persistent evidence and normalizes variant order", async () => {
    const document = comprehensiveDocument();
    const base = await reportValue(hashDesignFeaturesV2(document));
    const changed = clone(document) as unknown as {
      topologyReferences: {
        storedEdge: {
          variants: PersistentTopologyReference<"edge">[];
        };
      };
    };
    changed.topologyReferences.storedEdge.variants = [
      edgeReference("feature-hash-v2/signatures@2"),
      ...changed.topologyReferences.storedEdge.variants,
    ];
    const forward = await reportValue(
      hashDesignFeaturesV2(changed as unknown as DesignDocumentV7),
    );
    changed.topologyReferences.storedEdge.variants.reverse();
    const reverse = await reportValue(
      hashDesignFeaturesV2(changed as unknown as DesignDocumentV7),
    );

    expect(hashFor(forward, "fillet")).not.toBe(hashFor(base, "fillet"));
    expect(hashFor(reverse, "fillet")).toBe(hashFor(forward, "fillet"));
    expect(hashFor(forward, "box")).toBe(hashFor(base, "box"));
  });

  it("normalizes equivalent v1-v6 migrations under protocol v2", async () => {
    const schemas = [
      { schema: DOCUMENT_SCHEMA_V1, version: 1 },
      { schema: DOCUMENT_SCHEMA_V2, version: 2 },
      { schema: DOCUMENT_SCHEMA_V3, version: 3 },
      { schema: DOCUMENT_SCHEMA_V4, version: 4 },
      { schema: DOCUMENT_SCHEMA_V5, version: 5 },
      { schema: DOCUMENT_SCHEMA_V6, version: 6 },
    ] as const;
    const body = {
      name: "migration-equivalence",
      units: { length: "mm", angle: "rad" },
      parameters: {},
      nodes: {
        body: {
          kind: "box",
          size: [length(1), length(2), length(3)],
          center: false,
        },
      },
      outputs: { body: { node: "body", kind: "solid" } },
    };
    const hashes: FeatureHashV2[] = [];
    for (const version of schemas) {
      const migrated = migrateDocumentToV7({ ...body, ...version });
      expect(migrated.ok, JSON.stringify(migrated.diagnostics)).toBe(true);
      if (!migrated.ok) throw new Error("Expected v7 migration");
      const report = await reportValue(hashDesignFeaturesV2(migrated.value));
      hashes.push(hashFor(report, "body"));
    }
    expect(new Set(hashes).size).toBe(1);
  });

  it("enforces validation, context, cancellation, and work limits", async () => {
    const document = comprehensiveDocument();
    const wrongGrammar = {
      ...document,
      schema: DOCUMENT_SCHEMA_V6,
      version: 6,
    };
    expect(
      (
        await hashDesignFeaturesV2(
          wrongGrammar as unknown as DesignDocumentV7,
        )
      ).ok,
    ).toBe(false);

    const missingConfiguration = await hashDesignFeaturesV2(document, {
      configuration: "missing",
    });
    expect(missingConfiguration.ok).toBe(false);
    if (!missingConfiguration.ok) {
      expect(missingConfiguration.diagnostics[0]?.code).toBe(
        "CONFIGURATION_MISSING",
      );
    }

    const nodeLimit = await hashDesignFeaturesV2(document, {
      limits: { maxFeatureNodes: 1 },
    });
    expect(nodeLimit.ok).toBe(false);
    if (!nodeLimit.ok) {
      expect(nodeLimit.diagnostics[0]?.details).toMatchObject({
        phase: "featureHashV2",
        resource: "maxFeatureNodes",
      });
    }
    const dependencyLimit = await hashDesignFeaturesV2(document, {
      limits: { maxDependencyLinks: 0 },
    });
    expect(dependencyLimit.ok).toBe(false);
    if (!dependencyLimit.ok) {
      expect(dependencyLimit.diagnostics[0]?.details).toMatchObject({
        resource: "maxDependencyLinks",
      });
    }
    const byteLimit = await hashDesignFeaturesV2(document, {
      limits: { maxCanonicalBytes: 0 },
    });
    expect(byteLimit.ok).toBe(false);
    if (!byteLimit.ok) {
      expect(byteLimit.diagnostics[0]?.details).toMatchObject({
        resource: "maxCanonicalBytes",
      });
    }

    const controller = new AbortController();
    controller.abort();
    const aborted = await hashDesignFeaturesV2(document, {
      signal: controller.signal,
    });
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) {
      expect(aborted.diagnostics[0]).toMatchObject({
        code: "EVALUATION_ABORTED",
        details: { phase: "featureHashV2" },
      });
    }

    const invalidSignal = await hashDesignFeaturesV2(document, {
      signal: { aborted: false } as AbortSignal,
    });
    expect(invalidSignal.ok).toBe(false);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(
      (
        await hashDesignFeaturesV2(
          document,
          revoked.proxy as never,
        )
      ).ok,
    ).toBe(false);
    const crossRealm = runInNewContext("({ parameters: { width: 10 } })") as {
      readonly parameters: Readonly<Record<string, number>>;
    };
    expect((await hashDesignFeaturesV2(document, crossRealm)).ok).toBe(true);
  });

  it("enforces the exact cumulative canonical-byte boundary and in-flight cancellation", async () => {
    const document = comprehensiveDocument();
    const exact = await minimumCanonicalByteBudget(document);
    expect(
      (
        await hashDesignFeaturesV2(document, {
          limits: { maxCanonicalBytes: exact },
        })
      ).ok,
    ).toBe(true);
    const short = await hashDesignFeaturesV2(document, {
      limits: { maxCanonicalBytes: exact - 1 },
    });
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.diagnostics[0]?.details).toMatchObject({
        resource: "maxCanonicalBytes",
        limit: exact - 1,
        actual: exact,
      });
    }

    const controller = new AbortController();
    const pending = hashDesignFeaturesV2(document, {
      signal: controller.signal,
    });
    controller.abort();
    const aborted = await pending;
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) {
      expect(aborted.diagnostics[0]?.code).toBe("EVALUATION_ABORTED");
    }
  });

  it("uses captured encoding and cryptographic intrinsics after global mutation", async () => {
    const document = comprehensiveDocument();
    const baseline = await reportValue(hashDesignFeaturesV2(document));
    const subtlePrototype = Object.getPrototypeOf(
      globalThis.crypto.subtle,
    ) as object;
    const encoderPrototype = Object.getPrototypeOf(
      new TextEncoder(),
    ) as object;
    const originalDigest = Object.getOwnPropertyDescriptor(
      subtlePrototype,
      "digest",
    );
    const originalEncode = Object.getOwnPropertyDescriptor(
      encoderPrototype,
      "encode",
    );
    expect(originalDigest?.value).toBeTypeOf("function");
    expect(originalEncode?.value).toBeTypeOf("function");
    try {
      Object.defineProperty(subtlePrototype, "digest", {
        ...originalDigest,
        value: async () => new ArrayBuffer(32),
      });
      Object.defineProperty(encoderPrototype, "encode", {
        ...originalEncode,
        value: () => new Uint8Array([0]),
      });

      expect(await reportValue(hashDesignFeaturesV2(document))).toEqual(
        baseline,
      );
    } finally {
      Object.defineProperty(subtlePrototype, "digest", originalDigest!);
      Object.defineProperty(encoderPrototype, "encode", originalEncode!);
    }
  });

  it("preserves the protocol-v1 frozen vector and keeps v2 separately branded", async () => {
    const document = {
      schema: DOCUMENT_SCHEMA_V6,
      version: 6,
      name: "feature-merkle",
      units: { length: "mm", angle: "rad" },
      parameters: {
        width: { dimension: "length", default: length(10) },
      },
      nodes: {
        body: {
          kind: "box",
          size: [parameter("width"), length(4), length(2)],
          center: false,
        },
      },
      outputs: { body: { node: "body", kind: "solid" } },
    } as unknown as DesignDocument;
    const v1 = await hashDesignFeatures(document);
    expect(v1.ok, JSON.stringify(v1.diagnostics)).toBe(true);
    if (!v1.ok) throw new Error("Expected protocol-v1 feature hash");
    expect(v1.value.nodes[0]?.hash).toBe(
      "invariantcad:feature:v1:sha256:c25f71a730f5558f7fb305df253b4e961333498d56cd18c8d0b4a94f19a31621",
    );

    const migrated = migrateDocumentToV7(document);
    expect(migrated.ok, JSON.stringify(migrated.diagnostics)).toBe(true);
    if (!migrated.ok) throw new Error("Expected v7 migration");
    const v2 = await reportValue(hashDesignFeaturesV2(migrated.value));
    expect(hashFor(v2, "body")).toBe(
      "invariantcad:feature:v2:sha256:63051170d1d5f530c363288e0de8474d3f30f7cf08cb6ea72a0c099245375198",
    );
    expect(hashFor(v2, "body")).not.toBe(v1.value.nodes[0]?.hash);
    expectTypeOf<
      FeatureHashV2 extends FeatureHash ? true : false
    >().toEqualTypeOf<false>();
  });
});
