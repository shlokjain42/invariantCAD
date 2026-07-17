import { describe, expect, it } from "vitest";
import {
  COMPOSITE_SWEEP_MAJOR_ARC_ANGLE_EPSILON,
  COMPOSITE_SWEEP_MAJOR_ARC_THRESHOLD,
  COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
  COMPOSITE_PATH_MAX_JUNCTION_SINE,
  classifyResolvedCompositeSweepRefinements,
  cloneDocument,
  createEvaluator,
  design,
  hashDocument,
  mm,
  nodeDependencies,
  outputKindForNode,
  parseDocumentValue,
  plane,
  resolvedCircularArcGeometry,
  resolvedCompositePathSegments,
  resolvedPathEdgeCount,
  resolvedPathInitialTangent,
  resolvedPathSegmentEndTangent,
  resolvedPathSegmentLength,
  resolvedPathSegmentsHaveClearance,
  resolvedPathSegmentStartTangent,
  resolvedPathStart,
  scalar,
  stringifyDocument,
  validateDocument,
  validateResolvedCompositePath,
  validateResolvedPath,
  validateResolvedSweep,
  vec3,
  type CompositePathSegmentExpression,
  type DesignDocument,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelCompositeSweepRefinement,
  type KernelFeatureContext,
  type KernelShape,
  type PrincipalPlane,
  type ResolvedCircularArcPath,
  type ResolvedCompositePath,
  type ResolvedPathSegment,
  type ResolvedPolylinePath,
  type ResolvedProfile,
  type ResolvedSweepOptions,
  type SketchNodeIR,
  type SketchSolveContext,
  type SketchSolverBackend,
  type SketchSolverCapabilities,
  type SolvedSketch,
  type Vec3,
  type Vec3Expression,
} from "../src/index.js";
import { resolvedAdjacentPathSegmentsHaveRemoteClearance } from "../src/protocol/path.js";

const PATH_TOLERANCE = 1e-7;
const ROOT_HALF = Math.SQRT1_2;

function expressionPoint(point: Vec3): Vec3Expression {
  return vec3(mm(point[0]), mm(point[1]), mm(point[2]));
}

function canonicalSegmentExpressions(): readonly CompositePathSegmentExpression[] {
  return [
    { kind: "line", end: expressionPoint([0, 0, 10]) },
    {
      kind: "circularArc",
      through: expressionPoint([5 - 5 * ROOT_HALF, 0, 10 + 5 * ROOT_HALF]),
      end: expressionPoint([5, 0, 15]),
    },
    { kind: "line", end: expressionPoint([10, 0, 15]) },
  ];
}

function canonicalResolvedPath(): ResolvedCompositePath {
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      { kind: "line", end: [0, 0, 10] },
      {
        kind: "circularArc",
        through: [5 - 5 * ROOT_HALF, 0, 10 + 5 * ROOT_HALF],
        end: [5, 0, 15],
      },
      { kind: "line", end: [10, 0, 15] },
    ],
    closed: false,
  };
}

function majorLineArcLinePath(): ResolvedCompositePath {
  return {
    kind: "composite",
    start: [0, 0, -3],
    segments: [
      { kind: "line", end: [0, 0, 0] },
      {
        kind: "circularArc",
        through: [20, 0, 0],
        end: [10, 0, -10],
      },
      { kind: "line", end: [7, 0, -10] },
    ],
    closed: false,
  };
}

function majorArcArcPath(): ResolvedCompositePath {
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      {
        kind: "circularArc",
        through: [20, 0, 0],
        end: [10, 0, -10],
      },
      {
        kind: "circularArc",
        through: [10 - 10 * ROOT_HALF, 10 - 10 * ROOT_HALF, -10],
        end: [0, 10, -10],
      },
    ],
    closed: false,
  };
}

function nearFullLineArcLinePath(
  gap: number,
  incomingLength = 0.1,
  outgoingLength = 0.1,
): ResolvedCompositePath {
  const radius = 20;
  const sweep = Math.PI * 2 - gap;
  const point = (angle: number): Vec3 => [
    radius - radius * Math.cos(angle),
    0,
    radius * Math.sin(angle),
  ];
  const end = point(sweep);
  const endTangent: Vec3 = [Math.sin(sweep), 0, Math.cos(sweep)];
  return {
    kind: "composite",
    start: [0, 0, -incomingLength],
    segments: [
      { kind: "line", end: point(0) },
      {
        kind: "circularArc",
        through: point(sweep / 2),
        end,
      },
      {
        kind: "line",
        end: [
          end[0] + endTangent[0] * outgoingLength,
          end[1] + endTangent[1] * outgoingLength,
          end[2] + endTangent[2] * outgoingLength,
        ],
      },
    ],
    closed: false,
  };
}

function canonicalCompositeDocument(): DesignDocument {
  const cad = design("canonical-composite-sweep");
  const profile = cad.sketch(
    "profile",
    plane.xy(),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(2), height: mm(2) }),
      ),
    { tolerance: 2e-7 },
  );
  const path = cad.compositePath(
    "spine",
    {
      start: expressionPoint([0, 0, 0]),
      segments: canonicalSegmentExpressions(),
    },
    { tolerance: 3e-7 },
  );
  cad.output("body", cad.sweep("body", profile, path));
  return cad.build();
}

function fixtureCompositeDocument(
  segments: readonly CompositePathSegmentExpression[],
  options: {
    readonly start?: Vec3Expression;
    readonly pathTolerance?: number;
    readonly profileTolerance?: number;
  } = {},
): DesignDocument {
  const cad = design("fixture-composite-sweep");
  const profile = cad.sketch(
    "profile",
    plane.xy(),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(2), height: mm(2) }),
      ),
    { tolerance: options.profileTolerance ?? PATH_TOLERANCE },
  );
  const path = cad.compositePath(
    "spine",
    {
      start: options.start ?? expressionPoint([0, 0, 0]),
      segments,
    },
    { tolerance: options.pathTolerance ?? PATH_TOLERANCE },
  );
  cad.output("body", cad.sweep("body", profile, path));
  return cad.build();
}

function fixtureResolvedCompositeDocument(
  path: ResolvedCompositePath,
): DesignDocument {
  return fixtureCompositeDocument(
    path.segments.map((segment): CompositePathSegmentExpression =>
      segment.kind === "line"
        ? { kind: "line", end: expressionPoint(segment.end) }
        : {
            kind: "circularArc",
            through: expressionPoint(segment.through),
            end: expressionPoint(segment.end),
          },
    ),
    { start: expressionPoint(path.start) },
  );
}

function rectangleProfile(
  options: {
    readonly plane?: PrincipalPlane;
    readonly origin?: Vec3;
    readonly center?: readonly [number, number];
    readonly halfWidth?: number;
    readonly halfHeight?: number;
  } = {},
): ResolvedProfile {
  const halfWidth = options.halfWidth ?? 1;
  const halfHeight = options.halfHeight ?? 1;
  const [centerX, centerY] = options.center ?? [0, 0];
  const points = [
    [centerX - halfWidth, centerY - halfHeight],
    [centerX + halfWidth, centerY - halfHeight],
    [centerX + halfWidth, centerY + halfHeight],
    [centerX - halfWidth, centerY + halfHeight],
  ] as const;
  return {
    plane: {
      plane: options.plane ?? "XY",
      origin: options.origin ?? [0, 0, 0],
    },
    outer: {
      curves: points.map((start, index) => ({
        kind: "line" as const,
        start,
        end: points[(index + 1) % points.length]!,
      })),
    },
    holes: [],
  };
}

interface SweepInvocation<P> {
  readonly profile: ResolvedProfile;
  readonly path: P;
  readonly options: ResolvedSweepOptions;
  readonly context?: KernelFeatureContext;
}

function recordingSweepKernel(
  options: {
    readonly declaresComposite?: boolean;
    readonly implementsComposite?: boolean;
    readonly declaresPolyline?: boolean;
    readonly implementsPolyline?: boolean;
    readonly declaresCircularArc?: boolean;
    readonly implementsCircularArc?: boolean;
    readonly compositeSweepRefinements?: readonly KernelCompositeSweepRefinement[];
    readonly compositeSweepEnvelope?: unknown;
  } = {},
): {
  readonly kernel: GeometryKernel;
  readonly compositeInvocations: SweepInvocation<ResolvedCompositePath>[];
  readonly polylineInvocations: SweepInvocation<ResolvedPolylinePath>[];
  readonly arcInvocations: SweepInvocation<ResolvedCircularArcPath>[];
} {
  const id = "recording-composite-kernel";
  const declaresComposite = options.declaresComposite ?? true;
  const implementsComposite = options.implementsComposite ?? true;
  const declaresPolyline = options.declaresPolyline ?? true;
  const implementsPolyline = options.implementsPolyline ?? true;
  const declaresCircularArc = options.declaresCircularArc ?? true;
  const implementsCircularArc = options.implementsCircularArc ?? true;
  const compositeSweepEnvelope =
    options.compositeSweepEnvelope !== undefined
      ? options.compositeSweepEnvelope
      : options.compositeSweepRefinements === undefined
        ? undefined
        : {
            protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
            refinements: options.compositeSweepRefinements,
          };
  const compositeInvocations: SweepInvocation<ResolvedCompositePath>[] = [];
  const polylineInvocations: SweepInvocation<ResolvedPolylinePath>[] = [];
  const arcInvocations: SweepInvocation<ResolvedCircularArcPath>[] = [];
  let serial = 0;
  const shape = (): KernelShape =>
    ({ kernel: id, serial: serial++ }) as KernelShape;
  const kernel: GeometryKernel = {
    id,
    capabilities: {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: [
        ...(declaresPolyline ? (["sweep"] as const) : []),
        ...(declaresCircularArc ? (["circularArcSweep"] as const) : []),
        ...(declaresComposite ? (["compositeSweep"] as const) : []),
      ],
      nativeImports: [],
      nativeExports: [],
      ...(compositeSweepEnvelope === undefined
        ? {}
        : {
            compositeSweep:
              compositeSweepEnvelope as NonNullable<
                KernelCapabilities["compositeSweep"]
              >,
          }),
    },
    ...(implementsPolyline
      ? {
          sweep(
            profile: ResolvedProfile,
            path: ResolvedPolylinePath,
            resolved: ResolvedSweepOptions,
            context?: KernelFeatureContext,
          ): KernelShape {
            polylineInvocations.push({
              profile,
              path,
              options: resolved,
              ...(context === undefined ? {} : { context }),
            });
            return shape();
          },
        }
      : {}),
    ...(implementsCircularArc
      ? {
          circularArcSweep(
            profile: ResolvedProfile,
            path: ResolvedCircularArcPath,
            resolved: ResolvedSweepOptions,
            context?: KernelFeatureContext,
          ): KernelShape {
            arcInvocations.push({
              profile,
              path,
              options: resolved,
              ...(context === undefined ? {} : { context }),
            });
            return shape();
          },
        }
      : {}),
    ...(implementsComposite
      ? {
          compositeSweep(
            profile: ResolvedProfile,
            path: ResolvedCompositePath,
            resolved: ResolvedSweepOptions,
            context?: KernelFeatureContext,
          ): KernelShape {
            compositeInvocations.push({
              profile,
              path,
              options: resolved,
              ...(context === undefined ? {} : { context }),
            });
            return shape();
          },
        }
      : {}),
    mesh: () => ({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    }),
    measure: () => ({
      volume: 1,
      surfaceArea: 1,
      boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
      genus: 0,
      tolerance: PATH_TOLERANCE,
    }),
    status: () => ({ ok: true, code: "OK" }),
    disposeShape: () => {},
    dispose: () => {},
  };
  return {
    kernel,
    compositeInvocations,
    polylineInvocations,
    arcInvocations,
  };
}

class FixtureSketchSolver implements SketchSolverBackend {
  readonly id = "fixture-composite-sketch-solver";
  readonly capabilities: SketchSolverCapabilities = {
    entities: ["point", "line", "circle", "arc"],
    constraints: [],
    reportsDegreesOfFreedom: true,
    reportsConflicts: false,
  };
  readonly calls: string[] = [];
  private readonly profile: ResolvedProfile;

  constructor(profile: ResolvedProfile) {
    this.profile = profile;
  }

  solve(_sketch: SketchNodeIR, context: SketchSolveContext): SolvedSketch {
    if (context.feature === undefined) {
      throw new Error("Fixture solver requires a feature ID");
    }
    this.calls.push(context.feature);
    return {
      status: "solved",
      points: {},
      radii: {},
      profile: this.profile,
      degreesOfFreedom: 0,
      iterations: 0,
      residual: 0,
      diagnostics: [],
    };
  }

  dispose(): void {}
}

function expectVec3(actual: Vec3, expected: Vec3, digits = 10): void {
  for (const [index, component] of expected.entries()) {
    expect(actual[index]).toBeCloseTo(component, digits);
  }
}

function skewJunctionPath(angle: number): ResolvedCompositePath {
  const normal: Vec3 = [0, Math.cos(angle), -Math.sin(angle)];
  const center: Vec3 = [1, 0, 1];
  const radius: Vec3 = [-1, 0, 0];
  const point = (sweep: number): Vec3 => {
    const cosine = Math.cos(sweep);
    const sine = Math.sin(sweep);
    const cross: Vec3 = [
      normal[1] * radius[2] - normal[2] * radius[1],
      normal[2] * radius[0] - normal[0] * radius[2],
      normal[0] * radius[1] - normal[1] * radius[0],
    ];
    return [
      center[0] + radius[0] * cosine + cross[0] * sine,
      center[1] + radius[1] * cosine + cross[1] * sine,
      center[2] + radius[2] * cosine + cross[2] * sine,
    ];
  };
  return {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      { kind: "line", end: [0, 0, 1] },
      {
        kind: "circularArc",
        through: point(Math.PI / 4),
        end: point(Math.PI / 2),
      },
    ],
    closed: false,
  };
}

describe("exact composite path document contract", () => {
  it("materializes implicit-start IR and round-trips with a stable hash", async () => {
    expect(COMPOSITE_PATH_MAX_JUNCTION_SINE).toBe(1e-8);
    const document = canonicalCompositeDocument();
    const body = document.nodes[document.outputs.body!.node]!;
    expect(body.kind).toBe("sweep");
    if (body.kind !== "sweep") return;
    const spine = document.nodes[body.path.node]!;

    const vector = (point: Vec3Expression) =>
      point.map((coordinate) => coordinate.ir);
    expect(spine).toEqual({
      kind: "compositePath",
      start: vector(expressionPoint([0, 0, 0])),
      segments: [
        { kind: "line", end: vector(expressionPoint([0, 0, 10])) },
        {
          kind: "circularArc",
          through: vector(
            expressionPoint([5 - 5 * ROOT_HALF, 0, 10 + 5 * ROOT_HALF]),
          ),
          end: vector(expressionPoint([5, 0, 15])),
        },
        { kind: "line", end: vector(expressionPoint([10, 0, 15])) },
      ],
      closed: false,
      tolerance: 3e-7,
    });
    expect(body).toEqual({
      kind: "sweep",
      profile: { node: "profile", kind: "profile" },
      path: { node: "spine", kind: "path" },
      transition: "right-corner",
      frame: "corrected-frenet",
    });
    expect(nodeDependencies(spine)).toEqual([]);
    expect(nodeDependencies(body)).toEqual([
      { node: "profile", kind: "profile" },
      { node: "spine", kind: "path" },
    ]);
    expect(outputKindForNode(spine)).toBe("path");

    const serialized = stringifyDocument(document);
    const parsed = parseDocumentValue(JSON.parse(serialized));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(document);
    expect(cloneDocument(document)).toEqual(document);
    expect(await hashDocument(parsed.value)).toBe(await hashDocument(document));
    expect(await hashDocument(document)).toBe(
      "73dbb032a03734dcc92cd228f7ae8dfdfa4fbc14f2b552d508403990a7ce58ac",
    );
  });

  it("keeps composite nodes and segment variants strict and dimensional", () => {
    const canonical = JSON.parse(
      stringifyDocument(canonicalCompositeDocument()),
    ) as any;
    for (const [label, mutate] of [
      ["node extra", (value: any) => (value.nodes.spine.extra = true)],
      [
        "line extra",
        (value: any) => (value.nodes.spine.segments[0].start = []),
      ],
      [
        "arc extra",
        (value: any) => (value.nodes.spine.segments[1].center = []),
      ],
      [
        "missing through",
        (value: any) => delete value.nodes.spine.segments[1].through,
      ],
      [
        "unknown segment",
        (value: any) => (value.nodes.spine.segments[1].kind = "bezier"),
      ],
      [
        "too few segments",
        (value: any) => (value.nodes.spine.segments = [value.nodes.spine.segments[1]]),
      ],
      ["closed", (value: any) => (value.nodes.spine.closed = true)],
      ["invalid tolerance", (value: any) => (value.nodes.spine.tolerance = 0)],
    ] as const) {
      const value = structuredClone(canonical);
      mutate(value);
      const parsed = parseDocumentValue(value);
      expect(parsed.ok, label).toBe(false);
      expect(parsed.diagnostics, label).toContainEqual(
        expect.objectContaining({ code: "IR_INVALID" }),
      );
    }

    const lineOnly = structuredClone(canonical);
    lineOnly.nodes.spine.segments = [
      { kind: "line", end: lineOnly.nodes.spine.segments[0].end },
      { kind: "line", end: lineOnly.nodes.spine.segments[2].end },
    ];
    const lineOnlyParsed = parseDocumentValue(lineOnly);
    expect(lineOnlyParsed.ok).toBe(false);
    expect(lineOnlyParsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FEATURE_INVALID",
        node: "spine",
        path: "/nodes/spine/segments",
      }),
    );

    const dimensional = structuredClone(canonical);
    dimensional.nodes.spine.segments[1].through[2] = {
      op: "literal",
      dimension: "angle",
      value: 1,
    };
    expect(validateDocument(dimensional).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "EXPRESSION_DIMENSION_MISMATCH",
        path: "/nodes/spine/segments/1/through/2",
      }),
    );
  });

  it("rejects builder representation misuse and foreign references", () => {
    const cad = design("composite-builder-validation");
    const profile = cad.sketch("profile", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(1), height: mm(1) }),
      ),
    );
    expect(() =>
      cad.compositePath("short", {
        start: expressionPoint([0, 0, 0]),
        segments: [
          {
            kind: "circularArc",
            through: expressionPoint([0, 0, 1]),
            end: expressionPoint([1, 0, 1]),
          },
        ],
      }),
    ).toThrow("at least two");
    expect(() =>
      cad.compositePath("lines", {
        start: expressionPoint([0, 0, 0]),
        segments: [
          { kind: "line", end: expressionPoint([0, 0, 1]) },
          { kind: "line", end: expressionPoint([1, 0, 1]) },
        ],
      }),
    ).toThrow("at least one circular-arc");
    for (const tolerance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        cad.compositePath(
          `bad-tolerance-${String(tolerance)}`,
          {
            start: expressionPoint([0, 0, 0]),
            segments: canonicalSegmentExpressions(),
          },
          { tolerance },
        ),
      ).toThrow("finite and positive");
    }

    const path = cad.compositePath("spine", {
      start: expressionPoint([0, 0, 0]),
      segments: canonicalSegmentExpressions(),
    });
    const other = design("foreign-composite-owner");
    const foreignPath = other.compositePath("spine", {
      start: expressionPoint([0, 0, 0]),
      segments: canonicalSegmentExpressions(),
    });
    expect(() => cad.sweep("foreign", profile, foreignPath)).toThrow(
      "design boundaries",
    );

    if (false) {
      cad.compositePath("bad-kind", {
        start: expressionPoint([0, 0, 0]),
        segments: [
          // @ts-expect-error Composite arcs use the circularArc discriminant.
          { kind: "arc", end: expressionPoint([1, 0, 0]) },
          { kind: "line", end: expressionPoint([2, 0, 0]) },
        ],
      });
      // @ts-expect-error Paths are construction geometry, not final outputs.
      cad.output("path", path);
    }
  });
});

describe("resolved composite path admission and geometry", () => {
  it("expands exact implicit starts and exposes directed segment helpers", () => {
    const path = canonicalResolvedPath();
    const segments = resolvedCompositePathSegments(path);
    expect(segments).toEqual([
      { kind: "line", start: [0, 0, 0], end: [0, 0, 10] },
      {
        kind: "circularArc",
        start: [0, 0, 10],
        through: [5 - 5 * ROOT_HALF, 0, 10 + 5 * ROOT_HALF],
        end: [5, 0, 15],
      },
      { kind: "line", start: [5, 0, 15], end: [10, 0, 15] },
    ]);
    expect(resolvedPathSegmentLength(segments[0]!)).toBeCloseTo(10, 12);
    expect(resolvedPathSegmentLength(segments[1]!)).toBeCloseTo(
      (5 * Math.PI) / 2,
      11,
    );
    expectVec3(resolvedPathSegmentStartTangent(segments[0]!), [0, 0, 1]);
    expectVec3(resolvedPathSegmentEndTangent(segments[1]!), [1, 0, 0]);
    expectVec3(resolvedPathStart(path), [0, 0, 0]);
    expectVec3(resolvedPathInitialTangent(path), [0, 0, 1]);
    expect(resolvedPathEdgeCount(path)).toBe(3);
    expect(validateResolvedCompositePath(path, PATH_TOLERANCE)).toBeUndefined();
    expect(validateResolvedPath(path, PATH_TOLERANCE)).toBeUndefined();
  });

  it("accepts arbitrary spatial support planes and line-line corners", () => {
    const azimuth = 0.63;
    const cosine = Math.cos(azimuth);
    const sine = Math.sin(azimuth);
    const radius = 4;
    const center: Vec3 = [radius * cosine, radius * sine, 10];
    const start: Vec3 = [0, 0, 10];
    const through: Vec3 = [
      center[0] * (1 - ROOT_HALF),
      center[1] * (1 - ROOT_HALF),
      10 + radius * ROOT_HALF,
    ];
    const end: Vec3 = [center[0], center[1], 14];
    const path: ResolvedCompositePath = {
      kind: "composite",
      start: [0, 0, 0],
      segments: [
        { kind: "line", end: start },
        { kind: "circularArc", through, end },
        {
          kind: "line",
          end: [end[0] + radius * cosine, end[1] + radius * sine, end[2]],
        },
        {
          kind: "line",
          end: [end[0] + radius * cosine, end[1] + radius * sine, end[2] + 3],
        },
      ],
      closed: false,
    };
    expect(validateResolvedCompositePath(path, PATH_TOLERANCE)).toBeUndefined();
    const segments = resolvedCompositePathSegments(path);
    expectVec3(resolvedPathSegmentEndTangent(segments[1]!), [cosine, sine, 0]);
  });

  it("pins the forward-G1 angular boundary", () => {
    const admitted = skewJunctionPath(COMPOSITE_PATH_MAX_JUNCTION_SINE / 2);
    const rejected = skewJunctionPath(COMPOSITE_PATH_MAX_JUNCTION_SINE * 2);
    expect(validateResolvedCompositePath(admitted, PATH_TOLERANCE)).toBeUndefined();
    expect(validateResolvedCompositePath(rejected, PATH_TOLERANCE)).toEqual(
      expect.objectContaining({
        reason: "non-tangent-junction",
        segmentIndex: 1,
        otherSegmentIndex: 0,
      }),
    );
  });

  it("reports every composite-specific validation reason", () => {
    const canonical = canonicalResolvedPath();
    const sameCircle: ResolvedCompositePath = {
      kind: "composite",
      start: [1, 0, 0],
      segments: [
        {
          kind: "circularArc",
          through: [ROOT_HALF, ROOT_HALF, 0],
          end: [0, 1, 0],
        },
        {
          kind: "circularArc",
          through: [-ROOT_HALF, ROOT_HALF, 0],
          end: [-1, 0, 0],
        },
      ],
      closed: false,
    };
    const selfIntersecting: ResolvedCompositePath = {
      kind: "composite",
      start: [0, 0, 0],
      segments: [
        { kind: "line", end: [0, 0, 10] },
        {
          kind: "circularArc",
          through: [2, 0, 12],
          end: [4, 0, 10],
        },
        { kind: "line", end: [4, 0, 0] },
        { kind: "line", end: [-1, 0, 0] },
      ],
      closed: false,
    };
    const cases: readonly {
      readonly reason:
        | "invalid-tolerance"
        | "segment-count"
        | "line-only-composite"
        | "non-finite-point"
        | "degenerate-segment"
        | "closed-path"
        | "collinear-arc-points"
        | "non-tangent-junction"
        | "redundant-segments"
        | "self-intersection";
      readonly path: ResolvedCompositePath;
      readonly tolerance?: number;
    }[] = [
      { reason: "invalid-tolerance", path: canonical, tolerance: 0 },
      {
        reason: "segment-count",
        path: {
          kind: "composite",
          start: [0, 0, 0],
          segments: [canonical.segments[1]!],
          closed: false,
        },
      },
      {
        reason: "line-only-composite",
        path: {
          kind: "composite",
          start: [0, 0, 0],
          segments: [
            { kind: "line", end: [0, 0, 1] },
            { kind: "line", end: [1, 0, 1] },
          ],
          closed: false,
        },
      },
      {
        reason: "non-finite-point",
        path: {
          ...canonical,
          segments: [
            { kind: "line", end: [0, 0, Number.POSITIVE_INFINITY] },
            ...canonical.segments.slice(1),
          ],
        },
      },
      {
        reason: "degenerate-segment",
        path: {
          ...canonical,
          segments: [
            { kind: "line", end: [0, 0, PATH_TOLERANCE / 2] },
            ...canonical.segments.slice(1),
          ],
        },
      },
      {
        reason: "closed-path",
        path: {
          ...canonical,
          segments: [
            ...canonical.segments.slice(0, -1),
            { kind: "line", end: canonical.start },
          ],
        },
      },
      {
        reason: "collinear-arc-points",
        path: {
          ...canonical,
          segments: [
            canonical.segments[0]!,
            {
              kind: "circularArc",
              through: [0, 0, 11],
              end: [0, 0, 12],
            },
          ],
        },
      },
      {
        reason: "non-tangent-junction",
        path: {
          kind: "composite",
          start: [0, 0, 0],
          segments: [
            { kind: "line", end: [0, 0, 10] },
            {
              kind: "circularArc",
              through: [1, 1, 10],
              end: [2, 0, 10],
            },
          ],
          closed: false,
        },
      },
      {
        reason: "redundant-segments",
        path: {
          kind: "composite",
          start: [0, 0, 0],
          segments: [
            { kind: "line", end: [0, 0, 5] },
            { kind: "line", end: [0, 0, 10] },
            canonical.segments[1]!,
          ],
          closed: false,
        },
      },
      { reason: "redundant-segments", path: sameCircle },
      { reason: "self-intersection", path: selfIntersecting },
    ];

    for (const testCase of cases) {
      expect(
        validateResolvedCompositePath(
          testCase.path,
          testCase.tolerance ?? PATH_TOLERANCE,
        ),
        testCase.reason,
      ).toEqual(expect.objectContaining({ reason: testCase.reason }));
    }
  });

  it("admits certified major and near-full arcs without a closing-chord rule", () => {
    const major = majorLineArcLinePath();
    expect(validateResolvedCompositePath(major, PATH_TOLERANCE)).toBeUndefined();
    const majorArc = resolvedCompositePathSegments(major)[1]!;
    expect(majorArc.kind).toBe("circularArc");
    expect(
      resolvedCircularArcGeometry(
        majorArc as Extract<ResolvedPathSegment, { kind: "circularArc" }>,
      )!.sweep,
    ).toBeCloseTo((Math.PI * 3) / 2, 12);
    expect(
      validateResolvedSweep(
        rectangleProfile({
          origin: major.start,
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
        major,
        PATH_TOLERANCE,
      ),
    ).toBeUndefined();

    const arcChain = majorArcArcPath();
    expect(
      validateResolvedCompositePath(arcChain, PATH_TOLERANCE),
    ).toBeUndefined();
    const arcChainSegments = resolvedCompositePathSegments(arcChain);
    expect(
      resolvedAdjacentPathSegmentsHaveRemoteClearance(
        arcChainSegments[0]!,
        arcChainSegments[1]!,
        Math.SQRT2 + PATH_TOLERANCE,
      ),
    ).toBe(true);
    expect(
      validateResolvedSweep(
        rectangleProfile({
          origin: arcChain.start,
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
        arcChain,
        PATH_TOLERANCE,
      ),
    ).toBeUndefined();

    const nearFull = nearFullLineArcLinePath(0.02);
    expect(
      validateResolvedCompositePath(nearFull, PATH_TOLERANCE),
    ).toBeUndefined();
    const nearFullArc = resolvedCompositePathSegments(nearFull)[1]!;
    const geometry = resolvedCircularArcGeometry(
      nearFullArc as Extract<
        ResolvedPathSegment,
        { kind: "circularArc" }
      >,
    )!;
    expect(geometry.closingSweep).toBeCloseTo(0.02, 12);
    expect(geometry.closingLength).toBeCloseTo(0.4, 10);
    expect(
      validateResolvedSweep(
        rectangleProfile({
          origin: nearFull.start,
          halfWidth: 0.01,
          halfHeight: 0.01,
        }),
        nearFull,
        PATH_TOLERANCE,
      ),
    ).toBeUndefined();
  });

  it("classifies composite refinements at the exact major and centering boundaries", () => {
    const belowMajorSweep =
      Math.PI + COMPOSITE_SWEEP_MAJOR_ARC_ANGLE_EPSILON / 2;
    const aboveMajorSweep =
      COMPOSITE_SWEEP_MAJOR_ARC_THRESHOLD +
      COMPOSITE_SWEEP_MAJOR_ARC_ANGLE_EPSILON;
    const pathForSweep = (sweep: number): ResolvedCompositePath =>
      nearFullLineArcLinePath(Math.PI * 2 - sweep);
    const centeredProfile = (path: ResolvedCompositePath): ResolvedProfile =>
      rectangleProfile({
        origin: path.start,
        halfWidth: 0.5,
        halfHeight: 0.5,
      });

    const below = classifyResolvedCompositeSweepRefinements(
      centeredProfile(pathForSweep(belowMajorSweep)),
      pathForSweep(belowMajorSweep),
      PATH_TOLERANCE,
    );
    expect(below).toEqual(expect.objectContaining({ ok: true }));
    if (!below.ok) throw new Error(below.message);
    expect(below.evidence.arcs).toHaveLength(1);
    expect(below.evidence.arcs[0]!.sweep).toBeCloseTo(belowMajorSweep, 12);
    expect(below.evidence.arcs[0]!.major).toBe(false);
    expect(below.requiredRefinements).toEqual([]);
    expect(below.evidence.profile).toBeUndefined();

    const thresholdPath = pathForSweep(COMPOSITE_SWEEP_MAJOR_ARC_THRESHOLD);
    const atThreshold = classifyResolvedCompositeSweepRefinements(
      centeredProfile(thresholdPath),
      thresholdPath,
      PATH_TOLERANCE,
    );
    expect(atThreshold).toEqual(expect.objectContaining({ ok: true }));
    if (!atThreshold.ok) throw new Error(atThreshold.message);
    expect(atThreshold.evidence.arcs[0]!.sweep).toBe(
      COMPOSITE_SWEEP_MAJOR_ARC_THRESHOLD,
    );
    expect(atThreshold.evidence.arcs[0]!.major).toBe(false);
    expect(atThreshold.requiredRefinements).toEqual([]);
    expect(atThreshold.evidence.profile).toBeUndefined();

    const abovePath = pathForSweep(aboveMajorSweep);
    const above = classifyResolvedCompositeSweepRefinements(
      centeredProfile(abovePath),
      abovePath,
      PATH_TOLERANCE,
    );
    expect(above).toEqual(expect.objectContaining({ ok: true }));
    if (!above.ok) throw new Error(above.message);
    expect(above.evidence.arcs[0]!.sweep).toBeCloseTo(aboveMajorSweep, 12);
    expect(above.evidence.arcs[0]!.major).toBe(true);
    expect(above.requiredRefinements).toEqual([]);

    const majorPath = majorLineArcLinePath();
    const atTolerance = classifyResolvedCompositeSweepRefinements(
      rectangleProfile({
        origin: majorPath.start,
        center: [PATH_TOLERANCE, 0],
        halfWidth: 0.5,
        halfHeight: 0.5,
      }),
      majorPath,
      PATH_TOLERANCE,
    );
    expect(atTolerance).toEqual(expect.objectContaining({ ok: true }));
    if (!atTolerance.ok) throw new Error(atTolerance.message);
    expect(atTolerance.requiredRefinements).toEqual([]);
    expect(
      atTolerance.evidence.profile!
        .certifiedSeatedCentroidDistanceLowerBound,
    ).toBeLessThanOrEqual(PATH_TOLERANCE);

    const beyondTolerance = classifyResolvedCompositeSweepRefinements(
      rectangleProfile({
        origin: majorPath.start,
        center: [PATH_TOLERANCE + 1e-10, 0],
        halfWidth: 0.5,
        halfHeight: 0.5,
      }),
      majorPath,
      PATH_TOLERANCE,
    );
    expect(beyondTolerance).toEqual(expect.objectContaining({ ok: true }));
    if (!beyondTolerance.ok) throw new Error(beyondTolerance.message);
    expect(beyondTolerance.requiredRefinements).toEqual([
      "major-eccentric-profile",
    ]);
    expect(
      beyondTolerance.evidence.profile!
        .certifiedSeatedCentroidDistanceLowerBound,
    ).toBeGreaterThan(PATH_TOLERANCE);
  });

  it("keeps refinement classification local to the transferred section", () => {
    const major = majorLineArcLinePath();
    const centered = rectangleProfile({
      origin: major.start,
      halfWidth: 0.5,
      halfHeight: 0.5,
    });
    const admittedOriginMismatch: ResolvedProfile = {
      ...centered,
      plane: {
        ...centered.plane,
        origin: [
          centered.plane.origin[0] + PATH_TOLERANCE / 2,
          centered.plane.origin[1],
          centered.plane.origin[2],
        ],
      },
    };
    expect(
      validateResolvedSweep(admittedOriginMismatch, major, PATH_TOLERANCE),
    ).toBeUndefined();
    for (const profile of [centered, admittedOriginMismatch]) {
      const classification = classifyResolvedCompositeSweepRefinements(
        profile,
        major,
        PATH_TOLERANCE,
      );
      expect(classification).toEqual(expect.objectContaining({ ok: true }));
      if (!classification.ok) throw new Error(classification.message);
      expect(classification.requiredRefinements).toEqual([]);
      expect(classification.evidence.profile?.localCentroid).toEqual([0, 0]);
      expect(classification.evidence.profile?.seatedCentroidDistance).toBe(0);
    }

    const sameDirectionMismatch = rectangleProfile({
      origin: [
        major.start[0] + (PATH_TOLERANCE * 3) / 4,
        major.start[1],
        major.start[2],
      ],
      center: [(PATH_TOLERANCE * 3) / 4, 0],
      halfWidth: 0.5,
      halfHeight: 0.5,
    });
    expect(
      validateResolvedSweep(sameDirectionMismatch, major, PATH_TOLERANCE),
    ).toBeUndefined();
    const localClassification =
      classifyResolvedCompositeSweepRefinements(
        sameDirectionMismatch,
        major,
        PATH_TOLERANCE,
      );
    expect(localClassification).toEqual(
      expect.objectContaining({ ok: true }),
    );
    if (!localClassification.ok) throw new Error(localClassification.message);
    expect(localClassification.requiredRefinements).toEqual([]);
    expect(
      localClassification.evidence.profile?.seatedCentroidDistance,
    ).toBeCloseTo((PATH_TOLERANCE * 3) / 4, 14);

    const cancellingOriginMismatch = rectangleProfile({
      origin: [
        major.start[0] - (PATH_TOLERANCE * 3) / 4,
        major.start[1],
        major.start[2],
      ],
      center: [(PATH_TOLERANCE * 3) / 2, 0],
      halfWidth: 0.5,
      halfHeight: 0.5,
    });
    expect(
      validateResolvedSweep(cancellingOriginMismatch, major, PATH_TOLERANCE),
    ).toBeUndefined();
    const eccentricLocalClassification =
      classifyResolvedCompositeSweepRefinements(
        cancellingOriginMismatch,
        major,
        PATH_TOLERANCE,
      );
    expect(eccentricLocalClassification).toEqual(
      expect.objectContaining({ ok: true }),
    );
    if (!eccentricLocalClassification.ok) {
      throw new Error(eccentricLocalClassification.message);
    }
    expect(eccentricLocalClassification.requiredRefinements).toEqual([
      "major-eccentric-profile",
    ]);

    const minor = canonicalResolvedPath();
    const eccentricMinor = classifyResolvedCompositeSweepRefinements(
      rectangleProfile({
        origin: minor.start,
        center: [0.25, 0],
      }),
      minor,
      PATH_TOLERANCE,
    );
    expect(eccentricMinor).toEqual(expect.objectContaining({ ok: true }));
    if (!eccentricMinor.ok) throw new Error(eccentricMinor.message);
    expect(eccentricMinor.requiredRefinements).toEqual([]);
    expect(eccentricMinor.evidence.profile).toBeUndefined();

    const combined = classifyResolvedCompositeSweepRefinements(
      rectangleProfile({
        origin: majorArcArcPath().start,
        center: [0.25, 0],
        halfWidth: 0.5,
        halfHeight: 0.5,
      }),
      majorArcArcPath(),
      PATH_TOLERANCE,
    );
    expect(combined).toEqual(expect.objectContaining({ ok: true }));
    if (!combined.ok) throw new Error(combined.message);
    expect(combined.requiredRefinements).toEqual([
      "major-multiple-arcs",
      "major-eccentric-profile",
    ]);
  });

  it("keeps local eccentricity invariant under large world translation", () => {
    const originalPath = majorLineArcLinePath();
    const offset: Vec3 = [1e12, 0, 0];
    const translatedPoint = (point: Vec3): Vec3 => [
      point[0] + offset[0],
      point[1] + offset[1],
      point[2] + offset[2],
    ];
    const translatedPath: ResolvedCompositePath = {
      ...originalPath,
      start: translatedPoint(originalPath.start),
      segments: originalPath.segments.map((segment) =>
        segment.kind === "line"
          ? { ...segment, end: translatedPoint(segment.end) }
          : {
              ...segment,
              through: translatedPoint(segment.through),
              end: translatedPoint(segment.end),
            },
      ),
    };
    const originalProfile = rectangleProfile({
      origin: originalPath.start,
      center: [0.1, 0],
      halfWidth: 0.5,
      halfHeight: 0.5,
    });
    const translatedProfile: ResolvedProfile = {
      ...originalProfile,
      plane: {
        ...originalProfile.plane,
        origin: translatedPath.start,
      },
    };

    for (const [profile, path] of [
      [originalProfile, originalPath],
      [translatedProfile, translatedPath],
    ] as const) {
      expect(validateResolvedSweep(profile, path, PATH_TOLERANCE)).toBeUndefined();
      const classification = classifyResolvedCompositeSweepRefinements(
        profile,
        path,
        PATH_TOLERANCE,
      );
      expect(classification).toEqual(expect.objectContaining({ ok: true }));
      if (!classification.ok) throw new Error(classification.message);
      expect(classification.requiredRefinements).toEqual([
        "major-eccentric-profile",
      ]);
      expect(
        classification.evidence.profile?.seatedCentroidDistance,
      ).toBeCloseTo(0.1, 12);
    }
  });

  it("certifies exact mixed-segment separation and conservative sweep clearance", () => {
    const clearLine: ResolvedPathSegment = {
      kind: "line",
      start: [10, 0, 0],
      end: [10, 0, 10],
    };
    const quarterArc: ResolvedPathSegment = {
      kind: "circularArc",
      start: [1, 0, 0],
      through: [ROOT_HALF, ROOT_HALF, 0],
      end: [0, 1, 0],
    };
    const crossingLine: ResolvedPathSegment = {
      kind: "line",
      start: [-2, ROOT_HALF, 0],
      end: [2, ROOT_HALF, 0],
    };
    expect(resolvedPathSegmentsHaveClearance(clearLine, quarterArc, 1)).toBe(true);
    expect(resolvedPathSegmentsHaveClearance(crossingLine, quarterArc, 0)).toBe(
      false,
    );
    const translatedQuarterArc: ResolvedPathSegment = {
      kind: "circularArc",
      start: [11, 0, 0],
      through: [10 + ROOT_HALF, ROOT_HALF, 0],
      end: [10, 1, 0],
    };
    expect(
      resolvedPathSegmentsHaveClearance(quarterArc, translatedQuarterArc, 1),
    ).toBe(true);
    expect(resolvedPathSegmentsHaveClearance(quarterArc, quarterArc, 0)).toBe(
      false,
    );
    const gateLine: ResolvedPathSegment = {
      kind: "line",
      start: [0, 0, -1],
      end: [0, 0, 0],
    };
    const gateSemicircle: ResolvedPathSegment = {
      kind: "circularArc",
      start: [0, 0, 0],
      through: [10, 0, 10],
      end: [20, 0, 0],
    };
    expect(
      resolvedAdjacentPathSegmentsHaveRemoteClearance(
        gateLine,
        gateSemicircle,
        20 - 1e-6,
      ),
    ).toBe(true);
    expect(
      resolvedAdjacentPathSegmentsHaveRemoteClearance(
        gateLine,
        gateSemicircle,
        20,
      ),
    ).toBe(false);
    const cancellationScaleArc: ResolvedPathSegment = {
      kind: "circularArc",
      start: [0, 0, 0],
      through: [5e11, 20_000, 0],
      end: [1e12, 0, 0],
    };
    const nearAuthoredThroughPoint: ResolvedPathSegment = {
      kind: "line",
      start: [5e11, 20_000.1, -1],
      end: [5e11, 20_000.1, 1],
    };
    expect(
      resolvedPathSegmentsHaveClearance(
        cancellationScaleArc,
        nearAuthoredThroughPoint,
        0.4,
      ),
    ).toBe(false);
    const cancellationGeometry = resolvedCircularArcGeometry(
      cancellationScaleArc,
    )!;
    const uncertainTurnEnd: Vec3 = [
      cancellationScaleArc.end[0] +
        cancellationGeometry.endTangent[0] * 1e10,
      cancellationScaleArc.end[1] +
        cancellationGeometry.endTangent[1] * 1e10,
      cancellationScaleArc.end[2] +
        cancellationGeometry.endTangent[2] * 1e10,
    ];
    const numericallyUncertifiable: ResolvedCompositePath = {
      kind: "composite",
      start: cancellationScaleArc.start,
      segments: [
        {
          kind: "circularArc",
          through: cancellationScaleArc.through,
          end: cancellationScaleArc.end,
        },
        { kind: "line", end: uncertainTurnEnd },
        { kind: "line", end: [5e11, 20_000.1, 0] },
      ],
      closed: false,
    };
    expect(
      validateResolvedCompositePath(numericallyUncertifiable, PATH_TOLERANCE),
    ).toEqual(
      expect.objectContaining({
        reason: "uncertified-clearance",
        segmentIndex: 2,
        otherSegmentIndex: 0,
      }),
    );

    const closeToArc: ResolvedCompositePath = {
      ...canonicalResolvedPath(),
      segments: [
        ...canonicalResolvedPath().segments,
        { kind: "line", end: [10, 0, 12] },
        { kind: "line", end: [2.5, 0, 12] },
      ],
    };
    expect(validateResolvedCompositePath(closeToArc, PATH_TOLERANCE)).toBeUndefined();
    expect(
      validateResolvedSweep(rectangleProfile(), closeToArc, PATH_TOLERANCE),
    ).toEqual(
      expect.objectContaining({
        reason: "path-clearance",
        input: "path",
        segmentIndex: 4,
        otherSegmentIndex: 1,
      }),
    );

    const worldOffset = 1e16;
    const uncertifiableAdjacent: ResolvedCompositePath = {
      kind: "composite",
      start: [worldOffset, 0, -3],
      segments: [
        { kind: "line", end: [worldOffset, 0, 0] },
        {
          kind: "circularArc",
          through: [worldOffset + 20, 0, 0],
          end: [worldOffset + 10, 0, -10],
        },
      ],
      closed: false,
    };
    expect(
      validateResolvedCompositePath(
        uncertifiableAdjacent,
        PATH_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "uncertified-clearance",
        segmentIndex: 1,
        otherSegmentIndex: 0,
      }),
    );
  });

  it("separates adjacent topology from remote profile-envelope returns", () => {
    const rotation = 0.1;
    const remoteReturn: ResolvedCompositePath = {
      kind: "composite",
      start: [0, 4, 0],
      segments: [
        {
          kind: "circularArc",
          through: [-2, 2, 0],
          end: [0, 0, 0],
        },
        {
          kind: "circularArc",
          through: [2, 2 * Math.cos(rotation), 2 * Math.sin(rotation)],
          end: [0, 4 * Math.cos(rotation), 4 * Math.sin(rotation)],
        },
      ],
      closed: false,
    };
    expect(
      validateResolvedCompositePath(remoteReturn, PATH_TOLERANCE),
    ).toBeUndefined();
    const remoteSegments = resolvedCompositePathSegments(remoteReturn);
    expect(
      resolvedAdjacentPathSegmentsHaveRemoteClearance(
        remoteSegments[0]!,
        remoteSegments[1]!,
        PATH_TOLERANCE,
      ),
    ).toBe(true);
    expect(
      resolvedAdjacentPathSegmentsHaveRemoteClearance(
        remoteSegments[0]!,
        remoteSegments[1]!,
        2 * Math.SQRT2 + PATH_TOLERANCE,
      ),
    ).toBe(false);
    expect(
      validateResolvedSweep(
        rectangleProfile({ plane: "YZ", origin: remoteReturn.start }),
        remoteReturn,
        PATH_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "path-clearance",
        segmentIndex: 1,
        otherSegmentIndex: 0,
      }),
    );

    const pathReturn = nearFullLineArcLinePath(5e-5, 1);
    expect(
      validateResolvedCompositePath(pathReturn, PATH_TOLERANCE),
    ).toEqual(
      expect.objectContaining({
        reason: "self-intersection",
        segmentIndex: 1,
        otherSegmentIndex: 0,
      }),
    );

    const sweepReturn = nearFullLineArcLinePath(0.02, 1);
    expect(
      validateResolvedCompositePath(sweepReturn, PATH_TOLERANCE),
    ).toBeUndefined();
    expect(
      validateResolvedSweep(
        rectangleProfile({
          origin: sweepReturn.start,
          halfWidth: 0.01,
          halfHeight: 0.01,
        }),
        sweepReturn,
        PATH_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "path-clearance",
        segmentIndex: 1,
        otherSegmentIndex: 0,
      }),
    );

    const pathReturnSegments = resolvedCompositePathSegments(pathReturn);
    const reversedArc: ResolvedPathSegment = {
      kind: "circularArc",
      start: pathReturnSegments[1]!.end,
      through: (pathReturnSegments[1] as Extract<
        ResolvedPathSegment,
        { kind: "circularArc" }
      >).through,
      end: pathReturnSegments[1]!.start,
    };
    const reversedIncoming: ResolvedPathSegment = {
      kind: "line",
      start: pathReturnSegments[1]!.start,
      end: pathReturnSegments[0]!.start,
    };
    expect(
      resolvedAdjacentPathSegmentsHaveRemoteClearance(
        reversedArc,
        reversedIncoming,
        PATH_TOLERANCE,
      ),
    ).toBe(false);

    const radius = 1_000;
    const sweep = 1e-4;
    const skew = 5e-7;
    const startRadius: Vec3 = [Math.sin(skew), -Math.cos(skew), 0];
    const center: Vec3 = [
      -radius * startRadius[0],
      -radius * startRadius[1],
      0,
    ];
    const point = (angle: number): Vec3 => [
      center[0] +
        radius *
          (startRadius[0] * Math.cos(angle) -
            startRadius[1] * Math.sin(angle)),
      center[1] +
        radius *
          (startRadius[1] * Math.cos(angle) +
            startRadius[0] * Math.sin(angle)),
      0,
    ];
    const end = point(sweep);
    const endTangent: Vec3 = [
      Math.cos(skew + sweep),
      Math.sin(skew + sweep),
      0,
    ];
    const shallowArc: ResolvedCompositePath = {
      kind: "composite",
      start: [0, 0, 0],
      segments: [
        {
          kind: "circularArc",
          through: point(sweep / 2),
          end,
        },
        {
          kind: "line",
          end: [
            end[0] + endTangent[0],
            end[1] + endTangent[1],
            end[2] + endTangent[2],
          ],
        },
      ],
      closed: false,
    };
    expect(validateResolvedCompositePath(shallowArc, PATH_TOLERANCE)).toBeUndefined();
    expect(
      validateResolvedSweep(
        rectangleProfile({ plane: "YZ", halfWidth: 0.01, halfHeight: 0.01 }),
        shallowArc,
        PATH_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "profile-tangent-mismatch",
        input: "profile",
      }),
    );

    const junctionSkew = COMPOSITE_PATH_MAX_JUNCTION_SINE / 2;
    const junctionRadius = 1_000;
    const junctionArcSweep = 0.1;
    const junction: Vec3 = [0, 0, 10];
    const junctionRadiusVector: Vec3 = [
      -Math.cos(junctionSkew),
      0,
      Math.sin(junctionSkew),
    ];
    const junctionTangent: Vec3 = [
      Math.sin(junctionSkew),
      0,
      Math.cos(junctionSkew),
    ];
    const junctionCenter: Vec3 = [
      junction[0] - junctionRadius * junctionRadiusVector[0],
      junction[1],
      junction[2] - junctionRadius * junctionRadiusVector[2],
    ];
    const junctionPoint = (angle: number): Vec3 => [
      junctionCenter[0] +
        junctionRadius *
          (junctionRadiusVector[0] * Math.cos(angle) +
            junctionTangent[0] * Math.sin(angle)),
      0,
      junctionCenter[2] +
        junctionRadius *
          (junctionRadiusVector[2] * Math.cos(angle) +
            junctionTangent[2] * Math.sin(angle)),
    ];
    const junctionEnd = junctionPoint(junctionArcSweep);
    const junctionEndTangent: Vec3 = [
      -junctionRadiusVector[0] * Math.sin(junctionArcSweep) +
        junctionTangent[0] * Math.cos(junctionArcSweep),
      0,
      -junctionRadiusVector[2] * Math.sin(junctionArcSweep) +
        junctionTangent[2] * Math.cos(junctionArcSweep),
    ];
    const profileScaledJunction: ResolvedCompositePath = {
      kind: "composite",
      start: [0, 0, 0],
      segments: [
        { kind: "line", end: junction },
        {
          kind: "circularArc",
          through: junctionPoint(junctionArcSweep / 2),
          end: junctionEnd,
        },
        {
          kind: "line",
          end: [
            junctionEnd[0] + 10 * junctionEndTangent[0],
            junctionEnd[1] + 10 * junctionEndTangent[1],
            junctionEnd[2] + 10 * junctionEndTangent[2],
          ],
        },
      ],
      closed: false,
    };
    expect(
      validateResolvedCompositePath(profileScaledJunction, PATH_TOLERANCE),
    ).toBeUndefined();
    expect(
      validateResolvedSweep(
        rectangleProfile({ halfWidth: 100, halfHeight: 100 }),
        profileScaledJunction,
        PATH_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "path-clearance",
        input: "path",
        segmentIndex: 1,
        otherSegmentIndex: 0,
      }),
    );
  });
});

describe("composite sweep evaluator protocol", () => {
  it("maps composite point and paired-segment failures to exact JSON pointers", async () => {
    const pointFailure = fixtureCompositeDocument([
      { kind: "line", end: expressionPoint([0, 0, 10]) },
      {
        kind: "circularArc",
        through: expressionPoint([0, 0, 10]),
        end: expressionPoint([5, 0, 15]),
      },
    ]);
    const pairFailure = fixtureCompositeDocument([
      { kind: "line", end: expressionPoint([0, 0, 10]) },
      {
        kind: "circularArc",
        through: expressionPoint([2, 0, 12]),
        end: expressionPoint([4, 0, 10]),
      },
      { kind: "line", end: expressionPoint([4, 0, 0]) },
      { kind: "line", end: expressionPoint([-1, 0, 0]) },
    ]);
    const harness = recordingSweepKernel();
    const solver = new FixtureSketchSolver(rectangleProfile());
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: solver,
    });
    try {
      const pointResult = await evaluator.evaluate(pointFailure);
      expect(pointResult.ok).toBe(false);
      expect(pointResult.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "FEATURE_INVALID",
          node: "spine",
          path: "/nodes/spine/segments/1/through",
          details: expect.objectContaining({
            reason: "duplicate-point",
            segmentIndex: 1,
            pointRole: "through",
          }),
        }),
      );

      const pairResult = await evaluator.evaluate(pairFailure);
      expect(pairResult.ok).toBe(false);
      expect(pairResult.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "FEATURE_INVALID",
          node: "spine",
          path: "/nodes/spine/segments/3",
          details: expect.objectContaining({
            reason: "self-intersection",
            segmentIndex: 3,
            otherSegmentIndex: 0,
          }),
        }),
      );
      expect(harness.compositeInvocations).toEqual([]);
    } finally {
      evaluator.dispose();
    }
  });

  it("requires the additive capability and implementation before dependencies", async () => {
    const invalidDependency = fixtureCompositeDocument([
      { kind: "line", end: expressionPoint([0, 0, 10]) },
      {
        kind: "circularArc",
        through: vec3(mm(2), mm(0), mm(1).div(0)),
        end: expressionPoint([5, 0, 15]),
      },
    ]);
    for (const testCase of [
      {
        declaresComposite: false,
        implementsComposite: false,
        code: "KERNEL_CAPABILITY_MISSING",
      },
      {
        declaresComposite: true,
        implementsComposite: false,
        code: "KERNEL_ERROR",
      },
    ] as const) {
      const harness = recordingSweepKernel(testCase);
      const solver = new FixtureSketchSolver(rectangleProfile());
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: solver,
      });
      try {
        const result = await evaluator.evaluate(invalidDependency);
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: testCase.code,
            node: "body",
            path: "/nodes/body",
            details: expect.objectContaining({
              kernel: "recording-composite-kernel",
              kind: "feature",
              capability: "compositeSweep",
              ...(testCase.declaresComposite
                ? { protocolViolation: true }
                : {}),
            }),
          }),
        );
        expect(solver.calls).toEqual([]);
        expect(harness.compositeInvocations).toEqual([]);
      } finally {
        evaluator.dispose();
      }
    }
  });

  it("preflights exactly the refinements required by major composite geometry", async () => {
    const singleMajor = majorLineArcLinePath();
    const majorAndMinor = majorArcArcPath();
    const minor = canonicalResolvedPath();
    const bothRefinements = [
      "major-multiple-arcs",
      "major-eccentric-profile",
    ] as const;
    const cases: readonly {
      readonly label: string;
      readonly path: ResolvedCompositePath;
      readonly profile: ResolvedProfile;
      readonly refinements?: readonly KernelCompositeSweepRefinement[];
    }[] = [
      {
        label: "centered single-major",
        path: singleMajor,
        profile: rectangleProfile({
          origin: singleMajor.start,
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
      },
      {
        label: "centered major-plus-minor",
        path: majorAndMinor,
        profile: rectangleProfile({
          origin: majorAndMinor.start,
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
        refinements: ["major-multiple-arcs"],
      },
      {
        label: "eccentric single-major",
        path: singleMajor,
        profile: rectangleProfile({
          origin: singleMajor.start,
          center: [0.25, 0],
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
        refinements: ["major-eccentric-profile"],
      },
      {
        label: "eccentric major-plus-minor",
        path: majorAndMinor,
        profile: rectangleProfile({
          origin: majorAndMinor.start,
          center: [0.25, 0],
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
        refinements: bothRefinements,
      },
      {
        label: "minor composite",
        path: minor,
        profile: rectangleProfile({
          origin: minor.start,
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
      },
    ];

    for (const testCase of cases) {
      const harness = recordingSweepKernel({
        ...(testCase.refinements === undefined
          ? {}
          : { compositeSweepRefinements: testCase.refinements }),
      });
      const solver = new FixtureSketchSolver(testCase.profile);
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: solver,
      });
      try {
        const result = await evaluator.evaluate(
          fixtureResolvedCompositeDocument(testCase.path),
        );
        expect(result.ok, testCase.label).toBe(true);
        if (result.ok) result.value.dispose();
        expect(harness.compositeInvocations, testCase.label).toHaveLength(1);
      } finally {
        evaluator.dispose();
      }
    }
  });

  it("reports every missing composite refinement before backend invocation", async () => {
    const singleMajor = majorLineArcLinePath();
    const majorAndMinor = majorArcArcPath();
    const cases: readonly {
      readonly label: string;
      readonly path: ResolvedCompositePath;
      readonly profile: ResolvedProfile;
      readonly refinements?: readonly KernelCompositeSweepRefinement[];
      readonly missing: KernelCompositeSweepRefinement;
    }[] = [
      {
        label: "major-plus-minor without an envelope",
        path: majorAndMinor,
        profile: rectangleProfile({
          origin: majorAndMinor.start,
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
        missing: "major-multiple-arcs",
      },
      {
        label: "eccentric single-major with an empty envelope",
        path: singleMajor,
        profile: rectangleProfile({
          origin: singleMajor.start,
          center: [0.25, 0],
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
        refinements: [],
        missing: "major-eccentric-profile",
      },
      {
        label: "combined geometry with only multiple-arcs",
        path: majorAndMinor,
        profile: rectangleProfile({
          origin: majorAndMinor.start,
          center: [0.25, 0],
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
        refinements: ["major-multiple-arcs"],
        missing: "major-eccentric-profile",
      },
      {
        label: "combined geometry with only eccentric-profile",
        path: majorAndMinor,
        profile: rectangleProfile({
          origin: majorAndMinor.start,
          center: [0.25, 0],
          halfWidth: 0.5,
          halfHeight: 0.5,
        }),
        refinements: ["major-eccentric-profile"],
        missing: "major-multiple-arcs",
      },
    ];

    for (const testCase of cases) {
      const harness = recordingSweepKernel({
        ...(testCase.refinements === undefined
          ? {}
          : { compositeSweepRefinements: testCase.refinements }),
      });
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: new FixtureSketchSolver(testCase.profile),
      });
      try {
        const result = await evaluator.evaluate(
          fixtureResolvedCompositeDocument(testCase.path),
        );
        expect(result.ok, testCase.label).toBe(false);
        expect(result.diagnostics, testCase.label).toContainEqual(
          expect.objectContaining({
            code: "KERNEL_CAPABILITY_MISSING",
            node: "body",
            path: "/nodes/body",
            details: expect.objectContaining({
              kernel: "recording-composite-kernel",
              kind: "compositeSweepRefinement",
              capability: testCase.missing,
              requiredRefinements: expect.arrayContaining([
                testCase.missing,
              ]),
              evidence: expect.any(Object),
            }),
          }),
        );
        expect(harness.compositeInvocations, testCase.label).toEqual([]);
      } finally {
        evaluator.dispose();
      }
    }
  });

  it("fails closed on malformed composite refinement envelopes", async () => {
    const path = majorArcArcPath();
    const profile = rectangleProfile({
      origin: path.start,
      center: [0.25, 0],
      halfWidth: 0.5,
      halfHeight: 0.5,
    });
    const refinements = [
      "major-multiple-arcs",
      "major-eccentric-profile",
    ] as const;
    const cases = [
      {
        label: "stale protocol",
        envelope: { protocolVersion: 2, refinements },
        reason: "unsupported-protocol-version",
      },
      {
        label: "duplicate refinement",
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: ["major-multiple-arcs", "major-multiple-arcs"],
        },
        reason: "duplicate-refinement",
      },
    ] as const;

    for (const testCase of cases) {
      const harness = recordingSweepKernel({
        compositeSweepEnvelope: testCase.envelope,
      });
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: new FixtureSketchSolver(profile),
      });
      try {
        const result = await evaluator.evaluate(
          fixtureResolvedCompositeDocument(path),
        );
        expect(result.ok, testCase.label).toBe(false);
        expect(result.diagnostics, testCase.label).toContainEqual(
          expect.objectContaining({
            code: "KERNEL_ERROR",
            node: "body",
            path: "/nodes/body",
            details: expect.objectContaining({
              kernel: "recording-composite-kernel",
              kind: "compositeSweepRefinement",
              capability: "major-multiple-arcs",
              protocolViolation: true,
              reason: testCase.reason,
              requiredRefinements: expect.arrayContaining([
                "major-multiple-arcs",
                "major-eccentric-profile",
              ]),
              evidence: expect.any(Object),
            }),
          }),
        );
        expect(harness.compositeInvocations, testCase.label).toEqual([]);
      } finally {
        evaluator.dispose();
      }
    }
  });

  it("ignores optional refinement metadata when the geometry needs none", async () => {
    const path = canonicalResolvedPath();
    const harness = recordingSweepKernel({
      compositeSweepEnvelope: {
        protocolVersion: 2,
        refinements: ["future-refinement"],
      },
    });
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: new FixtureSketchSolver(
        rectangleProfile({ origin: path.start, center: [0.25, 0] }),
      ),
    });
    try {
      const result = await evaluator.evaluate(
        fixtureResolvedCompositeDocument(path),
      );
      expect(result.ok).toBe(true);
      if (result.ok) result.value.dispose();
      expect(harness.compositeInvocations).toHaveLength(1);
    } finally {
      evaluator.dispose();
    }
  });

  it("transfers parameterized ordered segments and merged tolerance unchanged", async () => {
    const cad = design("numeric-composite-transfer");
    const depth = cad.parameter.length("depth", mm(10));
    const radius = cad.parameter.length("radius", mm(5));
    const profile = cad.sketch(
      "profile",
      plane.xy(),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("section", { width: mm(2), height: mm(2) }),
        ),
      { tolerance: 4e-7 },
    );
    const rootHalf = scalar(ROOT_HALF);
    const spine = cad.compositePath(
      "spine",
      {
        start: expressionPoint([0, 0, 0]),
        segments: [
          { kind: "line", end: vec3(mm(0), mm(0), depth) },
          {
            kind: "circularArc",
            through: vec3(
              radius.mul(scalar(1 - ROOT_HALF)),
              mm(0),
              depth.add(radius.mul(rootHalf)),
            ),
            end: vec3(radius, mm(0), depth.add(radius)),
          },
          {
            kind: "line",
            end: vec3(radius.mul(scalar(2)), mm(0), depth.add(radius)),
          },
        ],
      },
      { tolerance: 8e-7 },
    );
    cad.output("body", cad.sweep("body", profile, spine));

    const solvedProfile = rectangleProfile();
    const harness = recordingSweepKernel();
    const solver = new FixtureSketchSolver(solvedProfile);
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: solver,
    });
    try {
      const result = await evaluator.evaluate(cad.build(), {
        parameters: { depth: 12, radius: 5 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        expect(solver.calls).toEqual(["profile"]);
        expect(harness.polylineInvocations).toEqual([]);
        expect(harness.arcInvocations).toEqual([]);
        expect(harness.compositeInvocations).toEqual([
          {
            profile: solvedProfile,
            path: {
              kind: "composite",
              start: [0, 0, 0],
              segments: [
                { kind: "line", end: [0, 0, 12] },
                {
                  kind: "circularArc",
                  through: [5 - 5 * ROOT_HALF, 0, 12 + 5 * ROOT_HALF],
                  end: [5, 0, 17],
                },
                { kind: "line", end: [10, 0, 17] },
              ],
              closed: false,
            },
            options: {
              transition: "right-corner",
              frame: "corrected-frenet",
            },
            context: { feature: "body", tolerance: 8e-7 },
          },
        ]);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("preserves legacy polyline and one-arc capability dispatch", async () => {
    const harness = recordingSweepKernel({
      declaresComposite: false,
      implementsComposite: false,
    });
    const solver = new FixtureSketchSolver(rectangleProfile());
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: solver,
    });
    try {
      const lineCad = design("legacy-polyline-dispatch");
      const lineProfile = lineCad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("section", { width: mm(2), height: mm(2) }),
        ),
      );
      const linePath = lineCad.polylinePath("spine", [
        expressionPoint([0, 0, 0]),
        expressionPoint([0, 0, 5]),
        expressionPoint([5, 0, 5]),
      ]);
      lineCad.output("body", lineCad.sweep("body", lineProfile, linePath));
      const lineResult = await evaluator.evaluate(lineCad.build());
      expect(lineResult.ok).toBe(true);
      if (lineResult.ok) lineResult.value.dispose();

      const arcCad = design("legacy-arc-dispatch");
      const arcProfile = arcCad.sketch("profile", plane.xy(), (sketch) =>
        sketch.profile(
          sketch.rectangle("section", { width: mm(2), height: mm(2) }),
        ),
      );
      const arcPath = arcCad.circularArcPath("spine", {
        start: expressionPoint([0, 0, 0]),
        through: expressionPoint([5, 0, 5]),
        end: expressionPoint([10, 0, 0]),
      });
      arcCad.output("body", arcCad.sweep("body", arcProfile, arcPath));
      const arcResult = await evaluator.evaluate(arcCad.build());
      expect(arcResult.ok).toBe(true);
      if (arcResult.ok) arcResult.value.dispose();

      expect(harness.compositeInvocations).toEqual([]);
      expect(harness.polylineInvocations).toHaveLength(1);
      expect(harness.arcInvocations).toHaveLength(1);
    } finally {
      evaluator.dispose();
    }
  });
});
