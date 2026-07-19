import { describe, expect, it } from "vitest";
import {
  captureTopologyReference,
  createEvaluator,
  design,
  EvaluatedSolid,
  mm,
  resolveTopologyReference,
  vec3,
  type KernelTopologyKey,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

describe("OCCT persistent topology reference integration", () => {
  it("captures, detaches, and resolves a semantic face across evaluations", async () => {
    const kernel = await createOcctKernel();
    const evaluator = await createEvaluator({ kernel });
    try {
      const signatureCapabilities = kernel.capabilities.topology?.signatures;
      expect(signatureCapabilities).toEqual({
        protocolVersion: 1,
        fingerprint:
          "invariantcad-topology-descriptor@1;occt-wasm@3.7.0;runtime=stock;modelingTolerance=1e-7",
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
});
