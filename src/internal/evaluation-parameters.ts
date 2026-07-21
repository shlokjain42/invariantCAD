import type { ConfigurationId, ParameterId } from "../core/ids.js";
import {
  diagnostic,
  hasErrors,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "../core/result.js";
import {
  evaluateExpression,
  expressionDependencies,
  Expression,
  type Dimension,
  type ExpressionIR,
} from "../expressions.js";
import type { DesignConfigurationIR, DesignDocument } from "../ir.js";

export type EvaluationParameterOverride = number | Expression<Dimension>;

export interface ResolvedEvaluationParameters {
  readonly values: ReadonlyMap<ParameterId, number>;
  readonly diagnostics: readonly Diagnostic[];
}

class ParameterResolutionFailure extends Error {
  readonly diagnostic: Diagnostic;

  constructor(value: Diagnostic) {
    super(value.message);
    this.name = "ParameterResolutionFailure";
    this.diagnostic = value;
  }
}

function parameterFailureDiagnostic(value: unknown): Diagnostic | undefined {
  try {
    return value instanceof ParameterResolutionFailure
      ? value.diagnostic
      : undefined;
  } catch {
    return undefined;
  }
}

function parameterCycleMembers(
  parameterIds: readonly ParameterId[],
  processed: ReadonlySet<ParameterId>,
  dependencies: ReadonlyMap<ParameterId, readonly ParameterId[]>,
  consumers: ReadonlyMap<ParameterId, readonly ParameterId[]>,
): ReadonlySet<ParameterId> {
  const unresolved = new Set(
    parameterIds.filter((parameter) => !processed.has(parameter)),
  );
  const visited = new Set<ParameterId>();
  const finishOrder: ParameterId[] = [];
  interface Frame {
    readonly id: ParameterId;
    readonly neighbors: readonly ParameterId[];
    next: number;
  }

  for (const root of parameterIds) {
    if (!unresolved.has(root) || visited.has(root)) continue;
    visited.add(root);
    const frames: Frame[] = [
      { id: root, neighbors: dependencies.get(root) ?? [], next: 0 },
    ];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      if (frame.next >= frame.neighbors.length) {
        frames.pop();
        finishOrder.push(frame.id);
        continue;
      }
      const neighbor = frame.neighbors[frame.next++]!;
      if (!unresolved.has(neighbor) || visited.has(neighbor)) continue;
      visited.add(neighbor);
      frames.push({
        id: neighbor,
        neighbors: dependencies.get(neighbor) ?? [],
        next: 0,
      });
    }
  }

  const assigned = new Set<ParameterId>();
  const cyclic = new Set<ParameterId>();
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const root = finishOrder[index]!;
    if (assigned.has(root)) continue;
    const component: ParameterId[] = [];
    const stack = [root];
    assigned.add(root);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const neighbor of consumers.get(current) ?? []) {
        if (!unresolved.has(neighbor) || assigned.has(neighbor)) continue;
        assigned.add(neighbor);
        stack.push(neighbor);
      }
    }
    const isCycle =
      component.length > 1 ||
      component.some((parameter) =>
        (dependencies.get(parameter) ?? []).includes(parameter),
      );
    if (isCycle) {
      for (const parameter of component) cyclic.add(parameter);
    }
  }
  return cyclic;
}

/**
 * Resolves the shared evaluation precedence and bound contract without running
 * a sketch solver or geometry kernel.
 */
export function resolveEvaluationParameters(
  document: DesignDocument,
  overrides: Readonly<Record<string, EvaluationParameterOverride>>,
  configurationId: ConfigurationId | null,
  configuration: DesignConfigurationIR | undefined,
): CadResult<ResolvedEvaluationParameters> {
  const diagnostics: Diagnostic[] = [];
  const values = new Map<ParameterId, number>();
  const configurationOverrides = configuration?.parameterOverrides ?? {};
  const overrideValues = new Map<string, unknown>();
  let overrideKeys: string[];
  try {
    overrideKeys = Object.keys(overrides);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "EXPRESSION_INVALID",
          safeErrorMessage(
            error,
            "Parameter overrides could not be read safely",
          ),
          { severity: "error", path: "/parameters" },
        ),
      ],
    };
  }
  const sourcePath = (id: ParameterId): string => {
    if (overrideValues.has(id)) return `/parameters/${id}`;
    if (Object.hasOwn(configurationOverrides, id)) {
      return `/configurations/${configurationId}/parameterOverrides/${id}`;
    }
    return `/parameters/${id}/default`;
  };
  const parameterIds = (Object.keys(document.parameters) as ParameterId[]).sort(
    (first, second) => (first < second ? -1 : first > second ? 1 : 0),
  );
  for (const key of overrideKeys) {
    if (!Object.hasOwn(document.parameters, key)) {
      diagnostics.push(
        diagnostic("PARAMETER_MISSING", `Unknown parameter override '${key}'`, {
          severity: "error",
          path: `/parameters/${key}`,
        }),
      );
    }
  }
  try {
    for (const key of overrideKeys) {
      if (Object.hasOwn(document.parameters, key)) {
        overrideValues.set(key, overrides[key]);
      }
    }
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "EXPRESSION_INVALID",
          safeErrorMessage(
            error,
            "Parameter overrides could not be read safely",
          ),
          { severity: "error", path: "/parameters" },
        ),
      ],
    };
  }

  type Source =
    | { readonly kind: "number"; readonly value: number }
    | { readonly kind: "expression"; readonly expression: ExpressionIR };
  const sources = new Map<ParameterId, Source>();
  const dependenciesByParameter = new Map<
    ParameterId,
    readonly ParameterId[]
  >();
  const indegrees = new Map<ParameterId, number>();
  const consumers = new Map<ParameterId, ParameterId[]>();
  const sourceInvalid = new Set<ParameterId>();
  for (const rawId of parameterIds) {
    const definition = document.parameters[rawId]!;
    try {
      const hasOverride = overrideValues.has(rawId);
      const override = overrideValues.get(rawId);
      const hasConfigurationOverride = Object.hasOwn(
        configurationOverrides,
        rawId,
      );
      let source: Source;
      if (typeof override === "number") {
        source = { kind: "number", value: override };
      } else if (override instanceof Expression) {
        if (override.dimension !== definition.dimension) {
          throw new ParameterResolutionFailure(
            diagnostic(
              "EXPRESSION_DIMENSION_MISMATCH",
              `Override for '${rawId}' is ${override.dimension}, expected ${definition.dimension}`,
              { severity: "error", path: `/parameters/${rawId}` },
            ),
          );
        }
        source = { kind: "expression", expression: override.ir };
      } else if (hasOverride) {
        throw new ParameterResolutionFailure(
          diagnostic(
            "EXPRESSION_INVALID",
            `Override for '${rawId}' must be a number or Expression`,
            { severity: "error", path: `/parameters/${rawId}` },
          ),
        );
      } else {
        source = {
          kind: "expression",
          expression: hasConfigurationOverride
            ? configurationOverrides[rawId]!
            : definition.default,
        };
      }
      sources.set(rawId, source);
      const dependencies =
        source.kind === "expression"
          ? [...expressionDependencies(source.expression)]
          : [];
      const presentDependencies: ParameterId[] = [];
      let degree = 0;
      for (const dependency of dependencies) {
        const dependencyDefinition = Object.hasOwn(
          document.parameters,
          dependency,
        )
          ? document.parameters[dependency]
          : undefined;
        if (dependencyDefinition === undefined) {
          diagnostics.push(
            diagnostic(
              "PARAMETER_MISSING",
              `Missing parameter '${dependency}'`,
              { severity: "error", path: `/parameters/${dependency}` },
            ),
          );
          sourceInvalid.add(rawId);
          continue;
        }
        presentDependencies.push(dependency);
        degree += 1;
        const existing = consumers.get(dependency);
        if (existing === undefined) consumers.set(dependency, [rawId]);
        else existing.push(rawId);
      }
      dependenciesByParameter.set(rawId, presentDependencies);
      indegrees.set(rawId, degree);
    } catch (error) {
      sourceInvalid.add(rawId);
      dependenciesByParameter.set(rawId, []);
      indegrees.set(rawId, 0);
      const structured = parameterFailureDiagnostic(error);
      diagnostics.push(
        structured ??
          diagnostic(
            "EXPRESSION_INVALID",
            safeErrorMessage(
              error,
              `Parameter '${rawId}' source is invalid`,
            ),
            {
              severity: "error",
              path: sourcePath(rawId),
            },
          ),
      );
    }
  }

  const ready = parameterIds.filter((id) => indegrees.get(id) === 0);
  const processed = new Set<ParameterId>();
  let cursor = 0;
  while (cursor < ready.length) {
    const rawId = ready[cursor++]!;
    processed.add(rawId);
    const definition = document.parameters[rawId]!;
    const source = sources.get(rawId);
    if (!sourceInvalid.has(rawId) && source !== undefined) {
      try {
        const value =
          source.kind === "number"
            ? source.value
            : evaluateExpression(source.expression, {
                resolveParameter: (dependency, expected) => {
                  const dependencyDefinition = Object.hasOwn(
                    document.parameters,
                    dependency,
                  )
                    ? document.parameters[dependency]
                    : undefined;
                  if (dependencyDefinition === undefined) {
                    throw new ParameterResolutionFailure(
                      diagnostic(
                        "PARAMETER_MISSING",
                        `Missing parameter '${dependency}'`,
                        {
                          severity: "error",
                          path: `/parameters/${dependency}`,
                        },
                      ),
                    );
                  }
                  if (dependencyDefinition.dimension !== expected) {
                    throw new ParameterResolutionFailure(
                      diagnostic(
                        "EXPRESSION_DIMENSION_MISMATCH",
                        `Parameter '${dependency}' is ${dependencyDefinition.dimension}, expected ${expected}`,
                        {
                          severity: "error",
                          path: `/parameters/${dependency}`,
                        },
                      ),
                    );
                  }
                  const resolved = values.get(dependency);
                  if (resolved === undefined) {
                    throw new ParameterResolutionFailure(
                      diagnostic(
                        "EXPRESSION_INVALID",
                        `Parameter '${dependency}' could not be resolved`,
                        {
                          severity: "error",
                          path: sourcePath(rawId),
                        },
                      ),
                    );
                  }
                  return resolved;
                },
              });
        if (
          definition.dimension === "massDensity" &&
          (!Number.isFinite(value) || !(value > 0))
        ) {
          throw new ParameterResolutionFailure(
            diagnostic(
              "MASS_DENSITY_INVALID",
              `Mass-density parameter '${rawId}' must be finite and strictly positive`,
              {
                severity: "error",
                path: sourcePath(rawId),
                details: { value },
              },
            ),
          );
        }
        if (!Number.isFinite(value)) {
          throw new ParameterResolutionFailure(
            diagnostic(
              "EXPRESSION_INVALID",
              `Parameter '${rawId}' is not finite`,
              {
                severity: "error",
                path: sourcePath(rawId),
              },
            ),
          );
        }
        values.set(rawId, value);
      } catch (error) {
        const structured = parameterFailureDiagnostic(error);
        diagnostics.push(
          structured ??
            diagnostic(
              definition.dimension === "massDensity"
                ? "MASS_DENSITY_INVALID"
                : "EXPRESSION_INVALID",
              safeErrorMessage(error),
              { severity: "error", path: sourcePath(rawId) },
            ),
        );
      }
    }
    for (const consumer of consumers.get(rawId) ?? []) {
      const remaining = indegrees.get(consumer)! - 1;
      indegrees.set(consumer, remaining);
      if (remaining === 0) ready.push(consumer);
    }
  }
  const cycleMembers = parameterCycleMembers(
    parameterIds,
    processed,
    dependenciesByParameter,
    consumers,
  );
  for (const rawId of parameterIds) {
    if (!cycleMembers.has(rawId)) continue;
    diagnostics.push(
      diagnostic("PARAMETER_CYCLE", `Parameter '${rawId}' is part of a cycle`, {
        severity: "error",
        path: sourcePath(rawId),
      }),
    );
  }

  if (!hasErrors(diagnostics)) {
    const context = {
      resolveParameter: (id: ParameterId, expected: Dimension): number => {
        const definition = Object.hasOwn(document.parameters, id)
          ? document.parameters[id]
          : undefined;
        if (definition === undefined) {
          throw new ParameterResolutionFailure(
            diagnostic("PARAMETER_MISSING", `Missing parameter '${id}'`, {
              severity: "error",
              path: `/parameters/${id}`,
            }),
          );
        }
        if (definition.dimension !== expected) {
          throw new ParameterResolutionFailure(
            diagnostic(
              "EXPRESSION_DIMENSION_MISMATCH",
              `Parameter '${id}' is ${definition.dimension}, expected ${expected}`,
              { severity: "error", path: `/parameters/${id}` },
            ),
          );
        }
        const value = values.get(id);
        if (value === undefined) {
          throw new ParameterResolutionFailure(
            diagnostic(
              "EXPRESSION_INVALID",
              `Parameter '${id}' could not be resolved`,
              { severity: "error", path: sourcePath(id) },
            ),
          );
        }
        return value;
      },
    };
    for (const rawId of parameterIds) {
      const definition = document.parameters[rawId]!;
      const value = values.get(rawId)!;
      let boundInvalid = false;
      const bound = (
        field: "min" | "max",
        expression: ExpressionIR | undefined,
      ): number | undefined => {
        if (expression === undefined) return undefined;
        try {
          return evaluateExpression(expression, context);
        } catch (error) {
          boundInvalid = true;
          const structured = parameterFailureDiagnostic(error);
          diagnostics.push(
            structured ??
              diagnostic(
                definition.dimension === "massDensity"
                  ? "MASS_DENSITY_INVALID"
                  : "EXPRESSION_INVALID",
                `Parameter '${rawId}' ${field} bound is invalid: ${safeErrorMessage(error)}`,
                {
                  severity: "error",
                  path: `/parameters/${rawId}/${field}`,
                },
              ),
          );
          return undefined;
        }
      };
      const min = bound("min", definition.min);
      const max = bound("max", definition.max);
      if (boundInvalid) continue;
      if (
        (min !== undefined && value < min) ||
        (max !== undefined && value > max)
      ) {
        diagnostics.push(
          diagnostic(
            "PARAMETER_OUT_OF_RANGE",
            `Parameter '${rawId}' value ${value} is outside ${min ?? "-∞"}..${max ?? "∞"}`,
            {
              severity: "error",
              path: sourcePath(rawId),
              details: { value, min, max },
            },
          ),
        );
      }
    }
  }
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };
  return success({ values, diagnostics }, diagnostics);
}
