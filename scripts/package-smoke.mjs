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
      'import { TOPOLOGY_ROLE_RULES, angleVec3, createEvaluator, deg, design, mm, plane, scalarVec3, stringifyDocument, tf, topology, vec3 } from "invariantcad";',
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
      "  const vertical = snapshot.edges.filter((edge) => Math.abs(edge.curve.direction?.[2] ?? 0) > 0.999);",
      '  if (vertical.length !== 4) throw new Error("Unexpected vertical edge count");',
      "  const rounded = exactKernel.fillet(exactBox, vertical.map((edge) => edge.key), { radius: 0.2 });",
      '  if (!(exactKernel.measure(rounded).volume < 24)) throw new Error("Fillet did not remove material");',
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
      "const provenanceJson = stringifyDocument(provenanceCad.build());",
      'if (!provenanceJson.includes("extrude.edge.end-rim") || !provenanceJson.includes("outline.e1")) throw new Error("Semantic provenance was not serialized");',
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
      'import { EDGE_TOPOLOGY_ROLES, FACE_TOPOLOGY_ROLES, TOPOLOGY_ROLE_RULES, TOPOLOGY_ROLES, angleVec3, deg, design, mm, plane, scalarVec3, tf, topology, vec3, type DesignDocument, type EdgeTopologyRole, type FaceTopologyRole, type ProfileRef, type SolidRef, type TopologyOriginOptions, type TopologyRole, type TopologySelection } from "invariantcad";',
      'import { createOcctKernel, type OcctKernelOptions } from "invariantcad/kernels/occt";',
      "",
      'const cad = design("type-smoke");',
      'const solid: SolidRef = cad.box("solid", { size: vec3(mm(1), mm(2), mm(3)) });',
      'const edges = topology.edges.createdBy(solid).and(topology.edges.direction(scalarVec3(0, 0, 1))).exactly(4);',
      'const rounded: SolidRef = cad.fillet("rounded", solid, { edges, radius: mm(0.1) });',
      'cad.output("solid", rounded);',
      "const document: DesignDocument = cad.build();",
      "const options: OcctKernelOptions = {};",
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
      'provenanceCad.output("rounded", provenanceRounded);',
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
  run(
    bin,
    ["export", "model.invariantcad.json", "--to", "model.step"],
    consumer,
  );
  if ((await stat(join(consumer, "model.step"))).size < 100) {
    throw new Error("Installed CLI produced an empty STEP file");
  }
  process.stdout.write("Packed package smoke test passed.\n");
} finally {
  await rm(consumer, { recursive: true, force: true });
}
