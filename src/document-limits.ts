import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
} from "./core/result.js";

export interface DesignDocumentLimits {
  readonly maxDocumentBytes: number;
  readonly maxStructuralValues: number;
  readonly maxNestingDepth: number;
  readonly maxTopologyReferences: number;
  readonly maxTopologyReferenceVariants: number;
  readonly maxStoredAdjacencyLinks: number;
  readonly maxStoredEvidenceRecords: number;
  readonly maxTopologyQueryNodes: number;
}

export const DEFAULT_DESIGN_DOCUMENT_LIMITS: DesignDocumentLimits =
  Object.freeze({
    maxDocumentBytes: 64 * 1024 * 1024,
    maxStructuralValues: 1_000_000,
    maxNestingDepth: 128,
    maxTopologyReferences: 10_000,
    maxTopologyReferenceVariants: 20_000,
    maxStoredAdjacencyLinks: 1_000_000,
    maxStoredEvidenceRecords: 1_000_000,
    maxTopologyQueryNodes: 100_000,
  });

const LIMIT_KEYS = Object.freeze(
  Object.keys(DEFAULT_DESIGN_DOCUMENT_LIMITS) as readonly (
    keyof DesignDocumentLimits
  )[],
);

export function normalizeDesignDocumentLimits(
  value: unknown,
): DesignDocumentLimits | undefined {
  if (value === undefined) return DEFAULT_DESIGN_DOCUMENT_LIMITS;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(raw);
  if (
    keys.some(
      (key) => !LIMIT_KEYS.includes(key as keyof DesignDocumentLimits),
    )
  ) {
    return undefined;
  }
  const normalized: Record<keyof DesignDocumentLimits, number> = {
    ...DEFAULT_DESIGN_DOCUMENT_LIMITS,
  };
  for (const key of LIMIT_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const candidate = raw[key];
    if (
      typeof candidate !== "number" ||
      !Number.isSafeInteger(candidate) ||
      candidate < 0
    ) {
      return undefined;
    }
    normalized[key] = candidate;
  }
  return Object.freeze(normalized);
}

function limitFailure<T = never>(
  resource: keyof DesignDocumentLimits,
  limit: number,
  actual: number,
): CadResult<T> {
  return failure(
    diagnostic(
      "IR_INVALID",
      `Design-document ${resource} limit ${limit} was exceeded by ${actual}`,
      {
        severity: "error",
        details: { resource, limit, actual },
      },
    ),
  );
}

class DocumentPreflightFailure {
  constructor(readonly result: CadResult<never>) {}
}

function stopWith(result: CadResult<never>): never {
  throw new DocumentPreflightFailure(result);
}

function stopAtLimit(
  resource: keyof DesignDocumentLimits,
  limit: number,
  actual: number,
): never {
  stopWith(limitFailure(resource, limit, actual));
}

function arrayLength(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  const length = value.length;
  return Number.isSafeInteger(length) && length >= 0 && length <= 0xffff_ffff
    ? length
    : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function assertSchedulingCapacity(
  resource: "maxStructuralValues" | "maxTopologyQueryNodes",
  limit: number,
  visited: number,
  scheduled: number,
  additions: number,
): void {
  if (additions > limit - visited - scheduled) {
    stopAtLimit(resource, limit, limit + 1);
  }
}

interface CapturedObject {
  readonly output: Record<string, unknown> | unknown[];
  state: "active" | "complete";
}

/**
 * Copies an untrusted JSON-shaped value while reading each source property at
 * most once. The copy is the only value later handed to schemas, closing the
 * gap where a getter or Proxy could change after resource preflight.
 */
function captureDocumentValue(
  value: unknown,
  limits: DesignDocumentLimits,
): unknown {
  const captured = new WeakMap<object, CapturedObject>();
  let structuralValues = 0;

  const capture = (current: unknown, depth: number): unknown => {
    structuralValues += 1;
    if (structuralValues > limits.maxStructuralValues) {
      stopAtLimit(
        "maxStructuralValues",
        limits.maxStructuralValues,
        structuralValues,
      );
    }
    if (depth > limits.maxNestingDepth) {
      stopAtLimit("maxNestingDepth", limits.maxNestingDepth, depth);
    }
    if (typeof current !== "object" || current === null) return current;

    const known = captured.get(current);
    if (known !== undefined) {
      if (known.state === "active") {
        stopWith(
          failure(
            diagnostic(
              "IR_INVALID",
              "Design-document input cannot contain object cycles",
              { severity: "error" },
            ),
          ),
        );
      }
      return known.output;
    }

    if (Array.isArray(current)) {
      const length = arrayLength(current);
      if (length === undefined) {
        stopWith(
          failure(
            diagnostic("IR_INVALID", "Design-document array length is invalid", {
              severity: "error",
            }),
          ),
        );
      }
      assertSchedulingCapacity(
        "maxStructuralValues",
        limits.maxStructuralValues,
        structuralValues,
        0,
        length,
      );
      const output = new Array<unknown>(length);
      const state: CapturedObject = { output, state: "active" };
      captured.set(current, state);
      for (let index = 0; index < length; index += 1) {
        if (!Object.hasOwn(current, index)) {
          stopWith(
            failure(
              diagnostic(
                "IR_INVALID",
                "Design-document arrays cannot be sparse",
                { severity: "error" },
              ),
            ),
          );
        }
        output[index] = capture(current[index], depth + 1);
      }
      state.state = "complete";
      return output;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      stopWith(
        failure(
          diagnostic(
            "IR_INVALID",
            "Design-document objects must be plain JSON records",
            { severity: "error" },
          ),
        ),
      );
    }
    const keys = Object.keys(current);
    assertSchedulingCapacity(
      "maxStructuralValues",
      limits.maxStructuralValues,
      structuralValues,
      0,
      keys.length,
    );
    const output = Object.create(null) as Record<string, unknown>;
    const state: CapturedObject = { output, state: "active" };
    captured.set(current, state);
    const source = current as Readonly<Record<string, unknown>>;
    for (const key of keys) {
      const child = source[key];
      output[key] = capture(child, depth + 1);
    }
    state.state = "complete";
    return output;
  };

  return capture(value, 0);
}

/** Counts every structural occurrence, including repeated aliases. */
function checkStructuralOccurrences(
  value: unknown,
  limits: DesignDocumentLimits,
): void {
  const stack: { readonly value: unknown; readonly depth: number }[] = [
    { value, depth: 0 },
  ];
  let structuralValues = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    structuralValues += 1;
    if (structuralValues > limits.maxStructuralValues) {
      stopAtLimit(
        "maxStructuralValues",
        limits.maxStructuralValues,
        structuralValues,
      );
    }
    if (current.depth > limits.maxNestingDepth) {
      stopAtLimit("maxNestingDepth", limits.maxNestingDepth, current.depth);
    }
    if (typeof current.value !== "object" || current.value === null) continue;

    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Readonly<Record<string, unknown>>);
    assertSchedulingCapacity(
      "maxStructuralValues",
      limits.maxStructuralValues,
      structuralValues,
      stack.length,
      children.length,
    );
    for (const child of children) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function topologyQueryRoots(value: unknown): readonly unknown[] {
  const root = record(value);
  const nodes = record(root?.nodes);
  if (nodes === undefined) return [];
  const roots: unknown[] = [];
  for (const node of Object.values(nodes)) {
    const candidate = record(node);
    if (candidate === undefined) continue;
    const selection =
      candidate.kind === "fillet" || candidate.kind === "chamfer"
        ? record(candidate.edges)
        : candidate.kind === "shell"
          ? record(candidate.openings)
          : candidate.kind === "draft"
            ? record(candidate.faces)
            : undefined;
    if (selection !== undefined && Object.hasOwn(selection, "query")) {
      roots.push(selection.query);
    }
  }
  return roots;
}

/** Counts only selector query trees, never lookalike `op` keys in metadata. */
function checkTopologyQueryOccurrences(
  value: unknown,
  limits: DesignDocumentLimits,
): void {
  const stack = [...topologyQueryRoots(value)];
  let topologyQueryNodes = 0;
  assertSchedulingCapacity(
    "maxTopologyQueryNodes",
    limits.maxTopologyQueryNodes,
    0,
    0,
    stack.length,
  );
  while (stack.length > 0) {
    const query = stack.pop()!;
    topologyQueryNodes += 1;
    if (topologyQueryNodes > limits.maxTopologyQueryNodes) {
      stopAtLimit(
        "maxTopologyQueryNodes",
        limits.maxTopologyQueryNodes,
        topologyQueryNodes,
      );
    }
    const candidate = record(query);
    if (candidate === undefined) continue;

    let children: readonly unknown[] = [];
    if (
      (candidate.op === "and" || candidate.op === "or") &&
      Array.isArray(candidate.queries)
    ) {
      children = candidate.queries;
    } else if (candidate.op === "not" && Object.hasOwn(candidate, "query")) {
      children = [candidate.query];
    } else if (candidate.op === "adjacentTo") {
      const selection = record(candidate.selection);
      if (selection !== undefined && Object.hasOwn(selection, "query")) {
        children = [selection.query];
      }
    }
    assertSchedulingCapacity(
      "maxTopologyQueryNodes",
      limits.maxTopologyQueryNodes,
      topologyQueryNodes,
      stack.length,
      children.length,
    );
    stack.push(...children);
  }
}

function checkTopologyReferenceResources(
  value: unknown,
  limits: DesignDocumentLimits,
): void {
  const root = record(value);
  const registry = record(root?.topologyReferences);
  if (registry === undefined) return;
  const referenceIds = Object.keys(registry);
  if (referenceIds.length > limits.maxTopologyReferences) {
    stopAtLimit(
      "maxTopologyReferences",
      limits.maxTopologyReferences,
      referenceIds.length,
    );
  }
  let variants = 0;
  let adjacencyLinks = 0;
  let evidenceRecords = 0;
  for (const id of referenceIds) {
    const entry = record(registry[id]);
    const entryVariants = entry?.variants;
    const variantLength = arrayLength(entryVariants);
    if (variantLength === undefined || !Array.isArray(entryVariants)) continue;
    variants += variantLength;
    if (variants > limits.maxTopologyReferenceVariants) {
      stopAtLimit(
        "maxTopologyReferenceVariants",
        limits.maxTopologyReferenceVariants,
        variants,
      );
    }
    for (let index = 0; index < variantLength; index += 1) {
      const variant = record(entryVariants[index]);
      evidenceRecords += arrayLength(variant?.lineage) ?? 0;
      const adjacency = variant?.adjacency;
      const adjacencyLength = arrayLength(adjacency) ?? 0;
      adjacencyLinks += adjacencyLength;
      if (Array.isArray(adjacency)) {
        for (const neighborValue of adjacency) {
          const neighbor = record(neighborValue);
          evidenceRecords += arrayLength(neighbor?.lineage) ?? 0;
        }
      }
      if (adjacencyLinks > limits.maxStoredAdjacencyLinks) {
        stopAtLimit(
          "maxStoredAdjacencyLinks",
          limits.maxStoredAdjacencyLinks,
          adjacencyLinks,
        );
      }
      if (evidenceRecords > limits.maxStoredEvidenceRecords) {
        stopAtLimit(
          "maxStoredEvidenceRecords",
          limits.maxStoredEvidenceRecords,
          evidenceRecords,
        );
      }
    }
  }
}

/**
 * Detaches and bounds untrusted document structure before recursive schemas or
 * freezing can consume it. The returned plain snapshot is the value that must
 * be parsed; callers must not inspect the original input again.
 */
export function preflightDesignDocumentValue(
  value: unknown,
  limits: DesignDocumentLimits,
): CadResult<unknown> {
  try {
    const snapshot = captureDocumentValue(value, limits);
    checkStructuralOccurrences(snapshot, limits);
    checkTopologyQueryOccurrences(snapshot, limits);
    checkTopologyReferenceResources(snapshot, limits);
    return success(snapshot);
  } catch (error) {
    if (error instanceof DocumentPreflightFailure) return error.result;
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(
          error,
          "Design-document input could not be read safely",
        ),
        { severity: "error" },
      ),
    );
  }
}
