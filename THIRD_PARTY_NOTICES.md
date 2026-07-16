# Third-party notices

InvariantCAD depends on [Manifold](https://github.com/elalish/manifold) for its default watertight mesh geometry backend.

- Package: `manifold-3d`
- Copyright: Manifold contributors
- License: Apache License 2.0
- Source: <https://github.com/elalish/manifold>

The dependency is installed as a separate npm package. Its license, notices, and corresponding source information must remain available in redistributed dependency bundles.

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
current npm tarball. Anyone distributing that modified pair must make the
upstream wrapper source, every local patch, locked build inputs, corresponding
OCCT source, and applicable notices available, together with a practical
relink and replacement path.

For the existing compatible public ABI, `createOcctKernel({ wasm })` accepts a
URL, filesystem path, `ArrayBuffer`, or `Uint8Array`. This keeps the WASM
component replaceable with a compatible user-built version rather than
hard-wiring the distributed binary into InvariantCAD. The internal extension
smoke test instead loads its matching generated JavaScript glue and WASM pair
directly.

Anyone redistributing a bundle containing the OCCT WASM binary must preserve these notices and satisfy the applicable LGPL source, modification, reverse-engineering, and replacement requirements.
