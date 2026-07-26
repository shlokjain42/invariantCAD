import type { DocumentationExample } from "./example-contract.js";

// docs-example:start imported-body-round-trip
import {
  EvaluatedSolid,
  createEvaluator,
  createImportedBodyDocument,
  design,
  mm,
  parseImportedBodyDocument,
  stringifyImportedBodyDocument,
  vec3,
  type CadResult,
  type ImportedBodyResourceDigest,
} from "invariantcad";

function valueOrThrow<T>(result: CadResult<T>): T {
  if (!result.ok) {
    throw new Error(
      result.diagnostics.map((item) => item.message).join("\n"),
    );
  }
  return result.value;
}

async function sha256(
  bytes: Uint8Array,
): Promise<ImportedBodyResourceDigest> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes),
  );
  const hexadecimal = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hexadecimal}`;
}

const source = design("import-source");
const box = source.box("box", {
  size: vec3(mm(2), mm(3), mm(4)),
});
source.output("box", box);

async function runImportedBodyRoundTrip() {
  const evaluator = await createEvaluator({ profile: "mechanical-exact" });
  try {
    const sourceResult = valueOrThrow(
      await evaluator.evaluate(source.build()),
    );
    let sourceStep: Uint8Array;
    try {
      const output = sourceResult.output("box");
      if (!(output instanceof EvaluatedSolid)) {
        throw new Error("Expected the source output to be a solid");
      }
      sourceStep = output.export("step", {});
    } finally {
      sourceResult.dispose();
    }

    const digest = await sha256(sourceStep);
    const document = valueOrThrow(
      createImportedBodyDocument("verified-step-box", {
        id: "importedBox",
        resource: {
          id: "boxStep",
          digest,
          byteLength: sourceStep.byteLength,
          mediaType: "model/step",
          locations: ["memory:box.step"],
        },
        format: "step",
        units: { mode: "from-file" },
      }),
    );
    const canonicalJson = stringifyImportedBodyDocument(document);
    const reparsed = valueOrThrow(
      parseImportedBodyDocument(canonicalJson),
    );

    let resolverCalls = 0;
    const imported = valueOrThrow(
      await evaluator.evaluateImportedBody(reparsed, {
        resolver: (request) => {
          resolverCalls += 1;
          if (
            request.id !== "boxStep" ||
            request.digest !== digest ||
            request.byteLength !== sourceStep.byteLength ||
            request.mediaType !== "model/step"
          ) {
            throw new Error("Unexpected imported-body resource request");
          }
          return sourceStep;
        },
      }),
    );
    try {
      const measurements = imported.measure();
      const topology = valueOrThrow(imported.topology());
      const firstExport = imported.export("step", {});
      const secondExport = imported.export("step", {});

      return {
        canonicalRoundTrip:
          stringifyImportedBodyDocument(reparsed) === canonicalJson,
        resolverCalls,
        exact: imported.exact,
        representation: imported.representation,
        volume: measurements.volume,
        surfaceArea: measurements.surfaceArea,
        faces: topology.faces.length,
        exportedStepBytes: firstExport.byteLength,
        deterministicExport:
          firstExport.byteLength === secondExport.byteLength &&
          firstExport.every((byte, index) => byte === secondExport[index]),
      };
    } finally {
      imported.dispose();
    }
  } finally {
    evaluator.dispose();
  }
}

export const importedBodySummary = await runImportedBodyRoundTrip();
console.log(importedBodySummary);
// docs-example:end imported-body-round-trip

export const documentationExample = {
  id: "imported-body-round-trip",
  checks: {
    canonicalRoundTrip: importedBodySummary.canonicalRoundTrip,
    resolvedOnce: importedBodySummary.resolverCalls === 1,
    exact: importedBodySummary.exact,
    brep: importedBodySummary.representation === "brep",
    volume: Math.abs(importedBodySummary.volume - 24) < 1e-8,
    surfaceArea: Math.abs(importedBodySummary.surfaceArea - 52) < 1e-8,
    topology: importedBodySummary.faces === 6,
    stepProduced: importedBodySummary.exportedStepBytes > 1_000,
    deterministicExport: importedBodySummary.deterministicExport,
  },
} satisfies DocumentationExample;
