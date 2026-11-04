import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
} from "../core/result.js";
import type { EvaluationOptions } from "../evaluator.js";
import { DEFAULT_DESIGN_DOCUMENT_LIMITS } from "../document-limits.js";
import type { DesignDocument } from "../ir.js";
import type { TopologySignatureLimits } from "../topology-signatures.js";
import { parseDocumentValue } from "../serialization.js";

/** A public evaluation request detached from the caller's objects. */
export interface CapturedEvaluationRequest {
  readonly document: DesignDocument;
  readonly options: EvaluationOptions;
}

class CaptureFailure {
  constructor(
    readonly message: string,
    readonly path: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {}
}

/** Raised when the request's signal is found aborted during capture. */
class CaptureAborted {}

/**
 * Most `outputs` entries a captured request inspects. Duplicates make a longer
 * selection legal but never useful, and a proxied array can report any length
 * without allocating entries, so the scan needs its own ceiling. It reuses the
 * default document `maxStructuralValues`, the bound the document admitted with
 * the request is held to.
 */
const MAX_OUTPUT_SELECTION_ENTRIES =
  DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues;

/** Entries inspected between checks of the request's signal. */
const OUTPUT_SELECTION_ABORT_INTERVAL = 1024;

/**
 * Reads one own property of a caller object exactly once. An absent own
 * property reads as `undefined`, so inherited values are never consulted, and
 * an accessor fails without being invoked.
 */
function ownDataValue(
  record: object,
  key: string,
  label: string,
  path: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new CaptureFailure(`${label} could not be inspected safely`, path);
  }
  if (descriptor === undefined) return undefined;
  if (!Object.hasOwn(descriptor, "value")) {
    throw new CaptureFailure(`${label} must be a data property`, path);
  }
  return descriptor.value as unknown;
}

/**
 * Copies the output selection without iterating caller code. Allocation is
 * bounded by the document's declared outputs: duplicates are dropped, and
 * reading stops after the first name the document does not declare, because
 * evaluation fails there with `OUTPUT_MISSING` and never reads further. A
 * non-string entry fails capture at its original index, so it never reaches a
 * property-key conversion that could run caller code. Work
 * is bounded by `MAX_OUTPUT_SELECTION_ENTRIES`, checked before the scan, and a
 * long scan stops when `signal` is aborted.
 */
function captureOutputSelection(
  value: unknown,
  document: DesignDocument,
  signal: unknown,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new CaptureFailure(
      "Evaluation options.outputs must be an array",
      "/options/outputs",
    );
  }
  const length = ownDataValue(
    value,
    "length",
    "Evaluation options.outputs.length",
    "/options/outputs",
  );
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    throw new CaptureFailure(
      "Evaluation options.outputs must have a valid length",
      "/options/outputs",
    );
  }
  if (length > MAX_OUTPUT_SELECTION_ENTRIES) {
    throw new CaptureFailure(
      `Evaluation options.outputs has more than ${MAX_OUTPUT_SELECTION_ENTRIES} entries`,
      "/options/outputs",
      {
        resource: "maxOutputSelectionEntries",
        limit: MAX_OUTPUT_SELECTION_ENTRIES,
        actual: length,
      },
    );
  }
  const selected: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    if (
      index !== 0 &&
      index % OUTPUT_SELECTION_ABORT_INTERVAL === 0 &&
      (signal as { readonly aborted?: unknown } | null | undefined)?.aborted
    ) {
      throw new CaptureAborted();
    }
    const path = `/options/outputs/${index}`;
    const label = `Evaluation options.outputs[${index}]`;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, index);
    } catch {
      throw new CaptureFailure(`${label} could not be inspected safely`, path);
    }
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      throw new CaptureFailure(`${label} must be an own data property`, path);
    }
    const name = descriptor.value as unknown;
    if (typeof name !== "string") {
      // Report the entry at its original index, before duplicates are
      // dropped; the evaluator never receives it, so no lookup converts it.
      if ((signal as { readonly aborted?: unknown } | null | undefined)?.aborted) {
        throw new CaptureAborted();
      }
      throw new CaptureFailure(`${label} must be a string`, path);
    }
    if (seen.has(name)) continue;
    seen.add(name);
    selected.push(name);
    if (!Object.hasOwn(document.outputs, name)) break;
  }
  return Object.freeze(selected);
}

/**
 * The fields `topologySignatureLimits` may carry. Topology resolution rejects
 * any other enumerable own field. Typed as a record so this list cannot drift
 * from `TopologySignatureLimits`.
 */
const TOPOLOGY_SIGNATURE_LIMIT_FIELDS: Readonly<
  Record<keyof TopologySignatureLimits, true>
> = Object.freeze({
  maxTopologyItems: true,
  maxAdjacencyLinks: true,
  maxEvidenceRecords: true,
  maxReferenceVariants: true,
  maxCandidatePairs: true,
  maxMatchingSteps: true,
});

const TOPOLOGY_SIGNATURE_LIMIT_KEYS = Object.freeze(
  Object.keys(TOPOLOGY_SIGNATURE_LIMIT_FIELDS),
) as readonly (keyof TopologySignatureLimits)[];

function jsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * Copies topology-signature limits as plain data so later caller writes
 * cannot change the limits applied to outputs evaluated after a yield.
 *
 * An enumerable own field other than the six supported limits is rejected
 * before anything is copied, so the copy never holds more than six fields
 * however large the caller's object is. Topology resolution would reject
 * such an object anyway as soon as it used the limits. Each supported field is
 * read once by descriptor whether or not it is enumerable, matching how
 * topology resolution reads it, and the evaluator still validates the copied
 * values as before.
 */
function captureTopologySignatureLimits(value: unknown): unknown {
  // Non-records are rejected later whatever their contents.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const path = "/options/topologySignatureLimits";
  let keys: string[];
  try {
    // Lists only names the caller already allocated; nothing proportional to
    // them is copied, and the scan stops at the first unsupported one.
    keys = Object.keys(value);
  } catch {
    throw new CaptureFailure(
      "Evaluation options.topologySignatureLimits could not be inspected safely",
      path,
    );
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!Object.hasOwn(TOPOLOGY_SIGNATURE_LIMIT_FIELDS, key)) {
      throw new CaptureFailure(
        "Evaluation options.topologySignatureLimits contains an unsupported field",
        `${path}/${jsonPointerSegment(key)}`,
      );
    }
  }
  // Define, rather than assign, each field so a setter on Object.prototype
  // cannot intercept a copied limit.
  const copy: Record<string, unknown> = {};
  for (const key of TOPOLOGY_SIGNATURE_LIMIT_KEYS) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new CaptureFailure(
        `Evaluation options.topologySignatureLimits.${key} could not be inspected safely`,
        `${path}/${key}`,
      );
    }
    if (descriptor === undefined) continue;
    if (!Object.hasOwn(descriptor, "value")) {
      throw new CaptureFailure(
        `Evaluation options.topologySignatureLimits.${key} must be a data property`,
        `${path}/${key}`,
      );
    }
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: descriptor.value as unknown,
    });
  }
  return Object.freeze(copy);
}

/**
 * Captures a public evaluation request that will yield to the host, or
 * returns `undefined` when `signal` is not an own data property of `options`
 * (absent, inherited, or an accessor) and the evaluation runs synchronously as
 * before.
 *
 * Options are read once each as own data properties. `parameters` and
 * `configuration` are consumed before the first yield, so they are passed on
 * unchanged. The document is admitted through the bounded
 * `parseDocumentValue` snapshot, so it is size-checked while it is copied.
 */
export function captureYieldingEvaluationRequest(
  document: DesignDocument,
  options: EvaluationOptions,
): CadResult<CapturedEvaluationRequest> | undefined {
  let signalDescriptor: PropertyDescriptor | undefined;
  try {
    signalDescriptor = Object.getOwnPropertyDescriptor(options, "signal");
  } catch {
    return undefined;
  }
  // Any other form of signal keeps the synchronous path, which never yields
  // and reads the options exactly as earlier releases did.
  if (
    signalDescriptor === undefined ||
    !Object.hasOwn(signalDescriptor, "value") ||
    signalDescriptor.value === undefined
  ) {
    return undefined;
  }
  const signal = signalDescriptor.value as unknown;
  try {
    const configuration = ownDataValue(
      options,
      "configuration",
      "Evaluation options.configuration",
      "/options/configuration",
    );
    const parameters = ownDataValue(
      options,
      "parameters",
      "Evaluation options.parameters",
      "/options/parameters",
    );
    const rawOutputs = ownDataValue(
      options,
      "outputs",
      "Evaluation options.outputs",
      "/options/outputs",
    );
    const allowEmpty = ownDataValue(
      options,
      "allowEmpty",
      "Evaluation options.allowEmpty",
      "/options/allowEmpty",
    );
    const rawLimits = ownDataValue(
      options,
      "topologySignatureLimits",
      "Evaluation options.topologySignatureLimits",
      "/options/topologySignatureLimits",
    );
    const parsed = parseDocumentValue(document);
    if (!parsed.ok) return parsed;
    const outputs =
      rawOutputs === undefined
        ? undefined
        : captureOutputSelection(rawOutputs, parsed.value, signal);
    const topologySignatureLimits = captureTopologySignatureLimits(rawLimits);
    return success({
      document: parsed.value,
      options: Object.freeze({
        ...(configuration === undefined ? {} : { configuration }),
        ...(parameters === undefined ? {} : { parameters }),
        ...(outputs === undefined ? {} : { outputs }),
        signal,
        ...(allowEmpty === undefined ? {} : { allowEmpty }),
        ...(topologySignatureLimits === undefined
          ? {}
          : { topologySignatureLimits }),
      }) as EvaluationOptions,
    });
  } catch (error) {
    if (error instanceof CaptureAborted) {
      return failure(
        diagnostic("EVALUATION_ABORTED", "CAD evaluation was aborted", {
          severity: "error",
        }),
      );
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        error instanceof CaptureFailure
          ? error.message
          : safeErrorMessage(error, "Evaluation options could not be captured"),
        {
          severity: "error",
          path: error instanceof CaptureFailure ? error.path : "/options",
          ...(error instanceof CaptureFailure && error.details !== undefined
            ? { details: error.details }
            : {}),
        },
      ),
    );
  }
}
