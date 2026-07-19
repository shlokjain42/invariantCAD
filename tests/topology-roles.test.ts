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
  });

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
