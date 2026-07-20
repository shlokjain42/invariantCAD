import { describe, expect, it } from "vitest";
import {
  captureTopologyReference,
  createEvaluator,
  deg,
  design,
  EvaluatedSolid,
  mm,
  parseDocument,
  plane,
  stringifyDocument,
  tf,
  topology,
  vec2,
  vec3,
  type CadResult,
  type DesignDocument,
  type EvaluatedDesign,
  type Evaluator,
  type KernelTopologyKey,
  type KernelTopologySignatureCapabilities,
  type KernelTopologySnapshot,
  type PersistentTopologyReference,
  type TopologyKind,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

const signatureTolerance = Object.freeze({
  linear: 1e-6,
  angular: 1e-9,
  relative: 1e-9,
});

function diagnosticText(result: {
  readonly diagnostics: readonly unknown[];
}): string {
  return JSON.stringify(result.diagnostics);
}

function valueOf<T>(result: CadResult<T>): T {
  expect(
    result.ok,
    result.ok ? undefined : diagnosticText(result),
  ).toBe(true);
  if (!result.ok) throw new Error(diagnosticText(result));
  return result.value;
}

function snapshotOf(
  evaluated: EvaluatedDesign,
  outputName: string,
): KernelTopologySnapshot {
  const output = evaluated.output(outputName);
  expect(output).toBeInstanceOf(EvaluatedSolid);
  if (!(output instanceof EvaluatedSolid)) {
    throw new Error(`Output '${outputName}' is not a solid`);
  }
  return valueOf(output.topology());
}

function capture<K extends TopologyKind>(
  snapshot: KernelTopologySnapshot,
  topologyKind: K,
  key: KernelTopologyKey,
  capabilities: KernelTopologySignatureCapabilities,
): PersistentTopologyReference<K> {
  return valueOf(
    captureTopologyReference(snapshot, topologyKind, key, {
      capabilities,
      tolerance: signatureTolerance,
    }),
  );
}

function persisted(document: DesignDocument): DesignDocument {
  const parsed = valueOf(parseDocument(stringifyDocument(document)));
  expect(parsed.version).toBe(5);
  return parsed;
}

async function expectSolidSuccess(
  evaluator: Evaluator,
  document: DesignDocument,
  outputName: string,
  parameters: Readonly<Record<string, number>>,
): Promise<void> {
  const result = await evaluator.evaluate(document, {
    parameters,
    outputs: [outputName],
  });
  expect(
    result.ok,
    result.ok ? undefined : diagnosticText(result),
  ).toBe(true);
  if (!result.ok) return;
  let output: EvaluatedSolid | undefined;
  try {
    const candidate = result.value.output(outputName);
    expect(candidate).toBeInstanceOf(EvaluatedSolid);
    if (!(candidate instanceof EvaluatedSolid)) return;
    output = candidate;
    expect(output.measure().volume).toBeGreaterThan(0);
  } finally {
    result.value.dispose();
  }
  if (output === undefined) return;
  expect(() => output.measure()).toThrow(/disposed/);
}

async function expectMissingReference(
  evaluator: Evaluator,
  document: DesignDocument,
  outputName: string,
  parameters: Readonly<Record<string, number>>,
): Promise<void> {
  const result = await evaluator.evaluate(document, {
    parameters,
    outputs: [outputName],
  });
  if (result.ok) {
    result.value.dispose();
    expect(result.ok).toBe(false);
    return;
  }
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "TOPOLOGY_MATCH_MISSING",
      node: outputName,
      path: expect.stringMatching(
        new RegExp(`^/nodes/${outputName}/(edges|openings)/query`),
      ),
    }),
  );
}

function closeVector(
  actual: readonly number[],
  expected: readonly number[],
): boolean {
  return actual.every(
    (component, index) =>
      Math.abs(component - (expected[index] ?? Number.NaN)) <= 1e-7,
  );
}

describe("real-OCCT persistent-topology feature-chain torture", () => {
  it("keeps an unchanged Boolean-result edge across tool extremes, fails on a target crossover, and recovers", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const capabilities = kernel.capabilities.topology?.signatures;
      expect(capabilities).toBeDefined();
      if (capabilities === undefined) return;

      const cad = design("persistent-boolean-chain");
      const width = cad.parameter.length("width", mm(30));
      const height = cad.parameter.length("height", mm(20));
      const holeRadius = cad.parameter.length("holeRadius", mm(3));
      const target = cad.box("target", {
        size: vec3(width, height, mm(10)),
      });
      const rawTool = cad.cylinder("raw-tool", {
        radius: holeRadius,
        height: mm(20),
        center: true,
      });
      const tool = cad.transform("tool", rawTool, [
        tf.translate(vec3(width.mul(0.5), height.mul(0.5), mm(5))),
      ]);
      const drilled = cad.subtract("drilled", target, [tool]);
      cad.output("drilled", drilled);

      const first = valueOf(await evaluator.evaluate(cad.build()));
      let evidence: PersistentTopologyReference<"edge"> | undefined;
      try {
        const firstSnapshot = snapshotOf(first, "drilled");
        expect(firstSnapshot.history).toBe("partial");
        const candidates = firstSnapshot.edges.filter(
          (edge) =>
            edge.curve.kind === "line" &&
            Math.abs(edge.length - 10) <= 1e-7 &&
            closeVector(edge.center, [0, 0, 5]),
        );
        expect(candidates).toHaveLength(1);
        const edge = candidates[0];
        if (edge === undefined) return;
        evidence = capture(
          firstSnapshot,
          "edge",
          edge.key,
          capabilities,
        );
        expect(evidence.capturedHistory).toBe("partial");
      } finally {
        first.dispose();
      }
      if (evidence === undefined) return;

      const stored = cad.topologyReference("stable-outer-edge", drilled, {
        topology: "edge",
        variants: [evidence],
      });
      const treated = cad.fillet("treated", drilled, {
        edges: topology.edges.persistentReference(stored).select(),
        radius: mm(0.25),
      });
      cad.output("treated", treated);
      const document = persisted(cad.build());

      for (const radius of [0.05, 1, 3, 9]) {
        await expectSolidSuccess(evaluator, document, "treated", {
          holeRadius: radius,
        });
      }

      await expectMissingReference(evaluator, document, "treated", {
        width: 20,
        height: 30,
        holeRadius: 3,
      });

      await expectSolidSuccess(evaluator, document, "treated", {
        width: 30,
        height: 20,
        holeRadius: 3,
      });
    } finally {
      evaluator.dispose();
    }
  });

  it("fails only while a persisted partial-revolution cap disappears at a full turn, then resolves it again", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const capabilities = kernel.capabilities.topology?.signatures;
      expect(capabilities).toBeDefined();
      if (capabilities === undefined) return;

      const cad = design("persistent-revolution-transition");
      const angle = cad.parameter.angle("angle", deg(90));
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("outline", {
            width: mm(4),
            height: mm(6),
            center: vec2(mm(4), mm(0)),
          }),
        ),
      );
      const revolution = cad.revolve("revolution", profile, { angle });
      cad.output("revolution", revolution);

      const first = valueOf(await evaluator.evaluate(cad.build()));
      let evidence: PersistentTopologyReference<"face"> | undefined;
      try {
        const firstSnapshot = snapshotOf(first, "revolution");
        expect(firstSnapshot.history).toBe("complete");
        const candidates = firstSnapshot.faces.filter((face) =>
          face.lineage.some(
            (lineage) =>
              lineage.feature === "revolution" &&
              lineage.role === "revolve.face.start-cap",
          ),
        );
        expect(candidates).toHaveLength(1);
        const face = candidates[0];
        if (face === undefined) return;
        evidence = capture(
          firstSnapshot,
          "face",
          face.key,
          capabilities,
        );
      } finally {
        first.dispose();
      }
      if (evidence === undefined) return;

      const stored = cad.topologyReference("start-cap", revolution, {
        topology: "face",
        variants: [evidence],
      });
      const treated = cad.shell("treated", revolution, {
        openings: topology.faces.persistentReference(stored).select(),
        thickness: mm(0.1),
      });
      cad.output("treated", treated);
      const document = persisted(cad.build());

      await expectSolidSuccess(evaluator, document, "treated", {
        angle: Math.PI / 2,
      });
      await expectSolidSuccess(evaluator, document, "treated", {
        angle: Math.PI,
      });
      await expectMissingReference(evaluator, document, "treated", {
        angle: Math.PI * 2,
      });
      await expectSolidSuccess(evaluator, document, "treated", {
        angle: (Math.PI * 3) / 2,
      });
    } finally {
      evaluator.dispose();
    }
  });

  it("refuses to invent path-segment identity for a multi-segment sweep side", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const capabilities = kernel.capabilities.topology?.signatures;
      expect(capabilities).toBeDefined();
      if (capabilities === undefined) return;

      const cad = design("ambiguous-sweep-segment");
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("outline", {
            width: mm(4),
            height: mm(2),
          }),
        ),
      );
      const path = cad.polylinePath("path", [
        vec3(mm(0), mm(0), mm(0)),
        vec3(mm(0), mm(0), mm(20)),
        vec3(mm(10), mm(0), mm(20)),
      ]);
      const sweep = cad.sweep("sweep", profile, path);
      cad.output("sweep", sweep);

      const result = valueOf(await evaluator.evaluate(cad.build()));
      try {
        const snapshot = snapshotOf(result, "sweep");
        expect(snapshot.history).toBe("complete");
        const sides = snapshot.faces.filter((face) =>
          face.lineage.some(
            (lineage) =>
              lineage.feature === "sweep" &&
              lineage.role === "sweep.face.side" &&
              lineage.source?.sketch === "profile" &&
              lineage.source.entity === "outline.e0",
          ),
        );
        expect(sides).toHaveLength(2);
        const side = sides[0];
        if (side === undefined) return;

        const captured = captureTopologyReference(
          snapshot,
          "face",
          side.key,
          { capabilities, tolerance: signatureTolerance },
        );
        expect(captured.ok).toBe(false);
        if (captured.ok) return;
        expect(captured.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "TOPOLOGY_MATCH_AMBIGUOUS",
            details: { topology: "face", candidates: 2 },
          }),
        );
      } finally {
        result.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });
});
