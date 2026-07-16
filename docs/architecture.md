# InvariantCAD architecture

InvariantCAD separates design intent from computation. A document must remain useful after any particular kernel, solver, renderer, or application has disappeared.

## Non-negotiable invariants

1. **The document is plain data.** `DesignDocument` contains JSON values, stable IDs, expression trees, feature nodes, and references. It never contains callbacks, class instances, maps, BigInts, WASM handles, or native pointers.
2. **Units are explicit.** Internal lengths are millimetres, angles are radians, and scalar expressions are dimensionless. TypeScript rejects incompatible expression composition and semantic validation repeats the check for untrusted JSON.
3. **Modeling is a DAG.** Nodes reference earlier or later nodes by stable ID, not array position. Validation detects missing references, kind mismatches, and cycles before a kernel is invoked.
4. **Kernel conversions are explicit.** The Manifold backend is a robust triangle-mesh kernel. It is not advertised as exact B-Rep. A future exact backend must declare its representation and conversion losses.
5. **Topology is not an array index.** Public APIs never make `faces[3]` or `edges[7]` a durable design reference. Serialized selectors combine feature provenance, geometry, adjacency, set algebra, and explicit cardinality. Evaluation-scoped kernel keys are opaque and disposable.
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

Topology selectors are also plain document data. Commutative `and` and `or` operands are flattened, deduplicated, and canonically sorted for serialization and hashing. A selector resolves to an unordered set and must state its accepted cardinality; evaluation never breaks ambiguity by taking the first kernel result.

### Solver layer

`SketchSolverBackend` consumes canonical sketch entities and constraints and returns solved coordinates, radii, residuals, degrees of freedom, status, and diagnostics.

Solved profiles preserve analytic lines, arcs, and circles in sketch-local coordinates. Each boundary curve may carry the stable sketch and entity IDs that generated it. Mesh kernels tessellate this representation explicitly; exact kernels consume the analytic curves directly. A solver must never force every downstream kernel to treat a sampled polygon as the authoritative design boundary.

The built-in reference solver uses damped nonlinear least squares with numerical Jacobians. It gives the core a dependency-free, permissively licensed vertical slice. Its capability declaration is deliberately separate so PlaneGCS, EZPZ, or another industrial solver can be integrated without changing documents.

### Kernel layer

`GeometryKernel` owns primitives, profile features, booleans, transformations, tessellation, measurements, status, and lifetime management.

The protocol is explicitly versioned. Backends declare primitive, feature, native-import, native-export, and topology capabilities; the evaluator rejects unsupported operations before invoking them. Shape validity is normalized into backend-neutral status data, while meshing accepts explicit linear/angular deflection options. Stable feature IDs and cancellation signals travel through `KernelFeatureContext` without entering kernel shape handles.

A topology-capable kernel returns an evaluation-scoped snapshot of faces and edges. Each descriptor contains an opaque key, analytic geometry where available, measurements, bounds, adjacency, and proven lineage. Keys exist only to connect one snapshot to the immediately following kernel call. They are never written to a document or used as persistent identity. Snapshot validation rejects duplicate keys, non-finite geometry, dangling adjacency, and non-reciprocal adjacency as kernel protocol failures.

The OCCT adapter currently proves broad feature lineage for primitives, extrusions, revolutions, and topology-preserving transforms. Boolean and fillet evolution is marked partial because the pinned binding does not expose complete edge history. An origin selector against partial history fails explicitly. Geometry-only selectors can still operate because they do not claim lost provenance.

`ManifoldKernel` is the initial implementation. It copies upstream mesh buffers into InvariantCAD's stable `MeshData`, checks kernel status, and destroys every WASM object. The public API sees only typed arrays and measurements.

The exact backend uses OpenCascade for analytic profiles, NURBS/B-Rep, healing, exact exchange, mechanical features, and persistent topology. STEP and BREP are native kernel exchange formats; STL and OBJ remain backend-neutral exports of explicitly tessellated meshes. Every backend implements the same conformance corpus, comparing toleranced geometry rather than byte-identical tessellations.

### Evaluation layer

Evaluation performs these operations in order:

1. structural and semantic validation;
2. parameter dependency resolution and bounds checking;
3. lazy feature-DAG traversal from selected outputs;
4. sketch solving;
5. topology capability preflight and selector resolution for consuming features;
6. kernel feature execution and status checks;
7. part and nested-assembly occurrence resolution;
8. construction of disposable evaluated outputs.

One feature is evaluated once per run. Cross-run content-addressed caching is planned after topology and kernel-version fingerprints are formalized.

Evaluated shapes are owned by exactly one evaluation result. Disposing that result releases its backend handles; disposing it again is safe. A kernel rejects foreign handles, and destroying the kernel releases any shapes that remain live.

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
- topology set semantics, cardinality, adjacency reciprocity, and history loss;
- selector-driven features without enumeration-order dependence;
- Node and browser initialization.

Results are compared by tolerances and topological expectations, never by triangle ordering or exported-file bytes.
