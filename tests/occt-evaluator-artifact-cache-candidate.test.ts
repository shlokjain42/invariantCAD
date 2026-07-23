import { describe, expect, it } from "vitest";
import {
  MemoryArtifactCacheStore,
  EvaluatedSolid,
  createArtifactCacheRecord,
  createEvaluator,
  createReferenceSketchSolver,
  design,
  inspectKernelShapeArtifactSupport,
  mm,
  vec3,
  type ArtifactCacheEvent,
  type ArtifactCacheRecordV1,
  type ArtifactCacheStore,
  type ArtifactCacheStoreContext,
  type GeometryKernel,
  type KernelShape,
  type SketchSolverBackend,
} from "../src/index.js";
import { bindOcctEvaluatorArtifactCacheCandidate } from "../src/internal/evaluator-artifact-cache-candidate.js";
import {
  createOcctKernel,
  type OcctKernelOptions,
} from "../src/occt-kernel.js";

function artifactCompatibleSolver(
  fingerprint = "invariantcad.reference-sketch-solver.test@1",
): SketchSolverBackend {
  const delegate = createReferenceSketchSolver();
  return Object.freeze({
    id: delegate.id,
    capabilities: delegate.capabilities,
    artifactCompatibilityFingerprint: fingerprint,
    solve: delegate.solve.bind(delegate),
    dispose: delegate.dispose.bind(delegate),
  });
}

async function observedOcctKernel(
  options: OcctKernelOptions = {},
): Promise<{
  readonly kernel: GeometryKernel;
  readonly boxCalls: () => number;
  readonly disposeCalls: (shape: KernelShape) => number;
  readonly lastBoxShape: () => KernelShape | undefined;
  readonly liveShapes: () => number;
}> {
  const delegate = await createOcctKernel(options);
  let boxes = 0;
  let lastBox: KernelShape | undefined;
  const disposals = new Map<KernelShape, number>();
  const kernel = new Proxy(delegate, {
    get(target, property) {
      if (property === "box") {
        return (...args: Parameters<NonNullable<GeometryKernel["box"]>>) => {
          boxes += 1;
          lastBox = Reflect.apply(target.box!, target, args);
          return lastBox;
        };
      }
      if (property === "disposeShape") {
        return (shape: KernelShape) => {
          disposals.set(shape, (disposals.get(shape) ?? 0) + 1);
          target.disposeShape(shape);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as GeometryKernel;
  return {
    kernel,
    boxCalls: () => boxes,
    disposeCalls: (shape) => disposals.get(shape) ?? 0,
    lastBoxShape: () => lastBox,
    liveShapes: () =>
      (
        delegate as unknown as {
          readonly liveShapes: ReadonlySet<KernelShape>;
        }
      ).liveShapes.size,
  };
}

class CapturingArtifactStore implements ArtifactCacheStore {
  readonly memory = new MemoryArtifactCacheStore();
  lastRecord: ArtifactCacheRecordV1 | undefined;
  corruptRead = false;
  failDelete = false;
  failWrite = false;

  async read(
    key: Parameters<ArtifactCacheStore["read"]>[0],
    context: ArtifactCacheStoreContext,
  ) {
    const value = await this.memory.read(key, context);
    if (!this.corruptRead || value === undefined) return value;
    const payload = value.payload.slice();
    payload[0] = (payload[0] ?? 0) ^ 0xff;
    return { ...value, payload };
  }

  write(record: ArtifactCacheRecordV1, context: ArtifactCacheStoreContext) {
    this.lastRecord = record;
    if (this.failWrite) throw new Error("write failed for test");
    return this.memory.write(record, context);
  }

  delete(
    key: Parameters<ArtifactCacheStore["delete"]>[0],
    context: Parameters<ArtifactCacheStore["delete"]>[1],
  ) {
    if (this.failDelete) throw new Error("delete failed for test");
    return this.memory.delete(key, context);
  }

  async installMalformedPayload(payload = new Uint8Array([1, 2, 3])) {
    const source = this.lastRecord;
    if (source === undefined) throw new Error("Expected a captured record");
    const created = await createArtifactCacheRecord(
      { key: source.key, material: source.metadata },
      payload,
    );
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));
    await this.memory.write(created.value, {
      maxBytes: created.value.payload.byteLength,
    });
  }
}

function boxDocument() {
  const cad = design("artifact-cache-box");
  cad.output(
    "box",
    cad.box("box", {
      size: vec3(mm(2), mm(3), mm(5)),
      center: true,
    }),
  );
  return cad.build();
}

describe("private OCCT evaluator artifact-cache candidate", () => {
  it("keeps the candidate-only evaluator entry point runtime-private", async () => {
    const observed = await observedOcctKernel();
    const evaluator = await createEvaluator({
      kernel: observed.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    try {
      expect(Reflect.get(evaluator, "evaluateOnce")).toBeUndefined();
      expect(
        Object.getOwnPropertyNames(Object.getPrototypeOf(evaluator)),
      ).not.toContain("evaluateOnce");
    } finally {
      evaluator.dispose();
    }
  });

  it("runs a cold box write and a fresh-kernel warm decode without advertising support", async () => {
    const store = new MemoryArtifactCacheStore();
    const coldEvents: ArtifactCacheEvent[] = [];
    const producer = await observedOcctKernel();
    const producerEvaluator = await createEvaluator({
      kernel: producer.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    const producerBinding = bindOcctEvaluatorArtifactCacheCandidate(
      producerEvaluator,
      {
        trust: "trusted",
        cache: {
          store,
          onEvent: (event) => {
            coldEvents.push(event);
          },
        },
      },
    );
    expect(producerBinding.ok, JSON.stringify(producerBinding.diagnostics)).toBe(
      true,
    );
    expect(inspectKernelShapeArtifactSupport(producer.kernel)).toEqual({
      status: "absent",
    });
    expect(producer.kernel.capabilities.shapeArtifacts).toBeUndefined();
    expect(producer.kernel.encodeShapeArtifact).toBeUndefined();
    expect(producer.kernel.decodeShapeArtifact).toBeUndefined();

    const cold = await producerEvaluator.evaluate(boxDocument());
    expect(cold.ok, JSON.stringify(cold.diagnostics)).toBe(true);
    if (!cold.ok) throw new Error("Expected cold evaluation");
    const coldOutput = cold.value.output("box");
    expect(coldOutput).toBeInstanceOf(EvaluatedSolid);
    if (!(coldOutput instanceof EvaluatedSolid)) {
      throw new Error("Expected cold solid");
    }
    const coldMeasurement = coldOutput.measure();
    const coldTopology = coldOutput.topology();
    expect(cold.value.diagnostics).toEqual([]);
    expect(producer.boxCalls()).toBe(1);
    expect(coldEvents.map((event) => event.kind)).toEqual(["miss", "write"]);
    expect(store.size).toBe(1);
    cold.value.dispose();
    expect(producer.liveShapes()).toBe(0);
    producerEvaluator.dispose();

    const warmEvents: ArtifactCacheEvent[] = [];
    const consumer = await observedOcctKernel();
    const consumerEvaluator = await createEvaluator({
      kernel: consumer.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    const consumerBinding = bindOcctEvaluatorArtifactCacheCandidate(
      consumerEvaluator,
      {
        trust: "trusted",
        cache: {
          store,
          onEvent: (event) => {
            warmEvents.push(event);
          },
        },
      },
    );
    expect(consumerBinding.ok, JSON.stringify(consumerBinding.diagnostics)).toBe(
      true,
    );
    const warm = await consumerEvaluator.evaluate(boxDocument());
    expect(warm.ok, JSON.stringify(warm.diagnostics)).toBe(true);
    if (!warm.ok) throw new Error("Expected warm evaluation");
    const warmOutput = warm.value.output("box");
    expect(warmOutput).toBeInstanceOf(EvaluatedSolid);
    if (!(warmOutput instanceof EvaluatedSolid)) {
      throw new Error("Expected warm solid");
    }
    expect(warmOutput.measure()).toEqual(coldMeasurement);
    expect(warm.value.diagnostics).toEqual(cold.value.diagnostics);
    expect(consumer.boxCalls()).toBe(0);
    expect(warmEvents.map((event) => event.kind)).toEqual(["hit"]);
    const warmTopology = warmOutput.topology();
    expect(warmTopology.ok).toBe(true);
    expect(coldTopology.ok).toBe(true);
    if (coldTopology.ok && warmTopology.ok) {
      expect(warmTopology.value.faces).toHaveLength(
        coldTopology.value.faces.length,
      );
      expect(warmTopology.value.edges).toHaveLength(
        coldTopology.value.edges.length,
      );
      expect(warmTopology.value.vertices).toHaveLength(
        coldTopology.value.vertices.length,
      );
      expect(warmTopology.value.faces[0]?.key).not.toBe(
        coldTopology.value.faces[0]?.key,
      );
    }
    const warmShape = (warmOutput as unknown as { readonly shape: KernelShape })
      .shape;
    warm.value.dispose();
    expect(consumer.disposeCalls(warmShape)).toBe(1);
    expect(consumer.liveShapes()).toBe(0);
    consumerEvaluator.dispose();
  });

  it("fails closed when the default solver has no artifact identity", async () => {
    const observed = await observedOcctKernel();
    const evaluator = await createEvaluator({ kernel: observed.kernel });
    try {
      const bound = bindOcctEvaluatorArtifactCacheCandidate(evaluator, {
        trust: "trusted",
        cache: { store: new MemoryArtifactCacheStore() },
      });
      expect(bound.ok).toBe(false);
      if (!bound.ok) {
        expect(bound.diagnostics[0]?.code).toBe("KERNEL_CAPABILITY_MISSING");
      }
    } finally {
      evaluator.dispose();
    }
  });

  it("preserves box validation before performing any cache operation", async () => {
    const events: ArtifactCacheEvent[] = [];
    const observed = await observedOcctKernel();
    const evaluator = await createEvaluator({
      kernel: observed.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    const bound = bindOcctEvaluatorArtifactCacheCandidate(evaluator, {
      trust: "trusted",
      cache: {
        store: new MemoryArtifactCacheStore(),
        onEvent: (event) => {
          events.push(event);
        },
      },
    });
    expect(bound.ok).toBe(true);
    const cad = design("invalid-cache-box");
    cad.output(
      "box",
      cad.box("box", {
        size: vec3(mm(0), mm(3), mm(5)),
      }),
    );
    const invalidDocument = cad.build();
    const abortedController = new AbortController();
    abortedController.abort();
    const aborted = await evaluator.evaluate(invalidDocument, {
      signal: abortedController.signal,
    });
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) {
      expect(aborted.diagnostics[0]?.code).toBe("EVALUATION_ABORTED");
    }
    expect(events).toEqual([]);
    expect(observed.boxCalls()).toBe(0);

    const invalid = await evaluator.evaluate(invalidDocument);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.diagnostics[0]).toMatchObject({
        code: "FEATURE_INVALID",
        node: "box",
        path: "/nodes/box/size/0",
      });
    }
    expect(events).toEqual([]);
    expect(observed.boxCalls()).toBe(0);

    const oversizedCad = design("oversized-cache-key");
    const oversizedId = `b${"x".repeat(1_024)}`;
    oversizedCad.output(
      "box",
      oversizedCad.box(oversizedId, {
        size: vec3(mm(2), mm(3), mm(5)),
      }),
    );
    const oversized = await evaluator.evaluate(oversizedCad.build());
    expect(oversized.ok, JSON.stringify(oversized.diagnostics)).toBe(true);
    if (oversized.ok) oversized.value.dispose();
    expect(events).toEqual([]);
    expect(observed.boxCalls()).toBe(1);
    evaluator.dispose();

    const limitedObserved = await observedOcctKernel();
    const limitedKernel = new Proxy(limitedObserved.kernel, {
      get(target, property) {
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            primitives: target.capabilities.primitives.filter(
              (primitive) => primitive !== "box",
            ),
          };
        }
        return Reflect.get(target, property, target);
      },
    }) as GeometryKernel;
    const limitedEvaluator = await createEvaluator({
      kernel: limitedKernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    const limitedEvents: ArtifactCacheEvent[] = [];
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(limitedEvaluator, {
        trust: "trusted",
        cache: {
          store: new MemoryArtifactCacheStore(),
          onEvent: (event) => {
            limitedEvents.push(event);
          },
        },
      }).ok,
    ).toBe(true);
    const unsupported = await limitedEvaluator.evaluate(boxDocument());
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) {
      expect(unsupported.diagnostics[0]?.code).toBe(
        "KERNEL_CAPABILITY_MISSING",
      );
    }
    expect(limitedEvents).toEqual([]);
    expect(limitedObserved.boxCalls()).toBe(0);
    limitedEvaluator.dispose();
  });

  it("evicts integrity-valid malformed artifacts before transactional recovery", async () => {
    const store = new CapturingArtifactStore();
    const events: ArtifactCacheEvent[] = [];
    const observed = await observedOcctKernel();
    const evaluator = await createEvaluator({
      kernel: observed.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(evaluator, {
        trust: "trusted",
        cache: {
          store,
          onEvent: (event) => {
            events.push(event);
          },
        },
      }).ok,
    ).toBe(true);

    const cold = await evaluator.evaluate(boxDocument());
    expect(cold.ok).toBe(true);
    if (!cold.ok) throw new Error("Expected cold evaluation");
    cold.value.dispose();
    expect(observed.boxCalls()).toBe(1);

    store.corruptRead = true;
    events.length = 0;
    const integrityRecovered = await evaluator.evaluate(boxDocument());
    expect(
      integrityRecovered.ok,
      JSON.stringify(integrityRecovered.diagnostics),
    ).toBe(true);
    if (!integrityRecovered.ok) throw new Error("Expected integrity recovery");
    expect(observed.boxCalls()).toBe(2);
    expect(events.map((event) => event.kind)).toEqual([
      "invalid",
      "delete",
      "write",
    ]);
    integrityRecovered.value.dispose();
    store.corruptRead = false;

    await store.installMalformedPayload();
    events.length = 0;
    const recovered = await evaluator.evaluate(boxDocument());
    expect(recovered.ok, JSON.stringify(recovered.diagnostics)).toBe(true);
    if (!recovered.ok) throw new Error("Expected recovery");
    expect(observed.boxCalls()).toBe(3);
    expect(events.map((event) => event.kind)).toEqual([
      "hit",
      "invalid",
      "delete",
      "write",
    ]);
    expect(events[1]).toMatchObject({
      operation: "decode",
      node: "box",
    });
    recovered.value.dispose();

    await store.installMalformedPayload();
    store.failDelete = true;
    events.length = 0;
    const blocked = await evaluator.evaluate(boxDocument());
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.diagnostics.at(-1)?.code).toBe(
        "ARTIFACT_CACHE_OPERATION_FAILED",
      );
    }
    expect(observed.boxCalls()).toBe(3);
    expect(events.map((event) => event.kind)).toEqual([
      "hit",
      "invalid",
      "error",
    ]);
    expect(observed.liveShapes()).toBe(0);
    evaluator.dispose();
  });

  it("cleans up the modeled shape exactly once when a strict write fails", async () => {
    const store = new CapturingArtifactStore();
    store.failWrite = true;
    const events: ArtifactCacheEvent[] = [];
    const observed = await observedOcctKernel();
    const evaluator = await createEvaluator({
      kernel: observed.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(evaluator, {
        trust: "trusted",
        cache: {
          store,
          onEvent: (event) => {
            events.push(event);
          },
        },
      }).ok,
    ).toBe(true);
    const result = await evaluator.evaluate(boxDocument());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.at(-1)?.code).toBe(
        "ARTIFACT_CACHE_OPERATION_FAILED",
      );
    }
    const shape = observed.lastBoxShape();
    expect(shape).toBeDefined();
    if (shape !== undefined) expect(observed.disposeCalls(shape)).toBe(1);
    expect(observed.liveShapes()).toBe(0);
    expect(events.map((event) => event.kind)).toEqual(["miss", "error"]);
    expect(events.at(-1)).toMatchObject({ operation: "write" });
    evaluator.dispose();
  });

  it("reports a tight positive codec ceiling as a structured cache limit", async () => {
    const events: ArtifactCacheEvent[] = [];
    const store = new MemoryArtifactCacheStore();
    const observed = await observedOcctKernel();
    const evaluator = await createEvaluator({
      kernel: observed.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(evaluator, {
        trust: "trusted",
        cache: {
          store,
          limits: { maxEntryBytes: 1 },
          onEvent: (event) => {
            events.push(event);
          },
        },
      }).ok,
    ).toBe(true);

    const result = await evaluator.evaluate(boxDocument());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.at(-1)).toMatchObject({
        code: "ARTIFACT_CACHE_LIMIT_EXCEEDED",
        node: "box",
        details: {
          resource: "maxEntryBytes",
          limit: 1,
        },
      });
    }
    expect(observed.boxCalls()).toBe(1);
    expect(observed.liveShapes()).toBe(0);
    expect(store.size).toBe(0);
    expect(events.map((event) => event.kind)).toEqual(["miss", "limit"]);
    expect(events.at(-1)).toMatchObject({
      operation: "encode",
      node: "box",
    });
    evaluator.dispose();
  });

  it("characterizes why integrity-valid records still require a trusted store", async () => {
    const expectedStore = new CapturingArtifactStore();
    const expectedObserved = await observedOcctKernel();
    const expectedEvaluator = await createEvaluator({
      kernel: expectedObserved.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(expectedEvaluator, {
        trust: "trusted",
        cache: { store: expectedStore },
      }).ok,
    ).toBe(true);
    const expectedCold = await expectedEvaluator.evaluate(boxDocument());
    expect(expectedCold.ok).toBe(true);
    if (expectedCold.ok) expectedCold.value.dispose();

    const substitutedStore = new CapturingArtifactStore();
    const substitutedObserved = await observedOcctKernel();
    const substitutedEvaluator = await createEvaluator({
      kernel: substitutedObserved.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(substitutedEvaluator, {
        trust: "trusted",
        cache: { store: substitutedStore },
      }).ok,
    ).toBe(true);
    const otherCad = design("substituted-cache-box");
    otherCad.output(
      "box",
      otherCad.box("box", {
        size: vec3(mm(4), mm(3), mm(5)),
        center: true,
      }),
    );
    const substitutedCold = await substitutedEvaluator.evaluate(
      otherCad.build(),
    );
    expect(substitutedCold.ok).toBe(true);
    if (substitutedCold.ok) substitutedCold.value.dispose();

    const expectedRecord = expectedStore.lastRecord;
    const substitutedRecord = substitutedStore.lastRecord;
    if (expectedRecord === undefined || substitutedRecord === undefined) {
      throw new Error("Expected both cache records");
    }
    const poisoned = await createArtifactCacheRecord(
      {
        key: expectedRecord.key,
        material: expectedRecord.metadata,
      },
      substitutedRecord.payload,
    );
    if (!poisoned.ok) throw new Error(JSON.stringify(poisoned.diagnostics));
    await expectedStore.memory.write(poisoned.value, {
      maxBytes: poisoned.value.payload.byteLength,
    });

    const acceptedPoison = await expectedEvaluator.evaluate(boxDocument());
    expect(acceptedPoison.ok, JSON.stringify(acceptedPoison.diagnostics)).toBe(
      true,
    );
    if (!acceptedPoison.ok) throw new Error("Expected trusted-store hit");
    const output = acceptedPoison.value.output("box");
    expect(output).toBeInstanceOf(EvaluatedSolid);
    if (output instanceof EvaluatedSolid) {
      expect(output.measure().volume).toBeCloseTo(60, 10);
    }
    expect(expectedObserved.boxCalls()).toBe(1);
    acceptedPoison.value.dispose();
    expectedEvaluator.dispose();
    substitutedEvaluator.dispose();
  });

  it("honors read-only and write-only session modes", async () => {
    const readOnlyStore = new MemoryArtifactCacheStore();
    const readOnlyEvents: ArtifactCacheEvent[] = [];
    const readOnlyObserved = await observedOcctKernel();
    const readOnlyEvaluator = await createEvaluator({
      kernel: readOnlyObserved.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(readOnlyEvaluator, {
        trust: "trusted",
        cache: {
          store: readOnlyStore,
          mode: "read-only",
          onEvent: (event) => {
            readOnlyEvents.push(event);
          },
        },
      }).ok,
    ).toBe(true);
    const readOnly = await readOnlyEvaluator.evaluate(boxDocument());
    expect(readOnly.ok).toBe(true);
    if (readOnly.ok) readOnly.value.dispose();
    expect(readOnlyObserved.boxCalls()).toBe(1);
    expect(readOnlyStore.size).toBe(0);
    expect(readOnlyEvents.map((event) => event.kind)).toEqual(["miss"]);
    readOnlyEvaluator.dispose();

    const writeOnlyStore = new CapturingArtifactStore();
    const writeOnlyEvents: ArtifactCacheEvent[] = [];
    const writeOnlyObserved = await observedOcctKernel();
    const writeOnlyEvaluator = await createEvaluator({
      kernel: writeOnlyObserved.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(writeOnlyEvaluator, {
        trust: "trusted",
        cache: {
          store: writeOnlyStore,
          mode: "write-only",
          onEvent: (event) => {
            writeOnlyEvents.push(event);
          },
        },
      }).ok,
    ).toBe(true);
    const writeOnly = await writeOnlyEvaluator.evaluate(boxDocument());
    expect(writeOnly.ok).toBe(true);
    if (writeOnly.ok) writeOnly.value.dispose();
    expect(writeOnlyObserved.boxCalls()).toBe(1);
    expect(writeOnlyStore.memory.size).toBe(1);
    expect(writeOnlyEvents.map((event) => event.kind)).toEqual([
      "bypass",
      "write",
    ]);
    expect(writeOnlyEvents[0]).toMatchObject({ operation: "read" });
    writeOnlyEvaluator.dispose();

    await writeOnlyStore.installMalformedPayload();
    const poisonedEvents: ArtifactCacheEvent[] = [];
    const poisonedObserved = await observedOcctKernel();
    const poisonedEvaluator = await createEvaluator({
      kernel: poisonedObserved.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(poisonedEvaluator, {
        trust: "trusted",
        cache: {
          store: writeOnlyStore,
          mode: "read-only",
          onEvent: (event) => {
            poisonedEvents.push(event);
          },
        },
      }).ok,
    ).toBe(true);
    const poisoned = await poisonedEvaluator.evaluate(boxDocument());
    expect(poisoned.ok).toBe(false);
    if (!poisoned.ok) {
      expect(poisoned.diagnostics.at(-1)?.code).toBe(
        "ARTIFACT_CACHE_ENTRY_INVALID",
      );
    }
    expect(poisonedObserved.boxCalls()).toBe(0);
    expect(writeOnlyStore.memory.size).toBe(1);
    expect(poisonedEvents.map((event) => event.kind)).toEqual([
      "hit",
      "invalid",
    ]);
    poisonedEvaluator.dispose();
  });

  it("invalidates changed parameters and solver compatibility identities", async () => {
    const store = new MemoryArtifactCacheStore();
    const cad = design("parameterized-cache-box");
    const width = cad.parameter.length("width", mm(2));
    cad.output(
      "box",
      cad.box("box", {
        size: vec3(width, mm(3), mm(5)),
      }),
    );
    const document = cad.build();
    const observed = await observedOcctKernel();
    const evaluator = await createEvaluator({
      kernel: observed.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(evaluator, {
        trust: "trusted",
        cache: { store },
      }).ok,
    ).toBe(true);

    for (const widthValue of [2, 2, 4]) {
      const result = await evaluator.evaluate(document, {
        parameters: { width: widthValue },
      });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      if (result.ok) result.value.dispose();
    }
    expect(observed.boxCalls()).toBe(2);
    expect(store.size).toBe(2);
    evaluator.dispose();

    const changedSolverObserved = await observedOcctKernel();
    const changedSolverEvaluator = await createEvaluator({
      kernel: changedSolverObserved.kernel,
      sketchSolver: artifactCompatibleSolver(
        "invariantcad.reference-sketch-solver.test@2",
      ),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(changedSolverEvaluator, {
        trust: "trusted",
        cache: { store },
      }).ok,
    ).toBe(true);
    const changedSolver = await changedSolverEvaluator.evaluate(document, {
      parameters: { width: 2 },
    });
    expect(changedSolver.ok).toBe(true);
    if (changedSolver.ok) changedSolver.value.dispose();
    expect(changedSolverObserved.boxCalls()).toBe(1);
    expect(store.size).toBe(3);
    changedSolverEvaluator.dispose();

    const changedKernelObserved = await observedOcctKernel({
      modelingTolerance: 1e-6,
    });
    const changedKernelEvaluator = await createEvaluator({
      kernel: changedKernelObserved.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(changedKernelEvaluator, {
        trust: "trusted",
        cache: { store },
      }).ok,
    ).toBe(true);
    const changedKernel = await changedKernelEvaluator.evaluate(document, {
      parameters: { width: 2 },
    });
    expect(changedKernel.ok).toBe(true);
    if (changedKernel.ok) changedKernel.value.dispose();
    expect(changedKernelObserved.boxCalls()).toBe(1);
    expect(store.size).toBe(4);
    changedKernelEvaluator.dispose();
  });

  it("deduplicates shared direct outputs and leaves dependent features out of the v1 experiment", async () => {
    const sharedCad = design("shared-cache-box");
    const sharedBox = sharedCad.box("box", {
      size: vec3(mm(2), mm(3), mm(5)),
    });
    sharedCad.output("first", sharedBox);
    sharedCad.output("second", sharedBox);
    const sharedStore = new MemoryArtifactCacheStore();
    const sharedEvents: ArtifactCacheEvent[] = [];
    const sharedObserved = await observedOcctKernel();
    const sharedEvaluator = await createEvaluator({
      kernel: sharedObserved.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(sharedEvaluator, {
        trust: "trusted",
        cache: {
          store: sharedStore,
          onEvent: (event) => {
            sharedEvents.push(event);
          },
        },
      }).ok,
    ).toBe(true);
    const cold = await sharedEvaluator.evaluate(sharedCad.build());
    expect(cold.ok).toBe(true);
    if (cold.ok) cold.value.dispose();
    expect(sharedObserved.boxCalls()).toBe(1);
    expect(sharedEvents.map((event) => event.kind)).toEqual(["miss", "write"]);
    sharedEvents.length = 0;
    const warm = await sharedEvaluator.evaluate(sharedCad.build());
    expect(warm.ok).toBe(true);
    if (warm.ok) warm.value.dispose();
    expect(sharedObserved.boxCalls()).toBe(1);
    expect(sharedEvents.map((event) => event.kind)).toEqual(["hit"]);
    sharedEvaluator.dispose();

    const dependentCad = design("dependent-cache-box");
    const base = dependentCad.box("box", {
      size: vec3(mm(2), mm(3), mm(5)),
    });
    dependentCad.output(
      "moved",
      dependentCad.translate(
        "moved",
        base,
        vec3(mm(1), mm(0), mm(0)),
      ),
    );
    const dependentStore = new MemoryArtifactCacheStore();
    const dependentEvents: ArtifactCacheEvent[] = [];
    const dependentObserved = await observedOcctKernel();
    const dependentEvaluator = await createEvaluator({
      kernel: dependentObserved.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(dependentEvaluator, {
        trust: "trusted",
        cache: {
          store: dependentStore,
          onEvent: (event) => {
            dependentEvents.push(event);
          },
        },
      }).ok,
    ).toBe(true);
    const dependent = await dependentEvaluator.evaluate(dependentCad.build());
    expect(dependent.ok).toBe(true);
    if (dependent.ok) dependent.value.dispose();
    expect(dependentObserved.boxCalls()).toBe(1);
    expect(dependentStore.size).toBe(0);
    expect(dependentEvents).toEqual([]);
    dependentEvaluator.dispose();
  });

  it("gives cancellation precedence after a cache write commits", async () => {
    const controller = new AbortController();
    const memory = new MemoryArtifactCacheStore();
    const committingStore: ArtifactCacheStore = {
      read: (key, context) => memory.read(key, context),
      write: (record, context) => {
        memory.write(record, context);
        controller.abort();
      },
      delete: (key, context) => memory.delete(key, context),
    };
    const observed = await observedOcctKernel();
    const evaluator = await createEvaluator({
      kernel: observed.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(evaluator, {
        trust: "trusted",
        cache: { store: committingStore },
      }).ok,
    ).toBe(true);
    const result = await evaluator.evaluate(boxDocument(), {
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.at(-1)?.code).toBe("EVALUATION_ABORTED");
    }
    const shape = observed.lastBoxShape();
    expect(shape).toBeDefined();
    if (shape !== undefined) expect(observed.disposeCalls(shape)).toBe(1);
    expect(observed.liveShapes()).toBe(0);
    expect(memory.size).toBe(1);
    evaluator.dispose();
  });

  it("snapshots inputs and rejects evaluation or disposal races while cache I/O is active", async () => {
    let markReadStarted = (): void => {};
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    let releaseRead = (): void => {};
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const memory = new MemoryArtifactCacheStore();
    const blockingStore: ArtifactCacheStore = {
      read: async () => {
        markReadStarted();
        await readGate;
        return undefined;
      },
      write: (record, context) => memory.write(record, context),
      delete: (key, context) => memory.delete(key, context),
    };
    const observed = await observedOcctKernel();
    const evaluator = await createEvaluator({
      kernel: observed.kernel,
      sketchSolver: artifactCompatibleSolver(),
    });
    expect(
      bindOcctEvaluatorArtifactCacheCandidate(evaluator, {
        trust: "trusted",
        cache: { store: blockingStore },
      }).ok,
    ).toBe(true);
    const mutable = structuredClone(boxDocument());
    const outputs = ["box"];
    const first = evaluator.evaluate(mutable, { outputs });
    await readStarted;

    const box = Object.entries(mutable.nodes).find(
      ([id]) => id === "box",
    )?.[1];
    if (box?.kind !== "box") throw new Error("Expected mutable box");
    (
      box.size[0] as {
        value: number;
      }
    ).value = 200;
    outputs[0] = "missing";
    await expect(evaluator.evaluate(mutable)).rejects.toThrow(/overlap/);
    expect(() => evaluator.dispose()).toThrow(/during/);

    releaseRead();
    const result = await first;
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error("Expected snapshotted evaluation");
    const output = result.value.output("box");
    expect(output).toBeInstanceOf(EvaluatedSolid);
    if (output instanceof EvaluatedSolid) {
      expect(output.measure().volume).toBeCloseTo(30, 10);
    }
    result.value.dispose();
    expect(observed.boxCalls()).toBe(1);
    evaluator.dispose();
  });
});
