import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_FACADE_VERSION = "invariantcad-facade@0.1.0+occt-wasm.3.7.0";
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

      const sharedReport = ownedReport.clone();
      try {
        assert.equal(sharedReport.hasResult(), true);
        assert.equal(sharedReport.transferCode(kernel), "READY");

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
      const result = ownedReport.takeResultId(kernel);
      try {
        assertSolidFixture(result, fixtures.yzNeutralPlane, "yzNeutralPlane");
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
      const result = ownedReport.takeResultId(kernel);
      try {
        assertSolidFixture(result, fixtures.singleWall, "duplicateSeed");
      } finally {
        kernel.release(result);
      }
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
