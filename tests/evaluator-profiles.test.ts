import { describe, expect, it } from "vitest";
import {
  EVALUATOR_PROFILES,
  EvaluatedSolid,
  createEvaluator,
  createManifoldKernel,
  design,
  inspectEvaluatorProfile,
  mm,
  vec3,
} from "../src/index.js";

function boxDocument() {
  const cad = design("profile-box");
  const box = cad.box("box", {
    size: vec3(mm(10), mm(20), mm(30)),
  });
  cad.output("box", box);
  return cad.build();
}

describe("named evaluator profiles", () => {
  it("publishes a closed profile vocabulary", () => {
    expect(EVALUATOR_PROFILES).toEqual([
      "mesh-preview",
      "mechanical-exact",
    ]);
    expect(Object.isFrozen(EVALUATOR_PROFILES)).toBe(true);
  });

  it("preflights the bundled Manifold runtime as mesh preview only", async () => {
    const kernel = await createManifoldKernel();
    try {
      expect(inspectEvaluatorProfile(kernel, "mesh-preview")).toEqual({
        profile: "mesh-preview",
        compatible: true,
        missing: [],
      });

      const exact = inspectEvaluatorProfile(kernel, "mechanical-exact");
      expect(exact.compatible).toBe(false);
      expect(exact.missing).toEqual(
        expect.arrayContaining([
          "representation:brep",
          "exact:true",
          "nativeImport:step",
          "nativeExport:step",
          "topology:face",
          "topology:snapshot",
        ]),
      );
      expect(Object.isFrozen(exact)).toBe(true);
      expect(Object.isFrozen(exact.missing)).toBe(true);
    } finally {
      kernel.dispose();
    }
  });

  it("creates and gates the mesh-preview profile end to end", async () => {
    const evaluator = await createEvaluator({ profile: "mesh-preview" });
    try {
      expect(
        inspectEvaluatorProfile(evaluator.kernel, "mesh-preview").compatible,
      ).toBe(true);
      const result = await evaluator.evaluate(boxDocument());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        const output = result.value.output("box");
        expect(output).toBeInstanceOf(EvaluatedSolid);
        expect(output.measure().volume).toBeCloseTo(6_000, 6);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("creates and gates the stock mechanical-exact profile end to end", async () => {
    const evaluator = await createEvaluator({ profile: "mechanical-exact" });
    try {
      expect(
        inspectEvaluatorProfile(
          evaluator.kernel,
          "mechanical-exact",
        ).compatible,
      ).toBe(true);
      const result = await evaluator.evaluate(boxDocument());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        const output = result.value.output("box");
        expect(output).toBeInstanceOf(EvaluatedSolid);
        if (!(output instanceof EvaluatedSolid)) {
          throw new Error("Expected an evaluated solid");
        }
        expect(output.measure().volume).toBeCloseTo(6_000, 6);
        const step = output.export("step");
        expect(step).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(step)).toContain(
          "ISO-10303-21",
        );
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects profile/option mismatches before evaluation", async () => {
    await expect(
      createEvaluator({
        profile: "mesh-preview",
        occt: {},
      }),
    ).rejects.toThrow(
      "OCCT options require the 'mechanical-exact' evaluator profile",
    );
    await expect(
      createEvaluator({
        profile: "mechanical-exact",
        manifold: {},
      }),
    ).rejects.toThrow(
      "Manifold options require the 'mesh-preview' evaluator profile",
    );
    await expect(createEvaluator({ occt: {} })).rejects.toThrow(
      "OCCT options require profile: 'mechanical-exact'",
    );
  });

  it("does not dispose a caller-supplied kernel rejected by a profile", async () => {
    const kernel = await createManifoldKernel();
    try {
      await expect(
        createEvaluator({
          profile: "mechanical-exact",
          kernel,
        }),
      ).rejects.toThrow(
        "does not satisfy evaluator profile 'mechanical-exact'",
      );

      const shape = kernel.box!([1, 2, 3], false);
      try {
        expect(kernel.measure(shape).volume).toBeCloseTo(6, 8);
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("rejects unknown runtime profile values", async () => {
    expect(() =>
      inspectEvaluatorProfile(
        {} as never,
        "future-profile" as never,
      ),
    ).toThrow("Unknown evaluator profile 'future-profile'");
    await expect(
      createEvaluator({
        profile: "future-profile" as never,
      }),
    ).rejects.toThrow("Unknown evaluator profile 'future-profile'");
  });
});
