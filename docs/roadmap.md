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
protocol v2 are also staged internally. They are correctness-tested design
inputs for Milestone 1, but they are not public authoring or evaluation
capabilities. The public document alias and migration target remain v6.

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

## Milestone 1 — Document v7 modeling foundation

**Status: Next**

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
