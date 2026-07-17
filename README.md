# InvariantCAD

Comprehensive, type-safe CAD-as-code for TypeScript.

InvariantCAD represents a design as immutable, versioned JSON and evaluates it through replaceable geometry and sketch-solver backends. The public API never exposes WASM pointers or kernel-specific objects.

> **Project status:** `0.1.0` is the released-foundation target. Current main adds an exact OpenCascade B-Rep backend, analytic sketch-profile transfer, STEP/BREP exchange, bounded ruled solid lofts, explicit 3D polyline, circular-arc, and ordered line/arc composite paths with bounded exact solid sweeps, closed semantic topology roles, sketch-boundary provenance, exact selector-driven fillets and equal-distance chamfers, exact face-selected inward/outward shells, exact whole-solid inward/outward offsets, and atomic semantic-face draft with exact indexed topology evolution when the matched InvariantCAD-owned OCCT facade is loaded. Complete topology history across the other topology-changing features and additional advanced mechanical features remain under active development; see the [support matrix](#support-matrix) and [roadmap](docs/roadmap.md).

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

The backend is explicitly selected; a design document never contains OCCT handles or backend-specific objects. The default `createOcctKernel()` loads stock `occt-wasm` and supports the exact features listed below except draft. Draft is advertised only when `moduleFactory` loads the matched InvariantCAD-owned facade build; `wasm` is an optional explicit binary override for environments where that factory cannot locate its sibling binary. The repository can turn that local build into a verified, package-neutral bundle, but applications must still supply its runtime explicitly. See [Browser initialization](#browser-initialization).

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

Document-v1 sweeps require an open, simple path; a closed, hole-free profile seated at its start; an initial tangent parallel to the profile-plane normal in either direction; corrected-Frenet transport; and conservative profile clearance. Polyline paths reject repeated or redundant collinear vertices and use right-corner intersections. Circular-arc paths are one exact three-point arc below a full turn and require their circumradius to exceed the complete profile envelope. Composite paths contain at least two structurally connected segments and at least one arc. Junctions touching an arc must be forward G1 tangent; line-line junctions retain right-corner semantics; adjacent arc pairs must stay within their certified local-curvature reach; redundant adjacent segments, major composite arcs, and uncertified nonadjacent clearance fail explicitly. The OCCT adapter realizes the one-edge circular case as an exact revolution about the resolved circle axis, including near-full major arcs. Ordered composites use one exact PipeShell wire. Every composite arc must be minor or semicircular, exceed the profile-envelope radius, and pass the `3e-8` three-point conditioning floor. Every PipeShell profile/path edge and all three authored point-pair separations of a composite arc must exceed the native `1e-4 mm` linear tolerance. Guided, variable-section, full-circle, Bézier, B-spline, and helix paths remain explicit future contracts.

### Semantic topology, fillets, chamfers, shells, offsets, and draft

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

The serialized role vocabulary is closed and exported through `TOPOLOGY_ROLES` and `TOPOLOGY_ROLE_RULES`:

| Producer | Stable face roles | Stable edge roles |
|---|---|---|
| Box | signed local faces such as `box.face.x-min` | unique face intersections such as `box.edge.x-min-y-min` |
| Cylinder or cone | start/end caps and side | start/end rims |
| Sphere | `sphere.face.surface` | none; seam and pole artifacts stay unnamed |
| Extrusion | start/end caps and source-aware sides | source-aware start/end rims and unsourced lateral edges |

`start` and `end` follow construction parameterization, not current world orientation. A topology-preserving transform retains the original role/source lineage and adds `modified` lineage for the transform. Cylinder seams, cone apex artifacts, sphere seams/poles, and other kernel artifacts are deliberately unnamed so a document cannot accidentally depend on their enumeration.

Selectors also support curve/surface kind, edge direction, face normal, radius, adjacency, `and`/`or`/`not`, and explicit cardinality. Zero matches produce `TOPOLOGY_SELECTION_MISSING`; excess matches produce `TOPOLOGY_SELECTION_AMBIGUOUS`. The exact backend currently provides complete broad feature provenance for primitives, extrusions, revolutions, lofts, sweeps, and topology-preserving transforms, plus the semantic roles and sketch sources above. Loft and sweep topology have broad `createdBy(feature)` lineage but deliberately have no cap/side roles or sketch-source mapping. Boolean, fillet, chamfer, shell, and offset history is partial, so provenance queries on those results fail with `TOPOLOGY_HISTORY_UNAVAILABLE` rather than choosing unstable topology. Geometry-only selectors can still inspect those results. Draft is the narrower exception: a matched owned facade provides exact indexed evolution specifically for draft. Manifold and stock/default OCCT report an explicit capability error for draft.

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
- Union, subtraction, and intersection
- Semantic face/edge set selectors with closed roles, sketch sources, and explicit cardinality
- Exact constant-radius edge fillets through the OCCT backend
- Exact constant equal-distance edge chamfers through the OCCT backend
- Exact constant-thickness inward/outward shells with semantic face openings through the OCCT backend
- Exact whole-solid inward/outward offsets with fixed round joins through the OCCT backend
- Exact atomic multi-face draft through semantic face selectors when using the matched owned OCCT facade
- Translation, Euler rotation, nonuniform scale, and mirror
- Parts with part number, material, description, and metadata
- Fixed-placement and nested assemblies with shared part definitions

### Sketch constraints

The permissively licensed reference solver currently supports coincidence, horizontal, vertical, fixed, distance, X/Y distance, line length, parallel, perpendicular, equal length, angle, radius, diameter, equal radius, midpoint, and line-circle tangency.

The solver API is replaceable. The built-in solver is intentionally a v0.1 reference implementation; industrial conflict isolation, redundant-constraint reporting, drag solving, and large sparse systems remain roadmap work.

### Evaluation and interchange

- Reliable manifold-mesh CSG through `manifold-3d` WebAssembly
- Exact B-Rep primitives, analytic profile extrusion/revolution, CSG, and transforms through OpenCascade WebAssembly
- Exact topology enumeration, geometry/adjacency descriptors, selected-edge fillets/chamfers, face-selected shells, whole-solid offsets, and owned-facade atomic draft through OpenCascade WebAssembly
- Native STEP, text BREP, and binary BREP import/export in the exact-kernel protocol
- Volume, surface area, axis-aligned bounds, genus, and kernel tolerance
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
| Exact B-Rep primitives and core features | OCCT backend | Yes |
| STEP and BREP import/export | OCCT backend | Yes |
| IGES import/export | No | Exact backend |
| Fillet | OCCT backend with semantic edge selectors | Yes |
| Chamfer | OCCT equal-distance mode with semantic edge selectors | Yes |
| Shell | OCCT inward/outward constant-thickness mode with semantic face openings | Yes |
| Whole-solid offset | OCCT inward/outward mode with fixed round joins | Yes |
| Draft | Explicitly supplied matched owned OCCT facade with semantic face selectors | Yes |
| Loft | OCCT ordered ruled-solid mode with matched hole-free sections | Smooth, guided, and open modes |
| Sweep | OCCT open-polyline, one-edge circular-arc, and ordered line/arc composite solid modes with corrected-Frenet transport | Major-arc composites, Bézier, B-spline, helix, guided, and variable-section modes |
| Persistent face/edge selectors | Primitive/extrusion roles and sources; origin/geometry/adjacency queries | Yes |
| Drawings, GD&T, PMI | No | Yes |
| Sheet metal | No | Yes |
| CAM and CAE adapters | No | Yes |
| STL and OBJ export | Yes | Yes |

Capabilities are negotiated by backends. InvariantCAD will not silently pretend a mesh operation is exact B-Rep or silently downgrade exact geometry. The current loft contract is deliberately bounded to ruled solids through at least two distinct, ordered, hole-free profiles on parallel planes, with matching directed curve signatures. The current sweep contract is similarly bounded to simple open polyline paths, one exact circular arc, or a certified ordered line/arc composite, with conservative profile clearance and fixed corrected-Frenet/right-corner semantics. Circular-arc and composite sweeping are separate additive capabilities, so an existing polyline-only kernel fails before evaluating unsupported path dependencies. Draft requires both the ordinary `draft` feature and `exactIndexedTopologyEvolution` v1 scoped to draft; a stock/default OCCT module advertises neither.

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

Nested assemblies are flattened into occurrence paths such as `frame/left-bracket` during evaluation while retaining the original part node.

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

Canonical serialization sorts record keys, normalizes negative zero, rejects non-finite numbers, and produces identical bytes regardless of feature construction order. Display metadata is excluded from semantic hashes unless requested.

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

Stable codes include `REFERENCE_MISSING`, `GRAPH_CYCLE`, `PARAMETER_OUT_OF_RANGE`, `SKETCH_OVER_CONSTRAINED`, `EMPTY_RESULT`, `KERNEL_CAPABILITY_MISSING`, `TOPOLOGY_SELECTION_MISSING`, `TOPOLOGY_SELECTION_AMBIGUOUS`, `TOPOLOGY_HISTORY_UNAVAILABLE`, and `EVALUATION_ABORTED`.

## CLI

The CLI operates on serialized InvariantCAD documents:

```bash
invariantcad validate design.invariantcad.json
invariantcad inspect design.invariantcad.json
invariantcad inspect design.invariantcad.json --parameters dimensions.json
invariantcad export design.invariantcad.json --output plate --to plate.stl
invariantcad export design.invariantcad.json --output plate --format obj --to plate.obj
invariantcad export design.invariantcad.json --output plate --to plate.step
invariantcad inspect design.invariantcad.json --kernel occt
```

Parameter JSON values use base units: millimetres, radians, and unitless scalars.
The CLI selects stock OCCT automatically for `.step` and `.brep` destinations. Use `--kernel manifold|occt` to select a backend explicitly. The current CLI does not inject a custom module factory, so document draft evaluation requires programmatic initialization with the matched owned facade pair.

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

That form still pairs the supplied binary with the stock `occt-wasm` JavaScript glue and therefore does not enable draft. Load draft with the generated JavaScript factory from the owned-facade build. A factory may locate its matched sibling WASM itself; pass `wasm` when the application or bundler needs an explicit binary URL:

```ts
import ownedOcctModuleFactory from "./occt-facade/occt-wasm.js";
import ownedOcctWasmUrl from "./occt-facade/occt-wasm.wasm?url";
import { createOcctKernel } from "invariantcad/kernels/occt";

const kernel = await createOcctKernel({
  moduleFactory: ownedOcctModuleFactory,
  wasm: ownedOcctWasmUrl,
});
```

The paths and `?url` syntax are application/bundler-specific. InvariantCAD probes the loaded module before advertising draft. A stock module remains usable for its other exact features, while a partial, mismatched, or unknown owned-facade marker fails closed instead of claiming exact draft history.

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
`.artifacts/occt-facade-bundle/invariantcad-occt-facade-0.2.0/runtime/`.
Here `0.2.0` is the facade ABI/bundle version, not the npm package version.
Its JavaScript and WASM files must be loaded as a matched pair using the
`moduleFactory` and `wasm` options shown above. The archive is package-manager
neutral: it is not an npm package, does not install itself, and is never found,
downloaded, or extracted by `createOcctKernel`.

`pnpm test:occt-facade-bundle` also packs the npm library, installs that tarball
in a fresh temporary consumer, and runs direct and document-evaluated draft by
passing the verified bundle runtime explicitly. The ordinary
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
