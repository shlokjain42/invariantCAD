import { describe, expect, it } from "vitest";
import { configurationId, nodeId } from "../src/core/ids.js";
import {
  AssemblyRef,
  DesignBuilder,
  PartRef,
  tf,
} from "../src/design.js";
import {
  mm,
  rad,
  scalar,
  type ExpressionIR,
} from "../src/expressions.js";
import {
  DOCUMENT_SCHEMA_V7,
  DOCUMENT_VERSION_V7,
} from "../src/ir.js";
import {
  StagedLocalAssemblyBuilderV7,
  stagedBodySetDesignV7,
} from "../src/internal/document-v7-body-set-authoring.js";
import * as publicApi from "../src/index.js";
import {
  parseDocumentV7,
  stringifyDocumentV7,
} from "../src/serialization.js";
import { DEFAULT_DESIGN_DOCUMENT_LIMITS } from "../src/document-limits.js";

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

function designWithPart(name: string) {
  const cad = stagedBodySetDesignV7(name);
  const width = cad.parameter.length("width", mm(10));
  const solid = cad.box("solid", {
    size: [width, mm(2), mm(3)],
  });
  const part = cad.part("part", solid, {
    partNumber: `${name}-part`,
  });
  return { cad, width, part };
}

function literal(
  dimension: "length" | "angle" | "scalar",
  value: number,
): {
  op: "literal";
  dimension: "length" | "angle" | "scalar";
  value: number;
} {
  return { op: "literal", dimension, value };
}

describe("staged Document v7 local assembly authoring", () => {
  it("authors frozen exact flat occurrence IR, configurations, and an assembly output", () => {
    const { cad, width, part } = designWithPart("assembly-authoring");
    const placement = [
      tf.translate([width, mm(2), mm(3)]),
      tf.rotate([rad(0), rad(0), rad(Math.PI / 2)]),
      tf.scale([scalar(1), scalar(2), scalar(1)]),
      tf.mirror([scalar(1), scalar(0), scalar(0)]),
    ];
    const assembly = cad.assembly("product", (instances) => {
      instances.instance("default", part);
      instances.instance("base", part, {
        configuration: { mode: "base" },
        placement,
      });
      instances.instance("named", part, {
        configuration: {
          mode: "named",
          id: configurationId("compact"),
        },
        suppressed: true,
      });
    });
    cad.configuration("compact", (configuration) => {
      configuration.parameter(width, mm(5));
    });
    cad.configuration("service", (configuration) => {
      configuration.instanceSuppressed(assembly, "default");
      configuration.instanceSuppressed(assembly, "named", false);
    });
    cad.output("product", assembly);

    const document = cad.build();
    expect(document).toMatchObject({
      schema: DOCUMENT_SCHEMA_V7,
      version: DOCUMENT_VERSION_V7,
      nodes: {
        product: {
          kind: "assembly",
          instances: [
            {
              id: "default",
              component: {
                source: "local",
                reference: { node: "part", kind: "part" },
              },
              configuration: { mode: "inherit" },
              placement: [],
              suppressed: false,
            },
            {
              id: "base",
              component: {
                source: "local",
                reference: { node: "part", kind: "part" },
              },
              configuration: { mode: "base" },
              placement,
              suppressed: false,
            },
            {
              id: "named",
              component: {
                source: "local",
                reference: { node: "part", kind: "part" },
              },
              configuration: { mode: "named", id: "compact" },
              placement: [],
              suppressed: true,
            },
          ],
        },
      },
      configurations: {
        service: {
          instanceSuppressions: {
            product: { default: true, named: false },
          },
        },
      },
      outputs: {
        product: { node: "product", kind: "assembly" },
      },
    });
    expect(Object.isFrozen(assembly)).toBe(true);
    expectDeepFrozen(document);

    const text = stringifyDocumentV7(document);
    const parsed = parseDocumentV7(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(stringifyDocumentV7(parsed.value)).toBe(text);
  });

  it("detaches mutable placement and configuration IR at the call boundary", () => {
    const { cad, part } = designWithPart("detached");
    const expression = literal("length", 4);
    const vector = [
      expression,
      literal("length", 0),
      literal("length", 0),
    ] as [ExpressionIR, ExpressionIR, ExpressionIR];
    const operation = {
      kind: "translate" as const,
      value: vector,
    };
    const placement = [operation];
    const configuration = { mode: "base" as const };
    const assembly = cad.assembly("product", (instances) => {
      instances.instance("part", part, { placement, configuration });
    });

    expression.value = 99;
    vector[0] = literal("length", 88);
    placement.length = 0;
    (configuration as { mode: string }).mode = "inherit";
    cad.output("product", assembly);
    const node = cad.build().nodes[nodeId("product")];
    expect(node?.kind).toBe("assembly");
    if (node?.kind !== "assembly") return;
    expect(node.instances[0]).toMatchObject({
      configuration: { mode: "base" },
      placement: [
        {
          kind: "translate",
          value: [
            { op: "literal", dimension: "length", value: 4 },
            { op: "literal", dimension: "length", value: 0 },
            { op: "literal", dimension: "length", value: 0 },
          ],
        },
      ],
    });
    expectDeepFrozen(node);
  });

  it("snapshots the completed assembly before a retained callback builder can change", () => {
    const { cad, part } = designWithPart("retained-builder");
    let retained: StagedLocalAssemblyBuilderV7 | undefined;
    const assembly = cad.assembly("product", (instances) => {
      retained = instances;
      instances.instance("first", part);
    });
    retained!.instance("late", part);
    cad.output("product", assembly);
    const node = cad.build().nodes[nodeId("product")];
    expect(node?.kind).toBe("assembly");
    if (node?.kind !== "assembly") return;
    expect(node.instances.map((instance) => instance.id)).toEqual(["first"]);
  });

  it("rejects duplicate, missing, cross-owner, forged, and nested handles", () => {
    const first = designWithPart("first");
    const second = designWithPart("second");
    expect(() =>
      first.cad.assembly("cross-owner", (instances) => {
        instances.instance("foreign", second.part);
      }),
    ).toThrow(/cannot cross staged design boundaries/);

    const forgedPart = new PartRef(
      new DesignBuilder("forged-part-owner"),
      nodeId("part"),
    );
    expect(() =>
      first.cad.assembly("forged-part", (instances) => {
        instances.instance("forged", forgedPart);
      }),
    ).toThrow(/cannot cross staged design boundaries/);

    const assembly = first.cad.assembly("product", (instances) => {
      instances.instance("part", first.part);
      expect(() => instances.instance("part", first.part)).toThrow(
        /Duplicate assembly instance/,
      );
    });
    const nested = first.cad.assembly("nested-attempt", (instances) => {
      expect(() =>
        instances.instance("nested", assembly as never),
      ).toThrow(/cannot cross staged design boundaries/);
    });
    first.cad.configuration("valid", (configuration) => {
      expect(() =>
        configuration.instanceSuppressed(assembly, "missing"),
      ).toThrow(/has no instance/);
      configuration.instanceSuppressed(assembly, "part", false);
      expect(() =>
        configuration.instanceSuppressed(assembly, "part"),
      ).toThrow(/Duplicate configuration instance override/);
    });
    second.cad.configuration("cross-owner", (configuration) => {
      expect(() =>
        configuration.instanceSuppressed(assembly, "part"),
      ).toThrow(/cannot cross staged design boundaries/);
      configuration.parameter(second.width, mm(2));
    });

    const forgedAssembly = new AssemblyRef(
      new DesignBuilder("forged-assembly-owner"),
      nodeId("product"),
    );
    expect(() =>
      first.cad.output("forged", forgedAssembly),
    ).toThrow(/owned direct/);
    first.cad.output("nested-empty", nested);
    expect(
      first.cad.build().configurations?.[configurationId("valid")],
    ).toMatchObject({
      instanceSuppressions: { product: { part: false } },
    });
  });

  it("does not invoke accessors in options, configuration, placement, operations, or expressions", () => {
    const cases: {
      readonly label: string;
      readonly value: () => unknown;
      readonly use: (
        instances: StagedLocalAssemblyBuilderV7,
        part: PartRef,
        value: unknown,
      ) => void;
    }[] = [
      {
        label: "options",
        value: () => {
          const value = {};
          Object.defineProperty(value, "suppressed", {
            enumerable: true,
            get: () => {
              throw new Error("options accessor invoked");
            },
          });
          return value;
        },
        use: (instances, part, value) =>
          instances.instance("part", part, value as never),
      },
      {
        label: "configuration",
        value: () => {
          const value = {};
          Object.defineProperty(value, "mode", {
            enumerable: true,
            get: () => {
              throw new Error("configuration accessor invoked");
            },
          });
          return { configuration: value };
        },
        use: (instances, part, value) =>
          instances.instance("part", part, value as never),
      },
      {
        label: "placement",
        value: () => {
          const placement = new Array(1);
          Object.defineProperty(placement, "0", {
            enumerable: true,
            get: () => {
              throw new Error("placement accessor invoked");
            },
          });
          return { placement };
        },
        use: (instances, part, value) =>
          instances.instance("part", part, value as never),
      },
      {
        label: "operation",
        value: () => {
          const operation = {};
          Object.defineProperty(operation, "kind", {
            enumerable: true,
            get: () => {
              throw new Error("operation accessor invoked");
            },
          });
          return { placement: [operation] };
        },
        use: (instances, part, value) =>
          instances.instance("part", part, value as never),
      },
      {
        label: "expression",
        value: () => {
          const expression = {};
          Object.defineProperty(expression, "dimension", {
            enumerable: true,
            get: () => {
              throw new Error("expression accessor invoked");
            },
          });
          return {
            placement: [
              {
                kind: "translate",
                value: [
                  expression,
                  literal("length", 0),
                  literal("length", 0),
                ],
              },
            ],
          };
        },
        use: (instances, part, value) =>
          instances.instance("part", part, value as never),
      },
    ];
    for (const entry of cases) {
      const { cad, part } = designWithPart(`accessor-${entry.label}`);
      expect(() =>
        cad.assembly("product", (instances) => {
          entry.use(instances, part, entry.value());
        }),
      ).toThrow();
      try {
        cad.assembly("second", (instances) => {
          entry.use(instances, part, entry.value());
        });
      } catch (error) {
        expect(String(error)).not.toContain("accessor invoked");
      }
    }
  });

  it("normalizes opaque and revoked proxy failures without accepting substituted keys", () => {
    const proxyCases: unknown[] = [
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw Object.freeze({ opaque: true });
          },
        },
      ),
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor: () => {
            throw null;
          },
          ownKeys: () => ["suppressed"],
        },
      ),
    ];
    const revokedOptions = Proxy.revocable({}, {});
    revokedOptions.revoke();
    proxyCases.push(revokedOptions.proxy);

    for (let index = 0; index < proxyCases.length; index += 1) {
      const { cad, part } = designWithPart(`proxy-${index}`);
      expect(() =>
        cad.assembly("product", (instances) => {
          instances.instance("part", part, proxyCases[index] as never);
        }),
      ).toThrow(/could not be read safely/);
    }

    const { cad, part } = designWithPart("array-proxy");
    const substituted = new Proxy([tf.translate([mm(1), mm(0), mm(0)])], {
      ownKeys: () => ["0", "length", "substituted"],
    });
    expect(() =>
      cad.assembly("product", (instances) => {
        instances.instance("part", part, {
          placement: substituted,
        });
      }),
    ).toThrow(/non-index properties/);

    const revokedPlacement = Proxy.revocable([], {});
    revokedPlacement.revoke();
    expect(() =>
      cad.assembly("revoked-placement", (instances) => {
        instances.instance("part", part, {
          placement: revokedPlacement.proxy,
        });
      }),
    ).toThrow(/could not be read safely/);
  });

  it("rejects sparse, extended, malformed, and over-limit placement/configuration values", () => {
    const { cad, part } = designWithPart("malformed");
    const failures: unknown[] = [
      { placement: new Array(1) },
      {
        placement: Object.assign(
          [tf.translate([mm(1), mm(0), mm(0)])],
          { extra: true },
        ),
      },
      {
        placement: [
          {
            kind: "translate",
            value: [
              literal("scalar", 1),
              literal("length", 0),
              literal("length", 0),
            ],
          },
        ],
      },
      { configuration: { mode: "inherit", id: "not-allowed" } },
      { configuration: { mode: "named" } },
      { configuration: { mode: "unknown" } },
      { suppressed: 1 },
      { unsupported: true },
    ];
    for (let index = 0; index < failures.length; index += 1) {
      expect(() =>
        cad.assembly(`failure-${index}`, (instances) => {
          instances.instance("part", part, failures[index] as never);
        }),
      ).toThrow();
    }

    const overLimit = new Array(
      DEFAULT_DESIGN_DOCUMENT_LIMITS.maxStructuralValues + 1,
    );
    expect(() =>
      cad.assembly("over-limit", (instances) => {
        instances.instance("part", part, {
          placement: overLimit,
        });
      }),
    ).toThrow(/authoring limit/);
  });

  it("does not invoke mutable AssemblyRef prototype methods", () => {
    const modelRefPrototype = Object.getPrototypeOf(
      AssemblyRef.prototype,
    ) as object;
    const descriptor = Object.getOwnPropertyDescriptor(
      modelRefPrototype,
      "toIR",
    )!;
    try {
      Object.defineProperty(modelRefPrototype, "toIR", {
        ...descriptor,
        value: () => {
          throw new Error("AssemblyRef.toIR must not be invoked");
        },
      });
      const { cad, part } = designWithPart("prototype");
      const assembly = cad.assembly("product", (instances) => {
        instances.instance("part", part);
      });
      cad.configuration("configured", (configuration) => {
        configuration.instanceSuppressed(assembly, "part");
      });
      cad.output("product", assembly);
      expect(cad.build().outputs.product).toEqual({
        node: "product",
        kind: "assembly",
      });
    } finally {
      Object.defineProperty(modelRefPrototype, "toIR", descriptor);
    }
  });

  it("keeps the staged assembly surface outside the public v1-v6 API", () => {
    expect("stagedBodySetDesignV7" in publicApi).toBe(false);
    expect("StagedLocalAssemblyBuilderV7" in publicApi).toBe(false);
    expect("StagedLocalAssemblyInstanceOptionsV7" in publicApi).toBe(false);
    const publicDocument = new DesignBuilder("public-v6").build();
    expect(publicDocument.version).toBe(6);
    expect(publicDocument.schema).not.toBe(DOCUMENT_SCHEMA_V7);
  });
});
