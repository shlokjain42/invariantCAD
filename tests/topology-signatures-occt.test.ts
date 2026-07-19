import { describe, expect, it } from "vitest";
import {
  captureTopologyReference,
  createEvaluator,
  design,
  EvaluatedSolid,
  mm,
  plane,
  resolveTopologyReference,
  vec2,
  vec3,
  type KernelTopologyKey,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

describe("OCCT persistent topology reference integration", () => {
  it("rejects a descriptor-@2 reference against current descriptor-@3 OCCT", async () => {
    const kernel = await createOcctKernel();
    const shape = kernel.box!([10, 20, 30], false, { feature: "box" });
    try {
      const currentCapabilities = kernel.capabilities.topology?.signatures;
      expect(currentCapabilities?.fingerprint).toContain(
        "invariantcad-topology-descriptor@3",
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
      const descriptorV2Capabilities = {
        ...currentCapabilities,
        fingerprint: currentCapabilities.fingerprint.replace(
          "topology-descriptor@3",
          "topology-descriptor@2",
        ),
      };
      const captured = captureTopologyReference(
        snapshot,
        "face",
        face.key,
        {
          capabilities: descriptorV2Capabilities,
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

  it("captures, detaches, and resolves a semantic face across evaluations", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const signatureCapabilities = kernel.capabilities.topology?.signatures;
      expect(signatureCapabilities).toEqual({
        protocolVersion: 1,
        fingerprint:
          "invariantcad-topology-descriptor@3;occt-wasm@3.7.0;runtime=stock;modelingTolerance=1e-7",
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
        "invariantcad-topology-descriptor@3",
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

  it("resolves a source-anchored loft side after its station and profile size change", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const signatureCapabilities = kernel.capabilities.topology?.signatures;
      expect(signatureCapabilities?.fingerprint).toContain(
        "invariantcad-topology-descriptor@3",
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
