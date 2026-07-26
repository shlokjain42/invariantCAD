---
title: "Roadmap"
description: "Dependency-ordered milestones from the 0.1 foundation to a production mechanical CAD-as-code platform."
icon: "map"
---

# InvariantCAD roadmap

InvariantCAD is building a complete, deterministic, general-purpose mechanical
CAD-as-code platform for TypeScript. The [product scope](/project/product-scope)
defines what “complete” means and what the project deliberately does not try to
be.

This roadmap is ordered by dependency, not by the number of attractive features
in each category. A downstream capability starts only when its document,
geometry, identity, and runtime prerequisites are real. That keeps the project
from accumulating disconnected kernel wrappers that cannot compose into useful
models.

## Status vocabulary

- **Published** means available in the public `invariantcad` 0.1.1 npm package.
- **Unreleased** means implemented on the main branch after 0.1.1 but not yet
  present in a public npm release.
- **Repository-only** means source or evidence exists for development, but the
  capability is deliberately inaccessible to package consumers.
- **Next** identifies the current product milestone.
- **Planned** identifies dependency-ordered work that has not shipped.
- **Deferred** identifies work blocked on a named prerequisite or external
  review.

Capabilities are never inferred from a roadmap item. The
[support matrix](/reference/support-matrix) and runtime capability reports are
the authority for usable behavior.

## Current baseline

### Published in 0.1.0

The first release established the executable foundation:

- Canonical immutable Document v1–v6 grammars with explicit migration,
  validation, deterministic serialization, stable node IDs, and an acyclic
  feature graph.
- Typed parameters and expressions for scalars, lengths, angles, and mass
  density; bounded values; named configurations; call-time overrides; and
  dimension checking.
- Sketch points, lines, arcs, circles, profiles, and holes with a replaceable
  reference constraint solver and curve-preserving resolved profiles.
- Boxes, cylinders/cones, spheres, extrudes, revolves, Booleans, transforms,
  bounded ruled solid lofts, and bounded solid sweeps over supported line/arc
  paths.
- Parts, fixed-placement nested assemblies, materials, occurrence suppression,
  material overrides, configurations, and deterministic variant-aware BOMs.
- Geometry and physical-property analysis including volume, area, bounds,
  center of mass, centroidal inertia, principal/axis analysis, radii of
  gyration, and structured partial-mass diagnostics.
- A bundled Manifold mesh backend for common modeling and STL/OBJ workflows.
- A stock OpenCascade backend for exact B-Rep primitives and features,
  STEP/BREP exchange, tessellation, fillet, chamfer, shell, and solid offset.
- Evaluation-scoped face, edge, and vertex topology; semantic selectors;
  topology queries; detached persistent references; and explicit
  missing/ambiguous resolution reports.
- Authored impact analysis, effective feature hashes, artifact/cache protocol
  foundations, semantic-observation conformance foundations, CLI commands,
  browser loading, structured diagnostics, cancellation, and explicit native
  ownership.

The public release is useful for deterministic parametric solids and fixed
assemblies. It is not yet an industrial sketcher, multibody modeler, assembly
solver, drawing system, sheet-metal system, CAM system, or CAE system.

### Published in 0.1.1

The foundation-hardening release added:

- Public Node and browser loaders for a caller-supplied, independently attested
  owned OCCT JavaScript/WASM runtime pair.
- Named `mesh-preview` and `mechanical-exact` evaluator profiles with immutable
  capability reports and fail-before-ownership behavior.
- A versioned strong kernel-level document-body import contract for STEP and
  declared-unit text/binary BREP.
- Three executable reference models and a six-case Manifold/OCCT benchmark
  protocol with explicit measurement and interpretation boundaries.
- Six canonical documentation modules covering 22 declared workflows, plus
  checked public API reports for every JavaScript entry point.
- Stronger package, dependency, source-format, governance, browser, process
  isolation, runtime-attestation, and release checks.
- Updated supported toolchain and OCCT dependency versions.
- Additional bounded artifact-key, record, process-transfer, and native-runtime
  hardening.

The owned runtime still requires the caller to provide reviewed runtime files.
The repository does not silently download or distribute that bundle.

### Repository-only research and staged work

The repository contains a private owned-OCCT shape-artifact candidate and a
direct-box evaluator-cache experiment. No public backend advertises
`shapeArtifacts`, no public evaluator option enables the experiment, and
ordinary package consumers cannot bind it.

This research is now maintenance-only while product modeling catches up. Its
formats, threat boundary, evidence, non-claims, and promotion gates live in the
[shape artifact and cache engineering note](/engineering/shape-artifact-cache-research),
not in the product roadmap.

Document v7 resource resolution, datums, richer shape algebra, body-set and
multibody results, imported-body nodes, external occurrences, and feature-hash
protocol v2 are also staged internally. A source-only
`stagedBodySetDesignV7(...)` facade now authors the bounded product graph
admitted by the staged evaluators and datum resolver: typed length, angle,
mass-density, and scalar parameters; named parameter, part-material, and
assembly-instance-suppression configurations; document-owned materials; boxes,
cylinders, spheres; primitive/import/transform solid DAGs with ordered
translate, rotate, scale, and mirror operations; content-addressed resource
commitments; imported-body leaves; body sets; parts over one solid DAG root or
body set; acyclic nested fixed-placement assemblies of local parts and
already-completed local assemblies with per-occurrence configuration
selectors; datum points, axes, planes, and coordinate systems; and direct
imported-body/body-set/part/local-assembly outputs. Generic primitive or
transformed-solid outputs remain unsupported. Datums remain addressable nodes
rather than design outputs. The facade produces detached, deeply frozen,
strictly valid v7 documents while enforcing namespaces, typed builder
ownership, exact plain own-data options, dense collections, unique memberships
and occurrence IDs, commitments, material/configuration references, and
authoring limits. Resource locations remain inert resolver hints, and the
imported node's explicit format—not `mediaType`—selects STEP or BREP
interpretation. The caller computes each digest and byte-length commitment; the
facade performs no resource-byte I/O or hashing.

One source-only executable slice evaluates outputs that directly reference an
imported-body node by verifying caller-resolved bytes and invoking the kernel's
strong exact single-solid import contract. A second evaluates outputs that
directly reference a body set whose members are roots of bounded
primitive/import/transform solid DAGs. It preserves authored member identity,
order, names, and metadata, treats every listed member as active with no
inferred primary, and reports whether the result is exact or approximate.
Stock OCCT retains exact B-Rep transforms; Manifold provides approximate mesh
transforms, with no automatic fallback between them. Imported members retain
the verified-resource and strong exact single-solid B-Rep requirement. A third
evaluates outputs that directly reference a part whose geometry is one
supported solid DAG root or one admitted body set. It preserves detached part
metadata and effective material/density provenance through an explicit
single-solid/body-set result union. The staged facade now constructs that exact
part boundary, including typed material definitions, part metadata, explicit
density, and named material substitution.

A fourth geometry operation, `evaluateLocalAssemblyOutputsV7(...)`, evaluates
selected outputs whose acyclic nested instances reference local parts or local
assemblies. Iterative expansion emits active part leaves in authored
depth-first order with full root-to-leaf occurrence paths. Every containing
assembly's effective configuration controls its definition-scoped suppression
and placement expressions; each edge then selects an inherited, base, or named
child context, and caller parameter overrides apply in every context.
Placements compose parent first into root-relative transforms. One part result
is reused per effective `(part, configuration)` state, and solid-DAG
acquisition is deduplicated by node within each configuration batch, without
collapsing occurrences, multibody memberships, or contextual BOM rows.
Aggregate mesh/STL/OBJ remains approximate/lossy, while physical mass composes
each occurrence's effective density and placement. Suppressed assembly edges
prune their full subtree; active external components fail before resource
resolution or kernel work. Nesting and retained identity are bounded by
`maxAssemblyDepth` and `maxOccurrencePathSegments`. Solid nodes, transform
dependency links, and authored transform operations are independently bounded
by `maxSolidGraphNodes`, `maxSolidDependencyLinks`, and
`maxTransformOperations`; assembly evaluation charges them globally by
`(node, effective configuration)` across the active tree.

A separate source-only operation, `evaluateDatumNodesV7(...)`, resolves
selected datum node IDs without a geometry kernel. Parameter values follow
base, selected-configuration, then caller-override precedence. Points retain
their resolved position; axes normalize their direction; planes and coordinate
systems return deterministic orthonormal right-handed frames. Direction inputs
must be finite and nonzero, and normalized authored direction pairs must be
orthogonal within a fixed absolute dot-product threshold of `1e-12` before
deterministic re-orthonormalization. Selected-node and parameter-override work
is bounded, document limits and cancellation are honored, and failures remain
structured diagnostics. This resolver does not make datums design outputs or
connect them to sketches or kernel geometry.

The staged body-set result supports per-body mesh and measurement, plus
capability-gated topology and native single-body export. Aggregate mesh, STL,
and OBJ are explicitly approximate/lossy. A containing part can now supply one
uniform density and additive independent-body physical-mass semantics, with
aliases and overlaps counted per authored membership, plus a one-row BOM.
Those numeric properties inherit backend measurement quality. Bare body sets
still have no aggregate mass; exact aggregate STEP/BREP, aggregate geometric
measurement or topology, Boolean composition, external occurrence evaluation,
healing, and location I/O remain unsupported. Local-assembly exact aggregate
export, aggregate geometric measurement or topology, cyclic graphs, mates,
motion, and interference/collision are also unsupported. `mediaType` remains
committed provenance pending a versioned format-to-media-type policy. The
facade still excludes external occurrences, datum-backed sketches, transforms
over body sets/parts/assemblies, other body-consuming operations, per-body
materials, and general solid graphs beyond primitive/import/transform DAGs,
including generic solid and direct primitive outputs. These are
correctness-tested design inputs for Milestone 1, not public authoring or
evaluation capabilities. No root export, package subpath, or CLI surface was
added; the public document alias and migration target remain v6.

The staged v7 text parser rejects duplicate decoded JSON object members,
including escape-equivalent names, and applies structural and nesting ceilings
to raw values even when native last-key-wins parsing would discard them.
Detached-value and direct-schema boundaries cannot reconstruct member
occurrences already collapsed by another parser. Its raw UTF-8 ceiling now
stops without constructing a complete encoded buffer or reaching JSON parsing,
while preserving `TextEncoder` byte semantics for admitted text. Staged v7
serialization separately counts the topology-normalized compact or pretty
canonical representation before constructing its complete canonical object
tree, JSON text, or UTF-8 buffer; staged cloning enforces the same compact byte
ceiling without serializing. The three repository-staged direct schemas expose
only frozen parse, codec, async, and Standard Schema facades over private Zod
schemas; arbitrary Zod composition is not presented as an untrusted-runtime
boundary. Commutative v7 topology queries use locale-independent UTF-16
code-unit ordering without changing the frozen v1-v6 comparator path. These
boundaries remain internal and do not promote v7 or change the public v6 alias
and migration target.

## Development rules

Every product feature must be a complete vertical slice. It is not done until
it has:

1. Canonical document IR and migration behavior.
2. Type-safe authoring APIs and a usable modeling workflow.
3. Validation and structured, actionable diagnostics.
4. Explicit backend capability and conversion-loss behavior.
5. Ownership, cleanup, cancellation, and resource-limit behavior.
6. Topology/history semantics, including honest partial or ambiguous cases.
7. Hash, impact, configuration, and suppression semantics.
8. Node and browser tests, including failure and cleanup paths.
9. Measured time, memory, artifact-size, and native-handle budgets.
10. A realistic documented reference model.

OCCT is the authoritative exact-mechanical backend. Manifold is the fast
mesh/preview backend. The project will not claim parity when a backend cannot
preserve the exact feature semantics.

## Milestone 0 — product and API reset

**Status: Completed in 0.1.1**

The goal is to turn the current infrastructure-heavy foundation into a
measurable product program.

### Outcomes

- Keep private artifact/cache research frozen except for security, correctness,
  dependency, and release-maintenance fixes.
- Define a small application-facing API and assign compatibility schemas,
  conformance protocols, kernel adapters, and future domain APIs to deliberate
  subpaths or packages.
- Add public API-diff reporting before expanding the already large export
  surface.
- Establish a small executable reference corpus for workflows the public API
  supports today: a parameterized electronics enclosure, bolted flange, and
  hollow stepped shaft.
- Define the larger acceptance models at the milestones that make them
  executable: the production enclosure, shaft/flange, and pipe manifold in
  Milestone 2; imported STEP repair in Milestone 3; a mated gearbox in
  Milestone 4; and associative drawing and sheet-metal models in Milestone 5.
- Benchmark schema v2 runs every executable reference model in a dedicated
  process, distinguishes a fresh-runtime first run from same-runtime repeats,
  reports process-wide high-water memory with exact caveats, records native
  handle telemetry as unsupported until a real kernel protocol exists, and
  captures tessellation and output sizes without universal timing thresholds.
- Gate the explicit canonical documentation matrix in
  `examples/docs/manifest.json`: portable parametric evaluation and STL;
  sketch/extrude with default and exact evaluation plus STEP; fixed assemblies,
  named configurations, suppression, material overrides, and BOMs; document
  migration, canonicalization, parsing, and hashing; exact persistent-topology
  capture, resolution, and explanation; and structured document-limit
  diagnostics. Other feature-level snippets remain illustrative rather than
  being mislabeled as standalone executable programs.
- Raise checked coverage floors toward demonstrated coverage without treating
  100% line coverage as a substitute for realistic models.

### Exit gate

The public API tiers, reference corpus, benchmark format, and Document v7 design
are reviewed and executable in CI. New feature work is evaluated against those
artifacts.

## Milestone 1 — composable product documents

**Status: In progress**

This milestone introduces the algebra and resource graph needed by nearly every
later CAD domain.

### Document and geometry outcomes

- Datum points, axes, planes, and coordinate systems.
- First-class curves, wires, faces, shells, solids, compounds, and body sets.
- Multibody parts with explicit active bodies and result-body semantics.
- Content-addressed external resources with digest, media type, units, import
  policy, healing policy, and optional location hint.
- A caller-supplied resource resolver whose admitted bytes participate in
  effective evaluation identity.
- Serializable imported-body nodes rather than kernel-only import calls.
- External component-document references.
- Stable occurrence identity and per-occurrence configuration selection.
- Deterministic v1–v6 to v7 migration with no silent topology-protocol upgrade.

### Runtime outcomes

- A supported distribution decision for the owned OCCT runtime after legal,
  security, provenance, and release review.
- The conditionally selected industrial sketch-solver path: an
  InvariantCAD-owned, maintained PlaneGCS fork and replaceable runtime. Direct
  shipping of `@salusoft89/planegcs` remains rejected until the
  [solver promotion gates](/engineering/sketch-solver-evaluation#promotion-gates)
  pass.
- A minimal diagnostic viewer for geometry, topology, diagnostics, and
  selector inspection.

### Exit gate

An imported exact body and a native multibody design can be authored,
serialized, migrated, evaluated, inspected, and exported without escaping the
document model. Their identities and resource inputs are reproducible.

The repository-only facade and staged evaluators now exercise that workflow for
direct imported bodies, bounded primitive/import/transform body sets, and
directly authored typed parts and material intent over those geometries,
including acyclic nested local fixed-placement assemblies and real Manifold and
stock-OCCT acceptance paths. The milestone remains in progress because this
evidence is source-only and does not yet cover public v7 promotion, external
product documents/components, datum-backed modeling, Boolean/body-consuming
composition, or the wider shape algebra.

## Milestone 2 — everyday part modeling

**Status: Planned after Milestone 1**

The goal is to make ordinary mechanical parts productive rather than merely
possible.

### Sketching

- Arbitrary datum-plane sketching.
- Construction, projected, and external geometry.
- Slots, ellipses, conics, Bézier curves, and B-splines.
- Trim, extend, split, offset, mirror, and linear/circular sketch patterns.
- An industrial solver with conflict sets, redundancy explanations, stable
  degrees of freedom, drag solving, deterministic diagnostics, and bounded
  large-sketch behavior.

### Part features

- Pad/pocket and symmetric, two-sided, through-all, and up-to-reference end
  conditions.
- Hole, counterbore, countersink, and thread metadata with versioned standards
  data rather than untyped labels.
- Ribs, webs, bosses, grooves, slots, and draft variants.
- Linear, circular, and geometry-driven feature patterns and mirrors.
- Feature suppression and configuration-controlled feature parameters.
- Split bodies, body consume/retain rules, and multibody Booleans.
- Improved fillet, chamfer, shell, offset, sweep, and loft variants where exact
  backend support is sound.
- Selection tools that create semantic, explainable references instead of
  exposing raw enumeration indices.

### Developer workflow

- Project configuration plus `build`, `watch`, validate, inspect, export, and
  configuration-matrix workflows for TypeScript models.
- Reusable typed modeling modules without mutating canonical documents.
- Reference models for the enclosure, shaft/flange, and pipe manifold.

### Exit gate

The reference parts build entirely through public APIs on supported runtimes,
retain named downstream references across tested parameter changes, and have
documented capability losses on non-exact backends.

## Milestone 3 — surfacing, repair, and direct modeling

**Status: Planned after Milestone 2**

- Full curve and NURBS surface authoring.
- Surface loft, sweep, fill, boundary, trim, extend, intersect, sew, heal, and
  thicken operations.
- Shell-to-solid conversion with explicit validity and tolerance diagnostics.
- Move, rotate, offset, replace, delete, split, and imprint face operations.
- Push/pull, defeaturing, and bounded feature recognition.
- Imported STEP/BREP edit and repair workflows with source fingerprints,
  declared units, healing logs, and explicit exact/mesh losses.
- IGES, 3MF, glTF/GLB, and supported mesh import/export.
- Document auto-diff plus separate geometric, mesh, and B-Rep comparison APIs.

### Exit gate

The imported-body reference model can be diagnosed, repaired, directly edited,
compared, and re-exported while preserving every identity claim that can
actually be proved and reporting the rest as changed or ambiguous.

## Milestone 4 — assemblies and production viewer

**Status: Planned after Milestones 1–3**

### Product structure and solving

- External component libraries and scalable occurrence graphs.
- An industrial assembly mate/joint solver behind a versioned protocol.
- Fixed, coincident, concentric, planar, cylindrical, distance, angle,
  revolute, slider, gear, rack, and screw relations.
- Grounded components, subassembly solving, limits, drivers, degrees of
  freedom, motion studies, and deterministic conflict diagnostics.
- Effectivity, rule-driven variants, alternates/substitutes, and scalable BOM
  and occurrence queries.
- Minimum-distance, clearance, interference, contact, and swept-envelope
  analysis using semantic occurrence references.
- Exact assembly STEP import/export that preserves supported product structure,
  placements, names, colors, and metadata.

### Viewer

- Framework-neutral rendering core with maintained web adapters.
- Face/edge/vertex picking mapped to topology keys and authorable selectors,
  never durable triangle or array indices.
- Feature and assembly trees, hover/highlight, visibility, transparency,
  measurements, section views, exploded views, and diagnostics.
- Live parameter/configuration editing with explicit rebuild state.
- LOD, instancing, culling, worker evaluation, bounded GPU/WASM ownership, and
  large-assembly tests.

### Exit gate

The gearbox assembly reference model solves, reports remaining DOF, produces a
BOM and interference report, round-trips through supported exact assembly
exchange, and remains usable in the production viewer within published budgets.

## Milestone 5 — drawings, PMI, and sheet metal

**Status: Planned after Milestone 4**

### Drawings and product definition

- Associative drawing documents and projected, auxiliary, section, and detail
  views.
- Dimensions, tolerances, datum features, GD&T, notes, tables, BOM balloons,
  title blocks, and revision metadata tied to persistent design intent.
- Deterministic SVG, DXF, and PDF output with an explicit layout and font
  policy.
- STEP AP242 PMI support where the selected translator can preserve the
  authored semantics; unsupported constructs must report loss.

### Sheet metal

- Sheet-metal bodies, walls, flanges, bends, hems, seams, jogs, and reliefs.
- Bend allowances/deductions, K-factor and bend-table policies.
- Rip, unfold/refold, corner treatment, and validated flat patterns.
- DXF flat-pattern output with bend, cut, and annotation layers.

### Exit gate

The drawing and sheet-metal reference models rebuild associatively after
parameter changes, produce deterministic manufacturing outputs, and preserve
or explicitly report every unsupported PMI/exchange semantic.

## Milestone 6 — manufacturing and engineering adapters

**Status: Planned after the relevant modeling domains**

InvariantCAD owns typed documents, provenance, units, and adapter contracts. It
does not pretend that one TypeScript implementation replaces established CAM
and simulation engines.

### Manufacturing

- DFM checks, wall-thickness and draft analysis, and additive orientation,
  support, overhang, and mesh-repair workflows.
- 3MF manufacturing exchange.
- CAM stock, work coordinate systems, setups, tools, holders, operations,
  feeds/speeds, and toolpaths.
- Versioned postprocessor and simulation adapters with collision evidence and
  machine/tool provenance.

### Engineering analysis

- Solver-neutral materials beyond density, loads, fixtures, contacts, mesh
  controls, cases, and result provenance.
- Surface and volume meshing adapters with geometry association, quality
  metrics, convergence data, and adaptive refinement.
- Initial static structural, modal, thermal, and thermal-stress integrations.
- Bounded result datasets, unit-safe comparisons, derived quantities, and
  viewer overlays.

### Exit gate

At least one maintained first-party adapter per advertised workflow passes a
public conformance kit. Results identify all geometry, solver, material, mesh,
and configuration inputs needed to reproduce them.

## Milestone 7 — scale, extensions, and 1.0

**Status: Planned after the product workflows are complete**

- Incremental DAG evaluation with explicit invalidation explanations.
- Production artifact caching only after the separate promotion gates pass.
- Bounded parallel evaluation, worker/process isolation where hard
  cancellation is promised, and deterministic cleanup after failure.
- Streaming exchange, configurable memory ceilings, and leak-tested
  long-running evaluators and viewer sessions.
- Release-gated Node, Chromium, Firefox, WebKit, Web Worker, and supported
  server deployments. Deno, Bun, shared-memory WASM, and WebGPU are advertised
  only after dedicated gates exist.
- Plugin contracts derived from working first-party kernels, solvers,
  translators, renderers, analysis engines, CAM strategies, and
  postprocessors—never speculative extension points.
- Conformance suites, security boundaries, manifests, and lifecycle rules for
  third-party extensions.

## 1.0 release criteria

InvariantCAD 1.0 is the stable general-purpose mechanical CAD platform, not the
end of every domain roadmap. It requires:

- Stable document/API/versioning policies and an intentionally curated public
  surface.
- Productive exact part, multibody, surfacing, import/repair, and assembly
  workflows.
- Industrial sketch and assembly solver integrations.
- Robust persistent topology over the published reference and torture suites,
  preserving ambiguity whenever identity cannot be proved.
- Exact and mesh backends with documented capability and conversion-loss
  behavior.
- A production viewer and supported Node, browser, worker, and server
  deployment boundaries.
- Associative drawings, PMI/GD&T foundations, and productive sheet-metal
  workflows.
- Exact part and assembly exchange for advertised formats.
- Reproducible packages, SBOMs, license notices, security policy, reviewed
  native/WASM distribution, published performance budgets, and long-running
  leak gates.
- Complete task-oriented documentation, API references, examples, upgrade
  guides, support matrices, and conformance kits.

CAM and CAE breadth do not block 1.0 when their typed integration contracts and
at least one credible first-party path are established. Continued solver,
translator, manufacturing, and analysis coverage can then evolve without
destabilizing the mechanical CAD core.

## Deferred or explicitly separate work

- Public distribution of the owned OCCT facade remains deferred pending
  external legal, security, provenance, and release review.
- Transparent Manifold artifacts remain deferred until a backend-owned codec
  preserves evaluator-visible geometry and semantics; Float32 mesh
  reconstruction is insufficient.
- Perfectly symmetric or coincident subshape identity remains ambiguous unless
  durable evidence can prove a unique match.
- Hosted collaboration, accounts, cloud execution, marketplaces, and PDM/PLM
  services may use InvariantCAD but are not prerequisites for the open-source
  CAD library.
- Proprietary translators or solvers require their owners' SDK and
  redistribution terms; the project will not simulate support with lossy
  placeholders.
- Generative tools may author ordinary documents, but probabilistic output does
  not weaken validation, capability, ownership, topology, or determinism
  guarantees.

## Protocol boundaries that remain true

Topology keys and native ABI indices are evaluation-scoped. Documents persist
selector intent and detached evidence, never native shapes or resolved runtime
keys. Document migration does not silently upgrade stored topology protocols,
descriptor fingerprints, or evidence.

Authored impact is not a field-level document diff. Feature hashes identify
admitted intent, not geometric equality or a complete cache key. Artifact-cache
records, semantic observations, and bounded conformance audits are separate
claims; none alone certifies compatibility or enables caching.

Exact native evolution proves one evaluation's history. It does not make a
native index persistent across edits. Whenever multiple candidates satisfy the
same durable evidence, resolution remains ambiguous rather than selecting an
enumeration-dependent winner.
