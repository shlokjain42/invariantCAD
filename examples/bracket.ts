import { mkdir, writeFile } from "node:fs/promises";
import {
  createEvaluator,
  design,
  kgPerCubicMeter,
  mm,
  plane,
  scalarVec3,
  stringifyDocument,
  tf,
  vec2,
  vec3,
} from "../src/index.js";

const cad = design("mounting-bracket", {
  metadata: { description: "Parameterized two-hole mounting bracket" },
});

const width = cad.parameter.length("width", mm(80), { min: mm(30) });
const depth = cad.parameter.length("depth", mm(50), { min: mm(20) });
const thickness = cad.parameter.length("thickness", mm(6), { min: mm(1) });
const holeRadius = cad.parameter.length("holeRadius", mm(4), { min: mm(1) });
const holeSpacing = cad.parameter.length("holeSpacing", mm(60), { min: mm(10) });
const aluminum = cad.material("aluminum-6061-t6", {
  name: "6061-T6 Aluminum",
  massDensity: kgPerCubicMeter(2700),
});
const steel = cad.material("steel-a36", {
  name: "A36 Steel",
  massDensity: kgPerCubicMeter(7850),
});

const plateProfile = cad.sketch("plate-profile", plane.xy(), (sketch) => {
  const outer = sketch.rectangle("outline", { width, height: depth });
  const leftHole = sketch.circle("left-hole", {
    center: vec2(holeSpacing.mul(-0.5), mm(0)),
    radius: holeRadius,
  });
  const rightHole = sketch.circle("right-hole", {
    center: vec2(holeSpacing.mul(0.5), mm(0)),
    radius: holeRadius,
  });
  return sketch.profile(outer, { holes: [leftHole.loop(), rightHole.loop()] });
});

const plate = cad.extrude("plate", plateProfile, {
  distance: thickness,
  symmetric: true,
});
const flange = cad.box("flange", {
  size: vec3(width, thickness, mm(30)),
  center: true,
});
const raisedFlange = cad.translate(
  "raised-flange",
  flange,
  vec3(mm(0), depth.mul(0.5).sub(thickness.mul(0.5)), mm(15)),
);
const bracketSolid = cad.union("bracket-solid", plate, [raisedFlange]);
const bracket = cad.part("bracket", bracketSolid, {
  partNumber: "INV-BRACKET-001",
  materialRef: aluminum,
});
const pair = cad.assembly("bracket-pair", (assembly) => {
  assembly.instance("left", bracket);
  assembly.instance("right", bracket, {
    placement: [tf.translate(vec3(width.add(mm(20)), mm(0), mm(0)))],
  });
});
const compactSteelSingle = cad.configuration(
  "compact-steel-single",
  (configuration) => {
    configuration.parameter(width, mm(60));
    configuration.instanceSuppressed(pair, "right");
    configuration.partMaterial(bracket, steel);
  },
  { description: "One compact bracket manufactured from A36 steel" },
);
cad.output("bracket", bracket).output("pair", pair);

const document = cad.build();
await mkdir(".artifacts", { recursive: true });
await writeFile(
  ".artifacts/bracket.invariantcad.json",
  stringifyDocument(document, { pretty: true }),
);

const evaluator = await createEvaluator();
try {
  const result = await evaluator.evaluate(document, {
    configuration: compactSteelSingle,
    outputs: ["pair"],
  });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((item) => item.message).join("\n"));
  }
  try {
    const output = result.value.output("pair");
    await writeFile(
      ".artifacts/bracket-compact-steel-single.stl",
      output.export("stl"),
    );
    console.log({ configurationId: result.value.configurationId });
    console.log(output.measure());
    if ("physicalMassProperties" in output) {
      console.log(output.physicalMassProperties());
    }
    if ("billOfMaterials" in output) {
      console.log(output.billOfMaterials());
    }
  } finally {
    result.value.dispose();
  }
} finally {
  evaluator.dispose();
}
