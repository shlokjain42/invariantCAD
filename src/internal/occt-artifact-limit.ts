export interface OcctArtifactLimitRefusal {
  readonly limit: number;
  readonly actual: number;
}

const LIMIT_REFUSALS = new WeakMap<object, OcctArtifactLimitRefusal>();

export function throwOcctArtifactLimitRefusal(
  limit: number,
  actual: number,
  message: string,
): never {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    !Number.isSafeInteger(actual) ||
    actual <= limit
  ) {
    throw new RangeError(
      "OCCT artifact limit refusals require safe integers with actual > limit",
    );
  }
  const error = new RangeError(message);
  LIMIT_REFUSALS.set(error, Object.freeze({ limit, actual }));
  throw error;
}

export function occtArtifactLimitRefusal(
  error: unknown,
  expectedLimit?: number,
): OcctArtifactLimitRefusal | undefined {
  if (
    (typeof error !== "object" && typeof error !== "function") ||
    error === null
  ) return undefined;
  const refusal = LIMIT_REFUSALS.get(error);
  if (
    refusal === undefined ||
    (expectedLimit !== undefined && refusal.limit !== expectedLimit)
  ) return undefined;
  return refusal;
}
