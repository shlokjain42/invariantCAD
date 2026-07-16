# Changelog

## Unreleased

- Preserve analytic sketch lines, arcs, circles, and their source entity IDs in resolved profiles
- Add an exact OpenCascade B-Rep backend with STEP and text/binary BREP exchange
- Add evaluated-output and CLI STEP/BREP export without exposing native handles
- Add serialized, order-independent semantic face/edge selectors with explicit cardinality
- Add validated OCCT topology snapshots with analytic descriptors, adjacency, provenance, and explicit lifetime management
- Add exact selector-driven fillets and structured missing, ambiguous, and incomplete-history diagnostics
- Add exact equal-distance selector-driven chamfers with tangent-contour seed semantics, negotiated kernel capability, and partial-history diagnostics
- Add exact constant-thickness inward/outward shells with fixed round joins, non-propagating semantic face openings, materialized direction and tolerance, strict solid/opening checks, negotiated kernel capability, and partial-history diagnostics
- Add exact whole-solid inward/outward offsets with fixed round joins, materialized direction and tolerance, strict one-body validation, collapse checks, negotiated kernel capability, and partial-history diagnostics
- Deterministically release every native evolution wrapper and temporary vector used by exact fillet/chamfer history calls while preserving chained-operation behavior
- Pin the OCCT facade source, kernel source, toolchain, and rootless offline build path for reproducible InvariantCAD-owned native extensions
- Add an owned-OCCT atomic multi-face draft ABI and native smoke corpus with arbitrary neutral planes, pre-build seed validation, the pinned kernel's minimum-angle guard, and explicit result ownership
- Add a versioned, report-owned indexed topology-evolution ABI for atomic draft, with exact face/edge/vertex bijection checks, stable numeric enums, explicit history-stage diagnostics, and immutable history across report clones and result transfer
- Add an internal fail-closed TypeScript reducer for exact indexed topology evolution, including complete-bijection validation, preserved/modified lineage reduction, partial-history propagation, safe integer bounds, sparse-array rejection, and detached immutable lineage
- Add the explicit document, builder, kernel, capability-negotiation, and evaluator contract for signed atomic draft with semantic face selection, independent pull direction and neutral plane, strict numeric bounds, and feature-scoped exact indexed evolution; kernels without that exact capability fail before selection or execution
- Add an internal OCCT draft transaction boundary that probes the exact matched facade, copies and validates all report/history data before transfer, preserves native failure diagnostics, and guarantees report/vector cleanup plus exactly-once rollback when post-transfer adoption fails
- Wire signed semantic-face draft through the public OCCT kernel when `createOcctKernel` receives a module factory that loads the matched owned facade, with an optional explicit WASM override, numeric face remapping, raw topology-count cross-checks, transactional adoption, and exact indexed lineage caching; stock/default OCCT remains draft-unsupported and global topology provenance remains `feature`
- Add deterministic local packaging and strict offline verification for a package-neutral owned-OCCT facade bundle containing the matched runtime, checksums, release metadata, CycloneDX SBOM, provenance, locked build inputs, patches, source/relinking instructions, notices, and licenses; the bundle remains unpublished and outside the `invariantcad` npm package pending external review
- Add an opt-in clean-consumer package acceptance gate that installs the npm tarball without native artifacts, explicitly supplies the verified owned-facade bundle runtime, and exercises direct plus document-evaluated draft
- Make exact boolean unions produce shellable fused solids and normalize reversed one-solid imports before topology-sensitive features
- Reject shapes passed across OCCT kernel instances before their raw arena IDs can alias unrelated geometry
- Add a closed, typed primitive/extrusion topology-role registry and sketch-curve source selectors
- Preserve proven per-subshape role/source lineage through transforms and downgrade ambiguous history
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
