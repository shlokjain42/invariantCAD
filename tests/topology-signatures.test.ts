import { describe, expect, it } from "vitest";
import {
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION,
  captureTopologyReference,
  resolveTopologyReference,
  type CadResult,
  type Diagnostic,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelTopologyKey,
  type KernelTopologyLineage,
  type KernelTopologySnapshot,
} from "../src/index.js";
import type { KernelVertexDescriptor } from "../src/protocol/topology.js";
import { canonicalStringify } from "../src/core/json.js";
import {
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1,
  TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2,
  createTopologyReferenceResolutionSession,
  normalizePersistentTopologyReference,
  type PersistentTopologyReferenceProtocolV1,
  type PersistentTopologyReferenceProtocolV2,
} from "../src/topology-signatures.js";

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

const capabilitiesV1 = {
  protocolVersion: 1 as const,
  fingerprint: "test-kernel/topology-signatures@1",
};

const capabilitiesV2 = {
  protocolVersion: 2 as const,
  fingerprint: "test-kernel/topology-signatures@2",
};

const capabilities = capabilitiesV1;

const tolerance = {
  linear: 1e-6,
  angular: 1e-6,
  relative: 1e-8,
};

const expectedProtocolV1EdgeCaptureBytes =
  '{"adjacency":[{"geometry":{"bounds":{"max":[10,0,0],"min":[0,0,0]},"center":[5,0,0],"kind":"plane","measure":10,"normal":[0,-1,0],"topology":"face"},"lineage":[{"feature":"box","relation":"created","role":"box.face.y-min"},{"feature":"box","relation":"created"}],"topology":"face"}],"capturedHistory":"complete","geometry":{"bounds":{"max":[10,0,0],"min":[0,0,0]},"center":[5,0,0],"direction":[1,0,0],"kind":"line","measure":10,"topology":"edge"},"kernelFingerprint":"test-kernel/topology-signatures@1","lineage":[{"feature":"box","relation":"created","role":"box.edge.x-min-y-min"},{"feature":"box","relation":"created"}],"protocolVersion":1,"tolerance":{"angular":0.000001,"linear":0.000001,"relative":1e-8},"topology":"edge"}';

function face(
  id: string,
  options: {
    readonly center?: readonly [number, number, number];
    readonly bounds?: {
      readonly min: readonly [number, number, number];
      readonly max: readonly [number, number, number];
    };
    readonly lineage?: readonly KernelTopologyLineage[];
    readonly area?: number;
    readonly surface?: KernelFaceDescriptor["surface"];
    readonly edges?: readonly string[];
  } = {},
): KernelFaceDescriptor {
  const center = options.center ?? [0, 0, 0];
  return {
    topology: "face",
    key: key(id),
    center,
    bounds: options.bounds ?? { min: center, max: center },
    lineage: options.lineage ?? [],
    area: options.area ?? 10,
    surface: options.surface ?? { kind: "plane", normal: [0, 0, 1] },
    edges: (options.edges ?? []).map(key),
  };
}

function edge(
  id: string,
  options: {
    readonly center?: readonly [number, number, number];
    readonly bounds?: {
      readonly min: readonly [number, number, number];
      readonly max: readonly [number, number, number];
    };
    readonly lineage?: readonly KernelTopologyLineage[];
    readonly length?: number;
    readonly curve?: KernelEdgeDescriptor["curve"];
    readonly faces?: readonly string[];
    readonly vertices?: readonly string[];
  } = {},
): KernelEdgeDescriptor {
  const center = options.center ?? [0, 0, 0];
  return {
    topology: "edge",
    key: key(id),
    center,
    bounds: options.bounds ?? { min: center, max: center },
    lineage: options.lineage ?? [],
    length: options.length ?? 10,
    curve: options.curve ?? { kind: "line", direction: [1, 0, 0] },
    faces: (options.faces ?? []).map(key),
    vertices: (options.vertices ?? []).map(key),
  };
}

function vertex(
  id: string,
  options: {
    readonly point?: readonly [number, number, number];
    readonly lineage?: readonly KernelTopologyLineage[];
    readonly edges?: readonly string[];
  } = {},
): KernelVertexDescriptor {
  return {
    topology: "vertex",
    key: key(id),
    point: options.point ?? [0, 0, 0],
    lineage: options.lineage ?? [],
    edges: (options.edges ?? []).map(key),
  };
}

function snapshot(
  faces: readonly KernelFaceDescriptor[],
  edges: readonly KernelEdgeDescriptor[] = [],
  history: KernelTopologySnapshot["history"] = "complete",
  vertices: readonly KernelVertexDescriptor[] = [],
): KernelTopologySnapshot {
  return { history, faces, edges, vertices };
}

function broadLineage(feature = "producer"): readonly KernelTopologyLineage[] {
  return [{ feature, relation: "created" }];
}

function boxFaceLineage(
  role: "box.face.x-min" | "box.face.x-max",
): readonly KernelTopologyLineage[] {
  return [
    { feature: "source-box", relation: "created" },
    { feature: "source-box", relation: "created", role },
  ];
}

function capture<K extends "face" | "edge">(
  value: KernelTopologySnapshot,
  topology: K,
  topologyKey: KernelTopologyKey,
) {
  return captureTopologyReference(value, topology, topologyKey, {
    capabilities,
    tolerance,
  });
}

function failureCode(result: CadResult<unknown>): Diagnostic["code"] {
  return failureDiagnostic(result).code;
}

function failureDiagnostic(result: CadResult<unknown>): Diagnostic {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected a failed CadResult");
  expect(result.diagnostics).toHaveLength(1);
  return result.diagnostics[0]!;
}

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested, seen);
}

function expectNoNegativeZero(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "number") {
    expect(Object.is(value, -0)).toBe(false);
    return;
  }
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const nested of Object.values(value)) expectNoNegativeZero(nested, seen);
}

function semanticSnapshots(): {
  readonly before: KernelTopologySnapshot;
  readonly after: KernelTopologySnapshot;
} {
  const before = snapshot([
    face("old-min", {
      center: [0, 5, 5],
      bounds: { min: [0, 0, 0], max: [0, 10, 10] },
      lineage: boxFaceLineage("box.face.x-min"),
      area: 100,
      surface: { kind: "plane", normal: [-1, 0, 0] },
    }),
    face("old-max", {
      center: [10, 5, 5],
      bounds: { min: [10, 0, 0], max: [10, 10, 10] },
      lineage: boxFaceLineage("box.face.x-max"),
      area: 100,
      surface: { kind: "plane", normal: [1, 0, 0] },
    }),
  ]);
  const after = snapshot([
    // Deliberately reverse enumeration and replace every evaluation key.
    face("new-max", {
      center: [250, -40, 90],
      bounds: { min: [250, -100, 10], max: [250, 20, 170] },
      lineage: [...boxFaceLineage("box.face.x-max")].reverse(),
      area: 19_200,
      surface: { kind: "plane", normal: [0, 1, 0] },
    }),
    face("new-min", {
      center: [-75, 20, -30],
      bounds: { min: [-75, -40, -110], max: [-75, 80, 50] },
      lineage: [...boxFaceLineage("box.face.x-min")].reverse(),
      area: 19_200,
      surface: { kind: "plane", normal: [0, -1, 0] },
    }),
  ]);
  return { before, after };
}

function adjacencySnapshot(prefix: string): KernelTopologySnapshot {
  const common = broadLineage("broad-sweep");
  const circularFace = `${prefix}-circular-face`;
  const lineFace = `${prefix}-line-face`;
  const circularEdge = `${prefix}-circular-edge`;
  const lineEdge = `${prefix}-line-edge`;
  return snapshot(
    [
      face(circularFace, {
        center: [5, 5, 0],
        bounds: { min: [0, 0, 0], max: [10, 10, 0] },
        lineage: common,
        area: 100,
        edges: [circularEdge],
      }),
      face(lineFace, {
        center: [5, 5, 0],
        bounds: { min: [0, 0, 0], max: [10, 10, 0] },
        lineage: common,
        area: 100,
        edges: [lineEdge],
      }),
    ],
    [
      edge(circularEdge, {
        center: [5, 5, 0],
        bounds: { min: [2, 2, 0], max: [8, 8, 0] },
        lineage: common,
        length: Math.PI * 6,
        curve: { kind: "circle", radius: 3 },
        faces: [circularFace],
      }),
      edge(lineEdge, {
        center: [5, 5, 0],
        bounds: { min: [0, 5, 0], max: [10, 5, 0] },
        lineage: common,
        length: 10,
        curve: { kind: "line", direction: [1, 0, 0] },
        faces: [lineFace],
      }),
    ],
  );
}

describe("persistent topology signatures", () => {
  it("exports protocol v1/v2 constants and emits the selected v1 profile", () => {
    expect(TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V1).toBe(1);
    expect(TOPOLOGY_SIGNATURE_PROTOCOL_VERSION_V2).toBe(2);
    expect(TOPOLOGY_SIGNATURE_PROTOCOL_VERSION).toBe(2);
    const { before } = semanticSnapshots();
    const captured = capture(before, "face", key("old-min"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.value).toEqual(
      expect.objectContaining({ protocolVersion: 1 }),
    );
    const typed: PersistentTopologyReferenceProtocolV1<"face"> =
      captured.value;
    expect(typed.topology).toBe("face");
  });

  it("freezes canonical protocol-v1 edge capture bytes", () => {
    const value = snapshot(
      [
        face("face", {
          center: [5, 0, 0],
          bounds: { min: [0, 0, 0], max: [10, 0, 0] },
          lineage: [
            {
              feature: "box",
              relation: "created",
              role: "box.face.y-min",
            },
            { feature: "box", relation: "created" },
          ],
          area: 10,
          surface: { kind: "plane", normal: [0, -1, 0] },
          edges: ["edge"],
        }),
      ],
      [
        edge("edge", {
          center: [5, 0, 0],
          bounds: { min: [0, 0, 0], max: [10, 0, 0] },
          lineage: [
            {
              feature: "box",
              relation: "created",
              role: "box.edge.x-min-y-min",
            },
            { feature: "box", relation: "created" },
          ],
          length: 10,
          curve: { kind: "line", direction: [1, 0, 0] },
          faces: ["face"],
          vertices: ["start", "end"],
        }),
      ],
      "complete",
      [
        vertex("start", { point: [0, 0, 0], edges: ["edge"] }),
        vertex("end", { point: [10, 0, 0], edges: ["edge"] }),
      ],
    );
    const captured = captureTopologyReference(
      value,
      "edge",
      key("edge"),
      { capabilities: capabilitiesV1, tolerance },
    );

    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(canonicalStringify(captured.value)).toBe(
      expectedProtocolV1EdgeCaptureBytes,
    );
  });

  it("captures protocol-v2 vertex point and incident-edge evidence", () => {
    const value = snapshot(
      [face("face", { edges: ["edge"] })],
      [
        edge("edge", {
          faces: ["face"],
          vertices: ["start", "end"],
          center: [5, 0, 0],
        }),
      ],
      "complete",
      [
        vertex("start", { point: [0, 0, 0], edges: ["edge"] }),
        vertex("end", { point: [10, 0, 0], edges: ["edge"] }),
      ],
    );

    const captured = captureTopologyReference(
      value,
      "vertex",
      key("start"),
      { capabilities: capabilitiesV2, tolerance },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const typed: PersistentTopologyReferenceProtocolV2<"vertex"> =
      captured.value;
    expect(typed).toMatchObject({
      protocolVersion: 2,
      kernelFingerprint: capabilitiesV2.fingerprint,
      topology: "vertex",
      geometry: { topology: "vertex", point: [0, 0, 0] },
    });
    expect(typed.adjacency.map((neighbor) => neighbor.topology)).toEqual([
      "edge",
    ]);
    expectDeeplyFrozen(typed);
  });

  it("keeps protocol-v1 edge adjacency frozen while v2 adds endpoint vertices", () => {
    const value = snapshot(
      [face("face", { edges: ["edge"] })],
      [
        edge("edge", {
          faces: ["face"],
          vertices: ["start", "end"],
        }),
      ],
      "complete",
      [
        vertex("start", { point: [0, 0, 0], edges: ["edge"] }),
        vertex("end", { point: [10, 0, 0], edges: ["edge"] }),
      ],
    );
    const legacy = captureTopologyReference(value, "edge", key("edge"), {
      capabilities: capabilitiesV1,
      tolerance,
    });
    const current = captureTopologyReference(value, "edge", key("edge"), {
      capabilities: capabilitiesV2,
      tolerance,
    });
    expect(legacy.ok).toBe(true);
    expect(current.ok).toBe(true);
    if (!legacy.ok || !current.ok) return;
    expect(legacy.value.protocolVersion).toBe(1);
    expect(legacy.value.adjacency.map((neighbor) => neighbor.topology)).toEqual([
      "face",
    ]);
    expect(current.value.protocolVersion).toBe(2);
    expect(
      current.value.adjacency.map((neighbor) => neighbor.topology).sort(),
    ).toEqual(["face", "vertex", "vertex"]);
  });

  it("normalizes both protocols and rejects v1 vertices or illegal v2 incidence", () => {
    const validVertex = {
      protocolVersion: 2,
      kernelFingerprint: capabilitiesV2.fingerprint,
      topology: "vertex",
      capturedHistory: "complete",
      tolerance,
      lineage: [],
      geometry: { topology: "vertex", point: [1, 2, 3] },
      adjacency: [],
    } as const;
    const normalized = normalizePersistentTopologyReference(validVertex);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value).toEqual(validVertex);
      expectDeeplyFrozen(normalized.value);
    }

    expect(
      failureCode(
        normalizePersistentTopologyReference({
          ...validVertex,
          protocolVersion: 1,
        }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");
    expect(
      failureCode(
        normalizePersistentTopologyReference({
          ...validVertex,
          adjacency: [
            {
              topology: "face",
              lineage: [],
              geometry: {
                topology: "face",
                kind: "plane",
                measure: 1,
                center: [0, 0, 0],
                bounds: { min: [0, 0, 0], max: [0, 0, 0] },
              },
            },
          ],
        }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");
  });

  it("resolves protocol-v2 vertices and rejects protocol or fingerprint drift", () => {
    const before = snapshot(
      [],
      [edge("old-edge", { vertices: ["old-vertex"] })],
      "complete",
      [vertex("old-vertex", { point: [1, 2, 3], edges: ["old-edge"] })],
    );
    const after = snapshot(
      [],
      [edge("new-edge", { vertices: ["new-vertex"] })],
      "complete",
      [vertex("new-vertex", { point: [1, 2, 3], edges: ["new-edge"] })],
    );
    const captured = captureTopologyReference(
      before,
      "vertex",
      key("old-vertex"),
      { capabilities: capabilitiesV2, tolerance },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const resolved = resolveTopologyReference(captured.value, after, {
      capabilities: capabilitiesV2,
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value.key).toBe(key("new-vertex"));

    expect(
      failureCode(
        resolveTopologyReference(captured.value, after, {
          capabilities: capabilitiesV1,
        }),
      ),
    ).toBe("TOPOLOGY_FINGERPRINT_MISMATCH");
    expect(
      failureCode(
        resolveTopologyReference(captured.value, after, {
          capabilities: { ...capabilitiesV2, fingerprint: "different" },
        }),
      ),
    ).toBe("TOPOLOGY_FINGERPRINT_MISMATCH");
  });

  it("resolves a moved vertex from its complete incident-edge semantic anchors", () => {
    const lineage = (
      role: Exclude<KernelTopologyLineage["role"], undefined>,
    ) => [
      { feature: "box", relation: "created" as const, role },
    ];
    const before = snapshot(
      [],
      [
        edge("old-x", {
          lineage: lineage("box.edge.y-min-z-min"),
          vertices: ["old-corner"],
        }),
        edge("old-y", {
          lineage: lineage("box.edge.x-min-z-min"),
          vertices: ["old-corner"],
        }),
        edge("old-z", {
          lineage: lineage("box.edge.x-min-y-min"),
          vertices: ["old-corner"],
        }),
      ],
      "complete",
      [vertex("old-corner", { point: [0, 0, 0], edges: ["old-x", "old-y", "old-z"] })],
    );
    const after = snapshot(
      [],
      [
        edge("new-x", {
          center: [110, 20, 30],
          length: 20,
          lineage: lineage("box.edge.y-min-z-min"),
          vertices: ["new-corner"],
        }),
        edge("new-y", {
          center: [100, 35, 30],
          length: 30,
          lineage: lineage("box.edge.x-min-z-min"),
          vertices: ["new-corner"],
        }),
        edge("new-z", {
          center: [100, 20, 50],
          length: 40,
          lineage: lineage("box.edge.x-min-y-min"),
          vertices: ["new-corner"],
        }),
        edge("other-x", {
          center: [110, 50, 70],
          length: 20,
          lineage: lineage("box.edge.y-max-z-max"),
          vertices: ["other-corner"],
        }),
        edge("other-y", {
          center: [120, 35, 70],
          length: 30,
          lineage: lineage("box.edge.x-max-z-max"),
          vertices: ["other-corner"],
        }),
        edge("other-z", {
          center: [120, 50, 50],
          length: 40,
          lineage: lineage("box.edge.x-max-y-max"),
          vertices: ["other-corner"],
        }),
      ],
      "complete",
      [
        vertex("new-corner", {
          point: [100, 20, 30],
          edges: ["new-x", "new-y", "new-z"],
        }),
        vertex("other-corner", {
          point: [120, 50, 70],
          edges: ["other-x", "other-y", "other-z"],
        }),
      ],
    );
    const captured = captureTopologyReference(
      before,
      "vertex",
      key("old-corner"),
      { capabilities: capabilitiesV2, tolerance },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const resolved = resolveTopologyReference(captured.value, after, {
      capabilities: capabilitiesV2,
    });
    expect(resolved).toEqual({
      ok: true,
      value: {
        key: key("new-corner"),
        evidence: "semantic-lineage",
      },
      diagnostics: [],
    });
  });

  it("never cross-matches face and vertex neighbors in protocol-v2 edge evidence", () => {
    const anchored = (entity: string): readonly KernelTopologyLineage[] => [
      {
        feature: "source-feature",
        relation: "created",
        source: {
          kind: "sketch-entity",
          sketch: "profile",
          entity,
        },
      },
    ];
    const before = snapshot(
      [
        face("old-face", {
          lineage: anchored("face-anchor"),
          edges: ["old-edge"],
        }),
      ],
      [
        edge("old-edge", {
          faces: ["old-face"],
          vertices: ["old-vertex"],
        }),
      ],
      "complete",
      [
        vertex("old-vertex", {
          lineage: anchored("vertex-anchor"),
          edges: ["old-edge"],
        }),
      ],
    );
    const after = snapshot(
      [
        face("new-face", {
          lineage: anchored("vertex-anchor"),
          edges: ["new-edge"],
        }),
      ],
      [
        edge("new-edge", {
          faces: ["new-face"],
          vertices: ["new-vertex"],
        }),
      ],
      "complete",
      [
        vertex("new-vertex", {
          lineage: anchored("face-anchor"),
          edges: ["new-edge"],
        }),
      ],
    );
    const captured = captureTopologyReference(
      before,
      "edge",
      key("old-edge"),
      { capabilities: capabilitiesV2, tolerance },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    expect(
      failureCode(
        resolveTopologyReference(captured.value, after, {
          capabilities: capabilitiesV2,
        }),
      ),
    ).toBe("TOPOLOGY_MATCH_MISSING");
  });

  it("applies stored point tolerance and fails closed for a v2 vertex orbit", () => {
    const before = snapshot(
      [],
      [edge("source-edge", { vertices: ["source"] })],
      "partial",
      [vertex("source", { point: [1, 2, 3], edges: ["source-edge"] })],
    );
    const captured = captureTopologyReference(
      before,
      "vertex",
      key("source"),
      { capabilities: capabilitiesV2, tolerance },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const moved = snapshot(
      [],
      [edge("moved-edge", { vertices: ["moved"] })],
      "partial",
      [
        vertex("moved", {
          point: [1 + tolerance.linear * 2, 2, 3],
          edges: ["moved-edge"],
        }),
      ],
    );
    expect(
      failureCode(
        resolveTopologyReference(captured.value, moved, {
          capabilities: capabilitiesV2,
        }),
      ),
    ).toBe("TOPOLOGY_MATCH_MISSING");

    const symmetric = snapshot(
      [],
      [
        edge("edge-a", { vertices: ["candidate-a"] }),
        edge("edge-b", { vertices: ["candidate-b"] }),
      ],
      "partial",
      [
        vertex("candidate-a", { point: [1, 2, 3], edges: ["edge-a"] }),
        vertex("candidate-b", { point: [1, 2, 3], edges: ["edge-b"] }),
      ],
    );
    expect(
      failureCode(
        resolveTopologyReference(captured.value, symmetric, {
          capabilities: capabilitiesV2,
        }),
      ),
    ).toBe("TOPOLOGY_MATCH_AMBIGUOUS");
  });

  it("normalizes persistent evidence into one canonical deeply frozen value", () => {
    const firstNeighbor = {
      topology: "edge" as const,
      lineage: [
        { feature: "neighbor-b", relation: "created" as const },
        { feature: "neighbor-a", relation: "created" as const },
        { feature: "neighbor-b", relation: "created" as const },
      ],
      geometry: {
        topology: "edge" as const,
        kind: "line",
        measure: 2,
        center: [2, -0, 0] as const,
        bounds: { min: [2, -0, 0] as const, max: [2, 0, 0] as const },
        direction: [1, -0, 0] as const,
      },
    };
    const secondNeighbor = {
      topology: "edge" as const,
      lineage: [{ feature: "neighbor-a", relation: "created" as const }],
      geometry: {
        topology: "edge" as const,
        kind: "line",
        measure: 1,
        center: [1, -0, 0] as const,
        bounds: { min: [1, -0, 0] as const, max: [1, 0, 0] as const },
        direction: [1, -0, 0] as const,
      },
    };
    const normalized = normalizePersistentTopologyReference({
      protocolVersion: 1,
      kernelFingerprint: capabilities.fingerprint,
      topology: "face",
      capturedHistory: "complete",
      tolerance: { linear: -0, angular: -0, relative: -0 },
      lineage: [
        { feature: "producer-b", relation: "created" },
        { feature: "producer-a", relation: "created" },
        { feature: "producer-b", relation: "created" },
      ],
      geometry: {
        topology: "face",
        kind: "plane",
        measure: -0,
        center: [-0, 0, 0],
        bounds: { min: [-0, 0, 0], max: [0, 0, 0] },
        normal: [-0, 0, 1],
      },
      adjacency: [firstNeighbor, secondNeighbor, firstNeighbor],
    });

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.lineage.map((item) => item.feature)).toEqual([
      "producer-a",
      "producer-b",
    ]);
    expect(
      normalized.value.adjacency.map((item) =>
        item.geometry.topology === "vertex"
          ? item.geometry.point[0]
          : item.geometry.center[0],
      ),
    ).toEqual([1, 2, 2]);
    expect(normalized.value.adjacency[1]?.lineage.map((item) => item.feature)).toEqual([
      "neighbor-a",
      "neighbor-b",
    ]);
    expectDeeplyFrozen(normalized.value);
    expectNoNegativeZero(normalized.value);
  });

  it("normalizes one snapshot and reuses cached results within a session", () => {
    const { before } = semanticSnapshots();
    const minimum = capture(before, "face", key("old-min"));
    const maximum = capture(before, "face", key("old-max"));
    expect(minimum.ok).toBe(true);
    expect(maximum.ok).toBe(true);
    if (!minimum.ok || !maximum.ok) return;

    let normalReads = 0;
    const surface = { kind: "plane" } as {
      readonly kind: "plane";
      readonly normal: readonly [number, number, number];
    };
    Object.defineProperty(surface, "normal", {
      enumerable: true,
      get() {
        normalReads += 1;
        return normalReads === 1 ? [-1, 0, 0] : [0, 1, 0];
      },
    });
    const stateful = snapshot([
      { ...before.faces[0]!, surface },
      before.faces[1]!,
    ]);
    const session = createTopologyReferenceResolutionSession(stateful, {
      capabilities,
    });
    expect(session.ok).toBe(true);
    expect(normalReads).toBe(1);
    if (!session.ok) return;

    const first = session.value.resolve(minimum.value);
    const repeated = session.value.resolve(minimum.value);
    const second = session.value.resolve(maximum.value);
    expect(first.ok).toBe(true);
    expect(repeated).toBe(first);
    expect(second.ok).toBe(true);
    expect(normalReads).toBe(1);
    expect(session.value.snapshot).not.toBe(stateful);
    expectDeeplyFrozen(session.value.snapshot);
  });

  it("shares candidate-pair and matching-step budgets across unique session references", () => {
    const { before } = semanticSnapshots();
    const minimum = capture(before, "face", key("old-min"));
    const maximum = capture(before, "face", key("old-max"));
    expect(minimum.ok).toBe(true);
    expect(maximum.ok).toBe(true);
    if (!minimum.ok || !maximum.ok) return;

    for (const resource of ["maxCandidatePairs", "maxMatchingSteps"] as const) {
      const session = createTopologyReferenceResolutionSession(before, {
        capabilities,
        limits: { [resource]: 3 },
      });
      expect(session.ok).toBe(true);
      if (!session.ok) continue;
      expect(session.value.resolve(minimum.value).ok).toBe(true);
      expect(failureDiagnostic(session.value.resolve(maximum.value))).toMatchObject({
        code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
        details: { resource, limit: 3, actual: 4 },
      });
    }
  });

  it("does not recharge a shared work budget for the same reference object", () => {
    const { before } = semanticSnapshots();
    const minimum = capture(before, "face", key("old-min"));
    const maximum = capture(before, "face", key("old-max"));
    expect(minimum.ok).toBe(true);
    expect(maximum.ok).toBe(true);
    if (!minimum.ok || !maximum.ok) return;
    const session = createTopologyReferenceResolutionSession(before, {
      capabilities,
      limits: { maxCandidatePairs: 2 },
    });
    expect(session.ok).toBe(true);
    if (!session.ok) return;

    const first = session.value.resolve(minimum.value);
    expect(first.ok).toBe(true);
    expect(session.value.resolve(minimum.value)).toBe(first);
    expect(failureDiagnostic(session.value.resolve(maximum.value))).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
      details: { resource: "maxCandidatePairs", limit: 2, actual: 3 },
    });
  });

  it("applies each stored tolerance while sharing candidate evidence regardless of order", () => {
    const original = snapshot(
      [
        face("original", {
          center: [0, 0, 0],
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          lineage: [],
        }),
      ],
      [],
      "partial",
    );
    const captured = capture(original, "face", key("original"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const tight = {
      ...captured.value,
      tolerance: { linear: 0.1, angular: 0, relative: 0 },
    };
    const loose = {
      ...captured.value,
      tolerance: { linear: 1, angular: 0, relative: 0 },
    };
    const moved = snapshot(
      [
        face("moved", {
          center: [0.5, 0, 0],
          bounds: { min: [0.5, 0, 0], max: [0.5, 0, 0] },
          lineage: [],
        }),
      ],
      [],
      "partial",
    );

    for (const references of [
      [tight, loose],
      [loose, tight],
    ] as const) {
      const session = createTopologyReferenceResolutionSession(moved, {
        capabilities,
      });
      expect(session.ok).toBe(true);
      if (!session.ok) continue;
      const results = references.map((reference) =>
        session.value.resolve(reference),
      );
      const tightResult = references[0] === tight ? results[0] : results[1];
      const looseResult = references[0] === loose ? results[0] : results[1];
      expect(failureCode(tightResult!)).toBe("TOPOLOGY_MATCH_MISSING");
      expect(looseResult).toEqual({
        ok: true,
        value: { key: key("moved"), evidence: "geometry-adjacency" },
        diagnostics: [],
      });
    }
  });

  it("resolves a unique semantic lineage through arbitrary geometry and key permutation", () => {
    const { before, after } = semanticSnapshots();
    const captured = capture(before, "face", key("old-min"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const resolved = resolveTopologyReference(captured.value, after, {
      capabilities,
    });
    expect(resolved).toEqual({
      ok: true,
      value: {
        key: key("new-min"),
        evidence: "semantic-lineage",
      },
      diagnostics: [],
    });
  });

  it("uses a unique sketch-source lineage anchor without persisting its key", () => {
    const source = (entity: string): readonly KernelTopologyLineage[] => [
      {
        feature: "extrusion",
        relation: "created",
        source: {
          kind: "sketch-entity",
          sketch: "profile",
          entity,
        },
      },
    ];
    const before = snapshot([
      face("old-left", { lineage: source("left") }),
      face("old-right", { lineage: source("right") }),
    ]);
    const captured = capture(before, "face", key("old-left"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const after = snapshot([
      face("new-right", {
        center: [100, 200, 300],
        area: 900,
        lineage: source("right"),
      }),
      face("new-left", {
        center: [-100, -200, -300],
        area: 1_200,
        lineage: source("left"),
      }),
    ]);
    expect(
      resolveTopologyReference(captured.value, after, { capabilities }),
    ).toEqual({
      ok: true,
      value: { key: key("new-left"), evidence: "semantic-lineage" },
      diagnostics: [],
    });
    expect(JSON.stringify(captured.value)).not.toContain("old-left");
  });

  it("uses one-hop adjacency to distinguish otherwise identical geometry", () => {
    const before = adjacencySnapshot("old");
    const afterValue = adjacencySnapshot("new");
    const after = snapshot(
      [...afterValue.faces].reverse(),
      [...afterValue.edges].reverse(),
    );
    const captured = capture(before, "face", key("old-circular-face"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const resolved = resolveTopologyReference(captured.value, after, {
      capabilities,
    });
    expect(resolved).toEqual({
      ok: true,
      value: {
        key: key("new-circular-face"),
        evidence: "geometry-adjacency",
      },
      diagnostics: [],
    });
  });

  it("refuses to capture a member of a symmetric signature orbit", () => {
    const symmetric = snapshot([
      face("first", { lineage: broadLineage() }),
      face("second", { lineage: broadLineage() }),
    ]);

    expect(failureCode(capture(symmetric, "face", key("first")))).toBe(
      "TOPOLOGY_MATCH_AMBIGUOUS",
    );
  });

  it("refuses to resolve a previously unique reference into a symmetric orbit", () => {
    const unique = snapshot([
      face("only", { lineage: broadLineage() }),
    ]);
    const captured = capture(unique, "face", key("only"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const symmetric = snapshot([
      face("new-first", { lineage: broadLineage() }),
      face("new-second", { lineage: broadLineage() }),
    ]);
    const resolved = resolveTopologyReference(captured.value, symmetric, {
      capabilities,
    });
    expect(failureCode(resolved)).toBe("TOPOLOGY_MATCH_AMBIGUOUS");
  });

  it("rejects a key outside the selected topology and reports a missing resolved match", () => {
    const unique = snapshot([
      face("present", { lineage: broadLineage() }),
    ]);
    expect(failureCode(capture(unique, "face", key("absent")))).toBe(
      "TOPOLOGY_SIGNATURE_INVALID",
    );

    const captured = capture(unique, "face", key("present"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const resolved = resolveTopologyReference(
      captured.value,
      snapshot([]),
      { capabilities },
    );
    expect(failureCode(resolved)).toBe("TOPOLOGY_MATCH_MISSING");
  });

  it("rejects a different descriptor fingerprint before matching", () => {
    const unique = snapshot([
      face("present", { lineage: broadLineage() }),
    ]);
    const captured = capture(unique, "face", key("present"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const resolved = resolveTopologyReference(captured.value, unique, {
      capabilities: {
        protocolVersion: 1,
        fingerprint: "different-kernel/topology-signatures@1",
      },
    });
    expect(failureCode(resolved)).toBe("TOPOLOGY_FINGERPRINT_MISMATCH");
  });

  it("falls back to geometry-adjacency when either snapshot has partial history", () => {
    const { before } = semanticSnapshots();
    const captured = capture(before, "face", key("old-min"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const partial = snapshot(
      [
        face("partial-min", {
          center: [0, 5, 5],
          bounds: { min: [0, 0, 0], max: [0, 10, 10] },
          // This semantic lineage must not be treated as authoritative while
          // the snapshot declares partial history.
          lineage: boxFaceLineage("box.face.x-min"),
          area: 100,
          surface: { kind: "plane", normal: [-1, 0, 0] },
        }),
      ],
      [],
      "partial",
    );
    const resolved = resolveTopologyReference(captured.value, partial, {
      capabilities,
    });
    expect(resolved).toEqual({
      ok: true,
      value: {
        key: key("partial-min"),
        evidence: "geometry-adjacency",
      },
      diagnostics: [],
    });

    const capturedPartial = capture(partial, "face", key("partial-min"));
    expect(capturedPartial.ok).toBe(true);
    if (!capturedPartial.ok) return;
    const completeAgain = resolveTopologyReference(
      capturedPartial.value,
      before,
      { capabilities },
    );
    expect(completeAgain.ok).toBe(true);
    if (completeAgain.ok) {
      expect(completeAgain.value.evidence).toBe("geometry-adjacency");
    }
  });

  it("deep-freezes references and isolates them from mutable capture inputs", () => {
    const mutableSnapshot = semanticSnapshots().before as any;
    const mutableCapabilities = {
      protocolVersion: 1 as const,
      fingerprint: capabilities.fingerprint,
    };
    const mutableTolerance = { ...tolerance };
    const captured = captureTopologyReference(
      mutableSnapshot,
      "face",
      key("old-min"),
      {
        capabilities: mutableCapabilities,
        tolerance: mutableTolerance,
      },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const serialized = JSON.stringify(captured.value);
    expectDeeplyFrozen(captured.value);

    mutableSnapshot.faces[0].center[0] = 999_999;
    mutableSnapshot.faces[0].lineage[1].role = "box.face.x-max";
    mutableSnapshot.faces.reverse();
    mutableCapabilities.fingerprint = "mutated-after-capture";
    mutableTolerance.linear = 10_000;

    expect(JSON.stringify(captured.value)).toBe(serialized);
    const resolved = resolveTopologyReference(
      captured.value,
      semanticSnapshots().after,
      { capabilities },
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value.key).toBe(key("new-min"));
  });

  it("copies accessor-backed snapshots and references once before matching", () => {
    let snapshotCenterReads = 0;
    const statefulCenter = [0, 0, 0];
    Object.defineProperty(statefulCenter, 0, {
      enumerable: true,
      configurable: true,
      get() {
        snapshotCenterReads += 1;
        return snapshotCenterReads === 1 ? 0 : 100;
      },
    });
    const before = snapshot(
      [
        face("stateful-before", {
          center: statefulCenter as unknown as readonly [number, number, number],
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          lineage: [],
        }),
      ],
      [],
      "partial",
    );
    const captured = capture(before, "face", key("stateful-before"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.value.geometry.center).toEqual([0, 0, 0]);
    expect(snapshotCenterReads).toBe(1);

    let linearReads = 0;
    const statefulTolerance = {
      get linear() {
        linearReads += 1;
        return linearReads === 1 ? 0 : 1_000;
      },
      angular: tolerance.angular,
      relative: 0,
    };
    const statefulReference = {
      ...captured.value,
      tolerance: statefulTolerance,
    };
    const moved = snapshot(
      [face("moved", { center: [100, 0, 0], lineage: [] })],
      [],
      "partial",
    );
    expect(
      failureCode(
        resolveTopologyReference(statefulReference, moved, { capabilities }),
      ),
    ).toBe("TOPOLOGY_MATCH_MISSING");
    expect(linearReads).toBe(1);
  });

  it("captures reference array lengths once while enforcing copy limits", () => {
    const captured = capture(
      adjacencySnapshot("live"),
      "face",
      key("live-circular-face"),
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    let beyondLineageReads = 0;
    const statefulLineage = new Array<KernelTopologyLineage>(1);
    Object.defineProperty(statefulLineage, 0, {
      enumerable: true,
      get() {
        Object.defineProperty(statefulLineage, 1, {
          enumerable: true,
          get() {
            beyondLineageReads += 1;
            return captured.value.lineage[0]!;
          },
        });
        return captured.value.lineage[0]!;
      },
    });
    Object.defineProperty(statefulLineage, "map", {
      value() {
        throw new Error("caller map must not run");
      },
    });
    Object.defineProperty(statefulLineage, Symbol.iterator, {
      value() {
        throw new Error("caller iterator must not run");
      },
    });

    let beyondAdjacencyReads = 0;
    const statefulAdjacency = new Array(1);
    Object.defineProperty(statefulAdjacency, 0, {
      enumerable: true,
      get() {
        Object.defineProperty(statefulAdjacency, 1, {
          enumerable: true,
          get() {
            beyondAdjacencyReads += 1;
            return captured.value.adjacency[0]!;
          },
        });
        return captured.value.adjacency[0]!;
      },
    });
    Object.defineProperty(statefulAdjacency, "map", {
      value() {
        throw new Error("caller map must not run");
      },
    });
    Object.defineProperty(statefulAdjacency, Symbol.iterator, {
      value() {
        throw new Error("caller iterator must not run");
      },
    });

    const statefulReference = {
      ...captured.value,
      lineage: statefulLineage,
      adjacency: statefulAdjacency,
    };
    const resolved = resolveTopologyReference(
      statefulReference,
      snapshot([]),
      {
        capabilities,
        limits: { maxAdjacencyLinks: 1, maxEvidenceRecords: 2 },
      },
    );

    expect(failureCode(resolved)).toBe("TOPOLOGY_MATCH_MISSING");
    expect(beyondLineageReads).toBe(0);
    expect(beyondAdjacencyReads).toBe(0);
  });

  it("rejects forged reference array lengths before copying evidence", () => {
    const captured = capture(
      adjacencySnapshot("proxy"),
      "face",
      key("proxy-circular-face"),
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const forgedArray = <T>(values: readonly T[], length: number): readonly T[] =>
      new Proxy([...values], {
        get(target, property, receiver) {
          return property === "length"
            ? length
            : Reflect.get(target, property, receiver);
        },
      });

    for (const length of [-1, Number.NaN]) {
      expect(
        failureCode(
          resolveTopologyReference(
            {
              ...captured.value,
              adjacency: forgedArray(captured.value.adjacency, length),
            },
            snapshot([]),
            { capabilities },
          ),
        ),
      ).toBe("TOPOLOGY_SIGNATURE_INVALID");
    }
    expect(
      failureCode(
        resolveTopologyReference(
          {
            ...captured.value,
            lineage: forgedArray(captured.value.lineage, 0.5),
          },
          snapshot([]),
          { capabilities },
        ),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");
    expect(
      failureDiagnostic(
        resolveTopologyReference(
          {
            ...captured.value,
            adjacency: forgedArray(captured.value.adjacency, 2),
          },
          snapshot([]),
          { capabilities, limits: { maxAdjacencyLinks: 1 } },
        ),
      ),
    ).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
      details: { resource: "maxAdjacencyLinks", limit: 1, actual: 2 },
    });
  });

  it("does not freeze recursively nested malformed reference scalars", () => {
    const captured = capture(
      snapshot([face("payload", { lineage: [] })], [], "partial"),
      "face",
      key("payload"),
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    interface Payload {
      nested?: Payload;
    }
    const payload: Payload = {};
    let cursor = payload;
    for (let depth = 0; depth < 20_000; depth += 1) {
      const nested: Payload = {};
      cursor.nested = nested;
      cursor = nested;
    }
    const malformed = {
      ...captured.value,
      tolerance: { ...captured.value.tolerance, linear: payload },
    } as unknown as typeof captured.value;

    expect(
      failureCode(
        resolveTopologyReference(malformed, snapshot([]), { capabilities }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");
    expect(Object.isFrozen(payload)).toBe(false);
    expect(Object.isFrozen(cursor)).toBe(false);
  });

  it("contains revoked-proxy exceptions inside CadResult diagnostics", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const captureOptions = { tolerance } as Record<string, unknown>;
    Object.defineProperty(captureOptions, "capabilities", {
      enumerable: true,
      get() {
        throw revoked.proxy;
      },
    });
    const value = snapshot([face("revoked", { lineage: [] })], [], "partial");

    const capturedFailure = captureTopologyReference(
      value,
      "face",
      key("revoked"),
      captureOptions as never,
    );
    expect(failureDiagnostic(capturedFailure)).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_INVALID",
      message: "Persistent topology input could not be read",
    });

    const captured = capture(value, "face", key("revoked"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const hostileReference = new Proxy(captured.value, {
      ownKeys() {
        throw revoked.proxy;
      },
    });
    expect(
      failureDiagnostic(
        resolveTopologyReference(hostileReference, snapshot([]), {
          capabilities,
        }),
      ),
    ).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_INVALID",
      message: "Persistent topology input could not be read",
    });
  });

  it("rejects malformed snapshots as kernel protocol failures", () => {
    const dangling = snapshot([
      face("dangling", { edges: ["missing-edge"] }),
    ]);
    const captured = capture(dangling, "face", key("dangling"));
    expect(failureCode(captured)).toBe("KERNEL_ERROR");

    const valid = capture(
      snapshot([face("valid", { lineage: broadLineage() })]),
      "face",
      key("valid"),
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    const malformedCurrent = snapshot([
      face("duplicate", { lineage: broadLineage() }),
      face("duplicate", { lineage: broadLineage() }),
    ]);
    expect(
      failureCode(
        resolveTopologyReference(valid.value, malformedCurrent, {
          capabilities,
        }),
      ),
    ).toBe("KERNEL_ERROR");
  });

  it("rejects malformed references, capabilities, and tolerances", () => {
    const validSnapshot = snapshot([
      face("valid", { lineage: broadLineage() }),
    ]);
    const malformedCapabilities = {
      protocolVersion: 2,
      fingerprint: "",
    } as any;
    expect(
      failureCode(
        captureTopologyReference(validSnapshot, "face", key("valid"), {
          capabilities: malformedCapabilities,
          tolerance,
        }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");

    expect(
      failureCode(
        captureTopologyReference(validSnapshot, "face", key("valid"), {
          capabilities,
          tolerance: { ...tolerance, linear: -1 },
        }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");

    expect(
      failureCode(
        resolveTopologyReference(
          { protocolVersion: 1 } as any,
          validSnapshot,
          { capabilities },
        ),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");

    const captured = capture(validSnapshot, "face", key("valid"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(
      failureCode(
        resolveTopologyReference(captured.value, validSnapshot, {
          capabilities: { protocolVersion: 1, fingerprint: "" },
        }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");
  });

  it("treats face normals as oriented", () => {
    const before = snapshot(
      [
        face("positive", {
          lineage: [],
          surface: { kind: "plane", normal: [1, 0, 0] },
        }),
      ],
      [],
      "partial",
    );
    const captured = capture(before, "face", key("positive"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const reversed = snapshot(
      [
        face("negative", {
          lineage: [],
          surface: { kind: "plane", normal: [-1, 0, 0] },
        }),
      ],
      [],
      "partial",
    );
    const resolved = resolveTopologyReference(captured.value, reversed, {
      capabilities,
    });
    expect(failureCode(resolved)).toBe("TOPOLOGY_MATCH_MISSING");
  });

  it("treats edge directions as unoriented", () => {
    const before = snapshot(
      [],
      [
        edge("forward", {
          lineage: [],
          curve: { kind: "line", direction: [1, 0, 0] },
        }),
      ],
      "partial",
    );
    const captured = capture(before, "edge", key("forward"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const reversed = snapshot(
      [],
      [
        edge("backward", {
          lineage: [],
          curve: { kind: "line", direction: [-1, 0, 0] },
        }),
      ],
      "partial",
    );
    const resolved = resolveTopologyReference(captured.value, reversed, {
      capabilities,
    });
    expect(resolved).toEqual({
      ok: true,
      value: {
        key: key("backward"),
        evidence: "geometry-adjacency",
      },
      diagnostics: [],
    });
  });

  it("keeps coordinate matching independent of the world-space origin", () => {
    for (const origin of [0, 1_000_000_000]) {
      const before = snapshot(
        [
          face(`before-${origin}`, {
            center: [origin, 0, 0],
            bounds: {
              min: [origin, -1, -1],
              max: [origin, 1, 1],
            },
            lineage: [],
          }),
        ],
        [],
        "partial",
      );
      const captured = capture(before, "face", key(`before-${origin}`));
      expect(captured.ok).toBe(true);
      if (!captured.ok) continue;
      const withinTolerance = origin + 5e-7;
      const current = snapshot(
        [
          face(`current-${origin}`, {
            center: [withinTolerance, 0, 0],
            bounds: {
              min: [withinTolerance, -1, -1],
              max: [withinTolerance, 1, 1],
            },
            lineage: [],
          }),
        ],
        [],
        "partial",
      );
      expect(
        resolveTopologyReference(captured.value, current, { capabilities }).ok,
      ).toBe(true);
    }

    const origin = 1_000_000_000;
    const before = snapshot(
      [face("far-before", { center: [origin, 0, 0], lineage: [] })],
      [],
      "partial",
    );
    const captured = capture(before, "face", key("far-before"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const outsideAbsoluteTolerance = snapshot(
      [face("far-after", { center: [origin + 0.1, 0, 0], lineage: [] })],
      [],
      "partial",
    );
    expect(
      failureCode(
        resolveTopologyReference(captured.value, outsideAbsoluteTolerance, {
          capabilities,
        }),
      ),
    ).toBe("TOPOLOGY_MATCH_MISSING");
  });

  it("resolves angular differences below 1e-8 without acos precision loss", () => {
    const angularTolerance = 1e-9;
    const before = snapshot(
      [
        face("angular-before", {
          lineage: [],
          surface: { kind: "plane", normal: [1, 0, 0] },
        }),
      ],
      [],
      "partial",
    );
    const captured = captureTopologyReference(
      before,
      "face",
      key("angular-before"),
      {
        capabilities,
        tolerance: { linear: 1e-6, angular: angularTolerance, relative: 0 },
      },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const rotated = (id: string, angle: number): KernelTopologySnapshot =>
      snapshot(
        [
          face(id, {
            lineage: [],
            surface: {
              kind: "plane",
              normal: [Math.cos(angle), Math.sin(angle), 0],
            },
          }),
        ],
        [],
        "partial",
      );
    expect(
      resolveTopologyReference(captured.value, rotated("inside", 5e-10), {
        capabilities,
      }).ok,
    ).toBe(true);
    expect(
      failureCode(
        resolveTopologyReference(captured.value, rotated("outside", 5e-9), {
          capabilities,
        }),
      ),
    ).toBe("TOPOLOGY_MATCH_MISSING");
  });

  it("normalizes every finite nonzero direction without overflow or underflow", () => {
    const captureNormal = (id: string, normal: readonly [number, number, number]) =>
      captureTopologyReference(
        snapshot(
          [
            face(id, {
              lineage: [],
              surface: { kind: "plane", normal },
            }),
          ],
          [],
          "partial",
        ),
        "face",
        key(id),
        {
          capabilities,
          tolerance: { linear: 1e-6, angular: 1e-9, relative: 0 },
        },
      );

    const huge = captureNormal("huge", [
      Number.MAX_VALUE,
      Number.MAX_VALUE,
      0,
    ]);
    expect(huge.ok).toBe(true);
    if (!huge.ok) return;
    const aligned = snapshot(
      [
        face("huge-aligned", {
          lineage: [],
          surface: {
            kind: "plane",
            normal: [Number.MAX_VALUE / 2, Number.MAX_VALUE / 2, 0],
          },
        }),
      ],
      [],
      "partial",
    );
    expect(
      resolveTopologyReference(huge.value, aligned, { capabilities }).ok,
    ).toBe(true);
    const orthogonal = snapshot(
      [
        face("huge-orthogonal", {
          lineage: [],
          surface: {
            kind: "plane",
            normal: [Number.MAX_VALUE, -Number.MAX_VALUE, 0],
          },
        }),
      ],
      [],
      "partial",
    );
    expect(
      failureCode(
        resolveTopologyReference(huge.value, orthogonal, { capabilities }),
      ),
    ).toBe("TOPOLOGY_MATCH_MISSING");

    const tiny = captureNormal("tiny", [Number.MIN_VALUE, 0, 0]);
    expect(tiny.ok).toBe(true);
    if (!tiny.ok) return;
    const tinyAligned = snapshot(
      [
        face("tiny-aligned", {
          lineage: [],
          surface: {
            kind: "plane",
            normal: [Number.MIN_VALUE * 2, 0, 0],
          },
        }),
      ],
      [],
      "partial",
    );
    expect(
      resolveTopologyReference(tiny.value, tinyAligned, { capabilities }).ok,
    ).toBe(true);
  });

  it("compiles repeated reference and shared-neighbor evidence once per call", () => {
    const sharedNeighborReads = (faceCount: number): number => {
      let featureReads = 0;
      const sharedLineage = {
        get feature() {
          featureReads += 1;
          return "shared-edge";
        },
        relation: "created" as const,
      } as KernelTopologyLineage;
      const faceIds = Array.from(
        { length: faceCount },
        (_, index) => `face-${index}`,
      );
      const value = snapshot(
        faceIds.map((id) =>
          face(id, {
            lineage: [
              {
                feature: id,
                relation: "created",
                role: "box.face.x-min",
              },
            ],
            edges: ["shared-edge"],
          }),
        ),
        [
          edge("shared-edge", {
            lineage: [sharedLineage],
            faces: faceIds,
          }),
        ],
      );
      expect(capture(value, "face", key("face-0")).ok).toBe(true);
      return featureReads;
    };
    expect(sharedNeighborReads(8)).toBe(sharedNeighborReads(1));

    const repeatedReferenceReads = (candidateCount: number): number => {
      const original = snapshot([
        face("original", {
          lineage: [
            {
              feature: "stable-face",
              relation: "created",
              role: "box.face.x-min",
            },
          ],
        }),
      ]);
      const captured = capture(original, "face", key("original"));
      expect(captured.ok).toBe(true);
      if (!captured.ok) return -1;
      let featureReads = 0;
      const accessorLineage = {
        get feature() {
          featureReads += 1;
          return "stable-face";
        },
        relation: "created" as const,
        role: "box.face.x-min" as const,
      } as KernelTopologyLineage;
      const mutableReference = {
        ...captured.value,
        lineage: [accessorLineage],
      };
      const current = snapshot(
        Array.from({ length: candidateCount }, (_, index) =>
          face(`candidate-${index}`, {
            lineage: [
              {
                feature: "stable-face",
                relation: "created",
                role: "box.face.x-min",
              },
            ],
          }),
        ),
      );
      const result = resolveTopologyReference(mutableReference, current, {
        capabilities,
      });
      expect(result.ok).toBe(candidateCount === 1);
      return featureReads;
    };
    expect(repeatedReferenceReads(8)).toBe(repeatedReferenceReads(1));
  });

  it("uses an augmenting path for non-greedy adjacency matches", () => {
    const matchingTolerance = {
      linear: 0.6,
      angular: 1e-9,
      relative: 0,
    };
    const before = snapshot(
      [face("before-face", { lineage: [], edges: ["source-a", "source-b"] })],
      [
        edge("source-a", {
          center: [0, 0, 0],
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          lineage: [],
          length: 1,
          faces: ["before-face"],
        }),
        edge("source-b", {
          center: [0.5, 0, 0],
          bounds: { min: [0.5, 0, 0], max: [0.5, 0, 0] },
          lineage: [],
          length: 2,
          faces: ["before-face"],
        }),
      ],
      "partial",
    );
    const captured = captureTopologyReference(
      before,
      "face",
      key("before-face"),
      { capabilities, tolerance: matchingTolerance },
    );
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const after = snapshot(
      [face("after-face", { lineage: [], edges: ["target-0", "target-1"] })],
      [
        edge("target-0", {
          center: [0, 0, 0],
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          lineage: [],
          length: 1.5,
          faces: ["after-face"],
        }),
        edge("target-1", {
          center: [0.2, 0, 0],
          bounds: { min: [0.2, 0, 0], max: [0.2, 0, 0] },
          lineage: [],
          length: 0.5,
          faces: ["after-face"],
        }),
      ],
      "partial",
    );
    expect(resolveTopologyReference(captured.value, after, { capabilities })).toEqual({
      ok: true,
      value: { key: key("after-face"), evidence: "geometry-adjacency" },
      diagnostics: [],
    });
  });

  it("fails closed when a semantic anchor splits, merges, or disappears", () => {
    const before = snapshot([
      face("before-min", { lineage: boxFaceLineage("box.face.x-min") }),
    ]);
    const captured = capture(before, "face", key("before-min"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const split = snapshot([
      face("split-a", { lineage: boxFaceLineage("box.face.x-min") }),
      face("split-b", { lineage: boxFaceLineage("box.face.x-min") }),
    ]);
    expect(
      failureCode(
        resolveTopologyReference(captured.value, split, { capabilities }),
      ),
    ).toBe("TOPOLOGY_MATCH_AMBIGUOUS");

    const merged = snapshot([
      face("merged", {
        lineage: [
          ...boxFaceLineage("box.face.x-min"),
          ...boxFaceLineage("box.face.x-max"),
        ],
      }),
    ]);
    expect(
      failureCode(
        resolveTopologyReference(captured.value, merged, { capabilities }),
      ),
    ).toBe("TOPOLOGY_MATCH_MISSING");

    const disappeared = snapshot([
      face("replacement", {
        lineage: boxFaceLineage("box.face.x-max"),
      }),
    ]);
    expect(
      failureCode(
        resolveTopologyReference(captured.value, disappeared, {
          capabilities,
        }),
      ),
    ).toBe("TOPOLOGY_MATCH_MISSING");
  });

  it("returns CadResult failures for malformed options and limit overrides", () => {
    const value = snapshot([
      face("valid", { lineage: boxFaceLineage("box.face.x-min") }),
    ]);
    expect(
      failureCode(
        captureTopologyReference(
          value,
          "face",
          key("valid"),
          undefined as never,
        ),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");

    const captured = capture(value, "face", key("valid"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(
      failureCode(
        resolveTopologyReference(captured.value, value, null as never),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_INVALID");

    for (const limits of [
      { maxTopologyItems: -1 },
      { maxCandidatePairs: 1.5 },
      { maxTopologyItems: undefined },
      { unknownLimit: 1 },
      null,
    ]) {
      expect(
        failureCode(
          captureTopologyReference(value, "face", key("valid"), {
            capabilities,
            tolerance,
            limits: limits as never,
          }),
        ),
      ).toBe("TOPOLOGY_SIGNATURE_INVALID");
    }

    let inheritedReads = 0;
    const inheritedLimits = Object.create(
      Object.defineProperty({}, "maxTopologyItems", {
        enumerable: true,
        get() {
          inheritedReads += 1;
          return 0;
        },
      }),
    ) as Record<string, number>;
    expect(
      captureTopologyReference(value, "face", key("valid"), {
        capabilities,
        tolerance,
        limits: inheritedLimits,
      }).ok,
    ).toBe(true);
    expect(inheritedReads).toBe(0);
  });

  it("enforces topology, adjacency, evidence, candidate, and work limits", () => {
    const semantic = snapshot([
      face("semantic", { lineage: boxFaceLineage("box.face.x-min") }),
    ]);
    const topologyLimit = captureTopologyReference(
      semantic,
      "face",
      key("semantic"),
      { capabilities, tolerance, limits: { maxTopologyItems: 0 } },
    );
    expect(failureDiagnostic(topologyLimit)).toMatchObject({
      code: "TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED",
      details: { resource: "maxTopologyItems", limit: 0, actual: 1 },
    });

    const connected = snapshot(
      [
        face("connected-face", {
          lineage: [],
          edges: ["connected-edge"],
        }),
      ],
      [
        edge("connected-edge", {
          lineage: [],
          faces: ["connected-face"],
        }),
      ],
      "partial",
    );
    expect(
      failureCode(
        captureTopologyReference(
          connected,
          "face",
          key("connected-face"),
          { capabilities, tolerance, limits: { maxAdjacencyLinks: 1 } },
        ),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED");
    expect(
      failureCode(
        captureTopologyReference(semantic, "face", key("semantic"), {
          capabilities,
          tolerance,
          limits: { maxEvidenceRecords: 1 },
        }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED");
    expect(
      failureCode(
        captureTopologyReference(semantic, "face", key("semantic"), {
          capabilities,
          tolerance,
          limits: { maxCandidatePairs: 0 },
        }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED");
    expect(
      failureCode(
        captureTopologyReference(
          connected,
          "face",
          key("connected-face"),
          { capabilities, tolerance, limits: { maxMatchingSteps: 0 } },
        ),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED");
    expect(
      failureCode(
        captureTopologyReference(semantic, "face", key("semantic"), {
          capabilities,
          tolerance,
          limits: { maxMatchingSteps: 0 },
        }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED");

    const captured = capture(semantic, "face", key("semantic"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(
      failureCode(
        resolveTopologyReference(captured.value, semantic, {
          capabilities,
          limits: { maxEvidenceRecords: 1 },
        }),
      ),
    ).toBe("TOPOLOGY_SIGNATURE_LIMIT_EXCEEDED");
  });

  it("serializes a detached reference without evaluation keys or indices", () => {
    const { before } = semanticSnapshots();
    const captured = capture(before, "face", key("old-min"));
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const json = JSON.stringify(captured.value);
    expect(json).not.toContain("old-min");
    expect(json).not.toMatch(/"key"\s*:/i);
    expect(json).not.toMatch(/"[^"]*index[^"]*"\s*:/i);
  });
});
