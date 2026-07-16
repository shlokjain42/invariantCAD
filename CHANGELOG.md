# Changelog

## Unreleased

- Preserve analytic sketch lines, arcs, circles, and their source entity IDs in resolved profiles
- Add an exact OpenCascade B-Rep backend with STEP and text/binary BREP exchange
- Add evaluated-output and CLI STEP/BREP export without exposing native handles
- Version and normalize the geometry-kernel protocol, native exchange, validity, and meshing options
- Enforce declared kernel capabilities before backend invocation
- Add reusable geometry-kernel conformance tests
- Verify coverage, package metadata, declarations, tarball imports, real geometry, and the installed CLI

## 0.1.0

- Initial versioned design IR and TypeScript authoring API
- Dimensioned parameters and expressions
- Sketch entities, constraints, profiles, and reference solver
- Manifold WASM geometry backend
- Primitives, extrude, revolve, booleans, and transforms
- Parts and nested fixed-placement assemblies
- Measurement, STL/OBJ export, canonical JSON, semantic hashes, CLI, and tests
