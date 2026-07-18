import { describe, expect, it } from "vitest";
import {
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  transformPoint,
  translationMatrix,
  type Mat4,
  type Vec3,
} from "../src/core/math.js";
import {
  combineMassProperties,
  inertiaTensorFromRowMajor,
  integrateTriangleMeshMassProperties,
  rescaleMassProperties,
  transformMassProperties,
  zeroMassProperties,
  type GeometricMassProperties,
} from "../src/internal/mesh-mass-properties.js";
import type { InertiaTensor } from "../src/kernel.js";

interface TriangleMesh {
  readonly positions: readonly number[];
  readonly indices: readonly number[];
}

const TETRAHEDRON: TriangleMesh = {
  positions: [
    0, 0, 0,
    1, 0, 0,
    0, 2, 0,
    0, 0, 3,
  ],
  indices: [
    1, 2, 3,
    0, 3, 2,
    0, 1, 3,
    0, 2, 1,
  ],
};

const TETRAHEDRON_INERTIA: InertiaTensor = [
  [39 / 80, 1 / 40, 3 / 80],
  [1 / 40, 3 / 8, 3 / 40],
  [3 / 80, 3 / 40, 3 / 16],
];

const BOX_INERTIA: InertiaTensor = [
  [208, 0, 0],
  [0, 160, 0],
  [0, 0, 80],
];

function boxMesh(
  size: Vec3 = [2, 4, 6],
  origin: Vec3 = [0, 0, 0],
): TriangleMesh {
  const [width, height, depth] = size;
  const [x, y, z] = origin;
  return {
    positions: [
      x, y, z,
      x + width, y, z,
      x + width, y + height, z,
      x, y + height, z,
      x, y, z + depth,
      x + width, y, z + depth,
      x + width, y + height, z + depth,
      x, y + height, z + depth,
    ],
    indices: [
      0, 2, 1, 0, 3, 2,
      4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4,
      3, 7, 6, 3, 6, 2,
      0, 4, 7, 0, 7, 3,
      1, 2, 6, 1, 6, 5,
    ],
  };
}

function reverseTriangles(indices: readonly number[]): number[] {
  const reversed: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    reversed.push(indices[index]!, indices[index + 2]!, indices[index + 1]!);
  }
  return reversed;
}

function transformMesh(mesh: TriangleMesh, matrix: Mat4): TriangleMesh {
  const positions: number[] = [];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    positions.push(
      ...transformPoint(
        [
          mesh.positions[offset]!,
          mesh.positions[offset + 1]!,
          mesh.positions[offset + 2]!,
        ],
        matrix,
      ),
    );
  }
  return { positions, indices: mesh.indices };
}

function mergeMeshes(first: TriangleMesh, second: TriangleMesh): TriangleMesh {
  const vertexOffset = first.positions.length / 3;
  return {
    positions: [...first.positions, ...second.positions],
    indices: [
      ...first.indices,
      ...second.indices.map((index) => index + vertexOffset),
    ],
  };
}

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
  expect(actual).toHaveLength(3);
  for (let row = 0; row < 3; row += 1) {
    expect(actual[row]!).toHaveLength(3);
    for (let column = 0; column < 3; column += 1) {
      expectClose(
        actual[row]![column]!,
        expected[row]![column]!,
        relativeTolerance,
        absoluteTolerance,
      );
    }
  }
}

function expectMassPropertiesClose(
  actual: GeometricMassProperties,
  expected: GeometricMassProperties,
  relativeTolerance = 2e-12,
  absoluteTolerance = 2e-12,
): void {
  expectClose(
    actual.volume,
    expected.volume,
    relativeTolerance,
    absoluteTolerance,
  );
  if (expected.centerOfMass === null) {
    expect(actual.centerOfMass).toBeNull();
  } else {
    expect(actual.centerOfMass).not.toBeNull();
    expectVectorClose(
      actual.centerOfMass!,
      expected.centerOfMass,
      relativeTolerance,
      absoluteTolerance,
    );
  }
  expectTensorClose(
    actual.inertiaTensor,
    expected.inertiaTensor,
    relativeTolerance,
    absoluteTolerance,
  );
}

function scaledTensor(tensor: InertiaTensor, factor: number): InertiaTensor {
  return tensor.map((row) =>
    row.map((value) => value * factor),
  ) as unknown as InertiaTensor;
}

describe("triangle-mesh mass-property integration", () => {
  it("integrates an analytic 1 by 2 by 3 right tetrahedron", () => {
    const properties = integrateTriangleMeshMassProperties(
      TETRAHEDRON.positions,
      TETRAHEDRON.indices,
      { winding: "positive" },
    );

    expectClose(properties.volume, 1);
    expectClose(properties.signedVolume, 1);
    expect(properties.absoluteVolume).toBeGreaterThanOrEqual(properties.volume);
    expect(properties.volumeRoundoffBound).toBeGreaterThan(0);
    expectVectorClose(properties.centerOfMass!, [1 / 4, 1 / 2, 3 / 4]);
    expectTensorClose(properties.inertiaTensor, TETRAHEDRON_INERTIA);
  });

  it("normalizes a globally reversed mesh but can require outward winding", () => {
    const reversedIndices = reverseTriangles(TETRAHEDRON.indices);
    const normalized = integrateTriangleMeshMassProperties(
      TETRAHEDRON.positions,
      reversedIndices,
    );

    expectClose(normalized.signedVolume, -1);
    expectMassPropertiesClose(normalized, {
      volume: 1,
      centerOfMass: [1 / 4, 1 / 2, 3 / 4],
      inertiaTensor: TETRAHEDRON_INERTIA,
    });
    expect(() =>
      integrateTriangleMeshMassProperties(
        TETRAHEDRON.positions,
        reversedIndices,
        { winding: "positive" },
      ),
    ).toThrowError(/winding must face outward/i);
  });

  it("matches the analytic mass properties of a 2 by 4 by 6 box", () => {
    const box = boxMesh();
    const properties = integrateTriangleMeshMassProperties(
      box.positions,
      box.indices,
      { winding: "positive" },
    );

    expectMassPropertiesClose(properties, {
      volume: 48,
      centerOfMass: [1, 2, 3],
      inertiaTensor: BOX_INERTIA,
    });

    const interleaved = box.positions.flatMap((value, index) =>
      index % 3 === 2
        ? [box.positions[index - 2]!, box.positions[index - 1]!, value, 17, -4]
        : [],
    );
    const strided = integrateTriangleMeshMassProperties(
      interleaved,
      box.indices,
      { stride: 5, winding: "positive" },
    );
    expectMassPropertiesClose(strided, properties);
  });

  it("keeps central properties stable under large coordinate translations", () => {
    const box = boxMesh();
    const translation: Vec3 = [1_000_000_000_000, -2_000_000_000_000, 3_000_000_000_000];
    const embedded = boxMesh([2, 4, 6], translation);
    const local = integrateTriangleMeshMassProperties(box.positions, box.indices);
    const translated = integrateTriangleMeshMassProperties(
      embedded.positions,
      embedded.indices,
    );
    const offset = integrateTriangleMeshMassProperties(
      box.positions,
      box.indices,
      { worldOffset: translation },
    );
    const expectedCenter: Vec3 = [
      translation[0] + 1,
      translation[1] + 2,
      translation[2] + 3,
    ];

    expectVectorClose(translated.centerOfMass!, expectedCenter, 0, 0);
    expectVectorClose(offset.centerOfMass!, expectedCenter, 0, 0);
    expectClose(translated.volume, local.volume);
    expectClose(offset.volume, local.volume);
    expectTensorClose(translated.inertiaTensor, local.inertiaTensor);
    expectTensorClose(offset.inertiaTensor, local.inertiaTensor);
  });

  it("returns the canonical zero properties for an empty mesh", () => {
    const integrated = integrateTriangleMeshMassProperties([], []);

    expect(integrated).toEqual({
      volume: 0,
      centerOfMass: null,
      inertiaTensor: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      signedVolume: 0,
      absoluteVolume: 0,
      volumeRoundoffBound: 0,
    });
    expect(zeroMassProperties()).toEqual({
      volume: 0,
      centerOfMass: null,
      inertiaTensor: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    });
  });

  it("rejects invalid strides and incomplete vertex records", () => {
    for (const stride of [0, 2, 3.5, Number.NaN]) {
      expect(() =>
        integrateTriangleMeshMassProperties([], [], { stride }),
      ).toThrowError(/stride must be an integer of at least three/i);
    }
    expect(() =>
      integrateTriangleMeshMassProperties([0, 0, 0, 1], [], { stride: 3 }),
    ).toThrowError(/complete vertices/i);
  });

  it("rejects non-finite positions and world offsets", () => {
    const invalidPositions = [...TETRAHEDRON.positions];
    invalidPositions[4] = Number.NaN;
    expect(() =>
      integrateTriangleMeshMassProperties(
        invalidPositions,
        TETRAHEDRON.indices,
      ),
    ).toThrowError(/positions must be finite/i);
    expect(() =>
      integrateTriangleMeshMassProperties(
        TETRAHEDRON.positions,
        TETRAHEDRON.indices,
        { worldOffset: [0, Number.POSITIVE_INFINITY, 0] },
      ),
    ).toThrowError(/world offset must be finite/i);
  });

  it("rejects incomplete, fractional, negative, and out-of-range indices", () => {
    expect(() =>
      integrateTriangleMeshMassProperties(TETRAHEDRON.positions, [0, 1]),
    ).toThrowError(/complete triangles/i);
    for (const invalidIndex of [-1, 1.5, 4, Number.NaN]) {
      expect(() =>
        integrateTriangleMeshMassProperties(
          TETRAHEDRON.positions,
          [0, 1, invalidIndex],
        ),
      ).toThrowError(/reference existing vertices/i);
    }
  });

  it("rejects partial and zero-volume meshes", () => {
    expect(() =>
      integrateTriangleMeshMassProperties([0, 0, 0], []),
    ).toThrowError(/must contain vertices and triangles/i);
    expect(() =>
      integrateTriangleMeshMassProperties([], [0, 0, 0]),
    ).toThrowError(/must contain vertices and triangles/i);
    expect(() =>
      integrateTriangleMeshMassProperties(
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
        [0, 1, 2],
      ),
    ).toThrowError(/volume is zero or numerically indeterminate/i);
  });
});

describe("native inertia conversion", () => {
  it("converts row-major values to a symmetric nested tensor", () => {
    const tensor = inertiaTensorFromRowMajor([
      11, 2 + 1e-13, -3 - 1e-13,
      2 - 1e-13, 17, 5 + 1e-13,
      -3 + 1e-13, 5 - 1e-13, 23,
    ]);

    expectTensorClose(tensor, [
      [11, 2, -3],
      [2, 17, 5],
      [-3, 5, 23],
    ]);
    expect(tensor[0][1]).toBe(tensor[1][0]);
    expect(tensor[0][2]).toBe(tensor[2][0]);
    expect(tensor[1][2]).toBe(tensor[2][1]);
  });

  it("rejects malformed, non-finite, and materially asymmetric matrices", () => {
    expect(() => inertiaTensorFromRowMajor(new Array(8).fill(0))).toThrowError(
      /exactly nine finite numbers/i,
    );
    expect(() =>
      inertiaTensorFromRowMajor([
        1, 0, 0,
        0, 1, Number.NaN,
        0, 0, 1,
      ]),
    ).toThrowError(/exactly nine finite numbers/i);
    expect(() =>
      inertiaTensorFromRowMajor([
        1, 2, 0,
        3, 4, 0,
        0, 0, 5,
      ]),
    ).toThrowError(/must be symmetric/i);
  });
});

describe("mass-property rescaling", () => {
  it("rescales volume and density-one inertia without moving the center", () => {
    const source = integrateTriangleMeshMassProperties(
      TETRAHEDRON.positions,
      TETRAHEDRON.indices,
    );
    const rescaled = rescaleMassProperties(source, 7.5);

    expectMassPropertiesClose(rescaled, {
      volume: 7.5,
      centerOfMass: [1 / 4, 1 / 2, 3 / 4],
      inertiaTensor: scaledTensor(TETRAHEDRON_INERTIA, 7.5),
    });
    expectMassPropertiesClose(rescaleMassProperties(source, 0), zeroMassProperties());
  });

  it("validates target volume and cannot inflate an empty body", () => {
    expect(() => rescaleMassProperties(zeroMassProperties(), 1)).toThrowError(
      /positive volume cannot rescale empty mass properties/i,
    );
    for (const volume of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        rescaleMassProperties(zeroMassProperties(), volume),
      ).toThrowError(/volume must be finite and non-negative/i);
    }
  });
});

describe("affine mass-property transformation", () => {
  const tetrahedron = integrateTriangleMeshMassProperties(
    TETRAHEDRON.positions,
    TETRAHEDRON.indices,
  );
  const box = integrateTriangleMeshMassProperties(
    boxMesh().positions,
    boxMesh().indices,
  );

  it("translates the center while preserving volume and central inertia", () => {
    const transformed = transformMassProperties(
      tetrahedron,
      translationMatrix([7, -11, 13]),
    );

    expectMassPropertiesClose(transformed, {
      volume: 1,
      centerOfMass: [29 / 4, -21 / 2, 55 / 4],
      inertiaTensor: TETRAHEDRON_INERTIA,
    });
  });

  it("rotates both the center and the full tensor", () => {
    const transformed = transformMassProperties(
      tetrahedron,
      rotationMatrix([0, 0, Math.PI / 2]),
    );

    expectMassPropertiesClose(transformed, {
      volume: 1,
      centerOfMass: [-1 / 2, 1 / 4, 3 / 4],
      inertiaTensor: [
        [3 / 8, -1 / 40, -3 / 40],
        [-1 / 40, 39 / 80, 3 / 80],
        [-3 / 40, 3 / 80, 3 / 16],
      ],
    });
  });

  it("uses the absolute determinant for reflections and transforms products of inertia", () => {
    const transformed = transformMassProperties(
      tetrahedron,
      scaleMatrix([-1, 1, 1]),
    );

    expectMassPropertiesClose(transformed, {
      volume: 1,
      centerOfMass: [-1 / 4, 1 / 2, 3 / 4],
      inertiaTensor: [
        [39 / 80, -1 / 40, -3 / 80],
        [-1 / 40, 3 / 8, 3 / 40],
        [-3 / 80, 3 / 40, 3 / 16],
      ],
    });
  });

  it("applies cubic volume and fifth-power inertia laws under uniform scale", () => {
    const transformed = transformMassProperties(
      tetrahedron,
      scaleMatrix([4, 4, 4]),
    );

    expectMassPropertiesClose(transformed, {
      volume: 4 ** 3,
      centerOfMass: [1, 2, 3],
      inertiaTensor: scaledTensor(TETRAHEDRON_INERTIA, 4 ** 5),
    });
  });

  it("matches analytic box dimensions under nonuniform scale", () => {
    const transformed = transformMassProperties(
      box,
      scaleMatrix([2, 0.5, 3]),
    );

    expectMassPropertiesClose(transformed, {
      volume: 144,
      centerOfMass: [2, 1, 9],
      inertiaTensor: [
        [3_936, 0, 0],
        [0, 4_080, 0],
        [0, 0, 240],
      ],
    });
  });

  it("agrees with direct mesh integration for a general improper affine map", () => {
    const matrix = multiplyMatrices(
      translationMatrix([7, -11, 13]),
      multiplyMatrices(
        rotationMatrix([0.3, -0.4, 0.2]),
        [
          -2, 0.15, -0.1, 0,
          0.25, 0.5, 0.2, 0,
          0.1, -0.3, 1.5, 0,
          0, 0, 0, 1,
        ],
      ),
    );
    const transformed = transformMassProperties(tetrahedron, matrix);
    const transformedMesh = transformMesh(TETRAHEDRON, matrix);
    const reintegrated = integrateTriangleMeshMassProperties(
      transformedMesh.positions,
      transformedMesh.indices,
    );

    expectMassPropertiesClose(transformed, reintegrated, 1e-11, 1e-11);
  });

  it("returns zero for singular maps and rejects non-affine or non-finite matrices", () => {
    expectMassPropertiesClose(
      transformMassProperties(tetrahedron, scaleMatrix([1, 0, 1])),
      zeroMassProperties(),
    );
    const perspective = [
      1, 0, 0, 0.1,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ] as const;
    expect(() => transformMassProperties(tetrahedron, perspective)).toThrowError(
      /require an affine transform matrix/i,
    );
    const nonFinite = [
      1, 0, 0, 0,
      0, Number.NaN, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ] as const;
    expect(() => transformMassProperties(tetrahedron, nonFinite)).toThrowError(
      /transform matrix must be finite/i,
    );
  });
});

describe("independent-body combination", () => {
  it("uses the full parallel-axis theorem for two separated bodies", () => {
    const firstMesh = boxMesh();
    const displacement: Vec3 = [10, 6, -4];
    const secondMesh = transformMesh(firstMesh, translationMatrix(displacement));
    const first = integrateTriangleMeshMassProperties(
      firstMesh.positions,
      firstMesh.indices,
    );
    const second = transformMassProperties(
      first,
      translationMatrix(displacement),
    );
    const combined = combineMassProperties([
      zeroMassProperties(),
      first,
      second,
    ]);

    expectMassPropertiesClose(combined, {
      volume: 96,
      centerOfMass: [6, 5, 1],
      inertiaTensor: [
        [1_664, -1_440, 960],
        [-1_440, 3_104, 576],
        [960, 576, 3_424],
      ],
    });

    const merged = mergeMeshes(firstMesh, secondMesh);
    const integratedTogether = integrateTriangleMeshMassProperties(
      merged.positions,
      merged.indices,
    );
    expectMassPropertiesClose(combined, integratedTogether);
  });

  it("returns canonical zero properties when no body has volume", () => {
    expect(combineMassProperties([])).toEqual(zeroMassProperties());
    expect(combineMassProperties([zeroMassProperties()])).toEqual(
      zeroMassProperties(),
    );
  });
});
