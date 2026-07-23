import { getOcctShapeArtifactCodecCandidate } from "../../src/internal/occt-artifact-candidate.js";
import type { KernelShape } from "../../src/kernel.js";
import { createOcctKernel } from "../../src/occt-kernel.js";

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const FIXTURE_FEATURE = "fixture.asymmetric-role-box";

export interface ArtifactWorkerEvidence {
  readonly volume: number;
  readonly faces: number;
  readonly edges: number;
  readonly vertices: number;
  readonly protocolVersion: number;
  readonly format: string;
  readonly formatVersion: number;
  readonly compatibilityFingerprint: string;
  readonly inputBytesPreserved: true;
}

export type ArtifactWorkerRequest =
  | {
      readonly kind: "decode";
      readonly artifact: ArrayBuffer;
    }
  | {
      readonly kind: "hang";
    };

export type ArtifactWorkerResponse =
  | {
      readonly kind: "started";
      readonly operation: ArtifactWorkerRequest["kind"];
    }
  | {
      readonly kind: "success";
      readonly evidence: ArtifactWorkerEvidence;
    }
  | {
      readonly kind: "failure";
      readonly error: {
        readonly name: string;
        readonly message: string;
      };
    };

interface ArtifactWorkerScope {
  onmessage:
    | ((event: MessageEvent<ArtifactWorkerRequest>) => void)
    | null;
  postMessage(message: ArtifactWorkerResponse): void;
}

const scope = globalThis as unknown as ArtifactWorkerScope;

function errorEvidence(error: unknown): {
  readonly name: string;
  readonly message: string;
} {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

async function decodeArtifact(
  artifact: ArrayBuffer,
): Promise<ArtifactWorkerEvidence> {
  const input = new Uint8Array(artifact);
  const inputSnapshot = input.slice();
  const kernel = await createOcctKernel();
  let decoded: KernelShape | undefined;
  try {
    if (
      kernel.capabilities.shapeArtifacts !== undefined ||
      kernel.encodeShapeArtifact !== undefined ||
      kernel.decodeShapeArtifact !== undefined
    ) {
      throw new Error(
        "Stock OCCT must not advertise the private shape-artifact candidate",
      );
    }
    const candidate = getOcctShapeArtifactCodecCandidate(kernel);
    if (candidate === undefined) {
      throw new Error("Stock OCCT artifact candidate is unavailable");
    }
    decoded = await candidate.decodeShapeArtifact(input, {
      feature: FIXTURE_FEATURE,
      maxArtifactBytes: MAX_ARTIFACT_BYTES,
    });
    if (
      input.byteLength !== inputSnapshot.byteLength ||
      !input.every((byte, index) => byte === inputSnapshot[index])
    ) {
      throw new Error("OCCT artifact decode mutated its borrowed input");
    }
    if (kernel.topology === undefined) {
      throw new Error("Stock OCCT topology is unavailable");
    }
    const measurements = kernel.measure(decoded);
    const topology = kernel.topology(decoded);
    const capabilities = candidate.capabilities;

    // Live native handles never enter this protocol. Only detached primitive
    // evidence is retained before both the shape and its kernel are disposed.
    return {
      volume: measurements.volume,
      faces: topology.faces.length,
      edges: topology.edges.length,
      vertices: topology.vertices.length,
      protocolVersion: capabilities.protocolVersion,
      format: capabilities.format,
      formatVersion: capabilities.formatVersion,
      compatibilityFingerprint: capabilities.compatibilityFingerprint,
      inputBytesPreserved: true,
    };
  } finally {
    try {
      if (decoded !== undefined) kernel.disposeShape(decoded);
    } finally {
      kernel.dispose();
    }
  }
}

function hangWithoutYielding(): never {
  const sentinel = { running: true };
  while (sentinel.running) {
    // Deliberately occupy this disposable realm until its owner terminates it.
  }
  throw new Error("Unreachable non-yielding worker sentinel");
}

scope.onmessage = (event): void => {
  const request = event.data;
  scope.postMessage({ kind: "started", operation: request.kind });
  if (request.kind === "hang") hangWithoutYielding();

  void decodeArtifact(request.artifact).then(
    (evidence) => {
      // decodeArtifact has already disposed every native owner at this point.
      scope.postMessage({ kind: "success", evidence });
    },
    (error: unknown) => {
      scope.postMessage({ kind: "failure", error: errorEvidence(error) });
    },
  );
};
