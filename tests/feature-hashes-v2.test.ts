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
          subassembly: { inner: true },
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
      subassembly: {
        kind: "assembly",
        instances: [
          {
            id: "inner",
            component: {
              source: "local",
              reference: { node: "part", kind: "part" },
            },
            configuration: { mode: "inherit" },
            placement: [],
            suppressed: false,
          },
        ],
      },
      assembly: {
        kind: "assembly",
        instances: [
          {
            id: "local",
            component: {
              source: "local",
              reference: { node: "subassembly", kind: "assembly" },
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

function entryFor(
  report: DesignFeatureHashReportV2,
  node: string,
) {
  const entry = report.nodes.find((candidate) => candidate.node === node);
  if (entry === undefined) throw new Error(`Missing feature hash for '${node}'`);
  return entry;
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

function expectRealmFailure(
  result: CadResult<DesignFeatureHashReportV2>,
): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics[0]).toMatchObject({
      code: "IR_INVALID",
      details: {
        phase: "featureHashV2",
        resource: "realmIntegrity",
      },
    });
  }
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
    ).toEqual(["subassembly"]);

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

  it("expands local occurrence contexts while reporting only the root context", async () => {
    const document = comprehensiveDocument();
    const base = await reportValue(hashDesignFeaturesV2(document));
    const configured = await reportValue(
      hashDesignFeaturesV2(document, { configuration: "configured" }),
    );

    const explicitBase = clone(document) as unknown as {
      nodes: {
        assembly: {
          instances: { configuration: { mode: string; id?: string } }[];
        };
      };
    };
    explicitBase.nodes.assembly.instances[0]!.configuration = {
      mode: "base",
    };
    const explicitBaseReport = await reportValue(
      hashDesignFeaturesV2(
        explicitBase as unknown as DesignDocumentV7,
      ),
    );
    expect(hashFor(explicitBaseReport, "assembly")).toBe(
      hashFor(base, "assembly"),
    );

    const named = clone(document) as unknown as {
      nodes: {
        assembly: {
          instances: { configuration: { mode: string; id?: string } }[];
        };
      };
    };
    named.nodes.assembly.instances[0]!.configuration = {
      mode: "named",
      id: "configured",
    };
    const namedReport = await reportValue(
      hashDesignFeaturesV2(named as unknown as DesignDocumentV7),
    );
    const namedDependency =
      entryFor(namedReport, "assembly").contextualDependencies[0]!;
    expect(namedDependency).toEqual({
      node: "subassembly",
      kind: "assembly",
      configurationId: "configured",
      featureHash: hashFor(configured, "subassembly"),
    });
    expect(entryFor(namedReport, "subassembly").dependencies).toEqual([
      "part",
    ]);
    expect(entryFor(configured, "subassembly").dependencies).toEqual([]);

    const explicitConfigured = clone(document) as unknown as {
      nodes: {
        assembly: {
          instances: { configuration: { mode: string; id?: string } }[];
        };
      };
    };
    explicitConfigured.nodes.assembly.instances[0]!.configuration = {
      mode: "named",
      id: "configured",
    };
    const explicitConfiguredReport = await reportValue(
      hashDesignFeaturesV2(
        explicitConfigured as unknown as DesignDocumentV7,
        { configuration: "configured" },
      ),
    );
    expect(hashFor(explicitConfiguredReport, "assembly")).toBe(
      hashFor(configured, "assembly"),
    );
    expect(
      entryFor(configured, "assembly").contextualDependencies[0],
    ).toMatchObject({
      configurationId: "configured",
      featureHash: hashFor(configured, "subassembly"),
    });

    expect(namedReport.nodes).toHaveLength(base.nodes.length);
    const expandedLimit = await hashDesignFeaturesV2(
      named as unknown as DesignDocumentV7,
      { limits: { maxFeatureNodes: base.nodes.length } },
    );
    expect(expandedLimit.ok).toBe(false);
    if (!expandedLimit.ok) {
      expect(expandedLimit.diagnostics[0]?.details).toMatchObject({
        resource: "maxFeatureNodes",
        actual: base.nodes.length + 1,
      });
    }
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
    const topologyLimit = await hashDesignFeaturesV2(document, {
      limits: { maxTopologyWork: 0 },
    });
    expect(topologyLimit.ok).toBe(false);
    if (!topologyLimit.ok) {
      expect(topologyLimit.diagnostics[0]?.details).toMatchObject({
        resource: "maxTopologyWork",
        limit: 0,
        actual: 1,
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

  it("counts consumed topology-reference hash edges in the dependency-link boundary", async () => {
    const document = {
      schema: DOCUMENT_SCHEMA_V7,
      version: DOCUMENT_VERSION_V7,
      name: "feature-hash-v2-link-budget",
      units: { length: "mm", angle: "rad" },
      parameters: {},
      nodes: {
        box: {
          kind: "box",
          size: [length(1), length(2), length(3)],
          center: false,
        },
        fillet: {
          kind: "fillet",
          input: { node: "box", kind: "solid" },
          edges: {
            topology: "edge",
            query: {
              op: "persistentReference",
              reference: "storedEdge",
            },
            cardinality: { min: 1 },
          },
          radius: length(0.1),
        },
      },
      outputs: { result: { node: "fillet", kind: "solid" } },
      topologyReferences: {
        storedEdge: {
          target: { node: "box", kind: "solid" },
          topology: "edge",
          variants: [edgeReference()],
        },
      },
    } as unknown as DesignDocumentV7;
    const rejected = await hashDesignFeaturesV2(document, {
      limits: { maxDependencyLinks: 1 },
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics[0]?.details).toMatchObject({
        resource: "maxDependencyLinks",
        limit: 1,
        actual: 2,
      });
    }

    const exact = await hashDesignFeaturesV2(document, {
      limits: { maxDependencyLinks: 2 },
    });
    expect(exact.ok, JSON.stringify(exact.diagnostics)).toBe(true);
  });

  it(
    "enforces the exact cumulative canonical-byte boundary and in-flight cancellation",
    async () => {
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
    },
    // V8 coverage roughly doubles this bounded search beyond Vitest's 5 s default.
    15_000,
  );

  it("fails closed when encoding or cryptographic intrinsics mutate", async () => {
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
    let result: CadResult<DesignFeatureHashReportV2>;
    try {
      Object.defineProperty(subtlePrototype, "digest", {
        ...originalDigest,
        value: async () => new ArrayBuffer(32),
      });
      Object.defineProperty(encoderPrototype, "encode", {
        ...originalEncode,
        value: () => new Uint8Array([0]),
      });
      result = await hashDesignFeaturesV2(document);
    } finally {
      Object.defineProperty(subtlePrototype, "digest", originalDigest!);
      Object.defineProperty(encoderPrototype, "encode", originalEncode!);
    }
    expectRealmFailure(result!);
    expect(await reportValue(hashDesignFeaturesV2(document))).toEqual(
      baseline,
    );
  });

  it("rejects critical realm mutations at entry and across digest awaits", async () => {
    const document = comprehensiveDocument();
    const baseline = await reportValue(hashDesignFeaturesV2(document));
    const probes: readonly {
      readonly label: string;
      readonly target: object;
      readonly key: string;
      readonly replacement: (...arguments_: unknown[]) => unknown;
    }[] = [
      {
        label: "Object.entries",
        target: Object,
        key: "entries",
        replacement: () => [],
      },
      {
        label: "Object.fromEntries",
        target: Object,
        key: "fromEntries",
        replacement: () => Object.create(null),
      },
      {
        label: "Object.hasOwn",
        target: Object,
        key: "hasOwn",
        replacement: () => false,
      },
      {
        label: "Map.prototype.get",
        target: Map.prototype,
        key: "get",
        replacement: () => undefined,
      },
      {
        label: "Set.prototype.add",
        target: Set.prototype,
        key: "add",
        replacement: function (this: Set<unknown>) {
          return this;
        },
      },
      {
        label: "Array.prototype.map",
        target: Array.prototype,
        key: "map",
        replacement: () => [],
      },
      {
        label: "Object.keys",
        target: Object,
        key: "keys",
        replacement: () => [],
      },
    ];
    for (const probe of probes) {
      const original = Object.getOwnPropertyDescriptor(
        probe.target,
        probe.key,
      );
      expect(original?.value, probe.label).toBeTypeOf("function");
      let result: CadResult<DesignFeatureHashReportV2>;
      try {
        Object.defineProperty(probe.target, probe.key, {
          ...original,
          value: probe.replacement,
        });
        result = await hashDesignFeaturesV2(document);
      } finally {
        Object.defineProperty(probe.target, probe.key, original!);
      }
      expectRealmFailure(result!);
    }

    const originalKeys = Object.getOwnPropertyDescriptor(Object, "keys");
    const pending = hashDesignFeaturesV2(document);
    let inFlightResult: CadResult<DesignFeatureHashReportV2>;
    try {
      Object.defineProperty(Object, "keys", {
        ...originalKeys,
        value: () => [],
      });
      inFlightResult = await pending;
    } finally {
      Object.defineProperty(Object, "keys", originalKeys!);
    }
    expectRealmFailure(inFlightResult!);
    expect(await reportValue(hashDesignFeaturesV2(document))).toEqual(
      baseline,
    );
  });

  it("rejects an accessor that lies only between integrity checks", async () => {
    const document = comprehensiveDocument();
    const baseline = await reportValue(hashDesignFeaturesV2(document));
    const original = Object.getOwnPropertyDescriptor(Object, "entries");
    expect(original?.value).toBeTypeOf("function");
    let reads = 0;
    let result: CadResult<DesignFeatureHashReportV2>;
    try {
      Object.defineProperty(Object, "entries", {
        configurable: original!.configurable === true,
        enumerable: original!.enumerable === true,
        get() {
          reads += 1;
          return reads === 2 ? () => [] : original!.value;
        },
      });
      result = await hashDesignFeaturesV2(document, {
        parameters: { width: 20 },
      });
    } finally {
      Object.defineProperty(Object, "entries", original!);
    }

    expectRealmFailure(result!);
    expect(reads).toBe(0);
    expect(await reportValue(hashDesignFeaturesV2(document))).toEqual(
      baseline,
    );
  });

  it("rejects inherited semantic properties added to Object.prototype", async () => {
    const document = comprehensiveDocument();
    const absent = clone(document) as unknown as {
      nodes: { part: { materialId?: string } };
    };
    delete absent.nodes.part.materialId;
    const absentDocument = absent as unknown as DesignDocumentV7;
    const baseline = await reportValue(hashDesignFeaturesV2(absentDocument));
    const explicit = await reportValue(hashDesignFeaturesV2(document));
    expect(hashFor(baseline, "part")).not.toBe(hashFor(explicit, "part"));

    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "materialId",
    );
    expect(original).toBeUndefined();
    let result: CadResult<DesignFeatureHashReportV2>;
    try {
      Object.defineProperty(Object.prototype, "materialId", {
        configurable: true,
        value: "steel",
      });
      result = await hashDesignFeaturesV2(absentDocument);
    } finally {
      if (original === undefined) {
        delete (Object.prototype as { materialId?: string }).materialId;
      } else {
        Object.defineProperty(Object.prototype, "materialId", original);
      }
    }

    expectRealmFailure(result!);
    expect(await reportValue(hashDesignFeaturesV2(absentDocument))).toEqual(
      baseline,
    );
  });

  it("pins the protocol-v2 context and feature-family vector matrix", async () => {
    const document = comprehensiveDocument();
    const base = await reportValue(hashDesignFeaturesV2(document));
    const configured = await reportValue(
      hashDesignFeaturesV2(document, { configuration: "configured" }),
    );
    const importedChanged = await reportValue(
      hashDesignFeaturesV2(
        mutateResource(document, "importedStep", (resource) => {
          resource.digest = `sha256:${"a".repeat(64)}`;
        }),
      ),
    );
    const externalChanged = await reportValue(
      hashDesignFeaturesV2(
        mutateResource(document, "externalDocument", (resource) => {
          resource.metadata = { revision: 4 };
        }),
      ),
    );
    const topologyChangedDocument = clone(document) as unknown as {
      topologyReferences: {
        storedEdge: {
          variants: PersistentTopologyReference<"edge">[];
        };
      };
    };
    topologyChangedDocument.topologyReferences.storedEdge.variants.push(
      edgeReference("feature-hash-v2/vectors@2"),
    );
    const topologyChanged = await reportValue(
      hashDesignFeaturesV2(
        topologyChangedDocument as unknown as DesignDocumentV7,
      ),
    );
    const bodySetChangedDocument = clone(document) as unknown as {
      nodes: {
        bodySet: {
          bodies: { metadata?: Readonly<Record<string, unknown>> }[];
        };
      };
    };
    bodySetChangedDocument.nodes.bodySet.bodies[0]!.metadata = {
      manufacturing: "cast",
    };
    const bodySetChanged = await reportValue(
      hashDesignFeaturesV2(
        bodySetChangedDocument as unknown as DesignDocumentV7,
      ),
    );
    const namedDocument = clone(document) as unknown as {
      nodes: {
        assembly: {
          instances: { configuration: { mode: string; id?: string } }[];
        };
      };
    };
    namedDocument.nodes.assembly.instances[0]!.configuration = {
      mode: "named",
      id: "configured",
    };
    const named = await reportValue(
      hashDesignFeaturesV2(namedDocument as unknown as DesignDocumentV7),
    );

    const vectors = {
      contexts: {
        baseBox: hashFor(base, "box"),
        configuredBox: hashFor(configured, "box"),
        basePart: hashFor(base, "part"),
        configuredPart: hashFor(configured, "part"),
        namedChild:
          entryFor(named, "assembly").contextualDependencies[0]!.featureHash,
      },
      resources: {
        externalBase: hashFor(base, "assembly"),
        externalChanged: hashFor(externalChanged, "assembly"),
      },
      topology: {
        base: hashFor(base, "fillet"),
        changed: hashFor(topologyChanged, "fillet"),
      },
      importedBody: {
        base: hashFor(base, "importedBody"),
        changed: hashFor(importedChanged, "importedBody"),
      },
      bodySet: {
        base: hashFor(base, "bodySet"),
        changed: hashFor(bodySetChanged, "bodySet"),
      },
      assembly: {
        base: hashFor(base, "assembly"),
        configured: hashFor(configured, "assembly"),
        named: hashFor(named, "assembly"),
      },
      comprehensiveOutputs: Object.fromEntries(
        base.outputs.map((output) => [output.name, output.featureHash]),
      ),
    };

    expect(vectors).toEqual({
      contexts: {
        baseBox:
          "invariantcad:feature:v2:sha256:a6dcff003797ade7ee5aa1603dd1b6bd6c11c753524395503ae10b7b0e0d4838",
        configuredBox:
          "invariantcad:feature:v2:sha256:929d52bf4720bc7aae264d49c36bbaabcf2c73ca6ece7b2bc10ebdb366144286",
        basePart:
          "invariantcad:feature:v2:sha256:2bf63d80f6c859615f8e3298857273ffeb705a0d86c49c9eebe476edfc0f5539",
        configuredPart:
          "invariantcad:feature:v2:sha256:69e970c82b8aa99a1de6ecf2ae64b1679ffaab537aa64d505a77cfc430a16225",
        namedChild:
          "invariantcad:feature:v2:sha256:dd8335debfd95d1b1ee9a15a5f90c34ebe17ba14913e475a82600bf69a01dfb0",
      },
      resources: {
        externalBase:
          "invariantcad:feature:v2:sha256:4fcb1a0e35eaae01d57c539244667dd16df0f7f793255339a50ed617fdd89f58",
        externalChanged:
          "invariantcad:feature:v2:sha256:0e3384d2e336c9b690684ada02c6b401744e932a65eb012d611c0822acd36869",
      },
      topology: {
        base:
          "invariantcad:feature:v2:sha256:283971223bc5ccaf08d7f6e0589b3dc14c10fb86f83b5b525ef1534b9caf1086",
        changed:
          "invariantcad:feature:v2:sha256:4f47371ec4693336355f62f34b22873341b72ff611d06251ed216b91bca88e41",
      },
      importedBody: {
        base:
          "invariantcad:feature:v2:sha256:e3e27ac5c31904b9ac8166f24acbc43b3584e2afcb8b55447e7c854cc144daf3",
        changed:
          "invariantcad:feature:v2:sha256:11db1381bc459f1d2f094cee3303fb67475daf57fcd95cfe84a7fc6bfc0195f4",
      },
      bodySet: {
        base:
          "invariantcad:feature:v2:sha256:0ca26c045c1cf27c3d6c6ffd5b2904636e91108f01be0e241a892097aa1ad009",
        changed:
          "invariantcad:feature:v2:sha256:5bbfba0f241c73c2e50c281a1b8a8b5a198da8b700aa00a28ebd1e304f8f574a",
      },
      assembly: {
        base:
          "invariantcad:feature:v2:sha256:4fcb1a0e35eaae01d57c539244667dd16df0f7f793255339a50ed617fdd89f58",
        configured:
          "invariantcad:feature:v2:sha256:558026a1d1316875e48fb6d4a7bc94a9e1177231bb731d886d56bccb50697671",
        named:
          "invariantcad:feature:v2:sha256:61f8a013acd61846a083075615eec932536c1957b59683bec32069a144b9eee7",
      },
      comprehensiveOutputs: {
        assembly:
          "invariantcad:feature:v2:sha256:4fcb1a0e35eaae01d57c539244667dd16df0f7f793255339a50ed617fdd89f58",
        bodySet:
          "invariantcad:feature:v2:sha256:0ca26c045c1cf27c3d6c6ffd5b2904636e91108f01be0e241a892097aa1ad009",
        imported:
          "invariantcad:feature:v2:sha256:e3e27ac5c31904b9ac8166f24acbc43b3584e2afcb8b55447e7c854cc144daf3",
        part:
          "invariantcad:feature:v2:sha256:2bf63d80f6c859615f8e3298857273ffeb705a0d86c49c9eebe476edfc0f5539",
        solid:
          "invariantcad:feature:v2:sha256:a6dcff003797ade7ee5aa1603dd1b6bd6c11c753524395503ae10b7b0e0d4838",
      },
    });
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
