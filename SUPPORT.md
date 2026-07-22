# InvariantCAD support

InvariantCAD is maintained as an open-source project on a best-effort basis.
This guide explains where to ask for help and what information makes a report
actionable. It does not create a service-level agreement or a guarantee that a
particular model, kernel, or deployment will be supported.

## Supported releases

The current `0.1.x` release line receives security and correctness fixes. The
`main` branch contains active development and may include behavior that has not
been released to npm.

When reporting a problem, first reproduce it with the latest available patch
release when practical. Older 0.x versions may be investigated when a
regression comparison is useful, but fixes normally target the supported line.

The separately built InvariantCAD-owned OpenCascade facade is not yet a
published supported release artifact. Reports about its source and build
recipe are welcome, but general consumer support is limited until it completes
its separate legal, security, and release review.

## Where to go

| Need | Channel |
| --- | --- |
| Usage or integration question | GitHub question issue form |
| Reproducible bug | GitHub bug-report form |
| Feature or roadmap proposal | GitHub feature-request form |
| Documentation problem | GitHub documentation form |
| Security vulnerability | [Private vulnerability report](https://github.com/shlokjain42/invariantCAD/security/advisories/new) |
| Conduct concern | Private channel in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |

Do not include credentials, unpublished vulnerability details, confidential
CAD data, proprietary files, or personal information in a public issue.

## Before opening an issue

1. Search existing issues and pull requests.
2. Read the [documentation](https://invariant-cad.mintlify.app) and the
   [support matrix](https://invariant-cad.mintlify.app/reference/support-matrix).
3. Confirm that the selected kernel advertises the required capability.
4. Reduce the problem to the smallest design document or TypeScript example
   that still fails.
5. Preserve complete structured diagnostics rather than only the message text.
6. Remove secrets and private geometry from the reproduction.

For native crashes, hangs, or excessive resource use, also state whether the
input is trusted and whether evaluation runs in a worker or separate process.

## Information to include

A useful report normally contains:

- InvariantCAD version and package manager;
- Node.js or browser name and version;
- operating system and CPU architecture;
- TypeScript and bundler versions when relevant;
- kernel: Manifold, stock OpenCascade, owned facade, or custom;
- whether the failure occurs in Node, a browser main thread, or a worker;
- a minimal runnable example or sanitized document;
- expected and actual behavior;
- complete diagnostic codes, details, and stack traces; and
- whether every evaluated design and evaluator was disposed.

For topology issues, identify the query/reference, expected cardinality,
history mode, descriptor fingerprint, and explanation report. For import/export
issues, include the format and relevant tessellation or native-exchange options.

## Modeling correctness boundary

InvariantCAD tests and diagnostics are engineering aids, not professional
certification. The project does not warrant that a model is manufacturable,
safe, compliant with a standard, or appropriate for a particular physical use.
Users remain responsible for independent validation, tolerances, materials,
loads, regulatory requirements, and downstream manufacturing review.

Maintainers may be unable to diagnose a report that depends on confidential
geometry and cannot be reproduced with a public minimal case.

## Response expectations

Issues are triaged as maintainer availability permits. A clear report with a
small reproduction is much more likely to receive a useful response. Lack of
an immediate response does not mean the report was rejected.

The project may close issues that are duplicates, outside the documented
support boundary, missing essential reproduction information after a request,
or better tracked by an upstream kernel. When an upstream issue is appropriate,
please link both reports so the boundary remains visible.

## Commercial and private support

The project does not currently offer a guaranteed commercial support plan,
private model review, custom feature delivery, or private deployment service.
Organizations may use and modify the project under its license and can
contribute generally useful fixes through the normal process.
