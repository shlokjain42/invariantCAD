---
title: "Kernel shape-artifact conformance"
description: "Normative candidate and advertised codec audit, semantic witnesses, limits, cancellation, ownership, and report interpretation."
icon: "shield-check"
---

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

InvariantCAD now exercises one direct-output box slice through an unexported,
explicitly trusted-store evaluator binding. That is integration evidence for
item 4 only; the advertised capability, reviewed compatibility matrix, and
production solver fingerprint gates remain absent, so the full conjunction is
still intentionally unavailable.

## Why shipped backends do not advertise support

Neither Manifold nor the stock or owned OCCT adapter currently advertises
`shapeArtifacts`. This is intentional.

For the bundled, digest-pinned `manifold-3d` 3.5.1 core runtime, the complete public
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
kernel's codec, and does not add `KernelCapabilities.shapeArtifacts`. Format v3
combines a binary BREP archive with bounded canonical sidecar v2 and a separate
native-identity-v1 section. The sidecar retains key-neutral face/edge/vertex
structure and incidence, root/subshape type-orientation evidence, wrapper
lineage, complete/partial history, and analytic volume overrides.

The sidecar has a fixed 48-byte big-endian header. It declares its exact byte
length, face/edge/vertex counts, aggregate adjacency links, aggregate lineage
records, aggregate encoded string bytes, aggregate native orientations, both
history tags, and optional-volume presence. Strings are length-prefixed UTF-16BE
code units rather than UTF-8 conversions, so every JavaScript string, including
unpaired surrogates, round-trips without replacement. Numeric geometry is finite
big-endian binary64 with `-0` normalized to `+0`; tags and optional-field masks
are closed. The enclosing private candidate rejects a compatibility fingerprint
longer than `2,048` UTF-8 bytes before allocating its envelope.

Encode detaches and canonicalizes the semantic graph, sorts and deduplicates
lineage, performs a complete counting pass, and only then allocates and writes
exact sections. Decode rejects an invalid header, excessive declared aggregate,
or impossible minimum representation before allocating topology tables. Nested
reads charge the same lineage, adjacency, UTF-16 byte, and orientation totals;
indices must be sorted, unique, and in range; canonical lineage order is strict;
and exact end-of-input is mandatory. There is no JSON parse/object/re-encode
canonicality pass.

Native identity v1 represents each unique located solid, shell, wire, face,
edge, and vertex by the zero-based direct-child sequence from the serialized
root to its first `IsSame` occurrence. A complete rooted direct-child pre-order
stream additionally records every serialized occurrence. Each fixed 12-byte
record contains shape type, composed orientation, direct-child count, and the
canonical `IsSame` class index for those six indexed kinds. Compound,
compsolid, and generic-shape occurrences use no class index, but their exact
structure, order, orientation, and multiplicity remain in the stream. The fixed
64-byte identity header declares exact identity length, aggregate first-path
components, six per-kind unique-class counts, occurrence count, and occurrence
record width.

The codec admits at most `100,000` unique paths, `1,000,000` aggregate
first-path components, depth `64`, and child index `999,999`; capture and the
stored manifest are both capped at `100,000` occurrences, and candidate
classification is capped at `1,000,000` `IsSame` comparisons. The compatibility
fingerprint binds
`nativeIdentity=serialized-first-issame-child-path-v1`,
`nativeOccurrenceManifest=complete-rooted-preorder-type-orientation-child-count-issame-class-v1`,
`nativeOccurrenceRecordBytes=12`, `nativeIdentityMaxOccurrences=100000`,
`nativeIdentityTraversalOccurrences=100000`, all other version/limit
declarations, and the native-structure contract.

The producer lexicographically sorts paths within each kind and jointly
permutes the corresponding native orientations and face/edge/vertex topology
records, and remaps every occurrence class index through the same permutation.
Sidecar incidence is then encoded against that canonical order, so producer
TopExp enumeration cannot change the bytes. Decode imports a new native root,
captures its raw path order, maps stored paths to fresh indices, and
exact-compares occurrence count plus every record's type, composed orientation,
child count, and class path. It also exact-compares identified face/edge/vertex
geometry and incidence. Only then does it attach the stored semantic evidence
to fresh evaluation-scoped keys. A multiplicity, order, orientation,
`IsSame`-class membership, shape type, child count, geometry, incidence, or
root-structure mismatch rejects the artifact and disposes the partial shape.

Within one serialized artifact this proves unique located `IsSame` classes for
solid, shell, wire, face, edge, and vertex and preserves every occurrence's
rooted structure, order, type, composed orientation, multiplicity, and class
membership. Compound, compsolid, and generic-shape nodes are structurally
recorded but are not indexed public identity classes. Stock `occt-wasm` does
not expose `IsPartner`, so v3 cannot attest that distinct-location `IsSame`
classes share one underlying TShape rather than independent TShapes. The paths
remain coordinates in the exact serialized child hierarchy, never public
topology keys, cross-edit identities, persistent assembly identities, or
persistent-topology references.

The repository gate combines direct cold/warm, state, corruption, byte,
ownership, alternate-valid-BREP, and downstream-selection cases with one
committed deterministic stock-runtime v3 asymmetric-box artifact. It is
`13,735` bytes and has fixture witness
`invariantcad:kernel-shape-artifact-fixture:v1:sha256:8ecfa6ac89142f794c2d55a78e7121ce0805b8abcb5aa64230e7722d99c8c2be`.
The byte-format revision leaves the independent semantic witness unchanged at
`invariantcad:kernel-shape-semantic:v1:sha256:40ae684e4a2fad512f54e1f1be4443acf7faf2f34fc6b281c7b816d8d3366cb2`.
The former v1 and v2 fixtures remain committed only as a negative fail-closed
corpus: the v3 decoder must reject both before native restoration. Verify the
reviewed v3 fixture without writing by running:

```bash
pnpm artifact:fixture:occt -- --check --version v3
```

The generator creates cold shapes in fresh kernels, requires two current
encodes to be byte-identical, compares source and freshly decoded semantic
witnesses, validates canonical base64, and then prints the byte count,
fingerprint, and both witnesses. This remains one stock-runtime in-process
golden, not an owned-facade, cross-platform, or cross-process compatibility
matrix, and the general audit correctly continues to classify it as
non-certifying. A focused symmetric-box case reverses producer TopExp
enumeration and still requires byte-identical output, then reverses consumer
enumeration and requires exact semantic restoration with fresh keys. This is
evidence for the stated path-remapping contract, not a claim about every OCCT
shape or platform. A separate duplicate-occurrence regression substitutes a
two-occurrence BREP for a one-component artifact and requires rejection without
leaked wrapper or native ownership; adversarial cases also reject changed
later-occurrence orientation and `IsSame`-class membership.

The Chromium production-bundle gate adds a repository-private disposable-realm
check around that committed stock fixture. The main realm retains the source
bytes and transfers a distinct copied `ArrayBuffer` into a fresh module worker;
the gate requires the retained bytes to remain unchanged and the transferred
copy to detach. Its exact-key response protocol admits one matching
`started` event followed by one `success` or `failure`. The worker confirms
that `shapeArtifacts`, `encodeShapeArtifact`, and `decodeShapeArtifact` are
absent from the public kernel, uses the private candidate to decode, and returns
only scalar volume, topology-count, candidate-version, fingerprint, and
input-immutability evidence after disposing the decoded shape and kernel.

The same production bundle also exercises actual evaluator work in fresh
stock-OCCT workers. A successful worker binds the repository-private
trusted-store experiment, runs `Evaluator.evaluate(...)` over a fixed
`2 × 3 × 7` box cold and warm, and requires `miss,write` with one native box
construction followed by `hit` with zero additional box construction. Detached
volume, topology counts, output count, and diagnostics must match exactly;
public artifact support remains absent, and the worker responds only after
disposing the `EvaluatedDesign` and evaluator. The deadline and post-start
abort cases use an unbound evaluator and acknowledge both worker start and
entry into the wrapped box operation. That wrapper first completes the real
native box and only then enters a non-yielding stall. The host requests
termination, and a new worker must reproduce the successful evaluator's scalar
evidence exactly. Browser `Worker.terminate()` returns `void`, so the gate
cannot await or claim observed worker exit; it proves an exact termination
request and deterministic recovery in a fresh realm. No live OCCT handle or
object crosses either worker protocol.

An unexported host-neutral coordinator owns those one-shot realm operations. It
rejects pre-abort without creating a worker, starts the deadline before calling
the factory, settles result/factory failure/abort/timeout races once, requests
termination exactly once, and waits for the adapter's termination operation
before returning. The Node adapter resolves that operation only after child
close; the browser adapter can only issue the non-awaitable
`Worker.terminate()` request. It is internal release-test orchestration, not a
public codec, evaluator, or worker API.

The owned ABI 0.9 process gate extends the evidence to fresh Node processes.
Producer A creates the asymmetric box and writes an artifact; consumer B reads
that detached artifact in another one-shot child, preserves the parent-owned
input, and reproduces the producer's artifact, capability, runtime-input, and
semantic evidence. A second fresh producer must produce identical bytes and
evidence. Before kernel creation, each child bounds and reads the supplied
canonical `metadata/release.json`, `occt-wasm.js`, and `occt-wasm.wasm` once.
The public Node attested loader checks the manifest against the independently
maintained reviewed SHA-256 pin, checks both runtime sizes and digests against
that trusted manifest, imports the verified JavaScript snapshot through one
process-global `node:module.register()` hook, and passes a fresh verified
WebAssembly copy as `wasmBinary`. No temporary executable JavaScript file is
created. A one-byte mutation to the manifest or either runtime file is rejected
before supplied JavaScript executes.

The parent uses a closed versioned request/start/result protocol with exact
request IDs and bounded request, stdout/stderr, result, and artifact files. A
pre-aborted signal starts no child. Once the child acknowledges operation
start, deadline or abort sends `SIGKILL` and the parent waits for exit before
settling. A deliberately non-yielding post-start stall proves that path; an
injected trap proves process discard, and a fresh consumer proves subsequent
recovery. Run this matrix with:

```bash
pnpm test:occt-artifact-process
```

The same one-shot process protocol has a repository-private evaluator
operation. Fresh owned-ABI-0.9 children run `Evaluator.evaluate(...)` over a
deterministic two-box Boolean union. Standard output must contain the exact
`operation-started` event followed by `kernel-operation-started` for the
evaluator-invoked Boolean before successful evidence. The second event is
emitted immediately before the real native call, so it proves entry rather than
completion. The wrapper emits a third exact `non-yielding-stall-started` event
only after that call returns and immediately before blocking. Timeout requires
that third event and abort waits for it, so both exercise the deliberate blocked
evaluator operation rather than an idle child or a pre-native race. Both send
`SIGKILL`, await child close, and are followed by a fresh evaluation whose
detached document hash, configuration, parameters, measurements, complete
topology counts, and runtime evidence exactly match the baseline. The parent
rejects an incomplete nonempty stdout event prefix; a runtime-attestation
failure before operation start legitimately produces no event.

Successful evaluator evidence is assembled from copied scalar data and written
only after the evaluated design and evaluator have been disposed. A
deliberately failing cleanup path must produce `CLEANUP_FAILED`, never
successful evidence. Forced termination is different: a killed child cannot
execute its language-level `finally` cleanup, so destruction of the entire
one-shot process is the containment and reclamation boundary.

Process protocol v3 also carries one evaluator-cache record through the parent
between fresh verified children. Two producer children independently evaluate a
fixed direct-output `2 × 3 × 5` box and must emit identical binary records and
detached evidence after `miss,write`, one native box construction, and observed
encode. A compatible read-only consumer must record `hit`, observe decode,
perform zero native box calls, and reproduce the producer's complete detached
measurements and topology. A consumer with another solver fingerprint derives a
different key, records `miss`, performs one native box call, and invokes neither
codec direction.

The parent-mediated record is one exact binary frame: an 8-byte versioned magic,
a little-endian 32-bit canonical-JSON header length capped at 32 KiB, then the
exact artifact payload. Fatal UTF-8, closed header fields, protocol/key/metadata
and integrity validation, request-specific byte ceilings, SHA-256, exact
payload length, and exact EOF are checked. The gate preserves caller-owned
input, rejects a changed payload, forged key/metadata, shared or hostile
typed-array input, and post-start abort, then proves recovery with another fresh
consumer. Its evidence names `trusted-parent-mediated-record` and explicitly
sets `recordIntegrityAuthenticated: false`; the digest detects corruption, not
an authorized parent's malicious substitution.

The verified facade-bundle gate invokes the same command against its packaged
runtime automatically. Every successful result records one-shot cleanup before
response, `shapeArtifactsAbsent: true`, and `certifiesCompatibility: false`.
It also records the exact runtime-pair identity and separate declared-build
identity while setting build-execution, publisher-authentication, and
compatibility claims to false. The verified JS/WASM snapshots are the loader
and kernel inputs, but this does not prove that the declared recipe ran, defend
the Node module-hook chain or host from same-process/same-UID interference, or
attest the wider application, library, wrapper, or JavaScript engine. The
injected trap is not a real OCCT trap fault injection. These gates do not
measure live or peak memory, establish durable native subshape identity, create
a reviewed cross-platform golden matrix, or expose a public/production
evaluator cache. Evaluator evidence also sets
`certifiesOperationalCancellation: false`.

Owned facade ABI 0.7 closes a specific, previously open part of the candidate
transport boundary:

- the native writer pins binary BREP format v4 with triangulation and normals
  disabled, serializes into report-owned fixed-size chunks, and enforces the
  caller's signed 32-bit output ceiling while writing. It exposes no partial
  bytes on overflow, and a successful report creates the detached JavaScript
  copy only after native serialization has completed within the cap. The
  TypeScript candidate passes the remaining total-envelope allowance to the
  writer and validates the report's limits and byte counts;
- the reader checks the borrowed `Uint8Array` byte length against its input cap
  before allocating one native snapshot of the admitted view. It requires the
  strict binary BREP v4 header, reads from that snapshot without another full
  transport copy, and requires exact input consumption, rejecting trailing
  bytes;
- after `BinTools::Read`, the reader counts the retained topology graph against
  a caller-supplied item ceiling before running full B-Rep validity analysis.
  This is a post-decode retention and analysis bound, not a pre-decode
  allocation bound; and
- write reports own their successful native byte chunks. Read reports own a
  successful decoded root outside the kernel arena until one same-kernel
  transfer; deleting an untaken report releases it. The TypeScript adapter
  validates every report echo and releases a transferred root if subsequent
  sidecar validation or adoption fails.

Owned facade ABI 0.8 retains those guarantees and adds a trailing signed-int
`maxNativeRequestedBytes` to both native calls. Private linker-wrapped allocator
entry points count admitted cumulative requested bytes and allocation calls.
Both reports echo the limit and expose `nativeRequestedBytes`,
`nativeAllocationCalls`, and `nativeRequestLimitExceeded`. Reviewed throwing C++
entry points return `NATIVE_REQUEST_LIMIT_EXCEEDED`; the admitted byte total
never exceeds the cap, while the call count includes the denied request. Direct
C allocator denials abort the affected WASM runtime instead of returning null to
unchecked OCCT callers, so callers must isolate candidate work and discard that
runtime after a trap. This is cumulative-request defense-in-depth, not
live/peak-memory accounting or hostile-input safety.

Owned facade ABI 0.9 retains ABI 0.8's fixed 128 MiB cumulative native request
budget and adds three reader-only limits: `1,000,000` structural work units,
`64` structural nesting levels, and location-power magnitude `1,000,000`.
After the admitted input's single snapshot, but before `BinTools::Read`, an
exact parser for the owned writer's BinTools-v4 profile checks canonical
sections and counts, finite geometry, spline degree/knot/multiplicity/pole
relationships, bounded count products, closed table and representation tags,
in-range references, and exact EOF. It also checks canonical elementary and
composite locations with backward references and bounded nonzero powers, then
the backward-only TShape child hierarchy, canonical root, nesting, and complete
record reachability.

The shared work counter meters table entries, nested geometry, products,
location terms, representations, expanded subshape occurrences, and
conservative squared aggregate geometry, representation, expanded-topology,
wire, and face validation envelopes. Global geometry-work squaring means the
`1,000,000` cap deliberately admits roughly fewer than `1,000` aggregate
geometry work units, with all other charges reducing that ceiling. This is a
private artifact-compatibility bound, not a core CAD authoring or modeling
limit. The parser's one bounded TShape metrics table is charged to the same
128 MiB cumulative native request budget.

Read reports echo every preflight limit and expose work used, maximum structural
depth and location-power magnitude, consumed bytes, the preflight code and
completion bit, and `deserializationStarted`, alongside native request and
allocation telemetry. A preflight rejection leaves that last field false and
cannot expose a native result. ABI 0.8 remains loadable without the three new
arguments or fields.

These tests prove bounded retained native output, a pre-snapshot input-byte
gate, pinned v4/no-triangulation serialization, exact archive consumption, a
post-read topology ceiling, and transactional report ownership for the reviewed
owned ABI 0.9 candidate path, deterministic request-limit reporting, and exact
structural rejection before OCCT deserialization for the owned writer profile.
They do not promote that path into a production codec. Owned ABI 0.8 retains
the native request quota without structural preflight; ABI 0.7 retains bounded
transport without the quota; stock OCCT and owned ABI 0.2 through 0.6 retain the
earlier unbounded research path; and no shipped backend advertises
`KernelCapabilities.shapeArtifacts`.

Binary sidecar v2 closes the former JSON-intermediate allocation blocker, and
ABI 0.9 closes the exact owned-profile BinTools grammar/count/product preflight
gap. Candidate format v3 additionally removes producer/consumer raw enumeration
order for its canonical unique classes and verifies the complete rooted
occurrence manifest. The hook remains candidate-only because:

- envelope, sidecar-v2, and identity-v1 section boundaries and EOF are exact,
  but stock `occt-wasm` accepts suffix bytes after a valid BREP archive;
  strict consumption inside the BREP section is guaranteed only by owned ABI
  0.7 and later, and stock canonical re-encoding may discard such a suffix;
- the 128 MiB budget measures cumulative requests, not live bytes, peak memory,
  or every physical WebAssembly-memory effect; the structural-work envelope is
  deliberately conservative but is not a live/peak-memory proof;
- the disposable gates now run real evaluator-invoked native operations, but
  only through repository-private one-shot realms. Ordinary public
  `Evaluator.evaluate(...)` remains same-thread and does not yield from
  synchronous WASM to an ordinary timer-driven `AbortSignal`; no public isolated
  evaluator API has been added;
- every serialized occurrence is checked for multiplicity, order, type,
  composed orientation, direct-child count, and canonical `IsSame` class.
  Compound/compsolid/generic nodes remain unindexed structural occurrences;
  stock `occt-wasm` cannot attest shared TShape ancestry across
  distinct-location classes because it does not expose `IsPartner`, and
  serialization-local paths do not persist across model edits or define
  assembly identity;
- the attested loader now verifies the exact owned JavaScript/WASM pair against
  an independently pinned canonical release manifest, and the candidate
  fingerprint binds that pair identity. The separate declared-build identity
  records source/toolchain metadata but does not prove the build execution or
  authenticate a publisher, host, wrapper, or wider application; and
- one owned fresh-process producer/consumer scenario plus one committed
  stock-runtime golden is not a reviewed cross-platform compatibility matrix.

Production promotion therefore still requires a public operational isolation
boundary wherever hard cancellation is promised, reviewed cross-platform
owned-runtime goldens, and expansion from the private direct-box cache slice to
a public diagnostic-preserving evaluator contract. Cross-edit topology and
persistent assembly identity remain separate protocols rather than v3 claims.
The private compatibility fingerprint now binds the exact native
WASM/JavaScript pair identity alongside versioned declarations for the adapter
contract, envelope-v3, sidecar-v2, identity-v1 first paths, the complete
occurrence-manifest schema, 12-byte record width, every identity resource
ceiling, relevant tolerance and serialization options, and other
result-changing inputs. Those declarations are compatibility fields, not
cryptographic hashes or attestation of the InvariantCAD wrapper/library code.
Build execution and publisher provenance likewise remain explicit non-claims
rather than compatibility identities.

ABI 0.7 resolves the candidate's former full-output-materialization and
successful-result ownership gaps, ABI 0.8 adds a private cumulative-request
quota, sidecar v2 resolves the JSON materialization gap, and ABI 0.9 adds exact
owned-profile native archive preflight plus structural-work limits. Candidate
v3 adds canonical unique-class paths, complete occurrence-manifest verification,
and raw-order remapping. The new disposable gates add forced-realm containment
around real evaluator work, fresh recovery, and a bounded owned-process handoff.
A killed realm cannot perform language-level cleanup; realm destruction is the
containment mechanism. The attested loader additionally closes exact owned runtime-pair and
declared-manifest identity under an independent pin. None of these controls
provides live/peak-memory proof, hard cancellation in the public evaluator,
operational-cancellation or compatibility certification, public
compound/compsolid identity classes, distinct-location `IsPartner`/shared-TShape
proof, cross-edit topology persistence, persistent assembly identity,
authenticated build execution or publisher provenance, wider host/application
attestation, or a reviewed cross-platform compatibility proof.
Advertising an ordinary native exchange function under the stronger
shape-artifact capability would therefore remain incorrect, even when it can
reconstruct a geometrically valid solid.
