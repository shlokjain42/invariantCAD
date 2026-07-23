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
  package-neutral ABI/bundle 0.9 generation are present. The JS/WASM bundle
  carries checksums, provenance, CycloneDX SBOM, source/relinking information,
  notices, licenses, and the ordered nine-patch series ending in
  `0009-bintools-v4-structural-preflight.patch`.

Facade ABI/bundle numbers version the native adapter boundary, not product
releases. ABI 0.9 retains ABI 0.6's modeling/history surface, ABI 0.7's bounded
artifact transport, and ABI 0.8's fixed 128 MiB cumulative native
allocation-request budget, then adds exact owned-profile BinTools-v4 structural
preflight only for the repository-private candidate.

**Deferred:** public facade distribution requires external legal, release, and
security review plus an explicit durable publication channel. Until then, the
verified local bundle is not a supported public download.

## In progress — production shape artifacts and transparent caching

This is the current implementation frontier. The public protocol exists and a
repository-private evaluator experiment exercises one bounded slice, but **no
shipped backend advertises `shapeArtifacts`, no public evaluator option enables
shape reuse, and ordinary package consumers cannot bind the experiment**.

- A package-private, explicit-`trusted` binding now connects the OCCT candidate
  to the cache session for requested solid outputs whose referenced feature is
  directly a `box`. It snapshots the document and effective evaluation options,
  validates capability and dimensions before touching the store, creates a
  fresh session per evaluation, rejects overlap/disposal while active, and
  preserves ordinary status, measurement, topology, empty-result, ownership,
  and cleanup behavior on cold and warm paths. Misses model/encode/write; hits
  decode a fresh owner. Corruption in read-write mode is deleted and
  recomputed, while read-only poison, failed eviction, store/codec/write
  failures, and cancellation fail strictly. Oversized key metadata bypasses
  this private optimization and models normally.
- This binding is deliberately box-only. Dependent transforms and every other
  feature remain uncached because skipping a subtree without a versioned
  diagnostic/topology-policy transcript could make warm evaluation observably
  different. It does not alter `CreateEvaluatorOptions`, `EvaluationOptions`,
  `GeometryKernel`, root exports, or kernel capability advertising.
- Cache keys now reject non-canonical UTF-8 and bound node IDs, identities,
  solver/codec fingerprints, and aggregate canonical key material before
  hashing. Record construction snapshots non-shared bytes before its first
  await, and the package-private atomic encode/write path supplies the encoder
  the exact race-free remaining budget. Record SHA-256 detects corruption or
  misrouting, not a malicious trusted store that substitutes another valid
  artifact and recomputes its digest.

- The repository-private OCCT candidate format v3 retains binary BREP and the
  bounded canonical topology/native-orientation/lineage/history/volume sidecar
  v2, then adds native identity v1. The sidecar's fixed 48-byte big-endian
  header still declares exact topology, adjacency, lineage, UTF-16BE
  string-byte, and orientation totals. The new identity section records, for
  each unique located solid, shell, wire, face, edge, and vertex, the zero-based
  direct-child path to its first `IsSame` occurrence. Its complete rooted
  pre-order occurrence stream then records every serialized node in fixed
  12-byte records containing shape type, composed orientation, direct-child
  count, and canonical `IsSame` class index for those six kinds. Compound,
  compsolid, and generic-shape nodes are structurally recorded but unindexed.
  Producer paths are sorted canonically per kind, with topology, orientations,
  and occurrence class indices jointly permuted; consumers map those paths onto
  their fresh raw enumeration and reject multiplicity, order, orientation,
  `IsSame`-class membership, or structure substitutions before exact semantic
  restoration.
  Encode counts before allocating exact sections; decode preflights every
  header and total, requires closed canonical values and exact envelope,
  sidecar-v2, and identity-v1 EOF, creates fresh evaluation keys, and accepts
  state only after exact native verification. Stock `occt-wasm` can tolerate
  suffix bytes after a valid native BREP archive, so strict EOF inside the BREP
  section remains an owned-ABI-0.7+ guarantee rather than a stock guarantee.
  The private envelope also caps its compatibility fingerprint at `2,048` UTF-8
  bytes.
- Native identity v1 has a 64-byte header and is bounded to `100,000` unique
  paths, `1,000,000` aggregate first-path components, depth `64`, child index
  `999,999`, `100,000` occurrence records/traversal visits, and `1,000,000`
  `IsSame` comparisons. The compatibility fingerprint binds
  `nativeIdentity=serialized-first-issame-child-path-v1`,
  `nativeOccurrenceManifest=complete-rooted-preorder-type-orientation-child-count-issame-class-v1`,
  `nativeOccurrenceRecordBytes=12`, `nativeIdentityMaxOccurrences=100000`,
  `nativeIdentityTraversalOccurrences=100000`, every other identity ceiling,
  the native structure contract, runtime/options, and owned-native
  materialization declarations.
- Direct state, corruption, ownership, and pinned asymmetric-box golden audits
  pass on the reviewed runtime without certifying compatibility. The v3 golden
  is `13,735` bytes with fixture witness
  `invariantcad:kernel-shape-artifact-fixture:v1:sha256:8ecfa6ac89142f794c2d55a78e7121ce0805b8abcb5aa64230e7722d99c8c2be`;
  its semantic witness remains
  `invariantcad:kernel-shape-semantic:v1:sha256:40ae684e4a2fad512f54e1f1be4443acf7faf2f34fc6b281c7b816d8d3366cb2`.
  V1 and v2 are retained only as negative rejection fixtures. A dedicated
  duplicate-occurrence regression replaces a single occurrence with two uses of
  the same located TShape and requires transactional rejection. Verify v3 with
  `pnpm artifact:fixture:occt -- --check --version v3`. ABI 0.7 adds a capped
  chunked BinTools-v4 writer, borrowed-input length checks, strict consumption,
  a post-read topology ceiling, report-owned decode, same-kernel one-shot
  transfer, and exact TypeScript rollback. ABI 0.8 additionally applies a
  private cumulative native allocation-request budget and reports admitted
  requested bytes, allocation calls, and denial. The owned-runtime path does
  not fall back to legacy MEMFS. Reviewed throwing C++ denial paths return a
  report, while direct C allocator denial is fail-stop and requires discarding
  the disposable worker/process runtime. ABI 0.9 parses the exact owned
  BinTools-v4 profile before OCCT under fixed ceilings of `1,000,000` structural
  work units, `64` nesting levels, and location-power magnitude `1,000,000`.
  Canonical locations and the complete backward TShape hierarchy/reachability
  are checked; bounded TShape metadata is charged to the native request quota;
  and reports expose work/depth/location-power/consumed-byte, completion/code,
  and deserialization-start telemetry. Conservative squared aggregate geometry,
  representation, expanded-topology, wire, and face envelopes prevent compact
  records from hiding disproportionate downstream validation. Global geometry
  squaring deliberately admits roughly fewer than `1,000` geometry work units
  under the shared cap, with other charges lowering it; this is a private
  artifact-compatibility ceiling, not a general modeling limit.
- An unexported one-shot disposable-operation coordinator now closes the
  host-side result/timeout/abort/termination races used by the isolation gates.
  The Chromium production-bundle gate transfers a copy of the committed v3
  fixture into a stock-runtime module worker, proves retained-input
  immutability and transfer detachment, accepts only its closed started/result
  protocol, and returns scalar evidence only after shape/kernel cleanup. The
  same production bundle also runs a real `Evaluator.evaluate(...)` over a
  stock-OCCT box. Its normal case uses the private trusted-store binding: cold
  evaluation records `miss,write` and one native box call, while warm evaluation
  records `hit`, exact detached evidence parity, and zero additional box calls.
  Public artifact support remains absent. Deadline and post-kernel-start abort
  cases complete the native box first and then stall without yielding inside an
  unbound wrapper; the host requests termination and a fresh worker reproduces
  the successful evaluator's detached scalar evidence exactly. Browser
  `Worker.terminate()` is not awaitable, so this proves termination requests and
  fresh-worker recovery rather than observed worker exit. Live native handles
  never cross the realm boundary.
- `pnpm test:occt-artifact-process` now runs the owned ABI 0.9 candidate as
  one-shot Node children and is included in `test:occt-facade-bundle`.
  Fresh producer A and consumer B agree on deterministic artifact, capability,
  runtime-input, and semantic evidence while preserving the parent-owned input.
  Each child verifies packaged `metadata/release.json` against the independently
  maintained reviewed pin, imports the exact verified JavaScript bytes through
  the Node module hook, and supplies a fresh verified WASM copy. The gate rejects
  a one-byte mutation in the manifest or either runtime file before supplied
  JavaScript executes. Additional children run the real evaluator over a fixed
  two-box Boolean union. Their versioned protocol requires exact
  `operation-started` then `kernel-operation-started` events; the latter is
  emitted inside the evaluator-invoked Boolean wrapper before the real native
  operation, so it proves entry rather than completion. The stall is placed only
  after that Boolean has completed and emits a third exact
  `non-yielding-stall-started` marker. Timeout requires that marker and abort
  waits for it before sending `SIGKILL`; both await child close, and fresh
  children reproduce identical detached measurements, topology, document hash,
  and runtime evidence. Incomplete nonempty event prefixes are rejected, while
  a pre-start attestation failure legitimately emits no event. Successful
  evidence is emitted only after evaluated design and evaluator cleanup; an
  injected cleanup failure cannot return success. The artifact path still
  covers injected-trap discard and fresh recovery. Its closed evidence
  explicitly records `shapeArtifacts` as absent and
  `certifiesCompatibility: false`.
- Process protocol v3 now adds parent-mediated evaluator-cache record transfer
  for a direct-output `2 × 3 × 5` box. Two independent fresh verified producers
  must emit byte-identical records and evidence after `miss,write`, one native
  box, and observed encode. A fresh compatible read-only consumer must record
  `hit`, observe decode, perform zero native box calls, and reproduce complete
  measurements/topology; another solver fingerprint must derive another key,
  miss, and model once without invoking either codec direction. The binary
  transfer has an 8-byte versioned magic, a little-endian 32-bit header length,
  a 32 KiB closed canonical-JSON header ceiling, exact payload/EOF, fatal UTF-8,
  record/key/integrity validation, SHA-256, and request-specific byte bounds.
  Tampered payloads, forged key/metadata, shared or hostile views, post-start
  abort, and injected failure are followed by fresh-process recovery. Evidence
  fixes the trust boundary as `trusted-parent-mediated-record`, sets record
  authentication false, and retains both certification non-claims.
- Public Node and browser attested loaders now close exact owned-runtime-pair
  identity under an independent canonical release-manifest pin. Executable
  authority stays private to the evaluated InvariantCAD internal module instance
  that created it; cloning the visible report does not reproduce it.
  `createOcctKernel` checks the initialized facade marker, supplies a fresh
  verified WASM copy, and binds the exact pair identity only into the private
  artifact fingerprint. Node uses one process-global module hook without
  temporary executable files; browser uses a revocable Blob module URL and
  requires a compatible CSP. The separate declared-build identity records the
  manifest while leaving build execution, publisher authentication, and
  compatibility certification false.
- Promotion remains blocked because the cumulative 128 MiB request budget and
  structural-work meter are not live/peak-memory proof. Exact runtime-pair
  verification does not authenticate the declared build execution or publisher
  and does not defend against a trusted host, same-process hook chain, or
  same-UID process. The injected trap is an orchestration fault, not a real OCCT
  trap. V3 verifies every serialized occurrence's multiplicity, order, type,
  composed orientation, child count, and canonical `IsSame` class, independently
  of raw TopExp order. Compound/compsolid/generic nodes are recorded structure,
  not indexed public identities. Stock `occt-wasm` lacks `IsPartner`, so v3
  cannot attest that distinct-location `IsSame` classes share one underlying
  TShape. Serialized paths also are not cross-edit topology IDs or persistent
  assembly identities. One owned producer/consumer scenario is not a reviewed
  cross-platform golden matrix.
- The evaluator gates prove forced containment only at repository-owned,
  one-shot realm boundaries. A killed realm cannot run language-level cleanup;
  process or worker destruction reclaims it instead. Ordinary public
  `Evaluator.evaluate(...)` remains same-thread and cooperative, and no public
  isolated evaluator API or operational-cancellation certification has been
  added.
- Production work therefore still requires a public operational isolation
  boundary where hard cancellation is promised and a reviewed cross-platform
  owned-runtime golden matrix. The repository-private box integration must
  expand into a public, diagnostic-preserving evaluator contract; cross-edit
  topology and persistent assembly identity are separate protocols, not claims
  made by v3. Build/publisher provenance remains an explicit non-claim rather
  than a cache-compatibility identity.
- Only after that matrix passes will OCCT advertise the capability. Evaluator
  integration must then expand beyond direct boxes to dependency-bearing solid
  families while preserving every diagnostic and topology policy, and retain
  the current read/decode, encode/write, fresh-ownership, corruption,
  cancellation, cleanup, eviction, concurrency, configuration/solver/kernel
  compatibility, and conformance guarantees.
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
compatibility profiles; and facade ABI is 0.9 while exact indexed topology
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
