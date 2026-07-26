import { describe, expect, it, vi } from "vitest";
import {
  OcctKernel as RawOcctKernel,
  type ShapeHandle,
} from "occt-wasm";
import type {
  EntityId,
  NodeId,
  ResourceId,
} from "../src/core/ids.js";
import { CadError } from "../src/core/result.js";
import {
  DEFAULT_PART_EVALUATION_LIMITS_V7,
  captureProductDocumentV7,
  executePreparedProductGeometryOutputsV7,
  preflightPreparedProductGeometryOutputsV7,
  prepareProductGeometryOutputsV7,
} from "../src/evaluator.js";
import {
  kgPerCubicMillimeter,
  mm,
  type ExpressionIR,
} from "../src/expressions.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type DesignDocumentV7,
  type ResourceDigestIR,
} from "../src/ir.js";
import {
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
  type GeometryKernel,
  type KernelDocumentBodyImportOptions,
  type KernelPrimitive,
  type KernelShape,
  type MeshData,
  type MeshOptions,
  type ShapeMeasurements,
} from "../src/kernel.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import {
  evaluateProductDocument,
  type EvaluateProductDocumentV7Options,
} from "../src/internal/document-v7-product-evaluation.js";
import {
  DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
  type ResourceResolverV7,
  type ResourceResolverRequestV7,
} from "../src/resource-resolution.js";
import { stringifyDocumentV7 } from "../src/serialization.js";
import {
  stagedBodySetDesignV7,
} from "../src/internal/document-v7-body-set-authoring.js";

const encoder = new TextEncoder();
const DOCUMENT_MEDIA_TYPE =
  "application/vnd.invariantcad.document+json";

const literal = (
  dimension: "scalar" | "length" | "angle" | "massDensity",
  value: number,
): ExpressionIR => ({
  op: "literal",
  dimension,
  value,
});

const parameter = (id: string): ExpressionIR => ({
  op: "parameter",
  dimension: "length",
  id: id as never,
});

function partInstance(
  id: string,
  configuration: "inherit" | "base" = "inherit",
) {
  return {
    id: id as EntityId,
    component: {
      source: "local" as const,
      reference: {
        node: "part" as NodeId,
        kind: "part" as const,
      },
    },
    configuration: { mode: configuration },
    placement: [],
    suppressed: false,
  };
}

function assemblyInstance(id: string, node: string) {
  return {
    id: id as EntityId,
    component: {
      source: "local" as const,
      reference: {
        node: node as NodeId,
        kind: "assembly" as const,
      },
    },
    configuration: { mode: "inherit" as const },
    placement: [],
    suppressed: false,
  };
}

function mixedProductDocument(): DesignDocumentV7 {
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "mixed-product-evaluation",
    units: { length: "mm", angle: "rad", mass: "kg" },
    parameters: {
      width: {
        dimension: "length",
        default: literal("length", 4),
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
          width: literal("length", 8),
        },
        partMaterialOverrides: {
          part: "aluminum" as never,
        },
        instanceSuppressions: {
          productAssembly: {
            suppressed: true,
          },
        },
      },
    },
    nodes: {
      shared: {
        kind: "box",
        size: [
          parameter("width"),
          literal("length", 2),
          literal("length", 3),
        ],
        center: false,
      },
      other: {
        kind: "sphere",
        radius: literal("length", 1),
        segments: 24,
      },
      bodies: {
        kind: "bodySet",
        bodies: [
          {
            id: "shared-body" as EntityId,
            solid: { node: "shared" as NodeId, kind: "solid" },
          },
          {
            id: "other-body" as EntityId,
            solid: { node: "other" as NodeId, kind: "solid" },
          },
        ],
      },
      part: {
        kind: "part",
        geometry: { node: "shared" as NodeId, kind: "solid" },
        partNumber: "P-001",
        materialId: "steel" as never,
      },
      childAssembly: {
        kind: "assembly",
        instances: [partInstance("leaf")],
      },
      productAssembly: {
        kind: "assembly",
        instances: [
          partInstance("direct"),
          assemblyInstance("nested", "childAssembly"),
          partInstance("suppressed"),
        ],
      },
    },
    outputs: {
      direct: { node: "shared" as NodeId, kind: "solid" },
      directAlias: { node: "shared" as NodeId, kind: "solid" },
      bodies: { node: "bodies" as NodeId, kind: "bodySet" },
      bodiesAlias: { node: "bodies" as NodeId, kind: "bodySet" },
      partOutput: { node: "part" as NodeId, kind: "part" },
      partAlias: { node: "part" as NodeId, kind: "part" },
      product: {
        node: "productAssembly" as NodeId,
        kind: "assembly",
      },
      productAlias: {
        node: "productAssembly" as NodeId,
        kind: "assembly",
      },
    },
  } as unknown as DesignDocumentV7;
}

function bodySetPartProductDocument(): DesignDocumentV7 {
  const document = structuredClone(
    mixedProductDocument(),
  ) as unknown as {
    nodes: Record<
      string,
      {
        geometry?: {
          node: NodeId;
          kind: "solid" | "bodySet";
        };
      }
    >;
  };
  document.nodes.part!.geometry = {
    node: "bodies" as NodeId,
    kind: "bodySet",
  };
  return document as unknown as DesignDocumentV7;
}

interface FakeShape extends KernelShape {
  readonly serial: number;
  readonly source: KernelPrimitive | "imported";
  readonly arguments: readonly unknown[];
}

interface PrimitiveCall {
  readonly kind: KernelPrimitive;
  readonly arguments: readonly unknown[];
  readonly shape: FakeShape;
}

interface ImportCall {
  readonly bytes: Uint8Array;
  readonly options: KernelDocumentBodyImportOptions;
  readonly shape: FakeShape;
}

interface KernelHarnessOptions {
  readonly failPrimitiveCall?: number;
  readonly thrownPrimitiveValue?: unknown;
  readonly afterAcquire?: (shape: FakeShape, index: number) => void;
  readonly aliasSecondPrimitiveToFirst?: boolean;
  readonly throwOnDisposeSerial?: number;
  readonly meshHook?: (
    shape: FakeShape,
    valid: MeshData,
  ) => unknown;
}

interface KernelHarness {
  readonly kernel: GeometryKernel;
  readonly primitiveCalls: PrimitiveCall[];
  readonly importCalls: ImportCall[];
  readonly measureCalls: FakeShape[];
  readonly meshCalls: FakeShape[];
  readonly exportCalls: FakeShape[];
  readonly disposed: FakeShape[];
  readonly live: ReadonlySet<FakeShape>;
  readonly disposeKernel: ReturnType<typeof vi.fn>;
  readonly encodeShapeArtifact: ReturnType<typeof vi.fn>;
  readonly decodeShapeArtifact: ReturnType<typeof vi.fn>;
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

function createKernelHarness(
  options: KernelHarnessOptions = {},
): KernelHarness {
  const primitiveCalls: PrimitiveCall[] = [];
  const importCalls: ImportCall[] = [];
  const measureCalls: FakeShape[] = [];
  const meshCalls: FakeShape[] = [];
  const exportCalls: FakeShape[] = [];
  const disposed: FakeShape[] = [];
  const live = new Set<FakeShape>();
  const disposeKernel = vi.fn();
  const encodeShapeArtifact = vi.fn(() => new Uint8Array([1]));
  const decodeShapeArtifact = vi.fn(
    (): KernelShape => ({
      kernel: "document-v7-product-test",
      serial: -1,
      source: "imported",
      arguments: [],
    }) as FakeShape,
  );
  let serial = 0;
  let primitiveIndex = 0;
  let firstPrimitive: FakeShape | undefined;

  const acquire = (
    source: FakeShape["source"],
    arguments_: readonly unknown[],
  ): FakeShape => {
    const shape: FakeShape = {
      kernel: "document-v7-product-test",
      serial,
      source,
      arguments: arguments_,
    };
    serial += 1;
    live.add(shape);
    return shape;
  };

  const primitive = (
    kind: KernelPrimitive,
  ): ((...arguments_: unknown[]) => KernelShape) =>
    (...arguments_) => {
      const index = primitiveIndex;
      primitiveIndex += 1;
      if (index === options.failPrimitiveCall) {
        throw options.thrownPrimitiveValue ?? new Error("injected failure");
      }
      const provisional = acquire(kind, arguments_);
      let shape = provisional;
      if (options.aliasSecondPrimitiveToFirst && index === 1) {
        live.delete(provisional);
        shape = firstPrimitive!;
      } else if (firstPrimitive === undefined) {
        firstPrimitive = provisional;
      }
      primitiveCalls.push({ kind, arguments: arguments_, shape });
      options.afterAcquire?.(shape, index);
      return shape;
    };

  const kernel: GeometryKernel = {
    id: "document-v7-product-test",
    capabilities: {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: ["box", "cylinder", "sphere"],
      features: [],
      nativeImports: [],
      nativeExports: ["step", "brep", "brep-binary"],
      shapeArtifacts: {
        protocolVersion: KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
        format: "application/x-invariantcad-test-shape",
        formatVersion: 1,
        compatibilityFingerprint: "document-v7-product-test-v1",
      },
      documentBodyImport: {
        protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
        formats: [{ format: "step", unitModes: ["from-file"] }],
      },
    },
    box: primitive("box") as NonNullable<GeometryKernel["box"]>,
    cylinder: primitive("cylinder") as NonNullable<
      GeometryKernel["cylinder"]
    >,
    sphere: primitive("sphere") as NonNullable<GeometryKernel["sphere"]>,
    importDocumentBody(
      bytes: Uint8Array,
      importOptions: KernelDocumentBodyImportOptions,
    ): KernelShape {
      const shape = acquire("imported", [bytes, importOptions]);
      importCalls.push({
        bytes: bytes.slice(),
        options: importOptions,
        shape,
      });
      return shape;
    },
    encodeShapeArtifact,
    decodeShapeArtifact,
    mesh(shape: KernelShape, _options?: MeshOptions): MeshData {
      const candidate = shape as FakeShape;
      meshCalls[meshCalls.length] = candidate;
      const valid = {
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
      return (options.meshHook?.(candidate, valid) ??
        valid) as MeshData;
    },
    measure(shape: KernelShape): ShapeMeasurements {
      const candidate = shape as FakeShape;
      measureCalls.push(candidate);
      const size =
        candidate.source === "box" &&
        Array.isArray(candidate.arguments[0])
          ? (candidate.arguments[0] as readonly number[])
          : undefined;
      const volume =
        size === undefined
          ? defaultMeasurement.volume + candidate.serial
          : size[0]! * size[1]! * size[2]!;
      return { ...defaultMeasurement, volume };
    },
    status(shape: KernelShape) {
      return live.has(shape as FakeShape)
        ? { ok: true, code: "VALID" }
        : {
            ok: false,
            code: "DISPOSED",
            message: "shape is no longer live",
          };
    },
    exportShape(shape: KernelShape): Uint8Array {
      const candidate = shape as FakeShape;
      exportCalls.push(candidate);
      return encoder.encode(`shape:${candidate.serial}`);
    },
    disposeShape(shape: KernelShape): void {
      const candidate = shape as FakeShape;
      if (!live.delete(candidate)) {
        throw new Error(`Shape ${candidate.serial} was disposed twice`);
      }
      disposed.push(candidate);
      if (candidate.serial === options.throwOnDisposeSerial) {
        throw new Error(`injected dispose failure for ${candidate.serial}`);
      }
    },
    dispose: disposeKernel,
  };
  return {
    kernel,
    primitiveCalls,
    importCalls,
    measureCalls,
    meshCalls,
    exportCalls,
    disposed,
    live,
    disposeKernel,
    encodeShapeArtifact,
    decodeShapeArtifact,
  };
}

function expectFailureCode(
  result: Awaited<ReturnType<typeof evaluateProductDocument>>,
  code: string,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code })]),
  );
}

async function digest(bytes: Uint8Array): Promise<ResourceDigestIR> {
  const hashed = await crypto.subtle.digest("SHA-256", bytes.slice());
  return `sha256:${[...new Uint8Array(hashed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function importedMixedDocument(
  bytes: Uint8Array,
  format: "step" | "brep" = "step",
): Promise<DesignDocumentV7> {
  const document = mixedProductDocument();
  const { configurations: _configurations, ...base } = document;
  return {
    ...base,
    resources: {
      sharedStep: {
        digest: await digest(bytes),
        byteLength: bytes.byteLength,
        mediaType: `model/${format}`,
        locations: [`project://mixed/shared.${format}`],
      },
    },
    nodes: {
      shared: {
        kind: "importedBody",
        resource: "sharedStep" as ResourceId,
        format,
        units:
          format === "step"
            ? { mode: "from-file" }
            : { mode: "declared", length: "mm" },
        healing: { mode: "none" },
        expected: "single-solid",
      },
      bodies: {
        kind: "bodySet",
        bodies: [
          {
            id: "shared-body" as EntityId,
            solid: { node: "shared" as NodeId, kind: "solid" },
          },
        ],
      },
      part: document.nodes["part" as NodeId]!,
      productAssembly: {
        kind: "assembly",
        instances: [partInstance("direct")],
      },
    },
    outputs: {
      direct: { node: "shared" as NodeId, kind: "solid" },
      bodies: { node: "bodies" as NodeId, kind: "bodySet" },
      partOutput: { node: "part" as NodeId, kind: "part" },
      product: {
        node: "productAssembly" as NodeId,
        kind: "assembly",
      },
    },
  } as unknown as DesignDocumentV7;
}

interface CommittedDocument {
  readonly document: DesignDocumentV7;
  readonly bytes: Uint8Array;
  readonly digest: ResourceDigestIR;
}

async function commitDocument(
  document: DesignDocumentV7,
): Promise<CommittedDocument> {
  const bytes = encoder.encode(stringifyDocumentV7(document));
  return {
    document,
    bytes,
    digest: await digest(bytes),
  };
}

async function scopedExternalProductFixture(): Promise<{
  readonly document: DesignDocumentV7;
  readonly child: CommittedDocument;
  readonly rootBody: Uint8Array;
  readonly childBody: Uint8Array;
}> {
  const rootBody = encoder.encode("root scoped STEP body");
  const childBody = encoder.encode("child scoped STEP body");

  const childCad = stagedBodySetDesignV7("scoped-child-module");
  const childResource = childCad.resource("sharedBody", {
    digest: await digest(childBody),
    byteLength: childBody.byteLength,
    mediaType: "model/step",
    locations: ["project://child/shared.step"],
  });
  const childSolid = childCad.importedBody(
    "child-import",
    childResource,
    {
      format: "step",
      units: { mode: "from-file" },
    },
  );
  const childPart = childCad.part("child-part", childSolid, {
    partNumber: "CHILD-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const childModule = childCad.assembly(
    "child-module",
    (instances) => {
      instances.instance("child-leaf", childPart);
    },
  );
  childCad.output("module", childModule);
  const child = await commitDocument(childCad.build());

  const rootCad = stagedBodySetDesignV7("scoped-root-product");
  const rootBodyResource = rootCad.resource("sharedBody", {
    digest: await digest(rootBody),
    byteLength: rootBody.byteLength,
    mediaType: "model/step",
    locations: ["project://root/shared.step"],
  });
  const rootImport = rootCad.importedBody(
    "root-import",
    rootBodyResource,
    {
      format: "step",
      units: { mode: "from-file" },
    },
  );
  const modeled = rootCad.box("modeled", {
    size: [mm(3), mm(2), mm(1)],
  });
  const childDocumentResource = rootCad.resource("childDocument", {
    digest: child.digest,
    byteLength: child.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
    locations: ["project://root/child.invariantcad"],
  });
  const external = rootCad.externalAssembly(
    childDocumentResource,
    "module",
  );
  const product = rootCad.assembly("product", (instances) => {
    instances.instance("external-module", external, {
      configuration: { mode: "base" },
    });
  });
  rootCad.output("rootImport", rootImport);
  rootCad.output("product", product);
  const rootDocument = rootCad.build();
  return {
    document: {
      ...rootDocument,
      outputs: {
        ...rootDocument.outputs,
        modeled: { node: modeled.node, kind: "solid" },
      },
    },
    child,
    rootBody,
    childBody,
  };
}

function scopedRequestKey(request: ResourceResolverRequestV7): string {
  const scope = request.documentScope;
  if (scope?.source === "root") {
    return `root:${request.id}`;
  }
  if (scope?.source === "external") {
    return `external:${scope.resource}:${request.id}`;
  }
  return `unscoped:${request.id}`;
}

async function occtMixedProductDocument(
  stepBytes: Uint8Array,
): Promise<DesignDocumentV7> {
  const cad = stagedBodySetDesignV7("occt-mixed-product");
  const stepResource = cad.resource("committedStep", {
    digest: await digest(stepBytes),
    byteLength: stepBytes.byteLength,
    mediaType: "model/step",
    locations: ["project://occt/committed.step"],
  });
  const imported = cad.importedBody(
    "imported",
    stepResource,
    {
      format: "step",
      units: { mode: "from-file" },
    },
  );
  const modeled = cad.box("modeled", {
    size: [mm(4), mm(3), mm(2)],
  });
  const bodies = cad.bodySet("mixedBodies", [
    { id: "modeled-body", solid: modeled },
    { id: "imported-body", solid: imported },
  ]);
  const importedPart = cad.part("importedPart", imported, {
    partNumber: "IMPORTED-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const product = cad.assembly("product", (instances) => {
    instances.instance("imported-occurrence", importedPart);
  });
  cad.output("imported", imported);
  cad.output("bodies", bodies);
  cad.output("importedPart", importedPart);
  cad.output("product", product);
  const document = cad.build();
  return {
    ...document,
    outputs: {
      ...document.outputs,
      modeled: { node: modeled.node, kind: "solid" },
    },
  };
}

describe("staged document-v7 mixed product evaluation", () => {
  it("preserves ordered aliases while sharing definitions and one atomic owner", async () => {
    const harness = createKernelHarness();
    const selected = [
      "productAlias",
      "direct",
      "bodies",
      "partAlias",
      "product",
      "directAlias",
      "partOutput",
      "bodiesAlias",
      "direct",
    ];
    const result = await evaluateProductDocument(
      harness.kernel,
      mixedProductDocument(),
      { configuration: "wide", outputs: selected },
    );

    expect(
      result.ok,
      JSON.stringify({
        diagnostics: result.diagnostics,
        primitiveCalls: harness.primitiveCalls,
        measureCalls: harness.measureCalls,
      }),
    ).toBe(true);
    if (!result.ok) return;
    const evaluated = result.value;
    const retained = [...evaluated.outputs];
    try {
      expect(evaluated.outputNames).toEqual([
        "productAlias",
        "direct",
        "bodies",
        "partAlias",
        "product",
        "directAlias",
        "partOutput",
        "bodiesAlias",
      ]);
      expect(evaluated.outputs.map(({ name, kind }) => ({ name, kind }))).toEqual([
        { name: "productAlias", kind: "assembly" },
        { name: "direct", kind: "solid" },
        { name: "bodies", kind: "bodySet" },
        { name: "partAlias", kind: "part" },
        { name: "product", kind: "assembly" },
        { name: "directAlias", kind: "solid" },
        { name: "partOutput", kind: "part" },
        { name: "bodiesAlias", kind: "bodySet" },
      ]);
      expect(Object.isFrozen(evaluated)).toBe(true);
      expect(Object.isFrozen(evaluated.outputs)).toBe(true);
      expect(Object.isFrozen(evaluated.outputNames)).toBe(true);
      expect(evaluated.outputs.every(Object.isFrozen)).toBe(true);
      expect(evaluated.configurationId).toBe("wide");
      expect(evaluated.parameters).toEqual({ width: 8 });

      const direct = evaluated.solid("direct");
      const directAlias = evaluated.solid("directAlias");
      const bodies = evaluated.bodySet("bodies");
      const bodiesAlias = evaluated.bodySet("bodiesAlias");
      const part = evaluated.part("partOutput");
      const partAlias = evaluated.part("partAlias");
      const product = evaluated.assembly("product");
      const productAlias = evaluated.assembly("productAlias");

      expect(direct).not.toBe(directAlias);
      expect(direct.name).toBe("direct");
      expect(directAlias.name).toBe("directAlias");
      expect(bodies).not.toBe(bodiesAlias);
      expect(bodies.name).toBe("bodies");
      expect(bodiesAlias.name).toBe("bodiesAlias");
      expect(part).not.toBe(partAlias);
      expect(part.name).toBe("partOutput");
      expect(partAlias.name).toBe("partAlias");
      expect(part.geometry.kind).toBe("solid");
      expect(partAlias.geometry.kind).toBe("solid");
      if (
        part.geometry.kind === "solid" &&
        partAlias.geometry.kind === "solid"
      ) {
        expect(part.geometry.solid).not.toBe(
          partAlias.geometry.solid,
        );
        expect(part.geometry.solid.name).toBe("partOutput");
        expect(partAlias.geometry.solid.name).toBe("partAlias");
      }
      expect(product).not.toBe(productAlias);
      expect(product.name).toBe("product");
      expect(productAlias.name).toBe("productAlias");
      expect(() => evaluated.output("direct", "part")).toThrow(TypeError);
      expect(() => evaluated.output("missing")).toThrow(RangeError);

      expect(product.occurrences.map((occurrence) => occurrence.path)).toEqual([
        ["direct"],
        ["nested", "leaf"],
      ]);
      expect(productAlias.occurrences).not.toBe(product.occurrences);
      expect(productAlias.occurrences[0]!.part).toBe(
        product.occurrences[0]!.part,
      );
      expect(part.materialId).toBe("aluminum");
      expect(part.massDensity).toBe(2e-6);

      const observationStart = harness.measureCalls.length;
      direct.measure();
      directAlias.measure();
      bodies.body("shared-body").solid.measure();
      bodiesAlias.body("shared-body").solid.measure();
      expect(part.geometry.kind).toBe("solid");
      if (part.geometry.kind !== "solid") return;
      part.geometry.solid.measure();
      const firstOccurrence = product.occurrences[0];
      expect(firstOccurrence).toBeDefined();
      if (firstOccurrence === undefined) return;
      const occurrenceGeometry = firstOccurrence.part.geometry;
      expect(occurrenceGeometry.kind).toBe("solid");
      if (occurrenceGeometry.kind === "solid") {
        occurrenceGeometry.solid.measure();
      }
      expect(
        new Set(harness.measureCalls.slice(observationStart)),
      ).toHaveLength(1);

      expect(harness.primitiveCalls.filter(({ kind }) => kind === "box")).toHaveLength(
        1,
      );
      expect(
        harness.primitiveCalls.filter(({ kind }) => kind === "sphere"),
      ).toHaveLength(1);
      expect(direct.export("step")).toBeInstanceOf(Uint8Array);
      expect(() =>
        evaluated.export("step" as never),
      ).toThrowError(CadError);
      expect(harness.encodeShapeArtifact).not.toHaveBeenCalled();
      expect(harness.decodeShapeArtifact).not.toHaveBeenCalled();
    } finally {
      evaluated.dispose();
      evaluated.dispose();
    }

    expect(harness.disposed).toHaveLength(2);
    expect(new Set(harness.disposed)).toHaveLength(2);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
    for (const output of retained) {
      const view =
        output.kind === "solid"
          ? output.solid
          : output.kind === "bodySet"
            ? output.bodySet
            : output.kind === "part"
              ? output.part
              : output.assembly;
      expect(() => view.mesh()).toThrow(/disposed/i);
    }
    expect(() => result.value.output("direct")).toThrow(/disposed/i);
  });

  it("retains approximate Manifold fidelity without claiming exact aggregate exchange", async () => {
    const kernel = await createManifoldKernel();
    try {
      const result = await evaluateProductDocument(
        kernel,
        mixedProductDocument(),
        {
          configuration: "wide",
          outputs: ["direct", "bodies", "partOutput", "product"],
        },
      );
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      try {
        expect(result.value.solid("direct").measure().volume).toBeCloseTo(48);
        expect(result.value.bodySet("bodies").representation).toBe("mesh");
        expect(result.value.bodySet("bodies").exact).toBe(false);
        expect(result.value.part("partOutput").representation).toBe("mesh");
        expect(result.value.part("partOutput").exact).toBe(false);

        const physical = result.value
          .part("partOutput")
          .physicalMassProperties();
        expect(physical.ok, JSON.stringify(physical.diagnostics)).toBe(true);
        if (physical.ok) {
          expect(physical.value.mass).toBeCloseTo(48 * 2e-6);
        }
        const assembly = result.value.assembly("product");
        expect(assembly.occurrences.map(({ path }) => path)).toEqual([
          ["direct"],
          ["nested", "leaf"],
        ]);
        const bom = assembly.billOfMaterials();
        expect(bom.ok, JSON.stringify(bom.diagnostics)).toBe(true);
        if (bom.ok) {
          expect(bom.value.totalQuantity).toBe(2);
          expect(bom.value.items).toHaveLength(1);
          expect(bom.value.items[0]).toMatchObject({
            partNumber: "P-001",
            materialId: "aluminum",
            quantity: 2,
          });
        }
        expect(result.value.mesh().indices.length).toBeGreaterThan(0);
        expect(result.value.export("obj")).toContain("v ");
        expect(() =>
          result.value.export("step" as never),
        ).toThrowError(CadError);
      } finally {
        result.value.dispose();
      }
    } finally {
      kernel.dispose();
    }
  });

  it("wraps malformed and opaque direct-leaf meshes with alias and node provenance", async () => {
    for (const testCase of [
      {
        name: "malformed",
        meshHook: () => ({
          positions: new Float32Array([0, 0]),
          indices: new Uint32Array([0, 1, 2]),
        }),
        reason: "incomplete-xyz-positions",
      },
      {
        name: "opaque callback",
        meshHook: () => {
          throw Object.create(null) as unknown;
        },
        reason: "mesh-callback-threw",
      },
    ] as const) {
      const harness = createKernelHarness({
        meshHook: testCase.meshHook,
      });
      const result = await evaluateProductDocument(
        harness.kernel,
        mixedProductDocument(),
        { outputs: ["direct"] },
      );
      expect(
        result.ok,
        `${testCase.name}: ${JSON.stringify(result.diagnostics)}`,
      ).toBe(true);
      if (!result.ok) continue;
      let thrown: unknown;
      try {
        result.value.mesh();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, testCase.name).toBeInstanceOf(CadError);
      expect(
        (thrown as CadError).diagnostics[0],
        testCase.name,
      ).toMatchObject({
        code: "KERNEL_ERROR",
        node: "shared",
        path: "/outputs/direct",
        details: {
          phase: "documentV7ProductEvaluation",
          output: "direct",
          outputKind: "solid",
          reason: testCase.reason,
          protocolViolation: true,
        },
      });
      result.value.dispose();
      expect(harness.disposed, testCase.name).toHaveLength(1);
      expect(harness.live.size, testCase.name).toBe(0);
      expect(harness.disposeKernel, testCase.name).not.toHaveBeenCalled();
    }
  });

  it("keeps product export diagnostics structured for hostile values and opaque callbacks", async () => {
    const harness = createKernelHarness({
      meshHook: () => {
        throw Symbol("opaque mesh export failure");
      },
    });
    const result = await evaluateProductDocument(
      harness.kernel,
      mixedProductDocument(),
      { outputs: ["direct"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const { proxy: hostileFormat, revoke } = Proxy.revocable(
      Object.create(null),
      {},
    );
    revoke();
    let unsupported: unknown;
    try {
      result.value.export(hostileFormat as never);
    } catch (error) {
      unsupported = error;
    }
    expect(unsupported).toBeInstanceOf(CadError);
    expect((unsupported as CadError).diagnostics[0]).toMatchObject({
      code: "EXPORT_UNSUPPORTED",
      details: {
        phase: "documentV7ProductEvaluation",
        format: "unsupported value",
        aggregateExactExchange: false,
      },
    });

    let callbackFailure: unknown;
    try {
      result.value.export("obj");
    } catch (error) {
      callbackFailure = error;
    }
    expect(callbackFailure).toBeInstanceOf(CadError);
    expect((callbackFailure as CadError).diagnostics[0]).toMatchObject({
      code: "KERNEL_ERROR",
      node: "shared",
      path: "/outputs/direct",
      details: {
        phase: "documentV7ProductEvaluation",
        output: "direct",
        outputKind: "solid",
        reason: "mesh-callback-threw",
      },
    });
    result.value.dispose();
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);
  });

  it("retains stock OCCT exact leaves while every mixed aggregate stays mesh-only", async () => {
    const raw = await RawOcctKernel.init();
    let fixtureShape: ShapeHandle | undefined;
    let stepBytes: Uint8Array;
    try {
      fixtureShape = raw.makeBox(6, 5, 4);
      stepBytes = encoder.encode(raw.exportStep(fixtureShape));
    } finally {
      if (fixtureShape !== undefined) raw.release(fixtureShape);
      raw[Symbol.dispose]();
    }

    const document = await occtMixedProductDocument(stepBytes);
    const resolver = vi.fn(() => stepBytes);
    const kernel = await createOcctKernel();
    const liveShapes = (
      kernel as GeometryKernel & {
        readonly liveShapes: ReadonlySet<unknown>;
      }
    ).liveShapes;
    const liveBefore = liveShapes.size;
    try {
      const result = await evaluateProductDocument(kernel, document, {
        outputs: [
          "modeled",
          "imported",
          "bodies",
          "importedPart",
          "product",
        ],
        resolver,
      });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      try {
        expect(resolver).toHaveBeenCalledTimes(1);
        expect(liveShapes.size).toBe(liveBefore + 2);
        const modeled = result.value.solid("modeled");
        const imported = result.value.solid("imported");
        const bodies = result.value.bodySet("bodies");
        const part = result.value.part("importedPart");
        expect([modeled, imported]).toEqual([
          expect.objectContaining({
            name: "modeled",
          }),
          expect.objectContaining({
            name: "imported",
          }),
        ]);
        expect(bodies).toMatchObject({
          representation: "brep",
          exact: true,
          bodyIds: ["modeled-body", "imported-body"],
        });
        expect(part).toMatchObject({
          representation: "brep",
          exact: true,
          partNumber: "IMPORTED-001",
        });
        expect(modeled.measure().volume).toBeCloseTo(24, 8);
        expect(imported.measure().volume).toBeCloseTo(120, 8);

        const exactLeaves = [
          modeled,
          imported,
          bodies.body("modeled-body").solid,
          bodies.body("imported-body").solid,
        ];
        expect(part.geometry.kind).toBe("solid");
        if (part.geometry.kind === "solid") {
          exactLeaves.push(part.geometry.solid);
        }
        const occurrence = result.value
          .assembly("product")
          .occurrences[0]!;
        expect(occurrence.part.geometry.kind).toBe("solid");
        if (occurrence.part.geometry.kind === "solid") {
          exactLeaves.push(occurrence.part.geometry.solid);
        }
        for (const leaf of exactLeaves) {
          const topology = leaf.topology();
          expect(
            topology.ok,
            JSON.stringify(topology.diagnostics),
          ).toBe(true);
          if (topology.ok) {
            expect(topology.value.faces.length).toBeGreaterThan(0);
            expect(topology.value.edges.length).toBeGreaterThan(0);
            expect(topology.value.vertices.length).toBeGreaterThan(0);
          }
          const step = leaf.export("step");
          expect(step).toBeInstanceOf(Uint8Array);
          expect(step.byteLength).toBeGreaterThan(100);
        }

        expect(result.value.mesh().indices.length).toBeGreaterThan(0);
        const aggregateStl = result.value.export("stl");
        expect(aggregateStl).toBeInstanceOf(Uint8Array);
        expect(aggregateStl.byteLength).toBeGreaterThan(84);
        expect(() =>
          result.value.export("step" as never),
        ).toThrowError(CadError);
        expect(() =>
          bodies.export("step" as never),
        ).toThrowError(CadError);
        expect(() =>
          result.value.assembly("product").export("step" as never),
        ).toThrowError(CadError);
      } finally {
        result.value.dispose();
      }
      expect(liveShapes.size).toBe(liveBefore);
    } finally {
      kernel.dispose();
    }
  }, 30_000);

  it("resolves and imports one shared resource once for every mixed view", async () => {
    const bytes = encoder.encode("shared imported body");
    const document = await importedMixedDocument(bytes);
    const requests: ResourceResolverRequestV7[] = [];
    const resolver = vi.fn((request: ResourceResolverRequestV7) => {
      requests.push(request);
      return bytes;
    });
    const harness = createKernelHarness();
    const result = await evaluateProductDocument(harness.kernel, document, {
      outputs: ["product", "direct", "bodies", "partOutput"],
      resolver,
    });

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    try {
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(requests[0]).toMatchObject({ id: "sharedStep" });
      expect(harness.importCalls).toHaveLength(1);
      expect(harness.primitiveCalls).toHaveLength(0);

      result.value.solid("direct").measure();
      result.value.bodySet("bodies").body("shared-body").solid.measure();
      const part = result.value.part("partOutput");
      expect(part.geometry.kind).toBe("solid");
      if (part.geometry.kind === "solid") part.geometry.solid.measure();
      const occurrence = result.value.assembly("product").occurrences[0]!;
      expect(occurrence.part.geometry.kind).toBe("solid");
      if (occurrence.part.geometry.kind === "solid") {
        occurrence.part.geometry.solid.measure();
      }
      expect(new Set(harness.measureCalls)).toEqual(
        new Set([harness.importCalls[0]!.shape]),
      );
    } finally {
      result.value.dispose();
    }
    expect(harness.disposed).toEqual([harness.importCalls[0]!.shape]);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("uses one scoped resource session for direct roots and an external fixed subassembly", async () => {
    const fixture = await scopedExternalProductFixture();
    const requests: ResourceResolverRequestV7[] = [];
    const resolver: ResourceResolverV7 = vi.fn((request) => {
      requests.push(request);
      switch (scopedRequestKey(request)) {
        case "root:childDocument":
          return fixture.child.bytes;
        case "root:sharedBody":
          return fixture.rootBody;
        case "external:childDocument:sharedBody":
          return fixture.childBody;
        default:
          throw new Error(
            `Unexpected scoped request '${scopedRequestKey(request)}'`,
          );
      }
    });
    const harness = createKernelHarness();
    const result = await evaluateProductDocument(
      harness.kernel,
      fixture.document,
      {
        outputs: ["rootImport", "product", "modeled"],
        resolver,
      },
    );

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    try {
      expect(result.value.outputNames).toEqual([
        "rootImport",
        "product",
        "modeled",
      ]);
      expect(
        requests.map(scopedRequestKey).sort(),
      ).toEqual([
        "external:childDocument:sharedBody",
        "root:childDocument",
        "root:sharedBody",
      ]);
      expect(new Set(requests.map(scopedRequestKey))).toHaveLength(3);
      expect(resolver).toHaveBeenCalledTimes(3);
      expect(
        requests.find(
          (request) =>
            scopedRequestKey(request) ===
            "external:childDocument:sharedBody",
        )?.documentScope,
      ).toEqual({
        source: "external",
        resource: "childDocument",
        digest: fixture.child.digest,
      });
      expect(harness.importCalls).toHaveLength(2);
      expect(harness.primitiveCalls).toHaveLength(1);
      expect(
        result.value.assembly("product").occurrences,
      ).toHaveLength(1);
      expect(
        result.value.assembly("product").occurrences[0]!.component,
      ).toMatchObject({
        source: "external",
        resource: "childDocument",
        output: "module",
        outputKind: "assembly",
      });
    } finally {
      result.value.dispose();
    }
    expect(harness.disposed).toHaveLength(3);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("classifies every requested output before resolver or kernel access", async () => {
    const harness = createKernelHarness();
    const resolver = vi.fn();
    const missing = await evaluateProductDocument(
      harness.kernel,
      mixedProductDocument(),
      { outputs: ["direct", "missing"], resolver },
    );
    expectFailureCode(missing, "OUTPUT_MISSING");
    expect(harness.primitiveCalls).toHaveLength(0);
    expect(harness.importCalls).toHaveLength(0);
    expect(resolver).not.toHaveBeenCalled();

    const unsupported = structuredClone(mixedProductDocument()) as {
      outputs: Record<string, { node: NodeId; kind: string }>;
    };
    unsupported.outputs.direct = {
      node: "shared" as NodeId,
      kind: "face",
    };
    const wrongKind = await evaluateProductDocument(
      harness.kernel,
      unsupported as unknown as DesignDocumentV7,
      { outputs: ["direct"] },
    );
    expectFailureCode(wrongKind, "REFERENCE_KIND_MISMATCH");
    expect(harness.primitiveCalls).toHaveLength(0);
  });

  it("rejects raw exotic boundaries and reports parse defects only once", async () => {
    const harness = createKernelHarness();
    const raw = structuredClone(mixedProductDocument()) as unknown as Record<
      string,
      unknown
    >;
    let nodesReads = 0;
    Object.defineProperty(raw, "nodes", {
      configurable: true,
      enumerable: true,
      get() {
        nodesReads += 1;
        throw new Error("must not invoke");
      },
    });
    const accessor = await evaluateProductDocument(
      harness.kernel,
      raw as unknown as DesignDocumentV7,
    );
    expectFailureCode(accessor, "IR_INVALID");
    expect(nodesReads).toBe(0);

    const opaque = new Proxy(mixedProductDocument(), {
      ownKeys() {
        throw Object.create(null) as unknown;
      },
    });
    const proxied = await evaluateProductDocument(
      harness.kernel,
      opaque,
    );
    expectFailureCode(proxied, "IR_INVALID");

    const invalid = structuredClone(mixedProductDocument()) as unknown as {
      nodes: Record<string, Record<string, unknown>>;
    };
    invalid.nodes.part!.materialId = "missing";
    const repeated = await evaluateProductDocument(
      harness.kernel,
      invalid as unknown as DesignDocumentV7,
      {
        configuration: "wide",
        outputs: ["product", "productAlias", "partOutput"],
      },
    );
    expectFailureCode(repeated, "REFERENCE_MISSING");
    if (!repeated.ok) {
      expect(
        repeated.diagnostics.filter(
          ({ path }) => path === "/nodes/part/materialId",
        ),
      ).toHaveLength(1);
    }
    expect(harness.primitiveCalls).toHaveLength(0);
  });

  it("bounds selected work and leaves unrelated materials inert", async () => {
    const selectedLimitHarness = createKernelHarness();
    const selectedLimit = await evaluateProductDocument(
      selectedLimitHarness.kernel,
      mixedProductDocument(),
      {
        outputs: ["direct", "bodies"],
        evaluationLimits: { maxSelectedOutputs: 1 },
      },
    );
    expectFailureCode(selectedLimit, "RESOURCE_LIMIT_EXCEEDED");
    expect(selectedLimitHarness.primitiveCalls).toHaveLength(0);

    const solidLimitHarness = createKernelHarness();
    const solidLimit = await evaluateProductDocument(
      solidLimitHarness.kernel,
      mixedProductDocument(),
      {
        outputs: ["direct", "bodies"],
        evaluationLimits: { maxDistinctSolids: 1 },
      },
    );
    expectFailureCode(solidLimit, "RESOURCE_LIMIT_EXCEEDED");
    expect(solidLimitHarness.primitiveCalls).toHaveLength(0);

    const bodyPartDocument = structuredClone(
      mixedProductDocument(),
    ) as unknown as {
      nodes: Record<
        string,
        {
          kind: string;
          geometry?: { node: NodeId; kind: string };
        }
      >;
    };
    bodyPartDocument.nodes.part!.geometry = {
      node: "bodies" as NodeId,
      kind: "bodySet",
    };
    const bodyLimitHarness = createKernelHarness();
    const bodyLimit = await evaluateProductDocument(
      bodyLimitHarness.kernel,
      bodyPartDocument as unknown as DesignDocumentV7,
      {
        outputs: ["partOutput"],
        evaluationLimits: { maxPartBodies: 1 },
      },
    );
    expectFailureCode(bodyLimit, "RESOURCE_LIMIT_EXCEEDED");
    expect(bodyLimitHarness.primitiveCalls).toHaveLength(0);
    expect(bodyLimitHarness.importCalls).toHaveLength(0);

    const inertDocument = structuredClone(mixedProductDocument()) as unknown as {
      materials: Record<
        string,
        { name: string; massDensity: ExpressionIR }
      >;
    };
    inertDocument.materials.steel!.massDensity = literal(
      "massDensity",
      -1,
    );
    inertDocument.materials.aluminum!.massDensity = literal(
      "massDensity",
      -2,
    );
    const inertHarness = createKernelHarness();
    const inert = await evaluateProductDocument(
      inertHarness.kernel,
      inertDocument as unknown as DesignDocumentV7,
      {
        outputs: ["direct", "bodies"],
        evaluationLimits: { maxResolvedMaterials: 0 },
      },
    );
    expect(inert.ok, JSON.stringify(inert.diagnostics)).toBe(true);
    if (inert.ok) inert.value.dispose();
    expect(inertHarness.primitiveCalls).toHaveLength(2);
    expect(inertHarness.live.size).toBe(0);
  });

  it("rejects hidden cache, hash, impact, and selection accessors without invoking them", async () => {
    for (const key of [
      "artifactCache",
      "featureHashes",
      "designImpact",
      "outputs",
    ]) {
      const harness = createKernelHarness();
      let reads = 0;
      const options: Record<string, unknown> = {};
      Object.defineProperty(options, key, {
        enumerable: true,
        get() {
          reads += 1;
          throw new Error("must not invoke");
        },
      });
      const result = await evaluateProductDocument(
        harness.kernel,
        mixedProductDocument(),
        options as EvaluateProductDocumentV7Options,
      );
      expectFailureCode(result, "IR_INVALID");
      expect(reads, key).toBe(0);
      expect(harness.primitiveCalls, key).toHaveLength(0);
      expect(harness.encodeShapeArtifact, key).not.toHaveBeenCalled();
      expect(harness.decodeShapeArtifact, key).not.toHaveBeenCalled();
    }
  });

  it("keeps prepared product lookup independent of later Map prototype mutation", async () => {
    const harness = createKernelHarness();
    const captured = captureProductDocumentV7(mixedProductDocument());
    expect(captured.ok, JSON.stringify(captured.diagnostics)).toBe(true);
    if (!captured.ok) return;
    const prepared = prepareProductGeometryOutputsV7(
      captured.value,
      Object.freeze([
        Object.freeze({
          name: "direct",
          node: "shared" as NodeId,
          kind: "solid" as const,
          path: "/outputs/direct",
        }),
      ]),
      {
        parameters: {},
        evaluationLimits: DEFAULT_PART_EVALUATION_LIMITS_V7,
        resourceLimits: DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
        materialScope: "selected",
      },
    );
    expect(prepared.ok, JSON.stringify(prepared.diagnostics)).toBe(true);
    if (!prepared.ok) return;
    const preflight = preflightPreparedProductGeometryOutputsV7(
      harness.kernel,
      [prepared.value],
    );
    expect(preflight.ok, JSON.stringify(preflight.diagnostics)).toBe(true);
    if (!preflight.ok) return;
    const executed = await executePreparedProductGeometryOutputsV7(
      harness.kernel,
      prepared.value,
      preflight.value[0]!,
    );
    expect(executed.ok, JSON.stringify(executed.diagnostics)).toBe(true);
    if (!executed.ok) return;

    let lookedUp: ReturnType<typeof executed.value.output> | undefined;
    const descriptor = Object.getOwnPropertyDescriptor(
      Map.prototype,
      "get",
    )!;
    try {
      Object.defineProperty(Map.prototype, "get", {
        ...descriptor,
        value() {
          throw new Error("ambient Map.prototype.get must stay unused");
        },
      });
      lookedUp = executed.value.output("direct");
    } finally {
      Object.defineProperty(Map.prototype, "get", descriptor);
    }
    try {
      expect(lookedUp).toMatchObject({
        name: "direct",
        node: "shared",
        kind: "solid",
      });
    } finally {
      executed.value.dispose();
    }
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);
  });

  it("keeps staged body lookup and aggregation independent of later Map.get and Array.push mutation", async () => {
    const harness = createKernelHarness();
    const result = await evaluateProductDocument(
      harness.kernel,
      mixedProductDocument(),
      { outputs: ["bodiesAlias"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const bodySet = result.value.bodySet("bodiesAlias");
    const retainedBody = bodySet.body("shared-body");

    let mapCalls = 0;
    let lookedUp: typeof retainedBody | undefined;
    let lookupFailure: unknown;
    const mapDescriptor = Object.getOwnPropertyDescriptor(
      Map.prototype,
      "get",
    )!;
    try {
      Object.defineProperty(Map.prototype, "get", {
        ...mapDescriptor,
        value() {
          mapCalls += 1;
          throw new Error("mutated Map.prototype.get");
        },
      });
      try {
        lookedUp = bodySet.body("shared-body");
      } catch (error) {
        lookupFailure = error;
      }
    } finally {
      Object.defineProperty(Map.prototype, "get", mapDescriptor);
    }

    let pushCalls = 0;
    let mesh: MeshData | undefined;
    let meshFailure: unknown;
    const pushDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "push",
    )!;
    try {
      Object.defineProperty(Array.prototype, "push", {
        ...pushDescriptor,
        value() {
          pushCalls += 1;
          throw new Error("mutated Array.prototype.push");
        },
      });
      try {
        mesh = bodySet.mesh();
      } catch (error) {
        meshFailure = error;
      }
    } finally {
      Object.defineProperty(
        Array.prototype,
        "push",
        pushDescriptor,
      );
    }

    try {
      expect(lookupFailure).toBeUndefined();
      expect(lookedUp).toBe(retainedBody);
      expect(mapCalls).toBe(0);
      expect(meshFailure).toBeUndefined();
      expect(mesh?.positions).toHaveLength(18);
      expect(mesh?.indices).toHaveLength(6);
      expect(pushCalls).toBe(0);
    } finally {
      result.value.dispose();
    }
    expect(harness.disposed).toHaveLength(2);
    expect(harness.live.size).toBe(0);
  });

  it("validates every body mesh with direct-output and part-owned provenance", async () => {
    for (const testCase of [
      {
        name: "direct body-set output",
        document: mixedProductDocument(),
        output: "bodiesAlias",
        outputKind: "bodySet" as const,
        diagnostic: {
          node: "shared",
          path: "/outputs/bodiesAlias",
          details: {
            phase: "documentV7BodySetEvaluation",
            output: "bodiesAlias",
            outputKind: "bodySet",
            bodyId: "shared-body",
            bodyNode: "shared",
            reason: "incomplete-xyz-positions",
            protocolViolation: true,
          },
        },
      },
      {
        name: "part-owned body-set geometry",
        document: bodySetPartProductDocument(),
        output: "partAlias",
        outputKind: "part" as const,
        diagnostic: {
          node: "shared",
          path: "/nodes/part/geometry",
          details: {
            phase: "documentV7PartEvaluation",
            output: "partAlias",
            outputKind: "part",
            partNode: "part",
            bodyId: "shared-body",
            bodyNode: "shared",
            reason: "incomplete-xyz-positions",
            protocolViolation: true,
          },
        },
      },
    ]) {
      const harness = createKernelHarness({
        meshHook(shape, valid) {
          return shape.source === "box"
            ? {
                positions: new Float32Array([0, 0]),
                indices: new Uint32Array([0, 1, 2]),
              }
            : valid;
        },
      });
      const result = await evaluateProductDocument(
        harness.kernel,
        testCase.document,
        { outputs: [testCase.output] },
      );
      expect(
        result.ok,
        `${testCase.name}: ${JSON.stringify(result.diagnostics)}`,
      ).toBe(true);
      if (!result.ok) continue;
      const bodySet =
        testCase.outputKind === "bodySet"
          ? result.value.bodySet(testCase.output)
          : (() => {
              const part = result.value.part(testCase.output);
              expect(part.geometry.kind).toBe("bodySet");
              return part.geometry.kind === "bodySet"
                ? part.geometry.bodySet
                : undefined;
            })();
      let thrown: unknown;
      try {
        bodySet?.mesh();
      } catch (error) {
        thrown = error;
      }
      try {
        expect(thrown, testCase.name).toBeInstanceOf(CadError);
        expect(
          (thrown as CadError).diagnostics[0],
          testCase.name,
        ).toMatchObject({
          code: "KERNEL_ERROR",
          ...testCase.diagnostic,
        });
      } finally {
        result.value.dispose();
      }
      expect(harness.disposed, testCase.name).toHaveLength(2);
      expect(harness.live.size, testCase.name).toBe(0);
    }
  });

  it("validates the merged body-set mesh with direct-output and part-owned provenance", async () => {
    const kernelModule = await import("../src/kernel.js");
    const merge = vi
      .spyOn(kernelModule, "mergeMeshes")
      .mockReturnValue({
        positions: new Float32Array([0, 0]),
        indices: new Uint32Array(),
      });
    try {
      for (const testCase of [
        {
          name: "direct body-set output",
          document: mixedProductDocument(),
          output: "bodiesAlias",
          outputKind: "bodySet" as const,
          diagnostic: {
            path: "/outputs/bodiesAlias",
            details: {
              phase: "documentV7BodySetEvaluation",
              output: "bodiesAlias",
              outputKind: "bodySet",
              reason: "aggregate-incomplete-xyz-positions",
              protocolViolation: true,
            },
          },
        },
        {
          name: "part-owned body-set geometry",
          document: bodySetPartProductDocument(),
          output: "partAlias",
          outputKind: "part" as const,
          diagnostic: {
            path: "/nodes/part/geometry",
            details: {
              phase: "documentV7PartEvaluation",
              output: "partAlias",
              outputKind: "part",
              partNode: "part",
              reason: "aggregate-incomplete-xyz-positions",
              protocolViolation: true,
            },
          },
        },
      ]) {
        const harness = createKernelHarness();
        const result = await evaluateProductDocument(
          harness.kernel,
          testCase.document,
          { outputs: [testCase.output] },
        );
        expect(
          result.ok,
          `${testCase.name}: ${JSON.stringify(result.diagnostics)}`,
        ).toBe(true);
        if (!result.ok) continue;
        const bodySet =
          testCase.outputKind === "bodySet"
            ? result.value.bodySet(testCase.output)
            : (() => {
                const part = result.value.part(testCase.output);
                expect(part.geometry.kind).toBe("bodySet");
                return part.geometry.kind === "bodySet"
                  ? part.geometry.bodySet
                  : undefined;
              })();
        let thrown: unknown;
        try {
          bodySet?.mesh();
        } catch (error) {
          thrown = error;
        }
        try {
          expect(thrown, testCase.name).toBeInstanceOf(CadError);
          expect(
            (thrown as CadError).diagnostics[0],
            testCase.name,
          ).toMatchObject({
            code: "KERNEL_ERROR",
            ...testCase.diagnostic,
          });
        } finally {
          result.value.dispose();
        }
        expect(harness.disposed, testCase.name).toHaveLength(2);
        expect(harness.live.size, testCase.name).toBe(0);
      }
    } finally {
      merge.mockRestore();
    }
  });

  it("reports product-phase integrity failures after a monitored intrinsic mutates", async () => {
    const harness = createKernelHarness();
    const result = await evaluateProductDocument(
      harness.kernel,
      mixedProductDocument(),
      { outputs: ["direct"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;

    let meshFailure: unknown;
    let exportFailure: unknown;
    const descriptor = Object.getOwnPropertyDescriptor(
      Map.prototype,
      "get",
    )!;
    try {
      Object.defineProperty(Map.prototype, "get", {
        ...descriptor,
        value() {
          throw new Error("mutated Map.prototype.get");
        },
      });
      try {
        result.value.mesh();
      } catch (error) {
        meshFailure = error;
      }
      try {
        result.value.export("obj");
      } catch (error) {
        exportFailure = error;
      }
    } finally {
      Object.defineProperty(Map.prototype, "get", descriptor);
    }

    try {
      for (const failure of [meshFailure, exportFailure]) {
        expect(failure).toBeInstanceOf(CadError);
        expect((failure as CadError).diagnostics[0]).toMatchObject({
          code: "IR_INVALID",
          details: {
            phase: "documentV7ProductEvaluation",
            runtimeIntegrity: false,
          },
        });
        expect(
          (failure as CadError).diagnostics[0]?.details?.phase,
        ).not.toBe("documentV7LocalAssemblyEvaluation");
      }
      expect(harness.meshCalls).toHaveLength(0);
    } finally {
      result.value.dispose();
    }
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);
  });

  it("attributes duplicate imported node capability failures to the exact product batch", async () => {
    const stepBytes = encoder.encode("supported step");
    const brepBytes = encoder.encode("unsupported brep");
    const stepDocument = await importedMixedDocument(
      stepBytes,
      "step",
    );
    const brepDocument = await importedMixedDocument(
      brepBytes,
      "brep",
    );
    const stepCaptured = captureProductDocumentV7(stepDocument);
    const brepCaptured = captureProductDocumentV7(brepDocument);
    expect(
      stepCaptured.ok,
      JSON.stringify(stepCaptured.diagnostics),
    ).toBe(true);
    expect(
      brepCaptured.ok,
      JSON.stringify(brepCaptured.diagnostics),
    ).toBe(true);
    if (!stepCaptured.ok || !brepCaptured.ok) return;
    const options = {
      parameters: {},
      evaluationLimits: DEFAULT_PART_EVALUATION_LIMITS_V7,
      resourceLimits: DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
      materialScope: "selected" as const,
    };
    const selection = Object.freeze([
      Object.freeze({
        name: "direct",
        node: "shared" as NodeId,
        kind: "solid" as const,
        path: "/outputs/direct",
      }),
    ]);
    const stepPrepared = prepareProductGeometryOutputsV7(
      stepCaptured.value,
      selection,
      options,
    );
    const brepPrepared = prepareProductGeometryOutputsV7(
      brepCaptured.value,
      selection,
      options,
    );
    expect(
      stepPrepared.ok,
      JSON.stringify(stepPrepared.diagnostics),
    ).toBe(true);
    expect(
      brepPrepared.ok,
      JSON.stringify(brepPrepared.diagnostics),
    ).toBe(true);
    if (!stepPrepared.ok || !brepPrepared.ok) return;

    const harness = createKernelHarness();
    const stepScopeDigest =
      `sha256:${"1".repeat(64)}` as ResourceDigestIR;
    const brepScopeDigest =
      `sha256:${"2".repeat(64)}` as ResourceDigestIR;
    const preflight = preflightPreparedProductGeometryOutputsV7(
      harness.kernel,
      [stepPrepared.value, brepPrepared.value],
      [
        {
          documentScope: {
            source: "external",
            resource: "stepDocument" as ResourceId,
            digest: stepScopeDigest,
          },
          selectionPath: "/components/step",
        },
        {
          documentScope: {
            source: "external",
            resource: "brepDocument" as ResourceId,
            digest: brepScopeDigest,
          },
          selectionPath: "/components/brep",
        },
      ],
    );
    expectFailureCode(
      preflight as Awaited<ReturnType<typeof evaluateProductDocument>>,
      "KERNEL_CAPABILITY_MISSING",
    );
    if (!preflight.ok) {
      expect(preflight.diagnostics[0]?.details).toMatchObject({
        productBatchIndex: 1,
        documentScope: {
          source: "external",
          resource: "brepDocument",
          digest: brepScopeDigest,
        },
        selectionPath: "/components/brep",
      });
    }
    expect(harness.primitiveCalls).toHaveLength(0);
    expect(harness.importCalls).toHaveLength(0);
  });

  it("rolls back every acquired shape on kernel failure and cancellation", async () => {
    const failureHarness = createKernelHarness({
      failPrimitiveCall: 1,
      thrownPrimitiveValue: Object.create(null),
    });
    const failed = await evaluateProductDocument(
      failureHarness.kernel,
      mixedProductDocument(),
      { outputs: ["bodies"] },
    );
    expectFailureCode(failed, "KERNEL_ERROR");
    expect(failureHarness.primitiveCalls).toHaveLength(1);
    expect(failureHarness.disposed).toHaveLength(1);
    expect(failureHarness.live.size).toBe(0);
    expect(failureHarness.disposeKernel).not.toHaveBeenCalled();

    const controller = new AbortController();
    const abortHarness = createKernelHarness({
      afterAcquire(_shape, index) {
        if (index === 0) controller.abort("stop");
      },
    });
    const aborted = await evaluateProductDocument(
      abortHarness.kernel,
      mixedProductDocument(),
      { outputs: ["bodies"], signal: controller.signal },
    );
    expectFailureCode(aborted, "EVALUATION_ABORTED");
    expect(abortHarness.primitiveCalls).toHaveLength(1);
    expect(abortHarness.disposed).toHaveLength(1);
    expect(abortHarness.live.size).toBe(0);
    expect(abortHarness.disposeKernel).not.toHaveBeenCalled();
  });

  it("best-effort disposes completed children when post-batch facade mapping throws", async () => {
    const document = structuredClone(
      mixedProductDocument(),
    ) as unknown as {
      nodes: Record<
        string,
        {
          instances?: {
            configuration: { mode: string };
          }[];
        }
      >;
    };
    document.nodes.productAssembly!.instances![0]!.configuration = {
      mode: "base",
    };
    const harness = createKernelHarness();
    const liveEvaluatorModule = await import("../src/evaluator.js");
    const realExecutor =
      liveEvaluatorModule.executePreparedProductGeometryOutputsV7;
    let calls = 0;
    const executor = vi
      .spyOn(
        liveEvaluatorModule,
        "executePreparedProductGeometryOutputsV7",
      )
      .mockImplementation(async (...arguments_) => {
        const index = calls;
        calls += 1;
        if (index === 1) {
          return {
            ok: true,
            value: Object.freeze({}),
            diagnostics: [],
          } as never;
        }
        return realExecutor(...arguments_);
      });
    let result:
      | Awaited<ReturnType<typeof evaluateProductDocument>>
      | undefined;
    try {
      result = await evaluateProductDocument(
        harness.kernel,
        document as unknown as DesignDocumentV7,
        {
          configuration: "wide",
          outputs: ["direct", "product"],
        },
      );
    } finally {
      executor.mockRestore();
    }
    expect(result?.ok).toBe(false);
    if (result !== undefined && !result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "KERNEL_ERROR",
        details: {
          phase: "documentV7ProductEvaluation",
          lateResultConstruction: true,
        },
      });
    }
    expect(calls).toBe(2);
    expect(harness.primitiveCalls).toHaveLength(1);
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("continues atomic cleanup when a borrowed shape disposer throws", async () => {
    const harness = createKernelHarness({
      throwOnDisposeSerial: 0,
    });
    const result = await evaluateProductDocument(
      harness.kernel,
      mixedProductDocument(),
      { outputs: ["bodies"] },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    const retained = result.value.bodySet("bodies");
    expect(() => result.value.dispose()).toThrow(
      /injected dispose failure/,
    );
    expect(harness.disposed).toHaveLength(2);
    expect(new Set(harness.disposed)).toHaveLength(2);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
    expect(() => retained.mesh()).toThrow(/disposed/i);
    expect(() => result.value.dispose()).not.toThrow();
  });

  it("rejects native-handle aliasing across distinct definitions without double disposal", async () => {
    const harness = createKernelHarness({
      aliasSecondPrimitiveToFirst: true,
    });
    const result = await evaluateProductDocument(
      harness.kernel,
      mixedProductDocument(),
      { outputs: ["bodies"] },
    );
    expectFailureCode(result, "KERNEL_ERROR");
    expect(harness.primitiveCalls).toHaveLength(2);
    expect(harness.disposed).toHaveLength(1);
    expect(harness.live.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });
});
