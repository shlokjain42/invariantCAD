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
  KernelCurveDescriptor,
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelSurfaceDescriptor,
  KernelTopologyKey,
  KernelTopologyLineage,
  KernelTopologySnapshot,
} from "./protocol/topology.js";
import type {
  NumericPlane,
  ResolvedArcCurve,
  ResolvedCurve,
  ResolvedLoop,
  ResolvedProfile,
} from "./protocol/profile.js";

const OCCT_SHAPE = Symbol("InvariantCAD.OcctShape");
const TOPOLOGY_HASH_UPPER_BOUND = 2_147_483_647;

type TopologyHistory = KernelTopologySnapshot["history"];

interface RetainedTopologyHandle {
  readonly topology: "face" | "edge";
  readonly handle: ShapeHandle;
}

class OcctShape implements KernelShape {
  readonly kernel = "occt";
  readonly [OCCT_SHAPE]: ShapeHandle;
  readonly serial: number;
  readonly lineage: readonly KernelTopologyLineage[];
  readonly history: TopologyHistory;
  readonly topologyHandles = new Map<KernelTopologyKey, RetainedTopologyHandle>();
  topologySnapshot: KernelTopologySnapshot | undefined;
  disposed = false;

  constructor(
    handle: ShapeHandle,
    serial: number,
    lineage: readonly KernelTopologyLineage[],
    history: TopologyHistory,
  ) {
    this[OCCT_SHAPE] = handle;
    this.serial = serial;
    this.lineage = lineage;
    this.history = history;
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

function vectorFromOcct(value: OcctVec3): Vec3 {
  return [value.x, value.y, value.z];
}

function topologyKey(
  serial: number,
  topology: "face" | "edge",
  index: number,
): KernelTopologyKey {
  return `${serial}:${topology}:${index}` as KernelTopologyKey;
}

function uniqueLineage(
  values: readonly KernelTopologyLineage[],
): readonly KernelTopologyLineage[] {
  const unique = new Map<string, KernelTopologyLineage>();
  for (const value of values) {
    const source = value.source;
    const key = [
      value.feature,
      value.relation,
      value.role ?? "",
      source?.kind ?? "",
      source?.sketch ?? "",
      source?.entity ?? "",
    ].join("\u0000");
    unique.set(key, value);
  }
  return Object.freeze([...unique.values()]);
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
    features: ["extrude", "revolve", "boolean", "transform", "fillet"],
    nativeImports: ["step", "brep", "brep-binary"],
    nativeExports: ["step", "brep", "brep-binary"],
    topology: {
      kinds: ["face", "edge"],
      provenance: "feature",
      semanticRoles: false,
      sketchSources: false,
      geometry: true,
      adjacency: true,
    },
  };
  private readonly raw: RawOcctKernel;
  private readonly tessellation: MeshOptions;
  private readonly modelingTolerance: number;
  private readonly liveShapes = new Set<OcctShape>();
  private nextShapeSerial = 1;
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

  private own(
    handle: ShapeHandle,
    context?: KernelFeatureContext,
    options: {
      readonly inherited?: readonly KernelTopologyLineage[];
      readonly relation?: "created" | "modified";
      readonly history?: TopologyHistory;
    } = {},
  ): KernelShape {
    this.assertKernelLive();
    const lineage = uniqueLineage([
      ...(options.inherited ?? []),
      ...(context?.feature === undefined
        ? []
        : [
            {
              feature: context.feature,
              relation: options.relation ?? "created",
            } as const,
          ]),
    ]);
    const shape = new OcctShape(
      handle,
      this.nextShapeSerial,
      lineage,
      options.history ?? "complete",
    );
    this.nextShapeSerial += 1;
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
    if (!center) return this.own(box, context);
    try {
      return this.own(
        this.raw.translate(box, -size[0] / 2, -size[1] / 2, -size[2] / 2),
        context,
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
    if (!center) return this.own(cylinder, context);
    try {
      return this.own(
        this.raw.translate(cylinder, 0, 0, -height / 2),
        context,
      );
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
    return this.own(this.raw.makeSphere(radius), context);
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
      return this.own(result, context);
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
        context,
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
    const targetShape = this.shape(target);
    const toolShapes = tools.map((tool) => this.shape(tool));
    const targetHandle = targetShape[OCCT_SHAPE];
    const toolHandles = toolShapes.map((tool) => tool[OCCT_SHAPE]);
    const inherited = uniqueLineage([
      ...targetShape.lineage,
      ...toolShapes.flatMap((tool) => tool.lineage),
    ]);
    if (operation === "union") {
      return this.own(
        this.raw.fuseAll([targetHandle, ...toolHandles]),
        context,
        { inherited, relation: "modified", history: "partial" },
      );
    }
    if (operation === "subtract") {
      return this.own(this.raw.cutAll(targetHandle, toolHandles), context, {
        inherited,
        relation: "modified",
        history: "partial",
      });
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
      return this.own(current, context, {
        inherited,
        relation: "modified",
        history: "partial",
      });
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
    const inputShape = this.shape(shape);
    let current = inputShape[OCCT_SHAPE];
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
      return this.own(current, context, {
        inherited: inputShape.lineage,
        relation: "modified",
        history: inputShape.history,
      });
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
          context,
          { history: "partial" },
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
          context,
          { history: "partial" },
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
          context,
          { history: "partial" },
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

  private topologyBounds(handle: ShapeHandle): {
    readonly min: Vec3;
    readonly max: Vec3;
  } {
    const bounds = this.raw.getBoundingBox(handle, false);
    return {
      min: [bounds.xmin, bounds.ymin, bounds.zmin],
      max: [bounds.xmax, bounds.ymax, bounds.zmax],
    };
  }

  private surfaceDescriptor(face: ShapeHandle): KernelSurfaceDescriptor {
    const kind = this.raw.surfaceType(face);
    let normal: Vec3 | undefined;
    let radius: number | undefined;
    if (kind === "plane") {
      const center = this.raw.getSurfaceCenterOfMass(face);
      const uv = this.raw.uvFromPoint(face, center);
      normal = vectorFromOcct(this.raw.surfaceNormal(face, uv.u, uv.v));
    } else if (kind === "cylinder") {
      radius = this.raw.getFaceCylinderData(face)?.radius;
    }
    return {
      kind,
      ...(normal === undefined ? {} : { normal }),
      ...(radius === undefined ? {} : { radius }),
    };
  }

  private curveDescriptor(edge: ShapeHandle): KernelCurveDescriptor {
    const kind = this.raw.curveType(edge);
    let direction: Vec3 | undefined;
    let radius: number | undefined;
    if (kind === "line") {
      const parameters = this.raw.curveParameters(edge);
      direction = vectorFromOcct(
        this.raw.curveTangent(edge, (parameters.first + parameters.last) / 2),
      );
    } else if (kind === "circle") {
      if (this.raw.curveIsClosed(edge)) {
        radius = this.raw.curveLength(edge) / (Math.PI * 2);
      } else {
        const parameters = this.raw.curveParameters(edge);
        const first = vectorFromOcct(
          this.raw.curvePointAtParam(edge, parameters.first),
        );
        const middle = vectorFromOcct(
          this.raw.curvePointAtParam(
            edge,
            (parameters.first + parameters.last) / 2,
          ),
        );
        const last = vectorFromOcct(
          this.raw.curvePointAtParam(edge, parameters.last),
        );
        const side = (a: Vec3, b: Vec3): number =>
          Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        const ab: Vec3 = [
          middle[0] - first[0],
          middle[1] - first[1],
          middle[2] - first[2],
        ];
        const ac: Vec3 = [
          last[0] - first[0],
          last[1] - first[1],
          last[2] - first[2],
        ];
        const cross: Vec3 = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
        const denominator = 2 * Math.hypot(...cross);
        if (denominator > Number.EPSILON) {
          radius =
            (side(first, middle) * side(middle, last) * side(last, first)) /
            denominator;
        }
      }
    }
    return {
      kind,
      ...(direction === undefined ? {} : { direction }),
      ...(radius === undefined ? {} : { radius }),
    };
  }

  topology(shape: KernelShape): KernelTopologySnapshot {
    const owned = this.shape(shape);
    if (owned.topologySnapshot !== undefined) return owned.topologySnapshot;

    const faceHandles: ShapeHandle[] = [];
    const edgeHandles: ShapeHandle[] = [];
    try {
      faceHandles.push(...this.raw.getSubShapes(owned[OCCT_SHAPE], "face"));
      edgeHandles.push(...this.raw.getSubShapes(owned[OCCT_SHAPE], "edge"));

      const faceKeys = faceHandles.map((_, index) =>
        topologyKey(owned.serial, "face", index),
      );
      const edgeKeys = edgeHandles.map((_, index) =>
        topologyKey(owned.serial, "edge", index),
      );
      const faceEdges = faceHandles.map(() => new Set<KernelTopologyKey>());
      const edgeFaces = edgeHandles.map(() => new Set<KernelTopologyKey>());
      const edgeHashBuckets = new Map<number, number[]>();
      edgeHandles.forEach((edge, index) => {
        const hash = this.raw.hashCode(edge, TOPOLOGY_HASH_UPPER_BOUND);
        const bucket = edgeHashBuckets.get(hash);
        if (bucket === undefined) edgeHashBuckets.set(hash, [index]);
        else bucket.push(index);
      });

      faceHandles.forEach((face, faceIndex) => {
        const nestedEdges = this.raw.getSubShapes(face, "edge");
        try {
          for (const nestedEdge of nestedEdges) {
            const hash = this.raw.hashCode(
              nestedEdge,
              TOPOLOGY_HASH_UPPER_BOUND,
            );
            const candidates = edgeHashBuckets.get(hash) ?? [];
            const edgeIndex = candidates.find((candidate) =>
              this.raw.isSame(nestedEdge, edgeHandles[candidate]!),
            );
            if (edgeIndex === undefined) {
              throw new Error("OCCT returned a face edge absent from the parent shape");
            }
            faceEdges[faceIndex]!.add(edgeKeys[edgeIndex]!);
            edgeFaces[edgeIndex]!.add(faceKeys[faceIndex]!);
          }
        } finally {
          this.releaseHandles(nestedEdges);
        }
      });

      const faces: readonly KernelFaceDescriptor[] = faceHandles.map(
        (face, index) => ({
          topology: "face",
          key: faceKeys[index]!,
          center: vectorFromOcct(this.raw.getSurfaceCenterOfMass(face)),
          bounds: this.topologyBounds(face),
          lineage: owned.lineage,
          area: this.raw.getSurfaceArea(face),
          surface: this.surfaceDescriptor(face),
          edges: Object.freeze([...faceEdges[index]!].sort()),
        }),
      );
      const edges: readonly KernelEdgeDescriptor[] = edgeHandles.map(
        (edge, index) => ({
          topology: "edge",
          key: edgeKeys[index]!,
          center: vectorFromOcct(this.raw.getLinearCenterOfMass(edge)),
          bounds: this.topologyBounds(edge),
          lineage: owned.lineage,
          length: this.raw.curveLength(edge),
          curve: this.curveDescriptor(edge),
          faces: Object.freeze([...edgeFaces[index]!].sort()),
        }),
      );
      faceHandles.forEach((handle, index) => {
        owned.topologyHandles.set(faceKeys[index]!, {
          topology: "face",
          handle,
        });
      });
      edgeHandles.forEach((handle, index) => {
        owned.topologyHandles.set(edgeKeys[index]!, {
          topology: "edge",
          handle,
        });
      });
      const snapshot: KernelTopologySnapshot = Object.freeze({
        history: owned.history,
        faces: Object.freeze(faces),
        edges: Object.freeze(edges),
      });
      owned.topologySnapshot = snapshot;
      return snapshot;
    } catch (error) {
      owned.topologyHandles.clear();
      owned.topologySnapshot = undefined;
      this.releaseHandles(edgeHandles);
      this.releaseHandles(faceHandles);
      throw error;
    }
  }

  fillet(
    shape: KernelShape,
    edges: readonly KernelTopologyKey[],
    options: { readonly radius: number },
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (!(options.radius > 0)) throw new RangeError("Fillet radius must be positive");
    if (edges.length === 0) throw new RangeError("Fillet requires at least one edge");
    const input = this.shape(shape);
    this.topology(input);
    const handles = edges.map((key) => {
      const retained = input.topologyHandles.get(key);
      if (retained?.topology !== "edge") {
        throw new TypeError(`Topology key '${key}' is not an edge of the input shape`);
      }
      return retained.handle;
    });
    const faceHashes = this.raw.subShapeHashes(
      input[OCCT_SHAPE],
      "face",
      TOPOLOGY_HASH_UPPER_BOUND,
    );
    const evolution = this.raw.filletWithHistory(
      input[OCCT_SHAPE],
      handles,
      options.radius,
      faceHashes,
      TOPOLOGY_HASH_UPPER_BOUND,
    );
    return this.own(evolution.result, context, {
      inherited: input.lineage,
      relation: "modified",
      history: "partial",
    });
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
    for (const retained of shape.topologyHandles.values()) {
      this.raw.release(retained.handle);
    }
    shape.topologyHandles.clear();
    shape.topologySnapshot = undefined;
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
