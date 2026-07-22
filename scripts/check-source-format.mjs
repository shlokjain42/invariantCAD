import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceDirectories = ["src", "tests", "examples", "scripts"];
const sourceFiles = ["tsup.config.ts", "vitest.config.ts"];
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".mjs", ".mts", ".ts"]);

async function collectSourceFiles(directory) {
  const entries = await readdir(join(projectRoot, directory), {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const projectRelativePath = join(directory, entry.name);
    if (projectRelativePath === join("src", "vendor")) continue;

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(projectRelativePath));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      files.push(projectRelativePath);
    }
  }

  return files;
}

const files = [
  ...sourceFiles,
  ...(await Promise.all(sourceDirectories.map(collectSourceFiles))).flat(),
].sort((left, right) => left.localeCompare(right));
const diagnostics = [];

for (const file of files) {
  const contents = await readFile(join(projectRoot, file), "utf8");
  if (contents.startsWith("\uFEFF")) diagnostics.push(`${file}: remove the UTF-8 BOM`);
  if (contents.includes("\r")) diagnostics.push(`${file}: use LF line endings`);
  if (!contents.endsWith("\n")) diagnostics.push(`${file}: add a final newline`);
  if (contents.endsWith("\n\n")) diagnostics.push(`${file}: remove extra final newlines`);

  const lines = contents.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    if (/[ \t]+$/u.test(line)) {
      diagnostics.push(`${file}:${index + 1}: remove trailing whitespace`);
    }
    if (/^\t/u.test(line)) {
      diagnostics.push(`${file}:${index + 1}: indent with spaces, not tabs`);
    }
  }
}

if (diagnostics.length !== 0) {
  for (const diagnostic of diagnostics) console.error(diagnostic);
  console.error(`Source format hygiene failed with ${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}.`);
  process.exitCode = 1;
} else {
  console.log(`Source format hygiene passed for ${files.length} files.`);
}
