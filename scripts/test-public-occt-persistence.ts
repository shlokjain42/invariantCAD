import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  captureTopologyReference,
  createEvaluator,
  deg,
  design,
  EvaluatedSolid,
  mm,
  parseDocument,
  resolveTopologyReference,
  resolveTopologySelection,
  scalarVec3,
  stringifyDocument,
  topology,
  vec3,
  type CadResult,
  type DesignDocument,
  type EvaluatedDesign,
  type Evaluator,
  type KernelTopologyKey,
  type KernelTopologySignatureCapabilities,
  type KernelTopologySnapshot,
  type PersistentTopologyReference,
} from "../src/index.js";
import {
  createOcctKernel,
  type OcctModuleFactory,
} from "../src/occt-kernel.js";

type EdgeTreatment = "fillet" | "chamfer";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const tolerance = Object.freeze({
  linear: 1e-6,
  angular: 1e-9,
  relative: 1e-9,
});

function parseRuntimeDirectory(arguments_: readonly string[]): string {
  const values = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (values.length === 0) {
    return resolve(projectRoot, ".artifacts/occt-facade");
  }
  if (
    values.length === 2 &&
    values[0] === "--runtime-dir" &&
    values[1] !== undefined
  ) {
    return resolve(values[1]);
  }
  throw new Error(
    "Usage: tsx scripts/test-public-occt-persistence.ts [--runtime-dir DIRECTORY]",
  );
}

function diagnosticText(result: {
  readonly diagnostics: readonly unknown[];
}): string {
  return JSON.stringify(result.diagnostics);
}

function valueOf<T>(result: CadResult<T>): T {
  assert.equal(result.ok, true, result.ok ? undefined : diagnosticText(result));
  if (!result.ok) throw new Error(diagnosticText(result));
  return result.value;
}

function solidOf(
  evaluated: EvaluatedDesign,
  outputName: string,
): EvaluatedSolid {
  const output = evaluated.output(outputName);
  assert.ok(output instanceof EvaluatedSolid, `${outputName} must be a solid`);
  return output as EvaluatedSolid;
}

function snapshotOf(
  evaluated: EvaluatedDesign,
  outputName: string,
): KernelTopologySnapshot {
  return valueOf(solidOf(evaluated, outputName).topology());
}

function topologyKeys(
  snapshot: KernelTopologySnapshot,
): readonly KernelTopologyKey[] {
  return [
    ...snapshot.faces.map((face) => face.key),
    ...snapshot.edges.map((edge) => edge.key),
    ...snapshot.vertices.map((vertex) => vertex.key),
  ];
}

function assertKeyFree(
  value: unknown,
  forbiddenKeys: readonly KernelTopologyKey[],
  label: string,
): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /"keys?"\s*:/, `${label} exposed a key field`);
  for (const key of forbiddenKeys) {
    assert.equal(serialized.includes(key), false, `${label} leaked ${key}`);
  }
}

function onlyItem<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
  label: string,
): T {
  const matches = values.filter(predicate);
  assert.equal(matches.length, 1, `${label} must identify exactly one item`);
  return matches[0]!;
}

function captureFace(
  snapshot: KernelTopologySnapshot,
  key: KernelTopologyKey,
  capabilities: KernelTopologySignatureCapabilities,
): PersistentTopologyReference<"face"> {
  return valueOf(
    captureTopologyReference(snapshot, "face", key, {
      capabilities,
      tolerance,
    }),
  );
}

function captureEdge(
  snapshot: KernelTopologySnapshot,
  key: KernelTopologyKey,
  capabilities: KernelTopologySignatureCapabilities,
): PersistentTopologyReference<"edge"> {
  return valueOf(
    captureTopologyReference(snapshot, "edge", key, {
      capabilities,
      tolerance,
    }),
  );
}

function captureVertex(
  snapshot: KernelTopologySnapshot,
  key: KernelTopologyKey,
  capabilities: KernelTopologySignatureCapabilities,
): PersistentTopologyReference<"vertex"> {
  return valueOf(
    captureTopologyReference(snapshot, "vertex", key, {
      capabilities,
      tolerance,
    }),
  );
}

function persisted(document: DesignDocument): DesignDocument {
  const serialized = stringifyDocument(document);
  const parsed = valueOf(parseDocument(serialized));
  assert.equal(parsed.version, 6);
  return parsed;
}

function persistedFaceReference(
  document: DesignDocument,
  id: string,
): PersistentTopologyReference<"face"> {
  assert.equal(document.version, 6);
  if (document.version !== 6) {
    throw new Error("Expected a persisted Document v6 topology registry");
  }
  const entry = document.topologyReferences?.[id];
  assert.ok(entry, `Missing persisted topology reference ${id}`);
  assert.equal(entry.topology, "face");
  const reference = entry.variants[0];
  assert.ok(reference, `Missing persisted topology variant ${id}`);
  return reference as PersistentTopologyReference<"face">;
}

function persistedEdgeReference(
  document: DesignDocument,
  id: string,
): PersistentTopologyReference<"edge"> {
  assert.equal(document.version, 6);
  if (document.version !== 6) {
    throw new Error("Expected a persisted Document v6 topology registry");
  }
  const entry = document.topologyReferences?.[id];
  assert.ok(entry, `Missing persisted topology reference ${id}`);
  assert.equal(entry.topology, "edge");
  const reference = entry.variants[0];
  assert.ok(reference, `Missing persisted topology variant ${id}`);
  return reference as PersistentTopologyReference<"edge">;
}

function persistedVertexReference(
  document: DesignDocument,
  id: string,
): PersistentTopologyReference<"vertex"> {
  assert.equal(document.version, 6);
  if (document.version !== 6) {
    throw new Error("Expected a persisted Document v6 topology registry");
  }
  const entry = document.topologyReferences?.[id];
  assert.ok(entry, `Missing persisted topology reference ${id}`);
  assert.equal(entry.topology, "vertex");
  const reference = entry.variants[0];
  assert.ok(reference, `Missing persisted topology variant ${id}`);
  return reference as PersistentTopologyReference<"vertex">;
}

function assertMissingExplanation(
  result: CadResult<unknown>,
  expectedPath?: string,
  forbiddenKeys: readonly KernelTopologyKey[] = [],
): void {
  assert.equal(result.ok, false, "topology reference unexpectedly resolved");
  if (result.ok) return;
  const diagnostic = result.diagnostics.find(
    (item) => item.code === "TOPOLOGY_MATCH_MISSING",
  );
  assert.ok(diagnostic, diagnosticText(result));
  if (expectedPath !== undefined) assert.equal(diagnostic.path, expectedPath);
  const explanation = diagnostic.details?.explanation as
    | Readonly<Record<string, unknown>>
    | undefined;
  assert.ok(explanation, "missing diagnostic did not carry an explanation");
  assert.equal(explanation.outcome, "missing");
  assert.equal(explanation.candidatesMatched, 0);
  assert.equal(Object.isFrozen(explanation), true);
  assertKeyFree(result.diagnostics, forbiddenKeys, "missing diagnostic");
}

async function evaluateWithParametersOrThrow(
  evaluator: Evaluator,
  document: DesignDocument,
  parameters: Readonly<Record<string, number>>,
  outputs: readonly string[],
): Promise<EvaluatedDesign> {
  const result = await evaluator.evaluate(document, { parameters, outputs });
  assert.equal(result.ok, true, result.ok ? undefined : diagnosticText(result));
  if (!result.ok) throw new Error(diagnosticText(result));
  return result.value;
}

async function evaluateOrThrow(
  evaluator: Evaluator,
  document: DesignDocument,
  options: {
    readonly amount: number;
    readonly outputs: readonly string[];
  },
): Promise<EvaluatedDesign> {
  const result = await evaluator.evaluate(document, {
    parameters: { amount: options.amount },
    outputs: options.outputs,
  });
  assert.equal(result.ok, true, result.ok ? undefined : diagnosticText(result));
  if (!result.ok) throw new Error(diagnosticText(result));
  return result.value;
}

async function assertExactTreatmentPersistence(
  operation: EdgeTreatment,
  evaluator: Evaluator,
  capabilities: KernelTopologySignatureCapabilities,
  shapeCount: () => number,
): Promise<void> {
  const baselineShapeCount = shapeCount();
  const generatedRole =
    operation === "fillet"
      ? ("fillet.face.blend" as const)
      : ("chamfer.face.bevel" as const);
  const cad = design(`owned exact ${operation} persistence`);
  const amount = cad.parameter.length("amount", mm(2));
  const box = cad.box(`${operation}-box`, {
    size: vec3(mm(10), mm(20), mm(30)),
  });
  const selectedEdge = topology.edges
    .createdBy(box, { role: "box.edge.x-min-y-min" })
    .exactly(1);
  const treated =
    operation === "fillet"
      ? cad.fillet(`${operation}-treated`, box, {
          edges: selectedEdge,
          radius: amount,
        })
      : cad.chamfer(`${operation}-treated`, box, {
          edges: selectedEdge,
          distance: amount,
        });
  cad.output(`${operation}-treated`, treated);

  const captureRun = await evaluateOrThrow(evaluator, cad.build(), {
    amount: 2,
    outputs: [`${operation}-treated`],
  });
  let inheritedReference: PersistentTopologyReference<"face">;
  let generatedReference: PersistentTopologyReference<"face">;
  let unnamedEdgeReference: PersistentTopologyReference<"edge">;
  let inheritedCaptureKey: KernelTopologyKey;
  let generatedCaptureKey: KernelTopologyKey;
  let unnamedEdgeCaptureKey: KernelTopologyKey;
  let captureKeys: readonly KernelTopologyKey[] = [];
  try {
    const snapshot = snapshotOf(captureRun, `${operation}-treated`);
    captureKeys = topologyKeys(snapshot);
    assert.equal(snapshot.history, "complete");
    const inherited = onlyItem(
      snapshot.faces,
      (face) =>
        face.lineage.some(
          (lineage) =>
            lineage.feature === `${operation}-box` &&
            lineage.relation === "created" &&
            lineage.role === "box.face.x-max",
        ),
      `${operation} inherited x-max face`,
    );
    const generated = onlyItem(
      snapshot.faces,
      (face) =>
        face.lineage.some(
          (lineage) =>
            lineage.feature === `${operation}-treated` &&
            lineage.relation === "created" &&
            lineage.role === generatedRole,
        ),
      `${operation} generated face`,
    );
    const unnamedEdge = onlyItem(
      snapshot.edges,
      (edge) =>
        edge.curve.kind === "line" &&
        Math.abs(Math.abs(edge.curve.direction?.[2] ?? 0) - 1) <=
          tolerance.angular &&
        Math.abs(edge.center[0]) <= tolerance.linear &&
        edge.center[1] > tolerance.linear &&
        edge.lineage.some(
          (lineage) =>
            lineage.feature === `${operation}-treated` &&
            lineage.relation === "created" &&
            lineage.role === undefined &&
            lineage.source === undefined,
        ) &&
        !edge.lineage.some(
          (lineage) =>
            lineage.role !== undefined || lineage.source !== undefined,
        ),
      `${operation} unnamed treatment edge`,
    );
    inheritedCaptureKey = inherited.key;
    generatedCaptureKey = generated.key;
    unnamedEdgeCaptureKey = unnamedEdge.key;
    inheritedReference = captureFace(
      snapshot,
      inherited.key,
      capabilities,
    );
    generatedReference = captureFace(
      snapshot,
      generated.key,
      capabilities,
    );
    unnamedEdgeReference = captureEdge(
      snapshot,
      unnamedEdge.key,
      capabilities,
    );
    assert.equal(inheritedReference.capturedHistory, "complete");
    assert.equal(generatedReference.capturedHistory, "complete");
    assert.equal(unnamedEdgeReference.capturedHistory, "complete");
    assert.equal(
      inheritedReference.lineage.some(
        (lineage) => lineage.role === "box.face.x-max",
      ),
      true,
    );
    assert.equal(
      generatedReference.lineage.some(
        (lineage) =>
          lineage.feature === `${operation}-treated` &&
          lineage.relation === "created" &&
          lineage.role === generatedRole &&
          lineage.source === undefined,
      ),
      true,
    );
    assert.equal(
      unnamedEdgeReference.lineage.some(
        (lineage) =>
          lineage.feature === `${operation}-treated` &&
          lineage.relation === "created" &&
          lineage.role === undefined &&
          lineage.source === undefined,
      ),
      true,
    );
    assert.equal(
      unnamedEdgeReference.lineage.some(
        (lineage) =>
          lineage.role !== undefined || lineage.source !== undefined,
      ),
      false,
    );
    assertKeyFree(
      { inheritedReference, generatedReference, unnamedEdgeReference },
      captureKeys,
      `${operation} detached references`,
    );
  } finally {
    captureRun.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, `${operation} capture cleanup`);

  const inheritedStored = cad.topologyReference(
    `${operation}-inherited-face`,
    treated,
    { topology: "face", variants: [inheritedReference] },
  );
  const generatedStored = cad.topologyReference(
    `${operation}-generated-face`,
    treated,
    { topology: "face", variants: [generatedReference] },
  );
  cad.topologyReference(`${operation}-unnamed-edge`, treated, {
    topology: "edge",
    variants: [unnamedEdgeReference],
  });
  const inheritedShell = cad.shell(`${operation}-inherited-shell`, treated, {
    openings: topology.faces.persistentReference(inheritedStored).select(),
    thickness: mm(0.25),
    direction: "inward",
  });
  const generatedShell = cad.shell(`${operation}-generated-shell`, treated, {
    openings: topology.faces.persistentReference(generatedStored).select(),
    thickness: mm(0.25),
    direction: "inward",
  });
  const roleShell = cad.shell(`${operation}-role-shell`, treated, {
    openings: topology.faces
      .createdBy(treated, { role: generatedRole })
      .exactly(1),
    thickness: mm(0.25),
    direction: "inward",
  });
  cad
    .output(`${operation}-inherited-shell`, inheritedShell)
    .output(`${operation}-generated-shell`, generatedShell)
    .output(`${operation}-role-shell`, roleShell);
  const document = persisted(cad.build());
  const persistedUnnamedEdgeReference = persistedEdgeReference(
    document,
    `${operation}-unnamed-edge`,
  );
  assertKeyFree(document, captureKeys, `${operation} persisted document`);

  const unchanged = await evaluateOrThrow(evaluator, document, {
    amount: 2,
    outputs: [
      `${operation}-treated`,
      `${operation}-inherited-shell`,
      `${operation}-generated-shell`,
      `${operation}-role-shell`,
    ],
  });
  try {
    const snapshot = snapshotOf(unchanged, `${operation}-treated`);
    const inherited = valueOf(
      resolveTopologyReference(inheritedReference, snapshot, { capabilities }),
    );
    const generated = valueOf(
      resolveTopologyReference(generatedReference, snapshot, { capabilities }),
    );
    const unnamedEdge = valueOf(
      resolveTopologyReference(persistedUnnamedEdgeReference, snapshot, {
        capabilities,
      }),
    );
    assert.equal(inherited.evidence, "semantic-lineage");
    assert.equal(generated.evidence, "semantic-lineage");
    assert.equal(unnamedEdge.evidence, "geometry-adjacency");
    assert.notEqual(inherited.key, inheritedCaptureKey);
    assert.notEqual(generated.key, generatedCaptureKey);
    assert.notEqual(unnamedEdge.key, unnamedEdgeCaptureKey);
    assert.ok(
      solidOf(unchanged, `${operation}-inherited-shell`).measure().volume > 0,
    );
    assert.ok(
      solidOf(unchanged, `${operation}-generated-shell`).measure().volume > 0,
    );
    assert.ok(
      solidOf(unchanged, `${operation}-role-shell`).measure().volume > 0,
    );
    assert.equal(
      unchanged.diagnostics.some((item) => item.code.startsWith("TOPOLOGY_")),
      false,
    );
  } finally {
    unchanged.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, `${operation} unchanged cleanup`);

  const changed = await evaluateOrThrow(evaluator, document, {
    amount: 1,
    outputs: [
      `${operation}-treated`,
      `${operation}-inherited-shell`,
      `${operation}-generated-shell`,
      `${operation}-role-shell`,
    ],
  });
  try {
    const snapshot = snapshotOf(changed, `${operation}-treated`);
    const inherited = valueOf(
      resolveTopologyReference(inheritedReference, snapshot, { capabilities }),
    );
    assert.equal(inherited.evidence, "semantic-lineage");
    assert.notEqual(inherited.key, inheritedCaptureKey);
    const generated = valueOf(
      resolveTopologyReference(generatedReference, snapshot, { capabilities }),
    );
    assert.equal(generated.evidence, "semantic-lineage");
    assert.notEqual(generated.key, generatedCaptureKey);
    assertMissingExplanation(
      resolveTopologyReference(persistedUnnamedEdgeReference, snapshot, {
        capabilities,
      }),
      undefined,
      [...captureKeys, ...topologyKeys(snapshot)],
    );
    assert.ok(
      solidOf(changed, `${operation}-inherited-shell`).measure().volume > 0,
    );
    assert.ok(
      solidOf(changed, `${operation}-generated-shell`).measure().volume > 0,
    );
    assert.ok(solidOf(changed, `${operation}-role-shell`).measure().volume > 0);
  } finally {
    changed.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, `${operation} changed cleanup`);

  const recovered = await evaluateOrThrow(evaluator, document, {
    amount: 2,
    outputs: [
      `${operation}-treated`,
      `${operation}-generated-shell`,
      `${operation}-role-shell`,
    ],
  });
  try {
    const snapshot = snapshotOf(recovered, `${operation}-treated`);
    const generated = valueOf(
      resolveTopologyReference(generatedReference, snapshot, { capabilities }),
    );
    const unnamedEdge = valueOf(
      resolveTopologyReference(persistedUnnamedEdgeReference, snapshot, {
        capabilities,
      }),
    );
    assert.equal(generated.evidence, "semantic-lineage");
    assert.equal(unnamedEdge.evidence, "geometry-adjacency");
    assert.notEqual(generated.key, generatedCaptureKey);
    assert.notEqual(unnamedEdge.key, unnamedEdgeCaptureKey);
    assert.equal(
      snapshotOf(recovered, `${operation}-generated-shell`).history,
      "complete",
    );
    assert.equal(
      snapshotOf(recovered, `${operation}-role-shell`).history,
      "complete",
    );
  } finally {
    recovered.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, `${operation} recovery cleanup`);
}

async function assertExactTreatmentRoleAmbiguity(
  operation: EdgeTreatment,
  evaluator: Evaluator,
  capabilities: KernelTopologySignatureCapabilities,
  shapeCount: () => number,
): Promise<void> {
  const baselineShapeCount = shapeCount();
  const generatedRole =
    operation === "fillet"
      ? ("fillet.face.blend" as const)
      : ("chamfer.face.bevel" as const);
  const cad = design(`owned exact ${operation} role ambiguity`);
  const box = cad.box(`${operation}-ambiguity-box`, {
    size: vec3(mm(10), mm(20), mm(30)),
  });
  const firstEdge = topology.edges.createdBy(box, {
    role: "box.edge.x-min-y-min",
  });
  const oppositeEdge = topology.edges.createdBy(box, {
    role: "box.edge.x-max-y-max",
  });
  const selectedEdges = firstEdge.or(oppositeEdge).exactly(2);
  const treated =
    operation === "fillet"
      ? cad.fillet(`${operation}-ambiguity-treated`, box, {
          edges: selectedEdges,
          radius: mm(1),
        })
      : cad.chamfer(`${operation}-ambiguity-treated`, box, {
          edges: selectedEdges,
          distance: mm(1),
        });
  cad.output(`${operation}-ambiguity-treated`, treated);

  const evaluated = await evaluateWithParametersOrThrow(
    evaluator,
    cad.build(),
    {},
    [`${operation}-ambiguity-treated`],
  );
  try {
    const snapshot = snapshotOf(
      evaluated,
      `${operation}-ambiguity-treated`,
    );
    assert.equal(snapshot.history, "complete");
    const generatedFaces = snapshot.faces.filter((face) =>
      face.lineage.some(
        (lineage) =>
          lineage.feature === `${operation}-ambiguity-treated` &&
          lineage.relation === "created" &&
          lineage.role === generatedRole &&
          lineage.source === undefined,
      ),
    );
    assert.equal(
      generatedFaces.length,
      2,
      `${operation} must produce two faces in the same semantic role class`,
    );
    const captured = captureTopologyReference(
      snapshot,
      "face",
      generatedFaces[0]!.key,
      { capabilities, tolerance },
    );
    assert.equal(
      captured.ok,
      false,
      `${operation} multi-face semantic role unexpectedly captured uniquely`,
    );
    if (!captured.ok) {
      const diagnostic = captured.diagnostics.find(
        (item) => item.code === "TOPOLOGY_MATCH_AMBIGUOUS",
      );
      assert.ok(diagnostic, diagnosticText(captured));
      assert.deepEqual(diagnostic.details, {
        topology: "face",
        candidates: 2,
      });
      assertKeyFree(
        captured.diagnostics,
        topologyKeys(snapshot),
        `${operation} ambiguity diagnostic`,
      );
    }
  } finally {
    evaluated.dispose();
  }
  assert.equal(
    shapeCount(),
    baselineShapeCount,
    `${operation} ambiguity cleanup`,
  );
}

async function assertExactBooleanPersistence(
  evaluator: Evaluator,
  capabilities: KernelTopologySignatureCapabilities,
  shapeCount: () => number,
): Promise<void> {
  const baselineShapeCount = shapeCount();
  const cad = design("owned exact boolean persistence");
  const radius = cad.parameter.length("boolean-radius", mm(3));
  const toolX = cad.parameter.length("boolean-tool-x", mm(15));
  const target = cad.box("boolean-target", {
    size: vec3(mm(30), mm(20), mm(10)),
  });
  const toolBase = cad.cylinder("boolean-tool-base", {
    radius,
    height: mm(20),
  });
  const tool = cad.translate(
    "boolean-tool",
    toolBase,
    vec3(toolX, mm(10), mm(-5)),
  );
  const drilled = cad.subtract("boolean-drilled", target, [tool]);
  cad.output("boolean-drilled", drilled);

  const captureRun = await evaluateWithParametersOrThrow(
    evaluator,
    cad.build(),
    { "boolean-radius": 3, "boolean-tool-x": 15 },
    ["boolean-drilled"],
  );
  let reference: PersistentTopologyReference<"face">;
  let captureKey: KernelTopologyKey;
  let captureKeys: readonly KernelTopologyKey[] = [];
  try {
    const snapshot = snapshotOf(captureRun, "boolean-drilled");
    captureKeys = topologyKeys(snapshot);
    assert.equal(snapshot.history, "complete");
    const inherited = onlyItem(
      snapshot.faces,
      (face) =>
        face.lineage.some(
          (lineage) => lineage.role === "cylinder.face.side",
        ),
      "Boolean inherited cylindrical tool face",
    );
    assert.equal(
      inherited.lineage.some(
        (lineage) =>
          lineage.feature === "boolean-drilled" &&
          lineage.relation === "modified",
      ),
      true,
    );
    captureKey = inherited.key;
    reference = captureFace(snapshot, inherited.key, capabilities);
    assert.equal(reference.capturedHistory, "complete");
    assert.equal(reference.lineage.some((item) => item.role === "cylinder.face.side"), true);
    assertKeyFree(reference, captureKeys, "Boolean detached reference");
  } finally {
    captureRun.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "Boolean capture cleanup");

  const stored = cad.topologyReference("boolean-inherited-face", drilled, {
    topology: "face",
    variants: [reference],
  });
  const adjacentCircularEdges = topology.edges
    .adjacentTo(topology.faces.persistentReference(stored).select())
    .and(topology.edges.curve("circle"))
    .exactly(2);
  const consumer = cad.fillet("boolean-face-consumer", drilled, {
    edges: adjacentCircularEdges,
    radius: mm(0.25),
  });
  cad.output("boolean-face-consumer", consumer);
  const document = persisted(cad.build());
  assertKeyFree(document, captureKeys, "Boolean persisted document");

  for (const changedRadius of [1, 2, 5, 8]) {
    const run = await evaluateWithParametersOrThrow(
      evaluator,
      document,
      { "boolean-radius": changedRadius, "boolean-tool-x": 15 },
      ["boolean-drilled", "boolean-face-consumer"],
    );
    try {
      const snapshot = snapshotOf(run, "boolean-drilled");
      assert.equal(snapshot.history, "complete");
      const resolved = valueOf(
        resolveTopologyReference(reference, snapshot, { capabilities }),
      );
      assert.equal(resolved.evidence, "semantic-lineage");
      assert.notEqual(resolved.key, captureKey);
      const current = onlyItem(
        snapshot.faces,
        (face) => face.key === resolved.key,
        `Boolean inherited face at radius ${changedRadius}`,
      );
      assert.equal(
        current.lineage.some(
          (lineage) => lineage.role === "cylinder.face.side",
        ),
        true,
      );
      assert.equal(
        current.lineage.some(
          (lineage) =>
            lineage.feature === "boolean-drilled" &&
            lineage.relation === "modified",
        ),
        true,
      );
      assert.equal(
        snapshotOf(run, "boolean-face-consumer").history,
        "complete",
      );
      assert.ok(solidOf(run, "boolean-face-consumer").measure().volume > 0);
    } finally {
      run.dispose();
    }
    assert.equal(
      shapeCount(),
      baselineShapeCount,
      `Boolean radius ${changedRadius} cleanup`,
    );
  }

  const disappeared = await evaluateWithParametersOrThrow(
    evaluator,
    document,
    { "boolean-radius": 3, "boolean-tool-x": 35 },
    ["boolean-drilled"],
  );
  try {
    const snapshot = snapshotOf(disappeared, "boolean-drilled");
    assert.equal(snapshot.history, "complete");
    assertMissingExplanation(
      resolveTopologyReference(reference, snapshot, { capabilities }),
      undefined,
      captureKeys,
    );
  } finally {
    disappeared.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "Boolean missing cleanup");

  const rejected = await evaluator.evaluate(document, {
    parameters: { "boolean-radius": 3, "boolean-tool-x": 35 },
    outputs: ["boolean-face-consumer"],
  });
  assertMissingExplanation(
    rejected,
    "/nodes/boolean-face-consumer/edges/query/queries/1/selection/query/reference",
    captureKeys,
  );
  assert.equal(
    shapeCount(),
    baselineShapeCount,
    "Boolean downstream failure cleanup",
  );

  const recovered = await evaluateWithParametersOrThrow(
    evaluator,
    document,
    { "boolean-radius": 3, "boolean-tool-x": 15 },
    ["boolean-drilled", "boolean-face-consumer"],
  );
  try {
    const snapshot = snapshotOf(recovered, "boolean-drilled");
    assert.equal(snapshot.history, "complete");
    const resolved = valueOf(
      resolveTopologyReference(reference, snapshot, { capabilities }),
    );
    assert.equal(resolved.evidence, "semantic-lineage");
    assert.notEqual(resolved.key, captureKey);
    assert.equal(snapshotOf(recovered, "boolean-face-consumer").history, "complete");
  } finally {
    recovered.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "Boolean recovery cleanup");
}

async function assertExactShellPersistence(
  evaluator: Evaluator,
  capabilities: KernelTopologySignatureCapabilities,
  shapeCount: () => number,
): Promise<void> {
  const baselineShapeCount = shapeCount();
  const cad = design("owned exact shell persistence");
  const thickness = cad.parameter.length("shell-thickness", mm(1));
  const box = cad.box("shell-box", {
    size: vec3(mm(20), mm(20), mm(10)),
  });
  const shelled = cad.shell("shell-result", box, {
    openings: topology.faces
      .createdBy(box, { role: "box.face.z-max" })
      .exactly(1),
    thickness,
    direction: "inward",
  });
  cad.output("shell-result", shelled);

  const captureRun = await evaluateWithParametersOrThrow(
    evaluator,
    cad.build(),
    { "shell-thickness": 1 },
    ["shell-result"],
  );
  let inheritedReference: PersistentTopologyReference<"face">;
  let generatedReference: PersistentTopologyReference<"face">;
  let inheritedCaptureKey: KernelTopologyKey;
  let generatedCaptureKey: KernelTopologyKey;
  let captureKeys: readonly KernelTopologyKey[] = [];
  try {
    const snapshot = snapshotOf(captureRun, "shell-result");
    captureKeys = topologyKeys(snapshot);
    assert.equal(snapshot.history, "complete");
    const inherited = onlyItem(
      snapshot.faces,
      (face) =>
        face.lineage.some((lineage) => lineage.role === "box.face.z-max"),
      "shell inherited opening rim",
    );
    assert.equal(
      inherited.lineage.some(
        (lineage) =>
          lineage.feature === "shell-result" &&
          lineage.relation === "modified",
      ),
      true,
    );
    const generated = onlyItem(
      snapshot.faces,
      (face) =>
        face.surface.kind === "plane" &&
        face.surface.normal?.[0] === 1 &&
        face.lineage.some(
          (lineage) =>
            lineage.feature === "shell-result" &&
            lineage.relation === "created" &&
            lineage.role === undefined &&
            lineage.source === undefined,
        ) &&
        !face.lineage.some((lineage) => lineage.role !== undefined),
      "shell generated inner +X face",
    );
    inheritedCaptureKey = inherited.key;
    generatedCaptureKey = generated.key;
    inheritedReference = captureFace(snapshot, inherited.key, capabilities);
    generatedReference = captureFace(snapshot, generated.key, capabilities);
    assert.equal(inheritedReference.capturedHistory, "complete");
    assert.equal(generatedReference.capturedHistory, "complete");
    assert.equal(
      generatedReference.lineage.some((lineage) => lineage.role !== undefined),
      false,
    );
    assertKeyFree(
      { inheritedReference, generatedReference },
      captureKeys,
      "shell detached references",
    );
  } finally {
    captureRun.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "shell capture cleanup");

  cad.topologyReference("shell-inherited-face", shelled, {
    topology: "face",
    variants: [inheritedReference],
  });
  cad.topologyReference("shell-generated-face", shelled, {
    topology: "face",
    variants: [generatedReference],
  });
  const document = persisted(cad.build());
  assertKeyFree(document, captureKeys, "shell persisted document");
  const persistedInheritedReference = persistedFaceReference(
    document,
    "shell-inherited-face",
  );
  const persistedGeneratedReference = persistedFaceReference(
    document,
    "shell-generated-face",
  );

  const unchanged = await evaluateWithParametersOrThrow(
    evaluator,
    document,
    { "shell-thickness": 1 },
    ["shell-result"],
  );
  try {
    const snapshot = snapshotOf(unchanged, "shell-result");
    assert.equal(snapshot.history, "complete");
    const inherited = valueOf(
      resolveTopologyReference(persistedInheritedReference, snapshot, {
        capabilities,
      }),
    );
    const generated = valueOf(
      resolveTopologyReference(persistedGeneratedReference, snapshot, {
        capabilities,
      }),
    );
    assert.equal(inherited.evidence, "semantic-lineage");
    assert.equal(generated.evidence, "geometry-adjacency");
    assert.notEqual(inherited.key, inheritedCaptureKey);
    assert.notEqual(generated.key, generatedCaptureKey);
  } finally {
    unchanged.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "shell unchanged cleanup");

  for (const changedThickness of [0.5, 2]) {
    const changed = await evaluateWithParametersOrThrow(
      evaluator,
      document,
      { "shell-thickness": changedThickness },
      ["shell-result"],
    );
    try {
      const snapshot = snapshotOf(changed, "shell-result");
      assert.equal(snapshot.history, "complete");
      const inherited = valueOf(
        resolveTopologyReference(persistedInheritedReference, snapshot, {
          capabilities,
        }),
      );
      assert.equal(inherited.evidence, "semantic-lineage");
      assert.notEqual(inherited.key, inheritedCaptureKey);
      assertMissingExplanation(
        resolveTopologyReference(persistedGeneratedReference, snapshot, {
          capabilities,
        }),
        undefined,
        captureKeys,
      );
    } finally {
      changed.dispose();
    }
    assert.equal(
      shapeCount(),
      baselineShapeCount,
      `shell thickness ${changedThickness} cleanup`,
    );
  }

  const recovered = await evaluateWithParametersOrThrow(
    evaluator,
    document,
    { "shell-thickness": 1 },
    ["shell-result"],
  );
  try {
    const snapshot = snapshotOf(recovered, "shell-result");
    assert.equal(snapshot.history, "complete");
    const inherited = valueOf(
      resolveTopologyReference(persistedInheritedReference, snapshot, {
        capabilities,
      }),
    );
    const generated = valueOf(
      resolveTopologyReference(persistedGeneratedReference, snapshot, {
        capabilities,
      }),
    );
    assert.equal(inherited.evidence, "semantic-lineage");
    assert.equal(generated.evidence, "geometry-adjacency");
    assert.notEqual(inherited.key, inheritedCaptureKey);
    assert.notEqual(generated.key, generatedCaptureKey);
  } finally {
    recovered.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "shell recovery cleanup");
}

async function assertExactDraftPersistence(
  evaluator: Evaluator,
  capabilities: KernelTopologySignatureCapabilities,
  shapeCount: () => number,
): Promise<void> {
  const baselineShapeCount = shapeCount();
  const cad = design("owned exact draft persistence");
  const angle = cad.parameter.angle("draft-angle", deg(5));
  const box = cad.box("draft-box", {
    size: vec3(mm(20), mm(20), mm(10)),
  });
  const drafted = cad.draft("draft-result", box, {
    faces: topology.faces
      .createdBy(box, { role: "box.face.x-min" })
      .exactly(1),
    angle,
    pullDirection: scalarVec3(0, 0, 1),
    neutralPlane: {
      origin: vec3(mm(0), mm(0), mm(0)),
      normal: scalarVec3(0, 0, 1),
    },
  });
  cad.output("draft-result", drafted);

  const degreesToRadians = (value: number): number =>
    (value * Math.PI) / 180;
  const captureRun = await evaluateWithParametersOrThrow(
    evaluator,
    cad.build(),
    { "draft-angle": degreesToRadians(5) },
    ["draft-result"],
  );
  let reference: PersistentTopologyReference<"face">;
  let captureKey: KernelTopologyKey;
  let captureKeys: readonly KernelTopologyKey[] = [];
  try {
    const snapshot = snapshotOf(captureRun, "draft-result");
    captureKeys = topologyKeys(snapshot);
    assert.equal(snapshot.history, "complete");
    const inherited = onlyItem(
      snapshot.faces,
      (face) =>
        face.lineage.some((lineage) => lineage.role === "box.face.x-min"),
      "draft inherited x-min face",
    );
    assert.equal(
      inherited.lineage.some(
        (lineage) =>
          lineage.feature === "draft-result" &&
          lineage.relation === "modified",
      ),
      true,
    );
    captureKey = inherited.key;
    reference = captureFace(snapshot, inherited.key, capabilities);
    assert.equal(reference.capturedHistory, "complete");
    assertKeyFree(reference, captureKeys, "draft detached reference");
  } finally {
    captureRun.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "draft capture cleanup");

  const stored = cad.topologyReference("draft-inherited-face", drafted, {
    topology: "face",
    variants: [reference],
  });
  const consumer = cad.shell("draft-face-consumer", drafted, {
    openings: topology.faces.persistentReference(stored).select(),
    thickness: mm(0.25),
    direction: "inward",
  });
  cad.output("draft-face-consumer", consumer);
  const document = persisted(cad.build());
  assertKeyFree(document, captureKeys, "draft persisted document");

  for (const changedAngle of [2, -3, 8]) {
    const run = await evaluateWithParametersOrThrow(
      evaluator,
      document,
      { "draft-angle": degreesToRadians(changedAngle) },
      ["draft-result", "draft-face-consumer"],
    );
    try {
      const snapshot = snapshotOf(run, "draft-result");
      assert.equal(snapshot.history, "complete");
      const resolved = valueOf(
        resolveTopologyReference(reference, snapshot, { capabilities }),
      );
      assert.equal(resolved.evidence, "semantic-lineage");
      assert.notEqual(resolved.key, captureKey);
      const current = onlyItem(
        snapshot.faces,
        (face) => face.key === resolved.key,
        `draft inherited face at ${changedAngle} degrees`,
      );
      assert.equal(
        current.lineage.some((lineage) => lineage.role === "box.face.x-min"),
        true,
      );
      assert.equal(
        current.lineage.some(
          (lineage) =>
            lineage.feature === "draft-result" &&
            lineage.relation === "modified",
        ),
        true,
      );
      assert.equal(snapshotOf(run, "draft-face-consumer").history, "complete");
      assert.ok(solidOf(run, "draft-face-consumer").measure().volume > 0);
    } finally {
      run.dispose();
    }
    assert.equal(
      shapeCount(),
      baselineShapeCount,
      `draft angle ${changedAngle} cleanup`,
    );
  }

  const recovered = await evaluateWithParametersOrThrow(
    evaluator,
    document,
    { "draft-angle": degreesToRadians(5) },
    ["draft-result", "draft-face-consumer"],
  );
  try {
    const snapshot = snapshotOf(recovered, "draft-result");
    assert.equal(snapshot.history, "complete");
    const resolved = valueOf(
      resolveTopologyReference(reference, snapshot, { capabilities }),
    );
    assert.equal(resolved.evidence, "semantic-lineage");
    assert.notEqual(resolved.key, captureKey);
    assert.equal(snapshotOf(recovered, "draft-face-consumer").history, "complete");
  } finally {
    recovered.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "draft recovery cleanup");
}

async function assertExactOffsetPersistence(
  evaluator: Evaluator,
  capabilities: KernelTopologySignatureCapabilities,
  shapeCount: () => number,
): Promise<void> {
  const baselineShapeCount = shapeCount();
  const cad = design("owned exact offset persistence");
  const distance = cad.parameter.length("offset-distance", mm(1));
  const box = cad.box("offset-box", {
    size: vec3(mm(20), mm(20), mm(10)),
  });
  const offset = cad.offset("offset-result", box, {
    distance,
    direction: "inward",
    tolerance: mm(1e-6),
  });
  cad.output("offset-result", offset);

  const captureRun = await evaluateWithParametersOrThrow(
    evaluator,
    cad.build(),
    { "offset-distance": 1 },
    ["offset-result"],
  );
  let reference: PersistentTopologyReference<"face">;
  let captureKey: KernelTopologyKey;
  let captureKeys: readonly KernelTopologyKey[] = [];
  try {
    const snapshot = snapshotOf(captureRun, "offset-result");
    captureKeys = topologyKeys(snapshot);
    assert.equal(snapshot.history, "complete");
    const generated = onlyItem(
      snapshot.faces,
      (face) =>
        face.surface.kind === "plane" &&
        face.surface.normal?.[2] === 1 &&
        face.lineage.some(
          (lineage) =>
            lineage.feature === "offset-result" &&
            lineage.relation === "created" &&
            lineage.role === undefined &&
            lineage.source === undefined,
        ) &&
        !face.lineage.some((lineage) => lineage.role !== undefined),
      "offset generated +Z face",
    );
    captureKey = generated.key;
    reference = captureFace(snapshot, generated.key, capabilities);
    assert.equal(reference.capturedHistory, "complete");
    assert.equal(reference.lineage.some((lineage) => lineage.role !== undefined), false);
    assert.equal(
      reference.lineage.some(
        (lineage) =>
          lineage.feature === "offset-box" ||
          lineage.role?.startsWith("box.face.") === true,
      ),
      false,
    );
    assertKeyFree(reference, captureKeys, "offset detached reference");
  } finally {
    captureRun.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "offset capture cleanup");

  const stored = cad.topologyReference("offset-generated-face", offset, {
    topology: "face",
    variants: [reference],
  });
  const consumer = cad.shell("offset-face-consumer", offset, {
    openings: topology.faces.persistentReference(stored).select(),
    thickness: mm(0.25),
    direction: "inward",
  });
  cad.output("offset-face-consumer", consumer);
  const document = persisted(cad.build());
  assertKeyFree(document, captureKeys, "offset persisted document");

  const unchanged = await evaluateWithParametersOrThrow(
    evaluator,
    document,
    { "offset-distance": 1 },
    ["offset-result", "offset-face-consumer"],
  );
  try {
    const snapshot = snapshotOf(unchanged, "offset-result");
    assert.equal(snapshot.history, "complete");
    const resolved = valueOf(
      resolveTopologyReference(reference, snapshot, { capabilities }),
    );
    assert.equal(resolved.evidence, "geometry-adjacency");
    assert.notEqual(resolved.key, captureKey);
    assert.equal(snapshotOf(unchanged, "offset-face-consumer").history, "complete");
    assert.ok(solidOf(unchanged, "offset-face-consumer").measure().volume > 0);
  } finally {
    unchanged.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "offset unchanged cleanup");

  const changed = await evaluateWithParametersOrThrow(
    evaluator,
    document,
    { "offset-distance": 2 },
    ["offset-result"],
  );
  try {
    const snapshot = snapshotOf(changed, "offset-result");
    assert.equal(snapshot.history, "complete");
    assertMissingExplanation(
      resolveTopologyReference(reference, snapshot, { capabilities }),
      undefined,
      captureKeys,
    );
  } finally {
    changed.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "offset changed cleanup");

  const rejected = await evaluator.evaluate(document, {
    parameters: { "offset-distance": 2 },
    outputs: ["offset-face-consumer"],
  });
  assertMissingExplanation(
    rejected,
    "/nodes/offset-face-consumer/openings/query/reference",
    captureKeys,
  );
  assert.equal(
    shapeCount(),
    baselineShapeCount,
    "offset downstream failure cleanup",
  );

  const recovered = await evaluateWithParametersOrThrow(
    evaluator,
    document,
    { "offset-distance": 1 },
    ["offset-result", "offset-face-consumer"],
  );
  try {
    const snapshot = snapshotOf(recovered, "offset-result");
    assert.equal(snapshot.history, "complete");
    const resolved = valueOf(
      resolveTopologyReference(reference, snapshot, { capabilities }),
    );
    assert.equal(resolved.evidence, "geometry-adjacency");
    assert.notEqual(resolved.key, captureKey);
    assert.equal(snapshotOf(recovered, "offset-face-consumer").history, "complete");
  } finally {
    recovered.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "offset recovery cleanup");
}

async function assertVertexAndLegacyProfilePersistence(
  evaluator: Evaluator,
  primaryCapabilities: KernelTopologySignatureCapabilities,
  legacyCapabilities: KernelTopologySignatureCapabilities,
  shapeCount: () => number,
): Promise<void> {
  const baselineShapeCount = shapeCount();
  const cad = design("owned vertex and legacy-profile persistence");
  const width = cad.parameter.length("vertex-width", mm(10));
  const depth = cad.parameter.length("vertex-depth", mm(20));
  const height = cad.parameter.length("vertex-height", mm(30));
  const shift = cad.parameter.length("vertex-shift", mm(0));
  const box = cad.box("vertex-box", {
    size: vec3(width, depth, height),
  });
  const moved = cad.translate(
    "vertex-moved",
    box,
    vec3(shift, mm(0), mm(0)),
  );
  cad.output("vertex-moved", moved);

  const captureRun = await evaluateWithParametersOrThrow(
    evaluator,
    cad.build(),
    {
      "vertex-width": 10,
      "vertex-depth": 20,
      "vertex-height": 30,
      "vertex-shift": 0,
    },
    ["vertex-moved"],
  );
  let vertexReference: PersistentTopologyReference<"vertex">;
  let legacyEdgeReference: PersistentTopologyReference<"edge">;
  let vertexCaptureKey: KernelTopologyKey;
  let legacyEdgeCaptureKey: KernelTopologyKey;
  let captureKeys: readonly KernelTopologyKey[] = [];
  try {
    const snapshot = snapshotOf(captureRun, "vertex-moved");
    captureKeys = topologyKeys(snapshot);
    assert.equal(snapshot.history, "complete");
    assert.equal(snapshot.vertices.length, 8);
    assert.equal(snapshot.edges.length, 12);
    assert.equal(
      snapshot.edges.every((edge) => edge.vertices.length === 2),
      true,
    );
    assert.equal(
      snapshot.vertices.every((vertex) => vertex.edges.length === 3),
      true,
    );
    const corner = onlyItem(
      snapshot.vertices,
      (vertex) => vertex.point.every((component) => Math.abs(component) <= tolerance.linear),
      "translated-box origin corner",
    );
    const legacyEdge = onlyItem(
      snapshot.edges,
      (edge) =>
        edge.lineage.some(
          (lineage) => lineage.role === "box.edge.x-min-y-min",
        ),
      "translated-box legacy edge",
    );
    vertexCaptureKey = corner.key;
    legacyEdgeCaptureKey = legacyEdge.key;
    vertexReference = captureVertex(
      snapshot,
      corner.key,
      primaryCapabilities,
    );
    legacyEdgeReference = captureEdge(
      snapshot,
      legacyEdge.key,
      legacyCapabilities,
    );
    assert.equal(vertexReference.protocolVersion, 2);
    assert.equal(legacyEdgeReference.protocolVersion, 1);
    assert.equal(vertexReference.topology, "vertex");
    assert.equal(
      vertexReference.lineage.every((lineage) => lineage.role === undefined),
      true,
    );
    assert.equal(vertexReference.adjacency.length, 3);
    assert.equal(
      vertexReference.adjacency.every(
        (neighbor) =>
          neighbor.topology === "edge" &&
          neighbor.lineage.some((lineage) => lineage.role !== undefined),
      ),
      true,
    );
    assert.equal(
      legacyEdgeReference.adjacency.every(
        (neighbor) => neighbor.topology === "face",
      ),
      true,
    );
    assertKeyFree(
      { vertexReference, legacyEdgeReference },
      captureKeys,
      "vertex and legacy detached references",
    );
  } finally {
    captureRun.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "vertex capture cleanup");

  cad.topologyReference("moved-corner", moved, {
    topology: "vertex",
    variants: [vertexReference],
  });
  cad.topologyReference("legacy-edge", moved, {
    topology: "edge",
    variants: [legacyEdgeReference],
  });
  const document = persisted(cad.build());
  const persistedVertex = persistedVertexReference(document, "moved-corner");
  const persistedLegacyEdge = persistedEdgeReference(document, "legacy-edge");
  assertKeyFree(document, captureKeys, "vertex persistence document");

  const changed = await evaluateWithParametersOrThrow(
    evaluator,
    document,
    {
      "vertex-width": 16,
      "vertex-depth": 11,
      "vertex-height": 24,
      "vertex-shift": 37,
    },
    ["vertex-moved"],
  );
  try {
    const snapshot = snapshotOf(changed, "vertex-moved");
    const resolvedVertex = valueOf(
      resolveTopologyReference(persistedVertex, snapshot, {
        capabilities: primaryCapabilities,
      }),
    );
    const resolvedLegacyEdge = valueOf(
      resolveTopologyReference(persistedLegacyEdge, snapshot, {
        capabilities: legacyCapabilities,
      }),
    );
    assert.equal(resolvedVertex.evidence, "semantic-lineage");
    assert.equal(resolvedLegacyEdge.evidence, "semantic-lineage");
    assert.notEqual(resolvedVertex.key, vertexCaptureKey);
    assert.notEqual(resolvedLegacyEdge.key, legacyEdgeCaptureKey);
    const currentVertex = onlyItem(
      snapshot.vertices,
      (vertex) => vertex.key === resolvedVertex.key,
      "resolved moved corner",
    );
    assert.deepEqual(currentVertex.point, [37, 0, 0]);
    const positioned = resolveTopologySelection(
      topology.vertices.position(vec3(mm(37), mm(0), mm(0))).exactly(1).ir,
      snapshot,
      {
        evaluate: (expression) => {
          if (expression.op !== "literal") {
            throw new Error("Public vertex position fixture expected literals");
          }
          return expression.value;
        },
      },
    );
    assert.deepEqual(valueOf(positioned), [resolvedVertex.key]);
  } finally {
    changed.dispose();
  }
  assert.equal(shapeCount(), baselineShapeCount, "vertex changed cleanup");
}

const runtimeDirectory = parseRuntimeDirectory(process.argv.slice(2));
const gluePath = resolve(runtimeDirectory, "occt-wasm.js");
const wasmPath = resolve(runtimeDirectory, "occt-wasm.wasm");
await Promise.all([access(gluePath), access(wasmPath)]).catch((error) => {
  throw new Error(
    `Owned OCCT facade runtime files are missing under ${runtimeDirectory}`,
    { cause: error },
  );
});

const loaded = (await import(pathToFileURL(gluePath).href)) as {
  readonly default: OcctModuleFactory;
};
const ownedModuleFactory: OcctModuleFactory = async (options) => {
  const module = await loaded.default(options);
  if (typeof module !== "object" || module === null) {
    throw new TypeError("Owned OCCT facade factory returned a non-object module");
  }
  const marker = (module as Record<string, unknown>)
    .invariantcadFacadeVersion;
  assert.equal(typeof marker, "function");
  assert.equal(
    (marker as () => unknown)(),
    "invariantcad-facade@0.7.0+occt-wasm.3.7.0",
  );
  return module;
};

const kernel = await createOcctKernel({
  moduleFactory: ownedModuleFactory,
  wasm: wasmPath,
});
let evaluator: Evaluator | undefined;
try {
  assert.deepEqual(kernel.capabilities.exactIndexedTopologyEvolution, {
    protocolVersion: 1,
    features: [
      "draft",
      "boolean",
      "fillet",
      "chamfer",
      "shell",
      "offset",
    ],
  });
  const capabilities = kernel.capabilities.topology?.signatures;
  assert.ok(capabilities, "owned OCCT signature support was not advertised");
  assert.deepEqual(capabilities, {
    protocolVersion: 2,
    fingerprint:
      "invariantcad-topology-descriptor@6;occt-wasm@3.7.0;" +
      "runtime=invariantcad-facade@0.7.0+occt-wasm.3.7.0;" +
      "modelingTolerance=1e-7",
  });
  const signatureProfiles = kernel.capabilities.topology?.signatureProfiles;
  assert.deepEqual(signatureProfiles, [
    {
      protocolVersion: 1,
      fingerprint:
        "invariantcad-topology-descriptor@5;occt-wasm@3.7.0;" +
        "runtime=invariantcad-facade@0.7.0+occt-wasm.3.7.0;" +
        "modelingTolerance=1e-7",
    },
  ]);
  const legacyCapabilities = signatureProfiles?.[0];
  assert.ok(legacyCapabilities, "owned OCCT legacy signature profile was not advertised");
  const raw = (kernel as unknown as {
    readonly raw: { readonly shapeCount: number };
  }).raw;
  evaluator = await createEvaluator({ kernel });
  await assertVertexAndLegacyProfilePersistence(
    evaluator,
    capabilities,
    legacyCapabilities,
    () => raw.shapeCount,
  );
  await assertExactBooleanPersistence(
    evaluator,
    capabilities,
    () => raw.shapeCount,
  );
  await assertExactShellPersistence(
    evaluator,
    capabilities,
    () => raw.shapeCount,
  );
  await assertExactDraftPersistence(
    evaluator,
    capabilities,
    () => raw.shapeCount,
  );
  await assertExactOffsetPersistence(
    evaluator,
    capabilities,
    () => raw.shapeCount,
  );
  for (const operation of ["fillet", "chamfer"] as const) {
    await assertExactTreatmentPersistence(
      operation,
      evaluator,
      capabilities,
      () => raw.shapeCount,
    );
    await assertExactTreatmentRoleAmbiguity(
      operation,
      evaluator,
      capabilities,
      () => raw.shapeCount,
    );
  }
} finally {
  if (evaluator === undefined) kernel.dispose();
  else evaluator.dispose();
}

console.log("public owned OCCT exact persistence torture passed");
