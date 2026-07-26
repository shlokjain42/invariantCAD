import type {
  ConfigurationId,
  EntityId,
  NodeId,
  ParameterId,
  ResourceId,
} from "../core/ids.js";
import { deepFreeze } from "../core/json.js";
import {
  IDENTITY_MATRIX,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  translationMatrix,
  type Mat4,
  type Vec3,
} from "../core/math.js";
import {
  CadError,
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
  executePreparedPartOutputsV7,
  preparePartOutputsV7,
  preflightPreparedPartOutputsV7,
  type EvaluatedPartDesignV7,
  type EvaluatedPartV7,
  type MassDensitySource,
  type PreparedPartKernelAccessV7,
  type PreparedPartOutputsV7,
} from "../evaluator.js";
import { exportMesh, type MeshExportFormat } from "../exporters.js";
import { evaluateExpression, type ExpressionIR } from "../expressions.js";
import type {
  AssemblyNodeIRV7,
  DesignConfigurationIR,
  DesignDocumentV7,
  PartNodeIRV7,
  ResourceDigestIR,
  TransformOperationIR,
} from "../ir.js";
import {
  mergeMeshes,
  transformMesh,
  type GeometryKernel,
  type MeshData,
  type MeshOptions,
} from "../kernel.js";
import {
  combinePhysicalMassProperties,
  type PhysicalMassProperties,
} from "../mass-properties.js";
import {
  DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7,
  type DocumentV7ResourceScope,
  type ResourceResolutionLimitsV7,
  type ResourceResolverV7,
} from "../resource-resolution.js";
import {
  admitDocumentBytesToV7,
  parseDocumentValueV7,
  type AdmittedDocumentSourceVersion,
} from "../serialization.js";
import { transformMassProperties } from "./mesh-mass-properties.js";
import {
  DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE,
  documentV7RuntimeIntrinsicsAreIntact,
} from "./document-v7-runtime-integrity.js";
import {
  createDocumentV7ResourceResolutionSession,
  type DocumentV7ResourceResolutionBatch,
  type ResolvedDocumentResourcesV7,
} from "./document-v7-resource-resolution-session.js";
import { resolveEvaluationParameters } from "./evaluation-parameters.js";

const LOCAL_ASSEMBLY_EVALUATION_PHASE =
  "documentV7LocalAssemblyEvaluation";

const LocalAssemblyArray = Array;
const LocalAssemblyArrayBuffer = ArrayBuffer;
const localAssemblyArrayBufferPrototype =
  LocalAssemblyArrayBuffer.prototype;
const localAssemblyArrayBufferByteLengthGetter =
  Object.getOwnPropertyDescriptor(
    localAssemblyArrayBufferPrototype,
    "byteLength",
  )?.get;
const localAssemblyArrayPrototype = Array.prototype;
const localAssemblyArrayIsArray = Array.isArray;
const localAssemblyArraySort = Array.prototype.sort;
const LocalAssemblyFloat32Array = Float32Array;
const localAssemblyFloat32ArrayPrototype = Float32Array.prototype;
const LocalAssemblyMap = Map;
const localAssemblyMapGet = Map.prototype.get;
const localAssemblyMapHas = Map.prototype.has;
const localAssemblyMapSet = Map.prototype.set;
const LocalAssemblySet = Set;
const localAssemblySetAdd = Set.prototype.add;
const localAssemblySetHas = Set.prototype.has;
const LocalAssemblyWeakMap = WeakMap;
const localAssemblyWeakMapGet = WeakMap.prototype.get;
const localAssemblyWeakMapSet = WeakMap.prototype.set;
const localAssemblyNumberIsFinite = Number.isFinite;
const localAssemblyNumberIsSafeInteger = Number.isSafeInteger;
const localAssemblyObjectCreate = Object.create;
const localAssemblyObjectDefineProperty = Object.defineProperty;
const localAssemblyObjectFreeze = Object.freeze;
const localAssemblyObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const localAssemblyObjectGetPrototypeOf = Object.getPrototypeOf;
const localAssemblyObjectHasOwn = Object.hasOwn;
const localAssemblyObjectKeys = Object.keys;
const localAssemblyObjectPrototype = Object.prototype;
const localAssemblyReflectApply = Reflect.apply;
const localAssemblyReflectOwnKeys = Reflect.ownKeys;
const localAssemblyStringCharAt = String.prototype.charAt;
const localAssemblyStringSlice = String.prototype.slice;
const localAssemblyStringTrim = String.prototype.trim;
const localAssemblyMathAbs = Math.abs;
const localAssemblyMathHypot = Math.hypot;
const LocalAssemblyUint32Array = Uint32Array;
const localAssemblyUint32ArrayPrototype = Uint32Array.prototype;
const localAssemblyTypedArrayPrototype =
  Object.getPrototypeOf(Uint8Array.prototype);
const localAssemblyTypedArrayLengthGetter =
  Object.getOwnPropertyDescriptor(
    localAssemblyTypedArrayPrototype,
    "length",
  )?.get;
const localAssemblyTypedArrayBufferGetter =
  Object.getOwnPropertyDescriptor(
    localAssemblyTypedArrayPrototype,
    "buffer",
  )?.get;
const LocalAssemblyUint8Array = Uint8Array;
const localAssemblyAbortSignalAbortedGetter =
  typeof AbortSignal === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
        AbortSignal.prototype,
        "aborted",
      )?.get;

function localAssemblyApply<T>(
  method: CallableFunction,
  receiver: unknown,
  arguments_: readonly unknown[],
): T {
  return localAssemblyReflectApply(
    method,
    receiver,
    arguments_,
  ) as T;
}

function localAssemblyFreeze<T>(value: T): Readonly<T> {
  return localAssemblyApply<Readonly<T>>(
    localAssemblyObjectFreeze,
    Object,
    [value],
  );
}

function localAssemblyHasOwn(
  value: object,
  key: PropertyKey,
): boolean {
  return localAssemblyApply<boolean>(
    localAssemblyObjectHasOwn,
    Object,
    [value, key],
  );
}

function localAssemblyKeys(value: object): string[] {
  return localAssemblyApply<string[]>(
    localAssemblyObjectKeys,
    Object,
    [value],
  );
}

function localAssemblyMapValue<K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
): V | undefined {
  return localAssemblyApply<V | undefined>(
    localAssemblyMapGet,
    map,
    [key],
  );
}

function localAssemblyMapContains<K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
): boolean {
  return localAssemblyApply<boolean>(
    localAssemblyMapHas,
    map,
    [key],
  );
}

function localAssemblyMapInsert<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
): void {
  localAssemblyApply<Map<K, V>>(
    localAssemblyMapSet,
    map,
    [key, value],
  );
}

function localAssemblyWeakMapValue<K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
): V | undefined {
  return localAssemblyApply<V | undefined>(
    localAssemblyWeakMapGet,
    map,
    [key],
  );
}

function localAssemblyWeakMapInsert<K extends object, V>(
  map: WeakMap<K, V>,
  key: K,
  value: V,
): void {
  localAssemblyApply<WeakMap<K, V>>(
    localAssemblyWeakMapSet,
    map,
    [key, value],
  );
}

function localAssemblySetContains<T>(
  set: ReadonlySet<T>,
  value: T,
): boolean {
  return localAssemblyApply<boolean>(
    localAssemblySetHas,
    set,
    [value],
  );
}

function localAssemblySetInsert<T>(
  set: Set<T>,
  value: T,
): void {
  localAssemblyApply<Set<T>>(
    localAssemblySetAdd,
    set,
    [value],
  );
}

function localAssemblyFinite(value: unknown): value is number {
  return localAssemblyApply<boolean>(
    localAssemblyNumberIsFinite,
    Number,
    [value],
  );
}

function localAssemblySafeInteger(value: unknown): value is number {
  return localAssemblyApply<boolean>(
    localAssemblyNumberIsSafeInteger,
    Number,
    [value],
  );
}

function localAssemblyNullRecord<T>(): Record<string, T> {
  return localAssemblyApply<Record<string, T>>(
    localAssemblyObjectCreate,
    Object,
    [null],
  );
}

function defineRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
): void {
  localAssemblyApply<void>(
    localAssemblyObjectDefineProperty,
    Object,
    [
      record,
      key,
      {
        configurable: true,
        enumerable: true,
        writable: true,
        value,
      },
    ],
  );
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function lexicallySortedKeys(value: object): string[] {
  const keys = localAssemblyKeys(value);
  localAssemblyApply<void>(localAssemblyArraySort, keys, [
    lexicalCompare,
  ]);
  return keys;
}

function jsonPointerSegment(value: string): string {
  let escaped = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = localAssemblyApply<string>(
      localAssemblyStringCharAt,
      value,
      [index],
    );
    escaped +=
      character === "~" ? "~0" : character === "/" ? "~1" : character;
  }
  return escaped;
}

function trimmed(value: string): string {
  return localAssemblyApply<string>(
    localAssemblyStringTrim,
    value,
    [],
  );
}

function contextKey(
  node: NodeId,
  configurationId: ConfigurationId | null,
): string {
  return `${configurationId ?? ""}\u0000${node}`;
}

function externalContextKey(
  resource: ResourceId,
  output: string,
  configurationId: ConfigurationId | null,
): string {
  return `external\u0000${resource}\u0000${output}\u0000${configurationId ?? ""}`;
}

/** Work ceilings for source-only local assembly evaluation. @internal */
export interface LocalAssemblyEvaluationLimitsV7 {
  readonly maxSelectedOutputs: number;
  readonly maxParameterOverrides: number;
  readonly maxAssemblyDepth: number;
  readonly maxScannedInstances: number;
  readonly maxActiveOccurrences: number;
  readonly maxOccurrencePathSegments: number;
  readonly maxPlacementOperations: number;
  readonly maxExternalDocuments: number;
  readonly maxContextualParts: number;
  readonly maxPartBodies: number;
  readonly maxDistinctSolids: number;
  readonly maxSolidGraphNodes: number;
  readonly maxSolidDependencyLinks: number;
  readonly maxTransformOperations: number;
  readonly maxResolvedMaterials: number;
}

/** @internal */
export const DEFAULT_LOCAL_ASSEMBLY_EVALUATION_LIMITS_V7:
  LocalAssemblyEvaluationLimitsV7 = localAssemblyFreeze({
    maxSelectedOutputs: 10_000,
    maxParameterOverrides: 10_000,
    maxAssemblyDepth: 64,
    maxScannedInstances: 100_000,
    maxActiveOccurrences: 100_000,
    maxOccurrencePathSegments: 1_000_000,
    maxPlacementOperations: 100_000,
    maxExternalDocuments: 1_024,
    maxContextualParts: 100_000,
    maxPartBodies: 100_000,
    maxDistinctSolids: 100_000,
    maxSolidGraphNodes: 100_000,
    maxSolidDependencyLinks: 100_000,
    maxTransformOperations: 100_000,
    maxResolvedMaterials: 100_000,
  });

/** Source-only options for direct local Document v7 assemblies. @internal */
export interface EvaluateLocalAssemblyOutputsV7Options {
  readonly configuration?: string;
  readonly parameters?: Readonly<Record<string, number>>;
  readonly outputs?: readonly string[];
  readonly resolver?: ResourceResolverV7;
  readonly evaluationLimits?: Partial<LocalAssemblyEvaluationLimitsV7>;
  readonly resourceLimits?: Partial<ResourceResolutionLimitsV7>;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

/** One active local-part leaf in a bounded local occurrence tree. @internal */
export type ProductPartComponentV7 =
  | {
      readonly source: "local";
      readonly partNode: NodeId;
    }
  | {
      readonly source: "external";
      readonly resource: ResourceId;
      readonly digest: ResourceDigestIR;
      readonly byteLength: number;
      readonly output: string;
      readonly outputKind: "part";
      readonly sourceVersion: AdmittedDocumentSourceVersion;
      readonly partNode: NodeId;
    };

/** One active part leaf in a bounded product occurrence tree. @internal */
export interface EvaluatedLocalOccurrenceV7 {
  readonly id: EntityId;
  readonly path: readonly EntityId[];
  readonly component: ProductPartComponentV7;
  /** Compatibility alias for the document-scoped node in `component`. */
  readonly partNode: NodeId;
  readonly effectiveConfigurationId: ConfigurationId | null;
  /** Compatibility alias for `effectiveConfigurationId`. */
  readonly configurationId: ConfigurationId | null;
  readonly part: EvaluatedPartV7;
  readonly transform: Mat4;
}

interface EvaluatedOccurrenceProvenanceV7 {
  readonly parentNode: NodeId;
  readonly componentPath: string;
}

const evaluatedOccurrenceProvenanceV7 =
  new LocalAssemblyWeakMap<
    EvaluatedLocalOccurrenceV7,
    EvaluatedOccurrenceProvenanceV7
  >();

function evaluatedOccurrenceProvenance(
  occurrence: EvaluatedLocalOccurrenceV7,
): EvaluatedOccurrenceProvenanceV7 | undefined {
  return localAssemblyWeakMapValue(
    evaluatedOccurrenceProvenanceV7,
    occurrence,
  );
}

/** One context-distinct local assembly BOM row. @internal */
export interface ContextualBillOfMaterialsItemV7 {
  readonly component: ProductPartComponentV7;
  readonly partNode: string;
  readonly effectiveConfigurationId: string | null;
  readonly partNumber: string | null;
  readonly description: string | null;
  readonly materialId: string | null;
  readonly material: string | null;
  readonly quantity: number;
  readonly occurrencePaths: readonly (readonly EntityId[])[];
  readonly massDensity: number | null;
  readonly massDensitySource: MassDensitySource | null;
  readonly definitionMass: number | null;
  readonly totalMass: number | null;
}

/** Context-preserving BOM for one bounded local assembly tree. @internal */
export interface ContextualBillOfMaterialsV7 {
  readonly rootConfigurationId: string | null;
  readonly units: { readonly mass: "kg" };
  readonly items: readonly ContextualBillOfMaterialsItemV7[];
  readonly totalQuantity: number;
  readonly massComplete: boolean;
  readonly knownMass: number;
  readonly totalMass: number | null;
}

interface CapturedLocalAssemblyOptions {
  readonly configuration?: string;
  readonly parameters: Readonly<Record<string, number>>;
  readonly outputs?: readonly string[];
  readonly resolver?: ResourceResolverV7;
  readonly evaluationLimits: LocalAssemblyEvaluationLimitsV7;
  readonly resourceLimits?: Partial<ResourceResolutionLimitsV7>;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

interface SelectedOccurrenceBase {
  readonly id: EntityId;
  readonly path: readonly EntityId[];
  readonly parentNode: NodeId;
  readonly componentPath: string;
  readonly configurationId: ConfigurationId | null;
  readonly transform: Mat4;
}

interface SelectedLocalOccurrence extends SelectedOccurrenceBase {
  readonly source: "local";
  readonly partNode: NodeId;
}

interface SelectedExternalOccurrence extends SelectedOccurrenceBase {
  readonly source: "external";
  readonly resource: ResourceId;
  readonly output: string;
  readonly outputKind: "part";
}

type SelectedOccurrence =
  | SelectedLocalOccurrence
  | SelectedExternalOccurrence;

interface ResolvedSelectedOccurrence extends SelectedOccurrenceBase {
  readonly component: ProductPartComponentV7;
  readonly partNode: NodeId;
  readonly evaluationKey: string;
}

interface SelectedAssembly {
  readonly name: string;
  readonly node: NodeId;
  readonly occurrences: readonly SelectedOccurrence[];
}

interface ResolvedSelectedAssembly {
  readonly name: string;
  readonly node: NodeId;
  readonly occurrences: readonly ResolvedSelectedOccurrence[];
}

interface ResolvedExternalDocumentV7 {
  readonly resource: ResourceId;
  readonly scope: DocumentV7ResourceScope;
  readonly digest: ResourceDigestIR;
  readonly byteLength: number;
  readonly sourceVersion: AdmittedDocumentSourceVersion;
  readonly document: DesignDocumentV7;
}

interface ExternalPartEvaluationBatchV7 {
  readonly key: string;
  readonly external: ResolvedExternalDocumentV7;
  readonly configurationId: ConfigurationId | null;
  readonly outputs: Set<string>;
  readonly firstOccurrence: SelectedExternalOccurrence;
  readonly firstOccurrencesByOutput: Map<
    string,
    SelectedExternalOccurrence
  >;
}

type PendingProductPartBatchV7 =
  | {
      readonly source: "local";
      readonly key: string;
      readonly scope: DocumentV7ResourceScope;
      readonly configurationId: ConfigurationId | null;
      readonly outputs: readonly string[];
      readonly prepared: PreparedPartOutputsV7;
    }
  | {
      readonly source: "external";
      readonly key: string;
      readonly scope: DocumentV7ResourceScope;
      readonly configurationId: ConfigurationId | null;
      readonly outputs: readonly string[];
      readonly prepared: PreparedPartOutputsV7;
      readonly external: ResolvedExternalDocumentV7;
      readonly firstOccurrence: SelectedExternalOccurrence;
      readonly batch: ExternalPartEvaluationBatchV7;
    };

type PreparedProductPartBatchV7 =
  PendingProductPartBatchV7 & {
    readonly retained: PreparedPartKernelAccessV7;
  };

function productComponentContextKey(
  component: ProductPartComponentV7,
  configurationId: ConfigurationId | null,
): string {
  return component.source === "local"
    ? `local\u0000${contextKey(component.partNode, configurationId)}`
    : `external\u0000${component.resource}\u0000${component.digest}` +
        `\u0000${component.output}\u0000${component.partNode}` +
        `\u0000${configurationId ?? ""}`;
}

interface ResolvedAssemblyContext {
  readonly configuration: DesignConfigurationIR | undefined;
  readonly expression: (value: ExpressionIR) => number;
}

interface AssemblyTraversalFrame {
  readonly nodeId: NodeId;
  readonly node: AssemblyNodeIRV7;
  readonly configurationId: ConfigurationId | null;
  readonly context: ResolvedAssemblyContext;
  readonly transform: Mat4;
  readonly path: readonly EntityId[];
  readonly ancestry: readonly NodeId[];
  nextInstance: number;
}

const LOCAL_ASSEMBLY_OPTION_KEYS = localAssemblyFreeze([
  "configuration",
  "parameters",
  "outputs",
  "resolver",
  "evaluationLimits",
  "resourceLimits",
  "documentLimits",
  "signal",
] as const);
const LOCAL_ASSEMBLY_LIMIT_KEYS = localAssemblyFreeze(
  localAssemblyKeys(
    DEFAULT_LOCAL_ASSEMBLY_EVALUATION_LIMITS_V7,
  ) as (keyof LocalAssemblyEvaluationLimitsV7)[],
);
const LOCAL_ASSEMBLY_DOCUMENT_LIMIT_KEYS = localAssemblyFreeze(
  localAssemblyKeys(DEFAULT_DESIGN_DOCUMENT_LIMITS),
);
const LOCAL_ASSEMBLY_RESOURCE_LIMIT_KEYS = localAssemblyFreeze(
  localAssemblyKeys(DEFAULT_RESOURCE_RESOLUTION_LIMITS_V7),
);

function knownKey(value: string, keys: readonly string[]): boolean {
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === value) return true;
  }
  return false;
}

function runtimeIntegrityFailure(): CadResult<never> {
  return failure(
    diagnostic("IR_INVALID", DOCUMENT_V7_RUNTIME_INTEGRITY_MESSAGE, {
      severity: "error",
      details: {
        phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
        runtimeIntegrity: false,
      },
    }),
  );
}

function abortState(value: unknown): boolean | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    localAssemblyAbortSignalAbortedGetter === undefined
  ) {
    return undefined;
  }
  try {
    const state = localAssemblyApply<unknown>(
      localAssemblyAbortSignalAbortedGetter,
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
    diagnostic(
      "EVALUATION_ABORTED",
      "Local assembly evaluation was aborted",
      {
        severity: "error",
        ...(node === undefined
          ? {}
          : { node, path: `/nodes/${jsonPointerSegment(node)}` }),
        details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
      },
    ),
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

function limitFailure(
  resource: keyof LocalAssemblyEvaluationLimitsV7,
  limit: number,
  actual: number,
  path: string,
): CadResult<never> {
  return failure(
    diagnostic(
      "RESOURCE_LIMIT_EXCEEDED",
      `Local assembly evaluation limit '${resource}' (${limit}) was exceeded`,
      {
        severity: "error",
        path,
        details: {
          phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
          resource,
          limit,
          actual,
        },
      },
    ),
  );
}

const LOCAL_ASSEMBLY_COUNT_OVERFLOW_ACTUAL = 9_007_199_254_740_992;

type BoundedCount =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly actual: number };

function countActual(first: number, second: number): number {
  return second <= Number.MAX_SAFE_INTEGER - first
    ? first + second
    : LOCAL_ASSEMBLY_COUNT_OVERFLOW_ACTUAL;
}

function addBoundedCount(
  current: number,
  increment: number,
  limit: number,
): BoundedCount {
  if (increment > limit - current) {
    return {
      ok: false,
      actual: countActual(current, increment),
    };
  }
  return { ok: true, value: current + increment };
}

interface OwnDataCaptureOptions {
  readonly signal?: AbortSignal;
  readonly maximumOwnKeys?: number;
  readonly limitFailure?: (actual: number) => CadResult<never>;
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
      localAssemblyApply<boolean>(
        localAssemblyArrayIsArray,
        Array,
        [value],
      )
    ) {
      return failure(
        diagnostic("IR_INVALID", `${path} must be a plain record`, {
          severity: "error",
          path,
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        }),
      );
    }
    const prototype = localAssemblyApply<object | null>(
      localAssemblyObjectGetPrototypeOf,
      Object,
      [value],
    );
    const afterPrototype = postBoundaryFailure(options.signal);
    if (afterPrototype !== undefined) return afterPrototype;
    if (
      prototype !== null &&
      prototype !== localAssemblyObjectPrototype
    ) {
      return failure(
        diagnostic("IR_INVALID", `${path} must be a plain record`, {
          severity: "error",
          path,
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        }),
      );
    }
    const keys = localAssemblyApply<(string | symbol)[]>(
      localAssemblyReflectOwnKeys,
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
        options.limitFailure?.(keys.length) ??
        failure(
          diagnostic(
            "IR_INVALID",
            `${path} has too many own properties`,
            {
              severity: "error",
              path,
              details: {
                phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                limit: options.maximumOwnKeys,
                actual: keys.length,
              },
            },
          ),
        )
      );
    }
    const captured = localAssemblyNullRecord<unknown>();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key !== "string") {
        return failure(
          diagnostic(
            "IR_INVALID",
            `${path} cannot contain symbol properties`,
            {
              severity: "error",
              path,
              details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
            },
          ),
        );
      }
      const descriptor = localAssemblyApply<
        PropertyDescriptor | undefined
      >(
        localAssemblyObjectGetOwnPropertyDescriptor,
        Object,
        [value, key],
      );
      const afterDescriptor = postBoundaryFailure(options.signal);
      if (afterDescriptor !== undefined) return afterDescriptor;
      if (
        descriptor === undefined ||
        !localAssemblyHasOwn(descriptor, "value")
      ) {
        const propertyPath = `${
          path === "/" ? "" : path
        }/${jsonPointerSegment(key)}`;
        return failure(
          diagnostic(
            "IR_INVALID",
            `${propertyPath} must be an own data property`,
            {
              severity: "error",
              path: propertyPath,
              details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
            },
          ),
        );
      }
      defineRecordValue(captured, key, descriptor.value);
    }
    return success(localAssemblyFreeze(captured));
  } catch {
    const boundary = postBoundaryFailure(options.signal);
    return (
      boundary ??
      failure(
        diagnostic("IR_INVALID", `${path} could not be read safely`, {
          severity: "error",
          path,
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        }),
      )
    );
  }
}

function captureLimitRecord<K extends string>(
  value: unknown,
  path: string,
  knownKeys: readonly K[],
  defaults: Readonly<Record<K, number>>,
  signal: AbortSignal | undefined,
): CadResult<Readonly<Record<K, number>>> {
  if (value === undefined) return success(defaults);
  const captured = captureOwnDataRecord(value, path, {
    ...(signal === undefined ? {} : { signal }),
    maximumOwnKeys: knownKeys.length,
  });
  if (!captured.ok) return captured;
  const normalized = localAssemblyNullRecord<number>() as Record<K, number>;
  for (let index = 0; index < knownKeys.length; index += 1) {
    const key = knownKeys[index]!;
    normalized[key] = defaults[key];
  }
  const keys = localAssemblyKeys(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!knownKey(key, knownKeys)) {
      return failure(
        diagnostic("IR_INVALID", `Unknown limit '${key}'`, {
          severity: "error",
          path: `${path}/${jsonPointerSegment(key)}`,
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        }),
      );
    }
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !localAssemblySafeInteger(candidate) ||
      candidate < 0
    ) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Limit '${key}' must be a non-negative safe integer`,
          {
            severity: "error",
            path: `${path}/${jsonPointerSegment(key)}`,
            details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
          },
        ),
      );
    }
    normalized[key as K] = candidate;
  }
  return success(
    localAssemblyFreeze(normalized) as Readonly<Record<K, number>>,
  );
}

function capturePartialLimitRecord<K extends string>(
  value: unknown,
  path: string,
  knownKeys: readonly K[],
  signal: AbortSignal | undefined,
): CadResult<Partial<Record<K, number>> | undefined> {
  if (value === undefined) return success(undefined);
  const captured = captureOwnDataRecord(value, path, {
    ...(signal === undefined ? {} : { signal }),
    maximumOwnKeys: knownKeys.length,
  });
  if (!captured.ok) return captured;
  const normalized = localAssemblyNullRecord<number>();
  const keys = localAssemblyKeys(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!knownKey(key, knownKeys)) {
      return failure(
        diagnostic("IR_INVALID", `Unknown limit '${key}'`, {
          severity: "error",
          path: `${path}/${jsonPointerSegment(key)}`,
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        }),
      );
    }
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !localAssemblySafeInteger(candidate) ||
      candidate < 0
    ) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Limit '${key}' must be a non-negative safe integer`,
          {
            severity: "error",
            path: `${path}/${jsonPointerSegment(key)}`,
            details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
          },
        ),
      );
    }
    defineRecordValue(normalized, key, candidate);
  }
  return success(
    localAssemblyFreeze(normalized) as Partial<Record<K, number>>,
  );
}

function captureParameters(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
): CadResult<Readonly<Record<string, number>>> {
  if (value === undefined) {
    return success(localAssemblyFreeze(localAssemblyNullRecord<number>()));
  }
  const captured = captureOwnDataRecord(value, "/parameters", {
    ...(signal === undefined ? {} : { signal }),
    maximumOwnKeys: maximum,
    limitFailure: (actual) =>
      limitFailure(
        "maxParameterOverrides",
        maximum,
        actual,
        "/parameters",
      ),
  });
  if (!captured.ok) return captured;
  const keys = localAssemblyKeys(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const candidate = captured.value[key];
    if (typeof candidate !== "number" || !localAssemblyFinite(candidate)) {
      return failure(
        diagnostic(
          "EXPRESSION_INVALID",
          `Caller parameter override '${key}' must be a finite number`,
          {
            severity: "error",
            path: `/parameters/${jsonPointerSegment(key)}`,
            details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
          },
        ),
      );
    }
  }
  return success(
    captured.value as Readonly<Record<string, number>>,
  );
}

function captureOutputs(
  value: unknown,
  maximum: number,
  signal: AbortSignal | undefined,
): CadResult<readonly string[] | undefined> {
  if (value === undefined) return success(undefined);
  try {
    if (
      !localAssemblyApply<boolean>(
        localAssemblyArrayIsArray,
        Array,
        [value],
      )
    ) {
      return failure(
        diagnostic("IR_INVALID", "outputs must be an array", {
          severity: "error",
          path: "/outputs",
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        }),
      );
    }
    const prototype = localAssemblyApply<object | null>(
      localAssemblyObjectGetPrototypeOf,
      Object,
      [value],
    );
    const afterPrototype = postBoundaryFailure(signal);
    if (afterPrototype !== undefined) return afterPrototype;
    if (prototype !== localAssemblyArrayPrototype) {
      return failure(
        diagnostic(
          "IR_INVALID",
          "outputs must use the intrinsic Array prototype",
          {
            severity: "error",
            path: "/outputs",
            details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
          },
        ),
      );
    }
    const lengthDescriptor = localAssemblyApply<
      PropertyDescriptor | undefined
    >(
      localAssemblyObjectGetOwnPropertyDescriptor,
      Object,
      [value, "length"],
    );
    const afterLength = postBoundaryFailure(signal);
    if (afterLength !== undefined) return afterLength;
    const length = lengthDescriptor?.value;
    if (
      typeof length !== "number" ||
      !localAssemblySafeInteger(length) ||
      length < 0
    ) {
      return failure(
        diagnostic("IR_INVALID", "outputs has an invalid array length", {
          severity: "error",
          path: "/outputs",
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        }),
      );
    }
    if (length > maximum) {
      return limitFailure(
        "maxSelectedOutputs",
        maximum,
        length,
        "/outputs",
      );
    }
    const copied = new LocalAssemblyArray<string>(length);
    const seen = new LocalAssemblySet<string>();
    const allowed = new LocalAssemblySet<string>();
    localAssemblySetInsert(allowed, "length");
    let copiedLength = 0;
    for (let index = 0; index < length; index += 1) {
      const key = `${index}`;
      localAssemblySetInsert(allowed, key);
      const descriptor = localAssemblyApply<
        PropertyDescriptor | undefined
      >(
        localAssemblyObjectGetOwnPropertyDescriptor,
        Object,
        [value, key],
      );
      const afterDescriptor = postBoundaryFailure(signal);
      if (afterDescriptor !== undefined) return afterDescriptor;
      if (
        descriptor === undefined ||
        !localAssemblyHasOwn(descriptor, "value") ||
        typeof descriptor.value !== "string"
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            `outputs[${index}] must be an own string data property`,
            {
              severity: "error",
              path: `/outputs/${index}`,
              details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
            },
          ),
        );
      }
      if (!localAssemblySetContains(seen, descriptor.value)) {
        localAssemblySetInsert(seen, descriptor.value);
        copied[copiedLength] = descriptor.value;
        copiedLength += 1;
      }
    }
    copied.length = copiedLength;
    const keys = localAssemblyApply<(string | symbol)[]>(
      localAssemblyReflectOwnKeys,
      Reflect,
      [value],
    );
    const afterKeys = postBoundaryFailure(signal);
    if (afterKeys !== undefined) return afterKeys;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (
        typeof key !== "string" ||
        !localAssemblySetContains(allowed, key)
      ) {
        return failure(
          diagnostic(
            "IR_INVALID",
            "outputs cannot contain non-index properties",
            {
              severity: "error",
              path: "/outputs",
              details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
            },
          ),
        );
      }
    }
    if (keys.length !== length + 1) {
      return failure(
        diagnostic(
          "IR_INVALID",
          "outputs must contain every index exactly once",
          {
            severity: "error",
            path: "/outputs",
            details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
          },
        ),
      );
    }
    return success(localAssemblyFreeze(copied));
  } catch {
    const boundary = postBoundaryFailure(signal);
    return (
      boundary ??
      failure(
        diagnostic("IR_INVALID", "outputs could not be read safely", {
          severity: "error",
          path: "/outputs",
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        }),
      )
    );
  }
}

function captureOptions(
  value: unknown,
): CadResult<CapturedLocalAssemblyOptions> {
  const captured = captureOwnDataRecord(value, "/", {
    maximumOwnKeys: LOCAL_ASSEMBLY_OPTION_KEYS.length,
  });
  if (!captured.ok) return captured;
  const keys = localAssemblyKeys(captured.value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (!knownKey(key, LOCAL_ASSEMBLY_OPTION_KEYS)) {
      return failure(
        diagnostic(
          "IR_INVALID",
          `Unknown local assembly evaluation option '${key}'`,
          {
            severity: "error",
            path: `/${jsonPointerSegment(key)}`,
            details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
          },
        ),
      );
    }
  }
  const signal = captured.value.signal as AbortSignal | undefined;
  if (signal !== undefined && abortState(signal) === undefined) {
    return failure(
      diagnostic("IR_INVALID", "signal must be an AbortSignal", {
        severity: "error",
        path: "/signal",
        details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
      }),
    );
  }
  const boundary = postBoundaryFailure(signal);
  if (boundary !== undefined) return boundary;

  const evaluationLimits = captureLimitRecord(
    captured.value.evaluationLimits,
    "/evaluationLimits",
    LOCAL_ASSEMBLY_LIMIT_KEYS,
    DEFAULT_LOCAL_ASSEMBLY_EVALUATION_LIMITS_V7,
    signal,
  );
  if (!evaluationLimits.ok) return evaluationLimits;
  const parameters = captureParameters(
    captured.value.parameters,
    evaluationLimits.value.maxParameterOverrides,
    signal,
  );
  if (!parameters.ok) return parameters;
  const outputs = captureOutputs(
    captured.value.outputs,
    evaluationLimits.value.maxSelectedOutputs,
    signal,
  );
  if (!outputs.ok) return outputs;
  const documentLimits = capturePartialLimitRecord(
    captured.value.documentLimits,
    "/documentLimits",
    LOCAL_ASSEMBLY_DOCUMENT_LIMIT_KEYS,
    signal,
  );
  if (!documentLimits.ok) return documentLimits;
  const resourceLimits = capturePartialLimitRecord(
    captured.value.resourceLimits,
    "/resourceLimits",
    LOCAL_ASSEMBLY_RESOURCE_LIMIT_KEYS,
    signal,
  );
  if (!resourceLimits.ok) return resourceLimits;
  const configuration = captured.value.configuration;
  if (
    configuration !== undefined &&
    typeof configuration !== "string"
  ) {
    return failure(
      diagnostic("IR_INVALID", "configuration must be a string", {
        severity: "error",
        path: "/configuration",
        details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
      }),
    );
  }
  const resolver = captured.value.resolver;
  if (resolver !== undefined && typeof resolver !== "function") {
    return failure(
      diagnostic("IR_INVALID", "resolver must be a function", {
        severity: "error",
        path: "/resolver",
        details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
      }),
    );
  }
  return success(
    localAssemblyFreeze({
      ...(configuration === undefined ? {} : { configuration }),
      parameters: parameters.value,
      ...(outputs.value === undefined ? {} : { outputs: outputs.value }),
      ...(resolver === undefined
        ? {}
        : { resolver: resolver as ResourceResolverV7 }),
      evaluationLimits:
        evaluationLimits.value as unknown as LocalAssemblyEvaluationLimitsV7,
      ...(resourceLimits.value === undefined
        ? {}
        : {
            resourceLimits:
              resourceLimits.value as Partial<ResourceResolutionLimitsV7>,
          }),
      ...(documentLimits.value === undefined
        ? {}
        : {
            documentLimits:
              documentLimits.value as Partial<DesignDocumentLimits>,
          }),
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

function configuredSuppression(
  configuration: DesignConfigurationIR | undefined,
  assembly: NodeId,
  instance: EntityId,
): boolean | undefined {
  const assemblies = configuration?.instanceSuppressions;
  if (
    assemblies === undefined ||
    !localAssemblyHasOwn(assemblies, assembly)
  ) {
    return undefined;
  }
  const instances = assemblies[assembly]!;
  return localAssemblyHasOwn(instances, instance)
    ? instances[instance]
    : undefined;
}

function occurrenceConfigurationId(
  configuration: {
    readonly mode: "inherit" | "base" | "named";
    readonly id?: ConfigurationId;
  },
  parent: ConfigurationId | null,
): ConfigurationId | null {
  switch (configuration.mode) {
    case "inherit":
      return parent;
    case "base":
      return null;
    case "named":
      return configuration.id!;
  }
}

function expressionEvaluator(
  parameters: ReadonlyMap<ParameterId, number>,
): (expression: ExpressionIR) => number {
  return (expression) =>
    evaluateExpression(expression, {
      resolveParameter: (id) => {
        const value = localAssemblyMapValue(parameters, id);
        if (value === undefined) {
          throw new Error(`Unresolved parameter '${id}'`);
        }
        return value;
      },
    });
}

function finiteVector(
  values: readonly ExpressionIR[],
  expression: (value: ExpressionIR) => number,
  node: NodeId,
  path: string,
): CadResult<Vec3> {
  try {
    const resolved: Vec3 = [
      expression(values[0]!),
      expression(values[1]!),
      expression(values[2]!),
    ];
    for (let index = 0; index < 3; index += 1) {
      if (!localAssemblyFinite(resolved[index])) {
        return failure(
          diagnostic(
            "FEATURE_INVALID",
            "Assembly placement components must be finite",
            {
              severity: "error",
              node,
              path: `${path}/${index}`,
              details: {
                phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                value: resolved[index],
              },
            },
          ),
        );
      }
    }
    return success(resolved);
  } catch (error) {
    return failure(
      diagnostic(
        "EXPRESSION_INVALID",
        safeErrorMessage(
          error,
          "Assembly placement expression could not be resolved",
        ),
        {
          severity: "error",
          node,
          path,
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        },
      ),
    );
  }
}

function resolvedPlacement(
  operations: readonly TransformOperationIR[],
  expression: (value: ExpressionIR) => number,
  node: NodeId,
  instanceIndex: number,
  signal: AbortSignal | undefined,
): CadResult<Mat4> {
  let result = IDENTITY_MATRIX;
  for (let index = 0; index < operations.length; index += 1) {
    const boundary = postBoundaryFailure(signal, node);
    if (boundary !== undefined) return boundary;
    const operation = operations[index]!;
    const field = operation.kind === "mirror" ? "normal" : "value";
    const values =
      operation.kind === "mirror" ? operation.normal : operation.value;
    const path =
      `/nodes/${jsonPointerSegment(node)}/instances/${instanceIndex}` +
      `/placement/${index}/${field}`;
    const vector = finiteVector(values, expression, node, path);
    if (!vector.ok) return vector;
    let matrix: Mat4;
    if (operation.kind === "translate") {
      matrix = translationMatrix(vector.value);
    } else if (operation.kind === "rotate") {
      matrix = rotationMatrix(vector.value);
    } else if (operation.kind === "scale") {
      matrix = scaleMatrix(vector.value);
    } else {
      const magnitude = localAssemblyApply<number>(
        localAssemblyMathHypot,
        Math,
        [vector.value[0], vector.value[1], vector.value[2]],
      );
      if (!localAssemblyFinite(magnitude) || magnitude === 0) {
        return failure(
          diagnostic(
            "FEATURE_INVALID",
            "Assembly mirror normal must be finite and nonzero",
            {
              severity: "error",
              node,
              path,
              details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
            },
          ),
        );
      }
      const [x, y, z] = vector.value;
      const nx = x / magnitude;
      const ny = y / magnitude;
      const nz = z / magnitude;
      matrix = [
        1 - 2 * nx * nx,
        -2 * nx * ny,
        -2 * nx * nz,
        0,
        -2 * ny * nx,
        1 - 2 * ny * ny,
        -2 * ny * nz,
        0,
        -2 * nz * nx,
        -2 * nz * ny,
        1 - 2 * nz * nz,
        0,
        0,
        0,
        0,
        1,
      ];
    }
    result = multiplyMatrices(matrix, result);
    const afterMatrix = postBoundaryFailure(signal, node);
    if (afterMatrix !== undefined) return afterMatrix;
    for (let matrixIndex = 0; matrixIndex < result.length; matrixIndex += 1) {
      if (!localAssemblyFinite(result[matrixIndex])) {
        return failure(
          diagnostic(
            "FEATURE_INVALID",
            "Assembly placement matrix overflowed numeric range",
            {
              severity: "error",
              node,
              path:
                `/nodes/${jsonPointerSegment(node)}/instances/` +
                `${instanceIndex}/placement/${index}`,
              details: {
                phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                operationIndex: index,
                matrixIndex,
                value: "non-finite",
              },
            },
          ),
        );
      }
    }
  }
  for (let matrixIndex = 0; matrixIndex < result.length; matrixIndex += 1) {
    if (!localAssemblyFinite(result[matrixIndex])) {
      return failure(
        diagnostic(
          "FEATURE_INVALID",
          "Assembly placement matrix must contain only finite values",
          {
            severity: "error",
            node,
            path:
              `/nodes/${jsonPointerSegment(node)}/instances/` +
              `${instanceIndex}/placement`,
            details: {
              phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
              matrixIndex,
              value: "non-finite",
            },
          },
        ),
      );
    }
  }
  return success(localAssemblyFreeze(result) as Mat4);
}

function appendOccurrencePath(
  path: readonly EntityId[],
  id: EntityId,
): readonly EntityId[] {
  const next = new LocalAssemblyArray<EntityId>(path.length + 1);
  for (let index = 0; index < path.length; index += 1) {
    next[index] = path[index]!;
  }
  next[path.length] = id;
  return localAssemblyFreeze(next);
}

function nodePathContains(
  path: readonly NodeId[],
  node: NodeId,
): boolean {
  for (let index = 0; index < path.length; index += 1) {
    if (path[index] === node) return true;
  }
  return false;
}

function appendNodePath(
  path: readonly NodeId[],
  node: NodeId,
): readonly NodeId[] {
  const next = new LocalAssemblyArray<NodeId>(path.length + 1);
  for (let index = 0; index < path.length; index += 1) {
    next[index] = path[index]!;
  }
  next[path.length] = node;
  return localAssemblyFreeze(next);
}

function composeOccurrencePlacement(
  parent: Mat4,
  local: Mat4,
  assembly: NodeId,
  instanceIndex: number,
  path: readonly EntityId[],
  signal: AbortSignal | undefined,
): CadResult<Mat4> {
  const boundary = postBoundaryFailure(signal, assembly);
  if (boundary !== undefined) return boundary;
  let composed: Mat4;
  try {
    composed = multiplyMatrices(parent, local);
  } catch (error) {
    return failure(
      diagnostic(
        "FEATURE_INVALID",
        safeErrorMessage(
          error,
          "Nested assembly placement could not be composed",
        ),
        {
          severity: "error",
          node: assembly,
          path:
            `/nodes/${jsonPointerSegment(assembly)}/instances/` +
            `${instanceIndex}/placement`,
          details: {
            phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
            occurrencePath: path,
          },
        },
      ),
    );
  }
  const afterComposition = postBoundaryFailure(signal, assembly);
  if (afterComposition !== undefined) return afterComposition;
  for (let index = 0; index < composed.length; index += 1) {
    if (!localAssemblyFinite(composed[index])) {
      return failure(
        diagnostic(
          "FEATURE_INVALID",
          "Nested assembly placement matrix overflowed numeric range",
          {
            severity: "error",
            node: assembly,
            path:
              `/nodes/${jsonPointerSegment(assembly)}/instances/` +
              `${instanceIndex}/placement`,
            details: {
              phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
              occurrencePath: path,
              matrixIndex: index,
              value: "non-finite",
            },
          },
        ),
      );
    }
  }
  return success(localAssemblyFreeze(composed) as Mat4);
}

function unsupported(
  message: string,
  node: NodeId,
  path: string,
  details: Readonly<Record<string, unknown>>,
): CadResult<never> {
  return failure(
    diagnostic("EVALUATION_UNSUPPORTED", message, {
      severity: "error",
      node,
      path,
      details: {
        phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
        ...details,
      },
    }),
  );
}

function externalComponentDiagnostics(
  diagnostics: readonly Diagnostic[],
  occurrence: SelectedExternalOccurrence,
  external?: ResolvedExternalDocumentV7,
): readonly Diagnostic[] {
  const wrapped = new LocalAssemblyArray<Diagnostic>(diagnostics.length);
  for (let index = 0; index < diagnostics.length; index += 1) {
    const item = diagnostics[index]!;
    wrapped[index] = deepFreeze({
      ...item,
      node: occurrence.parentNode,
      path: occurrence.componentPath,
      details: {
        ...item.details,
        phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
        resource: occurrence.resource,
        output: occurrence.output,
        outputKind: occurrence.outputKind,
        ...(external === undefined
          ? {}
          : {
              digest: external.digest,
              byteLength: external.byteLength,
              sourceVersion: external.sourceVersion,
            }),
        ...(item.node === undefined ? {} : { childNode: item.node }),
        ...(item.path === undefined ? {} : { childPath: item.path }),
        occurrencePath: occurrence.path,
      },
    });
  }
  return localAssemblyFreeze(wrapped);
}

function externalComponentFailure<T>(
  diagnostics: readonly Diagnostic[],
  occurrence: SelectedExternalOccurrence,
  external?: ResolvedExternalDocumentV7,
): CadResult<T> {
  return {
    ok: false,
    diagnostics: externalComponentDiagnostics(
      diagnostics,
      occurrence,
      external,
    ),
  };
}

function externalBatchDiagnostics(
  diagnostics: readonly Diagnostic[],
  batch: ExternalPartEvaluationBatchV7,
): readonly Diagnostic[] {
  const wrapped = new LocalAssemblyArray<Diagnostic>();
  const outputs = [...batch.outputs];
  localAssemblyApply<void>(localAssemblyArraySort, outputs, [
    lexicalCompare,
  ]);
  for (
    let diagnosticIndex = 0;
    diagnosticIndex < diagnostics.length;
    diagnosticIndex += 1
  ) {
    const item = diagnostics[diagnosticIndex]!;
    let occurrence = batch.firstOccurrence;
    if (item.path !== undefined) {
      for (
        let outputIndex = 0;
        outputIndex < outputs.length;
        outputIndex += 1
      ) {
        const output = outputs[outputIndex]!;
        const prefix =
          `/outputs/${jsonPointerSegment(output)}`;
        if (
          item.path === prefix ||
          (item.path.length > prefix.length &&
            localAssemblyApply<string>(
              localAssemblyStringSlice,
              item.path,
              [0, prefix.length + 1],
            ) === `${prefix}/`)
        ) {
          occurrence =
            localAssemblyMapValue(
              batch.firstOccurrencesByOutput,
              output,
            ) ?? occurrence;
          break;
        }
      }
    }
    const contextual = externalComponentDiagnostics(
      [item],
      occurrence,
      batch.external,
    );
    wrapped[wrapped.length] = contextual[0]!;
  }
  return localAssemblyFreeze(wrapped);
}

function productOccurrenceDiagnostics(
  diagnostics: readonly Diagnostic[],
  occurrence: EvaluatedLocalOccurrenceV7,
): readonly Diagnostic[] {
  if (occurrence.component.source === "local") {
    return diagnostics;
  }
  const provenance = evaluatedOccurrenceProvenance(occurrence);
  const component = occurrence.component;
  const wrapped = new LocalAssemblyArray<Diagnostic>(
    diagnostics.length,
  );
  for (let index = 0; index < diagnostics.length; index += 1) {
    const item = diagnostics[index]!;
    wrapped[index] = deepFreeze({
      ...item,
      ...(provenance === undefined
        ? {}
        : {
            node: provenance.parentNode,
            path: provenance.componentPath,
          }),
      details: {
        ...item.details,
        phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
        resource: component.resource,
        digest: component.digest,
        byteLength: component.byteLength,
        output: component.output,
        outputKind: component.outputKind,
        sourceVersion: component.sourceVersion,
        ...(item.node === undefined ? {} : { childNode: item.node }),
        ...(item.path === undefined ? {} : { childPath: item.path }),
        occurrencePath: occurrence.path,
      },
    });
  }
  return localAssemblyFreeze(wrapped);
}

class LocalAssemblyOwner {
  readonly #children: readonly EvaluatedPartDesignV7[];
  #disposed = false;

  constructor(children: readonly EvaluatedPartDesignV7[]) {
    this.#children = localAssemblyFreeze([...children]);
  }

  assertLive(): void {
    if (this.#disposed) {
      throw new Error(
        "This local assembly evaluation result has been disposed",
      );
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    let firstError: unknown;
    let failed = false;
    for (let index = 0; index < this.#children.length; index += 1) {
      try {
        this.#children[index]!.dispose();
      } catch (error) {
        if (!failed) {
          firstError = error;
          failed = true;
        }
      }
    }
    if (failed) throw firstError;
  }
}

function runtimeCadError(): CadError {
  const result = runtimeIntegrityFailure();
  const item = result.diagnostics[0]!;
  return new CadError(item.message, result.diagnostics);
}

type CapturedMeshData =
  | { readonly ok: true; readonly value: MeshData }
  | { readonly ok: false; readonly reason: string };

function intrinsicTypedArrayLength(
  value: unknown,
  prototype: object,
): number | undefined {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      localAssemblyTypedArrayLengthGetter === undefined ||
      localAssemblyTypedArrayBufferGetter === undefined ||
      localAssemblyArrayBufferByteLengthGetter === undefined ||
      localAssemblyApply<object | null>(
        localAssemblyObjectGetPrototypeOf,
        Object,
        [value],
      ) !== prototype
    ) {
      return undefined;
    }
    const length = localAssemblyApply<unknown>(
      localAssemblyTypedArrayLengthGetter,
      value,
      [],
    );
    if (
      typeof length !== "number" ||
      !localAssemblySafeInteger(length) ||
      length < 0
    ) {
      return undefined;
    }
    const buffer = localAssemblyApply<unknown>(
      localAssemblyTypedArrayBufferGetter,
      value,
      [],
    );
    if (
      typeof buffer !== "object" ||
      buffer === null ||
      localAssemblyApply<object | null>(
        localAssemblyObjectGetPrototypeOf,
        Object,
        [buffer],
      ) !== localAssemblyArrayBufferPrototype
    ) {
      return undefined;
    }
    const byteLength = localAssemblyApply<unknown>(
      localAssemblyArrayBufferByteLengthGetter,
      buffer,
      [],
    );
    if (
      typeof byteLength !== "number" ||
      !localAssemblySafeInteger(byteLength) ||
      byteLength < 0
    ) {
      return undefined;
    }
    new LocalAssemblyUint8Array(buffer as ArrayBuffer, 0, 0);
    return length;
  } catch {
    return undefined;
  }
}

function captureMeshData(value: unknown): CapturedMeshData {
  try {
    const record = captureOwnDataRecord(value, "/mesh", {
      maximumOwnKeys: 2,
    });
    if (!record.ok) {
      return { ok: false, reason: "unsafe-mesh-record" };
    }
    const keys = localAssemblyKeys(record.value);
    if (
      keys.length !== 2 ||
      !localAssemblyHasOwn(record.value, "positions") ||
      !localAssemblyHasOwn(record.value, "indices")
    ) {
      return { ok: false, reason: "invalid-mesh-record-keys" };
    }
    const sourcePositions = record.value.positions;
    const sourceIndices = record.value.indices;
    const positionLength = intrinsicTypedArrayLength(
      sourcePositions,
      localAssemblyFloat32ArrayPrototype,
    );
    const indexLength = intrinsicTypedArrayLength(
      sourceIndices,
      localAssemblyUint32ArrayPrototype,
    );
    if (positionLength === undefined) {
      return {
        ok: false,
        reason: "positions-not-intrinsic-float32-array",
      };
    }
    if (indexLength === undefined) {
      return {
        ok: false,
        reason: "indices-not-intrinsic-uint32-array",
      };
    }
    if (positionLength % 3 !== 0) {
      return { ok: false, reason: "incomplete-xyz-positions" };
    }
    if (indexLength % 3 !== 0) {
      return { ok: false, reason: "incomplete-triangle-indices" };
    }

    const positions = new LocalAssemblyFloat32Array(positionLength);
    for (let index = 0; index < positionLength; index += 1) {
      const coordinate = (sourcePositions as Float32Array)[index]!;
      if (!localAssemblyFinite(coordinate)) {
        return { ok: false, reason: "non-finite-position" };
      }
      positions[index] = coordinate;
    }
    const vertexCount = positionLength / 3;
    const indices = new LocalAssemblyUint32Array(indexLength);
    for (let index = 0; index < indexLength; index += 1) {
      const vertex = (sourceIndices as Uint32Array)[index]!;
      if (vertex >= vertexCount) {
        return { ok: false, reason: "mesh-index-out-of-bounds" };
      }
      indices[index] = vertex;
    }
    return {
      ok: true,
      value: localAssemblyFreeze({ positions, indices }),
    };
  } catch {
    return { ok: false, reason: "unsafe-mesh-capture" };
  }
}

function meshCadError(
  output: string,
  assemblyNode: NodeId,
  message: string,
  reason: string,
  occurrence?: EvaluatedLocalOccurrenceV7,
  cause?: string,
): CadError {
  const provenance =
    occurrence === undefined
      ? undefined
      : evaluatedOccurrenceProvenance(occurrence);
  const value = diagnostic("KERNEL_ERROR", message, {
    severity: "error",
    node:
      provenance?.parentNode ??
      occurrence?.partNode ??
      assemblyNode,
    path:
      provenance?.componentPath ??
      `/nodes/${jsonPointerSegment(assemblyNode)}`,
    details: {
      phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
      output,
      reason,
      protocolViolation: true,
      ...(occurrence === undefined
        ? {}
        : {
            occurrencePath: occurrence.path,
            component: occurrence.component,
            ...(provenance === undefined
              ? {}
              : { childNode: occurrence.partNode }),
          }),
      ...(cause === undefined ? {} : { cause }),
    },
  });
  return new CadError(value.message, [value]);
}

function affineVolumeScale(matrix: Mat4): number {
  const determinant =
    matrix[0] *
      (matrix[5] * matrix[10] - matrix[9] * matrix[6]) -
    matrix[4] *
      (matrix[1] * matrix[10] - matrix[9] * matrix[2]) +
    matrix[8] *
      (matrix[1] * matrix[6] - matrix[5] * matrix[2]);
  const scale = localAssemblyApply<number>(
    localAssemblyMathAbs,
    Math,
    [determinant],
  );
  if (!localAssemblyFinite(scale)) {
    throw new RangeError(
      "Occurrence transform volume scale must be finite",
    );
  }
  return scale;
}

function transformPhysical(
  properties: PhysicalMassProperties,
  matrix: Mat4,
): PhysicalMassProperties {
  const transformed = transformMassProperties(
    {
      volume: properties.mass,
      centerOfMass: properties.centerOfMass,
      inertiaTensor: properties.inertiaTensor,
    },
    matrix,
  );
  return {
    mass: transformed.volume,
    centerOfMass: transformed.centerOfMass,
    inertiaTensor: transformed.inertiaTensor,
  };
}

class LocalAssemblyCompensatedSum {
  #sum = 0;
  #correction = 0;

  add(value: number): void {
    if (!localAssemblyFinite(value) || value < 0) {
      throw new RangeError(
        "Bill-of-materials mass contribution must be finite and non-negative",
      );
    }
    const next = this.#sum + value;
    if (!localAssemblyFinite(next)) {
      throw new RangeError(
        "Bill-of-materials mass total overflowed numeric range",
      );
    }
    this.#correction +=
      localAssemblyApply<number>(
        localAssemblyMathAbs,
        Math,
        [this.#sum],
      ) >=
      localAssemblyApply<number>(
        localAssemblyMathAbs,
        Math,
        [value],
      )
        ? this.#sum - next + value
        : value - next + this.#sum;
    if (!localAssemblyFinite(this.#correction)) {
      throw new RangeError(
        "Bill-of-materials compensated mass total overflowed numeric range",
      );
    }
    this.#sum = next;
  }

  value(): number {
    const result = this.#sum + this.#correction;
    if (!localAssemblyFinite(result) || result < 0) {
      throw new RangeError(
        "Bill-of-materials mass total is not representable",
      );
    }
    return result;
  }
}

function bomRepresentationFailure(
  output: string,
  node: NodeId,
  error: unknown,
  details: Readonly<Record<string, unknown>> = {},
): CadResult<never> {
  return failure(
    diagnostic(
      "MASS_PROPERTIES_INVALID",
      `Bill of materials for local assembly '${output}' could not be represented`,
      {
        severity: "error",
        node,
        path: `/nodes/${jsonPointerSegment(node)}`,
        details: {
          phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
          ...details,
          cause: safeErrorMessage(
            error,
            "Bill-of-materials aggregation failed with an opaque value",
          ),
        },
      },
    ),
  );
}

/**
 * Owned result for one selected direct local assembly.
 *
 * Aggregate geometry is mesh-only. Exact component shapes remain available
 * through each occurrence's staged part value.
 *
 * @internal
 */
export class EvaluatedLocalAssemblyV7 {
  readonly name: string;
  readonly node: NodeId;
  readonly occurrences: readonly EvaluatedLocalOccurrenceV7[];
  readonly #owner: LocalAssemblyOwner;
  readonly #rootConfigurationId: ConfigurationId | null;

  constructor(
    name: string,
    node: NodeId,
    occurrences: readonly EvaluatedLocalOccurrenceV7[],
    owner: LocalAssemblyOwner,
    rootConfigurationId: ConfigurationId | null,
  ) {
    this.name = name;
    this.node = node;
    this.occurrences = localAssemblyFreeze([...occurrences]);
    this.#owner = owner;
    this.#rootConfigurationId = rootConfigurationId;
    localAssemblyFreeze(this);
  }

  mesh(options?: MeshOptions): MeshData {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      throw runtimeCadError();
    }
    this.#owner.assertLive();
    const meshes = new LocalAssemblyArray<MeshData>(
      this.occurrences.length,
    );
    for (let index = 0; index < this.occurrences.length; index += 1) {
      const occurrence = this.occurrences[index]!;
      let returned: unknown;
      try {
        returned = occurrence.part.mesh(options);
      } catch (error) {
        if (!documentV7RuntimeIntrinsicsAreIntact()) {
          throw runtimeCadError();
        }
        throw meshCadError(
          this.name,
          this.node,
          `Kernel mesh callback failed for occurrence '${occurrence.id}'`,
          "mesh-callback-threw",
          occurrence,
          safeErrorMessage(
            error,
            "Kernel mesh callback failed with an opaque value",
          ),
        );
      }
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        throw runtimeCadError();
      }
      const captured = captureMeshData(returned);
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        throw runtimeCadError();
      }
      if (!captured.ok) {
        throw meshCadError(
          this.name,
          this.node,
          `Kernel returned malformed mesh data for occurrence '${occurrence.id}'`,
          captured.reason,
          occurrence,
        );
      }
      let transformed: MeshData;
      try {
        transformed = transformMesh(
          captured.value,
          occurrence.transform,
        );
      } catch (error) {
        if (!documentV7RuntimeIntrinsicsAreIntact()) {
          throw runtimeCadError();
        }
        throw meshCadError(
          this.name,
          this.node,
          `Placed mesh for occurrence '${occurrence.id}' could not be represented`,
          "mesh-transform-failed",
          occurrence,
          safeErrorMessage(
            error,
            "Mesh transformation failed with an opaque value",
          ),
        );
      }
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        throw runtimeCadError();
      }
      const placed = captureMeshData(transformed);
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        throw runtimeCadError();
      }
      if (!placed.ok) {
        throw meshCadError(
          this.name,
          this.node,
          `Placed mesh for occurrence '${occurrence.id}' is invalid`,
          `placed-${placed.reason}`,
          occurrence,
        );
      }
      meshes[index] = placed.value;
    }
    let merged: MeshData;
    try {
      merged = mergeMeshes(meshes);
    } catch (error) {
      if (!documentV7RuntimeIntrinsicsAreIntact()) {
        throw runtimeCadError();
      }
      throw meshCadError(
        this.name,
        this.node,
        `Aggregate mesh for local assembly '${this.name}' could not be represented`,
        "mesh-merge-failed",
        undefined,
        safeErrorMessage(
          error,
          "Mesh aggregation failed with an opaque value",
        ),
      );
    }
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      throw runtimeCadError();
    }
    const capturedMerged = captureMeshData(merged);
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      throw runtimeCadError();
    }
    if (!capturedMerged.ok) {
      throw meshCadError(
        this.name,
        this.node,
        `Aggregate mesh for local assembly '${this.name}' is invalid`,
        `aggregate-${capturedMerged.reason}`,
      );
    }
    return capturedMerged.value;
  }

  export(format: "stl"): Uint8Array;
  export(format: "stl-ascii" | "obj"): string;
  export(format: MeshExportFormat): Uint8Array | string;
  export(format: MeshExportFormat): Uint8Array | string {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      throw runtimeCadError();
    }
    this.#owner.assertLive();
    if (
      format !== "stl" &&
      format !== "stl-ascii" &&
      format !== "obj"
    ) {
      const renderedFormat =
        typeof format === "string" ? format : "unsupported value";
      const value = diagnostic(
        "EXPORT_UNSUPPORTED",
        `Local assembly '${this.name}' cannot be exported as ${renderedFormat}`,
        {
          severity: "error",
          node: this.node,
          details: {
            output: this.name,
            format: renderedFormat,
            phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
          },
        },
      );
      throw new CadError(value.message, [value]);
    }
    return exportMesh(this.mesh(), format, this.name);
  }

  physicalMassProperties(): CadResult<PhysicalMassProperties> {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return runtimeIntegrityFailure();
    }
    this.#owner.assertLive();
    const cache = new LocalAssemblyMap<string, PhysicalMassProperties>();
    const values = new LocalAssemblyArray<PhysicalMassProperties>();
    for (let index = 0; index < this.occurrences.length; index += 1) {
      const occurrence = this.occurrences[index]!;
      const key = productComponentContextKey(
        occurrence.component,
        occurrence.effectiveConfigurationId,
      );
      let properties = localAssemblyMapValue(cache, key);
      if (properties === undefined) {
        const measured = occurrence.part.physicalMassProperties();
        const boundary = postBoundaryFailure(undefined, occurrence.partNode);
        if (boundary !== undefined) return boundary;
        if (!measured.ok) {
          return {
            ok: false,
            diagnostics: productOccurrenceDiagnostics(
              measured.diagnostics,
              occurrence,
            ),
          };
        }
        properties = measured.value;
        localAssemblyMapInsert(cache, key, properties);
      }
      try {
        values[values.length] = transformPhysical(
          properties,
          occurrence.transform,
        );
      } catch (error) {
        const provenance =
          evaluatedOccurrenceProvenance(occurrence);
        return failure(
          diagnostic(
            "MASS_PROPERTIES_INVALID",
            `Physical mass properties for occurrence '${occurrence.id}' could not be represented`,
            {
              severity: "error",
              node:
                provenance?.parentNode ??
                occurrence.partNode,
              path:
                provenance?.componentPath ??
                `/nodes/${jsonPointerSegment(this.node)}`,
              details: {
                phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                occurrencePath: occurrence.path,
                component: occurrence.component,
                ...(provenance === undefined
                  ? {}
                  : { childNode: occurrence.partNode }),
                cause: safeErrorMessage(
                  error,
                  "Occurrence mass transformation failed",
                ),
              },
            },
          ),
        );
      }
      const afterTransform = postBoundaryFailure(
        undefined,
        occurrence.partNode,
      );
      if (afterTransform !== undefined) return afterTransform;
    }
    try {
      const combined = combinePhysicalMassProperties(values);
      const boundary = postBoundaryFailure(undefined, this.node);
      return boundary ?? success(combined);
    } catch (error) {
      return failure(
        diagnostic(
          "MASS_PROPERTIES_INVALID",
          `Physical mass properties for local assembly '${this.name}' could not be represented`,
          {
            severity: "error",
            node: this.node,
            details: {
              phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
              cause: safeErrorMessage(error),
            },
          },
        ),
      );
    }
  }

  billOfMaterials(): CadResult<ContextualBillOfMaterialsV7> {
    if (!documentV7RuntimeIntrinsicsAreIntact()) {
      return runtimeIntegrityFailure();
    }
    this.#owner.assertLive();
    const groups = new LocalAssemblyMap<
      string,
      {
        readonly part: EvaluatedPartV7;
        readonly component: ProductPartComponentV7;
        readonly configurationId: ConfigurationId | null;
        readonly occurrences: EvaluatedLocalOccurrenceV7[];
      }
    >();
    for (let index = 0; index < this.occurrences.length; index += 1) {
      const occurrence = this.occurrences[index]!;
      const key = productComponentContextKey(
        occurrence.component,
        occurrence.effectiveConfigurationId,
      );
      const existing = localAssemblyMapValue(groups, key);
      if (existing === undefined) {
        localAssemblyMapInsert(groups, key, {
          part: occurrence.part,
          component: occurrence.component,
          configurationId: occurrence.effectiveConfigurationId,
          occurrences: [occurrence],
        });
      } else {
        existing.occurrences[existing.occurrences.length] = occurrence;
      }
    }
    const ordered = [...groups.values()];
    localAssemblyApply<void>(localAssemblyArraySort, ordered, [
      (
        first: (typeof ordered)[number],
        second: (typeof ordered)[number],
      ) => {
        const firstNumber =
          (first.part.partNumber === undefined
            ? undefined
            : trimmed(first.part.partNumber)) || null;
        const secondNumber =
          (second.part.partNumber === undefined
            ? undefined
            : trimmed(second.part.partNumber)) || null;
        if (firstNumber === null && secondNumber !== null) return 1;
        if (firstNumber !== null && secondNumber === null) return -1;
        if (firstNumber !== null && secondNumber !== null) {
          const compared = lexicalCompare(firstNumber, secondNumber);
          if (compared !== 0) return compared;
        }
        const componentCompared = lexicalCompare(
          productComponentContextKey(first.component, first.configurationId),
          productComponentContextKey(
            second.component,
            second.configurationId,
          ),
        );
        if (componentCompared !== 0) return componentCompared;
        if (first.configurationId === null) {
          return second.configurationId === null ? 0 : -1;
        }
        return second.configurationId === null
          ? 1
          : lexicalCompare(
              first.configurationId,
              second.configurationId,
            );
      },
    ]);

    const diagnostics: Diagnostic[] = [];
    const items =
      new LocalAssemblyArray<ContextualBillOfMaterialsItemV7>(
        ordered.length,
      );
    for (let index = 0; index < ordered.length; index += 1) {
      const group = ordered[index]!;
      const direct = group.part.billOfMaterials();
      const boundary = postBoundaryFailure(undefined, group.part.node);
      if (boundary !== undefined) return boundary;
      const provenanceOccurrence = group.occurrences[0]!;
      if (!direct.ok) {
        return {
          ok: false,
          diagnostics: productOccurrenceDiagnostics(
            direct.diagnostics,
            provenanceOccurrence,
          ),
        };
      }
      const directDiagnostics = productOccurrenceDiagnostics(
        direct.diagnostics,
        provenanceOccurrence,
      );
      for (
        let diagnosticIndex = 0;
        diagnosticIndex < directDiagnostics.length;
        diagnosticIndex += 1
      ) {
        diagnostics[diagnostics.length] =
          directDiagnostics[diagnosticIndex]!;
      }
      const source = direct.value.items[0]!;
      let totalMass: number | null = null;
      if (source.definitionMass !== null) {
        try {
          const mass = new LocalAssemblyCompensatedSum();
          for (
            let occurrenceIndex = 0;
            occurrenceIndex < group.occurrences.length;
            occurrenceIndex += 1
          ) {
            const contribution =
              source.definitionMass *
              affineVolumeScale(
                group.occurrences[occurrenceIndex]!.transform,
              );
            mass.add(contribution);
          }
          totalMass = mass.value();
        } catch (error) {
          return bomRepresentationFailure(
            this.name,
            this.node,
            error,
            {
              partNode: group.part.node,
              component: group.component,
              effectiveConfigurationId: group.configurationId,
            },
          );
        }
      }
      const paths = group.occurrences.map(
        (occurrence) => occurrence.path,
      );
      items[index] = deepFreeze({
        component: group.component,
        partNode: source.partNode,
        effectiveConfigurationId: group.configurationId,
        partNumber: source.partNumber,
        description: source.description,
        materialId: source.materialId,
        material: source.material,
        quantity: group.occurrences.length,
        occurrencePaths: paths,
        massDensity: source.massDensity,
        massDensitySource: source.massDensitySource,
        definitionMass: source.definitionMass,
        totalMass,
      });
    }
    let totalQuantity = 0;
    let knownMass = 0;
    const knownMassSum = new LocalAssemblyCompensatedSum();
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        const quantity = addBoundedCount(
          totalQuantity,
          item.quantity,
          Number.MAX_SAFE_INTEGER,
        );
        if (!quantity.ok) {
          throw new RangeError(
            `Bill-of-materials quantity exceeds ${Number.MAX_SAFE_INTEGER}; actual is at least ${quantity.actual}`,
          );
        }
        totalQuantity = quantity.value;
        knownMassSum.add(item.totalMass ?? 0);
      }
      knownMass = knownMassSum.value();
    } catch (error) {
      return bomRepresentationFailure(
        this.name,
        this.node,
        error,
      );
    }
    const massComplete = items.every(
      (item) => item.totalMass !== null,
    );
    return success(
      deepFreeze({
        rootConfigurationId: this.#rootConfigurationId,
        units: { mass: "kg" as const },
        items,
        totalQuantity,
        massComplete,
        knownMass,
        totalMass: massComplete ? knownMass : null,
      }),
      deepFreeze(diagnostics),
    );
  }
}

/** Owned result container for selected direct local assemblies. @internal */
export class EvaluatedLocalAssemblyDesignV7 {
  readonly configurationId: ConfigurationId | null;
  readonly parameters: Readonly<Record<string, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly outputNames: readonly string[];
  readonly #owner: LocalAssemblyOwner;
  readonly #outputs: ReadonlyMap<string, EvaluatedLocalAssemblyV7>;

  constructor(
    owner: LocalAssemblyOwner,
    outputs: ReadonlyMap<string, EvaluatedLocalAssemblyV7>,
    configurationId: ConfigurationId | null,
    parameters: Readonly<Record<string, number>>,
    diagnostics: readonly Diagnostic[],
  ) {
    this.#owner = owner;
    this.#outputs = outputs;
    this.configurationId = configurationId;
    this.parameters = parameters;
    this.diagnostics = diagnostics;
    this.outputNames = localAssemblyFreeze([...outputs.keys()]);
    localAssemblyFreeze(this);
  }

  output(name: string): EvaluatedLocalAssemblyV7 {
    this.#owner.assertLive();
    const output = localAssemblyMapValue(this.#outputs, name);
    if (output === undefined) {
      throw new RangeError(
        `Unknown evaluated local assembly output '${name}'`,
      );
    }
    return output;
  }

  dispose(): void {
    this.#owner.dispose();
  }
}

function cleanupChildren(
  children: readonly EvaluatedPartDesignV7[],
): void {
  for (let index = 0; index < children.length; index += 1) {
    try {
      children[index]!.dispose();
    } catch {
      // Preserve the structured evaluation failure after best-effort cleanup.
    }
  }
}

/**
 * Evaluates selected direct Document v7 product outputs by flattening bounded,
 * acyclic local assembly trees into active local and external part leaves.
 *
 * Each distinct document/configuration context is prepared once. All geometry
 * limits and kernel capabilities are checked before a single globally bounded,
 * document-scoped geometry-resource phase. Suppressed occurrences remain inert;
 * recursive local graphs and external assembly outputs remain unsupported.
 *
 * @internal
 */
export async function evaluateLocalAssemblyOutputsV7(
  kernel: GeometryKernel,
  inputDocument: DesignDocumentV7,
  inputOptions: EvaluateLocalAssemblyOutputsV7Options = {},
): Promise<CadResult<EvaluatedLocalAssemblyDesignV7>> {
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

  let rootConfigurationId: ConfigurationId | null = null;
  let rootConfiguration: DesignConfigurationIR | undefined;
  if (options.configuration !== undefined) {
    if (
      !localAssemblyHasOwn(
        document.configurations ?? {},
        options.configuration,
      )
    ) {
      return failure(
        diagnostic(
          "CONFIGURATION_MISSING",
          `Unknown configuration '${options.configuration}'`,
          {
            severity: "error",
            path: `/configurations/${jsonPointerSegment(
              options.configuration,
            )}`,
            details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
          },
        ),
      );
    }
    rootConfigurationId = options.configuration as ConfigurationId;
    rootConfiguration =
      document.configurations![rootConfigurationId];
  }

  let rootParameters: ReturnType<typeof resolveEvaluationParameters>;
  try {
    rootParameters = resolveEvaluationParameters(
      document,
      options.parameters,
      rootConfigurationId,
      rootConfiguration,
    );
  } catch (error) {
    const boundary = postBoundaryFailure(options.signal);
    if (boundary !== undefined) return boundary;
    return failure(
      diagnostic(
        "EXPRESSION_INVALID",
        safeErrorMessage(
          error,
          "Local assembly parameters could not be resolved safely",
        ),
        {
          severity: "error",
          path: "/parameters",
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        },
      ),
    );
  }
  const afterParameters = postBoundaryFailure(options.signal);
  if (afterParameters !== undefined) return afterParameters;
  if (!rootParameters.ok) return rootParameters;
  const diagnostics: Diagnostic[] = [
    ...parsed.diagnostics,
    ...rootParameters.diagnostics,
  ];
  const assemblyContexts = new LocalAssemblyMap<
    ConfigurationId | null,
    ResolvedAssemblyContext
  >();
  localAssemblyMapInsert(
    assemblyContexts,
    rootConfigurationId,
    localAssemblyFreeze({
      configuration: rootConfiguration,
      expression: expressionEvaluator(rootParameters.value.values),
    }),
  );
  const resolveAssemblyContext = (
    configurationId: ConfigurationId | null,
  ): CadResult<ResolvedAssemblyContext> => {
    const existing = localAssemblyMapValue(
      assemblyContexts,
      configurationId,
    );
    if (existing !== undefined) return success(existing);
    const configuration =
      configurationId === null
        ? undefined
        : localAssemblyHasOwn(
              document.configurations ?? {},
              configurationId,
            )
          ? document.configurations![configurationId]
          : undefined;
    if (configurationId !== null && configuration === undefined) {
      return failure(
        diagnostic(
          "CONFIGURATION_MISSING",
          `Unknown configuration '${configurationId}'`,
          {
            severity: "error",
            path: `/configurations/${jsonPointerSegment(
              configurationId,
            )}`,
            details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
          },
        ),
      );
    }
    let resolved: ReturnType<typeof resolveEvaluationParameters>;
    try {
      resolved = resolveEvaluationParameters(
        document,
        options.parameters,
        configurationId,
        configuration,
      );
    } catch (error) {
      const boundary = postBoundaryFailure(options.signal);
      return (
        boundary ??
        failure(
          diagnostic(
            "EXPRESSION_INVALID",
            safeErrorMessage(
              error,
              configurationId === null
                ? "Base-context assembly parameters could not be resolved safely"
                : `Assembly parameters for configuration '${configurationId}' could not be resolved safely`,
            ),
            {
              severity: "error",
              path:
                configurationId === null
                  ? "/parameters"
                  : `/configurations/${jsonPointerSegment(
                      configurationId,
                    )}`,
              details: {
                phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                effectiveConfigurationId: configurationId,
              },
            },
          ),
        )
      );
    }
    const boundary = postBoundaryFailure(options.signal);
    if (boundary !== undefined) return boundary;
    if (!resolved.ok) return resolved;
    for (let index = 0; index < resolved.diagnostics.length; index += 1) {
      diagnostics[diagnostics.length] = resolved.diagnostics[index]!;
    }
    const context = localAssemblyFreeze({
      configuration,
      expression: expressionEvaluator(resolved.value.values),
    });
    localAssemblyMapInsert(
      assemblyContexts,
      configurationId,
      context,
    );
    return success(context);
  };

  const requested =
    options.outputs === undefined
      ? localAssemblyKeys(document.outputs)
      : [...options.outputs];
  if (
    requested.length >
    options.evaluationLimits.maxSelectedOutputs
  ) {
    return limitFailure(
      "maxSelectedOutputs",
      options.evaluationLimits.maxSelectedOutputs,
      requested.length,
      "/outputs",
    );
  }
  if (requested.length === 0) {
    return failure(
      diagnostic("OUTPUT_MISSING", "The document has no selected outputs", {
        severity: "error",
        path: "/outputs",
        details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
      }),
    );
  }

  const selected = new LocalAssemblyArray<SelectedAssembly>(
    requested.length,
  );
  const partsByContext = new LocalAssemblyMap<
    ConfigurationId | null,
    Set<NodeId>
  >();
  const contextualParts = new LocalAssemblySet<string>();
  const externalDocuments = new LocalAssemblySet<ResourceId>();
  let scannedInstances = 0;
  let activeOccurrences = 0;
  let occurrencePathSegments = 0;
  let placementOperations = 0;

  for (let outputIndex = 0; outputIndex < requested.length; outputIndex += 1) {
    const name = requested[outputIndex]!;
    const outputPath = `/outputs/${jsonPointerSegment(name)}`;
    const reference = localAssemblyHasOwn(document.outputs, name)
      ? document.outputs[name]
      : undefined;
    if (reference === undefined) {
      return failure(
        diagnostic("OUTPUT_MISSING", `Unknown output '${name}'`, {
          severity: "error",
          path: outputPath,
          details: { phase: LOCAL_ASSEMBLY_EVALUATION_PHASE },
        }),
      );
    }
    const node = localAssemblyHasOwn(
      document.nodes,
      reference.node,
    )
      ? document.nodes[reference.node]
      : undefined;
    if (
      reference.kind !== "assembly" ||
      node === undefined ||
      node.kind !== "assembly"
    ) {
      return unsupported(
        `Local assembly evaluation requires output '${name}' to directly reference an assembly node`,
        reference.node,
        outputPath,
        {
          supported: "direct-local-assembly-output",
          outputKind: reference.kind,
          nodeKind: node?.kind,
        },
      );
    }
    if (options.evaluationLimits.maxAssemblyDepth < 1) {
      return limitFailure(
        "maxAssemblyDepth",
        options.evaluationLimits.maxAssemblyDepth,
        1,
        `/nodes/${jsonPointerSegment(reference.node)}`,
      );
    }
    const rootContext = resolveAssemblyContext(rootConfigurationId);
    if (!rootContext.ok) return rootContext;
    const occurrences: SelectedOccurrence[] = [];
    const rootScanned = addBoundedCount(
      scannedInstances,
      node.instances.length,
      options.evaluationLimits.maxScannedInstances,
    );
    if (!rootScanned.ok) {
      return limitFailure(
        "maxScannedInstances",
        options.evaluationLimits.maxScannedInstances,
        rootScanned.actual,
        `/nodes/${jsonPointerSegment(reference.node)}/instances`,
      );
    }
    scannedInstances = rootScanned.value;
    const rootAncestry = localAssemblyFreeze([reference.node]);
    const traversal = new LocalAssemblyArray<AssemblyTraversalFrame>();
    traversal[0] = {
      nodeId: reference.node,
      node,
      configurationId: rootConfigurationId,
      context: rootContext.value,
      transform: IDENTITY_MATRIX,
      path: localAssemblyFreeze([] as EntityId[]),
      ancestry: rootAncestry,
      nextInstance: 0,
    };
    while (traversal.length > 0) {
      const boundary = postBoundaryFailure(options.signal);
      if (boundary !== undefined) return boundary;
      const frame = traversal[traversal.length - 1]!;
      if (frame.nextInstance >= frame.node.instances.length) {
        traversal.length -= 1;
        continue;
      }
      const instanceIndex = frame.nextInstance;
      frame.nextInstance += 1;
      const instance = frame.node.instances[instanceIndex]!;
      const suppressed =
        configuredSuppression(
          frame.context.configuration,
          frame.nodeId,
          instance.id,
        ) ?? instance.suppressed;
      if (suppressed) continue;
      const active = addBoundedCount(
        activeOccurrences,
        1,
        options.evaluationLimits.maxActiveOccurrences,
      );
      if (!active.ok) {
        return limitFailure(
          "maxActiveOccurrences",
          options.evaluationLimits.maxActiveOccurrences,
          active.actual,
          `/nodes/${jsonPointerSegment(frame.nodeId)}/instances`,
        );
      }
      activeOccurrences = active.value;
      const placements = addBoundedCount(
        placementOperations,
        instance.placement.length,
        options.evaluationLimits.maxPlacementOperations,
      );
      if (!placements.ok) {
        return limitFailure(
          "maxPlacementOperations",
          options.evaluationLimits.maxPlacementOperations,
          placements.actual,
          `/nodes/${jsonPointerSegment(frame.nodeId)}/instances/${instanceIndex}/placement`,
        );
      }
      placementOperations = placements.value;
      const componentPath =
        `/nodes/${jsonPointerSegment(frame.nodeId)}/instances/` +
        `${instanceIndex}/component`;
      const externalComponent =
        instance.component.source === "external"
          ? instance.component
          : undefined;
      if (
        externalComponent !== undefined &&
        externalComponent.outputKind !== "part"
      ) {
        return unsupported(
          `Active occurrence '${instance.id}' references an external assembly output`,
          frame.nodeId,
          componentPath,
          {
            supported: "active-local-part-or-assembly-or-external-part-occurrence",
            componentSource: "external",
            outputKind: externalComponent.outputKind,
            resource: externalComponent.resource,
            output: externalComponent.output,
          },
        );
      }
      const component =
        instance.component.source === "local"
          ? instance.component.reference
          : undefined;
      const componentNode =
        component === undefined
          ? undefined
          : localAssemblyHasOwn(document.nodes, component.node)
            ? document.nodes[component.node]
            : undefined;
      const localPart =
        component?.kind === "part" &&
        componentNode?.kind === "part" &&
        "geometry" in componentNode;
      const localAssembly =
        component?.kind === "assembly" &&
        componentNode?.kind === "assembly";
      if (
        externalComponent === undefined &&
        !localPart &&
        !localAssembly
      ) {
        return unsupported(
          `Active occurrence '${instance.id}' must reference a local part or assembly`,
          frame.nodeId,
          `${componentPath}/reference`,
          {
            supported: "active-local-part-or-assembly-occurrence",
            componentKind: component?.kind,
            nodeKind: componentNode?.kind,
          },
        );
      }
      const childConfigurationId = occurrenceConfigurationId(
        instance.configuration,
        frame.configurationId,
      );
      const nextPath = appendOccurrencePath(
        frame.path,
        instance.id,
      );
      const placement = resolvedPlacement(
        instance.placement,
        frame.context.expression,
        frame.nodeId,
        instanceIndex,
        options.signal,
      );
      if (!placement.ok) return placement;
      const composedPlacement = composeOccurrencePlacement(
        frame.transform,
        placement.value,
        frame.nodeId,
        instanceIndex,
        nextPath,
        options.signal,
      );
      if (!composedPlacement.ok) return composedPlacement;

      if (externalComponent !== undefined) {
        const pathSegments = addBoundedCount(
          occurrencePathSegments,
          nextPath.length,
          options.evaluationLimits.maxOccurrencePathSegments,
        );
        if (!pathSegments.ok) {
          return limitFailure(
            "maxOccurrencePathSegments",
            options.evaluationLimits.maxOccurrencePathSegments,
            pathSegments.actual,
            componentPath,
          );
        }
        occurrencePathSegments = pathSegments.value;
        if (
          !localAssemblySetContains(
            externalDocuments,
            externalComponent.resource,
          )
        ) {
          localAssemblySetInsert(
            externalDocuments,
            externalComponent.resource,
          );
          if (
            externalDocuments.size >
            options.evaluationLimits.maxExternalDocuments
          ) {
            return limitFailure(
              "maxExternalDocuments",
              options.evaluationLimits.maxExternalDocuments,
              externalDocuments.size,
              componentPath,
            );
          }
        }
        const partState = externalContextKey(
          externalComponent.resource,
          externalComponent.output,
          childConfigurationId,
        );
        if (!localAssemblySetContains(contextualParts, partState)) {
          localAssemblySetInsert(contextualParts, partState);
          if (
            contextualParts.size >
            options.evaluationLimits.maxContextualParts
          ) {
            return limitFailure(
              "maxContextualParts",
              options.evaluationLimits.maxContextualParts,
              contextualParts.size,
              componentPath,
            );
          }
        }
        occurrences[occurrences.length] = {
          source: "external",
          id: instance.id,
          path: nextPath,
          resource: externalComponent.resource,
          output: externalComponent.output,
          outputKind: "part",
          configurationId: childConfigurationId,
          transform: composedPlacement.value,
          parentNode: frame.nodeId,
          componentPath,
        };
        continue;
      }

      if (localAssembly) {
        if (component === undefined) {
          return unsupported(
            `Active occurrence '${instance.id}' has no local assembly reference`,
            frame.nodeId,
            componentPath,
            { supported: "local-assembly-reference" },
          );
        }
        if (
          nodePathContains(frame.ancestry, component.node)
        ) {
          return unsupported(
            `Active occurrence '${instance.id}' closes a recursive local assembly path`,
            frame.nodeId,
            `${componentPath}/reference`,
            {
              supported: "acyclic-local-assembly-graph",
              occurrencePath: nextPath,
              referencedNode: component.node,
            },
          );
        }
        const nextDepth = frame.ancestry.length + 1;
        if (
          nextDepth >
          options.evaluationLimits.maxAssemblyDepth
        ) {
          return limitFailure(
            "maxAssemblyDepth",
            options.evaluationLimits.maxAssemblyDepth,
            nextDepth,
            `${componentPath}/reference`,
          );
        }
        const childContext = resolveAssemblyContext(
          childConfigurationId,
        );
        if (!childContext.ok) return childContext;
        const scanned = addBoundedCount(
          scannedInstances,
          componentNode.instances.length,
          options.evaluationLimits.maxScannedInstances,
        );
        if (!scanned.ok) {
          return limitFailure(
            "maxScannedInstances",
            options.evaluationLimits.maxScannedInstances,
            scanned.actual,
            `/nodes/${jsonPointerSegment(component.node)}/instances`,
          );
        }
        scannedInstances = scanned.value;
        traversal[traversal.length] = {
          nodeId: component.node,
          node: componentNode,
          configurationId: childConfigurationId,
          context: childContext.value,
          transform: composedPlacement.value,
          path: nextPath,
          ancestry: appendNodePath(
            frame.ancestry,
            component.node,
          ),
          nextInstance: 0,
        };
        continue;
      }
      if (
        component === undefined ||
        componentNode === undefined ||
        componentNode.kind !== "part" ||
        !("geometry" in componentNode)
      ) {
        return unsupported(
          `Active occurrence '${instance.id}' must reference a local part`,
          frame.nodeId,
          `${componentPath}/reference`,
          {
            supported: "active-local-part-occurrence",
            componentKind: component?.kind,
            nodeKind: componentNode?.kind,
          },
        );
      }

      const pathSegments = addBoundedCount(
        occurrencePathSegments,
        nextPath.length,
        options.evaluationLimits.maxOccurrencePathSegments,
      );
      if (!pathSegments.ok) {
        return limitFailure(
          "maxOccurrencePathSegments",
          options.evaluationLimits.maxOccurrencePathSegments,
          pathSegments.actual,
          `${componentPath}/reference`,
        );
      }
      occurrencePathSegments = pathSegments.value;
      const partState =
        `local\u0000${contextKey(
          component.node,
          childConfigurationId,
        )}`;
      if (!localAssemblySetContains(contextualParts, partState)) {
        localAssemblySetInsert(contextualParts, partState);
        if (
          contextualParts.size >
          options.evaluationLimits.maxContextualParts
        ) {
          return limitFailure(
            "maxContextualParts",
            options.evaluationLimits.maxContextualParts,
            contextualParts.size,
            `${componentPath}/reference`,
          );
        }
        let contextParts = localAssemblyMapValue(
          partsByContext,
          childConfigurationId,
        );
        if (contextParts === undefined) {
          contextParts = new LocalAssemblySet<NodeId>();
          localAssemblyMapInsert(
            partsByContext,
            childConfigurationId,
            contextParts,
          );
        }
        localAssemblySetInsert(contextParts, component.node);
      }
      occurrences[occurrences.length] = {
        source: "local",
        id: instance.id,
        path: nextPath,
        parentNode: frame.nodeId,
        componentPath,
        partNode: component.node,
        configurationId: childConfigurationId,
        transform: composedPlacement.value,
      };
    }
    selected[outputIndex] = {
      name,
      node: reference.node,
      occurrences: localAssemblyFreeze(occurrences),
    };
  }

  const firstExternalOccurrences =
    new LocalAssemblyMap<ResourceId, SelectedExternalOccurrence>();
  for (let outputIndex = 0; outputIndex < selected.length; outputIndex += 1) {
    const occurrences = selected[outputIndex]!.occurrences;
    for (let index = 0; index < occurrences.length; index += 1) {
      const occurrence = occurrences[index]!;
      if (
        occurrence.source === "external" &&
        !localAssemblyMapContains(
          firstExternalOccurrences,
          occurrence.resource,
        )
      ) {
        localAssemblyMapInsert(
          firstExternalOccurrences,
          occurrence.resource,
          occurrence,
        );
      }
    }
  }

  const externalResourceIds = [...externalDocuments];
  localAssemblyApply<void>(
    localAssemblyArraySort,
    externalResourceIds,
    [lexicalCompare],
  );
  const rootScope = deepFreeze({
    source: "root" as const,
  });
  const sessionResult =
    createDocumentV7ResourceResolutionSession({
      ...(options.resolver === undefined
        ? {}
        : { resolver: options.resolver }),
      ...(options.resourceLimits === undefined
        ? {}
        : { limits: options.resourceLimits }),
      ...(options.signal === undefined
        ? {}
        : { signal: options.signal }),
    });
  const afterSession = postBoundaryFailure(options.signal);
  if (afterSession !== undefined) return afterSession;
  if (!sessionResult.ok) return sessionResult;
  const resourceSession = sessionResult.value;
  try {
  const resolvedExternalDocuments =
    new LocalAssemblyMap<ResourceId, ResolvedExternalDocumentV7>();
  const rootDefinitions = document.resources ?? {};
  let documentResources: ResolvedDocumentResourcesV7 | undefined;
  if (externalResourceIds.length > 0) {
    const resolvedDocuments = await resourceSession.resolve(
      [
        {
          scope: rootScope,
          definitions: rootDefinitions,
          ids: externalResourceIds,
        },
      ],
    );
    const afterDocuments = postBoundaryFailure(options.signal);
    if (afterDocuments !== undefined) return afterDocuments;
    if (!resolvedDocuments.ok) {
      const diagnosticResource =
        resolvedDocuments.diagnostics[0]?.details?.resourceId;
      const occurrence =
        typeof diagnosticResource === "string"
          ? localAssemblyMapValue(
              firstExternalOccurrences,
              diagnosticResource as ResourceId,
            )
          : undefined;
      return externalComponentFailure(
        resolvedDocuments.diagnostics,
        occurrence ??
          localAssemblyMapValue(
            firstExternalOccurrences,
            externalResourceIds[0]!,
          )!,
      );
    }
    documentResources = resolvedDocuments.value;
    for (
      let diagnosticIndex = 0;
      diagnosticIndex < resolvedDocuments.diagnostics.length;
      diagnosticIndex += 1
    ) {
      diagnostics[diagnostics.length] =
        resolvedDocuments.diagnostics[diagnosticIndex]!;
    }
  }
  for (let index = 0; index < externalResourceIds.length; index += 1) {
    const resource = externalResourceIds[index]!;
    const occurrence = localAssemblyMapValue(
      firstExternalOccurrences,
      resource,
    )!;
    const definition = localAssemblyHasOwn(rootDefinitions, resource)
      ? rootDefinitions[resource]
      : undefined;
    if (definition === undefined) {
      return externalComponentFailure(
        [
          diagnostic(
            "REFERENCE_MISSING",
            `External component document resource '${resource}' is not defined`,
            {
              severity: "error",
              path: `/resources/${jsonPointerSegment(resource)}`,
              details: {
                phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                resource,
              },
            },
          ),
        ],
        occurrence,
      );
    }
    const bytes = documentResources?.read(rootScope, resource);
    if (bytes === undefined) {
      return externalComponentFailure(
        [
          diagnostic(
            "RESOURCE_RESOLUTION_FAILED",
            `External component document resource '${resource}' was not retained`,
            {
              severity: "error",
              details: {
                phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                resource,
              },
            },
          ),
        ],
        occurrence,
      );
    }
    const admitted = admitDocumentBytesToV7(
      bytes,
      options.documentLimits === undefined
        ? {}
        : { limits: options.documentLimits },
    );
    const afterAdmission = postBoundaryFailure(
      options.signal,
      occurrence.parentNode,
    );
    if (afterAdmission !== undefined) return afterAdmission;
    if (!admitted.ok) {
      return externalComponentFailure(
        admitted.diagnostics,
        occurrence,
      );
    }
    const external = localAssemblyFreeze({
      resource,
      scope: deepFreeze({
        source: "external" as const,
        resource,
        digest: definition.digest,
      }),
      digest: definition.digest,
      byteLength: definition.byteLength,
      sourceVersion: admitted.value.sourceVersion,
      document: admitted.value.document,
    });
    const admittedDiagnostics = externalComponentDiagnostics(
      admitted.diagnostics,
      occurrence,
      external,
    );
    for (
      let diagnosticIndex = 0;
      diagnosticIndex < admittedDiagnostics.length;
      diagnosticIndex += 1
    ) {
      diagnostics[diagnostics.length] =
        admittedDiagnostics[diagnosticIndex]!;
    }
    localAssemblyMapInsert(
      resolvedExternalDocuments,
      resource,
      external,
    );
  }

  const externalBatches =
    new LocalAssemblyMap<string, ExternalPartEvaluationBatchV7>();
  const resolvedSelected =
    new LocalAssemblyArray<ResolvedSelectedAssembly>(selected.length);
  for (
    let outputIndex = 0;
    outputIndex < resolvedSelected.length;
    outputIndex += 1
  ) {
    const item = selected[outputIndex]!;
    const occurrences =
      new LocalAssemblyArray<ResolvedSelectedOccurrence>(
        item.occurrences.length,
      );
    for (let index = 0; index < item.occurrences.length; index += 1) {
      const occurrence = item.occurrences[index]!;
      if (occurrence.source === "local") {
        const component = deepFreeze({
          source: "local" as const,
          partNode: occurrence.partNode,
        });
        occurrences[index] = {
          id: occurrence.id,
          path: occurrence.path,
          parentNode: occurrence.parentNode,
          componentPath: occurrence.componentPath,
          component,
          partNode: occurrence.partNode,
          configurationId: occurrence.configurationId,
          transform: occurrence.transform,
          evaluationKey: productComponentContextKey(
            component,
            occurrence.configurationId,
          ),
        };
        continue;
      }

      const external = localAssemblyMapValue(
        resolvedExternalDocuments,
        occurrence.resource,
      )!;
      const reference = localAssemblyHasOwn(
        external.document.outputs,
        occurrence.output,
      )
        ? external.document.outputs[occurrence.output]
        : undefined;
      if (reference === undefined) {
        return externalComponentFailure(
          [
            diagnostic(
              "OUTPUT_MISSING",
              `External document has no output '${occurrence.output}'`,
              {
                severity: "error",
                path: `/outputs/${jsonPointerSegment(occurrence.output)}`,
                details: {
                  phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                  available: lexicallySortedKeys(
                    external.document.outputs,
                  ),
                },
              },
            ),
          ],
          occurrence,
          external,
        );
      }
      const partNode = localAssemblyHasOwn(
        external.document.nodes,
        reference.node,
      )
        ? external.document.nodes[reference.node]
        : undefined;
      if (
        reference.kind !== "part" ||
        partNode === undefined ||
        partNode.kind !== "part" ||
        !("geometry" in partNode)
      ) {
        return externalComponentFailure(
          [
            diagnostic(
              "EVALUATION_UNSUPPORTED",
              `External output '${occurrence.output}' must directly produce a part`,
              {
                severity: "error",
                node: reference.node,
                path: `/outputs/${jsonPointerSegment(occurrence.output)}`,
                details: {
                  phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                  declaredOutputKind: occurrence.outputKind,
                  actualOutputKind: reference.kind,
                  nodeKind: partNode?.kind,
                },
              },
            ),
          ],
          occurrence,
          external,
        );
      }
      if (
        occurrence.configurationId !== null &&
        !localAssemblyHasOwn(
          external.document.configurations ?? {},
          occurrence.configurationId,
        )
      ) {
        return externalComponentFailure(
          [
            diagnostic(
              "CONFIGURATION_MISSING",
              `External document has no configuration '${occurrence.configurationId}'`,
              {
                severity: "error",
                path: `/configurations/${jsonPointerSegment(
                  occurrence.configurationId,
                )}`,
                details: {
                  phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                  available: lexicallySortedKeys(
                    external.document.configurations ?? {},
                  ),
                },
              },
            ),
          ],
          occurrence,
          external,
        );
      }

      const batchKey =
        `${occurrence.resource}\u0000${occurrence.configurationId ?? ""}`;
      let batch = localAssemblyMapValue(externalBatches, batchKey);
      if (batch === undefined) {
        batch = {
          key: batchKey,
          external,
          configurationId: occurrence.configurationId,
          outputs: new LocalAssemblySet<string>(),
          firstOccurrence: occurrence,
          firstOccurrencesByOutput:
            new LocalAssemblyMap<
              string,
              SelectedExternalOccurrence
            >(),
        };
        localAssemblyMapInsert(externalBatches, batchKey, batch);
      }
      localAssemblySetInsert(batch.outputs, occurrence.output);
      if (
        !localAssemblyMapContains(
          batch.firstOccurrencesByOutput,
          occurrence.output,
        )
      ) {
        localAssemblyMapInsert(
          batch.firstOccurrencesByOutput,
          occurrence.output,
          occurrence,
        );
      }
      const component = deepFreeze({
        source: "external" as const,
        resource: occurrence.resource,
        digest: external.digest,
        byteLength: external.byteLength,
        output: occurrence.output,
        outputKind: "part" as const,
        sourceVersion: external.sourceVersion,
        partNode: reference.node,
      });
      occurrences[index] = {
        id: occurrence.id,
        path: occurrence.path,
        parentNode: occurrence.parentNode,
        componentPath: occurrence.componentPath,
        component,
        partNode: reference.node,
        configurationId: occurrence.configurationId,
        transform: occurrence.transform,
        evaluationKey: productComponentContextKey(
          component,
          occurrence.configurationId,
        ),
      };
    }
    resolvedSelected[outputIndex] = {
      name: item.name,
      node: item.node,
      occurrences: localAssemblyFreeze(occurrences),
    };
  }

  const contextIds = [...partsByContext.keys()];
  localAssemblyApply<void>(localAssemblyArraySort, contextIds, [
    (
      first: ConfigurationId | null,
      second: ConfigurationId | null,
    ) =>
      first === null
        ? second === null
          ? 0
          : -1
        : second === null
          ? 1
          : lexicalCompare(first, second),
  ]);
  const pendingBatches =
    new LocalAssemblyArray<PendingProductPartBatchV7>();
  const partEvaluationLimits = {
    maxSelectedOutputs:
      options.evaluationLimits.maxContextualParts,
    maxParameterOverrides:
      options.evaluationLimits.maxParameterOverrides,
    maxPartBodies: options.evaluationLimits.maxPartBodies,
    maxDistinctSolids:
      options.evaluationLimits.maxDistinctSolids,
    maxSolidGraphNodes:
      options.evaluationLimits.maxSolidGraphNodes,
    maxSolidDependencyLinks:
      options.evaluationLimits.maxSolidDependencyLinks,
    maxTransformOperations:
      options.evaluationLimits.maxTransformOperations,
    maxResolvedMaterials:
      options.evaluationLimits.maxResolvedMaterials,
  };
  for (
    let contextIndex = 0;
    contextIndex < contextIds.length;
    contextIndex += 1
  ) {
    const configurationId = contextIds[contextIndex]!;
    const partIds = [
      ...localAssemblyMapValue(partsByContext, configurationId)!,
    ];
    localAssemblyApply<void>(localAssemblyArraySort, partIds, [
      lexicalCompare,
    ]);
    const syntheticOutputs =
      localAssemblyNullRecord<DesignDocumentV7["outputs"][string]>();
    for (let index = 0; index < partIds.length; index += 1) {
      const id = partIds[index]!;
      defineRecordValue(syntheticOutputs, id, {
        node: id,
        kind: "part",
      });
    }
    const syntheticDocument = {
      ...document,
      outputs: syntheticOutputs,
    } as DesignDocumentV7;
    const prepared = preparePartOutputsV7(syntheticDocument, {
      ...(configurationId === null
        ? {}
        : { configuration: configurationId }),
      parameters: options.parameters,
      outputs: partIds,
      evaluationLimits: partEvaluationLimits,
      ...(options.resourceLimits === undefined
        ? {}
        : { resourceLimits: options.resourceLimits }),
      ...(options.documentLimits === undefined
        ? {}
        : { documentLimits: options.documentLimits }),
      ...(options.signal === undefined
        ? {}
        : { signal: options.signal }),
    });
    const afterPrepare = postBoundaryFailure(options.signal);
    if (afterPrepare !== undefined) return afterPrepare;
    if (!prepared.ok) return prepared;
    pendingBatches[pendingBatches.length] = {
      source: "local",
      key: `local\u0000${configurationId ?? ""}`,
      scope: rootScope,
      configurationId,
      outputs: localAssemblyFreeze(partIds),
      prepared: prepared.value,
    };
  }

  const externalBatchKeys = [...externalBatches.keys()];
  localAssemblyApply<void>(
    localAssemblyArraySort,
    externalBatchKeys,
    [lexicalCompare],
  );
  for (
    let batchIndex = 0;
    batchIndex < externalBatchKeys.length;
    batchIndex += 1
  ) {
    const batch = localAssemblyMapValue(
      externalBatches,
      externalBatchKeys[batchIndex]!,
    )!;
    const outputs = [...batch.outputs];
    localAssemblyApply<void>(localAssemblyArraySort, outputs, [
      lexicalCompare,
    ]);
    const prepared = preparePartOutputsV7(
      batch.external.document,
      {
        ...(batch.configurationId === null
          ? {}
          : { configuration: batch.configurationId }),
        outputs,
        evaluationLimits: partEvaluationLimits,
        ...(options.resourceLimits === undefined
          ? {}
          : { resourceLimits: options.resourceLimits }),
        ...(options.documentLimits === undefined
          ? {}
          : { documentLimits: options.documentLimits }),
        ...(options.signal === undefined
          ? {}
          : { signal: options.signal }),
      },
    );
    const afterPrepare = postBoundaryFailure(
      options.signal,
      batch.firstOccurrence.parentNode,
    );
    if (afterPrepare !== undefined) return afterPrepare;
    if (!prepared.ok) {
      return {
        ok: false,
        diagnostics: externalBatchDiagnostics(
          prepared.diagnostics,
          batch,
        ),
      };
    }
    pendingBatches[pendingBatches.length] = {
      source: "external",
      key: `external\u0000${batch.key}`,
      scope: batch.external.scope,
      configurationId: batch.configurationId,
      outputs: localAssemblyFreeze(outputs),
      prepared: prepared.value,
      external: batch.external,
      firstOccurrence: batch.firstOccurrence,
      batch,
    };
  }

  let partBodies = 0;
  let distinctSolids = 0;
  let solidGraphNodes = 0;
  let solidDependencyLinks = 0;
  let transformOperations = 0;
  let resolvedMaterials = 0;
  for (
    let batchIndex = 0;
    batchIndex < pendingBatches.length;
    batchIndex += 1
  ) {
    const batch = pendingBatches[batchIndex]!;
    const metrics = batch.prepared.metrics;
    const metricPath =
      batch.source === "local"
        ? batch.outputs.length === 0
          ? "/nodes"
          : `/nodes/${jsonPointerSegment(batch.outputs[0]!)}/geometry`
        : `/outputs/${jsonPointerSegment(
            batch.firstOccurrence.output,
          )}`;
    const charge = (
      current: number,
      increment: number,
      resource:
        | "maxPartBodies"
        | "maxDistinctSolids"
        | "maxSolidGraphNodes"
        | "maxSolidDependencyLinks"
        | "maxTransformOperations"
        | "maxResolvedMaterials",
    ): CadResult<number> => {
      const next = addBoundedCount(
        current,
        increment,
        options.evaluationLimits[resource],
      );
      if (next.ok) return success(next.value);
      const exceeded = limitFailure(
        resource,
        options.evaluationLimits[resource],
        next.actual,
        metricPath,
      );
      return batch.source === "external"
        ? externalComponentFailure(
            exceeded.diagnostics,
            batch.firstOccurrence,
            batch.external,
          )
        : exceeded;
    };
    const bodies = charge(
      partBodies,
      metrics.partBodies,
      "maxPartBodies",
    );
    if (!bodies.ok) return bodies;
    partBodies = bodies.value;
    const solids = charge(
      distinctSolids,
      metrics.distinctSolids,
      "maxDistinctSolids",
    );
    if (!solids.ok) return solids;
    distinctSolids = solids.value;
    const graphNodes = charge(
      solidGraphNodes,
      metrics.solidGraphNodes,
      "maxSolidGraphNodes",
    );
    if (!graphNodes.ok) return graphNodes;
    solidGraphNodes = graphNodes.value;
    const dependencyLinks = charge(
      solidDependencyLinks,
      metrics.solidDependencyLinks,
      "maxSolidDependencyLinks",
    );
    if (!dependencyLinks.ok) return dependencyLinks;
    solidDependencyLinks = dependencyLinks.value;
    const transforms = charge(
      transformOperations,
      metrics.transformOperations,
      "maxTransformOperations",
    );
    if (!transforms.ok) return transforms;
    transformOperations = transforms.value;
    const materials = charge(
      resolvedMaterials,
      metrics.resolvedMaterials,
      "maxResolvedMaterials",
    );
    if (!materials.ok) return materials;
    resolvedMaterials = materials.value;
  }

  const preparedBatches =
    new LocalAssemblyArray<PreparedProductPartBatchV7>();
  for (
    let batchIndex = 0;
    batchIndex < pendingBatches.length;
    batchIndex += 1
  ) {
    const batch = pendingBatches[batchIndex]!;
    const retained = preflightPreparedPartOutputsV7(
      kernel,
      batch.prepared,
    );
    const afterPreflight = postBoundaryFailure(options.signal);
    if (afterPreflight !== undefined) return afterPreflight;
    if (!retained.ok) {
      return batch.source === "external"
        ? {
            ok: false,
            diagnostics: externalBatchDiagnostics(
              retained.diagnostics,
              batch.batch,
            ),
          }
        : retained;
    }
    preparedBatches[preparedBatches.length] = {
      ...batch,
      retained: retained.value,
    };
  }

  const rootGeometryIds = new LocalAssemblySet<ResourceId>();
  const geometryBatches =
    new LocalAssemblyArray<DocumentV7ResourceResolutionBatch>();
  for (
    let batchIndex = 0;
    batchIndex < preparedBatches.length;
    batchIndex += 1
  ) {
    const batch = preparedBatches[batchIndex]!;
    if (batch.source === "local") {
      for (
        let resourceIndex = 0;
        resourceIndex < batch.prepared.resourceIds.length;
        resourceIndex += 1
      ) {
        localAssemblySetInsert(
          rootGeometryIds,
          batch.prepared.resourceIds[resourceIndex]!,
        );
      }
    } else if (batch.prepared.resourceIds.length > 0) {
      geometryBatches[geometryBatches.length] = {
        scope: batch.scope,
        definitions: batch.external.document.resources ?? {},
        ids: batch.prepared.resourceIds,
      };
    }
  }
  if (rootGeometryIds.size > 0) {
    const ids = [...rootGeometryIds];
    localAssemblyApply<void>(localAssemblyArraySort, ids, [
      lexicalCompare,
    ]);
    geometryBatches[geometryBatches.length] = {
      scope: rootScope,
      definitions: rootDefinitions,
      ids: localAssemblyFreeze(ids),
    };
  }

  const geometryResources = await resourceSession.resolve(
    geometryBatches,
  );
  const afterGeometryResources = postBoundaryFailure(options.signal);
  if (afterGeometryResources !== undefined) {
    return afterGeometryResources;
  }
  if (!geometryResources.ok) {
    let failedExternal:
      | Extract<
          PreparedProductPartBatchV7,
          { readonly source: "external" }
        >
      | undefined;
    const failedScope =
      geometryResources.diagnostics[0]?.details?.documentScope;
    if (
      typeof failedScope === "object" &&
      failedScope !== null &&
      "source" in failedScope &&
      failedScope.source === "external" &&
      "resource" in failedScope &&
      typeof failedScope.resource === "string"
    ) {
      for (
        let batchIndex = 0;
        batchIndex < preparedBatches.length;
        batchIndex += 1
      ) {
        const candidate = preparedBatches[batchIndex]!;
        if (
          candidate.source === "external" &&
          candidate.external.resource === failedScope.resource
        ) {
          failedExternal = candidate;
          break;
        }
      }
    }
    return failedExternal === undefined
      ? geometryResources
      : externalComponentFailure(
          geometryResources.diagnostics,
          failedExternal.firstOccurrence,
          failedExternal.external,
        );
  }
  for (
    let diagnosticIndex = 0;
    diagnosticIndex < geometryResources.diagnostics.length;
    diagnosticIndex += 1
  ) {
    diagnostics[diagnostics.length] =
      geometryResources.diagnostics[diagnosticIndex]!;
  }

  const children: EvaluatedPartDesignV7[] = [];
  const partResults = new LocalAssemblyMap<string, EvaluatedPartV7>();
  for (
    let batchIndex = 0;
    batchIndex < preparedBatches.length;
    batchIndex += 1
  ) {
    const batch = preparedBatches[batchIndex]!;
    const scopedResources =
      batch.prepared.resourceIds.length === 0
        ? undefined
        : geometryResources.value.forScope(batch.scope);
    if (
      batch.prepared.resourceIds.length > 0 &&
      scopedResources === undefined
    ) {
      const missing = failure(
        diagnostic(
          "RESOURCE_RESOLUTION_FAILED",
          "Prepared product resources were not retained for execution",
          {
            severity: "error",
            details: {
              phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
              documentScope: batch.scope,
            },
          },
        ),
      );
      cleanupChildren(children);
      return batch.source === "external"
        ? externalComponentFailure(
            missing.diagnostics,
            batch.firstOccurrence,
            batch.external,
          )
        : missing;
    }
    let result: CadResult<EvaluatedPartDesignV7>;
    try {
      result = await executePreparedPartOutputsV7(
        kernel,
        batch.prepared,
        batch.retained,
        scopedResources,
      );
    } catch (error) {
      const boundary = postBoundaryFailure(options.signal);
      const rejected =
        boundary ??
        failure(
          diagnostic(
            "KERNEL_ERROR",
            batch.source === "local"
              ? batch.configurationId === null
                ? "Base-context part evaluation rejected unexpectedly"
                : `Part evaluation for configuration '${batch.configurationId}' rejected unexpectedly`
              : `External part evaluation for resource '${batch.external.resource}' rejected unexpectedly`,
            {
              severity: "error",
              details: {
                phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                effectiveConfigurationId: batch.configurationId,
                cause: safeErrorMessage(
                  error,
                  "Part evaluation rejected with an opaque value",
                ),
              },
            },
          ),
        );
      cleanupChildren(children);
      if (boundary !== undefined) return boundary;
      return batch.source === "external"
        ? externalComponentFailure(
            rejected.diagnostics,
            batch.firstOccurrence,
            batch.external,
          )
        : rejected;
    }
    const boundary = postBoundaryFailure(options.signal);
    if (boundary !== undefined) {
      if (result.ok) {
        try {
          result.value.dispose();
        } catch {
          // Continue cleaning every previously completed product batch.
        }
      }
      cleanupChildren(children);
      return postBoundaryFailure(options.signal) ?? boundary;
    }
    if (!result.ok) {
      cleanupChildren(children);
      return batch.source === "external"
        ? {
            ok: false,
            diagnostics: externalBatchDiagnostics(
              result.diagnostics,
              batch.batch,
            ),
          }
        : result;
    }
    children[children.length] = result.value;
    const resultDiagnostics =
      batch.source === "external"
        ? externalBatchDiagnostics(
            result.diagnostics,
            batch.batch,
          )
        : result.diagnostics;
    for (
      let diagnosticIndex = 0;
      diagnosticIndex < resultDiagnostics.length;
      diagnosticIndex += 1
    ) {
      diagnostics[diagnostics.length] =
        resultDiagnostics[diagnosticIndex]!;
    }
    for (
      let outputIndex = 0;
      outputIndex < batch.outputs.length;
      outputIndex += 1
    ) {
      const output = batch.outputs[outputIndex]!;
      const component: ProductPartComponentV7 =
        batch.source === "local"
          ? deepFreeze({
              source: "local" as const,
              partNode: output as NodeId,
            })
          : deepFreeze({
              source: "external" as const,
              resource: batch.external.resource,
              digest: batch.external.digest,
              byteLength: batch.external.byteLength,
              output,
              outputKind: "part" as const,
              sourceVersion: batch.external.sourceVersion,
              partNode:
                batch.external.document.outputs[output]!.node,
            });
      localAssemblyMapInsert(
        partResults,
        productComponentContextKey(
          component,
          batch.configurationId,
        ),
        result.value.output(output),
      );
    }
  }

  const owner = new LocalAssemblyOwner(children);
  const outputs = new LocalAssemblyMap<string, EvaluatedLocalAssemblyV7>();
  for (
    let outputIndex = 0;
    outputIndex < resolvedSelected.length;
    outputIndex += 1
  ) {
    const item = resolvedSelected[outputIndex]!;
    const occurrences =
      new LocalAssemblyArray<EvaluatedLocalOccurrenceV7>(
        item.occurrences.length,
      );
    for (
      let occurrenceIndex = 0;
      occurrenceIndex < item.occurrences.length;
      occurrenceIndex += 1
    ) {
      const occurrence = item.occurrences[occurrenceIndex]!;
      const part = localAssemblyMapValue(
        partResults,
        occurrence.evaluationKey,
      );
      if (part === undefined) {
        try {
          owner.dispose();
        } catch {
          // Preserve the missing-result invariant diagnostic.
        }
        return failure(
          diagnostic(
            "KERNEL_ERROR",
            "A prepared product part result was unavailable",
            {
              severity: "error",
              node: occurrence.parentNode,
              path: occurrence.componentPath,
              details: {
                phase: LOCAL_ASSEMBLY_EVALUATION_PHASE,
                component: occurrence.component,
                occurrencePath: occurrence.path,
              },
            },
          ),
        );
      }
      const evaluatedOccurrence = deepFreeze({
        id: occurrence.id,
        path: occurrence.path,
        component: occurrence.component,
        partNode: occurrence.partNode,
        effectiveConfigurationId: occurrence.configurationId,
        configurationId: occurrence.configurationId,
        part,
        transform: occurrence.transform,
      });
      localAssemblyWeakMapInsert(
        evaluatedOccurrenceProvenanceV7,
        evaluatedOccurrence,
        localAssemblyFreeze({
          parentNode: occurrence.parentNode,
          componentPath: occurrence.componentPath,
        }),
      );
      occurrences[occurrenceIndex] = evaluatedOccurrence;
    }
    localAssemblyMapInsert(
      outputs,
      item.name,
      new EvaluatedLocalAssemblyV7(
        item.name,
        item.node,
        occurrences,
        owner,
        rootConfigurationId,
      ),
    );
  }

  const publicParameters = localAssemblyNullRecord<number>();
  for (const [id, value] of rootParameters.value.values) {
    defineRecordValue(publicParameters, id, value);
  }
  const frozenDiagnostics = deepFreeze(diagnostics);
  const evaluated = new EvaluatedLocalAssemblyDesignV7(
    owner,
    outputs,
    rootConfigurationId,
    deepFreeze(publicParameters),
    frozenDiagnostics,
  );
  const finalBoundary = postBoundaryFailure(options.signal);
  if (finalBoundary !== undefined) {
    try {
      owner.dispose();
    } catch {
      // The boundary failure remains authoritative after complete cleanup.
    }
    return postBoundaryFailure(options.signal) ?? finalBoundary;
  }
  return success(evaluated, frozenDiagnostics);
  } finally {
    resourceSession.dispose();
  }
}

/**
 * Product-oriented aliases for the source-only assembly evaluator.
 *
 * The historical local names remain temporarily available to keep the staged
 * test surface stable while external assembly recursion is still unsupported.
 *
 * @internal
 */
export const evaluateProductAssemblyOutputsV7 =
  evaluateLocalAssemblyOutputsV7;
export const EvaluatedProductAssemblyV7 =
  EvaluatedLocalAssemblyV7;
export type EvaluatedProductAssemblyV7 =
  EvaluatedLocalAssemblyV7;
export const EvaluatedProductAssemblyDesignV7 =
  EvaluatedLocalAssemblyDesignV7;
export type EvaluatedProductAssemblyDesignV7 =
  EvaluatedLocalAssemblyDesignV7;
export type EvaluateProductAssemblyOutputsV7Options =
  EvaluateLocalAssemblyOutputsV7Options;
export type ProductAssemblyEvaluationLimitsV7 =
  LocalAssemblyEvaluationLimitsV7;
export const DEFAULT_PRODUCT_ASSEMBLY_EVALUATION_LIMITS_V7 =
  DEFAULT_LOCAL_ASSEMBLY_EVALUATION_LIMITS_V7;
export type EvaluatedProductOccurrenceV7 =
  EvaluatedLocalOccurrenceV7;
export type ProductBillOfMaterialsV7 =
  ContextualBillOfMaterialsV7;
export type ProductBillOfMaterialsItemV7 =
  ContextualBillOfMaterialsItemV7;
