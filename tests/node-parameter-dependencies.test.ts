import { describe, expect, expectTypeOf, it } from "vitest";
import {
  NODE_KINDS,
  nodeParameterDependencies,
  type ExpressionIR,
  type NodeIR,
  type TopologyKind,
  type TopologySelectionIR,
} from "../src/index.js";
import {
  entityId,
  nodeId,
  parameterId,
  topologyReferenceId,
  type ParameterId,
} from "../src/core/ids.js";

type ExpressionDimension = ExpressionIR["dimension"];

function parameter(
  id: string,
  dimension: ExpressionDimension = "length",
): ExpressionIR {
  return { op: "parameter", id: parameterId(id), dimension };
}

function literal(dimension: ExpressionDimension = "length"): ExpressionIR {
  return { op: "literal", dimension, value: 1 };
}

function vector(
  prefix: string,
  dimension: ExpressionDimension = "length",
): readonly [ExpressionIR, ExpressionIR, ExpressionIR] {
  return [
    parameter(`${prefix}.z`, dimension),
    parameter(`${prefix}.a`, dimension),
    parameter(`${prefix}.z`, dimension),
  ];
}

function vectorIds(prefix: string): readonly string[] {
  return [`${prefix}.a`, `${prefix}.z`];
}

function expected(...ids: readonly string[]): readonly ParameterId[] {
  return [...new Set(ids)].sort().map(parameterId);
}

function nestedSelection<K extends TopologyKind>(
  topology: K,
  prefix: string,
): TopologySelectionIR<K> {
  return {
    topology,
    cardinality: { min: 1 },
    query: {
      op: "and",
      queries: [
        {
          op: "normal",
          value: vector(`${prefix}.normal`, "scalar"),
          tolerance: parameter(`${prefix}.normalTolerance`, "scalar"),
        },
        {
          op: "or",
          queries: [
            {
              op: "radius",
              value: parameter(`${prefix}.radius`),
              tolerance: parameter(`${prefix}.radiusTolerance`),
            },
            { op: "all" },
            { op: "surface", kind: "plane" },
            { op: "curve", kind: "line" },
            {
              op: "origin",
              feature: nodeId("sourceFeature"),
              relation: "created",
            },
            {
              op: "persistentReference",
              reference: topologyReferenceId("storedTopology"),
            },
          ],
        },
        {
          op: "adjacentTo",
          selection: {
            topology: "vertex",
            cardinality: { min: 1 },
            query: {
              op: "position",
              value: vector(`${prefix}.position`),
              tolerance: parameter(`${prefix}.positionTolerance`),
            },
          },
        },
        {
          op: "not",
          query: {
            op: "direction",
            value: vector(`${prefix}.direction`, "scalar"),
            tolerance: parameter(`${prefix}.directionTolerance`, "scalar"),
          },
        },
      ],
    },
  };
}

function selectionIds(prefix: string): readonly string[] {
  return [
    ...vectorIds(`${prefix}.normal`),
    `${prefix}.normalTolerance`,
    `${prefix}.radius`,
    `${prefix}.radiusTolerance`,
    ...vectorIds(`${prefix}.position`),
    `${prefix}.positionTolerance`,
    ...vectorIds(`${prefix}.direction`),
    `${prefix}.directionTolerance`,
  ];
}

interface DependencyCase {
  readonly node: NodeIR;
  readonly expected: readonly ParameterId[];
}

const sketchPoint = entityId("sketchPoint");
const sketchLine = entityId("sketchLine");
const sketchCircle = entityId("sketchCircle");
const sketchArc = entityId("sketchArc");

const cases: readonly DependencyCase[] = [
  {
    node: {
      kind: "box",
      size: [
        {
          op: "add",
          dimension: "length",
          left: parameter("box.z"),
          right: parameter("box.a"),
        },
        parameter("box.z"),
        literal(),
      ],
      center: false,
    },
    expected: expected("box.a", "box.z"),
  },
  {
    node: {
      kind: "cylinder",
      height: parameter("cylinder.height"),
      radiusBottom: parameter("cylinder.bottom"),
      radiusTop: parameter("cylinder.top"),
      center: false,
    },
    expected: expected(
      "cylinder.height",
      "cylinder.bottom",
      "cylinder.top",
    ),
  },
  {
    node: { kind: "sphere", radius: parameter("sphere.radius") },
    expected: expected("sphere.radius"),
  },
  {
    node: {
      kind: "sketch",
      plane: {
        type: "principal",
        plane: "XY",
        origin: vector("sketch.origin"),
      },
      entities: {
        [sketchPoint]: {
          kind: "point",
          x: parameter("sketch.pointX"),
          y: parameter("sketch.pointY"),
        },
        [sketchLine]: {
          kind: "line",
          start: sketchPoint,
          end: sketchPoint,
        },
        [sketchCircle]: {
          kind: "circle",
          center: sketchPoint,
          radius: parameter("sketch.circleRadius"),
        },
        [sketchArc]: {
          kind: "arc",
          center: sketchPoint,
          radius: parameter("sketch.arcRadius"),
          startAngle: parameter("sketch.arcStart", "angle"),
          endAngle: parameter("sketch.arcEnd", "angle"),
          clockwise: false,
        },
      },
      constraints: {
        [entityId("distanceConstraint")]: {
          kind: "distance",
          first: sketchPoint,
          second: sketchPoint,
          value: parameter("sketch.distance"),
        },
        [entityId("distanceXConstraint")]: {
          kind: "distanceX",
          first: sketchPoint,
          second: sketchPoint,
          value: parameter("sketch.distanceX"),
        },
        [entityId("distanceYConstraint")]: {
          kind: "distanceY",
          first: sketchPoint,
          second: sketchPoint,
          value: parameter("sketch.distanceY"),
        },
        [entityId("lengthConstraint")]: {
          kind: "length",
          entity: sketchLine,
          value: parameter("sketch.length"),
        },
        [entityId("angleConstraint")]: {
          kind: "angle",
          first: sketchLine,
          second: sketchLine,
          value: parameter("sketch.angle", "angle"),
        },
        [entityId("radiusConstraint")]: {
          kind: "radius",
          entity: sketchCircle,
          value: parameter("sketch.radius"),
        },
        [entityId("diameterConstraint")]: {
          kind: "diameter",
          entity: sketchCircle,
          value: parameter("sketch.diameter"),
        },
        [entityId("coincidentConstraint")]: {
          kind: "coincident",
          first: sketchPoint,
          second: sketchPoint,
        },
        [entityId("horizontalConstraint")]: {
          kind: "horizontal",
          entity: sketchLine,
        },
        [entityId("verticalConstraint")]: {
          kind: "vertical",
          entity: sketchLine,
        },
        [entityId("fixedConstraint")]: { kind: "fixed", entity: sketchLine },
        [entityId("parallelConstraint")]: {
          kind: "parallel",
          first: sketchLine,
          second: sketchLine,
        },
        [entityId("perpendicularConstraint")]: {
          kind: "perpendicular",
          first: sketchLine,
          second: sketchLine,
        },
        [entityId("equalLengthConstraint")]: {
          kind: "equalLength",
          first: sketchLine,
          second: sketchLine,
        },
        [entityId("equalRadiusConstraint")]: {
          kind: "equalRadius",
          first: sketchCircle,
          second: sketchCircle,
        },
        [entityId("midpointConstraint")]: {
          kind: "midpoint",
          point: sketchPoint,
          line: sketchLine,
        },
        [entityId("tangentConstraint")]: {
          kind: "tangent",
          line: sketchLine,
          circle: sketchCircle,
        },
      },
      profile: {
        outer: { kind: "circle", entity: sketchCircle },
        holes: [],
      },
      tolerance: 1e-7,
    },
    expected: expected(
      ...vectorIds("sketch.origin"),
      "sketch.pointX",
      "sketch.pointY",
      "sketch.circleRadius",
      "sketch.arcRadius",
      "sketch.arcStart",
      "sketch.arcEnd",
      "sketch.distance",
      "sketch.distanceX",
      "sketch.distanceY",
      "sketch.length",
      "sketch.angle",
      "sketch.radius",
      "sketch.diameter",
    ),
  },
  {
    node: {
      kind: "polylinePath",
      points: [vector("polyline.first"), vector("polyline.second")],
      closed: false,
      tolerance: 1e-7,
    },
    expected: expected(
      ...vectorIds("polyline.first"),
      ...vectorIds("polyline.second"),
    ),
  },
  {
    node: {
      kind: "circularArcPath",
      start: vector("arcPath.start"),
      through: vector("arcPath.through"),
      end: vector("arcPath.end"),
      closed: false,
      tolerance: 1e-7,
    },
    expected: expected(
      ...vectorIds("arcPath.start"),
      ...vectorIds("arcPath.through"),
      ...vectorIds("arcPath.end"),
    ),
  },
  {
    node: {
      kind: "compositePath",
      start: vector("composite.start"),
      segments: [
        { kind: "line", end: vector("composite.lineEnd") },
        {
          kind: "circularArc",
          through: vector("composite.arcThrough"),
          end: vector("composite.arcEnd"),
        },
      ],
      closed: false,
      tolerance: 1e-7,
    },
    expected: expected(
      ...vectorIds("composite.start"),
      ...vectorIds("composite.lineEnd"),
      ...vectorIds("composite.arcThrough"),
      ...vectorIds("composite.arcEnd"),
    ),
  },
  {
    node: {
      kind: "extrude",
      profile: { node: nodeId("profile"), kind: "profile" },
      distance: parameter("extrude.distance"),
      symmetric: false,
      twist: parameter("extrude.twist", "angle"),
      scaleTop: [
        parameter("extrude.scaleX", "scalar"),
        parameter("extrude.scaleY", "scalar"),
      ],
      divisions: 1,
    },
    expected: expected(
      "extrude.distance",
      "extrude.twist",
      "extrude.scaleX",
      "extrude.scaleY",
    ),
  },
  {
    node: {
      kind: "revolve",
      profile: { node: nodeId("profile"), kind: "profile" },
      angle: parameter("revolve.angle", "angle"),
    },
    expected: expected("revolve.angle"),
  },
  {
    node: {
      kind: "loft",
      profiles: [
        { node: nodeId("profileA"), kind: "profile" },
        { node: nodeId("profileB"), kind: "profile" },
      ],
      ruled: true,
    },
    expected: [],
  },
  {
    node: {
      kind: "sweep",
      profile: { node: nodeId("profile"), kind: "profile" },
      path: { node: nodeId("path"), kind: "path" },
      transition: "right-corner",
      frame: "corrected-frenet",
    },
    expected: [],
  },
  {
    node: {
      kind: "boolean",
      operation: "union",
      target: { node: nodeId("target"), kind: "solid" },
      tools: [{ node: nodeId("tool"), kind: "solid" }],
    },
    expected: [],
  },
  {
    node: {
      kind: "transform",
      input: { node: nodeId("solid"), kind: "solid" },
      operations: [
        { kind: "translate", value: vector("transform.translate") },
        { kind: "rotate", value: vector("transform.rotate", "angle") },
        { kind: "scale", value: vector("transform.scale", "scalar") },
        { kind: "mirror", normal: vector("transform.mirror", "scalar") },
      ],
    },
    expected: expected(
      ...vectorIds("transform.translate"),
      ...vectorIds("transform.rotate"),
      ...vectorIds("transform.scale"),
      ...vectorIds("transform.mirror"),
    ),
  },
  {
    node: {
      kind: "fillet",
      input: { node: nodeId("solid"), kind: "solid" },
      edges: nestedSelection("edge", "fillet.selection"),
      radius: parameter("fillet.radius"),
    },
    expected: expected(...selectionIds("fillet.selection"), "fillet.radius"),
  },
  {
    node: {
      kind: "chamfer",
      input: { node: nodeId("solid"), kind: "solid" },
      edges: nestedSelection("edge", "chamfer.selection"),
      distance: parameter("chamfer.distance"),
    },
    expected: expected(
      ...selectionIds("chamfer.selection"),
      "chamfer.distance",
    ),
  },
  {
    node: {
      kind: "shell",
      input: { node: nodeId("solid"), kind: "solid" },
      openings: nestedSelection("face", "shell.selection"),
      thickness: parameter("shell.thickness"),
      direction: "inward",
      tolerance: parameter("shell.tolerance"),
    },
    expected: expected(
      ...selectionIds("shell.selection"),
      "shell.thickness",
      "shell.tolerance",
    ),
  },
  {
    node: {
      kind: "offset",
      input: { node: nodeId("solid"), kind: "solid" },
      distance: parameter("offset.distance"),
      direction: "outward",
      tolerance: parameter("offset.tolerance"),
    },
    expected: expected("offset.distance", "offset.tolerance"),
  },
  {
    node: {
      kind: "draft",
      input: { node: nodeId("solid"), kind: "solid" },
      faces: nestedSelection("face", "draft.selection"),
      angle: parameter("draft.angle", "angle"),
      pullDirection: vector("draft.pullDirection", "scalar"),
      neutralPlane: {
        origin: vector("draft.neutralOrigin"),
        normal: vector("draft.neutralNormal", "scalar"),
      },
    },
    expected: expected(
      ...selectionIds("draft.selection"),
      "draft.angle",
      ...vectorIds("draft.pullDirection"),
      ...vectorIds("draft.neutralOrigin"),
      ...vectorIds("draft.neutralNormal"),
    ),
  },
  {
    node: {
      kind: "part",
      solid: { node: nodeId("solid"), kind: "solid" },
      massDensity: parameter("part.massDensity", "massDensity"),
      metadata: {
        expressionShapedJson: {
          op: "parameter",
          dimension: "massDensity",
          id: "metadata.must.not.be.a.dependency",
        },
      },
    },
    expected: expected("part.massDensity"),
  },
  {
    node: {
      kind: "assembly",
      instances: [
        {
          id: entityId("instance"),
          component: { node: nodeId("part"), kind: "part" },
          placement: [
            { kind: "translate", value: vector("assembly.translate") },
            { kind: "rotate", value: vector("assembly.rotate", "angle") },
            { kind: "scale", value: vector("assembly.scale", "scalar") },
            { kind: "mirror", normal: vector("assembly.mirror", "scalar") },
          ],
          suppressed: false,
        },
      ],
    },
    expected: expected(
      ...vectorIds("assembly.translate"),
      ...vectorIds("assembly.rotate"),
      ...vectorIds("assembly.scale"),
      ...vectorIds("assembly.mirror"),
    ),
  },
];

describe("nodeParameterDependencies", () => {
  it("covers every current node kind with sorted, unique dependencies", () => {
    expect(cases.map(({ node }) => node.kind).sort()).toEqual(
      [...NODE_KINDS].sort(),
    );
    for (const entry of cases) {
      expect(nodeParameterDependencies(entry.node), entry.node.kind).toEqual(
        entry.expected,
      );
    }
  });

  it("exports a frozen readonly ParameterId array from the package root", () => {
    const dependencies = nodeParameterDependencies(cases[0]!.node);

    expectTypeOf(dependencies).toEqualTypeOf<readonly ParameterId[]>();
    expect(Object.isFrozen(dependencies)).toBe(true);
    expect(() =>
      (dependencies as ParameterId[]).push(parameterId("mutation")),
    ).toThrow(TypeError);
  });
});
