import type { Mat4, Vec3 } from "./core/math.js";
import type { NumericProfile } from "./solver.js";

export type KernelRepresentation = "mesh" | "brep" | "sdf";
export type KernelPrimitive = "box" | "cylinder" | "sphere";
export type KernelFeature = "extrude" | "revolve" | "boolean" | "transform";
export type KernelCapabilityKind = "primitive" | "feature" | "export";

export interface KernelCapabilities {
  readonly representation: KernelRepresentation;
  readonly exact: boolean;
  readonly primitives: readonly KernelPrimitive[];
  readonly features: readonly KernelFeature[];
  readonly exports: readonly string[];
}

export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: "primitive",
  capability: KernelPrimitive,
): boolean;
export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: "feature",
  capability: KernelFeature,
): boolean;
export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: "export",
  capability: string,
): boolean;
export function kernelSupports(
  capabilities: KernelCapabilities,
  kind: KernelCapabilityKind,
  capability: string,
): boolean {
  const supported =
    kind === "primitive"
      ? capabilities.primitives
      : kind === "feature"
        ? capabilities.features
        : capabilities.exports;
  return (supported as readonly string[]).includes(capability);
}

export interface KernelShape {
  readonly kernel: string;
}

export interface MeshData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface ShapeMeasurements {
  readonly volume: number;
  readonly surfaceArea: number;
  readonly boundingBox: BoundingBox;
  readonly genus: number;
  readonly tolerance: number;
}

export type ResolvedTransformOperation =
  | { readonly kind: "translate"; readonly value: Vec3 }
  | { readonly kind: "rotate"; readonly value: Vec3 }
  | { readonly kind: "scale"; readonly value: Vec3 }
  | { readonly kind: "mirror"; readonly normal: Vec3 };

export interface GeometryKernel {
  readonly id: string;
  readonly capabilities: KernelCapabilities;

  box(size: Vec3, center: boolean): KernelShape;
  cylinder(
    height: number,
    radiusBottom: number,
    radiusTop: number,
    center: boolean,
    segments?: number,
  ): KernelShape;
  sphere(radius: number, segments?: number): KernelShape;
  extrude(
    profile: NumericProfile,
    options: {
      readonly distance: number;
      readonly symmetric: boolean;
      readonly twist: number;
      readonly scaleTop: readonly [number, number];
      readonly divisions: number;
    },
  ): KernelShape;
  revolve(
    profile: NumericProfile,
    options: { readonly angle: number; readonly segments?: number },
  ): KernelShape;
  boolean(
    operation: "union" | "subtract" | "intersect",
    target: KernelShape,
    tools: readonly KernelShape[],
  ): KernelShape;
  transform(
    shape: KernelShape,
    operations: readonly ResolvedTransformOperation[],
  ): KernelShape;
  mesh(shape: KernelShape): MeshData;
  measure(shape: KernelShape): ShapeMeasurements;
  status(shape: KernelShape): string;
  disposeShape(shape: KernelShape): void;
  dispose(): void;
}

export function transformMesh(mesh: MeshData, matrix: Mat4): MeshData {
  const positions = new Float32Array(mesh.positions.length);
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const x = mesh.positions[index]!;
    const y = mesh.positions[index + 1]!;
    const z = mesh.positions[index + 2]!;
    positions[index] =
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    positions[index + 1] =
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    positions[index + 2] =
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  }
  return { positions, indices: mesh.indices.slice() };
}

export function mergeMeshes(meshes: readonly MeshData[]): MeshData {
  const positionLength = meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0);
  const indexLength = meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const positions = new Float32Array(positionLength);
  const indices = new Uint32Array(indexLength);
  let positionOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset);
    for (let index = 0; index < mesh.indices.length; index += 1) {
      indices[indexOffset + index] = mesh.indices[index]! + vertexOffset;
    }
    positionOffset += mesh.positions.length;
    indexOffset += mesh.indices.length;
    vertexOffset += mesh.positions.length / 3;
  }
  return { positions, indices };
}
