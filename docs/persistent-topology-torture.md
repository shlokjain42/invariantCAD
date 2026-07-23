---
title: "Persistent-topology torture contract"
description: "Normative stable, missing, ambiguous, ownership, conditioning, and compatibility cases for durable topology evidence."
icon: "fingerprint"
---

# Persistent-topology torture suite

InvariantCAD's persistent-topology contract is fail-closed: a run passes when a
reference resolves to exactly one compatible current face, edge, or exact B-Rep
vertex, and also when an unsupported identity is rejected with the documented
missing or ambiguous diagnostic. Success never means guessing from a kernel
index or enumeration order.

The published corpus exercises protocol-v2 primary descriptor `@6` on both the
known stock OCCT runtime and the matched owned facade ABI 0.9 runtime, which
retains the ABI 0.6 exact-evolution matrix. Each runtime also exposes its exact
protocol-v1 compatibility floor:
descriptor `@4` for stock and owned ABI 0.2–0.4, or descriptor `@5` for owned
ABI 0.5+. The v1 fixtures pin their original face/edge evidence and byte
behavior, while v2 adds vertices and edge↔vertex evidence. None of these
profiles claims that every topology edit already has durable identity.

| Boundary | Repeated evaluations | Required result |
|---|---|---|
| Complete extrusion lineage through a rigid transform | Capture a source-aware side face and end-rim edge at the baseline, dispose the capture run, serialize/parse Document v6, then evaluate square symmetry, width/height crossover, and the original baseline with changing rotation and translation | Both references resolve by `semantic-lineage` to current evaluation-scoped keys while no capture key is serialized; downstream shell and fillet succeed with checked volume and bounds |
| Exact vertex persistence | Capture one exact box vertex with protocol v2, dispose the capture run, round-trip Document v6, then translate and resize the box | The reference resolves by `semantic-lineage` to one fresh evaluation-scoped vertex key from its complete anchored incident-edge set; no native index or capture key enters the document |
| Coincident vertex ambiguity | Present distinct exact B-Rep vertices with identical point, lineage, and incident-edge evidence | Capture or resolution fails key-free with `TOPOLOGY_MATCH_AMBIGUOUS`; coincident coordinates never collapse distinct B-Rep identity and enumeration never breaks the tie |
| Authored source disappearance | Replace a rectangle profile with a circle while retaining the surrounding node IDs | Direct resolution and the downstream shell fail with `TOPOLOGY_MATCH_MISSING` |
| Partial Boolean history | Capture an unaffected drilled-box edge, vary the hole radius from `0.05` to `9` mm, cross the target width/height, then restore it | Stable cases resolve through bounded geometry/adjacency; the adjacency-changing crossover fails missing; restoring the original dimensions resolves again |
| Exact Boolean history | Capture the inherited cylindrical tool-side face from an exact subtraction, vary the hole radius through `1`, `2`, `5`, and `8` mm, move the tool entirely outside the target, then restore it | Radius changes resolve by `semantic-lineage` and drive a downstream adjacent-edge fillet; disappearance and its consumer fail key-free missing; restoration resolves again |
| Exact fillet and chamfer history | Treat one role-selected edge of an asymmetric box, then capture the inherited `box.face.x-max` face, the unique exact edge-generated face carrying `fillet.face.blend` or `chamfer.face.bevel`, and one geometrically selected unnamed treatment edge | Across amount `2` to `1`, both face references resolve by `semantic-lineage` with fresh keys and remain usable as shell openings; a direct role selector drives the same downstream operation. The unnamed edge resolves by `geometry-adjacency` only at amount `2`, fails key-free missing at `1`, and resolves again after restoration |
| Edge-treatment role-class ambiguity | Treat two separate box edges and inspect the two generated blend or bevel faces | Both faces correctly share the operation's class role, so capturing one fails key-free with `TOPOLOGY_MATCH_AMBIGUOUS` and two candidates rather than using geometry or edge order to invent per-face identity |
| Exact shell history | Shell a box through its role-selected top opening, then capture the inherited opening rim and one source-less generated inner face | The opening rim resolves semantically as thickness changes. The generated inner face resolves geometrically only at its capture thickness, fails missing at other thicknesses, and resolves again after restoration |
| Exact draft history | Capture the inherited modified `box.face.x-min` face from a draft and vary the angle through positive and negative values | The face resolves by `semantic-lineage` with fresh keys and remains usable as a downstream shell opening |
| Exact offset history | Capture the source-less positive-Z face of an inward offset, change the offset distance, then restore it | An identical run resolves by `geometry-adjacency` and drives a downstream shell. The changed distance fails key-free missing because exact offset currently carries no upstream box role onto that generated face; restoration resolves again |
| Partial-to-full revolution | Persist a partial-revolution start cap at 90 degrees, then evaluate 180, 360, and 270 degrees | The partial turns resolve, the full turn fails missing because the cap does not exist, and the cap resolves again when it reappears |
| Repeated sweep semantics | Attempt to capture one of two sides produced from the same profile curve by a two-segment path | Capture fails with `TOPOLOGY_MATCH_AMBIGUOUS` and two candidates because path-segment identity is intentionally not authored |
| Protocol and fingerprint variants | Store protocol-v2 `@6`, exact protocol-v1 `@4`/`@5`, and unrelated variants in different authoring orders | Only an exact protocol/fingerprint pair is eligible; when both supported generations are present, v2 is selected deterministically and authoring order has no effect |
| Resolution explanations | Explain semantic, partial-history, mixed-strategy, missing, and ambiguous searches directly and through a shared session | Versioned frozen aggregates have exact considered/matched invariants; only a resolved outcome has a current key; within one shared session, explaining and resolving the same object performs one bounded search |
| Cancellation and ownership | Abort from topology extraction for persistent fillet, chamfer, shell, and draft; also exercise success, missing, ambiguous, and work-limit exits | Cancellation reports `EVALUATION_ABORTED`, no downstream feature is invoked, and every created shape is released exactly once |

The real-kernel cycles additionally compare the OCCT arena shape count with its
baseline after success and failure cleanup. Detached evidence is serialized only
after the capture evaluation is disposed, so the corpus also guards against
accidentally retaining evaluation-scoped keys or native shapes.

The exact cases intentionally pin identity-only inheritance plus one narrow
generated-class rule. A `PRESERVED` or `MODIFIED` successor may retain an
already-proven role/source anchor. `GENERATED` never copies that source identity.
For fillet and chamfer only, an identity-less result face receives the operation's
blend/bevel class role when the complete native graph proves an incoming
edge-to-face `GENERATED` relation. The reducer does not inspect surface type,
result order, or selected-edge indices. Generated and residual-created edges,
residual-created faces, vertex-caused faces, and generated shell/offset topology
remain unnamed. Vertices have no semantic role vocabulary at all. Protocol v2
can nevertheless resolve a vertex semantically when both complete snapshots
provide the same fully anchored incident-edge set. Otherwise it falls back to
point plus incident-edge geometry, and a parameter change may fail missing.
Distinct coincident vertices remain separate candidates and fail ambiguous when
their evidence cannot distinguish them.

The version boundaries are tested independently. Document v6 admits vertex
references and queries while v1–v5 stay frozen. Signature protocol v2 adds
vertex evidence while protocol-v1 reference bytes, evidence construction, and
matching stay frozen. OCCT descriptor `@6` is primary and `@4`/`@5` are exact
v1 compatibility profiles. The current owned facade ABI is 0.9: it retains the
ABI 0.6 modeling/history surface, ABI 0.7 bounded artifact transport, and ABI
0.8's fixed 128 MiB cumulative native allocation-request budget, then adds
exact owned-profile BinTools-v4 structural preflight only for the
repository-private candidate. None of those candidate transport changes alters
the persistent-topology contract or supplies comprehensive durable identity for
indistinguishable symmetric topology. The separate exact indexed
topology-evolution protocol remains version 1.

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

After building or otherwise supplying the matched owned facade ABI 0.9 runtime,
run the ABI 0.6 exact-evolution matrix it retains with:

```sh
pnpm test:occt-persistence-public
```

Pass `-- --runtime-dir DIRECTORY` to use a verified runtime outside the default
`.artifacts/occt-facade` directory. `pnpm test:occt-facade-bundle` runs the same
matrix against the runtime inside the freshly verified package-neutral bundle.

The ordinary full-test, coverage, build, declaration, and packed-consumer gates
remain required; these focused commands are only the fastest way to exercise
the persistence boundary while developing it.
