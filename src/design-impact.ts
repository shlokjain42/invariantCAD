import {
  assertValidId,
  type EntityId,
  type ConfigurationId,
  type MaterialId,
  type NodeId,
  type ParameterId,
  type TopologyReferenceId,
} from "./core/ids.js";
import { deepFreeze } from "./core/json.js";
import {
  diagnostic,
  failure,
  safeErrorMessage,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import {
  expressionDependencies,
  type ExpressionIR,
} from "./expressions.js";
import {
  nodeDependencies,
  nodeParameterDependencies,
  type DesignConfigurationIR,
  type DesignDocument,
  type MaterialDefinitionIR,
  type NodeIR,
  type ParameterIR,
  type TopologySelectionIR,
} from "./ir.js";
import {
  normalizeDesignDocumentLimits,
  type DesignDocumentLimits,
} from "./document-limits.js";
import { parseDocumentValue } from "./serialization.js";
import { topologySelectionRequirements } from "./topology-resolution.js";

export const DESIGN_IMPACT_REPORT_VERSION = 1 as const;

export interface DesignImpactChanges {
  readonly nodes?: readonly string[];
  readonly parameters?: readonly string[];
  readonly materials?: readonly string[];
  readonly configurations?: readonly string[];
  readonly topologyReferences?: readonly string[];
}

export interface AnalyzeDesignImpactOptions {
  /** Parse/copy limits; maxStructuralValues also caps propagation work. */
  readonly limits?: Partial<DesignDocumentLimits>;
}

export interface DesignImpactSeedInventory {
  readonly nodes: readonly NodeId[];
  readonly parameters: readonly ParameterId[];
  readonly materials: readonly MaterialId[];
  readonly configurations: readonly ConfigurationId[];
  readonly topologyReferences: readonly TopologyReferenceId[];
}

export type DesignParameterImpactReason =
  | { readonly kind: "seed" }
  | {
      readonly kind: "configuration";
      readonly configuration: ConfigurationId;
    }
  | { readonly kind: "dependency"; readonly parameter: ParameterId };

export interface DesignParameterImpact {
  readonly parameter: ParameterId;
  readonly reasons: readonly DesignParameterImpactReason[];
}

export type DesignMaterialImpactReason =
  | { readonly kind: "seed" }
  | { readonly kind: "parameter"; readonly parameter: ParameterId };

export interface DesignMaterialImpact {
  readonly material: MaterialId;
  readonly reasons: readonly DesignMaterialImpactReason[];
}

export type DesignConfigurationImpactReason =
  | { readonly kind: "seed" }
  | { readonly kind: "parameter"; readonly parameter: ParameterId }
  | { readonly kind: "material"; readonly material: MaterialId };

export interface DesignConfigurationImpact {
  readonly configuration: ConfigurationId;
  readonly reasons: readonly DesignConfigurationImpactReason[];
}

export type DesignNodeImpactReason =
  | { readonly kind: "seed" }
  | { readonly kind: "parameter"; readonly parameter: ParameterId }
  | { readonly kind: "material"; readonly material: MaterialId }
  | {
      readonly kind: "configuration";
      readonly configuration: ConfigurationId;
    }
  | {
      readonly kind: "topologyReference";
      readonly topologyReference: TopologyReferenceId;
    }
  | { readonly kind: "dependency"; readonly node: NodeId };

export interface DesignNodeImpact {
  readonly node: NodeId;
  /** True when this node is reached without first passing through another node. */
  readonly direct: boolean;
  readonly reasons: readonly DesignNodeImpactReason[];
}

export interface DesignOutputImpact {
  readonly name: string;
  readonly node: NodeId;
}

/** Versioned existential union of kernel-free impact across current contexts. */
export interface DesignImpactReport {
  readonly version: typeof DESIGN_IMPACT_REPORT_VERSION;
  readonly seeds: DesignImpactSeedInventory;
  readonly parameters: readonly DesignParameterImpact[];
  readonly materials: readonly DesignMaterialImpact[];
  readonly configurations: readonly DesignConfigurationImpact[];
  readonly nodes: readonly DesignNodeImpact[];
  readonly outputs: readonly DesignOutputImpact[];
}

const CHANGE_KEYS = Object.freeze([
  "configurations",
  "materials",
  "nodes",
  "parameters",
  "topologyReferences",
] as const satisfies readonly (keyof DesignImpactChanges)[]);

interface CopiedSeed<I extends string> {
  readonly value: I;
  readonly index: number;
}

interface CopiedChanges {
  readonly nodes: readonly CopiedSeed<NodeId>[];
  readonly parameters: readonly CopiedSeed<ParameterId>[];
  readonly materials: readonly CopiedSeed<MaterialId>[];
  readonly configurations: readonly CopiedSeed<ConfigurationId>[];
  readonly topologyReferences: readonly CopiedSeed<TopologyReferenceId>[];
}

interface ImpactState<R> {
  readonly reasons: R[];
  readonly reasonKeys: Set<string>;
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

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function invalid<T>(
  message: string,
  options: Omit<Diagnostic, "code" | "message"> = { severity: "error" },
): Extract<CadResult<T>, { readonly ok: false }> {
  return {
    ok: false,
    diagnostics: [diagnostic("IR_INVALID", message, options)],
  };
}

function copySeedArray<I extends string>(
  value: unknown,
  key: keyof DesignImpactChanges,
  length: number,
): CadResult<readonly CopiedSeed<I>[]> {
  if (value === undefined) return success(Object.freeze([]));
  if (!Array.isArray(value)) {
    return invalid(`Design-impact '${key}' changes must be an array`, {
      severity: "error",
      path: `/changes/${key}`,
    });
  }
  const copied: CopiedSeed<I>[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      return invalid(`Design-impact '${key}' changes cannot be sparse`, {
        severity: "error",
        path: `/changes/${key}/${index}`,
      });
    }
    const item: unknown = value[index];
    if (typeof item !== "string" || item.length === 0) {
      return invalid(`Design-impact '${key}' IDs must be non-empty strings`, {
        severity: "error",
        path: `/changes/${key}/${index}`,
      });
    }
    try {
      assertValidId(item, "Design-impact ID");
    } catch {
      return invalid(`Design-impact '${key}' IDs must use the shared ID grammar`, {
        severity: "error",
        path: `/changes/${key}/${index}`,
      });
    }
    if (!seen.has(item)) {
      seen.add(item);
      copied.push({ value: item as I, index });
    }
  }
  copied.sort((first, second) => lexicalCompare(first.value, second.value));
  return success(Object.freeze(copied));
}

function copyChanges(
  value: unknown,
  limits: DesignDocumentLimits,
): CadResult<CopiedChanges> {
  if (!isPlainRecord(value)) {
    return invalid("Design-impact changes must be an object", {
      severity: "error",
      path: "/changes",
    });
  }
  const keys = Object.keys(value).sort();
  if (
    keys.some(
      (key) => !CHANGE_KEYS.includes(key as keyof DesignImpactChanges),
    )
  ) {
    return invalid("Design-impact changes contain unsupported fields", {
      severity: "error",
      path: "/changes",
      details: {
        unsupported: keys.filter(
          (key) => !CHANGE_KEYS.includes(key as keyof DesignImpactChanges),
        ),
      },
    });
  }
  const keySet = new Set(keys);
  const raw = {
    nodes: keySet.has("nodes") ? value.nodes : undefined,
    parameters: keySet.has("parameters") ? value.parameters : undefined,
    materials: keySet.has("materials") ? value.materials : undefined,
    configurations: keySet.has("configurations")
      ? value.configurations
      : undefined,
    topologyReferences: keySet.has("topologyReferences")
      ? value.topologyReferences
      : undefined,
  };
  const lengths: Partial<Record<keyof DesignImpactChanges, number>> = {};
  let seedOccurrences = 0;
  for (const key of CHANGE_KEYS) {
    const candidate = raw[key];
    if (candidate === undefined) continue;
    if (!Array.isArray(candidate)) {
      return invalid(`Design-impact '${key}' changes must be an array`, {
        severity: "error",
        path: `/changes/${key}`,
      });
    }
    const length = candidate.length;
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 0xffff_ffff
    ) {
      return invalid(`Design-impact '${key}' changes have an invalid length`, {
        severity: "error",
        path: `/changes/${key}`,
      });
    }
    lengths[key] = length;
    seedOccurrences += length;
    if (seedOccurrences > limits.maxStructuralValues) {
      return invalid(
        `Design-impact change seeds exceed the maxStructuralValues limit ${limits.maxStructuralValues}`,
        {
          severity: "error",
          path: "/changes",
          details: {
            resource: "maxStructuralValues",
            limit: limits.maxStructuralValues,
            actual: seedOccurrences,
          },
        },
      );
    }
  }
  const nodes = copySeedArray<NodeId>(raw.nodes, "nodes", lengths.nodes ?? 0);
  if (!nodes.ok) return nodes;
  const parameters = copySeedArray<ParameterId>(
    raw.parameters,
    "parameters",
    lengths.parameters ?? 0,
  );
  if (!parameters.ok) return parameters;
  const materials = copySeedArray<MaterialId>(
    raw.materials,
    "materials",
    lengths.materials ?? 0,
  );
  if (!materials.ok) return materials;
  const configurations = copySeedArray<ConfigurationId>(
    raw.configurations,
    "configurations",
    lengths.configurations ?? 0,
  );
  if (!configurations.ok) return configurations;
  const topologyReferences = copySeedArray<TopologyReferenceId>(
    raw.topologyReferences,
    "topologyReferences",
    lengths.topologyReferences ?? 0,
  );
  if (!topologyReferences.ok) return topologyReferences;
  if (
    nodes.value.length +
      parameters.value.length +
      materials.value.length +
      configurations.value.length +
      topologyReferences.value.length ===
    0
  ) {
    return invalid("Design-impact analysis requires at least one change seed", {
      severity: "error",
      path: "/changes",
    });
  }
  return success(
    Object.freeze({
      nodes: nodes.value,
      parameters: parameters.value,
      materials: materials.value,
      configurations: configurations.value,
      topologyReferences: topologyReferences.value,
    }),
  );
}

function validateSeeds(
  document: DesignDocument,
  changes: CopiedChanges,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const check = <I extends string>(
    items: readonly CopiedSeed<I>[],
    inventory: Readonly<Record<string, unknown>>,
    category: keyof DesignImpactChanges,
    code: "REFERENCE_MISSING" | "PARAMETER_MISSING" | "CONFIGURATION_MISSING",
    label: string,
  ): void => {
    for (const item of items) {
      if (Object.hasOwn(inventory, item.value)) continue;
      diagnostics.push(
        diagnostic(code, `Unknown changed ${label} '${item.value}'`, {
          severity: "error",
          path: `/changes/${category}/${item.index}`,
          details: { id: item.value, kind: label },
        }),
      );
    }
  };
  check(changes.nodes, document.nodes, "nodes", "REFERENCE_MISSING", "node");
  check(
    changes.parameters,
    document.parameters,
    "parameters",
    "PARAMETER_MISSING",
    "parameter",
  );
  check(
    changes.materials,
    document.materials ?? {},
    "materials",
    "REFERENCE_MISSING",
    "material",
  );
  check(
    changes.configurations,
    document.configurations ?? {},
    "configurations",
    "CONFIGURATION_MISSING",
    "configuration",
  );
  check(
    changes.topologyReferences,
    document.topologyReferences ?? {},
    "topologyReferences",
    "REFERENCE_MISSING",
    "topology reference",
  );
  return diagnostics;
}

function addReason<I extends string, R>(
  impacts: Map<I, ImpactState<R>>,
  id: I,
  reason: R,
  reasonKey: string,
): boolean {
  const existing = impacts.get(id);
  if (existing !== undefined) {
    if (!existing.reasonKeys.has(reasonKey)) {
      existing.reasonKeys.add(reasonKey);
      existing.reasons.push(reason);
    }
    return false;
  }
  impacts.set(id, {
    reasons: [reason],
    reasonKeys: new Set([reasonKey]),
  });
  return true;
}

function addReverseEdge<I extends string>(
  graph: Map<I, Set<I>>,
  dependency: I,
  consumer: I,
): void {
  const existing = graph.get(dependency);
  if (existing === undefined) graph.set(dependency, new Set([consumer]));
  else existing.add(consumer);
}

function expressionParameterDependencies(
  expression: ExpressionIR,
): readonly ParameterId[] {
  return [...expressionDependencies(expression)].sort(lexicalCompare);
}

function parameterBoundDependencies(
  definition: ParameterIR,
): readonly ParameterId[] {
  const output = new Set<ParameterId>();
  if (definition.min !== undefined) expressionDependencies(definition.min, output);
  if (definition.max !== undefined) expressionDependencies(definition.max, output);
  return [...output].sort(lexicalCompare);
}

function topologySelectionForNode(
  node: NodeIR,
): TopologySelectionIR | undefined {
  switch (node.kind) {
    case "fillet":
    case "chamfer":
      return node.edges;
    case "shell":
      return node.openings;
    case "draft":
      return node.faces;
    default:
      return undefined;
  }
}

function materialDependencies(
  definition: MaterialDefinitionIR,
): readonly ParameterId[] {
  return expressionParameterDependencies(definition.massDensity);
}

interface ReachabilityState {
  fromConfigurationSeed: boolean;
  fromExternalSeed: boolean;
}

function addReachabilityRoot<I extends string>(
  states: Map<I, ReachabilityState>,
  id: I,
  origin: "configuration" | "external",
): boolean {
  const existing = states.get(id);
  if (existing === undefined) {
    states.set(id, {
      fromConfigurationSeed: origin === "configuration",
      fromExternalSeed: origin === "external",
    });
    return true;
  }
  if (origin === "configuration") {
    if (existing.fromConfigurationSeed) return false;
    existing.fromConfigurationSeed = true;
  } else {
    if (existing.fromExternalSeed) return false;
    existing.fromExternalSeed = true;
  }
  return true;
}

interface ReachabilityPropagation {
  readonly changed: boolean;
}

function propagateReachability<I extends string>(
  states: Map<I, ReachabilityState>,
  id: I,
  source: ReachabilityState,
): ReachabilityPropagation {
  let target = states.get(id);
  if (target === undefined) {
    target = {
      fromConfigurationSeed: false,
      fromExternalSeed: false,
    };
    states.set(id, target);
  }
  const configurationChanged =
    source.fromConfigurationSeed && !target.fromConfigurationSeed;
  const externalChanged = source.fromExternalSeed && !target.fromExternalSeed;
  if (configurationChanged) target.fromConfigurationSeed = true;
  if (externalChanged) target.fromExternalSeed = true;
  return { changed: configurationChanged || externalChanged };
}

function hasExternalOrigin(state: ReachabilityState): boolean {
  return state.fromExternalSeed;
}

interface ConditionalAssemblyEdge {
  readonly assembly: NodeId;
  readonly instance: EntityId;
  readonly authoredSuppressed: boolean;
}

function assemblyEdgeIsActive(
  edge: ConditionalAssemblyEdge,
  configuration: DesignConfigurationIR | undefined,
): boolean {
  const assemblyOverrides = configuration?.instanceSuppressions?.[edge.assembly];
  const configured =
    assemblyOverrides !== undefined &&
    Object.hasOwn(assemblyOverrides, edge.instance)
      ? assemblyOverrides[edge.instance]
      : undefined;
  return !(configured ?? edge.authoredSuppressed);
}

function configurationAffectsEvaluation(
  configuration: DesignConfigurationIR,
): boolean {
  if (Object.keys(configuration.parameterOverrides ?? {}).length > 0) return true;
  if (Object.keys(configuration.partMaterialOverrides ?? {}).length > 0) {
    return true;
  }
  return Object.values(configuration.instanceSuppressions ?? {}).some(
    (instances) => Object.keys(instances).length > 0,
  );
}

interface ImpactWorkBudget {
  readonly limit: number;
  used: number;
}

const impactWorkFailures = new WeakSet<object>();

class ImpactWorkFailure {
  readonly result: Extract<CadResult<DesignImpactReport>, { readonly ok: false }>;

  constructor(limit: number) {
    impactWorkFailures.add(this);
    this.result = invalid(
      `Design-impact analysis exceeds the maxStructuralValues work limit ${limit}`,
      {
        severity: "error",
        details: {
          resource: "maxStructuralValues",
          phase: "designImpact",
          limit,
          actual: limit + 1,
        },
      },
    );
  }
}

function consumeImpactWork(budget: ImpactWorkBudget, amount = 1): void {
  if (amount > budget.limit - budget.used) {
    throw new ImpactWorkFailure(budget.limit);
  }
  budget.used += amount;
}

function parameterReasonKey(reason: DesignParameterImpactReason): string {
  switch (reason.kind) {
    case "seed":
      return "0";
    case "configuration":
      return `1:${reason.configuration}`;
    case "dependency":
      return `2:${reason.parameter}`;
  }
}

function materialReasonKey(reason: DesignMaterialImpactReason): string {
  return reason.kind === "seed" ? "0" : `1:${reason.parameter}`;
}

function configurationReasonKey(
  reason: DesignConfigurationImpactReason,
): string {
  switch (reason.kind) {
    case "seed":
      return "0";
    case "parameter":
      return `1:${reason.parameter}`;
    case "material":
      return `2:${reason.material}`;
  }
}

function nodeReasonKey(reason: DesignNodeImpactReason): string {
  switch (reason.kind) {
    case "seed":
      return "0";
    case "parameter":
      return `1:${reason.parameter}`;
    case "material":
      return `2:${reason.material}`;
    case "configuration":
      return `3:${reason.configuration}`;
    case "topologyReference":
      return `4:${reason.topologyReference}`;
    case "dependency":
      return `5:${reason.node}`;
  }
}

function sortedReasons<R>(
  state: ImpactState<R>,
  key: (reason: R) => string,
): readonly R[] {
  return [...state.reasons].sort((first, second) =>
    lexicalCompare(key(first), key(second)),
  );
}

interface ContextParameterEdge {
  readonly dependency: ParameterId;
  readonly consumer: ParameterId;
  propagatedNewOrigin: boolean;
}

function addContextParameterReasons(
  edges: ReadonlyMap<string, ContextParameterEdge>,
  impacts: Map<ParameterId, ImpactState<DesignParameterImpactReason>>,
  budget: ImpactWorkBudget,
): void {
  if (edges.size === 0) return;
  const adjacency = new Map<ParameterId, ParameterId[]>();
  const reverse = new Map<ParameterId, ParameterId[]>();
  const vertices = new Set<ParameterId>();
  for (const edge of edges.values()) {
    vertices.add(edge.dependency);
    vertices.add(edge.consumer);
    const consumers = adjacency.get(edge.dependency);
    if (consumers === undefined) adjacency.set(edge.dependency, [edge.consumer]);
    else consumers.push(edge.consumer);
    const dependencies = reverse.get(edge.consumer);
    if (dependencies === undefined) reverse.set(edge.consumer, [edge.dependency]);
    else dependencies.push(edge.dependency);
  }
  for (const values of adjacency.values()) values.sort(lexicalCompare);
  for (const values of reverse.values()) values.sort(lexicalCompare);

  const visited = new Set<ParameterId>();
  const finishOrder: ParameterId[] = [];
  for (const root of [...vertices].sort(lexicalCompare)) {
    if (visited.has(root)) continue;
    const stack: { readonly node: ParameterId; readonly expanded: boolean }[] = [
      { node: root, expanded: false },
    ];
    while (stack.length > 0) {
      consumeImpactWork(budget);
      const current = stack.pop()!;
      if (current.expanded) {
        finishOrder.push(current.node);
        continue;
      }
      if (visited.has(current.node)) continue;
      visited.add(current.node);
      stack.push({ node: current.node, expanded: true });
      const consumers = adjacency.get(current.node) ?? [];
      for (let index = consumers.length - 1; index >= 0; index -= 1) {
        const consumer = consumers[index]!;
        if (!visited.has(consumer)) {
          stack.push({ node: consumer, expanded: false });
        }
      }
    }
  }

  const componentByParameter = new Map<ParameterId, number>();
  let component = 0;
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const root = finishOrder[index]!;
    if (componentByParameter.has(root)) continue;
    const stack = [root];
    component += 1;
    componentByParameter.set(root, component);
    while (stack.length > 0) {
      consumeImpactWork(budget);
      const current = stack.pop()!;
      for (const dependency of reverse.get(current) ?? []) {
        if (!componentByParameter.has(dependency)) {
          componentByParameter.set(dependency, component);
          stack.push(dependency);
        }
      }
    }
  }

  for (const edge of [...edges.values()].sort(
    (first, second) =>
      lexicalCompare(first.consumer, second.consumer) ||
      lexicalCompare(first.dependency, second.dependency),
  )) {
    consumeImpactWork(budget);
    if (
      componentByParameter.get(edge.dependency) ===
        componentByParameter.get(edge.consumer) &&
      !edge.propagatedNewOrigin
    ) {
      continue;
    }
    const reason = {
      kind: "dependency" as const,
      parameter: edge.dependency,
    };
    addReason(
      impacts,
      edge.consumer,
      reason,
      parameterReasonKey(reason),
    );
  }
}

function computeImpact(
  document: DesignDocument,
  changes: CopiedChanges,
  limits: DesignDocumentLimits,
): DesignImpactReport {
  const configurations = (document.configurations ?? {}) as Readonly<
    Record<ConfigurationId, DesignConfigurationIR>
  >;
  const materials = (document.materials ?? {}) as Readonly<
    Record<MaterialId, MaterialDefinitionIR>
  >;
  const parameterImpacts = new Map<
    ParameterId,
    ImpactState<DesignParameterImpactReason>
  >();
  const materialImpacts = new Map<
    MaterialId,
    ImpactState<DesignMaterialImpactReason>
  >();
  const configurationImpacts = new Map<
    ConfigurationId,
    ImpactState<DesignConfigurationImpactReason>
  >();
  const nodeImpacts = new Map<NodeId, ImpactState<DesignNodeImpactReason>>();
  const budget: ImpactWorkBudget = {
    limit: limits.maxStructuralValues,
    used: 0,
  };
  const changedConfigurations = new Set(
    changes.configurations.map((item) => item.value),
  );

  for (const item of changes.parameters) {
    addReason(parameterImpacts, item.value, { kind: "seed" }, "0");
  }
  for (const item of changes.materials) {
    addReason(materialImpacts, item.value, { kind: "seed" }, "0");
  }
  for (const item of changes.configurations) {
    addReason(configurationImpacts, item.value, { kind: "seed" }, "0");
  }
  for (const item of changes.nodes) {
    addReason(nodeImpacts, item.value, { kind: "seed" }, "0");
  }

  const defaultParameterConsumers = new Map<ParameterId, Set<ParameterId>>();
  const boundParameterConsumers = new Map<ParameterId, Set<ParameterId>>();
  const materialConsumers = new Map<ParameterId, Set<MaterialId>>();
  for (const [parameter, definition] of Object.entries(
    document.parameters,
  ) as [ParameterId, ParameterIR][]) {
    for (const dependency of expressionParameterDependencies(
      definition.default,
    )) {
      if (dependency !== parameter) {
        addReverseEdge(defaultParameterConsumers, dependency, parameter);
      }
    }
    for (const dependency of parameterBoundDependencies(definition)) {
      if (dependency !== parameter) {
        addReverseEdge(boundParameterConsumers, dependency, parameter);
      }
    }
  }
  for (const [material, definition] of Object.entries(materials) as [
    MaterialId,
    MaterialDefinitionIR,
  ][]) {
    for (const parameter of materialDependencies(definition)) {
      const existing = materialConsumers.get(parameter);
      if (existing === undefined) {
        materialConsumers.set(parameter, new Set([material]));
      } else {
        existing.add(material);
      }
    }
  }

  const configurationParameterConsumers = new Map<
    ConfigurationId,
    Map<ParameterId, Set<ParameterId>>
  >();
  const configurationParameterTargets = new Map<
    ConfigurationId,
    Set<ParameterId>
  >();
  const configurationParameterReferences = new Map<
    ConfigurationId,
    Set<ParameterId>
  >();
  const configurationMaterialReferences = new Map<
    ConfigurationId,
    Set<MaterialId>
  >();
  const configurationMaterialParts = new Map<
    ConfigurationId,
    Map<MaterialId, Set<NodeId>>
  >();
  for (const [configurationId, configuration] of Object.entries(
    configurations,
  ) as [ConfigurationId, DesignConfigurationIR][]) {
    const consumers = new Map<ParameterId, Set<ParameterId>>();
    const targets = new Set<ParameterId>();
    const references = new Set<ParameterId>();
    for (const [parameter, expression] of Object.entries(
      configuration.parameterOverrides ?? {},
    ) as [ParameterId, ExpressionIR][]) {
      targets.add(parameter);
      references.add(parameter);
      for (const dependency of expressionParameterDependencies(expression)) {
        references.add(dependency);
        if (dependency !== parameter) {
          addReverseEdge(consumers, dependency, parameter);
        }
      }
    }
    configurationParameterConsumers.set(configurationId, consumers);
    configurationParameterTargets.set(configurationId, targets);
    configurationParameterReferences.set(configurationId, references);

    const materialReferences = new Set<MaterialId>();
    const materialParts = new Map<MaterialId, Set<NodeId>>();
    for (const [node, material] of Object.entries(
      configuration.partMaterialOverrides ?? {},
    ) as [NodeId, MaterialId][]) {
      materialReferences.add(material);
      const existing = materialParts.get(material);
      if (existing === undefined) materialParts.set(material, new Set([node]));
      else existing.add(node);
    }
    configurationMaterialReferences.set(configurationId, materialReferences);
    configurationMaterialParts.set(configurationId, materialParts);
  }

  const parameterNodeConsumers = new Map<ParameterId, Set<NodeId>>();
  const assemblyParameterConsumers = new Map<
    ParameterId,
    ConditionalAssemblyEdge[]
  >();
  const staticNodeConsumers = new Map<NodeId, Set<NodeId>>();
  const assemblyNodeConsumers = new Map<NodeId, ConditionalAssemblyEdge[]>();
  const topologyReferenceConsumers = new Map<
    TopologyReferenceId,
    Set<NodeId>
  >();
  const baseMaterialParts = new Map<MaterialId, Set<NodeId>>();
  for (const [nodeId, node] of Object.entries(document.nodes) as [
    NodeId,
    NodeIR,
  ][]) {
    if (node.kind === "assembly") {
      for (const instance of node.instances) {
        const edge: ConditionalAssemblyEdge = {
          assembly: nodeId,
          instance: instance.id,
          authoredSuppressed: instance.suppressed,
        };
        const dependencyEdges = assemblyNodeConsumers.get(
          instance.component.node,
        );
        if (dependencyEdges === undefined) {
          assemblyNodeConsumers.set(instance.component.node, [edge]);
        } else {
          dependencyEdges.push(edge);
        }
        for (const parameter of nodeParameterDependencies({
          ...node,
          instances: [instance],
        })) {
          const parameterEdges = assemblyParameterConsumers.get(parameter);
          if (parameterEdges === undefined) {
            assemblyParameterConsumers.set(parameter, [edge]);
          } else {
            parameterEdges.push(edge);
          }
        }
      }
    } else {
      for (const parameter of nodeParameterDependencies(node)) {
        const existing = parameterNodeConsumers.get(parameter);
        if (existing === undefined) {
          parameterNodeConsumers.set(parameter, new Set([nodeId]));
        } else {
          existing.add(nodeId);
        }
      }
      for (const dependency of nodeDependencies(node)) {
        addReverseEdge(staticNodeConsumers, dependency.node, nodeId);
      }
    }

    if (node.kind === "part" && node.materialId !== undefined) {
      const existing = baseMaterialParts.get(node.materialId);
      if (existing === undefined) {
        baseMaterialParts.set(node.materialId, new Set([nodeId]));
      } else {
        existing.add(nodeId);
      }
    }
    const selection = topologySelectionForNode(node);
    if (selection !== undefined) {
      for (const reference of topologySelectionRequirements(selection)
        .persistentReferences) {
        const existing = topologyReferenceConsumers.get(reference);
        if (existing === undefined) {
          topologyReferenceConsumers.set(reference, new Set([nodeId]));
        } else {
          existing.add(nodeId);
        }
      }
    }
  }

  const contexts: readonly (readonly [
    ConfigurationId | undefined,
    DesignConfigurationIR | undefined,
  ])[] = [
    [undefined, undefined],
    ...(Object.entries(configurations) as [
      ConfigurationId,
      DesignConfigurationIR,
    ][])
      .filter(([, configuration]) =>
        configurationAffectsEvaluation(configuration),
      )
      .sort(([first], [second]) => lexicalCompare(first, second)),
  ];
  const impactedOutputNodes = new Set<NodeId>();

  for (const [configurationId, configuration] of contexts) {
    consumeImpactWork(budget);
    const parameterReachability = new Map<ParameterId, ReachabilityState>();
    const parameterQueue: ParameterId[] = [];
    const contextParameterEdges = new Map<string, ContextParameterEdge>();
    for (const item of changes.parameters) {
      consumeImpactWork(budget);
      if (
        addReachabilityRoot(
          parameterReachability,
          item.value,
          "external",
        )
      ) {
        parameterQueue.push(item.value);
      }
    }
    if (
      configurationId !== undefined &&
      changedConfigurations.has(configurationId)
    ) {
      for (const parameter of [
        ...(configurationParameterTargets.get(configurationId) ?? []),
      ].sort(lexicalCompare)) {
        consumeImpactWork(budget);
        const reason = {
          kind: "configuration" as const,
          configuration: configurationId,
        };
        addReason(
          parameterImpacts,
          parameter,
          reason,
          parameterReasonKey(reason),
        );
        if (
          addReachabilityRoot(
            parameterReachability,
            parameter,
            "configuration",
          )
        ) {
          parameterQueue.push(parameter);
        }
      }
    }

    const overriddenTargets =
      configurationId === undefined
        ? undefined
        : configurationParameterTargets.get(configurationId);
    const overrideConsumers =
      configurationId === undefined
        ? undefined
        : configurationParameterConsumers.get(configurationId);
    for (let cursor = 0; cursor < parameterQueue.length; cursor += 1) {
      const dependency = parameterQueue[cursor]!;
      const source = parameterReachability.get(dependency)!;
      const propagate = (consumer: ParameterId): void => {
        consumeImpactWork(budget);
        if (consumer === dependency) return;
        const propagation = propagateReachability(
          parameterReachability,
          consumer,
          source,
        );
        const edgeKey = `${dependency}\u0000${consumer}`;
        const edge = contextParameterEdges.get(edgeKey);
        if (edge === undefined) {
          contextParameterEdges.set(edgeKey, {
            dependency,
            consumer,
            propagatedNewOrigin: propagation.changed,
          });
        } else if (propagation.changed) {
          edge.propagatedNewOrigin = true;
        }
        if (propagation.changed) parameterQueue.push(consumer);
      };
      for (const consumer of [
        ...(boundParameterConsumers.get(dependency) ?? []),
      ].sort(lexicalCompare)) {
        propagate(consumer);
      }
      for (const consumer of [
        ...(defaultParameterConsumers.get(dependency) ?? []),
      ].sort(lexicalCompare)) {
        if (!overriddenTargets?.has(consumer)) propagate(consumer);
      }
      for (const consumer of [
        ...(overrideConsumers?.get(dependency) ?? []),
      ].sort(lexicalCompare)) {
        propagate(consumer);
      }
    }
    addContextParameterReasons(
      contextParameterEdges,
      parameterImpacts,
      budget,
    );

    const materialReachability = new Map<MaterialId, ReachabilityState>();
    for (const item of changes.materials) {
      consumeImpactWork(budget);
      addReachabilityRoot(
        materialReachability,
        item.value,
        "external",
      );
    }
    for (const [parameter, source] of [...parameterReachability.entries()].sort(
      ([first], [second]) => lexicalCompare(first, second),
    )) {
      for (const material of [
        ...(materialConsumers.get(parameter) ?? []),
      ].sort(lexicalCompare)) {
        consumeImpactWork(budget);
        propagateReachability(materialReachability, material, source);
        const reason = { kind: "parameter" as const, parameter };
        addReason(
          materialImpacts,
          material,
          reason,
          materialReasonKey(reason),
        );
      }
    }

    if (configurationId !== undefined) {
      const isSeeded = changedConfigurations.has(configurationId);
      for (const parameter of [
        ...(configurationParameterReferences.get(configurationId) ?? []),
      ].sort(lexicalCompare)) {
        consumeImpactWork(budget);
        const state = parameterReachability.get(parameter);
        if (
          state === undefined ||
          (isSeeded && !hasExternalOrigin(state))
        ) {
          continue;
        }
        const reason = { kind: "parameter" as const, parameter };
        addReason(
          configurationImpacts,
          configurationId,
          reason,
          configurationReasonKey(reason),
        );
      }
      for (const material of [
        ...(configurationMaterialReferences.get(configurationId) ?? []),
      ].sort(lexicalCompare)) {
        consumeImpactWork(budget);
        const state = materialReachability.get(material);
        if (
          state === undefined ||
          (isSeeded && !hasExternalOrigin(state))
        ) {
          continue;
        }
        const reason = { kind: "material" as const, material };
        addReason(
          configurationImpacts,
          configurationId,
          reason,
          configurationReasonKey(reason),
        );
      }
    }

    const contextNodes = new Set<NodeId>();
    const nodeQueue: NodeId[] = [];
    const addContextNode = (
      node: NodeId,
      reason: DesignNodeImpactReason,
    ): void => {
      addReason(nodeImpacts, node, reason, nodeReasonKey(reason));
      if (!contextNodes.has(node)) {
        contextNodes.add(node);
        nodeQueue.push(node);
      }
    };
    for (const item of changes.nodes) {
      consumeImpactWork(budget);
      addContextNode(item.value, { kind: "seed" });
    }
    for (const item of changes.topologyReferences) {
      for (const node of [
        ...(topologyReferenceConsumers.get(item.value) ?? []),
      ].sort(lexicalCompare)) {
        consumeImpactWork(budget);
        addContextNode(node, {
          kind: "topologyReference",
          topologyReference: item.value,
        });
      }
    }
    for (const parameter of [...parameterReachability.keys()].sort(
      lexicalCompare,
    )) {
      for (const node of [
        ...(parameterNodeConsumers.get(parameter) ?? []),
      ].sort(lexicalCompare)) {
        consumeImpactWork(budget);
        addContextNode(node, { kind: "parameter", parameter });
      }
      for (const edge of assemblyParameterConsumers.get(parameter) ?? []) {
        consumeImpactWork(budget);
        if (assemblyEdgeIsActive(edge, configuration)) {
          addContextNode(edge.assembly, { kind: "parameter", parameter });
        }
      }
    }

    const partMaterialOverrides = configuration?.partMaterialOverrides ?? {};
    const configuredMaterialParts =
      configurationId === undefined
        ? undefined
        : configurationMaterialParts.get(configurationId);
    for (const material of [...materialReachability.keys()].sort(
      lexicalCompare,
    )) {
      const candidates = new Set<NodeId>([
        ...(baseMaterialParts.get(material) ?? []),
        ...(configuredMaterialParts?.get(material) ?? []),
      ]);
      for (const node of [...candidates].sort(lexicalCompare)) {
        consumeImpactWork(budget);
        const authoredMaterial =
          document.nodes[node]?.kind === "part"
            ? document.nodes[node].materialId
            : undefined;
        const effectiveMaterial = Object.hasOwn(partMaterialOverrides, node)
          ? partMaterialOverrides[node]
          : authoredMaterial;
        if (effectiveMaterial === material) {
          addContextNode(node, { kind: "material", material });
        }
      }
    }

    if (
      configurationId !== undefined &&
      changedConfigurations.has(configurationId)
    ) {
      for (const node of Object.keys(
        configuration!.partMaterialOverrides ?? {},
      ).sort() as NodeId[]) {
        consumeImpactWork(budget);
        addContextNode(node, {
          kind: "configuration",
          configuration: configurationId,
        });
      }
      for (const [assembly, instances] of Object.entries(
        configuration!.instanceSuppressions ?? {},
      ).sort(([first], [second]) => lexicalCompare(first, second)) as [
        NodeId,
        Readonly<Record<EntityId, boolean>>,
      ][]) {
        consumeImpactWork(budget);
        if (Object.keys(instances).length > 0) {
          addContextNode(assembly, {
            kind: "configuration",
            configuration: configurationId,
          });
        }
      }
    }

    for (let cursor = 0; cursor < nodeQueue.length; cursor += 1) {
      const dependency = nodeQueue[cursor]!;
      for (const consumer of [
        ...(staticNodeConsumers.get(dependency) ?? []),
      ].sort(lexicalCompare)) {
        consumeImpactWork(budget);
        addContextNode(consumer, { kind: "dependency", node: dependency });
      }
      for (const edge of assemblyNodeConsumers.get(dependency) ?? []) {
        consumeImpactWork(budget);
        if (assemblyEdgeIsActive(edge, configuration)) {
          addContextNode(edge.assembly, {
            kind: "dependency",
            node: dependency,
          });
        }
      }
    }
    for (const node of contextNodes) impactedOutputNodes.add(node);
  }

  const report: DesignImpactReport = {
    version: DESIGN_IMPACT_REPORT_VERSION,
    seeds: {
      nodes: changes.nodes.map((item) => item.value),
      parameters: changes.parameters.map((item) => item.value),
      materials: changes.materials.map((item) => item.value),
      configurations: changes.configurations.map((item) => item.value),
      topologyReferences: changes.topologyReferences.map((item) => item.value),
    },
    parameters: [...parameterImpacts.entries()]
      .sort(([first], [second]) => lexicalCompare(first, second))
      .map(([parameter, state]) => ({
        parameter,
        reasons: sortedReasons(state, parameterReasonKey),
      })),
    materials: [...materialImpacts.entries()]
      .sort(([first], [second]) => lexicalCompare(first, second))
      .map(([material, state]) => ({
        material,
        reasons: sortedReasons(state, materialReasonKey),
      })),
    configurations: [...configurationImpacts.entries()]
      .sort(([first], [second]) => lexicalCompare(first, second))
      .map(([configuration, state]) => ({
        configuration,
        reasons: sortedReasons(state, configurationReasonKey),
      })),
    nodes: [...nodeImpacts.entries()]
      .sort(([first], [second]) => lexicalCompare(first, second))
      .map(([node, state]) => {
        const reasons = sortedReasons(state, nodeReasonKey);
        return {
          node,
          direct: reasons.some((reason) => reason.kind !== "dependency"),
          reasons,
        };
      }),
    outputs: Object.entries(document.outputs)
      .filter(([, reference]) => impactedOutputNodes.has(reference.node))
      .sort(([first], [second]) => lexicalCompare(first, second))
      .map(([name, reference]) => ({ name, node: reference.node })),
  };
  return deepFreeze(report) as DesignImpactReport;
}

/**
 * Computes deterministic current-graph impact without evaluating geometry.
 * Base and named-configuration contexts close independently before unioning.
 * The input document is detached and validated before any graph traversal.
 */
export function analyzeDesignImpact(
  document: DesignDocument,
  changes: DesignImpactChanges,
  options: AnalyzeDesignImpactOptions = {},
): CadResult<DesignImpactReport> {
  try {
    if (!isPlainRecord(options)) {
      return invalid(
        "Design-impact analysis options are malformed or unsupported",
      );
    }
    const optionKeys = Object.keys(options);
    if (optionKeys.some((key) => key !== "limits")) {
      return invalid(
        "Design-impact analysis options are malformed or unsupported",
      );
    }
    const limitsValue = optionKeys.includes("limits")
      ? options.limits
      : undefined;
    if (limitsValue !== undefined && !isPlainRecord(limitsValue)) {
      return invalid("Design-impact document limits are malformed or unsupported");
    }
    const limits = normalizeDesignDocumentLimits(limitsValue);
    if (limits === undefined) {
      return invalid("Design-impact document limits are malformed or unsupported");
    }
    const parsed = parseDocumentValue(document, { limits });
    if (!parsed.ok) return parsed;
    const copiedChanges = copyChanges(changes, limits);
    if (!copiedChanges.ok) return copiedChanges;
    const seedDiagnostics = validateSeeds(parsed.value, copiedChanges.value);
    if (seedDiagnostics.length > 0) return { ok: false, diagnostics: seedDiagnostics };
    return success(
      computeImpact(parsed.value, copiedChanges.value, limits),
      parsed.diagnostics,
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      impactWorkFailures.has(error)
    ) {
      return (error as ImpactWorkFailure).result;
    }
    return failure(
      diagnostic(
        "IR_INVALID",
        safeErrorMessage(error, "Design-impact inputs could not be read safely"),
        { severity: "error" },
      ),
    );
  }
}
