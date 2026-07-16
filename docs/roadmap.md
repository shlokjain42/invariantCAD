# InvariantCAD roadmap

InvariantCAD's goal is one coherent TypeScript CAD system, not one monolithic geometry algorithm. Specialized kernels and solvers sit behind versioned protocols while the TypeScript API, document model, diagnostics, and design semantics remain stable.

## 0.1 — executable foundation

- Versioned, canonical design IR
- Dimensioned expressions and bounded parameters
- Sketch entities, explicit profiles, and reference constraint solver
- Mesh primitives, extrude, revolve, booleans, and transforms
- Parts and fixed-placement nested assemblies
- Measurement, mesh extraction, STL/OBJ export
- Validation, diagnostics, hashing, CLI, examples, and conformance tests

## 0.2 — exact mechanical modeling

- OpenCascade WASM/native backend
- Curve-preserving resolved profiles with sketch-entity provenance
- Exact primitives, extrude, revolve, booleans, and transforms
- Exact lines, circles, conics, NURBS curves, and NURBS surfaces
- STEP and OCCT BREP import/export, followed by IGES
- Shape healing and validity diagnostics
- Explicit exact-to-mesh conversion with tolerances
- Evaluation-scoped face/edge topology snapshots and capability negotiation
- Semantic origin/geometry/adjacency selectors with explicit cardinality
- Closed primitive/extrusion roles and sketch-curve source provenance through transforms
- First exact constant-radius fillet driven by semantic edge selection
- First exact equal-distance chamfer driven by semantic edge selection
- First exact constant-thickness inward/outward shell driven by semantic face openings

## 0.3 — persistent design intent

- Complete per-subshape provenance through booleans, fillets, chamfers, shells, revolutions, and generated/modified topology
- Expanded role and source mapping for additional feature families
- Geometry and adjacency signatures
- Expanded selection diagnostics and provenance explanations
- Incremental feature hashes and cross-run cache
- Change-impact and geometric diff APIs

## 0.4 — advanced mechanical features

- Asymmetric, distance-angle, and variable chamfer modes through semantic selectors
- Draft and variable fillet through semantic selectors
- Closed, variable-thickness, and intersection/miter-join shell modes
- Sweep, loft, pipe, and offset
- Feature-specific validity and healing diagnostics
- Parameter-torture corpus for persistent selections

## 0.5 — mechanical assemblies

- Assembly mate/joint solver protocol
- Planar, cylindrical, concentric, distance, angle, gear, rack, and screw relations
- Degrees of freedom and motion studies
- Interference, clearance, and contact queries
- Bills of material and configurations

## 0.6 — documentation and manufacturing

- Drawing views, sections, details, dimensions, tolerances, and title blocks
- PMI and GD&T model
- DXF/SVG/PDF drawing export
- Sheet-metal bends, flat patterns, and bend tables
- CAM stock, setups, operations, tool libraries, and postprocessor protocol
- Additive-manufacturing checks and 3MF export

## 1.0 criteria

- Stable document schema and migration policy
- Stable public TypeScript API
- Exact B-Rep and mesh backends passing the conformance corpus
- Industrial sketch and assembly solver integrations
- Persistent topology robust across the published torture suite
- Browser, Node, worker, and server deployments
- Reproducible packages, SBOM, license notices, and security policy
- Performance budgets and leak-free long-running evaluation
