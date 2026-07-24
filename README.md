# InvariantCAD

[![CI](https://github.com/shlokjain42/invariantCAD/actions/workflows/ci.yml/badge.svg)](https://github.com/shlokjain42/invariantCAD/actions/workflows/ci.yml)
[![Documentation](https://img.shields.io/badge/docs-Mintlify-2563EB.svg)](https://invariant-cad.mintlify.app)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)

Comprehensive, type-safe CAD-as-code for TypeScript.

InvariantCAD turns an immutable, versioned design document into mesh or exact
B-Rep geometry. Designs stay independent of WebAssembly pointers and
kernel-specific objects, so they remain serializable, testable, and suitable
for deterministic builds.

> **Status:** `0.1.0` is the first public foundation. Parametric modeling,
> sketches, assemblies, configurations, topology-aware features, analysis, and
> interchange are usable today. Some complete exact topology-history guarantees
> require the separately built owned OCCT facade. Drawings, GD&T, sheet metal,
> mates, CAM, and CAE remain [roadmap work](docs/roadmap.md).

## Why InvariantCAD

- Native TypeScript authoring with dimension-aware expressions
- Immutable, validated, versioned JSON design documents
- Replaceable geometry kernels: Manifold mesh and OpenCascade B-Rep
- Parametric sketches, primitives, features, transforms, and Booleans
- Semantic topology queries and persistent face, edge, and vertex references
- Parts, nested assemblies, configurations, materials, and deterministic BOMs
- Measurements, physical mass properties, design-impact analysis, and hashes
- STL, OBJ, STEP, and BREP export with explicit resource ownership
- Node.js and browser support with real WebAssembly browser tests

## Install

```bash
pnpm add invariantcad
```

InvariantCAD is ESM-only and requires Node.js 22.13 or newer. npm, Yarn, and
Bun can consume the package as well; pnpm is used for repository development.

## Quick start

```ts
import { createEvaluator, design, mm, vec3 } from "invariantcad";

const cad = design("parametric-box");
const width = cad.parameter.length("width", mm(40), { min: mm(1) });

const body = cad.box("body", {
  size: vec3(width, mm(20), mm(5)),
  center: true,
});
cad.output("body", body);

const evaluator = await createEvaluator();
try {
  const result = await evaluator.evaluate(cad.build(), {
    parameters: { width: 60 },
  });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join("\n"));
  }

  try {
    const output = result.value.output("body");
    console.log(output.measure());
    const stl = output.export("stl"); // Uint8Array
  } finally {
    result.value.dispose();
  }
} finally {
  evaluator.dispose();
}
```

The default evaluator uses the bundled Manifold runtime. Select a named profile
when the runtime contract matters:

```ts
const preview = await createEvaluator({ profile: "mesh-preview" });
const exact = await createEvaluator({ profile: "mechanical-exact" });
```

The exact profile loads the stock OCCT backend and verifies its complete
mechanical baseline before returning. Every evaluated design and evaluator owns
native resources, so dispose them as shown.

## Geometry backends

| Backend | Representation | Best for | Exchange |
| --- | --- | --- | --- |
| Manifold | Watertight triangle mesh | Fast default modeling and STL/OBJ workflows | STL, ASCII STL, OBJ |
| OpenCascade | Exact B-Rep | Analytic geometry, topology, STEP, and BREP workflows | STL, OBJ, STEP, BREP |

Use the exact profile for the supported stock OCCT baseline:

```ts
import { createEvaluator } from "invariantcad";

const evaluator = await createEvaluator({
  profile: "mechanical-exact",
});
```

Pass an explicit kernel when custom OCCT loading, an owned runtime, or another
backend is required. See the [kernel guide](docs/evaluation/kernels.mdx) for the
complete capability and deployment differences.

## Capability snapshot

InvariantCAD 0.1 includes:

- Length, angle, scalar, vector, and density expressions with dependency checks
- Boxes, cylinders/cones, spheres, sketches, extrudes, revolves, and transforms
- Exact bounded lofts and line/arc path sweeps through OCCT
- Union, subtraction, intersection, fillet, chamfer, shell, offset, and draft
- Constraint-based sketches with lines, arcs, circles, rectangles, and polygons
- Semantic topology set queries plus persistent topology evidence
- Materials, parts, nested assemblies, configurations, suppression, and BOMs
- Volume, area, center of mass, inertia, density-aware mass, and gyration analysis
- Document migration, deterministic serialization, feature hashes, and impact reports

The [support matrix](docs/reference/support-matrix.mdx) distinguishes authoring,
Manifold, stock OCCT, and owned-facade support feature by feature.

## CLI

```bash
invariantcad validate model.json
invariantcad inspect model.json --kernel occt
invariantcad bom model.json --output assembly
invariantcad export model.json --output body --to body.step
```

See the [CLI reference](docs/reference/cli.mdx) for configuration and parameter
overrides, output selection, formats, and exit behavior.

## Documentation

Read the [hosted documentation](https://invariant-cad.mintlify.app), or browse
its versioned source under [`docs/`](docs/README.md):

- [Installation](docs/get-started/installation.mdx)
- [Full quickstart](docs/get-started/quickstart.mdx)
- [Core concepts](docs/get-started/core-concepts.mdx)
- [Modeling guides](docs/modeling/parameters-and-expressions.mdx)
- [Evaluation and kernels](docs/evaluation/evaluator.mdx)
- [Topology and persistent references](docs/modeling/topology-selection.mdx)
- [Assemblies, configurations, and BOMs](docs/modeling/assemblies.mdx)
- [Measurements and mass properties](docs/analysis/measurements.mdx)
- [Import and export](docs/interchange/import-export.mdx)
- [Public library surface](docs/reference/public-surface.mdx) and [complete export index](docs/reference/export-index.mdx)
- [Complete 0.1 guide](docs/reference/complete-guide.md)
- [Architecture](docs/architecture.md) and [roadmap](docs/roadmap.md)

Type declarations, declaration maps, and source JSDoc ship with the npm package
for editor-level API documentation.

## Architecture

```text
TypeScript builder
      ↓
Versioned JSON design document
      ↓
Validated evaluator + sketch solver
      ↓
Manifold mesh kernel or OpenCascade B-Rep kernel
      ↓
Owned results → measurements, topology, BOM, mesh, and exchange files
```

The public document is kernel-neutral. Backend handles never enter serialized
design state, and all native lifetime boundaries are explicit.

## Development

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm release:check
```

`release:check` builds the package, runs the complete Node test suite, validates
source correctness and format hygiene, validates package exports, installs the
packed tarball into a clean consumer, validates the Mintlify site and links,
audits production and development dependencies, and executes the production
browser bundle in Chromium.

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Project
support and decision-making are documented in [SUPPORT.md](SUPPORT.md) and
[GOVERNANCE.md](GOVERNANCE.md).

## Security

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/shlokjain42/invariantCAD/security/advisories/new).
Do not open a public issue for an undisclosed vulnerability. See
[SECURITY.md](SECURITY.md) for supported versions and the WASM/native-code
threat boundary.

## License

InvariantCAD is licensed under [Apache-2.0](LICENSE). Its geometry backends have
their own notices and redistribution obligations; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
