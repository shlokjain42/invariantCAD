import type { Mat4, Vec3 } from "../core/math.js";
import type { InertiaTensor } from "../kernel.js";

export interface GeometricMassProperties {
  readonly volume: number;
  readonly centerOfMass: Vec3 | null;
  readonly inertiaTensor: InertiaTensor;
}

export interface TriangleMeshMassProperties extends GeometricMassProperties {
  /** Signed volume before an optional whole-mesh winding normalization. */
  readonly signedVolume: number;
  /** Sum of absolute tetrahedron volumes, useful for cancellation checks. */
  readonly absoluteVolume: number;
  readonly volumeRoundoffBound: number;
}

export interface TriangleMeshMassPropertyOptions {
  /** Number of interleaved properties per vertex. The first three are XYZ. */
  readonly stride?: number;
  /** Translation from the supplied mesh coordinates into world coordinates. */
  readonly worldOffset?: Vec3;
  /** Require outward winding instead of normalizing one globally reversed mesh. */
  readonly winding?: "normalize" | "positive";
}

class CompensatedSum {
  private sum = 0;
  private correction = 0;
  absolute = 0;

  add(value: number): void {
    const next = this.sum + value;
    this.correction +=
      Math.abs(this.sum) >= Math.abs(value)
        ? this.sum - next + value
        : value - next + this.sum;
    this.sum = next;
    this.absolute += Math.abs(value);
  }

  value(): number {
    return this.sum + this.correction;
  }
}

function zeroTensor(): InertiaTensor {
  return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
}

export function zeroMassProperties(): GeometricMassProperties {
  return {
    volume: 0,
    centerOfMass: null,
    inertiaTensor: zeroTensor(),
  };
}

function finiteVector(value: Vec3): boolean {
  return value.every(Number.isFinite);
}

function tensorFromSymmetricEntries(
  xx: number,
  xy: number,
  xz: number,
  yy: number,
  yz: number,
  zz: number,
): InertiaTensor {
  const clean = (value: number): number => (value === 0 ? 0 : value);
  return [
    [clean(xx), clean(xy), clean(xz)],
    [clean(xy), clean(yy), clean(yz)],
    [clean(xz), clean(yz), clean(zz)],
  ];
}

function tensorEntries(tensor: InertiaTensor): readonly number[] {
  return [
    tensor[0][0],
    tensor[0][1],
    tensor[0][2],
    tensor[1][0],
    tensor[1][1],
    tensor[1][2],
    tensor[2][0],
    tensor[2][1],
    tensor[2][2],
  ];
}

function assertMassProperties(properties: GeometricMassProperties): void {
  if (!Number.isFinite(properties.volume) || properties.volume < 0) {
    throw new RangeError("Mass-property volume must be finite and non-negative");
  }
  if (
    (properties.volume === 0) !== (properties.centerOfMass === null) ||
    (properties.centerOfMass !== null && !finiteVector(properties.centerOfMass))
  ) {
    throw new RangeError(
      "Mass-property center must be finite exactly when volume is positive",
    );
  }
  if (!tensorEntries(properties.inertiaTensor).every(Number.isFinite)) {
    throw new RangeError("Mass-property inertia tensor must be finite");
  }
}

/** Converts and symmetrizes a native row-major 3x3 inertia matrix. */
export function inertiaTensorFromRowMajor(values: readonly number[]): InertiaTensor {
  if (values.length !== 9 || !values.every(Number.isFinite)) {
    throw new RangeError(
      "A native inertia tensor must contain exactly nine finite numbers",
    );
  }
  const scale = Math.max(Number.MIN_VALUE, ...values.map(Math.abs));
  const asymmetry = Math.max(
    Math.abs(values[1]! - values[3]!),
    Math.abs(values[2]! - values[6]!),
    Math.abs(values[5]! - values[7]!),
  );
  if (asymmetry > 4096 * Number.EPSILON * scale) {
    throw new RangeError("A native inertia tensor must be symmetric");
  }
  return tensorFromSymmetricEntries(
    values[0]!,
    (values[1]! + values[3]!) / 2,
    (values[2]! + values[6]!) / 2,
    values[4]!,
    (values[5]! + values[7]!) / 2,
    values[8]!,
  );
}

/**
 * Integrates a closed oriented triangle mesh as signed tetrahedra.
 *
 * A local bounding-box reference and compensated sums keep the volume, first
 * moment, and second moment stable under representable world translations.
 */
export function integrateTriangleMeshMassProperties(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  options: TriangleMeshMassPropertyOptions = {},
): TriangleMeshMassProperties {
  const stride = options.stride ?? 3;
  const worldOffset = options.worldOffset ?? [0, 0, 0];
  const winding = options.winding ?? "normalize";
  if (!Number.isSafeInteger(stride) || stride < 3) {
    throw new RangeError("Triangle-mesh vertex stride must be an integer of at least three");
  }
  if (positions.length % stride !== 0) {
    throw new RangeError("Triangle-mesh properties must contain complete vertices");
  }
  if (indices.length % 3 !== 0) {
    throw new RangeError("Triangle-mesh indices must contain complete triangles");
  }
  if (!finiteVector(worldOffset)) {
    throw new RangeError("Triangle-mesh world offset must be finite");
  }
  const vertexCount = positions.length / stride;
  if (vertexCount === 0 && indices.length === 0) {
    return {
      ...zeroMassProperties(),
      signedVolume: 0,
      absoluteVolume: 0,
      volumeRoundoffBound: 0,
    };
  }
  if (vertexCount === 0 || indices.length === 0) {
    throw new RangeError("A non-empty triangle mesh must contain vertices and triangles");
  }

  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * stride;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis]!;
      if (!Number.isFinite(value)) {
        throw new RangeError("Triangle-mesh positions must be finite");
      }
      minimum[axis] = Math.min(minimum[axis]!, value);
      maximum[axis] = Math.max(maximum[axis]!, value);
    }
  }
  for (let index = 0; index < indices.length; index += 1) {
    const vertex = indices[index]!;
    if (!Number.isSafeInteger(vertex) || vertex < 0 || vertex >= vertexCount) {
      throw new RangeError("Triangle-mesh indices must reference existing vertices");
    }
  }

  const reference: Vec3 = [
    minimum[0] / 2 + maximum[0] / 2,
    minimum[1] / 2 + maximum[1] / 2,
    minimum[2] / 2 + maximum[2] / 2,
  ];
  const volume = new CompensatedSum();
  const first = [new CompensatedSum(), new CompensatedSum(), new CompensatedSum()];
  const second = [
    new CompensatedSum(),
    new CompensatedSum(),
    new CompensatedSum(),
    new CompensatedSum(),
    new CompensatedSum(),
    new CompensatedSum(),
  ];
  const vertex = (vertexIndex: number): Vec3 => {
    const offset = vertexIndex * stride;
    return [
      positions[offset]! - reference[0],
      positions[offset + 1]! - reference[1],
      positions[offset + 2]! - reference[2],
    ];
  };

  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = vertex(indices[triangle]!);
    const b = vertex(indices[triangle + 1]!);
    const c = vertex(indices[triangle + 2]!);
    const tetrahedronVolume =
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    volume.add(tetrahedronVolume);
    const sum: Vec3 = [
      a[0] + b[0] + c[0],
      a[1] + b[1] + c[1],
      a[2] + b[2] + c[2],
    ];
    for (let axis = 0; axis < 3; axis += 1) {
      first[axis]!.add((tetrahedronVolume * sum[axis]!) / 4);
    }
    const factor = tetrahedronVolume / 20;
    second[0]!.add(
      factor * (a[0] * a[0] + b[0] * b[0] + c[0] * c[0] + sum[0] * sum[0]),
    );
    second[1]!.add(
      factor * (a[0] * a[1] + b[0] * b[1] + c[0] * c[1] + sum[0] * sum[1]),
    );
    second[2]!.add(
      factor * (a[0] * a[2] + b[0] * b[2] + c[0] * c[2] + sum[0] * sum[2]),
    );
    second[3]!.add(
      factor * (a[1] * a[1] + b[1] * b[1] + c[1] * c[1] + sum[1] * sum[1]),
    );
    second[4]!.add(
      factor * (a[1] * a[2] + b[1] * b[2] + c[1] * c[2] + sum[1] * sum[2]),
    );
    second[5]!.add(
      factor * (a[2] * a[2] + b[2] * b[2] + c[2] * c[2] + sum[2] * sum[2]),
    );
  }

  const signedVolume = volume.value();
  const volumeRoundoffBound =
    128 * Number.EPSILON * Math.max(volume.absolute, Number.MIN_VALUE);
  if (!Number.isFinite(signedVolume) || Math.abs(signedVolume) <= volumeRoundoffBound) {
    throw new RangeError("Triangle-mesh volume is zero or numerically indeterminate");
  }
  if (winding === "positive" && signedVolume < 0) {
    throw new RangeError("Triangle-mesh winding must face outward");
  }
  const orientation = signedVolume < 0 ? -1 : 1;
  const normalizedVolume = orientation * signedVolume;
  const localCenter: Vec3 = [
    (orientation * first[0]!.value()) / normalizedVolume,
    (orientation * first[1]!.value()) / normalizedVolume,
    (orientation * first[2]!.value()) / normalizedVolume,
  ];
  const qxx = orientation * second[0]!.value();
  const qxy = orientation * second[1]!.value();
  const qxz = orientation * second[2]!.value();
  const qyy = orientation * second[3]!.value();
  const qyz = orientation * second[4]!.value();
  const qzz = orientation * second[5]!.value();
  const sxx = qxx - normalizedVolume * localCenter[0] * localCenter[0];
  const sxy = qxy - normalizedVolume * localCenter[0] * localCenter[1];
  const sxz = qxz - normalizedVolume * localCenter[0] * localCenter[2];
  const syy = qyy - normalizedVolume * localCenter[1] * localCenter[1];
  const syz = qyz - normalizedVolume * localCenter[1] * localCenter[2];
  const szz = qzz - normalizedVolume * localCenter[2] * localCenter[2];
  const centerOfMass: Vec3 = [
    reference[0] + localCenter[0] + worldOffset[0],
    reference[1] + localCenter[1] + worldOffset[1],
    reference[2] + localCenter[2] + worldOffset[2],
  ];
  const properties: TriangleMeshMassProperties = {
    volume: normalizedVolume,
    centerOfMass,
    inertiaTensor: tensorFromSymmetricEntries(
      syy + szz,
      -sxy,
      -sxz,
      sxx + szz,
      -syz,
      sxx + syy,
    ),
    signedVolume,
    absoluteVolume: volume.absolute,
    volumeRoundoffBound,
  };
  assertMassProperties(properties);
  return properties;
}

/** Rescales density-one inertia to a certified authoritative volume. */
export function rescaleMassProperties(
  properties: GeometricMassProperties,
  volume: number,
): GeometricMassProperties {
  assertMassProperties(properties);
  if (!Number.isFinite(volume) || volume < 0) {
    throw new RangeError("Rescaled mass-property volume must be finite and non-negative");
  }
  if (volume === 0) return zeroMassProperties();
  if (properties.volume === 0 || properties.centerOfMass === null) {
    throw new RangeError("Positive volume cannot rescale empty mass properties");
  }
  const factor = volume / properties.volume;
  const inertia = properties.inertiaTensor;
  const result: GeometricMassProperties = {
    volume,
    centerOfMass: properties.centerOfMass,
    inertiaTensor: tensorFromSymmetricEntries(
      inertia[0][0] * factor,
      ((inertia[0][1] + inertia[1][0]) / 2) * factor,
      ((inertia[0][2] + inertia[2][0]) / 2) * factor,
      inertia[1][1] * factor,
      ((inertia[1][2] + inertia[2][1]) / 2) * factor,
      inertia[2][2] * factor,
    ),
  };
  assertMassProperties(result);
  return result;
}

/** Applies a general affine map to central volumetric mass properties. */
export function transformMassProperties(
  properties: GeometricMassProperties,
  matrix: Mat4,
): GeometricMassProperties {
  assertMassProperties(properties);
  if (!matrix.every(Number.isFinite)) {
    throw new RangeError("Mass-property transform matrix must be finite");
  }
  if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) {
    throw new RangeError("Mass properties require an affine transform matrix");
  }
  if (properties.volume === 0 || properties.centerOfMass === null) {
    return zeroMassProperties();
  }
  const a = [
    [matrix[0], matrix[4], matrix[8]],
    [matrix[1], matrix[5], matrix[9]],
    [matrix[2], matrix[6], matrix[10]],
  ];
  const determinant =
    a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) -
    a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) +
    a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const volumeScale = Math.abs(determinant);
  if (volumeScale === 0) return zeroMassProperties();

  const inertia = properties.inertiaTensor;
  const secondTrace =
    (inertia[0][0] + inertia[1][1] + inertia[2][2]) / 2;
  const ixy = (inertia[0][1] + inertia[1][0]) / 2;
  const ixz = (inertia[0][2] + inertia[2][0]) / 2;
  const iyz = (inertia[1][2] + inertia[2][1]) / 2;
  const second = [
    [secondTrace - inertia[0][0], -ixy, -ixz],
    [-ixy, secondTrace - inertia[1][1], -iyz],
    [-ixz, -iyz, secondTrace - inertia[2][2]],
  ];
  const transformedSecond = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let first = 0; first < 3; first += 1) {
        for (let secondAxis = 0; secondAxis < 3; secondAxis += 1) {
          const transformedRow = transformedSecond[row]!;
          transformedRow[column] =
            transformedRow[column]! +
            volumeScale *
            a[row]![first]! *
            second[first]![secondAxis]! *
            a[column]![secondAxis]!;
        }
      }
    }
  }
  const transformedTrace =
    transformedSecond[0]![0]! +
    transformedSecond[1]![1]! +
    transformedSecond[2]![2]!;
  const center = properties.centerOfMass;
  const result: GeometricMassProperties = {
    volume: properties.volume * volumeScale,
    centerOfMass: [
      matrix[0] * center[0] + matrix[4] * center[1] + matrix[8] * center[2] + matrix[12],
      matrix[1] * center[0] + matrix[5] * center[1] + matrix[9] * center[2] + matrix[13],
      matrix[2] * center[0] + matrix[6] * center[1] + matrix[10] * center[2] + matrix[14],
    ],
    inertiaTensor: tensorFromSymmetricEntries(
      transformedTrace - transformedSecond[0]![0]!,
      -transformedSecond[0]![1]!,
      -transformedSecond[0]![2]!,
      transformedTrace - transformedSecond[1]![1]!,
      -transformedSecond[1]![2]!,
      transformedTrace - transformedSecond[2]![2]!,
    ),
  };
  assertMassProperties(result);
  return result;
}

/** Combines independent bodies with the parallel-axis theorem. */
export function combineMassProperties(
  values: readonly GeometricMassProperties[],
): GeometricMassProperties {
  if (values.length === 0) return zeroMassProperties();
  values.forEach(assertMassProperties);
  const nonEmpty = values.filter(
    (value): value is GeometricMassProperties & { readonly centerOfMass: Vec3 } =>
      value.volume > 0 && value.centerOfMass !== null,
  );
  if (nonEmpty.length === 0) return zeroMassProperties();
  const reference = nonEmpty[0]!.centerOfMass;
  const totalVolume = new CompensatedSum();
  const first = [new CompensatedSum(), new CompensatedSum(), new CompensatedSum()];
  const localCenters = nonEmpty.map((value) => {
    totalVolume.add(value.volume);
    const local: Vec3 = [
      value.centerOfMass[0] - reference[0],
      value.centerOfMass[1] - reference[1],
      value.centerOfMass[2] - reference[2],
    ];
    for (let axis = 0; axis < 3; axis += 1) {
      first[axis]!.add(value.volume * local[axis]!);
    }
    return local;
  });
  const volume = totalVolume.value();
  const combinedLocal: Vec3 = [
    first[0]!.value() / volume,
    first[1]!.value() / volume,
    first[2]!.value() / volume,
  ];
  const tensorSums = Array.from({ length: 6 }, () => new CompensatedSum());
  for (let index = 0; index < nonEmpty.length; index += 1) {
    const properties = nonEmpty[index]!;
    const local = localCenters[index]!;
    const dx = local[0] - combinedLocal[0];
    const dy = local[1] - combinedLocal[1];
    const dz = local[2] - combinedLocal[2];
    const inertia = properties.inertiaTensor;
    tensorSums[0]!.add(inertia[0][0] + properties.volume * (dy * dy + dz * dz));
    tensorSums[1]!.add(inertia[0][1] - properties.volume * dx * dy);
    tensorSums[2]!.add(inertia[0][2] - properties.volume * dx * dz);
    tensorSums[3]!.add(inertia[1][1] + properties.volume * (dx * dx + dz * dz));
    tensorSums[4]!.add(inertia[1][2] - properties.volume * dy * dz);
    tensorSums[5]!.add(inertia[2][2] + properties.volume * (dx * dx + dy * dy));
  }
  const result: GeometricMassProperties = {
    volume,
    centerOfMass: [
      reference[0] + combinedLocal[0],
      reference[1] + combinedLocal[1],
      reference[2] + combinedLocal[2],
    ],
    inertiaTensor: tensorFromSymmetricEntries(
      tensorSums[0]!.value(),
      tensorSums[1]!.value(),
      tensorSums[2]!.value(),
      tensorSums[3]!.value(),
      tensorSums[4]!.value(),
      tensorSums[5]!.value(),
    ),
  };
  assertMassProperties(result);
  return result;
}
