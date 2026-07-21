import type {
  Brand,
  ConfigurationId,
  MaterialId,
  NodeId,
  ParameterId,
  TopologyReferenceId,
} from "./core/ids.js";
import {
  canonicalStringifyProtocol as canonicalStringify,
  deepFreeze,
} from "./core/json.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import type { DesignDocumentLimits } from "./document-limits.js";
import {
  evaluateExpression,
  expressionDependencies,
  Expression,
  type Dimension,
  type ExpressionIR,
} from "./expressions.js";
import {
  resolveEvaluationParameters,
  type EvaluationParameterOverride,
} from "./internal/evaluation-parameters.js";
import {
  nodeDependencies,
  nodeParameterDependencies,
  outputKindForNode,
  type DesignConfigurationIR,
  type DesignDocument,
  type DesignOutputKind,
  type MaterialDefinitionIR,
  type NodeIR,
  type NodeKind,
  type RefIR,
  type TopologyQueryIR,
  type TopologyReferenceEntryIR,
  type TopologySelectionIR,
} from "./ir.js";
import { parseDocumentValue } from "./serialization.js";
import { normalizePersistentTopologyReference } from "./topology-signatures.js";

export const FEATURE_HASH_PROTOCOL_VERSION = 1 as const;
export const DESIGN_FEATURE_HASH_REPORT_VERSION = 1 as const;
export const FEATURE_HASH_ALGORITHM = "sha256" as const;
export const FEATURE_HASH_PREFIX =
  "invariantcad:feature:v1:sha256:" as const;

export type FeatureHash = Brand<string, "FeatureHash">;

export interface FeatureHashLimits {
  readonly maxFeatureNodes: number;
  readonly maxDependencyLinks: number;
  readonly maxCanonicalBytes: number;
}

export const DEFAULT_FEATURE_HASH_LIMITS: FeatureHashLimits = Object.freeze({
  maxFeatureNodes: 100_000,
  maxDependencyLinks: 1_000_000,
  maxCanonicalBytes: 256 * 1024 * 1024,
});

export interface HashDesignFeaturesOptions {
  /** Exact document-owned configuration ID; omitted selects the base design. */
  readonly configuration?: string;
  /** Call-time overrides use the evaluator's precedence and base units. */
  readonly parameters?: Readonly<
    Record<string, number | Expression<Dimension>>
  >;
  /** Limits used while detaching and validating the document value. */
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  /** Limits for Merkle-DAG hashing work after document validation. */
  readonly limits?: Partial<FeatureHashLimits>;
  /** Cancels hashing cooperatively between canonicalization and digest steps. */
  readonly signal?: AbortSignal;
}

export interface DesignFeatureHashEntry {
  readonly node: string;
  readonly kind: NodeKind;
  readonly outputKind: ReturnType<typeof outputKindForNode>;
  readonly hash: FeatureHash;
  /** Active direct dependencies in authored order; duplicates are preserved. */
  readonly dependencies: readonly string[];
  /** Effective direct parameter inputs, sorted by parameter ID. */
  readonly parameterValues: Readonly<Record<string, number>>;
  /** Persistent references actually consumed by this node, sorted by ID. */
  readonly topologyReferences: readonly string[];
}

export interface DesignFeatureOutputHash {
  readonly name: string;
  readonly node: string;
  readonly kind: DesignOutputKind;
  readonly featureHash: FeatureHash;
}

export interface DesignFeatureHashReport {
  readonly version: typeof DESIGN_FEATURE_HASH_REPORT_VERSION;
  readonly hashProtocolVersion: typeof FEATURE_HASH_PROTOCOL_VERSION;
  readonly algorithm: typeof FEATURE_HASH_ALGORITHM;
  readonly configurationId: string | null;
  readonly parameterValues: Readonly<Record<string, number>>;
  readonly nodes: readonly DesignFeatureHashEntry[];
  readonly outputs: readonly DesignFeatureOutputHash[];
}

interface CapturedOptions {
  readonly configuration?: string;
  readonly parameters: Readonly<Record<string, EvaluationParameterOverride>>;
  readonly documentLimits?: Partial<DesignDocumentLimits>;
  readonly limits: FeatureHashLimits;
  readonly signal?: AbortSignal;
}

interface ResolvedMaterialHashPayload {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly massDensity: number;
  readonly massDensityExpression: ExpressionIR;
  readonly metadata?: MaterialDefinitionIR["metadata"];
}

interface ResolvedMaterial {
  readonly hashPayload: ResolvedMaterialHashPayload;
  readonly parameterDependencies: readonly ParameterId[];
}

interface HashMeter {
  bytes: number;
  readonly limit: number;
}

const FEATURE_HASH_LIMIT_KEYS = Object.freeze(
  Object.keys(DEFAULT_FEATURE_HASH_LIMITS) as readonly (
    keyof FeatureHashLimits
  )[],
);
const OPTION_KEYS = Object.freeze([
  "configuration",
  "parameters",
  "documentLimits",
  "limits",
  "signal",
] as const);
const ABORT_SIGNAL_ABORTED_GETTER =
  typeof AbortSignal === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function unreachableVariant(value: never, label: string): never {
  throw new TypeError(`Unsupported ${label}: ${canonicalStringify(value)}`);
}

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function invalidOptions(message: string, path?: string): CadResult<never> {
  return failure(
    diagnostic("IR_INVALID", message, {
      severity: "error",
      ...(path === undefined ? {} : { path }),
      details: { phase: "featureHash" },
    }),
  );
}

function abortSignalState(value: unknown): boolean | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    ABORT_SIGNAL_ABORTED_GETTER === undefined
  ) {
    return undefined;
  }
  try {
    const state = Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, value, []);
    return typeof state === "boolean" ? state : undefined;
  } catch {
    return undefined;
  }
}

function abortFailure(): CadResult<never> {
  return failure(
    diagnostic("EVALUATION_ABORTED", "Feature hashing was aborted", {
      severity: "error",
      details: { phase: "featureHash" },
    }),
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal !== undefined && abortSignalState(signal) !== false) {
    throw abortFailure();
  }
}

function snapshotRecord(
  value: unknown,
  path: string,
): CadResult<Readonly<Record<string, unknown>>> {
  if (!isPlainRecord(value)) {
    return invalidOptions(`${path} must be a plain record`, path);
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) output[key] = value[key];
  return success(output);
}

function normalizeFeatureHashLimits(value: unknown): CadResult<FeatureHashLimits> {
  if (value === undefined) return success(DEFAULT_FEATURE_HASH_LIMITS);
  const captured = snapshotRecord(value, "/limits");
  if (!captured.ok) return captured;
  const keys = Object.keys(captured.value);
  const unknown = keys.find(
    (key) => !FEATURE_HASH_LIMIT_KEYS.includes(key as keyof FeatureHashLimits),
  );
  if (unknown !== undefined) {
    return invalidOptions(
      `Unknown feature-hash limit '${unknown}'`,
      `/limits/${unknown}`,
    );
  }
  const normalized: Record<keyof FeatureHashLimits, number> = {
    ...DEFAULT_FEATURE_HASH_LIMITS,
  };
  for (const key of FEATURE_HASH_LIMIT_KEYS) {
    if (!Object.hasOwn(captured.value, key)) continue;
    const candidate = captured.value[key];
    if (
      typeof candidate !== "number" ||
      !Number.isSafeInteger(candidate) ||
      candidate < 0
    ) {
      return invalidOptions(
        `Feature-hash limit '${key}' must be a non-negative safe integer`,
        `/limits/${key}`,
      );
    }
    normalized[key] = candidate;
  }
  return success(Object.freeze(normalized));
}

function captureOptions(value: unknown): CadResult<CapturedOptions> {
  try {
    const captured = snapshotRecord(value, "/");
    if (!captured.ok) return captured;
    const unknown = Object.keys(captured.value).find(
      (key) => !OPTION_KEYS.includes(key as (typeof OPTION_KEYS)[number]),
    );
    if (unknown !== undefined) {
      return invalidOptions(
        `Unknown feature-hash option '${unknown}'`,
        `/${unknown}`,
      );
    }
    const configuration = captured.value.configuration;
    if (configuration !== undefined && typeof configuration !== "string") {
      return invalidOptions("configuration must be a string", "/configuration");
    }
    const parametersValue = captured.value.parameters;
    const parameters = Object.create(null) as Record<
      string,
      EvaluationParameterOverride
    >;
    if (parametersValue !== undefined) {
      const parameterRecord = snapshotRecord(parametersValue, "/parameters");
      if (!parameterRecord.ok) return parameterRecord;
      for (const [id, override] of Object.entries(parameterRecord.value)) {
        if (typeof override !== "number" && !(override instanceof Expression)) {
          return invalidOptions(
            `Parameter override '${id}' must be a number or Expression`,
            `/parameters/${id}`,
          );
        }
        parameters[id] = override;
      }
    }
    const limits = normalizeFeatureHashLimits(captured.value.limits);
    if (!limits.ok) return limits;
    const signal = captured.value.signal;
    if (signal !== undefined && abortSignalState(signal) === undefined) {
      return invalidOptions("signal must be an AbortSignal", "/signal");
    }
    let documentLimits: Partial<DesignDocumentLimits> | undefined;
    if (captured.value.documentLimits !== undefined) {
      const documentLimitRecord = snapshotRecord(
        captured.value.documentLimits,
        "/documentLimits",
      );
      if (!documentLimitRecord.ok) return documentLimitRecord;
      documentLimits = documentLimitRecord.value as Partial<DesignDocumentLimits>;
    }
    return success({
      ...(configuration === undefined ? {} : { configuration }),
      parameters,
      ...(documentLimits === undefined ? {} : { documentLimits }),
      limits: limits.value,
      ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
    });
  } catch (error) {
    return invalidOptions(
      safeErrorMessage(error, "Feature-hash options could not be read safely"),
    );
  }
}

function limitFailure(
  resource: keyof FeatureHashLimits,
  limit: number,
  actual: number,
): CadResult<never> {
  return failure(
    diagnostic(
      "IR_INVALID",
      `Feature-hash ${resource} limit ${limit} was exceeded by ${actual}`,
      {
        severity: "error",
        details: { phase: "featureHash", resource, limit, actual },
      },
    ),
  );
}

function resolvedExpression(
  expression: ExpressionIR,
  values: ReadonlyMap<ParameterId, number>,
): Readonly<{ dimension: Dimension; value: number }> {
  const value = evaluateExpression(expression, {
    resolveParameter: (id) => {
      const resolved = values.get(id);
      if (resolved === undefined) throw new Error(`Unresolved parameter '${id}'`);
      return resolved;
    },
  });
  if (!Number.isFinite(value)) {
    throw new RangeError("A feature expression did not resolve to a finite number");
  }
  return { dimension: expression.dimension, value };
}

function canonicalizeFeatureTopologyQuery(
  query: TopologyQueryIR,
): TopologyQueryIR {
  switch (query.op) {
    case "and":
    case "or": {
      const op = query.op;
      const flattened = query.queries
        .map(canonicalizeFeatureTopologyQuery)
        .flatMap((child) => (child.op === op ? child.queries : [child]));
      const unique = new Map<string, TopologyQueryIR>();
      for (const child of flattened) {
        unique.set(canonicalStringify(child), child);
      }
      return {
        op,
        queries: [...unique.entries()]
          .sort(([first], [second]) => lexicalCompare(first, second))
          .map(([, child]) => child),
      };
    }
    case "not":
      return { op: "not", query: canonicalizeFeatureTopologyQuery(query.query) };
    case "adjacentTo":
      return {
        op: "adjacentTo",
        selection: canonicalizeFeatureTopologySelection(query.selection),
      };
    case "all":
    case "persistentReference":
    case "origin":
    case "surface":
    case "curve":
    case "normal":
    case "direction":
    case "radius":
    case "position":
      return query;
  }
  return unreachableVariant(query, "topology query");
}

function canonicalizeFeatureTopologySelection<K extends TopologySelectionIR>(
  selection: K,
): K {
  return {
    ...selection,
    query: canonicalizeFeatureTopologyQuery(selection.query),
  } as K;
}

function configuredInstanceSuppression(
  configuration: DesignConfigurationIR | undefined,
  assembly: NodeId,
  instance: string,
): boolean | undefined {
  const assemblies = configuration?.instanceSuppressions;
  if (assemblies === undefined || !Object.hasOwn(assemblies, assembly)) {
    return undefined;
  }
  const instances = assemblies[assembly]!;
  return Object.hasOwn(instances, instance)
    ? instances[instance as keyof typeof instances]
    : undefined;
}

function effectiveNode(
  id: NodeId,
  node: NodeIR,
  configuration: DesignConfigurationIR | undefined,
): NodeIR {
  switch (node.kind) {
    case "box":
    case "cylinder":
    case "sphere":
    case "sketch":
    case "polylinePath":
    case "circularArcPath":
    case "compositePath":
    case "extrude":
    case "revolve":
    case "loft":
    case "sweep":
    case "boolean":
    case "transform":
    case "offset":
      return node;
    case "fillet":
    case "chamfer":
      return {
        ...node,
        edges: canonicalizeFeatureTopologySelection(node.edges),
      } as NodeIR;
    case "shell":
      return {
        ...node,
        openings: canonicalizeFeatureTopologySelection(node.openings),
      } as NodeIR;
    case "draft":
      return {
        ...node,
        faces: canonicalizeFeatureTopologySelection(node.faces),
      } as NodeIR;
    case "part": {
      const materialOverrides = configuration?.partMaterialOverrides;
      const materialId =
        materialOverrides !== undefined && Object.hasOwn(materialOverrides, id)
          ? materialOverrides[id]
          : node.materialId;
      const { materialId: _materialId, ...rest } = node;
      return {
        ...rest,
        ...(materialId === undefined ? {} : { materialId }),
      } as NodeIR;
    }
    case "assembly":
      return {
        ...node,
        instances: node.instances
          .filter(
            (instance) =>
              !(
                configuredInstanceSuppression(
                  configuration,
                  id,
                  instance.id,
                ) ?? instance.suppressed
              ),
          )
          .map((instance) => ({ ...instance, suppressed: false })),
      };
  }
  return unreachableVariant(node, "node");
}

function topologyReferenceIds(
  selection: TopologySelectionIR,
): readonly TopologyReferenceId[] {
  const output = new Set<TopologyReferenceId>();
  const stack: TopologyQueryIR[] = [selection.query];
  while (stack.length > 0) {
    const query = stack.pop()!;
    switch (query.op) {
      case "persistentReference":
        output.add(query.reference);
        break;
      case "adjacentTo":
        stack.push(query.selection.query);
        break;
      case "and":
      case "or":
        for (const child of query.queries) stack.push(child);
        break;
      case "not":
        stack.push(query.query);
        break;
      case "all":
      case "origin":
      case "surface":
      case "curve":
      case "normal":
      case "direction":
      case "radius":
      case "position":
        break;
      default:
        unreachableVariant(query, "topology query");
    }
  }
  return Object.freeze([...output].sort(lexicalCompare));
}

function nodeTopologyReferenceIds(node: NodeIR): readonly TopologyReferenceId[] {
  switch (node.kind) {
    case "fillet":
    case "chamfer":
      return topologyReferenceIds(node.edges);
    case "shell":
      return topologyReferenceIds(node.openings);
    case "draft":
      return topologyReferenceIds(node.faces);
    case "box":
    case "cylinder":
    case "sphere":
    case "sketch":
    case "polylinePath":
    case "circularArcPath":
    case "compositePath":
    case "extrude":
    case "revolve":
    case "loft":
    case "sweep":
    case "boolean":
    case "transform":
    case "offset":
    case "part":
    case "assembly":
      return [];
  }
  return unreachableVariant(node, "node");
}

function canonicalTopologyReferenceEntry(
  entry: TopologyReferenceEntryIR,
): TopologyReferenceEntryIR {
  const variants = entry.variants.map((variant) => {
    const normalized = normalizePersistentTopologyReference(variant);
    if (!normalized.ok) {
      throw new TypeError(
        normalized.diagnostics[0]?.message ??
          "A persistent topology reference could not be normalized",
      );
    }
    return normalized.value;
  });
  variants.sort(
    (first, second) =>
      first.protocolVersion - second.protocolVersion ||
      lexicalCompare(first.kernelFingerprint, second.kernelFingerprint) ||
      lexicalCompare(canonicalStringify(first), canonicalStringify(second)),
  );
  return {
    target: entry.target,
    topology: entry.topology,
    variants,
  };
}

function canonicalJsonUtf8Length(value: unknown, ceiling: number): number {
  let byteLength = 0;
  let exceeded = false;

  const add = (amount: number): void => {
    if (exceeded) return;
    if (amount > ceiling - byteLength) {
      exceeded = true;
      return;
    }
    byteLength += amount;
  };

  const measureString = (current: string): void => {
    add(2);
    if (exceeded) return;
    for (let index = 0; index < current.length; index += 1) {
      const code = current.charCodeAt(index);
      let width: number;
      if (code === 0x22 || code === 0x5c) width = 2;
      else if (
        code === 0x08 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0c ||
        code === 0x0d
      ) {
        width = 2;
      } else if (code <= 0x1f) width = 6;
      else if (code <= 0x7f) width = 1;
      else if (code <= 0x7ff) width = 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = current.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          width = 4;
          index += 1;
        } else {
          width = 6;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) width = 6;
      else width = 3;
      add(width);
      if (exceeded) return;
    }
  };

  const measure = (current: unknown): void => {
    if (current === null) {
      add(4);
      return;
    }
    if (typeof current === "string") {
      measureString(current);
      return;
    }
    if (typeof current === "boolean") {
      add(current ? 4 : 5);
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError("CAD hashes cannot contain non-finite numbers");
      }
      add(String(Object.is(current, -0) ? 0 : current).length);
      return;
    }
    if (Array.isArray(current)) {
      add(2);
      for (let index = 0; index < current.length; index += 1) {
        if (index > 0) add(1);
        measure(current[index]);
        if (exceeded) return;
      }
      return;
    }
    if (typeof current === "object" && current !== null) {
      add(2);
      let emitted = 0;
      const record = current as Readonly<Record<string, unknown>>;
      for (const key of Object.keys(record).sort(lexicalCompare)) {
        const child = record[key];
        if (child === undefined) continue;
        if (emitted > 0) add(1);
        measureString(key);
        add(1);
        measure(child);
        emitted += 1;
        if (exceeded) return;
      }
      return;
    }
    throw new TypeError(`Unsupported JSON value: ${typeof current}`);
  };
  measure(value);
  return exceeded ? Number.POSITIVE_INFINITY : byteLength;
}

async function digestEnvelope(
  domain: string,
  payload: unknown,
  meter: HashMeter,
  signal: AbortSignal | undefined,
): Promise<string> {
  throwIfAborted(signal);
  const envelope = {
    algorithm: FEATURE_HASH_ALGORITHM,
    domain,
    protocolVersion: FEATURE_HASH_PROTOCOL_VERSION,
    payload,
  };
  const remaining = meter.limit - meter.bytes;
  const byteLength = canonicalJsonUtf8Length(envelope, remaining);
  if (byteLength > remaining) {
    throw limitFailure("maxCanonicalBytes", meter.limit, meter.limit + 1);
  }
  const source = canonicalStringify(envelope);
  const bytes = new TextEncoder().encode(source);
  if (bytes.byteLength !== byteLength) {
    throw new TypeError("Canonical JSON byte-length preflight disagreed with encoding");
  }
  meter.bytes += byteLength;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  throwIfAborted(signal);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isCadFailure(value: unknown): value is CadResult<never> {
  if (typeof value !== "object" || value === null) return false;
  try {
    return (value as { readonly ok?: unknown }).ok === false &&
      Array.isArray((value as { readonly diagnostics?: unknown }).diagnostics);
  } catch {
    return false;
  }
}

function resolvedMaterialDefinitions(
  document: DesignDocument,
  parameterValues: ReadonlyMap<ParameterId, number>,
): CadResult<ReadonlyMap<string, ResolvedMaterial>> {
  const materials = new Map<string, ResolvedMaterial>();
  const diagnostics: Diagnostic[] = [];
  for (const id of Object.keys(document.materials ?? {}).sort(
    lexicalCompare,
  ) as MaterialId[]) {
    const definition = document.materials![id]!;
    let massDensity: number;
    try {
      massDensity = resolvedExpression(
        definition.massDensity,
        parameterValues,
      ).value;
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "MASS_DENSITY_INVALID",
          `Material '${id}' massDensity must evaluate to a finite, strictly positive number`,
          {
            severity: "error",
            path: `/materials/${id}/massDensity`,
            details: { cause: safeErrorMessage(error) },
          },
        ),
      );
      continue;
    }
    if (!(massDensity > 0)) {
      diagnostics.push(
        diagnostic(
          "MASS_DENSITY_INVALID",
          `Material '${id}' massDensity must be finite and strictly positive`,
          {
            severity: "error",
            path: `/materials/${id}/massDensity`,
            details: { value: massDensity },
          },
        ),
      );
      continue;
    }
    materials.set(id, {
      hashPayload: {
        id,
        name: definition.name,
        ...(definition.description === undefined
          ? {}
          : { description: definition.description }),
        massDensity,
        massDensityExpression: definition.massDensity,
        ...(definition.metadata === undefined
          ? {}
          : { metadata: definition.metadata }),
      },
      parameterDependencies: Object.freeze(
        [...expressionDependencies(definition.massDensity)].sort(
          lexicalCompare,
        ),
      ),
    });
  }
  return diagnostics.length === 0
    ? success(materials)
    : { ok: false, diagnostics };
}

/**
 * Computes one kernel-independent Merkle hash for every authored node under one
 * effective evaluation context. Equality means equal v1 effective intent, not
 * geometric equality or artifact compatibility.
 */
export async function hashDesignFeatures(
  document: DesignDocument,
  options: HashDesignFeaturesOptions = {},
): Promise<CadResult<DesignFeatureHashReport>> {
  const capturedOptions = captureOptions(options);
  if (!capturedOptions.ok) return capturedOptions;
  if (
    capturedOptions.value.signal !== undefined &&
    abortSignalState(capturedOptions.value.signal) !== false
  ) {
    return abortFailure();
  }
  const parsed = parseDocumentValue(document, {
    ...(capturedOptions.value.documentLimits === undefined
      ? {}
      : { limits: capturedOptions.value.documentLimits }),
  });
  if (!parsed.ok) return parsed;
  const snapshot = parsed.value;
  const nodeIds = Object.keys(snapshot.nodes).sort(lexicalCompare) as NodeId[];
  const limits = capturedOptions.value.limits;
  if (nodeIds.length > limits.maxFeatureNodes) {
    return limitFailure(
      "maxFeatureNodes",
      limits.maxFeatureNodes,
      nodeIds.length,
    );
  }

  let configurationId: ConfigurationId | null = null;
  let configuration: DesignConfigurationIR | undefined;
  if (capturedOptions.value.configuration !== undefined) {
    const requested = capturedOptions.value.configuration;
    if (!Object.hasOwn(snapshot.configurations ?? {}, requested)) {
      return failure(
        diagnostic(
          "CONFIGURATION_MISSING",
          `Unknown configuration '${requested}'`,
          {
            severity: "error",
            path: `/configurations/${requested}`,
            details: {
              available: Object.keys(snapshot.configurations ?? {}).sort(
                lexicalCompare,
              ),
            },
          },
        ),
      );
    }
    configurationId = requested as ConfigurationId;
    configuration = snapshot.configurations![configurationId];
  }

  const resolvedParameters = resolveEvaluationParameters(
    snapshot,
    capturedOptions.value.parameters,
    configurationId,
    configuration,
  );
  if (!resolvedParameters.ok) return resolvedParameters;
  const parameterValues = resolvedParameters.value.values;
  const materials = resolvedMaterialDefinitions(snapshot, parameterValues);
  if (!materials.ok) return materials;

  const effectiveNodes = new Map<NodeId, NodeIR>();
  const dependencies = new Map<NodeId, readonly RefIR[]>();
  const reverse = new Map<NodeId, NodeId[]>();
  const indegrees = new Map<NodeId, number>();
  let dependencyLinks = 0;
  try {
    for (const id of nodeIds) {
      const node = effectiveNode(id, snapshot.nodes[id] as NodeIR, configuration);
      effectiveNodes.set(id, node);
      const refs = nodeDependencies(node);
      dependencies.set(id, refs);
      indegrees.set(id, refs.length);
      dependencyLinks += refs.length;
      if (dependencyLinks > limits.maxDependencyLinks) {
        return limitFailure(
          "maxDependencyLinks",
          limits.maxDependencyLinks,
          dependencyLinks,
        );
      }
      for (const reference of refs) {
        const consumers = reverse.get(reference.node);
        if (consumers === undefined) reverse.set(reference.node, [id]);
        else consumers.push(id);
      }
    }
  } catch (error) {
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(error, "Feature dependencies could not be read safely"),
        { severity: "error", details: { phase: "featureHash" } },
      ),
    );
  }

  const ready = nodeIds.filter((id) => indegrees.get(id) === 0);
  const hashes = new Map<NodeId, FeatureHash>();
  const entries = new Map<NodeId, DesignFeatureHashEntry>();
  const referenceHashes = new Map<TopologyReferenceId, string>();
  const meter: HashMeter = { bytes: 0, limit: limits.maxCanonicalBytes };
  let cursor = 0;
  try {
    while (cursor < ready.length) {
      throwIfAborted(capturedOptions.value.signal);
      const id = ready[cursor++]!;
      const node = effectiveNodes.get(id)!;
      const refs = dependencies.get(id)!;
      const dependencyPayload = refs.map((reference) => ({
        node: reference.node,
        kind: reference.kind,
        hash: hashes.get(reference.node)!,
      }));
      const directParameterIds = new Set(nodeParameterDependencies(node));
      let effectiveMaterial: ResolvedMaterial | undefined;
      if (node.kind === "part" && node.materialId !== undefined) {
        effectiveMaterial = materials.value.get(node.materialId);
        for (const parameter of
          effectiveMaterial?.parameterDependencies ?? []) {
          directParameterIds.add(parameter);
        }
      }
      const directParameterValues = Object.fromEntries(
        [...directParameterIds]
          .sort(lexicalCompare)
          .map((parameter) => [parameter, parameterValues.get(parameter)!]),
      ) as Readonly<Record<string, number>>;
      const usedReferences = nodeTopologyReferenceIds(node);
      const topologyReferencePayload: {
        readonly reference: TopologyReferenceId;
        readonly hash: string;
      }[] = [];
      for (const reference of usedReferences) {
        let hash = referenceHashes.get(reference);
        if (hash === undefined) {
          const entry = snapshot.topologyReferences?.[reference];
          if (entry === undefined) {
            throw new TypeError(`Missing topology reference '${reference}'`);
          }
          hash = await digestEnvelope(
            "invariantcad.feature.topology-reference",
            {
              reference,
              entry: canonicalTopologyReferenceEntry(
                entry as TopologyReferenceEntryIR,
              ),
            },
            meter,
            capturedOptions.value.signal,
          );
          referenceHashes.set(reference, hash);
        }
        topologyReferencePayload.push({ reference, hash });
      }

      const digest = await digestEnvelope(
        "invariantcad.feature",
        {
          node: id,
          kind: node.kind,
          units: snapshot.units,
          local: node,
          parameters: directParameterValues,
          dependencies: dependencyPayload,
          topologyReferences: topologyReferencePayload,
          ...(effectiveMaterial === undefined
            ? {}
            : { material: effectiveMaterial.hashPayload }),
        },
        meter,
        capturedOptions.value.signal,
      );
      const hash = `${FEATURE_HASH_PREFIX}${digest}` as FeatureHash;
      hashes.set(id, hash);
      entries.set(
        id,
        deepFreeze({
          node: id,
          kind: node.kind,
          outputKind: outputKindForNode(node),
          hash,
          dependencies: refs.map((reference) => reference.node),
          parameterValues: directParameterValues,
          topologyReferences: usedReferences,
        }) as DesignFeatureHashEntry,
      );
      for (const consumer of reverse.get(id) ?? []) {
        const remaining = indegrees.get(consumer)! - 1;
        indegrees.set(consumer, remaining);
        if (remaining === 0) ready.push(consumer);
      }
    }
  } catch (error) {
    if (isCadFailure(error)) return error;
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(error, "Feature hashes could not be computed"),
        { severity: "error", details: { phase: "featureHash" } },
      ),
    );
  }

  if (entries.size !== nodeIds.length) {
    return failure(
      diagnostic("GRAPH_CYCLE", "The feature graph contains a cycle", {
        severity: "error",
        details: { phase: "featureHash" },
      }),
    );
  }
  const reportEntries = nodeIds.map((id) => entries.get(id)!);
  const outputs = Object.keys(snapshot.outputs)
    .sort(lexicalCompare)
    .map((name) => {
      const output = snapshot.outputs[name]!;
      return {
        name,
        node: output.node,
        kind: output.kind as DesignOutputKind,
        featureHash: hashes.get(output.node)!,
      };
    });
  const allParameterValues = Object.fromEntries(
    [...parameterValues.entries()].sort(([first], [second]) =>
      lexicalCompare(first, second),
    ),
  ) as Readonly<Record<string, number>>;
  return success(
    deepFreeze({
      version: DESIGN_FEATURE_HASH_REPORT_VERSION,
      hashProtocolVersion: FEATURE_HASH_PROTOCOL_VERSION,
      algorithm: FEATURE_HASH_ALGORITHM,
      configurationId,
      parameterValues: allParameterValues,
      nodes: reportEntries,
      outputs,
    }) as DesignFeatureHashReport,
    resolvedParameters.value.diagnostics,
  );
}
