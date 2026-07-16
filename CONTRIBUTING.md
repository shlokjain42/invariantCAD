# Contributing to InvariantCAD

InvariantCAD is early, and architectural compatibility matters more than adding isolated operations quickly.

## Before changing the public model

- Keep `DesignDocument` JSON-serializable and kernel-neutral.
- Add stable IDs and diagnostics for new referenced concepts.
- Do not expose face/edge array indices as persistent references.
- Do not make lossy representation conversions implicit.
- Update schemas, semantic validation, canonical round-trip tests, and documentation together.
- Treat document schema versions independently from npm versions.

## Development checks

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm verify
```

Geometry tests should assert topology class, toleranced bounds, volume, and area. Do not assert triangle ordering or exact floating-point export bytes unless testing an exporter format itself.

Every WASM-backed test must dispose evaluated results and evaluators.

## Native OCCT facade

The current exact backend consumes the pinned `occt-wasm` package. InvariantCAD-owned native extensions are built through the locked, rootless process documented in `native/occt/README.md`; do not hand-edit or commit generated WASM artifacts. Keep build outputs under `.artifacts/`, verify their hashes, and preserve the OCCT LGPL exception, corresponding-source path, and user-replaceable `createOcctKernel({ wasm })` boundary.
