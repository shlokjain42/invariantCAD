# InvariantCAD OCCT facade source and relink guide

This ABI/bundle 0.6 release pairs the InvariantCAD OCCT facade runtime with the
exact public source locations, local patches, and build recipe used to reproduce
a compatible JavaScript/WebAssembly pair. The inventory and instructions are
engineering aids, not legal advice or a claim that this bundle alone satisfies
every recipient's licensing obligations.

## What is in this bundle

- `runtime/occt-wasm.js` and `runtime/occt-wasm.wasm` are an inseparable
  generated pair. Verify them against `SHA256SUMS` and
  `metadata/release.json` before loading either file.
- `source/native/occt/upstream.lock.json` fixes the upstream `occt-wasm` and
  OCCT commits, compiler versions, builder platform, and builder image digest.
- `source/native/occt/patches/` contains every InvariantCAD-owned change in the
  bytewise filename order used by the build:
  `0001-atomic-multi-face-draft.patch`,
  `0002-indexed-draft-history.patch`,
  `0003-controlled-pipe-shell.patch`,
  `0004-exact-boolean-history.patch`,
  `0005-exact-edge-treatment-history.patch`, and
  `0006-exact-solid-offset-history.patch`. The fourth patch adds the transactional
  multi-input union/subtraction/intersection ABI and complete face/edge/vertex
  topology graph, isolated operand copies, and native history-record
  budget. The fifth patch adds transactional constant-radius fillet and
  equal-distance chamfer with canonical tangent-contour seeds, a deep
  independent operand copy, complete face/edge/vertex evolution, one-shot
  report ownership, and a separate native history-record budget. The sixth
  patch adds exact face-selected shell and whole-solid offset, canonical opening
  echo, deep independent operand copies, complete evolution with
  generated-only replacement reconciliation, one-shot report ownership, and a
  third native history-record budget. All six are part of the matching 0.6
  source, not optional patches.
- `source/scripts/build-occt-facade.sh` is the exact rootless, digest-pinned
  build driver. Its compilation phase has networking disabled.
- `metadata/provenance.json` records verified artifact digests and the locked
  recipe. It explicitly states that packaging did not observe or authenticate
  the earlier build execution.
- `metadata/sbom.cdx.json` is a package-neutral component inventory. It is not
  a legal-compliance determination.

## Obtain the complete corresponding source

The facade source is the `occt-wasm` repository at the exact commit recorded in
`source/native/occt/upstream.lock.json`. Its `occt` Git submodule must resolve
to the separately locked OCCT commit. Obtain both repositories from the URLs
in that lock file, then verify the full commit IDs before applying any patch.

For this release the locked references are:

- `occt-wasm`: `https://github.com/andymai/occt-wasm.git`, commit
  `fe3d5effdaa1ca9a4007a86fde46abd62722fbba`
- OCCT fork: `https://github.com/andymai/OCCT.git`, commit
  `6e1fe656bf028bf0004482c389661587b269fc65`

Those public URLs are convenient retrieval locations, not an availability
guarantee. A distributor should preserve the complete corresponding source and
make it available through a durable method appropriate to that distribution.

## Rebuild the matching pair

Run these commands from the extracted bundle root. The build driver verifies
the checkout commit and OCCT gitlink before exporting source into an isolated
temporary tree. It applies all `*.patch` files in bytewise filename order.

```sh
git clone https://github.com/andymai/occt-wasm.git occt-wasm
git -C occt-wasm checkout --detach fe3d5effdaa1ca9a4007a86fde46abd62722fbba
git -C occt-wasm submodule update --init occt

git -C occt-wasm rev-parse HEAD
git -C occt-wasm ls-tree HEAD occt

mkdir -p source/.cache/occt-facade-cargo
source/scripts/build-occt-facade.sh \
  --source-dir "$PWD/occt-wasm" \
  --cargo-cache-dir "$PWD/source/.cache/occt-facade-cargo"
```

The first build may fetch the locked source and builder image and hydrate the
dedicated Cargo cache. Compilation itself runs in a separate container with no
network route. After the image and cache exist locally, repeat the build fully
offline:

```sh
source/scripts/build-occt-facade.sh \
  --source-dir "$PWD/occt-wasm" \
  --cargo-cache-dir "$PWD/source/.cache/occt-facade-cargo" \
  --skip-fetch
```

The rebuilt files are written below `source/.artifacts/occt-facade/`. They are
compatible replacement candidates, but a modified build is not expected to
match this release's checksums. Test the generated pair together; never mix
JavaScript glue from one build with WebAssembly from another. A matching 0.6
pair must expose the retained draft and PipeShell surfaces plus
`invariantcadBooleanAtomic`, the stable union/subtract/intersect operation enum,
and complete version-1 `PRESERVED`/`MODIFIED`/`GENERATED`/`DELETED`/`CREATED`
history. The exact Boolean call accepts the caller's maximum history-record
count. It must retain all available native preserved, modified, and generated
claims; emit deleted only without a final identity successor; and use
source-less `CREATED` (`-1/NONE/-1`) only for residual higher-order result
topology, mutually exclusively with operand claims. Boolean operations must run
on topology-independent working copies that share immutable geometry, prove
each indexed source-to-copy mapping, and leave every arena-owned input BREP
byte-stable. It must also expose `invariantcadEdgeTreatmentAtomic`, stable
fillet `0` and chamfer `1` operation codes, and complete version-1 evolution for
both edge treatments. The edge-treatment call accepts its own maximum
history-record count. It must echo the exact deduplicated, input-index-ordered
seed list; admit the first seed on each not-yet-covered maximal tangent contour;
record later overlapping seeds as skipped; and stage every admitted contour
before one builder invocation. The builder must receive only a deep independent
B-Rep copy, including copied curve and surface geometry, whose
original-to-copy face/edge/vertex correspondence is proved,
never the arena operand. Its report owns the result until a validated
same-kernel one-shot transfer, covers every source and result face, edge, and
vertex with the same identity/deletion and generated/residual-created rules,
and leaves the authored input BREP byte-stable on success or failure. A direct
solid or a recursively nested one-child compound/compsolid wrapper around one
solid must be accepted; loose or multiple topology must fail, and successful
output must be normalized to the contained solid. It must also expose
`invariantcadSolidOffsetAtomic`, stable shell `0` / offset `1` and inward `0` /
outward `1` codes, and complete version-1 evolution for both solid-offset modes.
Shell opening IDs must be deduplicated and ordered by input face index, echoed
exactly by the report, and mapped onto a deep independent single-solid BREP copy;
whole-solid offset accepts no openings. Only that copy may enter the
fixed-round-join builder, and the arena input BREP must remain byte-stable. The
solid-offset graph must retain all generated links and reconcile a pinned OCCT
generated-only replacement as deleted only when its identity is absent from the
final result and it has no `Modified` successor. A selected shell opening may
instead be `MODIFIED` into the planar opening rim; selection alone must not force
deletion. Its report owns one validated result until a same-kernel one-shot
transfer and accepts its own maximum history-record count, independent of the
Boolean and edge-treatment limits.

## Modify OCCT and relink

The distributed WebAssembly statically contains OCCT, so replacing OCCT means
rebuilding and relinking the complete pair. To do that:

1. Modify the checked-out OCCT submodule source, or point the parent checkout's
   `occt` gitlink at a reviewed replacement OCCT commit.
2. Commit that new `occt` gitlink in the parent `occt-wasm` checkout. Update a
   working copy of `upstream.lock.json` to both the new parent commit and the
   new OCCT commit. The included build driver verifies `HEAD` and the gitlink
   recorded in that exact parent commit; an uncommitted submodule checkout is
   deliberately ignored and will not pass verification. Use `--source-dir`
   for this custom parent commit unless its repository and tag are also made
   available through a deliberately updated fetch configuration.
3. Rebuild the pinned builder image from the upstream
   `Dockerfile.builder` when the prebuilt OCCT libraries must change. Record
   and audit the replacement image digest rather than reusing the release
   digest as a claim about modified contents.
4. Update the working lock to the replacement builder digest.
5. Keep the owned patch series explicit and ordered. If the change replaces the
   exact Boolean implementation, modify or supersede
   `0004-exact-boolean-history.patch` in the working source recipe. If it
   replaces the exact fillet/chamfer transaction, modify or supersede
   `0005-exact-edge-treatment-history.patch`. If it replaces exact shell/offset
   evolution, modify or supersede `0006-exact-solid-offset-history.patch`. Do
   not omit any of these patches and still label the result ABI 0.6. Add any
   later patch with a higher lexical prefix, then
   update the working bundle input inventory and digests.
6. Run the included build driver against that working recipe and test the new
   JavaScript/WebAssembly pair through the InvariantCAD native and public facade
   tests. The exact Boolean corpus must cover all three operations, authored
   target/tool order, complete face/edge/vertex history including residual
   source-less-created topology and stale intermediate removals, isolated
   working copies with byte-stable arena inputs, configurable record-limit enforcement before native
   report materialization and indexed JavaScript copying, empty results,
   same-kernel one-shot transfer, and rollback on failed adoption.
   The exact edge-treatment corpus must cover fillet and chamfer operation-code
   and amount echoes, canonical tangent-contour seed admission and overlap
   skipping, one native build, complete face/edge/vertex history including
   generated and residual source-less-created topology, a deep independent
   operand copy with byte-stable arena input, its separate record limit,
   same-kernel one-shot transfer, and exactly-once rollback.
   The exact solid-offset corpus must cover inward and outward one-/two-opening
   shell plus whole-solid offset, canonical duplicate/reordered opening echoes,
   selected-opening modified-rim semantics, generated-only replacement
   reconciliation, complete source/result coverage, a deep independent operand
   copy with byte-stable arena input, its independent zero/oversize record-limit
   failures, same-kernel one-shot transfer, and exactly-once rollback.
7. Deploy both rebuilt runtime files together. InvariantCAD accepts an explicit
   module factory and WebAssembly override and does not require release hashes
   when an application intentionally supplies its own trusted build.

The bundle contains the deterministic recipe and owned patches, but not a
prelinked object-file kit. Preserve any additional relinkable material required
for the way you distribute the statically linked runtime.

## Integrity and authenticity boundary

`SHA256SUMS` detects accidental or malicious byte changes only when the
expected manifest is obtained through a trusted channel. The manifest and
provenance in this bundle are unsigned. They do not authenticate a publisher,
prove how the runtime was built, or replace source and license review.
