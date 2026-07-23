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
