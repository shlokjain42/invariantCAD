import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createEvaluator,
  deg,
  design,
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
  await assertDocumentDraft(kernel);
} finally {
  kernel.dispose();
}

console.log("public OCCT draft smoke passed");
