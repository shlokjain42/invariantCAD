import { describe, expect, it, vi } from "vitest";
import { mm } from "../src/expressions.js";
import type { DesignDocumentV7, ResourceDigestIR } from "../src/ir.js";
import type {
  GeometryKernel,
  KernelShape,
} from "../src/kernel.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";
import { stringifyDocumentV7 } from "../src/serialization.js";
import { stagedBodySetDesignV7 } from "../src/internal/document-v7-body-set-authoring.js";
import { evaluateProductAssemblyOutputsV7 } from "../src/internal/document-v7-local-assembly-evaluation.js";

const DOCUMENT_MEDIA_TYPE =
  "application/vnd.invariantcad.document+json";
const encoder = new TextEncoder();

async function commitDocument(document: DesignDocumentV7): Promise<{
  readonly bytes: Uint8Array;
  readonly digest: ResourceDigestIR;
}> {
  const bytes = encoder.encode(stringifyDocumentV7(document));
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice()),
  );
  const digest =
    `sha256:${[...hash]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}` as ResourceDigestIR;
  return { bytes, digest };
}

function onePartDocument(): DesignDocumentV7 {
  const cad = stagedBodySetDesignV7("external-diagnostic-child");
  const solid = cad.box("solid", {
    size: [mm(1), mm(1), mm(1)],
  });
  const part = cad.part("part", solid, { partNumber: "P" });
  cad.output("mainPart", part);
  return cad.build();
}

describe("Document v7 external-part diagnostic attribution", () => {
  it("attributes graph-node failures to the external output that reaches the node", async () => {
    const child = stagedBodySetDesignV7("two-output-child");
    const aSolid = child.box("a-solid", {
      size: [mm(1), mm(1), mm(1)],
    });
    const bSolid = child.box("b-solid", {
      size: [mm(2), mm(2), mm(2)],
    });
    const aPart = child.part("a-part", aSolid, {
      partNumber: "A",
    });
    const bPart = child.part("b-part", bSolid, {
      partNumber: "B",
    });
    child.output("aPart", aPart);
    child.output("bPart", bPart);
    const committed = await commitDocument(child.build());

    const root = stagedBodySetDesignV7("two-output-product");
    const resource = root.resource("childDocument", {
      digest: committed.digest,
      byteLength: committed.bytes.byteLength,
      mediaType: DOCUMENT_MEDIA_TYPE,
    });
    const externalA = root.externalPart(resource, "aPart");
    const externalB = root.externalPart(resource, "bPart");
    const assembly = root.assembly("product", (instances) => {
      instances.instance("first-a", externalA, {
        configuration: { mode: "base" },
      });
      instances.instance("second-b", externalB, {
        configuration: { mode: "base" },
      });
    });
    root.output("product", assembly);

    const base = await createManifoldKernel();
    let boxCall = 0;
    const kernel: GeometryKernel = {
      id: base.id,
      capabilities: base.capabilities,
      box(
        ...arguments_: Parameters<
          NonNullable<GeometryKernel["box"]>
        >
      ): KernelShape {
        if (boxCall === 1) {
          throw new Error("injected b-output failure");
        }
        boxCall += 1;
        return base.box!(...arguments_);
      },
      status: base.status.bind(base),
      measure: base.measure.bind(base),
      mesh: base.mesh.bind(base),
      disposeShape: base.disposeShape.bind(base),
      dispose() {},
    };

    try {
      const result = await evaluateProductAssemblyOutputsV7(
        kernel,
        root.build(),
        {
          outputs: ["product"],
          resolver: () => committed.bytes,
        },
      );
      expect(result.ok).toBe(false);
      if (result.ok) {
        result.value.dispose();
        return;
      }
      expect(result.diagnostics[0]).toMatchObject({
        code: "KERNEL_ERROR",
        node: "product",
        path: "/nodes/product/instances/1/component",
        details: {
          resource: "childDocument",
          componentResource: "childDocument",
          output: "bPart",
          childNode: "b-solid",
          childPath: "/nodes/b-solid",
          occurrencePath: ["second-b"],
        },
      });
    } finally {
      base.dispose();
    }
  });

  it("preserves aggregate resource-limit identity without blaming one component", async () => {
    const committed = await commitDocument(onePartDocument());
    const root = stagedBodySetDesignV7("resource-limit-product");
    const zDocument = root.resource("zDocument", {
      digest: committed.digest,
      byteLength: committed.bytes.byteLength,
      mediaType: DOCUMENT_MEDIA_TYPE,
    });
    const aDocument = root.resource("aDocument", {
      digest: committed.digest,
      byteLength: committed.bytes.byteLength,
      mediaType: DOCUMENT_MEDIA_TYPE,
    });
    const zPart = root.externalPart(zDocument, "mainPart");
    const aPart = root.externalPart(aDocument, "mainPart");
    const assembly = root.assembly("product", (instances) => {
      instances.instance("z-first", zPart, {
        configuration: { mode: "base" },
      });
      instances.instance("a-second", aPart, {
        configuration: { mode: "base" },
      });
    });
    root.output("product", assembly);

    const resolver = vi.fn(() => committed.bytes);
    const unreadKernel = new Proxy({} as GeometryKernel, {
      get() {
        throw new Error("Kernel must not be read before document preflight");
      },
    });
    const result = await evaluateProductAssemblyOutputsV7(
      unreadKernel,
      root.build(),
      {
        outputs: ["product"],
        resolver,
        resourceLimits: { maxResolvedResources: 1 },
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      result.value.dispose();
      return;
    }
    expect(resolver).not.toHaveBeenCalled();
    expect(result.diagnostics[0]).toMatchObject({
      code: "RESOURCE_LIMIT_EXCEEDED",
      details: {
        phase: "resourceResolution",
        resource: "maxResolvedResources",
        limit: 1,
        actual: 2,
      },
    });
    expect(result.diagnostics[0]!.node).toBeUndefined();
    expect(result.diagnostics[0]!.path).toBeUndefined();
    expect(result.diagnostics[0]!.details).not.toHaveProperty(
      "componentResource",
    );
    expect(result.diagnostics[0]!.details).not.toHaveProperty(
      "occurrencePath",
    );
    expect(result.diagnostics[0]!.details).not.toHaveProperty("output");
  });
});
