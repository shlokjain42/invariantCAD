import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_FACADE_VERSION = "invariantcad-facade@0.4.0+occt-wasm.3.7.0";
const EXPECTED_TOPOLOGY_HISTORY_VERSION = 1;
const EXACT_BOOLEAN_HISTORY_RECORD_LIMIT = 1_000_000;
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
assert.equal(typeof Module.InvariantCadBooleanReport, "function");
assert.equal(typeof Module.invariantcadBooleanAtomic, "function");
assert.equal(typeof Module.InvariantCadPipeShellReport, "function");
assert.equal(typeof Module.invariantcadPipeShellSolid, "function");

const booleanOperations = Object.freeze({
  union: Module.InvariantCadBooleanOperation.UNION,
  subtract: Module.InvariantCadBooleanOperation.SUBTRACT,
  intersect: Module.InvariantCadBooleanOperation.INTERSECT,
});
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

assert.deepEqual(booleanOperations, { union: 0, subtract: 1, intersect: 2 });
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

function translatedBox(size, offset) {
  const source = kernel.makeBox(size[0], size[1], size[2]);
  try {
    return kernel.translate(source, offset[0], offset[1], offset[2]);
  } finally {
    kernel.release(source);
  }
}

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

function exactBoolean(
  operation,
  target,
  tools,
  selectedKernel = kernel,
  maxHistoryRecords = EXACT_BOOLEAN_HISTORY_RECORD_LIMIT,
) {
  const ids = vector(tools);
  try {
    return Module.invariantcadBooleanAtomic(
      selectedKernel,
      operation,
      target,
      ids,
      maxHistoryRecords,
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

function shapeTopologyCounts(shape) {
  return {
    faces: kernel.subShapeCount(shape, "face"),
    edges: kernel.subShapeCount(shape, "edge"),
    vertices: kernel.subShapeCount(shape, "vertex"),
  };
}

function readBooleanTopologyHistory(report) {
  const inputCounts = [];
  for (
    let sourceShapeIndex = 0;
    sourceShapeIndex < report.topologyInputShapeCount();
    sourceShapeIndex += 1
  ) {
    inputCounts.push(
      topologyCounts(report.topologyInputCounts(sourceShapeIndex)),
    );
  }
  const records = [];
  for (let recordIndex = 0; recordIndex < report.topologyRecordCount(); recordIndex += 1) {
    records.push(topologyRecord(report.topologyRecord(recordIndex)));
  }
  return {
    version: report.topologyHistoryVersion(),
    complete: report.topologyHistoryComplete(),
    inputShapeCount: report.topologyInputShapeCount(),
    inputCounts,
    resultCounts: topologyCounts(report.topologyResultCounts()),
    records,
  };
}

const topologyRecordSortKeys = Object.freeze([
  "sourceShapeIndex",
  "sourceKind",
  "sourceIndex",
  "relation",
  "resultKind",
  "resultIndex",
]);

function compareTopologyRecords(left, right) {
  for (const key of topologyRecordSortKeys) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}

function topologyCountForKind(counts, kind) {
  switch (kind) {
    case topologyKinds.face:
      return counts.faces;
    case topologyKinds.edge:
      return counts.edges;
    case topologyKinds.vertex:
      return counts.vertices;
    default:
      assert.fail(`unsupported topology kind ${kind}`);
  }
}

const observedBooleanRelations = new Set();

function assertBooleanHistory(report, inputShapes, label) {
  const history = readBooleanTopologyHistory(report);
  assert.equal(history.version, EXPECTED_TOPOLOGY_HISTORY_VERSION, `${label}.version`);
  assert.equal(history.complete, true, `${label}.complete`);
  assert.equal(history.inputShapeCount, inputShapes.length, `${label}.inputShapeCount`);
  assert.deepEqual(
    history.inputCounts,
    inputShapes.map((shape) => shapeTopologyCounts(shape)),
    `${label}.inputCounts`,
  );

  for (const [kindName, count] of Object.entries(history.resultCounts)) {
    assert.ok(
      Number.isSafeInteger(count) && count >= 0,
      `${label}.resultCounts.${kindName} must be a non-negative integer`,
    );
  }

  const sourceIdentityRelations = history.inputCounts.map((counts) =>
    [topologyKinds.face, topologyKinds.edge, topologyKinds.vertex].map((kind) =>
      Array.from({ length: topologyCountForKind(counts, kind) }, () => new Set()),
    ),
  );
  const claimedResults = [
    Array(history.resultCounts.faces).fill(false),
    Array(history.resultCounts.edges).fill(false),
    Array(history.resultCounts.vertices).fill(false),
  ];
  const createdResults = [
    Array(history.resultCounts.faces).fill(false),
    Array(history.resultCounts.edges).fill(false),
    Array(history.resultCounts.vertices).fill(false),
  ];
  const exactRecords = new Set();
  const linkRelations = new Map();

  for (const [recordIndex, record] of history.records.entries()) {
    if (recordIndex > 0) {
      assert.ok(
        compareTopologyRecords(history.records[recordIndex - 1], record) < 0,
        `${label}.records must be strictly canonical at index ${recordIndex}`,
      );
    }
    assert.ok(
      [
        topologyRelations.preserved,
        topologyRelations.modified,
        topologyRelations.generated,
        topologyRelations.deleted,
        topologyRelations.created,
      ].includes(record.relation),
      `${label}.records[${recordIndex}].relation`,
    );
    const isCreated = record.relation === topologyRelations.created;
    if (isCreated) {
      assert.equal(record.sourceShapeIndex, -1, `${label}.created.sourceShapeIndex`);
      assert.equal(record.sourceKind, topologyKinds.none, `${label}.created.sourceKind`);
      assert.equal(record.sourceIndex, -1, `${label}.created.sourceIndex`);
    } else {
      assert.ok(
        Number.isSafeInteger(record.sourceShapeIndex) &&
          record.sourceShapeIndex >= 0 &&
          record.sourceShapeIndex < inputShapes.length,
        `${label}.records[${recordIndex}].sourceShapeIndex`,
      );
      assert.ok(
        [topologyKinds.face, topologyKinds.edge, topologyKinds.vertex].includes(
          record.sourceKind,
        ),
        `${label}.records[${recordIndex}].sourceKind`,
      );
      const sourceCount = topologyCountForKind(
        history.inputCounts[record.sourceShapeIndex],
        record.sourceKind,
      );
      assert.ok(
        Number.isSafeInteger(record.sourceIndex) &&
          record.sourceIndex >= 0 &&
          record.sourceIndex < sourceCount,
        `${label}.records[${recordIndex}].sourceIndex`,
      );
    }
    observedBooleanRelations.add(record.relation);

    if (!isCreated) {
      const sourceKindOffset = record.sourceKind - topologyKinds.face;
      const sourceRelations =
        sourceIdentityRelations[record.sourceShapeIndex][sourceKindOffset][
          record.sourceIndex
        ];
      if (
        record.relation === topologyRelations.preserved ||
        record.relation === topologyRelations.modified ||
        record.relation === topologyRelations.deleted
      ) {
        sourceRelations.add(record.relation);
      }
    }

    if (record.relation === topologyRelations.deleted) {
      assert.equal(
        record.resultKind,
        topologyKinds.none,
        `${label}.records[${recordIndex}].deleted.resultKind`,
      );
      assert.equal(
        record.resultIndex,
        -1,
        `${label}.records[${recordIndex}].deleted.resultIndex`,
      );
    } else {
      assert.ok(
        [topologyKinds.face, topologyKinds.edge, topologyKinds.vertex].includes(
          record.resultKind,
        ),
        `${label}.records[${recordIndex}].resultKind`,
      );
      if (
        record.relation === topologyRelations.preserved ||
        record.relation === topologyRelations.modified
      ) {
        assert.equal(
          record.resultKind,
          record.sourceKind,
          `${label}.records[${recordIndex}] identity successor changed kind`,
        );
      }
      const resultCount = topologyCountForKind(
        history.resultCounts,
        record.resultKind,
      );
      assert.ok(
        Number.isSafeInteger(record.resultIndex) &&
          record.resultIndex >= 0 &&
          record.resultIndex < resultCount,
        `${label}.records[${recordIndex}].resultIndex`,
      );
      if (isCreated) {
        assert.equal(
          claimedResults[record.resultKind - topologyKinds.face][record.resultIndex],
          false,
          `${label}.records[${recordIndex}] marks an attributed result CREATED`,
        );
        createdResults[record.resultKind - topologyKinds.face][record.resultIndex] = true;
      } else {
        assert.equal(
          createdResults[record.resultKind - topologyKinds.face][record.resultIndex],
          false,
          `${label}.records[${recordIndex}] attributes a CREATED result`,
        );
        claimedResults[record.resultKind - topologyKinds.face][record.resultIndex] = true;

        const linkKey = [
          record.sourceShapeIndex,
          record.sourceKind,
          record.sourceIndex,
          record.resultKind,
          record.resultIndex,
        ].join(":");
        const previousRelation = linkRelations.get(linkKey);
        assert.ok(
          previousRelation === undefined || previousRelation === record.relation,
          `${label}.records[${recordIndex}] contradicts an existing source/result link`,
        );
        linkRelations.set(linkKey, record.relation);
      }
    }

    const exactKey = topologyRecordSortKeys.map((key) => record[key]).join(":");
    assert.equal(
      exactRecords.has(exactKey),
      false,
      `${label}.records[${recordIndex}] duplicates an earlier record`,
    );
    exactRecords.add(exactKey);
  }

  for (const [sourceShapeIndex, byKind] of sourceIdentityRelations.entries()) {
    for (const [kindOffset, byIndex] of byKind.entries()) {
      for (const [sourceIndex, relations] of byIndex.entries()) {
        const deleted = relations.has(topologyRelations.deleted);
        const identity =
          relations.has(topologyRelations.preserved) ||
          relations.has(topologyRelations.modified);
        assert.notEqual(
          deleted,
          identity,
          `${label}: source ${sourceShapeIndex}/${kindOffset}/${sourceIndex} must have successors or DELETED, exclusively`,
        );
      }
    }
  }
  for (const [kindOffset, byIndex] of claimedResults.entries()) {
    for (const [resultIndex, claimed] of byIndex.entries()) {
      const created = createdResults[kindOffset][resultIndex];
      assert.equal(
        claimed || created,
        true,
        `${label}: result ${kindOffset}/${resultIndex} has no evolution record`,
      );
      assert.equal(claimed && created, false, `${label}: result has mixed attribution`);
    }
  }

  assert.throws(
    () => report.topologyInputCounts(-1),
    `${label}: negative input topology index must fail`,
  );
  assert.throws(
    () => report.topologyInputCounts(inputShapes.length),
    `${label}: out-of-range input topology index must fail`,
  );
  assert.throws(
    () => report.topologyRecord(-1),
    `${label}: negative topology record index must fail`,
  );
  assert.throws(
    () => report.topologyRecord(history.records.length),
    `${label}: out-of-range topology record index must fail`,
  );
  return history;
}

function assertNoBooleanHistory(report, label) {
  assert.equal(report.topologyHistoryVersion(), 0, `${label}.historyVersion`);
  assert.equal(report.topologyHistoryComplete(), false, `${label}.historyComplete`);
  assert.equal(report.topologyInputShapeCount(), 0, `${label}.historyInputCount`);
  assert.equal(report.topologyRecordCount(), 0, `${label}.historyRecordCount`);
  assert.throws(
    () => report.topologyInputCounts(0),
    `${label}: a failed Boolean must not expose input topology counts`,
  );
  assert.throws(
    () => report.topologyResultCounts(),
    `${label}: a failed Boolean must not expose result topology counts`,
  );
  assert.throws(
    () => report.topologyRecord(0),
    `${label}: a failed Boolean must not expose topology records`,
  );
}

function snapshotShape(shape) {
  return {
    shapeType: kernel.getShapeType(shape),
    valid: kernel.isValid(shape),
    volume: kernel.getVolume(shape),
    topology: shapeTopologyCounts(shape),
    brep: kernel.toBREP(shape),
  };
}

function assertShapeSnapshot(shape, snapshot, label) {
  assert.equal(kernel.getShapeType(shape), snapshot.shapeType, `${label}.shapeType`);
  assert.equal(kernel.isValid(shape), snapshot.valid, `${label}.valid`);
  assertClose(kernel.getVolume(shape), snapshot.volume, VOLUME_TOLERANCE, `${label}.volume`);
  assert.deepEqual(shapeTopologyCounts(shape), snapshot.topology, `${label}.topology`);
  assert.equal(kernel.toBREP(shape), snapshot.brep, `${label}.brep`);
}

function assertBooleanReportSuccess(report, operation, toolCount, arenaBefore, label) {
  assert.equal(report.ok, true, `${report.code}: ${report.message}`);
  assert.equal(report.stage, "complete", `${label}.stage`);
  assert.equal(report.code, "OK", `${label}.code`);
  assert.equal(report.operation, operation, `${label}.operation`);
  assert.equal(report.requestedToolCount, toolCount, `${label}.requestedToolCount`);
  assert.equal(
    report.buildCount,
    operation === booleanOperations.subtract ? 1 : toolCount,
    `${label}.buildCount`,
  );
  assert.equal(report.failedToolIndex, -1, `${label}.failedToolIndex`);
  assert.equal(report.historyProblemDomain, "none", `${label}.historyProblemDomain`);
  assert.equal(report.historyProblemSourceShapeIndex, -1);
  assert.equal(report.historyProblemKind, topologyKinds.none);
  assert.equal(report.historyProblemIndex, -1);
  assert.equal(report.hasResult(), true, `${label}.hasResult`);
  assert.equal(report.transferCode(kernel), "READY", `${label}.transferCode`);
  assert.equal(
    kernel.getShapeCount(),
    arenaBefore,
    `${label}: report-owned result entered the arena before transfer`,
  );
}

function assertBooleanResult(result, history, expected, label) {
  assert.equal(kernel.isValid(result), true, `${label}.valid`);
  assertClose(kernel.getVolume(result), expected.volume, VOLUME_TOLERANCE, `${label}.volume`);
  assert.deepEqual(shapeTopologyCounts(result), expected.topology, `${label}.topology`);
  assert.deepEqual(
    shapeTopologyCounts(result),
    history.resultCounts,
    `${label}: report/result topology counts disagree`,
  );
}

function assertBooleanDegeneracyCase({
  label,
  operation,
  target,
  tools,
  expected,
}) {
  const inputs = [target, ...tools];
  const inputSnapshots = inputs.map(snapshotShape);
  const arenaBefore = kernel.getShapeCount();
  withReport(exactBoolean(operation, target, tools), (report) => {
    assertBooleanReportSuccess(
      report,
      operation,
      tools.length,
      arenaBefore,
      label,
    );
    const history = assertBooleanHistory(report, inputs, label);
    const result = report.takeResultId(kernel);
    try {
      assertBooleanResult(result, history, expected, `${label}.result`);
      if (expected.bounds !== undefined) {
        assertBounds(boundsOf(result), expected.bounds, `${label}.result.bounds`);
      }
    } finally {
      kernel.release(result);
    }
    assert.equal(
      kernel.getShapeCount(),
      arenaBefore,
      `${label}: result release must restore the input-only arena`,
    );
    inputs.forEach((shape, index) =>
      assertShapeSnapshot(
        shape,
        inputSnapshots[index],
        `${label}.input[${index}]`,
      ),
    );
  });
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

  runFixture("exact Boolean validation", () => {
    const target = kernel.makeBox(10, 10, 10);
    const tool = translatedBox([10, 10, 10], [5, 0, 0]);
    const targetBefore = snapshotShape(target);
    const toolBefore = snapshotShape(tool);
    const arenaBefore = kernel.getShapeCount();

    withReport(exactBoolean(999, target, [tool]), (report) => {
      assert.equal(report.ok, false);
      assert.equal(report.stage, "validation");
      assert.equal(report.code, "INVALID_OPERATION");
      assert.equal(report.operation, 999);
      assert.equal(report.requestedToolCount, 1);
      assert.equal(report.buildCount, 0);
      assert.equal(report.failedToolIndex, -1);
      assert.equal(report.hasResult(), false);
      assert.equal(report.transferCode(kernel), "NO_RESULT");
      assertNoBooleanHistory(report, "invalidBooleanOperation");
      assert.throws(
        () => report.takeResultId(kernel),
        "an invalid Boolean operation must not transfer a result",
      );
    });

    withReport(
      exactBoolean(booleanOperations.union, target, []),
      (report) => {
        assert.equal(report.ok, false);
        assert.equal(report.stage, "validation");
        assert.equal(report.code, "EMPTY_TOOL_LIST");
        assert.equal(report.operation, booleanOperations.union);
        assert.equal(report.requestedToolCount, 0);
        assert.equal(report.buildCount, 0);
        assert.equal(report.failedToolIndex, -1);
        assert.equal(report.hasResult(), false);
        assert.equal(report.transferCode(kernel), "NO_RESULT");
        assertNoBooleanHistory(report, "emptyBooleanTools");
        assert.throws(
          () => report.takeResultId(kernel),
          "an empty Boolean tool list must not transfer a result",
        );
      },
    );

    withReport(
      exactBoolean(booleanOperations.union, target, [tool], kernel, -1),
      (report) => {
        assert.equal(report.ok, false);
        assert.equal(report.stage, "validation");
        assert.equal(report.code, "INVALID_HISTORY_RECORD_LIMIT");
        assert.equal(report.buildCount, 0);
        assert.equal(report.failedToolIndex, -1);
        assertNoBooleanHistory(report, "negativeBooleanHistoryLimit");
      },
    );

    withReport(
      exactBoolean(booleanOperations.union, target, [tool], kernel, 0),
      (report) => {
        assert.equal(report.ok, false);
        assert.equal(report.stage, "history");
        assert.equal(report.code, "HISTORY_RECORD_LIMIT_EXCEEDED");
        assert.equal(report.buildCount, 1);
        assert.equal(report.failedToolIndex, -1);
        assertNoBooleanHistory(report, "zeroBooleanHistoryLimit");
      },
    );

    withReport(
      exactBoolean(booleanOperations.union, 4_294_967_295, [tool]),
      (report) => {
        assert.equal(report.ok, false);
        assert.equal(report.stage, "validation");
        assert.equal(report.code, "SHAPE_ID_NOT_FOUND");
        assert.equal(report.failedToolIndex, -1);
        assertNoBooleanHistory(report, "missingBooleanTarget");
      },
    );

    withReport(
      exactBoolean(booleanOperations.union, target, [4_294_967_295]),
      (report) => {
        assert.equal(report.ok, false);
        assert.equal(report.stage, "validation");
        assert.equal(report.code, "SHAPE_ID_NOT_FOUND");
        assert.equal(report.failedToolIndex, 0);
        assertNoBooleanHistory(report, "missingBooleanTool");
      },
    );

    assert.equal(kernel.getShapeCount(), arenaBefore);
    assertShapeSnapshot(target, targetBefore, "invalidBooleanOperation.target");
    assertShapeSnapshot(tool, toolBefore, "invalidBooleanOperation.tool");
  });

  runFixture("exact ordered multi-tool union and report ownership", () => {
    const target = kernel.makeBox(10, 10, 10);
    const firstTool = translatedBox([10, 10, 10], [5, 5, 5]);
    const secondTool = translatedBox([10, 10, 10], [8, 8, 8]);
    const inputs = [target, firstTool, secondTool];
    const inputSnapshots = inputs.map(snapshotShape);
    const arenaBefore = kernel.getShapeCount();
    const report = exactBoolean(
      booleanOperations.union,
      target,
      [firstTool, secondTool],
    );

    withReport(report, (ownedReport) => {
      assertBooleanReportSuccess(
        ownedReport,
        booleanOperations.union,
        2,
        arenaBefore,
        "multiToolUnion",
      );
      for (const property of [
        "ok",
        "stage",
        "code",
        "message",
        "operation",
        "requestedToolCount",
        "buildCount",
        "failedToolIndex",
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
          `multiToolUnion.${property} must reject assignment`,
        );
        assert.deepEqual(ownedReport[property], valueBeforeAssignment);
      }

      const historyBeforeTransfer = assertBooleanHistory(
        ownedReport,
        inputs,
        "multiToolUnion",
      );
      const detachedCounts = ownedReport.topologyInputCounts(0);
      detachedCounts.faces = 999;
      assert.deepEqual(
        topologyCounts(ownedReport.topologyInputCounts(0)),
        historyBeforeTransfer.inputCounts[0],
        "mutating detached Boolean counts must not mutate report history",
      );
      const detachedRecord = ownedReport.topologyRecord(0);
      detachedRecord.resultIndex = 999;
      assert.deepEqual(
        topologyRecord(ownedReport.topologyRecord(0)),
        historyBeforeTransfer.records[0],
        "mutating a detached Boolean record must not mutate report history",
      );
      inputs.forEach((shape, index) =>
        assertShapeSnapshot(
          shape,
          inputSnapshots[index],
          `multiToolUnion.inputBeforeTransfer[${index}]`,
        ),
      );

      const sharedReport = ownedReport.clone();
      try {
        assert.equal(sharedReport.hasResult(), true);
        assert.equal(sharedReport.transferCode(kernel), "READY");
        assert.deepEqual(
          readBooleanTopologyHistory(sharedReport),
          historyBeforeTransfer,
          "a Boolean report clone must share immutable topology history",
        );

        const otherKernel = new Module.OcctKernel();
        try {
          assert.equal(sharedReport.transferCode(otherKernel), "WRONG_KERNEL");
          assert.throws(
            () => sharedReport.takeResultId(otherKernel),
            "a Boolean result must not transfer into a foreign kernel",
          );
          assert.equal(otherKernel.getShapeCount(), 0);
        } finally {
          otherKernel.delete();
        }

        const result = sharedReport.takeResultId(kernel);
        try {
          assert.equal(ownedReport.hasResult(), false);
          assert.equal(sharedReport.hasResult(), false);
          assert.equal(ownedReport.transferCode(kernel), "ALREADY_TRANSFERRED");
          assert.equal(sharedReport.transferCode(kernel), "ALREADY_TRANSFERRED");
          assert.equal(kernel.getShapeCount(), arenaBefore + 1);
          assert.deepEqual(
            readBooleanTopologyHistory(ownedReport),
            historyBeforeTransfer,
            "Boolean topology history must remain readable after transfer",
          );
          assert.deepEqual(
            readBooleanTopologyHistory(sharedReport),
            historyBeforeTransfer,
            "a Boolean report clone must retain history after alias transfer",
          );
          assertBooleanResult(
            result,
            historyBeforeTransfer,
            {
              volume: 2_532,
              topology: { faces: 18, edges: 48, vertices: 32 },
            },
            "multiToolUnion.result",
          );
          assert.throws(
            () => ownedReport.takeResultId(kernel),
            "all Boolean report aliases must share one-shot transfer state",
          );

          const postTransferKernel = new Module.OcctKernel();
          try {
            assert.equal(
              sharedReport.transferCode(postTransferKernel),
              "ALREADY_TRANSFERRED",
              "consumed Boolean state must precede kernel identity",
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
      inputs.forEach((shape, index) =>
        assertShapeSnapshot(
          shape,
          inputSnapshots[index],
          `multiToolUnion.inputAfterTransfer[${index}]`,
        ),
      );
    });
  });

  runFixture("exact collinear overlapping union regression", () => {
    const target = kernel.makeBox(10, 10, 10);
    const firstTool = translatedBox([10, 10, 10], [5, 0, 0]);
    const secondTool = translatedBox([10, 10, 10], [10, 0, 0]);
    const inputs = [target, firstTool, secondTool];
    const inputSnapshots = inputs.map(snapshotShape);
    const arenaBefore = kernel.getShapeCount();

    withReport(
      exactBoolean(
        booleanOperations.union,
        target,
        [firstTool, secondTool],
      ),
      (report) => {
        assertBooleanReportSuccess(
          report,
          booleanOperations.union,
          2,
          arenaBefore,
          "collinearUnion",
        );
        const history = assertBooleanHistory(
          report,
          inputs,
          "collinearUnion",
        );
        const result = report.takeResultId(kernel);
        try {
          assertBooleanResult(
            result,
            history,
            {
              volume: 2_000,
              topology: { faces: 18, edges: 36, vertices: 20 },
            },
            "collinearUnion.result",
          );
          assertBounds(
            boundsOf(result),
            {
              xmin: 0,
              ymin: 0,
              zmin: 0,
              xmax: 20,
              ymax: 10,
              zmax: 10,
            },
            "collinearUnion.result.bounds",
          );
        } finally {
          kernel.release(result);
        }
        assert.equal(kernel.getShapeCount(), arenaBefore);
        inputs.forEach((shape, index) =>
          assertShapeSnapshot(
            shape,
            inputSnapshots[index],
            `collinearUnion.input[${index}]`,
          ),
        );
      },
    );
  });

  runFixture("exact simultaneous multi-tool subtraction", () => {
    const target = kernel.makeBox(20, 10, 10);
    const firstTool = translatedBox([4, 12, 12], [2, -1, -1]);
    const secondTool = translatedBox([4, 12, 12], [14, -1, -1]);
    const inputs = [target, firstTool, secondTool];
    const inputSnapshots = inputs.map(snapshotShape);
    const arenaBefore = kernel.getShapeCount();

    withReport(
      exactBoolean(
        booleanOperations.subtract,
        target,
        [firstTool, secondTool],
      ),
      (report) => {
        assertBooleanReportSuccess(
          report,
          booleanOperations.subtract,
          2,
          arenaBefore,
          "multiToolSubtract",
        );
        const history = assertBooleanHistory(
          report,
          inputs,
          "multiToolSubtract",
        );
        const result = report.takeResultId(kernel);
        try {
          assertBooleanResult(
            result,
            history,
            {
              volume: 1_200,
              topology: { faces: 18, edges: 36, vertices: 24 },
            },
            "multiToolSubtract.result",
          );
        } finally {
          kernel.release(result);
        }
        assert.equal(kernel.getShapeCount(), arenaBefore);
        inputs.forEach((shape, index) =>
          assertShapeSnapshot(
            shape,
            inputSnapshots[index],
            `multiToolSubtract.input[${index}]`,
          ),
        );
      },
    );
  });

  runFixture("exact emergent multi-tool subtraction topology", () => {
    const target = translatedBox([6, 9, 6], [0, 12, 3]);
    const firstTool = translatedBox([4, 7, 5], [1, 5.5, 2]);
    const secondTool = translatedBox([5, 14, 12], [2, 1, 5]);
    const inputs = [target, firstTool, secondTool];
    const inputSnapshots = inputs.map(snapshotShape);
    const arenaBefore = kernel.getShapeCount();

    withReport(
      exactBoolean(
        booleanOperations.subtract,
        target,
        [firstTool, secondTool],
      ),
      (report) => {
        assertBooleanReportSuccess(
          report,
          booleanOperations.subtract,
          2,
          arenaBefore,
          "emergentMultiToolSubtract",
        );
        const history = assertBooleanHistory(
          report,
          inputs,
          "emergentMultiToolSubtract",
        );
        assert.ok(
          history.records.some(
            (record) =>
              record.relation === topologyRelations.created &&
              record.resultKind === topologyKinds.vertex,
          ),
          "emergent multi-tool subtraction must encode its unattributed vertex as CREATED",
        );
        const result = report.takeResultId(kernel);
        try {
          assertBooleanResult(
            result,
            history,
            {
              volume: 271,
              topology: { faces: 14, edges: 36, vertices: 24 },
            },
            "emergentMultiToolSubtract.result",
          );
          assertBounds(
            boundsOf(result),
            { xmin: 0, ymin: 12, zmin: 3, xmax: 6, ymax: 21, zmax: 9 },
            "emergentMultiToolSubtract.result.bounds",
          );
        } finally {
          kernel.release(result);
        }
        assert.equal(kernel.getShapeCount(), arenaBefore);
        inputs.forEach((shape, index) =>
          assertShapeSnapshot(
            shape,
            inputSnapshots[index],
            `emergentMultiToolSubtract.input[${index}]`,
          ),
        );
      },
    );
  });

  runFixture("exact ordered multi-tool intersection", () => {
    const target = kernel.makeBox(10, 10, 10);
    const firstTool = translatedBox([10, 10, 10], [2, 2, 2]);
    const secondTool = translatedBox([10, 10, 10], [5, 5, 5]);
    const inputs = [target, firstTool, secondTool];
    const inputSnapshots = inputs.map(snapshotShape);
    const arenaBefore = kernel.getShapeCount();

    withReport(
      exactBoolean(
        booleanOperations.intersect,
        target,
        [firstTool, secondTool],
      ),
      (report) => {
        assertBooleanReportSuccess(
          report,
          booleanOperations.intersect,
          2,
          arenaBefore,
          "multiToolIntersect",
        );
        const history = assertBooleanHistory(
          report,
          inputs,
          "multiToolIntersect",
        );
        const result = report.takeResultId(kernel);
        try {
          assertBooleanResult(
            result,
            history,
            {
              volume: 125,
              topology: { faces: 6, edges: 12, vertices: 8 },
            },
            "multiToolIntersect.result",
          );
          assert.notEqual(
            kernel.getVolume(result),
            512,
            "multi-tool intersection must be ordered intersection, not target intersect union(tools)",
          );
        } finally {
          kernel.release(result);
        }
        assert.equal(kernel.getShapeCount(), arenaBefore);
        inputs.forEach((shape, index) =>
          assertShapeSnapshot(
            shape,
            inputSnapshots[index],
            `multiToolIntersect.input[${index}]`,
          ),
        );
      },
    );
  });

  runFixture("exact Boolean degeneracy matrix", () => {
    const emptyResult = Object.freeze({
      volume: 0,
      topology: { faces: 0, edges: 0, vertices: 0 },
    });
    const cubeResult = Object.freeze({
      volume: 1_000,
      topology: { faces: 6, edges: 12, vertices: 8 },
    });
    const containedResult = Object.freeze({
      volume: 8,
      topology: { faces: 6, edges: 12, vertices: 8 },
    });
    const cavityResult = Object.freeze({
      volume: 992,
      topology: { faces: 12, edges: 24, vertices: 16 },
    });
    const cases = [
      {
        label: "degeneracy.disjointUnion",
        operation: booleanOperations.union,
        expected: {
          volume: 2_000,
          topology: { faces: 12, edges: 24, vertices: 16 },
        },
        build: () => ({
          target: kernel.makeBox(10, 10, 10),
          tools: [translatedBox([10, 10, 10], [20, 0, 0])],
        }),
      },
      {
        label: "degeneracy.disjointIntersection",
        operation: booleanOperations.intersect,
        expected: emptyResult,
        build: () => ({
          target: kernel.makeBox(10, 10, 10),
          tools: [translatedBox([10, 10, 10], [20, 0, 0])],
        }),
      },
      {
        label: "degeneracy.containedSubtract",
        operation: booleanOperations.subtract,
        expected: cavityResult,
        build: () => ({
          target: kernel.makeBox(10, 10, 10),
          tools: [translatedBox([2, 2, 2], [4, 4, 4])],
        }),
      },
      {
        label: "degeneracy.containedIntersection",
        operation: booleanOperations.intersect,
        expected: containedResult,
        build: () => ({
          target: kernel.makeBox(10, 10, 10),
          tools: [translatedBox([2, 2, 2], [4, 4, 4])],
        }),
      },
      ...[
        ["Union", booleanOperations.union, cubeResult],
        ["Intersection", booleanOperations.intersect, cubeResult],
        ["Subtract", booleanOperations.subtract, emptyResult],
      ].map(([suffix, operation, expected]) => ({
        label: `degeneracy.coincident${suffix}`,
        operation,
        expected,
        build: () => ({
          target: kernel.makeBox(10, 10, 10),
          tools: [kernel.makeBox(10, 10, 10)],
        }),
      })),
      ...[
        ["Union", booleanOperations.union, cubeResult],
        ["Intersection", booleanOperations.intersect, cubeResult],
        ["Subtract", booleanOperations.subtract, emptyResult],
      ].map(([suffix, operation, expected]) => ({
        label: `degeneracy.targetReusedAsTool${suffix}`,
        operation,
        expected,
        build: () => {
          const target = kernel.makeBox(10, 10, 10);
          return { target, tools: [target] };
        },
      })),
      ...[
        ["Union", booleanOperations.union, cubeResult],
        ["Intersection", booleanOperations.intersect, containedResult],
        ["Subtract", booleanOperations.subtract, cavityResult],
      ].map(([suffix, operation, expected]) => ({
        label: `degeneracy.repeatedTool${suffix}`,
        operation,
        expected,
        build: () => {
          const tool = translatedBox([2, 2, 2], [4, 4, 4]);
          return {
            target: kernel.makeBox(10, 10, 10),
            tools: [tool, tool],
          };
        },
      })),
      {
        label: "degeneracy.faceTangentUnion",
        operation: booleanOperations.union,
        expected: {
          volume: 2_000,
          topology: { faces: 10, edges: 20, vertices: 12 },
        },
        build: () => ({
          target: kernel.makeBox(10, 10, 10),
          tools: [translatedBox([10, 10, 10], [10, 0, 0])],
        }),
      },
      {
        label: "regression.mergedHistoryRemovedWithUnionSuccessor",
        operation: booleanOperations.union,
        expected: {
          volume: 2_514,
          topology: { faces: 18, edges: 45, vertices: 29 },
          bounds: {
            xmin: -3,
            ymin: -1,
            zmin: 0,
            xmax: 10,
            ymax: 19,
            zmax: 16,
          },
        },
        build: () => ({
          target: kernel.makeBox(10, 10, 10),
          tools: [
            translatedBox([9, 10, 12], [-3, -1, 4]),
            translatedBox([10, 10, 8], [-3, 9, 4]),
          ],
        }),
      },
      {
        label: "regression.mergedHistoryRemovedWithIntersectSuccessor",
        operation: booleanOperations.intersect,
        expected: {
          volume: 112,
          topology: { faces: 6, edges: 12, vertices: 8 },
          bounds: {
            xmin: 1,
            ymin: 2,
            zmin: 1,
            xmax: 8,
            ymax: 4,
            zmax: 9,
          },
        },
        build: () => ({
          target: kernel.makeBox(10, 10, 10),
          tools: [
            translatedBox([12, 2, 10], [1, 2, 1]),
            translatedBox([11, 5, 12], [-3, -1, -3]),
          ],
        }),
      },
    ];

    for (const testCase of cases) {
      assert.equal(
        kernel.getShapeCount(),
        0,
        `${testCase.label}: dirty arena before matrix case`,
      );
      try {
        const inputs = testCase.build();
        assertBooleanDegeneracyCase({
          label: testCase.label,
          operation: testCase.operation,
          expected: testCase.expected,
          target: inputs.target,
          tools: inputs.tools,
        });
      } finally {
        kernel.releaseAll();
      }
    }
  });

  assert.equal(
    observedBooleanRelations.has(topologyRelations.created),
    true,
    "exact Boolean smoke must exercise higher-order CREATED records",
  );
  assert.equal(
    observedBooleanRelations.has(topologyRelations.generated),
    true,
    "exact Boolean smoke must exercise GENERATED records",
  );
  assert.equal(
    observedBooleanRelations.has(topologyRelations.deleted),
    true,
    "exact Boolean smoke must exercise DELETED records",
  );

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
