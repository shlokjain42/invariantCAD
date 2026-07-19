# InvariantCAD roadmap

InvariantCAD's goal is one coherent TypeScript CAD system, not one monolithic geometry algorithm. Specialized kernels and solvers sit behind versioned protocols while the TypeScript API, document model, diagnostics, and design semantics remain stable.

## 0.1 — executable foundation

- Versioned, canonical design IR
- Dimensioned expressions and bounded parameters
- Sketch entities, explicit profiles, and reference constraint solver
- Mesh primitives, extrude, revolve, booleans, and transforms
- Parts and fixed-placement nested assemblies
- Document-owned material definitions with explicit density, deterministic part references, and no name-based material lookup
- Basic deterministic bills of materials for nested fixed-placement assemblies, including suppression, quantities, affine occurrence mass, and partial-mass diagnostics
- Named definition-scoped configurations with parameter, instance-suppression, and part-material overrides, plus variant-aware bills of materials
- Kernel-neutral volume, surface, bounds, center-of-mass, and centroidal-inertia measurement for solids and placed assemblies; deterministic principal/axis analysis, radii of gyration, explicit density-aware physical mass, and mesh/STL/OBJ export
- Validation, diagnostics, hashing, CLI, examples, and conformance tests

## 0.2 — exact mechanical modeling

- OpenCascade WASM/native backend
- Curve-preserving resolved profiles with sketch-entity provenance
- Exact primitives, extrude, revolve, booleans, and transforms
- Bounded ruled solid lofts through ordered, compatible, hole-free profiles
- Bounded exact solid sweeps along explicit open 3D polyline, three-point circular-arc, and ordered exact line/arc composite paths with corrected-Frenet transport
- Exact kernel-neutral profile area/centroid moments, authoritative translated-world sweep-volume semantics, independent native-face certification, and geometry-derived capability refinement preflight for bounded composite sweeps
- Exact lines, circles, conics, NURBS curves, and NURBS surfaces
- STEP and OCCT BREP import/export, followed by IGES
- Shape healing and validity diagnostics
- Explicit exact-to-mesh conversion with tolerances
- Evaluation-scoped face/edge topology snapshots and capability negotiation
- Semantic origin/geometry/adjacency selectors with explicit cardinality
- Closed primitive/extrusion roles plus source-aware revolution swept faces, partial-turn caps, full-turn cap omission, axis-boundary collapse, deliberately unnamed revolution edges/artifacts, and sketch-curve source provenance through transforms
- Closed bounded ruled-loft roles for source-free start/end caps, source-aware two-lineage side faces and section rims when source data exists, and source-free lateral edges for non-circular curves; direct unsourced profiles never gain invented sources, circular seams remain unnamed, authored curve phase must align, and incomplete or ambiguous correspondence downgrades to partial history
- OCCT topology descriptor semantics v3, with exact fingerprint gating from descriptor v2 while retaining persistent-reference protocol v1
- Document v3, adding only the five loft-role literals while preserving v1/v2 parsing, bytes, hashes, and direct evaluation; explicit v1/v2 migration upgrades to v3 without recapturing descriptor evidence
- First exact constant-radius fillet driven by semantic edge selection
- First exact equal-distance chamfer driven by semantic edge selection
- First exact constant-thickness inward/outward shell driven by semantic face openings
- First exact whole-solid inward/outward offset with fixed round joins
- Atomic signed multi-face neutral-plane draft through semantic face selectors, enabled by the matched owned OCCT facade with exact indexed face/edge/vertex evolution
- Owned OCCT facade ABI 0.4 multi-input union, subtraction, and intersection with target/tool authored order, isolated working copies and byte-stable arena operands, transactional fail-closed transfer, and complete face/edge/vertex `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED` plus residual source-less `CREATED` evolution
- Identity-only public Boolean lineage: preserved/modified successors inherit proven roles and sources, while generated-only and higher-order source-less `CREATED` topology is created by the current Boolean without source-role inheritance
- Caller-configurable exact Boolean history-record budgeting, passed into the native facade and enforced before native report materialization or indexed JavaScript copying, with a `1_000_000` default
- Owned OCCT facade ABI 0.5 exact constant-radius fillet and equal-distance chamfer with complete face/edge/vertex `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED` plus residual source-less `CREATED` evolution and identity-only public lineage
- Canonical input-index-ordered tangent-contour seeds with duplicate/overlapping seed idempotence, one native build, and an exact selected-edge/progress echo
- A deep topology-independent edge-treatment operand copy with proved original/copy correspondence and byte-stable arena input, plus report-owned same-kernel one-shot transfer and exactly-once rollback
- Optional exact fillet/chamfer evaluator capability with stock and owned ABI 0.2–0.4 partial-history fallback, and an independent `maxExactEdgeTreatmentHistoryRecords` budget enforced before native materialization or indexed JavaScript copying
- Owned OCCT facade ABI 0.6 exact face-selected shell and whole-solid offset with complete face/edge/vertex `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED` plus residual source-less `CREATED` evolution and identity-only public lineage
- Canonical input-index-ordered shell openings, deep topology-independent solid copies with byte-stable arena inputs, and final-membership reconciliation for pinned OCCT generated-only replacements; a selected opening may correctly remain a `MODIFIED` planar rim rather than becoming `DELETED`
- Optional exact shell/offset evaluator capability with stock and owned ABI 0.2–0.5 partial-history fallback, plus the independent `maxExactSolidOffsetHistoryRecords` budget enforced before native materialization or indexed JavaScript copying
- Reproducible, digest-pinned OCCT facade build foundation
- Local package-neutral distribution-bundle generation and strict verification for the owned OCCT facade ABI/bundle 0.6 JS/WASM pair, with checksums, provenance, SBOM, source/relinking information, notices, licenses, and the ordered six-patch series ending in `0006-exact-solid-offset-history.patch`
- External legal, release, and security review followed by publication through an explicit durable channel; the bundle remains separate from the `invariantcad` npm package and is never an implicit runtime download

Facade ABI/bundle numbers version the native adapter boundary and are independent of the product roadmap headings below; facade ABI 0.6 does not mean the product roadmap's 0.6 milestone is complete.

## 0.3 — persistent design intent

- Extend complete shell/offset provenance beyond the owned OCCT ABI 0.6 path while retaining stock OCCT and legacy owned facades as supported partial-history implementations
- Extend complete Boolean and edge-treatment provenance beyond the owned OCCT ABI 0.4/0.5 paths while retaining stock OCCT and legacy owned facades as supported partial-history implementations; Manifold retains its declared geometry operations without topology snapshots
- Expand role and source mapping beyond the landed primitive, extrusion, revolution-face, and bounded ruled-loft families
- Landed: topology-signature protocol v1 for detached face/edge references, with key-free structured geometry and one-hop adjacency evidence, optional semantic compatibility fingerprints, exact fingerprint gating including OCCT descriptor v3, partial-history fallback, and fail-closed missing/ambiguous resolution
- Landed: Document v2 topology-reference registries and typed persistent selector atoms, retained by Document v3 with v1/v2 preservation, explicit migration, canonical normalized variants, exact direct-target and fingerprint binding, bounded shared resolution, and fillet/chamfer/shell/draft consumption
- Freeze node-kind membership and document-body fields in explicit per-version type/schema lists before the next document grammar expansion
- Expand persistent intent into broader topology kinds and feature-family naming without assigning arbitrary identities to symmetric topology
- Expanded selection diagnostics and provenance explanations
- Incremental feature hashes and cross-run cache
- Change-impact and geometric diff APIs

Current topology keys and ABI indices remain evaluation-scoped. Protocol-v1 references persist detached evidence rather than those keys and resolve to a fresh key only for one compatible current candidate. Document v2 and v3 serialize that evidence and selector intent, never the resolved key or native shape. Document v3 is the document grammar that admits loft roles; OCCT descriptor `@3` is the independent semantic compatibility declaration used during resolution, while persistent-reference protocol v1 remains unchanged. This is not a geometric-diff system or cross-run shape cache. Exact ABI 0.4 Boolean, ABI 0.5 fillet/chamfer, and ABI 0.6 shell/offset history prove one evaluation's evolution graph and strengthen semantic-lineage evidence, but do not themselves make a native index persistent.

## 0.4 — advanced mechanical features

- Asymmetric, distance-angle, and variable chamfer modes through semantic selectors
- Variable fillet through semantic selectors
- Closed, variable-thickness, and intersection/miter-join shell modes
- Composite Bézier/B-spline/helix and guided or variable-section sweep modes; smooth/guided/open or holed loft modes; pipe; and two-dimensional wire/profile offset
- Feature-specific validity and healing diagnostics
- Parameter-torture corpus for persistent selections

## 0.5 — mechanical assemblies

- Assembly mate/joint solver protocol
- Planar, cylindrical, concentric, distance, angle, gear, rack, and screw relations
- Degrees of freedom and motion studies
- Interference, clearance, and contact queries
- Effectivity, rule-driven variants, and alternate/substitute components

## 0.6 — documentation and manufacturing

- Drawing views, sections, details, dimensions, tolerances, and title blocks
- PMI and GD&T model
- DXF/SVG/PDF drawing export
- Sheet-metal bends, flat patterns, and bend tables
- CAM stock, setups, operations, tool libraries, and postprocessor protocol
- Additive-manufacturing checks and 3MF export

## 1.0 criteria

- Stable document schema and migration policy
- Stable public TypeScript API
- Exact B-Rep and mesh backends passing the conformance corpus
- Industrial sketch and assembly solver integrations
- Persistent topology robust across the published torture suite
- Browser, Node, worker, and server deployments
- Reproducible packages, SBOM, license notices, and security policy
- Performance budgets and leak-free long-running evaluation
