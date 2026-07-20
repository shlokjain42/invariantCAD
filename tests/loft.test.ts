import { describe, expect, it } from "vitest";
import {
  LOFT_RULED_SEMANTICS,
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
  validateRuledSolidLoftProfiles,
  vec3,
  type DesignDocument,
  type GeometryKernel,
  type KernelFeatureContext,
  type KernelShape,
  type ResolvedLoftOptions,
  type ResolvedLoop,
  type ResolvedProfile,
  type SketchNodeIR,
  type SketchSolveContext,
  type SketchSolverBackend,
  type SketchSolverCapabilities,
  type SolvedSketch,
} from "../src/index.js";

const LOFT_TOLERANCE = 1e-7;

function rectangleLoop(
  reversed = false,
  options: { readonly width?: number; readonly height?: number } = {},
): ResolvedLoop {
  const halfWidth = (options.width ?? 2) / 2;
  const halfHeight = (options.height ?? 2) / 2;
  const counterclockwise = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ] as const;
  const points = reversed
    ? [
        counterclockwise[0],
        counterclockwise[3],
        counterclockwise[2],
        counterclockwise[1],
      ]
    : [...counterclockwise];
  return {
    curves: points.map((start, index) => ({
      kind: "line" as const,
      start,
      end: points[(index + 1) % points.length]!,
    })),
  };
}

function planeOrigin(
  station: number,
  family: "XY" | "XZ" | "YZ" = "XY",
): readonly [number, number, number] {
  switch (family) {
    case "XY":
      return [0, 0, station];
    case "XZ":
      return [0, -station, 0];
    case "YZ":
      return [station, 0, 0];
  }
}

function rectangleProfile(
  station: number,
  options: {
    readonly family?: "XY" | "XZ" | "YZ";
    readonly reversed?: boolean;
    readonly holes?: readonly ResolvedLoop[];
    readonly width?: number;
    readonly height?: number;
    readonly inPlaneOffset?: readonly [number, number];
  } = {},
): ResolvedProfile {
  const family = options.family ?? "XY";
  const origin = [...planeOrigin(station, family)] as [number, number, number];
  const [u, v] = options.inPlaneOffset ?? [0, 0];
  if (family === "XY") {
    origin[0] += u;
    origin[1] += v;
  } else if (family === "XZ") {
    origin[0] += u;
    origin[2] += v;
  } else {
    origin[1] += u;
    origin[2] += v;
  }
  return {
    plane: { plane: family, origin },
    outer: rectangleLoop(options.reversed, options),
    holes: options.holes ?? [],
  };
}

function circleProfile(station: number, reversed = false): ResolvedProfile {
  return {
    plane: { plane: "XY", origin: [0, 0, station] },
    outer: {
      curves: [
        {
          kind: "circle",
          center: [0, 0],
          radius: 1,
          reversed,
        },
      ],
    },
    holes: [],
  };
}

function arcDirectionProfile(
  station: number,
  clockwise: boolean,
): ResolvedProfile {
  return {
    plane: { plane: "XY", origin: [0, 0, station] },
    outer: {
      curves: [
        {
          kind: "arc",
          center: [0, 0],
          radius: 1,
          startAngle: 0,
          endAngle: Math.PI,
          clockwise,
        },
        { kind: "line", start: [-1, 0], end: [-1, -10] },
        { kind: "line", start: [-1, -10], end: [1, -10] },
        { kind: "line", start: [1, -10], end: [1, 0] },
      ],
    },
    holes: [],
  };
}

function tinyAreaProfile(station: number): ResolvedProfile {
  const height = 1e-15;
  return {
    plane: { plane: "XY", origin: [0, 0, station] },
    outer: {
      curves: [
        { kind: "line", start: [0, 0], end: [1, 0] },
        { kind: "line", start: [1, 0], end: [2, height] },
        { kind: "line", start: [2, height], end: [1, height] },
        { kind: "line", start: [1, height], end: [0, 0] },
      ],
    },
    holes: [],
  };
}

function canonicalLoftDocument(): DesignDocument {
  const cad = design("canonical-ruled-loft");
  const lower = cad.sketch(
    "lower-profile",
    plane.xy(vec3(mm(0), mm(0), mm(0))),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(10), height: mm(8) }),
      ),
  );
  const upper = cad.sketch(
    "upper-profile",
    plane.xy(vec3(mm(2), mm(-1), mm(12))),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(6), height: mm(4) }),
      ),
  );
  const body = cad.loft("body", [lower, upper]);
  cad.output("body", body);
  return cad.build();
}

function fixtureLoftDocument(profileIds: readonly string[]): DesignDocument {
  const cad = design("fixture-loft");
  const references = profileIds.map((id, index) =>
    cad.sketch(
      id,
      plane.xy(vec3(mm(0), mm(0), mm(index * 10))),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("placeholder", {
            width: mm(2),
            height: mm(2),
          }),
        ),
    ),
  );
  cad.output("body", cad.loft("body", references));
  return cad.build();
}

interface LoftInvocation {
  readonly profiles: readonly ResolvedProfile[];
  readonly options: ResolvedLoftOptions;
  readonly context?: KernelFeatureContext;
}

function recordingLoftKernel(
  options: {
    readonly declaresLoft?: boolean;
    readonly implementsLoft?: boolean;
  } = {},
): { readonly kernel: GeometryKernel; readonly invocations: LoftInvocation[] } {
  const id = "recording-loft-kernel";
  const declaresLoft = options.declaresLoft ?? true;
  const implementsLoft = options.implementsLoft ?? true;
  const features: readonly "loft"[] = declaresLoft ? ["loft"] : [];
  const invocations: LoftInvocation[] = [];
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
      features,
      nativeImports: [],
      nativeExports: [],
    },
    ...(implementsLoft
      ? {
          loft(
            profiles: readonly ResolvedProfile[],
            resolved: ResolvedLoftOptions,
            context?: KernelFeatureContext,
          ): KernelShape {
            invocations.push({
              profiles,
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
      tolerance: LOFT_TOLERANCE,
    }),
    status: () => ({ ok: true, code: "OK" }),
    disposeShape: () => {},
    dispose: () => {},
  };
  return { kernel, invocations };
}

class FixtureSketchSolver implements SketchSolverBackend {
  readonly id = "fixture-loft-sketch-solver";
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

describe("ruled solid loft document contract", () => {
  it("materializes ordered profile refs and round-trips canonically", async () => {
    expect(LOFT_RULED_SEMANTICS).toBe(true);
    const document = canonicalLoftDocument();
    const body = document.nodes[document.outputs.body!.node]!;
    expect(body).toEqual({
      kind: "loft",
      profiles: [
        { node: "lower-profile", kind: "profile" },
        { node: "upper-profile", kind: "profile" },
      ],
      ruled: true,
    });
    expect(nodeDependencies(body)).toEqual([
      { node: "lower-profile", kind: "profile" },
      { node: "upper-profile", kind: "profile" },
    ]);
    expect(outputKindForNode(body)).toBe("solid");

    const serialized = stringifyDocument(document);
    const parsed = parseDocumentValue(JSON.parse(serialized));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(document);
    expect(cloneDocument(document)).toEqual(document);
    expect(await hashDocument(document)).toBe(
      "7627212b9193e86c331cd01ed95cdac810df5729a1d4f887c57b0326b6c2663a",
    );

    const reversed = JSON.parse(serialized) as any;
    reversed.nodes.body.profiles.reverse();
    const reversedResult = parseDocumentValue(reversed);
    expect(reversedResult.ok).toBe(true);
    if (reversedResult.ok) {
      expect(stringifyDocument(reversedResult.value)).not.toBe(serialized);
      expect(await hashDocument(reversedResult.value)).not.toBe(
        await hashDocument(document),
      );
    }
  });

  it("rejects programmer misuse at the builder boundary", () => {
    const cad = design("builder-loft-validation");
    const first = cad.sketch("first", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(2), height: mm(2) }),
      ),
    );
    const second = cad.sketch(
      "second",
      plane.xy(vec3(mm(0), mm(0), mm(2))),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("section", { width: mm(1), height: mm(1) }),
        ),
    );

    expect(() => cad.loft("short", [first])).toThrow("at least two");
    expect(() => cad.loft("duplicate", [first, first])).toThrow("distinct");
    expect(() =>
      cad.loft("smooth", [first, second], { ruled: false } as any),
    ).toThrow("must be ruled");

    const other = design("foreign-loft-profile");
    const foreign = other.sketch("foreign", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("section", { width: mm(1), height: mm(1) }),
      ),
    );
    expect(() => cad.loft("foreign", [first, foreign])).toThrow(
      "cross design boundaries",
    );

    if (false) {
      cad.loft("compile-smooth", [first, second], {
        // @ts-expect-error The current document grammar supports ruled lofts only.
        ruled: false,
      });
    }
  });

  it("uses a strict serialized shape and validates profile references", () => {
    const serialized = stringifyDocument(canonicalLoftDocument());
    for (const mutate of [
      (value: any) => delete value.nodes.body.profiles,
      (value: any) => delete value.nodes.body.ruled,
      (value: any) => value.nodes.body.profiles.splice(1),
      (value: any) => {
        value.nodes.body.ruled = false;
      },
      (value: any) => {
        value.nodes.body.smooth = true;
      },
    ]) {
      const malformed = JSON.parse(serialized) as any;
      mutate(malformed);
      expect(parseDocumentValue(malformed).diagnostics).toContainEqual(
        expect.objectContaining({ code: "IR_INVALID" }),
      );
    }

    const missing = JSON.parse(serialized) as any;
    missing.nodes.body.profiles[1].node = "absent";
    expect(parseDocumentValue(missing).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_MISSING",
        path: "/nodes/body/profiles/1/node",
      }),
    );

    const wrongKind = JSON.parse(serialized) as any;
    wrongKind.nodes.body.profiles[1].kind = "solid";
    expect(parseDocumentValue(wrongKind).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        path: "/nodes/body/profiles/1",
      }),
    );

    const duplicate = JSON.parse(serialized) as any;
    duplicate.nodes.body.profiles[1] = duplicate.nodes.body.profiles[0];
    expect(parseDocumentValue(duplicate).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FEATURE_INVALID",
        node: "body",
        path: "/nodes/body/profiles/1",
        details: { reason: "duplicate-profile" },
      }),
    );

    const semanticFallback = JSON.parse(serialized) as any;
    semanticFallback.nodes.body.profiles.splice(1);
    expect(validateDocument(semanticFallback).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "FEATURE_INVALID",
        node: "body",
        path: "/nodes/body/profiles",
      }),
    );
  });
});

describe("ruled solid loft profile compatibility", () => {
  it("accepts ascending, descending, and in-plane-shifted compatible sections", () => {
    expect(
      validateRuledSolidLoftProfiles(
        [
          rectangleProfile(0),
          rectangleProfile(5, { inPlaneOffset: [2, -1] }),
          rectangleProfile(10, { width: 4, height: 3 }),
        ],
        LOFT_TOLERANCE,
      ),
    ).toBeUndefined();
    expect(
      validateRuledSolidLoftProfiles(
        [rectangleProfile(10), rectangleProfile(5), rectangleProfile(0)],
        LOFT_TOLERANCE,
      ),
    ).toBeUndefined();
  });

  it("returns every stable profile-compatibility reason", () => {
    const valid = [rectangleProfile(0), rectangleProfile(10)] as const;
    const cases: readonly {
      readonly reason:
        | "invalid-tolerance"
        | "profile-count"
        | "non-finite-profile"
        | "holes-unsupported"
        | "plane-family-mismatch"
        | "degenerate-profile"
        | "orientation-mismatch"
        | "curve-signature-mismatch"
        | "curve-phase-mismatch"
        | "coincident-station"
        | "non-monotonic-stations";
      readonly profiles: readonly ResolvedProfile[];
      readonly tolerance?: number;
      readonly profileIndex?: number;
    }[] = [
      { reason: "invalid-tolerance", profiles: valid, tolerance: 0 },
      { reason: "profile-count", profiles: [rectangleProfile(0)] },
      {
        reason: "non-finite-profile",
        profiles: [
          rectangleProfile(0),
          {
            ...rectangleProfile(10),
            plane: { plane: "XY", origin: [0, Number.NaN, 10] },
          },
        ],
        profileIndex: 1,
      },
      {
        reason: "holes-unsupported",
        profiles: [
          rectangleProfile(0),
          rectangleProfile(10, {
            holes: [rectangleLoop(false, { width: 0.5, height: 0.5 })],
          }),
        ],
        profileIndex: 1,
      },
      {
        reason: "plane-family-mismatch",
        profiles: [rectangleProfile(0), rectangleProfile(10, { family: "XZ" })],
        profileIndex: 1,
      },
      {
        reason: "degenerate-profile",
        profiles: [rectangleProfile(0), tinyAreaProfile(10)],
        profileIndex: 1,
      },
      {
        reason: "orientation-mismatch",
        profiles: [rectangleProfile(0), rectangleProfile(10, { reversed: true })],
        profileIndex: 1,
      },
      {
        reason: "curve-signature-mismatch",
        profiles: [rectangleProfile(0), circleProfile(10)],
        profileIndex: 1,
      },
      {
        reason: "curve-phase-mismatch",
        profiles: [
          rectangleProfile(0),
          (() => {
            const profile = rectangleProfile(10);
            return {
              ...profile,
              outer: {
                curves: [
                  ...profile.outer.curves.slice(1),
                  profile.outer.curves[0]!,
                ],
              },
            };
          })(),
        ],
        profileIndex: 1,
      },
      {
        reason: "coincident-station",
        profiles: [rectangleProfile(0), rectangleProfile(LOFT_TOLERANCE / 2)],
        profileIndex: 1,
      },
      {
        reason: "non-monotonic-stations",
        profiles: [rectangleProfile(0), rectangleProfile(10), rectangleProfile(5)],
        profileIndex: 2,
      },
    ];

    for (const testCase of cases) {
      expect(
        validateRuledSolidLoftProfiles(
          testCase.profiles,
          testCase.tolerance ?? LOFT_TOLERANCE,
        ),
        testCase.reason,
      ).toEqual(
        expect.objectContaining({
          reason: testCase.reason,
          ...(testCase.profileIndex === undefined
            ? {}
            : { profileIndex: testCase.profileIndex }),
        }),
      );
    }
  });

  it("treats arc traversal direction as part of the ordered signature", () => {
    expect(
      validateRuledSolidLoftProfiles(
        [arcDirectionProfile(0, false), arcDirectionProfile(10, true)],
        LOFT_TOLERANCE,
      ),
    ).toEqual(
      expect.objectContaining({
        reason: "curve-signature-mismatch",
        profileIndex: 1,
        curveIndex: 0,
        expected: "arc:counterclockwise",
        actual: "arc:clockwise",
      }),
    );
  });
});

describe("ruled solid loft evaluator protocol", () => {
  it("fails closed before solving profiles when loft is unsupported or malformed", async () => {
    for (const testCase of [
      {
        declaresLoft: false,
        implementsLoft: false,
        code: "KERNEL_CAPABILITY_MISSING",
      },
      {
        declaresLoft: true,
        implementsLoft: false,
        code: "KERNEL_ERROR",
      },
    ] as const) {
      const harness = recordingLoftKernel(testCase);
      const solver = new FixtureSketchSolver({
        "lower-profile": rectangleProfile(0),
        "upper-profile": rectangleProfile(10),
      });
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: solver,
      });
      try {
        const result = await evaluator.evaluate(canonicalLoftDocument());
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: testCase.code,
            node: "body",
            path: "/nodes/body",
            details: expect.objectContaining({
              kind: "feature",
              capability: "loft",
              ...(testCase.declaresLoft ? { protocolViolation: true } : {}),
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

  it("transfers solved profiles, order, sources, options, and context unchanged", async () => {
    const cad = design("ordered-profile-transfer");
    const lower = cad.sketch(
      "lower",
      plane.xy(vec3(mm(0), mm(0), mm(0))),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("lower-section", { width: mm(2), height: mm(2) }),
        ),
    );
    const middle = cad.sketch(
      "middle",
      plane.xy(vec3(mm(1), mm(0), mm(10))),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("middle-section", { width: mm(3), height: mm(3) }),
        ),
    );
    const upper = cad.sketch(
      "upper",
      plane.xy(vec3(mm(2), mm(0), mm(20))),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("upper-section", { width: mm(4), height: mm(4) }),
        ),
    );
    cad.output("body", cad.loft("body", [upper, middle, lower]));

    const harness = recordingLoftKernel();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      try {
        expect(harness.invocations).toHaveLength(1);
        const invocation = harness.invocations[0]!;
        expect(invocation.options).toEqual({ ruled: true });
        expect(invocation.context).toEqual({
          feature: "body",
          tolerance: LOFT_TOLERANCE,
        });
        expect(invocation.profiles.map((profile) => profile.plane.origin[2])).toEqual([
          20,
          10,
          0,
        ]);
        expect(
          invocation.profiles.map((profile) =>
            profile.outer.curves.map((curve) => curve.source),
          ),
        ).toEqual([
          [0, 1, 2, 3].map((index) => ({
            kind: "sketch-entity",
            sketch: "upper",
            entity: `upper-section.e${index}`,
          })),
          [0, 1, 2, 3].map((index) => ({
            kind: "sketch-entity",
            sketch: "middle",
            entity: `middle-section.e${index}`,
          })),
          [0, 1, 2, 3].map((index) => ({
            kind: "sketch-entity",
            sketch: "lower",
            entity: `lower-section.e${index}`,
          })),
        ]);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("reports every evaluator-reachable compatibility reason before loft invocation", async () => {
    const scenarios: readonly {
      readonly reason:
        | "non-finite-profile"
        | "holes-unsupported"
        | "plane-family-mismatch"
        | "degenerate-profile"
        | "orientation-mismatch"
        | "curve-signature-mismatch"
        | "curve-phase-mismatch"
        | "coincident-station"
        | "non-monotonic-stations";
      readonly ids: readonly string[];
      readonly profiles: Readonly<Record<string, ResolvedProfile>>;
      readonly profileIndex: number;
    }[] = [
      {
        reason: "non-finite-profile",
        ids: ["first", "second"],
        profiles: {
          first: rectangleProfile(0),
          second: {
            ...rectangleProfile(10),
            plane: { plane: "XY", origin: [Number.POSITIVE_INFINITY, 0, 10] },
          },
        },
        profileIndex: 1,
      },
      {
        reason: "holes-unsupported",
        ids: ["first", "second"],
        profiles: {
          first: rectangleProfile(0),
          second: rectangleProfile(10, {
            holes: [rectangleLoop(false, { width: 0.5, height: 0.5 })],
          }),
        },
        profileIndex: 1,
      },
      {
        reason: "plane-family-mismatch",
        ids: ["first", "second"],
        profiles: {
          first: rectangleProfile(0),
          second: rectangleProfile(10, { family: "YZ" }),
        },
        profileIndex: 1,
      },
      {
        reason: "degenerate-profile",
        ids: ["first", "second"],
        profiles: {
          first: rectangleProfile(0),
          second: tinyAreaProfile(10),
        },
        profileIndex: 1,
      },
      {
        reason: "orientation-mismatch",
        ids: ["first", "second"],
        profiles: {
          first: rectangleProfile(0),
          second: rectangleProfile(10, { reversed: true }),
        },
        profileIndex: 1,
      },
      {
        reason: "curve-signature-mismatch",
        ids: ["first", "second"],
        profiles: {
          first: rectangleProfile(0),
          second: circleProfile(10),
        },
        profileIndex: 1,
      },
      {
        reason: "curve-phase-mismatch",
        ids: ["first", "second"],
        profiles: {
          first: rectangleProfile(0),
          second: (() => {
            const profile = rectangleProfile(10);
            return {
              ...profile,
              outer: {
                curves: [
                  ...profile.outer.curves.slice(1),
                  profile.outer.curves[0]!,
                ],
              },
            };
          })(),
        },
        profileIndex: 1,
      },
      {
        reason: "coincident-station",
        ids: ["first", "second"],
        profiles: {
          first: rectangleProfile(0),
          second: rectangleProfile(LOFT_TOLERANCE / 2),
        },
        profileIndex: 1,
      },
      {
        reason: "non-monotonic-stations",
        ids: ["first", "second", "third"],
        profiles: {
          first: rectangleProfile(0),
          second: rectangleProfile(10),
          third: rectangleProfile(5),
        },
        profileIndex: 2,
      },
    ];

    for (const scenario of scenarios) {
      const harness = recordingLoftKernel();
      const solver = new FixtureSketchSolver(scenario.profiles);
      const evaluator = await createEvaluator({
        kernel: harness.kernel,
        sketchSolver: solver,
      });
      try {
        const result = await evaluator.evaluate(fixtureLoftDocument(scenario.ids));
        expect(result.ok, scenario.reason).toBe(false);
        expect(result.diagnostics, scenario.reason).toContainEqual(
          expect.objectContaining({
            code: "FEATURE_INVALID",
            node: "body",
            path: `/nodes/body/profiles/${scenario.profileIndex}`,
            details: expect.objectContaining({
              reason: scenario.reason,
              profileIndex: scenario.profileIndex,
            }),
          }),
        );
        expect(harness.invocations, scenario.reason).toEqual([]);
      } finally {
        evaluator.dispose();
      }
    }
  });
});
