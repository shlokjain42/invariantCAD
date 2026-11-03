import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DOCUMENTATION_URL,
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

  it("accepts the just-released state, whose Unreleased section is empty", () => {
    const released = prepareRelease(fixture, "1.3.0", "2026-11-03");
    expect(released.changelog).toContain("## [Unreleased]\n\n## [1.3.0] - 2026-11-03\n");
    expect(releaseProblems({ ...released, releaseNotes: released.releaseNotes }, "1.3.0")).toEqual(
      [],
    );
    expect(() => prepareRelease(released, "1.4.0", "2026-11-04")).toThrow(
      /no Unreleased entries/u,
    );
  });

  it("requires a real date on the version heading", () => {
    const prepared = prepareRelease(fixture, "1.3.0", "2026-11-03");
    for (const heading of ["## [1.3.0] - 2026-13-03", "## [1.3.0] - 2026-11-03 (yanked)"]) {
      const changelog = prepared.changelog.replace("## [1.3.0] - 2026-11-03", heading);
      expect(
        releaseProblems({ ...prepared, changelog, releaseNotes: prepared.releaseNotes }, "1.3.0"),
      ).toContain("CHANGELOG.md has no dated '## [1.3.0] - YYYY-MM-DD' section");
    }
  });

  it("rewrites documentation-relative links to absolute site URLs for GitHub", () => {
    const page = [
      "---",
      'title: "InvariantCAD 1.3.0"',
      "---",
      "",
      "# InvariantCAD 1.3.0",
      "",
      "See [profiles](/evaluation/evaluator) and [the matrix](/reference/support-matrix#occt).",
      "Read the [roadmap](../roadmap.md), [import](../interchange/import-export.mdx),",
      "the [previous notes](0.1.1.md), [this release](./1.3.0), and the [home](/).",
      '![diagram](/assets/flow.svg "Flow") and <a href="/get-started/quickstart">start</a>.',
      "Keep [GitHub](https://github.com/shlokjain42/invariantCAD), [mail](mailto:a@b.c),",
      "and [anchors](#highlights) as written, as well as `[code](/not-a-link)`.",
      "",
      "[reference]: /guides/index",
      "",
      "```md",
      "[fenced](/not-a-link)",
      "```",
      "",
    ].join("\n");
    expect(releaseNotesBody(page)).toBe(
      [
        "# InvariantCAD 1.3.0",
        "",
        `See [profiles](${DOCUMENTATION_URL}/evaluation/evaluator) and [the matrix](${DOCUMENTATION_URL}/reference/support-matrix#occt).`,
        `Read the [roadmap](${DOCUMENTATION_URL}/roadmap), [import](${DOCUMENTATION_URL}/interchange/import-export),`,
        `the [previous notes](${DOCUMENTATION_URL}/releases/0.1.1), [this release](${DOCUMENTATION_URL}/releases/1.3.0), and the [home](${DOCUMENTATION_URL}/).`,
        `![diagram](${DOCUMENTATION_URL}/assets/flow.svg "Flow") and <a href="${DOCUMENTATION_URL}/get-started/quickstart">start</a>.`,
        "Keep [GitHub](https://github.com/shlokjain42/invariantCAD), [mail](mailto:a@b.c),",
        "and [anchors](#highlights) as written, as well as `[code](/not-a-link)`.",
        "",
        `[reference]: ${DOCUMENTATION_URL}/guides`,
        "",
        "```md",
        "[fenced](/not-a-link)",
        "```",
        "",
      ].join("\n"),
    );
  });

  it("rejects a release-notes link that leaves the documentation site", () => {
    const page = '---\ntitle: "x"\n---\n\nSee [changes](../../CHANGELOG.md).\n';
    expect(() => releaseNotesBody(page)).toThrow(
      "Release notes link '../../CHANGELOG.md' leaves the documentation site; use an absolute URL",
    );
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

  it("publishes no site-relative links in any release body", () => {
    expect(JSON.parse(sources.packageJson)).toMatchObject({ homepage: DOCUMENTATION_URL });
    const pages = sources.docsJson.match(/releases\/\d+\.\d+\.\d+/gu) ?? [];
    expect(pages).toContain(`releases/${currentVersion}`);
    for (const page of pages) {
      const body = releaseNotesBody(repositoryFile(`docs/${page}.md`));
      expect(body).not.toMatch(/\]\((?!https:\/\/|mailto:|#)/u);
      expect(body).toContain(`](${DOCUMENTATION_URL}/`);
    }
  });

  it("keeps the changelog preparable for the next release", () => {
    // A merged release legitimately leaves Unreleased empty, so add one entry
    // rather than depending on the current Unreleased contents.
    const heading = "\n## [Unreleased]\n";
    expect(sources.changelog.split(heading)).toHaveLength(2);
    const changelog = sources.changelog.replace(
      heading,
      `${heading}\n- Synthetic entry for the next release.\n`,
    );
    const [major, minor] = parseStableVersion(currentVersion);
    const next = `${major}.${minor + 1}.0`;
    const prepared = prepareRelease({ ...sources, changelog }, next, "2026-11-03");
    expect(
      releaseProblems({ ...prepared, releaseNotes: prepared.releaseNotes }, next),
    ).toEqual([]);
    expect(prepared.docsJson.length).toBeGreaterThan(sources.docsJson.length);
  });
});
