import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REPOSITORY_URL,
  assertReleaseDate,
  compareStableVersions,
  parseStableVersion,
  prepareRelease,
  releaseNotesBody,
  releaseNotesPage,
  releaseProblems,
  type ReleaseSources,
} from "../scripts/release-policy.js";

const repositoryFile = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const fixture: ReleaseSources = {
  changelog: [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "- Added a new thing.",
    "- Fixed another thing.",
    "",
    "## [1.2.3] - 2026-01-02",
    "",
    "- Shipped.",
    "",
    `[Unreleased]: ${REPOSITORY_URL}/compare/v1.2.3...HEAD`,
    `[1.2.3]: ${REPOSITORY_URL}/compare/v1.2.2...v1.2.3`,
    "",
  ].join("\n"),
  packageJson: '{\n  "name": "invariantcad",\n  "version": "1.2.3",\n  "type": "module"\n}\n',
  docsJson: `${JSON.stringify(
    {
      navigation: {
        tabs: [
          { groups: [{ group: "Guides", pages: ["index"] }] },
          { groups: [{ group: "Project", pages: ["releasing", "releases/1.2.3"] }] },
        ],
      },
    },
    null,
    2,
  )}\n`,
};

describe("release versions", () => {
  it("accepts only stable versions without leading zeroes", () => {
    expect(parseStableVersion("0.2.0")).toEqual([0, 2, 0]);
    for (const invalid of ["0.2", "v0.2.0", "0.2.0-next.1", "0.2.0+build", "01.2.0", " 0.2.0"]) {
      expect(() => parseStableVersion(invalid)).toThrow(/stable X\.Y\.Z/u);
    }
  });

  it("orders versions numerically", () => {
    expect(compareStableVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareStableVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareStableVersions("0.1.1", "0.2.0")).toBeLessThan(0);
  });

  it("accepts only real calendar dates", () => {
    expect(() => assertReleaseDate("2026-11-03")).not.toThrow();
    for (const invalid of ["2026-02-30", "2026-13-01", "26-11-03", "2026-11-3"]) {
      expect(() => assertReleaseDate(invalid)).toThrow(/YYYY-MM-DD/u);
    }
  });
});

describe("release preparation", () => {
  it("moves Unreleased entries under a dated heading and wires every file", () => {
    const prepared = prepareRelease(fixture, "1.3.0", "2026-11-03");

    expect(prepared.previousVersion).toBe("1.2.3");
    expect(prepared.changelog).toBe(
      [
        "# Changelog",
        "",
        "## [Unreleased]",
        "",
        "## [1.3.0] - 2026-11-03",
        "",
        "- Added a new thing.",
        "- Fixed another thing.",
        "",
        "## [1.2.3] - 2026-01-02",
        "",
        "- Shipped.",
        "",
        `[Unreleased]: ${REPOSITORY_URL}/compare/v1.3.0...HEAD`,
        `[1.3.0]: ${REPOSITORY_URL}/compare/v1.2.3...v1.3.0`,
        `[1.2.3]: ${REPOSITORY_URL}/compare/v1.2.2...v1.2.3`,
        "",
      ].join("\n"),
    );
    expect(prepared.packageJson).toBe(fixture.packageJson.replace('"1.2.3"', '"1.3.0"'));
    const docs = JSON.parse(prepared.docsJson) as {
      navigation: { tabs: { groups: { pages: string[] }[] }[] };
    };
    expect(docs.navigation.tabs[1]?.groups[0]?.pages).toEqual([
      "releasing",
      "releases/1.3.0",
      "releases/1.2.3",
    ]);
    expect(docs.navigation.tabs[0]?.groups[0]?.pages).toEqual(["index"]);
    expect(prepared.releaseNotesPath).toBe("docs/releases/1.3.0.md");
    expect(releaseNotesBody(prepared.releaseNotes)).toBe(
      "# InvariantCAD 1.3.0\n\n- Added a new thing.\n- Fixed another thing.\n",
    );
    expect(
      releaseProblems({ ...prepared, releaseNotes: prepared.releaseNotes }, "1.3.0"),
    ).toEqual([]);
  });

  it("rejects versions that do not advance the package", () => {
    expect(() => prepareRelease(fixture, "1.2.3", "2026-11-03")).toThrow(/newer than/u);
    expect(() => prepareRelease(fixture, "1.2.2", "2026-11-03")).toThrow(/newer than/u);
  });

  it("refuses an empty Unreleased section", () => {
    const changelog = fixture.changelog.replace(
      "- Added a new thing.\n- Fixed another thing.\n",
      "",
    );
    expect(() => prepareRelease({ ...fixture, changelog }, "1.3.0", "2026-11-03")).toThrow(
      /no Unreleased entries/u,
    );
  });

  it("refuses a stale Unreleased comparison link", () => {
    const changelog = fixture.changelog.replace("compare/v1.2.3...HEAD", "compare/v1.2.2...HEAD");
    expect(() => prepareRelease({ ...fixture, changelog }, "1.3.0", "2026-11-03")).toThrow(
      /exactly one '\[Unreleased\]/u,
    );
  });

  it("refuses an existing version section or navigation entry", () => {
    const changelog = fixture.changelog.replace(
      "## [1.2.3] - 2026-01-02",
      "## [1.3.0] - 2026-01-03\n\n- Early.\n\n## [1.2.3] - 2026-01-02",
    );
    expect(() => prepareRelease({ ...fixture, changelog }, "1.3.0", "2026-11-03")).toThrow(
      /already has a 1\.3\.0 section/u,
    );
    const docsJson = fixture.docsJson.replace('"releases/1.2.3"', '"releases/1.3.0", "releases/1.2.3"');
    expect(() => prepareRelease({ ...fixture, docsJson }, "1.3.0", "2026-11-03")).toThrow(
      /already lists releases\/1\.3\.0/u,
    );
  });
});

describe("release verification", () => {
  it("reports every inconsistency instead of stopping at the first", () => {
    const problems = releaseProblems({ ...fixture, releaseNotes: undefined }, "1.3.0");
    expect(problems).toEqual([
      "package.json version is 1.2.3, expected 1.3.0",
      "CHANGELOG.md has no dated '## [1.3.0] - YYYY-MM-DD' section",
      "CHANGELOG.md [Unreleased] link must compare v1.3.0...HEAD",
      "CHANGELOG.md is missing the [1.3.0] comparison link",
      "docs/docs.json navigation is missing releases/1.3.0",
      "docs/releases/1.3.0.md does not exist",
    ]);
  });

  it("rejects release notes without frontmatter or body", () => {
    expect(() => releaseNotesBody("# Title\n")).toThrow(/frontmatter/u);
    expect(() => releaseNotesBody("---\ntitle: x\n")).toThrow(/not closed/u);
    expect(() => releaseNotesBody("---\ntitle: x\n---\n\n")).toThrow(/empty/u);
    expect(() => releaseNotesPage("1.3.0", "  \n")).toThrow(/at least one entry/u);
  });
});

describe("repository release state", () => {
  const sources: ReleaseSources = {
    changelog: repositoryFile("CHANGELOG.md"),
    packageJson: repositoryFile("package.json"),
    docsJson: repositoryFile("docs/docs.json"),
  };
  const currentVersion = (JSON.parse(sources.packageJson) as { version: string }).version;

  it("keeps the current package version consistent with its published release files", () => {
    expect(
      releaseProblems(
        { ...sources, releaseNotes: repositoryFile(`docs/releases/${currentVersion}.md`) },
        currentVersion,
      ),
    ).toEqual([]);
  });

  it("derives GitHub release notes from the page body after frontmatter", () => {
    const body = releaseNotesBody(repositoryFile(`docs/releases/${currentVersion}.md`));
    expect(body.startsWith(`# InvariantCAD ${currentVersion}\n`)).toBe(true);
    expect(body).not.toMatch(/^title:/mu);
  });

  it("can prepare the next minor release from the current Unreleased entries", () => {
    const [major, minor] = parseStableVersion(currentVersion);
    const next = `${major}.${minor + 1}.0`;
    const prepared = prepareRelease(sources, next, "2026-11-03");
    expect(
      releaseProblems({ ...prepared, releaseNotes: prepared.releaseNotes }, next),
    ).toEqual([]);
    expect(prepared.docsJson.length).toBeGreaterThan(sources.docsJson.length);
  });
});
