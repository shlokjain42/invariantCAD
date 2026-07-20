import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESIGN_DOCUMENT_LIMITS,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_VERSION_V5,
  TopologyReferenceRef,
  captureTopologyReference,
  deg,
  design,
  mm,
  parseDocumentValue,
  scalarVec3,
  topology,
  vec3,
  type DesignBuilder,
  type KernelTopologyKey,
  type PersistentTopologyReference,
  type SolidRef,
  type TopologyReferenceId,
  type TopologyReferenceOptions,
} from "../src/index.js";

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

const tolerance = Object.freeze({
  linear: 1e-6,
  angular: 1e-6,
  relative: 1e-8,
});

function faceReference(
  fingerprint: string,
): PersistentTopologyReference<"face"> {
  const faceKey = key(`face-${fingerprint}`);
  const captured = captureTopologyReference(
    {
      history: "complete",
      faces: [
        {
          topology: "face",
          key: faceKey,
          center: [0, 0.5, 0.5],
          bounds: { min: [0, 0, 0], max: [0, 1, 1] },
          lineage: [
            {
              feature: "body",
              relation: "created",
              role: "box.face.x-min",
            },
          ],
          area: 1,
          surface: { kind: "plane", normal: [-1, 0, 0] },
          edges: [],
        },
      ],
      edges: [],
    },
    "face",
    faceKey,
    {
      capabilities: { protocolVersion: 1, fingerprint },
      tolerance,
    },
  );
  if (!captured.ok) {
    throw new Error(`Face fixture capture failed: ${JSON.stringify(captured.diagnostics)}`);
  }
  return captured.value;
}

function edgeReference(
  fingerprint: string,
): PersistentTopologyReference<"edge"> {
  const edgeKey = key(`edge-${fingerprint}`);
  const captured = captureTopologyReference(
    {
      history: "complete",
      faces: [],
      edges: [
        {
          topology: "edge",
          key: edgeKey,
          center: [0, 0, 0.5],
          bounds: { min: [0, 0, 0], max: [0, 0, 1] },
          lineage: [
            {
              feature: "body",
              relation: "created",
              role: "box.edge.x-min-y-min",
            },
          ],
          length: 1,
          curve: { kind: "line", direction: [0, 0, 1] },
          faces: [],
        },
      ],
    },
    "edge",
    edgeKey,
    {
      capabilities: { protocolVersion: 1, fingerprint },
      tolerance,
    },
  );
  if (!captured.ok) {
    throw new Error(`Edge fixture capture failed: ${JSON.stringify(captured.diagnostics)}`);
  }
  return captured.value;
}

function faceReferenceWithAdjacency(
  fingerprint: string,
): PersistentTopologyReference<"face"> {
  const face = faceReference(fingerprint);
  const edge = edgeReference(`${fingerprint}/neighbor`);
  return {
    ...face,
    adjacency: [
      {
        topology: "edge",
        lineage: edge.lineage,
        geometry: edge.geometry,
      },
    ],
  };
}

function box(cad: DesignBuilder, id: string): SolidRef {
  return cad.box(id, { size: vec3(mm(1), mm(1), mm(1)) });
}

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

type Consumer = "fillet" | "chamfer" | "shell" | "draft";
type AnyTopologyReference =
  | TopologyReferenceRef<"edge">
  | TopologyReferenceRef<"face">;

function consume(
  cad: DesignBuilder,
  consumer: Consumer,
  id: string,
  input: SolidRef,
  reference: AnyTopologyReference,
): SolidRef {
  switch (consumer) {
    case "fillet":
      return cad.fillet(id, input, {
        edges: topology.edges
          .persistentReference(reference as TopologyReferenceRef<"edge">)
          .select(),
        radius: mm(0.1),
      });
    case "chamfer":
      return cad.chamfer(id, input, {
        edges: topology.edges
          .persistentReference(reference as TopologyReferenceRef<"edge">)
          .select(),
        distance: mm(0.1),
      });
    case "shell":
      return cad.shell(id, input, {
        openings: topology.faces
          .persistentReference(reference as TopologyReferenceRef<"face">)
          .select(),
        thickness: mm(0.1),
      });
    case "draft":
      return cad.draft(id, input, {
        faces: topology.faces
          .persistentReference(reference as TopologyReferenceRef<"face">)
          .select(),
        angle: deg(1),
        pullDirection: scalarVec3(0, 0, 1),
        neutralPlane: {
          origin: vec3(mm(0), mm(0), mm(0)),
          normal: scalarVec3(0, 0, 1),
        },
      });
  }
}

describe("persistent topology reference authoring", () => {
  it("emits a canonical, deeply frozen v4 registry without freezing caller data", () => {
    const cad = design("persistent-registry");
    const body = box(cad, "body");
    const high = faceReference("z-kernel/topology@1");
    const mutable = JSON.parse(
      JSON.stringify(faceReference("a-kernel/topology@1")),
    ) as PersistentTopologyReference<"face">;
    const callerVariants = [high, mutable];
    const options: TopologyReferenceOptions<"face"> = {
      topology: "face",
      variants: callerVariants,
    };

    const reference = cad.topologyReference("mounting-face", body, options);
    const document = cad.build();
    expect(document).toMatchObject({
      schema: DOCUMENT_SCHEMA_V5,
      version: DOCUMENT_VERSION_V5,
    });
    if (document.version !== DOCUMENT_VERSION_V5) {
      throw new Error("Expected a v5 document");
    }
    const entry = document.topologyReferences?.[reference.id];
    expect(entry).toMatchObject({
      target: { node: body.node, kind: "solid" },
      topology: "face",
    });
    expect(entry?.variants.map((variant) => variant.kernelFingerprint)).toEqual([
      "a-kernel/topology@1",
      "z-kernel/topology@1",
    ]);
    expect(Object.isFrozen(reference)).toBe(true);
    expect(reference.target).toBe(body);
    expectDeeplyFrozen(entry);

    expect(Object.isFrozen(options)).toBe(false);
    expect(Object.isFrozen(callerVariants)).toBe(false);
    expect(Object.isFrozen(mutable)).toBe(false);
    expect(Object.isFrozen(mutable.geometry)).toBe(false);
    expect(Object.isFrozen(mutable.geometry.center)).toBe(false);
    (mutable as unknown as { kernelFingerprint: string }).kernelFingerprint =
      "mutated-after-registration";
    callerVariants.reverse();
    expect(entry?.variants.map((variant) => variant.kernelFingerprint)).toEqual([
      "a-kernel/topology@1",
      "z-kernel/topology@1",
    ]);
  });

  it("rejects empty, malformed, mismatched, duplicate variants and duplicate IDs atomically", () => {
    const cad = design("invalid-persistent-registry");
    const body = box(cad, "body");
    const face = faceReference("face-kernel/topology@1");

    if (false) {
      cad.topologyReference("compile-time-mismatch", body, {
        topology: "edge",
        // @ts-expect-error Face evidence cannot be registered as an edge reference.
        variants: [face],
      });
    }

    expect(() =>
      cad.topologyReference("empty", body, {
        topology: "face",
        variants: [],
      }),
    ).toThrow("at least one variant");
    expect(() =>
      cad.topologyReference("malformed", body, {
        topology: "face",
        variants: [{} as PersistentTopologyReference<"face">],
      }),
    ).toThrow(/malformed|unsupported/);
    expect(() =>
      cad.topologyReference("mismatched", body, {
        topology: "edge",
        variants: [face] as unknown as PersistentTopologyReference<"edge">[],
      }),
    ).toThrow("contains a face variant");
    expect(() =>
      cad.topologyReference("duplicate-variant", body, {
        topology: "face",
        variants: [face, face],
      }),
    ).toThrow("duplicate kernel fingerprint");

    cad.topologyReference("registered", body, {
      topology: "face",
      variants: [face],
    });
    expect(() =>
      cad.topologyReference("registered", body, {
        topology: "face",
        variants: [faceReference("second-kernel/topology@1")],
      }),
    ).toThrow("Duplicate topology reference");

    const document = cad.build();
    if (document.version !== DOCUMENT_VERSION_V5) {
      throw new Error("Expected a v5 document");
    }
    expect(Object.keys(document.topologyReferences ?? {})).toEqual([
      "registered",
    ]);
  });

  it("keeps authored adjacency and evidence within the default document round-trip limits", () => {
    const cad = design("bounded-persistent-registry");
    const body = box(cad, "body");
    cad.topologyReference("bounded-face", body, {
      topology: "face",
      variants: [
        faceReferenceWithAdjacency("first-kernel/topology@1"),
        faceReferenceWithAdjacency("second-kernel/topology@1"),
      ],
    });

    const document = cad.build();
    const parsed = parseDocumentValue(document);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(document);
  });

  it("rejects aggregate adjacency and evidence before their authoring ceilings are crossed", () => {
    const adjacencyCad = design("aggregate-adjacency-limit");
    const adjacencyBody = box(adjacencyCad, "body");
    (
      adjacencyCad as unknown as {
        topologyReferenceAdjacencyCount: number;
      }
    ).topologyReferenceAdjacencyCount =
      DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStoredAdjacencyLinks;
    expect(() =>
      adjacencyCad.topologyReference("too-much-adjacency", adjacencyBody, {
        topology: "face",
        variants: [faceReferenceWithAdjacency("adjacency-kernel/topology@1")],
      }),
    ).toThrow(/adjacency.*aggregate authoring limit/u);
    expect(adjacencyCad.build().topologyReferences).toBeUndefined();

    const evidenceCad = design("aggregate-evidence-limit");
    const evidenceBody = box(evidenceCad, "body");
    (
      evidenceCad as unknown as {
        topologyReferenceEvidenceCount: number;
      }
    ).topologyReferenceEvidenceCount =
      DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStoredEvidenceRecords - 1;
    expect(() =>
      evidenceCad.topologyReference("too-much-evidence", evidenceBody, {
        topology: "face",
        variants: [faceReferenceWithAdjacency("evidence-kernel/topology@1")],
      }),
    ).toThrow(/evidence.*aggregate authoring limit/u);
    expect(evidenceCad.build().topologyReferences).toBeUndefined();
  });

  it("copies a fixed dense variant array once and contains hostile array behavior", () => {
    const cad = design("hostile-variant-arrays");
    const body = box(cad, "body");
    const face = faceReference("face-kernel/topology@1");
    let lengthReads = 0;
    let indexReads = 0;
    const stateful = new Proxy([face], {
      get(target, property, receiver) {
        if (property === "length") lengthReads += 1;
        if (property === "0") indexReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    cad.topologyReference("stateful", body, {
      topology: "face",
      variants: stateful,
    });
    expect(lengthReads).toBe(1);
    expect(indexReads).toBe(1);

    const accessor = [face];
    let accessorReads = 0;
    Object.defineProperty(accessor, 0, {
      configurable: true,
      enumerable: true,
      get() {
        accessorReads += 1;
        return faceReference("accessor-kernel/topology@1");
      },
    });
    cad.topologyReference("accessor", body, {
      topology: "face",
      variants: accessor,
    });
    expect(accessorReads).toBe(1);

    const sparse = new Array<PersistentTopologyReference<"face">>(1);
    expect(() =>
      cad.topologyReference("sparse", body, {
        topology: "face",
        variants: sparse,
      }),
    ).toThrow("dense array");

    const throwing = new Proxy([face], {
      get(target, property, receiver) {
        if (property === "0") throw new Error("hostile element getter");
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() =>
      cad.topologyReference("throwing", body, {
        topology: "face",
        variants: throwing,
      }),
    ).toThrow("could not be read safely");

    let forgedIndexReads = 0;
    const forgedLength = new Proxy([face], {
      get(target, property, receiver) {
        if (property === "length") {
          return (
            DEFAULT_DESIGN_DOCUMENT_LIMITS.maxTopologyReferenceVariants + 1
          );
        }
        if (property === "0") forgedIndexReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() =>
      cad.topologyReference("forged-length", body, {
        topology: "face",
        variants: forgedLength,
      }),
    ).toThrow("authoring limit");
    expect(forgedIndexReads).toBe(0);

    const revoked = Proxy.revocable([face], {});
    revoked.revoke();
    expect(() =>
      cad.topologyReference("revoked", body, {
        topology: "face",
        variants: revoked.proxy,
      }),
    ).toThrow("variants must be an array");
  });

  it("enforces ownership and exact targets for every selector-consuming feature", () => {
    const cad = design("authoring-boundaries");
    const body = box(cad, "body");
    const descendant = cad.translate(
      "descendant",
      body,
      vec3(mm(1), mm(0), mm(0)),
    );
    const unrelated = box(cad, "unrelated");
    const localFace = cad.topologyReference("local-face", body, {
      topology: "face",
      variants: [faceReference("face-kernel/topology@1")],
    });
    const localEdge = cad.topologyReference("local-edge", body, {
      topology: "edge",
      variants: [edgeReference("edge-kernel/topology@1")],
    });

    const foreignCad = design("foreign-authoring-boundaries");
    const foreignBody = box(foreignCad, "body");
    const foreignFace = foreignCad.topologyReference(
      "foreign-face",
      foreignBody,
      {
        topology: "face",
        variants: [faceReference("face-kernel/topology@1")],
      },
    );
    const foreignEdge = foreignCad.topologyReference(
      "foreign-edge",
      foreignBody,
      {
        topology: "edge",
        variants: [edgeReference("edge-kernel/topology@1")],
      },
    );

    for (const consumer of [
      "fillet",
      "chamfer",
      "shell",
      "draft",
    ] as const) {
      const local =
        consumer === "fillet" || consumer === "chamfer"
          ? localEdge
          : localFace;
      const foreign =
        consumer === "fillet" || consumer === "chamfer"
          ? foreignEdge
          : foreignFace;
      const forged = new TopologyReferenceRef(
        cad,
        local.id,
        local.topology,
        body,
      ) as AnyTopologyReference;

      expect(() =>
        consume(cad, consumer, `${consumer}-ancestor`, descendant, local),
      ).toThrow(/targets solid 'body'.*selector input 'descendant'/);
      expect(() =>
        consume(cad, consumer, `${consumer}-unrelated`, unrelated, local),
      ).toThrow(/targets solid 'body'.*selector input 'unrelated'/);
      expect(() =>
        consume(cad, consumer, `${consumer}-foreign`, body, foreign),
      ).toThrow("cannot cross design boundaries");
      expect(() =>
        consume(cad, consumer, `${consumer}-forged`, body, forged),
      ).toThrow("cannot cross design boundaries");
    }
  });

  it("propagates opposite-kind persistent handles through nested adjacency", () => {
    const cad = design("nested-persistent-adjacency");
    const body = box(cad, "body");
    const descendant = cad.translate(
      "descendant",
      body,
      vec3(mm(1), mm(0), mm(0)),
    );
    const face = cad.topologyReference("face", body, {
      topology: "face",
      variants: [faceReference("face-kernel/topology@1")],
    });
    const edge = cad.topologyReference("edge", body, {
      topology: "edge",
      variants: [edgeReference("edge-kernel/topology@1")],
    });

    const edgesAdjacentToFace = topology.edges
      .adjacentTo(topology.faces.persistentReference(face).select())
      .atLeast(1);
    const facesAdjacentToEdge = topology.faces
      .adjacentTo(topology.edges.persistentReference(edge).select())
      .atLeast(1);
    const fillet = cad.fillet("nested-fillet", body, {
      edges: edgesAdjacentToFace,
      radius: mm(0.1),
    });
    const chamfer = cad.chamfer("nested-chamfer", body, {
      edges: edgesAdjacentToFace,
      distance: mm(0.1),
    });
    const shell = cad.shell("nested-shell", body, {
      openings: facesAdjacentToEdge,
      thickness: mm(0.1),
    });
    const draft = cad.draft("nested-draft", body, {
      faces: facesAdjacentToEdge,
      angle: deg(1),
      pullDirection: scalarVec3(0, 0, 1),
      neutralPlane: {
        origin: vec3(mm(0), mm(0), mm(0)),
        normal: scalarVec3(0, 0, 1),
      },
    });

    expect(() =>
      cad.chamfer("nested-wrong-target", descendant, {
        edges: edgesAdjacentToFace,
        distance: mm(0.1),
      }),
    ).toThrow("not selector input 'descendant'");

    const foreignCad = design("foreign-nested-adjacency");
    const foreignBody = box(foreignCad, "body");
    const foreignFace = foreignCad.topologyReference(
      "foreign-face",
      foreignBody,
      {
        topology: "face",
        variants: [faceReference("face-kernel/topology@1")],
      },
    );
    expect(() =>
      cad.fillet("nested-foreign", body, {
        edges: topology.edges
          .adjacentTo(
            topology.faces.persistentReference(foreignFace).select(),
          )
          .atLeast(1),
        radius: mm(0.1),
      }),
    ).toThrow("cannot cross design boundaries");

    const document = cad.build();
    for (const reference of [fillet, chamfer, shell, draft]) {
      const node = document.nodes[reference.node];
      if (
        node === undefined ||
        (node.kind !== "fillet" &&
          node.kind !== "chamfer" &&
          node.kind !== "shell" &&
          node.kind !== "draft")
      ) {
        throw new Error("Expected a selector-consuming feature");
      }
      const selection =
        node.kind === "fillet" || node.kind === "chamfer"
          ? node.edges
          : node.kind === "shell"
            ? node.openings
            : node.faces;
      expect(selection.query.op).toBe("adjacentTo");
      if (selection.query.op !== "adjacentTo") continue;
      expect(selection.query.selection.query.op).toBe("persistentReference");
    }
  });

  it("preserves face and edge kinds in the public TypeScript API", () => {
    const cad = design("typed-persistent-references");
    const body = box(cad, "body");
    const faceVariant = faceReference("face-kernel/topology@1");
    const edgeVariant = edgeReference("edge-kernel/topology@1");
    const face = cad.topologyReference("face", body, {
      topology: "face",
      variants: [faceVariant],
    });
    const edge = cad.topologyReference("edge", body, {
      topology: "edge",
      variants: [edgeVariant],
    });

    topology.faces.persistentReference(face).select();
    topology.edges.persistentReference(edge).select();
    if (false) {
      // @ts-expect-error Face references cannot be used in edge queries.
      topology.edges.persistentReference(face);
      // @ts-expect-error Edge references cannot be used in face queries.
      topology.faces.persistentReference(edge);
      const wrongOptions: TopologyReferenceOptions<"edge"> = {
        topology: "edge",
        // @ts-expect-error A face evidence variant cannot populate an edge entry.
        variants: [faceVariant],
      };
      cad.topologyReference("wrong-variant-kind", body, wrongOptions);
    }

    const brandedId: TopologyReferenceId = face.id;
    expect(brandedId).toBe("face");
  });
});
