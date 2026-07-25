import { describe, expect, it, vi } from "vitest";
import type {
  ConfigurationId,
  EntityId,
  NodeId,
  ResourceId,
} from "../src/core/ids.js";
import { CadError } from "../src/core/result.js";
import * as evaluatorModule from "../src/evaluator.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type AssemblyInstanceIRV7,
  type AssemblyNodeIRV7,
  type DesignDocumentV7,
  type NodeIRV7,
  type ResourceDigestIR,
} from "../src/ir.js";
import {
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  type GeometryKernel,
  type KernelShape,
  type MeshData,
  type MeshOptions,
} from "../src/kernel.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import {
  EvaluatedLocalAssemblyV7,
  evaluateLocalAssemblyOutputsV7,
  type LocalAssemblyEvaluationLimitsV7,
} from "../src/internal/document-v7-local-assembly-evaluation.js";

const literal = (
  dimension:
    | "scalar"
    | "length"
    | "angle"
    | "massDensity",
  value: number,
) => ({ op: "literal" as const, dimension, value });

const parameter = (
  dimension: "length",
  id: string,
) => ({
  op: "parameter" as const,
  dimension,
  id: id as never,
});

function localPartInstance(
  id: string,
  configuration: AssemblyInstanceIRV7["configuration"],
  placement: AssemblyInstanceIRV7["placement"] = [],
): AssemblyInstanceIRV7 {
  return {
    id: id as EntityId,
    component: {
      source: "local",
      reference: {
        node: "part" as NodeId,
        kind: "part",
      },
    },
    configuration,
    placement,
    suppressed: false,
  };
}

function configuredAssemblyDocument(): DesignDocumentV7 {
  const nodes: Record<string, NodeIRV7> = {
    solid: {
      kind: "box",
      size: [
        parameter("length", "width"),
        literal("length", 2),
        literal("length", 3),
      ],
      center: false,
    },
    part: {
      kind: "part",
      geometry: { node: "solid" as NodeId, kind: "solid" },
      partNumber: "P-001",
      materialId: "steel" as never,
    },
    assembly: {
      kind: "assembly",
      instances: [
        localPartInstance("base", { mode: "base" }),
        localPartInstance(
          "inherit",
          { mode: "inherit" },
          [
            {
              kind: "translate",
              value: [
                parameter("length", "width"),
                literal("length", 0),
                literal("length", 0),
              ],
            },
          ],
        ),
        localPartInstance(
          "named",
          { mode: "named", id: "wide" as ConfigurationId },
          [
            {
              kind: "scale",
              value: [
                literal("scalar", 2),
                literal("scalar", 1),
                literal("scalar", 1),
              ],
            },
          ],
        ),
        localPartInstance("named-again", {
          mode: "named",
          id: "wide" as ConfigurationId,
        }),
      ],
    },
    empty: { kind: "assembly", instances: [] },
  };
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "local-assembly-evaluation",
    units: { length: "mm", angle: "rad", mass: "kg" },
    parameters: {
      width: {
        dimension: "length",
        default: literal("length", 10),
      },
    },
    materials: {
      steel: {
        name: "Steel",
        massDensity: literal("massDensity", 1e-6),
      },
      aluminum: {
        name: "Aluminum",
        massDensity: literal("massDensity", 2e-6),
      },
    },
    configurations: {
      wide: {
        parameterOverrides: {
          width: literal("length", 20),
        },
        partMaterialOverrides: {
          part: "aluminum" as never,
        },
      },
    },
    nodes,
    outputs: {
      product: { node: "assembly" as NodeId, kind: "assembly" },
      alias: { node: "assembly" as NodeId, kind: "assembly" },
      empty: { node: "empty" as NodeId, kind: "assembly" },
    },
  } as unknown as DesignDocumentV7;
}

interface InstrumentedKernel {
  readonly kernel: GeometryKernel;
  readonly boxCalls: ReturnType<typeof vi.fn>;
  readonly disposedShapes: KernelShape[];
  readonly disposeKernel: ReturnType<typeof vi.fn>;
  disposeBase(): void;
}

async function instrumentedManifold(
  failBoxCall?: number,
  afterBox?: (index: number, shape: KernelShape) => void,
  meshHook?: (
    shape: KernelShape,
    options: MeshOptions | undefined,
    valid: MeshData,
  ) => unknown,
): Promise<InstrumentedKernel> {
  const base = await createManifoldKernel();
  let boxCallIndex = 0;
  const boxCalls = vi.fn(
    (
      ...arguments_: Parameters<NonNullable<GeometryKernel["box"]>>
    ) => {
      const index = boxCallIndex;
      boxCallIndex += 1;
      if (index === failBoxCall) {
        throw new Error("injected contextual box failure");
      }
      const shape = base.box!(...arguments_);
      afterBox?.(index, shape);
      return shape;
    },
  );
  const disposedShapes: KernelShape[] = [];
  const disposeKernel = vi.fn();
  const kernel: GeometryKernel = {
    id: base.id,
    capabilities: base.capabilities,
    box: (...arguments_) => boxCalls(...arguments_),
    mesh(shape, options) {
      const valid = base.mesh(shape, options);
      return (meshHook === undefined
        ? valid
        : meshHook(shape, options, valid)) as MeshData;
    },
    measure: base.measure.bind(base),
    status: base.status.bind(base),
    disposeShape(shape) {
      disposedShapes.push(shape);
      base.disposeShape(shape);
    },
    dispose: disposeKernel,
  };
  return {
    kernel,
    boxCalls,
    disposedShapes,
    disposeKernel,
    disposeBase: () => base.dispose(),
  };
}

function multibodyAssemblyDocument(
  withDensity: boolean,
): DesignDocumentV7 {
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "local-assembly-multibody",
    units: { length: "mm", angle: "rad", mass: "kg" },
    parameters: {},
    nodes: {
      first: {
        kind: "box",
        size: [
          literal("length", 2),
          literal("length", 3),
          literal("length", 4),
        ],
        center: false,
      },
      second: {
        kind: "box",
        size: [
          literal("length", 1),
          literal("length", 1),
          literal("length", 1),
        ],
        center: false,
      },
      bodies: {
        kind: "bodySet",
        bodies: [
          {
            id: "primary" as EntityId,
            solid: { node: "first" as NodeId, kind: "solid" },
          },
          {
            id: "secondary" as EntityId,
            solid: { node: "second" as NodeId, kind: "solid" },
          },
        ],
      },
      part: {
        kind: "part",
        geometry: { node: "bodies" as NodeId, kind: "bodySet" },
        partNumber: "MB-001",
        ...(withDensity
          ? { massDensity: literal("massDensity", 1e-6) }
          : {}),
      },
      assembly: {
        kind: "assembly",
        instances: [
          localPartInstance("multibody", { mode: "base" }),
        ],
      },
    },
    outputs: {
      product: { node: "assembly" as NodeId, kind: "assembly" },
    },
  } as unknown as DesignDocumentV7;
}

function overflowingBomAssemblyDocument(): DesignDocumentV7 {
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "local-assembly-overflowing-bom",
    units: { length: "mm", angle: "rad", mass: "kg" },
    parameters: {
      context: {
        dimension: "scalar",
        default: literal("scalar", 1),
      },
    },
    configurations: {
      alternate: {
        parameterOverrides: {
          context: literal("scalar", 1),
        },
      },
    },
    nodes: {
      solid: {
        kind: "box",
        size: [
          literal("length", 1),
          literal("length", 1),
          literal("length", 1),
        ],
        center: false,
      },
      part: {
        kind: "part",
        geometry: { node: "solid" as NodeId, kind: "solid" },
        partNumber: "OVERFLOW-001",
        massDensity: literal("massDensity", 1e308),
      },
      assembly: {
        kind: "assembly",
        instances: [
          localPartInstance("base", { mode: "base" }),
          localPartInstance("alternate", {
            mode: "named",
            id: "alternate" as ConfigurationId,
          }),
        ],
      },
    },
    outputs: {
      product: { node: "assembly" as NodeId, kind: "assembly" },
    },
  } as unknown as DesignDocumentV7;
}

async function resourceDigest(
  bytes: Uint8Array,
): Promise<ResourceDigestIR> {
  const value = await crypto.subtle.digest("SHA-256", bytes.slice());
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function capturedCadError(action: () => unknown): CadError {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CadError);
  return thrown as CadError;
}

describe("staged Document v7 local assembly evaluation", () => {
  it("batches parts by effective configuration and preserves contextual product intent", async () => {
    const harness = await instrumentedManifold();
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      {
        configuration: "wide",
        outputs: ["product", "alias", "empty"],
      },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    try {
      expect(result.value).toMatchObject({
        configurationId: "wide",
        parameters: { width: 20 },
        outputNames: ["product", "alias", "empty"],
      });
      const product = result.value.output("product");
      const alias = result.value.output("alias");
      expect(product).toBeInstanceOf(EvaluatedLocalAssemblyV7);
      expect(alias).not.toBe(product);
      expect(alias.occurrences).not.toBe(product.occurrences);
      expect(alias.occurrences.map((item) => item.part)).toEqual(
        product.occurrences.map((item) => item.part),
      );
      expect(product.occurrences.map((item) => item.id)).toEqual([
        "base",
        "inherit",
        "named",
        "named-again",
      ]);
      expect(
        product.occurrences.map((item) => item.configurationId),
      ).toEqual([null, "wide", "wide", "wide"]);
      expect(product.occurrences.map((item) => item.path)).toEqual([
        ["base"],
        ["inherit"],
        ["named"],
        ["named-again"],
      ]);
      expect(
        product.occurrences.every(
          (item) =>
            Object.isFrozen(item) &&
            Object.isFrozen(item.path) &&
            Object.isFrozen(item.transform),
        ),
      ).toBe(true);
      expect(product.occurrences[1]!.transform[12]).toBe(20);
      expect(product.occurrences[2]!.transform[0]).toBe(2);
      expect(product.occurrences[1]!.part).toBe(
        product.occurrences[2]!.part,
      );
      expect(product.occurrences[2]!.part).toBe(
        product.occurrences[3]!.part,
      );
      expect(product.occurrences[0]!.part).not.toBe(
        product.occurrences[1]!.part,
      );
      expect(product.occurrences[0]!.part.materialId).toBe("steel");
      expect(product.occurrences[1]!.part.materialId).toBe("aluminum");
      expect(harness.boxCalls).toHaveBeenCalledTimes(2);

      const mesh = product.mesh();
      expect(mesh.positions.length).toBeGreaterThan(0);
      expect(product.export("stl")).toBeInstanceOf(Uint8Array);
      expect(product.export("obj")).toContain("o product");
      expect(() =>
        (
          product.export as unknown as (format: string) => unknown
        )("step"),
      ).toThrow(/cannot be exported|unsupported/i);

      const bom = product.billOfMaterials();
      expect(bom.ok, JSON.stringify(bom.diagnostics)).toBe(true);
      if (bom.ok) {
        expect(bom.value.rootConfigurationId).toBe("wide");
        expect(
          bom.value.items.map((item) => ({
            configuration: item.effectiveConfigurationId,
            quantity: item.quantity,
            materialId: item.materialId,
          })),
        ).toEqual([
          { configuration: null, quantity: 1, materialId: "steel" },
          {
            configuration: "wide",
            quantity: 3,
            materialId: "aluminum",
          },
        ]);
        expect(bom.value.totalQuantity).toBe(4);
        expect(bom.value.totalMass).toBeCloseTo(0.00102, 12);
      }
      const physical = product.physicalMassProperties();
      expect(physical.ok, JSON.stringify(physical.diagnostics)).toBe(true);
      if (physical.ok) {
        expect(physical.value.mass).toBeCloseTo(0.00102, 12);
      }

      const empty = result.value.output("empty");
      expect(empty.occurrences).toEqual([]);
      expect(empty.mesh().positions).toHaveLength(0);
      const emptyBom = empty.billOfMaterials();
      expect(emptyBom.ok).toBe(true);
      if (emptyBom.ok) {
        expect(emptyBom.value).toMatchObject({
          items: [],
          totalQuantity: 0,
          massComplete: true,
          knownMass: 0,
          totalMass: 0,
        });
      }
      const emptyMass = empty.physicalMassProperties();
      expect(emptyMass.ok).toBe(true);
      if (emptyMass.ok) {
        expect(emptyMass.value).toEqual({
          mass: 0,
          centerOfMass: null,
          inertiaTensor: [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        });
      }
    } finally {
      result.value.dispose();
      result.value.dispose();
      harness.disposeBase();
    }
    expect(harness.disposedShapes).toHaveLength(2);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("applies caller parameters after every occurrence-selected configuration", async () => {
    const harness = await instrumentedManifold();
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      {
        configuration: "wide",
        parameters: { width: 30 },
        outputs: ["product"],
      },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.ok) {
      try {
        const product = result.value.output("product");
        expect(result.value.parameters.width).toBe(30);
        expect(product.occurrences[1]!.transform[12]).toBe(30);
        expect(
          harness.boxCalls.mock.calls.map((call) => call[0]),
        ).toEqual([
          [30, 2, 3],
          [30, 2, 3],
        ]);
      } finally {
        result.value.dispose();
      }
    }
    harness.disposeBase();
  });

  it("keeps suppressed unsupported components inert and rejects active ones before kernel or resolver work", async () => {
    const document = configuredAssemblyDocument();
    const nodes = document.nodes as Record<string, NodeIRV7>;
    nodes.nested = {
      kind: "assembly",
      instances: [],
    };
    const external = {
      id: "external" as EntityId,
      component: {
        source: "external" as const,
        resource: "external-document" as ResourceId,
        output: "main",
        outputKind: "part" as const,
      },
      configuration: { mode: "inherit" as const },
      placement: [],
      suppressed: true,
    };
    const nested = {
      id: "nested" as EntityId,
      component: {
        source: "local" as const,
        reference: {
          node: "nested" as NodeId,
          kind: "assembly" as const,
        },
      },
      configuration: { mode: "inherit" as const },
      placement: [],
      suppressed: true,
    };
    nodes.guard = {
      kind: "assembly",
      instances: [external, nested],
    };
    const guarded = {
      ...document,
      resources: {
        "external-document": {
          digest: `sha256:${"0".repeat(64)}` as const,
          byteLength: 10,
          mediaType: "application/vnd.invariantcad.document+json",
        },
      },
      nodes,
      outputs: {
        ...document.outputs,
        guard: { node: "guard" as NodeId, kind: "assembly" as const },
      },
      configurations: {
        ...document.configurations,
        exposeExternal: {
          instanceSuppressions: {
            guard: { external: false },
          },
        },
        exposeNested: {
          instanceSuppressions: {
            guard: { nested: false },
          },
        },
      },
    } as DesignDocumentV7;

    const harness = await instrumentedManifold();
    const resolver = vi.fn();
    const inert = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      guarded,
      { outputs: ["guard"], resolver },
    );
    expect(inert.ok, JSON.stringify(inert.diagnostics)).toBe(true);
    if (inert.ok) {
      expect(inert.value.output("guard").occurrences).toEqual([]);
      inert.value.dispose();
    }
    expect(resolver).not.toHaveBeenCalled();
    expect(harness.boxCalls).not.toHaveBeenCalled();

    for (const configuration of ["exposeExternal", "exposeNested"]) {
      const rejected = await evaluateLocalAssemblyOutputsV7(
        harness.kernel,
        guarded,
        { configuration, outputs: ["guard"], resolver },
      );
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) {
        expect(rejected.diagnostics[0]).toMatchObject({
          code: "EVALUATION_UNSUPPORTED",
        });
      }
    }
    expect(resolver).not.toHaveBeenCalled();
    expect(harness.boxCalls).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("enforces limits, cancellation, and accessor-free option capture", async () => {
    const harness = await instrumentedManifold();
    const limited = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      {
        outputs: ["product"],
        evaluationLimits: { maxActiveOccurrences: 3 },
      },
    );
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.diagnostics[0]).toMatchObject({
        code: "RESOURCE_LIMIT_EXCEEDED",
        details: {
          resource: "maxActiveOccurrences",
          limit: 3,
          actual: 4,
        },
      });
    }
    expect(harness.boxCalls).not.toHaveBeenCalled();

    let getterCalls = 0;
    const hostile = {};
    Object.defineProperty(hostile, "outputs", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return ["product"];
      },
    });
    const rejected = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      hostile,
    );
    expect(rejected.ok).toBe(false);
    expect(getterCalls).toBe(0);

    const controller = new AbortController();
    controller.abort();
    const aborted = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      {
        signal: controller.signal,
        outputs: new Proxy([] as string[], {
          ownKeys() {
            throw new Error("must not inspect outputs after abort");
          },
        }),
      },
    );
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) {
      expect(aborted.diagnostics[0]?.code).toBe("EVALUATION_ABORTED");
    }
    expect(harness.boxCalls).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("enforces every remaining local-assembly work ceiling before kernel work", async () => {
    const cases: readonly {
      readonly resource: keyof LocalAssemblyEvaluationLimitsV7;
      readonly limit: number;
      readonly actual: number;
      readonly outputs?: readonly string[];
      readonly parameters?: Readonly<Record<string, number>>;
    }[] = [
      {
        resource: "maxSelectedOutputs",
        limit: 1,
        actual: 2,
        outputs: ["product", "alias"],
      },
      {
        resource: "maxParameterOverrides",
        limit: 0,
        actual: 1,
        parameters: { width: 12 },
      },
      {
        resource: "maxScannedInstances",
        limit: 3,
        actual: 4,
      },
      {
        resource: "maxPlacementOperations",
        limit: 1,
        actual: 2,
      },
      {
        resource: "maxContextualParts",
        limit: 1,
        actual: 2,
      },
      {
        resource: "maxPartBodies",
        limit: 1,
        actual: 2,
      },
      {
        resource: "maxDistinctSolids",
        limit: 1,
        actual: 2,
      },
      {
        resource: "maxResolvedMaterials",
        limit: 3,
        actual: 4,
      },
    ];
    const harness = await instrumentedManifold();
    for (const testCase of cases) {
      const result = await evaluateLocalAssemblyOutputsV7(
        harness.kernel,
        configuredAssemblyDocument(),
        {
          outputs: testCase.outputs ?? ["product"],
          ...(testCase.parameters === undefined
            ? {}
            : { parameters: testCase.parameters }),
          evaluationLimits: {
            [testCase.resource]: testCase.limit,
          },
        },
      );
      expect(result.ok, testCase.resource).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]).toMatchObject({
          code: "RESOURCE_LIMIT_EXCEEDED",
          details: {
            resource: testCase.resource,
            limit: testCase.limit,
            actual: testCase.actual,
          },
        });
      }
    }
    expect(harness.boxCalls).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("rejects malformed and trap-backed output selections without invoking accessors or throwing", async () => {
    const sparse = new Array<string>(1);
    const extra = ["product"];
    Object.defineProperty(extra, "extra", {
      configurable: true,
      value: true,
    });
    const symbol = ["product"];
    Object.defineProperty(symbol, Symbol("extra"), {
      configurable: true,
      value: true,
    });
    const foreignPrototype = ["product"];
    Object.setPrototypeOf(
      foreignPrototype,
      Object.create(Array.prototype),
    );
    const substitutedKeys = new Proxy(["product"], {
      ownKeys: () => ["length", "1"],
    });
    const opaqueArray = new Proxy(["product"], {
      getOwnPropertyDescriptor() {
        throw { opaque: true };
      },
    });
    const revokedArray = Proxy.revocable(["product"], {});
    revokedArray.revoke();
    const revokedOptions = Proxy.revocable(
      { outputs: ["product"] },
      {},
    );
    revokedOptions.revoke();
    const cases: readonly {
      readonly name: string;
      readonly options: unknown;
    }[] = [
      { name: "sparse array", options: { outputs: sparse } },
      { name: "extra array key", options: { outputs: extra } },
      { name: "symbol array key", options: { outputs: symbol } },
      {
        name: "nonstandard array prototype",
        options: { outputs: foreignPrototype },
      },
      {
        name: "proxy-substituted array keys",
        options: { outputs: substitutedKeys },
      },
      {
        name: "opaque array descriptor trap",
        options: { outputs: opaqueArray },
      },
      {
        name: "revoked array proxy",
        options: { outputs: revokedArray.proxy },
      },
      {
        name: "opaque options prototype trap",
        options: new Proxy(
          {},
          {
            getPrototypeOf() {
              throw null;
            },
          },
        ),
      },
      {
        name: "opaque options ownKeys trap",
        options: new Proxy(
          {},
          {
            ownKeys() {
              throw Symbol("opaque");
            },
          },
        ),
      },
      {
        name: "revoked options proxy",
        options: revokedOptions.proxy,
      },
    ];
    const harness = await instrumentedManifold();
    for (const testCase of cases) {
      const result = await evaluateLocalAssemblyOutputsV7(
        harness.kernel,
        configuredAssemblyDocument(),
        testCase.options as never,
      );
      expect(result.ok, testCase.name).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]?.code, testCase.name).toBe(
          "IR_INVALID",
        );
      }
    }
    expect(harness.boxCalls).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("escapes caller-controlled JSON-pointer segments in diagnostics", async () => {
    const harness = await instrumentedManifold();
    const cases: readonly {
      readonly options: unknown;
      readonly path: string;
    }[] = [
      {
        options: { outputs: ["missing/~output"] },
        path: "/outputs/missing~1~0output",
      },
      {
        options: {
          outputs: ["product"],
          evaluationLimits: { "missing/~limit": 0 },
        },
        path: "/evaluationLimits/missing~1~0limit",
      },
      {
        options: { "missing/~option": true },
        path: "/missing~1~0option",
      },
    ];
    for (const testCase of cases) {
      const result = await evaluateLocalAssemblyOutputsV7(
        harness.kernel,
        configuredAssemblyDocument(),
        testCase.options as never,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]?.path).toBe(testCase.path);
      }
    }
    expect(harness.boxCalls).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("rolls back every acquired child shape when a kernel callback aborts evaluation", async () => {
    const controller = new AbortController();
    const harness = await instrumentedManifold(
      undefined,
      (index) => {
        if (index === 1) controller.abort();
      },
    );
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      {
        outputs: ["product"],
        signal: controller.signal,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe("EVALUATION_ABORTED");
    }
    expect(harness.boxCalls).toHaveBeenCalledTimes(2);
    expect(harness.disposedShapes).toHaveLength(2);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("rolls back every acquired child shape when a kernel callback mutates an intrinsic", async () => {
    const mutation = "__invariantCadLocalAssemblyMutation__";
    const original = Object.getOwnPropertyDescriptor(
      Array.prototype,
      mutation,
    );
    const harness = await instrumentedManifold(
      undefined,
      (index) => {
        if (index === 1) {
          Object.defineProperty(Array.prototype, mutation, {
            configurable: true,
            enumerable: true,
            value: true,
          });
        }
      },
    );
    let result:
      | Awaited<ReturnType<typeof evaluateLocalAssemblyOutputsV7>>
      | undefined;
    try {
      result = await evaluateLocalAssemblyOutputsV7(
        harness.kernel,
        configuredAssemblyDocument(),
        { outputs: ["product"] },
      );
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(Array.prototype, mutation);
      } else {
        Object.defineProperty(Array.prototype, mutation, original);
      }
    }
    expect(result?.ok).toBe(false);
    if (result !== undefined && !result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        details: { runtimeIntegrity: false },
      });
    }
    expect(harness.boxCalls).toHaveBeenCalledTimes(2);
    expect(harness.disposedShapes).toHaveLength(2);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("rolls back every completed configuration batch when a later batch fails", async () => {
    const harness = await instrumentedManifold(1);
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      {
        configuration: "wide",
        outputs: ["product"],
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "KERNEL_ERROR",
      });
    }
    expect(harness.boxCalls).toHaveBeenCalledTimes(2);
    expect(harness.disposedShapes).toHaveLength(1);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("contains a rejected child batch and rolls back completed configuration owners", async () => {
    const harness = await instrumentedManifold();
    const evaluatePartOutputsV7 =
      evaluatorModule.evaluatePartOutputsV7;
    let calls = 0;
    const child = vi
      .spyOn(evaluatorModule, "evaluatePartOutputsV7")
      .mockImplementation(async (...arguments_) => {
        const index = calls;
        calls += 1;
        if (index === 1) {
          throw Symbol("opaque-child-rejection");
        }
        return evaluatePartOutputsV7(...arguments_);
      });
    try {
      const result = await evaluateLocalAssemblyOutputsV7(
        harness.kernel,
        configuredAssemblyDocument(),
        {
          configuration: "wide",
          outputs: ["product"],
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]).toMatchObject({
          code: "KERNEL_ERROR",
          details: {
            phase: "documentV7LocalAssemblyEvaluation",
            effectiveConfigurationId: "wide",
          },
        });
      }
      expect(harness.boxCalls).toHaveBeenCalledTimes(1);
      expect(harness.disposedShapes).toHaveLength(1);
      expect(harness.disposeKernel).not.toHaveBeenCalled();
    } finally {
      child.mockRestore();
      harness.disposeBase();
    }
  });

  it("preserves multibody geometry and reports missing-density BOM mass as partial", async () => {
    const completeHarness = await instrumentedManifold();
    const complete = await evaluateLocalAssemblyOutputsV7(
      completeHarness.kernel,
      multibodyAssemblyDocument(true),
      { outputs: ["product"] },
    );
    expect(complete.ok, JSON.stringify(complete.diagnostics)).toBe(true);
    if (complete.ok) {
      try {
        const product = complete.value.output("product");
        const evaluatedPart = product.occurrences[0]!.part;
        expect(evaluatedPart.geometry.kind).toBe("bodySet");
        if (evaluatedPart.geometry.kind === "bodySet") {
          expect(evaluatedPart.geometry.bodySet.bodyIds).toEqual([
            "primary",
            "secondary",
          ]);
        }
        expect(product.mesh().indices.length).toBeGreaterThan(0);
        const bom = product.billOfMaterials();
        expect(bom.ok, JSON.stringify(bom.diagnostics)).toBe(true);
        if (bom.ok) {
          expect(bom.value).toMatchObject({
            totalQuantity: 1,
            massComplete: true,
            knownMass: expect.closeTo(25e-6, 12),
            totalMass: expect.closeTo(25e-6, 12),
            items: [
              expect.objectContaining({
                partNode: "part",
                quantity: 1,
                definitionMass: expect.closeTo(25e-6, 12),
                totalMass: expect.closeTo(25e-6, 12),
              }),
            ],
          });
        }
      } finally {
        complete.value.dispose();
      }
    }
    expect(completeHarness.boxCalls).toHaveBeenCalledTimes(2);
    expect(completeHarness.disposedShapes).toHaveLength(2);
    completeHarness.disposeBase();

    const partialHarness = await instrumentedManifold();
    const partial = await evaluateLocalAssemblyOutputsV7(
      partialHarness.kernel,
      multibodyAssemblyDocument(false),
      { outputs: ["product"] },
    );
    expect(partial.ok, JSON.stringify(partial.diagnostics)).toBe(true);
    if (partial.ok) {
      try {
        const product = partial.value.output("product");
        const bom = product.billOfMaterials();
        expect(bom.ok, JSON.stringify(bom.diagnostics)).toBe(true);
        if (bom.ok) {
          expect(bom.value).toMatchObject({
            totalQuantity: 1,
            massComplete: false,
            knownMass: 0,
            totalMass: null,
            items: [
              expect.objectContaining({
                partNode: "part",
                quantity: 1,
                massDensity: null,
                definitionMass: null,
                totalMass: null,
              }),
            ],
          });
          expect(bom.diagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: "MASS_DENSITY_MISSING",
              }),
            ]),
          );
        }
        const physical = product.physicalMassProperties();
        expect(physical.ok).toBe(false);
        if (!physical.ok) {
          expect(physical.diagnostics).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: "MASS_DENSITY_MISSING",
              }),
            ]),
          );
        }
      } finally {
        partial.value.dispose();
      }
    }
    expect(partialHarness.boxCalls).toHaveBeenCalledTimes(2);
    expect(partialHarness.disposedShapes).toHaveLength(2);
    partialHarness.disposeBase();
  });

  it("returns a structured failure when finite contextual BOM rows overflow in aggregate", async () => {
    const harness = await instrumentedManifold();
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      overflowingBomAssemblyDocument(),
      { outputs: ["product"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    try {
      const product = result.value.output("product");
      const bom = product.billOfMaterials();
      expect(bom.ok).toBe(false);
      if (!bom.ok) {
        expect(bom.diagnostics[0]).toMatchObject({
          code: "MASS_PROPERTIES_INVALID",
          node: "assembly",
          details: {
            phase: "documentV7LocalAssemblyEvaluation",
          },
        });
      }
    } finally {
      result.value.dispose();
      harness.disposeBase();
    }
  });

  it("resolves imported part bodies through verified resource commitments", async () => {
    const bytes = new Uint8Array([1, 3, 3, 7]);
    const commitment = await resourceDigest(bytes);
    const document = {
      schema: DOCUMENT_SCHEMA_V7,
      version: DOCUMENT_VERSION_V7,
      name: "local-assembly-import",
      units: { length: "mm", angle: "rad", mass: "kg" },
      parameters: {},
      resources: {
        imported: {
          digest: commitment,
          byteLength: bytes.byteLength,
          mediaType: "model/step",
          locations: ["project://fixtures/imported.step"],
        },
      },
      nodes: {
        imported: {
          kind: "importedBody",
          resource: "imported" as ResourceId,
          format: "step",
          units: { mode: "from-file" },
          healing: { mode: "none" },
          expected: "single-solid",
        },
        part: {
          kind: "part",
          geometry: {
            node: "imported" as NodeId,
            kind: "solid",
          },
          partNumber: "IMP-001",
        },
        assembly: {
          kind: "assembly",
          instances: [
            localPartInstance("imported", { mode: "base" }),
          ],
        },
      },
      outputs: {
        product: {
          node: "assembly" as NodeId,
          kind: "assembly",
        },
      },
    } as unknown as DesignDocumentV7;
    const shape: KernelShape = { kernel: "local-assembly-import-test" };
    const importDocumentBody = vi.fn(
      (
        ..._arguments: Parameters<
          NonNullable<GeometryKernel["importDocumentBody"]>
        >
      ): KernelShape => shape,
    );
    const disposeShape = vi.fn();
    const kernel: GeometryKernel = {
      id: "local-assembly-import-test",
      capabilities: {
        protocolVersion: 1,
        representation: "brep",
        exact: true,
        primitives: [],
        features: [],
        nativeImports: [],
        nativeExports: [],
        documentBodyImport: {
          protocolVersion:
            KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: [
            { format: "step", unitModes: ["from-file"] },
          ],
        },
      },
      importDocumentBody,
      status: () => ({ ok: true, code: "VALID" }),
      measure: () => ({
        volume: 1,
        surfaceArea: 6,
        boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
        centerOfMass: [0.5, 0.5, 0.5],
        inertiaTensor: [
          [1 / 6, 0, 0],
          [0, 1 / 6, 0],
          [0, 0, 1 / 6],
        ],
        genus: 0,
        tolerance: 1e-7,
      }),
      mesh: () => ({
        positions: new Float32Array([
          0, 0, 0,
          1, 0, 0,
          0, 1, 0,
        ]),
        indices: new Uint32Array([0, 1, 2]),
      }),
      disposeShape,
      dispose: vi.fn(),
    };
    const resolver = vi.fn(() => bytes);
    const result = await evaluateLocalAssemblyOutputsV7(
      kernel,
      document,
      { outputs: ["product"], resolver },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.ok) {
      expect(result.value.output("product").occurrences).toHaveLength(1);
      result.value.dispose();
    }
    expect(resolver).toHaveBeenCalledWith({
      id: "imported",
      digest: commitment,
      byteLength: bytes.byteLength,
      mediaType: "model/step",
      locations: ["project://fixtures/imported.step"],
    });
    expect(importDocumentBody).toHaveBeenCalledTimes(1);
    expect(importDocumentBody.mock.calls[0]?.[0]).toEqual(bytes);
    expect(importDocumentBody.mock.calls[0]?.[1]).toEqual({
      format: "step",
      units: { mode: "from-file" },
      healing: { mode: "none" },
    });
    expect(disposeShape).toHaveBeenCalledOnce();

    const mismatch = await evaluateLocalAssemblyOutputsV7(
      kernel,
      document,
      {
        outputs: ["product"],
        resolver: () => new Uint8Array([7, 3, 3, 1]),
      },
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "RESOURCE_INTEGRITY_MISMATCH",
          }),
        ]),
      );
    }
    expect(importDocumentBody).toHaveBeenCalledTimes(1);
    expect(disposeShape).toHaveBeenCalledOnce();
  });

  it("evaluates and disposes a placed local assembly with the stock OCCT kernel", async () => {
    const base = configuredAssemblyDocument();
    const document = {
      schema: base.schema,
      version: base.version,
      name: "local-assembly-occt-acceptance",
      units: base.units,
      parameters: base.parameters,
      materials: base.materials,
      nodes: {
        ...base.nodes,
        assembly: {
          kind: "assembly",
          instances: [
            localPartInstance(
              "left",
              { mode: "base" },
              [
                {
                  kind: "translate",
                  value: [
                    literal("length", -8),
                    literal("length", 0),
                    literal("length", 0),
                  ],
                },
              ],
            ),
            localPartInstance(
              "right",
              { mode: "base" },
              [
                {
                  kind: "translate",
                  value: [
                    literal("length", 8),
                    literal("length", 0),
                    literal("length", 0),
                  ],
                },
              ],
            ),
          ],
        },
      },
      outputs: {
        product: {
          node: "assembly" as NodeId,
          kind: "assembly",
        },
      },
    } as unknown as DesignDocumentV7;
    const kernel = await createOcctKernel();
    let retained:
      | ReturnType<
          EvaluatedLocalAssemblyV7["occurrences"][number]["part"]["mesh"]
        >
      | undefined;
    let retainedPart:
      | EvaluatedLocalAssemblyV7["occurrences"][number]["part"]
      | undefined;
    try {
      const result = await evaluateLocalAssemblyOutputsV7(
        kernel,
        document,
        { outputs: ["product"] },
      );
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      try {
        const product = result.value.output("product");
        expect(product.occurrences).toHaveLength(2);
        expect(
          product.occurrences.map(
            (occurrence) => occurrence.transform[12],
          ),
        ).toEqual([-8, 8]);
        expect(product.occurrences[0]!.part).toBe(
          product.occurrences[1]!.part,
        );
        retainedPart = product.occurrences[0]!.part;
        retained = product.mesh();
        expect(retained.indices.length).toBeGreaterThan(0);
        const bom = product.billOfMaterials();
        expect(bom.ok, JSON.stringify(bom.diagnostics)).toBe(true);
        if (bom.ok) {
          expect(bom.value).toMatchObject({
            totalQuantity: 2,
            massComplete: true,
            totalMass: expect.closeTo(120e-6, 12),
          });
        }
        const physical = product.physicalMassProperties();
        expect(physical.ok, JSON.stringify(physical.diagnostics)).toBe(
          true,
        );
        if (physical.ok) {
          expect(physical.value.mass).toBeCloseTo(120e-6, 12);
        }
      } finally {
        result.value.dispose();
      }
      expect(() => retainedPart?.mesh()).toThrow(/disposed/i);
    } finally {
      kernel.dispose();
    }
    expect(retained?.indices.length).toBeGreaterThan(0);
  });

  it("rejects finite placement operands whose composed matrix overflows before kernel work", async () => {
    const document = configuredAssemblyDocument();
    (document.nodes as Record<string, NodeIRV7>).assembly = {
      kind: "assembly",
      instances: [
        localPartInstance(
          "overflow",
          { mode: "base" },
          [
            {
              kind: "scale",
              value: [
                literal("scalar", 1e308),
                literal("scalar", 1),
                literal("scalar", 1),
              ],
            },
            {
              kind: "scale",
              value: [
                literal("scalar", 1e308),
                literal("scalar", 1),
                literal("scalar", 1),
              ],
            },
          ],
        ),
      ],
    };
    const harness = await instrumentedManifold();
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      document,
      { outputs: ["product"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "FEATURE_INVALID",
        node: "assembly",
        path: "/nodes/assembly/instances/0/placement/1",
        details: {
          phase: "documentV7LocalAssemblyEvaluation",
          value: "non-finite",
        },
      });
    }
    expect(harness.boxCalls).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("rejects Float32 overflow introduced by an otherwise finite placement matrix", async () => {
    const document = configuredAssemblyDocument();
    (document.nodes as Record<string, NodeIRV7>).assembly = {
      kind: "assembly",
      instances: [
        localPartInstance(
          "float-overflow",
          { mode: "base" },
          [
            {
              kind: "scale",
              value: [
                literal("scalar", 1e39),
                literal("scalar", 1),
                literal("scalar", 1),
              ],
            },
          ],
        ),
      ],
    };
    const harness = await instrumentedManifold();
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      document,
      { outputs: ["product"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    try {
      const error = capturedCadError(() =>
        result.value.output("product").mesh(),
      );
      expect(error.diagnostics[0]).toMatchObject({
        code: "KERNEL_ERROR",
        details: {
          reason: "placed-non-finite-position",
          occurrencePath: ["float-overflow"],
        },
      });
    } finally {
      result.value.dispose();
      harness.disposeBase();
    }
  });

  it("contains hostile mesh callbacks and admits only detached intrinsic mesh arrays", async () => {
    let behavior: (valid: MeshData) => unknown = (valid) => valid;
    const harness = await instrumentedManifold(
      undefined,
      undefined,
      (_shape, _options, valid) => behavior(valid),
    );
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      { outputs: ["product"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    try {
      const product = result.value.output("product");
      behavior = () => {
        throw Symbol("opaque-mesh-callback-failure");
      };
      const callbackError = capturedCadError(() => product.mesh());
      expect(callbackError.diagnostics[0]).toMatchObject({
        code: "KERNEL_ERROR",
        details: {
          reason: "mesh-callback-threw",
          protocolViolation: true,
        },
      });

      let accessorCalls = 0;
      const cases: readonly {
        readonly name: string;
        readonly reason: string;
        readonly value: (valid: MeshData) => unknown;
      }[] = [
        {
          name: "accessor-backed record",
          reason: "unsafe-mesh-record",
          value(valid) {
            const returned = { indices: valid.indices };
            Object.defineProperty(returned, "positions", {
              enumerable: true,
              get() {
                accessorCalls += 1;
                return valid.positions;
              },
            });
            return returned;
          },
        },
        {
          name: "revoked record proxy",
          reason: "unsafe-mesh-record",
          value(valid) {
            const revoked = Proxy.revocable(
              {
                positions: valid.positions,
                indices: valid.indices,
              },
              {},
            );
            revoked.revoke();
            return revoked.proxy;
          },
        },
        {
          name: "proxied positions",
          reason: "positions-not-intrinsic-float32-array",
          value: (valid) => ({
            positions: new Proxy(valid.positions, {}),
            indices: valid.indices,
          }),
        },
        {
          name: "Float32Array subclass",
          reason: "positions-not-intrinsic-float32-array",
          value(valid) {
            class DerivedPositions extends Float32Array {}
            return {
              positions: new DerivedPositions(valid.positions),
              indices: valid.indices,
            };
          },
        },
        {
          name: "SharedArrayBuffer backing",
          reason: "positions-not-intrinsic-float32-array",
          value(valid) {
            const positions = new Float32Array(
              new SharedArrayBuffer(valid.positions.byteLength),
            );
            positions.set(valid.positions);
            return { positions, indices: valid.indices };
          },
        },
        {
          name: "detached ArrayBuffer backing",
          reason: "positions-not-intrinsic-float32-array",
          value(valid) {
            const buffer = new ArrayBuffer(
              valid.positions.byteLength,
            );
            const positions = new Float32Array(buffer);
            positions.set(valid.positions);
            structuredClone(buffer, { transfer: [buffer] });
            return { positions, indices: valid.indices };
          },
        },
        {
          name: "non-finite position",
          reason: "non-finite-position",
          value: () => ({
            positions: new Float32Array([Number.NaN, 0, 0]),
            indices: new Uint32Array([0, 0, 0]),
          }),
        },
        {
          name: "incomplete XYZ",
          reason: "incomplete-xyz-positions",
          value: () => ({
            positions: new Float32Array([0, 0]),
            indices: new Uint32Array(),
          }),
        },
        {
          name: "incomplete triangle",
          reason: "incomplete-triangle-indices",
          value: () => ({
            positions: new Float32Array([0, 0, 0]),
            indices: new Uint32Array([0]),
          }),
        },
        {
          name: "out-of-bounds index",
          reason: "mesh-index-out-of-bounds",
          value: () => ({
            positions: new Float32Array([0, 0, 0]),
            indices: new Uint32Array([0, 1, 0]),
          }),
        },
      ];
      for (const testCase of cases) {
        behavior = testCase.value;
        const error = capturedCadError(() => product.mesh());
        expect(error.diagnostics[0], testCase.name).toMatchObject({
          code: "KERNEL_ERROR",
          details: {
            reason: testCase.reason,
            protocolViolation: true,
          },
        });
      }
      expect(accessorCalls).toBe(0);

      let retained: MeshData | undefined;
      behavior = (valid) => {
        retained = valid;
        return valid;
      };
      const accepted = product.mesh();
      expect(accepted.indices.length).toBeGreaterThan(0);
      const acceptedSnapshot = accepted.positions.slice();
      retained!.positions.fill(123);
      expect(accepted.positions).toEqual(acceptedSnapshot);
    } finally {
      result.value.dispose();
      harness.disposeBase();
    }
  });

  it("detects typed-array constructor mutation before aggregate mesh work", async () => {
    const harness = await instrumentedManifold();
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      { outputs: ["product"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "Float32Array",
    )!;
    try {
      Object.defineProperty(globalThis, "Float32Array", {
        ...descriptor,
        value: class HostileFloat32Array extends Float32Array {},
      });
      expect(() => result.value.output("product").mesh()).toThrow(
        /runtime intrinsics|integrity/i,
      );
    } finally {
      Object.defineProperty(globalThis, "Float32Array", descriptor);
      result.value.dispose();
      harness.disposeBase();
    }
  });

  it("detects DataView constructor and prototype mutation before binary assembly export", async () => {
    const harness = await instrumentedManifold();
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      { outputs: ["product"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    const product = result.value.output("product");
    const constructorDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "DataView",
    )!;
    const setFloat32Descriptor = Object.getOwnPropertyDescriptor(
      DataView.prototype,
      "setFloat32",
    )!;
    try {
      Object.defineProperty(globalThis, "DataView", {
        ...constructorDescriptor,
        value: class HostileDataView {},
      });
      const constructorError = capturedCadError(() =>
        product.export("stl"),
      );
      expect(constructorError.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        details: { runtimeIntegrity: false },
      });
    } finally {
      Object.defineProperty(
        globalThis,
        "DataView",
        constructorDescriptor,
      );
    }
    try {
      Object.defineProperty(DataView.prototype, "setFloat32", {
        ...setFloat32Descriptor,
        value: vi.fn(),
      });
      const prototypeError = capturedCadError(() =>
        product.export("stl"),
      );
      expect(prototypeError.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        details: { runtimeIntegrity: false },
      });
    } finally {
      Object.defineProperty(
        DataView.prototype,
        "setFloat32",
        setFloat32Descriptor,
      );
      expect(product.export("stl")).toBeInstanceOf(Uint8Array);
      result.value.dispose();
      harness.disposeBase();
    }
  });

  it("reports runtime corruption before disposed mesh and export state", async () => {
    const harness = await instrumentedManifold();
    const result = await evaluateLocalAssemblyOutputsV7(
      harness.kernel,
      configuredAssemblyDocument(),
      { outputs: ["product"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    const product = result.value.output("product");
    result.value.dispose();
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "Error",
    )!;
    try {
      const IntrinsicError = Error;
      Object.defineProperty(globalThis, "Error", {
        ...descriptor,
        value: class HostileError extends IntrinsicError {},
      });
      for (const operation of [
        () => product.mesh(),
        () => product.export("stl"),
      ]) {
        const error = capturedCadError(operation);
        expect(error.message).toMatch(/runtime intrinsics|integrity/i);
        expect(error.message).not.toMatch(/disposed/i);
      }
    } finally {
      Object.defineProperty(globalThis, "Error", descriptor);
      harness.disposeBase();
    }
  });
});
