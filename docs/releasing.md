---
title: "Maintainer release procedure"
description: "Internal checklist for release validation, bootstrap publication, provenance, and post-release verification."
icon: "package-check"
---

# Maintainer release procedure

This is the release runbook for the public `invariantcad` npm package and its
matching GitHub release. It intentionally keeps publishing separate from the
ordinary CI workflow.

## Release acceptance

Before creating a tag:

1. move shipped changes from `Unreleased` into a dated changelog section;
2. set the same version in `package.json` and the release notes;
3. review the committed `etc/api/` diff against the previous release;
4. run `pnpm release:check`;
5. review the checked coverage report and all six kernel/model reference
   benchmark results emitted by that command;
6. inspect `pnpm pack --dry-run` for secrets, local artifacts, and omissions;
7. push the release commit and wait for every required GitHub check to pass;
   and
8. create the annotated `v<package-version>` tag from that exact commit.

The release workflow serializes publication attempts and independently installs
from the frozen lockfile after a full-history checkout. Before acceptance or
publication, it proves that the dispatch ref is the exact annotated
`v<package-version>` tag, that the tag points at the checked-out commit, and
that the commit is contained in `origin/main`. It then reruns the full
acceptance suite and publishes from a GitHub-hosted runner with provenance.
The suite includes strict TypeScript, source correctness and format hygiene,
public-entrypoint and API-report consistency, package metadata/types,
clean-consumer installation, checked coverage, the complete six-case reference
benchmark, dependency audit, Mintlify validation and links, and the production
browser bundle.

## One-time npm bootstrap

The one-time bootstrap completed with `invariantcad@0.1.0` on 2026-07-22.
The public registry artifact, provenance, owner, files, CLI, entry points,
geometry kernels, and `latest` tag were independently verified. The release
workflow does not read or require a registry token.

Never commit an npm token or copy it into a workflow file, shell history, issue,
release note, or CI log. The npm-side bootstrap token must also be revoked.

The package's npm trusted publisher is configured with these case-sensitive
values:

- provider: GitHub Actions;
- organization or user: `shlokjain42`;
- repository: `invariantCAD`;
- workflow filename: `release.yml`;
- environment: `npm`; and
- allowed action: `npm publish`.

Publishing access requires 2FA and disallows traditional tokens.
Future releases use the workflow's short-lived OIDC identity; no npm secret is
needed. npm automatically emits provenance for a public package published from
this public repository through trusted publishing.

The first post-0.1.0 release is the end-to-end confirmation of this tokenless
path. If npm returns `ENEEDAUTH`, verify every trusted-publisher field exactly;
do not restore a long-lived publish secret.

## Publishing and verification

Dispatch the workflow on the tag, never on a branch:

    VERSION="$(node -p 'require("./package.json").version')"
    gh workflow run release.yml --ref "v${VERSION}"

After it succeeds, verify independently:

    npm view "invariantcad@${VERSION}" version dist-tags repository --json
    npm pack "invariantcad@${VERSION}" --dry-run

Install the registry artifact into an empty temporary project and exercise its
ESM entry points and CLI. Only then publish the GitHub release using the body of
`docs/releases/<version>.md` as the release notes; omit that Mintlify page's
YAML frontmatter delimiters and fields.

Published npm versions are immutable. If verification uncovers a defect, do
not attempt to replace the version; fix it and publish a new patch version.
