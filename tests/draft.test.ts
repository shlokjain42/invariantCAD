import { describe, expect, it } from "vitest";
import {
  DRAFT_MIN_ANGLE_RADIANS,
  cloneDocument,
  createEvaluator,
  deg,
  design,
  expr,
  hashDocument,
  mm,
  nodeDependencies,
  outputKindForNode,
  parseDocumentValue,
  rad,
  scalar,
  scalarVec3,
  stringifyDocument,
  topology,
  validateDocument,
  vec3,
  type AngleExpression,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelFeatureContext,
  type KernelShape,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
  type ScalarVec3Expression,
  type Vec3Expression,
  type ResolvedDraftOptions,
} from "../src/index.js";
import { TopologyEvolutionProtocolError } from "../src/internal/topology-evolution.js";

function topologyKey(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

const draftSnapshot: KernelTopologySnapshot = {
  history: "complete",
  faces: ["z-face", "a-face", "m-face"].map((id, index) => ({
    topology: "face" as const,
    key: topologyKey(id),
    center: [index, 0, 0],
    bounds: { min: [index, 0, 0], max: [index, 1, 1] },
    lineage: [{ feature: "box", relation: "created" as const }],
    area: 1,
    surface: { kind: "plane", normal: [1, 0, 0] },
    edges: [],
  })),
  edges: [],
};

interface DraftInvocation {
  readonly shape: KernelShape;
  readonly faces: readonly KernelTopologyKey[];
  readonly options: ResolvedDraftOptions;
  readonly context?: KernelFeatureContext;
}

interface DraftKernelHarness {
  readonly kernel: GeometryKernel;
  readonly invocations: DraftInvocation[];
  readonly topologyCalls: () => number;
}

function createDraftKernelHarness(
  options: {
    readonly exactEvolution?: unknown;
    readonly implementDraft?: boolean;
    readonly draftError?: unknown;
  } = {},
): DraftKernelHarness {
  const id = "draft-protocol-test";
  let serial = 0;
  let topologyCallCount = 0;
  const invocations: DraftInvocation[] = [];
  const shape = (): KernelShape => ({ kernel: id, serial: serial++ }) as KernelShape;
  const defaultEvolution = { protocolVersion: 1, features: ["draft"] };
  const exactEvolution =
    "exactEvolution" in options ? options.exactEvolution : defaultEvolution;
  const capabilities = {
    protocolVersion: 1,
    representation: "brep",
    exact: true,
    primitives: ["box"],
    features: ["draft"],
    nativeImports: [],
    nativeExports: [],
    topology: {
      kinds: ["face"],
      provenance: "feature",
      semanticRoles: false,
      sketchSources: false,
      geometry: true,
      adjacency: false,
    },
    ...(exactEvolution === undefined
      ? {}
      : { exactIndexedTopologyEvolution: exactEvolution }),
  } as unknown as KernelCapabilities;
  const kernel: GeometryKernel = {
    id,
    capabilities,
    box: () => shape(),
    ...(options.implementDraft === false
      ? {}
      : {
          draft(
            input: KernelShape,
            faces: readonly KernelTopologyKey[],
            resolved: ResolvedDraftOptions,
            context?: KernelFeatureContext,
          ): KernelShape {
            if (options.draftError !== undefined) throw options.draftError;
            invocations.push({
              shape: input,
              faces: [...faces],
              options: resolved,
              ...(context === undefined ? {} : { context }),
            });
            return shape();
          },
        }),
    topology: () => {
      topologyCallCount += 1;
      return draftSnapshot;
    },
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
      tolerance: 1e-7,
    }),
    status: () => ({ ok: true, code: "OK" }),
    disposeShape: () => {},
    dispose: () => {},
  };
  return {
    kernel,
    invocations,
    topologyCalls: () => topologyCallCount,
  };
}

function evaluatorDraftDocument(
  options: {
    readonly angle?: AngleExpression;
    readonly pullDirection?: ScalarVec3Expression;
    readonly origin?: Vec3Expression;
    readonly normal?: ScalarVec3Expression;
  } = {},
) {
  const cad = design("evaluated-draft");
  const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
  const drafted = cad.draft("drafted", box, {
    faces: topology.faces.all().atLeast(1),
    angle: options.angle ?? rad(-0.25),
    pullDirection: options.pullDirection ?? scalarVec3(0, 0, -2),
    neutralPlane: {
      origin: options.origin ?? vec3(mm(1), mm(2), mm(3)),
      normal: options.normal ?? scalarVec3(2, 3, 4),
    },
  });
  cad.output("drafted", drafted);
  return cad.build();
}

function draftDocument() {
  const cad = design("drafted-box");
  const box = cad.box("box", {
    size: vec3(mm(20), mm(20), mm(10)),
  });
  const faces = topology.faces
    .createdBy(box, { role: "box.face.x-min" })
    .and(topology.faces.normal(scalarVec3(-1, 0, 0)))
    .select();
  const drafted = cad.draft("drafted", box, {
    faces,
    angle: deg(-5),
    pullDirection: scalarVec3(0, 0, 1),
    neutralPlane: {
      origin: vec3(mm(1), mm(2), mm(3)),
      normal: scalarVec3(1, 1, 1),
    },
  });
  cad.output("drafted", drafted);
  return { document: cad.build(), drafted };
}

describe("document draft contract", () => {
  it("materializes every draft input explicitly and round-trips canonically", async () => {
    expect(DRAFT_MIN_ANGLE_RADIANS).toBe(1e-4);

    const { document, drafted } = draftDocument();
    expect(document.nodes[drafted.node]).toEqual({
      kind: "draft",
      input: { node: "box", kind: "solid" },
      faces: {
        topology: "face",
        query: {
          op: "and",
          queries: expect.arrayContaining([
            {
              op: "origin",
              feature: "box",
              relation: "created",
              role: "box.face.x-min",
            },
            {
              op: "normal",
              value: scalarVec3(-1, 0, 0).map((value) => value.ir),
              tolerance: deg(0.1).ir,
            },
          ]),
        },
        cardinality: { min: 1, max: 1 },
      },
      angle: deg(-5).ir,
      pullDirection: scalarVec3(0, 0, 1).map((value) => value.ir),
      neutralPlane: {
        origin: vec3(mm(1), mm(2), mm(3)).map((value) => value.ir),
        normal: scalarVec3(1, 1, 1).map((value) => value.ir),
      },
    });
    expect(nodeDependencies(document.nodes[drafted.node]!)).toEqual([
      { node: "box", kind: "solid" },
    ]);
    expect(outputKindForNode(document.nodes[drafted.node]!)).toBe("solid");
    expect(await hashDocument(document)).toBe(
      "cc86735bb1ec28b881503153db3c4fe66889e7d5bae48be01db13bd649a95cef",
    );

    const serialized = stringifyDocument(document);
    const parsed = parseDocumentValue(JSON.parse(serialized));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(document);
    expect(cloneDocument(document)).toEqual(document);

    const reordered = JSON.parse(serialized) as any;
    reordered.nodes.drafted.faces.query.queries.reverse();
    const reorderedResult = parseDocumentValue(reordered);
    expect(reorderedResult.ok).toBe(true);
    if (reorderedResult.ok) {
      expect(await hashDocument(reorderedResult.value)).toBe(
        await hashDocument(document),
      );
      expect(stringifyDocument(reorderedResult.value)).toBe(serialized);
    }
  });

  it("uses a strict serialized shape with no implicit draft fields", () => {
    const serialized = stringifyDocument(draftDocument().document);
    for (const field of [
      "input",
      "faces",
      "angle",
      "pullDirection",
      "neutralPlane",
    ] as const) {
      const missing = JSON.parse(serialized) as any;
      delete missing.nodes.drafted[field];
      expect(parseDocumentValue(missing).diagnostics).toContainEqual(
        expect.objectContaining({ code: "IR_INVALID" }),
      );
    }

    for (const mutate of [
      (value: any) => {
        value.nodes.drafted.direction = "up";
      },
      (value: any) => {
        value.nodes.drafted.neutralPlane.offset = 0;
      },
      (value: any) => {
        value.nodes.drafted.faces.unstableIndex = 4;
      },
    ]) {
      const unknown = JSON.parse(serialized) as any;
      mutate(unknown);
      expect(parseDocumentValue(unknown).diagnostics).toContainEqual(
        expect.objectContaining({ code: "IR_INVALID" }),
      );
    }

    const shortDirection = JSON.parse(serialized) as any;
    shortDirection.nodes.drafted.pullDirection.pop();
    expect(parseDocumentValue(shortDirection).diagnostics).toContainEqual(
      expect.objectContaining({ code: "IR_INVALID" }),
    );
  });

  it("validates every expression against its exact physical dimension", () => {
    const serialized = stringifyDocument(draftDocument().document);
    const cases = [
      {
        path: "/nodes/drafted/angle",
        mutate(value: any) {
          value.nodes.drafted.angle = mm(1).ir;
        },
      },
      {
        path: "/nodes/drafted/pullDirection/1",
        mutate(value: any) {
          value.nodes.drafted.pullDirection[1] = mm(1).ir;
        },
      },
      {
        path: "/nodes/drafted/neutralPlane/origin/2",
        mutate(value: any) {
          value.nodes.drafted.neutralPlane.origin[2] = scalarVec3(0, 0, 0)[2].ir;
        },
      },
      {
        path: "/nodes/drafted/neutralPlane/normal/0",
        mutate(value: any) {
          value.nodes.drafted.neutralPlane.normal[0] = mm(1).ir;
        },
      },
    ];

    for (const testCase of cases) {
      const invalid = JSON.parse(serialized) as any;
      testCase.mutate(invalid);
      expect(parseDocumentValue(invalid).diagnostics).toContainEqual(
        expect.objectContaining({
          code: "EXPRESSION_DIMENSION_MISMATCH",
          path: testCase.path,
        }),
      );
    }

    if (false) {
      const cad = design("typed-draft");
      const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
      const faces = topology.faces.createdBy(box).select();
      cad.draft("wrong-angle", box, {
        faces,
        // @ts-expect-error Draft angle must be an angle expression.
        angle: mm(1),
        pullDirection: scalarVec3(0, 0, 1),
        neutralPlane: {
          origin: vec3(mm(0), mm(0), mm(0)),
          normal: scalarVec3(0, 0, 1),
        },
      });
      cad.draft("wrong-direction", box, {
        faces,
        angle: deg(1),
        // @ts-expect-error Pull direction must contain scalar expressions.
        pullDirection: vec3(mm(0), mm(0), mm(1)),
        neutralPlane: {
          origin: vec3(mm(0), mm(0), mm(0)),
          normal: scalarVec3(0, 0, 1),
        },
      });
      cad.draft("wrong-plane", box, {
        faces,
        angle: deg(1),
        pullDirection: scalarVec3(0, 0, 1),
        neutralPlane: {
          // @ts-expect-error Neutral-plane origin must contain lengths.
          origin: scalarVec3(0, 0, 0),
          // @ts-expect-error Neutral-plane normal must contain scalars.
          normal: vec3(mm(0), mm(0), mm(1)),
        },
      });
    }
  });

  it("enforces solid and semantic-face ownership and kinds", () => {
    const cad = design("owner");
    const box = cad.box("box", { size: vec3(mm(10), mm(10), mm(10)) });
    const foreignCad = design("foreign");
    const foreignBox = foreignCad.box("box", {
      size: vec3(mm(10), mm(10), mm(10)),
    });
    const options = {
      faces: topology.faces.createdBy(box).select(),
      angle: deg(5),
      pullDirection: scalarVec3(0, 0, 1),
      neutralPlane: {
        origin: vec3(mm(0), mm(0), mm(0)),
        normal: scalarVec3(0, 0, 1),
      },
    } as const;

    expect(() => cad.draft("foreign-input", foreignBox, options)).toThrow(
      "cross design boundaries",
    );
    expect(() =>
      cad.draft("foreign-faces", box, {
        ...options,
        faces: topology.faces.createdBy(foreignBox).select(),
      }),
    ).toThrow("cross design boundaries");
    expect(() =>
      cad.draft("edges", box, {
        ...options,
        faces: topology.edges.createdBy(box).select() as any,
      }),
    ).toThrow("face topology selection");
    expect(() =>
      cad.draft("fake", box, {
        ...options,
        faces: { topology: "face" } as any,
      }),
    ).toThrow("explicit topology selection");

    const drafted = cad.draft("drafted", box, options);
    cad.output("drafted", drafted);
    const serialized = stringifyDocument(cad.build());

    const wrongInputKind = JSON.parse(serialized) as any;
    wrongInputKind.nodes.drafted.input.kind = "profile";
    expect(parseDocumentValue(wrongInputKind).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        path: "/nodes/drafted/input",
      }),
    );

    const wrongTopology = JSON.parse(serialized) as any;
    wrongTopology.nodes.drafted.faces.topology = "edge";
    expect(parseDocumentValue(wrongTopology).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "TOPOLOGY_SELECTOR_INVALID",
        path: "/nodes/drafted/faces/topology",
      }),
    );

    const unrelatedCad = design("unrelated-origin");
    const input = unrelatedCad.box("input", {
      size: vec3(mm(10), mm(10), mm(10)),
    });
    const unrelated = unrelatedCad.box("unrelated", {
      size: vec3(mm(2), mm(2), mm(2)),
    });
    const invalidDraft = unrelatedCad.draft("drafted", input, {
      ...options,
      faces: topology.faces.createdBy(unrelated).select(),
    });
    unrelatedCad.output("drafted", invalidDraft);
    expect(validateDocument(unrelatedCad.build()).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "TOPOLOGY_SELECTOR_INVALID",
        path: "/nodes/drafted/faces/query/feature",
      }),
    );
  });

  it("leaves resolved numeric bounds to the draft protocol boundary", () => {
    const cad = design("unresolved-bounds");
    const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
    const drafted = cad.draft("drafted", box, {
      faces: topology.faces.all().atLeast(1),
      angle: deg(0),
      pullDirection: scalarVec3(0, 0, 0),
      neutralPlane: {
        origin: vec3(mm(0), mm(0), mm(0)),
        normal: scalarVec3(0, 0, 0),
      },
    });
    cad.output("drafted", drafted);
    expect(validateDocument(cad.build()).ok).toBe(true);

    const resolved: ResolvedDraftOptions = {
      angle: -0.1,
      pullDirection: [0, 0, 1],
      neutralPlane: { origin: [0, 0, 0], normal: [0, 0, 1] },
    };
    expect(resolved.angle).toBeLessThan(0);
  });
});

describe("draft evaluator protocol", () => {
  it("passes through a signed angle, resolved vectors, sorted exact faces, and context", async () => {
    const harness = createDraftKernelHarness();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(evaluatorDraftDocument());
      expect(result.ok).toBe(true);
      if (result.ok) result.value.dispose();
      expect(harness.topologyCalls()).toBe(1);
      expect(harness.invocations).toHaveLength(1);
      expect(harness.invocations[0]).toEqual({
        shape: expect.objectContaining({ kernel: "draft-protocol-test" }),
        faces: ["a-face", "m-face", "z-face"],
        options: {
          angle: -0.25,
          pullDirection: [0, 0, -2],
          neutralPlane: {
            origin: [1, 2, 3],
            normal: [2, 3, 4],
          },
        },
        context: { feature: "drafted" },
      });
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects both strict angle boundaries and zero before topology resolution", async () => {
    const harness = createDraftKernelHarness();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      for (const angle of [
        0,
        DRAFT_MIN_ANGLE_RADIANS,
        -DRAFT_MIN_ANGLE_RADIANS,
        Math.PI / 2,
        -Math.PI / 2,
      ]) {
        const result = await evaluator.evaluate(
          evaluatorDraftDocument({ angle: rad(angle) }),
        );
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "FEATURE_INVALID",
            node: "drafted",
            path: "/nodes/drafted/angle",
          }),
        );
      }
      expect(harness.topologyCalls()).toBe(0);
      expect(harness.invocations).toHaveLength(0);
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects non-finite angle and vector results at their component paths", async () => {
    const harness = createDraftKernelHarness();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const cases = [
        {
          document: evaluatorDraftDocument({
            angle: expr.mul(rad(Number.MAX_VALUE), Number.MAX_VALUE),
          }),
          path: "/nodes/drafted/angle",
        },
        {
          document: evaluatorDraftDocument({
            pullDirection: scalarVec3(
              expr.mul(scalar(Number.MAX_VALUE), Number.MAX_VALUE),
              0,
              1,
            ),
          }),
          path: "/nodes/drafted/pullDirection/0",
        },
        {
          document: evaluatorDraftDocument({
            normal: scalarVec3(
              0,
              expr.mul(scalar(Number.MAX_VALUE), Number.MAX_VALUE),
              1,
            ),
          }),
          path: "/nodes/drafted/neutralPlane/normal/1",
        },
        {
          document: evaluatorDraftDocument({
            origin: vec3(
              mm(0),
              mm(0),
              expr.mul(mm(Number.MAX_VALUE), Number.MAX_VALUE),
            ),
          }),
          path: "/nodes/drafted/neutralPlane/origin/2",
        },
      ];
      for (const testCase of cases) {
        const result = await evaluator.evaluate(testCase.document);
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "FEATURE_INVALID",
            node: "drafted",
            path: testCase.path,
          }),
        );
      }

      const nanDocument = structuredClone(evaluatorDraftDocument()) as any;
      nanDocument.nodes.drafted.pullDirection[1].value = Number.NaN;
      const nanResult = await evaluator.evaluate(nanDocument);
      expect(nanResult.ok).toBe(false);
      expect(nanResult.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "EXPRESSION_INVALID",
          path: "/nodes/drafted/pullDirection/1",
        }),
      );
      expect(harness.topologyCalls()).toBe(0);
      expect(harness.invocations).toHaveLength(0);
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects zero pull and neutral-plane normal vectors at their vector paths", async () => {
    const harness = createDraftKernelHarness();
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      for (const testCase of [
        {
          document: evaluatorDraftDocument({
            pullDirection: scalarVec3(0, 0, 0),
          }),
          path: "/nodes/drafted/pullDirection",
        },
        {
          document: evaluatorDraftDocument({ normal: scalarVec3(0, 0, 0) }),
          path: "/nodes/drafted/neutralPlane/normal",
        },
      ]) {
        const result = await evaluator.evaluate(testCase.document);
        expect(result.ok).toBe(false);
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "FEATURE_INVALID",
            node: "drafted",
            path: testCase.path,
          }),
        );
      }
      expect(harness.topologyCalls()).toBe(0);
      expect(harness.invocations).toHaveLength(0);
    } finally {
      evaluator.dispose();
    }
  });

  it("requires exact indexed evolution before resolving the face selector", async () => {
    const harness = createDraftKernelHarness({ exactEvolution: undefined });
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(evaluatorDraftDocument());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "drafted",
          path: "/nodes/drafted",
          details: expect.objectContaining({
            kernel: "draft-protocol-test",
            kind: "exactIndexedTopologyEvolution",
            capability: "draft",
            protocolVersion: 1,
          }),
        }),
      );
      expect(harness.topologyCalls()).toBe(0);
      expect(harness.invocations).toHaveLength(0);
    } finally {
      evaluator.dispose();
    }
  });

  it("reports a declared draft method mismatch as a protocol violation", async () => {
    const harness = createDraftKernelHarness({ implementDraft: false });
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(evaluatorDraftDocument());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "drafted",
          path: "/nodes/drafted",
          details: expect.objectContaining({
            kind: "feature",
            capability: "draft",
            protocolViolation: true,
          }),
        }),
      );
      expect(harness.topologyCalls()).toBe(0);
      expect(harness.invocations).toHaveLength(0);
    } finally {
      evaluator.dispose();
    }
  });

  it("reports malformed exact history returned by a kernel as a protocol violation", async () => {
    const harness = createDraftKernelHarness({
      draftError: new TopologyEvolutionProtocolError(
        "records do not provide complete one-to-one topology coverage",
      ),
    });
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(evaluatorDraftDocument());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "drafted",
          path: "/nodes/drafted",
          details: expect.objectContaining({
            kernel: "draft-protocol-test",
            protocolViolation: true,
          }),
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });

  it("reports stale exact-evolution metadata with explicit protocol details", async () => {
    const harness = createDraftKernelHarness({
      exactEvolution: { protocolVersion: 2, features: ["draft"] },
    });
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(evaluatorDraftDocument());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "drafted",
          path: "/nodes/drafted",
          details: expect.objectContaining({
            kind: "exactIndexedTopologyEvolution",
            capability: "draft",
            protocolViolation: true,
            reason: "unsupported protocol version",
            expectedProtocolVersion: 1,
            actualProtocolVersion: 2,
          }),
        }),
      );
      expect(harness.topologyCalls()).toBe(0);
      expect(harness.invocations).toHaveLength(0);
    } finally {
      evaluator.dispose();
    }
  });

  it("rejects sparse exact-evolution feature metadata as a protocol violation", async () => {
    const harness = createDraftKernelHarness({
      exactEvolution: { protocolVersion: 1, features: new Array(1) },
    });
    const evaluator = await createEvaluator({ kernel: harness.kernel });
    try {
      const result = await evaluator.evaluate(evaluatorDraftDocument());
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_ERROR",
          node: "drafted",
          path: "/nodes/drafted",
          details: expect.objectContaining({
            kind: "exactIndexedTopologyEvolution",
            capability: "draft",
            protocolViolation: true,
            reason: "features must be a dense array of feature names",
          }),
        }),
      );
      expect(harness.topologyCalls()).toBe(0);
      expect(harness.invocations).toHaveLength(0);
    } finally {
      evaluator.dispose();
    }
  });
});
