import { describe, expect, it, vi } from "vitest";
import { resourceId, type ResourceId } from "../src/core/ids.js";
import type {
  CadResult,
  DiagnosticCode,
} from "../src/core/result.js";
import {
  createDocumentV7ResourceResolutionSession,
  type DocumentV7ResourceResolutionBatch,
  type DocumentV7ResourceResolutionSession,
  type ResolvedDocumentResourcesV7,
} from "../src/internal/document-v7-resource-resolution-session.js";
import type {
  ResourceDefinitionIR,
  ResourceDigestIR,
} from "../src/ir.js";
import {
  resolveResourcesV7,
  type DocumentV7ResourceScope,
  type ResourceResolverRequestV7,
} from "../src/resource-resolution.js";

async function digest(
  bytes: Uint8Array,
): Promise<ResourceDigestIR> {
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

function registry(
  entries: readonly [ResourceId, ResourceDefinitionIR][],
): Readonly<Record<string, ResourceDefinitionIR>> {
  return Object.fromEntries(entries);
}

function rootScope(): DocumentV7ResourceScope {
  return { source: "root" };
}

function externalScope(
  resource: ResourceId,
  value: ResourceDigestIR,
): DocumentV7ResourceScope {
  return {
    source: "external",
    resource,
    digest: value,
  };
}

function sessionValue(
  result: CadResult<DocumentV7ResourceResolutionSession>,
): DocumentV7ResourceResolutionSession {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message ?? "Session failed");
  }
  return result.value;
}

function resolvedValue(
  result: CadResult<ResolvedDocumentResourcesV7>,
): ResolvedDocumentResourcesV7 {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message ?? "Resolution failed");
  }
  return result.value;
}

function expectFailure<T>(
  result: CadResult<T>,
  code: DiagnosticCode,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected operation to fail");
  expect(result.diagnostics[0]?.code).toBe(code);
}

describe("document v7 resource-resolution session", () => {
  it("keeps ordinary resolver requests unscoped", async () => {
    const id = resourceId("ordinary");
    const bytes = new Uint8Array([1]);
    let request: ResourceResolverRequestV7 | undefined;
    const result = await resolveResourcesV7(
      registry([[id, await definition(bytes)]]),
      [id],
      {
        resolver: (value) => {
          request = value;
          return bytes;
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(request).toBeDefined();
    expect("documentScope" in request!).toBe(false);
  });

  it("resolves two cumulative phases in lexical scope/id order with caller-visible frozen scopes", async () => {
    const documentId = resourceId("childDocument");
    const childRegistryId = resourceId("childRegistry");
    const shared = resourceId("sharedGeometry");
    const documentBytes = new Uint8Array([1, 2, 3]);
    const rootBytes = new Uint8Array([4, 5]);
    const childBytes = new Uint8Array([6, 7, 8, 9]);
    const childDocumentDefinition = await definition(documentBytes);
    const rootDefinition = await definition(rootBytes);
    const childDefinition = await definition(childBytes);
    const root = rootScope();
    const child = externalScope(
      childRegistryId,
      childDocumentDefinition.digest,
    );
    const seen: ResourceResolverRequestV7[] = [];
    const session = sessionValue(
      createDocumentV7ResourceResolutionSession({
        resolver: (request) => {
          seen.push(request);
          expect(Object.isFrozen(request)).toBe(true);
          expect(Object.isFrozen(request.documentScope)).toBe(true);
          if (request.id === documentId) return documentBytes;
          return request.documentScope?.source === "external"
            ? childBytes
            : rootBytes;
        },
        limits: {
          maxRequestedResourceIds: 3,
          maxResolvedResources: 3,
          maxResourceBytes: 4,
          maxTotalResourceBytes: 9,
        },
      }),
    );

    const first = resolvedValue(
      await session.resolve([
        {
          scope: root,
          definitions: registry([
            [documentId, childDocumentDefinition],
          ]),
          ids: [documentId],
        },
      ]),
    );
    expect(first.scopes).toEqual([{ source: "root" }]);
    expect(first.scopes[0]).not.toBe(root);
    expect(first.read(root, documentId)).toEqual(documentBytes);
    expect(first.has(root, shared)).toBe(false);

    const second = resolvedValue(
      await session.resolve([
        {
          scope: root,
          definitions: registry([
            [shared, rootDefinition],
            [documentId, childDocumentDefinition],
          ]),
          ids: [shared, documentId],
        },
        {
          scope: child,
          definitions: registry([[shared, childDefinition]]),
          ids: [shared],
        },
      ]),
    );

    expect(
      seen.map((request) => [
        request.documentScope?.source,
        request.id,
      ]),
    ).toEqual([
      ["root", documentId],
      ["external", shared],
      ["root", shared],
    ]);
    expect(second.scopes).toEqual([child, root]);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.scopes)).toBe(true);
    expect(second.read(root, documentId)).toEqual(documentBytes);
    expect(second.read(root, shared)).toEqual(rootBytes);
    expect(second.read(child, shared)).toEqual(childBytes);
    expect(second.byteLength(child, shared)).toBe(4);
    expect(second.forScope(root)?.ids).toEqual([
      documentId,
      shared,
    ]);

    const changed = second.read(child, shared)!;
    changed[0] = 255;
    expect(second.read(child, shared)).toEqual(childBytes);
    expect(first.has(root, shared)).toBe(false);
    expect(first.read(root, documentId)).toEqual(documentBytes);
  });

  it("treats repeated IDs in one scope as free while the same ID in another scope is distinct", async () => {
    const shared = resourceId("sameId");
    const other = resourceId("overBudget");
    const childId = resourceId("childDocument");
    const bytes = new Uint8Array([7]);
    const stored = await definition(bytes);
    const child = externalScope(childId, stored.digest);
    const resolver = vi.fn(() => bytes);
    const session = sessionValue(
      createDocumentV7ResourceResolutionSession({
        resolver,
        limits: {
          maxRequestedResourceIds: 2,
          maxResolvedResources: 2,
          maxResourceBytes: 1,
          maxTotalResourceBytes: 2,
        },
      }),
    );

    resolvedValue(
      await session.resolve([
        {
          scope: rootScope(),
          definitions: registry([[shared, stored]]),
          ids: [shared, shared],
        },
      ]),
    );
    const cumulative = resolvedValue(
      await session.resolve([
        {
          scope: rootScope(),
          definitions: registry([[shared, stored]]),
          ids: [shared],
        },
        {
          scope: child,
          definitions: registry([[shared, stored]]),
          ids: [shared],
        },
      ]),
    );
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(cumulative.read(rootScope(), shared)).toEqual(bytes);
    expect(cumulative.read(child, shared)).toEqual(bytes);

    const exhausted = await session.resolve([
      {
        scope: rootScope(),
        definitions: registry([[other, stored]]),
        ids: [other],
      },
    ]);
    expectFailure(exhausted, "RESOURCE_LIMIT_EXCEEDED");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("preflights every later batch and aggregate commitment before the first callback", async () => {
    const first = resourceId("first");
    const second = resourceId("second");
    const bytes = new Uint8Array([1, 2]);
    const stored = await definition(bytes);
    const resolver = vi.fn(() => bytes);
    const session = sessionValue(
      createDocumentV7ResourceResolutionSession({
        resolver,
        limits: {
          maxRequestedResourceIds: 2,
          maxResolvedResources: 2,
          maxResourceBytes: 2,
          maxTotalResourceBytes: 3,
        },
      }),
    );
    const aggregate = await session.resolve([
      {
        scope: rootScope(),
        definitions: registry([[first, stored]]),
        ids: [first],
      },
      {
        scope: externalScope(resourceId("child"), stored.digest),
        definitions: registry([[second, stored]]),
        ids: [second],
      },
    ]);
    expectFailure(aggregate, "RESOURCE_LIMIT_EXCEEDED");
    expect(resolver).not.toHaveBeenCalled();

    let scopeReads = 0;
    const accessorBatch = Object.defineProperties(
      {},
      {
        scope: {
          enumerable: true,
          get: () => {
            scopeReads += 1;
            return rootScope();
          },
        },
        definitions: {
          enumerable: true,
          value: registry([[second, stored]]),
        },
        ids: { enumerable: true, value: [second] },
      },
    ) as DocumentV7ResourceResolutionBatch;
    const malformed = await session.resolve([
      {
        scope: rootScope(),
        definitions: registry([[first, stored]]),
        ids: [first],
      },
      accessorBatch,
    ]);
    expectFailure(malformed, "IR_INVALID");
    expect(scopeReads).toBe(0);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("enforces each global session limit before callbacks", async () => {
    const first = resourceId("limitA");
    const second = resourceId("limitB");
    const one = new Uint8Array([1]);
    const two = new Uint8Array([1, 2]);
    const oneDefinition = await definition(one);
    const twoDefinition = await definition(two);

    for (const limits of [
      {
        maxRequestedResourceIds: 1,
        maxResolvedResources: 2,
        maxResourceBytes: 1,
        maxTotalResourceBytes: 2,
      },
      {
        maxRequestedResourceIds: 2,
        maxResolvedResources: 1,
        maxResourceBytes: 1,
        maxTotalResourceBytes: 2,
      },
    ]) {
      const resolver = vi.fn(() => one);
      const session = sessionValue(
        createDocumentV7ResourceResolutionSession({
          resolver,
          limits,
        }),
      );
      resolvedValue(
        await session.resolve([
          {
            scope: rootScope(),
            definitions: registry([[first, oneDefinition]]),
            ids: [first],
          },
        ]),
      );
      const result = await session.resolve([
        {
          scope: rootScope(),
          definitions: registry([[second, oneDefinition]]),
          ids: [second],
        },
      ]);
      expectFailure(result, "RESOURCE_LIMIT_EXCEEDED");
      expect(resolver).toHaveBeenCalledTimes(1);
    }

    const oversizedResolver = vi.fn(() => two);
    const oversized = sessionValue(
      createDocumentV7ResourceResolutionSession({
        resolver: oversizedResolver,
        limits: {
          maxRequestedResourceIds: 1,
          maxResolvedResources: 1,
          maxResourceBytes: 1,
          maxTotalResourceBytes: 2,
        },
      }),
    );
    const oversizedResult = await oversized.resolve([
      {
        scope: rootScope(),
        definitions: registry([[first, twoDefinition]]),
        ids: [first],
      },
    ]);
    expectFailure(oversizedResult, "RESOURCE_LIMIT_EXCEEDED");
    expect(oversizedResolver).not.toHaveBeenCalled();
  });

  it("rejects conflicting cached or planned commitments before I/O", async () => {
    const cached = resourceId("cached");
    const pending = resourceId("pending");
    const firstBytes = new Uint8Array([1]);
    const changedBytes = new Uint8Array([2]);
    const firstDefinition = await definition(firstBytes);
    const changedDefinition = await definition(changedBytes);
    const resolver = vi.fn(() => firstBytes);
    const session = sessionValue(
      createDocumentV7ResourceResolutionSession({ resolver }),
    );
    resolvedValue(
      await session.resolve([
        {
          scope: rootScope(),
          definitions: registry([[cached, firstDefinition]]),
          ids: [cached],
        },
      ]),
    );

    const cachedConflict = await session.resolve([
      {
        scope: rootScope(),
        definitions: registry([
          [cached, changedDefinition],
          [pending, firstDefinition],
        ]),
        ids: [pending, cached],
      },
    ]);
    expectFailure(cachedConflict, "IR_INVALID");
    expect(resolver).toHaveBeenCalledTimes(1);

    const plannedConflict = await session.resolve([
      {
        scope: externalScope(resourceId("child"), firstDefinition.digest),
        definitions: registry([[pending, firstDefinition]]),
        ids: [pending],
      },
      {
        scope: externalScope(resourceId("child"), firstDefinition.digest),
        definitions: registry([[pending, changedDefinition]]),
        ids: [pending],
      },
    ]);
    expectFailure(plannedConflict, "IR_INVALID");
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("does not retain or charge a partially failed transaction", async () => {
    const alpha = resourceId("alpha");
    const beta = resourceId("beta");
    const alphaBytes = new Uint8Array([1]);
    const betaBytes = new Uint8Array([2]);
    const definitions = registry([
      [alpha, await definition(alphaBytes)],
      [beta, await definition(betaBytes)],
    ]);
    let failBeta = true;
    const seen: ResourceId[] = [];
    const session = sessionValue(
      createDocumentV7ResourceResolutionSession({
        resolver: (request) => {
          seen.push(request.id);
          if (request.id === beta && failBeta) {
            throw new Error("private resolver detail");
          }
          return request.id === alpha ? alphaBytes : betaBytes;
        },
        limits: {
          maxRequestedResourceIds: 2,
          maxResolvedResources: 2,
          maxResourceBytes: 1,
          maxTotalResourceBytes: 2,
        },
      }),
    );
    const batch = {
      scope: rootScope(),
      definitions,
      ids: [beta, alpha],
    };
    const failed = await session.resolve([batch]);
    expectFailure(failed, "RESOURCE_RESOLUTION_FAILED");
    expect(JSON.stringify(failed)).not.toContain(
      "private resolver detail",
    );

    failBeta = false;
    const retried = resolvedValue(await session.resolve([batch]));
    expect(seen).toEqual([alpha, beta, alpha, beta]);
    expect(retried.read(rootScope(), alpha)).toEqual(alphaBytes);
    expect(retried.read(rootScope(), beta)).toEqual(betaBytes);
  });

  it("maps opaque throws and rejections to scoped diagnostics", async () => {
    const id = resourceId("opaque");
    const bytes = new Uint8Array([1]);
    const stored = await definition(bytes);
    const child = externalScope(resourceId("child"), stored.digest);
    for (const asynchronous of [false, true]) {
      const revocable = Proxy.revocable({}, {});
      revocable.revoke();
      const session = sessionValue(
        createDocumentV7ResourceResolutionSession({
          resolver: () => {
            if (asynchronous) {
              return Promise.reject(revocable.proxy);
            }
            throw revocable.proxy;
          },
        }),
      );
      const result = await session.resolve([
        {
          scope: child,
          definitions: registry([[id, stored]]),
          ids: [id],
        },
      ]);
      expectFailure(result, "RESOURCE_RESOLUTION_FAILED");
      if (!result.ok) {
        expect(result.diagnostics[0]?.details).toMatchObject({
          documentScope: child,
        });
      }
    }
  });

  it("propagates cancellation while a scoped resolver is pending", async () => {
    const id = resourceId("pending");
    const bytes = new Uint8Array([1]);
    const controller = new AbortController();
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const session = sessionValue(
      createDocumentV7ResourceResolutionSession({
        signal: controller.signal,
        resolver: () => {
          startedResolve!();
          return new Promise<Uint8Array>(() => {});
        },
      }),
    );
    const pending = session.resolve([
      {
        scope: rootScope(),
        definitions: registry([[id, await definition(bytes)]]),
        ids: [id],
      },
    ]);
    await started;
    controller.abort();
    expectFailure(await pending, "EVALUATION_ABORTED");
  });

  it("clears cumulatively retained bytes, invalidates readers, and disposes idempotently", async () => {
    const id = resourceId("lifecycle");
    const bytes = new Uint8Array([3, 4]);
    const stored = await definition(bytes);
    const resolver = vi.fn(() => bytes);
    const session = sessionValue(
      createDocumentV7ResourceResolutionSession({ resolver }),
    );
    const first = resolvedValue(
      await session.resolve([
        {
          scope: rootScope(),
          definitions: registry([[id, stored]]),
          ids: [id],
        },
      ]),
    );
    expect(first.read(rootScope(), id)).toEqual(bytes);

    expect(() => session.clear()).not.toThrow();
    expect(() => session.clear()).not.toThrow();
    expect(first.has(rootScope(), id)).toBe(false);
    expect(first.read(rootScope(), id)).toBeUndefined();
    const afterClear = resolvedValue(
      await session.resolve([
        {
          scope: rootScope(),
          definitions: registry([[id, stored]]),
          ids: [id],
        },
      ]),
    );
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(afterClear.read(rootScope(), id)).toEqual(bytes);

    expect(() => session.dispose()).not.toThrow();
    expect(() => session.dispose()).not.toThrow();
    expect(() => session.clear()).not.toThrow();
    expect(afterClear.read(rootScope(), id)).toBeUndefined();
    const disposed = await session.resolve([]);
    expectFailure(disposed, "IR_INVALID");
  });

  it("rejects concurrent phases instead of racing duplicate callbacks", async () => {
    const id = resourceId("concurrent");
    const bytes = new Uint8Array([1]);
    let complete: ((bytes: Uint8Array) => void) | undefined;
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const session = sessionValue(
      createDocumentV7ResourceResolutionSession({
        resolver: () => {
          startedResolve!();
          return new Promise<Uint8Array>((resolve) => {
            complete = resolve;
          });
        },
      }),
    );
    const batch = {
      scope: rootScope(),
      definitions: registry([[id, await definition(bytes)]]),
      ids: [id],
    };
    const first = session.resolve([batch]);
    await started;
    const overlapping = await session.resolve([batch]);
    expectFailure(overlapping, "IR_INVALID");
    complete!(bytes);
    resolvedValue(await first);
  });
});
