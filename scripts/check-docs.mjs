import { access, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const docsRoot = resolve(repositoryRoot, "docs");
const configuration = JSON.parse(
  await readFile(resolve(docsRoot, "docs.json"), "utf8"),
);

function collectPages(value, pages = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectPages(item, pages);
    return pages;
  }
  if (typeof value !== "object" || value === null) return pages;
  for (const [key, item] of Object.entries(value)) {
    if (key === "pages" && Array.isArray(item)) {
      for (const page of item) {
        if (typeof page === "string") pages.push(page);
        else collectPages(page, pages);
      }
    } else {
      collectPages(item, pages);
    }
  }
  return pages;
}

async function existingPage(pathWithoutExtension) {
  const candidates = /\.mdx?$/.test(pathWithoutExtension)
    ? [resolve(docsRoot, pathWithoutExtension)]
    : [
        resolve(docsRoot, `${pathWithoutExtension}.mdx`),
        resolve(docsRoot, `${pathWithoutExtension}.md`),
        resolve(docsRoot, pathWithoutExtension, "index.mdx"),
        resolve(docsRoot, pathWithoutExtension, "index.md"),
      ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return undefined;
}

const pages = collectPages(configuration.navigation);
const duplicates = pages.filter((page, index) => pages.indexOf(page) !== index);
if (duplicates.length !== 0) {
  throw new Error(`Duplicate Mintlify navigation pages: ${[...new Set(duplicates)].join(", ")}`);
}

const navigatedFiles = [];
for (const page of pages) {
  const file = await existingPage(page);
  if (file === undefined) throw new Error(`Mintlify page '${page}' does not exist`);
  navigatedFiles.push(file);
  const text = await readFile(file, "utf8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (frontmatter === null) {
    throw new Error(`${relative(repositoryRoot, file)} has no frontmatter`);
  }
  for (const field of ["title", "description"]) {
    if (!new RegExp(`^${field}:\\s*["']?.+`, "m").test(frontmatter[1])) {
      throw new Error(`${relative(repositoryRoot, file)} has no ${field}`);
    }
  }
}

async function allDocumentationFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await allDocumentationFiles(path)));
    else if (entry.name.endsWith(".md") || entry.name.endsWith(".mdx")) files.push(path);
  }
  return files;
}

const linkPattern = /(?:\]\(|\bhref=["'])([^)"']+)(?:\)|["'])/g;
const failures = [];
const documentationFiles = await allDocumentationFiles(docsRoot);
const navigated = new Set(navigatedFiles);
const orphaned = documentationFiles.filter(
  (file) => relative(docsRoot, file) !== "README.md" && !navigated.has(file),
);
if (orphaned.length !== 0) {
  throw new Error(
    `Documentation pages missing from Mintlify navigation: ${orphaned
      .map((file) => relative(repositoryRoot, file))
      .join(", ")}`,
  );
}

for (const file of documentationFiles) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1];
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:") ||
      target.startsWith("#")
    ) {
      continue;
    }
    const withoutAnchor = target.split("#", 1)[0];
    if (withoutAnchor === "" || withoutAnchor === "/") continue;
    if (withoutAnchor.startsWith("/assets/")) {
      try {
        await access(resolve(docsRoot, withoutAnchor.slice(1)));
      } catch {
        failures.push(`${relative(repositoryRoot, file)} -> ${target}`);
      }
      continue;
    }
    if (withoutAnchor.startsWith("/")) {
      if ((await existingPage(withoutAnchor.slice(1))) === undefined) {
        failures.push(`${relative(repositoryRoot, file)} -> ${target}`);
      }
      continue;
    }
    const resolved = resolve(file, "..", withoutAnchor);
    if (!resolved.startsWith(`${docsRoot}/`)) continue;
    const relativeTarget = relative(docsRoot, resolved);
    if ((await existingPage(relativeTarget)) === undefined) {
      failures.push(`${relative(repositoryRoot, file)} -> ${target}`);
    }
  }
}

if (failures.length !== 0) {
  console.error("Documentation contains broken internal links:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Documentation validation passed: ${pages.length} navigated pages with valid frontmatter and internal links.`,
);
