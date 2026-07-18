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

Whole-solid offset is a separate 3D feature contract. It takes one positive distance magnitude, a materialized `outward` or `inward` direction, and a materialized absolute tolerance. Document v1 fixes skin offset semantics and round/arc transitions; it does not expose intersection, self-intersection, internal-edge, or healing switches. The operation accepts and returns exactly one valid positive-volume solid with no loose lower-dimensional topology. A result that collapses, becomes inside-out, splits into multiple bodies, or changes volume contrary to its direction is a failure. Two-dimensional profile/wire offset is intentionally reserved for a future distinct node.

Draft is an atomic selected-face feature. The document stores the exact semantic face query, signed angle, nonzero pull direction, and an arbitrary neutral plane with independent origin and nonzero normal. The angle must satisfy `1e-4 < abs(angleRadians) < pi/2`; values at or below the lower bound can become silent no-ops in the pinned kernel. Pull direction and neutral-plane normal are passed independently rather than deriving or normalizing one from the other.

### Solver layer

`SketchSolverBackend` consumes canonical sketch entities and constraints and returns solved coordinates, radii, residuals, degrees of freedom, status, and diagnostics.

Solved profiles preserve analytic lines, arcs, and circles in sketch-local coordinates. Each boundary curve may carry the stable sketch and entity IDs that generated it. Mesh kernels tessellate this representation explicitly; exact kernels consume the analytic curves directly. A solver must never force every downstream kernel to treat a sampled polygon as the authoritative design boundary.

The built-in reference solver uses damped nonlinear least squares with numerical Jacobians. It gives the core a dependency-free, permissively licensed vertical slice. Its capability declaration is deliberately separate so PlaneGCS, EZPZ, or another industrial solver can be integrated without changing documents.

### Kernel layer

`GeometryKernel` owns primitives, profile features, booleans, transformations, selected-edge fillets/chamfers, selected-face shells and drafts, whole-solid offsets, tessellation, measurements, status, and lifetime management.

`ShapeMeasurements` extends the smaller `VolumetricMassProperties` contract with required volume, surface area, bounds, genus, tolerance, center of mass, and inertia fields. `centerOfMass` is a world-coordinate `Vec3 | null`; only an empty or zero-volume result uses `null`. `InertiaTensor` is `readonly [Vec3, Vec3, Vec3]`, with rows expressed in world axes. It is the standard mechanics tensor about the center of mass, `integral(((r dot r) I - r r^T) dV)`, where `r` is center-relative, for homogeneous unit volumetric density. Its units are `mm^5`. Empty and zero-volume results carry a zero tensor.

Principal decomposition, point/line parallel-axis shifts, and radii of gyration live in a pure public TypeScript analysis layer rather than in the kernel protocol. The symmetric eigensolver scales the tensor, follows a fixed cyclic Jacobi pivot order, sorts moments ascending, canonicalizes a right-handed frame, and reports repeated-eigenvalue degeneracy separately from its deterministic representative axes. The same functions accept geometric volume-weighted or physical mass-weighted properties. They validate finite, symmetric, mechanically admissible tensors and never retain kernel handles.

The protocol is explicitly versioned. Backends declare primitive, feature, native-import, native-export, and topology capabilities; the evaluator rejects unsupported operations before invoking them. Shell capability requires face-topology selection and the complete inward/outward, fixed-round-join, explicit-tolerance contract. Offset capability requires the complete whole-solid direction, fixed-round-join, explicit-tolerance, and body-cardinality contract but no topology selector capability. Draft requires both ordinary feature support and the stronger feature-scoped `exactIndexedTopologyEvolution` v1 promise. That scoped promise guarantees complete exact draft mapping without upgrading the backend's global topology provenance beyond `feature`. Shape validity is normalized into backend-neutral status data, while meshing accepts explicit linear/angular deflection options. Stable feature IDs and cancellation signals travel through `KernelFeatureContext` without entering kernel shape handles.

A topology-capable kernel returns an evaluation-scoped snapshot of faces and edges. Each descriptor contains an opaque key, analytic geometry where available, measurements, bounds, adjacency, and proven lineage. Keys exist only to connect one snapshot to the immediately following kernel call. They are never written to a document or used as persistent identity. Snapshot validation rejects duplicate keys, non-finite geometry, dangling adjacency, and non-reciprocal adjacency as kernel protocol failures.

Semantic roles are a closed, kernel-neutral document vocabulary. A role records construction intent in per-subshape lineage: signed local box faces, unique box face-intersection edges, cylinder/cone caps and rims, the sphere surface, and extrusion caps/sides/rims/lateral edges. Extrusion side faces and start/end rim edges may additionally carry the sketch and curve entity that generated them. Kernel seams, poles, apex degeneracies, and other implementation artifacts remain unnamed.

The OCCT adapter proves broad feature lineage for primitives, extrusions, revolutions, and topology-preserving transforms. It classifies primitive roles from construction-aware geometry and maps extrusion sources with analytic per-curve seeds. A transform applies the identical operation sequence to retained input subshapes, then requires one-to-one geometric coverage before carrying their lineage forward. A missing or ambiguous match downgrades the snapshot to partial history instead of silently retargeting a selection. Boolean, fillet, chamfer, shell, and offset evolution remains partial because the pinned stock binding does not expose complete generated/modified subshape mappings. An origin selector against partial history fails explicitly; geometry-only selectors can still operate because they do not claim lost provenance.

The pinned OCCT wrapper's high-level evolution extractor omits destruction of its Embind-owned result container. InvariantCAD therefore invokes the compatible raw history entry points for fillets and chamfers, copies their result before adoption, and deterministically releases the returned container plus every input and output vector. This closes the native lifetime gap without changing the distributed WASM binary or weakening the explicit shape-ownership boundary. Exact, index-based face/edge/vertex history still belongs in the owned facade because the existing face-hash payload cannot prove complete identity.

The owned facade contains an internal atomic multi-face draft ABI with arbitrary neutral planes and an independent pull direction. It validates every adapter-trusted raw face reference before a single build, rejects the pinned kernel's silent `abs(angleRad) <= 1e-4` no-op range, and keeps the result report-owned until an exactly-once transfer into the originating kernel. Facade ABI 0.2 introduced a versioned six-field indexed evolution envelope and refuses success unless every input face, edge, and vertex has a unique same-kind result successor and every result is claimed. Its zero-based indices are evaluation-scoped positions in unique located-subshape maps, not persistent IDs, oriented occurrences, assemblies, or an incidence graph. `IsSame` defines map membership while `IsEqual` distinguishes preserved from orientation-modified occurrences. The immutable history survives report cloning and result transfer.

Facade ABI 0.3 adds a separate transactional PipeShell report. Native code validates the two wire IDs, fixes corrected-Frenet and right-corner semantics, applies the three TypeScript-selected tolerances, builds and solidifies at most once (exactly once on success), and exposes OCCT's measured surface approximation error. A successful result remains report-owned outside the arena until a same-kernel one-shot transfer. TypeScript validates exact tolerance echoes, build counters, quality bounds, transfer state, topology, body purity, authored edge geometry, and an independent transported-profile volume oracle before ownership can escape.

The TypeScript adapter validates the versioned envelope as an exact face/edge/vertex bijection before replacing broad output lineage by result index. Preserved topology inherits its source lineage; modified topology additionally records the current feature when one is available. Partial input history remains partial, while malformed exact-capability data fails as a protocol error instead of silently downgrading. It remaps semantic face keys to facade indices, cross-checks declared input and result counts against raw OCCT topology, copies report-owned data before transfer, and adopts the result transactionally.

`createOcctKernel` advertises draft only when the supplied InvariantCAD-owned generated JavaScript `moduleFactory` loads a module whose exact facade probe succeeds. The factory may locate its matched sibling WASM, or callers may provide `wasm` as an explicit binary override. Default initialization loads stock OCCT, retains its other exact features, and leaves draft plus `exactIndexedTopologyEvolution` unadvertised. A partial, unknown, or mismatched facade probe fails closed.

The owned generated pair remains outside the npm tarball. Repository tooling can
copy a completed local build into a versioned, package-neutral directory and
deterministic `.tar.gz`, add checksums, provenance, an SBOM, source/relinking
information, notices, and licenses, and verify both representations before the
packed npm library is installed in a clean temporary consumer and its public
adapter is exercised against the explicitly supplied bundled runtime. The
ordinary npm package smoke stays artifact-independent. Packaging never builds
or downloads native code, and runtime initialization never discovers or fetches
the bundle implicitly. These generated compliance materials support a release
review but do not certify legal compliance. Publishing the bundle remains a
separate, externally reviewed release step.

`ManifoldKernel` is the initial implementation. It copies upstream mesh buffers into InvariantCAD's stable `MeshData`, checks kernel status, and destroys every WASM object. Center of mass and inertia are integrated from the closed emitted polyhedron after translating coordinates near the solid, reducing cancellation at large world offsets. The public API sees only typed arrays and measurements.

The exact backend uses OpenCascade for analytic profile evaluation, B-Rep primitives and core features, native recentered B-Rep mass-property integration, exact face-selected inward/outward shelling, exact whole-solid offsets, exact STEP/BREP exchange, and the bounded semantic-topology slice described above. The matched owned facade additionally supplies atomic semantic-face draft with exact indexed face/edge/vertex evolution and controlled composite PipeShell transfer for the advertised major multi-arc/eccentric-profile refinements. Shell and offset both enforce one-solid/no-loose-topology boundaries rather than applying implicitly to disconnected bodies. The offset adapter operates on the extracted sole solid because applying the pinned raw operation to a compound wrapper can return a shell instead of a solid. It also normalizes reversed inputs before mapping direction and rejects negative-volume results rather than repairing an inside-out collapse. STL and OBJ remain backend-neutral exports of explicitly tessellated meshes. NURBS authoring, public healing controls, and complete persistent history remain roadmap work. Every backend implements the same conformance corpus, comparing toleranced geometry rather than byte-identical tessellations.

### Evaluation layer

Evaluation performs these operations in order:

1. structural and semantic validation;
2. parameter dependency resolution and bounds checking;
3. lazy feature-DAG traversal from selected outputs;
4. sketch solving;
5. geometry-derived feature/refinement and topology capability preflight, plus selector resolution for consuming features;
6. kernel feature execution and status checks;
7. part and nested-assembly occurrence resolution;
8. construction of disposable evaluated outputs.

Evaluated assemblies aggregate occurrence mass properties rather than treating their combined tessellation as one opaque measurement. Each occurrence's center and central second moment follow its full affine placement; the aggregate center and tensor then use volume weighting and parallel-axis shifts. This preserves correct translation, rotation, reflection, and nonuniform-scale semantics while counting repeated definitions once per occurrence.

Physical properties form a separate typed layer. `PartNodeIR.massDensity` is an optional `massDensity` expression in the canonical `kg/mm^3` unit, while the existing `material` string stays descriptive and has no implicit lookup behavior. A supplied density resolves during part evaluation and must be finite and strictly positive. Geometry measurements may be cached by `KernelShape`, but density-scaled results may not: multiple part definitions can deliberately share geometry while using different densities. `EvaluatedPart` scales its central volumetric properties directly. `EvaluatedAssembly` first checks that every active flattened leaf has density, transforms each cached geometric property through the occurrence's full affine placement, scales it independently, and combines bodies by mass-weighted centers and parallel-axis shifts. Missing density is a structured `CadResult` failure, while suppressed leaves and empty assemblies retain explicit zero semantics.

Composite-sweep refinement preflight is kernel-neutral. A shared classifier resolves the exact arc sweeps, computes certified analytic profile area/centroid moments, and derives the canonical `major-multiple-arcs` / `major-eccentric-profile` subset before kernel execution. Missing support produces a capability diagnostic; malformed versioned metadata produces a protocol diagnostic. Geometry that needs neither refinement does not depend on the optional envelope.

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
- Loft section stations follow the sketch-plane normal and must be strictly monotonic; document-v1 lofts are ruled solids with ordered curve-index correspondence.
- Polyline sweep paths are open, explicitly segmented 3D values. Document-v1 solid sweeps seat a hole-free profile at the path start, require its plane normal to be parallel to the first segment in either direction, and use corrected-Frenet transport with right-corner intersection transitions.
- Circular-arc sweep paths are one exact oriented circle trajectory selected by authored start, through, and end points. They use the analytic start tangent, admit minor or major arcs below one full turn, and require the profile envelope to remain strictly inside the circumradius. For one circular edge, corrected-Frenet transport is exactly a revolution about the resolved circle axis; the OCCT adapter snaps a profile origin already within the admitted tolerance to the exact path start, uses that specialized construction, supports near-full open arcs without an artificial endpoint-clearance rule, and adds a minimum three-point triangle-angle sine floor of `3e-8`.
- Composite sweep paths are ordered exact line/circular-arc chains. Every segment start is structurally the preceding endpoint, so no tolerance healing or independent reorientation is permitted. The current bounded contract requires at least two segments and one arc, permits right-corner line-line joins, requires forward G1 tangency at every arc-bearing join, and rejects redundant same-line/same-circle splits. Minor, major, and near-full traversals below one turn share the same exact arc representation. For each adjacent arc-bearing pair, only the triangular intrinsic domain below `(π - junctionTurn) * min(radius)` is treated as the shared local neighborhood; every remaining parameter pair is certified by recursive exact-chord and circular-sagitta distance bounds. The same bounds certify all nonadjacent line/arc pairs. Path simplicity uses path tolerance, sweep clearance uses the complete profile diameter plus tolerance, and numeric ambiguity fails explicitly instead of becoming sampled acceptance. Arcs strictly above `π + 1e-12` trigger refinement classification. Exact line/arc/circle Green-theorem moments determine the seated local profile centroid; semantic holes subtract independently of authored winding, and compensated arithmetic plus explicit roundoff bounds prevents an equality-at-tolerance profile from being spuriously classified as eccentric.
- Circular-revolution results retain the exact swept volume computed from the planar profile area, the profile-normal component of its centroid's rotational velocity, and the selected sweep. This is Pappus's theorem under exact tangent alignment and remains correct for the small tolerance-admitted angular mismatch. It avoids cancellation in OCCT's native volume integration for very thin sections at large radii; rigid transforms preserve the value and scale transforms apply their absolute determinant.
- When a sweep carries that authoritative analytic volume, OCCT's native central tensor is rescaled by the analytic-to-native volume ratio after recentered integration. The native center is unchanged. This keeps the returned density-one volume and tensor mutually normalized without replacing exact sweep-volume semantics.
- Circular and composite volume semantics use the analytic local area/centroid moments as their sole source. Arc geometry exposes a center offset from its authored start, and volume identities consume that plus the seated centroid offset, so neither path nor profile arithmetic reconstructs a small relative vector by subtracting rounded world coordinates. OCCT profile-face area and centroid are retained only as an independent certificate before path allocation. Its allowance combines analytic roundoff, exact boundary length, a conservative boundary radius about the actual centroid offset, modeling tolerance, reliable remaining area, and per-world-axis ULPs; the plane-normal axis is checked separately and cannot loosen in-plane agreement. Circular transfer then uses the certified native face area/centroid and the actual rounded OCCT revolution axis to reproduce the analytic target inside that same representability envelope before allocating the result; this checks construction drift without relying on cancellation-prone native solid-volume integration. A profile mismatch raises the runtime-frozen `OcctProfileMassPropertyError` with a stable reason and numeric diagnostics.
- OCCT pipe-shell transfer is used for polyline and composite sweeps and rejects profile or spine edges at or below the conservative `1e-4 mm` transfer floor before allocating native sweep topology. Composite arcs also require all three authored point-pair separations above that floor and the `3e-8` three-point conditioning floor. Exact segment type, endpoints, tangents, length, wire cardinality/length, result validity, body purity, and segment-to-profile face correspondence are checked before ownership transfers. The stock binding does not expose PipeShell's coarse angular tolerance, so the shared preflight admits a stock major-arc composite only when it needs neither the multi-arc nor eccentric-profile refinement. Direct calls classify against the requested context tolerance, matching document evaluation rather than silently substituting the adapter's modeling tolerance. ABI 0.3 applies explicit linear/boundary tolerances and a `1e-9` angular tolerance, rejects measured surface error above the selected linear bound, and certifies major multi-arc/eccentric-profile results. All composite volumes must agree with the compensated transported-centroid oracle; strong term cancellation or an unsupported miter fails closed.
- Measurement precision follows the representation. OCCT integrates the B-Rep natively, while Manifold integrates its emitted closed polyhedron; assembly aggregation uses those occurrence properties. Cross-backend comparisons therefore use modeling or meshing tolerances, not bitwise equality.
- Transform operations are applied in list order.

## Backend conformance

Every geometry kernel should run the same corpus for:

- primitives and transforms;
- nested profile holes;
- extrude, partial/full revolve, and bounded ruled solid lofts;
- explicit open polyline/circular-arc/composite paths and bounded exact solid sweeps;
- overlapping and empty booleans;
- bounds, volume, surface area, center of mass, centroidal inertia, and topological class;
- translated, rotated, reflected, nonuniformly scaled, and multi-occurrence mass-property aggregation, including parallel-axis behavior;
- parameter extremes and degenerate geometry;
- cancellation and resource teardown;
- topology set semantics, cardinality, adjacency reciprocity, and history loss;
- primitive role inventories, sketch-source mapping, negative/symmetric sweeps, and provenance-preserving transforms;
- selector-driven features without enumeration-order dependence;
- exact shell openings, inward/outward direction, tolerance validation, and collapse rejection;
- exact whole-solid offsets, fixed round joins, direction/volume monotonicity, strict body cardinality, and collapse rejection;
- atomic semantic-face draft, signed-angle bounds, independent pull/neutral-plane vectors, exact indexed evolution, and transactional ownership;
- ruled loft profile compatibility, monotonic section order, strict output topology cardinality, and transactional ownership;
- polyline, circular-arc, and composite sweep simplicity/clearance, exact profile moments, geometry-derived additive refinement preflight, tolerance boundaries, frame and transition semantics, strict one-body validation, and transactional ownership;
- Node and browser initialization.

Results are compared by tolerances and topological expectations, never by triangle ordering or exported-file bytes.
