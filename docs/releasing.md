---
title: "Maintainer release procedure"
description: "Merge gates, release pull requests, approval-gated npm publication with provenance, live documentation, and the trusted-publisher bootstrap."
icon: "package-check"
---

# Maintainer release procedure

This is the release runbook for the public `invariantcad` npm package, its
GitHub release, and the live documentation. Every release flows through
GitHub: a reviewed release pull request, then an automated, approval-gated
publication from the merged commit. Nothing is published from a workstation.

## Everyday changes

Every change reaches `main` through a pull request. Protected `main` requires:

- CI on Node 22.13, 24, and 26 plus the Chromium production-bundle smoke test;
- CodeQL code scanning;
- Socket pull-request alerts for dependency and supply-chain risk;
- a Greptile review, configured by the repository's `.greptile/` rules; and
- every review conversation resolved.

User-visible changes add entries under `## [Unreleased]` in `CHANGELOG.md`.
Ordinary pull requests never change the package version.

Greptile reviews maintainer pull requests automatically, on open and on every
push. It has not reviewed Dependabot pull requests automatically; comment
`@greptileai` on a bot-authored pull request to request the required review.

## Preparing a release

1. In GitHub Actions, run **Prepare release** on `main` with the new stable
   version, such as `0.2.0`. Locally, `pnpm release:prepare 0.2.0` performs
   the same file preparation.
2. The workflow moves the `Unreleased` changelog entries under a dated
   `## [0.2.0]` heading, updates the comparison links, bumps `package.json`,
   adds `docs/releases/0.2.0.md` and its navigation entry, verifies the result
   with `pnpm release:metadata:check 0.2.0`, and pushes `release/v0.2.0`.
3. Open the release pull request from the link in the workflow summary.
   Opening it yourself, rather than with the workflow token, starts every
   required check and review.
4. In that pull request, curate `docs/releases/0.2.0.md` into release notes;
   its body becomes the GitHub release. Update release status text such as
   the README status line, roadmap, support matrix, and supported versions in
   `SECURITY.md`. Review the `etc/api/` diff since the previous release.
5. Merge when every required check passes and every thread is resolved.

## Automated publication

Every push to `main` runs `.github/workflows/release.yml`. A commit is a
release commit only when its `package.json` version differs from its first
parent's, which happens only when a release pull request merges. For a
release commit the workflow:

1. checks release metadata and runs `pnpm release:check`: strict TypeScript,
   source correctness and format hygiene, public-entrypoint and API-report
   consistency, package metadata/types, clean-consumer installation of the
   packed tarball, checked coverage, the six-case reference benchmark,
   dependency audit, Mintlify validation and links, and the production browser
   bundle;
2. waits for approval in the `npm` environment, then publishes that exact
   smoke-tested tarball through npm trusted publishing with provenance. It
   refuses a version older than one already on npm, so npm's `latest`
   dist-tag never moves backwards;
3. confirms through npm's SLSA provenance that the registry package was built
   from this repository, workflow, and commit, and, when this attempt
   published it, that the registry serves the same tarball integrity;
4. creates the annotated `v<version>` tag on the release commit and the
   GitHub release from the body of `docs/releases/<version>.md`, without its
   YAML frontmatter, marking it latest only when it is the highest stable tag;
   and
5. fast-forwards the `docs-live` branch, from which the hosted Mintlify site
   deploys, to the release commit, never moving it backwards.

Acceptance and publication use Node.js 24 because the pinned Mint CLI accepts
Node 20.17 through 24 and rejects Node 25 and newer. Independent CI continues to
gate InvariantCAD on Node 26, so this tooling ceiling is not a package runtime
ceiling.

Every step is idempotent. If a job fails, fix the cause and re-run the original
workflow run. **Re-run failed jobs** resumes from the same commit; **Re-run all
jobs** repeats acceptance and then finishes whatever is missing among the npm
version, tag, GitHub release, and `docs-live`. Both skip work already done and
refuse a tag that points elsewhere.
Published npm versions are immutable. If verification uncovers a defect, do not
attempt to replace the version; fix it and release a new patch version.

## Live documentation

The hosted documentation deploys from `docs-live`, which only the release
workflow advances, so readers see documentation for the latest npm release.
Documentation on `main` is still validated by CI on every pull request. A
documentation-only correction for the current release ships with the next
release; for an urgent fix, release a patch version.

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

InvariantCAD 0.1.1 is the first post-bootstrap, end-to-end confirmation of this
tokenless path. If npm returns `ENEEDAUTH`, verify every trusted-publisher field
exactly; do not restore a long-lived publish secret. The workflow filename
`release.yml` and environment name `npm` are part of that binding.
