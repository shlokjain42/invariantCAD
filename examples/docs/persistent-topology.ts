import type { DocumentationExample } from "./example-contract.js";

// docs-example:start persistent-topology-capture-resolve-explain
import {
  captureTopologyReference,
  explainTopologyReference,
  resolveTopologyReference,
  type CadResult,
  type KernelShape,
  type PersistentTopologyReference,
} from "invariantcad";
import { createOcctKernel } from "invariantcad/kernels/occt";

function valueOrThrow<T>(result: CadResult<T>): T {
  if (!result.ok) {
    throw new Error(
      result.diagnostics.map((item) => item.message).join("\n"),
    );
  }
  return result.value;
}

async function captureAndResolve() {
  const kernel = await createOcctKernel();
  const signatures = kernel.capabilities.topology?.signatures;
  if (
    signatures === undefined ||
    kernel.box === undefined ||
    kernel.topology === undefined
  ) {
    kernel.dispose();
    throw new Error("The selected kernel lacks exact topology support");
  }

  let firstShape: KernelShape | undefined;
  let changedShape: KernelShape | undefined;
  try {
    firstShape = kernel.box([10, 20, 30], false, { feature: "box" });
    const first = kernel.topology(firstShape);
    const face = first.faces.find((item) =>
      item.lineage.some((entry) => entry.role === "box.face.x-min"),
    );
    if (face === undefined) {
      throw new Error("The expected semantic face was not present");
    }
    const reference: PersistentTopologyReference<"face"> = valueOrThrow(
      captureTopologyReference(first, "face", face.key, {
        capabilities: signatures,
        tolerance: {
          linear: 1e-6,
          angular: 1e-9,
          relative: 1e-9,
        },
      }),
    );

    changedShape = kernel.box([16, 20, 30], false, { feature: "box" });
    const changed = kernel.topology(changedShape);
    const resolved = valueOrThrow(
      resolveTopologyReference(reference, changed, {
        capabilities: signatures,
      }),
    );
    const explanation = valueOrThrow(
      explainTopologyReference(reference, changed, {
        capabilities: signatures,
      }),
    );
    return {
      protocolVersion: reference.protocolVersion,
      outcome: explanation.outcome,
      evidence:
        explanation.outcome === "resolved"
          ? explanation.evidence
          : null,
      candidatesMatched: explanation.candidatesMatched,
      keyChanged: resolved.key !== face.key,
      capturedKeyStored: JSON.stringify(reference).includes(face.key),
    };
  } finally {
    if (changedShape !== undefined) {
      kernel.disposeShape(changedShape);
    }
    if (firstShape !== undefined) {
      kernel.disposeShape(firstShape);
    }
    kernel.dispose();
  }
}

export const persistentTopologySummary = await captureAndResolve();
console.log(persistentTopologySummary);
// docs-example:end persistent-topology-capture-resolve-explain

export const documentationExample = {
  id: "persistent-topology-capture-resolve-explain",
  checks: {
    protocolV2: persistentTopologySummary.protocolVersion === 2,
    resolved: persistentTopologySummary.outcome === "resolved",
    uniqueMatch: persistentTopologySummary.candidatesMatched === 1,
    semanticEvidence:
      persistentTopologySummary.evidence === "semantic-lineage",
    currentKeyIsEvaluationScoped: persistentTopologySummary.keyChanged,
    referenceIsKeyFree: !persistentTopologySummary.capturedKeyStored,
  },
} satisfies DocumentationExample;
