import { describe, expect, it } from "vitest";
import {
  createEvaluator,
  design,
  mm,
  plane,
  vec2,
  type ResolvedProfile,
} from "../src/index.js";
import {
  MANIFOLD_MAX_PROFILE_COORDINATE,
  ManifoldKernel,
} from "../src/manifold-kernel.js";

const UNIT_SQUARE: ResolvedProfile = {
  plane: { plane: "XY", origin: [0, 0, 0] },
  outer: {
    curves: [
      { kind: "line", start: [1, 0], end: [2, 0] },
      { kind: "line", start: [2, 0], end: [2, 1] },
      { kind: "line", start: [2, 1], end: [1, 1] },
      { kind: "line", start: [1, 1], end: [1, 0] },
    ],
  },
  holes: [],
};

type ThrowingStage = "construct" | "extrude" | "revolve";

/**
 * A stand-in Manifold module whose CrossSection throws a raw native value (an
 * exception-pointer number, as the WebAssembly runtime does) at one stage.
 */
function throwingManifoldModule(stage: ThrowingStage) {
  const deletes: number[] = [];
  let created = 0;
  class CrossSection {
    readonly #index: number;
    constructor() {
      if (stage === "construct") throw 107360;
      this.#index = created;
      created += 1;
      deletes[this.#index] = 0;
    }
    extrude(): never {
      throw 108952;
    }
    revolve(): never {
      throw 109504;
    }
    delete(): void {
      deletes[this.#index] = (deletes[this.#index] ?? 0) + 1;
    }
  }
  return {
    module: { CrossSection } as unknown as ConstructorParameters<typeof ManifoldKernel>[0],
    deletes,
    created: () => created,
  };
}

function squarePlate(halfExtent: number) {
  const cad = design("bounded-plate");
  const profile = cad.sketch("plate-profile", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("outline", {
        width: mm(halfExtent * 2),
        height: mm(halfExtent * 2),
        center: vec2(mm(0), mm(0)),
      }),
    ),
  );
  cad.output("plate", cad.extrude("plate", profile, { distance: mm(1) }));
  return cad.build();
}

describe("Manifold profile coordinate ceiling", () => {
  it("evaluates a profile that reaches the documented ceiling", async () => {
    const evaluator = await createEvaluator();
    try {
      const result = await evaluator.evaluate(
        squarePlate(MANIFOLD_MAX_PROFILE_COORDINATE),
      );
      expect(result.ok, JSON.stringify(!result.ok && result.diagnostics)).toBe(true);
      if (!result.ok) return;
      try {
        const volume = result.value.output("plate").measure().volume;
        expect(volume / (4 * MANIFOLD_MAX_PROFILE_COORDINATE ** 2)).toBeCloseTo(1, 6);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects larger profiles with a readable diagnostic instead of a native code", async () => {
    const evaluator = await createEvaluator();
    try {
      for (const halfExtent of [
        MANIFOLD_MAX_PROFILE_COORDINATE * 1.000001,
        5e11,
        1e200,
      ]) {
        const result = await evaluator.evaluate(squarePlate(halfExtent));
        expect(result.ok).toBe(false);
        if (result.ok) {
          result.value.dispose();
          continue;
        }
        const error = result.diagnostics.find((item) => item.severity === "error");
        expect(error?.code).toBe("KERNEL_ERROR");
        expect(error?.node).toBe("plate");
        expect(error?.message).toMatch(
          /Manifold profiles are limited to coordinates within ±10000000000 mm/u,
        );
        expect(error?.message).not.toMatch(/^\d+$/u);
      }
    } finally {
      evaluator.dispose();
    }
  });
});

describe("Manifold native failures", () => {
  const extrudeOptions = {
    distance: 1,
    symmetric: false,
    twist: 0,
    scaleTop: [1, 1] as const,
    divisions: 0,
  };

  it.each([
    ["construct", "extrude", /Manifold cross section failed with a native exception/u],
    ["construct", "revolve", /Manifold cross section failed with a native exception/u],
    ["extrude", "extrude", /Manifold extrude failed with a native exception/u],
    ["revolve", "revolve", /Manifold revolve failed with a native exception/u],
  ] as const)(
    "names the operation when %s throws a raw value during %s",
    (stage, operation, message) => {
      const fake = throwingManifoldModule(stage);
      const kernel = new ManifoldKernel(fake.module);
      let thrown: unknown;
      try {
        if (operation === "extrude") kernel.extrude(UNIT_SQUARE, extrudeOptions);
        else kernel.revolve(UNIT_SQUARE, { angle: Math.PI });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(message);
      // A section is created unless construction itself failed, and the one
      // that was created is released exactly once.
      expect(fake.created()).toBe(stage === "construct" ? 0 : 1);
      expect(fake.deletes).toEqual(stage === "construct" ? [] : [1]);
    },
  );
});
