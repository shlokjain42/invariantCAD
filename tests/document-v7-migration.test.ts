import { describe, expect, it } from "vitest";
import * as publicApi from "../src/index.js";
import { design, plane } from "../src/design.js";
import {
  kgPerCubicMeter,
  mm,
  vec2,
} from "../src/expressions.js";
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
  type DesignDocument,
  type DesignDocumentV7,
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
  admitDocumentBytesToV7,
  admitDocumentToV7,
  migrateDocumentToV7,
  parseDocumentValue,
  parseDocumentValueV7,
  parseDocumentToV7,
  stringifyDocument,
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
    name: "document-v7-migration",
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
      plane: {
        kind: "datumPlane",
        origin: [length(0), length(0), length(0)],
        xDirection: [scalar(1), scalar(0), scalar(0)],
        normal: [scalar(0), scalar(0), scalar(1)],
      },
      imported: {
        kind: "importedBody",
        resource: "importedStep",
        format: "step",
        units: { mode: "from-file" },
        healing: { mode: "none" },
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
            configuration: { mode: "base" },
            placement: [],
            suppressed: false,
          },
        ],
      },
    },
    outputs: {
      bodies: { node: "bodies", kind: "bodySet" },
      assembly: { node: "assembly", kind: "assembly" },
    },
    metadata: {
      protocol: "retained",
    },
  } as unknown as DesignDocumentV7;
}

function legacyAssemblyDocument(): DesignDocument {
  const cad = design("v7-migration-limits");
  const body = cad.box("body", {
    size: [mm(10), mm(20), mm(30)],
  });
  const part = cad.part("part", body, { partNumber: "LEGACY-1" });
  const assembly = cad.assembly("assembly", (instances) => {
    instances.instance("partOccurrence", part);
  });
  cad.output("assembly", assembly);
  return cad.build();
}

function legacyIdentityDocument(): DesignDocument {
  const cad = design("v7-migration-identities");
  const width = cad.parameter.length("width", mm(10));
  cad.sketch("profile", plane.xy(), (sketch) => {
    const center = sketch.point("center", vec2(mm(0), mm(0)));
    sketch.fixed("fixedCenter", center);
    return sketch.profile(
      sketch.rectangle("outer", {
        width: mm(10),
        height: mm(10),
      }),
    );
  });
  cad.sketch("secondProfile", plane.xy(), (sketch) => {
    const center = sketch.point("center", vec2(mm(0), mm(0)));
    sketch.fixed("fixedCenter", center);
    return sketch.profile(
      sketch.rectangle("outer", {
        width: mm(5),
        height: mm(5),
      }),
    );
  });
  const body = cad.box("body", {
    size: [width, mm(2), mm(3)],
  });
  const part = cad.part("part", body);
  const assembly = cad.assembly("assembly", (instances) => {
    instances.instance("first", part);
    instances.instance("second", part);
  });
  cad.assembly("secondAssembly", (instances) => {
    instances.instance("first", part);
  });
  cad.output("main", assembly);
  return cad.build();
}

function legacyPreservationDocument(): DesignDocument {
  const cad = design("v7-migration-preservation");
  const width = cad.parameter.length("width", mm(10));
  const steel = cad.material("steel", {
    name: "Migration Steel",
    massDensity: kgPerCubicMeter(7_850),
  });
  const body = cad.box("body", {
    size: [width, mm(2), mm(3)],
  });
  const part = cad.part("part", body, { materialRef: steel });
  const assembly = cad.assembly("assembly", (instances) => {
    instances.instance("part", part);
  });
  cad.configuration("wide", (configuration) => {
    configuration.parameter(width, mm(20));
  });
  cad.output("assembly", assembly);
  return cad.build();
}

function legacyBooleanDocument(): DesignDocument {
  const cad = design("v7-migration-boolean-order");
  const target = cad.box("target", {
    size: [mm(20), mm(12), mm(4)],
  });
  const firstTool = cad.box("firstTool", {
    size: [mm(2), mm(3), mm(4)],
  });
  const secondTool = cad.box("secondTool", {
    size: [mm(3), mm(2), mm(4)],
  });
  const result = cad.subtract("result", target, [
    secondTool,
    firstTool,
    secondTool,
  ]);
  cad.output("result", result);
  return cad.build();
}

interface MutableRecord {
  [key: string]: unknown;
}

interface MutableLegacyDocument extends MutableRecord {
  schema: string;
  version: number;
  parameters: Record<string, MutableRecord>;
  nodes: Record<string, MutableRecord>;
  outputs: Record<string, MutableRecord>;
}

function mutableDocument(source: DesignDocument): MutableLegacyDocument {
  return structuredClone(source) as unknown as MutableLegacyDocument;
}

function record(value: unknown): MutableRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Expected a mutable record");
  }
  return value as MutableRecord;
}

function records(value: unknown): MutableRecord[] {
  if (!Array.isArray(value)) throw new TypeError("Expected a mutable array");
  return value as MutableRecord[];
}

function structuralMetrics(value: unknown): {
  readonly occurrences: number;
  readonly depth: number;
} {
  const stack: { readonly value: unknown; readonly depth: number }[] = [
    { value, depth: 0 },
  ];
  let occurrences = 0;
  let depth = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    occurrences += 1;
    depth = Math.max(depth, current.depth);
    if (typeof current.value !== "object" || current.value === null) continue;
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    for (const child of children) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return { occurrences, depth };
}

const legacyVersions = [
  [DOCUMENT_SCHEMA_V1, DOCUMENT_VERSION_V1, DesignDocumentV1Schema],
  [DOCUMENT_SCHEMA_V2, DOCUMENT_VERSION_V2, DesignDocumentV2Schema],
  [DOCUMENT_SCHEMA_V3, DOCUMENT_VERSION_V3, DesignDocumentV3Schema],
  [DOCUMENT_SCHEMA_V4, DOCUMENT_VERSION_V4, DesignDocumentV4Schema],
  [DOCUMENT_SCHEMA_V5, DOCUMENT_VERSION_V5, DesignDocumentV5Schema],
  [DOCUMENT_SCHEMA_V6, DOCUMENT_VERSION_V6, DesignDocumentV6Schema],
] as const;

describe("staged document-v7 migration boundary", () => {
  it("accepts v7 directly and is canonically idempotent without losing v7 fields", () => {
    const source = stagedV7Document();
    const parsed = parseDocumentValueV7(source);
    expect(parsed.ok).toBe(true);
    const first = migrateDocumentToV7(source);
    expect(first.ok).toBe(true);
    if (!parsed.ok || !first.ok) return;
    expect(first.value).toEqual(parsed.value);
    expect(first.value).not.toBe(source);
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(first.value).toMatchObject({
      resources: source.resources,
      nodes: {
        origin: { kind: "datumPoint" },
        plane: { kind: "datumPlane" },
        imported: { kind: "importedBody" },
        bodies: { kind: "bodySet" },
        assembly: {
          instances: [
            {
              component: { source: "local" },
              configuration: { mode: "inherit" },
            },
            {
              component: { source: "external" },
              configuration: { mode: "base" },
            },
          ],
        },
      },
    });

    const second = migrateDocumentToV7(first.value);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(stringifyDocumentV7(second.value)).toBe(
      stringifyDocumentV7(first.value),
    );
  });

  it("admits raw text and fatal UTF-8 bytes from every frozen document grammar", () => {
    const encoder = new TextEncoder();
    for (const [schema, version, parser] of legacyVersions) {
      const source = parser.parse({
        ...legacyAssemblyDocument(),
        schema,
        version,
      }) as DesignDocument;
      const text = stringifyDocument(source);
      const admittedText = admitDocumentToV7(text);
      expect(admittedText.ok, `document v${version} text`).toBe(true);
      if (!admittedText.ok) continue;
      expect(admittedText.value.sourceVersion).toBe(version);
      expect(admittedText.value.document.version).toBe(
        DOCUMENT_VERSION_V7,
      );
      expect(Object.isFrozen(admittedText.value.document)).toBe(true);
      expect(
        (
          admittedText.value.document.nodes as unknown as Readonly<
            Record<string, unknown>
          >
        ).assembly,
      ).toMatchObject({
        kind: "assembly",
        instances: [
          {
            component: {
              source: "local",
              reference: { node: "part", kind: "part" },
            },
            configuration: { mode: "inherit" },
          },
        ],
      });

      const bytes = encoder.encode(text);
      const admittedBytes = admitDocumentBytesToV7(bytes);
      expect(admittedBytes.ok, `document v${version} bytes`).toBe(true);
      if (!admittedBytes.ok) continue;
      expect(admittedBytes.value.sourceVersion).toBe(version);
      expect(admittedBytes.value.document).toEqual(
        admittedText.value.document,
      );

      const documentOnly = parseDocumentToV7(text);
      expect(documentOnly.ok, `document v${version} convenience`).toBe(
        true,
      );
      if (documentOnly.ok) {
        expect(documentOnly.value).toEqual(
          admittedText.value.document,
        );
      }
    }

    const stagedText = stringifyDocumentV7(stagedV7Document());
    const staged = admitDocumentToV7(stagedText);
    expect(staged.ok).toBe(true);
    if (staged.ok) {
      expect(staged.value.sourceVersion).toBe(DOCUMENT_VERSION_V7);
      expect(staged.value.document.resources).toEqual(
        stagedV7Document().resources,
      );
    }
  });

  it("rejects duplicate decoded members and malformed resource bytes before admission", () => {
    const source = stringifyDocument(legacyAssemblyDocument());
    const duplicate = String.raw`{"na\u006de":"shadowed",${source.slice(1)}`;
    expect(admitDocumentToV7(duplicate)).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          message:
            "Design-document JSON contains a duplicate object member name",
          details: {
            reason: "duplicate-json-member",
          },
        },
      ],
    });

    expect(
      admitDocumentBytesToV7(Uint8Array.of(0x7b, 0x22, 0xc3, 0x28)),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          message: "Design-document bytes are not valid UTF-8",
          details: {
            reason: "invalid-utf8",
          },
        },
      ],
    });

    const bytes = new TextEncoder().encode(source);
    expect(
      admitDocumentBytesToV7(bytes, {
        limits: { maxDocumentBytes: bytes.byteLength - 1 },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          details: {
            resource: "maxDocumentBytes",
            limit: bytes.byteLength - 1,
            actual: bytes.byteLength,
          },
        },
      ],
    });
    const stagedBytes = new TextEncoder().encode(
      stringifyDocumentV7(stagedV7Document()),
    );
    expect(
      admitDocumentBytesToV7(stagedBytes, {
        limits: { maxDocumentBytes: stagedBytes.byteLength },
      }).ok,
    ).toBe(true);
  });

  it("contains revoked and opaque byte-input failures", () => {
    const revoked = Proxy.revocable(new Uint8Array(), {});
    revoked.revoke();
    let revokedResult:
      | ReturnType<typeof admitDocumentBytesToV7>
      | undefined;
    expect(() => {
      revokedResult = admitDocumentBytesToV7(revoked.proxy);
    }).not.toThrow();
    expect(revokedResult?.ok).toBe(false);

    const opaque = Proxy.revocable({}, {});
    opaque.revoke();
    const throwing = new Proxy(new Uint8Array(), {
      getPrototypeOf(): never {
        throw opaque.proxy;
      },
    });
    let opaqueResult:
      | ReturnType<typeof admitDocumentBytesToV7>
      | undefined;
    expect(() => {
      opaqueResult = admitDocumentBytesToV7(throwing);
    }).not.toThrow();
    expect(opaqueResult?.ok).toBe(false);
  });

  it("fails closed if TextDecoder changes before resource-byte decoding", () => {
    const source = new TextEncoder().encode(
      stringifyDocument(legacyAssemblyDocument()),
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "TextDecoder",
    );
    expect(descriptor).toBeDefined();
    if (descriptor === undefined) return;
    let result:
      | ReturnType<typeof admitDocumentBytesToV7>
      | undefined;
    try {
      result = admitDocumentBytesToV7(
        source,
        Object.defineProperty({}, "limits", {
          enumerable: true,
          get(): object {
            Object.defineProperty(globalThis, "TextDecoder", {
              configurable: true,
              value: class PoisonedTextDecoder {},
              writable: true,
            });
            return {};
          },
        }),
      );
    } finally {
      Object.defineProperty(globalThis, "TextDecoder", descriptor);
    }
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          message:
            "Document-v7 runtime intrinsics changed during the operation",
        },
      ],
    });

    const decodeDescriptor = Object.getOwnPropertyDescriptor(
      TextDecoder.prototype,
      "decode",
    );
    expect(decodeDescriptor).toBeDefined();
    if (decodeDescriptor === undefined) return;
    try {
      result = admitDocumentBytesToV7(
        source,
        Object.defineProperty({}, "limits", {
          enumerable: true,
          get(): object {
            Object.defineProperty(TextDecoder.prototype, "decode", {
              configurable: true,
              value: (): string => "{}",
              writable: true,
            });
            return {};
          },
        }),
      );
    } finally {
      Object.defineProperty(
        TextDecoder.prototype,
        "decode",
        decodeDescriptor,
      );
    }
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "IR_INVALID",
          message:
            "Document-v7 runtime intrinsics changed during the operation",
        },
      ],
    });
  });

  it("keeps compatible raw-document admission out of the package root", () => {
    expect("admitDocumentToV7" in publicApi).toBe(false);
    expect("admitDocumentBytesToV7" in publicApi).toBe(false);
    expect("parseDocumentToV7" in publicApi).toBe(false);
  });

  it("captures caller-owned document data once and reads limits once", () => {
    const source = mutableDocument(legacyAssemblyDocument());
    const nestedOwnKeys = Reflect.ownKeys(source.nodes);
    let nestedOwnKeyReads = 0;
    let nestedDescriptorReads = 0;
    let nestedValueReads = 0;
    const sharedNodes = new Proxy(source.nodes, {
      ownKeys(target): (string | symbol)[] {
        nestedOwnKeyReads += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(
        target,
        key,
      ): PropertyDescriptor | undefined {
        nestedDescriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(): never {
        nestedValueReads += 1;
        throw new Error("nested caller input values must come from descriptors");
      },
    });
    source.nodes = sharedNodes;
    source.metadata = { sharedNodes };
    const ownKeys = Reflect.ownKeys(source);
    let ownKeyReads = 0;
    let descriptorReads = 0;
    let valueReads = 0;
    const proxied = new Proxy(source, {
      ownKeys(target): (string | symbol)[] {
        ownKeyReads += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(
        target,
        key,
      ): PropertyDescriptor | undefined {
        descriptorReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      get(): never {
        valueReads += 1;
        throw new Error("caller input values must come from descriptors");
      },
    });
    let limitReads = 0;
    const options = Object.defineProperty({}, "limits", {
      enumerable: true,
      get(): object {
        limitReads += 1;
        return {};
      },
    });

    const migrated = migrateDocumentToV7(proxied, options);
    expect(migrated.ok).toBe(true);
    expect(ownKeyReads).toBe(1);
    expect(descriptorReads).toBe(ownKeys.length);
    expect(valueReads).toBe(0);
    expect(nestedOwnKeyReads).toBe(1);
    expect(nestedDescriptorReads).toBe(nestedOwnKeys.length);
    expect(nestedValueReads).toBe(0);
    expect(limitReads).toBe(1);
  });

  it("rejects accessors and contains revoked or opaque proxy failures", () => {
    const accessor = structuredClone(legacyAssemblyDocument()) as unknown as
      MutableRecord;
    let getterReads = 0;
    Object.defineProperty(accessor, "name", {
      enumerable: true,
      get(): string {
        getterReads += 1;
        return "accessor-name";
      },
    });
    const accessorResult = migrateDocumentToV7(accessor);
    expect(accessorResult.ok).toBe(false);
    expect(getterReads).toBe(0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    let revokedResult: ReturnType<typeof migrateDocumentToV7> | undefined;
    expect(() => {
      revokedResult = migrateDocumentToV7(revoked.proxy);
    }).not.toThrow();
    expect(revokedResult?.ok).toBe(false);

    const opaque = Proxy.revocable({}, {});
    opaque.revoke();
    const throwing = new Proxy(structuredClone(legacyAssemblyDocument()), {
      ownKeys(): never {
        throw opaque.proxy;
      },
    });
    let opaqueResult: ReturnType<typeof migrateDocumentToV7> | undefined;
    expect(() => {
      opaqueResult = migrateDocumentToV7(throwing);
    }).not.toThrow();
    expect(opaqueResult?.ok).toBe(false);
  });

  it("rechecks structural and depth limits after assembly expansion", () => {
    const source = legacyAssemblyDocument();
    const baseline = migrateDocumentToV7(source);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const before = structuralMetrics(source);
    const after = structuralMetrics(baseline.value);
    expect(before).toEqual({ occurrences: 45, depth: 6 });
    expect(after).toEqual({ occurrences: 49, depth: 7 });

    expect(
      migrateDocumentToV7(source, {
        limits: { maxStructuralValues: before.occurrences },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          details: {
            resource: "maxStructuralValues",
            limit: before.occurrences,
            actual: before.occurrences + 1,
          },
        },
      ],
    });
    expect(
      migrateDocumentToV7(source, {
        limits: { maxNestingDepth: before.depth },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          details: {
            resource: "maxNestingDepth",
            limit: before.depth,
            actual: before.depth + 1,
          },
        },
      ],
    });
  });

  it("enforces the transformed canonical byte boundary exactly", () => {
    const source = mutableDocument(legacyAssemblyDocument());
    source.metadata = {
      text: "é😀\ud800",
    };
    const baseline = migrateDocumentToV7(source);
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const exact = new TextEncoder().encode(
      stringifyDocumentV7(baseline.value),
    ).byteLength;

    expect(
      migrateDocumentToV7(source, {
        limits: { maxDocumentBytes: exact },
      }).ok,
    ).toBe(true);
    expect(
      migrateDocumentToV7(source, {
        limits: { maxDocumentBytes: exact - 1 },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          details: {
            resource: "maxDocumentBytes",
            limit: exact - 1,
            actualAtLeast: exact,
          },
        },
      ],
    });
  });

  it("enforces direct-v7 bytes before terminal schema cloning", () => {
    const source = structuredClone(stagedV7Document()) as unknown as
      MutableRecord;
    Reflect.deleteProperty(source, "name");
    source.metadata = { payload: "x".repeat(4_096) };

    expect(
      migrateDocumentToV7(source, {
        limits: { maxDocumentBytes: 256 },
      }),
    ).toMatchObject({
      ok: false,
      diagnostics: [
        {
          details: {
            resource: "maxDocumentBytes",
            limit: 256,
            actualAtLeast: 257,
          },
        },
      ],
    });
  });

  it("fails closed if migration-time traps replace ambient helpers", () => {
    const defineProperty = Object.defineProperty;
    const reflectOwnKeys = Reflect.ownKeys;
    const mutations: readonly {
      readonly holder: object;
      readonly key: PropertyKey;
      readonly label: string;
    }[] = [
      { holder: Object, key: "entries", label: "Object.entries" },
      { holder: Object, key: "fromEntries", label: "Object.fromEntries" },
      {
        holder: Array.prototype,
        key: "map",
        label: "Array.prototype.map",
      },
    ];

    for (const mutation of mutations) {
      const descriptor = Object.getOwnPropertyDescriptor(
        mutation.holder,
        mutation.key,
      );
      expect(descriptor, mutation.label).toBeDefined();
      if (descriptor === undefined) continue;
      let poisonCalls = 0;
      let mutated = false;
      const trapped = new Proxy(structuredClone(legacyAssemblyDocument()), {
        ownKeys(target): (string | symbol)[] {
          if (!mutated) {
            mutated = true;
            defineProperty(mutation.holder, mutation.key, {
              configurable: true,
              value: (): never => {
                poisonCalls += 1;
                throw new Error(`${mutation.label} must not run`);
              },
              writable: true,
            });
          }
          return reflectOwnKeys(target);
        },
      });
      let result: ReturnType<typeof migrateDocumentToV7> | undefined;
      try {
        expect(() => {
          result = migrateDocumentToV7(trapped);
        }).not.toThrow();
      } finally {
        defineProperty(mutation.holder, mutation.key, descriptor);
      }
      expect(poisonCalls, mutation.label).toBe(0);
      expect(result, mutation.label).toMatchObject({
        ok: false,
        diagnostics: [
          {
            message:
              "Document-v7 runtime intrinsics changed during the operation",
          },
        ],
      });
    }
  });

  it("fails closed on enumerable Object.prototype additions during capture", () => {
    const key = "__invariantcadV7MigrationMutation__";
    const defineProperty = Object.defineProperty;
    const deleteProperty = Reflect.deleteProperty;
    const reflectOwnKeys = Reflect.ownKeys;
    expect(Object.getOwnPropertyDescriptor(Object.prototype, key)).toBeUndefined();
    const trapped = new Proxy(structuredClone(legacyAssemblyDocument()), {
      ownKeys(target): (string | symbol)[] {
        defineProperty(Object.prototype, key, {
          configurable: true,
          enumerable: true,
          value: true,
          writable: true,
        });
        return reflectOwnKeys(target);
      },
    });
    let result: ReturnType<typeof migrateDocumentToV7> | undefined;
    try {
      result = migrateDocumentToV7(trapped);
    } finally {
      deleteProperty(Object.prototype, key);
    }
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          message:
            "Document-v7 runtime intrinsics changed during the operation",
        },
      ],
    });
  });

  it("reports all six tightened identity namespaces for every frozen version", () => {
    const cases: readonly {
      readonly identityKind: string;
      readonly path: string;
      readonly mutate: (document: MutableLegacyDocument) => void;
    }[] = [
      {
        identityKind: "parameter",
        path: "/parameters/1bad",
        mutate(document): void {
          document.parameters["1bad"] = document.parameters.width!;
          Reflect.deleteProperty(document.parameters, "width");
          record(records(document.nodes.body!.size)[0]).id = "1bad";
        },
      },
      {
        identityKind: "node",
        path: "/nodes/1bad",
        mutate(document): void {
          document.nodes["1bad"] = document.nodes.body!;
          Reflect.deleteProperty(document.nodes, "body");
          record(document.nodes.part!.solid).node = "1bad";
        },
      },
      {
        identityKind: "output",
        path: "/outputs/1bad",
        mutate(document): void {
          document.outputs["1bad"] = document.outputs.main!;
          Reflect.deleteProperty(document.outputs, "main");
        },
      },
      {
        identityKind: "sketch-entity",
        path: "/nodes/profile/entities/1bad",
        mutate(document): void {
          const entities = record(document.nodes.profile!.entities);
          entities["1bad"] = entities.center;
          Reflect.deleteProperty(entities, "center");
          const constraints = record(document.nodes.profile!.constraints);
          record(constraints.fixedCenter).entity = "1bad";
        },
      },
      {
        identityKind: "sketch-constraint",
        path: "/nodes/profile/constraints/1bad",
        mutate(document): void {
          const constraints = record(document.nodes.profile!.constraints);
          constraints["1bad"] = constraints.fixedCenter;
          Reflect.deleteProperty(constraints, "fixedCenter");
        },
      },
      {
        identityKind: "assembly-occurrence",
        path: "/nodes/assembly/instances/0/id",
        mutate(document): void {
          records(document.nodes.assembly!.instances)[0]!.id = "1bad";
        },
      },
    ];

    for (const identityCase of cases) {
      for (const [schema, version, parser] of legacyVersions) {
        const mutable = mutableDocument(legacyIdentityDocument());
        identityCase.mutate(mutable);
        const source = parser.parse({
          ...mutable,
          schema,
          version,
        }) as DesignDocument;
        expect(
          parseDocumentValue(source).ok,
          `${identityCase.identityKind} v${version} legacy parse`,
        ).toBe(true);
        const before = stringifyDocument(source);
        const migrated = migrateDocumentToV7(source);
        expect(
          migrated.ok,
          `${identityCase.identityKind} v${version} migration`,
        ).toBe(false);
        expect(stringifyDocument(source)).toBe(before);
        expect(migrated.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "IR_INVALID",
              path: identityCase.path,
              details: expect.objectContaining({
                reason: "document-v7-id-grammar-incompatible",
                identityKind: identityCase.identityKind,
                identity: "1bad",
                sourceVersion: version,
                targetVersion: DOCUMENT_VERSION_V7,
              }),
            }),
          ]),
        );
      }
    }
  });

  it("preserves configurations, materials, and stored topology evidence exactly", () => {
    for (const [schema, version, parser] of legacyVersions) {
      if (version === DOCUMENT_VERSION_V1) continue;
      const source = mutableDocument(legacyPreservationDocument());
      source.topologyReferences = {
        reference: {
          target: { node: "body", kind: "solid" },
          topology: "face",
          variants: [
            {
              protocolVersion: 1,
              kernelFingerprint: "document-v7-migration-preservation",
              topology: "face",
              capturedHistory: "complete",
              tolerance: {
                linear: 1e-7,
                angular: 1e-7,
                relative: 1e-7,
              },
              lineage: [
                {
                  feature: "body",
                  relation: "created",
                },
              ],
              geometry: {
                topology: "face",
                kind: "plane",
                measure: 20,
                center: [0, 1, 1.5],
                bounds: {
                  min: [0, 0, 0],
                  max: [0, 2, 3],
                },
                normal: [-1, 0, 0],
              },
              adjacency: [],
            },
          ],
        },
      };
      const parsed = parser.parse({
        ...source,
        schema,
        version,
      }) as DesignDocument;
      const before = stringifyDocument(parsed);

      const migrated = migrateDocumentToV7(parsed);
      expect(migrated.ok, `document v${version}`).toBe(true);
      if (!migrated.ok) continue;
      expect(migrated.value.materials).toEqual(parsed.materials);
      expect(migrated.value.configurations).toEqual(
        parsed.configurations,
      );
      expect(migrated.value.topologyReferences).toEqual(
        parsed.topologyReferences,
      );
      expect(stringifyDocument(parsed)).toBe(before);
    }
  });

  it("preserves Boolean operation and authored operand order from every frozen legacy grammar", () => {
    for (const [schema, version, parser] of legacyVersions) {
      const source = parser.parse({
        ...legacyBooleanDocument(),
        schema,
        version,
      }) as DesignDocument;
      const sourceBoolean = (
        source.nodes as unknown as Readonly<Record<string, unknown>>
      ).result;
      expect(sourceBoolean).toMatchObject({
        kind: "boolean",
        operation: "subtract",
        target: { node: "target", kind: "solid" },
        tools: [
          { node: "secondTool", kind: "solid" },
          { node: "firstTool", kind: "solid" },
          { node: "secondTool", kind: "solid" },
        ],
      });
      const before = stringifyDocument(source);

      const migrated = migrateDocumentToV7(source);
      expect(migrated.ok, `document v${version}`).toBe(true);
      if (!migrated.ok) continue;
      expect(
        (
          migrated.value.nodes as unknown as Readonly<
            Record<string, unknown>
          >
        ).result,
      ).toEqual(sourceBoolean);
      expect(stringifyDocument(source)).toBe(before);
    }
  });

  it("escapes and orders incompatible identity paths deterministically", () => {
    const invalidIds = ["", "bad id", "bad/id", "é"];
    const source = mutableDocument(legacyIdentityDocument());
    const output = source.outputs.main!;
    Reflect.deleteProperty(source.outputs, "main");
    for (const id of invalidIds) source.outputs[id] = output;

    const migrated = migrateDocumentToV7(source);
    expect(migrated.ok).toBe(false);
    expect(
      migrated.diagnostics.map((item) => item.path),
    ).toEqual([
      "/outputs/",
      "/outputs/bad id",
      "/outputs/bad~1id",
      "/outputs/é",
    ]);
  });

  it("orders wide incompatible registries without quadratic insertion work", () => {
    const source = mutableDocument(legacyIdentityDocument());
    const output = source.outputs.main!;
    Reflect.deleteProperty(source.outputs, "main");
    const count = 2_048;
    for (let index = count - 1; index >= 0; index -= 1) {
      source.outputs[`1bad-${String(index).padStart(4, "0")}`] = output;
    }

    const migrated = migrateDocumentToV7(source);
    expect(migrated.ok).toBe(false);
    const paths = migrated.diagnostics.map((item) => item.path);
    expect(paths).toHaveLength(count);
    expect(paths).toEqual([...paths].sort());
  });

  it("reports incompatible historical identities in stored topology evidence", () => {
    const source = mutableDocument(legacyAssemblyDocument());
    source.topologyReferences = {
      reference: {
        target: { node: "body", kind: "solid" },
        topology: "face",
        variants: [
          {
            protocolVersion: 2,
            kernelFingerprint: "document-v7-migration-evidence",
            topology: "face",
            capturedHistory: "complete",
            tolerance: {
              linear: 1e-7,
              angular: 1e-7,
              relative: 1e-7,
            },
            lineage: [
              {
                feature: "historical feature",
                relation: "created",
                source: {
                  kind: "sketch-entity",
                  sketch: "historical sketch",
                  entity: "historical/entity",
                },
              },
            ],
            geometry: {
              topology: "face",
              kind: "plane",
              measure: 100,
              center: [0, 5, 5],
              bounds: {
                min: [0, 0, 0],
                max: [10, 10, 10],
              },
              normal: [1, 0, 0],
            },
            adjacency: [],
          },
        ],
      },
    };
    expect(parseDocumentValue(source).ok).toBe(true);

    const migrated = migrateDocumentToV7(source);
    expect(migrated.ok).toBe(false);
    expect(migrated.diagnostics).toMatchObject([
      {
        path: "/topologyReferences/reference/variants/0/lineage/0/feature",
        details: {
          reason: "document-v7-id-grammar-incompatible",
          identityKind: "node",
          identity: "historical feature",
        },
      },
      {
        path:
          "/topologyReferences/reference/variants/0/lineage/0/source/entity",
        details: {
          reason: "document-v7-id-grammar-incompatible",
          identityKind: "sketch-entity",
          identity: "historical/entity",
        },
      },
      {
        path:
          "/topologyReferences/reference/variants/0/lineage/0/source/sketch",
        details: {
          reason: "document-v7-id-grammar-incompatible",
          identityKind: "node",
          identity: "historical sketch",
        },
      },
    ]);
  });

  it("rejects duplicate occurrence IDs per assembly with first-site evidence", () => {
    for (const [schema, version, parser] of legacyVersions) {
      const mutable = mutableDocument(legacyIdentityDocument());
      const instances = records(mutable.nodes.assembly!.instances);
      instances[1]!.id = instances[0]!.id;
      const source = parser.parse({
        ...mutable,
        schema,
        version,
      }) as DesignDocument;
      expect(parseDocumentValue(source).ok).toBe(true);
      const migrated = migrateDocumentToV7(source);
      expect(migrated).toMatchObject({
        ok: false,
        diagnostics: [
          {
            code: "DUPLICATE_ID",
            path: "/nodes/assembly/instances/1/id",
            related: [
              {
                path: "/nodes/assembly/instances/0/id",
                message: "First occurrence is declared here",
              },
            ],
            details: {
              reason: "document-v7-duplicate-assembly-occurrence-id",
              identityKind: "assembly-occurrence",
              identity: "first",
              sourceVersion: version,
              targetVersion: DOCUMENT_VERSION_V7,
            },
          },
        ],
      });
    }
  });

  it("accepts v7 punctuation and keeps identity uniqueness scoped locally", () => {
    const source = mutableDocument(legacyIdentityDocument());
    const id = "a._:-9";
    source.parameters[id] = source.parameters.width!;
    Reflect.deleteProperty(source.parameters, "width");
    record(records(source.nodes.body!.size)[0]).id = id;
    source.outputs[id] = source.outputs.main!;
    Reflect.deleteProperty(source.outputs, "main");
    const profile = source.nodes.profile!;
    const entities = record(profile.entities);
    entities[id] = entities.center;
    Reflect.deleteProperty(entities, "center");
    const constraints = record(profile.constraints);
    record(constraints.fixedCenter).entity = id;
    constraints[id] = constraints.fixedCenter;
    Reflect.deleteProperty(constraints, "fixedCenter");
    records(source.nodes.assembly!.instances)[0]!.id = id;
    records(source.nodes.secondAssembly!.instances)[0]!.id = id;
    const secondProfile = source.nodes.secondProfile!;
    const secondEntities = record(secondProfile.entities);
    secondEntities[id] = secondEntities.center;
    Reflect.deleteProperty(secondEntities, "center");
    const secondConstraints = record(secondProfile.constraints);
    record(secondConstraints.fixedCenter).entity = id;
    secondConstraints[id] = secondConstraints.fixedCenter;
    Reflect.deleteProperty(secondConstraints, "fixedCenter");

    expect(parseDocumentValue(source).ok).toBe(true);
    expect(migrateDocumentToV7(source).ok).toBe(true);
  });
});
