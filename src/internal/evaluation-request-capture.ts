import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
} from "../core/result.js";
import type { EvaluationOptions } from "../evaluator.js";
import type { DesignDocument } from "../ir.js";
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
  ) {}
}

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
 * evaluation fails there with `OUTPUT_MISSING` and never reads further.
 */
function captureOutputSelection(
  value: unknown,
  document: DesignDocument,
): readonly unknown[] {
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
  ) as number;
  const selected: unknown[] = [];
  const seen = new Set<unknown>();
  for (let index = 0; index < length; index += 1) {
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
    if (seen.has(name)) continue;
    seen.add(name);
    selected.push(name);
    if (typeof name !== "string" || !Object.hasOwn(document.outputs, name)) {
      break;
    }
  }
  return Object.freeze(selected);
}

/**
 * Copies topology-signature limits as plain data so later caller writes
 * cannot change the limits applied to outputs evaluated after a yield. The
 * evaluator still validates the copied fields as before.
 */
function captureTopologySignatureLimits(value: unknown): unknown {
  // Non-records are rejected later whatever their contents.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    throw new CaptureFailure(
      "Evaluation options.topologySignatureLimits could not be inspected safely",
      "/options/topologySignatureLimits",
    );
  }
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: ownDataValue(
        value,
        key,
        `Evaluation options.topologySignatureLimits.${key}`,
        `/options/topologySignatureLimits/${key}`,
      ),
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
        : captureOutputSelection(rawOutputs, parsed.value);
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
    return failure(
      diagnostic(
        "IR_INVALID",
        error instanceof CaptureFailure
          ? error.message
          : safeErrorMessage(error, "Evaluation options could not be captured"),
        {
          severity: "error",
          path: error instanceof CaptureFailure ? error.path : "/options",
        },
      ),
    );
  }
}
