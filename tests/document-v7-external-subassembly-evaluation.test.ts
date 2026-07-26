import { describe, expect, it, vi } from "vitest";
import type { ConfigurationId, ResourceId } from "../src/core/ids.js";
import { CadError } from "../src/core/result.js";
import { tf } from "../src/design.js";
import {
  EvaluatedBodySetV7,
  EvaluatedPartDesignV7,
  EvaluatedPartV7,
} from "../src/evaluator.js";
import {
  kgPerCubicMillimeter,
  mm,
} from "../src/expressions.js";
import type {
  AssemblyInstanceIRV7,
  DesignDocumentV7,
  ResourceDigestIR,
} from "../src/ir.js";
import type {
  GeometryKernel,
  KernelShape,
} from "../src/kernel.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";
import type {
  ResourceResolverRequestV7,
  ResourceResolverV7,
} from "../src/resource-resolution.js";
import { stringifyDocumentV7 } from "../src/serialization.js";
import { stagedBodySetDesignV7 } from "../src/internal/document-v7-body-set-authoring.js";
import {
  EvaluatedLocalAssemblyDesignV7,
  EvaluatedLocalAssemblyV7,
  evaluateProductAssemblyOutputsV7,
} from "../src/internal/document-v7-local-assembly-evaluation.js";

const DOCUMENT_MEDIA_TYPE =
  "application/vnd.invariantcad.document+json";
const encoder = new TextEncoder();

interface CommittedDocument {
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
  firstShape(): KernelShape | undefined;
  disposeBase(): void;
}

interface LinearCarriageFixture {
  readonly document: DesignDocumentV7;
  readonly child: CommittedDocument;
}

async function digestBytes(
  bytes: Uint8Array,
): Promise<ResourceDigestIR> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function commitDocument(
  document: DesignDocumentV7,
): Promise<CommittedDocument> {
  const bytes = encoder.encode(stringifyDocumentV7(document));
  return {
    document,
    bytes,
    digest: await digestBytes(bytes),
  };
}

async function trackedManifold(
  aliasBoxCall?: number,
): Promise<TrackedManifold> {
  const base = await createManifoldKernel();
  const liveShapes = new Set<KernelShape>();
  const disposedShapes: KernelShape[] = [];
  let boxCall = 0;
  let firstShape: KernelShape | undefined;
  const boxCalls = vi.fn(
    (
      ...arguments_: Parameters<
        NonNullable<GeometryKernel["box"]>
      >
    ): KernelShape => {
      boxCall += 1;
      if (
        aliasBoxCall !== undefined &&
        boxCall === aliasBoxCall &&
        firstShape !== undefined
      ) {
        return firstShape;
      }
      const shape = base.box!(...arguments_);
      firstShape ??= shape;
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
    firstShape: () => firstShape,
    disposeBase: () => base.dispose(),
  };
}

function childModule(): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7("linear-carriage-module");
  const spacing = cad.parameter.length("spacing", mm(10));
  const carriageSolid = cad.box("carriage-solid", {
    size: [spacing, mm(6), mm(4)],
  });
  const sensorSolid = cad.box("sensor-solid", {
    size: [mm(2), mm(2), mm(2)],
  });
  const carriage = cad.part("carriage", carriageSolid, {
    partNumber: "CARRIAGE-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const sensor = cad.part("sensor", sensorSolid, {
    partNumber: "SENSOR-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const core = cad.assembly("core", (instances) => {
    instances.instance("carriage-leaf", carriage, {
      placement: [tf.translate([mm(1), mm(0), mm(0)])],
    });
    instances.instance("sensor-leaf", sensor, {
      placement: [tf.translate([spacing, mm(0), mm(0)])],
    });
  });
  const module = cad.assembly("module", (instances) => {
    instances.instance("core-instance", core, {
      placement: [tf.translate([spacing, mm(0), mm(0)])],
    });
  });
  cad.configuration("service", (configuration) => {
    configuration.parameter(spacing, mm(20));
    configuration.instanceSuppressed(core, "sensor-leaf");
  });
  cad.output("module", module);
  return cad.build();
}

async function linearCarriageFixture(): Promise<LinearCarriageFixture> {
  const child = await commitDocument(childModule());
  const cad = stagedBodySetDesignV7("carriage-product");
  const spacing = cad.parameter.length("spacing", mm(3));
  cad.configuration("service", (configuration) => {
    configuration.parameter(spacing, mm(7));
  });
  const resource = cad.resource("carriageModule", {
    digest: child.digest,
    byteLength: child.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const module = cad.externalAssembly(resource, "module");
  const product = cad.assembly("product", (instances) => {
    instances.instance("base-first", module, {
      configuration: { mode: "base" },
    });
    instances.instance("base-second", module, {
      configuration: { mode: "base" },
      placement: [tf.translate([mm(50), mm(0), mm(0)])],
    });
    instances.instance("inherited-service", module, {
      placement: [tf.translate([spacing, mm(0), mm(0)])],
    });
    instances.instance("named-service", module, {
      configuration: {
        mode: "named",
        id: "service" as ConfigurationId,
      },
      placement: [tf.translate([mm(100), mm(0), mm(0)])],
    });
  });
  cad.output("product", product);
  return { child, document: cad.build() };
}

function resolverFor(
  committed: CommittedDocument,
): {
  readonly requests: ResourceResolverRequestV7[];
  readonly resolver: ResourceResolverV7;
} {
  const requests: ResourceResolverRequestV7[] = [];
  const resolver: ResourceResolverV7 = vi.fn((request) => {
    requests.push(request);
    expect(request.id).toBe("carriageModule");
    expect(request.documentScope).toEqual({ source: "root" });
    expect(Object.isFrozen(request.documentScope)).toBe(true);
    return committed.bytes;
  });
  return { requests, resolver };
}

function singleModuleProduct(
  committed: CommittedDocument,
  occurrenceId: string,
  configuration: AssemblyInstanceIRV7["configuration"],
): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7("single-carriage-product");
  const resource = cad.resource("carriageModule", {
    digest: committed.digest,
    byteLength: committed.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const module = cad.externalAssembly(resource, "module");
  const product = cad.assembly("product", (instances) => {
    instances.instance(occurrenceId, module, { configuration });
  });
  cad.output("product", product);
  return cad.build();
}

function childModuleWithNestedExternal(): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7(
    "linear-carriage-module-with-vendor-boundary",
  );
  const carriageSolid = cad.box("carriage-solid", {
    size: [mm(10), mm(6), mm(4)],
  });
  const carriage = cad.part("carriage", carriageSolid, {
    partNumber: "CARRIAGE-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const vendorDocument = cad.resource("vendorDocument", {
    digest: `sha256:${"0".repeat(64)}`,
    byteLength: 1,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const vendorModule = cad.externalAssembly(
    vendorDocument,
    "vendorModule",
  );
  const module = cad.assembly("module", (instances) => {
    instances.instance("carriage-leaf", carriage);
    instances.instance("vendor-boundary", vendorModule, {
      suppressed: true,
    });
  });
  cad.configuration("activateVendor", (configuration) => {
    configuration.instanceSuppressed(
      module,
      "vendor-boundary",
      false,
    );
  });
  cad.output("module", module);
  return cad.build();
}

function singleLeafChildModule(
  includeAssemblyAlias = false,
): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7("single-leaf-child-module");
  const solid = cad.box("leaf-solid", {
    size: [mm(4), mm(3), mm(2)],
  });
  const part = cad.part("leaf-definition", solid, {
    partNumber: "LEAF-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const module = cad.assembly("module-definition", (instances) => {
    instances.instance("leaf-occurrence", part);
  });
  cad.output("module", module);
  if (includeAssemblyAlias) {
    cad.output("moduleAlias", module);
  }
  return cad.build();
}

function bodySetLeafChildModule(
  includeAssemblyAlias = false,
): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7("body-set-leaf-child-module");
  const first = cad.box("first-body-solid", {
    size: [mm(4), mm(3), mm(2)],
  });
  const second = cad.box("second-body-solid", {
    size: [mm(2), mm(2), mm(2)],
  });
  const bodies = cad.bodySet("leaf-body-set", [
    { id: "first-body", solid: first },
    { id: "second-body", solid: second },
  ]);
  const part = cad.part("body-set-leaf", bodies, {
    partNumber: "BODY-SET-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const module = cad.assembly("module-definition", (instances) => {
    instances.instance("body-set-occurrence", part);
  });
  cad.output("module", module);
  if (includeAssemblyAlias) {
    cad.output("moduleAlias", module);
  }
  return cad.build();
}

function twoLeafChildModule(): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7("two-leaf-child-module");
  const firstSolid = cad.box("first-solid", {
    size: [mm(2), mm(2), mm(2)],
  });
  const secondSolid = cad.box("second-solid", {
    size: [mm(3), mm(2), mm(2)],
  });
  const first = cad.part("first-part", firstSolid, {
    partNumber: "FIRST-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const second = cad.part("second-part", secondSolid, {
    partNumber: "SECOND-001",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const module = cad.assembly("module-definition", (instances) => {
    instances.instance("first-leaf", first);
    instances.instance("second-leaf", second);
  });
  cad.output("module", module);
  return cad.build();
}

function sharedImportedLeafChildModule(): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7("shared-import-child-module");
  const resource = cad.resource("sharedBody", {
    digest: `sha256:${"1".repeat(64)}`,
    byteLength: 3,
    mediaType: "model/brep",
  });
  const firstSolid = cad.importedBody("first-import", resource, {
    format: "brep",
    units: { mode: "declared", length: "mm" },
  });
  const secondSolid = cad.importedBody("second-import", resource, {
    format: "brep",
    units: { mode: "declared", length: "mm" },
  });
  const first = cad.part("first-part", firstSolid, {
    partNumber: "FIRST-IMPORT",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const second = cad.part("second-part", secondSolid, {
    partNumber: "SECOND-IMPORT",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const module = cad.assembly("module-definition", (instances) => {
    instances.instance("first-leaf", first);
    instances.instance("second-leaf", second);
  });
  cad.output("module", module);
  return cad.build();
}

async function singleExternalAssemblyProduct(
  childDocument: DesignDocumentV7,
  occurrenceId = "module-instance",
): Promise<LinearCarriageFixture> {
  const child = await commitDocument(childDocument);
  const cad = stagedBodySetDesignV7("single-external-module-product");
  const resource = cad.resource("carriageModule", {
    digest: child.digest,
    byteLength: child.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const module = cad.externalAssembly(resource, "module");
  const product = cad.assembly("product", (instances) => {
    instances.instance(occurrenceId, module, {
      configuration: { mode: "base" },
    });
  });
  cad.output("product", product);
  return { child, document: cad.build() };
}

async function externalAssemblyAliasProduct(
  childDocument: DesignDocumentV7 = singleLeafChildModule(true),
): Promise<LinearCarriageFixture> {
  const child = await commitDocument(childDocument);
  const cad = stagedBodySetDesignV7("external-module-alias-product");
  const resource = cad.resource("carriageModule", {
    digest: child.digest,
    byteLength: child.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
  });
  const module = cad.externalAssembly(resource, "module");
  const alias = cad.externalAssembly(resource, "moduleAlias");
  const product = cad.assembly("product", (instances) => {
    instances.instance("main-module", module, {
      configuration: { mode: "base" },
    });
    instances.instance("alias-module", alias, {
      configuration: { mode: "base" },
      placement: [tf.translate([mm(20), mm(0), mm(0)])],
    });
  });
  cad.output("product", product);
  return { child, document: cad.build() };
}

function importCapableKernelHarness(): {
  readonly kernel: GeometryKernel;
  readonly importCalls: ReturnType<typeof vi.fn>;
  readonly disposedShapes: KernelShape[];
  readonly liveShapes: Set<KernelShape>;
  readonly disposeKernel: ReturnType<typeof vi.fn>;
} {
  const liveShapes = new Set<KernelShape>();
  const disposedShapes: KernelShape[] = [];
  const disposeKernel = vi.fn();
  const importCalls = vi.fn(
    (
      ..._arguments: Parameters<
        NonNullable<GeometryKernel["importDocumentBody"]>
      >
    ): KernelShape => {
      const shape = {
        kernel: "external-subassembly-resource-test",
      };
      liveShapes.add(shape);
      return shape;
    },
  );
  const kernel: GeometryKernel = {
    id: "external-subassembly-resource-test",
    capabilities: {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: [],
      documentBodyImport: {
        protocolVersion: 1,
        formats: [
          {
            format: "brep",
            unitModes: ["declared"],
          },
        ],
      },
    },
    importDocumentBody: (...arguments_) =>
      importCalls(...arguments_),
    status: () => ({ ok: true, code: "VALID" }),
    measure: () => ({
      volume: 1,
      surfaceArea: 6,
      boundingBox: {
        min: [0, 0, 0],
        max: [1, 1, 1],
      },
      centerOfMass: [0.5, 0.5, 0.5],
      inertiaTensor: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
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
    disposeShape(shape) {
      disposedShapes.push(shape);
      liveShapes.delete(shape);
    },
    dispose: disposeKernel,
  };
  return {
    kernel,
    importCalls,
    disposedShapes,
    liveShapes,
    disposeKernel,
  };
}

describe("external fixed-subassembly evaluation", () => {
  it("evaluates a configured linear carriage with reusable child parts and complete provenance", async () => {
    const fixture = await linearCarriageFixture();
    const resolved = resolverFor(fixture.child);
    const harness = await trackedManifold();
    const evaluated = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      {
        configuration: "service",
        parameters: { spacing: 9 },
        resolver: resolved.resolver,
      },
    );
    expect(
      evaluated.ok,
      JSON.stringify(evaluated.diagnostics),
    ).toBe(true);
    if (!evaluated.ok) {
      harness.disposeBase();
      return;
    }

    const retainedPart =
      evaluated.value.output("product").occurrences[0]!.part;
    try {
      expect(evaluated.value).toMatchObject({
        configurationId: "service",
        parameters: { spacing: 9 },
        outputNames: ["product"],
      });
      expect(Object.isFrozen(evaluated.value)).toBe(true);
      expect(Object.isFrozen(evaluated.value.parameters)).toBe(true);

      const output = evaluated.value.output("product");
      expect(
        output.occurrences.map((occurrence) => ({
          path: occurrence.path,
          configuration: occurrence.configurationId,
          translation: [
            occurrence.transform[12],
            occurrence.transform[13],
            occurrence.transform[14],
          ],
          output:
            occurrence.component.source === "external"
              ? occurrence.component.output
              : undefined,
          outputKind:
            occurrence.component.source === "external"
              ? occurrence.component.outputKind
              : undefined,
          partNode: occurrence.partNode,
        })),
      ).toEqual([
        {
          path: [
            "base-first",
            "core-instance",
            "carriage-leaf",
          ],
          configuration: null,
          translation: [11, 0, 0],
          output: "module",
          outputKind: "assembly",
          partNode: "carriage",
        },
        {
          path: [
            "base-first",
            "core-instance",
            "sensor-leaf",
          ],
          configuration: null,
          translation: [20, 0, 0],
          output: "module",
          outputKind: "assembly",
          partNode: "sensor",
        },
        {
          path: [
            "base-second",
            "core-instance",
            "carriage-leaf",
          ],
          configuration: null,
          translation: [61, 0, 0],
          output: "module",
          outputKind: "assembly",
          partNode: "carriage",
        },
        {
          path: [
            "base-second",
            "core-instance",
            "sensor-leaf",
          ],
          configuration: null,
          translation: [70, 0, 0],
          output: "module",
          outputKind: "assembly",
          partNode: "sensor",
        },
        {
          path: [
            "inherited-service",
            "core-instance",
            "carriage-leaf",
          ],
          configuration: "service",
          translation: [30, 0, 0],
          output: "module",
          outputKind: "assembly",
          partNode: "carriage",
        },
        {
          path: [
            "named-service",
            "core-instance",
            "carriage-leaf",
          ],
          configuration: "service",
          translation: [121, 0, 0],
          output: "module",
          outputKind: "assembly",
          partNode: "carriage",
        },
      ]);
      const occurrences = output.occurrences;
      expect(occurrences[0]!.part).toBe(occurrences[2]!.part);
      expect(occurrences[1]!.part).toBe(occurrences[3]!.part);
      expect(occurrences[4]!.part).toBe(occurrences[5]!.part);
      expect(occurrences[0]!.part).not.toBe(occurrences[4]!.part);

      const baseCarriage = occurrences[0]!.part.geometry;
      const serviceCarriage = occurrences[4]!.part.geometry;
      expect(baseCarriage.kind).toBe("solid");
      expect(serviceCarriage.kind).toBe("solid");
      if (
        baseCarriage.kind !== "solid" ||
        serviceCarriage.kind !== "solid"
      ) {
        throw new Error("Expected solid carriage parts");
      }
      expect(baseCarriage.solid.measure().volume).toBeCloseTo(240);
      expect(serviceCarriage.solid.measure().volume).toBeCloseTo(
        480,
      );
      expect(
        harness.boxCalls.mock.calls.map((call) => call[0]),
      ).toEqual([
        [10, 6, 4],
        [2, 2, 2],
        [20, 6, 4],
      ]);

      for (const occurrence of occurrences) {
        expect(occurrence.component).toMatchObject({
          source: "external",
          resource: "carriageModule",
          digest: fixture.child.digest,
          byteLength: fixture.child.bytes.byteLength,
          output: "module",
          outputKind: "assembly",
          sourceVersion: 7,
          partNode: occurrence.partNode,
        });
        expect(Object.isFrozen(occurrence)).toBe(true);
        expect(Object.isFrozen(occurrence.path)).toBe(true);
        expect(Object.isFrozen(occurrence.component)).toBe(true);
        expect(Object.isFrozen(occurrence.transform)).toBe(true);
      }
      expect(Object.isFrozen(output)).toBe(true);
      expect(Object.isFrozen(output.occurrences)).toBe(true);

      const bom = output.billOfMaterials();
      expect(bom.ok, JSON.stringify(bom.diagnostics)).toBe(true);
      if (bom.ok) {
        expect(bom.value).toMatchObject({
          rootConfigurationId: "service",
          totalQuantity: 6,
          massComplete: true,
        });
        expect(bom.value.knownMass).toBeCloseTo(0.001456);
        expect(bom.value.totalMass).toBeCloseTo(0.001456);
        expect(
          bom.value.items.map((item) => ({
            partNumber: item.partNumber,
            partNode: item.partNode,
            configuration: item.effectiveConfigurationId,
            quantity: item.quantity,
            paths: item.occurrencePaths,
            output:
              item.component.source === "external"
                ? item.component.output
                : undefined,
            outputKind:
              item.component.source === "external"
                ? item.component.outputKind
                : undefined,
          })),
        ).toEqual([
          {
            partNumber: "CARRIAGE-001",
            partNode: "carriage",
            configuration: null,
            quantity: 2,
            paths: [
              [
                "base-first",
                "core-instance",
                "carriage-leaf",
              ],
              [
                "base-second",
                "core-instance",
                "carriage-leaf",
              ],
            ],
            output: "module",
            outputKind: "assembly",
          },
          {
            partNumber: "CARRIAGE-001",
            partNode: "carriage",
            configuration: "service",
            quantity: 2,
            paths: [
              [
                "inherited-service",
                "core-instance",
                "carriage-leaf",
              ],
              [
                "named-service",
                "core-instance",
                "carriage-leaf",
              ],
            ],
            output: "module",
            outputKind: "assembly",
          },
          {
            partNumber: "SENSOR-001",
            partNode: "sensor",
            configuration: null,
            quantity: 2,
            paths: [
              [
                "base-first",
                "core-instance",
                "sensor-leaf",
              ],
              [
                "base-second",
                "core-instance",
                "sensor-leaf",
              ],
            ],
            output: "module",
            outputKind: "assembly",
          },
        ]);
        expect(Object.isFrozen(bom.value)).toBe(true);
        expect(Object.isFrozen(bom.value.items)).toBe(true);
        expect(Object.isFrozen(bom.value.items[0])).toBe(true);
        expect(
          Object.isFrozen(bom.value.items[0]!.occurrencePaths),
        ).toBe(true);
        expect(
          Object.isFrozen(
            bom.value.items[0]!.occurrencePaths[0],
          ),
        ).toBe(true);
      }
      expect(output.export("stl")).toBeInstanceOf(Uint8Array);
      expect(() => output.export("step" as never)).toThrow(
        /unsupported|cannot/i,
      );
      expect(resolved.requests).toHaveLength(1);
    } finally {
      evaluated.value.dispose();
      evaluated.value.dispose();
    }

    expect(() => retainedPart.mesh()).toThrow(/disposed/i);
    expect(harness.disposedShapes).toHaveLength(3);
    expect(harness.liveShapes.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();

    const borrowed = harness.kernel.box!([1, 1, 1], false);
    expect(harness.kernel.measure(borrowed).volume).toBeCloseTo(1);
    harness.kernel.disposeShape(borrowed);
    expect(harness.liveShapes.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("accepts exact traversal ceilings and rejects every one-below ceiling before kernel work", async () => {
    const fixture = await linearCarriageFixture();
    const exactLimits = {
      maxAssemblyDepth: 3,
      maxScannedInstances: 16,
      maxActiveOccurrences: 14,
      maxOccurrencePathSegments: 18,
      maxPlacementOperations: 13,
      maxExternalDocuments: 1,
      maxContextualParts: 3,
    } as const;
    const exactResolver = resolverFor(fixture.child);
    const exactHarness = await trackedManifold();
    const exact = await evaluateProductAssemblyOutputsV7(
      exactHarness.kernel,
      fixture.document,
      {
        configuration: "service",
        parameters: { spacing: 9 },
        resolver: exactResolver.resolver,
        evaluationLimits: exactLimits,
      },
    );
    expect(exact.ok, JSON.stringify(exact.diagnostics)).toBe(true);
    if (exact.ok) exact.value.dispose();
    expect(exactResolver.requests).toHaveLength(1);
    expect(exactHarness.boxCalls).toHaveBeenCalledTimes(3);
    expect(exactHarness.liveShapes.size).toBe(0);
    expect(exactHarness.disposeKernel).not.toHaveBeenCalled();
    exactHarness.disposeBase();

    const oneBelow = [
      {
        resource: "maxAssemblyDepth",
        limit: 2,
        actual: 3,
        resolves: true,
      },
      {
        resource: "maxScannedInstances",
        limit: 15,
        actual: 16,
        resolves: true,
      },
      {
        resource: "maxActiveOccurrences",
        limit: 13,
        actual: 14,
        resolves: true,
      },
      {
        resource: "maxOccurrencePathSegments",
        limit: 17,
        actual: 18,
        resolves: true,
      },
      {
        resource: "maxPlacementOperations",
        limit: 12,
        actual: 13,
        resolves: true,
      },
      {
        resource: "maxExternalDocuments",
        limit: 0,
        actual: 1,
        resolves: false,
      },
      {
        resource: "maxContextualParts",
        limit: 2,
        actual: 3,
        resolves: true,
      },
    ] as const;
    const limitedHarness = await trackedManifold();
    for (const boundary of oneBelow) {
      const resolved = resolverFor(fixture.child);
      const limited = await evaluateProductAssemblyOutputsV7(
        limitedHarness.kernel,
        fixture.document,
        {
          configuration: "service",
          parameters: { spacing: 9 },
          resolver: resolved.resolver,
          evaluationLimits: {
            ...exactLimits,
            [boundary.resource]: boundary.limit,
          },
        },
      );
      expect(limited.ok).toBe(false);
      if (!limited.ok) {
        expect(limited.diagnostics[0]).toMatchObject({
          code: "RESOURCE_LIMIT_EXCEEDED",
          details: {
            resource: boundary.resource,
            limit: boundary.limit,
            actual: boundary.actual,
          },
        });
      } else {
        limited.value.dispose();
      }
      expect(resolved.requests).toHaveLength(
        boundary.resolves ? 1 : 0,
      );
      expect(limitedHarness.boxCalls).not.toHaveBeenCalled();
      expect(limitedHarness.liveShapes.size).toBe(0);
      expect(limitedHarness.disposeKernel).not.toHaveBeenCalled();
    }
    limitedHarness.disposeBase();
  });

  it("reports a missing child configuration with outer occurrence and child-document provenance", async () => {
    const child = await commitDocument(childModule());
    const document = singleModuleProduct(
      child,
      "missing-module",
      {
        mode: "named",
        id: "missing" as ConfigurationId,
      },
    );
    const resolved = resolverFor(child);
    const harness = await trackedManifold();
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      document,
      { resolver: resolved.resolver },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "CONFIGURATION_MISSING",
        node: "product",
        path: "/nodes/product/instances/0/component",
        details: {
          componentSource: "external",
          resource: "carriageModule",
          componentResource: "carriageModule",
          digest: child.digest,
          byteLength: child.bytes.byteLength,
          output: "module",
          outputKind: "assembly",
          sourceVersion: 7,
          childPath: "/configurations/missing",
          occurrencePath: ["missing-module"],
          available: ["service"],
        },
      });
    } else {
      result.value.dispose();
    }
    expect(resolved.requests).toHaveLength(1);
    expect(harness.boxCalls).not.toHaveBeenCalled();
    expect(harness.disposedShapes).toEqual([]);
    expect(harness.liveShapes.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
    harness.disposeBase();
  });

  it("keeps a suppressed nested document boundary inert and rejects it when activated", async () => {
    const child = await commitDocument(
      childModuleWithNestedExternal(),
    );

    const inertDocument = singleModuleProduct(
      child,
      "inert-module",
      { mode: "base" },
    );
    const inertResolver = resolverFor(child);
    const inertHarness = await trackedManifold();
    const inert = await evaluateProductAssemblyOutputsV7(
      inertHarness.kernel,
      inertDocument,
      { resolver: inertResolver.resolver },
    );
    expect(inert.ok, JSON.stringify(inert.diagnostics)).toBe(true);
    if (inert.ok) {
      expect(
        inert.value
          .output("product")
          .occurrences.map((occurrence) => occurrence.path),
      ).toEqual([["inert-module", "carriage-leaf"]]);
      inert.value.dispose();
    }
    expect(inertResolver.requests).toHaveLength(1);
    expect(inertHarness.boxCalls).toHaveBeenCalledTimes(1);
    expect(inertHarness.disposedShapes).toHaveLength(1);
    expect(inertHarness.liveShapes.size).toBe(0);
    expect(inertHarness.disposeKernel).not.toHaveBeenCalled();
    inertHarness.disposeBase();

    const activeDocument = singleModuleProduct(
      child,
      "active-module",
      {
        mode: "named",
        id: "activateVendor" as ConfigurationId,
      },
    );
    const activeResolver = resolverFor(child);
    const activeHarness = await trackedManifold();
    const active = await evaluateProductAssemblyOutputsV7(
      activeHarness.kernel,
      activeDocument,
      { resolver: activeResolver.resolver },
    );
    expect(active.ok).toBe(false);
    if (!active.ok) {
      expect(active.diagnostics[0]).toMatchObject({
        code: "EVALUATION_UNSUPPORTED",
        node: "product",
        path: "/nodes/product/instances/0/component",
        details: {
          componentSource: "external",
          resource: "carriageModule",
          componentResource: "carriageModule",
          digest: child.digest,
          byteLength: child.bytes.byteLength,
          output: "module",
          outputKind: "assembly",
          sourceVersion: 7,
          childNode: "module",
          childPath: "/nodes/module/instances/1/component",
          occurrencePath: [
            "active-module",
            "vendor-boundary",
          ],
          nestedResource: "vendorDocument",
          nestedOutput: "vendorModule",
          nestedOutputKind: "assembly",
        },
      });
    } else {
      active.value.dispose();
    }
    expect(activeResolver.requests).toHaveLength(1);
    expect(activeHarness.boxCalls).not.toHaveBeenCalled();
    expect(activeHarness.disposedShapes).toEqual([]);
    expect(activeHarness.liveShapes.size).toBe(0);
    expect(activeHarness.disposeKernel).not.toHaveBeenCalled();
    activeHarness.disposeBase();
  });

  it("rejects a kernel shape alias across prepared child contexts and disposes it exactly once", async () => {
    const fixture = await linearCarriageFixture();
    const resolved = resolverFor(fixture.child);
    const harness = await trackedManifold(3);
    try {
      const result = await evaluateProductAssemblyOutputsV7(
        harness.kernel,
        fixture.document,
        {
          configuration: "service",
          resolver: resolved.resolver,
        },
      );
      if (result.ok) {
        try {
          result.value.dispose();
        } catch {
          // The red-path implementation may attempt to release the alias twice.
        }
      }

      expect.soft(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostics[0]).toMatchObject({
          code: "KERNEL_ERROR",
          node: "carriage-solid",
          path: "/nodes/carriage-solid",
          details: {
            componentSource: "external",
            componentResource: "carriageModule",
            output: "module",
            outputKind: "assembly",
            componentPaths: [
              "/nodes/product/instances/2/component",
              "/nodes/product/instances/3/component",
            ],
            affectedOccurrencePaths: [
              [
                "inherited-service",
                "core-instance",
                "carriage-leaf",
              ],
              [
                "named-service",
                "core-instance",
                "carriage-leaf",
              ],
            ],
            protocolViolation: true,
          },
        });
      }

      const aliased = harness.firstShape();
      expect(aliased).toBeDefined();
      expect(
        harness.disposedShapes.filter(
          (shape) => shape === aliased,
        ),
      ).toHaveLength(1);
      expect(harness.disposedShapes).toHaveLength(2);
      expect(new Set(harness.disposedShapes).size).toBe(2);
      expect(harness.liveShapes.size).toBe(0);
      expect(harness.disposeKernel).not.toHaveBeenCalled();
      expect(resolved.requests).toHaveLength(1);
    } finally {
      harness.disposeBase();
    }
  });

  it("reuses geometry across external assembly output aliases without collapsing component or BOM identity", async () => {
    const fixture = await externalAssemblyAliasProduct();
    const resolved = resolverFor(fixture.child);
    const harness = await trackedManifold();
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      { resolver: resolved.resolver },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    try {
      const output = result.value.output("product");
      expect(output.occurrences).toHaveLength(2);
      const [main, alias] = output.occurrences;
      expect(main!.component).not.toBe(alias!.component);
      expect(
        output.occurrences.map((occurrence) =>
          occurrence.component.source === "external"
            ? occurrence.component.output
            : undefined,
        ),
      ).toEqual(["module", "moduleAlias"]);
      expect(harness.boxCalls).toHaveBeenCalledTimes(1);

      const bom = output.billOfMaterials();
      expect(bom.ok, JSON.stringify(bom.diagnostics)).toBe(true);
      if (bom.ok) {
        expect(
          bom.value.items.map((item) => ({
            output:
              item.component.source === "external"
                ? item.component.output
                : undefined,
            partNode: item.partNode,
            quantity: item.quantity,
          })),
        ).toEqual([
          {
            output: "module",
            partNode: "leaf-definition",
            quantity: 1,
          },
          {
            output: "moduleAlias",
            partNode: "leaf-definition",
            quantity: 1,
          },
        ]);
      }
    } finally {
      result.value.dispose();
      expect(harness.disposedShapes).toHaveLength(1);
      expect(harness.liveShapes.size).toBe(0);
      expect(harness.disposeKernel).not.toHaveBeenCalled();
      harness.disposeBase();
    }
  });

  it("shares immutable multibody backing state across assembly output aliases", async () => {
    const fixture = await externalAssemblyAliasProduct(
      bodySetLeafChildModule(true),
    );
    const resolved = resolverFor(fixture.child);
    const harness = await trackedManifold();
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      { resolver: resolved.resolver },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    try {
      const occurrences =
        result.value.output("product").occurrences;
      expect(occurrences).toHaveLength(2);
      const first = occurrences[0]!.part.geometry;
      const second = occurrences[1]!.part.geometry;
      expect(first.kind).toBe("bodySet");
      expect(second.kind).toBe("bodySet");
      if (first.kind !== "bodySet" || second.kind !== "bodySet") {
        return;
      }
      expect(first.bodySet).not.toBe(second.bodySet);
      expect(first.bodySet.bodies).toBe(second.bodySet.bodies);
      expect(first.bodySet.bodyIds).toBe(second.bodySet.bodyIds);
      expect(harness.boxCalls).toHaveBeenCalledTimes(2);
    } finally {
      result.value.dispose();
      expect(harness.disposedShapes).toHaveLength(2);
      expect(harness.liveShapes.size).toBe(0);
      harness.disposeBase();
    }
  });

  it("keeps an aggregate child work-limit failure at the external assembly boundary", async () => {
    const fixture = await singleExternalAssemblyProduct(
      twoLeafChildModule(),
    );
    const resolved = resolverFor(fixture.child);
    const harness = await trackedManifold();
    try {
      const result = await evaluateProductAssemblyOutputsV7(
        harness.kernel,
        fixture.document,
        {
          resolver: resolved.resolver,
          evaluationLimits: { maxPartBodies: 1 },
        },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const item = result.diagnostics[0]!;
        expect(item).toMatchObject({
          code: "RESOURCE_LIMIT_EXCEEDED",
          node: "product",
          path: "/nodes/product/instances/0/component",
          details: {
            componentSource: "external",
            componentResource: "carriageModule",
            output: "module",
            outputKind: "assembly",
            childPath: "/nodes/second-part/geometry",
            occurrencePath: ["module-instance"],
            resource: "maxPartBodies",
            limit: 1,
            actual: 2,
          },
        });
        expect(item.details).not.toHaveProperty("childNode");
        expect(item.details).not.toHaveProperty("childPartNode");
      } else {
        result.value.dispose();
      }
      expect(resolved.requests).toHaveLength(1);
      expect(harness.boxCalls).not.toHaveBeenCalled();
      expect(harness.disposedShapes).toEqual([]);
      expect(harness.liveShapes.size).toBe(0);
    } finally {
      harness.disposeBase();
    }
  });

  it("does not claim one leaf when a shared child geometry resource fails", async () => {
    const fixture = await singleExternalAssemblyProduct(
      sharedImportedLeafChildModule(),
    );
    const requests: ResourceResolverRequestV7[] = [];
    const resolver: ResourceResolverV7 = vi.fn((request) => {
      requests.push(request);
      if (
        request.documentScope?.source === "root" &&
        request.id === "carriageModule"
      ) {
        return fixture.child.bytes;
      }
      if (
        request.documentScope?.source === "external" &&
        request.documentScope.resource === "carriageModule" &&
        request.id === "sharedBody"
      ) {
        throw new Error("shared child geometry is unavailable");
      }
      throw new Error(`Unexpected resource '${request.id}'`);
    });
    const harness = importCapableKernelHarness();
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      { resolver },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const item = result.diagnostics[0]!;
      expect(item).toMatchObject({
        code: "RESOURCE_RESOLUTION_FAILED",
        node: "product",
        path: "/nodes/product/instances/0/component",
        details: {
          componentSource: "external",
          componentResource: "carriageModule",
          output: "module",
          outputKind: "assembly",
          resourceId: "sharedBody",
          documentScope: {
            source: "external",
            resource: "carriageModule",
            digest: fixture.child.digest,
          },
          occurrencePath: ["module-instance"],
        },
      });
      expect(item.details).not.toHaveProperty("childNode");
      expect(item.details).not.toHaveProperty("childPartNode");
    } else {
      result.value.dispose();
    }
    expect(requests).toHaveLength(2);
    expect(harness.importCalls).not.toHaveBeenCalled();
    expect(harness.disposedShapes).toEqual([]);
    expect(harness.liveShapes.size).toBe(0);
    expect(harness.disposeKernel).not.toHaveBeenCalled();
  });

  it("retains the child component path for a deferred occurrence mesh failure", async () => {
    const fixture = await singleExternalAssemblyProduct(
      childModule(),
      "mesh-module",
    );
    const resolved = resolverFor(fixture.child);
    const harness = await trackedManifold();
    const meshCalls = vi.fn(
      (
        ..._arguments: Parameters<GeometryKernel["mesh"]>
      ): never => {
        throw Symbol("opaque-child-mesh-failure");
      },
    );
    const kernel: GeometryKernel = {
      ...harness.kernel,
      mesh: (...arguments_) => meshCalls(...arguments_),
    };
    const result = await evaluateProductAssemblyOutputsV7(
      kernel,
      fixture.document,
      { resolver: resolved.resolver },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    try {
      let thrown: unknown;
      try {
        result.value.output("product").mesh();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CadError);
      const item = (thrown as CadError).diagnostics[0]!;
      expect(item).toMatchObject({
        code: "KERNEL_ERROR",
        node: "product",
        path: "/nodes/product/instances/0/component",
        details: {
          childNode: "carriage",
          childPath: "/nodes/core/instances/0/component",
          occurrencePath: [
            "mesh-module",
            "core-instance",
            "carriage-leaf",
          ],
          reason: "mesh-callback-threw",
          protocolViolation: true,
        },
      });
      expect(meshCalls).toHaveBeenCalledTimes(1);
    } finally {
      result.value.dispose();
      expect(harness.liveShapes.size).toBe(0);
      harness.disposeBase();
    }
  });

  it("never represents a synthetic part selector as an authored output in deferred diagnostics", async () => {
    const fixture = await singleExternalAssemblyProduct(
      singleLeafChildModule(),
    );
    const resolved = resolverFor(fixture.child);
    const harness = await trackedManifold();
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      { resolver: resolved.resolver },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    try {
      const occurrence =
        result.value.output("product").occurrences[0]!;
      expect(
        "withExternalAssemblyContext" in occurrence.part,
      ).toBe(false);
      let thrown: unknown;
      try {
        (
          occurrence.part.export as unknown as (
            format: "step",
          ) => unknown
        )("step");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CadError);
      const item = (thrown as CadError).diagnostics[0]!;
      expect(item).toMatchObject({
        code: "EXPORT_UNSUPPORTED",
        details: {
          output: "module",
          outputKind: "assembly",
          childPartNode: "leaf-definition",
          format: "step",
        },
      });
      expect(item.details?.output).not.toBe("leaf-definition");
    } finally {
      result.value.dispose();
      expect(harness.liveShapes.size).toBe(0);
      harness.disposeBase();
    }
  });

  it("preserves external assembly identity in deferred multibody diagnostics", async () => {
    const fixture = await singleExternalAssemblyProduct(
      bodySetLeafChildModule(),
    );
    const resolved = resolverFor(fixture.child);
    const harness = await trackedManifold();
    const result = await evaluateProductAssemblyOutputsV7(
      harness.kernel,
      fixture.document,
      { resolver: resolved.resolver },
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) {
      harness.disposeBase();
      return;
    }
    try {
      const part =
        result.value.output("product").occurrences[0]!.part;
      expect(part.name).toBe("body-set-leaf");
      expect(part.geometry.kind).toBe("bodySet");
      if (part.geometry.kind !== "bodySet") return;
      let thrown: unknown;
      try {
        (
          part.geometry.bodySet.export as unknown as (
            format: "step",
          ) => unknown
        )("step");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CadError);
      expect((thrown as CadError).diagnostics[0]).toMatchObject({
        code: "EXPORT_UNSUPPORTED",
        details: {
          output: "module",
          outputKind: "assembly",
          childPartNode: "body-set-leaf",
          format: "step",
        },
      });
    } finally {
      result.value.dispose();
      expect(harness.disposedShapes).toHaveLength(2);
      expect(harness.liveShapes.size).toBe(0);
      harness.disposeBase();
    }
  });

  it("retains authentic product methods when a kernel mutates result prototypes", async () => {
    const fixture = await singleExternalAssemblyProduct(
      bodySetLeafChildModule(),
    );
    const resolved = resolverFor(fixture.child);
    const harness = await trackedManifold();
    const prototypeMethods = [
      { target: EvaluatedPartV7.prototype, key: "mesh" },
      { target: EvaluatedPartV7.prototype, key: "export" },
      {
        target: EvaluatedPartV7.prototype,
        key: "physicalMassProperties",
      },
      {
        target: EvaluatedPartV7.prototype,
        key: "billOfMaterials",
      },
      {
        target: EvaluatedPartDesignV7.prototype,
        key: "output",
      },
      {
        target: EvaluatedPartDesignV7.prototype,
        key: "dispose",
      },
      { target: EvaluatedBodySetV7.prototype, key: "body" },
      { target: EvaluatedBodySetV7.prototype, key: "mesh" },
      { target: EvaluatedBodySetV7.prototype, key: "export" },
      {
        target: EvaluatedLocalAssemblyV7.prototype,
        key: "mesh",
      },
      {
        target: EvaluatedLocalAssemblyV7.prototype,
        key: "export",
      },
      {
        target: EvaluatedLocalAssemblyV7.prototype,
        key: "physicalMassProperties",
      },
      {
        target: EvaluatedLocalAssemblyV7.prototype,
        key: "billOfMaterials",
      },
      {
        target: EvaluatedLocalAssemblyDesignV7.prototype,
        key: "output",
      },
      {
        target: EvaluatedLocalAssemblyDesignV7.prototype,
        key: "dispose",
      },
    ] as const;
    const methodDescriptors = prototypeMethods.map((method) => ({
      ...method,
      descriptor: Object.getOwnPropertyDescriptor(
        method.target,
        method.key,
      ),
    }));
    const boxDescriptor = Object.getOwnPropertyDescriptor(
      harness.kernel,
      "box",
    );
    if (
      methodDescriptors.some(
        (method) =>
          method.descriptor === undefined ||
          typeof method.descriptor.value !== "function",
      ) ||
      boxDescriptor === undefined ||
      typeof boxDescriptor.value !== "function"
    ) {
      harness.disposeBase();
      throw new Error(
        "Product prototype regression requires data methods",
      );
    }
    const restorePrototypes = (): void => {
      for (const method of methodDescriptors) {
        Object.defineProperty(
          method.target,
          method.key,
          method.descriptor!,
        );
      }
    };
    const intrinsicBox = boxDescriptor.value as NonNullable<
      GeometryKernel["box"]
    >;
    let hostileDispatches = 0;
    Object.defineProperty(harness.kernel, "box", {
      ...boxDescriptor,
      value: (
        ...arguments_: Parameters<
          NonNullable<GeometryKernel["box"]>
        >
      ): KernelShape => {
        const shape = intrinsicBox(...arguments_);
        for (const method of methodDescriptors) {
          Object.defineProperty(
            method.target,
            method.key,
            {
              ...method.descriptor!,
              value: (): never => {
                hostileDispatches += 1;
                throw Symbol(
                  `hostile product method dispatch: ${method.key}`,
                );
              },
            },
          );
        }
        return shape;
      },
    });

    let result:
      | Awaited<
          ReturnType<typeof evaluateProductAssemblyOutputsV7>
        >
      | undefined;
    try {
      result = await evaluateProductAssemblyOutputsV7(
        harness.kernel,
        fixture.document,
        { resolver: resolved.resolver },
      );
      expect(
        result?.ok,
        JSON.stringify(result?.diagnostics),
      ).toBe(true);
      if (result?.ok !== true) return;
      const product = result.value.output("product");
      const occurrence = product.occurrences[0]!;
      expect(occurrence.part.geometry.kind).toBe("bodySet");
      if (occurrence.part.geometry.kind !== "bodySet") return;
      const bodySet = occurrence.part.geometry.bodySet;
      expect(bodySet.body("first-body").node).toBe(
        "first-body-solid",
      );
      expect(bodySet.mesh().indices.length).toBeGreaterThan(0);
      expect(bodySet.export("stl")).toBeInstanceOf(Uint8Array);
      expect(product.mesh().indices.length).toBeGreaterThan(0);
      expect(product.export("stl")).toBeInstanceOf(Uint8Array);
      const physical = product.physicalMassProperties();
      expect(physical.ok).toBe(true);
      const bom = product.billOfMaterials();
      expect(bom.ok).toBe(true);
      let thrown: unknown;
      try {
        (
          occurrence.part.export as unknown as (
            format: "step",
          ) => unknown
        )("step");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CadError);
      expect((thrown as CadError).diagnostics[0]).toMatchObject({
        code: "EXPORT_UNSUPPORTED",
        details: {
          output: "module",
          outputKind: "assembly",
          childPartNode: "body-set-leaf",
          format: "step",
        },
      });
      expect(hostileDispatches).toBe(0);
      result.value.dispose();
      result.value.dispose();
      expect(harness.disposedShapes).toHaveLength(2);
      expect(harness.liveShapes.size).toBe(0);
      expect(harness.disposeKernel).not.toHaveBeenCalled();
    } finally {
      restorePrototypes();
      if (result?.ok === true) {
        result.value.dispose();
      }
      for (const shape of [...harness.liveShapes]) {
        harness.kernel.disposeShape(shape);
      }
      harness.disposeBase();
    }
  });
});
