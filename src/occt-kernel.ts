import { TransitionMode } from "occt-wasm";
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
import {
  validateRuledSolidLoftProfiles,
  type ResolvedLoftOptions,
} from "./protocol/loft.js";
import {
  resolvedCompositePathSegments,
  resolvedCircularArcGeometry,
  resolvedPathEdgeCount,
  resolvedPathSegmentLength,
  type ResolvedCircularArcDefinition,
  type ResolvedCircularArcPath,
  type ResolvedCompositePath,
  type ResolvedPath,
  type ResolvedPathSegment,
  type ResolvedPolylinePath,
} from "./protocol/path.js";
import {
  validateResolvedSweep,
  type ResolvedSweepOptions,
} from "./protocol/sweep.js";
import type { ResolvedOffsetOptions } from "./protocol/offset.js";
import type { ResolvedShellOptions } from "./protocol/shell.js";
import {
  DRAFT_MIN_ANGLE_RADIANS,
  type ResolvedDraftOptions,
} from "./protocol/draft.js";
import { adoptOcctEdgeEvolution } from "./internal/occt-evolution.js";
import {
  OcctDraftFacadeProtocolError,
  adoptOcctDraft,
  probeOcctDraftFacade,
  type OcctDraftFacadeModule,
  type OcctDraftReportSnapshot,
} from "./internal/occt-draft.js";
import {
  TopologyEvolutionProtocolError,
  reduceIndexedTopologyEvolution,
  type IndexedTopologyCounts,
} from "./internal/topology-evolution.js";

const OCCT_SHAPE = Symbol("InvariantCAD.OcctShape");
const TOPOLOGY_HASH_UPPER_BOUND = 2_147_483_647;
let nextTopologyNamespace = 1;

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
  readonly volumeOverride: number | undefined;
  readonly topologyHandles = new Map<KernelTopologyKey, RetainedTopologyHandle>();
  topologySnapshot: KernelTopologySnapshot | undefined;
  disposed = false;

  constructor(
    handle: ShapeHandle,
    serial: number,
    lineage: readonly KernelTopologyLineage[],
    history: TopologyHistory,
    annotation?: TopologyAnnotation,
    volumeOverride?: number,
  ) {
    this[OCCT_SHAPE] = handle;
    this.serial = serial;
    this.lineage = lineage;
    this.history = history;
    this.annotation = annotation;
    this.volumeOverride = volumeOverride;
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

function vectorDistance(first: Vec3, second: Vec3): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function topologyKey(
  namespace: number,
  serial: number,
  topology: "face" | "edge",
  index: number,
): KernelTopologyKey {
  return `${namespace}:${serial}:${topology}:${index}` as KernelTopologyKey;
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

// Polyline sweeps use BRepOffsetAPI_MakePipeShell, whose Tol3d and BoundTol
// both default to 1e-4.
const OCCT_PIPE_SHELL_LINEAR_TOLERANCE = 1e-4;
// The exact circular-revolution transfer cannot reliably distinguish all
// three authored arc points below this scale-independent conditioning floor.
const OCCT_CIRCULAR_ARC_MIN_POINT_SINE = 3e-8;

function circularArcMinimumPointSine(
  path: ResolvedCircularArcDefinition,
): number {
  const through: Vec3 = [
    path.through[0] - path.start[0],
    path.through[1] - path.start[1],
    path.through[2] - path.start[2],
  ];
  const end: Vec3 = [
    path.end[0] - path.start[0],
    path.end[1] - path.start[1],
    path.end[2] - path.start[2],
  ];
  const planeNormal: Vec3 = [
    through[1] * end[2] - through[2] * end[1],
    through[2] * end[0] - through[0] * end[2],
    through[0] * end[1] - through[1] * end[0],
  ];
  const startThrough = Math.hypot(...through);
  const startEnd = Math.hypot(...end);
  const throughEnd = Math.hypot(
    path.end[0] - path.through[0],
    path.end[1] - path.through[1],
    path.end[2] - path.through[2],
  );
  const doubleArea = Math.hypot(...planeNormal);
  return Math.min(
    doubleArea / (startThrough * startEnd),
    doubleArea / (startThrough * throughEnd),
    doubleArea / (startEnd * throughEnd),
  );
}

function resolvedProfileCurveLength(curve: ResolvedCurve): number {
  switch (curve.kind) {
    case "line":
      return Math.hypot(
        curve.end[0] - curve.start[0],
        curve.end[1] - curve.start[1],
      );
    case "arc":
      return curve.radius * Math.abs(arcSweep(curve));
    case "circle":
      return curve.radius * Math.PI * 2;
  }
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

function assertDraftVector(
  value: unknown,
  label: string,
  nonzero: boolean,
): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} must be a three-component vector`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "number" || !Number.isFinite(value[index])) {
      throw new TypeError(`${label}[${index}] must be finite`);
    }
  }
  if (nonzero && !(Math.hypot(value[0]!, value[1]!, value[2]!) > 0)) {
    throw new RangeError(`${label} must be nonzero`);
  }
}

function validateDraftOptions(options: ResolvedDraftOptions): void {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("Draft options must be an object");
  }
  if (
    typeof options.angle !== "number" ||
    !Number.isFinite(options.angle) ||
    !(Math.abs(options.angle) > DRAFT_MIN_ANGLE_RADIANS) ||
    !(Math.abs(options.angle) < Math.PI / 2)
  ) {
    throw new RangeError(
      "Draft angle must satisfy 1e-4 < abs(angle) < pi / 2 radians",
    );
  }
  assertDraftVector(options.pullDirection, "Draft pull direction", true);
  if (typeof options.neutralPlane !== "object" || options.neutralPlane === null) {
    throw new TypeError("Draft neutral plane must be an object");
  }
  assertDraftVector(
    options.neutralPlane.origin,
    "Draft neutral-plane origin",
    false,
  );
  assertDraftVector(
    options.neutralPlane.normal,
    "Draft neutral-plane normal",
    true,
  );
}

export type OcctWasmSource = string | URL | ArrayBuffer | Uint8Array;

/** Options accepted by stock or InvariantCAD-owned Emscripten module glue. */
export interface OcctModuleOptions {
  readonly wasmBinary?: ArrayBuffer;
  readonly locateFile?: (path: string) => string;
  readonly print?: (message: string) => void;
  readonly printErr?: (message: string) => void;
}

/** A matched Emscripten JS-glue factory for the supplied OCCT WASM binary. */
export type OcctModuleFactory = (
  options?: OcctModuleOptions,
) => Promise<unknown>;

export interface OcctKernelOptions {
  readonly wasm?: OcctWasmSource;
  /**
   * Matched JS glue for a custom OCCT binary. When omitted, stock occt-wasm
   * glue is used and a custom `wasm` source is passed to that stock factory.
   */
  readonly moduleFactory?: OcctModuleFactory;
  readonly tessellation?: MeshOptions;
  readonly modelingTolerance?: number;
  readonly onOutput?: (message: string) => void;
  readonly onError?: (message: string) => void;
}

class OcctKernel implements GeometryKernel {
  readonly id = "occt";
  readonly capabilities: KernelCapabilities;
  declare readonly draft?: NonNullable<GeometryKernel["draft"]>;
  private static readonly BASE_CAPABILITIES: KernelCapabilities = {
    protocolVersion: 1,
    representation: "brep",
    exact: true,
    primitives: ["box", "cylinder", "sphere"],
    features: [
      "extrude",
      "revolve",
      "loft",
      "sweep",
      "circularArcSweep",
      "compositeSweep",
      "boolean",
      "transform",
      "fillet",
      "chamfer",
      "shell",
      "offset",
    ],
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
  private readonly ownedShapes = new WeakSet<OcctShape>();
  private readonly liveShapes = new Set<OcctShape>();
  private readonly topologyNamespace = nextTopologyNamespace++;
  private nextShapeSerial = 1;
  private disposed = false;

  constructor(
    raw: RawOcctKernel,
    draftFacade: OcctDraftFacadeModule | undefined,
    options: OcctKernelOptions = {},
  ) {
    this.raw = raw;
    this.tessellation = options.tessellation ?? {};
    this.modelingTolerance = options.modelingTolerance ?? 1e-7;
    this.capabilities =
      draftFacade === undefined
        ? OcctKernel.BASE_CAPABILITIES
        : {
            ...OcctKernel.BASE_CAPABILITIES,
            features: [...OcctKernel.BASE_CAPABILITIES.features, "draft"],
            exactIndexedTopologyEvolution: {
              protocolVersion: 1,
              features: ["draft"],
            },
          };
    if (draftFacade !== undefined) {
      this.draft = (shape, faces, resolved, context) =>
        this.draftWithExactEvolution(
          draftFacade,
          shape,
          faces,
          resolved,
          context,
        );
    }
  }

  private assertKernelLive(): void {
    if (this.disposed) throw new Error("This OCCT kernel has been disposed");
  }

  private shape(shape: KernelShape): OcctShape {
    this.assertKernelLive();
    if (
      !(shape instanceof OcctShape) ||
      !this.liveShapes.has(shape) ||
      shape.disposed
    ) {
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
      readonly volumeOverride?: number;
    } = {},
  ): OcctShape {
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
      options.volumeOverride,
    );
    this.nextShapeSerial += 1;
    this.ownedShapes.add(shape);
    this.liveShapes.add(shape);
    return shape;
  }

  private releaseHandles(handles: readonly ShapeHandle[]): void {
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      this.raw.release(handles[index]!);
    }
  }

  private isPureSingleSolidShape(
    shape: ShapeHandle,
    solid: ShapeHandle,
  ): boolean {
    const type = this.raw.getShapeType(shape);
    if (type === "solid") return this.raw.isSame(shape, solid);
    if (type !== "compound" && type !== "compsolid") return false;
    const children = this.raw.iterShapes(shape);
    try {
      return (
        children.length === 1 &&
        this.isPureSingleSolidShape(children[0]!, solid)
      );
    } finally {
      this.releaseHandles(children);
    }
  }

  private normalizeImportedSolidOrientation(handle: ShapeHandle): ShapeHandle {
    let reverse = false;
    try {
      reverse =
        this.raw.getShapeType(handle) === "solid" &&
        this.raw.getVolume(handle) < 0;
    } catch (error) {
      this.raw.release(handle);
      throw error;
    }
    if (!reverse) return handle;
    try {
      const reversed = this.raw.reverseShape(handle);
      this.raw.release(handle);
      return reversed;
    } catch (error) {
      this.raw.release(handle);
      throw error;
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
    readonly outerWire: ShapeHandle;
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
      return { face, outerWire, allocated, curves };
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

  loft(
    profiles: readonly ResolvedProfile[],
    options: ResolvedLoftOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (typeof options !== "object" || options === null || options.ruled !== true) {
      throw new TypeError("Document v1 lofts must use ruled interpolation");
    }
    const tolerance = context?.tolerance ?? this.modelingTolerance;
    const issue = validateRuledSolidLoftProfiles(profiles, tolerance);
    if (issue !== undefined) throw new RangeError(issue.message);

    const allocated: ShapeHandle[] = [];
    const curves: ProfileCurveHandle[] = [];
    const wires: ShapeHandle[] = [];
    let result: ShapeHandle | undefined;
    try {
      for (const [index, profile] of profiles.entries()) {
        checkContext(context);
        const wire = this.loopWire(profile.outer, profile.plane, allocated, curves);
        wires.push(wire);
        const curveCount = profile.outer.curves.length;
        if (
          this.raw.isNull(wire) ||
          this.raw.getShapeType(wire) !== "wire" ||
          !this.raw.isValid(wire) ||
          this.raw.subShapeCount(wire, "edge") !== curveCount ||
          this.raw.subShapeCount(wire, "vertex") !== curveCount
        ) {
          throw new RangeError(
            `Loft profile ${index} does not form a valid unmodified wire`,
          );
        }
        const sectionFace = this.raw.makeFace(wire);
        allocated.push(sectionFace);
        if (
          this.raw.isNull(sectionFace) ||
          this.raw.getShapeType(sectionFace) !== "face" ||
          !this.raw.isValid(sectionFace) ||
          this.raw.subShapeCount(sectionFace, "edge") !== curveCount ||
          this.raw.subShapeCount(sectionFace, "vertex") !== curveCount
        ) {
          throw new RangeError(
            `Loft profile ${index} does not form a valid simple planar face`,
          );
        }
        const sectionArea = this.raw.getSurfaceArea(sectionFace);
        if (
          !Number.isFinite(sectionArea) ||
          !(sectionArea > tolerance ** 2)
        ) {
          throw new RangeError(
            `Loft profile ${index} does not form a valid simple planar face`,
          );
        }
      }

      checkContext(context);
      result = this.raw.loft(wires, true, true);
      checkContext(context);

      const curveCount = profiles[0]!.outer.curves.length;
      const expectedFaces = (profiles.length - 1) * curveCount + 2;
      const expectedEdges = (2 * profiles.length - 1) * curveCount;
      const expectedVertices = profiles.length * curveCount;
      const minimumVolume = Math.max(tolerance ** 3, Number.EPSILON);

      const validateResult = (): number => {
        if (
          result === undefined ||
          this.raw.isNull(result) ||
          this.raw.getShapeType(result) !== "solid" ||
          !this.raw.isValid(result)
        ) {
          throw new RangeError("Loft did not produce one valid solid");
        }
        if (
          this.raw.subShapeCount(result, "solid") !== 1 ||
          this.raw.subShapeCount(result, "shell") !== 1
        ) {
          throw new RangeError("Loft did not produce exactly one solid and shell");
        }
        if (
          this.raw.subShapeCount(result, "face") !== expectedFaces ||
          this.raw.subShapeCount(result, "edge") !== expectedEdges ||
          this.raw.subShapeCount(result, "vertex") !== expectedVertices
        ) {
          throw new RangeError(
            "Loft changed the ordered section-curve correspondence",
          );
        }
        const solids = this.raw.getSubShapes(result, "solid");
        try {
          if (
            solids.length !== 1 ||
            !this.isPureSingleSolidShape(result, solids[0]!)
          ) {
            throw new RangeError(
              "Loft produced loose topology outside its result solid",
            );
          }
        } finally {
          this.releaseHandles(solids);
        }
        const volume = this.raw.getVolume(result);
        if (!Number.isFinite(volume) || !(Math.abs(volume) > minimumVolume)) {
          throw new RangeError("Loft did not produce a positive-volume solid");
        }
        return volume;
      };

      let volume = validateResult();
      if (volume < 0) {
        const reversed = this.raw.reverseShape(result);
        this.raw.release(result);
        result = reversed;
        volume = validateResult();
      }
      if (!(volume > minimumVolume)) {
        throw new RangeError("Loft did not produce a positive-volume solid");
      }
      return this.own(result, context);
    } catch (error) {
      if (result !== undefined) this.raw.release(result);
      throw error;
    } finally {
      this.releaseHandles(allocated);
    }
  }

  sweep(
    profile: ResolvedProfile,
    path: ResolvedPolylinePath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    if (path.kind !== "polyline") {
      throw new TypeError("Polyline sweep requires a polyline path");
    }
    return this.sweepPath(profile, path, options, context);
  }

  circularArcSweep(
    profile: ResolvedProfile,
    path: ResolvedCircularArcPath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    if (path.kind !== "circularArc") {
      throw new TypeError(
        "Circular-arc sweep requires a three-point circular-arc path",
      );
    }
    return this.sweepPath(profile, path, options, context);
  }

  compositeSweep(
    profile: ResolvedProfile,
    path: ResolvedCompositePath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    if (path.kind !== "composite") {
      throw new TypeError("Composite sweep requires an exact composite path");
    }
    return this.sweepPath(profile, path, options, context);
  }

  private sweepPath(
    profile: ResolvedProfile,
    path: ResolvedPath,
    options: ResolvedSweepOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (
      typeof options !== "object" ||
      options === null ||
      options.transition !== "right-corner" ||
      options.frame !== "corrected-frenet"
    ) {
      throw new TypeError(
        "Document v1 sweeps require corrected-Frenet transport and right-corner transitions",
      );
    }
    const requestedTolerance = context?.tolerance ?? this.modelingTolerance;
    if (!Number.isFinite(requestedTolerance) || !(requestedTolerance > 0)) {
      throw new RangeError("Path tolerance must be finite and positive");
    }
    const tolerance =
      path.kind === "circularArc" || path.kind === "composite"
        ? Math.max(requestedTolerance, this.modelingTolerance)
        : requestedTolerance;
    const issue = validateResolvedSweep(profile, path, tolerance);
    if (issue !== undefined) throw new RangeError(issue.message);
    if (
      path.kind === "circularArc" &&
      !(
        circularArcMinimumPointSine(path) >
        OCCT_CIRCULAR_ARC_MIN_POINT_SINE
      )
    ) {
      throw new RangeError(
        `Circular-arc path points must exceed the OCCT three-point angular resolution (sine > ${OCCT_CIRCULAR_ARC_MIN_POINT_SINE})`,
      );
    }
    if (path.kind === "composite") {
      const poorlyConditionedArc = resolvedCompositePathSegments(path).findIndex(
        (segment) =>
          segment.kind === "circularArc" &&
          !(
            circularArcMinimumPointSine(segment) >
            OCCT_CIRCULAR_ARC_MIN_POINT_SINE
          ),
      );
      if (poorlyConditionedArc !== -1) {
        throw new RangeError(
          `Composite circular-arc segment ${poorlyConditionedArc} points must exceed the OCCT three-point angular resolution (sine > ${OCCT_CIRCULAR_ARC_MIN_POINT_SINE})`,
        );
      }
    }
    if (path.kind === "polyline" || path.kind === "composite") {
      const shortProfileCurve = profile.outer.curves.findIndex(
        (curve) =>
          !(resolvedProfileCurveLength(curve) >
            OCCT_PIPE_SHELL_LINEAR_TOLERANCE),
      );
      if (shortProfileCurve !== -1) {
        throw new RangeError(
          `Sweep profile curve ${shortProfileCurve} must exceed the OCCT pipe-shell linear tolerance (${OCCT_PIPE_SHELL_LINEAR_TOLERANCE} mm)`,
        );
      }
      const pipeSegments: readonly ResolvedPathSegment[] =
        path.kind === "polyline"
          ? path.points.slice(0, -1).map((start, index) => ({
              kind: "line" as const,
              start,
              end: path.points[index + 1]!,
            }))
          : resolvedCompositePathSegments(path);
      const shortPathSegment = pipeSegments.findIndex(
        (segment) =>
          !(resolvedPathSegmentLength(segment) >
            OCCT_PIPE_SHELL_LINEAR_TOLERANCE) ||
          (segment.kind === "circularArc" &&
            !(
              Math.min(
                vectorDistance(segment.start, segment.through),
                vectorDistance(segment.through, segment.end),
                vectorDistance(segment.start, segment.end),
              ) > OCCT_PIPE_SHELL_LINEAR_TOLERANCE
            )),
      );
      if (shortPathSegment !== -1) {
        throw new RangeError(
          `Sweep path segment ${shortPathSegment} must exceed the OCCT pipe-shell linear tolerance (${OCCT_PIPE_SHELL_LINEAR_TOLERANCE} mm)`,
        );
      }
    }

    const seatedProfile: ResolvedProfile =
      path.kind === "circularArc" || path.kind === "composite"
        ? {
            ...profile,
            plane: { ...profile.plane, origin: path.start },
          }
        : profile;
    const built = this.profileFace(seatedProfile);
    const pathAllocated: ShapeHandle[] = [];
    let result: ShapeHandle | undefined;
    let exactVolume: number | undefined;
    try {
      const curveCount = profile.outer.curves.length;
      if (
        this.raw.isNull(built.outerWire) ||
        this.raw.getShapeType(built.outerWire) !== "wire" ||
        !this.raw.isValid(built.outerWire) ||
        this.raw.subShapeCount(built.outerWire, "edge") !== curveCount ||
        this.raw.subShapeCount(built.outerWire, "vertex") !== curveCount ||
        this.raw.isNull(built.face) ||
        this.raw.getShapeType(built.face) !== "face" ||
        !this.raw.isValid(built.face) ||
        this.raw.subShapeCount(built.face, "edge") !== curveCount ||
        this.raw.subShapeCount(built.face, "vertex") !== curveCount
      ) {
        throw new RangeError(
          "Sweep profile does not form a valid simple planar face",
        );
      }
      const profileArea = this.raw.getSurfaceArea(built.face);
      if (!Number.isFinite(profileArea) || !(profileArea > tolerance ** 2)) {
        throw new RangeError(
          "Sweep profile does not form a valid simple planar face",
        );
      }
      const minimumVolume = tolerance ** 3;
      if (path.kind === "circularArc") {
        const geometry = resolvedCircularArcGeometry(path)!;
        const centroid = vectorFromOcct(
          this.raw.getSurfaceCenterOfMass(built.face),
        );
        const offset: Vec3 = [
          centroid[0] - geometry.center[0],
          centroid[1] - geometry.center[1],
          centroid[2] - geometry.center[2],
        ];
        const centroidVelocity: Vec3 = [
          geometry.normal[1] * offset[2] -
            geometry.normal[2] * offset[1],
          geometry.normal[2] * offset[0] -
            geometry.normal[0] * offset[2],
          geometry.normal[0] * offset[1] -
            geometry.normal[1] * offset[0],
        ];
        const profileNormal = planeBasis(seatedProfile.plane).n;
        const normalSpeed = Math.abs(
          profileNormal[0] * centroidVelocity[0] +
            profileNormal[1] * centroidVelocity[1] +
            profileNormal[2] * centroidVelocity[2],
        );
        exactVolume = profileArea * normalSpeed * geometry.sweep;
        if (!Number.isFinite(exactVolume) || !(exactVolume > minimumVolume)) {
          throw new RangeError(
            "Circular-arc sweep does not have a stable positive analytic volume",
          );
        }
      }

      const segmentCount = resolvedPathEdgeCount(path);
      if (path.kind !== "circularArc") {
        const pipeSegments: readonly ResolvedPathSegment[] =
          path.kind === "polyline"
            ? path.points.slice(0, -1).map((start, index) => ({
                kind: "line" as const,
                start,
                end: path.points[index + 1]!,
              }))
            : resolvedCompositePathSegments(path);
        const pathEdges: ShapeHandle[] = [];
        let expectedPathLength = 0;
        for (const [index, segment] of pipeSegments.entries()) {
          checkContext(context);
          const edge =
            segment.kind === "line"
              ? this.raw.makeLineEdge(
                  occtVector(segment.start),
                  occtVector(segment.end),
                )
              : this.raw.makeArcEdge(
                  occtVector(segment.start),
                  occtVector(segment.through),
                  occtVector(segment.end),
                );
          pathAllocated.push(edge);
          pathEdges.push(edge);
          if (
            this.raw.isNull(edge) ||
            this.raw.getShapeType(edge) !== "edge" ||
            !this.raw.isValid(edge) ||
            this.raw.subShapeCount(edge, "vertex") !== 2
          ) {
            throw new RangeError(
              `Sweep path segment ${index} does not form a valid edge`,
            );
          }
          const expectedLength = resolvedPathSegmentLength(segment);
          expectedPathLength += expectedLength;
          if (path.kind === "composite") {
            const measuredLength = this.raw.curveLength(edge);
            const lengthTolerance = Math.max(
              this.modelingTolerance * 8,
              expectedLength * 1e-9,
            );
            const expectedCurveType =
              segment.kind === "line" ? "line" : "circle";
            if (
              this.raw.curveType(edge) !== expectedCurveType ||
              this.raw.curveIsClosed(edge) ||
              !Number.isFinite(measuredLength) ||
              Math.abs(measuredLength - expectedLength) > lengthTolerance
            ) {
              throw new RangeError(
                `Composite sweep path segment ${index} changed its exact curve geometry`,
              );
            }
            const parameters = this.raw.curveParameters(edge);
            const nativeStart = vectorFromOcct(
              this.raw.curvePointAtParam(edge, parameters.first),
            );
            const nativeEnd = vectorFromOcct(
              this.raw.curvePointAtParam(edge, parameters.last),
            );
            const endpointTolerance = Math.max(
              this.modelingTolerance * 8,
              1e-10,
            );
            if (
              vectorDistance(nativeStart, segment.start) > endpointTolerance ||
              vectorDistance(nativeEnd, segment.end) > endpointTolerance
            ) {
              throw new RangeError(
                `Composite sweep path segment ${index} changed its authored endpoints`,
              );
            }
          }
        }
        const spine = this.raw.makeWire(pathEdges);
        pathAllocated.push(spine);
        if (
          this.raw.isNull(spine) ||
          this.raw.getShapeType(spine) !== "wire" ||
          !this.raw.isValid(spine) ||
          this.raw.subShapeCount(spine, "edge") !== segmentCount ||
          this.raw.subShapeCount(spine, "vertex") !== segmentCount + 1
        ) {
          throw new RangeError(
            "Sweep path does not form one valid unmodified open wire",
          );
        }
        if (path.kind === "composite") {
          const expectedVertices = [
            path.start,
            ...path.segments.map((segment) => segment.end),
          ];
          const spineVertices = this.raw.getSubShapes(spine, "vertex");
          try {
            const positions = spineVertices.map((vertex) =>
              vectorFromOcct(this.raw.vertexPosition(vertex)),
            );
            const endpointTolerance = Math.max(
              this.modelingTolerance * 8,
              1e-10,
            );
            if (
              positions.length !== expectedVertices.length ||
              expectedVertices.some(
                (expected) =>
                  positions.filter(
                    (position) =>
                      vectorDistance(position, expected) <= endpointTolerance,
                  ).length !== 1,
              )
            ) {
              throw new RangeError(
                "Composite sweep path wire changed its authored joints",
              );
            }
          } finally {
            this.releaseHandles(spineVertices);
          }
          const measuredPathLength = this.raw.getLength(spine);
          if (
            !Number.isFinite(measuredPathLength) ||
            Math.abs(measuredPathLength - expectedPathLength) >
              Math.max(
                this.modelingTolerance * segmentCount * 8,
                expectedPathLength * 1e-9,
              )
          ) {
            throw new RangeError(
              "Composite sweep path wire changed its exact authored length",
            );
          }
        }
        checkContext(context);
        result = this.raw.sweep(
          built.outerWire,
          spine,
          TransitionMode.RightCorner,
        );
      } else {
        const geometry = resolvedCircularArcGeometry(path)!;
        checkContext(context);
        result = this.raw.revolve(
          built.face,
          {
            point: occtVector(geometry.center),
            direction: occtVector(geometry.normal),
          },
          geometry.sweep,
        );
      }

      checkContext(context);
      const expectedFaces = segmentCount * curveCount + 2;

      const validateResult = (): number => {
        if (
          result === undefined ||
          this.raw.isNull(result) ||
          this.raw.getShapeType(result) !== "solid" ||
          !this.raw.isValid(result)
        ) {
          throw new RangeError("Sweep did not produce one valid solid");
        }
        if (
          this.raw.subShapeCount(result, "solid") !== 1 ||
          this.raw.subShapeCount(result, "shell") !== 1
        ) {
          throw new RangeError("Sweep did not produce exactly one solid and shell");
        }
        if (this.raw.subShapeCount(result, "face") !== expectedFaces) {
          throw new RangeError(
            "Sweep changed the profile-segment face correspondence",
          );
        }
        if (
          path.kind === "circularArc" &&
          (this.raw.subShapeCount(result, "edge") !== curveCount * 3 ||
            this.raw.subShapeCount(result, "vertex") !== curveCount * 2)
        ) {
          throw new RangeError(
            "Sweep changed the circular-arc profile topology correspondence",
          );
        }
        const solids = this.raw.getSubShapes(result, "solid");
        try {
          if (
            solids.length !== 1 ||
            !this.isPureSingleSolidShape(result, solids[0]!)
          ) {
            throw new RangeError(
              "Sweep produced loose topology outside its result solid",
            );
          }
        } finally {
          this.releaseHandles(solids);
        }
        const volume = this.raw.getVolume(result);
        if (!Number.isFinite(volume) || !(Math.abs(volume) > minimumVolume)) {
          throw new RangeError("Sweep did not produce a positive-volume solid");
        }
        return volume;
      };

      let volume = validateResult();
      if (volume < 0) {
        const reversed = this.raw.reverseShape(result);
        this.raw.release(result);
        result = reversed;
        volume = validateResult();
      }
      if (!(volume > minimumVolume)) {
        throw new RangeError("Sweep did not produce a positive-volume solid");
      }
      return this.own(result, context, {
        ...(exactVolume === undefined ? {} : { volumeOverride: exactVolume }),
      });
    } catch (error) {
      if (result !== undefined) this.raw.release(result);
      throw error;
    } finally {
      this.releaseHandles(pathAllocated);
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
    if (tools.length === 0) {
      throw new RangeError("Boolean operations require at least one tool shape");
    }
    const targetShape = this.shape(target);
    const toolShapes = tools.map((tool) => this.shape(tool));
    const targetHandle = targetShape[OCCT_SHAPE];
    const toolHandles = toolShapes.map((tool) => tool[OCCT_SHAPE]);
    const inherited = uniqueLineage([
      ...targetShape.lineage,
      ...toolShapes.flatMap((tool) => tool.lineage),
    ]);
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
        const next =
          operation === "union"
            ? this.raw.fuse(current, tool)
            : this.raw.common(current, tool);
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
          case "scale": {
            const uniformFactor = this.uniformScaleFactor(operation.value);
            if (uniformFactor !== undefined) {
              replace(
                this.raw.scale(
                  current,
                  { x: 0, y: 0, z: 0 },
                  uniformFactor,
                ),
              );
            } else {
              // BRepBuilderAPI_GTransform carries cached triangulation from its
              // input. Strip mesh/polygon caches first so a nonuniform affine
              // map cannot leave otherwise exact transformed geometry invalid.
              const cleanSource = this.raw.copy(current);
              try {
                const transformed = this.raw.generalTransform(cleanSource, [
                  operation.value[0], 0, 0, 0,
                  0, operation.value[1], 0, 0,
                  0, 0, operation.value[2], 0,
                ]);
                replace(transformed);
              } finally {
                this.raw.release(cleanSource);
              }
            }
            break;
          }
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

  private uniformScaleFactor(value: Vec3): number | undefined {
    return Math.abs(value[0] - value[1]) <= this.modelingTolerance &&
      Math.abs(value[1] - value[2]) <= this.modelingTolerance
      ? value[0]
      : undefined;
  }

  private effectiveScaleDeterminant(value: Vec3): number {
    const uniformFactor = this.uniformScaleFactor(value);
    return uniformFactor === undefined
      ? value[0] * value[1] * value[2]
      : uniformFactor ** 3;
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
      const volumeOverride =
        inputShape.volumeOverride === undefined
          ? undefined
          : operations.reduce(
              (volume, operation) =>
                operation.kind === "scale"
                  ? volume *
                    Math.abs(this.effectiveScaleDeterminant(operation.value))
                  : volume,
              inputShape.volumeOverride,
            );
      return this.own(current, context, {
        inherited: inputShape.lineage,
        relation: "modified",
        history: inputSnapshot.history,
        ...(annotation === undefined ? {} : { annotation }),
        ...(volumeOverride === undefined ? {} : { volumeOverride }),
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
    let imported: ShapeHandle;
    switch (format) {
      case "step":
        imported = this.raw.importStep(
          data instanceof Uint8Array ? arrayBufferCopy(data) : data,
        );
        break;
      case "brep":
        imported = this.raw.fromBREP(
          typeof data === "string"
            ? data
            : new TextDecoder().decode(
                data instanceof Uint8Array ? data : new Uint8Array(data),
              ),
        );
        break;
      case "brep-binary":
        imported = this.raw.fromBREPBinary(
          typeof data === "string"
            ? new TextEncoder().encode(data)
            : data instanceof Uint8Array
              ? data
              : new Uint8Array(data),
        );
        break;
    }
    return this.own(this.normalizeImportedSolidOrientation(imported), context, {
      history: "partial",
    });
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
        topologyKey(this.topologyNamespace, owned.serial, "face", index),
      );
      const edgeKeys = edgeHandles.map((_, index) =>
        topologyKey(this.topologyNamespace, owned.serial, "edge", index),
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

  private rawTopologyCounts(handle: ShapeHandle): IndexedTopologyCounts {
    return {
      faces: this.raw.subShapeCount(handle, "face"),
      edges: this.raw.subShapeCount(handle, "edge"),
      vertices: this.raw.subShapeCount(handle, "vertex"),
    };
  }

  private assertDraftTopologyCounts(
    declared: IndexedTopologyCounts,
    actual: IndexedTopologyCounts,
    label: string,
  ): void {
    for (const kind of ["faces", "edges", "vertices"] as const) {
      if (declared[kind] !== actual[kind]) {
        throw new TopologyEvolutionProtocolError(
          `${label}.${kind} declares ${declared[kind]}, but OCCT reports ${actual[kind]}`,
        );
      }
    }
  }

  /**
   * Removes a transferred wrapper after post-transfer validation fails.
   * Its retained subshape handles belong to this wrapper and are released
   * here; the root stays live so adoptOcctDraft can release it exactly once.
   */
  private abandonTransferredShape(shape: OcctShape): void {
    let cleanupError: unknown;
    for (const retained of shape.topologyHandles.values()) {
      try {
        this.raw.release(retained.handle);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    shape.topologyHandles.clear();
    shape.topologySnapshot = undefined;
    shape.disposed = true;
    this.liveShapes.delete(shape);
    if (cleanupError !== undefined) throw cleanupError;
  }

  private draftWithExactEvolution(
    module: OcctDraftFacadeModule,
    shape: KernelShape,
    faces: readonly KernelTopologyKey[],
    options: ResolvedDraftOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    validateDraftOptions(options);
    if (!Array.isArray(faces)) {
      throw new TypeError("Draft faces must be an array");
    }
    if (faces.length === 0) {
      throw new RangeError("Draft requires at least one face");
    }

    const input = this.shape(shape);
    const inputSnapshot = this.topology(input);
    const faceIndexByKey = new Map(
      inputSnapshot.faces.map((descriptor, index) => [descriptor.key, index]),
    );
    const selectedIndices: number[] = [];
    const selected = new Set<number>();
    for (const key of faces) {
      const index = faceIndexByKey.get(key);
      const retained = input.topologyHandles.get(key);
      if (index === undefined || retained?.topology !== "face") {
        throw new TypeError(
          `Topology key '${String(key)}' is not a face of the input shape`,
        );
      }
      if (!selected.has(index)) {
        selected.add(index);
        selectedIndices.push(index);
      }
    }
    selectedIndices.sort((first, second) => first - second);
    const faceIds = selectedIndices.map((index) => {
      const descriptor = inputSnapshot.faces[index]!;
      const retained = input.topologyHandles.get(descriptor.key);
      if (retained?.topology !== "face") {
        throw new Error("OCCT topology snapshot lost a retained face handle");
      }
      return retained.handle;
    });

    const inputHandle = input[OCCT_SHAPE];
    const rawKernel = this.raw.getRawKernel();
    try {
      return adoptOcctDraft({
        module,
        kernel: rawKernel,
        shapeId: inputHandle,
        faceIds,
        angleRad: options.angle,
        pullDirection: options.pullDirection,
        neutralOrigin: options.neutralPlane.origin,
        neutralNormal: options.neutralPlane.normal,
        validate: (report: OcctDraftReportSnapshot) => {
          this.assertDraftTopologyCounts(
            report.evolution.inputCounts[0]!,
            this.rawTopologyCounts(inputHandle),
            "draft inputCounts[0]",
          );
        },
        adopt: ({ resultId, report }) => {
          const provisional = this.own(resultId as ShapeHandle, context, {
            inherited: input.lineage,
            relation: "modified",
            history: inputSnapshot.history,
          });
          try {
            const outputSnapshot = this.topology(provisional);
            this.assertDraftTopologyCounts(
              report.evolution.resultCounts,
              this.rawTopologyCounts(provisional[OCCT_SHAPE]),
              "draft resultCounts",
            );
            provisional.topologySnapshot = reduceIndexedTopologyEvolution({
              evolution: report.evolution,
              inputs: [inputSnapshot],
              output: outputSnapshot,
              ...(context?.feature === undefined
                ? {}
                : { feature: context.feature }),
            });
            return provisional;
          } catch (error) {
            this.abandonTransferredShape(provisional);
            throw error;
          }
        },
      });
    } catch (error) {
      if (error instanceof OcctDraftFacadeProtocolError) {
        throw new TopologyEvolutionProtocolError(error.message);
      }
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
    const module = this.raw.getRawModule();
    const rawKernel = this.raw.getRawKernel();
    return adoptOcctEdgeEvolution({
      module,
      kernel: rawKernel,
      edgeIds: handles,
      inputFaceHashes: faceHashes,
      invoke: (edgeIds, inputHashes) =>
        rawKernel.filletWithHistory(
          input[OCCT_SHAPE],
          edgeIds as Parameters<typeof rawKernel.filletWithHistory>[1],
          options.radius,
          inputHashes as Parameters<typeof rawKernel.filletWithHistory>[3],
          TOPOLOGY_HASH_UPPER_BOUND,
        ),
      adopt: (evolution) =>
        this.own(evolution.resultId as ShapeHandle, context, {
          inherited: input.lineage,
          relation: "modified",
          history: "partial",
        }),
    });
  }

  chamfer(
    shape: KernelShape,
    edges: readonly KernelTopologyKey[],
    options: { readonly distance: number },
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (!Number.isFinite(options.distance) || !(options.distance > 0)) {
      throw new RangeError("Chamfer distance must be finite and positive");
    }
    if (edges.length === 0) {
      throw new RangeError("Chamfer requires at least one edge");
    }
    const input = this.shape(shape);
    this.topology(input);
    const handles = [...new Set(edges)].map((key) => {
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
    const module = this.raw.getRawModule();
    const rawKernel = this.raw.getRawKernel();
    return adoptOcctEdgeEvolution({
      module,
      kernel: rawKernel,
      edgeIds: handles,
      inputFaceHashes: faceHashes,
      invoke: (edgeIds, inputHashes) =>
        rawKernel.chamferWithHistory(
          input[OCCT_SHAPE],
          edgeIds as Parameters<typeof rawKernel.chamferWithHistory>[1],
          options.distance,
          inputHashes as Parameters<typeof rawKernel.chamferWithHistory>[3],
          TOPOLOGY_HASH_UPPER_BOUND,
        ),
      adopt: (evolution) =>
        this.own(evolution.resultId as ShapeHandle, context, {
          inherited: input.lineage,
          relation: "modified",
          history: "partial",
        }),
    });
  }

  shell(
    shape: KernelShape,
    openings: readonly KernelTopologyKey[],
    options: ResolvedShellOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (!Number.isFinite(options.thickness) || !(options.thickness > 0)) {
      throw new RangeError("Shell thickness must be finite and positive");
    }
    if (openings.length === 0) {
      throw new RangeError("Shell requires at least one opening face");
    }
    if (options.direction !== "inward" && options.direction !== "outward") {
      throw new TypeError("Shell direction must be 'inward' or 'outward'");
    }
    if (!Number.isFinite(options.tolerance) || !(options.tolerance > 0)) {
      throw new RangeError("Shell tolerance must be finite and positive");
    }
    if (!(options.tolerance < options.thickness)) {
      throw new RangeError("Shell tolerance must be less than its thickness");
    }
    const input = this.shape(shape);
    const inputSolids = this.raw.getSubShapes(input[OCCT_SHAPE], "solid");
    if (inputSolids.length !== 1) {
      this.releaseHandles(inputSolids);
      throw new TypeError("Shell input must contain exactly one solid");
    }
    const inputSolid = inputSolids[0]!;
    try {
      if (
        !this.raw.isValid(input[OCCT_SHAPE]) ||
        !this.raw.isValid(inputSolid)
      ) {
        throw new TypeError("Shell input must be a valid solid");
      }
      if (!this.isPureSingleSolidShape(input[OCCT_SHAPE], inputSolid)) {
        throw new TypeError(
          "Shell input must not contain loose topology outside its solid",
        );
      }
      for (const topology of ["face", "edge", "vertex"] as const) {
        if (
          this.raw.subShapeCount(input[OCCT_SHAPE], topology) !==
          this.raw.subShapeCount(inputSolid, topology)
        ) {
          throw new TypeError(
            "Shell input must not contain loose topology outside its solid",
          );
        }
      }
      const signedInputVolume = this.raw.getVolume(inputSolid);
      const inputVolume = Math.abs(signedInputVolume);
      if (
        !Number.isFinite(inputVolume) ||
        !(inputVolume > Math.max(options.tolerance ** 3, Number.EPSILON))
      ) {
        throw new TypeError("Shell input must have positive finite volume");
      }
      const snapshot = this.topology(input);
      const uniqueOpenings = [...new Set(openings)];
      const handles = uniqueOpenings.map((key) => {
        const retained = input.topologyHandles.get(key);
        if (retained?.topology !== "face") {
          throw new TypeError(
            `Topology key '${key}' is not a face of the input shape`,
          );
        }
        return retained.handle;
      });
      if (handles.length >= snapshot.faces.length) {
        throw new RangeError("Shell requires at least one retained face");
      }
      const signedThickness =
        options.direction === "inward"
          ? options.thickness
          : -options.thickness;
      let normalizedInput: ShapeHandle | undefined;
      let result: ShapeHandle;
      try {
        if (signedInputVolume < 0) {
          normalizedInput = this.raw.reverseShape(inputSolid);
        }
        result = this.raw.shell(
          normalizedInput ?? inputSolid,
          handles,
          signedThickness,
          options.tolerance,
        );
      } finally {
        if (normalizedInput !== undefined) this.raw.release(normalizedInput);
      }
      try {
        const removalTolerance = Math.max(
          options.tolerance ** 3,
          inputVolume * 1e-12,
        );
        if (!this.raw.isValid(result)) {
          throw new RangeError("Shell produced an invalid solid");
        }
        let resultVolume = this.raw.getVolume(result);
        if (resultVolume < -removalTolerance) {
          const reversed = this.raw.reverseShape(result);
          this.raw.release(result);
          result = reversed;
          if (!this.raw.isValid(result)) {
            throw new RangeError("Shell produced an invalid solid");
          }
          resultVolume = this.raw.getVolume(result);
        }
        const resultSolids = this.raw.getSubShapes(result, "solid");
        try {
          if (resultSolids.length !== 1) {
            throw new RangeError("Shell did not produce exactly one solid");
          }
          if (!this.isPureSingleSolidShape(result, resultSolids[0]!)) {
            throw new RangeError(
              "Shell produced loose topology outside its result solid",
            );
          }
          for (const topology of ["face", "edge", "vertex"] as const) {
            if (
              this.raw.subShapeCount(result, topology) !==
              this.raw.subShapeCount(resultSolids[0]!, topology)
            ) {
              throw new RangeError(
                "Shell produced loose topology outside its result solid",
              );
            }
          }
        } finally {
          this.releaseHandles(resultSolids);
        }
        if (
          !Number.isFinite(resultVolume) ||
          !(resultVolume > removalTolerance)
        ) {
          throw new RangeError("Shell did not produce a positive-volume solid");
        }
        if (
          options.direction === "inward" &&
          !(resultVolume < inputVolume - removalTolerance)
        ) {
          throw new RangeError(
            "Shell thickness did not produce a hollowed solid",
          );
        }
        return this.own(result, context, {
          inherited: input.lineage,
          relation: "modified",
          history: "partial",
        });
      } catch (error) {
        this.raw.release(result);
        throw error;
      }
    } finally {
      this.releaseHandles(inputSolids);
    }
  }

  offset(
    shape: KernelShape,
    options: ResolvedOffsetOptions,
    context?: KernelFeatureContext,
  ): KernelShape {
    checkContext(context);
    if (!Number.isFinite(options.distance) || !(options.distance > 0)) {
      throw new RangeError("Offset distance must be finite and positive");
    }
    if (options.direction !== "outward" && options.direction !== "inward") {
      throw new TypeError("Offset direction must be 'outward' or 'inward'");
    }
    if (!Number.isFinite(options.tolerance) || !(options.tolerance > 0)) {
      throw new RangeError("Offset tolerance must be finite and positive");
    }
    if (!(options.tolerance < options.distance)) {
      throw new RangeError("Offset tolerance must be less than its distance");
    }

    const input = this.shape(shape);
    const inputSolids = this.raw.getSubShapes(input[OCCT_SHAPE], "solid");
    if (inputSolids.length !== 1) {
      this.releaseHandles(inputSolids);
      throw new TypeError("Offset input must contain exactly one solid");
    }
    const inputSolid = inputSolids[0]!;
    try {
      if (
        !this.raw.isValid(input[OCCT_SHAPE]) ||
        !this.raw.isValid(inputSolid)
      ) {
        throw new TypeError("Offset input must be a valid solid");
      }
      if (!this.isPureSingleSolidShape(input[OCCT_SHAPE], inputSolid)) {
        throw new TypeError(
          "Offset input must not contain loose topology outside its solid",
        );
      }
      for (const topology of ["face", "edge", "vertex"] as const) {
        if (
          this.raw.subShapeCount(input[OCCT_SHAPE], topology) !==
          this.raw.subShapeCount(inputSolid, topology)
        ) {
          throw new TypeError(
            "Offset input must not contain loose topology outside its solid",
          );
        }
      }

      const signedInputVolume = this.raw.getVolume(inputSolid);
      const inputVolume = Math.abs(signedInputVolume);
      const volumeTolerance = Math.max(
        options.tolerance ** 3,
        inputVolume * 1e-12,
        Number.EPSILON,
      );
      if (!Number.isFinite(inputVolume) || !(inputVolume > volumeTolerance)) {
        throw new TypeError("Offset input must have positive finite volume");
      }

      const signedDistance =
        options.direction === "outward"
          ? options.distance
          : -options.distance;
      let normalizedInput: ShapeHandle | undefined;
      let result: ShapeHandle;
      try {
        if (signedInputVolume < 0) {
          normalizedInput = this.raw.reverseShape(inputSolid);
        }
        result = this.raw.offset(
          normalizedInput ?? inputSolid,
          signedDistance,
          options.tolerance,
        );
      } finally {
        if (normalizedInput !== undefined) this.raw.release(normalizedInput);
      }

      try {
        if (this.raw.isNull(result) || !this.raw.isValid(result)) {
          throw new RangeError("Offset produced an invalid solid");
        }
        const resultVolume = this.raw.getVolume(result);

        const resultSolids = this.raw.getSubShapes(result, "solid");
        try {
          if (resultSolids.length !== 1) {
            throw new RangeError("Offset did not produce exactly one solid");
          }
          if (!this.isPureSingleSolidShape(result, resultSolids[0]!)) {
            throw new RangeError(
              "Offset produced loose topology outside its result solid",
            );
          }
          for (const topology of ["face", "edge", "vertex"] as const) {
            if (
              this.raw.subShapeCount(result, topology) !==
              this.raw.subShapeCount(resultSolids[0]!, topology)
            ) {
              throw new RangeError(
                "Offset produced loose topology outside its result solid",
              );
            }
          }
        } finally {
          this.releaseHandles(resultSolids);
        }
        if (
          !Number.isFinite(resultVolume) ||
          !(resultVolume > volumeTolerance)
        ) {
          throw new RangeError("Offset did not produce a positive-volume solid");
        }
        if (
          options.direction === "outward" &&
          !(resultVolume > inputVolume + volumeTolerance)
        ) {
          throw new RangeError("Outward offset did not increase solid volume");
        }
        if (
          options.direction === "inward" &&
          !(resultVolume < inputVolume - volumeTolerance)
        ) {
          throw new RangeError("Inward offset did not decrease solid volume");
        }
        return this.own(result, context, {
          inherited: input.lineage,
          relation: "modified",
          history: "partial",
        });
      } catch (error) {
        this.raw.release(result);
        throw error;
      }
    } finally {
      this.releaseHandles(inputSolids);
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
    const owned = this.shape(shape);
    const handle = owned[OCCT_SHAPE];
    const bounds = this.raw.getBoundingBox(handle, false);
    const vertices = this.raw.subShapeCount(handle, "vertex");
    const edges = this.raw.subShapeCount(handle, "edge");
    const faces = this.raw.subShapeCount(handle, "face");
    const eulerCharacteristic = vertices - edges + faces;
    return {
      volume: owned.volumeOverride ?? this.raw.getVolume(handle),
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
    if (!(shape instanceof OcctShape) || !this.ownedShapes.has(shape)) {
      throw new TypeError("Expected an OCCT kernel shape owned by this kernel");
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
  const [{ OcctKernel: RawKernel }, createModule] = await Promise.all([
    import("occt-wasm"),
    options.moduleFactory === undefined
      ? import("occt-wasm/dist/occt-wasm.js").then(
          ({ default: stockFactory }) => stockFactory as OcctModuleFactory,
        )
      : Promise.resolve(options.moduleFactory),
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
  const draftFacade = probeOcctDraftFacade(module);
  const KernelConstructor = RawKernel as unknown as new (
    module: unknown,
  ) => RawOcctKernel;
  const raw = new KernelConstructor(module);
  try {
    return new OcctKernel(raw, draftFacade, options);
  } catch (error) {
    raw[Symbol.dispose]();
    throw error;
  }
}
