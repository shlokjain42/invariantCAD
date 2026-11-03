/**
 * Pure release rules shared by `scripts/release.ts`, the release workflows,
 * and their tests.
 *
 * A release starts as a reviewed pull request. Preparation moves the curated
 * `Unreleased` changelog entries under a dated version heading, updates the
 * changelog comparison links, bumps `package.json`, and adds the matching
 * release-notes page and navigation entry. Verification re-derives those same
 * facts from the merged commit before anything is published.
 */

export const REPOSITORY_URL = "https://github.com/shlokjain42/invariantCAD";

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const RELEASE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const UNRELEASED_HEADING = "\n## [Unreleased]\n";
const SECTION_HEADING_PREFIX = "\n## [";

/** A parsed stable `major.minor.patch` version. */
export type StableVersion = readonly [major: number, minor: number, patch: number];

/** The repository files that one release reads and rewrites. */
export interface ReleaseSources {
  readonly changelog: string;
  readonly packageJson: string;
  readonly docsJson: string;
}

/** The complete rewritten file set for one prepared release. */
export interface PreparedRelease extends ReleaseSources {
  readonly previousVersion: string;
  readonly releaseNotesPath: string;
  readonly releaseNotes: string;
}

/** The merged-commit files that must agree before publication. */
export interface ReleaseCheckSources extends ReleaseSources {
  readonly releaseNotes: string | undefined;
}

/** Parses a stable version, rejecting prereleases, build metadata, and leading zeroes. */
export function parseStableVersion(version: string): StableVersion {
  const match = STABLE_VERSION.exec(version);
  if (match === null) {
    throw new Error(`Expected a stable X.Y.Z version, received '${version}'`);
  }
  const parts = [match[1], match[2], match[3]].map(Number);
  const [major, minor, patch] = parts;
  if (
    major === undefined ||
    minor === undefined ||
    patch === undefined ||
    !parts.every(Number.isSafeInteger)
  ) {
    throw new Error(`Version components must be safe integers: '${version}'`);
  }
  return [major, minor, patch];
}

/** Orders two stable versions; negative when `left` is older. */
export function compareStableVersions(left: string, right: string): number {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Requires an existing calendar date written as `YYYY-MM-DD`. */
export function assertReleaseDate(date: string): void {
  const time = RELEASE_DATE.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  const valid =
    !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === date;
  if (!valid) {
    throw new Error(`Expected a release date written as YYYY-MM-DD, received '${date}'`);
  }
}

/** Returns the release-notes page path for one version. */
export function releaseNotesPath(version: string): string {
  parseStableVersion(version);
  return `docs/releases/${version}.md`;
}

/** Reads `version` from package.json text. */
export function packageVersion(packageJson: string): string {
  const parsed: unknown = JSON.parse(packageJson);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error("package.json must declare a string version");
  }
  parseStableVersion(parsed.version);
  return parsed.version;
}

/**
 * Prepares every release file for `version` without touching the filesystem.
 * The current package version becomes the previous release.
 */
export function prepareRelease(
  sources: ReleaseSources,
  version: string,
  date: string,
): PreparedRelease {
  parseStableVersion(version);
  assertReleaseDate(date);
  const previousVersion = packageVersion(sources.packageJson);
  if (compareStableVersions(version, previousVersion) <= 0) {
    throw new Error(
      `Release ${version} must be newer than the current version ${previousVersion}`,
    );
  }

  const unreleased = splitUnreleased(sources.changelog);
  if (sources.changelog.includes(`${SECTION_HEADING_PREFIX}${version}]`)) {
    throw new Error(`CHANGELOG.md already has a ${version} section`);
  }
  const changelogWithSection =
    `${unreleased.before}${UNRELEASED_HEADING}\n## [${version}] - ${date}\n\n` +
    `${unreleased.body}\n${unreleased.after}`;
  const changelog = updateChangelogLinks(
    changelogWithSection,
    previousVersion,
    version,
  );

  return {
    previousVersion,
    changelog,
    packageJson: bumpPackageVersion(sources.packageJson, previousVersion, version),
    docsJson: addReleaseNavigation(sources.docsJson, version),
    releaseNotesPath: releaseNotesPath(version),
    releaseNotes: releaseNotesPage(version, unreleased.body),
  };
}

/** Builds the initial release-notes page from the released changelog entries. */
export function releaseNotesPage(version: string, changelogEntries: string): string {
  parseStableVersion(version);
  const body = changelogEntries.trim();
  if (body === "") throw new Error("Release notes need at least one entry");
  return (
    `---\ntitle: "InvariantCAD ${version}"\n` +
    `description: "Release notes for InvariantCAD ${version}."\n` +
    `icon: "package"\n---\n\n# InvariantCAD ${version}\n\n${body}\n`
  );
}

/**
 * Returns the GitHub release body for a release-notes page: the Markdown after
 * the page's YAML frontmatter, as published for earlier releases.
 */
export function releaseNotesBody(page: string): string {
  if (!page.startsWith("---\n")) {
    throw new Error("Release notes must start with YAML frontmatter");
  }
  const end = page.indexOf("\n---\n", 3);
  if (end === -1) throw new Error("Release notes frontmatter is not closed");
  const body = page.slice(end + "\n---\n".length).replace(/^\n+/u, "");
  if (body.trim() === "") throw new Error("Release notes body is empty");
  return body;
}

/** Lists every disagreement between the merged files and `version`. */
export function releaseProblems(
  sources: ReleaseCheckSources,
  version: string,
): readonly string[] {
  parseStableVersion(version);
  const problems: string[] = [];

  const actualVersion = packageVersion(sources.packageJson);
  if (actualVersion !== version) {
    problems.push(`package.json version is ${actualVersion}, expected ${version}`);
  }

  const section = changelogSection(sources.changelog, version);
  if (section === undefined) {
    problems.push(`CHANGELOG.md has no dated '## [${version}] - YYYY-MM-DD' section`);
  } else if (section.trim() === "") {
    problems.push(`CHANGELOG.md section ${version} is empty`);
  }
  const links = sources.changelog.split("\n");
  if (!links.includes(`[Unreleased]: ${REPOSITORY_URL}/compare/v${version}...HEAD`)) {
    problems.push(`CHANGELOG.md [Unreleased] link must compare v${version}...HEAD`);
  }
  if (!links.some((line) => line.startsWith(`[${version}]: ${REPOSITORY_URL}/`))) {
    problems.push(`CHANGELOG.md is missing the [${version}] comparison link`);
  }

  if (!navigationPages(sources.docsJson).includes(`releases/${version}`)) {
    problems.push(`docs/docs.json navigation is missing releases/${version}`);
  }

  if (sources.releaseNotes === undefined) {
    problems.push(`${releaseNotesPath(version)} does not exist`);
  } else {
    if (!sources.releaseNotes.includes(`\ntitle: "InvariantCAD ${version}"\n`)) {
      problems.push(`${releaseNotesPath(version)} title must be "InvariantCAD ${version}"`);
    }
    try {
      releaseNotesBody(sources.releaseNotes);
    } catch (error) {
      problems.push(`${releaseNotesPath(version)}: ${(error as Error).message}`);
    }
  }
  return problems;
}

interface UnreleasedSplit {
  readonly before: string;
  readonly body: string;
  readonly after: string;
}

function splitUnreleased(changelog: string): UnreleasedSplit {
  const start = changelog.indexOf(UNRELEASED_HEADING);
  if (start === -1 || changelog.indexOf(UNRELEASED_HEADING, start + 1) !== -1) {
    throw new Error("CHANGELOG.md must contain exactly one '## [Unreleased]' heading");
  }
  const bodyStart = start + UNRELEASED_HEADING.length;
  const next = changelog.indexOf(SECTION_HEADING_PREFIX, bodyStart);
  if (next === -1) {
    throw new Error("CHANGELOG.md must keep a released section after Unreleased");
  }
  const body = changelog.slice(bodyStart, next).trim();
  if (body === "") {
    throw new Error("CHANGELOG.md has no Unreleased entries to release");
  }
  return { before: changelog.slice(0, start), body, after: changelog.slice(next) };
}

function changelogSection(changelog: string, version: string): string | undefined {
  const headingPrefix = `${SECTION_HEADING_PREFIX}${version}] - `;
  const headingStart = changelog.indexOf(headingPrefix);
  if (headingStart === -1) return undefined;
  const dateStart = headingStart + headingPrefix.length;
  const date = changelog.slice(dateStart, dateStart + "YYYY-MM-DD".length);
  if (changelog[dateStart + date.length] !== "\n") return undefined;
  try {
    assertReleaseDate(date);
  } catch {
    return undefined;
  }
  const bodyStart = dateStart + date.length + 1;
  const next = changelog.indexOf(SECTION_HEADING_PREFIX, bodyStart);
  const linksStart = changelog.indexOf("\n[Unreleased]: ", bodyStart);
  const ends = [next, linksStart].filter((index) => index !== -1);
  return changelog.slice(bodyStart, ends.length === 0 ? undefined : Math.min(...ends));
}

function updateChangelogLinks(
  changelog: string,
  previousVersion: string,
  version: string,
): string {
  const unreleasedLink = `[Unreleased]: ${REPOSITORY_URL}/compare/v${previousVersion}...HEAD`;
  const lines = changelog.split("\n");
  const matches = lines.filter((line) => line === unreleasedLink);
  if (matches.length !== 1) {
    throw new Error(`CHANGELOG.md must contain exactly one '${unreleasedLink}' line`);
  }
  return lines
    .flatMap((line) =>
      line === unreleasedLink
        ? [
            `[Unreleased]: ${REPOSITORY_URL}/compare/v${version}...HEAD`,
            `[${version}]: ${REPOSITORY_URL}/compare/v${previousVersion}...v${version}`,
          ]
        : [line],
    )
    .join("\n");
}

function bumpPackageVersion(
  packageJson: string,
  previousVersion: string,
  version: string,
): string {
  const line = `\n  "version": "${previousVersion}",\n`;
  const first = packageJson.indexOf(line);
  if (first === -1 || packageJson.indexOf(line, first + 1) !== -1) {
    throw new Error("package.json must contain exactly one top-level version line");
  }
  const bumped = packageJson.replace(line, `\n  "version": "${version}",\n`);
  if (packageVersion(bumped) !== version) {
    throw new Error("package.json version bump did not round-trip");
  }
  return bumped;
}

function addReleaseNavigation(docsJson: string, version: string): string {
  const page = `releases/${version}`;
  const parsed: unknown = JSON.parse(docsJson);
  let inserted = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      const firstRelease = value.findIndex(
        (entry) => typeof entry === "string" && entry.startsWith("releases/"),
      );
      if (firstRelease !== -1) {
        if (value.includes(page)) {
          throw new Error(`docs/docs.json already lists ${page}`);
        }
        value.splice(firstRelease, 0, page);
        inserted += 1;
        return;
      }
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const entry of Object.values(value)) visit(entry);
    }
  };
  visit(parsed);
  if (inserted !== 1) {
    throw new Error("docs/docs.json must have exactly one navigation group of release pages");
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function navigationPages(docsJson: string): readonly string[] {
  const pages: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      pages.push(value);
    } else if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
    } else if (typeof value === "object" && value !== null) {
      for (const entry of Object.values(value)) visit(entry);
    }
  };
  visit(JSON.parse(docsJson));
  return pages;
}
