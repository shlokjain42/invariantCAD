import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OcctKernel as RawOcctKernel,
  type ShapeHandle,
} from "occt-wasm";
import {
  KERNEL_BODY_RESULT_CLASSIFICATION_PROTOCOL_VERSION,
  ManifoldKernel,
  createManifoldKernel,
  inspectKernelBodyResultClassificationCapabilities,
  type GeometryKernel,
  type KernelBodyResultClassification,
  type KernelCapabilities,
  type KernelShape,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

const baseCapabilities: KernelCapabilities = {
  protocolVersion: 1,
  representation: "mesh",
  exact: false,
  primitives: [],
  features: [],
  nativeImports: [],
  nativeExports: [],
};

function withEnvelope(value: unknown): KernelCapabilities {
  return {
    ...baseCapabilities,
    bodyResultClassification: value,
  } as unknown as KernelCapabilities;
}

interface BooleanFixtures {
  readonly box: KernelShape;
  readonly overlappingUnion: KernelShape;
  readonly disjointUnion: KernelShape;
  readonly splitSubtraction: KernelShape;
  readonly cavitySubtraction: KernelShape;
  readonly islandInCavity: KernelShape;
  readonly emptyIntersection: KernelShape;
  readonly inputs: readonly KernelShape[];
}

/** Builds the same overlapping, disjoint, split, cavity, and empty Booleans. */
function booleanFixtures(
  kernel: GeometryKernel,
  own: (shape: KernelShape) => KernelShape,
): BooleanFixtures {
  const translated = (shape: KernelShape, value: readonly [number, number, number]) =>
    own(kernel.transform!(shape, [{ kind: "translate", value: [...value] }]));
  const box = own(kernel.box!([2, 2, 2], false));
  const overlapping = translated(box, [1, 0, 0]);
  const far = translated(box, [10, 0, 0]);
  const slab = own(
    kernel.transform!(own(kernel.box!([0.5, 4, 4], false)), [
      { kind: "translate", value: [0.75, -1, -1] },
    ]),
  );
  const outer = own(kernel.box!([20, 20, 20], true));
  const inner = own(kernel.box!([10, 10, 10], true));
  const island = own(kernel.box!([2, 2, 2], true));
  const cavitySubtraction = own(kernel.boolean!("subtract", outer, [inner]));
  return {
    box,
    overlappingUnion: own(kernel.boolean!("union", box, [overlapping])),
    disjointUnion: own(kernel.boolean!("union", box, [far])),
    splitSubtraction: own(kernel.boolean!("subtract", box, [slab])),
    cavitySubtraction,
    islandInCavity: own(
      kernel.boolean!("union", cavitySubtraction, [island]),
    ),
    emptyIntersection: own(kernel.boolean!("intersect", box, [far])),
    inputs: [box, overlapping, far, slab, outer, inner, island],
  };
}

function expectBooleanClassifications(
  kernel: GeometryKernel,
  fixtures: BooleanFixtures,
): void {
  const classify = (shape: KernelShape): KernelBodyResultClassification =>
    kernel.classifyBodyResult!(shape, { feature: "classification" });
  expect(classify(fixtures.box)).toBe("single-body");
  expect(classify(fixtures.overlappingUnion)).toBe("single-body");
  expect(classify(fixtures.disjointUnion)).toBe("multiple-bodies");
  expect(classify(fixtures.splitSubtraction)).toBe("multiple-bodies");
  expect(classify(fixtures.cavitySubtraction)).toBe("single-body");
  expect(classify(fixtures.islandInCavity)).toBe("multiple-bodies");
  expect(classify(fixtures.emptyIntersection)).toBe("non-body-topology");
  for (const input of fixtures.inputs) {
    expect(kernel.status(input).ok).toBe(true);
  }
}

describe("kernel body-result classification capability", () => {
  it("inspects absent and valid protocol-v1 metadata into an isolated snapshot", () => {
    expect(
      inspectKernelBodyResultClassificationCapabilities(baseCapabilities),
    ).toEqual({ status: "absent" });
    expect(
      inspectKernelBodyResultClassificationCapabilities(
        withEnvelope(undefined),
      ),
    ).toEqual({ status: "absent" });

    const envelope = {
      protocolVersion: KERNEL_BODY_RESULT_CLASSIFICATION_PROTOCOL_VERSION,
      futureField: "ignored",
    };
    const capabilities = withEnvelope(envelope);
    const inspection =
      inspectKernelBodyResultClassificationCapabilities(capabilities);
    expect(inspection).toEqual({
      status: "valid",
      capabilities: { protocolVersion: 1 },
    });
    if (inspection.status !== "valid") return;
    expect(Object.isFrozen(inspection.capabilities)).toBe(true);
    envelope.protocolVersion = 2 as never;
    expect(inspection.capabilities.protocolVersion).toBe(1);
    expect(
      inspectKernelBodyResultClassificationCapabilities(capabilities),
    ).toMatchObject({
      status: "malformed",
      reason: "unsupported-protocol-version",
      details: { expectedProtocolVersion: 1, actualProtocolVersion: 2 },
    });
  });

  it("fails closed on malformed, accessor-backed, proxied, and revoked metadata", () => {
    for (const [value, reason] of [
      [null, "not-object"],
      [[], "not-object"],
      ["v1", "not-object"],
      [{}, "unsupported-protocol-version"],
      [{ protocolVersion: 2 }, "unsupported-protocol-version"],
      [{ protocolVersion: "1" }, "unsupported-protocol-version"],
    ] as const) {
      expect(
        inspectKernelBodyResultClassificationCapabilities(withEnvelope(value)),
      ).toMatchObject({ status: "malformed", reason });
    }

    let accessorCalls = 0;
    const accessorEnvelope = {};
    Object.defineProperty(accessorEnvelope, "protocolVersion", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return 1;
      },
    });
    const accessorCapabilities = { ...baseCapabilities };
    Object.defineProperty(accessorCapabilities, "bodyResultClassification", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return { protocolVersion: 1 };
      },
    });
    const throwingProxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("must not escape");
        },
      },
    );
    const revoked = Proxy.revocable({ protocolVersion: 1 }, {});
    revoked.revoke();
    const revokedCapabilities = Proxy.revocable({ ...baseCapabilities }, {});
    revokedCapabilities.revoke();

    for (const capabilities of [
      withEnvelope(accessorEnvelope),
      accessorCapabilities,
      withEnvelope(throwingProxy),
      withEnvelope(revoked.proxy),
      revokedCapabilities.proxy,
    ]) {
      expect(
        inspectKernelBodyResultClassificationCapabilities(
          capabilities as KernelCapabilities,
        ),
      ).toMatchObject({
        status: "malformed",
        reason: "uninspectable-metadata",
      });
    }
    expect(accessorCalls).toBe(0);
  });
});

describe("Manifold body-result classification", () => {
  it("classifies connected components of the approximate mesh", async () => {
    const kernel = await createManifoldKernel();
    const shapes: KernelShape[] = [];
    const own = (shape: KernelShape): KernelShape => {
      shapes.push(shape);
      return shape;
    };
    try {
      expect(
        inspectKernelBodyResultClassificationCapabilities(kernel.capabilities),
      ).toEqual({
        status: "valid",
        capabilities: {
          protocolVersion: KERNEL_BODY_RESULT_CLASSIFICATION_PROTOCOL_VERSION,
        },
      });
      expect(kernel.capabilities).toMatchObject({
        representation: "mesh",
        exact: false,
      });
      const fixtures = booleanFixtures(kernel, own);
      expectBooleanClassifications(kernel, fixtures);
      expect(kernel.classifyBodyResult!(fixtures.box)).toBe("single-body");

      // Mesh connectivity is the classified representation: edge contact
      // remains two components in Manifold.
      const edgeTouching = own(
        kernel.transform!(fixtures.box, [
          { kind: "translate", value: [2, 2, 0] },
        ]),
      );
      expect(
        kernel.classifyBodyResult!(
          own(kernel.boolean!("union", fixtures.box, [edgeTouching])),
        ),
      ).toBe("multiple-bodies");
    } finally {
      for (let index = shapes.length - 1; index >= 0; index -= 1) {
        kernel.disposeShape(shapes[index]!);
      }
      kernel.dispose();
    }
  });

  function fakeManifold(
    volumes: readonly number[],
    hooks: {
      readonly onVolume?: (index: number) => void;
      readonly throwOnDeleteIndex?: number;
    } = {},
  ): {
    readonly kernel: ManifoldKernel;
    readonly shape: KernelShape;
    readonly deletions: number[];
    readonly decompositions: () => number;
  } {
    const deletions = volumes.map(() => 0);
    let decompositions = 0;
    const components = volumes.map((volume, index) => ({
      volume: () => {
        hooks.onVolume?.(index);
        return volume;
      },
      delete: () => {
        deletions[index]! += 1;
        if (index === hooks.throwOnDeleteIndex) {
          throw new Error("component cleanup failed");
        }
      },
    }));
    const solid = {
      decompose: () => {
        decompositions += 1;
        return components;
      },
      delete: () => {},
    };
    const kernel = new ManifoldKernel({
      Manifold: { cube: () => solid },
    } as never);
    return {
      kernel,
      shape: kernel.box([1, 1, 1], false),
      deletions,
      decompositions: () => decompositions,
    };
  }

  it("ignores negative cavity boundaries and deletes every component", () => {
    for (const [volumes, expected] of [
      [[8], "single-body"],
      [[8000, -1000], "single-body"],
      [[8000, -1000, 8], "multiple-bodies"],
      [[8, 8], "multiple-bodies"],
      [[], "non-body-topology"],
      [[-8], "non-body-topology"],
      [[8, 0], "non-body-topology"],
    ] as const) {
      const fake = fakeManifold(volumes);
      try {
        expect(fake.kernel.classifyBodyResult(fake.shape)).toBe(expected);
        expect(fake.deletions).toEqual(volumes.map(() => 1));
      } finally {
        fake.kernel.dispose();
      }
    }
  });

  it("deletes every component when classification or cleanup fails", () => {
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const fake = fakeManifold([8, invalid, 8]);
      try {
        expect(() => fake.kernel.classifyBodyResult(fake.shape)).toThrow(
          "invalid connected-component volume",
        );
        expect(fake.deletions).toEqual([1, 1, 1]);
      } finally {
        fake.kernel.dispose();
      }
    }

    const cleanup = fakeManifold([8, 8, 8], { throwOnDeleteIndex: 1 });
    try {
      expect(() => cleanup.kernel.classifyBodyResult(cleanup.shape)).toThrow(
        "component cleanup failed",
      );
      expect(cleanup.deletions).toEqual([1, 1, 1]);
    } finally {
      cleanup.kernel.dispose();
    }
  });

  it("checks cancellation before decomposition and after component work", () => {
    const aborted = new AbortController();
    aborted.abort();
    const before = fakeManifold([8]);
    try {
      expect(() =>
        before.kernel.classifyBodyResult(before.shape, {
          signal: aborted.signal,
        }),
      ).toThrow(expect.objectContaining({ name: "AbortError" }));
      expect(before.decompositions()).toBe(0);
    } finally {
      before.kernel.dispose();
    }

    const controller = new AbortController();
    const during = fakeManifold([8, 8, 8], {
      onVolume: (index) => {
        if (index === 0) controller.abort();
      },
    });
    try {
      expect(() =>
        during.kernel.classifyBodyResult(during.shape, {
          signal: controller.signal,
        }),
      ).toThrow(expect.objectContaining({ name: "AbortError" }));
      expect(during.decompositions()).toBe(1);
      expect(during.deletions).toEqual([1, 1, 1]);
    } finally {
      during.kernel.dispose();
    }
  });

  it("rejects hostile contexts and foreign shapes without decomposing", () => {
    const fake = fakeManifold([8]);
    try {
      let signalReads = 0;
      const context = {};
      Object.defineProperty(context, "signal", {
        enumerable: true,
        get() {
          signalReads += 1;
          return undefined;
        },
      });
      expect(() =>
        fake.kernel.classifyBodyResult(fake.shape, context),
      ).toThrow(TypeError);
      expect(() =>
        fake.kernel.classifyBodyResult(fake.shape, {
          signal: {} as AbortSignal,
        }),
      ).toThrow(TypeError);
      expect(() =>
        fake.kernel.classifyBodyResult({ kernel: "manifold" }),
      ).toThrow("Expected a live Manifold kernel shape");
      expect(signalReads).toBe(0);
      expect(fake.decompositions()).toBe(0);
    } finally {
      fake.kernel.dispose();
    }
  });
});

describe("stock OCCT body-result classification", () => {
  interface OcctWrapperFixtures {
    readonly nested: string;
    readonly multiple: string;
    readonly repeated: string;
    readonly loose: string;
    readonly faceOnly: string;
    readonly emptyCompound: string;
    readonly singleCompsolid: string;
    readonly multipleCompsolid: string;
  }

  let wrappers: OcctWrapperFixtures;
  let kernel: GeometryKernel;

  function raw(): RawOcctKernel {
    return (kernel as unknown as { readonly raw: RawOcctKernel }).raw;
  }

  function liveShapeCount(): number {
    return (
      kernel as unknown as { readonly liveShapes: ReadonlySet<unknown> }
    ).liveShapes.size;
  }

  beforeAll(async () => {
    const fixtureKernel = await RawOcctKernel.init();
    const owned: ShapeHandle[] = [];
    const own = (handle: ShapeHandle): ShapeHandle => {
      owned.push(handle);
      return handle;
    };
    let faces: ShapeHandle[] = [];
    try {
      const box = own(fixtureKernel.makeBox(2, 3, 4));
      const translated = own(fixtureKernel.translate(box, 10, 0, 0));
      const inner = own(fixtureKernel.makeCompound([box]));
      faces = fixtureKernel.getSubShapes(translated, "face");
      // occt-wasm exposes no compsolid constructor; rewrite only the root
      // compound's BREP type code and require OCCT to read it back as such.
      const compsolid = (brep: string): string => {
        const rewritten = brep.replace(/\nCo\n(?![\s\S]*\nCo\n)/u, "\nCS\n");
        if (rewritten === brep) {
          throw new Error("BREP compound fixture has no root type code");
        }
        const parsed = own(fixtureKernel.fromBREP(rewritten));
        if (fixtureKernel.getShapeType(parsed) !== "compsolid") {
          throw new Error("BREP compsolid fixture was not read as compsolid");
        }
        return rewritten;
      };
      wrappers = {
        singleCompsolid: compsolid(fixtureKernel.toBREP(inner)),
        multipleCompsolid: compsolid(
          fixtureKernel.toBREP(
            own(fixtureKernel.makeCompound([box, translated])),
          ),
        ),
        nested: fixtureKernel.toBREP(own(fixtureKernel.makeCompound([inner]))),
        multiple: fixtureKernel.toBREP(
          own(fixtureKernel.makeCompound([box, translated])),
        ),
        repeated: fixtureKernel.toBREP(
          own(fixtureKernel.makeCompound([box, box])),
        ),
        loose: fixtureKernel.toBREP(
          own(fixtureKernel.makeCompound([box, faces[0]!])),
        ),
        faceOnly: fixtureKernel.toBREP(faces[0]!),
        emptyCompound: fixtureKernel.toBREP(
          own(fixtureKernel.makeCompound([])),
        ),
      };
    } finally {
      for (let index = faces.length - 1; index >= 0; index -= 1) {
        fixtureKernel.release(faces[index]!);
      }
      for (let index = owned.length - 1; index >= 0; index -= 1) {
        fixtureKernel.release(owned[index]!);
      }
      fixtureKernel[Symbol.dispose]();
    }
    kernel = await createOcctKernel();
  }, 30_000);

  afterAll(() => {
    kernel.dispose();
  });

  it("classifies exact Boolean B-Rep contents and restores the native baseline", () => {
    expect(
      inspectKernelBodyResultClassificationCapabilities(kernel.capabilities),
    ).toEqual({
      status: "valid",
      capabilities: {
        protocolVersion: KERNEL_BODY_RESULT_CLASSIFICATION_PROTOCOL_VERSION,
      },
    });
    expect(kernel.capabilities).toMatchObject({
      representation: "brep",
      exact: true,
    });
    const liveBefore = liveShapeCount();
    const shapes: KernelShape[] = [];
    const own = (shape: KernelShape): KernelShape => {
      shapes.push(shape);
      return shape;
    };
    try {
      const fixtures = booleanFixtures(kernel, own);
      const nativeBefore = raw().shapeCount;
      expectBooleanClassifications(kernel, fixtures);
      expect(raw().shapeCount).toBe(nativeBefore);
    } finally {
      for (let index = shapes.length - 1; index >= 0; index -= 1) {
        kernel.disposeShape(shapes[index]!);
      }
    }
    expect(liveShapeCount()).toBe(liveBefore);
  });

  it("admits one-solid wrappers and rejects multiple or loose exact topology", () => {
    const encoder = new TextEncoder();
    for (const [brep, expected] of [
      [wrappers.nested, "single-body"],
      [wrappers.multiple, "multiple-bodies"],
      [wrappers.repeated, "multiple-bodies"],
      [wrappers.loose, "non-body-topology"],
      [wrappers.faceOnly, "non-body-topology"],
      [wrappers.emptyCompound, "non-body-topology"],
      [wrappers.singleCompsolid, "single-body"],
      [wrappers.multipleCompsolid, "multiple-bodies"],
    ] as const) {
      const imported = kernel.importShape!(encoder.encode(brep), "brep");
      try {
        const nativeBefore = raw().shapeCount;
        expect(kernel.classifyBodyResult!(imported)).toBe(expected);
        expect(raw().shapeCount).toBe(nativeBefore);
      } finally {
        kernel.disposeShape(imported);
      }
    }
  });

  it("releases every traversal handle on success, failure, and cancellation", () => {
    const imported = kernel.importShape!(
      new TextEncoder().encode(wrappers.multiple),
      "brep",
    );
    const native = raw();
    const acquired: ShapeHandle[] = [];
    const released: ShapeHandle[] = [];
    const iterShapes = native.iterShapes.bind(native);
    const release = native.release.bind(native);
    const getShapeType = native.getShapeType.bind(native);
    const iterSpy = vi
      .spyOn(native, "iterShapes")
      .mockImplementation((handle) => {
        const children = iterShapes(handle);
        acquired.push(...children);
        return children;
      });
    const releaseSpy = vi
      .spyOn(native, "release")
      .mockImplementation((handle) => {
        released.push(handle);
        release(handle);
      });
    const expectBalanced = (): void => {
      expect(acquired.length).toBeGreaterThan(0);
      expect([...released].sort()).toEqual([...acquired].sort());
      acquired.length = 0;
      released.length = 0;
    };
    try {
      const nativeBefore = native.shapeCount;
      expect(kernel.classifyBodyResult!(imported)).toBe("multiple-bodies");
      expectBalanced();

      let typeCalls = 0;
      const typeSpy = vi
        .spyOn(native, "getShapeType")
        .mockImplementation((handle) => {
          typeCalls += 1;
          if (typeCalls === 2) throw new Error("native traversal failed");
          return getShapeType(handle);
        });
      expect(() => kernel.classifyBodyResult!(imported)).toThrow(
        "native traversal failed",
      );
      expectBalanced();

      const controller = new AbortController();
      typeCalls = 0;
      typeSpy.mockImplementation((handle) => {
        typeCalls += 1;
        if (typeCalls === 2) controller.abort();
        return getShapeType(handle);
      });
      expect(() =>
        kernel.classifyBodyResult!(imported, { signal: controller.signal }),
      ).toThrow(expect.objectContaining({ name: "AbortError" }));
      expectBalanced();
      typeSpy.mockRestore();

      expect(native.shapeCount).toBe(nativeBefore);
      expect(kernel.status(imported)).toEqual({ ok: true, code: "VALID" });
    } finally {
      iterSpy.mockRestore();
      releaseSpy.mockRestore();
      kernel.disposeShape(imported);
    }
  });

  it("charges queued wrapper children against the occurrence limit", () => {
    const native = raw();
    const owned = kernel as unknown as {
      own(handle: ShapeHandle): KernelShape;
    };
    const box = native.makeBox(1, 1, 1);
    try {
      // The root plus 1,000,000 queued children is exactly one occurrence
      // over the limit; the admitted case keeps full traversal affordable.
      for (const [children, admitted] of [
        [10_000, true],
        [1_000_000, false],
      ] as const) {
        const wide = owned.own(
          native.makeCompound(new Array<ShapeHandle>(children).fill(box)),
        );
        try {
          const nativeBefore = native.shapeCount;
          if (admitted) {
            expect(kernel.classifyBodyResult!(wide)).toBe("multiple-bodies");
          } else {
            expect(() => kernel.classifyBodyResult!(wide)).toThrow(
              "OCCT body classification exceeded its occurrence limit",
            );
          }
          expect(native.shapeCount).toBe(nativeBefore);
        } finally {
          kernel.disposeShape(wide);
        }
      }
      const probe = kernel.box!([1, 1, 1], false);
      try {
        expect(kernel.classifyBodyResult!(probe)).toBe("single-body");
      } finally {
        kernel.disposeShape(probe);
      }
    } finally {
      native.release(box);
    }
  }, 30_000);

  it("rejects pre-aborted, hostile, and foreign inputs before traversal", () => {
    const shape = kernel.box!([1, 1, 1], false);
    const native = raw();
    const iterSpy = vi.spyOn(native, "iterShapes");
    try {
      const controller = new AbortController();
      controller.abort();
      expect(() =>
        kernel.classifyBodyResult!(shape, { signal: controller.signal }),
      ).toThrow(expect.objectContaining({ name: "AbortError" }));
      let signalReads = 0;
      const context = {};
      Object.defineProperty(context, "signal", {
        enumerable: true,
        get() {
          signalReads += 1;
          return undefined;
        },
      });
      expect(() => kernel.classifyBodyResult!(shape, context)).toThrow(
        TypeError,
      );
      expect(() =>
        kernel.classifyBodyResult!({ kernel: "occt" }),
      ).toThrow(TypeError);
      expect(signalReads).toBe(0);
      expect(iterSpy).not.toHaveBeenCalled();
    } finally {
      iterSpy.mockRestore();
      kernel.disposeShape(shape);
    }
  });
});
