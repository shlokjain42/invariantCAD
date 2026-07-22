# Third-party notices

InvariantCAD includes the standalone core runtime from
[Manifold](https://github.com/elalish/manifold) for its default watertight mesh
geometry backend.

- Upstream package: `manifold-3d@3.5.1`
- Copyright: Manifold contributors
- License: Apache License 2.0
- Source tag: <https://github.com/elalish/manifold/tree/v3.5.1>
- Tag and identified upstream build commit: `cc8a7f66d7d5a560da94346258c5b546af27811e`
- Upstream build run: <https://github.com/elalish/manifold/actions/runs/26954086564>
- Upstream WASM artifact: `7412602752` (`sha256:48c480a83c2c3852f57f48c51285481183086a4376bc02ee22c2dce03b56399b`)
- Upstream publish run: <https://github.com/elalish/manifold/actions/runs/26954129221>
- npm integrity: `sha512-/+m6kxYMMhnPutcQ5oSmFJiJ+gyP/0fmuUCb9Qeaunvecm/bfqogKYDDJarsnWiFioSMtKheF+lGmSlnYCik9g==`

InvariantCAD redistributes the upstream `manifold.js`, `manifold.wasm`, and
`manifold.d.ts` artifacts without the package's unrelated glTF/image tooling.
The exact reviewed byte lengths and SHA-256 digests are recorded in
`src/vendor/manifold-3d/UPSTREAM.json`, verified during every build, and copied
beside the runtime in `dist/vendor/manifold-3d/`. The upstream Apache-2.0
license and provenance manifest are shipped in that directory. The package's
root Apache-2.0 license also applies to InvariantCAD's own source.

The upstream publish workflow selected the latest completed `master` WASM
artifact. At publication time that was the build run and source commit listed
above. The npm tarball integrity and InvariantCAD's per-file SHA-256 values are
the authoritative pins for the exact redistributed bytes; the recorded run is
the identified upstream build provenance rather than a separately reproduced,
bit-for-bit source build.

### Components embedded in the Manifold runtime

The upstream WebAssembly build statically incorporates or derives code from
the following permissively licensed components. InvariantCAD preserves their
notices even where an object-code exception may reduce the minimum obligation:

- Clipper2 at commit `46f639177fe418f9689e8ddb74f08a870c71f5b4`,
  Copyright Angus Johnson 2010-2026, Boost Software License 1.0:
  `licenses/manifold-Clipper2-Boost-1.0.txt`;
- Manifold's modified tbtSVD-derived implementation from origin commit
  `355c4e826cc2e05acf23beaf011f7695c87b9d7f`, Copyright 2019 wi-re and
  2023 The Manifold Authors, MIT:
  `licenses/manifold-tbtSVD-MIT.txt`;
- Manifold's modified `dset`-derived implementation from origin commit
  `7967ef0e6041cd9d73b9c7f614ab8ae92e9e587a`, Copyright 2015 Wenzel Jakob,
  zlib-style license: `licenses/manifold-dset-zlib.txt`;
- Manifold's modified NVIDIA PhysX-derived distance routines, traced to PhysX
  commit `a2af52eb6a2532bd2bc583ef8ead9c81c9222af1`, Copyright 2008-2023
  NVIDIA Corporation, 2004-2008 AGEIA Technologies, and 2001-2004 NovodeX,
  BSD 3-Clause: `licenses/manifold-PhysX-BSD-3-Clause.txt`;
- deterministic trigonometry adapted from FreeBSD msun/musl, Copyright 1993
  Sun Microsystems under its preserved permissive notice:
  `licenses/manifold-Sun-msun.txt`;
- Manifold's linalg.h 2.2-derived linear algebra from Sterling Orsten at
  commit `4460f1f5b85ccc81ffcf49aa450d454db58ca90e`, public domain/Unlicense:
  `licenses/manifold-linalg-Unlicense.txt`;
- Manifold's Antti Kuukka quickhull-derived implementation from commit
  `4ef66c68950cb4db11d3b75bfe4034d807485ad0`, public domain:
  `licenses/manifold-quickhull-public-domain.txt`;
- Emscripten 5.0.2 generated runtime at commit
  `dc80f645ee70178c11666de0c3860d9e064d50e4`, MIT or University of
  Illinois/NCSA: `licenses/manifold-Emscripten-5.0.2.txt`;
- Emscripten's selected `dlmalloc` 2.8.6 allocator, Doug Lea public
  domain/CC0 plus Emscripten-licensed modifications:
  `licenses/manifold-dlmalloc-public-domain.txt`;
- musl libc toolchain portions, MIT and the permissive component terms in
  `licenses/manifold-musl-COPYRIGHT.txt`;
- LLVM libc++ toolchain portions, Apache 2.0 with LLVM exception and component
  notices: `licenses/manifold-LLVM-exception.txt`;
- LLVM libc++abi toolchain portions under its distinct exact license file:
  `licenses/manifold-libcxxabi-LICENSE.txt`;
- LLVM compiler-rt toolchain portions under its distinct exact license file:
  `licenses/manifold-compiler-rt-LICENSE.txt`; and
- conservatively, LLVM-libc support that libc++ can pull for floating-point
  conversion, although reachability in these exact runtime bytes has not been
  proved: `licenses/manifold-llvm-libc-LICENSE.txt`.

All fourteen notice files above are shipped both in the package-level `licenses/`
directory and beside the staged runtime under
`dist/vendor/manifold-3d/licenses/`. Their upstream source links and hashes are
recorded in `src/vendor/manifold-3d/UPSTREAM.json`; the notice bytes and hashes
are verified during build.

Manifold's `math.h` names the musl source files but does not pin their original
musl revision. The exact Manifold `math.h` at the recorded build commit is
therefore the authoritative source for the preserved Sun-derived notice; no
unverified musl commit is asserted here.

The bounded build inventory also records what is not in the standalone files.
`MANIFOLD_PAR=OFF` excludes oneTBB, mimalloc, and the pthread runtime;
WebAssembly exceptions were not enabled, so libunwind is excluded. GoogleTest
is test-only, nanobind is Python-only, and Binaryen, LLVM compiler binaries,
CMake, and emsdk are build tools rather than linked runtime components. The
glTF/image/Sharp packages belong to upstream npm tooling and are absent from
the three redistributed core artifacts.

## occt-wasm and OpenCascade Technology

InvariantCAD's exact B-Rep backend loads [occt-wasm](https://github.com/andymai/occt-wasm) as a separate npm dependency.

- Package: `occt-wasm@3.7.0` (pinned exactly)
- Wrapper copyright: Copyright (c) 2026 Andy Mai
- Wrapper license: MIT
- Wrapper source and build scripts: <https://github.com/andymai/occt-wasm/tree/v3.7.0>
- Compiled kernel: OpenCascade Technology
- OCCT source fork commit: `6e1fe656bf028bf0004482c389661587b269fc65`
- OCCT source: <https://github.com/andymai/OCCT/tree/6e1fe656bf028bf0004482c389661587b269fc65>
- OCCT license: GNU Lesser General Public License 2.1 with the Open CASCADE exception

The full relevant texts are distributed in:

- `licenses/LGPL-2.1.txt`
- `licenses/OCCT_LGPL_EXCEPTION.txt`
- `licenses/occt-wasm-MIT.txt`

The current npm backend consumes the published `occt-wasm@3.7.0` JavaScript and
WebAssembly pair unchanged. Rebuild instructions and the wrapper toolchain are
available in the tagged wrapper source above; the corresponding OCCT source is
available at the pinned fork commit.

This source repository can also build an optional, locally modified matched
JavaScript/WebAssembly pair from the verified upstream source plus the ordered
patches under `native/occt/patches/`. Outputs under
`.artifacts/occt-facade/` are ignored, uncommitted, and excluded from the
current npm tarball.

Repository tooling can copy that already-built pair into an ignored, local,
package-neutral directory and `.tar.gz` archive under
`.artifacts/occt-facade-bundle/`. The bundle collects SHA-256 digests, release
metadata, a CycloneDX SBOM, build provenance, locked inputs, ordered patches,
applicable notices and license texts, and source/relinking instructions. It is
not an npm package, has not been published, and is never downloaded or selected
implicitly by InvariantCAD.

The generated materials make the distribution inputs inspectable; generation
or verification is not legal certification. Anyone distributing that modified
pair must still review the actual bundle and delivery channel, make the
upstream wrapper source, every local patch, locked build inputs, corresponding
OCCT source, and applicable notices available, and preserve a practical relink
and replacement path. Publication remains pending external review.

For the existing compatible public ABI, `createOcctKernel({ wasm })` accepts a
URL, filesystem path, `ArrayBuffer`, or `Uint8Array`. This keeps the WASM
component replaceable with a compatible user-built version rather than
hard-wiring a facade binary into InvariantCAD. The owned extension requires an
explicit matching JavaScript module factory as well; local raw-build and bundle
smoke tests load both files directly from their selected runtime directory.

Anyone redistributing a bundle containing the OCCT WASM binary must preserve these notices and satisfy the applicable LGPL source, modification, reverse-engineering, and replacement requirements.
