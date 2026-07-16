import type {
  OcctKernel as RawOcctKernel,
  ShapeHandle,
  Vec3 as OcctVec3,
} from "occt-wasm";
import type { Vec2, Vec3 } from "./core/math.js";
import type {
  GeometryKernel,
  KernelCapabilities,
  KernelExchangeFormat,
  KernelFeatureContext,
  KernelShape,
  KernelShapeStatus,
  MeshData,
  MeshOptions,
  ResolvedTransformOperation,
  ShapeMeasurements,
} from "./kernel.js";
import type {
  NumericPlane,
  ResolvedArcCurve,
  ResolvedCurve,
  ResolvedLoop,
  ResolvedProfile,
} from "./protocol/profile.js";

const OCCT_SHAPE = Symbol("InvariantCAD.OcctShape");

class OcctShape implements KernelShape {
  readonly kernel = "occt";
  readonly [OCCT_SHAPE]: ShapeHandle;
  disposed = false;

  constructor(handle: ShapeHandle) {
    this[OCCT_SHAPE] = handle;
  }
}

interface PlaneBasis {
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

function planeBasis(plane: NumericPlane): PlaneBasis {
  switch (plane.plane) {
    case "XY":
      return { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
    case "XZ":
      return { u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] };
    case "YZ":
      return { u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] };
  }
}

function occtVector(value: Vec3): OcctVec3 {
  return { x: value[0], y: value[1], z: value[2] };
}

function arrayBufferCopy(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function pointOnPlane(point: Vec2, plane: NumericPlane): OcctVec3 {
  const { u, v } = planeBasis(plane);
  return {
    x: plane.origin[0] + point[0] * u[0] + point[1] * v[0],
    y: plane.origin[1] + point[0] * u[1] + point[1] * v[1],
    z: plane.origin[2] + point[0] * u[2] + point[1] * v[2],
  };
}

function arcSweep(curve: ResolvedArcCurve): number {
  let sweep = curve.endAngle - curve.startAngle;
  if (curve.clockwise && sweep > 0) sweep -= Math.PI * 2;
  if (!curve.clockwise && sweep < 0) sweep += Math.PI * 2;
  return sweep;
}

function arcPoint(curve: ResolvedArcCurve, angle: number): Vec2 {
  return [
    curve.center[0] + curve.radius * Math.cos(angle),
    curve.center[1] + curve.radius * Math.sin(angle),
  ];
}

function checkContext(context?: KernelFeatureContext): void {
  if (context?.signal?.aborted) {
    throw new DOMException("CAD kernel operation was aborted", "AbortError");
  }
}

export type OcctWasmSource = string | URL | ArrayBuffer | Uint8Array;

export interface OcctKernelOptions {
  readonly wasm?: OcctWasmSource;
  readonly tessellation?: MeshOptions;
  readonly modelingTolerance?: number;
  readonly onOutput?: (message: string) => void;
  readonly onError?: (message: string) => void;
}

class OcctKernel implements GeometryKernel {
  readonly id = "occt";
  readonly capabilities: KernelCapabilities = {
    protocolVersion: 1,
    representation: "brep",
    exact: true,
    primitives: ["box", "cylinder", "sphere"],
    features: ["extrude", "revolve", "boolean", "transform"],
    nativeImports: ["step", "brep", "brep-binary"],
    nativeExports: ["step", "brep", "brep-binary"],
  };
  private readonly raw: RawOcctKernel;
  private readonly tessellation: MeshOptions;
  private readonly modelingTolerance: number;
  private readonly liveShapes = new Set<OcctShape>();
  private disposed = false;

  constructor(raw: RawOcctKernel, options: OcctKernelOptions = {}) {
    this.raw = raw;
    this.tessellation = options.tessellation ?? {};
    this.modelingTolerance = options.modelingTolerance ?? 1e-7;
  }

  private assertKernelLive(): void {
    if (this.disposed) throw new Error("This OCCT kernel has been disposed");
  }

  private shape(shape: KernelShape): OcctShape {
    this.assertKernelLive();
    if (!(shape instanceof OcctShape) || shape.disposed) {
      throw new TypeError("Expected a live OCCT kernel shape");
    }
    return shape;
  }

  private own(handle: ShapeHandle): KernelShape {
    this.assertKernelLive();
    const shape = new OcctShape(handle);
    this.liveShapes.add(shape);
    return shape;
  }

  private releaseHandles(handles: readonly ShapeHandle[]): void {
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      this.raw.release(handles[index]!);
    }
  }

  private curveHandle(
    curve: ResolvedCurve,
    plane: NumericPlane,
    allocated: ShapeHandle[],
  ): ShapeHandle {
    let handle: ShapeHandle;
    switch (curve.kind) {
      case "line":
        handle = this.raw.makeLineEdge(
          pointOnPlane(curve.start, plane),
          pointOnPlane(curve.end, plane),
        );
        break;
      case "arc": {
        const sweep = arcSweep(curve);
        const middle = curve.startAngle + sweep / 2;
        handle = this.raw.makeArcEdge(
          pointOnPlane(arcPoint(curve, curve.startAngle), plane),
          pointOnPlane(arcPoint(curve, middle), plane),
          pointOnPlane(arcPoint(curve, curve.endAngle), plane),
        );
        break;
      }
      case "circle": {
        const basis = planeBasis(plane);
        handle = this.raw.makeCircleEdge(
          pointOnPlane(curve.center, plane),
          occtVector(basis.n),
          curve.radius,
        );
        if (curve.reversed) {
          allocated.push(handle);
          handle = this.raw.reverseShape(handle);
        }
        break;
      }
    }
    allocated.push(handle);
    return handle;
  }

  private loopWire(
    loop: ResolvedLoop,
    plane: NumericPlane,
    allocated: ShapeHandle[],
  ): ShapeHandle {
    const edges = loop.curves.map((curve) =>
      this.curveHandle(curve, plane, allocated),
    );
    const wire = this.raw.makeWire(edges);
    allocated.push(wire);
    return wire;
  }

  private profileFace(
    profile: ResolvedProfile,
  ): { readonly face: ShapeHandle; readonly allocated: readonly ShapeHandle[] } {
    const allocated: ShapeHandle[] = [];
    try {
      const outerWire = this.loopWire(profile.outer, profile.plane, allocated);
      let face = this.raw.makeFace(outerWire);
      allocated.push(face);
      if (profile.holes.length > 0) {
        const holes = profile.holes.map((loop) =>
          this.loopWire(loop, profile.plane, allocated),
        );
        face = this.raw.addHolesInFace(face, holes);
        allocated.push(face);
      }
      return { face, allocated };
    } catch (error) {
      this.releaseHandles(allocated);
      throw error;
    }
  }

  box(
    size: Vec3,
    center: boolean,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const box = this.raw.makeBox(size[0], size[1], size[2]);
    if (!center) return this.own(box);
    try {
      return this.own(
        this.raw.translate(box, -size[0] / 2, -size[1] / 2, -size[2] / 2),
      );
    } finally {
      this.raw.release(box);
    }
  }

  cylinder(
    height: number,
    radiusBottom: number,
    radiusTop: number,
    center: boolean,
    _segments?: number,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const cylinder =
      Math.abs(radiusBottom - radiusTop) <= this.modelingTolerance
        ? this.raw.makeCylinder(radiusBottom, height)
        : this.raw.makeCone(radiusBottom, radiusTop, height);
    if (!center) return this.own(cylinder);
    try {
      return this.own(this.raw.translate(cylinder, 0, 0, -height / 2));
    } finally {
      this.raw.release(cylinder);
    }
  }

  sphere(
    radius: number,
    _segments?: number,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    return this.own(this.raw.makeSphere(radius));
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
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (
      Math.abs(options.twist) > this.modelingTolerance ||
      Math.abs(options.scaleTop[0] - 1) > this.modelingTolerance ||
      Math.abs(options.scaleTop[1] - 1) > this.modelingTolerance ||
      options.divisions !== 0
    ) {
      throw new RangeError(
        "The OCCT exact extrude currently requires zero twist, unit top scale, and zero divisions",
      );
    }
    const built = this.profileFace(profile);
    const normal = planeBasis(profile.plane).n;
    let result: ShapeHandle | undefined;
    try {
      result = this.raw.extrude(
        built.face,
        normal[0] * options.distance,
        normal[1] * options.distance,
        normal[2] * options.distance,
      );
      if (options.symmetric) {
        const centered = this.raw.translate(
          result,
          normal[0] * -options.distance * 0.5,
          normal[1] * -options.distance * 0.5,
          normal[2] * -options.distance * 0.5,
        );
        this.raw.release(result);
        result = centered;
      }
      return this.own(result);
    } catch (error) {
      if (result !== undefined) this.raw.release(result);
      throw error;
    } finally {
      this.releaseHandles(built.allocated);
    }
  }

  revolve(
    profile: ResolvedProfile,
    options: { readonly angle: number; readonly segments?: number },
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const built = this.profileFace(profile);
    const axis = planeBasis(profile.plane).v;
    try {
      return this.own(
        this.raw.revolve(
          built.face,
          {
            point: {
              x: profile.plane.origin[0],
              y: profile.plane.origin[1],
              z: profile.plane.origin[2],
            },
            direction: occtVector(axis),
          },
          options.angle,
        ),
      );
    } finally {
      this.releaseHandles(built.allocated);
    }
  }

  boolean(
    operation: "union" | "subtract" | "intersect",
    target: KernelShape,
    tools: readonly KernelShape[],
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const targetHandle = this.shape(target)[OCCT_SHAPE];
    const toolHandles = tools.map((tool) => this.shape(tool)[OCCT_SHAPE]);
    if (operation === "union") {
      return this.own(this.raw.fuseAll([targetHandle, ...toolHandles]));
    }
    if (operation === "subtract") {
      return this.own(this.raw.cutAll(targetHandle, toolHandles));
    }
    let current = targetHandle;
    let ownsCurrent = false;
    try {
      for (const tool of toolHandles) {
        checkContext(context);
        const next = this.raw.common(current, tool);
        if (ownsCurrent) this.raw.release(current);
        current = next;
        ownsCurrent = true;
      }
      return this.own(current);
    } catch (error) {
      if (ownsCurrent) this.raw.release(current);
      throw error;
    }
  }

  transform(
    shape: KernelShape,
    operations: readonly ResolvedTransformOperation[],
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    let current = this.shape(shape)[OCCT_SHAPE];
    let ownsCurrent = false;
    const replace = (next: ShapeHandle): void => {
      if (ownsCurrent) this.raw.release(current);
      current = next;
      ownsCurrent = true;
    };
    try {
      for (const operation of operations) {
        checkContext(context);
        switch (operation.kind) {
          case "translate":
            replace(
              this.raw.translate(
                current,
                operation.value[0],
                operation.value[1],
                operation.value[2],
              ),
            );
            break;
          case "rotate": {
            const axes: readonly Vec3[] = [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ];
            for (let index = 0; index < 3; index += 1) {
              const angle = operation.value[index]!;
              if (Math.abs(angle) <= Number.EPSILON) continue;
              replace(
                this.raw.rotate(
                  current,
                  { point: { x: 0, y: 0, z: 0 }, direction: occtVector(axes[index]!) },
                  angle,
                ),
              );
            }
            break;
          }
          case "scale":
            if (
              Math.abs(operation.value[0] - operation.value[1]) <=
                this.modelingTolerance &&
              Math.abs(operation.value[1] - operation.value[2]) <=
                this.modelingTolerance
            ) {
              replace(
                this.raw.scale(
                  current,
                  { x: 0, y: 0, z: 0 },
                  operation.value[0],
                ),
              );
            } else {
              replace(
                this.raw.generalTransform(current, [
                  operation.value[0], 0, 0, 0,
                  0, operation.value[1], 0, 0,
                  0, 0, operation.value[2], 0,
                ]),
              );
            }
            break;
          case "mirror":
            replace(
              this.raw.mirror(
                current,
                { x: 0, y: 0, z: 0 },
                occtVector(operation.normal),
              ),
            );
            break;
        }
      }
      if (!ownsCurrent) {
        current = this.raw.copy(current);
        ownsCurrent = true;
      }
      return this.own(current);
    } catch (error) {
      if (ownsCurrent) this.raw.release(current);
      throw error;
    }
  }

  importShape(
    data: string | ArrayBuffer | Uint8Array,
    format: KernelExchangeFormat,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    switch (format) {
      case "step":
        return this.own(
          this.raw.importStep(
            data instanceof Uint8Array
              ? arrayBufferCopy(data)
              : data,
          ),
        );
      case "brep":
        return this.own(
          this.raw.fromBREP(
            typeof data === "string"
              ? data
              : new TextDecoder().decode(
                  data instanceof Uint8Array ? data : new Uint8Array(data),
                ),
          ),
        );
      case "brep-binary":
        return this.own(
          this.raw.fromBREPBinary(
            typeof data === "string"
              ? new TextEncoder().encode(data)
              : data instanceof Uint8Array
                ? data
                : new Uint8Array(data),
          ),
        );
    }
  }

  exportShape(
    shape: KernelShape,
    format: KernelExchangeFormat,
    context?: KernelFeatureContext,
  ): Uint8Array {
    checkContext(context);
    const handle = this.shape(shape)[OCCT_SHAPE];
    switch (format) {
      case "step":
        return new TextEncoder().encode(this.raw.exportStep(handle));
      case "brep":
        return new TextEncoder().encode(this.raw.toBREP(handle));
      case "brep-binary":
        return this.raw.toBREPBinary(handle).slice();
    }
  }

  mesh(shape: KernelShape, options: MeshOptions = {}): MeshData {
    const handle = this.shape(shape)[OCCT_SHAPE];
    const merged = { ...this.tessellation, ...options };
    const mesh = this.raw.tessellate(handle, {
      ...(merged.linearDeflection === undefined
        ? {}
        : { linearDeflection: merged.linearDeflection }),
      ...(merged.angularDeflection === undefined
        ? {}
        : { angularDeflection: merged.angularDeflection }),
      ...(merged.relative === undefined ? {} : { relative: merged.relative }),
    });
    return {
      positions: mesh.positions.slice(),
      indices: mesh.indices.slice(),
    };
  }

  measure(shape: KernelShape): ShapeMeasurements {
    const handle = this.shape(shape)[OCCT_SHAPE];
    const bounds = this.raw.getBoundingBox(handle, false);
    const vertices = this.raw.subShapeCount(handle, "vertex");
    const edges = this.raw.subShapeCount(handle, "edge");
    const faces = this.raw.subShapeCount(handle, "face");
    const eulerCharacteristic = vertices - edges + faces;
    return {
      volume: this.raw.getVolume(handle),
      surfaceArea: this.raw.getSurfaceArea(handle),
      boundingBox: {
        min: [bounds.xmin, bounds.ymin, bounds.zmin],
        max: [bounds.xmax, bounds.ymax, bounds.zmax],
      },
      genus: Math.max(0, Math.round((2 - eulerCharacteristic) / 2)),
      tolerance: this.modelingTolerance,
    };
  }

  status(shape: KernelShape): KernelShapeStatus {
    try {
      const handle = this.shape(shape)[OCCT_SHAPE];
      if (this.raw.isNull(handle)) {
        return {
          ok: false,
          code: "NULL_SHAPE",
          message: "OpenCascade produced a null shape",
        };
      }
      const valid = this.raw.isValid(handle);
      return valid
        ? { ok: true, code: "VALID" }
        : {
            ok: false,
            code: "INVALID_SHAPE",
            message: "OpenCascade shape validation failed",
          };
    } catch (error) {
      return {
        ok: false,
        code: "STATUS_ERROR",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  disposeShape(shape: KernelShape): void {
    if (!(shape instanceof OcctShape)) {
      throw new TypeError("Expected an OCCT kernel shape");
    }
    if (shape.disposed) return;
    this.assertKernelLive();
    this.raw.release(shape[OCCT_SHAPE]);
    shape.disposed = true;
    this.liveShapes.delete(shape);
  }

  dispose(): void {
    if (this.disposed) return;
    for (const shape of [...this.liveShapes]) this.disposeShape(shape);
    this.raw[Symbol.dispose]();
    this.disposed = true;
  }
}

export async function createOcctKernel(
  options: OcctKernelOptions = {},
): Promise<GeometryKernel> {
  const [{ OcctKernel: RawKernel }, { default: createModule }] =
    await Promise.all([
      import("occt-wasm"),
      import("occt-wasm/dist/occt-wasm.js"),
    ]);
  const moduleOptions: {
    wasmBinary?: ArrayBuffer;
    locateFile?: (path: string) => string;
    print: (message: string) => void;
    printErr?: (message: string) => void;
  } = {
    print: options.onOutput ?? (() => {}),
    ...(options.onError === undefined ? {} : { printErr: options.onError }),
  };
  if (options.wasm instanceof ArrayBuffer) {
    moduleOptions.wasmBinary = options.wasm;
  } else if (options.wasm instanceof Uint8Array) {
    moduleOptions.wasmBinary = arrayBufferCopy(options.wasm);
  } else if (options.wasm !== undefined) {
    const location =
      options.wasm instanceof URL ? options.wasm.href : options.wasm;
    moduleOptions.locateFile = (path) =>
      path.endsWith(".wasm") ? location : path;
  }
  const module = await createModule(moduleOptions);
  const KernelConstructor = RawKernel as unknown as new (
    module: unknown,
  ) => RawOcctKernel;
  const raw = new KernelConstructor(module);
  return new OcctKernel(raw, options);
}
