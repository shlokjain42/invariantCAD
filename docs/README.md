# InvariantCAD documentation

InvariantCAD keeps its durable contracts close to the implementation. This
index separates the user guide, architectural specifications, conformance
contracts, and native release material.

## Start here

- [Project guide and quick start](../README.md)
- [What works today](../README.md#what-works-today)
- [Capability support matrix](../README.md#support-matrix)
- [Browser initialization](../README.md#browser-initialization)
- [CLI guide](../README.md#cli)
- [0.1.0 release notes](releases/0.1.0.md)

## Modeling and product behavior

The main project guide covers:

- dimensioned expressions, parameters, and configurations;
- sketches, profiles, constraints, and the replaceable solver;
- Manifold mesh evaluation and exact OpenCascade B-Rep evaluation;
- lofts, line/arc sweeps, Booleans, fillets, chamfers, shells, offsets, and
  draft;
- semantic and persistent face, edge, and vertex selection;
- measurements, physical mass properties, parts, assemblies, materials, and
  bills of materials;
- STEP, BREP, STL, and OBJ exchange;
- diagnostics, serialization, feature hashes, artifact contracts, and cache
  limits; and
- Node.js, browser, and explicit WebAssembly initialization.

## Architecture and compatibility

- [Architecture and non-negotiable invariants](architecture.md)
- [Versioned product roadmap](roadmap.md)
- [Persistent-topology torture contract](persistent-topology-torture.md)
- [Shape-artifact conformance contract](shape-artifact-conformance.md)

InvariantCAD has several intentionally independent version axes:

1. the npm package version;
2. the serialized design-document version;
3. the persistent-topology signature protocol;
4. the kernel topology-descriptor fingerprint; and
5. the separately built owned-facade ABI and bundle version.

Changing one axis never silently upgrades evidence stored under another. The
architecture guide documents the exact migration and capability-negotiation
rules.

## Public API reference

The package ships TypeScript declarations and declaration maps for every public
entry point:

- invariantcad — authoring, documents, evaluation, analysis, topology, cache,
  serialization, and the Manifold backend;
- invariantcad/conformance — framework-neutral shape-codec conformance audits;
  and
- invariantcad/kernels/occt — the exact OpenCascade backend and its explicit
  native-boundary options.

Source JSDoc on exported declarations is the authoritative per-symbol API
reference for 0.1.x. The package declaration files preserve that documentation
for editor IntelliSense. A generated searchable API site is planned, while the
guides above remain the normative behavioral specification.

## Native OpenCascade extension

- [Owned-facade build, test, ABI, and packaging guide](https://github.com/shlokjain42/invariantCAD/blob/v0.1.0/native/occt/README.md)
- [Corresponding source and relinking guide](https://github.com/shlokjain42/invariantCAD/blob/v0.1.0/native/occt/bundle/SOURCE_AND_RELINK.md)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)

The owned facade is not part of the invariantcad npm package and is not
downloaded implicitly. Its local bundle remains unpublished pending external
legal, security, and release review.

## Project policy

- [Security policy](../SECURITY.md)
- [Maintainer release procedure](releasing.md)
- [Contributing](https://github.com/shlokjain42/invariantCAD/blob/main/CONTRIBUTING.md)
- [Detailed changelog](../CHANGELOG.md)
- [Apache-2.0 license](../LICENSE)
