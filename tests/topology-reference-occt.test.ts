import { describe, expect, it } from "vitest";
import {
  captureTopologyReference,
  createEvaluator,
  design,
  EvaluatedSolid,
  mm,
  parseDocument,
  stringifyDocument,
  topology,
  vec3,
  type EvaluatedDesign,
  type Evaluator,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

describe("OCCT document-owned persistent topology reference", () => {
  it("captures a box face and consumes it as a shell opening after a parameter change", async () => {
    const kernel = await createOcctKernel();
    let evaluator: Evaluator | undefined;
    let firstDesign: EvaluatedDesign | undefined;
    let changedDesign: EvaluatedDesign | undefined;
    try {
      evaluator = await createEvaluator({ kernel });
      const signatureCapabilities = kernel.capabilities.topology?.signatures;
      expect(signatureCapabilities).toBeDefined();
      if (signatureCapabilities === undefined) return;

      const cad = design("persistent-shell-opening");
      const width = cad.parameter.length("width", mm(10));
      const target = cad.box("box", {
        size: vec3(width, mm(20), mm(30)),
      });
      cad.output("box", target);

      const first = await evaluator.evaluate(cad.build());
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      firstDesign = first.value;
      const firstOutput = firstDesign.output("box");
      expect(firstOutput).toBeInstanceOf(EvaluatedSolid);
      if (!(firstOutput instanceof EvaluatedSolid)) return;

      const snapshot = firstOutput.topology();
      expect(snapshot.ok).toBe(true);
      if (!snapshot.ok) return;
      const xMinFace = snapshot.value.faces.find((face) =>
        face.lineage.some(
          (lineage) => lineage.role === "box.face.x-min",
        ),
      );
      expect(xMinFace).toBeDefined();
      if (xMinFace === undefined) return;

      const captured = captureTopologyReference(
        snapshot.value,
        "face",
        xMinFace.key,
        {
          capabilities: signatureCapabilities,
          tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
        },
      );
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;

      firstDesign.dispose();
      firstDesign = undefined;

      const opening = cad.topologyReference("xMinOpening", target, {
        topology: "face",
        variants: [captured.value],
      });
      const shelled = cad.shell("shelled", target, {
        openings: topology.faces.persistentReference(opening).select(),
        thickness: mm(1),
        direction: "inward",
      });
      cad.output("shelled", shelled);

      const serialized = stringifyDocument(cad.build());
      const persisted = parseDocument(serialized);
      expect(persisted.ok).toBe(true);
      if (!persisted.ok) return;
      expect(persisted.value.version).toBe(2);
      const storedReferences =
        persisted.value.version === 2
          ? persisted.value.topologyReferences
          : undefined;
      expect(Object.keys(storedReferences ?? {})).toEqual(["xMinOpening"]);
      expect(
        Object.values(storedReferences ?? {})[0]?.variants[0]
          ?.kernelFingerprint,
      ).toBe(signatureCapabilities.fingerprint);

      const changed = await evaluator.evaluate(persisted.value, {
        parameters: { width: 16 },
        outputs: ["shelled"],
      });
      expect(changed.ok).toBe(true);
      if (!changed.ok) return;
      changedDesign = changed.value;
      const changedOutput = changedDesign.output("shelled");
      expect(changedOutput).toBeInstanceOf(EvaluatedSolid);
      if (!(changedOutput instanceof EvaluatedSolid)) return;

      const measurement = changedOutput.measure();
      expect(measurement.volume).toBeGreaterThan(0);
      expect(measurement.surfaceArea).toBeGreaterThan(0);
      expect(changedOutput.mesh().indices.length).toBeGreaterThan(0);
    } finally {
      changedDesign?.dispose();
      firstDesign?.dispose();
      if (evaluator === undefined) kernel.dispose();
      else evaluator.dispose();
    }
  });
});
