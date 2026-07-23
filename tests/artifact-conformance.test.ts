import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_PROTOCOL_VERSION,
  KERNEL_SHAPE_ARTIFACT_FIXTURE_WITNESS_PREFIX,
  KERNEL_SHAPE_ARTIFACT_SEMANTIC_WITNESS_PREFIX,
  auditKernelShapeArtifactCodec,
  hashKernelShapeArtifactFixtureWitness,
  hashKernelShapeArtifactSemanticWitness,
  type AuditKernelShapeArtifactCodecOptions,
  type KernelShapeArtifactCodecAuditEvidence,
  type KernelShapeArtifactCodecAuditTarget,
  type KernelShapeArtifactCodecCandidate,
  type KernelShapeArtifactFixtureWitness,
  type KernelShapeArtifactSemanticWitness,
} from "../src/conformance.js";
import {
  KERNEL_SHAPE_ARTIFACT_MAX_COMPATIBILITY_FINGERPRINT_BYTES,
  KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
  type GeometryKernel,
  type KernelCapabilities,
  type KernelShape,
  type KernelShapeArtifactCapabilities,
  type KernelShapeArtifactContext,
} from "../src/kernel.js";
import type { CadResult, DiagnosticCode } from "../src/core/result.js";

const KERNEL_ID = "invariantcad.test.artifact-kernel";
const MAGIC = [0x49, 0x43, 0x41] as const;
const VISIBLE = 7;
const HIDDEN = 29;

const ARTIFACT_CAPABILITIES: KernelShapeArtifactCapabilities = Object.freeze({
  protocolVersion: KERNEL_SHAPE_ARTIFACT_PROTOCOL_VERSION,
  format: "invariantcad.test.synthetic-shape",
  formatVersion: 1,
  compatibilityFingerprint: "synthetic-runtime@1:exact-options:sha256:abc123",
});

type Fault =
  | "none"
  | "warm-only-encode"
  | "lossy-hidden-state"
  | "process-local"
  | "shared-encode-buffer"
  | "retain-decode-input"
  | "mutate-decode-input"
  | "coupled-decoded-ownership"
  | "ignore-cancellation"
  | "ignore-byte-ceiling"
  | "invalid-reduced-output"
  | "lossy-reduced-output"
  | "source-coupled-decoded-ownership"
  | "pre-witness-cross-runtime-source-coupling";

type Advertisement = "absent" | "supported" | "malformed";

interface Coupling {
  live: boolean;
}

interface ShapeState {
  visible: number;
  hidden: number;
  live: boolean;
  warmed?: boolean;
  retained?: Uint8Array;
  coupling?: Coupling;
  sourceDependency?: Coupling;
  invalidatesSourceDependency?: Coupling;
}

interface SyntheticShape extends KernelShape {
  readonly owner: RuntimeRecord;
  readonly state: ShapeState;
}

interface RuntimeRecord {
  readonly ordinal: number;
  readonly kernel: GeometryKernel;
  readonly codec: KernelShapeArtifactCodecCandidate;
  readonly shapes: SyntheticShape[];
  activeSourceCoupling?: Coupling;
  disposed: boolean;
}

function abortIfRequested(
  context: KernelShapeArtifactContext,
  ignored: boolean,
): void {
  if (context.signal?.aborted && !ignored) {
    throw new DOMException("Synthetic codec operation aborted", "AbortError");
  }
}

function checksum(bytes: readonly number[]): number {
  return bytes.reduce((sum, byte) => (sum + byte) & 0xff, 0);
}

function artifactBytes(
  visible = VISIBLE,
  hidden = HIDDEN,
  runtimeTag = 0,
): Uint8Array {
  const prefix = [...MAGIC, visible, hidden, runtimeTag];
  return new Uint8Array([...prefix, checksum(prefix)]);
}

const GOLDEN_ARTIFACT = artifactBytes();

function parseArtifact(bytes: Uint8Array): {
  readonly visible: number;
  readonly hidden: number;
  readonly runtimeTag: number;
} {
  if (
    (bytes.byteLength !== 6 && bytes.byteLength !== 7) ||
    bytes[0] !== MAGIC[0] ||
    bytes[1] !== MAGIC[1] ||
    bytes[2] !== MAGIC[2] ||
    bytes[bytes.byteLength - 1] !==
      checksum([...bytes.slice(0, bytes.byteLength - 1)])
  ) {
    throw new TypeError("Malformed synthetic shape artifact");
  }
  return {
    visible: bytes[3]!,
    hidden: bytes[4]!,
    runtimeTag: bytes.byteLength === 7 ? bytes[5]! : 0,
  };
}

class SyntheticHarness {
  readonly runtimes: RuntimeRecord[] = [];
  readonly contexts: KernelShapeArtifactContext[] = [];
  readonly coupling: Coupling = { live: true };
  readonly fault: Fault;
  readonly artifactCapabilities: KernelShapeArtifactCapabilities;
  peakLiveRuntimes = 0;
  private sharedEncodeBuffer: Uint8Array | undefined;
  private preWitnessSourceCoupling: Coupling | undefined;

  constructor(
    fault: Fault = "none",
    artifactCapabilities: KernelShapeArtifactCapabilities =
      ARTIFACT_CAPABILITIES,
  ) {
    this.fault = fault;
    this.artifactCapabilities = artifactCapabilities;
  }

  create(advertisement: Advertisement): {
    readonly kernel: GeometryKernel;
    readonly codec: KernelShapeArtifactCodecCandidate;
  } {
    const ordinal = this.runtimes.length + 1;
    const shapes: SyntheticShape[] = [];
    let runtime!: RuntimeRecord;

    const encode = (
      rawShape: KernelShape,
      context: KernelShapeArtifactContext,
    ): Uint8Array => {
      this.contexts.push(context);
      abortIfRequested(context, this.fault === "ignore-cancellation");
      const shape = rawShape as SyntheticShape;
      if (shape.owner !== runtime || !shape.state.live) {
        throw new TypeError("Shape is not live in this runtime");
      }
      if (this.fault === "warm-only-encode" && shape.state.warmed !== true) {
        throw new TypeError("Synthetic codec requires a warmed shape");
      }
      if (
        this.fault === "pre-witness-cross-runtime-source-coupling" &&
        shape.state.warmed !== true
      ) {
        const coupling = { live: true };
        shape.state.invalidatesSourceDependency = coupling;
        this.preWitnessSourceCoupling = coupling;
      }
      const { visible, hidden } = this.semantic(shape);
      const bytes = artifactBytes(
        visible,
        this.fault === "lossy-hidden-state" ? 0 : hidden,
        this.fault === "process-local" ? ordinal : 0,
      );
      if (
        this.fault === "invalid-reduced-output" &&
        context.maxArtifactBytes < bytes.byteLength
      ) {
        return new Uint8Array();
      }
      if (
        this.fault === "lossy-reduced-output" &&
        context.maxArtifactBytes < bytes.byteLength
      ) {
        const compactPrefix = [...MAGIC, visible, 0];
        return new Uint8Array([...compactPrefix, checksum(compactPrefix)]);
      }
      if (
        bytes.byteLength > context.maxArtifactBytes &&
        this.fault !== "ignore-byte-ceiling"
      ) {
        throw new RangeError("Synthetic artifact exceeds maxArtifactBytes");
      }
      if (this.fault === "shared-encode-buffer") {
        if (
          this.sharedEncodeBuffer === undefined ||
          this.sharedEncodeBuffer.byteLength === 0
        ) {
          this.sharedEncodeBuffer = bytes;
        }
        return this.sharedEncodeBuffer;
      }
      return bytes;
    };

    const decode = (
      bytes: Uint8Array,
      context: KernelShapeArtifactContext,
    ): KernelShape => {
      this.contexts.push(context);
      abortIfRequested(context, this.fault === "ignore-cancellation");
      if (bytes.byteLength > context.maxArtifactBytes) {
        throw new RangeError("Synthetic artifact exceeds maxArtifactBytes");
      }
      const decoded = parseArtifact(bytes);
      if (
        this.fault === "process-local" &&
        decoded.runtimeTag !== ordinal
      ) {
        throw new TypeError("Synthetic artifact belongs to another process instance");
      }
      const state: ShapeState = {
        visible: decoded.visible,
        hidden: decoded.hidden,
        live: true,
        ...(this.fault === "retain-decode-input" ? { retained: bytes } : {}),
        ...(this.fault === "coupled-decoded-ownership"
          ? { coupling: this.coupling }
          : {}),
        ...(this.fault === "source-coupled-decoded-ownership" &&
        runtime.activeSourceCoupling !== undefined
          ? { sourceDependency: runtime.activeSourceCoupling }
          : {}),
        ...(this.fault === "pre-witness-cross-runtime-source-coupling" &&
        this.preWitnessSourceCoupling !== undefined
          ? { sourceDependency: this.preWitnessSourceCoupling }
          : {}),
      };
      const shape: SyntheticShape = { kernel: KERNEL_ID, owner: runtime, state };
      shapes.push(shape);
      if (this.fault === "mutate-decode-input") bytes[0] = 0;
      return shape;
    };

    const codec: KernelShapeArtifactCodecCandidate = {
      capabilities: this.artifactCapabilities,
      encodeShapeArtifact: encode,
      decodeShapeArtifact: decode,
    };

    const baseCapabilities: KernelCapabilities = {
      protocolVersion: 1,
      representation: "brep",
      exact: true,
      primitives: [],
      features: [],
      nativeImports: [],
      nativeExports: [],
      ...(advertisement === "absent"
        ? {}
        : { shapeArtifacts: this.artifactCapabilities }),
    };
    const kernel: GeometryKernel = {
      id: KERNEL_ID,
      capabilities: baseCapabilities,
      ...(advertisement === "supported"
        ? {
            encodeShapeArtifact: encode,
            decodeShapeArtifact: decode,
          }
        : {}),
      ...(advertisement === "malformed"
        ? { encodeShapeArtifact: encode }
        : {}),
      mesh: () => ({
        positions: new Float32Array(),
        indices: new Uint32Array(),
      }),
      measure: () => ({
        volume: 0,
        surfaceArea: 0,
        centerOfMass: null,
        inertiaTensor: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
        genus: 0,
        tolerance: 0,
      }),
      status: (shape) => {
        try {
          this.semantic(shape as SyntheticShape);
          return { ok: true, code: "OK" };
        } catch (error) {
          return { ok: false, code: "DISPOSED", message: String(error) };
        }
      },
      disposeShape: (rawShape) => {
        const shape = rawShape as SyntheticShape;
        if (shape.owner !== runtime || !shape.state.live) {
          throw new Error("Synthetic shape was disposed twice or by the wrong runtime");
        }
        shape.state.live = false;
        if (shape.state.coupling !== undefined) shape.state.coupling.live = false;
        if (shape.state.invalidatesSourceDependency !== undefined) {
          shape.state.invalidatesSourceDependency.live = false;
          delete runtime.activeSourceCoupling;
        }
      },
      dispose: () => {
        if (runtime.disposed) throw new Error("Synthetic kernel disposed twice");
        runtime.disposed = true;
      },
    };
    runtime = { ordinal, kernel, codec, shapes, disposed: false };
    this.runtimes.push(runtime);
    this.peakLiveRuntimes = Math.max(
      this.peakLiveRuntimes,
      this.runtimes.filter((item) => !item.disposed).length,
    );
    return { kernel, codec };
  }

  source(kernel: GeometryKernel, signal?: AbortSignal): SyntheticShape {
    if (signal?.aborted) {
      throw new DOMException("Synthetic source creation aborted", "AbortError");
    }
    const runtime = this.runtimes.find((item) => item.kernel === kernel);
    if (runtime === undefined) throw new TypeError("Unknown synthetic runtime");
    const sourceCoupling =
      this.fault === "source-coupled-decoded-ownership"
        ? { live: true }
        : undefined;
    if (sourceCoupling !== undefined) runtime.activeSourceCoupling = sourceCoupling;
    const shape: SyntheticShape = {
      kernel: KERNEL_ID,
      owner: runtime,
      state: {
        visible: VISIBLE,
        hidden: HIDDEN,
        live: true,
        ...(sourceCoupling === undefined
          ? {}
          : { invalidatesSourceDependency: sourceCoupling }),
      },
    };
    runtime.shapes.push(shape);
    return shape;
  }

  semantic(shape: SyntheticShape): {
    readonly visible: number;
    readonly hidden: number;
  } {
    if (!shape.state.live) throw new Error("Synthetic shape is disposed");
    shape.state.warmed = true;
    if (shape.state.coupling !== undefined && !shape.state.coupling.live) {
      throw new Error("Synthetic decoded ownership was coupled");
    }
    if (
      shape.state.sourceDependency !== undefined &&
      !shape.state.sourceDependency.live
    ) {
      throw new Error("Synthetic decoded shape depended on its source owner");
    }
    if (shape.state.retained !== undefined) {
      const parsed = parseArtifact(shape.state.retained);
      return { visible: parsed.visible, hidden: parsed.hidden };
    }
    return { visible: shape.state.visible, hidden: shape.state.hidden };
  }

  expectFullyDisposed(): void {
    expect(this.runtimes.length).toBeGreaterThan(0);
    for (const runtime of this.runtimes) {
      expect(runtime.disposed).toBe(true);
      expect(runtime.shapes.every((shape) => !shape.state.live)).toBe(true);
    }
  }
}

async function valueOf<T>(result: Promise<CadResult<T>>): Promise<T> {
  const settled = await result;
  expect(settled.ok, JSON.stringify(settled.diagnostics)).toBe(true);
  if (!settled.ok) throw new Error("Expected successful CadResult");
  return settled.value;
}

function expectFailure(
  result: CadResult<unknown>,
  code: DiagnosticCode,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected failed CadResult");
  expect(result.diagnostics[0]?.code).toBe(code);
}

async function semanticWitness(
  visible = VISIBLE,
  hidden = HIDDEN,
): Promise<KernelShapeArtifactSemanticWitness> {
  return valueOf(
    hashKernelShapeArtifactSemanticWitness(
      `visible=${visible};hidden=${hidden}`,
    ),
  );
}

async function fixtureWitness(
  bytes = GOLDEN_ARTIFACT,
): Promise<KernelShapeArtifactFixtureWitness> {
  return valueOf(hashKernelShapeArtifactFixtureWitness(bytes));
}

async function casesFor(
  harness: SyntheticHarness,
  options: {
    readonly golden?: Uint8Array;
    readonly expectedGolden?: KernelShapeArtifactFixtureWitness;
    readonly expectedSemantic?: KernelShapeArtifactSemanticWitness;
  } = {},
) {
  const expectedSemantic =
    options.expectedSemantic ?? (await semanticWitness());
  const golden = options.golden ?? GOLDEN_ARTIFACT;
  const expectedGolden = options.expectedGolden ?? (await fixtureWitness(golden));
  const witness = async (
    _kernel: GeometryKernel,
    rawShape: KernelShape,
    context: { readonly maxBytes: number; readonly signal?: AbortSignal },
  ) => {
    const observed = harness.semantic(rawShape as SyntheticShape);
    return hashKernelShapeArtifactSemanticWitness(
      `visible=${observed.visible};hidden=${observed.hidden}`,
      {
        maxBytes: context.maxBytes,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      },
    );
  };
  return [
    {
      id: "self-round-trip",
      feature: "synthetic-self-round-trip",
      scope: "current-runtime-self-round-trip" as const,
      expectedWitness: expectedSemantic,
      witness,
      createSource: (
        kernel: GeometryKernel,
        context: { readonly signal?: AbortSignal },
      ) => harness.source(kernel, context.signal),
    },
    {
      id: "golden-decode",
      feature: "synthetic-golden-decode",
      scope: "golden-decode" as const,
      expectedWitness: expectedSemantic,
      witness,
      artifact: golden,
      expectedArtifactWitness: expectedGolden,
    },
  ];
}

async function optionsFor(
  harness: SyntheticHarness,
  mode: "candidate" | "advertised",
  options: {
    readonly advertisement?: Advertisement;
    readonly expectedIdentity?: AuditKernelShapeArtifactCodecOptions["expectedIdentity"];
    readonly cases?: AuditKernelShapeArtifactCodecOptions["cases"];
    readonly limits?: AuditKernelShapeArtifactCodecOptions["limits"];
    readonly signal?: AbortSignal;
  } = {},
): Promise<AuditKernelShapeArtifactCodecOptions> {
  const advertisement =
    options.advertisement ?? (mode === "candidate" ? "absent" : "supported");
  const target: KernelShapeArtifactCodecAuditTarget =
    mode === "candidate"
      ? {
          mode: "candidate",
          create: () => harness.create(advertisement),
        }
      : {
          mode: "advertised",
          create: () => harness.create(advertisement).kernel,
        };
  return {
    target,
    expectedIdentity: options.expectedIdentity ?? {
      kernelId: KERNEL_ID,
      artifact: harness.artifactCapabilities,
    },
    cases: options.cases ?? (await casesFor(harness)),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
}

function expectDeeplyFrozen(value: unknown, visited = new Set<object>()): void {
  if (typeof value !== "object" || value === null || visited.has(value)) return;
  visited.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(child, visited);
  }
}

describe("kernel shape-artifact codec audit", () => {
  it("returns bounded, deeply frozen, explicitly non-certifying candidate evidence", async () => {
    const harness = new SyntheticHarness();
    const result = await auditKernelShapeArtifactCodec(
      await optionsFor(harness, "candidate"),
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;

    expect(result.value).toMatchObject({
      kind: "kernel-shape-artifact-codec-audit-evidence",
      auditProtocolVersion: KERNEL_SHAPE_ARTIFACT_CODEC_AUDIT_PROTOCOL_VERSION,
      certifiesCompatibility: false,
      mode: "candidate",
      advertisement: "unadvertised",
      scopes: ["current-runtime-self-round-trip", "golden-decode"],
      expectedIdentity: {
        kernelId: KERNEL_ID,
        artifact: ARTIFACT_CAPABILITIES,
      },
      usage: { cases: 2 },
    });
    expect(result.value.disclaimer).toContain("not certification");
    expect(result.value.cases.map((item) => item.scope)).toEqual([
      "golden-decode",
      "current-runtime-self-round-trip",
    ]);
    expect(result.value.cases[1]?.artifacts.map((item) => item.role)).toEqual([
      "pre-witness-source-encode",
      "first-encode",
      "second-encode",
      "second-generation-encode",
    ]);
    expect(result.value.cases[1]?.checks).toContain(
      "pre-witness-source-cross-instance-decode",
    );
    expect(result.value.cases[0]?.artifacts).toEqual([
      expect.objectContaining({
        role: "golden-input",
        algorithm: "sha256",
        byteLength: GOLDEN_ARTIFACT.byteLength,
      }),
    ]);
    for (const item of result.value.cases) {
      expect(item.observedWitness).toBe(item.expectedWitness);
      expect(item.checks.length).toBeGreaterThan(0);
      expect(
        item.artifacts.every((artifact) =>
          /^[0-9a-f]{64}$/.test(artifact.digest),
        ),
      ).toBe(true);
    }
    expect(result.value.usage.artifactBytes).toBe(
      GOLDEN_ARTIFACT.byteLength * 5,
    );
    expectDeeplyFrozen(result.value);
    expectTypeOf(result.value).toEqualTypeOf<
      KernelShapeArtifactCodecAuditEvidence
    >();
    expect(harness.runtimes).toHaveLength(5);
    expect(new Set(harness.runtimes.map((runtime) => runtime.kernel)).size).toBe(
      5,
    );
    expect(
      harness.contexts.every((context) => context.maxArtifactBytes > 0),
    ).toBe(true);
    expect(
      harness.runtimes.every(
        (runtime) =>
          runtime.kernel.capabilities.shapeArtifacts === undefined &&
          runtime.kernel.encodeShapeArtifact === undefined &&
          runtime.kernel.decodeShapeArtifact === undefined,
      ),
    ).toBe(true);
    harness.expectFullyDisposed();
  });

  it("rejects factory reuse in the dedicated pre-witness runtime pair", async () => {
    const harness = new SyntheticHarness();
    const configuration = await optionsFor(harness, "candidate");
    const created: ReturnType<SyntheticHarness["create"]>[] = [];
    let calls = 0;
    const result = await auditKernelShapeArtifactCodec({
      ...configuration,
      target: {
        mode: "candidate",
        create: () => {
          calls += 1;
          if (calls <= 2) {
            const runtime = harness.create("absent");
            created.push(runtime);
            return runtime;
          }
          return created[0]!;
        },
      },
    });
    expectFailure(result, "KERNEL_ERROR");
    expect(result.ok ? "" : result.diagnostics[0]?.message).toContain(
      "reused a kernel instance",
    );
    harness.expectFullyDisposed();
  });

  it("rejects reuse of an already disposed pre-witness runtime", async () => {
    const harness = new SyntheticHarness();
    const configuration = await optionsFor(harness, "candidate");
    const created: ReturnType<SyntheticHarness["create"]>[] = [];
    let calls = 0;
    const result = await auditKernelShapeArtifactCodec({
      ...configuration,
      target: {
        mode: "candidate",
        create: () => {
          calls += 1;
          if (calls <= 4) {
            const runtime = harness.create("absent");
            created.push(runtime);
            return runtime;
          }
          return created[3]!;
        },
      },
    });
    expect(calls).toBe(5);
    expect(created[3]?.kernel).toBe(harness.runtimes[3]?.kernel);
    expect(harness.runtimes[3]?.disposed).toBe(true);
    expectFailure(result, "KERNEL_ERROR");
    expect(result.ok ? "" : result.diagnostics[0]?.message).toContain(
      "reused a kernel instance",
    );
    expect(harness.runtimes).toHaveLength(4);
    harness.expectFullyDisposed();
  });

  it("releases dedicated pre-witness runtimes between self cases", async () => {
    const harness = new SyntheticHarness();
    const cases = await casesFor(harness);
    const self = cases.find(
      (item) => item.scope === "current-runtime-self-round-trip",
    );
    expect(self).toBeDefined();
    if (self === undefined || self.scope !== "current-runtime-self-round-trip") {
      return;
    }
    const result = await auditKernelShapeArtifactCodec(
      await optionsFor(harness, "candidate", {
        cases: [
          self,
          { ...self, id: "second-self-round-trip" },
          ...cases.filter((item) => item.scope === "golden-decode"),
        ],
      }),
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    expect(harness.runtimes).toHaveLength(8);
    expect(harness.peakLiveRuntimes).toBe(4);
    harness.expectFullyDisposed();
  });

  it("audits an already advertised codec without manufacturing capability", async () => {
    const harness = new SyntheticHarness();
    const result = await auditKernelShapeArtifactCodec(
      await optionsFor(harness, "advertised"),
    );
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      certifiesCompatibility: false,
      mode: "advertised",
      advertisement: "advertised",
    });
    expect(
      harness.runtimes.every(
        (runtime) =>
          runtime.kernel.capabilities.shapeArtifacts === ARTIFACT_CAPABILITIES,
      ),
    ).toBe(true);
    harness.expectFullyDisposed();
  });

  it("uses the shared canonical UTF-8 artifact-fingerprint byte ceiling", async () => {
    const boundaryCapabilities: KernelShapeArtifactCapabilities =
      Object.freeze({
        ...ARTIFACT_CAPABILITIES,
        compatibilityFingerprint: "é".repeat(1_024),
      });
    const harness = new SyntheticHarness("none", boundaryCapabilities);
    const accepted = await auditKernelShapeArtifactCodec(
      await optionsFor(harness, "candidate"),
    );
    expect(accepted.ok, JSON.stringify(accepted.diagnostics)).toBe(true);
    harness.expectFullyDisposed();

    const rejectedHarness = new SyntheticHarness();
    const rejected = await auditKernelShapeArtifactCodec(
      await optionsFor(rejectedHarness, "candidate", {
        expectedIdentity: {
          kernelId: KERNEL_ID,
          artifact: {
            ...ARTIFACT_CAPABILITIES,
            compatibilityFingerprint: "é".repeat(1_025),
          },
        },
      }),
    );
    expectFailure(rejected, "ARTIFACT_CACHE_ENTRY_INVALID");
    expect(rejectedHarness.runtimes).toHaveLength(0);
    expect(
      KERNEL_SHAPE_ARTIFACT_MAX_COMPATIBILITY_FINGERPRINT_BYTES,
    ).toBe(2_048);
  });

  it.each([
    ["kernel ID", { kernelId: "other-kernel", artifact: ARTIFACT_CAPABILITIES }],
    [
      "artifact fingerprint",
      {
        kernelId: KERNEL_ID,
        artifact: {
          ...ARTIFACT_CAPABILITIES,
          compatibilityFingerprint: "synthetic-runtime@2",
        },
      },
    ],
  ] as const)(
    "rejects an inexact expected %s and cleans the created runtime",
    async (_label, expectedIdentity) => {
      const harness = new SyntheticHarness();
      const result = await auditKernelShapeArtifactCodec(
        await optionsFor(harness, "candidate", { expectedIdentity }),
      );
      expectFailure(result, "KERNEL_CAPABILITY_MISSING");
      expect(harness.runtimes).toHaveLength(1);
      harness.expectFullyDisposed();
    },
  );

  it("detects golden fixture drift before decode", async () => {
    const harness = new SyntheticHarness();
    const expectedGolden = await fixtureWitness(GOLDEN_ARTIFACT);
    const drifted = GOLDEN_ARTIFACT.slice();
    drifted[3] = drifted[3]! + 1;
    const result = await auditKernelShapeArtifactCodec(
      await optionsFor(harness, "candidate", {
        cases: await casesFor(harness, {
          golden: drifted,
          expectedGolden,
        }),
      }),
    );
    expectFailure(result, "KERNEL_ERROR");
    expect(result.ok ? "" : result.diagnostics[0]?.message).toContain(
      "expectedArtifactWitness",
    );
    harness.expectFullyDisposed();
  });

  it.each([
    ["candidate", "supported"],
    ["candidate", "malformed"],
    ["advertised", "absent"],
    ["advertised", "malformed"],
  ] as const)(
    "rejects %s mode with a %s production declaration and cleans up",
    async (mode, advertisement) => {
      const harness = new SyntheticHarness();
      const result = await auditKernelShapeArtifactCodec(
        await optionsFor(harness, mode, { advertisement }),
      );
      expectFailure(result, "KERNEL_CAPABILITY_MISSING");
      expect(harness.runtimes).toHaveLength(1);
      harness.expectFullyDisposed();
    },
  );

  it.each([
    ["warm-only-encode", "warmed shape"],
    ["lossy-hidden-state", "semantic witness"],
    ["process-local", "process instance"],
    ["shared-encode-buffer", "independent byte arrays"],
    ["retain-decode-input", "valid kernel shape"],
    ["mutate-decode-input", "mutated its borrowed artifact input"],
    ["coupled-decoded-ownership", "valid kernel shape"],
    ["source-coupled-decoded-ownership", "valid kernel shape"],
    ["pre-witness-cross-runtime-source-coupling", "valid kernel shape"],
  ] as const)(
    "rejects adversarial codec behavior: %s",
    async (fault, message) => {
      const harness = new SyntheticHarness(fault);
      const result = await auditKernelShapeArtifactCodec(
        await optionsFor(harness, "candidate"),
      );
      expectFailure(result, "KERNEL_ERROR");
      expect(result.ok ? "" : result.diagnostics[0]?.message).toContain(message);
      harness.expectFullyDisposed();
    },
  );

  it("enforces per-artifact, aggregate-byte, and operation ceilings", async () => {
    const oversized = new SyntheticHarness("ignore-byte-ceiling");
    const oversizedResult = await auditKernelShapeArtifactCodec(
      await optionsFor(oversized, "candidate"),
    );
    expectFailure(oversizedResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");
    oversized.expectFullyDisposed();

    const aggregate = new SyntheticHarness();
    const aggregateResult = await auditKernelShapeArtifactCodec(
      await optionsFor(aggregate, "candidate", {
        limits: {
          maxArtifactBytes: GOLDEN_ARTIFACT.byteLength,
          maxTotalArtifactBytes: GOLDEN_ARTIFACT.byteLength,
        },
      }),
    );
    expectFailure(aggregateResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");
    aggregate.expectFullyDisposed();

    const operations = new SyntheticHarness();
    const operationResult = await auditKernelShapeArtifactCodec(
      await optionsFor(operations, "candidate", { limits: { maxOperations: 2 } }),
    );
    expectFailure(operationResult, "ARTIFACT_CACHE_LIMIT_EXCEEDED");
    operations.expectFullyDisposed();
  });

  it("applies full output validation to a successful reduced-ceiling encode", async () => {
    const harness = new SyntheticHarness("invalid-reduced-output");
    const result = await auditKernelShapeArtifactCodec(
      await optionsFor(harness, "candidate"),
    );
    expectFailure(result, "ARTIFACT_CACHE_LIMIT_EXCEEDED");
    harness.expectFullyDisposed();
  });

  it("decodes and witnesses a structurally valid reduced-ceiling encoding", async () => {
    const harness = new SyntheticHarness("lossy-reduced-output");
    const result = await auditKernelShapeArtifactCodec(
      await optionsFor(harness, "candidate"),
    );
    expectFailure(result, "KERNEL_ERROR");
    expect(result.ok ? "" : result.diagnostics[0]?.message).toContain(
      "semantic witness",
    );
    harness.expectFullyDisposed();
  });

  it("rejects a reused kernel instance without disposing it twice", async () => {
    const harness = new SyntheticHarness();
    const created = harness.create("absent");
    const valid = await optionsFor(harness, "candidate");
    const result = await auditKernelShapeArtifactCodec({
      ...valid,
      target: { mode: "candidate", create: () => created },
    });
    expectFailure(result, "KERNEL_ERROR");
    expect(harness.runtimes).toHaveLength(1);
    harness.expectFullyDisposed();
  });

  it("does not immediately dispose an already tracked kernel on second capture failure", async () => {
    const harness = new SyntheticHarness();
    const created = harness.create("absent");
    const valid = await optionsFor(harness, "candidate");
    let calls = 0;
    const result = await auditKernelShapeArtifactCodec({
      ...valid,
      target: {
        mode: "candidate",
        create: () => {
          calls += 1;
          return calls === 1
            ? created
            : {
                kernel: created.kernel,
                codec: {} as KernelShapeArtifactCodecCandidate,
              };
        },
      },
    });
    expectFailure(result, "ARTIFACT_CACHE_ENTRY_INVALID");
    expect(harness.runtimes).toHaveLength(1);
    harness.expectFullyDisposed();
  });

  it("cleans a runtime when cancellation arrives as its factory settles", async () => {
    const harness = new SyntheticHarness();
    const controller = new AbortController();
    const valid = await optionsFor(harness, "candidate");
    const result = await auditKernelShapeArtifactCodec({
      ...valid,
      signal: controller.signal,
      target: {
        mode: "candidate",
        create: () => {
          const created = harness.create("absent");
          controller.abort();
          return created;
        },
      },
    });
    expectFailure(result, "EVALUATION_ABORTED");
    expect(harness.runtimes).toHaveLength(1);
    harness.expectFullyDisposed();
  });

  it("prioritizes caller cancellation over a malformed shape settled by a callback", async () => {
    const harness = new SyntheticHarness();
    const controller = new AbortController();
    const cases = await casesFor(harness);
    const rewritten = cases.map((item) =>
      item.scope === "current-runtime-self-round-trip"
        ? {
            ...item,
            createSource: (kernel: GeometryKernel) => {
              const shape = harness.source(kernel);
              Object.defineProperty(shape, "kernel", { value: "wrong-kernel" });
              controller.abort();
              return shape;
            },
          }
        : item,
    );
    const result = await auditKernelShapeArtifactCodec(
      await optionsFor(harness, "candidate", {
        cases: rewritten,
        signal: controller.signal,
      }),
    );
    expectFailure(result, "EVALUATION_ABORTED");
    harness.expectFullyDisposed();
  });

  it("requires AbortError rejection and honors caller cancellation", async () => {
    const ignored = new SyntheticHarness("ignore-cancellation");
    const ignoredResult = await auditKernelShapeArtifactCodec(
      await optionsFor(ignored, "candidate"),
    );
    expectFailure(ignoredResult, "KERNEL_ERROR");
    expect(ignoredResult.ok ? "" : ignoredResult.diagnostics[0]?.message).toContain(
      "pre-aborted",
    );
    ignored.expectFullyDisposed();

    const aborted = new AbortController();
    aborted.abort();
    const preAborted = new SyntheticHarness();
    const abortedResult = await auditKernelShapeArtifactCodec(
      await optionsFor(preAborted, "candidate", { signal: aborted.signal }),
    );
    expectFailure(abortedResult, "EVALUATION_ABORTED");
    expect(preAborted.runtimes).toHaveLength(0);
  });

  it("contains malformed, excessive, and hostile options in CadResult failures", async () => {
    const harness = new SyntheticHarness();
    const valid = await optionsFor(harness, "candidate");
    const unknown = await auditKernelShapeArtifactCodec({
      ...valid,
      unexpected: true,
    } as unknown as AuditKernelShapeArtifactCodecOptions);
    expectFailure(unknown, "ARTIFACT_CACHE_ENTRY_INVALID");

    const malformedLimits = await auditKernelShapeArtifactCodec({
      ...valid,
      limits: { maxCases: 0 },
    });
    expectFailure(malformedLimits, "ARTIFACT_CACHE_ENTRY_INVALID");

    const tooFewCases = await auditKernelShapeArtifactCodec({
      ...valid,
      limits: { maxCases: 1 },
    });
    expectFailure(tooFewCases, "ARTIFACT_CACHE_LIMIT_EXCEEDED");

    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const hostile = await auditKernelShapeArtifactCodec(
      proxy as AuditKernelShapeArtifactCodecOptions,
    );
    expectFailure(hostile, "ARTIFACT_CACHE_ENTRY_INVALID");
    expect(harness.runtimes).toHaveLength(0);

    const { proxy: signalProxy, revoke: revokeSignal } = Proxy.revocable(
      new AbortController().signal,
      {},
    );
    revokeSignal();
    const hostileSignal = await auditKernelShapeArtifactCodec({
      ...valid,
      signal: signalProxy,
    });
    expectFailure(hostileSignal, "ARTIFACT_CACHE_ENTRY_INVALID");
    expect(harness.runtimes).toHaveLength(0);
  });
});

describe("shape-artifact witness helpers", () => {
  it("tags semantic and fixture SHA-256 domains without conflating them", async () => {
    const bytes = new TextEncoder().encode("same witness material");
    const semanticBytes = await valueOf(
      hashKernelShapeArtifactSemanticWitness(bytes),
    );
    const semanticString = await valueOf(
      hashKernelShapeArtifactSemanticWitness("same witness material"),
    );
    const fixture = await valueOf(hashKernelShapeArtifactFixtureWitness(bytes));

    expect(semanticBytes).toBe(semanticString);
    expect(semanticBytes).toMatch(
      new RegExp(`^${KERNEL_SHAPE_ARTIFACT_SEMANTIC_WITNESS_PREFIX}[0-9a-f]{64}$`),
    );
    expect(fixture).toMatch(
      new RegExp(`^${KERNEL_SHAPE_ARTIFACT_FIXTURE_WITNESS_PREFIX}[0-9a-f]{64}$`),
    );
    expect(semanticBytes).not.toBe(fixture);
    expectTypeOf(semanticBytes).toEqualTypeOf<KernelShapeArtifactSemanticWitness>();
    expectTypeOf(fixture).toEqualTypeOf<KernelShapeArtifactFixtureWitness>();
  });

  it("bounds inputs, validates exact byte kinds, and observes pre-abort", async () => {
    const bounded = await hashKernelShapeArtifactSemanticWitness("abcd", {
      maxBytes: 3,
    });
    expectFailure(bounded, "ARTIFACT_CACHE_LIMIT_EXCEEDED");

    const invalidBytes = await hashKernelShapeArtifactSemanticWitness(
      new Uint16Array([1]) as unknown as Uint8Array,
    );
    expectFailure(invalidBytes, "ARTIFACT_CACHE_LIMIT_EXCEEDED");

    const crossRealm = runInNewContext(
      "new Uint8Array([1, 2, 3])",
    ) as Uint8Array;
    const crossRealmResult =
      await hashKernelShapeArtifactSemanticWitness(crossRealm);
    expect(crossRealmResult.ok).toBe(true);

    const controller = new AbortController();
    controller.abort();
    const aborted = await hashKernelShapeArtifactSemanticWitness("x", {
      signal: controller.signal,
    });
    expectFailure(aborted, "EVALUATION_ABORTED");

    const { proxy: proxySignal, revoke: revokeSignal } = Proxy.revocable(
      new AbortController().signal,
      {},
    );
    revokeSignal();
    const hostileSignal = await hashKernelShapeArtifactSemanticWitness("x", {
      signal: proxySignal,
    });
    expectFailure(hostileSignal, "ARTIFACT_CACHE_ENTRY_INVALID");

    const malformed = await hashKernelShapeArtifactSemanticWitness("x", {
      maxBytes: Number.NaN,
    });
    expectFailure(malformed, "ARTIFACT_CACHE_ENTRY_INVALID");

    const nullMaximum = await hashKernelShapeArtifactSemanticWitness(
      "x",
      { maxBytes: null } as unknown as { readonly maxBytes?: number },
    );
    expectFailure(nullMaximum, "ARTIFACT_CACHE_ENTRY_INVALID");

    const unknown = await hashKernelShapeArtifactSemanticWitness("x", {
      unexpected: true,
    } as unknown as { readonly maxBytes?: number });
    expectFailure(unknown, "ARTIFACT_CACHE_ENTRY_INVALID");
  });
});
