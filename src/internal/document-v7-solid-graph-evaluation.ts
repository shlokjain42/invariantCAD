import type { NodeId } from "../core/ids.js";
import {
  diagnostic,
  failure,
  success,
  type CadResult,
} from "../core/result.js";
import type {
  DesignDocumentV7,
  ImportedBodyNodeIRV7,
  NodeIRV7,
  TransformNodeIR,
} from "../ir.js";

/** Solid-producing nodes admitted by the staged product evaluator. @internal */
export type StagedSolidGraphNodeV7 =
  | Extract<
      NodeIRV7,
      {
        readonly kind:
          | "box"
          | "cylinder"
          | "sphere"
          | "importedBody";
      }
    >
  | TransformNodeIR;

/** Primitive or imported roots acquired without a solid dependency. @internal */
export type StagedSolidLeafNodeV7 = Exclude<
  StagedSolidGraphNodeV7,
  TransformNodeIR
>;

/** One selected solid and the document path that selected it. @internal */
export interface StagedSolidGraphRootV7 {
  readonly node: NodeId;
  readonly path: string;
}

/** Independent ceilings for one deduplicated staged solid closure. @internal */
export interface StagedSolidGraphLimitsV7 {
  /** Primitive and imported-body nodes acquired directly from the kernel. */
  readonly maxDistinctSolids: number;
  /** Every distinct admitted solid node, including transforms. */
  readonly maxSolidGraphNodes: number;
  /** Solid-reference edges traversed across the admitted graph. */
  readonly maxSolidDependencyLinks: number;
  /** Authored transform operations across distinct transform nodes. */
  readonly maxTransformOperations: number;
}

/** Child-before-parent solid plan produced without resolver or kernel work. @internal */
export interface StagedSolidGraphPlanV7 {
  readonly orderedNodes: readonly (readonly [
    NodeId,
    StagedSolidGraphNodeV7,
  ])[];
  readonly leafNodes: readonly (readonly [
    NodeId,
    StagedSolidLeafNodeV7,
  ])[];
  readonly graphNodeCount: number;
  readonly dependencyLinkCount: number;
  readonly transformOperationCount: number;
}

interface SolidGraphFrame {
  readonly id: NodeId;
  readonly path: string;
  expanded: boolean;
}

const solidGraphObjectHasOwn = Object.hasOwn;
const solidGraphReflectApply = Reflect.apply;
const SolidGraphArray = Array;
const solidGraphArraySort = Array.prototype.sort;
const SolidGraphMap = Map;
const solidGraphMapGet = Map.prototype.get;
const solidGraphMapSet = Map.prototype.set;
const SOLID_GRAPH_MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const SOLID_GRAPH_COUNT_OVERFLOW_ACTUAL =
  SOLID_GRAPH_MAX_SAFE_INTEGER + 1;

function solidGraphApply<T>(
  method: CallableFunction,
  receiver: unknown,
  arguments_: readonly unknown[],
): T {
  return solidGraphReflectApply(method, receiver, arguments_) as T;
}

function solidGraphHasOwn(value: object, key: PropertyKey): boolean {
  return solidGraphApply<boolean>(solidGraphObjectHasOwn, Object, [
    value,
    key,
  ]);
}

function solidGraphMapValue<K, V>(
  map: Map<K, V>,
  key: K,
): V | undefined {
  return solidGraphApply<V | undefined>(solidGraphMapGet, map, [key]);
}

function solidGraphMapInsert<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
): void {
  solidGraphApply<void>(solidGraphMapSet, map, [key, value]);
}

function lexicalCompare(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function boundedActual(current: number, increment: number): number {
  return increment <= SOLID_GRAPH_MAX_SAFE_INTEGER - current
    ? current + increment
    : SOLID_GRAPH_COUNT_OVERFLOW_ACTUAL;
}

function solidGraphLimitFailure(
  phase: string,
  resource: keyof StagedSolidGraphLimitsV7,
  limit: number,
  actual: number,
  path: string,
): CadResult<never> {
  return failure(
    diagnostic(
      "RESOURCE_LIMIT_EXCEEDED",
      `Solid graph evaluation limit '${resource}' (${limit}) was exceeded`,
      {
        severity: "error",
        path,
        details: {
          phase,
          resource,
          limit,
          actual,
        },
      },
    ),
  );
}

function unsupportedSolid(
  phase: string,
  id: NodeId,
  path: string,
  node: NodeIRV7 | undefined,
): CadResult<never> {
  return failure(
    diagnostic(
      "EVALUATION_UNSUPPORTED",
      `Solid graph node '${id}' is not an admitted primitive, imported body, or transform`,
      {
        severity: "error",
        node: id,
        path,
        details: {
          phase,
          supported: [
            "box",
            "cylinder",
            "sphere",
            "importedBody",
            "transform",
          ],
          nodeKind: node?.kind,
        },
      },
    ),
  );
}

function isStagedSolidGraphNodeV7(
  node: NodeIRV7 | undefined,
): node is StagedSolidGraphNodeV7 {
  return (
    node !== undefined &&
    (node.kind === "box" ||
      node.kind === "cylinder" ||
      node.kind === "sphere" ||
      node.kind === "importedBody" ||
      node.kind === "transform")
  );
}

/**
 * Plans a bounded solid DAG before resource resolution or kernel work.
 *
 * The parser already rejects invalid references and cycles. This planner
 * repeats the executable-subset check and retains iterative cycle detection so
 * its ownership and work limits do not rely on that wider validation contract.
 *
 * @internal
 */
export function planStagedSolidGraphV7(
  document: DesignDocumentV7,
  roots: readonly StagedSolidGraphRootV7[],
  limits: StagedSolidGraphLimitsV7,
  phase: string,
): CadResult<StagedSolidGraphPlanV7> {
  const state = new SolidGraphMap<NodeId, 1 | 2>();
  const ordered =
    new SolidGraphArray<readonly [NodeId, StagedSolidGraphNodeV7]>();
  const leaves =
    new SolidGraphArray<readonly [NodeId, StagedSolidLeafNodeV7]>();
  let graphNodeCount = 0;
  let dependencyLinkCount = 0;
  let transformOperationCount = 0;
  const orderedRoots = new SolidGraphArray<StagedSolidGraphRootV7>(
    roots.length,
  );
  for (let index = 0; index < roots.length; index += 1) {
    orderedRoots[index] = roots[index]!;
  }
  solidGraphApply<void>(solidGraphArraySort, orderedRoots, [
    (
      first: StagedSolidGraphRootV7,
      second: StagedSolidGraphRootV7,
    ) => {
      const byNode = lexicalCompare(first.node, second.node);
      return byNode === 0
        ? lexicalCompare(first.path, second.path)
        : byNode;
    },
  ]);

  for (
    let rootIndex = 0;
    rootIndex < orderedRoots.length;
    rootIndex += 1
  ) {
    const root = orderedRoots[rootIndex]!;
    if (solidGraphMapValue(state, root.node) === 2) continue;
    const stack = new SolidGraphArray<SolidGraphFrame>();
    stack[0] = {
      id: root.node,
      path: root.path,
      expanded: false,
    };
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const currentState = solidGraphMapValue(state, frame.id);
      if (currentState === 2) {
        stack.length -= 1;
        continue;
      }
      const node = solidGraphHasOwn(document.nodes, frame.id)
        ? document.nodes[frame.id]
        : undefined;
      if (!isStagedSolidGraphNodeV7(node)) {
        return unsupportedSolid(phase, frame.id, frame.path, node);
      }

      if (!frame.expanded) {
        if (currentState === 1) {
          return failure(
            diagnostic(
              "IR_INVALID",
              `Solid graph contains a cycle through '${frame.id}'`,
              {
                severity: "error",
                node: frame.id,
                path: frame.path,
                details: { phase },
              },
            ),
          );
        }
        solidGraphMapInsert(state, frame.id, 1);
        graphNodeCount += 1;
        if (graphNodeCount > limits.maxSolidGraphNodes) {
          return solidGraphLimitFailure(
            phase,
            "maxSolidGraphNodes",
            limits.maxSolidGraphNodes,
            graphNodeCount,
            frame.path,
          );
        }
        frame.expanded = true;
        if (node.kind === "transform") {
          const nextDependencyLinkCount = boundedActual(
            dependencyLinkCount,
            1,
          );
          if (nextDependencyLinkCount > limits.maxSolidDependencyLinks) {
            return solidGraphLimitFailure(
              phase,
              "maxSolidDependencyLinks",
              limits.maxSolidDependencyLinks,
              nextDependencyLinkCount,
              `/nodes/${frame.id}/input`,
            );
          }
          dependencyLinkCount = nextDependencyLinkCount;
          const nextTransformOperationCount = boundedActual(
            transformOperationCount,
            node.operations.length,
          );
          if (nextTransformOperationCount > limits.maxTransformOperations) {
            return solidGraphLimitFailure(
              phase,
              "maxTransformOperations",
              limits.maxTransformOperations,
              nextTransformOperationCount,
              `/nodes/${frame.id}/operations`,
            );
          }
          transformOperationCount = nextTransformOperationCount;
          stack[stack.length] = {
            id: node.input.node,
            path: `/nodes/${frame.id}/input`,
            expanded: false,
          };
          continue;
        }
      }

      if (node.kind !== "transform") {
        leaves[leaves.length] = [frame.id, node];
        if (leaves.length > limits.maxDistinctSolids) {
          return solidGraphLimitFailure(
            phase,
            "maxDistinctSolids",
            limits.maxDistinctSolids,
            leaves.length,
            frame.path,
          );
        }
      }
      ordered[ordered.length] = [frame.id, node];
      solidGraphMapInsert(state, frame.id, 2);
      stack.length -= 1;
    }
  }

  return success({
    orderedNodes: ordered,
    leafNodes: leaves,
    graphNodeCount,
    dependencyLinkCount,
    transformOperationCount,
  });
}

/** Narrows one planned node for resource collection. @internal */
export function stagedSolidNodeIsImportedBodyV7(
  node: StagedSolidGraphNodeV7,
): node is ImportedBodyNodeIRV7 {
  return node.kind === "importedBody";
}
