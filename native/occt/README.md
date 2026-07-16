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
path prefixes. Prefix filenames with an ordering number (for example,
`0001-draft-history.patch`) because lexical order is part of the build.

## Native smoke test

Build the patched facade, then load the matched generated JavaScript and WASM
pair directly through the native fixture corpus:

```sh
pnpm build:occt-facade
pnpm test:occt-facade
pnpm test:occt-draft-public
```

The native fixture exercises the raw ABI; the public smoke loads the same
generated pair through `createOcctKernel` and exercises direct and evaluated
draft. These heavyweight tests are intentionally separate from normal
`pnpm verify`. Generated artifacts stay under the ignored
`.artifacts/occt-facade/` directory and are not committed or packed.

## Owned draft ABI and public adapter

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
`abs(angleRad) < pi/2`. Facade version 0.2 makes a successful
draft conditional on a complete indexed face/edge/vertex evolution proof. It
requires one same-kind result successor for every input subshape, rejects
duplicate claims and unclaimed result subshapes, and exposes no result if that
proof fails.

The version-1 evolution envelope is report-owned and immutable. It records
`sourceShapeIndex`, `sourceKind`, `sourceIndex`, `relation`, `resultKind`, and
`resultIndex`, so later operations can describe multiple source operands and
topology-changing relations without changing the record shape. Draft currently
has one source operand and emits only one-to-one `PRESERVED` or `MODIFIED`
records. The history remains readable through cloned reports and after result
transfer; failed reports advertise version zero and no complete history.
Schema version 1 describes N source shapes evolving into one aggregate result.
`GENERATED` is reserved for additional topology derived from a source link; it
does not inherit the naming or incomplete semantics of OCCT's `Generated()`
method. `GENERATED`, `DELETED`, and source-less `CREATED` remain unadvertised
until topology-changing emitters prove their respective completeness rules.

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
override when their runtime or bundler requires it. The kernel then advertises
both ordinary `draft` support and feature-scoped
`exactIndexedTopologyEvolution` v1 for draft. Its global
topology provenance remains `feature`; other topology-changing operations are
not promoted to complete history by the draft-specific proof. Default
`createOcctKernel()` loads stock OCCT and remains usable for its other exact
features, but it does not advertise or execute draft. Partial, unknown, or
mismatched facade markers fail closed.

The generated pair remains an ignored source-build artifact and is not included
in the `invariantcad` npm tarball. Before a release can claim an installable
draft runtime, the exact JS/WASM pair must be published together as a versioned
compliance bundle with its SHA-256 manifest, build provenance, SBOM, and all
required license material. Until then, use the pinned local build above or an
equivalently trusted matching bundle; the library never fetches native code
implicitly.

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
