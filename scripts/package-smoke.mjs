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

function run(command, arguments_, cwd, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stdout && options.printOutput !== false) {
    process.stdout.write(result.stdout);
  }
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
  return result.stdout;
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
      'import { CIRCULAR_ARC_PATH_MIN_POINT_SINE, COMPOSITE_PATH_MAX_JUNCTION_SINE, DEFAULT_TOPOLOGY_SIGNATURE_LIMITS, OFFSET_DIRECTIONS, OFFSET_JOIN_SEMANTICS, SHELL_DIRECTIONS, SHELL_JOIN_SEMANTICS, SWEEP_FRAMES, SWEEP_TRANSITIONS, TOPOLOGY_ROLE_RULES, TOPOLOGY_SIGNATURE_PROTOCOL_VERSION, angleVec3, captureTopologyReference, createEvaluator, deg, design, kernelSupports, kgPerCubicMeter, mm, momentOfInertiaAboutAxis, plane, principalInertia, principalRadiiOfGyration, resolveTopologyReference, scalarVec3, stringifyDocument, tf, topology, vec3, worldRadiiOfGyration } from "invariantcad";',
      'import { createOcctKernel } from "invariantcad/kernels/occt";',
      "",
      "function assertNear(actual, expected, label, tolerance) {",
      "  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) throw new Error(label + \" expected \" + expected + \" but received \" + actual);",
      "}",
      "function assertBoxMassProperties(measured, label, tolerance) {",
      "  assertNear(measured.volume, 24, label + \" volume\", tolerance);",
      "  if (measured.centerOfMass === null) throw new Error(label + \" center of mass was null\");",
      "  const expectedCenter = [1, 1.5, 2];",
      "  const expectedInertia = [[50, 0, 0], [0, 40, 0], [0, 0, 26]];",
      "  for (let index = 0; index < 3; index += 1) assertNear(measured.centerOfMass[index], expectedCenter[index], label + \" center[\" + index + \"]\", tolerance);",
      "  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) assertNear(measured.inertiaTensor[row][column], expectedInertia[row][column], label + \" inertia[\" + row + \"][\" + column + \"]\", tolerance);",
      "}",
      "",
      'if (TOPOLOGY_SIGNATURE_PROTOCOL_VERSION !== 1) throw new Error("Topology-signature protocol constant was not packaged");',
      'const expectedTopologySignatureLimits = { maxTopologyItems: 100_000, maxAdjacencyLinks: 1_000_000, maxEvidenceRecords: 1_000_000, maxCandidatePairs: 1_000_000, maxMatchingSteps: 10_000_000 };',
      'for (const [resource, expected] of Object.entries(expectedTopologySignatureLimits)) if (DEFAULT_TOPOLOGY_SIGNATURE_LIMITS[resource] !== expected) throw new Error("Unexpected default topology-signature limit for " + resource);',
      'if (!Object.isFrozen(DEFAULT_TOPOLOGY_SIGNATURE_LIMITS)) throw new Error("Default topology-signature limits were not frozen");',
      'const topologySignatureLimits = { ...DEFAULT_TOPOLOGY_SIGNATURE_LIMITS };',
      'const topologySignatureCapabilities = { protocolVersion: TOPOLOGY_SIGNATURE_PROTOCOL_VERSION, fingerprint: "package-smoke/synthetic-topology@1" };',
      'const topologySignatureTolerance = { linear: 1e-6, angular: 1e-6, relative: 1e-8 };',
      'const capturedTopologySnapshot = { history: "complete", faces: [{ topology: "face", key: "captured-face", center: [0, 5, 5], bounds: { min: [0, 0, 0], max: [0, 10, 10] }, lineage: [{ feature: "synthetic-box", relation: "created" }, { feature: "synthetic-box", relation: "created", role: "box.face.x-min" }], area: 100, surface: { kind: "plane", normal: [-1, 0, 0] }, edges: [] }], edges: [] };',
      'const capturedTopologyReference = captureTopologyReference(capturedTopologySnapshot, "face", "captured-face", { capabilities: topologySignatureCapabilities, tolerance: topologySignatureTolerance, limits: topologySignatureLimits });',
      'if (!capturedTopologyReference.ok) throw new Error(JSON.stringify(capturedTopologyReference.diagnostics));',
      'const topologyLimitFailure = captureTopologyReference(capturedTopologySnapshot, "face", "captured-face", { capabilities: topologySignatureCapabilities, tolerance: topologySignatureTolerance, limits: { maxTopologyItems: 0 } });',
      'if (topologyLimitFailure.ok || topologyLimitFailure.diagnostics[0]?.code !== "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED") throw new Error("Topology-signature resource limit did not fail closed");',
      'const detachedTopologyJson = JSON.stringify(capturedTopologyReference.value);',
      'if (detachedTopologyJson.includes("captured-face") || /"key"\\s*:/.test(detachedTopologyJson) || /"[^"]*index[^"]*"\\s*:/i.test(detachedTopologyJson)) throw new Error("Persistent topology reference retained an evaluation key or index");',
      'const currentTopologySnapshot = { history: "complete", faces: [{ topology: "face", key: "current-face", center: [25, -10, 40], bounds: { min: [25, -30, 0], max: [25, 10, 80] }, lineage: [{ feature: "synthetic-box", relation: "created", role: "box.face.x-min" }, { feature: "synthetic-box", relation: "created" }], area: 3_200, surface: { kind: "plane", normal: [0, -1, 0] }, edges: [] }], edges: [] };',
      'const resolvedTopologyReference = resolveTopologyReference(capturedTopologyReference.value, currentTopologySnapshot, { capabilities: topologySignatureCapabilities, limits: topologySignatureLimits });',
      'if (!resolvedTopologyReference.ok) throw new Error(JSON.stringify(resolvedTopologyReference.diagnostics));',
      'if (resolvedTopologyReference.value.key !== "current-face" || resolvedTopologyReference.value.evidence !== "semantic-lineage") throw new Error("Persistent topology reference did not resolve through semantic lineage");',
      "",
      'const cad = design("package-smoke");',
      'const solid = cad.box("solid", { size: vec3(mm(2), mm(3), mm(4)) });',
      'const steel = cad.material("test-steel", { name: "Test steel", massDensity: kgPerCubicMeter(7850) });',
      'const part = cad.part("part", solid, { partNumber: "P-001", materialRef: steel });',
      'const assembly = cad.assembly("assembly", (instances) => { instances.instance("first", part); instances.instance("second", part, { placement: [tf.translate(vec3(mm(10), mm(0), mm(0)))] }); });',
      'cad.configuration("single-part", (configuration) => { configuration.instanceSuppressed(assembly, "second"); });',
      'cad.output("solid", solid).output("part", part).output("assembly", assembly);',
      "const document = cad.build();",
      'await writeFile("model-mass.invariantcad.json", stringifyDocument(document));',
      "const evaluator = await createEvaluator();",
      "try {",
      "  const result = await evaluator.evaluate(document);",
      "  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));",
      "  try {",
      '    const measured = result.value.output("solid").measure();',
      '    assertBoxMassProperties(measured, "Manifold box", 1e-7);',
      '    const principal = principalInertia(measured.inertiaTensor);',
      '    for (let index = 0; index < 3; index += 1) assertNear(principal.moments[index], [26, 40, 50][index], "principal moment[" + index + "]", 1e-7);',
      '    const principalRadii = principalRadiiOfGyration(measured);',
      '    const worldRadii = worldRadiiOfGyration(measured);',
      '    if (principalRadii === null || worldRadii === null) throw new Error("Packed gyration analysis returned null");',
      '    assertNear(momentOfInertiaAboutAxis(measured, { point: [0, 0, 0], direction: [1, 0, 0] }), 200, "global X inertia", 1e-7);',
      '    const physical = result.value.output("part").physicalMassProperties();',
      '    if (!physical.ok) throw new Error(JSON.stringify(physical.diagnostics));',
      '    assertNear(physical.value.mass, 0.0001884, "physical mass", 1e-12);',
      '    assertNear(physical.value.inertiaTensor[0][0], 0.0003925, "physical Ixx", 1e-12);',
      '    const bom = result.value.output("assembly").billOfMaterials();',
      '    if (!bom.ok) throw new Error(JSON.stringify(bom.diagnostics));',
      '    if (bom.value.totalQuantity !== 2 || bom.value.items.length !== 1 || bom.value.items[0].quantity !== 2) throw new Error("Packed BOM quantity rollup failed");',
      '    if (bom.value.items[0].materialId !== "test-steel" || bom.value.items[0].massDensitySource !== "material") throw new Error("Packed material resolution failed");',
      '    assertNear(bom.value.knownMass, 0.0003768, "BOM known mass", 1e-12);',
      '    assertNear(bom.value.totalMass, 0.0003768, "BOM total mass", 1e-12);',
      "  } finally {",
      "    result.value.dispose();",
      "  }",
      "} finally {",
      "  evaluator.dispose();",
      "}",
      "const exactKernel = await createOcctKernel();",
      "try {",
      '  const exactBox = exactKernel.box([2, 3, 4], false, { feature: "exact-box" });',
      '  assertBoxMassProperties(exactKernel.measure(exactBox), "OCCT box", 1e-9);',
      '  if (exactKernel.exportShape(exactBox, "step").byteLength < 100) throw new Error("STEP export was empty");',
      "  const snapshot = exactKernel.topology(exactBox);",
      '  const boxRoles = [...snapshot.faces, ...snapshot.edges].flatMap((item) => item.lineage.flatMap((lineage) => lineage.role === undefined ? [] : [lineage.role]));',
      '  if (snapshot.history !== "complete" || new Set(boxRoles).size !== 18) throw new Error("Semantic box roles were not packaged");',
      '  if (TOPOLOGY_ROLE_RULES["box.face.x-min"].topology !== "face") throw new Error("Topology role registry was not packaged");',
      '  if (!exactKernel.capabilities.topology?.signatures?.fingerprint.startsWith("invariantcad-topology-descriptor@2;")) throw new Error("OCCT descriptor fingerprint v2 was not packaged");',
      '  const directRevolution = exactKernel.revolve({ plane: { plane: "XY", origin: [0, 0, 0] }, outer: { curves: [{ kind: "line", start: [0, 0], end: [4, 0], source: { kind: "sketch-entity", sketch: "revolve-profile", entity: "bottom" } }, { kind: "line", start: [4, 0], end: [4, 3], source: { kind: "sketch-entity", sketch: "revolve-profile", entity: "right" } }, { kind: "line", start: [4, 3], end: [0, 3], source: { kind: "sketch-entity", sketch: "revolve-profile", entity: "top" } }, { kind: "line", start: [0, 3], end: [0, 0], source: { kind: "sketch-entity", sketch: "revolve-profile", entity: "axis" } }] }, holes: [] }, { angle: Math.PI * 2 }, { feature: "direct-revolution" });',
      '  const revolutionSnapshot = exactKernel.topology(directRevolution);',
      '  const revolutionRoles = revolutionSnapshot.faces.flatMap((face) => face.lineage.filter((lineage) => lineage.feature === "direct-revolution" && lineage.role === "revolve.face.swept"));',
      '  if (revolutionSnapshot.history !== "complete" || revolutionRoles.length !== 3 || revolutionSnapshot.edges.some((edge) => edge.lineage.some((lineage) => lineage.role?.startsWith("revolve.") === true))) throw new Error("Semantic revolution roles were not packaged");',
      '  if (new Set(revolutionRoles.map((lineage) => lineage.source?.entity)).size !== 3 || revolutionRoles.some((lineage) => lineage.source?.entity === "axis")) throw new Error("Semantic revolution sources were not packaged");',
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
      '  if (!kernelSupports(exactKernel.capabilities, "feature", "compositeSweep")) throw new Error("Exact composite sweep capability was not packaged");',
      '  if (COMPOSITE_PATH_MAX_JUNCTION_SINE !== 1e-8) throw new Error("Composite path tangent constant was not packaged");',
      '  const directCompositeSweep = exactKernel.compositeSweep({ plane: { plane: "YZ", origin: [0, 0, 0] }, outer: { curves: [{ kind: "line", start: [-1, -1], end: [1, -1] }, { kind: "line", start: [1, -1], end: [1, 1] }, { kind: "line", start: [1, 1], end: [-1, 1] }, { kind: "line", start: [-1, 1], end: [-1, -1] }] }, holes: [] }, { kind: "composite", start: [0, 0, 0], segments: [{ kind: "line", end: [5, 0, 0] }, { kind: "circularArc", through: [5 + 5 / Math.sqrt(2), 5 - 5 / Math.sqrt(2), 0], end: [10, 5, 0] }, { kind: "line", end: [10, 10, 0] }], closed: false }, { frame: "corrected-frenet", transition: "right-corner" }, { tolerance: 1e-7 });',
      '  if (Math.abs(exactKernel.measure(directCompositeSweep).volume - (40 + 10 * Math.PI)) > 1e-8) throw new Error("Unexpected exact composite sweep volume");',
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
      "  exactKernel.disposeShape(directRevolution);",
      "  exactKernel.disposeShape(directLoft);",
      "  exactKernel.disposeShape(directSweep);",
      "  exactKernel.disposeShape(directArcSweep);",
      "  exactKernel.disposeShape(directCompositeSweep);",
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
      'const compositeSweepCad = design("package-composite-sweep");',
      'const compositeSweepProfile = compositeSweepCad.sketch("profile", plane.yz(), (sketch) => sketch.profile(sketch.rectangle("section", { width: mm(2), height: mm(2) })));',
      'const compositeSweepPath = compositeSweepCad.compositePath("path", { start: vec3(mm(0), mm(0), mm(0)), segments: [{ kind: "line", end: vec3(mm(5), mm(0), mm(0)) }, { kind: "circularArc", through: vec3(mm(5 + 5 / Math.sqrt(2)), mm(5 - 5 / Math.sqrt(2)), mm(0)), end: vec3(mm(10), mm(5), mm(0)) }, { kind: "line", end: vec3(mm(10), mm(10), mm(0)) }] });',
      'compositeSweepCad.output("sweep", compositeSweepCad.sweep("sweep", compositeSweepProfile, compositeSweepPath));',
      'const compositeSweepDocument = compositeSweepCad.build();',
      'const compositeSweepJson = stringifyDocument(compositeSweepDocument);',
      'if (!compositeSweepJson.includes("compositePath") || !compositeSweepJson.includes("circularArc")) throw new Error("Composite sweep was not serialized");',
      'await writeFile("model-composite-sweep.invariantcad.json", compositeSweepJson);',
      'const compositeSweepEvaluator = await createEvaluator({ kernel: await createOcctKernel() });',
      'try {',
      '  const result = await compositeSweepEvaluator.evaluate(compositeSweepDocument);',
      '  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));',
      '  try {',
      '    const volume = result.value.output("sweep").measure().volume;',
      '    if (Math.abs(volume - (40 + 10 * Math.PI)) > 1e-8) throw new Error("Unexpected semantic composite sweep volume " + volume);',
      '  } finally {',
      '    result.value.dispose();',
      '  }',
      '} finally {',
      '  compositeSweepEvaluator.dispose();',
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
        'import { createEvaluator, deg, design, mm, plane, scalarVec3, topology, vec2, vec3 } from "invariantcad";',
        'import { createOcctKernel } from "invariantcad/kernels/occt";',
        "",
        'if (process.argv.length !== 3) throw new Error("Expected one explicit owned-facade runtime directory");',
        "const runtimeDirectory = resolve(process.argv[2]);",
        'const gluePath = join(runtimeDirectory, "occt-wasm.js");',
        'const wasmPath = join(runtimeDirectory, "occt-wasm.wasm");',
        "const loaded = await import(pathToFileURL(gluePath).href);",
        'if (typeof loaded.default !== "function") throw new Error("Owned facade glue has no default module factory");',
        "let facadeChecked = false;",
        "const moduleFactory = async (options) => {",
        "  const module = await loaded.default(options);",
        '  assert.equal(module.invariantcadFacadeVersion(), "invariantcad-facade@0.6.0+occt-wasm.3.7.0");',
        '  assert.equal(typeof module.InvariantCadPipeShellReport, "function");',
        '  assert.equal(typeof module.invariantcadPipeShellSolid, "function");',
        '  assert.equal(typeof module.InvariantCadBooleanReport, "function");',
        '  assert.equal(typeof module.invariantcadBooleanAtomic, "function");',
        '  assert.equal(typeof module.InvariantCadEdgeTreatmentReport, "function");',
        '  assert.equal(typeof module.invariantcadEdgeTreatmentAtomic, "function");',
        '  assert.equal(typeof module.InvariantCadSolidOffsetReport, "function");',
        '  assert.equal(typeof module.invariantcadSolidOffsetAtomic, "function");',
        '  assert.equal(module.InvariantCadSolidOffsetOperation.SHELL, 0);',
        '  assert.equal(module.InvariantCadSolidOffsetOperation.OFFSET, 1);',
        '  assert.equal(module.InvariantCadSolidOffsetDirection.INWARD, 0);',
        '  assert.equal(module.InvariantCadSolidOffsetDirection.OUTWARD, 1);',
        "  facadeChecked = true;",
        "  return module;",
        "};",
        "const kernel = await createOcctKernel({ moduleFactory, wasm: wasmPath });",
        "try {",
        '  assert.equal(facadeChecked, true, "Owned facade module was not checked");',
        '  for (const feature of ["draft", "boolean", "fillet", "chamfer", "shell", "offset"]) if (!kernel.capabilities.features.includes(feature)) throw new Error(`Installed kernel did not advertise owned exact ${feature} topology`);',
        "  assert.deepEqual(kernel.capabilities.exactIndexedTopologyEvolution, { protocolVersion: 1, features: [\"draft\", \"boolean\", \"fillet\", \"chamfer\", \"shell\", \"offset\"] });",
        '  assert.deepEqual(kernel.capabilities.compositeSweep, { protocolVersion: 1, refinements: ["major-multiple-arcs", "major-eccentric-profile"] });',
        '  if (kernel.draft === undefined || kernel.boolean === undefined || kernel.fillet === undefined || kernel.chamfer === undefined || kernel.shell === undefined || kernel.offset === undefined || kernel.topology === undefined) throw new Error("Installed owned facade lacks exact topology support");',
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
        "  let directBooleanTarget;",
        "  let directBooleanToolBase;",
        "  let directBooleanTool;",
        "  let directBoolean;",
        "  try {",
        '    directBooleanTarget = kernel.box([10, 10, 10], false, { feature: "installed-direct-boolean-target" });',
        '    directBooleanToolBase = kernel.box([10, 10, 10], false, { feature: "installed-direct-boolean-tool-base" });',
        '    directBooleanTool = kernel.transform(directBooleanToolBase, [{ kind: "translate", value: [5, 0, 0] }], { feature: "installed-direct-boolean-tool" });',
        '    directBoolean = kernel.boolean("union", directBooleanTarget, [directBooleanTool], { feature: "installed-direct-boolean" });',
        '    assert.ok(Math.abs(kernel.measure(directBoolean).volume - 1_500) <= 1e-8, "unexpected installed direct Boolean volume");',
        "    const directBooleanTopology = kernel.topology(directBoolean);",
        '    assert.equal(directBooleanTopology.history, "complete", "installed direct Boolean history");',
        '    assert.equal(directBooleanTopology.faces.length, 14, "installed direct Boolean face count");',
        '    assert.equal(directBooleanTopology.edges.length, 28, "installed direct Boolean edge count");',
        "    assert.ok(directBooleanTopology.faces.some((face) => face.lineage.some((lineage) =>",
        '      lineage.feature === "installed-direct-boolean" && lineage.relation === "modified"',
        '    )), "installed direct Boolean omitted modified lineage");',
        "  } finally {",
        "    if (directBoolean !== undefined) kernel.disposeShape(directBoolean);",
        "    if (directBooleanTool !== undefined) kernel.disposeShape(directBooleanTool);",
        "    if (directBooleanToolBase !== undefined) kernel.disposeShape(directBooleanToolBase);",
        "    if (directBooleanTarget !== undefined) kernel.disposeShape(directBooleanTarget);",
        "  }",
        "",
        "  for (const fixture of [{ operation: \"fillet\", amount: 2, volume: 5974.247779607694 }, { operation: \"chamfer\", amount: 2, volume: 5940 }]) {",
        "    let directInput;",
        "    let directResult;",
        "    try {",
        '      directInput = kernel.box([10, 20, 30], false, { feature: `installed-direct-${fixture.operation}-box` });',
        "      const inputTopology = kernel.topology(directInput);",
        '      const vertical = inputTopology.edges.filter((edge) => edge.curve.kind === "line" && edge.curve.direction !== undefined && Math.abs(edge.curve.direction[2]) > 1 - 1e-10);',
        '      assert.equal(vertical.length, 4, `installed direct ${fixture.operation} vertical edges`);',
        '      directResult = fixture.operation === "fillet" ? kernel.fillet(directInput, [vertical[0].key, vertical[0].key], { radius: fixture.amount }, { feature: "installed-direct-fillet" }) : kernel.chamfer(directInput, [vertical[0].key, vertical[0].key], { distance: fixture.amount }, { feature: "installed-direct-chamfer" });',
        '      assert.ok(Math.abs(kernel.measure(directResult).volume - fixture.volume) <= 1e-8, `unexpected installed direct ${fixture.operation} volume`);',
        "      const directTopology = kernel.topology(directResult);",
        '      assert.equal(directTopology.history, "complete", `installed direct ${fixture.operation} history`);',
        '      assert.equal(directTopology.faces.length, 7, `installed direct ${fixture.operation} faces`);',
        '      assert.equal(directTopology.edges.length, 15, `installed direct ${fixture.operation} edges`);',
        '      assert.ok([...directTopology.faces, ...directTopology.edges].some((descriptor) => descriptor.lineage.some((lineage) => lineage.feature === `installed-direct-${fixture.operation}` && lineage.relation === "created")), `installed direct ${fixture.operation} omitted created lineage`);',
        "    } finally {",
        "      if (directResult !== undefined) kernel.disposeShape(directResult);",
        "      if (directInput !== undefined) kernel.disposeShape(directInput);",
        "    }",
        "  }",
        "",
        "  let directSolidOffsetBox;",
        "  let directOffset;",
        "  let directShell;",
        "  try {",
        '    directSolidOffsetBox = kernel.box([20, 20, 10], false, { feature: "installed-direct-solid-offset-box" });',
        '    directOffset = kernel.offset(directSolidOffsetBox, { distance: 1, direction: "inward", tolerance: 1e-6 }, { feature: "installed-direct-offset" });',
        '    assert.ok(Math.abs(kernel.measure(directOffset).volume - 2_592) <= 1e-8, "unexpected installed direct offset volume");',
        "    const directOffsetTopology = kernel.topology(directOffset);",
        '    assert.equal(directOffsetTopology.history, "complete", "installed direct offset history");',
        '    assert.equal(directOffsetTopology.faces.length, 6, "installed direct offset faces");',
        '    assert.equal(directOffsetTopology.edges.length, 12, "installed direct offset edges");',
        '    const directOffsetTop = directOffsetTopology.faces.filter((face) => face.surface.kind === "plane" && face.surface.normal[2] > 1 - 1e-10 && face.lineage.some((lineage) => lineage.feature === "installed-direct-offset" && lineage.relation === "created"));',
        '    assert.equal(directOffsetTop.length, 1, "installed direct offset top face");',
        '    directShell = kernel.shell(directOffset, [directOffsetTop[0].key, directOffsetTop[0].key], { thickness: 0.5, direction: "inward", tolerance: 1e-6 }, { feature: "installed-direct-shell" });',
        '    assert.ok(Math.abs(kernel.measure(directShell).volume - 424.5) <= 1e-8, "unexpected installed direct shell volume");',
        "    const directShellTopology = kernel.topology(directShell);",
        '    assert.equal(directShellTopology.history, "complete", "installed direct shell history");',
        '    assert.equal(directShellTopology.faces.length, 11, "installed direct shell faces");',
        '    assert.equal(directShellTopology.edges.length, 24, "installed direct shell edges");',
        '    assert.ok([...directShellTopology.faces, ...directShellTopology.edges].some((descriptor) => descriptor.lineage.some((lineage) => lineage.feature === "installed-direct-offset") && descriptor.lineage.some((lineage) => lineage.feature === "installed-direct-shell")), "installed direct offset -> shell lineage chain was not preserved");',
        "  } finally {",
        "    if (directShell !== undefined) kernel.disposeShape(directShell);",
        "    if (directOffset !== undefined) kernel.disposeShape(directOffset);",
        "    if (directSolidOffsetBox !== undefined) kernel.disposeShape(directSolidOffsetBox);",
        "  }",
        "",
        '  const cad = design("installed-owned-facade-exact-topology");',
        '  const box = cad.box("box", { size: vec3(mm(20), mm(20), mm(10)) });',
        '  const drafted = cad.draft("drafted", box, {',
        '    faces: topology.faces.createdBy(box, { role: "box.face.x-min" }).exactly(1),',
        "    angle: deg(5),",
        "    pullDirection: scalarVec3(0, 0, 1),",
        "    neutralPlane: { origin: vec3(mm(0), mm(0), mm(0)), normal: scalarVec3(0, 0, 1) },",
        "  });",
        '  cad.output("drafted", drafted);',
        '  const multiArcProfile = cad.sketch("multi-arc-profile", plane.xy(), (sketch) => sketch.profile(sketch.rectangle("section", { width: mm(1), height: mm(1) })));',
        '  const multiArcPath = cad.compositePath("multi-arc-path", { start: vec3(mm(0), mm(0), mm(0)), segments: [{ kind: "circularArc", through: vec3(mm(20), mm(0), mm(0)), end: vec3(mm(10), mm(0), mm(-10)) }, { kind: "circularArc", through: vec3(mm(10 - 10 / Math.sqrt(2)), mm(10 - 10 / Math.sqrt(2)), mm(-10)), end: vec3(mm(0), mm(10), mm(-10)) }] });',
        '  cad.output("multi-arc-sweep", cad.sweep("multi-arc-sweep", multiArcProfile, multiArcPath));',
        '  const eccentricProfile = cad.sketch("eccentric-profile", plane.xy(), (sketch) => sketch.profile(sketch.rectangle("section", { width: mm(1), height: mm(1), center: vec2(mm(1), mm(0)) })));',
        '  const eccentricPath = cad.compositePath("eccentric-path", { start: vec3(mm(0), mm(0), mm(0)), segments: [{ kind: "line", end: vec3(mm(0), mm(0), mm(3)) }, { kind: "circularArc", through: vec3(mm(20), mm(0), mm(3)), end: vec3(mm(10), mm(0), mm(-7)) }, { kind: "line", end: vec3(mm(7), mm(0), mm(-7)) }] });',
        '  cad.output("eccentric-sweep", cad.sweep("eccentric-sweep", eccentricProfile, eccentricPath));',
        '  const booleanTarget = cad.box("boolean-target", { size: vec3(mm(10), mm(10), mm(10)) });',
        '  const booleanToolBase = cad.box("boolean-tool-base", { size: vec3(mm(10), mm(10), mm(10)) });',
        '  const booleanTool = cad.translate("boolean-tool", booleanToolBase, vec3(mm(5), mm(0), mm(0)));',
        '  const booleanUnion = cad.union("boolean-union", booleanTarget, [booleanTool]);',
        '  const booleanOpenings = topology.faces.createdBy(booleanTarget, { role: "box.face.z-max" }).or(topology.faces.createdBy(booleanToolBase, { role: "box.face.z-max" })).and(topology.faces.modifiedBy(booleanUnion)).exactly(3);',
        '  const booleanShell = cad.shell("boolean-shell", booleanUnion, { openings: booleanOpenings, thickness: mm(1), direction: "inward" });',
        '  cad.output("boolean-union", booleanUnion).output("boolean-shell", booleanShell);',
        '  const edgeTreatmentBox = cad.box("edge-treatment-box", { size: vec3(mm(10), mm(20), mm(30)) });',
        '  const edgeTreatmentSeeds = topology.edges.createdBy(edgeTreatmentBox).and(topology.edges.direction(scalarVec3(0, 0, 1))).exactly(4);',
        '  cad.output("exact-fillet", cad.fillet("exact-fillet", edgeTreatmentBox, { edges: edgeTreatmentSeeds, radius: mm(2) }));',
        '  cad.output("exact-chamfer", cad.chamfer("exact-chamfer", edgeTreatmentBox, { edges: edgeTreatmentSeeds, distance: mm(2) }));',
        '  const solidOffsetBox = cad.box("solid-offset-box", { size: vec3(mm(20), mm(20), mm(10)) });',
        '  const exactOffset = cad.offset("exact-offset", solidOffsetBox, { distance: mm(1), direction: "inward", tolerance: mm(1e-6) });',
        '  const exactShellOpening = topology.faces.createdBy(exactOffset).and(topology.faces.surface("plane"), topology.faces.normal(scalarVec3(0, 0, 1))).exactly(1);',
        '  const exactShell = cad.shell("exact-shell", exactOffset, { openings: exactShellOpening, thickness: mm(0.5), direction: "inward", tolerance: mm(1e-6) });',
        '  const exactShellDraftFaces = topology.faces.modifiedBy(exactShell).and(topology.faces.surface("plane"), topology.faces.normal(scalarVec3(-1, 0, 0))).exactly(1);',
        '  const exactShellDraft = cad.draft("exact-shell-draft", exactShell, { faces: exactShellDraftFaces, angle: deg(1), pullDirection: scalarVec3(0, 0, 1), neutralPlane: { origin: vec3(mm(0), mm(0), mm(0)), normal: scalarVec3(0, 0, 1) } });',
        '  cad.output("exact-offset", exactOffset).output("exact-shell", exactShell).output("exact-shell-draft", exactShellDraft);',
        "  const evaluator = await createEvaluator({ kernel });",
        "  try {",
        "    const result = await evaluator.evaluate(cad.build());",
        "    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));",
        "    try {",
        '      const evaluatedVolume = result.value.output("drafted").measure().volume;',
        '      assert.ok(Math.abs(evaluatedVolume - 3912.5113364740755) <= 1e-8, `unexpected installed evaluated draft volume ${evaluatedVolume}`);',
        '      const multiArcVolume = result.value.output("multi-arc-sweep").measure().volume;',
        '      assert.ok(Math.abs(multiArcVolume - 20 * Math.PI) <= 1e-7, `unexpected installed major multi-arc sweep volume ${multiArcVolume}`);',
        '      const eccentricVolume = result.value.output("eccentric-sweep").measure().volume;',
        '      assert.ok(Math.abs(eccentricVolume - (6 + 13.5 * Math.PI)) <= 1e-7, `unexpected installed eccentric major sweep volume ${eccentricVolume}`);',
        '      const booleanVolume = result.value.output("boolean-union").measure().volume;',
        '      assert.ok(Math.abs(booleanVolume - 1_500) <= 1e-8, `unexpected installed exact Boolean volume ${booleanVolume}`);',
        '      const booleanShellVolume = result.value.output("boolean-shell").measure().volume;',
        '      assert.ok(Math.abs(booleanShellVolume - 564) <= 1e-8, `unexpected installed exact Boolean shell volume ${booleanShellVolume}`);',
        '      const filletVolume = result.value.output("exact-fillet").measure().volume;',
        '      assert.ok(Math.abs(filletVolume - 5896.991118430776) <= 1e-8, `unexpected installed exact fillet volume ${filletVolume}`);',
        '      const chamferVolume = result.value.output("exact-chamfer").measure().volume;',
        '      assert.ok(Math.abs(chamferVolume - 5760) <= 1e-8, `unexpected installed exact chamfer volume ${chamferVolume}`);',
        '      const exactOffsetVolume = result.value.output("exact-offset").measure().volume;',
        '      assert.ok(Math.abs(exactOffsetVolume - 2_592) <= 1e-8, `unexpected installed evaluated exact offset volume ${exactOffsetVolume}`);',
        '      const exactShellVolume = result.value.output("exact-shell").measure().volume;',
        '      assert.ok(Math.abs(exactShellVolume - 424.5) <= 1e-8, `unexpected installed evaluated exact shell volume ${exactShellVolume}`);',
        '      const exactShellDraftVolume = result.value.output("exact-shell-draft").measure().volume;',
        '      assert.ok(Math.abs(exactShellDraftVolume - 411.9323532516833) <= 1e-8, `unexpected installed evaluated offset -> shell -> draft volume ${exactShellDraftVolume}`);',
        "    } finally {",
        "      result.value.dispose();",
        "    }",
        "  } finally {",
        "    evaluator.dispose();",
        "  }",
        "} finally {",
        "  kernel.dispose();",
        "}",
        'process.stdout.write("installed-owned-facade-exact-topology=ok\\n");',
        "",
      ].join("\n"),
    );
  }
  await writeFile(
    join(consumer, "type-smoke.ts"),
    [
      'import { DEFAULT_TOPOLOGY_SIGNATURE_LIMITS, EDGE_TOPOLOGY_ROLES, FACE_TOPOLOGY_ROLES, OFFSET_DIRECTIONS, SHELL_DIRECTIONS, TOPOLOGY_ROLE_RULES, TOPOLOGY_ROLES, TOPOLOGY_SIGNATURE_PROTOCOL_VERSION, angleVec3, captureTopologyReference, combinePhysicalMassProperties, deg, design, gramsPerCubicCentimeter, inertiaTensorAboutPoint, kgPerCubicMeter, kgPerCubicMillimeter, mm, momentOfInertiaAboutAxis, physicalMassProperties, plane, principalInertia, principalRadiiOfGyration, radiusOfGyrationAboutAxis, resolveTopologyReference, scalarVec3, tf, topology, vec3, worldRadiiOfGyration, type BillOfMaterials, type BillOfMaterialsItem, type ChamferNodeIR, type CircularArcPathNodeIR, type CompositePathNodeIR, type CompositePathSegmentExpression, type ConfigurationBuilder, type ConfigurationId, type ConfigurationOptions, type DesignConfigurationIR, type DesignDocument, type DraftNodeIR, type EdgeTopologyRole, type EvaluatedAssembly, type EvaluatedPart, type EvaluationOptions, type FaceTopologyRole, type InertiaAxis, type InertiaPropertySource, type InertiaTensor, type KernelTopologyKey, type KernelTopologySignatureCapabilities, type KernelTopologySnapshot, type LoftNodeIR, type MassDensityExpression, type MassDensitySource, type MaterialDefinitionIR, type MaterialRef, type OffsetDirection, type OffsetNodeIR, type PathRef, type PersistentTopologyReference, type PhysicalInertiaTensor, type PhysicalMassProperties, type PolylinePathNodeIR, type PrincipalAxes, type PrincipalAxisStatus, type PrincipalInertiaDegeneracy, type PrincipalInertiaOptions, type PrincipalInertiaResult, type ProfileRef, type ResolvedCompositePath, type ResolvedTopologyReference, type ShellDirection, type ShellNodeIR, type SolidRef, type SweepNodeIR, type TopologyMatchTolerance, type TopologyOriginOptions, type TopologyRole, type TopologySelection, type TopologySignatureLimits, type VolumetricMassProperties } from "invariantcad";',
      'import { DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT, DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT, DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT, createOcctKernel, type OcctKernelOptions, type OcctModuleFactory, type OcctModuleOptions } from "invariantcad/kernels/occt";',
      "",
      'const topologySignatureProtocol: typeof TOPOLOGY_SIGNATURE_PROTOCOL_VERSION = 1;',
      'const topologySignatureCapabilities: KernelTopologySignatureCapabilities = { protocolVersion: topologySignatureProtocol, fingerprint: "package-type-smoke/topology@1" };',
      'const topologyMatchTolerance: TopologyMatchTolerance = { linear: 1e-6, angular: 1e-6, relative: 1e-8 };',
      'const topologySignatureLimits: TopologySignatureLimits = DEFAULT_TOPOLOGY_SIGNATURE_LIMITS;',
      'const topologyKey = "typed-face" as KernelTopologyKey;',
      'const topologySnapshot: KernelTopologySnapshot = { history: "complete", faces: [{ topology: "face", key: topologyKey, center: [0, 0, 0], bounds: { min: [0, 0, 0], max: [0, 0, 0] }, lineage: [{ feature: "typed-box", relation: "created", role: "box.face.x-min" }], area: 1, surface: { kind: "plane", normal: [-1, 0, 0] }, edges: [] }], edges: [] };',
      'const topologyCapture = captureTopologyReference(topologySnapshot, "face", topologyKey, { capabilities: topologySignatureCapabilities, tolerance: topologyMatchTolerance, limits: topologySignatureLimits });',
      'if (!topologyCapture.ok) throw new Error("Typed topology capture failed");',
      'const persistentTopologyReference: PersistentTopologyReference<"face"> = topologyCapture.value;',
      'const topologyResolution = resolveTopologyReference(persistentTopologyReference, topologySnapshot, { capabilities: topologySignatureCapabilities, limits: topologySignatureLimits });',
      'if (!topologyResolution.ok) throw new Error("Typed topology resolution failed");',
      'const resolvedTopologyReference: ResolvedTopologyReference = topologyResolution.value;',
      'void [persistentTopologyReference, resolvedTopologyReference, topologySignatureLimits];',
      "",
      'const cad = design("type-smoke");',
      'const solid: SolidRef = cad.box("solid", { size: vec3(mm(1), mm(2), mm(3)) });',
      'const authoredDensity = cad.parameter.massDensity("density", kgPerCubicMeter(2700));',
      'const materialRef: MaterialRef = cad.material("aluminum", { name: "Aluminum", massDensity: authoredDensity });',
      'const densePart = cad.part("dense-part", solid, { partNumber: "P-001", materialRef });',
      'const configurationOptions: ConfigurationOptions = { description: "Typed package configuration" };',
      'const configurationId: ConfigurationId = cad.configuration("typed", (configuration: ConfigurationBuilder) => { configuration.parameter(authoredDensity, kgPerCubicMeter(2800)); }, configurationOptions);',
      'const evaluationOptions: EvaluationOptions = { configuration: configurationId };',
      "if (false) {",
      '  cad.configuration("wrong-dimension", (configuration) => {',
      "    // @ts-expect-error A mass-density parameter cannot take a length expression.",
      "    configuration.parameter(authoredDensity, mm(1));",
      "  });",
      "}",
      'const materialDefinition: MaterialDefinitionIR = { name: "Aluminum", massDensity: kgPerCubicMeter(2700).ir };',
      'const inertiaTensor: InertiaTensor = [[1, 0, 0], [0, 2, 0], [0, 0, 3]];',
      'const volumetric: VolumetricMassProperties = { volume: 1, centerOfMass: [0, 0, 0], inertiaTensor };',
      'const propertySource: InertiaPropertySource = volumetric;',
      'const massDensity: MassDensityExpression = kgPerCubicMeter(1000);',
      'const baseDensity: MassDensityExpression = kgPerCubicMillimeter(1e-6);',
      'const gramDensity: MassDensityExpression = gramsPerCubicCentimeter(1);',
      'const physical: PhysicalMassProperties = physicalMassProperties(volumetric, 1e-6);',
      'const physicalTensor: PhysicalInertiaTensor = physical.inertiaTensor;',
      'const principalOptions: PrincipalInertiaOptions = { relativeDegeneracyTolerance: 1e-12 };',
      'const principal: PrincipalInertiaResult = principalInertia(inertiaTensor, principalOptions);',
      'const principalAxes: PrincipalAxes = principal.axes;',
      'const principalStatus: PrincipalAxisStatus = principal.axisStatus[0];',
      'const principalDegeneracy: PrincipalInertiaDegeneracy = principal.degeneracy;',
      'const inertiaAxis: InertiaAxis = { point: [0, 0, 0], direction: [1, 0, 0] };',
      'type PartPhysicalResult = ReturnType<EvaluatedPart["physicalMassProperties"]>;',
      'type AssemblyPhysicalResult = ReturnType<EvaluatedAssembly["physicalMassProperties"]>;',
      'type PartBomResult = ReturnType<EvaluatedPart["billOfMaterials"]>;',
      'type AssemblyBomResult = ReturnType<EvaluatedAssembly["billOfMaterials"]>;',
      'const acceptsPhysicalResult = (_value: PartPhysicalResult | AssemblyPhysicalResult): void => {};',
      'const acceptsBomResult = (_value: PartBomResult | AssemblyBomResult): void => {};',
      'const densitySource: MassDensitySource = "material";',
      'const bomItem: BillOfMaterialsItem = { partNode: "dense-part", partNumber: "P-001", description: null, materialId: "aluminum", material: "Aluminum", quantity: 1, occurrenceIds: [], massDensity: 2.7e-6, massDensitySource: densitySource, definitionMass: 0.0000162, totalMass: 0.0000162 };',
      'const billOfMaterials: BillOfMaterials = { configurationId: null, units: { mass: "kg" }, items: [bomItem], totalQuantity: 1, massComplete: true, knownMass: 0.0000162, totalMass: 0.0000162 };',
      'void [propertySource, massDensity, baseDensity, gramDensity, physicalTensor, principalAxes, principalStatus, principalDegeneracy, materialDefinition, materialRef, configurationOptions, evaluationOptions, billOfMaterials, acceptsPhysicalResult, acceptsBomResult, combinePhysicalMassProperties([physical]), inertiaTensorAboutPoint(volumetric, [0, 0, 0]), momentOfInertiaAboutAxis(volumetric, inertiaAxis), worldRadiiOfGyration(volumetric), principalRadiiOfGyration(volumetric), radiusOfGyrationAboutAxis(volumetric, inertiaAxis)];',
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
      'const compositeSegments: readonly CompositePathSegmentExpression[] = [{ kind: "line", end: vec3(mm(0), mm(0), mm(3)) }, { kind: "circularArc", through: vec3(mm(3 - 3 / Math.sqrt(2)), mm(0), mm(3 + 3 / Math.sqrt(2))), end: vec3(mm(3), mm(0), mm(6)) }, { kind: "line", end: vec3(mm(6), mm(0), mm(6)) }];',
      'const compositePath: PathRef = cad.compositePath("composite-path", { start: vec3(mm(0), mm(0), mm(0)), segments: compositeSegments });',
      'const compositeSwept: SolidRef = cad.sweep("composite-swept", loftBottom, compositePath);',
      'const resolvedComposite: ResolvedCompositePath = { kind: "composite", start: [0, 0, 0], segments: [{ kind: "line", end: [0, 0, 3] }, { kind: "circularArc", through: [3 - 3 / Math.sqrt(2), 0, 3 + 3 / Math.sqrt(2)], end: [3, 0, 6] }, { kind: "line", end: [6, 0, 6] }], closed: false };',
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
      "// @ts-expect-error Part density must be a mass-density expression.",
      'cad.part("invalid-density", solid, { massDensity: mm(1) });',
      "// @ts-expect-error Material density must be a mass-density expression.",
      'cad.material("invalid-material-density", { name: "Invalid", massDensity: mm(1) });',
      "// @ts-expect-error Part materialRef requires a material reference.",
      'cad.part("invalid-material-ref", solid, { materialRef: densePart });',
      "// @ts-expect-error A part cannot mix a legacy label with a material reference.",
      'cad.part("ambiguous-material", solid, { material: "Aluminum", materialRef });',
      'cad.output("solid", rounded);',
      'cad.output("dense-part", densePart);',
      'cad.output("beveled", beveled);',
      'cad.output("hollow", hollow);',
      'cad.output("expanded", expanded);',
      'cad.output("drafted", drafted);',
      'cad.output("lofted", lofted);',
      'cad.output("swept", swept);',
      'cad.output("arc-swept", arcSwept);',
      'cad.output("composite-swept", compositeSwept);',
      "const document: DesignDocument = cad.build();",
      'const configurationDefinition: DesignConfigurationIR = document.configurations![configurationId]!;',
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
      'const maybeCompositePath = document.nodes[compositePath.node];',
      'if (maybeCompositePath?.kind !== "compositePath") throw new Error("Missing composite path IR");',
      'const compositePathNode: CompositePathNodeIR = maybeCompositePath;',
      'if (compositePathNode.closed !== false || compositePathNode.segments[1]?.kind !== "circularArc") throw new Error("Invalid composite path IR types");',
      'const maybeSweep = document.nodes[swept.node];',
      'if (maybeSweep?.kind !== "sweep") throw new Error("Missing sweep IR");',
      'const sweepNode: SweepNodeIR = maybeSweep;',
      'if (sweepNode.frame !== "corrected-frenet" || sweepNode.transition !== "right-corner") throw new Error("Invalid sweep IR types");',
      'const moduleFactory: OcctModuleFactory = async (_moduleOptions?: OcctModuleOptions) => ({});',
      "const options: OcctKernelOptions = { moduleFactory, maxExactBooleanHistoryRecords: DEFAULT_OCCT_EXACT_BOOLEAN_HISTORY_RECORD_LIMIT, maxExactEdgeTreatmentHistoryRecords: DEFAULT_OCCT_EXACT_EDGE_TREATMENT_HISTORY_RECORD_LIMIT, maxExactSolidOffsetHistoryRecords: DEFAULT_OCCT_EXACT_SOLID_OFFSET_HISTORY_RECORD_LIMIT };",
      "void createOcctKernel(options);",
      "void [document, configurationDefinition];",
      "void resolvedComposite;",
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
      'const revolveFaceRole: FaceTopologyRole = "revolve.face.swept";',
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
      'if (!allRoles.includes(edgeRole) || !edgeRoles.includes(edgeRole) || !faceRoles.includes(faceRole) || !faceRoles.includes(revolveFaceRole)) throw new Error("Missing typed topology roles");',
      'if (TOPOLOGY_ROLE_RULES[edgeRole].source !== "sketch-curve") throw new Error("Missing topology role rule");',
      'if (TOPOLOGY_ROLE_RULES[revolveFaceRole].producer !== "revolve" || TOPOLOGY_ROLE_RULES[revolveFaceRole].source !== "sketch-curve") throw new Error("Missing revolution topology role rule");',
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
  run(bin, ["validate", "model-mass.invariantcad.json"], consumer);
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
  const massInspection = JSON.parse(
    run(bin, ["inspect", "model-mass.invariantcad.json"], consumer, {
      printOutput: false,
    }),
  );
  if (
    massInspection.solid.principalInertia.moments.join(",") !== "26,40,50" ||
    Math.abs(massInspection.part.physicalMassProperties.mass - 0.0001884) >
      1e-12 ||
    massInspection.part.physicalMassProperties.principalRadiiOfGyration === null
  ) {
    throw new Error("Installed CLI omitted physical mass analysis");
  }
  const configuredInspection = JSON.parse(
    run(
      bin,
      [
        "inspect",
        "model-mass.invariantcad.json",
        "--configuration",
        "single-part",
      ],
      consumer,
      { printOutput: false },
    ),
  );
  if (Math.abs(configuredInspection.assembly.volume - 24) > 1e-7) {
    throw new Error("Installed CLI ignored the named configuration for inspect");
  }
  const installedBom = JSON.parse(
    run(
      bin,
      ["bom", "model-mass.invariantcad.json", "--output", "assembly"],
      consumer,
      { printOutput: false },
    ),
  );
  if (
    installedBom.output !== "assembly" ||
    installedBom.totalQuantity !== 2 ||
    installedBom.items.length !== 1 ||
    installedBom.items[0].quantity !== 2 ||
    installedBom.items[0].materialId !== "test-steel" ||
    installedBom.items[0].massDensitySource !== "material" ||
    Math.abs(installedBom.totalMass - 0.0003768) > 1e-12
  ) {
    throw new Error("Installed CLI omitted deterministic material BOM analysis");
  }
  const installedConfiguredBom = JSON.parse(
    run(
      bin,
      [
        "bom",
        "model-mass.invariantcad.json",
        "--output",
        "assembly",
        "--configuration=single-part",
      ],
      consumer,
      { printOutput: false },
    ),
  );
  if (
    installedConfiguredBom.configurationId !== "single-part" ||
    installedConfiguredBom.totalQuantity !== 1 ||
    installedConfiguredBom.items.length !== 1 ||
    installedConfiguredBom.items[0].occurrenceIds.join(",") !== "first"
  ) {
    throw new Error("Installed CLI omitted named-configuration BOM selection");
  }
  run(
    bin,
    [
      "export",
      "model-mass.invariantcad.json",
      "--output",
      "assembly",
      "--configuration",
      "single-part",
      "--to",
      "single-part.obj",
    ],
    consumer,
  );
  if ((await stat(join(consumer, "single-part.obj"))).size < 100) {
    throw new Error("Installed CLI produced an empty configured export");
  }
  run(
    bin,
    ["validate", "model-composite-sweep.invariantcad.json"],
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
  run(
    bin,
    [
      "export",
      "model-composite-sweep.invariantcad.json",
      "--output",
      "sweep",
      "--to",
      "composite-sweep.step",
    ],
    consumer,
  );
  if ((await stat(join(consumer, "composite-sweep.step"))).size < 100) {
    throw new Error(
      "Installed CLI produced an empty composite sweep STEP file",
    );
  }
  process.stdout.write("Packed package smoke test passed.\n");
} finally {
  await rm(consumer, { recursive: true, force: true });
}
