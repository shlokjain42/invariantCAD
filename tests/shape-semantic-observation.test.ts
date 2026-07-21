import { describe, expect, it } from "vitest";
import {
  KERNEL_SHAPE_ARTIFACT_SEMANTIC_WITNESS_PREFIX,
  hashKernelShapeSemanticObservation,
} from "../src/conformance.js";
import type { CadResult, DiagnosticCode } from "../src/core/result.js";
import { success } from "../src/core/result.js";
import type {
  GeometryKernel,
  KernelCapabilities,
  KernelFeature,
  KernelShape,
  MeshData,
  ShapeMeasurements,
} from "../src/kernel.js";
import type {
  KernelEdgeDescriptor,
  KernelFaceDescriptor,
  KernelTopologyLineage,
  KernelTopologyKey,
  KernelTopologySnapshot,
  KernelVertexDescriptor,
} from "../src/protocol/topology.js";
import {
  KERNEL_SHAPE_SEMANTIC_OBSERVATION_PROTOCOL_VERSION,
  encodeKernelShapeSemanticObservation,
  observeKernelShapeSemantics,
  type KernelShapeSemanticObservation,
  type KernelShapeSemanticObservationPlan,
} from "../src/shape-semantic-observation.js";

const KERNEL_ID = "invariantcad.test.semantic-observation";

interface SyntheticShape extends KernelShape {
  readonly runtime: SyntheticRuntime;
  readonly token: number;
  measurementDelta: number;
  live: boolean;
}

interface SyntheticRuntimeOptions {
  readonly mesh?: (shape: SyntheticShape) => unknown;
  readonly measurements?: (shape: SyntheticShape) => unknown;
  readonly status?: (shape: SyntheticShape) => unknown;
  readonly topology?: (shape: SyntheticShape) => unknown;
  readonly features?: readonly KernelFeature[];
  readonly nativeRoundTrip?: boolean;
}

const BASE_POSITIONS = new Float32Array([
  0, 0, 0,
  1, 0, 0,
  1, 1, 0,
  0, 1, 0,
]);
const BASE_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

function baseMesh(): MeshData {
  return {
    positions: BASE_POSITIONS.slice(),
    indices: BASE_INDICES.slice(),
  };
}

function measurements(volume = 1): ShapeMeasurements {
  return {
    volume,
    surfaceArea: 2,
    centerOfMass: [0.5, 0.5, 0.5],
    inertiaTensor: [
      [1, 0, 0],
      [0, 2, 0],
      [0, 0, 3],
    ],
    boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
    genus: 0,
    tolerance: 1e-7,
  };
}

class SyntheticRuntime {
  readonly kernel: GeometryKernel;
  readonly shapes: SyntheticShape[] = [];
  readonly disposedShapes: SyntheticShape[] = [];
  calls = 0;
  private readonly options: SyntheticRuntimeOptions;

  constructor(options: SyntheticRuntimeOptions = {}) {
    this.options = options;
    const features = [...(options.features ?? [])];
    const capabilities: KernelCapabilities = {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features,
      nativeImports: options.nativeRoundTrip ? ["brep-binary"] : [],
      nativeExports: options.nativeRoundTrip ? ["brep-binary"] : [],
      ...(options.topology === undefined
        ? {}
        : {
            topology: {
              kinds: ["face", "edge", "vertex"],
              provenance: "history" as const,
              semanticRoles: true,
              sketchSources: true,
              geometry: true,
              adjacency: true,
            },
          }),
    };
    const runtime = this;
    this.kernel = {
      id: KERNEL_ID,
      capabilities,
      mesh(shape) {
        runtime.calls += 1;
        const owned = runtime.assertShape(shape);
        return (runtime.options.mesh?.(owned) ?? baseMesh()) as MeshData;
      },
      measure(shape) {
        runtime.calls += 1;
        const owned = runtime.assertShape(shape);
        return (runtime.options.measurements?.(owned) ??
          measurements(1 + owned.measurementDelta)) as ShapeMeasurements;
      },
      status(shape) {
        runtime.calls += 1;
        try {
          const owned = runtime.assertShape(shape);
          return (runtime.options.status?.(owned) ?? {
            ok: true,
            code: "VALID",
          }) as ReturnType<GeometryKernel["status"]>;
        } catch (error) {
          return { ok: false, code: "DISPOSED", message: String(error) };
        }
      },
      disposeShape(shape) {
        runtime.calls += 1;
        const owned = runtime.assertShape(shape);
        owned.live = false;
        runtime.disposedShapes.push(owned);
      },
      dispose() {},
      ...(options.topology === undefined
        ? {}
        : {
            topology(shape: KernelShape) {
              runtime.calls += 1;
              return runtime.options.topology!(runtime.assertShape(shape)) as KernelTopologySnapshot;
            },
          }),
      ...(options.nativeRoundTrip
        ? {
            exportShape(shape: KernelShape) {
              runtime.calls += 1;
              const owned = runtime.assertShape(shape);
              return new Uint8Array([0x49, 0x43, owned.token]);
            },
            importShape(data: string | ArrayBuffer | Uint8Array) {
              runtime.calls += 1;
              const bytes =
                typeof data === "string"
                  ? new TextEncoder().encode(data)
                  : data instanceof Uint8Array
                    ? data
                    : new Uint8Array(data);
              if (bytes.length !== 3 || bytes[0] !== 0x49 || bytes[1] !== 0x43) {
                throw new TypeError("Malformed synthetic native shape");
              }
              return runtime.shape(bytes[2]!);
            },
          }
        : {}),
    };
  }

  shape(token = 1): SyntheticShape {
    const shape: SyntheticShape = {
      kernel: KERNEL_ID,
      runtime: this,
      token,
      measurementDelta: 0,
      live: true,
    };
    this.shapes.push(shape);
    return shape;
  }

  assertShape(shape: KernelShape): SyntheticShape {
    const owned = shape as SyntheticShape;
    if (owned.runtime !== this || !owned.live) {
      throw new TypeError("Expected a live synthetic shape");
    }
    return owned;
  }
}

function plan(
  overrides: Partial<KernelShapeSemanticObservationPlan> = {},
): KernelShapeSemanticObservationPlan {
  return {
    id: "semantic-observation-test-v1",
    meshes: [{ id: "default" }],
    topology: "omit",
    ...overrides,
  };
}

async function observed(
  runtime: SyntheticRuntime,
  shape: SyntheticShape,
  observationPlan: KernelShapeSemanticObservationPlan = plan(),
): Promise<KernelShapeSemanticObservation> {
  const result = await observeKernelShapeSemantics(
    runtime.kernel,
    shape,
    observationPlan,
  );
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected a semantic observation");
  return result.value;
}

function expectFailure(result: CadResult<unknown>, code: DiagnosticCode): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failure");
  expect(result.diagnostics[0]?.code).toBe(code);
}

function encoded(observation: KernelShapeSemanticObservation): Uint8Array {
  const result = encodeKernelShapeSemanticObservation(observation);
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected encoded observation");
  return result.value;
}

function expectDeeplyFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(child, seen);
  }
}

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

const LINEAGE: readonly KernelTopologyLineage[] = Object.freeze([
  Object.freeze({ feature: "source", relation: "created" as const }),
]);

function face(
  id: string,
  area: number,
  edges: readonly string[],
  lineage: readonly KernelTopologyLineage[] = LINEAGE,
): KernelFaceDescriptor {
  return {
    topology: "face",
    key: key(id),
    center: [area, 0, 0],
    bounds: { min: [area, 0, 0], max: [area, 1, 1] },
    lineage,
    area,
    surface: { kind: "plane", normal: [0, 0, 1] },
    edges: edges.map(key),
  };
}

function edge(
  id: string,
  length: number,
  faces: readonly string[],
  vertices: readonly string[] = [],
  lineage: readonly KernelTopologyLineage[] = LINEAGE,
): KernelEdgeDescriptor {
  return {
    topology: "edge",
    key: key(id),
    center: [length, 0, 0],
    bounds: { min: [length, 0, 0], max: [length, 1, 0] },
    lineage,
    length,
    curve: { kind: "line", direction: [1, 0, 0] },
    faces: faces.map(key),
    vertices: vertices.map(key),
  };
}

function vertex(
  id: string,
  point: readonly [number, number, number],
  edges: readonly string[],
  lineage: readonly KernelTopologyLineage[] = LINEAGE,
): KernelVertexDescriptor {
  return {
    topology: "vertex",
    key: key(id),
    point,
    lineage,
    edges: edges.map(key),
  };
}

function asymmetricTopology(
  prefix = "a",
  reverse = false,
  history: "complete" | "partial" = "complete",
  lineage: readonly KernelTopologyLineage[] = LINEAGE,
): KernelTopologySnapshot {
  const f1 = `${prefix}-f1`;
  const f2 = `${prefix}-f2`;
  const e1 = `${prefix}-e1`;
  const e2 = `${prefix}-e2`;
  const v1 = `${prefix}-v1`;
  const v2 = `${prefix}-v2`;
  const v3 = `${prefix}-v3`;
  const faces = [face(f1, 10, [e1], lineage), face(f2, 20, [e2], lineage)];
  const edges = [
    edge(e1, 1, [f1], [v1, v2], lineage),
    edge(e2, 2, [f2], [v2, v3], lineage),
  ];
  const vertices = [
    vertex(v1, [0, 0, 0], [e1], lineage),
    vertex(v2, [1, 0, 0], [e1, e2], lineage),
    vertex(v3, [2, 0, 0], [e2], lineage),
  ];
  return {
    history,
    faces: reverse ? faces.reverse() : faces,
    edges: reverse ? edges.reverse() : edges,
    vertices: reverse ? vertices.reverse() : vertices,
  };
}

function symmetricTopology(
  variant: "cycle" | "split",
  prefix = "s",
  reverse = false,
): KernelTopologySnapshot {
  const faces = Array.from({ length: 4 }, (_, index) => `${prefix}-f${index}`);
  const edges = Array.from({ length: 4 }, (_, index) => `${prefix}-e${index}`);
  const faceEdges =
    variant === "cycle"
      ? [
          [edges[0]!, edges[3]!],
          [edges[0]!, edges[1]!],
          [edges[1]!, edges[2]!],
          [edges[2]!, edges[3]!],
        ]
      : [
          [edges[0]!, edges[1]!],
          [edges[0]!, edges[1]!],
          [edges[2]!, edges[3]!],
          [edges[2]!, edges[3]!],
        ];
  const edgeFaces = edges.map((edgeId) =>
    faces.filter((_, faceIndex) => faceEdges[faceIndex]!.includes(edgeId)),
  );
  const faceItems = faces.map((id, index) => face(id, 1, faceEdges[index]!));
  const edgeItems = edges.map((id, index) => edge(id, 1, edgeFaces[index]!));
  return {
    history: "complete",
    faces: reverse ? faceItems.reverse() : faceItems,
    edges: reverse ? edgeItems.reverse() : edgeItems,
    vertices: [],
  };
}

describe("canonical kernel-shape semantic observation", () => {
  it("encodes every numeric bit, while normalizing negative zero", async () => {
    const baseline = new SyntheticRuntime();
    const drifted = new SyntheticRuntime({
      measurements: () => measurements(1 + Number.EPSILON),
    });
    const negativeZero = new SyntheticRuntime({
      measurements: () => ({
        ...measurements(),
        boundingBox: { min: [-0, -0, -0], max: [1, 1, 1] },
      }),
    });
    const positiveZero = new SyntheticRuntime();

    const baseObservation = await observed(baseline, baseline.shape());
    const driftedObservation = await observed(drifted, drifted.shape());
    expect(baseObservation.measurements.volume).toBe("f64:3ff0000000000000");
    expect(driftedObservation.measurements.volume).toBe("f64:3ff0000000000001");
    expect(encoded(driftedObservation)).not.toEqual(encoded(baseObservation));

    expect(encoded(await observed(negativeZero, negativeZero.shape()))).toEqual(
      encoded(await observed(positiveZero, positiveZero.shape())),
    );
  });

  it("normalizes vertex, triangle, and cyclic order but preserves winding and multiplicity", async () => {
    const baseline = new SyntheticRuntime();
    const reordered = new SyntheticRuntime({
      mesh: () => ({
        positions: new Float32Array([
          1, 1, 0,
          0, 0, 0,
          0, 1, 0,
          1, 0, 0,
        ]),
        // Original second triangle first, then original first; both cyclically rotated.
        indices: new Uint32Array([0, 2, 1, 3, 0, 1]),
      }),
    });
    const reversed = new SyntheticRuntime({
      mesh: () => ({
        positions: BASE_POSITIONS.slice(),
        indices: new Uint32Array([0, 2, 1, 0, 2, 3]),
      }),
    });
    const duplicate = new SyntheticRuntime({
      mesh: () => ({
        positions: BASE_POSITIONS.slice(),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3, 1, 2, 0]),
      }),
    });

    const baseObservation = await observed(baseline, baseline.shape());
    const reorderedObservation = await observed(reordered, reordered.shape());
    const reversedObservation = await observed(reversed, reversed.shape());
    const duplicateObservation = await observed(duplicate, duplicate.shape());

    expect(reorderedObservation.meshes).toEqual(baseObservation.meshes);
    expect(reversedObservation.meshes).not.toEqual(baseObservation.meshes);
    expect(duplicateObservation.meshes[0]?.triangles).toHaveLength(3);
    expect(duplicateObservation.meshes).not.toEqual(baseObservation.meshes);
  });

  it("removes raw topology keys and enumeration order without losing semantic graph data", async () => {
    const first = new SyntheticRuntime({ topology: () => asymmetricTopology("first") });
    const second = new SyntheticRuntime({
      topology: () => asymmetricTopology("totally-different", true),
    });
    const topologyPlan = plan({ topology: "required" });

    const firstObservation = await observed(first, first.shape(), topologyPlan);
    const secondObservation = await observed(second, second.shape(), topologyPlan);
    expect(secondObservation.topology).toEqual(firstObservation.topology);
    expect(JSON.stringify(firstObservation.topology)).not.toContain("first-");
  });

  it("canonically labels symmetric incidence graphs and detects changed incidence", async () => {
    const cycle = new SyntheticRuntime({
      topology: () => symmetricTopology("cycle", "cycle-a"),
    });
    const renamedCycle = new SyntheticRuntime({
      topology: () => symmetricTopology("cycle", "cycle-b", true),
    });
    const split = new SyntheticRuntime({
      topology: () => symmetricTopology("split", "split"),
    });
    const topologyPlan = plan({ topology: "required" });

    const cycleObservation = await observed(cycle, cycle.shape(), topologyPlan);
    const renamedObservation = await observed(
      renamedCycle,
      renamedCycle.shape(),
      topologyPlan,
    );
    const splitObservation = await observed(split, split.shape(), topologyPlan);
    expect(renamedObservation.topology).toEqual(cycleObservation.topology);
    expect(splitObservation.topology).not.toEqual(cycleObservation.topology);

    const manyColors = (prefix: string, reverse: boolean): KernelTopologySnapshot => {
      const vertices = Array.from({ length: 12 }, (_, index) =>
        vertex(`${prefix}-${index}`, [index, index + 1, index + 2], []),
      );
      return {
        history: "complete",
        faces: [],
        edges: [],
        vertices: reverse ? vertices.reverse() : vertices,
      };
    };
    const orderedColors = new SyntheticRuntime({
      topology: () => manyColors("ordered", false),
    });
    const reversedColors = new SyntheticRuntime({
      topology: () => manyColors("reversed", true),
    });
    expect(
      (await observed(reversedColors, reversedColors.shape(), topologyPlan))
        .topology,
    ).toEqual(
      (await observed(orderedColors, orderedColors.shape(), topologyPlan))
        .topology,
    );
  });

  it("detects history and canonical lineage drift", async () => {
    const baseline = new SyntheticRuntime({ topology: () => asymmetricTopology() });
    const partial = new SyntheticRuntime({
      topology: () => asymmetricTopology("p", false, "partial"),
    });
    const changedLineage = Object.freeze([
      Object.freeze({ feature: "other-source", relation: "created" as const }),
    ]);
    const lineage = new SyntheticRuntime({
      topology: () => asymmetricTopology("l", false, "complete", changedLineage),
    });
    const topologyPlan = plan({ topology: "required" });
    const expected = await observed(baseline, baseline.shape(), topologyPlan);

    expect((await observed(partial, partial.shape(), topologyPlan)).topology).not.toEqual(
      expected.topology,
    );
    expect((await observed(lineage, lineage.shape(), topologyPlan)).topology).not.toEqual(
      expected.topology,
    );
  });

  it("requires advertised-feature coverage and owns probe outputs without owning the source", async () => {
    const uncovered = new SyntheticRuntime({ features: ["transform"] });
    const uncoveredResult = await observeKernelShapeSemantics(
      uncovered.kernel,
      uncovered.shape(),
      plan(),
    );
    expectFailure(uncoveredResult, "KERNEL_CAPABILITY_MISSING");

    const runtime = new SyntheticRuntime({ features: ["transform"] });
    const source = runtime.shape(10);
    let derived: SyntheticShape | undefined;
    const observation = await observed(
      runtime,
      source,
      plan({
        probes: [
          {
            id: "translate-source",
            feature: "transform",
            run: () => {
              derived = runtime.shape(11);
              return success([derived]);
            },
          },
        ],
      }),
    );
    expect(observation.coverage.probedFeatures).toEqual(["transform"]);
    expect(observation.probes[0]?.shapes).toHaveLength(1);
    expect(derived?.live).toBe(false);
    expect(source.live).toBe(true);
    expect(runtime.disposedShapes).toEqual([derived]);

    const aliases = new SyntheticRuntime({ features: ["transform"] });
    const aliasedSource = aliases.shape();
    const beforeAlias = aliases.shape(2);
    const afterAlias = aliases.shape(3);
    const aliasResult = await observeKernelShapeSemantics(
      aliases.kernel,
      aliasedSource,
      plan({
        probes: [
          {
            id: "bad-alias",
            feature: "transform",
            run: () => success([beforeAlias, aliasedSource, afterAlias]),
          },
        ],
      }),
    );
    expectFailure(aliasResult, "KERNEL_ERROR");
    expect(aliases.disposedShapes).toEqual([afterAlias, beforeAlias]);
    expect(aliasedSource.live).toBe(true);

    const cancelling = new SyntheticRuntime({ features: ["transform"] });
    const cancellingSource = cancelling.shape();
    const cancelledFirst = cancelling.shape(2);
    const cancelledSecond = cancelling.shape(3);
    const controller = new AbortController();
    const cancelled = await observeKernelShapeSemantics(
      cancelling.kernel,
      cancellingSource,
      plan({
        probes: [
          {
            id: "abort-with-owned-results",
            feature: "transform",
            run: () => {
              controller.abort();
              return success([cancelledFirst, cancelledSecond]);
            },
          },
        ],
      }),
      { signal: controller.signal },
    );
    expectFailure(cancelled, "EVALUATION_ABORTED");
    expect(cancelling.disposedShapes).toEqual([
      cancelledSecond,
      cancelledFirst,
    ]);
    expect(cancellingSource.live).toBe(true);

    const proxied = new SyntheticRuntime({ features: ["transform"] });
    const proxiedSource = proxied.shape();
    const proxiedFirst = proxied.shape(2);
    const proxiedSecond = proxied.shape(3);
    let lengthReads = 0;
    const proxiedResult = await observeKernelShapeSemantics(
      proxied.kernel,
      proxiedSource,
      plan({
        probes: [
          {
            id: "stateful-result-array",
            feature: "transform",
            run: () => success(new Proxy(
              [proxiedFirst, proxiedSecond],
              {
                get(target, property, receiver) {
                  if (property === "length") {
                    lengthReads += 1;
                    return lengthReads === 1 ? 2 : 1;
                  }
                  return Reflect.get(target, property, receiver);
                },
              },
            )),
          },
        ],
      }),
    );
    expect(proxiedResult.ok).toBe(true);
    expect(lengthReads).toBe(1);
    expect(proxied.disposedShapes).toEqual([proxiedSecond, proxiedFirst]);
    expect(proxiedSource.live).toBe(true);
  });

  it("assimilates a stateful probe thenable from one captured then getter", async () => {
    const runtime = new SyntheticRuntime({ features: ["transform"] });
    const source = runtime.shape();
    const first = runtime.shape(2);
    const second = runtime.shape(3);
    const controller = new AbortController();
    Object.defineProperties(controller.signal, {
      addEventListener: {
        get() {
          throw new Error("Observer must use the captured EventTarget method");
        },
      },
      removeEventListener: {
        get() {
          throw new Error("Listener cleanup must not strand the probe");
        },
      },
    });
    let thenReads = 0;
    const statefulThenable = Object.defineProperty({}, "then", {
      get() {
        thenReads += 1;
        const selected = thenReads === 1 ? first : second;
        return (
          resolve: (value: CadResult<readonly KernelShape[]>) => void,
        ): void => resolve(success([selected]));
      },
    }) as PromiseLike<CadResult<readonly KernelShape[]>>;
    const result = await observeKernelShapeSemantics(
      runtime.kernel,
      source,
      plan({
        probes: [
          {
            id: "stateful-thenable",
            feature: "transform",
            run: () => statefulThenable,
          },
        ],
      }),
      { signal: controller.signal },
    );
    expect(result.ok).toBe(true);
    expect(thenReads).toBe(1);
    expect(runtime.disposedShapes).toEqual([first]);
    expect(second.live).toBe(true);
    runtime.kernel.disposeShape(second);
  });

  it("races asynchronous probes against cancellation without claiming late results", async () => {
    const runtime = new SyntheticRuntime({ features: ["transform"] });
    const source = runtime.shape();
    const controller = new AbortController();
    let allowance: number | undefined;
    const resultPromise = observeKernelShapeSemantics(
      runtime.kernel,
      source,
      plan({
        probes: [
          {
            id: "never-settling-probe",
            feature: "transform",
            run: (_kernel, _source, context) => {
              allowance = context.maxDerivedShapes;
              return new Promise<CadResult<readonly KernelShape[]>>(() => {});
            },
          },
        ],
      }),
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 10);
    const result = await resultPromise;
    expectFailure(result, "EVALUATION_ABORTED");
    expect(allowance).toBe(256);
    expect(source.live).toBe(true);
  });

  it("transfers only results that win the documented Promise cancellation race", async () => {
    const resolvedRuntime = new SyntheticRuntime({ features: ["transform"] });
    const resolvedSource = resolvedRuntime.shape();
    const resolvedShape = resolvedRuntime.shape(2);
    const resolvedController = new AbortController();
    const resolvedResult = await observeKernelShapeSemantics(
      resolvedRuntime.kernel,
      resolvedSource,
      plan({
        probes: [
          {
            id: "resolve-before-abort",
            feature: "transform",
            run: () => new Promise((resolve) => {
              resolve(success([resolvedShape]));
              resolvedController.abort();
            }),
          },
        ],
      }),
      { signal: resolvedController.signal },
    );
    expectFailure(resolvedResult, "EVALUATION_ABORTED");
    expect(resolvedRuntime.disposedShapes).toEqual([resolvedShape]);
    expect(resolvedSource.live).toBe(true);

    const lateRuntime = new SyntheticRuntime({ features: ["transform"] });
    const lateSource = lateRuntime.shape();
    const lateShape = lateRuntime.shape(2);
    const lateController = new AbortController();
    const lateThenable = {
      then(
        resolve: (value: CadResult<readonly KernelShape[]>) => void,
      ): void {
        lateController.signal.addEventListener(
          "abort",
          () => resolve(success([lateShape])),
          { once: true },
        );
        queueMicrotask(() => lateController.abort());
      },
    } as PromiseLike<CadResult<readonly KernelShape[]>>;
    const lateResult = await observeKernelShapeSemantics(
      lateRuntime.kernel,
      lateSource,
      plan({
        probes: [
          {
            id: "custom-thenable-after-abort",
            feature: "transform",
            run: () => lateThenable,
          },
        ],
      }),
      { signal: lateController.signal },
    );
    expectFailure(lateResult, "EVALUATION_ABORTED");
    expect(lateRuntime.disposedShapes).toEqual([]);
    expect(lateShape.live).toBe(true);
    expect(lateSource.live).toBe(true);
    lateRuntime.kernel.disposeShape(lateShape);
  });

  it("normalizes downstream probe result enumeration as a semantic multiset", async () => {
    const observeProbeOrder = async (reverse: boolean) => {
      const runtime = new SyntheticRuntime({ features: ["transform"] });
      const source = runtime.shape();
      return observed(
        runtime,
        source,
        plan({
          probes: [
            {
              id: "two-results",
              feature: "transform",
              run: () => {
                const first = runtime.shape(2);
                const second = runtime.shape(3);
                second.measurementDelta = Number.EPSILON;
                return success(reverse ? [second, first] : [first, second]);
              },
            },
          ],
        }),
      );
    };
    expect((await observeProbeOrder(true)).probes).toEqual(
      (await observeProbeOrder(false)).probes,
    );
  });

  it("detects probe mutation of the source and still cleans derived shapes", async () => {
    const runtime = new SyntheticRuntime({ features: ["transform"] });
    const source = runtime.shape();
    let derived: SyntheticShape | undefined;
    const result = await observeKernelShapeSemantics(
      runtime.kernel,
      source,
      plan({
        probes: [
          {
            id: "mutating-probe",
            feature: "transform",
            run: () => {
              source.measurementDelta = Number.EPSILON;
              derived = runtime.shape(2);
              return success([derived]);
            },
          },
        ],
      }),
    );
    expectFailure(result, "KERNEL_ERROR");
    expect(result.ok ? "" : result.diagnostics[0]?.message).toContain(
      "changed the borrowed source",
    );
    expect(derived?.live).toBe(false);
    expect(source.live).toBe(true);
  });

  it("records native semantic round trips and disposes the imported owner", async () => {
    const runtime = new SyntheticRuntime({ nativeRoundTrip: true });
    const source = runtime.shape(23);
    const observation = await observed(
      runtime,
      source,
      plan({ nativeExchanges: ["brep-binary"] }),
    );
    expect(observation.coverage.nativeExchanges).toEqual(["brep-binary"]);
    expect(observation.nativeExchanges).toEqual([
      expect.objectContaining({ format: "brep-binary" }),
    ]);
    expect(observation.nativeExchanges[0]?.imported.measurements).toEqual(
      observation.measurements,
    );
    expect(runtime.disposedShapes).toHaveLength(1);
    expect(runtime.disposedShapes[0]?.token).toBe(23);
    expect(source.live).toBe(true);
  });

  it("enforces mesh, graph-search, operation, and final-byte limits", async () => {
    const meshRuntime = new SyntheticRuntime();
    const meshResult = await observeKernelShapeSemantics(
      meshRuntime.kernel,
      meshRuntime.shape(),
      plan(),
      { limits: { maxMeshTriangles: 1 } },
    );
    expectFailure(meshResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");

    const graphRuntime = new SyntheticRuntime({
      topology: () => symmetricTopology("cycle"),
    });
    const graphResult = await observeKernelShapeSemantics(
      graphRuntime.kernel,
      graphRuntime.shape(),
      plan({ topology: "required" }),
      { limits: { maxCanonicalLabelStates: 1 } },
    );
    expectFailure(graphResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");

    const graphWorkRuntime = new SyntheticRuntime({
      topology: () => asymmetricTopology(),
    });
    const graphWorkResult = await observeKernelShapeSemantics(
      graphWorkRuntime.kernel,
      graphWorkRuntime.shape(),
      plan({ topology: "required" }),
      { limits: { maxCanonicalWork: 1 } },
    );
    expectFailure(graphWorkResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");
    if (!graphWorkResult.ok) {
      expect(graphWorkResult.diagnostics[0]?.details).toMatchObject({
        resource: "maxCanonicalWork",
      });
    }

    const operationRuntime = new SyntheticRuntime();
    const operationResult = await observeKernelShapeSemantics(
      operationRuntime.kernel,
      operationRuntime.shape(),
      plan(),
      { limits: { maxOperations: 1 } },
    );
    expectFailure(operationResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");

    const byteRuntime = new SyntheticRuntime();
    const byteResult = await observeKernelShapeSemantics(
      byteRuntime.kernel,
      byteRuntime.shape(),
      plan(),
      { limits: { maxObservationBytes: 1 } },
    );
    expectFailure(byteResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");

    const stringRuntime = new SyntheticRuntime();
    const stringResult = await observeKernelShapeSemantics(
      stringRuntime.kernel,
      stringRuntime.shape(),
      plan(),
      { limits: { maxStringBytes: 1 } },
    );
    expectFailure(stringResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");
    if (!stringResult.ok) {
      expect(stringResult.diagnostics[0]?.details).toMatchObject({
        resource: "maxStringBytes",
      });
    }

    const topologyKeyRuntime = new SyntheticRuntime({
      topology: () => ({
        history: "complete",
        faces: [],
        edges: [],
        vertices: [vertex("k".repeat(1_000), [0, 0, 0], [])],
      }),
    });
    const topologyKeyResult = await observeKernelShapeSemantics(
      topologyKeyRuntime.kernel,
      topologyKeyRuntime.shape(),
      plan({ topology: "required" }),
      { limits: { maxStringBytes: 256 } },
    );
    expectFailure(topologyKeyResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");
    if (!topologyKeyResult.ok) {
      expect(topologyKeyResult.diagnostics[0]?.details).toMatchObject({
        resource: "maxStringBytes",
      });
    }

    const derivedRuntime = new SyntheticRuntime({ features: ["transform"] });
    const derivedSource = derivedRuntime.shape();
    const firstDerived = derivedRuntime.shape(2);
    const overLimitDerived = derivedRuntime.shape(3);
    const laterDerived = derivedRuntime.shape(4);
    const derivedResult = await observeKernelShapeSemantics(
      derivedRuntime.kernel,
      derivedSource,
      plan({
        probes: [
          {
            id: "too-many-derived-shapes",
            feature: "transform",
            run: () => success([firstDerived, overLimitDerived, laterDerived]),
          },
        ],
      }),
      { limits: { maxDerivedShapes: 1 } },
    );
    expectFailure(derivedResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");
    expect(derivedRuntime.disposedShapes).toEqual([
      laterDerived,
      overLimitDerived,
      firstDerived,
    ]);
    expect(derivedSource.live).toBe(true);
  });

  it("honors pre-abort before touching the kernel", async () => {
    const runtime = new SyntheticRuntime();
    const controller = new AbortController();
    controller.abort();
    const result = await observeKernelShapeSemantics(
      runtime.kernel,
      runtime.shape(),
      plan(),
      { signal: controller.signal },
    );
    expectFailure(result, "EVALUATION_ABORTED");
    expect(runtime.calls).toBe(0);

    const proxyRuntime = new SyntheticRuntime();
    const { proxy: proxySignal, revoke: revokeSignal } = Proxy.revocable(
      new AbortController().signal,
      {},
    );
    revokeSignal();
    const proxyResult = await observeKernelShapeSemantics(
      proxyRuntime.kernel,
      proxyRuntime.shape(),
      plan(),
      { signal: proxySignal },
    );
    expectFailure(proxyResult, "ARTIFACT_CACHE_ENTRY_INVALID");
    expect(proxyRuntime.calls).toBe(0);
  });

  it("contains hostile plans and malformed kernel data in structured failures", async () => {
    const malformedMesh = new SyntheticRuntime({
      mesh: () => ({
        positions: new Float64Array([0, 0, 0]),
        indices: new Uint32Array(),
      }),
    });
    const meshResult = await observeKernelShapeSemantics(
      malformedMesh.kernel,
      malformedMesh.shape(),
      plan(),
    );
    expectFailure(meshResult, "KERNEL_ERROR");

    const malformedNumber = new SyntheticRuntime({
      measurements: () => measurements(Number.NaN),
    });
    const numberResult = await observeKernelShapeSemantics(
      malformedNumber.kernel,
      malformedNumber.shape(),
      plan(),
    );
    expectFailure(numberResult, "KERNEL_ERROR");

    const runtime = new SyntheticRuntime();
    const sparseMeshes = new Array(1);
    const sparseResult = await observeKernelShapeSemantics(
      runtime.kernel,
      runtime.shape(),
      { id: "sparse", meshes: sparseMeshes } as KernelShapeSemanticObservationPlan,
    );
    expectFailure(sparseResult, "ARTIFACT_CACHE_ENTRY_INVALID");

    for (const field of [
      "topology",
      "nativeExchanges",
      "probes",
      "notApplicableFeatures",
    ] as const) {
      const nullFieldResult = await observeKernelShapeSemantics(
        runtime.kernel,
        runtime.shape(),
        { ...plan(), [field]: null } as unknown as KernelShapeSemanticObservationPlan,
      );
      expectFailure(nullFieldResult, "ARTIFACT_CACHE_ENTRY_INVALID");
    }

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const hostileResult = await observeKernelShapeSemantics(
      runtime.kernel,
      runtime.shape(),
      proxy as KernelShapeSemanticObservationPlan,
    );
    expectFailure(hostileResult, "ARTIFACT_CACHE_ENTRY_INVALID");

    let planLengthReads = 0;
    const statefulMeshes = new Proxy(
      [{ id: "default" }],
      {
        get(target, property, receiver) {
          if (property === "length") {
            planLengthReads += 1;
            return planLengthReads === 1 ? 2 : 1;
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    const statefulPlanResult = await observeKernelShapeSemantics(
      runtime.kernel,
      runtime.shape(),
      { id: "stateful", meshes: statefulMeshes },
      { limits: { maxMeshRequests: 1 } },
    );
    expectFailure(statefulPlanResult, "ARTIFACT_CACHE_ENTRY_INVALID");
    expect(planLengthReads).toBe(1);

    let positionsReads = 0;
    let indicesReads = 0;
    let bufferReads = 0;
    const accessorBackedPositions = BASE_POSITIONS.slice();
    const positionsBuffer = accessorBackedPositions.buffer;
    Object.defineProperty(accessorBackedPositions, "buffer", {
      get() {
        bufferReads += 1;
        return positionsBuffer;
      },
    });
    const statefulMesh = new SyntheticRuntime({
      mesh: () => Object.defineProperties({}, {
        positions: {
          enumerable: true,
          get() {
            positionsReads += 1;
            return positionsReads === 1
              ? accessorBackedPositions
              : new Float64Array();
          },
        },
        indices: {
          enumerable: true,
          get() {
            indicesReads += 1;
            return indicesReads === 1
              ? BASE_INDICES.slice()
              : new Float64Array();
          },
        },
      }),
    });
    expect(
      (await observeKernelShapeSemantics(
        statefulMesh.kernel,
        statefulMesh.shape(),
        plan(),
      )).ok,
    ).toBe(true);
    expect(positionsReads).toBe(1);
    expect(indicesReads).toBe(1);
    expect(bufferReads).toBe(0);

    let statusReads = 0;
    let volumeReads = 0;
    let boundingBoxReads = 0;
    const statefulMeasurements = new SyntheticRuntime({
      status: () => Object.defineProperties(
        { code: "VALID" },
        {
          ok: {
            enumerable: true,
            get() {
              statusReads += 1;
              return statusReads === 1 ? true : "invalid";
            },
          },
        },
      ),
      measurements: () => Object.defineProperties(
        { ...measurements() },
        {
          volume: {
            enumerable: true,
            get() {
              volumeReads += 1;
              return volumeReads === 1 ? 1 : -1;
            },
          },
          boundingBox: {
            enumerable: true,
            get() {
              boundingBoxReads += 1;
              return boundingBoxReads === 1
                ? { min: [0, 0, 0], max: [1, 1, 1] }
                : undefined;
            },
          },
        },
      ),
    });
    const statefulObservation = await observeKernelShapeSemantics(
      statefulMeasurements.kernel,
      statefulMeasurements.shape(),
      plan(),
    );
    expect(statefulObservation.ok).toBe(true);
    if (statefulObservation.ok) {
      expect(statefulObservation.value.status.ok).toBe(true);
      expect(statefulObservation.value.measurements.volume).toBe(
        "f64:3ff0000000000000",
      );
    }
    expect(statusReads).toBe(1);
    expect(volumeReads).toBe(1);
    expect(boundingBoxReads).toBe(1);

    const statefulKernel = new SyntheticRuntime();
    const capturedCapabilities = statefulKernel.kernel.capabilities;
    const capturedMesh = statefulKernel.kernel.mesh;
    const capturedMeasure = statefulKernel.kernel.measure;
    const capturedStatus = statefulKernel.kernel.status;
    const capturedDisposeShape = statefulKernel.kernel.disposeShape;
    const interfaceReads = {
      capabilities: 0,
      mesh: 0,
      measure: 0,
      status: 0,
      disposeShape: 0,
    };
    Object.defineProperties(statefulKernel.kernel, {
      capabilities: {
        configurable: true,
        get() {
          interfaceReads.capabilities += 1;
          return interfaceReads.capabilities === 1
            ? capturedCapabilities
            : undefined;
        },
      },
      mesh: {
        configurable: true,
        get() {
          interfaceReads.mesh += 1;
          return interfaceReads.mesh === 1 ? capturedMesh : undefined;
        },
      },
      measure: {
        configurable: true,
        get() {
          interfaceReads.measure += 1;
          return interfaceReads.measure === 1 ? capturedMeasure : undefined;
        },
      },
      status: {
        configurable: true,
        get() {
          interfaceReads.status += 1;
          return interfaceReads.status === 1 ? capturedStatus : undefined;
        },
      },
      disposeShape: {
        configurable: true,
        get() {
          interfaceReads.disposeShape += 1;
          return interfaceReads.disposeShape === 1
            ? capturedDisposeShape
            : undefined;
        },
      },
    });
    const statefulKernelResult = await observeKernelShapeSemantics(
      statefulKernel.kernel,
      statefulKernel.shape(),
      plan(),
    );
    expect(statefulKernelResult.ok).toBe(true);
    expect(interfaceReads).toEqual({
      capabilities: 1,
      mesh: 1,
      measure: 1,
      status: 1,
      disposeShape: 1,
    });

    const thrownProxyRuntime = new SyntheticRuntime();
    const thrownProxy = Proxy.revocable({}, {});
    thrownProxy.revoke();
    Object.defineProperty(thrownProxyRuntime.kernel, "status", {
      value: () => {
        throw thrownProxy.proxy;
      },
    });
    const thrownProxyResult = await observeKernelShapeSemantics(
      thrownProxyRuntime.kernel,
      thrownProxyRuntime.shape(),
      plan(),
    );
    expectFailure(thrownProxyResult, "ARTIFACT_CACHE_OPERATION_FAILED");

    const badDiagnostics = new SyntheticRuntime({ features: ["transform"] });
    const badDiagnosticsResult = await observeKernelShapeSemantics(
      badDiagnostics.kernel,
      badDiagnostics.shape(),
      plan({
        probes: [
          {
            id: "malformed-diagnostics",
            feature: "transform",
            run: () => ({ ok: false, diagnostics: [null] }) as unknown as CadResult<readonly KernelShape[]>,
          },
        ],
      }),
    );
    expectFailure(badDiagnosticsResult, "KERNEL_ERROR");
  });

  it("deep-freezes, canonically encodes, bounds, and hashes captured observations", async () => {
    const runtime = new SyntheticRuntime();
    const observation = await observed(runtime, runtime.shape());
    expect(observation).toMatchObject({
      kind: "kernel-shape-semantic-observation",
      protocolVersion: KERNEL_SHAPE_SEMANTIC_OBSERVATION_PROTOCOL_VERSION,
      numericEncoding: "ieee754-be-hex-normalized-zero",
      meshEncoding: "oriented-triangle-multiset-f32",
      topologyEncoding: "bounded-canonical-incidence-graph",
    });
    expectDeeplyFrozen(observation);

    const first = encoded(observation);
    const second = encoded(observation);
    expect(second).toEqual(first);
    expect(JSON.parse(new TextDecoder().decode(first))).toEqual(observation);

    const exactRuntime = new SyntheticRuntime({
      status: () => ({ ok: true, code: "VALID", message: "雪❄️" }),
    });
    const exactSource = exactRuntime.shape();
    const exactObservation = await observed(exactRuntime, exactSource);
    const exactBytes = encoded(exactObservation);
    const exactBoundary = await observeKernelShapeSemantics(
      exactRuntime.kernel,
      exactRuntime.shape(),
      plan(),
      { limits: { maxObservationBytes: exactBytes.byteLength } },
    );
    expect(exactBoundary.ok).toBe(true);
    const underBoundary = await observeKernelShapeSemantics(
      exactRuntime.kernel,
      exactRuntime.shape(),
      plan(),
      { limits: { maxObservationBytes: exactBytes.byteLength - 1 } },
    );
    expectFailure(underBoundary, "ARTIFACT_CACHE_LIMIT_EXCEEDED");

    const bounded = encodeKernelShapeSemanticObservation(observation, {
      maxBytes: first.byteLength - 1,
    });
    expectFailure(bounded, "ARTIFACT_CACHE_LIMIT_EXCEEDED");
    const nullMaximum = encodeKernelShapeSemanticObservation(
      observation,
      { maxBytes: null } as unknown as { readonly maxBytes?: number },
    );
    expectFailure(nullMaximum, "ARTIFACT_CACHE_ENTRY_INVALID");
    const forged = encodeKernelShapeSemanticObservation(
      { ...observation } as KernelShapeSemanticObservation,
    );
    expectFailure(forged, "ARTIFACT_CACHE_ENTRY_INVALID");

    const firstHash = await hashKernelShapeSemanticObservation(observation);
    const secondHash = await hashKernelShapeSemanticObservation(observation);
    expect(firstHash.ok).toBe(true);
    expect(secondHash).toEqual(firstHash);
    if (firstHash.ok) {
      expect(firstHash.value).toMatch(
        new RegExp(`^${KERNEL_SHAPE_ARTIFACT_SEMANTIC_WITNESS_PREFIX}[0-9a-f]{64}$`),
      );
    }

    const controller = new AbortController();
    controller.abort();
    const abortedHash = await hashKernelShapeSemanticObservation(observation, {
      signal: controller.signal,
    });
    expectFailure(abortedHash, "EVALUATION_ABORTED");

    const { proxy: proxySignal, revoke: revokeSignal } = Proxy.revocable(
      new AbortController().signal,
      {},
    );
    revokeSignal();
    const hostileSignalHash = await hashKernelShapeSemanticObservation(
      observation,
      { signal: proxySignal },
    );
    expectFailure(hostileSignalHash, "ARTIFACT_CACHE_ENTRY_INVALID");
  });
});
