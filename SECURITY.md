# Security policy

## Supported versions

InvariantCAD 0.1.x receives security fixes. The main branch is active
development and may contain unreleased protocol work.

The separately built InvariantCAD-owned OpenCascade facade is not a published
or supported release artifact. Security reports about its source, build recipe,
or local bundle are still welcome.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub private vulnerability reporting:

https://github.com/shlokjain42/invariantCAD/security/advisories/new

Include, when possible:

- the affected InvariantCAD version and runtime;
- whether the issue involves Node.js, a browser, a worker, Manifold, stock
  OpenCascade, or the unpublished owned facade;
- a minimal design document or reproduction;
- the security impact and required attacker-controlled input;
- any crash, diagnostic, stack trace, or resource-usage observation; and
- whether public disclosure has already occurred.

We will acknowledge reports on a best-effort basis, validate the affected
boundary, and coordinate disclosure and remediation with the reporter. Please
allow time for native and WebAssembly findings to be reproduced across the
relevant runtime.

## Security boundaries

InvariantCAD validates untrusted design JSON before geometry evaluation and
uses explicit structural, topology, history, artifact, and cache limits.
Normal modeling failures return structured diagnostics. These checks do not
turn a same-thread WebAssembly kernel into a process sandbox.

Applications evaluating hostile or very large CAD input should additionally
use worker or process isolation, wall-clock and memory limits, and controlled
artifact storage. Native STEP, BREP, mesh, and future shape-artifact parsers
should be treated as complex input-processing boundaries.

The npm package never downloads the separately built owned OpenCascade facade.
Applications must supply that matched JavaScript/WebAssembly pair explicitly.
Its local bundle remains outside the supported release boundary until external
legal, security, and release review is complete.

## Reviewed transitive advisory

The 0.1.0 dependency graph installs sharp 0.34.5 through:

    manifold-3d
      -> @gltf-transform/functions
      -> ndarray-pixels
      -> sharp

GitHub advisory GHSA-f88m-g3jw-g9cj concerns malformed VIPS, TIFF, GIF, and
EXIF image decoding in sharp versions before 0.35.0:

https://github.com/advisories/GHSA-f88m-g3jw-g9cj

InvariantCAD imports only Manifold's root geometry WebAssembly binding. It does
not import or expose Manifold's glTF/image toolchain, and runtime tracing of the
public evaluator does not load sharp or the affected image modules. The code is
therefore installed but is not reachable through InvariantCAD's current public
behavior.

No compatible upstream release currently moves this path to sharp 0.35 or
later. A dependency override in InvariantCAD would not protect npm consumers
because package-manager overrides are controlled by the consuming root
project. CI therefore permits only this exact reviewed dependency path and
fails on any advisory, version, or path change. The exception will be removed
when Manifold or its image-tooling dependencies publish a compatible fix.
