import { describe, expect, it } from "vitest";
import { nodeId, resourceId } from "../src/core/ids.js";
import type { Diagnostic } from "../src/core/result.js";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_SCHEMA_V6,
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  DOCUMENT_VERSION_V5,
  DOCUMENT_VERSION_V6,
  DOCUMENT_VERSION_V7,
  type DesignDocumentV7,
} from "../src/ir.js";
import {
  cloneDocumentV7,
  parseDocument,
  parseDocumentV7,
  parseDocumentValue,
  parseDocumentValueV7,
  stringifyDocumentV7,
} from "../src/serialization.js";

const length = (value: number) =>
  ({ op: "literal", dimension: "length", value }) as const;
const scalar = (value: number) =>
  ({ op: "literal", dimension: "scalar", value }) as const;

function stagedV7Document(): DesignDocumentV7 {
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "document-v7-runtime",
    units: { length: "mm", angle: "rad" },
    parameters: {},
    configurations: {
      manufacturing: {
        instanceSuppressions: {
          assembly: { local: false },
        },
      },
    },
    resources: {
      importedStep: {
        digest: `sha256:${"0".repeat(64)}`,
        byteLength: 1_024,
        mediaType: "model/step",
        locations: ["é"],
      },
      externalDocument: {
        digest: `sha256:${"1".repeat(64)}`,
        byteLength: 2_048,
        mediaType: "application/vnd.invariantcad.document+json",
        locations: ["😀", "\ud800"],
      },
    },
    nodes: {
      plane: {
        kind: "datumPlane",
        origin: [length(0), length(0), length(0)],
        xDirection: [scalar(1), scalar(0), scalar(0)],
        normal: [scalar(0), scalar(0), scalar(1)],
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
      primitive: {
        kind: "box",
        size: [length(10), length(20), length(30)],
        center: false,
      },
      imported: {
        kind: "importedBody",
        resource: "importedStep",
        format: "step",
        units: { mode: "from-file" },
        healing: { mode: "reader-default" },
        expected: "single-solid",
      },
      bodies: {
        kind: "bodySet",
        bodies: [
          {
            id: "primary",
            solid: { node: "primitive", kind: "solid" },
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
            configuration: { mode: "named", id: "manufacturing" },
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
            // This name belongs to the external document and intentionally is
            // not required to exist in the owning document.
            configuration: { mode: "named", id: "externalOnly" },
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
    topologyReferences: {
      corner: {
        target: { node: "primitive", kind: "solid" },
        topology: "vertex",
        variants: [
          {
            protocolVersion: 2,
            kernelFingerprint:
              "invariantcad-topology-descriptor@6;v7-vertex-fixture",
            topology: "vertex",
            capturedHistory: "complete",
            tolerance: { linear: 1e-7, angular: 1e-7, relative: 1e-7 },
            lineage: [{ feature: "primitive", relation: "created" }],
            geometry: { topology: "vertex", point: [0, 0, 0] },
            adjacency: [],
          },
        ],
      },
    },
  } as unknown as DesignDocumentV7;
}

function legacyDocument(schema: string, version: number): unknown {
  return {
    schema,
    version,
    name: `document-v${version}`,
    units: { length: "mm", angle: "rad" },
    parameters: {},
    nodes: {
      box: {
        kind: "box",
        size: [length(1), length(2), length(3)],
        center: false,
      },
    },
    outputs: {
      main: { node: "box", kind: "solid" },
    },
  };
}

function failedDiagnostics(value: unknown): readonly Diagnostic[] {
  const result = parseDocumentValueV7(value);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.diagnostics;
}

function expectLimit(
  value: unknown,
  resource:
    | "maxResourceDefinitions"
    | "maxResourceLocations"
    | "maxResourceLocationBytes",
  limit: number,
  actual: number,
): void {
  const result = parseDocumentValueV7(value, { limits: { [resource]: limit } });
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [
      {
        code: "IR_INVALID",
        details: { resource, limit, actual },
      },
    ],
  });
}

describe("staged document-v7 serialization and validation", () => {
  it("strictly parses, serializes, and clones a detached frozen v7 value", () => {
    const source = stagedV7Document();
    const parsedValue = parseDocumentValueV7(source);
    expect(parsedValue.ok).toBe(true);
    if (!parsedValue.ok) return;
    expect(parsedValue.value).not.toBe(source);
    expect(Object.isFrozen(parsedValue.value)).toBe(true);
    expect(Object.isFrozen(parsedValue.value.nodes)).toBe(true);
    expect(
      Object.isFrozen(
        parsedValue.value.resources?.[resourceId("externalDocument")]
          ?.locations,
      ),
    ).toBe(true);

    const text = stringifyDocumentV7(source);
    const parsedText = parseDocumentV7(text);
    expect(parsedText.ok).toBe(true);
    if (!parsedText.ok) return;
    expect(stringifyDocumentV7(parsedText.value)).toBe(text);
    expect(text).toContain('"protocolVersion":2');

    const clone = cloneDocumentV7(parsedText.value);
    expect(clone).not.toBe(parsedText.value);
    expect(clone).toEqual(parsedText.value);
    expect(Object.isFrozen(clone)).toBe(true);
  });

  it("captures stateful inputs once and validates the detached snapshot", () => {
    const source = structuredClone(stagedV7Document()) as unknown as Record<
      string,
      unknown
    >;
    const resources = source.resources;
    let reads = 0;
    Object.defineProperty(source, "resources", {
      enumerable: true,
      get(): unknown {
        reads += 1;
        return reads === 1 ? resources : {};
      },
    });
    const parsed = parseDocumentValueV7(source);
    expect(parsed.ok).toBe(true);
    expect(reads).toBe(1);
  });

  it("keeps ordinary parsing frozen on v1-v6 and v7 parsing strict", () => {
    const v7 = stagedV7Document();
    expect(parseDocumentValue(v7).ok).toBe(false);
    expect(parseDocument(stringifyDocumentV7(v7)).ok).toBe(false);
    const v6 = legacyDocument(DOCUMENT_SCHEMA_V6, DOCUMENT_VERSION_V6);
    expect(parseDocumentValue(v6).ok).toBe(true);
    expect(parseDocumentValueV7(v6).ok).toBe(false);
  });

  it("accepts external configuration names without treating them as local", () => {
    expect(parseDocumentValueV7(stagedV7Document()).ok).toBe(true);
  });

  it("validates datum, body-set, part, import, and local occurrence refs", () => {
    const source = stagedV7Document();
    expect(
      failedDiagnostics({
        ...source,
        nodes: {
          ...source.nodes,
          profile: {
            ...source.nodes[nodeId("profile")],
            plane: {
              type: "datum",
              datum: { node: "missingPlane", kind: "datumPlane" },
            },
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_MISSING",
          path: "/nodes/profile/plane/datum/node",
        }),
      ]),
    );

    expect(
      failedDiagnostics({
        ...source,
        nodes: {
          ...source.nodes,
          bodies: {
            kind: "bodySet",
            bodies: [
              {
                id: "wrong",
                solid: { node: "plane", kind: "solid" },
              },
            ],
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_KIND_MISMATCH",
          path: "/nodes/bodies/bodies/0/solid",
        }),
      ]),
    );

    expect(
      failedDiagnostics({
        ...source,
        nodes: {
          ...source.nodes,
          imported: {
            ...source.nodes[nodeId("imported")],
            resource: "missingImport",
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_MISSING",
          path: "/nodes/imported/resource",
        }),
      ]),
    );

    expect(
      failedDiagnostics({
        ...source,
        nodes: {
          ...source.nodes,
          part: {
            ...source.nodes[nodeId("part")],
            geometry: { node: "profile", kind: "bodySet" },
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_KIND_MISMATCH",
          path: "/nodes/part/geometry",
        }),
      ]),
    );

    const assembly = source.nodes[nodeId("assembly")];
    expect(assembly?.kind).toBe("assembly");
    if (assembly?.kind !== "assembly") return;
    const local = assembly.instances[0]!;
    expect(
      failedDiagnostics({
        ...source,
        nodes: {
          ...source.nodes,
          assembly: {
            ...assembly,
            instances: [
              {
                ...local,
                configuration: { mode: "named", id: "missingLocal" },
              },
            ],
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_MISSING",
          path: "/nodes/assembly/instances/0/configuration/id",
        }),
      ]),
    );
  });

  it("binds external occurrences to InvariantCAD document resources", () => {
    const source = stagedV7Document();
    const wrongMediaType = {
      ...source,
      resources: {
        ...source.resources,
        externalDocument: {
          ...source.resources?.[resourceId("externalDocument")],
          mediaType: "application/json",
        },
      },
    };
    expect(failedDiagnostics(wrongMediaType)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_KIND_MISMATCH",
          path: "/nodes/assembly/instances/1/component/resource",
          details: {
            expectedMediaType:
              "application/vnd.invariantcad.document+json",
            actualMediaType: "application/json",
          },
        }),
      ]),
    );
  });

  it("validates new expression dimensions, outputs, configurations, and cycles", () => {
    const source = stagedV7Document();
    expect(
      failedDiagnostics({
        ...source,
        nodes: {
          ...source.nodes,
          plane: {
            ...source.nodes[nodeId("plane")],
            origin: [scalar(0), length(0), length(0)],
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "EXPRESSION_DIMENSION_MISMATCH",
          path: "/nodes/plane/origin/0",
        }),
      ]),
    );

    expect(
      failedDiagnostics({
        ...source,
        outputs: {
          ...source.outputs,
          invalid: { node: "plane", kind: "solid" },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_KIND_MISMATCH",
          path: "/outputs/invalid",
        }),
      ]),
    );

    expect(
      failedDiagnostics({
        ...source,
        configurations: {
          ...source.configurations,
          invalid: {
            instanceSuppressions: {
              assembly: { missingOccurrence: true },
            },
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_MISSING",
          path: "/configurations/invalid/instanceSuppressions/assembly/missingOccurrence",
        }),
      ]),
    );

    expect(
      failedDiagnostics({
        ...source,
        nodes: {
          ...source.nodes,
          cycle: {
            kind: "transform",
            input: { node: "cycle", kind: "solid" },
            operations: [
              {
                kind: "scale",
                value: [scalar(1), scalar(1), scalar(1)],
              },
            ],
          },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "GRAPH_CYCLE",
          path: "/nodes/cycle",
        }),
      ]),
    );
  });

  it("rejects invalid values before staged stringify and clone", () => {
    const source = stagedV7Document();
    const invalid = {
      ...source,
      resources: {
        importedStep: source.resources?.[resourceId("importedStep")],
      },
    } as unknown as DesignDocumentV7;
    expect(() => stringifyDocumentV7(invalid)).toThrow(
      "missing resource 'externalDocument'",
    );
    expect(() => cloneDocumentV7(invalid)).toThrow(
      "missing resource 'externalDocument'",
    );
  });
});

describe("document-v7 resource registry limits", () => {
  it("accepts exact aggregate boundaries and reports exact overages", () => {
    const source = stagedV7Document();
    expect(
      parseDocumentValueV7(source, {
        limits: {
          maxResourceDefinitions: 2,
          maxResourceLocations: 3,
          maxResourceLocationBytes: 9,
        },
      }).ok,
    ).toBe(true);
    expectLimit(source, "maxResourceDefinitions", 1, 2);
    expectLimit(source, "maxResourceLocations", 2, 3);
    expectLimit(source, "maxResourceLocationBytes", 8, 9);
  });

  it("counts every definition and location across the detached registry", () => {
    const source = stagedV7Document();
    const expanded = {
      ...source,
      resources: {
        ...source.resources,
        unused: {
          digest: `sha256:${"2".repeat(64)}`,
          byteLength: 0,
          mediaType: "application/octet-stream",
          locations: ["project://unused"],
        },
      },
    };
    expectLimit(expanded, "maxResourceDefinitions", 2, 3);
    expectLimit(expanded, "maxResourceLocations", 3, 4);
  });

  it("does not change frozen v1-v6 parsing or diagnostics", () => {
    const versions = [
      [DOCUMENT_SCHEMA_V1, DOCUMENT_VERSION_V1],
      [DOCUMENT_SCHEMA_V2, DOCUMENT_VERSION_V2],
      [DOCUMENT_SCHEMA_V3, DOCUMENT_VERSION_V3],
      [DOCUMENT_SCHEMA_V4, DOCUMENT_VERSION_V4],
      [DOCUMENT_SCHEMA_V5, DOCUMENT_VERSION_V5],
      [DOCUMENT_SCHEMA_V6, DOCUMENT_VERSION_V6],
    ] as const;
    for (const [schema, version] of versions) {
      const result = parseDocumentValue(legacyDocument(schema, version), {
        limits: {
          maxResourceDefinitions: 0,
          maxResourceLocations: 0,
          maxResourceLocationBytes: 0,
        },
      });
      expect(result.ok, `document v${version}`).toBe(true);
      if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    }

    const invalidV6 = {
      ...(legacyDocument(
        DOCUMENT_SCHEMA_V6,
        DOCUMENT_VERSION_V6,
      ) as Readonly<Record<string, unknown>>),
      resources: {
        ignoredByFrozenGrammar: {
          locations: ["x"],
        },
      },
    };
    const baseline = parseDocumentValue(invalidV6);
    const bounded = parseDocumentValue(invalidV6, {
      limits: {
        maxResourceDefinitions: 0,
        maxResourceLocations: 0,
        maxResourceLocationBytes: 0,
      },
    });
    expect(bounded).toEqual(baseline);
  });
});
