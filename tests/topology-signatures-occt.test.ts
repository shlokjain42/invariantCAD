import { describe, expect, it } from "vitest";
import {
  TOPOLOGY_REFERENCE_EXPLANATION_VERSION,
  captureTopologyReference,
  createEvaluator,
  createTopologyReferenceResolutionSession,
  design,
  EvaluatedSolid,
  explainTopologyReference,
  mm,
  plane,
  resolveTopologyReference,
  vec2,
  vec3,
  type KernelShape,
  type KernelTopologyKey,
  type TopologyReferenceResolutionExplanation,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

function expectAggregateInvariants(
  explanation: TopologyReferenceResolutionExplanation,
  candidateUniverse: number,
): void {
  const strategies = Object.values(explanation.strategies);
  expect(explanation.candidatesConsidered).toBe(candidateUniverse);
  expect(explanation.candidatesMatched).toBeLessThanOrEqual(
    explanation.candidatesConsidered,
  );
  expect(
    strategies.reduce((total, strategy) => total + strategy.considered, 0),
  ).toBe(explanation.candidatesConsidered);
  expect(
    strategies.reduce((total, strategy) => total + strategy.matched, 0),
  ).toBe(explanation.candidatesMatched);
}

describe("OCCT persistent topology reference integration", () => {
  it("explains an edge resolved by semantic lineage through a real OCCT transform", async () => {
    const kernel = await createOcctKernel();
    const source = kernel.box!([10, 20, 30], false, {
      feature: "source-box",
    });
    let moved: KernelShape | undefined;
    try {
      const capabilities = kernel.capabilities.topology?.signatures;
      expect(capabilities).toBeDefined();
      if (capabilities === undefined) return;

      const before = kernel.topology!(source);
      const sourceEdge = before.edges.find((edge) =>
        edge.lineage.some(
          (lineage) =>
            lineage.feature === "source-box" &&
            lineage.role === "box.edge.x-min-y-min",
        ),
      );
      expect(sourceEdge).toBeDefined();
      if (sourceEdge === undefined) return;
      const captured = captureTopologyReference(
        before,
        "edge",
        sourceEdge.key,
        {
          capabilities,
          tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
        },
      );
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;

      moved = kernel.transform!(
        source,
        [
          { kind: "rotate", value: [0.2, 0.4, 0.1] },
          { kind: "translate", value: [100, 5, 7] },
        ],
        { feature: "moved-box" },
      );
      const after = kernel.topology!(moved);
      expect(after.history).toBe("complete");

      const explained = explainTopologyReference(captured.value, after, {
        capabilities,
      });
      expect(explained.ok).toBe(true);
      if (!explained.ok || explained.value.outcome !== "resolved") return;
      const explanation = explained.value;
      expect(explanation).toMatchObject({
        version: TOPOLOGY_REFERENCE_EXPLANATION_VERSION,
        outcome: "resolved",
        topology: "edge",
        capturedHistory: "complete",
        currentHistory: "complete",
        candidatesMatched: 1,
        evidence: "semantic-lineage",
        strategies: {
          "semantic-lineage": {
            considered: explanation.candidatesConsidered,
            matched: 1,
          },
          "geometry-adjacency": { considered: 0, matched: 0 },
        },
      });
      expect(explanation.capturedSemanticAnchors).toBeGreaterThan(0);
      expectAggregateInvariants(explanation, after.edges.length);
      expectDeeplyFrozen(explanation);

      const currentEdge = after.edges.find(
        (edge) => edge.key === explanation.key,
      );
      expect(currentEdge?.lineage).toContainEqual({
        feature: "moved-box",
        relation: "modified",
      });
      expect(explanation.key).not.toBe(sourceEdge.key);
      expect(JSON.stringify(explanation)).not.toContain(sourceEdge.key);
    } finally {
      if (moved !== undefined) kernel.disposeShape(moved);
      kernel.disposeShape(source);
      kernel.dispose();
    }
  });

  it("explains geometry-adjacency resolution from a real partial-history OCCT offset", async () => {
    const kernel = await createOcctKernel();
    const source = kernel.box!([10, 20, 30], false, {
      feature: "source-box",
    });
    let expanded: KernelShape | undefined;
    try {
      const capabilities = kernel.capabilities.topology?.signatures;
      expect(capabilities).toBeDefined();
      if (capabilities === undefined) return;

      expanded = kernel.offset!(
        source,
        { distance: 1, direction: "outward", tolerance: 1e-6 },
        { feature: "expanded-box" },
      );
      const snapshot = kernel.topology!(expanded);
      expect(snapshot.history).toBe("partial");
      const face = snapshot.faces.find(
        (candidate) =>
          candidate.surface.kind === "plane" &&
          candidate.surface.normal?.[0] === -1,
      );
      expect(face).toBeDefined();
      if (face === undefined) return;
      const captured = captureTopologyReference(
        snapshot,
        "face",
        face.key,
        {
          capabilities,
          tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
        },
      );
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      expect(captured.value.capturedHistory).toBe("partial");

      const session = createTopologyReferenceResolutionSession(snapshot, {
        capabilities,
      });
      expect(session.ok).toBe(true);
      if (!session.ok) return;
      const explained = session.value.explain(captured.value);
      expect(explained.ok).toBe(true);
      if (!explained.ok || explained.value.outcome !== "resolved") return;
      expect(session.value.explain(captured.value)).toBe(explained);
      const explanation = explained.value;
      expect(explanation).toMatchObject({
        version: TOPOLOGY_REFERENCE_EXPLANATION_VERSION,
        outcome: "resolved",
        topology: "face",
        capturedHistory: "partial",
        currentHistory: "partial",
        candidatesMatched: 1,
        key: face.key,
        evidence: "geometry-adjacency",
        strategies: {
          "semantic-lineage": { considered: 0, matched: 0 },
          "geometry-adjacency": {
            considered: explanation.candidatesConsidered,
            matched: 1,
          },
        },
      });
      expectAggregateInvariants(explanation, snapshot.faces.length);
      expectDeeplyFrozen(explanation);

      const resolved = session.value.resolve(captured.value);
      expect(session.value.resolve(captured.value)).toBe(resolved);
      expect(resolved).toEqual({
        ok: true,
        value: {
          key: explanation.key,
          evidence: explanation.evidence,
        },
        diagnostics: [],
      });
    } finally {
      if (expanded !== undefined) kernel.disposeShape(expanded);
      kernel.disposeShape(source);
      kernel.dispose();
    }
  });

  it("rejects a stored descriptor-@5 reference against current descriptor-@6 OCCT", async () => {
    const kernel = await createOcctKernel();
    const shape = kernel.box!([10, 20, 30], false, { feature: "box" });
    try {
      const currentCapabilities = kernel.capabilities.topology?.signatures;
      expect(currentCapabilities?.fingerprint).toContain(
        "invariantcad-topology-descriptor@6",
      );
      if (currentCapabilities === undefined) return;

      const snapshot = kernel.topology!(shape);
      const face = snapshot.faces.find((candidate) =>
        candidate.lineage.some(
          (lineage) => lineage.role === "box.face.x-min",
        ),
      );
      expect(face).toBeDefined();
      if (face === undefined) return;
      const storedDescriptorV5Capabilities = {
        ...currentCapabilities,
        fingerprint: currentCapabilities.fingerprint.replace(
          "topology-descriptor@6",
          "topology-descriptor@5",
        ),
      };
      const captured = captureTopologyReference(
        snapshot,
        "face",
        face.key,
        {
          capabilities: storedDescriptorV5Capabilities,
          tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
        },
      );
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;

      const resolved = resolveTopologyReference(captured.value, snapshot, {
        capabilities: currentCapabilities,
      });
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "TOPOLOGY_FINGERPRINT_MISMATCH",
          details: expect.objectContaining({
            expected: captured.value.kernelFingerprint,
            actual: currentCapabilities.fingerprint,
          }),
        }),
      );
    } finally {
      kernel.disposeShape(shape);
      kernel.dispose();
    }
  });

  it("captures and resolves through the advertised legacy protocol-v1 profile while v2 remains primary", async () => {
    const kernel = await createOcctKernel();
    const source = kernel.box!([10, 20, 30], false, { feature: "box" });
    let moved: KernelShape | undefined;
    try {
      const primary = kernel.capabilities.topology?.signatures;
      const legacy = kernel.capabilities.topology?.signatureProfiles?.find(
        (profile) => profile.protocolVersion === 1,
      );
      expect(primary).toEqual({
        protocolVersion: 2,
        fingerprint:
          "invariantcad-topology-descriptor@6;occt-wasm@3.7.0;runtime=stock;modelingTolerance=1e-7",
      });
      expect(legacy).toEqual({
        protocolVersion: 1,
        fingerprint:
          "invariantcad-topology-descriptor@4;occt-wasm@3.7.0;runtime=stock;modelingTolerance=1e-7",
      });
      if (primary === undefined || legacy === undefined) return;

      const before = kernel.topology!(source);
      const face = before.faces.find((candidate) =>
        candidate.lineage.some(
          (lineage) => lineage.role === "box.face.x-min",
        ),
      );
      expect(face).toBeDefined();
      if (face === undefined) return;
      const captured = captureTopologyReference(before, "face", face.key, {
        capabilities: legacy,
        tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
      });
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      expect(captured.value).toMatchObject({
        protocolVersion: 1,
        kernelFingerprint: legacy.fingerprint,
        topology: "face",
      });

      moved = kernel.transform!(
        source,
        [{ kind: "translate", value: [25, -5, 3] }],
        { feature: "moved" },
      );
      const after = kernel.topology!(moved);
      const resolved = resolveTopologyReference(captured.value, after, {
        capabilities: legacy,
      });
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.value.evidence).toBe("semantic-lineage");
      }

      const wrongProfile = resolveTopologyReference(captured.value, after, {
        capabilities: primary,
      });
      expect(wrongProfile.ok).toBe(false);
      if (!wrongProfile.ok) {
        expect(wrongProfile.diagnostics[0]).toMatchObject({
          code: "TOPOLOGY_FINGERPRINT_MISMATCH",
        });
      }
    } finally {
      if (moved !== undefined) kernel.disposeShape(moved);
      kernel.disposeShape(source);
      kernel.dispose();
    }
  });

  it("captures, detaches, and resolves a semantic face across evaluations", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const signatureCapabilities = kernel.capabilities.topology?.signatures;
      expect(signatureCapabilities).toEqual({
        protocolVersion: 2,
        fingerprint:
          "invariantcad-topology-descriptor@6;occt-wasm@3.7.0;runtime=stock;modelingTolerance=1e-7",
      });
      if (signatureCapabilities === undefined) return;

      const cad = design("persistent-box-face");
      const width = cad.parameter.length("width", mm(10));
      const box = cad.box("box", {
        size: vec3(width, mm(20), mm(30)),
      });
      cad.output("box", box);
      const document = cad.build();

      const first = await evaluator.evaluate(document);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const firstOutput = first.value.output("box");
      expect(firstOutput).toBeInstanceOf(EvaluatedSolid);
      if (!(firstOutput instanceof EvaluatedSolid)) {
        first.value.dispose();
        return;
      }
      const firstTopology = firstOutput.topology();
      expect(firstTopology.ok).toBe(true);
      if (!firstTopology.ok) {
        first.value.dispose();
        return;
      }
      const firstFace = firstTopology.value.faces.find((face) =>
        face.lineage.some((lineage) => lineage.role === "box.face.x-min"),
      );
      expect(firstFace).toBeDefined();
      if (firstFace === undefined) {
        first.value.dispose();
        return;
      }
      const captured = captureTopologyReference(
        firstTopology.value,
        "face",
        firstFace.key,
        {
          capabilities: signatureCapabilities,
          tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
        },
      );
      expect(captured.ok).toBe(true);
      first.value.dispose();
      if (!captured.ok) return;

      expect(JSON.stringify(captured.value)).not.toContain(firstFace.key);

      const second = await evaluator.evaluate(document, {
        parameters: { width: 40 },
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      try {
        const secondOutput = second.value.output("box");
        expect(secondOutput).toBeInstanceOf(EvaluatedSolid);
        if (!(secondOutput instanceof EvaluatedSolid)) return;
        const secondTopology = secondOutput.topology();
        expect(secondTopology.ok).toBe(true);
        if (!secondTopology.ok) return;
        const resolved = resolveTopologyReference(
          captured.value,
          secondTopology.value,
          { capabilities: signatureCapabilities },
        );
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        expect(resolved.value.evidence).toBe("semantic-lineage");
        const current = secondTopology.value.faces.find(
          (face) => face.key === resolved.value.key,
        );
        expect(current?.lineage).toContainEqual(
          expect.objectContaining({ role: "box.face.x-min" }),
        );
        expect(resolved.value.key).not.toBe(firstFace.key as KernelTopologyKey);
      } finally {
        second.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("resolves a source-aware swept revolution face after its radius changes", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const signatureCapabilities = kernel.capabilities.topology?.signatures;
      expect(signatureCapabilities?.fingerprint).toContain(
        "invariantcad-topology-descriptor@6",
      );
      if (signatureCapabilities === undefined) return;

      const cad = design("persistent-revolve-face");
      const radius = cad.parameter.length("radius", mm(10));
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("section", {
            width: radius,
            height: mm(30),
            center: vec2(radius.mul(0.5), mm(0)),
          }),
        ),
      );
      const revolution = cad.revolve("revolution", profile);
      cad.output("revolution", revolution);
      const document = cad.build();

      const first = await evaluator.evaluate(document);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const firstOutput = first.value.output("revolution");
      expect(firstOutput).toBeInstanceOf(EvaluatedSolid);
      if (!(firstOutput instanceof EvaluatedSolid)) {
        first.value.dispose();
        return;
      }
      const firstTopology = firstOutput.topology();
      expect(firstTopology.ok).toBe(true);
      if (!firstTopology.ok) {
        first.value.dispose();
        return;
      }
      const firstFace = firstTopology.value.faces.find((face) =>
        face.lineage.some(
          (lineage) =>
            lineage.role === "revolve.face.swept" &&
            lineage.source?.kind === "sketch-entity" &&
            lineage.source.sketch === "profile" &&
            lineage.source.entity === "section.e1",
        ),
      );
      expect(firstFace).toBeDefined();
      if (firstFace === undefined) {
        first.value.dispose();
        return;
      }
      const captured = captureTopologyReference(
        firstTopology.value,
        "face",
        firstFace.key,
        {
          capabilities: signatureCapabilities,
          tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
        },
      );
      expect(captured.ok).toBe(true);
      first.value.dispose();
      if (!captured.ok) return;

      const second = await evaluator.evaluate(document, {
        parameters: { radius: 25 },
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      try {
        const secondOutput = second.value.output("revolution");
        expect(secondOutput).toBeInstanceOf(EvaluatedSolid);
        if (!(secondOutput instanceof EvaluatedSolid)) return;
        const secondTopology = secondOutput.topology();
        expect(secondTopology.ok).toBe(true);
        if (!secondTopology.ok) return;
        const resolved = resolveTopologyReference(
          captured.value,
          secondTopology.value,
          { capabilities: signatureCapabilities },
        );
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        expect(resolved.value.evidence).toBe("semantic-lineage");
        expect(resolved.value.key).not.toBe(firstFace.key);
        const current = secondTopology.value.faces.find(
          (face) => face.key === resolved.value.key,
        );
        expect(current?.lineage).toContainEqual({
          feature: "revolution",
          relation: "created",
          role: "revolve.face.swept",
          source: {
            kind: "sketch-entity",
            sketch: "profile",
            entity: "section.e1",
          },
        });
      } finally {
        second.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("resolves a source-aware sweep side after profile and path parameters change", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const signatureCapabilities = kernel.capabilities.topology?.signatures;
      expect(signatureCapabilities?.fingerprint).toContain(
        "invariantcad-topology-descriptor@6",
      );
      if (signatureCapabilities === undefined) return;

      const cad = design("persistent-sweep-side");
      const profileWidth = cad.parameter.length("profileWidth", mm(10));
      const pathLength = cad.parameter.length("pathLength", mm(20));
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("section", {
            width: profileWidth,
            height: mm(6),
          }),
        ),
      );
      const path = cad.polylinePath("path", [
        vec3(mm(0), mm(0), mm(0)),
        vec3(mm(0), mm(0), pathLength),
      ]);
      const sweep = cad.sweep("sweep", profile, path);
      cad.output("sweep", sweep);
      const document = cad.build();

      const first = await evaluator.evaluate(document);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const firstOutput = first.value.output("sweep");
      expect(firstOutput).toBeInstanceOf(EvaluatedSolid);
      if (!(firstOutput instanceof EvaluatedSolid)) {
        first.value.dispose();
        return;
      }
      const firstTopology = firstOutput.topology();
      expect(firstTopology.ok).toBe(true);
      if (!firstTopology.ok) {
        first.value.dispose();
        return;
      }
      const firstFaces = firstTopology.value.faces.filter((face) =>
        face.lineage.some(
          (lineage) =>
            lineage.role === "sweep.face.side" &&
            lineage.source?.kind === "sketch-entity" &&
            lineage.source.sketch === "profile" &&
            lineage.source.entity === "section.e0",
        ),
      );
      expect(firstFaces).toHaveLength(1);
      const firstFace = firstFaces[0];
      if (firstFace === undefined) {
        first.value.dispose();
        return;
      }
      const captured = captureTopologyReference(
        firstTopology.value,
        "face",
        firstFace.key,
        {
          capabilities: signatureCapabilities,
          tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
        },
      );
      expect(captured.ok).toBe(true);
      first.value.dispose();
      if (!captured.ok) return;

      const second = await evaluator.evaluate(document, {
        parameters: { profileWidth: 16, pathLength: 32 },
      });
      expect(
        second.ok,
        second.ok ? undefined : JSON.stringify(second.diagnostics),
      ).toBe(true);
      if (!second.ok) return;
      try {
        const secondOutput = second.value.output("sweep");
        expect(secondOutput).toBeInstanceOf(EvaluatedSolid);
        if (!(secondOutput instanceof EvaluatedSolid)) return;
        const secondTopology = secondOutput.topology();
        expect(secondTopology.ok).toBe(true);
        if (!secondTopology.ok) return;
        const resolved = resolveTopologyReference(
          captured.value,
          secondTopology.value,
          { capabilities: signatureCapabilities },
        );
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        expect(resolved.value.evidence).toBe("semantic-lineage");
        expect(resolved.value.key).not.toBe(firstFace.key);
        const current = secondTopology.value.faces.find(
          (face) => face.key === resolved.value.key,
        );
        expect(current?.lineage).toContainEqual({
          feature: "sweep",
          relation: "created",
          role: "sweep.face.side",
          source: {
            kind: "sketch-entity",
            sketch: "profile",
            entity: "section.e0",
          },
        });
      } finally {
        second.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("resolves a source-anchored loft side after its station and profile size change", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const signatureCapabilities = kernel.capabilities.topology?.signatures;
      expect(signatureCapabilities?.fingerprint).toContain(
        "invariantcad-topology-descriptor@6",
      );
      if (signatureCapabilities === undefined) return;

      const cad = design("persistent-loft-side");
      const lowerWidth = cad.parameter.length("lowerWidth", mm(18));
      const upperStation = cad.parameter.length("upperStation", mm(14));
      const lower = cad.sketch(
        "lower-profile",
        plane.xy(),
        (sketch) =>
          sketch.profile(
            sketch.rectangle("lower-outline", {
              width: lowerWidth,
              height: mm(10),
            }),
          ),
      );
      const upper = cad.sketch(
        "upper-profile",
        plane.xy(vec3(mm(2), mm(-1), upperStation)),
        (sketch) =>
          sketch.profile(
            sketch.rectangle("upper-outline", {
              width: mm(8),
              height: mm(6),
            }),
          ),
      );
      const loft = cad.loft("loft", [lower, upper]);
      cad.output("loft", loft);
      const document = cad.build();

      const first = await evaluator.evaluate(document);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const firstOutput = first.value.output("loft");
      expect(firstOutput).toBeInstanceOf(EvaluatedSolid);
      if (!(firstOutput instanceof EvaluatedSolid)) {
        first.value.dispose();
        return;
      }
      const firstTopology = firstOutput.topology();
      expect(firstTopology.ok).toBe(true);
      if (!firstTopology.ok) {
        first.value.dispose();
        return;
      }
      const firstFaces = firstTopology.value.faces.filter((face) =>
        face.lineage.some(
          (lineage) =>
            lineage.role === "loft.face.side" &&
            lineage.source?.kind === "sketch-entity" &&
            lineage.source.sketch === "lower-profile" &&
            lineage.source.entity === "lower-outline.e0",
        ),
      );
      expect(firstFaces).toHaveLength(1);
      const firstFace = firstFaces[0];
      if (firstFace === undefined) {
        first.value.dispose();
        return;
      }
      const captured = captureTopologyReference(
        firstTopology.value,
        "face",
        firstFace.key,
        {
          capabilities: signatureCapabilities,
          tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
        },
      );
      expect(captured.ok).toBe(true);
      first.value.dispose();
      if (!captured.ok) return;

      const second = await evaluator.evaluate(document, {
        parameters: { lowerWidth: 24, upperStation: 22 },
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      try {
        const secondOutput = second.value.output("loft");
        expect(secondOutput).toBeInstanceOf(EvaluatedSolid);
        if (!(secondOutput instanceof EvaluatedSolid)) return;
        const secondTopology = secondOutput.topology();
        expect(secondTopology.ok).toBe(true);
        if (!secondTopology.ok) return;
        const resolved = resolveTopologyReference(
          captured.value,
          secondTopology.value,
          { capabilities: signatureCapabilities },
        );
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        expect(resolved.value.evidence).toBe("semantic-lineage");
        expect(resolved.value.key).not.toBe(firstFace.key);
        const current = secondTopology.value.faces.find(
          (face) => face.key === resolved.value.key,
        );
        expect(current?.lineage).toContainEqual({
          feature: "loft",
          relation: "created",
          role: "loft.face.side",
          source: {
            kind: "sketch-entity",
            sketch: "lower-profile",
            entity: "lower-outline.e0",
          },
        });
      } finally {
        second.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });
});
