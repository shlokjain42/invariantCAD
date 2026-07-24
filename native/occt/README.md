# InvariantCAD OCCT facade

This directory owns the reproducible boundary between InvariantCAD and the
native OCCT WebAssembly facade. The exact upstream source, OCCT gitlink,
compiler toolchains, and builder image are immutable inputs recorded in
[`upstream.lock.json`](./upstream.lock.json). Builds never use an unpinned
`latest` image.

## Build

The normal build needs Git, Python 3, GNU `patch`, `tar`, `sha256sum`, and a
rootless Podman installation:

```sh
./scripts/build-occt-facade.sh
```

The script performs four bounded phases:

1. Fetch and verify the exact `occt-wasm` tag and commit (or verify an existing
   checkout passed with `--source-dir`). It also verifies that the source's
   OCCT gitlink is the locked OCCT commit.
2. Export the verified commit into a temporary staging directory and apply
   every `native/occt/patches/*.patch` file in bytewise filename order.
3. Hydrate a fresh Cargo cache in a narrowly networked container, then compile
   in a separate container with `--network=none`, all capabilities dropped,
   and `no-new-privileges`. Both containers use the builder image by digest.
4. Copy only `occt-wasm.js` and `occt-wasm.wasm` into
   `.artifacts/occt-facade/`, alongside `SHA256SUMS` for those two files.

Neither the repository root nor the user's home directory is mounted into a
container. The container sees only an exported temporary source tree and a
dedicated Cargo cache. The prebuilt OCCT libraries come from the immutable
builder image; the actual compilation and link phase has no network route.

For repeated builds, use a dedicated, credential-free Cargo cache:

```sh
mkdir -p .cache/occt-facade-cargo
./scripts/build-occt-facade.sh \
  --source-dir /path/to/occt-wasm-v3.8.0 \
  --cargo-cache-dir .cache/occt-facade-cargo

./scripts/build-occt-facade.sh \
  --source-dir /path/to/occt-wasm-v3.8.0 \
  --cargo-cache-dir .cache/occt-facade-cargo \
  --skip-fetch
```

`--skip-fetch` makes the complete invocation offline. It therefore requires an
already-present pinned Podman image, an exact existing source checkout, and a
previously hydrated Cargo cache. The script rejects Cargo credential files in
the mounted cache.

Patches belong in `native/occt/patches/` and should use Git's `a/` and `b/`
path prefixes. Prefix filenames with an ordering number because lexical order is
part of the build. Facade ABI 0.9 is the exact nine-patch series
`0001-atomic-multi-face-draft.patch`, `0002-indexed-draft-history.patch`,
`0003-controlled-pipe-shell.patch`, `0004-exact-boolean-history.patch`,
`0005-exact-edge-treatment-history.patch`,
`0006-exact-solid-offset-history.patch`,
`0007-bounded-shape-artifacts.patch`, and
`0008-hardened-shape-artifact-budgets.patch`, followed by
`0009-bintools-v4-structural-preflight.patch`.

## Native smoke test

Build the patched facade, then load the matched generated JavaScript and WASM
pair directly through the native fixture corpus:

```sh
pnpm build:occt-facade
pnpm test:occt-facade
pnpm test:occt-draft-public
pnpm test:occt-persistence-public
```

The native fixture exercises the raw ABI, including all three exact Boolean
operations, fillet/chamfer, and inward/outward shell/whole-solid offset;
complete face/edge/vertex history; generated, deleted, and residual
source-less-created topology; stale intermediate-removal and
generated-only-replacement cases; canonical tangent-contour seeds and shell
openings; isolated working copies with byte-stable arena operands; separate
record budgets; empty Boolean results; report cloning; foreign-kernel
rejection; one-shot transfer; and capped binary-BREP output plus bounded-input
report-owned artifact decode with private cumulative native allocation-request
telemetry and limits. ABI 0.9 artifact tests additionally exercise the exact
owned BinTools-v4 structural preflight, its work/depth/location-power ceilings,
canonical TShape hierarchy and reachability, conservative validation-work
envelopes, report telemetry, and proof that rejected archives never start OCCT
deserialization.
The public smoke loads the same generated pair through `createOcctKernel` and
exercises direct and evaluated draft, exact Boolean, fillet/chamfer, and
shell/offset lineage, protocol-v2 vertex persistence with the descriptor-`@6`
primary profile, exact protocol-v1 descriptor-`@5` compatibility, plus
controlled major multi-arc, eccentric-profile, and conditioned near-full
PipeShell transfers. These heavyweight tests are
intentionally separate from normal `pnpm verify`. Generated artifacts stay
under the ignored
`.artifacts/occt-facade/` directory and are not committed or included in the
`invariantcad` npm package.

## Local distribution bundle

After building the raw pair, package and verify a package-neutral local bundle:

```sh
pnpm bundle:occt-facade
pnpm verify:occt-facade-bundle
pnpm test:occt-facade-bundle
```

Bundle generation requires GNU `tar` and GNU `gzip`; the packager checks both
tools and supplies a minimal deterministic environment before invoking them.

The packager reads `.artifacts/occt-facade/` and writes both of these ignored
outputs:

```text
.artifacts/occt-facade-bundle/invariantcad-occt-facade-0.9.0/
.artifacts/occt-facade-bundle/invariantcad-occt-facade-0.9.0.tar.gz
```

`0.9.0` is the owned facade ABI and bundle version; it is independent of the
InvariantCAD npm package version, document schema version, and product-roadmap
milestone numbered 0.6.

The directory and archive have the same single-root layout. The matched pair is
under `runtime/`; the root `SHA256SUMS` covers the bundled files; and
release, CycloneDX SBOM, and build-provenance records are under `metadata/`.
The bundle also carries the locked inputs, ordered patches, applicable license
and notice material, and source/relinking instructions needed for review.

Packaging performs no network access and never substitutes a stock runtime. It
only packages an already-built pair, and `native/occt/bundle/release-input.json`
pins the expected byte size and SHA-256 of that pair plus every repository input
copied into the bundle. It also pins the final compressed archive's format,
size, and SHA-256, so compressor or packaging drift fails before output
publication. The verifier then checks the directory or archive without
executing native code.
`pnpm test:occt-facade-bundle` packages the pair, verifies both representations,
packs the `invariantcad` npm tarball, installs it in a fresh temporary consumer,
and explicitly points compact draft, exact Boolean, exact fillet/chamfer, exact
shell/offset, and owned composite-refinement checks at the bundled `runtime/`
directory. The normal `pnpm test:package` remains independent of owned-facade
build artifacts. To check byte-for-byte packager determinism as
well, run:

```sh
pnpm bundle:occt-facade --check-reproducible
```

“Package-neutral” means that the archive is not an npm package and does not
install or register itself. InvariantCAD never downloads, extracts, or selects
it implicitly; an application must explicitly acquire the bundle inputs.

For the reviewed ABI 0.9 bundle, prefer
`loadAttestedOcctRuntime(...)` from
`invariantcad/kernels/occt/node` or
`invariantcad/kernels/occt/browser`. Supply canonical
`metadata/release.json`, both files under `runtime/`, and the independently
maintained
`INVARIANTCAD_OCCT_FACADE_0_9_0_RELEASE_MANIFEST_SHA256` pin, then pass the
opaque result to `createOcctKernel({ attestedRuntime })`. The loader copies all
three caller-owned inputs, verifies the manifest before importing JavaScript,
and verifies the exact JavaScript/WASM sizes and digests against that trusted
manifest. A digest obtained beside an untrusted bundle is not an independent
trust anchor.

The Node loader transfers verified JavaScript through one process-global module
hook without writing a temporary executable file; Node's Permission Model must
allow the hook worker. The browser loader uses a short-lived Blob module URL and
requires `blob:` in the applicable CSP. Executable pair authority remains
private to the evaluated InvariantCAD internal module instance that created it;
cloning the visible report does not reproduce that authority. Direct
`moduleFactory` plus `wasm` remains available for an intentionally trusted
custom/rebuilt pair, but that raw path has no attested runtime-pair identity. See
[`docs/evaluation/occt-runtime-attestation.mdx`](../../docs/evaluation/occt-runtime-attestation.mdx).

The generated bundle is a review artifact, not a legal certification. It has
not been published to npm or another release channel. Public distribution and
any durable corresponding-source/relinking offer remain pending external legal,
release, and security review.

## Owned facade ABIs and public adapters

The first owned extension is an atomic multi-face draft operation. It
stages every unique selected face in one `BRepOffsetAPI_DraftAngle`, checks each
addition, and calls `Build()` exactly once only after every addition succeeds.
It accepts an arbitrary neutral-plane origin and normal independently of the
pull direction, and it requires both input and result to be valid,
positive-volume top-level single solids with unchanged
solid/shell/face/wire/edge/vertex counts. This count check does not claim full
incidence-graph isomorphism.

Its raw `uint32_t` arena IDs are adapter-trusted references, not authenticated
public handles. Only the owning adapter may supply them; they must never enter
documents or public APIs. A successful report owns its untaken result. Call
`report.delete()` in a `finally` block; `takeResultId(kernel)` transfers the
result into its originating kernel exactly once, after which normal kernel
`release()` or `releaseAll()` ownership applies.

The facade rejects `abs(angleRad) <= 1e-4`, because the pinned OCCT build can
otherwise report a successful no-op. The public protocol also requires
`abs(angleRad) < pi/2`. Facade ABI 0.2 makes a successful
draft conditional on a complete indexed face/edge/vertex evolution proof. It
requires one same-kind result successor for every input subshape, rejects
duplicate claims and unclaimed result subshapes, and exposes no result if that
proof fails.

The version-1 evolution envelope is report-owned and immutable. It records
`sourceShapeIndex`, `sourceKind`, `sourceIndex`, `relation`, `resultKind`, and
`resultIndex`, so N source shapes can evolve into one aggregate result without
changing the record shape. Draft has one source operand and emits only
one-to-one `PRESERVED` or `MODIFIED` records. ABI 0.4 Boolean reports, ABI 0.5
fillet/chamfer reports, and ABI 0.6 shell/offset reports use the complete
non-bijective relation set below:

- `PRESERVED` and `MODIFIED` require a real source and result, and both endpoints
  have the same face, edge, or vertex kind.
- `GENERATED` requires a real source and result but may change topology kind. It
  proves causal coverage; it does not by itself transfer the source's public
  identity or naming.
- `DELETED` requires a real source and the result sentinel
  `resultKind = NONE`, `resultIndex = -1`. It is valid only when the source has
  no final same-kind identity successor; a stale removal flag from an
  intermediate Boolean step cannot override final-result membership.
- Source-less `CREATED` uses
  `sourceShapeIndex = -1`, `sourceKind = NONE`, and `sourceIndex = -1`, followed
  by a real result. The facade first retains every available native
  `PRESERVED`, `MODIFIED`, and `GENERATED` relation, then emits `CREATED` only
  for residual result topology that native history did not attribute to a
  source. A result with `CREATED` cannot also have an operand claim.

The history remains readable through cloned reports and after result transfer;
failed reports advertise version zero and no complete history. Unknown relation
values, malformed sentinels, contradictory source/result links, or incomplete
coverage fail the protocol rather than becoming partial history.

All indices are zero-based positions in evaluation-scoped
`TopExp::MapShapes` maps of unique located faces, edges, or vertices. These are
not persistent document IDs, oriented occurrence indices, an assembly instance
graph, or a proof of full incidence-graph equivalence. Map membership uses
OCCT's unoriented `IsSame` identity; preservation compares the canonical input
and result occurrences with `IsEqual`, so an orientation-only change is
classified as modified.

The public document, builder, evaluator, and `GeometryKernel` contracts expose
signed atomic draft through semantic face selectors. Pull direction and the
neutral-plane origin and normal remain independent explicit inputs. The OCCT
adapter maps evaluation-scoped face keys to numeric facade indices, validates
the complete indexed envelope, cross-checks raw input and result topology
counts, and adopts the transferred result transactionally.

Draft is enabled only when the supplied InvariantCAD-owned `moduleFactory`
loads a module whose exact facade probe succeeds. That factory may locate its
matched sibling WASM itself; callers can provide `wasm` as an explicit binary
override when their runtime or bundler requires it. ABI 0.2 and later advertise
ordinary `draft` support and feature-scoped `exactIndexedTopologyEvolution` v1
for draft. ABI 0.4 adds `boolean`; ABI 0.5 adds `fillet` and `chamfer`; ABI 0.6
advertises the protocol for `draft`, `boolean`, `fillet`, `chamfer`, `shell`,
and `offset`; ABI 0.7 preserves that feature proof and adds bounded artifact
transport, while ABI 0.8 adds a private cumulative native allocation-request
budget around that transport. ABI 0.9 adds exact structural preflight for the
owned BinTools-v4 profile before OCCT deserialization. None advertises a
production artifact codec.
The TypeScript descriptor declaration is conditional on that probed surface.
Known stock OCCT and every recognized owned facade now advertise
topology-signature protocol v2 with primary descriptor `@6`, including exact
B-Rep vertex points and reciprocal edge↔vertex incidence. The adapter also
publishes one exact protocol-v1 compatibility profile: stock and owned ABI
0.2–0.4 retain precisely their former descriptor `@4` fingerprint, while ABI
0.5 and later retain precisely their former descriptor `@5` fingerprint with
its exact generated edge-to-face treatment roles. Protocol-v1 face/edge wire
bytes, evidence construction, and matching behavior remain frozen and ignore
the added vertex evidence.

These descriptor/profile changes do not change the modeling/history boundary.
The owned facade ABI is 0.9, and `exactIndexedTopologyEvolution` remains
version 1.
Document v6 and topology-signature protocol v2 are separate TypeScript/document
axes; no semantic vertex roles are introduced. Distinct coincident B-Rep
vertices remain separate snapshot items and resolve ambiguously when their
key-free point and edge evidence cannot distinguish them.
The global topology provenance remains `feature`; a feature-scoped proof does
not promote unrelated operations. Default `createOcctKernel()` loads stock OCCT
and remains usable for its other exact features, but it does not advertise or
execute draft. Partial, unknown, or mismatched facade markers fail closed.

Facade ABI 0.3 is additive: it retains the complete draft surface and adds a
controlled transactional PipeShell operation. The operation accepts one
profile wire, one spine wire, and explicit 3D, boundary, and angular
tolerances. Native code fixes corrected-Frenet transport and right-corner
transitions, validates both wire IDs, calls `Build()` and `MakeSolid()` at most
once, and reports OCCT's measured surface approximation error. The successful
solid remains outside the arena until a checked same-kernel one-shot transfer;
deleting an untaken report releases it.

The TypeScript adapter requires exact tolerance echoes, successful build and
solidification counts, a `READY` transfer preflight, and a surface error no
greater than the selected linear tolerance. It retains all public profile/path,
authored-edge, topology, body-purity, and volume postconditions. The independent
volume oracle transports profile area and centroid through lines, circular
arcs, and supported right-corner miters with compensated summation and
cancellation diagnostics. Only after the native and analytic corpus passed
does the 0.3 kernel advertise the version-1 `major-multiple-arcs` and
`major-eccentric-profile` composite refinements. Stock OCCT and legacy ABI 0.2
remain supported but advertise neither stronger guarantee.

Facade ABI 0.4 is additive: it retains ABI 0.2 draft and ABI 0.3 PipeShell and
adds `invariantcadBooleanAtomic(kernel, operation, targetId, toolIds,
maxHistoryRecords)`. Operation codes are stable as union `0`,
subtract `1`, and intersect `2`. Source shape `0` is the target; source shapes
`1..N` are the tools in authored order. Union and intersection apply ordered
sequential Fuse/Common operations. Subtraction makes one Cut with the target as
its argument and the complete authored tool sequence as its tool list. This
preserves the public geometry contract instead of treating every Boolean as an
unordered n-ary operation. Before any builder runs, the facade makes a
topology-independent copy of every operand, shares its immutable geometry, and
proves a one-to-one original-to-copy mapping for every indexed face, edge, and vertex.
Each OCCT builder consumes only those copies with non-destructive mode enabled,
so the arena-owned target and every tool retain byte-identical BREP
serializations, including TShape status flags, across the operation.

A successful Boolean report owns the aggregate result and a complete version-1
face/edge/vertex graph. For each input face, edge, and vertex, the graph must
contain one or more same-kind identity successors or one `DELETED` record,
exclusively. Generated links may coexist but do not satisfy that
identity-successor-or-deletion requirement. The native extractor retains all
available preserved, modified, and generated links before filling gaps. Every
result face, edge, and vertex must then have one or more operand claims or one
source-less `CREATED` record, mutually exclusively. Duplicates are canonicalized
in target/tool and subshape-index order; conflicting relations, unsupported
kinds, and incomplete source or result coverage fail the history stage. An
empty result is valid: its result counts are all zero and every input subshape
is deleted.

The TypeScript adapter treats the report as one fail-closed transaction.
`createOcctKernel` accepts `maxExactBooleanHistoryRecords`, a non-negative
signed 32-bit record budget that defaults to `1_000_000`. The adapter passes
that budget into the native operation, which fails before materializing a
record beyond it, then checks the returned record count before making any
indexed JavaScript record call. It copies and freezes all diagnostics, counts,
and records; validates operation, tool count, build count, sentinels, complete
graph coverage, and raw input counts; and requires a `READY` transfer before
taking the result. After transfer it checks raw result counts and reduces the
graph. A thrown validation or reduction never exposes a shape, and a
post-transfer adoption failure releases the transferred root exactly once.
Untaken reports release their owned result, and transfer is restricted to the
originating kernel and can succeed only once.

The record budget does not bound the topology-independent operand copies or
OCCT's internal Boolean workspace. Those allocations scale with operand
topology and are the cost of keeping every arena-owned BREP byte-stable.

Public Boolean lineage follows identity only. `PRESERVED` and `MODIFIED`
successors inherit proven earlier lineage, including roles and sketch sources;
`GENERATED` is causal coverage and never grants the new subshape a source role;
source-less `CREATED` covers higher-order topology without inventing an operand
cause. A generated-only or source-less-created public face or edge is recorded
as created by the current Boolean feature. An identity successor is marked
modified by that feature only when at least one identity predecessor is
modified. Native indices and public topology keys remain evaluation-scoped and
are never document IDs.

Exact indexed Boolean evolution is optional at the evaluator boundary. ABI 0.4
and later use it; stock OCCT, owned ABI 0.2/0.3, and Manifold continue to execute
their base Boolean operations with partial history. Malformed advertised capability
metadata or a malformed exact report is authoritative and fails closed. Empty
Boolean geometry follows the evaluator's ordinary `EMPTY_RESULT` / `allowEmpty`
contract.

Facade ABI 0.5 is additive: it retains the complete ABI 0.4 surface and adds
`invariantcadEdgeTreatmentAtomic(kernel, operation, inputId, seedEdgeIds,
amount, maxHistoryRecords)`. Operation codes are stable as fillet `0` and
chamfer `1`. TypeScript deduplicates requested edge keys, maps them to the input
topology snapshot, and sorts the resulting indices before calling native code.
The report must echo that exact canonical seed list. Native processing admits
the first seed on each not-yet-covered maximal tangent contour, records later
seeds already covered by an admitted contour as skipped, and calls the selected
fillet or chamfer builder exactly once after every contour has been staged.
Selector cardinality is therefore seed cardinality, while duplicate and
overlapping contour seeds are geometrically idempotent.

Before any edge-treatment builder sees the operand, native code makes a deep
independent B-Rep copy, including its curve and surface geometry. The facade
proves a one-to-one original/copy mapping for every indexed face, edge, and
vertex, maps canonical seeds onto the copy, and never gives the arena-owned
operand to the builder. Successful or failed treatment therefore leaves the
authored input BREP byte-stable.

The operand may be a direct solid or a recursively nested one-child
compound/compsolid wrapper around exactly one solid. Loose or multiple topology
is rejected, while successful maker output is normalized to the contained
solid. This keeps ABI 0.4 Boolean output directly composable with ABI 0.5 edge
treatments.

A successful edge-treatment report owns its result and a complete version-1
face/edge/vertex graph from source shape `0` to that result. It retains every
available preserved, modified, and generated relation, emits `DELETED` only
when a source has no final same-kind identity successor, and emits source-less
`CREATED` only for otherwise-unclaimed result topology such as new boundary
edges, vertices, or corner interactions that OCCT does not attribute to one
source subshape. The same exclusivity, canonicalization, sentinel, and complete
source/result coverage rules used by the ABI 0.4 Boolean graph apply.

The TypeScript edge-treatment adapter treats the report as a fail-closed
transaction. It validates the operation and amount echoes, requested and
selected seeds, add/skip/contour/build counters, topology counts, full graph,
and `READY` same-kernel transfer state before taking the result. After transfer,
it validates result counts and reduces public lineage. Only preserved/modified
identity successors inherit prior lineage, roles, and sketch sources. The
adapter assigns `fillet.face.blend` or `chamfer.face.bevel` only to an
identity-less result face with an exact incoming `GENERATED` record from a
source edge. It does not inspect surface type, enumeration order, or the seed
list. The role is a source-free class label, so several faces can share it and
remain deliberately ambiguous as individual persistent references. Generated
edges, vertex-generated faces, and residual source-less `CREATED` faces or
edges remain unnamed. Untaken reports release their result, and an adoption,
cancellation, validation, or reduction failure releases a transferred root
exactly once.

`createOcctKernel` accepts a separate
`maxExactEdgeTreatmentHistoryRecords` non-negative signed 32-bit budget, which
defaults to `1_000_000`. Native code enforces it before materializing report
records, and TypeScript checks the count before making any indexed JavaScript
record call. It is independent of `maxExactBooleanHistoryRecords` and does not
bound the mandatory copied operand or OCCT fillet/chamfer workspace.

Exact indexed fillet/chamfer evolution is optional at the evaluator boundary.
ABI 0.5 advertises it and the evaluator validates the declaration before edge
selector resolution. Missing metadata or a well-formed declaration omitting
the requested feature preserves the legacy partial-history route. Stock OCCT
and owned ABI 0.2–0.4 therefore keep exact fillet/chamfer geometry with partial
history. Malformed advertised metadata or an exact ABI 0.5 report is
authoritative and fails closed.

Facade ABI 0.6 is additive: it retains the complete ABI 0.5 surface and adds
`invariantcadSolidOffsetAtomic(kernel, operation, inputId, openingFaceIds,
amount, direction, tolerance, maxHistoryRecords)`. Operation codes are stable
as shell `0` and whole-solid offset `1`; direction codes are inward `0` and
outward `1`. TypeScript deduplicates shell opening faces and sorts their input
snapshot indices before native execution. The report echoes that canonical
selection. Whole-solid offset requires an empty opening list, while shell
requires at least one selected opening and one retained input face.

Both modes accept one valid positive-volume top-level solid with no loose or
multiple topology. Native code creates a deep independent BREP copy, including
its curve and surface geometry, proves original/copy face-edge-vertex
correspondence, maps canonical openings onto that copy, and passes only the
copy to one fixed-round-join builder. The result must be one valid
positive-volume solid with no loose topology and must satisfy the public
direction/volume postconditions. The arena input BREP remains byte-stable on
success or failure.

A successful solid-offset report owns its result and a complete version-1
single-input graph under the same identity/deletion, generated, residual-created,
canonicalization, sentinel, and source/result coverage rules as ABI 0.4/0.5.
The pinned offset engine can expose a replacement only through `Generated`
while `IsDeleted` remains false even though the source identity is absent from
the final shape. ABI 0.6 reconciles that case from exact final membership: if
the identity is absent and there is no native `Modified` successor, it marks
the source deleted without discarding its generated links. A shell opening is
only a maker input; the selected source face may instead have a real
`MODIFIED` successor representing the planar opening rim, so selection never
forces a deletion record.

The TypeScript adapter validates operation, direction, amount, tolerance,
requested and canonical opening counts, build/status fields, topology counts,
complete graph, and `READY` same-kernel transfer state before taking the
result. After transfer it validates result counts and reduces identity-only
public lineage. Untaken reports release their result; adoption, cancellation,
validation, or reduction failures release a transferred root exactly once.

`createOcctKernel` accepts an independent
`maxExactSolidOffsetHistoryRecords` non-negative signed 32-bit budget with a
`1_000_000` default. Native code enforces it before materializing report
records, and TypeScript checks the count before any indexed JavaScript record
call. It shares neither the Boolean nor edge-treatment budget and does not
bound the mandatory copied operand or OCCT shell/offset workspace.

Exact indexed shell/offset evolution is optional at the evaluator boundary.
ABI 0.6 advertises it; missing metadata or a well-formed declaration omitting
the requested feature preserves the supported partial-history route. Stock
OCCT and owned ABI 0.2–0.5 therefore keep exact shell/offset geometry with
partial history. Malformed advertised metadata or an exact ABI 0.6 report is
authoritative and fails closed before result exposure.

Facade ABI 0.7 is additive: it retains the complete ABI 0.6 modeling surface
and adds a candidate-only bounded binary-BREP transport. The native writer uses
an explicitly pinned BinTools v4 archive with triangulation and normals
disabled, writes into fixed-size chunks, and stops without exposing partial
bytes before the caller's signed 32-bit byte ceiling is exceeded. A successful
write report owns those chunks and creates a detached JavaScript `Uint8Array`
only after serialization has completed inside the cap.

The native reader accepts a borrowed `Uint8Array`, checks its byte length before
copying, snapshots exactly that view, requires the pinned v4 header and exact
input consumption, and rejects a decoded topology graph beyond the caller's
item ceiling before running full B-Rep validity analysis. A successful shape
remains outside the kernel arena until a same-kernel one-shot transfer; deleting
an untaken report releases it.

Facade ABI 0.8 retains that transport and adds a trailing signed-int
`maxNativeRequestedBytes` argument to both the writer and reader. During each
call, private linker-wrapped allocator entry points count admitted cumulative
native requested bytes and allocation calls. Both reports echo the limit and
expose `nativeRequestedBytes`, `nativeAllocationCalls`, and
`nativeRequestLimitExceeded`. A denial reached through the reviewed throwing
C++ allocation entry points returns `NATIVE_REQUEST_LIMIT_EXCEEDED`; admitted
requested bytes never exceed the limit, while the call count includes the
denied request. Direct C allocator denials deliberately abort the affected WASM
runtime instead of returning null to unchecked OCCT callers. Callers must run
candidate work in a disposable worker/process and discard that runtime after a
trap. These counters measure cumulative requests, not current live bytes, peak
resident memory, or all physical WebAssembly memory growth.

The TypeScript candidate passes a fixed private 128 MiB cumulative-request
limit to ABI 0.8, validates every report echo, and releases a transferred root
if later sidecar adoption fails. Owned ABI 0.7 retains the byte and topology
caps without this private request quota; stock OCCT and owned ABI 0.2 through
0.6 retain the earlier unbounded research path.

Facade ABI 0.9 retains that 128 MiB cumulative native request budget and adds
three reader-only signed-int ceilings: `1,000,000` structural work units, `64`
structural nesting levels, and location-power magnitude `1,000,000`. After the
single admitted input snapshot is created, an exact parser for the owned
writer's BinTools-v4 profile must consume the complete archive before
`BinTools::Read` can start. It validates canonical section names, decimal
counts, table order, tags, booleans, finite binary numbers, analytic and spline
geometry, knot/multiplicity/pole relationships, count products, permitted
representations, in-range references, and exact end-of-input. It also validates
canonical elementary/composite locations with backward references and bounded
nonzero powers, and the backward-only TShape graph with its canonical child
types, root, nesting, and complete record reachability.

The work counter charges table entries, nested geometry, products,
representations, location terms, subshape occurrences, and the conservative
validation envelope OCCT will later traverse. Wire edge-pair and face
wire/edge-pair, representation, expanded-topology, and aggregate geometry
checks use explicit squared envelopes, so compact but complex records cannot
hide disproportionate downstream work. With the `1,000,000` aggregate work cap,
global geometry-work squaring deliberately admits roughly fewer than `1,000`
geometry work units, and the other charges can only lower that ceiling. This is
a private artifact-compatibility limit, not a core CAD authoring or modeling
limit. Preflight keeps one bounded TShape metrics table; that metadata
allocation is visible to and limited by the same 128 MiB cumulative native
request budget before OCCT shape deserialization.

ABI 0.9 read reports echo all three preflight limits and expose
`preflightWorkUnits`, `preflightMaximumDepth`,
`preflightMaximumLocationPower`, `preflightConsumedByteCount`,
`preflightCode`, `archivePreflightComplete`, and
`deserializationStarted`, alongside ABI 0.8's native request/allocation
telemetry. A structural rejection reports the `preflight` stage, leaves
`deserializationStarted` false, and exposes no result. ABI 0.8 remains
loadable through its older reader signature, but it has no structural
preflight telemetry.

Candidate format v3 retains the bounded binary semantic sidecar introduced by
v2 and adds a separate native-identity-v1 section. The sidecar's fixed 48-byte
big-endian header declares exact sidecar length and aggregate face, edge,
vertex, adjacency, lineage, UTF-16BE string-byte, and native-orientation totals.
The TypeScript encoder detaches and canonicalizes once, counts the complete
representation before allocating, and writes exact-size sections. The decoder
preflights headers, totals, and minimum representations before topology-table
allocation, accepts only closed tags/masks and finite canonical binary64 values,
charges nested collections against declared totals, and requires exact EOF.
UTF-16BE code units retain arbitrary JavaScript strings without replacement.
This bounded sidecar is used with the ABI 0.7/0.8/0.9 native paths and the
stock/legacy research path; it does not make their native materialization
behavior equivalent. The envelope, sidecar v2, and identity v1 have exact
section boundaries and EOF, but stock `occt-wasm` can accept suffix bytes after
a valid BREP archive. Strict BREP-section consumption is an owned-ABI-0.7+
transport guarantee; stock canonical re-encoding may discard the suffix.

Native identity v1 records the zero-based direct-child path to the first
`IsSame` occurrence of each unique located solid, shell, wire, face, edge, and
vertex. Its complete rooted pre-order stream records every serialized
occurrence in fixed 12-byte records containing shape type, composed orientation,
direct-child count, and canonical `IsSame` class index for those six kinds.
Compound, compsolid, and generic-shape nodes are structurally recorded but
unindexed. The 64-byte identity header records exact length, aggregate
first-path components, six unique-class counts, occurrence count, and record
width.

The producer sorts first paths canonically per kind and applies the same
permutation to orientations, face/edge/vertex topology, and occurrence class
indices. The consumer remaps stored paths onto its raw enumeration, compares
the complete occurrence manifest by canonical class path, and then exact-checks
geometry and incidence. Multiplicity, order, orientation, `IsSame`-class
membership, shape type, child count, geometry, incidence, or root-structure
substitution fails closed.
Limits are `100,000` unique paths, `1,000,000` aggregate first-path components,
depth `64`, child index `999,999`, `100,000` stored occurrences/traversal
visits, and `1,000,000` candidate `IsSame` comparisons. The private fingerprint
binds `nativeIdentity=serialized-first-issame-child-path-v1`,
`nativeOccurrenceManifest=complete-rooted-preorder-type-orientation-child-count-issame-class-v1`,
`nativeOccurrenceRecordBytes=12`, `nativeIdentityMaxOccurrences=100000`,
`nativeIdentityTraversalOccurrences=100000`, every other ceiling, and the
native-structure declaration.

The reviewed deterministic stock-runtime v3 asymmetric-box fixture is `13,735`
bytes with fixture witness
`invariantcad:kernel-shape-artifact-fixture:v1:sha256:8ecfa6ac89142f794c2d55a78e7121ce0805b8abcb5aa64230e7722d99c8c2be`.
Its semantic witness remains
`invariantcad:kernel-shape-semantic:v1:sha256:40ae684e4a2fad512f54e1f1be4443acf7faf2f34fc6b281c7b816d8d3366cb2`.
The v1 and v2 fixtures are retained only to prove fail-closed rejection before
native restore. Verify the current fixture without writing with
`pnpm artifact:fixture:occt -- --check --version v3`.
A dedicated duplicate-occurrence regression substitutes two occurrences of the
same located TShape for a single-component artifact and requires transactional
rejection; adjacent adversarial cases reject changed later-occurrence
orientation or `IsSame`-class membership.

ABI 0.9 still does not advertise `KernelCapabilities.shapeArtifacts`. The
owned-profile parser closes the previously documented BinTools grammar/count/
product preflight gap for archives it admits, but the 128 MiB counter measures
cumulative requests rather than current live bytes, peak resident memory, or
all WebAssembly growth. The structural work envelope is conservative and
bounded; it is not a live/peak-memory proof. Synchronous same-thread WASM also
has an in-flight cancellation gap, so an ordinary timer-driven `AbortSignal`
does not provide prompt cancellation during native work. Ordered native
evidence is no longer the ordering authority for v3's canonical unique classes,
and the complete occurrence manifest preserves every serialized node's
multiplicity, order, type, composed orientation, child count, and class mapping.
Compound/compsolid/generic nodes remain structural occurrences, not indexed
public identities. Stock `occt-wasm` has no `IsPartner`, so v3 cannot attest
that distinct-location `IsSame` classes share one underlying TShape, and its
serialized paths do not persist across model edits or define assembly identity.
The stock fixture is not cross-process compatibility proof. The attested
loaders now verify the exact owned JavaScript/WASM pair under an independent
canonical release-manifest pin, and the private candidate fingerprint binds
that pair identity. The separate declared-build identity does not prove that
recipe ran, authenticate a publisher, or attest the wider
library/wrapper/host. Format v3, binary sidecar v2, ABI 0.9, and exact pair
verification materially narrow the candidate boundary, but production promotion
still requires a public boundary where hard cancellation is promised, reviewed
owned-runtime cross-process goldens, and the remaining evaluator/cache
integration and release gates. The codec remains reachable only through
repository-private test plumbing.

The generated pair and its local package-neutral bundle remain ignored build
artifacts and are not included in the `invariantcad` npm tarball. Until an
externally reviewed release is published, use the pinned local build above or
an equivalently trusted matching bundle supplied through an explicit channel;
the library never fetches native code implicitly.

## License, source, and replacement boundary

`occt-wasm` facade code is upstream open-source code, while Open CASCADE
Technology is licensed under GNU LGPL 2.1 with the Open CASCADE exception. The
exception covers material incorporated from OCCT header files; it should not
be treated as a blanket waiver of LGPL obligations. This document is an
engineering boundary, not legal advice.

The generated `.wasm` statically contains OCCT. It is not, by itself, a
dynamically replaceable OCCT library. Any distribution of that binary must be
accompanied by a reviewed compliance bundle that, at minimum:

- carries the applicable OCCT, facade, and third-party notices and license
  texts;
- makes the complete corresponding OCCT source at the locked commit, all local
  patches, and the exact build inputs available by a durable compliant method;
- preserves a practical way for recipients to modify OCCT and relink a
  compatible `occt-wasm.js`/`occt-wasm.wasm` pair, including any relinkable
  material required by LGPL 2.1; and
- does not add signing, integrity, or loader restrictions that prevent a user
  from substituting that rebuilt pair.

The digest-pinned builder makes facade builds reproducible, but it is not the
source offer and does not prove publisher authenticity. For an OCCT-source
replacement, check out the locked OCCT fork and commit, rebuild the builder
image from upstream's `Dockerfile.builder`, audit the result, and deliberately
update the image digest in the lock. Facade-only changes should be carried as
ordered patches here so the replacement path remains inspectable.

Likewise, successful local bundle generation and verification show that the
declared files and digests are internally consistent. An independently trusted
release-manifest pin plus the attested loader proves the exact manifest and
runtime pair supplied to that loader, not that the declared build execution ran.
Neither path establishes publisher identity, certifies legal compliance, or
replaces external review of the actual distribution channel and
corresponding-source offer.
