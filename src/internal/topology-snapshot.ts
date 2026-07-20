import type { Vec3 } from "../core/math.js";
import { deepFreeze } from "../core/json.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
} from "../core/result.js";
import {
  TOPOLOGY_ROLE_RULES,
  type KernelEdgeDescriptor,
  type KernelFaceDescriptor,
  type KernelTopologyLineage,
  type KernelTopologyKey,
  type KernelTopologySnapshot,
  type KernelVertexDescriptor,
  type TopologyKind,
  type TopologyRole,
} from "../protocol/topology.js";

type KernelTopologySnapshotValidationFailure = (
  message: string,
  details: Readonly<Record<string, unknown>>,
) => never;

const snapshotValidationErrors = new WeakSet<object>();

class KernelTopologySnapshotValidationError extends Error {
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    details: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "KernelTopologySnapshotValidationError";
    this.details = details;
    snapshotValidationErrors.add(this);
  }
}

function isSnapshotValidationError(
  value: unknown,
): value is KernelTopologySnapshotValidationError {
  return (
    typeof value === "object" &&
    value !== null &&
    snapshotValidationErrors.has(value)
  );
}

export interface KernelTopologySnapshotCopyLimits {
  readonly maxTopologyItems: number;
  readonly maxAdjacencyLinks: number;
  readonly maxEvidenceRecords: number;
}

export type KernelTopologySnapshotCopyResource =
  keyof KernelTopologySnapshotCopyLimits;

const snapshotCopyLimitErrors = new WeakSet<object>();

export class KernelTopologySnapshotCopyLimitError extends Error {
  readonly resource: KernelTopologySnapshotCopyResource;
  readonly limit: number;
  readonly actual: number;

  constructor(
    resource: KernelTopologySnapshotCopyResource,
    limit: number,
    actual: number,
  ) {
    super(`Topology-signature ${resource} limit ${limit} was exceeded by ${actual}`);
    this.name = "KernelTopologySnapshotCopyLimitError";
    this.resource = resource;
    this.limit = limit;
    this.actual = actual;
    snapshotCopyLimitErrors.add(this);
  }
}

export function isKernelTopologySnapshotCopyLimitError(
  value: unknown,
): value is KernelTopologySnapshotCopyLimitError {
  return (
    typeof value === "object" &&
    value !== null &&
    snapshotCopyLimitErrors.has(value)
  );
}

interface KernelTopologySnapshotCopyContext {
  readonly limits: KernelTopologySnapshotCopyLimits | undefined;
  adjacencyLinks: number;
  evidenceRecords: number;
}

const MAX_ARRAY_LENGTH = 0xffff_ffff;

function copyArray(
  value: unknown,
  message: string,
): { readonly value: readonly unknown[]; readonly length: number } {
  if (!Array.isArray(value)) throw new TypeError(message);
  const length = value.length;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_ARRAY_LENGTH
  ) {
    throw new TypeError(message);
  }
  return { value, length };
}

function enforceCopyLimit(
  context: KernelTopologySnapshotCopyContext,
  resource: KernelTopologySnapshotCopyResource,
  actual: number,
): void {
  const limit = context.limits?.[resource];
  if (limit !== undefined && actual > limit) {
    throw new KernelTopologySnapshotCopyLimitError(resource, limit, actual);
  }
}

function copyVector(value: unknown): Vec3 {
  const message = "Geometry kernel returned an invalid topology vector";
  const copiedArray = copyArray(value, message);
  const { length } = copiedArray;
  const array = copiedArray.value;
  if (
    length !== 3 ||
    !Object.hasOwn(array, 0) ||
    !Object.hasOwn(array, 1) ||
    !Object.hasOwn(array, 2)
  ) {
    throw new TypeError(message);
  }
  const first = array[0];
  const second = array[1];
  const third = array[2];
  return [first, second, third] as unknown as Vec3;
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Geometry kernel returned invalid topology data");
  }
  return value as Readonly<Record<string, unknown>>;
}

function copyLineage(value: unknown): KernelTopologyLineage {
  const raw = recordValue(value);
  const feature = raw.feature;
  const relation = raw.relation;
  const role = raw.role;
  const rawSource = raw.source;
  const source =
    rawSource === undefined
      ? undefined
      : (() => {
          const sourceRecord = recordValue(rawSource);
          const kind = sourceRecord.kind;
          const sketch = sourceRecord.sketch;
          const entity = sourceRecord.entity;
          return { kind, sketch, entity };
        })();
  return {
    feature,
    relation,
    ...(role === undefined ? {} : { role }),
    ...(source === undefined ? {} : { source }),
  } as unknown as KernelTopologyLineage;
}

function copyLineageArray(
  value: unknown,
  context: KernelTopologySnapshotCopyContext,
): readonly KernelTopologyLineage[] {
  const copiedArray = copyArray(
    value,
    "Geometry kernel returned invalid topology lineage",
  );
  const { length } = copiedArray;
  const array = copiedArray.value;
  context.evidenceRecords += length;
  enforceCopyLimit(
    context,
    "maxEvidenceRecords",
    context.evidenceRecords,
  );
  const copied = new Array<KernelTopologyLineage>(length);
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(array, index)) {
      throw new TypeError("Geometry kernel returned sparse topology lineage");
    }
    copied[index] = copyLineage(array[index]);
  }
  return copied;
}

function copyTopologyKeys(
  value: unknown,
  context: KernelTopologySnapshotCopyContext,
): readonly KernelTopologyKey[] {
  const copiedArray = copyArray(
    value,
    "Geometry kernel returned invalid topology adjacency",
  );
  const { length } = copiedArray;
  const array = copiedArray.value;
  context.adjacencyLinks += length;
  enforceCopyLimit(
    context,
    "maxAdjacencyLinks",
    context.adjacencyLinks,
  );
  const copied = new Array<KernelTopologyKey>(length);
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(array, index)) {
      throw new TypeError("Geometry kernel returned sparse topology adjacency");
    }
    copied[index] = array[index] as KernelTopologyKey;
  }
  return copied;
}

function copyFaceDescriptor(
  value: unknown,
  context: KernelTopologySnapshotCopyContext,
): KernelFaceDescriptor {
  const face = recordValue(value);
  const topology = face.topology;
  const key = face.key;
  const center = face.center;
  const rawBounds = recordValue(face.bounds);
  const minimum = rawBounds.min;
  const maximum = rawBounds.max;
  const lineage = face.lineage;
  const area = face.area;
  const rawSurface = recordValue(face.surface);
  const kind = rawSurface.kind;
  const normal = rawSurface.normal;
  const axis = rawSurface.axis;
  const radius = rawSurface.radius;
  const edges = face.edges;
  return {
    topology,
    key,
    center: copyVector(center),
    bounds: {
      min: copyVector(minimum),
      max: copyVector(maximum),
    },
    lineage: copyLineageArray(lineage, context),
    area,
    surface: {
      kind,
      ...(normal === undefined ? {} : { normal: copyVector(normal) }),
      ...(axis === undefined ? {} : { axis: copyVector(axis) }),
      ...(radius === undefined ? {} : { radius }),
    },
    edges: copyTopologyKeys(edges, context),
  } as unknown as KernelFaceDescriptor;
}

function copyEdgeDescriptor(
  value: unknown,
  context: KernelTopologySnapshotCopyContext,
): KernelEdgeDescriptor {
  const edge = recordValue(value);
  const topology = edge.topology;
  const key = edge.key;
  const center = edge.center;
  const rawBounds = recordValue(edge.bounds);
  const minimum = rawBounds.min;
  const maximum = rawBounds.max;
  const lineage = edge.lineage;
  const length = edge.length;
  const rawCurve = recordValue(edge.curve);
  const kind = rawCurve.kind;
  const direction = rawCurve.direction;
  const axis = rawCurve.axis;
  const radius = rawCurve.radius;
  const faces = edge.faces;
  const vertices = edge.vertices;
  return {
    topology,
    key,
    center: copyVector(center),
    bounds: {
      min: copyVector(minimum),
      max: copyVector(maximum),
    },
    lineage: copyLineageArray(lineage, context),
    length,
    curve: {
      kind,
      ...(direction === undefined
        ? {}
        : { direction: copyVector(direction) }),
      ...(axis === undefined ? {} : { axis: copyVector(axis) }),
      ...(radius === undefined ? {} : { radius }),
    },
    faces: copyTopologyKeys(faces, context),
    vertices: copyTopologyKeys(vertices, context),
  } as unknown as KernelEdgeDescriptor;
}

function copyVertexDescriptor(
  value: unknown,
  context: KernelTopologySnapshotCopyContext,
): KernelVertexDescriptor {
  const vertex = recordValue(value);
  const topology = vertex.topology;
  const key = vertex.key;
  const point = vertex.point;
  const lineage = vertex.lineage;
  const edges = vertex.edges;
  return {
    topology,
    key,
    point: copyVector(point),
    lineage: copyLineageArray(lineage, context),
    edges: copyTopologyKeys(edges, context),
  } as unknown as KernelVertexDescriptor;
}

/**
 * Reads a kernel snapshot once into an evaluation-owned immutable graph.
 * Array lengths are captured before copying, caller iteration hooks are not
 * invoked, and optional size limits are charged during that same pass. No
 * descriptor, lineage item, geometry object, vector, or adjacency array is
 * shared with the kernel's potentially cached source value.
 */
export function detachKernelTopologySnapshot(
  snapshot: KernelTopologySnapshot,
  limits?: KernelTopologySnapshotCopyLimits,
): KernelTopologySnapshot {
  const rawSnapshot = recordValue(snapshot);
  const history = rawSnapshot.history;
  const rawFaces = rawSnapshot.faces;
  const rawEdges = rawSnapshot.edges;
  const rawVertices = rawSnapshot.vertices;
  const copiedFaces = copyArray(
    rawFaces,
    "Geometry kernel returned invalid topology collections",
  );
  const copiedEdges = copyArray(
    rawEdges,
    "Geometry kernel returned invalid topology collections",
  );
  const copiedVertices = copyArray(
    rawVertices,
    "Geometry kernel returned invalid topology collections",
  );
  const faceCount = copiedFaces.length;
  const edgeCount = copiedEdges.length;
  const vertexCount = copiedVertices.length;
  const topologyItems = faceCount + edgeCount + vertexCount;
  const context: KernelTopologySnapshotCopyContext = {
    limits,
    adjacencyLinks: 0,
    evidenceRecords: 0,
  };
  enforceCopyLimit(context, "maxTopologyItems", topologyItems);
  const faces = new Array<KernelFaceDescriptor>(faceCount);
  for (let index = 0; index < faceCount; index += 1) {
    if (!Object.hasOwn(copiedFaces.value, index)) {
      throw new TypeError("Geometry kernel returned sparse topology collections");
    }
    faces[index] = copyFaceDescriptor(copiedFaces.value[index], context);
  }
  const edges = new Array<KernelEdgeDescriptor>(edgeCount);
  for (let index = 0; index < edgeCount; index += 1) {
    if (!Object.hasOwn(copiedEdges.value, index)) {
      throw new TypeError("Geometry kernel returned sparse topology collections");
    }
    edges[index] = copyEdgeDescriptor(copiedEdges.value[index], context);
  }
  const vertices = new Array<KernelVertexDescriptor>(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) {
    if (!Object.hasOwn(copiedVertices.value, index)) {
      throw new TypeError("Geometry kernel returned sparse topology collections");
    }
    vertices[index] = copyVertexDescriptor(
      copiedVertices.value[index],
      context,
    );
  }
  const detached = {
    history,
    faces,
    edges,
    vertices,
  } as unknown as KernelTopologySnapshot;
  assertValidKernelTopologySnapshot(detached, (message, details): never => {
    throw new KernelTopologySnapshotValidationError(message, details);
  });
  return deepFreeze(detached);
}

/**
 * Validates an untrusted kernel topology snapshot and its complete reciprocal
 * face/edge and edge/vertex incidence graphs.
 *
 * The caller owns failure representation so protocol users can preserve their
 * public diagnostic boundary without duplicating snapshot validation.
 */
export function assertValidKernelTopologySnapshot(
  snapshot: unknown,
  fail: KernelTopologySnapshotValidationFailure,
): asserts snapshot is KernelTopologySnapshot {
  const recordValue = (
    value: unknown,
  ): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  if (!recordValue(snapshot)) {
    fail("Geometry kernel returned an invalid topology snapshot", {});
  }
  if (snapshot.history !== "complete" && snapshot.history !== "partial") {
    fail("Geometry kernel returned an invalid topology history status", {
      history: snapshot.history,
    });
  }
  if (
    !Array.isArray(snapshot.faces) ||
    !Array.isArray(snapshot.edges) ||
    !Array.isArray(snapshot.vertices)
  ) {
    fail("Geometry kernel returned invalid topology collections", {});
  }

  const vector = (value: unknown): value is Vec3 => {
    if (!Array.isArray(value) || value.length !== 3) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (
        !Object.hasOwn(value, index) ||
        typeof value[index] !== "number" ||
        !Number.isFinite(value[index])
      ) {
        return false;
      }
    }
    return true;
  };
  const topologyKeys = (
    value: unknown,
    topology: TopologyKind,
    adjacency: "faces" | "edges" | "vertices",
  ): value is readonly KernelTopologyKey[] => {
    if (!Array.isArray(value)) {
      fail("Geometry kernel returned invalid topology adjacency", {
        topology,
        adjacency,
      });
    }
    for (let index = 0; index < value.length; index += 1) {
      if (
        !Object.hasOwn(value, index) ||
        typeof value[index] !== "string" ||
        value[index].length === 0
      ) {
        fail("Geometry kernel returned invalid topology adjacency", {
          topology,
          adjacency,
        });
      }
    }
    if (new Set(value).size !== value.length) {
      fail("Geometry kernel returned invalid topology adjacency", {
        topology,
        adjacency,
      });
    }
    return true;
  };
  const lineage = (value: unknown, topology: TopologyKind): void => {
    if (!Array.isArray(value)) {
      fail("Geometry kernel returned invalid topology lineage", { topology });
    }
    for (const rawLineage of value) {
      if (!recordValue(rawLineage)) {
        fail("Geometry kernel returned invalid topology lineage", { topology });
      }
      if (
        typeof rawLineage.feature !== "string" ||
        rawLineage.feature.length === 0 ||
        (rawLineage.relation !== "created" &&
          rawLineage.relation !== "modified")
      ) {
        fail("Geometry kernel returned invalid topology lineage", { topology });
      }
      if (rawLineage.role !== undefined) {
        if (typeof rawLineage.role !== "string") {
          fail("Geometry kernel returned invalid semantic topology lineage", {
            topology,
          });
        }
        const rule = TOPOLOGY_ROLE_RULES[rawLineage.role as TopologyRole] as
          | (typeof TOPOLOGY_ROLE_RULES)[TopologyRole]
          | undefined;
        if (
          rule === undefined ||
          rule.topology !== topology ||
          rule.relation !== rawLineage.relation ||
          (rawLineage.source !== undefined && rule.source !== "sketch-curve")
        ) {
          fail("Geometry kernel returned invalid semantic topology lineage", {
            topology,
            role: rawLineage.role,
          });
        }
      }
      if (rawLineage.source !== undefined) {
        if (
          !recordValue(rawLineage.source) ||
          rawLineage.relation !== "created" ||
          rawLineage.source.kind !== "sketch-entity" ||
          typeof rawLineage.source.sketch !== "string" ||
          rawLineage.source.sketch.length === 0 ||
          typeof rawLineage.source.entity !== "string" ||
          rawLineage.source.entity.length === 0
        ) {
          fail("Geometry kernel returned invalid topology source lineage", {
            topology,
          });
        }
      }
    }
  };
  const geometry = (value: unknown, topology: TopologyKind): void => {
    if (
      !recordValue(value) ||
      typeof value.kind !== "string" ||
      value.kind.length === 0
    ) {
      fail("Geometry kernel returned invalid topology geometry", { topology });
    }
    for (const direction of [value.normal, value.direction, value.axis]) {
      if (
        direction !== undefined &&
        (!vector(direction) ||
          !direction.some((component) => component !== 0))
      ) {
        fail("Geometry kernel returned an invalid topology direction", {
          topology,
        });
      }
    }
    if (
      value.radius !== undefined &&
      (typeof value.radius !== "number" ||
        !Number.isFinite(value.radius) ||
        value.radius < 0)
    ) {
      fail("Geometry kernel returned an invalid topology radius", { topology });
    }
  };

  const keys = new Set<KernelTopologyKey>();
  const validateDescriptor = (
    rawDescriptor: unknown,
    topology: TopologyKind,
  ): void => {
    if (
      !recordValue(rawDescriptor) ||
      rawDescriptor.topology !== topology ||
      typeof rawDescriptor.key !== "string" ||
      rawDescriptor.key.length === 0
    ) {
      fail("Geometry kernel returned an invalid topology descriptor", {
        topology,
      });
    }
    const key = rawDescriptor.key as KernelTopologyKey;
    if (keys.has(key)) {
      fail("Geometry kernel returned a duplicate topology key", { topology });
    }
    keys.add(key);
    lineage(rawDescriptor.lineage, topology);
    if (topology === "vertex") {
      if (!vector(rawDescriptor.point)) {
        fail("Geometry kernel returned an invalid topology point", { topology });
      }
      topologyKeys(rawDescriptor.edges, topology, "edges");
      return;
    }
    if (
      !vector(rawDescriptor.center) ||
      !recordValue(rawDescriptor.bounds) ||
      !vector(rawDescriptor.bounds.min) ||
      !vector(rawDescriptor.bounds.max)
    ) {
      fail("Geometry kernel returned an invalid topology descriptor", {
        topology,
      });
    }
    const bounds = rawDescriptor.bounds as {
      readonly min: Vec3;
      readonly max: Vec3;
    };
    if (bounds.min.some((minimum, index) => minimum > bounds.max[index]!)) {
      fail("Geometry kernel returned invalid topology bounds", { topology });
    }
    if (topology === "face") {
      if (
        typeof rawDescriptor.area !== "number" ||
        !Number.isFinite(rawDescriptor.area) ||
        rawDescriptor.area < 0
      ) {
        fail("Geometry kernel returned invalid topology measure", { topology });
      }
      geometry(rawDescriptor.surface, topology);
      topologyKeys(rawDescriptor.edges, topology, "edges");
    } else {
      if (
        typeof rawDescriptor.length !== "number" ||
        !Number.isFinite(rawDescriptor.length) ||
        rawDescriptor.length < 0
      ) {
        fail("Geometry kernel returned invalid topology measure", { topology });
      }
      geometry(rawDescriptor.curve, topology);
      topologyKeys(rawDescriptor.faces, topology, "faces");
      topologyKeys(rawDescriptor.vertices, topology, "vertices");
    }
  };

  for (let index = 0; index < snapshot.faces.length; index += 1) {
    if (!Object.hasOwn(snapshot.faces, index)) {
      fail("Geometry kernel returned sparse topology collections", {
        topology: "face",
        index,
      });
    }
    validateDescriptor(snapshot.faces[index], "face");
  }
  for (let index = 0; index < snapshot.edges.length; index += 1) {
    if (!Object.hasOwn(snapshot.edges, index)) {
      fail("Geometry kernel returned sparse topology collections", {
        topology: "edge",
        index,
      });
    }
    validateDescriptor(snapshot.edges[index], "edge");
  }
  for (let index = 0; index < snapshot.vertices.length; index += 1) {
    if (!Object.hasOwn(snapshot.vertices, index)) {
      fail("Geometry kernel returned sparse topology collections", {
        topology: "vertex",
        index,
      });
    }
    validateDescriptor(snapshot.vertices[index], "vertex");
  }
  const faces = snapshot.faces as unknown as readonly KernelFaceDescriptor[];
  const edges = snapshot.edges as unknown as readonly KernelEdgeDescriptor[];
  const vertices =
    snapshot.vertices as unknown as readonly KernelVertexDescriptor[];
  const faceKeys = new Set(faces.map((face) => face.key));
  const edgeKeys = new Set(edges.map((edge) => edge.key));
  const vertexKeys = new Set(vertices.map((vertex) => vertex.key));
  const faceByKey = new Map(faces.map((face) => [face.key, face]));
  const edgeByKey = new Map(edges.map((edge) => [edge.key, edge]));
  const vertexByKey = new Map(
    vertices.map((vertex) => [vertex.key, vertex]),
  );
  const faceEdges = new Map(
    faces.map((face) => [face.key, new Set(face.edges)]),
  );
  const edgeFaces = new Map(
    edges.map((edge) => [edge.key, new Set(edge.faces)]),
  );
  const edgeVertices = new Map(
    edges.map((edge) => [edge.key, new Set(edge.vertices)]),
  );
  const vertexEdges = new Map(
    vertices.map((vertex) => [vertex.key, new Set(vertex.edges)]),
  );
  for (const face of faces) {
    for (const edgeKey of face.edges) {
      const edge = edgeByKey.get(edgeKey);
      if (edge === undefined || !edgeFaces.get(edgeKey)!.has(face.key)) {
        fail("Geometry kernel returned invalid face-to-edge adjacency", {
          topology: "face",
          dangling: !edgeKeys.has(edgeKey),
          reciprocal: edge !== undefined,
        });
      }
    }
  }
  for (const edge of edges) {
    for (const faceKey of edge.faces) {
      const face = faceByKey.get(faceKey);
      if (face === undefined || !faceEdges.get(faceKey)!.has(edge.key)) {
        fail("Geometry kernel returned invalid edge-to-face adjacency", {
          topology: "edge",
          dangling: !faceKeys.has(faceKey),
          reciprocal: face !== undefined,
        });
      }
    }
    for (const vertexKey of edge.vertices) {
      const vertex = vertexByKey.get(vertexKey);
      if (vertex === undefined || !vertexEdges.get(vertexKey)!.has(edge.key)) {
        fail("Geometry kernel returned invalid edge-to-vertex adjacency", {
          topology: "edge",
          dangling: !vertexKeys.has(vertexKey),
          reciprocal: vertex !== undefined,
        });
      }
    }
  }
  for (const vertex of vertices) {
    for (const edgeKey of vertex.edges) {
      const edge = edgeByKey.get(edgeKey);
      if (edge === undefined || !edgeVertices.get(edgeKey)!.has(vertex.key)) {
        fail("Geometry kernel returned invalid vertex-to-edge adjacency", {
          topology: "vertex",
          dangling: !edgeKeys.has(edgeKey),
          reciprocal: edge !== undefined,
        });
      }
    }
  }
}

/** Validates a topology snapshot without requiring a resolver-specific context. */
export function validateKernelTopologySnapshot(
  snapshot: unknown,
): CadResult<KernelTopologySnapshot> {
  try {
    assertValidKernelTopologySnapshot(snapshot, (message, details): never => {
      throw new KernelTopologySnapshotValidationError(message, details);
    });
    return success(snapshot);
  } catch (error) {
    const details =
      isSnapshotValidationError(error)
        ? error.details
        : {};
    return failure(
      diagnostic(
        "KERNEL_ERROR",
        safeErrorMessage(error, "Geometry kernel topology validation failed"),
        {
          severity: "error",
          details: { ...details, protocolViolation: true },
        },
      ),
    );
  }
}

/**
 * Reads an untrusted kernel snapshot into one detached immutable graph, then
 * validates and returns only that graph. Stateful accessors therefore cannot
 * change values between protocol validation and public use.
 */
export function normalizeKernelTopologySnapshot(
  snapshot: unknown,
  limits?: KernelTopologySnapshotCopyLimits,
): CadResult<KernelTopologySnapshot> {
  try {
    const detached = detachKernelTopologySnapshot(
      snapshot as KernelTopologySnapshot,
      limits,
    );
    return success(detached);
  } catch (error) {
    if (isKernelTopologySnapshotCopyLimitError(error)) throw error;
    const details =
      isSnapshotValidationError(error)
        ? error.details
        : {};
    return failure(
      diagnostic(
        "KERNEL_ERROR",
        safeErrorMessage(error, "Geometry kernel topology access failed"),
        {
          severity: "error",
          details: { ...details, protocolViolation: true },
        },
      ),
    );
  }
}
