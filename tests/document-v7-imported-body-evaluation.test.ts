import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OcctKernel as RawOcctKernel,
  type ShapeHandle,
} from "occt-wasm";
import type { ResourceId } from "../src/core/ids.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type DesignDocumentV7,
  type ImportedBodyNodeIRV7,
  type NodeIRV7,
  type ResourceDigestIR,
} from "../src/ir.js";
import {
  EvaluatedDesign,
  EvaluatedSolid,
  evaluateImportedBodyOutputsV7,
} from "../src/evaluator.js";
import {
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelDocumentBodyImportOptions,
  type KernelFeatureContext,
  type KernelShape,
  type ShapeMeasurements,
} from "../src/kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import type {
  ResourceResolverRequestV7,
} from "../src/resource-resolution.js";

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

const documentBodyImportCapabilities = {
  protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  formats: [
    { format: "step", unitModes: ["from-file"] },
    { format: "brep", unitModes: ["declared"] },
    { format: "brep-binary", unitModes: ["declared"] },
  ],
} as const;

async function digest(bytes: Uint8Array): Promise<ResourceDigestIR> {
  const copied = new Uint8Array(bytes.byteLength);
  copied.set(bytes);
  const value = await crypto.subtle.digest("SHA-256", copied);
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function importedBody(
  resource: ResourceId,
  options:
    | {
        readonly format: "step";
        readonly units: { readonly mode: "from-file" };
      }
    | {
        readonly format: "brep" | "brep-binary";
        readonly units: {
          readonly mode: "declared";
          readonly length: "mm" | "cm" | "m" | "in";
        };
      } = {
    format: "step",
    units: { mode: "from-file" },
  },
): ImportedBodyNodeIRV7 {
  return {
    kind: "importedBody",
    resource,
    format: options.format,
    units: options.units,
    healing: { mode: "none" },
    expected: "single-solid",
  } as ImportedBodyNodeIRV7;
}

async function importedDocument(
  resources: Readonly<Record<string, Uint8Array>>,
  nodes: Readonly<Record<string, NodeIRV7>>,
  outputs: Readonly<
    Record<
      string,
      { readonly node: string; readonly kind: "solid" }
    >
  >,
): Promise<DesignDocumentV7> {
  const definitions: Record<string, {
    digest: ResourceDigestIR;
    byteLength: number;
    mediaType: string;
    locations: readonly string[];
  }> = {};
  for (const [id, bytes] of Object.entries(resources)) {
    definitions[id] = {
      digest: await digest(bytes),
      byteLength: bytes.byteLength,
      mediaType: "application/octet-stream",
      locations: [`project://fixtures/${id}`],
    };
  }
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "document-v7-imported-body-evaluation",
    units: { length: "mm", angle: "rad" },
    parameters: {},
    resources: definitions,
    nodes,
    outputs,
  } as unknown as DesignDocumentV7;
}

interface FakeShape extends KernelShape {
  readonly serial: number;
}

interface ImportCall {
  readonly bytes: Uint8Array;
  readonly options: KernelDocumentBodyImportOptions;
  readonly context: KernelFeatureContext | undefined;
  readonly shape: FakeShape;
}

interface KernelHarness {
  readonly kernel: GeometryKernel;
  readonly imports: ImportCall[];
  readonly disposed: FakeShape[];
  readonly live: ReadonlySet<FakeShape>;
}

function createKernelHarness(options: {
  readonly capabilities?: KernelCapabilities;
  readonly omitImportMethod?: boolean;
  readonly importHook?: (
    bytes: Uint8Array,
    importOptions: KernelDocumentBodyImportOptions,
    context: KernelFeatureContext | undefined,
    shape: FakeShape,
    callIndex: number,
  ) => KernelShape;
  readonly statusHook?: (shape: FakeShape) => ReturnType<GeometryKernel["status"]>;
  readonly measureHook?: (shape: FakeShape) => ShapeMeasurements;
} = {}): KernelHarness {
  const imports: ImportCall[] = [];
  const disposed: FakeShape[] = [];
  const live = new Set<FakeShape>();
  let serial = 0;
  const capabilities: KernelCapabilities = options.capabilities ?? {
    protocolVersion: 1,
    representation: "brep",
    exact: true,
    primitives: [],
    features: [],
    nativeImports: [],
    nativeExports: [],
    documentBodyImport: documentBodyImportCapabilities,
  };
  const kernel: GeometryKernel = {
    id: "document-v7-import-test",
    capabilities,
    ...(options.omitImportMethod
      ? {}
      : {
          importDocumentBody: (
            bytes: Uint8Array,
            importOptions: KernelDocumentBodyImportOptions,
            context?: KernelFeatureContext,
          ): KernelShape => {
            const shape: FakeShape = {
              kernel: "document-v7-import-test",
              serial: serial++,
            };
            live.add(shape);
            const call: ImportCall = {
              bytes: bytes.slice(),
              options: importOptions,
              context,
              shape,
            };
            imports.push(call);
            try {
              const returned = options.importHook?.(
                bytes,
                importOptions,
                context,
                shape,
                imports.length - 1,
              ) ?? shape;
              if (returned !== shape) live.delete(shape);
              return returned;
            } catch (error) {
              // The strong kernel contract owns and releases every provisional
              // shape when import itself fails.
              live.delete(shape);
              throw error;
            }
          },
        }),
    mesh: () => ({
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0,
      ]),
      indices: new Uint32Array([0, 1, 2]),
    }),
    measure: (shape) =>
      options.measureHook?.(shape as FakeShape) ?? measurement,
    status: (shape) =>
      options.statusHook?.(shape as FakeShape) ?? {
        ok: true,
        code: "VALID",
      },
    disposeShape: (shape) => {
      const candidate = shape as FakeShape;
      if (!live.delete(candidate)) {
        throw new Error(`Shape ${candidate.serial} was disposed more than once`);
      }
      disposed.push(candidate);
    },
    dispose: () => undefined,
  };
  return { kernel, imports, disposed, live };
}

function resolverFor(
  resources: Readonly<Record<string, Uint8Array>>,
  requests: ResourceResolverRequestV7[],
): (request: ResourceResolverRequestV7) => Uint8Array {
  return (request) => {
    requests.push(request);
    const bytes = resources[request.id];
    if (bytes === undefined) throw new Error(`Missing fixture '${request.id}'`);
    return bytes;
  };
}

function expectFailureCode(
  result: Awaited<ReturnType<typeof evaluateImportedBodyOutputsV7>>,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code })]),
  );
}

describe("staged document-v7 imported-body output evaluation", () => {
  it("preflights absent, unsupported, malformed, and method-missing capabilities before resolution", async () => {
    const bytes = encoder.encode("fixture");
    const document = await importedDocument(
      { shared: bytes },
      {
        body: importedBody("shared" as ResourceId, {
          format: "brep",
          units: { mode: "declared", length: "mm" },
        }),
      },
      { body: { node: "body", kind: "solid" } },
    );
    const cases: readonly {
      readonly harness: KernelHarness;
      readonly code: string;
      readonly protocolViolation?: boolean;
    }[] = [
      {
        harness: createKernelHarness({
          capabilities: {
            protocolVersion: 1,
            representation: "mesh",
            exact: false,
            primitives: [],
            features: [],
            nativeImports: [],
            nativeExports: [],
          },
        }),
        code: "KERNEL_CAPABILITY_MISSING",
      },
      {
        harness: createKernelHarness({
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
              formats: [{ format: "step", unitModes: ["from-file"] }],
            },
          },
        }),
        code: "KERNEL_CAPABILITY_MISSING",
      },
      {
        harness: createKernelHarness({
          capabilities: {
            protocolVersion: 1,
            representation: "brep",
            exact: true,
            primitives: [],
            features: [],
            nativeImports: [],
            nativeExports: [],
            documentBodyImport: {
              protocolVersion: 2,
              formats: [],
            },
          } as unknown as KernelCapabilities,
        }),
        code: "KERNEL_ERROR",
        protocolViolation: true,
      },
      {
        harness: createKernelHarness({
          capabilities: {
            protocolVersion: 1,
            representation: "mesh",
            exact: false,
            primitives: [],
            features: [],
            nativeImports: [],
            nativeExports: [],
            documentBodyImport: documentBodyImportCapabilities,
          },
        }),
        code: "KERNEL_ERROR",
        protocolViolation: true,
      },
      {
        harness: createKernelHarness({ omitImportMethod: true }),
        code: "KERNEL_ERROR",
        protocolViolation: true,
      },
    ];

    for (const testCase of cases) {
      const resolver = vi.fn(() => bytes);
      const result = await evaluateImportedBodyOutputsV7(
        testCase.harness.kernel,
        document,
        { resolver },
      );
      expectFailureCode(result, testCase.code);
      expect(resolver).not.toHaveBeenCalled();
      expect(testCase.harness.imports).toHaveLength(0);
      expect(testCase.harness.live.size).toBe(0);
      if (!result.ok && testCase.protocolViolation) {
        expect(result.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              details: expect.objectContaining({ protocolViolation: true }),
            }),
          ]),
        );
      }
    }

    const weakImport = vi.fn(
      (): KernelShape => ({ kernel: "weak-import-must-not-run" }),
    );
    const weakHarness = createKernelHarness({
      capabilities: {
        protocolVersion: 1,
        representation: "brep",
        exact: true,
        primitives: [],
        features: [],
        nativeImports: ["brep"],
        nativeExports: [],
      },
      omitImportMethod: true,
    });
    const weakResolver = vi.fn(() => bytes);
    const weakResult = await evaluateImportedBodyOutputsV7(
      { ...weakHarness.kernel, importShape: weakImport },
      document,
      { resolver: weakResolver },
    );
    expectFailureCode(weakResult, "KERNEL_CAPABILITY_MISSING");
    expect(weakImport).not.toHaveBeenCalled();
    expect(weakResolver).not.toHaveBeenCalled();
  });

  it("does not invoke poisoned ambient methods installed by capability or resolver callbacks", async () => {
    const bytes = encoder.encode("ambient-integrity");
    const document = await importedDocument(
      { ambient: bytes },
      { body: importedBody("ambient" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );

    const capabilityHarness = createKernelHarness();
    const originalArrayIsArray = Array.isArray;
    let poisonedArrayCalls = 0;
    const capabilityKernel = {
      ...capabilityHarness.kernel,
      get capabilities(): KernelCapabilities {
        Array.isArray = ((value: unknown): value is unknown[] => {
          poisonedArrayCalls += 1;
          return originalArrayIsArray(value);
        }) as typeof Array.isArray;
        return capabilityHarness.kernel.capabilities;
      },
    };
    let capabilityResult:
      | Awaited<ReturnType<typeof evaluateImportedBodyOutputsV7>>
      | undefined;
    try {
      capabilityResult = await evaluateImportedBodyOutputsV7(
        capabilityKernel,
        document,
        { resolver: () => bytes },
      );
    } finally {
      Array.isArray = originalArrayIsArray;
    }
    expect(capabilityResult).toBeDefined();
    expectFailureCode(capabilityResult!, "IR_INVALID");
    expect(poisonedArrayCalls).toBe(0);
    expect(capabilityHarness.imports).toHaveLength(0);

    const resolverHarness = createKernelHarness();
    const originalNumberIsSafeInteger = Number.isSafeInteger;
    let poisonedNumberCalls = 0;
    let resolverResult:
      | Awaited<ReturnType<typeof evaluateImportedBodyOutputsV7>>
      | undefined;
    try {
      resolverResult = await evaluateImportedBodyOutputsV7(
        resolverHarness.kernel,
        document,
        {
          resolver: () => {
            Number.isSafeInteger = ((value: unknown): boolean => {
              poisonedNumberCalls += 1;
              return originalNumberIsSafeInteger(value);
            }) as typeof Number.isSafeInteger;
            return bytes;
          },
        },
      );
    } finally {
      Number.isSafeInteger = originalNumberIsSafeInteger;
    }
    expect(resolverResult).toBeDefined();
    expectFailureCode(resolverResult!, "IR_INVALID");
    expect(poisonedNumberCalls).toBe(0);
    expect(resolverHarness.imports).toHaveLength(0);
    expect(resolverHarness.live.size).toBe(0);
  });

  it("rejects accessor-backed top-level options without invoking them", async () => {
    const bytes = encoder.encode("option-accessor");
    const document = await importedDocument(
      { optionResource: bytes },
      { body: importedBody("optionResource" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );
    let resolverReads = 0;
    const options = Object.defineProperty({}, "resolver", {
      enumerable: true,
      get: () => {
        resolverReads += 1;
        return () => bytes;
      },
    });
    const result = await evaluateImportedBodyOutputsV7(
      createKernelHarness().kernel,
      document,
      options,
    );
    expectFailureCode(result, "IR_INVALID");
    expect(resolverReads).toBe(0);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "/resolver" }),
        ]),
      );
    }
  });

  it("does not invoke inherited numeric setters installed by option or document traps", async () => {
    const bytes = encoder.encode("numeric-setter");
    const document = await importedDocument(
      { numericResource: bytes },
      { body: importedBody("numericResource" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );
    const originalIndex = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "0",
    );
    const originalArrayPrototypeLength = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "length",
    );

    let optionSetterCalls = 0;
    const outputs = new Proxy(["body"], {
      getOwnPropertyDescriptor: (target, key) => {
        if (key === "0") {
          Object.defineProperty(Array.prototype, "0", {
            configurable: true,
            set: () => {
              optionSetterCalls += 1;
            },
          });
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    let optionResult:
      | Awaited<ReturnType<typeof evaluateImportedBodyOutputsV7>>
      | undefined;
    try {
      optionResult = await evaluateImportedBodyOutputsV7(
        createKernelHarness().kernel,
        document,
        { outputs, resolver: () => bytes },
      );
    } finally {
      if (originalIndex === undefined) {
        delete (Array.prototype as { 0?: unknown })[0];
      } else {
        Object.defineProperty(Array.prototype, "0", originalIndex);
      }
      Object.defineProperty(
        Array.prototype,
        "length",
        originalArrayPrototypeLength!,
      );
    }
    expect(optionResult).toBeDefined();
    expectFailureCode(optionResult!, "IR_INVALID");
    expect(optionSetterCalls).toBe(0);

    let documentSetterCalls = 0;
    const hostileArray = new Proxy([1], {
      getOwnPropertyDescriptor: (target, key) => {
        if (key === "0") {
          Object.defineProperty(Array.prototype, "0", {
            configurable: true,
            set: () => {
              documentSetterCalls += 1;
            },
          });
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    let documentResult:
      | Awaited<ReturnType<typeof evaluateImportedBodyOutputsV7>>
      | undefined;
    try {
      documentResult = await evaluateImportedBodyOutputsV7(
        createKernelHarness().kernel,
        { ...document, hostileArray } as unknown as DesignDocumentV7,
        { resolver: () => bytes },
      );
    } finally {
      if (originalIndex === undefined) {
        delete (Array.prototype as { 0?: unknown })[0];
      } else {
        Object.defineProperty(Array.prototype, "0", originalIndex);
      }
      Object.defineProperty(
        Array.prototype,
        "length",
        originalArrayPrototypeLength!,
      );
    }
    expect(documentResult).toBeDefined();
    expectFailureCode(documentResult!, "IR_INVALID");
    expect(documentSetterCalls).toBe(0);
  });

  it("deduplicates resolution and node evaluation while preserving output order and node options", async () => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    const document = await importedDocument(
      { shared: bytes },
      {
        stepBody: importedBody("shared" as ResourceId),
        brepBody: importedBody("shared" as ResourceId, {
          format: "brep-binary",
          units: { mode: "declared", length: "in" },
        }),
      },
      {
        first: { node: "stepBody", kind: "solid" },
        second: { node: "brepBody", kind: "solid" },
        alias: { node: "stepBody", kind: "solid" },
      },
    );
    const harness = createKernelHarness({
      importHook: (received, _options, _context, shape, index) => {
        expect(received[0]).toBe(10);
        if (index === 0) received[0] = 255;
        return shape;
      },
    });
    const requests: ResourceResolverRequestV7[] = [];
    const controller = new AbortController();
    const result = await evaluateImportedBodyOutputsV7(
      harness.kernel,
      document,
      {
        outputs: ["second", "alias", "first"],
        resolver: resolverFor({ shared: bytes }, requests),
        signal: controller.signal,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.value.outputNames).toEqual(["second", "alias", "first"]);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toEqual({
        id: "shared",
        digest: await digest(bytes),
        byteLength: 4,
        mediaType: "application/octet-stream",
        locations: ["project://fixtures/shared"],
        signal: controller.signal,
      });
      expect(harness.imports).toHaveLength(2);
      expect(harness.imports.map((call) => call.context)).toEqual([
        { feature: "brepBody", signal: controller.signal },
        { feature: "stepBody", signal: controller.signal },
      ]);
      expect(harness.imports.map((call) => call.options)).toEqual([
        {
          format: "brep-binary",
          units: { mode: "declared", length: "in" },
          healing: { mode: "none" },
        },
        {
          format: "step",
          units: { mode: "from-file" },
          healing: { mode: "none" },
        },
      ]);
      expect(harness.imports[0]!.bytes).toEqual(bytes);
      expect(harness.imports[1]!.bytes).toEqual(bytes);
      expect(result.value.output("alias")).not.toBe(
        result.value.output("first"),
      );
      expect(result.value.output("alias").measure()).toEqual(
        result.value.output("first").measure(),
      );
      expect(result.value.output("second")).not.toBe(
        result.value.output("first"),
      );
    } finally {
      result.value.dispose();
      result.value.dispose();
    }
    expect(harness.disposed.map((shape) => shape.serial).sort()).toEqual([0, 1]);
    expect(harness.live.size).toBe(0);
  });

  it("captures the successful-result disposer once instead of rereading a kernel getter", async () => {
    const bytes = encoder.encode("captured-disposer");
    const document = await importedDocument(
      { bodyResource: bytes },
      { body: importedBody("bodyResource" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );
    const harness = createKernelHarness();
    const disposeShape = harness.kernel.disposeShape;
    let disposerReads = 0;
    const kernel = { ...harness.kernel } as GeometryKernel;
    Object.defineProperty(kernel, "disposeShape", {
      configurable: true,
      enumerable: true,
      get: () => {
        disposerReads += 1;
        return disposeShape;
      },
    });

    const result = await evaluateImportedBodyOutputsV7(kernel, document, {
      resolver: () => bytes,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(disposerReads).toBe(1);
    result.value.dispose();
    expect(disposerReads).toBe(1);
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);
  });

  it("selects all outputs by default and rejects non-direct imported-body outputs before resolution", async () => {
    const bytes = encoder.encode("default-output-order");
    const direct = await importedDocument(
      { resource: bytes },
      {
        body: importedBody("resource" as ResourceId),
      },
      {
        zeta: { node: "body", kind: "solid" },
        alpha: { node: "body", kind: "solid" },
      },
    );
    const harness = createKernelHarness();
    const directResult = await evaluateImportedBodyOutputsV7(
      harness.kernel,
      direct,
      { resolver: () => bytes },
    );
    expect(directResult.ok).toBe(true);
    if (directResult.ok) {
      expect(directResult.value.outputNames).toEqual(["zeta", "alpha"]);
      directResult.value.dispose();
    }

    const unsupported = {
      ...direct,
      nodes: {
        ...direct.nodes,
        primitive: {
          kind: "box",
          size: [
            { op: "literal", dimension: "length", value: 1 },
            { op: "literal", dimension: "length", value: 1 },
            { op: "literal", dimension: "length", value: 1 },
          ],
          center: false,
        },
      },
      outputs: {
        primitive: { node: "primitive", kind: "solid" },
      },
    } as unknown as DesignDocumentV7;
    const resolver = vi.fn(() => bytes);
    const unsupportedResult = await evaluateImportedBodyOutputsV7(
      harness.kernel,
      unsupported,
      { resolver },
    );
    expectFailureCode(unsupportedResult, "EVALUATION_UNSUPPORTED");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("enforces document and resource limits before invoking the resolver or kernel", async () => {
    const bytes = encoder.encode("bounded");
    const document = await importedDocument(
      { bounded: bytes },
      { body: importedBody("bounded" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );
    const harness = createKernelHarness();
    const resolver = vi.fn(() => bytes);

    const documentLimited = await evaluateImportedBodyOutputsV7(
      harness.kernel,
      document,
      {
        resolver,
        documentLimits: { maxResourceDefinitions: 0 },
      },
    );
    expectFailureCode(documentLimited, "IR_INVALID");

    const resourceLimited = await evaluateImportedBodyOutputsV7(
      harness.kernel,
      document,
      {
        resolver,
        resourceLimits: { maxResourceBytes: bytes.byteLength - 1 },
      },
    );
    expectFailureCode(resourceLimited, "RESOURCE_LIMIT_EXCEEDED");

    const outputLimited = await evaluateImportedBodyOutputsV7(
      harness.kernel,
      document,
      {
        resolver,
        evaluationLimits: { maxSelectedOutputs: 0 },
      },
    );
    expectFailureCode(outputLimited, "RESOURCE_LIMIT_EXCEEDED");
    expect(resolver).not.toHaveBeenCalled();
    expect(harness.imports).toHaveLength(0);
  });

  it("rejects resource-integrity mismatches before kernel import", async () => {
    const committed = new Uint8Array([1, 2, 3, 4]);
    const substituted = new Uint8Array([4, 3, 2, 1]);
    const document = await importedDocument(
      { committed },
      { body: importedBody("committed" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );
    const harness = createKernelHarness();
    const result = await evaluateImportedBodyOutputsV7(
      harness.kernel,
      document,
      { resolver: () => substituted },
    );
    expectFailureCode(result, "RESOURCE_INTEGRITY_MISMATCH");
    expect(harness.imports).toHaveLength(0);
    expect(harness.live.size).toBe(0);
  });

  it("gives cancellation precedence before, during, and after resource resolution", async () => {
    const bytes = encoder.encode("cancel");
    const document = await importedDocument(
      { cancel: bytes },
      { body: importedBody("cancel" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const earlyHarness = createKernelHarness();
    const earlyResolver = vi.fn(() => bytes);
    const early = await evaluateImportedBodyOutputsV7(
      earlyHarness.kernel,
      document,
      {
        resolver: earlyResolver,
        signal: alreadyAborted.signal,
      },
    );
    expectFailureCode(early, "EVALUATION_ABORTED");
    expect(earlyResolver).not.toHaveBeenCalled();
    expect(earlyHarness.imports).toHaveLength(0);

    const capabilityController = new AbortController();
    const capabilityHarness = createKernelHarness();
    const capabilityResolver = vi.fn(() => bytes);
    const capabilityResult = await evaluateImportedBodyOutputsV7(
      {
        ...capabilityHarness.kernel,
        get capabilities(): KernelCapabilities {
          capabilityController.abort();
          return {
            ...capabilityHarness.kernel.capabilities,
            protocolVersion: 2,
          } as unknown as KernelCapabilities;
        },
      },
      document,
      {
        resolver: capabilityResolver,
        signal: capabilityController.signal,
      },
    );
    expectFailureCode(capabilityResult, "EVALUATION_ABORTED");
    expect(capabilityResolver).not.toHaveBeenCalled();

    const throwingCapabilityController = new AbortController();
    const throwingCapabilityHarness = createKernelHarness();
    const throwingCapabilityResult = await evaluateImportedBodyOutputsV7(
      {
        ...throwingCapabilityHarness.kernel,
        get capabilities(): KernelCapabilities {
          throwingCapabilityController.abort();
          throw new Error("capability getter failed after cancellation");
        },
      },
      document,
      {
        resolver: () => bytes,
        signal: throwingCapabilityController.signal,
      },
    );
    expectFailureCode(throwingCapabilityResult, "EVALUATION_ABORTED");

    const methodController = new AbortController();
    const methodHarness = createKernelHarness();
    const methodKernel = { ...methodHarness.kernel } as GeometryKernel;
    let laterMethodReads = 0;
    Object.defineProperties(methodKernel, {
      importDocumentBody: {
        configurable: true,
        enumerable: true,
        get: () => {
          methodController.abort();
          return methodHarness.kernel.importDocumentBody;
        },
      },
      status: {
        configurable: true,
        enumerable: true,
        get: () => {
          laterMethodReads += 1;
          return methodHarness.kernel.status;
        },
      },
    });
    const methodResult = await evaluateImportedBodyOutputsV7(
      methodKernel,
      document,
      {
        resolver: () => bytes,
        signal: methodController.signal,
      },
    );
    expectFailureCode(methodResult, "EVALUATION_ABORTED");
    expect(laterMethodReads).toBe(0);

    let settle: ((value: Uint8Array) => void) | undefined;
    let resolverStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolverStarted = resolve;
    });
    const pending = new Promise<Uint8Array>((resolve) => {
      settle = resolve;
    });
    const duringController = new AbortController();
    const duringHarness = createKernelHarness();
    const duringResult = evaluateImportedBodyOutputsV7(
      duringHarness.kernel,
      document,
      {
        resolver: () => {
          resolverStarted?.();
          return pending;
        },
        signal: duringController.signal,
      },
    );
    await started;
    duringController.abort();
    const during = await duringResult;
    settle?.(bytes);
    expectFailureCode(during, "EVALUATION_ABORTED");
    expect(duringHarness.imports).toHaveLength(0);

    const afterController = new AbortController();
    const afterHarness = createKernelHarness({
      importHook: (_bytes, _options, _context, shape) => {
        afterController.abort();
        return shape;
      },
    });
    const after = await evaluateImportedBodyOutputsV7(
      afterHarness.kernel,
      document,
      {
        resolver: () => bytes,
        signal: afterController.signal,
      },
    );
    expectFailureCode(after, "EVALUATION_ABORTED");
    expect(afterHarness.disposed).toHaveLength(1);
    expect(afterHarness.live.size).toBe(0);

    const validationController = new AbortController();
    const validationHarness = createKernelHarness({
      statusHook: () => {
        validationController.abort();
        return { ok: true, code: "VALID" };
      },
    });
    const duringValidation = await evaluateImportedBodyOutputsV7(
      validationHarness.kernel,
      document,
      {
        resolver: () => bytes,
        signal: validationController.signal,
      },
    );
    expectFailureCode(duringValidation, "EVALUATION_ABORTED");
    expect(validationHarness.disposed).toHaveLength(1);
    expect(validationHarness.live.size).toBe(0);
  });

  it("contains opaque resolver and kernel failures without leaking acquired shapes", async () => {
    const bytes = encoder.encode("opaque");
    const document = await importedDocument(
      { opaque: bytes },
      { body: importedBody("opaque" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );
    const revokedResolverValue = Proxy.revocable({}, {});
    revokedResolverValue.revoke();
    const resolverHarness = createKernelHarness();
    const resolverResult = await evaluateImportedBodyOutputsV7(
      resolverHarness.kernel,
      document,
      {
        resolver: () => {
          throw revokedResolverValue.proxy;
        },
      },
    );
    expectFailureCode(resolverResult, "RESOURCE_RESOLUTION_FAILED");
    expect(resolverHarness.imports).toHaveLength(0);

    const revokedKernelValue = Proxy.revocable({}, {});
    revokedKernelValue.revoke();
    const importHarness = createKernelHarness({
      importHook: () => {
        throw revokedKernelValue.proxy;
      },
    });
    const importPromise = evaluateImportedBodyOutputsV7(
      importHarness.kernel,
      document,
      { resolver: () => bytes },
    );
    await expect(
      importPromise,
    ).resolves.toMatchObject({ ok: false });
    const importResult = await importPromise;
    expectFailureCode(importResult, "KERNEL_ERROR");

    const statusHarness = createKernelHarness({
      statusHook: () => {
        const revoked = Proxy.revocable({}, {});
        revoked.revoke();
        throw revoked.proxy;
      },
    });
    const statusResult = await evaluateImportedBodyOutputsV7(
      statusHarness.kernel,
      document,
      { resolver: () => bytes },
    );
    expectFailureCode(statusResult, "KERNEL_ERROR");
    expect(statusHarness.disposed).toHaveLength(1);
    expect(statusHarness.live.size).toBe(0);
  });

  it("rejects invalid and reused returned shapes with transactional cleanup", async () => {
    const firstBytes = encoder.encode("first-invalid");
    const secondBytes = encoder.encode("second-invalid");
    const single = await importedDocument(
      { firstResource: firstBytes },
      { body: importedBody("firstResource" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );
    for (const harness of [
      createKernelHarness({
        statusHook: () => ({
          ok: false,
          code: "INVALID",
          message: "invalid fixture",
        }),
      }),
      createKernelHarness({
        measureHook: () => ({ ...measurement, volume: Number.NaN }),
      }),
      createKernelHarness({
        measureHook: () => ({ ...measurement, volume: 0 }),
      }),
    ]) {
      const result = await evaluateImportedBodyOutputsV7(
        harness.kernel,
        single,
        { resolver: () => firstBytes },
      );
      expectFailureCode(result, "KERNEL_ERROR");
      expect(harness.disposed).toHaveLength(1);
      expect(harness.live.size).toBe(0);
    }

    const duplicateDocument = await importedDocument(
      { firstResource: firstBytes, secondResource: secondBytes },
      {
        firstBody: importedBody("firstResource" as ResourceId),
        secondBody: importedBody("secondResource" as ResourceId),
      },
      {
        first: { node: "firstBody", kind: "solid" },
        second: { node: "secondBody", kind: "solid" },
      },
    );
    let firstShape: KernelShape | undefined;
    const duplicateHarness = createKernelHarness({
      importHook: (_bytes, _options, _context, shape, index) => {
        if (index === 0) {
          firstShape = shape;
          return shape;
        }
        return firstShape!;
      },
    });
    const duplicateResult = await evaluateImportedBodyOutputsV7(
      duplicateHarness.kernel,
      duplicateDocument,
      {
        resolver: ({ id }) =>
          id === "firstResource" ? firstBytes : secondBytes,
      },
    );
    expectFailureCode(duplicateResult, "KERNEL_ERROR");
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) {
      expect(duplicateResult.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({ protocolViolation: true }),
          }),
        ]),
      );
    }
    expect(duplicateHarness.disposed).toHaveLength(1);
    expect(duplicateHarness.live.size).toBe(0);

    const originalNumberIsFinite = Number.isFinite;
    let poisonedNumberCalls = 0;
    let guardedFirstShape: KernelShape | undefined;
    const guardedHarness = createKernelHarness({
      importHook: (_bytes, _options, _context, shape, index) => {
        if (index === 0) {
          guardedFirstShape = shape;
          return shape;
        }
        Number.isFinite = ((value: unknown): boolean => {
          poisonedNumberCalls += 1;
          return originalNumberIsFinite(value);
        }) as typeof Number.isFinite;
        return guardedFirstShape!;
      },
    });
    let guardedResult:
      | Awaited<ReturnType<typeof evaluateImportedBodyOutputsV7>>
      | undefined;
    try {
      guardedResult = await evaluateImportedBodyOutputsV7(
        guardedHarness.kernel,
        duplicateDocument,
        {
          resolver: ({ id }) =>
            id === "firstResource" ? firstBytes : secondBytes,
        },
      );
    } finally {
      Number.isFinite = originalNumberIsFinite;
    }
    expect(guardedResult).toBeDefined();
    expectFailureCode(guardedResult!, "IR_INVALID");
    expect(poisonedNumberCalls).toBe(0);
    expect(guardedHarness.disposed).toHaveLength(1);
    expect(guardedHarness.live.size).toBe(0);
  });

  it("retains authentic result behavior when import mutates result prototypes", async () => {
    const bytes = encoder.encode("hostile-result-prototypes");
    const document = await importedDocument(
      { resource: bytes },
      { body: importedBody("resource" as ResourceId) },
      { body: { node: "body", kind: "solid" } },
    );
    const methods = [
      { target: EvaluatedSolid.prototype, key: "mesh" },
      { target: EvaluatedSolid.prototype, key: "measure" },
      { target: EvaluatedSolid.prototype, key: "topology" },
      { target: EvaluatedSolid.prototype, key: "export" },
      { target: EvaluatedDesign.prototype, key: "output" },
      { target: EvaluatedDesign.prototype, key: "dispose" },
    ] as const;
    const descriptors = methods.map((method) => ({
      ...method,
      descriptor: Object.getOwnPropertyDescriptor(
        method.target,
        method.key,
      ),
    }));
    if (
      descriptors.some(
        ({ descriptor }) =>
          descriptor === undefined ||
          typeof descriptor.value !== "function",
      )
    ) {
      throw new Error(
        "Imported-body result regression requires data methods",
      );
    }
    const restore = (): void => {
      for (const method of descriptors) {
        Object.defineProperty(
          method.target,
          method.key,
          method.descriptor!,
        );
      }
    };
    let hostileDispatches = 0;
    const harness = createKernelHarness({
      importHook: (_bytes, _options, _context, shape) => {
        for (const method of descriptors) {
          Object.defineProperty(method.target, method.key, {
            ...method.descriptor!,
            value: (): never => {
              hostileDispatches += 1;
              throw Symbol(
                `hostile imported-body dispatch: ${method.key}`,
              );
            },
          });
        }
        return shape;
      },
    });
    let result:
      | Awaited<ReturnType<typeof evaluateImportedBodyOutputsV7>>
      | undefined;
    try {
      result = await evaluateImportedBodyOutputsV7(
        harness.kernel,
        document,
        { resolver: () => bytes },
      );
      expect(
        result.ok,
        JSON.stringify(result.diagnostics),
      ).toBe(true);
      if (!result.ok) return;
      const output = result.value.output("body");
      expect(output).toBeInstanceOf(EvaluatedSolid);
      if (!(output instanceof EvaluatedSolid)) return;
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.outputNames)).toBe(true);
      expect(Object.isFrozen(output)).toBe(true);
      expect(Reflect.set(output, "owner", Object.freeze({}))).toBe(
        false,
      );
      expect(Reflect.set(output, "shape", Object.freeze({}))).toBe(
        false,
      );
      expect(output.measure().volume).toBeGreaterThan(0);
      expect(output.mesh().indices.length).toBeGreaterThan(0);
      expect(output.export("stl")).toBeInstanceOf(Uint8Array);
      expect(output.topology()).toMatchObject({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            code: "KERNEL_CAPABILITY_MISSING",
          }),
        ],
      });
      result.value.dispose();
      result.value.dispose();
      expect(hostileDispatches).toBe(0);
      expect(harness.disposed).toHaveLength(1);
      expect(harness.live.size).toBe(0);
      expect(() => output.measure()).toThrow(/disposed/i);
    } finally {
      restore();
      if (result?.ok === true) result.value.dispose();
      for (const shape of [...harness.live]) {
        harness.kernel.disposeShape(shape);
      }
    }
  });

  it("rolls back earlier imported nodes when a later node fails", async () => {
    const firstBytes = encoder.encode("first");
    const secondBytes = encoder.encode("second");
    const document = await importedDocument(
      { firstResource: firstBytes, secondResource: secondBytes },
      {
        firstBody: importedBody("firstResource" as ResourceId),
        secondBody: importedBody("secondResource" as ResourceId),
      },
      {
        first: { node: "firstBody", kind: "solid" },
        second: { node: "secondBody", kind: "solid" },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const harness = createKernelHarness({
      importHook: (_bytes, _options, _context, shape, index) => {
        if (index === 1) throw revoked.proxy;
        return shape;
      },
    });
    const result = await evaluateImportedBodyOutputsV7(
      harness.kernel,
      document,
      {
        resolver: ({ id }: ResourceResolverRequestV7) =>
          id === "firstResource" ? firstBytes : secondBytes,
      },
    );
    expectFailureCode(result, "KERNEL_ERROR");
    expect(harness.imports).toHaveLength(2);
    expect(harness.disposed.map((shape) => shape.serial)).toEqual([0]);
    expect(harness.live.size).toBe(0);
  });
});

describe("stock OCCT staged document-v7 imported-body evaluation", () => {
  let step: Uint8Array;
  let brep: Uint8Array;
  let brepBinary: Uint8Array;

  beforeAll(async () => {
    const raw = await RawOcctKernel.init();
    let box: ShapeHandle | undefined;
    try {
      box = raw.makeBox(2, 3, 4);
      step = encoder.encode(raw.exportStep(box));
      brep = encoder.encode(raw.toBREP(box));
      brepBinary = raw.toBREPBinary(box).slice();
    } finally {
      if (box !== undefined) raw.release(box);
      raw[Symbol.dispose]();
    }
  }, 30_000);

  afterAll(() => {
    step = new Uint8Array();
    brep = new Uint8Array();
    brepBinary = new Uint8Array();
  });

  it("resolves, imports, measures, inspects, exports, and disposes all strong formats", async () => {
    const resources = { step, brep, brepBinary };
    const document = await importedDocument(
      resources,
      {
        stepBody: importedBody("step" as ResourceId),
        brepBody: importedBody("brep" as ResourceId, {
          format: "brep",
          units: { mode: "declared", length: "cm" },
        }),
        binaryBody: importedBody("brepBinary" as ResourceId, {
          format: "brep-binary",
          units: { mode: "declared", length: "mm" },
        }),
      },
      {
        step: { node: "stepBody", kind: "solid" },
        brep: { node: "brepBody", kind: "solid" },
        binary: { node: "binaryBody", kind: "solid" },
      },
    );
    const kernel = await createOcctKernel();
    const liveShapes = (
      kernel as GeometryKernel & {
        readonly liveShapes: ReadonlySet<unknown>;
      }
    ).liveShapes;
    const liveBefore = liveShapes.size;
    try {
      const requests: ResourceResolverRequestV7[] = [];
      const result = await evaluateImportedBodyOutputsV7(kernel, document, {
        outputs: ["brep", "binary", "step"],
        resolver: resolverFor(resources, requests),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      let retainedOutput: EvaluatedSolid | undefined;
      try {
        expect(requests.map(({ id }) => id)).toEqual([
          "brep",
          "brepBinary",
          "step",
        ]);
        expect(result.value.outputNames).toEqual(["brep", "binary", "step"]);
        expect(result.value.output("step").measure().volume).toBeCloseTo(24, 8);
        expect(result.value.output("binary").measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(result.value.output("brep").measure().volume).toBeCloseTo(
          24_000,
          5,
        );
        expect(result.value.output("brep").measure().boundingBox.max).toEqual([
          20, 30, 40,
        ]);
        const stepOutput = result.value.output("step");
        const brepOutput = result.value.output("brep");
        const binaryOutput = result.value.output("binary");
        expect(stepOutput).toBeInstanceOf(EvaluatedSolid);
        expect(brepOutput).toBeInstanceOf(EvaluatedSolid);
        expect(binaryOutput).toBeInstanceOf(EvaluatedSolid);
        if (
          !(stepOutput instanceof EvaluatedSolid) ||
          !(brepOutput instanceof EvaluatedSolid) ||
          !(binaryOutput instanceof EvaluatedSolid)
        ) {
          return;
        }
        retainedOutput = stepOutput;
        expect(stepOutput.topology()).toMatchObject({
          ok: true,
          value: { history: "partial" },
        });
        expect(brepOutput.topology()).toMatchObject({
          ok: true,
          value: { history: "partial" },
        });
        const binaryTopology = binaryOutput.topology();
        expect(binaryTopology).toMatchObject({
          ok: true,
          value: { history: "partial" },
        });
        if (binaryTopology.ok) {
          expect(binaryTopology.value.faces).toHaveLength(6);
          expect(binaryTopology.value.edges).toHaveLength(12);
          expect(binaryTopology.value.vertices).toHaveLength(8);
        }
        expect(binaryOutput.export("step")).toEqual(
          expect.any(Uint8Array),
        );
        expect(binaryOutput.export("step").byteLength).toBeGreaterThan(100);
      } finally {
        result.value.dispose();
      }
      expect(() => retainedOutput?.measure()).toThrow(/disposed/);
      expect(liveShapes.size).toBe(liveBefore);
    } finally {
      kernel.dispose();
    }
  }, 30_000);
});
