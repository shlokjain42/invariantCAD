import type { DocumentationExample } from "./example-contract.js";

// docs-example:start composite-route-sweep
import {
  EvaluatedSolid,
  createEvaluator,
  design,
  mm,
  plane,
  vec3,
} from "invariantcad";

const cad = design("routed-bar");

// Arc points are exact expressions: an arc-bearing junction must be tangent
// to a scale-independent sine of 1e-8, so hand-rounded coordinates fail.
const route = cad.compositePath("route", {
  start: vec3(mm(0), mm(0), mm(0)),
  segments: [
    { kind: "line", end: vec3(mm(5), mm(0), mm(0)) },
    {
      kind: "circularArc",
      through: vec3(mm(5 + 5 / Math.sqrt(2)), mm(5 - 5 / Math.sqrt(2)), mm(0)),
      end: vec3(mm(10), mm(5), mm(0)),
    },
    { kind: "line", end: vec3(mm(10), mm(10), mm(0)) },
  ],
});

// The YZ section is seated at the route start, normal to its +X tangent.
const section = cad.sketch("section", plane.yz(), (sketch) =>
  sketch.profile(
    sketch.rectangle("section-outline", { width: mm(2), height: mm(2) }),
  ),
);

const swept = cad.sweep("swept", section, route, {
  frame: "corrected-frenet",
  transition: "right-corner",
});
cad.output("swept", swept);

async function evaluateRoutedBar() {
  // Sweeps are exact features, so evaluate them with stock OCCT.
  const evaluator = await createEvaluator({ profile: "mechanical-exact" });
  try {
    const result = await evaluator.evaluate(cad.build());
    if (!result.ok) {
      throw new Error(
        result.diagnostics
          .map((item) => `${item.code} ${item.path ?? ""}: ${item.message}`)
          .join("\n"),
      );
    }
    try {
      const solid = result.value.output("swept");
      if (!(solid instanceof EvaluatedSolid)) {
        throw new Error("Expected the 'swept' output to be a solid");
      }
      return { volume: solid.measure().volume };
    } finally {
      result.value.dispose();
    }
  } finally {
    evaluator.dispose();
  }
}

export const routedBarSummary = await evaluateRoutedBar();
console.log(routedBarSummary);
// docs-example:end composite-route-sweep

// A 2 x 2 section transported along 5 + 2.5 * pi + 5 mm of centerline.
const expectedVolume = 4 * (10 + 2.5 * Math.PI);

export const documentationExample = {
  id: "composite-route-sweep",
  checks: {
    volume: Math.abs(routedBarSummary.volume - expectedVolume) < 1e-6,
  },
} satisfies DocumentationExample;
