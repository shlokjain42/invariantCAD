# InvariantCAD architecture

InvariantCAD separates design intent from computation. A document must remain useful after any particular kernel, solver, renderer, or application has disappeared.

## Non-negotiable invariants

1. **The document is plain data.** `DesignDocument` contains JSON values, stable IDs, expression trees, feature nodes, and references. It never contains callbacks, class instances, maps, BigInts, WASM handles, or native pointers.
2. **Units are explicit.** Internal lengths are millimetres, angles are radians, and scalar expressions are dimensionless. TypeScript rejects incompatible expression composition and semantic validation repeats the check for untrusted JSON.
3. **Modeling is a DAG.** Nodes reference earlier or later nodes by stable ID, not array position. Validation detects missing references, kind mismatches, and cycles before a kernel is invoked.
4. **Kernel conversions are explicit.** The Manifold backend is a robust triangle-mesh kernel. It is not advertised as exact B-Rep. Every exact backend must declare its representation and conversion losses.
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

Document schema v1 remains pre-freeze while the unreleased `0.1.0` foundation is assembled. Publishing `0.1.0` freezes that grammar: later strict grammar expansions require a new document version and an explicit migration path. Compatibility tests pin the canonical hash of a pre-chamfer v1 document.

Topology selectors are also plain document data. Commutative `and` and `or` operands are flattened, deduplicated, and canonically sorted for serialization and hashing. A selector resolves to an unordered set and must state its accepted cardinality; evaluation never breaks ambiguity by taking the first kernel result.

Selected edges for fillets and chamfers are tangent-contour seeds, not hard modification boundaries. Every seed expands to the maximal connected contour whose consecutive edges are tangent and whose incident face chains continue tangentially on both sides. Duplicate or overlapping seeds are idempotent, and selector cardinality applies before this expansion. Backends use their effective B-Rep tolerances to classify continuity, so geometry near a tolerance boundary can still differ between kernels; a future explicit stopping-boundary mode must be a distinct serialized contract.

Shell openings are exact selected input faces, not propagation seeds. No tangent or coplanar neighbor is removed unless the selector also matches it, so shell selector cardinality describes the actual opening set. Shell thickness is a positive magnitude; serialized `inward` and `outward` directions determine which side of the unselected input boundary receives the offset wall. Document v1 fixes offset-face transitions to round/arc joins, and kernel conformance checks geometry that distinguishes those joins from intersection/miter behavior. The authoring API materializes its default `inward` direction and absolute reconstruction tolerance in every shell node, making both part of canonical serialization and semantic hashing. Tolerance must be positive and less than thickness.

### Solver layer

`SketchSolverBackend` consumes canonical sketch entities and constraints and returns solved coordinates, radii, residuals, degrees of freedom, status, and diagnostics.

Solved profiles preserve analytic lines, arcs, and circles in sketch-local coordinates. Each boundary curve may carry the stable sketch and entity IDs that generated it. Mesh kernels tessellate this representation explicitly; exact kernels consume the analytic curves directly. A solver must never force every downstream kernel to treat a sampled polygon as the authoritative design boundary.

The built-in reference solver uses damped nonlinear least squares with numerical Jacobians. It gives the core a dependency-free, permissively licensed vertical slice. Its capability declaration is deliberately separate so PlaneGCS, EZPZ, or another industrial solver can be integrated without changing documents.

### Kernel layer

`GeometryKernel` owns primitives, profile features, booleans, transformations, selected-edge fillets/chamfers, selected-face shells, tessellation, measurements, status, and lifetime management.

The protocol is explicitly versioned. Backends declare primitive, feature, native-import, native-export, and topology capabilities; the evaluator rejects unsupported operations before invoking them. Shell capability requires face-topology selection and the complete inward/outward, fixed-round-join, explicit-tolerance contract. Shape validity is normalized into backend-neutral status data, while meshing accepts explicit linear/angular deflection options. Stable feature IDs and cancellation signals travel through `KernelFeatureContext` without entering kernel shape handles.

A topology-capable kernel returns an evaluation-scoped snapshot of faces and edges. Each descriptor contains an opaque key, analytic geometry where available, measurements, bounds, adjacency, and proven lineage. Keys exist only to connect one snapshot to the immediately following kernel call. They are never written to a document or used as persistent identity. Snapshot validation rejects duplicate keys, non-finite geometry, dangling adjacency, and non-reciprocal adjacency as kernel protocol failures.

Semantic roles are a closed, kernel-neutral document vocabulary. A role records construction intent in per-subshape lineage: signed local box faces, unique box face-intersection edges, cylinder/cone caps and rims, the sphere surface, and extrusion caps/sides/rims/lateral edges. Extrusion side faces and start/end rim edges may additionally carry the sketch and curve entity that generated them. Kernel seams, poles, apex degeneracies, and other implementation artifacts remain unnamed.

The OCCT adapter proves broad feature lineage for primitives, extrusions, revolutions, and topology-preserving transforms. It classifies primitive roles from construction-aware geometry and maps extrusion sources with analytic per-curve seeds. A transform applies the identical operation sequence to retained input subshapes, then requires one-to-one geometric coverage before carrying their lineage forward. A missing or ambiguous match downgrades the snapshot to partial history instead of silently retargeting a selection. Boolean, fillet, chamfer, and shell evolution remains partial because the pinned binding does not expose complete generated/modified subshape mappings. An origin selector against partial history fails explicitly; geometry-only selectors can still operate because they do not claim lost provenance.

`ManifoldKernel` is the initial implementation. It copies upstream mesh buffers into InvariantCAD's stable `MeshData`, checks kernel status, and destroys every WASM object. The public API sees only typed arrays and measurements.

The exact backend uses OpenCascade for analytic profile evaluation, B-Rep primitives and core features, exact face-selected inward/outward shelling, exact STEP/BREP exchange, and the bounded semantic-topology slice described above. A shell accepts exactly one solid with no loose lower-dimensional topology, at least one opening face, and at least one retained face; it must return one valid positive-volume solid rather than applying implicitly to disconnected bodies. STL and OBJ remain backend-neutral exports of explicitly tessellated meshes. NURBS authoring, public healing controls, and complete persistent history remain roadmap work. Every backend implements the same conformance corpus, comparing toleranced geometry rather than byte-identical tessellations.

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
- primitive role inventories, sketch-source mapping, negative/symmetric sweeps, and provenance-preserving transforms;
- selector-driven features without enumeration-order dependence;
- exact shell openings, inward/outward direction, tolerance validation, and collapse rejection;
- Node and browser initialization.

Results are compared by tolerances and topological expectations, never by triangle ordering or exported-file bytes.
