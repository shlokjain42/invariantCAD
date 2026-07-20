import { describe, expect, it } from "vitest";
import {
  TOPOLOGY_SELECTION_EXPLANATION_VERSION,
  evaluateExpression,
  explainTopologySelection,
  resolveTopologySelection,
  scalarVec3,
  topology,
  type KernelShape,
  type TopologySelectionResolutionExplanation,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

describe("OCCT topology-selection explanations", () => {
  it("explains live resolved and ambiguous face selections without weakening native ownership", async () => {
    const kernel = await createOcctKernel();
    let source: KernelShape | undefined;
    let moved: KernelShape | undefined;
    try {
      source = kernel.box!([10, 20, 30], false, {
        feature: "source-box",
      });
      moved = kernel.transform!(
        source,
        [{ kind: "translate", value: [100, 5, 7] }],
        { feature: "moved-box" },
      );
      expect(kernel.status(moved).ok).toBe(true);
      const snapshot = kernel.topology!(moved);
      expect(snapshot.history).toBe("complete");
      expect(snapshot.faces.length).toBe(6);

      const expectedFace = snapshot.faces.find((face) =>
        face.lineage.some(
          (lineage) => lineage.role === "box.face.x-min",
        ),
      );
      expect(expectedFace).toBeDefined();
      if (expectedFace === undefined) return;

      const context = {
        evaluate: (expression: Parameters<typeof evaluateExpression>[0]) =>
          evaluateExpression(expression, {
            resolveParameter: (id) => {
              throw new Error(`Unexpected parameter '${id}'`);
            },
          }),
        node: "moved-box",
        path: "/nodes/moved-box/faces",
      };
      const resolvedSelection = topology.faces
        .normal(scalarVec3(-1, 0, 0))
        .select().ir;
      const explainedResolved = explainTopologySelection(
        resolvedSelection,
        snapshot,
        context,
      );

      expect(explainedResolved.ok).toBe(true);
      if (
        !explainedResolved.ok ||
        explainedResolved.value.outcome !== "resolved"
      ) {
        return;
      }
      const resolvedExplanation = explainedResolved.value;
      expect(resolvedExplanation).toEqual({
        version: TOPOLOGY_SELECTION_EXPLANATION_VERSION,
        outcome: "resolved",
        topology: "face",
        currentHistory: snapshot.history,
        candidatesConsidered: snapshot.faces.length,
        candidatesMatched: 1,
        minimumRequired: 1,
        maximumAllowed: 1,
        keys: [expectedFace.key],
      });
      expectDeeplyFrozen(resolvedExplanation);
      expect(snapshot.faces.some((face) => face.key === resolvedExplanation.keys[0])).toBe(
        true,
      );
      expect(
        resolveTopologySelection(resolvedSelection, snapshot, context),
      ).toEqual({
        ok: true,
        value: resolvedExplanation.keys,
        diagnostics: [],
      });

      const ambiguousSelection = topology.faces.all().select().ir;
      const explainedAmbiguous = explainTopologySelection(
        ambiguousSelection,
        snapshot,
        context,
      );
      expect(explainedAmbiguous.ok).toBe(true);
      if (!explainedAmbiguous.ok) return;
      expect(explainedAmbiguous.value).toEqual({
        version: TOPOLOGY_SELECTION_EXPLANATION_VERSION,
        outcome: "ambiguous",
        topology: "face",
        currentHistory: snapshot.history,
        candidatesConsidered: snapshot.faces.length,
        candidatesMatched: snapshot.faces.length,
        minimumRequired: 1,
        maximumAllowed: 1,
      });
      expectDeeplyFrozen(explainedAmbiguous.value);
      const serialized = JSON.stringify(explainedAmbiguous.value);
      expect(serialized).not.toMatch(/"keys"\s*:/);
      for (const face of snapshot.faces) {
        expect(serialized).not.toContain(face.key);
      }

      const resolvedAmbiguous = resolveTopologySelection(
        ambiguousSelection,
        snapshot,
        context,
      );
      expect(resolvedAmbiguous.ok).toBe(false);
      if (resolvedAmbiguous.ok) return;
      expect(resolvedAmbiguous.diagnostics).toHaveLength(1);
      const diagnostic = resolvedAmbiguous.diagnostics[0]!;
      expect(diagnostic).toMatchObject({
        code: "TOPOLOGY_SELECTION_AMBIGUOUS",
        node: "moved-box",
        path: "/nodes/moved-box/faces",
        details: {
          topology: "face",
          actual: snapshot.faces.length,
          maximum: 1,
          explanation: explainedAmbiguous.value,
        },
      });
      const embedded = diagnostic.details
        ?.explanation as TopologySelectionResolutionExplanation | undefined;
      expect(embedded).toEqual(explainedAmbiguous.value);
      expectDeeplyFrozen(embedded);
    } finally {
      try {
        if (moved !== undefined) {
          kernel.disposeShape(moved);
          expect(() => kernel.disposeShape(moved!)).not.toThrow();
        }
      } finally {
        try {
          if (source !== undefined) {
            kernel.disposeShape(source);
            expect(() => kernel.disposeShape(source!)).not.toThrow();
          }
        } finally {
          kernel.dispose();
        }
      }
      if (source !== undefined) {
        expect(() => kernel.measure(source!)).toThrow(
          "This OCCT kernel has been disposed",
        );
      }
      expect(() => kernel.dispose()).not.toThrow();
    }
  });
});
