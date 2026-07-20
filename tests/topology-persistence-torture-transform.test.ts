import { describe, expect, it } from "vitest";
import {
  angleVec3,
  captureTopologyReference,
  createEvaluator,
  deg,
  design,
  EvaluatedSolid,
  mm,
  parseDocument,
  plane,
  resolveTopologyReference,
  stringifyDocument,
  tf,
  topology,
  vec2,
  vec3,
  type EvaluatedDesign,
  type Evaluator,
  type KernelTopologySnapshot,
  type PersistentTopologyReference,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

const tolerance = { linear: 1e-6, angular: 1e-9, relative: 1e-9 } as const;

function sourceAwareItem(
  snapshot: KernelTopologySnapshot,
  topologyKind: "face" | "edge",
  role: string,
  entity: string,
) {
  const items = topologyKind === "face" ? snapshot.faces : snapshot.edges;
  const matches = items.filter((item) =>
    item.lineage.some(
      (lineage) =>
        lineage.feature === "extrusion" &&
        lineage.relation === "created" &&
        lineage.role === role &&
        lineage.source?.kind === "sketch-entity" &&
        lineage.source.sketch === "profile" &&
        lineage.source.entity === entity,
    ),
  );
  expect(matches).toHaveLength(1);
  return matches[0];
}

function expectSolid(
  evaluated: EvaluatedDesign,
  output: string,
): EvaluatedSolid {
  const value = evaluated.output(output);
  expect(value).toBeInstanceOf(EvaluatedSolid);
  if (!(value instanceof EvaluatedSolid)) {
    throw new TypeError(`Expected '${output}' to be an evaluated solid`);
  }
  return value;
}

function expectBounds(
  solid: EvaluatedSolid,
  dimensions: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly yaw: number;
    readonly tx: number;
    readonly ty: number;
    readonly tz: number;
  },
): void {
  const { width, height, depth, yaw, tx, ty, tz } = dimensions;
  const extentX =
    Math.abs(width * Math.cos(yaw)) + Math.abs(height * Math.sin(yaw));
  const extentY =
    Math.abs(width * Math.sin(yaw)) + Math.abs(height * Math.cos(yaw));
  const expected = {
    min: [tx - extentX / 2, ty - extentY / 2, tz],
    max: [tx + extentX / 2, ty + extentY / 2, tz + depth],
  } as const;
  const actual = solid.measure().boundingBox;
  for (const bound of ["min", "max"] as const) {
    actual[bound].forEach((coordinate, index) => {
      expect(coordinate).toBeCloseTo(expected[bound][index]!, 6);
    });
  }
}

describe("OCCT persistent-topology transform torture", () => {
  it("round-trips source-aware face and edge references across dimension and rigid-transform crossovers", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as { readonly shapeCount: number };
    let evaluator: Evaluator | undefined;
    let initial: EvaluatedDesign | undefined;
    try {
      evaluator = await createEvaluator({ kernel });
      const baselineShapeCount = raw.shapeCount;
      const capabilities = kernel.capabilities.topology?.signatures;
      expect(capabilities?.fingerprint).toContain(
        "invariantcad-topology-descriptor@4",
      );
      if (capabilities === undefined) return;

      const cad = design("persistent-transform-crossover");
      const width = cad.parameter.length("width", mm(40));
      const height = cad.parameter.length("height", mm(20));
      const depth = cad.parameter.length("depth", mm(10));
      const yaw = cad.parameter.angle("yaw", deg(90));
      const tx = cad.parameter.length("tx", mm(100));
      const ty = cad.parameter.length("ty", mm(5));
      const tz = cad.parameter.length("tz", mm(7));
      const thickness = cad.parameter.length("thickness", mm(2));
      const filletRadius = cad.parameter.length("filletRadius", mm(1.5));
      const profile = cad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(sketch.rectangle("outline", { width, height })),
      );
      const extrusion = cad.extrude("extrusion", profile, {
        distance: depth,
      });
      const moved = cad.transform("moved", extrusion, [
        tf.rotate(angleVec3(deg(0), deg(0), yaw)),
        tf.translate(vec3(tx, ty, tz)),
      ]);
      cad.output("moved", moved);

      const first = await evaluator.evaluate(cad.build(), {
        outputs: ["moved"],
      });
      expect(
        first.ok,
        first.ok ? undefined : JSON.stringify(first.diagnostics),
      ).toBe(true);
      if (!first.ok) return;
      initial = first.value;
      const initialSolid = expectSolid(initial, "moved");
      const initialTopology = initialSolid.topology();
      expect(initialTopology.ok).toBe(true);
      if (!initialTopology.ok) return;

      const sideFace = sourceAwareItem(
        initialTopology.value,
        "face",
        "extrude.face.side",
        "outline.e1",
      );
      const endRim = sourceAwareItem(
        initialTopology.value,
        "edge",
        "extrude.edge.end-rim",
        "outline.e1",
      );
      if (sideFace === undefined || endRim === undefined) return;
      expect(sideFace.lineage).toContainEqual({
        feature: "moved",
        relation: "modified",
      });
      expect(endRim.lineage).toContainEqual({
        feature: "moved",
        relation: "modified",
      });

      const capturedFace = captureTopologyReference(
        initialTopology.value,
        "face",
        sideFace.key,
        { capabilities, tolerance },
      );
      const capturedEdge = captureTopologyReference(
        initialTopology.value,
        "edge",
        endRim.key,
        { capabilities, tolerance },
      );
      expect(capturedFace.ok).toBe(true);
      expect(capturedEdge.ok).toBe(true);
      if (!capturedFace.ok || !capturedEdge.ok) return;

      const oldFaceKey = sideFace.key;
      const oldEdgeKey = endRim.key;
      expect(JSON.stringify(capturedFace.value)).not.toContain(oldFaceKey);
      expect(JSON.stringify(capturedEdge.value)).not.toContain(oldEdgeKey);
      initial.dispose();
      initial = undefined;
      expect(() => initialSolid.measure()).toThrow(
        "This evaluation result has been disposed",
      );
      expect(raw.shapeCount).toBe(baselineShapeCount);

      const storedFace = cad.topologyReference("rightSide", moved, {
        topology: "face",
        variants: [capturedFace.value],
      });
      const storedEdge = cad.topologyReference("rightEndRim", moved, {
        topology: "edge",
        variants: [capturedEdge.value],
      });
      const hollow = cad.shell("hollow", moved, {
        openings: topology.faces.persistentReference(storedFace).select(),
        thickness,
        direction: "inward",
      });
      const rounded = cad.fillet("rounded", moved, {
        edges: topology.edges.persistentReference(storedEdge).select(),
        radius: filletRadius,
      });
      cad.output("hollow", hollow);
      cad.output("rounded", rounded);

      const serialized = stringifyDocument(cad.build());
      expect(serialized).not.toContain(oldFaceKey);
      expect(serialized).not.toContain(oldEdgeKey);
      const parsed = parseDocument(serialized);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || parsed.value.version !== 5) return;
      expect(Object.keys(parsed.value.topologyReferences ?? {}).sort()).toEqual([
        "rightEndRim",
        "rightSide",
      ]);
      const registryEntries = Object.entries(
        parsed.value.topologyReferences ?? {},
      );
      const faceEvidence = registryEntries.find(
        ([id]) => id === "rightSide",
      )?.[1].variants[0] as PersistentTopologyReference<"face"> | undefined;
      const edgeEvidence = registryEntries.find(
        ([id]) => id === "rightEndRim",
      )?.[1].variants[0] as PersistentTopologyReference<"edge"> | undefined;
      expect(faceEvidence).toBeDefined();
      expect(edgeEvidence).toBeDefined();
      if (faceEvidence === undefined || edgeEvidence === undefined) return;

      const cases = [
        {
          width: 24,
          height: 24,
          depth: 12,
          yaw: Math.PI / 4,
          tx: -10,
          ty: 30,
          tz: 2,
          thickness: 2,
          filletRadius: 1.5,
        },
        {
          width: 16,
          height: 38,
          depth: 12,
          yaw: Math.PI / 6,
          tx: -25,
          ty: 42,
          tz: 3,
          thickness: 2,
          filletRadius: 1.5,
        },
        {
          width: 40,
          height: 20,
          depth: 10,
          yaw: Math.PI / 2,
          tx: 100,
          ty: 5,
          tz: 7,
          thickness: 2,
          filletRadius: 1.5,
        },
      ] as const;

      for (const parameters of cases) {
        const changed = await evaluator.evaluate(parsed.value, { parameters });
        expect(
          changed.ok,
          changed.ok ? undefined : JSON.stringify(changed.diagnostics),
        ).toBe(true);
        if (!changed.ok) continue;
        let movedSolid: EvaluatedSolid | undefined;
        try {
          movedSolid = expectSolid(changed.value, "moved");
          const hollowSolid = expectSolid(changed.value, "hollow");
          const roundedSolid = expectSolid(changed.value, "rounded");
          const changedTopology = movedSolid.topology();
          expect(changedTopology.ok).toBe(true);
          if (!changedTopology.ok) {
            throw new Error(JSON.stringify(changedTopology.diagnostics));
          }

          const resolvedFace = resolveTopologyReference(
            faceEvidence,
            changedTopology.value,
            { capabilities },
          );
          const resolvedEdge = resolveTopologyReference(
            edgeEvidence,
            changedTopology.value,
            { capabilities },
          );
          expect(resolvedFace.ok).toBe(true);
          expect(resolvedEdge.ok).toBe(true);
          if (!resolvedFace.ok || !resolvedEdge.ok) {
            throw new Error(
              JSON.stringify({
                face: resolvedFace.ok ? undefined : resolvedFace.diagnostics,
                edge: resolvedEdge.ok ? undefined : resolvedEdge.diagnostics,
              }),
            );
          }
          expect(resolvedFace.value.evidence).toBe("semantic-lineage");
          expect(resolvedEdge.value.evidence).toBe("semantic-lineage");
          expect(resolvedFace.value.key).not.toBe(oldFaceKey);
          expect(resolvedEdge.value.key).not.toBe(oldEdgeKey);

          const currentFace = changedTopology.value.faces.find(
            (face) => face.key === resolvedFace.value.key,
          );
          const currentEdge = changedTopology.value.edges.find(
            (edge) => edge.key === resolvedEdge.value.key,
          );
          expect(currentFace).toBe(
            sourceAwareItem(
              changedTopology.value,
              "face",
              "extrude.face.side",
              "outline.e1",
            ),
          );
          expect(currentEdge).toBe(
            sourceAwareItem(
              changedTopology.value,
              "edge",
              "extrude.edge.end-rim",
              "outline.e1",
            ),
          );

          const base = parameters.width * parameters.height * parameters.depth;
          const cavity =
            (parameters.width - parameters.thickness) *
            (parameters.height - 2 * parameters.thickness) *
            (parameters.depth - 2 * parameters.thickness);
          expect(hollowSolid.measure().volume).toBeCloseTo(base - cavity, 7);
          expect(roundedSolid.measure().volume).toBeCloseTo(
            base -
              parameters.height *
                parameters.filletRadius ** 2 *
                (1 - Math.PI / 4),
            7,
          );
          expectBounds(movedSolid, parameters);
          expect(
            changed.value.diagnostics.some((item) =>
              item.code.startsWith("TOPOLOGY_"),
            ),
          ).toBe(false);
        } finally {
          changed.value.dispose();
        }
        if (movedSolid !== undefined) {
          expect(() => movedSolid.topology()).toThrow(
            "This evaluation result has been disposed",
          );
        }
        expect(raw.shapeCount).toBe(baselineShapeCount);
      }
    } finally {
      initial?.dispose();
      if (evaluator === undefined) kernel.dispose();
      else evaluator.dispose();
    }
  });

  it("fails closed when a transformed extrusion's captured source entity disappears", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as { readonly shapeCount: number };
    let evaluator: Evaluator | undefined;
    let capturedDesign: EvaluatedDesign | undefined;
    try {
      evaluator = await createEvaluator({ kernel });
      const baselineShapeCount = raw.shapeCount;
      const capabilities = kernel.capabilities.topology?.signatures;
      if (capabilities === undefined) return;

      const original = design("persistent-transform-topology-change");
      const originalProfile = original.sketch(
        "profile",
        plane.xy(),
        (sketch) =>
          sketch.profile(
            sketch.rectangle("outline", {
              width: mm(30),
              height: mm(18),
            }),
          ),
      );
      const originalExtrusion = original.extrude(
        "extrusion",
        originalProfile,
        { distance: mm(10) },
      );
      const originalMoved = original.transform("moved", originalExtrusion, [
        tf.rotate(angleVec3(deg(0), deg(0), deg(35))),
        tf.translate(vec3(mm(20), mm(-15), mm(4))),
      ]);
      original.output("moved", originalMoved);
      const captured = await evaluator.evaluate(original.build());
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      capturedDesign = captured.value;
      const capturedSolid = expectSolid(capturedDesign, "moved");
      const capturedTopology = capturedSolid.topology();
      expect(capturedTopology.ok).toBe(true);
      if (!capturedTopology.ok) return;
      const removedSide = sourceAwareItem(
        capturedTopology.value,
        "face",
        "extrude.face.side",
        "outline.e1",
      );
      if (removedSide === undefined) return;
      const evidence = captureTopologyReference(
        capturedTopology.value,
        "face",
        removedSide.key,
        { capabilities, tolerance },
      );
      expect(evidence.ok).toBe(true);
      if (!evidence.ok) return;
      const oldKey = removedSide.key;
      capturedDesign.dispose();
      capturedDesign = undefined;
      expect(raw.shapeCount).toBe(baselineShapeCount);

      const changed = design("persistent-transform-topology-change");
      const changedProfile = changed.sketch("profile", plane.xy(), (sketch) => {
        const replacement = sketch.circle("replacement", {
          center: vec2(mm(0), mm(0)),
          radius: mm(12),
        });
        sketch.fixed("fix-replacement-center", replacement.center);
        return sketch.profile(replacement.loop());
      });
      const changedExtrusion = changed.extrude("extrusion", changedProfile, {
        distance: mm(10),
      });
      const changedMoved = changed.transform("moved", changedExtrusion, [
        tf.rotate(angleVec3(deg(0), deg(0), deg(35))),
        tf.translate(vec3(mm(20), mm(-15), mm(4))),
      ]);
      const removedReference = changed.topologyReference(
        "removedRectangleSide",
        changedMoved,
        { topology: "face", variants: [evidence.value] },
      );
      const hollow = changed.shell("hollow", changedMoved, {
        openings: topology.faces
          .persistentReference(removedReference)
          .select(),
        thickness: mm(1),
        direction: "inward",
      });
      changed.output("moved", changedMoved);
      changed.output("hollow", hollow);

      const serialized = stringifyDocument(changed.build());
      expect(serialized).not.toContain(oldKey);
      const parsed = parseDocument(serialized);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      const validTarget = await evaluator.evaluate(parsed.value, {
        outputs: ["moved"],
      });
      expect(
        validTarget.ok,
        validTarget.ok ? undefined : JSON.stringify(validTarget.diagnostics),
      ).toBe(true);
      if (validTarget.ok) {
        try {
          const changedTopology = expectSolid(
            validTarget.value,
            "moved",
          ).topology();
          expect(changedTopology.ok).toBe(true);
          if (changedTopology.ok) {
            const stored =
              parsed.value.version === 5
                ? (Object.entries(parsed.value.topologyReferences ?? {}).find(
                    ([id]) => id === "removedRectangleSide",
                  )?.[1].variants[0] as
                    | PersistentTopologyReference<"face">
                    | undefined)
                : undefined;
            expect(stored).toBeDefined();
            if (stored !== undefined) {
              const resolved = resolveTopologyReference(
                stored,
                changedTopology.value,
                { capabilities },
              );
              expect(resolved.ok).toBe(false);
              if (!resolved.ok) {
                expect(resolved.diagnostics[0]).toMatchObject({
                  code: "TOPOLOGY_MATCH_MISSING",
                });
              }
            }
          }
        } finally {
          validTarget.value.dispose();
        }
        expect(raw.shapeCount).toBe(baselineShapeCount);
      }

      const failedConsumer = await evaluator.evaluate(parsed.value, {
        outputs: ["hollow"],
      });
      if (failedConsumer.ok) {
        failedConsumer.value.dispose();
        expect(failedConsumer.ok).toBe(false);
        return;
      }
      expect(failedConsumer.ok).toBe(false);
      const missing = failedConsumer.diagnostics.find(
        (item) => item.code === "TOPOLOGY_MATCH_MISSING",
      );
      expect(missing).toMatchObject({ node: "hollow" });
      expect(missing?.path).toContain("/nodes/hollow/openings");
      expect(raw.shapeCount).toBe(baselineShapeCount);
    } finally {
      capturedDesign?.dispose();
      if (evaluator === undefined) kernel.dispose();
      else evaluator.dispose();
    }
  });
});
