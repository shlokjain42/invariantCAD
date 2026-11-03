import { describe, expect, it } from "vitest";
import {
  ManifoldKernel,
  createEvaluator,
  createManifoldKernel,
  design,
  mm,
  vec3,
  type KernelShape,
} from "../src/index.js";
import { geometryKernelConformance } from "./kernel-conformance.js";

geometryKernelConformance({
  id: "manifold",
  create: createManifoldKernel,
  relativeTolerance: 1e-7,
  shapeArtifacts: "absent",
});

describe("Manifold mass-property integration", () => {
  it("recenters the emitted Float32 polyhedron before integrating large translations", async () => {
    const kernel = await createManifoldKernel();
    const box = kernel.box!([2, 4, 6], true);
    let translated: KernelShape | undefined;
    try {
      translated = kernel.transform!(box, [
        { kind: "translate", value: [1e8, -2e8, 3e8] },
      ]);
      const measured = kernel.measure(translated);
      expect(measured.volume).toBeCloseTo(48, 10);
      expect(measured.centerOfMass).toEqual([1e8, -2e8, 3e8]);
      expect(measured.inertiaTensor).toEqual([
        [208, 0, 0],
        [0, 160, 0],
        [0, 0, 80],
      ]);
    } finally {
      if (translated !== undefined) kernel.disposeShape(translated);
      kernel.disposeShape(box);
      kernel.dispose();
    }
  });

  it("certifies slender rotated solids against Float32 mesh quantization", async () => {
    const kernel = await createManifoldKernel();
    try {
      const bar = kernel.box!([2, 2, 500], true);
      const rotated = kernel.transform!(bar, [
        {
          kind: "rotate",
          value: [30, 45, 60].map((degrees) => (degrees * Math.PI) / 180) as [
            number,
            number,
            number,
          ],
        },
      ]);
      const measured = kernel.measure(rotated);
      expect(measured.volume).toBeCloseTo(2000, 6);
      for (const coordinate of measured.centerOfMass!) {
        expect(Math.abs(coordinate)).toBeLessThan(1e-3);
      }
      // The trace of the central inertia is invariant under rotation.
      const trace =
        measured.inertiaTensor[0][0] +
        measured.inertiaTensor[1][1] +
        measured.inertiaTensor[2][2];
      const expectedTrace = (2000 * 2 * (2 * 2 + 2 * 2 + 500 * 500)) / 12;
      expect(Math.abs(trace - expectedTrace) / expectedTrace).toBeLessThan(1e-5);
    } finally {
      kernel.dispose();
    }
  });

  it("certifies disconnected results whose small components are far apart", async () => {
    const kernel = await createManifoldKernel();
    try {
      const near = kernel.sphere!(5, 64);
      const far = kernel.transform!(kernel.sphere!(5, 64), [
        { kind: "translate", value: [20000, 0, 0] },
      ]);
      const union = kernel.boolean!("union", near, [far]);
      const single = kernel.measure(near);
      const measured = kernel.measure(union);
      expect(measured.volume).toBeCloseTo(2 * single.volume, 6);
      expect(measured.centerOfMass![0]).toBeCloseTo(10000, 2);
      expect(Math.abs(measured.centerOfMass![1])).toBeLessThan(1e-3);
      expect(Math.abs(measured.centerOfMass![2])).toBeLessThan(1e-3);
    } finally {
      kernel.dispose();
    }
  });

  it("measures an allowed empty evaluation result with finite zero bounds", async () => {
    const evaluator = await createEvaluator();
    try {
      const cad = design("empty-intersection");
      const first = cad.box("first", { size: vec3(mm(1), mm(1), mm(1)) });
      const second = cad.translate(
        "second",
        cad.box("second-box", { size: vec3(mm(1), mm(1), mm(1)) }),
        vec3(mm(5), mm(0), mm(0)),
      );
      cad.output("empty", cad.intersect("empty", first, [second]));
      const result = await evaluator.evaluate(cad.build(), { allowEmpty: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        expect(result.diagnostics.map((item) => item.code)).toContain(
          "EMPTY_RESULT",
        );
        const measured = result.value.output("empty").measure();
        expect(measured.volume).toBe(0);
        expect(measured.boundingBox).toEqual({
          min: [0, 0, 0],
          max: [0, 0, 0],
        });
        expect(measured.tolerance).toBe(0);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });
});

describe("Manifold native handle ownership", () => {
  interface FakeSolid {
    readonly name: string;
    deletions: number;
    translate(value: unknown): FakeSolid;
    scale(value: unknown): FakeSolid;
    delete(): void;
  }

  function fakeKernel(options: { readonly failDeleting?: string } = {}): {
    readonly kernel: ManifoldKernel;
    readonly solids: FakeSolid[];
  } {
    const solids: FakeSolid[] = [];
    const create = (name: string): FakeSolid => {
      const solid: FakeSolid = {
        name,
        deletions: 0,
        translate: () => create(`${name}+translate`),
        scale: () => {
          throw new TypeError("scale failed");
        },
        delete: () => {
          solid.deletions += 1;
          if (name === options.failDeleting) {
            throw new Error(`delete ${name} failed`);
          }
        },
      };
      solids.push(solid);
      return solid;
    };
    let boxes = 0;
    const kernel = new ManifoldKernel({
      Manifold: { cube: () => create(`box${(boxes += 1)}`) },
    } as never);
    return { kernel, solids };
  }

  it("deletes owned transform intermediates when a later operation fails", () => {
    const { kernel, solids } = fakeKernel();
    const box = kernel.box([1, 1, 1], false);
    expect(() =>
      kernel.transform(box, [
        { kind: "translate", value: [1, 0, 0] },
        { kind: "scale", value: [2, 2, 2] },
      ]),
    ).toThrow("scale failed");
    expect(solids.map((solid) => [solid.name, solid.deletions])).toEqual([
      ["box1", 0],
      ["box1+translate", 1],
    ]);
    kernel.dispose();
    expect(solids[0]!.deletions).toBe(1);
  });

  it("releases every live shape before reporting a failed release", () => {
    const { kernel, solids } = fakeKernel({ failDeleting: "box2" });
    kernel.box([1, 1, 1], false);
    kernel.box([1, 1, 1], false);
    kernel.box([1, 1, 1], false);
    expect(() => kernel.dispose()).toThrow("delete box2 failed");
    expect(solids.map((solid) => solid.deletions)).toEqual([1, 1, 1]);
    expect(() => kernel.dispose()).not.toThrow();
    expect(solids.map((solid) => solid.deletions)).toEqual([1, 1, 1]);
  });
});
