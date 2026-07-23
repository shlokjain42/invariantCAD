import { describe, expect, it } from "vitest";
import {
  OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
  encodeOcctEvaluatorKernelOperationStartEvent,
  encodeOcctEvaluatorNonYieldingStallStartEvent,
  parseOcctArtifactProcessResult,
  parseOcctEvaluatorKernelOperationStartEvent,
  parseOcctEvaluatorNonYieldingStallStartEvent,
} from "../scripts/occt-artifact-process-protocol.js";

const RELEASE_MANIFEST_SHA256 = "a".repeat(64);
const RUNTIME_PAIR_SHA256 = "b".repeat(64);

function validRuntimeEvidence(): Record<string, unknown> {
  return {
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
  };
}

function validArtifactResult(): Record<string, unknown> {
  return {
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
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
      runtime: validRuntimeEvidence(),
      capabilities: {
        protocolVersion: 1,
        format: "org.invariantcad.occt-shape-candidate",
        formatVersion: 3,
        compatibilityFingerprint:
          "invariantcad-occt-shape-candidate@3;runtimeAttestation=test",
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

function validEvaluatorResult(): Record<string, unknown> {
  return {
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
    requestId: "c".repeat(32),
    operation: "evaluate",
    ok: true,
    evidence: {
      kind: "invariantcad-private-occt-evaluator-process-evidence",
      evidenceVersion: 1,
      operation: "evaluate",
      executionBoundary: "one-shot-node-child-process",
      evaluatorPath: "Evaluator.evaluate",
      fixture: "owned-occt-evaluator-isolation-v1",
      documentSha256: "2".repeat(64),
      configurationId: null,
      parameters: {},
      output: {
        name: "result",
        kind: "solid",
        measurements: {
          volume: 9_750,
          surfaceArea: 3_050,
          centerOfMass: [7.5, 12.5, 15],
          inertiaTensor: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
          boundingBox: {
            min: [0, 0, 0],
            max: [15, 25, 30],
          },
          genus: 0,
          tolerance: 1e-7,
        },
        topology: {
          history: "complete",
          faces: 10,
          edges: 24,
          vertices: 16,
        },
      },
      evaluatorKernelOperation: "boolean",
      evaluatorKernelOperationObserved: true,
      runtime: validRuntimeEvidence(),
      shapeArtifactsAbsent: true,
      ordinaryEvaluatorRemainsCooperative: true,
      certifiesOperationalCancellation: false,
      certifiesCompatibility: false,
      cleanupCompletedBeforeResponse: true,
    },
  };
}

function validEvaluatorCacheResult(
  outcome: "cold-write" | "warm-hit" | "incompatible-miss",
): Record<string, unknown> {
  const operation =
    outcome === "cold-write" ? "cache-produce" : "cache-consume";
  const cache =
    outcome === "cold-write"
      ? {
          mode: "read-write",
          events: ["miss", "write"],
          nativeBoxCalls: 1,
          artifactEncodeObserved: true,
          artifactDecodeObserved: false,
        }
      : outcome === "warm-hit"
        ? {
            mode: "read-only",
            events: ["hit"],
            nativeBoxCalls: 0,
            artifactEncodeObserved: false,
            artifactDecodeObserved: true,
          }
        : {
            mode: "read-only",
            events: ["miss"],
            nativeBoxCalls: 1,
            artifactEncodeObserved: false,
            artifactDecodeObserved: false,
          };
  return {
    protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
    requestId: "c".repeat(32),
    operation,
    ok: true,
    evidence: {
      kind: "invariantcad-private-occt-evaluator-cache-process-evidence",
      evidenceVersion: 1,
      operation,
      executionBoundary: "one-shot-node-child-process",
      evaluatorPath: "Evaluator.evaluate",
      fixture: "owned-occt-evaluator-cache-box-v1",
      feature: "cache-box",
      documentSha256: "3".repeat(64),
      configurationId: null,
      parameters: {},
      solverFingerprint:
        "invariantcad.reference-sketch-solver.process-cache@1",
      output: {
        name: "result",
        kind: "solid",
        measurements: {
          volume: 30,
          surfaceArea: 62,
          centerOfMass: [1, 1.5, 2.5],
          inertiaTensor: [
            [85, 0, 0],
            [0, 72.5, 0],
            [0, 0, 32.5],
          ],
          boundingBox: {
            min: [0, 0, 0],
            max: [2, 3, 5],
          },
          genus: 0,
          tolerance: 1e-7,
        },
        topology: {
          history: "complete",
          faces: 6,
          edges: 12,
          vertices: 8,
        },
      },
      cache: {
        ...cache,
        key: `invariantcad:kernel-shape:v1:sha256:${"4".repeat(64)}`,
        outcome,
        record: {
          byteLength: 100,
          sha256: "5".repeat(64),
        },
      },
      runtime: validRuntimeEvidence(),
      capabilities: {
        protocolVersion: 1,
        format: "org.invariantcad.occt-shape-candidate",
        formatVersion: 3,
        compatibilityFingerprint:
          "invariantcad-occt-shape-candidate@3;runtimeAttestation=test",
      },
      advertisement: "unadvertised",
      shapeArtifactsAbsent: true,
      privateCandidateOnly: true,
      trustedStoreBoundary: "trusted-parent-mediated-record",
      recordIntegrityAuthenticated: false,
      certifiesCompatibility: false,
      certifiesOperationalCancellation: false,
      cleanupCompletedBeforeResponse: true,
    },
  };
}

describe("OCCT artifact-process attestation evidence", () => {
  it("accepts a declared-build identity derived from the release-manifest digest", () => {
    const parsed = parseOcctArtifactProcessResult(validArtifactResult());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.operation !== "produce") {
      throw new Error("Expected successful artifact-process evidence");
    }
    expect(parsed.evidence.runtime.declaredBuildIdentity).toBe(
      `invariantcad-occt-release-manifest@1:sha256:${RELEASE_MANIFEST_SHA256}`,
    );
  });

  it("rejects a well-formed declared-build identity for another manifest", () => {
    const result = validArtifactResult();
    const evidence = result.evidence as Record<string, unknown>;
    const runtime = evidence.runtime as Record<string, unknown>;
    runtime.declaredBuildIdentity =
      `invariantcad-occt-release-manifest@1:sha256:${"2".repeat(64)}`;

    expect(() => parseOcctArtifactProcessResult(result)).toThrow(
      "OCCT artifact process runtime evidence is malformed",
    );
  });
});

describe("OCCT evaluator-process evidence", () => {
  it("accepts and deeply detaches the closed successful projection", () => {
    const source = validEvaluatorResult();
    const parsed = parseOcctArtifactProcessResult(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.operation !== "evaluate") {
      throw new Error("Expected successful evaluator-process evidence");
    }

    expect(parsed.evidence).toMatchObject({
      evaluatorPath: "Evaluator.evaluate",
      evaluatorKernelOperationObserved: true,
      ordinaryEvaluatorRemainsCooperative: true,
      certifiesOperationalCancellation: false,
      cleanupCompletedBeforeResponse: true,
    });
    expect(Object.isFrozen(parsed.evidence)).toBe(true);
    expect(Object.isFrozen(parsed.evidence.output)).toBe(true);
    expect(Object.isFrozen(parsed.evidence.output.measurements)).toBe(true);
    expect(
      Object.isFrozen(parsed.evidence.output.measurements.inertiaTensor[0]),
    ).toBe(true);

    const sourceEvidence = source.evidence as Record<string, unknown>;
    const sourceOutput = sourceEvidence.output as Record<string, unknown>;
    const sourceMeasurements = sourceOutput.measurements as Record<
      string,
      unknown
    >;
    (sourceMeasurements.centerOfMass as number[])[0] = 999;
    expect(parsed.evidence.output.measurements.centerOfMass).toEqual([
      7.5,
      12.5,
      15,
    ]);
  });

  it.each([
    ["extra evidence field", (evidence: Record<string, unknown>) => {
      evidence.unexpected = true;
    }],
    ["non-finite measurement", (evidence: Record<string, unknown>) => {
      const output = evidence.output as Record<string, unknown>;
      const measurements = output.measurements as Record<string, unknown>;
      measurements.volume = Number.POSITIVE_INFINITY;
    }],
    ["negative topology count", (evidence: Record<string, unknown>) => {
      const output = evidence.output as Record<string, unknown>;
      const topology = output.topology as Record<string, unknown>;
      topology.faces = -1;
    }],
    ["unexpected compatibility claim", (evidence: Record<string, unknown>) => {
      evidence.certifiesOperationalCancellation = true;
    }],
  ])("rejects %s", (_label, mutate) => {
    const result = validEvaluatorResult();
    mutate(result.evidence as Record<string, unknown>);
    expect(() => parseOcctArtifactProcessResult(result)).toThrow(
      /OCCT evaluator process .*malformed/,
    );
  });

  it("rejects an evaluator evidence envelope under an artifact operation", () => {
    const result = validEvaluatorResult();
    result.operation = "produce";
    expect(() => parseOcctArtifactProcessResult(result)).toThrow(
      "OCCT artifact process evidence is malformed",
    );
  });

  it.each([
    "evaluate",
    "stall-during-evaluate",
    "fail-cleanup-during-evaluate",
  ] as const)(
    "round-trips only the exact %s kernel-operation start event",
    (operation) => {
      const requestId = "c".repeat(32);
      const encoded = encodeOcctEvaluatorKernelOperationStartEvent(
        requestId,
        operation,
        "result",
      );
      const parsed = parseOcctEvaluatorKernelOperationStartEvent(
        JSON.parse(encoded) as unknown,
      );
      expect(parsed).toEqual({
        protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
        requestId,
        event: "kernel-operation-started",
        operation,
        feature: "result",
        kernelOperation: "boolean",
      });

      expect(() =>
        parseOcctEvaluatorKernelOperationStartEvent({
          ...parsed,
          extra: true,
        }),
      ).toThrow("OCCT evaluator kernel-operation start event is malformed");
    },
  );

  it("round-trips only the exact post-native non-yielding-stall event", () => {
    const requestId = "c".repeat(32);
    const encoded = encodeOcctEvaluatorNonYieldingStallStartEvent(
      requestId,
      "result",
    );
    const parsed = parseOcctEvaluatorNonYieldingStallStartEvent(
      JSON.parse(encoded) as unknown,
    );
    expect(parsed).toEqual({
      protocolVersion: OCCT_ARTIFACT_PROCESS_PROTOCOL_VERSION,
      requestId,
      event: "non-yielding-stall-started",
      operation: "stall-during-evaluate",
      feature: "result",
      kernelOperation: "boolean",
    });

    expect(() =>
      parseOcctEvaluatorNonYieldingStallStartEvent({
        ...parsed,
        operation: "evaluate",
      }),
    ).toThrow(
      "OCCT evaluator non-yielding-stall start event is malformed",
    );
  });
});

describe("OCCT evaluator-cache process evidence", () => {
  it.each([
    ["cold-write", "cache-produce"],
    ["warm-hit", "cache-consume"],
    ["incompatible-miss", "cache-consume"],
  ] as const)("accepts and deeply detaches %s evidence", (outcome, operation) => {
    const source = validEvaluatorCacheResult(outcome);
    const parsed = parseOcctArtifactProcessResult(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.operation !== operation) {
      throw new Error("Expected successful evaluator-cache evidence");
    }
    expect(parsed.evidence.cache.outcome).toBe(outcome);
    expect(Object.isFrozen(parsed.evidence)).toBe(true);
    expect(Object.isFrozen(parsed.evidence.cache)).toBe(true);
    expect(Object.isFrozen(parsed.evidence.cache.events)).toBe(true);
    expect(Object.isFrozen(parsed.evidence.output.measurements)).toBe(true);

    const sourceEvidence = source.evidence as Record<string, unknown>;
    const sourceCache = sourceEvidence.cache as Record<string, unknown>;
    (sourceCache.events as string[])[0] = "write";
    expect(parsed.evidence.cache.events[0]).not.toBe("write");
  });

  it.each([
    ["extra cache field", (evidence: Record<string, unknown>) => {
      const cache = evidence.cache as Record<string, unknown>;
      cache.unexpected = true;
    }],
    ["invalid cache key", (evidence: Record<string, unknown>) => {
      const cache = evidence.cache as Record<string, unknown>;
      cache.key = "not-a-cache-key";
    }],
    ["reordered cold events", (evidence: Record<string, unknown>) => {
      const cache = evidence.cache as Record<string, unknown>;
      cache.events = ["write", "miss"];
    }],
    ["sparse cold events", (evidence: Record<string, unknown>) => {
      const cache = evidence.cache as Record<string, unknown>;
      const events = new Array<string>(2);
      events[1] = "write";
      cache.events = events;
    }],
    ["lone-surrogate solver fingerprint", (evidence: Record<string, unknown>) => {
      evidence.solverFingerprint = "solver-\ud800";
    }],
    ["authenticated-integrity claim", (evidence: Record<string, unknown>) => {
      evidence.recordIntegrityAuthenticated = true;
    }],
  ])("rejects %s", (_label, mutate) => {
    const result = validEvaluatorCacheResult("cold-write");
    mutate(result.evidence as Record<string, unknown>);
    expect(() => parseOcctArtifactProcessResult(result)).toThrow(
      /OCCT evaluator-cache process .*malformed|outcome evidence is inconsistent/,
    );
  });

  it("rejects a warm outcome under cache-produce", () => {
    const result = validEvaluatorCacheResult("warm-hit");
    result.operation = "cache-produce";
    const evidence = result.evidence as Record<string, unknown>;
    evidence.operation = "cache-produce";
    expect(() => parseOcctArtifactProcessResult(result)).toThrow(
      "OCCT evaluator-cache process outcome evidence is inconsistent",
    );
  });
});
