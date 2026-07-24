import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { inspectKernelShapeArtifactSupport } from "../src/artifact-cache.js";
import {
  auditKernelShapeArtifactCodec,
  hashKernelShapeArtifactFixtureWitness,
  hashKernelShapeSemanticObservation,
  type KernelShapeArtifactFixtureWitness,
  type KernelShapeArtifactSemanticWitness,
  type KernelShapeArtifactWitness,
} from "../src/conformance.js";
import { getOcctShapeArtifactCodecCandidate } from "../src/internal/occt-artifact-candidate.js";
import type { GeometryKernel } from "../src/kernel.js";
import { createOcctKernel } from "../src/occt-kernel.js";
import {
  observeKernelShapeSemantics,
  type KernelShapeSemanticNotApplicableFeature,
  type KernelShapeSemanticObservationPlan,
} from "../src/shape-semantic-observation.js";

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const GOLDEN_BYTES = 13_735;
const GOLDEN_FIXTURE_URL = new URL(
  "./fixtures/occt-shape-candidate-v3-asymmetric-box.b64",
  import.meta.url,
);
const LEGACY_V2_BYTES = 11_591;
const LEGACY_V2_FIXTURE_URL = new URL(
  "./fixtures/occt-shape-candidate-v2-asymmetric-box.b64",
  import.meta.url,
);
const LEGACY_V1_BYTES = 18_043;
const LEGACY_V1_FIXTURE_URL = new URL(
  "./fixtures/occt-shape-candidate-v1-asymmetric-box.b64",
  import.meta.url,
);

const EXPECTED_SEMANTIC =
  "invariantcad:kernel-shape-semantic:v1:sha256:40ae684e4a2fad512f54e1f1be4443acf7faf2f34fc6b281c7b816d8d3366cb2" as const satisfies KernelShapeArtifactSemanticWitness;
const EXPECTED_FIXTURE =
  "invariantcad:kernel-shape-artifact-fixture:v1:sha256:4279e9f76ab1e41dae47b28aea9c426ffa8b5f329ab624f137c65f6881e23918" as const satisfies KernelShapeArtifactFixtureWitness;
const EXPECTED_LEGACY_V2_FIXTURE =
  "invariantcad:kernel-shape-artifact-fixture:v1:sha256:221d1ea2265a26df1293e63d625d25e85eb8a86041bdea53a927269427e3d16a" as const satisfies KernelShapeArtifactFixtureWitness;
const EXPECTED_LEGACY_V1_FIXTURE =
  "invariantcad:kernel-shape-artifact-fixture:v1:sha256:42587aed42fcc554d15c4259ae00480c9a16a5c94531ee9af67a6b949744251f" as const satisfies KernelShapeArtifactFixtureWitness;
const EXPECTED_FINGERPRINT =
  "invariantcad-occt-shape-candidate@3;occt-wasm@3.8.0;runtime=stock;modelingTolerance=f64:3e7ad7f29abcaf48;linearDeflection=default;angularDeflection=default;relative=default;maxExactBooleanHistoryRecords=1000000;maxExactEdgeTreatmentHistoryRecords=1000000;maxExactSolidOffsetHistoryRecords=1000000;features=extrude,revolve,loft,sweep,circularArcSweep,compositeSweep,boolean,transform,fillet,chamfer,shell,offset;nativeArchive=occt-brep-binary;topologySidecar=bounded-binary-artifact-local-index-v2;nativeIdentity=serialized-first-issame-child-path-v1;nativeOccurrenceManifest=complete-rooted-preorder-type-orientation-child-count-issame-class-v1;nativeOccurrenceRecordBytes=12;nativeIdentityMaxPaths=100000;nativeIdentityMaxPathComponents=1000000;nativeIdentityMaxPathDepth=64;nativeIdentityMaxChildIndex=999999;nativeIdentityMaxOccurrences=100000;nativeIdentityTraversalOccurrences=100000;nativeIdentityComparisons=1000000;nativeStructure=artifact-path-type-orientation-v2;nativeMaterialization=unbounded-candidate-only";

/**
 * This inventory is intentionally literal. A change to the stock OCCT feature
 * surface must fail this release fixture until the exclusion is reviewed.
 */
const NOT_APPLICABLE_FEATURES: readonly KernelShapeSemanticNotApplicableFeature[] =
  Object.freeze([
    {
      feature: "extrude",
      reason:
        "Direct candidate artifact restoration fixture; downstream extrude behavior is outside this bounded case.",
    },
    {
      feature: "revolve",
      reason:
        "Direct candidate artifact restoration fixture; downstream revolve behavior is outside this bounded case.",
    },
    {
      feature: "loft",
      reason:
        "Direct candidate artifact restoration fixture; downstream loft behavior is outside this bounded case.",
    },
    {
      feature: "sweep",
      reason:
        "Direct candidate artifact restoration fixture; downstream sweep behavior is outside this bounded case.",
    },
    {
      feature: "circularArcSweep",
      reason:
        "Direct candidate artifact restoration fixture; downstream circular-arc sweep behavior is outside this bounded case.",
    },
    {
      feature: "compositeSweep",
      reason:
        "Direct candidate artifact restoration fixture; downstream composite sweep behavior is outside this bounded case.",
    },
    {
      feature: "boolean",
      reason:
        "Direct candidate artifact restoration fixture; downstream Boolean behavior is outside this bounded case.",
    },
    {
      feature: "transform",
      reason:
        "Direct candidate artifact restoration fixture; downstream transform behavior is outside this bounded case.",
    },
    {
      feature: "fillet",
      reason:
        "Direct candidate artifact restoration fixture; downstream fillet behavior is outside this bounded case.",
    },
    {
      feature: "chamfer",
      reason:
        "Direct candidate artifact restoration fixture; downstream chamfer behavior is outside this bounded case.",
    },
    {
      feature: "shell",
      reason:
        "Direct candidate artifact restoration fixture; downstream shell behavior is outside this bounded case.",
    },
    {
      feature: "offset",
      reason:
        "Direct candidate artifact restoration fixture; downstream offset behavior is outside this bounded case.",
    },
  ]);

const OBSERVATION_PLAN: KernelShapeSemanticObservationPlan = Object.freeze({
  id: "occt-shape-artifact-candidate-release-v1",
  meshes: Object.freeze([{ id: "default" }]),
  topology: "required",
  nativeExchanges: Object.freeze([]),
  probes: Object.freeze([]),
  notApplicableFeatures: NOT_APPLICABLE_FEATURES,
});

const witness: KernelShapeArtifactWitness = async (
  kernel,
  shape,
  context,
) => {
  const observation = await observeKernelShapeSemantics(
    kernel,
    shape,
    OBSERVATION_PLAN,
    {
      limits: { maxObservationBytes: context.maxBytes },
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    },
  );
  if (!observation.ok) return observation;
  return hashKernelShapeSemanticObservation(observation.value, {
    maxBytes: context.maxBytes,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  });
};

async function fixtureBytes(
  url: URL,
  expectedBytes: number,
): Promise<Uint8Array> {
  const text = await readFile(url, "utf8");
  const encoded = text.replaceAll(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new TypeError("OCCT candidate golden fixture is not canonical base64");
  }
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  if (
    bytes.byteLength !== expectedBytes ||
    Buffer.from(bytes).toString("base64") !== encoded
  ) {
    throw new TypeError("OCCT candidate golden fixture has an invalid length or encoding");
  }
  return bytes;
}

async function goldenArtifact(): Promise<Uint8Array> {
  return fixtureBytes(GOLDEN_FIXTURE_URL, GOLDEN_BYTES);
}

async function candidateTarget(): Promise<{
  readonly kernel: GeometryKernel;
  readonly codec: NonNullable<
    ReturnType<typeof getOcctShapeArtifactCodecCandidate>
  >;
}> {
  const kernel = await createOcctKernel();
  const codec = getOcctShapeArtifactCodecCandidate(kernel);
  if (codec === undefined) {
    kernel.dispose();
    throw new Error("The stock OCCT candidate codec is unavailable");
  }
  return { kernel, codec };
}

describe("OCCT candidate shape-artifact conformance gate", () => {
  it("retains the private v1/v2 fixtures only as an explicit fail-closed corpus", async () => {
    const kernel = await createOcctKernel();
    try {
      const candidate = getOcctShapeArtifactCodecCandidate(kernel);
      expect(candidate).toBeDefined();
      if (candidate === undefined) return;
      const liveShapes = (
        kernel as unknown as { readonly liveShapes: Set<unknown> }
      ).liveShapes;
      expect(liveShapes.size).toBe(0);
      for (const [version, url, bytes, expectedWitness] of [
        [1, LEGACY_V1_FIXTURE_URL, LEGACY_V1_BYTES, EXPECTED_LEGACY_V1_FIXTURE],
        [2, LEGACY_V2_FIXTURE_URL, LEGACY_V2_BYTES, EXPECTED_LEGACY_V2_FIXTURE],
      ] as const) {
        const legacy = await fixtureBytes(url, bytes);
        const legacyWitness = await hashKernelShapeArtifactFixtureWitness(
          legacy,
          { maxBytes: MAX_ARTIFACT_BYTES },
        );
        expect(legacyWitness.ok).toBe(true);
        if (!legacyWitness.ok) continue;
        expect(legacyWitness.value).toBe(expectedWitness);
        expect(() =>
          candidate.decodeShapeArtifact(legacy, {
            feature: `legacy-v${version}-negative-corpus`,
            maxArtifactBytes: MAX_ARTIFACT_BYTES,
          }),
        ).toThrow(/header/);
        expect(liveShapes.size).toBe(0);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("passes the pinned self-round-trip and golden-decode corpus without certifying production", async () => {
    const production = await createOcctKernel();
    try {
      expect(inspectKernelShapeArtifactSupport(production)).toEqual({
        status: "absent",
      });
      expect(production.capabilities.shapeArtifacts).toBeUndefined();
      expect(production.encodeShapeArtifact).toBeUndefined();
      expect(production.decodeShapeArtifact).toBeUndefined();
    } finally {
      production.dispose();
    }

    const golden = await goldenArtifact();
    const result = await auditKernelShapeArtifactCodec({
      target: {
        mode: "candidate",
        create: candidateTarget,
      },
      expectedIdentity: {
        kernelId: "occt",
        artifact: {
          protocolVersion: 1,
          format: "org.invariantcad.occt-shape-candidate",
          formatVersion: 3,
          compatibilityFingerprint: EXPECTED_FINGERPRINT,
        },
      },
      cases: [
        {
          id: "occt-asymmetric-role-box-self-v3",
          feature: "fixture.asymmetric-role-box",
          scope: "current-runtime-self-round-trip",
          expectedWitness: EXPECTED_SEMANTIC,
          createSource: (kernel, context) => {
            if (context.signal?.aborted === true) {
              throw new DOMException("Fixture creation aborted", "AbortError");
            }
            if (kernel.box === undefined) {
              throw new Error("The stock OCCT box primitive is unavailable");
            }
            // No status, measurement, mesh, topology, or witness observation:
            // the audit's dedicated pre-witness branch encodes this cold shape.
            return kernel.box([2, 3, 5], false, {
              feature: "fixture.asymmetric-role-box",
            });
          },
          witness,
        },
        {
          id: "occt-asymmetric-role-box-golden-v3",
          feature: "fixture.asymmetric-role-box",
          scope: "golden-decode",
          artifact: golden,
          expectedArtifactWitness: EXPECTED_FIXTURE,
          expectedWitness: EXPECTED_SEMANTIC,
          witness,
        },
      ],
      limits: {
        maxArtifactBytes: MAX_ARTIFACT_BYTES,
      },
    });

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      kind: "kernel-shape-artifact-codec-audit-evidence",
      mode: "candidate",
      advertisement: "unadvertised",
      certifiesCompatibility: false,
      scopes: ["current-runtime-self-round-trip", "golden-decode"],
      expectedIdentity: {
        kernelId: "occt",
        artifact: {
          protocolVersion: 1,
          format: "org.invariantcad.occt-shape-candidate",
          formatVersion: 3,
          compatibilityFingerprint: EXPECTED_FINGERPRINT,
        },
      },
      usage: { cases: 2 },
    });
    expect(result.value.disclaimer).toContain("not certification");
    expect(result.value.cases.map((item) => item.scope)).toEqual([
      "golden-decode",
      "current-runtime-self-round-trip",
    ]);
    expect(result.value.cases[0]?.checks).toContain("golden-artifact-witness");
    expect(result.value.cases[1]?.checks).toContain(
      "pre-witness-source-cross-instance-decode",
    );
  }, 60_000);
});
