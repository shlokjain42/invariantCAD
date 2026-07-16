# InvariantCAD architecture

InvariantCAD separates design intent from computation. A document must remain useful after any particular kernel, solver, renderer, or application has disappeared.

## Non-negotiable invariants

1. **The document is plain data.** `DesignDocument` contains JSON values, stable IDs, expression trees, feature nodes, and references. It never contains callbacks, class instances, maps, BigInts, WASM handles, or native pointers.
2. **Units are explicit.** Internal lengths are millimetres, angles are radians, and scalar expressions are dimensionless. TypeScript rejects incompatible expression composition and semantic validation repeats the check for untrusted JSON.
3. **Modeling is a DAG.** Nodes reference earlier or later nodes by stable ID, not array position. Validation detects missing references, kind mismatches, and cycles before a kernel is invoked.
4. **Kernel conversions are explicit.** The Manifold backend is a robust triangle-mesh kernel. It is not advertised as exact B-Rep. A future exact backend must declare its representation and conversion losses.
5. **Topology is not an array index.** Public APIs must never make `faces[3]` or `edges[7]` a durable design reference. Feature provenance, geometry signatures, adjacency, and ambiguity diagnostics will form persistent selectors.
6. **Failures are structured.** Normal modeling failures produce stable diagnostics with node IDs and JSON Pointer paths. Programmer misuse of the builder can throw immediately.
7. **WASM lifetime is explicit.** Evaluated results own kernel shapes and expose `dispose()`. Kernel objects never escape through the public mesh or measurement APIs.

## Layers

### Authoring layer

`DesignBuilder`, `SketchBuilder`, dimensioned expressions, and typed references make documents pleasant to create. Builders may mutate internally, but `build()` returns a recursively frozen document.

Explicit names are required for public features and sketch entities. This makes source diffs and diagnostics stable under insertion and reordering.

### Document layer

`DesignDocument` is the source of truth:

- schema and independent schema version;
- base-unit policy;
- parameter definitions and expression ASTs;
- sketch geometry, constraints, and explicit profiles;
- feature DAG;
- parts, assembly occurrences, and outputs;
- optional JSON metadata.

Canonical serialization sorts object keys and rejects values JSON cannot preserve. Semantic hashes exclude display metadata by default.

### Solver layer

`SketchSolverBackend` consumes canonical sketch entities and constraints and returns solved coordinates, radii, residuals, degrees of freedom, status, and diagnostics.

Solved profiles preserve analytic lines, arcs, and circles in sketch-local coordinates. Each boundary curve may carry the stable sketch and entity IDs that generated it. Mesh kernels tessellate this representation explicitly; exact kernels consume the analytic curves directly. A solver must never force every downstream kernel to treat a sampled polygon as the authoritative design boundary.

The built-in reference solver uses damped nonlinear least squares with numerical Jacobians. It gives the core a dependency-free, permissively licensed vertical slice. Its capability declaration is deliberately separate so PlaneGCS, EZPZ, or another industrial solver can be integrated without changing documents.

### Kernel layer

`GeometryKernel` owns primitives, profile features, booleans, transformations, tessellation, measurements, status, and lifetime management.

`ManifoldKernel` is the initial implementation. It copies upstream mesh buffers into InvariantCAD's stable `MeshData`, checks kernel status, and destroys every WASM object. The public API sees only typed arrays and measurements.

The exact backend uses OpenCascade for NURBS/B-Rep, healing, exact exchange, mechanical features, and persistent topology. It must implement the same conformance corpus but compare toleranced geometry rather than byte-identical tessellations.

### Evaluation layer

Evaluation performs these operations in order:

1. structural and semantic validation;
2. parameter dependency resolution and bounds checking;
3. lazy feature-DAG traversal from selected outputs;
4. sketch solving;
5. kernel feature execution and status checks;
6. part and nested-assembly occurrence resolution;
7. construction of disposable evaluated outputs.

One feature is evaluated once per run. Cross-run content-addressed caching is planned after topology and kernel-version fingerprints are formalized.

## Coordinate conventions

- Right-handed 3D coordinates.
- Millimetres and radians in documents.
- Positive extrusion follows the sketch-plane normal.
- Principal-plane bases are:
  - XY: `U=+X`, `V=+Y`, `N=+Z`
  - XZ: `U=+X`, `V=+Z`, `N=-Y`
  - YZ: `U=+Y`, `V=+Z`, `N=+X`
- Revolve uses the sketch's local V/Y axis.
- Transform operations are applied in list order.

## Backend conformance

Every geometry kernel should run the same corpus for:

- primitives and transforms;
- nested profile holes;
- extrude and partial/full revolve;
- overlapping and empty booleans;
- bounds, volume, surface area, and topological class;
- parameter extremes and degenerate geometry;
- cancellation and resource teardown;
- Node and browser initialization.

Results are compared by tolerances and topological expectations, never by triangle ordering or exported-file bytes.
