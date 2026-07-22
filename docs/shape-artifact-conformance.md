# Kernel shape-artifact conformance

InvariantCAD's shape-artifact protocol is stronger than native CAD import and
export. A codec claims that a disposable kernel shape can cross its byte
boundary without losing any state that the evaluator can observe, and that the
claim is valid only for one exact kernel and codec identity.

The public, framework-neutral runtime audit for that claim is exported from
`invariantcad/conformance`. It has no Vitest dependency and is intentionally
separate from the main `invariantcad` entry point so applications do not acquire
an audit harness through their ordinary modeling imports.

The primary entry point is `auditKernelShapeArtifactCodec(...)`. It returns a
`CadResult`: a passing run contains deeply frozen, bounded evidence for the
identity, cases, and operations performed, while a violation returns structured
diagnostics. It does not mutate a kernel to add codec methods, manufacture a
compatibility fingerprint, change
`KernelCapabilities.shapeArtifacts`, or return an eligibility or certification
token.

The same entry point exports the repository-owned semantic-observation protocol
v1: `observeKernelShapeSemantics(...)`,
`encodeKernelShapeSemanticObservation(...)`, and
`hashKernelShapeSemanticObservation(...)`. These functions replace ad hoc
release-witness projections with one bounded canonical observation of the
evaluator surface. They do not serialize a kernel shape and do not confer codec
support or cache eligibility.

## Candidate and advertised modes

The mode is part of the audit target and has release-significant meaning:

- **Candidate mode** exercises an explicitly supplied candidate codec against
  ordinary kernel instances while requiring the kernel's public production
  capability to remain absent. This is the development path for a codec that is
  not ready to be advertised. Supplying the candidate does not wrap or mutate
  the production kernel and does not make that backend cache-eligible.
- **Advertised mode** reads the codec from a fresh production kernel. The
  kernel must already advertise a complete, valid `shapeArtifacts` declaration
  and expose both `encodeShapeArtifact(...)` and
  `decodeShapeArtifact(...)`. An absent or partial declaration is a failure,
  never a skipped test.

Both modes use fresh kernel instances and audit the same protocol obligations.
Candidate mode is evidence for codec development; advertised mode is evidence
about the already-published runtime surface. Promotion from candidate to
advertised remains an explicit backend release decision outside the audit.

The following is the minimal candidate shape. The witness and fixture constants
must be reviewed, checked-in values rather than values regenerated from the
runtime being audited:

```ts
import type { GeometryKernel, KernelShape } from "invariantcad";
import {
  auditKernelShapeArtifactCodec,
  hashKernelShapeSemanticObservation,
  observeKernelShapeSemantics,
  type KernelShapeArtifactCodecCandidate,
  type KernelShapeArtifactFixtureWitness,
  type KernelShapeArtifactSemanticWitness,
  type KernelShapeArtifactWitness,
  type KernelShapeSemanticObservationPlan,
} from "invariantcad/conformance";

declare function createDevelopmentKernel(): Promise<GeometryKernel>;
declare function candidateCodecFor(
  kernel: GeometryKernel,
): KernelShapeArtifactCodecCandidate;
declare function createFixtureShape(kernel: GeometryKernel): KernelShape;
declare const observationPlan: KernelShapeSemanticObservationPlan;
declare const goldenBytes: Uint8Array;
declare const expectedSemantic: KernelShapeArtifactSemanticWitness;
declare const expectedGolden: KernelShapeArtifactFixtureWitness;

const witness: KernelShapeArtifactWitness = async (kernel, shape, context) => {
  const observed = await observeKernelShapeSemantics(
    kernel,
    shape,
    observationPlan,
    {
      limits: { maxObservationBytes: context.maxBytes },
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    },
  );
  if (!observed.ok) return observed;
  return hashKernelShapeSemanticObservation(observed.value, {
    maxBytes: context.maxBytes,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
};

const result = await auditKernelShapeArtifactCodec({
  target: {
    mode: "candidate",
    create: async () => {
      const kernel = await createDevelopmentKernel();
      return { kernel, codec: candidateCodecFor(kernel) };
    },
  },
  expectedIdentity: {
    kernelId: "example-kernel",
    artifact: {
      protocolVersion: 1,
      format: "org.example.kernel-shape",
      formatVersion: 1,
      compatibilityFingerprint: "example-runtime-and-options@1",
    },
  },
  cases: [
    {
      id: "asymmetric-box",
      feature: "fixture.asymmetric-box",
      scope: "current-runtime-self-round-trip",
      expectedWitness: expectedSemantic,
      createSource: (kernel) => createFixtureShape(kernel),
      witness,
    },
    {
      id: "asymmetric-box-golden-v1",
      feature: "fixture.asymmetric-box",
      scope: "golden-decode",
      artifact: goldenBytes,
      expectedArtifactWitness: expectedGolden,
      expectedWitness: expectedSemantic,
      witness,
    },
  ],
});

if (!result.ok) throw new Error(result.diagnostics[0]?.message);
console.log(result.value.certifiesCompatibility); // always false
```

Advertised mode uses `target: { mode: "advertised", create }`, where `create`
returns one fresh production `GeometryKernel`; no separate candidate codec is
accepted. Runtime validation requires at least one self-round-trip case and one
golden-decode case in either mode.

## Exact identity

The caller supplies the expected identity. The audit compares it exactly with
the runtime under test:

- kernel ID;
- kernel shape-artifact protocol version;
- backend-owned artifact format;
- backend-owned format version; and
- compatibility fingerprint.

The compatibility fingerprint is not a topology-signature fingerprint or a
friendly runtime label. It must identify every implementation, native/WASM
runtime, serialization format, tolerance, option, and semantic choice that can
change encoded bytes or decoded evaluator-visible behavior. A match proves only
that the audit exercised the identity presented to it; it is not a
cryptographic attestation that an unreviewed binary deserves that identity.

The sketch solver has a separate `artifactCompatibilityFingerprint` and is a
separate cache-key gate. The shape-codec audit does not invent, test, or confer
solver compatibility. In particular, passing the codec audit cannot make the
built-in reference solver artifact-compatible.

## Witnesses and golden artifacts

Every semantic witness uses the fixed protocol tag and an exact SHA-256 digest;
case IDs, rather than witness digests, must be unique. The audit still accepts a
general witness callback, but repository release cases should build it with
`observeKernelShapeSemantics(...)` and
`hashKernelShapeSemanticObservation(...)`. The audit creates each source shape
through the case factory. Its ordinary self-round-trip path observes the source,
encodes it, decodes it on a separate current kernel instance, and repeatedly
exact-compares the returned digest; the dedicated pre-witness path below
intentionally performs its first encode before status or witness observation.
Multiple cases may deliberately share one witness when they represent the same
expected semantics.

Golden artifacts are tagged fixtures with committed bytes and an expected
semantic witness. They exercise decode compatibility independently of the
current encoder. A self-generated encode/decode round trip can show that two
current code paths agree while both have changed incompatibly; a reviewed
golden prevents that particular blind spot.

Caller-supplied witnesses and goldens are still caller assertions. The harness
validates and reports what it was given, but it cannot prove that the set covers
every supported shape, topology state, or historical format. An official gate
therefore needs a reviewed, fixed witness inventory, committed immutable golden
bytes, and an external matrix that runs those fixtures in every supported
process/runtime combination.

## Repository semantic observation protocol

`KernelShapeSemanticObservationV1` is a detached, deeply frozen record of one
reviewed `KernelShapeSemanticObservationPlan`. The plan has a stable ID and at
least one named mesh request; it also chooses whether topology is omitted,
observed when supported, or required, and may request native-exchange and
downstream-feature probes. `encodeKernelShapeSemanticObservation(...)` accepts
only an observation captured by this runtime and emits bounded canonical-JSON
UTF-8. `hashKernelShapeSemanticObservation(...)` encodes it and hashes it under
the ordinary shape-semantic witness domain.

The result is an exact **normalized evaluator-semantic quotient**, not a native
shape dump and not a claim of unrestricted geometric equivalence. It deliberately
forgets representation details that are not stable evaluator semantics—mesh
vertex/index enumeration, a triangle's choice of first corner, topology keys,
and native exchange bytes—while retaining the observations selected by the
reviewed plan. Named mesh requests, native formats, probes, exclusions, and
probe-result shapes are canonically ordered; duplicate topology-lineage records
are treated as one sorted evidence set. Equality therefore means equality of
this protocol version and plan after these declared normalizations. An
incomplete plan can still miss a semantic difference, and a later protocol can
intentionally define a different quotient.

### Exact numbers and oriented meshes

Measurements, mesh options, and topology numbers are finite IEEE-754 binary64
values encoded as big-endian hexadecimal. Emitted mesh coordinates retain their
actual Float32 values and are encoded as IEEE-754 binary32 big-endian
hexadecimal. Negative zero is the only numeric normalization: both `-0` and
`+0` encode as positive zero. Protocol v1 performs no decimal conversion,
tolerance rounding, epsilon comparison, NaN substitution, or infinity handling;
non-finite inputs are protocol failures.

Each indexed mesh becomes a sorted multiset of oriented triangles. A triangle
is represented by its three encoded coordinate triples. Cyclic corner rotations
are normalized, because they preserve orientation, but reversal is not;
winding remains semantic. Sorting removes vertex and triangle enumeration as an
identity source, while retaining duplicate triangles and their multiplicity.
The request ID and exact tessellation options are part of the observation, so
release plans can exercise more than one reviewed tessellation profile.

### Exact key-neutral topology labeling

When topology is observed, the ordinary topology validator first detaches and
validates the complete face/edge/vertex incidence snapshot and its history mode.
The observation retains intrinsic face, edge, and vertex geometry; canonical
lineage, roles, and sketch sources; complete/partial history; and reciprocal
incidence. It discards every evaluation-scoped key.

Canonical observation-local `f*`, `e*`, and `v*` labels are produced by exact
incidence-graph canonicalization: intrinsic labels are refined by neighbor
colors, unresolved color cells are exhaustively individualized, and the
lexicographically least complete labeling wins. Search states are bounded by
`maxCanonicalLabelStates`; color-refinement and labeling node/link work is
separately bounded by `maxCanonicalWork`. Either ceiling fails rather than using
enumeration as a tiebreaker. Thus isomorphic key-renamed snapshots encode
equally, including symmetric graphs, provided the exact bounded search
completes.

### Feature, native-exchange, and ownership coverage

A plan must account for every feature advertised by the runtime. Each advertised
feature appears exactly once either as a downstream probe or in
`notApplicableFeatures` with a nonempty reviewed reason; naming an unadvertised
feature, duplicating a feature, or leaving one uncovered fails closed. An
exclusion records an explicit corpus boundary—it is not evidence that the
feature preserves semantics. A probe borrows the source and must return a
nonempty array of new shapes. Source aliases and reused result aliases are
rejected. A trusted probe receives its remaining accepted derived-shape
allowance and must honor it. The observer snapshots every accepted result,
disposes it, then re-observes the source; a successful observation therefore
rejects a detected source mutation. A probe that mutates the source and then
throws cannot be rolled back by this observational API and violates the probe
contract. Accepted probe snapshots are sorted by their canonical semantic key,
so callback enumeration is normalized while duplicate semantic results retain
their multiplicity.

Requested native formats must be advertised for both import and export and have
both methods present. Exported bytes are detached and bounded, then imported as
a new observer-owned shape. The observation includes the imported shape's
semantics, not the native bytes. The imported shape is disposed and, on the
successful round-trip path, the source is re-observed unchanged. These checks
establish ownership only for the work the observer can see; backend-internal
allocations and rollback after a failing native call still require backend
resource instrumentation.

## What the audit compares

The audit itself checks the shape's kernel tag, live `status`, repeated digest,
and ownership behavior. The witness determines all richer semantic coverage.
The repository observer supplies the standard measurement, oriented-mesh,
key-neutral-topology, native-round-trip, and downstream-probe projection, but
the plan still determines which mesh profiles, native formats, probes, and
reviewed exclusions are present. A constant, forged, or incomplete custom
witness can allow a lossy codec to pass this finite audit and is not acceptable
release evidence.

This distinction matters. Artifact bytes need not be deterministic, and fresh
decoded subshapes need not reuse source topology keys. The decoded shape must
instead recreate the same stable semantic evidence and produce fresh valid keys
for the new evaluation. Conversely, matching volume or a visually similar mesh
is not enough when lineage, partial-versus-complete history, topology
annotations, analytic overrides, or a downstream operation differs.

Exact comparison is deliberate: individual witnesses choose deterministic
inputs and observation options appropriate to the advertised fingerprint. The
audit does not silently introduce geometric tolerances that broaden a backend's
compatibility claim.

## Ownership and isolation checks

The audit treats ownership rules as part of the wire protocol, not as test
hygiene:

- for every self-round-trip case, an independently created pre-witness source
  on a dedicated fresh producer is encoded before the audit calls `status` or
  witness code, then decoded and witnessed on fresh consumers under both
  disposal orders;
- encoding borrows the source shape; the source remains live and unchanged;
- each successful encode returns fresh, detached, caller-owned bytes;
- mutating one returned array cannot affect the source, another encode, or
  backend storage;
- decoding borrows its input bytes and may neither mutate nor retain them;
- each successful decode returns a new live shape owned by the current decoding
  kernel;
- source and decoded shapes can be disposed independently in either order; and
- round trips cross fresh kernel instances, rejecting instance-local handle
  tables. A process-global handle table can still survive this in-process test;
  committed goldens in a separate-process/runtime matrix are required to reject
  it.

The pre-witness path catches a codec that accidentally serializes only caches or
lazy state materialized by the audit's witness. The harness inspects only the
minimum shape ownership tag before that first encode, then verifies the decoded
result, the still-live source, and independent disposal. The case's reviewed
`createSource` factory must itself avoid status, measurement, mesh, topology, or
witness observation; the harness cannot enforce what opaque construction code
does internally. This remains a black-box check and does not establish
process-global coldness or prove that a backend has no hidden unmaterialized
state.

That dedicated pre-witness claim is intentionally limited to the positive,
full-limit encode/decode path and its two disposal orders. Reduced-ceiling,
pre-aborted, undersized, truncated, empty, and malformed-input checks run on the
ordinary audit paths after semantic observation. They prove those negative
contracts for the audited runtime and corpus, but do not separately prove a
different implementation path behaves correctly before its first observation.

Failures and cancellation must not make a source or previously decoded shape
unusable. The harness owns and cleans up every kernel and returned shape it can
observe, including failure paths. It cannot see codec-internal native
allocations; a backend release gate needs resource snapshots or fault-injection
hooks to prove partial native state is released exactly once.

## Limits, cancellation, and malformed input

The harness bounds its accepted case inventory, operation count, captured
golden bytes, and returned codec bytes. Codec calls receive a hard
`maxArtifactBytes` ceiling, and a successful reduced-ceiling encoding is fully
decoded and witnessed. The harness can reject oversized returned data, but
cannot prove that opaque native code avoided an oversized allocation before it
returned. `maxWitnessBytes` is enforced by the supplied hash helper; an
arbitrary witness callback must honor the passed limit itself.

A pre-aborted signal must stop before material codec work. The audit also polls
the caller signal before and after awaited factories, witnesses, and codec
operations. It does not manufacture a reliably timed in-flight abort inside an
opaque synchronous native call, and cleanup itself is best-effort rather than a
cancellable operation. Backend fault injection plus a killable worker/process
timeout is required for those stronger checks. Audit limits do not excuse the
codec from implementing its own bounded native path: checking the byte count
only after an unbounded native serializer has allocated the entire payload is
not protocol conformance.

The universal adversarial cases include empty and truncated payloads,
byte-limit failure, pre-abort, repeated calls, byte mutation, both source/decode
disposal orders, and cross-instance use. A backend-specific witness corpus
should add corruption and fault-injection fixtures for every native format
revision and semantic state the backend can create.

The semantic observer has a separate cumulative resource envelope. Defaults are:

| Limit | Default | Bounded work |
|---|---:|---|
| `maxOperations` | `10_000` | Kernel calls, probe calls, and owned-shape disposal |
| `maxObservationBytes` | `16 MiB` | Canonical encoded observation |
| `maxStringBytes` | `1 MiB` | Aggregate captured external UTF-8 strings |
| `maxMeshRequests` | `16` | Named tessellation profiles in the plan |
| `maxMeshVertices` | `2_000_000` | Aggregate emitted vertices |
| `maxMeshTriangles` | `4_000_000` | Aggregate emitted triangles |
| `maxTopologyItems` | `100_000` | Faces, edges, and vertices in one normalized snapshot |
| `maxAdjacencyLinks` | `1_000_000` | Incidence entries in one normalized snapshot |
| `maxLineageRecords` | `1_000_000` | Lineage records in one normalized snapshot |
| `maxCanonicalLabelStates` | `1_000_000` | Exact graph-labeling search states |
| `maxCanonicalWork` | `10_000_000` | Color-refinement and canonical-label node/link work units |
| `maxNativeExchangeBytes` | `64 MiB` | One detached native export |
| `maxProbes` | `64` | Each probe or feature-exclusion inventory |
| `maxDerivedShapes` | `256` | Accepted imported and probe-produced shapes |

Canonical size is walked exactly before the full canonical JSON string is
created. Conservative per-snapshot lower bounds reject oversized triangle and
topology materialization early, while the final exact UTF-8 check remains
authoritative. Raw topology strings—including ephemeral keys and repeated
adjacency-key occurrences that canonical output later removes—are charged while
the snapshot is detached, before validation maps or sets can grow. The observer
snapshots the relevant kernel capability metadata, methods, plans, arrays,
measurements, status, and mesh fields before validation so accessors cannot pass
a check and later supply different data.

The observer checks cancellation at entry and around kernel calls, forwards it
to native exchange and probe contexts, and abort-races asynchronous probes. A
same-realm built-in Promise whose fulfillment reaction was already queued
before the observer's cancellation reaction transfers its result for cleanup.
For a custom or cross-realm PromiseLike, transfer occurs only when its captured
fulfillment callback is delivered while the signal is not aborted. A probe that
ignores cancellation and delivers later retains ownership of those results.
Polls inside synchronous TypeScript mesh and graph loops observe only an abort
already visible on the current thread; those loops do not yield to a same-thread
timer. Likewise, an opaque synchronous native call cannot be preempted while it
owns the thread. Resource ceilings, a worker/process timeout, or backend
instrumentation provide the stronger uninterrupted-work bound.
Limits and cancellation fail with structured diagnostics, and every shape that
actually transferred to the observer is cleaned up on the failure path. A
malicious trusted probe that returns an over-limit or hostile array may require
scanning it to discover and release transferred owners, so `maxDerivedShapes`
is an accepted-result ceiling rather than a sandbox for arbitrary callback
code.

## Reading an audit report

A successful report means only that the supplied runtime identity passed the
bounded checks for the supplied witnesses and goldens in that run. It does not
prove all possible shapes, prove cross-process or cross-runtime compatibility,
authenticate the runtime, certify a backend, or enable artifact caching.

Operational cache eligibility remains the conjunction of separate gates:

1. the production kernel advertises a complete shape-artifact capability and
   codec;
2. the exact backend identity and codec have passed the project's reviewed
   conformance matrix;
3. the selected sketch solver advertises its own exact artifact compatibility
   fingerprint; and
4. the evaluator's cache read/decode and encode/write integration is present
   with transactional cleanup, cancellation, corruption, and eviction handling.

InvariantCAD currently has the protocol and audit boundary, but not that full
conjunction.

## Why shipped backends do not advertise support

Neither Manifold nor the stock or owned OCCT adapter currently advertises
`shapeArtifacts`. This is intentional.

For the lockfile-tested `manifold-3d` 3.5.1 runtime, the complete public
`getMesh()` → `Mesh` → `Manifold` path is not an exact artifact boundary.
`getMesh()` exposes Float32 positions while the native solid computes in double
precision. The repository characterization translates a centered `1 × 2 × 3`
box by `0.1` on X. Its source bounds are `[-0.4, 0.6]` on X and its volume is
exactly `6`; complete public-Mesh reconstruction produces X bounds
`[-0.4000000059604645, 0.6000000238418579]` and volume
`6.000000178813934`. Calling `setTolerance(1.5e-12)` restores the source
tolerance scalar but not those bounds or volume. A direct public-Mesh codec is
therefore rejected; scalar sidecars cannot recover geometry already rounded to
Float32 or make synchronous native work cancellable.

For OCCT, ordinary STEP or BREP exchange reconstructs geometry but does not
round-trip the wrapper-level semantic lineage, complete/partial history state,
topology annotations, analytic volume overrides, cached evaluator state, and
other observable data attached to an InvariantCAD shape. Current topology keys
and native subshape indices are evaluation-scoped; a codec needs a stable format
that restores fresh face, edge, and vertex identities together with their
key-neutral semantic evidence rather than persisting those ephemeral keys.

The repository now has a private OCCT candidate hook for developing that stronger
boundary. It is not a package export, is not installed as the production
kernel's codec, and does not add `KernelCapabilities.shapeArtifacts`. Its
versioned envelope combines a binary BREP archive with a canonical sidecar for
key-neutral face/edge/vertex structure and incidence, ordered root/subshape
type-orientation evidence, wrapper lineage, complete/partial history, and
analytic volume overrides. The encoder records the native topology arrays in
order. Decode imports a new native root, generates fresh evaluation-scoped
topology keys, and accepts the sidecar only if the new root type, orientations,
counts, and arrays exactly match the recorded ordered structural evidence. A
mismatch rejects the artifact and disposes the partial shape. Array positions
are therefore fail-closed artifact-local verification coordinates, never
serialized public keys or a claim that native enumeration is durable identity.

The repository gate combines direct cold/warm, state, corruption, byte,
ownership, alternate-valid-BREP, and downstream-selection cases with one
committed stock-runtime asymmetric-box artifact and literal semantic/fixture
witnesses. The general audit still marks that evidence non-certifying, and this
single golden is not a cross-platform or owned-facade matrix.

This hook remains candidate-only for six independent reasons:

- the current native BREP writer fully materializes its string or in-memory
  filesystem payload before TypeScript can enforce `maxArtifactBytes`;
- a small malformed binary can declare large table, pole, or knot counts and
  trigger native allocations beyond the input-byte ceiling before parsing
  fails;
- canonical JSON parsing and comparison still materialize intermediate string,
  object-graph, and encoded sidecar state before schema-specific budgets apply;
- synchronous same-thread WASM does not yield for an ordinary timer-driven
  `AbortSignal`, so entry checks cannot provide prompt in-flight cancellation;
- exact order is useful for rejection in the pinned runtime, but
  indistinguishable symmetric subshapes can be permuted without providing a
  durable semantic identity proof;
- the candidate fingerprint binds reviewed revision labels and options, not the
  exact JavaScript/WASM hashes, OCCT build, toolchain, and serialization flags
  required for a production runtime attestation.

The next production step is an owned bounded native facade ABI. Encoding must
place at most the admitted bytes in a report-owned capped buffer rather than a
full temporary string or file. Decode must borrow bounded input and defend its
native allocations; its report must retain any successful native shape until a
validated one-shot same-kernel transfer. Report destruction, failed transfer,
post-transfer adapter validation, overflow, malformed input, and cancellation
must each release partial state exactly once. Durable artifact-local native
identity markers must bind restored subshapes independently of order while the
wrapper still creates fresh evaluation keys.

A production codec must also prove exact cross-process restoration through
committed goldens. Its compatibility fingerprint must pin the native
binary/WASM and JavaScript pair, wrapper, envelope and sidecar revisions,
native identity scheme, relevant tolerance and serialization options, and any
other input that can change the result.

Those serialization, cancellation, ownership, stable-subshape restoration, and
fingerprint requirements remain open backend work. Advertising an ordinary
native exchange function under the stronger shape-artifact capability would
therefore be incorrect, even when it can reconstruct a geometrically valid
solid.
