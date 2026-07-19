import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createEvaluator,
  deg,
  design,
  evaluateExpression,
  kernelSupports,
  mm,
  resolveTopologySelection,
  scalarVec3,
  tf,
  topology,
  vec3,
  type DesignDocument,
  type EvaluatedDesign,
  type EvaluationOptions,
  type Evaluator,
  type GeometryKernel,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelShape,
  type KernelTopologyLineage,
  type KernelTopologySnapshot,
  type ResolvedCompositePath,
  type ResolvedProfile,
  type TopologyKind,
  type TopologyQuery,
} from "../src/index.js";
import {
  createOcctKernel,
  type OcctModuleFactory,
} from "../src/occt-kernel.js";

type Descriptor = KernelFaceDescriptor | KernelEdgeDescriptor;

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function parseRuntimeDirectory(arguments_: readonly string[]): string {
  if (arguments_.length === 0) {
    return resolve(projectRoot, ".artifacts/occt-facade");
  }
  if (
    arguments_.length === 2 &&
    arguments_[0] === "--runtime-dir" &&
    arguments_[1] !== undefined
  ) {
    return resolve(arguments_[1]);
  }
  throw new Error(
    "Usage: tsx scripts/test-public-occt-draft.ts [--runtime-dir DIRECTORY]",
  );
}

const runtimeDirectory = parseRuntimeDirectory(process.argv.slice(2));
const gluePath = resolve(runtimeDirectory, "occt-wasm.js");
const wasmPath = resolve(runtimeDirectory, "occt-wasm.wasm");

function closeTo(
  actual: number,
  expected: number,
  tolerance: number,
  label: string,
): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function snapshot(
  kernel: GeometryKernel,
  shape: KernelShape,
): KernelTopologySnapshot {
  const readTopology = kernel.topology;
  if (readTopology === undefined) {
    throw new Error("OCCT topology support was not advertised");
  }
  return readTopology.call(kernel, shape);
}

function lineageFor(
  descriptor: Descriptor,
  feature: string,
): readonly KernelTopologyLineage[] {
  return descriptor.lineage.filter((lineage) => lineage.feature === feature);
}

function descriptorWithRole(
  descriptors: readonly Descriptor[],
  feature: string,
  role: string,
): Descriptor {
  const matches = descriptors.filter((descriptor) =>
    descriptor.lineage.some(
      (lineage) => lineage.feature === feature && lineage.role === role,
    ),
  );
  assert.equal(matches.length, 1, `${role} must resolve to exactly one descriptor`);
  return matches[0]!;
}

function selectionError(
  result: { readonly diagnostics: readonly { readonly message: string }[] },
): string {
  return result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
}

function resolveSelectionCount<K extends TopologyKind>(
  query: TopologyQuery<K>,
  topologySnapshot: KernelTopologySnapshot,
  expected: number,
  label: string,
): void {
  const result = resolveTopologySelection(
    query.exactly(expected).ir,
    topologySnapshot,
    {
      evaluate: (expression) =>
        evaluateExpression(expression, {
          resolveParameter: (id) => {
            throw new Error(`Unexpected selector parameter '${id}'`);
          },
        }),
      node: label,
      path: `/selectors/${label}`,
    },
  );
  assert.equal(result.ok, true, result.ok ? undefined : selectionError(result));
  if (result.ok) assert.equal(result.value.length, expected, label);
}

function assertSelectionMissing<K extends TopologyKind>(
  query: TopologyQuery<K>,
  topologySnapshot: KernelTopologySnapshot,
  label: string,
): void {
  const result = resolveTopologySelection(query.select().ir, topologySnapshot, {
    evaluate: (expression) =>
      evaluateExpression(expression, {
        resolveParameter: (id) => {
          throw new Error(`Unexpected selector parameter '${id}'`);
        },
      }),
    node: label,
    path: `/selectors/${label}`,
  });
  assert.equal(result.ok, false, `${label} unexpectedly resolved`);
  if (!result.ok) {
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "TOPOLOGY_SELECTION_MISSING",
      ),
      selectionError(result),
    );
  }
}

function assertExactBooleanShape(
  kernel: GeometryKernel,
  shape: KernelShape,
  expected: {
    readonly volume: number;
    readonly faces: number;
    readonly edges: number;
  },
  label: string,
): KernelTopologySnapshot {
  assert.deepEqual(kernel.status(shape), { ok: true, code: "VALID" });
  closeTo(kernel.measure(shape).volume, expected.volume, 1e-8, `${label}.volume`);
  const output = snapshot(kernel, shape);
  assert.equal(output.history, "complete", `${label}.history`);
  assert.equal(output.faces.length, expected.faces, `${label}.faces`);
  assert.equal(output.edges.length, expected.edges, `${label}.edges`);
  return output;
}

function assertDirectDraft(kernel: GeometryKernel): void {
  assert.ok(kernel.capabilities.features.includes("draft"));
  assert.deepEqual(kernel.capabilities.exactIndexedTopologyEvolution, {
    protocolVersion: 1,
    features: ["draft", "boolean"],
  });
  const draft = kernel.draft;
  if (draft === undefined) {
    throw new Error("Owned OCCT draft support was not advertised");
  }

  let box: KernelShape | undefined;
  let drafted: KernelShape | undefined;
  try {
    box = kernel.box!([20, 20, 10], false, { feature: "direct-box" });
    const input = snapshot(kernel, box);
    assert.equal(input.history, "complete");
    assert.equal(input.faces.length, 6);
    assert.equal(input.edges.length, 12);

    const selected = descriptorWithRole(
      input.faces,
      "direct-box",
      "box.face.x-min",
    );
    drafted = draft.call(
      kernel,
      box,
      [selected.key],
      {
        angle: (5 * Math.PI) / 180,
        pullDirection: [0, 0, 1],
        neutralPlane: { origin: [0, 0, 0], normal: [0, 0, 1] },
      },
      { feature: "direct-draft" },
    );

    assert.deepEqual(kernel.status(drafted), { ok: true, code: "VALID" });
    const measurement = kernel.measure(drafted);
    closeTo(measurement.volume, 3912.5113364740755, 1e-8, "draft volume");
    closeTo(measurement.boundingBox.min[0], 0, 1e-10, "bounds.min.x");
    closeTo(measurement.boundingBox.min[1], 0, 1e-10, "bounds.min.y");
    closeTo(measurement.boundingBox.min[2], 0, 1e-10, "bounds.min.z");
    closeTo(measurement.boundingBox.max[0], 20, 1e-10, "bounds.max.x");
    closeTo(measurement.boundingBox.max[1], 20, 1e-10, "bounds.max.y");
    closeTo(measurement.boundingBox.max[2], 10, 1e-10, "bounds.max.z");
    const mesh = kernel.mesh(drafted);
    assert.ok(mesh.positions.length > 0);
    assert.ok(mesh.indices.length > 0);

    const output = snapshot(kernel, drafted);
    assert.equal(output.history, "complete");
    assert.equal(output.faces.length, 6);
    assert.equal(output.edges.length, 12);

    const faceModificationCounts = output.faces.map(
      (face) =>
        lineageFor(face, "direct-draft").filter(
          (lineage) => lineage.relation === "modified",
        ).length,
    );
    const edgeModificationCounts = output.edges.map(
      (edge) =>
        lineageFor(edge, "direct-draft").filter(
          (lineage) => lineage.relation === "modified",
        ).length,
    );
    assert.equal(faceModificationCounts.filter((count) => count === 1).length, 5);
    assert.equal(faceModificationCounts.filter((count) => count === 0).length, 1);
    assert.equal(edgeModificationCounts.filter((count) => count === 1).length, 8);
    assert.equal(edgeModificationCounts.filter((count) => count === 0).length, 4);
    assert.ok(faceModificationCounts.every((count) => count === 0 || count === 1));
    assert.ok(edgeModificationCounts.every((count) => count === 0 || count === 1));

    const outputDescriptors: readonly Descriptor[] = [
      ...output.faces,
      ...output.edges,
    ];
    for (const descriptor of outputDescriptors) {
      const boxLineage = lineageFor(descriptor, "direct-box");
      assert.ok(boxLineage.some((lineage) => lineage.relation === "created"));
      assert.equal(
        boxLineage.filter((lineage) => lineage.role !== undefined).length,
        1,
      );
    }
    assert.equal(
      lineageFor(
        descriptorWithRole(
          output.faces,
          "direct-box",
          "box.face.x-min",
        ),
        "direct-draft",
      ).filter((lineage) => lineage.relation === "modified").length,
      1,
    );
    assert.equal(
      lineageFor(
        descriptorWithRole(
          output.faces,
          "direct-box",
          "box.face.x-max",
        ),
        "direct-draft",
      ).length,
      0,
    );
  } finally {
    if (drafted !== undefined) kernel.disposeShape(drafted);
    if (box !== undefined) kernel.disposeShape(box);
  }
}

function assertDirectBoolean(kernel: GeometryKernel): void {
  assert.ok(kernel.capabilities.features.includes("boolean"));
  assert.deepEqual(kernel.capabilities.exactIndexedTopologyEvolution, {
    protocolVersion: 1,
    features: ["draft", "boolean"],
  });
  if (
    kernel.boolean === undefined ||
    kernel.transform === undefined ||
    kernel.cylinder === undefined
  ) {
    throw new Error("Owned OCCT exact Boolean support was not advertised");
  }

  const owned: KernelShape[] = [];
  const keep = (shape: KernelShape): KernelShape => {
    owned.push(shape);
    return shape;
  };
  try {
    const unionCad = design("direct exact union");
    const unionTargetRef = unionCad.box("direct-union-target", {
      size: vec3(mm(10), mm(10), mm(10)),
    });
    const unionToolBaseRef = unionCad.box("direct-union-tool-base", {
      size: vec3(mm(10), mm(10), mm(10)),
    });
    const unionToolRef = unionCad.translate(
      "direct-union-tool",
      unionToolBaseRef,
      vec3(mm(5), mm(0), mm(0)),
    );
    const unionRef = unionCad.union("direct-union", unionTargetRef, [
      unionToolRef,
    ]);
    const unionTarget = keep(
      kernel.box!([10, 10, 10], false, { feature: unionTargetRef.node }),
    );
    const unionToolBase = keep(
      kernel.box!([10, 10, 10], false, { feature: unionToolBaseRef.node }),
    );
    const unionTool = keep(
      kernel.transform!(
        unionToolBase,
        [{ kind: "translate", value: [5, 0, 0] }],
        { feature: unionToolRef.node },
      ),
    );
    const union = keep(
      kernel.boolean!("union", unionTarget, [unionTool], {
        feature: unionRef.node,
      }),
    );
    const unionTopology = assertExactBooleanShape(
      kernel,
      union,
      { volume: 1_500, faces: 14, edges: 28 },
      "direct-union",
    );
    const targetTop = topology.faces.createdBy(unionTargetRef, {
      role: "box.face.z-max",
    });
    const toolTop = topology.faces.createdBy(unionToolBaseRef, {
      role: "box.face.z-max",
    });
    resolveSelectionCount(targetTop, unionTopology, 2, "union-target-z-max");
    resolveSelectionCount(toolTop, unionTopology, 2, "union-tool-z-max");
    resolveSelectionCount(
      targetTop.and(toolTop),
      unionTopology,
      1,
      "union-shared-z-max",
    );
    resolveSelectionCount(
      targetTop
        .or(toolTop)
        .and(topology.faces.modifiedBy(unionRef)),
      unionTopology,
      3,
      "union-modified-z-max",
    );

    const subtractCad = design("direct exact subtract");
    const subtractTargetRef = subtractCad.box("direct-subtract-target", {
      size: vec3(mm(20), mm(20), mm(10)),
    });
    const subtractToolBaseRef = subtractCad.cylinder(
      "direct-subtract-tool-base",
      { height: mm(20), radius: mm(3) },
    );
    const subtractToolRef = subtractCad.translate(
      "direct-subtract-tool",
      subtractToolBaseRef,
      vec3(mm(10), mm(10), mm(-5)),
    );
    const subtractRef = subtractCad.subtract(
      "direct-subtract",
      subtractTargetRef,
      [subtractToolRef],
    );
    const subtractTarget = keep(
      kernel.box!([20, 20, 10], false, {
        feature: subtractTargetRef.node,
      }),
    );
    const subtractToolBase = keep(
      kernel.cylinder!(20, 3, 3, false, undefined, {
        feature: subtractToolBaseRef.node,
      }),
    );
    const subtractTool = keep(
      kernel.transform!(
        subtractToolBase,
        [{ kind: "translate", value: [10, 10, -5] }],
        { feature: subtractToolRef.node },
      ),
    );
    const subtraction = keep(
      kernel.boolean!("subtract", subtractTarget, [subtractTool], {
        feature: subtractRef.node,
      }),
    );
    const subtractTopology = assertExactBooleanShape(
      kernel,
      subtraction,
      {
        volume: 4_000 - Math.PI * 3 ** 2 * 10,
        faces: 7,
        edges: 15,
      },
      "direct-subtract",
    );
    resolveSelectionCount(
      topology.faces
        .createdBy(subtractToolBaseRef, { role: "cylinder.face.side" })
        .and(topology.faces.modifiedBy(subtractRef)),
      subtractTopology,
      1,
      "subtract-modified-tool-side",
    );
    resolveSelectionCount(
      topology.edges
        .createdBy(subtractRef)
        .and(topology.edges.curve("circle"), topology.edges.radius(mm(3))),
      subtractTopology,
      2,
      "subtract-created-circular-edges",
    );
    for (const role of [
      "cylinder.face.start-cap",
      "cylinder.face.end-cap",
    ] as const) {
      assertSelectionMissing(
        topology.faces.createdBy(subtractToolBaseRef, { role }),
        subtractTopology,
        `subtract-deleted-${role}`,
      );
    }

    const intersectCad = design("direct exact intersect");
    const intersectTargetRef = intersectCad.box("direct-intersect-target", {
      size: vec3(mm(10), mm(10), mm(10)),
    });
    const intersectToolBaseRef = intersectCad.box(
      "direct-intersect-tool-base",
      { size: vec3(mm(10), mm(10), mm(10)) },
    );
    const intersectToolRef = intersectCad.translate(
      "direct-intersect-tool",
      intersectToolBaseRef,
      vec3(mm(5), mm(0), mm(0)),
    );
    const intersectRef = intersectCad.intersect(
      "direct-intersect",
      intersectTargetRef,
      [intersectToolRef],
    );
    const intersectTarget = keep(
      kernel.box!([10, 10, 10], false, {
        feature: intersectTargetRef.node,
      }),
    );
    const intersectToolBase = keep(
      kernel.box!([10, 10, 10], false, {
        feature: intersectToolBaseRef.node,
      }),
    );
    const intersectTool = keep(
      kernel.transform!(
        intersectToolBase,
        [{ kind: "translate", value: [5, 0, 0] }],
        { feature: intersectToolRef.node },
      ),
    );
    const intersection = keep(
      kernel.boolean!("intersect", intersectTarget, [intersectTool], {
        feature: intersectRef.node,
      }),
    );
    const intersectTopology = assertExactBooleanShape(
      kernel,
      intersection,
      { volume: 500, faces: 6, edges: 12 },
      "direct-intersect",
    );
    const targetYMinimum = topology.faces.createdBy(intersectTargetRef, {
      role: "box.face.y-min",
    });
    const toolYMinimum = topology.faces.createdBy(intersectToolBaseRef, {
      role: "box.face.y-min",
    });
    resolveSelectionCount(
      targetYMinimum,
      intersectTopology,
      1,
      "intersect-target-y-min",
    );
    resolveSelectionCount(
      toolYMinimum,
      intersectTopology,
      1,
      "intersect-tool-y-min",
    );
    resolveSelectionCount(
      targetYMinimum.and(toolYMinimum),
      intersectTopology,
      1,
      "intersect-shared-y-min",
    );
    resolveSelectionCount(
      topology.faces.modifiedBy(intersectRef),
      intersectTopology,
      6,
      "intersect-modified-faces",
    );
    assertSelectionMissing(
      topology.faces.createdBy(intersectTargetRef, {
        role: "box.face.x-min",
      }),
      intersectTopology,
      "intersect-deleted-target-x-min",
    );
    assertSelectionMissing(
      topology.faces.createdBy(intersectToolBaseRef, {
        role: "box.face.x-max",
      }),
      intersectTopology,
      "intersect-deleted-tool-x-max",
    );

    const multiTarget = keep(
      kernel.box!([20, 10, 10], false, { feature: "direct-multi-target" }),
    );
    const multiFirstBase = keep(
      kernel.box!([4, 12, 12], false, {
        feature: "direct-multi-first-base",
      }),
    );
    const multiFirst = keep(
      kernel.transform!(
        multiFirstBase,
        [{ kind: "translate", value: [2, -1, -1] }],
        { feature: "direct-multi-first" },
      ),
    );
    const multiSecondBase = keep(
      kernel.box!([4, 12, 12], false, {
        feature: "direct-multi-second-base",
      }),
    );
    const multiSecond = keep(
      kernel.transform!(
        multiSecondBase,
        [{ kind: "translate", value: [14, -1, -1] }],
        { feature: "direct-multi-second" },
      ),
    );
    const multiSubtract = keep(
      kernel.boolean!("subtract", multiTarget, [multiFirst, multiSecond], {
        feature: "direct-multi-subtract",
      }),
    );
    assertExactBooleanShape(
      kernel,
      multiSubtract,
      { volume: 1_200, faces: 18, edges: 36 },
      "direct-multi-subtract",
    );
  } finally {
    for (const shape of owned.reverse()) kernel.disposeShape(shape);
  }
}

async function assertDocumentDraft(evaluator: Evaluator): Promise<void> {
  const cad = design("public-occt-draft-smoke");
  const box = cad.box("box", { size: vec3(mm(20), mm(20), mm(10)) });
  const first = cad.draft("draft-x-min", box, {
    faces: topology.faces
      .createdBy(box, { role: "box.face.x-min" })
      .exactly(1),
    angle: deg(5),
    pullDirection: scalarVec3(0, 0, 1),
    neutralPlane: {
      origin: vec3(mm(0), mm(0), mm(0)),
      normal: scalarVec3(0, 0, 1),
    },
  });
  const second = cad.draft("draft-y-min", first, {
    faces: topology.faces
      .createdBy(box, { role: "box.face.y-min" })
      .and(topology.faces.modifiedBy(first))
      .exactly(1),
    angle: deg(3),
    pullDirection: scalarVec3(0, 0, 1),
    neutralPlane: {
      origin: vec3(mm(0), mm(0), mm(0)),
      normal: scalarVec3(0, 0, 1),
    },
  });
  cad.output("drafted", second);

  const result = await evaluator.evaluate(cad.build());
  if (!result.ok) {
    throw new Error(selectionError(result));
  }
  try {
    assert.deepEqual(result.value.outputNames, ["drafted"]);
    const measurement = result.value.output("drafted").measure();
    assert.ok(measurement.volume > 0);
    assert.ok(measurement.volume < 20 * 20 * 10);
    assert.ok(measurement.surfaceArea > 0);
    const mesh = result.value.output("drafted").mesh();
    assert.ok(mesh.positions.length > 0);
    assert.ok(mesh.indices.length > 0);
  } finally {
    result.value.dispose();
  }
}

async function assertRepeatedEvaluation(
  evaluator: Evaluator,
  document: DesignDocument,
  label: string,
  inspect: (value: EvaluatedDesign) => void,
  options: EvaluationOptions = {},
): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    const result = await evaluator.evaluate(document, options);
    if (!result.ok) {
      throw new Error(`${label} pass ${pass + 1}: ${selectionError(result)}`);
    }
    try {
      assert.ok(
        result.diagnostics.every(
          (diagnostic) => !diagnostic.code.startsWith("TOPOLOGY_"),
        ),
        `${label} pass ${pass + 1} emitted a topology diagnostic`,
      );
      inspect(result.value);
    } finally {
      result.value.dispose();
    }
  }
}

function unionShellDocument(): DesignDocument {
  const cad = design("public exact union shell");
  const target = cad.box("union-target", {
    size: vec3(mm(10), mm(10), mm(10)),
  });
  const toolBase = cad.box("union-tool-base", {
    size: vec3(mm(10), mm(10), mm(10)),
  });
  const tool = cad.translate(
    "union-tool",
    toolBase,
    vec3(mm(5), mm(0), mm(0)),
  );
  const union = cad.union("union", target, [tool]);
  const targetTop = topology.faces.createdBy(target, {
    role: "box.face.z-max",
  });
  const toolTop = topology.faces.createdBy(toolBase, {
    role: "box.face.z-max",
  });
  const openings = targetTop
    .or(toolTop)
    .and(topology.faces.modifiedBy(union))
    .exactly(3);
  const shell = cad.shell("union-shell", union, {
    openings,
    thickness: mm(1),
    direction: "inward",
  });
  cad.output("union", union).output("shell", shell);
  return cad.build();
}

function subtractFilletDocument(): DesignDocument {
  const cad = design("public exact subtract fillet");
  const target = cad.box("subtract-target", {
    size: vec3(mm(20), mm(20), mm(10)),
  });
  const toolBase = cad.cylinder("subtract-tool-base", {
    height: mm(20),
    radius: mm(3),
  });
  const tool = cad.translate(
    "subtract-tool",
    toolBase,
    vec3(mm(10), mm(10), mm(-5)),
  );
  const subtraction = cad.subtract("subtract", target, [tool]);
  const moved = cad.translate(
    "subtract-moved",
    subtraction,
    vec3(mm(7), mm(-4), mm(2)),
  );
  const circularEdges = topology.edges
    .createdBy(subtraction)
    .and(
      topology.edges.modifiedBy(moved),
      topology.edges.curve("circle"),
      topology.edges.radius(mm(3)),
    )
    .exactly(2);
  const fillet = cad.fillet("subtract-fillet", moved, {
    edges: circularEdges,
    radius: mm(0.5),
  });
  cad.output("subtract", subtraction).output("fillet", fillet);
  return cad.build();
}

function intersectShellDocument(): DesignDocument {
  const cad = design("public exact intersect shell");
  const target = cad.box("intersect-target", {
    size: vec3(mm(10), mm(10), mm(10)),
  });
  const toolBase = cad.box("intersect-tool-base", {
    size: vec3(mm(10), mm(10), mm(10)),
  });
  const tool = cad.translate(
    "intersect-tool",
    toolBase,
    vec3(mm(5), mm(0), mm(0)),
  );
  const intersection = cad.intersect("intersect", target, [tool]);
  const sharedYMinimum = topology.faces
    .createdBy(target, { role: "box.face.y-min" })
    .and(
      topology.faces.createdBy(toolBase, { role: "box.face.y-min" }),
    )
    .exactly(1);
  const shell = cad.shell("intersect-shell", intersection, {
    openings: sharedYMinimum,
    thickness: mm(1),
    direction: "inward",
  });
  cad.output("intersect", intersection).output("shell", shell);
  return cad.build();
}

function multiToolSubtractDocument(): DesignDocument {
  const cad = design("public exact multi-tool subtract");
  const target = cad.box("multi-target", {
    size: vec3(mm(20), mm(10), mm(10)),
  });
  const firstBase = cad.box("multi-first-base", {
    size: vec3(mm(4), mm(12), mm(12)),
  });
  const first = cad.translate(
    "multi-first",
    firstBase,
    vec3(mm(2), mm(-1), mm(-1)),
  );
  const secondBase = cad.box("multi-second-base", {
    size: vec3(mm(4), mm(12), mm(12)),
  });
  const second = cad.translate(
    "multi-second",
    secondBase,
    vec3(mm(14), mm(-1), mm(-1)),
  );
  const subtraction = cad.subtract("multi-subtract", target, [first, second]);
  cad.output("subtract", subtraction);
  return cad.build();
}

function emptyIntersectionDocument(): DesignDocument {
  const cad = design("public exact empty intersection");
  const target = cad.box("empty-target", {
    size: vec3(mm(1), mm(1), mm(1)),
  });
  const toolBase = cad.box("empty-tool-base", {
    size: vec3(mm(1), mm(1), mm(1)),
  });
  const tool = cad.translate(
    "empty-tool",
    toolBase,
    vec3(mm(10), mm(0), mm(0)),
  );
  cad.output("empty", cad.intersect("empty-intersect", target, [tool]));
  return cad.build();
}

async function assertDocumentBoolean(evaluator: Evaluator): Promise<void> {
  await assertRepeatedEvaluation(
    evaluator,
    unionShellDocument(),
    "union-shell",
    (value) => {
      closeTo(value.output("union").measure().volume, 1_500, 1e-8, "union volume");
      closeTo(value.output("shell").measure().volume, 564, 1e-8, "union shell volume");
    },
  );

  await assertRepeatedEvaluation(
    evaluator,
    subtractFilletDocument(),
    "subtract-transform-fillet",
    (value) => {
      closeTo(
        value.output("subtract").measure().volume,
        4_000 - Math.PI * 3 ** 2 * 10,
        1e-8,
        "subtract volume",
      );
      closeTo(
        value.output("fillet").measure().volume,
        3715.158790128106,
        1e-8,
        "subtract fillet volume",
      );
    },
  );

  await assertRepeatedEvaluation(
    evaluator,
    intersectShellDocument(),
    "intersect-shell",
    (value) => {
      closeTo(
        value.output("intersect").measure().volume,
        500,
        1e-8,
        "intersect volume",
      );
      closeTo(
        value.output("shell").measure().volume,
        284,
        1e-8,
        "intersect shell volume",
      );
    },
  );

  await assertRepeatedEvaluation(
    evaluator,
    multiToolSubtractDocument(),
    "multi-tool-subtract",
    (value) => {
      closeTo(
        value.output("subtract").measure().volume,
        1_200,
        1e-8,
        "multi-tool subtract volume",
      );
    },
  );

  const emptyDocument = emptyIntersectionDocument();
  const rejected = await evaluator.evaluate(emptyDocument);
  assert.equal(rejected.ok, false, "empty intersection must fail by default");
  assert.ok(
    rejected.diagnostics.some(
      (diagnostic) => diagnostic.code === "EMPTY_RESULT",
    ),
    selectionError(rejected),
  );
  assert.ok(
    rejected.diagnostics.every(
      (diagnostic) => diagnostic.code !== "KERNEL_ERROR",
    ),
    "empty intersection must not be reported as a kernel failure",
  );

  await assertRepeatedEvaluation(
    evaluator,
    emptyDocument,
    "allow-empty-intersection",
    (value) => {
      const measurement = value.output("empty").measure();
      assert.equal(measurement.volume, 0);
      assert.equal(measurement.surfaceArea, 0);
      assert.equal(measurement.centerOfMass, null);
      assert.deepEqual(measurement.boundingBox, {
        min: [0, 0, 0],
        max: [0, 0, 0],
      });
      assert.equal(measurement.genus, 0);
    },
    { allowEmpty: true },
  );
}

function rectangleProfile(
  offset: number,
  size: number,
  plane: ResolvedProfile["plane"]["plane"] = "XY",
): ResolvedProfile {
  const minimum = offset - size / 2;
  const maximum = offset + size / 2;
  const half = size / 2;
  return {
    plane: { plane, origin: [0, 0, 0] },
    outer: {
      curves: [
        { kind: "line", start: [minimum, -half], end: [maximum, -half] },
        { kind: "line", start: [maximum, -half], end: [maximum, half] },
        { kind: "line", start: [maximum, half], end: [minimum, half] },
        { kind: "line", start: [minimum, half], end: [minimum, -half] },
      ],
    },
    holes: [],
  };
}

function assertControlledPipeShell(kernel: GeometryKernel): void {
  for (const refinement of [
    "major-multiple-arcs",
    "major-eccentric-profile",
  ] as const) {
    assert.equal(
      kernelSupports(
        kernel.capabilities,
        "compositeSweepRefinement",
        refinement,
      ),
      true,
      `owned facade must advertise ${refinement}`,
    );
  }
  const sweep = kernel.compositeSweep;
  if (sweep === undefined) {
    throw new Error("Owned OCCT composite sweep support was not advertised");
  }
  const options = {
    transition: "right-corner",
    frame: "corrected-frenet",
  } as const;
  const multiMajorPath: ResolvedCompositePath = {
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
        through: [
          10 - 10 / Math.sqrt(2),
          10 - 10 / Math.sqrt(2),
          -10,
        ],
        end: [0, 10, -10],
      },
    ],
    closed: false,
  };
  const eccentricMajorPath: ResolvedCompositePath = {
    kind: "composite",
    start: [0, 0, 0],
    segments: [
      { kind: "line", end: [0, 0, 3] },
      {
        kind: "circularArc",
        through: [20, 0, 3],
        end: [10, 0, -7],
      },
      { kind: "line", end: [7, 0, -7] },
    ],
    closed: false,
  };
  const nearFullRadius = 5;
  const nearFullSweep = Math.PI * 2 - 0.05;
  const tilt = Math.PI / 1_800;
  const nearFullPoint = (angle: number): readonly [number, number, number] => [
    nearFullRadius * Math.sin(angle),
    nearFullRadius * Math.cos(tilt) * (1 - Math.cos(angle)),
    nearFullRadius * Math.sin(tilt) * (1 - Math.cos(angle)),
  ];
  const nearFullEnd = nearFullPoint(nearFullSweep);
  const nearFullTangent: readonly [number, number, number] = [
    Math.cos(nearFullSweep),
    Math.cos(tilt) * Math.sin(nearFullSweep),
    Math.sin(tilt) * Math.sin(nearFullSweep),
  ];
  const conditionedNearFullPath: ResolvedCompositePath = {
    kind: "composite",
    start: nearFullPoint(0),
    segments: [
      {
        kind: "circularArc",
        through: nearFullPoint(nearFullSweep / 2),
        end: nearFullEnd,
      },
      {
        kind: "line",
        end: [
          nearFullEnd[0] + nearFullTangent[0] * 0.1,
          nearFullEnd[1] + nearFullTangent[1] * 0.1,
          nearFullEnd[2] + nearFullTangent[2] * 0.1,
        ],
      },
    ],
    closed: false,
  };

  for (const fixture of [
    {
      name: "multi-major",
      profile: rectangleProfile(0, 1),
      path: multiMajorPath,
      volume: 20 * Math.PI,
      faces: 10,
    },
    {
      name: "eccentric-major",
      profile: rectangleProfile(1, 1),
      path: eccentricMajorPath,
      volume: 6 + 13.5 * Math.PI,
      faces: 14,
    },
    {
      name: "conditioned-near-full",
      profile: rectangleProfile(0, 0.01, "YZ"),
      path: conditionedNearFullPath,
      volume: 0.0001 * (nearFullRadius * nearFullSweep + 0.1),
      faces: 10,
    },
  ] as const) {
    const shape = sweep.call(kernel, fixture.profile, fixture.path, options, {
      feature: `owned-${fixture.name}`,
      tolerance: 1e-7,
    });
    try {
      assert.deepEqual(kernel.status(shape), { ok: true, code: "VALID" });
      closeTo(
        kernel.measure(shape).volume,
        fixture.volume,
        1e-10,
        `${fixture.name} volume`,
      );
      const output = snapshot(kernel, shape);
      assert.equal(output.history, "complete");
      assert.equal(output.faces.length, fixture.faces);
      assert.ok(output.edges.every((edge) => edge.faces.length === 2));
    } finally {
      kernel.disposeShape(shape);
    }
  }
}

await Promise.all([access(gluePath), access(wasmPath)]).catch((error) => {
  throw new Error(
    `Owned OCCT facade runtime files are missing under ${runtimeDirectory}`,
    { cause: error },
  );
});

const loaded = (await import(pathToFileURL(gluePath).href)) as {
  readonly default: OcctModuleFactory;
};
const kernel = await createOcctKernel({
  moduleFactory: loaded.default,
  wasm: wasmPath,
});
try {
  assertDirectDraft(kernel);
  assertDirectBoolean(kernel);
  assertControlledPipeShell(kernel);
  const evaluator = await createEvaluator({ kernel });
  try {
    await assertDocumentDraft(evaluator);
    await assertDocumentBoolean(evaluator);
  } finally {
    evaluator.dispose();
  }
} finally {
  kernel.dispose();
}

console.log("public owned OCCT facade acceptance smoke passed");
