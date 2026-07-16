import type { Vec3 } from "./core/math.js";
import type { MeshData } from "./kernel.js";

export type MeshExportFormat = "stl" | "stl-ascii" | "obj";

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross: Vec3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...cross);
  if (length < Number.EPSILON) return [0, 0, 0];
  return [cross[0] / length, cross[1] / length, cross[2] / length];
}

function vertex(mesh: MeshData, index: number): Vec3 {
  const offset = index * 3;
  return [
    mesh.positions[offset]!,
    mesh.positions[offset + 1]!,
    mesh.positions[offset + 2]!,
  ];
}

function validateMesh(mesh: MeshData): void {
  if (mesh.positions.length % 3 !== 0 || mesh.indices.length % 3 !== 0) {
    throw new TypeError("Mesh arrays must contain XYZ vertices and triangle indices");
  }
  const count = mesh.positions.length / 3;
  for (const index of mesh.indices) {
    if (index >= count) throw new RangeError(`Mesh index ${index} is out of bounds`);
  }
}

export function exportBinaryStl(mesh: MeshData, name = "InvariantCAD"): Uint8Array {
  validateMesh(mesh);
  const triangleCount = mesh.indices.length / 3;
  const output = new Uint8Array(84 + triangleCount * 50);
  const header = new TextEncoder().encode(name.slice(0, 80));
  output.set(header, 0);
  const view = new DataView(output.buffer);
  view.setUint32(80, triangleCount, true);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = vertex(mesh, mesh.indices[triangle * 3]!);
    const b = vertex(mesh, mesh.indices[triangle * 3 + 1]!);
    const c = vertex(mesh, mesh.indices[triangle * 3 + 2]!);
    const normal = triangleNormal(a, b, c);
    const offset = 84 + triangle * 50;
    const values = [...normal, ...a, ...b, ...c];
    values.forEach((value, index) =>
      view.setFloat32(offset + index * 4, value, true),
    );
    view.setUint16(offset + 48, 0, true);
  }
  return output;
}

export function exportAsciiStl(mesh: MeshData, name = "InvariantCAD"): string {
  validateMesh(mesh);
  const lines = [`solid ${name.replaceAll(/\s+/g, "_")}`];
  for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
    const a = vertex(mesh, mesh.indices[triangle]!);
    const b = vertex(mesh, mesh.indices[triangle + 1]!);
    const c = vertex(mesh, mesh.indices[triangle + 2]!);
    const normal = triangleNormal(a, b, c);
    lines.push(`  facet normal ${normal.join(" ")}`);
    lines.push("    outer loop");
    lines.push(`      vertex ${a.join(" ")}`);
    lines.push(`      vertex ${b.join(" ")}`);
    lines.push(`      vertex ${c.join(" ")}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }
  lines.push(`endsolid ${name.replaceAll(/\s+/g, "_")}`);
  return `${lines.join("\n")}\n`;
}

export function exportObj(mesh: MeshData, name = "InvariantCAD"): string {
  validateMesh(mesh);
  const lines = [`o ${name.replaceAll(/\s+/g, "_")}`];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    lines.push(
      `v ${mesh.positions[index]} ${mesh.positions[index + 1]} ${mesh.positions[index + 2]}`,
    );
  }
  for (let index = 0; index < mesh.indices.length; index += 3) {
    lines.push(
      `f ${mesh.indices[index]! + 1} ${mesh.indices[index + 1]! + 1} ${mesh.indices[index + 2]! + 1}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function exportMesh(
  mesh: MeshData,
  format: MeshExportFormat,
  name?: string,
): Uint8Array | string {
  switch (format) {
    case "stl":
      return exportBinaryStl(mesh, name);
    case "stl-ascii":
      return exportAsciiStl(mesh, name);
    case "obj":
      return exportObj(mesh, name);
  }
}
