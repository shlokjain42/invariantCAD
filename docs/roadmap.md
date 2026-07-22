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
- Evaluation-scoped exact B-Rep face/edge/vertex topology snapshots and capability negotiation
- Semantic origin/geometry/adjacency selectors with explicit cardinality
- Closed primitive/extrusion roles plus source-aware revolution swept faces, partial-turn caps, full-turn cap omission, axis-boundary collapse, deliberately unnamed revolution edges/artifacts, and sketch-curve source provenance through transforms
- Closed bounded ruled-loft roles for source-free start/end caps, source-aware two-lineage side faces and section rims when source data exists, and source-free lateral edges for non-circular curves; direct unsourced profiles never gain invented sources, circular seams remain unnamed, authored curve phase must align, and incomplete or ambiguous correspondence downgrades to partial history
- Closed bounded-sweep roles with path-directed source-free caps, `C*S` source-aware sides, `C` source-aware rims at each end, and `V*S` source-free laterals for `C` direct-profile curves, `S` authored path segments, and `V` authored non-circular curve starts; direct unsourced calls invent no sources, path-joint fragments and circular seams remain unnamed, and ambiguous, incomplete, or nonlocal graph correspondence downgrades to partial history
- OCCT topology descriptor semantics `@4`, adding bounded-sweep anchors with exact fingerprint gating from descriptor `@3` while retaining persistent-reference protocol v1
- Document v4, adding only the six sweep-role literals while preserving frozen v1/v2/v3 parsing, bytes, hashes, and direct evaluation; explicit v1/v2/v3 migration upgrades to v4, is idempotent for v4, and never rewrites stored descriptor evidence
- Conditional OCCT topology descriptor semantics `@5` for recognized owned facade ABI 0.5+, adding only exact generated edge→face fillet/chamfer class anchors; stock and earlier owned runtimes remain descriptor `@4`, persistent-reference protocol remains v1, and current facade ABI 0.7 retains ABI 0.6's modeling/history surface while adding bounded artifact transport only for the repository-private candidate
- Document v5, adding only `fillet.face.blend` and `chamfer.face.bevel` while preserving frozen v1–v4 grammars; explicit v1–v4 migration upgrades to v5, is idempotent for v5, and retains stored descriptor fingerprints and evidence verbatim
- Topology-signature protocol v2 for detached face/edge/vertex references, adding vertex point evidence and reciprocal edge↔vertex one-hop evidence while retaining byte- and behavior-frozen protocol-v1 face/edge capture and resolution
- OCCT topology descriptor `@6` as the primary protocol-v2 declaration for known stock and recognized owned runtimes, with one exact protocol-v1 compatibility profile retaining the former descriptor `@4` fingerprint on stock/owned ABI 0.2–0.4 or descriptor `@5` fingerprint on owned ABI 0.5+
- Document v6 as the current authoring grammar, adding persistent vertices, vertex `position` queries, and edge↔vertex adjacency without semantic vertex roles; v1–v5 stay frozen and migration to v6 preserves every stored protocol, fingerprint, and evidence record verbatim
- First exact constant-radius fillet driven by semantic edge selection
- First exact equal-distance chamfer driven by semantic edge selection
- First exact constant-thickness inward/outward shell driven by semantic face openings
- First exact whole-solid inward/outward offset with fixed round joins
- Atomic signed multi-face neutral-plane draft through semantic face selectors, enabled by the matched owned OCCT facade with exact indexed face/edge/vertex evolution
- Owned OCCT facade ABI 0.4 multi-input union, subtraction, and intersection with target/tool authored order, isolated working copies and byte-stable arena operands, transactional fail-closed transfer, and complete face/edge/vertex `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED` plus residual source-less `CREATED` evolution
- Identity-only public Boolean lineage: preserved/modified successors inherit proven roles and sources, while generated-only and higher-order source-less `CREATED` topology is created by the current Boolean without source-role inheritance
- Caller-configurable exact Boolean history-record budgeting, passed into the native facade and enforced before native report materialization or indexed JavaScript copying, with a `1_000_000` default
- Owned OCCT facade ABI 0.5 exact constant-radius fillet and equal-distance chamfer with complete face/edge/vertex `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED` plus residual source-less `CREATED` evolution; identity lineage is inherited only through preserved/modified records, while identity-less faces proved by exact generated edge→face records receive the strict blend/bevel class role and residual-created/generated edges stay unnamed
- Canonical input-index-ordered tangent-contour seeds with duplicate/overlapping seed idempotence, one native build, and an exact selected-edge/progress echo
- A deep topology-independent edge-treatment operand copy with proved original/copy correspondence and byte-stable arena input, plus report-owned same-kernel one-shot transfer and exactly-once rollback
- Optional exact fillet/chamfer evaluator capability with stock and owned ABI 0.2–0.4 partial-history fallback, and an independent `maxExactEdgeTreatmentHistoryRecords` budget enforced before native materialization or indexed JavaScript copying
- Owned OCCT facade ABI 0.6 exact face-selected shell and whole-solid offset with complete face/edge/vertex `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED` plus residual source-less `CREATED` evolution and identity-only public lineage
- Canonical input-index-ordered shell openings, deep topology-independent solid copies with byte-stable arena inputs, and final-membership reconciliation for pinned OCCT generated-only replacements; a selected opening may correctly remain a `MODIFIED` planar rim rather than becoming `DELETED`
- Optional exact shell/offset evaluator capability with stock and owned ABI 0.2–0.5 partial-history fallback, plus the independent `maxExactSolidOffsetHistoryRecords` budget enforced before native materialization or indexed JavaScript copying
- Reproducible, digest-pinned OCCT facade build foundation
- Local package-neutral distribution-bundle generation and strict verification for the owned OCCT facade ABI/bundle 0.7 JS/WASM pair, with checksums, provenance, SBOM, source/relinking information, notices, licenses, and the ordered seven-patch series ending in `0007-bounded-shape-artifacts.patch`; ABI 0.7 retains ABI 0.6's modeling/history surface and exposes its bounded artifact transport only to the repository-private candidate
- External legal, release, and security review followed by publication through an explicit durable channel; the bundle remains separate from the `invariantcad` npm package and is never an implicit runtime download

Facade ABI/bundle numbers version the native adapter boundary and are independent of the product roadmap headings below. Current facade ABI 0.7 is an additive native-boundary release, not a product-roadmap milestone: it retains ABI 0.6's modeling/history surface and adds bounded artifact transport only for the repository-private candidate.

## 0.3 — persistent design intent

- Extend complete shell/offset provenance beyond the owned OCCT ABI 0.6 path while retaining stock OCCT and legacy owned facades as supported partial-history implementations
- Extend complete Boolean and edge-treatment provenance beyond the owned OCCT ABI 0.4/0.5 paths while retaining stock OCCT and legacy owned facades as supported partial-history implementations; Manifold retains its declared geometry operations without topology snapshots
- Expand role and source mapping beyond the landed primitive, extrusion, revolution-face, bounded ruled-loft, and bounded-sweep families and beyond the current sweep modes; do not assign path-segment or arbitrary seam identity
- Landed: topology-signature protocol v2 for detached face/edge/vertex references, with key-free structured geometry, vertex points, and face↔edge/edge↔vertex one-hop evidence; protocol-v1 face/edge wire bytes, evidence, and matching remain frozen and supported through exact compatibility profiles
- Landed: Document v2 topology-reference registries and typed persistent selector atoms, extended through current Document v6 with v1–v5 preservation, explicit migration to v6, canonical normalized variants, exact direct-target and protocol/fingerprint binding, bounded shared resolution, and fillet/chamfer/shell/draft consumption
- Landed: an initial published persistent-topology parameter-torture corpus covering transformed complete lineage, partial Boolean fallback, topology disappearance and recovery, deliberate sweep ambiguity, multi-fingerprint registries, cancellation, and native ownership cleanup
- Landed: an owned facade ABI 0.6 exact-evolution persistence matrix covering inherited Boolean, fillet/chamfer, shell, and draft semantic survival; exact generated fillet/chamfer face-role survival across amount changes and downstream role/persistent consumers; multi-face class ambiguity; unnamed generated shell/offset and treatment-edge baselines; serialization; and native arena cleanup
- Landed: topology-reference explanation v1, with deeply frozen resolved/missing/ambiguous aggregate reports, per-strategy considered/matched counts from the original bounded matching pass, key-free non-resolved outcomes, shared-session caching, and evaluator diagnostic propagation
- Landed: frozen node-kind membership and top-level document-body fields through explicit v1/v2/v3/v4/v5/v6 TypeScript and Zod lists, compile-time tuple/union tripwires, strict runtime inventory tests, and allow-listed migration copying
- Expand persistent intent into broader feature-family naming, including any deliberately justified vertex roles, without assigning arbitrary identities to symmetric or coincident topology
- Landed: ordinary topology-selection explanation v1, with deeply frozen resolved/missing/ambiguous aggregate reports, exact universe/match/cardinality counts, keys only on resolved outcomes, and the same report attached to legacy missing/ambiguous diagnostics; direct resolve and explain calls remain separate passes
- Landed: authored change-impact report v1, with bounded detached-document/string-seed validation; context-qualified base/configuration closure over expressions, bounds, effective materials, active assembly instances, persistent selectors, and the feature DAG; and frozen reason-bearing impacted parameters, materials, configurations, nodes, and outputs
- Landed: feature-hash protocol v1, with bounded cancellable kernel-independent SHA-256 Merkle identity for every node under one effective configuration/call-time parameter context, active assembly and material semantics, canonical consumed persistent evidence, and isolated-branch stability; these hashes identify admitted intent rather than geometry
- Landed: artifact-cache protocol v1 foundation, with evaluator/kernel/artifact/solver-bound solid keys, fail-closed opt-in solver fingerprints (the built-in reference solver intentionally remains ineligible pending cross-runtime numeric conformance), optional all-or-nothing kernel codec capabilities, explicit encode/decode ownership, integrity-checked detached records, bounded cancellable stores, concurrency-safe aggregate sessions, and a copying reference memory store
- Landed: the public framework-neutral `invariantcad/conformance` shape-codec audit boundary, with separate candidate and already-advertised modes, exact runtime identity matching, tagged semantic witnesses, golden-first decoding, dedicated fresh producer and consumer instances for reviewed pre-witness source encode/decode checks in both disposal orders, fresh-instance ownership/mutation isolation, empty/truncated-input, returned-byte-limit, and pre-abort checks, and finite evidence that deliberately confers neither certification nor cache eligibility
- Landed: repository semantic-observation protocol v1, producing a bounded canonical evaluator-semantic quotient with exact normalized IEEE-754 numbers, sorted oriented Float32 triangle multisets, exact key-neutral topology-graph labeling under separate search-state and work budgets, complete advertised-feature probe-or-exclusion accounting, owned native round-trip and downstream-probe results, one-time hostile-input snapshots, pre-stringification exact byte checks, canonical encoding and tagged hashing, structured limits, and abort-raced asynchronous probes. It is a finite reviewed-corpus witness projection, not a native shape serializer or cache-validation proof
- Landed as candidate-only: a repository-private OCCT artifact hook with a versioned binary-BREP envelope and canonical topology/native-orientation/lineage/history/volume sidecar. Decode creates fresh evaluation keys and accepts the sidecar only after exact root-type, orientation, count, and ordered structural verification. Direct state/corruption/ownership tests and a pinned asymmetric-box golden audit pass on the current stock runtime without certifying compatibility. Owned facade ABI 0.7 now supplies capped chunked BinTools-v4 output, borrowed-input length checking, strict consumption, a post-read topology ceiling, report-owned decode, same-kernel one-shot transfer, and exact TypeScript rollback; raw and owned-runtime tests prove the candidate does not fall back to legacy MEMFS. It has no package export and the production OCCT kernel still omits `shapeArtifacts`. Hostile native counts can still allocate beyond their input before post-read checks, sidecar JSON has pre-schema intermediate materialization, same-thread synchronous WASM has an in-flight cancellation gap, ordered topology cannot durably identify symmetric peers, and exact loaded runtime hashes are not attested
- Complete the production OCCT artifact boundary: add strict archive preflight and native allocation/work quotas, prompt cancellable native work, durable artifact-local native identity markers rather than order as identity, a bounded binary sidecar, exact loaded JS/WASM/build attestation, and reviewed cross-process goldens. Then advertise only after the full feature matrix passes and integrate cache read/decode and encode/write into evaluation with cleanup, cancellation, corruption, eviction, and conformance gates. No shipped backend advertises a codec and the evaluator does not consume the protocol yet
- Implement complete backend-owned codecs for other runtimes only when they can round-trip every evaluator-observable semantic. In the lockfile-tested Manifold 3.5.1 runtime, public Float32 Mesh reconstruction of a `1 × 2 × 3` box translated by `0.1` on X changes X bounds from `[-0.4, 0.6]` to `[-0.4000000059604645, 0.6000000238418579]` and volume from `6` to `6.000000178813934`; restoring tolerance does not restore the geometry
- Document auto-diff and geometric/B-Rep comparison APIs

Current topology keys and ABI indices remain evaluation-scoped. Protocol-v2 references persist detached face/edge/vertex evidence rather than those keys and resolve to a fresh key only for one compatible current candidate; protocol-v1 does the same under its frozen face/edge contract. Document v2–v6 can serialize the evidence and selector intent admitted by each frozen grammar, never the resolved key or native shape. Four version axes are independent: Document v6 is the current JSON authoring grammar; persistent-reference protocol v2 is the current detached-evidence envelope while v1 remains supported unchanged; OCCT descriptor `@6` is the primary v2 declaration while exact v1 descriptor `@4`/`@5` fingerprints remain compatibility profiles; and facade ABI is 0.7 with `exactIndexedTopologyEvolution` still at v1. Migration to Document v6 never upgrades a stored protocol or descriptor fingerprint and never rewrites evidence. Authored impact v1 closes each current evaluation context independently; it is not a field-level or document auto-diff, cannot predict newly introduced dependencies, and is not a geometric/B-Rep comparison, cache-validation, or topology-identity system. Feature hashes identify effective v1 intent but are not geometry proofs or complete cache keys. Artifact-cache v1 supplies the compatibility and ownership envelope; semantic-observation v1 supplies an exact normalized projection of the finite plan being audited; and the conformance audit supplies bounded corpus evidence. None certifies a codec, establishes eligibility, or enables caching. Generic OCCT BREP exchange cannot fill the codec gap because it loses wrapper-level lineage, complete/partial history, topology annotations, analytic overrides, cached evaluator state, and stable fresh-subshape restoration. The Manifold public Mesh round trip loses exact double-precision geometry through Float32 positions. ABI 0.7 bounds native output before materialization but production codecs must also bound hostile decode allocation, observe cancellation during native work, and carry an exact runtime/format/options/tolerance fingerprint. Exact ABI 0.4 Boolean, ABI 0.5 fillet/chamfer, and ABI 0.6 shell/offset history prove one evaluation's evolution graph and strengthen semantic-lineage evidence, but do not themselves make a native index persistent. Vertices have no semantic roles, treatment roles name classes rather than individual faces, and indistinguishable symmetric or coincident candidates fail persistent matching as ambiguous. Real codecs and evaluator consumption remain future work.

## 0.4 — advanced mechanical features

- Asymmetric, distance-angle, and variable chamfer modes through semantic selectors
- Variable fillet through semantic selectors
- Closed, variable-thickness, and intersection/miter-join shell modes
- Composite Bézier/B-spline/helix and guided or variable-section sweep modes; smooth/guided/open or holed loft modes; pipe; and two-dimensional wire/profile offset
- Feature-specific validity and healing diagnostics
- Expand the persistent-selection torture corpus across each newly named feature family and topology kind

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
