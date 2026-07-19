import { describe, expect, it } from "vitest";
import {
  kernelSupports,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type GeometryKernel,
  type KernelShape,
  type KernelTopologyLineage,
  type KernelTopologySnapshot,
  type ProfileCurveSource,
  type ResolvedProfile,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

function source(sketch: string, entity: string): ProfileCurveSource {
  return {
    kind: "sketch-entity",
    sketch,
    entity: entity as ProfileCurveSource["entity"],
  };
}

function rectangleProfile(
  sketch: string,
  station: number,
  width: number,
  height: number,
  offset: readonly [number, number] = [0, 0],
): ResolvedProfile {
  const xMin = -width / 2;
  const xMax = width / 2;
  const yMin = -height / 2;
  const yMax = height / 2;
  return {
    plane: { plane: "XY", origin: [offset[0], offset[1], station] },
    outer: {
      curves: [
        {
          kind: "line",
          start: [xMin, yMin],
          end: [xMax, yMin],
          source: source(sketch, "bottom"),
        },
        {
          kind: "line",
          start: [xMax, yMin],
          end: [xMax, yMax],
          source: source(sketch, "right"),
        },
        {
          kind: "line",
          start: [xMax, yMax],
          end: [xMin, yMax],
          source: source(sketch, "top"),
        },
        {
          kind: "line",
          start: [xMin, yMax],
          end: [xMin, yMin],
          source: source(sketch, "left"),
        },
      ],
    },
    holes: [],
  };
}

function selfIntersectingProfile(
  sketch: string,
  station: number,
): ResolvedProfile {
  const points = [
    [0, 0],
    [4, 4],
    [0, 4],
    [3, 0],
  ] as const;
  return {
    plane: { plane: "XY", origin: [0, 0, station] },
    outer: {
      curves: points.map((start, index) => ({
        kind: "line" as const,
        start,
        end: points[(index + 1) % points.length]!,
        source: source(sketch, `edge-${index}`),
      })),
    },
    holes: [],
  };
}

function circleProfile(
  sketch: string,
  station: number,
  radius: number,
): ResolvedProfile {
  return {
    plane: { plane: "XY", origin: [0, 0, station] },
    outer: {
      curves: [
        {
          kind: "circle",
          center: [0, 0],
          radius,
          reversed: false,
          source: source(sketch, "circle"),
        },
      ],
    },
    holes: [],
  };
}

function archedProfile(
  sketch: string,
  station: number,
  radius: number,
): ResolvedProfile {
  return {
    plane: { plane: "XY", origin: [0, 0, station] },
    outer: {
      curves: [
        {
          kind: "arc",
          center: [0, 0],
          radius,
          startAngle: 0,
          endAngle: Math.PI,
          clockwise: false,
          source: source(sketch, "arc"),
        },
        {
          kind: "line",
          start: [-radius, 0],
          end: [-radius, -10],
          source: source(sketch, "left"),
        },
        {
          kind: "line",
          start: [-radius, -10],
          end: [radius, -10],
          source: source(sketch, "bottom"),
        },
        {
          kind: "line",
          start: [radius, -10],
          end: [radius, 0],
          source: source(sketch, "right"),
        },
      ],
    },
    holes: [],
  };
}

function rotateProfileCurvePhase(
  profile: ResolvedProfile,
  shift: number,
): ResolvedProfile {
  return {
    ...profile,
    outer: {
      curves: [
        ...profile.outer.curves.slice(shift),
        ...profile.outer.curves.slice(0, shift),
      ],
    },
  };
}

function withoutCurveSources(profile: ResolvedProfile): ResolvedProfile {
  return {
    ...profile,
    outer: {
      curves: profile.outer.curves.map((curve) => {
        const { source: _source, ...unsourced } = curve;
        return unsourced;
      }),
    },
  };
}

function topology(kernel: GeometryKernel, shape: KernelShape): KernelTopologySnapshot {
  const snapshot = kernel.topology?.(shape);
  if (snapshot === undefined) throw new Error("OCCT topology support is unavailable");
  return snapshot;
}

function expectVectorClose(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
): void {
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index]!, 6);
  }
}

type Descriptor = KernelFaceDescriptor | KernelEdgeDescriptor;

type LoftRole =
  | "loft.face.start-cap"
  | "loft.face.end-cap"
  | "loft.face.side"
  | "loft.edge.section-rim"
  | "loft.edge.lateral";

type TopologySource = NonNullable<KernelTopologyLineage["source"]>;

const RECTANGLE_ENTITIES = ["bottom", "right", "top", "left"] as const;

const FACE_LOFT_ROLES = [
  "loft.face.start-cap",
  "loft.face.end-cap",
  "loft.face.side",
] as const;

const EDGE_LOFT_ROLES = [
  "loft.edge.section-rim",
  "loft.edge.lateral",
] as const;

function descriptors(snapshot: KernelTopologySnapshot): readonly Descriptor[] {
  return [...snapshot.faces, ...snapshot.edges];
}

function featureLineage(
  descriptor: Descriptor,
  feature: string,
): readonly KernelTopologyLineage[] {
  return descriptor.lineage.filter((item) => item.feature === feature);
}

function semanticLineage(
  descriptor: Descriptor,
  feature: string,
  role?: LoftRole,
): readonly KernelTopologyLineage[] {
  return featureLineage(descriptor, feature).filter(
    (item) =>
      item.role !== undefined && (role === undefined || item.role === role),
  );
}

function descriptorsWithRole(
  snapshot: KernelTopologySnapshot,
  feature: string,
  role: LoftRole,
): readonly Descriptor[] {
  return descriptors(snapshot).filter((descriptor) =>
    semanticLineage(descriptor, feature, role).length > 0,
  );
}

function descriptorsWithRoleAndSource(
  snapshot: KernelTopologySnapshot,
  feature: string,
  role: "loft.face.side" | "loft.edge.section-rim",
  expectedSource: ProfileCurveSource,
): readonly Descriptor[] {
  const expectedKey = sourceKey(expectedSource);
  return descriptorsWithRole(snapshot, feature, role).filter((descriptor) =>
    lineageSourceKeys(descriptor, feature, role).includes(expectedKey),
  );
}

function sourceKey(value: TopologySource): string {
  return `${value.kind}:${value.sketch}:${value.entity}`;
}

function lineageSourceKeys(
  descriptor: Descriptor,
  feature: string,
  role: LoftRole,
): readonly string[] {
  return semanticLineage(descriptor, feature, role)
    .map((item) => item.source)
    .filter((item): item is TopologySource => item !== undefined)
    .map(sourceKey)
    .sort();
}

function expectSourceAnchors(
  snapshot: KernelTopologySnapshot,
  feature: string,
  role: "loft.face.side" | "loft.edge.section-rim",
  expected: readonly (readonly ProfileCurveSource[])[],
): void {
  const actual = descriptorsWithRole(snapshot, feature, role)
    .map((descriptor) => lineageSourceKeys(descriptor, feature, role).join("|"))
    .sort();
  expect(actual).toEqual(
    expected.map((sources) => sources.map(sourceKey).sort().join("|")).sort(),
  );
}

function adjacentSectionSources(
  firstSketch: string,
  secondSketch: string,
  entities: readonly string[] = RECTANGLE_ENTITIES,
): readonly (readonly ProfileCurveSource[])[] {
  return entities.map((entity) => [
    source(firstSketch, entity),
    source(secondSketch, entity),
  ]);
}

function sectionRimSources(
  sketches: readonly string[],
  entities: readonly string[] = RECTANGLE_ENTITIES,
): readonly (readonly ProfileCurveSource[])[] {
  return sketches.flatMap((sketch) =>
    entities.map((entity) => [source(sketch, entity)]),
  );
}

function expectUnsourcedRole(
  snapshot: KernelTopologySnapshot,
  feature: string,
  role:
    | "loft.face.start-cap"
    | "loft.face.end-cap"
    | "loft.edge.lateral",
  expectedCount: number,
): void {
  const matches = descriptorsWithRole(snapshot, feature, role);
  expect(matches).toHaveLength(expectedCount);
  for (const descriptor of matches) {
    const lineage = semanticLineage(descriptor, feature, role);
    expect(lineage).toHaveLength(1);
    expect(lineage[0]!.source).toBeUndefined();
  }
}

function expectCompleteLoftInventory(
  snapshot: KernelTopologySnapshot,
  feature: string,
  expected: {
    readonly sideFaces: number;
    readonly sectionRims: number;
    readonly lateralEdges: number;
    readonly startStation: number;
    readonly endStation: number;
    readonly unnamedEdges?: number;
  },
): void {
  expect(snapshot.history).toBe("complete");
  for (const descriptor of descriptors(snapshot)) {
    const lineage = featureLineage(descriptor, feature);
    expect(descriptor.lineage).toEqual(lineage);
    expect(lineage.filter((item) => item.role === undefined)).toEqual([
      { feature, relation: "created" },
    ]);
    expect(lineage.every((item) => item.relation === "created")).toBe(true);

    const semantic = semanticLineage(descriptor, feature);
    if (semantic.length === 0) {
      expect(descriptor.topology).toBe("edge");
      continue;
    }
    expect(semantic.length).toBeGreaterThan(0);
    const roles = [...new Set(semantic.map((item) => item.role))];
    expect(roles).toHaveLength(1);
    expect(
      descriptor.topology === "face"
        ? FACE_LOFT_ROLES.includes(roles[0] as (typeof FACE_LOFT_ROLES)[number])
        : EDGE_LOFT_ROLES.includes(roles[0] as (typeof EDGE_LOFT_ROLES)[number]),
    ).toBe(true);
  }

  expect(descriptorsWithRole(snapshot, feature, "loft.face.start-cap")).toHaveLength(
    1,
  );
  expect(descriptorsWithRole(snapshot, feature, "loft.face.end-cap")).toHaveLength(
    1,
  );
  expect(descriptorsWithRole(snapshot, feature, "loft.face.side")).toHaveLength(
    expected.sideFaces,
  );
  expect(
    descriptorsWithRole(snapshot, feature, "loft.edge.section-rim"),
  ).toHaveLength(expected.sectionRims);
  expect(descriptorsWithRole(snapshot, feature, "loft.edge.lateral")).toHaveLength(
    expected.lateralEdges,
  );
  expect(
    snapshot.edges.filter(
      (edge) => semanticLineage(edge, feature).length === 0,
    ),
  ).toHaveLength(expected.unnamedEdges ?? 0);

  const startCap = descriptorsWithRole(
    snapshot,
    feature,
    "loft.face.start-cap",
  )[0]!;
  const endCap = descriptorsWithRole(
    snapshot,
    feature,
    "loft.face.end-cap",
  )[0]!;
  expect(startCap.topology).toBe("face");
  expect(endCap.topology).toBe("face");
  expect(startCap.center[2]).toBeCloseTo(expected.startStation, 6);
  expect(endCap.center[2]).toBeCloseTo(expected.endStation, 6);

  expectUnsourcedRole(snapshot, feature, "loft.face.start-cap", 1);
  expectUnsourcedRole(snapshot, feature, "loft.face.end-cap", 1);
  expectUnsourcedRole(
    snapshot,
    feature,
    "loft.edge.lateral",
    expected.lateralEdges,
  );

  for (const descriptor of descriptorsWithRole(
    snapshot,
    feature,
    "loft.face.side",
  )) {
    expect(descriptor.topology).toBe("face");
    expect(semanticLineage(descriptor, feature, "loft.face.side")).toHaveLength(
      2,
    );
    expect(lineageSourceKeys(descriptor, feature, "loft.face.side")).toHaveLength(
      2,
    );
  }
  for (const descriptor of descriptorsWithRole(
    snapshot,
    feature,
    "loft.edge.section-rim",
  )) {
    expect(descriptor.topology).toBe("edge");
    expect(
      semanticLineage(descriptor, feature, "loft.edge.section-rim"),
    ).toHaveLength(1);
    expect(
      lineageSourceKeys(descriptor, feature, "loft.edge.section-rim"),
    ).toHaveLength(1);
  }
}

describe("OCCT ruled solid loft", () => {
  it("builds and exports a two-section rectangular frustum", async () => {
    const kernel = await createOcctKernel();
    try {
      expect(kernelSupports(kernel.capabilities, "feature", "loft")).toBe(true);
      expect(kernel.loft).toBeTypeOf("function");

      const shape = kernel.loft!(
        [
          rectangleProfile("bottom-profile", 0, 10, 8),
          rectangleProfile("top-profile", 10, 5, 4),
        ],
        { ruled: true },
        { feature: "two-section-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(1_400 / 3, 8);
        expectVectorClose(measured.boundingBox.min, [-5, -4, 0]);
        expectVectorClose(measured.boundingBox.max, [5, 4, 10]);
        expect(measured.genus).toBe(0);

        const snapshot = topology(kernel, shape);
        expect(snapshot.faces).toHaveLength(6);
        expect(snapshot.edges).toHaveLength(12);
        expect(snapshot.faces.every((face) => face.edges.length === 4)).toBe(
          true,
        );
        expect(snapshot.edges.every((edge) => edge.faces.length === 2)).toBe(
          true,
        );
        expectCompleteLoftInventory(snapshot, "two-section-loft", {
          sideFaces: 4,
          sectionRims: 8,
          lateralEdges: 4,
          startStation: 0,
          endStation: 10,
        });
        expectSourceAnchors(
          snapshot,
          "two-section-loft",
          "loft.face.side",
          adjacentSectionSources("bottom-profile", "top-profile"),
        );
        expectSourceAnchors(
          snapshot,
          "two-section-loft",
          "loft.edge.section-rim",
          sectionRimSources(["bottom-profile", "top-profile"]),
        );
        const positions = [
          ["bottom", 1, -1],
          ["right", 0, 1],
          ["top", 1, 1],
          ["left", 0, -1],
        ] as const;
        for (const [entity, axis, sign] of positions) {
          const side = descriptorsWithRoleAndSource(
            snapshot,
            "two-section-loft",
            "loft.face.side",
            source("bottom-profile", entity),
          );
          expect(side).toHaveLength(1);
          expect(side[0]!.center[axis] * sign).toBeGreaterThan(0);
          for (const [sketch, station] of [
            ["bottom-profile", 0],
            ["top-profile", 10],
          ] as const) {
            const rim = descriptorsWithRoleAndSource(
              snapshot,
              "two-section-loft",
              "loft.edge.section-rim",
              source(sketch, entity),
            );
            expect(rim).toHaveLength(1);
            expect(rim[0]!.center[axis] * sign).toBeGreaterThan(0);
            expect(rim[0]!.bounds.min[2]).toBeCloseTo(station, 6);
            expect(rim[0]!.bounds.max[2]).toBeCloseTo(station, 6);
          }
        }

        const step = kernel.exportShape!(shape, "step");
        expect(step).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(step)).toContain("ISO-10303-21");
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves the bounded topology inventory across three ruled sections", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.loft!(
        [
          rectangleProfile("section-0", 0, 10, 10),
          rectangleProfile("section-1", 4, 6, 6),
          rectangleProfile("section-2", 10, 8, 8),
        ],
        { ruled: true },
        { feature: "three-section-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(1_672 / 3, 8);
        expectVectorClose(measured.boundingBox.min, [-5, -5, 0]);
        expectVectorClose(measured.boundingBox.max, [5, 5, 10]);
        expect(measured.genus).toBe(0);

        const snapshot = topology(kernel, shape);
        expect(snapshot.faces).toHaveLength(10);
        expect(snapshot.edges).toHaveLength(20);
        expect(snapshot.faces.every((face) => face.edges.length === 4)).toBe(
          true,
        );
        expect(snapshot.edges.every((edge) => edge.faces.length === 2)).toBe(
          true,
        );
        expectCompleteLoftInventory(snapshot, "three-section-loft", {
          sideFaces: 8,
          sectionRims: 12,
          lateralEdges: 8,
          startStation: 0,
          endStation: 10,
        });
        expectSourceAnchors(
          snapshot,
          "three-section-loft",
          "loft.face.side",
          [
            ...adjacentSectionSources("section-0", "section-1"),
            ...adjacentSectionSources("section-1", "section-2"),
          ],
        );
        expectSourceAnchors(
          snapshot,
          "three-section-loft",
          "loft.edge.section-rim",
          sectionRimSources(["section-0", "section-1", "section-2"]),
        );
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("preserves exact circular sections in a conical frustum", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.loft!(
        [circleProfile("base", 0, 4), circleProfile("tip", 6, 2)],
        { ruled: true },
        { feature: "circular-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const measured = kernel.measure(shape);
        expect(measured.volume).toBeCloseTo(56 * Math.PI, 8);
        expectVectorClose(measured.boundingBox.min, [-4, -4, 0]);
        expectVectorClose(measured.boundingBox.max, [4, 4, 6]);

        const snapshot = topology(kernel, shape);
        expect(snapshot.faces).toHaveLength(3);
        expect(snapshot.edges).toHaveLength(3);
        expectCompleteLoftInventory(snapshot, "circular-loft", {
          sideFaces: 1,
          sectionRims: 2,
          lateralEdges: 0,
          startStation: 0,
          endStation: 6,
          unnamedEdges: 1,
        });
        expectSourceAnchors(
          snapshot,
          "circular-loft",
          "loft.face.side",
          adjacentSectionSources("base", "tip", ["circle"]),
        );
        expectSourceAnchors(
          snapshot,
          "circular-loft",
          "loft.edge.section-rim",
          sectionRimSources(["base", "tip"], ["circle"]),
        );
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("assigns cap roles by authored order for descending stations", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.loft!(
        [
          rectangleProfile("authored-start", 10, 6, 4),
          rectangleProfile("authored-end", 0, 4, 2),
        ],
        { ruled: true },
        { feature: "descending-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        expectCompleteLoftInventory(topology(kernel, shape), "descending-loft", {
          sideFaces: 4,
          sectionRims: 8,
          lateralEdges: 4,
          startStation: 10,
          endStation: 0,
        });
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("retains loft roles without inventing sources for direct profiles", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.loft!(
        [
          withoutCurveSources(rectangleProfile("ignored-start", 0, 6, 4)),
          withoutCurveSources(rectangleProfile("ignored-end", 10, 4, 2)),
        ],
        { ruled: true },
        { feature: "unsourced-loft", tolerance: 1e-7 },
      );
      try {
        const snapshot = topology(kernel, shape);
        expect(snapshot.history).toBe("complete");
        const expectedCounts = {
          "loft.face.start-cap": 1,
          "loft.face.end-cap": 1,
          "loft.face.side": 4,
          "loft.edge.section-rim": 8,
          "loft.edge.lateral": 4,
        } as const;
        for (const [role, count] of Object.entries(expectedCounts) as readonly [
          LoftRole,
          number,
        ][]) {
          const matching = descriptorsWithRole(
            snapshot,
            "unsourced-loft",
            role,
          );
          expect(matching).toHaveLength(count);
          expect(
            matching.flatMap((descriptor) =>
              semanticLineage(descriptor, "unsourced-loft", role),
            ).every((lineage) => lineage.source === undefined),
          ).toBe(true);
        }
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("names final lateral edges when corresponding arc radii change", async () => {
    const kernel = await createOcctKernel();
    try {
      const shape = kernel.loft!(
        [archedProfile("arched-start", 0, 1), archedProfile("arched-end", 8, 2)],
        { ruled: true },
        { feature: "arched-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        const snapshot = topology(kernel, shape);
        expectCompleteLoftInventory(snapshot, "arched-loft", {
          sideFaces: 4,
          sectionRims: 8,
          lateralEdges: 4,
          startStation: 0,
          endStation: 8,
        });
        expectSourceAnchors(
          snapshot,
          "arched-loft",
          "loft.face.side",
          adjacentSectionSources("arched-start", "arched-end", [
            "arc",
            "left",
            "bottom",
            "right",
          ]),
        );
        expectSourceAnchors(
          snapshot,
          "arched-loft",
          "loft.edge.section-rim",
          sectionRimSources(["arched-start", "arched-end"], [
            "arc",
            "left",
            "bottom",
            "right",
          ]),
        );
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("keeps semantic seeds distinct at large world coordinates", async () => {
    const kernel = await createOcctKernel();
    try {
      const world = 1_000_000_000_000;
      const shape = kernel.loft!(
        [
          rectangleProfile("world-start", world, 10, 8, [world, -world]),
          rectangleProfile(
            "world-end",
            world + 10,
            5,
            4,
            [world, -world],
          ),
        ],
        { ruled: true },
        { feature: "large-world-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(shape)).toEqual({ ok: true, code: "VALID" });
        expectCompleteLoftInventory(
          topology(kernel, shape),
          "large-world-loft",
          {
            sideFaces: 4,
            sectionRims: 8,
            lateralEdges: 4,
            startStation: world,
            endStation: world + 10,
          },
        );
      } finally {
        kernel.disposeShape(shape);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("rejects a cyclically shifted boundary before native loft construction", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as Record<string, any>;
    const originalLoft = raw.loft.bind(raw) as (...arguments_: any[]) => any;
    let loftCalls = 0;
    try {
      raw.loft = (...arguments_: any[]) => {
        loftCalls += 1;
        return originalLoft(...arguments_);
      };
      expect(() =>
        kernel.loft!(
          [
            rectangleProfile("phase-start", 0, 6, 4),
            rotateProfileCurvePhase(
              rectangleProfile("phase-end", 10, 6, 4),
              1,
            ),
          ],
          { ruled: true },
          { feature: "shifted-phase-loft", tolerance: 1e-7 },
        ),
      ).toThrow("preserve the authored boundary curve phase");
      expect(loftCalls).toBe(0);
    } finally {
      raw.loft = originalLoft;
      kernel.dispose();
    }
  });

  it("downgrades annotation-only native failures, cleans temporaries, and recovers", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as Record<string, any>;
    const originalLoft = raw.loft.bind(raw) as (...arguments_: any[]) => any;
    const originalMakeWire = raw.makeWire.bind(raw) as (
      ...arguments_: any[]
    ) => any;
    const originalRelease = raw.release.bind(raw) as (
      ...arguments_: any[]
    ) => any;
    const annotationWires: unknown[] = [];
    const released: unknown[] = [];
    let mainSolidBuilt = false;
    let shape: KernelShape | undefined;
    try {
      raw.makeWire = (...arguments_: any[]) => {
        const handle = originalMakeWire(...arguments_);
        if (mainSolidBuilt) annotationWires.push(handle);
        return handle;
      };
      raw.release = (handle: unknown) => {
        released.push(handle);
        return originalRelease(handle);
      };
      raw.loft = (
        wires: unknown,
        isSolid: boolean,
        ruled: boolean,
      ) => {
        if (!isSolid) throw new Error("injected annotation loft failure");
        const handle = originalLoft(wires, isSolid, ruled);
        mainSolidBuilt = true;
        return handle;
      };
      shape = kernel.loft!(
        [
          rectangleProfile("failure-start", 0, 6, 4),
          rectangleProfile("failure-end", 10, 4, 2),
        ],
        { ruled: true },
        { feature: "partial-loft", tolerance: 1e-7 },
      );
    } finally {
      raw.loft = originalLoft;
      raw.makeWire = originalMakeWire;
      raw.release = originalRelease;
    }

    try {
      expect(shape).toBeDefined();
      expect(kernel.status(shape!)).toEqual({ ok: true, code: "VALID" });
      const partial = topology(kernel, shape!);
      expect(partial.history).toBe("partial");
      expect(
        descriptorsWithRole(partial, "partial-loft", "loft.face.start-cap"),
      ).toHaveLength(1);
      expect(
        descriptorsWithRole(partial, "partial-loft", "loft.face.end-cap"),
      ).toHaveLength(1);
      expect(
        descriptorsWithRole(partial, "partial-loft", "loft.face.side"),
      ).toHaveLength(0);
      expect(
        descriptorsWithRole(partial, "partial-loft", "loft.edge.section-rim"),
      ).toHaveLength(8);
      expect(
        descriptorsWithRole(partial, "partial-loft", "loft.edge.lateral"),
      ).toHaveLength(0);
      expect(annotationWires).toHaveLength(8);
      for (const handle of annotationWires) {
        expect(released.filter((candidate) => candidate === handle)).toHaveLength(
          1,
        );
      }
    } finally {
      if (shape !== undefined) kernel.disposeShape(shape);
    }

    try {
      const recovered = kernel.loft!(
        [
          rectangleProfile("recovery-start", 0, 6, 4),
          rectangleProfile("recovery-end", 10, 4, 2),
        ],
        { ruled: true },
        { feature: "recovered-annotation-loft", tolerance: 1e-7 },
      );
      try {
        expect(topology(kernel, recovered).history).toBe("complete");
      } finally {
        kernel.disposeShape(recovered);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("cancels during annotation construction, cleans up, and recovers", async () => {
    const kernel = await createOcctKernel();
    const raw = (kernel as any).raw as Record<string, any>;
    const originalLoft = raw.loft.bind(raw) as (...arguments_: any[]) => any;
    const originalMakeWire = raw.makeWire.bind(raw) as (
      ...arguments_: any[]
    ) => any;
    const originalRelease = raw.release.bind(raw) as (
      ...arguments_: any[]
    ) => any;
    const abort = new AbortController();
    const annotationWires: unknown[] = [];
    const loftResults: unknown[] = [];
    const released: unknown[] = [];
    let mainSolidBuilt = false;
    let loftCalls = 0;
    try {
      try {
        raw.makeWire = (...arguments_: any[]) => {
          const handle = originalMakeWire(...arguments_);
          if (mainSolidBuilt) annotationWires.push(handle);
          return handle;
        };
        raw.release = (handle: unknown) => {
          released.push(handle);
          return originalRelease(handle);
        };
        raw.loft = (...arguments_: any[]) => {
          const handle = originalLoft(...arguments_);
          loftResults.push(handle);
          loftCalls += 1;
          if (loftCalls === 1) mainSolidBuilt = true;
          if (loftCalls === 2) abort.abort();
          return handle;
        };
        expect(() =>
          kernel.loft!(
            [
              rectangleProfile("cancel-start", 0, 6, 4),
              rectangleProfile("cancel-end", 10, 4, 2),
            ],
            { ruled: true },
            {
              feature: "cancelled-annotation-loft",
              tolerance: 1e-7,
              signal: abort.signal,
            },
          ),
        ).toThrow("aborted");
        expect(loftCalls).toBe(2);
        expect(annotationWires).toHaveLength(2);
        for (const handle of [...annotationWires, ...loftResults]) {
          expect(
            released.filter((candidate) => candidate === handle),
          ).toHaveLength(1);
        }
      } finally {
        raw.loft = originalLoft;
        raw.makeWire = originalMakeWire;
        raw.release = originalRelease;
      }

      const recovered = kernel.loft!(
        [
          rectangleProfile("cancel-recovery-start", 0, 6, 4),
          rectangleProfile("cancel-recovery-end", 10, 4, 2),
        ],
        { ruled: true },
        { feature: "cancel-recovery-loft", tolerance: 1e-7 },
      );
      try {
        expect(topology(kernel, recovered).history).toBe("complete");
      } finally {
        kernel.disposeShape(recovered);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("cleans failed section construction and remains usable", async () => {
    const kernel = await createOcctKernel();
    try {
      const valid = rectangleProfile("valid-profile", 0, 4, 4);
      const invalidStart = selfIntersectingProfile("crossed-start", 0);
      const invalidEnd = selfIntersectingProfile("crossed-end", 5);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(() =>
          kernel.loft!(
            [invalidStart, invalidEnd],
            { ruled: true },
            { feature: `failed-loft-${attempt}`, tolerance: 1e-7 },
          ),
        ).toThrow("does not form a valid simple planar face");
      }

      const box = kernel.box!([2, 3, 4], false, { feature: "after-failure" });
      const recovered = kernel.loft!(
        [valid, rectangleProfile("recovery-profile", 5, 2, 2)],
        { ruled: true },
        { feature: "recovered-loft", tolerance: 1e-7 },
      );
      try {
        expect(kernel.status(box)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(box).volume).toBeCloseTo(24, 8);
        expect(kernel.status(recovered)).toEqual({ ok: true, code: "VALID" });
        expect(kernel.measure(recovered).volume).toBeCloseTo(140 / 3, 8);
        expect(topology(kernel, recovered).faces).toHaveLength(6);
      } finally {
        kernel.disposeShape(recovered);
        kernel.disposeShape(box);
      }
    } finally {
      kernel.dispose();
    }
  });
});
