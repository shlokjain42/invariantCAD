import { describe, expect, it } from "vitest";
import { parseOcctArtifactProcessResult } from "../scripts/occt-artifact-process-protocol.js";

const RELEASE_MANIFEST_SHA256 = "a".repeat(64);
const RUNTIME_PAIR_SHA256 = "b".repeat(64);

function validResult(): Record<string, unknown> {
  return {
    protocolVersion: 1,
    requestId: "c".repeat(32),
    operation: "produce",
    ok: true,
    evidence: {
      kind: "invariantcad-private-occt-artifact-process-evidence",
      evidenceVersion: 1,
      operation: "produce",
      executionBoundary: "one-shot-node-child-process",
      advertisement: "unadvertised",
      shapeArtifactsAbsent: true,
      certifiesCompatibility: false,
      runtime: {
        releaseManifest: "metadata/release.json",
        releaseManifestSha256: RELEASE_MANIFEST_SHA256,
        runtimePairIdentity:
          `invariantcad-occt-runtime-pair@1:sha256:${RUNTIME_PAIR_SHA256}`,
        declaredBuildIdentity:
          `invariantcad-occt-release-manifest@1:sha256:${RELEASE_MANIFEST_SHA256}`,
        facadeMarker: "invariantcad-facade@0.9.0+occt-wasm.3.7.0",
        javascript: {
          fileName: "occt-wasm.js",
          byteLength: 1,
          sha256: "d".repeat(64),
        },
        webAssembly: {
          fileName: "occt-wasm.wasm",
          byteLength: 1,
          sha256: "e".repeat(64),
        },
        verifiedBytesWereExecutionInputs: true,
        buildExecutionObserved: false,
        buildExecutionAuthenticated: false,
        publisherAuthenticated: false,
      },
      capabilities: {
        protocolVersion: 1,
        format: "org.invariantcad.occt-shape-candidate",
        formatVersion: 2,
        compatibilityFingerprint:
          "invariantcad-occt-shape-candidate@2;runtimeAttestation=test",
      },
      artifact: {
        byteLength: 1,
        sha256: "f".repeat(64),
      },
      semanticWitness:
        `invariantcad:kernel-shape-semantic:v1:sha256:${"1".repeat(64)}`,
      cleanupCompletedBeforeResponse: true,
    },
  };
}

describe("OCCT artifact-process attestation evidence", () => {
  it("accepts a declared-build identity derived from the release-manifest digest", () => {
    const parsed = parseOcctArtifactProcessResult(validResult());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("Expected successful process evidence");
    expect(parsed.evidence.runtime.declaredBuildIdentity).toBe(
      `invariantcad-occt-release-manifest@1:sha256:${RELEASE_MANIFEST_SHA256}`,
    );
  });

  it("rejects a well-formed declared-build identity for another manifest", () => {
    const result = validResult();
    const evidence = result.evidence as Record<string, unknown>;
    const runtime = evidence.runtime as Record<string, unknown>;
    runtime.declaredBuildIdentity =
      `invariantcad-occt-release-manifest@1:sha256:${"2".repeat(64)}`;

    expect(() => parseOcctArtifactProcessResult(result)).toThrow(
      "OCCT artifact process runtime evidence is malformed",
    );
  });
});
