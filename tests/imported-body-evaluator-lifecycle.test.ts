import { describe, expect, it, vi } from "vitest";
import {
  Evaluator,
  KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
  createImportedBodyDocument,
  type CadResult,
  type EvaluateImportedBodyOptions,
  type GeometryKernel,
  type ImportedBodyDocument,
  type KernelShape,
  type ShapeMeasurements,
  type SketchSolverBackend,
} from "../src/index.js";

const encoder = new TextEncoder();

const measurements: ShapeMeasurements = {
  volume: 24,
  surfaceArea: 52,
  boundingBox: { min: [0, 0, 0], max: [2, 3, 4] },
  centerOfMass: [1, 1.5, 2],
  inertiaTensor: [
    [50, 0, 0],
    [0, 40, 0],
    [0, 0, 26],
  ],
  genus: 0,
  tolerance: 1e-7,
};

async function digest(
  bytes: Uint8Array,
): Promise<`sha256:${string}`> {
  const value = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes),
  );
  const hexadecimal = [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hexadecimal}`;
}

function valueOf<T>(result: CadResult<T>): T {
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) throw new Error("Expected a successful result");
  return result.value;
}

async function importedBodyDocument(
  bytes: Uint8Array,
): Promise<ImportedBodyDocument> {
  return valueOf(
    createImportedBodyDocument("Lifecycle fixture", {
      id: "body",
      resource: {
        id: "source",
        digest: await digest(bytes),
        byteLength: bytes.byteLength,
        mediaType: "model/step",
      },
      format: "step",
      units: { mode: "from-file" },
    }),
  );
}

function fixtureRuntime(): {
  readonly evaluator: Evaluator;
  readonly shape: KernelShape;
  readonly importDocumentBody: ReturnType<typeof vi.fn>;
  readonly disposeShape: ReturnType<typeof vi.fn>;
  readonly disposeKernel: ReturnType<typeof vi.fn>;
  readonly disposeSolver: ReturnType<typeof vi.fn>;
} {
  const shape: KernelShape = { kernel: "lifecycle-fixture" };
  const importDocumentBody = vi.fn(() => shape);
  const disposeShape = vi.fn();
  const disposeKernel = vi.fn();
  const disposeSolver = vi.fn();
  const kernel: GeometryKernel = {
    id: "lifecycle-fixture",
    capabilities: {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: [],
      documentBodyImport: {
        protocolVersion:
          KERNEL_DOCUMENT_BODY_IMPORT_PROTOCOL_VERSION,
        formats: [
          { format: "step", unitModes: ["from-file"] },
        ],
      },
    },
    importDocumentBody,
    mesh: () => ({
      positions: new Float32Array(),
      indices: new Uint32Array(),
    }),
    measure: () => measurements,
    status: () => ({ ok: true, code: "VALID" }),
    disposeShape,
    dispose: disposeKernel,
  };
  const sketchSolver: SketchSolverBackend = {
    id: "lifecycle-fixture",
    capabilities: {
      entities: [],
      constraints: [],
      reportsDegreesOfFreedom: false,
      reportsConflicts: false,
    },
    solve: () => {
      throw new Error("Sketch solving is outside this fixture");
    },
    dispose: disposeSolver,
  };
  return {
    evaluator: new Evaluator(kernel, sketchSolver),
    shape,
    importDocumentBody,
    disposeShape,
    disposeKernel,
    disposeSolver,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("imported-body evaluator lifecycle", () => {
  it("rejects evaluator disposal while resource resolution is pending", async () => {
    const bytes = encoder.encode("deferred-step-resource");
    const document = await importedBodyDocument(bytes);
    const runtime = fixtureRuntime();
    const resolverGate = deferred<Uint8Array>();
    const resolverStarted = deferred<void>();
    const evaluation = runtime.evaluator.evaluateImportedBody(document, {
      resolver: () => {
        resolverStarted.resolve();
        return resolverGate.promise;
      },
    });
    await resolverStarted.promise;

    expect(() => runtime.evaluator.dispose()).toThrow(
      "Cannot dispose an evaluator during an imported-body evaluation",
    );
    expect(runtime.importDocumentBody).not.toHaveBeenCalled();
    expect(runtime.disposeShape).not.toHaveBeenCalled();
    expect(runtime.disposeKernel).not.toHaveBeenCalled();
    expect(runtime.disposeSolver).not.toHaveBeenCalled();

    resolverGate.resolve(bytes);
    const result = await evaluation;
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) throw new Error("Expected imported-body evaluation");
    expect(runtime.importDocumentBody).toHaveBeenCalledOnce();
    expect(result.value.measure().volume).toBe(24);
    result.value.dispose();
    expect(runtime.disposeShape).toHaveBeenCalledExactlyOnceWith(
      runtime.shape,
    );

    runtime.evaluator.dispose();
    expect(runtime.disposeKernel).toHaveBeenCalledOnce();
    expect(runtime.disposeSolver).toHaveBeenCalledOnce();
  });

  it("releases the disposal guard after a resolver failure", async () => {
    const bytes = encoder.encode("rejected-step-resource");
    const document = await importedBodyDocument(bytes);
    const runtime = fixtureRuntime();
    const resolverGate = deferred<Uint8Array>();
    const resolverStarted = deferred<void>();
    const evaluation = runtime.evaluator.evaluateImportedBody(document, {
      resolver: () => {
        resolverStarted.resolve();
        return resolverGate.promise;
      },
    });
    await resolverStarted.promise;

    expect(() => runtime.evaluator.dispose()).toThrow(/imported-body/);
    resolverGate.reject(new Error("fixture resolver failure"));
    const result = await evaluation;
    expect(result.ok).toBe(false);
    expect(runtime.importDocumentBody).not.toHaveBeenCalled();
    expect(runtime.disposeShape).not.toHaveBeenCalled();

    expect(() => runtime.evaluator.dispose()).not.toThrow();
    expect(runtime.disposeKernel).toHaveBeenCalledOnce();
    expect(runtime.disposeSolver).toHaveBeenCalledOnce();
  });

  it("does not retain a guard after document or option capture fails", async () => {
    const bytes = encoder.encode("capture-step-resource");
    const document = await importedBodyDocument(bytes);

    const invalidDocumentRuntime = fixtureRuntime();
    const invalidDocumentEvaluation =
      invalidDocumentRuntime.evaluator.evaluateImportedBody(
        {} as ImportedBodyDocument,
      );
    expect(() => invalidDocumentRuntime.evaluator.dispose()).not.toThrow();
    expect((await invalidDocumentEvaluation).ok).toBe(false);

    const invalidOptionsRuntime = fixtureRuntime();
    const options = Object.defineProperty({}, "resolver", {
      configurable: true,
      enumerable: true,
      get: vi.fn(),
    }) as EvaluateImportedBodyOptions;
    const invalidOptionsEvaluation =
      invalidOptionsRuntime.evaluator.evaluateImportedBody(
        document,
        options,
      );
    expect(() => invalidOptionsRuntime.evaluator.dispose()).not.toThrow();
    expect((await invalidOptionsEvaluation).ok).toBe(false);
  });

  it("rechecks disposal after hostile option capture reentrancy", async () => {
    const bytes = encoder.encode("reentrant-option-capture");
    const document = await importedBodyDocument(bytes);
    const runtime = fixtureRuntime();
    const options = new Proxy(
      {},
      {
        ownKeys() {
          runtime.evaluator.dispose();
          return [];
        },
      },
    ) as EvaluateImportedBodyOptions;

    await expect(
      runtime.evaluator.evaluateImportedBody(document, options),
    ).rejects.toThrow("This evaluator has been disposed");
    expect(runtime.importDocumentBody).not.toHaveBeenCalled();
    expect(runtime.disposeShape).not.toHaveBeenCalled();
    expect(runtime.disposeKernel).toHaveBeenCalledOnce();
    expect(runtime.disposeSolver).toHaveBeenCalledOnce();
  });
});
