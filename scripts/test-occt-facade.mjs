import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_FACADE_VERSION = "invariantcad-facade@0.3.0+occt-wasm.3.7.0";
const EXPECTED_TOPOLOGY_HISTORY_VERSION = 1;
const LINEAR_TOLERANCE = 1e-10;
const VOLUME_TOLERANCE = 1e-8;
const SELECTION_TOLERANCE = 1e-8;

const fixtures = {
  singleWall: {
    volume: 3912.5113364740755,
    bounds: {
      xmin: 0,
      ymin: 0,
      zmin: 0,
      xmax: 20,
      ymax: 20,
      zmax: 10,
    },
  },
  fourWalls: {
    volume: 3829.4876615913895,
    bounds: {
      xmin: -0.2187216588148098,
      ymin: -0.2187216588148098,
      zmin: 0,
      xmax: 20.218721658814808,
      ymax: 20.218721658814808,
      zmax: 10,
    },
  },
  yzNeutralPlane: {
    volume: 3890.5293820111506,
    bounds: {
      xmin: -2.220446049250313e-16,
      ymin: -0.20978043583053088,
      zmin: -0.20978043583053088,
      xmax: 10,
      ymax: 20.20978043583053,
      zmax: 20.20978043583053,
    },
  },
  obliqueNeutralPlane: {
    volume: 3841.914228170569,
  },
};

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const facadeDirectory = join(projectRoot, ".artifacts", "occt-facade");
const gluePath = join(facadeDirectory, "occt-wasm.js");
const wasmPath = join(facadeDirectory, "occt-wasm.wasm");
const createOcctWasm = (await import(pathToFileURL(gluePath).href)).default;
const Module = await createOcctWasm({
  locateFile: (path) => (path.endsWith(".wasm") ? wasmPath : path),
});

assert.equal(Module.invariantcadFacadeVersion(), EXPECTED_FACADE_VERSION);
assert.equal(typeof Module.InvariantCadPipeShellReport, "function");
assert.equal(typeof Module.invariantcadPipeShellSolid, "function");

const topologyKinds = Object.freeze({
  none: Module.InvariantCadTopologyKind.NONE,
  face: Module.InvariantCadTopologyKind.FACE,
  edge: Module.InvariantCadTopologyKind.EDGE,
  vertex: Module.InvariantCadTopologyKind.VERTEX,
});
const topologyRelations = Object.freeze({
  preserved: Module.InvariantCadTopologyRelation.PRESERVED,
  modified: Module.InvariantCadTopologyRelation.MODIFIED,
  generated: Module.InvariantCadTopologyRelation.GENERATED,
  deleted: Module.InvariantCadTopologyRelation.DELETED,
  created: Module.InvariantCadTopologyRelation.CREATED,
});

assert.deepEqual(topologyKinds, { none: -1, face: 0, edge: 1, vertex: 2 });
assert.deepEqual(topologyRelations, {
  preserved: 0,
  modified: 1,
  generated: 2,
  deleted: 3,
  created: 4,
});

const radians = (degrees) => (degrees * Math.PI) / 180;
const near = (actual, expected, tolerance = SELECTION_TOLERANCE) =>
  Math.abs(actual - expected) <= tolerance;

function assertClose(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function vector(ids) {
  const value = new Module.VectorUint32();
  for (const id of ids) value.push_back(id);
  return value;
}

function addVectors(...vectors) {
  return vectors.reduce(
    (sum, value) => [
      sum[0] + value[0],
      sum[1] + value[1],
      sum[2] + value[2],
    ],
    [0, 0, 0],
  );
}

function scaleVector(value, factor) {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function lineEdge(start, end) {
  return kernel.makeLineEdge(...start, ...end);
}

function arcEdge(start, through, end) {
  return kernel.makeArcEdge(...start, ...through, ...end);
}

function wireFromEdges(edges) {
  const ids = vector(edges);
  try {
    return kernel.makeWire(ids);
  } finally {
    ids.delete();
  }
}

function rectangleWire(center, u, v, width, height) {
  const corners = [
    addVectors(center, scaleVector(u, -width / 2), scaleVector(v, -height / 2)),
    addVectors(center, scaleVector(u, width / 2), scaleVector(v, -height / 2)),
    addVectors(center, scaleVector(u, width / 2), scaleVector(v, height / 2)),
    addVectors(center, scaleVector(u, -width / 2), scaleVector(v, height / 2)),
  ];
  return wireFromEdges(
    corners.map((start, index) =>
      lineEdge(start, corners[(index + 1) % corners.length]),
    ),
  );
}

function controlledPipeShell(
  profileWire,
  spineWire,
  tolerance3d = 1e-7,
  boundaryTolerance = 1e-7,
  angularTolerance = 1e-9,
) {
  return Module.invariantcadPipeShellSolid(
    kernel,
    profileWire,
    spineWire,
    tolerance3d,
    boundaryTolerance,
    angularTolerance,
  );
}

function assertControlledPipeShellSuccess(
  report,
  arenaBefore,
  expectedVolume,
  expectedTopology,
  label,
) {
  assert.equal(report.ok, true, `${report.code}: ${report.message}`);
  assert.equal(report.stage, "complete");
  assert.equal(report.code, "OK");
  assert.equal(report.occtStatus, 0);
  assert.ok(Number.isFinite(report.errorOnSurface));
  assert.ok(report.errorOnSurface >= 0);
  assert.ok(report.errorOnSurface <= 1e-7);
  assert.equal(report.tolerance3d, 1e-7);
  assert.equal(report.boundaryTolerance, 1e-7);
  assert.equal(report.angularTolerance, 1e-9);
  assert.equal(report.buildCount, 1);
  assert.equal(report.solidificationCount, 1);
  assert.equal(report.hasResult(), true);
  assert.equal(report.transferCode(kernel), "READY");
  assert.equal(
    kernel.getShapeCount(),
    arenaBefore,
    `${label}: report-owned result entered the arena before transfer`,
  );

  for (const property of [
    "ok",
    "stage",
    "code",
    "message",
    "occtStatus",
    "errorOnSurface",
    "tolerance3d",
    "boundaryTolerance",
    "angularTolerance",
    "buildCount",
    "solidificationCount",
  ]) {
    const value = report[property];
    assert.throws(
      () => {
        report[property] = value;
      },
      /read-only property/i,
      `${label}.${property} must be read-only`,
    );
  }

  const result = report.takeResultId(kernel);
  assert.equal(report.hasResult(), false);
  assert.equal(report.transferCode(kernel), "ALREADY_TRANSFERRED");
  assert.equal(kernel.getShapeCount(), arenaBefore + 1);
  assert.equal(kernel.getShapeType(result), "solid");
  assert.equal(kernel.isValid(result), true);
  assertClose(kernel.getVolume(result), expectedVolume, VOLUME_TOLERANCE, `${label}.volume`);
  assert.deepEqual(
    {
      faces: kernel.subShapeCount(result, "face"),
      edges: kernel.subShapeCount(result, "edge"),
      vertices: kernel.subShapeCount(result, "vertex"),
    },
    expectedTopology,
    `${label}.topology`,
  );
  assert.throws(
    () => report.takeResultId(kernel),
    `${label}: the result must transfer exactly once`,
  );
  return result;
}

function drainVector(value) {
  try {
    const result = [];
    for (let index = 0; index < value.size(); index += 1) {
      result.push(value.get(index));
    }
    return result;
  } finally {
    value.delete();
  }
}

let kernel;

function facesOf(shape) {
  return drainVector(kernel.getSubShapes(shape, "face"));
}

function boundsOf(shape) {
  const bounds = kernel.getBoundingBox(shape);
  return {
    xmin: bounds.xmin,
    ymin: bounds.ymin,
    zmin: bounds.zmin,
    xmax: bounds.xmax,
    ymax: bounds.ymax,
    zmax: bounds.zmax,
  };
}

function extent(bounds, axis) {
  return bounds[`${axis}max`] - bounds[`${axis}min`];
}

function onlyFace(shape, label, predicate) {
  const matches = facesOf(shape).filter((face) => predicate(boundsOf(face)));
  assert.equal(matches.length, 1, `${label}: expected exactly one geometric match`);
  return matches[0];
}

function faceOnPlane(shape, axis, coordinate) {
  return onlyFace(shape, `${axis}=${coordinate} face`, (bounds) =>
    near(bounds[`${axis}min`], coordinate) &&
    near(bounds[`${axis}max`], coordinate),
  );
}

function facesSpanning(shape, axis, length) {
  const matches = facesOf(shape).filter(
    (face) => extent(boundsOf(face), axis) > length * 0.99,
  );
  assert.equal(matches.length, 4, `expected four faces spanning ${axis}`);
  return matches;
}

function sphericalFace(shape, radius) {
  return onlyFace(shape, "spherical face", (bounds) =>
    ["x", "y", "z"].every(
      (axis) => extent(bounds, axis) > radius * 1.99,
    ),
  );
}

function draft(shape, faceIds, angle, pull, neutralOrigin, neutralNormal) {
  const ids = vector(faceIds);
  try {
    return Module.invariantcadDraftFacesAtomic(
      kernel,
      shape,
      ids,
      angle,
      pull[0],
      pull[1],
      pull[2],
      neutralOrigin[0],
      neutralOrigin[1],
      neutralOrigin[2],
      neutralNormal[0],
      neutralNormal[1],
      neutralNormal[2],
    );
  } finally {
    ids.delete();
  }
}

function withReport(report, action) {
  try {
    return action(report);
  } finally {
    report.delete();
  }
}

function assertBounds(actual, expected, label) {
  for (const key of ["xmin", "ymin", "zmin", "xmax", "ymax", "zmax"]) {
    assertClose(
      actual[key],
      expected[key],
      LINEAR_TOLERANCE,
      `${label}.${key}`,
    );
  }
}

function assertSolidFixture(shape, expected, label) {
  assert.equal(kernel.getShapeType(shape), "solid", `${label}.shapeType`);
  assert.equal(kernel.isValid(shape), true, `${label}.valid`);
  assertClose(
    kernel.getVolume(shape),
    expected.volume,
    VOLUME_TOLERANCE,
    `${label}.volume`,
  );
  assertBounds(boundsOf(shape), expected.bounds, `${label}.bounds`);
  assert.deepEqual(
    {
      faces: kernel.subShapeCount(shape, "face"),
      edges: kernel.subShapeCount(shape, "edge"),
      vertices: kernel.subShapeCount(shape, "vertex"),
    },
    { faces: 6, edges: 12, vertices: 8 },
    `${label}.topology`,
  );
}

function topologyCounts(value) {
  return {
    faces: value.faces,
    edges: value.edges,
    vertices: value.vertices,
  };
}

function topologyRecord(value) {
  return {
    sourceShapeIndex: value.sourceShapeIndex,
    sourceKind: value.sourceKind,
    sourceIndex: value.sourceIndex,
    relation: value.relation,
    resultKind: value.resultKind,
    resultIndex: value.resultIndex,
  };
}

function readTopologyHistory(report) {
  const records = [];
  for (let index = 0; index < report.topologyRecordCount(); index += 1) {
    records.push(topologyRecord(report.topologyRecord(index)));
  }
  return {
    version: report.topologyHistoryVersion(),
    complete: report.topologyHistoryComplete(),
    inputShapeCount: report.topologyInputShapeCount(),
    inputCounts: topologyCounts(report.topologyInputCounts(0)),
    resultCounts: topologyCounts(report.topologyResultCounts()),
    records,
  };
}

function expectedDraftRecords(modifiedIndices) {
  const kinds = [
    [topologyKinds.face, 6, new Set(modifiedIndices.faces)],
    [topologyKinds.edge, 12, new Set(modifiedIndices.edges)],
    [topologyKinds.vertex, 8, new Set(modifiedIndices.vertices)],
  ];
  return kinds.flatMap(([kind, count, modified]) =>
    Array.from({ length: count }, (_, index) => ({
      sourceShapeIndex: 0,
      sourceKind: kind,
      sourceIndex: index,
      relation: modified.has(index)
        ? topologyRelations.modified
        : topologyRelations.preserved,
      resultKind: kind,
      resultIndex: index,
    })),
  );
}

function assertDraftHistory(report, modifiedIndices, label) {
  const history = readTopologyHistory(report);
  assert.deepEqual(
    history,
    {
      version: EXPECTED_TOPOLOGY_HISTORY_VERSION,
      complete: true,
      inputShapeCount: 1,
      inputCounts: { faces: 6, edges: 12, vertices: 8 },
      resultCounts: { faces: 6, edges: 12, vertices: 8 },
      records: expectedDraftRecords(modifiedIndices),
    },
    `${label}.history`,
  );
  assert.throws(
    () => report.topologyInputCounts(-1),
    `${label}: negative input history index must fail`,
  );
  assert.throws(
    () => report.topologyInputCounts(1),
    `${label}: out-of-range input history index must fail`,
  );
  assert.throws(
    () => report.topologyRecord(-1),
    `${label}: negative history record index must fail`,
  );
  assert.throws(
    () => report.topologyRecord(history.records.length),
    `${label}: out-of-range history record index must fail`,
  );
  return history;
}

function assertNoTopologyHistory(report, label) {
  assert.equal(report.topologyHistoryVersion(), 0, `${label}.historyVersion`);
  assert.equal(report.topologyHistoryComplete(), false, `${label}.historyComplete`);
  assert.equal(report.topologyInputShapeCount(), 0, `${label}.historyInputCount`);
  assert.equal(report.topologyRecordCount(), 0, `${label}.historyRecordCount`);
  assert.throws(
    () => report.topologyInputCounts(0),
    `${label}: failed reports must not expose input topology counts`,
  );
  assert.throws(
    () => report.topologyResultCounts(),
    `${label}: failed reports must not expose result topology counts`,
  );
  assert.throws(
    () => report.topologyRecord(0),
    `${label}: failed reports must not expose topology records`,
  );
}

const singleWallModifiedIndices = Object.freeze({
  faces: [0, 2, 3, 4, 5],
  edges: [0, 1, 2, 3, 8, 9, 10, 11],
  vertices: [0, 1, 2, 3],
});
const allModifiedIndices = Object.freeze({
  faces: [0, 1, 2, 3, 4, 5],
  edges: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  vertices: [0, 1, 2, 3, 4, 5, 6, 7],
});

function runFixture(label, action) {
  assert.equal(kernel.getShapeCount(), 0, `${label}: dirty arena before fixture`);
  try {
    action();
  } finally {
    kernel.releaseAll();
    assert.equal(kernel.getShapeCount(), 0, `${label}: arena was not cleaned`);
  }
}

try {
  kernel = new Module.OcctKernel();

  runFixture("controlled PipeShell validation", () => {
    const invalidTolerance = controlledPipeShell(0, 0, 0, 1e-7, 1e-9);
    withReport(invalidTolerance, (report) => {
      assert.equal(report.ok, false);
      assert.equal(report.stage, "validation");
      assert.equal(report.code, "INVALID_TOLERANCE");
      assert.equal(report.tolerance3d, 0);
      assert.equal(report.boundaryTolerance, 1e-7);
      assert.equal(report.angularTolerance, 1e-9);
      assert.equal(report.buildCount, 0);
      assert.equal(report.solidificationCount, 0);
      assert.equal(report.errorOnSurface, -1);
      assert.equal(report.hasResult(), false);
      assert.equal(report.transferCode(kernel), "NO_RESULT");
      assert.throws(() => report.takeResultId(kernel));
    });

    const edge = lineEdge([0, 0, 0], [0, 0, 1]);
    const spine = wireFromEdges([lineEdge([0, 0, 0], [0, 0, 2])]);
    const invalidProfile = controlledPipeShell(edge, spine);
    withReport(invalidProfile, (report) => {
      assert.equal(report.ok, false);
      assert.equal(report.stage, "input-validation");
      assert.equal(report.code, "PROFILE_NOT_WIRE");
      assert.equal(report.buildCount, 0);
      assert.equal(report.solidificationCount, 0);
      assert.equal(report.hasResult(), false);
    });
  });

  runFixture("controlled untaken PipeShell cleanup", () => {
    const profile = rectangleWire(
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      1,
      1,
    );
    const spine = wireFromEdges([lineEdge([0, 0, 0], [0, 0, 2])]);
    const arenaBefore = kernel.getShapeCount();
    for (let iteration = 0; iteration < 3; iteration += 1) {
      withReport(controlledPipeShell(profile, spine), (report) => {
        assert.equal(report.ok, true, `${report.code}: ${report.message}`);
        assert.equal(report.hasResult(), true);
        assert.equal(report.transferCode(kernel), "READY");
        assert.equal(kernel.getShapeCount(), arenaBefore);
      });
      assert.equal(
        kernel.getShapeCount(),
        arenaBefore,
        "deleting an untaken report must not enter or retain an arena result",
      );
    }
  });

  runFixture("controlled open-profile solidification failure", () => {
    const profile = wireFromEdges([
      lineEdge([-1, 0, 0], [1, 0, 0]),
    ]);
    const spine = wireFromEdges([lineEdge([0, 0, 0], [0, 0, 2])]);
    const arenaBefore = kernel.getShapeCount();
    withReport(controlledPipeShell(profile, spine), (report) => {
      assert.equal(report.ok, false);
      assert.equal(report.stage, "solid");
      assert.equal(report.code, "SOLID_FAILED");
      assert.equal(report.buildCount, 1);
      assert.equal(report.solidificationCount, 1);
      assert.ok(Number.isFinite(report.errorOnSurface));
      assert.ok(report.errorOnSurface >= 0);
      assert.equal(report.hasResult(), false);
      assert.equal(report.transferCode(kernel), "NO_RESULT");
      assert.equal(kernel.getShapeCount(), arenaBefore);
      assert.throws(() => report.takeResultId(kernel));
    });
  });

  runFixture("controlled multi-major PipeShell", () => {
    const profile = rectangleWire(
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      1,
      1,
    );
    const firstEnd = [10, 0, -10];
    const spine = wireFromEdges([
      arcEdge([0, 0, 0], [20, 0, 0], firstEnd),
      arcEdge(
        firstEnd,
        [10 - 10 / Math.sqrt(2), 10 - 10 / Math.sqrt(2), -10],
        [0, 10, -10],
      ),
    ]);
    const arenaBefore = kernel.getShapeCount();
    const report = controlledPipeShell(profile, spine);
    withReport(report, (ownedReport) => {
      const clone = ownedReport.clone();
      try {
        const otherKernel = new Module.OcctKernel();
        try {
          assert.equal(clone.transferCode(otherKernel), "WRONG_KERNEL");
          assert.throws(() => clone.takeResultId(otherKernel));
          assert.equal(otherKernel.getShapeCount(), 0);
        } finally {
          otherKernel.delete();
        }
        const result = assertControlledPipeShellSuccess(
          clone,
          arenaBefore,
          20 * Math.PI,
          { faces: 10, edges: 20, vertices: 12 },
          "multiMajor",
        );
        try {
          assert.equal(ownedReport.hasResult(), false);
          assert.equal(ownedReport.transferCode(kernel), "ALREADY_TRANSFERRED");
        } finally {
          kernel.release(result);
        }
      } finally {
        clone.delete();
      }
      assert.equal(kernel.getShapeCount(), arenaBefore);
    });
  });

  runFixture("controlled eccentric-major PipeShell", () => {
    const profile = rectangleWire(
      [1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      1,
      1,
    );
    const spine = wireFromEdges([
      lineEdge([0, 0, 0], [0, 0, 3]),
      arcEdge([0, 0, 3], [20, 0, 3], [10, 0, -7]),
      lineEdge([10, 0, -7], [7, 0, -7]),
    ]);
    const arenaBefore = kernel.getShapeCount();
    withReport(controlledPipeShell(profile, spine), (report) => {
      const result = assertControlledPipeShellSuccess(
        report,
        arenaBefore,
        6 + 13.5 * Math.PI,
        { faces: 14, edges: 28, vertices: 16 },
        "eccentricMajor",
      );
      kernel.release(result);
    });
  });

  runFixture("controlled conditioned near-full PipeShell", () => {
    const radius = 5;
    const sweep = Math.PI * 2 - 0.05;
    const tilt = Math.PI / 1_800;
    const point = (angle) => [
      radius * Math.sin(angle),
      radius * Math.cos(tilt) * (1 - Math.cos(angle)),
      radius * Math.sin(tilt) * (1 - Math.cos(angle)),
    ];
    const end = point(sweep);
    const tangent = [
      Math.cos(sweep),
      Math.cos(tilt) * Math.sin(sweep),
      Math.sin(tilt) * Math.sin(sweep),
    ];
    const profile = rectangleWire(
      point(0),
      [0, 1, 0],
      [0, 0, 1],
      0.01,
      0.01,
    );
    const spine = wireFromEdges([
      arcEdge(point(0), point(sweep / 2), end),
      lineEdge(end, addVectors(end, scaleVector(tangent, 0.1))),
    ]);
    const arenaBefore = kernel.getShapeCount();
    withReport(controlledPipeShell(profile, spine), (report) => {
      const result = assertControlledPipeShellSuccess(
        report,
        arenaBefore,
        0.0001 * (radius * sweep + 0.1),
        { faces: 10, edges: 20, vertices: 12 },
        "conditionedNearFull",
      );
      kernel.release(result);
    });
  });

  runFixture("single wall", () => {
    const box = kernel.makeBox(20, 20, 10);
    const wall = faceOnPlane(box, "x", 0);
    const arenaBefore = kernel.getShapeCount();
    const report = draft(
      box,
      [wall],
      radians(5),
      [0, 0, 1],
      [0, 0, 0],
      [0, 0, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, true, `${ownedReport.code}: ${ownedReport.message}`);
      assert.equal(ownedReport.stage, "complete");
      assert.equal(ownedReport.code, "OK");
      assert.equal(ownedReport.requestedSeedCount, 1);
      assert.equal(ownedReport.addCount, 1);
      assert.equal(ownedReport.skippedSeedCount, 0);
      assert.equal(ownedReport.buildCount, 1);
      assert.equal(ownedReport.hasResult(), true);
      assert.equal(ownedReport.transferCode(kernel), "READY");
      assert.equal(
        kernel.getShapeCount(),
        arenaBefore,
        "report-owned result entered the arena before takeResultId()",
      );

      for (const property of [
        "ok",
        "stage",
        "code",
        "message",
        "failedSeedIndex",
        "occtStatus",
        "requestedSeedCount",
        "addCount",
        "skippedSeedCount",
        "buildCount",
        "problematicShapeType",
        "problematicShapeIndex",
        "historyProblemDomain",
        "historyProblemSourceShapeIndex",
        "historyProblemKind",
        "historyProblemIndex",
      ]) {
        const valueBeforeAssignment = ownedReport[property];
        assert.throws(
          () => {
            ownedReport[property] = valueBeforeAssignment;
          },
          /read-only property/i,
          `${property} must reject assignment`,
        );
        assert.deepEqual(ownedReport[property], valueBeforeAssignment);
      }

      const historyBeforeTransfer = assertDraftHistory(
        ownedReport,
        singleWallModifiedIndices,
        "singleWall",
      );
      const detachedCounts = ownedReport.topologyInputCounts(0);
      detachedCounts.faces = 999;
      assert.deepEqual(
        topologyCounts(ownedReport.topologyInputCounts(0)),
        { faces: 6, edges: 12, vertices: 8 },
        "mutating a returned counts value must not mutate report history",
      );
      const detachedRecord = ownedReport.topologyRecord(0);
      detachedRecord.resultIndex = 999;
      assert.deepEqual(
        topologyRecord(ownedReport.topologyRecord(0)),
        historyBeforeTransfer.records[0],
        "mutating a returned record value must not mutate report history",
      );

      const sharedReport = ownedReport.clone();
      try {
        assert.equal(sharedReport.hasResult(), true);
        assert.equal(sharedReport.transferCode(kernel), "READY");
        assert.deepEqual(
          readTopologyHistory(sharedReport),
          historyBeforeTransfer,
          "a cloned report must share immutable topology history",
        );

        const otherKernel = new Module.OcctKernel();
        try {
          assert.equal(sharedReport.transferCode(otherKernel), "WRONG_KERNEL");
          assert.throws(
            () => sharedReport.takeResultId(otherKernel),
            "a report result must not transfer into a different kernel",
          );
          assert.equal(otherKernel.getShapeCount(), 0);
        } finally {
          otherKernel.delete();
        }

        const recreatedKernel = new Module.OcctKernel();
        try {
          assert.equal(sharedReport.transferCode(recreatedKernel), "WRONG_KERNEL");
          assert.throws(
            () => sharedReport.takeResultId(recreatedKernel),
            "destroying and recreating a kernel must not recycle ownership",
          );
        } finally {
          recreatedKernel.delete();
        }

        assert.equal(ownedReport.hasResult(), true);
        assert.equal(ownedReport.transferCode(kernel), "READY");
        const result = sharedReport.takeResultId(kernel);
        assert.equal(ownedReport.hasResult(), false);
        assert.equal(sharedReport.hasResult(), false);
        assert.equal(ownedReport.transferCode(kernel), "ALREADY_TRANSFERRED");
        assert.equal(sharedReport.transferCode(kernel), "ALREADY_TRANSFERRED");
        assert.equal(kernel.getShapeCount(), arenaBefore + 1);
        assert.deepEqual(
          readTopologyHistory(ownedReport),
          historyBeforeTransfer,
          "topology history must survive result transfer",
        );
        assert.deepEqual(
          readTopologyHistory(sharedReport),
          historyBeforeTransfer,
          "a cloned report must retain history after transfer through an alias",
        );
        try {
          assertSolidFixture(result, fixtures.singleWall, "singleWall");
          assert.throws(
            () => ownedReport.takeResultId(kernel),
            "all report aliases must share exactly-once transfer state",
          );

          const postTransferKernel = new Module.OcctKernel();
          try {
            assert.equal(
              sharedReport.transferCode(postTransferKernel),
              "ALREADY_TRANSFERRED",
              "consumed state takes precedence over kernel identity",
            );
          } finally {
            postTransferKernel.delete();
          }
        } finally {
          kernel.release(result);
        }
      } finally {
        sharedReport.delete();
      }
      assert.equal(kernel.getShapeCount(), arenaBefore);
    });
  });

  runFixture("four-wall atomic draft", () => {
    const box = kernel.makeBox(20, 20, 10);
    const walls = facesSpanning(box, "z", 10);
    const arenaBefore = kernel.getShapeCount();
    const report = draft(
      box,
      walls,
      radians(5),
      [0, 0, 1],
      [0, 0, 2.5],
      [0, 0, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, true, `${ownedReport.code}: ${ownedReport.message}`);
      assert.equal(ownedReport.stage, "complete");
      assert.equal(ownedReport.code, "OK");
      assert.equal(ownedReport.requestedSeedCount, 4);
      assert.equal(ownedReport.addCount, 4);
      assert.equal(ownedReport.skippedSeedCount, 0);
      assert.equal(ownedReport.buildCount, 1);
      assert.equal(kernel.getShapeCount(), arenaBefore);
      assertDraftHistory(ownedReport, allModifiedIndices, "fourWalls");
      const result = ownedReport.takeResultId(kernel);
      try {
        assertSolidFixture(result, fixtures.fourWalls, "fourWalls");
      } finally {
        kernel.release(result);
      }
    });
  });

  runFixture("YZ neutral plane", () => {
    const box = kernel.makeBox(10, 20, 20);
    const walls = facesSpanning(box, "x", 10);
    const report = draft(
      box,
      walls,
      radians(4),
      [1, 0, 0],
      [3, 0, 0],
      [1, 0, 0],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, true, `${ownedReport.code}: ${ownedReport.message}`);
      assert.equal(ownedReport.stage, "complete");
      assert.equal(ownedReport.requestedSeedCount, 4);
      assert.equal(ownedReport.addCount, 4);
      assert.equal(ownedReport.skippedSeedCount, 0);
      assert.equal(ownedReport.buildCount, 1);
      assertDraftHistory(ownedReport, allModifiedIndices, "yzNeutralPlane");
      const result = ownedReport.takeResultId(kernel);
      try {
        assertSolidFixture(result, fixtures.yzNeutralPlane, "yzNeutralPlane");
      } finally {
        kernel.release(result);
      }
    });
  });

  runFixture("oblique neutral plane independent of pull", () => {
    const box = kernel.makeBox(20, 20, 10);
    const wall = faceOnPlane(box, "x", 0);
    const report = draft(
      box,
      [wall],
      radians(5),
      [0, 0, 1],
      [1, 2, 3],
      [1, 1, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, true, `${ownedReport.code}: ${ownedReport.message}`);
      assert.equal(ownedReport.stage, "complete");
      assert.equal(ownedReport.addCount, 1);
      assert.equal(ownedReport.buildCount, 1);
      assertDraftHistory(
        ownedReport,
        singleWallModifiedIndices,
        "obliqueNeutralPlane",
      );
      const result = ownedReport.takeResultId(kernel);
      try {
        assert.equal(kernel.getShapeType(result), "solid");
        assert.equal(kernel.isValid(result), true);
        assertClose(
          kernel.getVolume(result),
          fixtures.obliqueNeutralPlane.volume,
          VOLUME_TOLERANCE,
          "obliqueNeutralPlane.volume",
        );
        assert.deepEqual(
          {
            faces: kernel.subShapeCount(result, "face"),
            edges: kernel.subShapeCount(result, "edge"),
            vertices: kernel.subShapeCount(result, "vertex"),
          },
          { faces: 6, edges: 12, vertices: 8 },
          "obliqueNeutralPlane.topology",
        );
      } finally {
        kernel.release(result);
      }
    });
  });

  runFixture("duplicate seed idempotence", () => {
    const box = kernel.makeBox(20, 20, 10);
    const wall = faceOnPlane(box, "x", 0);
    const report = draft(
      box,
      [wall, wall],
      radians(5),
      [0, 0, 1],
      [0, 0, 0],
      [0, 0, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, true, `${ownedReport.code}: ${ownedReport.message}`);
      assert.equal(ownedReport.stage, "complete");
      assert.equal(ownedReport.requestedSeedCount, 2);
      assert.equal(ownedReport.addCount, 1);
      assert.equal(ownedReport.skippedSeedCount, 1);
      assert.equal(ownedReport.buildCount, 1);
      assertDraftHistory(ownedReport, singleWallModifiedIndices, "duplicateSeed");
      const result = ownedReport.takeResultId(kernel);
      try {
        assertSolidFixture(result, fixtures.singleWall, "duplicateSeed");
      } finally {
        kernel.release(result);
      }
    });
  });

  runFixture("reversed occurrence seed idempotence", () => {
    const box = kernel.makeBox(20, 20, 10);
    const wall = faceOnPlane(box, "x", 0);
    const reversedWall = kernel.reverseShape(wall);
    const report = draft(
      box,
      [wall, reversedWall],
      radians(5),
      [0, 0, 1],
      [0, 0, 0],
      [0, 0, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, true, `${ownedReport.code}: ${ownedReport.message}`);
      assert.equal(ownedReport.stage, "complete");
      assert.equal(ownedReport.requestedSeedCount, 2);
      assert.equal(ownedReport.addCount, 1);
      assert.equal(ownedReport.skippedSeedCount, 1);
      assert.equal(ownedReport.buildCount, 1);
      assertDraftHistory(
        ownedReport,
        singleWallModifiedIndices,
        "reversedOccurrenceSeed",
      );
      const result = ownedReport.takeResultId(kernel);
      try {
        assertSolidFixture(result, fixtures.singleWall, "reversedOccurrenceSeed");
      } finally {
        kernel.release(result);
      }
    });
  });

  runFixture("later seed failure remains atomic", () => {
    const box = kernel.makeBox(20, 20, 10);
    const wall = faceOnPlane(box, "x", 0);
    const bottom = faceOnPlane(box, "z", 0);
    const arenaBefore = kernel.getShapeCount();
    const report = draft(
      box,
      [wall, bottom],
      radians(5),
      [0, 0, 1],
      [0, 0, 0],
      [0, 0, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, false);
      assert.equal(ownedReport.stage, "add");
      assert.equal(ownedReport.code, "ADD_REJECTED");
      assert.equal(ownedReport.failedSeedIndex, 1);
      assert.equal(ownedReport.requestedSeedCount, 2);
      assert.equal(ownedReport.addCount, 2);
      assert.equal(ownedReport.skippedSeedCount, 0);
      assert.equal(ownedReport.buildCount, 0);
      assert.equal(ownedReport.hasResult(), false);
      assert.equal(ownedReport.transferCode(kernel), "NO_RESULT");
      assertNoTopologyHistory(ownedReport, "laterSeedFailure");
      assert.equal(kernel.getShapeCount(), arenaBefore);
    });
  });

  runFixture("foreign face rejection", () => {
    const box = kernel.makeBox(20, 20, 10);
    const foreign = kernel.makeBox(20, 20, 10);
    const foreignWall = faceOnPlane(foreign, "x", 0);
    const arenaBefore = kernel.getShapeCount();
    const report = draft(
      box,
      [foreignWall],
      radians(5),
      [0, 0, 1],
      [0, 0, 0],
      [0, 0, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, false);
      assert.equal(ownedReport.stage, "seed-validation");
      assert.equal(ownedReport.code, "FACE_NOT_IN_SHAPE");
      assert.equal(ownedReport.failedSeedIndex, 0);
      assert.equal(ownedReport.requestedSeedCount, 1);
      assert.equal(ownedReport.addCount, 0);
      assert.equal(ownedReport.buildCount, 0);
      assert.equal(ownedReport.hasResult(), false);
      assert.equal(ownedReport.transferCode(kernel), "NO_RESULT");
      assertNoTopologyHistory(ownedReport, "foreignFace");
      assert.equal(kernel.getShapeCount(), arenaBefore);
      assert.throws(
        () => ownedReport.takeResultId(kernel),
        "a failed report must not expose a transferable result",
      );
    });
  });

  runFixture("top-level solid input boundary", () => {
    const box = kernel.makeBox(20, 20, 10);
    const wall = faceOnPlane(box, "x", 0);
    const children = vector([box]);
    let compound;
    try {
      compound = kernel.makeCompound(children);
    } finally {
      children.delete();
    }
    const arenaBefore = kernel.getShapeCount();
    const report = draft(
      compound,
      [wall],
      radians(5),
      [0, 0, 1],
      [0, 0, 0],
      [0, 0, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, false);
      assert.equal(ownedReport.stage, "input-validation");
      assert.equal(ownedReport.code, "INPUT_NOT_TOP_LEVEL_SOLID");
      assert.equal(ownedReport.addCount, 0);
      assert.equal(ownedReport.buildCount, 0);
      assert.equal(ownedReport.hasResult(), false);
      assert.equal(ownedReport.transferCode(kernel), "NO_RESULT");
      assertNoTopologyHistory(ownedReport, "compoundInput");
      assert.equal(kernel.getShapeCount(), arenaBefore);
    });
  });

  runFixture("unsupported spherical face", () => {
    const sphere = kernel.makeSphere(10);
    const face = sphericalFace(sphere, 10);
    const arenaBefore = kernel.getShapeCount();
    const report = draft(
      sphere,
      [face],
      radians(5),
      [0, 0, 1],
      [0, 0, 0],
      [0, 0, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, false);
      assert.equal(ownedReport.stage, "add");
      assert.equal(ownedReport.code, "ADD_REJECTED");
      assert.equal(ownedReport.failedSeedIndex, 0);
      assert.equal(ownedReport.occtStatus, 1);
      assert.equal(ownedReport.requestedSeedCount, 1);
      assert.equal(ownedReport.addCount, 1);
      assert.equal(ownedReport.skippedSeedCount, 0);
      assert.equal(ownedReport.buildCount, 0);
      assert.equal(ownedReport.hasResult(), false);
      assert.equal(ownedReport.transferCode(kernel), "NO_RESULT");
      assert.equal(ownedReport.problematicShapeType, "face");
      assert.equal(ownedReport.problematicShapeIndex, 0);
      assertNoTopologyHistory(ownedReport, "unsupportedSphericalFace");
      assert.equal(kernel.getShapeCount(), arenaBefore);
    });
  });

  runFixture("pinned OCCT tiny-angle limit", () => {
    const box = kernel.makeBox(20, 20, 10);
    const wall = faceOnPlane(box, "x", 0);
    const arenaBefore = kernel.getShapeCount();
    const report = draft(
      box,
      [wall],
      1e-4,
      [0, 0, 1],
      [0, 0, 0],
      [0, 0, 1],
    );

    withReport(report, (ownedReport) => {
      assert.equal(ownedReport.ok, false);
      assert.equal(ownedReport.stage, "validation");
      assert.equal(ownedReport.code, "ANGLE_BELOW_KERNEL_LIMIT");
      assert.equal(ownedReport.requestedSeedCount, 1);
      assert.equal(ownedReport.addCount, 0);
      assert.equal(ownedReport.buildCount, 0);
      assert.equal(ownedReport.hasResult(), false);
      assert.equal(ownedReport.transferCode(kernel), "NO_RESULT");
      assertNoTopologyHistory(ownedReport, "tinyAngle");
      assert.equal(kernel.getShapeCount(), arenaBefore);
    });
  });

  assert.equal(kernel.getShapeCount(), 0);
} finally {
  if (kernel !== undefined) {
    try {
      kernel.releaseAll();
    } finally {
      kernel.delete();
    }
  }
}

process.stdout.write("InvariantCAD OCCT facade smoke test passed.\n");
