import type { DocumentationExample } from "./example-contract.js";

// docs-example:start parametric-box-default
import { createEvaluator, design, mm, vec3 } from "invariantcad";

const cad = design("parametric-box");
const width = cad.parameter.length("width", mm(40), { min: mm(1) });

const body = cad.box("body", {
  size: vec3(width, mm(20), mm(5)),
  center: true,
});
cad.output("body", body);

async function evaluateParametricBox() {
  const evaluator = await createEvaluator();
  try {
    const result = await evaluator.evaluate(cad.build(), {
      parameters: { width: 60 },
      outputs: ["body"],
    });
    if (!result.ok) {
      throw new Error(
        result.diagnostics.map((item) => item.message).join("\n"),
      );
    }

    try {
      const output = result.value.output("body");
      return {
        volume: output.measure().volume,
        stlBytes: output.export("stl").byteLength,
      };
    } finally {
      result.value.dispose();
    }
  } finally {
    evaluator.dispose();
  }
}

export const parametricBoxSummary = await evaluateParametricBox();
console.log(parametricBoxSummary);
// docs-example:end parametric-box-default

export const documentationExample = {
  id: "parametric-box-default",
  checks: {
    parameterOverrideApplied: parametricBoxSummary.volume === 6_000,
    binaryStlProduced: parametricBoxSummary.stlBytes > 84,
  },
} satisfies DocumentationExample;
