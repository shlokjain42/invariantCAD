import type {
  ConfigurationId,
  EntityId,
  MaterialId,
  NodeId,
  ParameterId,
  TopologyReferenceId,
} from "./core/ids.js";
import {
  diagnostic,
  hasErrors,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import type { Dimension, ExpressionIR } from "./expressions.js";
import {
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_VERSION_V1,
  DOCUMENT_VERSION_V2,
  DOCUMENT_VERSION_V3,
  DOCUMENT_VERSION_V4,
  nodeDependencies,
  outputKindForNode,
  type DesignDocument,
  type DesignConfigurationIR,
  type NodeIR,
  type OutputKind,
  type RefIR,
  type SketchLoopIR,
  type SketchNodeIR,
  type TopologyQueryIR,
  type TopologyReferenceEntryIR,
  type TopologySelectionIR,
  type TransformOperationIR,
} from "./ir.js";
import {
  TOPOLOGY_ROLES_V1,
  TOPOLOGY_ROLES_V2,
  TOPOLOGY_ROLES_V3,
  TOPOLOGY_ROLES_V4,
  TOPOLOGY_ROLE_RULES,
  type TopologyKind,
  type TopologyRole,
} from "./protocol/topology.js";
import { SHELL_DIRECTIONS } from "./protocol/shell.js";
import { OFFSET_DIRECTIONS } from "./protocol/offset.js";
import { normalizePersistentTopologyReference } from "./topology-signatures.js";

function topologyRolesForDocumentVersion(
  version: DesignDocument["version"],
): readonly string[] {
  switch (version) {
    case DOCUMENT_VERSION_V1:
      return TOPOLOGY_ROLES_V1;
    case DOCUMENT_VERSION_V2:
      return TOPOLOGY_ROLES_V2;
    case DOCUMENT_VERSION_V3:
      return TOPOLOGY_ROLES_V3;
    case DOCUMENT_VERSION_V4:
      return TOPOLOGY_ROLES_V4;
  }
}

function validateExpression(
  expression: ExpressionIR,
  expected: Dimension,
  document: DesignDocument,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (expression.dimension !== expected) {
    diagnostics.push(
      diagnostic(
        "EXPRESSION_DIMENSION_MISMATCH",
        `Expected a ${expected} expression, received ${expression.dimension}`,
        { severity: "error", path },
      ),
    );
  }

  const child = (
    value: ExpressionIR,
    dimension: Dimension,
    suffix: string,
  ): void => validateExpression(value, dimension, document, `${path}/${suffix}`, diagnostics);

  switch (expression.op) {
    case "literal":
      if (!Number.isFinite(expression.value)) {
        diagnostics.push(
          diagnostic("EXPRESSION_INVALID", "Expression literals must be finite", {
            severity: "error",
            path,
          }),
        );
      }
      break;
    case "parameter": {
      const parameter = document.parameters[expression.id];
      if (parameter === undefined) {
        diagnostics.push(
          diagnostic(
            "PARAMETER_MISSING",
            `Expression references missing parameter '${expression.id}'`,
            { severity: "error", path: `${path}/id` },
          ),
        );
      } else if (parameter.dimension !== expression.dimension) {
        diagnostics.push(
          diagnostic(
            "EXPRESSION_DIMENSION_MISMATCH",
            `Parameter '${expression.id}' is ${parameter.dimension}, not ${expression.dimension}`,
            { severity: "error", path },
          ),
        );
      }
      break;
    }
    case "neg":
    case "abs":
      child(expression.value, expression.dimension, "value");
      break;
    case "sin":
    case "cos":
    case "tan":
      if (expression.dimension !== "scalar") {
        diagnostics.push(
          diagnostic(
            "EXPRESSION_DIMENSION_MISMATCH",
            `${expression.op} must produce a scalar`,
            { severity: "error", path },
          ),
        );
      }
      child(expression.value, "angle", "value");
      break;
    case "add":
    case "sub":
      child(expression.left, expression.dimension, "left");
      child(expression.right, expression.dimension, "right");
      break;
    case "mul": {
      const leftScalar = expression.left.dimension === "scalar";
      const rightScalar = expression.right.dimension === "scalar";
      if (!leftScalar && !rightScalar) {
        diagnostics.push(
          diagnostic(
            "EXPRESSION_DIMENSION_MISMATCH",
            "Multiplication requires at least one scalar operand",
            { severity: "error", path },
          ),
        );
      }
      child(expression.left, expression.left.dimension, "left");
      child(expression.right, expression.right.dimension, "right");
      const inferred = leftScalar
        ? expression.right.dimension
        : expression.left.dimension;
      if (inferred !== expression.dimension) {
        diagnostics.push(
          diagnostic(
            "EXPRESSION_DIMENSION_MISMATCH",
            `Multiplication should produce ${inferred}, not ${expression.dimension}`,
            { severity: "error", path },
          ),
        );
      }
      break;
    }
    case "div":
      child(expression.left, expression.left.dimension, "left");
      child(expression.right, expression.right.dimension, "right");
      if (expression.right.dimension === "scalar") {
        if (expression.left.dimension !== expression.dimension) {
          diagnostics.push(
            diagnostic(
              "EXPRESSION_DIMENSION_MISMATCH",
              "Division by a scalar must preserve the numerator dimension",
              { severity: "error", path },
            ),
          );
        }
      } else if (
        expression.left.dimension !== expression.right.dimension ||
        expression.dimension !== "scalar"
      ) {
        diagnostics.push(
          diagnostic(
            "EXPRESSION_DIMENSION_MISMATCH",
            "Non-scalar division requires equal dimensions and produces a scalar",
            { severity: "error", path },
          ),
        );
      }
      break;
    case "min":
    case "max":
      if (expression.values.length === 0) {
        diagnostics.push(
          diagnostic("EXPRESSION_INVALID", `${expression.op} requires values`, {
            severity: "error",
            path,
          }),
        );
      }
      expression.values.forEach((value, index) =>
        child(value, expression.dimension, `values/${index}`),
      );
      break;
  }
}

function validateConfiguration(
  id: ConfigurationId,
  configuration: DesignConfigurationIR,
  document: DesignDocument,
  diagnostics: Diagnostic[],
): void {
  const path = `/configurations/${id}`;
  for (const [parameterId, value] of Object.entries(
    configuration.parameterOverrides ?? {},
  ) as [ParameterId, ExpressionIR][]) {
    const definition = Object.hasOwn(document.parameters, parameterId)
      ? document.parameters[parameterId]
      : undefined;
    const valuePath = `${path}/parameterOverrides/${parameterId}`;
    if (definition === undefined) {
      diagnostics.push(
        diagnostic(
          "PARAMETER_MISSING",
          `Configuration references missing parameter '${parameterId}'`,
          { severity: "error", path: valuePath },
        ),
      );
    } else {
      validateExpression(
        value,
        definition.dimension,
        document,
        valuePath,
        diagnostics,
      );
    }
  }

  for (const [assemblyId, instances] of Object.entries(
    configuration.instanceSuppressions ?? {},
  ) as [
    NodeId,
    NonNullable<DesignConfigurationIR["instanceSuppressions"]>[NodeId],
  ][]) {
    const assemblyPath = `${path}/instanceSuppressions/${assemblyId}`;
    const node = Object.hasOwn(document.nodes, assemblyId)
      ? document.nodes[assemblyId]
      : undefined;
    if (node === undefined) {
      diagnostics.push(
        diagnostic(
          "REFERENCE_MISSING",
          `Configuration references missing assembly '${assemblyId}'`,
          { severity: "error", path: assemblyPath },
        ),
      );
      continue;
    }
    if (node.kind !== "assembly") {
      diagnostics.push(
        diagnostic(
          "REFERENCE_KIND_MISMATCH",
          `Configuration target '${assemblyId}' is ${node.kind}, not assembly`,
          { severity: "error", node: assemblyId, path: assemblyPath },
        ),
      );
      continue;
    }
    for (const instanceId of Object.keys(instances) as EntityId[]) {
      if (!node.instances.some((instance) => instance.id === instanceId)) {
        diagnostics.push(
          diagnostic(
            "REFERENCE_MISSING",
            `Assembly '${assemblyId}' has no instance '${instanceId}'`,
            {
              severity: "error",
              node: assemblyId,
              path: `${assemblyPath}/${instanceId}`,
            },
          ),
        );
      }
    }
  }

  for (const [partId, materialId] of Object.entries(
    configuration.partMaterialOverrides ?? {},
  ) as [NodeId, MaterialId][]) {
    const materialPath = `${path}/partMaterialOverrides/${partId}`;
    const node = Object.hasOwn(document.nodes, partId)
      ? document.nodes[partId]
      : undefined;
    if (node === undefined) {
      diagnostics.push(
        diagnostic(
          "REFERENCE_MISSING",
          `Configuration references missing part '${partId}'`,
          { severity: "error", path: materialPath },
        ),
      );
    } else if (node.kind !== "part") {
      diagnostics.push(
        diagnostic(
          "REFERENCE_KIND_MISMATCH",
          `Configuration target '${partId}' is ${node.kind}, not part`,
          { severity: "error", node: partId, path: materialPath },
        ),
      );
    }
    if (!Object.hasOwn(document.materials ?? {}, materialId)) {
      diagnostics.push(
        diagnostic(
          "REFERENCE_MISSING",
          `Configuration references missing material '${materialId}'`,
          {
            severity: "error",
            path: materialPath,
            details: { materialId },
          },
        ),
      );
    }
  }
}

function validateRef(
  reference: RefIR,
  expected: OutputKind | readonly OutputKind[],
  document: DesignDocument,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const target = Object.hasOwn(document.nodes, reference.node)
    ? document.nodes[reference.node]
    : undefined;
  if (target === undefined) {
    diagnostics.push(
      diagnostic(
        "REFERENCE_MISSING",
        `Reference targets missing node '${reference.node}'`,
        { severity: "error", path: `${path}/node` },
      ),
    );
    return;
  }
  const expectedKinds = Array.isArray(expected) ? expected : [expected];
  const actual = outputKindForNode(target);
  if (!expectedKinds.includes(reference.kind) || reference.kind !== actual) {
    diagnostics.push(
      diagnostic(
        "REFERENCE_KIND_MISMATCH",
        `Node '${reference.node}' produces ${actual}, but the reference declares ${reference.kind}`,
        { severity: "error", path },
      ),
    );
  }
}

function validateLoop(
  loop: SketchLoopIR,
  sketch: SketchNodeIR,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (loop.kind === "circle") {
    const entity = sketch.entities[loop.entity];
    if (entity?.kind !== "circle") {
      diagnostics.push(
        diagnostic(
          "SKETCH_NO_CLOSED_REGION",
          `Circle loop references non-circle entity '${loop.entity}'`,
          { severity: "error", path },
        ),
      );
    }
    return;
  }
  if (loop.edges.length < 2) {
    diagnostics.push(
      diagnostic(
        "SKETCH_NO_CLOSED_REGION",
        "An edge loop requires at least two edges",
        { severity: "error", path },
      ),
    );
  }
  for (const [index, edge] of loop.edges.entries()) {
    const entity = sketch.entities[edge.entity];
    if (entity?.kind !== "line" && entity?.kind !== "arc") {
      diagnostics.push(
        diagnostic(
          "SKETCH_NO_CLOSED_REGION",
          `Loop edge '${edge.entity}' is not a line or arc`,
          { severity: "error", path: `${path}/edges/${index}` },
        ),
      );
    }
  }
}

function profileUsesEntity(sketch: SketchNodeIR, entity: EntityId): boolean {
  return [sketch.profile.outer, ...sketch.profile.holes].some((loop) =>
    loop.kind === "circle"
      ? loop.entity === entity
      : loop.edges.some((edge) => edge.entity === entity),
  );
}

function validateTransform(
  operation: TransformOperationIR,
  document: DesignDocument,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const values = operation.kind === "mirror" ? operation.normal : operation.value;
  const expected: Dimension =
    operation.kind === "translate"
      ? "length"
      : operation.kind === "rotate"
        ? "angle"
        : "scalar";
  values.forEach((value, index) =>
    validateExpression(value, expected, document, `${path}/${index}`, diagnostics),
  );
}

function validateSketch(
  node: SketchNodeIR,
  document: DesignDocument,
  path: string,
  diagnostics: Diagnostic[],
): void {
  node.plane.origin.forEach((value, index) =>
    validateExpression(
      value,
      "length",
      document,
      `${path}/plane/origin/${index}`,
      diagnostics,
    ),
  );
  for (const [id, entity] of Object.entries(node.entities)) {
    const entityPath = `${path}/entities/${id}`;
    switch (entity.kind) {
      case "point":
        validateExpression(entity.x, "length", document, `${entityPath}/x`, diagnostics);
        validateExpression(entity.y, "length", document, `${entityPath}/y`, diagnostics);
        break;
      case "line":
        for (const endpoint of [entity.start, entity.end]) {
          if (node.entities[endpoint]?.kind !== "point") {
            diagnostics.push(
              diagnostic(
                "REFERENCE_KIND_MISMATCH",
                `Line endpoint '${endpoint}' is not a point`,
                { severity: "error", path: entityPath },
              ),
            );
          }
        }
        break;
      case "circle":
        if (node.entities[entity.center]?.kind !== "point") {
          diagnostics.push(
            diagnostic(
              "REFERENCE_KIND_MISMATCH",
              `Circle center '${entity.center}' is not a point`,
              { severity: "error", path: entityPath },
            ),
          );
        }
        validateExpression(
          entity.radius,
          "length",
          document,
          `${entityPath}/radius`,
          diagnostics,
        );
        break;
      case "arc":
        if (node.entities[entity.center]?.kind !== "point") {
          diagnostics.push(
            diagnostic(
              "REFERENCE_KIND_MISMATCH",
              `Arc center '${entity.center}' is not a point`,
              { severity: "error", path: entityPath },
            ),
          );
        }
        validateExpression(
          entity.radius,
          "length",
          document,
          `${entityPath}/radius`,
          diagnostics,
        );
        validateExpression(
          entity.startAngle,
          "angle",
          document,
          `${entityPath}/startAngle`,
          diagnostics,
        );
        validateExpression(
          entity.endAngle,
          "angle",
          document,
          `${entityPath}/endAngle`,
          diagnostics,
        );
        break;
    }
  }
  for (const [id, constraint] of Object.entries(node.constraints)) {
    const constraintPath = `${path}/constraints/${id}`;
    const checkEntity = (value: EntityId, kinds: readonly string[]): void => {
      const entity = node.entities[value];
      if (entity === undefined || !kinds.includes(entity.kind)) {
        diagnostics.push(
          diagnostic(
            "REFERENCE_KIND_MISMATCH",
            `Constraint references '${value}', expected ${kinds.join(" or ")}`,
            { severity: "error", path: constraintPath },
          ),
        );
      }
    };
    switch (constraint.kind) {
      case "coincident":
      case "distance":
      case "distanceX":
      case "distanceY":
        checkEntity(constraint.first, ["point"]);
        checkEntity(constraint.second, ["point"]);
        if ("value" in constraint) {
          validateExpression(
            constraint.value,
            "length",
            document,
            `${constraintPath}/value`,
            diagnostics,
          );
        }
        break;
      case "horizontal":
      case "vertical":
      case "length":
        checkEntity(constraint.entity, ["line"]);
        if (constraint.kind === "length") {
          validateExpression(
            constraint.value,
            "length",
            document,
            `${constraintPath}/value`,
            diagnostics,
          );
        }
        break;
      case "fixed":
        checkEntity(constraint.entity, ["point"]);
        break;
      case "parallel":
      case "perpendicular":
      case "equalLength":
        checkEntity(constraint.first, ["line"]);
        checkEntity(constraint.second, ["line"]);
        break;
      case "angle":
        checkEntity(constraint.first, ["line"]);
        checkEntity(constraint.second, ["line"]);
        validateExpression(
          constraint.value,
          "angle",
          document,
          `${constraintPath}/value`,
          diagnostics,
        );
        break;
      case "radius":
      case "diameter":
        checkEntity(constraint.entity, ["circle", "arc"]);
        validateExpression(
          constraint.value,
          "length",
          document,
          `${constraintPath}/value`,
          diagnostics,
        );
        break;
      case "equalRadius":
        checkEntity(constraint.first, ["circle", "arc"]);
        checkEntity(constraint.second, ["circle", "arc"]);
        break;
      case "midpoint":
        checkEntity(constraint.point, ["point"]);
        checkEntity(constraint.line, ["line"]);
        break;
      case "tangent":
        checkEntity(constraint.line, ["line"]);
        checkEntity(constraint.circle, ["circle"]);
        break;
    }
  }
  validateLoop(node.profile.outer, node, `${path}/profile/outer`, diagnostics);
  node.profile.holes.forEach((loop, index) =>
    validateLoop(loop, node, `${path}/profile/holes/${index}`, diagnostics),
  );
}

function nodeIsAncestor(
  document: DesignDocument,
  descendant: NodeId,
  possibleAncestor: NodeId,
): boolean {
  const visited = new Set<NodeId>();
  const visit = (id: NodeId): boolean => {
    if (id === possibleAncestor) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    const node = Object.hasOwn(document.nodes, id)
      ? document.nodes[id]
      : undefined;
    return node !== undefined && nodeDependencies(node).some((dependency) => visit(dependency.node));
  };
  return visit(descendant);
}

function validateTopologySelection(
  selection: TopologySelectionIR,
  expected: TopologyKind,
  input: NodeId,
  document: DesignDocument,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (selection.topology !== expected) {
    diagnostics.push(
      diagnostic(
        "TOPOLOGY_SELECTOR_INVALID",
        `Expected a ${expected} topology selection, received ${selection.topology}`,
        { severity: "error", path: `${path}/topology` },
      ),
    );
  }
  const { min, max } = selection.cardinality;
  if (
    !Number.isInteger(min) ||
    min < 1 ||
    (max !== undefined && (!Number.isInteger(max) || max < min))
  ) {
    diagnostics.push(
      diagnostic("TOPOLOGY_SELECTOR_INVALID", "Invalid topology selection cardinality", {
        severity: "error",
        path: `${path}/cardinality`,
        details: { min, max },
      }),
    );
  }

  const validateQuery = (
    query: TopologyQueryIR,
    topology: TopologyKind,
    queryPath: string,
  ): void => {
    const incompatible = (required: TopologyKind, label: string): void => {
      if (topology !== required) {
        diagnostics.push(
          diagnostic(
            "TOPOLOGY_SELECTOR_INVALID",
            `${label} queries require ${required} topology`,
            { severity: "error", path: queryPath },
          ),
        );
      }
    };
    switch (query.op) {
      case "all":
        break;
      case "persistentReference": {
        if (
          !(
            (document.schema === DOCUMENT_SCHEMA_V2 &&
              document.version === DOCUMENT_VERSION_V2) ||
            (document.schema === DOCUMENT_SCHEMA_V3 &&
              document.version === DOCUMENT_VERSION_V3) ||
            (document.schema === DOCUMENT_SCHEMA_V4 &&
              document.version === DOCUMENT_VERSION_V4)
          )
        ) {
          diagnostics.push(
            diagnostic(
              "TOPOLOGY_SELECTOR_INVALID",
              "Persistent topology references require document version 2, 3, or 4",
              {
                severity: "error",
                path: `${queryPath}/reference`,
                details: { reference: query.reference },
              },
            ),
          );
          break;
        }
        const registry = document.topologyReferences;
        const reference =
          registry !== undefined && Object.hasOwn(registry, query.reference)
            ? registry[query.reference]
            : undefined;
        if (reference === undefined) {
          diagnostics.push(
            diagnostic(
              "REFERENCE_MISSING",
              `Topology query references missing persistent reference '${query.reference}'`,
              {
                severity: "error",
                path: `${queryPath}/reference`,
                details: { reference: query.reference },
              },
            ),
          );
          break;
        }
        if (reference.topology !== topology) {
          diagnostics.push(
            diagnostic(
              "TOPOLOGY_SELECTOR_INVALID",
              `Persistent topology reference '${query.reference}' selects ${reference.topology}s, not ${topology}s`,
              {
                severity: "error",
                path: `${queryPath}/reference`,
                related: [
                  {
                    message: "Persistent topology reference is declared here",
                    path: `/topologyReferences/${query.reference}/topology`,
                  },
                ],
                details: {
                  reference: query.reference,
                  expectedTopology: topology,
                  actualTopology: reference.topology,
                },
              },
            ),
          );
        }
        if (reference.target.node !== input) {
          diagnostics.push(
            diagnostic(
              "TOPOLOGY_SELECTOR_INVALID",
              `Persistent topology reference '${query.reference}' targets '${reference.target.node}', not this feature's direct input '${input}'`,
              {
                severity: "error",
                path: `${queryPath}/reference`,
                related: [
                  {
                    message: "Persistent topology reference target is declared here",
                    path: `/topologyReferences/${query.reference}/target`,
                  },
                ],
                details: {
                  reference: query.reference,
                  expectedTarget: input,
                  actualTarget: reference.target.node,
                },
              },
            ),
          );
        }
        break;
      }
      case "origin": {
        const feature = Object.hasOwn(document.nodes, query.feature)
          ? document.nodes[query.feature]
          : undefined;
        if (feature === undefined) {
          diagnostics.push(
            diagnostic(
              "REFERENCE_MISSING",
              `Topology origin references missing feature '${query.feature}'`,
              { severity: "error", path: `${queryPath}/feature` },
            ),
          );
        } else if (outputKindForNode(feature) !== "solid") {
          diagnostics.push(
            diagnostic(
              "REFERENCE_KIND_MISMATCH",
              `Topology origin '${query.feature}' does not produce a solid`,
              { severity: "error", path: `${queryPath}/feature` },
            ),
          );
        } else if (!nodeIsAncestor(document, input, query.feature)) {
          diagnostics.push(
            diagnostic(
              "TOPOLOGY_SELECTOR_INVALID",
              `Topology origin '${query.feature}' is not the input feature or one of its ancestors`,
              { severity: "error", path: `${queryPath}/feature` },
            ),
          );
        }
        if (query.role !== undefined) {
          const roleSupportedByDocument = topologyRolesForDocumentVersion(
            document.version,
          ).includes(query.role);
          const knownRule = TOPOLOGY_ROLE_RULES[query.role as TopologyRole] as
            | (typeof TOPOLOGY_ROLE_RULES)[TopologyRole]
            | undefined;
          const rule = roleSupportedByDocument ? knownRule : undefined;
          if (rule === undefined) {
            diagnostics.push(
              diagnostic(
                "TOPOLOGY_SELECTOR_INVALID",
                knownRule === undefined
                  ? `Unknown semantic topology role '${String(query.role)}'`
                  : `Semantic topology role '${String(query.role)}' is not supported by document version ${document.version}`,
                { severity: "error", path: `${queryPath}/role` },
              ),
            );
          } else if (rule.topology !== topology) {
            diagnostics.push(
              diagnostic(
                "TOPOLOGY_SELECTOR_INVALID",
                `Topology role '${query.role}' selects ${rule.topology}s, not ${topology}s`,
                { severity: "error", path: `${queryPath}/role` },
              ),
            );
          }
          if (rule !== undefined && feature !== undefined && feature.kind !== rule.producer) {
            diagnostics.push(
              diagnostic(
                "TOPOLOGY_SELECTOR_INVALID",
                `Topology role '${query.role}' is not valid for ${feature.kind} feature '${query.feature}'`,
                { severity: "error", path: `${queryPath}/role` },
              ),
            );
          }
          if (rule !== undefined && query.relation !== rule.relation) {
            diagnostics.push(
              diagnostic(
                "TOPOLOGY_SELECTOR_INVALID",
                "Semantic topology roles currently describe created topology only",
                { severity: "error", path: `${queryPath}/relation` },
              ),
            );
          }
        }
        if (query.source !== undefined) {
          const supportsLoftSources =
            document.version === DOCUMENT_VERSION_V3 ||
            document.version === DOCUMENT_VERSION_V4;
          const supportsSweepSources =
            document.version === DOCUMENT_VERSION_V4;
          const profileProducer =
            feature?.kind === "extrude" ||
            feature?.kind === "revolve" ||
            (supportsLoftSources && feature?.kind === "loft") ||
            (supportsSweepSources && feature?.kind === "sweep")
              ? feature
              : undefined;
          if (query.relation !== "created" || profileProducer === undefined) {
            diagnostics.push(
              diagnostic(
                "TOPOLOGY_SELECTOR_INVALID",
                document.version === DOCUMENT_VERSION_V4
                  ? "Sketch-entity topology sources require topology created by an extrusion, revolution, loft, or sweep"
                  : document.version === DOCUMENT_VERSION_V3
                    ? "Sketch-entity topology sources require topology created by an extrusion, revolution, or loft"
                    : "Sketch-entity topology sources require topology created by an extrusion or revolution",
                { severity: "error", path: `${queryPath}/source` },
              ),
            );
          }
          if (
            query.role !== undefined &&
            TOPOLOGY_ROLE_RULES[query.role as TopologyRole]?.source !==
              "sketch-curve"
          ) {
            diagnostics.push(
              diagnostic(
                "TOPOLOGY_SELECTOR_INVALID",
                `Topology role '${query.role}' cannot originate from one sketch boundary entity`,
                { severity: "error", path: `${queryPath}/source` },
              ),
            );
          }
          const sketch = Object.hasOwn(document.nodes, query.source.sketch)
            ? document.nodes[query.source.sketch]
            : undefined;
          if (sketch === undefined) {
            diagnostics.push(
              diagnostic(
                "REFERENCE_MISSING",
                `Topology source references missing sketch '${query.source.sketch}'`,
                { severity: "error", path: `${queryPath}/source/sketch` },
              ),
            );
          } else if (sketch.kind !== "sketch") {
            diagnostics.push(
              diagnostic(
                "REFERENCE_KIND_MISMATCH",
                `Topology source '${query.source.sketch}' is not a sketch`,
                { severity: "error", path: `${queryPath}/source/sketch` },
              ),
            );
          } else {
            const sourceEntity = Object.hasOwn(
              sketch.entities,
              query.source.entity,
            )
              ? sketch.entities[query.source.entity]
              : undefined;
            if (sourceEntity === undefined) {
              diagnostics.push(
                diagnostic(
                  "REFERENCE_MISSING",
                  `Topology source references missing sketch entity '${query.source.entity}'`,
                  { severity: "error", path: `${queryPath}/source/entity` },
                ),
              );
            } else if (
              sourceEntity.kind !== "line" &&
              sourceEntity.kind !== "arc" &&
              sourceEntity.kind !== "circle"
            ) {
              diagnostics.push(
                diagnostic(
                  "REFERENCE_KIND_MISMATCH",
                  `Topology source entity '${query.source.entity}' is not a profile curve`,
                  { severity: "error", path: `${queryPath}/source/entity` },
                ),
              );
            } else if (!profileUsesEntity(sketch, query.source.entity)) {
              diagnostics.push(
                diagnostic(
                  "TOPOLOGY_SELECTOR_INVALID",
                  `Topology source entity '${query.source.entity}' is not used by sketch '${query.source.sketch}' profile boundary`,
                  { severity: "error", path: `${queryPath}/source/entity` },
                ),
              );
            }
            if (
              profileProducer !== undefined &&
              !(profileProducer.kind === "loft"
                ? profileProducer.profiles.some(
                    (profile) => profile.node === query.source!.sketch,
                  )
                : profileProducer.profile.node === query.source.sketch)
            ) {
              const sourceOwnershipMessage =
                profileProducer.kind === "loft"
                  ? `Sketch '${query.source.sketch}' is not one of the direct profiles of loft '${query.feature}'`
                  : `Sketch '${query.source.sketch}' is not the direct profile of ${
                      profileProducer.kind === "extrude"
                        ? "extrusion"
                        : profileProducer.kind === "revolve"
                          ? "revolution"
                          : "sweep"
                    } '${query.feature}'`;
              diagnostics.push(
                diagnostic(
                  "TOPOLOGY_SELECTOR_INVALID",
                  sourceOwnershipMessage,
                  { severity: "error", path: `${queryPath}/source/sketch` },
                ),
              );
            }
            if (!nodeIsAncestor(document, query.feature, query.source.sketch)) {
              diagnostics.push(
                diagnostic(
                  "TOPOLOGY_SELECTOR_INVALID",
                  `Sketch '${query.source.sketch}' is not an ancestor of topology origin '${query.feature}'`,
                  { severity: "error", path: `${queryPath}/source/sketch` },
                ),
              );
            }
          }
        }
        break;
      }
      case "surface":
        incompatible("face", "Surface");
        break;
      case "curve":
        incompatible("edge", "Curve");
        break;
      case "normal":
      case "direction":
        incompatible(query.op === "normal" ? "face" : "edge", query.op === "normal" ? "Normal" : "Direction");
        query.value.forEach((value, index) =>
          validateExpression(value, "scalar", document, `${queryPath}/value/${index}`, diagnostics),
        );
        validateExpression(
          query.tolerance,
          "angle",
          document,
          `${queryPath}/tolerance`,
          diagnostics,
        );
        break;
      case "radius":
        validateExpression(query.value, "length", document, `${queryPath}/value`, diagnostics);
        validateExpression(
          query.tolerance,
          "length",
          document,
          `${queryPath}/tolerance`,
          diagnostics,
        );
        break;
      case "adjacentTo":
        if (query.selection.topology === topology) {
          diagnostics.push(
            diagnostic(
              "TOPOLOGY_SELECTOR_INVALID",
              "Adjacent topology selection must target the opposite topology kind",
              { severity: "error", path: `${queryPath}/selection/topology` },
            ),
          );
        }
        validateTopologySelection(
          query.selection,
          topology === "edge" ? "face" : "edge",
          input,
          document,
          `${queryPath}/selection`,
          diagnostics,
        );
        break;
      case "and":
      case "or":
        if (query.queries.length === 0) {
          diagnostics.push(
            diagnostic(
              "TOPOLOGY_SELECTOR_INVALID",
              `Topology '${query.op}' query requires at least one operand`,
              { severity: "error", path: `${queryPath}/queries` },
            ),
          );
        }
        query.queries.forEach((child, index) =>
          validateQuery(child, topology, `${queryPath}/queries/${index}`),
        );
        break;
      case "not":
        validateQuery(query.query, topology, `${queryPath}/query`);
        break;
    }
  };

  validateQuery(selection.query, selection.topology, `${path}/query`);
}

function validateNode(
  id: NodeId,
  node: NodeIR,
  document: DesignDocument,
  diagnostics: Diagnostic[],
): void {
  const path = `/nodes/${id}`;
  const expression = (
    value: ExpressionIR,
    dimension: Dimension,
    suffix: string,
  ): void => validateExpression(value, dimension, document, `${path}/${suffix}`, diagnostics);
  switch (node.kind) {
    case "box":
      node.size.forEach((value, index) => expression(value, "length", `size/${index}`));
      break;
    case "cylinder":
      expression(node.height, "length", "height");
      expression(node.radiusBottom, "length", "radiusBottom");
      expression(node.radiusTop, "length", "radiusTop");
      break;
    case "sphere":
      expression(node.radius, "length", "radius");
      break;
    case "sketch":
      validateSketch(node, document, path, diagnostics);
      break;
    case "polylinePath":
      if (node.points.length < 2) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "A polyline path requires at least two ordered points",
            { severity: "error", node: id, path: `${path}/points` },
          ),
        );
      }
      if (node.closed !== false) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Document polyline paths must be open",
            { severity: "error", node: id, path: `${path}/closed` },
          ),
        );
      }
      node.points.forEach((point, pointIndex) =>
        point.forEach((value, coordinateIndex) =>
          expression(
            value,
            "length",
            `points/${pointIndex}/${coordinateIndex}`,
          ),
        ),
      );
      if (!Number.isFinite(node.tolerance) || !(node.tolerance > 0)) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Polyline path tolerance must be finite and positive",
            { severity: "error", node: id, path: `${path}/tolerance` },
          ),
        );
      }
      break;
    case "circularArcPath":
      for (const [pointName, point] of [
        ["start", node.start],
        ["through", node.through],
        ["end", node.end],
      ] as const) {
        point.forEach((value, coordinateIndex) =>
          expression(value, "length", `${pointName}/${coordinateIndex}`),
        );
      }
      if (node.closed !== false) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Document circular-arc paths must be open",
            { severity: "error", node: id, path: `${path}/closed` },
          ),
        );
      }
      if (!Number.isFinite(node.tolerance) || !(node.tolerance > 0)) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Circular-arc path tolerance must be finite and positive",
            { severity: "error", node: id, path: `${path}/tolerance` },
          ),
        );
      }
      break;
    case "compositePath":
      if (node.segments.length < 2) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "A composite path requires at least two ordered segments",
            { severity: "error", node: id, path: `${path}/segments` },
          ),
        );
      }
      if (!node.segments.some((segment) => segment.kind === "circularArc")) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "A composite path requires at least one circular-arc segment; use polylinePath for line-only paths",
            { severity: "error", node: id, path: `${path}/segments` },
          ),
        );
      }
      node.start.forEach((value, coordinateIndex) =>
        expression(value, "length", `start/${coordinateIndex}`),
      );
      node.segments.forEach((segment, segmentIndex) => {
        if (segment.kind === "circularArc") {
          segment.through.forEach((value, coordinateIndex) =>
            expression(
              value,
              "length",
              `segments/${segmentIndex}/through/${coordinateIndex}`,
            ),
          );
        }
        segment.end.forEach((value, coordinateIndex) =>
          expression(
            value,
            "length",
            `segments/${segmentIndex}/end/${coordinateIndex}`,
          ),
        );
      });
      if (node.closed !== false) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Document composite paths must be open",
            { severity: "error", node: id, path: `${path}/closed` },
          ),
        );
      }
      if (!Number.isFinite(node.tolerance) || !(node.tolerance > 0)) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Composite path tolerance must be finite and positive",
            { severity: "error", node: id, path: `${path}/tolerance` },
          ),
        );
      }
      break;
    case "extrude":
      validateRef(node.profile, "profile", document, `${path}/profile`, diagnostics);
      expression(node.distance, "length", "distance");
      expression(node.twist, "angle", "twist");
      node.scaleTop.forEach((value, index) =>
        expression(value, "scalar", `scaleTop/${index}`),
      );
      break;
    case "revolve":
      validateRef(node.profile, "profile", document, `${path}/profile`, diagnostics);
      expression(node.angle, "angle", "angle");
      break;
    case "loft": {
      if (node.profiles.length < 2) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Loft requires at least two ordered profiles",
            { severity: "error", node: id, path: `${path}/profiles` },
          ),
        );
      }
      const duplicateProfileIndex = node.profiles.findIndex(
        (profile, index) =>
          node.profiles.findIndex((candidate) => candidate.node === profile.node) <
          index,
      );
      if (duplicateProfileIndex !== -1) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Loft requires distinct ordered profiles",
            {
              severity: "error",
              node: id,
              path: `${path}/profiles/${duplicateProfileIndex}`,
              details: { reason: "duplicate-profile" },
            },
          ),
        );
      }
      node.profiles.forEach((profile, index) =>
        validateRef(
          profile,
          "profile",
          document,
          `${path}/profiles/${index}`,
          diagnostics,
        ),
      );
      if (node.ruled !== true) {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Document lofts must be ruled",
            { severity: "error", node: id, path: `${path}/ruled` },
          ),
        );
      }
      break;
    }
    case "sweep":
      validateRef(node.profile, "profile", document, `${path}/profile`, diagnostics);
      validateRef(node.path, "path", document, `${path}/path`, diagnostics);
      if (node.transition !== "right-corner") {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Document sweeps require right-corner transitions",
            { severity: "error", node: id, path: `${path}/transition` },
          ),
        );
      }
      if (node.frame !== "corrected-frenet") {
        diagnostics.push(
          diagnostic(
            "FEATURE_INVALID",
            "Document sweeps require a corrected-Frenet frame",
            { severity: "error", node: id, path: `${path}/frame` },
          ),
        );
      }
      break;
    case "boolean":
      validateRef(node.target, "solid", document, `${path}/target`, diagnostics);
      node.tools.forEach((tool, index) =>
        validateRef(tool, "solid", document, `${path}/tools/${index}`, diagnostics),
      );
      break;
    case "transform":
      validateRef(node.input, "solid", document, `${path}/input`, diagnostics);
      node.operations.forEach((operation, index) =>
        validateTransform(operation, document, `${path}/operations/${index}`, diagnostics),
      );
      break;
    case "fillet":
      validateRef(node.input, "solid", document, `${path}/input`, diagnostics);
      validateTopologySelection(
        node.edges,
        "edge",
        node.input.node,
        document,
        `${path}/edges`,
        diagnostics,
      );
      expression(node.radius, "length", "radius");
      break;
    case "chamfer":
      validateRef(node.input, "solid", document, `${path}/input`, diagnostics);
      validateTopologySelection(
        node.edges,
        "edge",
        node.input.node,
        document,
        `${path}/edges`,
        diagnostics,
      );
      expression(node.distance, "length", "distance");
      break;
    case "shell":
      validateRef(node.input, "solid", document, `${path}/input`, diagnostics);
      validateTopologySelection(
        node.openings,
        "face",
        node.input.node,
        document,
        `${path}/openings`,
        diagnostics,
      );
      expression(node.thickness, "length", "thickness");
      if (!SHELL_DIRECTIONS.includes(node.direction)) {
        diagnostics.push(
          diagnostic(
            "IR_INVALID",
            "Shell direction must be 'inward' or 'outward'",
            {
              severity: "error",
              node: id,
              path: `${path}/direction`,
              details: { direction: node.direction },
            },
          ),
        );
      }
      expression(node.tolerance, "length", "tolerance");
      break;
    case "offset":
      validateRef(node.input, "solid", document, `${path}/input`, diagnostics);
      expression(node.distance, "length", "distance");
      if (!OFFSET_DIRECTIONS.includes(node.direction)) {
        diagnostics.push(
          diagnostic(
            "IR_INVALID",
            "Offset direction must be 'outward' or 'inward'",
            {
              severity: "error",
              node: id,
              path: `${path}/direction`,
              details: { direction: node.direction },
            },
          ),
        );
      }
      expression(node.tolerance, "length", "tolerance");
      break;
    case "draft":
      validateRef(node.input, "solid", document, `${path}/input`, diagnostics);
      validateTopologySelection(
        node.faces,
        "face",
        node.input.node,
        document,
        `${path}/faces`,
        diagnostics,
      );
      expression(node.angle, "angle", "angle");
      node.pullDirection.forEach((value, index) =>
        expression(value, "scalar", `pullDirection/${index}`),
      );
      node.neutralPlane.origin.forEach((value, index) =>
        expression(value, "length", `neutralPlane/origin/${index}`),
      );
      node.neutralPlane.normal.forEach((value, index) =>
        expression(value, "scalar", `neutralPlane/normal/${index}`),
      );
      break;
    case "part":
      validateRef(node.solid, "solid", document, `${path}/solid`, diagnostics);
      if (node.material !== undefined && node.materialId !== undefined) {
        diagnostics.push(
          diagnostic(
            "IR_INVALID",
            "A part cannot use both the legacy material label and materialId",
            { severity: "error", node: id, path },
          ),
        );
      }
      if (
        node.materialId !== undefined &&
        !Object.hasOwn(document.materials ?? {}, node.materialId)
      ) {
        diagnostics.push(
          diagnostic(
            "REFERENCE_MISSING",
            `Part references missing material '${node.materialId}'`,
            {
              severity: "error",
              node: id,
              path: `${path}/materialId`,
              details: { materialId: node.materialId },
            },
          ),
        );
      }
      if (node.massDensity !== undefined) {
        validateExpression(
          node.massDensity,
          "massDensity",
          document,
          `${path}/massDensity`,
          diagnostics,
        );
      }
      break;
    case "assembly":
      node.instances.forEach((instance, index) => {
        validateRef(
          instance.component,
          ["part", "assembly"],
          document,
          `${path}/instances/${index}/component`,
          diagnostics,
        );
        instance.placement.forEach((operation, operationIndex) =>
          validateTransform(
            operation,
            document,
            `${path}/instances/${index}/placement/${operationIndex}`,
            diagnostics,
          ),
        );
      });
      break;
  }
}

function validateTopologyReferences(
  document: DesignDocument,
  diagnostics: Diagnostic[],
): void {
  const documentIdentity = document as {
    readonly schema: unknown;
    readonly version: unknown;
  };
  const schema = documentIdentity.schema;
  const version = documentIdentity.version;
  const isVersion1 =
    schema === DOCUMENT_SCHEMA_V1 && version === DOCUMENT_VERSION_V1;
  const isVersion2 =
    schema === DOCUMENT_SCHEMA_V2 && version === DOCUMENT_VERSION_V2;
  const isVersion3 =
    schema === DOCUMENT_SCHEMA_V3 && version === DOCUMENT_VERSION_V3;
  const isVersion4 =
    schema === DOCUMENT_SCHEMA_V4 && version === DOCUMENT_VERSION_V4;
  if (!isVersion1 && !isVersion2 && !isVersion3 && !isVersion4) {
    diagnostics.push(
      diagnostic(
        "IR_INVALID",
        "Document schema and version must identify the same supported document grammar",
        {
          severity: "error",
          path: "/",
          details: {
            schema,
            version,
            supported: [
              { schema: DOCUMENT_SCHEMA_V1, version: DOCUMENT_VERSION_V1 },
              { schema: DOCUMENT_SCHEMA_V2, version: DOCUMENT_VERSION_V2 },
              { schema: DOCUMENT_SCHEMA_V3, version: DOCUMENT_VERSION_V3 },
              { schema: DOCUMENT_SCHEMA_V4, version: DOCUMENT_VERSION_V4 },
            ],
          },
        },
      ),
    );
  }

  const topologyReferences = (
    document as DesignDocument & {
      readonly topologyReferences?: Readonly<
        Record<TopologyReferenceId, TopologyReferenceEntryIR>
      >;
    }
  ).topologyReferences;
  if (topologyReferences === undefined) return;
  if (!isVersion2 && !isVersion3 && !isVersion4) {
    diagnostics.push(
      diagnostic(
        "IR_INVALID",
        "Persistent topology reference registries require document version 2, 3, or 4",
        { severity: "error", path: "/topologyReferences" },
      ),
    );
    return;
  }
  const allowedTopologyRoles = topologyRolesForDocumentVersion(
    document.version,
  );

  const entries = Object.entries(topologyReferences) as [
    TopologyReferenceId,
    TopologyReferenceEntryIR,
  ][];
  if (entries.length === 0) {
    diagnostics.push(
      diagnostic(
        "IR_INVALID",
        "A persistent topology reference registry cannot be empty",
        { severity: "error", path: "/topologyReferences" },
      ),
    );
  }
  for (const [id, entry] of entries) {
    const path = `/topologyReferences/${id}`;
    validateRef(entry.target, "solid", document, `${path}/target`, diagnostics);
    if (entry.topology !== "face" && entry.topology !== "edge") {
      diagnostics.push(
        diagnostic(
          "TOPOLOGY_SELECTOR_INVALID",
          `Persistent topology reference '${id}' has an unsupported topology kind`,
          {
            severity: "error",
            path: `${path}/topology`,
            details: { topology: entry.topology },
          },
        ),
      );
    }
    if (!Array.isArray(entry.variants) || entry.variants.length === 0) {
      diagnostics.push(
        diagnostic(
          "TOPOLOGY_SIGNATURE_INVALID",
          `Persistent topology reference '${id}' requires at least one fingerprint variant`,
          { severity: "error", path: `${path}/variants` },
        ),
      );
      continue;
    }
    const fingerprints = new Set<string>();
    for (let index = 0; index < entry.variants.length; index += 1) {
      const variantPath = `${path}/variants/${index}`;
      if (!Object.hasOwn(entry.variants, index)) {
        diagnostics.push(
          diagnostic(
            "TOPOLOGY_SIGNATURE_INVALID",
            `Persistent topology reference '${id}' variants cannot be sparse`,
            { severity: "error", path: variantPath },
          ),
        );
        continue;
      }
      const variant = entry.variants[index]!;
      const normalized = normalizePersistentTopologyReference(variant);
      if (!normalized.ok) {
        diagnostics.push(
          ...normalized.diagnostics.map((item) => ({
            ...item,
            severity: "error" as const,
            path:
              item.path === undefined
                ? variantPath
                : `${variantPath}${item.path}`,
          })),
        );
        continue;
      }
      normalized.value.lineage.forEach((lineage, lineageIndex) => {
        if (
          lineage.role !== undefined &&
          !allowedTopologyRoles.includes(lineage.role)
        ) {
          diagnostics.push(
            diagnostic(
              "TOPOLOGY_SIGNATURE_INVALID",
              `Semantic topology role '${lineage.role}' is not supported by document version ${document.version}`,
              {
                severity: "error",
                path: `${variantPath}/lineage/${lineageIndex}/role`,
              },
            ),
          );
        }
      });
      normalized.value.adjacency.forEach((neighbor, neighborIndex) => {
        neighbor.lineage.forEach((lineage, lineageIndex) => {
          if (
            lineage.role !== undefined &&
            !allowedTopologyRoles.includes(lineage.role)
          ) {
            diagnostics.push(
              diagnostic(
                "TOPOLOGY_SIGNATURE_INVALID",
                `Semantic topology role '${lineage.role}' is not supported by document version ${document.version}`,
                {
                  severity: "error",
                  path: `${variantPath}/adjacency/${neighborIndex}/lineage/${lineageIndex}/role`,
                },
              ),
            );
          }
        });
      });
      if (normalized.value.topology !== entry.topology) {
        diagnostics.push(
          diagnostic(
            "TOPOLOGY_SIGNATURE_INVALID",
            `Persistent topology variant selects ${normalized.value.topology}s, not ${entry.topology}s`,
            {
              severity: "error",
              path: `${variantPath}/topology`,
              details: {
                expectedTopology: entry.topology,
                actualTopology: normalized.value.topology,
              },
            },
          ),
        );
      }
      const fingerprint = `${normalized.value.protocolVersion}:${normalized.value.kernelFingerprint}`;
      if (fingerprints.has(fingerprint)) {
        diagnostics.push(
          diagnostic(
            "TOPOLOGY_SIGNATURE_INVALID",
            `Persistent topology reference '${id}' has duplicate variants for the same kernel fingerprint`,
            {
              severity: "error",
              path: variantPath,
              details: {
                protocolVersion: normalized.value.protocolVersion,
                kernelFingerprint: normalized.value.kernelFingerprint,
              },
            },
          ),
        );
      }
      fingerprints.add(fingerprint);
    }
  }
}

function detectGraphCycles(
  document: DesignDocument,
  diagnostics: Diagnostic[],
): void {
  const states = new Map<NodeId, "visiting" | "visited">();
  const stack: NodeId[] = [];
  const visit = (id: NodeId): void => {
    const state = states.get(id);
    if (state === "visited") return;
    if (state === "visiting") {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      diagnostics.push(
        diagnostic("GRAPH_CYCLE", `Feature graph contains a cycle: ${cycle.join(" -> ")}`, {
          severity: "error",
          node: id,
          path: `/nodes/${id}`,
        }),
      );
      return;
    }
    const node = Object.hasOwn(document.nodes, id)
      ? document.nodes[id]
      : undefined;
    if (node === undefined) return;
    states.set(id, "visiting");
    stack.push(id);
    for (const dependency of nodeDependencies(node)) visit(dependency.node);
    stack.pop();
    states.set(id, "visited");
  };
  for (const id of Object.keys(document.nodes) as NodeId[]) visit(id);
}

export function validateDocument(
  document: DesignDocument,
): CadResult<DesignDocument> {
  const diagnostics: Diagnostic[] = [];
  validateTopologyReferences(document, diagnostics);
  const usesMassDensity =
    Object.values(document.parameters).some(
      (parameter) => parameter.dimension === "massDensity",
    ) ||
    Object.keys(document.materials ?? {}).length > 0 ||
    Object.values(document.nodes).some(
      (node) => node.kind === "part" && node.massDensity !== undefined,
    );
  if (usesMassDensity && document.units.mass !== "kg") {
    diagnostics.push(
      diagnostic(
        "IR_INVALID",
        "Documents with mass density must declare kilograms as their mass unit",
        { severity: "error", path: "/units/mass" },
      ),
    );
  }
  for (const [id, parameter] of Object.entries(document.parameters) as [
    ParameterId,
    DesignDocument["parameters"][ParameterId],
  ][]) {
    const path = `/parameters/${id}`;
    validateExpression(parameter.default, parameter.dimension, document, `${path}/default`, diagnostics);
    if (parameter.min !== undefined) {
      validateExpression(parameter.min, parameter.dimension, document, `${path}/min`, diagnostics);
    }
    if (parameter.max !== undefined) {
      validateExpression(parameter.max, parameter.dimension, document, `${path}/max`, diagnostics);
    }
  }
  for (const [id, material] of Object.entries(document.materials ?? {}) as [
    MaterialId,
    NonNullable<DesignDocument["materials"]>[MaterialId],
  ][]) {
    validateExpression(
      material.massDensity,
      "massDensity",
      document,
      `/materials/${id}/massDensity`,
      diagnostics,
    );
  }
  for (const [id, configuration] of Object.entries(
    document.configurations ?? {},
  ) as [ConfigurationId, DesignConfigurationIR][]) {
    validateConfiguration(id, configuration, document, diagnostics);
  }
  for (const [id, node] of Object.entries(document.nodes) as [NodeId, NodeIR][]) {
    validateNode(id, node, document, diagnostics);
  }
  for (const [name, output] of Object.entries(document.outputs)) {
    validateRef(
      output,
      ["solid", "part", "assembly"],
      document,
      `/outputs/${name}`,
      diagnostics,
    );
  }
  detectGraphCycles(document, diagnostics);
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };
  return success(document, diagnostics);
}
