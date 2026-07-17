import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createEvaluator,
  deg,
  design,
  kernelSupports,
  mm,
  scalarVec3,
  topology,
  vec3,
  type GeometryKernel,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelShape,
  type KernelTopologyLineage,
  type KernelTopologySnapshot,
  type ResolvedCompositePath,
  type ResolvedProfile,
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

function assertDirectDraft(kernel: GeometryKernel): void {
  assert.ok(kernel.capabilities.features.includes("draft"));
  assert.deepEqual(kernel.capabilities.exactIndexedTopologyEvolution, {
    protocolVersion: 1,
    features: ["draft"],
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

async function assertDocumentDraft(kernel: GeometryKernel): Promise<void> {
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

  const evaluator = await createEvaluator({ kernel });
  try {
    const result = await evaluator.evaluate(cad.build());
    if (!result.ok) {
      throw new Error(
        result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
      );
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
  } finally {
    evaluator.dispose();
  }
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
  assertControlledPipeShell(kernel);
  await assertDocumentDraft(kernel);
} finally {
  kernel.dispose();
}

console.log("public OCCT draft and controlled PipeShell smoke passed");
