import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OcctKernel as RawOcctKernel,
  type ShapeHandle,
} from "occt-wasm";
import * as publicApi from "../src/index.js";
import {
  IMPORTED_BODY_MEDIA_TYPES,
  IMPORTED_BODY_WORKFLOW_PROTOCOL_VERSION,
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  createEvaluator,
  createImportedBodyDocument,
  parseImportedBodyDocument,
  stringifyImportedBodyDocument,
  type CadResult,
  type EvaluateImportedBodyOptions,
  type EvaluatedImportedBody,
  type GeometryKernel,
  type ImportedBodyDefinition,
  type ImportedBodyDocument,
  type ImportedBodyResolverRequest,
  type KernelShape,
  type ShapeMeasurements,
} from "../src/index.js";

const encoder = new TextEncoder();

const measurement: ShapeMeasurements = {
  volume: 24,
  surfaceArea: 52,
  boundingBox: { min: [0, 0, 0], max: [2, 3, 4] },
  centerOfMass: [1, 1.5, 2],
  inertiaTensor: [
    [50, 0, 0],
    [0, 40, 0],
    [0, 0, 26],
  ],
  genus: 0,
  tolerance: 1e-7,
};

async function sha256(
  bytes: Uint8Array,
): Promise<`sha256:${string}`> {
  const copied = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copied);
  const hexadecimal = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hexadecimal}`;
}

function valueOf<T>(result: CadResult<T>): T {
  expect(
    result.ok,
    JSON.stringify(result.diagnostics),
  ).toBe(true);
  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message ?? "Operation failed");
  }
  return result.value;
}

function expectFailure(
  result: CadResult<unknown>,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`Expected diagnostic '${code}'`);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code })]),
  );
}

function expectPublicDiagnostics(
  result: CadResult<unknown>,
): void {
  const serialized = JSON.stringify(result.diagnostics);
  expect(serialized).not.toMatch(/v7/i);
  expect(serialized).not.toMatch(/staged/i);
}

async function stepDefinition(
  bytes: Uint8Array,
  options: {
    readonly bodyId?: string;
    readonly resourceId?: string;
    readonly locations?: readonly string[];
  } = {},
): Promise<
  Extract<ImportedBodyDefinition, { readonly format: "step" }>
> {
  return {
    id: options.bodyId ?? "importedBody",
    resource: {
      id: options.resourceId ?? "sourceStep",
      digest: await sha256(bytes),
      byteLength: bytes.byteLength,
      mediaType: "model/step",
      ...(options.locations === undefined
        ? {}
        : { locations: options.locations }),
    },
    format: "step",
    units: { mode: "from-file" },
  };
}

function exactImportKernel(
  overrides: Partial<GeometryKernel> = {},
): GeometryKernel {
  const shape: KernelShape = { kernel: "public-import-test" };
  return {
    id: "public-import-test",
    capabilities: {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: [],
      documentBodyImport: {
        protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
        formats: [
          { format: "step", unitModes: ["from-file"] },
          { format: "brep", unitModes: ["declared"] },
          { format: "brep-binary", unitModes: ["declared"] },
        ],
      },
    },
    importDocumentBody: () => shape,
    mesh: () => ({
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    }),
    measure: () => measurement,
    status: () => ({ ok: true, code: "VALID" }),
    disposeShape: () => undefined,
    dispose: () => undefined,
    ...overrides,
  };
}

describe("public imported-body document workflow", () => {
  it("creates, serializes, and parses the one-body canonical subset", async () => {
    const bytes = encoder.encode("canonical-step-fixture");
    const definition = await stepDefinition(bytes, {
      bodyId: "housing",
      resourceId: "housingStep",
      locations: ["memory:housing.step"],
    });
    const document = valueOf(
      createImportedBodyDocument("Imported housing", definition),
    );

    expect(IMPORTED_BODY_WORKFLOW_PROTOCOL_VERSION).toBe(1);
    expect(IMPORTED_BODY_MEDIA_TYPES).toEqual({
      step: "model/step",
      brep: "text/plain",
      "brep-binary": "application/octet-stream",
    });
    expect(Object.isFrozen(IMPORTED_BODY_MEDIA_TYPES)).toBe(true);
    expect(document).toMatchObject({
      protocolVersion: 1,
      name: "Imported housing",
      provenance: {
        ...definition,
        healing: { mode: "none" },
        expected: "single-solid",
      },
    });
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.getOwnPropertySymbols(document)).toEqual([]);
    expect(Object.isFrozen(document.provenance)).toBe(true);
    expect(Object.isFrozen(document.provenance.resource)).toBe(true);
    expect(
      Object.isFrozen(document.provenance.resource.locations!),
    ).toBe(true);

    const text = stringifyImportedBodyDocument(document);
    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(raw).toEqual({
      schema: "https://invariantcad.dev/schema/document/v7",
      version: 7,
      name: "Imported housing",
      units: { length: "mm", angle: "rad" },
      parameters: {},
      resources: {
        housingStep: {
          digest: definition.resource.digest,
          byteLength: bytes.byteLength,
          mediaType: "model/step",
          locations: ["memory:housing.step"],
        },
      },
      nodes: {
        housing: {
          kind: "importedBody",
          resource: "housingStep",
          format: "step",
          units: { mode: "from-file" },
          healing: { mode: "none" },
          expected: "single-solid",
        },
      },
      outputs: {
        housing: { node: "housing", kind: "solid" },
      },
    });

    const parsed = valueOf(parseImportedBodyDocument(text));
    expect(parsed).toEqual(document);
    expect(parsed).not.toBe(document);
    expect(parsed.provenance).not.toBe(document.provenance);
    expect(stringifyImportedBodyDocument(parsed)).toBe(text);

    const reordered = valueOf(
      createImportedBodyDocument("Imported housing", {
        units: { mode: "from-file" },
        format: "step",
        resource: {
          locations: ["memory:housing.step"],
          mediaType: "model/step",
          byteLength: bytes.byteLength,
          digest: definition.resource.digest,
          id: "housingStep",
        },
        id: "housing",
      }),
    );
    expect(stringifyImportedBodyDocument(reordered)).toBe(text);

    const typedDocument: ImportedBodyDocument = parsed;
    const typedDefinition: ImportedBodyDefinition = definition;
    expect(typedDocument.provenance.id).toBe(typedDefinition.id);
  });

  it("rejects noncanonical product documents, unit policies, and media mismatches", async () => {
    const bytes = encoder.encode("strict-subset");
    const definition = await stepDefinition(bytes);
    const document = valueOf(
      createImportedBodyDocument("Strict imported body", definition),
    );
    const raw = JSON.parse(
      stringifyImportedBodyDocument(document),
    ) as {
      metadata?: unknown;
      resources: Record<string, { mediaType: string }>;
    };

    raw.metadata = { broaderDocumentSurface: true };
    expectFailure(
      parseImportedBodyDocument(JSON.stringify(raw)),
      "IR_INVALID",
    );
    delete raw.metadata;

    raw.resources.sourceStep!.mediaType = "text/plain";
    expectFailure(
      parseImportedBodyDocument(JSON.stringify(raw)),
      "IR_INVALID",
    );

    expectFailure(
      createImportedBodyDocument("Wrong STEP media type", {
        ...definition,
        resource: { ...definition.resource, mediaType: "text/plain" },
      } as unknown as ImportedBodyDefinition),
      "IMPORT_SOURCE_INVALID",
    );
    expectFailure(
      createImportedBodyDocument("Wrong STEP units", {
        ...definition,
        units: { mode: "declared", length: "mm" },
      } as unknown as ImportedBodyDefinition),
      "IMPORT_SOURCE_INVALID",
    );
    expectFailure(
      createImportedBodyDocument("Wrong BREP units", {
        ...definition,
        format: "brep",
        resource: { ...definition.resource, mediaType: "text/plain" },
        units: { mode: "from-file" },
      } as unknown as ImportedBodyDefinition),
      "IMPORT_SOURCE_INVALID",
    );

    const invalidText = parseImportedBodyDocument(
      3 as unknown as string,
    );
    expectFailure(invalidText, "IR_INVALID");
    expectPublicDiagnostics(invalidText);

    let serializationError: unknown;
    try {
      stringifyImportedBodyDocument(document, {
        limits: { maxDocumentBytes: -1 },
      });
    } catch (error) {
      serializationError = error;
    }
    expect(serializationError).toBeInstanceOf(TypeError);
    expect(String(serializationError)).not.toMatch(/v7|staged/i);
  });

  it("captures hostile source records without invoking accessors or array gets", async () => {
    const bytes = encoder.encode("hostile-source-capture");
    const definition = await stepDefinition(bytes);
    const locationGets = vi.fn();
    const locations = new Proxy(["memory:hostile.step"], {
      get(target, property, receiver) {
        locationGets(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const captured = createImportedBodyDocument("Captured locations", {
      ...definition,
      resource: { ...definition.resource, locations },
    });
    expect(captured.ok).toBe(true);
    expect(locationGets).not.toHaveBeenCalled();

    const formatGetter = vi.fn(() => "step");
    const accessorDefinition: Record<string, unknown> = {
      id: definition.id,
      resource: definition.resource,
      units: definition.units,
    };
    Object.defineProperty(accessorDefinition, "format", {
      enumerable: true,
      get: formatGetter,
    });
    expectFailure(
      createImportedBodyDocument(
        "Accessor definition",
        accessorDefinition as unknown as ImportedBodyDefinition,
      ),
      "IMPORT_SOURCE_INVALID",
    );
    expect(formatGetter).not.toHaveBeenCalled();

    const revoked = Proxy.revocable({ ...definition }, {});
    revoked.revoke();
    expectFailure(
      createImportedBodyDocument(
        "Revoked definition",
        revoked.proxy as ImportedBodyDefinition,
      ),
      "IMPORT_SOURCE_INVALID",
    );

    const resolverGetter = vi.fn(() => () => bytes);
    const options: Record<string, unknown> = {};
    Object.defineProperty(options, "resolver", {
      enumerable: true,
      get: resolverGetter,
    });
    const document = valueOf(
      createImportedBodyDocument("Hostile options", definition),
    );
    const nativeImport = vi.fn((): KernelShape => ({
      kernel: "hostile-options-must-not-import",
    }));
    const evaluator = await createEvaluator({
      kernel: exactImportKernel({ importDocumentBody: nativeImport }),
    });
    try {
      const result = await evaluator.evaluateImportedBody(
        document,
        options as EvaluateImportedBodyOptions,
      );
      expectFailure(result, "IR_INVALID");
      expect(resolverGetter).not.toHaveBeenCalled();
      expect(nativeImport).not.toHaveBeenCalled();
    } finally {
      evaluator.dispose();
    }
  });

  it("reports missing and corrupt resources without entering native import", async () => {
    const bytes = encoder.encode("verified-resource");
    const document = valueOf(
      createImportedBodyDocument(
        "Verified imported body",
        await stepDefinition(bytes),
      ),
    );
    const nativeImport = vi.fn((): KernelShape => ({
      kernel: "must-not-import",
    }));
    const kernel = exactImportKernel({
      importDocumentBody: nativeImport,
    });
    const evaluator = await createEvaluator({ kernel });
    try {
      expectFailure(
        await evaluator.evaluateImportedBody(document),
        "RESOURCE_RESOLVER_MISSING",
      );
      expect(nativeImport).not.toHaveBeenCalled();

      const corruptResolver = vi.fn(() =>
        encoder.encode("corrupt-resource"),
      );
      expectFailure(
        await evaluator.evaluateImportedBody(document, {
          resolver: corruptResolver,
        }),
        "RESOURCE_INTEGRITY_MISMATCH",
      );
      expect(corruptResolver).toHaveBeenCalledOnce();
      expect(nativeImport).not.toHaveBeenCalled();

      const limitedResolver = vi.fn(() => bytes);
      expectFailure(
        await evaluator.evaluateImportedBody(document, {
          resolver: limitedResolver,
          resourceLimits: {
            maxResourceBytes: bytes.byteLength - 1,
          },
        }),
        "RESOURCE_LIMIT_EXCEEDED",
      );
      expect(limitedResolver).not.toHaveBeenCalled();
      expect(nativeImport).not.toHaveBeenCalled();
    } finally {
      evaluator.dispose();
    }
  });

  it("preflights the strong exact capability before invoking the resolver", async () => {
    const bytes = encoder.encode("capability-first");
    const document = valueOf(
      createImportedBodyDocument(
        "Capability preflight",
        await stepDefinition(bytes),
      ),
    );
    const resolver = vi.fn(() => bytes);
    const weakImport = vi.fn((): KernelShape => ({
      kernel: "weak-import-must-not-run",
    }));
    const kernel: GeometryKernel = {
      id: "weak-public-import-test",
      capabilities: {
        protocolVersion: 1,
        representation: "brep",
        exact: true,
        primitives: [],
        features: [],
        nativeImports: ["step"],
        nativeExports: [],
      },
      importShape: weakImport,
      mesh: () => ({
        positions: new Float32Array(),
        indices: new Uint32Array(),
      }),
      measure: () => measurement,
      status: () => ({ ok: true, code: "VALID" }),
      disposeShape: () => undefined,
      dispose: () => undefined,
    };
    const evaluator = await createEvaluator({ kernel });
    try {
      const result = await evaluator.evaluateImportedBody(document, {
        resolver,
      });
      expectFailure(result, "KERNEL_CAPABILITY_MISSING");
      expectPublicDiagnostics(result);
      expect(resolver).not.toHaveBeenCalled();
      expect(weakImport).not.toHaveBeenCalled();
    } finally {
      evaluator.dispose();
    }
  });

  it("honors cancellation before resource resolution or native import", async () => {
    const bytes = encoder.encode("cancelled-import");
    const document = valueOf(
      createImportedBodyDocument(
        "Cancelled import",
        await stepDefinition(bytes),
      ),
    );
    const resolver = vi.fn(() => bytes);
    const nativeImport = vi.fn((): KernelShape => ({
      kernel: "cancelled-import-must-not-run",
    }));
    const evaluator = await createEvaluator({
      kernel: exactImportKernel({ importDocumentBody: nativeImport }),
    });
    const controller = new AbortController();
    controller.abort();
    try {
      expectFailure(
        await evaluator.evaluateImportedBody(document, {
          resolver,
          signal: controller.signal,
        }),
        "EVALUATION_ABORTED",
      );
      expect(resolver).not.toHaveBeenCalled();
      expect(nativeImport).not.toHaveBeenCalled();
    } finally {
      evaluator.dispose();
    }
  });

  it("keeps user IDs, locations, and kernel IDs that contain v7 or staged verbatim", async () => {
    const bytes = encoder.encode("user-authored-v7-names");
    const quotedValues = (message: string): string[] =>
      [...message.matchAll(/'([^']*)'/gu)].map((match) => match[1]!);
    /** Wording outside the quoted user values stays public. */
    const expectPublicWording = (result: CadResult<unknown>): void => {
      for (const item of result.diagnostics) {
        let wording = item.message;
        for (const value of quotedValues(item.message)) {
          wording = wording.replaceAll(`'${value}'`, "''");
        }
        expect(wording).not.toMatch(/v7|staged/i);
      }
    };

    const duplicate = createImportedBodyDocument(
      "Versioned bracket",
      await stepDefinition(bytes, {
        bodyId: "bracket_v7",
        resourceId: "bracket_v7_step",
        locations: ["parts/bracket_v7.step", "parts/bracket_v7.step"],
      }),
    );
    expectFailure(duplicate, "IMPORT_SOURCE_INVALID");
    expect(duplicate.diagnostics[0]?.message).toBe(
      "Resource location 'parts/bracket_v7.step' is duplicated",
    );
    expectPublicWording(duplicate);

    const invalidId = createImportedBodyDocument(
      "Staged body",
      await stepDefinition(bytes, { bodyId: "staged V7 body" }),
    );
    expectFailure(invalidId, "IMPORT_SOURCE_INVALID");
    expect(quotedValues(invalidId.diagnostics[0]!.message)).toContain(
      "staged V7 body",
    );
    expectPublicWording(invalidId);

    const document = valueOf(
      createImportedBodyDocument(
        "Versioned bracket",
        await stepDefinition(bytes, {
          bodyId: "housingV7",
          resourceId: "v7Mount",
        }),
      ),
    );
    const evaluator = await createEvaluator({
      kernel: exactImportKernel({ id: "occtV7-custom" }),
    });
    try {
      const corrupt = await evaluator.evaluateImportedBody(document, {
        resolver: () => new Uint8Array(bytes.byteLength),
      });
      expectFailure(corrupt, "RESOURCE_INTEGRITY_MISMATCH");
      expect(corrupt.diagnostics[0]?.message).toBe(
        "Resource 'v7Mount' digest does not match its commitment",
      );
      expectPublicWording(corrupt);
    } finally {
      evaluator.dispose();
    }

    const { documentBodyImport: _strongImport, ...weakCapabilities } =
      exactImportKernel().capabilities;
    const missingCapability = await createEvaluator({
      kernel: exactImportKernel({
        id: "occtV7-custom",
        capabilities: weakCapabilities,
      }),
    });
    try {
      const result = await missingCapability.evaluateImportedBody(document, {
        resolver: () => bytes,
      });
      expectFailure(result, "KERNEL_CAPABILITY_MISSING");
      expect(quotedValues(result.diagnostics[0]!.message)).toContain(
        "occtV7-custom",
      );
      expectPublicWording(result);
    } finally {
      missingCapability.dispose();
    }
  });

  it("locates the offending authored field in creation diagnostics", async () => {
    const bytes = encoder.encode("precise-creation-paths");
    const definition = await stepDefinition(bytes, {
      bodyId: "housing",
      resourceId: "housingStep",
    });
    const expectSourcePath = (
      result: CadResult<ImportedBodyDocument>,
      path: string,
      message: string | RegExp,
    ): void => {
      expectFailure(result, "IMPORT_SOURCE_INVALID");
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.path).toBe(path);
      expect(result.diagnostics[0]?.message).toMatch(message);
    };
    const withResource = (
      resource: Record<string, unknown>,
    ): ImportedBodyDefinition =>
      ({
        ...definition,
        resource: { ...definition.resource, ...resource },
      }) as unknown as ImportedBodyDefinition;

    expectSourcePath(
      createImportedBodyDocument("   ", definition),
      "/name",
      "A design requires a name",
    );
    expectSourcePath(
      createImportedBodyDocument("Paths", {
        ...definition,
        id: "1 housing",
      }),
      "/definition/id",
      /^Node ID '1 housing' is invalid/u,
    );
    expectSourcePath(
      createImportedBodyDocument("Paths", withResource({ id: "bad id" })),
      "/definition/resource/id",
      /^Resource ID 'bad id' is invalid/u,
    );
    expectSourcePath(
      createImportedBodyDocument(
        "Paths",
        withResource({ digest: definition.resource.digest.toUpperCase() }),
      ),
      "/definition/resource/digest",
      "Resource digest must be a lowercase sha256 commitment",
    );
    for (const byteLength of [-1, 1.5, Number.NaN]) {
      expectSourcePath(
        createImportedBodyDocument("Paths", withResource({ byteLength })),
        "/definition/resource/byteLength",
        "Resource byteLength must be a non-negative safe integer",
      );
    }
    expectSourcePath(
      createImportedBodyDocument(
        "Paths",
        withResource({ locations: ["memory:a", "memory:b", "memory:a"] }),
      ),
      "/definition/resource/locations/2",
      "Resource location 'memory:a' is duplicated",
    );
    expect(
      createImportedBodyDocument("Paths", withResource({ byteLength: 0 })).ok,
    ).toBe(true);
  });

  it("maps parse-time policy failures to document paths", async () => {
    const bytes = encoder.encode("precise-parse-paths");
    const document = valueOf(
      createImportedBodyDocument(
        "Parse paths",
        await stepDefinition(bytes, {
          bodyId: "housing",
          resourceId: "housingStep",
        }),
      ),
    );
    const raw = JSON.parse(stringifyImportedBodyDocument(document)) as {
      resources: Record<string, Record<string, unknown>>;
      nodes: Record<string, Record<string, unknown>>;
    };

    const wrongMedia = structuredClone(raw);
    wrongMedia.resources.housingStep!.mediaType = "text/plain";
    const media = parseImportedBodyDocument(JSON.stringify(wrongMedia));
    expectFailure(media, "IR_INVALID");
    expect(media.diagnostics[0]).toMatchObject({
      message: "Imported-body step requires mediaType 'model/step'",
      path: "/resources/housingStep/mediaType",
    });

    const brepNode = structuredClone(raw);
    brepNode.nodes.housing = {
      ...brepNode.nodes.housing,
      format: "brep",
      units: { mode: "declared", length: "mm" },
    };
    const brep = parseImportedBodyDocument(JSON.stringify(brepNode));
    expectFailure(brep, "IR_INVALID");
    expect(brep.diagnostics[0]?.path).toBe(
      "/resources/housingStep/mediaType",
    );
  });

  it("roots every evaluation-option diagnostic at /options", async () => {
    const bytes = encoder.encode("precise-option-paths");
    const document = valueOf(
      createImportedBodyDocument("Option paths", await stepDefinition(bytes)),
    );
    const nativeImport = vi.fn((): KernelShape => ({
      kernel: "option-paths-must-not-import",
    }));
    const resolver = vi.fn(() => bytes);
    const evaluator = await createEvaluator({
      kernel: exactImportKernel({ importDocumentBody: nativeImport }),
    });
    const accessorLimits = Object.defineProperty({}, "maxDocumentBytes", {
      enumerable: true,
      get: () => 1_000_000,
    });
    try {
      for (const [options, path] of [
        [
          { resolver, resourceLimits: { maxResourceBytes: Number.NaN } },
          "/options/resourceLimits/maxResourceBytes",
        ],
        [
          { resolver, resourceLimits: { maxResourceBytes: -1 } },
          "/options/resourceLimits/maxResourceBytes",
        ],
        [
          { resolver, resourceLimits: { maxResourceBytes: null } },
          "/options/resourceLimits/maxResourceBytes",
        ],
        [
          { resolver, resourceLimits: { maxTotalResourceBytes: 1 } },
          "/options/resourceLimits",
        ],
        [{ resolver, signal: {} }, "/options/signal"],
        [
          { resolver, documentLimits: { maxDocumentBytes: -5 } },
          "/options/documentLimits/maxDocumentBytes",
        ],
        [
          { resolver, documentLimits: { bogus: 1 } },
          "/options/documentLimits",
        ],
        [
          { resolver, documentLimits: accessorLimits },
          "/options/documentLimits/maxDocumentBytes",
        ],
        [{ resolver, documentLimits: 3 }, "/options/documentLimits"],
      ] as const) {
        const result = await evaluator.evaluateImportedBody(
          document,
          options as unknown as EvaluateImportedBodyOptions,
        );
        expectFailure(result, "IR_INVALID");
        expect(result.diagnostics, JSON.stringify(options)).toHaveLength(1);
        expect(result.diagnostics[0]?.path, JSON.stringify(options)).toBe(
          path,
        );
        expectPublicDiagnostics(result);
      }
      expect(resolver).not.toHaveBeenCalled();
      expect(nativeImport).not.toHaveBeenCalled();

      const controller = new AbortController();
      const accepted = await evaluator.evaluateImportedBody(document, {
        resolver,
        resourceLimits: { maxResourceBytes: bytes.byteLength },
        documentLimits: { maxDocumentBytes: 1_000_000 },
        signal: controller.signal,
      });
      const value = valueOf(accepted);
      value.dispose();
    } finally {
      evaluator.dispose();
    }
  });

  it("does not expose staged document-v7 implementation names", () => {
    const leakedNames = Object.keys(publicApi).filter(
      (name) =>
        name.includes("V7") ||
        name.toLowerCase().includes("staged"),
    );
    expect(leakedNames).toEqual([]);
    expect("evaluateImportedBodyOutputsV7" in publicApi).toBe(false);
    expect("DesignDocumentV7Schema" in publicApi).toBe(false);
    expect("parseDocumentV7" in publicApi).toBe(false);
    expect("stringifyDocumentV7" in publicApi).toBe(false);
  });
});

describe("stock OCCT public imported-body workflow", () => {
  let sourceStep = new Uint8Array();
  let sourceTextBrep = new Uint8Array();
  let sourceBinaryBrep = new Uint8Array();

  beforeAll(async () => {
    const raw = await RawOcctKernel.init();
    let box: ShapeHandle | undefined;
    try {
      box = raw.makeBox(2, 3, 4);
      sourceStep = encoder.encode(raw.exportStep(box));
      sourceTextBrep = encoder.encode(raw.toBREP(box));
      sourceBinaryBrep = raw.toBREPBinary(box).slice();
    } finally {
      if (box !== undefined) raw.release(box);
      raw[Symbol.dispose]();
    }
  }, 30_000);

  afterAll(() => {
    sourceStep = new Uint8Array();
    sourceTextBrep = new Uint8Array();
    sourceBinaryBrep = new Uint8Array();
  });

  it("imports text and binary BREP with explicit declared units", async () => {
    const textDocument = valueOf(
      createImportedBodyDocument("Centimeter text BREP", {
        id: "textBrepBody",
        resource: {
          id: "textBrepResource",
          digest: await sha256(sourceTextBrep),
          byteLength: sourceTextBrep.byteLength,
          mediaType: "text/plain",
        },
        format: "brep",
        units: { mode: "declared", length: "cm" },
      }),
    );
    const binaryDocument = valueOf(
      createImportedBodyDocument("Millimeter binary BREP", {
        id: "binaryBrepBody",
        resource: {
          id: "binaryBrepResource",
          digest: await sha256(sourceBinaryBrep),
          byteLength: sourceBinaryBrep.byteLength,
          mediaType: "application/octet-stream",
        },
        format: "brep-binary",
        units: { mode: "declared", length: "mm" },
      }),
    );
    const evaluator = await createEvaluator({
      profile: "mechanical-exact",
    });
    let textBody: EvaluatedImportedBody | undefined;
    let binaryBody: EvaluatedImportedBody | undefined;
    try {
      textBody = valueOf(
        await evaluator.evaluateImportedBody(textDocument, {
          resolver: (request) => {
            expect(request.mediaType).toBe("text/plain");
            return sourceTextBrep;
          },
        }),
      );
      binaryBody = valueOf(
        await evaluator.evaluateImportedBody(binaryDocument, {
          resolver: (request) => {
            expect(request.mediaType).toBe("application/octet-stream");
            return sourceBinaryBrep;
          },
        }),
      );
      expect(textBody.measure()).toMatchObject({
        volume: expect.closeTo(24_000, 5),
        boundingBox: { max: [20, 30, 40] },
      });
      expect(binaryBody.measure()).toMatchObject({
        volume: expect.closeTo(24, 8),
        boundingBox: { max: [2, 3, 4] },
      });
    } finally {
      binaryBody?.dispose();
      textBody?.dispose();
      evaluator.dispose();
    }
  }, 30_000);

  it("round-trips one exact body with owned results and restores native handles", async () => {
    const definition = await stepDefinition(sourceStep, {
      bodyId: "fixtureBody",
      resourceId: "fixtureStep",
      locations: ["memory:fixture.step"],
    });
    const document = valueOf(
      createImportedBodyDocument("Exact fixture", definition),
    );
    const evaluator = await createEvaluator({
      profile: "mechanical-exact",
    });
    const liveShapes = (
      evaluator.kernel as GeometryKernel & {
        readonly liveShapes: ReadonlySet<unknown>;
      }
    ).liveShapes;
    const liveBefore = liveShapes.size;
    let imported: EvaluatedImportedBody | undefined;
    let roundTripped: EvaluatedImportedBody | undefined;
    try {
      const requests: ImportedBodyResolverRequest[] = [];
      const result = await evaluator.evaluateImportedBody(document, {
        resolver: (request) => {
          requests.push(request);
          return sourceStep;
        },
      });
      imported = valueOf(result);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        id: "fixtureStep",
        digest: definition.resource.digest,
        byteLength: sourceStep.byteLength,
        mediaType: "model/step",
        locations: ["memory:fixture.step"],
      });
      expect(Object.isFrozen(requests[0])).toBe(true);
      expect(imported.name).toBe("fixtureBody");
      expect(imported.exact).toBe(true);
      expect(imported.representation).toBe("brep");
      expect(imported.provenance).toEqual({
        ...definition,
        healing: { mode: "none" },
        expected: "single-solid",
      });
      expect(imported.measure()).toMatchObject({
        volume: expect.closeTo(24, 8),
        surfaceArea: expect.closeTo(52, 8),
        boundingBox: {
          min: [0, 0, 0],
          max: [2, 3, 4],
        },
      });
      expect(imported.mesh().indices.length).toBeGreaterThan(0);
      const topology = imported.topology();
      expect(topology).toMatchObject({
        ok: true,
        value: { history: "partial" },
      });
      if (topology.ok) {
        expect(topology.value.faces).toHaveLength(6);
        expect(topology.value.edges).toHaveLength(12);
        expect(topology.value.vertices).toHaveLength(8);
      }

      const firstStep = imported.export("step", {});
      const secondStep = imported.export("step", {});
      expect(firstStep.byteLength).toBeGreaterThan(100);
      expect(secondStep).toEqual(firstStep);

      const roundTripDocument = valueOf(
        createImportedBodyDocument(
          "Round-tripped fixture",
          await stepDefinition(firstStep, {
            bodyId: "roundTrippedBody",
            resourceId: "roundTrippedStep",
          }),
        ),
      );
      roundTripped = valueOf(
        await evaluator.evaluateImportedBody(roundTripDocument, {
          resolver: () => firstStep,
        }),
      );
      expect(roundTripped.measure().volume).toBeCloseTo(24, 8);
      expect(roundTripped.measure().surfaceArea).toBeCloseTo(52, 8);
      expect(liveShapes.size).toBe(liveBefore + 2);

      roundTripped.dispose();
      roundTripped.dispose();
      roundTripped = undefined;
      expect(liveShapes.size).toBe(liveBefore + 1);

      imported.dispose();
      imported.dispose();
      expect(liveShapes.size).toBe(liveBefore);
      expect(() => imported?.measure()).toThrow(/disposed/i);
      imported = undefined;

      const stillLive = valueOf(
        await evaluator.evaluateImportedBody(document, {
          resolver: () => sourceStep,
        }),
      );
      expect(stillLive.measure().volume).toBeCloseTo(24, 8);
      stillLive.dispose();
      expect(liveShapes.size).toBe(liveBefore);
    } finally {
      roundTripped?.dispose();
      imported?.dispose();
      expect(liveShapes.size).toBe(liveBefore);
      evaluator.dispose();
    }
  }, 30_000);
});
