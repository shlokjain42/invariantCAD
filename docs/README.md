# InvariantCAD documentation source

This directory is the source root for the public Mintlify documentation site.
It is also included in the npm package for offline reading.

Public site: <https://invariant-cad.mintlify.app>

## Start here

- [Documentation home](index.mdx)
- [Installation](get-started/installation.mdx)
- [Quickstart](get-started/quickstart.mdx)
- [Core concepts](get-started/core-concepts.mdx)
- [0.1 support matrix](reference/support-matrix.mdx)
- [Complete single-page 0.1 guide](reference/complete-guide.md)
- [Release process](releasing.md)

## Site structure

- `get-started/` introduces installation and the architecture mental model.
- `modeling/` covers authoring, topology, assemblies, and configurations.
- `evaluation/` covers ownership, kernels, browsers, diagnostics, and limits.
- `analysis/` and `interchange/` cover measurements, incremental analysis,
  documents, and file formats.
- `reference/` maps package exports, classes, CLI behavior, schemas, and the
  complete legacy guide.
- Root specifications preserve the normative architecture, topology torture,
  artifact-conformance, and roadmap contracts.
- `project/` contains public security and contribution guidance.

`docs.json` defines the hosted navigation, branding, and metadata. Mintlify
should be connected to this repository as a monorepo with `/docs` as the
documentation path.

## Local checks

Repository checks validate navigation coverage, required frontmatter, internal
links, generated export inventory, and Mintlify configuration. To preview with
the official CLI:

```bash
cd docs
mint dev
```

Run `mint validate` and `mint broken-links --check-anchors` before publishing a
large navigation change.

## Canonical project files

Repository-root [security](../SECURITY.md), [contribution](../CONTRIBUTING.md),
[changelog](../CHANGELOG.md), [license](../LICENSE), and
[third-party notice](../THIRD_PARTY_NOTICES.md) files remain canonical for npm
and GitHub. Their Mintlify pages summarize and link to those sources rather than
creating conflicting policy text.
