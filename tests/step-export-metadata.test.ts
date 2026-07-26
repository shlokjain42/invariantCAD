import { describe, expect, it } from "vitest";
import {
  CadError,
  DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP,
  GEOMETRY_KERNEL_PROTOCOL_VERSION,
  KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
  EvaluatedSolid,
  createEvaluator,
  design,
  mm,
  vec3,
  type DesignDocument,
  type GeometryKernel,
  type KernelExchangeFormat,
  type KernelShape,
  type KernelShapeExportContext,
  type ShapeMeasurements,
  type StepExportMetadata,
  type StepExportOptions,
} from "../src/index.js";

function expectStepOptionsError(
  operation: () => unknown,
  path: string,
  message: string,
): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CadError);
  if (!(thrown instanceof CadError)) return;
  expect(thrown.diagnostics).toEqual([
    {
      code: "EXPORT_OPTIONS_INVALID",
      severity: "error",
      message: expect.stringContaining(message),
      path,
      details: {
        operation: "export",
        format: "step",
      },
    },
  ]);
}

interface FakeShape extends KernelShape {
  readonly serial: number;
}

interface ExportCall {
  readonly shape: FakeShape;
  readonly format: KernelExchangeFormat;
  readonly context: KernelShapeExportContext | undefined;
}

const measurements: ShapeMeasurements = {
  volume: 1,
  surfaceArea: 6,
  boundingBox: { min: [0, 0, 0], max: [1, 1, 1] },
  centerOfMass: [0.5, 0.5, 0.5],
  inertiaTensor: [
    [1 / 6, 0, 0],
    [0, 1 / 6, 0],
    [0, 0, 1 / 6],
  ],
  genus: 0,
  tolerance: 1e-7,
};

function createStepKernel(): {
  readonly kernel: GeometryKernel;
  readonly exportCalls: ExportCall[];
  readonly disposeShapeCalls: () => number;
} {
  let nextSerial = 1;
  let disposedShapes = 0;
  const live = new Set<FakeShape>();
  const exportCalls: ExportCall[] = [];
  const encoder = new TextEncoder();

  const kernel: GeometryKernel = {
    id: "step-export-metadata-test",
    capabilities: {
      protocolVersion: GEOMETRY_KERNEL_PROTOCOL_VERSION,
      representation: "brep",
      exact: true,
      primitives: ["box"],
      features: [],
      nativeImports: [],
      nativeExports: ["step", "brep"],
      stepExport: {
        protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
        schema: "AP214IS",
        byteDeterminism: "same-shape-representation-and-metadata",
        maxOutputBytes: 1_048_576,
        maxMetadataBytes: 1_024,
      },
    },
    box(): KernelShape {
      const shape: FakeShape = {
        kernel: "step-export-metadata-test",
        serial: nextSerial,
      };
      nextSerial += 1;
      live.add(shape);
      return shape;
    },
    mesh() {
      return {
        positions: new Float32Array(),
        indices: new Uint32Array(),
      };
    },
    measure() {
      return measurements;
    },
    status(shape) {
      return live.has(shape as FakeShape)
        ? { ok: true, code: "VALID" }
        : { ok: false, code: "DISPOSED" };
    },
    exportShape(shape, format, context) {
      exportCalls.push({
        shape: shape as FakeShape,
        format,
        context,
      });
      return encoder.encode(`mock-${format}`);
    },
    disposeShape(shape) {
      disposedShapes += 1;
      live.delete(shape as FakeShape);
    },
    dispose() {},
  };

  return {
    kernel,
    exportCalls,
    disposeShapeCalls: () => disposedShapes,
  };
}

async function evaluateSolid(
  kernel: GeometryKernel,
  document: DesignDocument,
  outputName: string,
) {
  const evaluator = await createEvaluator({ kernel });
  const result = await evaluator.evaluate(document);
  if (!result.ok) {
    evaluator.dispose();
    throw new Error(
      result.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join("\n"),
    );
  }
  const output = result.value.output(outputName);
  if (!(output instanceof EvaluatedSolid)) {
    result.value.dispose();
    evaluator.dispose();
    throw new Error(`Expected '${outputName}' to evaluate to a solid`);
  }
  return { evaluator, evaluated: result.value, output };
}

describe("high-level STEP export metadata", () => {
  it("maps document and solid-output identity and forwards explicit options", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const cad = design("fixture-document");
    const box = cad.box("source-box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("shipping-alias", box);

    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "shipping-alias",
    );
    try {
      expect(output.export("step")).toEqual(
        new TextEncoder().encode("mock-step"),
      );
      expect(exportCalls[0]).toEqual({
        shape: expect.objectContaining({ kernel: kernel.id }),
        format: "step",
        context: {
          feature: "shipping-alias",
          stepExport: {
            protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
            metadata: {
              fileName: "fixture-document",
              timestamp: DEFAULT_KERNEL_STEP_EXPORT_TIMESTAMP,
              productId: "shipping-alias",
              productName: "shipping-alias",
              productDescription: "",
            },
          },
        },
      });

      const metadata: StepExportMetadata = {
        fileName: "release.step",
        timestamp: "2026-07-26T12:34:56",
        productId: "PN-OVERRIDE",
        productName: "Explicit product",
        productDescription: "Explicit description",
      };
      const controller = new AbortController();
      const options: StepExportOptions = {
        metadata,
        signal: controller.signal,
        maxOutputBytes: 4_096,
      };
      output.export("step", options);

      expect(exportCalls[1]?.context).toEqual({
        feature: "shipping-alias",
        signal: controller.signal,
        stepExport: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
          metadata,
          maxOutputBytes: 4_096,
        },
      });
    } finally {
      evaluated.dispose();
      evaluator.dispose();
    }
  });

  it("maps authored part identity without inventing material metadata", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const cad = design("part-document");
    const body = cad.box("part-body", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    const part = cad.part("valve-body", body, {
      partNumber: "VALVE-100",
      description: "Machined valve body",
      material: "AISI 316",
    });
    const blankNumberPart = cad.part("blank-number-part", body, {
      partNumber: "   ",
    });
    cad.output("customer-part", part);
    cad.output("blank-customer-part", blankNumberPart);

    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "customer-part",
    );
    try {
      output.export("step");

      const metadata = exportCalls[0]?.context?.stepExport?.metadata;
      expect(metadata).toEqual({
        fileName: "part-document",
        timestamp: "1970-01-01T00:00:00",
        productId: "VALVE-100",
        productName: "valve-body",
        productDescription: "Machined valve body",
      });
      expect(JSON.stringify(metadata)).not.toContain("AISI 316");
      expect(JSON.stringify(metadata)).not.toContain("material");

      const blankOutput = evaluated.output("blank-customer-part");
      expect(blankOutput).toBeInstanceOf(EvaluatedSolid);
      if (blankOutput instanceof EvaluatedSolid) {
        blankOutput.export("step");
        expect(exportCalls[1]?.context?.stepExport?.metadata).toMatchObject({
          productId: "blank-number-part",
          productName: "blank-number-part",
        });
      }
    } finally {
      evaluated.dispose();
      evaluator.dispose();
    }
  });

  it("rejects STEP-only options for every other export format", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const cad = design("format-boundary");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);

    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );
    try {
      expect(() =>
        Reflect.apply(output.export, output, ["brep", { metadata: {} }]),
      ).toThrow("STEP export options require the 'step' format");
      expect(exportCalls).toHaveLength(0);
    } finally {
      evaluated.dispose();
      evaluator.dispose();
    }
  });

  it("captures the JavaScript options boundary without invoking accessors", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const cad = design("hostile-options");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);
    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );
    let getterInvocations = 0;
    const optionsAccessor = {};
    Object.defineProperty(optionsAccessor, "metadata", {
      get() {
        getterInvocations += 1;
        return {};
      },
    });
    const metadataAccessor = {};
    Object.defineProperty(metadataAccessor, "productId", {
      get() {
        getterInvocations += 1;
        return "must-not-run";
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    try {
      for (const invalid of [
        null,
        [],
        "options",
        42,
        { metadata: null },
        { metadata: [] },
        { metadata: "metadata" },
        { metadata: { productId: 42 } },
        { metadata: metadataAccessor },
        optionsAccessor,
        Object.create({ metadata: {} }),
        { signal: { aborted: false } },
        { maxOutputBytes: 0 },
        { maxOutputBytes: 1.5 },
        revoked.proxy,
      ]) {
        expect(() =>
          Reflect.apply(output.export, output, ["step", invalid]),
        ).toThrow();
      }
      expect(getterInvocations).toBe(0);
      expect(exportCalls).toHaveLength(0);
    } finally {
      evaluated.dispose();
      evaluator.dispose();
    }
  });

  it("reports invalid public STEP options with stable codes and field paths", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const cad = design("structured-step-errors");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);
    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );

    try {
      for (const [options, path, message] of [
        [null, "/", "options must be an object"],
        [{ metadata: null }, "/metadata", "metadata must be an object"],
        [
          { metadata: { productId: 42 } },
          "/metadata/productId",
          "productId must be a string",
        ],
        [
          { metadata: { timestamp: "2026-02-30T12:00:00" } },
          "/metadata/timestamp",
          "outside the supported calendar range",
        ],
        [
          { metadata: { fileName: "" } },
          "/metadata/fileName",
          "fileName must be nonempty",
        ],
        [
          { metadata: { productName: "bad\u007fcontrol" } },
          "/metadata/productName",
          "must not contain control characters",
        ],
        [
          { metadata: { productDescription: "bad\ud800" } },
          "/metadata/productDescription",
          "must not contain unpaired surrogates",
        ],
        [
          { signal: { aborted: false } },
          "/signal",
          "signal must not shadow AbortSignal.aborted",
        ],
        [
          { maxOutputBytes: 0 },
          "/maxOutputBytes",
          "maxOutputBytes must be a positive safe integer",
        ],
      ] as const) {
        expectStepOptionsError(
          () => Reflect.apply(output.export, output, ["step", options]),
          path,
          message,
        );
      }
      expect(exportCalls).toHaveLength(0);
    } finally {
      evaluated.dispose();
      evaluator.dispose();
    }
  });

  it("constructs structured errors without invoking CadError prototype setters", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const cad = design("cad-error-prototype-boundary");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);
    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );
    const priorNameDescriptor = Object.getOwnPropertyDescriptor(
      CadError.prototype,
      "name",
    );
    const marker = Object.create(null);
    let setterInvocations = 0;
    const options = new Proxy({}, {
      getOwnPropertyDescriptor() {
        Object.defineProperty(CadError.prototype, "name", {
          configurable: true,
          set() {
            setterInvocations += 1;
            throw marker;
          },
        });
        throw marker;
      },
    });

    try {
      expectStepOptionsError(
        () => {
          try {
            Reflect.apply(output.export, output, ["step", options]);
          } finally {
            if (priorNameDescriptor === undefined) {
              Reflect.deleteProperty(CadError.prototype, "name");
            } else {
              Object.defineProperty(
                CadError.prototype,
                "name",
                priorNameDescriptor,
              );
            }
          }
        },
        "/metadata",
        "metadata could not be inspected safely",
      );
      expect(setterInvocations).toBe(0);
      expect(exportCalls).toHaveLength(0);
    } finally {
      if (priorNameDescriptor === undefined) {
        Reflect.deleteProperty(CadError.prototype, "name");
      } else {
        Object.defineProperty(
          CadError.prototype,
          "name",
          priorNameDescriptor,
        );
      }
      evaluated.dispose();
      evaluator.dispose();
    }
  });

  it("enforces the advertised authored-metadata budget before kernel dispatch", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const capability = kernel.capabilities.stepExport;
    if (capability === undefined) {
      throw new Error("Expected deterministic STEP capability");
    }
    Object.defineProperty(kernel.capabilities, "stepExport", {
      configurable: true,
      enumerable: true,
      value: {
        ...capability,
        maxMetadataBytes: 21,
      },
    });
    const cad = design("metadata-budget");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);
    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );

    try {
      expectStepOptionsError(
        () =>
          output.export("step", {
            metadata: {
              fileName: "a",
              timestamp: "2026-07-26T12:00:00",
              productId: "a",
              productName: "a",
              productDescription: "",
            },
          }),
        "/metadata/productName",
        "exceeds maxMetadataBytes 21",
      );
      expect(exportCalls).toHaveLength(0);
    } finally {
      evaluated.dispose();
      evaluator.dispose();
    }
  });

  it("does not relabel custom-kernel failures as invalid caller options", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const kernelFailure = new TypeError("custom writer failed");
    Object.defineProperty(kernel, "exportShape", {
      configurable: true,
      value() {
        throw kernelFailure;
      },
    });
    const cad = design("kernel-error-boundary");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);
    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );

    try {
      let thrown: unknown;
      try {
        output.export("step");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(kernelFailure);
      expect(thrown).not.toBeInstanceOf(CadError);
      expect(exportCalls).toHaveLength(0);
    } finally {
      evaluated.dispose();
      evaluator.dispose();
    }
  });

  it("isolates captured records from prototype pollution during proxy inspection", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const cad = design("prototype-boundary");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);
    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );
    const metadata = new Proxy({}, {
      getOwnPropertyDescriptor() {
        return undefined;
      },
      has() {
        Object.defineProperty(Object.prototype, "fileName", {
          configurable: true,
          enumerable: true,
          value: "POLLUTED.step",
          writable: true,
        });
        return false;
      },
    });
    const options = new Proxy(
      { metadata },
      {
        has(_target, property) {
          if (property === "signal") {
            Object.defineProperty(Object.prototype, "signal", {
              configurable: true,
              enumerable: true,
              value: { aborted: true },
              writable: true,
            });
            Object.defineProperty(Object.prototype, "maxOutputBytes", {
              configurable: true,
              enumerable: true,
              value: 1,
              writable: true,
            });
          }
          return false;
        },
      },
    );

    let context: KernelShapeExportContext | undefined;
    try {
      output.export("step", options);
      context = exportCalls[0]?.context;
    } finally {
      Reflect.deleteProperty(Object.prototype, "fileName");
      Reflect.deleteProperty(Object.prototype, "signal");
      Reflect.deleteProperty(Object.prototype, "maxOutputBytes");
      evaluated.dispose();
      evaluator.dispose();
    }

    expect(context?.stepExport?.metadata.fileName).toBe(
      "prototype-boundary",
    );
    expect(context?.signal).toBeUndefined();
    expect(context?.stepExport?.maxOutputBytes).toBeUndefined();
    expect(Object.hasOwn(context ?? {}, "signal")).toBe(false);
    expect(Object.hasOwn(context?.stepExport ?? {}, "maxOutputBytes")).toBe(
      false,
    );
  });

  it("rejects shadowed and time-of-check/time-of-use signals before kernel work", async () => {
    const { kernel, exportCalls } = createStepKernel();
    const cad = design("signal-boundary");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);
    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );

    try {
      const shadowed = new AbortController();
      let shadowReads = 0;
      Object.defineProperty(shadowed.signal, "aborted", {
        configurable: true,
        get() {
          shadowReads += 1;
          return false;
        },
      });
      expect(() =>
        output.export("step", { signal: shadowed.signal }),
      ).toThrow("must not shadow AbortSignal.aborted");
      expect(shadowReads).toBe(0);

      const prototypeChanged = new AbortController();
      Object.setPrototypeOf(prototypeChanged.signal, {
        aborted: false,
      });
      expect(() =>
        output.export("step", { signal: prototypeChanged.signal }),
      ).toThrow("must resolve AbortSignal.aborted");

      const changed = new AbortController();
      changed.abort();
      const target = { signal: changed.signal };
      const options = new Proxy(target, {
        getOwnPropertyDescriptor(inner, property) {
          if (property === "maxOutputBytes") {
            Object.defineProperty(changed.signal, "aborted", {
              configurable: true,
              value: false,
            });
          }
          return Reflect.getOwnPropertyDescriptor(inner, property);
        },
      });
      expect(() => output.export("step", options)).toThrow(
        "must not shadow AbortSignal.aborted",
      );
      expect(exportCalls).toHaveLength(0);
    } finally {
      evaluated.dispose();
      evaluator.dispose();
    }
  });

  it("rechecks evaluation ownership after hostile option inspection", async () => {
    const {
      kernel,
      exportCalls,
      disposeShapeCalls,
    } = createStepKernel();
    const cad = design("ownership-boundary");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);
    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );
    const options = new Proxy({}, {
      getOwnPropertyDescriptor() {
        evaluated.dispose();
        return undefined;
      },
      has() {
        return false;
      },
    });

    try {
      expect(() => output.export("step", options)).toThrow(
        "This evaluation result has been disposed",
      );
      expect(exportCalls).toHaveLength(0);
      expect(disposeShapeCalls()).toBe(1);
    } finally {
      evaluated.dispose();
      evaluator.dispose();
    }
    expect(disposeShapeCalls()).toBe(1);
  });

  it("keeps weak feature contexts immune to Object.prototype additions", async () => {
    const { kernel, exportCalls } = createStepKernel();
    Object.defineProperty(kernel.capabilities, "stepExport", {
      configurable: true,
      enumerable: true,
      value: undefined,
    });
    const cad = design("weak-prototype-boundary");
    const box = cad.box("box", {
      size: vec3(mm(1), mm(1), mm(1)),
    });
    cad.output("box", box);
    const { evaluator, evaluated, output } = await evaluateSolid(
      kernel,
      cad.build(),
      "box",
    );

    let context: KernelShapeExportContext | undefined;
    try {
      Object.defineProperty(Object.prototype, "signal", {
        configurable: true,
        value: { aborted: true },
      });
      Object.defineProperty(Object.prototype, "stepExport", {
        configurable: true,
        value: { protocolVersion: 999 },
      });
      output.export("step");
      context = exportCalls[0]?.context;
    } finally {
      Reflect.deleteProperty(Object.prototype, "signal");
      Reflect.deleteProperty(Object.prototype, "stepExport");
      evaluated.dispose();
      evaluator.dispose();
    }

    expect(context?.feature).toBe("box");
    expect(context?.signal).toBeUndefined();
    expect(context?.stepExport).toBeUndefined();
    expect(Object.getPrototypeOf(context)).toBeNull();
    expect(Object.keys(context ?? {})).toEqual(["feature"]);
  });

  it("never silently ignores explicit options on weak or malformed kernels", async () => {
    for (const [stepExport, message] of [
      [undefined, "does not advertise deterministic STEP export"],
      [
        {
          protocolVersion: 99,
          schema: "AP214IS",
          byteDeterminism: "same-shape-representation-and-metadata",
          maxOutputBytes: 1_048_576,
          maxMetadataBytes: 1_024,
        },
        "advertises malformed deterministic STEP export metadata",
      ],
    ] as const) {
      const { kernel, exportCalls } = createStepKernel();
      Object.defineProperty(kernel.capabilities, "stepExport", {
        configurable: true,
        enumerable: true,
        value: stepExport,
      });
      const cad = design("weak-step");
      const box = cad.box("box", {
        size: vec3(mm(1), mm(1), mm(1)),
      });
      cad.output("box", box);
      const { evaluator, evaluated, output } = await evaluateSolid(
        kernel,
        cad.build(),
        "box",
      );
      try {
        expect(output.export("step")).toEqual(
          new TextEncoder().encode("mock-step"),
        );
        expect(exportCalls[0]?.context).toEqual({ feature: "box" });
        expect(() => output.export("step", {})).toThrow(message);
        expect(exportCalls).toHaveLength(1);
      } finally {
        evaluated.dispose();
        evaluator.dispose();
      }
    }
  });
});
