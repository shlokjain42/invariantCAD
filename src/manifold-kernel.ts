import initializeManifold, {
  type Manifold as ManifoldSolid,
  type ManifoldToplevel,
  type Mat4 as ManifoldMat4,
} from "manifold-3d";
import type { Mat4, Vec3 } from "./core/math.js";
import type {
  GeometryKernel,
  KernelCapabilities,
  KernelShape,
  MeshData,
  ResolvedTransformOperation,
  ShapeMeasurements,
} from "./kernel.js";
import {
  numericPlaneBasis,
  tessellateProfile,
  type NumericPlane,
  type ResolvedProfile,
} from "./protocol/profile.js";

const MANIFOLD_SHAPE = Symbol("InvariantCAD.ManifoldShape");

class ManifoldShape implements KernelShape {
  readonly kernel = "manifold";
  readonly [MANIFOLD_SHAPE]: ManifoldSolid;
  disposed = false;

  constructor(shape: ManifoldSolid) {
    this[MANIFOLD_SHAPE] = shape;
  }
}

let modulePromise: Promise<ManifoldToplevel> | undefined;
let configuredWasmUrl: string | undefined;

async function loadManifold(wasmUrl?: string): Promise<ManifoldToplevel> {
  if (modulePromise !== undefined) {
    if (wasmUrl !== undefined && wasmUrl !== configuredWasmUrl) {
      throw new Error(
        "The Manifold runtime is already initialized with a different WASM URL",
      );
    }
    return modulePromise;
  }
  configuredWasmUrl = wasmUrl;
  modulePromise = initializeManifold(
    wasmUrl === undefined ? undefined : { locateFile: () => wasmUrl },
  ).then((module) => {
    module.setup();
    return module;
  });
  return modulePromise;
}

function asManifoldShape(shape: KernelShape): ManifoldShape {
  if (!(shape instanceof ManifoldShape) || shape.disposed) {
    throw new TypeError("Expected a live Manifold kernel shape");
  }
  return shape;
}

function matrixFromColumns(a: Vec3, b: Vec3, c: Vec3, origin: Vec3): Mat4 {
  return [
    a[0], a[1], a[2], 0,
    b[0], b[1], b[2], 0,
    c[0], c[1], c[2], 0,
    origin[0], origin[1], origin[2], 1,
  ];
}

function extrusionMatrix(plane: NumericPlane): Mat4 {
  const { u, v, n } = numericPlaneBasis(plane);
  return matrixFromColumns(u, v, n, plane.origin);
}

function revolutionMatrix(plane: NumericPlane): Mat4 {
  const { u, v, n } = numericPlaneBasis(plane);
  const negativeNormal: Vec3 = [-n[0], -n[1], -n[2]];
  return matrixFromColumns(u, negativeNormal, v, plane.origin);
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export interface ManifoldKernelOptions {
  readonly wasmUrl?: string;
}

export class ManifoldKernel implements GeometryKernel {
  readonly id = "manifold";
  readonly capabilities: KernelCapabilities = {
    protocolVersion: 1,
    representation: "mesh",
    exact: false,
    primitives: ["box", "cylinder", "sphere"],
    features: ["extrude", "revolve", "boolean", "transform"],
    nativeImports: [],
    nativeExports: [],
  };
  private readonly module: ManifoldToplevel;
  private readonly liveShapes = new Set<ManifoldShape>();

  constructor(module: ManifoldToplevel) {
    this.module = module;
  }

  private own(shape: ManifoldSolid): ManifoldShape {
    const wrapped = new ManifoldShape(shape);
    this.liveShapes.add(wrapped);
    return wrapped;
  }

  box(size: Vec3, center: boolean): KernelShape {
    return this.own(this.module.Manifold.cube(size, center));
  }

  cylinder(
    height: number,
    radiusBottom: number,
    radiusTop: number,
    center: boolean,
    segments?: number,
  ): KernelShape {
    return this.own(
      this.module.Manifold.cylinder(
        height,
        radiusBottom,
        radiusTop,
        segments,
        center,
      ),
    );
  }

  sphere(radius: number, segments?: number): KernelShape {
    return this.own(this.module.Manifold.sphere(radius, segments));
  }

  extrude(
    profile: ResolvedProfile,
    options: {
      readonly distance: number;
      readonly symmetric: boolean;
      readonly twist: number;
      readonly scaleTop: readonly [number, number];
      readonly divisions: number;
    },
  ): KernelShape {
    const contours = tessellateProfile(profile).contours.map((contour) =>
      contour.map((point) => [point[0], point[1]] as [number, number]),
    );
    const section = new this.module.CrossSection(contours, "EvenOdd");
    let local: ManifoldSolid;
    try {
      local = section.extrude(
        options.distance,
        options.divisions,
        radiansToDegrees(options.twist),
        options.scaleTop,
        options.symmetric,
      );
    } finally {
      section.delete();
    }
    const placed = local.transform(
      extrusionMatrix(profile.plane) as ManifoldMat4,
    );
    local.delete();
    return this.own(placed);
  }

  revolve(
    profile: ResolvedProfile,
    options: { readonly angle: number; readonly segments?: number },
  ): KernelShape {
    const contours = tessellateProfile(profile).contours.map((contour) =>
      contour.map((point) => [point[0], point[1]] as [number, number]),
    );
    const section = new this.module.CrossSection(contours, "EvenOdd");
    let local: ManifoldSolid;
    try {
      local = section.revolve(options.segments, radiansToDegrees(options.angle));
    } finally {
      section.delete();
    }
    const placed = local.transform(
      revolutionMatrix(profile.plane) as ManifoldMat4,
    );
    local.delete();
    return this.own(placed);
  }

  boolean(
    operation: "union" | "subtract" | "intersect",
    target: KernelShape,
    tools: readonly KernelShape[],
  ): KernelShape {
    const shapes = [
      asManifoldShape(target)[MANIFOLD_SHAPE],
      ...tools.map((tool) => asManifoldShape(tool)[MANIFOLD_SHAPE]),
    ];
    const result =
      operation === "union"
        ? this.module.Manifold.union(shapes)
        : operation === "subtract"
          ? this.module.Manifold.difference(shapes)
          : this.module.Manifold.intersection(shapes);
    return this.own(result);
  }

  transform(
    shape: KernelShape,
    operations: readonly ResolvedTransformOperation[],
  ): KernelShape {
    let current = asManifoldShape(shape)[MANIFOLD_SHAPE];
    let ownsCurrent = false;
    for (const operation of operations) {
      const next =
        operation.kind === "translate"
          ? current.translate(operation.value)
          : operation.kind === "rotate"
            ? current.rotate(operation.value.map(radiansToDegrees) as unknown as Vec3)
            : operation.kind === "scale"
              ? current.scale(operation.value)
              : current.mirror(operation.normal);
      if (ownsCurrent) current.delete();
      current = next;
      ownsCurrent = true;
    }
    return this.own(current);
  }

  mesh(shape: KernelShape): MeshData {
    const mesh = asManifoldShape(shape)[MANIFOLD_SHAPE].getMesh();
    const positions = new Float32Array(mesh.numVert * 3);
    for (let vertex = 0; vertex < mesh.numVert; vertex += 1) {
      positions[vertex * 3] = mesh.vertProperties[vertex * mesh.numProp]!;
      positions[vertex * 3 + 1] = mesh.vertProperties[vertex * mesh.numProp + 1]!;
      positions[vertex * 3 + 2] = mesh.vertProperties[vertex * mesh.numProp + 2]!;
    }
    return { positions, indices: mesh.triVerts.slice() };
  }

  measure(shape: KernelShape): ShapeMeasurements {
    const manifold = asManifoldShape(shape)[MANIFOLD_SHAPE];
    const bounds = manifold.boundingBox();
    return {
      volume: manifold.volume(),
      surfaceArea: manifold.surfaceArea(),
      boundingBox: {
        min: bounds.min as Vec3,
        max: bounds.max as Vec3,
      },
      genus: manifold.genus(),
      tolerance: manifold.tolerance(),
    };
  }

  status(shape: KernelShape) {
    const code = asManifoldShape(shape)[MANIFOLD_SHAPE].status();
    return {
      ok: code === "NoError",
      code,
      ...(code === "NoError" ? {} : { message: `Manifold reported ${code}` }),
    };
  }

  disposeShape(shape: KernelShape): void {
    if (!(shape instanceof ManifoldShape)) {
      throw new TypeError("Expected a Manifold kernel shape");
    }
    const wrapped = shape;
    if (wrapped.disposed) return;
    wrapped[MANIFOLD_SHAPE].delete();
    wrapped.disposed = true;
    this.liveShapes.delete(wrapped);
  }

  dispose(): void {
    for (const shape of [...this.liveShapes]) this.disposeShape(shape);
  }
}

export async function createManifoldKernel(
  options: ManifoldKernelOptions = {},
): Promise<GeometryKernel> {
  return new ManifoldKernel(await loadManifold(options.wasmUrl));
}
