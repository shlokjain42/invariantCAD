import { describe, expect, it } from "vitest";
import {
  TOPOLOGY_SELECTION_EXPLANATION_VERSION,
  captureTopologyReference,
  explainTopologySelection,
  resolveTopologySelection,
  scalarVec3,
  topology,
  type CadResult,
  type Diagnostic,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
  type TopologyReferenceEntryIR,
  type TopologyResolutionContext,
  type TopologySelectionIR,
  type TopologySelectionResolutionExplanation,
} from "../src/index.js";
import type { NodeId, TopologyReferenceId } from "../src/core/ids.js";

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

function edge(
  id: string,
  options: {
    readonly center?: readonly [number, number, number];
    readonly curve?: KernelEdgeDescriptor["curve"];
    readonly faces?: readonly KernelTopologyKey[];
  } = {},
): KernelEdgeDescriptor {
  const center = options.center ?? [0, 0, 0];
  return {
    topology: "edge",
    key: key(id),
    center,
    bounds: { min: center, max: center },
    lineage: [{ feature: "source-box", relation: "created" }],
    length: 10,
    curve: options.curve ?? { kind: "line", direction: [0, 0, 1] },
    faces: options.faces ?? [],
  };
}

function face(
  id: string,
  options: {
    readonly center: readonly [number, number, number];
    readonly normal: readonly [number, number, number];
    readonly edges: readonly KernelTopologyKey[];
  },
): KernelFaceDescriptor {
  return {
    topology: "face",
    key: key(id),
    center: options.center,
    bounds: { min: options.center, max: options.center },
    lineage: [{ feature: "source-box", relation: "created" }],
    area: 20,
    surface: { kind: "plane", normal: options.normal },
    edges: options.edges,
  };
}

const mainFaces = [
  face("face-x", {
    center: [0, 5, 5],
    normal: [-1, 0, 0],
    edges: [key("edge-a"), key("edge-shared")],
  }),
  face("face-y", {
    center: [5, 0, 5],
    normal: [0, -1, 0],
    edges: [key("edge-shared"), key("edge-round")],
  }),
] as const;

const mainEdges = [
  edge("edge-a", {
    center: [0, 5, 0],
    faces: [key("face-x")],
  }),
  edge("edge-shared", {
    center: [0, 0, 5],
    faces: [key("face-x"), key("face-y")],
  }),
  edge("edge-round", {
    center: [5, 0, 0],
    curve: { kind: "circle", radius: 5 },
    faces: [key("face-y")],
  }),
] as const;

function mainSnapshot(
  reverse = false,
  history: KernelTopologySnapshot["history"] = "complete",
): KernelTopologySnapshot {
  return {
    history,
    faces: reverse ? [...mainFaces].reverse() : mainFaces,
    edges: reverse ? [...mainEdges].reverse() : mainEdges,
  };
}

const evaluateLiteral: TopologyResolutionContext["evaluate"] = (expression) => {
  if (expression.op !== "literal" || expression.value === undefined) {
    throw new Error("Test context only evaluates literals");
  }
  return expression.value;
};

const literalContext = {
  evaluate: evaluateLiteral,
  node: "consumer",
  path: "/nodes/consumer/selection",
} satisfies TopologyResolutionContext;

function failureDiagnostic(result: CadResult<unknown>): Diagnostic {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected a failed CadResult");
  expect(result.diagnostics).toHaveLength(1);
  return result.diagnostics[0]!;
}

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

function assertExplanationType(
  _value: TopologySelectionResolutionExplanation,
): void {}

const persistentCapabilities = {
  protocolVersion: 1 as const,
  fingerprint: "test-kernel/topology-selection-explanations@1",
};

function persistentFixture(): {
  readonly referenceId: TopologyReferenceId;
  readonly input: NodeId;
  readonly entry: TopologyReferenceEntryIR<"edge">;
  readonly selection: TopologySelectionIR<"edge">;
} {
  const captured = captureTopologyReference(
    {
      history: "partial",
      faces: [],
      edges: [edge("captured-edge", { center: [2, 3, 4] })],
    },
    "edge",
    key("captured-edge"),
    {
      capabilities: persistentCapabilities,
      tolerance: { linear: 1e-9, angular: 1e-9, relative: 1e-9 },
    },
  );
  expect(captured.ok).toBe(true);
  if (!captured.ok) throw new Error(JSON.stringify(captured.diagnostics));

  const referenceId = "stored-edge" as TopologyReferenceId;
  const input = "source-box" as NodeId;
  return {
    referenceId,
    input,
    entry: {
      target: { node: input, kind: "solid" },
      topology: "edge",
      variants: [captured.value],
    },
    selection: {
      topology: "edge",
      query: {
        op: "and",
        queries: [
          { op: "persistentReference", reference: referenceId },
          { op: "curve", kind: "line" },
        ],
      },
      cardinality: { min: 1, max: 1 },
    },
  };
}

describe("topology-selection resolution explanations", () => {
  it("exports explanation protocol version 1", () => {
    expect(TOPOLOGY_SELECTION_EXPLANATION_VERSION).toBe(1);
  });

  it("explains a resolved edge selection independently of enumeration order", () => {
    const selection = topology.edges
      .direction(scalarVec3(0, 0, 1))
      .atLeast(2).ir;
    const forward = explainTopologySelection(
      selection,
      mainSnapshot(),
      literalContext,
    );
    const reverse = explainTopologySelection(
      selection,
      mainSnapshot(true),
      literalContext,
    );

    expect(forward).toEqual({
      ok: true,
      value: {
        version: 1,
        outcome: "resolved",
        topology: "edge",
        currentHistory: "complete",
        candidatesConsidered: 3,
        candidatesMatched: 2,
        minimumRequired: 2,
        maximumAllowed: null,
        keys: [key("edge-a"), key("edge-shared")],
      },
      diagnostics: [],
    });
    expect(reverse).toEqual(forward);
    if (!forward.ok || forward.value.outcome !== "resolved") return;
    assertExplanationType(forward.value);
    expectDeeplyFrozen(forward.value);

    expect(
      resolveTopologySelection(selection, mainSnapshot(), literalContext),
    ).toEqual({
      ok: true,
      value: forward.value.keys,
      diagnostics: [],
    });
  });

  it("explains missing and ambiguous face selections without leaking candidate identity", () => {
    const missingSelection = topology.faces.surface("sphere").select().ir;
    const missing = explainTopologySelection(
      missingSelection,
      mainSnapshot(),
      literalContext,
    );
    expect(missing).toEqual({
      ok: true,
      value: {
        version: 1,
        outcome: "missing",
        topology: "face",
        currentHistory: "complete",
        candidatesConsidered: 2,
        candidatesMatched: 0,
        minimumRequired: 1,
        maximumAllowed: 1,
      },
      diagnostics: [],
    });
    if (!missing.ok) return;
    expectDeeplyFrozen(missing.value);
    const missingJson = JSON.stringify(missing.value);
    expect(missingJson).not.toMatch(/"keys"\s*:/);
    expect(missingJson).not.toContain("face-x");
    expect(missingJson).not.toContain("face-y");

    const missingDiagnostic = failureDiagnostic(
      resolveTopologySelection(
        missingSelection,
        mainSnapshot(),
        literalContext,
      ),
    );
    expect(missingDiagnostic).toMatchObject({
      code: "TOPOLOGY_SELECTION_MISSING",
      details: {
        topology: "face",
        actual: 0,
        minimum: 1,
        candidates: expect.any(Array),
        candidatesTruncated: false,
        explanation: missing.value,
      },
    });
    expectDeeplyFrozen(missingDiagnostic.details?.explanation);

    const ambiguousSelection = topology.faces.surface("plane").select().ir;
    const ambiguous = explainTopologySelection(
      ambiguousSelection,
      mainSnapshot(),
      literalContext,
    );
    expect(ambiguous).toEqual({
      ok: true,
      value: {
        version: 1,
        outcome: "ambiguous",
        topology: "face",
        currentHistory: "complete",
        candidatesConsidered: 2,
        candidatesMatched: 2,
        minimumRequired: 1,
        maximumAllowed: 1,
      },
      diagnostics: [],
    });
    if (!ambiguous.ok) return;
    expectDeeplyFrozen(ambiguous.value);
    const ambiguousJson = JSON.stringify(ambiguous.value);
    expect(ambiguousJson).not.toMatch(/"keys"\s*:/);
    expect(ambiguousJson).not.toContain("face-x");
    expect(ambiguousJson).not.toContain("face-y");

    const ambiguousDiagnostic = failureDiagnostic(
      resolveTopologySelection(
        ambiguousSelection,
        mainSnapshot(true),
        literalContext,
      ),
    );
    expect(ambiguousDiagnostic).toMatchObject({
      code: "TOPOLOGY_SELECTION_AMBIGUOUS",
      details: {
        topology: "face",
        actual: 2,
        maximum: 1,
        matches: expect.any(Array),
        matchesTruncated: false,
        explanation: ambiguous.value,
      },
    });
    expectDeeplyFrozen(ambiguousDiagnostic.details?.explanation);
  });

  it("composes a persistent atom with the ordinary query algebra", () => {
    const fixture = persistentFixture();
    const current: KernelTopologySnapshot = {
      history: "partial",
      faces: [],
      edges: [edge("current-edge", { center: [2, 3, 4] })],
    };
    const context = {
      ...literalContext,
      persistent: {
        registry: { [fixture.referenceId]: fixture.entry },
        input: fixture.input,
        capabilities: persistentCapabilities,
      },
    };

    const explained = explainTopologySelection(
      fixture.selection,
      current,
      context,
    );

    expect(explained).toEqual({
      ok: true,
      value: {
        version: 1,
        outcome: "resolved",
        topology: "edge",
        currentHistory: "partial",
        candidatesConsidered: 1,
        candidatesMatched: 1,
        minimumRequired: 1,
        maximumAllowed: 1,
        keys: [key("current-edge")],
      },
      diagnostics: [],
    });
    if (explained.ok) expectDeeplyFrozen(explained.value);
    expect(
      resolveTopologySelection(fixture.selection, current, context),
    ).toEqual({
      ok: true,
      value: [key("current-edge")],
      diagnostics: [],
    });
  });

  it("keeps a persistent-reference ambiguity outside the outer outcome union", () => {
    const fixture = persistentFixture();
    const current: KernelTopologySnapshot = {
      history: "partial",
      faces: [],
      edges: [
        edge("current-first", { center: [2, 3, 4] }),
        edge("current-second", { center: [2, 3, 4] }),
      ],
    };
    const diagnostic = failureDiagnostic(
      explainTopologySelection(fixture.selection, current, {
        ...literalContext,
        persistent: {
          registry: { [fixture.referenceId]: fixture.entry },
          input: fixture.input,
          capabilities: persistentCapabilities,
        },
      }),
    );

    expect(diagnostic).toMatchObject({
      code: "TOPOLOGY_MATCH_AMBIGUOUS",
      path: "/nodes/consumer/selection/query/queries/0/reference",
      details: {
        reference: fixture.referenceId,
        explanation: { outcome: "ambiguous" },
      },
    });
  });

  it("keeps a nested persistent work-limit failure outside the outer outcome union", () => {
    const fixture = persistentFixture();
    const inner: TopologySelectionIR<"edge"> = {
      topology: "edge",
      query: {
        op: "persistentReference",
        reference: fixture.referenceId,
      },
      cardinality: { min: 1, max: 1 },
    };
    const outer: TopologySelectionIR<"face"> = {
      topology: "face",
      query: { op: "adjacentTo", selection: inner },
      cardinality: { min: 1 },
    };

    const explained = explainTopologySelection(outer, mainSnapshot(), {
      ...literalContext,
      persistent: {
        registry: { [fixture.referenceId]: fixture.entry },
        input: fixture.input,
        capabilities: persistentCapabilities,
        limits: { maxCandidatePairs: 0 },
      },
    });

    expect(explained.ok).toBe(false);
    expect(Object.hasOwn(explained, "value")).toBe(false);
    const diagnostic = failureDiagnostic(explained);
    expect(diagnostic).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
      path: "/nodes/consumer/selection/query/selection/query/reference",
      details: {
        resource: "maxCandidatePairs",
        limit: 0,
        actual: 1,
        reference: fixture.referenceId,
      },
    });
  });

  it("keeps nested adjacency cardinality failures fail-closed", () => {
    const selection = topology.faces
      .adjacentTo(topology.edges.curve("line").select())
      .atLeast(1).ir;

    const diagnostic = failureDiagnostic(
      explainTopologySelection(selection, mainSnapshot(), literalContext),
    );

    expect(diagnostic).toMatchObject({
      code: "TOPOLOGY_SELECTION_AMBIGUOUS",
      path: "/nodes/consumer/selection/query/selection",
      details: {
        topology: "edge",
        actual: 2,
        maximum: 1,
        explanation: {
          version: 1,
          outcome: "ambiguous",
          topology: "edge",
          candidatesConsidered: 3,
          candidatesMatched: 2,
          minimumRequired: 1,
          maximumAllowed: 1,
        },
      },
    });
    expectDeeplyFrozen(diagnostic.details?.explanation);
  });

  it("keeps invalid selectors, expression failures, and incomplete history as failures", () => {
    const wrongQuery: TopologySelectionIR<"edge"> = {
      topology: "edge",
      query: { op: "surface", kind: "plane" },
      cardinality: { min: 1, max: 1 },
    };
    expect(
      failureDiagnostic(
        explainTopologySelection(wrongQuery, mainSnapshot(), literalContext),
      ).code,
    ).toBe("TOPOLOGY_SELECTOR_INVALID");

    expect(
      failureDiagnostic(
        explainTopologySelection(
          topology.edges.direction(scalarVec3(0, 0, 1)).select().ir,
          mainSnapshot(),
          {
            ...literalContext,
            evaluate: () => {
              throw new Error("expression exploded");
            },
          },
        ),
      ).code,
    ).toBe("TOPOLOGY_SELECTOR_INVALID");

    const originSelection: TopologySelectionIR<"edge"> = {
      topology: "edge",
      query: {
        op: "origin",
        feature: "source-box" as NodeId,
        relation: "created",
      },
      cardinality: { min: 1 },
    };
    expect(
      failureDiagnostic(
        explainTopologySelection(
          originSelection,
          mainSnapshot(false, "partial"),
          literalContext,
        ),
      ).code,
    ).toBe("TOPOLOGY_HISTORY_UNAVAILABLE");
  });

  it("rejects malformed cardinality and kernel snapshots before producing an explanation", () => {
    const malformedCardinality: TopologySelectionIR<"edge"> = {
      topology: "edge",
      query: { op: "all" },
      cardinality: { min: 0, max: 0 },
    };
    expect(
      failureDiagnostic(
        explainTopologySelection(
          malformedCardinality,
          mainSnapshot(),
          literalContext,
        ),
      ).code,
    ).toBe("TOPOLOGY_SELECTOR_INVALID");

    const duplicate = edge("duplicate");
    const malformedSnapshot: KernelTopologySnapshot = {
      history: "complete",
      faces: [],
      edges: [duplicate, duplicate],
    };
    expect(
      failureDiagnostic(
        explainTopologySelection(
          topology.edges.all().atLeast(1).ir,
          malformedSnapshot,
          literalContext,
        ),
      ),
    ).toMatchObject({
      code: "KERNEL_ERROR",
      details: { protocolViolation: true },
    });
  });
});
