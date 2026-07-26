import type { DesignDocumentLimits } from "../document-limits.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "../core/result.js";
import type {
  EvaluatedDesign,
  EvaluatedSolid,
  ShapeExportFormat,
  StepExportOptions,
} from "../evaluator.js";
import type { DesignDocumentV7 } from "../ir.js";
import type {
  MeshData,
  MeshOptions,
  ShapeMeasurements,
} from "../kernel.js";
import type { KernelTopologySnapshot } from "../protocol/topology.js";
import type {
  ResourceResolutionLimitsV7,
  ResourceResolverRequestV7,
  ResourceResolverV7,
} from "../resource-resolution.js";
import type {
  EvaluateImportedBodyOptions,
  EvaluatedImportedBody,
  ImportedBodyDocument,
  ImportedBodyMediaType,
  ImportedBodyProvenance,
  ImportedBodyResolver,
  ImportedBodyResourceLimits,
} from "../imported-body.js";

export interface ImportedBodyDocumentState {
  readonly document: DesignDocumentV7;
  readonly output: string;
  readonly provenance: ImportedBodyProvenance;
}

export interface CapturedEvaluateImportedBodyOptions {
  readonly resolver?: ResourceResolverV7;
  readonly resourceLimits?: Partial<ResourceResolutionLimitsV7>;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly signal?: AbortSignal;
}

type SourceFailure = {
  readonly message: string;
  readonly path: string;
};

const ImportedBodyRuntimeArray = Array;
const ImportedBodyRuntimeObject = Object;
const ImportedBodyRuntimeReflect = Reflect;
const ImportedBodyRuntimeWeakMap = WeakMap;
const ImportedBodyRuntimeWeakSet = WeakSet;
const importedBodyRuntimeArrayIsArray = Array.isArray;
const importedBodyRuntimeObjectCreate = Object.create;
const importedBodyRuntimeObjectDefineProperty = Object.defineProperty;
const importedBodyRuntimeObjectFreeze = Object.freeze;
const importedBodyRuntimeObjectGetOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
const importedBodyRuntimeObjectGetPrototypeOf = Object.getPrototypeOf;
const importedBodyRuntimeObjectHasOwn = Object.hasOwn;
const importedBodyRuntimeObjectPrototype = Object.prototype;
const importedBodyRuntimeReflectApply = Reflect.apply;
const importedBodyRuntimeReflectOwnKeys = Reflect.ownKeys;
const importedBodyRuntimeStringReplaceAll = String.prototype.replaceAll;
const importedBodyRuntimeWeakMapGet = WeakMap.prototype.get;
const importedBodyRuntimeWeakMapSet = WeakMap.prototype.set;
const importedBodyRuntimeWeakSetAdd = WeakSet.prototype.add;
const importedBodyRuntimeWeakSetHas = WeakSet.prototype.has;

const importedBodyDocuments =
  new ImportedBodyRuntimeWeakMap<object, ImportedBodyDocumentState>();
const importedBodySourceFailures =
  new ImportedBodyRuntimeWeakSet<object>();

export const defaultImportedBodyResourceLimits: ImportedBodyResourceLimits =
  Object.freeze({
    maxResourceBytes: 64 * 1024 * 1024,
  });

function applyImportedBodyRuntime<T>(
  operation: CallableFunction,
  receiver: unknown,
  arguments_: readonly unknown[],
): T {
  return importedBodyRuntimeReflectApply(
    operation,
    receiver,
    arguments_,
  ) as T;
}

function defineImportedBodyRuntimeValue(
  target: object,
  property: PropertyKey,
  value: unknown,
  enumerable = true,
): void {
  applyImportedBodyRuntime<void>(
    importedBodyRuntimeObjectDefineProperty,
    ImportedBodyRuntimeObject,
    [
      target,
      property,
      {
        configurable: false,
        enumerable,
        writable: false,
        value,
      },
    ],
  );
}

function freezeImportedBodyRuntime<T>(value: T): T {
  return applyImportedBodyRuntime<T>(
    importedBodyRuntimeObjectFreeze,
    ImportedBodyRuntimeObject,
    [value],
  );
}

function sourceFailure(message: string, path: string): never {
  const value = freezeImportedBodyRuntime({ message, path });
  applyImportedBodyRuntime<WeakSet<object>>(
    importedBodyRuntimeWeakSetAdd,
    importedBodySourceFailures,
    [value],
  );
  throw value;
}

function capturedSourceFailure(
  value: unknown,
): SourceFailure | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return applyImportedBodyRuntime<boolean>(
      importedBodyRuntimeWeakSetHas,
      importedBodySourceFailures,
      [value],
    )
      ? (value as SourceFailure)
      : undefined;
  } catch {
    return undefined;
  }
}

function importedBodyRuntimeHasOwn(
  value: object,
  property: PropertyKey,
): boolean {
  return applyImportedBodyRuntime<boolean>(
    importedBodyRuntimeObjectHasOwn,
    ImportedBodyRuntimeObject,
    [value, property],
  );
}

function importedBodyRuntimeStringListHas(
  values: readonly string[],
  expected: string,
): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function mapImportedBodyArray<T, U>(
  values: readonly T[],
  transform: (value: T) => U,
): readonly U[] {
  const mapped = new ImportedBodyRuntimeArray<U>(values.length);
  for (let index = 0; index < values.length; index += 1) {
    defineImportedBodyRuntimeValue(
      mapped,
      index,
      transform(values[index]!),
    );
  }
  return freezeImportedBodyRuntime(mapped);
}

export function publicImportedBodyText(value: string): string {
  let rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    value,
    ["Document-v7", "Imported-body document"],
  );
  rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["document-v7", "imported-body document"],
  );
  rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["documentV7ImportedBodyEvaluation", "importedBodyEvaluation"],
  );
  rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["Staged imported-body", "Imported-body"],
  );
  rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["staged imported-body", "imported-body"],
  );
  rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["documentV7", "importedBody"],
  );
  rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["DocumentV7", "ImportedBodyDocument"],
  );
  rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["Staged ", ""],
  );
  rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["staged ", ""],
  );
  rewritten = applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["V7", ""],
  );
  return applyImportedBodyRuntime<string>(
    importedBodyRuntimeStringReplaceAll,
    rewritten,
    ["v7", ""],
  );
}

export function publicImportedBodyErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return publicImportedBodyText(safeErrorMessage(error, fallback));
}

function publicImportedBodyDiagnostic(value: Diagnostic): Diagnostic {
  const details =
    value.details === undefined
      ? undefined
      : {
          ...value.details,
          ...(typeof value.details.phase === "string"
            ? {
                phase: publicImportedBodyText(
                  value.details.phase,
                ),
              }
            : {}),
        };
  return {
    ...value,
    message: publicImportedBodyText(value.message),
    ...(value.related === undefined
      ? {}
      : {
          related: mapImportedBodyArray(
            value.related,
            (location) => ({
              ...location,
              message: publicImportedBodyText(location.message),
            }),
          ),
        }),
    ...(value.hints === undefined
      ? {}
      : {
          hints: mapImportedBodyArray(
            value.hints,
            publicImportedBodyText,
          ),
        }),
    ...(details === undefined ? {} : { details }),
  };
}

export function publicImportedBodyResult<T>(
  result: CadResult<T>,
): CadResult<T> {
  const diagnostics = mapImportedBodyArray(
    result.diagnostics,
    publicImportedBodyDiagnostic,
  );
  return result.ok
    ? { ok: true, value: result.value, diagnostics }
    : { ok: false, diagnostics };
}

function captureOwnDataRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
  path: string,
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    applyImportedBodyRuntime<boolean>(
      importedBodyRuntimeArrayIsArray,
      ImportedBodyRuntimeArray,
      [value],
    )
  ) {
    sourceFailure(`${label} must be a plain object`, path);
  }
  const record = value as object;
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = applyImportedBodyRuntime<object | null>(
      importedBodyRuntimeObjectGetPrototypeOf,
      ImportedBodyRuntimeObject,
      [record],
    );
    keys = applyImportedBodyRuntime<readonly PropertyKey[]>(
      importedBodyRuntimeReflectOwnKeys,
      ImportedBodyRuntimeReflect,
      [record],
    );
  } catch {
    sourceFailure(`${label} could not be inspected safely`, path);
  }
  if (
    prototype !== importedBodyRuntimeObjectPrototype &&
    prototype !== null
  ) {
    sourceFailure(`${label} must be a plain object`, path);
  }
  const captured = applyImportedBodyRuntime<
    Record<string, unknown>
  >(
    importedBodyRuntimeObjectCreate,
    ImportedBodyRuntimeObject,
    [null],
  );
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (
      typeof key !== "string" ||
      !importedBodyRuntimeStringListHas(allowedKeys, key)
    ) {
      sourceFailure(
        typeof key === "string"
          ? `${label} contains unknown property '${key}'`
          : `${label} contains an unsupported symbol property`,
        path,
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = applyImportedBodyRuntime<
        PropertyDescriptor | undefined
      >(
        importedBodyRuntimeObjectGetOwnPropertyDescriptor,
        ImportedBodyRuntimeObject,
        [record, key],
      );
    } catch {
      sourceFailure(
        `${label}.${key} could not be inspected safely`,
        `${path}/${key}`,
      );
    }
    if (
      descriptor === undefined ||
      !importedBodyRuntimeHasOwn(descriptor, "value")
    ) {
      sourceFailure(
        `${label}.${key} must be an own data property`,
        `${path}/${key}`,
      );
    }
    defineImportedBodyRuntimeValue(
      captured,
      key,
      descriptor.value,
    );
  }
  return freezeImportedBodyRuntime(captured);
}

function captureEvaluationOptionsRecord(
  options: EvaluateImportedBodyOptions,
): CadResult<Readonly<Record<string, unknown>>> {
  try {
    return success(
      captureOwnDataRecord(
        options,
        ["resolver", "resourceLimits", "documentLimits", "signal"],
        "Imported-body evaluation options",
        "/options",
      ),
    );
  } catch (error) {
    const captured = capturedSourceFailure(error);
    return failure(
      diagnostic(
        "IR_INVALID",
        captured?.message ??
          safeErrorMessage(
            error,
            "Imported-body evaluation options could not be captured safely",
          ),
        {
          severity: "error",
          path: captured?.path ?? "/options",
          details: { phase: "importedBodyEvaluation" },
        },
      ),
    );
  }
}

function adaptImportedBodyResolver(
  resolver: ImportedBodyResolver,
): ResourceResolverV7 {
  return (request: ResourceResolverRequestV7) => {
    const publicRequest = freezeImportedBodyRuntime({
      id: request.id,
      digest: request.digest,
      byteLength: request.byteLength,
      mediaType: request.mediaType as ImportedBodyMediaType,
      ...(request.locations === undefined
        ? {}
        : { locations: request.locations }),
      ...(request.signal === undefined
        ? {}
        : { signal: request.signal }),
    });
    return applyImportedBodyRuntime<
      | ArrayBuffer
      | Uint8Array
      | PromiseLike<ArrayBuffer | Uint8Array>
    >(resolver, undefined, [publicRequest]);
  };
}

export function captureEvaluateImportedBodyOptions(
  options: EvaluateImportedBodyOptions,
): CadResult<CapturedEvaluateImportedBodyOptions> {
  const captured = captureEvaluationOptionsRecord(options);
  if (!captured.ok) return captured;
  const resolver = captured.value.resolver;
  if (resolver !== undefined && typeof resolver !== "function") {
    return failure(
      diagnostic(
        "IR_INVALID",
        "Imported-body resolver must be a function",
        {
          severity: "error",
          path: "/options/resolver",
          details: { phase: "importedBodyEvaluation" },
        },
      ),
    );
  }
  let resourceLimits:
    | Partial<ResourceResolutionLimitsV7>
    | undefined;
  if (captured.value.resourceLimits !== undefined) {
    let limits: Readonly<Record<string, unknown>>;
    try {
      limits = captureOwnDataRecord(
        captured.value.resourceLimits,
        ["maxResourceBytes"],
        "Imported-body resource limits",
        "/options/resourceLimits",
      );
    } catch (error) {
      const source = capturedSourceFailure(error);
      return failure(
        diagnostic(
          "IR_INVALID",
          source?.message ??
            "Imported-body resource limits could not be captured safely",
          {
            severity: "error",
            path: source?.path ?? "/options/resourceLimits",
            details: { phase: "importedBodyEvaluation" },
          },
        ),
      );
    }
    const maximum =
      limits.maxResourceBytes ??
      defaultImportedBodyResourceLimits.maxResourceBytes;
    if (typeof maximum !== "number") {
      return failure(
        diagnostic(
          "IR_INVALID",
          "Imported-body maxResourceBytes must be a number",
          {
            severity: "error",
            path: "/options/resourceLimits/maxResourceBytes",
            details: { phase: "importedBodyEvaluation" },
          },
        ),
      );
    }
    resourceLimits = freezeImportedBodyRuntime({
      maxRequestedResourceIds: 1,
      maxResolvedResources: 1,
      maxResourceBytes: maximum,
      maxTotalResourceBytes: maximum,
    });
  }
  return success(
    freezeImportedBodyRuntime({
      ...(resolver === undefined
        ? {}
        : {
            resolver: adaptImportedBodyResolver(
              resolver as ImportedBodyResolver,
            ),
          }),
      ...(resourceLimits === undefined ? {} : { resourceLimits }),
      ...(captured.value.documentLimits === undefined
        ? {}
        : {
            documentLimits:
              captured.value
                .documentLimits as Partial<DesignDocumentLimits>,
          }),
      ...(captured.value.signal === undefined
        ? {}
        : { signal: captured.value.signal as AbortSignal }),
    }),
  );
}

export function retainImportedBodyDocument(
  document: DesignDocumentV7,
  output: string,
  provenance: ImportedBodyProvenance,
  protocolVersion: ImportedBodyDocument["protocolVersion"],
): ImportedBodyDocument {
  const facade = applyImportedBodyRuntime<object>(
    importedBodyRuntimeObjectCreate,
    ImportedBodyRuntimeObject,
    [null],
  ) as ImportedBodyDocument;
  defineImportedBodyRuntimeValue(
    facade,
    "protocolVersion",
    protocolVersion,
  );
  defineImportedBodyRuntimeValue(facade, "name", document.name);
  defineImportedBodyRuntimeValue(facade, "provenance", provenance);
  applyImportedBodyRuntime<
    WeakMap<object, ImportedBodyDocumentState>
  >(
    importedBodyRuntimeWeakMapSet,
    importedBodyDocuments,
    [
      facade,
      freezeImportedBodyRuntime({
        document,
        output,
        provenance,
      }),
    ],
  );
  return freezeImportedBodyRuntime(facade);
}

export function capturedImportedBodyDocument(
  document: ImportedBodyDocument,
): ImportedBodyDocumentState | undefined {
  if (typeof document !== "object" || document === null) {
    return undefined;
  }
  try {
    return applyImportedBodyRuntime<
      ImportedBodyDocumentState | undefined
    >(
      importedBodyRuntimeWeakMapGet,
      importedBodyDocuments,
      [document],
    );
  } catch {
    return undefined;
  }
}

export function retainEvaluatedImportedBody(
  document: ImportedBodyDocument,
  design: EvaluatedDesign,
  solid: EvaluatedSolid,
): EvaluatedImportedBody {
  const state = capturedImportedBodyDocument(document);
  if (state === undefined) {
    throw new TypeError("Imported-body document state is unavailable");
  }
  const mesh = solid.mesh;
  const measure = solid.measure;
  const topology = solid.topology;
  const exportShape = solid.export;
  const dispose = design.dispose;
  const result = applyImportedBodyRuntime<object>(
    importedBodyRuntimeObjectCreate,
    ImportedBodyRuntimeObject,
    [null],
  ) as EvaluatedImportedBody;
  defineImportedBodyRuntimeValue(result, "name", state.output);
  defineImportedBodyRuntimeValue(result, "exact", true);
  defineImportedBodyRuntimeValue(result, "representation", "brep");
  defineImportedBodyRuntimeValue(
    result,
    "provenance",
    state.provenance,
  );
  defineImportedBodyRuntimeValue(
    result,
    "mesh",
    (options?: MeshOptions): MeshData =>
      applyImportedBodyRuntime<MeshData>(mesh, solid, [options]),
    false,
  );
  defineImportedBodyRuntimeValue(
    result,
    "measure",
    (): ShapeMeasurements =>
      applyImportedBodyRuntime<ShapeMeasurements>(
        measure,
        solid,
        [],
      ),
    false,
  );
  defineImportedBodyRuntimeValue(
    result,
    "topology",
    (): CadResult<KernelTopologySnapshot> =>
      applyImportedBodyRuntime<CadResult<KernelTopologySnapshot>>(
        topology,
        solid,
        [],
      ),
    false,
  );
  defineImportedBodyRuntimeValue(
    result,
    "export",
    (
      format: ShapeExportFormat,
      options?: StepExportOptions,
    ): Uint8Array | string =>
      applyImportedBodyRuntime<Uint8Array | string>(
        exportShape,
        solid,
        [format, options],
      ),
    false,
  );
  defineImportedBodyRuntimeValue(
    result,
    "dispose",
    (): void =>
      applyImportedBodyRuntime<void>(dispose, design, []),
    false,
  );
  return freezeImportedBodyRuntime(result);
}
