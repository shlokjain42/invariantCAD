import { getOcctShapeArtifactCodecCandidate } from "../../src/internal/occt-artifact-candidate.js";
import {
  createEvaluator,
  design,
  EvaluatedSolid,
  mm,
  type EvaluatedDesign,
  type Evaluator,
  vec3,
} from "../../src/index.js";
import type {
  GeometryKernel,
  KernelShape,
} from "../../src/kernel.js";
import { createOcctKernel } from "../../src/occt-kernel.js";

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const FIXTURE_FEATURE = "fixture.asymmetric-role-box";
const EVALUATOR_OUTPUT = "isolated-box";

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

export interface EvaluatorWorkerEvidence {
  readonly volume: number;
  readonly faces: number;
  readonly edges: number;
  readonly vertices: number;
  readonly outputCount: number;
  readonly diagnosticCount: number;
  readonly cleanupCompletedBeforeResponse: true;
}

export type ArtifactWorkerRequest =
  | {
      readonly kind: "decode";
      readonly artifact: ArrayBuffer;
    }
  | {
      readonly kind: "evaluate";
    }
  | {
      readonly kind: "evaluate-stall";
    };

export type ArtifactWorkerResponse =
  | {
      readonly kind: "started";
      readonly operation: ArtifactWorkerRequest["kind"];
    }
  | {
      readonly kind: "kernel-operation-started";
      readonly operation: "evaluate-stall";
      readonly kernelOperation: "box";
    }
  | {
      readonly kind: "success";
      readonly operation: "decode";
      readonly evidence: ArtifactWorkerEvidence;
    }
  | {
      readonly kind: "success";
      readonly operation: "evaluate";
      readonly evidence: EvaluatorWorkerEvidence;
    }
  | {
      readonly kind: "failure";
      readonly operation: ArtifactWorkerRequest["kind"];
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

function evaluatorDocument() {
  const cad = design("browser-worker-evaluator-isolation");
  const box = cad.box(EVALUATOR_OUTPUT, {
    size: vec3(mm(2), mm(3), mm(7)),
  });
  cad.output(EVALUATOR_OUTPUT, box);
  return cad.build();
}

function stallInsideKernelBox(_nativeResult: KernelShape): never {
  scope.postMessage({
    kind: "kernel-operation-started",
    operation: "evaluate-stall",
    kernelOperation: "box",
  });
  const sentinel = { running: true };
  while (sentinel.running) {
    // Deliberately occupy this kernel call until the owner terminates its realm.
  }
  throw new Error("Unreachable non-yielding kernel sentinel");
}

function stallOnBox(delegate: GeometryKernel): GeometryKernel {
  return new Proxy(delegate, {
    get(target, property) {
      if (property === "box") {
        return (
          ...arguments_: Parameters<
            NonNullable<GeometryKernel["box"]>
          >
        ): KernelShape => {
          const box = target.box;
          if (box === undefined) {
            throw new TypeError("Stock OCCT box primitive is unavailable");
          }
          const nativeResult = Reflect.apply(
            box,
            target,
            arguments_,
          ) as KernelShape;
          return stallInsideKernelBox(nativeResult);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function evaluateDocument(
  stall: boolean,
): Promise<EvaluatorWorkerEvidence> {
  const delegate = await createOcctKernel();
  let evaluator: Evaluator | undefined;
  let evaluated: EvaluatedDesign | undefined;
  let evidence:
    | Omit<EvaluatorWorkerEvidence, "cleanupCompletedBeforeResponse">
    | undefined;
  try {
    evaluator = await createEvaluator({
      kernel: stall ? stallOnBox(delegate) : delegate,
    });
    const result = await evaluator.evaluate(evaluatorDocument());
    if (!result.ok) {
      throw new Error(
        result.diagnostics
          .map((item) => `${item.code}: ${item.message}`)
          .join("\n"),
      );
    }
    evaluated = result.value;
    const output = evaluated.output(EVALUATOR_OUTPUT);
    if (!(output instanceof EvaluatedSolid)) {
      throw new TypeError("Expected the isolated evaluator output to be a solid");
    }
    const topology = output.topology();
    if (!topology.ok) {
      throw new Error(
        topology.diagnostics
          .map((item) => `${item.code}: ${item.message}`)
          .join("\n"),
      );
    }
    evidence = {
      volume: output.measure().volume,
      faces: topology.value.faces.length,
      edges: topology.value.edges.length,
      vertices: topology.value.vertices.length,
      outputCount: evaluated.outputNames.length,
      diagnosticCount: evaluated.diagnostics.length,
    };
  } finally {
    try {
      evaluated?.dispose();
    } finally {
      if (evaluator === undefined) delegate.dispose();
      else evaluator.dispose();
    }
  }
  if (evidence === undefined) {
    throw new Error("Evaluator completed without detached evidence");
  }
  // No live EvaluatedDesign, output, shape, evaluator, or kernel survives to
  // this response. The message contains only bounded structured-clone scalars.
  return {
    ...evidence,
    cleanupCompletedBeforeResponse: true,
  };
}

scope.onmessage = (event): void => {
  const request = event.data;
  scope.postMessage({ kind: "started", operation: request.kind });
  const operation =
    request.kind === "decode"
      ? decodeArtifact(request.artifact)
      : evaluateDocument(request.kind === "evaluate-stall");
  void operation.then(
    (evidence) => {
      if (request.kind === "evaluate-stall") {
        scope.postMessage({
          kind: "failure",
          operation: "evaluate-stall",
          error: {
            name: "Error",
            message: "A stalled evaluator operation unexpectedly completed",
          },
        });
        return;
      }
      // The operation has already disposed every native owner at this point.
      if (request.kind === "decode") {
        scope.postMessage({
          kind: "success",
          operation: "decode",
          evidence: evidence as ArtifactWorkerEvidence,
        });
      } else {
        scope.postMessage({
          kind: "success",
          operation: "evaluate",
          evidence: evidence as EvaluatorWorkerEvidence,
        });
      }
    },
    (error: unknown) => {
      scope.postMessage({
        kind: "failure",
        operation: request.kind,
        error: errorEvidence(error),
      });
    },
  );
};
