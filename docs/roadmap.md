---
title: "Roadmap"
description: "What shipped in 0.1.0, what is active now, what is planned later, and the criteria for InvariantCAD 1.0."
icon: "map"
---

# InvariantCAD roadmap

InvariantCAD's goal is one coherent TypeScript CAD platform, not one
monolithic geometry algorithm. Specialized kernels, solvers, renderers,
translators, and analysis engines sit behind versioned protocols while the
TypeScript API, document model, diagnostics, and design semantics remain
stable.

## How to read this roadmap

Every section has an explicit status:

- **Shipped** means the behavior is in the public `invariantcad` 0.1.0 package
  and is covered by its release gates.
- **Repository-only** means the source, tests, or reproducible bundle tooling
  exists in this repository but the capability is not distributed through the
  public npm package.
- **In progress** means the protocol or candidate exists, but a documented
  promotion gate still blocks production use.
- **Planned** means the capability is part of the intended platform but is not
  implemented or advertised today.
- **Deferred** means work will not begin until a named prerequisite or external
  review is complete.

The earlier roadmap treated “0.1”, “0.2”, and “0.3” as sequential capability
bands. Development did not stop at those boundaries: the public 0.1.0 release
shipped the executable foundation, most of the former exact-mechanical 0.2
track, and substantial persistent-intent work from the former 0.3 track. The
headings below describe actual status instead of implying that already shipped
work is waiting for a later version number. Future release numbers will be
assigned to coherent, release-gated increments rather than to the old bands.

## Shipped — public 0.1.0 platform

### Kernel-neutral authoring and product structure

- Versioned, canonical design IR with stable IDs, a validated feature DAG, and
  frozen Document v1–v6 grammars with explicit migration to current Document
  v6.
- Dimensioned expressions, bounded parameters, explicit base units, named
  configurations, call-time overrides, and deterministic dependency checks.
- Sketch points, lines, arcs, and circles; explicit profiles and holes; a
  reference constraint solver; and curve-preserving resolved profiles with
  sketch-entity provenance.
- Boxes, cylinders/cones, spheres, extrudes, revolves, Booleans, transforms,
  bounded ruled solid lofts, and bounded exact solid sweeps along explicit open
  3D polyline, three-point circular-arc, and ordered line/arc composite paths
  with corrected-Frenet transport.
- Parts, fixed-placement nested assemblies, document-owned materials with
  explicit density, deterministic part references, instance suppression,
  part-material overrides, and variant-aware deterministic bills of materials.
- Kernel-neutral volume, surface area, bounds, center of mass, centroidal
  inertia, principal/axis analysis, radii of gyration, density-aware physical
  mass, affine occurrence mass, and structured partial-mass diagnostics.
- Validation, structured diagnostics, canonical serialization and hashing,
  authored change-impact analysis, effective feature hashes, CLI commands,
  examples, package conformance, and explicit native-resource ownership.

### Mesh and exact geometry backends

- The bundled Manifold backend provides watertight mesh primitives, extrude,
  revolve, Boolean operations, transforms, measurement, and STL/OBJ workflows.
- The stock OpenCascade backend provides exact B-Rep primitives, extrude,
  revolve, Booleans, transforms, bounded ruled lofts, bounded line/arc sweeps,
  constant-radius fillets, equal-distance chamfers, constant-thickness
  inward/outward shells, and whole-solid inward/outward offsets with fixed
  round joins.
- STEP and text/binary OCCT BREP import/export, explicit exact-to-mesh
  tessellation tolerances, and evaluated-output STL, OBJ, STEP, and BREP export
  are public. Kernel-level import exists; a serializable imported-body feature
  remains planned.
- Exact kernel-neutral profile area and centroid moments, authoritative
  translated-world sweep-volume semantics, independent native-face
  certification, and geometry-derived composite-sweep capability preflight are
  shipped for the bounded sweep contract.
- Stock OCCT supports the exact geometry listed above with feature-dependent
  partial topology history. The stronger complete-history paths described
  under “Repository-only” are not silently implied by the npm package.

### Exact topology and persistent design intent

- Evaluation-scoped exact B-Rep face, edge, and vertex snapshots with explicit
  capability negotiation, analytic geometry descriptors, reciprocal
  adjacency, feature provenance, and sketch sources.
- Semantic origin/geometry/adjacency selectors, set algebra, explicit
  cardinality, and deeply frozen resolved/missing/ambiguous explanation reports.
- Closed primitive/extrusion roles plus source-aware revolution swept faces,
  partial-turn caps, full-turn cap omission, axis-boundary collapse,
  deliberately unnamed revolution edges/artifacts, and sketch-curve source
  provenance through transforms.
- Closed bounded ruled-loft roles for source-free start/end caps, source-aware
  two-lineage side faces and section rims when source data exists, and
  source-free lateral edges for non-circular curves. Direct unsourced profiles
  never gain invented sources, circular seams remain unnamed, authored curve
  phase must align, and incomplete or ambiguous correspondence downgrades to
  partial history.
- Closed bounded-sweep roles with path-directed source-free caps, `C*S`
  source-aware sides, `C` source-aware rims at each end, and `V*S` source-free
  laterals for `C` direct-profile curves, `S` authored path segments, and `V`
  authored non-circular curve starts. Direct unsourced calls invent no sources,
  path-joint fragments and circular seams remain unnamed, and ambiguous,
  incomplete, or nonlocal graph correspondence downgrades to partial history.
- Topology-signature protocol v2 for detached face/edge/vertex references,
  including vertex point evidence and reciprocal face↔edge and edge↔vertex
  one-hop evidence. Protocol-v1 face/edge wire bytes, evidence, and matching
  remain frozen and supported through exact compatibility profiles.
- Document v2 topology-reference registries and typed persistent selector atoms,
  extended through Document v6 with v1–v5 preservation, canonical normalized
  variants, exact direct-target and protocol/fingerprint binding, bounded
  shared resolution, and fillet/chamfer/shell/draft consumption.
- OCCT topology descriptor `@6` is the primary protocol-v2 declaration for
  known stock and recognized owned runtimes. One exact protocol-v1
  compatibility profile retains descriptor `@4` for stock/owned ABI 0.2–0.4
  or descriptor `@5` for owned ABI 0.5+.
- Document v4 added only the six bounded-sweep role literals; Document v5 added
  only `fillet.face.blend` and `chamfer.face.bevel`; Document v6 added persistent
  vertices, vertex `position` queries, and edge↔vertex adjacency without adding
  semantic vertex roles. Migrations preserve stored protocol, fingerprint,
  lineage, geometry, and adjacency evidence verbatim.
- The published persistence torture corpus covers transformed complete lineage,
  partial Boolean fallback, topology disappearance and recovery, deliberate
  sweep ambiguity, multiple fingerprints, cancellation, serialization, and
  native ownership cleanup.
- Authored design-impact report v1 performs bounded, configuration-aware reverse
  dependency closure over expressions, bounds, effective materials, active
  assembly instances, persistent selectors, the feature DAG, and outputs.
- Feature-hash protocol v1 provides bounded, cancellable, kernel-independent
  SHA-256 Merkle identity under one effective evaluation context. These hashes
  identify admitted intent, not geometry or cache eligibility.

### Artifact and conformance foundations

- Artifact-cache protocol v1 ships as a public storage and compatibility
  foundation: evaluator/kernel/artifact/solver-bound solid keys, fail-closed
  solver fingerprints, all-or-nothing optional codec capabilities, explicit
  encode/decode ownership, integrity-checked detached records, bounded
  cancellable stores, concurrency-safe aggregate sessions, and a copying
  reference memory store.
- The public framework-neutral `invariantcad/conformance` boundary audits
  candidate or already-advertised shape codecs against exact runtime identity,
  tagged semantic witnesses, golden-first decode fixtures, fresh producer and
  consumer instances, both disposal orders, ownership and mutation isolation,
  malformed input, byte ceilings, and pre-abort behavior. Finite audit evidence
  deliberately confers neither certification nor cache eligibility.
- Semantic-observation protocol v1 produces a bounded canonical
  evaluator-semantic quotient with exact normalized IEEE-754 numbers, sorted
  oriented Float32 triangle multisets, exact key-neutral topology-graph
  labeling under separate search/work budgets, complete advertised-feature
  probe-or-exclusion accounting, native round-trip and downstream-probe
  results, hostile-input snapshots, byte checks, canonical encoding, tagged
  hashing, structured limits, and abort-raced asynchronous probes.

## Repository-only — owned OCCT facade

The owned facade is not part of the `invariantcad` npm package and is never an
implicit runtime download.

- ABI 0.4 provides ordered multi-input union, subtraction, and intersection
  against isolated working copies with byte-stable arena operands,
  transactional fail-closed transfer, and complete face/edge/vertex
  `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED` plus residual source-less
  `CREATED` evolution.
- Boolean lineage is identity-only: preserved/modified successors inherit
  proven roles and sources, while generated-only and higher-order source-less
  `CREATED` topology is created by the current Boolean without source-role
  inheritance. The caller-configurable history budget defaults to `1_000_000`
  and is enforced before native report materialization or indexed JavaScript
  copying.
- ABI 0.5 adds exact constant-radius fillet and equal-distance chamfer evolution
  with the same complete record classes. Canonical input-index-ordered
  tangent-contour seeds are duplicate/overlap idempotent, one native build is
  performed, and the report echoes exact selected-edge progress. A deep
  topology-independent operand copy, proved original/copy correspondence,
  report-owned same-kernel one-shot transfer, and exactly-once rollback protect
  ownership. Identity-less faces receive strict blend/bevel class roles only
  when exact generated edge→face records prove them; residual generated edges
  remain unnamed.
- ABI 0.6 adds exact face-selected shell and whole-solid offset evolution with
  complete record classes and identity-only lineage. Shell openings are
  canonical input-index ordered; solid copies are topology-independent and
  byte-stable; final-membership reconciliation handles generated-only
  replacements. A selected opening may correctly remain a `MODIFIED` planar
  rim rather than becoming `DELETED`.
- ABI 0.2–0.4 retain partial-history fillet/chamfer fallback and ABI 0.2–0.5
  retain partial-history shell/offset fallback. Independent Boolean,
  edge-treatment, and solid-offset history budgets are enforced before native
  materialization or indexed copying.
- The matched facade enables atomic signed multi-face neutral-plane draft
  through semantic face selectors with exact indexed face/edge/vertex
  evolution. It also strengthens bounded composite sweeps with controlled
  corrected-Frenet/right-corner PipeShell refinements.
- A reproducible, digest-pinned facade build foundation and strict local
  package-neutral ABI/bundle 0.7 generation are present. The JS/WASM bundle
  carries checksums, provenance, CycloneDX SBOM, source/relinking information,
  notices, licenses, and the ordered seven-patch series ending in
  `0007-bounded-shape-artifacts.patch`.

Facade ABI/bundle numbers version the native adapter boundary, not product
releases. ABI 0.7 retains ABI 0.6's modeling/history surface and adds bounded
artifact transport only for the repository-private candidate.

**Deferred:** public facade distribution requires external legal, release, and
security review plus an explicit durable publication channel. Until then, the
verified local bundle is not a supported public download.

## In progress — production shape artifacts and transparent caching

This is the current implementation frontier. The public protocol exists, but
**no shipped backend advertises `shapeArtifacts` and the evaluator does not read
or write cached shapes today**.

- The repository-private OCCT candidate format v2 uses a versioned binary-BREP
  envelope plus a bounded canonical binary topology/native-orientation/lineage/
  history/volume sidecar. Its fixed 48-byte big-endian header declares exact
  length and aggregate topology, adjacency, lineage, UTF-16BE string-byte, and
  orientation limits. Encode counts before allocating one exact output; decode
  preflights the header and totals, requires closed canonical values and exact
  EOF, creates fresh evaluation keys, and accepts state only after exact native
  structural verification. This closes the former JSON-intermediate sidecar
  allocation gap.
- Direct state, corruption, ownership, and pinned asymmetric-box golden audits
  pass on the reviewed runtime without certifying compatibility. The v2 golden
  is `11,591` bytes with fixture witness
  `invariantcad:kernel-shape-artifact-fixture:v1:sha256:221d1ea2265a26df1293e63d625d25e85eb8a86041bdea53a927269427e3d16a`;
  its semantic witness remains
  `invariantcad:kernel-shape-semantic:v1:sha256:40ae684e4a2fad512f54e1f1be4443acf7faf2f34fc6b281c7b816d8d3366cb2`.
  V1 is retained only as a negative rejection fixture. Verify v2 with
  `pnpm artifact:fixture:occt -- --check --version v2`. ABI 0.7 adds a capped
  chunked BinTools-v4 writer, borrowed-input length checks, strict consumption,
  a post-read topology ceiling, report-owned decode, same-kernel one-shot
  transfer, and exact TypeScript rollback. The owned-runtime path does not fall
  back to legacy MEMFS.
- Promotion remains blocked by hostile native counts that can allocate before
  post-read checks, same-thread synchronous WASM cancellation gaps, order-based
  symmetric topology, and the absence of exact loaded-runtime attestation and
  reviewed cross-process goldens.
- Production work therefore requires strict archive preflight, native
  allocation and work quotas, promptly cancellable native operations, durable
  artifact-local native identity markers rather than enumeration order, exact
  loaded JS/WASM/build attestation, and a reviewed cross-process golden matrix.
- Only after that matrix passes will OCCT advertise the capability. Evaluator
  integration must then cover per-solid cache read/decode and encode/write,
  fresh ownership, corruption, cancellation, cleanup, eviction, concurrent
  sessions, configuration/solver/kernel compatibility, and conformance gates.
- Backend-owned codecs for other runtimes remain deferred until they can
  round-trip every evaluator-observable semantic. In the lockfile-tested
  Manifold 3.5.1 runtime, reconstructing a translated `1 × 2 × 3` box from the
  public Float32 mesh changes X bounds from `[-0.4, 0.6]` to
  `[-0.4000000059604645, 0.6000000238418579]` and volume from `6` to
  `6.000000178813934`; restoring tolerance does not restore the geometry.

## Planned — exact mechanical follow-through

These items complete the useful exact-modeling baseline; they are not shipped
unless separately marked above.

- Extend complete Boolean, fillet/chamfer, and shell/offset provenance beyond
  the owned ABI 0.4/0.5/0.6 paths while retaining stock OCCT and legacy facades
  as supported partial-history implementations. Manifold retains declared mesh
  operations without exact topology snapshots.
- Expand role and source mapping beyond primitives, extrusion,
  revolution-face, bounded ruled-loft, and current bounded-sweep families.
  Add vertex roles only where a durable semantic identity can be justified;
  never assign arbitrary identities to symmetric, coincident, path-joint, or
  seam topology.
- Add editable conic and NURBS curves, NURBS surfaces, general surfacing,
  surface trimming/sewing, feature recognition, and feature-specific healing
  and validity diagnostics.
- Add IGES exchange and a serializable imported-body feature with explicit
  units, healing policy, source fingerprint, and exact/mesh conversion losses.
- Add document auto-diff plus geometric, mesh, and B-Rep comparison APIs. Keep
  authored dependency impact, effective feature hashes, topology persistence,
  and geometric equality as separate claims.

## Planned — everyday modeling and authoring

Comprehensiveness requires ordinary modeling workflows, not only deep kernel
protocols.

- Construction geometry, datum planes/axes/coordinate systems, projected and
  external sketch geometry, trim/extend/split, sketch offset, mirror, linear
  and circular sketch patterns, slots, ellipses/conics, and spline authoring.
- A production sketch-solver integration with conflict sets, redundancy
  explanations, stable degrees of freedom, drag solving, deterministic
  diagnostics, and an audited cross-runtime artifact fingerprint.
- Hole and hole-standard features, countersink/counterbore/thread metadata,
  pockets, pads, ribs, webs, bosses, grooves, face draft variants, linear and
  circular feature patterns, mirrors, and configurable feature suppression.
- Asymmetric, distance-angle, and variable chamfers; variable fillets; closed,
  variable-thickness, and intersection/miter-join shells.
- Composite Bézier/B-spline/helix paths; guided, spine-controlled, or
  variable-section sweeps; smooth/guided/open or holed lofts; pipes; and
  two-dimensional wire/profile offset.
- Selection ergonomics, reusable feature subgraphs, library parts/templates,
  richer metadata and custom properties, document queries, and stable
  diagnostics for partial, invalid, or self-intersecting results.
- Extend the persistence torture corpus across every newly named feature family
  and topology kind before advertising persistent downstream references.

## Planned — viewer and interactive tooling

The headless modeling package will remain renderer-independent. An optional
viewer layer and reference browser application will provide:

- WebGL/WebGPU-capable rendering adapters, camera/navigation controls, fit and
  standard views, grids and axes, visibility/transparency controls, section
  planes, exploded assemblies, and measurement overlays.
- Face/edge/vertex picking mapped to evaluation-scoped topology keys and
  authorable semantic selectors—never durable raw triangle or array indices.
- Hover/highlight, multi-selection, selection explanations, feature-tree and
  assembly-tree inspection, parameter/configuration editing, diagnostics, and
  live rebuild state.
- Tessellation levels of detail, progressive/worker-based evaluation, large
  assembly culling, instancing, mesh reuse, and explicit cleanup of GPU and
  WASM resources.
- Framework adapters and embeddable components without coupling the document
  model to React, Three.js, Babylon.js, or any one application stack.

## Planned — mechanical assemblies

- A versioned assembly mate/joint solver protocol and at least one industrial
  solver integration.
- Planar, cylindrical, concentric, coincident, distance, angle, gear, rack,
  screw, slider, revolute, and fixed relations.
- Degrees of freedom, grounded components, subassembly solving, motion studies,
  limits, drivers, and deterministic solver diagnostics.
- Interference, clearance, minimum-distance, contact, and swept-envelope
  queries with semantic occurrence references.
- Effectivity, rule-driven variants, alternate/substitute components,
  configurable assembly structure, and scalable BOM/occurrence queries.

## Planned — drawings, PMI, and manufacturing

- Drawing views, projected/auxiliary/section/detail views, dimensions,
  tolerances, annotations, tables, title blocks, and revision metadata.
- A semantic PMI and GD&T model tied to persistent design intent rather than
  ephemeral topology indices.
- DXF, SVG, and PDF drawing export with deterministic layout and font policy.
- Sheet-metal walls, bends, reliefs, hems, seams, flat patterns, bend
  allowances, and bend tables.
- CAM stock, work coordinate systems, setups, operations, tools, holders,
  feeds/speeds, toolpaths, simulation, collision checks, and a versioned
  postprocessor protocol.
- Additive-manufacturing orientation/support checks, wall-thickness and
  overhang analysis, mesh repair, and 3MF export.

## Planned — CAE and engineering analysis

- A solver-neutral analysis document for material properties beyond density,
  coordinate systems, semantic loads, fixtures, contacts, mesh controls, cases,
  and result provenance.
- Surface and volume meshing protocols with quality metrics, convergence data,
  adaptive refinement, and exact-geometry association.
- Initial static structural, modal, thermal, and thermal-stress adapter
  contracts, followed by nonlinear, transient, fatigue, fluid, or multiphysics
  integrations where an external solver can satisfy the protocol.
- Bounded result datasets, field queries, derived quantities, unit-safe result
  comparison, and viewer overlays. InvariantCAD will orchestrate audited solver
  adapters rather than pretending one TypeScript implementation is every CAE
  solver.

## Planned — plugin and ecosystem platform

- Versioned plugin contracts for geometry kernels, sketch and assembly solvers,
  import/export translators, analysis engines, renderers, generators, CAM
  strategies, and postprocessors.
- Capability negotiation, compatibility fingerprints, lifecycle and ownership
  rules, cancellation, resource limits, structured diagnostics, and reusable
  conformance suites for every extension category.
- A manifest and discovery model that works in Node, browsers, workers, and
  server deployments without allowing a plugin to mutate canonical documents
  or bypass capability checks.
- Security guidance and isolation boundaries for untrusted document data,
  native/WASM plugins, file translators, and postprocessors. Sandboxing claims
  will be made only for runtimes that can enforce them.
- First-party adapters, examples, templates, framework integrations, and a
  searchable ecosystem catalog after the contracts stabilize.

## Planned — performance and runtime coverage

- A benchmark corpus for sketches, feature chains, topology resolution,
  imports, assemblies, tessellation, and repeated parameter/configuration
  rebuilds, with checked time, memory, artifact-size, and native-handle budgets.
- Incremental DAG evaluation backed by the production artifact cache, explicit
  invalidation explanations, bounded parallelism, worker pools, cancellation,
  and deterministic ownership under success and failure.
- Streaming and chunked exchange where formats permit it, configurable memory
  ceilings, large-model diagnostics, mesh/instance reuse, and leak-tested
  long-running evaluators and viewer sessions.
- Release-gated Node, browser, Web Worker, and server deployments. Firefox,
  Safari, Deno, Bun, shared-memory WASM, and WebGPU will be advertised only
  after dedicated compatibility and security gates exist.
- Profiling hooks that expose stable phase and resource metrics without leaking
  kernel handles or making timing part of deterministic design semantics.

## Deferred and research-dependent work

- Public distribution of the owned OCCT facade is deferred pending the external
  legal, release, and security review described above.
- Transparent Manifold shape artifacts are deferred until a backend-owned codec
  preserves double-precision geometry and every evaluator-visible semantic; a
  Float32 mesh reconstruction is not sufficient.
- Durable identity for perfectly symmetric or coincident subshapes remains a
  research problem. Such cases must continue to resolve as ambiguous rather
  than acquiring enumeration-derived identity.
- Real-time multi-user collaboration, PDM/PLM services, cloud execution, and
  proprietary translator/solver distribution may build on the document and
  plugin protocols, but hosted services are not prerequisites for the core
  open-source library.
- Generative or optimization systems may author and evaluate ordinary
  InvariantCAD documents, but probabilistic output will not weaken validation,
  determinism, topology, ownership, or capability contracts.

## Protocol boundaries that remain true

Topology keys and native ABI indices are evaluation-scoped. Protocol-v2
references persist detached face/edge/vertex evidence and resolve to a fresh
key only for one compatible current candidate; protocol v1 does the same under
its frozen face/edge contract. Documents serialize evidence and selector
intent, never resolved keys or native shapes.

Four version axes are independent: Document v6 is the current JSON authoring
grammar; persistent-reference protocol v2 is the current detached-evidence
envelope while v1 remains supported; OCCT descriptor `@6` is the primary v2
declaration while descriptor `@4`/`@5` fingerprints remain exact v1
compatibility profiles; and facade ABI is 0.7 while exact indexed topology
evolution remains protocol v1. Document migration never upgrades a stored
protocol or descriptor fingerprint and never rewrites evidence.

Authored impact v1 is not a field-level document diff and cannot predict newly
introduced dependencies. Feature hashes are not geometry proofs or complete
cache keys. Artifact-cache v1 supplies a compatibility and ownership envelope;
semantic-observation v1 supplies an exact normalized projection of a finite
reviewed plan; and the conformance audit supplies bounded corpus evidence. None
alone certifies a codec, establishes cache eligibility, or enables caching.

Generic OCCT BREP exchange cannot fill the codec gap because it loses
wrapper-level lineage, complete/partial history, topology annotations, analytic
overrides, cached evaluator state, and stable fresh-subshape restoration. Exact
ABI 0.4 Boolean, ABI 0.5 fillet/chamfer, and ABI 0.6 shell/offset history prove
one evaluation's evolution graph; they do not make a native index persistent.
Vertices currently have no semantic roles, treatment roles name classes rather
than individual faces, and indistinguishable candidates fail persistent
matching as ambiguous.

## 1.0 criteria

- Stable document schema, migration policy, public TypeScript API, capability
  negotiation, and extension versioning.
- A coherent everyday modeling surface, exact B-Rep and mesh backends passing
  the published conformance corpus, and documented conversion losses.
- Industrial sketch and assembly solver integrations with deterministic,
  structured diagnostics.
- Persistent topology robust across the published feature and parameter torture
  suites, with ambiguity preserved where identity cannot be proved.
- A production viewer and supported Node, browser, worker, and server
  deployments without coupling headless design semantics to one UI framework.
- Reproducible packages, SBOMs, license notices, security policy, plugin threat
  boundaries, and reviewed native/WASM distribution channels.
- Production artifact caching and incremental evaluation with corruption,
  compatibility, cancellation, cleanup, eviction, and cross-process gates.
- Published performance budgets and leak-free long-running evaluation,
  analysis, and viewer sessions on representative large models.
- Complete documentation, examples, upgrade guides, support matrices, and
  conformance kits sufficient for third-party kernels, solvers, translators,
  viewers, and analysis plugins.
