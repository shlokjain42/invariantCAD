import { describe, expect, it } from "vitest";
import type { Vec3 } from "../src/core/math.js";
import type { InertiaTensor, VolumetricMassProperties } from "../src/kernel.js";
import {
  combinePhysicalMassProperties,
  inertiaTensorAboutPoint,
  momentOfInertiaAboutAxis,
  physicalMassProperties,
  principalInertia,
  principalRadiiOfGyration,
  radiusOfGyrationAboutAxis,
  worldRadiiOfGyration,
  type PhysicalMassProperties,
  type PrincipalAxes,
} from "../src/mass-properties.js";

const ZERO_TENSOR: InertiaTensor = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];

const BOX: VolumetricMassProperties = {
  volume: 48,
  centerOfMass: [1, 2, 3],
  inertiaTensor: [
    [208, 0, 0],
    [0, 160, 0],
    [0, 0, 80],
  ],
};

const EMPTY: VolumetricMassProperties = {
  volume: 0,
  centerOfMass: null,
  inertiaTensor: ZERO_TENSOR,
};

function expectClose(
  actual: number,
  expected: number,
  relativeTolerance = 2e-12,
  absoluteTolerance = 2e-12,
): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    Math.max(absoluteTolerance, Math.abs(expected) * relativeTolerance),
  );
}

function expectVectorClose(
  actual: Vec3,
  expected: Vec3,
  relativeTolerance = 2e-12,
  absoluteTolerance = 2e-12,
): void {
  for (let axis = 0; axis < 3; axis += 1) {
    expectClose(
      actual[axis]!,
      expected[axis]!,
      relativeTolerance,
      absoluteTolerance,
    );
  }
}

function expectTensorClose(
  actual: InertiaTensor,
  expected: InertiaTensor,
  relativeTolerance = 2e-12,
  absoluteTolerance = 2e-12,
): void {
  for (let row = 0; row < 3; row += 1) {
    expectVectorClose(
      actual[row]!,
      expected[row]!,
      relativeTolerance,
      absoluteTolerance,
    );
  }
}

function dot(first: Vec3, second: Vec3): number {
  return (
    first[0] * second[0] +
    first[1] * second[1] +
    first[2] * second[2]
  );
}

function cross(first: Vec3, second: Vec3): Vec3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function matrixVector(tensor: InertiaTensor, vector: Vec3): Vec3 {
  return tensor.map((row) => dot(row, vector)) as unknown as Vec3;
}

function tensorFromPrincipal(
  moments: Vec3,
  axes: PrincipalAxes,
): InertiaTensor {
  const rows = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let principal = 0; principal < 3; principal += 1) {
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        rows[row]![column] =
          rows[row]![column]! +
          moments[principal]! *
          axes[principal]![row]! *
          axes[principal]![column]!;
      }
    }
  }
  return rows as unknown as InertiaTensor;
}

function quadratic(tensor: InertiaTensor, direction: Vec3): number {
  const length = Math.hypot(...direction);
  const unit: Vec3 = [
    direction[0] / length,
    direction[1] / length,
    direction[2] / length,
  ];
  return dot(unit, matrixVector(tensor, unit));
}

function dominantComponent(vector: Vec3): number {
  let dominant = 0;
  for (let axis = 1; axis < 3; axis += 1) {
    if (Math.abs(vector[axis]!) > Math.abs(vector[dominant]!)) dominant = axis;
  }
  return dominant;
}

function frozenBox(): VolumetricMassProperties {
  const center = Object.freeze([1, 2, 3]) as Vec3;
  const inertia = Object.freeze([
    Object.freeze([208, 0, 0]),
    Object.freeze([0, 160, 0]),
    Object.freeze([0, 0, 80]),
  ]) as InertiaTensor;
  return Object.freeze({ volume: 48, centerOfMass: center, inertiaTensor: inertia });
}

describe("public principal-inertia analysis", () => {
  it("sorts exact moments and returns a canonical right-handed frame", () => {
    const result = principalInertia([
      [3, 0, 0],
      [0, 4, 0],
      [0, 0, 5],
    ]);

    expect(result).toEqual({
      moments: [3, 4, 5],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      axisStatus: ["unique", "unique", "unique"],
      degeneracy: "distinct",
    });
  });

  it("diagonalizes a rotated asymmetric tensor deterministically", () => {
    const rootTwo = Math.sqrt(2);
    const rootThree = Math.sqrt(3);
    const rootSix = Math.sqrt(6);
    const authoredAxes: PrincipalAxes = [
      [1 / rootTwo, 1 / rootTwo, 0],
      [-1 / rootSix, 1 / rootSix, 2 / rootSix],
      [1 / rootThree, -1 / rootThree, 1 / rootThree],
    ];
    const tensor = tensorFromPrincipal([5, 8, 11], authoredAxes);
    const snapshot = JSON.stringify(tensor);
    const result = principalInertia(tensor);

    expectVectorClose(result.moments, [5, 8, 11], 4e-12, 4e-12);
    expect(result.degeneracy).toBe("distinct");
    expect(result.axisStatus).toEqual(["unique", "unique", "unique"]);
    expect(principalInertia(tensor)).toEqual(result);
    expect(JSON.stringify(tensor)).toBe(snapshot);

    for (let index = 0; index < 3; index += 1) {
      const axis = result.axes[index]!;
      expectClose(dot(axis, axis), 1);
      expectVectorClose(
        matrixVector(tensor, axis),
        axis.map((value) => value * result.moments[index]!) as unknown as Vec3,
        8e-12,
        8e-12,
      );
    }
    expectClose(dot(result.axes[0], result.axes[1]), 0);
    expectClose(dot(result.axes[0], result.axes[2]), 0);
    expectClose(dot(result.axes[1], result.axes[2]), 0);
    expect(dot(cross(result.axes[0], result.axes[1]), result.axes[2])).toBeGreaterThan(
      1 - 2e-12,
    );
    expect(result.axes[0][dominantComponent(result.axes[0])]!).toBeGreaterThanOrEqual(0);
    expect(result.axes[1][dominantComponent(result.axes[1])]!).toBeGreaterThanOrEqual(0);
  });

  it("reports repeated eigenspaces without pretending their axes are unique", () => {
    expect(
      principalInertia([
        [4, 0, 0],
        [0, 4, 0],
        [0, 0, 7],
      ]),
    ).toMatchObject({
      moments: [4, 4, 7],
      axisStatus: ["degenerate", "degenerate", "unique"],
      degeneracy: "minimum-repeated",
    });
    expect(
      principalInertia([
        [3, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ]),
    ).toMatchObject({
      moments: [3, 5, 5],
      axisStatus: ["unique", "degenerate", "degenerate"],
      degeneracy: "maximum-repeated",
    });
    expect(
      principalInertia([
        [6, 0, 0],
        [0, 6, 0],
        [0, 0, 6],
      ]),
    ).toMatchObject({
      moments: [6, 6, 6],
      axisStatus: ["degenerate", "degenerate", "degenerate"],
      degeneracy: "isotropic",
    });
    expect(principalInertia(ZERO_TENSOR)).toEqual({
      moments: [0, 0, 0],
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      axisStatus: ["degenerate", "degenerate", "degenerate"],
      degeneracy: "isotropic",
    });
  });

  it("uses degeneracy tolerances only for classification", () => {
    const tensor: InertiaTensor = [
      [4, 0, 0],
      [0, 4 + 5e-10, 0],
      [0, 0, 7],
    ];
    const strict = principalInertia(tensor);
    const loose = principalInertia(tensor, {
      relativeDegeneracyTolerance: 1e-9,
    });

    expect(strict.degeneracy).toBe("distinct");
    expect(loose.degeneracy).toBe("minimum-repeated");
    expect(loose.axisStatus).toEqual(["degenerate", "degenerate", "unique"]);
    expect(loose.moments).toEqual(strict.moments);
    expect(loose.axes).toEqual(strict.axes);
  });

  it("requires the full principal span to classify a tensor as isotropic", () => {
    const result = principalInertia([
      [1, 0, 0],
      [0, 1 + 0.8e-12, 0],
      [0, 0, 1 + 1.7e-12],
    ]);

    expect(result.degeneracy).toBe("minimum-repeated");
    expect(result.axisStatus).toEqual(["degenerate", "degenerate", "unique"]);
  });

  it("preserves symmetric subnormal off-diagonal entries", () => {
    const minimum = Number.MIN_VALUE;
    const result = principalInertia([
      [minimum, minimum, 0],
      [minimum, minimum, 0],
      [0, 0, minimum * 2],
    ]);

    expect(result.moments).toEqual([0, minimum * 2, minimum * 2]);
    expect(result.degeneracy).toBe("maximum-repeated");
  });
});

describe("public point and axis inertia analysis", () => {
  it("applies the full parallel-axis theorem about an arbitrary point", () => {
    expectTensorClose(inertiaTensorAboutPoint(BOX, [0, 0, 0]), [
      [832, -96, -144],
      [-96, 640, -288],
      [-144, -288, 320],
    ]);
    expectTensorClose(
      inertiaTensorAboutPoint(BOX, BOX.centerOfMass!),
      BOX.inertiaTensor,
    );
  });

  it("computes centroidal, offset, and arbitrary-direction axis moments", () => {
    expectClose(
      momentOfInertiaAboutAxis(BOX, {
        point: BOX.centerOfMass!,
        direction: [0, 0, 7],
      }),
      80,
    );
    const offsetAxis = { point: [0, 0, 0], direction: [0, 0, 1] } as const;
    expectClose(momentOfInertiaAboutAxis(BOX, offsetAxis), 320);
    expectClose(
      momentOfInertiaAboutAxis(BOX, {
        point: offsetAxis.point,
        direction: [0, 0, -1000],
      }),
      320,
    );

    const point: Vec3 = [4, -1, 2];
    const direction: Vec3 = [2, -3, 4];
    expectClose(
      momentOfInertiaAboutAxis(BOX, { point, direction }),
      quadratic(inertiaTensorAboutPoint(BOX, point), direction),
      4e-12,
      4e-12,
    );
  });

  it("keeps line inertia invariant when the body and line translate together", () => {
    const displacement: Vec3 = [1e6, -2e6, 3e6];
    const translated: VolumetricMassProperties = {
      ...BOX,
      centerOfMass: [
        BOX.centerOfMass![0] + displacement[0],
        BOX.centerOfMass![1] + displacement[1],
        BOX.centerOfMass![2] + displacement[2],
      ],
    };
    const axis = { point: [9, -4, 2], direction: [2, 3, -5] } as const;
    const translatedAxis = {
      point: [
        axis.point[0] + displacement[0],
        axis.point[1] + displacement[1],
        axis.point[2] + displacement[2],
      ] as Vec3,
      direction: axis.direction,
    };

    expectClose(
      momentOfInertiaAboutAxis(translated, translatedAxis),
      momentOfInertiaAboutAxis(BOX, axis),
      2e-11,
      2e-11,
    );
  });

  it("returns world, principal, and arbitrary-axis radii in length units", () => {
    expectVectorClose(worldRadiiOfGyration(BOX)!, [
      Math.sqrt(13 / 3),
      Math.sqrt(10 / 3),
      Math.sqrt(5 / 3),
    ]);
    expectVectorClose(principalRadiiOfGyration(BOX)!, [
      Math.sqrt(5 / 3),
      Math.sqrt(10 / 3),
      Math.sqrt(13 / 3),
    ]);
    expectClose(
      radiusOfGyrationAboutAxis(BOX, {
        point: [0, 0, 0],
        direction: [0, 0, 1],
      })!,
      Math.sqrt(20 / 3),
    );
  });

  it("preserves representable radii across extreme finite ratios", () => {
    const hugeRadius: PhysicalMassProperties = {
      mass: 1e-308,
      centerOfMass: [0, 0, 0],
      inertiaTensor: [
        [1e308, 0, 0],
        [0, 1e308, 0],
        [0, 0, 1e308],
      ],
    };
    const tinyRadius: PhysicalMassProperties = {
      mass: 1e308,
      centerOfMass: [0, 0, 0],
      inertiaTensor: [
        [1e-308, 0, 0],
        [0, 1e-308, 0],
        [0, 0, 1e-308],
      ],
    };

    expectVectorClose(worldRadiiOfGyration(hugeRadius)!, [1e308, 1e308, 1e308]);
    expectVectorClose(principalRadiiOfGyration(hugeRadius)!, [
      1e308,
      1e308,
      1e308,
    ]);
    expectClose(
      radiusOfGyrationAboutAxis(hugeRadius, {
        point: [0, 0, 0],
        direction: [1, 0, 0],
      })!,
      1e308,
    );
    expectVectorClose(worldRadiiOfGyration(tinyRadius)!, [
      1e-308,
      1e-308,
      1e-308,
    ], 2e-12, 0);
    expectVectorClose(principalRadiiOfGyration(tinyRadius)!, [
      1e-308,
      1e-308,
      1e-308,
    ], 2e-12, 0);
    expectClose(
      radiusOfGyrationAboutAxis(tinyRadius, {
        point: [0, 0, 0],
        direction: [1, 0, 0],
      })!,
      1e-308,
      2e-12,
      0,
    );
  });

  it("clamps only scale-relative negative roundoff in axis queries", () => {
    const roundoff: VolumetricMassProperties = {
      volume: 1,
      centerOfMass: [0, 0, 0],
      inertiaTensor: [
        [-1e-15, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    };

    expect(worldRadiiOfGyration(roundoff)).toEqual([0, 1, 1]);
    expect(
      momentOfInertiaAboutAxis(roundoff, {
        point: [0, 0, 0],
        direction: [1, 0, 0],
      }),
    ).toBe(0);
  });
});

describe("physical density and aggregation", () => {
  it("scales mass and inertia by density while leaving centers and radii invariant", () => {
    const density = 7.85e-6;
    const physical = physicalMassProperties(BOX, density);

    expectClose(physical.mass, BOX.volume * density, 2e-12, 1e-15);
    expect(physical.centerOfMass).toEqual(BOX.centerOfMass);
    expectTensorClose(physical.inertiaTensor, [
      [208 * density, 0, 0],
      [0, 160 * density, 0],
      [0, 0, 80 * density],
    ], 2e-12, 1e-15);
    expectVectorClose(worldRadiiOfGyration(physical)!, worldRadiiOfGyration(BOX)!);
    expectVectorClose(
      principalRadiiOfGyration(physical)!,
      principalRadiiOfGyration(BOX)!,
    );
    const axis = { point: [0, 0, 0], direction: [0, 0, 1] } as const;
    expectClose(
      momentOfInertiaAboutAxis(physical, axis),
      momentOfInertiaAboutAxis(BOX, axis) * density,
      2e-12,
      1e-15,
    );
    expectClose(
      radiusOfGyrationAboutAxis(physical, axis)!,
      radiusOfGyrationAboutAxis(BOX, axis)!,
    );
  });

  it("combines unequal physical bodies with mass weighting and parallel-axis shifts", () => {
    const first: PhysicalMassProperties = {
      mass: 2,
      centerOfMass: [0, 0, 0],
      inertiaTensor: [
        [1, 0, 0],
        [0, 2, 0],
        [0, 0, 3],
      ],
    };
    const second: PhysicalMassProperties = {
      mass: 3,
      centerOfMass: [4, 0, 0],
      inertiaTensor: [
        [4, 0, 0],
        [0, 5, 0],
        [0, 0, 6],
      ],
    };
    const empty: PhysicalMassProperties = {
      mass: 0,
      centerOfMass: null,
      inertiaTensor: ZERO_TENSOR,
    };
    const result = combinePhysicalMassProperties([empty, first, second]);

    expectClose(result.mass, 5);
    expectVectorClose(result.centerOfMass!, [2.4, 0, 0]);
    expectTensorClose(result.inertiaTensor, [
      [5, 0, 0],
      [0, 26.2, 0],
      [0, 0, 28.2],
    ]);
    const reversed = combinePhysicalMassProperties([second, first]);
    expectClose(reversed.mass, result.mass);
    expectVectorClose(reversed.centerOfMass!, result.centerOfMass!);
    expectTensorClose(reversed.inertiaTensor, result.inertiaTensor);
  });
});

describe("empty, validation, and immutability boundaries", () => {
  it("uses canonical empty values and null radii", () => {
    expect(physicalMassProperties(EMPTY, 1)).toEqual({
      mass: 0,
      centerOfMass: null,
      inertiaTensor: ZERO_TENSOR,
    });
    expect(combinePhysicalMassProperties([])).toEqual({
      mass: 0,
      centerOfMass: null,
      inertiaTensor: ZERO_TENSOR,
    });
    expect(inertiaTensorAboutPoint(EMPTY, [3, 4, 5])).toEqual(ZERO_TENSOR);
    expect(
      momentOfInertiaAboutAxis(EMPTY, {
        point: [3, 4, 5],
        direction: [1, 0, 0],
      }),
    ).toBe(0);
    expect(worldRadiiOfGyration(EMPTY)).toBeNull();
    expect(principalRadiiOfGyration(EMPTY)).toBeNull();
    expect(
      radiusOfGyrationAboutAxis(EMPTY, {
        point: [0, 0, 0],
        direction: [1, 0, 0],
      }),
    ).toBeNull();
  });

  it("rejects malformed, asymmetric, nonphysical, and invalid-option tensors", () => {
    expect(() =>
      principalInertia([[1, 0, 0], [0, 1, 0]] as unknown as InertiaTensor),
    ).toThrowError(/finite 3x3 matrix/i);
    expect(() =>
      principalInertia([
        [1, Number.NaN, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    ).toThrowError(/finite 3x3 matrix/i);
    expect(() =>
      principalInertia([
        [2, 0.1, 0],
        [0, 2, 0],
        [0, 0, 3],
      ]),
    ).toThrowError(/must be symmetric/i);
    expect(() =>
      principalInertia([
        [-1, 0, 0],
        [0, 2, 0],
        [0, 0, 2],
      ]),
    ).toThrowError(/positive semidefinite/i);
    expect(() =>
      principalInertia([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 3],
      ]),
    ).toThrowError(/triangle inequality/i);
    expect(() =>
      principalInertia(ZERO_TENSOR, { relativeDegeneracyTolerance: -1 }),
    ).toThrowError(/relative degeneracy tolerance/i);
    expect(() =>
      principalInertia(ZERO_TENSOR, {
        absoluteDegeneracyTolerance: Number.POSITIVE_INFINITY,
      }),
    ).toThrowError(/absolute degeneracy tolerance/i);
  });

  it("rejects inconsistent properties, densities, reference points, and axes", () => {
    expect(() => physicalMassProperties(BOX, 0)).toThrowError(/strictly positive/i);
    expect(() => physicalMassProperties(BOX, Number.NaN)).toThrowError(
      /strictly positive/i,
    );
    expect(() =>
      physicalMassProperties({ ...BOX, volume: -1 }, 1),
    ).toThrowError(/finite and non-negative/i);
    expect(() =>
      physicalMassProperties({ ...BOX, centerOfMass: null }, 1),
    ).toThrowError(/center must be finite exactly/i);
    expect(() =>
      physicalMassProperties({ ...EMPTY, centerOfMass: [0, 0, 0] }, 1),
    ).toThrowError(/center must be finite exactly/i);
    expect(() =>
      physicalMassProperties({ ...EMPTY, inertiaTensor: BOX.inertiaTensor }, 1),
    ).toThrowError(/zero inertia tensor/i);
    expect(() => inertiaTensorAboutPoint(BOX, [0, Number.NaN, 0])).toThrowError(
      /reference point must be finite/i,
    );
    expect(() =>
      momentOfInertiaAboutAxis(BOX, {
        point: [0, 0, 0],
        direction: [0, 0, 0],
      }),
    ).toThrowError(/non-zero and normalizable/i);
    expect(() =>
      momentOfInertiaAboutAxis(BOX, {
        point: [0, Number.POSITIVE_INFINITY, 0],
        direction: [1, 0, 0],
      }),
    ).toThrowError(/axis point must be finite/i);
    expect(() =>
      radiusOfGyrationAboutAxis(BOX, {
        point: [0, 0, 0],
        direction: [Number.NaN, 0, 0],
      }),
    ).toThrowError(/direction must be finite/i);
  });

  it("rejects mechanically impossible properties across every analysis path", () => {
    const impossible: VolumetricMassProperties = {
      volume: 1,
      centerOfMass: [0, 0, 0],
      inertiaTensor: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 3],
      ],
    };
    const impossiblePhysical: PhysicalMassProperties = {
      mass: 1,
      centerOfMass: [0, 0, 0],
      inertiaTensor: impossible.inertiaTensor,
    };

    for (const analyze of [
      () => physicalMassProperties(impossible, 1),
      () => combinePhysicalMassProperties([impossiblePhysical]),
      () => inertiaTensorAboutPoint(impossible, [0, 0, 0]),
      () =>
        momentOfInertiaAboutAxis(impossible, {
          point: [0, 0, 0],
          direction: [1, 0, 0],
        }),
      () => worldRadiiOfGyration(impossible),
      () => principalRadiiOfGyration(impossible),
      () =>
        radiusOfGyrationAboutAxis(impossible, {
          point: [0, 0, 0],
          direction: [1, 0, 0],
        }),
    ]) {
      expect(analyze).toThrowError(/triangle inequality/i);
    }
  });

  it("does not mutate frozen volumetric or physical inputs", () => {
    const properties = frozenBox();
    const before = JSON.stringify(properties);
    const physical = physicalMassProperties(properties, 2);
    const physicalBefore = JSON.stringify(physical);

    principalInertia(properties.inertiaTensor);
    inertiaTensorAboutPoint(properties, [0, 0, 0]);
    momentOfInertiaAboutAxis(properties, {
      point: [0, 0, 0],
      direction: [1, 2, 3],
    });
    worldRadiiOfGyration(properties);
    principalRadiiOfGyration(properties);
    radiusOfGyrationAboutAxis(properties, {
      point: [0, 0, 0],
      direction: [1, 2, 3],
    });
    combinePhysicalMassProperties([physical]);

    expect(JSON.stringify(properties)).toBe(before);
    expect(JSON.stringify(physical)).toBe(physicalBefore);
  });
});
