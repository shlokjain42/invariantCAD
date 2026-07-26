import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_DOCUMENT_LIMITS,
  curveEnd,
  curveStart,
  createEvaluator,
  createManifoldKernel,
  design,
  mm,
  plane,
  vec2,
  type DesignDocument,
  type Diagnostic,
  type GeometryKernel,
  type KernelShape,
  type ProfileCurveSource,
  type ResolvedCurve,
  type ResolvedLoop,
  type ResolvedProfile,
  type SketchNodeIR,
  type SketchSolveContext,
  type SketchSolverBackend,
  type SketchSolverCapabilities,
  type SolvedSketch,
} from "../src/index.js";
import { validateResolvedProfileRegion } from "../src/internal/resolved-profile-region.js";
import { createOcctKernel } from "../src/occt-kernel.js";

const PROFILE_TOLERANCE = 1e-7;
const PROFILE_WORK_LIMIT =
  DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues;

function source(entity: string): ProfileCurveSource {
  return {
    kind: "sketch-entity",
    sketch: "profile",
    entity: entity as ProfileCurveSource["entity"],
  };
}

function throwingProfileCurveSource(): ProfileCurveSource {
  return Object.defineProperties(
    {},
    {
      kind: { value: "sketch-entity", enumerable: true },
      sketch: {
        enumerable: true,
        get() {
          throw new Error("source getter trap");
        },
      },
      entity: { value: "hole", enumerable: true },
    },
  ) as ProfileCurveSource;
}

function revokedProfileCurveSource(): ProfileCurveSource {
  const revocable = Proxy.revocable(
    {
      kind: "sketch-entity" as const,
      sketch: "profile",
      entity: "hole",
    },
    {},
  );
  revocable.revoke();
  return revocable.proxy as ProfileCurveSource;
}

function circleLoop(
  center: readonly [number, number],
  radius: number,
  entity: string,
  reversed = false,
): ResolvedLoop {
  return {
    curves: [
      {
        kind: "circle",
        center,
        radius,
        reversed,
        source: source(entity),
      },
    ],
  };
}

function rectangleLoop(
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  prefix: string,
): ResolvedLoop {
  const points = [
    [xMin, yMin],
    [xMax, yMin],
    [xMax, yMax],
    [xMin, yMax],
  ] as const;
  return {
    curves: points.map((start, index) => ({
      kind: "line" as const,
      start,
      end: points[(index + 1) % points.length]!,
      source: source(`${prefix}-${index}`),
    })),
  };
}

function toleranceClosedRectangleLoop(): ResolvedLoop {
  const gap = PROFILE_TOLERANCE / 2;
  return {
    curves: [
      {
        kind: "line",
        start: [-10, -5],
        end: [10, -5],
        source: source("tolerant-bottom"),
      },
      {
        kind: "line",
        start: [10 + gap, -5],
        end: [10, 5],
        source: source("tolerant-right"),
      },
      {
        kind: "line",
        start: [10, 5],
        end: [-10, 5],
        source: source("tolerant-top"),
      },
      {
        kind: "line",
        start: [-10, 5],
        end: [-10, -5],
        source: source("tolerant-left"),
      },
    ],
  };
}

function reverseCurve(curve: ResolvedCurve): ResolvedCurve {
  switch (curve.kind) {
    case "line":
      return { ...curve, start: curve.end, end: curve.start };
    case "arc":
      return {
        ...curve,
        startAngle: curve.endAngle,
        endAngle: curve.startAngle,
        clockwise: !curve.clockwise,
      };
    case "circle":
      return { ...curve, reversed: !curve.reversed };
  }
}

function reverseLoop(loop: ResolvedLoop): ResolvedLoop {
  return {
    curves: [...loop.curves].reverse().map(reverseCurve),
  };
}

function profile(
  holes: readonly ResolvedLoop[],
  outer: ResolvedLoop = rectangleLoop(-10, -5, 10, 5, "outer"),
): ResolvedProfile {
  return {
    plane: { plane: "XY", origin: [0, 0, 0] },
    outer,
    holes,
  };
}

function fixtureExtrudeDocument(
  options: {
    readonly withHole?: boolean;
    readonly withSecondHole?: boolean;
  } = {},
): DesignDocument {
  const cad = design("profile-containment-fixture");
  const sketch = cad.sketch(
    "profile",
    plane.xy(),
    (builder) => {
      const outer = builder.rectangle("placeholder", {
        width: mm(20),
        height: mm(10),
      });
      const hole = options.withHole
        ? builder.circle("hole", { radius: mm(1) })
        : undefined;
      const secondHole = options.withSecondHole
        ? builder.circle("hole-b", {
            center: vec2(mm(3), mm(0)),
            radius: mm(1),
          })
        : undefined;
      return builder.profile(outer, {
        ...(hole === undefined && secondHole === undefined
          ? {}
          : {
              holes: [
                ...(hole === undefined ? [] : [hole.loop()]),
                ...(secondHole === undefined
                  ? []
                  : [secondHole.loop()]),
              ],
            }),
      });
    },
    { tolerance: PROFILE_TOLERANCE },
  );
  cad.output("solid", cad.extrude("solid", sketch, { distance: mm(2) }));
  return cad.build();
}

class FixtureSketchSolver implements SketchSolverBackend {
  readonly id = "fixture-profile-containment-solver";
  readonly capabilities: SketchSolverCapabilities = {
    entities: ["point", "line", "circle", "arc"],
    constraints: [],
    reportsDegreesOfFreedom: true,
    reportsConflicts: false,
  };
  solveCalls = 0;

  constructor(
    private readonly resolvedProfile: ResolvedProfile,
    private readonly onSolve?: (context: SketchSolveContext) => void,
  ) {}

  solve(_sketch: SketchNodeIR, context: SketchSolveContext): SolvedSketch {
    this.solveCalls += 1;
    this.onSolve?.(context);
    return {
      status: "solved",
      points: {},
      radii: {},
      profile: this.resolvedProfile,
      degreesOfFreedom: 0,
      iterations: 0,
      residual: 0,
      diagnostics: [],
    };
  }

  dispose(): void {}
}

interface RecordingKernelCounters {
  extrude: number;
  status: number;
  measure: number;
  createdShapes: number;
  disposeShape: number;
}

function recordingExtrudeKernel(): {
  readonly kernel: GeometryKernel;
  readonly counters: RecordingKernelCounters;
} {
  const id = "recording-profile-containment-kernel";
  const counters: RecordingKernelCounters = {
    extrude: 0,
    status: 0,
    measure: 0,
    createdShapes: 0,
    disposeShape: 0,
  };
  let serial = 0;
  const kernel: GeometryKernel = {
    id,
    capabilities: {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: ["extrude"],
      nativeImports: [],
      nativeExports: [],
    },
    extrude: () => {
      counters.extrude += 1;
      counters.createdShapes += 1;
      return { kernel: id, serial: serial++ } as KernelShape;
    },
    mesh: () => ({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    }),
    status: () => {
      counters.status += 1;
      return { ok: true, code: "OK" };
    },
    measure: () => {
      counters.measure += 1;
      return {
        volume: 1,
        surfaceArea: 1,
        centerOfMass: [0, 0, 0],
        inertiaTensor: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
        genus: 0,
        tolerance: PROFILE_TOLERANCE,
      };
    },
    disposeShape: () => {
      counters.disposeShape += 1;
    },
    dispose: () => {},
  };
  return { kernel, counters };
}

function diagnosticWithCode(
  result: { readonly diagnostics: readonly Diagnostic[] },
  code: Diagnostic["code"],
): Diagnostic {
  const found = result.diagnostics.find(
    (item) => item.code === code && item.severity === "error",
  );
  expect(found, `missing ${code} diagnostic`).toBeDefined();
  return found!;
}

function expectNoKernelWork(counters: RecordingKernelCounters): void {
  expect(counters).toEqual({
    extrude: 0,
    status: 0,
    measure: 0,
    createdShapes: 0,
    disposeShape: 0,
  });
}

async function expectContainmentRejection(
  resolvedProfile: ResolvedProfile,
  expected: {
    readonly reason:
      | "hole-outer-boundary-contact"
      | "hole-outside-outer"
      | "hole-hole-boundary-contact"
      | "hole-nesting";
    readonly holeIndex: number;
    readonly otherHoleIndex?: number;
    readonly nestedHoleIndex?: number;
  },
): Promise<void> {
  const harness = recordingExtrudeKernel();
  const solver = new FixtureSketchSolver(resolvedProfile);
  const evaluator = await createEvaluator({
    kernel: harness.kernel,
    sketchSolver: solver,
  });
  try {
    const result = await evaluator.evaluate(fixtureExtrudeDocument());
    expect(result.ok).toBe(false);
    const item = diagnosticWithCode(result, "SKETCH_NO_CLOSED_REGION");
    expect(item).toEqual(
      expect.objectContaining({
        node: "profile",
        path: "/nodes/profile/profile",
        details: expect.objectContaining({
          reason: expected.reason,
          holeIndex: expected.holeIndex,
          ...(expected.otherHoleIndex === undefined
            ? {}
            : { otherHoleIndex: expected.otherHoleIndex }),
          ...(expected.nestedHoleIndex === undefined
            ? {}
            : { nestedHoleIndex: expected.nestedHoleIndex }),
        }),
      }),
    );
    expect(item.details).not.toHaveProperty("curveSource");
    expect(item.details).not.toHaveProperty("otherCurveSource");
    expect(item.details).not.toHaveProperty("holeEntities");
    expect(item.details).not.toHaveProperty("outerEntities");
    expect(item.details).not.toHaveProperty("workUnits");
    expect(item.details).not.toHaveProperty("maxWorkUnits");
    expect(solver.solveCalls).toBe(1);
    expectNoKernelWork(harness.counters);
  } finally {
    evaluator.dispose();
  }
}

function cleanRoomDocument(): DesignDocument {
  const cad = design("clean-room-five-hole-plate");
  const plateWidth = cad.parameter.length("plateWidth", mm(140), {
    min: mm(50),
    max: mm(200),
  });
  const mountingPitchX = cad.parameter.length("mountingPitchX", mm(100), {
    min: mm(0),
    max: mm(150),
  });
  const mountingHoleDiameter = cad.parameter.length(
    "mountingHoleDiameter",
    mm(12),
    { min: mm(1), max: mm(20) },
  );
  const profileRef = cad.sketch(
    "profile",
    plane.xy(),
    (sketch) => {
      const outer = sketch.rectangle("outer", {
        width: plateWidth,
        height: mm(70),
      });
      const halfPitch = mountingPitchX.mul(0.5);
      const radius = mountingHoleDiameter.mul(0.5);
      const holes = [
        sketch.circle("mounting-hole-lower-left", {
          center: vec2(halfPitch.mul(-1), mm(-20)),
          radius,
        }),
        sketch.circle("mounting-hole-upper-left", {
          center: vec2(halfPitch.mul(-1), mm(20)),
          radius,
        }),
        sketch.circle("mounting-hole-lower-right", {
          center: vec2(halfPitch, mm(-20)),
          radius,
        }),
        sketch.circle("mounting-hole-upper-right", {
          center: vec2(halfPitch, mm(20)),
          radius,
        }),
        sketch.circle("shaft-bore", {
          radius: mm(8),
        }),
      ];
      return sketch.profile(outer, {
        holes: holes.map((hole) => hole.loop()),
      });
    },
    { tolerance: PROFILE_TOLERANCE },
  );
  cad.output(
    "plate",
    cad.extrude("plate", profileRef, { distance: mm(6), symmetric: true }),
  );
  cad.configuration("invalid-spacing", (configuration) => {
    configuration.parameter(plateWidth, mm(70));
    configuration.parameter(mountingPitchX, mm(130));
    configuration.parameter(mountingHoleDiameter, mm(12));
  });
  return cad.build();
}

describe("resolved sketch profile containment", () => {
  it("rejects the exact 70/130/12 five-hole plate case with bounded entity provenance", async () => {
    const harness = recordingExtrudeKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(cleanRoomDocument(), {
        parameters: {
          plateWidth: 70,
          mountingPitchX: 130,
          mountingHoleDiameter: 12,
        },
      });
      expect(result.ok).toBe(false);
      const item = diagnosticWithCode(result, "SKETCH_NO_CLOSED_REGION");
      expect(item).toEqual(
        expect.objectContaining({
          node: "profile",
          path:
            "/nodes/profile/entities/mounting-hole-lower-left",
          details: expect.objectContaining({
            reason: "hole-outside-outer",
            holeIndex: 0,
            curveSource: {
              kind: "sketch-entity",
              sketch: "profile",
              entity: "mounting-hole-lower-left",
            },
          }),
        }),
      );
      expect(item.details).not.toHaveProperty("holeEntities");
      expect(item.details).not.toHaveProperty("outerEntities");
      expectNoKernelWork(harness.counters);
    } finally {
      evaluator.dispose();
    }
  });

  it.each([
    {
      name: "disjoint outside hole",
      hole: circleLoop([12, 0], 1, "outside-hole"),
      reason: "hole-outside-outer" as const,
    },
    {
      name: "outer-boundary tangency",
      hole: circleLoop([9, 0], 1, "tangent-hole"),
      reason: "hole-outer-boundary-contact" as const,
    },
    {
      name: "outer-boundary crossing",
      hole: circleLoop([9.5, 0], 1, "crossing-hole"),
      reason: "hole-outer-boundary-contact" as const,
    },
    {
      name: "hole enclosing the outer loop",
      hole: circleLoop([0, 0], 20, "enclosing-hole"),
      reason: "hole-outside-outer" as const,
    },
    {
      name: "hole coincident with the outer loop",
      hole: rectangleLoop(-10, -5, 10, 5, "coincident-hole"),
      reason: "hole-outer-boundary-contact" as const,
    },
  ])("rejects $name", async ({ hole, reason }) => {
    await expectContainmentRejection(profile([hole]), {
      reason,
      holeIndex: 0,
    });
  });

  it.each([
    {
      name: "overlapping holes",
      first: circleLoop([-0.5, 0], 1, "overlap-a"),
      second: circleLoop([0.5, 0], 1, "overlap-b"),
      reason: "hole-hole-boundary-contact" as const,
    },
    {
      name: "tangent holes",
      first: circleLoop([-1, 0], 1, "tangent-a"),
      second: circleLoop([1, 0], 1, "tangent-b"),
      reason: "hole-hole-boundary-contact" as const,
    },
    {
      name: "coincident holes",
      first: circleLoop([0, 0], 1, "coincident-a"),
      second: circleLoop([0, 0], 1, "coincident-b"),
      reason: "hole-hole-boundary-contact" as const,
    },
    {
      name: "later hole nested inside an earlier hole",
      first: circleLoop([0, 0], 2, "nesting-outer"),
      second: circleLoop([0, 0], 1, "nesting-inner"),
      reason: "hole-nesting" as const,
      nestedHoleIndex: 1,
    },
    {
      name: "later hole enclosing an earlier hole",
      first: circleLoop([0, 0], 1, "enclosed-earlier"),
      second: circleLoop([0, 0], 2, "enclosing-later"),
      reason: "hole-nesting" as const,
      nestedHoleIndex: 0,
    },
  ])("rejects $name and blames the later loop", async ({
    first,
    second,
    reason,
    nestedHoleIndex,
  }) => {
    await expectContainmentRejection(profile([first, second]), {
      reason,
      holeIndex: 1,
      otherHoleIndex: 0,
      ...(nestedHoleIndex === undefined ? {} : { nestedHoleIndex }),
    });
  });

  it.each([
    {
      name: "multiple separated holes",
      value: profile([
        circleLoop([-4, 0], 1, "valid-left"),
        circleLoop([0, 0], 1, "valid-center"),
        circleLoop([4, 0], 1, "valid-right"),
      ]),
    },
    {
      name: "gap just greater than tolerance",
      value: profile([
        circleLoop(
          [9 - PROFILE_TOLERANCE * 2, 0],
          1,
          "near-boundary",
        ),
      ]),
    },
    {
      name: "reversed outer and hole orientations",
      value: profile(
        [
          reverseLoop(circleLoop([-3, 0], 1, "reversed-left")),
          reverseLoop(circleLoop([3, 0], 1, "reversed-right")),
        ],
        reverseLoop(rectangleLoop(-10, -5, 10, 5, "reversed-outer")),
      ),
    },
    {
      name: "tolerance-close authored endpoints",
      value: profile(
        [circleLoop([0, 0], 1, "tolerant-hole")],
        toleranceClosedRectangleLoop(),
      ),
    },
    {
      name: "mixed line and arc outer with a polyline hole",
      value: profile(
        [rectangleLoop(-1, 1, 1, 2, "polyline-hole")],
        {
          curves: [
            {
              kind: "line",
              start: [-5, 0],
              end: [5, 0],
              source: source("diameter-line"),
            },
            {
              kind: "arc",
              center: [0, 0],
              radius: 5,
              startAngle: 0,
              endAngle: Math.PI,
              clockwise: false,
              source: source("semicircle-arc"),
            },
          ],
        },
      ),
    },
  ])("admits $name", async ({ value }) => {
    const harness = recordingExtrudeKernel();
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: new FixtureSketchSolver(value),
    });
    try {
      const result = await evaluator.evaluate(fixtureExtrudeDocument());
      expect(result.ok).toBe(true);
      expect(harness.counters).toEqual({
        extrude: 1,
        status: 1,
        measure: 1,
        createdShapes: 1,
        disposeShape: 0,
      });
      if (!result.ok) return;
      result.value.dispose();
      expect(harness.counters.disposeShape).toBe(1);
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects a nonadjacent hole self-intersection before kernel work", async () => {
    const selfCrossingHole: ResolvedLoop = {
      curves: [
        {
          kind: "line",
          start: [0, 0],
          end: [4, 4],
          source: source("cross-a"),
        },
        {
          kind: "line",
          start: [4, 4],
          end: [0, 4],
          source: source("cross-b"),
        },
        {
          kind: "line",
          start: [0, 4],
          end: [3, 0],
          source: source("cross-c"),
        },
        {
          kind: "line",
          start: [3, 0],
          end: [0, 0],
          source: source("cross-d"),
        },
      ],
    };
    const harness = recordingExtrudeKernel();
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: new FixtureSketchSolver(
        profile([selfCrossingHole]),
      ),
    });
    try {
      const result = await evaluator.evaluate(fixtureExtrudeDocument());
      expect(result.ok).toBe(false);
      expect(
        diagnosticWithCode(result, "SKETCH_NO_CLOSED_REGION"),
      ).toEqual(
        expect.objectContaining({
          node: "profile",
          path: "/nodes/profile/profile",
          details: expect.objectContaining({
            reason: "loop-self-contact",
            holeIndex: 0,
            curveIndex: 0,
            otherCurveIndex: 2,
          }),
        }),
      );
      expectNoKernelWork(harness.counters);
    } finally {
      evaluator.dispose();
    }
  });

  it.each([
    {
      name: "line and major arc",
      hole: {
        curves: [
          {
            kind: "line" as const,
            start: [-2, 0] as const,
            end: [2, 0] as const,
            source: source("adjacent-line"),
          },
          {
            kind: "arc" as const,
            center: [0, 0] as const,
            radius: 2,
            startAngle: 0,
            endAngle: (3 * Math.PI) / 2,
            clockwise: false,
            source: source("adjacent-major-arc"),
          },
          {
            kind: "line" as const,
            start: [0, -2] as const,
            end: [-2, 0] as const,
            source: source("adjacent-close"),
          },
        ],
      },
      curveEntity: "adjacent-line",
      otherCurveEntity: "adjacent-major-arc",
    },
    {
      name: "two adjacent major arcs",
      hole: {
        curves: [
          {
            kind: "arc" as const,
            center: [-0.5, 0] as const,
            radius: 1,
            startAngle: Math.PI,
            endAngle: Math.PI / 3,
            clockwise: false,
            source: source("adjacent-arc-a"),
          },
          {
            kind: "arc" as const,
            center: [0.5, 0] as const,
            radius: 1,
            startAngle: (2 * Math.PI) / 3,
            endAngle: 0,
            clockwise: false,
            source: source("adjacent-arc-b"),
          },
          {
            kind: "line" as const,
            start: [1.5, 0] as const,
            end: [0, 3] as const,
            source: source("adjacent-arc-close-a"),
          },
          {
            kind: "line" as const,
            start: [0, 3] as const,
            end: [-1.5, 0] as const,
            source: source("adjacent-arc-close-b"),
          },
        ],
      },
      curveEntity: "adjacent-arc-a",
      otherCurveEntity: "adjacent-arc-b",
    },
  ])(
    "rejects a remote self-intersection between adjacent $name domains",
    async ({ hole, curveEntity, otherCurveEntity }) => {
      const resolved = profile([hole]);
      expect(
        validateResolvedProfileRegion(
          resolved,
          PROFILE_TOLERANCE,
        ),
      ).toEqual(
        expect.objectContaining({
          reason: "loop-self-contact",
          loop: "hole",
          holeIndex: 0,
          curveIndex: 0,
          otherCurveIndex: 1,
          curveSource: expect.objectContaining({
            entity: curveEntity,
          }),
          otherCurveSource: expect.objectContaining({
            entity: otherCurveEntity,
          }),
        }),
      );

      const harness = recordingExtrudeKernel();
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: new FixtureSketchSolver(resolved),
      });
      try {
        const result = await evaluator.evaluate(
          fixtureExtrudeDocument(),
        );
        expect(result.ok).toBe(false);
        expect(
          diagnosticWithCode(result, "SKETCH_NO_CLOSED_REGION"),
        ).toEqual(
          expect.objectContaining({
            path: "/nodes/profile/profile",
            details: expect.objectContaining({
              reason: "loop-self-contact",
              curveIndex: 0,
              otherCurveIndex: 1,
            }),
          }),
        );
        expectNoKernelWork(harness.counters);
      } finally {
        evaluator.dispose();
      }
    },
  );

  it("admits two semicircular arcs sharing both intended junctions", () => {
    const twoArcOuter: ResolvedLoop = {
      curves: [
        {
          kind: "arc",
          center: [0, 0],
          radius: 5,
          startAngle: 0,
          endAngle: Math.PI,
          clockwise: false,
          source: source("upper-semicircle"),
        },
        {
          kind: "arc",
          center: [0, 0],
          radius: 5,
          startAngle: Math.PI,
          endAngle: 0,
          clockwise: false,
          source: source("lower-semicircle"),
        },
      ],
    };
    expect(
      validateResolvedProfileRegion(
        profile(
          [circleLoop([0, 0], 1, "two-arc-hole")],
          twoArcOuter,
        ),
        PROFILE_TOLERANCE,
      ),
    ).toBeUndefined();
  });

  it.each([
    {
      name: "collinear line backtracking",
      hole: {
        curves: [
          {
            kind: "line" as const,
            start: [0, 0] as const,
            end: [2, 0] as const,
            source: source("overlap-line-a"),
          },
          {
            kind: "line" as const,
            start: [2, 0] as const,
            end: [1, 0] as const,
            source: source("overlap-line-b"),
          },
          {
            kind: "line" as const,
            start: [1, 0] as const,
            end: [1, 1] as const,
            source: source("overlap-line-c"),
          },
          {
            kind: "line" as const,
            start: [1, 1] as const,
            end: [0, 1] as const,
            source: source("overlap-line-d"),
          },
          {
            kind: "line" as const,
            start: [0, 1] as const,
            end: [0, 0] as const,
            source: source("overlap-line-e"),
          },
        ],
      },
    },
    {
      name: "same-support arc overlap",
      hole: {
        curves: [
          {
            kind: "arc" as const,
            center: [0, 0] as const,
            radius: 2,
            startAngle: 0,
            endAngle: Math.PI,
            clockwise: false,
            source: source("overlap-arc-a"),
          },
          {
            kind: "arc" as const,
            center: [0, 0] as const,
            radius: 2,
            startAngle: Math.PI,
            endAngle: Math.PI / 2,
            clockwise: true,
            source: source("overlap-arc-b"),
          },
          {
            kind: "line" as const,
            start: [0, 2] as const,
            end: [0, 3] as const,
            source: source("overlap-arc-c"),
          },
          {
            kind: "line" as const,
            start: [0, 3] as const,
            end: [2, 0] as const,
            source: source("overlap-arc-d"),
          },
        ],
      },
    },
  ])("rejects adjacent $name beyond its intended junction", ({ hole }) => {
    expect(
      validateResolvedProfileRegion(
        profile([hole]),
        PROFILE_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "loop-self-contact",
        loop: "hole",
        curveIndex: 0,
        otherCurveIndex: 1,
      }),
    );
  });

  it("rejects a closure connector that crosses a remote boundary curve", () => {
    const connectorCrossing: ResolvedLoop = {
      curves: [
        {
          kind: "line",
          start: [-2, -2],
          end: [-PROFILE_TOLERANCE / 4, 0],
          source: source("connector-before"),
        },
        {
          kind: "line",
          start: [PROFILE_TOLERANCE / 4, 0],
          end: [2, -2],
          source: source("connector-after"),
        },
        {
          kind: "line",
          start: [2, -2],
          end: [2, 2],
          source: source("connector-side-a"),
        },
        {
          kind: "line",
          start: [2, 2],
          end: [0, 1],
          source: source("connector-top-a"),
        },
        {
          kind: "line",
          start: [0, 1],
          end: [0, -1],
          source: source("connector-remote"),
        },
        {
          kind: "line",
          start: [0, -1],
          end: [-2, 2],
          source: source("connector-top-b"),
        },
        {
          kind: "line",
          start: [-2, 2],
          end: [-2, -2],
          source: source("connector-side-b"),
        },
      ],
    };
    expect(
      validateResolvedProfileRegion(
        profile(
          [circleLoop([0, 1], 0.1, "connector-hole")],
          connectorCrossing,
        ),
        PROFILE_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "loop-self-contact",
        loop: "outer",
        curveIndex: 0,
        otherCurveIndex: 4,
      }),
    );
  });

  it("is translation-invariant for well-resolved circular regions", () => {
    for (const [center, tolerance] of [
      [[0, 0], PROFILE_TOLERANCE],
      [[1_000_000, 0], PROFILE_TOLERANCE],
      [[1_000_000_000_000, 1_000_000_000_000], 1e-3],
    ] as const) {
      expect(
        validateResolvedProfileRegion(
          {
            plane: { plane: "XY", origin: [0, 0, 0] },
            outer: circleLoop(center, 100, "translated-outer"),
            holes: [
              circleLoop(center, 1, "translated-hole"),
            ],
          },
          tolerance,
        ),
      ).toBeUndefined();
    }
  });

  it("classifies a decisive near-horizontal ray crossing without division", () => {
    const points = [
      [-10, -5],
      [5, -1e-9],
      [10, 1e-9],
      [10, 5],
      [-10, 5],
    ] as const;
    const outer: ResolvedLoop = {
      curves: points.map((start, index) => ({
        kind: "line",
        start,
        end: points[(index + 1) % points.length]!,
        source: source(`near-horizontal-${index}`),
      })),
    };
    expect(
      validateResolvedProfileRegion(
        profile(
          [circleLoop([0, 0], 0.5, "near-horizontal-hole")],
          outer,
        ),
        PROFILE_TOLERANCE,
      ),
    ).toBeUndefined();
  });

  it("counts an arc-arc local-minimum ray vertex with even parity", async () => {
    const firstArc: ResolvedCurve = {
      kind: "arc",
      center: [2, 0],
      radius: 1,
      startAngle: Math.PI / 2,
      endAngle: 0,
      clockwise: true,
      source: source("parity-arc-a"),
    };
    const secondArc: ResolvedCurve = {
      kind: "arc",
      center: [1, 0],
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI / 2,
      clockwise: false,
      source: source("parity-arc-b"),
    };
    const firstPoint = curveStart(firstArc);
    const secondPoint = curveEnd(secondArc);
    const outer: ResolvedLoop = {
      curves: [
        firstArc,
        secondArc,
        {
          kind: "line",
          start: secondPoint,
          end: [6, 3],
          source: source("parity-upper-right"),
        },
        {
          kind: "line",
          start: [6, 3],
          end: [6, -4],
          source: source("parity-right"),
        },
        {
          kind: "line",
          start: [6, -4],
          end: [-6, -4],
          source: source("parity-bottom"),
        },
        {
          kind: "line",
          start: [-6, -4],
          end: [-6, 4],
          source: source("parity-left"),
        },
        {
          kind: "line",
          start: [-6, 4],
          end: firstPoint,
          source: source("parity-upper-left"),
        },
      ],
    };
    expect(
      validateResolvedProfileRegion(
        profile(
          [circleLoop([0, 0], 0.5, "parity-inside")],
          outer,
        ),
        PROFILE_TOLERANCE,
      ),
    ).toBeUndefined();

    const outside = profile(
      [circleLoop([-8, 0], 0.5, "parity-outside")],
      outer,
    );
    expect(
      validateResolvedProfileRegion(
        outside,
        PROFILE_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "hole-outside-outer",
        holeIndex: 0,
      }),
    );

    const harness = recordingExtrudeKernel();
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: new FixtureSketchSolver(outside),
    });
    try {
      const result = await evaluator.evaluate(
        fixtureExtrudeDocument(),
      );
      expect(result.ok).toBe(false);
      expect(
        diagnosticWithCode(result, "SKETCH_NO_CLOSED_REGION"),
      ).toEqual(
        expect.objectContaining({
          details: expect.objectContaining({
            reason: "hole-outside-outer",
          }),
        }),
      );
      expectNoKernelWork(harness.counters);
    } finally {
      evaluator.dispose();
    }
  });

  it("accepts a represented connector gap strictly below tolerance", () => {
    const outer = rectangleLoop(-10, -5, 10, 5, "near-limit");
    const curves = [...outer.curves];
    const firstCurve = curves[0]!;
    if (firstCurve.kind !== "line") {
      throw new Error("rectangle fixture must begin with a line");
    }
    curves[0] = {
      ...firstCurve,
      end: [9.9999999, -5],
    };
    const connectorStart = curveEnd(curves[0]!);
    const connectorEnd = curveStart(curves[1]!);
    expect(
      Math.hypot(
        connectorStart[0] - connectorEnd[0],
        connectorStart[1] - connectorEnd[1],
      ),
    ).toBeLessThan(PROFILE_TOLERANCE);
    expect(
      validateResolvedProfileRegion(
        profile(
          [circleLoop([0, 0], 1, "near-limit-hole")],
          { curves },
        ),
        PROFILE_TOLERANCE,
      ),
    ).toBeUndefined();
  });

  it("does not trust a solver hole source that points at an authored outer entity", async () => {
    const resolved = profile([
      circleLoop([12, 0], 1, "placeholder.e0"),
    ]);
    const harness = recordingExtrudeKernel();
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: new FixtureSketchSolver(resolved),
    });
    try {
      const result = await evaluator.evaluate(
        fixtureExtrudeDocument(),
      );
      expect(result.ok).toBe(false);
      const item = diagnosticWithCode(
        result,
        "SKETCH_NO_CLOSED_REGION",
      );
      expect(item).toEqual(
        expect.objectContaining({
          path: "/nodes/profile/profile",
          details: expect.objectContaining({
            reason: "hole-outside-outer",
            loop: "hole",
          }),
        }),
      );
      expect(item.details).not.toHaveProperty("curveSource");
      expectNoKernelWork(harness.counters);
    } finally {
      evaluator.dispose();
    }
  });

  it("does not let one resolved hole claim another authored hole entity", async () => {
    const resolved = profile([
      circleLoop([12, 0], 1, "hole-b"),
      circleLoop([3, 0], 1, "hole"),
    ]);
    const harness = recordingExtrudeKernel();
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: new FixtureSketchSolver(resolved),
    });
    try {
      const result = await evaluator.evaluate(
        fixtureExtrudeDocument({
          withHole: true,
          withSecondHole: true,
        }),
      );
      expect(result.ok).toBe(false);
      const item = diagnosticWithCode(
        result,
        "SKETCH_NO_CLOSED_REGION",
      );
      expect(item.path).toBe("/nodes/profile/profile");
      expect(item.details).not.toHaveProperty("curveSource");
      expectNoKernelWork(harness.counters);
    } finally {
      evaluator.dispose();
    }
  });

  it.each([
    {
      name: "sanitizes extra source fields",
      source: {
        kind: "sketch-entity",
        sketch: "profile",
        entity: "hole",
        payload: "x".repeat(100_000),
      },
      expectedPath: "/nodes/profile/entities/hole",
      admitsSource: true,
    },
    {
      name: "rejects an invalid source kind",
      source: {
        kind: "not-sketch-provenance",
        sketch: "profile",
        entity: "hole",
        payload: "x".repeat(100_000),
      },
      expectedPath: "/nodes/profile/profile",
      admitsSource: false,
    },
    {
      name: "contains a throwing source accessor",
      source: throwingProfileCurveSource(),
      expectedPath: "/nodes/profile/profile",
      admitsSource: false,
    },
    {
      name: "contains a revoked source proxy",
      source: revokedProfileCurveSource(),
      expectedPath: "/nodes/profile/profile",
      admitsSource: false,
    },
  ])("$name from a replaceable solver", async ({
    source: unsafeSource,
    expectedPath,
    admitsSource,
  }) => {
    const resolved = profile([
      {
        curves: [
          {
            kind: "circle",
            center: [12, 0],
            radius: 1,
            reversed: false,
            source:
              unsafeSource as unknown as ProfileCurveSource,
          },
        ],
      },
    ]);
    const harness = recordingExtrudeKernel();
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: new FixtureSketchSolver(resolved),
    });
    try {
      const result = await evaluator.evaluate(
        fixtureExtrudeDocument({ withHole: true }),
      );
      expect(result.ok).toBe(false);
      const item = diagnosticWithCode(
        result,
        "SKETCH_NO_CLOSED_REGION",
      );
      expect(item.path).toBe(expectedPath);
      if (admitsSource) {
        expect(item.details?.curveSource).toEqual({
          kind: "sketch-entity",
          sketch: "profile",
          entity: "hole",
        });
      } else {
        expect(item.details).not.toHaveProperty("curveSource");
      }
      expect(JSON.stringify(item)).not.toContain("payload");
      expect(JSON.stringify(item).length).toBeLessThan(2_000);
      expectNoKernelWork(harness.counters);
    } finally {
      evaluator.dispose();
    }
  });

  it("validates named configurations after call-time parameter precedence", async () => {
    const harness = recordingExtrudeKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const document = cleanRoomDocument();
      const invalid = await evaluator.evaluate(document, {
        configuration: "invalid-spacing",
      });
      expect(invalid.ok).toBe(false);
      expect(diagnosticWithCode(invalid, "SKETCH_NO_CLOSED_REGION")).toEqual(
        expect.objectContaining({
          node: "profile",
          path:
            "/nodes/profile/entities/mounting-hole-lower-left",
          details: expect.objectContaining({
            reason: "hole-outside-outer",
          }),
        }),
      );
      expectNoKernelWork(harness.counters);

      const recovered = await evaluator.evaluate(document, {
        configuration: "invalid-spacing",
        parameters: {
          plateWidth: 140,
          mountingPitchX: 100,
        },
      });
      expect(recovered.ok).toBe(true);
      expect(harness.counters.extrude).toBe(1);
      if (recovered.ok) recovered.value.dispose();
    } finally {
      evaluator.dispose();
    }
  });
});

function productionParityDocument(): DesignDocument {
  const cad = design("production-kernel-profile-containment");
  const holeX = cad.parameter.length("holeX", mm(0), {
    min: mm(0),
    max: mm(20),
  });
  const profileRef = cad.sketch(
    "profile",
    plane.xy(),
    (sketch) => {
      const outer = sketch.rectangle("outer", {
        width: mm(20),
        height: mm(20),
      });
      const hole = sketch.circle("hole", {
        center: vec2(holeX, mm(0)),
        radius: mm(2),
      });
      return sketch.profile(outer, { holes: [hole.loop()] });
    },
    { tolerance: PROFILE_TOLERANCE },
  );
  cad.output("solid", cad.extrude("solid", profileRef, { distance: mm(2) }));
  cad.configuration("outside", (configuration) => {
    configuration.parameter(holeX, mm(13));
  });
  cad.configuration("near-clear", (configuration) => {
    configuration.parameter(
      holeX,
      mm(8 - PROFILE_TOLERANCE * 2),
    );
  });
  cad.configuration("at-tolerance", (configuration) => {
    configuration.parameter(
      holeX,
      mm(8 - PROFILE_TOLERANCE),
    );
  });
  return cad.build();
}

describe("production kernel profile-containment parity", () => {
  it.each([
    ["Manifold", createManifoldKernel],
    ["stock OCCT", createOcctKernel],
  ] as const)(
    "%s admits the valid base profile and rejects the same resolved invalid configuration",
    async (_name, createKernel) => {
      const evaluator = await createEvaluator({ kernel: await createKernel() });
      try {
        const document = productionParityDocument();
        const valid = await evaluator.evaluate(document);
        expect(valid.ok).toBe(true);
        if (valid.ok) {
          expect(valid.value.output("solid").measure().volume).toBeGreaterThan(
            0,
          );
          valid.value.dispose();
        }

        const nearClear = await evaluator.evaluate(document, {
          configuration: "near-clear",
        });
        expect(nearClear.ok).toBe(true);
        if (nearClear.ok) {
          expect(
            nearClear.value.output("solid").measure().volume,
          ).toBeGreaterThan(0);
          nearClear.value.dispose();
        }

        const equality = await evaluator.evaluate(document, {
          configuration: "at-tolerance",
        });
        expect(equality.ok).toBe(false);
        expect(
          diagnosticWithCode(
            equality,
            "SKETCH_NO_CLOSED_REGION",
          ),
        ).toEqual(
          expect.objectContaining({
            node: "profile",
            path: "/nodes/profile/entities/hole",
            details: expect.objectContaining({
              holeIndex: 0,
              reason: expect.stringMatching(
                /^(hole-outer-boundary-contact|uncertified-clearance)$/,
              ),
            }),
          }),
        );

        const invalid = await evaluator.evaluate(document, {
          configuration: "outside",
        });
        expect(invalid.ok).toBe(false);
        expect(diagnosticWithCode(invalid, "SKETCH_NO_CLOSED_REGION")).toEqual(
          expect.objectContaining({
            node: "profile",
            path: "/nodes/profile/entities/hole",
            details: expect.objectContaining({
              reason: "hole-outside-outer",
              holeIndex: 0,
            }),
          }),
        );
      } finally {
        evaluator.dispose();
      }
    },
    30_000,
  );
});

function largeValidProfile(holeCount: number): ResolvedProfile {
  const midpoint = (holeCount - 1) / 2;
  return {
    plane: { plane: "XY", origin: [0, 0, 0] },
    outer: circleLoop([0, 0], holeCount * 3, "large-outer"),
    holes: Array.from({ length: holeCount }, (_, index) =>
      circleLoop([(index - midpoint) * 3, 0], 1, `large-hole-${index}`),
    ),
  };
}

describe("profile-containment work and cancellation boundaries", () => {
  it("meters the legacy closure pass before returning a hole-free profile", () => {
    expect(
      validateResolvedProfileRegion(
        profile([]),
        PROFILE_TOLERANCE,
        { maxWorkUnits: 2 },
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "validation-work-limit",
        workUnits: 2,
        maxWorkUnits: 2,
      }),
    );
  });

  it("observes cancellation during the hole-free closure pass", () => {
    let reads = 0;
    const signal = {
      get aborted() {
        reads += 1;
        return reads >= 3;
      },
    } as AbortSignal;
    expect(
      validateResolvedProfileRegion(
        profile([]),
        PROFILE_TOLERANCE,
        { signal },
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "evaluation-aborted",
      }),
    );
    expect(reads).toBeGreaterThanOrEqual(3);
  });

  it(
    "fails closed when containment exhausts its 1,000,000-unit work ceiling",
    async () => {
      const harness = recordingExtrudeKernel();
      const solver = new FixtureSketchSolver(largeValidProfile(1_415));
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: solver,
      });
      try {
        const result = await evaluator.evaluate(
          fixtureExtrudeDocument(),
        );
        expect(result.ok).toBe(false);
        const item = diagnosticWithCode(
          result,
          "RESOURCE_LIMIT_EXCEEDED",
        );
        expect(item).toEqual(
          expect.objectContaining({
            node: "profile",
            path: "/nodes/profile/profile",
            details: expect.objectContaining({
              resource: "profileRegionWorkUnits",
              limit: PROFILE_WORK_LIMIT,
              actual: PROFILE_WORK_LIMIT + 1,
            }),
          }),
        );
        expectNoKernelWork(harness.counters);
      } finally {
        evaluator.dispose();
      }
    },
    30_000,
  );

  it("observes cancellation while classifying a large resolved profile", async () => {
    let solverReturned = false;
    let reads = 0;
    const signal = {
      get aborted() {
        if (!solverReturned) return false;
        reads += 1;
        return reads >= 32;
      },
    } as AbortSignal;
    const harness = recordingExtrudeKernel();
    const solver = new FixtureSketchSolver(
      largeValidProfile(1_000),
      () => {
        solverReturned = true;
      },
    );
    const evaluator = await createEvaluator({
      kernel: harness.kernel,
      sketchSolver: solver,
    });
    try {
      const result = await evaluator.evaluate(fixtureExtrudeDocument(), {
        signal,
      });
      expect(result.ok).toBe(false);
      expect(diagnosticWithCode(result, "EVALUATION_ABORTED")).toBeDefined();
      expect(solver.solveCalls).toBe(1);
      expect(reads).toBeGreaterThanOrEqual(32);
      expectNoKernelWork(harness.counters);
    } finally {
      evaluator.dispose();
    }
  });
});
