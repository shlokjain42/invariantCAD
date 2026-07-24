import {
  design,
  kgPerCubicMeter,
  mm,
  vec3,
  type DesignDocument,
} from "../../src/index.js";

const EXPECTED_VOLUME_MM3 =
  Math.PI *
  (35 ** 2 * 8 + 16 ** 2 * 20 - 8 ** 2 * 28 - 6 * 3.5 ** 2 * 8);

export const flangeReferenceModel = {
  id: "six-bolt-flange",
  title: "Six-bolt hub flange",
  description:
    "A parameterized hub flange with a through bore and a six-hole bolt circle.",
  outputName: "flange",
  supportedKernels: ["manifold", "occt"] as const,
  expected: {
    volumeMm3: EXPECTED_VOLUME_MM3,
    boundingBox: {
      min: [-35, -35, -4],
      max: [35, 35, 24],
    },
    massDensityKgPerM3: 7_850,
  },
  buildDocument(): DesignDocument {
    const cad = design("reference-six-bolt-flange", {
      metadata: { corpus: "reference-models", model: "six-bolt-flange" },
    });

    const flangeRadius = cad.parameter.length("flangeRadius", mm(35), {
      min: mm(15),
    });
    const flangeThickness = cad.parameter.length("flangeThickness", mm(8), {
      min: mm(3),
    });
    const hubRadius = cad.parameter.length("hubRadius", mm(16), {
      min: mm(8),
    });
    const hubLength = cad.parameter.length("hubLength", mm(28), {
      min: mm(10),
    });
    const boreRadius = cad.parameter.length("boreRadius", mm(8), {
      min: mm(2),
    });
    const boltCircleRadius = cad.parameter.length("boltCircleRadius", mm(25), {
      min: mm(10),
    });
    const boltRadius = cad.parameter.length("boltRadius", mm(3.5), {
      min: mm(1),
    });

    const steel = cad.material("carbon-steel", {
      name: "Carbon steel",
      massDensity: kgPerCubicMeter(7_850),
    });

    const flange = cad.cylinder("flange-disc", {
      height: flangeThickness,
      radius: flangeRadius,
      center: true,
      segments: 96,
    });
    const hub = cad.cylinder("hub", {
      height: hubLength,
      radius: hubRadius,
      center: true,
      segments: 96,
    });
    const hubZ = hubLength.sub(flangeThickness).mul(0.5);
    const placedHub = cad.translate(
      "placed-hub",
      hub,
      vec3(mm(0), mm(0), hubZ),
    );
    const body = cad.union("flange-body", flange, [placedHub]);

    const bore = cad.cylinder("bore", {
      height: hubLength.add(flangeThickness),
      radius: boreRadius,
      center: true,
      segments: 96,
    });
    const placedBore = cad.translate(
      "placed-bore",
      bore,
      vec3(mm(0), mm(0), hubZ),
    );
    const boltHoles = Array.from({ length: 6 }, (_, index) => {
      const angle = (index * Math.PI * 2) / 6;
      const hole = cad.cylinder(`bolt-hole-${index}`, {
        height: flangeThickness.add(mm(4)),
        radius: boltRadius,
        center: true,
        segments: 96,
      });
      return cad.translate(
        `placed-bolt-hole-${index}`,
        hole,
        vec3(
          boltCircleRadius.mul(Math.cos(angle)),
          boltCircleRadius.mul(Math.sin(angle)),
          mm(0),
        ),
      );
    });

    const solid = cad.subtract("finished-flange", body, [
      placedBore,
      ...boltHoles,
    ]);
    const part = cad.part("flange-part", solid, {
      partNumber: "REF-FLG-006",
      description: "Six-bolt hub flange",
      materialRef: steel,
    });
    cad.output("flange", part);
    return cad.build();
  },
} as const;
