# InvariantCAD

Comprehensive, type-safe CAD-as-code for TypeScript.

InvariantCAD represents a design as immutable, versioned JSON and evaluates it through replaceable geometry and sketch-solver backends. The public API never exposes WASM pointers or kernel-specific objects.

> **Project status:** `0.1.0` is the released-foundation target. Current main adds named definition-scoped configurations and variant-aware BOMs, an exact OpenCascade B-Rep backend, analytic sketch-profile transfer, STEP/BREP exchange, bounded ruled solid lofts, explicit 3D polyline, circular-arc, and ordered line/arc composite paths with bounded exact solid sweeps, closed semantic topology roles through those bounded sweeps, sketch-boundary provenance, document-owned persistent face/edge selectors, exact selector-driven fillets and equal-distance chamfers, exact face-selected inward/outward shells, exact whole-solid inward/outward offsets, atomic semantic-face draft, and owned exact multi-input Boolean, fillet/chamfer, and shell/offset evolution when the matched InvariantCAD-owned OCCT facade is loaded. Complete topology history outside those owned feature slices is still under active development; see the [support matrix](#support-matrix) and [roadmap](docs/roadmap.md).

## Install

```bash
pnpm add invariantcad
```

Node.js 20.19 or newer is required. The core API is ESM and also targets modern browsers.

The npm package contains the TypeScript API and declares stock `occt-wasm` as a
dependency; it does not contain the InvariantCAD-owned facade runtime or its
local compliance bundle. No facade bundle has been published to npm yet, and
InvariantCAD never downloads one implicitly.

## Quick start

```ts
import {
  createEvaluator,
  design,
  mm,
  plane,
  vec2,
  vec3,
} from "invariantcad";

const cad = design("mounting-plate");

const width = cad.parameter.length("width", mm(80), { min: mm(1) });
const height = cad.parameter.length("height", mm(50), { min: mm(1) });
const thickness = cad.parameter.length("thickness", mm(6), { min: mm(1) });
const holeRadius = cad.parameter.length("holeRadius", mm(4));

const profile = cad.sketch("plate-profile", plane.xy(), (sketch) => {
  const outline = sketch.rectangle("outline", { width, height });
  const hole = sketch.circle("hole", {
    center: vec2(width.mul(0.25), mm(0)),
    radius: holeRadius,
  });

  return sketch.profile(outline, { holes: [hole.loop()] });
});

const solid = cad.extrude("plate-solid", profile, {
  distance: thickness,
  symmetric: true,
});
const part = cad.part("plate", solid, { partNumber: "PLATE-001" });
cad.output("plate", part);

const document = cad.build();
const evaluator = await createEvaluator();
const result = await evaluator.evaluate(document, {
  parameters: { width: 100 }, // base length unit is millimetres
});

if (!result.ok) {
  console.error(result.diagnostics);
} else {
  try {
    const plate = result.value.output("plate");
    console.log(plate.measure());

    const stl = plate.export("stl");
    // `stl` is a Uint8Array ready for a file, response, or object store.
  } finally {
    result.value.dispose();
  }
}

evaluator.dispose();
```

Every feature, entity, constraint, parameter, instance, output, and stored topology reference has an explicit stable ID. Those IDs are the basis for reproducible diffs, diagnostics, and durable design intent.

### Exact B-Rep evaluation

Use the OCCT backend when the result must retain exact analytic geometry or be exported through STEP/BREP:

```ts
import { createEvaluator } from "invariantcad";
import { createOcctKernel } from "invariantcad/kernels/occt";

const evaluator = await createEvaluator({
  kernel: await createOcctKernel(),
});

const result = await evaluator.evaluate(document);
if (result.ok) {
  try {
    const step = result.value.output("plate").export("step");
    // Uint8Array containing an ISO-10303-21 STEP file.
  } finally {
    result.value.dispose();
  }
}
evaluator.dispose();
```

The backend is explicitly selected; a design document never contains OCCT handles or backend-specific objects. The default `createOcctKernel()` loads stock `occt-wasm` and supports the exact geometry features listed below except draft, but its Boolean, fillet/chamfer, and shell/offset topology history is partial. Draft, complete exact multi-input Boolean, fillet/chamfer, and shell/offset evolution, plus the stronger major multi-arc/eccentric-profile composite guarantees, are advertised only when `moduleFactory` loads the matched InvariantCAD-owned facade ABI 0.6 build; `wasm` is an optional explicit binary override for environments where that factory cannot locate its sibling binary. The repository can turn that local build into a verified, package-neutral bundle, but applications must still supply its runtime explicitly. See [Browser initialization](#browser-initialization).

### Exact path sweeps

Paths are first-class parameterized nodes rather than closed sketch profiles:

```ts
const section = cad.sketch("section", plane.yz(), (sketch) =>
  sketch.profile(
    sketch.rectangle("outline", { width: mm(2), height: mm(2) }),
  ),
);
const spine = cad.polylinePath("spine", [
  vec3(mm(0), mm(0), mm(0)),
  vec3(mm(5), mm(0), mm(0)),
  vec3(mm(5), mm(5), mm(0)),
]);
const swept = cad.sweep("swept", section, spine);
```

An exact circular bend uses a point on the desired arc rather than an ambiguous control point:

```ts
const bend = cad.circularArcPath("bend", {
  start: vec3(mm(0), mm(0), mm(0)),
  through: vec3(
    mm(10 / Math.sqrt(2)),
    mm(10 - 10 / Math.sqrt(2)),
    mm(0),
  ),
  end: vec3(mm(10), mm(10), mm(0)),
});
const curved = cad.sweep("curved", section, bend);
```

An ordered exact route mixes lines and circular arcs without repeating joint coordinates:

```ts
const route = cad.compositePath("route", {
  start: vec3(mm(0), mm(0), mm(0)),
  segments: [
    { kind: "line", end: vec3(mm(5), mm(0), mm(0)) },
    {
      kind: "circularArc",
      through: vec3(mm(5 + 5 / Math.sqrt(2)), mm(5 - 5 / Math.sqrt(2)), mm(0)),
      end: vec3(mm(10), mm(5), mm(0)),
    },
    { kind: "line", end: vec3(mm(10), mm(10), mm(0)) },
  ],
});
const routed = cad.sweep("routed", section, route);
```

The current document grammar requires an open, simple sweep path; a closed, hole-free profile seated at its start; an initial tangent parallel to the profile-plane normal in either direction; corrected-Frenet transport; and conservative profile clearance. Polyline paths reject repeated or redundant collinear vertices and use right-corner intersections. Circular-arc paths are one exact three-point arc below a full turn and require their circumradius to exceed the complete profile envelope. Composite paths contain at least two structurally connected segments and at least one arc. Junctions touching an arc must be forward G1 tangent, while line-line junctions retain right-corner semantics. Minor, major, and certified near-full composite arcs are supported without an artificial endpoint-chord rule. Adjacent segments exclude only their curvature-bounded intrinsic neighborhood, then recursively certify every remote line/arc parameter domain against path tolerance and the full profile diameter; redundant adjacent segments, actual remote returns, and numerical ambiguity fail explicitly. The OCCT adapter realizes the one-edge circular case as an exact revolution about the resolved circle axis. Ordered composites use one exact PipeShell wire. Every composite arc must exceed the profile-envelope radius and pass the `3e-8` three-point conditioning floor. Every PipeShell profile/path edge and all three authored point-pair separations of a composite arc must exceed the native `1e-4 mm` transfer floor.

Stock PipeShell does not expose its angular tolerance, so stock OCCT admits a major-arc composite only when it contains one circular-arc segment and the seated profile area centroid is centered within the selected tolerance. InvariantCAD derives that requirement before backend invocation with exact, kernel-neutral line/arc/circle area moments, compensated error bounds, and a strict major threshold of `π + 1e-12`; an admitted authored profile-origin mismatch is not mistaken for section eccentricity. Those analytic local moments—not OCCT's world-coordinate integration—also define circular and composite sweep volume. OCCT independently remeasures the constructed profile face and must agree within bounds derived from analytic roundoff, profile perimeter/radius, modeling tolerance, and per-axis coordinate ULPs; disagreement fails before path or result allocation with structured diagnostics. Circular transfer also derives a native-face volume around the actual rounded revolution axis before constructing the solid and requires it to remain inside the same certified representability envelope. Relative profile-centroid and arc-center offsets avoid add-large/subtract-large cancellation at representable world translations. Owned facade ABI 0.3 introduced a corrected-Frenet/right-corner PipeShell with explicit linear, boundary, and `1e-9` angular tolerances, bounded OCCT surface error, and transactional transfer; the current ABI 0.6 retains that contract. It certifies major multi-arc and eccentric-profile composites and advertises those guarantees as versioned refinements. Every composite result is also checked against an exact transported-centroid volume oracle covering lines, arcs, and supported RightCorner miters; ill-conditioned cancellation fails closed. Guided, variable-section, full-circle, Bézier, B-spline, and helix paths remain explicit future contracts.

### Semantic topology, Booleans, fillets, chamfers, shells, offsets, and draft

Topology selections describe intent as set queries. They never persist a face index, edge index, OCCT handle, or transient hash. This source-aware selector keeps identifying the same extrusion rim after a 90-degree rotation and across width/height parameter crossovers:

```ts
import {
  angleVec3,
  deg,
  design,
  explainTopologySelection,
  mm,
  plane,
  scalarVec3,
  tf,
  topology,
  vec3,
} from "invariantcad";

const cad = design("source-stable-fillet");
const width = cad.parameter.length("width", mm(40));
const height = cad.parameter.length("height", mm(20));
const profile = cad.sketch("profile", plane.xy(), (sketch) =>
  sketch.profile(
    sketch.rectangle("outline", { width, height }),
  ),
);
const extrusion = cad.extrude("extrusion", profile, {
  distance: mm(10),
});
const moved = cad.transform("moved", extrusion, [
  tf.rotate(angleVec3(deg(0), deg(0), deg(90))),
  tf.translate(vec3(mm(100), mm(5), mm(7))),
]);

const rightEndRim = topology.edges
  .createdBy(extrusion, {
    role: "extrude.edge.end-rim",
    source: { sketch: profile, entity: "outline.e1" },
  })
  .and(topology.edges.modifiedBy(moved))
  .select(); // exactly one edge

const rounded = cad.fillet("rounded", moved, {
  edges: rightEndRim,
  radius: mm(2),
});
cad.output("rounded", rounded);

const beveled = cad.chamfer("beveled", moved, {
  edges: rightEndRim,
  distance: mm(2),
});
cad.output("beveled", beveled);

const openEnd = topology.faces
  .createdBy(extrusion, { role: "extrude.face.end-cap" })
  .and(topology.faces.modifiedBy(moved))
  .select();

const hollow = cad.shell("hollow", moved, {
  openings: openEnd,
  thickness: mm(2),
  direction: "inward",
  tolerance: mm(1e-6),
});
cad.output("hollow", hollow);

const expanded = cad.offset("expanded", moved, {
  distance: mm(1),
  direction: "outward",
  tolerance: mm(1e-6),
});
cad.output("expanded", expanded);

const draftedSide = topology.faces
  .createdBy(extrusion, {
    role: "extrude.face.side",
    source: { sketch: profile, entity: "outline.e1" },
  })
  .and(topology.faces.modifiedBy(moved))
  .select();

const drafted = cad.draft("drafted", moved, {
  faces: draftedSide,
  angle: deg(3),
  pullDirection: scalarVec3(0, 0, 1),
  neutralPlane: {
    origin: vec3(mm(100), mm(5), mm(7)),
    normal: scalarVec3(0, 0, 1),
  },
});
cad.output("drafted", drafted);
```

The current chamfer mode applies one constant, equal setback distance on both incident faces. That produces a 45-degree bevel where the faces are orthogonal. Distance-angle, asymmetric, and variable chamfers are not supported yet.

For both fillets and chamfers, `edges` selects contour seeds rather than hard stopping boundaries. Each seed expands to the maximal connected contour of tangent edges that continues between tangent face chains on both sides. A closed tangent contour expands around the complete loop, and multiple seeds on the same contour apply the operation only once. Selector cardinality constrains the seed set, not the number of input edges ultimately modified. Before native execution, InvariantCAD deduplicates the seed set and orders it by the input snapshot's edge index. ABI 0.5 echoes that exact canonical seed list, admits the first seed for each not-yet-covered tangent contour, records later overlapping seeds as skipped, and builds all admitted contours in one operation. Expansion stops at sharp, disconnected, degenerate, non-manifold, boundary, or ambiguous junctions. Continuity at a modeling-tolerance boundary can remain kernel-dependent; this mode cannot yet express “stop at this otherwise tangent vertex.”

Shell openings deliberately use different semantics: `openings` is the exact set of input faces passed to the shell maker's removal list. Selected faces are not tangent-contour seeds, and the operation never propagates the selection to an adjacent tangent or coplanar face. Selector cardinality therefore describes the actual opening-face set passed to the kernel. Selection does not force a `DELETED` topology record: the pinned maker may report a selected source face as `MODIFIED` into the planar opening rim.

Shell `thickness` is always a positive wall-thickness magnitude. `direction: "inward"` keeps the unselected input boundary as the exterior skin and offsets the second wall into the solid; `direction: "outward"` keeps it as the interior skin and builds the second wall outside it. The current document grammar fixes offset-face transitions to round/arc joins; intersection/miter joins are not supported yet. The builder defaults direction to `"inward"` and reconstruction tolerance to `mm(1e-6)`, then materializes both values in the immutable document so serialization and semantic hashes include them. Thickness and tolerance must be positive, and tolerance must be less than thickness.

The current shell mode accepts exactly one solid with no loose faces, edges, or vertices, at least one selected opening face, and at least one retained face. It produces one valid positive-volume solid or a structured kernel diagnostic; it does not apply independently to disconnected bodies. Closed hollowing without an opening and variable-thickness shells are not supported yet.

Whole-solid `offset` uses a positive `distance` magnitude plus an explicit `direction`. `"outward"` adds material outside the oriented boundary; `"inward"` removes material inside it. The builder defaults to `"outward"` and `mm(1e-6)` tolerance and materializes both in the document. The current document grammar fixes round/arc joins: an outward box offset therefore contains cylindrical edge transitions and spherical corner transitions rather than an intersection/mitered box. Distance and tolerance must be positive, and tolerance must be less than distance.

Offset accepts exactly one valid positive-volume solid with no loose lower-dimensional topology and must return the same. Invalid, collapsed, disconnected, and direction-inconsistent results fail explicitly. It is a 3D body operation; 2D wire/profile offsets will use a separate future contract.

Draft applies the selected input faces atomically: either every face is staged into one native operation or no result is exposed. Its angle is signed and must satisfy `1e-4 < Math.abs(angleRadians) < Math.PI / 2`; the pull direction and neutral-plane normal must be nonzero. Pull direction and neutral plane are independent inputs, so neither vector is inferred from or rescaled to the other. The neutral plane is defined by its explicit origin and normal, and its intersection with the drafted faces remains fixed.

The matched owned OCCT facade proves a complete one-to-one face/edge/vertex evolution for every successful draft before transferring the result. That feature-scoped `exactIndexedTopologyEvolution` v1 guarantee lets later face/edge queries retain inherited `createdBy(...)` lineage and identify changed topology with `modifiedBy(drafted)` without exposing native indices. It does not change the backend's global topology-provenance declaration, which remains `feature` because other topology-changing features still have partial history.

Owned facade ABI 0.4 extends that version-1 envelope to every successful union, subtraction, and intersection, including multiple tools. Source shape `0` is the authored target and sources `1..N` are the authored tools in order. Union and intersection apply each tool sequentially in that order; subtraction is one cut of the target against the complete authored tool set. The report must prove complete face/edge/vertex coverage for every input and the aggregate result before ownership transfers. `PRESERVED` and `MODIFIED` are same-kind identity links, `GENERATED` is an exact causal link that may change topology kind, and `DELETED` terminates an input subshape with the `NONE/-1` result sentinel only when that source has no final identity successor. Generated links may coexist with identity or deletion records, but do not replace the required identity-successor-or-deletion proof for their source. The facade retains every available native preserved, modified, and generated claim before classifying any residual result topology. OCCT can create higher-order topology through interactions among multiple tools without assigning it to one operand; those otherwise-unclaimed result items use source-less `CREATED` with the exact `-1/NONE/-1` source sentinel. A created result cannot also carry an operand claim.

Owned facade ABI 0.5 retains the ABI 0.4 Boolean contract and applies the same complete version-1 relation graph to constant-radius fillets and equal-distance chamfers. Edge treatments have one input source, but their report still proves every input and result face, edge, and vertex: each source has an identity successor or `DELETED`, every available `GENERATED` cause is retained, and only otherwise-unclaimed result topology receives source-less `CREATED`. A direct solid or a nested one-child compound/compsolid wrapper around exactly one solid is accepted, which lets exact Boolean results feed edge treatments without admitting loose or multiple topology; successful output is normalized to the contained solid. Before constructing the operation, native code makes a deep independent B-Rep working copy of the input, including its curve and surface geometry, and proves one-to-one original/copy topology correspondence. Only that copy enters the fillet or chamfer builder, so the arena-owned input BREP remains byte-stable.

Owned facade ABI 0.6 retains every earlier surface and adds one transactional solid-offset operation for face-selected shell and whole-solid offset. Shell openings are deduplicated and sorted by input face index; native code echoes that canonical selection, while offset accepts no openings. Both modes use positive public magnitudes plus explicit inward/outward direction and tolerance, run one fixed-round-join builder against a deep independent copy of the sole valid input solid, and leave the authored arena BREP byte-stable. The report owns one validated positive-volume single-solid result and a complete version-1 graph over the input and result faces, edges, and vertices until a same-kernel one-shot transfer.

The pinned offset engine can expose a replaced source only through `GENERATED` while its deletion query remains false. ABI 0.6 reconciles that generated-only replacement from final-result membership: when the source identity is absent and there is no native `Modified` successor, it records the exact terminal deletion while preserving every generated cause. This makes the identity-successor-or-deletion rule complete without guessing from geometry. Conversely, a selected shell opening may have a real modified identity successor at the planar rim, so selection itself is never treated as proof of deletion.

Public semantic lineage is intentionally stricter than causal history. Only `PRESERVED` and `MODIFIED` identity predecessors inherit earlier lineage, roles, and sketch sources. A `GENERATED` link never copies a source role onto a new subshape; a result with only generated causes or a source-less `CREATED` record is recorded only as `createdBy(currentFeature)`. An identity successor keeps its proven earlier lineage and gains `modifiedBy(currentFeature)` only when an identity link is modified. The rule applies equally to ABI 0.4 Booleans, ABI 0.5 fillets/chamfers, and ABI 0.6 shells/offsets. These native indices and all public topology keys remain evaluation-scoped plumbing, never persistent document identity.

Exact Boolean evolution is an optional capability. The evaluator validates and uses it when a backend advertises it, but absence does not block the ordinary Boolean feature: stock OCCT and owned ABI 0.2/0.3 remain compatible with partial Boolean history, while Manifold retains Boolean geometry without advertising topology snapshots or history. A malformed advertised envelope or a failed completeness proof is authoritative and fails closed instead of downgrading. ABI 0.4 makes a topology-independent working copy of every operand, shares its immutable geometry, and runs each native builder in non-destructive mode; the Boolean never receives an arena-owned TShape, so every authored target and tool BREP remains byte-stable across the operation. Copy-to-source topology correspondence is proved before history can succeed. The adapter copies, freezes, count-checks, and validates the complete report before its one-shot same-kernel transfer; an adoption failure rolls the transferred result back exactly once. `createOcctKernel({ maxExactBooleanHistoryRecords })` sets the caller-controlled record budget, defaults to `1_000_000`, passes it into the facade, and rejects an oversized report natively before report record materialization and again from its count before any indexed JavaScript copying. That option bounds history records only; operand working copies and OCCT's Boolean workspace still scale with the input topology. A legitimate empty Boolean result is representable by zero result counts and follows the normal evaluator `EMPTY_RESULT` / `allowEmpty` policy.

Exact fillet/chamfer evolution is independently optional. ABI 0.5 advertises `exactIndexedTopologyEvolution` v1 for `fillet` and `chamfer`; the evaluator validates that metadata before resolving the edge selector, but missing metadata or a well-formed declaration that omits the selected feature continues through the supported partial-history implementation. Stock OCCT and owned ABI 0.2–0.4 therefore retain their exact fillet/chamfer geometry without claiming complete provenance. A malformed advertised capability or exact report fails closed. The ABI 0.5 report owns its result until a `READY` same-kernel one-shot transfer; TypeScript copies, freezes, count-checks, and validates its diagnostics, canonical selected-edge echo, complete graph, and raw topology counts before transfer, then rolls back a transferred root exactly once if adoption or lineage reduction fails. `createOcctKernel({ maxExactEdgeTreatmentHistoryRecords })` provides a separate signed 32-bit record budget with the same `1_000_000` default and native-before-JavaScript enforcement. It does not share or consume the Boolean budget, and it bounds history records rather than the mandatory independent operand copy or OCCT builder workspace.

Exact shell/offset evolution is independently optional as well. ABI 0.6 advertises `exactIndexedTopologyEvolution` v1 for `shell` and `offset`; missing metadata or a well-formed feature omission preserves the stock or legacy owned exact-geometry path with explicit partial history. Malformed metadata fails before selector or kernel execution, while a malformed exact report is authoritative and fails before result exposure. TypeScript validates the operation, direction, amount, tolerance, canonical opening echo, build/status fields, topology counts, full graph, and `READY` transfer state, then rolls back exactly once if post-transfer validation or lineage reduction fails. `createOcctKernel({ maxExactSolidOffsetHistoryRecords })` provides its own signed 32-bit record budget with a `1_000_000` default and native-before-JavaScript enforcement. It is independent of both existing history budgets and does not bound the mandatory deep operand copy or OCCT shell/offset workspace.

The serialized role vocabulary is closed and exported through `TOPOLOGY_ROLES` and `TOPOLOGY_ROLE_RULES`:

| Producer | Stable face roles | Stable edge roles |
|---|---|---|
| Box | signed local faces such as `box.face.x-min` | unique face intersections such as `box.edge.x-min-y-min` |
| Cylinder or cone | start/end caps and side | start/end rims |
| Sphere | `sphere.face.surface` | none; seam and pole artifacts stay unnamed |
| Extrusion | start/end caps and source-aware sides | source-aware start/end rims and unsourced lateral edges |
| Revolution | source-aware swept faces; start/end caps for partial turns | none; every revolution edge and kernel artifact stays unnamed |
| Bounded ruled loft | source-free start/end caps and two-source ruled sides | source-aware section rims and source-free lateral edges for curves with authored endpoints; circular seams stay unnamed |
| Bounded sweep | source-free start/end caps and source-aware sides per profile curve and authored path segment | source-aware start/end rims and source-free laterals per authored non-circular profile start and path segment; path-joint fragments and circular seams stay unnamed |

`start` and `end` follow construction parameterization, not current world orientation. For a revolution, the axis is the profile plane's local v axis through its origin. Every boundary curve that produces a face can contribute one `revolve.face.swept` role carrying that curve's sketch-entity source. A line contained in the revolution axis collapses and intentionally contributes no swept face. Partial turns expose source-free `revolve.face.start-cap` and `revolve.face.end-cap` roles; a full turn has no cap faces or cap roles. Revolution edges, seams, poles, and other generated artifacts have no semantic role. If any constructed revolution-face seed has no unique result-face correspondence, the OCCT snapshot downgrades to partial history instead of attaching a possibly incorrect role. A topology-preserving transform retains the original role/source lineage and adds `modified` lineage for the transform. Cylinder seams, cone apex artifacts, sphere seams/poles, and other kernel artifacts are likewise deliberately unnamed so a document cannot accidentally depend on their enumeration.

For the current bounded ordered ruled loft, `loft.face.start-cap` and `loft.face.end-cap` name the first and last profile faces without a sketch-curve source. Each face ruled between matching curve indices on two adjacent profiles receives `loft.face.side`; when the resolved curves carry sketch-entity sources, both participating sources are recorded and querying either source can select that face. Every authored section curve contributes a `loft.edge.section-rim`, carrying a source when its resolved curve has one. Direct kernel calls may supply source-free resolved profiles: those shapes retain roles, but InvariantCAD never invents a sketch source. For each matching non-circular curve, the edge joining its authored starts across one adjacent profile pair receives source-free `loft.edge.lateral`; a circle has no authored boundary start, so its arbitrary kernel seam remains deliberately unnamed.

The five loft roles apply only to compatible, parallel-plane, hole-free ruled solids whose ordered curves have the same kind, orientation, and authored curve phase across every section. Cyclically rotating an otherwise equivalent loop changes that authored correspondence and is rejected instead of allowing OCCT to choose a different pairing. If construction of any semantic seed fails, a side or lateral correspondence is not unique, a seed cannot be mapped uniquely into the result, or the expected role inventory is incomplete, the snapshot is marked partial rather than treating an incomplete map as authoritative.

The bounded sweep contract has six role literals. Let `C` be the number of direct-profile boundary curves, `S` the number of authored path segments, and `V` the number of authored non-circular profile-curve starts. There is one source-free `sweep.face.start-cap` and one source-free `sweep.face.end-cap`; `sweep.face.side` has cardinality `C*S`; `sweep.edge.start-rim` and `sweep.edge.end-rim` each have cardinality `C`; and source-free `sweep.edge.lateral` has cardinality `V*S`. Sweep `start` and `end` follow the authored path direction, not world orientation. Each side, start rim, and end rim carries the optional sketch-curve source from its corresponding direct-profile curve. Caps and laterals carry no source, a direct source-free profile call invents none, and there is deliberately no path-segment source identity. Internal path-joint/right-corner miter fragments and arbitrary circular seams remain unnamed.

OCCT proves that inventory from the result's face-edge incidence graph: it anchors the authored start section, walks one uniquely corresponding side-face layer per path segment, finds one terminal cap and its rims, and checks curve-local lateral adjacency and complete role counts. A branch, gap, reused or ambiguous candidate, incomplete coverage, unexpected nonlocal mapping, or distant false correspondence downgrades the snapshot to partial history rather than publishing incomplete semantic naming.

Selectors also support curve/surface kind, edge direction, face normal, radius, adjacency, `and`/`or`/`not`, and explicit cardinality. Zero matches produce `TOPOLOGY_SELECTION_MISSING`; excess matches produce `TOPOLOGY_SELECTION_AMBIGUOUS`. The exact backend currently provides complete feature provenance for primitives, extrusions, revolutions, lofts, bounded sweeps whose graph proof succeeds, and topology-preserving transforms, plus the semantic roles and sketch sources above. The matched owned ABI 0.6 facade provides exact indexed evolution for draft, Boolean, fillet, chamfer, shell, and offset. Boolean history remains partial on stock/default OCCT and older owned ABIs; fillet/chamfer history remains partial on stock/default OCCT and owned ABIs 0.2–0.4; shell/offset history remains partial on stock/default OCCT and owned ABIs 0.2–0.5. Origin queries against any partial-history result fail with `TOPOLOGY_HISTORY_UNAVAILABLE` rather than choosing unstable topology, while geometry-only selectors can still inspect it. Manifold exposes none of these topology snapshots or selectors; Manifold and stock/default OCCT both report an explicit capability error for draft.

### Explain ordinary topology selections

`explainTopologySelection(...)` exposes the aggregate result of one ordinary face/edge selector pass without turning missing or ambiguous cardinality into a failed operation:

```ts
// Given a live evaluated solid from a topology-capable kernel:
const current = evaluatedSolid.topology();
if (!current.ok) throw new Error(current.diagnostics[0]?.message);

const selection = topology.faces.all().exactly(1);
const explainedSelection = explainTopologySelection(
  selection.ir,
  current.value,
  {
    // This `all` query contains no expressions, so evaluation is never called.
    evaluate: () => {
      throw new Error("Unexpected selector expression");
    },
  },
);
if (!explainedSelection.ok) {
  throw new Error(explainedSelection.diagnostics[0]?.message);
}

switch (explainedSelection.value.outcome) {
  case "resolved":
    console.log(explainedSelection.value.keys);
    break;
  case "missing":
  case "ambiguous":
    console.log(explainedSelection.value.candidatesMatched);
    break;
}
```

Topology-selection explanation version 1 is a deeply frozen discriminated union. Every completed report contains `version`, `topology`, `currentHistory`, `candidatesConsidered`, `candidatesMatched`, `minimumRequired`, and `maximumAllowed`; an omitted maximum is represented as `null`. `outcome` is `resolved`, `missing`, or `ambiguous`. Only `resolved` adds the sorted current evaluation-scoped `keys`; missing and ambiguous reports are key-free. Invalid selections, query inputs, snapshots, and any nested selection failure—including persistent-reference resolution—remain failed `CadResult`s rather than explanation outcomes.

`resolveTopologySelection(...)` keeps its legacy fail-closed return shape. Its `TOPOLOGY_SELECTION_MISSING` and `TOPOLOGY_SELECTION_AMBIGUOUS` diagnostics now include the same version-1 aggregate under `details.explanation`. A direct `resolveTopologySelection(...)` call and a direct `explainTopologySelection(...)` call are separate normalization and selector passes; there is no shared-session or cross-call cache for ordinary selections.

### Persistent topology references across evaluations

Topology-signature protocol v1 provides a bounded first persistent-topology slice for faces and edges. A topology-capable evaluated solid exposes a validated, detached, deeply frozen copy of its current snapshot through `EvaluatedSolid.topology()`, returning a `CadResult<KernelTopologySnapshot>` rather than exposing the underlying kernel shape or a mutable kernel cache. A kernel opts into persistent-reference compatibility with the optional `KernelTopologyCapabilities.signatures` declaration:

```ts
{
  protocolVersion: 1,
  fingerprint: "kernel-specific descriptor compatibility declaration",
}
```

The fingerprint is a semantic compatibility declaration for that kernel's topology descriptors, including any runtime or modeling-tolerance choices the kernel considers material. It is not a hash or cryptographic attestation of the native runtime bytes. Capture and resolution validate protocol v1 and require the fingerprint string to match exactly before considering a candidate. Applications should pass the capability advertised by the kernel that produced each snapshot; a missing declaration means that kernel has not promised compatibility with this protocol. Current recognized OCCT fingerprints begin with `invariantcad-topology-descriptor@4`; descriptor `@4` adds the bounded sweep anchors above to descriptor `@3`'s ruled-loft semantics. It deliberately does not match `@3` because authoritative new anchors can change capture and resolution, while the enclosing persistent-reference protocol remains version 1. An existing registry variant captured under `@3` therefore produces `TOPOLOGY_FINGERPRINT_MISMATCH` against `@4` unless the entry is explicitly recaptured or supplemented with a matching `@4` variant. `createOcctKernel()` advertises the declaration for its known default stock runtime and for a recognized owned facade. Supplying an explicit `wasm` or an unknown custom `moduleFactory` suppresses it unless facade probing recognizes the matched owned runtime.

`captureTopologyReference(...)` receives one snapshot, a face or edge key from that snapshot, the advertised signature capability, and explicit linear, angular, and relative match tolerances. Linear tolerance is an absolute error threshold for world-space centers and bounds: it does not grow merely because two compared coordinates are numerically far from the origin, though an actual translation still changes those coordinates and can prevent a match. Relative tolerance applies to measures and radii; face area also receives a linear-tolerance term scaled by the face's characteristic length. It returns a deeply frozen `PersistentTopologyReference` containing canonical semantic lineage, structured geometry, and structured one-hop adjacency evidence. The returned reference is detached: it contains no kernel key, native index, array ordinal, or enumeration-derived tiebreaker, so it can be stored by application code after the evaluation result is disposed. Call `EvaluatedSolid.topology()` before disposing its evaluation; calling it afterward throws through the normal evaluated-shape lifetime guard. A snapshot saved before disposal remains readable, but its keys are still scoped to that evaluation. The key-free captured reference is the durable evidence.

Legacy `DesignDocumentV1` remains parseable, cloneable, directly evaluable, and hash-stable, but cannot contain persistent selectors. `DesignDocumentV2` adds the optional document-owned `topologyReferences` registry and persistent selector atom while retaining the pre-loft closed role vocabulary. `DesignDocumentV3` adds only the five serialized loft roles, including nested stored reference lineage and adjacency evidence. `DesignDocumentV4` adds only the six bounded-sweep role literals in the same locations, and the current builder emits v4. Registry entries bind one topology kind and one exact solid-node target to one or more protocol/fingerprint variants. Registry data is semantic: normalized evidence and canonical variant order participate in serialization and hashing. Parsing, cloning, stringifying, hashing, and direct evaluation preserve supplied v1, v2, and v3 documents without silently upgrading them. `migrateDocument` validates and upgrades v1, v2, or v3 to v4 and is idempotent for v4. Migration never captures, relabels, or rewrites stored descriptor evidence: a descriptor-`@3` fingerprint and its evidence remain exactly `@3` after document migration until an application explicitly captures or supplies a compatible `@4` variant.

These are independent version axes. Document v4 versions the serialized JSON grammar and closed role vocabulary. OCCT descriptor `@4` versions the kernel's semantic topology declarations used for exact fingerprint gating. Persistent-reference protocol v1 versions the detached evidence and matching envelope and remains unchanged.

Capture and resolution also accept `limits?: Partial<TopologySignatureLimits>`. Omitted fields come from the frozen exported `DEFAULT_TOPOLOGY_SIGNATURE_LIMITS` object:

| Limit | Default | Input or work bounded during capture or resolution |
|---|---:|---|
| `maxTopologyItems` | `100_000` | Total faces plus edges in the current snapshot |
| `maxAdjacencyLinks` | `1_000_000` | Snapshot descriptor-array entries, or adjacency entries in a detached reference; one reciprocal face-edge incidence occupies two snapshot entries |
| `maxEvidenceRecords` | `1_000_000` | Lineage records in the snapshot or detached reference |
| `maxCandidatePairs` | `1_000_000` | Topology and neighbor compatibility pairs considered while matching |
| `maxMatchingSteps` | `10_000_000` | Lineage comparisons plus iterative one-to-one adjacency search and update steps |

Each override must be a non-negative safe integer; unknown limit fields and malformed values produce `TOPOLOGY_SIGNATURE_INVALID`. Crossing a ceiling stops that call with `TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED` and reports the `resource`, configured `limit`, and observed `actual` count. Resolution applies the adjacency-link and evidence-record size ceilings independently to the detached reference and to the current snapshot; candidate-pair and matching-step counters are cumulative across that invocation. Snapshot and reference arrays are read with fixed captured lengths and metered while they are detached, without invoking caller iteration hooks. These budgets constrain TypeScript signature normalization and matching after a snapshot exists. They do not bound kernel topology extraction, native modeling/history memory, or the separate owned-OCCT history-record budgets.

```ts
const signatures = kernel.capabilities.topology?.signatures;
const signatureLimits = { maxTopologyItems: 50_000 };
const firstTopology = firstOutput.topology();
if (signatures === undefined || !firstTopology.ok) {
  throw new Error("This evaluation cannot capture persistent topology");
}

const face = firstTopology.value.faces.find((item) =>
  item.lineage.some((entry) => entry.role === "box.face.x-min"),
);
if (face === undefined) throw new Error("Expected box face was not present");

const reference = captureTopologyReference(
  firstTopology.value,
  "face",
  face.key,
  {
    capabilities: signatures,
    tolerance: { linear: 1e-6, angular: 1e-9, relative: 1e-9 },
    limits: signatureLimits,
  },
);
if (!reference.ok) throw new Error(reference.diagnostics[0]?.message);

// Re-author the stable target node and store the captured design intent.
const nextCad = design("persistent-shell");
const nextBox = nextCad.box("box", {
  size: vec3(mm(12), mm(20), mm(30)),
});
const openingFace = nextCad.topologyReference("opening-face", nextBox, {
  topology: "face",
  variants: [reference.value],
});
const hollow = nextCad.shell("hollow", nextBox, {
  openings: topology.faces.persistentReference(openingFace).select(),
  thickness: mm(1),
});
nextCad.output("hollow", hollow);

// Or resolve the detached evidence directly against a later snapshot:
const nextTopology = nextOutput.topology();
// If nextOutput came from another kernel instance, read that instance instead.
const nextSignatures = kernel.capabilities.topology?.signatures;
if (!nextTopology.ok || nextSignatures === undefined) {
  throw new Error("The later evaluation cannot resolve persistent topology");
}
const resolved = resolveTopologyReference(reference.value, nextTopology.value, {
  // Always use the declaration from the kernel that produced nextTopology.
  capabilities: nextSignatures,
  limits: signatureLimits,
});

const explained = explainTopologyReference(
  reference.value,
  nextTopology.value,
  { capabilities: nextSignatures, limits: signatureLimits },
);
if (!explained.ok) throw new Error(explained.diagnostics[0]?.message);
if (explained.value.outcome === "resolved") {
  console.log(explained.value.key, explained.value.evidence);
} else {
  console.log(explained.value.outcome, explained.value.candidatesMatched);
}
```

`explainTopologyReference(...)` returns a deeply frozen version-1 aggregate report from the same bounded matching pass used by `resolveTopologyReference(...)`. Here `ok: true` means the analysis completed; `outcome` is separately `resolved`, `missing`, or `ambiguous`. Every report states the captured/current history modes, unique stored-anchor count, total candidates considered and matched, and per-strategy `considered`/`matched` counts for `semantic-lineage` and `geometry-adjacency`. Only `resolved` exposes a current evaluation-scoped key and evidence. Missing and ambiguous reports never expose candidate keys, native indices, ordinals, descriptors, or enumeration-derived samples. Malformed input, fingerprint incompatibility, invalid options, malformed snapshots, and exhausted work limits remain ordinary failed `CadResult`s rather than partial explanations.

The `ExplainableTopologyReferenceResolutionSession` returned by `createTopologyReferenceResolutionSession(...)` adds `explain(reference)` beside `resolve(reference)`. Both project one object-identity-cached analysis, so asking for both does not repeat matching or recharge the session's cumulative work budget. Missing and ambiguous `resolve(...)` diagnostics also include the same frozen report in `details.explanation`, including when a document-owned persistent selector adds its reference ID and node/path context.

`persistentReference(...)` composes with `and`, `or`, `not`, and `adjacentTo` like every other topology atom. A stored reference is bound to the consuming feature's direct solid input; an ancestor, descendant, unrelated node, or reference from another builder is rejected. Fillet, chamfer, shell, and draft consume these selectors today. Before evaluating the input solid, the evaluator requires face and edge topology, geometry, adjacency, and an exact signature protocol/fingerprint declaration, then verifies that every referenced entry has exactly one compatible variant. Missing capability, malformed capability metadata, and an unavailable fingerprint fail without invoking input geometry, topology extraction, or the feature.

All persistent atoms in one feature resolution share one normalized snapshot, compiled evidence, cumulative candidate/matching budget, and per-reference cache. Pass `topologySignatureLimits` through `EvaluationOptions` to override those operational limits. A failed reference remains fatal inside every logical operator; `or` and `not` never hide an invalid, ambiguous, missing, or incompatible reference.

With complete history on both snapshots, a unique stable role or sketch-source anchor resolves as `evidence: "semantic-lineage"`; that design evidence is authoritative rather than being overridden by a coincidental geometric match. When no such anchor is available, or either snapshot declares partial history, resolution falls back to toleranced `"geometry-adjacency"` evidence and does not treat partial lineage as authoritative. The fallback compares the captured face or edge geometry together with the unordered one-hop signatures of its incident edges or faces. Adjacency matching is iterative and non-recursive: neighbor evidence never contains another adjacency layer, and the matcher uses bounded one-to-one bipartite matching rather than recursively traversing the topology graph.

Capture first proves that the detached evidence uniquely identifies the requested item in its own snapshot. Resolution likewise returns a current evaluation-scoped key only for exactly one compatible candidate. No match fails with `TOPOLOGY_MATCH_MISSING`; multiple matches fail with `TOPOLOGY_MATCH_AMBIGUOUS`; malformed references, options, tolerances, limits, and signature capabilities fail with `TOPOLOGY_SIGNATURE_INVALID`; malformed kernel snapshots fail as `KERNEL_ERROR`; and an exact fingerprint mismatch fails with `TOPOLOGY_FINGERPRINT_MISMATCH`. Resource normalization can return `TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED` before deeper validation of an oversized input. Symmetric topology therefore remains explicitly ambiguous—the protocol never invents identity from enumeration order.

Persistent document selectors currently support faces and edges only, not vertices. They store evidence, never kernel keys or shapes, and therefore do not provide geometric diffing, incremental feature hashes, or cross-run shape caching. The [published persistent-topology torture suite](docs/persistent-topology-torture.md) records the exact stable, missing, ambiguous, cancellation, and ownership boundaries that the current implementation must pass.

## What works today

### Modeling

- Dimension-safe length, angle, and scalar expression trees
- Parameters with defaults, limits, overrides, dependency resolution, and cycle detection
- Box, cylinder/cone, and sphere primitives
- Sketches on XY, XZ, and YZ planes
- Points, lines, circles, arcs, polylines, rectangles, and regular polygons
- Explicit outer loops and hole loops
- Extrude, symmetric extrude, and revolve on both kernels
- Ordered, ruled, hole-free solid lofts through parallel principal-plane profiles on the exact OCCT backend
- Explicit open 3D polyline, three-point circular-arc, and ordered exact line/arc composite paths with hole-free solid sweeps on the exact OCCT backend
- Twist and top-scale extrusion through the Manifold mesh backend
- Union, subtraction, and intersection on both kernels, with complete exact face/edge/vertex evolution through the owned OCCT facade ABI 0.4 and later
- Semantic face/edge set selectors with closed roles, sketch sources, and explicit cardinality
- Exact constant-radius edge fillets through the OCCT backend, with complete face/edge/vertex evolution through owned facade ABI 0.5 and later
- Exact constant equal-distance edge chamfers through the OCCT backend, with complete face/edge/vertex evolution through owned facade ABI 0.5 and later
- Exact constant-thickness inward/outward shells with semantic face openings through the OCCT backend, with complete face/edge/vertex evolution through owned facade ABI 0.6 and later
- Exact whole-solid inward/outward offsets with fixed round joins through the OCCT backend, with complete face/edge/vertex evolution through owned facade ABI 0.6 and later
- Exact atomic multi-face draft through semantic face selectors when using the matched owned OCCT facade
- Translation, Euler rotation, nonuniform scale, and mirror
- Parts with part number, description, metadata, backward-compatible material labels, and explicit parameterized mass density
- Document-owned material definitions with typed part references and explicit parameterized density
- Fixed-placement and nested assemblies with shared part definitions
- Named configurations with parameter, assembly-instance suppression, and part-material overrides
- Deterministic variant-aware bills of materials with nested quantity and affine mass rollups

### Sketch constraints

The permissively licensed reference solver currently supports coincidence, horizontal, vertical, fixed, distance, X/Y distance, line length, parallel, perpendicular, equal length, angle, radius, diameter, equal radius, midpoint, and line-circle tangency.

The solver API is replaceable. The built-in solver is intentionally a v0.1 reference implementation; industrial conflict isolation, redundant-constraint reporting, drag solving, and large sparse systems remain roadmap work.

### Evaluation and interchange

- Reliable manifold-mesh CSG through `manifold-3d` WebAssembly
- Exact B-Rep primitives, analytic profile extrusion/revolution, CSG, and transforms through OpenCascade WebAssembly
- Exact topology enumeration, geometry/adjacency descriptors, selected-edge fillets/chamfers, face-selected shells, whole-solid offsets, owned-facade atomic draft, and owned-facade exact multi-input Boolean, edge-treatment, and solid-offset evolution through OpenCascade WebAssembly
- Protocol-v1 detached face/edge capture and fail-closed resolution, plus Document-v2/v3/v4 persistent selector atoms with exact target and fingerprint binding
- Native STEP, text BREP, and binary BREP import/export in the exact-kernel protocol
- Volume, surface area, axis-aligned bounds, genus, kernel tolerance, center of mass, centroidal inertia, principal axes/moments, arbitrary-axis inertia, radii of gyration, and density-aware physical mass properties
- Typed-array mesh extraction
- Binary STL, ASCII STL, and OBJ export
- Canonical JSON serialization and structural/semantic validation
- SHA-256 semantic document hashes
- Structured diagnostics instead of opaque geometry exceptions
- Node and browser runtime support with configurable WASM location

## Support matrix

| Capability | Current main | Intended stable system |
|---|---:|---:|
| Versioned, kernel-neutral design IR | Yes | Yes |
| Parametric feature graph | Yes | Yes |
| Watertight mesh solids and CSG | Yes | Yes |
| Sketch constraints | Reference solver | Pluggable industrial solvers |
| Parts and fixed-placement assemblies | Yes | Yes |
| Assembly mates and joints | No | Yes |
| Center of mass and centroidal inertia tensor | Both kernels and assemblies | Yes |
| Principal/axis inertia and radii of gyration | Kernel-neutral public analysis | Yes |
| Density-aware part and heterogeneous-assembly mass | Explicit authored density | Yes |
| Named configurations | Parameter, definition-scoped suppression, and part-material overrides | Effectivity and rule-driven variants |
| Deterministic bill of materials | Fixed and nested assemblies, including selected configurations | Effectivity and alternate/substitute components |
| Exact B-Rep primitives and core features | OCCT backend | Yes |
| STEP and BREP import/export | OCCT backend | Yes |
| IGES import/export | No | Exact backend |
| Fillet | OCCT backend with semantic edge selectors | Yes |
| Chamfer | OCCT equal-distance mode with semantic edge selectors | Yes |
| Shell | OCCT inward/outward constant-thickness mode with semantic face openings | Yes |
| Whole-solid offset | OCCT inward/outward mode with fixed round joins | Yes |
| Draft | Explicitly supplied matched owned OCCT facade with semantic face selectors | Yes |
| Boolean topology evolution | Complete face/edge/vertex graph with explicitly supplied owned OCCT facade ABI 0.4 and later; partial on stock/legacy OCCT; unavailable on Manifold | Persistent cross-evaluation naming |
| Fillet/chamfer topology evolution | Complete face/edge/vertex graph with explicitly supplied owned OCCT facade ABI 0.5 and later; partial on stock and owned ABI 0.2–0.4 | Persistent cross-evaluation naming |
| Shell/whole-solid offset topology evolution | Complete face/edge/vertex graph with explicitly supplied owned OCCT facade ABI 0.6 and later; partial on stock and owned ABI 0.2–0.5 | Persistent cross-evaluation naming |
| Persistent face/edge references | Protocol-v1 capture/resolution plus versioned aggregate explanations and Document-v2/v3/v4 registries/selector atoms, with exact target/fingerprint binding, a published initial torture corpus, and no invented identity for symmetric topology | Broader naming across feature families and topology kinds |
| Loft | OCCT ordered ruled-solid mode with matched hole-free sections and five fail-closed semantic face/edge roles | Smooth, guided, and open modes |
| Sweep | OCCT open-polyline, one-edge circular-arc, and certified ordered line/arc composite solid modes with corrected-Frenet transport and six fail-closed semantic face/edge roles; owned facade ABI 0.6 retains the certified major multi-arc and eccentric-profile refinements introduced by ABI 0.3 | Bézier, B-spline, helix, guided, and variable-section modes |
| Semantic face/edge selectors | Origin/geometry/adjacency and Document-v2/v3/v4 persistent-reference queries; v3 adds bounded ruled-loft roles and v4 adds bounded-sweep roles while every earlier grammar stays frozen | Remaining feature-family roles and an expanded torture corpus |
| Drawings, GD&T, PMI | No | Yes |
| Sheet metal | No | Yes |
| CAM and CAE adapters | No | Yes |
| STL and OBJ export | Yes | Yes |

Capabilities are negotiated by backends. InvariantCAD will not silently pretend a mesh operation is exact B-Rep or silently downgrade exact geometry. The current loft contract is deliberately bounded to ruled solids through at least two distinct, ordered, hole-free profiles on parallel planes, with matching directed curve signatures. The current sweep contract is similarly bounded to simple open polyline paths, one exact circular arc, or a certified ordered line/arc composite, with conservative profile clearance and fixed corrected-Frenet/right-corner semantics. Circular-arc and composite sweeping are separate additive capabilities, so an existing polyline-only kernel fails before evaluating unsupported path dependencies. Composite guarantees beyond the base contract use the versioned `compositeSweep` refinement envelope; facade ABI 0.3 introduced `major-multiple-arcs` and `major-eccentric-profile`, ABI 0.6 retains them, and stock and older runtimes advertise neither. Document evaluation computes the duplicate-free required refinement set from exact path geometry and certified analytic profile moments, then reports a structured missing-capability or malformed-protocol diagnostic before invoking the backend. `kernelSupports` remains available for discovery and fails closed on malformed metadata; optional refinement metadata is irrelevant when the selected geometry requires no refinement. Direct OCCT calls use the same classifier and requested feature tolerance. Draft requires both the ordinary `draft` feature and `exactIndexedTopologyEvolution` v1 scoped to draft. For Boolean, fillet, chamfer, shell, and offset, that exact capability is optional: ABI 0.4 introduced it for Boolean, ABI 0.5 added fillet and chamfer, ABI 0.6 adds shell and offset, malformed metadata fails as a protocol violation, and kernels without the feature-scoped promise continue through their supported partial-history paths.

## Measurements and mass properties

`measure()` returns the kernel-neutral `ShapeMeasurements` contract. Its `centerOfMass` is a world-coordinate `Vec3`, or `null` for an empty or zero-volume result. Its `inertiaTensor` is a required `readonly [Vec3, Vec3, Vec3]`: the three rows of the symmetric centroidal tensor in world axes,

```text
integral(((r dot r) I - r r^T) dV)
```

where `r` is measured from the center of mass, for a homogeneous solid with unit volumetric density. Lengths are millimetres, so the tensor is in `mm^5`. Empty and zero-volume results use a zero tensor.

The public analysis functions operate only on copied numeric properties, so they are backend-neutral and remain usable after the evaluated shape is disposed:

```ts
import {
  momentOfInertiaAboutAxis,
  principalInertia,
  principalRadiiOfGyration,
  worldRadiiOfGyration,
} from "invariantcad";

const measured = output.measure();
const principal = principalInertia(measured.inertiaTensor);
// principal.moments is ascending; principal.axes[i] matches moments[i].
console.log(principal.degeneracy, principal.moments, principal.axes);
console.log(worldRadiiOfGyration(measured));
console.log(principalRadiiOfGyration(measured));
console.log(
  momentOfInertiaAboutAxis(measured, {
    point: [0, 0, 0],
    direction: [0, 0, 1],
  }),
);
```

`principalInertia()` uses a deterministic symmetric decomposition. It returns an orthonormal, right-handed world-space frame, ascending moments, per-axis uniqueness, and explicit `distinct`, `minimum-repeated`, `maximum-repeated`, or `isotropic` degeneracy. Axis directions inside a repeated eigenspace are deterministic but are not physically unique. `worldRadiiOfGyration()` reports `sqrt(Ixx / weight)`, `sqrt(Iyy / weight)`, and `sqrt(Izz / weight)`; `principalRadiiOfGyration()` follows ascending principal moments. `inertiaTensorAboutPoint()`, `momentOfInertiaAboutAxis()`, and `radiusOfGyrationAboutAxis()` apply the parallel-axis theorem to arbitrary world-space points and lines. Zero-weight radii are `null`.

Physical density is explicit authored data and is never inferred from a material name. A document can own reusable material definitions, each with required density, and a part refers to one by stable ID through the typed `materialRef` authoring option. The legacy part `material` string remains a backward-compatible descriptive label only: matching it to a material definition's ID or name does not establish a reference and never supplies density. A part uses either that label or `materialRef`, never both.

Documents store density in `kg/mm^3`; helpers accept the common forms `kgPerCubicMillimeter()`, `kgPerCubicMeter()`, and `gramsPerCubicCentimeter()`. Documents containing a density expression declare `units.mass: "kg"`, physical inertia is in `kg*mm^2`, and a definition's density may be parameterized and overridden like any other dimensioned expression:

```ts
import { EvaluatedPart, kgPerCubicMeter } from "invariantcad";

const density = cad.parameter.massDensity(
  "density",
  kgPerCubicMeter(2700),
);
const aluminum = cad.material("aluminum-6061-t6", {
  name: "6061-T6 Aluminum",
  massDensity: density,
});
const part = cad.part("bracket", solid, {
  partNumber: "BRACKET-001",
  materialRef: aluminum,
});
cad.output("bracket", part);

const evaluated = await evaluator.evaluate(cad.build(), {
  // Parameter overrides use the document base unit, here kg/mm^3.
  parameters: { density: 7.85e-6 },
});
if (evaluated.ok) {
  try {
    const output = evaluated.value.output("bracket");
    if (output instanceof EvaluatedPart) {
      const properties = output.physicalMassProperties();
      if (properties.ok) console.log(properties.value.mass);
    }
  } finally {
    evaluated.value.dispose();
  }
}
```

Density resolution has one deterministic precedence rule: a part's own `massDensity` is an explicit per-part override; otherwise the effective material definition's `massDensity` is used; otherwise density is missing. With a selected configuration, its `partMaterial` substitution determines that effective material instead of the part's authored `materialRef`, but an explicit part `massDensity` still wins over the substituted material's density. Neither a legacy `material` label nor a definition `name` participates in resolution. Material IDs and references are document-owned, so a reference created by another builder is rejected instead of being silently rebound by text.

`EvaluatedPart.physicalMassProperties()` and `EvaluatedAssembly.physicalMassProperties()` return `CadResult<PhysicalMassProperties>`. An active part without density produces `MASS_DENSITY_MISSING`; zero, negative, or non-finite resolved density produces `MASS_DENSITY_INVALID`; a finite calculation that cannot produce representable, mechanically valid properties produces `MASS_PROPERTIES_INVALID`. Suppressed occurrences do not require density. Assemblies transform each leaf's volumetric properties through its complete affine placement, multiply by that leaf's own density, then use mass weighting and the parallel-axis theorem. Repeated definitions count once per occurrence, overlaps remain additive bodies, and an empty assembly returns zero mass, a null center, and a zero tensor. For a raw evaluated solid, call `physicalMassProperties(output.measure(), numericDensity)` explicitly.

OCCT obtains these properties from its native B-Rep integration with recentered accumulation. Manifold integrates the centered closed polyhedron emitted by its mesh kernel. That representation boundary is intentional: mesh values describe the emitted polyhedral solid, while OCCT values describe the exact B-Rep, so compare cross-kernel results with an appropriate modeling or meshing tolerance rather than expecting identical floating-point values.

## Assemblies

Modeling transforms create new geometry. Assembly placements create occurrences and preserve the shared part definition:

```ts
import { tf, vec3, mm } from "invariantcad";

const product = cad.assembly("product", (assembly) => {
  assembly.instance("left", part);
  assembly.instance("right", part, {
    placement: [tf.translate(vec3(mm(100), mm(0), mm(0)))],
  });
});

cad.output("product", product);
```

Nested assemblies are flattened into occurrence paths such as `frame/left-bracket` during evaluation while retaining the original part node. Assembly measurements aggregate every placed occurrence under its affine transform and apply the parallel-axis theorem, so shared definitions contribute independently at each placement.

Parts and assemblies also expose a deterministic bill of materials:

```ts
import { EvaluatedAssembly } from "invariantcad";

const evaluated = await evaluator.evaluate(cad.build(), {
  outputs: ["product"],
});
if (evaluated.ok) {
  try {
    const output = evaluated.value.output("product");
    if (output instanceof EvaluatedAssembly) {
      const bom = output.billOfMaterials();
      if (!bom.ok) {
        console.error(bom.diagnostics);
      } else {
        console.table(bom.value.items);
        console.log({
          quantity: bom.value.totalQuantity,
          massComplete: bom.value.massComplete,
          knownMass: bom.value.knownMass,
          totalMass: bom.value.totalMass,
        });
        // Successful partial BOMs can still carry warning diagnostics.
        console.warn(bom.diagnostics);
      }
    }
  } finally {
    evaluated.value.dispose();
  }
}
```

`items` are grouped by stable part-node ID, not by mutable or potentially duplicate part numbers, descriptions, or material names. Each item reports `partNode`, nullable `partNumber`, `description`, effective `materialId` and `material`, `quantity`, sorted flattened `occurrenceIds`, resolved `massDensity` and `massDensitySource`, base `definitionMass`, and occurrence-aware `totalMass`. A directly evaluated part produces definition quantity one and an empty occurrence-path list. Nested assemblies contribute their active leaf occurrences, while authored or configuration-suppressed branches contribute neither quantity nor mass.

BOM mass is physical occurrence mass. Rigid placements and reflections preserve the definition mass; affine scaling changes occurrence mass by its volume scale, so an item's mass rollup need not equal `definitionMass * quantity`. Occurrences remain additive even if their geometry overlaps. If any active item lacks density, the BOM still succeeds with warning diagnostics and exact quantities: `massComplete` is `false`, `knownMass` contains the sum of computable occurrence masses, and `totalMass` is `null`. An empty assembly has zero quantity, complete zero mass, and no items. The BOM's `configurationId` is the selected name or `null` for the base design, so a stored BOM always identifies its variant. Effectivity and alternate/substitute components remain roadmap work.

## Named configurations

A configuration is a document-owned, named set of explicit overrides. It can replace parameter expressions, suppress or re-enable a direct instance in an assembly definition, and substitute a material for a part definition:

```ts
const compactSingle = cad.configuration(
  "compact-single",
  (configuration) => {
    configuration.parameter(width, mm(60));
    configuration.instanceSuppressed(product, "right");
    configuration.partMaterial(part, steel);
  },
  { description: "One compact bracket in steel" },
);

const evaluated = await evaluator.evaluate(cad.build(), {
  configuration: compactSingle,
  parameters: {
    width: 72, // Call-time values override the selected configuration.
  },
});

if (evaluated.ok) {
  try {
    console.log(evaluated.value.configurationId); // "compact-single"
    const output = evaluated.value.output("product");
    if (output instanceof EvaluatedAssembly) {
      const bom = output.billOfMaterials();
      if (bom.ok) console.log(bom.value.configurationId);
    }
  } finally {
    evaluated.value.dispose();
  }
}
```

Parameter precedence is exact: call-time `parameters` > selected configuration `parameterOverrides` > authored parameter defaults. The resolved values in `EvaluatedDesign.parameters` are therefore the effective values used by geometry, material-density expressions, and placements.

Suppression and material overrides target definitions, not flattened occurrence paths. `instanceSuppressed(product, "right")` addresses the authored `right` instance directly inside the `product` assembly node; if that assembly definition is reused, the override applies to every occurrence of the definition. Pass `false` as the third argument to re-enable an instance authored with `suppressed: true`. `partMaterial(part, steel)` similarly affects every occurrence of that part definition. A selected material replaces the authored material reference for reporting and density lookup, while an explicit density authored directly on the part remains the highest-priority density source.

In canonical document IR, the optional top-level `configurations` registry is keyed by stable configuration ID. Each entry contains one or more of `parameterOverrides`, `instanceSuppressions`, and `partMaterialOverrides`, plus optional description and metadata. Suppression is encoded as assembly-node ID -> direct instance ID -> boolean; material substitution is part-node ID -> material ID. Documents without named configurations omit the registry entirely, preserving their existing serialization and semantic hash.

## Documents and deterministic builds

```ts
import {
  hashDocument,
  parseDocument,
  stringifyDocument,
} from "invariantcad";

const json = stringifyDocument(document, { pretty: true });
const parsed = parseDocument(json);
const semanticHash = await hashDocument(document);
```

Canonical serialization sorts record keys, normalizes negative zero, rejects non-finite numbers, and produces identical bytes regardless of feature construction order. Top-level document metadata is excluded from semantic hashes unless requested; metadata attached to parameters, materials, nodes, and configurations remains part of their authored document semantics. Persistent topology registry data is always semantic.

The current authoring API emits `DesignDocumentV4`. `parseDocument`, `parseDocumentValue`, `stringifyDocument`, `cloneDocument`, `hashDocument`, validation, and evaluation preserve a supplied v1, v2, v3, or v4 document. `migrateDocument` validates and upgrades v1, v2, or v3 to v4 and is idempotent for v4. V1 cannot contain a topology-reference registry or persistent selector atom; v2 can but retains the pre-loft role vocabulary; v3 adds loft roles but rejects sweep roles; and v4 adds the six sweep roles. V1-v3 remain frozen and directly evaluable. Migration never rewrites stored descriptor fingerprints, lineage, geometry, or adjacency evidence. The document schema version is independent of the npm package version, OCCT topology-descriptor `@4`, and persistent-reference protocol v1.

Parsing first captures a bounded, detached snapshot before recursive schema validation and freezing, so accessors and proxies cannot change the value after its limits were checked. `ParseDocumentOptions.limits` can override the exported frozen `DEFAULT_DESIGN_DOCUMENT_LIMITS` ceilings for UTF-8 bytes, structural occurrences (including shared aliases), nesting depth, actual selector-query nodes, registry entries, variants, stored adjacency links, and lineage evidence. Sparse arrays, cycles, non-JSON object instances, unknown versioned persistent fields, and malformed or oversized stored evidence fail as structured `IR_INVALID` diagnostics.

## Diagnostics

Evaluation returns `CadResult<T>`:

```ts
if (!result.ok) {
  for (const issue of result.diagnostics) {
    console.error(issue.code, issue.path, issue.message);
  }
}
```

Stable codes include `REFERENCE_MISSING`, `GRAPH_CYCLE`, `PARAMETER_OUT_OF_RANGE`, `CONFIGURATION_MISSING`, `MASS_DENSITY_INVALID`, `MASS_DENSITY_MISSING`, `MASS_PROPERTIES_INVALID`, `SKETCH_OVER_CONSTRAINED`, `EMPTY_RESULT`, `KERNEL_CAPABILITY_MISSING`, `TOPOLOGY_SELECTION_MISSING`, `TOPOLOGY_SELECTION_AMBIGUOUS`, `TOPOLOGY_HISTORY_UNAVAILABLE`, and `EVALUATION_ABORTED`.

## CLI

The CLI operates on serialized InvariantCAD documents:

```bash
invariantcad validate design.invariantcad.json
invariantcad inspect design.invariantcad.json
invariantcad inspect design.invariantcad.json --parameters dimensions.json
invariantcad inspect design.invariantcad.json --configuration compact-single
invariantcad bom design.invariantcad.json --output product
invariantcad bom design.invariantcad.json --output product --configuration compact-single
invariantcad export design.invariantcad.json --output plate --to plate.stl
invariantcad export design.invariantcad.json --output product --configuration compact-single --to product.stl
invariantcad export design.invariantcad.json --output plate --format obj --to plate.obj
invariantcad export design.invariantcad.json --output plate --to plate.step
invariantcad inspect design.invariantcad.json --kernel occt
```

Parameter JSON values use base units: millimetres, radians, `kg/mm^3` mass density, and unitless scalars. `--configuration <id>` selects the same named variant for `inspect`, `bom`, and `export`; `--parameters` remains higher precedence when both are supplied. `validate` checks every stored configuration without selecting one.
`inspect` includes geometric `centerOfMass`, the three-row `inertiaTensor`, principal inertia, and world/principal radii alongside `volume`, `surfaceArea`, `boundingBox`, `genus`, `tolerance`, and `triangles`. Part and assembly reports additionally include analyzed `physicalMassProperties`; if an active density is missing, that field is `null` and `physicalMassDiagnostics` explains why.
`bom` evaluates the selected part or assembly output and prints the same deterministic item, quantity, mass-completeness, and warning-diagnostic contract exposed by `billOfMaterials()`, including its `configurationId`.
The CLI selects stock OCCT automatically for `.step` and `.brep` destinations. Use `--kernel manifold|occt` to select a backend explicitly. The current CLI does not inject a custom module factory, so document draft evaluation, exact Boolean, fillet/chamfer, and shell/offset topology evolution, and owned-facade-only composite refinements require programmatic initialization with the matched pair. Boolean, fillet/chamfer, and shell/offset geometry itself remains available through supported stock paths with partial history.

## Browser initialization

Most Node.js users need no configuration. Browser bundlers that do not automatically resolve the Manifold WASM asset can supply its URL:

```ts
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { createEvaluator } from "invariantcad";

const evaluator = await createEvaluator({ manifold: { wasmUrl } });
```

The `?url` syntax is bundler-specific; InvariantCAD itself only accepts a normal URL and does not couple its API to Vite.

The exact backend likewise accepts an explicit OCCT WASM location:

```ts
import occtWasmUrl from "occt-wasm/dist/occt-wasm.wasm?url";
import { createOcctKernel } from "invariantcad/kernels/occt";

const kernel = await createOcctKernel({ wasm: occtWasmUrl });
```

That form still pairs the supplied binary with the stock `occt-wasm` JavaScript glue and therefore does not enable draft or exact Boolean, fillet/chamfer, or shell/offset topology evolution. Because InvariantCAD cannot recognize that overridden binary as the known default stock runtime, it also omits `topology.signatures`; topology inspection still works, but the kernel makes no protocol-v1 persistent-reference compatibility promise. Load the stronger guarantees with the generated JavaScript factory from the owned-facade build. A factory may locate its matched sibling WASM itself; pass `wasm` when the application or bundler needs an explicit binary URL:

```ts
import ownedOcctModuleFactory from "./occt-facade/occt-wasm.js";
import ownedOcctWasmUrl from "./occt-facade/occt-wasm.wasm?url";
import { createOcctKernel } from "invariantcad/kernels/occt";

const kernel = await createOcctKernel({
  moduleFactory: ownedOcctModuleFactory,
  wasm: ownedOcctWasmUrl,
  maxExactBooleanHistoryRecords: 1_000_000,
  maxExactEdgeTreatmentHistoryRecords: 1_000_000,
  maxExactSolidOffsetHistoryRecords: 1_000_000,
});
```

The paths and `?url` syntax are application/bundler-specific. The three history-record values shown above are independent defaults; callers may lower one to constrain that operation family or raise it for exceptionally large exact graphs, up to the signed 32-bit facade ceiling. InvariantCAD passes each budget to its native operation and validates the returned count before indexed JavaScript copying. InvariantCAD probes the loaded module before advertising draft, the ABI 0.3 composite refinements retained by ABI 0.6, exact Boolean evolution, exact fillet/chamfer evolution, or exact shell/offset evolution. A stock module remains usable for its other exact features, including shell/offset geometry with partial history, while a partial, mismatched, or unknown owned-facade marker fails closed instead of claiming guarantees it cannot prove.

The owned facade is not part of the `invariantcad` npm tarball and no separate
facade package is currently published. This repository can package a local
source build as a versioned, package-neutral directory plus `.tar.gz` archive:

```bash
pnpm build:occt-facade
pnpm bundle:occt-facade
pnpm verify:occt-facade-bundle
pnpm test:occt-facade-bundle
```

The unpacked runtime is under
`.artifacts/occt-facade-bundle/invariantcad-occt-facade-0.6.0/runtime/`.
Here `0.6.0` is the facade ABI/bundle version, not the npm package version,
document schema version, or product-roadmap milestone.
Its JavaScript and WASM files must be loaded as a matched pair using the
`moduleFactory` and `wasm` options shown above. The archive is package-manager
neutral: it is not an npm package, does not install itself, and is never found,
downloaded, or extracted by `createOcctKernel`.

`pnpm test:occt-facade-bundle` also packs the npm library, installs that tarball
in a fresh temporary consumer, and checks the owned ABI 0.6 capability surface
alongside direct/document-evaluated draft; exact Boolean, fillet/chamfer, and
shell/offset evolution; and major multi-arc and eccentric-profile composite
sweeps by passing the verified bundle runtime explicitly. The ordinary
`pnpm test:package` does not require or discover owned-facade artifacts.

The bundle also collects checksums, build provenance, an SBOM, source and
relinking information, and applicable notices for review. Those materials are
engineering compliance inputs, not legal certification. Public distribution
remains pending external legal, release, and security review; until then,
consumers must build the pinned recipe in [native/occt](native/occt/README.md)
or obtain an equivalently reviewed matching pair through an explicit channel.

## Architecture

```text
TypeScript builders
        │
        ▼
immutable DesignDocument v4 ──► validation / canonical JSON / hashing
  (v1/v2/v3 stay frozen, readable, directly evaluable, and migratable)
        │
        ├──► sketch-solver protocol ──► reference solver (v0.1)
        │
        └──► geometry-kernel protocol ──► Manifold mesh kernel
                                      └─► exact OCCT B-Rep kernel
        │
        ▼
evaluated parts / assemblies ──► measurement / mesh / STL / OBJ / STEP / BREP
```

See [Architecture](docs/architecture.md) for the invariants and backend contracts.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm example:bracket
pnpm verify

# Heavyweight owned-facade release checks (after building the facade)
pnpm test:occt-facade-bundle
```

The bracket example writes its document and STL to `.artifacts/`.

## License

InvariantCAD is Apache-2.0 licensed. The default mesh backend uses the Apache-2.0 licensed Manifold library. The optional-at-runtime OCCT backend depends on `occt-wasm` and compiled OpenCascade code under LGPL-2.1 with the OCCT exception. Dependency notices, corresponding-source information, and replacement rights must be preserved in distributions.
