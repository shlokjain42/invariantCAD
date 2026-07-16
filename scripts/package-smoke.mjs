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
      'import { createEvaluator, design, mm, stringifyDocument, vec3 } from "invariantcad";',
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
      "  const exactBox = exactKernel.box([2, 3, 4], false);",
      '  if (Math.abs(exactKernel.measure(exactBox).volume - 24) > 1e-9) throw new Error("Unexpected exact volume");',
      '  if (exactKernel.exportShape(exactBox, "step").byteLength < 100) throw new Error("STEP export was empty");',
      "  exactKernel.disposeShape(exactBox);",
      "} finally {",
      "  exactKernel.dispose();",
      "}",
      'await writeFile("model.invariantcad.json", stringifyDocument(document));',
      'process.stdout.write("package-consumer-volume=24\\n");',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumer, "type-smoke.ts"),
    [
      'import { design, mm, vec3, type DesignDocument, type SolidRef } from "invariantcad";',
      'import { createOcctKernel, type OcctKernelOptions } from "invariantcad/kernels/occt";',
      "",
      'const cad = design("type-smoke");',
      'const solid: SolidRef = cad.box("solid", { size: vec3(mm(1), mm(2), mm(3)) });',
      'cad.output("solid", solid);',
      "const document: DesignDocument = cad.build();",
      "const options: OcctKernelOptions = {};",
      "void createOcctKernel(options);",
      "void document;",
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
