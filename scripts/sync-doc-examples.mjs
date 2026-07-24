import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
if (mode !== "--check" && mode !== "--write") {
  throw new Error("Usage: node scripts/sync-doc-examples.mjs --check|--write");
}

const manifestPath = resolve(
  repositoryRoot,
  "examples/docs/manifest.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (
  manifest === null ||
  typeof manifest !== "object" ||
  manifest.version !== 1 ||
  !Array.isArray(manifest.examples) ||
  manifest.examples.length === 0
) {
  throw new Error("examples/docs/manifest.json: unsupported manifest");
}
const examples = manifest.examples;

function marker(direction, id, style) {
  return style === "html"
    ? `<!-- docs-example:${direction} ${id} -->`
    : `{/* docs-example:${direction} ${id} */}`;
}

function uniqueIndex(text, token, path) {
  const index = text.indexOf(token);
  if (index === -1) throw new Error(`${path}: missing marker '${token}'`);
  if (text.indexOf(token, index + token.length) !== -1) {
    throw new Error(`${path}: duplicate marker '${token}'`);
  }
  return index;
}

async function sourceRegion(example) {
  if (
    typeof example.id !== "string" ||
    example.id.length === 0 ||
    typeof example.source !== "string" ||
    !/^[a-z0-9][a-z0-9-]*\.ts$/u.test(example.source) ||
    !Array.isArray(example.targets)
  ) {
    throw new Error("examples/docs/manifest.json: malformed example entry");
  }
  const sourcePath = `examples/docs/${example.source}`;
  const text = await readFile(
    resolve(repositoryRoot, sourcePath),
    "utf8",
  );
  const lines = text.split("\n");
  const start = `// docs-example:start ${example.id}`;
  const end = `// docs-example:end ${example.id}`;
  const startIndex = lines.indexOf(start);
  const endIndex = lines.indexOf(end);
  if (
    startIndex === -1 ||
    endIndex <= startIndex ||
    lines.lastIndexOf(start) !== startIndex ||
    lines.lastIndexOf(end) !== endIndex
  ) {
    throw new Error(`${sourcePath}: expected one ordered '${example.id}' region`);
  }
  const code = lines.slice(startIndex + 1, endIndex).join("\n");
  if (code.length === 0 || code.includes("```")) {
    throw new Error(`${sourcePath}: invalid '${example.id}' region`);
  }
  return code;
}

const seenTargets = new Set();
const updates = [];
for (const example of examples) {
  const code = await sourceRegion(example);
  for (const target of example.targets) {
    if (
      target === null ||
      typeof target !== "object" ||
      typeof target.path !== "string" ||
      (target.style !== "html" && target.style !== "mdx")
    ) {
      throw new Error(
        `examples/docs/manifest.json: malformed target for '${example.id}'`,
      );
    }
    if (seenTargets.has(target.path)) {
      throw new Error(`${target.path}: only one generated region is supported`);
    }
    seenTargets.add(target.path);

    const absolutePath = resolve(repositoryRoot, target.path);
    const original = await readFile(absolutePath, "utf8");
    const start = marker("start", example.id, target.style);
    const end = marker("end", example.id, target.style);
    const startIndex = uniqueIndex(original, start, target.path);
    const endIndex = uniqueIndex(original, end, target.path);
    if (endIndex <= startIndex) {
      throw new Error(`${target.path}: markers for '${example.id}' are reversed`);
    }

    const block = [
      start,
      "",
      "```ts",
      code,
      "```",
      "",
      end,
    ].join("\n");
    const generated =
      original.slice(0, startIndex) +
      block +
      original.slice(endIndex + end.length);
    if (generated !== original) {
      updates.push({ path: target.path, absolutePath, generated });
    }
  }
}

if (mode === "--check" && updates.length !== 0) {
  throw new Error(
    `Generated documentation examples are stale: ${updates
      .map((update) => update.path)
      .join(", ")}. Run pnpm docs:generate.`,
  );
}
if (mode === "--write") {
  for (const update of updates) {
    await writeFile(update.absolutePath, update.generated, "utf8");
  }
}

console.log(
  mode === "--write"
    ? updates.length === 0
      ? "Documentation examples are already synchronized."
      : `Synchronized documentation examples in ${updates
          .map((update) => update.path)
          .join(", ")}.`
    : `Documentation examples are synchronized across ${seenTargets.size} placements.`,
);
