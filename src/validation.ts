import type { EntityId, NodeId, ParameterId } from "./core/ids.js";
import {
  diagnostic,
  hasErrors,
  success,
  type CadResult,
  type Diagnostic,
} from "./core/result.js";
import type { Dimension, ExpressionIR } from "./expressions.js";
import {
  nodeDependencies,
  outputKindForNode,
  type DesignDocument,
  type NodeIR,
  type OutputKind,
  type RefIR,
  type SketchLoopIR,
  type SketchNodeIR,
  type TransformOperationIR,
} from "./ir.js";

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

function validateRef(
  reference: RefIR,
  expected: OutputKind | readonly OutputKind[],
  document: DesignDocument,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const target = document.nodes[reference.node];
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
    case "part":
      validateRef(node.solid, "solid", document, `${path}/solid`, diagnostics);
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
    const node = document.nodes[id];
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
  for (const [id, node] of Object.entries(document.nodes) as [NodeId, NodeIR][]) {
    validateNode(id, node, document, diagnostics);
  }
  for (const [name, output] of Object.entries(document.outputs)) {
    validateRef(output, output.kind, document, `/outputs/${name}`, diagnostics);
  }
  detectGraphCycles(document, diagnostics);
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };
  return success(document, diagnostics);
}
