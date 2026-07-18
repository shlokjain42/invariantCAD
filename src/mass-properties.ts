import type { Vec3 } from "./core/math.js";
import type {
  InertiaTensor,
  VolumetricMassProperties,
} from "./kernel.js";

/** Physical inertia uses kg*mm^2 for authored documents. */
export type PhysicalInertiaTensor = InertiaTensor;

export interface PhysicalMassProperties {
  /** Physical mass in kilograms. */
  readonly mass: number;
  readonly centerOfMass: Vec3 | null;
  /** Central physical inertia in kg*mm^2 about `centerOfMass`. */
  readonly inertiaTensor: PhysicalInertiaTensor;
}

export type InertiaPropertySource =
  | VolumetricMassProperties
  | PhysicalMassProperties;

export type PrincipalAxes = readonly [Vec3, Vec3, Vec3];
export type PrincipalAxisStatus = "unique" | "degenerate";
export type PrincipalInertiaDegeneracy =
  | "distinct"
  | "minimum-repeated"
  | "maximum-repeated"
  | "isotropic";

export interface PrincipalInertiaOptions {
  /** Relative gap used only to classify repeated principal moments. */
  readonly relativeDegeneracyTolerance?: number;
  /** Absolute gap in the input tensor's units, used only for classification. */
  readonly absoluteDegeneracyTolerance?: number;
}

export interface PrincipalInertiaResult {
  /** Principal moments in ascending order. */
  readonly moments: Vec3;
  /** World-space unit axes corresponding positionally to `moments`. */
  readonly axes: PrincipalAxes;
  /** Whether each unoriented principal axis is mathematically unique. */
  readonly axisStatus: readonly [
    PrincipalAxisStatus,
    PrincipalAxisStatus,
    PrincipalAxisStatus,
  ];
  readonly degeneracy: PrincipalInertiaDegeneracy;
}

export interface InertiaAxis {
  readonly point: Vec3;
  readonly direction: Vec3;
}

const SYMMETRY_ULP_FACTOR = 4096;
const JACOBI_CONVERGENCE_ULP_FACTOR = 64;
const MAX_JACOBI_SWEEPS = 32;

class CompensatedSum {
  private sum = 0;
  private correction = 0;

  add(value: number): void {
    const next = this.sum + value;
    this.correction +=
      Math.abs(this.sum) >= Math.abs(value)
        ? this.sum - next + value
        : value - next + this.sum;
    this.sum = next;
  }

  value(): number {
    return this.sum + this.correction;
  }
}

function clean(value: number): number {
  return value === 0 ? 0 : value;
}

function tensor(
  xx: number,
  xy: number,
  xz: number,
  yy: number,
  yz: number,
  zz: number,
): InertiaTensor {
  return [
    [clean(xx), clean(xy), clean(xz)],
    [clean(xy), clean(yy), clean(yz)],
    [clean(xz), clean(yz), clean(zz)],
  ];
}

function zeroTensor(): InertiaTensor {
  return tensor(0, 0, 0, 0, 0, 0);
}

function finiteVector(value: readonly number[]): value is Vec3 {
  return value.length === 3 && value.every(Number.isFinite);
}

interface ValidatedTensor {
  readonly matrix: readonly [Vec3, Vec3, Vec3];
  readonly scale: number;
}

function validateTensor(value: InertiaTensor): ValidatedTensor {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((row) => Array.isArray(row) && finiteVector(row))
  ) {
    throw new RangeError("An inertia tensor must be a finite 3x3 matrix");
  }
  const entries = value.flatMap((row) => [...row]);
  const scale = Math.max(0, ...entries.map(Math.abs));
  const asymmetry = Math.max(
    Math.abs(value[0][1] - value[1][0]),
    Math.abs(value[0][2] - value[2][0]),
    Math.abs(value[1][2] - value[2][1]),
  );
  if (asymmetry > SYMMETRY_ULP_FACTOR * Number.EPSILON * scale) {
    throw new RangeError("An inertia tensor must be symmetric");
  }
  const average = (first: number, second: number): number =>
    first + (second - first) / 2;
  return {
    matrix: [
      [value[0][0], average(value[0][1], value[1][0]), average(value[0][2], value[2][0])],
      [average(value[1][0], value[0][1]), value[1][1], average(value[1][2], value[2][1])],
      [average(value[2][0], value[0][2]), average(value[2][1], value[1][2]), value[2][2]],
    ],
    scale,
  };
}

function sourceWeight(properties: InertiaPropertySource): number {
  return "mass" in properties ? properties.mass : properties.volume;
}

function validateProperties(properties: InertiaPropertySource): {
  readonly weight: number;
  readonly centerOfMass: Vec3 | null;
  readonly inertiaTensor: InertiaTensor;
  readonly tensorScale: number;
} {
  const weight = sourceWeight(properties);
  if (!Number.isFinite(weight) || weight < 0) {
    throw new RangeError("Mass-property weight must be finite and non-negative");
  }
  if (
    (weight === 0) !== (properties.centerOfMass === null) ||
    (properties.centerOfMass !== null && !finiteVector(properties.centerOfMass))
  ) {
    throw new RangeError(
      "Mass-property center must be finite exactly when its weight is positive",
    );
  }
  const validated = validateTensor(properties.inertiaTensor);
  if (weight === 0 && validated.scale !== 0) {
    throw new RangeError("Zero-weight mass properties must have a zero inertia tensor");
  }
  if (weight > 0) principalInertia(validated.matrix);
  return {
    weight,
    centerOfMass: properties.centerOfMass,
    inertiaTensor: validated.matrix,
    tensorScale: validated.scale,
  };
}

function stableRadius(moment: number, weight: number, label: string): number {
  const result = Math.sqrt(moment) / Math.sqrt(weight);
  if (!Number.isFinite(result)) {
    throw new RangeError(`${label} overflowed numeric range`);
  }
  return clean(result);
}

function vectorLength(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(value: Vec3, label: string): Vec3 {
  if (!finiteVector(value)) {
    throw new RangeError(`${label} must be finite`);
  }
  const length = vectorLength(value);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError(`${label} must be non-zero and normalizable`);
  }
  return [value[0] / length, value[1] / length, value[2] / length];
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

function canonicalizeAxis(value: Vec3): Vec3 {
  const normalized = normalize(value, "Principal axis");
  let dominant = 0;
  for (let axis = 1; axis < 3; axis += 1) {
    if (Math.abs(normalized[axis]!) > Math.abs(normalized[dominant]!)) {
      dominant = axis;
    }
  }
  const sign = normalized[dominant]! < 0 ? -1 : 1;
  return normalized.map((coordinate) => clean(sign * coordinate)) as unknown as Vec3;
}

function identityAxes(): PrincipalAxes {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
}

/**
 * Computes a deterministic, ascending principal decomposition of a symmetric
 * inertia tensor. Axis signs are canonical except that the third is selected
 * from the cross product of the first two to make the frame right-handed.
 */
export function principalInertia(
  inertiaTensor: InertiaTensor,
  options: PrincipalInertiaOptions = {},
): PrincipalInertiaResult {
  const relativeTolerance = options.relativeDegeneracyTolerance ?? 1e-12;
  const absoluteTolerance = options.absoluteDegeneracyTolerance ?? 0;
  if (!Number.isFinite(relativeTolerance) || relativeTolerance < 0) {
    throw new RangeError("Principal relative degeneracy tolerance must be finite and non-negative");
  }
  if (!Number.isFinite(absoluteTolerance) || absoluteTolerance < 0) {
    throw new RangeError("Principal absolute degeneracy tolerance must be finite and non-negative");
  }
  const validated = validateTensor(inertiaTensor);
  if (validated.scale === 0) {
    return {
      moments: [0, 0, 0],
      axes: identityAxes(),
      axisStatus: ["degenerate", "degenerate", "degenerate"],
      degeneracy: "isotropic",
    };
  }

  const matrix = validated.matrix.map((row) =>
    row.map((value) => value / validated.scale),
  );
  const vectors = identityAxes().map((row) => [...row]);
  const pivots = [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const;
  const convergence = JACOBI_CONVERGENCE_ULP_FACTOR * Number.EPSILON;
  let converged = false;
  for (let sweep = 0; sweep < MAX_JACOBI_SWEEPS; sweep += 1) {
    for (const [p, q] of pivots) {
      const apq = matrix[p]![q]!;
      if (Math.abs(apq) <= convergence) continue;
      const app = matrix[p]![p]!;
      const aqq = matrix[q]![q]!;
      const tau = (aqq - app) / (2 * apq);
      const rotation =
        tau === 0
          ? 1
          : Math.sign(tau) / (Math.abs(tau) + Math.hypot(1, tau));
      const cosine = 1 / Math.hypot(1, rotation);
      const sine = rotation * cosine;
      matrix[p]![p] = app - rotation * apq;
      matrix[q]![q] = aqq + rotation * apq;
      matrix[p]![q] = 0;
      matrix[q]![p] = 0;
      for (let axis = 0; axis < 3; axis += 1) {
        if (axis !== p && axis !== q) {
          const aip = matrix[axis]![p]!;
          const aiq = matrix[axis]![q]!;
          const nextP = cosine * aip - sine * aiq;
          const nextQ = sine * aip + cosine * aiq;
          matrix[axis]![p] = nextP;
          matrix[p]![axis] = nextP;
          matrix[axis]![q] = nextQ;
          matrix[q]![axis] = nextQ;
        }
        const vip = vectors[axis]![p]!;
        const viq = vectors[axis]![q]!;
        vectors[axis]![p] = cosine * vip - sine * viq;
        vectors[axis]![q] = sine * vip + cosine * viq;
      }
    }
    const offDiagonal = Math.hypot(
      matrix[0]![1]!,
      matrix[0]![2]!,
      matrix[1]![2]!,
    );
    if (offDiagonal <= convergence) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    throw new RangeError("Principal inertia decomposition did not converge");
  }

  const negativeAllowance = SYMMETRY_ULP_FACTOR * Number.EPSILON;
  const pairs = [0, 1, 2]
    .map((column) => {
      let normalizedMoment = matrix[column]![column]!;
      if (normalizedMoment < -negativeAllowance) {
        throw new RangeError("An inertia tensor must be positive semidefinite");
      }
      if (normalizedMoment < 0) normalizedMoment = 0;
      const axis: Vec3 = [
        vectors[0]![column]!,
        vectors[1]![column]!,
        vectors[2]![column]!,
      ];
      return { normalizedMoment, axis, column };
    })
    .sort(
      (first, second) =>
        first.normalizedMoment - second.normalizedMoment ||
        first.column - second.column,
    );
  if (
    pairs[2]!.normalizedMoment >
    pairs[0]!.normalizedMoment +
      pairs[1]!.normalizedMoment +
      negativeAllowance
  ) {
    throw new RangeError("An inertia tensor violates the principal-moment triangle inequality");
  }

  const firstAxis = canonicalizeAxis(pairs[0]!.axis);
  const secondProjection = dot(pairs[1]!.axis, firstAxis);
  const orthogonalSecond: Vec3 = [
    pairs[1]!.axis[0] - secondProjection * firstAxis[0],
    pairs[1]!.axis[1] - secondProjection * firstAxis[1],
    pairs[1]!.axis[2] - secondProjection * firstAxis[2],
  ];
  const secondAxis = canonicalizeAxis(orthogonalSecond);
  const thirdAxis = normalize(cross(firstAxis, secondAxis), "Principal frame").map(
    clean,
  ) as unknown as Vec3;
  const moments = pairs.map((pair) => pair.normalizedMoment * validated.scale) as unknown as Vec3;
  if (!moments.every(Number.isFinite)) {
    throw new RangeError("Principal inertia moments overflowed numeric range");
  }
  const gapTolerance =
    absoluteTolerance +
    relativeTolerance * Math.max(Math.abs(moments[0]), Math.abs(moments[1]), Math.abs(moments[2]));
  if (!Number.isFinite(gapTolerance)) {
    throw new RangeError("Principal degeneracy tolerance overflowed numeric range");
  }
  const minimumGap = moments[1] - moments[0];
  const maximumGap = moments[2] - moments[1];
  const isotropic = moments[2] - moments[0] <= gapTolerance;
  const minimumRepeated =
    !isotropic && minimumGap <= gapTolerance && minimumGap <= maximumGap;
  const maximumRepeated =
    !isotropic && maximumGap <= gapTolerance && maximumGap < minimumGap;
  const degeneracy: PrincipalInertiaDegeneracy =
    isotropic
      ? "isotropic"
      : minimumRepeated
        ? "minimum-repeated"
        : maximumRepeated
          ? "maximum-repeated"
          : "distinct";
  const axisStatus: PrincipalInertiaResult["axisStatus"] =
    degeneracy === "distinct"
      ? ["unique", "unique", "unique"]
      : degeneracy === "minimum-repeated"
        ? ["degenerate", "degenerate", "unique"]
        : degeneracy === "maximum-repeated"
          ? ["unique", "degenerate", "degenerate"]
          : ["degenerate", "degenerate", "degenerate"];
  return {
    moments,
    axes: [firstAxis, secondAxis, thirdAxis],
    axisStatus,
    degeneracy,
  };
}

/**
 * Converts density-one volumetric properties into kg and kg*mm^2.
 * `massDensity` is expressed in kg/mm^3.
 */
export function physicalMassProperties(
  properties: VolumetricMassProperties,
  massDensity: number,
): PhysicalMassProperties {
  const validated = validateProperties(properties);
  if (!Number.isFinite(massDensity) || !(massDensity > 0)) {
    throw new RangeError("Mass density must be finite and strictly positive");
  }
  if (validated.weight === 0) {
    return { mass: 0, centerOfMass: null, inertiaTensor: zeroTensor() };
  }
  const inertia = validated.inertiaTensor;
  const result: PhysicalMassProperties = {
    mass: validated.weight * massDensity,
    centerOfMass: validated.centerOfMass,
    inertiaTensor: tensor(
      inertia[0][0] * massDensity,
      inertia[0][1] * massDensity,
      inertia[0][2] * massDensity,
      inertia[1][1] * massDensity,
      inertia[1][2] * massDensity,
      inertia[2][2] * massDensity,
    ),
  };
  validateProperties(result);
  return result;
}

/** Combines independent physical bodies with the parallel-axis theorem. */
export function combinePhysicalMassProperties(
  values: readonly PhysicalMassProperties[],
): PhysicalMassProperties {
  const validated = values.map(validateProperties);
  const nonEmpty = validated.filter(
    (value): value is typeof value & { readonly centerOfMass: Vec3 } =>
      value.weight > 0 && value.centerOfMass !== null,
  );
  if (nonEmpty.length === 0) {
    return { mass: 0, centerOfMass: null, inertiaTensor: zeroTensor() };
  }
  const reference = nonEmpty[0]!.centerOfMass;
  const massSum = new CompensatedSum();
  const first = [new CompensatedSum(), new CompensatedSum(), new CompensatedSum()];
  const localCenters = nonEmpty.map((value) => {
    massSum.add(value.weight);
    const local: Vec3 = [
      value.centerOfMass[0] - reference[0],
      value.centerOfMass[1] - reference[1],
      value.centerOfMass[2] - reference[2],
    ];
    for (let axis = 0; axis < 3; axis += 1) {
      first[axis]!.add(value.weight * local[axis]!);
    }
    return local;
  });
  const mass = massSum.value();
  const centerLocal: Vec3 = [
    first[0]!.value() / mass,
    first[1]!.value() / mass,
    first[2]!.value() / mass,
  ];
  const sums = Array.from({ length: 6 }, () => new CompensatedSum());
  for (let index = 0; index < nonEmpty.length; index += 1) {
    const value = nonEmpty[index]!;
    const local = localCenters[index]!;
    const dx = local[0] - centerLocal[0];
    const dy = local[1] - centerLocal[1];
    const dz = local[2] - centerLocal[2];
    const inertia = value.inertiaTensor;
    sums[0]!.add(inertia[0][0] + value.weight * (dy * dy + dz * dz));
    sums[1]!.add(inertia[0][1] - value.weight * dx * dy);
    sums[2]!.add(inertia[0][2] - value.weight * dx * dz);
    sums[3]!.add(inertia[1][1] + value.weight * (dx * dx + dz * dz));
    sums[4]!.add(inertia[1][2] - value.weight * dy * dz);
    sums[5]!.add(inertia[2][2] + value.weight * (dx * dx + dy * dy));
  }
  const result: PhysicalMassProperties = {
    mass,
    centerOfMass: [
      reference[0] + centerLocal[0],
      reference[1] + centerLocal[1],
      reference[2] + centerLocal[2],
    ],
    inertiaTensor: tensor(
      sums[0]!.value(),
      sums[1]!.value(),
      sums[2]!.value(),
      sums[3]!.value(),
      sums[4]!.value(),
      sums[5]!.value(),
    ),
  };
  validateProperties(result);
  return result;
}

/**
 * Returns the full inertia tensor about an arbitrary world-space point.
 * The result is mm^5 for volumetric input or kg*mm^2 for physical input.
 */
export function inertiaTensorAboutPoint(
  properties: InertiaPropertySource,
  point: Vec3,
): InertiaTensor {
  const validated = validateProperties(properties);
  if (!finiteVector(point)) {
    throw new RangeError("Inertia reference point must be finite");
  }
  if (validated.weight === 0 || validated.centerOfMass === null) {
    return zeroTensor();
  }
  const dx = validated.centerOfMass[0] - point[0];
  const dy = validated.centerOfMass[1] - point[1];
  const dz = validated.centerOfMass[2] - point[2];
  const inertia = validated.inertiaTensor;
  const result = tensor(
    inertia[0][0] + validated.weight * (dy * dy + dz * dz),
    inertia[0][1] - validated.weight * dx * dy,
    inertia[0][2] - validated.weight * dx * dz,
    inertia[1][1] + validated.weight * (dx * dx + dz * dz),
    inertia[1][2] - validated.weight * dy * dz,
    inertia[2][2] + validated.weight * (dx * dx + dy * dy),
  );
  principalInertia(result);
  return result;
}

/**
 * Returns the scalar moment about an arbitrary world-space line.
 * The result is mm^5 for volumetric input or kg*mm^2 for physical input.
 */
export function momentOfInertiaAboutAxis(
  properties: InertiaPropertySource,
  axis: InertiaAxis,
): number {
  const validated = validateProperties(properties);
  if (!finiteVector(axis.point)) {
    throw new RangeError("Inertia axis point must be finite");
  }
  const direction = normalize(axis.direction, "Inertia axis direction");
  if (validated.weight === 0 || validated.centerOfMass === null) return 0;
  const inertia = validated.inertiaTensor;
  const central =
    direction[0] *
      (inertia[0][0] * direction[0] +
        inertia[0][1] * direction[1] +
        inertia[0][2] * direction[2]) +
    direction[1] *
      (inertia[1][0] * direction[0] +
        inertia[1][1] * direction[1] +
        inertia[1][2] * direction[2]) +
    direction[2] *
      (inertia[2][0] * direction[0] +
        inertia[2][1] * direction[1] +
        inertia[2][2] * direction[2]);
  const offset: Vec3 = [
    validated.centerOfMass[0] - axis.point[0],
    validated.centerOfMass[1] - axis.point[1],
    validated.centerOfMass[2] - axis.point[2],
  ];
  const perpendicular = cross(offset, direction);
  const offsetMoment =
    validated.weight * dot(perpendicular, perpendicular);
  const result = central + offsetMoment;
  if (!Number.isFinite(result)) {
    throw new RangeError("Axis moment of inertia overflowed numeric range");
  }
  const allowance =
    SYMMETRY_ULP_FACTOR *
    Number.EPSILON *
    Math.max(
      validated.tensorScale,
      Math.abs(central),
      Math.abs(offsetMoment),
      Math.abs(result),
    );
  if (result < -allowance) {
    throw new RangeError("Axis moment of inertia must be non-negative");
  }
  return clean(result < 0 ? 0 : result);
}

/**
 * World-axis radii `sqrt(Ixx/w)`, `sqrt(Iyy/w)`, `sqrt(Izz/w)` in model
 * length units. The weight is volume for volumetric input and mass for
 * physical input.
 */
export function worldRadiiOfGyration(
  properties: InertiaPropertySource,
): Vec3 | null {
  const validated = validateProperties(properties);
  if (validated.weight === 0) return null;
  const inertia = validated.inertiaTensor;
  const diagonal = [inertia[0][0], inertia[1][1], inertia[2][2]] as const;
  return diagonal.map((moment) => {
    const allowance =
      SYMMETRY_ULP_FACTOR * Number.EPSILON * validated.tensorScale;
    if (moment < -allowance) {
      throw new RangeError("Radius of gyration requires non-negative inertia");
    }
    return stableRadius(
      Math.max(0, moment),
      validated.weight,
      "World radius of gyration",
    );
  }) as unknown as Vec3;
}

/**
 * Principal radii in model length units, corresponding to ascending
 * principal moments. Weight may be volumetric or physical.
 */
export function principalRadiiOfGyration(
  properties: InertiaPropertySource,
  options?: PrincipalInertiaOptions,
): Vec3 | null {
  const validated = validateProperties(properties);
  if (validated.weight === 0) return null;
  const principal = principalInertia(validated.inertiaTensor, options);
  return principal.moments.map((moment) =>
    stableRadius(moment, validated.weight, "Principal radius of gyration"),
  ) as unknown as Vec3;
}

/**
 * Radius of gyration in model length units about an arbitrary world-space
 * line. Weight may be volumetric or physical.
 */
export function radiusOfGyrationAboutAxis(
  properties: InertiaPropertySource,
  axis: InertiaAxis,
): number | null {
  const validated = validateProperties(properties);
  if (validated.weight === 0) return null;
  return stableRadius(
    momentOfInertiaAboutAxis(properties, axis),
    validated.weight,
    "Axis radius of gyration",
  );
}
