import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function parseOptions(arguments_) {
  let ownedFacadeRuntimeDirectory;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--owned-facade-runtime-dir") {
      throw new Error(`Unknown package-smoke option: ${argument}`);
    }
    if (ownedFacadeRuntimeDirectory !== undefined) {
      throw new Error("--owned-facade-runtime-dir may be provided only once");
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error("--owned-facade-runtime-dir requires a directory");
    }
    ownedFacadeRuntimeDirectory = resolve(value);
    index += 1;
  }
  return { ownedFacadeRuntimeDirectory };
}

const { ownedFacadeRuntimeDirectory } = parseOptions(process.argv.slice(2));
if (ownedFacadeRuntimeDirectory !== undefined) {
  await Promise.all([
    access(join(ownedFacadeRuntimeDirectory, "occt-wasm.js")),
    access(join(ownedFacadeRuntimeDirectory, "occt-wasm.wasm")),
  ]);
}

const packageJson = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const archiveName =
  packageJson.name.replace(/^@/, "").replaceAll("/", "-") +
  "-" +
  packageJson.version +
  ".tgz";
const archive = join(projectRoot, ".artifacts", archiveName);
await access(archive);

async function assertMissing(path, label) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(label + " must remain outside the invariantcad npm package");
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      basename(command) +
        " " +
        arguments_.join(" ") +
        " exited with status " +
        result.status,
    );
  }
}

const consumer = await mkdtemp(join(tmpdir(), "invariantcad-package-"));
try {
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "invariantcad-package-smoke",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(consumer, "smoke.mjs"),
    [
      'import { writeFile } from "node:fs/promises";',
      'import { CIRCULAR_ARC_PATH_MIN_POINT_SINE, OFFSET_DIRECTIONS, OFFSET_JOIN_SEMANTICS, SHELL_DIRECTIONS, SHELL_JOIN_SEMANTICS, SWEEP_FRAMES, SWEEP_TRANSITIONS, TOPOLOGY_ROLE_RULES, angleVec3, createEvaluator, deg, design, kernelSupports, mm, plane, scalarVec3, stringifyDocument, tf, topology, vec3 } from "invariantcad";',
      'import { createOcctKernel } from "invariantcad/kernels/occt";',
      "",
      'const cad = design("package-smoke");',
      'const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });',
      'cad.output("solid", solid);',
      "const document = cad.build();",
      "const evaluator = await createEvaluator();",
      "try {",
      "  const result = await evaluator.evaluate(document);",
      "  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));",
      "  try {",
      '    const volume = result.value.output("solid").measure().volume;',
      '    if (Math.abs(volume - 24) > 1e-9) throw new Error("Unexpected volume " + volume);',
      "  } finally {",
      "    result.value.dispose();",
      "  }",
      "} finally {",
      "  evaluator.dispose();",
      "}",
      "const exactKernel = await createOcctKernel();",
      "try {",
      '  const exactBox = exactKernel.box([2, 3, 4], false, { feature: "exact-box" });',
      '  if (Math.abs(exactKernel.measure(exactBox).volume - 24) > 1e-9) throw new Error("Unexpected exact volume");',
      '  if (exactKernel.exportShape(exactBox, "step").byteLength < 100) throw new Error("STEP export was empty");',
      "  const snapshot = exactKernel.topology(exactBox);",
      '  const boxRoles = [...snapshot.faces, ...snapshot.edges].flatMap((item) => item.lineage.flatMap((lineage) => lineage.role === undefined ? [] : [lineage.role]));',
      '  if (snapshot.history !== "complete" || new Set(boxRoles).size !== 18) throw new Error("Semantic box roles were not packaged");',
      '  if (TOPOLOGY_ROLE_RULES["box.face.x-min"].topology !== "face") throw new Error("Topology role registry was not packaged");',
      '  if (SHELL_DIRECTIONS.join(",") !== "inward,outward") throw new Error("Shell direction registry was not packaged");',
      '  if (SHELL_JOIN_SEMANTICS !== "round") throw new Error("Shell join semantics were not packaged");',
      '  if (OFFSET_DIRECTIONS.join(",") !== "inward,outward") throw new Error("Offset direction registry was not packaged");',
      '  if (OFFSET_JOIN_SEMANTICS !== "round") throw new Error("Offset join semantics were not packaged");',
      '  if (!kernelSupports(exactKernel.capabilities, "feature", "loft")) throw new Error("Exact loft capability was not packaged");',
      '  const directLoft = exactKernel.loft([{ plane: { plane: "XY", origin: [0, 0, 0] }, outer: { curves: [{ kind: "line", start: [0, 0], end: [2, 0] }, { kind: "line", start: [2, 0], end: [2, 3] }, { kind: "line", start: [2, 3], end: [0, 3] }, { kind: "line", start: [0, 3], end: [0, 0] }] }, holes: [] }, { plane: { plane: "XY", origin: [0, 0, 5] }, outer: { curves: [{ kind: "line", start: [0, 0], end: [4, 0] }, { kind: "line", start: [4, 0], end: [4, 6] }, { kind: "line", start: [4, 6], end: [0, 6] }, { kind: "line", start: [0, 6], end: [0, 0] }] }, holes: [] }], { ruled: true }, { tolerance: 1e-7 });',
      '  if (Math.abs(exactKernel.measure(directLoft).volume - 70) > 1e-8) throw new Error("Unexpected exact loft volume");',
      '  if (!kernelSupports(exactKernel.capabilities, "feature", "sweep")) throw new Error("Exact sweep capability was not packaged");',
      '  if (SWEEP_FRAMES.join(",") !== "corrected-frenet" || SWEEP_TRANSITIONS.join(",") !== "right-corner") throw new Error("Sweep semantic registries were not packaged");',
      '  const directSweep = exactKernel.sweep({ plane: { plane: "YZ", origin: [0, 0, 0] }, outer: { curves: [{ kind: "line", start: [-1, -1], end: [1, -1] }, { kind: "line", start: [1, -1], end: [1, 1] }, { kind: "line", start: [1, 1], end: [-1, 1] }, { kind: "line", start: [-1, 1], end: [-1, -1] }] }, holes: [] }, { kind: "polyline", points: [[0, 0, 0], [5, 0, 0], [5, 5, 0]], closed: false }, { frame: "corrected-frenet", transition: "right-corner" }, { tolerance: 1e-7 });',
      '  if (Math.abs(exactKernel.measure(directSweep).volume - 40) > 1e-8) throw new Error("Unexpected exact sweep volume");',
      '  if (!kernelSupports(exactKernel.capabilities, "feature", "circularArcSweep")) throw new Error("Exact circular-arc sweep capability was not packaged");',
      '  if (CIRCULAR_ARC_PATH_MIN_POINT_SINE !== 1e-10) throw new Error("Circular-arc path conditioning constant was not packaged");',
      '  const directArcSweep = exactKernel.circularArcSweep({ plane: { plane: "YZ", origin: [0, 0, 0] }, outer: { curves: [{ kind: "line", start: [-1, -1], end: [1, -1] }, { kind: "line", start: [1, -1], end: [1, 1] }, { kind: "line", start: [1, 1], end: [-1, 1] }, { kind: "line", start: [-1, 1], end: [-1, -1] }] }, holes: [] }, { kind: "circularArc", start: [0, 0, 0], through: [10 / Math.sqrt(2), 10 - 10 / Math.sqrt(2), 0], end: [10, 10, 0], closed: false }, { frame: "corrected-frenet", transition: "right-corner" }, { tolerance: 1e-7 });',
      '  if (Math.abs(exactKernel.measure(directArcSweep).volume - 20 * Math.PI) > 1e-8) throw new Error("Unexpected exact circular-arc sweep volume");',
      "  const vertical = snapshot.edges.filter((edge) => Math.abs(edge.curve.direction?.[2] ?? 0) > 0.999);",
      '  if (vertical.length !== 4) throw new Error("Unexpected vertical edge count");',
      "  const rounded = exactKernel.fillet(exactBox, vertical.map((edge) => edge.key), { radius: 0.2 });",
      '  if (!(exactKernel.measure(rounded).volume < 24)) throw new Error("Fillet did not remove material");',
      '  if (!kernelSupports(exactKernel.capabilities, "feature", "chamfer")) throw new Error("Exact chamfer capability was not packaged");',
      "  const beveled = exactKernel.chamfer(exactBox, [vertical[0].key], { distance: 0.2 });",
      '  if (Math.abs(exactKernel.measure(beveled).volume - 23.92) > 1e-8) throw new Error("Unexpected exact chamfer volume");',
      '  if (exactKernel.topology(beveled).history !== "partial") throw new Error("Chamfer history boundary was not preserved");',
      '  if (!kernelSupports(exactKernel.capabilities, "feature", "offset")) throw new Error("Exact offset capability was not packaged");',
      '  const expanded = exactKernel.offset(exactBox, { distance: 0.2, direction: "outward", tolerance: 1e-6 });',
      '  if (Math.abs(exactKernel.measure(expanded).volume - 35.564483717128844) > 1e-8) throw new Error("Unexpected exact offset volume");',
      '  if (exactKernel.topology(expanded).history !== "partial") throw new Error("Offset history boundary was not preserved");',
      "  exactKernel.disposeShape(expanded);",
      "  exactKernel.disposeShape(directLoft);",
      "  exactKernel.disposeShape(directSweep);",
      "  exactKernel.disposeShape(directArcSweep);",
      "  exactKernel.disposeShape(beveled);",
      "  exactKernel.disposeShape(rounded);",
      "  exactKernel.disposeShape(exactBox);",
      "} finally {",
      "  exactKernel.dispose();",
      "}",
      'const provenanceCad = design("package-provenance");',
      'const provenanceProfile = provenanceCad.sketch("profile", plane.xy(), (sketch) => sketch.profile(sketch.rectangle("outline", { width: mm(40), height: mm(20) })));',
      'const provenanceExtrusion = provenanceCad.extrude("extrusion", provenanceProfile, { distance: mm(10) });',
      'const provenanceMoved = provenanceCad.transform("moved", provenanceExtrusion, [tf.rotate(angleVec3(deg(0), deg(0), deg(90))), tf.translate(vec3(mm(100), mm(5), mm(7)))]);',
      'const provenanceEdges = topology.edges.createdBy(provenanceExtrusion, { role: "extrude.edge.end-rim", source: { sketch: provenanceProfile, entity: "outline.e1" } }).and(topology.edges.modifiedBy(provenanceMoved)).select();',
      'provenanceCad.output("rounded", provenanceCad.fillet("rounded", provenanceMoved, { edges: provenanceEdges, radius: mm(2) }));',
      'provenanceCad.output("beveled", provenanceCad.chamfer("beveled", provenanceMoved, { edges: provenanceEdges, distance: mm(2) }));',
      "const provenanceDocument = provenanceCad.build();",
      "const provenanceJson = stringifyDocument(provenanceDocument);",
      'if (!provenanceJson.includes("extrude.edge.end-rim") || !provenanceJson.includes("outline.e1")) throw new Error("Semantic provenance was not serialized");',
      'if (!provenanceJson.includes("chamfer") || !provenanceJson.includes("distance")) throw new Error("Chamfer was not serialized");',
      'await writeFile("model-chamfer.invariantcad.json", provenanceJson);',
      "const provenanceEvaluator = await createEvaluator({ kernel: await createOcctKernel() });",
      "try {",
      '  const result = await provenanceEvaluator.evaluate(provenanceDocument, { outputs: ["beveled"] });',
      "  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));",
      "  try {",
      '    const volume = result.value.output("beveled").measure().volume;',
      '    if (Math.abs(volume - 7960) > 1e-8) throw new Error("Unexpected semantic chamfer volume " + volume);',
      "  } finally {",
      "    result.value.dispose();",
      "  }",
      "} finally {",
      "  provenanceEvaluator.dispose();",
      "}",
      'const shellCad = design("package-shell");',
      'const shellBox = shellCad.box("box", { size: vec3(mm(10), mm(20), mm(30)) });',
      'const shellOpening = topology.faces.createdBy(shellBox, { role: "box.face.z-max" }).select();',
      'shellCad.output("hollow", shellCad.shell("hollow", shellBox, { openings: shellOpening, thickness: mm(2), direction: "inward", tolerance: mm(1e-6) }));',
      "const shellDocument = shellCad.build();",
      "const shellJson = stringifyDocument(shellDocument);",
      'if (!shellJson.includes("shell") || !shellJson.includes("box.face.z-max") || !shellJson.includes("inward")) throw new Error("Shell was not serialized");',
      'await writeFile("model-shell.invariantcad.json", shellJson);',
      "const shellEvaluator = await createEvaluator({ kernel: await createOcctKernel() });",
      "try {",
      "  const result = await shellEvaluator.evaluate(shellDocument);",
      "  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));",
      "  try {",
      '    const volume = result.value.output("hollow").measure().volume;',
      '    if (Math.abs(volume - 3312) > 1e-8) throw new Error("Unexpected semantic shell volume " + volume);',
      "  } finally {",
      "    result.value.dispose();",
      "  }",
      "} finally {",
      "  shellEvaluator.dispose();",
      "}",
      'const offsetCad = design("package-offset");',
      'const offsetBox = offsetCad.box("box", { size: vec3(mm(10), mm(20), mm(30)) });',
      'offsetCad.output("expanded", offsetCad.offset("expanded", offsetBox, { distance: mm(1), direction: "outward", tolerance: mm(1e-6) }));',
      "const offsetDocument = offsetCad.build();",
      "const offsetJson = stringifyDocument(offsetDocument);",
      'if (!offsetJson.includes("offset") || !offsetJson.includes("outward") || !offsetJson.includes("tolerance")) throw new Error("Offset was not serialized");',
      'await writeFile("model-offset.invariantcad.json", offsetJson);',
      "const offsetEvaluator = await createEvaluator({ kernel: await createOcctKernel() });",
      "try {",
      "  const result = await offsetEvaluator.evaluate(offsetDocument);",
      "  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));",
      "  try {",
      '    const volume = result.value.output("expanded").measure().volume;',
      '    if (Math.abs(volume - 8392.684349493147) > 1e-8) throw new Error("Unexpected semantic offset volume " + volume);',
      "  } finally {",
      "    result.value.dispose();",
      "  }",
      "} finally {",
      "  offsetEvaluator.dispose();",
      "}",
      'const loftCad = design("package-loft");',
      'const loftBottom = loftCad.sketch("bottom", plane.xy(), (sketch) => sketch.profile(sketch.rectangle("outline", { width: mm(2), height: mm(3) })));',
      'const loftTop = loftCad.sketch("top", plane.xy(vec3(mm(0), mm(0), mm(5))), (sketch) => sketch.profile(sketch.rectangle("outline", { width: mm(4), height: mm(6) })));',
      'loftCad.output("loft", loftCad.loft("loft", [loftBottom, loftTop]));',
      'const loftDocument = loftCad.build();',
      'const loftJson = stringifyDocument(loftDocument);',
      'if (!loftJson.includes("loft") || !loftJson.includes("ruled")) throw new Error("Loft was not serialized");',
      'await writeFile("model-loft.invariantcad.json", loftJson);',
      'const loftEvaluator = await createEvaluator({ kernel: await createOcctKernel() });',
      'try {',
      '  const result = await loftEvaluator.evaluate(loftDocument);',
      '  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));',
      '  try {',
      '    const volume = result.value.output("loft").measure().volume;',
      '    if (Math.abs(volume - 70) > 1e-8) throw new Error("Unexpected semantic loft volume " + volume);',
      '  } finally {',
      '    result.value.dispose();',
      '  }',
      '} finally {',
      '  loftEvaluator.dispose();',
      '}',
      'const sweepCad = design("package-sweep");',
      'const sweepProfile = sweepCad.sketch("profile", plane.yz(), (sketch) => sketch.profile(sketch.rectangle("section", { width: mm(2), height: mm(2) })));',
      'const sweepPath = sweepCad.polylinePath("path", [vec3(mm(0), mm(0), mm(0)), vec3(mm(5), mm(0), mm(0)), vec3(mm(5), mm(5), mm(0))]);',
      'sweepCad.output("sweep", sweepCad.sweep("sweep", sweepProfile, sweepPath));',
      'const sweepDocument = sweepCad.build();',
      'const sweepJson = stringifyDocument(sweepDocument);',
      'if (!sweepJson.includes("polylinePath") || !sweepJson.includes("corrected-frenet") || !sweepJson.includes("right-corner")) throw new Error("Sweep was not serialized");',
      'await writeFile("model-sweep.invariantcad.json", sweepJson);',
      'const sweepEvaluator = await createEvaluator({ kernel: await createOcctKernel() });',
      'try {',
      '  const result = await sweepEvaluator.evaluate(sweepDocument);',
      '  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));',
      '  try {',
      '    const volume = result.value.output("sweep").measure().volume;',
      '    if (Math.abs(volume - 40) > 1e-8) throw new Error("Unexpected semantic sweep volume " + volume);',
      '  } finally {',
      '    result.value.dispose();',
      '  }',
      '} finally {',
      '  sweepEvaluator.dispose();',
      '}',
      'const arcSweepCad = design("package-circular-arc-sweep");',
      'const arcSweepProfile = arcSweepCad.sketch("profile", plane.yz(), (sketch) => sketch.profile(sketch.rectangle("section", { width: mm(2), height: mm(2) })));',
      'const arcSweepPath = arcSweepCad.circularArcPath("path", { start: vec3(mm(0), mm(0), mm(0)), through: vec3(mm(10 / Math.sqrt(2)), mm(10 - 10 / Math.sqrt(2)), mm(0)), end: vec3(mm(10), mm(10), mm(0)) });',
      'arcSweepCad.output("sweep", arcSweepCad.sweep("sweep", arcSweepProfile, arcSweepPath));',
      'const arcSweepDocument = arcSweepCad.build();',
      'const arcSweepJson = stringifyDocument(arcSweepDocument);',
      'if (!arcSweepJson.includes("circularArcPath") || !arcSweepJson.includes("through")) throw new Error("Circular-arc sweep was not serialized");',
      'await writeFile("model-circular-arc-sweep.invariantcad.json", arcSweepJson);',
      'const arcSweepEvaluator = await createEvaluator({ kernel: await createOcctKernel() });',
      'try {',
      '  const result = await arcSweepEvaluator.evaluate(arcSweepDocument);',
      '  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));',
      '  try {',
      '    const volume = result.value.output("sweep").measure().volume;',
      '    if (Math.abs(volume - 20 * Math.PI) > 1e-8) throw new Error("Unexpected semantic circular-arc sweep volume " + volume);',
      '  } finally {',
      '    result.value.dispose();',
      '  }',
      '} finally {',
      '  arcSweepEvaluator.dispose();',
      '}',
      'const filletCad = design("package-fillet");',
      'const filletBox = filletCad.box("box", { size: vec3(mm(10), mm(20), mm(30)) });',
      'const filletEdges = topology.edges.createdBy(filletBox).and(topology.edges.direction(scalarVec3(0, 0, 1))).exactly(4);',
      'filletCad.output("rounded", filletCad.fillet("rounded", filletBox, { edges: filletEdges, radius: mm(2) }));',
      'await writeFile("model.invariantcad.json", stringifyDocument(filletCad.build()));',
      'process.stdout.write("package-consumer-volume=24\\n");',
      "",
    ].join("\n"),
  );
  if (ownedFacadeRuntimeDirectory !== undefined) {
    await writeFile(
      join(consumer, "owned-facade-smoke.mjs"),
      [
        'import assert from "node:assert/strict";',
        'import { join, resolve } from "node:path";',
        'import { pathToFileURL } from "node:url";',
        'import { createEvaluator, deg, design, mm, scalarVec3, topology, vec3 } from "invariantcad";',
        'import { createOcctKernel } from "invariantcad/kernels/occt";',
        "",
        'if (process.argv.length !== 3) throw new Error("Expected one explicit owned-facade runtime directory");',
        "const runtimeDirectory = resolve(process.argv[2]);",
        'const gluePath = join(runtimeDirectory, "occt-wasm.js");',
        'const wasmPath = join(runtimeDirectory, "occt-wasm.wasm");',
        "const loaded = await import(pathToFileURL(gluePath).href);",
        'if (typeof loaded.default !== "function") throw new Error("Owned facade glue has no default module factory");',
        "const kernel = await createOcctKernel({ moduleFactory: loaded.default, wasm: wasmPath });",
        "try {",
        '  if (!kernel.capabilities.features.includes("draft")) throw new Error("Installed kernel did not advertise owned draft");',
        "  assert.deepEqual(kernel.capabilities.exactIndexedTopologyEvolution, { protocolVersion: 1, features: [\"draft\"] });",
        '  if (kernel.draft === undefined || kernel.topology === undefined) throw new Error("Installed owned facade lacks draft topology support");',
        "",
        "  let directBox;",
        "  let directDraft;",
        "  try {",
        '    directBox = kernel.box([20, 20, 10], false, { feature: "installed-direct-box" });',
        "    const input = kernel.topology(directBox);",
        "    const selected = input.faces.filter((face) => face.lineage.some((lineage) =>",
        '      lineage.feature === "installed-direct-box" && lineage.role === "box.face.x-min"',
        "    ));",
        '    assert.equal(selected.length, 1, "installed direct selector seed");',
        "    directDraft = kernel.draft(directBox, [selected[0].key], {",
        "      angle: (5 * Math.PI) / 180,",
        "      pullDirection: [0, 0, 1],",
        "      neutralPlane: { origin: [0, 0, 0], normal: [0, 0, 1] },",
        '    }, { feature: "installed-direct-draft" });',
        '    assert.deepEqual(kernel.status(directDraft), { ok: true, code: "VALID" });',
        "    const directVolume = kernel.measure(directDraft).volume;",
        '    assert.ok(Math.abs(directVolume - 3912.5113364740755) <= 1e-8, `unexpected installed direct draft volume ${directVolume}`);',
        "    const evolved = kernel.topology(directDraft);",
        '    assert.equal(evolved.history, "complete");',
        "    const modifiedFaces = evolved.faces.filter((face) => face.lineage.some((lineage) =>",
        '      lineage.feature === "installed-direct-draft" && lineage.relation === "modified"',
        "    ));",
        '    assert.equal(modifiedFaces.length, 5, "installed exact draft face evolution");',
        "  } finally {",
        "    if (directDraft !== undefined) kernel.disposeShape(directDraft);",
        "    if (directBox !== undefined) kernel.disposeShape(directBox);",
        "  }",
        "",
        '  const cad = design("installed-owned-facade-draft");',
        '  const box = cad.box("box", { size: vec3(mm(20), mm(20), mm(10)) });',
        '  const drafted = cad.draft("drafted", box, {',
        '    faces: topology.faces.createdBy(box, { role: "box.face.x-min" }).exactly(1),',
        "    angle: deg(5),",
        "    pullDirection: scalarVec3(0, 0, 1),",
        "    neutralPlane: { origin: vec3(mm(0), mm(0), mm(0)), normal: scalarVec3(0, 0, 1) },",
        "  });",
        '  cad.output("drafted", drafted);',
        "  const evaluator = await createEvaluator({ kernel });",
        "  try {",
        "    const result = await evaluator.evaluate(cad.build());",
        "    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));",
        "    try {",
        '      const evaluatedVolume = result.value.output("drafted").measure().volume;',
        '      assert.ok(Math.abs(evaluatedVolume - 3912.5113364740755) <= 1e-8, `unexpected installed evaluated draft volume ${evaluatedVolume}`);',
        "    } finally {",
        "      result.value.dispose();",
        "    }",
        "  } finally {",
        "    evaluator.dispose();",
        "  }",
        "} finally {",
        "  kernel.dispose();",
        "}",
        'process.stdout.write("installed-owned-facade-draft=ok\\n");',
        "",
      ].join("\n"),
    );
  }
  await writeFile(
    join(consumer, "type-smoke.ts"),
    [
      'import { EDGE_TOPOLOGY_ROLES, FACE_TOPOLOGY_ROLES, OFFSET_DIRECTIONS, SHELL_DIRECTIONS, TOPOLOGY_ROLE_RULES, TOPOLOGY_ROLES, angleVec3, deg, design, mm, plane, scalarVec3, tf, topology, vec3, type ChamferNodeIR, type CircularArcPathNodeIR, type DesignDocument, type DraftNodeIR, type EdgeTopologyRole, type FaceTopologyRole, type LoftNodeIR, type OffsetDirection, type OffsetNodeIR, type PathRef, type PolylinePathNodeIR, type ProfileRef, type ShellDirection, type ShellNodeIR, type SolidRef, type SweepNodeIR, type TopologyOriginOptions, type TopologyRole, type TopologySelection } from "invariantcad";',
      'import { createOcctKernel, type OcctKernelOptions, type OcctModuleFactory, type OcctModuleOptions } from "invariantcad/kernels/occt";',
      "",
      'const cad = design("type-smoke");',
      'const solid: SolidRef = cad.box("solid", { size: vec3(mm(1), mm(2), mm(3)) });',
      'const edges = topology.edges.createdBy(solid).and(topology.edges.direction(scalarVec3(0, 0, 1))).exactly(4);',
      'const faces = topology.faces.createdBy(solid, { role: "box.face.z-max" }).select();',
      'const rounded: SolidRef = cad.fillet("rounded", solid, { edges, radius: mm(0.1) });',
      'const beveled: SolidRef = cad.chamfer("beveled", solid, { edges, distance: mm(0.1) });',
      'const hollow: SolidRef = cad.shell("hollow", solid, { openings: faces, thickness: mm(0.1), direction: "inward", tolerance: mm(1e-6) });',
      'const expanded: SolidRef = cad.offset("expanded", solid, { distance: mm(0.1), direction: "outward", tolerance: mm(1e-6) });',
      'const drafted: SolidRef = cad.draft("drafted", solid, { faces, angle: deg(1), pullDirection: scalarVec3(0, 0, 1), neutralPlane: { origin: vec3(mm(0), mm(0), mm(0)), normal: scalarVec3(0, 0, 1) } });',
      'const loftBottom: ProfileRef = cad.sketch("loft-bottom", plane.xy(), (sketch) => sketch.profile(sketch.rectangle("bottom", { width: mm(1), height: mm(2) })));',
      'const loftTop: ProfileRef = cad.sketch("loft-top", plane.xy(vec3(mm(0), mm(0), mm(3))), (sketch) => sketch.profile(sketch.rectangle("top", { width: mm(2), height: mm(4) })));',
      'const lofted: SolidRef = cad.loft("lofted", [loftBottom, loftTop], { ruled: true });',
      'const sweepPath: PathRef = cad.polylinePath("sweep-path", [vec3(mm(0), mm(0), mm(0)), vec3(mm(0), mm(0), mm(3)), vec3(mm(3), mm(0), mm(3))]);',
      'const swept: SolidRef = cad.sweep("swept", loftBottom, sweepPath, { frame: "corrected-frenet", transition: "right-corner" });',
      'const arcPath: PathRef = cad.circularArcPath("arc-path", { start: vec3(mm(0), mm(0), mm(0)), through: vec3(mm(3 - 3 / Math.sqrt(2)), mm(0), mm(3 / Math.sqrt(2))), end: vec3(mm(3), mm(0), mm(3)) });',
      'const arcSwept: SolidRef = cad.sweep("arc-swept", loftBottom, arcPath);',
      '// @ts-expect-error Document v1 lofts must be ruled.',
      'cad.loft("smooth", [loftBottom, loftTop], { ruled: false });',
      '// @ts-expect-error Document v1 sweeps use corrected-Frenet transport only.',
      'cad.sweep("fixed-sweep", loftBottom, sweepPath, { frame: "fixed" });',
      "// @ts-expect-error Chamfers require edge selections.",
      'cad.chamfer("invalid-faces", solid, { edges: topology.faces.all().select(), distance: mm(0.1) });',
      "// @ts-expect-error Chamfer distance must be a length expression.",
      'cad.chamfer("invalid-distance", solid, { edges, distance: deg(45) });',
      "// @ts-expect-error Shells require face selections for openings.",
      'cad.shell("invalid-shell-edges", solid, { openings: edges, thickness: mm(0.1) });',
      "// @ts-expect-error Shell thickness must be a length expression.",
      'cad.shell("invalid-shell-thickness", solid, { openings: faces, thickness: deg(45) });',
      "// @ts-expect-error Shell direction is a closed string union.",
      'cad.shell("invalid-shell-direction", solid, { openings: faces, thickness: mm(0.1), direction: "inside" });',
      "// @ts-expect-error Offset distance must be a length expression.",
      'cad.offset("invalid-offset-distance", solid, { distance: deg(45) });',
      'cad.offset("invalid-offset-tolerance", solid, {',
      "  distance: mm(0.1),",
      "  // @ts-expect-error Offset tolerance must be a length expression.",
      "  tolerance: deg(1),",
      "});",
      "// @ts-expect-error Offset direction is a closed string union.",
      'cad.offset("invalid-offset-direction", solid, { distance: mm(0.1), direction: "outside" });',
      'cad.output("solid", rounded);',
      'cad.output("beveled", beveled);',
      'cad.output("hollow", hollow);',
      'cad.output("expanded", expanded);',
      'cad.output("drafted", drafted);',
      'cad.output("lofted", lofted);',
      'cad.output("swept", swept);',
      'cad.output("arc-swept", arcSwept);',
      "const document: DesignDocument = cad.build();",
      'const maybeChamfer = document.nodes[beveled.node];',
      'if (maybeChamfer?.kind !== "chamfer") throw new Error("Missing chamfer IR");',
      'const chamferNode: ChamferNodeIR = maybeChamfer;',
      'if (chamferNode.distance.dimension !== "length") throw new Error("Invalid chamfer distance type");',
      'const maybeShell = document.nodes[hollow.node];',
      'if (maybeShell?.kind !== "shell") throw new Error("Missing shell IR");',
      'const shellNode: ShellNodeIR = maybeShell;',
      'const shellDirection: ShellDirection = shellNode.direction;',
      'const shellDirections: readonly ShellDirection[] = SHELL_DIRECTIONS;',
      'if (!shellDirections.includes(shellDirection) || shellNode.thickness.dimension !== "length" || shellNode.tolerance.dimension !== "length") throw new Error("Invalid shell IR types");',
      'const maybeOffset = document.nodes[expanded.node];',
      'if (maybeOffset?.kind !== "offset") throw new Error("Missing offset IR");',
      'const offsetNode: OffsetNodeIR = maybeOffset;',
      'const offsetDirection: OffsetDirection = offsetNode.direction;',
      'const offsetDirections: readonly OffsetDirection[] = OFFSET_DIRECTIONS;',
      'if (!offsetDirections.includes(offsetDirection) || offsetNode.distance.dimension !== "length" || offsetNode.tolerance.dimension !== "length") throw new Error("Invalid offset IR types");',
      'const maybeDraft = document.nodes[drafted.node];',
      'if (maybeDraft?.kind !== "draft") throw new Error("Missing draft IR");',
      'const draftNode: DraftNodeIR = maybeDraft;',
      'if (draftNode.angle.dimension !== "angle" || draftNode.faces.topology !== "face") throw new Error("Invalid draft IR types");',
      'const maybeLoft = document.nodes[lofted.node];',
      'if (maybeLoft?.kind !== "loft") throw new Error("Missing loft IR");',
      'const loftNode: LoftNodeIR = maybeLoft;',
      'if (loftNode.ruled !== true || loftNode.profiles.length !== 2) throw new Error("Invalid loft IR types");',
      'const maybePath = document.nodes[sweepPath.node];',
      'if (maybePath?.kind !== "polylinePath") throw new Error("Missing path IR");',
      'const pathNode: PolylinePathNodeIR = maybePath;',
      'if (pathNode.closed !== false || pathNode.points.length !== 3) throw new Error("Invalid path IR types");',
      'const maybeArcPath = document.nodes[arcPath.node];',
      'if (maybeArcPath?.kind !== "circularArcPath") throw new Error("Missing circular-arc path IR");',
      'const arcPathNode: CircularArcPathNodeIR = maybeArcPath;',
      'if (arcPathNode.closed !== false || arcPathNode.through.length !== 3) throw new Error("Invalid circular-arc path IR types");',
      'const maybeSweep = document.nodes[swept.node];',
      'if (maybeSweep?.kind !== "sweep") throw new Error("Missing sweep IR");',
      'const sweepNode: SweepNodeIR = maybeSweep;',
      'if (sweepNode.frame !== "corrected-frenet" || sweepNode.transition !== "right-corner") throw new Error("Invalid sweep IR types");',
      'const moduleFactory: OcctModuleFactory = async (_moduleOptions?: OcctModuleOptions) => ({});',
      "const options: OcctKernelOptions = { moduleFactory };",
      "void createOcctKernel(options);",
      "void document;",
      "",
      'const provenanceCad = design("type-provenance");',
      'const profile: ProfileRef = provenanceCad.sketch("profile", plane.xy(), (sketch) =>',
      '  sketch.profile(sketch.rectangle("outline", { width: mm(40), height: mm(20) })),',
      ");",
      'const extrusion: SolidRef = provenanceCad.extrude("extrusion", profile, { distance: mm(10) });',
      'const moved: SolidRef = provenanceCad.transform("moved", extrusion, [',
      "  tf.rotate(angleVec3(deg(0), deg(0), deg(90))),",
      "  tf.translate(vec3(mm(100), mm(5), mm(7))),",
      "]);",
      'const edgeRole: EdgeTopologyRole = "extrude.edge.end-rim";',
      'const faceRole: FaceTopologyRole = "extrude.face.side";',
      'const origin: TopologyOriginOptions<"edge"> = { role: edgeRole, source: { sketch: profile, entity: "outline.e1" } };',
      'const selected: TopologySelection<"edge"> = topology.edges.createdBy(extrusion, origin).and(topology.edges.modifiedBy(moved)).select();',
      "// @ts-expect-error Face roles cannot be used by an edge origin selector.",
      "topology.edges.createdBy(extrusion, { role: faceRole });",
      "// @ts-expect-error Modified lineage cannot carry creation roles or sketch sources.",
      "topology.edges.modifiedBy(moved, origin);",
      'const provenanceRounded = provenanceCad.fillet("rounded", moved, { edges: selected, radius: mm(2) });',
      'const provenanceBeveled: SolidRef = provenanceCad.chamfer("beveled", moved, { edges: selected, distance: mm(2) });',
      'provenanceCad.output("rounded", provenanceRounded);',
      'provenanceCad.output("beveled", provenanceBeveled);',
      "const provenanceDocument: DesignDocument = provenanceCad.build();",
      "const allRoles: readonly TopologyRole[] = TOPOLOGY_ROLES;",
      "const edgeRoles: readonly EdgeTopologyRole[] = EDGE_TOPOLOGY_ROLES;",
      "const faceRoles: readonly FaceTopologyRole[] = FACE_TOPOLOGY_ROLES;",
      'if (!allRoles.includes(edgeRole) || !edgeRoles.includes(edgeRole) || !faceRoles.includes(faceRole)) throw new Error("Missing typed topology roles");',
      'if (TOPOLOGY_ROLE_RULES[edgeRole].source !== "sketch-curve") throw new Error("Missing topology role rule");',
      "void provenanceDocument;",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ["type-smoke.ts"],
      },
      null,
      2,
    ),
  );

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(
    npm,
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive],
    consumer,
  );
  const installedPackage = join(consumer, "node_modules", "invariantcad");
  await assertMissing(
    join(installedPackage, ".artifacts"),
    "Local build artifacts",
  );
  await assertMissing(
    join(installedPackage, "native"),
    "Native facade sources and bundles",
  );
  run(
    process.execPath,
    [join(projectRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
    consumer,
  );
  run(process.execPath, ["smoke.mjs"], consumer);
  if (ownedFacadeRuntimeDirectory !== undefined) {
    run(
      process.execPath,
      ["owned-facade-smoke.mjs", ownedFacadeRuntimeDirectory],
      consumer,
    );
  }

  const bin = join(
    consumer,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "invariantcad.cmd" : "invariantcad",
  );
  run(bin, ["--help"], consumer);
  run(bin, ["validate", "model.invariantcad.json"], consumer);
  run(bin, ["validate", "model-chamfer.invariantcad.json"], consumer);
  run(bin, ["validate", "model-shell.invariantcad.json"], consumer);
  run(bin, ["validate", "model-offset.invariantcad.json"], consumer);
  run(bin, ["validate", "model-loft.invariantcad.json"], consumer);
  run(bin, ["validate", "model-sweep.invariantcad.json"], consumer);
  run(
    bin,
    ["validate", "model-circular-arc-sweep.invariantcad.json"],
    consumer,
  );
  run(
    bin,
    ["export", "model.invariantcad.json", "--to", "model.step"],
    consumer,
  );
  if ((await stat(join(consumer, "model.step"))).size < 100) {
    throw new Error("Installed CLI produced an empty STEP file");
  }
  run(
    bin,
    [
      "export",
      "model-chamfer.invariantcad.json",
      "--output",
      "beveled",
      "--to",
      "beveled.step",
    ],
    consumer,
  );
  if ((await stat(join(consumer, "beveled.step"))).size < 100) {
    throw new Error("Installed CLI produced an empty chamfer STEP file");
  }
  run(
    bin,
    [
      "export",
      "model-shell.invariantcad.json",
      "--output",
      "hollow",
      "--to",
      "hollow.step",
    ],
    consumer,
  );
  if ((await stat(join(consumer, "hollow.step"))).size < 100) {
    throw new Error("Installed CLI produced an empty shell STEP file");
  }
  run(
    bin,
    [
      "export",
      "model-offset.invariantcad.json",
      "--output",
      "expanded",
      "--to",
      "expanded.step",
    ],
    consumer,
  );
  if ((await stat(join(consumer, "expanded.step"))).size < 100) {
    throw new Error("Installed CLI produced an empty offset STEP file");
  }
  run(
    bin,
    [
      "export",
      "model-loft.invariantcad.json",
      "--output",
      "loft",
      "--to",
      "loft.step",
    ],
    consumer,
  );
  if ((await stat(join(consumer, "loft.step"))).size < 100) {
    throw new Error("Installed CLI produced an empty loft STEP file");
  }
  run(
    bin,
    [
      "export",
      "model-sweep.invariantcad.json",
      "--output",
      "sweep",
      "--to",
      "sweep.step",
    ],
    consumer,
  );
  if ((await stat(join(consumer, "sweep.step"))).size < 100) {
    throw new Error("Installed CLI produced an empty sweep STEP file");
  }
  run(
    bin,
    [
      "export",
      "model-circular-arc-sweep.invariantcad.json",
      "--output",
      "sweep",
      "--to",
      "circular-arc-sweep.step",
    ],
    consumer,
  );
  if ((await stat(join(consumer, "circular-arc-sweep.step"))).size < 100) {
    throw new Error(
      "Installed CLI produced an empty circular-arc sweep STEP file",
    );
  }
  process.stdout.write("Packed package smoke test passed.\n");
} finally {
  await rm(consumer, { recursive: true, force: true });
}
