import {
  design,
  kgPerCubicMeter,
  mm,
  vec3,
  type DesignDocument,
} from "../../src/index.js";

const EXPECTED_VOLUME_MM3 =
  100 * 70 * 30 -
  92 * 62 * 26 +
  4 * Math.PI * 5 ** 2 * 13;

export const enclosureReferenceModel = {
  id: "electronics-enclosure",
  title: "Open electronics enclosure",
  description:
    "A parameterized open-top enclosure with a uniform wall, solid floor, and four internal mounting bosses.",
  outputName: "enclosure",
  supportedKernels: ["manifold", "occt"] as const,
  expected: {
    volumeMm3: EXPECTED_VOLUME_MM3,
    boundingBox: {
      min: [-50, -35, -15],
      max: [50, 35, 15],
    },
    massDensityKgPerM3: 1_040,
  },
  buildDocument(): DesignDocument {
    const cad = design("reference-electronics-enclosure", {
      metadata: { corpus: "reference-models", model: "electronics-enclosure" },
    });

    const width = cad.parameter.length("width", mm(100), { min: mm(40) });
    const depth = cad.parameter.length("depth", mm(70), { min: mm(30) });
    const height = cad.parameter.length("height", mm(30), { min: mm(12) });
    const wall = cad.parameter.length("wall", mm(4), { min: mm(1) });
    const floor = cad.parameter.length("floor", mm(4), { min: mm(1) });
    const bossRadius = cad.parameter.length("bossRadius", mm(5), {
      min: mm(2),
    });
    const bossHeight = cad.parameter.length("bossHeight", mm(14), {
      min: mm(3),
    });

    const abs = cad.material("abs", {
      name: "ABS",
      massDensity: kgPerCubicMeter(1_040),
    });

    const outer = cad.box("outer", {
      size: vec3(width, depth, height),
      center: true,
    });
    const cavityWidth = width.sub(wall.mul(2));
    const cavityDepth = depth.sub(wall.mul(2));
    const cavity = cad.box("cavity", {
      size: vec3(cavityWidth, cavityDepth, height),
      center: true,
    });
    const raisedCavity = cad.translate(
      "raised-cavity",
      cavity,
      vec3(mm(0), mm(0), floor),
    );
    const shell = cad.subtract("shell", outer, [raisedCavity]);

    const bossX = cavityWidth.mul(0.5).sub(mm(8));
    const bossY = cavityDepth.mul(0.5).sub(mm(8));
    const bossZ = height.mul(-0.5).add(floor).add(bossHeight.mul(0.5)).sub(mm(1));
    const bosses = [
      [bossX, bossY],
      [bossX.neg(), bossY],
      [bossX, bossY.neg()],
      [bossX.neg(), bossY.neg()],
    ].map(([x, y], index) => {
      const boss = cad.cylinder(`boss-${index}`, {
        height: bossHeight,
        radius: bossRadius,
        center: true,
        segments: 96,
      });
      return cad.translate(
        `placed-boss-${index}`,
        boss,
        vec3(x!, y!, bossZ),
      );
    });

    const solid = cad.union("enclosure-solid", shell, bosses);
    const part = cad.part("enclosure-part", solid, {
      partNumber: "REF-ENC-001",
      description: "Open electronics enclosure with mounting bosses",
      materialRef: abs,
    });
    cad.output("enclosure", part);
    return cad.build();
  },
} as const;
