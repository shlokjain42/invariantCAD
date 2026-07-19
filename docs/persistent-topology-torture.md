# Persistent-topology torture suite

InvariantCAD's persistent-topology contract is fail-closed: a run passes when a
reference resolves to exactly one compatible current face or edge, and also when
an unsupported identity is rejected with the documented missing or ambiguous
diagnostic. Success never means guessing from a kernel index or enumeration
order.

The initial published corpus exercises the stock OCCT descriptor `@4` runtime.
It is an executable compatibility floor for the currently documented face/edge
protocol, not a claim that every topology edit already has durable identity.

| Boundary | Repeated evaluations | Required result |
|---|---|---|
| Complete extrusion lineage through a rigid transform | Capture a source-aware side face and end-rim edge at the baseline, dispose the capture run, serialize/parse Document v4, then evaluate square symmetry, width/height crossover, and the original baseline with changing rotation and translation | Both references resolve by `semantic-lineage` to current evaluation-scoped keys while no capture key is serialized; downstream shell and fillet succeed with checked volume and bounds |
| Authored source disappearance | Replace a rectangle profile with a circle while retaining the surrounding node IDs | Direct resolution and the downstream shell fail with `TOPOLOGY_MATCH_MISSING` |
| Partial Boolean history | Capture an unaffected drilled-box edge, vary the hole radius from `0.05` to `9` mm, cross the target width/height, then restore it | Stable cases resolve through bounded geometry/adjacency; the adjacency-changing crossover fails missing; restoring the original dimensions resolves again |
| Partial-to-full revolution | Persist a partial-revolution start cap at 90 degrees, then evaluate 180, 360, and 270 degrees | The partial turns resolve, the full turn fails missing because the cap does not exist, and the cap resolves again when it reappears |
| Repeated sweep semantics | Attempt to capture one of two sides produced from the same profile curve by a two-segment path | Capture fails with `TOPOLOGY_MATCH_AMBIGUOUS` and two candidates because path-segment identity is intentionally not authored |
| Fingerprint variants | Store a compatible variant and an unrelated variant in both authoring orders | Only the exact protocol/fingerprint variant is eligible; authoring order has no effect |
| Cancellation and ownership | Abort from topology extraction for persistent fillet, chamfer, shell, and draft; also exercise success, missing, ambiguous, and work-limit exits | Cancellation reports `EVALUATION_ABORTED`, no downstream feature is invoked, and every created shape is released exactly once |

The real-kernel cycles additionally compare the OCCT arena shape count with its
baseline after success and failure cleanup. Detached evidence is serialized only
after the capture evaluation is disposed, so the corpus also guards against
accidentally retaining evaluation-scoped keys or native shapes.

The source-repository fixtures are
`tests/topology-persistence-torture-transform.test.ts`,
`tests/topology-persistence-torture-chains.test.ts`, and
`tests/topology-reference-evaluator.test.ts`.
Run them with:

```sh
pnpm vitest run \
  tests/topology-persistence-torture-transform.test.ts \
  tests/topology-persistence-torture-chains.test.ts \
  tests/topology-reference-evaluator.test.ts
```

The ordinary full-test, coverage, build, declaration, and packed-consumer gates
remain required; this focused command is only the fastest way to exercise the
persistence boundary while developing it.
