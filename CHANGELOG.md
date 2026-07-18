# Changelog

## Unreleased

- Added document-owned material definitions with explicit parameterized density, typed part references, deterministic density precedence without name guessing, and backward-compatible descriptive part material labels.
- Added deterministic part-node-grouped bills of materials for parts and nested assemblies, with suppression-aware quantities, affine occurrence mass rollups, partial-mass warning diagnostics, CLI output, and packed-consumer coverage.
- Added explicit parameterized part density in `kg/mm^3`, density-aware physical mass and `kg*mm^2` inertia for parts and heterogeneous nested assemblies, deterministic principal moments/axes with degeneracy metadata, arbitrary point/axis inertia, radii of gyration, structured missing/invalid-density diagnostics, CLI analysis, and packed-consumer coverage.
- Added required world-space center-of-mass and centroidal inertia-tensor measurements across both built-in kernels and assemblies, with native recentered OCCT B-Rep integration, centered Manifold polyhedron integration, affine occurrence aggregation, parallel-axis semantics, zero-volume conventions, and CLI inspection output.
- Added a kernel-neutral ordered ruled-solid loft node and TypeScript builder API.
- Added strict profile compatibility, station ordering, exact OCCT result-topology validation, capability negotiation, and conformance coverage for the bounded loft contract.
- Added first-class parameterized open 3D polyline paths and a bounded exact solid-sweep contract with corrected-Frenet transport, right-corner transitions, conservative self-overlap rejection, transactional OCCT ownership, and package-level coverage.
- Added exact three-point 3D circular-arc paths and additive circular-arc sweep capability negotiation with analytic curvature clearance, specialized OCCT revolution transfer, and stable analytic volume measurement.
- Added structurally connected ordered line/arc composite paths, certified exact path clearance, additive composite-sweep capability negotiation, and one-wire transactional OCCT PipeShell transfer.
- Extended the kernel-neutral composite contract to certified major and near-full arcs with adjacent remote-domain clearance. The stock OCCT adapter admits the bounded centered-profile, single-arc composite case with native tangent and analytic-volume postconditions; multi-arc and eccentric-profile major transfers fail closed. The superseded `major-arc-unsupported` and `adjacent-arc-reach` reason literals remain type-compatible but are no longer emitted.
- Added owned OCCT facade ABI 0.3 with an explicit corrected-Frenet/right-corner PipeShell transaction, caller-supplied linear/boundary/angular tolerances, measured surface-error enforcement, one-shot same-kernel result transfer, and complete cleanup diagnostics. The matched runtime now certifies major multi-arc and eccentric-profile composites, including the previously distorted angularly conditioned near-full fixture, while stock OCCT retains its bounded restrictions.
- Added a kernel-neutral transported-profile volume oracle with exact line, circular-arc, and RightCorner centroid terms, compensated summation, cancellation diagnostics, and versioned `major-multiple-arcs` / `major-eccentric-profile` kernel capability refinements.
- Added exact kernel-neutral line/arc/circle profile area and centroid moments with certified floating-point bounds, plus one shared composite-sweep refinement classifier. Document evaluation now preflights only the refinements required by the selected geometry, reports missing or malformed capability metadata before backend invocation, and keeps direct OCCT calls synchronized to the requested tolerance.
- Made those analytic local moments authoritative for circular and composite sweep volumes. OCCT face area and centroid integration now act as an independent, geometry-conditioned certificate with structured disagreement diagnostics; circular transfer additionally checks the native face moments against the rounded revolution axis before construction. Relative centroid/circle-center offsets and per-axis ULP bounds preserve exact-volume semantics at large representable world translations. `ResolvedCircularArcGeometry` now includes the required `centerOffsetFromStart` field for consumers that snapshot or mock resolved geometry.
- Fixed nonuniform OCCT transforms of already-meshed exact shapes by stripping stale triangulation before applying the affine map.

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
