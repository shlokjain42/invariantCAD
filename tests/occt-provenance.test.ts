import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type GeometryKernel,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelShape,
  type KernelTopologyLineage,
  type KernelTopologySnapshot,
  type NumericPlane,
  type ProfileCurveSource,
  type ResolvedProfile,
  type ResolvedTransformOperation,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

type Descriptor = KernelFaceDescriptor | KernelEdgeDescriptor;

let kernel: GeometryKernel;

beforeAll(async () => {
  kernel = await createOcctKernel();
});

afterAll(() => kernel.dispose());

function snapshot(shape: KernelShape): KernelTopologySnapshot {
  const value = kernel.topology?.(shape);
  if (value === undefined) throw new Error("OCCT topology support is unavailable");
  return value;
}

function descriptors(value: KernelTopologySnapshot): readonly Descriptor[] {
  return [...value.faces, ...value.edges];
}

function featureLineage(
  descriptor: Descriptor,
  feature: string,
): readonly KernelTopologyLineage[] {
  return descriptor.lineage.filter((item) => item.feature === feature);
}

function roleOf(descriptor: Descriptor, feature: string): string | undefined {
  const roles = featureLineage(descriptor, feature).flatMap((item) =>
    item.role === undefined ? [] : [item.role],
  );
  expect(roles.length).toBeLessThanOrEqual(1);
  return roles[0];
}

function roleInventory(
  values: readonly Descriptor[],
  feature: string,
): readonly string[] {
  return values.flatMap((descriptor) => {
    const role = roleOf(descriptor, feature);
    return role === undefined ? [] : [role];
  });
}

function expectBroadCreation(
  value: KernelTopologySnapshot,
  feature: string,
): void {
  for (const descriptor of descriptors(value)) {
    expect(descriptor.lineage).toContainEqual({
      feature,
      relation: "created",
    });
  }
}

function source(entity: string, sketch: string): ProfileCurveSource {
  return {
    kind: "sketch-entity",
    sketch,
    entity: entity as ProfileCurveSource["entity"],
  };
}

function rectangleProfile(
  plane: NumericPlane,
  sketch = "profile",
  width = 4,
  height = 3,
): ResolvedProfile {
  return {
    plane,
    outer: {
      curves: [
        {
          kind: "line",
          start: [0, 0],
          end: [width, 0],
          source: source("bottom", sketch),
        },
        {
          kind: "line",
          start: [width, 0],
          end: [width, height],
          source: source("right", sketch),
        },
        {
          kind: "line",
          start: [width, height],
          end: [0, height],
          source: source("top", sketch),
        },
        {
          kind: "line",
          start: [0, height],
          end: [0, 0],
          source: source("left", sketch),
        },
      ],
    },
    holes: [],
  };
}

function normalForPlane(plane: NumericPlane["plane"]): readonly [number, number, number] {
  switch (plane) {
    case "XY":
      return [0, 0, 1];
    case "XZ":
      return [0, -1, 0];
    case "YZ":
      return [1, 0, 0];
  }
}

function dot(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function descriptorWithRole(
  values: readonly Descriptor[],
  feature: string,
  role: string,
): Descriptor {
  const matches = values.filter(
    (descriptor) => roleOf(descriptor, feature) === role,
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

function expectRectangleExtrusionInventory(
  value: KernelTopologySnapshot,
  feature: string,
  sketch: string,
): void {
  expect(value.history).toBe("complete");
  expect(value.faces).toHaveLength(6);
  expect(value.edges).toHaveLength(12);
  expectBroadCreation(value, feature);

  expect([...roleInventory(value.faces, feature)].sort()).toEqual(
    [
      "extrude.face.end-cap",
      "extrude.face.side",
      "extrude.face.side",
      "extrude.face.side",
      "extrude.face.side",
      "extrude.face.start-cap",
    ].sort(),
  );
  expect([...roleInventory(value.edges, feature)].sort()).toEqual(
    [
      ...Array.from({ length: 4 }, () => "extrude.edge.start-rim"),
      ...Array.from({ length: 4 }, () => "extrude.edge.end-rim"),
      ...Array.from({ length: 4 }, () => "extrude.edge.lateral"),
    ].sort(),
  );

  for (const entity of ["bottom", "right", "top", "left"]) {
    for (const role of [
      "extrude.face.side",
      "extrude.edge.start-rim",
      "extrude.edge.end-rim",
    ]) {
      const matches = descriptors(value).filter((descriptor) =>
        descriptor.lineage.some(
          (item) =>
            item.feature === feature &&
            item.relation === "created" &&
            item.role === role &&
            item.source?.kind === "sketch-entity" &&
            item.source.sketch === sketch &&
            item.source.entity === entity,
        ),
      );
      expect(matches, `${entity} should identify one ${role}`).toHaveLength(1);
    }
  }

  for (const role of [
    "extrude.face.start-cap",
    "extrude.face.end-cap",
    "extrude.edge.lateral",
  ]) {
    const matches = descriptors(value).filter(
      (descriptor) => roleOf(descriptor, feature) === role,
    );
    expect(matches.length).toBeGreaterThan(0);
    for (const descriptor of matches) {
      expect(
        featureLineage(descriptor, feature).some(
          (item) => item.source !== undefined,
        ),
      ).toBe(false);
    }
  }
}

function expectRectangleRevolutionInventory(
  value: KernelTopologySnapshot,
  feature: string,
  sketch: string,
  partial: boolean,
): void {
  expect(value.history).toBe("complete");
  expect(value.faces).toHaveLength(partial ? 5 : 3);
  expect(value.edges).toHaveLength(partial ? 9 : 3);
  expectBroadCreation(value, feature);

  expect([...roleInventory(value.faces, feature)].sort()).toEqual(
    [
      "revolve.face.swept",
      "revolve.face.swept",
      "revolve.face.swept",
      ...(partial
        ? ["revolve.face.start-cap", "revolve.face.end-cap"]
        : []),
    ].sort(),
  );
  expect(roleInventory(value.edges, feature)).toEqual([]);

  for (const entity of ["bottom", "right", "top"]) {
    expect(
      value.faces.filter((face) =>
        face.lineage.some(
          (item) =>
            item.feature === feature &&
            item.relation === "created" &&
            item.role === "revolve.face.swept" &&
            item.source?.kind === "sketch-entity" &&
            item.source.sketch === sketch &&
            item.source.entity === entity,
        ),
      ),
      `${entity} should identify one swept face`,
    ).toHaveLength(1);
  }
  expect(
    descriptors(value).filter((descriptor) =>
      descriptor.lineage.some(
        (item) =>
          item.feature === feature &&
          item.source?.kind === "sketch-entity" &&
          item.source.sketch === sketch &&
          item.source.entity === "left",
      ),
    ),
  ).toHaveLength(0);

  for (const descriptor of descriptors(value)) {
    for (const item of featureLineage(descriptor, feature)) {
      if (
        item.role === "revolve.face.start-cap" ||
        item.role === "revolve.face.end-cap"
      ) {
        expect(item.source).toBeUndefined();
      }
    }
  }
}

function expectCurveSourceTriplet(
  value: KernelTopologySnapshot,
  feature: string,
  sketch: string,
  entity: string,
): void {
  for (const role of [
    "extrude.face.side",
    "extrude.edge.start-rim",
    "extrude.edge.end-rim",
  ]) {
    expect(
      descriptors(value).filter((descriptor) =>
        descriptor.lineage.some(
          (item) =>
            item.feature === feature &&
            item.relation === "created" &&
            item.role === role &&
            item.source?.kind === "sketch-entity" &&
            item.source.sketch === sketch &&
            item.source.entity === entity,
        ),
      ),
      `${entity} should identify one ${role}`,
    ).toHaveLength(1);
  }
}

describe("OCCT semantic provenance inventory", () => {
  it("assigns every box face and edge one cardinality-stable local role", () => {
    const shape = kernel.box!([2, 3, 4], true, { feature: "box" });
    try {
      const value = snapshot(shape);
      expect(value.history).toBe("complete");
      expect(value.faces).toHaveLength(6);
      expect(value.edges).toHaveLength(12);
      expectBroadCreation(value, "box");

      expect([...roleInventory(value.faces, "box")].sort()).toEqual(
        [
          "box.face.x-min",
          "box.face.x-max",
          "box.face.y-min",
          "box.face.y-max",
          "box.face.z-min",
          "box.face.z-max",
        ].sort(),
      );
      expect([...roleInventory(value.edges, "box")].sort()).toEqual(
        [
          "box.edge.x-min-y-min",
          "box.edge.x-min-y-max",
          "box.edge.x-max-y-min",
          "box.edge.x-max-y-max",
          "box.edge.x-min-z-min",
          "box.edge.x-min-z-max",
          "box.edge.x-max-z-min",
          "box.edge.x-max-z-max",
          "box.edge.y-min-z-min",
          "box.edge.y-min-z-max",
          "box.edge.y-max-z-min",
          "box.edge.y-max-z-max",
        ].sort(),
      );
      for (const descriptor of descriptors(value)) {
        expect(roleOf(descriptor, "box")).toBeDefined();
        expect(
          featureLineage(descriptor, "box").some(
            (item) => item.source !== undefined,
          ),
        ).toBe(false);
      }
    } finally {
      kernel.disposeShape(shape);
    }
  });

  it.each([
    {
      name: "cylinder",
      bottom: 2,
      top: 2,
      faces: [
        "cylinder.face.start-cap",
        "cylinder.face.end-cap",
        "cylinder.face.side",
      ],
      edges: ["cylinder.edge.start-rim", "cylinder.edge.end-rim"],
      unnamedEdges: 1,
      degenerateEdges: 0,
    },
    {
      name: "frustum",
      bottom: 2,
      top: 1,
      faces: [
        "cylinder.face.start-cap",
        "cylinder.face.end-cap",
        "cylinder.face.side",
      ],
      edges: ["cylinder.edge.start-rim", "cylinder.edge.end-rim"],
      unnamedEdges: 1,
      degenerateEdges: 0,
    },
    {
      name: "top-apex cone",
      bottom: 2,
      top: 0,
      faces: ["cylinder.face.start-cap", "cylinder.face.side"],
      edges: ["cylinder.edge.start-rim"],
      unnamedEdges: 2,
      degenerateEdges: 1,
    },
    {
      name: "bottom-apex cone",
      bottom: 0,
      top: 2,
      faces: ["cylinder.face.end-cap", "cylinder.face.side"],
      edges: ["cylinder.edge.end-rim"],
      unnamedEdges: 2,
      degenerateEdges: 1,
    },
  ])(
    "names the semantic rims/faces and leaves $name kernel artifacts unnamed",
    ({ name, bottom, top, faces, edges, unnamedEdges, degenerateEdges }) => {
      const feature = name.replaceAll(" ", "-");
      const shape = kernel.cylinder!(
        5,
        bottom,
        top,
        false,
        undefined,
        { feature },
      );
      try {
        const value = snapshot(shape);
        expect(value.history).toBe("complete");
        expect(value.faces).toHaveLength(faces.length);
        expect(value.edges).toHaveLength(edges.length + unnamedEdges);
        expect([...roleInventory(value.faces, feature)].sort()).toEqual(
          [...faces].sort(),
        );
        expect([...roleInventory(value.edges, feature)].sort()).toEqual(
          [...edges].sort(),
        );
        expectBroadCreation(value, feature);

        const unnamed = value.edges.filter(
          (edge) => roleOf(edge, feature) === undefined,
        );
        expect(unnamed).toHaveLength(unnamedEdges);
        expect(
          unnamed.filter((edge) => edge.length <= 1e-7),
        ).toHaveLength(degenerateEdges);
        for (const edge of unnamed) {
          expect(
            featureLineage(edge, feature).some(
              (item) => item.source !== undefined,
            ),
          ).toBe(false);
        }
      } finally {
        kernel.disposeShape(shape);
      }
    },
  );

  it("names the sphere surface while leaving its seam and pole artifacts unnamed", () => {
    const shape = kernel.sphere!(2, undefined, { feature: "sphere" });
    try {
      const value = snapshot(shape);
      expect(value.history).toBe("complete");
      expect(value.faces).toHaveLength(1);
      expect(value.edges).toHaveLength(3);
      expect(roleInventory(value.faces, "sphere")).toEqual([
        "sphere.face.surface",
      ]);
      expect(roleInventory(value.edges, "sphere")).toEqual([]);
      expectBroadCreation(value, "sphere");

      const poles = value.edges.filter((edge) => edge.length <= 1e-7);
      const seam = value.edges.filter((edge) => edge.length > 1e-7);
      expect(poles).toHaveLength(2);
      expect(poles.every((edge) => edge.curve.kind === "other")).toBe(true);
      expect(seam).toHaveLength(1);
      expect(seam[0]!.curve.kind).toBe("circle");
      expect(seam[0]!.length).toBeCloseTo(Math.PI * 2, 8);
    } finally {
      kernel.disposeShape(shape);
    }
  });

  it("maps every rectangle curve source to one side and both rim edges", () => {
    const profile = rectangleProfile({ plane: "XY", origin: [1, 2, 3] });
    const shape = kernel.extrude!(
      profile,
      {
        distance: 5,
        symmetric: false,
        twist: 0,
        scaleTop: [1, 1],
        divisions: 0,
      },
      { feature: "extrude" },
    );
    try {
      expectRectangleExtrusionInventory(snapshot(shape), "extrude", "profile");
    } finally {
      kernel.disposeShape(shape);
    }
  });

  it.each([
    { plane: "XY" as const, angle: Math.PI * 2 },
    { plane: "XZ" as const, angle: Math.PI / 2 },
    { plane: "YZ" as const, angle: Math.PI },
  ])(
    "maps rectangle revolution faces and sources on $plane through $angle radians",
    ({ plane, angle }) => {
      const feature = `revolve-${plane}-${angle}`;
      const sketch = `profile-${plane}-${angle}`;
      const profile = rectangleProfile(
        { plane, origin: [11, -7, 3] },
        sketch,
      );
      const shape = kernel.revolve!(profile, { angle }, { feature });
      try {
        expectRectangleRevolutionInventory(
          snapshot(shape),
          feature,
          sketch,
          angle !== Math.PI * 2,
        );
      } finally {
        kernel.disposeShape(shape);
      }
    },
  );

  it("maps a revolved semicircle while leaving its axis and kernel artifacts unnamed", () => {
    const profile: ResolvedProfile = {
      plane: { plane: "XY", origin: [5, -2, 7] },
      outer: {
        curves: [
          {
            kind: "arc",
            center: [0, 0],
            radius: 4,
            startAngle: -Math.PI / 2,
            endAngle: Math.PI / 2,
            clockwise: false,
            source: source("arc", "sphere-profile"),
          },
          {
            kind: "line",
            start: [0, 4],
            end: [0, -4],
            source: source("axis", "sphere-profile"),
          },
        ],
      },
      holes: [],
    };
    const shape = kernel.revolve!(
      profile,
      { angle: Math.PI * 2 },
      { feature: "sphere-revolve" },
    );
    try {
      const value = snapshot(shape);
      expect(value.history).toBe("complete");
      expect(value.faces).toHaveLength(1);
      expect(value.edges).toHaveLength(3);
      expect(roleInventory(value.faces, "sphere-revolve")).toEqual([
        "revolve.face.swept",
      ]);
      expect(roleInventory(value.edges, "sphere-revolve")).toEqual([]);
      expect(value.faces[0]!.lineage).toContainEqual({
        feature: "sphere-revolve",
        relation: "created",
        role: "revolve.face.swept",
        source: source("arc", "sphere-profile"),
      });
      expect(
        descriptors(value).some((descriptor) =>
          descriptor.lineage.some(
            (item) => item.source?.entity === "axis",
          ),
        ),
      ).toBe(false);
      expectBroadCreation(value, "sphere-revolve");
    } finally {
      kernel.disposeShape(shape);
    }
  });

  it("does not erase a native swept face when caller tolerance exceeds its radius", () => {
    const innerRadius = 2e-7;
    const profile: ResolvedProfile = {
      plane: { plane: "XY", origin: [0, 0, 0] },
      outer: {
        curves: [
          {
            kind: "line",
            start: [innerRadius, 0],
            end: [4, 0],
            source: source("bottom", "thin-profile"),
          },
          {
            kind: "line",
            start: [4, 0],
            end: [4, 3],
            source: source("outer", "thin-profile"),
          },
          {
            kind: "line",
            start: [4, 3],
            end: [innerRadius, 3],
            source: source("top", "thin-profile"),
          },
          {
            kind: "line",
            start: [innerRadius, 3],
            end: [innerRadius, 0],
            source: source("inner", "thin-profile"),
          },
        ],
      },
      holes: [],
    };
    const shape = kernel.revolve!(
      profile,
      { angle: Math.PI * 2 },
      { feature: "thin-revolve", tolerance: 1e-6 },
    );
    try {
      const value = snapshot(shape);
      expect(value.history).toBe("complete");
      expect(value.faces).toHaveLength(4);
      expect(roleInventory(value.faces, "thin-revolve")).toHaveLength(4);
      for (const entity of ["bottom", "outer", "top", "inner"]) {
        expect(
          value.faces.filter((face) =>
            face.lineage.some(
              (item) =>
                item.role === "revolve.face.swept" &&
                item.source?.entity === entity,
            ),
          ),
        ).toHaveLength(1);
      }
    } finally {
      kernel.disposeShape(shape);
    }
  });

  it("downgrades a semantically partial turn when OCCT collapses it to a full turn", () => {
    const shape = kernel.revolve!(
      rectangleProfile({ plane: "XY", origin: [0, 0, 0] }),
      { angle: Math.PI * 2 - 1e-14 },
      { feature: "near-full-revolve" },
    );
    try {
      const value = snapshot(shape);
      expect(value.faces).toHaveLength(3);
      expect(value.history).toBe("partial");
      expect(roleInventory(value.faces, "near-full-revolve")).toEqual([
        "revolve.face.swept",
        "revolve.face.swept",
        "revolve.face.swept",
      ]);
    } finally {
      kernel.disposeShape(shape);
    }
  });

  it("preserves partial-revolution roles and sources through rotation and translation", () => {
    const revolution = kernel.revolve!(
      rectangleProfile(
        { plane: "XY", origin: [2, -3, 5] },
        "transform-revolve-profile",
      ),
      { angle: Math.PI / 2 },
      { feature: "revolve-before-transform" },
    );
    let transformed: KernelShape | undefined;
    try {
      const before = snapshot(revolution);
      transformed = kernel.transform!(
        revolution,
        [
          { kind: "rotate", value: [0.2, 0.4, 0.1] },
          { kind: "translate", value: [100, 5, 7] },
        ],
        { feature: "moved-revolve" },
      );
      const after = snapshot(transformed);
      expect(after.history).toBe("complete");

      const semanticInventory = (
        value: KernelTopologySnapshot,
      ): readonly string[] =>
        descriptors(value)
          .flatMap((descriptor) =>
            featureLineage(descriptor, "revolve-before-transform").flatMap(
              (item) =>
                item.role === undefined
                  ? []
                  : [
                      [
                        descriptor.topology,
                        item.role,
                        item.source?.kind ?? "",
                        item.source?.sketch ?? "",
                        item.source?.entity ?? "",
                      ].join("|"),
                    ],
            ),
          )
          .sort();

      expect(semanticInventory(after)).toEqual(semanticInventory(before));
      expect(roleInventory(after.faces, "revolve-before-transform")).toHaveLength(
        5,
      );
      for (const descriptor of descriptors(after)) {
        expect(descriptor.lineage).toContainEqual({
          feature: "moved-revolve",
          relation: "modified",
        });
      }
    } finally {
      if (transformed !== undefined) kernel.disposeShape(transformed);
      kernel.disposeShape(revolution);
    }
  });

  it("cancels during revolution provenance construction and recovers", async () => {
    const localKernel = await createOcctKernel();
    const raw = (localKernel as any).raw as Record<
      string,
      (...arguments_: any[]) => any
    >;
    const originalRevolve = raw.revolve!.bind(raw);
    const abort = new AbortController();
    let revolveCalls = 0;
    try {
      try {
        raw.revolve = (...arguments_: any[]) => {
          const result = originalRevolve(...arguments_);
          revolveCalls += 1;
          if (revolveCalls === 2) abort.abort();
          return result;
        };
        expect(() =>
          localKernel.revolve!(
            rectangleProfile({ plane: "XY", origin: [0, 0, 0] }),
            { angle: Math.PI * 2 },
            {
              feature: "cancelled-revolve",
              signal: abort.signal,
            },
          ),
        ).toThrow("aborted");
        expect(revolveCalls).toBe(2);
      } finally {
        raw.revolve = originalRevolve;
      }

      const recovered = localKernel.revolve!(
        rectangleProfile({ plane: "XY", origin: [0, 0, 0] }),
        { angle: Math.PI * 2 },
        { feature: "recovered-revolve" },
      );
      try {
        const value = localKernel.topology!(recovered);
        expect(value.history).toBe("complete");
        expect(roleInventory(value.faces, "recovered-revolve")).toHaveLength(
          3,
        );
      } finally {
        localKernel.disposeShape(recovered);
      }
    } finally {
      localKernel.dispose();
    }
  });

  it("maps a circular boundary while leaving its kernel seam unnamed", () => {
    const profile: ResolvedProfile = {
      plane: { plane: "XY", origin: [0, 0, 0] },
      outer: {
        curves: [
          {
            kind: "circle",
            center: [0, 0],
            radius: 2,
            reversed: false,
            source: source("circle", "circle-profile"),
          },
        ],
      },
      holes: [],
    };
    const shape = kernel.extrude!(
      profile,
      {
        distance: 4,
        symmetric: false,
        twist: 0,
        scaleTop: [1, 1],
        divisions: 0,
      },
      { feature: "circle-extrude" },
    );
    try {
      const value = snapshot(shape);
      expect(value.history).toBe("complete");
      expectCurveSourceTriplet(
        value,
        "circle-extrude",
        "circle-profile",
        "circle",
      );
      expect(roleInventory(value.faces, "circle-extrude")).toHaveLength(3);
      expect(roleInventory(value.edges, "circle-extrude")).toHaveLength(2);
      const unnamed = value.edges.filter(
        (edge) => roleOf(edge, "circle-extrude") === undefined,
      );
      expect(unnamed).toHaveLength(1);
      expect(unnamed[0]!.curve.kind).toBe("line");
    } finally {
      kernel.disposeShape(shape);
    }
  });

  it("maps independent arc boundaries without length-based ambiguity", () => {
    const profile: ResolvedProfile = {
      plane: { plane: "XY", origin: [0, 0, 0] },
      outer: {
        curves: [
          {
            kind: "arc",
            center: [0, 0],
            radius: 2,
            startAngle: 0,
            endAngle: Math.PI,
            clockwise: false,
            source: source("upper", "arc-profile"),
          },
          {
            kind: "arc",
            center: [0, 0],
            radius: 2,
            startAngle: Math.PI,
            endAngle: Math.PI * 2,
            clockwise: false,
            source: source("lower", "arc-profile"),
          },
        ],
      },
      holes: [],
    };
    const shape = kernel.extrude!(
      profile,
      {
        distance: 4,
        symmetric: false,
        twist: 0,
        scaleTop: [1, 1],
        divisions: 0,
      },
      { feature: "arc-extrude" },
    );
    try {
      const value = snapshot(shape);
      expect(value.history).toBe("complete");
      expectCurveSourceTriplet(value, "arc-extrude", "arc-profile", "upper");
      expectCurveSourceTriplet(value, "arc-extrude", "arc-profile", "lower");
      expect(roleInventory(value.faces, "arc-extrude")).toHaveLength(4);
      expect(roleInventory(value.edges, "arc-extrude")).toHaveLength(6);
    } finally {
      kernel.disposeShape(shape);
    }
  });

  it("maps a circular hole independently from its outer boundary", () => {
    const rectangle = rectangleProfile(
      { plane: "XY", origin: [0, 0, 0] },
      "hole-profile",
      10,
      8,
    );
    const profile: ResolvedProfile = {
      ...rectangle,
      holes: [
        {
          curves: [
            {
              kind: "circle",
              center: [5, 4],
              radius: 1,
              reversed: true,
              source: source("hole", "hole-profile"),
            },
          ],
        },
      ],
    };
    const shape = kernel.extrude!(
      profile,
      {
        distance: 3,
        symmetric: false,
        twist: 0,
        scaleTop: [1, 1],
        divisions: 0,
      },
      { feature: "hole-extrude" },
    );
    try {
      const value = snapshot(shape);
      expect(value.history).toBe("complete");
      expectCurveSourceTriplet(value, "hole-extrude", "hole-profile", "hole");
      expect(roleInventory(value.faces, "hole-extrude")).toHaveLength(7);
      expect(roleInventory(value.edges, "hole-extrude")).toHaveLength(14);
      expect(
        value.edges.filter(
          (edge) => roleOf(edge, "hole-extrude") === undefined,
        ),
      ).toHaveLength(1);
    } finally {
      kernel.disposeShape(shape);
    }
  });

  it.each([
    { plane: "XY" as const, distance: 5, symmetric: false },
    { plane: "XZ" as const, distance: 6, symmetric: true },
    { plane: "YZ" as const, distance: -7, symmetric: false },
    { plane: "XY" as const, distance: -8, symmetric: true },
  ])(
    "keeps start/end provenance on $plane with distance $distance and symmetric=$symmetric",
    ({ plane, distance, symmetric }) => {
      const feature = `extrude-${plane}-${distance}-${symmetric}`;
      const sketch = `profile-${plane}-${distance}-${symmetric}`;
      const profile = rectangleProfile(
        { plane, origin: [1, 2, 3] },
        sketch,
      );
      const shape = kernel.extrude!(
        profile,
        {
          distance,
          symmetric,
          twist: 0,
          scaleTop: [1, 1],
          divisions: 0,
        },
        { feature },
      );
      try {
        const value = snapshot(shape);
        expectRectangleExtrusionInventory(value, feature, sketch);

        const normal = normalForPlane(plane);
        const originProjection = dot(profile.plane.origin, normal);
        const startProjection =
          originProjection + (symmetric ? -distance / 2 : 0);
        const endProjection = startProjection + distance;
        const start = descriptorWithRole(
          value.faces,
          feature,
          "extrude.face.start-cap",
        );
        const end = descriptorWithRole(
          value.faces,
          feature,
          "extrude.face.end-cap",
        );
        expect(dot(start.center, normal)).toBeCloseTo(startProjection, 8);
        expect(dot(end.center, normal)).toBeCloseTo(endProjection, 8);
      } finally {
        kernel.disposeShape(shape);
      }
    },
  );

  it("preserves exact roles and curve sources through rotation and translation", () => {
    const profile = rectangleProfile(
      { plane: "XY", origin: [0, 0, 0] },
      "transform-profile",
      4,
      4,
    );
    const extrusion = kernel.extrude!(
      profile,
      {
        distance: 5,
        symmetric: false,
        twist: 0,
        scaleTop: [1, 1],
        divisions: 0,
      },
      { feature: "extrude-before-transform" },
    );
    let transformed: KernelShape | undefined;
    try {
      const before = snapshot(extrusion);
      transformed = kernel.transform!(
        extrusion,
        [
          { kind: "rotate", value: [0, 0, Math.PI / 2] },
          { kind: "translate", value: [100, 5, 7] },
        ],
        { feature: "moved" },
      );
      const after = snapshot(transformed);
      expect(after.history).toBe("complete");

      const semanticInventory = (
        value: KernelTopologySnapshot,
      ): readonly string[] =>
        descriptors(value)
          .flatMap((descriptor) =>
            featureLineage(descriptor, "extrude-before-transform").flatMap(
              (item) =>
                item.role === undefined
                  ? []
                  : [
                      [
                        descriptor.topology,
                        item.role,
                        item.source?.kind ?? "",
                        item.source?.sketch ?? "",
                        item.source?.entity ?? "",
                      ].join("|"),
                    ],
            ),
          )
          .sort();

      expect(semanticInventory(after)).toEqual(semanticInventory(before));
      for (const descriptor of descriptors(after)) {
        expect(descriptor.lineage).toContainEqual({
          feature: "moved",
          relation: "modified",
        });
      }
      const rightEndRim = descriptors(after).filter((descriptor) =>
        descriptor.lineage.some(
          (item) =>
            item.feature === "extrude-before-transform" &&
            item.role === "extrude.edge.end-rim" &&
            item.source?.sketch === "transform-profile" &&
            item.source.entity === "right",
        ),
      );
      expect(rightEndRim).toHaveLength(1);
      expect(rightEndRim[0]!.topology).toBe("edge");
    } finally {
      if (transformed !== undefined) kernel.disposeShape(transformed);
      kernel.disposeShape(extrusion);
    }
  });

  it.each([
    {
      name: "translation",
      operations: [
        { kind: "translate", value: [7, -3, 11] },
      ] as readonly ResolvedTransformOperation[],
    },
    {
      name: "Euler rotation",
      operations: [
        { kind: "rotate", value: [0.2, 0.4, 0.1] },
      ] as readonly ResolvedTransformOperation[],
    },
    {
      name: "mirror",
      operations: [
        { kind: "mirror", normal: [1, 0, 0] },
      ] as readonly ResolvedTransformOperation[],
    },
    {
      name: "uniform scale",
      operations: [
        { kind: "scale", value: [2, 2, 2] },
      ] as readonly ResolvedTransformOperation[],
    },
    {
      name: "nonuniform scale",
      operations: [
        { kind: "scale", value: [2, 0.5, 3] },
      ] as readonly ResolvedTransformOperation[],
    },
  ])("preserves a box's semantic inventory through $name", ({ operations }) => {
    const box = kernel.box!([2, 3, 4], true, { feature: "source-box" });
    let transformed: KernelShape | undefined;
    try {
      const before = snapshot(box);
      transformed = kernel.transform!(box, operations, {
        feature: "box-transform",
      });
      const after = snapshot(transformed);
      expect(after.history).toBe("complete");
      expect([...roleInventory(after.faces, "source-box")].sort()).toEqual(
        [...roleInventory(before.faces, "source-box")].sort(),
      );
      expect([...roleInventory(after.edges, "source-box")].sort()).toEqual(
        [...roleInventory(before.edges, "source-box")].sort(),
      );
      const beforeKeys = new Set(
        descriptors(before).map((descriptor) => descriptor.key),
      );
      for (const descriptor of descriptors(after)) {
        expect(beforeKeys.has(descriptor.key)).toBe(false);
        expect(descriptor.lineage).toContainEqual({
          feature: "box-transform",
          relation: "modified",
        });
      }
    } finally {
      if (transformed !== undefined) kernel.disposeShape(transformed);
      kernel.disposeShape(box);
    }
  });
});
