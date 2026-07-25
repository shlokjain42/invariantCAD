import { describe, expect, it } from "vitest";
import { nodeId } from "../src/core/ids.js";
import { Expression, mm, scalar } from "../src/expressions.js";
import {
  nodeDependenciesV7,
  nodeParameterDependenciesV7,
  outputKindForNodeV7,
  type NodeIRV7,
} from "../src/ir.js";
import {
  stagedBodySetDesignV7,
  StagedCoordinateSystemRefV7,
  StagedDatumAxisRefV7,
  StagedDatumPlaneRefV7,
  StagedDatumPointRefV7,
} from "../src/internal/document-v7-body-set-authoring.js";
import * as publicApi from "../src/index.js";
import {
  parseDocumentV7,
  stringifyDocumentV7,
} from "../src/serialization.js";

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      expectDeepFrozen(descriptor.value, seen);
    }
  }
}

function axes() {
  return {
    x: [scalar(1), scalar(0), scalar(0)] as const,
    y: [scalar(0), scalar(1), scalar(0)] as const,
    z: [scalar(0), scalar(0), scalar(1)] as const,
  };
}

describe("staged document-v7 datum authoring", () => {
  it("emits exact frozen datum IR with scalar parameters and configurations", () => {
    const cad = stagedBodySetDesignV7("authored-v7-datums");
    const offset = cad.parameter.length("offset", mm(4), {
      min: mm(-20),
      max: mm(20),
      label: "Datum offset",
    });
    const direction = cad.parameter.scalar("direction", scalar(1), {
      min: scalar(-1),
      max: scalar(1),
      description: "Signed direction component",
    });
    cad.configuration("reversed", (configuration) => {
      configuration.parameter(offset, mm(8));
      configuration.parameter(direction, scalar(-1));
    });

    const sourcePosition = [offset, mm(2), mm(3)] as [
      typeof offset,
      ReturnType<typeof mm>,
      ReturnType<typeof mm>,
    ];
    const sourceDirection = [
      scalar(0),
      direction,
      scalar(0),
    ] as [
      ReturnType<typeof scalar>,
      typeof direction,
      ReturnType<typeof scalar>,
    ];
    const { x, y, z } = axes();
    const point = cad.datumPoint("point", { position: sourcePosition });
    const axis = cad.datumAxis("axis", {
      origin: [mm(0), offset, mm(0)],
      direction: sourceDirection,
    });
    const plane = cad.datumPlane("plane", {
      origin: [mm(0), mm(0), offset],
      xDirection: x,
      normal: z,
    });
    const frame = cad.coordinateSystem("frame", {
      origin: [offset, mm(0), mm(0)],
      xDirection: x,
      yDirection: y,
    });

    sourcePosition[0] = mm(999) as typeof offset;
    sourceDirection[1] = scalar(999) as typeof direction;

    expect(point).toBeInstanceOf(StagedDatumPointRefV7);
    expect(axis).toBeInstanceOf(StagedDatumAxisRefV7);
    expect(plane).toBeInstanceOf(StagedDatumPlaneRefV7);
    expect(frame).toBeInstanceOf(StagedCoordinateSystemRefV7);
    for (const reference of [point, axis, plane, frame]) {
      expect(Object.isFrozen(reference)).toBe(true);
      expect(Object.isFrozen(reference.toIR())).toBe(true);
    }
    expect(point.toIR()).toEqual({ node: "point", kind: "datumPoint" });
    expect(axis.toIR()).toEqual({ node: "axis", kind: "datumAxis" });
    expect(plane.toIR()).toEqual({ node: "plane", kind: "datumPlane" });
    expect(frame.toIR()).toEqual({
      node: "frame",
      kind: "coordinateSystem",
    });

    const document = cad.build();
    expect(document.parameters).toEqual({
      offset: {
        dimension: "length",
        default: mm(4).ir,
        min: mm(-20).ir,
        max: mm(20).ir,
        label: "Datum offset",
      },
      direction: {
        dimension: "scalar",
        default: scalar(1).ir,
        min: scalar(-1).ir,
        max: scalar(1).ir,
        description: "Signed direction component",
      },
    });
    expect(document.configurations).toEqual({
      reversed: {
        parameterOverrides: {
          offset: mm(8).ir,
          direction: scalar(-1).ir,
        },
      },
    });
    expect(document.nodes).toEqual({
      point: {
        kind: "datumPoint",
        position: [offset.ir, mm(2).ir, mm(3).ir],
      },
      axis: {
        kind: "datumAxis",
        origin: [mm(0).ir, offset.ir, mm(0).ir],
        direction: [scalar(0).ir, direction.ir, scalar(0).ir],
      },
      plane: {
        kind: "datumPlane",
        origin: [mm(0).ir, mm(0).ir, offset.ir],
        xDirection: [scalar(1).ir, scalar(0).ir, scalar(0).ir],
        normal: [scalar(0).ir, scalar(0).ir, scalar(1).ir],
      },
      frame: {
        kind: "coordinateSystem",
        origin: [offset.ir, mm(0).ir, mm(0).ir],
        xDirection: [scalar(1).ir, scalar(0).ir, scalar(0).ir],
        yDirection: [scalar(0).ir, scalar(1).ir, scalar(0).ir],
      },
    });
    expect(document.outputs).toEqual({});
    expectDeepFrozen(document);
  });

  it("round-trips canonically and supplies dependency-resolver reference shapes", () => {
    const cad = stagedBodySetDesignV7("datum-round-trip");
    const location = cad.parameter.length("location", mm(6));
    const component = cad.parameter.scalar("component", scalar(1));
    const point = cad.datumPoint("point", {
      position: [location, mm(0), mm(0)],
    });
    const axis = cad.datumAxis("axis", {
      origin: [mm(0), location, mm(0)],
      direction: [scalar(0), component, scalar(0)],
    });
    const plane = cad.datumPlane("plane", {
      origin: [mm(0), mm(0), location],
      xDirection: [component, scalar(0), scalar(0)],
      normal: [scalar(0), scalar(0), component],
    });
    const frame = cad.coordinateSystem("frame", {
      origin: [location, mm(0), mm(0)],
      xDirection: [component, scalar(0), scalar(0)],
      yDirection: [scalar(0), component, scalar(0)],
    });
    const document = cad.build();
    const text = stringifyDocumentV7(document);
    const parsed = parseDocumentV7(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(stringifyDocumentV7(parsed.value)).toBe(text);

    const expected = [
      [point, "datumPoint", ["location"]],
      [axis, "datumAxis", ["component", "location"]],
      [plane, "datumPlane", ["component", "location"]],
      [frame, "coordinateSystem", ["component", "location"]],
    ] as const;
    for (const [reference, kind, parameters] of expected) {
      const node = document.nodes[reference.node] as NodeIRV7;
      expect(reference.toIR()).toEqual({ node: reference.node, kind });
      expect(outputKindForNodeV7(node)).toBe(kind);
      expect(nodeDependenciesV7(node)).toEqual([]);
      expect(nodeParameterDependenciesV7(node)).toEqual(parameters);
    }
  });

  it("rejects accessor-backed, sparse, extended, and non-plain inputs without invoking accessors", () => {
    const origin = [mm(0), mm(0), mm(0)] as const;
    const direction = [scalar(0), scalar(0), scalar(1)] as const;
    let optionReads = 0;
    const accessorOptions = Object.defineProperty({}, "position", {
      enumerable: true,
      get: () => {
        optionReads += 1;
        return origin;
      },
    });
    expect(() =>
      stagedBodySetDesignV7("accessor-options").datumPoint(
        "point",
        accessorOptions as never,
      ),
    ).toThrow(/position.*own data/i);
    expect(optionReads).toBe(0);

    let parameterReads = 0;
    const scalarOptions = Object.defineProperty({}, "min", {
      enumerable: true,
      get: () => {
        parameterReads += 1;
        return scalar(0);
      },
    });
    expect(() =>
      stagedBodySetDesignV7("accessor-parameter").parameter.scalar(
        "component",
        scalar(1),
        scalarOptions,
      ),
    ).toThrow(/min.*own data/i);
    expect(parameterReads).toBe(0);

    let vectorReads = 0;
    const accessorVector = [mm(0), mm(0), mm(0)];
    Object.defineProperty(accessorVector, "1", {
      configurable: true,
      enumerable: true,
      get: () => {
        vectorReads += 1;
        return mm(0);
      },
    });
    expect(() =>
      stagedBodySetDesignV7("accessor-vector").datumPoint("point", {
        position: accessorVector as never,
      }),
    ).toThrow(/position\/1.*own data/i);
    expect(vectorReads).toBe(0);

    const sparse = new Array<ReturnType<typeof mm>>(3);
    sparse[0] = mm(0);
    sparse[2] = mm(0);
    expect(() =>
      stagedBodySetDesignV7("sparse").datumPoint("point", {
        position: sparse as never,
      }),
    ).toThrow(/dense|own data/i);

    const extended = [mm(0), mm(0), mm(0)] as unknown[] & {
      unexpected?: boolean;
    };
    extended.unexpected = true;
    expect(() =>
      stagedBodySetDesignV7("extended").datumPoint("point", {
        position: extended as never,
      }),
    ).toThrow(/unsupported|three-element/i);

    const inheritedOptions = Object.create({
      origin,
      direction,
    });
    expect(() =>
      stagedBodySetDesignV7("inherited").datumAxis(
        "axis",
        inheritedOptions,
      ),
    ).toThrow(/plain record/i);

    const nonPlainVector = [mm(0), mm(0), mm(0)];
    Object.setPrototypeOf(nonPlainVector, null);
    expect(() =>
      stagedBodySetDesignV7("non-plain-vector").datumPoint("point", {
        position: nonPlainVector as never,
      }),
    ).toThrow(/plain array/i);

    expect(() =>
      stagedBodySetDesignV7("unknown-options").datumPoint("point", {
        position: origin,
        unsupported: true,
      } as never),
    ).toThrow(/unsupported field/i);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const opaqueOptions = new Proxy(
      {},
      {
        ownKeys: () => {
          throw revoked.proxy;
        },
      },
    );
    expect(() =>
      stagedBodySetDesignV7("opaque-options").datumPoint(
        "point",
        opaqueOptions as never,
      ),
    ).toThrow(/could not be read safely/i);

    const opaqueVector = new Proxy(
      [mm(0), mm(0), mm(0)],
      {
        getOwnPropertyDescriptor: () => {
          throw revoked.proxy;
        },
      },
    );
    const atomic = stagedBodySetDesignV7("opaque-vector");
    expect(() =>
      atomic.datumPoint("point", { position: opaqueVector as never }),
    ).toThrow(/could not be read safely/i);
    expect(() =>
      atomic.datumPoint("point", { position: origin }),
    ).not.toThrow();

    const dimensionDescriptor = Object.getOwnPropertyDescriptor(
      Expression.prototype,
      "dimension",
    );
    const target = scalar(1);
    let mutated = false;
    const mutatingDefault = new Proxy(target, {
      getOwnPropertyDescriptor: (object, key) => {
        if (!mutated && key === "dimension") {
          mutated = true;
          Object.defineProperty(Expression.prototype, "dimension", {
            configurable: true,
            get: () => {
              throw new Error("mutable prototype was invoked");
            },
          });
        }
        return Object.getOwnPropertyDescriptor(object, key);
      },
    });
    try {
      const mutationSafe = stagedBodySetDesignV7("mutating-expression");
      expect(() =>
        mutationSafe.parameter.scalar(
          "component",
          mutatingDefault,
        ),
      ).not.toThrow();
    } finally {
      if (dimensionDescriptor === undefined) {
        delete (Expression.prototype as { dimension?: unknown }).dimension;
      } else {
        Object.defineProperty(
          Expression.prototype,
          "dimension",
          dimensionDescriptor,
        );
      }
    }
  });

  it("rejects wrong dimensions, structural forgeries, duplicates, and datum outputs", () => {
    const cad = stagedBodySetDesignV7("datum-boundaries");
    expect(() =>
      cad.datumPoint("wrong-position", {
        position: [mm(0), scalar(0), mm(0)] as never,
      }),
    ).toThrow(/length expression/i);
    expect(() =>
      cad.datumAxis("wrong-direction", {
        origin: [mm(0), mm(0), mm(0)],
        direction: [scalar(0), mm(0), scalar(1)] as never,
      }),
    ).toThrow(/scalar expression/i);
    expect(() =>
      cad.datumPoint("forged-expression", {
        position: [
          {
            dimension: "length",
            ir: mm(0).ir,
          },
          mm(0),
          mm(0),
        ] as never,
      }),
    ).toThrow(/length expression/i);

    const point = cad.datumPoint("datum", {
      position: [mm(0), mm(0), mm(0)],
    });
    expect(
      () =>
        new StagedDatumPointRefV7(
          cad,
          nodeId("datum"),
          undefined,
        ),
    ).toThrow(/only be created by their owning design/i);
    expect(() =>
      cad.datumAxis("datum", {
        origin: [mm(0), mm(0), mm(0)],
        direction: [scalar(0), scalar(0), scalar(1)],
      }),
    ).toThrow(/duplicate feature/i);
    expect(() => cad.output("datum", point as never)).toThrow(
      /only owned direct imported bodies, body sets, and parts/i,
    );

    const foreign = stagedBodySetDesignV7("foreign").datumPoint(
      "foreign-point",
      { position: [mm(0), mm(0), mm(0)] },
    );
    expect(() => cad.output("foreign", foreign as never)).toThrow(
      /only owned direct imported bodies, body sets, and parts/i,
    );
    expect(() =>
      cad.output(
        "forged",
        {
          node: nodeId("datum"),
          kind: "datumPoint",
          toIR: () => ({ node: nodeId("datum"), kind: "datumPoint" }),
        } as never,
      ),
    ).toThrow(/only owned direct imported bodies, body sets, and parts/i);

    const other = stagedBodySetDesignV7("parameter-owner");
    const scalarParameter = other.parameter.scalar("component", scalar(1));
    expect(() =>
      cad.configuration("foreign-parameter", (configuration) =>
        configuration.parameter(scalarParameter, scalar(0)),
      ),
    ).toThrow(/cannot cross staged design boundaries/i);
    expect(() =>
      cad.configuration("wrong-override", (configuration) =>
        configuration.parameter(
          cad.parameter.scalar("local", scalar(1)),
          mm(1) as never,
        ),
      ),
    ).toThrow(/scalar expression/i);
  });

  it("keeps the public v6 document and package root isolated", () => {
    const cad = publicApi.design("public-v6");
    const scalarParameter = cad.parameter.scalar("scalar", scalar(1));
    const box = cad.box("box", {
      size: [mm(1), mm(2), mm(3).mul(scalarParameter)],
    });
    cad.output("box", box);
    const document: publicApi.DesignDocument = cad.build();

    expect(document.version).toBe(6);
    expect(publicApi.DOCUMENT_VERSION).toBe(6);
    expect("StagedDatumPointRefV7" in publicApi).toBe(false);
    expect("StagedDatumAxisRefV7" in publicApi).toBe(false);
    expect("StagedDatumPlaneRefV7" in publicApi).toBe(false);
    expect("StagedCoordinateSystemRefV7" in publicApi).toBe(false);
    expect("stagedBodySetDesignV7" in publicApi).toBe(false);
  });
});
