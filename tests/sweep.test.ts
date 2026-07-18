import { describe, expect, it } from "vitest";
import {
  POLYLINE_PATH_MIN_CORNER_SINE,
  SWEEP_FRAMES,
  SWEEP_TRANSITIONS,
  cloneDocument,
  createEvaluator,
  design,
  hashDocument,
  mm,
  nodeDependencies,
  outputKindForNode,
  parseDocumentValue,
  plane,
  stringifyDocument,
  validateDocument,
  validateResolvedPolylinePath,
  validateResolvedSweep,
  vec3,
  type DesignDocument,
  type GeometryKernel,
  type KernelFeatureContext,
  type KernelShape,
  type PrincipalPlane,
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

const SWEEP_TOLERANCE = 1e-7;

function rectangleLoop(
  halfWidth = 1,
  halfHeight = 1,
): ResolvedLoop {
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
    readonly holes?: readonly ResolvedLoop[];
  } = {},
): ResolvedProfile {
  return {
    plane: {
      plane: options.plane ?? "XY",
      origin: options.origin ?? [0, 0, 0],
    },
    outer: rectangleLoop(options.halfWidth, options.halfHeight),
    holes: options.holes ?? [],
  };
}

function resolvedPath(
  points: readonly Vec3[],
  closed: false = false,
): ResolvedPolylinePath {
  return { kind: "polyline", points, closed };
}

function expressionPoints(points: readonly Vec3[]): readonly Vec3Expression[] {
  return points.map((point) =>
    vec3(mm(point[0]), mm(point[1]), mm(point[2])),
  );
}

function canonicalSweepDocument(): DesignDocument {
  const cad = design("canonical-solid-sweep");
  const profile = cad.sketch(
    "profile",
    plane.xy(),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(4), height: mm(2) }),
      ),
    { tolerance: 2e-7 },
  );
  const spine = cad.polylinePath(
    "spine",
    expressionPoints([
      [0, 0, 0],
      [0, 0, 10],
      [8, 0, 10],
    ]),
    { tolerance: 3e-7 },
  );
  cad.output("body", cad.sweep("body", profile, spine));
  return cad.build();
}

function fixtureSweepDocument(
  points: readonly Vec3Expression[],
  options: {
    readonly pathTolerance?: number;
    readonly profileTolerance?: number;
  } = {},
): DesignDocument {
  const cad = design("fixture-solid-sweep");
  const profile = cad.sketch(
    "profile",
    plane.xy(),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("placeholder", { width: mm(2), height: mm(2) }),
      ),
    { tolerance: options.profileTolerance ?? SWEEP_TOLERANCE },
  );
  const spine = cad.polylinePath("spine", points, {
    tolerance: options.pathTolerance ?? SWEEP_TOLERANCE,
  });
  cad.output("body", cad.sweep("body", profile, spine));
  return cad.build();
}

interface SweepInvocation {
  readonly profile: ResolvedProfile;
  readonly path: ResolvedPolylinePath;
  readonly options: ResolvedSweepOptions;
  readonly context?: KernelFeatureContext;
}

function recordingSweepKernel(
  options: {
    readonly declaresSweep?: boolean;
    readonly implementsSweep?: boolean;
  } = {},
): {
  readonly kernel: GeometryKernel;
  readonly invocations: SweepInvocation[];
} {
  const id = "recording-sweep-kernel";
  const declaresSweep = options.declaresSweep ?? true;
  const implementsSweep = options.implementsSweep ?? true;
  const invocations: SweepInvocation[] = [];
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
      features: declaresSweep ? ["sweep"] : [],
      nativeImports: [],
      nativeExports: [],
    },
    ...(implementsSweep
      ? {
          sweep(
            profile: ResolvedProfile,
            path: ResolvedPolylinePath,
            resolved: ResolvedSweepOptions,
            context?: KernelFeatureContext,
          ): KernelShape {
            invocations.push({
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
      centerOfMass: [0.5, 0.5, 0.5],
      inertiaTensor: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
      genus: 0,
      tolerance: SWEEP_TOLERANCE,
    }),
    status: () => ({ ok: true, code: "OK" }),
    disposeShape: () => {},
    dispose: () => {},
  };
  return { kernel, invocations };
}

class FixtureSketchSolver implements SketchSolverBackend {
  readonly id = "fixture-sweep-sketch-solver";
  readonly capabilities: SketchSolverCapabilities = {
    entities: ["point", "line", "circle", "arc"],
    constraints: [],
    reportsDegreesOfFreedom: true,
    reportsConflicts: false,
  };
  readonly calls: string[] = [];
  private readonly profiles: Readonly<Record<string, ResolvedProfile>>;

  constructor(profiles: Readonly<Record<string, ResolvedProfile>>) {
    this.profiles = profiles;
  }

  solve(_sketch: SketchNodeIR, context: SketchSolveContext): SolvedSketch {
    const feature = context.feature;
    if (feature === undefined) throw new Error("Fixture solver requires a feature ID");
    this.calls.push(feature);
    const profile = this.profiles[feature];
    if (profile === undefined) throw new Error(`Missing fixture profile '${feature}'`);
    return {
      status: "solved",
      points: {},
      radii: {},
      profile,
      degreesOfFreedom: 0,
      iterations: 0,
      residual: 0,
      diagnostics: [],
    };
  }

  dispose(): void {}
}

describe("bounded solid sweep document contract", () => {
  it("materializes canonical path and sweep semantics and round-trips them", async () => {
    expect(SWEEP_TRANSITIONS).toEqual(["right-corner"]);
    expect(SWEEP_FRAMES).toEqual(["corrected-frenet"]);
    expect(POLYLINE_PATH_MIN_CORNER_SINE).toBe(1e-10);

    const document = canonicalSweepDocument();
    const body = document.nodes[document.outputs.body!.node]!;
    expect(body.kind).toBe("sweep");
    if (body.kind !== "sweep") return;
    const spine = document.nodes[body.path.node]!;
    expect(spine).toEqual({
      kind: "polylinePath",
      points: expressionPoints([
        [0, 0, 0],
        [0, 0, 10],
        [8, 0, 10],
      ]).map((point) => point.map((coordinate) => coordinate.ir)),
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
    expect(outputKindForNode(body)).toBe("solid");

    const serialized = stringifyDocument(document);
    const parsed = parseDocumentValue(JSON.parse(serialized));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(document);
    expect(cloneDocument(document)).toEqual(document);
    expect(await hashDocument(parsed.value)).toBe(await hashDocument(document));
    expect(await hashDocument(document)).toBe(
      "daf3ee522bee58133d8511bcce57c2323a7a842bda71e52da8b16f19844325e6",
    );
  });

  it("keeps path and sweep schemas strict and validates reference kinds", () => {
    const canonical = JSON.parse(
      stringifyDocument(canonicalSweepDocument()),
    ) as any;

    for (const [label, mutate] of [
      ["path extra", (value: any) => (value.nodes.spine.extra = true)],
      ["sweep extra", (value: any) => (value.nodes.body.extra = true)],
      ["closed path", (value: any) => (value.nodes.spine.closed = true)],
    ] as const) {
      const value = structuredClone(canonical);
      mutate(value);
      const result = parseDocumentValue(value);
      expect(result.ok, label).toBe(false);
      expect(result.diagnostics, label).toContainEqual(
        expect.objectContaining({ code: "IR_INVALID" }),
      );
    }

    for (const testCase of [
      {
        label: "declared profile kind for path",
        mutate: (value: any) => (value.nodes.body.path.kind = "profile"),
        path: "/nodes/body/path",
        code: "REFERENCE_KIND_MISMATCH",
      },
      {
        label: "path ref targeting profile",
        mutate: (value: any) => (value.nodes.body.path.node = "profile"),
        path: "/nodes/body/path",
        code: "REFERENCE_KIND_MISMATCH",
      },
      {
        label: "profile ref targeting path",
        mutate: (value: any) => (value.nodes.body.profile.node = "spine"),
        path: "/nodes/body/profile",
        code: "REFERENCE_KIND_MISMATCH",
      },
      {
        label: "missing path target",
        mutate: (value: any) => (value.nodes.body.path.node = "absent"),
        path: "/nodes/body/path/node",
        code: "REFERENCE_MISSING",
      },
    ] as const) {
      const value = structuredClone(canonical);
      testCase.mutate(value);
      const result = parseDocumentValue(value);
      expect(result.ok, testCase.label).toBe(false);
      expect(result.diagnostics, testCase.label).toContainEqual(
        expect.objectContaining({ code: testCase.code, path: testCase.path }),
      );
    }

    const semanticallyClosed = structuredClone(canonical);
    semanticallyClosed.nodes.spine.closed = true;
    expect(validateDocument(semanticallyClosed).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FEATURE_INVALID",
        node: "spine",
        path: "/nodes/spine/closed",
      }),
    );

    for (const [kind, node] of [
      ["path", "spine"],
      ["profile", "profile"],
    ] as const) {
      const constructionOutput = structuredClone(canonical);
      constructionOutput.outputs.body = { kind, node };
      expect(parseDocumentValue(constructionOutput).ok, kind).toBe(false);
      expect(
        validateDocument(constructionOutput).diagnostics,
        kind,
      ).toContainEqual(
        expect.objectContaining({
          code: "REFERENCE_KIND_MISMATCH",
          path: "/outputs/body",
        }),
      );
    }
  });

  it("rejects invalid builder inputs, foreign references, and unsupported modes", () => {
    const cad = design("builder-sweep-validation");
    const profile = cad.sketch("profile", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(2), height: mm(2) }),
      ),
    );
    const path = cad.polylinePath(
      "path",
      expressionPoints([
        [0, 0, 0],
        [0, 0, 5],
      ]),
    );

    expect(() => cad.polylinePath("short", [vec3(mm(0), mm(0), mm(0))])).toThrow(
      "at least two",
    );
    for (const tolerance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        cad.polylinePath(
          `bad-tolerance-${String(tolerance)}`,
          expressionPoints([
            [0, 0, 0],
            [0, 0, 1],
          ]),
          { tolerance },
        ),
      ).toThrow("finite and positive");
    }
    expect(() =>
      cad.sweep("round", profile, path, { transition: "round-corner" } as any),
    ).toThrow("right-corner");
    expect(() =>
      cad.sweep("frenet", profile, path, { frame: "frenet" } as any),
    ).toThrow("corrected-Frenet");

    const other = design("foreign-sweep-references");
    const foreignProfile = other.sketch("profile", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(2), height: mm(2) }),
      ),
    );
    const foreignPath = other.polylinePath(
      "path",
      expressionPoints([
        [0, 0, 0],
        [0, 0, 5],
      ]),
    );
    expect(() => cad.sweep("foreign-profile", foreignProfile, path)).toThrow(
      "design boundaries",
    );
    expect(() => cad.sweep("foreign-path", profile, foreignPath)).toThrow(
      "design boundaries",
    );

    if (false) {
      // @ts-expect-error Document v1 supports right-corner transitions only.
      cad.sweep("compile-transition", profile, path, { transition: "round-corner" });
      // @ts-expect-error Document v1 supports corrected-Frenet transport only.
      cad.sweep("compile-frame", profile, path, { frame: "frenet" });
      // @ts-expect-error Paths are construction geometry, not final outputs.
      cad.output("path", path);
    }
  });
});

describe("polyline path admission", () => {
  it("reports every bounded path validation reason", () => {
    const tolerance = SWEEP_TOLERANCE;
    const cases: readonly {
      readonly reason:
        | "invalid-tolerance"
        | "point-count"
        | "non-finite-point"
        | "degenerate-segment"
        | "duplicate-point"
        | "closed-path"
        | "collinear-segments"
        | "self-intersection";
      readonly path: ResolvedPolylinePath;
      readonly tolerance?: number;
    }[] = [
      {
        reason: "invalid-tolerance",
        path: resolvedPath([
          [0, 0, 0],
          [0, 0, 1],
        ]),
        tolerance: 0,
      },
      {
        reason: "point-count",
        path: resolvedPath([[0, 0, 0]]),
      },
      {
        reason: "closed-path",
        path: {
          kind: "polyline",
          points: [
            [0, 0, 0],
            [0, 0, 1],
          ],
          closed: true,
        } as unknown as ResolvedPolylinePath,
      },
      {
        reason: "non-finite-point",
        path: resolvedPath([
          [0, 0, 0],
          [0, Number.POSITIVE_INFINITY, 1],
        ]),
      },
      {
        reason: "degenerate-segment",
        path: resolvedPath([
          [0, 0, 0],
          [0, 0, tolerance / 2],
        ]),
      },
      {
        reason: "duplicate-point",
        path: resolvedPath([
          [0, 0, 0],
          [0, 0, 2],
          [1, 0, 2],
          [0, 0, 2],
        ]),
      },
      {
        reason: "closed-path",
        path: resolvedPath([
          [0, 0, 0],
          [0, 0, 2],
          [1, 0, 2],
          [0, 0, 0],
        ]),
      },
      {
        reason: "collinear-segments",
        path: resolvedPath([
          [0, 0, 0],
          [0, 0, 2],
          [0, 0, 4],
        ]),
      },
      {
        reason: "self-intersection",
        path: resolvedPath([
          [0, 0, 0],
          [0, 0, 4],
          [2, 0, 2],
          [-1, 0, 2],
        ]),
      },
    ];

    for (const testCase of cases) {
      expect(
        validateResolvedPolylinePath(
          testCase.path,
          testCase.tolerance ?? tolerance,
        ),
        testCase.reason,
      ).toEqual(expect.objectContaining({ reason: testCase.reason }));
    }
    expect(
      validateResolvedPolylinePath(
        resolvedPath([
          [0, 0, 0],
          [0, 0, 10],
          [10, 0, 10],
        ]),
        tolerance,
      ),
    ).toBeUndefined();
  });

  it("maps evaluator-reachable path failures to the path node before sweep", async () => {
    const cases: readonly {
      readonly reason:
        | "degenerate-segment"
        | "duplicate-point"
        | "closed-path"
        | "collinear-segments"
        | "self-intersection";
      readonly points: readonly Vec3Expression[];
      readonly path: string;
    }[] = [
      {
        reason: "degenerate-segment",
        points: expressionPoints([
          [0, 0, 0],
          [0, 0, SWEEP_TOLERANCE / 2],
        ]),
        path: "/nodes/spine/points/1",
      },
      {
        reason: "duplicate-point",
        points: expressionPoints([
          [0, 0, 0],
          [0, 0, 2],
          [1, 0, 2],
          [0, 0, 2],
        ]),
        path: "/nodes/spine/points/3",
      },
      {
        reason: "closed-path",
        points: expressionPoints([
          [0, 0, 0],
          [0, 0, 2],
          [1, 0, 2],
          [0, 0, 0],
        ]),
        path: "/nodes/spine/points/3",
      },
      {
        reason: "collinear-segments",
        points: expressionPoints([
          [0, 0, 0],
          [0, 0, 2],
          [0, 0, 4],
        ]),
        path: "/nodes/spine/points/1",
      },
      {
        reason: "self-intersection",
        points: expressionPoints([
          [0, 0, 0],
          [0, 0, 4],
          [2, 0, 2],
          [-1, 0, 2],
        ]),
        path: "/nodes/spine/points",
      },
    ];

    for (const testCase of cases) {
      const harness = recordingSweepKernel();
      const solver = new FixtureSketchSolver({ profile: rectangleProfile() });
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: solver,
      });
      try {
        const result = await evaluator.evaluate(
          fixtureSweepDocument(testCase.points),
        );
        expect(result.ok, testCase.reason).toBe(false);
        expect(result.diagnostics, testCase.reason).toContainEqual(
          expect.objectContaining({
            code: "FEATURE_INVALID",
            node: "spine",
            path: testCase.path,
            details: expect.objectContaining({ reason: testCase.reason }),
          }),
        );
        expect(harness.invocations, testCase.reason).toEqual([]);
      } finally {
        evaluator.dispose();
      }
    }
  });

  it("reports expression failures before resolved non-finite path validation", async () => {
    const harness = recordingSweepKernel();
    const solver = new FixtureSketchSolver({ profile: rectangleProfile() });
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: solver,
    });
    try {
      const result = await evaluator.evaluate(
        fixtureSweepDocument([
          vec3(mm(0), mm(0), mm(0)),
          vec3(mm(0), mm(0), mm(1).div(0)),
        ]),
      );
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "spine",
          path: "/nodes/spine",
          message: "Division by zero in CAD expression",
        }),
      );
      expect(harness.invocations).toEqual([]);
    } finally {
      evaluator.dispose();
    }
  });
});

describe("bounded solid sweep admission", () => {
  it("reports every sweep-specific reason, including conservative clearance", () => {
    const validPath = resolvedPath([
      [0, 0, 0],
      [0, 0, 10],
      [10, 0, 10],
    ]);
    const openProfile: ResolvedProfile = {
      ...rectangleProfile(),
      outer: {
        curves: [{ kind: "line", start: [0, 0], end: [1, 0] }],
      },
    };
    const collinearProfile: ResolvedProfile = {
      ...rectangleProfile(),
      outer: {
        curves: [
          { kind: "line", start: [0, 0], end: [1, 0] },
          { kind: "line", start: [1, 0], end: [2, 0] },
          { kind: "line", start: [2, 0], end: [0, 0] },
        ],
      },
    };
    const closePath = resolvedPath([
      [0, 0, 0],
      [0, 0, 10],
      [3, 0, 10],
      [3, 0, 1],
    ]);
    expect(
      validateResolvedPolylinePath(closePath, SWEEP_TOLERANCE),
    ).toBeUndefined();

    const cases: readonly {
      readonly reason:
        | "holes-unsupported"
        | "non-finite-profile"
        | "open-profile"
        | "degenerate-profile"
        | "profile-origin-mismatch"
        | "profile-tangent-mismatch"
        | "path-clearance";
      readonly profile: ResolvedProfile;
      readonly path: ResolvedPolylinePath;
    }[] = [
      {
        reason: "holes-unsupported",
        profile: rectangleProfile({ holes: [rectangleLoop(0.25, 0.25)] }),
        path: validPath,
      },
      {
        reason: "non-finite-profile",
        profile: rectangleProfile({
          origin: [Number.POSITIVE_INFINITY, 0, 0],
        }),
        path: validPath,
      },
      { reason: "open-profile", profile: openProfile, path: validPath },
      {
        reason: "degenerate-profile",
        profile: collinearProfile,
        path: validPath,
      },
      {
        reason: "profile-origin-mismatch",
        profile: rectangleProfile({ origin: [1, 0, 0] }),
        path: validPath,
      },
      {
        reason: "profile-tangent-mismatch",
        profile: rectangleProfile(),
        path: resolvedPath([
          [0, 0, 0],
          [5, 0, 0],
        ]),
      },
      {
        reason: "path-clearance",
        profile: rectangleProfile({ halfWidth: 2, halfHeight: 2 }),
        path: closePath,
      },
    ];

    for (const testCase of cases) {
      expect(
        validateResolvedSweep(
          testCase.profile,
          testCase.path,
          SWEEP_TOLERANCE,
        ),
        testCase.reason,
      ).toEqual(expect.objectContaining({ reason: testCase.reason }));
    }
  });

  it("accepts either sign of every principal-plane normal", () => {
    const cases: readonly {
      readonly plane: PrincipalPlane;
      readonly end: Vec3;
    }[] = [
      { plane: "XY", end: [0, 0, 10] },
      { plane: "XY", end: [0, 0, -10] },
      { plane: "XZ", end: [0, 10, 0] },
      { plane: "XZ", end: [0, -10, 0] },
      { plane: "YZ", end: [10, 0, 0] },
      { plane: "YZ", end: [-10, 0, 0] },
    ];
    for (const testCase of cases) {
      expect(
        validateResolvedSweep(
          rectangleProfile({ plane: testCase.plane }),
          resolvedPath([[0, 0, 0], testCase.end]),
          SWEEP_TOLERANCE,
        ),
        `${testCase.plane} ${testCase.end.join(",")}`,
      ).toBeUndefined();
    }
  });

  it("maps evaluator-reachable sweep reasons before kernel invocation", async () => {
    const normalPath = expressionPoints([
      [0, 0, 0],
      [0, 0, 10],
      [10, 0, 10],
    ]);
    const collinearProfile: ResolvedProfile = {
      ...rectangleProfile(),
      outer: {
        curves: [
          { kind: "line", start: [0, 0], end: [1, 0] },
          { kind: "line", start: [1, 0], end: [2, 0] },
          { kind: "line", start: [2, 0], end: [0, 0] },
        ],
      },
    };
    const cases: readonly {
      readonly reason:
        | "holes-unsupported"
        | "non-finite-profile"
        | "degenerate-profile"
        | "profile-origin-mismatch"
        | "profile-tangent-mismatch"
        | "path-clearance";
      readonly profile: ResolvedProfile;
      readonly points: readonly Vec3Expression[];
      readonly input: "profile" | "path";
    }[] = [
      {
        reason: "holes-unsupported",
        profile: rectangleProfile({ holes: [rectangleLoop(0.25, 0.25)] }),
        points: normalPath,
        input: "profile",
      },
      {
        reason: "non-finite-profile",
        profile: rectangleProfile({
          origin: [Number.POSITIVE_INFINITY, 0, 0],
        }),
        points: normalPath,
        input: "profile",
      },
      {
        reason: "degenerate-profile",
        profile: collinearProfile,
        points: normalPath,
        input: "profile",
      },
      {
        reason: "profile-origin-mismatch",
        profile: rectangleProfile({ origin: [1, 0, 0] }),
        points: normalPath,
        input: "profile",
      },
      {
        reason: "profile-tangent-mismatch",
        profile: rectangleProfile(),
        points: expressionPoints([
          [0, 0, 0],
          [5, 0, 0],
        ]),
        input: "profile",
      },
      {
        reason: "path-clearance",
        profile: rectangleProfile({ halfWidth: 2, halfHeight: 2 }),
        points: expressionPoints([
          [0, 0, 0],
          [0, 0, 10],
          [3, 0, 10],
          [3, 0, 1],
        ]),
        input: "path",
      },
    ];

    for (const testCase of cases) {
      const harness = recordingSweepKernel();
      const solver = new FixtureSketchSolver({ profile: testCase.profile });
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: solver,
      });
      try {
        const result = await evaluator.evaluate(
          fixtureSweepDocument(testCase.points),
        );
        expect(result.ok, testCase.reason).toBe(false);
        expect(result.diagnostics, testCase.reason).toContainEqual(
          expect.objectContaining({
            code: "FEATURE_INVALID",
            node: "body",
            path: `/nodes/body/${testCase.input}`,
            details: expect.objectContaining({
              reason: testCase.reason,
              input: testCase.input,
            }),
          }),
        );
        expect(harness.invocations, testCase.reason).toEqual([]);
      } finally {
        evaluator.dispose();
      }
    }
  });

  it("lets sketch closure diagnostics precede the sweep open-profile guard", async () => {
    const openProfile: ResolvedProfile = {
      ...rectangleProfile(),
      outer: {
        curves: [{ kind: "line", start: [0, 0], end: [1, 0] }],
      },
    };
    const harness = recordingSweepKernel();
    const solver = new FixtureSketchSolver({ profile: openProfile });
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: solver,
    });
    try {
      const result = await evaluator.evaluate(
        fixtureSweepDocument(
          expressionPoints([
            [0, 0, 0],
            [0, 0, 10],
          ]),
        ),
      );
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "SKETCH_NO_CLOSED_REGION",
          node: "profile",
          path: "/nodes/profile/profile",
        }),
      );
      expect(harness.invocations).toEqual([]);
    } finally {
      evaluator.dispose();
    }
  });
});

describe("solid sweep evaluator protocol", () => {
  it("checks capability and declared implementation before dependencies", async () => {
    const invalidPathDocument = fixtureSweepDocument([
      vec3(mm(0), mm(0), mm(0)),
      vec3(mm(0), mm(0), mm(1).div(0)),
    ]);
    for (const testCase of [
      {
        declaresSweep: false,
        implementsSweep: false,
        code: "KERNEL_CAPABILITY_MISSING",
      },
      {
        declaresSweep: true,
        implementsSweep: false,
        code: "KERNEL_ERROR",
      },
    ] as const) {
      const harness = recordingSweepKernel(testCase);
      const solver = new FixtureSketchSolver({ profile: rectangleProfile() });
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: solver,
      });
      try {
        const result = await evaluator.evaluate(invalidPathDocument);
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: testCase.code,
            node: "body",
            path: "/nodes/body",
            details: expect.objectContaining({
              kernel: "recording-sweep-kernel",
              kind: "feature",
              capability: "sweep",
              ...(testCase.declaresSweep ? { protocolViolation: true } : {}),
            }),
          }),
        );
        expect(solver.calls).toEqual([]);
        expect(harness.invocations).toEqual([]);
      } finally {
        evaluator.dispose();
      }
    }
  });

  it("transfers ordered numeric path data, fixed semantics, and context unchanged", async () => {
    const cad = design("numeric-sweep-transfer");
    const depth = cad.parameter.length("depth", mm(10));
    const run = cad.parameter.length("run", mm(5));
    const profile = cad.sketch(
      "profile",
      plane.xy(),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("section", { width: mm(2), height: mm(2) }),
        ),
      { tolerance: 4e-7 },
    );
    const spine = cad.polylinePath(
      "spine",
      [
        vec3(mm(0), mm(0), mm(0)),
        vec3(mm(0), mm(0), depth.neg()),
        vec3(run, mm(0), depth.neg()),
      ],
      { tolerance: 8e-7 },
    );
    cad.output("body", cad.sweep("body", profile, spine));

    const solvedProfile = rectangleProfile();
    const harness = recordingSweepKernel();
    const solver = new FixtureSketchSolver({ profile: solvedProfile });
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: solver,
    });
    try {
      const result = await evaluator.evaluate(cad.build(), {
        parameters: { depth: 12, run: 7 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        expect(solver.calls).toEqual(["profile"]);
        expect(harness.invocations).toHaveLength(1);
        expect(harness.invocations[0]).toEqual({
          profile: solvedProfile,
          path: {
            kind: "polyline",
            points: [
              [0, 0, 0],
              [0, 0, -12],
              [7, 0, -12],
            ],
            closed: false,
          },
          options: {
            transition: "right-corner",
            frame: "corrected-frenet",
          },
          context: { feature: "body", tolerance: 8e-7 },
        });
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });
});
