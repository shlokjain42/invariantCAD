# Changelog

## [Unreleased]

- Breaking: the general Document v1-v6 APIs no longer accept Document v7,
  including imported-body JSON and mixed pairs such as a v7 schema with another
  version. `validateDocument`, `parseDocument`, `parseDocumentValue`,
  `migrateDocument`, `hashDesignFeatures`, `analyzeDesignImpact`, and
  `Evaluator.evaluate` return one `IR_INVALID` diagnostic at `/` whose hint
  names `parseImportedBodyDocument`, `stringifyImportedBodyDocument`, and
  `Evaluator.evaluateImportedBody`. `stringifyDocument`, `hashDocument`, and
  `cloneDocument` throw a `TypeError` whose message is that diagnostic's message
  followed by its hint. Code that passed Document v7 JSON to these APIs must
  stop doing so; imported-body documents go through the three imported-body
  functions instead. Before, `validateDocument`, `stringifyDocument`, and
  `hashDocument` accepted v7 JSON such as a parsed imported-body document, and
  `Evaluator.evaluate` failed with an unrelated `KERNEL_ERROR`. Documents v1-v6
  validate, serialize, and hash exactly as before.
- Breaking: builder option records must be plain objects, whose prototype is
  `null` or `Object.prototype`. This covers the options of `design`,
  `parameter`, `material`, `part`, the primitives, `sketch`, the paths,
  `extrude`, `revolve`, `loft`, `sweep`, `fillet`, `chamfer`, `shell`, `offset`,
  `draft`, assembly `instance`, and `configuration`, and of the `SketchBuilder`
  `circle`, `arc`, `rectangle`, `polyline`, `regularPolygon`, and `profile`
  methods and `CircleRef.loop`. Each own string-keyed field is read once,
  whether enumerable or not, so a field defined as non-enumerable is honored
  instead of being replaced by its default. A class instance or other record
  with a custom prototype, or an accessor-backed field, throws `TypeError`
  without running the accessor, and a record with more than 1,000,000 own fields
  (the default `maxStructuralValues`) throws `TypeError` before any field is
  copied. Fields inherited from `Object.prototype` are never read. Unused fields
  are still ignored, except in `part()`, which rejects them. Callers that pass
  class instances or getter-backed objects as options must pass plain object
  literals instead.
- Breaking: caller lists and records stored in documents (path points and
  segments, loft profiles, Boolean tools, transform operations, placements,
  plane IR, sketch coordinate pairs, raw loop edge uses, profile holes, and
  topology selections) are read once through own data properties. Lists must be
  plain dense arrays and records must be plain objects: an array subclass, a
  sparse or inherited array entry, an accessor-backed entry or field, a record
  with a custom prototype, or a record with more than 1,000,000 own fields
  throws `TypeError`, and a list longer than its authoring limit throws
  `RangeError`. Callers that pass such values must pass plain arrays and object
  literals instead.
- `parseDocument(text, options?)` now rejects JSON that repeats an object member
  name, including escape-equivalent spellings such as `"name"` and
  `"\u006eame"`, with `IR_INVALID` and the `duplicate-json-member` reason.
  Native `JSON.parse` silently kept the last value, which another JSON parser
  may resolve differently. InvariantCAD never writes such text, but documents
  that contain it were ambiguous and now fail. Raw `maxStructuralValues` and
  `maxNestingDepth` ceilings also charge the subtrees that last-key-wins parsing
  erased. The UTF-8 size check stops at `maxDocumentBytes` instead of encoding
  the whole text, so its `actual` detail is the size observed when measurement
  stopped, as for the other ceilings. `text` must be a primitive string; a
  `String` object or other value is now rejected rather than coerced. Valid
  documents parse exactly as before. The repository-staged Document v7 text
  parser rejects duplicate decoded member names the same way, before schema and
  semantic validation. `parseDocumentValue`, `migrateDocument`, and the staged
  detached-value parsers and direct schemas receive already-parsed values and
  cannot detect duplicates an upstream parser collapsed.
- `validateDocument` and `Evaluator.evaluate` now return `IR_INVALID` instead of
  throwing a `TypeError` for an in-memory document with an unsupported
  schema/version pair or a node kind outside its version's grammar. An
  unsupported identity is reported alone, at `/`, without follow-on diagnostics
  from rules that assume a known version.
- `stringifyDocument`, `cloneDocument`, and `hashDocument` accept
  `options.limits` and count the frozen canonical bytes, compact or pretty,
  before building the canonical tree or string. Normalizing commutative topology
  queries never builds an operand key larger than the ceiling. Output above
  `maxDocumentBytes` (64 MiB by default) throws `TypeError`, and malformed
  limits throw `TypeError`. Admitted output, including the frozen omission of an
  own `__proto__` key, and every semantic hash are unchanged.
  `HashDocumentOptions` names the `hashDocument` options type. The
  repository-staged Document v7 serializer is bounded the same way: compact and
  pretty output is counted exactly after topology normalization and rejected
  before the complete canonical object tree, JSON text, or UTF-8 buffer is
  built, and cloning enforces the same canonical-byte ceiling without
  serializing.
- `analyzeDesignImpact` now accepts as a change seed any node or parameter key
  the parsed document contains, including keys that frozen v1-v6 documents
  preserve but the builder would not author, such as `"node with space"`,
  `"1width"`, or an empty key. 0.1.1 rejected such seeds with `IR_INVALID`, even
  though parsing and feature hashing accept the same document. Unknown seeds,
  including ones outside the builder ID grammar, now report `REFERENCE_MISSING`,
  `PARAMETER_MISSING`, or `CONFIGURATION_MISSING` at their `/changes` path
  instead of `IR_INVALID`, and non-string seeds still fail with `IR_INVALID`.
  Parameter dependency edges no longer collide when stored parameter keys
  contain NUL, so every impacted parameter is reported.
- Builder methods now throw `TypeError` when an expression uses a `Parameter`
  from another `DesignBuilder`. This applies wherever the parameter appears:
  primitive sizes, sketch entities and constraints, paths, features, transforms
  and placements, topology predicates, parameter defaults and bounds, densities,
  and configuration values. Before, only `configuration(...).parameter(...)`
  checked ownership. Elsewhere a foreign parameter silently bound to a same-ID
  parameter of the consuming design and produced the wrong geometry, or left a
  reference that failed later with `PARAMETER_MISSING`. Raw IR passed through
  `fromExpressionIR` refers to parameters by ID and is accepted only when it
  names a parameter the builder already defines, with the same dimension.
- Builder methods now check option values when they are called, so `build()`
  output always satisfies the strict document grammar and saved documents
  reload. A sketch tolerance must be finite and positive. `segments` (cylinder,
  sphere, revolve, circle, arc) and extrude `divisions` must be safe integers no
  smaller than the grammar's minimum; a non-number throws `TypeError`, and a
  fractional or too-small number throws `RangeError`. Flags such as `center`,
  `symmetric`, `clockwise`, `reversed`, and `suppressed` must be booleans, and
  labels and descriptions must be strings; other values throw `TypeError`.
  Before, values such as `segments: 7.5` evaluated but could not be reloaded,
  and a sketch tolerance of `-1` failed with a misleading
  `SKETCH_OVER_CONSTRAINED`. `validateDocument` now reports `FEATURE_INVALID`
  for the same sketch-tolerance, segment, and division violations in documents
  built by hand. `build()` still does not run semantic validation.
- Metadata must now be plain JSON data. The builder throws for non-finite
  numbers, `Map`, `Set`, `Date`, class instances, functions, BigInts, sparse
  arrays, and cycles, and for metadata above the default structural-value or
  nesting limits, counting a shared subtree everywhere it occurs.
  `stringifyDocument`, `hashDocument`, and `cloneDocument` now throw `TypeError`
  for any object other than an array or a plain record, instead of silently
  writing it as `{}`.
- `part(id, solid, options)` now rejects option fields other than `partNumber`,
  `description`, `material`, `materialRef`, `massDensity`, and `metadata` with
  `TypeError`. Before, extra keys from an options variable leaked into the
  document, and `solid`, `kind`, or `materialId` keys could override the
  authored node or bypass the owned-material check.
- Handles created with the exported `SolidRef`, `PartRef`, `MaterialRef`, sketch
  reference, or `ProfileDefinition` constructors are now rejected; only handles
  returned by builder methods are accepted. An assembly stores only instances
  that `instance(...)` added, so raw records pushed onto
  `AssemblyBuilder.instances` throw. A sketch callback must return a profile
  from its own `SketchBuilder`, and `SketchBuilder.entities` and `constraints`
  may hold only records its methods stored in that same map under the same key;
  a raw record, or a constraint moved into `entities`, throws. Assembly and
  sketch builders that escape their callback now throw instead of silently
  dropping work.
- `configuration(...)` now throws for a nested call that reuses the ID of a
  configuration whose callback is still running. Before, both calls succeeded
  and the outer one silently overwrote the inner overrides. A
  `ConfigurationBuilder` kept after its callback returns or throws now rejects
  further overrides with `TypeError`, instead of accepting them and dropping
  them from the document.
- Topology selections passed to `fillet`, `chamfer`, `shell`, and `draft` are
  now copied into the document instead of stored by reference. Cyclic selections
  throw `TypeError`. Selections with more than 100,000 query nodes (the default
  `maxTopologyQueryNodes`) or 1,000,000 structural values, or nested deeper than
  128 levels, throw `RangeError` while authoring. As in the parser, a shared
  query counts in full, at its own depth, everywhere it occurs.
- `build()` now returns a fully detached, deeply frozen document. Design,
  material, part, and configuration metadata, transform operations, and assembly
  placements are copied when they are authored. Changing those caller objects
  later, including objects frozen only at the top level, can no longer alter a
  built document or its hash, and authoring no longer freezes the caller's own
  arrays and metadata. Raw expression IR is the exception: it is validated and
  frozen in place.
- `SketchBuilder.regularPolygon(...)` now works; in 0.1.1 every call threw,
  including with the default rotation. `rotation` must be a literal angle, while
  `radius` and `center` may be parametric.
- Added `stagedBodySetDesignV7(...)`, a repository-only Document v7 authoring
  facade for the graphs admitted by the staged evaluators. It privately composes
  the frozen v6 builder for admitted typed parameters, boxes, cylinders, and
  spheres, then adds staged named configurations, document-owned materials and
  resource commitments, owner-bound imported bodies, body sets, parts, and
  direct imported-body/body-set/part outputs. Resources bind an explicit SHA-256
  digest, byte length, media type, ordered location hints, and detached
  metadata; callers compute the commitments, and locations never cause core I/O.
  STEP imports always use file units, text/binary BREP imports require declared
  units, and every import fixes healing to `none` and expects one solid. Body
  sets preserve unique member IDs, authored order, optional names, detached
  metadata, and shared-leaf memberships. The authoring methods enforce
  ownership, namespaces, dense non-empty collections, commitments,
  material/configuration references, and exact plain own-data option records.
  Build applies caller-selected document limits and strict v7 parsing before
  returning a detached, deeply frozen document. Unknown or accessor-backed
  parameter, configuration, material, part, resource, import, and membership
  fields are rejected rather than silently discarded. The facade remains
  source-only: it adds no root or package-subpath API, datum-backed sketches,
  location I/O, reader inference, healing, or exact aggregate export.
- The repository-staged `stagedBodySetDesignV7(...)` facade now captures
  `bodySet(...)` members and `resource(...)` `locations` as dense own-data plain
  arrays. Each array's `length` is read once from its own data property. The
  1,000,000-member ceiling and the remaining share of the aggregate
  `maxResourceLocations` ceiling (100,000 by default) are checked against that
  captured length before anything is copied, and exactly that many elements are
  copied. The own keys must be exactly the indexes below that length plus
  `length`, so non-index properties are rejected, and accessor-backed elements
  are rejected without calling their getters. `material(...)` and `part(...)`
  now accept only mass-density `Expression` or `Parameter` values for
  `massDensity` and store a detached snapshot. Forged or accessor-backed density
  objects, which were previously accepted and kept by reference, now fail.
- Staged facade IDs stay unique across re-entrant authoring calls. A callback,
  an option accessor, or a Proxy trap that registers the same node,
  configuration, material, or resource ID while another call is still capturing
  its inputs now makes one of the two calls fail with the duplicate error.
  Previously both calls succeeded and `build()` silently dropped one definition.
  Datum and body-set duplicates are now reported after their inputs are
  validated.
- Added the source-only staged Document v7 evaluation of outputs that directly
  reference an `importedBody` node. It verifies caller-resolved bytes against
  the document's byte-length and SHA-256 commitments before invoking the
  kernel's strong exact single-solid import contract, and it fails closed
  instead of falling back to weak native import. The public
  `Evaluator.evaluateImportedBody` workflow is built on it; for other staged
  documents, `mediaType` remains bound provenance pending a versioned
  format-to-media-type policy, and the staged path adds no location I/O or
  healing.
- Added a source-only staged Document v7 evaluator for outputs that directly
  reference a `bodySet` node. Every authored member is active, there is no
  inferred primary body, and member IDs, order, optional names, and detached
  metadata survive evaluation. Members may be boxes, cylinders, spheres,
  imported bodies, or staged transform and Boolean roots. Native-only sets may
  use an exact or approximate kernel and identify that representation; imported
  members still require caller-resolved, digest-verified bytes and the strong
  exact B-Rep import contract. Each body can be meshed, measured, inspected for
  topology when supported, and exported through its kernel capabilities.
  Aggregate mesh, STL, and OBJ are explicitly approximate/lossy. Exact aggregate
  STEP/BREP, aggregate mass or topology namespaces, healing, location I/O, and
  public v7 promotion remain unsupported.
- Added a source-only staged Document v7 evaluator for outputs that directly
  reference a `part` node whose geometry is one supported solid or one body set.
  `EvaluatedPartV7` preserves detached part metadata and exposes its geometry as
  an explicit single-solid/body-set discriminated union rather than inventing a
  primary body or kernel compound. Named-configuration material overrides
  determine the effective material identity, while an explicit part density
  continues to take precedence over the effective material density. Physical
  mass uses one uniform part density and additive independent-body semantics;
  repeated aliases and overlapping memberships are each counted rather than
  fused or deduplicated. A deterministic one-row BOM reports the same effective
  material and mass provenance. Part-level mesh and STL/OBJ export are aggregate
  tessellation views and therefore approximate/lossy; exactness and physical
  measurements retain the selected backend's quality rather than gaining an
  independent exactness guarantee. Resolver verification,
  evaluation/resource/document limits, cancellation, transactional cleanup, and
  borrowed-kernel ownership match the staged body-set boundary. The part
  evaluator adds no cross-body topology, aggregate geometric measurement, or
  exact aggregate STEP/BREP export.
- Extended the repository-only `stagedBodySetDesignV7(...)` facade with direct
  Document v7 part and material authoring. The source-only API now admits typed
  mass-density parameters, document-owned `material(...)` definitions,
  `part(...)` over one owned solid or body set, named `.partMaterial(...)`
  substitutions, and direct part outputs. Existing `PartOptions` preserve part
  number, description, detached metadata, the exclusive
  legacy-label/typed-material-reference choice, and explicit density precedence
  over the effective configured material. Issued geometry, material, and part
  handles are identity-checked; exact plain own-data option capture rejects
  accessors and unknown fields without invocation. Authored parts run through
  the staged evaluator with deterministic BOM/mass behavior, including additive
  body-set memberships and approximate/lossy aggregate STL/OBJ export. This
  slice adds no per-body materials, exact aggregate STEP/BREP, or public v7 API.
- Extended the repository-only `stagedBodySetDesignV7(...)` facade with typed
  scalar parameters and owned Document v7 datum-point, datum-axis, datum-plane,
  and coordinate-system authoring. A separate source-only
  `evaluateDatumNodesV7(...)` boundary resolves caller-selected datum node IDs
  without treating datums as design outputs or requiring a geometry kernel. Base
  defaults, a selected named configuration, and bounded caller overrides apply
  in that order. Resolved points, normalized axes, and deterministic
  right-handed plane and coordinate-system frames are detached and deeply
  frozen. Direction inputs must be finite and nonzero; paired directions must be
  orthogonal after normalization within the fixed absolute dot-product threshold
  of `1e-12`, and admitted pairs are deterministically re-orthonormalized.
  Document and evaluation limits, cancellation, runtime-integrity checks,
  hostile-boundary containment, and structured diagnostics apply without
  introducing kernel ownership. Datum-backed sketches, datum design outputs, and
  public Document v7 promotion remain unsupported.
- Extended the repository-only `stagedBodySetDesignV7(...)` facade with typed
  angle parameters and owner-bound `StagedSolidRefV7` transform DAGs.
  `transform(...)` captures one or more ordered translate, rotate, scale, or
  mirror operations, while `translate(...)`, `rotate(...)`, `scale(...)`, and
  `mirror(...)` provide typed length/angle/scalar convenience authoring.
  Primitive and commitment-backed imported leaves can feed transform chains;
  transformed roots can feed ordered body-set memberships or single-solid parts
  and therefore flow through nested local assemblies, configurations, BOM, mass,
  mesh, topology, and per-solid export contracts already admitted by those
  staged results. Evaluation plans each selected closure iteratively, memoizes
  shared graph nodes, validates finite operations, nonzero scale components and
  mirror normals, requires an honestly advertised transform method, rejects
  returned shape aliases, and releases every created shape transactionally.
  Stock OCCT retains exact B-Rep behavior; Manifold remains approximate mesh
  geometry, and evaluation performs no backend fallback. Imported leaves still
  require caller-resolved commitment verification and the strong exact
  single-solid document-import capability, with no weak import or mesh
  conversion. `maxSolidGraphNodes`, `maxSolidDependencyLinks`, and
  `maxTransformOperations` now independently bound graph nodes, solid edges, and
  authored operations; local-assembly evaluation charges each globally by
  `(node, effective configuration)` across the active tree while deduplicating
  repeated occurrences in one context and pruning suppressed subtrees before
  counting. Generic/direct transformed-solid outputs, transforms over body
  sets/parts/assemblies, other body-consuming features, CLI/package exports, and
  public Document v7 promotion remain unsupported.
- Extended the repository-only `stagedBodySetDesignV7(...)` facade with
  owner-bound `union(...)`, `subtract(...)`, and `intersect(...)` solid
  authoring. Primitive, commitment-backed imported, transformed, and prior
  Boolean solids can now form deterministic branching DAGs whose roots feed
  later Booleans, transforms, ordered body-set memberships, single-solid parts,
  and configured nested local assemblies. Evaluation preserves the authored
  target-first/tool-order contract, plans children before consumers, memoizes
  shared nodes per effective configuration, and charges every target and tool
  edge, including repeated references, to `maxSolidDependencyLinks`.
  `maxSolidGraphNodes` counts Boolean nodes as well as leaves and transforms.
  The selected kernel must honestly advertise the `boolean` feature and
  implement its Boolean method before resource resolution or shape acquisition.
  Kernel-returned shape aliases and malformed optional exact-evolution metadata
  fail closed. Null or exactly zero-volume subtraction/intersection results use
  the structured `EMPTY_RESULT` diagnostic; impossible empty unions and
  malformed measurements remain kernel protocol failures. Every unsuccessful
  graph is released transactionally. Stock OCCT retains exact B-Rep geometry
  with its partial Boolean-history contract, an owned facade receives complete
  indexed evolution only when it proves the existing feature-scoped protocol,
  and Manifold remains approximate mesh geometry. There is no backend fallback.
  Real Manifold configured-product evidence covers contextual reuse, BOM, mass,
  suppression, limits, and cleanup; real stock OCCT evidence composes a verified
  STEP import with subtraction, transform, topology inspection, and STEP export.
  Generic solid outputs, Boolean inputs from body sets, parts, or assemblies,
  other body-consuming features, CLI/package exports, and public Document v7
  promotion remain unsupported.
- Extended the repository-only `stagedBodySetDesignV7(...)` facade with
  source-only nested local assembly authoring and evaluation. The staged
  `assembly(...)` callback receives a `StagedLocalAssemblyBuilderV7` whose
  instances reference owned local parts or already-completed local assemblies,
  retain stable local occurrence IDs and ordered placements, and select
  `inherit`, `base`, or named child configuration context. Named
  `configuration.instanceSuppressed(...)` overrides apply at every active
  assembly definition and can either suppress an instance or explicitly
  unsuppress one authored as suppressed. `evaluateLocalAssemblyOutputsV7(...)`
  iteratively flattens the active local tree in deterministic authored
  depth-first order and returns owned `EvaluatedLocalAssemblyDesignV7`,
  `EvaluatedLocalAssemblyV7`, and `EvaluatedLocalOccurrenceV7` leaf results. A
  containing assembly's effective configuration controls its suppression and
  placement expressions; the occurrence selector then chooses the referenced
  child part or assembly context. Placements compose parent first along the
  complete path. Repeated occurrences reuse one evaluated part result per
  effective `(part, configuration)` context within one call, while leaf
  acquisition is also deduplicated by leaf node inside each configuration batch.
  Neither optimization collapses occurrences, multibody memberships, or BOM
  quantities. Aggregate mesh, STL, and OBJ remain approximate/lossy; contextual
  BOM and placed physical mass preserve each occurrence's effective material,
  density, configuration, and affine placement. Document, resource, and
  assembly-evaluation limits, cancellation, runtime-integrity checks,
  hostile-boundary containment, transactional shape cleanup, and borrowed-kernel
  ownership apply throughout. Assembly-specific work ceilings include active
  nesting depth and aggregate stored occurrence-path segments. Suppressed
  external components are inert, and active ones are admitted only through the
  staged external-component evaluation (`externalPart(...)` and
  `externalAssembly(...)`), which allows child part outputs and one fixed
  external subassembly boundary. Hand-authored cyclic graphs, mates,
  interference, exact aggregate STEP/BREP, cross-run cache, CLI surface, and
  public Document v7 promotion remain unsupported.
- Added source-only staged 0.2 product evaluation for external part and fixed
  subassembly occurrences. The repository-only `stagedBodySetDesignV7(...)`
  facade can bind a committed InvariantCAD document resource and one named part
  output through `externalPart(...)` or one named assembly output through
  `externalAssembly(...)`, then mix those handles with local parts and local
  subassemblies in a fixed-placement product. The internal
  `evaluateProductAssemblyOutputsV7(...)` boundary, which is the same function
  as `evaluateLocalAssemblyOutputsV7(...)`, admits direct child part outputs or
  expands one external assembly boundary through its bounded acyclic child-local
  assembly graph. Each active occurrence path may cross at most one
  external-document boundary; an active second boundary fails before nested
  resolution or child geometry work, while a suppressed nested external
  component is inert. Child parts use base, same-ID inherited, or explicitly
  named child configurations. Caller parameter overrides remain in the root
  document and never leak into a child document. Equal direct-part
  `(resource, output, configuration)` contexts reuse one evaluated part inside
  the call. Assembly leaves reuse geometry by `(resource, child part node,
  configuration)`, while distinct assembly output aliases retain distinct
  component identity, occurrence paths, diagnostics, and BOM rows. Resolver
  requests made by this staged operation carry a frozen `documentScope`:
  root-document commitments use `{ source: "root" }`, while resources declared
  by an admitted child use `{ source: "external", resource, digest }`. This lets
  different documents reuse a document-local resource ID without sharing bytes.
  External document JSON is resolved and admitted before scoped child geometry;
  resource-count and byte ceilings remain cumulative across both phases, and
  repeated `(documentScope, resourceId)` work is reused. External component
  results retain the committed resource, digest, byte length, selected
  part-or-assembly output, admitted source version, and child part node.
  Occurrence-specific diagnostics always add `componentResource`, the selected
  external `output`/`outputKind`, and the full product occurrence path; after
  child admission they also carry the document digest, byte length, and source
  version. A child-owned `resource` is preserved, and a child-owned output is
  retained as `childOutput` rather than overwriting the parent selection; child
  node/path remains attached when supplied. Aggregate first-phase resource-limit
  failures are not misattributed to an arbitrary occurrence. Deferred BOM
  warnings preserve the same parent-component provenance. Successful products
  own their retained child shapes until disposal; failure releases every
  acquired or intermediate shape exactly once and never takes ownership of the
  supplied kernel. Exact child solids keep capability-gated per-solid or
  per-body STEP/BREP export, but product-level mesh, binary/ASCII STL, and OBJ
  are approximate/lossy aggregate views and exact aggregate export is rejected.
  Active second-level external references, recursive external-document graphs,
  assembly-wide topology or geometric measurement, mates, motion,
  interference/collision, and feature families outside the existing staged part
  evaluator remain unsupported. This is repository-only work staged for 0.2: no
  package-root, package-subpath, CLI, document alias, or migration target was
  added.
- Added the repository-staged `evaluateProductDocument(...)` boundary for one
  ordered selection containing any supported mix of direct solid, body-set,
  part, and fixed-assembly Document v7 outputs. The owned
  `EvaluatedProductDocumentV7` result preserves requested output order and
  aliases, exposes kind-checked lookup plus direct `solid(...)`, `bodySet(...)`,
  `part(...)`, and `assembly(...)` access, and invalidates every borrowed leaf
  view atomically on disposal. One call captures the root document and options
  once, expands active local and admitted external assembly structure before
  geometry work, prepares one authentic native-geometry batch per
  document/effective-configuration context, performs one aggregate kernel
  preflight before geometry-resource resolution, and shares one document-scoped
  resolver session and cross-batch shape-ownership transaction. Repeated aliases
  and assembly leaves reuse their retained definition geometry without
  synthesizing nodes or duplicating native construction. Suppressed structure
  and unselected materials/resources remain inert. Exact B-Rep leaves retain
  backend-reported per-solid or per-body measurements plus capability-gated
  topology and native STEP/BREP export. The mixed result's aggregate `mesh()`
  and STL/OBJ exports validate and copy every backend mesh but remain explicitly
  approximate/lossy; the boundary does not synthesize an exact compound or
  provide aggregate STEP/BREP, measurement, topology, mass, BOM, mates, motion,
  contact, interference, or collision. Active second-level external-document
  boundaries and unsupported solid/assembly feature families still fail closed.
  This entry point and its result types are repository-only staging for 0.2.
  They are absent from the package root and subpaths, the public v6 document and
  evaluator aliases, migration targets, and the CLI.
- Enforced product shape semantics in the repository-staged Document v7
  evaluators. Named product outputs are now closed to `solid`, `bodySet`,
  `part`, and `assembly`, derived from one frozen vocabulary for TypeScript,
  schema, and semantic validation; curve, wire, face, shell, compound, and
  unknown output kinds fail as `IR_INVALID`. A staged graph containing a Boolean
  now preflights the classifier before resource or geometry work, and every
  Boolean result that passes the existing status and `EMPTY_RESULT` checks must
  classify as one body before it feeds another node, body-set member, part, or
  output. Multiple-body and non-body results return `EVALUATION_UNSUPPORTED`
  with the feature path, kernel, representation, exactness, and stable
  classification reason; malformed or opaque classifier behavior is a
  `KERNEL_ERROR` protocol violation. Failures release every acquired shape
  exactly once. Disconnected Booleans are never split into invented body-set
  members, retried on another backend, or converted to mesh; explicit body sets
  remain the authored multibody boundary. This does not affect Document v1-v6
  evaluation, and general Document v7 remains unpublished.
- The staged product evaluator now prepares one native batch per external
  document and child configuration. A child part reached through both
  `externalPart(...)` and `externalAssembly(...)` is therefore constructed once
  and charged once against `maxDistinctSolids`, solid-graph, and other
  cumulative limits; previously it was built twice and could exceed limits it
  actually fit. Component, diagnostic, and BOM identity stay separate for each
  use, and the direct selection and the leaf selection still each count their
  bodies toward `maxPartBodies`.
- Staged local assembly leaves are now named by their part node. That name is
  used for `occurrence.part.name`, the part's solid or body set, STL/OBJ
  headers, and diagnostics. An internal NUL-delimited planner selector or an
  unrelated output name no longer leaks into results. Unsupported exact exports
  of a local leaf now report `partNode` and `/nodes/<part>/geometry` instead of
  an `output`, and external fixed-subassembly leaf solids are likewise named by
  their child part node.
- Deferred failures on staged external occurrences now carry the documented
  top-level provenance. Assembly mesh failures and occurrence mass-transform
  failures report `resource`, `componentResource`, `digest`, `byteLength`,
  `sourceVersion`, and the external component `output`/`outputKind`, and mesh
  failures name the meshed assembly as `assemblyOutput`.
  `EvaluatedProductDocumentV7.mesh()` and `export(...)` rethrow those structured
  assembly failures unchanged instead of reducing them to a message string, so
  the occurrence path, child node, child paths, and the kernel cause are
  preserved.
- Staged product cumulative-limit diagnostics and kernel-preflight
  `selectionPath` provenance for root-document batches now point at the
  selection itself: `/outputs/<name>` for a direct output or
  `/nodes/<part>/geometry` for a part leaf. Previously they could point at a
  node that does not exist, such as `/nodes/<output name>/geometry`.
- Staged product kernel preflight now attributes body-result-classification
  capability failures to the batch that owns the Boolean. Previously such a
  failure could be attributed to an earlier document's batch that had a
  non-Boolean node with the same ID.
- Added a staged, repository-only migration path for legacy documents whose
  identities Document v7 cannot represent.
  `migrateDocumentToV7WithIdentityRenames(document, renames, options?)` accepts
  an explicit caller-authored map for parameter, node, output, sketch-entity,
  sketch-constraint, and assembly-occurrence identities. Occurrences are keyed
  by instance index so repeated legacy IDs can be separated. Only identities
  that block v7 may be renamed, including historical identities found only in
  stored topology lineage. Every entry must name an existing source, targets
  must be unique v7 IDs that collide with no retained ID, and renaming a
  repeated occurrence ID that a configuration references is rejected as
  ambiguous. Each rename rewrites its definition and every structural reference,
  never metadata or free text; the result must pass strict v7 validation and is
  returned with a deterministic audit record that marks output renames
  consumer-visible. `migrateDocumentToV7` still fails closed and never renames.
- Staged document byte admission now rejects BOM-prefixed documents, as
  `parseDocument` and the CLI do, instead of silently dropping the byte-order
  mark. Artifact-cache and conformance identities that begin with U+FEFF are
  still rejected; that rule is now explicit rather than a decoder side effect.
- Replaced staged Document v7 raw-text byte measurement with a bounded,
  buffer-free UTF-8 counter. Oversized text can stop before complete scanning
  and always fails before UTF-8 buffer construction, JSON parsing, or
  duplicate-member auditing, while admitted text retains exact `TextEncoder`
  semantics, including replacement encoding for lone surrogates.
- Made staged Document v7 commutative topology-query serialization use
  locale-independent UTF-16 code-unit ordering, including nested negation and
  adjacency selections. Distinct strings that a locale collator equates now
  canonicalize identically across input permutations; frozen v1-v6
  canonicalization keeps its existing comparator and bytes.
- Replaced the three staged Document v7 direct-schema objects with frozen,
  null-prototype terminal facades over private Zod schemas. The facades retain
  guarded parse, codec, async, and Standard Schema entrypoints without exposing
  Zod combinators, constructors, nested schemas, or raw execution internals that
  can run outside the v7 runtime-integrity boundary. This change does not touch
  the v1-v6 schemas.
- Wrong-dimensional expressions from untyped callers now throw `TypeError`
  immediately, as the builder reference already documented. This covers
  `add`/`sub`, `mul`/`div` by a non-scalar, mixed-dimension
  `expr.min`/`expr.max`, trigonometry over non-angles, `expr.ratio` over unequal
  dimensions, the vector helpers, topology predicates, and every builder input.
  Before, these mistakes surfaced only later as `EXPRESSION_DIMENSION_MISMATCH`.
- `new Expression(...)` and `fromExpressionIR(...)` now validate raw expression
  IR and deeply freeze it, even when the caller froze only its root. Malformed
  or cyclic IR throws `TypeError`, and a non-string `op` or `dimension` is
  rejected with a fixed message. IR records with symbol or non-enumerable
  fields, and `min`/`max` value arrays with any own property besides their
  operands, throw `TypeError`, since freezing would not reach that data. IR
  whose validation would visit more than 1,000,000 nodes and scheduled operands,
  counting a shared operand each time it is scheduled, throws `TypeError`, and a
  `min` or `max` whose operand list alone exceeds what remains of that budget is
  refused before the list is frozen or copied. Nodes already validated, such as
  those the `Expression` methods produce, are not visited again. A rejected
  non-plain IR root is no longer frozen.
- `evaluateExpression` and `expressionDependencies` now visit each distinct node
  once per call, using an explicit stack instead of recursion. Before, an
  expression that reused a subexpression, such as `x.add(x)` applied repeatedly
  in the builder, took time exponential in its depth, and a chain of a few
  hundred thousand operations overflowed the call stack. A `min` or `max` with
  very many operands now evaluates; before, about 150,000 operands passed
  validation but failed evaluation with `EXPRESSION_INVALID` "Maximum call stack
  size exceeded". Evaluation order is unchanged, including checking a divisor
  before its numerator. For cyclic raw IR, `evaluateExpression` now throws
  `TypeError` instead of overflowing the stack. `expressionDependencies` does
  not check for cycles: it visits each node once, so it returns the parameters
  it reached.
- Public assembly evaluation now enforces fixed ceilings: 100,000 occurrence
  records materialized per evaluation, 1,000,000 stored instance-path segments,
  and an assembly nesting depth of 64. Exceeding one fails with
  `RESOURCE_LIMIT_EXCEEDED` at the assembly instance, with `details.resource`,
  `details.limit`, and `details.actual`, before the records are allocated. Small
  documents with nested fan-out, or chains of a few thousand nested assemblies,
  previously expanded without bound and failed with a misclassified
  `KERNEL_ERROR` "Maximum call stack size exceeded". Designs that 0.1.1
  evaluated but that exceed a ceiling are now rejected; for example, a 16-level
  binary fan-out exceeds the 1,000,000 path-segment ceiling. The ceilings are
  fixed, so such designs must be restructured.
- `Evaluator.evaluate` now rejects a non-string `configuration` option with
  `IR_INVALID` at `/configuration`, as feature hashing and the Document v7
  evaluators already did, and a non-string `outputs` entry with `IR_INVALID` at
  `/options/outputs/<index>`. Both checks run before the value is used as a
  property key. Before, a non-string configuration was converted to a property
  key and reported as an unknown configuration, and a non-string `outputs` entry
  was converted to a property key, which ran its `toString()` and could select
  an output the caller then could not read back by name.
- When the evaluation options contain an own data `signal`, as in `{ signal }`,
  `Evaluator.evaluate(...)` now yields to the host event loop before geometry
  work, between selected outputs, and after the last output. An abort from a
  timer, UI handler, `AbortSignal.timeout(...)`, or worker message can therefore
  take effect; previously only a signal that was already aborted, or one aborted
  synchronously from a callback, was observed. The evaluator also rechecks the
  signal after each feature's own kernel work, before a dependent feature
  reaches the kernel. Because other code can run at those yields, such an
  evaluation first captures its request: the document goes through
  `parseDocumentValue` with the default limits, each option is read once as an
  own data property, the `outputs` array is copied up to the first undeclared
  name, and `topologySignatureLimits` keeps only its six supported fields. A
  getter option, a non-array or sparse `outputs`, an `outputs` array with more
  than 1,000,000 entries (`details.resource` `maxOutputSelectionEntries`), a
  `topologySignatureLimits` object with any other enumerable own field, or an
  over-limit document fails with `IR_INVALID` before any geometry work. A long
  `outputs` scan stops with `EVALUATION_ABORTED` once the signal is aborted.
  While such an evaluation waits at a yield, `evaluator.dispose()` throws.
  Evaluations without an own data signal still run entirely inside the call and
  read their options as before.
- An explicitly empty `outputs: []` selection now fails with the message "No
  outputs were selected" instead of "The document has no outputs"; the
  `OUTPUT_MISSING` code and `/outputs` path are unchanged.
  `EvaluationOptions.allowEmpty` is now documented correctly: it turns a
  zero-volume `EMPTY_RESULT` into a warning and never permits an empty output
  selection.
- Output selection, parameter-reference validation, and `SketchBuilder`
  duplicate checks now use own-property lookups. An unknown output named like an
  `Object.prototype` member, such as `toString`, `constructor`, or `__proto__`,
  now fails with `OUTPUT_MISSING`, including through the CLI `--output` flag. It
  previously failed with `REFERENCE_MISSING` and could even return an undeclared
  node named `undefined`. A reference to a missing parameter with such a name
  reports `PARAMETER_MISSING` instead of `EXPRESSION_DIMENSION_MISMATCH`, and
  sketches now accept `constructor`, `toString`, and `valueOf` as entity and
  constraint IDs.
- Public evaluation now rejects a mirror normal whose components all resolve to
  zero, for a `transform` node or a `tf.mirror` assembly placement, with
  `FEATURE_INVALID` at `/nodes/<id>/operations/<index>/normal` or
  `/nodes/<id>/instances/<index>/placement/<index>/normal` before any kernel
  call. Previously Manifold reported `EMPTY_RESULT`, or returned an empty solid
  under `allowEmpty`, while stock OCCT and assembly placements reported an
  opaque `KERNEL_ERROR`. Every finite non-zero normal is now normalized without
  overflow or underflow, and kernels receive the unit normal, so very large or
  very small normals such as `1e200` and `1e-200` mirror correctly instead of
  silently returning unmirrored geometry or failing. The staged Document v7
  evaluators no longer reject finite non-zero normals above about `1e154` or
  below about `1e-154`.
- `EvaluatedAssembly.instances` is now a frozen array of frozen records, and
  each `transform` is a frozen copy detached from the evaluator's internal
  placement. Outputs that name the same assembly node share these records. The
  shared identity matrix is also frozen. Writing into a returned transform
  previously changed that assembly's mesh, measurements, and BOM. For an
  unplaced instance it also corrupted every later placement in the process.
- `EvaluatedAssembly.measure()` now takes surface area, bounding box, and
  tolerance from the occurrence kernel measurements instead of the merged
  Float32 default tessellation and a literal tolerance of 0. Behavior change
  from 0.1.1: on OCCT, a single unplaced occurrence now reports exactly its
  part's area, bounds, and tolerance, where it previously reported about 0.3%
  less area for curved parts and bounds that left out real material. Area is the
  kernel area times the squared scale under rigid, mirrored, and uniformly
  scaled placements; only nonuniformly scaled or sheared occurrences use their
  placed default tessellation. Bounds enclose every placed kernel bounding box:
  exact for axis-aligned placements, and possibly larger than the tight box for
  rotations that are not quarter turns. `tolerance` is the largest occurrence
  kernel tolerance times its placement's magnification.
- `EvaluatedDesign.dispose()` now marks the result disposed before releasing
  shapes, attempts every shape even if a kernel release throws, and then
  rethrows the first error; later calls are no-ops. Previously one failing
  release leaked the remaining shapes, left the result usable over released
  shapes, and made a second `dispose()` release shapes again. A failed
  evaluation likewise attempts every shape it created and still resolves with
  its original diagnostics. It previously rejected with the raw release error.
- Diagnostic paths are now RFC 6901 JSON Pointers for every document key. A `~`
  or `/` in a node, parameter, output, sketch-entity, constraint, configuration,
  or topology-reference key is written as `~0` or `~1`, so a node named `a/b` is
  reported at `/nodes/a~1b/radius`. Before, keys were interpolated unescaped, as
  in `/nodes/a/b/...`, a location that does not exist. This applies to semantic
  validation and structural parse errors, and to evaluation, parameter-override,
  resource, feature-hashing, and CLI diagnostics, including the paths for
  unknown caller-supplied parameter, configuration, and output names. Document
  v1-v6 node, output, and parameter keys may contain these characters; paths for
  ordinary keys are unchanged.
- `validateDocument` and `parseDocument` diagnostics for transform and
  assembly-placement expressions now include the `value` or `normal` member, for
  example `/nodes/<id>/operations/0/value/1`, so the JSON Pointer resolves to
  the authored component.
- `REFERENCE_KIND_MISMATCH` now names the required kind when a reference
  correctly declares what its target produces but the consumer needs something
  else, for example "Reference requires part or assembly, but node 'b' produces
  solid", instead of the self-contradictory "produces solid, but the reference
  declares solid". Both messages for a node reference whose kind does not fit
  (this one and the existing declared-versus-produced message) now carry
  `details.expected`, `details.actual`, and `details.declared`. Other
  `REFERENCE_KIND_MISMATCH` diagnostics, such as configuration-target and
  topology-origin mismatches, are unchanged.
- `principalInertia` no longer throws "Principal inertia decomposition did not
  converge" for valid tensors whose remaining off-diagonal entries are each
  below the solver threshold but whose combined norm is just above it. Slender
  parts and ordinary blocks analyzed about distant points no longer fail
  `physicalMassProperties()` with `MASS_PROPERTIES_INVALID` or crash
  `invariantcad inspect`. Tensors that converged before return identical
  results.
- `radiusOfGyrationAboutAxis` and `principalRadiiOfGyration` now validate the
  axis and the degeneracy options before returning `null` for zero-weight
  properties, so an invalid argument throws the same `RangeError` as in
  `momentOfInertiaAboutAxis` and `principalInertia` instead of being silently
  accepted.
- Breaking: revolve now rejects a profile that crosses its axis, the sketch
  plane's local v axis through the sketch origin (u = 0). It fails with
  `FEATURE_INVALID` at `/nodes/<id>/profile`, reason `profile-crosses-axis`,
  before any kernel call. Before this, the default Manifold kernel silently kept
  only the positive-u half and returned clipped geometry, and stock OCCT failed
  with an opaque `KERNEL_ERROR`. Profiles that touch the axis are still
  accepted. Documents that revolved a straddling profile on Manifold now fail
  and must move the profile to one side of the axis. Manifold also now revolves
  profiles that lie wholly on the negative side of the axis, as OCCT always did,
  instead of failing with `KERNEL_ERROR` or `EMPTY_RESULT`.
- Breaking: sweep admission now accounts for the right-corner miter. At a
  polyline corner or composite line-line junction that turns by θ, the setback
  at that end of each adjacent straight segment is r · tan(θ / 2), where r is
  the profile envelope radius, and each segment must be longer than the sum of
  the setbacks at its two ends. Remote segments must also clear the segments
  extended by that outer miter reach. Short segments between sharp corners, and
  miter spikes that reach a remote segment, previously produced self-overlapping
  solids that OCCT reported as VALID. They now fail with `FEATURE_INVALID`
  (reason `path-clearance`), so some sweeps accepted by 0.1.1 are rejected and
  need longer segments, gentler corners, or a smaller profile.
- Breaking for custom solvers: the evaluator now enforces the sketch-solver
  protocol for replaceable solvers. A sketch whose entity or constraint kinds
  the solver does not advertise fails with `KERNEL_CAPABILITY_MISSING` before
  `solve` is called. `SolvedSketch.status` is authoritative: only `solved` and
  `underconstrained` with a finite residual produce geometry. `overconstrained`
  fails with `SKETCH_OVER_CONSTRAINED`. `nonconvergent`, `invalid`, an
  unrecognized status, or a non-finite residual fail with `SKETCH_SOLVE_FAILED`,
  even when the solver returns no error diagnostic. Custom solvers must
  advertise every entity and constraint kind they accept, and a solver that
  reports failure only through `status` now fails the evaluation. A failing
  solve now reports its error diagnostic once, scoped to the sketch node, with
  the path `/nodes/<sketch>` when the solver gave none. Previously the error was
  listed twice, once without `node`, and a custom solver that reported a warning
  before its error ended the failure list with a duplicated warning. The
  reference solver no longer reports a NaN residual as solved, and its solve
  failures now carry a path: `/nodes/<sketch>/constraints` for
  `SKETCH_OVER_CONSTRAINED` and `/nodes/<sketch>` for `SKETCH_SOLVE_FAILED`.
- Ruled lofts now check that each section keeps its authored curve phase against
  its neighbouring section rather than against the first section, because OCCT
  re-pairs adjacent sections. Lofts such as squares rotated 0, -44 and +44
  degrees, which OCCT silently re-paired into different geometry, now fail with
  `curve-phase-mismatch`. Gradual twists whose every adjacent pair keeps its
  authored pairing, such as 0/40/80 degrees, are now accepted.
- Polyline paths and composite line-line junctions now reject a segment that
  folds back within tolerance of its neighbour with `FEATURE_INVALID` (reason
  `self-intersection`). Before, such a path was accepted as simple whenever the
  corner sine was above the 1e-10 collinearity floor.
- The reference sketch solver no longer hangs on very large angle-constraint
  values. Repeated 2π subtraction took time proportional to the value, and above
  about 7.2e16 it never ended, which the abort signal could not interrupt. Huge
  targets are now reduced in constant time, and ordinary solves are unchanged.
- Fixed resolved sketch-profile admission after final parameter and
  configuration evaluation. Before a dependent geometry-kernel feature call, the
  evaluator now certifies the finite, nondegenerate, supported-simple loops of
  profiles that declare holes and requires boundary clearance strictly greater
  than the sketch tolerance between every hole and its outer loop and between
  distinct holes. Disjoint outside or enclosing holes, boundary contact or
  tangency, intersections, partial overlap, coincidence, and nested holes fail
  closed with `SKETCH_NO_CLOSED_REGION` and bounded sketch/loop/entity
  provenance where available instead of being reinterpreted by a backend.
  Explicit outer/hole roles remain independent of traversal winding. Every
  solved profile now passes through the same bounded, cancellable closure gate;
  after that gate, hole-free profiles retain their existing feature-specific
  geometric admission. The kernel-neutral hole-region check uses analytic
  line/arc/circle predicates plus bounded adaptive chord-sagitta separation
  proofs; rendering `segments` hints do not decide validity, numeric uncertainty
  fails closed, exhausted work returns `RESOURCE_LIMIT_EXCEEDED`, and
  cancellation returns `EVALUATION_ABORTED`. This is an `Evaluator` modeling
  boundary shared by Manifold, OCCT, and custom kernels. Direct low-level
  `GeometryKernel` calls remain responsible for satisfying their
  resolved-profile contract, and this fix does not add islands, general
  multi-region algebra, or automatic parameter coupling.
- Hole containment no longer misclassifies holes level with an arc endpoint.
  Examples are a hole centred at the step height of an L-bracket with an inside
  fillet that ends at its circle's lowest point, and a hole a rounding error
  above or below the point where an arc meets a line. Such holes were wrongly
  rejected with `hole-outside-outer`, and holes outside the outer loop or nested
  in another hole could be accepted and produce wrong solids. Each junction
  between curves is now classified once against the containment ray, so an arc
  endpoint and the line it meets always agree, and an arc's crossings are
  counted from the sides of its pieces between its circle's highest and lowest
  points rather than from crossing angles, which are ill-conditioned near a
  tangency.
- The `SKETCH_NO_CLOSED_REGION` diagnostic for an open sketch loop keeps its
  code, message and profile path, and now adds detail. `details` gives the
  resolved curve indices on either side of the first gap and the gap size, and
  `related` names those authored entities when solver provenance matches. When
  an arc borders the gap, a hint explains that the reference solver derives arc
  endpoints from the center, radius and authored angles, so constraints that
  change a loop arc's radius or center do not move adjacent line endpoints.
- Topology selection counts must now be safe integers. `exactly`, `atLeast`, and
  `between` throw `RangeError` for any count above `Number.MAX_SAFE_INTEGER`
  (for example `2 ** 53` or `1e300`), and `validateDocument` and
  `resolveTopologySelection` reject such a selection with
  `TOPOLOGY_SELECTOR_INVALID`. Previously such a document built, validated, and
  saved, but `parseDocument` rejected the saved text with `IR_INVALID`, so it
  could never be reloaded. The accepted document grammar, canonical bytes, and
  semantic hashes are unchanged.
- `resolveTopologySelection` and `explainTopologySelection` now report a
  structurally malformed selection (for example a missing `query`, a missing or
  unknown query operator, an `and`/`or` without `queries`, or an `adjacentTo`
  without its nested selection) as `TOPOLOGY_SELECTOR_INVALID` at the
  selection's path, or at the exact query path for a missing or unknown
  operator. They previously blamed the kernel with `KERNEL_ERROR` and
  `protocolViolation: true` even though the snapshot was never read, and an
  `and` whose first operand had no known operator matched nothing and reported a
  missing selection. Malformed kernel snapshots still return `KERNEL_ERROR`.
- Face `normal` and edge `direction` selector queries now measure angles with a
  numerically stable `atan2` form instead of `acos`. A face or edge whose
  direction exactly equals a non-axis-aligned requested direction, such as
  `(1, 1, 0)`, used to be reported `TOPOLOGY_SELECTION_MISSING` at angular
  tolerances of about `1e-8` rad or tighter, and now matches. Finite direction
  vectors whose magnitude overflows now keep their direction instead of matching
  every reported normal or direction. Results at the default `deg(0.1)`
  tolerance are unchanged.
- Validating topology origin and sketch-source queries no longer walks the
  feature graph once per query. Ancestor walks are shared within one validation,
  so many queries against one input, nearby origins, a distant shared base
  feature, and paths through features with many inputs all stay linear. A 2.4
  MiB document with 8,000 origin queries that took about 26 seconds to parse now
  parses in under two seconds, keeping parse time bounded by the document
  limits.
- Breaking: `ShapeMeasurements.genus` is now `number | null`. A number means the
  backend proved the exact sum of connected-component genera for its
  representation; `null` means unsupported and is never treated as exact zero.
  Code that reads `genus` must handle `null`. This replaces the stock and owned
  OCCT genus heuristic. Manifold advertises protocol-v1
  `exact-per-connected-component`, decomposes its mesh, validates and safe-sums
  every component genus, and transactionally releases all temporary components.
  Stock and owned OCCT advertise `unsupported` and return `null` for empty and
  nonempty shapes because the current facade lacks the native degenerate-edge
  predicate required for a correct bounded B-Rep formula. Assembly aggregates
  also return `null` because their occurrence mesh is not a Boolean-unioned
  closed boundary. Volume, surface area, bounds, tolerance, center of mass,
  inertia, and physical mass properties are unchanged. The optional versioned
  measurement-capability envelope keeps older custom kernels structurally
  compatible; its public inspector snapshots valid metadata without invoking
  accessors and fails closed for malformed metadata, throwing proxy traps,
  accessors, or revoked values. Semantic-observation v1 remains byte/hash/type
  compatible and exact-genus only. New explicit v2 observer, encoder, hash,
  witness, and codec-audit boundaries preserve unsupported genus as `null` under
  distinct brands and domains rather than widening v1. The private OCCT
  artifact/process evidence now uses v2 semantic witnesses and version-2
  evidence projections. The reviewed `13,735`-byte v3 artifact remains
  byte-identical with fixture witness
  `invariantcad:kernel-shape-artifact-fixture:v1:sha256:4279e9f76ab1e41dae47b28aea9c426ffa8b5f329ab624f137c65f6881e23918`;
  its current semantic witness is
  `invariantcad:kernel-shape-semantic:v2:sha256:b99dd9c39b950700dd22c8be6255db6e816e1a51668f415bf84b80c4c200d588`.
- Breaking: each `ManifoldKernel` instance now accepts only the shapes it
  created, as the OCCT kernel already did. Passing another instance's shape to
  `measure`, `mesh`, `status`, `transform`, `boolean`, or `disposeShape` throws
  a `TypeError`, where 0.1.1 operated on or freed that shape and broke its
  owner. Callers must pass each shape only to the kernel that created it.
- Manifold extrude and revolve now reject sketch profiles with coordinates
  beyond ±1e10 mm. The kernel throws a `RangeError` that names the ceiling,
  which evaluation reports as `KERNEL_ERROR`. Above about 1.7e10 mm Manifold's
  polygon engine failed, and the diagnostic message was a bare native exception
  number such as `107360`. Other native Manifold failures in those operations
  now also report a readable message.
- Manifold `measure()` no longer rejects valid slender, thin-walled, rotated, or
  widely separated geometry. Its check that the Float32 mesh volume matches the
  native volume now allows for Float32 rounding of the mesh positions, so
  `evaluate()` on the default kernel no longer fails with `KERNEL_ERROR`
  ("Manifold mesh and native volume disagree beyond the measurement tolerance")
  for such documents, a failure that also affected 0.1.1. Center of mass and
  inertia are still integrated over the Float32 mesh, so their precision is
  relative to the shape's bounding-box size.
- Manifold `measure()` of an empty result (kept with `evaluate(document, {
  allowEmpty: true })`) now returns zero volume and area, a `null` center, a
  zero tensor, a zero bounding box at the origin, tolerance `0`, and genus `0`.
  The zero bounding box matches the OCCT kernel, which keeps its modeling
  tolerance and a `null` genus for an empty result. Previously the bounds were
  inverted infinities that serialized to `null` and the tolerance was `-1`.
- A failed Manifold runtime initialization, such as a wrong `wasmUrl`, a 404, or
  a network error, is no longer cached for the life of the page, worker, or
  process. A later `createEvaluator()` or `createManifoldKernel()` can retry
  with the same or a corrected URL instead of replaying the old error or
  refusing the corrected URL as "already initialized with a different WASM URL".
  Only a successful initialization fixes the URL for the realm, so supply
  `wasmUrl` on the first initialization in each page, worker, or process.
- `ManifoldKernel.transform(shape, [])` now returns a fresh, independently owned
  shape instead of a second wrapper around the input's native Manifold.
  Disposing either shape could previously leave the other dangling and make
  `kernel.dispose()` throw and leak every other live shape. `kernel.dispose()`
  now releases every live shape before rethrowing the first release failure, or
  an `AggregateError` for several, and a failed transform deletes its
  intermediate result.
- `createOcctKernel()` now rejects an invalid `modelingTolerance` before loading
  WebAssembly: `TypeError` for a non-number, `RangeError` for NaN, zero,
  negative or infinite values. Published 0.1.1 accepted such values, silently
  dropped topology signatures, failed cylinders with opaque native errors, and
  reported the value as `measure().tolerance`. Tessellation deflections must
  likewise be finite and positive, and `relative` must be a boolean, both at
  creation and on every `mesh()` call. Each tessellation field is read once from
  an own data property; accessors and caller-prototype fields throw `TypeError`,
  and `Object.prototype` pollution is ignored. A NaN deflection previously hung
  the native mesher.
- The OCCT kernel now reads `context.signal`, `context.feature`, and
  `context.tolerance`, and `exportShape(...)` its `stepExport` request, from own
  data properties only, capturing each once per call. `feature` must be a string
  and `tolerance` a number. A field that is accessor-backed or supplied by a
  caller-defined prototype, such as a class getter, throws `TypeError`; a field
  reachable only through the intrinsic `Object.prototype` is ignored, so
  prototype pollution cannot change or break kernel operations. Both body-result
  classifiers apply the same rule. Before, a `context.signal` supplied by a
  caller-defined prototype was silently ignored, and reusing or changing a
  context object after a call relabeled the topology roles of shapes it had
  already created, because published 0.1.1 re-read the context lazily.
- The OCCT kernel no longer compares dimensionless values with the length
  `modelingTolerance`. A transform scale is treated as uniform only when its
  factors agree to within floating-point rounding, so an anisotropic scale such
  as `[1, 1.009, 1]` is applied as authored. Exact extrusion rejects any twist
  other than `0`, any top scale other than `[1, 1]`, and any `divisions` other
  than `0`: the kernel throws `RangeError`, which evaluation reports as
  `KERNEL_ERROR`. Published 0.1.1 silently built an untwisted, untapered prism
  or a uniformly scaled solid when a raised tolerance covered the difference.
- Transforming a sphere or cone on the stock OCCT kernel no longer fails.
  Translate, rotate, scale and mirror previously threw `curveType: [object
  WebAssembly.Exception]` on the mechanical-exact profile for any shape with a
  degenerate pole or apex edge, in published 0.1.1 too. Such edges are now
  seeded through an adjacent face; rigid motions and uniform scale keep complete
  topology history.
- OCCT `mesh()` now tessellates a cache-free copy of the shape on every call, so
  a mesh depends only on the shape and the options of that request. Published
  0.1.1 stored the triangulation on the native shape and reused any finer one,
  so a coarse request after a fine one silently returned the fine mesh, and
  later meshes, STL/OBJ exports, assembly surface areas computed from part
  meshes, and BREP and binary BREP bytes depended on call order. For the same
  reason, `observeKernelShapeSemanticsV2(...)` results for curved shapes no
  longer depend on mesh-request IDs or earlier `mesh()` calls, which could make
  the codec audit reject a lossless golden. Meshes of shapes that were never
  meshed before are unchanged; calling `mesh()` repeatedly on the same shape now
  re-tessellates each time instead of reusing the cached triangulation.
- OCCT `measure()` counts a solid that a compound repeats once per occurrence
  for volume, center of mass, and inertia, matching surface area and
  `classifyBodyResult()`. Published 0.1.1 counted it once for volume but twice
  for area. On a compound or compsolid, `measure()` charges visited plus queued
  occurrences to the same 1,000,000 bound as `classifyBodyResult()`: a larger
  compound throws `RangeError`, and every traversal handle is released, so large
  wide compounds no longer leak native child handles when traversal fails.
  Shapes within that bound and without repeated occurrences measure as before.
- Stock OCCT fillet and chamfer failures now report the operation and the native
  message, for example `OCCT fillet failed: std::runtime_error:
  filletWithHistory: operation
  failed`. They previously surfaced as `KERNEL_ERROR` `[object
  WebAssembly.Exception]`.
- `OcctKernel.dispose()` now releases every remaining shape and the native
  kernel, and marks the kernel disposed, even when one shape release fails. It
  then rethrows that failure, or an `AggregateError` when several fail.
  Published 0.1.1 stopped at the first failure and kept the kernel accepting
  work.
- Each OCCT kernel's `capabilities` object, including its nested arrays, is now
  deeply frozen and independent of other kernels. In published 0.1.1, mutating
  one kernel's capability arrays changed every other OCCT kernel and the
  artifact compatibility fingerprint.
- Added the optional versioned body-result classification kernel protocol.
  `KERNEL_BODY_RESULT_CLASSIFICATION_PROTOCOL_VERSION` v1,
  `KernelCapabilities.bodyResultClassification`, and
  `GeometryKernel.classifyBodyResult(shape, context?)` classify one borrowed
  shape's retained representation as `single-body`, `multiple-bodies`, or
  `non-body-topology`; a wrapper around exactly one body counts as one body.
  `inspectKernelBodyResultClassificationCapabilities(...)` snapshots the
  envelope without invoking accessors and reports malformed metadata separately
  from absent support. Both shipped classifiers are synchronous and reject a
  context whose `signal` is accessor-backed or supplied by a caller-defined
  prototype before validating the shape. Manifold classifies positive-volume
  connected components of its approximate mesh, treating the negative-volume
  components it separates for cavity boundaries as voids, checks cancellation
  before and after its uninterruptible synchronous decomposition, and deletes
  every temporary component. OCCT traverses exact compound/compsolid contents,
  counts each solid occurrence as one body, classifies loose topology as
  `non-body-topology`, checks cancellation at each step, bounds visited plus
  queued occurrences at 1,000,000, and releases every traversal handle on
  success, failure, and cancellation.
- STEP export on the stock OCCT kernel is now bounded. Output above
  `maxOutputBytes`, the 64 MiB STEP output ceiling, or above a fixed STEP input,
  scan, or entity ceiling throws `CadError` with `RESOURCE_LIMIT_EXCEEDED`, both
  from `output.export("step", ...)` and from low-level `exportShape(...)`.
  `details.resource` names the ceiling, `details.limit` gives its value, and
  `details.actual` gives the measured size when known. Published 0.1.1 wrote
  STEP without these ceilings, so a larger export that it wrote now fails;
  `maxOutputBytes` can lower the 64 MiB output ceiling but not raise it.
- Made the bundled zero-override stock-OCCT single-product STEP export
  byte-deterministic under the versioned `KERNEL_STEP_EXPORT_PROTOCOL_VERSION`
  v1 contract. Evaluated solids and parts now accept `output.export("step", {
  metadata, signal, maxOutputBytes })`; stable defaults bind the document name,
  output/part identity, optional part description, and the fixed
  `1970-01-01T00:00:00` timestamp. A bounded structural Part 21 transformer,
  rather than a regular-expression rewrite, updates the AP214IS `FILE_NAME` and
  `PRODUCT` records while preserving geometry and successful re-import. Authored
  metadata has a 64 KiB UTF-8 budget; apostrophes use STEP doubling, and literal
  backslashes plus non-ASCII Unicode scalars in the four identity/description
  fields use Part 21 `\X2\`/`\X4\` directives. Control characters and unpaired
  surrogates in explicit metadata fail closed. Metadata is validated and encoded
  before the native writer starts. Encoded expansion counts toward the 64 MiB
  transformed-output ceiling, and scanning is cancellable after the synchronous
  native writer returns. That ceiling does not bound the native writer's peak
  allocation. The guarantee applies only to the same backend shape
  representation, options, metadata, implementation, and exact runtime artifact;
  it is not geometric canonicalization, cross-runtime cache identity,
  third-party STEP canonicalization, or exact aggregate assembly/body-set
  export. Caller-supplied `wasm`, `moduleFactory`, and attested runtimes retain
  weak raw STEP export and do not advertise the strong envelope without separate
  writer qualification; `exportShape(...)` refuses a deterministic STEP request
  on them, as tests now confirm for attested runtimes. Invalid high-level STEP
  option structure, explicit metadata content, calendar values, and
  authored-metadata budgets throw `CadError` with the stable
  `EXPORT_OPTIONS_INVALID` code and option-relative JSON Pointer paths, and
  valid cancellation remains `AbortError`. Malformed low-level
  `exportShape(...)` requests still throw `TypeError` or `RangeError`; low-level
  refusals for an exceeded ceiling or a multi-product shape throw `CadError`
  with `RESOURCE_LIMIT_EXCEEDED` or `EXPORT_UNSUPPORTED`.
- Automatic STEP metadata defaults derived from the document do not make a plain
  `output.export("step")` fail when they can fit the kernel's metadata budget.
  In document names, output aliases, part numbers, and descriptions, control
  characters become spaces and unpaired surrogates become U+FFFD, and an empty
  required value becomes `InvariantCAD Shape`. Every required field keeps its
  first Unicode scalar before the fields share the budget, and the longest
  defaults are truncated at Unicode scalar boundaries to fit it, which is 64 KiB
  on the stock kernel. Text past the budget is never scanned or copied.
  Multi-line descriptions, tabs in document names, descriptions over 64 KiB, and
  defaults that can fit under a small advertised `maxMetadataBytes` therefore do
  not cause `EXPORT_OPTIONS_INVALID`. Explicit `metadata` overrides keep the
  strict rules.
- Plain `output.export("step")` and low-level
  `kernel.exportShape(shape, "step")` on the stock OCCT kernel still export
  outputs that OCCT writes as several STEP products, such as a union of
  separated boxes or a subtraction that splits its target, as weak native STEP
  bytes, as published 0.1.1 did. The native writer runs once, and the whole
  document is held to the STEP input, scan, entity, and output ceilings. Passing
  STEP options, or `context.stepExport`, requests the single-product
  deterministic contract and throws `CadError` with `EXPORT_UNSUPPORTED` and
  `details.reason === "multiple-products"` for such shapes. For other kernels, a
  plain `output.export("step")` that the kernel refuses with that reason is
  retried once without `stepExport`.
- Binary STL export (`export("stl")`, `exportMesh(mesh, "stl")`, and
  `exportBinaryStl`) now fits the name into the 80-byte header by cutting its
  UTF-8 bytes on a character boundary. Long multi-byte names previously spilled
  into the triangle count, or threw `RangeError` for meshes with fewer than four
  triangles, such as an empty `allowEmpty` output. A name that starts with
  `solid` (ignoring case and leading whitespace) is now written as
  `InvariantCAD: <name>` so readers do not mistake the file for ASCII STL, which
  changes the header bytes for such names.
- Added a public, opaque `ImportedBodyDocument` workflow for one exact
  commitment-backed solid without promoting the broader staged product document
  grammar. `createImportedBodyDocument(...)` captures a caller-owned SHA-256
  digest, exact byte length, fixed format/media-type pairing, unit policy, and
  optional resolver hints without performing I/O.
  `stringifyImportedBodyDocument(...)` and `parseImportedBodyDocument(...)`
  persist and reopen only the strict one-resource/one-imported-body/one-output
  subset. `Evaluator.evaluateImportedBody(...)` first requires the strong exact
  B-Rep single-solid import capability and checks the committed byte length
  against the configured resource ceiling, then resolves bytes through a caller
  callback and verifies the commitment; it never falls back to weak native
  import or a mesh conversion. Protocol v1 admits STEP as `model/step` with file
  units, text BREP as `text/plain` with declared units, and binary BREP as
  `application/octet-stream` with declared units. Healing remains fixed to
  `none`. The owned result exposes measurement, topology, tessellation, and
  capability-gated single-solid export while borrowing its evaluator and kernel.
  A canonical executable documentation module proves an in-memory exact STEP
  export, content commitment, serialization/parsing, resolver admission, import,
  inspection, deterministic re-export, and cleanup. This slice does not expose
  body sets, external components, assemblies, repair/healing, automatic location
  I/O, or a public general Document v7 alias.
- Documented the JSON written by the imported-body workflow as a fixed, minimal
  Document v7 subset: schema https://invariantcad.dev/schema/document/v7,
  version 7, one resource, one `importedBody` node, one direct solid output with
  the node's name, empty parameters, and fixed units. It is read only by
  `parseImportedBodyDocument` and evaluated only by
  `Evaluator.evaluateImportedBody`. The subset is frozen, tests pin its
  canonical bytes and SHA-256, and a future public Document v7 will keep
  accepting it, so imported-body documents saved by 0.2 stay readable.
- `parseImportedBodyDocument` and the staged Document v7 parsers and migrations
  now honor raised `ParseDocumentOptions.limits`, such as `maxNestingDepth`,
  `maxStructuralValues`, and `maxResourceLocations`. Previously a second
  internal check capped every limit at its default, so documents within the
  caller's raised limits were rejected with an opaque `IR_INVALID`.
  `parseImportedBodyDocument` applies the same limits when it checks the
  document against the imported-body subset.
- Imported-body diagnostics no longer alter user-authored values that contain
  "v7", "V7", or "staged". Resource and body IDs, locations, and kernel IDs such
  as `parts/bracket_v7.step` or `occtV7-custom` now appear exactly as written.
- Imported-body diagnostics now point at the offending field. Creation errors
  report `/name`, `/definition/id`, `/definition/resource/digest`,
  `/definition/resource/byteLength`, or the duplicated location's index instead
  of `/definition`. Parse-time policy errors use document pointers such as
  `/resources/<id>/mediaType`. Every invalid evaluation option is reported under
  `/options` before the resolver runs: `resourceLimits.maxResourceBytes` must be
  a non-negative safe integer (an explicit `null` is now rejected instead of
  meaning the default), `signal` must be an `AbortSignal`, and `documentLimits`
  must be a plain record of known document-limit names with non-negative safe
  integer values.
- `inspectKernelDocumentBodyImportCapabilities` now reports a
  `documentBodyImport` envelope as malformed, with reason
  `incompatible-kernel-representation`, when the kernel's capabilities are not
  exact B-Rep (`exact` is not `true` or `representation` is not `"brep"`). Its
  `details` give the expected and actual representation and exactness, and
  `kernelSupportsDocumentBodyImport` returns `false` for such a kernel. Before,
  a mesh or inexact kernel could advertise a valid strong document-body import
  envelope. `KernelDocumentBodyImportCapabilitiesMalformedReason` gains the new
  member, so exhaustive `switch` statements over it need a new case.
- `auditKernelShapeArtifactCodec(...)` and
  `auditKernelShapeArtifactCodecV2(...)` now validate the expected kernel ID,
  the expected artifact format, and a candidate codec's declared format with the
  artifact cache's own identity rules: nonempty, well-formed UTF-8 of at most
  `256` bytes. An identity with an unpaired UTF-16 surrogate or more than 256
  UTF-8 bytes could never be advertised or used as a cache key. It now fails the
  audit with `ARTIFACT_CACHE_ENTRY_INVALID` instead of passing a candidate
  audit.
- `hashKernelShapeArtifactSemanticWitness(...)` now rejects a string that
  contains an unpaired UTF-16 surrogate with `ARTIFACT_CACHE_ENTRY_INVALID`
  instead of hashing it with U+FFFD substituted. Before, strings that differed
  only in such characters produced the same witness, so a codec that altered
  them could still match. Well-formed strings and byte input hash exactly as
  before.
- Semantic-observation topology labeling now charges the canonical bytes of
  every graph-search leaf after the first to `maxCanonicalWork`. Highly
  symmetric topology with large descriptor or lineage payloads used to run for
  seconds to minutes without yielding under the default limits. It now fails
  promptly with an `ARTIFACT_CACHE_LIMIT_EXCEEDED` diagnostic for
  `maxCanonicalWork`. Graphs whose refinement is already discrete, including
  ordinary geometry, pay nothing extra, and every successful observation and
  witness is unchanged.
- The stock OCCT kernel object no longer exposes its repository-private
  shape-artifact candidate operations through a symbol-keyed getter or prototype
  methods that could be found by reflection. The public API, the
  `GeometryKernel` surface, and the absent `shapeArtifacts` capability are
  unchanged.
- The private stock-OCCT shape-artifact candidate now checks binary-BREP
  derived-descriptor drift against each restored face's or edge's native scale,
  within 64 units in the last place: its largest native bounds coordinate for
  centers and bounds, its largest bounds side for lengths and radii, the product
  of its two largest bounds sides for areas, and 1 for unit vectors. A slender
  face is therefore not given the square of its longest side as its area scale.
  Distance from the origin never loosens a length, area, or radius check, a
  stored sidecar value can no longer widen its own tolerance, and a non-finite
  tolerance rejects the artifact.
- Breaking: `invariantcad export` now requires `--output` when the document has
  more than one output, and otherwise fails with usage exit code 2 after
  validating the document and before initializing a kernel. Scripts that relied
  on the implicit choice must now name the output. The published 0.1.1 CLI
  silently exported only the first output in the parsed document's `outputs` key
  order, which is sorted name order only for a canonically serialized document,
  and dropped the rest. Single-output documents may still omit `--output`, and a
  document with no outputs now prints a one-line reason with exit code 1 instead
  of a stack trace. Because frozen v1-v6 output names may be the empty string,
  `--output` (unlike the other options) accepts an empty value, so `--output ""`
  or `--output=` selects such an output.
- CLI argument handling now fails closed. `validate`, `inspect`, `bom`, and
  `export` reject unknown or command-inapplicable options, extra positional
  arguments, missing values, empty values for any option other than `--output`,
  duplicate single-value options, and malformed inline parameter assignments
  with usage exit code 2 before document I/O or kernel initialization.
  `inspect`, `bom`, and `export` accept repeatable `--parameter name=value` and
  `--parameter=name=value` overrides using finite JSON-number syntax. Names
  address exact stored parameter keys, including keys preserved by directly
  evaluable frozen legacy documents; the final `=` separates the key from its
  value. Inline overrides take precedence over named configurations and document
  defaults. They are mutually exclusive with the existing
  `--parameters values.json` input, so automation cannot depend on an implicit
  file-versus-command-line precedence rule. Syntactically valid unknown
  parameter IDs still reach the evaluator's structured `PARAMETER_MISSING`
  diagnostic, and the installed-package smoke gate runs representative
  strict-preflight failures and repeatable `inspect`, `bom`, and `export`
  overrides through the packed binary. Command-scoped help validates supplied
  option values, and parameter files are loaded before geometry-kernel
  initialization.
- `invariantcad export` now reports export and write failures as diagnostics
  instead of a JavaScript stack trace. Exporting an assembly to an exact format,
  or requesting STEP/BREP with `--kernel manifold`, now prints the structured
  `ERROR EXPORT_UNSUPPORTED: ...` line. A destination that cannot be written,
  such as one in a missing directory, prints a one-line
  `Output file could not be written: ...` reason. Both still exit with code 1,
  and any other `CadError` that reaches the CLI is also printed as diagnostics.
  The published 0.1.1 CLI printed stack traces with absolute source paths for
  these failures.
- The CLI checks document and parameter files against the default 64 MiB ceiling
  before reading them, decodes them as strict UTF-8 without stripping a
  byte-order mark, and rejects parameter files with repeated member names.
  Missing, unreadable, oversized, or malformed document and parameter files now
  print a one-line reason with exit code 1 instead of a stack trace.
- The CLI now escapes text from a document so an untrusted document cannot drive
  the terminal. Wherever it echoes such text in plain output (the `validate`
  success line, diagnostic paths and messages, and one-line input-file and
  export reasons), control characters, Unicode line and paragraph separators,
  and bidirectional embedding, override, and isolate controls are written as
  `\uXXXX`. In `inspect` and `bom` JSON output, DEL, C1 controls, U+2028/U+2029,
  and the bidirectional embedding, override, and isolate controls inside strings
  are written as `\uXXXX` escapes, and the JSON parses to the same values. The
  published 0.1.1 CLI wrote them raw, so a document could send terminal escape
  sequences or forge extra output lines, such as a second success line or a CI
  workflow command. Ordinary names print unchanged.
- `loadAttestedOcctRuntime` from `invariantcad/kernels/occt/node` and
  `invariantcad/kernels/occt/browser` now rejects a `metadata/release.json` that
  starts with a UTF-8 byte-order mark, failing with `invalid-release-manifest`.
  In 0.1.1 the decoder silently stripped the BOM. A BOM-prefixed copy pinned by
  its own digest was therefore accepted as exact canonical JSON and given a
  second `declaredBuildIdentity` for the same declared recipe. Canonical
  manifests and the reviewed ABI 0.9 pin are unaffected.
- The browser deployment guide's example Content Security Policy is corrected to
  `script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'`. The bundled
  Manifold 3.5.1 runtime and the stock `occt-wasm` 3.8.0 glue are Emscripten
  Embind builds that generate binding invokers with `new Function` while they
  initialize. Under the previously documented `script-src 'self' blob:
  'wasm-unsafe-eval'` policy, and under the attestation guide's
  `script-src 'self' blob:` example, Chromium throws `EvalError`, so neither
  `createEvaluator()` nor `createOcctKernel()` can start. This has been true
  since 0.1.1. Both guides now explain why `'unsafe-eval'` is required and that
  the attested browser loader also needs `blob:`. The Chromium release gate
  serves its production bundle and module workers under exactly the documented
  policy and fails on any CSP violation.
- The npm package no longer ships TypeScript declaration maps. In 0.1.1, every
  `.d.ts.map` pointed to a `../src/*.ts` file that the package does not include,
  so editors could not follow them. Declarations keep their JSDoc, and the
  JavaScript source maps, which embed their sources, are unchanged.
- Raised the runtime `zod` floor to `^4.6.7` for GHSA-mrhx-c7xc-m3w5 (memory
  exhaustion while validating oversized constrained collections). Zod 4.6
  reports an own `__proto__` key on a strict object as unrecognized, where Zod
  4.4 skipped it, so frozen v1-v6 documents containing that key began to fail
  under the previous `^4.4.3` range. Every public frozen v1-v6 schema and parse
  path now strips own enumerable `__proto__` keys from plain records and arrays
  before validation, preserving the admitted legacy meaning on every supported
  Zod release while keeping each exported schema object's identity, class, and
  shape. The pass copies only when such a key exists, preserves prototypes,
  descriptors, sharing, and cycles, and never invokes accessors. Document v7
  keeps Zod's strict rejection. Zod's lazily installed defaults are also settled
  before the v7 runtime-integrity snapshot.
- Resolved published advisories in build, test, and documentation tooling.
  `vite`, `vitest`, and `@vitest/coverage-v8` moved to patched releases, the
  documentation toolchain to Mint 4.2.742, and version-pinned overrides select
  patched transitive releases, including PostCSS 8.5.23, brace-expansion 5.0.12,
  qs 6.16.2, follow-redirects 1.16.2, and API Extractor's minimatch 11.0.3. None
  of these packages ships in `invariantcad`. The release audit now allows
  exactly two documented exceptions, both admitted only while every finding is a
  development dependency reached exclusively through `mint`: GHSA-mrhx-c7xc-m3w5
  in the `zod` 3 versions that every published `mint` release pins, and
  GHSA-g3hv-75wg-m249 in the minimatch 3.1.5 inside Mint, which has no patched
  3.x release. The audit fails on any other advisory or path and fails when an
  exception no longer matches.
- GitHub release notes now link to the hosted documentation site. The release
  workflow used to copy each release page verbatim, so site-relative links such
  as `/evaluation/evaluator` and `../roadmap.md` resolved against the repository
  on GitHub and were broken in the v0.1.0 and v0.1.1 releases. Documentation
  links, image sources, angle-bracketed destinations, and reference definitions
  are now published as absolute URLs on the hosted site, while inline code
  (including wrapped and multi-backtick spans) and fenced or indented code
  blocks, including those inside lists and block quotes, are left unchanged.
  Release metadata checks also reject a relative link that leaves the
  documentation site, so a dead link is caught before publication.
- The generated export index can no longer silently omit a public export. Its
  generator rejects export forms it cannot read, such as destructured constants
  and generator functions, accepts a final re-export written without a
  semicolon, and requires each entry point's names to match its API Extractor
  report. It also sorts names with an explicit English collation, so
  `pnpm docs:generate` and `pnpm docs:check` produce the same result on every
  host locale.
- The documentation gate now rejects title or description frontmatter values
  that are blank, including double-quoted values made only of escaped whitespace
  such as `"\u0020"`, that use an escape YAML does not define, or that continue
  onto an indented line, including after blank or comment lines.
- `pnpm example:bracket` works again and now runs as part of `pnpm verify`. Its
  compact configuration narrowed the plate without moving the mounting holes, so
  the holes crossed the outline once hole containment became enforced.
- Release-gate internals: the private disposable-worker coordinator now observes
  a worker's result even when a deadline or abort wins during startup, or when
  the handle has no terminate method, so a result that rejects on termination no
  longer surfaces as an unhandled rejection.
- Documentation alignment: the complete guide, the architecture page, the
  README, the documentation home, the roadmap, and the support matrix were
  corrected against the code. Each now distinguishes behavior published in 0.1.1
  from changes new in 0.2.
- Corrected the topology documentation. The persistent-topology guide no longer
  promises a geometric fallback for items that share a creation anchor: with
  complete history, any role or sketch-source anchor is authoritative. Items
  that share a source-free class role, such as the lateral edges of an
  extrusion, therefore cannot be captured and must be selected semantically. The
  topology-selection guide now explains that fillet and chamfer cardinality
  counts tangent-contour seeds, not the edges finally treated, and that
  `atLeast` and `between` selections do not report an item gained or lost inside
  their accepted range; only `select()` and `exactly(n)` fail on any change in
  match count. The topology-language reference now documents default tolerances,
  oriented face normals, sign-insensitive edge directions, per-axis position
  tolerance, and every case in which `explainTopologySelection` returns a failed
  result.
- Corrected the evaluation, modeling, and export documentation. It now lists
  every `CreateEvaluatorOptions` field and the complete requirements of each
  evaluator profile, documents expression parameter overrides and the
  `EvaluatedDesign` `parameters` and `diagnostics` members, requires disposing
  results before their evaluator, and states that a cone's `radiusTop` may be
  zero. The assembly placement example now puts the instance named `right`
  at +100 mm. The web-server and browser-download export snippets copy bytes
  with `Uint8Array.from(...)` so they type-check with the DOM library.
- Corrected the modeling pages. The Features page revolve example now uses an
  off-axis profile and states the axis rule, and the page notes that fillet,
  chamfer, shell, and offset need the `mechanical-exact` profile. The paths page
  arc and composite examples now use exact coordinates and evaluate, with a
  CI-executed composite sweep example; the page also lists every loft
  compatibility rule and explains miter clearance. The sketches page documents
  arc constraints inside closed loops and their workarounds.
- Corrected the document reference. The Document v3 and v4 rows now credit
  topology roles rather than new node kinds, since every frozen version admits
  the same 20 node kinds. Frozen node schemas are documented as structural. The
  limits page now describes how v1-v6 parsing treats accessors and Array
  subclasses. The imported-body walkthrough unwraps its `CadResult` before use.
- The installation guide now states that InvariantCAD and its runtime
  dependencies declare no install scripts, so `npm install --ignore-scripts` and
  pnpm's default blocking of dependency build scripts are supported. It
  previously suggested that the OCCT and browser toolchains might need
  unspecified install-time preparation allowed.
- The OCCT facade README (`native/occt/README.md`) now describes the Node
  attested loader correctly. Node 22.15 and newer use an isolated per-load
  `node:module.registerHooks()` hook with no hook worker. Only Node 22.13 and
  22.14 fall back to the process-wide `node:module.register()` worker hook,
  which needs worker permission under the Permission Model.

## [0.1.1] - 2026-07-24

- Added three executable reference models—an electronics enclosure, bolted
  flange, and hollow stepped shaft—and a six-case Manifold/OCCT benchmark
  protocol v2. The protocol reports bounded measurements and process evidence
  without presenting development-run timings as universal performance claims.
- Expanded the canonical documentation gate to six executable modules covering
  22 declared workflows across parametric evaluation, exact modeling and STEP
  export, assemblies and configurations, document migration and hashing,
  persistent topology, and structured diagnostics and limits.
- Staged feature-hash protocol v2 and hardened the internal Document v7
  resource/runtime boundary against mutable JavaScript intrinsics, hostile
  descriptors, prototype pollution, opaque thrown values, and direct-schema
  bypasses. Both protocols remain internal and do not widen the v1-v6 public
  document aliases.
- Raised the checked coverage floors to 84% statements, 78% branches, 90%
  functions, and 85% lines after measuring 88.35%, 83.61%, 95.14%, and 89.40%
  respectively across the release suite.
- Migrated the Node OCCT attestation loader to isolated, short-lived
  `node:module.registerHooks()` hooks on Node 22.15 and newer, avoiding
  `DEP0205` on Node 26 while retaining the asynchronous worker-hook fallback
  required by Node 22.13 and 22.14. The runtime gate now covers distinct
  concurrent sources, mixed failure/success recovery, hook deregistration, and
  an explicitly forced fallback path.
- Added a versioned strong document-body import contract to the geometry-kernel
  API. Stock OCCT now advertises and enforces STEP file units plus declared
  text/binary BREP units, accepts only one valid positive solid without loose
  topology, normalizes orientation, rejects invalid UTF-8 and non-finite
  geometry, snapshots caller bytes, and releases every provisional native
  handle on failure or cancellation. This remains a low-level foundation until
  the staged Document v7 imported-body workflow is promoted.
- Staged strict Document v7 resource, datum, shape-algebra, multibody, and
  external-occurrence foundations without widening the current v1-v6 public
  aliases. Content-addressed resolver work is bounded, lexically ordered, and
  copy-isolated; byte length and SHA-256 are verified before retained bytes can
  be read, and adversarial tests cover callback mutation, nested thenables,
  cancellation races, shared storage, inherited fields, and limit
  short-circuiting.
- Added strict, executable documentation examples for the default Manifold
  lifecycle and stock-OCCT STEP export. Selected README and Mintlify code
  fences are now generated byte-for-byte from those canonical sources, checked
  for drift during `docs:check`, and exercised separately against both runtimes.
- Corrected evaluated-output and standalone mesh-export overloads so literal
  binary formats infer `Uint8Array` and literal text mesh formats infer
  `string`; assembly exports now accept only the mesh formats they support.
- Added declaration-level public API reports for every supported package entry
  point. CI now rejects unreviewed changes to exported signatures while the
  generated export index continues to reject undocumented exported names.
- Added named `mesh-preview` and `mechanical-exact` evaluator profiles. Profile
  creation now loads the appropriate bundled/stock backend by default and
  verifies its complete baseline—including callable features, exchange, and
  topology for exact mechanical work—before returning an evaluator. Custom
  kernels can be checked independently with an immutable capability report,
  while profile-rejected caller-owned kernels remain caller-owned.
- Advanced the maintained toolchain and exact backend to their latest stable
  releases: TypeScript 7.0.2, pnpm 11.17.0, Publint 0.3.22, Mint 4.2.740, and
  `occt-wasm` 3.8.0. The Node.js floor is now 22.13, with release coverage on
  22.13, 24, and 26. Package-type validation uses the current
  `@arethetypeswrong/core` API directly, avoiding the unrelated
  terminal-rendering dependency tree, and the owned OCCT facade was rebuilt
  and re-attested against the 3.8.0 source and builder.
- Added the first repository-private evaluator consumption of the unadvertised
  OCCT shape-artifact candidate. An unexported, explicit-`trusted` binding
  caches only requested solid outputs whose referenced feature is directly a
  box; it snapshots the document and effective options, validates capability
  and dimensions before store access, creates a fresh cache session per
  evaluation, rejects overlapping evaluation/disposal, and applies identical
  ownership, status, measurement, topology, empty-result, and cleanup checks to
  modeled and decoded shapes. Read-write corruption is evicted and recomputed;
  read-only poison, failed eviction, store/codec/write failure, and cancellation
  fail strictly. Dependency-bearing features remain uncached until a versioned
  diagnostic/topology-policy transcript can preserve warm-path observability.
  No public evaluator option, kernel method, root export, or `shapeArtifacts`
  capability was added.
- Hardened artifact keys and records with canonical UTF-8 metadata limits:
  `1,024` bytes for node IDs, `256` for identities, `2,048` for solver/codec
  fingerprints, and `16,384` for aggregate canonical key material. Record
  creation copies a non-shared payload before its first await and rejects
  `SharedArrayBuffer` backing. A package-private atomic encode/write transaction
  now gives the codec the exact race-free remaining budget, conservatively
  accounts work, hashes once, and publishes one record. Zero or positive
  insufficient codec ceilings and trusted-store aggregate refusals now retain
  configured cumulative `ARTIFACT_CACHE_LIMIT_EXCEEDED` diagnostics. Fixed
  hash/key widths are checked before slicing, hostile record field
  dereferencing is capped, and evaluator feature-hash lookup is indexed once
  instead of scanning per direct output. SHA-256 remains
  corruption/misrouting detection rather than authenticity against a store that
  can replace both artifact and digest.
- Made the private evaluator entry point and cache-session coordinator
  runtime-private with ECMAScript `#` methods and state, guarded session
  construction, and a frozen public session projection. Packed-package checks
  now reject the two internal subpaths, require the public prototypes to omit
  all coordinator methods, and verify the new public byte-ceiling constants.
  This closes a JavaScript-level bypass that TypeScript's erased `private`
  modifier alone could not enforce.
- Extended the Chromium production-bundle evidence with the private direct-box
  evaluator path. The cold run records `miss,write`, performs one native box,
  and persists one entry; the warm run records `hit`, decodes with zero
  additional box calls, and must reproduce measurements, complete topology
  counts, outputs, and diagnostics exactly. Public capability and codec methods
  remain absent, the store is explicitly trusted, evidence retains
  `certifiesCompatibility: false` and
  `certifiesOperationalCancellation: false`, and cleanup precedes the detached
  response.
- Advanced the owned fresh-process protocol to v3 with `cache-produce` and
  `cache-consume`. Two independent verified ABI-0.9 producers must emit
  byte-identical records and detached evidence after one direct-box native call
  and `miss,write`; a compatible read-only consumer must `hit`, decode, perform
  zero native box calls, and reproduce complete measurements/topology. A
  different solver fingerprint must derive another key, miss, and model once
  without invoking either codec direction. The parent transports one bounded
  binary record with versioned magic, a closed canonical-JSON header, fatal
  UTF-8, exact length/EOF, record/key/integrity validation, and SHA-256.
  Tampered payload, forged key/metadata, shared or hostile views, abort, and
  injected failure are followed by fresh recovery. Evidence explicitly names
  the trusted parent-mediated boundary, sets record authentication false, and
  retains compatibility and operational-cancellation non-claims.
- Normalized the npm CLI executable target to npm's canonical package-relative
  form and added a release check for its path, shebang, and executable mode.
- Replaced token-based release authentication with npm Trusted Publishing and
  a short-lived GitHub Actions OIDC identity.
- Added public, environment-specific owned-OCCT runtime loaders at
  `invariantcad/kernels/occt/node` and
  `invariantcad/kernels/occt/browser`. They snapshot caller-owned bytes, verify
  canonical `metadata/release.json` against an independently trusted SHA-256
  pin, verify the exact JavaScript/WASM sizes and digests before importing
  JavaScript, and return an opaque matched pair for
  `createOcctKernel({ attestedRuntime })`. Kernel creation checks the initialized
  facade marker and gives each instance a fresh verified WASM copy. The exact
  runtime-pair identity is bound only into the repository-private artifact
  compatibility fingerprint; the separate declared-build identity records the
  manifest while explicitly leaving build execution, publisher identity, and
  compatibility uncertified. On Node 22.15 and newer, each load uses an
  isolated, short-lived `node:module.registerHooks()` hook that is deregistered
  after import. Node 22.13 and 22.14 use the compatible process-wide
  `node:module.register()` worker-hook fallback and require worker permission
  under Node's Permission Model. Neither path writes a temporary executable
  file. The browser loader imports a short-lived Blob URL and therefore requires
  `blob:` in the applicable CSP. Executable pair authority remains private to
  the evaluated InvariantCAD internal module instance that created it, and no
  backend now advertises `shapeArtifacts`.
- Reworked the roadmap into explicit shipped, repository-only, in-progress,
  planned, and deferred tracks, including everyday modeling, visualization,
  CAE, plugins, performance, runtime coverage, and measurable 1.0 criteria.
- Added project governance, support, Code of Conduct, issue forms, a pull
  request template, and expanded contributor guidance for the public project.
- Added TS7-compatible source correctness linting and deterministic format
  hygiene checks to the ordinary verification and release gates.
- Added repository-private one-shot isolation evidence for the unadvertised OCCT
  shape-artifact candidate. An unexported disposable-operation coordinator
  enforces pre-abort, timeout/abort termination, exactly-once settlement, and
  awaited cleanup. The Chromium production-bundle gate transfers a copied
  committed v3 fixture into a stock-runtime module worker, proves source-byte
  immutability and transfer detachment, hard-terminates a started non-yielding
  worker, and decodes successfully in a fresh worker while returning only
  scalar evidence after native cleanup. A separate Node gate runs owned ABI 0.9
  producer A and consumer B in one-shot child processes, verifies packaged
  `metadata/release.json` against the reviewed manifest pin, imports the exact
  verified JavaScript through the module hook, supplies the verified WASM copy,
  checks deterministic artifact and evidence, rejects one-byte manifest/runtime
  tampering, and proves post-start `SIGKILL` timeout/abort, injected-trap
  discard, and fresh recovery. It runs as
  `pnpm test:occt-artifact-process` and is included in the facade-bundle gate.
  Its evidence explicitly sets `certifiesCompatibility: false`: these checks do
  not authenticate build execution or a publisher, protect against a trusted
  host/module-hook chain or same-UID process, prove live/peak memory or a real
  OCCT trap, establish cross-edit/persistent assembly identity or shared-TShape
  ancestry across distinct locations, establish a reviewed cross-platform
  matrix, or expose a public/production evaluator cache, and no backend now
  advertises `shapeArtifacts`.
- Extended the repository-private isolation gates through real
  `Evaluator.evaluate(...)` work without adding a public isolated-evaluation
  API. Fresh owned-ABI-0.9 Node children evaluate a deterministic two-box
  Boolean union and must emit the exact `operation-started` then
  `kernel-operation-started` sequence. The second marker is emitted immediately
  before the wrapped native Boolean, proving entry rather than completion; the
  injected non-yielding stall is placed only after that Boolean returns and
  emits a third exact `non-yielding-stall-started` marker. Timeout requires that
  marker, while abort waits for it before sending `SIGKILL`; both wait for child
  close and are followed by a fresh evaluation with identical detached
  measurement, topology, document, and runtime evidence. Incomplete nonempty
  stdout event prefixes are rejected, while a failure before operation start
  legitimately emits no event. Successful evidence is written only after
  evaluated-design and evaluator cleanup, and an injected cleanup failure cannot
  produce success. The Chromium production-bundle gate likewise runs the real
  evaluator on stock OCCT, completes a native box before stalling inside its
  wrapper, requests worker termination for both deadline and post-start abort,
  and recovers identical scalar evidence in a fresh worker. Browser
  `Worker.terminate()` has no completion promise, so this proves the termination
  request and fresh-worker recovery, not observed worker exit. A killed realm
  cannot run language-level cleanup; destroying the realm is the containment
  boundary. Ordinary public evaluation remains same-thread and cooperatively
  cancellable. These gates do not add public cache configuration, advertise
  `shapeArtifacts`, certify operational cancellation or compatibility, provide
  cross-edit/persistent assembly identity or distinct-location
  `IsPartner`/shared-TShape proof, or establish a cross-platform matrix.
- Made `createOcctKernel` snapshot every caller-owned initialization option
  before its first asynchronous import, including cross-realm URL state and
  copied WASM bytes, so later caller mutation cannot make execution inputs and
  the selected stock/custom runtime identity disagree.
- Replaced the repository-private OCCT candidate's canonical-JSON state with a
  bounded binary sidecar v2. Its 48-byte big-endian header preflights exact
  topology, adjacency, lineage, UTF-16BE string, and native-orientation totals;
  encoding uses a counting pass and one exact output allocation, while decoding
  enforces canonical finite binary64 values, closed tags and masks, sorted
  unique references, reciprocal topology, and exact EOF. The deterministic
  `11,591`-byte v2 fixture preserves the v1 semantic witness; v1 and v2 fixtures
  are now retained as the negative corpus for current format v3, and a read-only
  generator check is part of ordinary verification. Production capability
  advertising remains blocked by the separate native-allocation, cancellation,
  identity, authenticated-build-provenance, and reviewed cross-platform proof
  gaps.
- Advanced the repository-private OCCT candidate envelope to format v3 while
  retaining bounded binary sidecar v2, and added native identity format v1.
  Its 64-byte identity header carries canonical zero-based direct-child paths
  to the first `IsSame` occurrence of each unique located solid, shell, wire,
  face, edge, and vertex plus a complete rooted pre-order occurrence stream.
  Each fixed 12-byte occurrence record binds shape type, composed orientation,
  direct-child count, and the canonical `IsSame` class for those six indexed
  kinds; compound, compsolid, and generic-shape nodes remain unindexed but their
  exact structure, order, orientation, and multiplicity are recorded. Producer
  paths are lexicographically sorted per kind, with the same permutation
  applied to topology, native orientations, and occurrence class indices;
  decode remaps paths onto the consumer's raw enumeration and rejects
  multiplicity, order, orientation, `IsSame`-class membership, geometry,
  incidence, or structure substitution before restoring semantic records onto
  fresh keys. Closed
  ceilings allow at most `100,000` paths, `1,000,000` path components, depth
  `64`, child index `999,999`, `100,000` occurrences/traversal visits, and
  `1,000,000` `IsSame` comparisons. The fingerprint binds
  `nativeIdentity=serialized-first-issame-child-path-v1`,
  `nativeOccurrenceManifest=complete-rooted-preorder-type-orientation-child-count-issame-class-v1`,
  `nativeOccurrenceRecordBytes=12`, `nativeIdentityMaxOccurrences=100000`,
  `nativeIdentityTraversalOccurrences=100000`, and the remaining
  identity/version/limit declarations. The deterministic `13,735`-byte v3
  golden has fixture witness
  `invariantcad:kernel-shape-artifact-fixture:v1:sha256:4279e9f76ab1e41dae47b28aea9c426ffa8b5f329ab624f137c65f6881e23918`;
  v1 and v2 are retained only as negative rejection fixtures. A dedicated
  duplicate-occurrence regression gate proves that a one-component artifact
  rejects a substituted two-occurrence BREP transactionally. Stock
  `occt-wasm` does not expose `IsPartner`, so v3 cannot attest shared underlying
  TShape ancestry across distinct-location `IsSame` classes. Envelope,
  sidecar-v2, and identity-v1 lengths and end-of-input are exact, but the stock
  BREP reader tolerates a valid archive with suffix bytes; strict BREP
  consumption is therefore an owned-ABI-0.7+ guarantee, not a stock candidate
  guarantee. It also does not create cross-edit or persistent assembly
  identity, advertise a public cache, certify compatibility, establish a
  reviewed cross-platform matrix, or add hard cancellation.
- Advanced the repository-private owned OCCT facade and compliance bundle to
  ABI 0.8 with a fixed 128 MiB per-operation ceiling over cumulative allocation
  requests observed at twelve reviewed linker-wrapped entry points. Reports
  expose validated request/call telemetry, ABI 0.7 remains loadable without the
  new argument, and disposable-process tests cover write/read denial plus
  recovery. This is unadvertised defense-in-depth: direct C denial is fail-stop,
  and strict BinTools count/product preflight, work bounds, cancellation,
  runtime-pair verification, identity outside v3's bounded scope, and reviewed
  cross-platform goldens require separate gates; the exact pair gate is supplied
  independently by the attested loader above.
- Advanced the repository-private owned OCCT facade and compliance bundle to
  ABI 0.9 with an exact parser for the owned writer's BinTools-v4 profile before
  `BinTools::Read`. Decode now validates canonical sections, finite geometry,
  counts and products, table and representation references, locations, the
  TShape hierarchy, complete reachability, and exact EOF under fixed limits of
  `1,000,000` structural work units, `64` nesting levels, and location-power
  magnitude `1,000,000`. Conservative squared geometry, representation, and
  topology-validation envelopes plus bounded TShape metadata are charged before
  deserialization; global geometry squaring deliberately admits roughly fewer
  than `1,000` geometry work units under the shared cap, and the metadata
  allocation is also charged to ABI 0.8's retained 128 MiB cumulative native
  request budget. This is a private artifact-compatibility ceiling, not a core
  modeling limit. Reports expose preflight limit/usage, depth, location-power,
  consumed-byte, completion/code, and deserialization-start telemetry. The
  private candidate still does not advertise `shapeArtifacts`; these controls
  are not live/peak-memory accounting, prompt same-thread cancellation,
  authenticated build execution or publisher identity, reviewed cross-platform
  compatibility proof, or comprehensive durable identity for symmetric
  topology.

## [0.1.0] - 2026-07-22

### Release highlights

- First public release of the immutable, versioned TypeScript CAD document and
  authoring system.
- Manifold mesh and OpenCascade exact B-Rep backends with explicit capability
  negotiation and WebAssembly lifetime management.
- Core mechanical modeling, semantic and persistent topology, deterministic
  analysis/BOM/configuration workflows, interchange, CLI, and package-level
  conformance gates.
- Incremental feature identity and a bounded artifact/cache protocol foundation;
  production shape codecs and evaluator cache consumption remain future work.

### Detailed changes

- Added a production Vite/Chromium smoke test that exercises the package's
  default browser initialization for both Manifold and stock OpenCascade,
  including real geometry, topology, STL, and STEP assertions.
- Bundled only Manifold 3.5.1's standalone core JavaScript/WebAssembly runtime,
  pinned by npm integrity, an identified upstream build run/commit, byte
  length, and SHA-256, with notices for embedded and toolchain components. This
  removes the unrelated glTF/image stack and its sharp advisory from both npm
  consumers and the repository dependency graph; the release audit now
  requires zero production or development advisories.
- Added a Mintlify-ready documentation site with structured learning,
  modeling, topology, evaluation, analysis, interchange, reference, protocol,
  and project navigation, and reduced the root README to a focused landing
  page while preserving the exhaustive 0.1 guide under `docs/reference/`.
- Added the public security policy, a fail-closed production advisory gate, a
  patched esbuild development-tool override, complete npm metadata, pinned CI
  actions, a provenance-capable release workflow, a documentation index, and
  the maintainer release runbook.
- Added bounded incremental feature identity through `hashDesignFeatures(...)`, `FEATURE_HASH_PROTOCOL_VERSION`, and `DESIGN_FEATURE_HASH_REPORT_VERSION`. Feature-hash v1 detaches and validates one document, resolves the evaluator's selected-configuration/call-time/default parameter precedence, applies effective materials and instance suppression, canonicalizes commutative selector logic and consumed persistent-reference evidence, and returns sorted deeply frozen SHA-256 Merkle entries and output hashes. An isolated effective-intent change admitted by v1 invalidates its node and descendants without perturbing unrelated branches, and equivalent effective contexts may share hashes. `FeatureHashLimits` cap feature nodes, dependency links, and canonical bytes; `HashDesignFeaturesOptions.signal` returns structured `EVALUATION_ABORTED` cancellation. These are raw effective-intent identities, not B-Rep digests, geometric/topology proofs, kernel attestations, or sufficient cache keys by themselves.
- Added kernel shape-artifact and cache protocol v1 as a strict but not-yet-integrated foundation. `KernelCapabilities.shapeArtifacts` must appear with both `encodeShapeArtifact(...)` and `decodeShapeArtifact(...)`; encoding returns detached caller-owned bytes without taking the source shape, while decoding borrows immutable input and returns a new caller-owned live shape under hard byte and cancellation contracts. `createKernelShapeArtifactCacheKey(...)` binds one solid feature-hash entry to evaluator-semantics, kernel ID, backend artifact protocol/format/version/compatibility fingerprint, and sketch-solver ID/`artifactCompatibilityFingerprint`, rather than reusing the weaker topology-signature fingerprint. Solver compatibility is opt-in and fail-closed; the built-in floating-point reference solver deliberately omits a fingerprint pending exact cross-runtime numeric conformance. Integrity-checked detached `ArtifactCacheRecordV1` values, exact metadata validation, bounded cancellable read/write/delete helpers, public pre-materialization `ArtifactCacheStoreLimitError`, prompt queue-safe session cancellation, async-safe event observation, concurrency-safe aggregate `ArtifactCacheSession` accounting, `ArtifactCacheStore`, and the copying `MemoryArtifactCacheStore` establish the storage boundary and new structured artifact-cache diagnostics. No shipped Manifold or OCCT backend advertises a codec and evaluation does not consume the store yet. Ordinary OCCT STEP/BREP exchange is insufficient because it reconstructs partial-history geometry without wrapper-level semantic lineage, history completeness, topology annotations, analytic volume overrides, or other evaluator-observable state.
- Added the public framework-neutral `invariantcad/conformance` kernel shape-artifact audit boundary. `auditKernelShapeArtifactCodec(...)` separates an explicit, not-yet-advertised candidate codec from an already-advertised production codec, exact-matches kernel ID plus artifact protocol/format/version/fingerprint, and exercises caller-defined tagged semantic witnesses plus golden-first decode fixtures across fresh kernel instances. Every self case additionally uses a dedicated fresh producer and fresh consumers to encode and cross-instance decode a reviewed pre-witness source in both disposal orders before the audit calls status or witness code. That branch proves only the positive full-limit pre-witness round trip and ownership; reduced-limit, cancellation, and malformed-input checks run on ordinary observed paths. The harness directly checks live status, independent shape/byte ownership, mutation and disposal isolation, empty/truncated input, returned-byte ceilings, and pre-abort behavior without wrapping or mutating a kernel or manufacturing capability metadata. The source factory remains trusted, and native allocation bounds, hidden cleanup, process-global coldness, in-flight synchronous cancellation, and cross-process portability need backend-specific gates. Passing evidence is not certification, a cross-runtime proof, or a cache-eligibility token. No shipped backend advertises support because complete serialization, stable fresh-subshape restoration, and exact runtime/format/options/tolerance fingerprinting remain open.
- Added repository-owned kernel-shape semantic-observation protocol v1 through `observeKernelShapeSemantics(...)`, `encodeKernelShapeSemanticObservation(...)`, and `hashKernelShapeSemanticObservation(...)`. A reviewed plan captures exact normalized IEEE-754 measurements/options, sorted oriented Float32 triangle multisets, exact key-neutral topology with lineage/history/incidence, optional native round trips, and downstream feature probes with explicit probe-or-exclusion coverage. Kernel metadata, methods, plans, status, measurements, meshes, and callback arrays are snapshotted once before validation; exact UTF-8 size is checked before full canonical stringification; triangle/topology materialization, graph search states, graph refinement work, strings, operations, native bytes, probes, and accepted derived shapes have explicit ceilings. Asynchronous probes are abort-raced and transferred owners are cleaned up; synchronous JavaScript/native work remains bounded cooperatively rather than timer-preemptible. The resulting deeply frozen tagged witness is a finite normalized evaluator-semantic quotient, not shape serialization, certification, cache validation, or eligibility. The lockfile-tested Manifold 3.5.1 public Float32 Mesh path remains unadvertised because a translated box irreversibly changes bounds and volume even after tolerance restoration.
- Added owned OCCT facade ABI 0.7 bounded shape-artifact transport for the private candidate. Native encode pins BinTools v4 with triangulation/normals disabled and writes through a chunked sink that cannot retain payload beyond the caller's cap; decode checks a borrowed `Uint8Array` length before one native snapshot, requires the pinned header and exact consumption, caps the retained topology graph before validity analysis, owns the decoded shape outside the arena, and permits one same-kernel transfer. The strict TypeScript adapter validates all report echoes, copies output before report deletion, releases a transferred root after any later failure, and aggregates primary plus cleanup errors. Raw native tests cover exact-cap/cap-minus-one output, nonzero-offset borrowed input, clone/foreign-kernel/one-shot ownership, malformed/trailing/topology-limit rejection, and arena neutrality; an owned-runtime candidate smoke disables the legacy MEMFS route. This boundary is still not allocation-safe against hostile BinTools element counts and does not advertise `shapeArtifacts`.
- Added a repository-private OCCT shape-artifact candidate hook for conformance development. Its versioned binary-BREP envelope pairs native geometry with a canonical key-neutral topology/native-orientation/lineage/history/volume sidecar; decode creates fresh evaluation-scoped keys and fails closed unless the restored root type and ordered face/edge/vertex structure and orientations exactly match the recorded evidence. Direct tests cover cold/warm shapes, two mesh profiles, partial history, analytic volume overrides, downstream selected topology, alternate valid BREP orientation/root wrappers, byte/owner isolation, malformed canonical state, cleanup, ceilings, abort entry, and fingerprint inputs; the repository audit also pins a reviewed asymmetric-box artifact and literal semantic/fixture witnesses across fresh instances. The hook has no package export and does not add `shapeArtifacts` to any shipped kernel. Owned ABI 0.7 uses the bounded transport, while stock and older facades retain the unbounded research path. Promotion remains blocked by hostile native count allocation, intermediate JSON sidecar allocation, same-thread in-flight cancellation, order-based symmetric topology, exact runtime attestation, and missing reviewed cross-process goldens; production also requires durable artifact-local native identity and a bounded binary sidecar.
- Added authored change-impact report v1 through `analyzeDesignImpact(...)` and `DESIGN_IMPACT_REPORT_VERSION`. The kernel-free analysis detaches and validates one document, accepts runtime-validated string seeds for nodes, parameters, materials, configurations, and persistent topology references, and propagates deterministic reasons through parameter expressions/bounds, material density, persistent selectors, and feature dependencies. Base and named-configuration contexts close independently with effective materials and active assembly instances before their results are unioned, so mutually exclusive overrides cannot synthesize a dependency path. Reports are deeply frozen and `maxStructuralValues` bounds context work. This is current-graph impact rather than field-level/document auto-diff, B-Rep comparison, cache validation, or topology-identity inference; the separate artifact protocol does not turn an impact report into a cache proof.
- Added `DesignDocumentV6` as the current authoring grammar. V6 extends persistent topology from faces and edges to exact B-Rep vertices, adds vertex `position(...)` queries, and admits face↔edge plus edge↔vertex adjacency queries. V1–v5 remain frozen under their original topology kinds, query grammar, role vocabulary, serialized evidence, bytes, hashes, and direct-evaluation behavior. `migrateDocument` now upgrades validated v1–v5 documents to v6 without capturing, relabeling, protocol-upgrading, or otherwise rewriting stored evidence, and is idempotent for v6. No semantic vertex roles are introduced.
- Added topology-signature protocol v2. V2 persists vertex point evidence, includes incident vertices in edge adjacency evidence, and supports vertex→edge one-hop matching while retaining the existing face→edge and edge→face evidence. Distinct coincident vertices remain distinct candidates and therefore resolve ambiguously when the stored evidence cannot distinguish them. Protocol-v1 face/edge reference structure, canonical bytes, evidence construction, and matching behavior remain frozen and supported.
- Extended exact OCCT topology snapshots with evaluation-scoped vertex descriptors and reciprocal edge↔vertex incidence. The OCCT adapter now advertises protocol v2 with primary topology descriptor `invariantcad-topology-descriptor@6`, plus one exact protocol-v1 compatibility profile using the same descriptor `@4` fingerprint previously advertised by stock/owned ABI 0.2–0.4 or the same descriptor `@5` fingerprint previously advertised by owned ABI 0.5+. Document v6, signature protocol v2, descriptor `@6`, and the native facade are independent version axes: exact indexed topology evolution remains v1, while current owned facade ABI 0.7 retains ABI 0.6's modeling/history surface and adds bounded artifact transport only for the repository-private candidate.
- Added `DesignDocumentV5` as the current authoring grammar, extending only the closed topology-role vocabulary with `fillet.face.blend` and `chamfer.face.bevel`. V1–v4 remain frozen, parseable, cloneable, stringifiable, hash-stable, and directly evaluable under their original vocabularies. `migrateDocument` validates and upgrades v1–v4 to v5, is idempotent for v5, and preserves every stored descriptor fingerprint, lineage, geometry, and adjacency record verbatim.
- Added strict semantic class naming for exact fillet/chamfer evolution. An identity-less result face receives `fillet.face.blend` or `chamfer.face.bevel` only from an incoming exact edge→face `GENERATED` record; the reducer does not infer roles from surface type, result order, or selected-edge indices. Generated edges, vertex-generated faces, and residual source-less `CREATED` topology stay unnamed. Multiple faces may share the same `{ feature, role }` anchor and therefore fail individual persistent matching as ambiguous. Recognized owned facades ABI 0.5+ now advertise topology descriptor `@5`; stock and older owned facades stay on `@4`, persistent-reference protocol remains v1, and current facade ABI 0.7 retains the ABI 0.6 modeling/history surface while adding bounded artifact transport only for the repository-private candidate.
- Expanded the persistent-topology torture corpus with an explicit owned OCCT facade ABI 0.6 descriptor-`@5` gate across every exact-evolution family. Inherited Boolean, fillet/chamfer, shell, and draft topology resolves by semantic lineage across parameter changes; exact generated treatment faces now also resolve semantically through their proved class role and drive both role and persistent downstream shell consumers. A two-contour treatment pins class-level ambiguity, while generated shell/offset topology and unnamed treatment edges remain geometry-only. The matrix round-trips Document v5 evidence without capture keys and checks native arena cleanup after success and failure. `pnpm test:occt-persistence-public` runs a supplied/default owned runtime, and the verified facade-bundle gate runs it automatically.
- Added ordinary topology-selection explanation version 1. `explainTopologySelection` returns a deeply frozen `resolved`/`missing`/`ambiguous` aggregate with the current history mode, candidates considered and matched, requested minimum, and a numeric-or-`null` maximum. Only resolved reports contain sorted current evaluation-scoped keys; missing and ambiguous reports are key-free. Invalid selectors, snapshots, query evaluation, and any nested selection failure—including persistent-reference resolution—remain failed results. Legacy `TOPOLOGY_SELECTION_MISSING` and `TOPOLOGY_SELECTION_AMBIGUOUS` diagnostics now include the report in `details.explanation`, while direct resolve and explain calls intentionally perform separate passes.
- Added topology-reference explanation version 1. `explainTopologyReference` returns a deeply frozen aggregate `resolved`/`missing`/`ambiguous` report from the exact bounded pass used by legacy fail-closed resolution, including captured/current history, stored semantic-anchor count, candidate totals, and separate semantic-lineage versus geometry-adjacency considered/matched counts. Only resolved reports contain a current evaluation key; non-resolved reports contain no candidate keys, descriptors, indices, ordinals, or enumeration-derived samples. The new explainable shared session caches explanation and resolution projections by reference identity without a second budget charge, while missing/ambiguous resolution and evaluator diagnostics carry the same report in `details.explanation`. Stored protocol-v1 evidence and frozen Document v2/v3/v4 bytes, hashes, and schemas remain unchanged.
- Added the initial published persistent-topology torture corpus against real stock OCCT descriptor `@4`: transformed source-aware extrusion faces and edges survive symmetry, dimension crossover, rotation, translation, serialization, disposal, and downstream shell/fillet consumption; partial Boolean evidence survives tool extremes but fails closed when its one-hop context changes; revolution caps disappear and recover across partial/full turns; and repeated multi-segment sweep sides remain explicitly ambiguous without invented path-segment identity. The corpus also covers exact multi-fingerprint variant selection and native shape-count recovery after successful and failed evaluations.
- Fixed cancellation observed during topology extraction or persistent matching so fillet, chamfer, shell, and draft are never invoked afterward. The evaluator now returns `EVALUATION_ABORTED` and releases the already-created input exactly once; focused regressions also pin cleanup on successful, missing, ambiguous, and work-limit paths.
- Added and froze `DesignDocumentV4` as the grammar expansion containing the six bounded-sweep role literals. V1, v2, and v3 remain frozen, parseable, cloneable, stringifiable, hash-stable, and directly evaluable under their original role vocabularies, including nested stored lineage and adjacency evidence. Its migration boundary validates and upgrades v1, v2, or v3 to v4 without capturing, upgrading, relabeling, or rewriting a stored descriptor fingerprint or any evidence; v5 now supersedes only the current authoring/migration target as described above.
- Added closed semantic naming for the bounded sweep contract. Authored path direction determines the source-free `sweep.face.start-cap` and `sweep.face.end-cap`. For `C` direct-profile boundary curves, `S` authored path segments, and `V` authored non-circular profile-curve starts, the exact remaining inventory is `C*S` `sweep.face.side` faces, `C` `sweep.edge.start-rim` edges, `C` `sweep.edge.end-rim` edges, and `V*S` source-free `sweep.edge.lateral` edges. Sides and both rim roles carry only an available source from their corresponding direct-profile curve; direct unsourced calls invent none, and caps and laterals remain source-free. Path segments receive no source identity, while internal path-joint/right-corner miter fragments and circular seams remain unnamed. The adapter proves the segment boundary graph and complete role inventory against the result; ambiguous, incomplete, branching, or nonlocal correspondence downgrades the whole snapshot to partial history. This milestone introduced `invariantcad-topology-descriptor@4`, intentionally incompatible with descriptor `@3` while persistent-reference protocol v1 remained unchanged. Stored `@3` variants remain byte-for-byte `@3` and require an explicitly captured or supplied matching variant for the active descriptor.
- Hardened document-version isolation by replacing moving `NodeIR` exclusions, the shared node-schema branch list, and the shared document-body shape with explicit versioned node-kind and top-level-field grammars, now extended through v5. Compile-time and runtime tripwires pin all 20 accepted node kinds and each version's exact body-field inventory. Migration copies only fields admitted by its source grammar. Legacy document bytes, hashes, and direct evaluation remain unchanged.
- Added and froze Document v3 as the grammar expansion that introduced the five ruled-loft roles. V1 and v2 remain parseable, cloneable, directly evaluable, byte/hash preserving, and frozen to their pre-loft roles, including nested stored lineage and adjacency evidence; v3 has the same guarantees under its loft-aware vocabulary. Migration never recaptures or relabels descriptor variants; the current v5 target is described above.
- Added closed semantic naming for the bounded ordered ruled-loft contract. The first and last section faces receive source-free `loft.face.start-cap` and `loft.face.end-cap` roles; every ruled face between corresponding curves on adjacent profiles receives `loft.face.side` with both available sketch-entity sources; section-boundary edges receive source-aware `loft.edge.section-rim` when their resolved curves carry sources; and the edge joining each authored non-circular curve start across adjacent sections receives source-free `loft.edge.lateral`. Direct unsourced profiles never gain invented sources, circular seams remain unnamed, and cyclically shifted authored curve phases are rejected. A missing, ambiguous, or incomplete seed correspondence downgrades the snapshot to partial history instead of publishing incomplete naming as authoritative. This milestone introduced `invariantcad-topology-descriptor@3`, intentionally incompatible with descriptor v2 while retaining persistent-reference protocol v1. It remains a valid historical stored variant, but resolution still requires an explicitly captured or supplied variant matching the active `@4` or `@5` declaration.
- Added Document v2 document-owned persistent face/edge selectors. The authoring surface can register one stable `TopologyReferenceId` against an exact solid-node target with canonical protocol/fingerprint variants, then compose `topology.faces.persistentReference(...)` or the edge equivalent through ordinary logical and adjacency queries consumed by fillet, chamfer, shell, and draft. V1 remains parseable, cloneable, evaluable, and hash-preserving and rejects the registry and atom in both its public types and schema; v2 remains frozen and migrates through the current v5 path described above. Evaluation preflights exact signature compatibility before input geometry, resolves every feature against one normalized snapshot with shared bounded matching work and per-ID caching, and preserves reference failures through all set operators. Added one-read detached document preflight with occurrence/resource limits, strict versioned boundaries, public schemas/types/limits, fake-kernel protocol tests, and a real parameter-changed OCCT capture/serialize/parse/shell flow.
- Added closed semantic revolution face roles to the OCCT topology descriptor: each boundary curve that produces a face maps to source-aware `revolve.face.swept`; an axis-contained boundary line collapses without a face; partial turns add source-free `revolve.face.start-cap` and `revolve.face.end-cap`; and full turns omit caps. Revolution edges, seams, poles, and other artifacts remain deliberately unnamed. Missing or ambiguous constructed-face correspondence downgrades history to partial instead of inventing a role. The recognized OCCT fingerprint now uses `invariantcad-topology-descriptor@2`, intentionally incompatible with descriptor v1 while retaining persistent-reference protocol v1.
- Added topology-signature protocol v1 and the first bounded persistent-reference API for faces and edges. `EvaluatedSolid.topology()` exposes a validated, detached, deeply frozen evaluation-scoped snapshot through `CadResult`; `captureTopologyReference` detaches a deeply frozen reference containing no topology key, native index, or enumeration tiebreaker; and `resolveTopologyReference` returns a current evaluation key only for one compatible candidate. Kernels opt in through `KernelTopologyCapabilities.signatures`, whose exactly matched fingerprint declares descriptor-semantic compatibility rather than attesting runtime bytes. Complete stable role/source anchors report `semantic-lineage` evidence, while unavailable anchors or either snapshot's partial history use toleranced geometry plus one-hop adjacency and report `geometry-adjacency`. Missing, ambiguous, malformed, and fingerprint-mismatched cases fail closed, so symmetric topology receives no invented identity. The protocol still does not cover vertices, diff geometry, or cache shapes across runs.
- Added exported `TopologySignatureLimits` and frozen `DEFAULT_TOPOLOGY_SIGNATURE_LIMITS`, plus per-call partial overrides for capture and resolution. Defaults bound a snapshot to `100_000` topology items, `1_000_000` adjacency entries, and `1_000_000` lineage evidence records, bound stored registry inspection to `20_000` variants per persistent-selection operation, then bound matching to `1_000_000` candidate-pair checks and `10_000_000` evidence-comparison/search steps. The stored-variant counter is cumulative across distinct reference IDs, while matching work is shared across every compatible profile and repeated uses of a cached reference ID are charged once. Snapshot and reference arrays are copied with one captured length, metered before allocation or iteration, and validated before recursive freezing. Descriptor evidence and shared neighbors are compiled once per operation, reciprocal validation uses linear-time membership sets, and one-hop adjacency uses non-recursive bipartite matching. A crossed ceiling returns structured `TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED` details instead of continuing unbounded work. These TypeScript-side limits do not bound kernel snapshot creation, native modeling memory, or the separate exact-history record budgets.
- Added owned OCCT facade ABI 0.6 exact constant-thickness shell and whole-solid offset transactions with stable shell/offset and inward/outward codes. Shell openings are deduplicated and sorted by input face index before native execution, and the report echoes the canonical selection. Both operations validate a pure single solid, run exactly one fixed-round-join builder against a deep topology-independent BREP copy, enforce direction/volume postconditions, and leave the authored arena input BREP byte-stable.
- Added complete face/edge/vertex `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED` plus residual source-less `CREATED` evolution for successful ABI 0.6 shells and whole-solid offsets. The pinned offset engine can expose a replacement only as `GENERATED` while reporting it as not deleted; native reconciliation uses final-result membership and the absence of a `Modified` successor to add the exact terminal deletion without discarding generated causes. A selected shell opening is a maker input, not a forced history relation: OCCT may report that source face as `MODIFIED` into the planar opening rim rather than `DELETED`.
- Made exact shell/offset evolution an optional feature-scoped evaluator capability. ABI 0.6 advertises it; malformed capability metadata fails closed before selector or kernel execution, while stock OCCT and owned ABI 0.2–0.5 retain exact shell/offset geometry with explicit partial history. Added the independent `maxExactSolidOffsetHistoryRecords` native/JavaScript record budget with a `1_000_000` default; it shares neither the Boolean nor edge-treatment budget and does not bound the mandatory operand copy or OCCT builder workspace.
- Advanced the local package-neutral OCCT facade ABI and bundle to 0.6.0, adding `0006-exact-solid-offset-history.patch` after the ABI 0.5 edge-treatment patch in the reproducible six-patch source/relink series and extending native, public-adapter, and packed-consumer coverage for exact shell/offset evolution while retaining every earlier facade surface.
- Added owned OCCT facade ABI 0.5 exact constant-radius fillet and equal-distance chamfer transactions. The adapter deduplicates and input-index-sorts semantic edge seeds; native code echoes that canonical selection, expands each first seed to its maximal tangent contour, skips later seeds already covered by an admitted contour, and builds all admitted contours exactly once. Each operation runs only against a deep topology-independent working copy whose mutable TShape state is isolated from the arena operand, with one-to-one original/copy face-edge-vertex correspondence proved before history can succeed, so the authored input BREP remains byte-stable.
- Added complete face/edge/vertex `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED` plus residual source-less `CREATED` evolution for successful ABI 0.5 fillets and chamfers. Identity successors alone inherit earlier roles, sketch sources, and lineage; generated-only and source-less-created topology is created by the current edge-treatment feature without invented source identity. The report owns its result until a validated `READY` same-kernel one-shot transfer, and adapter failure before or after transfer releases ownership exactly once. Draft, PipeShell, Boolean, and edge-treatment adapters now also reject transferred result IDs that alias any retained operand instead of constructing a second owner.
- Made exact fillet/chamfer evolution an optional feature-scoped evaluator capability. ABI 0.5 advertises it; malformed capability metadata fails closed before selector or kernel execution, and malformed exact report data fails the transaction without exposing a result. Stock OCCT plus owned ABI 0.2–0.4 retain their exact geometry with explicit partial history. Added the separate `maxExactEdgeTreatmentHistoryRecords` native/JavaScript record budget with a `1_000_000` default; it is independent of `maxExactBooleanHistoryRecords` and does not bound the mandatory operand copy or OCCT builder workspace.
- Added owned OCCT facade ABI 0.4 exact multi-input union, subtraction, and intersection. Target source `0` and authored tool sources `1..N` remain ordered; union/intersection reduce sequentially while subtraction uses one cut against the complete tool set. Topology-independent working copies that share immutable geometry, plus non-destructive native builders, leave every arena input BREP byte-stable, with copy-to-source topology correspondence proved before history succeeds. The facade retains all available `PRESERVED`, `MODIFIED`, and `GENERATED` claims. `DELETED` is emitted only without a final identity successor; higher-order result topology that remains unclaimed after native-history harvesting receives mutually exclusive source-less `CREATED` coverage with the `-1/NONE/-1` source sentinel. Valid zero-topology results remain supported.
- Added the complete non-bijective topology-evolution validator and deterministic Boolean lineage reducer. Only preserved/modified identity predecessors inherit earlier roles, sources, and lineage; generated-only and source-less-created results are created by the current Boolean without source-role inheritance. The owned adapter copies, freezes, count-checks, and validates the report before a one-shot same-kernel transfer and rolls back a transferred result exactly once if adoption fails. `maxExactBooleanHistoryRecords` provides a caller-configurable record budget with a `1_000_000` default, passes it through to native enforcement before report materialization, and checks the returned count before indexed JavaScript copying.
- Made exact indexed Boolean evolution an optional evaluator capability: ABI 0.4 and later use the exact transaction, malformed advertised metadata fails closed, stock OCCT and owned ABI 0.2/0.3 continue through their partial-history Boolean implementations, and Manifold retains Boolean geometry without topology snapshots. Empty results retain the existing `EMPTY_RESULT` / `allowEmpty` behavior, and topology keys remain evaluation-scoped.
- Advanced the local package-neutral OCCT facade ABI and bundle to 0.5.0, adding `0005-exact-edge-treatment-history.patch` after `0004-exact-boolean-history.patch` in the reproducible source/relink series and extending native, public-adapter, and packed-consumer coverage for exact fillet/chamfer evolution while retaining ABI 0.4 Boolean and ABI 0.3 controlled PipeShell contracts.
- Added document-owned named configurations with dimension-checked parameter expressions, definition-scoped instance suppression and part-material substitution, deterministic runtime/configuration/default precedence, configuration-aware evaluation and BOMs, CLI selection, and packed-consumer coverage.
- Added document-owned material definitions with explicit parameterized density, typed part references, deterministic density precedence without name guessing, and backward-compatible descriptive part material labels.
- Added deterministic part-node-grouped bills of materials for parts and nested assemblies, with suppression-aware quantities, affine occurrence mass rollups, partial-mass warning diagnostics, CLI output, and packed-consumer coverage.
- Added explicit parameterized part density in `kg/mm^3`, density-aware physical mass and `kg*mm^2` inertia for parts and heterogeneous nested assemblies, deterministic principal moments/axes with degeneracy metadata, arbitrary point/axis inertia, radii of gyration, structured missing/invalid-density diagnostics, CLI analysis, and packed-consumer coverage.
- Added required world-space center-of-mass and centroidal inertia-tensor measurements across both built-in kernels and assemblies, with native recentered OCCT B-Rep integration, centered Manifold polyhedron integration, affine occurrence aggregation, parallel-axis semantics, zero-volume conventions, and CLI inspection output.
- Added a kernel-neutral ordered ruled-solid loft node and TypeScript builder API.
- Added strict profile compatibility, station ordering, exact OCCT result-topology validation, capability negotiation, and conformance coverage for the bounded loft contract.
- Added first-class parameterized open 3D polyline paths and a bounded exact solid-sweep contract with corrected-Frenet transport, right-corner transitions, conservative self-overlap rejection, transactional OCCT ownership, and package-level coverage.
- Added exact three-point 3D circular-arc paths and additive circular-arc sweep capability negotiation with analytic curvature clearance, specialized OCCT revolution transfer, and stable analytic volume measurement.
- Added structurally connected ordered line/arc composite paths, certified exact path clearance, additive composite-sweep capability negotiation, and one-wire transactional OCCT PipeShell transfer.
- Extended the kernel-neutral composite contract to certified major and near-full arcs with adjacent remote-domain clearance. The stock OCCT adapter admits the bounded centered-profile, single-arc composite case with native tangent and analytic-volume postconditions; multi-arc and eccentric-profile major transfers fail closed. The superseded `major-arc-unsupported` and `adjacent-arc-reach` reason literals remain type-compatible but are no longer emitted.
- Added owned OCCT facade ABI 0.3 with an explicit corrected-Frenet/right-corner PipeShell transaction, caller-supplied linear/boundary/angular tolerances, measured surface-error enforcement, one-shot same-kernel result transfer, and complete cleanup diagnostics. The matched runtime now certifies major multi-arc and eccentric-profile composites, including the previously distorted angularly conditioned near-full fixture, while stock OCCT retains its bounded restrictions.
- Added a kernel-neutral transported-profile volume oracle with exact line, circular-arc, and RightCorner centroid terms, compensated summation, cancellation diagnostics, and versioned `major-multiple-arcs` / `major-eccentric-profile` kernel capability refinements.
- Added exact kernel-neutral line/arc/circle profile area and centroid moments with certified floating-point bounds, plus one shared composite-sweep refinement classifier. Document evaluation now preflights only the refinements required by the selected geometry, reports missing or malformed capability metadata before backend invocation, and keeps direct OCCT calls synchronized to the requested tolerance.
- Made those analytic local moments authoritative for circular and composite sweep volumes. OCCT face area and centroid integration now act as an independent, geometry-conditioned certificate with structured disagreement diagnostics; circular transfer additionally checks the native face moments against the rounded revolution axis before construction. Relative centroid/circle-center offsets and per-axis ULP bounds preserve exact-volume semantics at large representable world translations. `ResolvedCircularArcGeometry` now includes the required `centerOffsetFromStart` field for consumers that snapshot or mock resolved geometry.
- Fixed nonuniform OCCT transforms of already-meshed exact shapes by stripping stale triangulation before applying the affine map.

- Preserve analytic sketch lines, arcs, circles, and their source entity IDs in resolved profiles
- Add an exact OpenCascade B-Rep backend with STEP and text/binary BREP exchange
- Add evaluated-output and CLI STEP/BREP export without exposing native handles
- Add serialized, order-independent semantic face/edge selectors with explicit cardinality
- Add validated OCCT topology snapshots with analytic descriptors, adjacency, provenance, and explicit lifetime management
- Add exact selector-driven fillets and structured missing, ambiguous, and incomplete-history diagnostics
- Add exact equal-distance selector-driven chamfers with tangent-contour seed semantics, negotiated kernel capability, and partial-history diagnostics
- Add exact constant-thickness inward/outward shells with fixed round joins, non-propagating semantic face openings, materialized direction and tolerance, strict solid/opening checks, negotiated kernel capability, and partial-history diagnostics
- Add exact whole-solid inward/outward offsets with fixed round joins, materialized direction and tolerance, strict one-body validation, collapse checks, negotiated kernel capability, and partial-history diagnostics
- Deterministically release every native evolution wrapper and temporary vector used by exact fillet/chamfer history calls while preserving chained-operation behavior
- Pin the OCCT facade source, kernel source, toolchain, and rootless offline build path for reproducible InvariantCAD-owned native extensions
- Add an owned-OCCT atomic multi-face draft ABI and native smoke corpus with arbitrary neutral planes, pre-build seed validation, the pinned kernel's minimum-angle guard, and explicit result ownership
- Add a versioned, report-owned indexed topology-evolution ABI for atomic draft, with exact face/edge/vertex bijection checks, stable numeric enums, explicit history-stage diagnostics, and immutable history across report clones and result transfer
- Add an internal fail-closed TypeScript reducer for exact indexed topology evolution, including complete-bijection validation, preserved/modified lineage reduction, partial-history propagation, safe integer bounds, sparse-array rejection, and detached immutable lineage
- Add the explicit document, builder, kernel, capability-negotiation, and evaluator contract for signed atomic draft with semantic face selection, independent pull direction and neutral plane, strict numeric bounds, and feature-scoped exact indexed evolution; kernels without that exact capability fail before selection or execution
- Add an internal OCCT draft transaction boundary that probes the exact matched facade, copies and validates all report/history data before transfer, preserves native failure diagnostics, and guarantees report/vector cleanup plus exactly-once rollback when post-transfer adoption fails
- Wire signed semantic-face draft through the public OCCT kernel when `createOcctKernel` receives a module factory that loads the matched owned facade, with an optional explicit WASM override, numeric face remapping, raw topology-count cross-checks, transactional adoption, and exact indexed lineage caching; stock/default OCCT remains draft-unsupported and global topology provenance remains `feature`
- Add deterministic local packaging and strict offline verification for a package-neutral owned-OCCT facade bundle containing the matched runtime, checksums, release metadata, CycloneDX SBOM, provenance, locked build inputs, patches, source/relinking instructions, notices, and licenses; the bundle remains unpublished and outside the `invariantcad` npm package pending external review
- Add an opt-in clean-consumer package acceptance gate that installs the npm tarball without native artifacts, explicitly supplies the verified owned-facade bundle runtime, and exercises direct plus document-evaluated draft
- Make exact boolean unions produce shellable fused solids and normalize reversed one-solid imports before topology-sensitive features
- Reject shapes passed across OCCT kernel instances before their raw arena IDs can alias unrelated geometry
- Add a closed, typed primitive/extrusion/revolution-face topology-role registry and sketch-curve source selectors
- Preserve proven per-subshape role/source lineage through transforms and downgrade ambiguous history
- Version and normalize the geometry-kernel protocol, native exchange, validity, and meshing options
- Enforce declared kernel capabilities before backend invocation
- Add reusable geometry-kernel conformance tests
- Verify coverage, package metadata, declarations, tarball imports, real geometry, and the installed CLI

### Initial executable foundation

- Initial versioned design IR and TypeScript authoring API
- Dimensioned parameters and expressions
- Sketch entities, constraints, profiles, and reference solver
- Manifold WASM geometry backend
- Primitives, extrude, revolve, booleans, and transforms
- Parts and nested fixed-placement assemblies
- Measurement, STL/OBJ export, canonical JSON, semantic hashes, CLI, and tests

[Unreleased]: https://github.com/shlokjain42/invariantCAD/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/shlokjain42/invariantCAD/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/shlokjain42/invariantCAD/releases/tag/v0.1.0
