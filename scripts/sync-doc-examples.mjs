import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2];
if (mode !== "--check" && mode !== "--write") {
  throw new Error("Usage: node scripts/sync-doc-examples.mjs --check|--write");
}

const examples = [
  {
    id: "parametric-box-default",
    source: "examples/docs/parametric-box.ts",
    targets: [
      { path: "README.md", style: "html" },
      { path: "docs/get-started/installation.mdx", style: "mdx" },
    ],
  },
  {
    id: "mounting-plate-default-and-exact",
    source: "examples/docs/mounting-plate.ts",
    targets: [
      { path: "docs/get-started/quickstart.mdx", style: "mdx" },
      { path: "docs/reference/complete-guide.md", style: "mdx" },
    ],
  },
];

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
  const text = await readFile(
    resolve(repositoryRoot, example.source),
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
    throw new Error(`${example.source}: expected one ordered '${example.id}' region`);
  }
  const code = lines.slice(startIndex + 1, endIndex).join("\n");
  if (code.length === 0 || code.includes("```")) {
    throw new Error(`${example.source}: invalid '${example.id}' region`);
  }
  return code;
}

const seenTargets = new Set();
const updates = [];
for (const example of examples) {
  const code = await sourceRegion(example);
  for (const target of example.targets) {
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
