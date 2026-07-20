import { describe, expect, it } from "vitest";
import {
  OFFSET_DIRECTIONS,
  OFFSET_JOIN_SEMANTICS,
  cloneDocument,
  createEvaluator,
  createManifoldKernel,
  deg,
  design,
  hashDocument,
  mm,
  nodeDependencies,
  outputKindForNode,
  parseDocumentValue,
  stringifyDocument,
  validateDocument,
  vec3,
  type GeometryKernel,
} from "../src/index.js";

describe("whole-solid offsets", () => {
  it("materializes the complete current contract in canonical IR", async () => {
    expect(Object.isFrozen(OFFSET_DIRECTIONS)).toBe(true);
    expect(OFFSET_DIRECTIONS).toEqual(["inward", "outward"]);
    expect(OFFSET_JOIN_SEMANTICS).toBe("round");

    const cad = design("offset-box");
    const box = cad.box("box", {
      size: vec3(mm(10), mm(20), mm(30)),
    });
    const expanded = cad.offset("expanded", box, { distance: mm(2) });
    cad.output("expanded", expanded);
    const document = cad.build();

    expect(document.nodes[expanded.node]).toEqual({
      kind: "offset",
      input: { node: "box", kind: "solid" },
      distance: { op: "literal", dimension: "length", value: 2 },
      direction: "outward",
      tolerance: {
        op: "literal",
        dimension: "length",
        value: 1e-6,
      },
    });
    expect(nodeDependencies(document.nodes[expanded.node]!)).toEqual([
      { node: "box", kind: "solid" },
    ]);
    expect(outputKindForNode(document.nodes[expanded.node]!)).toBe("solid");
    expect(await hashDocument(document)).toBe(
      "4eb4bec26f5e85d70e6246ca61fdac5dce5a45d6ed6c98e86c1c4d4f13b1244d",
    );
    expect(cloneDocument(document)).toEqual(document);
    expect(parseDocumentValue(JSON.parse(stringifyDocument(document))).ok).toBe(
      true,
    );

    const inward = design("inward-offset");
    const inwardBox = inward.box("box", {
      size: vec3(mm(10), mm(20), mm(30)),
    });
    const shrunk = inward.offset("shrunk", inwardBox, {
      distance: mm(1),
      direction: "inward",
      tolerance: mm(1e-5),
    });
    expect(inward.build().nodes[shrunk.node]).toEqual(
      expect.objectContaining({
        direction: "inward",
        tolerance: {
          op: "literal",
          dimension: "length",
          value: 1e-5,
        },
      }),
    );
  });

  it("rejects malformed, dimensionally invalid, and foreign offset inputs", () => {
    const cad = design("offset-validation");
    const box = cad.box("box", {
      size: vec3(mm(10), mm(20), mm(30)),
    });
    const expanded = cad.offset("expanded", box, { distance: mm(1) });
    cad.output("expanded", expanded);
    const serialized = stringifyDocument(cad.build());

    for (const field of ["distance", "direction", "tolerance"] as const) {
      const missing = JSON.parse(serialized) as any;
      delete missing.nodes.expanded[field];
      expect(parseDocumentValue(missing).diagnostics).toContainEqual(
        expect.objectContaining({ code: "IR_INVALID" }),
      );
    }

    const unknown = JSON.parse(serialized) as any;
    unknown.nodes.expanded.join = "intersection";
    expect(parseDocumentValue(unknown).diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID" }),
    );

    const wrongInputKind = JSON.parse(serialized) as any;
    wrongInputKind.nodes.expanded.input.kind = "profile";
    expect(parseDocumentValue(wrongInputKind).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        path: "/nodes/expanded/input",
      }),
    );

    for (const field of ["distance", "tolerance"] as const) {
      const scalar = JSON.parse(serialized) as any;
      scalar.nodes.expanded[field].dimension = "scalar";
      expect(parseDocumentValue(scalar).diagnostics).toContainEqual(
        expect.objectContaining({
          code: "EXPRESSION_DIMENSION_MISMATCH",
          path: `/nodes/expanded/${field}`,
        }),
      );
    }

    const invalidDirection = JSON.parse(serialized) as any;
    invalidDirection.nodes.expanded.direction = "sideways";
    expect(parseDocumentValue(invalidDirection).diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID" }),
    );
    expect(validateDocument(invalidDirection).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IR_INVALID",
        node: "expanded",
        path: "/nodes/expanded/direction",
      }),
    );
    expect(() =>
      cad.offset("invalid-direction", box, {
        distance: mm(1),
        direction: "sideways" as any,
      }),
    ).toThrow("'outward' or 'inward'");

    const otherCad = design("other");
    const foreign = otherCad.box("foreign", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    expect(() =>
      cad.offset("foreign", foreign, { distance: mm(1) }),
    ).toThrow("cross design boundaries");

    // @ts-expect-error Offset distance must be a length expression.
    cad.offset("angle-distance", box, { distance: deg(45) });
    cad.offset("angle-tolerance", box, {
      distance: mm(1),
      // @ts-expect-error Offset tolerance must be a length expression.
      tolerance: deg(1),
    });
  });

  it("reports missing and malformed kernel capabilities before invocation", async () => {
    const cad = design("unsupported-offset");
    const box = cad.box("box", {
      size: vec3(mm(10), mm(10), mm(10)),
    });
    cad.output("expanded", cad.offset("expanded", box, { distance: mm(1) }));
    const document = cad.build();

    const unsupported = await createEvaluator();
    try {
      const result = await unsupported.evaluate(document);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "expanded",
          path: "/nodes/expanded",
          details: expect.objectContaining({ capability: "offset" }),
        }),
      );
    } finally {
      unsupported.dispose();
    }

    const delegate = await createManifoldKernel();
    const malformed = new Proxy(delegate, {
      get(target, property) {
        if (property === "id") return "malformed-offset";
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            features: [...target.capabilities.features, "offset"],
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GeometryKernel;
    const evaluator = await createEvaluator({ kernel: malformed });
    try {
      const result = await evaluator.evaluate(document);
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "expanded",
          details: expect.objectContaining({
            capability: "offset",
            protocolViolation: true,
          }),
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects non-positive and over-large tolerances before the kernel call", async () => {
    const delegate = await createManifoldKernel();
    let invoked = false;
    const guarded = new Proxy(delegate, {
      get(target, property) {
        if (property === "id") return "guarded-offset";
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            features: [...target.capabilities.features, "offset"],
          };
        }
        if (property === "offset") {
          return () => {
            invoked = true;
            throw new Error("Invalid offset reached the kernel");
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GeometryKernel;
    const evaluator = await createEvaluator({ kernel: guarded });
    try {
      for (const [distance, tolerance, path] of [
        [0, 1e-6, "/nodes/offset/distance"],
        [-1, 1e-6, "/nodes/offset/distance"],
        [1, 0, "/nodes/offset/tolerance"],
        [1, -1, "/nodes/offset/tolerance"],
        [1, 1, "/nodes/offset/tolerance"],
        [1, 2, "/nodes/offset/tolerance"],
      ] as const) {
        const cad = design(`invalid-offset-${distance}-${tolerance}`);
        const box = cad.box("box", {
          size: vec3(mm(10), mm(10), mm(10)),
        });
        cad.output(
          "offset",
          cad.offset("offset", box, {
            distance: mm(distance),
            tolerance: mm(tolerance),
          }),
        );
        const result = await evaluator.evaluate(cad.build());
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({ code: "FEATURE_INVALID", path }),
        );
      }
      expect(invoked).toBe(false);
    } finally {
      evaluator.dispose();
    }
  });
});
