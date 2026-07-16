# InvariantCAD

Comprehensive, type-safe CAD-as-code for TypeScript.

InvariantCAD represents a design as immutable, versioned JSON and evaluates it through replaceable geometry and sketch-solver backends. The public API never exposes WASM pointers or kernel-specific objects.

> **Project status:** `0.1.0` is the released-foundation target. Current main adds an exact OpenCascade B-Rep backend, analytic sketch-profile transfer, STEP/BREP exchange, closed semantic topology roles, sketch-boundary provenance, and exact selector-driven fillets and equal-distance chamfers. Complete topology history through topology-changing features and other advanced mechanical features remain under active development; see the [support matrix](#support-matrix) and [roadmap](docs/roadmap.md).

## Install

```bash
pnpm add invariantcad
```

Node.js 20.19 or newer is required. The core API is ESM and also targets modern browsers.

## Quick start

```ts
import {
  createEvaluator,
  design,
  mm,
  plane,
  vec2,
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

The backend is explicitly selected; a design document never contains OCCT handles or backend-specific objects.

### Semantic topology, fillets, and chamfers

Topology selections describe intent as set queries. They never persist a face index, edge index, OCCT handle, or transient hash. This source-aware selector keeps identifying the same extrusion rim after a 90-degree rotation and across width/height parameter crossovers:

```ts
import {
  angleVec3,
  deg,
  design,
  mm,
  plane,
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
```

The current chamfer mode applies one constant, equal setback distance on both incident faces. That produces a 45-degree bevel where the faces are orthogonal. Distance-angle, asymmetric, and variable chamfers are not supported yet.

For both fillets and chamfers, `edges` selects contour seeds rather than hard stopping boundaries. Each seed expands to the maximal connected contour of tangent edges that continues between tangent face chains on both sides. A closed tangent contour expands around the complete loop, and multiple seeds on the same contour apply the operation only once. Selector cardinality constrains the seed set, not the number of input edges ultimately modified. Expansion stops at sharp, disconnected, degenerate, non-manifold, boundary, or ambiguous junctions. Continuity at a modeling-tolerance boundary can remain kernel-dependent; this mode cannot yet express “stop at this otherwise tangent vertex.”

The serialized role vocabulary is closed and exported through `TOPOLOGY_ROLES` and `TOPOLOGY_ROLE_RULES`:

| Producer | Stable face roles | Stable edge roles |
|---|---|---|
| Box | signed local faces such as `box.face.x-min` | unique face intersections such as `box.edge.x-min-y-min` |
| Cylinder or cone | start/end caps and side | start/end rims |
| Sphere | `sphere.face.surface` | none; seam and pole artifacts stay unnamed |
| Extrusion | start/end caps and source-aware sides | source-aware start/end rims and unsourced lateral edges |

`start` and `end` follow construction parameterization, not current world orientation. A topology-preserving transform retains the original role/source lineage and adds `modified` lineage for the transform. Cylinder seams, cone apex artifacts, sphere seams/poles, and other kernel artifacts are deliberately unnamed so a document cannot accidentally depend on their enumeration.

Selectors also support curve/surface kind, edge direction, face normal, radius, adjacency, `and`/`or`/`not`, and explicit cardinality. Zero matches produce `TOPOLOGY_SELECTION_MISSING`; excess matches produce `TOPOLOGY_SELECTION_AMBIGUOUS`. The exact backend currently provides complete broad feature provenance for primitives, extrusions, revolutions, and topology-preserving transforms, plus the semantic roles and sketch sources above. It marks boolean, fillet, and chamfer history partial, so provenance queries on those results fail with `TOPOLOGY_HISTORY_UNAVAILABLE` rather than choosing an unstable edge. Manifold reports an explicit capability error for selector-driven fillets and chamfers.

## What works today

### Modeling

- Dimension-safe length, angle, and scalar expression trees
- Parameters with defaults, limits, overrides, dependency resolution, and cycle detection
- Box, cylinder/cone, and sphere primitives
- Sketches on XY, XZ, and YZ planes
- Points, lines, circles, arcs, polylines, rectangles, and regular polygons
- Explicit outer loops and hole loops
- Extrude, symmetric extrude, and revolve on both kernels
- Twist and top-scale extrusion through the Manifold mesh backend
- Union, subtraction, and intersection
- Semantic face/edge set selectors with closed roles, sketch sources, and explicit cardinality
- Exact constant-radius edge fillets through the OCCT backend
- Exact constant equal-distance edge chamfers through the OCCT backend
- Translation, Euler rotation, nonuniform scale, and mirror
- Parts with part number, material, description, and metadata
- Fixed-placement and nested assemblies with shared part definitions

### Sketch constraints

The permissively licensed reference solver currently supports coincidence, horizontal, vertical, fixed, distance, X/Y distance, line length, parallel, perpendicular, equal length, angle, radius, diameter, equal radius, midpoint, and line-circle tangency.

The solver API is replaceable. The built-in solver is intentionally a v0.1 reference implementation; industrial conflict isolation, redundant-constraint reporting, drag solving, and large sparse systems remain roadmap work.

### Evaluation and interchange

- Reliable manifold-mesh CSG through `manifold-3d` WebAssembly
- Exact B-Rep primitives, analytic profile extrusion/revolution, CSG, and transforms through OpenCascade WebAssembly
- Exact topology enumeration, geometry/adjacency descriptors, and selected-edge fillets/chamfers through OpenCascade WebAssembly
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
| Shell and draft | No | Exact backend |
| Persistent face/edge selectors | Primitive/extrusion roles and sources; origin/geometry/adjacency queries | Yes |
| Drawings, GD&T, PMI | No | Yes |
| Sheet metal | No | Yes |
| CAM and CAE adapters | No | Yes |
| STL and OBJ export | Yes | Yes |

Capabilities are negotiated by backends. InvariantCAD will not silently pretend a mesh operation is exact B-Rep or silently downgrade exact geometry.

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
The CLI selects OCCT automatically for `.step` and `.brep` destinations. Use `--kernel manifold|occt` to select a backend explicitly.

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
```

The bracket example writes its document and STL to `.artifacts/`.

## License

InvariantCAD is Apache-2.0 licensed. The default mesh backend uses the Apache-2.0 licensed Manifold library. The optional-at-runtime OCCT backend depends on `occt-wasm` and compiled OpenCascade code under LGPL-2.1 with the OCCT exception. Dependency notices, corresponding-source information, and replacement rights must be preserved in distributions.
