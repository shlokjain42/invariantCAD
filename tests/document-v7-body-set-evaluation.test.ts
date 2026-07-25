import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OcctKernel as RawOcctKernel,
  type ShapeHandle,
} from "occt-wasm";
import type { ResourceId } from "../src/core/ids.js";
import type { ExpressionIR } from "../src/expressions.js";
import {
  EvaluatedSolid,
  evaluateBodySetOutputsV7,
} from "../src/evaluator.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type BodySetMemberIRV7,
  type BodySetNodeIRV7,
  type DesignConfigurationIR,
  type DesignDocumentV7,
  type ImportedBodyNodeIRV7,
  type NodeIRV7,
  type ParameterIR,
  type ResourceDigestIR,
} from "../src/ir.js";
import {
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelDocumentBodyImportOptions,
  type KernelFeatureContext,
  type KernelPrimitive,
  type KernelShape,
  type MeshData,
  type MeshOptions,
  type ShapeMeasurements,
} from "../src/kernel.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import type { KernelTopologySnapshot } from "../src/protocol/topology.js";
import type {
  ResourceResolverRequestV7,
} from "../src/resource-resolution.js";

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

function box(
  size: readonly [ExpressionIR, ExpressionIR, ExpressionIR] = [
    length(2),
    length(3),
    length(4),
  ],
  center = false,
): NodeIRV7 {
  return { kind: "box", size, center };
}

function cylinder(
  height: ExpressionIR = length(5),
  radiusBottom: ExpressionIR = length(2),
  radiusTop: ExpressionIR = length(2),
  center = false,
): NodeIRV7 {
  return {
    kind: "cylinder",
    height,
    radiusBottom,
    radiusTop,
    center,
    segments: 32,
  };
}

function sphere(radius: ExpressionIR = length(3)): NodeIRV7 {
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

async function digest(bytes: Uint8Array): Promise<ResourceDigestIR> {
  const copy = bytes.slice();
  const value = await crypto.subtle.digest("SHA-256", copy);
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

interface BodySetDocumentOptions {
  readonly nodes: Readonly<Record<string, NodeIRV7>>;
  readonly outputs: Readonly<
    Record<string, { readonly node: string; readonly kind: "bodySet" | "solid" }>
  >;
  readonly resources?: Readonly<Record<string, Uint8Array>>;
  readonly parameters?: Readonly<Record<string, ParameterIR>>;
  readonly configurations?: Readonly<Record<string, DesignConfigurationIR>>;
}

async function bodySetDocument(
  options: BodySetDocumentOptions,
): Promise<DesignDocumentV7> {
  const resources: Record<
    string,
    {
      digest: ResourceDigestIR;
      byteLength: number;
      mediaType: string;
      locations: readonly string[];
    }
  > = {};
  for (const [id, bytes] of Object.entries(options.resources ?? {})) {
    resources[id] = {
      digest: await digest(bytes),
      byteLength: bytes.byteLength,
      mediaType: "application/octet-stream",
      locations: [`project://body-set/${id}`],
    };
  }
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "document-v7-body-set-evaluation",
    units: { length: "mm", angle: "rad" },
    parameters: options.parameters ?? {},
    ...(options.configurations === undefined
      ? {}
      : { configurations: options.configurations }),
    ...(Object.keys(resources).length === 0 ? {} : { resources }),
    nodes: options.nodes,
    outputs: options.outputs,
  } as unknown as DesignDocumentV7;
}

const defaultMeasurement: ShapeMeasurements = {
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

interface FakeShape extends KernelShape {
  readonly serial: number;
  readonly source: KernelPrimitive | "imported";
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

interface KernelHarness {
  readonly kernel: GeometryKernel;
  readonly primitiveCalls: PrimitiveCall[];
  readonly importCalls: ImportCall[];
  readonly meshCalls: readonly {
    readonly shape: FakeShape;
    readonly options: MeshOptions | undefined;
  }[];
  readonly exportCalls: readonly {
    readonly shape: FakeShape;
    readonly format: string;
    readonly context: KernelFeatureContext | undefined;
  }[];
  readonly disposed: FakeShape[];
  readonly live: ReadonlySet<FakeShape>;
  readonly disposeKernel: ReturnType<typeof vi.fn>;
}

interface KernelHarnessOptions {
  readonly capabilities?: KernelCapabilities;
  readonly omitMethods?: readonly (
    | KernelPrimitive
    | "importDocumentBody"
    | "status"
    | "measure"
    | "mesh"
    | "disposeShape"
  )[];
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
  readonly statusHook?: (
    shape: FakeShape,
  ) => ReturnType<GeometryKernel["status"]>;
  readonly measureHook?: (shape: FakeShape) => ShapeMeasurements;
  readonly meshHook?: (
    shape: FakeShape,
    options: MeshOptions | undefined,
  ) => MeshData;
}

function createKernelHarness(
  options: KernelHarnessOptions = {},
): KernelHarness {
  const primitiveCalls: PrimitiveCall[] = [];
  const importCalls: ImportCall[] = [];
  const meshCalls: {
    shape: FakeShape;
    options: MeshOptions | undefined;
  }[] = [];
  const exportCalls: {
    shape: FakeShape;
    format: string;
    context: KernelFeatureContext | undefined;
  }[] = [];
  const disposed: FakeShape[] = [];
  const live = new Set<FakeShape>();
  const disposeKernel = vi.fn();
  const omitted = new Set(options.omitMethods ?? []);
  let serial = 0;
  const capabilities: KernelCapabilities = options.capabilities ?? {
    protocolVersion: 1,
    representation: "brep",
    exact: true,
    primitives: ["box", "cylinder", "sphere"],
    features: [],
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
  };

  const acquire = (
    source: FakeShape["source"],
    hook: (shape: FakeShape) => KernelShape,
  ): KernelShape => {
    const shape: FakeShape = {
      kernel: "document-v7-body-set-test",
      serial: serial++,
      source,
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
    ((...arguments_: unknown[]): KernelShape =>
      acquire(kind, (shape) => {
        const context = arguments_.at(-1) as KernelFeatureContext | undefined;
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
      })) as NonNullable<GeometryKernel[KernelPrimitive]>;

  const kernel: GeometryKernel = {
    id: "document-v7-body-set-test",
    capabilities,
    ...(omitted.has("box") ? {} : { box: primitiveMethod("box") }),
    ...(omitted.has("cylinder")
      ? {}
      : { cylinder: primitiveMethod("cylinder") }),
    ...(omitted.has("sphere") ? {} : { sphere: primitiveMethod("sphere") }),
    ...(omitted.has("importDocumentBody")
      ? {}
      : {
          importDocumentBody: (
            bytes: Uint8Array,
            importOptions: KernelDocumentBodyImportOptions,
            context?: KernelFeatureContext,
          ): KernelShape =>
            acquire("imported", (shape) => {
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
        }),
    ...(omitted.has("mesh")
      ? {}
      : {
          mesh: (shape: KernelShape, meshOptions?: MeshOptions): MeshData => {
            const candidate = shape as FakeShape;
            meshCalls.push({ shape: candidate, options: meshOptions });
            return options.meshHook?.(candidate, meshOptions) ?? {
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
        }),
    ...(omitted.has("measure")
      ? {}
      : {
          measure: (shape: KernelShape): ShapeMeasurements =>
            options.measureHook?.(shape as FakeShape) ?? {
              ...defaultMeasurement,
              volume: defaultMeasurement.volume + (shape as FakeShape).serial,
            },
        }),
    ...(omitted.has("status")
      ? {}
      : {
          status: (shape: KernelShape) =>
            options.statusHook?.(shape as FakeShape) ?? {
              ok: true,
              code: "VALID",
            },
        }),
    topology: () => emptyTopology,
    exportShape: (
      shape: KernelShape,
      format,
      context?: KernelFeatureContext,
    ): Uint8Array => {
      const candidate = shape as FakeShape;
      exportCalls.push({ shape: candidate, format, context });
      return encoder.encode(`${format}:${candidate.serial}`);
    },
    ...(omitted.has("disposeShape")
      ? {}
      : {
          disposeShape: (shape: KernelShape): void => {
            const candidate = shape as FakeShape;
            if (!live.delete(candidate)) {
              throw new Error(
                `Shape ${candidate.serial} was disposed more than once`,
              );
            }
            disposed.push(candidate);
          },
        }),
    dispose: disposeKernel,
  } as GeometryKernel;

  return {
    kernel,
    primitiveCalls,
    importCalls,
    meshCalls,
    exportCalls,
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
  result: Awaited<ReturnType<typeof evaluateBodySetOutputsV7>>,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code })]),
  );
}

describe("staged document-v7 body-set output evaluation", () => {
  it("preserves output/member identity and order while deduplicating shared leaves", async () => {
    const document = await bodySetDocument({
      nodes: {
        sphereLeaf: sphere(),
        boxLeaf: box(),
        firstSet: bodySet([
          member("box-a", "boxLeaf", {
            name: "Authored box",
            metadata: { finish: "ground", nested: { revision: 2 } },
          }),
          member("sphere", "sphereLeaf"),
          member("box-b", "boxLeaf", { name: "Same leaf, distinct member" }),
        ]),
        secondSet: bodySet([
          member("shared-box", "boxLeaf"),
          member("shared-sphere", "sphereLeaf"),
        ]),
      },
      outputs: {
        first: { node: "firstSet", kind: "bodySet" },
        second: { node: "secondSet", kind: "bodySet" },
        alias: { node: "firstSet", kind: "bodySet" },
      },
    });
    const harness = createKernelHarness();
    const result = await evaluateBodySetOutputsV7(harness.kernel, document, {
      outputs: ["second", "alias", "first"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.value.outputNames).toEqual(["second", "alias", "first"]);
      expect(Object.isFrozen(result.value.outputNames)).toBe(true);
      expect(result.value.configurationId).toBeNull();
      expect(result.value.parameters).toEqual({});
      expect(result.value.diagnostics).toEqual([]);

      const first = result.value.output("first");
      const alias = result.value.output("alias");
      const second = result.value.output("second");
      expect(first).not.toBe(alias);
      expect(first.name).toBe("first");
      expect(alias.name).toBe("alias");
      expect(first.representation).toBe("brep");
      expect(first.exact).toBe(true);
      expect(first.bodyIds).toEqual(["box-a", "sphere", "box-b"]);
      expect(first.bodies.map(({ id }: { readonly id: string }) => id)).toEqual([
        "box-a",
        "sphere",
        "box-b",
      ]);
      expect(second.bodyIds).toEqual(["shared-box", "shared-sphere"]);
      expect(first.body("box-a")).toBe(first.bodies[0]);
      expect(first.body("box-a").node).toBe("boxLeaf");
      expect(first.body("box-a").name).toBe("Authored box");
      expect(first.body("box-a").metadata).toEqual({
        finish: "ground",
        nested: { revision: 2 },
      });
      expect(first.body("sphere").name).toBeUndefined();
      expect(first.body("sphere").metadata).toBeUndefined();
      expect(first.body("box-a").solid).toBeInstanceOf(EvaluatedSolid);
      expect(first.body("box-b").solid).not.toBe(
        first.body("box-a").solid,
      );
      expect(first.body("box-a").solid.measure()).toEqual(
        first.body("box-b").solid.measure(),
      );

      expect(Object.isFrozen(first.bodies)).toBe(true);
      expect(Object.isFrozen(first.bodyIds)).toBe(true);
      expect(Object.isFrozen(first.body("box-a"))).toBe(true);
      expect(Object.isFrozen(first.body("box-a").metadata)).toBe(true);
      expect(
        Object.isFrozen(
          (first.body("box-a").metadata as { nested: object }).nested,
        ),
      ).toBe(true);
      expect(() => first.body("missing")).toThrow(/unknown.*body/i);

      expect(harness.primitiveCalls.map(({ kind }) => kind)).toEqual([
        "box",
        "sphere",
      ]);
      expect(
        harness.primitiveCalls.map(({ context }) => context?.feature),
      ).toEqual(["boxLeaf", "sphereLeaf"]);
    } finally {
      result.value.dispose();
      result.value.dispose();
    }
    expect(harness.disposed.map(({ serial }) => serial).sort()).toEqual([0, 1]);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();

    const defaultHarness = createKernelHarness();
    const defaultResult = await evaluateBodySetOutputsV7(
      defaultHarness.kernel,
      document,
    );
    expect(defaultResult.ok).toBe(true);
    if (defaultResult.ok) {
      expect(defaultResult.value.outputNames).toEqual([
        "first",
        "second",
        "alias",
      ]);
      defaultResult.value.dispose();
    }
  });

  it("resolves base, named-configuration, and caller parameter precedence", async () => {
    const document = await bodySetDocument({
      parameters: {
        width: {
          dimension: "length",
          default: length(2),
          min: length(1),
          max: length(20),
        },
      },
      configurations: {
        wide: {
          parameterOverrides: {
            width: length(6),
          } as never,
        },
      },
      nodes: {
        parametricBox: box([
          lengthParameter("width"),
          length(3),
          length(4),
        ]),
        bodies: bodySet([member("parametric", "parametricBox")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });

    const cases = [
      { options: {}, expected: 2, configuration: null },
      {
        options: { configuration: "wide" },
        expected: 6,
        configuration: "wide",
      },
      {
        options: { parameters: { width: 4 } },
        expected: 4,
        configuration: null,
      },
      {
        options: { configuration: "wide", parameters: { width: 8 } },
        expected: 8,
        configuration: "wide",
      },
    ] as const;
    for (const testCase of cases) {
      const harness = createKernelHarness();
      const result = await evaluateBodySetOutputsV7(
        harness.kernel,
        document,
        testCase.options,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      try {
        expect(result.value.configurationId).toBe(testCase.configuration);
        expect(result.value.parameters).toEqual({ width: testCase.expected });
        expect(Object.isFrozen(result.value.parameters)).toBe(true);
        expect(harness.primitiveCalls).toHaveLength(1);
        expect(harness.primitiveCalls[0]!.arguments).toEqual([
          [testCase.expected, 3, 4],
          false,
        ]);
      } finally {
        result.value.dispose();
      }
    }

    const missing = await evaluateBodySetOutputsV7(
      createKernelHarness().kernel,
      document,
      { configuration: "missing" },
    );
    expectFailureCode(missing, "CONFIGURATION_MISSING");

    const outOfRangeHarness = createKernelHarness();
    const outOfRange = await evaluateBodySetOutputsV7(
      outOfRangeHarness.kernel,
      document,
      { parameters: { width: 100 } },
    );
    expectFailureCode(outOfRange, "PARAMETER_OUT_OF_RANGE");
    expect(outOfRangeHarness.primitiveCalls).toHaveLength(0);

    for (const invalid of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "8",
    ] as readonly unknown[]) {
      const invalidHarness = createKernelHarness();
      const invalidResult = await evaluateBodySetOutputsV7(
        invalidHarness.kernel,
        document,
        {
          parameters: {
            width: invalid,
          } as unknown as Readonly<Record<string, number>>,
        },
      );
      expectFailureCode(invalidResult, "EXPRESSION_INVALID");
      if (!invalidResult.ok) {
        expect(invalidResult.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: "/parameters/width" }),
          ]),
        );
      }
      expect(invalidHarness.primitiveCalls).toHaveLength(0);
    }
  });

  it("preflights every primitive and strong import before resolving or constructing", async () => {
    const bytes = encoder.encode("preflight");
    const document = await bodySetDocument({
      resources: { imported: bytes },
      nodes: {
        boxLeaf: box(),
        cylinderLeaf: cylinder(),
        sphereLeaf: sphere(),
        importedLeaf: importedBody("imported"),
        bodies: bodySet([
          member("box", "boxLeaf"),
          member("cylinder", "cylinderLeaf"),
          member("sphere", "sphereLeaf"),
          member("imported", "importedLeaf"),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const resolver = vi.fn(() => bytes);
    const missingSphere = createKernelHarness({
      capabilities: {
        protocolVersion: 1,
        representation: "brep",
        exact: true,
        primitives: ["box", "cylinder"],
        features: [],
        nativeImports: [],
        nativeExports: [],
        documentBodyImport: strongImportCapabilities,
      },
    });
    const primitiveResult = await evaluateBodySetOutputsV7(
      missingSphere.kernel,
      document,
      { resolver },
    );
    expectFailureCode(primitiveResult, "KERNEL_CAPABILITY_MISSING");
    expect(resolver).not.toHaveBeenCalled();
    expect(missingSphere.primitiveCalls).toHaveLength(0);
    expect(missingSphere.importCalls).toHaveLength(0);

    const missingMethod = createKernelHarness({
      omitMethods: ["cylinder"],
    });
    const methodResult = await evaluateBodySetOutputsV7(
      missingMethod.kernel,
      document,
      { resolver },
    );
    expectFailureCode(methodResult, "KERNEL_CAPABILITY_MISSING");
    expect(resolver).not.toHaveBeenCalled();
    expect(missingMethod.primitiveCalls).toHaveLength(0);

    const noStrongImport = createKernelHarness({
      capabilities: {
        protocolVersion: 1,
        representation: "brep",
        exact: true,
        primitives: ["box", "cylinder", "sphere"],
        features: [],
        nativeImports: ["step"],
        nativeExports: [],
      },
    });
    const weakImport = vi.fn();
    const weakKernel = {
      ...noStrongImport.kernel,
      importShape: weakImport,
    } as GeometryKernel;
    const importResult = await evaluateBodySetOutputsV7(
      weakKernel,
      document,
      { resolver },
    );
    expectFailureCode(importResult, "KERNEL_CAPABILITY_MISSING");
    expect(resolver).not.toHaveBeenCalled();
    expect(weakImport).not.toHaveBeenCalled();
    expect(noStrongImport.primitiveCalls).toHaveLength(0);
  });

  it("exposes per-body operations and only mesh-level aggregate semantics", async () => {
    const document = await bodySetDocument({
      nodes: {
        boxLeaf: box(),
        sphereLeaf: sphere(),
        bodies: bodySet([
          member("box", "boxLeaf"),
          member("sphere", "sphereLeaf"),
          member("box-alias", "boxLeaf"),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const harness = createKernelHarness();
    const result = await evaluateBodySetOutputsV7(harness.kernel, document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bodies = result.value.output("bodies");
    const boxBody = bodies.body("box");
    try {
      const meshOptions = {
        linearDeflection: 0.1,
        angularDeflection: 0.2,
        relative: true,
      };
      expect(boxBody.solid.mesh(meshOptions).indices).toHaveLength(3);
      expect(boxBody.solid.measure().volume).toBe(24);
      expect(boxBody.solid.topology()).toEqual({
        ok: true,
        value: emptyTopology,
        diagnostics: [],
      });
      expect(boxBody.solid.export("step")).toEqual(
        encoder.encode("step:0"),
      );
      expect(boxBody.solid.export("obj")).toContain("v ");

      const aggregate = bodies.mesh(meshOptions);
      expect(aggregate.positions).toHaveLength(27);
      expect(aggregate.indices).toEqual(
        new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      );
      expect(harness.meshCalls.slice(-3).map(({ shape }) => shape.serial)).toEqual(
        [0, 1, 0],
      );
      expect(
        harness.meshCalls.slice(-3).map(({ options }) => options),
      ).toEqual([meshOptions, meshOptions, meshOptions]);
      expect(bodies.export("stl")).toBeInstanceOf(Uint8Array);
      expect(bodies.export("stl-ascii")).toContain("solid bodies");
      expect(bodies.export("obj")).toContain("o bodies");
      const kernelExportCount = harness.exportCalls.length;
      const meshCount = harness.meshCalls.length;
      const primitiveCount = harness.primitiveCalls.length;
      for (const format of ["step", "brep", "brep-binary"] as const) {
        expect(() =>
          (
            bodies.export as unknown as (format: string) => Uint8Array
          )(format),
        ).toThrow(/unsupported|exact|aggregate|cannot be exported/i);
      }
      expect(harness.exportCalls).toHaveLength(kernelExportCount);
      expect(harness.meshCalls).toHaveLength(meshCount);
      expect(harness.primitiveCalls).toHaveLength(primitiveCount);
      expect("measure" in bodies).toBe(false);
      expect("topology" in bodies).toBe(false);
      expect("primary" in bodies).toBe(false);
      expect("activeBody" in bodies).toBe(false);
    } finally {
      result.value.dispose();
    }
    expect(() => boxBody.solid.measure()).toThrow(/disposed/);
    expect(() => bodies.mesh()).toThrow(/disposed/);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("retains staged per-body operation getters across borrowed-kernel mutation", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const harness = createKernelHarness();
    const baseMesh = harness.kernel.mesh;
    const baseMeasure = harness.kernel.measure;
    const baseTopology = harness.kernel.topology!;
    const baseExport = harness.kernel.exportShape!;
    let meshReads = 0;
    let measureReads = 0;
    let topologyReads = 0;
    let exportReads = 0;
    const kernel = { ...harness.kernel } as GeometryKernel;
    Object.defineProperties(kernel, {
      mesh: {
        configurable: true,
        enumerable: true,
        get: () => {
          meshReads += 1;
          return baseMesh;
        },
      },
      measure: {
        configurable: true,
        enumerable: true,
        get: () => {
          measureReads += 1;
          return baseMeasure;
        },
      },
      topology: {
        configurable: true,
        enumerable: true,
        get: () => {
          topologyReads += 1;
          return baseTopology;
        },
      },
      exportShape: {
        configurable: true,
        enumerable: true,
        get: () => {
          exportReads += 1;
          return baseExport;
        },
      },
    });

    const result = await evaluateBodySetOutputsV7(kernel, document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.value.output("bodies");
    const solid = output.body("primitive").solid;
    try {
      expect({ meshReads, measureReads, topologyReads, exportReads }).toEqual({
        meshReads: 1,
        measureReads: 1,
        topologyReads: 1,
        exportReads: 1,
      });
      for (const property of [
        "mesh",
        "measure",
        "topology",
        "exportShape",
        "capabilities",
        "id",
      ] as const) {
        Object.defineProperty(kernel, property, {
          configurable: true,
          enumerable: true,
          get: () => {
            throw new Error(`borrowed kernel ${property} was reread`);
          },
        });
      }

      expect(solid.measure().volume).toBe(24);
      expect(solid.mesh().indices).toHaveLength(3);
      expect(solid.topology()).toEqual({
        ok: true,
        value: emptyTopology,
        diagnostics: [],
      });
      expect(solid.export("step")).toEqual(encoder.encode("step:0"));
      expect(solid.export("obj")).toContain("v ");
      expect(output.export("obj")).toContain("o bodies");
      expect({ meshReads, measureReads, topologyReads, exportReads }).toEqual({
        meshReads: 1,
        measureReads: 1,
        topologyReads: 1,
        exportReads: 1,
      });
    } finally {
      result.value.dispose();
    }
    expect(harness.disposed).toHaveLength(1);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("rejects direct solid outputs and downstream member graphs before kernel work", async () => {
    const direct = await bodySetDocument({
      nodes: { primitive: box() },
      outputs: { primitive: { node: "primitive", kind: "solid" } },
    });
    const directHarness = createKernelHarness();
    const directResult = await evaluateBodySetOutputsV7(
      directHarness.kernel,
      direct,
    );
    expectFailureCode(directResult, "EVALUATION_UNSUPPORTED");
    expect(directHarness.primitiveCalls).toHaveLength(0);

    const downstream = await bodySetDocument({
      nodes: {
        primitive: box(),
        transformed: {
          kind: "transform",
          input: { node: "primitive" as never, kind: "solid" },
          operations: [
            {
              kind: "translate",
              value: [length(1), length(0), length(0)],
            },
          ],
        },
        bodies: bodySet([member("downstream", "transformed")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const downstreamHarness = createKernelHarness();
    const downstreamResult = await evaluateBodySetOutputsV7(
      downstreamHarness.kernel,
      downstream,
    );
    expectFailureCode(downstreamResult, "EVALUATION_UNSUPPORTED");
    expect(downstreamHarness.primitiveCalls).toHaveLength(0);
    if (!downstreamResult.ok) {
      expect(downstreamResult.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "/nodes/bodies/bodies/0/solid",
          }),
        ]),
      );
    }
  });

  it("bounds selected outputs, memberships, distinct solids, documents, and resources", async () => {
    const bytes = encoder.encode("bounded-body-set");
    const document = await bodySetDocument({
      resources: { imported: bytes },
      nodes: {
        first: box(),
        second: sphere(),
        imported: importedBody("imported"),
        bodies: bodySet([
          member("first", "first"),
          member("second", "second"),
          member("imported", "imported"),
        ]),
      },
      outputs: {
        bodies: { node: "bodies", kind: "bodySet" },
        alias: { node: "bodies", kind: "bodySet" },
      },
    });

    const cases = [
      { evaluationLimits: { maxSelectedOutputs: 1 } },
      { evaluationLimits: { maxBodySetMembers: 2 } },
      { evaluationLimits: { maxDistinctSolids: 2 } },
    ] as const;
    for (const options of cases) {
      const harness = createKernelHarness();
      const resolver = vi.fn(() => bytes);
      const result = await evaluateBodySetOutputsV7(
        harness.kernel,
        document,
        { ...options, resolver },
      );
      expectFailureCode(result, "RESOURCE_LIMIT_EXCEEDED");
      expect(resolver).not.toHaveBeenCalled();
      expect(harness.primitiveCalls).toHaveLength(0);
      expect(harness.importCalls).toHaveLength(0);
    }

    const documentHarness = createKernelHarness();
    const documentResolver = vi.fn(() => bytes);
    const documentLimited = await evaluateBodySetOutputsV7(
      documentHarness.kernel,
      document,
      {
        resolver: documentResolver,
        documentLimits: { maxResourceDefinitions: 0 },
      },
    );
    expectFailureCode(documentLimited, "IR_INVALID");
    expect(documentResolver).not.toHaveBeenCalled();
    expect(documentHarness.primitiveCalls).toHaveLength(0);

    const resourceHarness = createKernelHarness();
    const resourceResolver = vi.fn(() => bytes);
    const resourceLimited = await evaluateBodySetOutputsV7(
      resourceHarness.kernel,
      document,
      {
        outputs: ["bodies"],
        resolver: resourceResolver,
        resourceLimits: { maxResourceBytes: bytes.byteLength - 1 },
      },
    );
    expectFailureCode(resourceLimited, "RESOURCE_LIMIT_EXCEEDED");
    expect(resourceResolver).not.toHaveBeenCalled();
    expect(resourceHarness.primitiveCalls).toHaveLength(0);
    expect(resourceHarness.importCalls).toHaveLength(0);
  });

  it("rejects accessor-backed options without invoking accessors", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    let outputReads = 0;
    const options = Object.defineProperty({}, "outputs", {
      enumerable: true,
      get: () => {
        outputReads += 1;
        return ["bodies"];
      },
    });
    const harness = createKernelHarness();
    const result = await evaluateBodySetOutputsV7(
      harness.kernel,
      document,
      options,
    );
    expectFailureCode(result, "IR_INVALID");
    expect(outputReads).toBe(0);
    expect(harness.primitiveCalls).toHaveLength(0);
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "/outputs" }),
        ]),
      );
    }
  });

  it("honors cancellation before work and after primitive, status, resolver, and import callbacks", async () => {
    const primitiveDocument = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });

    const earlyController = new AbortController();
    earlyController.abort();
    const earlyHarness = createKernelHarness();
    const early = await evaluateBodySetOutputsV7(
      earlyHarness.kernel,
      primitiveDocument,
      { signal: earlyController.signal },
    );
    expectFailureCode(early, "EVALUATION_ABORTED");
    expect(earlyHarness.primitiveCalls).toHaveLength(0);

    const capabilityController = new AbortController();
    const capabilityHarness = createKernelHarness();
    const capabilityResult = await evaluateBodySetOutputsV7(
      {
        ...capabilityHarness.kernel,
        get capabilities(): KernelCapabilities {
          capabilityController.abort();
          return capabilityHarness.kernel.capabilities;
        },
      },
      primitiveDocument,
      { signal: capabilityController.signal },
    );
    expectFailureCode(capabilityResult, "EVALUATION_ABORTED");
    expect(capabilityHarness.primitiveCalls).toHaveLength(0);

    const primitiveController = new AbortController();
    const primitiveHarness = createKernelHarness({
      primitiveHook: (_kind, shape) => {
        primitiveController.abort();
        return shape;
      },
    });
    const duringPrimitive = await evaluateBodySetOutputsV7(
      primitiveHarness.kernel,
      primitiveDocument,
      { signal: primitiveController.signal },
    );
    expectFailureCode(duringPrimitive, "EVALUATION_ABORTED");
    expect(primitiveHarness.disposed).toHaveLength(1);
    expect(primitiveHarness.live.size).toBe(0);

    const statusController = new AbortController();
    const statusHarness = createKernelHarness({
      statusHook: () => {
        statusController.abort();
        return { ok: true, code: "VALID" };
      },
    });
    const duringStatus = await evaluateBodySetOutputsV7(
      statusHarness.kernel,
      primitiveDocument,
      { signal: statusController.signal },
    );
    expectFailureCode(duringStatus, "EVALUATION_ABORTED");
    expect(statusHarness.disposed).toHaveLength(1);
    expect(statusHarness.live.size).toBe(0);

    const bytes = encoder.encode("cancel-resource");
    const importedDocument = await bodySetDocument({
      resources: { imported: bytes },
      nodes: {
        imported: importedBody("imported"),
        bodies: bodySet([member("imported", "imported")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    let settle: ((value: Uint8Array) => void) | undefined;
    let resolverStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolverStarted = resolve;
    });
    const pending = new Promise<Uint8Array>((resolve) => {
      settle = resolve;
    });
    const resolverController = new AbortController();
    const resolverHarness = createKernelHarness();
    const resolving = evaluateBodySetOutputsV7(
      resolverHarness.kernel,
      importedDocument,
      {
        resolver: () => {
          resolverStarted?.();
          return pending;
        },
        signal: resolverController.signal,
      },
    );
    await started;
    resolverController.abort();
    const duringResolution = await resolving;
    settle?.(bytes);
    expectFailureCode(duringResolution, "EVALUATION_ABORTED");
    expect(resolverHarness.importCalls).toHaveLength(0);

    const importController = new AbortController();
    const importHarness = createKernelHarness({
      importHook: (_bytes, _options, _context, shape) => {
        importController.abort();
        return shape;
      },
    });
    const duringImport = await evaluateBodySetOutputsV7(
      importHarness.kernel,
      importedDocument,
      {
        resolver: () => bytes,
        signal: importController.signal,
      },
    );
    expectFailureCode(duringImport, "EVALUATION_ABORTED");
    expect(importHarness.disposed).toHaveLength(1);
    expect(importHarness.live.size).toBe(0);
  });

  it("contains opaque resolver, primitive, and status failures transactionally", async () => {
    const bytes = encoder.encode("opaque-resource");
    const importedDocument = await bodySetDocument({
      resources: { imported: bytes },
      nodes: {
        imported: importedBody("imported"),
        bodies: bodySet([member("imported", "imported")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const revokedResolver = Proxy.revocable({}, {});
    revokedResolver.revoke();
    const resolverHarness = createKernelHarness();
    const resolverResult = await evaluateBodySetOutputsV7(
      resolverHarness.kernel,
      importedDocument,
      {
        resolver: () => {
          throw revokedResolver.proxy;
        },
      },
    );
    expectFailureCode(resolverResult, "RESOURCE_RESOLUTION_FAILED");
    expect(resolverHarness.importCalls).toHaveLength(0);

    const primitiveDocument = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const revokedPrimitive = Proxy.revocable({}, {});
    revokedPrimitive.revoke();
    const primitiveHarness = createKernelHarness({
      primitiveHook: () => {
        throw revokedPrimitive.proxy;
      },
    });
    const primitiveResult = await evaluateBodySetOutputsV7(
      primitiveHarness.kernel,
      primitiveDocument,
    );
    expectFailureCode(primitiveResult, "KERNEL_ERROR");
    expect(primitiveHarness.live.size).toBe(0);

    const revokedStatus = Proxy.revocable({}, {});
    revokedStatus.revoke();
    const statusHarness = createKernelHarness({
      statusHook: () => {
        throw revokedStatus.proxy;
      },
    });
    const statusResult = await evaluateBodySetOutputsV7(
      statusHarness.kernel,
      primitiveDocument,
    );
    expectFailureCode(statusResult, "KERNEL_ERROR");
    expect(statusHarness.disposed).toHaveLength(1);
    expect(statusHarness.live.size).toBe(0);
  });

  it("detects runtime intrinsic mutation after untrusted callbacks without using poisoned methods", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const originalNumberIsFinite = Number.isFinite;
    let poisonedCalls = 0;
    const harness = createKernelHarness({
      primitiveHook: (_kind, shape) => {
        Number.isFinite = ((value: unknown): boolean => {
          poisonedCalls += 1;
          return originalNumberIsFinite(value);
        }) as typeof Number.isFinite;
        return shape;
      },
    });
    let result:
      | Awaited<ReturnType<typeof evaluateBodySetOutputsV7>>
      | undefined;
    try {
      result = await evaluateBodySetOutputsV7(harness.kernel, document);
    } finally {
      Number.isFinite = originalNumberIsFinite;
    }
    expect(result).toBeDefined();
    expectFailureCode(result!, "IR_INVALID");
    expect(poisonedCalls).toBe(0);
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);

    const bytes = encoder.encode("prototype-poison");
    const importedDocument = await bodySetDocument({
      resources: { imported: bytes },
      nodes: {
        imported: importedBody("imported"),
        bodies: bodySet([member("imported", "imported")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const prototypeHarness = createKernelHarness();
    let prototypeResult:
      | Awaited<ReturnType<typeof evaluateBodySetOutputsV7>>
      | undefined;
    try {
      prototypeResult = await evaluateBodySetOutputsV7(
        prototypeHarness.kernel,
        importedDocument,
        {
          resolver: () => {
            Object.defineProperty(Object.prototype, "bodySetPoison", {
              configurable: true,
              enumerable: true,
              value: true,
            });
            return bytes;
          },
        },
      );
    } finally {
      delete (Object.prototype as { bodySetPoison?: unknown }).bodySetPoison;
    }
    expect(prototypeResult).toBeDefined();
    expectFailureCode(prototypeResult!, "IR_INVALID");
    expect(prototypeHarness.importCalls).toHaveLength(0);
  });

  it("rejects distinct leaves that reuse one handle and disposes the handle once", async () => {
    const document = await bodySetDocument({
      nodes: {
        firstLeaf: box(),
        secondLeaf: sphere(),
        bodies: bodySet([
          member("first", "firstLeaf"),
          member("second", "secondLeaf"),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    let firstShape: KernelShape | undefined;
    const harness = createKernelHarness({
      primitiveHook: (_kind, shape, index) => {
        if (index === 0) {
          firstShape = shape;
          return shape;
        }
        return firstShape!;
      },
    });
    const result = await evaluateBodySetOutputsV7(harness.kernel, document);
    expectFailureCode(result, "KERNEL_ERROR");
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            details: expect.objectContaining({ protocolViolation: true }),
          }),
        ]),
      );
    }
    expect(harness.disposed).toHaveLength(1);
    expect(harness.disposed[0]).toBe(firstShape);
    expect(harness.live.size).toBe(0);
  });

  it("rolls back earlier shapes exactly once when a later leaf fails validation", async () => {
    const document = await bodySetDocument({
      nodes: {
        firstLeaf: box(),
        secondLeaf: sphere(),
        bodies: bodySet([
          member("first", "firstLeaf"),
          member("second", "secondLeaf"),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const harness = createKernelHarness({
      statusHook: (shape) =>
        shape.serial === 1
          ? { ok: false, code: "INVALID", message: "later invalid shape" }
          : { ok: true, code: "VALID" },
    });
    const result = await evaluateBodySetOutputsV7(harness.kernel, document);
    expectFailureCode(result, "KERNEL_ERROR");
    expect(harness.primitiveCalls).toHaveLength(2);
    expect(harness.disposed.map(({ serial }) => serial).sort()).toEqual([0, 1]);
    expect(harness.live.size).toBe(0);
  });

  it("captures disposal once, borrows the kernel, and survives repeated evaluations", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const harness = createKernelHarness();
    const disposer = harness.kernel.disposeShape;
    let disposerReads = 0;
    const kernel = { ...harness.kernel } as GeometryKernel;
    Object.defineProperty(kernel, "disposeShape", {
      configurable: true,
      enumerable: true,
      get: () => {
        disposerReads += 1;
        return disposer;
      },
    });

    const first = await evaluateBodySetOutputsV7(kernel, document);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const retained = first.value.output("bodies").body("primitive").solid;
    first.value.dispose();
    first.value.dispose();
    expect(disposerReads).toBe(1);
    expect(harness.disposed).toHaveLength(1);
    expect(() => retained.mesh()).toThrow(/disposed/);
    expect(harness.disposeKernel).not.toHaveBeenCalled();

    const second = await evaluateBodySetOutputsV7(kernel, document);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.output("bodies").body("primitive").solid.measure()).toEqual(
        expect.objectContaining({ volume: 25 }),
      );
      second.value.dispose();
    }
    expect(harness.disposed).toHaveLength(2);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("enforces maxParameterOverrides at the exact caller-override boundary", async () => {
    const document = await bodySetDocument({
      parameters: {
        width: { dimension: "length", default: length(2) },
        height: { dimension: "length", default: length(3) },
      },
      nodes: {
        primitive: box([
          lengthParameter("width"),
          lengthParameter("height"),
          length(4),
        ]),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });

    const exactHarness = createKernelHarness();
    const exact = await evaluateBodySetOutputsV7(exactHarness.kernel, document, {
      parameters: { width: 5, height: 6 },
      evaluationLimits: { maxParameterOverrides: 2 },
    });
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      expect(exact.value.parameters).toEqual({ height: 6, width: 5 });
      expect(exactHarness.primitiveCalls[0]!.arguments).toEqual([
        [5, 6, 4],
        false,
      ]);
      exact.value.dispose();
    }

    const limitedHarness = createKernelHarness();
    const limited = await evaluateBodySetOutputsV7(
      limitedHarness.kernel,
      document,
      {
        parameters: { width: 5, height: 6 },
        evaluationLimits: { maxParameterOverrides: 1 },
      },
    );
    expectFailureCode(limited, "RESOURCE_LIMIT_EXCEEDED");
    if (!limited.ok) {
      expect(limited.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "/parameters",
            details: expect.objectContaining({
              resource: "maxParameterOverrides",
              limit: 1,
              actual: 2,
            }),
          }),
        ]),
      );
    }
    expect(limitedHarness.primitiveCalls).toHaveLength(0);
  });

  it("preflights missing and non-callable mandatory kernel methods before resolution or construction", async () => {
    const bytes = encoder.encode("mandatory-methods");
    const document = await bodySetDocument({
      resources: { imported: bytes },
      nodes: {
        primitive: box(),
        imported: importedBody("imported"),
        bodies: bodySet([
          member("primitive", "primitive"),
          member("imported", "imported"),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const methods = [
      "status",
      "measure",
      "mesh",
      "disposeShape",
      "importDocumentBody",
    ] as const;
    for (const method of methods) {
      for (const mode of ["missing", "non-callable"] as const) {
        const harness = createKernelHarness({
          ...(mode === "missing" ? { omitMethods: [method] } : {}),
        });
        const candidate =
          mode === "missing"
            ? harness.kernel
            : ({
                ...harness.kernel,
                [method]: 17,
              } as unknown as GeometryKernel);
        const resolver = vi.fn(() => bytes);
        const result = await evaluateBodySetOutputsV7(candidate, document, {
          resolver,
        });
        expectFailureCode(result, "KERNEL_ERROR");
        expect(resolver, `${method}:${mode}`).not.toHaveBeenCalled();
        expect(harness.primitiveCalls, `${method}:${mode}`).toHaveLength(0);
        expect(harness.importCalls, `${method}:${mode}`).toHaveLength(0);
        expect(harness.live.size, `${method}:${mode}`).toBe(0);
      }
    }
  });

  it("verifies imported resource presence, length, and digest before strong import", async () => {
    const committed = new Uint8Array([1, 2, 3, 4]);
    const document = await bodySetDocument({
      resources: { imported: committed },
      nodes: {
        imported: importedBody("imported"),
        bodies: bodySet([member("imported", "imported")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });

    const missingHarness = createKernelHarness();
    const missing = await evaluateBodySetOutputsV7(
      missingHarness.kernel,
      document,
    );
    expectFailureCode(missing, "RESOURCE_RESOLVER_MISSING");
    expect(missingHarness.importCalls).toHaveLength(0);

    for (const substituted of [
      new Uint8Array([4, 3, 2, 1]),
      new Uint8Array([1, 2, 3]),
    ]) {
      const harness = createKernelHarness();
      const result = await evaluateBodySetOutputsV7(
        harness.kernel,
        document,
        { resolver: () => substituted },
      );
      expectFailureCode(result, "RESOURCE_INTEGRITY_MISMATCH");
      expect(harness.importCalls).toHaveLength(0);
      expect(harness.live.size).toBe(0);
    }
  });

  it("rejects strong imported bodies on approximate or mesh representations before resolution", async () => {
    const bytes = encoder.encode("exact-import-required");
    const document = await bodySetDocument({
      resources: { imported: bytes },
      nodes: {
        imported: importedBody("imported"),
        bodies: bodySet([member("imported", "imported")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    for (const capabilities of [
      {
        protocolVersion: 1,
        representation: "brep",
        exact: false,
        primitives: ["box", "cylinder", "sphere"],
        features: [],
        nativeImports: [],
        nativeExports: [],
        documentBodyImport: strongImportCapabilities,
      },
      {
        protocolVersion: 1,
        representation: "mesh",
        exact: false,
        primitives: ["box", "cylinder", "sphere"],
        features: [],
        nativeImports: [],
        nativeExports: [],
        documentBodyImport: strongImportCapabilities,
      },
    ] as const satisfies readonly KernelCapabilities[]) {
      const harness = createKernelHarness({ capabilities });
      const resolver = vi.fn(() => bytes);
      const result = await evaluateBodySetOutputsV7(
        harness.kernel,
        document,
        { resolver },
      );
      expectFailureCode(result, "KERNEL_ERROR");
      expect(resolver).not.toHaveBeenCalled();
      expect(harness.importCalls).toHaveLength(0);
    }
  });

  it("resolves and imports one shared imported leaf once while preserving memberships and signal", async () => {
    const bytes = encoder.encode("shared-imported-leaf");
    const document = await bodySetDocument({
      resources: { imported: bytes },
      nodes: {
        imported: importedBody("imported"),
        firstSet: bodySet([
          member("first", "imported"),
          member("second", "imported"),
        ]),
        secondSet: bodySet([member("third", "imported")]),
      },
      outputs: {
        first: { node: "firstSet", kind: "bodySet" },
        second: { node: "secondSet", kind: "bodySet" },
      },
    });
    const controller = new AbortController();
    const requests: ResourceResolverRequestV7[] = [];
    const harness = createKernelHarness();
    const result = await evaluateBodySetOutputsV7(harness.kernel, document, {
      resolver: resolverFor({ imported: bytes }, requests),
      signal: controller.signal,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      expect(requests).toHaveLength(1);
      expect(requests[0]).toEqual(
        expect.objectContaining({
          id: "imported",
          signal: controller.signal,
        }),
      );
      expect(harness.importCalls).toHaveLength(1);
      expect(harness.importCalls[0]!.context).toEqual({
        feature: "imported",
        signal: controller.signal,
      });
      expect(result.value.output("first").bodyIds).toEqual([
        "first",
        "second",
      ]);
      expect(result.value.output("second").bodyIds).toEqual(["third"]);
      expect(
        result.value.output("first").body("first").solid.measure(),
      ).toEqual(
        result.value.output("second").body("third").solid.measure(),
      );
    } finally {
      result.value.dispose();
    }
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);
  });

  it("rejects nested accessors, malformed output arrays, and revoked option proxies without side effects", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    let accessorCalls = 0;
    const accessorCases = [
      {
        options: {
          parameters: Object.defineProperty({}, "width", {
            enumerable: true,
            get: () => {
              accessorCalls += 1;
              return 2;
            },
          }),
        },
        path: "/parameters/width",
      },
      {
        options: {
          evaluationLimits: Object.defineProperty(
            {},
            "maxDistinctSolids",
            {
              enumerable: true,
              get: () => {
                accessorCalls += 1;
                return 1;
              },
            },
          ),
        },
        path: "/evaluationLimits/maxDistinctSolids",
      },
      {
        options: {
          resourceLimits: Object.defineProperty({}, "maxResourceBytes", {
            enumerable: true,
            get: () => {
              accessorCalls += 1;
              return 1;
            },
          }),
        },
        path: "/resourceLimits/maxResourceBytes",
      },
    ];
    for (const testCase of accessorCases) {
      const harness = createKernelHarness();
      const result = await evaluateBodySetOutputsV7(
        harness.kernel,
        document,
        testCase.options,
      );
      expectFailureCode(result, "IR_INVALID");
      if (!result.ok) {
        expect(result.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: testCase.path }),
          ]),
        );
      }
      expect(harness.primitiveCalls).toHaveLength(0);
    }
    expect(accessorCalls).toBe(0);

    const sparse = new Array<string>(1);
    const extra = ["bodies"];
    Object.defineProperty(extra, "extra", {
      configurable: true,
      enumerable: true,
      value: "body",
      writable: true,
    });
    for (const outputs of [sparse, extra]) {
      const harness = createKernelHarness();
      const result = await evaluateBodySetOutputsV7(
        harness.kernel,
        document,
        { outputs },
      );
      expectFailureCode(result, "IR_INVALID");
      expect(harness.primitiveCalls).toHaveLength(0);
    }

    const propertyHeavyEmpty: string[] = [];
    for (let index = 0; index < 128; index += 1) {
      Object.defineProperty(propertyHeavyEmpty, `extra-${index}`, {
        configurable: true,
        enumerable: false,
        value: "body",
        writable: true,
      });
    }
    const propertyHeavyHarness = createKernelHarness();
    const propertyHeavyResult = await evaluateBodySetOutputsV7(
      propertyHeavyHarness.kernel,
      document,
      {
        outputs: propertyHeavyEmpty,
        evaluationLimits: { maxSelectedOutputs: 0 },
      },
    );
    expectFailureCode(propertyHeavyResult, "IR_INVALID");
    expect(propertyHeavyHarness.primitiveCalls).toHaveLength(0);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const revokedHarness = createKernelHarness();
    const revokedPromise = evaluateBodySetOutputsV7(
      revokedHarness.kernel,
      document,
      revoked.proxy as never,
    );
    await expect(revokedPromise).resolves.toMatchObject({ ok: false });
    const revokedResult = await revokedPromise;
    expectFailureCode(revokedResult, "IR_INVALID");
    expect(revokedHarness.primitiveCalls).toHaveLength(0);
  });

  it("counts raw selections, deduplicated outputs, memberships, and distinct leaves at exact limits", async () => {
    const document = await bodySetDocument({
      nodes: {
        sharedLeaf: box(),
        bodies: bodySet([
          member("first-member", "sharedLeaf"),
          member("second-member", "sharedLeaf"),
        ]),
      },
      outputs: {
        first: { node: "bodies", kind: "bodySet" },
        alias: { node: "bodies", kind: "bodySet" },
      },
    });
    const selection = ["alias", "first", "alias"] as const;
    const exactHarness = createKernelHarness();
    const exact = await evaluateBodySetOutputsV7(exactHarness.kernel, document, {
      outputs: selection,
      evaluationLimits: {
        maxSelectedOutputs: 3,
        maxBodySetMembers: 4,
        maxDistinctSolids: 1,
      },
    });
    expect(exact.ok).toBe(true);
    if (exact.ok) {
      expect(exact.value.outputNames).toEqual(["alias", "first"]);
      expect(exact.value.output("alias").bodyIds).toEqual([
        "first-member",
        "second-member",
      ]);
      expect(exactHarness.primitiveCalls).toHaveLength(1);
      exact.value.dispose();
    }

    for (const evaluationLimits of [
      { maxSelectedOutputs: 2 },
      { maxBodySetMembers: 3 },
      { maxDistinctSolids: 0 },
    ]) {
      const harness = createKernelHarness();
      const result = await evaluateBodySetOutputsV7(
        harness.kernel,
        document,
        { outputs: selection, evaluationLimits },
      );
      expectFailureCode(result, "RESOURCE_LIMIT_EXCEEDED");
      expect(harness.primitiveCalls).toHaveLength(0);
    }
  });

  it("keeps detached descriptors readable while every live operation fails after disposal", async () => {
    const authoredMetadata = {
      finish: "ground",
      nested: { revision: 2 },
    };
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([
          member("stable", "primitive", {
            name: "Stable body",
            metadata: authoredMetadata,
          }),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const harness = createKernelHarness();
    const result = await evaluateBodySetOutputsV7(harness.kernel, document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.value.output("bodies");
    const descriptor = output.body("stable");
    const solid = descriptor.solid;
    const outputNames = result.value.outputNames;
    const bodyIds = output.bodyIds;

    authoredMetadata.finish = "painted";
    authoredMetadata.nested.revision = 99;
    expect(descriptor.metadata).toEqual({
      finish: "ground",
      nested: { revision: 2 },
    });

    result.value.dispose();
    expect(() => result.value.output("bodies")).toThrow(/disposed/);
    expect(() => output.body("stable")).toThrow(/disposed/);
    expect(() => output.mesh()).toThrow(/disposed/);
    expect(() => output.export("obj")).toThrow(/disposed/);
    expect(() => solid.mesh()).toThrow(/disposed/);
    expect(() => solid.measure()).toThrow(/disposed/);
    expect(() => solid.topology()).toThrow(/disposed/);
    expect(() => solid.export("obj")).toThrow(/disposed/);
    expect(() => solid.export("step")).toThrow(/disposed/);

    expect(outputNames).toEqual(["bodies"]);
    expect(bodyIds).toEqual(["stable"]);
    expect(descriptor.id).toBe("stable");
    expect(descriptor.node).toBe("primitive");
    expect(descriptor.name).toBe("Stable body");
    expect(descriptor.metadata).toEqual({
      finish: "ground",
      nested: { revision: 2 },
    });
    expect(Object.isFrozen(descriptor.metadata)).toBe(true);
    expect(harness.disposed).toHaveLength(1);
  });

  it("reports SDF representation and propagates cancellation signals into native leaves", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: sphere(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const capabilities: KernelCapabilities = {
      protocolVersion: 1,
      representation: "sdf",
      exact: false,
      primitives: ["sphere"],
      features: [],
      nativeImports: [],
      nativeExports: [],
    };
    const harness = createKernelHarness({ capabilities });
    const controller = new AbortController();
    const result = await evaluateBodySetOutputsV7(harness.kernel, document, {
      signal: controller.signal,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    try {
      const output = result.value.output("bodies");
      expect(output.representation).toBe("sdf");
      expect(output.exact).toBe(false);
      expect(harness.primitiveCalls).toHaveLength(1);
      expect(harness.primitiveCalls[0]!.context).toEqual({
        feature: "primitive",
        signal: controller.signal,
      });
    } finally {
      result.value.dispose();
    }
  });

  it("continues disposal after an error, marks facades dead, and never retries", async () => {
    const document = await bodySetDocument({
      nodes: {
        firstLeaf: box(),
        secondLeaf: sphere(),
        bodies: bodySet([
          member("first", "firstLeaf"),
          member("second", "secondLeaf"),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const harness = createKernelHarness();
    const baseDisposer = harness.kernel.disposeShape;
    const disposerCalls: number[] = [];
    const kernel: GeometryKernel = {
      ...harness.kernel,
      disposeShape: (shape) => {
        const candidate = shape as FakeShape;
        disposerCalls.push(candidate.serial);
        baseDisposer(shape);
        if (candidate.serial === 0) {
          throw new Error("first disposer failed");
        }
      },
    };
    const result = await evaluateBodySetOutputsV7(kernel, document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.value.output("bodies");
    const retained = output.body("second").solid;

    expect(() => result.value.dispose()).toThrow("first disposer failed");
    expect(disposerCalls).toEqual([0, 1]);
    expect(harness.disposed.map(({ serial }) => serial)).toEqual([0, 1]);
    expect(harness.live.size).toBe(0);
    expect(() => retained.measure()).toThrow(/disposed/);
    expect(() => output.mesh()).toThrow(/disposed/);

    expect(() => result.value.dispose()).not.toThrow();
    expect(disposerCalls).toEqual([0, 1]);
  });

  it("gives an already-aborted signal precedence over invalid outputs and parameters", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const controller = new AbortController();
    controller.abort();
    const cases = [
      {
        outputs: [17] as unknown as readonly string[],
        signal: controller.signal,
      },
      {
        parameters: {
          width: "invalid",
        } as unknown as Readonly<Record<string, number>>,
        signal: controller.signal,
      },
    ];
    for (const options of cases) {
      const harness = createKernelHarness();
      const result = await evaluateBodySetOutputsV7(
        harness.kernel,
        document,
        options,
      );
      expectFailureCode(result, "EVALUATION_ABORTED");
      expect(harness.primitiveCalls).toHaveLength(0);
    }
  });

  it("stops status descriptor probes immediately after abort or runtime mutation", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });

    const abortController = new AbortController();
    let abortCodeProbes = 0;
    const abortHarness = createKernelHarness({
      statusHook: () =>
        new Proxy(
          { ok: true, code: "VALID" },
          {
            getOwnPropertyDescriptor: (target, property) => {
              if (property === "ok") abortController.abort();
              if (property === "code") abortCodeProbes += 1;
              return Reflect.getOwnPropertyDescriptor(target, property);
            },
          },
        ),
    });
    const aborted = await evaluateBodySetOutputsV7(
      abortHarness.kernel,
      document,
      { signal: abortController.signal },
    );
    expectFailureCode(aborted, "EVALUATION_ABORTED");
    expect(abortCodeProbes).toBe(0);
    expect(abortHarness.disposed).toHaveLength(1);
    expect(abortHarness.live.size).toBe(0);

    const originalNumberIsFinite = Number.isFinite;
    let poisonedCalls = 0;
    let mutationCodeProbes = 0;
    const mutationHarness = createKernelHarness({
      statusHook: () =>
        new Proxy(
          { ok: true, code: "VALID" },
          {
            getOwnPropertyDescriptor: (target, property) => {
              if (property === "ok") {
                Number.isFinite = ((value: unknown): boolean => {
                  poisonedCalls += 1;
                  return originalNumberIsFinite(value);
                }) as typeof Number.isFinite;
              }
              if (property === "code") mutationCodeProbes += 1;
              return Reflect.getOwnPropertyDescriptor(target, property);
            },
          },
        ),
    });
    let mutationResult:
      | Awaited<ReturnType<typeof evaluateBodySetOutputsV7>>
      | undefined;
    try {
      mutationResult = await evaluateBodySetOutputsV7(
        mutationHarness.kernel,
        document,
      );
    } finally {
      Number.isFinite = originalNumberIsFinite;
    }
    expect(mutationResult).toBeDefined();
    expectFailureCode(mutationResult!, "IR_INVALID");
    expect(mutationCodeProbes).toBe(0);
    expect(poisonedCalls).toBe(0);
    expect(mutationHarness.disposed).toHaveLength(1);
    expect(mutationHarness.live.size).toBe(0);
  });

  it("stops capability descriptor probes immediately after abort or runtime mutation", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });

    const abortHarness = createKernelHarness();
    const abortController = new AbortController();
    let abortLaterProbes = 0;
    const abortCapabilities = new Proxy(
      abortHarness.kernel.capabilities,
      {
        getOwnPropertyDescriptor: (target, property) => {
          if (property === "protocolVersion") abortController.abort();
          if (property === "representation") abortLaterProbes += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    const aborted = await evaluateBodySetOutputsV7(
      { ...abortHarness.kernel, capabilities: abortCapabilities },
      document,
      { signal: abortController.signal },
    );
    expectFailureCode(aborted, "EVALUATION_ABORTED");
    expect(abortLaterProbes).toBe(0);
    expect(abortHarness.primitiveCalls).toHaveLength(0);

    const mutationHarness = createKernelHarness();
    const originalNumberIsFinite = Number.isFinite;
    let poisonedCalls = 0;
    let mutationLaterProbes = 0;
    const mutationCapabilities = new Proxy(
      mutationHarness.kernel.capabilities,
      {
        getOwnPropertyDescriptor: (target, property) => {
          if (property === "protocolVersion") {
            Number.isFinite = ((value: unknown): boolean => {
              poisonedCalls += 1;
              return originalNumberIsFinite(value);
            }) as typeof Number.isFinite;
          }
          if (property === "representation") mutationLaterProbes += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    let mutationResult:
      | Awaited<ReturnType<typeof evaluateBodySetOutputsV7>>
      | undefined;
    try {
      mutationResult = await evaluateBodySetOutputsV7(
        { ...mutationHarness.kernel, capabilities: mutationCapabilities },
        document,
      );
    } finally {
      Number.isFinite = originalNumberIsFinite;
    }
    expect(mutationResult).toBeDefined();
    expectFailureCode(mutationResult!, "IR_INVALID");
    expect(mutationLaterProbes).toBe(0);
    expect(poisonedCalls).toBe(0);
    expect(mutationHarness.primitiveCalls).toHaveLength(0);
  });

  it("rejects over-limit parameter and closed-limit records before descriptor probes", async () => {
    const document = await bodySetDocument({
      parameters: {
        width: { dimension: "length", default: length(2) },
        height: { dimension: "length", default: length(3) },
      },
      nodes: {
        primitive: box([
          lengthParameter("width"),
          lengthParameter("height"),
          length(4),
        ]),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });

    let parameterOwnKeys = 0;
    let parameterDescriptors = 0;
    const parameters = new Proxy(
      { width: 5, height: 6 },
      {
        ownKeys: (target) => {
          parameterOwnKeys += 1;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor: (target, property) => {
          parameterDescriptors += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    const parameterHarness = createKernelHarness();
    const parameterResult = await evaluateBodySetOutputsV7(
      parameterHarness.kernel,
      document,
      {
        parameters,
        evaluationLimits: { maxParameterOverrides: 1 },
      },
    );
    expectFailureCode(parameterResult, "RESOURCE_LIMIT_EXCEEDED");
    expect(parameterOwnKeys).toBe(1);
    expect(parameterDescriptors).toBe(0);
    expect(parameterHarness.primitiveCalls).toHaveLength(0);

    const oversizedTarget: Record<string, number> = {};
    for (let index = 0; index < 128; index += 1) {
      oversizedTarget[`limit${index}`] = index;
    }
    let limitOwnKeys = 0;
    let limitDescriptors = 0;
    const oversizedLimits = new Proxy(oversizedTarget, {
      ownKeys: (target) => {
        limitOwnKeys += 1;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor: (target, property) => {
        limitDescriptors += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const limitHarness = createKernelHarness();
    const limitResult = await evaluateBodySetOutputsV7(
      limitHarness.kernel,
      document,
      {
        evaluationLimits:
          oversizedLimits as unknown as Readonly<Record<string, number>>,
      },
    );
    expectFailureCode(limitResult, "IR_INVALID");
    expect(limitOwnKeys).toBe(1);
    expect(limitDescriptors).toBe(0);
    expect(limitHarness.primitiveCalls).toHaveLength(0);
  });

  it("rejects oversized default output selections before any kernel boundary", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: {
        first: { node: "bodies", kind: "bodySet" },
        second: { node: "bodies", kind: "bodySet" },
        third: { node: "bodies", kind: "bodySet" },
      },
    });
    const harness = createKernelHarness();
    let kernelReads = 0;
    const kernel = new Proxy(harness.kernel, {
      get: (target, property, receiver) => {
        if (property === "id" || property === "capabilities") {
          kernelReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const result = await evaluateBodySetOutputsV7(kernel, document, {
      evaluationLimits: { maxSelectedOutputs: 2 },
    });
    expectFailureCode(result, "RESOURCE_LIMIT_EXCEEDED");
    expect(kernelReads).toBe(0);
    expect(harness.primitiveCalls).toHaveLength(0);
  });

  it("detects intrinsic mutation performed during rollback cleanup after disposing every shape", async () => {
    const document = await bodySetDocument({
      nodes: {
        firstLeaf: box(),
        secondLeaf: sphere(),
        bodies: bodySet([
          member("first", "firstLeaf"),
          member("second", "secondLeaf"),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const harness = createKernelHarness({
      statusHook: (shape) =>
        shape.serial === 1
          ? { ok: false, code: "INVALID" }
          : { ok: true, code: "VALID" },
    });
    const baseDisposer = harness.kernel.disposeShape;
    const originalNumberIsFinite = Number.isFinite;
    let poisonedCalls = 0;
    let disposalCalls = 0;
    const kernel: GeometryKernel = {
      ...harness.kernel,
      disposeShape: (shape) => {
        disposalCalls += 1;
        baseDisposer(shape);
        if (disposalCalls === 1) {
          Number.isFinite = ((value: unknown): boolean => {
            poisonedCalls += 1;
            return originalNumberIsFinite(value);
          }) as typeof Number.isFinite;
        }
      },
    };
    let result:
      | Awaited<ReturnType<typeof evaluateBodySetOutputsV7>>
      | undefined;
    try {
      result = await evaluateBodySetOutputsV7(kernel, document);
    } finally {
      Number.isFinite = originalNumberIsFinite;
    }
    expect(result).toBeDefined();
    expectFailureCode(result!, "IR_INVALID");
    expect(disposalCalls).toBe(2);
    expect(harness.disposed.map(({ serial }) => serial)).toEqual([0, 1]);
    expect(harness.live.size).toBe(0);
    expect(poisonedCalls).toBe(0);
  });

  it("never reads coercion or message accessors on hostile thrown objects", async () => {
    const document = await bodySetDocument({
      nodes: {
        primitive: box(),
        bodies: bodySet([member("primitive", "primitive")]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    let messageReads = 0;
    let toStringReads = 0;
    let primitiveReads = 0;
    const hostile = Object.create(Error.prototype) as object;
    Object.defineProperties(hostile, {
      message: {
        configurable: true,
        get: () => {
          messageReads += 1;
          return "hostile message";
        },
      },
      toString: {
        configurable: true,
        get: () => {
          toStringReads += 1;
          return () => "hostile string";
        },
      },
      [Symbol.toPrimitive]: {
        configurable: true,
        get: () => {
          primitiveReads += 1;
          return () => "hostile primitive";
        },
      },
    });
    const harness = createKernelHarness({
      primitiveHook: () => {
        throw hostile;
      },
    });
    const result = await evaluateBodySetOutputsV7(harness.kernel, document);
    expectFailureCode(result, "KERNEL_ERROR");
    expect(messageReads).toBe(0);
    expect(toStringReads).toBe(0);
    expect(primitiveReads).toBe(0);
    expect(harness.live.size).toBe(0);
  });
});

describe("native staged document-v7 body-set evaluation", () => {
  it("evaluates and owns a native primitive body set with Manifold", async () => {
    const document = await bodySetDocument({
      nodes: {
        boxLeaf: box(),
        cylinderLeaf: cylinder(),
        sphereLeaf: sphere(),
        bodies: bodySet([
          member("sphere", "sphereLeaf"),
          member("box", "boxLeaf"),
          member("cylinder", "cylinderLeaf"),
          member("box-alias", "boxLeaf"),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const kernel = await createManifoldKernel();
    try {
      const result = await evaluateBodySetOutputsV7(kernel, document);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.value.output("bodies");
      const retained = output.body("box").solid;
      try {
        expect(output.representation).toBe("mesh");
        expect(output.exact).toBe(false);
        expect(output.bodyIds).toEqual([
          "sphere",
          "box",
          "cylinder",
          "box-alias",
        ]);
        expect(output.body("box").solid.measure().volume).toBeCloseTo(24, 8);
        expect(output.body("box-alias").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(output.body("cylinder").solid.measure().volume).toBeCloseTo(
          Math.PI * 20,
          0,
        );
        expect(output.body("sphere").solid.measure().volume).toBeCloseTo(
          (4 / 3) * Math.PI * 27,
          -1,
        );
        expect(output.mesh().indices.length).toBeGreaterThan(100);
        expect(output.export("stl")).toBeInstanceOf(Uint8Array);
        expect(output.export("obj")).toContain("o bodies");
        expect(output.body("box").solid.topology()).toMatchObject({
          ok: false,
          diagnostics: [expect.objectContaining({
            code: "KERNEL_CAPABILITY_MISSING",
          })],
        });
        expect(() => output.body("box").solid.export("step")).toThrow(
          /cannot export step/i,
        );
      } finally {
        result.value.dispose();
      }
      expect(() => retained.measure()).toThrow(/disposed/);

      const second = await evaluateBodySetOutputsV7(kernel, document, {
        outputs: ["bodies"],
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

  it("evaluates a mixed native/imported exact body set with stock OCCT", async () => {
    const resources = { imported: step };
    const document = await bodySetDocument({
      resources,
      nodes: {
        nativeBox: box(),
        importedBox: importedBody("imported"),
        bodies: bodySet([
          member("imported", "importedBox", { name: "Imported STEP" }),
          member("native", "nativeBox", { name: "Native primitive" }),
          member("native-alias", "nativeBox"),
        ]),
      },
      outputs: { bodies: { node: "bodies", kind: "bodySet" } },
    });
    const kernel = await createOcctKernel();
    const liveShapes = (
      kernel as GeometryKernel & {
        readonly liveShapes: ReadonlySet<unknown>;
      }
    ).liveShapes;
    const liveBefore = liveShapes.size;
    try {
      const requests: ResourceResolverRequestV7[] = [];
      const result = await evaluateBodySetOutputsV7(kernel, document, {
        resolver: resolverFor(resources, requests),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.value.output("bodies");
      const retained = output.body("imported").solid;
      try {
        expect(requests.map(({ id }) => id)).toEqual(["imported"]);
        expect(output.representation).toBe("brep");
        expect(output.exact).toBe(true);
        expect(output.bodyIds).toEqual([
          "imported",
          "native",
          "native-alias",
        ]);
        expect(output.body("imported").node).toBe("importedBox");
        expect(output.body("native").node).toBe("nativeBox");
        expect(output.body("imported").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(output.body("native").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        expect(output.body("native-alias").solid.measure().volume).toBeCloseTo(
          24,
          8,
        );
        const topology = output.body("imported").solid.topology();
        expect(topology).toMatchObject({
          ok: true,
          value: { history: "partial" },
        });
        if (topology.ok) {
          expect(topology.value.faces).toHaveLength(6);
          expect(topology.value.edges).toHaveLength(12);
          expect(topology.value.vertices).toHaveLength(8);
        }
        expect(output.body("native").solid.export("step").byteLength).toBeGreaterThan(
          100,
        );
        expect(output.mesh().indices.length).toBeGreaterThan(30);
        expect(output.export("stl")).toBeInstanceOf(Uint8Array);
        expect(() =>
          (
            output.export as unknown as (format: string) => Uint8Array
          )("brep"),
        ).toThrow(/cannot be exported|unsupported/i);
      } finally {
        result.value.dispose();
      }
      expect(() => retained.measure()).toThrow(/disposed/);
      expect(liveShapes.size).toBe(liveBefore);
    } finally {
      kernel.dispose();
    }
  }, 30_000);
});
