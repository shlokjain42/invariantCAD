import { describe, expect, it } from "vitest";
import { nodeId, parameterId, resourceId } from "../src/core/ids.js";
import type { Dimension, ExpressionIR } from "../src/expressions.js";
import {
  NODE_KINDS_V7,
  nodeDependenciesV7,
  nodeParameterDependenciesV7,
  nodeResourceDependenciesV7,
  outputKindForNodeV7,
  type NodeIRV7,
  type NodeKindV7,
  type OutputKindV7,
} from "../src/ir.js";

function literal(dimension: Dimension, value = 1): ExpressionIR {
  return { op: "literal", dimension, value };
}

function parameter(dimension: Dimension, id: string): ExpressionIR {
  return {
    op: "parameter",
    dimension,
    id: parameterId(id),
  };
}

const length = literal("length");
const angle = literal("angle");
const scalar = literal("scalar");
const zeroLength = literal("length", 0);
const zeroScalar = literal("scalar", 0);
const solid = { node: nodeId("solid"), kind: "solid" } as const;
const profile = { node: nodeId("profile"), kind: "profile" } as const;
const path = { node: nodeId("path"), kind: "path" } as const;

function stagedNodes(): Readonly<Record<NodeKindV7, NodeIRV7>> {
  return {
    box: {
      kind: "box",
      size: [parameter("length", "boxSize"), length, length],
      center: false,
    },
    cylinder: {
      kind: "cylinder",
      height: length,
      radiusBottom: length,
      radiusTop: length,
      center: false,
    },
    sphere: { kind: "sphere", radius: length },
    sketch: {
      kind: "sketch",
      plane: {
        type: "datum",
        datum: { node: nodeId("datumPlane"), kind: "datumPlane" },
      },
      entities: {},
      constraints: {},
      profile: {
        outer: { kind: "circle", entity: "circle" },
        holes: [],
      },
      tolerance: 1e-7,
    },
    polylinePath: {
      kind: "polylinePath",
      points: [],
      closed: false,
      tolerance: 1e-7,
    },
    circularArcPath: {
      kind: "circularArcPath",
      start: [zeroLength, zeroLength, zeroLength],
      through: [length, length, zeroLength],
      end: [length, zeroLength, zeroLength],
      closed: false,
      tolerance: 1e-7,
    },
    compositePath: {
      kind: "compositePath",
      start: [zeroLength, zeroLength, zeroLength],
      segments: [],
      closed: false,
      tolerance: 1e-7,
    },
    extrude: {
      kind: "extrude",
      profile,
      distance: length,
      direction: "normal",
      symmetric: false,
      twist: angle,
      scaleTop: [scalar, scalar],
    },
    revolve: {
      kind: "revolve",
      profile,
      axis: {
        origin: [zeroLength, zeroLength, zeroLength],
        direction: [zeroScalar, zeroScalar, scalar],
      },
      angle,
      symmetric: false,
    },
    loft: { kind: "loft", profiles: [profile, profile], ruled: true },
    sweep: {
      kind: "sweep",
      profile,
      path,
      transition: "right-corner",
      frame: "corrected-frenet",
    },
    boolean: {
      kind: "boolean",
      operation: "union",
      target: solid,
      tools: [solid],
    },
    transform: {
      kind: "transform",
      input: solid,
      operations: [
        {
          kind: "translate",
          value: [
            parameter("length", "translation"),
            zeroLength,
            zeroLength,
          ],
        },
      ],
    },
    fillet: {
      kind: "fillet",
      input: solid,
      edges: {
        topology: "edge",
        query: { op: "all" },
        cardinality: { min: 1 },
      },
      radius: length,
    },
    chamfer: {
      kind: "chamfer",
      input: solid,
      edges: {
        topology: "edge",
        query: { op: "all" },
        cardinality: { min: 1 },
      },
      distance: length,
    },
    shell: {
      kind: "shell",
      input: solid,
      openings: {
        topology: "face",
        query: { op: "all" },
        cardinality: { min: 1 },
      },
      thickness: length,
      direction: "inward",
      tolerance: length,
    },
    offset: {
      kind: "offset",
      input: solid,
      distance: length,
      direction: "outward",
      tolerance: length,
    },
    draft: {
      kind: "draft",
      input: solid,
      faces: {
        topology: "face",
        query: { op: "all" },
        cardinality: { min: 1 },
      },
      angle,
      pullDirection: [zeroScalar, zeroScalar, scalar],
      neutralPlane: {
        origin: [zeroLength, zeroLength, zeroLength],
        normal: [zeroScalar, zeroScalar, scalar],
      },
    },
    part: {
      kind: "part",
      geometry: { node: nodeId("bodySet"), kind: "bodySet" },
      massDensity: parameter("massDensity", "partDensity"),
    },
    assembly: {
      kind: "assembly",
      instances: [
        {
          id: "local",
          component: {
            source: "local",
            reference: { node: nodeId("part"), kind: "part" },
          },
          configuration: { mode: "inherit" },
          placement: [],
          suppressed: false,
        },
        {
          id: "externalOne",
          component: {
            source: "external",
            resource: resourceId("external"),
            output: "main",
            outputKind: "part",
          },
          configuration: { mode: "base" },
          placement: [],
          suppressed: false,
        },
        {
          id: "externalTwo",
          component: {
            source: "external",
            resource: resourceId("external"),
            output: "nested",
            outputKind: "assembly",
          },
          configuration: { mode: "base" },
          placement: [],
          suppressed: false,
        },
      ],
    },
    datumPoint: {
      kind: "datumPoint",
      position: [
        parameter("length", "datumOrigin"),
        zeroLength,
        zeroLength,
      ],
    },
    datumAxis: {
      kind: "datumAxis",
      origin: [zeroLength, zeroLength, zeroLength],
      direction: [
        parameter("scalar", "axisDirection"),
        zeroScalar,
        scalar,
      ],
    },
    datumPlane: {
      kind: "datumPlane",
      origin: [zeroLength, zeroLength, zeroLength],
      xDirection: [scalar, zeroScalar, zeroScalar],
      normal: [zeroScalar, zeroScalar, scalar],
    },
    coordinateSystem: {
      kind: "coordinateSystem",
      origin: [zeroLength, zeroLength, zeroLength],
      xDirection: [scalar, zeroScalar, zeroScalar],
      yDirection: [zeroScalar, scalar, zeroScalar],
    },
    bodySet: {
      kind: "bodySet",
      bodies: [
        { id: "first", solid },
        {
          id: "second",
          solid: { node: nodeId("secondSolid"), kind: "solid" },
        },
      ],
    },
    importedBody: {
      kind: "importedBody",
      resource: resourceId("import"),
      format: "step",
      units: { mode: "from-file" },
      healing: { mode: "reader-default" },
      expected: "single-solid",
    },
  } as unknown as Readonly<Record<NodeKindV7, NodeIRV7>>;
}

describe("document-v7 dependency helpers", () => {
  it("covers every staged node kind with exact output kinds and frozen results", () => {
    const nodes = stagedNodes();
    expect(Object.keys(nodes).sort()).toEqual([...NODE_KINDS_V7].sort());
    const expectedOutputs: Readonly<Record<NodeKindV7, OutputKindV7>> = {
      box: "solid",
      cylinder: "solid",
      sphere: "solid",
      sketch: "profile",
      polylinePath: "path",
      circularArcPath: "path",
      compositePath: "path",
      extrude: "solid",
      revolve: "solid",
      loft: "solid",
      sweep: "solid",
      boolean: "solid",
      transform: "solid",
      fillet: "solid",
      chamfer: "solid",
      shell: "solid",
      offset: "solid",
      draft: "solid",
      part: "part",
      assembly: "assembly",
      datumPoint: "datumPoint",
      datumAxis: "datumAxis",
      datumPlane: "datumPlane",
      coordinateSystem: "coordinateSystem",
      bodySet: "bodySet",
      importedBody: "solid",
    };
    for (const kind of NODE_KINDS_V7) {
      const node = nodes[kind];
      expect(outputKindForNodeV7(node), kind).toBe(expectedOutputs[kind]);
      expect(Object.isFrozen(nodeDependenciesV7(node)), kind).toBe(true);
      expect(Object.isFrozen(nodeParameterDependenciesV7(node)), kind).toBe(
        true,
      );
      expect(Object.isFrozen(nodeResourceDependenciesV7(node)), kind).toBe(
        true,
      );
    }
  });

  it("separates local graph, parameter, and external resource dependencies", () => {
    const nodes = stagedNodes();
    expect(nodeDependenciesV7(nodes.sketch)).toEqual([
      { node: "datumPlane", kind: "datumPlane" },
    ]);
    expect(nodeDependenciesV7(nodes.bodySet)).toEqual([
      { node: "solid", kind: "solid" },
      { node: "secondSolid", kind: "solid" },
    ]);
    expect(nodeDependenciesV7(nodes.part)).toEqual([
      { node: "bodySet", kind: "bodySet" },
    ]);
    expect(nodeDependenciesV7(nodes.assembly)).toEqual([
      { node: "part", kind: "part" },
    ]);
    expect(nodeResourceDependenciesV7(nodes.importedBody)).toEqual(["import"]);
    expect(nodeResourceDependenciesV7(nodes.assembly)).toEqual(["external"]);

    expect(nodeParameterDependenciesV7(nodes.box)).toEqual(["boxSize"]);
    expect(nodeParameterDependenciesV7(nodes.transform)).toEqual([
      "translation",
    ]);
    expect(nodeParameterDependenciesV7(nodes.part)).toEqual(["partDensity"]);
    expect(nodeParameterDependenciesV7(nodes.datumPoint)).toEqual([
      "datumOrigin",
    ]);
    expect(nodeParameterDependenciesV7(nodes.datumAxis)).toEqual([
      "axisDirection",
    ]);
  });

  it("counts principal-plane expressions but treats datum planes as graph refs", () => {
    const nodes = stagedNodes();
    const principalSketch = {
      ...nodes.sketch,
      plane: {
        type: "principal",
        plane: "XY",
        origin: [
          parameter("length", "planeOffset"),
          zeroLength,
          zeroLength,
        ],
      },
    } as unknown as NodeIRV7;
    expect(nodeParameterDependenciesV7(principalSketch)).toEqual([
      "planeOffset",
    ]);
    expect(nodeDependenciesV7(principalSketch)).toEqual([]);
    expect(nodeParameterDependenciesV7(nodes.sketch)).toEqual([]);
  });
});
