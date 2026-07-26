import { describe, expect, it, vi } from "vitest";
import type {
  ConfigurationId,
  ResourceId,
} from "../src/core/ids.js";
import { CadError } from "../src/core/result.js";
import { design, plane, tf } from "../src/design.js";
import {
  kgPerCubicMillimeter,
  mm,
  vec3,
} from "../src/expressions.js";
import type {
  AssemblyInstanceIRV7,
  DesignDocumentV7,
  ResourceDigestIR,
} from "../src/ir.js";
import {
  GEOMETRY_KERNEL_PROTOCOL_VERSION,
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  type GeometryKernel,
  type KernelShape,
  type MeshData,
  type MeshOptions,
} from "../src/kernel.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";
import type {
  DocumentV7ResourceScope,
  ResourceResolverRequestV7,
  ResourceResolverV7,
} from "../src/resource-resolution.js";
import {
  stringifyDocument,
  stringifyDocumentV7,
} from "../src/serialization.js";
import {
  stagedBodySetDesignV7,
} from "../src/internal/document-v7-body-set-authoring.js";
import {
  EvaluatedProductAssemblyV7,
  evaluateProductAssemblyOutputsV7,
} from "../src/internal/document-v7-local-assembly-evaluation.js";

const DOCUMENT_MEDIA_TYPE =
  "application/vnd.invariantcad.document+json";
const encoder = new TextEncoder();

interface CommittedDocumentV7 {
  readonly document: DesignDocumentV7;
  readonly bytes: Uint8Array;
  readonly digest: ResourceDigestIR;
}

interface TrackedManifold {
  readonly kernel: GeometryKernel;
  readonly boxCalls: ReturnType<typeof vi.fn>;
  readonly disposedShapes: KernelShape[];
  readonly liveShapes: Set<KernelShape>;
  readonly disposeKernel: ReturnType<typeof vi.fn>;
  disposeBase(): void;
}

interface ExactTestShape extends KernelShape {
  readonly marker: number;
}

interface ExactKernelHarness {
  readonly kernel: GeometryKernel;
  readonly events: string[];
  readonly imports: ReturnType<typeof vi.fn>;
  readonly disposedShapes: ExactTestShape[];
  readonly liveShapes: Set<ExactTestShape>;
  readonly disposeKernel: ReturnType<typeof vi.fn>;
}

interface ResolverHarness {
  readonly requests: ResourceResolverRequestV7[];
  readonly events: string[];
  readonly resolver: ResourceResolverV7;
}

function occurrenceConfiguration(
  mode: "base" | "inherit",
): AssemblyInstanceIRV7["configuration"];
function occurrenceConfiguration(
  mode: "named",
  id: string,
): AssemblyInstanceIRV7["configuration"];
function occurrenceConfiguration(
  mode: "base" | "inherit" | "named",
  id?: string,
): AssemblyInstanceIRV7["configuration"] {
  return mode === "named"
    ? { mode, id: id as ConfigurationId }
    : { mode };
}

async function digestBytes(
  bytes: Uint8Array,
): Promise<ResourceDigestIR> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function commitDocumentV7(
  document: DesignDocumentV7,
): Promise<CommittedDocumentV7> {
  const bytes = encoder.encode(stringifyDocumentV7(document));
  return {
    document,
    bytes,
    digest: await digestBytes(bytes),
  };
}

async function commitLegacyDocument(
  document: Parameters<typeof stringifyDocument>[0],
): Promise<{
  readonly bytes: Uint8Array;
  readonly digest: ResourceDigestIR;
}> {
  const bytes = encoder.encode(stringifyDocument(document));
  return { bytes, digest: await digestBytes(bytes) };
}

function rootScopeKey(id: ResourceId): string {
  return `root:${id}`;
}

function externalScopeKey(
  resource: ResourceId,
  id: ResourceId,
): string {
  return `external:${resource}:${id}`;
}

function requestKey(request: ResourceResolverRequestV7): string {
  const scope = request.documentScope;
  if (scope?.source === "root") return rootScopeKey(request.id);
  if (scope?.source === "external") {
    return externalScopeKey(scope.resource, request.id);
  }
  return `unscoped:${request.id}`;
}

function resolverHarness(
  resources: ReadonlyMap<string, Uint8Array>,
  events: string[] = [],
): ResolverHarness {
  const requests: ResourceResolverRequestV7[] = [];
  const resolver: ResourceResolverV7 = vi.fn(
    (request: ResourceResolverRequestV7): Uint8Array => {
      requests.push(request);
      const key = requestKey(request);
      events.push(`resolve:${key}`);
      const bytes = resources.get(key);
      if (bytes === undefined) {
        throw new Error(`Unexpected resource request '${key}'`);
      }
      return bytes;
    },
  );
  return { requests, events, resolver };
}

async function trackedManifold(
  failBoxCall?: number,
): Promise<TrackedManifold> {
  const base = await createManifoldKernel();
  const liveShapes = new Set<KernelShape>();
  const disposedShapes: KernelShape[] = [];
  let boxCall = 0;
  const boxCalls = vi.fn(
    (
      ...arguments_: Parameters<
        NonNullable<GeometryKernel["box"]>
      >
    ): KernelShape => {
      const call = boxCall;
      boxCall += 1;
      if (call === failBoxCall) {
        throw new Error("injected external part construction failure");
      }
      const shape = base.box!(...arguments_);
      liveShapes.add(shape);
      return shape;
    },
  );
  const disposeKernel = vi.fn();
  const kernel: GeometryKernel = {
    id: base.id,
    capabilities: base.capabilities,
    box: (...arguments_) => boxCalls(...arguments_),
    status: base.status.bind(base),
    measure: base.measure.bind(base),
    mesh: base.mesh.bind(base),
    disposeShape(shape) {
      disposedShapes.push(shape);
      liveShapes.delete(shape);
      base.disposeShape(shape);
    },
    dispose: disposeKernel,
  };
  return {
    kernel,
    boxCalls,
    disposedShapes,
    liveShapes,
    disposeKernel,
    disposeBase: () => base.dispose(),
  };
}

function exactKernelHarness(events: string[] = []): ExactKernelHarness {
  const liveShapes = new Set<ExactTestShape>();
  const disposedShapes: ExactTestShape[] = [];
  const disposeKernel = vi.fn();
  const imports = vi.fn(
    (
      bytes: Uint8Array,
      _options: Parameters<
        NonNullable<GeometryKernel["importDocumentBody"]>
      >[1],
      _context?: Parameters<
        NonNullable<GeometryKernel["importDocumentBody"]>
      >[2],
    ): KernelShape => {
      events.push(`import:${bytes[0] ?? -1}`);
      const shape: ExactTestShape = {
        kernel: "document-v7-external-product-test",
        marker: bytes[0] ?? 1,
      };
      liveShapes.add(shape);
      return shape;
    },
  );
  const target: GeometryKernel = {
    id: "document-v7-external-product-test",
    capabilities: {
      protocolVersion: GEOMETRY_KERNEL_PROTOCOL_VERSION,
      representation: "brep",
      exact: true,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: ["brep"],
      documentBodyImport: {
        protocolVersion:
          KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
        formats: [
          {
            format: "brep",
            unitModes: ["declared"],
          },
        ],
      },
    },
    importDocumentBody: (...arguments_) => imports(...arguments_),
    status: () => ({ ok: true, code: "VALID" }),
    measure(shape) {
      const marker = (shape as ExactTestShape).marker;
      return {
        volume: marker,
        surfaceArea: marker * 6,
        boundingBox: {
          min: [0, 0, 0],
          max: [marker, 1, 1],
        },
        centerOfMass: [marker / 2, 0.5, 0.5],
        inertiaTensor: [
          [marker, 0, 0],
          [0, marker, 0],
          [0, 0, marker],
        ],
        genus: 0,
        tolerance: 1e-7,
      };
    },
    mesh(shape): MeshData {
      const marker = (shape as ExactTestShape).marker;
      return {
        positions: new Float32Array([
          0, 0, 0,
          marker, 0, 0,
          0, 1, 0,
        ]),
        indices: new Uint32Array([0, 1, 2]),
      };
    },
    exportShape(shape, format) {
      expect(format).toBe("brep");
      return Uint8Array.of((shape as ExactTestShape).marker);
    },
    disposeShape(shape) {
      const exactShape = shape as ExactTestShape;
      disposedShapes.push(exactShape);
      liveShapes.delete(exactShape);
    },
    dispose: disposeKernel,
  };
  const kernel = new Proxy(target, {
    get(object, property, receiver) {
      events.push(`get:${String(property)}`);
      return Reflect.get(object, property, receiver);
    },
  });
  return {
    kernel,
    events,
    imports,
    disposedShapes,
    liveShapes,
    disposeKernel,
  };
}

function configuredExternalPartDocument(): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7("configured-external-part");
  const width = cad.parameter.length("width", mm(10));
  cad.configuration("wide", (configuration) => {
    configuration.parameter(width, mm(20));
  });
  const material = cad.material("steel", {
    name: "Steel",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const solid = cad.box("external-solid", {
    size: [width, mm(2), mm(3)],
  });
  const part = cad.part("external-part", solid, {
    partNumber: "EXT-100",
    description: "Configured supplier block",
    materialRef: material,
  });
  cad.output("mainPart", part);
  cad.output("partAlias", part);
  return cad.build();
}

async function configuredProductFixture(): Promise<{
  readonly document: DesignDocumentV7;
  readonly child: CommittedDocumentV7;
  readonly resolver: ResolverHarness;
}> {
  const child = await commitDocumentV7(
    configuredExternalPartDocument(),
  );
  const cad = stagedBodySetDesignV7("configured-external-product");
  const width = cad.parameter.length("width", mm(5));
  cad.configuration("wide", (configuration) => {
    configuration.parameter(width, mm(99));
  });
  const localSolid = cad.box("local-solid", {
    size: [width, mm(1), mm(1)],
  });
  const localPart = cad.part("local-part", localSolid, {
    partNumber: "LOCAL-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const resource = cad.resource("supplierDocument", {
    digest: child.digest,
    byteLength: child.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
    locations: ["project://supplier/configured-part.invariantcad"],
  });
  const external = cad.externalPart(resource, "mainPart");
  const alias = cad.externalPart(resource, "partAlias");
  const assembly = cad.assembly("product-assembly", (instances) => {
    instances.instance("external-base", external, {
      configuration: occurrenceConfiguration("base"),
    });
    instances.instance("external-inherit", external, {
      configuration: occurrenceConfiguration("inherit"),
      placement: [tf.translate([mm(20), mm(0), mm(0)])],
    });
    instances.instance("external-wide", external, {
      configuration: occurrenceConfiguration("named", "wide"),
      placement: [tf.translate([mm(40), mm(0), mm(0)])],
    });
    instances.instance("external-alias", alias, {
      configuration: occurrenceConfiguration("base"),
      placement: [tf.translate([mm(70), mm(0), mm(0)])],
    });
    instances.instance("local", localPart, {
      configuration: occurrenceConfiguration("base"),
      placement: [tf.translate([mm(100), mm(0), mm(0)])],
    });
  });
  cad.output("product", assembly);
  cad.output("productAlias", assembly);
  const resolver = resolverHarness(
    new Map([[rootScopeKey("supplierDocument" as ResourceId), child.bytes]]),
  );
  return { document: cad.build(), child, resolver };
}

async function importedPartDocument(
  name: string,
  bodyBytes: Uint8Array,
  partNumber: string,
): Promise<CommittedDocumentV7> {
  const bodyDigest = await digestBytes(bodyBytes);
  const cad = stagedBodySetDesignV7(name);
  const resource = cad.resource("sharedBody", {
    digest: bodyDigest,
    byteLength: bodyBytes.byteLength,
    mediaType: "model/brep",
    locations: [`project://${name}/body.brep`],
  });
  const solid = cad.importedBody("imported-solid", resource, {
    format: "brep",
    units: { mode: "declared", length: "mm" },
  });
  const part = cad.part("imported-part", solid, {
    partNumber,
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  cad.output("mainPart", part);
  return commitDocumentV7(cad.build());
}

async function importedProductFixture(): Promise<{
  readonly document: DesignDocumentV7;
  readonly aDocument: CommittedDocumentV7;
  readonly zDocument: CommittedDocumentV7;
  readonly aBody: Uint8Array;
  readonly zBody: Uint8Array;
  readonly resolverResources: ReadonlyMap<string, Uint8Array>;
}> {
  const aBody = Uint8Array.of(11, 1, 1);
  const zBody = Uint8Array.of(22, 2, 2);
  const aDocument = await importedPartDocument(
    "a-external-document",
    aBody,
    "A-IMPORT",
  );
  const zDocument = await importedPartDocument(
    "z-external-document",
    zBody,
    "Z-IMPORT",
  );
  const cad = stagedBodySetDesignV7("scoped-import-product");
  const zResource = cad.resource("zDocument", {
    digest: zDocument.digest,
    byteLength: zDocument.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const aResource = cad.resource("aDocument", {
    digest: aDocument.digest,
    byteLength: aDocument.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const zPart = cad.externalPart(zResource, "mainPart");
  const aPart = cad.externalPart(aResource, "mainPart");
  const assembly = cad.assembly("product-assembly", (instances) => {
    instances.instance("z", zPart, {
      configuration: occurrenceConfiguration("base"),
    });
    instances.instance("a-first", aPart, {
      configuration: occurrenceConfiguration("base"),
    });
    instances.instance("a-second", aPart, {
      configuration: occurrenceConfiguration("base"),
      placement: [tf.translate([mm(30), mm(0), mm(0)])],
    });
  });
  cad.output("product", assembly);
  return {
    document: cad.build(),
    aDocument,
    zDocument,
    aBody,
    zBody,
    resolverResources: new Map([
      [rootScopeKey("aDocument" as ResourceId), aDocument.bytes],
      [rootScopeKey("zDocument" as ResourceId), zDocument.bytes],
      [
        externalScopeKey(
          "aDocument" as ResourceId,
          "sharedBody" as ResourceId,
        ),
        aBody,
      ],
      [
        externalScopeKey(
          "zDocument" as ResourceId,
          "sharedBody" as ResourceId,
        ),
        zBody,
      ],
    ]),
  };
}

async function primitiveExternalDocument(
  name: string,
  partNumber?: string,
): Promise<CommittedDocumentV7> {
  const cad = stagedBodySetDesignV7(name);
  const solid = cad.box("external-solid", {
    size: [mm(2), mm(3), mm(4)],
  });
  const part = cad.part("external-part", solid, {
    ...(partNumber === undefined ? {} : { partNumber }),
  });
  cad.output("mainPart", part);
  return commitDocumentV7(cad.build());
}

function singleExternalPartProduct(
  name: string,
  resourceId: string,
  committed: {
    readonly bytes: Uint8Array;
    readonly digest: ResourceDigestIR;
  },
  occurrenceId: string,
  configuration: AssemblyInstanceIRV7["configuration"],
): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7(name);
  const documentResource = cad.resource(resourceId, {
    digest: committed.digest,
    byteLength: committed.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const external = cad.externalPart(
    documentResource,
    "mainPart",
  );
  const assembly = cad.assembly("product-assembly", (instances) => {
    instances.instance(occurrenceId, external, { configuration });
  });
  cad.output("product", assembly);
  return cad.build();
}

async function twoPrimitiveExternalProduct(): Promise<{
  readonly document: DesignDocumentV7;
  readonly aDocument: CommittedDocumentV7;
  readonly zDocument: CommittedDocumentV7;
  readonly resources: ReadonlyMap<string, Uint8Array>;
}> {
  const aDocument = await primitiveExternalDocument(
    "a-primitive-child",
    "A-PRIMITIVE",
  );
  const zDocument = await primitiveExternalDocument(
    "z-primitive-child",
    "Z-PRIMITIVE",
  );
  const cad = stagedBodySetDesignV7("two-external-product");
  const aResource = cad.resource("aDocument", {
    digest: aDocument.digest,
    byteLength: aDocument.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const zResource = cad.resource("zDocument", {
    digest: zDocument.digest,
    byteLength: zDocument.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const aPart = cad.externalPart(aResource, "mainPart");
  const zPart = cad.externalPart(zResource, "mainPart");
  const assembly = cad.assembly("product-assembly", (instances) => {
    instances.instance("a", aPart, {
      configuration: occurrenceConfiguration("base"),
    });
    instances.instance("z", zPart, {
      configuration: occurrenceConfiguration("base"),
    });
  });
  cad.output("product", assembly);
  return {
    document: cad.build(),
    aDocument,
    zDocument,
    resources: new Map([
      [rootScopeKey("aDocument" as ResourceId), aDocument.bytes],
      [rootScopeKey("zDocument" as ResourceId), zDocument.bytes],
    ]),
  };
}

function expectExternalComponent(
  component: unknown,
  expected: {
    readonly resource: string;
    readonly digest: ResourceDigestIR;
    readonly output: string;
    readonly sourceVersion: number;
  },
): void {
  expect(component).toMatchObject({
    source: "external",
    resource: expected.resource,
    digest: expected.digest,
    output: expected.output,
    outputKind: "part",
    sourceVersion: expected.sourceVersion,
  });
  expect(Object.isFrozen(component)).toBe(true);
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

describe("staged Document v7 external-part product evaluation", () => {
  it("evaluates a configured Manifold product without leaking parent overrides into child documents", async () => {
    const fixture = await configuredProductFixture();
    const harness = await trackedManifold();
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      {
        parameters: { width: 7 },
        outputs: ["product", "productAlias"],
        resolver: fixture.resolver.resolver,
      },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }

    const retainedPart =
      result.value.output("product").occurrences[0]!.part;
    try {
      expect(result.value).toMatchObject({
        configurationId: null,
        parameters: { width: 7 },
        outputNames: ["product", "productAlias"],
      });
      const product = result.value.output("product");
      const productAlias = result.value.output("productAlias");
      expect(product).toBeInstanceOf(EvaluatedProductAssemblyV7);
      expect(product.occurrences.map(({ id }) => id)).toEqual([
        "external-base",
        "external-inherit",
        "external-wide",
        "external-alias",
        "local",
      ]);
      expect(
        product.occurrences.map(
          ({ effectiveConfigurationId }) =>
            effectiveConfigurationId,
        ),
      ).toEqual([null, null, "wide", null, null]);
      expect(productAlias).not.toBe(product);
      expect(
        productAlias.occurrences.map(({ part }) => part),
      ).toEqual(product.occurrences.map(({ part }) => part));

      const [
        externalBase,
        externalInherit,
        externalWide,
        externalAlias,
        local,
      ] = product.occurrences;
      expect(externalBase!.part).toBe(externalInherit!.part);
      expect(externalAlias!.part).not.toBe(externalBase!.part);
      expect(externalWide!.part).not.toBe(externalBase!.part);
      expect(
        externalBase!.part.geometry.kind === "solid"
          ? externalBase!.part.geometry.solid.measure().volume
          : undefined,
      ).toBeCloseTo(60);
      expect(
        externalWide!.part.geometry.kind === "solid"
          ? externalWide!.part.geometry.solid.measure().volume
          : undefined,
      ).toBeCloseTo(120);
      expect(
        local!.part.geometry.kind === "solid"
          ? local!.part.geometry.solid.measure().volume
          : undefined,
      ).toBeCloseTo(7);
      expectExternalComponent(externalBase!.component, {
        resource: "supplierDocument",
        digest: fixture.child.digest,
        output: "mainPart",
        sourceVersion: 7,
      });
      expectExternalComponent(externalAlias!.component, {
        resource: "supplierDocument",
        digest: fixture.child.digest,
        output: "partAlias",
        sourceVersion: 7,
      });

      const bom = product.billOfMaterials();
      expect(bom.ok, JSON.stringify(bom.diagnostics)).toBe(true);
      if (bom.ok) {
        expect(bom.value.totalQuantity).toBe(5);
        expect(
          bom.value.items.map((item) => [
            item.component.source,
            item.component.source === "external"
              ? item.component.output
              : item.component.partNode,
            item.effectiveConfigurationId,
            item.quantity,
          ]),
        ).toEqual([
          ["external", "mainPart", null, 2],
          ["external", "mainPart", "wide", 1],
          ["external", "partAlias", null, 1],
          ["local", "local-part", null, 1],
        ]);
      }
      expect(product.mesh().positions.length).toBeGreaterThan(0);
      expect(product.export("stl").byteLength).toBeGreaterThan(84);
      expect(harness.boxCalls).toHaveBeenCalledTimes(3);
      expect(
        fixture.resolver.requests.map(requestKey),
      ).toEqual([rootScopeKey("supplierDocument" as ResourceId)]);
    } finally {
      result.value.dispose();
      result.value.dispose();
    }
    expect(() => retainedPart.mesh()).toThrow(/disposed/i);
    expect(harness.disposedShapes).toHaveLength(3);
    expect(harness.liveShapes.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();

    const named = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      {
        configuration: "wide",
        parameters: { width: 7 },
        outputs: ["product"],
        resolver: fixture.resolver.resolver,
      },
    );
    expect(named.ok, JSON.stringify(named.diagnostics)).toBe(true);
    if (named.ok) {
      try {
        const occurrences = named.value.output("product").occurrences;
        expect(
          occurrences.map(
            ({ effectiveConfigurationId }) =>
              effectiveConfigurationId,
          ),
        ).toEqual([null, "wide", "wide", null, null]);
        const inherited = occurrences[1]!.part;
        expect(
          inherited.geometry.kind === "solid"
            ? inherited.geometry.solid.measure().volume
            : undefined,
        ).toBeCloseTo(120);
        expect(named.value.parameters.width).toBe(7);
      } finally {
        named.value.dispose();
      }
    }
    expect(harness.boxCalls).toHaveBeenCalledTimes(6);
    expect(harness.liveShapes.size).toBe(0);
    harness.disposeBase();
  });

  it("resolves root documents before scoped geometry, freezes scope provenance, and reuses each context once", async () => {
    const fixture = await importedProductFixture();
    const events: string[] = [];
    const resolver = resolverHarness(
      fixture.resolverResources,
      events,
    );
    const harness = exactKernelHarness(events);
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      {
        outputs: ["product"],
        resolver: resolver.resolver,
      },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;

    const product = result.value.output("product");
    const retained =
      product.occurrences[1]!.part.geometry.kind === "solid"
        ? product.occurrences[1]!.part.geometry.solid
        : undefined;
    try {
      expect(resolver.requests.map(requestKey)).toEqual([
        rootScopeKey("aDocument" as ResourceId),
        rootScopeKey("zDocument" as ResourceId),
        externalScopeKey(
          "aDocument" as ResourceId,
          "sharedBody" as ResourceId,
        ),
        externalScopeKey(
          "zDocument" as ResourceId,
          "sharedBody" as ResourceId,
        ),
      ]);
      expect(
        resolver.requests.every(
          (request) =>
            request.documentScope !== undefined &&
            Object.isFrozen(request.documentScope),
        ),
      ).toBe(true);
      expect(resolver.requests.map(({ documentScope }) => documentScope))
        .toEqual([
          { source: "root" },
          { source: "root" },
          {
            source: "external",
            resource: "aDocument" as ResourceId,
            digest: fixture.aDocument.digest,
          },
          {
            source: "external",
            resource: "zDocument" as ResourceId,
            digest: fixture.zDocument.digest,
          },
        ] satisfies DocumentV7ResourceScope[]);

      const lastRootResolution = events.lastIndexOf(
        `resolve:${rootScopeKey("zDocument" as ResourceId)}`,
      );
      const firstKernelRead = events.findIndex((event) =>
        event.startsWith("get:"),
      );
      const firstGeometryResolution = events.findIndex((event) =>
        event.startsWith("resolve:external:"),
      );
      const lastKernelRead = events.reduce(
        (last, event, index) =>
          event.startsWith("get:") ? index : last,
        -1,
      );
      const lastGeometryResolution = events.reduce(
        (last, event, index) =>
          event.startsWith("resolve:external:") ? index : last,
        -1,
      );
      const firstImport = events.findIndex((event) =>
        event.startsWith("import:"),
      );
      expect(firstKernelRead).toBeGreaterThan(lastRootResolution);
      expect(lastKernelRead).toBeLessThan(firstGeometryResolution);
      expect(firstImport).toBeGreaterThan(lastGeometryResolution);
      expect(
        events
          .slice(firstGeometryResolution)
          .some((event) => event.startsWith("get:")),
      ).toBe(false);
      expect(
        harness.imports.mock.calls.map(([bytes]) => bytes[0]),
      ).toEqual([11, 22]);

      expect(product.occurrences.map(({ id }) => id)).toEqual([
        "z",
        "a-first",
        "a-second",
      ]);
      expect(product.occurrences[1]!.part).toBe(
        product.occurrences[2]!.part,
      );
      expect(product.occurrences[0]!.part).not.toBe(
        product.occurrences[1]!.part,
      );
      expectExternalComponent(product.occurrences[1]!.component, {
        resource: "aDocument",
        digest: fixture.aDocument.digest,
        output: "mainPart",
        sourceVersion: 7,
      });
      expect(retained?.export("brep")).toEqual(Uint8Array.of(11));
      const unsupported = capturedCadError(() =>
        product.export("brep" as never),
      );
      expect(unsupported.diagnostics[0]).toMatchObject({
        code: "EXPORT_UNSUPPORTED",
        details: {
          output: "product",
          format: "brep",
        },
      });
      expect(product.mesh().positions.length).toBeGreaterThan(0);
    } finally {
      result.value.dispose();
      result.value.dispose();
    }
    expect(() => retained?.measure()).toThrow(/disposed/i);
    expect(harness.disposedShapes).toHaveLength(2);
    expect(harness.liveShapes.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("enforces one cumulative resource budget before any scoped geometry callback", async () => {
    const fixture = await importedProductFixture();
    const events: string[] = [];
    const resolver = resolverHarness(
      fixture.resolverResources,
      events,
    );
    const harness = exactKernelHarness(events);
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      {
        outputs: ["product"],
        resolver: resolver.resolver,
        resourceLimits: { maxResolvedResources: 3 },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "RESOURCE_LIMIT_EXCEEDED",
        details: {
          session: true,
          resource: "maxResolvedResources",
          limit: 3,
          actual: 4,
        },
      });
    }
    expect(resolver.requests.map(requestKey)).toEqual([
      rootScopeKey("aDocument" as ResourceId),
      rootScopeKey("zDocument" as ResourceId),
    ]);
    expect(
      resolver.requests.some(
        ({ documentScope }) =>
          documentScope?.source === "external",
      ),
    ).toBe(false);
    expect(harness.imports).not.toHaveBeenCalled();
    expect(harness.liveShapes.size).toBe(0);
    expect(harness.disposedShapes).toEqual([]);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("reports a missing child configuration after admission with parent occurrence provenance", async () => {
    const child = await primitiveExternalDocument(
      "missing-child-configuration",
      "CONFIG-001",
    );
    const document = singleExternalPartProduct(
      "missing-child-configuration-product",
      "configuredDocument",
      child,
      "configured",
      occurrenceConfiguration("named", "missing"),
    );
    const resolver = resolverHarness(
      new Map([
        [
          rootScopeKey("configuredDocument" as ResourceId),
          child.bytes,
        ],
      ]),
    );
    const harness = await trackedManifold();
    try {
      const result = await evaluateProductAssemblyOutputsV7(
        harness.kernel,
        document,
        {
          outputs: ["product"],
          resolver: resolver.resolver,
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]).toMatchObject({
          code: "CONFIGURATION_MISSING",
          node: "product-assembly",
          path: "/nodes/product-assembly/instances/0/component",
          details: {
            resource: "configuredDocument",
            digest: child.digest,
            byteLength: child.bytes.byteLength,
            output: "mainPart",
            outputKind: "part",
            sourceVersion: 7,
            childPath: "/configurations/missing",
            occurrencePath: ["configured"],
            available: [],
          },
        });
      } else {
        result.value.dispose();
      }
      expect(resolver.requests.map(requestKey)).toEqual([
        rootScopeKey("configuredDocument" as ResourceId),
      ]);
      expect(harness.boxCalls).not.toHaveBeenCalled();
      expect(harness.disposedShapes).toEqual([]);
      expect(harness.liveShapes.size).toBe(0);
      expect(harness.disposeKernel).not.toHaveBeenCalled();
    } finally {
      harness.disposeBase();
    }
  });

  it("reports an unsupported migrated v6 part family without geometry or scoped resource leakage", async () => {
    const legacy = design("unsupported-v6-external-part");
    const profile = legacy.sketch(
      "legacy-profile",
      plane.xy(),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("outline", {
            width: mm(10),
            height: mm(5),
          }),
        ),
    );
    const extrusion = legacy.extrude(
      "legacy-extrusion",
      profile,
      { distance: mm(2) },
    );
    const part = legacy.part("legacy-part", extrusion, {
      partNumber: "LEGACY-EXTRUDE-001",
    });
    legacy.output("mainPart", part);
    const child = await commitLegacyDocument(legacy.build());
    const document = singleExternalPartProduct(
      "unsupported-v6-product",
      "legacyDocument",
      child,
      "unsupported",
      occurrenceConfiguration("base"),
    );
    const resolver = resolverHarness(
      new Map([
        [
          rootScopeKey("legacyDocument" as ResourceId),
          child.bytes,
        ],
      ]),
    );
    const harness = await trackedManifold();
    try {
      const result = await evaluateProductAssemblyOutputsV7(
        harness.kernel,
        document,
        {
          outputs: ["product"],
          resolver: resolver.resolver,
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]).toMatchObject({
          code: "EVALUATION_UNSUPPORTED",
          node: "product-assembly",
          path: "/nodes/product-assembly/instances/0/component",
          details: {
            resource: "legacyDocument",
            digest: child.digest,
            byteLength: child.bytes.byteLength,
            output: "mainPart",
            outputKind: "part",
            sourceVersion: 6,
            childNode: "legacy-part",
            childPath: "/nodes/legacy-part/geometry",
            occurrencePath: ["unsupported"],
            referencedNode: "legacy-extrusion",
            nodeKind: "extrude",
          },
        });
      } else {
        result.value.dispose();
      }
      expect(resolver.requests.map(requestKey)).toEqual([
        rootScopeKey("legacyDocument" as ResourceId),
      ]);
      expect(harness.boxCalls).not.toHaveBeenCalled();
      expect(harness.disposedShapes).toEqual([]);
      expect(harness.liveShapes.size).toBe(0);
      expect(harness.disposeKernel).not.toHaveBeenCalled();
    } finally {
      harness.disposeBase();
    }
  });

  it("wraps legacy child failures with product occurrence provenance", async () => {
    const legacy = design("legacy-external-part");
    const solid = legacy.box("legacy-solid", {
      size: vec3(mm(2), mm(3), mm(4)),
    });
    const part = legacy.part("legacy-part", solid, {
      partNumber: "LEGACY-001",
    });
    legacy.output("mainPart", part);
    const committed = await commitLegacyDocument(legacy.build());

    const cad = stagedBodySetDesignV7("legacy-product");
    const resource = cad.resource("legacyDocument", {
      digest: committed.digest,
      byteLength: committed.bytes.byteLength,
      mediaType: DOCUMENT_MEDIA_TYPE,
    });
    const missing = cad.externalPart(resource, "missingPart");
    const assembly = cad.assembly("product-assembly", (instances) => {
      instances.instance("legacy", missing, {
        configuration: occurrenceConfiguration("base"),
      });
    });
    cad.output("product", assembly);
    const resolver = resolverHarness(
      new Map([
        [
          rootScopeKey("legacyDocument" as ResourceId),
          committed.bytes,
        ],
      ]),
    );
    const harness = await trackedManifold();
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      cad.build(),
      { outputs: ["product"], resolver: resolver.resolver },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "OUTPUT_MISSING",
        node: "product-assembly",
        path: "/nodes/product-assembly/instances/0/component",
        details: {
          resource: "legacyDocument",
          digest: committed.digest,
          byteLength: committed.bytes.byteLength,
          output: "missingPart",
          outputKind: "part",
          sourceVersion: 6,
          childPath: "/outputs/missingPart",
          occurrencePath: ["legacy"],
        },
      });
    }
    expect(resolver.requests.map(requestKey)).toEqual([
      rootScopeKey("legacyDocument" as ResourceId),
    ]);
    expect(harness.boxCalls).not.toHaveBeenCalled();
    expect(harness.liveShapes.size).toBe(0);
    harness.disposeBase();
  });

  it("retains external provenance on child BOM warnings", async () => {
    const child = await primitiveExternalDocument(
      "warning-external-part",
    );
    const cad = stagedBodySetDesignV7("warning-product");
    const resource = cad.resource("warningDocument", {
      digest: child.digest,
      byteLength: child.bytes.byteLength,
      mediaType: DOCUMENT_MEDIA_TYPE,
    });
    const external = cad.externalPart(resource, "mainPart");
    const assembly = cad.assembly("product-assembly", (instances) => {
      instances.instance("warning", external, {
        configuration: occurrenceConfiguration("base"),
      });
    });
    cad.output("product", assembly);
    const resolver = resolverHarness(
      new Map([
        [
          rootScopeKey("warningDocument" as ResourceId),
          child.bytes,
        ],
      ]),
    );
    const harness = await trackedManifold();
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      cad.build(),
      { outputs: ["product"], resolver: resolver.resolver },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (result.ok) {
      try {
        const bom = result.value.output("product").billOfMaterials();
        expect(bom.ok, JSON.stringify(bom.diagnostics)).toBe(true);
        if (bom.ok) {
          expect(
            bom.diagnostics.map(({ code }) => code),
          ).toEqual([
            "BOM_PART_NUMBER_MISSING",
            "BOM_MATERIAL_MISSING",
            "MASS_DENSITY_MISSING",
          ]);
          for (let index = 0; index < bom.diagnostics.length; index += 1) {
            expect(bom.diagnostics[index]).toMatchObject({
              node: "product-assembly",
              path: "/nodes/product-assembly/instances/0/component",
              details: {
                resource: "warningDocument",
                digest: child.digest,
                byteLength: child.bytes.byteLength,
                output: "mainPart",
                outputKind: "part",
                sourceVersion: 7,
                occurrencePath: ["warning"],
              },
            });
            expect(
              bom.diagnostics[index]!.details?.childPath,
            ).toMatch(/^\/nodes\/external-part\//);
          }
        }
      } finally {
        result.value.dispose();
      }
    }
    expect(harness.liveShapes.size).toBe(0);
    harness.disposeBase();
  });

  it("rejects mismatched external assembly declarations after document admission and count overflow before I/O", async () => {
    const fixture = await twoPrimitiveExternalProduct();
    const assemblyDocument = structuredClone(fixture.document);
    const productAssembly = assemblyDocument.nodes[
      "product-assembly" as keyof typeof assemblyDocument.nodes
    ];
    if (
      productAssembly === undefined ||
      productAssembly.kind !== "assembly"
    ) {
      throw new Error("Expected product assembly fixture");
    }
    (
      productAssembly.instances[0]!.component as {
        outputKind: "part" | "assembly";
      }
    ).outputKind = "assembly";

    const assemblyResolver = resolverHarness(fixture.resources);
    const assemblyHarness = await trackedManifold();
    const unsupported = await evaluateProductAssemblyOutputsV7(
      assemblyHarness.kernel,
      assemblyDocument,
      {
        outputs: ["product"],
        resolver: assemblyResolver.resolver,
      },
    );
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) {
      expect(unsupported.diagnostics[0]).toMatchObject({
        code: "EVALUATION_UNSUPPORTED",
        details: {
          componentSource: "external",
          outputKind: "assembly",
          resource: "aDocument",
          output: "mainPart",
        },
      });
    }
    expect(assemblyResolver.requests.map(requestKey)).toEqual([
      rootScopeKey("aDocument" as ResourceId),
      rootScopeKey("zDocument" as ResourceId),
    ]);
    expect(assemblyHarness.boxCalls).not.toHaveBeenCalled();
    assemblyHarness.disposeBase();

    const limitResolver = resolverHarness(fixture.resources);
    const limitHarness = await trackedManifold();
    const limited = await evaluateProductAssemblyOutputsV7(
      limitHarness.kernel,
      fixture.document,
      {
        outputs: ["product"],
        resolver: limitResolver.resolver,
        evaluationLimits: { maxExternalDocuments: 1 },
      },
    );
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.diagnostics[0]).toMatchObject({
        code: "RESOURCE_LIMIT_EXCEEDED",
        details: {
          resource: "maxExternalDocuments",
          limit: 1,
          actual: 2,
        },
      });
    }
    expect(limitResolver.requests).toEqual([]);
    expect(limitHarness.boxCalls).not.toHaveBeenCalled();
    limitHarness.disposeBase();
  });

  it("disposes earlier child geometry when a later external part fails", async () => {
    const fixture = await twoPrimitiveExternalProduct();
    const resolver = resolverHarness(fixture.resources);
    const harness = await trackedManifold(1);
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      { outputs: ["product"], resolver: resolver.resolver },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "KERNEL_ERROR",
        details: {
          resource: "zDocument",
          digest: fixture.zDocument.digest,
          byteLength: fixture.zDocument.bytes.byteLength,
          output: "mainPart",
          outputKind: "part",
          sourceVersion: 7,
          childNode: "external-solid",
          childPath: "/nodes/external-solid",
          occurrencePath: ["z"],
        },
      });
    }
    expect(resolver.requests.map(requestKey)).toEqual([
      rootScopeKey("aDocument" as ResourceId),
      rootScopeKey("zDocument" as ResourceId),
    ]);
    expect(harness.boxCalls).toHaveBeenCalledTimes(2);
    expect(harness.disposedShapes).toHaveLength(1);
    expect(harness.liveShapes.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
    harness.disposeBase();
  });
});
