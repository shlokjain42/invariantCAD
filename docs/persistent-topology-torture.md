# Persistent-topology torture suite

InvariantCAD's persistent-topology contract is fail-closed: a run passes when a
reference resolves to exactly one compatible current face or edge, and also when
an unsupported identity is rejected with the documented missing or ambiguous
diagnostic. Success never means guessing from a kernel index or enumeration
order.

The published corpus has two executable compatibility floors: the stock OCCT
descriptor `@4` runtime and the matched owned facade ABI 0.6 exact-evolution
runtime. They test the currently documented face/edge protocol; neither is a
claim that every topology edit already has durable identity.

| Boundary | Repeated evaluations | Required result |
|---|---|---|
| Complete extrusion lineage through a rigid transform | Capture a source-aware side face and end-rim edge at the baseline, dispose the capture run, serialize/parse Document v4, then evaluate square symmetry, width/height crossover, and the original baseline with changing rotation and translation | Both references resolve by `semantic-lineage` to current evaluation-scoped keys while no capture key is serialized; downstream shell and fillet succeed with checked volume and bounds |
| Authored source disappearance | Replace a rectangle profile with a circle while retaining the surrounding node IDs | Direct resolution and the downstream shell fail with `TOPOLOGY_MATCH_MISSING` |
| Partial Boolean history | Capture an unaffected drilled-box edge, vary the hole radius from `0.05` to `9` mm, cross the target width/height, then restore it | Stable cases resolve through bounded geometry/adjacency; the adjacency-changing crossover fails missing; restoring the original dimensions resolves again |
| Exact Boolean history | Capture the inherited cylindrical tool-side face from an exact subtraction, vary the hole radius through `1`, `2`, `5`, and `8` mm, move the tool entirely outside the target, then restore it | Radius changes resolve by `semantic-lineage` and drive a downstream adjacent-edge fillet; disappearance and its consumer fail key-free missing; restoration resolves again |
| Exact fillet and chamfer history | Treat one role-selected edge of an asymmetric box, then capture both the inherited `box.face.x-max` face and the unique source-less face created by the treatment | Across amount `2` to `1`, the inherited face resolves semantically and remains usable as a shell opening. The unnamed generated face resolves by `geometry-adjacency` only at the identical amount, then fails key-free missing rather than acquiring an invented blend/bevel identity |
| Exact shell history | Shell a box through its role-selected top opening, then capture the inherited opening rim and one source-less generated inner face | The opening rim resolves semantically as thickness changes. The generated inner face resolves geometrically only at its capture thickness, fails missing at other thicknesses, and resolves again after restoration |
| Exact draft history | Capture the inherited modified `box.face.x-min` face from a draft and vary the angle through positive and negative values | The face resolves by `semantic-lineage` with fresh keys and remains usable as a downstream shell opening |
| Exact offset history | Capture the source-less positive-Z face of an inward offset, change the offset distance, then restore it | An identical run resolves by `geometry-adjacency` and drives a downstream shell. The changed distance fails key-free missing because exact offset currently carries no upstream box role onto that generated face; restoration resolves again |
| Partial-to-full revolution | Persist a partial-revolution start cap at 90 degrees, then evaluate 180, 360, and 270 degrees | The partial turns resolve, the full turn fails missing because the cap does not exist, and the cap resolves again when it reappears |
| Repeated sweep semantics | Attempt to capture one of two sides produced from the same profile curve by a two-segment path | Capture fails with `TOPOLOGY_MATCH_AMBIGUOUS` and two candidates because path-segment identity is intentionally not authored |
| Fingerprint variants | Store a compatible variant and an unrelated variant in both authoring orders | Only the exact protocol/fingerprint variant is eligible; authoring order has no effect |
| Resolution explanations | Explain semantic, partial-history, mixed-strategy, missing, and ambiguous searches directly and through a shared session | Versioned frozen aggregates have exact considered/matched invariants; only a resolved outcome has a current key; within one shared session, explaining and resolving the same object performs one bounded search |
| Cancellation and ownership | Abort from topology extraction for persistent fillet, chamfer, shell, and draft; also exercise success, missing, ambiguous, and work-limit exits | Cancellation reports `EVALUATION_ABORTED`, no downstream feature is invoked, and every created shape is released exactly once |

The real-kernel cycles additionally compare the OCCT arena shape count with its
baseline after success and failure cleanup. Detached evidence is serialized only
after the capture evaluation is disposed, so the corpus also guards against
accidentally retaining evaluation-scoped keys or native shapes.

The exact cases intentionally pin the identity-only evolution rule. A
`PRESERVED` or `MODIFIED` successor may retain an already-proven role/source
anchor. A source-less `GENERATED` or residual `CREATED` item does not inherit
one merely because its surface looks like a blend, bevel, inner wall, or offset
face. Protocol-v1 can therefore resolve such an item geometrically in an
identical reevaluation, but a parameter change is allowed to fail missing. Any
future `fillet.face.blend`, `chamfer.face.bevel`, shell, or offset roles must be
derived from proved exact evolution and introduced through the appropriate
versioned role/descriptor/document contracts.

The source-repository fixtures are
`tests/topology-persistence-torture-transform.test.ts`,
`tests/topology-persistence-torture-chains.test.ts`,
`tests/topology-reference-evaluator.test.ts`,
`tests/topology-reference-explanations.test.ts`, and
`tests/topology-signatures-occt.test.ts`, plus the real document-owned loft/sweep
coverage in `tests/topology-reference-occt.test.ts`. The owned exact matrix is
`scripts/test-public-occt-persistence.ts`.
Run them with:

```sh
pnpm vitest run \
  tests/topology-persistence-torture-transform.test.ts \
  tests/topology-persistence-torture-chains.test.ts \
  tests/topology-reference-evaluator.test.ts \
  tests/topology-reference-explanations.test.ts \
  tests/topology-reference-occt.test.ts \
  tests/topology-signatures-occt.test.ts
```

After building or otherwise supplying the matched owned facade ABI 0.6 runtime,
run its explicit matrix with:

```sh
pnpm test:occt-persistence-public
```

Pass `-- --runtime-dir DIRECTORY` to use a verified runtime outside the default
`.artifacts/occt-facade` directory. `pnpm test:occt-facade-bundle` runs the same
matrix against the runtime inside the freshly verified package-neutral bundle.

The ordinary full-test, coverage, build, declaration, and packed-consumer gates
remain required; these focused commands are only the fastest way to exercise
the persistence boundary while developing it.
