import type { DocumentationExample } from "./example-contract.js";

// docs-example:start assembly-configuration-bom
import {
  EvaluatedAssembly,
  createEvaluator,
  design,
  kgPerCubicMeter,
  mm,
  tf,
  vec3,
} from "invariantcad";

const cad = design("configured-bracket-pair");
const width = cad.parameter.length("width", mm(40), { min: mm(10) });
const bracketSolid = cad.box("bracket-solid", {
  size: vec3(width, mm(20), mm(5)),
});
const aluminum = cad.material("aluminum", {
  name: "Aluminum",
  massDensity: kgPerCubicMeter(2_700),
});
const steel = cad.material("steel", {
  name: "Steel",
  massDensity: kgPerCubicMeter(7_850),
});
const bracket = cad.part("bracket", bracketSolid, {
  partNumber: "BRACKET-001",
  materialRef: aluminum,
});
const pair = cad.assembly("pair", (assembly) => {
  assembly.instance("left", bracket);
  assembly.instance("right", bracket, {
    placement: [tf.translate(vec3(mm(60), mm(0), mm(0)))],
  });
});
const wideSteelSingle = cad.configuration(
  "wide-steel-single",
  (configuration) => {
    configuration.parameter(width, mm(50));
    configuration.instanceSuppressed(pair, "right");
    configuration.partMaterial(bracket, steel);
  },
);
cad.output("pair", pair);

async function evaluateConfiguredAssembly() {
  const evaluator = await createEvaluator();
  try {
    const result = await evaluator.evaluate(cad.build(), {
      configuration: wideSteelSingle,
      outputs: ["pair"],
    });
    if (!result.ok) {
      throw new Error(
        result.diagnostics.map((item) => item.message).join("\n"),
      );
    }

    try {
      const output = result.value.output("pair");
      if (!(output instanceof EvaluatedAssembly)) {
        throw new Error("Expected the 'pair' output to be an assembly");
      }
      const bom = output.billOfMaterials();
      if (!bom.ok) {
        throw new Error(
          bom.diagnostics.map((item) => item.message).join("\n"),
        );
      }
      return {
        configurationId: result.value.configurationId,
        activeInstances: output.instances.map((instance) => instance.id),
        totalQuantity: bom.value.totalQuantity,
        materialId: bom.value.items[0]?.materialId,
        totalMassKg: bom.value.totalMass,
      };
    } finally {
      result.value.dispose();
    }
  } finally {
    evaluator.dispose();
  }
}

export const assemblyConfigurationBomSummary =
  await evaluateConfiguredAssembly();
console.log(assemblyConfigurationBomSummary);
// docs-example:end assembly-configuration-bom

export const documentationExample = {
  id: "assembly-configuration-bom",
  checks: {
    configurationSelected:
      assemblyConfigurationBomSummary.configurationId ===
      "wide-steel-single",
    suppressedInstanceExcluded:
      assemblyConfigurationBomSummary.activeInstances.join(",") === "left",
    bomQuantity: assemblyConfigurationBomSummary.totalQuantity === 1,
    materialOverridden: assemblyConfigurationBomSummary.materialId === "steel",
    massRolledUp:
      Math.abs(
        (assemblyConfigurationBomSummary.totalMassKg ?? 0) - 0.03925,
      ) < 1e-12,
  },
} satisfies DocumentationExample;
