import type {
  ArtifactCacheSession,
  ArtifactCacheSessionOperationOptions,
  KernelShapeArtifactCacheKey,
} from "../artifact-cache.js";
import type { CadResult } from "../core/result.js";
import type { Awaitable } from "../kernel.js";

export interface ArtifactCacheSessionInternalAccess {
  createSibling(): ArtifactCacheSession;
  encodeAndWrite(
    key: KernelShapeArtifactCacheKey,
    options: ArtifactCacheSessionOperationOptions,
    encode: (
      maxArtifactBytes: number,
      limitExceeded: (actualArtifactBytes: number) => never,
    ) => Awaitable<Uint8Array>,
  ): Promise<CadResult<"written" | "bypassed">>;
  reportCodecFailure(
    operation: "decode" | "encode",
    key: KernelShapeArtifactCacheKey,
    result: CadResult<unknown>,
  ): void;
}

const accessBySession = new WeakMap<
  ArtifactCacheSession,
  ArtifactCacheSessionInternalAccess
>();

export function registerArtifactCacheSessionInternalAccess(
  session: ArtifactCacheSession,
  access: ArtifactCacheSessionInternalAccess,
): void {
  if (accessBySession.has(session)) {
    throw new TypeError("Artifact-cache session access is already registered");
  }
  accessBySession.set(session, Object.freeze(access));
}

export function getArtifactCacheSessionInternalAccess(
  session: ArtifactCacheSession,
): ArtifactCacheSessionInternalAccess | undefined {
  return accessBySession.get(session);
}
