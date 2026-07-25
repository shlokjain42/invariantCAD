import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  nodeId,
  resourceId,
  topologyReferenceId,
} from "../src/core/ids.js";
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
  DesignDocumentV7Schema,
  NodeV7Schema,
  TopologyReferenceEntryV7Schema,
} from "../src/schema.js";
import {
  cloneDocumentV7,
  parseDocument,
  parseDocumentV7,
  parseDocumentValue,
  parseDocumentValueV7,
  stringifyDocumentV7,
} from "../src/serialization.js";
import { validateDocumentV7 } from "../src/validation.js";

const length = (value: number) =>
  ({ op: "literal", dimension: "length", value }) as const;
const scalar = (value: number) =>
  ({ op: "literal", dimension: "scalar", value }) as const;
const density = (value: number) =>
  ({ op: "literal", dimension: "massDensity", value }) as const;

function defineOwnDataProperty<T extends object>(
  value: T,
  key: PropertyKey,
  child: unknown,
  enumerable = true,
): T {
  Object.defineProperty(value, key, {
    configurable: true,
    enumerable,
    value: child,
    writable: true,
  });
  return value;
}

function objectAt(value: unknown, path: readonly (string | number)[]): object {
  let current = value;
  for (const segment of path) {
    current = (current as Readonly<Record<PropertyKey, unknown>>)[segment];
  }
  if (typeof current !== "object" || current === null) {
    throw new TypeError(`Expected object at ${path.join("/")}`);
  }
  return current;
}

function protocolMetadata(label: string): Readonly<Record<string, unknown>> {
  return JSON.parse(
    `{"__proto__":{"label":${JSON.stringify(label)}},"constructor":"constructor","prototype":"prototype","toString":"toString"}`,
  ) as Readonly<Record<string, unknown>>;
}

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
        healing: { mode: "none" },
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

  it("rejects duplicate raw JSON members before v7 schema validation", () => {
    const canonical = stringifyDocumentV7(stagedV7Document());
    const duplicateSources = [
      `{"version":6,${canonical.slice(1)}`,
      String.raw`{"na\u006de":"shadowed",${canonical.slice(1)}`,
      `{"metadata":{"label":1,"label":2},${canonical.slice(1)}`,
      String.raw`{"metadata":{"__proto__":1,"\u005f_proto__":2},${canonical.slice(1)}`,
    ];

    for (const source of duplicateSources) {
      const collapsed = JSON.parse(source);
      expect(parseDocumentValueV7(collapsed).ok, source).toBe(true);
      expect(DesignDocumentV7Schema.safeParse(collapsed).success, source).toBe(
        true,
      );
      expect(parseDocumentV7(source), source).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: "IR_INVALID",
            message:
              "Document-v7 JSON contains a duplicate object member name",
            details: {
              reason: "duplicate-json-member",
            },
          },
        ],
      });
    }
  });

  it("keeps malformed JSON and byte-limit failures ahead of member auditing", () => {
    expect(parseDocumentV7('{"name":1,"name":2')).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          message: "The document is not valid JSON",
          details: {
            error: "JSON parsing failed safely",
          },
        },
      ],
    });

    const canonical = stringifyDocumentV7(stagedV7Document());
    const duplicate = `{"version":6,${canonical.slice(1)}`;
    const bytes = new TextEncoder().encode(duplicate).byteLength;
    expect(
      parseDocumentV7(duplicate, {
        limits: {
          maxDocumentBytes: bytes - 1,
        },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          details: {
            resource: "maxDocumentBytes",
            limit: bytes - 1,
            actual: bytes,
          },
        },
      ],
    });
    expect(
      parseDocumentV7(duplicate, {
        limits: {
          maxDocumentBytes: bytes,
        },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          details: {
            reason: "duplicate-json-member",
          },
        },
      ],
    });
  });

  it("bounds duplicate subtrees erased by native last-key-wins parsing", () => {
    const canonical = stringifyDocumentV7(stagedV7Document());
    const structuralLimit = 10_000;
    const wide = `{"metadata":{"discarded":0,"discarded":[${"0,".repeat(
      structuralLimit,
    )}0],"discarded":0},${canonical.slice(1)}`;
    const collapsedWide = JSON.parse(wide);
    expect(
      parseDocumentValueV7(collapsedWide, {
        limits: {
          maxStructuralValues: structuralLimit,
        },
      }).ok,
    ).toBe(true);
    expect(
      parseDocumentV7(wide, {
        limits: {
          maxStructuralValues: structuralLimit,
        },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          details: {
            resource: "maxStructuralValues",
            limit: structuralLimit,
            actual: structuralLimit + 1,
          },
        },
      ],
    });

    const depth = 130;
    const deep = `{"metadata":{"discarded":${"[".repeat(depth)}0${"]".repeat(
      depth,
    )},"discarded":0},${canonical.slice(1)}`;
    const collapsedDeep = JSON.parse(deep);
    expect(parseDocumentValueV7(collapsedDeep).ok).toBe(true);
    expect(parseDocumentV7(deep)).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          details: {
            resource: "maxNestingDepth",
            limit: 128,
            actual: 129,
          },
        },
      ],
    });
  });

  it("rejects accessor-backed v7 inputs without invoking getters", () => {
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
    expect(parsed.ok).toBe(false);
    expect(reads).toBe(0);
  });

  it("captures data-only proxies through descriptors without invoking get traps", () => {
    const source = structuredClone(stagedV7Document());
    let reads = 0;
    const proxied = new Proxy(source, {
      get(): never {
        reads += 1;
        throw new Error("the get trap must not run");
      },
    });
    expect(parseDocumentValueV7(proxied).ok).toBe(true);
    expect(DesignDocumentV7Schema.safeParse(proxied).success).toBe(true);
    expect(stringifyDocumentV7(proxied)).toContain('"version":7');
    expect(cloneDocumentV7(proxied)).toMatchObject({
      version: DOCUMENT_VERSION_V7,
    });
    expect(reads).toBe(0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => parseDocumentValueV7(revoked.proxy)).not.toThrow();
    expect(parseDocumentValueV7(revoked.proxy).ok).toBe(false);
    expect(() =>
      DesignDocumentV7Schema.safeParse(revoked.proxy),
    ).not.toThrow();
    expect(DesignDocumentV7Schema.safeParse(revoked.proxy).success).toBe(false);

    const opaque = Proxy.revocable({}, {});
    opaque.revoke();
    const throwing = new Proxy(structuredClone(source), {
      ownKeys(): never {
        throw opaque.proxy;
      },
    });
    expect(() => parseDocumentValueV7(throwing)).not.toThrow();
    expect(parseDocumentValueV7(throwing).ok).toBe(false);
    expect(() => DesignDocumentV7Schema.safeParse(throwing)).not.toThrow();
    expect(DesignDocumentV7Schema.safeParse(throwing).success).toBe(false);
  });

  it("keeps ordinary parsing frozen on v1-v6 and v7 parsing strict", () => {
    const v7 = stagedV7Document();
    expect(parseDocumentValue(v7).ok).toBe(false);
    expect(parseDocument(stringifyDocumentV7(v7)).ok).toBe(false);
    const versions = [
      [DOCUMENT_SCHEMA_V1, DOCUMENT_VERSION_V1],
      [DOCUMENT_SCHEMA_V2, DOCUMENT_VERSION_V2],
      [DOCUMENT_SCHEMA_V3, DOCUMENT_VERSION_V3],
      [DOCUMENT_SCHEMA_V4, DOCUMENT_VERSION_V4],
      [DOCUMENT_SCHEMA_V5, DOCUMENT_VERSION_V5],
      [DOCUMENT_SCHEMA_V6, DOCUMENT_VERSION_V6],
    ] as const;
    for (const [schema, version] of versions) {
      const legacy = legacyDocument(schema, version);
      expect(parseDocumentValue(legacy).ok, `document v${version}`).toBe(true);
      const text = JSON.stringify(legacy);
      const duplicate = `{"name":"shadowed",${text.slice(1)}`;
      const parsed = parseDocument(duplicate);
      expect(parsed.ok, `document v${version}`).toBe(true);
      if (parsed.ok) expect(parsed.value.name).toBe(`document-v${version}`);
      expect(parseDocumentValueV7(legacy).ok).toBe(false);
    }
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

  it("matches the strong document-body import protocol exactly", () => {
    const source = stagedV7Document();
    const imported = source.nodes[nodeId("imported")];
    expect(imported?.kind).toBe("importedBody");
    if (imported?.kind !== "importedBody") return;

    for (const candidate of [
      {
        ...imported,
        format: "step",
        units: { mode: "declared", length: "mm" },
      },
      {
        ...imported,
        format: "brep",
        units: { mode: "from-file" },
      },
      {
        ...imported,
        healing: { mode: "reader-default" },
      },
    ]) {
      expect(
        parseDocumentValueV7({
          ...source,
          nodes: { ...source.nodes, imported: candidate },
        }).ok,
      ).toBe(false);
    }

    expect(
      parseDocumentValueV7({
        ...source,
        nodes: {
          ...source.nodes,
          imported: {
            ...imported,
            format: "brep-binary",
            units: { mode: "declared", length: "in" },
          },
        },
      }).ok,
    ).toBe(true);
  });

  it("rejects unknown nested fields and invalid v7 reference IDs", () => {
    const source = stagedV7Document();
    const primitive = source.nodes[nodeId("primitive")];
    expect(primitive?.kind).toBe("box");
    if (primitive?.kind !== "box") return;

    expect(
      parseDocumentValueV7({
        ...source,
        units: { ...source.units, unexpected: true },
      }).ok,
    ).toBe(false);
    expect(
      parseDocumentValueV7({
        ...source,
        nodes: {
          ...source.nodes,
          primitive: {
            ...primitive,
            size: [
              { ...primitive.size[0], unexpected: true },
              primitive.size[1],
              primitive.size[2],
            ],
          },
        },
      }).ok,
    ).toBe(false);
    expect(
      parseDocumentValueV7({
        ...source,
        parameters: {
          "bad/id": {
            dimension: "length",
            default: length(1),
          },
        },
      }).ok,
    ).toBe(false);
    expect(
      parseDocumentValueV7({
        ...source,
        parameters: {
          valid: {
            dimension: "length",
            default: {
              op: "parameter",
              dimension: "length",
              id: "bad/id",
            },
          },
        },
      }).ok,
    ).toBe(false);
  });

  it("rejects own __proto__ at every protocol registry and nested contract", () => {
    const paths = [
      ["root", []],
      ["parameters", ["parameters"]],
      ["materials", ["materials"]],
      ["configurations", ["configurations"]],
      ["resources", ["resources"]],
      ["nodes", ["nodes"]],
      ["outputs", ["outputs"]],
      ["topology references", ["topologyReferences"]],
      ["units", ["units"]],
      ["expression", ["nodes", "primitive", "size", 0]],
      ["reference", ["outputs", "part"]],
    ] as const;

    for (const [label, path] of paths) {
      const candidate = structuredClone(
        stagedV7Document(),
      ) as unknown as Record<string, unknown>;
      candidate.materials = {
        steel: {
          name: "Steel",
          massDensity: density(7.85e-6),
        },
      };
      (objectAt(candidate, ["units"]) as Record<string, unknown>).mass = "kg";
      defineOwnDataProperty(objectAt(candidate, path), "__proto__", {
        rejected: label,
      });

      expect(
        parseDocumentValueV7(candidate).ok,
        `${label} parser`,
      ).toBe(false);
      expect(
        DesignDocumentV7Schema.safeParse(candidate).success,
        `${label} direct schema`,
      ).toBe(false);
    }
  });

  it("fails closed on hidden, symbolic, accessor, and extra-array input state", () => {
    const candidates: Record<string, DesignDocumentV7> = {};

    const hidden = structuredClone(stagedV7Document());
    defineOwnDataProperty(hidden, "hidden", true, false);
    candidates.hidden = hidden;

    const symbolic = structuredClone(stagedV7Document());
    defineOwnDataProperty(symbolic.units, Symbol("hidden"), true);
    candidates.symbolic = symbolic;

    const hiddenMetadata = structuredClone(stagedV7Document());
    const metadataWithHidden = protocolMetadata("hidden");
    defineOwnDataProperty(metadataWithHidden, "hidden", true, false);
    (
      hiddenMetadata as unknown as Record<string, unknown>
    ).metadata = metadataWithHidden;
    candidates.hiddenMetadata = hiddenMetadata;

    const metadataArray = structuredClone(stagedV7Document());
    const values = [1, 2, 3];
    defineOwnDataProperty(values, "extra", true);
    (
      metadataArray as unknown as Record<string, unknown>
    ).metadata = { values };
    candidates.metadataArray = metadataArray;

    const explicitUndefined = structuredClone(
      stagedV7Document(),
    ) as unknown as Record<string, unknown>;
    explicitUndefined.metadata = undefined;
    candidates.explicitUndefined =
      explicitUndefined as unknown as DesignDocumentV7;

    const extraArray = structuredClone(stagedV7Document());
    const primitive = extraArray.nodes[nodeId("primitive")];
    expect(primitive?.kind).toBe("box");
    if (primitive?.kind !== "box") return;
    defineOwnDataProperty(primitive.size as unknown as object, "extra", true);
    candidates.extraArray = extraArray;

    let accessorReads = 0;
    const accessor = structuredClone(
      stagedV7Document(),
    ) as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "name", {
      configurable: true,
      enumerable: true,
      get(): string {
        accessorReads += 1;
        return "must-not-run";
      },
    });
    candidates.accessor = accessor as unknown as DesignDocumentV7;

    const accessorMetadata = structuredClone(
      stagedV7Document(),
    ) as unknown as Record<string, unknown>;
    const statefulMetadata: Record<string, unknown> = {};
    Object.defineProperty(statefulMetadata, "volatile", {
      configurable: true,
      enumerable: true,
      get(): string {
        accessorReads += 1;
        return "must-not-run";
      },
    });
    accessorMetadata.metadata = statefulMetadata;
    candidates.accessorMetadata =
      accessorMetadata as unknown as DesignDocumentV7;

    for (const [label, candidate] of Object.entries(candidates)) {
      expect(parseDocumentValueV7(candidate).ok, `${label} parser`).toBe(false);
      expect(
        DesignDocumentV7Schema.safeParse(candidate).success,
        `${label} schema`,
      ).toBe(false);
      expect(
        () => stringifyDocumentV7(candidate),
        `${label} stringify`,
      ).toThrow();
      expect(() => cloneDocumentV7(candidate), `${label} clone`).toThrow();
    }
    expect(accessorReads).toBe(0);
  });

  it("applies the raw boundary to direct node and topology-entry schemas", () => {
    const source = stagedV7Document();
    const primitive = structuredClone(source.nodes[nodeId("primitive")]);
    expect(primitive?.kind).toBe("box");
    if (primitive?.kind !== "box") return;
    defineOwnDataProperty(primitive, "__proto__", { rejected: true });
    expect(NodeV7Schema.safeParse(primitive).success).toBe(false);

    const arrayNode = structuredClone(source.nodes[nodeId("primitive")]);
    expect(arrayNode?.kind).toBe("box");
    if (arrayNode?.kind !== "box") return;
    defineOwnDataProperty(arrayNode.size as unknown as object, "extra", true);
    expect(NodeV7Schema.safeParse(arrayNode).success).toBe(false);

    let reads = 0;
    const accessorNode = structuredClone(
      source.nodes[nodeId("primitive")],
    ) as unknown as Record<string, unknown>;
    Object.defineProperty(accessorNode, "center", {
      configurable: true,
      enumerable: true,
      get(): boolean {
        reads += 1;
        return false;
      },
    });
    expect(NodeV7Schema.safeParse(accessorNode).success).toBe(false);
    expect(reads).toBe(0);

    const entry = structuredClone(
      source.topologyReferences?.[topologyReferenceId("corner")],
    );
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    defineOwnDataProperty(entry.target, "__proto__", { rejected: true });
    expect(TopologyReferenceEntryV7Schema.safeParse(entry).success).toBe(false);

    const symbolicEntry = structuredClone(
      source.topologyReferences?.[topologyReferenceId("corner")],
    );
    expect(symbolicEntry).toBeDefined();
    if (symbolicEntry === undefined) return;
    defineOwnDataProperty(symbolicEntry, Symbol("hidden"), true);
    expect(
      TopologyReferenceEntryV7Schema.safeParse(symbolicEntry).success,
    ).toBe(false);
  });

  it("hardens every direct v7 schema entry before Zod or accessors run", () => {
    const source = stagedV7Document();
    const primitive = source.nodes[nodeId("primitive")];
    const entry =
      source.topologyReferences?.[topologyReferenceId("corner")];
    expect(primitive?.kind).toBe("box");
    expect(entry).toBeDefined();
    if (primitive?.kind !== "box" || entry === undefined) return;

    const boundaries = [
      {
        label: "document",
        property: "name",
        value: source,
        parse: (value: unknown, context?: unknown) =>
          DesignDocumentV7Schema.safeParse(
            value,
            context as Parameters<
              typeof DesignDocumentV7Schema.safeParse
            >[1],
          ),
      },
      {
        label: "node",
        property: "center",
        value: primitive,
        parse: (value: unknown, context?: unknown) =>
          NodeV7Schema.safeParse(
            value,
            context as Parameters<typeof NodeV7Schema.safeParse>[1],
          ),
      },
      {
        label: "topology entry",
        property: "topology",
        value: entry,
        parse: (value: unknown, context?: unknown) =>
          TopologyReferenceEntryV7Schema.safeParse(
            value,
            context as Parameters<
              typeof TopologyReferenceEntryV7Schema.safeParse
            >[1],
          ),
      },
    ] as const;

    for (const boundary of boundaries) {
      const accessorValue = structuredClone(
        boundary.value,
      ) as unknown as Record<string, unknown>;
      let inputReads = 0;
      Object.defineProperty(accessorValue, boundary.property, {
        configurable: true,
        enumerable: true,
        get(): never {
          inputReads += 1;
          throw new Error("direct schemas must not invoke input accessors");
        },
      });
      expect(boundary.parse(accessorValue).success, boundary.label).toBe(false);
      expect(inputReads, boundary.label).toBe(0);

      const inheritedValue = structuredClone(boundary.value);
      Object.setPrototypeOf(inheritedValue, Object.create(null));
      expect(boundary.parse(inheritedValue).success, boundary.label).toBe(
        false,
      );

      let optionReads = 0;
      const context = Object.defineProperty({}, "error", {
        configurable: true,
        enumerable: true,
        get(): never {
          optionReads += 1;
          throw new Error("direct schema options must not be inspected");
        },
      });
      const optionResult = boundary.parse(boundary.value, context);
      expect(optionResult.success, boundary.label).toBe(false);
      expect(optionReads, boundary.label).toBe(0);
      expect(
        optionResult.success
          ? undefined
          : optionResult.error.issues[0]?.message,
        boundary.label,
      ).toBe("Document-v7 direct schema parse options are unsupported");
    }

    const promiseDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "Promise",
    );
    expect(promiseDescriptor).toBeDefined();
    if (promiseDescriptor === undefined) return;
    let promiseReads = 0;
    const promiseResults: boolean[] = [];
    try {
      Object.defineProperty(globalThis, "Promise", {
        configurable: true,
        get(): never {
          promiseReads += 1;
          throw { opaque: "Promise accessor must not run" };
        },
      });
      for (const boundary of boundaries) {
        promiseResults[promiseResults.length] = boundary.parse(
          boundary.value,
        ).success;
      }
    } finally {
      Object.defineProperty(globalThis, "Promise", promiseDescriptor);
    }
    expect(promiseReads).toBe(0);
    expect(promiseResults).toEqual([false, false, false]);

    const regexpPrototype = Object.getPrototypeOf(RegExp.prototype);
    const prototypeResults: boolean[] = [];
    try {
      Object.setPrototypeOf(RegExp.prototype, null);
      for (const boundary of boundaries) {
        prototypeResults[prototypeResults.length] = boundary.parse(
          boundary.value,
        ).success;
      }
    } finally {
      Object.setPrototypeOf(RegExp.prototype, regexpPrototype);
    }
    expect(prototypeResults).toEqual([false, false, false]);

    const inheritedKey = "__invariantcadV7DirectSchemaMutation__";
    const inheritedResults: boolean[] = [];
    try {
      Object.defineProperty(Object.prototype, inheritedKey, {
        configurable: true,
        enumerable: true,
        value: true,
        writable: true,
      });
      for (const boundary of boundaries) {
        inheritedResults[inheritedResults.length] = boundary.parse(
          boundary.value,
        ).success;
      }
    } finally {
      Reflect.deleteProperty(Object.prototype, inheritedKey);
    }
    expect(inheritedResults).toEqual([false, false, false]);
  });

  it("contains opaque failures before direct-schema diagnostic iteration", () => {
    const source = stagedV7Document();
    const primitive = source.nodes[nodeId("primitive")];
    const entry =
      source.topologyReferences?.[topologyReferenceId("corner")];
    expect(primitive?.kind).toBe("box");
    expect(entry).toBeDefined();
    if (primitive?.kind !== "box" || entry === undefined) return;
    const boundaries = [
      {
        value: source,
        parse: (value: unknown) => DesignDocumentV7Schema.safeParse(value),
      },
      {
        value: primitive,
        parse: (value: unknown) => NodeV7Schema.safeParse(value),
      },
      {
        value: entry,
        parse: (value: unknown) =>
          TopologyReferenceEntryV7Schema.safeParse(value),
      },
    ] as const;
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    );
    expect(iteratorDescriptor).toBeDefined();
    if (iteratorDescriptor === undefined) return;

    for (const boundary of boundaries) {
      let iteratorReads = 0;
      let result: ReturnType<typeof boundary.parse> | undefined;
      let thrown: unknown;
      const opaque = Proxy.revocable({}, {});
      opaque.revoke();
      const trapped = new Proxy(structuredClone(boundary.value), {
        ownKeys(): never {
          Object.defineProperty(Array.prototype, Symbol.iterator, {
            configurable: true,
            get(): never {
              iteratorReads += 1;
              throw { opaque: "iterator accessor must not run" };
            },
          });
          throw opaque.proxy;
        },
      });
      try {
        result = boundary.parse(trapped);
      } catch (error) {
        thrown = error;
      } finally {
        Object.defineProperty(
          Array.prototype,
          Symbol.iterator,
          iteratorDescriptor,
        );
      }
      expect(thrown).toBeUndefined();
      expect(result?.success).toBe(false);
      expect(iteratorReads).toBe(0);
    }
  });

  it("never reads global intrinsic accessors installed during capture", () => {
    const source = stagedV7Document();
    const primitive = source.nodes[nodeId("primitive")];
    const entry =
      source.topologyReferences?.[topologyReferenceId("corner")];
    expect(primitive?.kind).toBe("box");
    expect(entry).toBeDefined();
    if (primitive?.kind !== "box" || entry === undefined) return;
    const boundaries = [
      {
        value: source,
        parse: (value: unknown) => parseDocumentValueV7(value).ok,
      },
      {
        value: source,
        parse: (value: unknown) =>
          DesignDocumentV7Schema.safeParse(value).success,
      },
      {
        value: primitive,
        parse: (value: unknown) => NodeV7Schema.safeParse(value).success,
      },
      {
        value: entry,
        parse: (value: unknown) =>
          TopologyReferenceEntryV7Schema.safeParse(value).success,
      },
    ] as const;
    const realm = globalThis;
    const objectDescriptor = Object.getOwnPropertyDescriptor(
      realm,
      "Object",
    );
    expect(objectDescriptor).toBeDefined();
    if (objectDescriptor === undefined) return;
    const defineProperty = Object.defineProperty;
    const ownKeys = Reflect.ownKeys;

    for (const boundary of boundaries) {
      let reads = 0;
      let success: boolean | undefined;
      let thrown: unknown;
      const trapped = new Proxy(structuredClone(boundary.value), {
        ownKeys(target): (string | symbol)[] {
          defineProperty(realm, "Object", {
            configurable: true,
            get(): never {
              reads += 1;
              throw { opaque: "Object accessor must not run" };
            },
          });
          return ownKeys(target);
        },
      });
      try {
        success = boundary.parse(trapped);
      } catch (error) {
        thrown = error;
      } finally {
        defineProperty(realm, "Object", objectDescriptor);
      }
      expect(thrown).toBeUndefined();
      expect(reads).toBe(0);
      expect(success).toBe(false);
    }

    const errorDescriptor = Object.getOwnPropertyDescriptor(realm, "Error");
    expect(errorDescriptor).toBeDefined();
    if (errorDescriptor === undefined) return;
    for (const boundary of boundaries) {
      let reads = 0;
      let success: boolean | undefined;
      let thrown: unknown;
      const opaque = Proxy.revocable({}, {});
      opaque.revoke();
      const trapped = new Proxy(structuredClone(boundary.value), {
        ownKeys(): never {
          defineProperty(realm, "Error", {
            configurable: true,
            get(): never {
              reads += 1;
              throw { opaque: "Error accessor must not run" };
            },
          });
          throw opaque.proxy;
        },
      });
      try {
        success = boundary.parse(trapped);
      } catch (error) {
        thrown = error;
      } finally {
        defineProperty(realm, "Error", errorDescriptor);
      }
      expect(thrown).toBeUndefined();
      expect(reads).toBe(0);
      expect(success).toBe(false);
    }
  });

  it("guards codec and Standard Schema entrypoints before live Promise access", () => {
    const source = stagedV7Document();
    const primitive = source.nodes[nodeId("primitive")];
    expect(primitive?.kind).toBe("box");
    if (primitive?.kind !== "box") return;
    const promiseDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "Promise",
    );
    expect(promiseDescriptor).toBeDefined();
    if (promiseDescriptor === undefined) return;
    let reads = 0;
    let safeDecode: ReturnType<typeof NodeV7Schema.safeDecode> | undefined;
    let safeEncode: ReturnType<typeof NodeV7Schema.safeEncode> | undefined;
    let standard: unknown;
    let thrown: unknown;
    try {
      Object.defineProperty(globalThis, "Promise", {
        configurable: true,
        get(): never {
          reads += 1;
          throw { opaque: "Promise accessor must not run" };
        },
      });
      safeDecode = NodeV7Schema.safeDecode(primitive);
      safeEncode = NodeV7Schema.safeEncode(primitive);
      standard = NodeV7Schema["~standard"].validate(primitive);
      try {
        NodeV7Schema.decode(primitive);
      } catch (error) {
        thrown = error;
      }
    } finally {
      Object.defineProperty(globalThis, "Promise", promiseDescriptor);
    }
    expect(reads).toBe(0);
    expect(safeDecode?.success).toBe(false);
    expect(safeEncode?.success).toBe(false);
    expect(standard).toHaveProperty("issues");
    expect(thrown).toMatchObject({
      issues: [
        {
          message:
            "Document-v7 runtime intrinsics changed during the operation",
        },
      ],
    });
  });

  it("never invokes mutable Zod global configuration", () => {
    const source = stagedV7Document();
    const primitive = source.nodes[nodeId("primitive")];
    expect(primitive?.kind).toBe("box");
    if (primitive?.kind !== "box") return;
    const config = z.config();
    const keys = ["jitless", "customError"] as const;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(config, key);
      let reads = 0;
      let result: ReturnType<typeof NodeV7Schema.safeParse> | undefined;
      try {
        Object.defineProperty(config, key, {
          configurable: true,
          enumerable: true,
          get(): never {
            reads += 1;
            throw { opaque: `${key} accessor must not run` };
          },
        });
        result = NodeV7Schema.safeParse(
          key === "jitless" ? primitive : {},
        );
      } finally {
        if (descriptor === undefined) {
          Reflect.deleteProperty(config, key);
        } else {
          Object.defineProperty(config, key, descriptor);
        }
      }
      expect(reads, key).toBe(0);
      expect(result?.success, key).toBe(false);
      expect(result).toMatchObject({
        error: {
          issues: [
            {
              message:
                "Document-v7 runtime intrinsics changed during the operation",
            },
          ],
        },
      });
    }

    const customErrorDescriptor = Object.getOwnPropertyDescriptor(
      config,
      "customError",
    );
    let callbackCalls = 0;
    let result: ReturnType<typeof NodeV7Schema.safeParse> | undefined;
    try {
      Object.defineProperty(config, "customError", {
        configurable: true,
        enumerable: true,
        value: (): never => {
          callbackCalls += 1;
          throw { opaque: "customError callback must not run" };
        },
        writable: true,
      });
      result = NodeV7Schema.safeParse({});
    } finally {
      if (customErrorDescriptor === undefined) {
        Reflect.deleteProperty(config, "customError");
      } else {
        Object.defineProperty(
          config,
          "customError",
          customErrorDescriptor,
        );
      }
    }
    expect(callbackCalls).toBe(0);
    expect(result?.success).toBe(false);
  });

  it("preserves every JSON metadata key through parse, clone, and serialization", () => {
    const candidate = structuredClone(
      stagedV7Document(),
    ) as unknown as Record<string, unknown>;
    candidate.metadata = protocolMetadata("document");
    candidate.materials = {
      steel: {
        name: "Steel",
        massDensity: density(7.85e-6),
        metadata: protocolMetadata("material"),
      },
    };
    (objectAt(candidate, ["units"]) as Record<string, unknown>).mass = "kg";
    (
      objectAt(candidate, [
        "configurations",
        "manufacturing",
      ]) as Record<string, unknown>
    ).metadata = protocolMetadata("configuration");
    (
      objectAt(candidate, [
        "resources",
        "importedStep",
      ]) as Record<string, unknown>
    ).metadata = protocolMetadata("resource");
    (
      objectAt(candidate, ["nodes", "part"]) as Record<string, unknown>
    ).metadata = protocolMetadata("part");
    (
      objectAt(candidate, [
        "nodes",
        "bodies",
        "bodies",
        0,
      ]) as Record<string, unknown>
    ).metadata = protocolMetadata("body");
    candidate.parameters = Object.fromEntries(
      ["constructor", "prototype", "toString"].map((id, index) => [
        id,
        {
          dimension: "length",
          default: length(index + 1),
        },
      ]),
    );
    const outputs = objectAt(candidate, ["outputs"]) as Record<string, unknown>;
    for (const id of ["constructor", "prototype", "toString"]) {
      outputs[id] = { node: "part", kind: "part" };
    }

    expect(DesignDocumentV7Schema.safeParse(candidate).success).toBe(true);
    expect(
      NodeV7Schema.safeParse(objectAt(candidate, ["nodes", "part"])).success,
    ).toBe(true);
    const parsed = parseDocumentValueV7(candidate);
    expect(
      parsed.ok,
      parsed.ok ? undefined : JSON.stringify(parsed.diagnostics),
    ).toBe(true);
    if (!parsed.ok) return;
    const metadataPaths = [
      ["metadata"],
      ["materials", "steel", "metadata"],
      ["configurations", "manufacturing", "metadata"],
      ["resources", "importedStep", "metadata"],
      ["nodes", "part", "metadata"],
      ["nodes", "bodies", "bodies", 0, "metadata"],
    ] as const;
    for (const path of metadataPaths) {
      const metadata = objectAt(parsed.value, path);
      expect(Object.hasOwn(metadata, "__proto__"), path.join("/")).toBe(true);
      expect(Object.hasOwn(metadata, "constructor")).toBe(true);
      expect(Object.hasOwn(metadata, "prototype")).toBe(true);
      expect(Object.hasOwn(metadata, "toString")).toBe(true);
    }
    expect(Object.keys(parsed.value.parameters)).toEqual([
      "constructor",
      "prototype",
      "toString",
    ]);
    expect(
      Object.keys(parsed.value.outputs).filter((id) =>
        ["constructor", "prototype", "toString"].includes(id),
      ),
    ).toEqual(["constructor", "prototype", "toString"]);

    const text = stringifyDocumentV7(parsed.value);
    expect(text.match(/"__proto__"/g)).toHaveLength(6);
    const reparsed = parseDocumentV7(text);
    expect(reparsed.ok).toBe(true);
    const clone = cloneDocumentV7(parsed.value);
    for (const path of metadataPaths) {
      expect(Object.hasOwn(objectAt(clone, path), "__proto__")).toBe(true);
    }
  });

  it("does not let a metadata alias launder forbidden protocol keys", () => {
    const source = stagedV7Document();
    const shared = JSON.parse(
      '{"length":"mm","angle":"rad","__proto__":{"forbidden":true}}',
    ) as Readonly<Record<string, unknown>>;
    const candidate = {
      ...source,
      units: shared,
      metadata: shared,
    } as unknown as DesignDocumentV7;
    expect(parseDocumentValueV7(candidate).ok).toBe(false);
    expect(DesignDocumentV7Schema.safeParse(candidate).success).toBe(false);

    const allowed = protocolMetadata("shared");
    const metadataOnly = {
      ...source,
      metadata: allowed,
      resources: {
        ...source.resources,
        importedStep: {
          ...source.resources?.[resourceId("importedStep")],
          metadata: allowed,
        },
      },
    } as unknown as DesignDocumentV7;
    expect(parseDocumentValueV7(metadataOnly).ok).toBe(true);
  });

  it("enforces maxDocumentBytes for staged stringify and clone", () => {
    const source = stagedV7Document();
    const text = stringifyDocumentV7(source);
    const bytes = new TextEncoder().encode(text).byteLength;
    const baseline = parseDocumentValueV7(source);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;

    expect(
      stringifyDocumentV7(source, {
        limits: { maxDocumentBytes: bytes },
      }),
    ).toBe(text);
    expect(() =>
      stringifyDocumentV7(source, {
        limits: { maxDocumentBytes: bytes - 1 },
      }),
    ).toThrow(/maxDocumentBytes/);
    expect(
      cloneDocumentV7(source, {
        limits: { maxDocumentBytes: bytes },
      }),
    ).toEqual(baseline.value);
    expect(() =>
      cloneDocumentV7(source, {
        limits: { maxDocumentBytes: bytes - 1 },
      }),
    ).toThrow(/maxDocumentBytes/);
  });

  it("reads staged serialization options once before detaching the document", () => {
    const source = stagedV7Document();
    const baseline = parseDocumentValueV7(source);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    let stringifyReads = 0;
    const stringifyOptions = Object.defineProperty({}, "limits", {
      enumerable: true,
      get(): object {
        stringifyReads += 1;
        return {};
      },
    });
    expect(
      stringifyDocumentV7(
        source,
        stringifyOptions as Parameters<typeof stringifyDocumentV7>[1],
      ),
    ).toContain('"version":7');
    expect(stringifyReads).toBe(1);

    let cloneReads = 0;
    const cloneOptions = Object.defineProperty({}, "limits", {
      enumerable: true,
      get(): object {
        cloneReads += 1;
        return {};
      },
    });
    expect(
      cloneDocumentV7(
        source,
        cloneOptions as Parameters<typeof cloneDocumentV7>[1],
      ),
    ).toEqual(baseline.value);
    expect(cloneReads).toBe(1);
  });

  it("requires one primitive text input without coercing hostile values", () => {
    const text = stringifyDocumentV7(stagedV7Document());
    let coercions = 0;
    const stringLike = {
      [Symbol.toPrimitive](): string {
        coercions += 1;
        return text;
      },
      toString(): string {
        coercions += 1;
        return text;
      },
    };
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    for (const candidate of [
      new String(text),
      stringLike,
      revoked.proxy,
    ]) {
      let result: ReturnType<typeof parseDocumentV7> | undefined;
      expect(() => {
        result = parseDocumentV7(candidate as unknown as string);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
    expect(coercions).toBe(0);

    let optionReads = 0;
    const options = Object.defineProperty({}, "limits", {
      enumerable: true,
      get(): object {
        optionReads += 1;
        throw new Error("non-string inputs must fail before options");
      },
    });
    expect(
      parseDocumentV7(
        stringLike as unknown as string,
        options,
      ).ok,
    ).toBe(false);
    expect(optionReads).toBe(0);
  });

  it("fails closed when options or raw traps replace runtime intrinsics", () => {
    const text = stringifyDocumentV7(stagedV7Document());
    let limitReads = 0;
    const accessorLimits = Object.defineProperty({}, "maxDocumentBytes", {
      enumerable: true,
      get(): number {
        limitReads += 1;
        return 0;
      },
    });
    expect(
      parseDocumentV7(text, {
        limits: accessorLimits,
      }).ok,
    ).toBe(false);
    expect(limitReads).toBe(0);

    const textEncoderDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "TextEncoder",
    );
    expect(textEncoderDescriptor).toBeDefined();
    if (textEncoderDescriptor === undefined) return;
    try {
      const result = parseDocumentV7(
        text,
        Object.defineProperty({}, "limits", {
          enumerable: true,
          get(): object {
            Object.defineProperty(globalThis, "TextEncoder", {
              configurable: true,
              value: class PoisonedTextEncoder {
                encode(): Uint8Array {
                  return new Uint8Array();
                }
              },
              writable: true,
            });
            return { maxDocumentBytes: 0 };
          },
        }),
      );
      expect(result.ok).toBe(false);
    } finally {
      Object.defineProperty(
        globalThis,
        "TextEncoder",
        textEncoderDescriptor,
      );
    }

    const parseDescriptor = Object.getOwnPropertyDescriptor(JSON, "parse");
    expect(parseDescriptor).toBeDefined();
    if (parseDescriptor === undefined) return;
    try {
      const result = parseDocumentV7(
        "{}",
        Object.defineProperty({}, "limits", {
          enumerable: true,
          get(): object {
            Object.defineProperty(JSON, "parse", {
              configurable: true,
              value: (): unknown => stagedV7Document(),
              writable: true,
            });
            return {};
          },
        }),
      );
      expect(result.ok).toBe(false);
    } finally {
      Object.defineProperty(JSON, "parse", parseDescriptor);
    }

    const entriesDescriptor = Object.getOwnPropertyDescriptor(
      Object,
      "entries",
    );
    expect(entriesDescriptor).toBeDefined();
    if (entriesDescriptor === undefined) return;
    const trapped = new Proxy(structuredClone(stagedV7Document()), {
      ownKeys(target): (string | symbol)[] {
        Object.defineProperty(Object, "entries", {
          configurable: true,
          value: (): readonly [] => [],
          writable: true,
        });
        return Reflect.ownKeys(target);
      },
    });
    try {
      expect(() =>
        stringifyDocumentV7(trapped as unknown as DesignDocumentV7),
      ).toThrow(/intrinsics/);
    } finally {
      Object.defineProperty(Object, "entries", entriesDescriptor);
    }
  });

  it("contains raw member-audit intrinsic replacements", () => {
    const source = stringifyDocumentV7(stagedV7Document());
    const defineProperty = Object.defineProperty;
    const mutations = [
      {
        label: "Set.prototype.add",
        holder: Set.prototype,
        key: "add",
        value: (): never => {
          throw new Error("poisoned Set.prototype.add");
        },
      },
      {
        label: "Set.prototype.has",
        holder: Set.prototype,
        key: "has",
        value: (): false => false,
      },
      {
        label: "String.prototype.charCodeAt",
        holder: String.prototype,
        key: "charCodeAt",
        value: (): 0 => 0,
      },
      {
        label: "String.prototype.slice",
        holder: String.prototype,
        key: "slice",
        value: (): "" => "",
      },
    ] as const;

    for (const mutation of mutations) {
      const descriptor = Object.getOwnPropertyDescriptor(
        mutation.holder,
        mutation.key,
      );
      expect(descriptor, mutation.label).toBeDefined();
      if (descriptor === undefined) continue;
      let result: ReturnType<typeof parseDocumentV7> | undefined;
      try {
        result = parseDocumentV7(
          source,
          defineProperty({}, "limits", {
            enumerable: true,
            get(): object {
              defineProperty(mutation.holder, mutation.key, {
                configurable: true,
                value: mutation.value,
                writable: true,
              });
              return {};
            },
          }),
        );
      } finally {
        defineProperty(mutation.holder, mutation.key, descriptor);
      }
      expect(result?.ok, mutation.label).toBe(false);
      expect(result).toMatchObject({
        diagnostics: [
          {
            message:
              "Document-v7 runtime intrinsics changed during the operation",
          },
        ],
      });
    }
  });

  it("contains call-time replacement across the v7 dependency closure", () => {
    const defineProperty = Object.defineProperty;
    const ownKeys = Reflect.ownKeys;
    const mutations = [
      {
        label: "Object.keys",
        holder: Object,
        key: "keys",
        value: (): readonly [] => [],
      },
      {
        label: "Object.hasOwn",
        holder: Object,
        key: "hasOwn",
        value: (): false => false,
      },
      {
        label: "Object.getPrototypeOf",
        holder: Object,
        key: "getPrototypeOf",
        value: (): null => null,
      },
      {
        label: "Object.values",
        holder: Object,
        key: "values",
        value: (): readonly [] => [],
      },
      {
        label: "Array.isArray",
        holder: Array,
        key: "isArray",
        value: (): false => false,
      },
      {
        label: "Array.prototype.forEach",
        holder: Array.prototype,
        key: "forEach",
        value: (): undefined => undefined,
      },
      {
        label: "Array.prototype.some",
        holder: Array.prototype,
        key: "some",
        value: (): false => false,
      },
      {
        label: "Array.prototype.map",
        holder: Array.prototype,
        key: "map",
        value: (): readonly [] => [],
      },
      {
        label: "Map.prototype.has",
        holder: Map.prototype,
        key: "has",
        value: (): false => false,
      },
      {
        label: "Set.prototype.has",
        holder: Set.prototype,
        key: "has",
        value: (): false => false,
      },
      {
        label: "Set.prototype.add",
        holder: Set.prototype,
        key: "add",
        value: (): Set<never> => new Set(),
      },
      {
        label: "RegExp.prototype.test",
        holder: RegExp.prototype,
        key: "test",
        value: (): false => false,
      },
      {
        label: "String.prototype.charCodeAt",
        holder: String.prototype,
        key: "charCodeAt",
        value: (): 0 => 0,
      },
      {
        label: "String.prototype.slice",
        holder: String.prototype,
        key: "slice",
        value: (): "" => "",
      },
      {
        label: "String.prototype.trim",
        holder: String.prototype,
        key: "trim",
        value: (): "" => "",
      },
      {
        label: "global Object",
        holder: globalThis,
        key: "Object",
        value: function PoisonedObject(): void {},
      },
    ] as const;

    for (const mutation of mutations) {
      const descriptor = Object.getOwnPropertyDescriptor(
        mutation.holder,
        mutation.key,
      );
      expect(descriptor, mutation.label).toBeDefined();
      if (descriptor === undefined) continue;
      const trapped = new Proxy(structuredClone(stagedV7Document()), {
        ownKeys(target): (string | symbol)[] {
          defineProperty(mutation.holder, mutation.key, {
            configurable: true,
            value: mutation.value,
            writable: true,
          });
          return ownKeys(target);
        },
      });
      let result: ReturnType<typeof parseDocumentValueV7> | undefined;
      try {
        result = parseDocumentValueV7(trapped);
      } finally {
        defineProperty(mutation.holder, mutation.key, descriptor);
      }
      expect(result?.ok, mutation.label).toBe(false);
      expect(result).toMatchObject({
        diagnostics: [
          {
            message:
              "Document-v7 runtime intrinsics changed during the operation",
          },
        ],
      });
    }
  });

  it("rejects enumerable Object.prototype additions made during capture", () => {
    const key = "__invariantcadV7EnumerableMutation__";
    const defineProperty = Object.defineProperty;
    const deleteProperty = Reflect.deleteProperty;
    const ownKeys = Reflect.ownKeys;
    expect(Object.getOwnPropertyDescriptor(Object.prototype, key)).toBeUndefined();
    const trapped = new Proxy(structuredClone(stagedV7Document()), {
      ownKeys(target): (string | symbol)[] {
        defineProperty(Object.prototype, key, {
          configurable: true,
          enumerable: true,
          value: true,
          writable: true,
        });
        return ownKeys(target);
      },
    });
    let result: ReturnType<typeof parseDocumentValueV7> | undefined;
    try {
      result = parseDocumentValueV7(trapped);
    } finally {
      deleteProperty(Object.prototype, key);
    }
    expect(result?.ok).toBe(false);
    expect(result).toMatchObject({
      diagnostics: [
        {
          message:
            "Document-v7 runtime intrinsics changed during the operation",
        },
      ],
    });
  });

  it("anchors global bindings to the captured realm object", () => {
    const realm = globalThis;
    const globalThisDescriptor = Object.getOwnPropertyDescriptor(
      realm,
      "globalThis",
    );
    expect(globalThisDescriptor).toBeDefined();
    if (globalThisDescriptor === undefined) return;
    const fakeGlobal = Object.create(
      Object.getPrototypeOf(realm),
      Object.getOwnPropertyDescriptors(realm),
    ) as typeof globalThis;
    let result: ReturnType<typeof parseDocumentValueV7> | undefined;
    try {
      Object.defineProperty(realm, "globalThis", {
        ...globalThisDescriptor,
        value: fakeGlobal,
      });
      result = parseDocumentValueV7(stagedV7Document());
    } finally {
      Object.defineProperty(realm, "globalThis", globalThisDescriptor);
    }
    expect(result?.ok).toBe(false);
    expect(result).toMatchObject({
      diagnostics: [
        {
          message:
            "Document-v7 runtime intrinsics changed during the operation",
        },
      ],
    });
  });

  it("tracks dependency properties without locking unrelated constructor state", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Error,
      "stackTraceLimit",
    );
    expect(descriptor).toBeDefined();
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      typeof descriptor.value !== "number"
    ) {
      return;
    }
    let result: ReturnType<typeof parseDocumentValueV7> | undefined;
    try {
      Object.defineProperty(Error, "stackTraceLimit", {
        ...descriptor,
        value: descriptor.value + 1,
      });
      result = parseDocumentValueV7(stagedV7Document());
    } finally {
      Object.defineProperty(Error, "stackTraceLimit", descriptor);
    }
    expect(result?.ok).toBe(true);
  });

  it("detects SyntaxError prototype corruption before malformed JSON handling", () => {
    const prototype = Object.getPrototypeOf(SyntaxError.prototype);
    let result: ReturnType<typeof parseDocumentV7> | undefined;
    try {
      Object.setPrototypeOf(SyntaxError.prototype, null);
      result = parseDocumentV7("{");
    } finally {
      Object.setPrototypeOf(SyntaxError.prototype, prototype);
    }
    expect(result?.ok).toBe(false);
    expect(result).toMatchObject({
      diagnostics: [
        {
          message:
            "Document-v7 runtime intrinsics changed during the operation",
        },
      ],
    });
  });

  it("does not inspect hostile thrown values at the v7 boundary", () => {
    const mapDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "map",
    );
    expect(mapDescriptor).toBeDefined();
    if (mapDescriptor === undefined) return;
    const defineProperty = Object.defineProperty;
    const reflectGet = Reflect.get;
    let messageReads = 0;
    const hostileError = new Proxy(new Error("poisoned options"), {
      get(target, key, receiver): unknown {
        if (key === "message") {
          messageReads += 1;
          defineProperty(Array.prototype, "map", {
            configurable: true,
            value: (): readonly [] => [],
            writable: true,
          });
        }
        return reflectGet(target, key, receiver);
      },
    });
    const options = defineProperty({}, "limits", {
      configurable: true,
      enumerable: true,
      get(): never {
        throw hostileError;
      },
    });
    let result: ReturnType<typeof parseDocumentValueV7> | undefined;
    try {
      result = parseDocumentValueV7(stagedV7Document(), options);
    } finally {
      defineProperty(Array.prototype, "map", mapDescriptor);
    }
    expect(messageReads).toBe(0);
    expect(result?.ok).toBe(false);
    expect(result).toMatchObject({
      diagnostics: [
        {
          message:
            "Design-document-v7 parse limits could not be read safely",
        },
      ],
    });
  });

  it("uses the captured TypeError after throwing options corrupt the binding", () => {
    const source = stagedV7Document();
    const realm = globalThis;
    const typeErrorDescriptor = Object.getOwnPropertyDescriptor(
      realm,
      "TypeError",
    );
    expect(typeErrorDescriptor).toBeDefined();
    if (typeErrorDescriptor === undefined) return;
    const IntrinsicTypeError = TypeError;
    const operations = [
      (options: object) =>
        stringifyDocumentV7(
          source,
          options as Parameters<typeof stringifyDocumentV7>[1],
        ),
      (options: object) =>
        cloneDocumentV7(
          source,
          options as Parameters<typeof cloneDocumentV7>[1],
        ),
    ] as const;
    for (const operation of operations) {
      let typeErrorReads = 0;
      let thrown: unknown;
      const options = Object.defineProperty({}, "limits", {
        configurable: true,
        enumerable: true,
        get(): object {
          Object.defineProperty(realm, "TypeError", {
            configurable: true,
            get(): never {
              typeErrorReads += 1;
              throw { opaque: "TypeError accessor must not run" };
            },
          });
          return {};
        },
      });
      try {
        operation(options);
      } catch (error) {
        thrown = error;
      } finally {
        Object.defineProperty(realm, "TypeError", typeErrorDescriptor);
      }
      expect(typeErrorReads).toBe(0);
      expect(thrown).toBeInstanceOf(IntrinsicTypeError);
      expect((thrown as Error).message).toBe(
        "Document-v7 runtime intrinsics changed during the operation",
      );
    }
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

  it("contains ancestry checks for graphs deeper than the JavaScript stack", () => {
    const scalarOne = scalar(1);
    const nodes: Record<string, unknown> = {
      node0: {
        kind: "box",
        size: [length(1), length(1), length(1)],
        center: false,
      },
    };
    const depth = 15_000;
    for (let index = 1; index < depth; index += 1) {
      nodes[`node${index}`] = {
        kind: "transform",
        input: { node: `node${index - 1}`, kind: "solid" },
        operations: [
          {
            kind: "scale",
            value: [scalarOne, scalarOne, scalarOne],
          },
        ],
      };
    }
    nodes.final = {
      kind: "fillet",
      input: { node: `node${depth - 1}`, kind: "solid" },
      edges: {
        topology: "edge",
        query: {
          op: "origin",
          feature: "node0",
          relation: "created",
        },
        cardinality: { min: 1 },
      },
      radius: length(1),
    };
    const result = validateDocumentV7({
      schema: DOCUMENT_SCHEMA_V7,
      version: DOCUMENT_VERSION_V7,
      name: "deep-flat-graph",
      units: { length: "mm", angle: "rad" },
      parameters: {},
      nodes,
      outputs: { main: { node: "final", kind: "solid" } },
    } as unknown as DesignDocumentV7);
    expect(result.ok).toBe(true);
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
