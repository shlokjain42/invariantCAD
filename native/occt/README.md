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
  --source-dir /path/to/occt-wasm-v3.7.0 \
  --cargo-cache-dir .cache/occt-facade-cargo

./scripts/build-occt-facade.sh \
  --source-dir /path/to/occt-wasm-v3.7.0 \
  --cargo-cache-dir .cache/occt-facade-cargo \
  --skip-fetch
```

`--skip-fetch` makes the complete invocation offline. It therefore requires an
already-present pinned Podman image, an exact existing source checkout, and a
previously hydrated Cargo cache. The script rejects Cargo credential files in
the mounted cache.

Patches belong in `native/occt/patches/` and should use Git's `a/` and `b/`
path prefixes. Prefix filenames with an ordering number because lexical order is
part of the build. Facade ABI 0.7 is the exact seven-patch series
`0001-atomic-multi-face-draft.patch`, `0002-indexed-draft-history.patch`,
`0003-controlled-pipe-shell.patch`, `0004-exact-boolean-history.patch`,
`0005-exact-edge-treatment-history.patch`,
`0006-exact-solid-offset-history.patch`, and
`0007-bounded-shape-artifacts.patch`.

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
report-owned artifact decode.
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
.artifacts/occt-facade-bundle/invariantcad-occt-facade-0.7.0/
.artifacts/occt-facade-bundle/invariantcad-occt-facade-0.7.0.tar.gz
```

`0.7.0` is the owned facade ABI and bundle version; it is independent of the
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
it implicitly; an application must explicitly load `runtime/occt-wasm.js` and
pass its matched `runtime/occt-wasm.wasm` to `createOcctKernel`.

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
transport without advertising a production artifact codec.
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

These descriptor/profile changes do not change the native boundary. The owned
facade ABI is 0.7, and `exactIndexedTopologyEvolution` remains version 1.
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
an untaken report releases it. The TypeScript candidate passes its remaining
artifact byte allowance into this ABI, validates every report echo, and
releases a transferred root if later sidecar adoption fails. Stock OCCT and
owned ABI 0.2 through 0.6 retain the earlier unbounded research path.

Candidate format v2 also replaces the former JSON semantic state with a bounded
binary sidecar. Its fixed 48-byte big-endian header declares exact sidecar
length and aggregate face, edge, vertex, adjacency, lineage, UTF-16BE
string-byte, and native-orientation totals. The TypeScript encoder detaches and
canonicalizes once, counts the complete representation before allocating, and
writes one exact-size buffer. The decoder preflights the header, totals, and
minimum representation before topology-table allocation, accepts only closed
tags/masks and finite canonical binary64 values, charges nested collections
against the declared totals, and requires exact EOF. UTF-16BE code units retain
arbitrary JavaScript strings without replacement. This bounded sidecar is used
with both the ABI 0.7 native path and the stock/legacy research path; it does not
make their native materialization behavior equivalent.

The reviewed deterministic stock-runtime v2 asymmetric-box fixture is `11,591`
bytes with fixture witness
`invariantcad:kernel-shape-artifact-fixture:v1:sha256:221d1ea2265a26df1293e63d625d25e85eb8a86041bdea53a927269427e3d16a`.
Its semantic witness remains
`invariantcad:kernel-shape-semantic:v1:sha256:40ae684e4a2fad512f54e1f1be4443acf7faf2f34fc6b281c7b816d8d3366cb2`.
The v1 fixture is retained only to prove fail-closed rejection before native
restore. Verify the current fixture without writing with
`pnpm artifact:fixture:occt -- --check --version v2`.

ABI 0.7 still does not advertise `KernelCapabilities.shapeArtifacts`. A small
malformed v4 body can declare native geometry arrays that OCCT allocates before
the post-read topology ceiling is available. Synchronous same-thread WASM also
has an in-flight cancellation gap, ordered native enumeration is not durable
identity for symmetric topology, the runtime has no in-process proof of the
exact JavaScript/WASM/build hashes, and the stock fixture is not cross-process
proof. Binary sidecar v2 closes the former JSON amplification blocker, but
production promotion still requires strict native archive preflight and
allocation/work quotas, prompt cancellation outside the same-thread gap,
durable artifact-local native identity, exact runtime attestation, and reviewed
owned-runtime cross-process goldens.

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
declared files and digests are internally consistent. They do not establish
publisher identity, certify legal compliance, or replace external review of
the actual distribution channel and corresponding-source offer.
