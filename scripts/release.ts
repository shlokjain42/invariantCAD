import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  prepareRelease,
  releaseNotesBody,
  releaseNotesPath,
  releaseProblems,
  type ReleaseSources,
} from "./release-policy.js";

const usage = `Usage:
  tsx scripts/release.ts prepare <version> [--date YYYY-MM-DD]
  tsx scripts/release.ts check <version>
  tsx scripts/release.ts notes <version>`;

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const projectPath = (path: string): string => `${projectRoot}${path}`;

async function readSources(): Promise<ReleaseSources> {
  const [changelog, packageJson, docsJson] = await Promise.all([
    readFile(projectPath("CHANGELOG.md"), "utf8"),
    readFile(projectPath("package.json"), "utf8"),
    readFile(projectPath("docs/docs.json"), "utf8"),
  ]);
  return { changelog, packageJson, docsJson };
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(projectPath(path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function prepare(version: string, date: string): Promise<void> {
  const notesPath = releaseNotesPath(version);
  if ((await readOptional(notesPath)) !== undefined) {
    throw new Error(`${notesPath} already exists`);
  }
  const prepared = prepareRelease(await readSources(), version, date);
  await Promise.all([
    writeFile(projectPath("CHANGELOG.md"), prepared.changelog),
    writeFile(projectPath("package.json"), prepared.packageJson),
    writeFile(projectPath("docs/docs.json"), prepared.docsJson),
    writeFile(projectPath(prepared.releaseNotesPath), prepared.releaseNotes, {
      flag: "wx",
    }),
  ]);
  console.log(
    `Prepared invariantcad ${version} (previous ${prepared.previousVersion}): ` +
      `CHANGELOG.md, package.json, docs/docs.json, ${prepared.releaseNotesPath}`,
  );
}

async function check(version: string): Promise<void> {
  const problems = releaseProblems(
    { ...(await readSources()), releaseNotes: await readOptional(releaseNotesPath(version)) },
    version,
  );
  if (problems.length !== 0) {
    throw new Error(`Release ${version} is inconsistent:\n- ${problems.join("\n- ")}`);
  }
  console.log(`Release metadata for invariantcad ${version} is consistent.`);
}

async function notes(version: string): Promise<void> {
  const page = await readOptional(releaseNotesPath(version));
  if (page === undefined) throw new Error(`${releaseNotesPath(version)} does not exist`);
  process.stdout.write(releaseNotesBody(page));
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, version, ...rest] = argv;
  if (command === undefined || version === undefined) throw new Error(usage);
  if (command === "prepare") {
    let date = new Date().toISOString().slice(0, 10);
    if (rest.length === 2 && rest[0] === "--date" && rest[1] !== undefined) {
      date = rest[1];
    } else if (rest.length !== 0) {
      throw new Error(usage);
    }
    await prepare(version, date);
    return;
  }
  if (rest.length !== 0) throw new Error(usage);
  if (command === "check") return check(version);
  if (command === "notes") return notes(version);
  throw new Error(usage);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
