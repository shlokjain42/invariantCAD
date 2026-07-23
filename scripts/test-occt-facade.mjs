import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_FACADE_VERSION = "invariantcad-facade@0.9.0+occt-wasm.3.7.0";
const EXPECTED_TOPOLOGY_HISTORY_VERSION = 1;
const ARTIFACT_NATIVE_REQUEST_LIMIT = 128 * 1024 * 1024;
const ARTIFACT_PREFLIGHT_WORK_LIMIT = 1_000_000;
const ARTIFACT_PREFLIGHT_NESTING_LIMIT = 64;
const ARTIFACT_PREFLIGHT_LOCATION_POWER_LIMIT = 1_000_000;
const EXACT_BOOLEAN_HISTORY_RECORD_LIMIT = 1_000_000;
const EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT = 1_000_000;
const EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT = 1_000_000;
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
function runtimeDirectory(arguments_) {
  if (arguments_.length === 0) {
    return join(projectRoot, ".artifacts", "occt-facade");
  }
  if (
    arguments_.length === 2 &&
    arguments_[0] === "--runtime-dir" &&
    arguments_[1] !== undefined
  ) {
    return resolve(arguments_[1]);
  }
  throw new Error(
    "Usage: node scripts/test-occt-facade.mjs [--runtime-dir DIRECTORY]",
  );
}

const facadeDirectory = runtimeDirectory(process.argv.slice(2));
const gluePath = join(facadeDirectory, "occt-wasm.js");
const wasmPath = join(facadeDirectory, "occt-wasm.wasm");
const createOcctWasm = (await import(pathToFileURL(gluePath).href)).default;
const Module = await createOcctWasm({
  locateFile: (path) => (path.endsWith(".wasm") ? wasmPath : path),
});

assert.equal(Module.invariantcadFacadeVersion(), EXPECTED_FACADE_VERSION);
assert.equal(typeof Module.InvariantCadBooleanReport, "function");
assert.equal(typeof Module.invariantcadBooleanAtomic, "function");
assert.equal(typeof Module.InvariantCadEdgeTreatmentReport, "function");
assert.equal(typeof Module.invariantcadEdgeTreatmentAtomic, "function");
assert.equal(typeof Module.InvariantCadSolidOffsetReport, "function");
assert.equal(typeof Module.invariantcadSolidOffsetAtomic, "function");
assert.equal(typeof Module.InvariantCadArtifactWriteReport, "function");
assert.equal(typeof Module.InvariantCadArtifactReadReport, "function");
assert.equal(typeof Module.invariantcadWriteArtifactBrep, "function");
assert.equal(typeof Module.invariantcadReadArtifactBrep, "function");
assert.equal(typeof Module.InvariantCadPipeShellReport, "function");
assert.equal(typeof Module.invariantcadPipeShellSolid, "function");

const booleanOperations = Object.freeze({
  union: Module.InvariantCadBooleanOperation.UNION,
  subtract: Module.InvariantCadBooleanOperation.SUBTRACT,
  intersect: Module.InvariantCadBooleanOperation.INTERSECT,
});
const edgeTreatmentOperations = Object.freeze({
  fillet: Module.InvariantCadEdgeTreatmentOperation.FILLET,
  chamfer: Module.InvariantCadEdgeTreatmentOperation.CHAMFER,
});
const solidOffsetOperations = Object.freeze({
  shell: Module.InvariantCadSolidOffsetOperation.SHELL,
  offset: Module.InvariantCadSolidOffsetOperation.OFFSET,
});
const solidOffsetDirections = Object.freeze({
  inward: Module.InvariantCadSolidOffsetDirection.INWARD,
  outward: Module.InvariantCadSolidOffsetDirection.OUTWARD,
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
assert.deepEqual(edgeTreatmentOperations, { fillet: 0, chamfer: 1 });
assert.deepEqual(solidOffsetOperations, { shell: 0, offset: 1 });
assert.deepEqual(solidOffsetDirections, { inward: 0, outward: 1 });
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

function edgesOf(shape) {
  return drainVector(kernel.getSubShapes(shape, "edge"));
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

function indexedFaceOnPlane(faces, axis, coordinate, label) {
  const indices = faces.flatMap((face, index) => {
    const bounds = boundsOf(face);
    return near(bounds[`${axis}min`], coordinate) &&
      near(bounds[`${axis}max`], coordinate)
      ? [index]
      : [];
  });
  assert.equal(indices.length, 1, `${label}: expected exactly one face`);
  const index = indices[0];
  return { face: faces[index], index };
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

function exactEdgeTreatment(
  operation,
  input,
  edges,
  amount,
  selectedKernel = kernel,
  maxHistoryRecords = EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT,
) {
  const ids = vector(edges);
  try {
    return Module.invariantcadEdgeTreatmentAtomic(
      selectedKernel,
      operation,
      input,
      ids,
      amount,
      maxHistoryRecords,
    );
  } finally {
    ids.delete();
  }
}

function exactSolidOffset(
  operation,
  input,
  openingFaces,
  amount,
  direction,
  tolerance = 1e-6,
  selectedKernel = kernel,
  maxHistoryRecords = EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT,
) {
  const ids = vector(openingFaces);
  try {
    return Module.invariantcadSolidOffsetAtomic(
      selectedKernel,
      operation,
      input,
      ids,
      amount,
      direction,
      tolerance,
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

function artifactReadLimits(inputByteCount, overrides = {}) {
  return {
    maxInputBytes: inputByteCount,
    maxTopologyItems: 100,
    maxNativeRequestedBytes: ARTIFACT_NATIVE_REQUEST_LIMIT,
    maxPreflightWorkUnits: ARTIFACT_PREFLIGHT_WORK_LIMIT,
    maxPreflightNestingDepth: ARTIFACT_PREFLIGHT_NESTING_LIMIT,
    maxPreflightLocationPower: ARTIFACT_PREFLIGHT_LOCATION_POWER_LIMIT,
    ...overrides,
  };
}

function readArtifactBrep(selectedKernel, input, limits) {
  return Module.invariantcadReadArtifactBrep(
    selectedKernel,
    input,
    limits.maxInputBytes,
    limits.maxTopologyItems,
    limits.maxNativeRequestedBytes,
    limits.maxPreflightWorkUnits,
    limits.maxPreflightNestingDepth,
    limits.maxPreflightLocationPower,
  );
}

function assertArtifactReadLimitEchoes(report, limits, label) {
  assert.equal(
    report.maxInputBytes,
    limits.maxInputBytes,
    `${label}.maxInputBytes`,
  );
  assert.equal(
    report.maxTopologyItems,
    limits.maxTopologyItems,
    `${label}.maxTopologyItems`,
  );
  assert.equal(
    report.maxNativeRequestedBytes,
    limits.maxNativeRequestedBytes,
    `${label}.maxNativeRequestedBytes`,
  );
  assert.equal(
    report.maxPreflightWorkUnits,
    limits.maxPreflightWorkUnits,
    `${label}.maxPreflightWorkUnits`,
  );
  assert.equal(
    report.maxPreflightNestingDepth,
    limits.maxPreflightNestingDepth,
    `${label}.maxPreflightNestingDepth`,
  );
  assert.equal(
    report.maxPreflightLocationPower,
    limits.maxPreflightLocationPower,
    `${label}.maxPreflightLocationPower`,
  );
}

function assertArtifactHasNoResult(report, selectedKernel, label) {
  assert.equal(report.hasResult(), false, `${label}.hasResult`);
  assert.equal(
    report.transferCode(selectedKernel),
    "NO_RESULT",
    `${label}.transferCode`,
  );
  assert.throws(
    () => report.takeResultId(selectedKernel),
    `${label}: a failed read must not transfer a result`,
  );
}

function assertArtifactPreflightNotRun(report, label) {
  assert.equal(report.preflightWorkUnits, 0, `${label}.preflightWorkUnits`);
  assert.equal(
    report.preflightMaximumDepth,
    0,
    `${label}.preflightMaximumDepth`,
  );
  assert.equal(
    report.preflightMaximumLocationPower,
    0,
    `${label}.preflightMaximumLocationPower`,
  );
  assert.equal(
    report.preflightConsumedByteCount,
    0,
    `${label}.preflightConsumedByteCount`,
  );
  assert.equal(report.preflightCode, "NOT_RUN", `${label}.preflightCode`);
  assert.equal(
    report.archivePreflightComplete,
    false,
    `${label}.archivePreflightComplete`,
  );
  assert.equal(
    report.deserializationStarted,
    false,
    `${label}.deserializationStarted`,
  );
  assert.equal(report.consumedByteCount, 0, `${label}.consumedByteCount`);
  assert.equal(report.topologyItemCount, 0, `${label}.topologyItemCount`);
}

function assertArtifactPreflightRejected(
  report,
  inputByteCount,
  limits,
  code,
  label,
) {
  assert.equal(report.ok, false, `${label}.ok`);
  assert.equal(report.stage, "preflight", `${label}.stage`);
  assert.equal(report.code, code, `${label}.code`);
  assert.equal(report.inputByteCount, inputByteCount, `${label}.inputByteCount`);
  assertArtifactReadLimitEchoes(report, limits, label);
  assert.ok(
    report.preflightWorkUnits >= 0 &&
      report.preflightWorkUnits <= limits.maxPreflightWorkUnits,
    `${label}.preflightWorkUnits`,
  );
  assert.ok(
    report.preflightMaximumDepth >= 0 &&
      report.preflightMaximumDepth <= limits.maxPreflightNestingDepth,
    `${label}.preflightMaximumDepth`,
  );
  assert.ok(
    report.preflightMaximumLocationPower >= 0 &&
      report.preflightMaximumLocationPower <=
        limits.maxPreflightLocationPower,
    `${label}.preflightMaximumLocationPower`,
  );
  assert.ok(
    report.preflightConsumedByteCount >= 0 &&
      report.preflightConsumedByteCount <= inputByteCount,
    `${label}.preflightConsumedByteCount`,
  );
  assert.equal(report.preflightCode, code, `${label}.preflightCode`);
  assert.equal(
    report.archivePreflightComplete,
    false,
    `${label}.archivePreflightComplete`,
  );
  assert.equal(
    report.deserializationStarted,
    false,
    `${label}.deserializationStarted`,
  );
  assert.equal(report.consumedByteCount, 0, `${label}.consumedByteCount`);
  assert.equal(report.topologyItemCount, 0, `${label}.topologyItemCount`);
  assert.ok(report.nativeRequestedBytes > 0, `${label}.nativeRequestedBytes`);
  assert.ok(
    report.nativeRequestedBytes <= limits.maxNativeRequestedBytes,
    `${label}.nativeRequestedBytesLimit`,
  );
  assert.ok(
    report.nativeAllocationCalls > 0,
    `${label}.nativeAllocationCalls`,
  );
  assert.equal(
    report.nativeRequestLimitExceeded,
    false,
    `${label}.nativeRequestLimitExceeded`,
  );
  assertArtifactHasNoResult(report, kernel, label);
}

function assertArtifactPreflightComplete(report, inputByteCount, limits, label) {
  assertArtifactReadLimitEchoes(report, limits, label);
  assert.ok(report.preflightWorkUnits > 0, `${label}.preflightWorkUnits`);
  assert.ok(
    report.preflightWorkUnits <= limits.maxPreflightWorkUnits,
    `${label}.preflightWorkUnitsLimit`,
  );
  assert.ok(
    report.preflightMaximumDepth > 0 &&
      report.preflightMaximumDepth <= limits.maxPreflightNestingDepth,
    `${label}.preflightMaximumDepth`,
  );
  assert.ok(
    report.preflightMaximumLocationPower >= 0 &&
      report.preflightMaximumLocationPower <=
        limits.maxPreflightLocationPower,
    `${label}.preflightMaximumLocationPower`,
  );
  assert.equal(
    report.preflightConsumedByteCount,
    inputByteCount,
    `${label}.preflightConsumedByteCount`,
  );
  assert.equal(report.preflightCode, "OK", `${label}.preflightCode`);
  assert.equal(
    report.archivePreflightComplete,
    true,
    `${label}.archivePreflightComplete`,
  );
  assert.equal(
    report.deserializationStarted,
    true,
    `${label}.deserializationStarted`,
  );
}

const asciiEncoder = new TextEncoder();

function asciiBytes(value) {
  return asciiEncoder.encode(value);
}

function findBytes(bytes, needle, label) {
  outer: for (
    let offset = 0;
    offset <= bytes.byteLength - needle.byteLength;
    offset += 1
  ) {
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (bytes[offset + index] !== needle[index]) continue outer;
    }
    return offset;
  }
  assert.fail(`${label}: byte sequence was not found`);
}

function findLineDataOffset(bytes, prefix, label) {
  const prefixBytes = asciiBytes(prefix);
  const prefixOffset = findBytes(bytes, prefixBytes, label);
  const lineEnd = bytes.indexOf(
    "\n".charCodeAt(0),
    prefixOffset + prefixBytes.byteLength,
  );
  assert.ok(lineEnd >= 0, `${label}: line terminator was not found`);
  return lineEnd + 1;
}

function replaceBytes(bytes, offset, removedByteCount, replacement) {
  const output = new Uint8Array(
    bytes.byteLength - removedByteCount + replacement.byteLength,
  );
  output.set(bytes.subarray(0, offset), 0);
  output.set(replacement, offset);
  output.set(
    bytes.subarray(offset + removedByteCount),
    offset + replacement.byteLength,
  );
  return output;
}

function artifactWithCompositeLocation(bytes, power) {
  const oldLine = asciiBytes("Locations 0\n");
  const lineOffset = findBytes(bytes, oldLine, "Locations section");
  const newLine = asciiBytes("Locations 2\n");
  const records = new Uint8Array(1 + 12 * 8 + 1 + 4 + 4 + 4);
  const view = new DataView(records.buffer);
  let offset = 0;
  records[offset] = 1;
  offset += 1;
  for (const value of [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]) {
    view.setFloat64(offset, value, true);
    offset += 8;
  }
  records[offset] = 2;
  offset += 1;
  view.setInt32(offset, 1, true);
  offset += 4;
  view.setInt32(offset, power, true);
  offset += 4;
  view.setInt32(offset, 0, true);
  offset += 4;
  assert.equal(offset, records.byteLength);

  const replacement = new Uint8Array(newLine.byteLength + records.byteLength);
  replacement.set(newLine);
  replacement.set(records, newLine.byteLength);
  return replaceBytes(bytes, lineOffset, oldLine.byteLength, replacement);
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
const observedEdgeTreatmentRelations = new Set();
const observedSolidOffsetRelations = new Set();

function assertBooleanHistory(
  report,
  inputShapes,
  label,
  observedRelations = observedBooleanRelations,
) {
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
    observedRelations.add(record.relation);

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

function selectedEdgeIndices(report) {
  return Array.from(
    { length: report.selectedEdgeCount() },
    (_, index) => report.selectedEdgeIndex(index),
  );
}

function assertEdgeTreatmentReportSuccess(
  report,
  operation,
  amount,
  requestedSeedCount,
  expectedSelectedIndices,
  arenaBefore,
  label,
) {
  assert.equal(report.ok, true, `${report.code}: ${report.message}`);
  assert.equal(report.stage, "complete", `${label}.stage`);
  assert.equal(report.code, "OK", `${label}.code`);
  assert.equal(report.operation, operation, `${label}.operation`);
  assert.equal(report.amount, amount, `${label}.amount`);
  assert.equal(
    report.requestedSeedCount,
    requestedSeedCount,
    `${label}.requestedSeedCount`,
  );
  assert.deepEqual(
    selectedEdgeIndices(report),
    expectedSelectedIndices,
    `${label}.selectedEdgeIndices`,
  );
  assert.equal(
    report.addCount + report.skippedSeedCount,
    expectedSelectedIndices.length,
    `${label}.seedProgress`,
  );
  assert.ok(report.addCount > 0, `${label}.addCount`);
  assert.equal(report.contourCount, report.addCount, `${label}.contourCount`);
  assert.equal(report.buildCount, 1, `${label}.buildCount`);
  assert.equal(report.failedSeedIndex, -1, `${label}.failedSeedIndex`);
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

function assertEdgeTreatmentResult(result, history, expected, label) {
  assert.equal(kernel.getShapeType(result), "solid", `${label}.shapeType`);
  assert.equal(kernel.isValid(result), true, `${label}.valid`);
  assertClose(
    kernel.getVolume(result),
    expected.volume,
    VOLUME_TOLERANCE,
    `${label}.volume`,
  );
  assert.deepEqual(shapeTopologyCounts(result), expected.topology, `${label}.topology`);
  assert.deepEqual(
    shapeTopologyCounts(result),
    history.resultCounts,
    `${label}: report/result topology counts disagree`,
  );
}

function selectedOpeningFaceIndices(report) {
  return Array.from(
    { length: report.selectedOpeningFaceCount() },
    (_, index) => report.selectedOpeningFaceIndex(index),
  );
}

function assertSolidOffsetReportSuccess(
  report,
  operation,
  direction,
  amount,
  tolerance,
  requestedOpeningFaceCount,
  expectedSelectedIndices,
  arenaBefore,
  label,
) {
  assert.equal(report.ok, true, `${report.code}: ${report.message}`);
  assert.equal(report.stage, "complete", `${label}.stage`);
  assert.equal(report.code, "OK", `${label}.code`);
  assert.equal(report.operation, operation, `${label}.operation`);
  assert.equal(report.direction, direction, `${label}.direction`);
  assert.equal(report.amount, amount, `${label}.amount`);
  assert.equal(report.tolerance, tolerance, `${label}.tolerance`);
  assert.equal(
    report.requestedOpeningFaceCount,
    requestedOpeningFaceCount,
    `${label}.requestedOpeningFaceCount`,
  );
  assert.deepEqual(
    selectedOpeningFaceIndices(report),
    expectedSelectedIndices,
    `${label}.selectedOpeningFaceIndices`,
  );
  assert.equal(report.buildCount, 1, `${label}.buildCount`);
  assert.equal(report.occtStatus, 0, `${label}.occtStatus`);
  assert.equal(
    report.failedOpeningFaceIndex,
    -1,
    `${label}.failedOpeningFaceIndex`,
  );
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
  assert.throws(
    () => report.selectedOpeningFaceIndex(-1),
    `${label}: negative selected-opening index must fail`,
  );
  assert.throws(
    () => report.selectedOpeningFaceIndex(expectedSelectedIndices.length),
    `${label}: out-of-range selected-opening index must fail`,
  );
}

function assertSolidOffsetResult(result, history, expected, label) {
  assert.equal(kernel.getShapeType(result), "solid", `${label}.shapeType`);
  assert.equal(kernel.isValid(result), true, `${label}.valid`);
  assertClose(
    kernel.getVolume(result),
    expected.volume,
    VOLUME_TOLERANCE,
    `${label}.volume`,
  );
  assert.deepEqual(shapeTopologyCounts(result), expected.topology, `${label}.topology`);
  assert.deepEqual(
    shapeTopologyCounts(result),
    history.resultCounts,
    `${label}: report/result topology counts disagree`,
  );
  assertBounds(boundsOf(result), expected.bounds, `${label}.bounds`);
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

  runFixture("bounded artifact binary BREP", () => {
    const source = kernel.makeBox(1, 2, 3);
    const arenaWithSource = kernel.getShapeCount();
    let bytes;
    withReport(
      Module.invariantcadWriteArtifactBrep(
        kernel,
        source,
        1_000_000,
        ARTIFACT_NATIVE_REQUEST_LIMIT,
      ),
      (report) => {
        assert.equal(report.ok, true);
        assert.equal(report.stage, "complete");
        assert.equal(report.code, "OK");
        assert.equal(report.maxOutputBytes, 1_000_000);
        assert.equal(
          report.maxNativeRequestedBytes,
          ARTIFACT_NATIVE_REQUEST_LIMIT,
        );
        assert.ok(report.nativeRequestedBytes > 0);
        assert.ok(
          report.nativeRequestedBytes <= report.maxNativeRequestedBytes,
        );
        assert.ok(report.nativeAllocationCalls > 0);
        assert.equal(report.nativeRequestLimitExceeded, false);
        assert.equal(report.hasBytes(), true);
        assert.ok(report.byteCount() > 0);
        bytes = report.copyBytes();
        assert.ok(bytes instanceof Uint8Array);
        assert.equal(bytes.byteLength, report.byteCount());
      },
    );
    assert.equal(kernel.getShapeCount(), arenaWithSource);

    withReport(
      Module.invariantcadWriteArtifactBrep(
        kernel,
        source,
        0,
        ARTIFACT_NATIVE_REQUEST_LIMIT,
      ),
      (failed) => {
        assert.equal(failed.ok, false);
        assert.equal(failed.code, "INVALID_OUTPUT_LIMIT");
        assert.equal(failed.hasBytes(), false);
      },
    );
    withReport(
      Module.invariantcadWriteArtifactBrep(kernel, source, 1_000, 0),
      (failed) => {
        assert.equal(failed.ok, false);
        assert.equal(failed.code, "INVALID_NATIVE_REQUEST_LIMIT");
        assert.equal(failed.hasBytes(), false);
      },
    );
    withReport(
      Module.invariantcadWriteArtifactBrep(
        kernel,
        0xffff_ffff,
        1_000,
        ARTIFACT_NATIVE_REQUEST_LIMIT,
      ),
      (failed) => {
        assert.equal(failed.ok, false);
        assert.equal(failed.code, "INVALID_SHAPE_ID");
        assert.equal(failed.hasBytes(), false);
      },
    );
    assert.equal(kernel.getShapeCount(), arenaWithSource);

    withReport(
      Module.invariantcadWriteArtifactBrep(
        kernel,
        source,
        bytes.byteLength,
        ARTIFACT_NATIVE_REQUEST_LIMIT,
      ),
      (report) => {
        assert.equal(report.ok, true);
        assert.equal(report.maxOutputBytes, bytes.byteLength);
        assert.deepEqual(report.copyBytes(), bytes);
      },
    );
    withReport(
      Module.invariantcadWriteArtifactBrep(
        kernel,
        source,
        bytes.byteLength - 1,
        ARTIFACT_NATIVE_REQUEST_LIMIT,
      ),
      (report) => {
        assert.equal(report.ok, false);
        assert.equal(report.stage, "serialization");
        assert.equal(report.code, "OUTPUT_LIMIT_EXCEEDED");
        assert.equal(report.hasBytes(), false);
        assert.equal(report.byteCount(), 0);
      },
    );
    assert.equal(kernel.getShapeCount(), arenaWithSource);

    const guarded = new Uint8Array(bytes.byteLength + 2);
    guarded[0] = 0xa5;
    guarded[guarded.byteLength - 1] = 0x5a;
    guarded.set(bytes, 1);
    const borrowed = guarded.subarray(1, guarded.byteLength - 1);
    const readLimits = artifactReadLimits(borrowed.byteLength);
    const report = readArtifactBrep(kernel, borrowed, readLimits);
    const alias = report.clone();
    const foreign = new Module.OcctKernel();
    try {
      assert.equal(report.ok, true);
      assert.equal(report.stage, "complete");
      assert.equal(report.code, "OK");
      assert.equal(report.inputByteCount, borrowed.byteLength);
      assert.equal(report.consumedByteCount, borrowed.byteLength);
      assert.ok(report.topologyItemCount > 0);
      assert.ok(report.topologyItemCount <= 100);
      assertArtifactPreflightComplete(
        report,
        borrowed.byteLength,
        readLimits,
        "artifact.success",
      );
      assert.ok(report.nativeRequestedBytes > 0);
      assert.ok(report.nativeRequestedBytes <= report.maxNativeRequestedBytes);
      assert.ok(report.nativeAllocationCalls > 0);
      assert.equal(report.nativeRequestLimitExceeded, false);
      assert.equal(report.hasResult(), true);
      assert.equal(report.transferCode(kernel), "READY");
      assert.equal(report.transferCode(foreign), "WRONG_KERNEL");
      assert.throws(() => report.takeResultId(foreign));
      assert.equal(report.hasResult(), true);
      assert.equal(report.transferCode(kernel), "READY");
      assert.equal(kernel.getShapeCount(), arenaWithSource);
      const restored = alias.takeResultId(kernel);
      assert.equal(kernel.getShapeCount(), arenaWithSource + 1);
      assert.equal(report.hasResult(), false);
      assert.equal(report.transferCode(kernel), "ALREADY_TRANSFERRED");
      assert.equal(alias.transferCode(kernel), "ALREADY_TRANSFERRED");
      assert.throws(() => report.takeResultId(kernel));
      assert.equal(kernel.getShapeType(restored), "solid");
      assert.equal(kernel.isValid(restored), true);
      assertClose(kernel.getVolume(restored), 6, VOLUME_TOLERANCE, "artifact.volume");
      assert.equal(kernel.subShapeCount(restored, "face"), 6);
      kernel.release(restored);
    } finally {
      alias.delete();
      report.delete();
      foreign.delete();
    }
    assert.equal(guarded[0], 0xa5);
    assert.equal(guarded[guarded.byteLength - 1], 0x5a);
    assert.deepEqual(borrowed, bytes);
    assert.equal(kernel.getShapeCount(), arenaWithSource);

    const untakenLimits = artifactReadLimits(bytes.byteLength);
    const untaken = readArtifactBrep(kernel, bytes, untakenLimits);
    const untakenAlias = untaken.clone();
    assert.equal(untaken.ok, true);
    assertArtifactPreflightComplete(
      untaken,
      bytes.byteLength,
      untakenLimits,
      "artifact.untaken",
    );
    assert.equal(untaken.transferCode(kernel), "READY");
    untaken.delete();
    assert.equal(untakenAlias.transferCode(kernel), "READY");
    untakenAlias.delete();
    assert.equal(kernel.getShapeCount(), arenaWithSource);

    const assertSameRuntimeRecovery = (label) => {
      const inputBefore = bytes.slice();
      const limits = artifactReadLimits(bytes.byteLength);
      withReport(readArtifactBrep(kernel, bytes, limits), (recovery) => {
        assert.equal(recovery.ok, true, `${label}.ok`);
        assert.equal(recovery.stage, "complete", `${label}.stage`);
        assert.equal(recovery.code, "OK", `${label}.code`);
        assert.equal(
          recovery.inputByteCount,
          bytes.byteLength,
          `${label}.inputByteCount`,
        );
        assert.equal(
          recovery.consumedByteCount,
          bytes.byteLength,
          `${label}.consumedByteCount`,
        );
        assert.ok(recovery.topologyItemCount > 0, `${label}.topologyItemCount`);
        assertArtifactPreflightComplete(
          recovery,
          bytes.byteLength,
          limits,
          label,
        );
        assert.equal(recovery.hasResult(), true, `${label}.hasResult`);
        assert.equal(recovery.transferCode(kernel), "READY", `${label}.transfer`);
        assert.equal(
          kernel.getShapeCount(),
          arenaWithSource,
          `${label}.ownedResult`,
        );
        const recovered = recovery.takeResultId(kernel);
        assert.equal(
          kernel.getShapeCount(),
          arenaWithSource + 1,
          `${label}.transferredResult`,
        );
        assert.equal(kernel.getShapeType(recovered), "solid", `${label}.type`);
        assert.equal(kernel.isValid(recovered), true, `${label}.valid`);
        assertClose(
          kernel.getVolume(recovered),
          6,
          VOLUME_TOLERANCE,
          `${label}.volume`,
        );
        kernel.release(recovered);
      });
      assert.deepEqual(bytes, inputBefore, `${label}.input`);
      assert.equal(kernel.getShapeCount(), arenaWithSource, `${label}.arena`);
    };

    const validationFailures = [
      {
        label: "empty",
        input: new Uint8Array(),
        limits: artifactReadLimits(1),
        expectedInputByteCount: 0,
        code: "EMPTY_INPUT",
      },
      {
        label: "input cap",
        input: bytes,
        limits: artifactReadLimits(bytes.byteLength - 1),
        expectedInputByteCount: bytes.byteLength,
        code: "INPUT_LIMIT_EXCEEDED",
      },
      {
        label: "invalid input cap",
        input: bytes,
        limits: artifactReadLimits(0),
        expectedInputByteCount: 0,
        code: "INVALID_INPUT_LIMIT",
      },
      {
        label: "invalid topology cap",
        input: bytes,
        limits: artifactReadLimits(bytes.byteLength, {
          maxTopologyItems: 0,
        }),
        expectedInputByteCount: 0,
        code: "INVALID_TOPOLOGY_LIMIT",
      },
      {
        label: "invalid native request cap",
        input: bytes,
        limits: artifactReadLimits(bytes.byteLength, {
          maxNativeRequestedBytes: 0,
        }),
        expectedInputByteCount: 0,
        code: "INVALID_NATIVE_REQUEST_LIMIT",
      },
      {
        label: "invalid preflight work cap",
        input: bytes,
        limits: artifactReadLimits(bytes.byteLength, {
          maxPreflightWorkUnits: 0,
        }),
        expectedInputByteCount: 0,
        code: "INVALID_PREFLIGHT_WORK_LIMIT",
      },
      {
        label: "invalid preflight nesting cap",
        input: bytes,
        limits: artifactReadLimits(bytes.byteLength, {
          maxPreflightNestingDepth: 0,
        }),
        expectedInputByteCount: 0,
        code: "INVALID_PREFLIGHT_NESTING_LIMIT",
      },
      {
        label: "unsupported preflight nesting cap",
        input: bytes,
        limits: artifactReadLimits(bytes.byteLength, {
          maxPreflightNestingDepth: 65,
        }),
        expectedInputByteCount: 0,
        code: "INVALID_PREFLIGHT_NESTING_LIMIT",
      },
      {
        label: "invalid preflight location-power cap",
        input: bytes,
        limits: artifactReadLimits(bytes.byteLength, {
          maxPreflightLocationPower: 0,
        }),
        expectedInputByteCount: 0,
        code: "INVALID_PREFLIGHT_LOCATION_POWER_LIMIT",
      },
    ];
    for (const failure of validationFailures) {
      const inputBefore = failure.input.slice();
      withReport(
        readArtifactBrep(kernel, failure.input, failure.limits),
        (failed) => {
          assert.equal(failed.ok, false, `${failure.label}.ok`);
          assert.equal(failed.stage, "validation", `${failure.label}.stage`);
          assert.equal(failed.code, failure.code, `${failure.label}.code`);
          assert.equal(
            failed.inputByteCount,
            failure.expectedInputByteCount,
            `${failure.label}.inputByteCount`,
          );
          assertArtifactReadLimitEchoes(
            failed,
            failure.limits,
            failure.label,
          );
          assertArtifactPreflightNotRun(failed, failure.label);
          assert.equal(
            failed.nativeRequestedBytes,
            0,
            `${failure.label}.nativeRequestedBytes`,
          );
          assert.equal(
            failed.nativeAllocationCalls,
            0,
            `${failure.label}.nativeAllocationCalls`,
          );
          assert.equal(
            failed.nativeRequestLimitExceeded,
            false,
            `${failure.label}.nativeRequestLimitExceeded`,
          );
          assertArtifactHasNoResult(failed, kernel, failure.label);
        },
      );
      assert.deepEqual(
        failure.input,
        inputBefore,
        `${failure.label}.input`,
      );
      assert.equal(
        kernel.getShapeCount(),
        arenaWithSource,
        `${failure.label}.arena`,
      );
    }
    assertSameRuntimeRecovery("validationFailures.recovery");

    const copyFailureLimits = artifactReadLimits(bytes.byteLength, {
      maxNativeRequestedBytes: 1,
    });
    const copyFailureInputBefore = bytes.slice();
    withReport(
      readArtifactBrep(kernel, bytes, copyFailureLimits),
      (copyFailure) => {
        assert.equal(copyFailure.ok, false, "copyFailure.ok");
        assert.equal(copyFailure.stage, "copy", "copyFailure.stage");
        assert.equal(
          copyFailure.code,
          "NATIVE_REQUEST_LIMIT_EXCEEDED",
          "copyFailure.code",
        );
        assert.equal(
          copyFailure.inputByteCount,
          bytes.byteLength,
          "copyFailure.inputByteCount",
        );
        assertArtifactReadLimitEchoes(
          copyFailure,
          copyFailureLimits,
          "copyFailure",
        );
        assertArtifactPreflightNotRun(copyFailure, "copyFailure");
        assert.ok(
          copyFailure.nativeRequestedBytes <=
            copyFailureLimits.maxNativeRequestedBytes,
          "copyFailure.nativeRequestedBytes",
        );
        assert.ok(
          copyFailure.nativeAllocationCalls > 0,
          "copyFailure.nativeAllocationCalls",
        );
        assert.equal(
          copyFailure.nativeRequestLimitExceeded,
          true,
          "copyFailure.nativeRequestLimitExceeded",
        );
        assertArtifactHasNoResult(copyFailure, kernel, "copyFailure");
      },
    );
    assert.deepEqual(bytes, copyFailureInputBefore, "copyFailure.input");
    assert.equal(kernel.getShapeCount(), arenaWithSource, "copyFailure.arena");
    assertSameRuntimeRecovery("copyFailure.recovery");

    const wrongVersion = bytes.slice();
    const versionMarker = findBytes(
      wrongVersion,
      asciiBytes("Topology V4"),
      "archive version",
    );
    wrongVersion[versionMarker + "Topology V".length] = "3".charCodeAt(0);

    const wrongSection = bytes.slice();
    const sectionOffset = findBytes(
      wrongSection,
      asciiBytes("Curves "),
      "Curves section",
    );
    wrongSection[sectionOffset] = "X".charCodeAt(0);

    const wrongCount = bytes.slice();
    const countPrefix = asciiBytes("Curve2ds ");
    const countPrefixOffset = findBytes(
      wrongCount,
      countPrefix,
      "Curve2ds count",
    );
    wrongCount[countPrefixOffset + countPrefix.byteLength] =
      "x".charCodeAt(0);

    const wrongGeometryTag = bytes.slice();
    const firstCurve2dOffset = findLineDataOffset(
      wrongGeometryTag,
      "Curve2ds ",
      "Curve2ds records",
    );
    wrongGeometryTag[firstCurve2dOffset] = 0xff;

    const wrongBoolean = bytes.slice();
    const firstShapeOffset = findLineDataOffset(
      wrongBoolean,
      "\nTShapes ",
      "TShape records",
    );
    assert.equal(
      wrongBoolean[firstShapeOffset],
      7,
      "the owned box archive must begin with a vertex TShape",
    );
    const firstVertexRepresentationOffset = firstShapeOffset + 1 + 4 * 8;
    assert.equal(
      wrongBoolean[firstVertexRepresentationOffset],
      0,
      "the first box vertex must have no point representation",
    );
    wrongBoolean[firstVertexRepresentationOffset + 1] = 2;

    const wrongReference = bytes.slice();
    const rootReferenceOffset = wrongReference.byteLength - 9;
    const wrongReferenceView = new DataView(
      wrongReference.buffer,
      wrongReference.byteOffset,
      wrongReference.byteLength,
    );
    assert.ok(
      wrongReference[rootReferenceOffset] <= 3,
      "the owned archive must end in a shape orientation",
    );
    assert.equal(
      wrongReferenceView.getInt32(rootReferenceOffset + 1, true),
      1,
      "the owned archive must use the canonical reverse root index",
    );
    wrongReferenceView.setInt32(rootReferenceOffset + 1, 0, true);

    const trailing = new Uint8Array(bytes.byteLength + 1);
    trailing.set(bytes);
    trailing[trailing.byteLength - 1] = 0xa5;

    const preflightFailures = [
      {
        label: "wrong version",
        input: wrongVersion,
        code: "UNSUPPORTED_ARCHIVE",
      },
      {
        label: "wrong section",
        input: wrongSection,
        code: "INVALID_SECTION",
      },
      {
        label: "wrong count",
        input: wrongCount,
        code: "INVALID_COUNT",
      },
      {
        label: "wrong geometry tag",
        input: wrongGeometryTag,
        code: "INVALID_TAG",
      },
      {
        label: "wrong boolean",
        input: wrongBoolean,
        code: "INVALID_BOOLEAN",
      },
      {
        label: "wrong root reference",
        input: wrongReference,
        code: "INVALID_REFERENCE",
      },
      {
        label: "truncated",
        input: bytes.slice(0, -1),
        code: "TRUNCATED",
      },
      {
        label: "trailing",
        input: trailing,
        code: "TRAILING_INPUT",
      },
      {
        label: "single power-one location collapse",
        input: artifactWithCompositeLocation(bytes, 1),
        code: "PROFILE_MISMATCH",
        expectedPreflightMaximumDepth: 1,
        expectedPreflightMaximumLocationPower: 1,
      },
      {
        label: "preflight work cap",
        input: bytes,
        limits: { maxPreflightWorkUnits: 1 },
        code: "WORK_LIMIT_EXCEEDED",
      },
      {
        label: "preflight topology cap",
        input: bytes,
        limits: { maxTopologyItems: 1 },
        code: "TOPOLOGY_LIMIT_EXCEEDED",
      },
      {
        label: "preflight nesting cap",
        input: bytes,
        limits: { maxPreflightNestingDepth: 1 },
        code: "NESTING_LIMIT_EXCEEDED",
      },
      {
        label: "preflight location-power cap",
        input: artifactWithCompositeLocation(bytes, 2),
        limits: { maxPreflightLocationPower: 1 },
        code: "LOCATION_POWER_LIMIT_EXCEEDED",
        expectedPreflightMaximumDepth: 0,
        expectedPreflightMaximumLocationPower: 0,
      },
    ];
    for (const failure of preflightFailures) {
      const limits = artifactReadLimits(
        failure.input.byteLength,
        failure.limits,
      );
      const inputBefore = failure.input.slice();
      withReport(
        readArtifactBrep(kernel, failure.input, limits),
        (failed) => {
          assertArtifactPreflightRejected(
            failed,
            failure.input.byteLength,
            limits,
            failure.code,
            failure.label,
          );
          if (failure.expectedPreflightMaximumDepth !== undefined) {
            assert.equal(
              failed.preflightMaximumDepth,
              failure.expectedPreflightMaximumDepth,
              `${failure.label}.exactPreflightMaximumDepth`,
            );
          }
          if (
            failure.expectedPreflightMaximumLocationPower !== undefined
          ) {
            assert.equal(
              failed.preflightMaximumLocationPower,
              failure.expectedPreflightMaximumLocationPower,
              `${failure.label}.exactPreflightMaximumLocationPower`,
            );
          }
        },
      );
      assert.deepEqual(failure.input, inputBefore, `${failure.label}.input`);
      assert.equal(
        kernel.getShapeCount(),
        arenaWithSource,
        `${failure.label}.arena`,
      );
      assertSameRuntimeRecovery(`${failure.label}.recovery`);
    }

    const decodeFailureLimits = artifactReadLimits(bytes.byteLength, {
      maxNativeRequestedBytes: bytes.byteLength + 4096,
    });
    const decodeFailureInputBefore = bytes.slice();
    withReport(
      readArtifactBrep(kernel, bytes, decodeFailureLimits),
      (decodeFailure) => {
        assert.equal(decodeFailure.ok, false, "decodeFailure.ok");
        assert.equal(
          decodeFailure.stage,
          "deserialization",
          "decodeFailure.stage",
        );
        assert.equal(
          decodeFailure.code,
          "NATIVE_REQUEST_LIMIT_EXCEEDED",
          "decodeFailure.code",
        );
        assert.equal(
          decodeFailure.inputByteCount,
          bytes.byteLength,
          "decodeFailure.inputByteCount",
        );
        assertArtifactPreflightComplete(
          decodeFailure,
          bytes.byteLength,
          decodeFailureLimits,
          "decodeFailure",
        );
        assert.ok(
          decodeFailure.consumedByteCount >= 0 &&
            decodeFailure.consumedByteCount <= bytes.byteLength,
          "decodeFailure.consumedByteCount",
        );
        assert.equal(
          decodeFailure.topologyItemCount,
          0,
          "decodeFailure.topologyItemCount",
        );
        assert.ok(
          decodeFailure.nativeRequestedBytes <=
            decodeFailureLimits.maxNativeRequestedBytes,
          "decodeFailure.nativeRequestedBytes",
        );
        assert.ok(
          decodeFailure.nativeAllocationCalls > 0,
          "decodeFailure.nativeAllocationCalls",
        );
        assert.equal(
          decodeFailure.nativeRequestLimitExceeded,
          true,
          "decodeFailure.nativeRequestLimitExceeded",
        );
        assertArtifactHasNoResult(decodeFailure, kernel, "decodeFailure");
      },
    );
    assert.deepEqual(bytes, decodeFailureInputBefore, "decodeFailure.input");
    assert.equal(kernel.getShapeCount(), arenaWithSource, "decodeFailure.arena");
    assertSameRuntimeRecovery("decodeFailure.recovery");
  });

  runFixture("bounded artifact positive round-trip corpus", () => {
    const numericVector = (VectorType, values) => {
      const result = new VectorType();
      for (const value of values) result.push_back(value);
      return result;
    };
    const located = (shape, [x, y, z]) => {
      const matrix = numericVector(Module.VectorDouble, [
        1,
        0,
        0,
        x,
        0,
        1,
        0,
        y,
        0,
        0,
        1,
        z,
      ]);
      try {
        return kernel.located(shape, matrix);
      } finally {
        matrix.delete();
      }
    };
    const structuralSnapshot = (shape) => ({
      shapeType: kernel.getShapeType(shape),
      topology: shapeTopologyCounts(shape),
      bounds: boundsOf(shape),
      volume: kernel.getVolume(shape),
      surfaceArea: kernel.getSurfaceArea(shape),
      length: kernel.getLength(shape),
    });
    const assertStructuralRoundTrip = (shape, expected, label) => {
      assert.equal(kernel.getShapeType(shape), expected.shapeType, `${label}.type`);
      assert.equal(kernel.isValid(shape), true, `${label}.valid`);
      assert.deepEqual(
        shapeTopologyCounts(shape),
        expected.topology,
        `${label}.topology`,
      );
      assertBounds(boundsOf(shape), expected.bounds, `${label}.bounds`);
      for (const [measure, actual] of [
        ["volume", kernel.getVolume(shape)],
        ["surfaceArea", kernel.getSurfaceArea(shape)],
        ["length", kernel.getLength(shape)],
      ]) {
        assertClose(
          actual,
          expected[measure],
          VOLUME_TOLERANCE,
          `${label}.${measure}`,
        );
      }
    };
    const roundTrip = ({
      label,
      source,
      verify = () => {},
      expectCompositeLocation = false,
    }) => {
      assert.equal(kernel.isValid(source), true, `${label}.source.valid`);
      verify(source, `${label}.source`);
      const expected = structuralSnapshot(source);
      let bytes;
      withReport(
        Module.invariantcadWriteArtifactBrep(
          kernel,
          source,
          4 * 1024 * 1024,
          ARTIFACT_NATIVE_REQUEST_LIMIT,
        ),
        (report) => {
          assert.equal(report.ok, true, `${report.code}: ${report.message}`);
          assert.equal(report.stage, "complete", `${label}.write.stage`);
          assert.equal(report.code, "OK", `${label}.write.code`);
          assert.equal(report.maxOutputBytes, 4 * 1024 * 1024);
          assert.equal(
            report.maxNativeRequestedBytes,
            ARTIFACT_NATIVE_REQUEST_LIMIT,
          );
          assert.ok(report.nativeRequestedBytes > 0);
          assert.ok(
            report.nativeRequestedBytes <= report.maxNativeRequestedBytes,
          );
          assert.ok(report.nativeAllocationCalls > 0);
          assert.equal(report.nativeRequestLimitExceeded, false);
          assert.equal(report.hasBytes(), true, `${label}.write.hasBytes`);
          assert.ok(report.byteCount() > 0, `${label}.write.byteCount`);
          bytes = report.copyBytes();
          assert.equal(bytes.byteLength, report.byteCount());
        },
      );

      const limits = artifactReadLimits(bytes.byteLength, {
        maxTopologyItems: 10_000,
      });
      withReport(readArtifactBrep(kernel, bytes, limits), (report) => {
        assert.equal(report.ok, true, `${report.code}: ${report.message}`);
        assert.equal(report.stage, "complete", `${label}.read.stage`);
        assert.equal(report.code, "OK", `${label}.read.code`);
        assert.equal(
          report.inputByteCount,
          bytes.byteLength,
          `${label}.read.inputByteCount`,
        );
        assert.equal(
          report.consumedByteCount,
          bytes.byteLength,
          `${label}.read.consumedByteCount`,
        );
        assert.ok(report.topologyItemCount > 0, `${label}.read.topology`);
        assert.ok(
          report.topologyItemCount <= limits.maxTopologyItems,
          `${label}.read.topologyLimit`,
        );
        assertArtifactPreflightComplete(
          report,
          bytes.byteLength,
          limits,
          `${label}.read`,
        );
        if (expectCompositeLocation) {
          assert.ok(
            report.preflightMaximumLocationPower > 0,
            `${label}.read.locationPower`,
          );
        }
        assert.ok(
          report.nativeRequestedBytes > 0,
          `${label}.read.nativeRequestedBytes`,
        );
        assert.ok(
          report.nativeRequestedBytes <= report.maxNativeRequestedBytes,
          `${label}.read.nativeRequestedBytesLimit`,
        );
        assert.ok(
          report.nativeAllocationCalls > 0,
          `${label}.read.nativeAllocationCalls`,
        );
        assert.equal(report.nativeRequestLimitExceeded, false);
        assert.equal(report.hasResult(), true, `${label}.read.hasResult`);
        assert.equal(
          report.transferCode(kernel),
          "READY",
          `${label}.read.transferCode`,
        );

        const restored = report.takeResultId(kernel);
        try {
          assertStructuralRoundTrip(restored, expected, `${label}.restored`);
          verify(restored, `${label}.restored`);
        } finally {
          kernel.release(restored);
        }
        assert.equal(report.hasResult(), false, `${label}.read.transferred`);
        assert.equal(
          report.transferCode(kernel),
          "ALREADY_TRANSFERRED",
          `${label}.read.transferCodeAfterTransfer`,
        );
      });
    };

    const poles = numericVector(Module.VectorDouble, [
      0,
      0,
      0,
      5,
      5,
      0,
      10,
      0,
      0,
    ]);
    const weights = numericVector(Module.VectorDouble, [1, 2, 1]);
    const knots = numericVector(Module.VectorDouble, [0, 1]);
    const multiplicities = numericVector(Module.VectorInt, [3, 3]);
    let rationalSpline;
    try {
      rationalSpline = kernel.makeBSplineEdge(
        poles,
        weights,
        knots,
        multiplicities,
        2,
        false,
      );
    } finally {
      poles.delete();
      weights.delete();
      knots.delete();
      multiplicities.delete();
    }

    const booleanTarget = kernel.makeBox(10, 10, 10);
    const booleanTool = translatedBox([10, 10, 10], [5, 0, 0]);
    const booleanArenaBefore = kernel.getShapeCount();
    let booleanResult;
    withReport(
      exactBoolean(booleanOperations.union, booleanTarget, [booleanTool]),
      (report) => {
        assertBooleanReportSuccess(
          report,
          booleanOperations.union,
          1,
          booleanArenaBefore,
          "artifactCorpus.boolean",
        );
        booleanResult = report.takeResultId(kernel);
      },
    );

    const sharedCylinder = kernel.makeCylinder(2, 5);
    const firstLocation = located(sharedCylinder, [10, 0, 0]);
    const nestedLocation = located(firstLocation, [0, 20, 0]);
    assert.equal(kernel.isSame(sharedCylinder, firstLocation), false);
    assert.equal(kernel.isSame(firstLocation, nestedLocation), false);
    const locatedChildren = vector([
      sharedCylinder,
      firstLocation,
      nestedLocation,
    ]);
    let locatedCompound;
    try {
      locatedCompound = kernel.makeCompound(locatedChildren);
    } finally {
      locatedChildren.delete();
    }

    for (const testCase of [
      {
        label: "artifactCorpus.rationalSpline",
        source: rationalSpline,
        verify: (shape, label) => {
          assert.equal(kernel.getShapeType(shape), "edge", `${label}.type`);
          assert.equal(kernel.curveType(shape), "bspline", `${label}.curveType`);
        },
      },
      {
        label: "artifactCorpus.booleanResult",
        source: booleanResult,
        verify: (shape, label) => {
          assertClose(
            kernel.getVolume(shape),
            1_500,
            VOLUME_TOLERANCE,
            `${label}.volume`,
          );
        },
      },
      {
        label: "artifactCorpus.locatedSharedCompound",
        source: locatedCompound,
        expectCompositeLocation: true,
        verify: (shape, label) => {
          assert.equal(kernel.getShapeType(shape), "compound", `${label}.type`);
          assert.deepEqual(
            shapeTopologyCounts(shape),
            { faces: 9, edges: 9, vertices: 6 },
            `${label}.topology`,
          );
        },
      },
    ]) {
      roundTrip(testCase);
    }
  });

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

  runFixture("exact edge-treatment validation", () => {
    const input = kernel.makeBox(10, 20, 30);
    const inputEdges = edgesOf(input);
    const other = kernel.makeBox(4, 4, 4);
    const otherEdge = edgesOf(other)[0];
    const inputFace = facesOf(input)[0];
    const inputBefore = snapshotShape(input);
    const otherBefore = snapshotShape(other);
    const arenaBefore = kernel.getShapeCount();

    const failures = [
      {
        label: "invalidEdgeTreatmentOperation",
        report: exactEdgeTreatment(999, input, [inputEdges[0]], 1),
        stage: "validation",
        code: "INVALID_OPERATION",
      },
      {
        label: "invalidEdgeTreatmentAmount",
        report: exactEdgeTreatment(
          edgeTreatmentOperations.fillet,
          input,
          [inputEdges[0]],
          Number.NaN,
        ),
        stage: "validation",
        code: "INVALID_AMOUNT",
      },
      {
        label: "emptyEdgeTreatmentSeeds",
        report: exactEdgeTreatment(
          edgeTreatmentOperations.chamfer,
          input,
          [],
          1,
        ),
        stage: "validation",
        code: "EMPTY_SEED_LIST",
      },
      {
        label: "negativeEdgeTreatmentHistoryLimit",
        report: exactEdgeTreatment(
          edgeTreatmentOperations.fillet,
          input,
          [inputEdges[0]],
          1,
          kernel,
          -1,
        ),
        stage: "validation",
        code: "INVALID_HISTORY_RECORD_LIMIT",
      },
      {
        label: "edgeTreatmentSeedNotEdge",
        report: exactEdgeTreatment(
          edgeTreatmentOperations.fillet,
          input,
          [inputFace],
          1,
        ),
        stage: "seed-validation",
        code: "SEED_NOT_EDGE",
      },
      {
        label: "edgeTreatmentEdgeNotInInput",
        report: exactEdgeTreatment(
          edgeTreatmentOperations.chamfer,
          input,
          [otherEdge],
          1,
        ),
        stage: "seed-validation",
        code: "EDGE_NOT_IN_INPUT",
      },
      {
        label: "zeroEdgeTreatmentHistoryLimit",
        report: exactEdgeTreatment(
          edgeTreatmentOperations.chamfer,
          input,
          [inputEdges[0]],
          1,
          kernel,
          0,
        ),
        stage: "history",
        code: "HISTORY_RECORD_LIMIT_EXCEEDED",
      },
    ];

    for (const testCase of failures) {
      withReport(testCase.report, (report) => {
        assert.equal(report.ok, false, testCase.label);
        assert.equal(report.stage, testCase.stage, `${testCase.label}.stage`);
        assert.equal(report.code, testCase.code, `${testCase.label}.code`);
        assert.equal(report.hasResult(), false, `${testCase.label}.hasResult`);
        assert.equal(
          report.transferCode(kernel),
          "NO_RESULT",
          `${testCase.label}.transferCode`,
        );
        assertNoBooleanHistory(report, testCase.label);
        assert.throws(() => report.takeResultId(kernel), testCase.label);
      });
      assert.equal(kernel.getShapeCount(), arenaBefore, `${testCase.label}.arena`);
    }

    assertShapeSnapshot(input, inputBefore, "edgeTreatmentValidation.input");
    assertShapeSnapshot(other, otherBefore, "edgeTreatmentValidation.other");
  });

  for (const fixture of [
    {
      label: "single-edge exact fillet",
      operation: edgeTreatmentOperations.fillet,
      amount: 2,
      expected: {
        volume: 5974.247779607694,
        topology: { faces: 7, edges: 15, vertices: 10 },
      },
    },
    {
      label: "single-edge exact chamfer",
      operation: edgeTreatmentOperations.chamfer,
      amount: 2,
      expected: {
        volume: 5940,
        topology: { faces: 7, edges: 15, vertices: 10 },
      },
    },
  ]) {
    runFixture(fixture.label, () => {
      const input = kernel.makeBox(10, 20, 30);
      const inputEdges = edgesOf(input);
      const verticalEdges = inputEdges.filter((edge) => {
        const bounds = boundsOf(edge);
        return (
          extent(bounds, "z") > 29.99 &&
          extent(bounds, "x") < SELECTION_TOLERANCE &&
          extent(bounds, "y") < SELECTION_TOLERANCE
        );
      });
      assert.equal(verticalEdges.length, 4, `${fixture.label}.verticalEdges`);
      const selected = verticalEdges[0];
      const canonicalIndex = inputEdges.indexOf(selected);
      const inputBefore = snapshotShape(input);
      const arenaBefore = kernel.getShapeCount();
      const report = exactEdgeTreatment(
        fixture.operation,
        input,
        [selected, selected],
        fixture.amount,
      );
      withReport(report, (ownedReport) => {
        assertEdgeTreatmentReportSuccess(
          ownedReport,
          fixture.operation,
          fixture.amount,
          2,
          [canonicalIndex],
          arenaBefore,
          fixture.label,
        );
        assert.equal(ownedReport.addCount, 1, `${fixture.label}.addCount`);
        assert.equal(ownedReport.skippedSeedCount, 0, `${fixture.label}.skipped`);
        const history = assertBooleanHistory(
          ownedReport,
          [input],
          fixture.label,
          observedEdgeTreatmentRelations,
        );
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
          const result = clone.takeResultId(kernel);
          try {
            assertEdgeTreatmentResult(result, history, fixture.expected, fixture.label);
            assert.equal(ownedReport.hasResult(), false);
            assert.equal(ownedReport.transferCode(kernel), "ALREADY_TRANSFERRED");
            assert.throws(() => ownedReport.takeResultId(kernel));
          } finally {
            kernel.release(result);
          }
        } finally {
          clone.delete();
        }
      });
      assert.equal(kernel.getShapeCount(), arenaBefore, `${fixture.label}.arena`);
      assertShapeSnapshot(input, inputBefore, `${fixture.label}.input`);
    });
  }

  for (const fixture of [
    {
      label: "four-edge exact fillet",
      operation: edgeTreatmentOperations.fillet,
      amount: 2,
      expected: {
        volume: 5896.991118430776,
        topology: { faces: 10, edges: 24, vertices: 16 },
      },
    },
    {
      label: "four-edge exact chamfer",
      operation: edgeTreatmentOperations.chamfer,
      amount: 2,
      expected: {
        volume: 5760,
        topology: { faces: 10, edges: 24, vertices: 16 },
      },
    },
  ]) {
    runFixture(fixture.label, () => {
      const input = kernel.makeBox(10, 20, 30);
      const inputEdges = edgesOf(input);
      const verticalEdges = inputEdges.filter(
        (edge) => extent(boundsOf(edge), "z") > 29.99,
      );
      assert.equal(verticalEdges.length, 4, `${fixture.label}.verticalEdges`);
      const expectedIndices = verticalEdges
        .map((edge) => inputEdges.indexOf(edge))
        .sort((first, second) => first - second);
      const inputBefore = snapshotShape(input);
      const arenaBefore = kernel.getShapeCount();
      withReport(
        exactEdgeTreatment(
          fixture.operation,
          input,
          [...verticalEdges].reverse(),
          fixture.amount,
        ),
        (report) => {
          assertEdgeTreatmentReportSuccess(
            report,
            fixture.operation,
            fixture.amount,
            4,
            expectedIndices,
            arenaBefore,
            fixture.label,
          );
          assert.equal(report.addCount, 4, `${fixture.label}.addCount`);
          assert.equal(report.skippedSeedCount, 0, `${fixture.label}.skipped`);
          const history = assertBooleanHistory(
            report,
            [input],
            fixture.label,
            observedEdgeTreatmentRelations,
          );
          const result = report.takeResultId(kernel);
          try {
            assertEdgeTreatmentResult(result, history, fixture.expected, fixture.label);
          } finally {
            kernel.release(result);
          }
        },
      );
      assert.equal(kernel.getShapeCount(), arenaBefore, `${fixture.label}.arena`);
      assertShapeSnapshot(input, inputBefore, `${fixture.label}.input`);
    });
  }

  for (const fixture of [
    {
      label: "tangent-overlap exact fillet",
      operation: edgeTreatmentOperations.fillet,
      amount: 1,
      expected: {
        volume: 1997.8539816339744,
        topology: { faces: 9, edges: 20, vertices: 13 },
      },
    },
    {
      label: "tangent-overlap exact chamfer",
      operation: edgeTreatmentOperations.chamfer,
      amount: 1,
      expected: {
        volume: 1995,
        topology: { faces: 9, edges: 20, vertices: 13 },
      },
    },
  ]) {
    runFixture(fixture.label, () => {
      const profilePoints = [
        [0, 0, 0],
        [5, 0, 0],
        [10, 0, 0],
        [10, 10, 0],
        [0, 10, 0],
      ];
      const profileEdges = profilePoints.map((start, index) =>
        lineEdge(start, profilePoints[(index + 1) % profilePoints.length]),
      );
      let profileWire;
      let profileFace;
      let input;
      try {
        profileWire = wireFromEdges(profileEdges);
        profileFace = kernel.makeFace(profileWire);
        input = kernel.extrude(profileFace, 0, 0, 20);
      } finally {
        if (profileFace !== undefined) kernel.release(profileFace);
        if (profileWire !== undefined) kernel.release(profileWire);
        for (const edge of profileEdges) kernel.release(edge);
      }

      const inputEdges = edgesOf(input);
      const tangentEdges = inputEdges.filter((edge) => {
        const bounds = boundsOf(edge);
        return (
          near(bounds.ymin, 0) &&
          near(bounds.ymax, 0) &&
          near(bounds.zmin, 0) &&
          near(bounds.zmax, 0) &&
          near(extent(bounds, "x"), 5)
        );
      });
      assert.equal(tangentEdges.length, 2, `${fixture.label}.tangentEdges`);
      const expectedIndices = tangentEdges
        .map((edge) => inputEdges.indexOf(edge))
        .sort((first, second) => first - second);
      const canonicalSeed = inputEdges[expectedIndices[0]];
      const reversedTangentSeeds = expectedIndices
        .map((index) => inputEdges[index])
        .reverse();
      const inputBefore = snapshotShape(input);
      const arenaBefore = kernel.getShapeCount();

      const baseline = withReport(
        exactEdgeTreatment(
          fixture.operation,
          input,
          [canonicalSeed],
          fixture.amount,
        ),
        (report) => {
          assertEdgeTreatmentReportSuccess(
            report,
            fixture.operation,
            fixture.amount,
            1,
            [expectedIndices[0]],
            arenaBefore,
            `${fixture.label}.baseline`,
          );
          assert.equal(report.addCount, 1, `${fixture.label}.baseline.addCount`);
          assert.equal(
            report.skippedSeedCount,
            0,
            `${fixture.label}.baseline.skipped`,
          );
          const history = assertBooleanHistory(
            report,
            [input],
            `${fixture.label}.baseline`,
            observedEdgeTreatmentRelations,
          );
          const result = report.takeResultId(kernel);
          try {
            assertEdgeTreatmentResult(
              result,
              history,
              fixture.expected,
              `${fixture.label}.baseline`,
            );
            return { history, brep: kernel.toBREP(result) };
          } finally {
            kernel.release(result);
          }
        },
      );
      assert.equal(kernel.getShapeCount(), arenaBefore, `${fixture.label}.baseline.arena`);

      withReport(
        exactEdgeTreatment(
          fixture.operation,
          input,
          reversedTangentSeeds,
          fixture.amount,
        ),
        (report) => {
          assertEdgeTreatmentReportSuccess(
            report,
            fixture.operation,
            fixture.amount,
            2,
            expectedIndices,
            arenaBefore,
            `${fixture.label}.overlap`,
          );
          assert.equal(report.addCount, 1, `${fixture.label}.overlap.addCount`);
          assert.equal(
            report.skippedSeedCount,
            1,
            `${fixture.label}.overlap.skipped`,
          );
          const history = assertBooleanHistory(
            report,
            [input],
            `${fixture.label}.overlap`,
            observedEdgeTreatmentRelations,
          );
          assert.deepEqual(
            history,
            baseline.history,
            `${fixture.label}: tangent-overlap history must be idempotent`,
          );
          const result = report.takeResultId(kernel);
          try {
            assertEdgeTreatmentResult(
              result,
              history,
              fixture.expected,
              `${fixture.label}.overlap`,
            );
            assert.equal(
              kernel.toBREP(result),
              baseline.brep,
              `${fixture.label}: tangent-overlap result must be idempotent`,
            );
          } finally {
            kernel.release(result);
          }
        },
      );
      assert.equal(kernel.getShapeCount(), arenaBefore, `${fixture.label}.overlap.arena`);
      assertShapeSnapshot(input, inputBefore, `${fixture.label}.input`);
    });
  }

  runFixture("cylindrical edge-treatment corpus", () => {
    for (const operation of Object.values(edgeTreatmentOperations)) {
      const input = kernel.makeCylinder(10, 20);
      const inputEdges = edgesOf(input);
      const rims = inputEdges.filter((edge) => {
        const bounds = boundsOf(edge);
        return extent(bounds, "z") < SELECTION_TOLERANCE;
      });
      const seams = inputEdges.filter(
        (edge) => extent(boundsOf(edge), "z") > 19.99,
      );
      assert.equal(rims.length, 2);
      assert.equal(seams.length, 1);
      const inputBefore = snapshotShape(input);
      const arenaBefore = kernel.getShapeCount();

      for (const [label, seeds, topology] of [
        ["one-rim", [rims[0]], { faces: 4, edges: 5, vertices: 3 }],
        ["both-rims", rims, { faces: 5, edges: 7, vertices: 4 }],
      ]) {
        withReport(
          exactEdgeTreatment(operation, input, seeds, 2),
          (report) => {
            const expectedIndices = seeds
              .map((edge) => inputEdges.indexOf(edge))
              .sort((first, second) => first - second);
            assertEdgeTreatmentReportSuccess(
              report,
              operation,
              2,
              seeds.length,
              expectedIndices,
              arenaBefore,
              `cylinder.${operation}.${label}`,
            );
            const history = assertBooleanHistory(
              report,
              [input],
              `cylinder.${operation}.${label}`,
              observedEdgeTreatmentRelations,
            );
            const result = report.takeResultId(kernel);
            try {
              assert.equal(kernel.isValid(result), true);
              assert.ok(kernel.getVolume(result) > 0);
              assert.deepEqual(shapeTopologyCounts(result), topology);
              assert.deepEqual(history.resultCounts, topology);
            } finally {
              kernel.release(result);
            }
          },
        );
        assert.equal(kernel.getShapeCount(), arenaBefore);
      }

      withReport(
        exactEdgeTreatment(operation, input, seams, 2),
        (report) => {
          assert.equal(report.ok, false, `cylinder.${operation}.seam`);
          assert.equal(report.hasResult(), false);
          assert.equal(report.transferCode(kernel), "NO_RESULT");
          assertNoBooleanHistory(report, `cylinder.${operation}.seam`);
        },
      );
      assert.equal(kernel.getShapeCount(), arenaBefore);
      assertShapeSnapshot(input, inputBefore, `cylinder.${operation}.input`);
    }
  });

  for (const [relationName, relation] of Object.entries(topologyRelations)) {
    assert.equal(
      observedEdgeTreatmentRelations.has(relation),
      true,
      `exact edge-treatment smoke must exercise ${relationName.toUpperCase()} records`,
    );
  }

  runFixture("exact solid-offset validation", () => {
    const input = kernel.makeBox(10, 20, 30);
    const inputFaces = facesOf(input);
    const top = indexedFaceOnPlane(inputFaces, "z", 30, "validation.top");
    const inputEdge = edgesOf(input)[0];
    const other = kernel.makeBox(4, 4, 4);
    const otherFace = facesOf(other)[0];
    const inputBefore = snapshotShape(input);
    const otherBefore = snapshotShape(other);
    const arenaBefore = kernel.getShapeCount();

    const failures = [
      {
        label: "invalidSolidOffsetOperation",
        report: exactSolidOffset(
          999,
          input,
          [top.face],
          1,
          solidOffsetDirections.inward,
        ),
        stage: "validation",
        code: "INVALID_OPERATION",
        operation: 999,
        direction: solidOffsetDirections.inward,
        amount: 1,
        tolerance: 1e-6,
        requested: 1,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: -1,
      },
      {
        label: "invalidSolidOffsetDirection",
        report: exactSolidOffset(
          solidOffsetOperations.shell,
          input,
          [top.face],
          1,
          999,
        ),
        stage: "validation",
        code: "INVALID_DIRECTION",
        operation: solidOffsetOperations.shell,
        direction: 999,
        amount: 1,
        tolerance: 1e-6,
        requested: 1,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: -1,
      },
      {
        label: "invalidSolidOffsetAmount",
        report: exactSolidOffset(
          solidOffsetOperations.offset,
          input,
          [],
          Number.NaN,
          solidOffsetDirections.outward,
        ),
        stage: "validation",
        code: "INVALID_AMOUNT",
        operation: solidOffsetOperations.offset,
        direction: solidOffsetDirections.outward,
        amount: Number.NaN,
        tolerance: 1e-6,
        requested: 0,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: -1,
      },
      {
        label: "invalidSolidOffsetTolerance",
        report: exactSolidOffset(
          solidOffsetOperations.offset,
          input,
          [],
          1,
          solidOffsetDirections.outward,
          0,
        ),
        stage: "validation",
        code: "INVALID_TOLERANCE",
        operation: solidOffsetOperations.offset,
        direction: solidOffsetDirections.outward,
        amount: 1,
        tolerance: 0,
        requested: 0,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: -1,
      },
      {
        label: "solidOffsetToleranceNotLessThanAmount",
        report: exactSolidOffset(
          solidOffsetOperations.offset,
          input,
          [],
          1,
          solidOffsetDirections.outward,
          1,
        ),
        stage: "validation",
        code: "TOLERANCE_NOT_LESS_THAN_AMOUNT",
        operation: solidOffsetOperations.offset,
        direction: solidOffsetDirections.outward,
        amount: 1,
        tolerance: 1,
        requested: 0,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: -1,
      },
      {
        label: "negativeSolidOffsetHistoryLimit",
        report: exactSolidOffset(
          solidOffsetOperations.offset,
          input,
          [],
          1,
          solidOffsetDirections.outward,
          1e-6,
          kernel,
          -1,
        ),
        stage: "validation",
        code: "INVALID_HISTORY_RECORD_LIMIT",
        operation: solidOffsetOperations.offset,
        direction: solidOffsetDirections.outward,
        amount: 1,
        tolerance: 1e-6,
        requested: 0,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: -1,
      },
      {
        label: "emptyShellOpenings",
        report: exactSolidOffset(
          solidOffsetOperations.shell,
          input,
          [],
          1,
          solidOffsetDirections.inward,
        ),
        stage: "validation",
        code: "EMPTY_OPENING_LIST",
        operation: solidOffsetOperations.shell,
        direction: solidOffsetDirections.inward,
        amount: 1,
        tolerance: 1e-6,
        requested: 0,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: -1,
      },
      {
        label: "offsetWithOpenings",
        report: exactSolidOffset(
          solidOffsetOperations.offset,
          input,
          [top.face],
          1,
          solidOffsetDirections.outward,
        ),
        stage: "validation",
        code: "OFFSET_HAS_OPENINGS",
        operation: solidOffsetOperations.offset,
        direction: solidOffsetDirections.outward,
        amount: 1,
        tolerance: 1e-6,
        requested: 1,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: -1,
      },
      {
        label: "shellOpeningNotFace",
        report: exactSolidOffset(
          solidOffsetOperations.shell,
          input,
          [inputEdge],
          1,
          solidOffsetDirections.inward,
        ),
        stage: "opening-validation",
        code: "OPENING_NOT_FACE",
        operation: solidOffsetOperations.shell,
        direction: solidOffsetDirections.inward,
        amount: 1,
        tolerance: 1e-6,
        requested: 1,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: 0,
      },
      {
        label: "shellOpeningNotInInput",
        report: exactSolidOffset(
          solidOffsetOperations.shell,
          input,
          [otherFace],
          1,
          solidOffsetDirections.inward,
        ),
        stage: "opening-validation",
        code: "FACE_NOT_IN_INPUT",
        operation: solidOffsetOperations.shell,
        direction: solidOffsetDirections.inward,
        amount: 1,
        tolerance: 1e-6,
        requested: 1,
        selected: [],
        buildCount: 0,
        occtStatus: -1,
        failedOpeningFaceIndex: 0,
      },
      {
        label: "zeroSolidOffsetHistoryLimit",
        report: exactSolidOffset(
          solidOffsetOperations.shell,
          input,
          [top.face],
          2,
          solidOffsetDirections.inward,
          1e-6,
          kernel,
          0,
        ),
        stage: "history",
        code: "HISTORY_RECORD_LIMIT_EXCEEDED",
        operation: solidOffsetOperations.shell,
        direction: solidOffsetDirections.inward,
        amount: 2,
        tolerance: 1e-6,
        requested: 1,
        selected: [top.index],
        buildCount: 1,
        occtStatus: 0,
        failedOpeningFaceIndex: -1,
      },
    ];

    for (const testCase of failures) {
      withReport(testCase.report, (report) => {
        assert.equal(report.ok, false, testCase.label);
        assert.equal(report.stage, testCase.stage, `${testCase.label}.stage`);
        assert.equal(report.code, testCase.code, `${testCase.label}.code`);
        assert.equal(report.operation, testCase.operation, `${testCase.label}.operation`);
        assert.equal(report.direction, testCase.direction, `${testCase.label}.direction`);
        if (Number.isNaN(testCase.amount)) {
          assert.equal(Number.isNaN(report.amount), true, `${testCase.label}.amount`);
        } else {
          assert.equal(report.amount, testCase.amount, `${testCase.label}.amount`);
        }
        assert.equal(report.tolerance, testCase.tolerance, `${testCase.label}.tolerance`);
        assert.equal(
          report.requestedOpeningFaceCount,
          testCase.requested,
          `${testCase.label}.requestedOpeningFaceCount`,
        );
        assert.deepEqual(
          selectedOpeningFaceIndices(report),
          testCase.selected,
          `${testCase.label}.selectedOpeningFaceIndices`,
        );
        assert.equal(report.buildCount, testCase.buildCount, `${testCase.label}.buildCount`);
        assert.equal(report.occtStatus, testCase.occtStatus, `${testCase.label}.occtStatus`);
        assert.equal(
          report.failedOpeningFaceIndex,
          testCase.failedOpeningFaceIndex,
          `${testCase.label}.failedOpeningFaceIndex`,
        );
        assert.equal(report.hasResult(), false, `${testCase.label}.hasResult`);
        assert.equal(report.transferCode(kernel), "NO_RESULT", `${testCase.label}.transferCode`);
        assertNoBooleanHistory(report, testCase.label);
        assert.throws(() => report.takeResultId(kernel), testCase.label);
      });
      assert.equal(kernel.getShapeCount(), arenaBefore, `${testCase.label}.arena`);
    }

    assertShapeSnapshot(input, inputBefore, "solidOffsetValidation.input");
    assertShapeSnapshot(other, otherBefore, "solidOffsetValidation.other");
  });

  for (const fixture of [
    {
      label: "one-opening inward exact shell",
      operation: solidOffsetOperations.shell,
      direction: solidOffsetDirections.inward,
      amount: 2,
      opening: "top",
      cloneTransfer: true,
      expected: {
        volume: 3312,
        topology: { faces: 11, edges: 24, vertices: 16 },
        bounds: { xmin: 0, ymin: 0, zmin: 0, xmax: 10, ymax: 20, zmax: 30 },
      },
    },
    {
      label: "one-opening outward exact shell",
      operation: solidOffsetOperations.shell,
      direction: solidOffsetDirections.outward,
      amount: 1,
      opening: "top",
      cloneTransfer: false,
      expected: {
        volume: 2143.466064545511,
        topology: { faces: 23, edges: 48, vertices: 28 },
        bounds: { xmin: -1, ymin: -1, zmin: -1, xmax: 11, ymax: 21, zmax: 30 },
      },
    },
    {
      label: "outward exact whole-solid offset",
      operation: solidOffsetOperations.offset,
      direction: solidOffsetDirections.outward,
      amount: 1,
      opening: undefined,
      cloneTransfer: false,
      expected: {
        volume: 8392.684349493147,
        topology: { faces: 26, edges: 48, vertices: 24 },
        bounds: { xmin: -1, ymin: -1, zmin: -1, xmax: 11, ymax: 21, zmax: 31 },
      },
    },
    {
      label: "inward exact whole-solid offset",
      operation: solidOffsetOperations.offset,
      direction: solidOffsetDirections.inward,
      amount: 1,
      opening: undefined,
      cloneTransfer: false,
      expected: {
        volume: 4032,
        topology: { faces: 6, edges: 12, vertices: 8 },
        bounds: { xmin: 1, ymin: 1, zmin: 1, xmax: 9, ymax: 19, zmax: 29 },
      },
    },
  ]) {
    runFixture(fixture.label, () => {
      const input = kernel.makeBox(10, 20, 30);
      const inputFaces = facesOf(input);
      const top = indexedFaceOnPlane(inputFaces, "z", 30, `${fixture.label}.top`);
      const openings = fixture.opening === "top" ? [top.face] : [];
      const selectedIndices = fixture.opening === "top" ? [top.index] : [];
      const inputBefore = snapshotShape(input);
      const arenaBefore = kernel.getShapeCount();

      withReport(
        exactSolidOffset(
          fixture.operation,
          input,
          openings,
          fixture.amount,
          fixture.direction,
        ),
        (report) => {
          assertSolidOffsetReportSuccess(
            report,
            fixture.operation,
            fixture.direction,
            fixture.amount,
            1e-6,
            openings.length,
            selectedIndices,
            arenaBefore,
            fixture.label,
          );
          const history = assertBooleanHistory(
            report,
            [input],
            fixture.label,
            observedSolidOffsetRelations,
          );
          for (const openingIndex of selectedIndices) {
            assert.equal(
              history.records.some(
                (record) =>
                  record.sourceShapeIndex === 0 &&
                  record.sourceKind === topologyKinds.face &&
                  record.sourceIndex === openingIndex &&
                  record.relation === topologyRelations.modified,
              ),
              true,
              `${fixture.label}: opening face ${openingIndex} must be MODIFIED into its planar rim`,
            );
          }

          const transferAndCheck = (owner) => {
            const result = owner.takeResultId(kernel);
            try {
              assertSolidOffsetResult(result, history, fixture.expected, fixture.label);
              assert.equal(report.hasResult(), false, `${fixture.label}.hasResultAfterTransfer`);
              assert.equal(report.transferCode(kernel), "ALREADY_TRANSFERRED");
              assert.throws(() => report.takeResultId(kernel));
            } finally {
              kernel.release(result);
            }
          };

          if (fixture.cloneTransfer) {
            const clone = report.clone();
            try {
              const otherKernel = new Module.OcctKernel();
              try {
                assert.equal(clone.transferCode(otherKernel), "WRONG_KERNEL");
                assert.throws(() => clone.takeResultId(otherKernel));
                assert.equal(otherKernel.getShapeCount(), 0);
              } finally {
                otherKernel.delete();
              }
              transferAndCheck(clone);
            } finally {
              clone.delete();
            }
          } else {
            transferAndCheck(report);
          }
        },
      );
      assert.equal(kernel.getShapeCount(), arenaBefore, `${fixture.label}.arena`);
      assertShapeSnapshot(input, inputBefore, `${fixture.label}.input`);
    });
  }

  runFixture("canonical two-opening exact shell", () => {
    const input = kernel.makeBox(10, 20, 30);
    const inputFaces = facesOf(input);
    const top = indexedFaceOnPlane(inputFaces, "z", 30, "twoOpening.top");
    const bottom = indexedFaceOnPlane(inputFaces, "z", 0, "twoOpening.bottom");
    const expectedIndices = [top.index, bottom.index].sort((first, second) => first - second);
    const expected = {
      volume: 3120,
      topology: { faces: 10, edges: 24, vertices: 16 },
      bounds: { xmin: 0, ymin: 0, zmin: 0, xmax: 10, ymax: 20, zmax: 30 },
    };
    const inputBefore = snapshotShape(input);
    const arenaBefore = kernel.getShapeCount();

    const baseline = withReport(
      exactSolidOffset(
        solidOffsetOperations.shell,
        input,
        [top.face, bottom.face],
        2,
        solidOffsetDirections.inward,
      ),
      (report) => {
        assertSolidOffsetReportSuccess(
          report,
          solidOffsetOperations.shell,
          solidOffsetDirections.inward,
          2,
          1e-6,
          2,
          expectedIndices,
          arenaBefore,
          "twoOpening.baseline",
        );
        const history = assertBooleanHistory(
          report,
          [input],
          "twoOpening.baseline",
          observedSolidOffsetRelations,
        );
        const result = report.takeResultId(kernel);
        try {
          assertSolidOffsetResult(result, history, expected, "twoOpening.baseline");
          return { history, brep: kernel.toBREP(result) };
        } finally {
          kernel.release(result);
        }
      },
    );
    assert.equal(kernel.getShapeCount(), arenaBefore, "twoOpening.baseline.arena");

    withReport(
      exactSolidOffset(
        solidOffsetOperations.shell,
        input,
        [bottom.face, top.face, bottom.face, top.face],
        2,
        solidOffsetDirections.inward,
      ),
      (report) => {
        assertSolidOffsetReportSuccess(
          report,
          solidOffsetOperations.shell,
          solidOffsetDirections.inward,
          2,
          1e-6,
          4,
          expectedIndices,
          arenaBefore,
          "twoOpening.canonical",
        );
        const history = assertBooleanHistory(
          report,
          [input],
          "twoOpening.canonical",
          observedSolidOffsetRelations,
        );
        assert.deepEqual(
          history,
          baseline.history,
          "duplicate/reordered openings must produce identical exact history",
        );
        for (const openingIndex of expectedIndices) {
          assert.equal(
            history.records.some(
              (record) =>
                record.sourceShapeIndex === 0 &&
                record.sourceKind === topologyKinds.face &&
                record.sourceIndex === openingIndex &&
                record.relation === topologyRelations.modified,
            ),
            true,
            `twoOpening: opening face ${openingIndex} must be MODIFIED into its planar rim`,
          );
        }
        const result = report.takeResultId(kernel);
        try {
          assertSolidOffsetResult(result, history, expected, "twoOpening.canonical");
          assert.equal(
            kernel.toBREP(result),
            baseline.brep,
            "duplicate/reordered openings must produce identical BREP",
          );
        } finally {
          kernel.release(result);
        }
      },
    );
    assert.equal(kernel.getShapeCount(), arenaBefore, "twoOpening.canonical.arena");
    assertShapeSnapshot(input, inputBefore, "twoOpening.input");
  });

  for (const [relationName, relation] of Object.entries(topologyRelations)) {
    assert.equal(
      observedSolidOffsetRelations.has(relation),
      true,
      `exact solid-offset smoke must exercise ${relationName.toUpperCase()} records`,
    );
  }

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
