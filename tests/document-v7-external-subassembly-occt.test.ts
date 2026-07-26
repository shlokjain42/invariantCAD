import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  OcctKernel as RawOcctKernel,
  type ShapeHandle,
} from "occt-wasm";
import type { ResourceId } from "../src/core/ids.js";
import { CadError } from "../src/core/result.js";
import { tf } from "../src/design.js";
import {
  kgPerCubicMillimeter,
  mm,
} from "../src/expressions.js";
import type { EvaluatedPartV7 } from "../src/evaluator.js";
import type {
  DesignDocumentV7,
  ResourceDigestIR,
} from "../src/ir.js";
import type { GeometryKernel } from "../src/kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import type {
  ResourceResolverRequestV7,
  ResourceResolverV7,
} from "../src/resource-resolution.js";
import { stringifyDocumentV7 } from "../src/serialization.js";
import { stagedBodySetDesignV7 } from "../src/internal/document-v7-body-set-authoring.js";
import { evaluateProductAssemblyOutputsV7 } from "../src/internal/document-v7-local-assembly-evaluation.js";

const DOCUMENT_MEDIA_TYPE =
  "application/vnd.invariantcad.document+json";
const encoder = new TextEncoder();
let stepFixture = new Uint8Array();

async function digestBytes(
  bytes: Uint8Array,
): Promise<ResourceDigestIR> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function externalChildModule(
  step: Uint8Array,
): Promise<{
  readonly bytes: Uint8Array;
  readonly digest: ResourceDigestIR;
}> {
  const stepDigest = await digestBytes(step);
  const cad = stagedBodySetDesignV7("occt-external-module");
  const stepResource = cad.resource("supplierStep", {
    digest: stepDigest,
    byteLength: step.byteLength,
    mediaType: "model/step",
    locations: ["project://supplier/source.step"],
  });
  const imported = cad.importedBody(
    "imported-source",
    stepResource,
    {
      format: "step",
      units: { mode: "from-file" },
    },
  );
  const positionedImport = cad.translate(
    "positioned-import",
    imported,
    [mm(1), mm(0), mm(0)],
  );
  const tool = cad.box("cutting-tool", {
    size: [mm(4), mm(4), mm(8)],
  });
  const positionedTool = cad.translate(
    "positioned-tool",
    tool,
    [mm(5), mm(3), mm(-1)],
  );
  const cut = cad.subtract(
    "machined-solid",
    positionedImport,
    [positionedTool],
  );
  const machinedPart = cad.part("machined-part", cut, {
    partNumber: "SUPPLIER-STEP-001",
    description: "Imported and machined supplier part",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const nativeSolid = cad.box("native-solid", {
    size: [mm(5), mm(4), mm(3)],
  });
  const nativePart = cad.part("native-part", nativeSolid, {
    partNumber: "NATIVE-BRACKET-001",
    description: "Native child-module bracket",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  const core = cad.assembly("core", (instances) => {
    instances.instance("machined-leaf", machinedPart, {
      placement: [tf.translate([mm(2), mm(0), mm(0)])],
    });
    instances.instance("native-leaf", nativePart, {
      placement: [tf.translate([mm(0), mm(15), mm(0)])],
    });
  });
  const module = cad.assembly("module", (instances) => {
    instances.instance("core-instance", core, {
      placement: [tf.translate([mm(5), mm(0), mm(0)])],
    });
  });
  cad.output("module", module);
  const bytes = encoder.encode(stringifyDocumentV7(cad.build()));
  return {
    bytes,
    digest: await digestBytes(bytes),
  };
}

function productDocument(
  child: {
    readonly bytes: Uint8Array;
    readonly digest: ResourceDigestIR;
  },
): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7(
    "occt-external-subassembly-product",
  );
  const documentResource = cad.resource("moduleDocument", {
    digest: child.digest,
    byteLength: child.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
    locations: ["project://supplier/module.invariantcad"],
  });
  const module = cad.externalAssembly(
    documentResource,
    "module",
  );
  const product = cad.assembly("product", (instances) => {
    instances.instance("left-module", module, {
      configuration: { mode: "base" },
    });
    instances.instance("right-module", module, {
      configuration: { mode: "base" },
      placement: [
        tf.translate([mm(40), mm(20), mm(0)]),
      ],
    });
  });
  cad.output("product", product);
  return cad.build();
}

function requestKey(
  request: ResourceResolverRequestV7,
): string {
  const scope = request.documentScope;
  if (scope?.source === "root") {
    return `root:${request.id}`;
  }
  if (scope?.source === "external") {
    return `external:${scope.resource}:${request.id}`;
  }
  return `unscoped:${request.id}`;
}

beforeAll(async () => {
  const raw = await RawOcctKernel.init();
  let shape: ShapeHandle | undefined;
  try {
    shape = raw.makeBox(20, 10, 6);
    stepFixture = encoder.encode(raw.exportStep(shape));
  } finally {
    if (shape !== undefined) raw.release(shape);
    raw[Symbol.dispose]();
  }
}, 30_000);

afterAll(() => {
  stepFixture = new Uint8Array();
});

describe("stock OCCT external-subassembly acceptance", () => {
  it("preserves exact reusable leaves while aggregate product exchange stays mesh-only", async () => {
    const child = await externalChildModule(stepFixture);
    const document = productDocument(child);
    const requests: ResourceResolverRequestV7[] = [];
    const resolver: ResourceResolverV7 = vi.fn(
      (request: ResourceResolverRequestV7): Uint8Array => {
        requests.push(request);
        const key = requestKey(request);
        if (key === "root:moduleDocument") {
          return child.bytes;
        }
        if (
          key ===
          "external:moduleDocument:supplierStep"
        ) {
          return stepFixture;
        }
        throw new Error(`Unexpected resource request '${key}'`);
      },
    );
    const kernel = await createOcctKernel();
    const liveShapes = (
      kernel as GeometryKernel & {
        readonly liveShapes: ReadonlySet<unknown>;
      }
    ).liveShapes;
    const liveBefore = liveShapes.size;
    let retainedMachinedPart: EvaluatedPartV7 | undefined;
    let retainedNativePart: EvaluatedPartV7 | undefined;
    try {
      const result = await evaluateProductAssemblyOutputsV7(
        kernel,
        document,
        {
          outputs: ["product"],
          resolver,
        },
      );
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(
        true,
      );
      if (!result.ok) return;
      const product = result.value.output("product");
      retainedMachinedPart = product.occurrences[0]!.part;
      retainedNativePart = product.occurrences[1]!.part;
      try {
        expect(
          product.occurrences.map((occurrence) => ({
            path: occurrence.path,
            partNode: occurrence.partNode,
            output:
              occurrence.component.source === "external"
                ? occurrence.component.output
                : undefined,
            outputKind:
              occurrence.component.source === "external"
                ? occurrence.component.outputKind
                : undefined,
            translation: [
              occurrence.transform[12],
              occurrence.transform[13],
              occurrence.transform[14],
            ],
          })),
        ).toEqual([
          {
            path: [
              "left-module",
              "core-instance",
              "machined-leaf",
            ],
            partNode: "machined-part",
            output: "module",
            outputKind: "assembly",
            translation: [7, 0, 0],
          },
          {
            path: [
              "left-module",
              "core-instance",
              "native-leaf",
            ],
            partNode: "native-part",
            output: "module",
            outputKind: "assembly",
            translation: [5, 15, 0],
          },
          {
            path: [
              "right-module",
              "core-instance",
              "machined-leaf",
            ],
            partNode: "machined-part",
            output: "module",
            outputKind: "assembly",
            translation: [47, 20, 0],
          },
          {
            path: [
              "right-module",
              "core-instance",
              "native-leaf",
            ],
            partNode: "native-part",
            output: "module",
            outputKind: "assembly",
            translation: [45, 35, 0],
          },
        ]);
        expect(product.occurrences[0]!.part).toBe(
          product.occurrences[2]!.part,
        );
        expect(product.occurrences[1]!.part).toBe(
          product.occurrences[3]!.part,
        );
        expect(product.occurrences[0]!.part).not.toBe(
          product.occurrences[1]!.part,
        );

        expect(requests.map(requestKey)).toEqual([
          "root:moduleDocument",
          "external:moduleDocument:supplierStep",
        ]);
        expect(resolver).toHaveBeenCalledTimes(2);
        expect(requests[1]?.documentScope).toEqual({
          source: "external",
          resource: "moduleDocument" as ResourceId,
          digest: child.digest,
        });

        const machined = product.occurrences[0]!.part;
        expect(machined).toMatchObject({
          representation: "brep",
          exact: true,
          partNumber: "SUPPLIER-STEP-001",
        });
        expect(machined.geometry.kind).toBe("solid");
        if (machined.geometry.kind !== "solid") return;
        expect(
          machined.geometry.solid.measure().volume,
        ).toBeCloseTo(1_104, 6);
        const machinedTopology =
          machined.geometry.solid.topology();
        expect(machinedTopology).toMatchObject({
          ok: true,
          value: { history: "partial" },
        });
        if (machinedTopology.ok) {
          expect(
            machinedTopology.value.faces.length,
          ).toBeGreaterThan(6);
          expect(
            machinedTopology.value.edges.length,
          ).toBeGreaterThan(12);
          expect(
            machinedTopology.value.vertices.length,
          ).toBeGreaterThan(8);
        }
        const machinedStep =
          machined.geometry.solid.export("step");
        expect(machinedStep).toBeInstanceOf(Uint8Array);
        expect(machinedStep.byteLength).toBeGreaterThan(100);

        const native = product.occurrences[1]!.part;
        expect(native).toMatchObject({
          representation: "brep",
          exact: true,
          partNumber: "NATIVE-BRACKET-001",
        });
        expect(native.geometry.kind).toBe("solid");
        if (native.geometry.kind !== "solid") return;
        expect(
          native.geometry.solid.measure().volume,
        ).toBeCloseTo(60, 6);
        const nativeTopology = native.geometry.solid.topology();
        expect(nativeTopology.ok).toBe(true);
        if (nativeTopology.ok) {
          expect(nativeTopology.value.faces).toHaveLength(6);
          expect(nativeTopology.value.edges).toHaveLength(12);
          expect(nativeTopology.value.vertices).toHaveLength(8);
        }
        const nativeStep = native.geometry.solid.export("step");
        expect(nativeStep).toBeInstanceOf(Uint8Array);
        expect(nativeStep.byteLength).toBeGreaterThan(100);

        const aggregateMesh = product.mesh();
        expect(aggregateMesh.indices.length).toBeGreaterThan(0);
        expect(aggregateMesh.positions.length).toBeGreaterThan(0);
        const aggregateStl = product.export("stl");
        expect(aggregateStl).toBeInstanceOf(Uint8Array);
        expect(aggregateStl.byteLength).toBeGreaterThan(84);

        let exactAggregateError: unknown;
        try {
          (
            product.export as unknown as (
              format: "step",
            ) => Uint8Array
          )("step");
        } catch (error) {
          exactAggregateError = error;
        }
        expect(exactAggregateError).toBeInstanceOf(CadError);
        expect(
          (exactAggregateError as CadError).diagnostics[0],
        ).toMatchObject({
          code: "EXPORT_UNSUPPORTED",
          details: {
            output: "product",
            format: "step",
          },
        });
      } finally {
        result.value.dispose();
        expect(liveShapes.size).toBe(liveBefore);
        result.value.dispose();
        expect(liveShapes.size).toBe(liveBefore);
      }
      expect(() => retainedMachinedPart?.mesh()).toThrow(
        /disposed/i,
      );
      expect(() => retainedNativePart?.mesh()).toThrow(
        /disposed/i,
      );

      const borrowedProbe = kernel.box!(
        [1, 1, 1],
        false,
        { feature: "borrowed-kernel-probe" },
      );
      try {
        expect(kernel.status(borrowedProbe)).toEqual({
          ok: true,
          code: "VALID",
        });
      } finally {
        kernel.disposeShape(borrowedProbe);
      }
      expect(liveShapes.size).toBe(liveBefore);
    } finally {
      kernel.dispose();
    }
  }, 30_000);
});
