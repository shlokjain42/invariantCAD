import type {
  ConfigurationId,
  NodeId,
  ParameterId,
} from "../core/ids.js";
import { deepFreeze } from "../core/json.js";
import type { Vec3 } from "../core/math.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "../core/result.js";
import {
  DEFAULT_DESIGN_DOCUMENT_LIMITS,
  type DesignDocumentLimits,
} from "../document-limits.js";
import {
  evaluateExpression,
  type ExpressionIR,
} from "../expressions.js";
import type {
  DesignConfigurationIR,
  DesignDocumentV7,
  NodeIRV7,
} from "../ir.js";
import { parseDocumentValueV7 } from "../serialization.js";
import {
  DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
  documentV7RuntimeIntrinsicsAreIntact,
} from "./document-v7-runtime-integrity.js";
import { resolveEvaluationParameters } from "./evaluation-parameters.js";

const DATUM_EVALUATION_PHASE = "documentV7DatumEvaluation";
const DATUM_ORTHOGONALITY_TOLERANCE = 1e-12;

const DatumArray = Array;
const datumArrayIsArray = Array.isArray;
const datumArraySort = Array.prototype.sort;
const datumMapGet = Map.prototype.get;
const datumMapForEach = Map.prototype.forEach;
const DatumSet = Set;
const datumSetAdd = Set.prototype.add;
const datumSetHas = Set.prototype.has;
const datumNumberIsFinite = Number.isFinite;
const datumNumberIsSafeInteger = Number.isSafeInteger;
const datumObjectCreate = Object.create;
const datumObjectDefineProperty = Object.defineProperty;
const datumObjectFreeze = Object.freeze;
const datumObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const datumObjectGetPrototypeOf = Object.getPrototypeOf;
const datumObjectHasOwn = Object.hasOwn;
const datumObjectKeys = Object.keys;
const datumObjectPrototype = Object.prototype;
const datumReflectApply = Reflect.apply;
const datumReflectOwnKeys = Reflect.ownKeys;
const datumStringCharAt = String.prototype.charAt;
const datumMathAbs = Math.abs;
const datumMathHypot = Math.hypot;
const datumMathMax = Math.max;
const datumAbortSignalAbortedGetter =
  typeof AbortSignal === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

function datumApply<T>(
  method: CallableFunction,
  receiver: unknown,
  arguments_: readonly unknown[],
): T {
  return datumReflectApply(method, receiver, arguments_) as T;
}

function datumFreeze<T>(value: T): Readonly<T> {
  return datumApply<Readonly<T>>(datumObjectFreeze, Object, [value]);
}

function datumHasOwn(value: object, key: PropertyKey): boolean {
  return datumApply<boolean>(datumObjectHasOwn, Object, [value, key]);
}

function datumKeys(value: object): string[] {
  return datumApply<string[]>(datumObjectKeys, Object, [value]);
}

function datumMapValue<K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
): V | undefined {
  return datumApply<V | undefined>(datumMapGet, map, [key]);
}

function datumSetContains<T>(set: ReadonlySet<T>, value: T): boolean {
  return datumApply<boolean>(datumSetHas, set, [value]);
}

function datumSetInsert<T>(set: Set<T>, value: T): void {
  datumApply<Set<T>>(datumSetAdd, set, [value]);
}

function datumFinite(value: unknown): value is number {
  return datumApply<boolean>(datumNumberIsFinite, Number, [value]);
}

function datumSafeInteger(value: unknown): value is number {
  return datumApply<boolean>(datumNumberIsSafeInteger, Number, [value]);
}

function datumAbs(value: number): number {
  return datumApply<number>(datumMathAbs, Math, [value]);
}

function datumHypot(value: Vec3): number {
  return datumApply<number>(datumMathHypot, Math, [value[0], value[1], value[2]]);
}

function datumMaximum(first: number, second: number, third: number): number {
  return datumApply<number>(datumMathMax, Math, [first, second, third]);
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function jsonPointerSegment(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = datumApply<string>(datumStringCharAt, value, [index]);
    escaped += character === "~" ? "~0" : character === "/" ? "~1" : character;
  }
  return escaped;
}

function datumSort(values: string[]): void {
  datumApply<void>(datumArraySort, values, [lexicalCompare]);
}

function nullRecord<T>(): Record<string, T> {
  return datumApply<Record<string, T>>(datumObjectCreate, Object, [null]);
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  datumApply<void>(datumObjectDefineProperty, Object, [
    record,
    key,
    {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    },
  ]);
}

/** Resource ceilings for source-only datum resolution. @internal */
export interface DatumEvaluationLimitsV7 {
  readonly maxSelectedNodes: number;
  readonly maxParameterOverrides: number;
}

/** @internal */
export const DEFAULT_DATUM_EVALUATION_LIMITS_V7: DatumEvaluationLimitsV7 =
  datumFreeze({
    maxSelectedNodes: 10_000,
    maxParameterOverrides: 10_000,
  });

/** Source-only options for resolving staged v7 datum nodes. @internal */
export interface EvaluateDatumNodesV7Options {
  readonly configuration?: string;
  readonly parameters?: Readonly<Record<string, number>>;
  readonly nodes?: readonly string[];
  readonly evaluationLimits?: Partial<DatumEvaluationLimitsV7>;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

export interface EvaluatedDatumPointV7 {
  readonly kind: "datumPoint";
  readonly node: NodeId;
  readonly position: Vec3;
}

export interface EvaluatedDatumAxisV7 {
  readonly kind: "datumAxis";
  readonly node: NodeId;
  readonly origin: Vec3;
  readonly direction: Vec3;
}

export interface EvaluatedDatumPlaneV7 {
  readonly kind: "datumPlane";
  readonly node: NodeId;
  readonly origin: Vec3;
  readonly xDirection: Vec3;
  readonly yDirection: Vec3;
  readonly normal: Vec3;
}

export interface EvaluatedCoordinateSystemV7 {
  readonly kind: "coordinateSystem";
  readonly node: NodeId;
  readonly origin: Vec3;
  readonly xDirection: Vec3;
  readonly yDirection: Vec3;
  readonly zDirection: Vec3;
}

export type EvaluatedDatumV7 =
  | EvaluatedDatumPointV7
  | EvaluatedDatumAxisV7
  | EvaluatedDatumPlaneV7
  | EvaluatedCoordinateSystemV7;

/** Detached result for selected staged datum nodes. @internal */
export interface EvaluatedDatumNodesV7 {
  readonly configurationId: ConfigurationId | null;
  readonly parameters: Readonly<Record<string, number>>;
  readonly nodeIds: readonly NodeId[];
  readonly datums: Readonly<Record<NodeId, EvaluatedDatumV7>>;
  readonly diagnostics: readonly Diagnostic[];
}

interface CapturedDatumOptions {
  readonly configuration?: string;
  readonly parameters: Readonly<Record<string, number>>;
  readonly nodes?: readonly string[];
  readonly evaluationLimits: DatumEvaluationLimitsV7;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

type DatumNodeIRV7 = Extract<
  NodeIRV7,
  {
    readonly kind:
      | "datumPoint"
      | "datumAxis"
      | "datumPlane"
      | "coordinateSystem";
  }
>;

const DATUM_OPTION_KEYS = datumFreeze([
  "configuration",
  "parameters",
  "nodes",
  "evaluationLimits",
  "documentLimits",
  "signal",
] as const);
const DATUM_EVALUATION_LIMIT_KEYS = datumFreeze([
  "maxSelectedNodes",
  "maxParameterOverrides",
] as const);
const DATUM_DOCUMENT_LIMIT_KEYS = datumFreeze(
  datumKeys(DEFAULT_DESIGN_DOCUMENT_LIMITS),
);

function runtimeIntegrityFailure(): CadResult<never> {
  return failure(
    diagnostic("IR_INVALID", DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE, {
      severity: "error",
      details: {
        phase: DATUM_EVALUATION_PHASE,
        runtimeIntegrity: false,
      },
    }),
  );
}

function abortState(value: unknown): boolean | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    datumAbortSignalAbortedGetter === undefined
  ) {
    return undefined;
  }
  try {
    const state = datumApply<unknown>(
      datumAbortSignalAbortedGetter,
      value,
      [],
    );
    return typeof state === "boolean" ? state : undefined;
  } catch {
    return undefined;
  }
}

function evaluationAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && abortState(signal) !== false;
}

function abortFailure(node?: NodeId): CadResult<never> {
  return failure(
    diagnostic("EVALUATION_ABORTED", "Datum evaluation was aborted", {
      severity: "error",
      ...(node === undefined ? {} : { node, path: `/nodes/${node}` }),
      details: { phase: DATUM_EVALUATION_PHASE },
    }),
  );
}

function postBoundaryFailure(
  signal: AbortSignal | undefined,
  node?: NodeId,
): CadResult<never> | undefined {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  return evaluationAborted(signal) ? abortFailure(node) : undefined;
}

function knownKey(value: string, keys: readonly string[]): boolean {
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === value) return true;
  }
  return false;
}

interface OwnDataCaptureOptions {
  readonly signal?: AbortSignal;
  readonly maximumOwnKeys?: number;
  readonly ownKeyLimitFailure?: (actual: number) => CadResult<never>;
}

function captureOwnDataRecord(
  value: unknown,
  path: string,
  options: OwnDataCaptureOptions = {},
): CadResult<Readonly<Record<string, unknown>>> {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      datumApply<boolean>(datumArrayIsArray, Array, [value])
    ) {
      return failure(
        diagnostic("IR_INVALID", `${path} must be a plain record`, {
          severity: "error",
          path,
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      );
    }
    const prototype = datumApply<object | null>(
      datumObjectGetPrototypeOf,
      Object,
      [value],
    );
    const afterPrototype = postBoundaryFailure(options.signal);
    if (afterPrototype !== undefined) return afterPrototype;
    if (prototype !== null && prototype !== datumObjectPrototype) {
      return failure(
        diagnostic("IR_INVALID", `${path} must be a plain record`, {
          severity: "error",
          path,
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      );
    }
    const keys = datumApply<(string | symbol)[]>(
      datumReflectOwnKeys,
      Reflect,
      [value],
    );
    const afterKeys = postBoundaryFailure(options.signal);
    if (afterKeys !== undefined) return afterKeys;
    if (
      options.maximumOwnKeys !== undefined &&
      keys.length > options.maximumOwnKeys
    ) {
      return (
        options.ownKeyLimitFailure?.(keys.length) ??
        failure(
          diagnostic(
            "IR_INVALID",
            `${path} has too many own properties`,
            {
              severity: "error",
              path,
              details: {
                phase: DATUM_EVALUATION_PHASE,
                limit: options.maximumOwnKeys,
                actual: keys.length,
              },
            },
          ),
        )
      );
    }
    const captured = nullRecord<unknown>();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key !== "string") {
        return failure(
          diagnostic("IR_INVALID", `${path} cannot contain symbol properties`, {
            severity: "error",
            path,
            details: { phase: DATUM_EVALUATION_PHASE },
          }),
        );
      }
      const descriptor = datumApply<PropertyDescriptor | undefined>(
        datumObjectGetOwnPropertyDescriptor,
        Object,
        [value, key],
      );
      const afterDescriptor = postBoundaryFailure(options.signal);
      if (afterDescriptor !== undefined) return afterDescriptor;
      if (descriptor === undefined || !datumHasOwn(descriptor, "value")) {
        return failure(
          diagnostic(
            "IR_INVALID",
            `${path === "/" ? "" : path}/${jsonPointerSegment(key)} must be an own data property`,
            {
              severity: "error",
              path: `${path === "/" ? "" : path}/${jsonPointerSegment(key)}`,
              details: { phase: DATUM_EVALUATION_PHASE },
            },
          ),
        );
      }
      defineRecordValue(captured, key, descriptor.value);
    }
    return success(datumFreeze(captured));
  } catch {
    const afterFailure = postBoundaryFailure(options.signal);
    return (
      afterFailure ??
      failure(
        diagnostic("IR_INVALID", `${path} could not be read safely`, {
          severity: "error",
          path,
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      )
    );
  }
}

function limitFailure(
  resource: keyof DatumEvaluationLimitsV7,
  limit: number,
  actual: number,
  path: string,
): CadResult<never> {
  return failure(
    diagnostic(
      "RESOURCE_LIMIT_EXCEEDED",
      `Datum evaluation limit '${resource}' (${limit}) was exceeded`,
      {
        severity: "error",
        path,
        details: {
          phase: DATUM_EVALUATION_PHASE,
          resource,
          limit,
          actual,
        },
      },
    ),
  );
}

function captureEvaluationLimits(
  value: unknown,
  signal: AbortSignal | undefined,
): CadResult<DatumEvaluationLimitsV7> {
  if (value === undefined) {
    return success(DEFAULT_DATUM_EVALUATION_LIMITS_V7);
  }
  const captured = captureOwnDataRecord(value, "/evaluationLimits", {
    ...(signal === undefined ? {} : { signal }),
    maximumOwnKeys: DATUM_EVALUATION_LIMIT_KEYS.length,
  });
  if (!captured.ok) return captured;
  const normalized: Record<keyof DatumEvaluationLimitsV7, number> = {
    maxSelectedNodes: DEFAULT_DATUM_EVALUATION_LIMITS_V7.maxSelectedNodes,
    maxParameterOverrides:
      DEFAULT_DATUM_EVALUATION_LIMITS_V7.maxParameterOverrides,
  };
  const keys = datumKeys(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!knownKey(key, DATUM_EVALUATION_LIMIT_KEYS)) {
      return failure(
        diagnostic("IR_INVALID", `Unknown datum evaluation limit '${key}'`, {
          severity: "error",
          path: `/evaluationLimits/${jsonPointerSegment(key)}`,
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      );
    }
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !datumSafeInteger(candidate) ||
      candidate < 0
    ) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Datum evaluation limit '${key}' must be a non-negative safe integer`,
          {
            severity: "error",
            path: `/evaluationLimits/${key}`,
            details: { phase: DATUM_EVALUATION_PHASE },
          },
        ),
      );
    }
    normalized[key as keyof DatumEvaluationLimitsV7] = candidate;
  }
  return success(datumFreeze(normalized));
}

function captureParameters(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
): CadResult<Readonly<Record<string, number>>> {
  if (value === undefined) {
    return success(datumFreeze(nullRecord<number>()));
  }
  const captured = captureOwnDataRecord(value, "/parameters", {
    ...(signal === undefined ? {} : { signal }),
    maximumOwnKeys: maximum,
    ownKeyLimitFailure: (actual) =>
      limitFailure(
        "maxParameterOverrides",
        maximum,
        actual,
        "/parameters",
      ),
  });
  if (!captured.ok) return captured;
  const keys = datumKeys(captured.value);
  if (keys.length > maximum) {
    return limitFailure(
      "maxParameterOverrides",
      maximum,
      keys.length,
      "/parameters",
    );
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const candidate = captured.value[key];
    if (typeof candidate !== "number" || !datumFinite(candidate)) {
      return failure(
        diagnostic(
          "EXPRESSION_INVALID",
          `Caller parameter override '${key}' must be a finite number`,
          {
            severity: "error",
            path: `/parameters/${jsonPointerSegment(key)}`,
            details: { phase: DATUM_EVALUATION_PHASE },
          },
        ),
      );
    }
  }
  return success(
    captured.value as Readonly<Record<string, number>>,
  );
}

function captureNodes(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
): CadResult<readonly string[] | undefined> {
  if (value === undefined) return success(undefined);
  try {
    if (!datumApply<boolean>(datumArrayIsArray, Array, [value])) {
      return failure(
        diagnostic("IR_INVALID", "nodes must be an array", {
          severity: "error",
          path: "/nodes",
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      );
    }
    const lengthDescriptor = datumApply<PropertyDescriptor | undefined>(
      datumObjectGetOwnPropertyDescriptor,
      Object,
      [value, "length"],
    );
    const afterLength = postBoundaryFailure(signal);
    if (afterLength !== undefined) return afterLength;
    const length = lengthDescriptor?.value;
    if (
      typeof length !== "number" ||
      !datumSafeInteger(length) ||
      length < 0
    ) {
      return failure(
        diagnostic("IR_INVALID", "nodes has an invalid array length", {
          severity: "error",
          path: "/nodes",
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      );
    }
    if (length > maximum) {
      return limitFailure("maxSelectedNodes", maximum, length, "/nodes");
    }
    const captured = new DatumArray<string>(length);
    const seen = new DatumSet<string>();
    const allowedKeys = new DatumSet<string>();
    datumSetInsert(allowedKeys, "length");
    let capturedLength = 0;
    for (let index = 0; index < length; index += 1) {
      datumSetInsert(allowedKeys, `${index}`);
      const descriptor = datumApply<PropertyDescriptor | undefined>(
        datumObjectGetOwnPropertyDescriptor,
        Object,
        [value, `${index}`],
      );
      const afterDescriptor = postBoundaryFailure(signal);
      if (afterDescriptor !== undefined) return afterDescriptor;
      if (
        descriptor === undefined ||
        !datumHasOwn(descriptor, "value") ||
        typeof descriptor.value !== "string"
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            `nodes[${index}] must be an own string data property`,
            {
              severity: "error",
              path: `/nodes/${index}`,
              details: { phase: DATUM_EVALUATION_PHASE },
            },
          ),
        );
      }
      if (!datumSetContains(seen, descriptor.value)) {
        datumSetInsert(seen, descriptor.value);
        captured[capturedLength] = descriptor.value;
        capturedLength += 1;
      }
    }
    captured.length = capturedLength;
    const keys = datumApply<(string | symbol)[]>(
      datumReflectOwnKeys,
      Reflect,
      [value],
    );
    const afterKeys = postBoundaryFailure(signal);
    if (afterKeys !== undefined) return afterKeys;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (
        typeof key !== "string" ||
        !datumSetContains(allowedKeys, key)
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            "nodes cannot contain non-index properties",
            {
              severity: "error",
              path: "/nodes",
              details: { phase: DATUM_EVALUATION_PHASE },
            },
          ),
        );
      }
    }
    if (keys.length !== length + 1) {
      return failure(
        diagnostic(
          "IR_INVALID",
          "nodes must contain every index exactly once",
          {
            severity: "error",
            path: "/nodes",
            details: { phase: DATUM_EVALUATION_PHASE },
          },
        ),
      );
    }
    return success(datumFreeze(captured));
  } catch {
    const afterFailure = postBoundaryFailure(signal);
    return (
      afterFailure ??
      failure(
        diagnostic("IR_INVALID", "nodes could not be read safely", {
          severity: "error",
          path: "/nodes",
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      )
    );
  }
}

function captureDocumentLimits(
  value: unknown,
  signal: AbortSignal | undefined,
): CadResult<Partial<DesignDocumentLimits> | undefined> {
  if (value === undefined) return success(undefined);
  const captured = captureOwnDataRecord(value, "/documentLimits", {
    ...(signal === undefined ? {} : { signal }),
    maximumOwnKeys: DATUM_DOCUMENT_LIMIT_KEYS.length,
  });
  if (!captured.ok) return captured;
  const keys = datumKeys(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!knownKey(key, DATUM_DOCUMENT_LIMIT_KEYS)) {
      return failure(
        diagnostic("IR_INVALID", `Unknown document limit '${key}'`, {
          severity: "error",
          path: `/documentLimits/${jsonPointerSegment(key)}`,
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      );
    }
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !datumSafeInteger(candidate) ||
      candidate < 0
    ) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Document limit '${key}' must be a non-negative safe integer`,
          {
            severity: "error",
            path: `/documentLimits/${key}`,
            details: { phase: DATUM_EVALUATION_PHASE },
          },
        ),
      );
    }
  }
  return success(
    captured.value as Partial<DesignDocumentLimits>,
  );
}

function captureOptions(value: unknown): CadResult<CapturedDatumOptions> {
  const captured = captureOwnDataRecord(value, "/", {
    maximumOwnKeys: DATUM_OPTION_KEYS.length,
  });
  if (!captured.ok) return captured;
  const keys = datumKeys(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!knownKey(key, DATUM_OPTION_KEYS)) {
      return failure(
        diagnostic("IR_INVALID", `Unknown datum evaluation option '${key}'`, {
          severity: "error",
          path: `/${jsonPointerSegment(key)}`,
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      );
    }
  }
  const rawSignal = captured.value.signal;
  if (rawSignal !== undefined && abortState(rawSignal) === undefined) {
    return failure(
      diagnostic("IR_INVALID", "signal must be an AbortSignal", {
        severity: "error",
        path: "/signal",
        details: { phase: DATUM_EVALUATION_PHASE },
      }),
    );
  }
  const signal =
    rawSignal === undefined ? undefined : rawSignal as AbortSignal;
  const afterSignal = postBoundaryFailure(signal);
  if (afterSignal !== undefined) return afterSignal;
  const configuration = captured.value.configuration;
  if (configuration !== undefined && typeof configuration !== "string") {
    return failure(
      diagnostic("IR_INVALID", "configuration must be a string", {
        severity: "error",
        path: "/configuration",
        details: { phase: DATUM_EVALUATION_PHASE },
      }),
    );
  }
  const limits = captureEvaluationLimits(
    captured.value.evaluationLimits,
    signal,
  );
  if (!limits.ok) return limits;
  const parameters = captureParameters(
    captured.value.parameters,
    limits.value.maxParameterOverrides,
    signal,
  );
  if (!parameters.ok) return parameters;
  const nodes = captureNodes(
    captured.value.nodes,
    limits.value.maxSelectedNodes,
    signal,
  );
  if (!nodes.ok) return nodes;
  const documentLimits = captureDocumentLimits(
    captured.value.documentLimits,
    signal,
  );
  if (!documentLimits.ok) return documentLimits;
  return success(
    datumFreeze({
      ...(configuration === undefined ? {} : { configuration }),
      parameters: parameters.value,
      ...(nodes.value === undefined ? {} : { nodes: nodes.value }),
      evaluationLimits: limits.value,
      ...(documentLimits.value === undefined
        ? {}
        : { documentLimits: documentLimits.value }),
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

function isDatumNode(node: NodeIRV7): node is DatumNodeIRV7 {
  return (
    node.kind === "datumPoint" ||
    node.kind === "datumAxis" ||
    node.kind === "datumPlane" ||
    node.kind === "coordinateSystem"
  );
}

function vectorDot(first: Vec3, second: Vec3): number {
  return (
    first[0] * second[0] +
    first[1] * second[1] +
    first[2] * second[2]
  );
}

function vectorCross(first: Vec3, second: Vec3): Vec3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function normalizedVector(value: Vec3): Vec3 | undefined {
  if (
    !datumFinite(value[0]) ||
    !datumFinite(value[1]) ||
    !datumFinite(value[2])
  ) {
    return undefined;
  }
  const scale = datumMaximum(
    datumAbs(value[0]),
    datumAbs(value[1]),
    datumAbs(value[2]),
  );
  if (!(scale > 0) || !datumFinite(scale)) return undefined;
  const scaled: Vec3 = [
    value[0] / scale,
    value[1] / scale,
    value[2] / scale,
  ];
  const magnitude = datumHypot(scaled);
  if (!(magnitude > 0) || !datumFinite(magnitude)) return undefined;
  return [
    scaled[0] / magnitude,
    scaled[1] / magnitude,
    scaled[2] / magnitude,
  ];
}

function evaluateVector(
  values: readonly [ExpressionIR, ExpressionIR, ExpressionIR],
  parameterValues: ReadonlyMap<ParameterId, number>,
): Vec3 {
  const expression = (value: ExpressionIR): number =>
    evaluateExpression(value, {
      resolveParameter: (id) => {
        const resolved = datumMapValue(parameterValues, id);
        if (resolved === undefined) {
          throw new Error(`Unresolved parameter '${id}'`);
        }
        return resolved;
      },
    });
  return [expression(values[0]), expression(values[1]), expression(values[2])];
}

function featureFailure(
  node: NodeId,
  path: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): CadResult<never> {
  return failure(
    diagnostic("FEATURE_INVALID", message, {
      severity: "error",
      node,
      path: `/nodes/${node}/${path}`,
      details: {
        phase: DATUM_EVALUATION_PHASE,
        ...details,
      },
    }),
  );
}

function evaluateDatumNode(
  id: NodeId,
  node: DatumNodeIRV7,
  parameterValues: ReadonlyMap<ParameterId, number>,
): CadResult<EvaluatedDatumV7> {
  let origin: Vec3;
  try {
    origin = evaluateVector(
      node.kind === "datumPoint" ? node.position : node.origin,
      parameterValues,
    );
  } catch (error) {
    return failure(
      diagnostic(
        "EXPRESSION_INVALID",
        node.kind === "datumPoint"
          ? `Datum point '${id}' position could not be resolved: ${safeErrorMessage(error)}`
          : `Datum '${id}' origin could not be resolved: ${safeErrorMessage(error)}`,
        {
          severity: "error",
          node: id,
          path:
            node.kind === "datumPoint"
              ? `/nodes/${id}/position`
              : `/nodes/${id}/origin`,
          details: { phase: DATUM_EVALUATION_PHASE },
        },
      ),
    );
  }
  if (!datumFinite(origin[0]) || !datumFinite(origin[1]) || !datumFinite(origin[2])) {
    return featureFailure(
      id,
      node.kind === "datumPoint" ? "position" : "origin",
      node.kind === "datumPoint"
        ? `Datum point '${id}' position must resolve to finite coordinates`
        : `Datum '${id}' origin must resolve to finite coordinates`,
    );
  }
  if (node.kind === "datumPoint") {
    return success(
      deepFreeze({
        kind: "datumPoint",
        node: id,
        position: origin,
      }),
    );
  }

  let firstAuthored: Vec3;
  try {
    firstAuthored = evaluateVector(
      node.kind === "datumAxis" ? node.direction : node.xDirection,
      parameterValues,
    );
  } catch (error) {
    return failure(
      diagnostic("EXPRESSION_INVALID", safeErrorMessage(error), {
        severity: "error",
        node: id,
        path:
          node.kind === "datumAxis"
            ? `/nodes/${id}/direction`
            : `/nodes/${id}/xDirection`,
        details: { phase: DATUM_EVALUATION_PHASE },
      }),
    );
  }
  const first = normalizedVector(firstAuthored);
  if (first === undefined) {
    return featureFailure(
      id,
      node.kind === "datumAxis" ? "direction" : "xDirection",
      `Datum '${id}' direction must resolve to a finite nonzero vector`,
    );
  }
  if (node.kind === "datumAxis") {
    return success(
      deepFreeze({
        kind: "datumAxis",
        node: id,
        origin,
        direction: first,
      }),
    );
  }

  let secondAuthored: Vec3;
  try {
    secondAuthored = evaluateVector(
      node.kind === "datumPlane" ? node.normal : node.yDirection,
      parameterValues,
    );
  } catch (error) {
    return failure(
      diagnostic("EXPRESSION_INVALID", safeErrorMessage(error), {
        severity: "error",
        node: id,
        path:
          node.kind === "datumPlane"
            ? `/nodes/${id}/normal`
            : `/nodes/${id}/yDirection`,
        details: { phase: DATUM_EVALUATION_PHASE },
      }),
    );
  }
  const second = normalizedVector(secondAuthored);
  if (second === undefined) {
    return featureFailure(
      id,
      node.kind === "datumPlane" ? "normal" : "yDirection",
      `Datum '${id}' direction must resolve to a finite nonzero vector`,
    );
  }
  const dot = vectorDot(first, second);
  if (!datumFinite(dot) || datumAbs(dot) > DATUM_ORTHOGONALITY_TOLERANCE) {
    return featureFailure(
      id,
      node.kind === "datumPlane" ? "xDirection" : "yDirection",
      `Datum '${id}' frame directions must be perpendicular`,
      {
        dot,
        tolerance: DATUM_ORTHOGONALITY_TOLERANCE,
      },
    );
  }

  if (node.kind === "datumPlane") {
    const projectedX = normalizedVector([
      first[0] - second[0] * dot,
      first[1] - second[1] * dot,
      first[2] - second[2] * dot,
    ]);
    if (projectedX === undefined) {
      return featureFailure(
        id,
        "xDirection",
        `Datum '${id}' plane frame is degenerate`,
      );
    }
    const yDirection = normalizedVector(vectorCross(second, projectedX));
    if (yDirection === undefined) {
      return featureFailure(
        id,
        "xDirection",
        `Datum '${id}' plane frame is degenerate`,
      );
    }
    return success(
      deepFreeze({
        kind: "datumPlane",
        node: id,
        origin,
        xDirection: projectedX,
        yDirection,
        normal: second,
      }),
    );
  }

  const zDirection = normalizedVector(vectorCross(first, second));
  if (zDirection === undefined) {
    return featureFailure(
      id,
      "yDirection",
      `Datum '${id}' coordinate frame is degenerate`,
    );
  }
  const yDirection = normalizedVector(vectorCross(zDirection, first));
  if (yDirection === undefined) {
    return featureFailure(
      id,
      "yDirection",
      `Datum '${id}' coordinate frame is degenerate`,
    );
  }
  return success(
    deepFreeze({
      kind: "coordinateSystem",
      node: id,
      origin,
      xDirection: first,
      yDirection,
      zDirection,
    }),
  );
}

/**
 * Resolves selected staged document-v7 datum nodes without a geometry kernel.
 *
 * Datum kinds remain construction nodes rather than design outputs, so
 * selection is by node ID. The source export is deliberately absent from the
 * package root while document v7 remains staged.
 *
 * @internal
 */
export function evaluateDatumNodesV7(
  inputDocument: DesignDocumentV7,
  inputOptions: EvaluateDatumNodesV7Options = {},
): CadResult<EvaluatedDatumNodesV7> {
  if (!documentV7RuntimeIntrinsicsAreIntact()) {
    return runtimeIntegrityFailure();
  }
  const capturedOptions = captureOptions(inputOptions);
  if (!capturedOptions.ok) return capturedOptions;
  const options = capturedOptions.value;
  const afterOptions = postBoundaryFailure(options.signal);
  if (afterOptions !== undefined) return afterOptions;

  const parsed = parseDocumentValueV7(
    inputDocument,
    options.documentLimits === undefined
      ? {}
      : { limits: options.documentLimits },
  );
  const afterDocument = postBoundaryFailure(options.signal);
  if (afterDocument !== undefined) return afterDocument;
  if (!parsed.ok) return parsed;
  const document = parsed.value;

  const requested: string[] = [];
  if (options.nodes === undefined) {
    const nodeIds = datumKeys(document.nodes);
    for (let index = 0; index < nodeIds.length; index += 1) {
      const id = nodeIds[index]!;
      if (isDatumNode(document.nodes[id as NodeId]!)) {
        if (
          requested.length >= options.evaluationLimits.maxSelectedNodes
        ) {
          return limitFailure(
            "maxSelectedNodes",
            options.evaluationLimits.maxSelectedNodes,
            requested.length + 1,
            "/nodes",
          );
        }
        requested[requested.length] = id;
      }
    }
    datumSort(requested);
  } else {
    for (let index = 0; index < options.nodes.length; index += 1) {
      requested[requested.length] = options.nodes[index]!;
    }
  }

  const selected = new DatumArray<readonly [NodeId, DatumNodeIRV7]>(
    requested.length,
  );
  for (let index = 0; index < requested.length; index += 1) {
    const rawId = requested[index]!;
    const id = rawId as NodeId;
    const node = datumHasOwn(document.nodes, id)
      ? document.nodes[id]
      : undefined;
    if (node === undefined) {
      return failure(
        diagnostic("REFERENCE_MISSING", `Unknown datum node '${rawId}'`, {
          severity: "error",
          path: `/nodes/${jsonPointerSegment(rawId)}`,
          details: { phase: DATUM_EVALUATION_PHASE },
        }),
      );
    }
    if (!isDatumNode(node)) {
      return failure(
        diagnostic(
          "REFERENCE_KIND_MISMATCH",
          `Node '${rawId}' is '${node.kind}', not a datum node`,
          {
            severity: "error",
            node: id,
              path: `/nodes/${jsonPointerSegment(rawId)}`,
            details: {
              phase: DATUM_EVALUATION_PHASE,
              actual: node.kind,
            },
          },
        ),
      );
    }
    selected[index] = [id, node];
  }

  let selectedConfigurationId: ConfigurationId | null = null;
  let selectedConfiguration: DesignConfigurationIR | undefined;
  if (options.configuration !== undefined) {
    if (
      !datumHasOwn(document.configurations ?? {}, options.configuration)
    ) {
      return failure(
        diagnostic(
          "CONFIGURATION_MISSING",
          `Unknown configuration '${options.configuration}'`,
          {
            severity: "error",
            path: `/configurations/${jsonPointerSegment(options.configuration)}`,
            details: { phase: DATUM_EVALUATION_PHASE },
          },
        ),
      );
    }
    selectedConfigurationId = options.configuration as ConfigurationId;
    selectedConfiguration =
      document.configurations![selectedConfigurationId];
  }

  const callerParameterIds = datumKeys(options.parameters);
  for (let index = 0; index < callerParameterIds.length; index += 1) {
    const id = callerParameterIds[index]!;
    if (datumHasOwn(document.parameters, id)) continue;
    return failure(
      diagnostic(
        "PARAMETER_MISSING",
        `Unknown parameter override '${id}'`,
        {
          severity: "error",
          path: `/parameters/${jsonPointerSegment(id)}`,
          details: { phase: DATUM_EVALUATION_PHASE },
        },
      ),
    );
  }

  let parameterResult: ReturnType<typeof resolveEvaluationParameters>;
  try {
    parameterResult = resolveEvaluationParameters(
      document,
      options.parameters,
      selectedConfigurationId,
      selectedConfiguration,
    );
  } catch (error) {
    const afterParameters = postBoundaryFailure(options.signal);
    if (afterParameters !== undefined) return afterParameters;
    return failure(
      diagnostic(
        "EXPRESSION_INVALID",
        safeErrorMessage(
          error,
          "Datum parameters could not be resolved safely",
        ),
        {
          severity: "error",
          path: "/parameters",
          details: { phase: DATUM_EVALUATION_PHASE },
        },
      ),
    );
  }
  const afterParameters = postBoundaryFailure(options.signal);
  if (afterParameters !== undefined) return afterParameters;
  if (!parameterResult.ok) return parameterResult;

  const diagnostics: Diagnostic[] = [
    ...parsed.diagnostics,
    ...parameterResult.diagnostics,
  ];
  const datums = nullRecord<EvaluatedDatumV7>();
  const nodeIds = new DatumArray<NodeId>(selected.length);
  for (let index = 0; index < selected.length; index += 1) {
    const [id, node] = selected[index]!;
    const afterSelection = postBoundaryFailure(options.signal, id);
    if (afterSelection !== undefined) return afterSelection;
    const evaluated = evaluateDatumNode(
      id,
      node,
      parameterResult.value.values,
    );
    const afterEvaluation = postBoundaryFailure(options.signal, id);
    if (afterEvaluation !== undefined) return afterEvaluation;
    if (!evaluated.ok) {
      return {
        ok: false,
        diagnostics: [...diagnostics, ...evaluated.diagnostics],
      };
    }
    nodeIds[index] = id;
    defineRecordValue(datums, id, evaluated.value);
  }

  const parameters = nullRecord<number>();
  datumApply<void>(
    datumMapForEach,
    parameterResult.value.values,
    [
      (value: number, id: ParameterId): void => {
        defineRecordValue(parameters, id, value);
      },
    ],
  );
  const frozenDiagnostics = deepFreeze(diagnostics);
  const value = deepFreeze({
    configurationId: selectedConfigurationId,
    parameters,
    nodeIds,
    datums,
    diagnostics: frozenDiagnostics,
  });
  const afterResult = postBoundaryFailure(options.signal);
  return afterResult ?? success(value, frozenDiagnostics);
}
