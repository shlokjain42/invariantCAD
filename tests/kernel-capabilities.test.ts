import { describe, expect, it } from "vitest";
import {
  COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  KERNEL_MEASUREMENT_PROTOCOL_VERSION,
  KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
  createEvaluator,
  createManifoldKernel,
  design,
  inspectKernelCompositeSweepCapabilities,
  inspectKernelDocumentBodyImportCapabilities,
  inspectKernelMeasurementCapabilities,
  inspectKernelStepExportCapabilities,
  kernelSupports,
  kernelSupportsDocumentBodyImport,
  mm,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelCompositeSweepRefinement,
  type KernelGenusMeasurementCapability,
} from "../src/index.js";

describe("kernel capability negotiation", () => {
  it("negotiates exact genus measurements with an isolated hostile-safe snapshot", () => {
    const base: KernelCapabilities = {
      protocolVersion: 1,
      representation: "mesh",
      exact: false,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: [],
    };
    expect(inspectKernelMeasurementCapabilities(base)).toEqual({
      status: "absent",
    });
    expect(
      inspectKernelMeasurementCapabilities({
        ...base,
        measurements: undefined,
      } as unknown as KernelCapabilities),
    ).toEqual({ status: "absent" });
    expect(kernelSupports(base, "measurement", "genus")).toBe(false);

    const metadata: {
      protocolVersion: typeof KERNEL_MEASUREMENT_PROTOCOL_VERSION;
      genus: KernelGenusMeasurementCapability;
    } = {
      protocolVersion: KERNEL_MEASUREMENT_PROTOCOL_VERSION,
      genus: "exact-per-connected-component",
    };
    const valid = inspectKernelMeasurementCapabilities({
      ...base,
      measurements: metadata,
    });
    expect(valid).toEqual({
      status: "valid",
      capabilities: {
        protocolVersion: KERNEL_MEASUREMENT_PROTOCOL_VERSION,
        genus: "exact-per-connected-component",
      },
    });
    expect(valid.status === "valid" && Object.isFrozen(valid.capabilities)).toBe(
      true,
    );
    metadata.genus = "unsupported";
    expect(valid.status === "valid" ? valid.capabilities.genus : undefined).toBe(
      "exact-per-connected-component",
    );
    expect(
      kernelSupports(
        {
          ...base,
          measurements:
            valid.status === "valid" ? valid.capabilities : metadata,
        },
        "measurement",
        "genus",
      ),
    ).toBe(true);
    expect(
      kernelSupports(
        {
          ...base,
          measurements: {
            protocolVersion: KERNEL_MEASUREMENT_PROTOCOL_VERSION,
            genus: "unsupported",
          },
        },
        "measurement",
        "genus",
      ),
    ).toBe(false);

    for (const [envelope, reason] of [
      [null, "not-object"],
      [
        {
          protocolVersion: KERNEL_MEASUREMENT_PROTOCOL_VERSION + 1,
          genus: "exact-per-connected-component",
        },
        "unsupported-protocol-version",
      ],
      [
        {
          protocolVersion: KERNEL_MEASUREMENT_PROTOCOL_VERSION,
          genus: "approximate",
        },
        "invalid-genus",
      ],
    ] as const) {
      const capabilities = {
        ...base,
        measurements: envelope,
      } as unknown as KernelCapabilities;
      expect(inspectKernelMeasurementCapabilities(capabilities)).toEqual(
        expect.objectContaining({ status: "malformed", reason }),
      );
      expect(kernelSupports(capabilities, "measurement", "genus")).toBe(false);
    }

    let getterInvoked = false;
    const accessorEnvelope = {
      protocolVersion: KERNEL_MEASUREMENT_PROTOCOL_VERSION,
    };
    Object.defineProperty(accessorEnvelope, "genus", {
      enumerable: true,
      get() {
        getterInvoked = true;
        throw new Error("must not run");
      },
    });
    expect(
      inspectKernelMeasurementCapabilities({
        ...base,
        measurements: accessorEnvelope as never,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
      }),
    );
    expect(getterInvoked).toBe(false);

    const outerAccessor = { ...base } as KernelCapabilities;
    Object.defineProperty(outerAccessor, "measurements", {
      get() {
        getterInvoked = true;
        throw new Error("must not run");
      },
    });
    expect(inspectKernelMeasurementCapabilities(outerAccessor)).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
      }),
    );
    expect(getterInvoked).toBe(false);

    const hostileEnvelope = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw Object.create(null);
        },
      },
    );
    expect(
      inspectKernelMeasurementCapabilities({
        ...base,
        measurements: hostileEnvelope as never,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
      }),
    );

    const revoked = Proxy.revocable({}, {});
    const revokedCapabilities = {
      ...base,
      measurements: revoked.proxy,
    } as unknown as KernelCapabilities;
    revoked.revoke();
    expect(() =>
      inspectKernelMeasurementCapabilities(revokedCapabilities),
    ).not.toThrow();
    expect(inspectKernelMeasurementCapabilities(revokedCapabilities)).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
      }),
    );

    const revokedField = Proxy.revocable({}, {});
    const revokedFieldCapabilities = {
      ...base,
      measurements: {
        protocolVersion: KERNEL_MEASUREMENT_PROTOCOL_VERSION,
        genus: revokedField.proxy,
      },
    } as unknown as KernelCapabilities;
    revokedField.revoke();
    expect(() =>
      inspectKernelMeasurementCapabilities(revokedFieldCapabilities),
    ).not.toThrow();
    expect(
      inspectKernelMeasurementCapabilities(revokedFieldCapabilities),
    ).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "invalid-genus",
        details: { genus: "object" },
      }),
    );
  });

  it("negotiates deterministic STEP export with an isolated hostile-safe snapshot", () => {
    const base: KernelCapabilities = {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: ["step"],
    };
    expect(inspectKernelStepExportCapabilities(base)).toEqual({
      status: "absent",
    });
    expect(
      inspectKernelStepExportCapabilities({
        ...base,
        stepExport: undefined,
      } as unknown as KernelCapabilities),
    ).toEqual({ status: "absent" });

    const metadata: {
      protocolVersion: number;
      schema: string;
      byteDeterminism: string;
      maxOutputBytes: number;
      maxMetadataBytes: number;
    } = {
      protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
      schema: "AP214IS",
      byteDeterminism: "same-shape-representation-and-metadata",
      maxOutputBytes: 16_777_216,
      maxMetadataBytes: 4_096,
    };
    const valid = inspectKernelStepExportCapabilities({
      ...base,
      stepExport: metadata,
    } as unknown as KernelCapabilities);
    expect(valid).toEqual({
      status: "valid",
      capabilities: {
        protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
        schema: "AP214IS",
        byteDeterminism: "same-shape-representation-and-metadata",
        maxOutputBytes: 16_777_216,
        maxMetadataBytes: 4_096,
      },
    });
    expect(valid.status === "valid" && Object.isFrozen(valid.capabilities)).toBe(
      true,
    );
    metadata.protocolVersion = KERNEL_STEP_EXPORT_PROTOCOL_VERSION + 1;
    metadata.schema = "AP203";
    metadata.byteDeterminism = "none";
    metadata.maxOutputBytes = 1;
    metadata.maxMetadataBytes = 1;
    expect(valid).toEqual({
      status: "valid",
      capabilities: {
        protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
        schema: "AP214IS",
        byteDeterminism: "same-shape-representation-and-metadata",
        maxOutputBytes: 16_777_216,
        maxMetadataBytes: 4_096,
      },
    });

    for (const limit of [1, Number.MAX_SAFE_INTEGER]) {
      expect(
        inspectKernelStepExportCapabilities({
          ...base,
          stepExport: {
            protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
            schema: "AP214IS",
            byteDeterminism: "same-shape-representation-and-metadata",
            maxOutputBytes: limit,
            maxMetadataBytes: limit,
          },
        }),
      ).toEqual({
        status: "valid",
        capabilities: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
          schema: "AP214IS",
          byteDeterminism: "same-shape-representation-and-metadata",
          maxOutputBytes: limit,
          maxMetadataBytes: limit,
        },
      });
    }

    const malformedCases: readonly {
      readonly envelope: unknown;
      readonly reason: string;
      readonly details?: Readonly<Record<string, unknown>>;
    }[] = [
      {
        envelope: null,
        reason: "not-object",
        details: { actualType: "null" },
      },
      {
        envelope: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION + 1,
          schema: "AP214IS",
          byteDeterminism: "same-shape-representation-and-metadata",
          maxOutputBytes: 1,
          maxMetadataBytes: 1,
        },
        reason: "unsupported-protocol-version",
      },
      {
        envelope: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
          schema: "AP203",
          byteDeterminism: "same-shape-representation-and-metadata",
          maxOutputBytes: 1,
          maxMetadataBytes: 1,
        },
        reason: "invalid-schema",
        details: { schema: "AP203" },
      },
      {
        envelope: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
          schema: "AP214IS",
          byteDeterminism: "geometrically-equivalent",
          maxOutputBytes: 1,
          maxMetadataBytes: 1,
        },
        reason: "invalid-byte-determinism",
        details: { byteDeterminism: "geometrically-equivalent" },
      },
      {
        envelope: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
          schema: "AP214IS",
          byteDeterminism: "same-shape-representation-and-metadata",
          maxOutputBytes: 0,
          maxMetadataBytes: 1,
        },
        reason: "invalid-max-output-bytes",
        details: { maxOutputBytes: 0 },
      },
      {
        envelope: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
          schema: "AP214IS",
          byteDeterminism: "same-shape-representation-and-metadata",
          maxOutputBytes: 1,
          maxMetadataBytes: Number.MAX_SAFE_INTEGER + 1,
        },
        reason: "invalid-max-metadata-bytes",
        details: { maxMetadataBytes: Number.MAX_SAFE_INTEGER + 1 },
      },
    ];
    for (const testCase of malformedCases) {
      expect(
        inspectKernelStepExportCapabilities({
          ...base,
          stepExport: testCase.envelope,
        } as unknown as KernelCapabilities),
      ).toEqual(
        expect.objectContaining({
          status: "malformed",
          reason: testCase.reason,
          ...(testCase.details === undefined
            ? {}
            : { details: expect.objectContaining(testCase.details) }),
        }),
      );
    }

    let getterInvocations = 0;
    const outerAccessor = { ...base } as KernelCapabilities;
    Object.defineProperty(outerAccessor, "stepExport", {
      get() {
        getterInvocations += 1;
        throw new Error("must not run");
      },
    });
    expect(inspectKernelStepExportCapabilities(outerAccessor)).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
        details: { property: "stepExport" },
      }),
    );
    expect(getterInvocations).toBe(0);

    for (const property of [
      "protocolVersion",
      "schema",
      "byteDeterminism",
      "maxOutputBytes",
      "maxMetadataBytes",
    ] as const) {
      const accessorEnvelope = {
        protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
        schema: "AP214IS",
        byteDeterminism: "same-shape-representation-and-metadata",
        maxOutputBytes: 1,
        maxMetadataBytes: 1,
      };
      Object.defineProperty(accessorEnvelope, property, {
        enumerable: true,
        get() {
          getterInvocations += 1;
          throw new Error("must not run");
        },
      });
      expect(
        inspectKernelStepExportCapabilities({
          ...base,
          stepExport: accessorEnvelope,
        } as unknown as KernelCapabilities),
      ).toEqual(
        expect.objectContaining({
          status: "malformed",
          reason: "uninspectable-metadata",
          details: { property },
        }),
      );
      expect(getterInvocations).toBe(0);
    }

    const hostileOuter = new Proxy({} as KernelCapabilities, {
      getOwnPropertyDescriptor() {
        throw Object.create(null);
      },
    });
    expect(() =>
      inspectKernelStepExportCapabilities(hostileOuter),
    ).not.toThrow();
    expect(inspectKernelStepExportCapabilities(hostileOuter)).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
      }),
    );

    const hostileEnvelope = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw Object.create(null);
        },
      },
    );
    expect(() =>
      inspectKernelStepExportCapabilities({
        ...base,
        stepExport: hostileEnvelope as never,
      }),
    ).not.toThrow();
    expect(
      inspectKernelStepExportCapabilities({
        ...base,
        stepExport: hostileEnvelope as never,
      }),
    ).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
      }),
    );

    const revokedOuter = Proxy.revocable({} as KernelCapabilities, {});
    revokedOuter.revoke();
    expect(() =>
      inspectKernelStepExportCapabilities(revokedOuter.proxy),
    ).not.toThrow();
    expect(inspectKernelStepExportCapabilities(revokedOuter.proxy)).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
      }),
    );

    const revokedEnvelope = Proxy.revocable({}, {});
    const revokedEnvelopeCapabilities = {
      ...base,
      stepExport: revokedEnvelope.proxy,
    } as unknown as KernelCapabilities;
    revokedEnvelope.revoke();
    expect(() =>
      inspectKernelStepExportCapabilities(revokedEnvelopeCapabilities),
    ).not.toThrow();
    expect(
      inspectKernelStepExportCapabilities(revokedEnvelopeCapabilities),
    ).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
      }),
    );
  });

  it("retains the STEP inspection boundary after ambient intrinsic mutation", () => {
    const defineProperty = Object.defineProperty;
    const originalGetOwnPropertyDescriptor =
      Object.getOwnPropertyDescriptor;
    const originalArrayIsArray = Array.isArray;
    const originalNumberIsSafeInteger = Number.isSafeInteger;
    const originalObjectFreeze = Object.freeze;
    let getterInvocations = 0;
    const accessorEnvelope = {
      schema: "AP214IS",
      byteDeterminism: "same-shape-representation-and-metadata",
      maxOutputBytes: 1_048_576,
      maxMetadataBytes: 1_024,
    };
    defineProperty(accessorEnvelope, "protocolVersion", {
      enumerable: true,
      get() {
        getterInvocations += 1;
        return KERNEL_STEP_EXPORT_PROTOCOL_VERSION;
      },
    });
    const base = {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: ["step"],
    } as const;
    let accessorInspection:
      | ReturnType<typeof inspectKernelStepExportCapabilities>
      | undefined;
    let validInspection:
      | ReturnType<typeof inspectKernelStepExportCapabilities>
      | undefined;

    try {
      defineProperty(Object, "getOwnPropertyDescriptor", {
        configurable: true,
        writable: true,
        value(target: object, property: PropertyKey) {
          const value = (target as Record<PropertyKey, unknown>)[property];
          return {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
          };
        },
      });
      defineProperty(Array, "isArray", {
        configurable: true,
        writable: true,
        value() {
          throw new Error("mutated Array.isArray must not run");
        },
      });
      defineProperty(Number, "isSafeInteger", {
        configurable: true,
        writable: true,
        value() {
          return false;
        },
      });
      defineProperty(Object, "freeze", {
        configurable: true,
        writable: true,
        value<T>(value: T): T {
          return value;
        },
      });

      accessorInspection = inspectKernelStepExportCapabilities({
        ...base,
        stepExport: accessorEnvelope as never,
      });
      validInspection = inspectKernelStepExportCapabilities({
        ...base,
        stepExport: {
          protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
          schema: "AP214IS",
          byteDeterminism:
            "same-shape-representation-and-metadata",
          maxOutputBytes: 1_048_576,
          maxMetadataBytes: 1_024,
        },
      });
    } finally {
      defineProperty(Object, "getOwnPropertyDescriptor", {
        configurable: true,
        writable: true,
        value: originalGetOwnPropertyDescriptor,
      });
      defineProperty(Array, "isArray", {
        configurable: true,
        writable: true,
        value: originalArrayIsArray,
      });
      defineProperty(Number, "isSafeInteger", {
        configurable: true,
        writable: true,
        value: originalNumberIsSafeInteger,
      });
      defineProperty(Object, "freeze", {
        configurable: true,
        writable: true,
        value: originalObjectFreeze,
      });
    }

    expect(getterInvocations).toBe(0);
    expect(accessorInspection).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
        details: { property: "protocolVersion" },
      }),
    );
    expect(validInspection).toEqual(
      expect.objectContaining({ status: "valid" }),
    );
    expect(
      validInspection?.status === "valid" &&
        Object.isFrozen(validInspection.capabilities),
    ).toBe(true);
  });

  it("does not confuse inherited descriptor fields with data properties", () => {
    const defineProperty = Object.defineProperty;
    const inheritedValueDescriptor =
      Object.getOwnPropertyDescriptor(Object.prototype, "value");
    const deleteProperty = Reflect.deleteProperty;
    let getterInvocations = 0;
    const accessorEnvelope = {};
    const values = {
      protocolVersion: KERNEL_STEP_EXPORT_PROTOCOL_VERSION,
      schema: "AP214IS",
      byteDeterminism: "same-shape-representation-and-metadata",
      maxOutputBytes: 1_048_576,
      maxMetadataBytes: 1_024,
    } as const;
    for (const property of Object.keys(values) as (keyof typeof values)[]) {
      defineProperty(accessorEnvelope, property, {
        enumerable: true,
        get() {
          getterInvocations += 1;
          return values[property];
        },
      });
    }
    let inspection:
      | ReturnType<typeof inspectKernelStepExportCapabilities>
      | undefined;
    try {
      defineProperty(Object.prototype, "value", {
        configurable: true,
        get(this: PropertyDescriptor) {
          return typeof this.get === "function"
            ? this.get()
            : undefined;
        },
      });
      inspection = inspectKernelStepExportCapabilities({
        protocolVersion: 1,
        representation: "brep",
        exact: true,
        primitives: [],
        features: [],
        nativeImports: [],
        nativeExports: ["step"],
        stepExport: accessorEnvelope as never,
      });
    } finally {
      if (inheritedValueDescriptor === undefined) {
        deleteProperty(Object.prototype, "value");
      } else {
        defineProperty(
          Object.prototype,
          "value",
          inheritedValueDescriptor,
        );
      }
    }

    expect(getterInvocations).toBe(0);
    expect(inspection).toEqual(
      expect.objectContaining({
        status: "malformed",
        reason: "uninspectable-metadata",
        details: { property: "protocolVersion" },
      }),
    );
  });

  it("distinguishes absent, valid, and malformed composite refinement metadata", () => {
    const base: KernelCapabilities = {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: ["compositeSweep"],
      nativeImports: [],
      nativeExports: [],
    };
    expect(inspectKernelCompositeSweepCapabilities(base)).toEqual({
      status: "absent",
    });

    const refinements = ["major-multiple-arcs"];
    const valid = inspectKernelCompositeSweepCapabilities({
      ...base,
      compositeSweep: {
        protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
        refinements: refinements as KernelCompositeSweepRefinement[],
      },
    });
    expect(valid).toEqual({
      status: "valid",
      capabilities: {
        protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
        refinements: ["major-multiple-arcs"],
      },
    });
    expect(valid.status === "valid" && Object.isFrozen(valid.capabilities)).toBe(
      true,
    );
    expect(
      valid.status === "valid" &&
        Object.isFrozen(valid.capabilities.refinements),
    ).toBe(true);
    refinements.push("major-eccentric-profile");
    expect(
      valid.status === "valid" ? valid.capabilities.refinements : [],
    ).toEqual(["major-multiple-arcs"]);

    const sparseRefinements = new Array(1) as string[];
    const malformedCases: readonly {
      readonly envelope: unknown;
      readonly reason: string;
      readonly details?: Readonly<Record<string, unknown>>;
    }[] = [
      {
        envelope: null,
        reason: "not-object",
        details: { actualType: "null" },
      },
      {
        envelope: { protocolVersion: 2, refinements: [] },
        reason: "unsupported-protocol-version",
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: "major-multiple-arcs",
        },
        reason: "refinements-not-array",
        details: { actualType: "string" },
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: sparseRefinements,
        },
        reason: "invalid-refinement",
        details: { index: 0, actualType: "missing" },
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: [42],
        },
        reason: "invalid-refinement",
        details: { index: 0, actualType: "number" },
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: ["future-refinement"],
        },
        reason: "unknown-refinement",
        details: { index: 0, refinement: "future-refinement" },
      },
      {
        envelope: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: ["major-multiple-arcs", "major-multiple-arcs"],
        },
        reason: "duplicate-refinement",
        details: { index: 1, refinement: "major-multiple-arcs" },
      },
    ];
    for (const testCase of malformedCases) {
      expect(
        inspectKernelCompositeSweepCapabilities({
          ...base,
          compositeSweep:
            testCase.envelope as NonNullable<
              KernelCapabilities["compositeSweep"]
            >,
        }),
      ).toEqual(
        expect.objectContaining({
          status: "malformed",
          reason: testCase.reason,
          ...(testCase.details === undefined
            ? {}
            : { details: expect.objectContaining(testCase.details) }),
        }),
      );
    }
  });

  it("validates strong document-body import metadata and snapshots it", () => {
    const base: KernelCapabilities = {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: [],
    };
    expect(inspectKernelDocumentBodyImportCapabilities(base)).toEqual({
      status: "absent",
    });

    const unitModes = ["declared"] as ("declared" | "from-file")[];
    const valid = inspectKernelDocumentBodyImportCapabilities({
      ...base,
      documentBodyImport: {
        protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
        formats: [{ format: "brep", unitModes }],
      },
    });
    expect(valid).toEqual({
      status: "valid",
      capabilities: {
        protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
        formats: [{ format: "brep", unitModes: ["declared"] }],
      },
    });
    expect(valid.status === "valid" && Object.isFrozen(valid.capabilities)).toBe(
      true,
    );
    expect(
      valid.status === "valid" &&
        Object.isFrozen(valid.capabilities.formats),
    ).toBe(true);
    expect(
      valid.status === "valid" &&
        Object.isFrozen(valid.capabilities.formats[0]?.unitModes),
    ).toBe(true);
    unitModes.push("from-file");
    expect(
      valid.status === "valid"
        ? valid.capabilities.formats[0]?.unitModes
        : [],
    ).toEqual(["declared"]);
    if (valid.status !== "valid") {
      throw new Error("Expected valid document-body import capabilities");
    }
    const capable: KernelCapabilities = {
      ...base,
      documentBodyImport: valid.capabilities,
    };
    expect(
      kernelSupportsDocumentBodyImport(
        capable,
        "brep",
        "declared",
      ),
    ).toBe(true);
    expect(
      kernelSupportsDocumentBodyImport(
        capable,
        "brep",
        "from-file",
      ),
    ).toBe(false);
    for (const incompatible of [
      { ...capable, representation: "mesh" as const },
      { ...capable, exact: false },
    ]) {
      expect(
        inspectKernelDocumentBodyImportCapabilities(incompatible),
      ).toEqual(expect.objectContaining({
        status: "malformed",
        reason: "incompatible-kernel-representation",
      }));
      expect(
        kernelSupportsDocumentBodyImport(
          incompatible,
          "brep",
          "declared",
        ),
      ).toBe(false);
    }

    const sparseFormats = new Array(1);
    const sparseModes = new Array(1);
    const malformedCases: readonly {
      readonly envelope: unknown;
      readonly reason: string;
    }[] = [
      { envelope: null, reason: "not-object" },
      {
        envelope: { protocolVersion: 2, formats: [] },
        reason: "unsupported-protocol-version",
      },
      {
        envelope: {
          protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: "brep",
        },
        reason: "formats-not-array",
      },
      {
        envelope: {
          protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: sparseFormats,
        },
        reason: "invalid-format-entry",
      },
      {
        envelope: {
          protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: [{ format: "iges", unitModes: ["declared"] }],
        },
        reason: "unknown-format",
      },
      {
        envelope: {
          protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: [
            { format: "brep", unitModes: ["declared"] },
            { format: "brep", unitModes: ["declared"] },
          ],
        },
        reason: "duplicate-format",
      },
      {
        envelope: {
          protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: [{ format: "brep", unitModes: "declared" }],
        },
        reason: "unit-modes-not-array",
      },
      {
        envelope: {
          protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: [{ format: "brep", unitModes: [] }],
        },
        reason: "empty-unit-modes",
      },
      {
        envelope: {
          protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: [{ format: "brep", unitModes: sparseModes }],
        },
        reason: "invalid-unit-mode",
      },
      {
        envelope: {
          protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: [{ format: "brep", unitModes: ["future"] }],
        },
        reason: "invalid-unit-mode",
      },
      {
        envelope: {
          protocolVersion: KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
          formats: [
            { format: "brep", unitModes: ["declared", "declared"] },
          ],
        },
        reason: "duplicate-unit-mode",
      },
    ];
    for (const testCase of malformedCases) {
      const capabilities = {
        ...base,
        documentBodyImport: testCase.envelope,
      } as unknown as KernelCapabilities;
      expect(
        inspectKernelDocumentBodyImportCapabilities(capabilities),
      ).toEqual(
        expect.objectContaining({
          status: "malformed",
          reason: testCase.reason,
        }),
      );
      expect(
        kernelSupportsDocumentBodyImport(capabilities, "brep", "declared"),
      ).toBe(false);
    }
  });

  it("queries primitive, feature, and export capabilities", async () => {
    const kernel = await createManifoldKernel();
    try {
      expect(kernelSupports(kernel.capabilities, "primitive", "box")).toBe(true);
      expect(kernelSupports(kernel.capabilities, "feature", "boolean")).toBe(true);
      expect(
        kernelSupports(
          kernel.capabilities,
          "exactIndexedTopologyEvolution",
          "draft",
        ),
      ).toBe(false);
      expect(kernelSupports(kernel.capabilities, "nativeExport", "step")).toBe(
        false,
      );
    } finally {
      kernel.dispose();
    }
  });

  it("negotiates exact indexed topology evolution by protocol and feature", async () => {
    const kernel = await createManifoldKernel();
    try {
      const capable: KernelCapabilities = {
        ...kernel.capabilities,
        exact: true,
        exactIndexedTopologyEvolution: {
          protocolVersion: 1,
          features: ["draft"],
        },
      };
      expect(
        kernelSupports(capable, "exactIndexedTopologyEvolution", "draft"),
      ).toBe(true);
      expect(
        kernelSupports(capable, "exactIndexedTopologyEvolution", "fillet"),
      ).toBe(false);

      const stale = {
        ...capable,
        exactIndexedTopologyEvolution: {
          protocolVersion: 2,
          features: ["draft"],
        },
      } as unknown as KernelCapabilities;
      expect(
        kernelSupports(stale, "exactIndexedTopologyEvolution", "draft"),
      ).toBe(false);
    } finally {
      kernel.dispose();
    }
  });

  it("negotiates versioned composite-sweep refinements fail closed", async () => {
    const kernel = await createManifoldKernel();
    try {
      const refinements: readonly KernelCompositeSweepRefinement[] = [
        "major-multiple-arcs",
        "major-eccentric-profile",
      ];
      const capable: KernelCapabilities = {
        ...kernel.capabilities,
        features: [...kernel.capabilities.features, "compositeSweep"],
        compositeSweep: {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements,
        },
      };
      for (const refinement of refinements) {
        expect(
          kernelSupports(capable, "compositeSweepRefinement", refinement),
        ).toBe(true);
      }

      const withoutBaseFeature: KernelCapabilities = {
        ...capable,
        features: capable.features.filter(
          (feature) => feature !== "compositeSweep",
        ),
      };
      expect(
        kernelSupports(
          withoutBaseFeature,
          "compositeSweepRefinement",
          "major-multiple-arcs",
        ),
      ).toBe(false);

      for (const malformedEnvelope of [
        { protocolVersion: 2, refinements },
        {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: ["major-multiple-arcs", "major-multiple-arcs"],
        },
        {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: ["major-multiple-arcs", "unknown-refinement"],
        },
        {
          protocolVersion: COMPOSITE_SWEEP_REFINEMENT_PROTOCOL_VERSION,
          refinements: "major-multiple-arcs",
        },
      ]) {
        const malformed = {
          ...capable,
          compositeSweep: malformedEnvelope,
        } as unknown as KernelCapabilities;
        expect(
          kernelSupports(
            malformed,
            "compositeSweepRefinement",
            "major-multiple-arcs",
          ),
        ).toBe(false);
      }
    } finally {
      kernel.dispose();
    }
  });

  it("returns a structured failure before invoking an unsupported operation", async () => {
    const delegate = await createManifoldKernel();
    let sphereInvoked = false;
    const limited = new Proxy(delegate, {
      get(target, property) {
        if (property === "id") return "limited-test-kernel";
        if (property === "capabilities") {
          return {
            ...target.capabilities,
            primitives: target.capabilities.primitives.filter(
              (primitive) => primitive !== "sphere",
            ),
          };
        }
        if (property === "sphere") {
          return (
            ...arguments_: Parameters<NonNullable<GeometryKernel["sphere"]>>
          ) => {
            sphereInvoked = true;
            return target.sphere!(...arguments_);
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as GeometryKernel;
    const evaluator = await createEvaluator({ kernel: limited });
    try {
      const cad = design("unsupported-sphere");
      cad.output("sphere", cad.sphere("sphere", { radius: mm(2) }));
      const result = await evaluator.evaluate(cad.build());
      expect(result.ok).toBe(false);
      expect(sphereInvoked).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "KERNEL_CAPABILITY_MISSING",
          node: "sphere",
          path: "/nodes/sphere",
          details: {
            kernel: "limited-test-kernel",
            kind: "primitive",
            capability: "sphere",
          },
        }),
      );
    } finally {
      evaluator.dispose();
    }
  });
});
