import { describe, expect, it } from "vitest";
import {
  design,
  mm,
  scalarVec3,
  tf,
  validateDocument,
  vec3,
  type DesignDocument,
} from "../src/index.js";

function resolvesPointer(document: unknown, pointer: string): boolean {
  let current = document;
  for (const segment of pointer.split("/").slice(1)) {
    if (typeof current !== "object" || current === null) return false;
    if (!Object.hasOwn(current, segment)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function transformDocument(): DesignDocument {
  const cad = design("transform-paths");
  const box = cad.box("box", { size: vec3(mm(1), mm(1), mm(1)) });
  const part = cad.part("part", box);
  cad.output(
    "moved",
    cad.transform("moved", box, [
      tf.translate(vec3(mm(1), mm(0), mm(0))),
      tf.mirror(scalarVec3(1, 0, 0)),
    ]),
  );
  cad.output(
    "assembly",
    cad.assembly("assembly", (instances) => {
      instances.instance("first", part);
      instances.instance("second", part, {
        placement: [
          tf.translate(vec3(mm(1), mm(0), mm(0))),
          tf.mirror(scalarVec3(1, 0, 0)),
        ],
      });
    }),
  );
  return structuredClone(cad.build()) as DesignDocument;
}

type Mutable = Record<string, any>;

describe("transform expression diagnostic paths", () => {
  it.each([
    {
      name: "transform value",
      mutate: (nodes: Mutable) => {
        nodes.moved.operations[0].value[1] = {
          op: "literal",
          dimension: "angle",
          value: 1,
        };
      },
      code: "EXPRESSION_DIMENSION_MISMATCH",
      path: "/nodes/moved/operations/0/value/1",
    },
    {
      name: "transform mirror normal",
      mutate: (nodes: Mutable) => {
        nodes.moved.operations[1].normal[2] = {
          op: "parameter",
          dimension: "scalar",
          id: "missing",
        };
      },
      code: "PARAMETER_MISSING",
      path: "/nodes/moved/operations/1/normal/2/id",
    },
    {
      name: "placement value",
      mutate: (nodes: Mutable) => {
        nodes.assembly.instances[1].placement[0].value[1] = {
          op: "literal",
          dimension: "angle",
          value: 1,
        };
      },
      code: "EXPRESSION_DIMENSION_MISMATCH",
      path: "/nodes/assembly/instances/1/placement/0/value/1",
    },
    {
      name: "placement mirror normal",
      mutate: (nodes: Mutable) => {
        nodes.assembly.instances[1].placement[1].normal[0] = {
          op: "literal",
          dimension: "length",
          value: 1,
        };
      },
      code: "EXPRESSION_DIMENSION_MISMATCH",
      path: "/nodes/assembly/instances/1/placement/1/normal/0",
    },
  ])("points a $name diagnostic at the authored component", (testCase) => {
    const document = transformDocument();
    testCase.mutate(document.nodes as Mutable);
    const result = validateDocument(document);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: testCase.code, path: testCase.path }),
    ]);
    expect(resolvesPointer(document, testCase.path)).toBe(true);
  });
});
