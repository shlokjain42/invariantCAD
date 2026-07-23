import {
  ARTIFACT_CACHE_MAX_IDENTITY_BYTES,
  ARTIFACT_CACHE_MAX_SOLVER_FINGERPRINT_BYTES,
  createArtifactCacheSession,
  type ArtifactCacheOptions,
  type ArtifactCacheSession,
} from "../artifact-cache.js";
import { isCanonicalUtf8StringWithin } from "../core/utf8.js";
import {
  diagnostic,
  failure,
  success,
  type CadResult,
} from "../core/result.js";
import type { Evaluator } from "../evaluator.js";
import type { KernelShapeArtifactCapabilities } from "../kernel.js";
import {
  getOcctShapeArtifactCodecCandidate,
  occtShapeArtifactCandidateLimitActual,
  type OcctShapeArtifactCodecCandidate,
} from "./occt-artifact-candidate.js";
import { getArtifactCacheSessionInternalAccess } from "./artifact-cache-session-access.js";

export interface EvaluatorArtifactCacheCandidateBinding {
  readonly artifact: KernelShapeArtifactCapabilities;
  readonly codec: OcctShapeArtifactCodecCandidate;
  limitRefusalActual(
    error: unknown,
    maxArtifactBytes: number,
  ): number | undefined;
  createSession(): ArtifactCacheSession;
}

export interface OcctEvaluatorArtifactCacheCandidateOptions {
  /**
   * v1 record integrity is not authentication. This private experiment accepts
   * only an explicitly trusted, tenant-isolated store.
   */
  readonly trust: "trusted";
  readonly cache: ArtifactCacheOptions;
}

const bindingByEvaluator = new WeakMap<
  object,
  EvaluatorArtifactCacheCandidateBinding
>();

export function getEvaluatorArtifactCacheCandidateBinding(
  evaluator: object,
): EvaluatorArtifactCacheCandidateBinding | undefined {
  return bindingByEvaluator.get(evaluator);
}

/**
 * Enables the repository-private, box-only OCCT evaluator experiment without
 * advertising a production kernel capability or changing the public API.
 */
export function bindOcctEvaluatorArtifactCacheCandidate(
  evaluator: Evaluator,
  options: OcctEvaluatorArtifactCacheCandidateOptions,
): CadResult<void> {
  try {
    if (
      typeof options !== "object" ||
      options === null ||
      Array.isArray(options) ||
      Object.keys(options).sort().join(",") !== "cache,trust" ||
      options.trust !== "trusted"
    ) {
      return failure(
        diagnostic(
          "ARTIFACT_CACHE_ENTRY_INVALID",
          "Private evaluator-cache options require an explicit trusted store",
          { severity: "error" },
        ),
      );
    }
    if (bindingByEvaluator.has(evaluator)) {
      return failure(
        diagnostic(
          "ARTIFACT_CACHE_ENTRY_INVALID",
          "This evaluator already has a private artifact-cache binding",
          { severity: "error" },
        ),
      );
    }
    const candidate = getOcctShapeArtifactCodecCandidate(evaluator.kernel);
    if (candidate === undefined) {
      return failure(
        diagnostic(
          "KERNEL_CAPABILITY_MISSING",
          "The private OCCT shape-artifact candidate is unavailable",
          {
            severity: "error",
            details: {
              kernel: evaluator.kernel.id,
              capability: "occtShapeArtifactCandidate",
            },
          },
        ),
      );
    }
    if (
      !isCanonicalUtf8StringWithin(
        evaluator.sketchSolver.id,
        ARTIFACT_CACHE_MAX_IDENTITY_BYTES,
      ) ||
      !isCanonicalUtf8StringWithin(
        evaluator.sketchSolver.artifactCompatibilityFingerprint,
        ARTIFACT_CACHE_MAX_SOLVER_FINGERPRINT_BYTES,
      )
    ) {
      return failure(
        diagnostic(
          "KERNEL_CAPABILITY_MISSING",
          `Sketch solver '${String(evaluator.sketchSolver.id)}' does not declare artifact compatibility`,
          {
            severity: "error",
            details: {
              sketchSolver: evaluator.sketchSolver.id,
              capability: "artifactCompatibilityFingerprint",
            },
          },
        ),
      );
    }
    const template = createArtifactCacheSession(options.cache);
    if (!template.ok) return template;
    const templateAccess = getArtifactCacheSessionInternalAccess(template.value);
    if (templateAccess === undefined) {
      return failure(
        diagnostic(
          "ARTIFACT_CACHE_OPERATION_FAILED",
          "Artifact-cache session coordination is unavailable",
          { severity: "error" },
        ),
      );
    }
    const binding = Object.freeze({
      artifact: candidate.capabilities,
      codec: candidate,
      limitRefusalActual: occtShapeArtifactCandidateLimitActual,
      createSession: () => templateAccess.createSibling(),
    });
    bindingByEvaluator.set(evaluator, binding);
    return success(undefined);
  } catch (error) {
    return failure(
      diagnostic(
        "ARTIFACT_CACHE_OPERATION_FAILED",
        error instanceof Error
          ? error.message
          : "Private evaluator-cache binding failed",
        { severity: "error" },
      ),
    );
  }
}
