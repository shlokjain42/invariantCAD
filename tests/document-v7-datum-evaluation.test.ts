import { describe, expect, it } from "vitest";
import { nodeId } from "../src/core/ids.js";
import {
  mm,
  scalar as scalarExpression,
} from "../src/expressions.js";
import * as publicApi from "../src/index.js";
import {
  stagedBodySetDesignV7,
} from "../src/internal/document-v7-body-set-authoring.js";
import {
  evaluateDatumNodesV7,
} from "../src/internal/document-v7-datum-evaluation.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
  type DesignDocumentV7,
  type NodeIRV7,
} from "../src/ir.js";

const length = (value: number) =>
  ({ op: "literal", dimension: "length", value }) as const;
const scalar = (value: number) =>
  ({ op: "literal", dimension: "scalar", value }) as const;
const lengthParameter = (id: string) =>
  ({ op: "parameter", dimension: "length", id }) as const;

function datumDocument(
  nodeOverrides: Readonly<Record<string, NodeIRV7>> = {},
): DesignDocumentV7 {
  return {
    schema: DOCUMENT_SCHEMA_V7,
    version: DOCUMENT_VERSION_V7,
    name: "datum-evaluation",
    units: { length: "mm", angle: "rad" },
    parameters: {
      offset: {
        dimension: "length",
        default: length(1),
      },
    },
    configurations: {
      shifted: {
        parameterOverrides: {
          offset: length(10),
        },
      },
    },
    nodes: {
      "z-point": {
        kind: "datumPoint",
        position: [lengthParameter("offset"), length(2), length(3)],
      },
      plane: {
        kind: "datumPlane",
        origin: [length(4), length(5), length(6)],
        xDirection: [scalar(2), scalar(0), scalar(0)],
        normal: [scalar(0), scalar(0), scalar(3)],
      },
      frame: {
        kind: "coordinateSystem",
        origin: [length(7), length(8), length(9)],
        xDirection: [scalar(4), scalar(0), scalar(0)],
        yDirection: [scalar(1e-13), scalar(5), scalar(0)],
      },
      axis: {
        kind: "datumAxis",
        origin: [length(0), length(0), length(0)],
        direction: [scalar(0), scalar(0), scalar(2)],
      },
      solid: {
        kind: "box",
        size: [length(1), length(1), length(1)],
        center: false,
      },
      ...nodeOverrides,
    },
    outputs: {},
  } as unknown as DesignDocumentV7;
}

describe("staged document-v7 datum evaluation", () => {
  it("resolves authored scalar and length configurations with caller precedence", () => {
    const cad = stagedBodySetDesignV7("authored-datum-evaluation");
    const offset = cad.parameter.length("offset", mm(2));
    const direction = cad.parameter.scalar("direction", scalarExpression(1));
    cad.configuration("alternate", (configuration) => {
      configuration.parameter(offset, mm(8));
      configuration.parameter(direction, scalarExpression(-1));
    });
    cad.datumPoint("point", {
      position: [offset, mm(0), mm(0)],
    });
    cad.datumAxis("axis", {
      origin: [mm(0), offset, mm(0)],
      direction: [scalarExpression(0), direction, scalarExpression(0)],
    });
    const document = cad.build();

    const configured = evaluateDatumNodesV7(document, {
      nodes: ["point", "axis"],
      configuration: "alternate",
    });
    expect(configured.ok).toBe(true);
    if (!configured.ok) return;
    expect(configured.value.parameters).toEqual({
      direction: -1,
      offset: 8,
    });
    expect(configured.value.datums[nodeId("point")]).toMatchObject({
      position: [8, 0, 0],
    });
    expect(configured.value.datums[nodeId("axis")]).toMatchObject({
      origin: [0, 8, 0],
      direction: [0, -1, 0],
    });

    const caller = evaluateDatumNodesV7(document, {
      nodes: ["point", "axis"],
      configuration: "alternate",
      parameters: {
        direction: 1,
        offset: 12,
      },
    });
    expect(caller.ok).toBe(true);
    if (!caller.ok) return;
    expect(caller.value.parameters).toEqual({
      direction: 1,
      offset: 12,
    });
    expect(caller.value.datums[nodeId("point")]).toMatchObject({
      position: [12, 0, 0],
    });
    expect(caller.value.datums[nodeId("axis")]).toMatchObject({
      origin: [0, 12, 0],
      direction: [0, 1, 0],
    });
  });

  it("resolves every datum node in lexical order into detached frozen frames", () => {
    const result = evaluateDatumNodesV7(datumDocument());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodeIds).toEqual([
      "axis",
      "frame",
      "plane",
      "z-point",
    ]);
    expect(result.value.configurationId).toBeNull();
    expect(result.value.parameters).toEqual({ offset: 1 });
    expect(result.value.datums[nodeId("axis")]).toEqual({
      kind: "datumAxis",
      node: "axis",
      origin: [0, 0, 0],
      direction: [0, 0, 1],
    });
    expect(result.value.datums[nodeId("plane")]).toEqual({
      kind: "datumPlane",
      node: "plane",
      origin: [4, 5, 6],
      xDirection: [1, 0, 0],
      yDirection: [0, 1, 0],
      normal: [0, 0, 1],
    });
    expect(result.value.datums[nodeId("frame")]).toEqual({
      kind: "coordinateSystem",
      node: "frame",
      origin: [7, 8, 9],
      xDirection: [1, 0, 0],
      yDirection: [0, 1, 0],
      zDirection: [0, 0, 1],
    });
    expect(result.value.datums[nodeId("z-point")]).toMatchObject({
      kind: "datumPoint",
      position: [1, 2, 3],
    });
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.nodeIds)).toBe(true);
    expect(Object.isFrozen(result.value.parameters)).toBe(true);
    expect(Object.isFrozen(result.value.datums)).toBe(true);
    expect(Object.isFrozen(result.value.datums[nodeId("axis")])).toBe(true);
    const frozenAxis = result.value.datums[nodeId("axis")];
    expect(
      Object.isFrozen(
        frozenAxis?.kind === "datumAxis"
          ? frozenAxis.direction
          : [],
      ),
    ).toBe(true);
  });

  it("preserves the first explicit node occurrence and applies parameter precedence", () => {
    const configured = evaluateDatumNodesV7(datumDocument(), {
      nodes: ["z-point", "axis", "z-point"],
      configuration: "shifted",
    });
    expect(configured.ok).toBe(true);
    if (!configured.ok) return;
    expect(configured.value.nodeIds).toEqual(["z-point", "axis"]);
    expect(configured.value.configurationId).toBe("shifted");
    expect(configured.value.datums[nodeId("z-point")]).toMatchObject({
      position: [10, 2, 3],
    });

    const caller = evaluateDatumNodesV7(datumDocument(), {
      nodes: ["z-point"],
      configuration: "shifted",
      parameters: { offset: 20 },
    });
    expect(caller.ok).toBe(true);
    if (!caller.ok) return;
    expect(caller.value.parameters).toEqual({ offset: 20 });
    expect(caller.value.datums[nodeId("z-point")]).toMatchObject({
      position: [20, 2, 3],
    });
  });

  it("normalizes extremely small and large finite directions without overflow", () => {
    const document = datumDocument({
      tiny: {
        kind: "datumAxis",
        origin: [length(0), length(0), length(0)],
        direction: [scalar(Number.MIN_VALUE), scalar(0), scalar(0)],
      },
      huge: {
        kind: "datumAxis",
        origin: [length(0), length(0), length(0)],
        direction: [
          scalar(Number.MAX_VALUE),
          scalar(Number.MIN_VALUE),
          scalar(0),
        ],
      },
    });
    const result = evaluateDatumNodesV7(document, {
      nodes: ["tiny", "huge"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.datums[nodeId("tiny")]).toMatchObject({
      direction: [1, 0, 0],
    });
    const huge = result.value.datums[nodeId("huge")];
    expect(huge?.kind).toBe("datumAxis");
    if (huge?.kind !== "datumAxis") return;
    expect(huge.direction[0]).toBe(1);
    expect(huge.direction[1]).toBe(0);
    expect(huge.direction[2]).toBe(0);
  });

  it("rejects zero directions and out-of-tolerance datum frames", () => {
    const zero = evaluateDatumNodesV7(
      datumDocument({
        zero: {
          kind: "datumAxis",
          origin: [length(0), length(0), length(0)],
          direction: [scalar(0), scalar(0), scalar(0)],
        },
      }),
      { nodes: ["zero"] },
    );
    expect(zero.ok).toBe(false);
    if (!zero.ok) {
      expect(zero.diagnostics[0]).toMatchObject({
        code: "FEATURE_INVALID",
        node: "zero",
        path: "/nodes/zero/direction",
      });
    }

    const skewed = evaluateDatumNodesV7(
      datumDocument({
        skewed: {
          kind: "datumPlane",
          origin: [length(0), length(0), length(0)],
          xDirection: [scalar(1), scalar(0), scalar(0)],
          normal: [scalar(1e-6), scalar(0), scalar(1)],
        },
      }),
      { nodes: ["skewed"] },
    );
    expect(skewed.ok).toBe(false);
    if (!skewed.ok) {
      expect(skewed.diagnostics[0]).toMatchObject({
        code: "FEATURE_INVALID",
        node: "skewed",
        path: "/nodes/skewed/xDirection",
        details: {
          phase: "documentV7DatumEvaluation",
          tolerance: 1e-12,
        },
      });
    }
  });

  it("applies the fixed normalized-dot boundary and emits an orthonormal frame", () => {
    const planeAt = (dot: number): NodeIRV7 => ({
      kind: "datumPlane",
      origin: [length(0), length(0), length(0)],
      xDirection: [scalar(1), scalar(0), scalar(0)],
      normal: [
        scalar(dot),
        scalar(Math.sqrt(1 - dot * dot)),
        scalar(0),
      ],
    });
    const document = datumDocument({
      inside: planeAt(1e-12 - 1e-15),
      exact: planeAt(1e-12),
      outside: planeAt(1e-12 + 1e-15),
    });

    for (const id of ["inside", "exact"]) {
      const result = evaluateDatumNodesV7(document, { nodes: [id] });
      expect(result.ok, id).toBe(true);
      if (!result.ok) continue;
      const plane = result.value.datums[nodeId(id)];
      expect(plane?.kind, id).toBe("datumPlane");
      if (plane?.kind !== "datumPlane") continue;
      const dot = (first: readonly number[], second: readonly number[]) =>
        first[0]! * second[0]! +
        first[1]! * second[1]! +
        first[2]! * second[2]!;
      const magnitude = (value: readonly number[]) =>
        Math.hypot(value[0]!, value[1]!, value[2]!);
      expect(magnitude(plane.xDirection), id).toBeCloseTo(1, 14);
      expect(magnitude(plane.yDirection), id).toBeCloseTo(1, 14);
      expect(magnitude(plane.normal), id).toBeCloseTo(1, 14);
      expect(dot(plane.xDirection, plane.yDirection), id).toBeCloseTo(0, 14);
      expect(dot(plane.xDirection, plane.normal), id).toBeCloseTo(0, 14);
      expect(dot(plane.yDirection, plane.normal), id).toBeCloseTo(0, 14);
      expect(plane.yDirection[2], id).toBe(-1);
    }

    const outside = evaluateDatumNodesV7(document, {
      nodes: ["outside"],
    });
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.diagnostics[0]).toMatchObject({
        code: "FEATURE_INVALID",
        node: "outside",
        details: { tolerance: 1e-12 },
      });
    }
  });

  it("returns structured missing and wrong-kind selection failures without throwing", () => {
    expect(() =>
      evaluateDatumNodesV7(datumDocument(), { nodes: ["missing"] }),
    ).not.toThrow();
    const missing = evaluateDatumNodesV7(datumDocument(), {
      nodes: ["missing"],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.diagnostics[0]).toMatchObject({
        code: "REFERENCE_MISSING",
        path: "/nodes/missing",
      });
    }

    expect(() =>
      evaluateDatumNodesV7(datumDocument(), { nodes: ["solid"] }),
    ).not.toThrow();
    const wrongKind = evaluateDatumNodesV7(datumDocument(), {
      nodes: ["solid"],
    });
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) {
      expect(wrongKind.diagnostics[0]).toMatchObject({
        code: "REFERENCE_KIND_MISMATCH",
        node: "solid",
        path: "/nodes/solid",
      });
    }

    const escaped = evaluateDatumNodesV7(datumDocument(), {
      nodes: ["missing/~"],
    });
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) {
      expect(escaped.diagnostics[0]).toMatchObject({
        code: "REFERENCE_MISSING",
        path: "/nodes/missing~1~0",
      });
    }
  });

  it("enforces selection, parameter, and document ceilings", () => {
    const selected = evaluateDatumNodesV7(datumDocument(), {
      nodes: ["axis", "plane"],
      evaluationLimits: { maxSelectedNodes: 1 },
    });
    expect(selected.ok).toBe(false);
    if (!selected.ok) {
      expect(selected.diagnostics[0]).toMatchObject({
        code: "RESOURCE_LIMIT_EXCEEDED",
        details: {
          resource: "maxSelectedNodes",
          limit: 1,
          actual: 2,
        },
      });
    }

    const automatic = evaluateDatumNodesV7(datumDocument(), {
      evaluationLimits: { maxSelectedNodes: 1 },
    });
    expect(automatic.ok).toBe(false);
    if (!automatic.ok) {
      expect(automatic.diagnostics[0]).toMatchObject({
        code: "RESOURCE_LIMIT_EXCEEDED",
        details: {
          resource: "maxSelectedNodes",
          limit: 1,
          actual: 2,
        },
      });
    }

    let parameterDescriptorReads = 0;
    const oversizedParameters = new Proxy(
      { offset: 2, extra: 3 },
      {
        getOwnPropertyDescriptor(target, key) {
          parameterDescriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const parameters = evaluateDatumNodesV7(datumDocument(), {
      parameters: oversizedParameters,
      evaluationLimits: { maxParameterOverrides: 1 },
    });
    expect(parameters.ok).toBe(false);
    expect(parameterDescriptorReads).toBe(0);
    if (!parameters.ok) {
      expect(parameters.diagnostics[0]).toMatchObject({
        code: "RESOURCE_LIMIT_EXCEEDED",
        details: {
          resource: "maxParameterOverrides",
          limit: 1,
          actual: 2,
        },
      });
    }

    let optionDescriptorReads = 0;
    const oversizedOptions = new Proxy(
      {
        first: 1,
        second: 2,
        third: 3,
        fourth: 4,
        fifth: 5,
        sixth: 6,
        seventh: 7,
      },
      {
        getOwnPropertyDescriptor(target, key) {
          optionDescriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    const optionLimit = evaluateDatumNodesV7(
      datumDocument(),
      oversizedOptions as never,
    );
    expect(optionLimit.ok).toBe(false);
    expect(optionDescriptorReads).toBe(0);
    if (!optionLimit.ok) {
      expect(optionLimit.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        path: "/",
        details: {
          limit: 6,
          actual: 7,
        },
      });
    }

    const document = evaluateDatumNodesV7(datumDocument(), {
      documentLimits: { maxStructuralValues: 1 },
    });
    expect(document.ok).toBe(false);
    if (!document.ok) {
      expect(document.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        details: {
          resource: "maxStructuralValues",
          limit: 1,
        },
      });
    }
  });

  it("rejects accessors and observes cancellation without invoking user code", () => {
    let reads = 0;
    const options = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(options, "configuration", {
      enumerable: true,
      get(): string {
        reads += 1;
        return "shifted";
      },
    });
    const accessor = evaluateDatumNodesV7(
      datumDocument(),
      options as never,
    );
    expect(accessor.ok).toBe(false);
    expect(reads).toBe(0);
    if (!accessor.ok) {
      expect(accessor.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        path: "/configuration",
      });
    }

    const controller = new AbortController();
    controller.abort();
    const aborted = evaluateDatumNodesV7(datumDocument(), {
      signal: controller.signal,
    });
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) {
      expect(aborted.diagnostics[0]).toMatchObject({
        code: "EVALUATION_ABORTED",
        details: { phase: "documentV7DatumEvaluation" },
      });
    }

    const missingConfiguration = evaluateDatumNodesV7(datumDocument(), {
      configuration: "missing/~",
    });
    expect(missingConfiguration.ok).toBe(false);
    if (!missingConfiguration.ok) {
      expect(missingConfiguration.diagnostics[0]).toMatchObject({
        code: "CONFIGURATION_MISSING",
        path: "/configurations/missing~1~0",
      });
    }

    const invalidParameter = evaluateDatumNodesV7(datumDocument(), {
      parameters: { "bad/~": Number.NaN },
    });
    expect(invalidParameter.ok).toBe(false);
    if (!invalidParameter.ok) {
      expect(invalidParameter.diagnostics[0]).toMatchObject({
        code: "EXPRESSION_INVALID",
        path: "/parameters/bad~1~0",
      });
    }

    const missingParameter = evaluateDatumNodesV7(datumDocument(), {
      parameters: { "bad/~": 1 },
    });
    expect(missingParameter.ok).toBe(false);
    if (!missingParameter.ok) {
      expect(missingParameter.diagnostics[0]).toMatchObject({
        code: "PARAMETER_MISSING",
        path: "/parameters/bad~1~0",
        details: { phase: "documentV7DatumEvaluation" },
      });
    }
  });

  it("rejects opaque and integrity-mutating option traps without throwing", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const opaqueOptions = new Proxy(
      {},
      {
        ownKeys(): never {
          throw revoked.proxy;
        },
      },
    );
    let opaqueResult:
      | ReturnType<typeof evaluateDatumNodesV7>
      | undefined;
    expect(() => {
      opaqueResult = evaluateDatumNodesV7(
        datumDocument(),
        opaqueOptions as never,
      );
    }).not.toThrow();
    expect(opaqueResult?.ok).toBe(false);
    if (opaqueResult !== undefined && !opaqueResult.ok) {
      expect(opaqueResult.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        path: "/",
      });
    }

    const original = Object.getOwnPropertyDescriptor(Math, "sin");
    let mutated = false;
    const mutatingOptions = new Proxy(
      { nodes: ["axis"] },
      {
        getOwnPropertyDescriptor(target, key) {
          if (!mutated && key === "nodes") {
            mutated = true;
            Object.defineProperty(Math, "sin", {
              configurable: true,
              enumerable: false,
              writable: true,
              value: () => 0,
            });
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    let mutationResult:
      | ReturnType<typeof evaluateDatumNodesV7>
      | undefined;
    try {
      expect(() => {
        mutationResult = evaluateDatumNodesV7(
          datumDocument(),
          mutatingOptions,
        );
      }).not.toThrow();
    } finally {
      if (original === undefined) {
        delete (Math as { sin?: unknown }).sin;
      } else {
        Object.defineProperty(Math, "sin", original);
      }
    }
    expect(mutationResult?.ok).toBe(false);
    if (mutationResult !== undefined && !mutationResult.ok) {
      expect(mutationResult.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        details: {
          phase: "documentV7DatumEvaluation",
          runtimeIntegrity: false,
        },
      });
    }
  });

  it("reports point expression failures as position failures", () => {
    const result = evaluateDatumNodesV7(
      datumDocument({
        broken: {
          kind: "datumPoint",
          position: [
            {
              op: "div",
              dimension: "length",
              left: length(1),
              right: scalar(0),
            },
            length(0),
            length(0),
          ],
        },
      }),
      { nodes: ["broken"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "EXPRESSION_INVALID",
        node: "broken",
        path: "/nodes/broken/position",
      });
      expect(result.diagnostics[0]?.message).toMatch(
        /datum point 'broken' position could not be resolved/i,
      );
    }
  });

  it("detects substituted own keys in node-selection proxies", () => {
    const substituted = new Proxy(["axis", "plane"], {
      ownKeys() {
        return ["length", "0", "extra"];
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === "extra") {
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value: "plane",
          };
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const result = evaluateDatumNodesV7(datumDocument(), {
      nodes: substituted,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        path: "/nodes",
      });
    }
  });

  it("rejects sparse, accessor-backed, and extended node-selection arrays", () => {
    const sparse = new Array<string>(2);
    sparse[0] = "axis";
    const sparseResult = evaluateDatumNodesV7(datumDocument(), {
      nodes: sparse,
    });
    expect(sparseResult.ok).toBe(false);
    if (!sparseResult.ok) {
      expect(sparseResult.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        path: "/nodes/1",
      });
    }

    let reads = 0;
    const accessor = ["axis"];
    Object.defineProperty(accessor, "0", {
      configurable: true,
      enumerable: true,
      get(): string {
        reads += 1;
        return "axis";
      },
    });
    const accessorResult = evaluateDatumNodesV7(datumDocument(), {
      nodes: accessor,
    });
    expect(accessorResult.ok).toBe(false);
    expect(reads).toBe(0);
    if (!accessorResult.ok) {
      expect(accessorResult.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        path: "/nodes/0",
      });
    }

    const extended = ["axis"] as string[] & { extra?: boolean };
    extended.extra = true;
    const extendedResult = evaluateDatumNodesV7(datumDocument(), {
      nodes: extended,
    });
    expect(extendedResult.ok).toBe(false);
    if (!extendedResult.ok) {
      expect(extendedResult.diagnostics[0]).toMatchObject({
        code: "IR_INVALID",
        path: "/nodes",
      });
    }
  });

  it("keeps the staged datum evaluator out of the public package root", () => {
    expect("evaluateDatumNodesV7" in publicApi).toBe(false);
    expect("DEFAULT_DATUM_EVALUATION_LIMITS_V7" in publicApi).toBe(false);
  });
});
