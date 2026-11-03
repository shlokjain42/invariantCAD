import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kernelCapabilityDiagnostic } from "../src/evaluator.js";
import type {
  GeometryKernel,
  KernelCapabilities,
  NodeId,
} from "../src/index.js";
import { createManifoldKernel } from "../src/manifold-kernel.js";

let manifold: GeometryKernel;

const node = (id: string): NodeId => id as NodeId;

beforeAll(async () => {
  manifold = await createManifoldKernel();
});

afterAll(() => {
  manifold.dispose();
});

/** A kernel view that overrides capabilities and selected methods. */
function kernelWith(
  capabilities: Partial<KernelCapabilities>,
  methods: Partial<Record<keyof GeometryKernel, unknown>>,
): GeometryKernel {
  return new Proxy(manifold, {
    get(target, property, receiver) {
      if (property === "capabilities") {
        return { ...target.capabilities, ...capabilities };
      }
      if (Object.hasOwn(methods, property)) {
        return methods[property as keyof GeometryKernel];
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

describe("evaluator kernel capability checks", () => {
  it("accepts a declared native import implemented by importShape", () => {
    const kernel = kernelWith(
      { nativeImports: ["step"] },
      { importShape: () => undefined },
    );
    expect(
      kernelCapabilityDiagnostic(
        kernel,
        "nativeImport",
        "step",
        node("imported"),
      ),
    ).toBeUndefined();
  });

  it("accepts a declared native export implemented by exportShape", () => {
    const kernel = kernelWith(
      { nativeExports: ["brep", "brep-binary"] },
      { exportShape: () => new Uint8Array() },
    );
    for (const format of ["brep", "brep-binary"] as const) {
      expect(
        kernelCapabilityDiagnostic(
          kernel,
          "nativeExport",
          format,
          node("exported"),
        ),
      ).toBeUndefined();
    }
  });

  it("reports a declared native exchange format without its method as a protocol violation", () => {
    const kernel = kernelWith(
      { nativeImports: ["step"], nativeExports: ["step"] },
      { importShape: undefined, exportShape: undefined },
    );
    for (const kind of ["nativeImport", "nativeExport"] as const) {
      expect(
        kernelCapabilityDiagnostic(kernel, kind, "step", node("node")),
      ).toEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "node",
          path: "/nodes/node",
          details: expect.objectContaining({
            kind,
            capability: "step",
            protocolViolation: true,
          }),
        }),
      );
    }
  });

  it("reports an undeclared native exchange format as a missing capability", () => {
    const kernel = kernelWith(
      { nativeImports: [], nativeExports: [] },
      {
        importShape: () => undefined,
        exportShape: () => new Uint8Array(),
      },
    );
    for (const kind of ["nativeImport", "nativeExport"] as const) {
      expect(
        kernelCapabilityDiagnostic(kernel, kind, "step", node("node")),
      ).toEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          details: expect.objectContaining({ kind, capability: "step" }),
        }),
      );
    }
  });

  it("keeps primitive and feature checks on the method of the same name", () => {
    expect(
      kernelCapabilityDiagnostic(manifold, "primitive", "box", node("box")),
    ).toBeUndefined();
    expect(
      kernelCapabilityDiagnostic(
        manifold,
        "feature",
        "boolean",
        node("union"),
      ),
    ).toBeUndefined();
    const missingBox = kernelWith({}, { box: undefined });
    expect(
      kernelCapabilityDiagnostic(missingBox, "primitive", "box", node("box")),
    ).toEqual(
      expect.objectContaining({
        code: "KERNEL_ERROR",
        details: expect.objectContaining({ protocolViolation: true }),
      }),
    );
    expect(
      kernelCapabilityDiagnostic(
        manifold,
        "feature",
        "fillet",
        node("rounded"),
      ),
    ).toEqual(expect.objectContaining({ code: "KERNEL_CAPABILITY_MISSING" }));
  });
});
