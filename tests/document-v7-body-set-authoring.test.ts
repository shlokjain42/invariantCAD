import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OcctKernel as RawOcctKernel,
  type ShapeHandle,
} from "occt-wasm";
import {
  configurationId,
  parameterId,
} from "../src/core/ids.js";
import { DEFAULT_DESIGN_DOCUMENT_LIMITS } from "../src/document-limits.js";
import {
  EvaluatedSolid,
  evaluateBodySetOutputsV7,
  evaluateImportedBodyOutputsV7,
} from "../src/evaluator.js";
import { deg, mm, scalar } from "../src/expressions.js";
import { hashDesignFeaturesV2 } from "../src/feature-hashes-v2.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type DesignDocumentV7,
  type ResourceDigestIR,
} from "../src/ir.js";
import {
  stagedBodySetDesignV7,
  StagedBodyLeafRefV7,
  StagedBodySetRefV7,
  StagedSolidRefV7,
} from "../src/internal/document-v7-body-set-authoring.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import type { GeometryKernel } from "../src/kernel.js";
import * as publicApi from "../src/index.js";
import type {
  ResourceResolverRequestV7,
} from "../src/resource-resolution.js";
import {
  cloneDocumentV7,
  migrateDocumentToV7,
  parseDocumentV7,
  stringifyDocumentV7,
} from "../src/serialization.js";

const encoder = new TextEncoder();
const ZERO_DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000" as const;

async function digest(bytes: Uint8Array): Promise<ResourceDigestIR> {
  const copied = bytes.slice();
  const value = await crypto.subtle.digest("SHA-256", copied);
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeepFrozen(descriptor.value, seen);
    }
  }
}

function resourceCommitment(
  overrides: Readonly<Record<string, unknown>> = {},
): {
  readonly digest: ResourceDigestIR;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly locations: readonly string[];
} {
  return {
    digest: ZERO_DIGEST,
    byteLength: 0,
    mediaType: "application/octet-stream",
    locations: ["project://fixtures/zero"],
    ...overrides,
  } as {
    readonly digest: ResourceDigestIR;
    readonly byteLength: number;
    readonly mediaType: string;
    readonly locations: readonly string[];
  };
}

function expectAuthoringFailure(author: () => unknown, pattern: RegExp): void {
  expect(author).toThrow(pattern);
}

describe("staged document-v7 body-set authoring", () => {
  it("emits exact detached frozen v7 IR and round-trips canonically", async () => {
    const designMetadata = { purpose: "acceptance", nested: { revision: 2 } };
    const configurationMetadata = {
      intent: "clearance",
      nested: { review: "approved" },
    };
    const resourceMetadata = { source: "fixture", nested: { checked: true } };
    const memberMetadata = { finish: "ground", nested: { station: 3 } };
    const locations = [
      "project://fixtures/imported.step",
      "https://example.invalid/imported.step",
    ];

    const cad = stagedBodySetDesignV7("authored-v7", {
      metadata: designMetadata,
    });
    const width = cad.parameter.length("width", mm(2), {
      min: mm(1),
      max: mm(10),
      label: "Width",
      description: "Configurable width",
    });
    cad.configuration(
      "wide",
      (configuration) => configuration.parameter(width, mm(5)),
      {
        description: "Wider native body",
        metadata: configurationMetadata,
      },
    );
    const resource = cad.resource("fixture", {
      digest: ZERO_DIGEST,
      byteLength: 0,
      mediaType: "model/step",
      locations,
      metadata: resourceMetadata,
    });
    const native = cad.box("native", {
      size: [width, mm(3), mm(4)],
      center: true,
    });
    const cylinder = cad.cylinder("cylinder", {
      height: mm(8),
      radius: mm(2),
      radiusTop: mm(1),
      center: false,
      segments: 32,
    });
    const sphere = cad.sphere("sphere", {
      radius: mm(3),
      segments: 24,
    });
    const imported = cad.importedBody("imported", resource, {
      format: "step",
      units: { mode: "from-file" },
    });
    const members = [
      {
        id: "imported-member",
        solid: imported,
        name: "Imported body",
        metadata: memberMetadata,
      },
      { id: "native-member", solid: native },
      { id: "native-alias", solid: native, name: "Shared native body" },
      { id: "cylinder-member", solid: cylinder },
      { id: "sphere-member", solid: sphere },
    ];
    const bodies = cad.bodySet("bodies", members);
    cad.output("imported-output", imported);
    cad.output("body-set-output", bodies);

    expect(Object.isFrozen(resource)).toBe(true);
    expect(Object.isFrozen(native)).toBe(true);
    expect(Object.isFrozen(imported)).toBe(true);
    expect(Object.isFrozen(bodies)).toBe(true);

    const document = cad.build();
    expect(document).toEqual({
      schema: DOCUMENT_SCHEMA_V7,
      version: DOCUMENT_VERSION_V7,
      name: "authored-v7",
      units: { length: "mm", angle: "rad" },
      parameters: {
        width: {
          dimension: "length",
          default: { op: "literal", dimension: "length", value: 2 },
          min: { op: "literal", dimension: "length", value: 1 },
          max: { op: "literal", dimension: "length", value: 10 },
          label: "Width",
          description: "Configurable width",
        },
      },
      configurations: {
        wide: {
          description: "Wider native body",
          parameterOverrides: {
            width: { op: "literal", dimension: "length", value: 5 },
          },
          metadata: {
            intent: "clearance",
            nested: { review: "approved" },
          },
        },
      },
      resources: {
        fixture: {
          digest: ZERO_DIGEST,
          byteLength: 0,
          mediaType: "model/step",
          locations: [
            "project://fixtures/imported.step",
            "https://example.invalid/imported.step",
          ],
          metadata: {
            source: "fixture",
            nested: { checked: true },
          },
        },
      },
      nodes: {
        native: {
          kind: "box",
          size: [
            { op: "parameter", dimension: "length", id: "width" },
            { op: "literal", dimension: "length", value: 3 },
            { op: "literal", dimension: "length", value: 4 },
          ],
          center: true,
        },
        cylinder: {
          kind: "cylinder",
          height: { op: "literal", dimension: "length", value: 8 },
          radiusBottom: { op: "literal", dimension: "length", value: 2 },
          radiusTop: { op: "literal", dimension: "length", value: 1 },
          center: false,
          segments: 32,
        },
        sphere: {
          kind: "sphere",
          radius: { op: "literal", dimension: "length", value: 3 },
          segments: 24,
        },
        imported: {
          kind: "importedBody",
          resource: "fixture",
          format: "step",
          units: { mode: "from-file" },
          healing: { mode: "none" },
          expected: "single-solid",
        },
        bodies: {
          kind: "bodySet",
          bodies: [
            {
              id: "imported-member",
              solid: { node: "imported", kind: "solid" },
              name: "Imported body",
              metadata: {
                finish: "ground",
                nested: { station: 3 },
              },
            },
            {
              id: "native-member",
              solid: { node: "native", kind: "solid" },
            },
            {
              id: "native-alias",
              solid: { node: "native", kind: "solid" },
              name: "Shared native body",
            },
            {
              id: "cylinder-member",
              solid: { node: "cylinder", kind: "solid" },
            },
            {
              id: "sphere-member",
              solid: { node: "sphere", kind: "solid" },
            },
          ],
        },
      },
      outputs: {
        "imported-output": { node: "imported", kind: "solid" },
        "body-set-output": { node: "bodies", kind: "bodySet" },
      },
      metadata: {
        purpose: "acceptance",
        nested: { revision: 2 },
      },
    });
    expectDeepFrozen(document);

    expect(Object.isFrozen(designMetadata)).toBe(false);
    expect(Object.isFrozen(configurationMetadata)).toBe(false);
    expect(Object.isFrozen(resourceMetadata)).toBe(false);
    expect(Object.isFrozen(memberMetadata)).toBe(false);
    expect(Object.isFrozen(locations)).toBe(false);
    expect(Object.isFrozen(members)).toBe(false);
    expect(Object.isFrozen(members[0])).toBe(false);
    designMetadata.nested.revision = 99;
    configurationMetadata.nested.review = "mutated";
    resourceMetadata.nested.checked = false;
    memberMetadata.nested.station = 99;
    locations[0] = "project://mutated";
    members.reverse();
    expect(document.metadata).toEqual({
      purpose: "acceptance",
      nested: { revision: 2 },
    });
    expect(Object.values(document.configurations ?? {})[0]?.metadata).toEqual({
      intent: "clearance",
      nested: { review: "approved" },
    });
    expect(Object.values(document.resources ?? {})[0]).toMatchObject({
      locations: [
        "project://fixtures/imported.step",
        "https://example.invalid/imported.step",
      ],
      metadata: { source: "fixture", nested: { checked: true } },
    });
    const authoredBodySet = Object.values(document.nodes).find(
      (node) => node.kind === "bodySet",
    );
    expect(authoredBodySet?.kind).toBe("bodySet");
    if (authoredBodySet?.kind !== "bodySet") return;
    expect(authoredBodySet.bodies[0]).toMatchObject({
      id: "imported-member",
      metadata: { finish: "ground", nested: { station: 3 } },
    });

    const text = stringifyDocumentV7(document);
    const parsed = parseDocumentV7(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(stringifyDocumentV7(parsed.value)).toBe(text);
    expect(parsed.value).not.toBe(document);
    expectDeepFrozen(parsed.value);

    const cloned = cloneDocumentV7(document);
    expect(cloned).toEqual(document);
    expect(cloned).not.toBe(document);
    expectDeepFrozen(cloned);

    const firstMigration = migrateDocumentToV7(document);
    expect(firstMigration.ok).toBe(true);
    if (!firstMigration.ok) return;
    const secondMigration = migrateDocumentToV7(firstMigration.value);
    expect(secondMigration.ok).toBe(true);
    if (!secondMigration.ok) return;
    expect(stringifyDocumentV7(firstMigration.value)).toBe(text);
    expect(stringifyDocumentV7(secondMigration.value)).toBe(text);

    const baseHash = await hashDesignFeaturesV2(document);
    const repeatedHash = await hashDesignFeaturesV2(document);
    const wideHash = await hashDesignFeaturesV2(document, {
      configuration: "wide",
    });
    expect(baseHash.ok).toBe(true);
    expect(repeatedHash).toEqual(baseHash);
    expect(wideHash.ok).toBe(true);
    if (!baseHash.ok || !wideHash.ok) return;
    expect(baseHash.value.configurationId).toBeNull();
    expect(wideHash.value.configurationId).toBe("wide");
    const baseNative = baseHash.value.nodes.find(
      (entry) => entry.node === "native",
    );
    const wideNative = wideHash.value.nodes.find(
      (entry) => entry.node === "native",
    );
    const baseImported = baseHash.value.nodes.find(
      (entry) => entry.node === "imported",
    );
    const wideImported = wideHash.value.nodes.find(
      (entry) => entry.node === "imported",
    );
    expect(baseNative?.parameterValues).toEqual({ width: 2 });
    expect(wideNative?.parameterValues).toEqual({ width: 5 });
    expect(wideNative?.hash).not.toBe(baseNative?.hash);
    expect(wideImported?.hash).toBe(baseImported?.hash);
  });

  it("authors owner-bound transform chains with parameterized convenience operations", () => {
    const cad = stagedBodySetDesignV7("authored-transform-chain");
    const distance = cad.parameter.length("distance", mm(5));
    const angle = cad.parameter.angle("angle", deg(30), {
      min: deg(0),
      max: deg(180),
    });
    const factor = cad.parameter.scalar("factor", scalar(2));
    cad.configuration("turned", (configuration) => {
      configuration.parameter(distance, mm(8));
      configuration.parameter(angle, deg(90));
      configuration.parameter(factor, scalar(3));
    });

    const source = cad.box("source", {
      size: [mm(2), mm(3), mm(4)],
    });
    const translated = cad.translate("translated", source, [
      distance,
      mm(0),
      mm(0),
    ]);
    const rotated = cad.rotate("rotated", translated, [
      deg(0),
      deg(0),
      angle,
    ]);
    const scaled = cad.scale("scaled", rotated, [
      factor,
      scalar(1),
      scalar(1),
    ]);
    const mirrored = cad.mirror("mirrored", scaled, [
      scalar(1),
      scalar(0),
      scalar(0),
    ]);
    const transformed = cad.transform("transformed", mirrored, [
      {
        kind: "translate",
        value: [mm(0).ir, mm(1).ir, mm(0).ir],
      },
      {
        kind: "rotate",
        value: [deg(10).ir, deg(0).ir, deg(0).ir],
      },
    ]);
    const resource = cad.resource("fixture", resourceCommitment());
    const imported = cad.importedBody("imported", resource, {
      format: "step",
      units: { mode: "from-file" },
    });
    const transformedImport = cad.translate(
      "transformed-import",
      imported,
      [mm(0), distance, mm(0)],
    );
    const bodies = cad.bodySet("bodies", [
      { id: "transformed", solid: transformed },
      { id: "transformed-import", solid: transformedImport },
      { id: "source", solid: source },
    ]);
    const part = cad.part("part", transformed);
    cad.output("bodies", bodies);
    cad.output("part", part);

    expect(source).toBeInstanceOf(StagedBodyLeafRefV7);
    expect(transformed).toBeInstanceOf(StagedSolidRefV7);
    expect(transformed).not.toBeInstanceOf(StagedBodyLeafRefV7);
    expect(Object.isFrozen(transformed)).toBe(true);
    expect(() => cad.output("direct", transformed as never)).toThrow(
      /only owned|output|reference/i,
    );

    const document = cad.build();
    expect(document.parameters[parameterId("angle")]).toEqual({
      dimension: "angle",
      default: deg(30).ir,
      min: deg(0).ir,
      max: deg(180).ir,
    });
    expect(
      document.configurations?.[configurationId("turned")]
        ?.parameterOverrides,
    ).toEqual({
      angle: deg(90).ir,
      distance: mm(8).ir,
      factor: scalar(3).ir,
    });
    expect(document.nodes).toMatchObject({
      translated: {
        kind: "transform",
        input: { node: "source", kind: "solid" },
        operations: [
          {
            kind: "translate",
            value: [
              {
                op: "parameter",
                dimension: "length",
                id: "distance",
              },
              mm(0).ir,
              mm(0).ir,
            ],
          },
        ],
      },
      rotated: {
        kind: "transform",
        input: { node: "translated", kind: "solid" },
        operations: [
          {
            kind: "rotate",
            value: [
              deg(0).ir,
              deg(0).ir,
              {
                op: "parameter",
                dimension: "angle",
                id: "angle",
              },
            ],
          },
        ],
      },
      scaled: {
        kind: "transform",
        input: { node: "rotated", kind: "solid" },
        operations: [
          {
            kind: "scale",
            value: [
              {
                op: "parameter",
                dimension: "scalar",
                id: "factor",
              },
              scalar(1).ir,
              scalar(1).ir,
            ],
          },
        ],
      },
      mirrored: {
        kind: "transform",
        input: { node: "scaled", kind: "solid" },
        operations: [
          {
            kind: "mirror",
            normal: [scalar(1).ir, scalar(0).ir, scalar(0).ir],
          },
        ],
      },
      transformed: {
        kind: "transform",
        input: { node: "mirrored", kind: "solid" },
        operations: [
          {
            kind: "translate",
            value: [mm(0).ir, mm(1).ir, mm(0).ir],
          },
          {
            kind: "rotate",
            value: [deg(10).ir, deg(0).ir, deg(0).ir],
          },
        ],
      },
      "transformed-import": {
        kind: "transform",
        input: { node: "imported", kind: "solid" },
        operations: [
          {
            kind: "translate",
            value: [
              mm(0).ir,
              {
                op: "parameter",
                dimension: "length",
                id: "distance",
              },
              mm(0).ir,
            ],
          },
        ],
      },
      bodies: {
        kind: "bodySet",
        bodies: [
          {
            id: "transformed",
            solid: { node: "transformed", kind: "solid" },
          },
          {
            id: "transformed-import",
            solid: { node: "transformed-import", kind: "solid" },
          },
          {
            id: "source",
            solid: { node: "source", kind: "solid" },
          },
        ],
      },
      part: {
        kind: "part",
        geometry: { node: "transformed", kind: "solid" },
      },
    });
    expect(document.outputs).toEqual({
      bodies: { node: "bodies", kind: "bodySet" },
      part: { node: "part", kind: "part" },
    });
    expectDeepFrozen(document);
  });

  it("hardens transform capture and rejects foreign or forged solid handles", () => {
    const first = stagedBodySetDesignV7("first-transform-owner");
    const second = stagedBodySetDesignV7("second-transform-owner");
    const firstBox = first.box("box", {
      size: [mm(1), mm(1), mm(1)],
    });
    const secondBox = second.box("box", {
      size: [mm(1), mm(1), mm(1)],
    });

    let foreignVectorInvoked = false;
    const foreignVector = [mm(1), mm(0), mm(0)];
    Object.defineProperty(foreignVector, "0", {
      configurable: true,
      enumerable: true,
      get() {
        foreignVectorInvoked = true;
        return mm(1);
      },
    });
    expect(() =>
      first.translate("foreign", secondBox, foreignVector as never),
    ).toThrow(/solid|design|owner|boundar/i);
    expect(foreignVectorInvoked).toBe(false);
    expect(() =>
      first.transform(
        "forged",
        new StagedSolidRefV7(first, firstBox.node),
        [
          {
            kind: "translate",
            value: [mm(1).ir, mm(0).ir, mm(0).ir],
          },
        ],
      ),
    ).toThrow(/solid|design|owner|boundar/i);
    expect(() => first.transform("empty", firstBox, [])).toThrow(
      /at least one|operation|empty/i,
    );

    const sparse = new Array(1) as {
      readonly kind: "translate";
      readonly value: readonly [
        ReturnType<typeof mm>["ir"],
        ReturnType<typeof mm>["ir"],
        ReturnType<typeof mm>["ir"],
      ];
    }[];
    expect(() => first.transform("sparse", firstBox, sparse)).toThrow(
      /dense|sparse|operation/i,
    );

    let operationAccessorInvoked = false;
    const accessorOperation = { kind: "translate" } as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessorOperation, "value", {
      enumerable: true,
      get() {
        operationAccessorInvoked = true;
        return [mm(1).ir, mm(0).ir, mm(0).ir];
      },
    });
    expect(() =>
      first.transform("accessor-operation", firstBox, [
        accessorOperation as never,
      ]),
    ).toThrow(/value.*own data|operation|accessor/i);
    expect(operationAccessorInvoked).toBe(false);

    let vectorAccessorInvoked = false;
    const accessorVector = [mm(1), mm(0), mm(0)];
    Object.defineProperty(accessorVector, "0", {
      configurable: true,
      enumerable: true,
      get() {
        vectorAccessorInvoked = true;
        return mm(1);
      },
    });
    expect(() =>
      first.translate(
        "accessor-vector",
        firstBox,
        accessorVector as never,
      ),
    ).toThrow(/own data|translation|vector/i);
    expect(vectorAccessorInvoked).toBe(false);

    const transformed = first.translate("owned", firstBox, [
      mm(1),
      mm(0),
      mm(0),
    ]);
    expect(() =>
      second.bodySet("foreign-transformed", [
        { id: "foreign", solid: transformed },
      ]),
    ).toThrow(/solid|design|owner|boundar/i);
    expect(first.build().nodes).not.toHaveProperty("foreign");
    expect(first.build().nodes).not.toHaveProperty("forged");
    expect(first.build().nodes).not.toHaveProperty("empty");
    expect(first.build().nodes).not.toHaveProperty("sparse");
    expect(first.build().nodes).not.toHaveProperty(
      "accessor-operation",
    );
    expect(first.build().nodes).not.toHaveProperty("accessor-vector");
  });

  it("rejects cross-builder handles in every owner-bound authoring position", () => {
    const first = stagedBodySetDesignV7("first");
    const second = stagedBodySetDesignV7("second");
    const firstResource = first.resource(
      "resource",
      resourceCommitment(),
    );
    const secondResource = second.resource(
      "resource",
      resourceCommitment(),
    );
    const firstBox = first.box("box", {
      size: [mm(1), mm(1), mm(1)],
    });
    const secondBox = second.box("box", {
      size: [mm(1), mm(1), mm(1)],
    });
    const secondSet = second.bodySet("bodies", [
      { id: "box", solid: secondBox },
    ]);
    const foreignParameter = second.parameter.length("width", mm(1));
    const firstImported = first.importedBody("imported", firstResource, {
      format: "step",
      units: { mode: "from-file" },
    });

    expect(() =>
      first.importedBody("foreign-resource", secondResource, {
        format: "step",
        units: { mode: "from-file" },
      }),
    ).toThrow(/resource|design|owner|boundar/i);
    expect(() =>
      first.bodySet("foreign-solid", [
        { id: "foreign", solid: secondBox },
      ]),
    ).toThrow(/solid|design|owner|boundar/i);
    expect(() => first.output("foreign-output", secondSet)).toThrow(
      /output|reference|design|owner|boundar/i,
    );
    expect(() =>
      first.configuration("foreign-configuration", (configuration) =>
        configuration.parameter(foreignParameter, mm(2)),
      ),
    ).toThrow(/parameter|design|owner|boundar/i);

    first.bodySet("owned", [{ id: "owned", solid: firstBox }]);
    first.output("imported", firstImported);
    expect(first.build().version).toBe(DOCUMENT_VERSION_V7);
  });

  it("does not dispatch through mutable handle prototypes", () => {
    const leafDescriptor = Object.getOwnPropertyDescriptor(
      StagedBodyLeafRefV7.prototype,
      "toIR",
    )!;
    const bodySetDescriptor = Object.getOwnPropertyDescriptor(
      StagedBodySetRefV7.prototype,
      "toIR",
    )!;
    try {
      Object.defineProperty(StagedBodyLeafRefV7.prototype, "toIR", {
        ...leafDescriptor,
        value: () => ({ node: "native", kind: "solid" }),
      });
      Object.defineProperty(StagedBodySetRefV7.prototype, "toIR", {
        ...bodySetDescriptor,
        value: () => ({ node: "native", kind: "solid" }),
      });

      const cad = stagedBodySetDesignV7("prototype-integrity");
      const resource = cad.resource("fixture", resourceCommitment());
      const native = cad.box("native", {
        size: [mm(1), mm(1), mm(1)],
      });
      const imported = cad.importedBody("imported", resource, {
        format: "step",
        units: { mode: "from-file" },
      });
      const bodies = cad.bodySet("bodies", [
        { id: "imported", solid: imported },
      ]);
      cad.output("imported", imported);
      cad.output("bodies", bodies);

      const document = cad.build();
      expect(document.outputs).toEqual({
        imported: { node: "imported", kind: "solid" },
        bodies: { node: "bodies", kind: "bodySet" },
      });
      const authoredBodySet = Object.values(document.nodes).find(
        (node) => node.kind === "bodySet",
      );
      expect(authoredBodySet).toMatchObject({
        kind: "bodySet",
        bodies: [
          {
            id: "imported",
            solid: { node: "imported", kind: "solid" },
          },
        ],
      });
      expect(Object.values(document.outputs)).not.toContainEqual({
        node: native.node,
        kind: "solid",
      });
    } finally {
      Object.defineProperty(
        StagedBodyLeafRefV7.prototype,
        "toIR",
        leafDescriptor,
      );
      Object.defineProperty(
        StagedBodySetRefV7.prototype,
        "toIR",
        bodySetDescriptor,
      );
    }
  });

  it("rejects unsupported and accessor-backed semantic fields", () => {
    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("resource-extra");
      cad.resource("fixture", {
        ...resourceCommitment(),
        bytes: new Uint8Array(),
      } as never);
    }, /resource.*unsupported|unsupported.*bytes/i);

    let digestAccessorInvoked = false;
    const accessorCommitment = {
      byteLength: 0,
      mediaType: "application/octet-stream",
    } as Record<string, unknown>;
    Object.defineProperty(accessorCommitment, "digest", {
      enumerable: true,
      get() {
        digestAccessorInvoked = true;
        return ZERO_DIGEST;
      },
    });
    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("resource-accessor");
      cad.resource("fixture", accessorCommitment as never);
    }, /digest.*own data/i);
    expect(digestAccessorInvoked).toBe(false);

    const cad = stagedBodySetDesignV7("unsupported-semantics");
    const resource = cad.resource("fixture", resourceCommitment());
    const box = cad.box("box", {
      size: [mm(1), mm(1), mm(1)],
    });
    expect(() =>
      cad.importedBody("healing", resource, {
        format: "step",
        units: { mode: "from-file" },
        healing: { mode: "reader-default" },
      } as never),
    ).toThrow(/imported-body.*unsupported|unsupported.*healing/i);
    expect(() =>
      cad.importedBody("compound", resource, {
        format: "step",
        units: { mode: "from-file" },
        expected: "compound",
      } as never),
    ).toThrow(/imported-body.*unsupported|unsupported.*expected/i);
    expect(() =>
      cad.importedBody("step-length", resource, {
        format: "step",
        units: { mode: "from-file", length: "mm" },
      } as never),
    ).toThrow(/units.*unsupported|unsupported.*length/i);
    expect(() =>
      cad.bodySet("inactive", [
        { id: "box", solid: box, active: false } as never,
      ]),
    ).toThrow(/member.*unsupported|unsupported.*active/i);
    expect(() =>
      cad.bodySet("primary", [
        { id: "box", solid: box, primary: true } as never,
      ]),
    ).toThrow(/member.*unsupported|unsupported.*primary/i);
  });

  it("rejects duplicate definitions, outputs, configurations, and member IDs", () => {
    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("duplicate-parameter");
      cad.parameter.length("width", mm(1));
      cad.parameter.length("width", mm(2));
    }, /duplicate.*parameter|parameter.*duplicate/i);

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("duplicate-configuration");
      const width = cad.parameter.length("width", mm(1));
      cad.configuration("wide", (configuration) =>
        configuration.parameter(width, mm(2)),
      );
      cad.configuration("wide", (configuration) =>
        configuration.parameter(width, mm(3)),
      );
    }, /duplicate.*configuration|configuration.*duplicate/i);

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("duplicate-resource");
      cad.resource("fixture", resourceCommitment());
      cad.resource("fixture", resourceCommitment());
    }, /duplicate.*resource|resource.*duplicate/i);

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("duplicate-node");
      cad.box("shared", { size: [mm(1), mm(1), mm(1)] });
      cad.sphere("shared", { radius: mm(1) });
    }, /duplicate.*feature|feature.*duplicate|duplicate.*node/i);

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("duplicate-output");
      const box = cad.box("box", { size: [mm(1), mm(1), mm(1)] });
      const first = cad.bodySet("first", [{ id: "box", solid: box }]);
      const second = cad.bodySet("second", [{ id: "box", solid: box }]);
      cad.output("result", first);
      cad.output("result", second);
    }, /duplicate.*output|output.*duplicate/i);

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("duplicate-member");
      const box = cad.box("box", { size: [mm(1), mm(1), mm(1)] });
      cad.bodySet("bodies", [
        { id: "same", solid: box },
        { id: "same", solid: box },
      ]);
    }, /duplicate.*member|member.*duplicate|duplicated/i);
  });

  it("rejects empty, sparse, and non-array body memberships", () => {
    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("empty");
      cad.bodySet("bodies", []);
    }, /at least one|non-empty|empty/i);

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("sparse");
      const members = new Array(1) as {
        id: string;
        solid: StagedBodyLeafRefV7;
      }[];
      cad.bodySet("bodies", members);
    }, /dense|sparse|member/i);

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("not-an-array");
      cad.bodySet("bodies", {} as never);
    }, /array|member/i);
  });

  it("rejects malformed resource commitments and location collections", () => {
    const invalidCommitments: readonly {
      readonly label: string;
      readonly commitment: Readonly<Record<string, unknown>>;
      readonly pattern: RegExp;
    }[] = [
      {
        label: "digest",
        commitment: resourceCommitment({ digest: "sha256:ABC" }),
        pattern: /digest|sha-?256/i,
      },
      {
        label: "negative byte length",
        commitment: resourceCommitment({ byteLength: -1 }),
        pattern: /byte.*length|nonnegative/i,
      },
      {
        label: "unsafe byte length",
        commitment: resourceCommitment({
          byteLength: Number.MAX_SAFE_INTEGER + 1,
        }),
        pattern: /byte.*length|safe/i,
      },
      {
        label: "media type",
        commitment: resourceCommitment({ mediaType: "step" }),
        pattern: /media.*type|mime/i,
      },
      {
        label: "empty locations",
        commitment: resourceCommitment({ locations: [] }),
        pattern: /location|non-empty|at least one/i,
      },
      {
        label: "duplicate locations",
        commitment: resourceCommitment({
          locations: ["project://same", "project://same"],
        }),
        pattern: /location|duplicate/i,
      },
      {
        label: "empty location",
        commitment: resourceCommitment({ locations: [""] }),
        pattern: /location|empty/i,
      },
      {
        label: "non-json metadata",
        commitment: {
          ...resourceCommitment(),
          metadata: { invalid: undefined },
        },
        pattern: /metadata|json|undefined/i,
      },
    ];

    for (const { label, commitment, pattern } of invalidCommitments) {
      expect(
        () => {
          const cad = stagedBodySetDesignV7(`invalid-${label}`);
          cad.resource("fixture", commitment as never);
          cad.build();
        },
        label,
      ).toThrow(pattern);
    }

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("sparse-locations");
      const locations = new Array(1) as string[];
      cad.resource("fixture", resourceCommitment({ locations }));
      cad.build();
    }, /location|dense|sparse/i);

    expectAuthoringFailure(() => {
      const cad = stagedBodySetDesignV7("empty-member-name");
      const box = cad.box("box", { size: [mm(1), mm(1), mm(1)] });
      cad.bodySet("bodies", [{ id: "box", solid: box, name: "" }]);
    }, /member.*name|name.*empty/i);
  });

  it("accepts only STEP file units and declared BREP length units", () => {
    const invalidImports = [
      {
        id: "step-declared",
        options: {
          format: "step",
          units: { mode: "declared", length: "mm" },
        },
      },
      {
        id: "brep-file",
        options: {
          format: "brep",
          units: { mode: "from-file" },
        },
      },
      {
        id: "binary-brep-file",
        options: {
          format: "brep-binary",
          units: { mode: "from-file" },
        },
      },
      {
        id: "unsupported-format",
        options: {
          format: "obj",
          units: { mode: "declared", length: "mm" },
        },
      },
      {
        id: "unsupported-unit",
        options: {
          format: "brep",
          units: { mode: "declared", length: "ft" },
        },
      },
    ] as const;

    for (const { id, options } of invalidImports) {
      expectAuthoringFailure(() => {
        const cad = stagedBodySetDesignV7(id);
        const resource = cad.resource("fixture", resourceCommitment());
        const imported = cad.importedBody(id, resource, options as never);
        cad.output("result", imported);
        cad.build();
      }, /format|step|brep|unit|import/i);
    }

    const cad = stagedBodySetDesignV7("valid-brep-units");
    const resource = cad.resource("fixture", resourceCommitment());
    const text = cad.importedBody("text", resource, {
      format: "brep",
      units: { mode: "declared", length: "cm" },
    });
    const binary = cad.importedBody("binary", resource, {
      format: "brep-binary",
      units: { mode: "declared", length: "in" },
    });
    cad.output("text", text);
    cad.output("binary", binary);
    expect(cad.build().nodes).toMatchObject({
      text: {
        format: "brep",
        units: { mode: "declared", length: "cm" },
        healing: { mode: "none" },
        expected: "single-solid",
      },
      binary: {
        format: "brep-binary",
        units: { mode: "declared", length: "in" },
        healing: { mode: "none" },
        expected: "single-solid",
      },
    });
  });

  it("enforces default resource ceilings during authoring and custom limits at build", () => {
    const cad = stagedBodySetDesignV7("default-location-limit");
    const locations = Array.from(
      {
        length: DEFAULT_DESIGN_DOCUMENT_LIMITS.maxResourceLocations + 1,
      },
      (_, index) => `project://locations/${index}`,
    );
    expect(() =>
      cad.resource("too-many-locations", {
        ...resourceCommitment(),
        locations,
      }),
    ).toThrow(/maxResourceLocations|location.*limit|too many.*location/i);

    const custom = stagedBodySetDesignV7("custom-resource-limit");
    custom.resource("fixture", resourceCommitment());
    expect(() =>
      custom.build({ limits: { maxResourceDefinitions: 0 } }),
    ).toThrow(/maxResourceDefinitions|resource.*limit/i);
  });

  it("keeps the package-root builder, aliases, and schemas on v6", () => {
    const cad = publicApi.design("public-v6");
    const box = cad.box("box", { size: [mm(1), mm(2), mm(3)] });
    cad.output("box", box);
    const document: publicApi.DesignDocument = cad.build();

    expect(publicApi.DOCUMENT_VERSION).toBe(6);
    expect(publicApi.DOCUMENT_SCHEMA).toBe(publicApi.DOCUMENT_SCHEMA_V6);
    expect(document.version).toBe(6);
    expect(publicApi.DesignDocumentSchema.safeParse(document).success).toBe(
      true,
    );
    expect("DOCUMENT_VERSION_V7" in publicApi).toBe(false);
    expect("DesignDocumentV7Schema" in publicApi).toBe(false);
    expect("stagedBodySetDesignV7" in publicApi).toBe(false);
    expect("evaluateBodySetOutputsV7" in publicApi).toBe(false);
    expect("evaluateImportedBodyOutputsV7" in publicApi).toBe(false);
  });
});

describe("authored staged document-v7 native evaluation", () => {
  it("evaluates named parameters and shared memberships with Manifold", async () => {
    const cad = stagedBodySetDesignV7("manifold-authored");
    const width = cad.parameter.length("width", mm(2));
    cad.configuration("wide", (configuration) =>
      configuration.parameter(width, mm(5)),
    );
    const box = cad.box("box", {
      size: [width, mm(3), mm(4)],
    });
    const translated = cad.translate("translated", box, [
      width,
      mm(0),
      mm(0),
    ]);
    const rotated = cad.rotate("rotated", translated, [
      deg(0),
      deg(0),
      deg(90),
    ]);
    const scaled = cad.scale("scaled", rotated, [
      scalar(2),
      scalar(1),
      scalar(1),
    ]);
    const transformed = cad.mirror("transformed", scaled, [
      scalar(1),
      scalar(0),
      scalar(0),
    ]);
    const cylinder = cad.cylinder("cylinder", {
      height: mm(5),
      radius: mm(2),
      segments: 32,
    });
    const bodies = cad.bodySet("bodies", [
      { id: "box", solid: box, name: "Configured box" },
      { id: "box-alias", solid: box },
      { id: "transformed", solid: transformed },
      { id: "cylinder", solid: cylinder },
    ]);
    cad.output("bodies", bodies);
    const document = cad.build();

    const kernel = await createManifoldKernel();
    try {
      const base = await evaluateBodySetOutputsV7(kernel, document);
      expect(base.ok).toBe(true);
      if (!base.ok) return;
      const retained = base.value.output("bodies").body("box").solid;
      try {
        const output = base.value.output("bodies");
        expect(base.value.configurationId).toBeNull();
        expect(base.value.parameters).toEqual({ width: 2 });
        expect(output.bodyIds).toEqual([
          "box",
          "box-alias",
          "transformed",
          "cylinder",
        ]);
        expect(output.body("box").solid.measure().volume).toBeCloseTo(24, 8);
        expect(output.body("box-alias").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(
          output.body("transformed").solid.measure().volume,
        ).toBeCloseTo(48, 8);
        expect(output.body("cylinder").solid.measure().volume).toBeCloseTo(
          Math.PI * 20,
          0,
        );
        expect(output.representation).toBe("mesh");
        expect(output.exact).toBe(false);
        expect(output.mesh().indices.length).toBeGreaterThan(30);
        expect(output.export("stl")).toBeInstanceOf(Uint8Array);
        expect(output.export("obj")).toContain("o bodies");
      } finally {
        base.value.dispose();
      }
      expect(() => retained.measure()).toThrow(/disposed/i);

      const configured = await evaluateBodySetOutputsV7(kernel, document, {
        configuration: "wide",
      });
      expect(configured.ok).toBe(true);
      if (!configured.ok) return;
      try {
        expect(configured.value.configurationId).toBe("wide");
        expect(configured.value.parameters).toEqual({ width: 5 });
        expect(
          configured.value.output("bodies").body("box").solid.measure().volume,
        ).toBeCloseTo(60, 8);
        expect(
          configured.value
            .output("bodies")
            .body("transformed")
            .solid.measure().volume,
        ).toBeCloseTo(120, 8);
      } finally {
        configured.value.dispose();
      }
    } finally {
      kernel.dispose();
    }
  }, 30_000);
});

describe("authored staged document-v7 exact import evaluation", () => {
  let step = new Uint8Array();

  beforeAll(async () => {
    const raw = await RawOcctKernel.init();
    let shape: ShapeHandle | undefined;
    try {
      shape = raw.makeBox(2, 3, 4);
      step = encoder.encode(raw.exportStep(shape));
    } finally {
      if (shape !== undefined) raw.release(shape);
      raw[Symbol.dispose]();
    }
  }, 30_000);

  afterAll(() => {
    step = new Uint8Array();
  });

  it("resolves an authored direct import and mixed body set through stock OCCT", async () => {
    const cad = stagedBodySetDesignV7("occt-authored");
    const commitment = {
      digest: await digest(step),
      byteLength: step.byteLength,
      mediaType: "model/step",
      locations: ["project://fixtures/box.step"],
      metadata: { provenance: "generated-test-fixture" },
    };
    const resource = cad.resource("fixture", commitment);
    const imported = cad.importedBody("imported", resource, {
      format: "step",
      units: { mode: "from-file" },
    });
    const native = cad.box("native", {
      size: [mm(2), mm(3), mm(4)],
    });
    const transformedImported = cad.translate(
      "transformed-imported",
      imported,
      [mm(10), mm(0), mm(0)],
    );
    const transformedNative = cad.scale("transformed-native", native, [
      scalar(2),
      scalar(1),
      scalar(1),
    ]);
    const bodies = cad.bodySet("bodies", [
      { id: "imported", solid: imported, name: "Imported STEP" },
      { id: "transformed-imported", solid: transformedImported },
      { id: "native", solid: native, name: "Native box" },
      { id: "native-alias", solid: native },
      { id: "transformed-native", solid: transformedNative },
    ]);
    cad.output("imported-output", imported);
    cad.output("body-set-output", bodies);
    const document = cad.build();

    const requests: ResourceResolverRequestV7[] = [];
    const resolver = (request: ResourceResolverRequestV7): Uint8Array => {
      requests.push(request);
      if (request.id !== "fixture") throw new Error("Unexpected resource");
      return step;
    };
    const kernel = await createOcctKernel();
    const liveShapes = (
      kernel as GeometryKernel & {
        readonly liveShapes: ReadonlySet<unknown>;
      }
    ).liveShapes;
    const liveBefore = liveShapes.size;
    try {
      const direct = await evaluateImportedBodyOutputsV7(kernel, document, {
        outputs: ["imported-output"],
        resolver,
      });
      expect(direct.ok).toBe(true);
      if (!direct.ok) return;
      const directSolid = direct.value.output("imported-output");
      expect(directSolid).toBeInstanceOf(EvaluatedSolid);
      if (!(directSolid instanceof EvaluatedSolid)) return;
      try {
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          id: "fixture",
          digest: commitment.digest,
          byteLength: commitment.byteLength,
          mediaType: commitment.mediaType,
          locations: commitment.locations,
        });
        expect(directSolid.measure().volume).toBeCloseTo(24, 8);
        expect(directSolid.export("step").byteLength).toBeGreaterThan(100);
        const topology = directSolid.topology();
        expect(topology).toMatchObject({
          ok: true,
          value: { history: "partial" },
        });
        if (topology.ok) {
          expect(topology.value.faces).toHaveLength(6);
          expect(topology.value.edges).toHaveLength(12);
          expect(topology.value.vertices).toHaveLength(8);
        }
      } finally {
        direct.value.dispose();
      }
      expect(() => directSolid.measure()).toThrow(/disposed/i);
      expect(liveShapes.size).toBe(liveBefore);

      const bodySet = await evaluateBodySetOutputsV7(kernel, document, {
        outputs: ["body-set-output"],
        resolver,
      });
      expect(bodySet.ok).toBe(true);
      if (!bodySet.ok) return;
      const output = bodySet.value.output("body-set-output");
      const retained = output.body("native").solid;
      try {
        expect(requests).toHaveLength(2);
        expect(output.bodyIds).toEqual([
          "imported",
          "transformed-imported",
          "native",
          "native-alias",
          "transformed-native",
        ]);
        expect(output.representation).toBe("brep");
        expect(output.exact).toBe(true);
        expect(output.body("imported").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(
          output.body("transformed-imported").solid.measure().volume,
        ).toBeCloseTo(24, 8);
        expect(output.body("native").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(output.body("native-alias").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(
          output.body("transformed-native").solid.measure().volume,
        ).toBeCloseTo(48, 8);
        expect(
          output.body("transformed-imported").solid.topology(),
        ).toMatchObject({
          ok: true,
          value: { history: "partial" },
        });
        const transformedTopology = output
          .body("transformed-native")
          .solid.topology();
        expect(transformedTopology).toMatchObject({
          ok: true,
          value: { history: "complete" },
        });
        if (transformedTopology.ok) {
          expect(transformedTopology.value.faces).toHaveLength(6);
          expect(
            transformedTopology.value.faces.every((face) =>
              face.lineage.some(
                (entry) =>
                  entry.feature === "transformed-native" &&
                  entry.relation === "modified",
              ),
            ),
          ).toBe(true);
        }
        expect(
          output.body("native").solid.export("step").byteLength,
        ).toBeGreaterThan(100);
        expect(output.mesh().indices.length).toBeGreaterThan(30);
        expect(output.export("stl")).toBeInstanceOf(Uint8Array);
      } finally {
        bodySet.value.dispose();
      }
      expect(() => retained.measure()).toThrow(/disposed/i);
      expect(liveShapes.size).toBe(liveBefore);
    } finally {
      kernel.dispose();
    }
  }, 30_000);
});
