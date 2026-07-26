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
import {
  stagedBodySetDesignV7,
} from "../src/internal/document-v7-body-set-authoring.js";
import {
  evaluateProductAssemblyOutputsV7,
} from "../src/internal/document-v7-local-assembly-evaluation.js";

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

async function externalChildDocument(
  step: Uint8Array,
): Promise<{
  readonly bytes: Uint8Array;
  readonly digest: ResourceDigestIR;
}> {
  const stepDigest = await digestBytes(step);
  const cad = stagedBodySetDesignV7("occt-external-child");
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
  const part = cad.part("supplier-part", cut, {
    partNumber: "SUPPLIER-STEP-001",
    description: "Imported and machined supplier part",
    massDensity: kgPerCubicMillimeter(1e-6),
  });
  cad.output("mainPart", part);
  const document = cad.build();
  const bytes = encoder.encode(stringifyDocumentV7(document));
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
  const cad = stagedBodySetDesignV7("occt-external-product");
  const documentResource = cad.resource("supplierDocument", {
    digest: child.digest,
    byteLength: child.bytes.byteLength,
    mediaType: DOCUMENT_MEDIA_TYPE,
    locations: ["project://supplier/part.invariantcad"],
  });
  const supplierPart = cad.externalPart(
    documentResource,
    "mainPart",
  );
  const product = cad.assembly("product", (instances) => {
    instances.instance("left", supplierPart, {
      configuration: { mode: "base" },
    });
    instances.instance("right", supplierPart, {
      configuration: { mode: "base" },
      placement: [tf.translate([mm(30), mm(0), mm(0)])],
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

describe("stock OCCT external-part product acceptance", () => {
  it("retains exact child geometry while aggregate product exchange stays mesh-only", async () => {
    const child = await externalChildDocument(stepFixture);
    const document = productDocument(child);
    const requests: ResourceResolverRequestV7[] = [];
    const resolver: ResourceResolverV7 = vi.fn(
      (request: ResourceResolverRequestV7): Uint8Array => {
        requests.push(request);
        const key = requestKey(request);
        if (key === "root:supplierDocument") {
          return child.bytes;
        }
        if (key === "external:supplierDocument:supplierStep") {
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
    let retainedPart: EvaluatedPartV7 | undefined;
    try {
      const result = await evaluateProductAssemblyOutputsV7(
        kernel,
        document,
        {
          outputs: ["product"],
          resolver,
        },
      );
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (!result.ok) return;
      const product = result.value.output("product");
      retainedPart = product.occurrences[0]!.part;
      try {
        expect(product.occurrences.map(({ id }) => id)).toEqual([
          "left",
          "right",
        ]);
        expect(product.occurrences[0]!.part).toBe(
          product.occurrences[1]!.part,
        );
        expect(
          product.occurrences.map(
            ({ transform }) => transform[12],
          ),
        ).toEqual([0, 30]);
        expect(requests.map(requestKey)).toEqual([
          "root:supplierDocument",
          "external:supplierDocument:supplierStep",
        ]);
        expect(resolver).toHaveBeenCalledTimes(2);
        expect(requests[1]?.documentScope).toEqual({
          source: "external",
          resource: "supplierDocument" as ResourceId,
          digest: child.digest,
        });

        const part = product.occurrences[0]!.part;
        expect(part).toMatchObject({
          representation: "brep",
          exact: true,
          partNumber: "SUPPLIER-STEP-001",
        });
        expect(part.geometry.kind).toBe("solid");
        if (part.geometry.kind !== "solid") return;
        expect(part.geometry.solid.measure().volume).toBeCloseTo(
          1_104,
          6,
        );
        const topology = part.geometry.solid.topology();
        expect(topology).toMatchObject({
          ok: true,
          value: { history: "partial" },
        });
        if (topology.ok) {
          expect(topology.value.faces.length).toBeGreaterThan(6);
          expect(topology.value.edges.length).toBeGreaterThan(12);
          expect(topology.value.vertices.length).toBeGreaterThan(8);
        }
        const exactStep = part.geometry.solid.export("step");
        expect(exactStep).toBeInstanceOf(Uint8Array);
        expect(exactStep.byteLength).toBeGreaterThan(100);

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
      expect(() => retainedPart?.mesh()).toThrow(/disposed/i);

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
