import { readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
);

if (
  packageJson.bin === null ||
  typeof packageJson.bin !== "object" ||
  Array.isArray(packageJson.bin)
) {
  throw new Error("package.json bin must be an object");
}

for (const [name, target] of Object.entries(packageJson.bin)) {
  if (typeof target !== "string" || target.length === 0) {
    throw new Error(`bin[${name}] must be a non-empty string`);
  }
  if (target.startsWith("./")) {
    throw new Error(
      `bin[${name}] must use npm's canonical package-relative form without './': ${target}`,
    );
  }

  const targetPath = resolve(projectRoot, target);
  const packageRelativeTarget = relative(projectRoot, targetPath);
  if (
    packageRelativeTarget === "" ||
    packageRelativeTarget === ".." ||
    packageRelativeTarget.startsWith(`..${sep}`)
  ) {
    throw new Error(`bin[${name}] escapes the package root: ${target}`);
  }

  const [contents, metadata] = await Promise.all([
    readFile(targetPath, "utf8"),
    stat(targetPath),
  ]);
  if (!contents.startsWith("#!/usr/bin/env node\n")) {
    throw new Error(`bin[${name}] must start with a Node.js shebang: ${target}`);
  }
  if (process.platform !== "win32" && (metadata.mode & 0o111) === 0) {
    throw new Error(`bin[${name}] must be executable: ${target}`);
  }
}

console.log(
  `Validated ${Object.keys(packageJson.bin).length} canonical npm executable${Object.keys(packageJson.bin).length === 1 ? "" : "s"}.`,
);
