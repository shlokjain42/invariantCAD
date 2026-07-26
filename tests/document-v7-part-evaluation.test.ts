import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OcctKernel as RawOcctKernel,
  type ShapeHandle,
} from "occt-wasm";
import type { ResourceId } from "../src/core/ids.js";
import { CadError } from "../src/core/result.js";
import {
  createExternalAssemblyPartViewV7,
  createPreparedPartShapeOwnershipTransactionV7,
  EvaluatedSolid,
  EvaluatedPartV7,
  executePreparedPartOutputsV7,
  type EvaluatedPartDesignV7,
  evaluatePartOutputsV7,
  preflightPreparedPartOutputsV7,
  preparePartOutputsV7,
} from "../src/evaluator.js";
import {
  kgPerCubicMillimeter,
  mm,
  type ExpressionIR,
} from "../src/expressions.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type BodySetMemberIRV7,
  type BodySetNodeIRV7,
  type DesignConfigurationIR,
  type DesignDocumentV7,
  type DesignOutputKindV7,
  type ImportedBodyNodeIRV7,
  type MaterialDefinitionIR,
  type NodeIRV7,
  type ParameterIR,
  type PartNodeIRV7,
  type ResourceDigestIR,
} from "../src/ir.js";
import {
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelDocumentBodyImportOptions,
  type KernelFeatureContext,
  type KernelPrimitive,
  type KernelShape,
  type KernelShapeExportContext,
  type MeshData,
  type MeshOptions,
  type ResolvedTransformOperation,
  type ShapeMeasurements,
} from "../src/kernel.js";
import {
  stagedBodySetDesignV7,
} from "../src/internal/document-v7-body-set-authoring.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import type { KernelTopologySnapshot } from "../src/protocol/topology.js";
import {
  resolveResourcesV7,
  type ResourceResolverRequestV7,
} from "../src/resource-resolution.js";
import * as publicApi from "../src/index.js";

const encoder = new TextEncoder();

const length = (value: number): ExpressionIR => ({
  op: "literal",
  dimension: "length",
  value,
});

const lengthParameter = (id: string): ExpressionIR => ({
  op: "parameter",
  dimension: "length",
  id: id as never,
});

const scalar = (value: number): ExpressionIR => ({
  op: "literal",
  dimension: "scalar",
  value,
});

function transform(
  input: string,
  operations: Extract<NodeIRV7, { readonly kind: "transform" }>["operations"],
): NodeIRV7 {
  return {
    kind: "transform",
    input: { node: input as never, kind: "solid" },
    operations,
  };
}

function booleanSolid(
  operation: "union" | "subtract" | "intersect",
  target: string,
  tools: readonly string[],
): NodeIRV7 {
  return {
    kind: "boolean",
    operation,
    target: { node: target as never, kind: "solid" },
    tools: tools.map((node) => ({
      node: node as never,
      kind: "solid" as const,
    })),
  };
}

const density = (value: number): ExpressionIR => ({
  op: "literal",
  dimension: "massDensity",
  value,
});

const densityParameter = (id: string): ExpressionIR => ({
  op: "parameter",
  dimension: "massDensity",
  id: id as never,
});

function box(
  size: readonly [ExpressionIR, ExpressionIR, ExpressionIR] = [
    length(2),
    length(3),
    length(4),
  ],
): NodeIRV7 {
  return { kind: "box", size, center: false };
}

function sphere(radius: ExpressionIR = length(2)): NodeIRV7 {
  return { kind: "sphere", radius, segments: 24 };
}

function importedBody(resource: string): ImportedBodyNodeIRV7 {
  return {
    kind: "importedBody",
    resource: resource as ResourceId,
    format: "step",
    units: { mode: "from-file" },
    healing: { mode: "none" },
    expected: "single-solid",
  };
}

function member(
  id: string,
  node: string,
  options: {
    readonly name?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  } = {},
): BodySetMemberIRV7 {
  return {
    id: id as never,
    solid: { node: node as never, kind: "solid" },
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.metadata === undefined
      ? {}
      : { metadata: options.metadata as never }),
  };
}

function bodySet(bodies: readonly BodySetMemberIRV7[]): BodySetNodeIRV7 {
  return { kind: "bodySet", bodies };
}

function part(
  geometryNode: string,
  geometryKind: "solid" | "bodySet",
  options: Omit<PartNodeIRV7, "kind" | "geometry"> = {},
): PartNodeIRV7 {
  return {
    kind: "part",
    geometry: {
      node: geometryNode as never,
      kind: geometryKind,
    },
    ...options,
  };
}

async function digest(bytes: Uint8Array): Promise<ResourceDigestIR> {
  const copied = bytes.slice();
  const value = await crypto.subtle.digest("SHA-256", copied);
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

interface PartDocumentOptions {
  readonly nodes: Readonly<Record<string, NodeIRV7>>;
  readonly outputs: Readonly<
    Record<
      string,
      {
        readonly node: string;
        readonly kind: DesignOutputKindV7;
      }
    >
  >;
  readonly resources?: Readonly<Record<string, Uint8Array>>;
  readonly parameters?: Readonly<Record<string, ParameterIR>>;
  readonly materials?: Readonly<Record<string, MaterialDefinitionIR>>;
  readonly configurations?: Readonly<Record<string, DesignConfigurationIR>>;
}

async function partDocument(
  options: PartDocumentOptions,
): Promise<DesignDocumentV7> {
  const resources: Record<
    string,
    {
      readonly digest: ResourceDigestIR;
      readonly byteLength: number;
      readonly mediaType: string;
      readonly locations: readonly string[];
    }
  > = {};
  for (const [id, bytes] of Object.entries(options.resources ?? {})) {
    resources[id] = {
      digest: await digest(bytes),
      byteLength: bytes.byteLength,
      mediaType: "application/octet-stream",
      locations: [`project://part-evaluation/${id}`],
    };
  }
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "document-v7-part-evaluation",
    units: { length: "mm", angle: "rad", mass: "kg" },
    parameters: options.parameters ?? {},
    ...(options.materials === undefined
      ? {}
      : { materials: options.materials }),
    ...(options.configurations === undefined
      ? {}
      : { configurations: options.configurations }),
    ...(Object.keys(resources).length === 0 ? {} : { resources }),
    nodes: options.nodes,
    outputs: options.outputs,
  } as unknown as DesignDocumentV7;
}

const emptyTopology: KernelTopologySnapshot = {
  history: "complete",
  faces: [],
  edges: [],
  vertices: [],
};

const strongImportCapabilities = {
  protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  formats: [{ format: "step", unitModes: ["from-file"] }],
} as const;

const strongStepExportCapabilities = {
  protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
  schema: "AP214IS",
  byteDeterminism: "same-shape-representation-and-metadata",
  maxOutputBytes: 1_048_576,
  maxMetadataBytes: 1_024,
} as const;

interface FakeShape extends KernelShape {
  readonly serial: number;
  readonly source:
    | KernelPrimitive
    | "imported"
    | "transformed"
    | "boolean";
  readonly feature: string;
}

interface PrimitiveCall {
  readonly kind: KernelPrimitive;
  readonly arguments: readonly unknown[];
  readonly context: KernelFeatureContext | undefined;
  readonly shape: FakeShape;
}

interface ImportCall {
  readonly bytes: Uint8Array;
  readonly options: KernelDocumentBodyImportOptions;
  readonly context: KernelFeatureContext | undefined;
  readonly shape: FakeShape;
}

interface TransformCall {
  readonly input: FakeShape;
  readonly operations: readonly ResolvedTransformOperation[];
  readonly context: KernelFeatureContext | undefined;
  readonly shape: FakeShape;
}

interface BooleanCall {
  readonly operation: "union" | "subtract" | "intersect";
  readonly target: FakeShape;
  readonly tools: readonly FakeShape[];
  readonly context: KernelFeatureContext | undefined;
  readonly shape: FakeShape;
}

interface KernelHarness {
  readonly kernel: GeometryKernel;
  readonly primitiveCalls: PrimitiveCall[];
  readonly importCalls: ImportCall[];
  readonly transformCalls: TransformCall[];
  readonly booleanCalls: BooleanCall[];
  readonly disposed: FakeShape[];
  readonly live: ReadonlySet<FakeShape>;
  readonly disposeKernel: ReturnType<typeof vi.fn>;
}

interface KernelHarnessOptions {
  readonly representation?: "mesh" | "brep";
  readonly exact?: boolean;
  readonly stepExport?: KernelCapabilities["stepExport"];
  readonly primitiveHook?: (
    kind: KernelPrimitive,
    shape: FakeShape,
    callIndex: number,
  ) => KernelShape;
  readonly importHook?: (
    bytes: Uint8Array,
    options: KernelDocumentBodyImportOptions,
    context: KernelFeatureContext | undefined,
    shape: FakeShape,
    callIndex: number,
  ) => KernelShape;
  readonly transformHook?: (
    input: FakeShape,
    operations: readonly ResolvedTransformOperation[],
    context: KernelFeatureContext | undefined,
    shape: FakeShape,
    callIndex: number,
  ) => KernelShape;
  readonly booleanHook?: (
    operation: BooleanCall["operation"],
    target: FakeShape,
    tools: readonly FakeShape[],
    context: KernelFeatureContext | undefined,
    shape: FakeShape,
    callIndex: number,
  ) => KernelShape;
  readonly statusHook?: (
    shape: FakeShape,
  ) => ReturnType<GeometryKernel["status"]>;
  readonly measureHook?: (
    shape: FakeShape,
    calls: readonly PrimitiveCall[],
  ) => ShapeMeasurements;
  readonly exportHook?: (
    shape: FakeShape,
    format: string,
    context: KernelShapeExportContext | undefined,
  ) => Uint8Array;
  readonly disposeHook?: (shape: FakeShape, callIndex: number) => void;
}

function boxMeasurements(
  size: readonly [number, number, number],
): ShapeMeasurements {
  const [x, y, z] = size;
  const volume = x * y * z;
  return {
    volume,
    surfaceArea: 2 * (x * y + x * z + y * z),
    boundingBox: { min: [0, 0, 0], max: [x, y, z] },
    centerOfMass: [x / 2, y / 2, z / 2],
    inertiaTensor: [
      [(volume * (y * y + z * z)) / 12, 0, 0],
      [0, (volume * (x * x + z * z)) / 12, 0],
      [0, 0, (volume * (x * x + y * y)) / 12],
    ],
    genus: 0,
    tolerance: 1e-7,
  };
}

function defaultMeasurements(
  shape: FakeShape,
  calls: readonly PrimitiveCall[],
): ShapeMeasurements {
  const call = calls.find((candidate) => candidate.shape === shape);
  if (call?.kind === "box") {
    return boxMeasurements(
      call.arguments[0] as readonly [number, number, number],
    );
  }
  if (call?.kind === "sphere") {
    const radius = call.arguments[0] as number;
    const volume = (4 / 3) * Math.PI * radius ** 3;
    const moment = (2 / 5) * volume * radius ** 2;
    return {
      volume,
      surfaceArea: 4 * Math.PI * radius ** 2,
      boundingBox: {
        min: [-radius, -radius, -radius],
        max: [radius, radius, radius],
      },
      centerOfMass: [0, 0, 0],
      inertiaTensor: [
        [moment, 0, 0],
        [0, moment, 0],
        [0, 0, moment],
      ],
      genus: 0,
      tolerance: 1e-7,
    };
  }
  return boxMeasurements([2, 3, 4]);
}

function createKernelHarness(
  options: KernelHarnessOptions = {},
): KernelHarness {
  const primitiveCalls: PrimitiveCall[] = [];
  const importCalls: ImportCall[] = [];
  const transformCalls: TransformCall[] = [];
  const booleanCalls: BooleanCall[] = [];
  const disposed: FakeShape[] = [];
  const live = new Set<FakeShape>();
  const disposeKernel = vi.fn();
  let serial = 0;

  const acquire = (
    source: FakeShape["source"],
    context: KernelFeatureContext | undefined,
    hook: (shape: FakeShape) => KernelShape,
  ): KernelShape => {
    const shape: FakeShape = {
      kernel: "document-v7-part-test",
      serial: serial++,
      source,
      feature: context?.feature ?? "<unknown>",
    };
    live.add(shape);
    try {
      const returned = hook(shape);
      if (returned !== shape) live.delete(shape);
      return returned;
    } catch (error) {
      live.delete(shape);
      throw error;
    }
  };

  const primitiveMethod = (
    kind: KernelPrimitive,
  ): NonNullable<GeometryKernel[KernelPrimitive]> =>
    ((...arguments_: unknown[]): KernelShape => {
      const context = arguments_.at(-1) as KernelFeatureContext | undefined;
      return acquire(kind, context, (shape) => {
        primitiveCalls.push({
          kind,
          arguments: arguments_.slice(0, -1),
          context,
          shape,
        });
        return options.primitiveHook?.(
          kind,
          shape,
          primitiveCalls.length - 1,
        ) ?? shape;
      });
    }) as NonNullable<GeometryKernel[KernelPrimitive]>;

  const capabilities: KernelCapabilities = {
    protocolVersion: 1,
    representation: options.representation ?? "brep",
    exact: options.exact ?? true,
    primitives: ["box", "cylinder", "sphere"],
    features: ["transform", "boolean"],
    nativeImports: [],
    nativeExports: ["step", "brep", "brep-binary"],
    topology: {
      kinds: ["face", "edge", "vertex"],
      provenance: "feature",
      semanticRoles: true,
      sketchSources: true,
      geometry: true,
      adjacency: true,
    },
    documentBodyImport: strongImportCapabilities,
    ...(options.stepExport === undefined
      ? {}
      : { stepExport: options.stepExport }),
  };

  const kernel: GeometryKernel = {
    id: "document-v7-part-test",
    capabilities,
    box: primitiveMethod("box") as NonNullable<GeometryKernel["box"]>,
    cylinder: primitiveMethod("cylinder") as NonNullable<
      GeometryKernel["cylinder"]
    >,
    sphere: primitiveMethod("sphere") as NonNullable<
      GeometryKernel["sphere"]
    >,
    importDocumentBody: (
      bytes: Uint8Array,
      importOptions: KernelDocumentBodyImportOptions,
      context?: KernelFeatureContext,
    ): KernelShape =>
      acquire("imported", context, (shape) => {
        importCalls.push({
          bytes: bytes.slice(),
          options: importOptions,
          context,
          shape,
        });
        return options.importHook?.(
          bytes,
          importOptions,
          context,
          shape,
          importCalls.length - 1,
        ) ?? shape;
      }),
    transform: (
      input: KernelShape,
      operations: readonly ResolvedTransformOperation[],
      context?: KernelFeatureContext,
    ): KernelShape =>
      acquire("transformed", context, (shape) => {
        transformCalls.push({
          input: input as FakeShape,
          operations,
          context,
          shape,
        });
        return options.transformHook?.(
          input as FakeShape,
          operations,
          context,
          shape,
          transformCalls.length - 1,
        ) ?? shape;
      }),
    boolean: (
      operation: BooleanCall["operation"],
      target: KernelShape,
      tools: readonly KernelShape[],
      context?: KernelFeatureContext,
    ): KernelShape =>
      acquire("boolean", context, (shape) => {
        const capturedTools = tools as readonly FakeShape[];
        booleanCalls.push({
          operation,
          target: target as FakeShape,
          tools: capturedTools,
          context,
          shape,
        });
        return options.booleanHook?.(
          operation,
          target as FakeShape,
          capturedTools,
          context,
          shape,
          booleanCalls.length - 1,
        ) ?? shape;
      }),
    mesh: (shape: KernelShape): MeshData => {
      const candidate = shape as FakeShape;
      return {
        positions: new Float32Array([
          candidate.serial * 10,
          0,
          0,
          candidate.serial * 10 + 1,
          0,
          0,
          candidate.serial * 10,
          1,
          0,
        ]),
        indices: new Uint32Array([0, 1, 2]),
      };
    },
    measure: (shape: KernelShape): ShapeMeasurements =>
      options.measureHook?.(shape as FakeShape, primitiveCalls) ??
      defaultMeasurements(shape as FakeShape, primitiveCalls),
    status: (shape: KernelShape) =>
      options.statusHook?.(shape as FakeShape) ?? {
        ok: true,
        code: "VALID",
      },
    topology: () => emptyTopology,
    exportShape: (
      shape: KernelShape,
      format,
      context,
    ): Uint8Array =>
      options.exportHook?.(
        shape as FakeShape,
        format,
        context,
      ) ?? encoder.encode(`${format}:${(shape as FakeShape).serial}`),
    disposeShape: (shape: KernelShape): void => {
      const candidate = shape as FakeShape;
      if (!live.delete(candidate)) {
        throw new Error(`Shape ${candidate.serial} was disposed more than once`);
      }
      disposed.push(candidate);
      options.disposeHook?.(candidate, disposed.length - 1);
    },
    dispose: disposeKernel,
  };

  return {
    kernel,
    primitiveCalls,
    importCalls,
    transformCalls,
    booleanCalls,
    disposed,
    live,
    disposeKernel,
  };
}

function resolverFor(
  resources: Readonly<Record<string, Uint8Array>>,
  requests: ResourceResolverRequestV7[],
): (request: ResourceResolverRequestV7) => Uint8Array {
  return (request) => {
    requests.push(request);
    const bytes = resources[request.id];
    if (bytes === undefined) throw new Error(`Missing '${request.id}'`);
    return bytes;
  };
}

function expectFailureCode(
  result: {
    readonly ok: boolean;
    readonly diagnostics: readonly { readonly code: string }[];
  },
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code })]),
  );
}

function expectPartResult(
  result: Awaited<ReturnType<typeof evaluatePartOutputsV7>>,
): EvaluatedPartDesignV7 {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected staged part evaluation to succeed");
  return result.value;
}

describe("staged document-v7 part output evaluation", () => {
  it("prepares resource scope and aggregate metrics without resolver or kernel work", async () => {
    const aBytes = encoder.encode("resource-a");
    const zBytes = encoder.encode("resource-z");
    const document = await partDocument({
      resources: { zResource: zBytes, aResource: aBytes },
      materials: {
        aluminum: {
          name: "Aluminum",
          massDensity: density(2.7e-6),
        },
      },
      nodes: {
        zLeaf: importedBody("zResource"),
        aLeaf: importedBody("aResource"),
        bodies: bodySet([
          member("z", "zLeaf"),
          member("a", "aLeaf"),
        ]),
        preparedPart: part("bodies", "bodySet", {
          materialId: "aluminum" as never,
        }),
      },
      outputs: {
        prepared: { node: "preparedPart", kind: "part" },
      },
    });
    const requests: ResourceResolverRequestV7[] = [];
    const resolver = vi.fn(
      resolverFor(
        { aResource: aBytes, zResource: zBytes },
        requests,
      ),
    );

    const prepared = preparePartOutputsV7(document, { resolver });
    expect(prepared.ok, JSON.stringify(prepared.diagnostics)).toBe(true);
    if (!prepared.ok) return;
    expect(resolver).not.toHaveBeenCalled();
    expect(prepared.value.resourceIds).toEqual([
      "aResource",
      "zResource",
    ]);
    expect(Object.isFrozen(prepared.value.resourceIds)).toBe(true);
    expect(prepared.value.metrics).toEqual({
      selectedOutputs: 1,
      partBodies: 2,
      distinctSolids: 2,
      solidGraphNodes: 2,
      solidDependencyLinks: 0,
      transformOperations: 0,
      resolvedMaterials: 1,
    });
    expect(Object.isFrozen(prepared.value.metrics)).toBe(true);
    expect(Object.isFrozen(prepared.value)).toBe(true);

    const harness = createKernelHarness();
    const retained = preflightPreparedPartOutputsV7(
      harness.kernel,
      prepared.value,
    );
    expect(retained.ok, JSON.stringify(retained.diagnostics)).toBe(true);
    if (!retained.ok) return;
    expect(resolver).not.toHaveBeenCalled();
    expect(harness.importCalls).toHaveLength(0);

    const resources = await resolveResourcesV7(
      document.resources ?? {},
      prepared.value.resourceIds,
      { resolver },
    );
    expect(resources.ok, JSON.stringify(resources.diagnostics)).toBe(true);
    if (!resources.ok) return;
    expect(requests.map(({ id }) => id)).toEqual([
      "aResource",
      "zResource",
    ]);
    const resolverCallsBeforeExecute = resolver.mock.calls.length;

    const executed = await executePreparedPartOutputsV7(
      harness.kernel,
      prepared.value,
      retained.value,
      resources.value,
    );
    expect(executed.ok, JSON.stringify(executed.diagnostics)).toBe(true);
    if (!executed.ok) return;
    expect(resolver).toHaveBeenCalledTimes(resolverCallsBeforeExecute);
    expect(executed.value.outputNames).toEqual(["prepared"]);
    expect(
      executed.value.output("prepared").geometry.kind,
    ).toBe("bodySet");
    executed.value.dispose();
    expect(harness.importCalls).toHaveLength(2);
    expect(harness.live.size).toBe(0);
  });

  it("retains each stateful kernel property before direct resource I/O", async () => {
    const bytes = encoder.encode("stateful-kernel-boundary");
    const document = await partDocument({
      resources: { imported: bytes },
      nodes: {
        imported: importedBody("imported"),
        tool: box(),
        shifted: transform("tool", [
          {
            kind: "translate",
            value: [length(1), length(0), length(0)],
          },
        ]),
        cut: booleanSolid("subtract", "imported", ["shifted"]),
        part: part("cut", "solid"),
      },
      outputs: { part: { node: "part", kind: "part" } },
    });
    const harness = createKernelHarness();
    const events: string[] = [];
    const reads = new Map<PropertyKey, number>();
    const kernel = new Proxy(harness.kernel, {
      get(target, property, receiver) {
        reads.set(property, (reads.get(property) ?? 0) + 1);
        events.push(`get:${String(property)}`);
        return Reflect.get(target, property, receiver);
      },
    });
    const resolver = vi.fn((request: ResourceResolverRequestV7) => {
      events.push(`resolve:${request.id}`);
      return bytes;
    });

    const result = await evaluatePartOutputsV7(kernel, document, {
      resolver,
    });
    const evaluated = expectPartResult(result);
    const requiredReads = [
      "id",
      "capabilities",
      "box",
      "importDocumentBody",
      "transform",
      "boolean",
      "status",
      "measure",
      "mesh",
      "topology",
      "exportShape",
      "disposeShape",
    ] as const;
    for (let index = 0; index < requiredReads.length; index += 1) {
      expect(reads.get(requiredReads[index]!)).toBe(1);
    }
    const resolverIndex = events.indexOf("resolve:imported");
    expect(resolverIndex).toBeGreaterThan(-1);
    expect(
      events.slice(resolverIndex + 1).some((event) =>
        event.startsWith("get:"),
      ),
    ).toBe(false);
    const readsAfterEvaluation = new Map(reads);
    const output = evaluated.output("part");
    if (output.geometry.kind === "solid") {
      output.geometry.solid.measure();
    }
    evaluated.dispose();
    expect(reads).toEqual(readsAfterEvaluation);
    expect(harness.live.size).toBe(0);
  });

  it("rejects forged or mismatched prepared pipeline handles before construction", async () => {
    const document = await partDocument({
      nodes: {
        leaf: box(),
        part: part("leaf", "solid"),
      },
      outputs: { part: { node: "part", kind: "part" } },
    });
    const harness = createKernelHarness();
    const forgedPrepared = preflightPreparedPartOutputsV7(
      harness.kernel,
      Object.freeze({}) as never,
    );
    expectFailureCode(forgedPrepared, "IR_INVALID");
    expect(harness.primitiveCalls).toHaveLength(0);

    const prepared = preparePartOutputsV7(document);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const retained = preflightPreparedPartOutputsV7(
      harness.kernel,
      prepared.value,
    );
    expect(retained.ok).toBe(true);
    if (!retained.ok) return;

    const forgedAccess = await executePreparedPartOutputsV7(
      harness.kernel,
      prepared.value,
      Object.freeze({}) as never,
    );
    expectFailureCode(forgedAccess, "IR_INVALID");
    expect(harness.primitiveCalls).toHaveLength(0);

    const otherHarness = createKernelHarness();
    const mismatchedKernel = await executePreparedPartOutputsV7(
      otherHarness.kernel,
      prepared.value,
      retained.value,
    );
    expectFailureCode(mismatchedKernel, "IR_INVALID");
    expect(otherHarness.primitiveCalls).toHaveLength(0);
  });

  it("rejects opaque external-assembly part handles without observing them", () => {
    let nodeReads = 0;
    const forged = Object.create(null, {
      node: {
        enumerable: true,
        get(): never {
          nodeReads += 1;
          throw Symbol("hostile evaluated part node");
        },
      },
    });
    const rejected = createExternalAssemblyPartViewV7(
      forged as EvaluatedPartV7,
      "module",
      "part" as never,
    );
    expectFailureCode(rejected, "IR_INVALID");
    expect(rejected.diagnostics[0]?.details).toMatchObject({
      partOwner: false,
      outputIsString: true,
      childPartNodeIsString: true,
    });
    expect(nodeReads).toBe(0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const opaque = createExternalAssemblyPartViewV7(
      revoked.proxy as EvaluatedPartV7,
      "module",
      "part" as never,
    );
    expectFailureCode(opaque, "IR_INVALID");
    expect(opaque.diagnostics[0]?.details).toMatchObject({
      partOwner: false,
    });
  });

  it("rejects cross-batch shape aliases without disposing earlier ownership", async () => {
    let firstOwnedShape: KernelShape | undefined;
    const harness = createKernelHarness({
      primitiveHook: (_kind, shape, callIndex) => {
        if (callIndex === 0) {
          firstOwnedShape = shape;
          return shape;
        }
        return callIndex === 2 ? firstOwnedShape! : shape;
      },
    });
    const firstDocument = await partDocument({
      nodes: {
        leaf: box(),
        part: part("leaf", "solid"),
      },
      outputs: { part: { node: "part", kind: "part" } },
    });
    const secondDocument = await partDocument({
      nodes: {
        aLeaf: box(),
        zLeaf: box(),
        bodies: bodySet([
          member("a", "aLeaf"),
          member("z", "zLeaf"),
        ]),
        part: part("bodies", "bodySet"),
      },
      outputs: { part: { node: "part", kind: "part" } },
    });
    const firstPrepared = preparePartOutputsV7(firstDocument);
    const secondPrepared = preparePartOutputsV7(secondDocument);
    expect(firstPrepared.ok).toBe(true);
    expect(secondPrepared.ok).toBe(true);
    if (!firstPrepared.ok || !secondPrepared.ok) return;
    const firstAccess = preflightPreparedPartOutputsV7(
      harness.kernel,
      firstPrepared.value,
    );
    const secondAccess = preflightPreparedPartOutputsV7(
      harness.kernel,
      secondPrepared.value,
    );
    expect(firstAccess.ok).toBe(true);
    expect(secondAccess.ok).toBe(true);
    if (!firstAccess.ok || !secondAccess.ok) return;
    const transaction =
      createPreparedPartShapeOwnershipTransactionV7(harness.kernel);
    expect(transaction.ok).toBe(true);
    if (!transaction.ok) return;

    const first = await executePreparedPartOutputsV7(
      harness.kernel,
      firstPrepared.value,
      firstAccess.value,
      undefined,
      transaction.value,
    );
    expect(first.ok, JSON.stringify(first.diagnostics)).toBe(true);
    if (!first.ok) return;
    expect(harness.live.size).toBe(1);

    const second = await executePreparedPartOutputsV7(
      harness.kernel,
      secondPrepared.value,
      secondAccess.value,
      undefined,
      transaction.value,
    );
    expectFailureCode(second, "KERNEL_ERROR");
    expect(second.diagnostics[0]).toMatchObject({
      details: {
        protocolViolation: true,
        crossBatchShapeOwnership: true,
      },
    });
    expect(harness.disposed).toHaveLength(1);
    expect(harness.disposed[0]?.feature).toBe("aLeaf");
    expect(harness.live).toEqual(new Set([firstOwnedShape]));
    const retainedPart = first.value.output("part");
    if (retainedPart.geometry.kind === "solid") {
      expect(retainedPart.geometry.solid.measure().volume).toBe(24);
    }

    first.value.dispose();
    expect(harness.disposed).toHaveLength(2);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("rejects forged and wrong-kernel shape-ownership transactions before construction", async () => {
    const document = await partDocument({
      nodes: {
        leaf: box(),
        part: part("leaf", "solid"),
      },
      outputs: { part: { node: "part", kind: "part" } },
    });
    const harness = createKernelHarness();
    const prepared = preparePartOutputsV7(document);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const retained = preflightPreparedPartOutputsV7(
      harness.kernel,
      prepared.value,
    );
    expect(retained.ok).toBe(true);
    if (!retained.ok) return;

    const forged = await executePreparedPartOutputsV7(
      harness.kernel,
      prepared.value,
      retained.value,
      undefined,
      Object.freeze({}) as never,
    );
    expectFailureCode(forged, "IR_INVALID");
    expect(forged.diagnostics[0]?.details).toMatchObject({
      shapeOwnershipTransactionOwner: false,
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const opaque = await executePreparedPartOutputsV7(
      harness.kernel,
      prepared.value,
      retained.value,
      undefined,
      revoked.proxy as never,
    );
    expectFailureCode(opaque, "IR_INVALID");
    expect(opaque.diagnostics[0]?.details).toMatchObject({
      shapeOwnershipTransactionOwner: false,
    });

    const otherHarness = createKernelHarness();
    const otherTransaction =
      createPreparedPartShapeOwnershipTransactionV7(
        otherHarness.kernel,
      );
    expect(otherTransaction.ok).toBe(true);
    if (!otherTransaction.ok) return;
    const wrongKernel = await executePreparedPartOutputsV7(
      harness.kernel,
      prepared.value,
      retained.value,
      undefined,
      otherTransaction.value,
    );
    expectFailureCode(wrongKernel, "IR_INVALID");
    expect(wrongKernel.diagnostics[0]?.details).toMatchObject({
      shapeOwnershipTransactionOwner: true,
      shapeOwnershipTransactionKernelMatches: false,
    });
    expect(harness.primitiveCalls).toHaveLength(0);
    expect(otherHarness.primitiveCalls).toHaveLength(0);
  });

  it("selects direct parts in caller order, deduplicates aliases, and preserves detached identity", async () => {
    const metadata = { revision: 2, nested: { finish: "ground" } };
    const document = await partDocument({
      nodes: {
        leaf: box(),
        bodies: bodySet([
          member("first", "leaf", {
            name: "First body",
            metadata: { role: "primary" },
          }),
          member("alias", "leaf"),
        ]),
        singlePart: part("leaf", "solid", {
          partNumber: "P-001",
          description: "Single solid",
          material: "Legacy alloy",
          massDensity: density(1e-6),
          metadata: metadata as never,
        }),
        multiPart: part("bodies", "bodySet", {
          partNumber: "P-002",
          description: "Multibody",
          massDensity: density(2e-6),
        }),
      },
      outputs: {
        zeta: { node: "singlePart", kind: "part" },
        alpha: { node: "multiPart", kind: "part" },
        alias: { node: "singlePart", kind: "part" },
      },
    });
    const harness = createKernelHarness();
    const result = await evaluatePartOutputsV7(harness.kernel, document, {
      outputs: ["alpha", "zeta", "alpha", "alias"],
    });
    const evaluated = expectPartResult(result);
    try {
      expect(evaluated.outputNames).toEqual(["alpha", "zeta", "alias"]);
      expect(Object.isFrozen(evaluated.outputNames)).toBe(true);
      expect(evaluated.configurationId).toBeNull();
      expect(evaluated.parameters).toEqual({});

      const single = evaluated.output("zeta");
      const alias = evaluated.output("alias");
      const multi = evaluated.output("alpha");
      expect(single).toBeInstanceOf(EvaluatedPartV7);
      expect(single).not.toBe(alias);
      expect(Object.isFrozen(single)).toBe(true);
      expect(single).toMatchObject({
        name: "zeta",
        node: "singlePart",
        partNumber: "P-001",
        description: "Single solid",
        material: "Legacy alloy",
        materialId: undefined,
        massDensity: 1e-6,
        massDensitySource: "part",
        representation: "brep",
        exact: true,
      });
      expect(Reflect.set(single, "massDensity", 999)).toBe(false);
      expect(single.metadata).toEqual(metadata);
      expect(Object.isFrozen(single.metadata)).toBe(true);
      expect(Object.isFrozen(
        (single.metadata as { readonly nested: object }).nested,
      )).toBe(true);
      metadata.revision = 99;
      metadata.nested.finish = "mutated";
      expect(single.metadata).toEqual({
        revision: 2,
        nested: { finish: "ground" },
      });

      expect(single.geometry).toMatchObject({
        kind: "solid",
        node: "leaf",
      });
      expect(Object.isFrozen(single.geometry)).toBe(true);
      if (single.geometry.kind === "solid") {
        expect(single.geometry.solid.measure().volume).toBe(24);
      }
      expect(multi.geometry).toMatchObject({
        kind: "bodySet",
        node: "bodies",
      });
      if (multi.geometry.kind === "bodySet") {
        expect(multi.geometry.bodySet.bodyIds).toEqual(["first", "alias"]);
        expect(multi.geometry.bodySet.body("first")).toMatchObject({
          node: "leaf",
          name: "First body",
          metadata: { role: "primary" },
        });
      }
      expect(harness.primitiveCalls).toHaveLength(1);
      expect(single.mesh().indices).toHaveLength(3);
      expect(multi.mesh().indices).toHaveLength(6);
      expect(single.export("obj")).toContain("o zeta");
      expect(multi.export("stl")).toBeInstanceOf(Uint8Array);
      expect(() =>
        (
          single.export as unknown as (format: string) => Uint8Array
        )("step"),
      ).toThrow(/unsupported|exact|mesh/i);
      expect(() => evaluated.output("missing")).toThrow(/unknown.*part.*output/i);
    } finally {
      evaluated.dispose();
      evaluated.dispose();
    }
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("rejects non-part outputs before kernel work", async () => {
    const nonPart = await partDocument({
      nodes: { leaf: box() },
      outputs: { leaf: { node: "leaf", kind: "solid" } },
    });
    const nonPartHarness = createKernelHarness();
    const nonPartResult = await evaluatePartOutputsV7(
      nonPartHarness.kernel,
      nonPart,
    );
    expectFailureCode(nonPartResult, "EVALUATION_UNSUPPORTED");
    expect(nonPartHarness.primitiveCalls).toHaveLength(0);
  });

  it("shares transformed solid graphs across solid and multibody parts", async () => {
    const document = await partDocument({
      parameters: {
        offset: {
          dimension: "length",
          default: length(2),
        },
      },
      configurations: {
        shifted: {
          parameterOverrides: {
            offset: length(5),
          } as never,
        },
      },
      nodes: {
        leaf: box(),
        translated: transform("leaf", [
          {
            kind: "translate",
            value: [lengthParameter("offset"), length(1), length(0)],
          },
        ]),
        scaled: transform("translated", [
          {
            kind: "scale",
            value: [scalar(2), scalar(3), scalar(4)],
          },
        ]),
        transformedBodies: bodySet([
          member("translated", "translated"),
          member("scaled-a", "scaled"),
          member("scaled-b", "scaled"),
        ]),
        solidPart: part("scaled", "solid", {
          partNumber: "TRANSFORMED-SOLID",
        }),
        multibodyPart: part("transformedBodies", "bodySet", {
          partNumber: "TRANSFORMED-MULTIBODY",
        }),
      },
      outputs: {
        solid: { node: "solidPart", kind: "part" },
        multibody: { node: "multibodyPart", kind: "part" },
        alias: { node: "solidPart", kind: "part" },
      },
    });
    const harness = createKernelHarness();
    const result = await evaluatePartOutputsV7(harness.kernel, document, {
      configuration: "shifted",
      parameters: { offset: 8 },
      outputs: ["multibody", "solid", "alias"],
    });
    const evaluated = expectPartResult(result);
    try {
      expect(evaluated.configurationId).toBe("shifted");
      expect(evaluated.parameters).toEqual({ offset: 8 });
      expect(evaluated.outputNames).toEqual(["multibody", "solid", "alias"]);
      expect(harness.primitiveCalls).toHaveLength(1);
      expect(harness.transformCalls).toHaveLength(2);
      expect(harness.transformCalls[0]).toMatchObject({
        input: { serial: 0, feature: "leaf" },
        operations: [
          {
            kind: "translate",
            value: [8, 1, 0],
          },
        ],
        context: { feature: "translated" },
        shape: { serial: 1, feature: "translated" },
      });
      expect(harness.transformCalls[1]).toMatchObject({
        input: { serial: 1, feature: "translated" },
        operations: [
          {
            kind: "scale",
            value: [2, 3, 4],
          },
        ],
        context: { feature: "scaled" },
        shape: { serial: 2, feature: "scaled" },
      });

      const solid = evaluated.output("solid");
      expect(solid.geometry).toMatchObject({
        kind: "solid",
        node: "scaled",
      });
      const multibody = evaluated.output("multibody");
      expect(multibody.geometry).toMatchObject({
        kind: "bodySet",
        node: "transformedBodies",
      });
      if (multibody.geometry.kind === "bodySet") {
        expect(multibody.geometry.bodySet.bodyIds).toEqual([
          "translated",
          "scaled-a",
          "scaled-b",
        ]);
        expect(
          multibody.geometry.bodySet.body("scaled-a").solid.measure(),
        ).toEqual(
          multibody.geometry.bodySet.body("scaled-b").solid.measure(),
        );
      }
    } finally {
      evaluated.dispose();
    }
    expect(harness.disposed.map(({ serial }) => serial).sort()).toEqual([
      0, 1, 2,
    ]);
    expect(harness.live.size).toBe(0);
  });

  it("shares configured imported-leaf Boolean graphs across solid and multibody parts", async () => {
    const bytes = encoder.encode("configured-imported-boolean");
    const document = await partDocument({
      resources: { imported: bytes },
      parameters: {
        toolWidth: {
          dimension: "length",
          default: length(2),
        },
      },
      configurations: {
        wideTool: {
          parameterOverrides: {
            toolWidth: length(6),
          } as never,
        },
      },
      nodes: {
        imported: importedBody("imported"),
        tool: box([
          lengthParameter("toolWidth"),
          length(3),
          length(4),
        ]),
        cut: booleanSolid("subtract", "imported", ["tool"]),
        booleanBodies: bodySet([
          member("cut-a", "cut"),
          member("source", "imported"),
          member("cut-b", "cut"),
        ]),
        solidPart: part("cut", "solid", {
          partNumber: "BOOLEAN-SOLID",
        }),
        multibodyPart: part("booleanBodies", "bodySet", {
          partNumber: "BOOLEAN-MULTIBODY",
        }),
      },
      outputs: {
        solid: { node: "solidPart", kind: "part" },
        multibody: { node: "multibodyPart", kind: "part" },
        alias: { node: "solidPart", kind: "part" },
      },
    });
    const requests: ResourceResolverRequestV7[] = [];
    const harness = createKernelHarness();
    const result = await evaluatePartOutputsV7(harness.kernel, document, {
      configuration: "wideTool",
      parameters: { toolWidth: 8 },
      outputs: ["multibody", "solid", "alias"],
      resolver: resolverFor({ imported: bytes }, requests),
    });
    const evaluated = expectPartResult(result);
    try {
      expect(evaluated.configurationId).toBe("wideTool");
      expect(evaluated.parameters).toEqual({ toolWidth: 8 });
      expect(evaluated.outputNames).toEqual([
        "multibody",
        "solid",
        "alias",
      ]);
      expect(requests).toHaveLength(1);
      expect(harness.importCalls).toHaveLength(1);
      expect(harness.primitiveCalls).toHaveLength(1);
      expect(harness.primitiveCalls[0]).toMatchObject({
        kind: "box",
        arguments: [[8, 3, 4], false],
        context: { feature: "tool" },
      });
      expect(harness.booleanCalls).toHaveLength(1);
      expect(harness.booleanCalls[0]).toMatchObject({
        operation: "subtract",
        target: harness.importCalls[0]!.shape,
        tools: [harness.primitiveCalls[0]!.shape],
        context: { feature: "cut" },
      });

      const solid = evaluated.output("solid");
      expect(solid.geometry).toMatchObject({ kind: "solid", node: "cut" });
      const multibody = evaluated.output("multibody");
      expect(multibody.geometry).toMatchObject({
        kind: "bodySet",
        node: "booleanBodies",
      });
      if (multibody.geometry.kind === "bodySet") {
        expect(multibody.geometry.bodySet.bodyIds).toEqual([
          "cut-a",
          "source",
          "cut-b",
        ]);
        expect(
          multibody.geometry.bodySet.body("cut-a").solid.measure(),
        ).toEqual(
          multibody.geometry.bodySet.body("cut-b").solid.measure(),
        );
      }
    } finally {
      evaluated.dispose();
    }
    expect(harness.disposed).toHaveLength(3);
    expect(new Set(harness.disposed).size).toBe(3);
    expect(harness.live.size).toBe(0);
  });

  it("keeps shared kernel-boundary diagnostics part-specific", async () => {
    const document = await partDocument({
      nodes: {
        leaf: box(),
        evaluatedPart: part("leaf", "solid"),
      },
      outputs: {
        evaluatedPart: { node: "evaluatedPart", kind: "part" },
      },
    });

    const capabilityHarness = createKernelHarness();
    const capabilityKernel: GeometryKernel = {
      ...capabilityHarness.kernel,
      capabilities: {
        ...capabilityHarness.kernel.capabilities,
        primitives: ["sphere"],
      },
    };
    const capabilityResult = await evaluatePartOutputsV7(
      capabilityKernel,
      document,
    );
    expectFailureCode(capabilityResult, "KERNEL_CAPABILITY_MISSING");
    expect(capabilityResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          details: expect.objectContaining({
            phase: "documentV7PartEvaluation",
          }),
        }),
      ]),
    );
    expect(capabilityHarness.primitiveCalls).toHaveLength(0);

    const protocolHarness = createKernelHarness();
    const protocolKernel: GeometryKernel = {
      ...protocolHarness.kernel,
      capabilities: {
        ...protocolHarness.kernel.capabilities,
        protocolVersion:
          999 as unknown as KernelCapabilities["protocolVersion"],
      },
    };
    const protocolResult = await evaluatePartOutputsV7(
      protocolKernel,
      document,
    );
    expectFailureCode(protocolResult, "KERNEL_CAPABILITY_MISSING");
    expect(protocolResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          details: expect.objectContaining({
            phase: "documentV7PartEvaluation",
          }),
        }),
      ]),
    );
    expect(protocolHarness.primitiveCalls).toHaveLength(0);

    const statusHarness = createKernelHarness({
      statusHook: () =>
        ({
          ok: "yes",
          code: "VALID",
        }) as unknown as ReturnType<GeometryKernel["status"]>,
    });
    const statusResult = await evaluatePartOutputsV7(
      statusHarness.kernel,
      document,
    );
    expectFailureCode(statusResult, "KERNEL_ERROR");
    expect(statusResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "KERNEL_ERROR",
          message: expect.stringMatching(
            /malformed status for part solid 'leaf'/,
          ),
          details: expect.objectContaining({
            phase: "documentV7PartEvaluation",
          }),
        }),
      ]),
    );
    expect(statusHarness.disposed).toHaveLength(1);
    expect(statusHarness.live.size).toBe(0);
  });

  it("resolves configuration, caller parameters, material overrides, and explicit-density precedence", async () => {
    const document = await partDocument({
      parameters: {
        width: {
          dimension: "length",
          default: length(2),
          min: length(1),
          max: length(20),
        },
        rho: {
          dimension: "massDensity",
          default: density(2e-6),
          min: density(1e-9),
          max: density(1e-3),
        },
      },
      materials: {
        light: {
          name: "Light",
          massDensity: density(1e-6),
          metadata: { family: "baseline" },
        },
        heavy: {
          name: "Heavy",
          massDensity: densityParameter("rho"),
          metadata: { family: "configured" },
        },
      },
      configurations: {
        performance: {
          parameterOverrides: {
            width: length(4),
            rho: density(3e-6),
          } as never,
          partMaterialOverrides: {
            inheritedPart: "heavy",
            explicitPart: "heavy",
          } as never,
        },
      },
      nodes: {
        leaf: box([
          lengthParameter("width"),
          length(3),
          length(4),
        ]),
        inheritedPart: part("leaf", "solid", {
          partNumber: "INHERITED",
          materialId: "light" as never,
        }),
        explicitPart: part("leaf", "solid", {
          partNumber: "EXPLICIT",
          materialId: "light" as never,
          massDensity: density(5e-6),
        }),
      },
      outputs: {
        inherited: { node: "inheritedPart", kind: "part" },
        explicit: { node: "explicitPart", kind: "part" },
      },
    });

    const cases = [
      {
        options: {},
        width: 2,
        rho: 2e-6,
        configuration: null,
        inheritedMaterial: "light",
        inheritedDensity: 1e-6,
      },
      {
        options: { configuration: "performance" },
        width: 4,
        rho: 3e-6,
        configuration: "performance",
        inheritedMaterial: "heavy",
        inheritedDensity: 3e-6,
      },
      {
        options: {
          configuration: "performance",
          parameters: { width: 6, rho: 4e-6 },
        },
        width: 6,
        rho: 4e-6,
        configuration: "performance",
        inheritedMaterial: "heavy",
        inheritedDensity: 4e-6,
      },
    ] as const;

    for (const testCase of cases) {
      const harness = createKernelHarness();
      const result = await evaluatePartOutputsV7(
        harness.kernel,
        document,
        testCase.options,
      );
      const evaluated = expectPartResult(result);
      try {
        expect(evaluated.configurationId).toBe(testCase.configuration);
        expect(evaluated.parameters).toMatchObject({
          width: testCase.width,
          rho: testCase.rho,
        });
        expect(harness.primitiveCalls).toHaveLength(1);
        expect(harness.primitiveCalls[0]!.arguments).toEqual([
          [testCase.width, 3, 4],
          false,
        ]);

        const inherited = evaluated.output("inherited");
        const explicit = evaluated.output("explicit");
        expect(inherited).toMatchObject({
          materialId: testCase.inheritedMaterial,
          materialName:
            testCase.inheritedMaterial === "light" ? "Light" : "Heavy",
          massDensity: testCase.inheritedDensity,
          massDensitySource: "material",
        });
        expect(Object.isFrozen(inherited.materialDefinition)).toBe(true);
        expect(explicit).toMatchObject({
          materialId:
            testCase.configuration === null ? "light" : "heavy",
          materialName:
            testCase.configuration === null ? "Light" : "Heavy",
          massDensity: 5e-6,
          massDensitySource: "part",
        });

        const volume = testCase.width * 3 * 4;
        const inheritedBom = inherited.billOfMaterials();
        expect(inheritedBom.ok).toBe(true);
        if (inheritedBom.ok) {
          expect(inheritedBom.value).toMatchObject({
            configurationId: testCase.configuration,
            totalQuantity: 1,
            massComplete: true,
            totalMass: volume * testCase.inheritedDensity,
            items: [
              expect.objectContaining({
                partNode: "inheritedPart",
                materialId: testCase.inheritedMaterial,
                quantity: 1,
                occurrenceIds: [],
                massDensitySource: "material",
                definitionMass: volume * testCase.inheritedDensity,
              }),
            ],
          });
        }
        const explicitPhysical = explicit.physicalMassProperties();
        expect(explicitPhysical.ok).toBe(true);
        if (explicitPhysical.ok) {
          expect(explicitPhysical.value.mass).toBeCloseTo(
            volume * 5e-6,
            15,
          );
        }
      } finally {
        evaluated.dispose();
      }
    }
  });

  it("evaluates an authored configured multibody part through the staged facade", async () => {
    const cad = stagedBodySetDesignV7("authored-part-evaluation");
    const width = cad.parameter.length("width", mm(2), {
      min: mm(1),
      max: mm(20),
    });
    const densityParameter = cad.parameter.massDensity(
      "density",
      kgPerCubicMillimeter(2e-6),
      {
        min: kgPerCubicMillimeter(1e-9),
        max: kgPerCubicMillimeter(1e-3),
      },
    );
    const light = cad.material("light", {
      name: "Light fixture",
      massDensity: kgPerCubicMillimeter(1e-6),
    });
    const configured = cad.material("configured", {
      name: "Configured fixture",
      massDensity: densityParameter,
      metadata: { family: "acceptance" },
    });
    const shared = cad.box("shared", {
      size: [width, mm(3), mm(4)],
    });
    const bodies = cad.bodySet("bodies", [
      {
        id: "primary",
        solid: shared,
        name: "Primary body",
        metadata: { role: "datum" },
      },
      {
        id: "alias",
        solid: shared,
        name: "Authored alias",
      },
    ]);
    const inherited = cad.part("inheritedPart", bodies, {
      partNumber: "AUTHORED-MULTI",
      description: "Configured multibody fixture",
      materialRef: light,
    });
    const explicit = cad.part("explicitPart", shared, {
      partNumber: "AUTHORED-EXPLICIT",
      materialRef: light,
      massDensity: kgPerCubicMillimeter(5e-6),
    });
    cad.configuration("performance", (configuration) =>
      configuration
        .parameter(width, mm(4))
        .parameter(
          densityParameter,
          kgPerCubicMillimeter(3e-6),
        )
        .partMaterial(inherited, configured)
        .partMaterial(explicit, configured),
    );
    cad.output("inherited", inherited);
    cad.output("explicit", explicit);

    const harness = createKernelHarness();
    const evaluated = expectPartResult(
      await evaluatePartOutputsV7(harness.kernel, cad.build(), {
        configuration: "performance",
        parameters: {
          width: 6,
          density: 4e-6,
        },
      }),
    );
    const inheritedOutput = evaluated.output("inherited");
    const explicitOutput = evaluated.output("explicit");
    let retained: EvaluatedSolid | undefined;
    try {
      expect(evaluated.configurationId).toBe("performance");
      expect(evaluated.parameters).toMatchObject({
        width: 6,
        density: 4e-6,
      });
      expect(harness.primitiveCalls).toHaveLength(1);
      expect(harness.primitiveCalls[0]).toMatchObject({
        kind: "box",
        arguments: [[6, 3, 4], false],
        context: { feature: "shared" },
      });

      expect(inheritedOutput).toMatchObject({
        node: "inheritedPart",
        partNumber: "AUTHORED-MULTI",
        materialId: "configured",
        materialName: "Configured fixture",
        massDensity: 4e-6,
        massDensitySource: "material",
      });
      expect(explicitOutput).toMatchObject({
        node: "explicitPart",
        partNumber: "AUTHORED-EXPLICIT",
        materialId: "configured",
        materialName: "Configured fixture",
        massDensity: 5e-6,
        massDensitySource: "part",
      });

      expect(inheritedOutput.geometry.kind).toBe("bodySet");
      if (inheritedOutput.geometry.kind !== "bodySet") {
        throw new Error("Expected an authored body-set part");
      }
      const evaluatedBodies = inheritedOutput.geometry.bodySet;
      retained = evaluatedBodies.body("primary").solid;
      expect(evaluatedBodies.bodyIds).toEqual(["primary", "alias"]);
      expect(evaluatedBodies.body("primary")).toMatchObject({
        id: "primary",
        node: "shared",
        name: "Primary body",
        metadata: { role: "datum" },
      });
      expect(evaluatedBodies.body("alias")).toMatchObject({
        id: "alias",
        node: "shared",
        name: "Authored alias",
      });
      expect(
        evaluatedBodies.body("primary").solid.measure().volume,
      ).toBe(72);
      expect(
        evaluatedBodies.body("alias").solid.measure().volume,
      ).toBe(72);

      const bom = inheritedOutput.billOfMaterials();
      expect(bom.ok).toBe(true);
      if (bom.ok) {
        expect(bom.value).toMatchObject({
          configurationId: "performance",
          totalQuantity: 1,
          massComplete: true,
          knownMass: expect.closeTo(576e-6, 15),
          totalMass: expect.closeTo(576e-6, 15),
          items: [
            expect.objectContaining({
              partNode: "inheritedPart",
              partNumber: "AUTHORED-MULTI",
              materialId: "configured",
              quantity: 1,
              massDensity: 4e-6,
              massDensitySource: "material",
              definitionMass: expect.closeTo(576e-6, 15),
              totalMass: expect.closeTo(576e-6, 15),
            }),
          ],
        });
      }
      const inheritedPhysical =
        inheritedOutput.physicalMassProperties();
      expect(inheritedPhysical.ok).toBe(true);
      if (inheritedPhysical.ok) {
        expect(inheritedPhysical.value.mass).toBeCloseTo(576e-6, 15);
      }
      const explicitPhysical = explicitOutput.physicalMassProperties();
      expect(explicitPhysical.ok).toBe(true);
      if (explicitPhysical.ok) {
        expect(explicitPhysical.value.mass).toBeCloseTo(360e-6, 15);
      }
    } finally {
      evaluated.dispose();
      evaluated.dispose();
    }
    expect(() => retained?.measure()).toThrow(/disposed/i);
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("orders material diagnostics deterministically by material id", async () => {
    const document = await partDocument({
      materials: {
        zeta: {
          name: "Zeta",
          massDensity: density(0),
        },
        alpha: {
          name: "Alpha",
          massDensity: density(-1),
        },
      },
      nodes: {
        leaf: box(),
        alphaPart: part("leaf", "solid", {
          materialId: "alpha" as never,
        }),
        zetaPart: part("leaf", "solid", {
          materialId: "zeta" as never,
        }),
      },
      outputs: {
        alphaPart: { node: "alphaPart", kind: "part" },
        zetaPart: { node: "zetaPart", kind: "part" },
      },
    });
    const harness = createKernelHarness();
    const result = await evaluatePartOutputsV7(harness.kernel, document);
    expectFailureCode(result, "MASS_DENSITY_INVALID");
    expect(
      result.diagnostics
        .filter(({ code }) => code === "MASS_DENSITY_INVALID")
        .map(({ path }) => path),
    ).toEqual([
      "/materials/alpha/massDensity",
      "/materials/zeta/massDensity",
    ]);
    expect(harness.primitiveCalls).toHaveLength(0);
  });

  it("returns one additive multibody BOM row and combines repeated memberships physically", async () => {
    const document = await partDocument({
      nodes: {
        bodyA: box(),
        bodyB: sphere(),
        bodies: bodySet([
          member("a", "bodyA"),
          member("b", "bodyB"),
          member("a-alias", "bodyA"),
        ]),
        multibodyPart: part("bodies", "bodySet", {
          partNumber: "MULTI-001",
          description: "Repeated membership fixture",
          material: "Uniform fixture",
          massDensity: density(1e-6),
        }),
      },
      outputs: { part: { node: "multibodyPart", kind: "part" } },
    });
    const harness = createKernelHarness({
      measureHook: (shape) =>
        shape.feature === "bodyA"
          ? {
              volume: 2,
              surfaceArea: 10,
              boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
              centerOfMass: [0, 0, 0],
              inertiaTensor: [
                [1, 0, 0],
                [0, 1, 0],
                [0, 0, 1],
              ],
              genus: 0,
              tolerance: 1e-7,
            }
          : {
              volume: 1,
              surfaceArea: 6,
              boundingBox: { min: [5, -0.5, -0.5], max: [7, 0.5, 0.5] },
              centerOfMass: [6, 0, 0],
              inertiaTensor: [
                [0.5, 0, 0],
                [0, 0.5, 0],
                [0, 0, 0.5],
              ],
              genus: 0,
              tolerance: 1e-7,
            },
    });
    const evaluated = expectPartResult(
      await evaluatePartOutputsV7(harness.kernel, document),
    );
    const output = evaluated.output("part");
    try {
      expect(harness.primitiveCalls).toHaveLength(2);
      expect(output.geometry.kind).toBe("bodySet");
      if (output.geometry.kind === "bodySet") {
        expect(output.geometry.bodySet.bodyIds).toEqual([
          "a",
          "b",
          "a-alias",
        ]);
        expect(
          output.geometry.bodySet.body("a").solid.measure(),
        ).toEqual(
          output.geometry.bodySet.body("a-alias").solid.measure(),
        );
        expect(
          output.geometry.bodySet.body("a").solid.export("step"),
        ).toBeInstanceOf(Uint8Array);
      }

      const bom = output.billOfMaterials();
      expect(bom.ok).toBe(true);
      if (bom.ok) {
        expect(bom.diagnostics).toEqual([]);
        expect(bom.value).toEqual({
          configurationId: null,
          units: { mass: "kg" },
          items: [
            {
              partNode: "multibodyPart",
              partNumber: "MULTI-001",
              description: "Repeated membership fixture",
              materialId: null,
              material: "Uniform fixture",
              quantity: 1,
              occurrenceIds: [],
              massDensity: 1e-6,
              massDensitySource: "part",
              definitionMass: expect.closeTo(5e-6, 15),
              totalMass: expect.closeTo(5e-6, 15),
            },
          ],
          totalQuantity: 1,
          massComplete: true,
          knownMass: expect.closeTo(5e-6, 15),
          totalMass: expect.closeTo(5e-6, 15),
        });
      }

      const physical = output.physicalMassProperties();
      expect(physical.ok).toBe(true);
      if (physical.ok) {
        expect(physical.value.mass).toBeCloseTo(5e-6, 15);
        expect(physical.value.centerOfMass?.[0]).toBeCloseTo(1.2, 15);
        expect(physical.value.centerOfMass?.slice(1)).toEqual([0, 0]);
        expect(physical.value.inertiaTensor[0][0]).toBeCloseTo(
          2.5e-6,
          15,
        );
        expect(physical.value.inertiaTensor[1][1]).toBeCloseTo(
          31.3e-6,
          15,
        );
        expect(physical.value.inertiaTensor[2][2]).toBeCloseTo(
          31.3e-6,
          15,
        );
      }
      expect(output.mesh().indices).toHaveLength(9);
      expect(() =>
        (
          output.export as unknown as (format: string) => Uint8Array
        )("brep"),
      ).toThrow(/unsupported|exact|mesh/i);
    } finally {
      evaluated.dispose();
    }
    expect(harness.disposed).toHaveLength(2);
    expect(harness.live.size).toBe(0);
  });

  it("rejects runtime mutation at mass entry and after kernel measurement", async () => {
    const mapDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "map",
    );
    if (mapDescriptor === undefined) {
      throw new Error("Array.prototype.map descriptor is unavailable");
    }
    const signDescriptor = Object.getOwnPropertyDescriptor(Math, "sign");
    if (signDescriptor === undefined) {
      throw new Error("Math.sign descriptor is unavailable");
    }
    const corruptArrayMap = (): void => {
      Object.defineProperty(Array.prototype, "map", {
        ...mapDescriptor,
        value: () => [],
      });
    };
    let measurementCount = 0;
    let mutateAtMeasurement = Number.POSITIVE_INFINITY;
    const harness = createKernelHarness({
      measureHook: (shape, calls) => {
        measurementCount += 1;
        if (measurementCount === mutateAtMeasurement) corruptArrayMap();
        return defaultMeasurements(shape, calls);
      },
    });
    const document = await partDocument({
      nodes: {
        first: box(),
        second: sphere(),
        bodies: bodySet([
          member("first", "first"),
          member("second", "second"),
        ]),
        evaluatedPart: part("bodies", "bodySet", {
          massDensity: density(1e-6),
        }),
      },
      outputs: {
        evaluatedPart: { node: "evaluatedPart", kind: "part" },
      },
    });
    const evaluated = expectPartResult(
      await evaluatePartOutputsV7(harness.kernel, document),
    );
    const output = evaluated.output("evaluatedPart");
    try {
      expect(measurementCount).toBe(2);
      let mathFailure:
        | ReturnType<EvaluatedPartV7["physicalMassProperties"]>
        | undefined;
      try {
        Object.defineProperty(Math, "sign", {
          ...signDescriptor,
          value: () => 0,
        });
        mathFailure = output.physicalMassProperties();
      } finally {
        Object.defineProperty(Math, "sign", signDescriptor);
      }
      if (mathFailure === undefined) {
        throw new Error("Expected Math.sign integrity failure");
      }
      expectFailureCode(mathFailure, "IR_INVALID");
      expect(mathFailure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({
              phase: "documentV7PartEvaluation",
              runtimeIntegrity: false,
            }),
          }),
        ]),
      );
      expect(measurementCount).toBe(2);

      let entryFailure:
        | ReturnType<EvaluatedPartV7["physicalMassProperties"]>
        | undefined;
      try {
        corruptArrayMap();
        entryFailure = output.physicalMassProperties();
      } finally {
        Object.defineProperty(Array.prototype, "map", mapDescriptor);
      }
      if (entryFailure === undefined) {
        throw new Error("Expected mass entry integrity failure");
      }
      expectFailureCode(entryFailure, "IR_INVALID");
      expect(entryFailure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({
              phase: "documentV7PartEvaluation",
              runtimeIntegrity: false,
            }),
          }),
        ]),
      );
      expect(measurementCount).toBe(2);

      let postMeasureFailure:
        | ReturnType<EvaluatedPartV7["physicalMassProperties"]>
        | undefined;
      try {
        mutateAtMeasurement = measurementCount + 1;
        postMeasureFailure = output.physicalMassProperties();
      } finally {
        Object.defineProperty(Array.prototype, "map", mapDescriptor);
      }
      if (postMeasureFailure === undefined) {
        throw new Error("Expected post-measure integrity failure");
      }
      expectFailureCode(postMeasureFailure, "IR_INVALID");
      expect(postMeasureFailure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({
              phase: "documentV7PartEvaluation",
              runtimeIntegrity: false,
            }),
          }),
        ]),
      );
      expect(measurementCount).toBe(3);

      mutateAtMeasurement = Number.POSITIVE_INFINITY;
      const recovered = output.physicalMassProperties();
      expect(recovered.ok).toBe(true);
      expect(measurementCount).toBe(5);
    } finally {
      evaluated.dispose();
      Object.defineProperty(Array.prototype, "map", mapDescriptor);
      Object.defineProperty(Math, "sign", signDescriptor);
    }
  });

  it("captures kernel measurements without accessors and contains mutate-and-throw callbacks", async () => {
    const mapDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "map",
    );
    if (mapDescriptor === undefined) {
      throw new Error("Array.prototype.map descriptor is unavailable");
    }
    const corruptArrayMap = (): void => {
      Object.defineProperty(Array.prototype, "map", {
        ...mapDescriptor,
        value: () => [],
      });
    };
    const document = await partDocument({
      nodes: {
        leaf: box(),
        evaluatedPart: part("leaf", "solid", {
          massDensity: density(1e-6),
        }),
      },
      outputs: {
        evaluatedPart: { node: "evaluatedPart", kind: "part" },
      },
    });

    let getterReads = 0;
    let accessorMeasurements = 0;
    const accessorHarness = createKernelHarness({
      measureHook: (shape, calls) => {
        accessorMeasurements += 1;
        const measured = { ...defaultMeasurements(shape, calls) };
        Object.defineProperty(measured, "centerOfMass", {
          configurable: true,
          enumerable: true,
          get: () => {
            getterReads += 1;
            corruptArrayMap();
            return [1, 1.5, 2] as const;
          },
        });
        return measured;
      },
    });
    const accessorEvaluation = expectPartResult(
      await evaluatePartOutputsV7(accessorHarness.kernel, document),
    );
    let accessorResult:
      | ReturnType<EvaluatedPartV7["physicalMassProperties"]>
      | undefined;
    try {
      accessorResult = accessorEvaluation
        .output("evaluatedPart")
        .physicalMassProperties();
    } finally {
      Object.defineProperty(Array.prototype, "map", mapDescriptor);
      accessorEvaluation.dispose();
    }
    if (accessorResult === undefined) {
      throw new Error("Expected accessor-backed measurement failure");
    }
    expectFailureCode(accessorResult, "KERNEL_ERROR");
    expect(accessorResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(
            /malformed measurements for part leaf 'leaf'/,
          ),
          details: expect.objectContaining({
            phase: "documentV7PartEvaluation",
            protocolViolation: true,
            reason: "unsafe-measurement-snapshot",
          }),
        }),
      ]),
    );
    expect(getterReads).toBe(0);
    expect(accessorMeasurements).toBe(2);
    expect(accessorHarness.disposed).toHaveLength(1);

    let throwingMeasurements = 0;
    const throwingHarness = createKernelHarness({
      measureHook: (shape, calls) => {
        throwingMeasurements += 1;
        if (throwingMeasurements === 2) {
          corruptArrayMap();
          throw { opaque: true };
        }
        return defaultMeasurements(shape, calls);
      },
    });
    const throwingEvaluation = expectPartResult(
      await evaluatePartOutputsV7(throwingHarness.kernel, document),
    );
    let throwingResult:
      | ReturnType<EvaluatedPartV7["physicalMassProperties"]>
      | undefined;
    try {
      throwingResult = throwingEvaluation
        .output("evaluatedPart")
        .physicalMassProperties();
    } finally {
      Object.defineProperty(Array.prototype, "map", mapDescriptor);
      throwingEvaluation.dispose();
    }
    if (throwingResult === undefined) {
      throw new Error("Expected mutate-and-throw integrity failure");
    }
    expectFailureCode(throwingResult, "IR_INVALID");
    expect(throwingResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.objectContaining({
            phase: "documentV7PartEvaluation",
            runtimeIntegrity: false,
          }),
        }),
      ]),
    );
    expect(throwingMeasurements).toBe(2);
    expect(throwingHarness.disposed).toHaveLength(1);
  });

  it("preserves a one-row partial BOM and structured physical failure when density is missing", async () => {
    const document = await partDocument({
      nodes: {
        leaf: box(),
        incomplete: part("leaf", "solid"),
      },
      outputs: { incomplete: { node: "incomplete", kind: "part" } },
    });
    const harness = createKernelHarness();
    const evaluated = expectPartResult(
      await evaluatePartOutputsV7(harness.kernel, document),
    );
    const output = evaluated.output("incomplete");
    try {
      const rangeErrorDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "RangeError",
      );
      if (rangeErrorDescriptor === undefined) {
        throw new Error("RangeError descriptor is unavailable");
      }
      let corruptedBom:
        | ReturnType<EvaluatedPartV7["billOfMaterials"]>
        | undefined;
      try {
        Object.defineProperty(globalThis, "RangeError", {
          ...rangeErrorDescriptor,
          value: class ReplacementRangeError extends Error {},
        });
        corruptedBom = output.billOfMaterials();
      } finally {
        Object.defineProperty(
          globalThis,
          "RangeError",
          rangeErrorDescriptor,
        );
      }
      if (corruptedBom === undefined) {
        throw new Error("Expected BOM runtime integrity failure");
      }
      expectFailureCode(corruptedBom, "IR_INVALID");
      expect(corruptedBom.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({
              phase: "documentV7PartEvaluation",
              runtimeIntegrity: false,
            }),
          }),
        ]),
      );

      const bom = output.billOfMaterials();
      expect(bom.ok).toBe(true);
      if (bom.ok) {
        expect(bom.value).toMatchObject({
          totalQuantity: 1,
          massComplete: false,
          knownMass: 0,
          totalMass: null,
          items: [
            {
              partNode: "incomplete",
              partNumber: null,
              description: null,
              materialId: null,
              material: null,
              quantity: 1,
              occurrenceIds: [],
              massDensity: null,
              massDensitySource: null,
              definitionMass: null,
              totalMass: null,
            },
          ],
        });
        expect(bom.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: "BOM_PART_NUMBER_MISSING" }),
            expect.objectContaining({ code: "BOM_MATERIAL_MISSING" }),
            expect.objectContaining({ code: "MASS_DENSITY_MISSING" }),
          ]),
        );
      }
      const physical = output.physicalMassProperties();
      expectFailureCode(physical, "MASS_DENSITY_MISSING");
    } finally {
      evaluated.dispose();
    }
  });

  it("enforces part limits before resolver or kernel work", async () => {
    const bytes = encoder.encode("bounded");
    const document = await partDocument({
      resources: { imported: bytes },
      parameters: {
        width: {
          dimension: "length",
          default: length(2),
        },
      },
      materials: {
        first: { name: "First", massDensity: density(1e-6) },
        second: { name: "Second", massDensity: density(2e-6) },
      },
      nodes: {
        native: box([
          lengthParameter("width"),
          length(3),
          length(4),
        ]),
        imported: importedBody("imported"),
        bodies: bodySet([
          member("native", "native"),
          member("imported", "imported"),
          member("native-alias", "native"),
        ]),
        bounded: part("bodies", "bodySet", {
          materialId: "first" as never,
        }),
      },
      outputs: {
        bounded: { node: "bounded", kind: "part" },
        alias: { node: "bounded", kind: "part" },
      },
    });

    const cases = [
      {
        options: {
          outputs: ["bounded", "bounded"],
          evaluationLimits: { maxSelectedOutputs: 1 },
        },
      },
      {
        options: {
          evaluationLimits: { maxPartBodies: 2 },
        },
      },
      {
        options: {
          evaluationLimits: { maxDistinctSolids: 1 },
        },
      },
      {
        options: {
          parameters: { width: 4 },
          evaluationLimits: { maxParameterOverrides: 0 },
        },
      },
      {
        options: {
          evaluationLimits: { maxResolvedMaterials: 1 },
        },
      },
      {
        options: {
          resourceLimits: { maxResourceBytes: bytes.byteLength - 1 },
        },
      },
    ] as const;

    for (const testCase of cases) {
      const harness = createKernelHarness();
      const resolver = vi.fn(() => bytes);
      const result = await evaluatePartOutputsV7(
        harness.kernel,
        document,
        {
          ...testCase.options,
          resolver,
        },
      );
      expectFailureCode(result, "RESOURCE_LIMIT_EXCEEDED");
      expect(resolver).not.toHaveBeenCalled();
      expect(harness.primitiveCalls).toHaveLength(0);
      expect(harness.importCalls).toHaveLength(0);
      expect(harness.live.size).toBe(0);
    }
  });

  it("bounds hostile options, cancellation, and rollback without leaking shapes", async () => {
    const document = await partDocument({
      nodes: {
        first: box(),
        second: sphere(),
        bodies: bodySet([
          member("first", "first"),
          member("second", "second"),
        ]),
        part: part("bodies", "bodySet", {
          massDensity: density(1e-6),
        }),
      },
      outputs: { part: { node: "part", kind: "part" } },
    });

    let accessorReads = 0;
    const hostile = Object.defineProperty({}, "outputs", {
      enumerable: true,
      get: () => {
        accessorReads += 1;
        return ["part"];
      },
    });
    const hostileHarness = createKernelHarness();
    const hostileResult = await evaluatePartOutputsV7(
      hostileHarness.kernel,
      document,
      hostile,
    );
    expectFailureCode(hostileResult, "IR_INVALID");
    expect(accessorReads).toBe(0);
    expect(hostileHarness.primitiveCalls).toHaveLength(0);

    const controller = new AbortController();
    controller.abort();
    const cancelledHarness = createKernelHarness();
    const cancelled = await evaluatePartOutputsV7(
      cancelledHarness.kernel,
      document,
      { signal: controller.signal },
    );
    expectFailureCode(cancelled, "EVALUATION_ABORTED");
    expect(cancelledHarness.primitiveCalls).toHaveLength(0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const rollbackHarness = createKernelHarness({
      primitiveHook: (_kind, shape, index) => {
        if (index === 1) throw revoked.proxy;
        return shape;
      },
    });
    const rollback = await evaluatePartOutputsV7(
      rollbackHarness.kernel,
      document,
    );
    expectFailureCode(rollback, "KERNEL_ERROR");
    expect(rollbackHarness.primitiveCalls).toHaveLength(2);
    expect(rollbackHarness.disposed.map(({ feature }) => feature)).toEqual([
      "first",
    ]);
    expect(rollbackHarness.live.size).toBe(0);
  });

  it("rejects transformed-part ownership when cancellation wins the post-await boundary", async () => {
    const document = await partDocument({
      nodes: {
        primitive: box(),
        transformed: transform("primitive", [
          {
            kind: "translate",
            value: [length(1), length(0), length(0)],
          },
        ]),
        part: part("transformed", "solid"),
      },
      outputs: { part: { node: "part", kind: "part" } },
    });
    const controller = new AbortController();
    const harness = createKernelHarness({
      transformHook: (_input, _operations, _context, shape) => {
        queueMicrotask(() => controller.abort());
        return shape;
      },
    });

    const result = await evaluatePartOutputsV7(harness.kernel, document, {
      signal: controller.signal,
    });

    expectFailureCode(result, "EVALUATION_ABORTED");
    expect(harness.primitiveCalls).toHaveLength(1);
    expect(harness.transformCalls).toHaveLength(1);
    expect(harness.disposed.map(({ serial }) => serial).sort()).toEqual([0, 1]);
    expect(harness.live.size).toBe(0);

    const originalNumberIsFinite = Number.isFinite;
    const integrityController = new AbortController();
    let poisonedCalls = 0;
    const integrityHarness = createKernelHarness({
      transformHook: (_input, _operations, _context, shape) => {
        queueMicrotask(() => integrityController.abort());
        return shape;
      },
      disposeHook: (_shape, callIndex) => {
        if (callIndex !== 0) return;
        Number.isFinite = ((value: unknown): boolean => {
          poisonedCalls += 1;
          return originalNumberIsFinite(value);
        }) as typeof Number.isFinite;
      },
    });
    let integrityResult:
      | Awaited<ReturnType<typeof evaluatePartOutputsV7>>
      | undefined;
    try {
      integrityResult = await evaluatePartOutputsV7(
        integrityHarness.kernel,
        document,
        { signal: integrityController.signal },
      );
    } finally {
      Number.isFinite = originalNumberIsFinite;
    }

    expect(integrityResult).toBeDefined();
    expectFailureCode(integrityResult!, "IR_INVALID");
    if (integrityResult !== undefined && !integrityResult.ok) {
      expect(integrityResult.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({ runtimeIntegrity: false }),
          }),
        ]),
      );
    }
    expect(poisonedCalls).toBe(0);
    expect(integrityHarness.disposed.map(({ serial }) => serial).sort()).toEqual(
      [0, 1],
    );
    expect(integrityHarness.live.size).toBe(0);
  });

  it("keeps the public package-root document and evaluated-part contract on v6", () => {
    const cad = publicApi.design("public-v6-part");
    const solid = cad.box("solid", {
      size: [publicApi.mm(1), publicApi.mm(2), publicApi.mm(3)],
    });
    cad.output("part", cad.part("part", solid));
    const document: publicApi.DesignDocument = cad.build();

    expect(publicApi.DOCUMENT_VERSION).toBe(6);
    expect(publicApi.DOCUMENT_SCHEMA).toBe(publicApi.DOCUMENT_SCHEMA_V6);
    expect(document.version).toBe(6);
    expect(publicApi.DesignDocumentSchema.safeParse(document).success).toBe(
      true,
    );
    expect("DOCUMENT_VERSION_V7" in publicApi).toBe(false);
    expect("evaluatePartOutputsV7" in publicApi).toBe(false);
    expect("EvaluatedPartV7" in publicApi).toBe(false);
    expect("EvaluatedPartDesignV7" in publicApi).toBe(false);
  });

  it("retains the captured kernel id for staged STEP capability errors", async () => {
    const cad = stagedBodySetDesignV7("captured-step-kernel-id");
    const body = cad.box("body", {
      size: [mm(1), mm(2), mm(3)],
    });
    cad.output("part", cad.part("part", body));
    const harness = createKernelHarness();
    const evaluated = expectPartResult(
      await evaluatePartOutputsV7(harness.kernel, cad.build()),
    );
    let idGetterCalls = 0;
    Object.defineProperty(harness.kernel, "id", {
      configurable: true,
      get() {
        idGetterCalls += 1;
        throw Object.create(null);
      },
    });
    try {
      const output = evaluated.output("part");
      const geometry = output.geometry;
      expect(geometry.kind).toBe("solid");
      if (geometry.kind !== "solid") return;
      expect(() =>
        Reflect.apply(geometry.solid.export, geometry.solid, [
          "step",
          null,
        ]),
      ).toThrow("STEP export options must be an object");
      expect(() =>
        Reflect.apply(geometry.solid.export, geometry.solid, [
          "step",
          { metadata: null },
        ]),
      ).toThrow("STEP export metadata must be an object");
      expect(() =>
        geometry.solid.export("step", {}),
      ).toThrow(
        "Kernel 'document-v7-part-test' does not advertise deterministic STEP export",
      );
      expect(idGetterCalls).toBe(0);
    } finally {
      evaluated.dispose();
    }
  });

  it("reports staged STEP metadata errors with the public structured contract", async () => {
    const cad = stagedBodySetDesignV7("structured-staged-step-errors");
    const body = cad.box("body", {
      size: [mm(1), mm(2), mm(3)],
    });
    cad.output("part", cad.part("part", body));
    const exportHook = vi.fn(() => encoder.encode("unused"));
    const harness = createKernelHarness({
      stepExport: strongStepExportCapabilities,
      exportHook,
    });
    const evaluated = expectPartResult(
      await evaluatePartOutputsV7(harness.kernel, cad.build()),
    );
    try {
      const output = evaluated.output("part");
      if (output.geometry.kind !== "solid") {
        throw new Error("Expected a staged solid output");
      }
      let thrown: unknown;
      try {
        output.geometry.solid.export("step", {
          metadata: { timestamp: "2026-02-30T12:00:00" },
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CadError);
      if (!(thrown instanceof CadError)) return;
      expect(thrown.diagnostics).toEqual([
        expect.objectContaining({
          code: "EXPORT_OPTIONS_INVALID",
          path: "/metadata/timestamp",
          message: expect.stringContaining(
            "outside the supported calendar range",
          ),
        }),
      ]);
      expect(exportHook).not.toHaveBeenCalled();
    } finally {
      evaluated.dispose();
    }
  });

  it("rechecks staged integrity after signal recapture and before kernel dispatch", async () => {
    const cad = stagedBodySetDesignV7("staged-step-signal-integrity");
    const body = cad.box("body", {
      size: [mm(1), mm(2), mm(3)],
    });
    cad.output("part", cad.part("part", body));
    const exportHook = vi.fn(() => encoder.encode("must-not-dispatch"));
    const harness = createKernelHarness({
      stepExport: strongStepExportCapabilities,
      exportHook,
    });
    const evaluated = expectPartResult(
      await evaluatePartOutputsV7(harness.kernel, cad.build()),
    );
    const originalNumberIsFinite = Number.isFinite;
    let poisonedNumberCalls = 0;
    let prototypeReads = 0;
    const controller = new AbortController();
    const nativeSignalPrototype = Object.getPrototypeOf(controller.signal);
    const intermediatePrototype = new Proxy(
      Object.create(nativeSignalPrototype),
      {
        getPrototypeOf(target) {
          prototypeReads += 1;
          if (prototypeReads === 2) {
            Number.isFinite = () => {
              poisonedNumberCalls += 1;
              return true;
            };
          }
          return Reflect.getPrototypeOf(target);
        },
      },
    );
    Object.setPrototypeOf(controller.signal, intermediatePrototype);

    let thrown: unknown;
    try {
      const output = evaluated.output("part");
      if (output.geometry.kind !== "solid") {
        throw new Error("Expected a staged solid output");
      }
      output.geometry.solid.export("step", {
        signal: controller.signal,
      });
    } catch (error) {
      thrown = error;
    } finally {
      Number.isFinite = originalNumberIsFinite;
      evaluated.dispose();
    }

    expect(thrown).toEqual(
      expect.objectContaining({
        message: "Document-v7 runtime intrinsics changed during the operation",
      }),
    );
    expect(prototypeReads).toBe(2);
    expect(poisonedNumberCalls).toBe(0);
    expect(exportHook).not.toHaveBeenCalled();
  });

  it("fails closed across exceptional staged STEP integrity paths", async () => {
    const cad = stagedBodySetDesignV7("staged-step-integrity");
    const body = cad.box("body", {
      size: [mm(1), mm(2), mm(3)],
    });
    cad.output("part", cad.part("part", body));
    const document = cad.build();

    const optionsHarness = createKernelHarness({
      stepExport: strongStepExportCapabilities,
    });
    const optionsEvaluated = expectPartResult(
      await evaluatePartOutputsV7(optionsHarness.kernel, document),
    );
    const optionsOutput = optionsEvaluated.output("part");
    if (optionsOutput.geometry.kind !== "solid") {
      optionsEvaluated.dispose();
      throw new Error("Expected a staged solid output");
    }
    const originalTypeError = globalThis.TypeError;
    let poisonedTypeErrorCalls = 0;
    const poisonedTypeError = function PoisonedTypeError(): never {
      poisonedTypeErrorCalls += 1;
      throw new Error("poisoned TypeError invoked");
    } as unknown as TypeErrorConstructor;
    const hostileOptions = new Proxy({}, {
      getOwnPropertyDescriptor() {
        globalThis.TypeError = poisonedTypeError;
        throw Object.create(null);
      },
    });
    let optionsThrown: unknown;
    try {
      Reflect.apply(
        optionsOutput.geometry.solid.export,
        optionsOutput.geometry.solid,
        ["step", hostileOptions],
      );
    } catch (error) {
      optionsThrown = error;
    } finally {
      globalThis.TypeError = originalTypeError;
      optionsEvaluated.dispose();
    }
    expect(optionsThrown).toEqual(
      expect.objectContaining({
        message: "Document-v7 runtime intrinsics changed during the operation",
      }),
    );
    expect(poisonedTypeErrorCalls).toBe(0);

    const originalNumberIsFinite = Number.isFinite;
    let poisonedNumberCalls = 0;
    const callbackHarness = createKernelHarness({
      exportHook() {
        Number.isFinite = () => {
          poisonedNumberCalls += 1;
          throw new Error("poisoned Number.isFinite invoked");
        };
        throw Object.create(null);
      },
    });
    const callbackEvaluated = expectPartResult(
      await evaluatePartOutputsV7(callbackHarness.kernel, document),
    );
    const callbackOutput = callbackEvaluated.output("part");
    if (callbackOutput.geometry.kind !== "solid") {
      callbackEvaluated.dispose();
      throw new Error("Expected a staged solid output");
    }
    let callbackThrown: unknown;
    try {
      callbackOutput.geometry.solid.export("step");
    } catch (error) {
      callbackThrown = error;
    } finally {
      Number.isFinite = originalNumberIsFinite;
      callbackEvaluated.dispose();
    }
    expect(callbackThrown).toEqual(
      expect.objectContaining({
        message: "Document-v7 runtime intrinsics changed during the operation",
      }),
    );
    expect(poisonedNumberCalls).toBe(0);

    const domExceptionDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "DOMException",
    );
    if (domExceptionDescriptor === undefined) {
      throw new Error("DOMException descriptor is unavailable");
    }
    let poisonedDomExceptionCalls = 0;
    const signalHarness = createKernelHarness({
      stepExport: strongStepExportCapabilities,
    });
    const signalEvaluated = expectPartResult(
      await evaluatePartOutputsV7(signalHarness.kernel, document),
    );
    const signalOutput = signalEvaluated.output("part");
    if (signalOutput.geometry.kind !== "solid") {
      signalEvaluated.dispose();
      throw new Error("Expected a staged solid output");
    }
    const controller = new AbortController();
    controller.abort();
    Object.defineProperty(globalThis, "DOMException", {
      ...domExceptionDescriptor,
      value: function PoisonedDOMException(): never {
        poisonedDomExceptionCalls += 1;
        throw new Error("poisoned DOMException invoked");
      },
    });
    let signalThrown: unknown;
    try {
      signalOutput.geometry.solid.export("step", {
        signal: controller.signal,
      });
    } catch (error) {
      signalThrown = error;
    } finally {
      Object.defineProperty(
        globalThis,
        "DOMException",
        domExceptionDescriptor,
      );
      signalEvaluated.dispose();
    }
    expect(signalThrown).toEqual(
      expect.objectContaining({
        message: "Document-v7 runtime intrinsics changed during the operation",
      }),
    );
    expect(poisonedDomExceptionCalls).toBe(0);
  });
});

describe("native staged document-v7 part evaluation", () => {
  it("maps single-solid part identity through every output alias", async () => {
    const cad = stagedBodySetDesignV7("v7-step-metadata");
    const body = cad.box("body", {
      size: [mm(2), mm(3), mm(4)],
    });
    const authoredPart = cad.part("singlePart", body, {
      partNumber: "V7-PN",
      description: "V7 part description",
    });
    cad.output("primary", authoredPart);
    cad.output("alias", authoredPart);
    const kernel = await createOcctKernel();
    try {
      const evaluated = expectPartResult(
        await evaluatePartOutputsV7(kernel, cad.build()),
      );
      try {
        const primary = evaluated.output("primary");
        const alias = evaluated.output("alias");
        expect(primary.geometry.kind).toBe("solid");
        expect(alias.geometry.kind).toBe("solid");
        if (
          primary.geometry.kind !== "solid" ||
          alias.geometry.kind !== "solid"
        ) {
          return;
        }
        const primaryStep = primary.geometry.solid.export("step");
        const aliasStep = alias.geometry.solid.export("step");
        expect(aliasStep).toEqual(primaryStep);
        const text = new TextDecoder().decode(primaryStep);
        expect(text).toContain(
          "FILE_NAME('v7-step-metadata','1970-01-01T00:00:00'",
        );
        expect(text).toMatch(
          /PRODUCT\('V7-PN',\s*'singlePart','V7 part description'/u,
        );
      } finally {
        evaluated.dispose();
      }
    } finally {
      kernel.dispose();
    }
  }, 30_000);

  it("evaluates single-solid and multibody parts with Manifold", async () => {
    const cad = stagedBodySetDesignV7("manifold-part-evaluation");
    const fixture = cad.material("fixture", {
      name: "Fixture",
      massDensity: kgPerCubicMillimeter(1e-6),
    });
    const authoredBox = cad.box("box", {
      size: [mm(2), mm(3), mm(4)],
    });
    const authoredSphere = cad.sphere("sphere", {
      radius: mm(1),
      segments: 24,
    });
    const bodies = cad.bodySet("bodies", [
      { id: "box", solid: authoredBox },
      { id: "sphere", solid: authoredSphere },
      { id: "box-alias", solid: authoredBox },
    ]);
    const single = cad.part("single", authoredBox, {
      partNumber: "MANIFOLD-SINGLE",
      materialRef: fixture,
    });
    const multi = cad.part("multi", bodies, {
      partNumber: "MANIFOLD-MULTI",
      materialRef: fixture,
    });
    cad.output("single", single);
    cad.output("multi", multi);
    const document = cad.build();
    const kernel = await createManifoldKernel();
    try {
      const evaluated = expectPartResult(
        await evaluatePartOutputsV7(kernel, document),
      );
      const retained = evaluated.output("multi");
      try {
        expect(evaluated.outputNames).toEqual(["single", "multi"]);
        const single = evaluated.output("single");
        const multi = evaluated.output("multi");
        expect(single).toMatchObject({
          representation: "mesh",
          exact: false,
          materialId: "fixture",
          massDensitySource: "material",
        });
        expect(single.geometry.kind).toBe("solid");
        if (single.geometry.kind === "solid") {
          expect(single.geometry.solid.measure().volume).toBeCloseTo(24, 8);
        }
        expect(multi.geometry.kind).toBe("bodySet");
        if (multi.geometry.kind === "bodySet") {
          expect(multi.geometry.bodySet.bodyIds).toEqual([
            "box",
            "sphere",
            "box-alias",
          ]);
          expect(
            multi.geometry.bodySet.body("box").solid.measure().volume,
          ).toBeCloseTo(24, 8);
          expect(
            multi.geometry.bodySet.body("sphere").solid.topology(),
          ).toMatchObject({
            ok: false,
            diagnostics: [
              expect.objectContaining({
                code: "KERNEL_CAPABILITY_MISSING",
              }),
            ],
          });
        }
        const physical = multi.physicalMassProperties();
        expect(physical.ok).toBe(true);
        if (physical.ok) {
          expect(physical.value.mass / 1e-6).toBeCloseTo(
            48 + (4 / 3) * Math.PI,
            0,
          );
        }
        expect(multi.mesh().indices.length).toBeGreaterThan(100);
        expect(multi.export("stl")).toBeInstanceOf(Uint8Array);
        expect(() =>
          (
            multi.export as unknown as (format: string) => Uint8Array
          )("step"),
        ).toThrow(/unsupported|exact|mesh/i);
      } finally {
        evaluated.dispose();
      }
      expect(() => retained.mesh()).toThrow(/disposed/i);

      const second = await evaluatePartOutputsV7(kernel, document, {
        outputs: ["single"],
      });
      expect(second.ok).toBe(true);
      if (second.ok) second.value.dispose();
    } finally {
      kernel.dispose();
    }
  }, 30_000);

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

  it("evaluates a verified mixed exact part with stock OCCT and releases every shape", async () => {
    const resources = { imported: step };
    const cad = stagedBodySetDesignV7("occt-part-evaluation");
    const fixture = cad.material("fixture", {
      name: "Fixture",
      massDensity: kgPerCubicMillimeter(1e-6),
    });
    const resource = cad.resource("imported", {
      digest: await digest(step),
      byteLength: step.byteLength,
      mediaType: "model/step",
      locations: ["project://part-evaluation/imported"],
    });
    const imported = cad.importedBody("imported", resource, {
      format: "step",
      units: { mode: "from-file" },
    });
    const native = cad.box("native", {
      size: [mm(2), mm(3), mm(4)],
    });
    const bodies = cad.bodySet("bodies", [
      {
        id: "imported",
        solid: imported,
        name: "Imported STEP",
      },
      { id: "native", solid: native, name: "Native box" },
      { id: "native-alias", solid: native },
    ]);
    const exactPart = cad.part("exactPart", bodies, {
      partNumber: "OCCT-MIXED",
      materialRef: fixture,
    });
    cad.output("exact", exactPart);
    const document = cad.build();
    const kernel = await createOcctKernel();
    const liveShapes = (
      kernel as GeometryKernel & {
        readonly liveShapes: ReadonlySet<unknown>;
      }
    ).liveShapes;
    const liveBefore = liveShapes.size;
    try {
      const requests: ResourceResolverRequestV7[] = [];
      const evaluated = expectPartResult(
        await evaluatePartOutputsV7(kernel, document, {
          resolver: resolverFor(resources, requests),
        }),
      );
      const output = evaluated.output("exact");
      let retained: EvaluatedSolid | undefined;
      try {
        expect(requests.map(({ id }) => id)).toEqual(["imported"]);
        expect(output).toMatchObject({
          representation: "brep",
          exact: true,
          materialId: "fixture",
          massDensitySource: "material",
        });
        expect(output.geometry.kind).toBe("bodySet");
        if (output.geometry.kind !== "bodySet") return;
        const bodies = output.geometry.bodySet;
        retained = bodies.body("imported").solid;
        expect(bodies.bodyIds).toEqual([
          "imported",
          "native",
          "native-alias",
        ]);
        expect(bodies.body("imported")).toMatchObject({
          node: "imported",
          name: "Imported STEP",
        });
        expect(bodies.body("imported").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(bodies.body("native").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(bodies.body("imported").solid.topology()).toMatchObject({
          ok: true,
          value: { history: "partial" },
        });
        expect(
          bodies.body("native").solid.export("step"),
        ).toBeInstanceOf(Uint8Array);
        expect(
          bodies.body("native").solid.export("step").byteLength,
        ).toBeGreaterThan(100);
        const bom = output.billOfMaterials();
        expect(bom.ok).toBe(true);
        if (bom.ok) {
          expect(bom.value.totalQuantity).toBe(1);
          expect(bom.value.items).toHaveLength(1);
          expect(bom.value.totalMass).toBeCloseTo(72e-6, 10);
        }
        const physical = output.physicalMassProperties();
        expect(physical.ok).toBe(true);
        if (physical.ok) {
          expect(physical.value.mass).toBeCloseTo(72e-6, 10);
        }
        expect(output.mesh().indices.length).toBeGreaterThan(30);
        expect(output.export("obj")).toContain("o exact");
        expect(() =>
          (
            output.export as unknown as (format: string) => Uint8Array
          )("brep"),
        ).toThrow(/unsupported|exact|mesh/i);
      } finally {
        evaluated.dispose();
      }
      expect(() => retained?.measure()).toThrow(/disposed/);
      expect(liveShapes.size).toBe(liveBefore);
    } finally {
      kernel.dispose();
    }
  }, 30_000);
});
