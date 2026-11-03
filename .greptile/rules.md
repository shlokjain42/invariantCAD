# InvariantCAD review context

InvariantCAD is a deterministic CAD-as-code library for TypeScript. An
immutable, versioned JSON design document is validated and evaluated by
replaceable geometry kernels: Manifold (approximate triangle mesh, bundled)
and OpenCascade through `occt-wasm` (exact B-Rep). An optional owned OCCT
facade adds draft and complete bounded topology history; it is built
separately and never shipped in the npm package.

The published npm release is 0.1.1. Main stages 0.2. Document v7 product work
(datums, body sets, imported bodies, resources, external components) lives
under `src/internal/document-v7-*` and in `*V7` functions, and is deliberately
not exported. The public document alias and migration target remain v6.

## What matters most in review

- Correctness of frozen behavior: canonical bytes, hashes, and fixtures of
  existing document versions must not change.
- Native ownership: exactly-once release, transactional rollback, and cleanup
  on cancellation and failure paths, including in tests.
- Resource limits and cancellation for untrusted input, checked before
  allocation.
- Structured diagnostics with stable codes and JSON Pointer paths.
- Honest capability reporting; no implied parity between kernels.
- Documentation that separates published, unreleased, and roadmap behavior.

## Lower priority

- Formatting is enforced by `pnpm lint`; do not comment on style the linters
  already check.
- Long, precise documentation prose is intentional. Flag inaccuracy, not
  length.
- Generated files (`etc/api/`, `docs/reference/export-index.mdx`, the
  lockfile, and `src/vendor/`) are reviewed through their sources.

## Workflow

Pull requests merge into protected `main` only after CI on Node 22.13, 24,
and 26, the Chromium browser smoke test, CodeQL, Socket pull-request alerts,
and this Greptile review pass, with every review thread resolved. Releases
are prepared as `release/vX.Y.Z` pull requests; merging one publishes to npm
through trusted publishing after approval.
