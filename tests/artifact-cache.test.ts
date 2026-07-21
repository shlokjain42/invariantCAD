import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ArtifactCacheSession,
  createArtifactCacheSession,
  type ArtifactCacheEvent,
} from "../src/artifact-cache.js";
import {
  ARTIFACT_CACHE_KEY_PREFIX,
  ARTIFACT_CACHE_PROTOCOL_VERSION,
  ArtifactCacheStoreLimitError,
  DEFAULT_ARTIFACT_CACHE_LIMITS,
  FEATURE_HASH_PREFIX,
  KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
  MemoryArtifactCacheStore,
  createArtifactCacheRecord,
  createKernelShapeArtifactCacheKey,
  createReferenceSketchSolver,
  deleteArtifactCacheRecord,
  inspectKernelShapeArtifactSupport,
  normalizeArtifactCacheLimits,
  readArtifactCacheRecord,
  validateArtifactCacheRecord,
  writeArtifactCacheRecord,
  type ArtifactCacheKey,
  type ArtifactCacheRecordV1,
  type ArtifactCacheStore,
  type FeatureHash,
  type GeometryKernel,
  type KernelShape,
  type KernelShapeArtifactCapabilities,
  type KernelShapeArtifactCacheKey,
} from "../src/index.js";

function featureHash(seed: string): FeatureHash {
  return `${FEATURE_HASH_PREFIX}${seed.repeat(64).slice(0, 64)}` as FeatureHash;
}

function fakeKernel(
  options: {
    readonly id?: string;
    readonly fingerprint?: string;
    readonly formatVersion?: number;
    readonly descriptor?: boolean;
    readonly encode?: boolean;
    readonly decode?: boolean;
  } = {},
): GeometryKernel {
  const descriptor = options.descriptor ?? true;
  const capabilities = {
    protocolVersion: 1,
    representation: "brep",
    exact: true,
    primitives: [],
    features: [],
    nativeImports: [],
    nativeExports: [],
    ...(descriptor
      ? {
          shapeArtifacts: {
            protocolVersion: KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
            format: "invariantcad.test.shape",
            formatVersion: options.formatVersion ?? 1,
            compatibilityFingerprint:
              options.fingerprint ?? "test-runtime@1:sha256:abc",
          },
        }
      : {}),
  } as const;
  return {
    id: options.id ?? "test-kernel",
    capabilities,
    ...((options.encode ?? true)
      ? { encodeShapeArtifact: () => new Uint8Array([1, 2, 3]) }
      : {}),
    ...((options.decode ?? true)
      ? {
          decodeShapeArtifact: () => ({ kernel: options.id ?? "test-kernel" }),
        }
      : {}),
    mesh: () => ({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    }),
    measure: () => ({
      volume: 0,
      surfaceArea: 0,
      centerOfMass: null,
      inertiaTensor: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
      genus: 0,
      tolerance: 0,
    }),
    status: () => ({ ok: true, code: "OK" }),
    disposeShape: (_shape: KernelShape) => {},
    dispose: () => {},
  };
}

function artifactCompatibleTestSolver(
  fingerprint = "invariantcad.reference-sketch-solver@1",
) {
  const solver = createReferenceSketchSolver();
  return {
    id: solver.id,
    capabilities: solver.capabilities,
    artifactCompatibilityFingerprint: fingerprint,
    solve: solver.solve.bind(solver),
    dispose: () => solver.dispose(),
  };
}

async function keyValue(
  options: {
    readonly node?: string;
    readonly hash?: FeatureHash;
    readonly kernel?: GeometryKernel;
    readonly solverFingerprint?: string;
  } = {},
): Promise<KernelShapeArtifactCacheKey> {
  const selectedSolver = artifactCompatibleTestSolver(
    options.solverFingerprint,
  );
  const result = await createKernelShapeArtifactCacheKey(
    {
      node: options.node ?? "body",
      outputKind: "solid",
      hash: options.hash ?? featureHash("a"),
    },
    options.kernel ?? fakeKernel(),
    selectedSolver,
  );
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected an artifact cache key");
  return result.value;
}

describe("kernel shape artifact cache protocol", () => {
  it("requires a complete, strong kernel codec declaration", () => {
    expect(
      inspectKernelShapeArtifactSupport(
        fakeKernel({ descriptor: false, encode: false, decode: false }),
      ),
    ).toEqual({ status: "absent" });
    expect(
      inspectKernelShapeArtifactSupport(fakeKernel({ decode: false })),
    ).toMatchObject({
      status: "malformed",
      reason: "incomplete-declaration",
    });
    const supported = inspectKernelShapeArtifactSupport(fakeKernel());
    expect(supported).toMatchObject({
      status: "supported",
      capabilities: {
        protocolVersion: 1,
        format: "invariantcad.test.shape",
        formatVersion: 1,
        compatibilityFingerprint: "test-runtime@1:sha256:abc",
      },
    });
    expect(Object.isFrozen(supported)).toBe(true);
  });

  it("domain-separates stable keys and invalidates every compatibility axis", async () => {
    const first = await keyValue();
    const repeated = await keyValue();
    const node = await keyValue({ node: "other" });
    const feature = await keyValue({ hash: featureHash("b") });
    const kernelId = await keyValue({ kernel: fakeKernel({ id: "other-kernel" }) });
    const runtime = await keyValue({
      kernel: fakeKernel({ fingerprint: "test-runtime@2:sha256:def" }),
    });
    const format = await keyValue({
      kernel: fakeKernel({ formatVersion: 2 }),
    });
    const solver = await keyValue({ solverFingerprint: "test-solver@2" });

    expect(ARTIFACT_CACHE_PROTOCOL_VERSION).toBe(1);
    expect(first.key).toBe(repeated.key);
    expect(first.key).toMatch(
      new RegExp(`^${ARTIFACT_CACHE_KEY_PREFIX}[0-9a-f]{64}$`),
    );
    expect(first.key).toBe(
      `${ARTIFACT_CACHE_KEY_PREFIX}06b851e4416138315a69abc0a2fd1ddb98fac331a798efa7a141dcb5b991e7bd`,
    );
    for (const candidate of [node, feature, kernelId, runtime, format, solver]) {
      expect(candidate.key).not.toBe(first.key);
    }
    expect(first.material.kernel.artifact).not.toHaveProperty(
      "topologyFingerprint",
    );
    expect(Object.isFrozen(first.material)).toBe(true);
    expectTypeOf(first).toEqualTypeOf<KernelShapeArtifactCacheKey>();
  });

  it("takes one solid report entry and preserves its document node key", async () => {
    const accesses = { node: 0, outputKind: 0, hash: 0 };
    const feature = {
      get node() {
        accesses.node += 1;
        return "body with spaces";
      },
      get outputKind() {
        accesses.outputKind += 1;
        return "solid" as const;
      },
      get hash() {
        accesses.hash += 1;
        return featureHash("a");
      },
    };
    const result = await createKernelShapeArtifactCacheKey(
      feature,
      fakeKernel(),
      artifactCompatibleTestSolver(),
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error("Expected a key");
    expect(result.value.material.node).toBe("body with spaces");
    expect(accesses).toEqual({ node: 1, outputKind: 1, hash: 1 });

    const nonSolid = await createKernelShapeArtifactCacheKey(
      {
        node: "sketch",
        outputKind: "profile",
        hash: featureHash("a"),
      },
      fakeKernel(),
      artifactCompatibleTestSolver(),
    );
    expect(nonSolid.ok).toBe(false);
  });

  it("round-trips integrity-checked detached records through the memory store", async () => {
    const key = await keyValue();
    const source = new Uint8Array([1, 2, 3, 4]);
    const created = await createArtifactCacheRecord(key, source);
    expect(created.ok, JSON.stringify(created.diagnostics)).toBe(true);
    if (!created.ok) throw new Error("Expected an artifact record");
    source[0] = 99;
    expect([...created.value.payload]).toEqual([1, 2, 3, 4]);
    expect(created.value.integrity.byteLength).toBe(4);
    expect(created.value.integrity.digest).toMatch(/^[0-9a-f]{64}$/);

    const store = new MemoryArtifactCacheStore();
    const miss = await readArtifactCacheRecord(store, key);
    expect(miss).toEqual({ ok: true, value: { status: "miss" }, diagnostics: [] });
    const written = await writeArtifactCacheRecord(store, created.value);
    expect(written.ok).toBe(true);
    expect(store.size).toBe(1);
    created.value.payload[0] = 88;

    const hit = await readArtifactCacheRecord(store, key);
    expect(hit.ok, JSON.stringify(hit.diagnostics)).toBe(true);
    if (!hit.ok || hit.value.status !== "hit") throw new Error("Expected hit");
    expect([...hit.value.record.payload]).toEqual([1, 2, 3, 4]);
    hit.value.record.payload[1] = 77;
    const repeated = await readArtifactCacheRecord(store, key);
    expect(repeated.ok).toBe(true);
    if (!repeated.ok || repeated.value.status !== "hit") {
      throw new Error("Expected repeated hit");
    }
    expect([...repeated.value.record.payload]).toEqual([1, 2, 3, 4]);

    expect((await deleteArtifactCacheRecord(store, key)).ok).toBe(true);
    expect(store.size).toBe(0);
    expectTypeOf(repeated.value.record).toEqualTypeOf<ArtifactCacheRecordV1>();
  });

  it("rejects corrupt, misrouted, malformed, and oversized records", async () => {
    const key = await keyValue();
    const other = await keyValue({ node: "other" });
    const created = await createArtifactCacheRecord(
      key,
      new Uint8Array([1, 2, 3]),
    );
    if (!created.ok) throw new Error(JSON.stringify(created.diagnostics));

    const corrupt = {
      ...created.value,
      payload: new Uint8Array([1, 2, 4]),
    };
    const corruptResult = await validateArtifactCacheRecord(key, corrupt);
    expect(corruptResult.ok).toBe(false);
    if (!corruptResult.ok) {
      expect(corruptResult.diagnostics[0]?.code).toBe(
        "ARTIFACT_CACHE_ENTRY_INVALID",
      );
    }

    const misrouted = await validateArtifactCacheRecord(other, created.value);
    expect(misrouted.ok).toBe(false);
    const unknownField = await validateArtifactCacheRecord(key, {
      ...created.value,
      future: true,
    });
    expect(unknownField.ok).toBe(false);
    const oversized = await validateArtifactCacheRecord(key, created.value, {
      maxEntryBytes: 2,
    });
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) {
      expect(oversized.diagnostics[0]?.code).toBe(
        "ARTIFACT_CACHE_LIMIT_EXCEEDED",
      );
    }
  });

  it("cryptographically rebinds supplied keys to normalized metadata", async () => {
    const key = await keyValue();
    const forgedMaterial = {
      ...structuredClone(key.material),
      node: "forged node",
    };
    const forgedKey = {
      key: key.key,
      material: forgedMaterial,
    } as KernelShapeArtifactCacheKey;
    const creation = await createArtifactCacheRecord(
      forgedKey,
      new Uint8Array([1]),
    );
    expect(creation.ok).toBe(false);

    const valid = await createArtifactCacheRecord(
      key,
      new Uint8Array([1, 2, 3]),
    );
    if (!valid.ok) throw new Error(JSON.stringify(valid.diagnostics));
    const forgedRecord = {
      ...valid.value,
      metadata: forgedMaterial,
    } as ArtifactCacheRecordV1;
    const store = new MemoryArtifactCacheStore();
    const written = await writeArtifactCacheRecord(store, forgedRecord);
    expect(written.ok).toBe(false);
    expect(store.size).toBe(0);
    const validated = await validateArtifactCacheRecord(key, forgedRecord);
    expect(validated.ok).toBe(false);
  });

  it("accepts cross-realm exact Uint8Arrays and rejects spoofed views", async () => {
    const key = await keyValue();
    const crossRealm = runInNewContext(
      "new Uint8Array([1, 2, 3])",
    ) as Uint8Array;
    expect(crossRealm instanceof Uint8Array).toBe(false);
    const crossRealmRecord = await createArtifactCacheRecord(key, crossRealm);
    expect(crossRealmRecord.ok).toBe(true);
    if (!crossRealmRecord.ok) throw new Error("Expected cross-realm payload");
    expect([...crossRealmRecord.value.payload]).toEqual([1, 2, 3]);

    const spoofed = new Uint16Array([1, 2]);
    Object.defineProperty(spoofed, Symbol.toStringTag, {
      configurable: true,
      value: "Uint8Array",
    });
    expect(
      (await createArtifactCacheRecord(
        key,
        spoofed as unknown as Uint8Array,
      )).ok,
    ).toBe(false);
    expect(
      (await createArtifactCacheRecord(
        key,
        new Uint8ClampedArray([1]) as unknown as Uint8Array,
      )).ok,
    ).toBe(false);

    const hostileIterator = new Uint8Array([4, 5]);
    Object.defineProperty(hostileIterator, Symbol.iterator, {
      value: () => {
        throw new Error("iterator must not be used");
      },
    });
    const detached = await createArtifactCacheRecord(key, hostileIterator);
    expect(detached.ok).toBe(true);
  });

  it("contains store failures and gives cancellation precedence", async () => {
    const key = await keyValue();
    const throwingStore: ArtifactCacheStore = {
      read: () => {
        throw new Error("read exploded");
      },
      write: () => {
        throw new Error("write exploded");
      },
      delete: () => {
        throw new Error("delete exploded");
      },
    };
    const failed = await readArtifactCacheRecord(throwingStore, key);
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.diagnostics[0]).toMatchObject({
        code: "ARTIFACT_CACHE_OPERATION_FAILED",
        details: { operation: "read", key: key.key },
      });
    }

    const controller = new AbortController();
    controller.abort();
    const aborted = await readArtifactCacheRecord(
      new MemoryArtifactCacheStore(),
      key,
      { signal: controller.signal },
    );
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) {
      expect(aborted.diagnostics[0]?.code).toBe("EVALUATION_ABORTED");
    }

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hostileThrownStore: ArtifactCacheStore = {
      read: () => {
        throw revoked.proxy;
      },
      write: () => {},
      delete: () => {},
    };
    const hostile = await readArtifactCacheRecord(hostileThrownStore, key);
    expect(hostile.ok).toBe(false);
    if (!hostile.ok) {
      expect(hostile.diagnostics[0]?.code).toBe(
        "ARTIFACT_CACHE_OPERATION_FAILED",
      );
    }

    const unknownStore: ArtifactCacheStore = {
      read: () => ({ future: true }),
      write: () => {},
      delete: () => {},
    };
    const unknown = await readArtifactCacheRecord(unknownStore, key);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.diagnostics[0]?.code).toBe(
        "ARTIFACT_CACHE_ENTRY_INVALID",
      );
    }

    const duringRead = new AbortController();
    const abortingStore: ArtifactCacheStore = {
      read: () => {
        duringRead.abort();
        return undefined;
      },
      write: () => {},
      delete: () => {},
    };
    const abortedAfterStore = await readArtifactCacheRecord(
      abortingStore,
      key,
      { signal: duringRead.signal },
    );
    expect(abortedAfterStore.ok).toBe(false);
    if (!abortedAfterStore.ok) {
      expect(abortedAfterStore.diagnostics[0]?.code).toBe(
        "EVALUATION_ABORTED",
      );
    }

    const record = await createArtifactCacheRecord(
      key,
      new Uint8Array([1]),
    );
    if (!record.ok) throw new Error("Expected record");
    const duringWrite = new AbortController();
    const abortingWriteStore: ArtifactCacheStore = {
      read: () => undefined,
      write: () => {
        duringWrite.abort();
      },
      delete: () => {},
    };
    const abortedAfterWrite = await writeArtifactCacheRecord(
      abortingWriteStore,
      record.value,
      { signal: duringWrite.signal },
    );
    expect(abortedAfterWrite.ok).toBe(false);
    if (!abortedAfterWrite.ok) {
      expect(abortedAfterWrite.diagnostics[0]?.code).toBe(
        "EVALUATION_ABORTED",
      );
    }

    const boundedStore: ArtifactCacheStore = {
      read: (_key, context) => {
        throw new ArtifactCacheStoreLimitError(context.maxBytes, 3);
      },
      write: () => {},
      delete: () => {},
    };
    const bounded = await readArtifactCacheRecord(boundedStore, key, {
      limits: { maxEntryBytes: 2 },
    });
    expect(bounded.ok).toBe(false);
    if (!bounded.ok) {
      expect(bounded.diagnostics[0]).toMatchObject({
        code: "ARTIFACT_CACHE_LIMIT_EXCEEDED",
        details: { resource: "maxEntryBytes", limit: 2, actual: 3 },
      });
    }
    expect(() => new ArtifactCacheStoreLimitError(2, 2)).toThrow(RangeError);
    const mutatedLimit = new ArtifactCacheStoreLimitError(2, 3);
    Object.defineProperty(mutatedLimit, "actual", { value: 1 });
    const mutatedStore: ArtifactCacheStore = {
      read: () => {
        throw mutatedLimit;
      },
      write: () => {},
      delete: () => {},
    };
    const mutated = await readArtifactCacheRecord(mutatedStore, key, {
      limits: { maxEntryBytes: 2 },
    });
    expect(mutated.ok).toBe(false);
    if (!mutated.ok) {
      expect(mutated.diagnostics[0]?.code).toBe(
        "ARTIFACT_CACHE_OPERATION_FAILED",
      );
    }

    const hostileKey = Proxy.revocable({}, {});
    hostileKey.revoke();
    await expect(
      createArtifactCacheRecord(
        hostileKey.proxy as KernelShapeArtifactCacheKey,
        new Uint8Array([1]),
      ),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      validateArtifactCacheRecord(
        hostileKey.proxy as KernelShapeArtifactCacheKey,
        record.value,
      ),
    ).resolves.toMatchObject({ ok: false });
  });

  it("enforces aggregate session budgets under concurrent calls", async () => {
    const firstKey = await keyValue({ node: "first" });
    const secondKey = await keyValue({ node: "second" });
    const firstRecord = await createArtifactCacheRecord(
      firstKey,
      new Uint8Array([1, 2, 3]),
    );
    const secondRecord = await createArtifactCacheRecord(
      secondKey,
      new Uint8Array([4, 5, 6]),
    );
    if (!firstRecord.ok || !secondRecord.ok) {
      throw new Error("Expected records");
    }

    const writeStore = new MemoryArtifactCacheStore();
    const writeSession = createArtifactCacheSession({
      store: writeStore,
      limits: { maxTotalWriteBytes: 5 },
    });
    expect(writeSession.ok).toBe(true);
    if (!writeSession.ok) throw new Error("Expected session");
    const writes = await Promise.all([
      writeSession.value.write(firstRecord.value),
      writeSession.value.write(secondRecord.value),
    ]);
    expect(writes.map((item) => item.ok)).toEqual([true, false]);
    expect(writeStore.size).toBe(1);
    expect(writeSession.value.usage).toEqual({
      operations: 2,
      readBytes: 0,
      writeBytes: 3,
    });
    expect(Object.isFrozen(writeSession.value.usage)).toBe(true);

    const readStore = new MemoryArtifactCacheStore();
    expect((await writeArtifactCacheRecord(readStore, firstRecord.value)).ok).toBe(
      true,
    );
    expect((await writeArtifactCacheRecord(readStore, secondRecord.value)).ok).toBe(
      true,
    );
    const readSession = createArtifactCacheSession({
      store: readStore,
      limits: { maxTotalReadBytes: 5 },
    });
    if (!readSession.ok) throw new Error("Expected session");
    const reads = await Promise.all([
      readSession.value.read(firstKey),
      readSession.value.read(secondKey),
    ]);
    expect(reads.map((item) => item.ok)).toEqual([true, false]);
    expect(readSession.value.usage).toEqual({
      operations: 2,
      readBytes: 3,
      writeBytes: 0,
    });

    const oneOperation = createArtifactCacheSession({
      store: new MemoryArtifactCacheStore(),
      limits: { maxOperations: 1 },
    });
    if (!oneOperation.ok) throw new Error("Expected session");
    expect((await oneOperation.value.delete(firstKey)).ok).toBe(true);
    const overOperationLimit = await oneOperation.value.delete(secondKey);
    expect(overOperationLimit.ok).toBe(false);
    expect(oneOperation.value.usage.operations).toBe(1);
    expectTypeOf(writeSession.value).toEqualTypeOf<ArtifactCacheSession>();
  });

  it("returns queued cancellation without letting later work overtake", async () => {
    const key = await keyValue();
    let startFirst = (): void => {};
    const firstStarted = new Promise<void>((resolve) => {
      startFirst = resolve;
    });
    let releaseFirst = (): void => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    const store: ArtifactCacheStore = {
      read: async () => {
        calls.push("read-start");
        startFirst();
        await firstGate;
        calls.push("read-end");
        return undefined;
      },
      write: () => {},
      delete: () => {
        calls.push("delete");
      },
    };
    const session = createArtifactCacheSession({ store });
    if (!session.ok) throw new Error("Expected session");
    const first = session.value.read(key);
    await firstStarted;

    const controller = new AbortController();
    const queued = session.value.delete(key, { signal: controller.signal });
    controller.abort();
    const prompt = await Promise.race([
      queued.then((result) => ({ kind: "result" as const, result })),
      new Promise<{ readonly kind: "timeout" }>((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" }), 100);
      }),
    ]);
    expect(prompt.kind).toBe("result");
    if (prompt.kind === "result") {
      expect(prompt.result.ok).toBe(false);
      if (!prompt.result.ok) {
        expect(prompt.result.diagnostics[0]?.code).toBe("EVALUATION_ABORTED");
      }
    }
    expect(calls).toEqual(["read-start"]);
    releaseFirst();
    expect((await first).ok).toBe(true);
    await Promise.resolve();
    expect(calls).toEqual(["read-start", "read-end"]);

    let abortedReads = 0;
    let removedListeners = 0;
    let registeredListener: (() => void) | undefined;
    const hostileSignal = {
      get aborted() {
        abortedReads += 1;
        if (abortedReads === 1) return false;
        throw new Error("hostile aborted getter");
      },
      addEventListener(_type: string, listener: () => void) {
        registeredListener = listener;
      },
      removeEventListener(_type: string, listener: () => void) {
        if (registeredListener === listener) removedListeners += 1;
      },
    } as unknown as AbortSignal;
    const hostile = await session.value.delete(key, { signal: hostileSignal });
    expect(hostile.ok).toBe(false);
    if (!hostile.ok) {
      expect(hostile.diagnostics[0]?.code).toBe(
        "ARTIFACT_CACHE_OPERATION_FAILED",
      );
    }
    expect(removedListeners).toBe(1);
    expect(calls).toEqual(["read-start", "read-end"]);
  });

  it("honors session modes and isolates event-listener failures", async () => {
    const key = await keyValue();
    const record = await createArtifactCacheRecord(
      key,
      new Uint8Array([1, 2]),
    );
    if (!record.ok) throw new Error("Expected record");
    const events: ArtifactCacheEvent[] = [];
    const store = new MemoryArtifactCacheStore();
    const session = createArtifactCacheSession({
      store,
      mode: "write-only",
      onEvent: async (event) => {
        events.push(event);
        throw new Error("listener failure");
      },
    });
    if (!session.ok) throw new Error("Expected session");
    expect((await session.value.write(record.value)).ok).toBe(true);
    expect(store.size).toBe(1);
    const bypassed = await session.value.read(key);
    expect(bypassed).toMatchObject({ ok: true, value: { status: "miss" } });
    expect(events.map((event) => event.kind)).toEqual(["write", "bypass"]);
    expect(session.value.usage.operations).toBe(1);

    const readOnly = createArtifactCacheSession({
      store,
      mode: "read-only",
    });
    if (!readOnly.ok) throw new Error("Expected session");
    expect((await readOnly.value.write(record.value)).ok).toBe(true);
    expect((await readOnly.value.delete(key)).ok).toBe(true);
    expect(readOnly.value.usage.operations).toBe(0);
  });

  it("deeply snapshots records at the memory-store boundary", async () => {
    const key = await keyValue();
    const created = await createArtifactCacheRecord(
      key,
      new Uint8Array([1, 2, 3]),
    );
    if (!created.ok) throw new Error("Expected record");
    const mutable = structuredClone(created.value) as ArtifactCacheRecordV1;
    const originalDigest = mutable.integrity.digest;
    const store = new MemoryArtifactCacheStore();
    await store.write(mutable, { maxBytes: 10 });
    (mutable.metadata.kernel.artifact as { format: string }).format = "mutated";
    (mutable.integrity as { digest: string }).digest = "f".repeat(64);
    mutable.payload[0] = 99;

    const first = await store.read(key.key, { maxBytes: 10 });
    if (first === undefined) throw new Error("Expected stored record");
    expect(first.metadata.kernel.artifact.format).toBe(
      "invariantcad.test.shape",
    );
    expect(first.integrity.digest).toBe(originalDigest);
    expect([...first.payload]).toEqual([1, 2, 3]);
    expect(Object.isFrozen(first.metadata)).toBe(true);
    expect(Object.isFrozen(first.integrity)).toBe(true);
  });

  it("validates limits and refuses weak feature or solver identities", async () => {
    expect(Object.isFrozen(DEFAULT_ARTIFACT_CACHE_LIMITS)).toBe(true);
    expect(normalizeArtifactCacheLimits({ maxEntryBytes: 1 })).toMatchObject({
      maxEntryBytes: 1,
    });
    expect(normalizeArtifactCacheLimits({ maxEntryBytes: -1 })).toBeUndefined();
    expect(normalizeArtifactCacheLimits({ future: 1 })).toBeUndefined();

    const weakFeature = await createKernelShapeArtifactCacheKey(
      {
        node: "body",
        outputKind: "solid",
        hash: "a".repeat(64) as FeatureHash,
      },
      fakeKernel(),
      createReferenceSketchSolver(),
    );
    expect(weakFeature.ok).toBe(false);
    if (!weakFeature.ok) {
      expect(weakFeature.diagnostics[0]?.code).toBe(
        "ARTIFACT_CACHE_ENTRY_INVALID",
      );
    }
    const solver = createReferenceSketchSolver();
    const weakSolver = await createKernelShapeArtifactCacheKey(
      {
        node: "body",
        outputKind: "solid",
        hash: featureHash("a"),
      },
      fakeKernel(),
      {
        id: "weak-solver",
        capabilities: solver.capabilities,
        solve: solver.solve.bind(solver),
        dispose: () => {},
      },
    );
    expect(weakSolver.ok).toBe(false);
    if (!weakSolver.ok) {
      expect(weakSolver.diagnostics[0]?.code).toBe(
        "KERNEL_CAPABILITY_MISSING",
      );
    }
  });

  it("keeps the public capability descriptor structurally explicit", () => {
    const descriptor: KernelShapeArtifactCapabilities = {
      protocolVersion: 1,
      format: "invariantcad.test.shape",
      formatVersion: 1,
      compatibilityFingerprint: "runtime@1",
    };
    expectTypeOf(descriptor).toEqualTypeOf<KernelShapeArtifactCapabilities>();
    const key = `${ARTIFACT_CACHE_KEY_PREFIX}${"a".repeat(64)}` as ArtifactCacheKey;
    expectTypeOf(key).toEqualTypeOf<ArtifactCacheKey>();
    expectTypeOf<ReturnType<ArtifactCacheStore["read"]>>().toEqualTypeOf<unknown>();
  });
});
