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

## Dependency and vendored-runtime policy

Production releases must pass a zero-advisory audit across production and
development dependencies, apart from documented exceptions in
`scripts/audit-policy.ts`. An exception requires that no installable fix
exists, names the advisory, module versions, and the single development root
through which every finding is reached, and fails the audit both when any
finding falls outside it and when it no longer matches anything.

The only current exception is GHSA-mrhx-c7xc-m3w5 in `zod` 3.24.0 and 3.25.76.
Every published `mint` documentation-tooling release pins those versions and
no patched `zod` 3 release exists. `mint` is neither shipped nor imported at
runtime; InvariantCAD's own runtime dependency is `zod` `^4.6.6`. Remove the
exception when `mint` adopts a patched `zod`.

The default geometry backend uses only Manifold's standalone core JavaScript,
WebAssembly, and type artifacts. Those upstream `manifold-3d@3.5.1` files are
vendored because the complete upstream npm package installs an unrelated
glTF/image toolchain that is neither imported nor exposed by InvariantCAD. The
reviewed artifacts are pinned by byte length and SHA-256 and are verified before
every build. Their npm integrity, identified upstream build run and commit,
licenses, and individual digests are recorded in
`src/vendor/manifold-3d/UPSTREAM.json`. The Manifold, embedded-component, and
toolchain notices are shipped both package-wide and beside the staged runtime.

Vendoring moves update responsibility into this repository. A Manifold upgrade
therefore requires an intentional provenance-manifest update plus the complete
Node, package-consumer, and production-browser release gates. Security reports
about the bundled runtime are welcome through the same private channel.
