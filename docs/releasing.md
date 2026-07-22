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
3. run `pnpm release:check`;
4. run `pnpm coverage` and review material regressions;
5. inspect `pnpm pack --dry-run` for secrets, local artifacts, and omissions;
6. push the release commit and wait for every required GitHub check to pass;
   and
7. create the annotated `v<package-version>` tag from that exact commit.

The release workflow independently installs from the frozen lockfile, checks
that the tag and package version match, reruns the full package and Chromium
acceptance suite, and publishes from a GitHub-hosted runner with provenance.

## One-time npm bootstrap

An npm package must exist before its settings can authorize a trusted
publisher. The first release therefore needs a short-lived npm credential:

1. create an npm account, verify its email address, and enable two-factor
   authentication;
2. create a temporary granular access token that can publish the new public
   package and has npm's non-interactive `bypass 2FA` capability;
3. add it as the `NPM_TOKEN` secret in the GitHub `npm` environment;
4. dispatch `.github/workflows/release.yml` against the release tag;
5. verify the published package, provenance, owner, files, and `latest` tag;
   and
6. immediately delete the GitHub secret and revoke the npm token.

Never commit an npm token or copy it into a workflow file, shell history, issue,
release note, or CI log.

After the first package exists, configure its npm trusted publisher with these
case-sensitive values:

- provider: GitHub Actions;
- organization or user: `shlokjain42`;
- repository: `invariantCAD`;
- workflow filename: `release.yml`;
- environment: `npm`; and
- allowed action: `npm publish`.

Then set npm publishing access to require 2FA and disallow traditional tokens.
Future releases use the workflow's short-lived OIDC identity; no npm secret is
needed. npm automatically emits provenance for a public package published from
this public repository through trusted publishing.

## Publishing and verification

Dispatch the workflow on the tag, never on a branch:

    gh workflow run release.yml --ref v0.1.0

After it succeeds, verify independently:

    npm view invariantcad@0.1.0 version dist-tags repository --json
    npm pack invariantcad@0.1.0 --dry-run

Install the registry artifact into an empty temporary project and exercise its
ESM entry points and CLI. Only then publish the GitHub release using the body of
`docs/releases/<version>.md` as the release notes; omit that Mintlify page's
YAML frontmatter delimiters and fields.

Published npm versions are immutable. If verification uncovers a defect, do
not attempt to replace the version; fix it and publish a new patch version.
