import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface ManifestTarget {
  readonly path: string;
  readonly style: "html" | "mdx";
}

interface ManifestExample {
  readonly id: string;
  readonly source: string;
  readonly workflows: readonly string[];
  readonly targets: readonly ManifestTarget[];
}

interface DocumentationExample {
  readonly id: string;
  readonly checks: Readonly<Record<string, boolean>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyStrings(
  value: unknown,
  label: string,
): readonly string[] {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(
    value.length > 0 &&
      value.every((item) => typeof item === "string" && item.length > 0),
    `${label} must contain non-empty strings`,
  );
  return value as readonly string[];
}

function parseExample(value: unknown, index: number): ManifestExample {
  const label = `examples[${index}]`;
  assert.ok(isRecord(value), `${label} must be an object`);
  const { id, source, workflows, targets } = value;
  assert.ok(typeof id === "string" && id.length > 0, `${label}.id is invalid`);
  assert.ok(
    typeof source === "string" &&
      basename(source) === source &&
      /^[a-z0-9][a-z0-9-]*\.ts$/u.test(source),
    `${label}.source must be a kebab-case TypeScript file name`,
  );
  assert.ok(Array.isArray(targets), `${label}.targets must be an array`);
  for (const [targetIndex, target] of targets.entries()) {
    assert.ok(
      isRecord(target) &&
        typeof target.path === "string" &&
        target.path.length > 0 &&
        (target.style === "html" || target.style === "mdx"),
      `${label}.targets[${targetIndex}] is invalid`,
    );
  }
  return {
    id,
    source,
    workflows: nonEmptyStrings(workflows, `${label}.workflows`),
    targets: targets as unknown as readonly ManifestTarget[],
  };
}

const examplesDirectory = resolve("examples/docs");
const rawManifest = JSON.parse(
  await readFile(resolve(examplesDirectory, "manifest.json"), "utf8"),
) as unknown;
assert.ok(isRecord(rawManifest), "The documentation manifest must be an object");
assert.equal(rawManifest.version, 1, "Unsupported documentation manifest");

const infrastructure = nonEmptyStrings(
  rawManifest.infrastructure,
  "infrastructure",
);
assert.ok(
  infrastructure.every((file) =>
    /^[a-z0-9][a-z0-9-]*\.ts$/u.test(file),
  ),
  "Infrastructure entries must be kebab-case TypeScript files",
);
assert.ok(Array.isArray(rawManifest.examples), "examples must be an array");
const examples = rawManifest.examples.map(parseExample);
assert.ok(examples.length > 0, "examples must not be empty");

const unique = (values: readonly string[], label: string) =>
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
unique(examples.map((example) => example.id), "Example IDs");
unique(examples.map((example) => example.source), "Example source files");
unique(
  examples.flatMap((example) =>
    example.targets.map((target) => target.path),
  ),
  "Synchronized targets",
);

const listedFiles = [
  ...infrastructure,
  ...examples.map((example) => example.source),
].sort();
unique(listedFiles, "Listed TypeScript files");
assert.deepEqual(
  (await readdir(examplesDirectory))
    .filter((file) => file.endsWith(".ts"))
    .sort(),
  listedFiles,
  "Every examples/docs TypeScript file must be explicitly listed",
);

for (const example of examples) {
  const sourcePath = resolve(examplesDirectory, example.source);
  const source = await readFile(sourcePath, "utf8");
  const start = `// docs-example:start ${example.id}`;
  const end = `// docs-example:end ${example.id}`;
  assert.equal(source.split(start).length, 2, `${example.source}: invalid start marker`);
  assert.equal(source.split(end).length, 2, `${example.source}: invalid end marker`);
  assert.ok(source.indexOf(start) < source.indexOf(end), `${example.source}: reversed markers`);

  const loaded = (await import(pathToFileURL(sourcePath).href)) as Record<
    string,
    unknown
  >;
  const contract = loaded.documentationExample;
  assert.ok(isRecord(contract), `${example.source}: missing documentationExample`);
  assert.equal(contract.id, example.id, `${example.source}: mismatched example ID`);
  assert.ok(isRecord(contract.checks), `${example.source}: missing runtime checks`);
  const checks = Object.entries(
    (contract as unknown as DocumentationExample).checks,
  );
  assert.ok(checks.length > 0, `${example.source}: no runtime checks`);
  for (const [name, passed] of checks) {
    assert.equal(passed, true, `${example.id}: '${name}' did not pass`);
  }
}

const workflowCount = new Set(
  examples.flatMap((example) => example.workflows),
).size;
console.log(
  `Documentation examples passed ${examples.length} canonical modules covering ${workflowCount} declared workflows.`,
);
