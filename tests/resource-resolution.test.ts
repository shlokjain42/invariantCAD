import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { resourceId, type ResourceId } from "../src/core/ids.js";
import type { CadResult, DiagnosticCode } from "../src/core/result.js";
import type {
  ResourceDefinitionIR,
  ResourceDigestIR,
} from "../src/ir.js";
import {
  DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
  normalizeResourceResolutionLimitsV7,
  resolveResourcesV7,
  type ResolvedResourcesV7,
  type ResourceResolverRequestV7,
} from "../src/resource-resolution.js";

async function digest(bytes: Uint8Array): Promise<ResourceDigestIR> {
  const result = await globalThis.crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes),
  );
  return `sha256:${[...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function definition(
  bytes: Uint8Array,
  overrides: Partial<ResourceDefinitionIR> = {},
): Promise<ResourceDefinitionIR> {
  return {
    digest: await digest(bytes),
    byteLength: bytes.byteLength,
    mediaType: "application/octet-stream",
    ...overrides,
  };
}

function resources(
  entries: readonly [ResourceId, ResourceDefinitionIR][],
): Readonly<Record<string, ResourceDefinitionIR>> {
  return Object.fromEntries(entries);
}

function resolvedValue(
  result: CadResult<ResolvedResourcesV7>,
): ResolvedResourcesV7 {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message ?? "Resolution failed");
  }
  return result.value;
}

function expectFailure(
  result: CadResult<ResolvedResourcesV7>,
  code: DiagnosticCode,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected resource resolution to fail");
  expect(result.diagnostics[0]?.code).toBe(code);
}

describe("staged v7 resource resolution", () => {
  it("normalizes immutable closed resource limits", () => {
    expect(Object.isFrozen(DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7)).toBe(true);
    expect(DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7).toEqual({
      maxResolvedResources: 1_024,
      maxResourceBytes: 64 * 1024 * 1024,
      maxTotalResourceBytes: 256 * 1024 * 1024,
    });
    expect(normalizeResourceResolutionLimitsV7(undefined)).toBe(
      DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
    );
    const normalized = normalizeResourceResolutionLimitsV7({
      maxResourceBytes: 7,
    });
    expect(normalized).toEqual({
      ...DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
      maxResourceBytes: 7,
    });
    expect(Object.isFrozen(normalized)).toBe(true);

    for (const malformed of [
      null,
      [],
      { unknown: 1 },
      { maxResolvedResources: -1 },
      { maxResourceBytes: 1.5 },
      { maxTotalResourceBytes: Number.POSITIVE_INFINITY },
      { maxTotalResourceBytes: BigInt(1) },
    ]) {
      expect(normalizeResourceResolutionLimitsV7(malformed)).toBeUndefined();
    }
    const hostile = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("unreadable");
        },
      },
    );
    expect(normalizeResourceResolutionLimitsV7(hostile)).toBeUndefined();
  });

  it("resolves distinct IDs once in lexical order with detached frozen requests", async () => {
    const alpha = resourceId("alpha");
    const zeta = resourceId("zeta");
    const alphaBytes = new Uint8Array([1, 2, 3]);
    const zetaBytes = new Uint8Array([4, 5]);
    const alphaLocations = ["memory:alpha"];
    const zetaLocations = ["memory:zeta"];
    const definitions = {
      [zeta]: await definition(zetaBytes, { locations: zetaLocations }),
      [alpha]: await definition(alphaBytes, {
        locations: alphaLocations,
        metadata: { ignoredByResolver: true },
      }),
    };
    const seen: ResourceResolverRequestV7[] = [];
    const result = await resolveResourcesV7(
      definitions,
      [zeta, alpha, zeta],
      {
        resolver: (request) => {
          seen.push(request);
          expect(Object.isFrozen(request)).toBe(true);
          expect(Object.isFrozen(request.locations)).toBe(true);
          expect(Object.keys(request).sort()).toEqual([
            "byteLength",
            "digest",
            "id",
            "locations",
            "mediaType",
          ]);
          if (request.id === alpha) {
            zetaLocations[0] = "memory:mutated";
            return alphaBytes;
          }
          return zetaBytes.buffer.slice(0);
        },
      },
    );
    const value = resolvedValue(result);
    expect(seen.map((request) => request.id)).toEqual([alpha, zeta]);
    expect(seen[0]?.locations).not.toBe(alphaLocations);
    expect(seen[1]?.locations).toEqual(["memory:zeta"]);
    expect(value.ids).toEqual([alpha, zeta]);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.ids)).toBe(true);
    expect(value.has(alpha)).toBe(true);
    expect(value.has(resourceId("missing"))).toBe(false);
    expect(value.byteLength(zeta)).toBe(2);
    expect(value.byteLength(resourceId("missing"))).toBeUndefined();
    expect([...value.read(alpha)!]).toEqual([1, 2, 3]);

    const firstRead = value.read(alpha)!;
    firstRead[0] = 99;
    expect([...value.read(alpha)!]).toEqual([1, 2, 3]);
    expect(value.read(alpha)).not.toBe(value.read(alpha));

    const originalSlice = Uint8Array.prototype.slice;
    try {
      Object.defineProperty(Uint8Array.prototype, "slice", {
        configurable: true,
        writable: true,
        value: function (): Uint8Array {
          return this as Uint8Array;
        },
      });
      const hardenedRead = value.read(alpha)!;
      hardenedRead[1] = 88;
      expect([...value.read(alpha)!]).toEqual([1, 2, 3]);
    } finally {
      Object.defineProperty(Uint8Array.prototype, "slice", {
        configurable: true,
        writable: true,
        value: originalSlice,
      });
    }
  });

  it("copies synchronous resolver bytes before application mutation can race hashing", async () => {
    const id = resourceId("source");
    const source = new Uint8Array([10, 20, 30]);
    const resultPromise = resolveResourcesV7(
      resources([[id, await definition(source)]]),
      [id],
      {
        resolver: () => {
          queueMicrotask(() => {
            source[0] = 255;
          });
          return source;
        },
      },
    );
    const value = resolvedValue(await resultPromise);
    expect([...value.read(id)!]).toEqual([10, 20, 30]);
    expect(source[0]).toBe(255);
  });

  it("accepts cross-realm ArrayBuffer and Uint8Array values", async () => {
    const arrayId = resourceId("crossArray");
    const bufferId = resourceId("crossBuffer");
    const array = runInNewContext("new Uint8Array([7, 8, 9])") as Uint8Array;
    const buffer = runInNewContext(
      "new Uint8Array([10, 11]).buffer",
    ) as ArrayBuffer;
    const result = await resolveResourcesV7(
      resources([
        [arrayId, await definition(new Uint8Array([7, 8, 9]))],
        [bufferId, await definition(new Uint8Array([10, 11]))],
      ]),
      [bufferId, arrayId],
      {
        resolver: ({ id }) => (id === arrayId ? array : buffer),
      },
    );
    const value = resolvedValue(result);
    expect([...value.read(arrayId)!]).toEqual([7, 8, 9]);
    expect([...value.read(bufferId)!]).toEqual([10, 11]);
  });

  it("accepts valid zero-length buffers without confusing them with detached buffers", async () => {
    const id = resourceId("empty");
    const bytes = new Uint8Array();
    const result = await resolveResourcesV7(
      resources([[id, await definition(bytes)]]),
      [id],
      { resolver: () => new ArrayBuffer(0) },
    );
    expect(resolvedValue(result).read(id)).toEqual(new Uint8Array());
  });

  it("copies only the returned Uint8Array view rather than its full backing buffer", async () => {
    const id = resourceId("subarray");
    const expected = new Uint8Array([2, 3]);
    const backing = new Uint8Array([1, 2, 3, 4]);
    const result = await resolveResourcesV7(
      resources([[id, await definition(expected)]]),
      [id],
      { resolver: () => backing.subarray(1, 3) },
    );
    expect([...resolvedValue(result).read(id)!]).toEqual([2, 3]);
  });

  it("succeeds without a resolver for an empty request and requires one otherwise", async () => {
    const empty = await resolveResourcesV7({}, []);
    expect(resolvedValue(empty).ids).toEqual([]);

    const id = resourceId("needed");
    const missing = await resolveResourcesV7(
      resources([[id, await definition(new Uint8Array([1]))]]),
      [id],
    );
    expectFailure(missing, "RESOURCE_RESOLVER_MISSING");
  });

  it("rejects missing definitions before invoking the resolver", async () => {
    const resolver = vi.fn(() => new Uint8Array());
    const result = await resolveResourcesV7(
      {},
      [resourceId("missing")],
      { resolver },
    );
    expectFailure(result, "REFERENCE_MISSING");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("rejects malformed options, requested IDs, and definitions safely", async () => {
    const id = resourceId("resource");
    const valid = await definition(new Uint8Array([1]));
    const cases: readonly [
      Readonly<Record<string, ResourceDefinitionIR>>,
      readonly ResourceId[],
      unknown,
    ][] = [
      [resources([[id, valid]]), [id], { resolver: 1 }],
      [resources([[id, valid]]), [id], { unknown: true }],
      [resources([[id, valid]]), [id], { limits: { maxResourceBytes: -1 } }],
      [resources([[id, valid]]), [id], { signal: {} }],
      [
        resources([[id, valid]]),
        [id],
        Object.assign(Object.create(null), { resolver: "invalid" }),
      ],
    ];
    for (const [definitions, ids, options] of cases) {
      const result = await resolveResourcesV7(
        definitions,
        ids,
        options as never,
      );
      expectFailure(result, "IR_INVALID");
    }

    const sparse = new Array<ResourceId>(1);
    expectFailure(
      await resolveResourcesV7({}, sparse),
      "IR_INVALID",
    );
    expectFailure(
      await resolveResourcesV7(
        { [id]: { ...valid, digest: "sha256:BAD" } },
        [id],
        { resolver: () => new Uint8Array([1]) },
      ),
      "IR_INVALID",
    );
    expectFailure(
      await resolveResourcesV7(
        { [id]: { ...valid, byteLength: Number.MAX_VALUE } },
        [id],
        { resolver: () => new Uint8Array([1]) },
      ),
      "IR_INVALID",
    );
    expectFailure(
      await resolveResourcesV7(
        { [id]: { ...valid, mediaType: " invalid " } },
        [id],
        { resolver: () => new Uint8Array([1]) },
      ),
      "IR_INVALID",
    );
    expectFailure(
      await resolveResourcesV7(
        { [id]: { ...valid, locations: ["same", "same"] } },
        [id],
        { resolver: () => new Uint8Array([1]) },
      ),
      "IR_INVALID",
    );
  });

  it("reads option and definition properties once before the first callback", async () => {
    const id = resourceId("captured");
    const bytes = new Uint8Array([1, 2]);
    const stored = await definition(bytes);
    const reads = new Map<string, number>();
    const tracked = Object.fromEntries(
      Object.entries(stored).map(([key, value]) => [
        key,
        {
          enumerable: true,
          get: () => {
            reads.set(key, (reads.get(key) ?? 0) + 1);
            return value;
          },
        },
      ]),
    );
    const trackedDefinition = Object.defineProperties({}, tracked);
    let resolverReads = 0;
    const resolver = () => bytes;
    const options = Object.defineProperty({}, "resolver", {
      enumerable: true,
      get: () => {
        resolverReads += 1;
        return resolver;
      },
    });
    const result = await resolveResourcesV7(
      { [id]: trackedDefinition as ResourceDefinitionIR },
      [id],
      options,
    );
    resolvedValue(result);
    expect(resolverReads).toBe(1);
    expect(Object.fromEntries(reads)).toEqual({
      digest: 1,
      byteLength: 1,
      mediaType: 1,
    });
  });

  it("does not inspect or expose resource metadata", async () => {
    const id = resourceId("metadata");
    const bytes = new Uint8Array([5]);
    const stored = await definition(bytes);
    const definitionWithHostileMetadata = Object.defineProperties(
      {},
      {
        digest: { enumerable: true, value: stored.digest },
        byteLength: { enumerable: true, value: stored.byteLength },
        mediaType: { enumerable: true, value: stored.mediaType },
        metadata: {
          enumerable: true,
          get: () => {
            throw new Error("metadata must remain outside resolution");
          },
        },
      },
    ) as ResourceDefinitionIR;
    let requestKeys: readonly string[] = [];
    const result = await resolveResourcesV7(
      { [id]: definitionWithHostileMetadata },
      [id],
      {
        resolver: (request) => {
          requestKeys = Object.keys(request);
          return bytes;
        },
      },
    );
    resolvedValue(result);
    expect(requestKeys).not.toContain("metadata");
  });

  it("maps resolver throws and rejections to opaque structured failures", async () => {
    const id = resourceId("failure");
    const definitions = resources([
      [id, await definition(new Uint8Array([1]))],
    ]);
    for (const resolver of [
      () => {
        throw new Error("SECRET_LOCATION_OR_BYTES");
      },
      () => Promise.reject(new Error("SECRET_LOCATION_OR_BYTES")),
    ]) {
      const result = await resolveResourcesV7(definitions, [id], {
        resolver,
      });
      expectFailure(result, "RESOURCE_RESOLUTION_FAILED");
      if (!result.ok) {
        expect(JSON.stringify(result.diagnostics)).not.toContain("SECRET");
      }
    }
  });

  it("rejects unsupported, shared, proxied, and detached resolver values", async () => {
    const ordinary = new Uint8Array([1, 2, 3, 4]);
    const id = resourceId("invalidBytes");
    const ordinaryDefinition = resources([
      [id, await definition(ordinary)],
    ]);
    const detached = new ArrayBuffer(0);
    structuredClone(detached, { transfer: [detached] });
    const shared = new SharedArrayBuffer(ordinary.byteLength);
    new Uint8Array(shared).set(ordinary);
    const candidates: readonly unknown[] = [
      "bytes",
      new Blob([ordinary]),
      new Response(ordinary),
      new DataView(ordinary.buffer),
      new Uint16Array([1, 2]),
      shared,
      new Uint8Array(shared),
      new Proxy(ordinary, {}),
    ];
    for (const candidate of candidates) {
      const result = await resolveResourcesV7(
        ordinaryDefinition,
        [id],
        {
          resolver: () =>
            candidate as unknown as Uint8Array,
        },
      );
      expectFailure(result, "RESOURCE_RESOLUTION_FAILED");
    }

    const emptyDefinition = resources([
      [id, await definition(new Uint8Array())],
    ]);
    const detachedResult = await resolveResourcesV7(
      emptyDefinition,
      [id],
      { resolver: () => detached },
    );
    expectFailure(detachedResult, "RESOURCE_RESOLUTION_FAILED");
  });

  it("checks exact byte length and SHA-256 commitments", async () => {
    const id = resourceId("integrity");
    const expected = new Uint8Array([1, 2, 3]);
    const definitions = resources([[id, await definition(expected)]]);
    for (const returned of [
      new Uint8Array([1, 2]),
      new Uint8Array([1, 2, 3, 4]),
    ]) {
      const result = await resolveResourcesV7(definitions, [id], {
        resolver: () => returned,
      });
      expectFailure(result, "RESOURCE_INTEGRITY_MISMATCH");
      if (!result.ok) {
        expect(result.diagnostics[0]?.details).toMatchObject({
          expectedByteLength: 3,
          actualByteLength: returned.byteLength,
        });
      }
    }
    const digestMismatch = await resolveResourcesV7(definitions, [id], {
      resolver: () => new Uint8Array([3, 2, 1]),
    });
    expectFailure(digestMismatch, "RESOURCE_INTEGRITY_MISMATCH");
  });

  it("preflights distinct count, individual bytes, and aggregate bytes before callbacks", async () => {
    const first = resourceId("first");
    const second = resourceId("second");
    const oneByte = new Uint8Array([1]);
    const definitions = resources([
      [first, await definition(oneByte)],
      [second, await definition(oneByte)],
    ]);
    const resolver = vi.fn(() => oneByte);

    const count = await resolveResourcesV7(
      definitions,
      [second, first, second],
      {
        resolver,
        limits: {
          maxResolvedResources: 1,
          maxResourceBytes: 1,
          maxTotalResourceBytes: 2,
        },
      },
    );
    expectFailure(count, "RESOURCE_LIMIT_EXCEEDED");
    expect(resolver).not.toHaveBeenCalled();

    const individual = await resolveResourcesV7(definitions, [first], {
      resolver,
      limits: {
        maxResolvedResources: 1,
        maxResourceBytes: 0,
        maxTotalResourceBytes: 1,
      },
    });
    expectFailure(individual, "RESOURCE_LIMIT_EXCEEDED");
    expect(resolver).not.toHaveBeenCalled();

    const aggregate = await resolveResourcesV7(
      definitions,
      [first, second],
      {
        resolver,
        limits: {
          maxResolvedResources: 2,
          maxResourceBytes: 1,
          maxTotalResourceBytes: 1,
        },
      },
    );
    expectFailure(aggregate, "RESOURCE_LIMIT_EXCEEDED");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("uses subtraction-based aggregate preflight without unsafe integer addition", async () => {
    const huge = resourceId("huge");
    const extra = resourceId("extra");
    const emptyDigest = await digest(new Uint8Array());
    const definitions = resources([
      [
        huge,
        {
          digest: emptyDigest,
          byteLength: Number.MAX_SAFE_INTEGER,
          mediaType: "application/octet-stream",
        },
      ],
      [
        extra,
        {
          digest: emptyDigest,
          byteLength: 1,
          mediaType: "application/octet-stream",
        },
      ],
    ]);
    const resolver = vi.fn(() => new Uint8Array());
    const result = await resolveResourcesV7(
      definitions,
      [huge, extra],
      {
        resolver,
        limits: {
          maxResolvedResources: 2,
          maxResourceBytes: Number.MAX_SAFE_INTEGER,
          maxTotalResourceBytes: Number.MAX_SAFE_INTEGER,
        },
      },
    );
    expectFailure(result, "RESOURCE_LIMIT_EXCEEDED");
    expect(resolver).not.toHaveBeenCalled();
    if (!result.ok) {
      expect(result.diagnostics[0]?.details).toMatchObject({
        resource: "maxTotalResourceBytes",
      });
    }
  });

  it("enforces actual byte ceilings before integrity checks or copying", async () => {
    const id = resourceId("actualLimit");
    const expected = new Uint8Array([1]);
    const result = await resolveResourcesV7(
      resources([[id, await definition(expected)]]),
      [id],
      {
        resolver: () => new Uint8Array([1, 2, 3]),
        limits: {
          maxResolvedResources: 1,
          maxResourceBytes: 2,
          maxTotalResourceBytes: 2,
        },
      },
    );
    expectFailure(result, "RESOURCE_LIMIT_EXCEEDED");
  });

  it("allows exact individual and aggregate boundaries", async () => {
    const first = resourceId("boundaryA");
    const second = resourceId("boundaryB");
    const firstBytes = new Uint8Array([1, 2]);
    const secondBytes = new Uint8Array([3, 4]);
    const result = await resolveResourcesV7(
      resources([
        [first, await definition(firstBytes)],
        [second, await definition(secondBytes)],
      ]),
      [second, first],
      {
        resolver: ({ id }) => (id === first ? firstBytes : secondBytes),
        limits: {
          maxResolvedResources: 2,
          maxResourceBytes: 2,
          maxTotalResourceBytes: 4,
        },
      },
    );
    expect(resolvedValue(result).ids).toEqual([first, second]);
  });

  it("does not invoke a resolver for a pre-aborted operation", async () => {
    const id = resourceId("preAbort");
    const bytes = new Uint8Array([1]);
    const controller = new AbortController();
    controller.abort();
    const resolver = vi.fn(() => bytes);
    const result = await resolveResourcesV7(
      resources([[id, await definition(bytes)]]),
      [id],
      { resolver, signal: controller.signal },
    );
    expectFailure(result, "EVALUATION_ABORTED");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("stops waiting when a pending resolver is aborted", async () => {
    const id = resourceId("pendingAbort");
    const bytes = new Uint8Array([1, 2, 3]);
    const controller = new AbortController();
    let settle = (_value: Uint8Array): void => {};
    const pending = new Promise<Uint8Array>((resolve) => {
      settle = resolve;
    });
    const resolver = vi.fn(() => pending);
    const resolution = resolveResourcesV7(
      resources([[id, await definition(bytes)]]),
      [id],
      { resolver, signal: controller.signal },
    );
    await Promise.resolve();
    controller.abort();
    const result = await resolution;
    expectFailure(result, "EVALUATION_ABORTED");
    expect(resolver).toHaveBeenCalledOnce();
    settle(bytes);
    await Promise.resolve();
  });

  it("does not continue to later resources after cancellation becomes visible", async () => {
    const first = resourceId("abortA");
    const second = resourceId("abortB");
    const bytes = new Uint8Array([1]);
    const controller = new AbortController();
    const seen: ResourceId[] = [];
    const result = await resolveResourcesV7(
      resources([
        [first, await definition(bytes)],
        [second, await definition(bytes)],
      ]),
      [second, first],
      {
        signal: controller.signal,
        resolver: ({ id }) => {
          seen.push(id);
          controller.abort();
          return bytes;
        },
      },
    );
    expectFailure(result, "EVALUATION_ABORTED");
    expect(seen).toEqual([first]);
  });

  it("supports generic promise-like resolver results", async () => {
    const id = resourceId("thenable");
    const bytes = new Uint8Array([8, 9]);
    const result = await resolveResourcesV7(
      resources([[id, await definition(bytes)]]),
      [id],
      {
        resolver: () =>
          ({
            then: (
              onfulfilled: (value: Uint8Array) => unknown,
            ): void => {
              queueMicrotask(() => onfulfilled(bytes));
            },
          }) as unknown as PromiseLike<Uint8Array>,
      },
    );
    expect([...resolvedValue(result).read(id)!]).toEqual([8, 9]);
  });
});
