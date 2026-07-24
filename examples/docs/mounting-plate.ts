import type { DocumentationExample } from "./example-contract.js";

// docs-example:start mounting-plate-default-and-exact
import {
  EvaluatedSolid,
  createEvaluator,
  design,
  mm,
  plane,
  vec2,
} from "invariantcad";
import { createOcctKernel } from "invariantcad/kernels/occt";

const cad = design("mounting-plate", {
  metadata: { description: "Parameterized plate with one mounting hole" },
});

const width = cad.parameter.length("width", mm(80), {
  min: mm(20),
  max: mm(200),
  description: "Overall plate width",
});
const height = cad.parameter.length("height", mm(50), { min: mm(10) });
const thickness = cad.parameter.length("thickness", mm(6), { min: mm(1) });
const holeRadius = cad.parameter.length("holeRadius", mm(4), { min: mm(1) });

const profile = cad.sketch("plate-profile", plane.xy(), (sketch) => {
  const outline = sketch.rectangle("outline", { width, height });
  const hole = sketch.circle("hole", {
    center: vec2(width.mul(0.25), mm(0)),
    radius: holeRadius,
  });
  return sketch.profile(outline, { holes: [hole.loop()] });
});

const solid = cad.extrude("plate-solid", profile, {
  distance: thickness,
  symmetric: true,
});
const part = cad.part("plate", solid, {
  partNumber: "PLATE-001",
  description: "Machined mounting plate",
});
cad.output("plate", part);

const document = cad.build();
const parameters = {
  width: 100,
  holeRadius: 5,
};

async function evaluateDefaultMesh() {
  const evaluator = await createEvaluator();
  try {
    const result = await evaluator.evaluate(document, {
      parameters,
      outputs: ["plate"],
    });
    if (!result.ok) {
      throw new Error(
        result.diagnostics.map((item) => item.message).join("\n"),
      );
    }

    try {
      const plate = result.value.output("plate");
      if (!(plate instanceof EvaluatedSolid)) {
        throw new Error("Expected the 'plate' output to be a solid part");
      }
      return {
        volume: plate.measure().volume,
        stl: plate.export("stl"),
      };
    } finally {
      result.value.dispose();
    }
  } finally {
    evaluator.dispose();
  }
}

async function exportExactStep() {
  const kernel = await createOcctKernel();
  let evaluatorOwnsKernel = false;
  try {
    const evaluator = await createEvaluator({ kernel });
    evaluatorOwnsKernel = true;
    try {
      const result = await evaluator.evaluate(document, {
        parameters,
        outputs: ["plate"],
      });
      if (!result.ok) {
        throw new Error(
          result.diagnostics.map((item) => item.message).join("\n"),
        );
      }

      try {
        const plate = result.value.output("plate");
        if (!(plate instanceof EvaluatedSolid)) {
          throw new Error("Expected the 'plate' output to be a solid part");
        }
        return {
          volume: plate.measure().volume,
          step: plate.export("step"),
        };
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  } finally {
    // A rejected caller-supplied kernel remains caller-owned.
    if (!evaluatorOwnsKernel) kernel.dispose();
  }
}

const defaultMesh = await evaluateDefaultMesh();
const exact = await exportExactStep();

export const mountingPlateSummary = {
  defaultVolume: defaultMesh.volume,
  defaultStlBytes: defaultMesh.stl.byteLength,
  exactVolume: exact.volume,
  stepBytes: exact.step.byteLength,
  stepHeader: new TextDecoder().decode(exact.step.subarray(0, 32)),
};
console.log(mountingPlateSummary);
// docs-example:end mounting-plate-default-and-exact

const expectedExactVolume = (100 * 50 - Math.PI * 5 ** 2) * 6;

export const documentationExample = {
  id: "mounting-plate-default-and-exact",
  checks: {
    defaultVolume:
      Math.abs(mountingPlateSummary.defaultVolume - expectedExactVolume) < 2,
    defaultStlProduced: mountingPlateSummary.defaultStlBytes > 84,
    exactVolume:
      Math.abs(mountingPlateSummary.exactVolume - expectedExactVolume) <
      1e-6,
    stepProduced: mountingPlateSummary.stepBytes > 1_000,
    stepHeader: /ISO-10303-21/u.test(mountingPlateSummary.stepHeader),
  },
} satisfies DocumentationExample;
