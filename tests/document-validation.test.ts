import { describe, expect, it } from "vitest";
import {
  DOCUMENT_SCHEMA_V6,
  NodeV1Schema,
  NodeV6Schema,
  createEvaluator,
  design,
  mm,
  parseDocument,
  parseDocumentValue,
  stringifyDocument,
  topology,
  validateDocument,
  vec3,
  type CadResult,
  type DesignDocument,
  type GeometryKernel,
} from "../src/index.js";

type MutableDocument = {
  schema: unknown;
  version: unknown;
  nodes: Record<string, Record<string, unknown>>;
  outputs: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

/** A v6 box with a fillet whose edge query names a semantic box role. */
function roleDocument(): MutableDocument {
  const cad = design("validation-probe");
  const base = cad.box("base", { size: vec3(mm(10), mm(10), mm(10)) });
  const edge = topology.edges
    .createdBy(base, { role: "box.edge.x-max-y-max" })
    .select();
  cad.output("rounded", cad.fillet("rounded", base, { edges: edge, radius: mm(1) }));
  return JSON.parse(stringifyDocument(cad.build())) as MutableDocument;
}

function asDocument(value: MutableDocument): DesignDocument {
  return value as unknown as DesignDocument;
}

function inertKernel(): GeometryKernel {
  return {
    id: "validation-probe",
    capabilities: {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: ["box"],
      features: ["fillet"],
      nativeImports: [],
      nativeExports: [],
    },
    box: () => {
      throw new Error("validation must fail before kernel work");
    },
    mesh: () => ({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    }),
    measure: () => {
      throw new Error("validation must fail before kernel work");
    },
    status: () => ({ ok: true, code: "VALID" }),
    disposeShape: () => undefined,
    dispose: () => undefined,
  };
}

function codesAndPaths(result: CadResult<unknown>): [string, string | undefined][] {
  return result.diagnostics.map((item) => [item.code, item.path]);
}

describe("semantic validation of malformed in-memory documents", () => {
  it("reports an unsupported schema/version identity alone instead of throwing", async () => {
    expect(validateDocument(asDocument(roleDocument())).ok).toBe(true);
    for (const version of [8, "6", undefined]) {
      const document = roleDocument();
      document.version = version;
      const result = validateDocument(asDocument(document));
      expect(result.ok, String(version)).toBe(false);
      expect(codesAndPaths(result)).toEqual([["IR_INVALID", "/"]]);
      expect(result.diagnostics[0]?.message).toBe(
        "Document schema and version must identify the same supported document grammar",
      );
    }
    const mismatched = roleDocument();
    mismatched.schema = "https://invariantcad.dev/schema/document/v5";
    expect(codesAndPaths(validateDocument(asDocument(mismatched)))).toEqual([
      ["IR_INVALID", "/"],
    ]);

    const evaluator = await createEvaluator({ kernel: inertKernel() });
    try {
      const document = roleDocument();
      document.version = 8;
      const result = await evaluator.evaluate(asDocument(document));
      expect(codesAndPaths(result)).toEqual([["IR_INVALID", "/"]]);
    } finally {
      evaluator.dispose();
    }
  });

  it("reports unknown and out-of-grammar node kinds as IR_INVALID", async () => {
    for (const kind of ["futureFeature", "importedBody", "datumPlane"]) {
      const document = roleDocument();
      document.nodes.extra = { kind };
      document.outputs.extra = { node: "extra", kind: "solid" };
      const result = validateDocument(asDocument(document));
      expect(result.ok, kind).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "IR_INVALID",
          node: "extra",
          path: "/nodes/extra/kind",
          message: `Node kind '${kind}' is not supported by document version 6`,
        }),
      );
      // The frozen structural parser already rejects the same value.
      expect(parseDocumentValue(document).ok, kind).toBe(false);
    }

    const cyclic = roleDocument();
    cyclic.nodes.extra = { kind: "futureFeature", input: { node: "extra" } };
    cyclic.nodes.rounded!.input = { node: "extra", kind: "solid" };
    expect(validateDocument(asDocument(cyclic)).ok).toBe(false);

    const evaluator = await createEvaluator({ kernel: inertKernel() });
    try {
      const document = roleDocument();
      document.nodes.extra = { kind: "futureFeature" };
      const result = await evaluator.evaluate(asDocument(document));
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "IR_INVALID",
          path: "/nodes/extra/kind",
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("keeps the v6 schema constant aligned with the probe document", () => {
    expect(roleDocument().schema).toBe(DOCUMENT_SCHEMA_V6);
  });
});

/**
 * A chain of `depth` transforms over one box, then a fillet whose edge
 * selection is an `or` of `queries` origin queries naming the box.
 */
function originQueryChain(depth: number, queries: number): MutableDocument {
  const literal = (value: number) => ({
    op: "literal",
    dimension: "length",
    value,
  });
  const nodes: Record<string, Record<string, unknown>> = {
    n0: {
      kind: "box",
      size: [literal(1), literal(1), literal(1)],
      center: false,
    },
  };
  for (let index = 1; index <= depth; index += 1) {
    nodes[`n${index}`] = {
      kind: "transform",
      input: { node: `n${index - 1}`, kind: "solid" },
      operations: [
        { kind: "translate", value: [literal(0), literal(0), literal(0)] },
      ],
    };
  }
  nodes.f = {
    kind: "fillet",
    input: { node: `n${depth}`, kind: "solid" },
    edges: {
      topology: "edge",
      query: {
        op: "or",
        queries: Array.from({ length: queries }, () => ({
          op: "origin",
          feature: "n0",
          relation: "created",
        })),
      },
      cardinality: { min: 1 },
    },
    radius: literal(0.1),
  };
  return {
    schema: DOCUMENT_SCHEMA_V6,
    version: 6,
    name: "origin-query-chain",
    units: { length: "mm", angle: "rad" },
    parameters: {},
    nodes,
    outputs: { out: { node: "f", kind: "solid" } },
  };
}

/** Counts node-record reads while validating a document. */
function nodeReadsDuringValidation(document: MutableDocument): {
  readonly ok: boolean;
  readonly reads: number;
} {
  let reads = 0;
  const nodes = new Proxy(document.nodes, {
    get(target, key, receiver) {
      if (typeof key === "string") reads += 1;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  const result = validateDocument(asDocument({ ...document, nodes }));
  return { ok: result.ok, reads };
}

describe("bounded topology-origin validation", () => {
  it("walks each consuming feature's ancestors once, not once per query", () => {
    const single = nodeReadsDuringValidation(originQueryChain(300, 1));
    const many = nodeReadsDuringValidation(originQueryChain(300, 300));
    expect(single.ok).toBe(true);
    expect(many.ok).toBe(true);
    // Each extra query reads only its own origin feature; it no longer walks
    // the 301-node chain again (previously about 90,000 more reads).
    expect(many.reads - single.reads).toBeLessThanOrEqual(2 * 299);
  });

  it("still rejects an origin that is not an ancestor of the input", () => {
    const document = originQueryChain(20, 3);
    document.nodes.side = {
      kind: "box",
      size: document.nodes.n0!.size,
      center: false,
    };
    const edges = document.nodes.f!.edges as {
      query: { queries: Record<string, unknown>[] };
    };
    edges.query.queries[1] = {
      op: "origin",
      feature: "side",
      relation: "created",
    };
    const result = validateDocument(asDocument(document));
    expect(codesAndPaths(result)).toEqual([
      ["TOPOLOGY_SELECTOR_INVALID", "/nodes/f/edges/query/queries/1/feature"],
    ]);
    // The input feature itself counts as its own ancestor.
    edges.query.queries[1] = {
      op: "origin",
      feature: "n20",
      relation: "created",
    };
    expect(validateDocument(asDocument(document)).ok).toBe(true);
  });
});

const lengthLiteral = (value: number, dimension = "length") => ({
  op: "literal",
  dimension,
  value,
});
const noMove = {
  kind: "translate",
  value: [lengthLiteral(0), lengthLiteral(0), lengthLiteral(0)],
};
const plainBox = {
  kind: "box",
  size: [lengthLiteral(1), lengthLiteral(1), lengthLiteral(1)],
  center: false,
};

function v6Json(fields: Record<string, unknown>): string {
  return JSON.stringify({
    schema: DOCUMENT_SCHEMA_V6,
    version: 6,
    name: "pointer-probe",
    units: { length: "mm", angle: "rad" },
    parameters: {},
    ...fields,
  });
}

/** Resolves an RFC 6901 JSON Pointer, or returns undefined when absent. */
function resolvePointer(root: unknown, pointer: string): unknown {
  if (pointer === "") return root;
  expect(pointer.startsWith("/")).toBe(true);
  let current: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function expectPointerDiagnostic(
  text: string,
  code: string,
  path: string,
): void {
  const result = parseDocument(text);
  expect(result.ok).toBe(false);
  expect(codesAndPaths(result)).toContainEqual([code, path]);
  expect(resolvePointer(JSON.parse(text), path)).toBeDefined();
}

describe("diagnostic JSON Pointers for IDs containing '/' and '~'", () => {
  it("escapes node, parameter, and output IDs", () => {
    expectPointerDiagnostic(
      v6Json({
        nodes: {
          "a/b": {
            ...plainBox,
            size: [
              { op: "parameter", id: "missing", dimension: "length" },
              lengthLiteral(1),
              lengthLiteral(1),
            ],
          },
        },
        outputs: { out: { node: "a/b", kind: "solid" } },
      }),
      "PARAMETER_MISSING",
      "/nodes/a~1b/size/0/id",
    );
    expectPointerDiagnostic(
      v6Json({
        nodes: {
          "a~1b": {
            ...plainBox,
            size: [
              lengthLiteral(1, "angle"),
              lengthLiteral(1),
              lengthLiteral(1),
            ],
          },
        },
        outputs: { out: { node: "a~1b", kind: "solid" } },
      }),
      "EXPRESSION_DIMENSION_MISMATCH",
      "/nodes/a~01b/size/0",
    );
    expectPointerDiagnostic(
      v6Json({
        parameters: {
          "w/h": { dimension: "length", default: lengthLiteral(1, "angle") },
        },
        nodes: { b: plainBox },
        outputs: { out: { node: "b", kind: "solid" } },
      }),
      "EXPRESSION_DIMENSION_MISMATCH",
      "/parameters/w~1h/default",
    );
    expectPointerDiagnostic(
      v6Json({
        nodes: { b: plainBox },
        outputs: { "x/y": { node: "missing", kind: "solid" } },
      }),
      "REFERENCE_MISSING",
      "/outputs/x~1y/node",
    );
  });

  it("escapes structural parse paths and graph-cycle paths", () => {
    expectPointerDiagnostic(
      v6Json({
        nodes: { b: plainBox },
        outputs: { out: { node: "b", kind: "solid" } },
        configurations: {
          "c/1": { parameterOverrides: { width: lengthLiteral(1) } },
        },
      }),
      "IR_INVALID",
      "/configurations/c~11",
    );
    expectPointerDiagnostic(
      v6Json({
        nodes: {
          "a/b": { ...plainBox, size: [lengthLiteral(1), lengthLiteral(1)] },
        },
        outputs: { out: { node: "a/b", kind: "solid" } },
      }),
      "IR_INVALID",
      "/nodes/a~1b/size",
    );
    expectPointerDiagnostic(
      v6Json({
        nodes: {
          "t/1": {
            kind: "transform",
            input: { node: "t/2", kind: "solid" },
            operations: [noMove],
          },
          "t/2": {
            kind: "transform",
            input: { node: "t/1", kind: "solid" },
            operations: [noMove],
          },
        },
        outputs: { out: { node: "t/1", kind: "solid" } },
      }),
      "GRAPH_CYCLE",
      "/nodes/t~11",
    );
  });

  it("keeps ordinary IDs unchanged", () => {
    expectPointerDiagnostic(
      v6Json({
        nodes: { b: plainBox },
        outputs: { out: { node: "missing", kind: "solid" } },
      }),
      "REFERENCE_MISSING",
      "/outputs/out/node",
    );
  });
});

describe("REFERENCE_KIND_MISMATCH messages", () => {
  it("names the required kind when the declaration matches its target", () => {
    const assembly = parseDocument(
      v6Json({
        nodes: {
          b: plainBox,
          asm: {
            kind: "assembly",
            instances: [
              {
                id: "i1",
                component: { node: "b", kind: "solid" },
                placement: [],
                suppressed: false,
              },
            ],
          },
        },
        outputs: { a: { node: "asm", kind: "assembly" } },
      }),
    );
    expect(assembly.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        path: "/nodes/asm/instances/0/component",
        message: "Reference requires part or assembly, but node 'b' produces solid",
        details: {
          expected: ["part", "assembly"],
          actual: "solid",
          declared: "solid",
        },
      }),
    );

    const booleanTarget = parseDocument(
      v6Json({
        nodes: {
          b: plainBox,
          p: { kind: "part", solid: { node: "b", kind: "solid" } },
          u: {
            kind: "boolean",
            operation: "union",
            target: { node: "p", kind: "part" },
            tools: [{ node: "b", kind: "solid" }],
          },
        },
        outputs: { out: { node: "u", kind: "solid" } },
      }),
    );
    expect(booleanTarget.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        path: "/nodes/u/target",
        message: "Reference requires solid, but node 'p' produces part",
      }),
    );
  });

  it("keeps the declared-versus-produced message for a wrong declaration", () => {
    const result = parseDocument(
      v6Json({
        nodes: {
          b: plainBox,
          moved: {
            kind: "transform",
            input: { node: "b", kind: "part" },
            operations: [noMove],
          },
        },
        outputs: { out: { node: "moved", kind: "solid" } },
      }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        path: "/nodes/moved/input",
        message: "Node 'b' produces solid, but the reference declares part",
        details: { expected: ["solid"], actual: "solid", declared: "part" },
      }),
    );
  });
});

describe("structural node schemas", () => {
  it("leave reference and topology kind agreement to document validation", () => {
    const fillet = {
      kind: "fillet",
      input: { node: "b", kind: "assembly" },
      edges: {
        topology: "vertex",
        query: { op: "all" },
        cardinality: { min: 1 },
      },
      radius: lengthLiteral(1),
    };
    // Documented: the frozen node grammars are structural.
    expect(NodeV6Schema.safeParse(fillet).success).toBe(true);
    expect(
      NodeV1Schema.safeParse({
        kind: "part",
        solid: { node: "b", kind: "profile" },
      }).success,
    ).toBe(true);

    const result = parseDocument(
      v6Json({
        nodes: { b: plainBox, f: fillet },
        outputs: { out: { node: "f", kind: "solid" } },
      }),
    );
    expect(codesAndPaths(result)).toEqual(
      expect.arrayContaining([
        ["REFERENCE_KIND_MISMATCH", "/nodes/f/input"],
        ["TOPOLOGY_SELECTOR_INVALID", "/nodes/f/edges/topology"],
      ]),
    );
  });
});
