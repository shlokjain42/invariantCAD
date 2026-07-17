import { describe, expect, it } from "vitest";
import {
  CIRCULAR_ARC_PATH_MIN_POINT_SINE,
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
  resolvedPathEdgeCount,
  resolvedPathInitialTangent,
  resolvedPathStart,
  scalar,
  stringifyDocument,
  validateDocument,
  validateResolvedCircularArcPath,
  validateResolvedPath,
  validateResolvedPolylinePath,
  validateResolvedSweep,
  vec3,
  type DesignDocument,
  type GeometryKernel,
  type KernelFeatureContext,
  type KernelShape,
  type PrincipalPlane,
  type ResolvedCircularArcPath,
  type ResolvedLoop,
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

const PATH_TOLERANCE = 1e-7;

function expressionPoint(point: Vec3): Vec3Expression {
  return vec3(mm(point[0]), mm(point[1]), mm(point[2]));
}

function resolvedArc(
  start: Vec3,
  through: Vec3,
  end: Vec3,
): ResolvedCircularArcPath {
  return { kind: "circularArc", start, through, end, closed: false };
}

function rectangleLoop(halfWidth = 1, halfHeight = 1): ResolvedLoop {
  const points = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ] as const;
  return {
    curves: points.map((start, index) => ({
      kind: "line" as const,
      start,
      end: points[(index + 1) % points.length]!,
    })),
  };
}

function rectangleProfile(
  options: {
    readonly plane?: PrincipalPlane;
    readonly origin?: Vec3;
    readonly halfWidth?: number;
    readonly halfHeight?: number;
  } = {},
): ResolvedProfile {
  return {
    plane: {
      plane: options.plane ?? "XY",
      origin: options.origin ?? [0, 0, 0],
    },
    outer: rectangleLoop(options.halfWidth, options.halfHeight),
    holes: [],
  };
}

function canonicalCircularArcDocument(): DesignDocument {
  const cad = design("canonical-circular-arc-sweep");
  const profile = cad.sketch(
    "profile",
    plane.xy(),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(2), height: mm(2) }),
      ),
    { tolerance: 2e-7 },
  );
  const path = cad.circularArcPath(
    "spine",
    {
      start: expressionPoint([0, 0, 0]),
      through: expressionPoint([10, 0, 10]),
      end: expressionPoint([20, 0, 0]),
    },
    { tolerance: 3e-7 },
  );
  cad.output("body", cad.sweep("body", profile, path));
  return cad.build();
}

function fixtureCircularArcDocument(
  points: {
    readonly start: Vec3Expression;
    readonly through: Vec3Expression;
    readonly end: Vec3Expression;
  },
  options: {
    readonly pathTolerance?: number;
    readonly profileTolerance?: number;
  } = {},
): DesignDocument {
  const cad = design("fixture-circular-arc-sweep");
  const profile = cad.sketch(
    "profile",
    plane.xy(),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("placeholder", { width: mm(2), height: mm(2) }),
      ),
    { tolerance: options.profileTolerance ?? PATH_TOLERANCE },
  );
  const path = cad.circularArcPath("spine", points, {
    tolerance: options.pathTolerance ?? PATH_TOLERANCE,
  });
  cad.output("body", cad.sweep("body", profile, path));
  return cad.build();
}

interface ArcSweepInvocation {
  readonly profile: ResolvedProfile;
  readonly path: ResolvedCircularArcPath;
  readonly options: ResolvedSweepOptions;
  readonly context?: KernelFeatureContext;
}

interface PolylineSweepInvocation {
  readonly profile: ResolvedProfile;
  readonly path: ResolvedPolylinePath;
  readonly options: ResolvedSweepOptions;
  readonly context?: KernelFeatureContext;
}

function recordingSweepKernel(
  options: {
    readonly declaresPolyline?: boolean;
    readonly implementsPolyline?: boolean;
    readonly declaresCircularArc?: boolean;
    readonly implementsCircularArc?: boolean;
  } = {},
): {
  readonly kernel: GeometryKernel;
  readonly arcInvocations: ArcSweepInvocation[];
  readonly polylineInvocations: PolylineSweepInvocation[];
} {
  const id = "recording-path-kernel";
  const declaresPolyline = options.declaresPolyline ?? true;
  const implementsPolyline = options.implementsPolyline ?? true;
  const declaresCircularArc = options.declaresCircularArc ?? true;
  const implementsCircularArc = options.implementsCircularArc ?? true;
  const arcInvocations: ArcSweepInvocation[] = [];
  const polylineInvocations: PolylineSweepInvocation[] = [];
  let serial = 0;
  const shape = (): KernelShape =>
    ({ kernel: id, serial: serial++ }) as KernelShape;
  const features = [
    ...(declaresPolyline ? (["sweep"] as const) : []),
    ...(declaresCircularArc ? (["circularArcSweep"] as const) : []),
  ];
  const kernel: GeometryKernel = {
    id,
    capabilities: {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features,
      nativeImports: [],
      nativeExports: [],
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
  return { kernel, arcInvocations, polylineInvocations };
}

class FixtureSketchSolver implements SketchSolverBackend {
  readonly id = "fixture-circular-arc-sketch-solver";
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

function expectVec3(actual: Vec3, expected: Vec3, digits = 11): void {
  expected.forEach((component, index) =>
    expect(actual[index]).toBeCloseTo(component, digits),
  );
}

describe("exact circular-arc path document contract", () => {
  it("materializes canonical IR and round-trips with a stable semantic hash", async () => {
    expect(CIRCULAR_ARC_PATH_MIN_POINT_SINE).toBe(1e-10);
    const document = canonicalCircularArcDocument();
    const body = document.nodes[document.outputs.body!.node]!;
    expect(body.kind).toBe("sweep");
    if (body.kind !== "sweep") return;
    const spine = document.nodes[body.path.node]!;

    expect(spine).toEqual({
      kind: "circularArcPath",
      start: expressionPoint([0, 0, 0]).map((coordinate) => coordinate.ir),
      through: expressionPoint([10, 0, 10]).map((coordinate) => coordinate.ir),
      end: expressionPoint([20, 0, 0]).map((coordinate) => coordinate.ir),
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
      "c932ddd394d9ebdb168cd72cd8d0402469f003f06a245b0c98ffbf7ea20046c0",
    );
  });

  it("keeps the arc node schema strict and direct validation dimensional", () => {
    const canonical = JSON.parse(
      stringifyDocument(canonicalCircularArcDocument()),
    ) as any;
    for (const [label, mutate] of [
      ["extra field", (value: any) => (value.nodes.spine.extra = true)],
      ["closed path", (value: any) => (value.nodes.spine.closed = true)],
      ["missing through", (value: any) => delete value.nodes.spine.through],
      ["short start tuple", (value: any) => value.nodes.spine.start.pop()],
      ["invalid tolerance", (value: any) => (value.nodes.spine.tolerance = 0)],
    ] as const) {
      const value = structuredClone(canonical);
      mutate(value);
      const result = parseDocumentValue(value);
      expect(result.ok, label).toBe(false);
      expect(result.diagnostics, label).toContainEqual(
        expect.objectContaining({ code: "IR_INVALID" }),
      );
    }

    const closed = structuredClone(canonical) as any;
    closed.nodes.spine.closed = true;
    expect(validateDocument(closed).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FEATURE_INVALID",
        node: "spine",
        path: "/nodes/spine/closed",
      }),
    );

    const tolerance = structuredClone(canonical) as any;
    tolerance.nodes.spine.tolerance = Number.NaN;
    expect(validateDocument(tolerance).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FEATURE_INVALID",
        node: "spine",
        path: "/nodes/spine/tolerance",
      }),
    );

    const dimension = structuredClone(canonical) as any;
    dimension.nodes.spine.through[2] = {
      op: "literal",
      dimension: "angle",
      value: 1,
    };
    expect(validateDocument(dimension).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "EXPRESSION_DIMENSION_MISMATCH",
        path: "/nodes/spine/through/2",
      }),
    );

    const constructionOutput = structuredClone(canonical) as any;
    constructionOutput.outputs.body = { node: "spine", kind: "path" };
    expect(parseDocumentValue(constructionOutput).ok).toBe(false);
    expect(validateDocument(constructionOutput).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        path: "/outputs/body",
      }),
    );
  });

  it("rejects invalid builder tolerances and foreign arc-path references", () => {
    const points = {
      start: expressionPoint([0, 0, 0]),
      through: expressionPoint([5, 0, 5]),
      end: expressionPoint([10, 0, 0]),
    };
    for (const tolerance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const cad = design(`invalid-arc-tolerance-${String(tolerance)}`);
      expect(() =>
        cad.circularArcPath("spine", points, { tolerance }),
      ).toThrow("finite and positive");
    }

    const cad = design("arc-path-owner");
    const profile = cad.sketch("profile", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(1), height: mm(1) }),
      ),
    );
    const other = design("foreign-arc-path-owner");
    const foreignPath = other.circularArcPath("spine", points);
    expect(() => cad.sweep("body", profile, foreignPath)).toThrow(
      "design boundaries",
    );

    if (false) {
      // @ts-expect-error Paths are construction geometry, not final outputs.
      cad.output("spine", foreignPath);
    }
  });
});

describe("exact circular-arc geometry", () => {
  it("resolves minor, spatial, and 270-degree major arcs analytically", () => {
    const rootHalf = Math.SQRT1_2;
    const rootTwo = Math.SQRT2;
    const cases: readonly {
      readonly label: string;
      readonly path: ResolvedCircularArcPath;
      readonly center: Vec3;
      readonly normal: Vec3;
      readonly radius: number;
      readonly sweep: number;
      readonly tangent: Vec3;
    }[] = [
      {
        label: "minor",
        path: resolvedArc(
          [1, 0, 0],
          [rootHalf, rootHalf, 0],
          [0, 1, 0],
        ),
        center: [0, 0, 0],
        normal: [0, 0, 1],
        radius: 1,
        sweep: Math.PI / 2,
        tangent: [0, 1, 0],
      },
      {
        label: "spatial",
        path: resolvedArc(
          [1 + rootTwo, 2, 3 - rootTwo],
          [2, 2 + rootTwo, 2],
          [1, 4, 3],
        ),
        center: [1, 2, 3],
        normal: [rootHalf, 0, rootHalf],
        radius: 2,
        sweep: Math.PI / 2,
        tangent: [0, 1, 0],
      },
      {
        label: "major",
        path: resolvedArc([2, 0, 0], [-2, 0, 0], [0, -2, 0]),
        center: [0, 0, 0],
        normal: [0, 0, 1],
        radius: 2,
        sweep: (Math.PI * 3) / 2,
        tangent: [0, 1, 0],
      },
    ];

    for (const testCase of cases) {
      expect(
        validateResolvedCircularArcPath(testCase.path, PATH_TOLERANCE),
        testCase.label,
      ).toBeUndefined();
      expect(
        validateResolvedPath(testCase.path, PATH_TOLERANCE),
        testCase.label,
      ).toBeUndefined();
      const geometry = resolvedCircularArcGeometry(testCase.path);
      expect(geometry, testCase.label).toBeDefined();
      if (geometry === undefined) continue;
      expectVec3(geometry.center, testCase.center);
      expectVec3(geometry.normal, testCase.normal);
      expect(geometry.radius).toBeCloseTo(testCase.radius, 11);
      expect(geometry.sweep).toBeCloseTo(testCase.sweep, 11);
      expect(geometry.length).toBeCloseTo(
        testCase.radius * testCase.sweep,
        11,
      );
      expectVec3(geometry.startTangent, testCase.tangent);
      expectVec3(resolvedPathStart(testCase.path), testCase.path.start);
      expectVec3(resolvedPathInitialTangent(testCase.path), testCase.tangent);
      expect(resolvedPathEdgeCount(testCase.path)).toBe(1);
    }

    const largeRadiusNearFull = resolvedArc(
      [0, 0, 0],
      [0.012246467991473532, 200000000000000, 0],
      [-0.024492935982947064, 2.999519565323715e-18, 0],
    );
    expect(
      validateResolvedCircularArcPath(
        largeRadiusNearFull,
        PATH_TOLERANCE,
      ),
    ).toBeUndefined();
    const largeGeometry = resolvedCircularArcGeometry(largeRadiusNearFull)!;
    expect(largeGeometry.radius).toBeCloseTo(1e14, 0);
    expect(largeGeometry.closingSweep).toBeGreaterThan(0);
    expect(largeGeometry.closingLength).toBeCloseTo(
      0.024492935982947064,
      12,
    );
  });

  it("reports every bounded circular-arc admission reason", () => {
    const valid = resolvedArc([1, 0, 0], [0, 1, 0], [-1, 0, 0]);
    const tinyRadius = 0.8;
    const tinyHalfHeight = (Math.sqrt(3) * tinyRadius) / 2;
    const cases: readonly {
      readonly reason:
        | "invalid-tolerance"
        | "non-finite-point"
        | "duplicate-point"
        | "closed-path"
        | "collinear-arc-points"
        | "degenerate-arc";
      readonly path: ResolvedCircularArcPath;
      readonly tolerance?: number;
    }[] = [
      { reason: "invalid-tolerance", path: valid, tolerance: 0 },
      {
        reason: "non-finite-point",
        path: resolvedArc(
          [1, 0, 0],
          [0, Number.POSITIVE_INFINITY, 0],
          [-1, 0, 0],
        ),
      },
      {
        reason: "duplicate-point",
        path: resolvedArc([1, 0, 0], [1, 0, 0], [-1, 0, 0]),
      },
      {
        reason: "closed-path",
        path: resolvedArc([1, 0, 0], [0, 1, 0], [1, 0, 0]),
      },
      {
        reason: "closed-path",
        path: {
          ...valid,
          closed: true,
        } as unknown as ResolvedCircularArcPath,
      },
      {
        reason: "collinear-arc-points",
        path: resolvedArc([0, 0, 0], [1, 0, 0], [2, 0, 0]),
      },
      {
        reason: "degenerate-arc",
        path: resolvedArc(
          [tinyRadius, 0, 0],
          [-tinyRadius / 2, tinyHalfHeight, 0],
          [-tinyRadius / 2, -tinyHalfHeight, 0],
        ),
        tolerance: 1,
      },
    ];

    for (const testCase of cases) {
      expect(
        validateResolvedCircularArcPath(
          testCase.path,
          testCase.tolerance ?? PATH_TOLERANCE,
        ),
        testCase.reason,
      ).toEqual(expect.objectContaining({ reason: testCase.reason }));
      expect(
        validateResolvedPath(
          testCase.path,
          testCase.tolerance ?? PATH_TOLERANCE,
        ),
        `dispatcher ${testCase.reason}`,
      ).toEqual(expect.objectContaining({ reason: testCase.reason }));
    }
  });
});

describe("circular-arc sweep admission", () => {
  it("checks origin, analytic tangent in either direction, and curvature clearance", () => {
    const positive = resolvedArc(
      [0, 0, 0],
      [10, 0, 10],
      [20, 0, 0],
    );
    const negative = resolvedArc(
      [0, 0, 0],
      [10, 0, -10],
      [20, 0, 0],
    );
    const profile = rectangleProfile();
    expect(validateResolvedSweep(profile, positive, PATH_TOLERANCE)).toBeUndefined();
    expect(validateResolvedSweep(profile, negative, PATH_TOLERANCE)).toBeUndefined();

    expect(
      validateResolvedSweep(
        rectangleProfile({ origin: [1, 0, 0] }),
        positive,
        PATH_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "profile-origin-mismatch",
        input: "profile",
      }),
    );
    expect(
      validateResolvedSweep(
        rectangleProfile({ plane: "YZ" }),
        positive,
        PATH_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "profile-tangent-mismatch",
        input: "profile",
      }),
    );
    expect(
      validateResolvedSweep(
        profile,
        resolvedArc([0, 0, 0], [1, 0, 1], [2, 0, 0]),
        PATH_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({ reason: "path-clearance", input: "path" }),
    );

    const radius = 5;
    const sweep = Math.PI * 2 - 0.05;
    const point = (angle: number): Vec3 => [
      radius - radius * Math.cos(angle),
      0,
      radius * Math.sin(angle),
    ];
    const nearFull = resolvedArc(point(0), point(sweep / 2), point(sweep));
    expect(
      validateResolvedCircularArcPath(nearFull, PATH_TOLERANCE),
    ).toBeUndefined();
    expect(validateResolvedSweep(profile, nearFull, PATH_TOLERANCE)).toBeUndefined();
  });
});

describe("circular-arc sweep evaluator protocol", () => {
  it("requires the additive circularArcSweep capability before dependencies", async () => {
    const invalidDependency = fixtureCircularArcDocument({
      start: expressionPoint([0, 0, 0]),
      through: vec3(mm(5), mm(0), mm(1).div(0)),
      end: expressionPoint([10, 0, 0]),
    });
    for (const testCase of [
      {
        declaresCircularArc: false,
        implementsCircularArc: false,
        code: "KERNEL_CAPABILITY_MISSING",
      },
      {
        declaresCircularArc: true,
        implementsCircularArc: false,
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
              kernel: "recording-path-kernel",
              kind: "feature",
              capability: "circularArcSweep",
              ...(testCase.declaresCircularArc
                ? { protocolViolation: true }
                : {}),
            }),
          }),
        );
        expect(solver.calls).toEqual([]);
        expect(harness.arcInvocations).toEqual([]);
        expect(harness.polylineInvocations).toEqual([]);
      } finally {
        evaluator.dispose();
      }
    }
  });

  it("transfers parameterized numeric arc data, fixed semantics, and tolerance", async () => {
    const cad = design("numeric-circular-arc-transfer");
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
    const spine = cad.circularArcPath(
      "spine",
      {
        start: expressionPoint([0, 0, 0]),
        through: vec3(radius, mm(0), radius),
        end: vec3(radius.mul(scalar(2)), mm(0), mm(0)),
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
        parameters: { radius: 12 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        expect(solver.calls).toEqual(["profile"]);
        expect(harness.polylineInvocations).toEqual([]);
        expect(harness.arcInvocations).toEqual([
          {
            profile: solvedProfile,
            path: {
              kind: "circularArc",
              start: [0, 0, 0],
              through: [12, 0, 12],
              end: [24, 0, 0],
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

  it("preserves polyline validation and ordinary sweep capability dispatch", async () => {
    const path: ResolvedPolylinePath = {
      kind: "polyline",
      points: [
        [0, 0, 0],
        [0, 0, 5],
        [5, 0, 5],
      ],
      closed: false,
    };
    expect(validateResolvedPath(path, PATH_TOLERANCE)).toEqual(
      validateResolvedPolylinePath(path, PATH_TOLERANCE),
    );
    expectVec3(resolvedPathStart(path), [0, 0, 0]);
    expectVec3(resolvedPathInitialTangent(path), [0, 0, 1]);
    expect(resolvedPathEdgeCount(path)).toBe(2);

    const cad = design("compatible-polyline-sweep");
    const profile = cad.sketch("profile", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(2), height: mm(2) }),
      ),
    );
    const spine = cad.polylinePath("spine", [
      expressionPoint([0, 0, 0]),
      expressionPoint([0, 0, 5]),
      expressionPoint([5, 0, 5]),
    ]);
    cad.output("body", cad.sweep("body", profile, spine));

    const harness = recordingSweepKernel({
      declaresCircularArc: false,
      implementsCircularArc: false,
    });
    const solver = new FixtureSketchSolver(rectangleProfile());
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: solver,
    });
    try {
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        expect(harness.arcInvocations).toEqual([]);
        expect(harness.polylineInvocations).toHaveLength(1);
        expect(harness.polylineInvocations[0]!.path).toEqual(path);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });
});
