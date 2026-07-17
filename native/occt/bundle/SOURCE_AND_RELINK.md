# InvariantCAD OCCT facade source and relink guide

This bundle pairs the InvariantCAD OCCT facade runtime with the exact public
source locations, local patches, and build recipe used to reproduce a
compatible JavaScript/WebAssembly pair. The inventory and instructions are
engineering aids, not legal advice or a claim that this bundle alone satisfies
every recipient's licensing obligations.

## What is in this bundle

- `runtime/occt-wasm.js` and `runtime/occt-wasm.wasm` are an inseparable
  generated pair. Verify them against `SHA256SUMS` and
  `metadata/release.json` before loading either file.
- `source/native/occt/upstream.lock.json` fixes the upstream `occt-wasm` and
  OCCT commits, compiler versions, builder platform, and builder image digest.
- `source/native/occt/patches/` contains every InvariantCAD-owned change in the
  bytewise filename order used by the build: atomic draft, exact indexed draft
  history, and the controlled transactional PipeShell ABI.
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
JavaScript glue from one build with WebAssembly from another.

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
5. Run the included build driver against that working recipe and test the new
   JavaScript/WebAssembly pair through the InvariantCAD native and public
   facade tests.
6. Deploy both rebuilt runtime files together. InvariantCAD accepts an explicit
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
