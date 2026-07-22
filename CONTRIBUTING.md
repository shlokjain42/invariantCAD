# Contributing to InvariantCAD

Thank you for helping improve InvariantCAD. The project welcomes focused bug
reports, documentation fixes, tests, protocol review, and implementation work.

InvariantCAD is still in the 0.x stage. Architectural compatibility matters
more than adding isolated operations quickly, especially where a change affects
serialized documents, topology identity, native ownership, or kernel behavior.

By participating, follow the [Code of Conduct](CODE_OF_CONDUCT.md). For help
choosing the right channel, read [SUPPORT.md](SUPPORT.md). Security
vulnerabilities must follow [SECURITY.md](SECURITY.md), not the public issue
tracker.

## Before starting

Search the issue tracker and current pull requests before opening something
new. A bug report should include a small reproducer. A feature request should
describe the modeling problem and required semantics, not only a proposed
method name.

Open an issue before substantial work involving any of the following:

- a public TypeScript API or package entry point;
- the `DesignDocument` grammar, migration, or canonical bytes;
- topology roles, selectors, persistent evidence, or protocol fingerprints;
- kernel capability or conformance contracts;
- native/WASM distribution, licensing, or provenance; or
- a new dependency or bundled runtime.

Early discussion does not guarantee acceptance, but it avoids building against
an incompatible boundary. Small fixes and documentation corrections can go
directly to a pull request.

## Development setup

Requirements:

- Node.js 20.19 or newer;
- Corepack; and
- Git.

```bash
git clone https://github.com/shlokjain42/invariantCAD.git
cd invariantCAD
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
```

Create a focused branch in your fork. Keep unrelated refactors separate from
the behavior being changed. Do not commit generated build output, coverage,
local artifacts, credentials, or npm tokens.

## Architectural invariants

Before changing the public model:

- Keep `DesignDocument` JSON-serializable and kernel-neutral.
- Add stable IDs and structured diagnostics for new referenced concepts.
- Do not expose face, edge, or vertex array indices as persistent references.
- Do not make lossy representation conversions implicit.
- Keep native and WebAssembly ownership explicit and deterministic.
- Update schemas, semantic validation, canonical round-trip tests, and
  documentation together.
- Treat document, kernel, topology, artifact, facade, and npm versions as
  independent version axes.
- Never silently widen or reinterpret a frozen document version.

If a change cannot preserve one of these invariants, document the tradeoff in
the issue before implementation.

## Testing

Run the smallest relevant loop while developing, then the checks proportional
to the change before opening a pull request.

| Change | Expected checks |
| --- | --- |
| Documentation only | `pnpm docs:check` |
| Type or implementation | `pnpm check`, `pnpm lint`, and `pnpm test` |
| Package exports or CLI | `pnpm lint:package` and `pnpm test:package` |
| Browser or WASM loading | `pnpm test:browser` |
| Dependency or release boundary | `pnpm audit:release` and `pnpm release:check` |
| Mintlify navigation or components | `pnpm docs:validate` and `pnpm docs:links` |

`pnpm release:check` is intentionally heavyweight. A contributor does not need
to run every heavyweight native facade gate unless the change affects that
boundary, but the ordinary CI suite must remain green.

Geometry tests should assert the relevant topology class, toleranced bounds,
volume, area, diagnostics, and ownership behavior. Do not assert triangle
ordering or exact floating-point export bytes unless testing an exporter format
itself.

Every WASM-backed test must dispose evaluated results and evaluators, including
failure paths. Tests involving native transfer must cover rollback and
exactly-once release.

## Protocol and schema changes

Protocol changes require more than a type edit. Include:

- the invariant and failure semantics;
- explicit input and work limits;
- cancellation and cleanup behavior;
- frozen compatibility tests;
- serialization and canonicalization impact;
- a migration decision; and
- corresponding guide, reference, support-matrix, and changelog updates.

New public exports must remain visible in the generated export index. Run
`pnpm docs:generate` when the public surface changes and commit the resulting
documentation update.

## Native OCCT facade

The current exact backend consumes the pinned `occt-wasm` package.
InvariantCAD-owned native extensions are built through the locked, rootless
process documented in `native/occt/README.md`; do not hand-edit or commit
generated WASM artifacts. Keep build outputs under `.artifacts/`, verify their
hashes, and preserve the OCCT LGPL exception, corresponding-source path, and
user-replaceable `createOcctKernel({ wasm })` boundary.

Changes to the owned facade need the relevant native, adapter, packed-consumer,
failure-cleanup, and bundle-verification checks. The facade is a separate
release boundary and is not implicitly shipped by the npm package.

## Documentation

The Mintlify source lives under `docs/`. Every navigated page requires `title`
and `description` frontmatter. Keep examples complete enough to copy, clearly
separate tested behavior from roadmap work, and use the support matrix as the
canonical feature boundary.

User-visible changes should update `CHANGELOG.md`. New releases receive a page
under `docs/releases/`; ordinary pull requests must not create tags or publish
packages.

## Pull requests

A useful pull request:

- explains the problem and chosen behavior;
- links the issue or design discussion when one exists;
- stays focused and avoids unrelated formatting churn;
- includes tests for success, failure, limits, and cleanup where relevant;
- updates user and maintainer documentation;
- lists the commands actually run; and
- calls out compatibility, security, performance, and licensing impact.

Use a short imperative commit subject. Conventional-style prefixes such as
`feat:`, `fix:`, `docs:`, `test:`, and `chore:` are encouraged but not
required. Maintainers may squash or reword commits when merging.

Review and merge timing is best-effort. The maintainer may request a smaller
scope, additional evidence, or an explicit protocol decision before accepting
a change.

## Licensing

Unless explicitly agreed otherwise in writing, contributions submitted to this
repository are provided under the repository's [Apache-2.0 license](LICENSE).
Only submit work that you have the right to contribute, and preserve required
third-party notices and attribution.
