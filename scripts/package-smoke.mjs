import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
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
      'import { OFFSET_DIRECTIONS, OFFSET_JOIN_SEMANTICS, SHELL_DIRECTIONS, SHELL_JOIN_SEMANTICS, TOPOLOGY_ROLE_RULES, angleVec3, createEvaluator, deg, design, kernelSupports, mm, plane, scalarVec3, stringifyDocument, tf, topology, vec3 } from "invariantcad";',
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
      'const filletCad = design("package-fillet");',
      'const filletBox = filletCad.box("box", { size: vec3(mm(10), mm(20), mm(30)) });',
      'const filletEdges = topology.edges.createdBy(filletBox).and(topology.edges.direction(scalarVec3(0, 0, 1))).exactly(4);',
      'filletCad.output("rounded", filletCad.fillet("rounded", filletBox, { edges: filletEdges, radius: mm(2) }));',
      'await writeFile("model.invariantcad.json", stringifyDocument(filletCad.build()));',
      'process.stdout.write("package-consumer-volume=24\\n");',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumer, "type-smoke.ts"),
    [
      'import { EDGE_TOPOLOGY_ROLES, FACE_TOPOLOGY_ROLES, OFFSET_DIRECTIONS, SHELL_DIRECTIONS, TOPOLOGY_ROLE_RULES, TOPOLOGY_ROLES, angleVec3, deg, design, mm, plane, scalarVec3, tf, topology, vec3, type ChamferNodeIR, type DesignDocument, type DraftNodeIR, type EdgeTopologyRole, type FaceTopologyRole, type OffsetDirection, type OffsetNodeIR, type ProfileRef, type ShellDirection, type ShellNodeIR, type SolidRef, type TopologyOriginOptions, type TopologyRole, type TopologySelection } from "invariantcad";',
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
  run(
    process.execPath,
    [join(projectRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
    consumer,
  );
  run(process.execPath, ["smoke.mjs"], consumer);

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
  process.stdout.write("Packed package smoke test passed.\n");
} finally {
  await rm(consumer, { recursive: true, force: true });
}
