import { describe, expect, it } from "vitest";
import {
  EDGE_TOPOLOGY_ROLES,
  FACE_TOPOLOGY_ROLES,
  TOPOLOGY_ROLES,
  TOPOLOGY_ROLE_RULES,
  createEvaluator,
  design,
  mm,
  parseDocumentValue,
  plane,
  stringifyDocument,
  topology,
  validateDocument,
  vec2,
  vec3,
  type GeometryKernel,
  type DesignDocument,
} from "../src/index.js";
import { createOcctKernel } from "../src/occt-kernel.js";

function roleDocument(
  feature: "fillet" | "chamfer" | "shell" = "fillet",
): ReturnType<ReturnType<typeof design>["build"]> {
  const cad = design("topology-role-validation");
  const profile = cad.sketch("profile", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("outline", { width: mm(20), height: mm(10) }),
    ),
  );
  cad.sketch("other-profile", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("other", { width: mm(4), height: mm(4) }),
    ),
  );
  const extrusion = cad.extrude("extrusion", profile, { distance: mm(5) });
  const endRim = topology.edges
    .createdBy(extrusion, {
      role: "extrude.edge.end-rim",
      source: { sketch: profile, entity: "outline.e0" },
    })
    .select();
  const side = topology.faces
    .createdBy(extrusion, {
      role: "extrude.face.side",
      source: { sketch: profile, entity: "outline.e0" },
    })
    .select();
  cad.output(
    "rounded",
    feature === "fillet"
      ? cad.fillet("rounded", extrusion, { edges: endRim, radius: mm(1) })
      : feature === "chamfer"
        ? cad.chamfer("rounded", extrusion, {
            edges: endRim,
            distance: mm(1),
          })
        : cad.shell("rounded", extrusion, {
            openings: side,
            thickness: mm(1),
          }),
  );
  return cad.build();
}

function mutableRoleDocument(): any {
  return JSON.parse(stringifyDocument(roleDocument()));
}

function revolveRoleDocument(): ReturnType<
  ReturnType<typeof design>["build"]
> {
  const cad = design("revolve-topology-role-validation");
  const radius = mm(10);
  const profile = cad.sketch("revolve-profile", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("section", {
        width: radius,
        height: mm(20),
        center: vec2(radius.mul(0.5), mm(0)),
      }),
    ),
  );
  cad.sketch("other-revolve-profile", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("other-section", {
        width: mm(4),
        height: mm(4),
        center: vec2(mm(2), mm(0)),
      }),
    ),
  );
  const revolution = cad.revolve("revolution", profile);
  const swept = topology.faces
    .createdBy(revolution, {
      role: "revolve.face.swept",
      source: { sketch: profile, entity: "section.e1" },
    })
    .select();
  cad.output(
    "hollow",
    cad.shell("hollow", revolution, {
      openings: swept,
      thickness: mm(1),
    }),
  );
  return cad.build();
}

function mutableRevolveRoleDocument(): any {
  return JSON.parse(stringifyDocument(revolveRoleDocument()));
}

function loftRoleDocument(
  selection: "side" | "section-rim" = "side",
): ReturnType<ReturnType<typeof design>["build"]> {
  const cad = design("loft-topology-role-validation");
  const lower = cad.sketch(
    "lower-profile",
    plane.xy(vec3(mm(0), mm(0), mm(0))),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("lower", { width: mm(20), height: mm(10) }),
      ),
  );
  const middle = cad.sketch(
    "middle-profile",
    plane.xy(vec3(mm(0), mm(0), mm(5))),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("middle", { width: mm(16), height: mm(8) }),
      ),
  );
  const upper = cad.sketch(
    "upper-profile",
    plane.xy(vec3(mm(0), mm(0), mm(10))),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("upper", { width: mm(12), height: mm(6) }),
      ),
  );
  cad.sketch(
    "other-loft-profile",
    plane.xy(vec3(mm(0), mm(0), mm(15))),
    (sketch) =>
      sketch.profile(
        sketch.rectangle("other-loft", { width: mm(4), height: mm(4) }),
      ),
  );
  const loft = cad.loft("loft", [lower, middle, upper]);
  if (selection === "side") {
    const side = topology.faces
      .createdBy(loft, {
        role: "loft.face.side",
        source: { sketch: middle, entity: "middle.e0" },
      })
      .atLeast(1);
    cad.output(
      "treated",
      cad.shell("treated", loft, { openings: side, thickness: mm(1) }),
    );
  } else {
    const rim = topology.edges
      .createdBy(loft, {
        role: "loft.edge.section-rim",
        source: { sketch: middle, entity: "middle.e0" },
      })
      .select();
    cad.output(
      "treated",
      cad.fillet("treated", loft, { edges: rim, radius: mm(1) }),
    );
  }
  return cad.build();
}

function mutableLoftRoleDocument(
  selection: "side" | "section-rim" = "side",
): any {
  return JSON.parse(stringifyDocument(loftRoleDocument(selection)));
}

type SweepRoleSelection =
  | "start-cap"
  | "end-cap"
  | "side"
  | "start-rim"
  | "end-rim"
  | "lateral";

function sweepRoleDocument(
  selection: SweepRoleSelection = "side",
): ReturnType<ReturnType<typeof design>["build"]> {
  const cad = design("sweep-topology-role-validation");
  const profile = cad.sketch("sweep-profile", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("section", { width: mm(10), height: mm(6) }),
    ),
  );
  cad.sketch("other-sweep-profile", plane.xy(), (sketch) =>
    sketch.profile(
      sketch.rectangle("other-section", { width: mm(4), height: mm(4) }),
    ),
  );
  const path = cad.polylinePath("sweep-path", [
    vec3(mm(0), mm(0), mm(0)),
    vec3(mm(0), mm(0), mm(20)),
  ]);
  const sweep = cad.sweep("sweep", profile, path);
  switch (selection) {
    case "start-cap":
    case "end-cap": {
      const opening = topology.faces
        .createdBy(sweep, {
          role:
            selection === "start-cap"
              ? "sweep.face.start-cap"
              : "sweep.face.end-cap",
        })
        .select();
      cad.output(
        "treated",
        cad.shell("treated", sweep, { openings: opening, thickness: mm(1) }),
      );
      break;
    }
    case "side": {
      const opening = topology.faces
        .createdBy(sweep, {
          role: "sweep.face.side",
          source: { sketch: profile, entity: "section.e0" },
        })
        .select();
      cad.output(
        "treated",
        cad.shell("treated", sweep, { openings: opening, thickness: mm(1) }),
      );
      break;
    }
    case "start-rim":
    case "end-rim": {
      const edge = topology.edges
        .createdBy(sweep, {
          role:
            selection === "start-rim"
              ? "sweep.edge.start-rim"
              : "sweep.edge.end-rim",
          source: { sketch: profile, entity: "section.e0" },
        })
        .select();
      cad.output(
        "treated",
        cad.fillet("treated", sweep, { edges: edge, radius: mm(0.5) }),
      );
      break;
    }
    case "lateral": {
      const edge = topology.edges
        .createdBy(sweep, { role: "sweep.edge.lateral" })
        .atLeast(1);
      cad.output(
        "treated",
        cad.fillet("treated", sweep, { edges: edge, radius: mm(0.5) }),
      );
      break;
    }
  }
  return cad.build();
}

function mutableSweepRoleDocument(
  selection: SweepRoleSelection = "side",
): any {
  return JSON.parse(stringifyDocument(sweepRoleDocument(selection)));
}

function edgeTreatmentFaceRoleDocument(
  operation: "fillet" | "chamfer",
): ReturnType<ReturnType<typeof design>["build"]> {
  const cad = design(`${operation}-face-role-validation`);
  const box = cad.box(`${operation}-box`, {
    size: vec3(mm(10), mm(20), mm(30)),
  });
  const seed = topology.edges
    .createdBy(box, { role: "box.edge.x-min-y-min" })
    .select();
  const treated =
    operation === "fillet"
      ? cad.fillet(`${operation}-treated`, box, {
          edges: seed,
          radius: mm(1),
        })
      : cad.chamfer(`${operation}-treated`, box, {
          edges: seed,
          distance: mm(1),
        });
  const opening = topology.faces
    .createdBy(treated, {
      role:
        operation === "fillet"
          ? "fillet.face.blend"
          : "chamfer.face.bevel",
    })
    .select();
  cad.output(
    `${operation}-consumer`,
    cad.shell(`${operation}-consumer`, treated, {
      openings: opening,
      thickness: mm(0.25),
    }),
  );
  return cad.build();
}

function mutableEdgeTreatmentFaceRoleDocument(
  operation: "fillet" | "chamfer",
): any {
  return JSON.parse(stringifyDocument(edgeTreatmentFaceRoleDocument(operation)));
}

function expectSemanticFailure(
  value: unknown,
  message: string,
  path: string,
): void {
  const result = parseDocumentValue(value);
  expect(result.ok).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "TOPOLOGY_SELECTOR_INVALID",
      message: expect.stringContaining(message),
      path,
    }),
  );
}

describe("closed topology role validation", () => {
  it("keeps the exported role vocabulary and rule registry synchronized", () => {
    expect(Object.isFrozen(FACE_TOPOLOGY_ROLES)).toBe(true);
    expect(Object.isFrozen(EDGE_TOPOLOGY_ROLES)).toBe(true);
    expect(Object.isFrozen(TOPOLOGY_ROLES)).toBe(true);
    expect(Object.isFrozen(TOPOLOGY_ROLE_RULES)).toBe(true);
    expect([...Object.keys(TOPOLOGY_ROLE_RULES)].sort()).toEqual(
      [...TOPOLOGY_ROLES].sort(),
    );
    for (const role of FACE_TOPOLOGY_ROLES) {
      expect(TOPOLOGY_ROLE_RULES[role].topology).toBe("face");
    }
    for (const role of EDGE_TOPOLOGY_ROLES) {
      expect(TOPOLOGY_ROLE_RULES[role].topology).toBe("edge");
    }
    expect(TOPOLOGY_ROLE_RULES["loft.face.start-cap"]).toEqual({
      producer: "loft",
      topology: "face",
      relation: "created",
      source: "none",
    });
    expect(TOPOLOGY_ROLE_RULES["loft.face.end-cap"]).toEqual({
      producer: "loft",
      topology: "face",
      relation: "created",
      source: "none",
    });
    expect(TOPOLOGY_ROLE_RULES["loft.face.side"]).toEqual({
      producer: "loft",
      topology: "face",
      relation: "created",
      source: "sketch-curve",
    });
    expect(TOPOLOGY_ROLE_RULES["loft.edge.section-rim"]).toEqual({
      producer: "loft",
      topology: "edge",
      relation: "created",
      source: "sketch-curve",
    });
    expect(TOPOLOGY_ROLE_RULES["loft.edge.lateral"]).toEqual({
      producer: "loft",
      topology: "edge",
      relation: "created",
      source: "none",
    });
    expect(TOPOLOGY_ROLE_RULES["sweep.face.start-cap"]).toEqual({
      producer: "sweep",
      topology: "face",
      relation: "created",
      source: "none",
    });
    expect(TOPOLOGY_ROLE_RULES["sweep.face.end-cap"]).toEqual({
      producer: "sweep",
      topology: "face",
      relation: "created",
      source: "none",
    });
    expect(TOPOLOGY_ROLE_RULES["sweep.face.side"]).toEqual({
      producer: "sweep",
      topology: "face",
      relation: "created",
      source: "sketch-curve",
    });
    expect(TOPOLOGY_ROLE_RULES["sweep.edge.start-rim"]).toEqual({
      producer: "sweep",
      topology: "edge",
      relation: "created",
      source: "sketch-curve",
    });
    expect(TOPOLOGY_ROLE_RULES["sweep.edge.end-rim"]).toEqual({
      producer: "sweep",
      topology: "edge",
      relation: "created",
      source: "sketch-curve",
    });
    expect(TOPOLOGY_ROLE_RULES["sweep.edge.lateral"]).toEqual({
      producer: "sweep",
      topology: "edge",
      relation: "created",
      source: "none",
    });
    expect(TOPOLOGY_ROLE_RULES["fillet.face.blend"]).toEqual({
      producer: "fillet",
      topology: "face",
      relation: "created",
      source: "none",
    });
    expect(TOPOLOGY_ROLE_RULES["chamfer.face.bevel"]).toEqual({
      producer: "chamfer",
      topology: "face",
      relation: "created",
      source: "none",
    });
  });

  it.each([
    ["fillet", "fillet.face.blend"],
    ["chamfer", "chamfer.face.bevel"],
  ] as const)(
    "accepts the Document-v5 %s generated-face role as a downstream selector",
    (operation, role) => {
      const result = parseDocumentValue(
        mutableEdgeTreatmentFaceRoleDocument(operation),
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.version).toBe(6);
      expect(
        (result.value.nodes as Readonly<Record<string, any>>)[
          `${operation}-consumer`
        ]?.openings.query,
      ).toEqual({
        op: "origin",
        feature: `${operation}-treated`,
        relation: "created",
        role,
      });
    },
  );

  it.each([
    ["fillet", "chamfer.face.bevel", "chamfer"],
    ["chamfer", "fillet.face.blend", "fillet"],
  ] as const)(
    "rejects a %s selector carrying the other edge treatment's %s role",
    (operation, foreignRole, foreignProducer) => {
      const invalid = mutableEdgeTreatmentFaceRoleDocument(operation);
      invalid.nodes[`${operation}-consumer`].openings.query.role = foreignRole;

      expectSemanticFailure(
        invalid,
        `is not valid for ${operation} feature '${operation}-treated'`,
        `/nodes/${operation}-consumer/openings/query/role`,
      );
      expect(foreignRole.startsWith(foreignProducer)).toBe(true);
    },
  );

  it.each(["fillet", "chamfer"] as const)(
    "rejects sketch-source and modified-origin claims for the source-free %s face role",
    (operation) => {
      const sourced = mutableEdgeTreatmentFaceRoleDocument(operation);
      sourced.nodes[`${operation}-consumer`].openings.query.source = {
        kind: "sketch-entity",
        sketch: "missing-profile",
        entity: "missing.e0",
      };
      expectSemanticFailure(
        sourced,
        "cannot originate from one sketch boundary entity",
        `/nodes/${operation}-consumer/openings/query/source`,
      );

      const modified = mutableEdgeTreatmentFaceRoleDocument(operation);
      modified.nodes[`${operation}-consumer`].openings.query.relation =
        "modified";
      expectSemanticFailure(
        modified,
        "roles currently describe created topology only",
        `/nodes/${operation}-consumer/openings/query/relation`,
      );
    },
  );

  it("rejects an unknown serialized role structurally", () => {
    const invalid = mutableRoleDocument();
    invalid.nodes.rounded.edges.query.role = "extrude.edge.unknown";

    const result = parseDocumentValue(invalid);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "IR_INVALID",
        path: "/nodes/rounded/edges/query/role",
      }),
    );
  });

  it("rejects an unknown in-memory role semantically", () => {
    const invalid = mutableRoleDocument();
    invalid.nodes.rounded.edges.query.role = "extrude.edge.unknown";

    const result = validateDocument(invalid as DesignDocument);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "TOPOLOGY_SELECTOR_INVALID",
        message: expect.stringContaining("Unknown semantic topology role"),
        path: "/nodes/rounded/edges/query/role",
      }),
    );
  });

  it("rejects a face role in an edge selection", () => {
    const invalid = mutableRoleDocument();
    invalid.nodes.rounded.edges.query.role = "extrude.face.side";

    expectSemanticFailure(
      invalid,
      "selects faces, not edges",
      "/nodes/rounded/edges/query/role",
    );
  });

  it("rejects a role belonging to a different producer kind", () => {
    const invalid = mutableRoleDocument();
    invalid.nodes.rounded.edges.query.role = "cylinder.edge.end-rim";
    delete invalid.nodes.rounded.edges.query.source;

    expectSemanticFailure(
      invalid,
      "is not valid for extrude feature 'extrusion'",
      "/nodes/rounded/edges/query/role",
    );
  });

  it("rejects semantic roles on modified topology", () => {
    const invalid = mutableRoleDocument();
    invalid.nodes.rounded.edges.query.relation = "modified";

    expectSemanticFailure(
      invalid,
      "roles currently describe created topology only",
      "/nodes/rounded/edges/query/relation",
    );
  });

  it("rejects a source on a role that cannot use one", () => {
    const invalid = mutableRoleDocument();
    invalid.nodes.rounded.edges.query.role = "extrude.edge.lateral";

    expectSemanticFailure(
      invalid,
      "cannot originate from one sketch boundary entity",
      "/nodes/rounded/edges/query/source",
    );
  });

  it("rejects a non-curve sketch source", () => {
    const invalid = mutableRoleDocument();
    invalid.nodes.rounded.edges.query.source.entity = "outline.p0";

    const result = parseDocumentValue(invalid);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "REFERENCE_KIND_MISMATCH",
        message: expect.stringContaining("is not a profile curve"),
        path: "/nodes/rounded/edges/query/source/entity",
      }),
    );
  });

  it("rejects a curve that is not used by the extrusion profile boundary", () => {
    const invalid = mutableRoleDocument();
    invalid.nodes.profile.entities.unused = {
      ...invalid.nodes.profile.entities["outline.e0"],
    };
    invalid.nodes.rounded.edges.query.source.entity = "unused";

    expectSemanticFailure(
      invalid,
      "is not used by sketch 'profile' profile boundary",
      "/nodes/rounded/edges/query/source/entity",
    );
  });

  it("rejects a source sketch that is not the extrusion's direct profile", () => {
    const invalid = mutableRoleDocument();
    invalid.nodes.rounded.edges.query.source.sketch = "other-profile";
    invalid.nodes.rounded.edges.query.source.entity = "other.e0";

    expectSemanticFailure(
      invalid,
      "is not the direct profile of extrusion 'extrusion'",
      "/nodes/rounded/edges/query/source/sketch",
    );
  });

  it("accepts a closed extrusion role with its direct sketch-curve source", () => {
    const document = roleDocument();
    const result = parseDocumentValue(
      JSON.parse(stringifyDocument(document)),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.value.nodes as Readonly<Record<string, unknown>>).rounded,
    ).toEqual(
      expect.objectContaining({
        kind: "fillet",
        edges: expect.objectContaining({
          topology: "edge",
          query: {
            op: "origin",
            feature: "extrusion",
            relation: "created",
            role: "extrude.edge.end-rim",
            source: {
              kind: "sketch-entity",
              sketch: "profile",
              entity: "outline.e0",
            },
          },
        }),
      }),
    );
  });

  it("accepts a swept revolution face with its direct sketch-curve source", () => {
    const result = parseDocumentValue(mutableRevolveRoleDocument());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.value.nodes as Readonly<Record<string, unknown>>).hollow,
    ).toEqual(
      expect.objectContaining({
        kind: "shell",
        openings: expect.objectContaining({
          topology: "face",
          query: {
            op: "origin",
            feature: "revolution",
            relation: "created",
            role: "revolve.face.swept",
            source: {
              kind: "sketch-entity",
              sketch: "revolve-profile",
              entity: "section.e1",
            },
          },
        }),
      }),
    );
  });

  it("rejects an extrusion role on a revolution", () => {
    const invalid = mutableRevolveRoleDocument();
    invalid.nodes.hollow.openings.query.role = "extrude.face.side";

    expectSemanticFailure(
      invalid,
      "is not valid for revolve feature 'revolution'",
      "/nodes/hollow/openings/query/role",
    );
  });

  it("rejects a source sketch that is not the revolution's direct profile", () => {
    const invalid = mutableRevolveRoleDocument();
    invalid.nodes.hollow.openings.query.source.sketch =
      "other-revolve-profile";
    invalid.nodes.hollow.openings.query.source.entity = "other-section.e1";

    expectSemanticFailure(
      invalid,
      "is not the direct profile of revolution 'revolution'",
      "/nodes/hollow/openings/query/source/sketch",
    );
  });

  it("accepts a loft side sourced by any one of its ordered direct profiles", () => {
    const result = parseDocumentValue(mutableLoftRoleDocument());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.value.nodes as Readonly<Record<string, unknown>>).treated,
    ).toEqual(
      expect.objectContaining({
        kind: "shell",
        openings: expect.objectContaining({
          topology: "face",
          query: {
            op: "origin",
            feature: "loft",
            relation: "created",
            role: "loft.face.side",
            source: {
              kind: "sketch-entity",
              sketch: "middle-profile",
              entity: "middle.e0",
            },
          },
        }),
      }),
    );
  });

  it("accepts a loft section rim sourced by one of its direct profiles", () => {
    const result = parseDocumentValue(
      mutableLoftRoleDocument("section-rim"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.value.nodes as Readonly<Record<string, unknown>>).treated,
    ).toEqual(
      expect.objectContaining({
        kind: "fillet",
        edges: expect.objectContaining({
          topology: "edge",
          query: {
            op: "origin",
            feature: "loft",
            relation: "created",
            role: "loft.edge.section-rim",
            source: {
              kind: "sketch-entity",
              sketch: "middle-profile",
              entity: "middle.e0",
            },
          },
        }),
      }),
    );
  });

  it("consumes a source-aware loft section rim through a real OCCT fillet", async () => {
    const cad = design("evaluated-loft-rim-selector");
    const lower = cad.sketch("lower", plane.xy(), (sketch) =>
      sketch.profile(
        sketch.rectangle("outline", { width: mm(20), height: mm(10) }),
      ),
    );
    const upper = cad.sketch(
      "upper",
      plane.xy(vec3(mm(0), mm(0), mm(10))),
      (sketch) =>
        sketch.profile(
          sketch.rectangle("outline", { width: mm(20), height: mm(10) }),
        ),
    );
    const loft = cad.loft("loft", [lower, upper]);
    const rim = topology.edges
      .createdBy(loft, {
        role: "loft.edge.section-rim",
        source: { sketch: lower, entity: "outline.e0" },
      })
      .select();
    cad.output(
      "treated",
      cad.fillet("treated", loft, { edges: rim, radius: mm(1) }),
    );

    const evaluator = await createEvaluator({ kernel: await createOcctKernel() });
    try {
      const result = await evaluator.evaluate(cad.build());
      expect(
        result.ok,
        result.ok ? undefined : JSON.stringify(result.diagnostics),
      ).toBe(true);
      if (!result.ok) return;
      try {
        const measured = result.value.output("treated").measure();
        expect(measured.volume).toBeGreaterThan(0);
        expect(measured.surfaceArea).toBeGreaterThan(0);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("accepts source-free loft cap and lateral-edge roles", () => {
    const cap = mutableLoftRoleDocument();
    cap.nodes.treated.openings.query.role = "loft.face.start-cap";
    delete cap.nodes.treated.openings.query.source;
    expect(parseDocumentValue(cap).ok).toBe(true);

    const lateral = mutableLoftRoleDocument("section-rim");
    lateral.nodes.treated.edges.query.role = "loft.edge.lateral";
    delete lateral.nodes.treated.edges.query.source;
    expect(parseDocumentValue(lateral).ok).toBe(true);

    const endCap = mutableLoftRoleDocument();
    endCap.nodes.treated.openings.query.role = "loft.face.end-cap";
    delete endCap.nodes.treated.openings.query.source;
    expect(parseDocumentValue(endCap).ok).toBe(true);
  });

  it("rejects a loft source sketch outside its ordered direct profiles", () => {
    const invalid = mutableLoftRoleDocument();
    invalid.nodes.treated.openings.query.source.sketch = "other-loft-profile";
    invalid.nodes.treated.openings.query.source.entity = "other-loft.e0";

    expectSemanticFailure(
      invalid,
      "is not one of the direct profiles of loft 'loft'",
      "/nodes/treated/openings/query/source/sketch",
    );
  });

  it.each([
    ["face cap", "side", "loft.face.start-cap", "openings"],
    ["lateral edge", "section-rim", "loft.edge.lateral", "edges"],
  ] as const)(
    "rejects a sketch source on a source-free loft %s role",
    (_label, selection, role, selectionField) => {
      const invalid = mutableLoftRoleDocument(selection);
      invalid.nodes.treated[selectionField].query.role = role;

      expectSemanticFailure(
        invalid,
        "cannot originate from one sketch boundary entity",
        `/nodes/treated/${selectionField}/query/source`,
      );
    },
  );

  it.each([
    ["start cap", "start-cap"],
    ["end cap", "end-cap"],
    ["source-aware side", "side"],
    ["source-aware start rim", "start-rim"],
    ["source-aware end rim", "end-rim"],
    ["lateral edge", "lateral"],
  ] as const)("retains the V4 sweep %s role contract", (_label, selection) => {
    const result = parseDocumentValue(mutableSweepRoleDocument(selection));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(6);
  });

  it.each([
    ["side", "openings", "sweep.face.side"],
    ["start-rim", "edges", "sweep.edge.start-rim"],
    ["end-rim", "edges", "sweep.edge.end-rim"],
  ] as const)(
    "rejects a foreign direct-profile source on the sweep %s role",
    (selection, selectionField, role) => {
      const invalid = mutableSweepRoleDocument(selection);
      invalid.nodes.treated[selectionField].query.source.sketch =
        "other-sweep-profile";
      invalid.nodes.treated[selectionField].query.source.entity =
        "other-section.e0";

      expectSemanticFailure(
        invalid,
        "is not the direct profile of sweep 'sweep'",
        `/nodes/treated/${selectionField}/query/source/sketch`,
      );
      expect(invalid.nodes.treated[selectionField].query.role).toBe(role);
    },
  );

  it.each([
    ["start-cap", "openings", "sweep.face.start-cap"],
    ["end-cap", "openings", "sweep.face.end-cap"],
    ["lateral", "edges", "sweep.edge.lateral"],
  ] as const)(
    "rejects a sketch source on the source-free sweep %s role",
    (selection, selectionField, role) => {
      const invalid = mutableSweepRoleDocument(selection);
      invalid.nodes.treated[selectionField].query.source = {
        kind: "sketch-entity",
        sketch: "sweep-profile",
        entity: "section.e0",
      };

      expectSemanticFailure(
        invalid,
        `Topology role '${role}' cannot originate from one sketch boundary entity`,
        `/nodes/treated/${selectionField}/query/source`,
      );
    },
  );

  it("consumes a source-aware sweep rim through a real OCCT fillet", async () => {
    const evaluator = await createEvaluator({ kernel: await createOcctKernel() });
    try {
      const result = await evaluator.evaluate(sweepRoleDocument("end-rim"));
      expect(
        result.ok,
        result.ok ? undefined : JSON.stringify(result.diagnostics),
      ).toBe(true);
      if (!result.ok) return;
      try {
        const measured = result.value.output("treated").measure();
        expect(measured.volume).toBeGreaterThan(0);
        expect(measured.surfaceArea).toBeGreaterThan(0);
      } finally {
        result.value.dispose();
      }
    } finally {
      evaluator.dispose();
    }
  });

  it.each([
    {
      capability: "semanticRoles" as const,
      missing: "semantic-roles",
      feature: "fillet" as const,
    },
    {
      capability: "sketchSources" as const,
      missing: "sketch-sources",
      feature: "fillet" as const,
    },
    {
      capability: "semanticRoles" as const,
      missing: "semantic-roles",
      feature: "chamfer" as const,
    },
    {
      capability: "sketchSources" as const,
      missing: "sketch-sources",
      feature: "chamfer" as const,
    },
    {
      capability: "semanticRoles" as const,
      missing: "semantic-roles",
      feature: "shell" as const,
    },
    {
      capability: "sketchSources" as const,
      missing: "sketch-sources",
      feature: "shell" as const,
    },
  ])(
    "$feature reports missing $missing before invoking topology or the feature",
    async ({ capability, missing, feature }) => {
      const delegate = await createOcctKernel();
      const invoked = { topology: false, feature: false };
      const kernel = new Proxy(delegate, {
        get(target, property) {
          if (property === "id") return `without-${missing}`;
          if (property === "capabilities") {
            const topologyCapabilities = target.capabilities.topology;
            if (topologyCapabilities === undefined) {
              throw new Error("OCCT topology capabilities are unavailable");
            }
            return {
              ...target.capabilities,
              topology: {
                ...topologyCapabilities,
                [capability]: false,
              },
            };
          }
          if (property === "topology") {
            return (
              ...arguments_: Parameters<
                NonNullable<GeometryKernel["topology"]>
              >
            ) => {
              invoked.topology = true;
              return target.topology!(...arguments_);
            };
          }
          if (property === feature) {
            return (...arguments_: any[]) => {
              invoked.feature = true;
              return (target[feature] as (...values: any[]) => unknown)(
                ...arguments_,
              );
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as GeometryKernel;
      const evaluator = await createEvaluator({ kernel });
      try {
        const result = await evaluator.evaluate(roleDocument(feature));

        expect(result.ok).toBe(false);
        expect(invoked).toEqual({ topology: false, feature: false });
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            code: "KERNEL_CAPABILITY_MISSING",
            node: "rounded",
            path: `/nodes/rounded/${feature === "shell" ? "openings" : "edges"}`,
            details: {
              kernel: `without-${missing}`,
              kind: "topology",
              missing: [missing],
            },
          }),
        );
      } finally {
        evaluator.dispose();
      }
    },
  );
});
