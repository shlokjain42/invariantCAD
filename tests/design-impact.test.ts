import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DESIGN_IMPACT_REPORT_VERSION,
  DOCUMENT_SCHEMA_V1,
  DOCUMENT_SCHEMA_V2,
  DOCUMENT_SCHEMA_V3,
  DOCUMENT_SCHEMA_V4,
  DOCUMENT_SCHEMA_V5,
  DOCUMENT_SCHEMA_V6,
  analyzeDesignImpact,
  captureTopologyReference,
  design,
  kgPerCubicMeter,
  mm,
  tf,
  topology,
  vec3,
  type CadResult,
  type DesignDocument,
  type DesignImpactReport,
  type KernelTopologyKey,
  type PersistentTopologyReference,
} from "../src/index.js";

function expectDeeplyFrozen(
  value: unknown,
  seen = new Set<object>(),
): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen);
}

function impactValue(
  result: CadResult<DesignImpactReport>,
): DesignImpactReport {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected a design-impact report");
  return result.value;
}

function authoredFixture(): DesignDocument {
  const cad = design("impact-fixture");
  const width = cad.parameter.length("width", mm(10));
  const scaledWidth = cad.parameter.length("scaled-width", width.mul(2));
  const radius = cad.parameter.length("radius", mm(3));
  const steelDensity = cad.parameter.massDensity(
    "steel-density",
    kgPerCubicMeter(7_850),
  );
  const steel = cad.material("steel", {
    name: "Steel",
    massDensity: steelDensity,
  });
  const aluminum = cad.material("aluminum", {
    name: "Aluminum",
    massDensity: kgPerCubicMeter(2_700),
  });
  const root = cad.box("root", {
    size: vec3(scaledWidth, mm(4), mm(2)),
  });
  const leftSolid = cad.translate(
    "left-solid",
    root,
    vec3(mm(-10), mm(0), mm(0)),
  );
  const rightSolid = cad.translate(
    "right-solid",
    root,
    vec3(mm(10), mm(0), mm(0)),
  );
  const leftPart = cad.part("left-part", leftSolid, { materialRef: steel });
  const rightPart = cad.part("right-part", rightSolid, { materialRef: steel });
  const product = cad.assembly("product", (instances) => {
    instances.instance("left", leftPart);
    instances.instance("right", rightPart);
  });
  const isolatedSolid = cad.sphere("isolated-solid", { radius });
  const isolatedPart = cad.part("isolated-part", isolatedSolid, {
    materialRef: aluminum,
  });
  cad.configuration("lightweight", (configuration) =>
    configuration
      .parameter(width, mm(20))
      .partMaterial(leftPart, aluminum)
      .instanceSuppressed(product, "right"),
  );
  cad.output("product", product).output("isolated", isolatedPart);
  return cad.build();
}

function key(value: string): KernelTopologyKey {
  return value as KernelTopologyKey;
}

function edgeReference(): PersistentTopologyReference<"edge"> {
  const captured = captureTopologyReference(
    {
      history: "complete",
      faces: [],
      edges: [
        {
          topology: "edge",
          key: key("captured-edge"),
          center: [0, 0, 0.5],
          bounds: { min: [0, 0, 0], max: [0, 0, 1] },
          lineage: [
            {
              feature: "body",
              relation: "created",
              role: "box.edge.x-min-y-min",
            },
          ],
          length: 1,
          curve: { kind: "line", direction: [0, 0, 1] },
          faces: [],
          vertices: [],
        },
      ],
      vertices: [],
    },
    "edge",
    key("captured-edge"),
    {
      capabilities: {
        protocolVersion: 1,
        fingerprint: "design-impact/signatures@1",
      },
      tolerance: { linear: 1e-6, angular: 1e-6, relative: 1e-8 },
    },
  );
  if (!captured.ok) throw new Error(JSON.stringify(captured.diagnostics));
  return captured.value;
}

function persistentFixture(): DesignDocument {
  const cad = design("persistent-impact");
  const body = cad.box("body", { size: vec3(mm(1), mm(1), mm(1)) });
  const stored = cad.topologyReference("stored-edge", body, {
    topology: "edge",
    variants: [edgeReference()],
  });
  const treated = cad.fillet("treated", body, {
    edges: topology.edges.persistentReference(stored).select(),
    radius: mm(0.1),
  });
  const placed = cad.translate(
    "placed",
    treated,
    vec3(mm(1), mm(0), mm(0)),
  );
  cad.output("placed", placed);
  return cad.build();
}

function mutuallyExclusiveParameterFixture(): DesignDocument {
  const cad = design("mutually-exclusive-parameters");
  const first = cad.parameter.length("first", mm(1));
  const second = cad.parameter.length("second", mm(2));
  const third = cad.parameter.length("third", mm(3));
  const body = cad.box("body", { size: vec3(third, mm(1), mm(1)) });
  cad.configuration("first-mode", (configuration) =>
    configuration.parameter(second, first),
  );
  cad.configuration("second-mode", (configuration) =>
    configuration.parameter(third, second),
  );
  cad.output("body", body);
  return cad.build();
}

function separatedMaterialFixture(): DesignDocument {
  const cad = design("separated-material-contexts");
  const density = cad.parameter.massDensity(
    "density",
    kgPerCubicMeter(7_850),
  );
  const steel = cad.material("steel", {
    name: "Steel",
    massDensity: density,
  });
  const polymer = cad.material("polymer", {
    name: "Polymer",
    massDensity: kgPerCubicMeter(1_200),
  });
  const body = cad.box("body", { size: vec3(mm(1), mm(1), mm(1)) });
  const part = cad.part("part", body, { materialRef: polymer });
  cad.configuration("density-mode", (configuration) =>
    configuration.parameter(density, kgPerCubicMeter(8_000)),
  );
  cad.configuration("material-mode", (configuration) =>
    configuration.partMaterial(part, steel),
  );
  cad.output("part", part);
  return cad.build();
}

function suppressedAssemblyFixture(includeUnsuppression: boolean): DesignDocument {
  const cad = design("suppressed-assembly");
  const offset = cad.parameter.length("offset", mm(5));
  const body = cad.box("body", { size: vec3(mm(1), mm(1), mm(1)) });
  const part = cad.part("part", body);
  const assembly = cad.assembly("assembly", (instances) => {
    instances.instance("child", part, {
      placement: [tf.translate(vec3(offset, mm(0), mm(0)))],
      suppressed: true,
    });
  });
  if (includeUnsuppression) {
    cad.configuration("enabled", (configuration) =>
      configuration.instanceSuppressed(assembly, "child", false),
    );
  }
  cad.output("assembly", assembly);
  return cad.build();
}

describe("authored design-impact analysis", () => {
  it("propagates parameter changes through a diamond without touching isolated branches", () => {
    const report = impactValue(
      analyzeDesignImpact(authoredFixture(), {
        parameters: ["width"],
      }),
    );

    expect(DESIGN_IMPACT_REPORT_VERSION).toBe(1);
    expect(report.version).toBe(1);
    expect(report.seeds.parameters).toEqual(["width"]);
    expect(report.parameters).toEqual([
      { parameter: "scaled-width", reasons: [{ kind: "dependency", parameter: "width" }] },
      { parameter: "width", reasons: [{ kind: "seed" }] },
    ]);
    expect(report.nodes).toEqual([
      {
        node: "left-part",
        direct: false,
        reasons: [{ kind: "dependency", node: "left-solid" }],
      },
      {
        node: "left-solid",
        direct: false,
        reasons: [{ kind: "dependency", node: "root" }],
      },
      {
        node: "product",
        direct: false,
        reasons: [
          { kind: "dependency", node: "left-part" },
          { kind: "dependency", node: "right-part" },
        ],
      },
      {
        node: "right-part",
        direct: false,
        reasons: [{ kind: "dependency", node: "right-solid" }],
      },
      {
        node: "right-solid",
        direct: false,
        reasons: [{ kind: "dependency", node: "root" }],
      },
      {
        node: "root",
        direct: true,
        reasons: [{ kind: "parameter", parameter: "scaled-width" }],
      },
    ]);
    expect(report.outputs).toEqual([{ name: "product", node: "product" }]);
    expect(report.nodes.some(({ node }) => node.startsWith("isolated"))).toBe(
      false,
    );
    expectDeeplyFrozen(report);
    expectTypeOf(report).toEqualTypeOf<DesignImpactReport>();
  });

  it("tracks parameterized materials and configured material use", () => {
    const density = impactValue(
      analyzeDesignImpact(authoredFixture(), {
        parameters: ["steel-density"],
      }),
    );
    expect(density.materials).toEqual([
      {
        material: "steel",
        reasons: [{ kind: "parameter", parameter: "steel-density" }],
      },
    ]);
    expect(
      density.nodes.filter(({ direct }) => direct).map(({ node }) => node),
    ).toEqual(["left-part", "right-part"]);
    expect(density.outputs).toEqual([{ name: "product", node: "product" }]);

    const aluminum = impactValue(
      analyzeDesignImpact(authoredFixture(), {
        materials: ["aluminum"],
      }),
    );
    expect(aluminum.configurations).toEqual([
      {
        configuration: "lightweight",
        reasons: [{ kind: "material", material: "aluminum" }],
      },
    ]);
    expect(
      aluminum.nodes.filter(({ direct }) => direct).map(({ node }) => node),
    ).toEqual(["isolated-part", "left-part"]);
    expect(aluminum.outputs).toEqual([
      { name: "isolated", node: "isolated-part" },
      { name: "product", node: "product" },
    ]);
  });

  it("expands configuration changes through overrides, parts, and assemblies", () => {
    const report = impactValue(
      analyzeDesignImpact(authoredFixture(), {
        configurations: ["lightweight"],
      }),
    );

    expect(report.configurations).toEqual([
      { configuration: "lightweight", reasons: [{ kind: "seed" }] },
    ]);
    expect(report.parameters).toEqual([
      {
        parameter: "scaled-width",
        reasons: [{ kind: "dependency", parameter: "width" }],
      },
      {
        parameter: "width",
        reasons: [{ kind: "configuration", configuration: "lightweight" }],
      },
    ]);
    expect(
      report.nodes.find(({ node }) => node === "left-part"),
    ).toMatchObject({
      direct: true,
      reasons: [
        { kind: "configuration", configuration: "lightweight" },
        { kind: "dependency", node: "left-solid" },
      ],
    });
    expect(report.nodes.find(({ node }) => node === "product")).toMatchObject({
      direct: true,
      reasons: [
        { kind: "configuration", configuration: "lightweight" },
        { kind: "dependency", node: "left-part" },
      ],
    });
    expect(report.outputs).toEqual([{ name: "product", node: "product" }]);

    const mixed = impactValue(
      analyzeDesignImpact(authoredFixture(), {
        configurations: ["lightweight"],
        materials: ["aluminum"],
      }),
    );
    expect(mixed.configurations).toEqual([
      {
        configuration: "lightweight",
        reasons: [
          { kind: "seed" },
          { kind: "material", material: "aluminum" },
        ],
      },
    ]);
  });

  it("never composes parameter paths from mutually exclusive configurations", () => {
    const parameter = impactValue(
      analyzeDesignImpact(mutuallyExclusiveParameterFixture(), {
        parameters: ["first"],
      }),
    );
    expect(parameter.parameters).toEqual([
      { parameter: "first", reasons: [{ kind: "seed" }] },
      {
        parameter: "second",
        reasons: [{ kind: "dependency", parameter: "first" }],
      },
    ]);
    expect(parameter.nodes).toEqual([]);
    expect(parameter.outputs).toEqual([]);

    const configuration = impactValue(
      analyzeDesignImpact(mutuallyExclusiveParameterFixture(), {
        configurations: ["first-mode"],
      }),
    );
    expect(configuration.parameters).toEqual([
      {
        parameter: "second",
        reasons: [{ kind: "configuration", configuration: "first-mode" }],
      },
    ]);
    expect(configuration.nodes).toEqual([]);
    expect(configuration.outputs).toEqual([]);
  });

  it("keeps parameterized materials in the configuration where they changed", () => {
    const report = impactValue(
      analyzeDesignImpact(separatedMaterialFixture(), {
        configurations: ["density-mode"],
      }),
    );

    expect(report.materials).toEqual([
      {
        material: "steel",
        reasons: [{ kind: "parameter", parameter: "density" }],
      },
    ]);
    expect(report.nodes).toEqual([]);
    expect(report.outputs).toEqual([]);
    expect(report.configurations).toEqual([
      { configuration: "density-mode", reasons: [{ kind: "seed" }] },
    ]);
  });

  it("gates assembly components and placement expressions by suppression", () => {
    const permanentlySuppressed = suppressedAssemblyFixture(false);
    const component = impactValue(
      analyzeDesignImpact(permanentlySuppressed, { nodes: ["part"] }),
    );
    expect(component.nodes).toEqual([
      { node: "part", direct: true, reasons: [{ kind: "seed" }] },
    ]);
    expect(component.outputs).toEqual([]);

    const placement = impactValue(
      analyzeDesignImpact(permanentlySuppressed, {
        parameters: ["offset"],
      }),
    );
    expect(placement.nodes).toEqual([]);
    expect(placement.outputs).toEqual([]);

    const conditionallyEnabled = suppressedAssemblyFixture(true);
    const enabledComponent = impactValue(
      analyzeDesignImpact(conditionallyEnabled, { nodes: ["part"] }),
    );
    expect(enabledComponent.nodes).toEqual([
      {
        node: "assembly",
        direct: false,
        reasons: [{ kind: "dependency", node: "part" }],
      },
      { node: "part", direct: true, reasons: [{ kind: "seed" }] },
    ]);
    expect(enabledComponent.outputs).toEqual([
      { name: "assembly", node: "assembly" },
    ]);

    const enabledPlacement = impactValue(
      analyzeDesignImpact(conditionallyEnabled, {
        parameters: ["offset"],
      }),
    );
    expect(enabledPlacement.nodes).toEqual([
      {
        node: "assembly",
        direct: true,
        reasons: [{ kind: "parameter", parameter: "offset" }],
      },
    ]);
    expect(enabledPlacement.outputs).toEqual([
      { name: "assembly", node: "assembly" },
    ]);

    const enabledConfiguration = impactValue(
      analyzeDesignImpact(conditionallyEnabled, {
        configurations: ["enabled"],
      }),
    );
    expect(enabledConfiguration.nodes).toEqual([
      {
        node: "assembly",
        direct: true,
        reasons: [{ kind: "configuration", configuration: "enabled" }],
      },
    ]);
    expect(enabledConfiguration.outputs).toEqual([
      { name: "assembly", node: "assembly" },
    ]);
  });

  it("keeps bound dependencies active under overrides and removes self edges", () => {
    const cad = design("parameter-bounds-impact");
    const lower = cad.parameter.length("lower", mm(1));
    const bounded = cad.parameter.length("bounded", mm(2), { min: lower });
    const body = cad.box("body", { size: vec3(bounded, mm(1), mm(1)) });
    cad.configuration("overridden", (configuration) =>
      configuration.parameter(bounded, mm(5)),
    );
    cad.output("body", body);
    const document = cad.build();

    const bound = impactValue(
      analyzeDesignImpact(document, { parameters: ["lower"] }),
    );
    expect(bound.parameters).toEqual([
      {
        parameter: "bounded",
        reasons: [{ kind: "dependency", parameter: "lower" }],
      },
      { parameter: "lower", reasons: [{ kind: "seed" }] },
    ]);
    expect(bound.outputs).toEqual([{ name: "body", node: "body" }]);

    const boundedDefinition = Object.entries(document.parameters).find(
      ([id]) => id === "bounded",
    )?.[1];
    if (boundedDefinition === undefined) {
      throw new Error("Missing bounded parameter fixture");
    }
    const selfBound = {
      ...document,
      parameters: {
        ...document.parameters,
        bounded: {
          ...boundedDefinition,
          min: {
            op: "parameter",
            dimension: "length",
            id: "bounded",
          },
        },
      },
    } as unknown as DesignDocument;
    const self = impactValue(
      analyzeDesignImpact(selfBound, { parameters: ["bounded"] }),
    );
    expect(self.parameters).toEqual([
      { parameter: "bounded", reasons: [{ kind: "seed" }] },
    ]);
  });

  it("uses deterministic causal edges inside parameter cycles", () => {
    const cad = design("cyclic-parameter-impact");
    const first = cad.parameter.length("first", mm(1));
    const second = cad.parameter.length("second", mm(2));
    cad.configuration("cyclic", (configuration) =>
      configuration.parameter(first, second).parameter(second, first),
    );
    const body = cad.box("body", { size: vec3(first, mm(1), mm(1)) });
    cad.output("body", body);
    const document = cad.build();

    const parameter = impactValue(
      analyzeDesignImpact(document, { parameters: ["first"] }),
    );
    expect(parameter.parameters).toEqual([
      { parameter: "first", reasons: [{ kind: "seed" }] },
      {
        parameter: "second",
        reasons: [{ kind: "dependency", parameter: "first" }],
      },
    ]);

    const configuration = impactValue(
      analyzeDesignImpact(document, { configurations: ["cyclic"] }),
    );
    expect(configuration.parameters).toEqual([
      {
        parameter: "first",
        reasons: [{ kind: "configuration", configuration: "cyclic" }],
      },
      {
        parameter: "second",
        reasons: [{ kind: "configuration", configuration: "cyclic" }],
      },
    ]);

    const mixed = impactValue(
      analyzeDesignImpact(document, {
        configurations: ["cyclic"],
        parameters: ["first"],
      }),
    );
    expect(
      mixed.parameters.find(({ parameter }) => parameter === "first")?.reasons,
    ).toEqual([
      { kind: "seed" },
      { kind: "configuration", configuration: "cyclic" },
    ]);
    expect(
      mixed.parameters.find(({ parameter }) => parameter === "second")
        ?.reasons,
    ).toEqual([
      { kind: "configuration", configuration: "cyclic" },
      { kind: "dependency", parameter: "first" },
    ]);
  });

  it("propagates a topology-reference change only through its consumers", () => {
    const report = impactValue(
      analyzeDesignImpact(persistentFixture(), {
        topologyReferences: ["stored-edge"],
      }),
    );

    expect(report.nodes).toEqual([
      {
        node: "placed",
        direct: false,
        reasons: [{ kind: "dependency", node: "treated" }],
      },
      {
        node: "treated",
        direct: true,
        reasons: [
          { kind: "topologyReference", topologyReference: "stored-edge" },
        ],
      },
    ]);
    expect(report.outputs).toEqual([{ name: "placed", node: "placed" }]);
  });

  it("deduplicates and canonically orders mixed node seeds and reason edges", () => {
    const report = impactValue(
      analyzeDesignImpact(authoredFixture(), {
        nodes: [
          "right-solid",
          "left-solid",
          "right-solid",
        ],
      }),
    );

    expect(report.seeds.nodes).toEqual(["left-solid", "right-solid"]);
    expect(report.nodes.find(({ node }) => node === "product")?.reasons).toEqual(
      [
        { kind: "dependency", node: "left-part" },
        { kind: "dependency", node: "right-part" },
      ],
    );
  });

  it("rejects empty, malformed, sparse, and unknown change seeds", () => {
    const document = authoredFixture();
    expect(analyzeDesignImpact(document, {}).diagnostics[0]).toMatchObject({
      code: "IR_INVALID",
      path: "/changes",
    });
    expect(
      analyzeDesignImpact(document, {
        nodes: "root",
      } as unknown as Parameters<typeof analyzeDesignImpact>[1]).diagnostics[0],
    ).toMatchObject({ code: "IR_INVALID", path: "/changes/nodes" });
    const sparse = new Array<never>(1);
    expect(
      analyzeDesignImpact(document, { nodes: sparse }).diagnostics[0],
    ).toMatchObject({ code: "IR_INVALID", path: "/changes/nodes/0" });

    const unknown = analyzeDesignImpact(document, {
      nodes: ["missing-node"],
      parameters: ["missing-parameter"],
      materials: ["missing-material"],
      configurations: ["missing-configuration"],
      topologyReferences: ["missing-reference"],
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "REFERENCE_MISSING", path: "/changes/nodes/0" },
      { code: "PARAMETER_MISSING", path: "/changes/parameters/0" },
      { code: "REFERENCE_MISSING", path: "/changes/materials/0" },
      {
        code: "CONFIGURATION_MISSING",
        path: "/changes/configurations/0",
      },
      {
        code: "REFERENCE_MISSING",
        path: "/changes/topologyReferences/0",
      },
    ]);
  });

  it("captures hostile change inputs once and rejects non-plain boundaries", () => {
    const document = authoredFixture();

    class ChangesWithPrototype {
      readonly nodes = ["root"];
    }
    expect(
      analyzeDesignImpact(document, new ChangesWithPrototype()).diagnostics[0],
    ).toMatchObject({ code: "IR_INVALID", path: "/changes" });

    const inherited = Object.create({ nodes: ["root"] }) as {
      readonly nodes: readonly string[];
    };
    expect(analyzeDesignImpact(document, inherited).diagnostics[0]).toMatchObject(
      { code: "IR_INVALID", path: "/changes" },
    );

    expect(
      analyzeDesignImpact(
        document,
        { nodes: ["root"] },
        new Date() as unknown as Parameters<typeof analyzeDesignImpact>[2],
      ).diagnostics[0],
    ).toMatchObject({ code: "IR_INVALID" });

    expect(
      analyzeDesignImpact(document, { nodes: ["not a valid id"] })
        .diagnostics[0],
    ).toMatchObject({ code: "IR_INVALID", path: "/changes/nodes/0" });

    let lengthReads = 0;
    const changingLength = new Proxy(["root"], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 1 : 1_000_001;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(analyzeDesignImpact(document, { nodes: changingLength }).ok).toBe(
      true,
    );
    expect(lengthReads).toBe(1);

    for (const invalidLength of [-1, Number.NaN, 0.5]) {
      const invalidArray = new Proxy(["root"], {
        get(target, property, receiver) {
          return property === "length"
            ? invalidLength
            : Reflect.get(target, property, receiver);
        },
      });
      expect(
        analyzeDesignImpact(document, { nodes: invalidArray }).diagnostics[0],
      ).toMatchObject({ code: "IR_INVALID", path: "/changes/nodes" });
    }

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(
      analyzeDesignImpact(
        document,
        revoked.proxy as Parameters<typeof analyzeDesignImpact>[1],
      ).diagnostics[0],
    ).toMatchObject({ code: "IR_INVALID" });

    const thrown = Proxy.revocable({}, {});
    thrown.revoke();
    const throwingChanges = Object.defineProperty({}, "nodes", {
      enumerable: true,
      get(): never {
        throw thrown.proxy;
      },
    });
    expect(
      analyzeDesignImpact(
        document,
        throwingChanges as Parameters<typeof analyzeDesignImpact>[1],
      ).diagnostics[0],
    ).toMatchObject({ code: "IR_INVALID" });

    const crossRealmChanges = runInNewContext('({ nodes: ["root"] })') as {
      readonly nodes: readonly string[];
    };
    const crossRealmOptions = runInNewContext("({ limits: {} })") as Parameters<
      typeof analyzeDesignImpact
    >[2];
    expect(
      analyzeDesignImpact(document, crossRealmChanges, crossRealmOptions).ok,
    ).toBe(true);
  });

  it("bounds context-qualified propagation work", () => {
    const cad = design("impact-work-budget");
    const parameters = Array.from({ length: 16 }, (_, index) =>
      cad.parameter.length(`parameter-${index}`, mm(index + 1)),
    );
    const body = cad.box("body", {
      size: vec3(parameters[0]!, mm(1), mm(1)),
    });
    for (let index = 0; index < parameters.length; index += 1) {
      cad.configuration(`configuration-${index}`, (configuration) =>
        configuration.parameter(
          parameters[index]!,
          parameters[(index + 1) % parameters.length]!,
        ),
      );
    }
    cad.output("body", body);

    const result = analyzeDesignImpact(
      cad.build(),
      { parameters: parameters.map(({ id }) => id) },
      { limits: { maxStructuralValues: 300 } },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "IR_INVALID",
      details: {
        resource: "maxStructuralValues",
        phase: "designImpact",
        limit: 300,
        actual: 301,
      },
    });
  });

  it("supports every frozen document grammar without migration", () => {
    const cad = design("impact-version-compatibility");
    const box = cad.box("box", { size: vec3(mm(1), mm(2), mm(3)) });
    cad.output("box", box);
    const current = cad.build();
    const versions = [
      [1, DOCUMENT_SCHEMA_V1],
      [2, DOCUMENT_SCHEMA_V2],
      [3, DOCUMENT_SCHEMA_V3],
      [4, DOCUMENT_SCHEMA_V4],
      [5, DOCUMENT_SCHEMA_V5],
      [6, DOCUMENT_SCHEMA_V6],
    ] as const;

    for (const [version, schema] of versions) {
      const document = {
        ...current,
        version,
        schema,
      } as DesignDocument;
      const result = analyzeDesignImpact(document, {
        nodes: ["box"],
      });
      expect(result.ok, `document v${version}`).toBe(true);
      if (result.ok) {
        expect(result.value.nodes).toEqual([
          { node: "box", direct: true, reasons: [{ kind: "seed" }] },
        ]);
      }
    }
  });
});
