import { describe, expect, it } from "vitest";
import {
  detachKernelTopologySnapshot,
  normalizeKernelTopologySnapshot,
  validateKernelTopologySnapshot,
} from "../src/internal/topology-snapshot.js";
import type { KernelTopologySnapshot } from "../src/protocol/topology.js";

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

describe("kernel topology snapshot validation", () => {
  it("returns the validated snapshot without copying it", () => {
    const snapshot: KernelTopologySnapshot = {
      history: "complete",
      faces: [],
      edges: [],
      vertices: [],
    };

    const result = validateKernelTopologySnapshot(snapshot);

    expect(result).toEqual({ ok: true, value: snapshot, diagnostics: [] });
    if (result.ok) expect(result.value).toBe(snapshot);
  });

  it("detaches and deeply freezes every nested topology value", () => {
    const source = {
      history: "complete",
      faces: [
        {
          topology: "face",
          key: "face",
          center: [1, 2, 3],
          bounds: { min: [0, 0, 0], max: [2, 4, 6] },
          lineage: [
            {
              feature: "extrude",
              relation: "created",
              role: "extrude.face.side",
              source: {
                kind: "sketch-entity",
                sketch: "profile",
                entity: "segment",
              },
            },
          ],
          area: 12,
          surface: { kind: "plane", normal: [0, 0, 1] },
          edges: ["edge"],
        },
      ],
      edges: [
        {
          topology: "edge",
          key: "edge",
          center: [1, 0, 0],
          bounds: { min: [0, 0, 0], max: [2, 0, 0] },
          lineage: [{ feature: "extrude", relation: "created" }],
          length: 2,
          curve: { kind: "line", direction: [1, 0, 0] },
          faces: ["face"],
          vertices: ["vertex"],
        },
      ],
      vertices: [
        {
          topology: "vertex",
          key: "vertex",
          point: [0, 0, 0],
          lineage: [{ feature: "extrude", relation: "created" }],
          edges: ["edge"],
        },
      ],
    } as unknown as KernelTopologySnapshot;

    const detached = detachKernelTopologySnapshot(source);

    expect(detached).toEqual(source);
    expect(detached).not.toBe(source);
    expect(detached.faces).not.toBe(source.faces);
    expect(detached.faces[0]).not.toBe(source.faces[0]);
    expect(detached.faces[0]!.center).not.toBe(source.faces[0]!.center);
    expect(detached.faces[0]!.lineage[0]).not.toBe(
      source.faces[0]!.lineage[0],
    );
    expect(detached.faces[0]!.lineage[0]!.source).not.toBe(
      source.faces[0]!.lineage[0]!.source,
    );
    expect(detached.edges[0]!.curve).not.toBe(source.edges[0]!.curve);
    expect(detached.vertices[0]!.point).not.toBe(source.vertices[0]!.point);
    expectDeeplyFrozen(detached);
    expect(Object.isFrozen(source)).toBe(false);
    expect(Object.isFrozen(source.faces[0]!.center)).toBe(false);

    (source.faces[0]!.center as unknown as number[])[0] = 999;
    (source.faces[0]!.lineage[0]!.source as { entity: string }).entity =
      "changed";
    (source.edges[0]!.curve.direction as unknown as number[])[0] = -1;
    expect(detached.faces[0]!.center).toEqual([1, 2, 3]);
    expect(detached.faces[0]!.lineage[0]!.source?.entity).toBe("segment");
    expect(detached.edges[0]!.curve.direction).toEqual([1, 0, 0]);
    expect(detached.vertices[0]!.point).toEqual([0, 0, 0]);
  });

  it("maps protocol failures to the existing kernel diagnostic", () => {
    const result = validateKernelTopologySnapshot({
      history: "unknown",
      faces: [],
      edges: [],
      vertices: [],
    });

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "KERNEL_ERROR",
          message: "Geometry kernel returned an invalid topology history status",
          severity: "error",
          details: { history: "unknown", protocolViolation: true },
        },
      ],
    });
  });

  it("rejects sparse descriptor, vector, and adjacency arrays", () => {
    const sparseFaces = new Array(1);
    expect(
      validateKernelTopologySnapshot({
        history: "complete",
        faces: sparseFaces,
        edges: [],
        vertices: [],
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            code: "KERNEL_ERROR",
            message: "Geometry kernel returned sparse topology collections",
          }),
        ],
      }),
    );

    const sparseCenter = [0, 0, 0];
    delete sparseCenter[1];
    expect(
      validateKernelTopologySnapshot({
        history: "complete",
        faces: [
          {
            topology: "face",
            key: "face",
            center: sparseCenter,
            bounds: { min: [0, 0, 0], max: [0, 0, 0] },
            lineage: [],
            area: 0,
            surface: { kind: "plane" },
            edges: [],
          },
        ],
        edges: [],
        vertices: [],
      }),
    ).toEqual(expect.objectContaining({ ok: false }));

    const sparseEdges = new Array(1);
    expect(
      validateKernelTopologySnapshot({
        history: "complete",
        faces: [
          {
            topology: "face",
            key: "face",
            center: [0, 0, 0],
            bounds: { min: [0, 0, 0], max: [0, 0, 0] },
            lineage: [],
            area: 0,
            surface: { kind: "plane" },
            edges: sparseEdges,
          },
        ],
        edges: [],
        vertices: [],
      }),
    ).toEqual(expect.objectContaining({ ok: false }));
  });

  it("validates reciprocal incidence without degree-squared includes scans", () => {
    const faceEdges = ["edge"];
    const edgeFaces = ["face"];
    const edgeVertices = ["vertex"];
    const vertexEdges = ["edge"];
    let includesCalls = 0;
    const rejectIncludes = (): never => {
      includesCalls += 1;
      throw new Error("reciprocity must use precomputed membership sets");
    };
    Object.defineProperty(faceEdges, "includes", { value: rejectIncludes });
    Object.defineProperty(edgeFaces, "includes", { value: rejectIncludes });
    Object.defineProperty(edgeVertices, "includes", { value: rejectIncludes });
    Object.defineProperty(vertexEdges, "includes", { value: rejectIncludes });

    const result = validateKernelTopologySnapshot({
      history: "complete",
      faces: [
        {
          topology: "face",
          key: "face",
          center: [0, 0, 0],
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          lineage: [],
          area: 0,
          surface: { kind: "plane" },
          edges: faceEdges,
        },
      ],
      edges: [
        {
          topology: "edge",
          key: "edge",
          center: [0, 0, 0],
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          lineage: [],
          length: 0,
          curve: { kind: "line" },
          faces: edgeFaces,
          vertices: edgeVertices,
        },
      ],
      vertices: [
        {
          topology: "vertex",
          key: "vertex",
          point: [0, 0, 0],
          lineage: [],
          edges: vertexEdges,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(includesCalls).toBe(0);
  });

  it("rejects invalid vertex points and non-reciprocal edge incidence", () => {
    const edge = {
      topology: "edge",
      key: "edge",
      center: [0, 0, 0],
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      lineage: [],
      length: 0,
      curve: { kind: "line" },
      faces: [],
      vertices: ["vertex"],
    };
    const invalidPoint = validateKernelTopologySnapshot({
      history: "complete",
      faces: [],
      edges: [edge],
      vertices: [
        {
          topology: "vertex",
          key: "vertex",
          point: [Number.NaN, 0, 0],
          lineage: [],
          edges: ["edge"],
        },
      ],
    });
    expect(invalidPoint).toEqual(
      expect.objectContaining({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            message: "Geometry kernel returned an invalid topology point",
          }),
        ],
      }),
    );

    const nonReciprocal = validateKernelTopologySnapshot({
      history: "complete",
      faces: [],
      edges: [edge],
      vertices: [
        {
          topology: "vertex",
          key: "vertex",
          point: [0, 0, 0],
          lineage: [],
          edges: [],
        },
      ],
    });
    expect(nonReciprocal).toEqual(
      expect.objectContaining({
        ok: false,
        diagnostics: [
          expect.objectContaining({
            message: "Geometry kernel returned invalid edge-to-vertex adjacency",
          }),
        ],
      }),
    );
  });

  it("accepts scale-independent finite direction vectors", () => {
    for (const normal of [
      [Number.MAX_VALUE, Number.MAX_VALUE, 0],
      [Number.MIN_VALUE, 0, 0],
    ]) {
      expect(
        validateKernelTopologySnapshot({
          history: "complete",
          faces: [
            {
              topology: "face",
              key: "face",
              center: [0, 0, 0],
              bounds: { min: [0, 0, 0], max: [0, 0, 0] },
              lineage: [],
              area: 0,
              surface: { kind: "plane", normal },
              edges: [],
            },
          ],
          edges: [],
          vertices: [],
        }).ok,
      ).toBe(true);
    }
  });

  it("copies accessor-backed kernel values once before validation", () => {
    let centerReads = 0;
    const center = [0, 0, 0];
    Object.defineProperty(center, 0, {
      enumerable: true,
      configurable: true,
      get() {
        centerReads += 1;
        return centerReads === 1 ? 7 : Number.POSITIVE_INFINITY;
      },
    });
    const result = normalizeKernelTopologySnapshot({
      history: "complete",
      faces: [
        {
          topology: "face",
          key: "face",
          center,
          bounds: { min: [0, 0, 0], max: [10, 10, 10] },
          lineage: [],
          area: 1,
          surface: { kind: "plane", normal: [0, 0, 1] },
          edges: [],
        },
      ],
      edges: [],
      vertices: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.faces[0]!.center).toEqual([7, 0, 0]);
    expect(centerReads).toBe(1);
    expectDeeplyFrozen(result.value);
  });

  it("captures array lengths once without invoking caller iteration hooks", () => {
    let beyondFaceReads = 0;
    let beyondLineageReads = 0;
    const lineage = new Array(1);
    Object.defineProperty(lineage, 0, {
      enumerable: true,
      get() {
        Object.defineProperty(lineage, 1, {
          enumerable: true,
          get() {
            beyondLineageReads += 1;
            return { feature: "ignored", relation: "created" };
          },
        });
        return { feature: "source", relation: "created" };
      },
    });
    Object.defineProperty(lineage, "map", {
      value() {
        throw new Error("caller map must not run");
      },
    });
    Object.defineProperty(lineage, Symbol.iterator, {
      value() {
        throw new Error("caller iterator must not run");
      },
    });
    const adjacency: string[] = [];
    Object.defineProperty(adjacency, Symbol.iterator, {
      value() {
        throw new Error("caller iterator must not run");
      },
    });
    const rawFace = {
      topology: "face",
      key: "face",
      center: [0, 0, 0],
      bounds: { min: [0, 0, 0], max: [0, 0, 0] },
      lineage,
      area: 1,
      surface: { kind: "plane", normal: [0, 0, 1] },
      edges: adjacency,
    };
    const faces = new Array(1);
    Object.defineProperty(faces, 0, {
      enumerable: true,
      get() {
        Object.defineProperty(faces, 1, {
          enumerable: true,
          get() {
            beyondFaceReads += 1;
            return rawFace;
          },
        });
        return rawFace;
      },
    });
    Object.defineProperty(faces, "map", {
      value() {
        throw new Error("caller map must not run");
      },
    });
    Object.defineProperty(faces, Symbol.iterator, {
      value() {
        throw new Error("caller iterator must not run");
      },
    });

    const result = normalizeKernelTopologySnapshot(
      { history: "complete", faces, edges: [], vertices: [] },
      {
        maxTopologyItems: 1,
        maxAdjacencyLinks: 0,
        maxEvidenceRecords: 1,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.faces).toHaveLength(1);
    expect(result.value.faces[0]!.lineage).toHaveLength(1);
    expect(beyondFaceReads).toBe(0);
    expect(beyondLineageReads).toBe(0);
  });

  it("does not freeze recursively nested malformed snapshot scalars", () => {
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

    const result = normalizeKernelTopologySnapshot({
      history: "complete",
      faces: [
        {
          topology: "face",
          key: "face",
          center: [payload, 0, 0],
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          lineage: [],
          area: 1,
          surface: { kind: "plane", normal: [0, 0, 1] },
          edges: [],
        },
      ],
      edges: [],
      vertices: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.code).toBe("KERNEL_ERROR");
    expect(result.diagnostics[0]?.message).not.toContain("call stack");
    expect(Object.isFrozen(payload)).toBe(false);
    expect(Object.isFrozen(cursor)).toBe(false);
  });

  it("contains revoked-proxy exceptions as kernel diagnostics", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const snapshot = Object.defineProperty(
      { faces: [], edges: [], vertices: [] },
      "history",
      {
        enumerable: true,
        get() {
          throw revoked.proxy;
        },
      },
    );

    const result = normalizeKernelTopologySnapshot(snapshot);

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "KERNEL_ERROR",
          message: "Geometry kernel topology access failed",
          severity: "error",
          details: { protocolViolation: true },
        },
      ],
    });
  });
});
