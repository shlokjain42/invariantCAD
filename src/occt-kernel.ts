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
  KernelTopologySource,
  TopologyRole,
} from "./protocol/topology.js";
import type {
  NumericPlane,
  ResolvedArcCurve,
  ResolvedCurve,
  ResolvedLoop,
  ResolvedProfile,
} from "./protocol/profile.js";
import { curveStart } from "./protocol/profile.js";

const OCCT_SHAPE = Symbol("InvariantCAD.OcctShape");
const TOPOLOGY_HASH_UPPER_BOUND = 2_147_483_647;

type TopologyHistory = KernelTopologySnapshot["history"];

interface RetainedTopologyHandle {
  readonly topology: "face" | "edge";
  readonly handle: ShapeHandle;
}

type TopologyDescriptor = KernelFaceDescriptor | KernelEdgeDescriptor;

interface TopologyLineageSeed {
  readonly topology: "face" | "edge";
  readonly geometryKind: string;
  readonly center: Vec3;
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
  readonly measure: number;
  readonly lineage: readonly KernelTopologyLineage[];
}

interface TopologyAnnotation {
  readonly classify?: (
    descriptor: TopologyDescriptor,
  ) => readonly KernelTopologyLineage[];
  readonly seeds?: readonly TopologyLineageSeed[];
  readonly expectedRoles?: {
    readonly feature: string;
    readonly counts: Readonly<Partial<Record<TopologyRole, number>>>;
  };
  readonly requireSeedCoverage?: boolean;
}

class OcctShape implements KernelShape {
  readonly kernel = "occt";
  readonly [OCCT_SHAPE]: ShapeHandle;
  readonly serial: number;
  readonly lineage: readonly KernelTopologyLineage[];
  readonly history: TopologyHistory;
  readonly annotation: TopologyAnnotation | undefined;
  readonly topologyHandles = new Map<KernelTopologyKey, RetainedTopologyHandle>();
  topologySnapshot: KernelTopologySnapshot | undefined;
  disposed = false;

  constructor(
    handle: ShapeHandle,
    serial: number,
    lineage: readonly KernelTopologyLineage[],
    history: TopologyHistory,
    annotation?: TopologyAnnotation,
  ) {
    this[OCCT_SHAPE] = handle;
    this.serial = serial;
    this.lineage = lineage;
    this.history = history;
    this.annotation = annotation;
  }
}

interface PlaneBasis {
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

interface ProfileCurveHandle {
  readonly curve: ResolvedCurve;
  readonly handle: ShapeHandle;
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

function semanticLineage(
  context: KernelFeatureContext | undefined,
  role: TopologyRole,
  source?: KernelTopologySource,
): readonly KernelTopologyLineage[] {
  if (context?.feature === undefined) return [];
  return [
    {
      feature: context.feature,
      relation: "created",
      role,
      ...(source === undefined ? {} : { source }),
    },
  ];
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
      semanticRoles: true,
      sketchSources: true,
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
      readonly annotation?: TopologyAnnotation;
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
      options.annotation,
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
    curveHandles: ProfileCurveHandle[],
  ): ShapeHandle {
    const edges = loop.curves.map((curve) => {
      const handle = this.curveHandle(curve, plane, allocated);
      curveHandles.push({ curve, handle });
      return handle;
    });
    const wire = this.raw.makeWire(edges);
    allocated.push(wire);
    return wire;
  }

  private profileFace(
    profile: ResolvedProfile,
  ): {
    readonly face: ShapeHandle;
    readonly allocated: readonly ShapeHandle[];
    readonly curves: readonly ProfileCurveHandle[];
  } {
    const allocated: ShapeHandle[] = [];
    const curves: ProfileCurveHandle[] = [];
    try {
      const outerWire = this.loopWire(
        profile.outer,
        profile.plane,
        allocated,
        curves,
      );
      let face = this.raw.makeFace(outerWire);
      allocated.push(face);
      if (profile.holes.length > 0) {
        const holes = profile.holes.map((loop) =>
          this.loopWire(loop, profile.plane, allocated, curves),
        );
        face = this.raw.addHolesInFace(face, holes);
        allocated.push(face);
      }
      return { face, allocated, curves };
    } catch (error) {
      this.releaseHandles(allocated);
      throw error;
    }
  }

  private boxTopologyAnnotation(
    context: KernelFeatureContext | undefined,
    min: Vec3,
    max: Vec3,
  ): TopologyAnnotation {
    return {
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: Object.fromEntries(
                [
                  "box.face.x-min",
                  "box.face.x-max",
                  "box.face.y-min",
                  "box.face.y-max",
                  "box.face.z-min",
                  "box.face.z-max",
                  "box.edge.x-min-y-min",
                  "box.edge.x-min-y-max",
                  "box.edge.x-max-y-min",
                  "box.edge.x-max-y-max",
                  "box.edge.x-min-z-min",
                  "box.edge.x-min-z-max",
                  "box.edge.x-max-z-min",
                  "box.edge.x-max-z-max",
                  "box.edge.y-min-z-min",
                  "box.edge.y-min-z-max",
                  "box.edge.y-max-z-min",
                  "box.edge.y-max-z-max",
                ].map((role) => [role, 1]),
              ) as Partial<Record<TopologyRole, number>>,
            },
          }),
      classify: (descriptor) => {
        if (descriptor.topology === "face") {
          const normal = descriptor.surface.normal;
          if (normal === undefined) return [];
          const absolute = normal.map(Math.abs);
          const axis = absolute.indexOf(Math.max(...absolute));
          const sign = normal[axis]! < 0 ? "min" : "max";
          const role = `box.face.${["x", "y", "z"][axis]}-${sign}` as TopologyRole;
          return semanticLineage(context, role);
        }
        const direction = descriptor.curve.direction;
        if (direction === undefined) return [];
        const absolute = direction.map(Math.abs);
        const parallelAxis = absolute.indexOf(Math.max(...absolute));
        const axisNames = ["x", "y", "z"] as const;
        const boundary = (axis: number): string =>
          `${axisNames[axis]}-${
            Math.abs(descriptor.center[axis]! - min[axis]!) <=
            Math.abs(descriptor.center[axis]! - max[axis]!)
              ? "min"
              : "max"
          }`;
        const boundaryAxes = [0, 1, 2].filter(
          (axis) => axis !== parallelAxis,
        );
        const role = `box.edge.${boundary(boundaryAxes[0]!)}-${boundary(
          boundaryAxes[1]!,
        )}` as TopologyRole;
        return semanticLineage(context, role);
      },
    };
  }

  private cylinderTopologyAnnotation(
    context: KernelFeatureContext | undefined,
    zMin: number,
    zMax: number,
    hasStart: boolean,
    hasEnd: boolean,
  ): TopologyAnnotation {
    return {
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: {
                "cylinder.face.side": 1,
                ...(hasStart
                  ? {
                      "cylinder.face.start-cap": 1,
                      "cylinder.edge.start-rim": 1,
                    }
                  : {}),
                ...(hasEnd
                  ? {
                      "cylinder.face.end-cap": 1,
                      "cylinder.edge.end-rim": 1,
                    }
                  : {}),
              },
            },
          }),
      classify: (descriptor) => {
        if (descriptor.topology === "face") {
          if (descriptor.surface.kind === "plane") {
            const role =
              Math.abs(descriptor.center[2] - zMin) <=
              Math.abs(descriptor.center[2] - zMax)
              ? "cylinder.face.start-cap"
              : "cylinder.face.end-cap";
            return semanticLineage(context, role);
          }
          return descriptor.surface.kind === "cylinder" ||
            descriptor.surface.kind === "cone"
            ? semanticLineage(context, "cylinder.face.side")
            : [];
        }
        if (descriptor.curve.kind === "circle") {
          const distanceToBottom = Math.abs(descriptor.center[2] - zMin);
          const distanceToTop = Math.abs(descriptor.center[2] - zMax);
          if (descriptor.length <= this.modelingTolerance) return [];
          return semanticLineage(
            context,
            distanceToBottom <= distanceToTop
              ? "cylinder.edge.start-rim"
              : "cylinder.edge.end-rim",
          );
        }
        return [];
      },
    };
  }

  private sphereTopologyAnnotation(
    context?: KernelFeatureContext,
  ): TopologyAnnotation {
    return {
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: { "sphere.face.surface": 1 },
            },
          }),
      classify: (descriptor) =>
        descriptor.topology === "face" && descriptor.surface.kind === "sphere"
          ? semanticLineage(context, "sphere.face.surface")
          : [],
    };
  }

  private extrudeTopologyAnnotation(
    profile: ResolvedProfile,
    curves: readonly ProfileCurveHandle[],
    options: { readonly distance: number; readonly symmetric: boolean },
    context?: KernelFeatureContext,
  ): TopologyAnnotation {
    const basis = planeBasis(profile.plane);
    const vector: Vec3 = basis.n.map(
      (value) => value * options.distance,
    ) as unknown as Vec3;
    const startOffset: Vec3 = basis.n.map((value) =>
      options.symmetric ? value * -options.distance * 0.5 : 0,
    ) as unknown as Vec3;
    const endOffset: Vec3 = startOffset.map(
      (value, index) => value + vector[index]!,
    ) as unknown as Vec3;
    const temporary: ShapeHandle[] = [];
    const translated = (handle: ShapeHandle, offset: Vec3): ShapeHandle => {
      const copy =
        Math.hypot(...offset) <= Number.EPSILON
          ? this.raw.copy(handle)
          : this.raw.translate(handle, offset[0], offset[1], offset[2]);
      temporary.push(copy);
      return copy;
    };
    const sourceOf = (
      curve: ResolvedCurve,
    ): KernelTopologySource | undefined =>
      curve.source === undefined
        ? undefined
        : {
            kind: "sketch-entity",
            sketch: curve.source.sketch,
            entity: curve.source.entity,
          };
    const seeds: TopologyLineageSeed[] = [];
    try {
      for (const item of curves) {
        const source = sourceOf(item.curve);
        let side = this.raw.extrude(
          item.handle,
          vector[0],
          vector[1],
          vector[2],
        );
        temporary.push(side);
        if (Math.hypot(...startOffset) > Number.EPSILON) {
          const centered = this.raw.translate(
            side,
            startOffset[0],
            startOffset[1],
            startOffset[2],
          );
          temporary.push(centered);
          side = centered;
        }
        seeds.push(
          this.topologySeedFromHandle(
            side,
            "face",
            semanticLineage(context, "extrude.face.side", source),
          ),
        );

        seeds.push(
          this.topologySeedFromHandle(
            translated(item.handle, startOffset),
            "edge",
            semanticLineage(
              context,
              "extrude.edge.start-rim",
              source,
            ),
          ),
          this.topologySeedFromHandle(
            translated(item.handle, endOffset),
            "edge",
            semanticLineage(
              context,
              "extrude.edge.end-rim",
              source,
            ),
          ),
        );

        if (item.curve.kind !== "circle") {
          const localStart = pointOnPlane(curveStart(item.curve), profile.plane);
          const lateralStart: OcctVec3 = {
            x: localStart.x + startOffset[0],
            y: localStart.y + startOffset[1],
            z: localStart.z + startOffset[2],
          };
          const lateralEnd: OcctVec3 = {
            x: lateralStart.x + vector[0],
            y: lateralStart.y + vector[1],
            z: lateralStart.z + vector[2],
          };
          const lateral = this.raw.makeLineEdge(lateralStart, lateralEnd);
          temporary.push(lateral);
          seeds.push(
            this.topologySeedFromHandle(
              lateral,
              "edge",
              semanticLineage(context, "extrude.edge.lateral"),
            ),
          );
        }
      }
    } finally {
      this.releaseHandles(temporary);
    }

    return {
      seeds,
      ...(context?.feature === undefined
        ? {}
        : {
            expectedRoles: {
              feature: context.feature,
              counts: {
                "extrude.face.start-cap": 1,
                "extrude.face.end-cap": 1,
                "extrude.face.side": curves.length,
                "extrude.edge.start-rim": curves.length,
                "extrude.edge.end-rim": curves.length,
                "extrude.edge.lateral": curves.filter(
                  (item) => item.curve.kind !== "circle",
                ).length,
              },
            },
          }),
      classify: (descriptor) => {
        if (descriptor.topology !== "face") return [];
        const normal = descriptor.surface.normal;
        if (normal === undefined) return [];
        const normalMagnitude = Math.hypot(...normal);
        if (!(normalMagnitude > Number.EPSILON)) return [];
        const dot =
          (normal[0] * vector[0] +
            normal[1] * vector[1] +
            normal[2] * vector[2]) /
          (normalMagnitude * Math.hypot(...vector));
        if (Math.abs(dot) < 1 - 1e-8) return [];
        return semanticLineage(
          context,
          dot < 0 ? "extrude.face.start-cap" : "extrude.face.end-cap",
        );
      },
    };
  }

  box(
    size: Vec3,
    center: boolean,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    const box = this.raw.makeBox(size[0], size[1], size[2]);
    const min: Vec3 = center
      ? [-size[0] / 2, -size[1] / 2, -size[2] / 2]
      : [0, 0, 0];
    const max: Vec3 = [
      min[0] + size[0],
      min[1] + size[1],
      min[2] + size[2],
    ];
    const annotation = this.boxTopologyAnnotation(context, min, max);
    if (!center) return this.own(box, context, { annotation });
    try {
      return this.own(
        this.raw.translate(box, -size[0] / 2, -size[1] / 2, -size[2] / 2),
        context,
        { annotation },
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
    const annotation = this.cylinderTopologyAnnotation(
      context,
      center ? -height / 2 : 0,
      center ? height / 2 : height,
      radiusBottom > this.modelingTolerance,
      radiusTop > this.modelingTolerance,
    );
    if (!center) return this.own(cylinder, context, { annotation });
    try {
      return this.own(
        this.raw.translate(cylinder, 0, 0, -height / 2),
        context,
        { annotation },
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
    return this.own(this.raw.makeSphere(radius), context, {
      annotation: this.sphereTopologyAnnotation(context),
    });
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
      return this.own(result, context, {
        annotation: this.extrudeTopologyAnnotation(
          profile,
          built.curves,
          options,
          context,
        ),
      });
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

  private applyTransformOperations(
    source: ShapeHandle,
    operations: readonly ResolvedTransformOperation[],
    context?: KernelFeatureContext,
  ): ShapeHandle {
    let current = source;
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
      return current;
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
    const current = this.applyTransformOperations(
      inputShape[OCCT_SHAPE],
      operations,
      context,
    );
    try {
      const inputSnapshot = this.topology(inputShape);
      let annotation: TopologyAnnotation | undefined;
      if (inputSnapshot.history === "complete") {
        const seeds: TopologyLineageSeed[] = [];
        const modified: readonly KernelTopologyLineage[] =
          context?.feature === undefined
            ? []
            : [{ feature: context.feature, relation: "modified" }];
        for (const descriptor of [
          ...inputSnapshot.faces,
          ...inputSnapshot.edges,
        ]) {
          const retained = inputShape.topologyHandles.get(descriptor.key);
          if (retained === undefined) {
            throw new Error("OCCT topology snapshot lost a retained subshape handle");
          }
          const transformed = this.applyTransformOperations(
            retained.handle,
            operations,
            context,
          );
          try {
            seeds.push(
              this.topologySeedFromHandle(
                transformed,
                descriptor.topology,
                uniqueLineage([...descriptor.lineage, ...modified]),
              ),
            );
          } finally {
            this.raw.release(transformed);
          }
        }
        annotation = { seeds, requireSeedCoverage: true };
      }
      return this.own(current, context, {
        inherited: inputShape.lineage,
        relation: "modified",
        history: inputSnapshot.history,
        ...(annotation === undefined ? {} : { annotation }),
      });
    } catch (error) {
      this.raw.release(current);
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

  private topologySeedFromHandle(
    handle: ShapeHandle,
    topology: "face" | "edge",
    lineage: readonly KernelTopologyLineage[],
  ): TopologyLineageSeed {
    return topology === "face"
      ? {
          topology,
          geometryKind: this.raw.surfaceType(handle),
          center: vectorFromOcct(this.raw.getSurfaceCenterOfMass(handle)),
          bounds: this.topologyBounds(handle),
          measure: this.raw.getSurfaceArea(handle),
          lineage,
        }
      : {
          topology,
          geometryKind: this.raw.curveType(handle),
          center: vectorFromOcct(this.raw.getLinearCenterOfMass(handle)),
          bounds: this.topologyBounds(handle),
          measure: this.raw.curveLength(handle),
          lineage,
        };
  }

  private topologySeedMatches(
    seed: TopologyLineageSeed,
    descriptor: TopologyDescriptor,
  ): boolean {
    if (seed.topology !== descriptor.topology) return false;
    const geometryKind =
      descriptor.topology === "face"
        ? descriptor.surface.kind
        : descriptor.curve.kind;
    if (seed.geometryKind !== geometryKind) return false;
    const close = (first: number, second: number): boolean =>
      Math.abs(first - second) <=
      Math.max(
        this.modelingTolerance * 20,
        Math.max(1, Math.abs(first), Math.abs(second)) * 1e-8,
      );
    const descriptorMeasure =
      descriptor.topology === "face" ? descriptor.area : descriptor.length;
    return (
      close(seed.measure, descriptorMeasure) &&
      seed.center.every((value, index) => close(value, descriptor.center[index]!)) &&
      seed.bounds.min.every((value, index) =>
        close(value, descriptor.bounds.min[index]!),
      ) &&
      seed.bounds.max.every((value, index) =>
        close(value, descriptor.bounds.max[index]!),
      )
    );
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

      const baseFaces: readonly KernelFaceDescriptor[] = faceHandles.map(
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
      const baseEdges: readonly KernelEdgeDescriptor[] = edgeHandles.map(
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
      const baseDescriptors: readonly TopologyDescriptor[] = [
        ...baseFaces,
        ...baseEdges,
      ];
      const seededLineage = new Map<
        KernelTopologyKey,
        KernelTopologyLineage[]
      >();
      const seedMatches = new Map<KernelTopologyKey, number>();
      let annotationComplete = true;
      for (const seed of owned.annotation?.seeds ?? []) {
        const matches = baseDescriptors.filter((descriptor) =>
          this.topologySeedMatches(seed, descriptor),
        );
        if (matches.length !== 1) {
          annotationComplete = false;
          continue;
        }
        seedMatches.set(
          matches[0]!.key,
          (seedMatches.get(matches[0]!.key) ?? 0) + 1,
        );
        const existing = seededLineage.get(matches[0]!.key);
        if (existing === undefined) {
          seededLineage.set(matches[0]!.key, [...seed.lineage]);
        } else {
          existing.push(...seed.lineage);
        }
      }
      if (
        owned.annotation?.requireSeedCoverage === true &&
        baseDescriptors.some(
          (descriptor) => seedMatches.get(descriptor.key) !== 1,
        )
      ) {
        annotationComplete = false;
      }
      const annotate = <T extends TopologyDescriptor>(descriptor: T): T => {
        const lineage = uniqueLineage([
          ...descriptor.lineage,
          ...(owned.annotation?.classify?.(descriptor) ?? []),
          ...(seededLineage.get(descriptor.key) ?? []),
        ]);
        return { ...descriptor, lineage };
      };
      const faces = baseFaces.map(annotate);
      const edges = baseEdges.map(annotate);
      const expectedRoles = owned.annotation?.expectedRoles;
      if (expectedRoles !== undefined) {
        const actual = new Map<TopologyRole, number>();
        for (const descriptor of [...faces, ...edges]) {
          for (const lineage of descriptor.lineage) {
            if (
              lineage.feature === expectedRoles.feature &&
              lineage.role !== undefined
            ) {
              actual.set(lineage.role, (actual.get(lineage.role) ?? 0) + 1);
            }
          }
        }
        const expected = Object.entries(expectedRoles.counts) as readonly [
          TopologyRole,
          number,
        ][];
        if (
          expected.some(([role, count]) => (actual.get(role) ?? 0) !== count) ||
          [...actual].some(
            ([role, count]) => expectedRoles.counts[role] !== count,
          )
        ) {
          annotationComplete = false;
        }
      }

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
        history:
          owned.history === "complete" && annotationComplete
            ? "complete"
            : "partial",
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
