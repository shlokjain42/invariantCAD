# InvariantCAD

Comprehensive, type-safe CAD-as-code for TypeScript.

InvariantCAD represents a design as immutable, versioned JSON and evaluates it through replaceable geometry and sketch-solver backends. The public API never exposes WASM pointers or kernel-specific objects.

> **Project status:** `0.1.0` is the released-foundation target. Current main adds named definition-scoped configurations and variant-aware BOMs, an exact OpenCascade B-Rep backend, analytic sketch-profile transfer, STEP/BREP exchange, bounded ruled solid lofts, explicit 3D polyline, circular-arc, and ordered line/arc composite paths with bounded exact solid sweeps, closed semantic topology roles, sketch-boundary provenance, exact selector-driven fillets and equal-distance chamfers, exact face-selected inward/outward shells, exact whole-solid inward/outward offsets, atomic semantic-face draft, and owned exact multi-input Boolean evolution for union, subtraction, and intersection when the matched InvariantCAD-owned OCCT facade is loaded. Complete topology history for fillets, chamfers, shells, offsets, and other remaining topology-changing features is still under active development; see the [support matrix](#support-matrix) and [roadmap](docs/roadmap.md).

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

Every feature, entity, constraint, parameter, instance, and output has an explicit stable ID. Those IDs are the basis for reproducible diffs, caching, diagnostics, and future persistent-topology naming.

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

The backend is explicitly selected; a design document never contains OCCT handles or backend-specific objects. The default `createOcctKernel()` loads stock `occt-wasm` and supports the exact geometry features listed below except draft, but its Boolean topology history is partial. Draft, complete exact multi-input Boolean evolution, and the stronger major multi-arc/eccentric-profile composite guarantees are advertised only when `moduleFactory` loads the matched InvariantCAD-owned facade ABI 0.4 build; `wasm` is an optional explicit binary override for environments where that factory cannot locate its sibling binary. The repository can turn that local build into a verified, package-neutral bundle, but applications must still supply its runtime explicitly. See [Browser initialization](#browser-initialization).

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

Document-v1 sweeps require an open, simple path; a closed, hole-free profile seated at its start; an initial tangent parallel to the profile-plane normal in either direction; corrected-Frenet transport; and conservative profile clearance. Polyline paths reject repeated or redundant collinear vertices and use right-corner intersections. Circular-arc paths are one exact three-point arc below a full turn and require their circumradius to exceed the complete profile envelope. Composite paths contain at least two structurally connected segments and at least one arc. Junctions touching an arc must be forward G1 tangent, while line-line junctions retain right-corner semantics. Minor, major, and certified near-full composite arcs are supported without an artificial endpoint-chord rule. Adjacent segments exclude only their curvature-bounded intrinsic neighborhood, then recursively certify every remote line/arc parameter domain against path tolerance and the full profile diameter; redundant adjacent segments, actual remote returns, and numerical ambiguity fail explicitly. The OCCT adapter realizes the one-edge circular case as an exact revolution about the resolved circle axis. Ordered composites use one exact PipeShell wire. Every composite arc must exceed the profile-envelope radius and pass the `3e-8` three-point conditioning floor. Every PipeShell profile/path edge and all three authored point-pair separations of a composite arc must exceed the native `1e-4 mm` transfer floor.

Stock PipeShell does not expose its angular tolerance, so stock OCCT admits a major-arc composite only when it contains one circular-arc segment and the seated profile area centroid is centered within the selected tolerance. InvariantCAD derives that requirement before backend invocation with exact, kernel-neutral line/arc/circle area moments, compensated error bounds, and a strict major threshold of `π + 1e-12`; an admitted authored profile-origin mismatch is not mistaken for section eccentricity. Those analytic local moments—not OCCT's world-coordinate integration—also define circular and composite sweep volume. OCCT independently remeasures the constructed profile face and must agree within bounds derived from analytic roundoff, profile perimeter/radius, modeling tolerance, and per-axis coordinate ULPs; disagreement fails before path or result allocation with structured diagnostics. Circular transfer also derives a native-face volume around the actual rounded revolution axis before constructing the solid and requires it to remain inside the same certified representability envelope. Relative profile-centroid and arc-center offsets avoid add-large/subtract-large cancellation at representable world translations. Owned facade ABI 0.3 introduced a corrected-Frenet/right-corner PipeShell with explicit linear, boundary, and `1e-9` angular tolerances, bounded OCCT surface error, and transactional transfer; the current ABI 0.4 retains that contract. It certifies major multi-arc and eccentric-profile composites and advertises those guarantees as versioned refinements. Every composite result is also checked against an exact transported-centroid volume oracle covering lines, arcs, and supported RightCorner miters; ill-conditioned cancellation fails closed. Guided, variable-section, full-circle, Bézier, B-spline, and helix paths remain explicit future contracts.

### Semantic topology, Booleans, fillets, chamfers, shells, offsets, and draft

Topology selections describe intent as set queries. They never persist a face index, edge index, OCCT handle, or transient hash. This source-aware selector keeps identifying the same extrusion rim after a 90-degree rotation and across width/height parameter crossovers:

```ts
import {
  angleVec3,
  deg,
  design,
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

For both fillets and chamfers, `edges` selects contour seeds rather than hard stopping boundaries. Each seed expands to the maximal connected contour of tangent edges that continues between tangent face chains on both sides. A closed tangent contour expands around the complete loop, and multiple seeds on the same contour apply the operation only once. Selector cardinality constrains the seed set, not the number of input edges ultimately modified. Expansion stops at sharp, disconnected, degenerate, non-manifold, boundary, or ambiguous junctions. Continuity at a modeling-tolerance boundary can remain kernel-dependent; this mode cannot yet express “stop at this otherwise tangent vertex.”

Shell openings deliberately use different semantics: `openings` is the exact set of input faces removed. Selected faces are not tangent-contour seeds, and the operation never propagates removal to an adjacent tangent or coplanar face. Selector cardinality therefore describes the actual opening-face set passed to the kernel.

Shell `thickness` is always a positive wall-thickness magnitude. `direction: "inward"` keeps the unselected input boundary as the exterior skin and offsets the second wall into the solid; `direction: "outward"` keeps it as the interior skin and builds the second wall outside it. Document v1 fixes offset-face transitions to round/arc joins; intersection/miter joins are not supported yet. The builder defaults direction to `"inward"` and reconstruction tolerance to `mm(1e-6)`, then materializes both values in the immutable document so serialization and semantic hashes include them. Thickness and tolerance must be positive, and tolerance must be less than thickness.

The current shell mode accepts exactly one solid with no loose faces, edges, or vertices, at least one selected opening face, and at least one retained face. It produces one valid positive-volume solid or a structured kernel diagnostic; it does not apply independently to disconnected bodies. Closed hollowing without an opening and variable-thickness shells are not supported yet.

Whole-solid `offset` uses a positive `distance` magnitude plus an explicit `direction`. `"outward"` adds material outside the oriented boundary; `"inward"` removes material inside it. The builder defaults to `"outward"` and `mm(1e-6)` tolerance and materializes both in the document. Document v1 fixes round/arc joins: an outward box offset therefore contains cylindrical edge transitions and spherical corner transitions rather than an intersection/mitered box. Distance and tolerance must be positive, and tolerance must be less than distance.

Offset accepts exactly one valid positive-volume solid with no loose lower-dimensional topology and must return the same. Invalid, collapsed, disconnected, and direction-inconsistent results fail explicitly. It is a 3D body operation; 2D wire/profile offsets will use a separate future contract.

Draft applies the selected input faces atomically: either every face is staged into one native operation or no result is exposed. Its angle is signed and must satisfy `1e-4 < Math.abs(angleRadians) < Math.PI / 2`; the pull direction and neutral-plane normal must be nonzero. Pull direction and neutral plane are independent inputs, so neither vector is inferred from or rescaled to the other. The neutral plane is defined by its explicit origin and normal, and its intersection with the drafted faces remains fixed.

The matched owned OCCT facade proves a complete one-to-one face/edge/vertex evolution for every successful draft before transferring the result. That feature-scoped `exactIndexedTopologyEvolution` v1 guarantee lets later face/edge queries retain inherited `createdBy(...)` lineage and identify changed topology with `modifiedBy(drafted)` without exposing native indices. It does not change the backend's global topology-provenance declaration, which remains `feature` because other topology-changing features still have partial history.

Owned facade ABI 0.4 extends that version-1 envelope to every successful union, subtraction, and intersection, including multiple tools. Source shape `0` is the authored target and sources `1..N` are the authored tools in order. Union and intersection apply each tool sequentially in that order; subtraction is one cut of the target against the complete authored tool set. The report must prove complete face/edge/vertex coverage for every input and the aggregate result before ownership transfers. `PRESERVED` and `MODIFIED` are same-kind identity links, `GENERATED` is an exact causal link that may change topology kind, and `DELETED` terminates an input subshape with the `NONE/-1` result sentinel only when that source has no final identity successor. Generated links may coexist with identity or deletion records, but do not replace the required identity-successor-or-deletion proof for their source. The facade retains every available native preserved, modified, and generated claim before classifying any residual result topology. OCCT can create higher-order topology through interactions among multiple tools without assigning it to one operand; those otherwise-unclaimed result items use source-less `CREATED` with the exact `-1/NONE/-1` source sentinel. A created result cannot also carry an operand claim.

Public semantic lineage is intentionally stricter than causal history. Only `PRESERVED` and `MODIFIED` identity predecessors inherit earlier lineage, roles, and sketch sources. A `GENERATED` link never copies a source role onto a new subshape; a result with only generated causes or a source-less `CREATED` record is recorded only as `createdBy(currentBoolean)`. An identity successor keeps its proven earlier lineage and gains `modifiedBy(currentBoolean)` only when an identity link is modified. These native indices and all public topology keys remain evaluation-scoped plumbing, never persistent document identity.

Exact Boolean evolution is an optional capability. The evaluator validates and uses it when a backend advertises it, but absence does not block the ordinary Boolean feature: stock OCCT, owned ABI 0.2/0.3, and Manifold remain compatible with partial Boolean history. A malformed advertised envelope or a failed completeness proof is authoritative and fails closed instead of downgrading. ABI 0.4 makes a topology-independent working copy of every operand, shares its immutable geometry, and runs each native builder in non-destructive mode; the Boolean never receives an arena-owned TShape, so every authored target and tool BREP remains byte-stable across the operation. Copy-to-source topology correspondence is proved before history can succeed. The adapter copies, freezes, count-checks, and validates the complete report before its one-shot same-kernel transfer; an adoption failure rolls the transferred result back exactly once. `createOcctKernel({ maxExactBooleanHistoryRecords })` sets the caller-controlled record budget, defaults to `1_000_000`, passes it into the facade, and rejects an oversized report natively before report record materialization and again from its count before any indexed JavaScript copying. That option bounds history records only; operand working copies and OCCT's Boolean workspace still scale with the input topology. A legitimate empty Boolean result is representable by zero result counts and follows the normal evaluator `EMPTY_RESULT` / `allowEmpty` policy.

The serialized role vocabulary is closed and exported through `TOPOLOGY_ROLES` and `TOPOLOGY_ROLE_RULES`:

| Producer | Stable face roles | Stable edge roles |
|---|---|---|
| Box | signed local faces such as `box.face.x-min` | unique face intersections such as `box.edge.x-min-y-min` |
| Cylinder or cone | start/end caps and side | start/end rims |
| Sphere | `sphere.face.surface` | none; seam and pole artifacts stay unnamed |
| Extrusion | start/end caps and source-aware sides | source-aware start/end rims and unsourced lateral edges |

`start` and `end` follow construction parameterization, not current world orientation. A topology-preserving transform retains the original role/source lineage and adds `modified` lineage for the transform. Cylinder seams, cone apex artifacts, sphere seams/poles, and other kernel artifacts are deliberately unnamed so a document cannot accidentally depend on their enumeration.

Selectors also support curve/surface kind, edge direction, face normal, radius, adjacency, `and`/`or`/`not`, and explicit cardinality. Zero matches produce `TOPOLOGY_SELECTION_MISSING`; excess matches produce `TOPOLOGY_SELECTION_AMBIGUOUS`. The exact backend currently provides complete broad feature provenance for primitives, extrusions, revolutions, lofts, sweeps, and topology-preserving transforms, plus the semantic roles and sketch sources above. Loft and sweep topology have broad `createdBy(feature)` lineage but deliberately have no cap/side roles or sketch-source mapping. The matched owned facade provides exact indexed evolution for draft and Boolean; Boolean history remains partial on stock/default OCCT, legacy owned ABIs, and Manifold. Fillet, chamfer, shell, and offset history remains partial on every current backend, so provenance queries after those operations fail with `TOPOLOGY_HISTORY_UNAVAILABLE` rather than choosing unstable topology. Geometry-only selectors can still inspect partial-history results. Manifold and stock/default OCCT report an explicit capability error for draft.

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
- Union, subtraction, and intersection on both kernels, with complete exact face/edge/vertex evolution through the owned OCCT facade ABI 0.4
- Semantic face/edge set selectors with closed roles, sketch sources, and explicit cardinality
- Exact constant-radius edge fillets through the OCCT backend
- Exact constant equal-distance edge chamfers through the OCCT backend
- Exact constant-thickness inward/outward shells with semantic face openings through the OCCT backend
- Exact whole-solid inward/outward offsets with fixed round joins through the OCCT backend
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
- Exact topology enumeration, geometry/adjacency descriptors, selected-edge fillets/chamfers, face-selected shells, whole-solid offsets, owned-facade atomic draft, and owned-facade exact multi-input Boolean evolution through OpenCascade WebAssembly
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
| Boolean topology evolution | Complete face/edge/vertex graph with explicitly supplied owned OCCT facade ABI 0.4; partial on stock/legacy OCCT and Manifold | Persistent cross-evaluation naming |
| Loft | OCCT ordered ruled-solid mode with matched hole-free sections | Smooth, guided, and open modes |
| Sweep | OCCT open-polyline, one-edge circular-arc, and certified ordered line/arc composite solid modes with corrected-Frenet transport; owned facade ABI 0.4 retains the certified major multi-arc and eccentric-profile refinements introduced by ABI 0.3 | Bézier, B-spline, helix, guided, and variable-section modes |
| Persistent face/edge selectors | Primitive/extrusion roles and sources; origin/geometry/adjacency queries | Yes |
| Drawings, GD&T, PMI | No | Yes |
| Sheet metal | No | Yes |
| CAM and CAE adapters | No | Yes |
| STL and OBJ export | Yes | Yes |

Capabilities are negotiated by backends. InvariantCAD will not silently pretend a mesh operation is exact B-Rep or silently downgrade exact geometry. The current loft contract is deliberately bounded to ruled solids through at least two distinct, ordered, hole-free profiles on parallel planes, with matching directed curve signatures. The current sweep contract is similarly bounded to simple open polyline paths, one exact circular arc, or a certified ordered line/arc composite, with conservative profile clearance and fixed corrected-Frenet/right-corner semantics. Circular-arc and composite sweeping are separate additive capabilities, so an existing polyline-only kernel fails before evaluating unsupported path dependencies. Composite guarantees beyond the base contract use the versioned `compositeSweep` refinement envelope; facade ABI 0.3 introduced `major-multiple-arcs` and `major-eccentric-profile`, ABI 0.4 retains them, and stock and older runtimes advertise neither. Document evaluation computes the duplicate-free required refinement set from exact path geometry and certified analytic profile moments, then reports a structured missing-capability or malformed-protocol diagnostic before invoking the backend. `kernelSupports` remains available for discovery and fails closed on malformed metadata; optional refinement metadata is irrelevant when the selected geometry requires no refinement. Direct OCCT calls use the same classifier and requested feature tolerance. Draft requires both the ordinary `draft` feature and `exactIndexedTopologyEvolution` v1 scoped to draft. For Boolean, that exact capability is optional: ABI 0.4 advertises it and malformed metadata fails as a protocol violation, while kernels without it continue through the supported partial-history Boolean path.

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

Canonical serialization sorts record keys, normalizes negative zero, rejects non-finite numbers, and produces identical bytes regardless of feature construction order. Top-level document metadata is excluded from semantic hashes unless requested; metadata attached to parameters, materials, nodes, and configurations remains part of their authored document semantics.

The document schema version is independent of the npm package version.

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
The CLI selects stock OCCT automatically for `.step` and `.brep` destinations. Use `--kernel manifold|occt` to select a backend explicitly. The current CLI does not inject a custom module factory, so document draft evaluation, exact Boolean topology evolution, and owned-facade-only composite refinements require programmatic initialization with the matched pair. Boolean geometry itself remains available through the stock and Manifold CLI paths with partial history.

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

That form still pairs the supplied binary with the stock `occt-wasm` JavaScript glue and therefore does not enable draft or exact Boolean topology evolution. Load those guarantees with the generated JavaScript factory from the owned-facade build. A factory may locate its matched sibling WASM itself; pass `wasm` when the application or bundler needs an explicit binary URL:

```ts
import ownedOcctModuleFactory from "./occt-facade/occt-wasm.js";
import ownedOcctWasmUrl from "./occt-facade/occt-wasm.wasm?url";
import { createOcctKernel } from "invariantcad/kernels/occt";

const kernel = await createOcctKernel({
  moduleFactory: ownedOcctModuleFactory,
  wasm: ownedOcctWasmUrl,
  maxExactBooleanHistoryRecords: 1_000_000,
});
```

The paths and `?url` syntax are application/bundler-specific. The history-record option shown above is the default; callers may lower it to constrain memory or raise it for exceptionally large exact Boolean graphs, up to the signed 32-bit facade ceiling. InvariantCAD passes the budget to the native operation and validates the returned count before indexed JavaScript copying. InvariantCAD probes the loaded module before advertising draft, the ABI 0.3 composite refinements retained by ABI 0.4, or exact Boolean evolution. A stock module remains usable for its other exact features, while a partial, mismatched, or unknown owned-facade marker fails closed instead of claiming guarantees it cannot prove.

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
`.artifacts/occt-facade-bundle/invariantcad-occt-facade-0.4.0/runtime/`.
Here `0.4.0` is the facade ABI/bundle version, not the npm package version.
Its JavaScript and WASM files must be loaded as a matched pair using the
`moduleFactory` and `wasm` options shown above. The archive is package-manager
neutral: it is not an npm package, does not install itself, and is never found,
downloaded, or extracted by `createOcctKernel`.

`pnpm test:occt-facade-bundle` also packs the npm library, installs that tarball
in a fresh temporary consumer, and checks the owned ABI 0.4 capability surface
alongside direct/document-evaluated draft, exact Boolean evolution, and major
multi-arc and eccentric-major composite sweeps by passing the verified bundle
runtime explicitly. The ordinary
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
immutable DesignDocument v1 ──► validation / canonical JSON / hashing
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
