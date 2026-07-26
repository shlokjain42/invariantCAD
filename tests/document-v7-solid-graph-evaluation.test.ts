import { describe, expect, it } from "vitest";
import type { NodeId } from "../src/core/ids.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type DesignDocumentV7,
  type NodeIRV7,
} from "../src/ir.js";
import {
  planStagedSolidGraphV7,
  type StagedSolidGraphLimitsV7,
} from "../src/internal/document-v7-solid-graph-evaluation.js";

const length = (value: number) => ({
  op: "literal" as const,
  dimension: "length" as const,
  value,
});

const solid = (node: string) => ({
  node: node as NodeId,
  kind: "solid" as const,
});

const box = (): NodeIRV7 => ({
  kind: "box",
  size: [length(1), length(1), length(1)],
  center: false,
});

const sphere = (): NodeIRV7 => ({
  kind: "sphere",
  radius: length(1),
});

const translate = (input: string, operations = 1): NodeIRV7 => ({
  kind: "transform",
  input: solid(input),
  operations: Array.from({ length: operations }, (_, index) => ({
    kind: "translate" as const,
    value: [length(index + 1), length(0), length(0)],
  })),
});

function document(
  nodes: Readonly<Record<string, NodeIRV7>>,
): DesignDocumentV7 {
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "solid-graph-planner",
    units: { length: "mm", angle: "rad", mass: "kg" },
    parameters: {},
    nodes,
    outputs: {},
  } as unknown as DesignDocumentV7;
}

const generousLimits: StagedSolidGraphLimitsV7 = {
  maxDistinctSolids: 100,
  maxSolidGraphNodes: 100,
  maxSolidDependencyLinks: 100,
  maxTransformOperations: 100,
};

function branchingDocument(): DesignDocumentV7 {
  return document({
    target: box(),
    shared: sphere(),
    "tool-transform": translate("shared"),
    combined: {
      kind: "boolean",
      operation: "subtract",
      target: solid("target"),
      tools: [
        solid("shared"),
        solid("tool-transform"),
        solid("shared"),
      ],
    },
    root: translate("combined", 2),
  });
}

describe("staged solid graph planning", () => {
  it("orders Boolean target then authored tools before their parent while deduplicating shared nodes", () => {
    const result = planStagedSolidGraphV7(
      branchingDocument(),
      [{ node: "root" as NodeId, path: "/outputs/product" }],
      generousLimits,
      "test-solid-graph",
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;

    expect(
      result.value.orderedNodes.map(([node]) => node),
    ).toEqual([
      "target",
      "shared",
      "tool-transform",
      "combined",
      "root",
    ]);
    expect(result.value.leafNodes.map(([node]) => node)).toEqual([
      "target",
      "shared",
    ]);
    expect(result.value).toMatchObject({
      graphNodeCount: 5,
      dependencyLinkCount: 6,
      transformOperationCount: 3,
    });
    const combined = result.value.orderedNodes.find(
      ([node]) => node === "combined",
    )?.[1];
    expect(combined?.kind).toBe("boolean");
    if (combined?.kind === "boolean") {
      expect(combined.target.node).toBe("target");
      expect(combined.tools.map((tool) => tool.node)).toEqual([
        "shared",
        "tool-transform",
        "shared",
      ]);
    }
  });

  it("counts every authored Boolean operand edge including repeated references", () => {
    const repeated = document({
      leaf: box(),
      repeated: {
        kind: "boolean",
        operation: "union",
        target: solid("leaf"),
        tools: [solid("leaf"), solid("leaf"), solid("leaf")],
      },
    });
    const limited = planStagedSolidGraphV7(
      repeated,
      [{ node: "repeated" as NodeId, path: "/outputs/repeated" }],
      { ...generousLimits, maxSolidDependencyLinks: 3 },
      "test-solid-graph",
    );
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.diagnostics[0]).toMatchObject({
        code: "RESOURCE_LIMIT_EXCEEDED",
        path: "/nodes/repeated/tools/2",
        details: {
          phase: "test-solid-graph",
          resource: "maxSolidDependencyLinks",
          limit: 3,
          actual: 4,
        },
      });
    }

    const exact = planStagedSolidGraphV7(
      repeated,
      [{ node: "repeated" as NodeId, path: "/outputs/repeated" }],
      {
        ...generousLimits,
        maxSolidGraphNodes: 2,
        maxSolidDependencyLinks: 4,
        maxDistinctSolids: 1,
      },
      "test-solid-graph",
    );
    expect(exact.ok, JSON.stringify(exact.diagnostics)).toBe(true);
    if (exact.ok) {
      expect(exact.value.orderedNodes.map(([node]) => node)).toEqual([
        "leaf",
        "repeated",
      ]);
      expect(exact.value).toMatchObject({
        graphNodeCount: 2,
        dependencyLinkCount: 4,
        transformOperationCount: 0,
      });
    }
  });

  it("preserves exact graph, leaf, and transform-operation ceilings for branching DAGs", () => {
    const cases: readonly {
      readonly resource: keyof StagedSolidGraphLimitsV7;
      readonly limit: number;
      readonly actual: number;
    }[] = [
      {
        resource: "maxSolidGraphNodes",
        limit: 4,
        actual: 5,
      },
      {
        resource: "maxDistinctSolids",
        limit: 1,
        actual: 2,
      },
      {
        resource: "maxTransformOperations",
        limit: 2,
        actual: 3,
      },
    ];
    for (const testCase of cases) {
      const result = planStagedSolidGraphV7(
        branchingDocument(),
        [{ node: "root" as NodeId, path: "/outputs/product" }],
        {
          ...generousLimits,
          [testCase.resource]: testCase.limit,
        },
        "test-solid-graph",
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
  });

  it("rejects indirect Boolean cycles with the authored operand path", () => {
    const cyclic = document({
      leaf: box(),
      first: {
        kind: "boolean",
        operation: "union",
        target: solid("leaf"),
        tools: [solid("second")],
      },
      second: {
        kind: "boolean",
        operation: "intersect",
        target: solid("leaf"),
        tools: [solid("first")],
      },
    });
    const result = planStagedSolidGraphV7(
      cyclic,
      [{ node: "first" as NodeId, path: "/outputs/cyclic" }],
      generousLimits,
      "test-solid-graph",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        node: "first",
        path: "/nodes/second/tools/0",
        details: { phase: "test-solid-graph" },
      });
    }
  });

  it("uses captured sorting, map, and own-property intrinsics", () => {
    const graph = branchingDocument();
    const roots = [
      { node: "root" as NodeId, path: "/outputs/z" },
      { node: "target" as NodeId, path: "/outputs/a" },
    ];
    const sortDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "sort",
    )!;
    const mapGetDescriptor = Object.getOwnPropertyDescriptor(
      Map.prototype,
      "get",
    )!;
    const mapSetDescriptor = Object.getOwnPropertyDescriptor(
      Map.prototype,
      "set",
    )!;
    const hasOwnDescriptor = Object.getOwnPropertyDescriptor(
      Object,
      "hasOwn",
    )!;
    let result: ReturnType<typeof planStagedSolidGraphV7>;
    try {
      Object.defineProperty(Array.prototype, "sort", {
        ...sortDescriptor,
        value: () => {
          throw new Error("ambient sort must not run");
        },
      });
      Object.defineProperty(Map.prototype, "get", {
        ...mapGetDescriptor,
        value: () => {
          throw new Error("ambient map.get must not run");
        },
      });
      Object.defineProperty(Map.prototype, "set", {
        ...mapSetDescriptor,
        value: () => {
          throw new Error("ambient map.set must not run");
        },
      });
      Object.defineProperty(Object, "hasOwn", {
        ...hasOwnDescriptor,
        value: () => {
          throw new Error("ambient Object.hasOwn must not run");
        },
      });
      result = planStagedSolidGraphV7(
        graph,
        roots,
        generousLimits,
        "test-solid-graph",
      );
    } finally {
      Object.defineProperty(Array.prototype, "sort", sortDescriptor);
      Object.defineProperty(Map.prototype, "get", mapGetDescriptor);
      Object.defineProperty(Map.prototype, "set", mapSetDescriptor);
      Object.defineProperty(Object, "hasOwn", hasOwnDescriptor);
    }
    expect(result!.ok, JSON.stringify(result!.diagnostics)).toBe(true);
  });
});
