import {
  design,
  kgPerCubicMeter,
  mm,
  vec3,
  type DesignDocument,
} from "../../src/index.js";

const EXPECTED_VOLUME_MM3 = Math.PI * 10_655;

export const shaftReferenceModel = {
  id: "hollow-stepped-shaft",
  title: "Hollow stepped shaft",
  description:
    "A parameterized three-diameter shaft with overlapping shoulders and a continuous axial bore.",
  outputName: "shaft",
  supportedKernels: ["manifold", "occt"] as const,
  expected: {
    volumeMm3: EXPECTED_VOLUME_MM3,
    boundingBox: {
      min: [-16, -16, -41],
      max: [16, 16, 60],
    },
    massDensityKgPerM3: 7_850,
  },
  buildDocument(): DesignDocument {
    const cad = design("reference-hollow-stepped-shaft", {
      metadata: { corpus: "reference-models", model: "hollow-stepped-shaft" },
    });

    const mainRadius = cad.parameter.length("mainRadius", mm(10), {
      min: mm(4),
    });
    const mainLength = cad.parameter.length("mainLength", mm(80), {
      min: mm(30),
    });
    const shoulderRadius = cad.parameter.length("shoulderRadius", mm(16), {
      min: mm(8),
    });
    const shoulderLength = cad.parameter.length("shoulderLength", mm(14), {
      min: mm(4),
    });
    const journalRadius = cad.parameter.length("journalRadius", mm(8), {
      min: mm(3),
    });
    const journalLength = cad.parameter.length("journalLength", mm(22), {
      min: mm(6),
    });
    const boreRadius = cad.parameter.length("boreRadius", mm(3), {
      min: mm(1),
    });

    const steel = cad.material("alloy-steel", {
      name: "Alloy steel",
      massDensity: kgPerCubicMeter(7_850),
    });

    const main = cad.cylinder("main", {
      height: mainLength,
      radius: mainRadius,
      center: true,
      segments: 96,
    });
    const shoulder = cad.cylinder("shoulder", {
      height: shoulderLength,
      radius: shoulderRadius,
      center: true,
      segments: 96,
    });
    const placedShoulder = cad.translate(
      "placed-shoulder",
      shoulder,
      vec3(mm(0), mm(0), mm(-34)),
    );
    const journal = cad.cylinder("journal", {
      height: journalLength,
      radius: journalRadius,
      center: true,
      segments: 96,
    });
    const placedJournal = cad.translate(
      "placed-journal",
      journal,
      vec3(mm(0), mm(0), mm(49)),
    );
    const body = cad.union("shaft-body", main, [
      placedShoulder,
      placedJournal,
    ]);

    const bore = cad.cylinder("axial-bore", {
      height: mm(105),
      radius: boreRadius,
      center: true,
      segments: 96,
    });
    const placedBore = cad.translate(
      "placed-axial-bore",
      bore,
      vec3(mm(0), mm(0), mm(9.5)),
    );
    const solid = cad.subtract("finished-shaft", body, [placedBore]);
    const part = cad.part("shaft-part", solid, {
      partNumber: "REF-SHAFT-001",
      description: "Hollow stepped shaft",
      materialRef: steel,
    });
    cad.output("shaft", part);
    return cad.build();
  },
} as const;
