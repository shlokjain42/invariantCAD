import { describe, expect, it } from "vitest";
import {
  TOPOLOGY_REFERENCE_EXPLANATION_VERSION,
  captureTopologyReference,
  createTopologyReferenceResolutionSession,
  explainTopologyReference,
  resolveTopologyReference,
  type CadResult,
  type Diagnostic,
  type KernelFaceDescriptor,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
  type TopologyReferenceResolutionExplanation,
} from "../src/index.js";

const capabilities = {
  protocolVersion: 1 as const,
  fingerprint: "test-kernel/topology-explanations@1",
};

const tolerance = {
  linear: 1e-6,
  angular: 1e-6,
  relative: 1e-8,
};

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

function face(
  id: string,
  options: {
    readonly role?: "box.face.x-min" | "box.face.x-max";
    readonly area?: number;
    readonly center?: readonly [number, number, number];
    readonly bounds?: {
      readonly min: readonly [number, number, number];
      readonly max: readonly [number, number, number];
    };
    readonly normal?: readonly [number, number, number];
  } = {},
): KernelFaceDescriptor {
  const center = options.center ?? [0, 0, 0];
  return {
    topology: "face",
    key: key(id),
    center,
    bounds: options.bounds ?? { min: center, max: center },
    lineage:
      options.role === undefined
        ? []
        : [
            {
              feature: "source-box",
              relation: "created",
              role: options.role,
            },
          ],
    area: options.area ?? 10,
    surface: { kind: "plane", normal: options.normal ?? [0, 0, 1] },
    edges: [],
  };
}

function snapshot(
  faces: readonly KernelFaceDescriptor[],
  history: KernelTopologySnapshot["history"] = "complete",
): KernelTopologySnapshot {
  return { history, faces, edges: [], vertices: [] };
}

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

function semanticFixture() {
  const capturedSnapshot = snapshot([
    face("captured-min", { role: "box.face.x-min" }),
    face("captured-max", { role: "box.face.x-max" }),
  ]);
  const captured = captureTopologyReference(
    capturedSnapshot,
    "face",
    key("captured-min"),
    { capabilities, tolerance },
  );
  expect(captured.ok).toBe(true);
  if (!captured.ok) throw new Error(JSON.stringify(captured.diagnostics));
  return { captured: captured.value, capturedSnapshot };
}

function assertExplanationType(
  _value: TopologyReferenceResolutionExplanation,
): void {}

describe("topology-reference resolution explanations", () => {
  it("exports explanation protocol version 1", () => {
    expect(TOPOLOGY_REFERENCE_EXPLANATION_VERSION).toBe(1);
  });

  it("explains an authoritative semantic match through arbitrary geometry", () => {
    const { captured } = semanticFixture();
    const current = snapshot([
      face("current-max", {
        role: "box.face.x-max",
        area: 2,
        center: [-20, 30, 40],
        bounds: { min: [-22, 28, 38], max: [-18, 32, 42] },
        normal: [1, 0, 0],
      }),
      face("current-min", {
        role: "box.face.x-min",
        area: 9_000,
        center: [100, 200, 300],
        bounds: { min: [90, 190, 290], max: [110, 210, 310] },
        normal: [0, -1, 0],
      }),
    ]);

    const explained = explainTopologyReference(captured, current, {
      capabilities,
    });

    expect(explained).toEqual({
      ok: true,
      value: {
        version: 1,
        outcome: "resolved",
        topology: "face",
        capturedHistory: "complete",
        currentHistory: "complete",
        capturedSemanticAnchors: 1,
        candidatesConsidered: 2,
        candidatesMatched: 1,
        strategies: {
          "semantic-lineage": { considered: 2, matched: 1 },
          "geometry-adjacency": { considered: 0, matched: 0 },
        },
        key: key("current-min"),
        evidence: "semantic-lineage",
      },
      diagnostics: [],
    });
    if (!explained.ok || explained.value.outcome !== "resolved") return;
    assertExplanationType(explained.value);
    expectDeeplyFrozen(explained.value);

    const resolved = resolveTopologyReference(captured, current, {
      capabilities,
    });
    expect(resolved).toEqual({
      ok: true,
      value: {
        key: explained.value.key,
        evidence: explained.value.evidence,
      },
      diagnostics: [],
    });
  });

  it("explains partial-history geometry and adjacency fallback", () => {
    const before = snapshot(
      [
        face("partial-before", {
          role: "box.face.x-min",
          area: 25,
          center: [0, 2.5, 2.5],
          bounds: { min: [0, 0, 0], max: [0, 5, 5] },
          normal: [-1, 0, 0],
        }),
      ],
      "partial",
    );
    const captured = captureTopologyReference(
      before,
      "face",
      key("partial-before"),
      { capabilities, tolerance },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const current = snapshot(
      [
        face("partial-current", {
          role: "box.face.x-min",
          area: 25,
          center: [0, 2.5, 2.5],
          bounds: { min: [0, 0, 0], max: [0, 5, 5] },
          normal: [-1, 0, 0],
        }),
      ],
      "partial",
    );

    const explained = explainTopologyReference(captured.value, current, {
      capabilities,
    });

    expect(explained).toEqual({
      ok: true,
      value: {
        version: 1,
        outcome: "resolved",
        topology: "face",
        capturedHistory: "partial",
        currentHistory: "partial",
        capturedSemanticAnchors: 1,
        candidatesConsidered: 1,
        candidatesMatched: 1,
        strategies: {
          "semantic-lineage": { considered: 0, matched: 0 },
          "geometry-adjacency": { considered: 1, matched: 1 },
        },
        key: key("partial-current"),
        evidence: "geometry-adjacency",
      },
      diagnostics: [],
    });
    if (explained.ok) expectDeeplyFrozen(explained.value);
  });

  it("aggregates mixed candidate strategies without changing the winning evidence", () => {
    const before = snapshot([face("anchorless-before")]);
    const captured = captureTopologyReference(
      before,
      "face",
      key("anchorless-before"),
      { capabilities, tolerance },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const candidates = [
      face("semantic-rejection", { role: "box.face.x-min" }),
      face("geometry-match"),
    ] as const;

    for (const currentCandidates of [candidates, [...candidates].reverse()]) {
      const explained = explainTopologyReference(
        captured.value,
        snapshot(currentCandidates),
        { capabilities },
      );

      expect(explained).toEqual({
        ok: true,
        value: {
          version: 1,
          outcome: "resolved",
          topology: "face",
          capturedHistory: "complete",
          currentHistory: "complete",
          capturedSemanticAnchors: 0,
          candidatesConsidered: 2,
          candidatesMatched: 1,
          strategies: {
            "semantic-lineage": { considered: 1, matched: 0 },
            "geometry-adjacency": { considered: 1, matched: 1 },
          },
          key: key("geometry-match"),
          evidence: "geometry-adjacency",
        },
        diagnostics: [],
      });
      if (explained.ok) expectDeeplyFrozen(explained.value);
    }
  });

  it("returns a frozen missing analysis and nests it in resolution diagnostics", () => {
    const { captured } = semanticFixture();
    const current = snapshot([
      face("replacement", { role: "box.face.x-max" }),
    ]);

    const explained = explainTopologyReference(captured, current, {
      capabilities,
    });

    expect(explained).toEqual({
      ok: true,
      value: {
        version: 1,
        outcome: "missing",
        topology: "face",
        capturedHistory: "complete",
        currentHistory: "complete",
        capturedSemanticAnchors: 1,
        candidatesConsidered: 1,
        candidatesMatched: 0,
        strategies: {
          "semantic-lineage": { considered: 1, matched: 0 },
          "geometry-adjacency": { considered: 0, matched: 0 },
        },
      },
      diagnostics: [],
    });
    if (!explained.ok) return;
    expectDeeplyFrozen(explained.value);
    const serialized = JSON.stringify(explained.value);
    expect(serialized).not.toContain("replacement");
    expect(serialized).not.toMatch(/"key"\s*:/);

    const diagnostic = failureDiagnostic(
      resolveTopologyReference(captured, current, { capabilities }),
    );
    expect(diagnostic).toMatchObject({
      code: "TOPOLOGY_MATCH_MISSING",
      details: {
        topology: "face",
        explanation: explained.value,
      },
    });
    expectDeeplyFrozen(diagnostic.details?.explanation);
  });

  it("returns a frozen ambiguous analysis without leaking candidate keys", () => {
    const { captured } = semanticFixture();
    const current = snapshot([
      face("split-first", { role: "box.face.x-min" }),
      face("split-second", { role: "box.face.x-min" }),
    ]);

    const explained = explainTopologyReference(captured, current, {
      capabilities,
    });

    expect(explained).toEqual({
      ok: true,
      value: {
        version: 1,
        outcome: "ambiguous",
        topology: "face",
        capturedHistory: "complete",
        currentHistory: "complete",
        capturedSemanticAnchors: 1,
        candidatesConsidered: 2,
        candidatesMatched: 2,
        strategies: {
          "semantic-lineage": { considered: 2, matched: 2 },
          "geometry-adjacency": { considered: 0, matched: 0 },
        },
      },
      diagnostics: [],
    });
    if (!explained.ok) return;
    expectDeeplyFrozen(explained.value);
    const serialized = JSON.stringify(explained.value);
    expect(serialized).not.toContain("split-first");
    expect(serialized).not.toContain("split-second");
    expect(serialized).not.toMatch(/"key"\s*:/);

    const diagnostic = failureDiagnostic(
      resolveTopologyReference(captured, current, { capabilities }),
    );
    expect(diagnostic).toMatchObject({
      code: "TOPOLOGY_MATCH_AMBIGUOUS",
      details: {
        topology: "face",
        candidates: 2,
        explanation: explained.value,
      },
    });
    expectDeeplyFrozen(diagnostic.details?.explanation);
  });

  it("keeps fingerprint, malformed-input, and resource failures outside the analysis union", () => {
    const { captured, capturedSnapshot } = semanticFixture();

    expect(
      failureDiagnostic(
        explainTopologyReference(captured, capturedSnapshot, {
          capabilities: {
            protocolVersion: 1,
            fingerprint: "different-kernel/topology-explanations@1",
          },
        }),
      ).code,
    ).toBe("TOPOLOGY_FINGERPRINT_MISMATCH");
    expect(
      failureDiagnostic(
        explainTopologyReference(
          { protocolVersion: 1 } as never,
          capturedSnapshot,
          { capabilities },
        ),
      ).code,
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");
    expect(
      failureDiagnostic(
        explainTopologyReference(captured, capturedSnapshot, {
          capabilities,
          limits: { maxTopologyItems: 0 },
        }),
      ).code,
    ).toBe("TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED");
  });

  it("shares one cached analysis between session explain and resolve in either order", () => {
    const { captured, capturedSnapshot } = semanticFixture();

    for (const order of ["explain-first", "resolve-first"] as const) {
      const created = createTopologyReferenceResolutionSession(
        capturedSnapshot,
        {
          capabilities,
          limits: { maxCandidatePairs: 2, maxMatchingSteps: 2 },
        },
      );
      expect(created.ok).toBe(true);
      if (!created.ok) continue;
      const session = created.value;

      if (order === "explain-first") {
        const explained = session.explain(captured);
        expect(explained.ok).toBe(true);
        if (!explained.ok || explained.value.outcome !== "resolved") continue;
        const resolved = session.resolve(captured);
        expect(resolved).toEqual({
          ok: true,
          value: {
            key: explained.value.key,
            evidence: explained.value.evidence,
          },
          diagnostics: [],
        });
        expect(session.explain(captured)).toBe(explained);
        expect(session.resolve(captured)).toBe(resolved);
      } else {
        const resolved = session.resolve(captured);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) continue;
        const explained = session.explain(captured);
        expect(explained).toEqual({
          ok: true,
          value: {
            version: 1,
            outcome: "resolved",
            topology: "face",
            capturedHistory: "complete",
            currentHistory: "complete",
            capturedSemanticAnchors: 1,
            candidatesConsidered: 2,
            candidatesMatched: 1,
            strategies: {
              "semantic-lineage": { considered: 2, matched: 1 },
              "geometry-adjacency": { considered: 0, matched: 0 },
            },
            key: resolved.value.key,
            evidence: resolved.value.evidence,
          },
          diagnostics: [],
        });
        expect(session.resolve(captured)).toBe(resolved);
        expect(session.explain(captured)).toBe(explained);
      }
    }
  });

  it("caches non-resolved and outer-failure projections without recharging work", () => {
    const { captured } = semanticFixture();
    const cases = [
      {
        current: snapshot([
          face("missing", { role: "box.face.x-max" }),
        ]),
        limit: 1,
        outcome: "missing",
        code: "TOPOLOGY_MATCH_MISSING",
        resolveFirst: false,
      },
      {
        current: snapshot([
          face("ambiguous-first", { role: "box.face.x-min" }),
          face("ambiguous-second", { role: "box.face.x-min" }),
        ]),
        limit: 2,
        outcome: "ambiguous",
        code: "TOPOLOGY_MATCH_AMBIGUOUS",
        resolveFirst: true,
      },
    ] as const;

    for (const testCase of cases) {
      const created = createTopologyReferenceResolutionSession(
        testCase.current,
        {
          capabilities,
          limits: {
            maxCandidatePairs: testCase.limit,
            maxMatchingSteps: testCase.limit,
          },
        },
      );
      expect(created.ok).toBe(true);
      if (!created.ok) continue;

      const resolved = testCase.resolveFirst
        ? created.value.resolve(captured)
        : undefined;
      const explained = created.value.explain(captured);
      const finalResolution = resolved ?? created.value.resolve(captured);
      expect(explained.ok).toBe(true);
      if (explained.ok) expect(explained.value.outcome).toBe(testCase.outcome);
      expect(finalResolution.ok).toBe(false);
      if (!finalResolution.ok) {
        expect(finalResolution.diagnostics[0]?.code).toBe(testCase.code);
        if (explained.ok) {
          expect(
            finalResolution.diagnostics[0]?.details?.explanation,
          ).toBe(explained.value);
        }
      }
      expect(created.value.explain(captured)).toBe(explained);
      expect(created.value.resolve(captured)).toBe(finalResolution);
    }

    const created = createTopologyReferenceResolutionSession(
      snapshot([]),
      { capabilities },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const incompatible = {
      ...captured,
      kernelFingerprint: "different-kernel/topology-explanations@1",
    };
    const explainedFailure = created.value.explain(incompatible);
    expect(explainedFailure.ok).toBe(false);
    if (!explainedFailure.ok) {
      expect(explainedFailure.diagnostics[0]?.code).toBe(
        "TOPOLOGY_FINGERPRINT_MISMATCH",
      );
    }
    expect(created.value.resolve(incompatible)).toBe(explainedFailure);
    expect(created.value.explain(incompatible)).toBe(explainedFailure);
  });
});
