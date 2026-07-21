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
  hashKernelShapeArtifactSemanticWitness,
  type KernelShapeArtifactCodecCandidate,
  type KernelShapeArtifactFixtureWitness,
  type KernelShapeArtifactSemanticWitness,
} from "invariantcad/conformance";

declare function createDevelopmentKernel(): Promise<GeometryKernel>;
declare function candidateCodecFor(
  kernel: GeometryKernel,
): KernelShapeArtifactCodecCandidate;
declare function createFixtureShape(kernel: GeometryKernel): KernelShape;
declare function canonicalShapeObservation(
  kernel: GeometryKernel,
  shape: KernelShape,
): string;
declare const goldenBytes: Uint8Array;
declare const expectedSemantic: KernelShapeArtifactSemanticWitness;
declare const expectedGolden: KernelShapeArtifactFixtureWitness;

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
      witness: (kernel, shape, context) =>
        hashKernelShapeArtifactSemanticWitness(
          canonicalShapeObservation(kernel, shape),
          {
            maxBytes: context.maxBytes,
            ...(context.signal === undefined
              ? {}
              : { signal: context.signal }),
          },
        ),
    },
    {
      id: "asymmetric-box-golden-v1",
      feature: "fixture.asymmetric-box",
      scope: "golden-decode",
      artifact: goldenBytes,
      expectedArtifactWitness: expectedGolden,
      expectedWitness: expectedSemantic,
      witness: (kernel, shape, context) =>
        hashKernelShapeArtifactSemanticWitness(
          canonicalShapeObservation(kernel, shape),
          {
            maxBytes: context.maxBytes,
            ...(context.signal === undefined
              ? {}
              : { signal: context.signal }),
          },
        ),
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
case IDs, rather than witness digests, must be unique. The caller supplies a
canonical semantic observation through the case's witness callback and should
use `hashKernelShapeArtifactSemanticWitness(...)` to hash its bounded bytes.
The audit creates each source shape through the case factory, calls that witness,
encodes it, decodes it on a separate current kernel instance, and repeatedly
exact-compares the returned digest. Multiple cases may deliberately share one
witness when they represent the same expected semantics.

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

## What the audit compares

The audit itself checks the shape's kernel tag, live `status`, repeated digest,
and ownership behavior. The caller-defined witness determines all richer
semantic coverage. A release witness should observe measurements, deterministic
mesh projections, detached key-neutral topology semantics, applicable native
format round trips, and feature-specific downstream behavior. For topology it
should normalize fresh evaluation-scoped keys while retaining stable geometry,
history mode, roles and sources, lineage, and adjacency evidence. A constant or
incomplete witness can allow a lossy codec to pass this finite audit and is not
acceptable release evidence.

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

For OCCT, ordinary STEP or BREP exchange reconstructs geometry but does not
round-trip the wrapper-level semantic lineage, complete/partial history state,
topology annotations, analytic volume overrides, cached evaluator state, and
other observable data attached to an InvariantCAD shape. Current topology keys
and native subshape indices are evaluation-scoped; a codec needs a stable format
that restores fresh face, edge, and vertex identities together with their
key-neutral semantic evidence rather than persisting those ephemeral keys.

A production codec must also bound native serialization before materializing an
oversized payload, support prompt cancellation during native work, clean up
partially created native objects, detach returned bytes, borrow decode input,
and prove exact cross-process restoration through committed goldens. Its
compatibility fingerprint must pin the native binary/WASM build, wrapper and
format revisions, relevant tolerance and option semantics, and any other input
that can change the result.

Those serialization, cancellation, ownership, stable-subshape restoration, and
fingerprint requirements remain open backend work. Advertising an ordinary
native exchange function under the stronger shape-artifact capability would
therefore be incorrect, even when it can reconstruct a geometrically valid
solid.
